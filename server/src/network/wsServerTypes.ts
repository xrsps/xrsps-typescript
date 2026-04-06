import type { NpcUpdateDelta } from "../game/npc";
import type {
    ChatMessageSnapshot,
    ForcedChatBroadcast,
    ForcedMovementBroadcast,
    HitsplatBroadcast,
    PendingSpotAnimation,
    PlayerAnimSet,
} from "../game/systems";
import type { WidgetAction } from "../widgets/WidgetManager";
import type { SpellResultPayload } from "./messages";
import type { PlayerAppearance as PlayerAppearanceState } from "../game/player";
import type { SkillSyncUpdate } from "../game/player";
import type { NpcStatusEvent } from "../game/npcManager";
import type { ProjectileLaunch } from "../../../src/shared/projectiles/ProjectileLaunch";

export type StepRecord = {
    x: number;
    y: number;
    level: number;
    rot: number;
    running: boolean;
    traversal?: number;
    seq?: number;
    orientation?: number;
    direction?: number;
};

export interface PlayerViewSnapshot {
    id: number;
    x: number;
    y: number;
    level: number;
    rot: number;
    orientation: number;
    running: boolean;
    name?: string;
    appearance?: any;
    interactionIndex?: number;
    seq?: number;
    moved: boolean;
    turned: boolean;
    snap: boolean;
    directions?: number[];
    traversals?: number[];
    anim?: PlayerAnimSet;
    shouldSendPos: boolean;
    worldViewId?: number;
}

export type HealthBarUpdatePayload = {
    id: number;
    /** Absolute server loopCycle when this update becomes active (Client.cycle in OSRS). */
    cycle: number;
    /** Start value (0..width in the referenced HealthBarDefinition). */
    health: number;
    /** Target value (0..width in the referenced HealthBarDefinition). */
    health2: number;
    /** Interpolation duration in cycles (0 means immediate). */
    cycleOffset: number;
    /** True when the server requested removal (value=32767 sentinel). */
    removed?: boolean;
};

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
    healthBars?: HealthBarUpdatePayload[];
}

export interface NpcUpdatePayload {
    id: number;
    x?: number;
    y?: number;
    level?: number;
    rot?: number;
    orientation?: number;
    moved?: boolean;
    turned?: boolean;
    seq?: number;
    snap?: boolean;
    typeId?: number;
    size?: number;
    spawnX?: number;
    spawnY?: number;
    spawnLevel?: number;
    interactingIndex?: number;
    healthBars?: HealthBarUpdatePayload[];
}

export interface WidgetEvent {
    playerId: number;
    action: WidgetAction;
}

export type LocChangePayload = {
    oldId: number;
    newId: number;
    tile: { x: number; y: number };
    level: number;
    oldTile: { x: number; y: number };
    newTile: { x: number; y: number };
    oldRotation?: number;
    newRotation?: number;
    newShape?: number;
};

export interface TickFrame {
    tick: number;
    time: number;
    npcUpdates: NpcUpdateDelta[];
    npcEffectEvents: NpcStatusEvent[];
    playerSteps: Map<number, StepRecord[]>;
    hitsplats: HitsplatBroadcast[];
    forcedChats: ForcedChatBroadcast[];
    forcedMovements: ForcedMovementBroadcast[];
    pendingSequences: Map<number, { seqId: number; delay: number; startTick: number }>;
    actionEffects: import("../game/actions").ActionEffect[];
    interactionIndices: Map<number, number>;
    pendingFaceDirs: Map<number, number>;
    playerViews: Map<number, PlayerViewSnapshot>;
    npcViews: Map<number, NpcViewSnapshot>;
    widgetEvents: WidgetEvent[];
    notifications: Array<{ playerId: number; payload: any }>;
    keyedMessages: Map<string, Array<{ playerId: number; payload: any }>>;
    locChanges: LocChangePayload[];
    chatMessages: ChatMessageSnapshot[];
    inventorySnapshots: Array<{
        playerId: number;
        slots?: Array<{ slot: number; itemId: number; quantity: number }>;
    }>;
    gamemodeSnapshots: Map<string, Array<{ playerId: number; payload: unknown }>>;
    appearanceSnapshots: Array<{
        playerId: number;
        payload: {
            x: number;
            y: number;
            level: number;
            rot: number;
            orientation: number;
            running: boolean;
            appearance: PlayerAppearanceState | undefined;
            name?: string;
            anim?: PlayerAnimSet;
            moved: boolean;
            turned: boolean;
            snap: boolean;
            directions?: number[];
            worldViewId?: number;
        };
    }>;
    skillSnapshots: Array<{ playerId: number; update: SkillSyncUpdate }>;
    combatSnapshots: Array<{
        playerId: number;
        weaponCategory: number;
        weaponItemId: number;
        autoRetaliate: boolean;
        activeStyle?: number;
        activePrayers?: string[];
        activeSpellId?: number;
        specialEnergy?: number;
        specialActivated?: boolean;
        quickPrayers?: string[];
        quickPrayersEnabled?: boolean;
    }>;
    runEnergySnapshots: Array<{
        playerId: number;
        percent: number;
        units: number;
        running: boolean;
    }>;
    animSnapshots: Array<{ playerId: number; anim: PlayerAnimSet }>;
    npcPackets: Map<
        number,
        { snapshots: NpcViewSnapshot[]; updates: NpcUpdatePayload[]; despawns: number[] }
    >;
    spotAnimations: PendingSpotAnimation[];
    spellResults: Array<{ playerId: number; payload: SpellResultPayload }>;
    projectilePackets?: Map<number, ProjectileLaunch[]>;
    varps?: Array<{ playerId: number; varpId: number; value: number }>;
    varbits?: Array<{ playerId: number; varbitId: number; value: number }>;
    clientScripts?: Array<{ playerId: number; scriptId: number; args: (number | string)[] }>;
    colorOverrides: Map<
        number,
        { hue: number; sat: number; lum: number; amount: number; durationTicks: number }
    >;
    npcColorOverrides: Map<
        number,
        { hue: number; sat: number; lum: number; amount: number; durationTicks: number }
    >;
}

// ============================================================
// Constants
// ============================================================

export const DEFAULT_AUTOSAVE_SECONDS = 120;

export const EQUIP_SLOT_COUNT = 14;

// Special attack visual overrides (RuneLite gameval anchors)
export const SPEC_ANIM_DRAGON_DAGGER = 1062;
export const SPEC_SPOT_DRAGON_DAGGER = 252;
export const SPEC_ANIM_DRAGON_SCIMITAR = 1872;
export const SPEC_SPOT_DRAGON_SCIMITAR_TRAIL = 347;
export const SPEC_ANIM_GODSWORD = 7004;
export const SPEC_SPOT_GODSWORD_ZAMORAK = 1205;
export const SPEC_SPOT_GODSWORD_ARMADYL = 1206;
export const SPEC_SPOT_GODSWORD_SARADOMIN = 1207;
export const SPEC_SPOT_GODSWORD_BANDOS = 1208;

export const COMBAT_SOUND_DELAY_MS = 50;
export const PLAYER_TAKE_DAMAGE_SOUND = 510;
export const PLAYER_ZERO_DAMAGE_SOUND = 511;

// OSRS: Items are private for 60 seconds (100 ticks) before becoming visible to others
export const GROUND_ITEM_PRIVATE_TICKS = 100;
// OSRS: Items despawn after 3 minutes total (300 ticks = 180 seconds)
export const GROUND_ITEM_DESPAWN_TICKS = 300;

export const DEBUG_LOG_ITEM_ID = 1511;
export const DEBUG_LOG_TILE = Object.freeze({ x: 3167, y: 3472, level: 0 });
export const DEBUG_LOG_STACK_QTY = 28;
