/**
 * Combat Effect Applicator
 *
 * Centralized effect application for combat hits.
 * Extracted from wsServer.ts to improve separation of concerns.
 *
 * Responsibilities:
 * - Apply hitsplats to NPCs and players
 * - Award combat XP
 * - Apply special attack effects (freeze, heal, prayer restore)
 * - Handle status effects (poison, venom, disease)
 */
import { SkillId } from "../../../../src/rs/skill/skills";
import type { NpcState } from "../npc";
import type { PlayerState } from "../player";
import type { HitsplatResult, SpecialAttackEffects } from "./CombatState";
import {
    type AttackType as CombatXpAttackType,
    type CombatXpAward,
    type StyleMode,
    calculateCombatXp,
} from "./CombatXp";
import {
    DEFAULT_DISEASE_INTERVAL_TICKS,
    DEFAULT_POISON_INTERVAL_TICKS,
    DEFAULT_REGEN_INTERVAL_TICKS,
    DEFAULT_VENOM_INTERVAL_TICKS,
    HITMARK_BLOCK,
    HITMARK_DAMAGE,
    HITMARK_DISEASE,
    HITMARK_HEAL,
    HITMARK_POISON,
    HITMARK_REGEN,
    HITMARK_VENOM,
    HitEffectType,
    resolveHitEffect,
} from "./HitEffects";
import {
    OSRS_HITSPLAT_DAMAGE_MAX_ME,
    OSRS_HITSPLAT_DAMAGE_MAX_ME_CYAN,
    OSRS_HITSPLAT_DAMAGE_MAX_ME_ORANGE,
    OSRS_HITSPLAT_DAMAGE_MAX_ME_POISE,
    OSRS_HITSPLAT_DAMAGE_MAX_ME_WHITE,
    OSRS_HITSPLAT_DAMAGE_MAX_ME_YELLOW,
    OSRS_HITSPLAT_DAMAGE_ME_CYAN,
    OSRS_HITSPLAT_DAMAGE_ME_ORANGE,
    OSRS_HITSPLAT_DAMAGE_ME_POISE,
    OSRS_HITSPLAT_DAMAGE_ME_WHITE,
    OSRS_HITSPLAT_DAMAGE_ME_YELLOW,
    OSRS_HITSPLAT_POISON,
    OSRS_HITSPLAT_POISON_MAX,
} from "./OsrsHitsplatIds";
import { getSpellBaseXp } from "./SpellXpProvider";

// =============================================================================
// Types
// =============================================================================

/**
 * Callback for syncing skill updates to clients.
 */
export type SkillSyncCallback = (playerId: number, sync: unknown) => void;

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Normalize hitsplat amount to valid range.
 */
function normalizeHitsplatAmount(amount: number): number {
    if (!Number.isFinite(amount)) return 0;
    return Math.max(0, Math.floor(amount));
}

/**
 * Resolve damage hitsplat style (normal vs max hit indicator).
 */
function resolveDamageStyle(styleRaw: number, amount: number, maxHitRaw?: number): number {
    const style = Number.isFinite(styleRaw) ? styleRaw : HITMARK_DAMAGE;
    const dealt = normalizeHitsplatAmount(amount);
    const maxHit =
        maxHitRaw !== undefined && Number.isFinite(maxHitRaw) ? Math.max(0, maxHitRaw) : -1;
    const isMaxHit = maxHit > 0 && dealt >= maxHit;

    if (!isMaxHit) {
        return style >= 0 ? style : HITMARK_DAMAGE;
    }

    switch (style) {
        case OSRS_HITSPLAT_DAMAGE_MAX_ME:
        case OSRS_HITSPLAT_DAMAGE_MAX_ME_CYAN:
        case OSRS_HITSPLAT_DAMAGE_MAX_ME_ORANGE:
        case OSRS_HITSPLAT_DAMAGE_MAX_ME_YELLOW:
        case OSRS_HITSPLAT_DAMAGE_MAX_ME_WHITE:
        case OSRS_HITSPLAT_DAMAGE_MAX_ME_POISE:
            return style;
        case OSRS_HITSPLAT_DAMAGE_ME_CYAN:
            return OSRS_HITSPLAT_DAMAGE_MAX_ME_CYAN;
        case OSRS_HITSPLAT_DAMAGE_ME_ORANGE:
            return OSRS_HITSPLAT_DAMAGE_MAX_ME_ORANGE;
        case OSRS_HITSPLAT_DAMAGE_ME_YELLOW:
            return OSRS_HITSPLAT_DAMAGE_MAX_ME_YELLOW;
        case OSRS_HITSPLAT_DAMAGE_ME_WHITE:
            return OSRS_HITSPLAT_DAMAGE_MAX_ME_WHITE;
        case OSRS_HITSPLAT_DAMAGE_ME_POISE:
            return OSRS_HITSPLAT_DAMAGE_MAX_ME_POISE;
        default:
            return OSRS_HITSPLAT_DAMAGE_MAX_ME;
    }
}

function resolvePoisonStyle(styleRaw: number, amount: number, maxHitRaw?: number): number {
    const style = Number.isFinite(styleRaw) ? styleRaw : HITMARK_POISON;
    const dealt = normalizeHitsplatAmount(amount);
    const maxHit =
        maxHitRaw !== undefined && Number.isFinite(maxHitRaw) ? Math.max(0, maxHitRaw) : -1;
    const isMaxHit = maxHit > 0 && dealt >= maxHit;

    if (isMaxHit && (style | 0) === OSRS_HITSPLAT_POISON) {
        return OSRS_HITSPLAT_POISON_MAX;
    }

    return style >= 0 ? style : HITMARK_POISON;
}

// =============================================================================
// Combat Effect Applicator
// =============================================================================

/**
 * Centralized combat effect applicator.
 *
 * Usage:
 * ```typescript
 * const applicator = new CombatEffectApplicator();
 *
 * // Apply hit to NPC
 * const result = applicator.applyNpcHit(npc, damage, style, tick);
 *
 * // Award combat XP
 * const xpResult = applicator.awardCombatXp(player, damage, "melee", "aggressive");
 *
 * // Apply special effects
 * applicator.applySpecialEffects(context);
 * ```
 */
export class CombatEffectApplicator {
    /**
     * Apply a hitsplat to an NPC.
     * Handles all hit effect types: damage, poison, venom, disease, heal, etc.
     */
    applyNpcHitsplat(
        npc: NpcState,
        styleRaw: number,
        amountRaw: number,
        tick: number,
        maxHitRaw?: number,
    ): HitsplatResult {
        const effect = resolveHitEffect(styleRaw);
        const amount = normalizeHitsplatAmount(amountRaw);
        const current = npc.getHitpoints();
        const max = npc.getMaxHitpoints();

        // Followers are cosmetic companions, not combat participants.
        if (npc.isPlayerFollower?.() === true) {
            return { style: HITMARK_BLOCK, amount: 0, hpCurrent: current, hpMax: max };
        }

        switch (effect.type) {
            case HitEffectType.Block:
            case HitEffectType.PrayerSplash:
                return { style: HITMARK_BLOCK, amount: 0, hpCurrent: current, hpMax: max };

            case HitEffectType.Heal: {
                const healAmount = amount > 0 ? amount : effect.defaultAmount ?? 0;
                if (healAmount <= 0) {
                    return { style: HITMARK_HEAL, amount: 0, hpCurrent: current, hpMax: max };
                }
                const next = npc.heal(healAmount);
                const healed = Math.max(0, next.current - current);
                return {
                    style: HITMARK_HEAL,
                    amount: healed,
                    hpCurrent: next.current,
                    hpMax: next.max,
                };
            }

            case HitEffectType.Poison: {
                const potency = amount > 0 ? amount : effect.defaultAmount ?? 1;
                npc.inflictPoison(potency, tick, effect.interval ?? DEFAULT_POISON_INTERVAL_TICKS);
                if (amount <= 0) {
                    return {
                        style: HITMARK_POISON,
                        amount: 0,
                        hpCurrent: current,
                        hpMax: max,
                    };
                }
                const next = npc.applyDamage(amount);
                return {
                    style: resolvePoisonStyle(styleRaw, amount, maxHitRaw),
                    amount,
                    hpCurrent: next.current,
                    hpMax: next.max,
                };
            }

            case HitEffectType.Venom: {
                const stage = amount > 0 ? amount : effect.defaultAmount ?? 6;
                npc.inflictVenom(
                    stage,
                    tick,
                    effect.interval ?? DEFAULT_VENOM_INTERVAL_TICKS,
                    effect.ramp ?? 2,
                    effect.cap ?? 20,
                );
                if (amount <= 0) {
                    return {
                        style: HITMARK_VENOM,
                        amount: 0,
                        hpCurrent: current,
                        hpMax: max,
                    };
                }
                const next = npc.applyDamage(amount);
                return {
                    style: HITMARK_VENOM,
                    amount,
                    hpCurrent: next.current,
                    hpMax: next.max,
                };
            }

            case HitEffectType.Disease: {
                const potency = amount > 0 ? amount : effect.defaultAmount ?? 1;
                npc.inflictDisease(
                    potency,
                    tick,
                    effect.interval ?? DEFAULT_DISEASE_INTERVAL_TICKS,
                );
                if (amount <= 0) {
                    return {
                        style: HITMARK_DISEASE,
                        amount: 0,
                        hpCurrent: current,
                        hpMax: max,
                    };
                }
                // Disease damage is clamped to leave at least 1 HP
                const safeDamage = Math.max(0, Math.min(amount, npc.getHitpoints() - 1));
                const next = npc.applyDamage(safeDamage);
                return {
                    style: HITMARK_DISEASE,
                    amount: safeDamage,
                    hpCurrent: next.current,
                    hpMax: next.max,
                };
            }

            case HitEffectType.Regeneration: {
                const healAmount = amount > 0 ? amount : effect.defaultAmount ?? 1;
                if (healAmount <= 0) {
                    return {
                        style: HITMARK_REGEN,
                        amount: 0,
                        hpCurrent: current,
                        hpMax: max,
                    };
                }
                const before = npc.getHitpoints();
                npc.startRegeneration(
                    healAmount,
                    1,
                    tick,
                    effect.interval ?? DEFAULT_REGEN_INTERVAL_TICKS,
                );
                const result = npc.heal(healAmount);
                const healed = Math.max(0, result.current - before);
                return {
                    style: HITMARK_REGEN,
                    amount: healed,
                    hpCurrent: result.current,
                    hpMax: result.max,
                };
            }

            case HitEffectType.Reflect:
            case HitEffectType.Damage:
            default: {
                if (amount <= 0) {
                    return { style: HITMARK_BLOCK, amount: 0, hpCurrent: current, hpMax: max };
                }
                const next = npc.applyDamage(amount);
                const dealt = Math.max(0, current - next.current);
                if (dealt <= 0) {
                    return {
                        style: HITMARK_BLOCK,
                        amount: 0,
                        hpCurrent: next.current,
                        hpMax: next.max,
                    };
                }
                // Record hit for flinch mechanics tracking
                // Reference: docs/npc-behavior.md, docs/combat-formulas.md
                npc.recordHit(tick);
                const style = resolveDamageStyle(styleRaw, dealt, maxHitRaw);
                return {
                    style,
                    amount: dealt,
                    hpCurrent: next.current,
                    hpMax: next.max,
                };
            }
        }
    }

    /**
     * Apply a hitsplat to a player.
     * Similar to NPC but with player-specific HP methods.
     */
    applyPlayerHitsplat(
        player: PlayerState,
        styleRaw: number,
        amountRaw: number,
        _tick: number,
        maxHitRaw?: number,
    ): HitsplatResult {
        const effect = resolveHitEffect(styleRaw);
        const amount = normalizeHitsplatAmount(amountRaw);
        const current = player.skillSystem.getHitpointsCurrent();
        const max = player.skillSystem.getHitpointsMax();

        switch (effect.type) {
            case HitEffectType.Block:
            case HitEffectType.PrayerSplash:
                return { style: HITMARK_BLOCK, amount: 0, hpCurrent: current, hpMax: max };

            case HitEffectType.Heal: {
                const healAmount = amount > 0 ? amount : effect.defaultAmount ?? 0;
                if (healAmount <= 0) {
                    return { style: HITMARK_HEAL, amount: 0, hpCurrent: current, hpMax: max };
                }
                player.skillSystem.applyHitpointsHeal(healAmount);
                const newCurrent = player.skillSystem.getHitpointsCurrent();
                const healed = Math.max(0, newCurrent - current);
                return {
                    style: HITMARK_HEAL,
                    amount: healed,
                    hpCurrent: newCurrent,
                    hpMax: max,
                };
            }

            case HitEffectType.Damage:
            case HitEffectType.Reflect:
            default: {
                if (amount <= 0) {
                    return { style: HITMARK_BLOCK, amount: 0, hpCurrent: current, hpMax: max };
                }
                player.skillSystem.applyHitpointsDamage(amount);
                const newCurrent = player.skillSystem.getHitpointsCurrent();
                const dealt = Math.max(0, current - newCurrent);
                if (dealt <= 0) {
                    return {
                        style: HITMARK_BLOCK,
                        amount: 0,
                        hpCurrent: newCurrent,
                        hpMax: max,
                    };
                }
                const style = resolveDamageStyle(styleRaw, dealt, maxHitRaw);
                return {
                    style,
                    amount: dealt,
                    hpCurrent: newCurrent,
                    hpMax: max,
                };
            }
        }
    }

    /**
     * Calculate combat XP awards for a hit.
     * OSRS: XP is awarded at hit resolution time, not when attack initiates.
     *
     * @param damage - Damage dealt (must be > 0 for XP)
     * @param attackType - "melee", "ranged", or "magic"
     * @param styleMode - Combat style mode (e.g., "accurate", "aggressive")
     * @param spellId - Spell ID for magic attacks (for base XP calculation)
     * @returns Array of skill XP awards
     */
    calculateCombatXpAwards(
        damage: number,
        attackType: CombatXpAttackType,
        styleMode: StyleMode | string,
        spellId?: number,
    ): CombatXpAward[] {
        // Get spell base XP for magic attacks
        const spellBaseXp =
            attackType === "magic" && spellId !== undefined && spellId > 0
                ? getSpellBaseXp(spellId)
                : 0;

        if (!(damage > 0) && !(attackType === "magic" && spellBaseXp > 0)) {
            return [];
        }

        return calculateCombatXp(damage, attackType, styleMode, spellBaseXp);
    }

    /**
     * Apply XP awards to a player and detect level ups.
     *
     * @param player - Player to award XP to
     * @param awards - XP awards to apply
     * @returns Level up information if any occurred
     */
    applyXpAwards(
        player: PlayerState,
        awards: CombatXpAward[],
    ): {
        levelUps: Array<{ skillId: SkillId; oldLevel: number; newLevel: number }>;
        combatLevelUp?: { oldLevel: number; newLevel: number };
    } {
        const levelUps: Array<{ skillId: SkillId; oldLevel: number; newLevel: number }> = [];
        const oldCombatLevel = player.skillSystem.combatLevel;
        const MAX_XP = 200_000_000;

        for (const award of awards) {
            const skill = player.skillSystem.getSkill(award.skillId);
            const currentXp = skill.xp;
            const newXp = Math.min(MAX_XP, currentXp + award.xp);

            if (newXp > currentXp) {
                const oldLevel = skill.baseLevel;
                player.skillSystem.setSkillXp(award.skillId, newXp);
                const newLevel = player.skillSystem.getSkill(award.skillId).baseLevel;

                if (newLevel > oldLevel) {
                    levelUps.push({ skillId: award.skillId, oldLevel, newLevel });
                }
            }
        }

        const newCombatLevel = player.skillSystem.combatLevel;
        const combatLevelUp =
            newCombatLevel > oldCombatLevel
                ? { oldLevel: oldCombatLevel, newLevel: newCombatLevel }
                : undefined;

        return { levelUps, combatLevelUp };
    }

    /**
     * Apply special attack side effects on successful hits.
     *
     * Effects:
     * - freezeTicks: Freeze target for N ticks (e.g., Zamorak Godsword)
     * - healFraction: Heal attacker by % of damage (e.g., Saradomin Godsword)
     * - prayerFraction: Restore prayer by % of damage (e.g., SGS)
     *
     * Note: Some effects (siphonRunEnergyPercent, prayerDisableTicks) are PvP-only.
     * Note: Stat drain effects require NPC stat tracking (not implemented).
     */
    applySpecialEffects(
        attacker: PlayerState,
        target: NpcState,
        damageDealt: number,
        effects: SpecialAttackEffects | undefined,
        tick: number,
    ): void {
        if (!effects) return;

        // Freeze effect (e.g., Zamorak Godsword, Ice Barrage)
        if (effects.freezeTicks !== undefined) {
            const freezeTicks = effects.freezeTicks;
            if (freezeTicks > 0) {
                target.applyFreeze(freezeTicks, tick);
            }
        }

        // Only apply damage-based effects if damage was dealt
        if (damageDealt > 0) {
            // Heal on damage (e.g., Saradomin Godsword, Blood spells)
            if (effects.healFraction !== undefined) {
                const healFraction = effects.healFraction;
                if (healFraction > 0) {
                    const healAmount = Math.floor(damageDealt * healFraction);
                    if (healAmount > 0) {
                        attacker.skillSystem.applyHitpointsHeal(healAmount);
                    }
                }
            }

            // Prayer restore on damage (e.g., Saradomin Godsword)
            if (effects.prayerFraction !== undefined) {
                const prayerFraction = effects.prayerFraction;
                if (prayerFraction > 0) {
                    const restore = Math.floor(damageDealt * prayerFraction);
                    if (restore > 0) {
                        const current = attacker.prayer.getPrayerLevel();
                        const base = attacker.skillSystem.getSkill(SkillId.Prayer).baseLevel;
                        const target = Math.min(base, current + restore);
                        attacker.skillSystem.setSkillBoost(SkillId.Prayer, target);
                    }
                }
            }
        }

        // Note: The following effects are tracked but not fully implemented:
        // - siphonRunEnergyPercent: PvP only (target must be player)
        // - prayerDisableTicks: PvP only
        // - drainMagicByDamage: Requires NPC stat tracking
        // - drainCombatStatByDamage: Requires NPC stat tracking
    }
}

/**
 * Singleton instance for convenience.
 * Can also instantiate directly for testing.
 */
export const combatEffectApplicator = new CombatEffectApplicator();
