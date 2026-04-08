/**
 * Death System Types
 *
 * Core interfaces and enums for the player death system.
 */
import type { ItemDefinition } from "../../data/items";
import type { PathService } from "../../pathfinding/PathService";
import type { GroundItemManager } from "../items/GroundItemManager";
import type { PlayerState } from "../player";

/**
 * Death type determines item loss rules and respawn behavior
 */
export enum DeathType {
    /** Standard dangerous death - full item loss rules apply */
    DANGEROUS = "dangerous",
    /** Safe death - no item loss (e.g., clan wars, castle wars) */
    SAFE = "safe",
    /** Instanced death - items lost + instance cleanup required */
    INSTANCED = "instanced",
    /** PvP death - items go to killer with wilderness rules */
    PVP = "pvp",
}

/**
 * Item with its calculated value for protection sorting
 */
export interface ValuedItem {
    /** Item ID */
    itemId: number;
    /** Item quantity (usually 1 for equipment, can be more for stackables) */
    quantity: number;
    /** Source location: inventory slot index or equipment slot */
    source: ItemSource;
    /** Value used for protection sorting (high alch or GE price) */
    value: number;
    /** Whether this item is tradeable */
    tradeable: boolean;
    /** Whether this item is always kept on death (e.g., void, fire cape) */
    alwaysKept: boolean;
    /** Item definition for additional lookups */
    definition?: ItemDefinition;
}

/**
 * Source location of an item
 */
export const ItemSourceType = {
    Inventory: "inventory",
    Equipment: "equipment",
} as const;
export type ItemSourceType = (typeof ItemSourceType)[keyof typeof ItemSourceType];

export type ItemSource = { type: typeof ItemSourceType.Inventory; slot: number } | { type: typeof ItemSourceType.Equipment; slot: number };

/**
 * Result of item protection calculation
 */
export interface ItemProtectionResult {
    /** Items kept on death (protected) */
    kept: ValuedItem[];
    /** Items lost on death (dropped/transferred) */
    lost: ValuedItem[];
    /** Number of items protected by base rules (0, 3, or similar) */
    baseProtectionCount: number;
    /** Whether Protect Item prayer was active */
    protectItemActive: boolean;
    /** Whether player was skulled */
    skulled: boolean;
    /** Total value of lost items */
    totalLostValue: number;
}

/**
 * Immutable snapshot of death state captured at moment of death
 * Security: Prevents manipulation of skull/prayer state during death processing
 */
export interface DeathContext {
    /** Player who died */
    readonly player: PlayerState;
    /** Death type (determines rules) */
    readonly deathType: DeathType;
    /** Was player skulled at death (snapshot) */
    readonly wasSkulled: boolean;
    /** Was Protect Item prayer active at death (snapshot) */
    readonly hadProtectItem: boolean;
    /** Death location */
    readonly deathLocation: Readonly<{ x: number; y: number; level: number }>;
    /** Wilderness level at death (0 if not in wilderness) */
    readonly wildernessLevel: number;
    /** Game tick when death occurred */
    readonly deathTick: number;
    /** Optional killer reference (WeakRef to prevent memory leaks) */
    readonly killer?: WeakRef<PlayerState>;
    /** Item protection calculation result */
    readonly itemProtection: ItemProtectionResult;
}

/**
 * Result of a death hook execution
 */
export interface DeathHookResult {
    /** Whether to cancel the death (e.g., Ring of Life teleported player) */
    cancelDeath: boolean;
    /** Optional message to display */
    message?: string;
    /** Whether to consume the item that triggered cancellation */
    consumeItem?: boolean;
}

/**
 * Pre-death hook - executed before death processing
 * Can cancel death (e.g., Ring of Life, Phoenix necklace)
 */
export interface PreDeathHook {
    /** Unique identifier for this hook */
    id: string;
    /** Priority (higher = runs first) */
    priority: number;
    /** Check if this hook should run */
    shouldExecute: (context: DeathContext) => boolean;
    /** Execute the hook - can cancel death */
    execute: (context: DeathContext) => Promise<DeathHookResult> | DeathHookResult;
}

/**
 * Post-death hook - executed after respawn
 * Cannot cancel death, used for cleanup/notifications
 */
export interface PostDeathHook {
    /** Unique identifier for this hook */
    id: string;
    /** Priority (higher = runs first) */
    priority: number;
    /** Execute the hook after respawn */
    execute: (context: DeathContext) => Promise<void> | void;
}

/**
 * Respawn location configuration
 */
export interface RespawnLocation {
    x: number;
    y: number;
    level: number;
    /** Optional facing direction (0-2048 range) */
    faceDirection?: number;
}

/**
 * Default respawn locations by context
 */
export const DEFAULT_RESPAWN_LOCATIONS: Record<string, RespawnLocation> = {
    /** Lumbridge - default spawn */
    lumbridge: { x: 3222, y: 3218, level: 0 },
    /** Falador - after White Knights quest */
    falador: { x: 2965, y: 3386, level: 0 },
    /** Camelot */
    camelot: { x: 2757, y: 3477, level: 0 },
    /** Edgeville - after completing Varrock museum quiz */
    edgeville: { x: 3094, y: 3503, level: 0 },
};

/**
 * Death animation constants
 */
export const DEATH_ANIMATION_ID = 836;
export const DEATH_ANIMATION_TICKS = 6;

/**
 * Death jingle ID (plays on respawn, from musicJingles index 11)
 * This is the "You Are Dead!" jingle
 */
export const DEATH_JINGLE_ID = 90;

/**
 * Services required by the death system (dependency injection)
 */
export interface PlayerDeathServices {
    /** Ground item manager for dropping items */
    groundItemManager: GroundItemManager;
    /** Get current game tick */
    getCurrentTick: () => number;
    /** Check if position is in wilderness */
    isInWilderness: (x: number, y: number) => boolean;
    /** Get wilderness level at position */
    getWildernessLevel: (x: number, y: number) => number;
    /** Get item definition by ID */
    getItemDefinition: (itemId: number) => ItemDefinition | undefined;
    /** Send chat message to player */
    sendMessage: (player: PlayerState, message: string) => void;
    /** Teleport player to location */
    teleportPlayer: (player: PlayerState, x: number, y: number, level: number) => void;
    /** Play animation on player */
    playAnimation: (player: PlayerState, animId: number) => void;
    /** Clear player animation */
    clearAnimation: (player: PlayerState) => void;
    /** Refresh player appearance (after equipment changes) */
    refreshAppearance: (player: PlayerState) => void;
    /** Send inventory update to player */
    sendInventoryUpdate: (player: PlayerState) => void;
    /** Play jingle (short music fanfare) for player */
    playJingle?: (player: PlayerState, jingleId: number) => void;
    /** Path service for validation */
    pathService?: PathService;
    /** Logger function */
    log?: (level: "info" | "warn" | "error", message: string) => void;
    /** Clear all combat and interaction state for a player */
    clearCombat?: (player: PlayerState) => void;
    /** Clear any NPC that is targeting this player */
    clearNpcTargetsForPlayer?: (playerId: number) => void;
}
