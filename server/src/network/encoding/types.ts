import type { Huffman } from "../../../../src/rs/chat/Huffman";
import type { NpcState, NpcUpdateDelta } from "../../game/npc";
import type { PlayerAppearance, PlayerState } from "../../game/player";
import type { NpcSyncSession } from "../NpcSyncSession";
import type { PlayerSyncSession } from "../PlayerSyncSession";

/**
 * Hitsplat block used in update masks.
 */
export interface HitsplatBlock {
    type: number;
    damage: number;
    type2?: number;
    damage2?: number;
    /** Extra hitsplat cycles added to the lifetime (Client.cycle units, 20ms). */
    delayCycles: number;
}

/**
 * Health bar block used in update masks.
 */
export interface HealthBarBlock {
    id: number;
    /** Interpolation duration in cycles (0 means immediate). */
    cycleOffset: number;
    /** Delay before the update becomes active. */
    delayCycles: number;
    /** Start value (0..width in the referenced HealthBarDefinition). */
    health: number;
    /** Target value (0..width). Only encoded when cycleOffset > 0. */
    health2: number;
    removed?: boolean;
}

/**
 * Spot animation block for player/NPC graphics.
 */
export interface SpotAnimBlock {
    slot: number;
    id: number;
    height: number;
    /** Delay before the spot anim starts, in client cycles (Client.cycle units, 20ms). */
    delayCycles: number;
}

/**
 * Forced movement block for player force-move.
 */
export interface ForcedMovementBlock {
    startDeltaX: number;
    startDeltaY: number;
    endDeltaX: number;
    endDeltaY: number;
    startCycle: number;
    endCycle: number;
    direction: number;
}

/**
 * Player animation set.
 */
export interface PlayerAnimSet {
    idle?: number;
    walk?: number;
    walkBack?: number;
    walkLeft?: number;
    walkRight?: number;
    run?: number;
    runBack?: number;
    runLeft?: number;
    runRight?: number;
    turnLeft?: number;
    turnRight?: number;
}

/**
 * Player view snapshot for sync packet building.
 */
export interface PlayerViewSnapshot {
    id: number;
    x: number;
    y: number;
    level: number;
    rot: number;
    orientation: number;
    running: boolean;
    appearance?: PlayerAppearance;
    name?: string;
    anim?: PlayerAnimSet;
    moved: boolean;
    turned: boolean;
    snap: boolean;
    directions?: number[];
    worldViewId?: number;
}

/**
 * NPC view snapshot for sync packet building.
 */
export interface NpcViewSnapshot {
    id: number;
    typeId: number;
    x: number;
    y: number;
    level: number;
    rot: number;
    orientation: number;
    size: number;
    spawnX: number;
    spawnY: number;
    spawnLevel: number;
    name?: string;
    interactingIndex?: number;
    snap?: boolean;
}

/**
 * Step record for movement encoding.
 */
export interface StepRecord {
    x: number;
    y: number;
    level: number;
    rot?: number;
    running?: boolean;
    traversal?: number;
    seq?: number;
    orientation?: number;
    /** Network direction format (0-7). */
    direction?: number;
    type?: "walk" | "run" | "crawl";
}

/**
 * Chat message data for public chat encoding.
 */
export interface ChatMessageData {
    packedColor: number;
    playerType: number;
    autoChat: boolean;
    payload: Uint8Array;
    extra?: Uint8Array;
}

/**
 * Pending player update info for mask encoding.
 */
export interface PlayerUpdateInfo {
    mask: number;
    forcedMovement?: ForcedMovementBlock;
    spotAnims?: SpotAnimBlock[];
    forcedChat?: string;
    chat?: ChatMessageData;
    face?: number;
    faceDir?: number;
    appearance?: Uint8Array;
    anim?: { seqId: number; delay: number };
    hitsplats?: HitsplatBlock[];
    healthBars?: HealthBarBlock[];
    movementType?: number;
    movementFlag?: number;
    actions?: [string, string, string];
    field512?: {
        field1180: number;
        field1233: number;
        field1234: number;
        field1193: number;
        field1204: number;
        field1237: number;
    };
}

/**
 * Pending NPC update info for mask encoding.
 */
export interface NpcUpdateInfo {
    mask: number;
    targetIndex?: number;
    seq?: { id: number; delay: number };
    spotAnims?: SpotAnimBlock[];
    hitsplats?: HitsplatBlock[];
    healthBars?: HealthBarBlock[];
    say?: string;
    colorOverride?: {
        startCycleOffset: number;
        endCycleOffset: number;
        hue: number;
        sat: number;
        lum: number;
        amount: number;
    };
}

/**
 * Hitsplat broadcast from game tick.
 */
export interface HitsplatBroadcast {
    targetId: number;
    targetType: "player" | "npc";
    type: number;
    damage: number;
    type2?: number;
    damage2?: number;
    delayTicks?: number;
}

/**
 * Forced chat broadcast from game tick.
 */
export interface ForcedChatBroadcast {
    playerId: number;
    text: string;
}

/**
 * Forced movement broadcast from game tick.
 */
export interface ForcedMovementBroadcast {
    playerId: number;
    startDeltaX: number;
    startDeltaY: number;
    endDeltaX: number;
    endDeltaY: number;
    startCycle: number;
    endCycle: number;
    direction: number;
}

/**
 * Tick frame data passed to encoders.
 */
export interface TickFrameData {
    tick: number;
    time: number;
    npcUpdates: NpcUpdateDelta[];
    playerSteps: Map<number, StepRecord[]>;
    hitsplats: HitsplatBroadcast[];
    forcedChats: ForcedChatBroadcast[];
    forcedMovements: ForcedMovementBroadcast[];
    pendingSequences: Map<number, { seqId: number; delay: number; startTick: number }>;
    interactionIndices: Map<number, number>;
    playerViews: Map<number, PlayerViewSnapshot>;
    npcViews: Map<number, NpcViewSnapshot>;
}

/**
 * Services interface for player packet encoding.
 * Uses dependency injection to avoid tight coupling with WSServer.
 */
export interface PlayerEncodingServices {
    /** Get a player by ID */
    getPlayer(id: number): PlayerState | undefined;
    /** Get all players iterator */
    getAllPlayers(): Iterable<PlayerState>;
    /** Get all bots iterator */
    getAllBots(): Iterable<PlayerState>;
    /** Get Huffman encoder for chat compression */
    getHuffman(): Huffman | null;
    /** Build animation payload for a player */
    buildAnimPayload(player: PlayerState): PlayerAnimSet | undefined;
    /** Encode appearance block */
    encodeAppearanceBlock(player: PlayerState): Uint8Array;
    /** Resolve healthbar width by definition ID */
    resolveHealthBarWidth(defId: number): number;
}

/**
 * Services interface for NPC packet encoding.
 */
export interface NpcEncodingServices {
    /** Get an NPC by ID */
    getNpcById(id: number): NpcState | undefined;
    /** Get nearby NPCs for a player's viewport */
    getNearbyNpcs(x: number, y: number, level: number, radius: number): NpcState[];
    /** Resolve healthbar width by definition ID */
    resolveHealthBarWidth(defId: number): number;
}

/**
 * Result of building a player sync packet.
 */
export interface PlayerSyncResult {
    bytes: Uint8Array;
    activeIndices: number[];
    baseTileX: number;
    baseTileY: number;
}

/**
 * Result of building an NPC sync packet.
 */
export interface NpcSyncResult {
    packet: Uint8Array;
    large: boolean;
}
