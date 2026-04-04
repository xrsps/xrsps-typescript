/**
 * Message Handlers - Extracted from wsServer.ts
 *
 * This file contains all non-auth message handlers.
 * Auth handlers (login, logout, handshake) remain in wsServer.ts for now.
 */
import type { WebSocket } from "ws";

import { MAX_REAL_LEVEL, SkillId, getXpForLevel } from "../../../src/rs/skill/skills";
import {
    MODIFIER_FLAG_CTRL,
    MODIFIER_FLAG_CTRL_SHIFT,
} from "../../../src/shared/input/modifierFlags";
import { getItemDefinition } from "../data/items";
import { ALL_RUNE_ITEM_IDS, RUNE_IDS } from "../data/runes";
import { getSpellData } from "../data/spells";
import { getCollectionLogItems } from "../game/collectionlog";
import { clearAutocastState } from "../game/combat/AutocastState";
import type { NpcState } from "../game/npc";
import type { PlayerState } from "../game/player";
import type { NpcSpawnConfig } from "../game/npc";
import type { ScriptDialogRequest } from "../game/scripts/types";
import type { WidgetAction } from "../widgets/WidgetManager";
import type { WorldEntityBuildArea } from "../../../src/shared/worldentity/WorldEntityTypes";
import type { WorldEntityMaskUpdate, WorldEntityPosition } from "./encoding/WorldEntityInfoEncoder";
import {
    type BoatLoc,
    SAILING_WORLD_ENTITY_CONFIG_ID,
    SAILING_WORLD_ENTITY_INDEX,
    SAILING_WORLD_ENTITY_SIZE_X,
    SAILING_WORLD_ENTITY_SIZE_Z,
} from "../game/sailing/SailingInstance";
import { logger } from "../utils/logger";
import type { MessageHandler, MessagePayload, MessageRouter } from "./MessageRouter";
import type { IndexedMenuRequest } from "./managers/Cs2ModalManager";
import type { ServerToClient } from "./messages";

const DEBUG_SCROLL_TITLE = "Clue Compass";
const DEBUG_SCROLL_OPTIONS = [
    "Arceuus Library",
    "Barrows",
    "Catherby",
    "Champions' Guild",
    "Draynor Village",
    "Falador Park",
    "Fishing Guild",
    "Hosidius Kitchen",
    "Karamja Volcano",
    "Lighthouse",
    "Lumbridge Swamp",
    "Mort'ton",
    "Musa Point",
    "Port Sarim",
    "Seers' Village",
    "Shayzien",
    "Varrock Palace",
    "Waterbirth Island",
    "Yanille",
    "Zanaris",
];

// ============================================================================
// Payload Interfaces
// ============================================================================

interface TeleportActionRequest {
    x: number;
    y: number;
    level: number;
    delayTicks?: number;
    cooldownTicks?: number;
    forceRebuild?: boolean;
    resetAnimation?: boolean;
    endSpotAnim?: number;
    endSpotHeight?: number;
    endSpotDelay?: number;
    arriveSoundId?: number;
    arriveSoundRadius?: number;
    arriveSoundVolume?: number;
    arriveMessage?: string;
    requireCanTeleport?: boolean;
    rejectIfPending?: boolean;
    replacePending?: boolean;
}

/**
 * Extended services interface for message handlers.
 * Provides access to wsServer functionality without coupling to the class directly.
 */
export interface MessageHandlerServices {
    // Player management
    getPlayer: (ws: WebSocket) => PlayerState | undefined;
    getPlayerById: (id: number) => PlayerState | undefined;
    startFollowing: (
        ws: WebSocket,
        targetId: number,
        mode: "follow" | "trade",
        modifierFlags?: number,
    ) => { ok: boolean; message?: string } | undefined;
    startLocInteract: (
        ws: WebSocket,
        opts: {
            id: number;
            tile: { x: number; y: number };
            level?: number;
            action?: string;
            modifierFlags?: number;
        },
        currentTick?: number,
    ) => void;
    clearAllInteractions: (ws: WebSocket) => void;
    startPlayerCombat: (ws: WebSocket, targetId: number) => void;

    // Trade
    handleTradeAction: (
        player: PlayerState,
        payload: MessagePayload<"trade_action">,
        tick: number,
    ) => void;

    // Movement
    setPendingWalkCommand: (
        ws: WebSocket,
        command: { to: { x: number; y: number }; run: boolean; enqueuedTick: number },
    ) => void;
    clearPendingWalkCommand: (ws: WebSocket) => void;
    clearActionsInGroup: (playerId: number, group: string) => number;
    canUseAdminTeleport: (player: PlayerState) => boolean;
    teleportPlayer: (
        player: PlayerState,
        x: number,
        y: number,
        level: number,
        forceRebuild?: boolean,
    ) => void;
    teleportToInstance: (
        player: PlayerState,
        x: number,
        y: number,
        level: number,
        templateChunks: number[][][],
        extraLocs?: Array<{ id: number; x: number; y: number; level: number; shape: number; rotation: number }>,
    ) => void;
    teleportToWorldEntity?: (
        player: PlayerState,
        x: number,
        y: number,
        level: number,
        entityIndex: number,
        configId: number,
        sizeX: number,
        sizeZ: number,
        templateChunks: number[][][],
        buildAreas: WorldEntityBuildArea[],
        extraLocs?: BoatLoc[],
    ) => void;
    sendWorldEntity?: (
        player: PlayerState,
        entityIndex: number,
        configId: number,
        sizeX: number,
        sizeZ: number,
        templateChunks: number[][][],
        buildAreas: WorldEntityBuildArea[],
        extraLocs?: BoatLoc[],
        extraNpcs?: Array<{ id: number; x: number; y: number; level: number }>,
        drawMode?: number,
    ) => void;
    spawnLocForPlayer: (
        player: PlayerState,
        locId: number,
        tile: { x: number; y: number },
        level: number,
        shape: number,
        rotation: number,
    ) => void;
    spawnNpc?: (config: NpcSpawnConfig) => NpcState | undefined;
    initSailingInstance?: (player: PlayerState) => void;
    disposeSailingInstance?: (player: PlayerState) => void;
    buildSailingDockedCollision?: () => void;
    removeWorldEntity?: (playerId: number, entityIndex: number) => void;
    queueWorldEntityPosition?: (playerId: number, entityIndex: number, position: WorldEntityPosition) => void;
    setWorldEntityPosition?: (playerId: number, entityIndex: number, position: WorldEntityPosition) => void;
    queueWorldEntityMask?: (playerId: number, entityIndex: number, mask: WorldEntityMaskUpdate) => void;
    applySailingDeckCollision?: () => void;
    clearSailingDeckCollision?: () => void;
    requestTeleportAction: (
        player: PlayerState,
        request: TeleportActionRequest,
    ) => { ok: boolean; reason?: string };
    sendVarp?: (player: PlayerState, varpId: number, value: number) => void;
    sendVarbit?: (player: PlayerState, varbitId: number, value: number) => void;
    sendSound?: (
        player: PlayerState,
        soundId: number,
        opts?: { loops?: number; delayMs?: number },
    ) => void;
    sendGameMessage: (player: PlayerState, text: string) => void;

    // Combat/NPC
    getNpcById: (npcId: number) => NpcState | undefined;
    startNpcAttack: (
        ws: WebSocket,
        npc: NpcState,
        tick: number,
        attackSpeed: number,
        modifierFlags?: number,
    ) => { ok: boolean; message?: string; chatMessage?: string };
    startNpcInteraction: (
        ws: WebSocket,
        npc: NpcState,
        option?: string,
        modifierFlags?: number,
    ) => { ok: boolean; message?: string } | undefined;
    pickAttackSpeed: (player: PlayerState) => number;
    startCombat: (player: PlayerState, npc: NpcState, tick: number, attackSpeed: number) => void;
    hasNpcOption: (npc: NpcState, option: string) => boolean;
    resolveNpcOption: (npc: NpcState, opNum: number) => string | undefined;
    resolveLocAction: (
        player: PlayerState | undefined,
        locId: number,
        opNum: number,
    ) => string | undefined;
    routePlayer: (ws: WebSocket, to: { x: number; y: number }, run: boolean, tick: number) => void;
    findPath: (opts: {
        from: { x: number; y: number; plane: number };
        to: { x: number; y: number };
        size: number;
    }) => { ok: boolean; waypoints?: Array<{ x: number; y: number }>; message?: string };
    edgeHasWallBetween: (x1: number, y1: number, x2: number, y2: number, level: number) => boolean;

    // Spells
    handleSpellCast: (
        ws: WebSocket,
        player: PlayerState,
        payload:
            | MessagePayload<"spell_cast_npc">
            | MessagePayload<"spell_cast_player">
            | MessagePayload<"spell_cast_loc">
            | MessagePayload<"spell_cast_obj">,
        targetType: "npc" | "player" | "loc" | "obj",
        tick: number,
    ) => void;
    handleSpellCastOnItem: (ws: WebSocket, payload: MessagePayload<"spell_cast_item">) => void;

    // Widget/Interface
    handleIfButtonD?: (player: PlayerState, payload: MessagePayload<"if_buttond">) => void;
    handleWidgetAction: (player: PlayerState, payload: MessagePayload<"widget_action">) => void;
    handleWidgetCloseState: (player: PlayerState, groupId: number) => void;
    openModal: (player: PlayerState, interfaceId: number, data?: unknown) => void;
    openIndexedMenu: (player: PlayerState, request: IndexedMenuRequest) => void;
    openSubInterface?: (
        player: PlayerState,
        targetUid: number,
        groupId: number,
        type?: number,
        opts?: { modal?: boolean },
    ) => void;
    openDialog?: (player: PlayerState, request: ScriptDialogRequest) => void;
    queueWidgetEvent: (playerId: number, event: WidgetAction) => void;
    queueVarp: (playerId: number, varpId: number, value: number) => void;
    queueVarbit: (playerId: number, varbitId: number, value: number) => void;
    queueClientScript?: (playerId: number, scriptId: number, ...args: (number | string)[]) => void;
    queueNotification: (playerId: number, notification: any) => void;
    trackCollectionLogItem: (player: PlayerState, itemId: number) => void;
    sendRunEnergyState: (ws: WebSocket, player: PlayerState) => void;
    getWeaponSpecialCostPercent: (weaponId: number) => number | undefined;
    queueCombatState: (player: PlayerState) => void;
    ensureEquipArray: (player: PlayerState) => number[];
    gamemodeServices: Record<string, unknown>;

    // Chat
    queueChatMessage: (msg: {
        messageType: "game" | "public" | "server";
        text: string;
        playerId?: number;
        from?: string;
        prefix?: string;
        playerType?: number;
        colorId?: number;
        effectId?: number;
        pattern?: number[];
        autoChat?: boolean;
        targetPlayerIds?: number[];
    }) => void;
    getPublicChatPlayerType: (player: PlayerState) => number;
    enqueueLevelUpPopup: (player: PlayerState, data: any) => void;
    findScriptCommand: (name: string) => ((event: { player: PlayerState; command: string; args: string[]; tick: number; services: any }) => string | void | Promise<string | void>) | undefined;
    getCurrentTick: () => number;

    // Debug
    broadcast: (message: string | Uint8Array, context: string) => void;
    sendWithGuard: (ws: WebSocket, message: string | Uint8Array, context: string) => void;
    sendAdminResponse: (ws: WebSocket, message: string | Uint8Array, context: string) => void;
    withDirectSendBypass: (context: string, fn: () => void) => void;
    encodeMessage: (msg: ServerToClient) => Uint8Array;
    setPendingDebugRequest: (requestId: number, ws: WebSocket) => void;
    getPendingDebugRequest: (requestId: number) => WebSocket | undefined;

    // Tick
    currentTick: () => number;

    // Constants/Config
    getEquipmentSlotWeapon: () => number;
    getVarpConstants: () => {
        VARP_SIDE_JOURNAL_STATE: number;
        VARP_OPTION_RUN: number;
        VARP_SPECIAL_ATTACK: number;
        VARP_ATTACK_STYLE: number;
        VARP_AUTO_RETALIATE: number;
        VARP_MAP_FLAGS_CACHED: number;
    };
    getVarbitConstants: () => {
        VARBIT_SIDE_JOURNAL_TAB: number;
    };
    getSideJournalConstants: () => {
        SIDE_JOURNAL_CONTENT_GROUP_BY_TAB: number[];
        SIDE_JOURNAL_TAB_CONTAINER_UID: number;
    };

}

const DEFAULT_CHAT_PREFIX = "";

function normalizeModifierFlags(raw: number | undefined): number {
    const normalized = raw ?? 0;
    if (normalized === MODIFIER_FLAG_CTRL_SHIFT) {
        return MODIFIER_FLAG_CTRL_SHIFT;
    }
    return (normalized & MODIFIER_FLAG_CTRL) !== 0 ? MODIFIER_FLAG_CTRL : 0;
}

function resolveRunWithModifier(baseRun: boolean, modifierFlags: number): boolean {
    let run = !!baseRun;
    if ((modifierFlags & MODIFIER_FLAG_CTRL) !== 0) {
        run = !run;
    }
    if (modifierFlags === MODIFIER_FLAG_CTRL_SHIFT) {
        run = true;
    }
    return run;
}

/**
 * Registers all non-auth message handlers with the router.
 */
export function registerMessageHandlers(
    router: MessageRouter,
    services: MessageHandlerServices,
): void {
    // =========================================================================
    // INTERACTION HANDLERS
    // =========================================================================

    router.register("interact", (ctx) => {
        const { mode = "follow", targetId, modifierFlags: rawModifierFlags } = ctx.payload;
        const modifierFlags = normalizeModifierFlags(rawModifierFlags);
        try {
            const res = services.startFollowing(ctx.ws, targetId, mode, modifierFlags);
            if (!res?.ok) {
                logger.info(`interact rejected: ${res?.message || "invalid"}`);
            }
        } catch {}
    });

    router.register("player_attack", (ctx) => {
        try {
            const player = ctx.player;
            if (!player) return;
            services.clearPendingWalkCommand(ctx.ws);
            const targetId = ctx.payload.playerId;
            if (targetId <= 0 || targetId === player.id) return;
            const target = services.getPlayerById(targetId);
            if (!target) {
                logger.info?.(`[combat] player ${targetId} not found for attack`);
                return;
            }
            services.startPlayerCombat(ctx.ws, target.id);
        } catch (err) {
            logger.warn("[combat] player_attack handling failed", err);
        }
    });

    router.register("loc_interact", (ctx) => {
        try {
            // Starting an interaction should consume any stale queued walk click.
            services.clearPendingWalkCommand(ctx.ws);
            const {
                id,
                tile,
                level,
                action: rawAction,
                opNum,
                modifierFlags: rawModifierFlags,
            } = ctx.payload;
            const modifierFlags = normalizeModifierFlags(rawModifierFlags);
            const actionFromOpNum =
                opNum !== undefined && opNum > 0
                    ? services.resolveLocAction(ctx.player, id, opNum)
                    : undefined;
            const action = rawAction && rawAction.length > 0 ? rawAction : actionFromOpNum;
            services.startLocInteract(
                ctx.ws,
                {
                    id,
                    tile,
                    level,
                    action,
                    modifierFlags,
                },
                services.currentTick(),
            );
        } catch {}
    });

    router.register("trade_action", (ctx) => {
        if (!ctx.player) return;
        try {
            services.handleTradeAction(ctx.player, ctx.payload, services.currentTick());
        } catch (err) {
            logger.warn("[trade] action handling failed", err);
        }
    });

    // =========================================================================
    // BANKING HANDLERS
    // =========================================================================

    router.register("resume_countdialog", (ctx) => {
        if (!ctx.player) return;
        const normalized = Math.max(
            -2147483648,
            Math.min(2147483647, Math.floor(ctx.payload.amount)),
        );
        ctx.player.setBankCustomQuantity(normalized);
        ctx.player.taskQueue.submitReturnValue(normalized);
    });

    router.register("resume_namedialog", (ctx) => {
        if (!ctx.player) return;
        ctx.player.taskQueue.submitReturnValue(ctx.payload.value);
    });

    router.register("resume_stringdialog", (ctx) => {
        if (!ctx.player) return;
        ctx.player.taskQueue.submitReturnValue(ctx.payload.value);
    });

    // =========================================================================
    // MOVEMENT HANDLERS
    // =========================================================================

    router.register("walk", (ctx) => {
        const to = ctx.payload.to;
        const modifierFlags = normalizeModifierFlags(ctx.payload.modifierFlags);

        if (!ctx.player) {
            logger.info("walk rejected: player not ready");
            return;
        }

        // Derive run state from server toggle and input flags
        const effectiveRun = ctx.player.resolveRequestedRun(
            resolveRunWithModifier(ctx.player.wantsToRun(), modifierFlags),
        );

        const nowTick = services.currentTick();
        services.setPendingWalkCommand(ctx.ws, {
            to: { x: to.x, y: to.y },
            run: effectiveRun,
            enqueuedTick: nowTick,
        });

        try {
            // OSRS: walking cancels active skilling loops immediately
            const removed = services.clearActionsInGroup(ctx.player.id, "skill.woodcut");
            if (removed > 0) {
                ctx.player.clearInteraction();
                ctx.player.stopAnimation();
            }
        } catch {}

        try {
            services.clearActionsInGroup(ctx.player.id, "inventory");
        } catch {}
    });

    router.register("teleport", (ctx) => {
        try {
            if (!ctx.player) return;
            if (!ctx.player.canMove()) return;
            if (!services.canUseAdminTeleport(ctx.player)) {
                services.queueChatMessage({
                    messageType: "game",
                    text: "Only admins can use world map teleports.",
                    targetPlayerIds: [ctx.player.id],
                });
                return;
            }
            const { to, level } = ctx.payload;
            const result = services.requestTeleportAction(ctx.player, {
                x: to.x,
                y: to.y,
                level: level ?? ctx.player.level,
                delayTicks: 0,
                cooldownTicks: 1,
                requireCanTeleport: false,
                rejectIfPending: true,
                replacePending: false,
            });
            if (!result.ok) {
                if (result.reason === "cooldown") {
                    services.queueChatMessage({
                        messageType: "game",
                        text: "You're already teleporting.",
                        targetPlayerIds: [ctx.player.id],
                    });
                }
                return;
            }
        } catch {}
    });

    router.register("face", (ctx) => {
        try {
            if (!ctx.player) return;
            const { rot, tile } = ctx.payload;
            if (rot !== undefined) {
                ctx.player.faceRot(rot);
            } else if (tile) {
                const tx = tile.x;
                const ty = tile.y;
                const targetX = (tx << 7) + 64;
                const targetY = (ty << 7) + 64;
                if (ctx.player.x !== targetX || ctx.player.y !== targetY) {
                    ctx.player.faceTile(tx, ty);
                }
            }
        } catch {}
    });

    router.register("pathfind", (ctx) => {
        const { id, from, to, size } = ctx.payload;
        const res = services.findPath({
            from,
            to,
            size: size ?? 1,
        });
        if (!res) {
            services.sendAdminResponse(
                ctx.ws,
                services.encodeMessage({
                    type: "path",
                    payload: { id, ok: false, message: "path service unavailable" },
                }),
                "admin_path_response",
            );
            return;
        }
        const t0 = Date.now();
        const dt = Date.now() - t0;
        try {
            logger.info(`pathfind request: ${dt}ms`);
        } catch {}
        services.sendAdminResponse(
            ctx.ws,
            services.encodeMessage({
                type: "path",
                payload: { id, ok: res.ok, waypoints: res.waypoints, message: res.message },
            }),
            "admin_path_response",
        );
    });

    // =========================================================================
    // COMBAT HANDLERS
    // =========================================================================

    router.register("npc_attack", (ctx) => {
        try {
            const { npcId } = ctx.payload;
            const npc = services.getNpcById(npcId);
            if (!npc) {
                logger.info?.(`[combat] npc ${npcId} not found for attack`);
                return;
            }
            const tick = services.currentTick();
            const attackSpeed = ctx.player ? services.pickAttackSpeed(ctx.player) : 4;
            const res = services.startNpcAttack(ctx.ws, npc, tick, attackSpeed);
            if (!res.ok) {
                logger.info?.(
                    `[combat] npc attack rejected: ${res.message || "no_path"} (npc=${npcId})`,
                );
                if (res.chatMessage && ctx.player) {
                    services.queueChatMessage({
                        messageType: "game",
                        text: res.chatMessage,
                        targetPlayerIds: [ctx.player.id],
                    });
                }
            } else if (ctx.player) {
                ctx.player.setInteraction("npc", npc.id);
                services.startCombat(ctx.player, npc, tick, attackSpeed);
            }
        } catch (err) {
            logger.warn("[combat] npc_attack handling failed", err);
        }
    });

    router.register("npc_interact", (ctx) => {
        try {
            // Starting an interaction should consume any stale queued walk click.
            services.clearPendingWalkCommand(ctx.ws);
            const {
                npcId,
                option: rawOption,
                opNum,
                modifierFlags: rawModifierFlags,
            } = ctx.payload;
            const npc = services.getNpcById(npcId);
            const player = ctx.player;
            if (!npc) {
                logger.info?.(`[npc] interact target ${npcId} not found`);
                return;
            }
            const optionFromOpNum =
                opNum !== undefined && opNum > 0
                    ? services.resolveNpcOption(npc, opNum)
                    : undefined;
            const option = rawOption && rawOption.length > 0 ? rawOption : optionFromOpNum;
            const modifierFlags = normalizeModifierFlags(rawModifierFlags);
            const optNorm = (option ?? "").trim().toLowerCase();
            logger.info?.(
                `[npc] recv npc_interact player=${player?.id ?? "?"} opt=${
                    option ?? "Talk-to"
                } npc=${npcId} type=${npc?.typeId ?? "?"} playerPos=(${player?.tileX ?? "?"},${
                    player?.tileY ?? "?"
                },${player?.level ?? "?"})`,
            );

            // OSRS parity: "Attack" is encoded as a regular NPC option packet (OPNPC*),
            // not a dedicated attack message, so route it through combat here.
            if (optNorm === "attack") {
                const tick = services.currentTick();
                const attackSpeed = ctx.player ? services.pickAttackSpeed(ctx.player) : 4;
                const res = services.startNpcAttack(ctx.ws, npc, tick, attackSpeed, modifierFlags);
                if (!res.ok) {
                    logger.info?.(
                        `[combat] npc attack rejected: ${res.message || "no_path"} (npc=${npcId})`,
                    );
                    if (res.chatMessage && ctx.player) {
                        services.queueChatMessage({
                            messageType: "game",
                            text: res.chatMessage,
                            targetPlayerIds: [ctx.player.id],
                        });
                    }
                } else if (ctx.player) {
                    ctx.player.setInteraction("npc", npc.id);
                    services.startCombat(ctx.player, npc, tick, attackSpeed);
                }
                return;
            }

            // Handle banking over the counter
            if (optNorm === "bank" && player) {
                const canBank = services.hasNpcOption(npc, "bank");
                if (canBank) {
                    const sameLevel = player.level === npc.level;
                    const px = player.tileX;
                    const py = player.tileY;
                    const tx = npc.tileX;
                    const ty = npc.tileY;
                    const size = Math.max(1, npc.size);
                    const minNx = tx;
                    const minNy = ty;
                    const maxNx = tx + size - 1;
                    const maxNy = ty + size - 1;
                    const dx = px < minNx ? minNx - px : px > maxNx ? px - maxNx : 0;
                    const dy = py < minNy ? minNy - py : py > maxNy ? py - maxNy : 0;
                    const dCheb = Math.max(dx, dy);

                    if (sameLevel && dCheb === 1) {
                        let canBankFromPos = false;
                        if (px >= minNx && px <= maxNx) {
                            const ny = py < minNy ? py + 1 : py > maxNy ? py - 1 : py;
                            const hasWall = services.edgeHasWallBetween(
                                px,
                                py,
                                px,
                                ny,
                                player.level,
                            );
                            if (!hasWall) canBankFromPos = true;
                        } else if (py >= minNy && py <= maxNy) {
                            const nx = px < minNx ? px + 1 : px > maxNx ? px - 1 : px;
                            const hasWall = services.edgeHasWallBetween(
                                px,
                                py,
                                nx,
                                py,
                                player.level,
                            );
                            if (!hasWall) canBankFromPos = true;
                        }

                        if (canBankFromPos) {
                            try {
                                services.startNpcInteraction(ctx.ws, npc, option, modifierFlags);
                            } catch {}
                            return;
                        } else {
                            const isCardinallyAligned =
                                (px >= minNx && px <= maxNx) || (py >= minNy && py <= maxNy);
                            if (isCardinallyAligned) {
                                services.queueChatMessage({
                                    messageType: "game",
                                    text: "I can't reach that.",
                                    targetPlayerIds: [player.id],
                                });
                                return;
                            }
                        }
                    }

                    // Route player to nearest tile around NPC
                    let routed = false;
                    for (let ringRadius = 1; ringRadius <= 4 && !routed; ringRadius++) {
                        const candidates: { x: number; y: number }[] = [];
                        for (let x = minNx - ringRadius; x <= maxNx + ringRadius; x++) {
                            candidates.push({ x, y: minNy - ringRadius });
                            candidates.push({ x, y: maxNx + ringRadius });
                        }
                        for (let y = minNy - ringRadius; y <= maxNy + ringRadius; y++) {
                            candidates.push({ x: minNx - ringRadius, y });
                            candidates.push({ x: maxNx + ringRadius, y });
                        }
                        const uniq = new Map<string, { x: number; y: number }>();
                        for (const c of candidates) uniq.set(`${c.x}|${c.y}`, c);
                        const sorted = Array.from(uniq.values()).sort((a, b) => {
                            const da = Math.max(Math.abs(a.x - px), Math.abs(a.y - py));
                            const db = Math.max(Math.abs(b.x - px), Math.abs(b.y - py));
                            return da - db;
                        });

                        for (const slot of sorted) {
                            const res = services.findPath({
                                from: { x: px, y: py, plane: player.level },
                                to: { x: slot.x, y: slot.y },
                                size: 1,
                            });
                            if (
                                res.ok &&
                                Array.isArray(res.waypoints) &&
                                res.waypoints.length > 0
                            ) {
                                const run = player.resolveRequestedRun(
                                    resolveRunWithModifier(player.wantsToRun(), modifierFlags),
                                );
                                services.routePlayer(
                                    ctx.ws,
                                    { x: slot.x, y: slot.y },
                                    run,
                                    services.currentTick(),
                                );
                                try {
                                    services.startNpcInteraction(
                                        ctx.ws,
                                        npc,
                                        option,
                                        modifierFlags,
                                    );
                                } catch {}
                                routed = true;
                                break;
                            }
                        }
                    }
                    if (!routed && sameLevel && dCheb <= 4) {
                        services.queueChatMessage({
                            messageType: "game",
                            text: "I can't reach that.",
                            targetPlayerIds: [player.id],
                        });
                        return;
                    }
                    if (routed) return;
                }
            }

            const res = services.startNpcInteraction(ctx.ws, npc, option, modifierFlags);
            if (!res?.ok) {
                logger.info?.(
                    `[npc] interaction rejected: ${res?.message || "invalid"} (npc=${npcId})`,
                );
            }
        } catch (err) {
            logger.warn("[npc] npc_interact handling failed", err);
        }
    });

    // =========================================================================
    // SPELL HANDLERS
    // =========================================================================

    router.register("spell_cast_npc", (ctx) => {
        try {
            if (ctx.player) {
                services.handleSpellCast(
                    ctx.ws,
                    ctx.player,
                    ctx.payload,
                    "npc",
                    services.currentTick(),
                );
            }
        } catch (err) {
            logger.warn("[combat] spell_cast_npc dispatch failed", err);
        }
    });

    router.register("spell_cast_player", (ctx) => {
        try {
            logger.info("[combat] Received spell_cast_player:", JSON.stringify(ctx.payload));
            if (ctx.player) {
                services.handleSpellCast(
                    ctx.ws,
                    ctx.player,
                    ctx.payload,
                    "player",
                    services.currentTick(),
                );
            }
        } catch (err) {
            logger.warn("[combat] spell_cast_player dispatch failed", err);
        }
    });

    router.register("spell_cast_loc", (ctx) => {
        try {
            if (ctx.player) {
                services.handleSpellCast(
                    ctx.ws,
                    ctx.player,
                    ctx.payload,
                    "loc",
                    services.currentTick(),
                );
            }
        } catch (err) {
            logger.warn("[combat] spell_cast_loc dispatch failed", err);
        }
    });

    router.register("spell_cast_obj", (ctx) => {
        try {
            if (ctx.player) {
                services.handleSpellCast(
                    ctx.ws,
                    ctx.player,
                    ctx.payload,
                    "obj",
                    services.currentTick(),
                );
            }
        } catch (err) {
            logger.warn("[combat] spell_cast_obj dispatch failed", err);
        }
    });

    router.register("spell_cast_item", (ctx) => {
        try {
            services.handleSpellCastOnItem(ctx.ws, ctx.payload);
        } catch (err) {
            logger.warn("[magic] spell_cast_item dispatch failed", err);
        }
    });

    // =========================================================================
    // WIDGET/INTERFACE HANDLERS
    // =========================================================================


    // NOTE: widget and varp_transmit handlers remain in wsServer.ts due to
    // complex tutorial logic that requires many wsServer dependencies

    // =========================================================================
    // DEBUG HANDLER
    // =========================================================================

    router.register("debug", (ctx) => {
        const payload = ctx.payload;
        const kind = payload.kind;

        if (kind === "projectiles_request") {
            const requestId = payload.requestId ?? Math.floor(Math.random() * 1e9);
            services.setPendingDebugRequest(requestId, ctx.ws);
            const message = services.encodeMessage({
                type: "debug",
                payload: { kind: "projectiles_request", requestId: requestId },
            });
            services.withDirectSendBypass("debug_proj_req", () =>
                services.broadcast(message, "debug_proj_req"),
            );
        } else if (kind === "projectiles_snapshot") {
            const reqId = payload.requestId;
            const requester = services.getPendingDebugRequest(reqId);
            if (requester && requester.readyState === 1) {
                try {
                    const forward = services.encodeMessage({
                        type: "debug",
                        payload: {
                            kind: "projectiles_snapshot",
                            requestId: reqId,
                            fromId: ctx.player ? ctx.player.id : undefined,
                            snapshot: payload.snapshot,
                        },
                    });
                    services.withDirectSendBypass("debug_proj_snapshot", () =>
                        services.sendWithGuard(requester, forward, "debug_proj_snapshot"),
                    );
                } catch (err) {
                    logger.warn("[debug] forward snapshot failed", err);
                }
            }
        } else if (kind === "anim_request") {
            const requestId = payload.requestId ?? Math.floor(Math.random() * 1e9);
            services.setPendingDebugRequest(requestId, ctx.ws);
            const message = services.encodeMessage({
                type: "debug",
                payload: { kind: "anim_request", requestId: requestId },
            });
            services.withDirectSendBypass("debug_anim_req", () =>
                services.broadcast(message, "debug_anim_req"),
            );
        } else if (kind === "anim_snapshot") {
            const reqId = payload.requestId;
            const requester = services.getPendingDebugRequest(reqId);
            if (requester && requester.readyState === 1) {
                try {
                    const forward = services.encodeMessage({
                        type: "debug",
                        payload: {
                            kind: "anim_snapshot",
                            requestId: reqId,
                            fromId: ctx.player ? ctx.player.id : undefined,
                            snapshot: payload.snapshot,
                        },
                    });
                    services.withDirectSendBypass("debug_anim_snapshot", () =>
                        services.sendWithGuard(requester, forward, "debug_anim_snapshot"),
                    );
                } catch (err) {
                    logger.warn("[debug] forward anim snapshot failed", err);
                }
            }
        } else if (kind === "set_var") {
            const target = ctx.player;
            if (target) {
                const value = payload.value ?? 0;
                let changed = false;
                if (payload.varbit !== undefined) {
                    const varbitId = payload.varbit;
                    if (varbitId >= 0) {
                        target.setVarbitValue(varbitId, value);
                        changed = true;
                    }
                }
                if (payload.varp !== undefined) {
                    const varpId = payload.varp;
                    if (varpId >= 0) {
                        target.setVarpValue(varpId, value);
                        changed = true;
                    }
                }
                if (changed) {
                    services.queueChatMessage({
                        messageType: "game",
                        text: `Debug: var set to ${value}.`,
                        targetPlayerIds: [target.id],
                    });
                }
            }
        }
    });

    // =========================================================================
    // CHAT HANDLER
    // =========================================================================

    router.register("chat", createChatHandler(services));
}

function pickRandomUnownedCollectionLogItemId(player: PlayerState): number | null {
    const candidates = Array.from(getCollectionLogItems()).filter(
        (itemId) => !player.hasCollectionItem(itemId),
    );
    if (candidates.length <= 0) {
        return null;
    }
    const index = Math.floor(Math.random() * candidates.length);
    return candidates[index] ?? null;
}

type InventoryLoadoutEntry = {
    itemId: number;
    quantity: number;
};

function replaceInventoryContents(
    player: PlayerState,
    entries: readonly InventoryLoadoutEntry[],
): boolean {
    const slotCount = player.getInventoryEntries().length;
    if (entries.length > slotCount) {
        return false;
    }

    player.clearInventory();
    for (let slot = 0; slot < entries.length; slot++) {
        const entry = entries[slot];
        if (!(entry?.itemId > 0) || !(entry.quantity > 0)) {
            continue;
        }
        player.setInventorySlot(slot, entry.itemId, entry.quantity);
    }

    return true;
}

// ========== Quest unlock data ==========
// Maps quest names to their varp ID and completion value.
// Varp-based quests set the varp to the completion value.
// Varbit-based quests use negative varpId as a signal (handled separately).
const QUEST_DATA: Array<{
    name: string;
    aliases: string[];
    varpId: number;
    completionValue: number;
    varbitEntries?: Array<{ varbitId: number; value: number }>;
    unlocks: string;
}> = [
    {
        name: "Desert Treasure",
        aliases: ["dt", "desert", "deserttreasure"],
        varpId: 440,
        completionValue: 15,
        unlocks: "Ancient Magicks spellbook",
    },
    {
        name: "Lunar Diplomacy",
        aliases: ["lunar", "lunardiplomacy"],
        varpId: 823,
        completionValue: 190,
        unlocks: "Lunar spellbook",
    },
    {
        name: "Legend's Quest",
        aliases: ["legends", "legendsquest"],
        varpId: 139,
        completionValue: 180,
        unlocks: "Charge spell",
    },
    {
        name: "Underground Pass",
        aliases: ["undergroundpass", "underground", "iban"],
        varpId: 161,
        completionValue: 110,
        varbitEntries: [{ varbitId: 9133, value: 1 }], // Iban book read
        unlocks: "Iban Blast",
    },
    {
        name: "Mage Arena",
        aliases: ["magearena", "ma1"],
        varpId: 267,
        completionValue: 8,
        unlocks: "God spells (Claws of Guthix, Flames of Zamorak, Saradomin Strike)",
    },
    {
        name: "Mage Arena II",
        aliases: ["magearena2", "ma2", "magearenaii"],
        varpId: -1, // varbit only
        completionValue: 0,
        varbitEntries: [{ varbitId: 6067, value: 6 }],
        unlocks: "Enhanced god spells",
    },
    {
        name: "Eadgar's Ruse",
        aliases: ["eadgar", "eadgarsruse", "eadgars"],
        varpId: 335,
        completionValue: 110,
        unlocks: "Trollheim Teleport",
    },
    {
        name: "Watchtower",
        aliases: ["watchtower"],
        varpId: 212,
        completionValue: 13,
        unlocks: "Watchtower Teleport",
    },
    {
        name: "Plague City",
        aliases: ["plaguecity", "plague"],
        varpId: 165,
        completionValue: 29,
        unlocks: "Ardougne Teleport (prerequisite)",
    },
    {
        name: "Biohazard",
        aliases: ["biohazard"],
        varpId: 68,
        completionValue: 16,
        unlocks: "Ardougne Teleport",
    },
    {
        name: "Client of Kourend",
        aliases: ["clientofkourend", "kourend", "cok"],
        varpId: -1,
        completionValue: 0,
        varbitEntries: [{ varbitId: 5619, value: 9 }],
        unlocks: "Kourend Castle Teleport",
    },
    {
        name: "Dream Mentor",
        aliases: ["dreammentor", "dream"],
        varpId: -1,
        completionValue: 0,
        varbitEntries: [{ varbitId: 3618, value: 28 }],
        unlocks: "Spellbook Swap, extra Lunar spells",
    },
    {
        name: "Arceuus Favour",
        aliases: ["arceuus", "arceuusfavour", "arceuusfavor"],
        varpId: -1,
        completionValue: 0,
        varbitEntries: [
            { varbitId: 4896, value: 1000 },
            { varbitId: 9631, value: 1 },
        ],
        unlocks: "Arceuus spellbook",
    },
];

function handleQuestCommand(
    sender: PlayerState,
    args: string[],
    services: Pick<MessageHandlerServices, "queueChatMessage" | "queueVarp" | "queueVarbit">,
): void {
    const reply = (text: string) =>
        services.queueChatMessage({
            messageType: "game",
            text,
            targetPlayerIds: [sender.id],
        });

    if (args.length === 0 || args[0] === "list") {
        reply("Available quests: " + QUEST_DATA.map((q) => q.name).join(", "));
        reply("Usage: ::quest <name> — e.g. ::quest desert treasure");
        return;
    }

    // Join args and normalize for matching
    const search = args.join("").toLowerCase().replace(/[^a-z0-9]/g, "");

    // Try alias match first, then fuzzy name match
    const quest =
        QUEST_DATA.find((q) => q.aliases.includes(search)) ??
        QUEST_DATA.find((q) => q.name.toLowerCase().replace(/[^a-z0-9]/g, "").includes(search));

    if (!quest) {
        reply(`Unknown quest "${args.join(" ")}". Use ::quest list to see available quests.`);
        return;
    }

    // Set varp if applicable
    if (quest.varpId >= 0) {
        sender.setVarpValue(quest.varpId, quest.completionValue);
        services.queueVarp(sender.id, quest.varpId, quest.completionValue);
    }

    // Set varbits if applicable
    if (quest.varbitEntries) {
        for (const { varbitId, value } of quest.varbitEntries) {
            sender.setVarbitValue(varbitId, value);
            services.queueVarbit(sender.id, varbitId, value);
        }
    }

    reply(`Completed "${quest.name}" — unlocks: ${quest.unlocks}`);
    logger.info(`[cmd] ::quest - Player ${sender.id} completed "${quest.name}"`);
}

/**
 * Creates the chat handler (complex, extracted for readability)
 */
function createChatHandler(services: MessageHandlerServices): MessageHandler<"chat"> {
    return (ctx) => {
        try {
            const payload = ctx.payload;
            const text = payload.text.trim();
            logger.info(`[chat] Received chat message: "${text}"`);
            if (!text) return;

            const sender = ctx.player;
            if (!sender) {
                logger.warn("[chat] No sender found for chat message");
                return;
            }

            // Handle :: commands
            if (text.startsWith("::")) {
                const cmd = text.slice(2).toLowerCase().trim();
                const senderName = sender.name || "Player";
                logger.info(`[cmd] Player ${sender.id} (${senderName}) used command: ::${cmd}`);
                const parts = cmd.split(/\s+/).filter((part) => part.length > 0);
                const root = parts[0] ?? "";

                if (root === "clear") {
                    try {
                        services.clearActionsInGroup(sender.id, "inventory");
                    } catch {}

                    sender.clearInventory();
                    services.queueChatMessage({
                        messageType: "game",
                        text: "Your inventory has been cleared.",
                        targetPlayerIds: [sender.id],
                    });
                    logger.info(`[cmd] ::clear - Cleared inventory for player ${sender.id}`);
                    return;
                }

                if (root === "allrunes") {
                    const quantityArg = parts[1];
                    const quantity =
                        quantityArg === undefined
                            ? 10000
                            : Math.floor(Number.parseInt(quantityArg, 10));
                    if (!Number.isFinite(quantity) || quantity <= 0) {
                        services.queueChatMessage({
                            messageType: "game",
                            text: "Usage: ::allrunes [quantity]",
                            targetPlayerIds: [sender.id],
                        });
                        return;
                    }

                    try {
                        services.clearActionsInGroup(sender.id, "inventory");
                    } catch {}

                    const runeLoadout: InventoryLoadoutEntry[] = ALL_RUNE_ITEM_IDS.map((itemId) => ({
                        itemId,
                        quantity,
                    }));
                    if (!replaceInventoryContents(sender, runeLoadout)) {
                        services.queueChatMessage({
                            messageType: "game",
                            text: "Unable to load ::allrunes into your inventory.",
                            targetPlayerIds: [sender.id],
                        });
                        return;
                    }

                    services.queueChatMessage({
                        messageType: "game",
                        text: `Replaced your inventory with all ${ALL_RUNE_ITEM_IDS.length} rune types x${quantity}.`,
                        targetPlayerIds: [sender.id],
                    });
                    logger.info(
                        `[cmd] ::${root} - Loaded player ${sender.id} inventory with ${ALL_RUNE_ITEM_IDS.length} rune types x${quantity}`,
                    );
                    return;
                }

                if (root === "randomitem") {
                    const itemId = pickRandomUnownedCollectionLogItemId(sender);
                    if (typeof itemId !== "number" || !Number.isFinite(itemId) || itemId <= 0) {
                        services.queueChatMessage({
                            messageType: "game",
                            text: "No unowned collection log items remain for ::randomitem.",
                            targetPlayerIds: [sender.id],
                        });
                        return;
                    }

                    const addResult = sender.addItem(itemId, 1, { assureFullInsertion: true });
                    if (addResult.completed !== 1) {
                        services.queueChatMessage({
                            messageType: "game",
                            text: "Not enough inventory space for ::randomitem.",
                            targetPlayerIds: [sender.id],
                        });
                        return;
                    }

                    services.trackCollectionLogItem(sender, itemId);

                    const itemName = getItemDefinition(itemId)?.name?.trim() || `Item ${itemId}`;
                    logger.info(
                        `[cmd] ::randomitem - Gave player ${sender.id} collection log item ${itemId} (${itemName})`,
                    );
                    return;
                }

                if (root === "smithing") {
                    const levelArgRaw = parts[1];
                    const levelArg = levelArgRaw ? parseInt(levelArgRaw, 10) : NaN;
                    if (!Number.isFinite(levelArg)) {
                        services.queueChatMessage({
                            messageType: "game",
                            text: "Usage: ::smithing <1-99>",
                            targetPlayerIds: [sender.id],
                        });
                        return;
                    }

                    const targetLevel = Math.min(MAX_REAL_LEVEL, Math.max(1, Math.floor(levelArg)));
                    const previousLevel = sender.getSkill(SkillId.Smithing).baseLevel;
                    sender.setSkillXp(SkillId.Smithing, getXpForLevel(targetLevel));

                    if (targetLevel > previousLevel) {
                        services.enqueueLevelUpPopup(sender, {
                            kind: "skill",
                            skillId: SkillId.Smithing,
                            newLevel: targetLevel,
                            levelIncrement: targetLevel - previousLevel,
                        });
                    }

                    services.queueChatMessage({
                        messageType: "game",
                        text: `Your Smithing level is now ${targetLevel}.`,
                        targetPlayerIds: [sender.id],
                    });
                    logger.info(
                        `[cmd] ::smithing - Player ${sender.id} set Smithing to ${targetLevel}`,
                    );
                    return;
                }

                if (root === "rubytest") {
                    const grants: Array<{ itemId: number; quantity: number }> = [
                        { itemId: 9339, quantity: 100 },
                        { itemId: RUNE_IDS.COSMIC, quantity: 20 },
                        { itemId: RUNE_IDS.FIRE, quantity: 100 },
                        { itemId: RUNE_IDS.BLOOD, quantity: 20 },
                    ];
                    const added: Array<{ itemId: number; quantity: number }> = [];

                    for (const grant of grants) {
                        const tx = sender.addItem(grant.itemId, grant.quantity, {
                            assureFullInsertion: true,
                        });
                        if (tx?.completed < grant.quantity) {
                            for (const prior of added) {
                                sender.removeItem(prior.itemId, prior.quantity, {
                                    assureFullRemoval: false,
                                });
                            }
                            services.queueChatMessage({
                                messageType: "game",
                                text: "Not enough inventory space for ::rubytest.",
                                targetPlayerIds: [sender.id],
                            });
                            return;
                        }
                        added.push({ itemId: grant.itemId, quantity: grant.quantity });
                    }

                    const beforeMagic = sender.getSkill(SkillId.Magic).baseLevel;
                    if (beforeMagic < 49) {
                        sender.setSkillXp(SkillId.Magic, getXpForLevel(49));
                    }

                    services.queueChatMessage({
                        messageType: "game",
                        text: "Ruby enchant test pack added: ruby bolts + runes (10 sets).",
                        targetPlayerIds: [sender.id],
                    });
                    logger.info(
                        `[cmd] ::rubytest - Gave player ${
                            sender.id
                        } ruby enchant test pack; magic ${beforeMagic}->${Math.max(
                            beforeMagic,
                            49,
                        )}`,
                    );
                    return;
                }

                if (root === "scroll") {
                    services.openIndexedMenu(sender, {
                        title: DEBUG_SCROLL_TITLE,
                        options: DEBUG_SCROLL_OPTIONS,
                        onSelect: (player, optionIndex, optionLabel) => {
                            services.queueChatMessage({
                                messageType: "game",
                                text: `Selected ${optionIndex + 1}: ${optionLabel}`,
                                targetPlayerIds: [player.id],
                            });
                            logger.info(
                                `[cmd] ::scroll - Player ${player.id} selected option ${
                                    optionIndex + 1
                                } (${optionLabel})`,
                            );
                        },
                    });
                    logger.info(
                        `[cmd] ::scroll - Opened menu_indexed test menu for player ${sender.id}`,
                    );
                    return;
                }

                if (root === "quest") {
                    handleQuestCommand(sender, parts.slice(1), services);
                    return;
                }

                if (root === "spawn") {
                    services.teleportPlayer(sender, 3222, 3218, 0);
                    services.queueChatMessage({
                        messageType: "game",
                        text: "Teleported to Lumbridge.",
                        targetPlayerIds: [sender.id],
                    });
                    logger.info(`[cmd] ::spawn - Player ${sender.id} teleported to Lumbridge`);
                    return;
                }

                if (root === "pos") {
                    services.queueChatMessage({
                        messageType: "game",
                        text: `Position: (${sender.tileX}, ${sender.tileY}, ${sender.level})`,
                        targetPlayerIds: [sender.id],
                    });
                    return;
                }

                if (cmd === "levelup") {
                    const skillIds = [
                        0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
                        22, 23,
                    ];
                    const randomSkill = skillIds[Math.floor(Math.random() * skillIds.length)];
                    const skill = sender.getSkill(randomSkill as SkillId);
                    const currentLevel = skill.baseLevel;
                    const newLevel = Math.min(99, currentLevel + 1);
                    if (newLevel > currentLevel && sender.setSkillXp) {
                        const newXp = getXpForLevel(newLevel);
                        sender.setSkillXp(randomSkill, newXp);
                        services.enqueueLevelUpPopup(sender, {
                            kind: "skill",
                            skillId: randomSkill,
                            newLevel: newLevel,
                            levelIncrement: 1,
                        });
                        logger.info(
                            `[cmd] ::levelup - Player ${sender.id} leveled up skill ${randomSkill} to ${newLevel}`,
                        );
                    }
                } else if (cmd === "whip") {
                    const tx = sender.addItem(4151, 1, { assureFullInsertion: true });
                    if (tx.completed === 1) {
                        logger.info(`[cmd] ::whip - Gave player ${sender.id} an Abyssal whip`);
                    }
                } else if (cmd === "bond") {
                    const tx = sender.addItem(50000, 1, { assureFullInsertion: true });
                    if (tx.completed === 1) {
                        logger.info(`[cmd] ::bond - Gave player ${sender.id} a $5 Bond`);
                    }
                } else if (cmd.startsWith("item ")) {
                    const parts = cmd.split(" ").filter((p) => p.length > 0);
                    const itemId = parseInt(parts[1], 10);
                    const quantity = parseInt(parts[2], 10) || 1;
                    if (Number.isFinite(itemId) && itemId > 0) {
                        const tx = sender.addItem(itemId, quantity, {
                            assureFullInsertion: false,
                        });
                        if (tx.completed > 0) {
                            logger.info(
                                `[cmd] ::item - Gave player ${sender.id} item ${itemId} x${tx.completed}`,
                            );
                        }
                    }
                } else if (cmd === "kill") {
                    logger.info(`[cmd] ::kill - Player ${sender.id} killed themselves`);
                    sender.setHitpointsCurrent(0);
                } else if (
                    root === "standard" ||
                    root === "ancient" ||
                    root === "lunar" ||
                    root === "arceuus"
                ) {
                    // Varbit 4070 controls the active spellbook in CS2 scripts
                    // 0 = standard, 1 = ancient, 2 = lunar, 3 = arceuus
                    // Note: "::normal" is intercepted client-side by the OSRS CS2 chatbox
                    // script (it toggles display mode), so we use "::standard" instead.
                    const VARBIT_ACTIVE_SPELLBOOK = 4070;
                    const SPELLBOOK_VALUES: Record<string, number> = {
                        standard: 0,
                        ancient: 1,
                        lunar: 2,
                        arceuus: 3,
                    };
                    const value = SPELLBOOK_VALUES[root]!;
                    // Update server-side state
                    sender.setVarbitValue(VARBIT_ACTIVE_SPELLBOOK, value);
                    // Transmit varbit to client
                    services.queueVarbit(sender.id, VARBIT_ACTIVE_SPELLBOOK, value);

                    // OSRS parity: Clear autocast when switching to a spellbook
                    // that doesn't contain the current autocast spell.
                    if (sender.autocastEnabled && sender.combatSpellId > 0) {
                        const autocastSpellData = getSpellData(sender.combatSpellId);
                        if (!autocastSpellData || autocastSpellData.spellbook !== root) {
                            clearAutocastState(sender, {
                                sendVarbit: (player, varbitId, varbitValue) =>
                                    services.queueVarbit(player.id, varbitId, varbitValue),
                            });
                        }
                    }
                    // Run CS2 script 2610 to redraw the spellbook interface,
                    // passing the varbit inline so the script sees it immediately
                    const SCRIPT_MAGIC_SPELLBOOK_REDRAW = 2610;
                    const SPELLBOOK_REDRAW_ARGS: (number | string)[] = [
                        14286851, 14287045, 14287054, 14286849, 14287051,
                        14287052, 14287053, 14286850, 14287047, 14287050,
                        0, "Info", "Filters",
                    ];
                    services.queueWidgetEvent(sender.id, {
                        action: "run_script",
                        scriptId: SCRIPT_MAGIC_SPELLBOOK_REDRAW,
                        args: SPELLBOOK_REDRAW_ARGS,
                        varbits: { [VARBIT_ACTIVE_SPELLBOOK]: value },
                    });
                    services.queueChatMessage({
                        messageType: "game",
                        text: `Switched to the ${root} spellbook.`,
                        targetPlayerIds: [sender.id],
                    });
                    logger.info(
                        `[cmd] ::${root} - Player ${sender.id} switched to ${root} spellbook`,
                    );
                    return;
                }

                // Fallthrough to script-registered commands
                const scriptCmd = services.findScriptCommand?.(root);
                if (scriptCmd) {
                    try {
                        const result = scriptCmd({
                            player: sender,
                            command: root,
                            args: parts.slice(1),
                            tick: services.getCurrentTick(),
                            services,
                        });
                        const response = typeof result === "string" ? result : undefined;
                        if (response?.trim()) {
                            services.queueChatMessage({
                                messageType: "game",
                                text: response.trim(),
                                targetPlayerIds: [sender.id],
                            });
                        }
                    } catch (err) {
                        logger.warn(`[cmd] script command ::${root} failed`, err);
                    }
                }
                return;
            }

            // Regular chat message
            const senderName = sender.name || "Player";
            const messageType = payload.messageType === "game" ? "game" : "public";
            const colorIdRaw = payload.colorId;
            const effectIdRaw = payload.effectId;
            let colorId =
                typeof colorIdRaw === "number" && Number.isFinite(colorIdRaw) && colorIdRaw >= 0
                    ? colorIdRaw & 0xff
                    : 0;
            let effectId =
                typeof effectIdRaw === "number" &&
                Number.isFinite(effectIdRaw) &&
                effectIdRaw >= 0
                    ? effectIdRaw & 0xff
                    : 0;
            if (effectId > 5) effectId = 0;
            if (colorId > 20) colorId = 0;

            const expectedExtraLen = colorId >= 13 && colorId <= 20 ? colorId - 12 : 0;
            let pattern: number[] | undefined = undefined;
            if (expectedExtraLen > 0 && Array.isArray(payload.pattern)) {
                const rawPattern = payload.pattern;
                const out: number[] = [];
                for (let i = 0; i < rawPattern.length && out.length < expectedExtraLen; i++) {
                    const v = rawPattern[i];
                    if (!Number.isFinite(v)) continue;
                    out.push(v & 0xff);
                }
                if (out.length === expectedExtraLen) pattern = out;
            }

            services.queueChatMessage({
                messageType,
                playerId: sender.id,
                from: senderName,
                prefix: DEFAULT_CHAT_PREFIX,
                text,
                playerType: services.getPublicChatPlayerType(sender),
                colorId,
                effectId,
                pattern,
                autoChat: false,
            });
        } catch (err) {
            logger.warn("[chat] message handling failed", err);
        }
    };
}
