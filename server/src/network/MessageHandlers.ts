/**
 * Message Handlers - Extracted from wsServer.ts
 *
 * This file contains the MessageHandlerServices interface and shared helper
 * functions used by the individual handler modules in ./handlers/.
 */
import type { WebSocket } from "ws";

import {
    MODIFIER_FLAG_CTRL,
    MODIFIER_FLAG_CTRL_SHIFT,
} from "../../../src/shared/input/modifierFlags";
import type { NpcState } from "../game/npc";
import type { PlayerState } from "../game/player";
import type { NpcSpawnConfig } from "../game/npc";
import type { ScriptDialogRequest, WidgetOpenHandler } from "../game/scripts/types";
import type { WidgetAction } from "../widgets/WidgetManager";
import type { WorldEntityBuildArea } from "../../../src/shared/worldentity/WorldEntityTypes";
import type { WorldEntityMaskUpdate, WorldEntityPosition } from "./encoding/WorldEntityInfoEncoder";
import type { BoatLoc } from "../game/sailing/SailingInstance";
import type { MessagePayload, MessageRouter } from "./MessageRouter";
import type { IndexedMenuRequest } from "./managers/Cs2ModalManager";
import type { NotificationPayload, ServerToClient } from "./messages";
import type { InterfaceService } from "../widgets/InterfaceService";
import type { GamemodeDefinition, GamemodeUiController } from "../game/gamemodes/GamemodeDefinition";

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
    queueNotification: (playerId: number, notification: NotificationPayload) => void;
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
    eventBus?: import("../game/events/GameEventBus").GameEventBus;
    findScriptCommand: (name: string) => ((event: { player: PlayerState; command: string; args: string[]; tick: number; services: Record<string, unknown> }) => string | void | Promise<string | void>) | undefined;
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

    // --- Services for extracted handlers (logout, widget, varp_transmit, if_close) ---
    completeLogout: (ws: WebSocket, player?: PlayerState, source?: string) => void;
    closeInterruptibleInterfaces: (player: PlayerState) => void;
    noteWidgetEventForLedger: (playerId: number, event: { action: string; groupId?: number; modal?: boolean }) => void;
    normalizeSideJournalState: (player: PlayerState, value?: number) => { tab: number; stateVarp: number };
    queueSideJournalGamemodeUi: (player: PlayerState) => void;
    syncMusicInterface: (player: PlayerState) => void;
    getWidgetOpenHandler: (groupId: number) => WidgetOpenHandler | undefined;
    handleCs2ModalCloseState: (player: PlayerState, groupId: number) => void;
    handleDialogCloseState: (player: PlayerState, groupId: number) => void;
    getInterfaceService: () => InterfaceService | undefined;
    getGamemodeUi: () => GamemodeUiController | undefined;
    getGamemode: () => GamemodeDefinition;
}

export function normalizeModifierFlags(raw: number | undefined): number {
    const normalized = raw ?? 0;
    if (normalized === MODIFIER_FLAG_CTRL_SHIFT) {
        return MODIFIER_FLAG_CTRL_SHIFT;
    }
    return (normalized & MODIFIER_FLAG_CTRL) !== 0 ? MODIFIER_FLAG_CTRL : 0;
}

export function resolveRunWithModifier(baseRun: boolean, modifierFlags: number): boolean {
    let run = !!baseRun;
    if ((modifierFlags & MODIFIER_FLAG_CTRL) !== 0) {
        run = !run;
    }
    if (modifierFlags === MODIFIER_FLAG_CTRL_SHIFT) {
        run = true;
    }
    return run;
}
