import { WebSocket } from "ws";

import { normalizePlayerAccountName, buildPlayerSaveKey } from "../game/state/PlayerSessionKeys";
import type { PlayerState } from "../game/player";
import type { RoutedMessage } from "./MessageRouter";
import type { AppearanceSetPacket, DecodedPacket } from "./packet";
import { isBinaryData, isNewProtocolPacket, parsePacketsAsMessages, toUint8Array } from "./packet";
import { decodeClientPacket } from "./packet/ClientBinaryDecoder";
import { encodeMessage } from "./messages";
import { handleExaminePacket as handleExaminePacketFn } from "./handlers/examineHandler";
import { PlayerSyncSession } from "./PlayerSyncSession";
import { ADMIN_CROWN_ICON } from "./AuthenticationService";
import {
    SIDE_JOURNAL_GROUP_ID,
} from "../../../src/shared/ui/sideJournal";
import {
    VARBIT_SIDE_JOURNAL_TAB,
    VARBIT_XPDROPS_ENABLED,
    VARP_SIDE_JOURNAL_STATE,
} from "../../../src/shared/vars";
import { getItemDefinition } from "../data/items";
import { DIARY_VARBITS } from "../../data/diaryVarbits";
import { logger } from "../utils/logger";
import type { ServerServices } from "../game/ServerServices";

const NPC_STREAM_RADIUS_TILES = 15;
const DEBUG_NPC_STREAM =
    (process?.env?.DEBUG_NPC_STREAM ?? "").toString().toLowerCase() === "1" ||
    (process?.env?.DEBUG_NPC_STREAM ?? "").toString().toLowerCase() === "true";

type PlayerAppearanceState = NonNullable<PlayerState["appearance"]>;

interface HandshakeAppearance {
    gender?: number;
    kits?: number[];
    colors?: number[];
}

/**
 * Manages the login validation, handshake negotiation, and WebSocket
 * connection lifecycle (message routing + disconnect cleanup).
 *
 * Extracted from WSServer to reduce the size of the god object while
 * keeping the deeply-coupled handshake flow intact.
 */
export class LoginHandshakeService {
    private readonly pendingLoginNames = new WeakMap<WebSocket, string>();

    constructor(private readonly svc: ServerServices) {}

    setPendingLoginName(ws: WebSocket, name: string): void {
        this.pendingLoginNames.set(ws, name);
    }

    consumePendingLoginName(ws: WebSocket): string | undefined {
        const name = this.pendingLoginNames.get(ws);
        this.pendingLoginNames.delete(ws);
        return name;
    }

    getSocketRemoteAddress(ws: WebSocket): string | undefined {
        const transport = Reflect.get(ws, "_socket") as { remoteAddress?: string } | undefined;
        const remoteAddress = transport?.remoteAddress;
        return remoteAddress && remoteAddress.length > 0 ? remoteAddress : undefined;
    }

    completeLogout(ws: WebSocket, player?: PlayerState, source?: string): void {
        const normalizedSource = source?.trim().slice(0, 64) ?? "";
        const sourceSuffix =
            normalizedSource.length > 0 && normalizedSource !== "logout"
                ? ` source=${normalizedSource}`
                : "";

        if (player) {
            logger.info(`[logout] Player ${player.id} logout approved${sourceSuffix}`);

            try {
                const response = encodeMessage({
                    type: "logout_response",
                    payload: { success: true },
                });
                ws.send(response);
            } catch (err) { logger.warn("[logout] send logout response failed", err); }

            try {
                const saveKey = player.__saveKey ?? buildPlayerSaveKey(player.name, player.id);
                this.svc.playerPersistence.saveSnapshot(saveKey, player);
                logger.info(`[logout] Saved player state for key: ${saveKey}${sourceSuffix}`);
            } catch (err) {
                logger.warn(`[logout] Failed to save player state${sourceSuffix}:`, err);
            }
        }

        try {
            ws.close(1000, "logout");
        } catch (err) { logger.warn("[logout] ws close failed", err); }
    }

    handleLoginMessage(ws: WebSocket, payload: { username?: string; password?: string; revision?: number }): void {
        const { username, password, revision } = payload;
        const normalizedUsername = (username || "").trim().toLowerCase();

        const sendLoginError = (errorCode: number, error: string) => {
            this.svc.networkLayer.withDirectSendBypass("login_response", () =>
                this.svc.networkLayer.sendWithGuard(
                    ws,
                    encodeMessage({
                        type: "login_response",
                        payload: { success: false, errorCode, error },
                    }),
                    "login_response",
                ),
            );
            logger.info(`Login failed (code ${errorCode}): ${username} - ${error}`);
        };

        const clientIp = this.getSocketRemoteAddress(ws) ?? "ws-unknown";
        logger.info(`Login attempt from: ${username} (${clientIp})`);

        // 0. Check client revision matches server
        const serverRevision = this.svc.cacheEnv?.info?.revision ?? 0;
        if (serverRevision > 0 && revision !== serverRevision) {
            sendLoginError(6, "Please close the client and reload to update.");
            return;
        }

        // 1. Check rate limiting first
        if (this.svc.authService.checkLoginRateLimit(clientIp)) {
            sendLoginError(9, "Login limit exceeded. Please wait a minute.");
            return;
        }

        // 2. Check maintenance mode
        if (this.svc.maintenanceMode) {
            sendLoginError(14, "The server is being updated. Please wait.");
            return;
        }

        // 3. Check world capacity
        if (this.svc.authService.isWorldFull()) {
            sendLoginError(2, "This world is full. Please use a different world.");
            return;
        }

        // 4. Validate username is not empty
        if (!normalizedUsername || normalizedUsername.length === 0) {
            sendLoginError(3, "Invalid username or password.");
            return;
        }

        // 5. Check if already logged in
        if (this.svc.authService.isPlayerAlreadyLoggedIn(normalizedUsername)) {
            sendLoginError(
                5,
                "Your account is already logged in. Try again in 60 seconds.",
            );
            return;
        }

        // All checks passed - login successful
        const displayName = (username ?? "").slice(0, 12);
        this.setPendingLoginName(ws, displayName);
        this.svc.networkLayer.withDirectSendBypass("login_response", () =>
            this.svc.networkLayer.sendWithGuard(
                ws,
                encodeMessage({
                    type: "login_response",
                    payload: {
                        success: true,
                        displayName,
                    },
                }),
                "login_response",
            ),
        );
        logger.info(`Login successful: ${username}`);
    }

    handleHandshakeMessage(ws: WebSocket, payload: { name?: string; appearance?: AppearanceSetPacket; displayMode?: number }): void {
        const parsed = { type: "handshake" as const, payload };
        try {
            const pendingLoginName = this.consumePendingLoginName(ws);
            const name = pendingLoginName || parsed.payload.name?.slice(0, 12) || undefined;

            const preliminarySaveKey = normalizePlayerAccountName(name);
            let p: PlayerState | undefined;
            let isReconnect = false;

            if (preliminarySaveKey && this.svc.players?.hasOrphanedPlayer(preliminarySaveKey)) {
                p = this.svc.players.reconnectOrphanedPlayer(ws, preliminarySaveKey);
                if (p) {
                    isReconnect = true;
                    logger.info(
                        `[handshake] Player ${name} reconnected to orphaned session (id=${p.id})`,
                    );
                }
            }

            if (!p) {
                const spawn = this.svc.gamemode.getSpawnLocation(undefined as unknown as PlayerState);
                const spawnX = spawn.x,
                    spawnY = spawn.y,
                    level = spawn.level;
                p = this.svc.players?.add(ws, spawnX, spawnY, level);
            }

            if (!p) {
                try {
                    ws.close(1013, "server_full");
                } catch (err) {
                    logger.warn("[handshake] failed to close socket", err);
                }
                return;
            }
            {
                p.widgets.setDispatcher((action) => {
                    if (action.action === "close") {
                        this.svc.widgetDialogHandler!.handleWidgetCloseState(p!, action.groupId);
                    }
                    this.svc.queueWidgetEvent(p!.id, action);
                });

                if (!isReconnect) {
                    this.svc.actionScheduler.registerPlayer(p);
                }

                p.items.setItemDefResolver((id) => getItemDefinition(id));

                p.status.onDeath = () => {
                    if (this.svc.playerDeathService) {
                        this.svc.playerDeathService.startPlayerDeath(p!);
                    }
                };

                const appearance =
                    parsed.payload.appearance !== undefined
                        ? this.svc.playerAppearanceManager!.sanitizeHandshakeAppearance(parsed.payload.appearance)
                        : this.svc.appearanceService.createDefaultAppearance();

                if (!isReconnect) {
                    p.name = name ?? "";
                    p.appearance = appearance;
                    this.svc.equipmentService.ensureEquipArray(p);
                    this.svc.appearanceService.refreshAppearanceKits(p);
                    this.svc.equipmentService.refreshCombatWeaponCategory(p);
                    p.combat.attackDelay = this.svc.playerCombatService!.pickAttackSpeed(p);
                    const saveKey = buildPlayerSaveKey(name, p.id);
                    p.__saveKey = saveKey;
                    try {
                        this.svc.playerPersistence.applyToPlayer(p, saveKey);
                    } catch (err) {
                        logger.warn("[player] failed to apply persistent vars", err);
                    }
                    try {
                        if (!this.svc.playerPersistence.hasKey(saveKey)) {
                            p.account.accountStage = 0;
                        } else if (!Number.isFinite(p.account.accountStage)) {
                            p.account.accountStage = 1;
                        }
                    } catch {
                        if (!Number.isFinite(p.account.accountStage)) p.account.accountStage = 1;
                    }
                    try {
                        this.svc.gamemode.resolveAccountStage?.(p);
                    } catch (err) {
                        logger.warn("[handshake] resolveAccountStage failed", err);
                    }
                    p.setRunToggle(true);
                    try {
                        this.svc.appearanceService.refreshAppearanceKits(p);
                        this.svc.equipmentService.refreshCombatWeaponCategory(p);
                    } catch (err) {
                        logger.warn(
                            "[player] failed to refresh appearance after persist",
                            err,
                        );
                    }
                } else {
                    logger.info(
                        `[handshake] Resuming player ${name} at (${p.tileX}, ${p.tileY})`,
                    );
                }

                try {
                    this.svc.followerManager?.restoreFollowerForPlayer(p);
                } catch (err) {
                    logger.warn("[follower] failed to restore player follower", err);
                }

                // Apply gamemode login varbits (diary unlocks, xp drops, etc.)
                const loginVarbits = this.svc.gamemode.getLoginVarbits?.(p);
                if (loginVarbits) {
                    for (const [varbitId, value] of loginVarbits) {
                        p.varps.setVarbitValue(varbitId, value);
                    }
                }

                const handshakeAppearance = p.appearance;
                const handshakeName = this.svc.appearanceService.getAppearanceDisplayName(p) || name;
                const handshakeChatIcons = this.svc.authService.isAdminPlayer(p)
                    ? [ADMIN_CROWN_ICON]
                    : undefined;
                this.svc.networkLayer.withDirectSendBypass("handshake_ack", () =>
                    this.svc.networkLayer.sendWithGuard(
                        ws,
                        encodeMessage({
                            type: "handshake",
                            payload: {
                                id: p.id,
                                name: handshakeName,
                                appearance: handshakeAppearance as unknown as import("./messages").Appearance,
                                chatIcons: handshakeChatIcons,
                            },
                        }),
                        "handshake_ack",
                    ),
                );
                this.svc.appearanceService.sendAnimUpdate(p);
                this.svc.inventoryService.sendInventorySnapshotImmediate(ws, p);
                p.skillSystem.requestFullSkillSync();
                this.svc.skillService.sendSkillsSnapshotImmediate(ws, p);
                this.svc.queueCombatState(p);
                this.svc.movementService.sendRunEnergyState(ws, p);
                this.svc.varpSyncService.sendSavedTransmitVarps(ws, p);
                this.svc.collectionLogService.sendCollectionLogDisplayVarps(ws, p);
                this.svc.varpSyncService.sendSavedAutocastTransmitVarbits(ws, p);
                this.svc.varpSyncService.sendSavedSpellbookState(ws, p);
                this.svc.varpSyncService.syncAccountTypeVarbit(ws, p);
                const sideJournalState = this.svc.gamemodeUi?.normalizeSideJournalState(p)
                    ?? { tab: 0, stateVarp: 0 };
                this.svc.networkLayer.withDirectSendBypass("varp", () =>
                    this.svc.networkLayer.sendWithGuard(
                        ws,
                        encodeMessage({
                            type: "varp",
                            payload: {
                                varpId: VARP_SIDE_JOURNAL_STATE,
                                value: sideJournalState.stateVarp,
                            },
                        }),
                        "varp",
                    ),
                );
                this.svc.networkLayer.withDirectSendBypass("varbit", () =>
                    this.svc.networkLayer.sendWithGuard(
                        ws,
                        encodeMessage({
                            type: "varbit",
                            payload: {
                                varbitId: VARBIT_SIDE_JOURNAL_TAB,
                                value: sideJournalState.tab,
                            },
                        }),
                        "varbit",
                    ),
                );

                for (const [varbitId, value] of DIARY_VARBITS) {
                    this.svc.networkLayer.withDirectSendBypass("varbit", () =>
                        this.svc.networkLayer.sendWithGuard(
                            ws,
                            encodeMessage({
                                type: "varbit",
                                payload: { varbitId, value },
                            }),
                            "varbit",
                        ),
                    );
                }

                const contentDataPacket = this.svc.gamemode.getContentDataPacket?.();
                if (contentDataPacket) {
                    this.svc.networkLayer.withDirectSendBypass("gamemode_data", () =>
                        this.svc.networkLayer.sendWithGuard(ws, contentDataPacket, "gamemode_data"),
                    );
                }

                this.svc.gamemode.onPlayerHandshake(p, {
                    sendVarp: (varpId, value) =>
                        this.svc.networkLayer.withDirectSendBypass("varp", () =>
                            this.svc.networkLayer.sendWithGuard(ws, encodeMessage({
                                type: "varp",
                                payload: { varpId, value },
                            }), "varp"),
                        ),
                    sendVarbit: (varbitId, value) =>
                        this.svc.networkLayer.withDirectSendBypass("varbit", () =>
                            this.svc.networkLayer.sendWithGuard(ws, encodeMessage({
                                type: "varbit",
                                payload: { varbitId, value },
                            }), "varbit"),
                        ),
                    queueVarp: (playerId, varpId, value) =>
                        this.svc.variableService.queueVarp(playerId, varpId, value),
                    queueVarbit: (playerId, varbitId, value) =>
                        this.svc.variableService.queueVarbit(playerId, varbitId, value),
                    queueNotification: (playerId, notification) =>
                        this.svc.messagingService.queueNotification(playerId, notification as Record<string, unknown>),
                });

                const clientType = (parsed.payload as any).clientType;
                const isMobileClient = clientType === 1;

                {
                    const {
                        getDefaultInterfaces,
                        getRootInterfaceId,
                        DisplayMode,
                    } = require("../widgets/WidgetManager");
                    const { getViewportRootInitScripts } = require("../widgets/viewport");
                    const displayMode = isMobileClient
                        ? DisplayMode.MOBILE
                        : DisplayMode.RESIZABLE_NORMAL;
                    const rootInterfaceGroupId = getRootInterfaceId(displayMode);
                    for (const script of getViewportRootInitScripts()) {
                        this.svc.networkLayer.withDirectSendBypass("runClientScript", () =>
                            this.svc.networkLayer.sendWithGuard(
                                ws,
                                encodeMessage({
                                    type: "runClientScript",
                                    payload: {
                                        scriptId: script.scriptId,
                                        args: script.args,
                                    },
                                }),
                                "runClientScript",
                            ),
                        );
                    }
                    this.svc.queueWidgetEvent(p.id, {
                        action: "set_root",
                        groupId: rootInterfaceGroupId,
                    });

                    p.displayMode = displayMode;

                    const accountStage = p.account.accountStage;
                    const tutorialActive = this.svc.gamemode.isTutorialActive(p);
                    const tutorialMode = accountStage >= 1 && tutorialActive;
                    const charCreationMode = accountStage === 0;
                    const preStartMode = charCreationMode || (this.svc.gamemode.isTutorialPreStart?.(p) ?? false);

                    const interfaces = getDefaultInterfaces(displayMode, {
                        tutorialMode: tutorialMode || charCreationMode,
                    });
                    const filteredInterfaces = preStartMode
                        ? interfaces.filter((i: { groupId: number }) => i.groupId !== 629)
                        : interfaces;
                    const xpDropsEnabled = p.varps.getVarbitValue(VARBIT_XPDROPS_ENABLED) === 1;
                    for (const intf of filteredInterfaces) {
                        const questVarps: Record<number, number> = {};
                        const questVarbits: Record<number, number> = {};
                        if (intf.groupId === SIDE_JOURNAL_GROUP_ID) {
                            const gamemodeSideJournalBootstrap =
                                this.svc.gamemodeUi?.getSideJournalBootstrapState(p)
                                ?? { varps: {}, varbits: {} };
                            Object.assign(questVarps, gamemodeSideJournalBootstrap.varps);
                            Object.assign(questVarbits, gamemodeSideJournalBootstrap.varbits);

                            questVarbits[6347] = 0; // quests_completed_count (0 completed)
                            questVarbits[11877] = 158; // quests_total_count (158 total quests in OSRS)
                            questVarbits[1782] = 300; // qp_max (300 max quest points)

                            questVarps[101] = 0; // qp (0 current quest points)
                            questVarps[904] = 300; // qp_total (triggers questlist_qp script)
                        }
                        const mergedVarbits = {
                            ...(intf.varbits ?? {}),
                            ...questVarbits,
                        };
                        const mergedVarps = {
                            ...(intf.varps ?? {}),
                            ...questVarps,
                        };
                        const hideXpCounterOnOpen = intf.groupId === 122 && !xpDropsEnabled;
                        this.svc.queueWidgetEvent(p.id, {
                            action: "open_sub",
                            targetUid: intf.targetUid,
                            groupId: intf.groupId,
                            type: intf.type,
                            ...(Array.isArray(intf.postScripts) &&
                            intf.postScripts.length > 0
                                ? { postScripts: intf.postScripts }
                                : {}),
                            ...(hideXpCounterOnOpen
                                ? { hiddenUids: [intf.targetUid] }
                                : {}),
                            ...(Object.keys(mergedVarps).length > 0
                                ? { varps: mergedVarps }
                                : {}),
                            ...(Object.keys(mergedVarbits).length > 0
                                ? { varbits: mergedVarbits }
                                : {}),
                        });

                        if (intf.groupId === SIDE_JOURNAL_GROUP_ID) {
                            this.svc.gamemodeUi?.applySideJournalUi(p);
                        }
                    }
                    if (tutorialMode && !preStartMode) {
                        this.svc.gamemodeUi?.activateQuestTab(p.id);
                    }
                    if (p.account.accountStage >= 1 && this.svc.gamemode.isTutorialActive(p)) {
                        this.svc.gamemodeUi?.queueTutorialOverlay(p);
                    }

                    // IF_SETEVENTS for inventory widget slots
                    const INVENTORY_GROUP_ID = 149;
                    const INVENTORY_CONTAINER_COMPONENT = 0;
                    const INVENTORY_SLOT_COUNT = 28;
                    const INVENTORY_FLAGS = 1181694;

                    this.svc.queueWidgetEvent(p.id, {
                        action: "set_flags_range",
                        uid: (INVENTORY_GROUP_ID << 16) | INVENTORY_CONTAINER_COMPONENT,
                        fromSlot: 0,
                        toSlot: INVENTORY_SLOT_COUNT - 1,
                        flags: INVENTORY_FLAGS,
                    });

                    // IF_SETEVENTS for prayer filter dynamic rows
                    const PRAYER_GROUP_ID = 541;
                    const PRAYER_FILTER_COMPONENT = 42;
                    const PRAYER_FILTER_SLOT_START = 0;
                    const PRAYER_FILTER_SLOT_END = 4;
                    const PRAYER_FILTER_FLAGS = 1 << 1;

                    this.svc.queueWidgetEvent(p.id, {
                        action: "set_flags_range",
                        uid: (PRAYER_GROUP_ID << 16) | PRAYER_FILTER_COMPONENT,
                        fromSlot: PRAYER_FILTER_SLOT_START,
                        toSlot: PRAYER_FILTER_SLOT_END,
                        flags: PRAYER_FILTER_FLAGS,
                    });

                    // IF_SETEVENTS for equipment widget slots
                    const EQUIPMENT_GROUP_ID = 387;
                    const EQUIPMENT_SLOT_START = 15;
                    const EQUIPMENT_SLOT_END = 25;
                    const EQUIPMENT_FLAGS = 62;

                    for (
                        let comp = EQUIPMENT_SLOT_START;
                        comp <= EQUIPMENT_SLOT_END;
                        comp++
                    ) {
                        this.svc.queueWidgetEvent(p.id, {
                            action: "set_flags_range",
                            uid: (EQUIPMENT_GROUP_ID << 16) | comp,
                            fromSlot: -1,
                            toSlot: -1,
                            flags: EQUIPMENT_FLAGS,
                        });
                    }

                    // IF_SETEVENTS for quest list dynamic children
                    const QUEST_LIST_GROUP_ID = 399;
                    const QUEST_LIST_COMPONENT = 7;
                    const QUEST_LIST_MAX_SLOT = 199;
                    const QUEST_LIST_FLAGS = 0x7e;

                    this.svc.queueWidgetEvent(p.id, {
                        action: "set_flags_range",
                        uid: (QUEST_LIST_GROUP_ID << 16) | QUEST_LIST_COMPONENT,
                        fromSlot: 0,
                        toSlot: QUEST_LIST_MAX_SLOT,
                        flags: QUEST_LIST_FLAGS,
                    });
                }

                if (p.account.accountStage === 0) {
                    try {
                        const { getMainmodalUid } = require("../widgets/WidgetManager");
                        const targetUid = getMainmodalUid(p.displayMode);
                        p.widgets.open(679, { targetUid, type: 0 });
                    } catch (err) {
                        logger.warn("[handshake] failed to open char creation widget", err);
                    }
                }

                try {
                    if (p.account.accountStage >= 1 && this.svc.gamemode.isTutorialActive(p)) {
                        const spawn = this.svc.gamemode.getSpawnLocation(p);
                        p.teleport(spawn.x, spawn.y, spawn.level);
                    }
                } catch (err) {
                    logger.warn("[handshake] tutorial spawn teleport failed", err);
                }

                this.svc.gamemode.onPlayerRestore?.(p);

                const startTileX = p.tileX;
                const startTileY = p.tileY;
                const startLevel = p.level;
                logger.info(
                    `Handshake ok id=${p.id} spawn=(${startTileX},${startTileY},L${startLevel})`,
                );
                const appearanceSnapshot = p.appearance;
                this.svc.playerAppearanceManager!.queueAppearanceSnapshot(p, {
                    x: (startTileX << 7) + 64,
                    y: (startTileY << 7) + 64,
                    level: startLevel,
                    rot: p.rot,
                    orientation: p.getOrientation() & 2047,
                    running: false,
                    appearance: appearanceSnapshot,
                    name,
                    moved: true,
                    turned: false,
                    snap: true,
                });
                p.markSent();

                this.svc.messagingService.queueChatMessage({
                    messageType: "server",
                    text: "Welcome to Old School Runescape!",
                    targetPlayerIds: [p.id],
                });

                if (this.svc.npcManager && p) {
                    const player = p;
                    try {
                        const nearby = this.svc.npcManager.getNearby(
                            startTileX,
                            startTileY,
                            startLevel,
                            NPC_STREAM_RADIUS_TILES,
                        );
                        player.visibleNpcIds.clear();
                        if (DEBUG_NPC_STREAM) {
                            logger.info(
                                `[npcs] initial snapshot -> player=${player.id} count=${nearby.length}`,
                            );
                        }
                        for (const npc of nearby) {
                            const snap = this.svc.npcSyncManager!.serializeNpcSnapshot(npc);
                            player.visibleNpcIds.add(snap.id);
                            this.svc.npcSyncManager!.queueNpcSnapshot(player.id, snap);
                        }
                    } catch (err) {
                        logger.warn("[NpcManager] snapshot send failed", err);
                    }
                }

                this.svc.locationService.maybeReplayDynamicLocState(ws, p, true);

                this.svc.eventBus.emit("player:login", { player: p });
            }
        } catch (err) {
            logger.warn("[handshake] handleHandshakeMessage error:", err);
        }
    }

    onConnection(ws: WebSocket): void {
        logger.info("Client connected");
        this.svc.playerSyncSessions.set(ws, new PlayerSyncSession());
        this.svc.networkLayer.withDirectSendBypass("welcome_packet", () =>
            this.svc.networkLayer.sendWithGuard(
                ws,
                encodeMessage({
                    type: "welcome",
                    payload: { tickMs: this.svc.tickMs, serverTime: Date.now() },
                }),
                "welcome_packet",
            ),
        );

        ws.on("message", (raw) => {
            let binaryParsed: RoutedMessage | null = null;

            if (isBinaryData(raw)) {
                if (isNewProtocolPacket(raw as Buffer | ArrayBuffer)) {
                    const decoded = decodeClientPacket(toUint8Array(raw));
                    if (decoded) {
                        if (this.svc.messageRouter!.dispatch(ws, decoded)) {
                            return;
                        }
                        binaryParsed = decoded;
                    } else {
                        return;
                    }
                } else {
                    const data = toUint8Array(raw);
                    const packets = parsePacketsAsMessages(data);
                    for (const { msg, packet } of packets) {
                        if (packet.type === "appearance_set") {
                            const p = this.svc.players?.get(ws);
                            if (!p) continue;
                            const ap = packet as AppearanceSetPacket;

                            const appearance = this.svc.appearanceService.getOrCreateAppearance(p);
                            appearance.gender = ap.gender === 1 ? 1 : 0;
                            appearance.kits = new Array<number>(7).fill(-1);
                            appearance.colors = new Array<number>(5).fill(0);
                            for (let i = 0; i < 7 && i < ap.kits.length; i++) {
                                appearance.kits[i] = ap.kits[i];
                            }
                            for (let i = 0; i < 5 && i < ap.colors.length; i++) {
                                appearance.colors[i] = ap.colors[i];
                            }

                            this.svc.appearanceService.refreshAppearanceKits(p);
                            p.markAppearanceDirty();
                            this.svc.playerAppearanceManager!.queueAppearanceSnapshot(p);

                            p.account.accountStage = 1;
                            try {
                                const key = p.__saveKey;
                                if (key && key.length > 0) {
                                    this.svc.playerPersistence.saveSnapshot(key, p);
                                }
                            } catch (err) {
                                logger.warn("[handshake] failed to save after design", err);
                            }

                            try {
                                p.widgets.close(679);
                            } catch (err) {
                                logger.warn("[handshake] failed to close design widget", err);
                            }

                            try {
                                this.svc.gamemode.onPostDesignComplete?.(p);
                                const spawn = this.svc.gamemode.getSpawnLocation(p);
                                this.svc.movementService.teleportPlayer(p, spawn.x, spawn.y, spawn.level);
                                const name = p.name;
                                const appearanceSnapshot = p.appearance;
                                this.svc.playerAppearanceManager!.queueAppearanceSnapshot(p, {
                                    x: (spawn.x << 7) + 64,
                                    y: (spawn.y << 7) + 64,
                                    level: spawn.level,
                                    rot: p.rot,
                                    orientation: p.getOrientation() & 2047,
                                    running: false,
                                    appearance: appearanceSnapshot,
                                    name,
                                    moved: true,
                                    turned: false,
                                    snap: true,
                                });
                            } catch (err) {
                                logger.warn("[handshake] post-design spawn failed", err);
                            }

                            if (this.svc.gamemode.isTutorialActive(p)) {
                                this.svc.gamemodeUi?.queueTutorialOverlay(p, { queueFlashsideVarbitOnStep3: true });
                            } else {
                                p.account.accountStage = 2;
                                const displayMode = p.displayMode ?? 1;
                                const { getDefaultInterfaces: getDefIntf } = require("../widgets/WidgetManager");
                                const allInterfaces = getDefIntf(displayMode);
                                for (const intf of allInterfaces) {
                                    this.svc.queueWidgetEvent(p.id, {
                                        action: "open_sub",
                                        targetUid: intf.targetUid,
                                        groupId: intf.groupId,
                                        type: intf.type,
                                        ...(Array.isArray(intf.postScripts) && intf.postScripts.length > 0
                                            ? { postScripts: intf.postScripts }
                                            : {}),
                                    });
                                }
                            }
                            continue;
                        }

                        if (!msg && handleExaminePacketFn(
                            {
                                getPlayer: (sock) => this.svc.players?.get(sock),
                                queuePlayerGameMessage: (player, text) =>
                                    this.svc.messagingService.queueChatMessage({
                                        messageType: "game",
                                        text,
                                        targetPlayerIds: [player.id],
                                    }),
                                queryGroundItemArea: (x, y, level, radius, tick, playerId, wvId) =>
                                    this.svc.groundItems.queryArea(x, y, level, radius, tick, playerId, wvId),
                                getCurrentTick: () => this.svc.ticker.currentTick(),
                                locTypeLoader: this.svc.locTypeLoader,
                                npcTypeLoader: this.svc.npcTypeLoader,
                                objTypeLoader: this.svc.objTypeLoader,
                                getNpcType: (npc: { typeId?: number } | number) => this.svc.npcTypeLoader?.load(typeof npc === "number" ? npc : npc?.typeId ?? 0),
                                getObjType: (itemId: number) => this.svc.objTypeLoader?.load(itemId),
                            },
                            ws,
                            packet,
                        )) {
                            continue;
                        }

                        if (msg) {
                            if (this.svc.messageRouter!.dispatch(ws, msg)) {
                                continue;
                            }
                            this.svc.messageRouter!.dispatch(ws, msg) || logger.info(`[binary] Unhandled: ${msg.type}`);
                        }
                    }
                    return;
                }
            }

            if (!binaryParsed) {
                logger.warn("[ws] Received non-binary message, ignoring");
                return;
            }
            const parsed = binaryParsed;

            if (this.svc.messageRouter!.dispatch(ws, parsed)) {
                return;
            }

            if (parsed.type === "login") {
                this.handleLoginMessage(ws, parsed.payload);
                return;
            } else if (parsed.type === "handshake") {
                this.handleHandshakeMessage(ws, parsed.payload as any);
                return;
            } else {
                this.svc.messageRouter!.dispatch(ws, parsed) || logger.info(`[binary] Unhandled: ${parsed.type}`);
            }
        });

        ws.on("close", () => {
            try {
                this.svc.movementService.getPendingWalkCommands().delete(ws);
                const player = this.svc.players?.get(ws);
                const id = player?.id;
                if (player) {
                    if (id !== undefined) {
                        this.svc.groundItemHandler?.clearPlayerState(id);
                        this.svc.playerDynamicLocSceneKeys.delete(id);
                    }
                    this.svc.interfaceManager.clearUiTrackingForPlayer(player.id);
                    this.svc.tradeManager?.handlePlayerLogout(
                        player,
                        "The other player has declined the trade.",
                    );
                    if (id !== undefined) {
                        this.svc.widgetDialogHandler!.cleanupPlayerDialogState(id);
                    }
                    this.svc.scriptRuntime.getServices().closeShop?.(player);
                    this.svc.interfaceService?.onPlayerDisconnect(player);
                    try {
                        const closedWidgets = player.widgets.closeAll({ silent: true });
                        if (closedWidgets.length > 0) {
                            logger.info(
                                `[disconnect] Closed ${
                                    closedWidgets.length
                                } widgets for player ${id}: ${closedWidgets
                                    .map((entry) => entry.groupId)
                                    .join(", ")}`,
                            );
                        }
                    } catch (err) {
                        logger.warn(`[disconnect] Failed to close widgets for player ${id}:`, err);
                    }
                    player.widgets.setDispatcher(undefined);

                    this.svc.sailingInstanceManager?.disposeInstance(player);
                    this.svc.worldEntityInfoEncoder.removePlayer(player.id);

                    const saveKey =
                        player.__saveKey ?? buildPlayerSaveKey(player.name, player.id);

                    const currentTick = this.svc.ticker.currentTick();
                    const wasOrphaned = this.svc.players?.orphanPlayer(ws, saveKey, currentTick);

                    if (wasOrphaned) {
                        logger.info(
                            `[disconnect] Player ${id} orphaned (in combat) - staying in world`,
                        );
                    } else {
                        try {
                            this.svc.playerPersistence.saveSnapshot(saveKey, player);
                        } catch (err) {
                            logger.warn("[persist] failed to save player state", err);
                        }
                        this.svc.followerCombatManager?.resetPlayer(player.id);
                        this.svc.followerManager?.despawnFollowerForPlayer(player.id, false);
                        this.svc.eventBus.emit("player:logout", {
                            playerId: player.id,
                            username: player.name ?? "unknown",
                        });
                        this.svc.players?.remove(ws);
                        if (id != null) this.svc.actionScheduler.unregisterPlayer(id);
                        if (id != null) logger.info(`Client disconnected id=${id}`);
                        else logger.info("Client disconnected");
                    }
                } else {
                    this.svc.players?.remove(ws);
                    logger.info("Client disconnected (no player)");
                }
            } catch {
                logger.info("Client disconnected");
            }
            this.svc.playerSyncSessions.delete(ws);
            this.svc.npcSyncSessions.delete(ws);
        });
        ws.on("error", (err) => logger.warn("Client error:", err));
    }
}
