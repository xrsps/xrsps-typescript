/**
 * Damage Tracking System for Loot Attribution
 *
 * In OSRS, loot is awarded based on damage dealt:
 * - For most NPCs: Player who deals the most damage gets the drop
 * - For some bosses: All participants above a damage threshold share loot
 * - Tracks damage sources for death attribution and killcount
 */
import { Actor } from "../actor";
import { NpcState } from "../npc";
import { PlayerState } from "../player";

// Type aliases for compatibility
type Npc = NpcState;
type Player = PlayerState;

// Individual damage record
interface DamageEntry {
    playerId: number;
    player: Player;
    damage: number;
    tickDealt: number;
    damageType: DamageType;
}

export const DamageType = {
    Melee: "melee",
    Ranged: "ranged",
    Magic: "magic",
    Poison: "poison",
    Venom: "venom",
    Recoil: "recoil",
    Other: "other",
} as const;
export type DamageType = (typeof DamageType)[keyof typeof DamageType];

// Damage summary for a player
export interface PlayerDamageSummary {
    playerId: number;
    player: Player;
    totalDamage: number;
    damageByType: Map<DamageType, number>;
    firstHitTick: number;
    lastHitTick: number;
    hitCount: number;
}

// Drop eligibility result
export interface DropEligibility {
    // Primary looter (highest damage dealer)
    primaryLooter: Player | null;

    // All eligible looters (for shared loot bosses)
    eligibleLooters: Player[];

    // Damage summary per player
    damageSummaries: PlayerDamageSummary[];

    // Total damage dealt to the NPC
    totalDamage: number;
}

// Loot distribution type
export const LootDistribution = {
    HighestDamage: "highest-damage",
    MostValuablePlayer: "most-valuable-player",
    Shared: "shared",
    FreeForAll: "ffa",
} as const;
export type LootDistribution = (typeof LootDistribution)[keyof typeof LootDistribution];

// Configuration for specific NPCs
export interface NpcLootConfig {
    distribution: LootDistribution;
    // Minimum damage % to be eligible for shared loot
    sharedLootThreshold?: number;
    // Minimum damage amount for eligibility
    minDamageThreshold?: number;
}

// Default configurations for different NPC types
const NPC_LOOT_CONFIGS: Map<number, NpcLootConfig> = new Map([
    // Raids bosses - shared loot based on participation
    [7527, { distribution: "shared", sharedLootThreshold: 0.05 }], // Great Olm
    [8340, { distribution: "shared", sharedLootThreshold: 0.05 }], // Verzik Vitur (final form)

    // Standard bosses - highest damage
    [494, { distribution: "highest-damage" }], // Kraken
    [2042, { distribution: "highest-damage" }], // Zulrah
    [8026, { distribution: "highest-damage" }], // Vorkath

    // God Wars Dungeon - highest damage with MVP consideration
    [2215, { distribution: "most-valuable-player" }], // General Graardor
    [3162, { distribution: "most-valuable-player" }], // K'ril Tsutsaroth
    [2205, { distribution: "most-valuable-player" }], // Commander Zilyana
    [3129, { distribution: "most-valuable-player" }], // Kree'arra

    // Corporeal Beast - shared loot
    [319, { distribution: "shared", sharedLootThreshold: 0.1, minDamageThreshold: 100 }],

    // Nightmare - shared loot
    [9425, { distribution: "shared", sharedLootThreshold: 0.05 }],
]);

export class DamageTracker {
    // NPC ID -> Damage entries
    private damageRecords: Map<Npc, DamageEntry[]> = new Map();

    // Track when NPCs were last hit (for cleanup)
    private lastHitTick: Map<Npc, number> = new Map();

    // Timeout for damage records (5 minutes = 500 ticks)
    private static readonly DAMAGE_RECORD_TIMEOUT = 500;

    /** Optional gamemode-provided resolver for per-NPC loot distribution config. */
    lootConfigResolver?: (npcTypeId: number) => NpcLootConfig | undefined;

    /**
     * Record damage dealt to an NPC
     */
    recordDamage(
        player: Player,
        npc: Npc,
        damage: number,
        damageType: DamageType,
        currentTick: number,
    ): void {
        if (damage <= 0) return;

        let records = this.damageRecords.get(npc);
        if (!records) {
            records = [];
            this.damageRecords.set(npc, records);
        }

        records.push({
            playerId: player.id,
            player,
            damage,
            tickDealt: currentTick,
            damageType,
        });

        this.lastHitTick.set(npc, currentTick);
    }

    /**
     * Get damage summary for all players who damaged an NPC
     */
    getDamageSummary(npc: Npc): PlayerDamageSummary[] {
        const records = this.damageRecords.get(npc) || [];
        const summaryMap = new Map<number, PlayerDamageSummary>();

        for (const record of records) {
            let summary = summaryMap.get(record.playerId);

            if (!summary) {
                summary = {
                    playerId: record.playerId,
                    player: record.player,
                    totalDamage: 0,
                    damageByType: new Map(),
                    firstHitTick: record.tickDealt,
                    lastHitTick: record.tickDealt,
                    hitCount: 0,
                };
                summaryMap.set(record.playerId, summary);
            }

            summary.totalDamage += record.damage;
            summary.hitCount++;
            summary.lastHitTick = Math.max(summary.lastHitTick, record.tickDealt);

            const typeTotal = summary.damageByType.get(record.damageType) ?? 0;
            summary.damageByType.set(record.damageType, typeTotal + record.damage);
        }

        return Array.from(summaryMap.values()).sort((a, b) => b.totalDamage - a.totalDamage);
    }

    /**
     * Determine drop eligibility when NPC dies
     */
    getDropEligibility(npc: Npc): DropEligibility {
        const summaries = this.getDamageSummary(npc);
        const totalDamage = summaries.reduce((sum, s) => sum + s.totalDamage, 0);

        // Get NPC-specific loot configuration (gamemode resolver takes priority)
        const config = this.lootConfigResolver?.(npc.typeId)
            ?? NPC_LOOT_CONFIGS.get(npc.typeId)
            ?? { distribution: LootDistribution.HighestDamage as const };

        const eligibleLooters: Player[] = [];
        let primaryLooter: Player | null = null;

        switch (config.distribution) {
            case LootDistribution.HighestDamage:
                // Simple: highest damage dealer gets the loot
                if (summaries.length > 0) {
                    primaryLooter = summaries[0].player;
                    eligibleLooters.push(primaryLooter);
                }
                break;

            case LootDistribution.MostValuablePlayer:
                // MVP consideration: highest damage, but with contribution weighting
                if (summaries.length > 0) {
                    // For now, same as highest damage
                    // Could add tankiness/support contribution later
                    primaryLooter = summaries[0].player;
                    eligibleLooters.push(primaryLooter);
                }
                break;

            case LootDistribution.Shared:
                // Shared loot: everyone above threshold is eligible
                const threshold = config.sharedLootThreshold ?? 0.05;
                const minDamage = config.minDamageThreshold ?? 0;

                for (const summary of summaries) {
                    const damagePercent = totalDamage > 0 ? summary.totalDamage / totalDamage : 0;

                    if (damagePercent >= threshold && summary.totalDamage >= minDamage) {
                        eligibleLooters.push(summary.player);
                    }
                }

                // Primary looter is still highest damage for drop rolling
                if (summaries.length > 0) {
                    primaryLooter = summaries[0].player;
                }
                break;

            case LootDistribution.FreeForAll:
                // Free for all: everyone gets their own loot roll
                // All participants are eligible
                for (const summary of summaries) {
                    eligibleLooters.push(summary.player);
                }
                if (summaries.length > 0) {
                    primaryLooter = summaries[0].player;
                }
                break;
        }

        return {
            primaryLooter,
            eligibleLooters,
            damageSummaries: summaries,
            totalDamage,
        };
    }

    /**
     * Get the player who should receive the kill for killcount purposes
     */
    getKiller(npc: Npc): Player | null {
        const summaries = this.getDamageSummary(npc);
        return summaries.length > 0 ? summaries[0].player : null;
    }

    /**
     * Check if a player contributed to the kill
     */
    didContribute(player: Player, npc: Npc): boolean {
        const records = this.damageRecords.get(npc) || [];
        return records.some((r) => r.playerId === player.id);
    }

    /**
     * Get player's damage percentage
     */
    getDamagePercent(player: Player, npc: Npc): number {
        const summaries = this.getDamageSummary(npc);
        const totalDamage = summaries.reduce((sum, s) => sum + s.totalDamage, 0);

        if (totalDamage === 0) return 0;

        const playerSummary = summaries.find((s) => s.playerId === player.id);
        return playerSummary ? playerSummary.totalDamage / totalDamage : 0;
    }

    /**
     * Clear damage records for an NPC (after death/despawn)
     */
    clearNpc(npc: Npc): void {
        this.damageRecords.delete(npc);
        this.lastHitTick.delete(npc);
    }

    /**
     * Clean up old damage records
     */
    cleanup(currentTick: number): void {
        const expiredNpcs: Npc[] = [];

        for (const [npc, lastTick] of this.lastHitTick) {
            if (currentTick - lastTick > DamageTracker.DAMAGE_RECORD_TIMEOUT) {
                expiredNpcs.push(npc);
            }
        }

        for (const npc of expiredNpcs) {
            this.clearNpc(npc);
        }
    }

    /**
     * Get raw damage records (for debugging)
     */
    getRawRecords(npc: Npc): DamageEntry[] {
        return [...(this.damageRecords.get(npc) || [])];
    }

    /**
     * Register custom loot configuration for an NPC
     */
    static setNpcLootConfig(npcId: number, config: NpcLootConfig): void {
        NPC_LOOT_CONFIGS.set(npcId, config);
    }
}

// Singleton instance
export const damageTracker = new DamageTracker();

/**
 * Calculate XP share for shared kills
 * In OSRS, XP is generally awarded based on individual damage dealt
 */
export function calculateXpShare(
    player: Player,
    npc: Npc,
    baseXp: number,
    tracker: DamageTracker = damageTracker,
): number {
    const percent = tracker.getDamagePercent(player, npc);
    return Math.floor(baseXp * percent);
}
