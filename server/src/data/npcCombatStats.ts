/**
 * NPC Combat Stats Loader
 *
 * Loads NPC combat statistics from npc-combat-stats.json
 * Used by CombatEngine for accurate NPC defence/attack calculations
 */
import fs from "fs";
import path from "path";

import type { AttackType } from "../game/combat/AttackType";

export interface NpcCombatStats {
    name: string;
    combatLevel: number;
    hitpoints: number;
    attackLevel: number;
    strengthLevel: number;
    defenceLevel: number;
    magicLevel: number;
    rangedLevel: number;
    attackSpeed: number;
    attackType: AttackType;
    attackStyle?: string;
    maxHit: number;
    aggressive: boolean;
    aggressiveRadius?: number;
    aggressiveTimer?: number;
    aggroTargetDelay?: number;
    poisonous?: boolean;
    venomous?: boolean;
    slayerLevel?: number;
    slayerXp?: number;
    attackBonus?: number;
    strengthBonus?: number;
    magicBonus?: number;
    rangedBonus?: number;
    defenceBonuses?: {
        stab: number;
        slash: number;
        crush: number;
        magic: number;
        ranged: number;
    };
    immunities?: string[];
    species?: string[];
    isBoss?: boolean;
}

interface NpcCombatStatsFile {
    $comment?: string;
    npcs: Record<string, NpcCombatStats>;
}

// Singleton cache
let npcStatsCache: Map<number, NpcCombatStats> | null = null;

/**
 * Load NPC combat stats from JSON file
 * Results are cached after first load
 */
export function loadNpcCombatStats(): Map<number, NpcCombatStats> {
    if (npcStatsCache) {
        return npcStatsCache;
    }

    const filePath = path.resolve(__dirname, "../../../gamemodes/vanilla/data/npc-combat-stats.json");

    if (!fs.existsSync(filePath)) {
        console.warn(`[NpcCombatStats] File not found: ${filePath}`);
        npcStatsCache = new Map();
        return npcStatsCache;
    }

    try {
        const raw = fs.readFileSync(filePath, "utf-8");
        const data: NpcCombatStatsFile = JSON.parse(raw);

        npcStatsCache = new Map();

        for (const [npcIdStr, stats] of Object.entries(data.npcs)) {
            const npcId = parseInt(npcIdStr, 10);
            if (!isNaN(npcId)) {
                npcStatsCache.set(npcId, stats);
            }
        }

        console.log(`[NpcCombatStats] Loaded ${npcStatsCache.size} NPC combat profiles`);
    } catch (error) {
        console.error("[NpcCombatStats] Failed to load:", error);
        npcStatsCache = new Map();
    }

    return npcStatsCache;
}

/**
 * Get combat stats for a specific NPC by type ID
 */
export function getNpcCombatStats(npcTypeId: number): NpcCombatStats | undefined {
    const cache = loadNpcCombatStats();
    return cache.get(npcTypeId);
}

/**
 * Convert NpcCombatStats to NpcCombatProfile format used by CombatEngine
 */
export function toNpcCombatProfile(stats: NpcCombatStats): {
    defenceLevel: number;
    magicLevel: number;
    rangedLevel: number;
    attackLevel: number;
    strengthLevel: number;
    strengthBonus: number;
    attackBonus: number;
    magicBonus: number;
    rangedBonus: number;
    hitpoints: number;
    maxHit: number;
    attackSpeed: number;
    attackType: AttackType;
    species: string[];
    bonuses: {
        stab: number;
        slash: number;
        crush: number;
        magic: number;
        ranged: number;
    };
} {
    return {
        defenceLevel: stats.defenceLevel,
        magicLevel: stats.magicLevel,
        rangedLevel: stats.rangedLevel,
        attackLevel: stats.attackLevel,
        strengthLevel: stats.strengthLevel,
        strengthBonus: stats.strengthBonus ?? 0,
        attackBonus: stats.attackBonus ?? 0,
        magicBonus: stats.magicBonus ?? 0,
        rangedBonus: stats.rangedBonus ?? 0,
        hitpoints: stats.hitpoints,
        maxHit: stats.maxHit,
        attackSpeed: stats.attackSpeed,
        attackType: stats.attackType,
        species: stats.species ?? [],
        bonuses: stats.defenceBonuses ?? {
            stab: 0,
            slash: 0,
            crush: 0,
            magic: 0,
            ranged: 0,
        },
    };
}

/**
 * Get NPC combat profile in CombatEngine format
 */
export function getNpcCombatProfile(npcTypeId: number) {
    const stats = getNpcCombatStats(npcTypeId);
    if (!stats) return undefined;
    return toNpcCombatProfile(stats);
}

/**
 * Check if NPC is aggressive
 */
export function isNpcAggressive(npcTypeId: number): boolean {
    const stats = getNpcCombatStats(npcTypeId);
    return stats?.aggressive ?? false;
}

/**
 * Get NPC aggression radius
 */
export function getNpcAggroRadius(npcTypeId: number): number {
    const stats = getNpcCombatStats(npcTypeId);
    return stats?.aggressiveRadius ?? 0;
}

/**
 * Check if NPC is poisonous
 */
export function isNpcPoisonous(npcTypeId: number): boolean {
    const stats = getNpcCombatStats(npcTypeId);
    return stats?.poisonous ?? false;
}

/**
 * Check if NPC is venomous
 */
export function isNpcVenomous(npcTypeId: number): boolean {
    const stats = getNpcCombatStats(npcTypeId);
    return stats?.venomous ?? false;
}

/**
 * Get NPC species tags (for slayer helm, salve amulet, etc.)
 */
export function getNpcSpecies(npcTypeId: number): string[] {
    const stats = getNpcCombatStats(npcTypeId);
    return stats?.species ?? [];
}

/**
 * Clear the cache (for testing or hot-reloading)
 */
export function clearNpcStatsCache(): void {
    npcStatsCache = null;
}
