export type MovementMode = "idle" | "walk" | "run" | "teleport";

export interface PlayerTile {
    x: number;
    y: number;
    level: number;
}

export interface PlayerMovementEvent {
    index: number;
    mode: MovementMode;
    /** Local tile (relative to map base) after resolving the move. */
    tile: PlayerTile;
    /** Optional movement directions (0-7), used to reconstruct stepwise traversal. */
    directions?: number[];
    /** Optional traversal ordinals (mirrors OSRS `class231.rsOrdinal()`), aligned with `directions`. */
    traversals?: number[];
    /** Optional absolute subtile coordinate (tile * 128 + 64). */
    subX?: number;
    subY?: number;
    /** When walking/running, the delta applied this tick. */
    delta?: { dx: number; dy: number };
    running?: boolean;
    /** True when this movement should snap instantly (teleports/region changes). */
    snap?: boolean;
    /** True if the movement packet flagged an orientation change. */
    turned?: boolean;
    /** Optional orientation (0-2047) when provided by the server. */
    orientation?: number;
    /** Optional raw rotation value when provided (pre-turn smoothing). */
    rotation?: number;
    /**
     * OSRS parity: some movement updates are only applied after update blocks are decoded
     * (see `Player.field1124` + `SoundSystem.method877`).
     */
    applyAfterBlocks?: boolean;
}

export interface SpotAnimationUpdate {
    /** OSRS spot animation slot (0..255). */
    slot?: number;
    id: number;
    delay: number;
    height: number;
}

export interface AnimationUpdate {
    seqId: number;
    delay: number;
}

export interface ForcedMovementUpdate {
    startDeltaX: number;
    startDeltaY: number;
    endDeltaX: number;
    endDeltaY: number;
    /**
     * OSRS parity: absolute tiles after applying the base tile adjustment
     * (uses `tileX/tileY` when `field1124`, otherwise `pathX[0]/pathY[0]`).
     */
    startTileX?: number;
    startTileY?: number;
    endTileX?: number;
    endTileY?: number;
    startCycle: number;
    endCycle: number;
    direction: number;
}

export interface HitsplatUpdate {
    type: number;
    damage: number;
    /** OSRS secondary hitsplat type (var3 in SoundSystem.method877), or -1 when absent. */
    type2: number;
    /** OSRS secondary hitsplat value (var4 in SoundSystem.method877), or -1 when absent. */
    damage2: number;
    /** OSRS extra cycles added to the hitsplat lifetime (var6 in Actor.addHitSplat). */
    delayCycles: number;
    currentHp?: number;
    maxHp?: number;
}

export interface HealthBarUpdate {
    id: number;
    /** Absolute client cycle when this update becomes active (Client.cycle in OSRS, 20ms). */
    cycle: number;
    /** Start value (0..width in the referenced HealthBarDefinition). */
    health: number;
    /** Target value (0..width in the referenced HealthBarDefinition). */
    health2: number;
    /** Interpolation duration in cycles (0 means immediate / no extra byte in the payload). */
    cycleOffset: number;
    /** True when the server requested removal (value=32767 sentinel). */
    removed?: boolean;
}

export interface ChatUpdate {
    color: number;
    effect: number;
    /** OSRS PlayerType id (drives mod icon + message type). */
    playerType: number;
    /** True when the server flagged it as autochat. */
    autoChat: boolean;
    text: string;
    /** Optional extra bytes used by some chat blocks (e.g., 0x8000 flag). */
    extra?: Uint8Array;
}

export interface AppearanceUpdate {
    payload: Uint8Array;
}

export interface PlayerUpdateBlock {
    animation?: AnimationUpdate;
    /** OSRS spot animations by slot (SoundSystem.method877: 0x10000). */
    spotAnimations?: SpotAnimationUpdate[];
    /** Legacy convenience: slot 0 spot animation (if present). */
    spotAnimation?: SpotAnimationUpdate;
    forcedMovement?: ForcedMovementUpdate;
    faceEntity?: number;
    /** Absolute actor orientation (0..2047). */
    faceDir?: number;
    forcedChat?: string;
    chat?: ChatUpdate;
    appearance?: AppearanceUpdate;
    /** Optional extra player action strings (3 entries). */
    actions?: [string, string, string];
    /** Movement mode / class231 ordinal (0x1000 block). */
    movementType?: number;
    /** Move-mode override byte (0x2000 block). */
    movementFlag?: number;
    /** Unknown 0x200 block (stored for parity). */
    field512?: {
        field1180: number;
        field1233: number;
        field1234: number;
        field1193: number;
        field1204: number;
        field1237: number;
    };
    /** Raw hitsplat updates in packet order (SoundSystem.method877: 0x20). */
    hitsplats?: HitsplatUpdate[];
    /** Legacy convenience: first 4 decoded hitsplats. */
    primaryHit?: HitsplatUpdate;
    secondaryHit?: HitsplatUpdate;
    tertiaryHit?: HitsplatUpdate;
    quaternaryHit?: HitsplatUpdate;
    healthBars?: HealthBarUpdate[];
}

export interface PlayerSpawnEvent {
    index: number;
    tile: PlayerTile;
    /** When true the server flagged the spawn as preserving its existing walking queue. */
    preserveQueue: boolean;
    needsAppearance: boolean;
    /** WorldView this player belongs to (-1 = overworld, >=0 = entity index). */
    worldViewId?: number;
}

export interface PlayerRemovalEvent {
    index: number;
}

export interface PlayerSyncFrame {
    baseX: number;
    baseY: number;
    localIndex: number;
    loopCycle: number;
    clientCycle?: number;
    movements: PlayerMovementEvent[];
    spawns: PlayerSpawnEvent[];
    removals: PlayerRemovalEvent[];
    updateBlocks: Map<number, PlayerUpdateBlock>;
    sourcePacketSize?: number;
}

export interface PlayerSpotAnimationEvent {
    serverId: number;
    ecsIndex: number;
    slot?: number;
    spotId: number;
    height: number;
    startCycle: number;
}

export const enum PlayerUpdateMask {
    // Bitmask values for player update blocks.
    ForcedChat = 0x01,
    // Actor.field1208 (face direction), read via readUnsignedShortLE.
    FaceDirection = 0x02,
    Appearance = 0x04,
    Animation = 0x08,
    PublicChat = 0x10,
    Hitsplats = 0x20,
    FaceEntity = 0x40,
    // Extended public chat (includes extra bytes for some color ids).
    ExtendedPublicChat = 0x8000,
    ForceMovement = 0x400,
    Actions = 0x800,
    MovementType = 0x1000,
    MovementFlag = 0x2000,
    SpotAnimation = 0x10000,
    Field512 = 0x200,
}
