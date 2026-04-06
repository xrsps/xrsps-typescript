import { WebSocket } from "ws";

import { normalizePlayerAccountName } from "../game/state/PlayerSessionKeys";
import type { PlayerState } from "../game/player";
import type { GamemodeDefinition, GamemodeUiController } from "../game/gamemodes/GamemodeDefinition";
import type { RoutedMessage } from "./MessageRouter";
import type { AppearanceSetPacket, DecodedPacket } from "./packet";
import { isBinaryData, isNewProtocolPacket, parsePacketsAsMessages, toUint8Array } from "./packet";
import { decodeClientPacket } from "./packet/ClientBinaryDecoder";
import { encodeMessage } from "./messages";
import type { WidgetAction } from "../widgets/WidgetManager";
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
import { logger } from "../utils/logger";

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
 * Contract for all WSServer methods/properties that LoginHandshakeService
 * calls back into. Kept as a single wide interface because
 * handleHandshakeMessage is deeply coupled to WSServer state.
 */
export interface LoginHandshakeServer {
    // --- Network helpers ---
    getSocketRemoteAddress(ws: WebSocket): string | undefined;
    withDirectSendBypass(context: string, fn: () => void): void;
    sendWithGuard(ws: WebSocket, msg: string | Uint8Array, context: string): void;

    // --- Message routing ---
    readonly messageRouter: { dispatch(ws: WebSocket, msg: any): boolean };

    // --- Sync sessions ---
    readonly playerSyncSessions: Map<WebSocket, any>;
    readonly npcSyncSessions: Map<WebSocket, any>;

    // --- Movement ---
    readonly movementService: { getPendingWalkCommands(): Map<WebSocket, any> };

    // --- Login validation ---
    checkLoginRateLimit(clientIp: string): boolean;
    isWorldFull(): boolean;
    isPlayerAlreadyLoggedIn(username: string): boolean;
    readonly maintenanceMode: boolean;
    readonly cacheEnv: { info?: { revision?: number } } | undefined;

    // --- Player manager ---
    readonly players: {
        get(ws: WebSocket): PlayerState | undefined;
        add(ws: WebSocket, x: number, y: number, level: number): PlayerState | undefined;
        remove(ws: WebSocket): void;
        hasOrphanedPlayer(saveKey: string): boolean;
        reconnectOrphanedPlayer(ws: WebSocket, saveKey: string): PlayerState | undefined;
        orphanPlayer(ws: WebSocket, saveKey: string, currentTick: number): boolean;
    } | undefined;

    // --- Gamemode ---
    readonly gamemode: GamemodeDefinition;
    readonly gamemodeUi: GamemodeUiController | undefined;

    // --- Options / tick ---
    readonly options: {
        tickMs: number;
        ticker: { currentTick(): number };
    };

    // --- Widget dialog handler ---
    readonly widgetDialogHandler: {
        handleWidgetCloseState(player: PlayerState, groupId: number): void;
        cleanupPlayerDialogState(playerId: number): void;
    };

    // --- Action scheduler ---
    readonly actionScheduler: {
        registerPlayer(player: PlayerState): void;
        unregisterPlayer(playerId: number): void;
    };

    // --- Player persistence ---
    readonly playerPersistence: {
        applyToPlayer(player: PlayerState, saveKey: string): void;
        hasKey(saveKey: string): boolean;
        saveSnapshot(saveKey: string, player: PlayerState): void;
    };

    // --- Player death ---
    readonly playerDeathService: { startPlayerDeath(player: PlayerState): void } | undefined;

    // --- Follower ---
    readonly followerManager: {
        restoreFollowerForPlayer(player: PlayerState): void;
        despawnFollowerForPlayer(playerId: number, silent: boolean): void;
    } | undefined;
    readonly followerCombatManager: { resetPlayer(playerId: number): void } | undefined;

    // --- Appearance helpers ---
    sanitizeHandshakeAppearance(raw: HandshakeAppearance): PlayerAppearanceState;
    createDefaultAppearance(): PlayerAppearanceState;
    ensureEquipArray(p: PlayerState): number[];
    refreshAppearanceKits(p: PlayerState): void;
    refreshCombatWeaponCategory(p: PlayerState): any;
    pickAttackSpeed(player: PlayerState): number;
    getPlayerSaveKey(name: string | undefined, id: number): string;
    getAppearanceDisplayName(player: PlayerState | undefined): string;
    isAdminPlayer(player: PlayerState | undefined): boolean;
    getOrCreateAppearance(player: PlayerState): PlayerAppearanceState;

    // --- Sync / broadcast helpers ---
    sendAnimUpdate(ws: WebSocket, p: PlayerState): void;
    sendInventorySnapshotImmediate(ws: WebSocket, p: PlayerState): void;
    sendSkillsSnapshotImmediate(ws: WebSocket, p: PlayerState): void;
    sendCombatState(ws: WebSocket, player: PlayerState): void;
    sendRunEnergyState(sock: WebSocket, player: PlayerState): void;
    sendSavedTransmitVarps(sock: WebSocket, player: PlayerState): void;
    sendCollectionLogDisplayVarps(sock: WebSocket, player: PlayerState): void;
    sendSavedAutocastTransmitVarbits(sock: WebSocket, player: PlayerState): void;
    syncAccountTypeVarbit(sock: WebSocket, player: PlayerState): void;
    normalizeSideJournalState(player: PlayerState): { stateVarp: number; tab: number };

    // --- Queue helpers ---
    queueWidgetEvent(playerId: number, action: WidgetAction): void;
    queueVarp(playerId: number, varpId: number, value: number): void;
    queueVarbit(playerId: number, varbitId: number, value: number): void;
    queueNotification(playerId: number, payload: any): void;
    queueAppearanceSnapshot(player: PlayerState, opts?: any): void;
    queueChatMessage(message: { messageType: string; text: string; targetPlayerIds: number[] }): void;
    queueSideJournalGamemodeUi(player: PlayerState): void;
    queueActivateQuestSideTab(playerId: number): void;

    // --- NPC ---
    readonly npcManager: {
        getNearby(x: number, y: number, level: number, radius: number): any[];
    } | undefined;
    readonly npcSyncManager: {
        serializeNpcSnapshot(npc: any): any;
        queueNpcSnapshot(playerId: number, snap: any): void;
    };

    // --- Ground items ---
    readonly groundItemHandler: { clearPlayerState(playerId: number): void } | undefined;

    // --- Dynamic loc replay ---
    maybeReplayDynamicLocState(ws: WebSocket, player: PlayerState, full: boolean): void;

    // --- Misc cleanup ---
    readonly playerDynamicLocSceneKeys: { delete(playerId: number): void };
    dismissLevelUpPopupQueue(playerId: number): boolean;
    clearUiTrackingForPlayer(playerId: number): void;
    readonly tradeManager: {
        handlePlayerLogout(player: PlayerState, reason: string): void;
    } | undefined;
    readonly scriptRuntime: {
        getServices(): { closeShop?: (player: PlayerState) => void };
    };
    readonly interfaceService: { onPlayerDisconnect(player: PlayerState): void } | undefined;
    readonly sailingInstanceManager: { disposeInstance(player: PlayerState): void } | undefined;
    readonly worldEntityInfoEncoder: { removePlayer(playerId: number): void };

    // --- Teleport ---
    teleportPlayer(player: PlayerState, x: number, y: number, level: number): void;

    // --- Binary packet helpers (used in onConnection message handler) ---
    handleExaminePacket(ws: WebSocket, packet: DecodedPacket): boolean;
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

    constructor(private readonly server: LoginHandshakeServer) {}

    setPendingLoginName(ws: WebSocket, name: string): void {
        this.pendingLoginNames.set(ws, name);
    }

    consumePendingLoginName(ws: WebSocket): string | undefined {
        const name = this.pendingLoginNames.get(ws);
        this.pendingLoginNames.delete(ws);
        return name;
    }

    handleLoginMessage(ws: WebSocket, payload: any): void {
        const { username, password, revision } = payload;
        const normalizedUsername = (username || "").trim().toLowerCase();

        const sendLoginError = (errorCode: number, error: string) => {
            this.server.withDirectSendBypass("login_response", () =>
                this.server.sendWithGuard(
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

        const clientIp = this.server.getSocketRemoteAddress(ws) ?? "ws-unknown";
        logger.info(`Login attempt from: ${username} (${clientIp})`);

        // 0. Check client revision matches server
        const serverRevision = this.server.cacheEnv?.info?.revision ?? 0;
        if (serverRevision > 0 && revision !== serverRevision) {
            sendLoginError(6, "Please close the client and reload to update.");
            return;
        }

        // 1. Check rate limiting first
        if (this.server.checkLoginRateLimit(clientIp)) {
            sendLoginError(9, "Login limit exceeded. Please wait a minute.");
            return;
        }

        // 2. Check maintenance mode
        if (this.server.maintenanceMode) {
            sendLoginError(14, "The server is being updated. Please wait.");
            return;
        }

        // 3. Check world capacity
        if (this.server.isWorldFull()) {
            sendLoginError(2, "This world is full. Please use a different world.");
            return;
        }

        // 4. Validate username is not empty
        if (!normalizedUsername || normalizedUsername.length === 0) {
            sendLoginError(3, "Invalid username or password.");
            return;
        }

        // 5. Check if already logged in
        if (this.server.isPlayerAlreadyLoggedIn(normalizedUsername)) {
            sendLoginError(
                5,
                "Your account is already logged in. Try again in 60 seconds.",
            );
            return;
        }

        // All checks passed - login successful
        const displayName = (username ?? "").slice(0, 12);
        this.setPendingLoginName(ws, displayName);
        this.server.withDirectSendBypass("login_response", () =>
            this.server.sendWithGuard(
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

    handleHandshakeMessage(ws: WebSocket, payload: any): void {
        const parsed = { type: "handshake" as const, payload };
        try {
            const pendingLoginName = this.consumePendingLoginName(ws);
            const name = pendingLoginName || parsed.payload.name?.slice(0, 12) || undefined;

            const preliminarySaveKey = normalizePlayerAccountName(name);
            let p: PlayerState | undefined;
            let isReconnect = false;

            if (preliminarySaveKey && this.server.players?.hasOrphanedPlayer(preliminarySaveKey)) {
                p = this.server.players.reconnectOrphanedPlayer(ws, preliminarySaveKey);
                if (p) {
                    isReconnect = true;
                    logger.info(
                        `[handshake] Player ${name} reconnected to orphaned session (id=${p.id})`,
                    );
                }
            }

            if (!p) {
                const spawn = this.server.gamemode.getSpawnLocation(undefined as any);
                const spawnX = spawn.x,
                    spawnY = spawn.y,
                    level = spawn.level;
                p = this.server.players?.add(ws, spawnX, spawnY, level);
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
                        this.server.widgetDialogHandler.handleWidgetCloseState(p!, action.groupId);
                    }
                    this.server.queueWidgetEvent(p!.id, action);
                });

                if (!isReconnect) {
                    this.server.actionScheduler.registerPlayer(p);
                }

                p.setItemDefResolver((id) => getItemDefinition(id));

                p.onDeath = () => {
                    if (this.server.playerDeathService) {
                        this.server.playerDeathService.startPlayerDeath(p!);
                    }
                };

                const appearance =
                    parsed.payload.appearance !== undefined
                        ? this.server.sanitizeHandshakeAppearance(parsed.payload.appearance)
                        : this.server.createDefaultAppearance();

                if (!isReconnect) {
                    p.name = name ?? "";
                    p.appearance = appearance;
                    this.server.ensureEquipArray(p);
                    this.server.refreshAppearanceKits(p);
                    this.server.refreshCombatWeaponCategory(p);
                    p.attackDelay = this.server.pickAttackSpeed(p);
                    const saveKey = this.server.getPlayerSaveKey(name, p.id);
                    p.__saveKey = saveKey;
                    try {
                        this.server.playerPersistence.applyToPlayer(p, saveKey);
                    } catch (err) {
                        logger.warn("[player] failed to apply persistent vars", err);
                    }
                    try {
                        if (!this.server.playerPersistence.hasKey(saveKey)) {
                            p.accountStage = 0;
                        } else if (!Number.isFinite(p.accountStage)) {
                            p.accountStage = 1;
                        }
                    } catch {
                        if (!Number.isFinite(p.accountStage)) p.accountStage = 1;
                    }
                    try {
                        this.server.gamemode.resolveAccountStage?.(p);
                    } catch (err) {
                        logger.warn("[handshake] resolveAccountStage failed", err);
                    }
                    p.setRunToggle(true);
                    try {
                        this.server.refreshAppearanceKits(p);
                        this.server.refreshCombatWeaponCategory(p);
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
                    this.server.followerManager?.restoreFollowerForPlayer(p);
                } catch (err) {
                    logger.warn("[follower] failed to restore player follower", err);
                }

                // Unlock all achievement diaries
                const DIARY_VARBITS: Array<[number, number]> = [
                    // === STARTED FLAGS (1 = started) ===
                    [3576, 1], // Karamja (atjun_started)
                    [4448, 1], // Ardougne
                    [4449, 1], // Falador
                    [4450, 1], // Fremennik
                    [4451, 1], // Kandarin
                    [4452, 1], // Desert
                    [4453, 1], // Lumbridge
                    [4454, 1], // Morytania
                    [4455, 1], // Varrock
                    [4456, 1], // Western
                    [4457, 1], // Wilderness
                    [7924, 1], // Kourend

                    // === COMPLETION FLAGS (1 = complete) ===
                    // Ardougne
                    [4458, 1],
                    [4459, 1],
                    [4460, 1],
                    [4461, 1],
                    // Desert
                    [4483, 1],
                    [4484, 1],
                    [4485, 1],
                    [4486, 1],
                    // Falador
                    [4462, 1],
                    [4463, 1],
                    [4464, 1],
                    [4465, 1],
                    // Fremennik
                    [4491, 1],
                    [4492, 1],
                    [4493, 1],
                    [4494, 1],
                    // Kandarin
                    [4475, 1],
                    [4476, 1],
                    [4477, 1],
                    [4478, 1],
                    // Karamja (atjun)
                    // OSRS CS2 parity: these "done" varbits use value 2 when complete.
                    [3578, 2],
                    [3599, 2],
                    [3611, 2],
                    [4566, 1],
                    // Kourend
                    [7925, 1],
                    [7926, 1],
                    [7927, 1],
                    [7928, 1],
                    // Lumbridge
                    [4495, 1],
                    [4496, 1],
                    [4497, 1],
                    [4498, 1],
                    // Morytania
                    [4487, 1],
                    [4488, 1],
                    [4489, 1],
                    [4490, 1],
                    // Varrock
                    [4479, 1],
                    [4480, 1],
                    [4481, 1],
                    [4482, 1],
                    // Western
                    [4471, 1],
                    [4472, 1],
                    [4473, 1],
                    [4474, 1],
                    // Wilderness
                    [4466, 1],
                    [4467, 1],
                    [4468, 1],
                    [4469, 1],

                    // === TASK COUNTS (set to max required for each tier) ===
                    // Karamja: easy=10, med=19, hard=10, elite=5
                    [2423, 10],
                    [6288, 19],
                    [6289, 10],
                    [6290, 5],
                    // Ardougne: easy=10, med=12, hard=12, elite=8
                    [6291, 10],
                    [6292, 12],
                    [6293, 12],
                    [6294, 8],
                    // Desert: easy=11, med=12, hard=10, elite=6
                    [6295, 11],
                    [6296, 12],
                    [6297, 10],
                    [6298, 6],
                    // Falador: easy=11, med=14, hard=11, elite=6
                    [6299, 11],
                    [6300, 14],
                    [6301, 11],
                    [6302, 6],
                    // Fremennik: easy=10, med=9, hard=9, elite=6
                    [6303, 10],
                    [6304, 9],
                    [6305, 9],
                    [6306, 6],
                    // Kandarin: easy=11, med=14, hard=11, elite=7
                    [6307, 11],
                    [6308, 14],
                    [6309, 11],
                    [6310, 7],
                    // Lumbridge: easy=12, med=12, hard=11, elite=6
                    [6311, 12],
                    [6312, 12],
                    [6313, 11],
                    [6314, 6],
                    // Morytania: easy=11, med=11, hard=10, elite=6
                    [6315, 11],
                    [6316, 11],
                    [6317, 10],
                    [6318, 6],
                    // Varrock: easy=14, med=13, hard=10, elite=5
                    [6319, 14],
                    [6320, 13],
                    [6321, 10],
                    [6322, 5],
                    // Wilderness: easy=12, med=11, hard=10, elite=7
                    [6323, 12],
                    [6324, 11],
                    [6325, 10],
                    [6326, 7],
                    // Western: easy=11, med=13, hard=13, elite=7
                    [6327, 11],
                    [6328, 13],
                    [6329, 13],
                    [6330, 7],
                    // Kourend: easy=12, med=13, hard=10, elite=8
                    [7933, 12],
                    [7934, 13],
                    [7935, 10],
                    [7936, 8],

                    // === REWARD FLAGS (1 = claimed) ===
                    // Karamja: easy=3577, med=3598, hard=3610, elite=4567
                    [3577, 1],
                    [3598, 1],
                    [3610, 1],
                    [4567, 1],
                    // Ardougne: easy=4499, med=4500, hard=4501, elite=4502
                    [4499, 1],
                    [4500, 1],
                    [4501, 1],
                    [4502, 1],
                    // Falador: easy=4503, med=4504, hard=4505, elite=4506
                    [4503, 1],
                    [4504, 1],
                    [4505, 1],
                    [4506, 1],
                    // Wilderness: easy=4507, med=4508, hard=4509, elite=4510
                    [4507, 1],
                    [4508, 1],
                    [4509, 1],
                    [4510, 1],
                    // Western: easy=4511, med=4512, hard=4513, elite=4514
                    [4511, 1],
                    [4512, 1],
                    [4513, 1],
                    [4514, 1],
                    // Kandarin: easy=4515, med=4516, hard=4517, elite=4518
                    [4515, 1],
                    [4516, 1],
                    [4517, 1],
                    [4518, 1],
                    // Varrock: easy=4519, med=4520, hard=4521, elite=4522
                    [4519, 1],
                    [4520, 1],
                    [4521, 1],
                    [4522, 1],
                    // Desert: easy=4523, med=4524, hard=4525, elite=4526
                    [4523, 1],
                    [4524, 1],
                    [4525, 1],
                    [4526, 1],
                    // Morytania: easy=4527, med=4528, hard=4529, elite=4530
                    [4527, 1],
                    [4528, 1],
                    [4529, 1],
                    [4530, 1],
                    // Fremennik: easy=4531, med=4532, hard=4533, elite=4534
                    [4531, 1],
                    [4532, 1],
                    [4533, 1],
                    [4534, 1],
                    // Lumbridge: easy=4535, med=4536, hard=4537, elite=4538
                    [4535, 1],
                    [4536, 1],
                    [4537, 1],
                    [4538, 1],
                    // Kourend: easy=7929, med=7930, hard=7931, elite=7932
                    [7929, 1],
                    [7930, 1],
                    [7931, 1],
                    [7932, 1],
                ];
                for (const [varbitId, value] of DIARY_VARBITS) {
                    p.setVarbitValue(varbitId, value);
                }

                const handshakeAppearance = p.appearance;
                const handshakeName = this.server.getAppearanceDisplayName(p) || name;
                const handshakeChatIcons = this.server.isAdminPlayer(p)
                    ? [ADMIN_CROWN_ICON]
                    : undefined;
                this.server.withDirectSendBypass("handshake_ack", () =>
                    this.server.sendWithGuard(
                        ws,
                        encodeMessage({
                            type: "handshake",
                            payload: {
                                id: p.id,
                                name: handshakeName,
                                appearance: handshakeAppearance,
                                chatIcons: handshakeChatIcons,
                            } as any,
                        }),
                        "handshake_ack",
                    ),
                );
                this.server.sendAnimUpdate(ws, p);
                this.server.sendInventorySnapshotImmediate(ws, p);
                p.requestFullSkillSync();
                this.server.sendSkillsSnapshotImmediate(ws, p);
                this.server.sendCombatState(ws, p);
                this.server.sendRunEnergyState(ws, p);
                this.server.sendSavedTransmitVarps(ws, p);
                this.server.sendCollectionLogDisplayVarps(ws, p);
                this.server.sendSavedAutocastTransmitVarbits(ws, p);
                this.server.syncAccountTypeVarbit(ws, p);
                const sideJournalState = this.server.normalizeSideJournalState(p);
                this.server.withDirectSendBypass("varp", () =>
                    this.server.sendWithGuard(
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
                this.server.withDirectSendBypass("varbit", () =>
                    this.server.sendWithGuard(
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
                    this.server.withDirectSendBypass("varbit", () =>
                        this.server.sendWithGuard(
                            ws,
                            encodeMessage({
                                type: "varbit",
                                payload: { varbitId, value },
                            }),
                            "varbit",
                        ),
                    );
                }

                const contentDataPacket = this.server.gamemode.getContentDataPacket?.();
                if (contentDataPacket) {
                    this.server.withDirectSendBypass("gamemode_data", () =>
                        this.server.sendWithGuard(ws, contentDataPacket, "gamemode_data"),
                    );
                }

                this.server.gamemode.onPlayerHandshake(p, {
                    sendVarp: (varpId, value) =>
                        this.server.withDirectSendBypass("varp", () =>
                            this.server.sendWithGuard(ws, encodeMessage({
                                type: "varp",
                                payload: { varpId, value },
                            }), "varp"),
                        ),
                    sendVarbit: (varbitId, value) =>
                        this.server.withDirectSendBypass("varbit", () =>
                            this.server.sendWithGuard(ws, encodeMessage({
                                type: "varbit",
                                payload: { varbitId, value },
                            }), "varbit"),
                        ),
                    queueVarp: (playerId, varpId, value) =>
                        this.server.queueVarp(playerId, varpId, value),
                    queueVarbit: (playerId, varbitId, value) =>
                        this.server.queueVarbit(playerId, varbitId, value),
                    queueNotification: (playerId, notification) =>
                        this.server.queueNotification(playerId, notification),
                });

                const clientType = parsed.payload.clientType;
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
                        this.server.withDirectSendBypass("runClientScript", () =>
                            this.server.sendWithGuard(
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
                    this.server.queueWidgetEvent(p.id, {
                        action: "set_root",
                        groupId: rootInterfaceGroupId,
                    });

                    p.displayMode = displayMode;

                    const accountStage = p.accountStage;
                    const tutorialActive = this.server.gamemode.isTutorialActive(p);
                    const tutorialMode = accountStage >= 1 && tutorialActive;
                    const charCreationMode = accountStage === 0;
                    const preStartMode = charCreationMode || (this.server.gamemode.isTutorialPreStart?.(p) ?? false);

                    const interfaces = getDefaultInterfaces(displayMode, {
                        tutorialMode: tutorialMode || charCreationMode,
                    });
                    const filteredInterfaces = preStartMode
                        ? interfaces.filter((i: { groupId: number }) => i.groupId !== 629)
                        : interfaces;
                    const xpDropsEnabled = p.getVarbitValue(VARBIT_XPDROPS_ENABLED) === 1;
                    for (const intf of filteredInterfaces) {
                        const questVarps: Record<number, number> = {};
                        const questVarbits: Record<number, number> = {};
                        if (intf.groupId === SIDE_JOURNAL_GROUP_ID) {
                            const gamemodeSideJournalBootstrap =
                                this.server.gamemodeUi?.getSideJournalBootstrapState(p)
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
                        this.server.queueWidgetEvent(p.id, {
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
                            this.server.queueSideJournalGamemodeUi(p);
                        }
                    }
                    if (tutorialMode && !preStartMode) {
                        this.server.queueActivateQuestSideTab(p.id);
                    }
                    if (p.accountStage >= 1 && this.server.gamemode.isTutorialActive(p)) {
                        this.server.gamemodeUi?.queueTutorialOverlay(p);
                    }

                    // OSRS Parity: IF_SETEVENTS for inventory widget slots
                    const INVENTORY_GROUP_ID = 149;
                    const INVENTORY_CONTAINER_COMPONENT = 0;
                    const INVENTORY_SLOT_COUNT = 28;
                    const INVENTORY_FLAGS = 1181694;

                    this.server.queueWidgetEvent(p.id, {
                        action: "set_flags_range",
                        uid: (INVENTORY_GROUP_ID << 16) | INVENTORY_CONTAINER_COMPONENT,
                        fromSlot: 0,
                        toSlot: INVENTORY_SLOT_COUNT - 1,
                        flags: INVENTORY_FLAGS,
                    });

                    // OSRS Parity: IF_SETEVENTS for prayer filter dynamic rows
                    const PRAYER_GROUP_ID = 541;
                    const PRAYER_FILTER_COMPONENT = 42;
                    const PRAYER_FILTER_SLOT_START = 0;
                    const PRAYER_FILTER_SLOT_END = 4;
                    const PRAYER_FILTER_FLAGS = 1 << 1;

                    this.server.queueWidgetEvent(p.id, {
                        action: "set_flags_range",
                        uid: (PRAYER_GROUP_ID << 16) | PRAYER_FILTER_COMPONENT,
                        fromSlot: PRAYER_FILTER_SLOT_START,
                        toSlot: PRAYER_FILTER_SLOT_END,
                        flags: PRAYER_FILTER_FLAGS,
                    });

                    // OSRS Parity: IF_SETEVENTS for equipment widget slots
                    const EQUIPMENT_GROUP_ID = 387;
                    const EQUIPMENT_SLOT_START = 15;
                    const EQUIPMENT_SLOT_END = 25;
                    const EQUIPMENT_FLAGS = 62;

                    for (
                        let comp = EQUIPMENT_SLOT_START;
                        comp <= EQUIPMENT_SLOT_END;
                        comp++
                    ) {
                        this.server.queueWidgetEvent(p.id, {
                            action: "set_flags_range",
                            uid: (EQUIPMENT_GROUP_ID << 16) | comp,
                            fromSlot: -1,
                            toSlot: -1,
                            flags: EQUIPMENT_FLAGS,
                        });
                    }

                    // OSRS Parity: IF_SETEVENTS for quest list dynamic children
                    const QUEST_LIST_GROUP_ID = 399;
                    const QUEST_LIST_COMPONENT = 7;
                    const QUEST_LIST_MAX_SLOT = 199;
                    const QUEST_LIST_FLAGS = 0x7e;

                    this.server.queueWidgetEvent(p.id, {
                        action: "set_flags_range",
                        uid: (QUEST_LIST_GROUP_ID << 16) | QUEST_LIST_COMPONENT,
                        fromSlot: 0,
                        toSlot: QUEST_LIST_MAX_SLOT,
                        flags: QUEST_LIST_FLAGS,
                    });
                }

                if (p.accountStage === 0) {
                    try {
                        const { getMainmodalUid } = require("../widgets/WidgetManager");
                        const targetUid = getMainmodalUid(p.displayMode);
                        p.widgets.open(679, { targetUid, type: 0 });
                    } catch (err) {
                        logger.warn("[handshake] failed to open char creation widget", err);
                    }
                }

                try {
                    if (p.accountStage >= 1 && this.server.gamemode.isTutorialActive(p)) {
                        const spawn = this.server.gamemode.getSpawnLocation(p);
                        p.teleport(spawn.x, spawn.y, spawn.level);
                    }
                } catch (err) {
                    logger.warn("[handshake] tutorial spawn teleport failed", err);
                }

                this.server.gamemode.onPlayerRestore?.(p);

                const startTileX = p.tileX;
                const startTileY = p.tileY;
                const startLevel = p.level;
                logger.info(
                    `Handshake ok id=${p.id} spawn=(${startTileX},${startTileY},L${startLevel})`,
                );
                const appearanceSnapshot = p.appearance;
                this.server.queueAppearanceSnapshot(p, {
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

                this.server.queueChatMessage({
                    messageType: "server",
                    text: "Welcome to Old School Runescape!",
                    targetPlayerIds: [p.id],
                });

                if (this.server.npcManager && p) {
                    const player = p;
                    try {
                        const nearby = this.server.npcManager.getNearby(
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
                            const snap = this.server.npcSyncManager.serializeNpcSnapshot(npc);
                            player.visibleNpcIds.add(snap.id);
                            this.server.npcSyncManager.queueNpcSnapshot(player.id, snap);
                        }
                    } catch (err) {
                        logger.warn("[NpcManager] snapshot send failed", err);
                    }
                }

                this.server.maybeReplayDynamicLocState(ws, p, true);
            }
        } catch (err) {
            logger.warn("[handshake] handleHandshakeMessage error:", err);
        }
    }

    onConnection(ws: WebSocket): void {
        logger.info("Client connected");
        this.server.playerSyncSessions.set(ws, new PlayerSyncSession());
        this.server.withDirectSendBypass("welcome_packet", () =>
            this.server.sendWithGuard(
                ws,
                encodeMessage({
                    type: "welcome",
                    payload: { tickMs: this.server.options.tickMs, serverTime: Date.now() },
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
                        if (this.server.messageRouter.dispatch(ws, decoded)) {
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
                            const p = this.server.players?.get(ws);
                            if (!p) continue;
                            const ap = packet as AppearanceSetPacket;

                            const appearance = this.server.getOrCreateAppearance(p);
                            appearance.gender = ap.gender === 1 ? 1 : 0;
                            appearance.kits = new Array<number>(7).fill(-1);
                            appearance.colors = new Array<number>(5).fill(0);
                            for (let i = 0; i < 7 && i < ap.kits.length; i++) {
                                appearance.kits[i] = ap.kits[i];
                            }
                            for (let i = 0; i < 5 && i < ap.colors.length; i++) {
                                appearance.colors[i] = ap.colors[i];
                            }

                            this.server.refreshAppearanceKits(p);
                            p.markAppearanceDirty();
                            this.server.queueAppearanceSnapshot(p);

                            p.accountStage = 1;
                            try {
                                const key = p.__saveKey;
                                if (key && key.length > 0) {
                                    this.server.playerPersistence.saveSnapshot(key, p);
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
                                this.server.gamemode.onPostDesignComplete?.(p);
                                const spawn = this.server.gamemode.getSpawnLocation(p);
                                this.server.teleportPlayer(p, spawn.x, spawn.y, spawn.level);
                                const name = p.name;
                                const appearanceSnapshot = p.appearance;
                                this.server.queueAppearanceSnapshot(p, {
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

                            if (this.server.gamemode.isTutorialActive(p)) {
                                this.server.gamemodeUi?.queueTutorialOverlay(p, { queueFlashsideVarbitOnStep3: true });
                            } else {
                                p.accountStage = 2;
                                const displayMode = p.displayMode ?? 1;
                                const { getDefaultInterfaces: getDefIntf } = require("../widgets/WidgetManager");
                                const allInterfaces = getDefIntf(displayMode);
                                for (const intf of allInterfaces) {
                                    this.server.queueWidgetEvent(p.id, {
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

                        if (!msg && this.server.handleExaminePacket(ws, packet)) {
                            continue;
                        }

                        if (msg) {
                            if (this.server.messageRouter.dispatch(ws, msg)) {
                                continue;
                            }
                            this.server.messageRouter.dispatch(ws, msg) || logger.info(`[binary] Unhandled: ${msg.type}`);
                        }
                    }
                    return;
                }
            }

            if (!binaryParsed) {
                console.warn("[ws] Received non-binary message, ignoring");
                return;
            }
            const parsed = binaryParsed;

            if (this.server.messageRouter.dispatch(ws, parsed)) {
                return;
            }

            if (parsed.type === "login") {
                this.handleLoginMessage(ws, parsed.payload);
                return;
            } else if (parsed.type === "handshake") {
                this.handleHandshakeMessage(ws, parsed.payload);
                return;
            } else {
                this.server.messageRouter.dispatch(ws, parsed) || logger.info(`[binary] Unhandled: ${parsed.type}`);
            }
        });

        ws.on("close", () => {
            try {
                this.server.movementService.getPendingWalkCommands().delete(ws);
                const player = this.server.players?.get(ws);
                const id = player?.id;
                if (player) {
                    if (id !== undefined) {
                        this.server.groundItemHandler?.clearPlayerState(id);
                        this.server.playerDynamicLocSceneKeys.delete(id);
                    }
                    this.server.dismissLevelUpPopupQueue(player.id);
                    this.server.clearUiTrackingForPlayer(player.id);
                    this.server.tradeManager?.handlePlayerLogout(
                        player,
                        "The other player has declined the trade.",
                    );
                    if (id !== undefined) {
                        this.server.widgetDialogHandler.cleanupPlayerDialogState(id);
                    }
                    this.server.scriptRuntime.getServices().closeShop?.(player);
                    this.server.interfaceService?.onPlayerDisconnect(player);
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

                    this.server.sailingInstanceManager?.disposeInstance(player);
                    this.server.worldEntityInfoEncoder.removePlayer(player.id);

                    const saveKey =
                        player.__saveKey ?? this.server.getPlayerSaveKey(player.name, player.id);

                    const currentTick = this.server.options.ticker.currentTick();
                    const wasOrphaned = this.server.players?.orphanPlayer(ws, saveKey, currentTick);

                    if (wasOrphaned) {
                        logger.info(
                            `[disconnect] Player ${id} orphaned (in combat) - staying in world`,
                        );
                    } else {
                        try {
                            this.server.playerPersistence.saveSnapshot(saveKey, player);
                        } catch (err) {
                            logger.warn("[persist] failed to save player state", err);
                        }
                        this.server.followerCombatManager?.resetPlayer(player.id);
                        this.server.followerManager?.despawnFollowerForPlayer(player.id, false);
                        this.server.players?.remove(ws);
                        if (id != null) this.server.actionScheduler.unregisterPlayer(id);
                        if (id != null) logger.info(`Client disconnected id=${id}`);
                        else logger.info("Client disconnected");
                    }
                } else {
                    this.server.players?.remove(ws);
                    logger.info("Client disconnected (no player)");
                }
            } catch {
                logger.info("Client disconnected");
            }
            this.server.playerSyncSessions.delete(ws);
            this.server.npcSyncSessions.delete(ws);
        });
        ws.on("error", (err) => logger.warn("Client error:", err));
    }
}
