// =============================================================================
// Entity Occupation Tracking
// =============================================================================
import { CollisionFlag } from "../../../../src/shared/CollisionFlag";

/**
 * Entity Collision Service
 *
 * Manages dynamic collision flags for entities (players and NPCs) as they move.
 *
 *  Notes:
 * - Entity flags are set when an entity occupies a tile
 * - Flags are CLEARED when entity leaves, even if another entity is still present
 *   (This is the OSRS bug/feature that enables entity stacking)
 * - Some NPCs ignore entity collision entirely (bosses, GWD, etc.)
 * - Some NPCs block projectiles/LoS (gorillas, barricades)
 *
 * Reference: docs/collision-flags.md, docs/npc-behavior.md
 */

// NPCs That Ignore Entity Collision

/**
 * NPCs that neither set nor check entity collision flags.
 * These NPCs can walk through players and other NPCs freely.
 *
 * Reference: docs/collision-flags.md "NPCs That Ignore Collision"
 */
export const COLLISION_IGNORING_NPCS: ReadonlySet<string> = new Set([
    // Bosses
    "dagannoth supreme",
    "dagannoth prime",
    "dagannoth rex",
    "dusk",
    "dawn",
    "callisto",
    "venenatis",
    "vet'ion",
    "chaos elemental",
    "chaos fanatic",
    "crazy archaeologist",
    "scorpia",
    "the mimic",

    // God Wars Dungeon
    "commander zilyana",
    "starlight",
    "growler",
    "bree",
    "general graardor",
    "sergeant strongstack",
    "sergeant steelwill",
    "sergeant grimspike",
    "k'ril tsutsaroth",
    "tstanon karlak",
    "zakl'n gritch",
    "balfrug kreeyath",
    "kree'arra",
    "wingman skree",
    "flockleader geerin",
    "flight kilisa",
    "nex",

    // Chambers of Xeric
    "great olm",
    "vasa nistirio",
    "tekton",
    "muttadile",
    "vanguard",
    "vespula",
    // Note: Skeletal mystics DO have collision

    // Theatre of Blood
    "the maiden of sugadinti",
    "pestilent bloat",
    "nylocas vasilias",
    "sotetseg",
    "xarpus",
    "verzik vitur",

    // Miscellaneous
    "smoke devil",
    "thermonuclear smoke devil",
    "jal-nib",
    "ravager",
    "spinner",
    "splatter",
    "animated armour",
]);

/**
 * Check if an NPC ID/name should ignore entity collision.
 */
export function shouldIgnoreEntityCollision(npcName: string): boolean {
    return COLLISION_IGNORING_NPCS.has(npcName.toLowerCase());
}

// =============================================================================
// NPCs That Block Line of Sight (Projectiles)
// =============================================================================

/**
 * NPCs that block both movement AND projectiles.
 * These set the OCCUPIED_PROJECTILE_BLOCKER flag in addition to normal occupation.
 *
 * Reference: docs/collision-flags.md "Line-of-Sight Blocking NPCs"
 */
export const LINE_OF_SIGHT_BLOCKING_NPCS: ReadonlySet<string> = new Set([
    // Gorillas and similar
    "brawler", // Pest Control
    "bearded gorilla guard", // Temple of Marimbo
    "elder guard", // Ape Atoll

    // Other blocking NPCs
    "vanstrom klause",
    "barricade", // Castle Wars

    // Sitting bandits (Bandit Camp)
    "sitting bandit",
]);

/**
 * Check if an NPC should block line of sight.
 */
export function shouldBlockLineOfSight(npcName: string): boolean {
    return LINE_OF_SIGHT_BLOCKING_NPCS.has(npcName.toLowerCase());
}

// =============================================================================

// =============================================================================

/**
 * Entity type for collision tracking.
 */
export const EntityType = {
    Player: "player",
    Npc: "npc",
} as const;
export type EntityType = (typeof EntityType)[keyof typeof EntityType];

/**
 * Tile key for the occupation map.
 */
function tileKey(x: number, y: number, level: number): string {
    return `${x},${y},${level}`;
}

/**
 * Tracks entity occupation on tiles.
 *
 * OSRS quirk: When an entity leaves, its flag is removed regardless of
 * whether another entity is still present. This service tracks actual
 * occupation counts but clears flags per-entity for .
 */
export class EntityCollisionService {
    // Track actual entity counts per tile (for debugging/validation)
    private playerCounts = new Map<string, number>();
    private npcCounts = new Map<string, number>();

    // Callback to set/clear collision flags (injected dependency)
    private setFlag?: (x: number, y: number, level: number, flag: number) => void;
    private clearFlag?: (x: number, y: number, level: number, flag: number) => void;

    /**
     * Initialize with collision map callbacks.
     */
    configure(options: {
        setFlag: (x: number, y: number, level: number, flag: number) => void;
        clearFlag: (x: number, y: number, level: number, flag: number) => void;
    }): void {
        this.setFlag = options.setFlag;
        this.clearFlag = options.clearFlag;
    }

    /**
     * Called when an entity enters a tile.
     *
     * @param type - Entity type (player or npc)
     * @param x - Tile X coordinate
     * @param y - Tile Y coordinate
     * @param level - Plane/level
     * @param size - Entity size (1 for 1x1, etc.)
     * @param ignoreCollision - True if entity doesn't set collision flags
     * @param blocksLos - True if entity blocks line of sight
     */
    onEntityEnter(
        type: EntityType,
        x: number,
        y: number,
        level: number,
        size: number = 1,
        ignoreCollision: boolean = false,
        blocksLos: boolean = false,
    ): void {
        // Set flags for all tiles the entity occupies
        for (let ox = 0; ox < size; ox++) {
            for (let oy = 0; oy < size; oy++) {
                const tileX = x + ox;
                const tileY = y + oy;
                const key = tileKey(tileX, tileY, level);

                // Track counts
                if (type === EntityType.Player) {
                    this.playerCounts.set(key, (this.playerCounts.get(key) ?? 0) + 1);
                } else {
                    this.npcCounts.set(key, (this.npcCounts.get(key) ?? 0) + 1);
                }

                // Set collision flags (unless entity ignores collision)
                if (!ignoreCollision && this.setFlag) {
                    const flag =
                        type === EntityType.Player
                            ? CollisionFlag.OCCUPIED_PLAYER
                            : CollisionFlag.OCCUPIED_NPC;
                    this.setFlag(tileX, tileY, level, flag);

                    // Additional flag for LoS-blocking entities
                    if (blocksLos) {
                        this.setFlag(
                            tileX,
                            tileY,
                            level,
                            CollisionFlag.OCCUPIED_PROJECTILE_BLOCKER,
                        );
                    }
                }
            }
        }
    }

    /**
     * Called when an entity leaves a tile.
     *
     * OSRS quirk: Flag is ALWAYS cleared when entity leaves, even if another
     * entity of the same type is still on the tile. This enables stacking.
     */
    onEntityLeave(
        type: EntityType,
        x: number,
        y: number,
        level: number,
        size: number = 1,
        ignoreCollision: boolean = false,
        blocksLos: boolean = false,
    ): void {
        for (let ox = 0; ox < size; ox++) {
            for (let oy = 0; oy < size; oy++) {
                const tileX = x + ox;
                const tileY = y + oy;
                const key = tileKey(tileX, tileY, level);

                // Update counts
                if (type === EntityType.Player) {
                    const count = this.playerCounts.get(key) ?? 0;
                    if (count > 1) {
                        this.playerCounts.set(key, count - 1);
                    } else {
                        this.playerCounts.delete(key);
                    }
                } else {
                    const count = this.npcCounts.get(key) ?? 0;
                    if (count > 1) {
                        this.npcCounts.set(key, count - 1);
                    } else {
                        this.npcCounts.delete(key);
                    }
                }

                // ALWAYS clear flag when entity leaves
                // This is intentional - enables entity stacking
                if (!ignoreCollision && this.clearFlag) {
                    const flag =
                        type === EntityType.Player
                            ? CollisionFlag.OCCUPIED_PLAYER
                            : CollisionFlag.OCCUPIED_NPC;
                    this.clearFlag(tileX, tileY, level, flag);

                    if (blocksLos) {
                        this.clearFlag(
                            tileX,
                            tileY,
                            level,
                            CollisionFlag.OCCUPIED_PROJECTILE_BLOCKER,
                        );
                    }
                }
            }
        }
    }

    /**
     * Called when an entity moves from one tile to another.
     */
    onEntityMove(
        type: EntityType,
        fromX: number,
        fromY: number,
        toX: number,
        toY: number,
        level: number,
        size: number = 1,
        ignoreCollision: boolean = false,
        blocksLos: boolean = false,
    ): void {
        this.onEntityLeave(type, fromX, fromY, level, size, ignoreCollision, blocksLos);
        this.onEntityEnter(type, toX, toY, level, size, ignoreCollision, blocksLos);
    }

    /**
     * Check if a tile has any entity occupation.
     */
    isOccupied(x: number, y: number, level: number): boolean {
        const key = tileKey(x, y, level);
        return (this.playerCounts.get(key) ?? 0) > 0 || (this.npcCounts.get(key) ?? 0) > 0;
    }

    /**
     * Check if a tile has player occupation.
     */
    hasPlayer(x: number, y: number, level: number): boolean {
        const key = tileKey(x, y, level);
        return (this.playerCounts.get(key) ?? 0) > 0;
    }

    /**
     * Check if a tile has NPC occupation.
     */
    hasNpc(x: number, y: number, level: number): boolean {
        const key = tileKey(x, y, level);
        return (this.npcCounts.get(key) ?? 0) > 0;
    }

    /**
     * Get entity counts for a tile (debugging).
     */
    getTileCounts(x: number, y: number, level: number): { players: number; npcs: number } {
        const key = tileKey(x, y, level);
        return {
            players: this.playerCounts.get(key) ?? 0,
            npcs: this.npcCounts.get(key) ?? 0,
        };
    }

    /**
     * Clear all tracked entity occupation.
     */
    clear(): void {
        this.playerCounts.clear();
        this.npcCounts.clear();
    }
}

// Singleton instance
export const entityCollisionService = new EntityCollisionService();
