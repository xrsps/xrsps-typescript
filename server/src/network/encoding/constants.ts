import { DIRECTION_TO_ORIENTATION } from "../../../../src/shared/Direction";

/**
 * Player update mask bit flags.
 * These control which update blocks are included in the player sync packet.
 * Order matches the OSRS client parsing order in `class467.method2621`.
 */
export const PLAYER_MASKS = {
    FORCED_CHAT: 0x01,
    /** Player face direction (Actor.field1208). */
    FACE_DIR: 0x02,
    APPEARANCE: 0x04,
    ANIMATION: 0x08,
    PUBLIC_CHAT: 0x10,
    HIT: 0x20,
    FACE_ENTITY: 0x40,
    FIELD512: 0x200,
    FORCE_MOVEMENT: 0x400,
    ACTIONS: 0x800,
    MOVEMENT_TYPE: 0x1000,
    MOVEMENT_FLAG: 0x2000,
    /** Extended public chat (includes extra bytes for some overhead color ids). */
    EXT_PUBLIC_CHAT: 0x8000,
    SPOT_ANIM: 0x10000,
} as const;

/**
 * NPC update mask bit flags.
 * These control which update blocks are included in the NPC sync packet.
 * Order matches `UrlRequester.method2903` parsing order.
 */
export const NPC_MASKS = {
    FACE_ENTITY: 0x8,
    SEQUENCE: 0x10,
    HIT: 0x20,
    SAY: 0x40,
    COLOR_OVERRIDE: 0x100,
    SPOT_ANIM: 0x20000,
} as const;

/**
 * Standard OSRS viewport distance for NPC sync.
 */
export const NPC_VIEW_DISTANCE_TILES = 15;

/**
 * Maximum NPCs in local list.
 */
export const MAX_LOCAL_NPCS = 255;

/**
 * Maximum players in local list (for perspective of a single player).
 */
export const MAX_LOCAL_PLAYERS = 2047;

/**
 * No interaction sentinel value.
 */
export const NO_INTERACTION = -1;

/**
 * Face entity sentinel (no target).
 */
export const NO_TARGET_INDEX = 0xffffff;

/**
 * OSRS parity: Rotation index lookup from RS orientation (0-2047) to 3-bit direction index.
 */
export const ROTATION_TO_INDEX = new Map<number, number>([
    [DIRECTION_TO_ORIENTATION[0], 0],
    [DIRECTION_TO_ORIENTATION[1], 1],
    [DIRECTION_TO_ORIENTATION[2], 2],
    [DIRECTION_TO_ORIENTATION[3], 3],
    [DIRECTION_TO_ORIENTATION[4], 4],
    [DIRECTION_TO_ORIENTATION[5], 5],
    [DIRECTION_TO_ORIENTATION[6], 6],
    [DIRECTION_TO_ORIENTATION[7], 7],
]);

/**
 * OSRS parity: Direction index to RS orientation.
 */
export const INDEX_TO_ROTATION = DIRECTION_TO_ORIENTATION;

/**
 * UShortSmart range clamp.
 */
export const USHORT_SMART_MAX = 32767;

/**
 * Hitsplat type protocol sentinels (not real type ids).
 */
export const HITSPLAT_SENTINEL_NO_TYPE = 32766;
export const HITSPLAT_SENTINEL_SECONDARY = 32767;

/**
 * Health bar removal sentinel.
 */
export const HEALTH_BAR_REMOVED_SENTINEL = 32767;

/**
 * Network direction codes used by `Players.updateExternalPlayer` (type=2 chunk hop),
 * and by `readPlayerUpdate` (moveType=1 walk). Index order is NW,N,NE,W,E,SW,S,SE.
 */
export const CHUNK_DIRECTION_DELTAS: ReadonlyArray<{ dx: number; dy: number }> = [
    { dx: -1, dy: -1 },
    { dx: 0, dy: -1 },
    { dx: 1, dy: -1 },
    { dx: -1, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: -1, dy: 1 },
    { dx: 0, dy: 1 },
    { dx: 1, dy: 1 },
];

/**
 * Standard OSRS viewport distance for player sync.
 */
export const PLAYER_VIEW_DISTANCE_TILES = 15;

/**
 * Maximum players to add per cycle.
 */
export const MAX_ADD_PER_CYCLE = 40;
