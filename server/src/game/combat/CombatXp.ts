import { SkillId } from "../../../../src/rs/skill/skills";
import { AttackType } from "./AttackType";

export type { AttackType };

export const MeleeStyle = {
    Accurate: "accurate",
    Aggressive: "aggressive",
    Controlled: "controlled",
    Defensive: "defensive",
} as const;
export type MeleeStyleMode = (typeof MeleeStyle)[keyof typeof MeleeStyle];

export const RangedStyle = {
    Accurate: "accurate",
    Rapid: "rapid",
    Longrange: "longrange",
} as const;
export type RangedStyleMode = (typeof RangedStyle)[keyof typeof RangedStyle];

export const MagicStyle = {
    Accurate: "accurate",
    Defensive: "defensive",
} as const;
export type MagicStyleMode = (typeof MagicStyle)[keyof typeof MagicStyle];

export type StyleMode = MeleeStyleMode | RangedStyleMode | MagicStyleMode;

/**
 * OSRS Combat XP Constants
 * Reference: https://oldschool.runescape.wiki/w/Combat#Experience
 *
 * Base formula: damage * 4 XP for primary skill
 * Hitpoints: damage * 1.33 XP (always)
 * Controlled/shared: XP split evenly between skills
 */

// Base XP per damage for single-skill styles
const BASE_XP_PER_DAMAGE = 4;

// Hitpoints XP per damage (always awarded)
// OSRS: 1.33 HP XP per damage = 4/3
const HITPOINTS_XP_PER_DAMAGE = 4 / 3;

// Controlled melee: 4 XP split 3 ways = 1.33 each
const CONTROLLED_XP_PER_DAMAGE = 4 / 3;

// Shared styles (longrange, defensive casting): 4 XP split 2 ways = 2 each
const SHARED_XP_PER_DAMAGE = 2;

// Magic base: 2 XP per damage + spell base XP
const MAGIC_XP_PER_DAMAGE = 2;

// Defensive magic casting splits: 1.33 magic + 1 defence per damage
const DEFENSIVE_MAGIC_XP_PER_DAMAGE = 4 / 3;
const DEFENSIVE_MAGIC_DEF_XP_PER_DAMAGE = 1;

export interface CombatXpAward {
    skillId: SkillId;
    xp: number;
}

/**
 * Calculate combat XP awards for a hit based on OSRS formulas.
 *
 * OSRS XP Rules:
 * - Hitpoints XP is ALWAYS awarded on any damage dealt (1.33 per damage)
 * - Primary skill XP depends on attack type and combat style
 * - Magic also adds spell base XP to the magic XP award
 * - XP is only awarded if damage > 0
 *
 * @param damage - Damage dealt (must be > 0 for XP)
 * @param attackType - "melee", "ranged", or "magic"
 * @param styleMode - The combat style mode (e.g., "accurate", "aggressive")
 * @param spellBaseXp - Base XP from magic spell (for magic attacks)
 * @returns Array of skill XP awards
 */
export function calculateCombatXp(
    damage: number,
    attackType: AttackType,
    styleMode: StyleMode | string,
    spellBaseXp: number = 0,
): CombatXpAward[] {
    const awards: CombatXpAward[] = [];

    // Hitpoints XP is always awarded on any successful damage
    // OSRS: 1.33 HP XP per damage point
    if (damage > 0) {
        awards.push({
            skillId: SkillId.Hitpoints,
            xp: damage * HITPOINTS_XP_PER_DAMAGE,
        });
    }

    // Calculate primary skill XP based on attack type and style
    switch (attackType) {
        case AttackType.Melee:
            if (damage > 0) {
                awards.push(...calculateMeleeXp(damage, styleMode as MeleeStyleMode));
            }
            break;
        case AttackType.Ranged:
            if (damage > 0) {
                awards.push(...calculateRangedXp(damage, styleMode as RangedStyleMode));
            }
            break;
        case AttackType.Magic:
            // Magic always grants spell base XP on cast, even on splash.
            if (damage > 0 || spellBaseXp > 0) {
                awards.push(...calculateMagicXp(damage, styleMode as MagicStyleMode, spellBaseXp));
            }
            break;
    }

    return awards;
}

/**
 * Calculate melee XP based on combat style.
 *
 * OSRS Melee Styles:
 * - Accurate: 4 XP to Attack per damage
 * - Aggressive: 4 XP to Strength per damage
 * - Controlled: 1.33 XP each to Attack, Strength, Defence per damage
 * - Defensive: 4 XP to Defence per damage
 */
function calculateMeleeXp(damage: number, mode: MeleeStyleMode): CombatXpAward[] {
    switch (mode) {
        case MeleeStyle.Accurate:
            return [{ skillId: SkillId.Attack, xp: damage * BASE_XP_PER_DAMAGE }];

        case MeleeStyle.Aggressive:
            return [{ skillId: SkillId.Strength, xp: damage * BASE_XP_PER_DAMAGE }];

        case MeleeStyle.Controlled:
            // Split 4 XP evenly between Attack, Strength, and Defence
            return [
                { skillId: SkillId.Attack, xp: damage * CONTROLLED_XP_PER_DAMAGE },
                { skillId: SkillId.Strength, xp: damage * CONTROLLED_XP_PER_DAMAGE },
                { skillId: SkillId.Defence, xp: damage * CONTROLLED_XP_PER_DAMAGE },
            ];

        case MeleeStyle.Defensive:
            return [{ skillId: SkillId.Defence, xp: damage * BASE_XP_PER_DAMAGE }];

        default:
            // Fallback to accurate style
            return [{ skillId: SkillId.Attack, xp: damage * BASE_XP_PER_DAMAGE }];
    }
}

/**
 * Calculate ranged XP based on combat style.
 *
 * OSRS Ranged Styles:
 * - Accurate: 4 XP to Ranged per damage
 * - Rapid: 4 XP to Ranged per damage (speed bonus, no XP change)
 * - Longrange: 2 XP to Ranged + 2 XP to Defence per damage
 */
function calculateRangedXp(damage: number, mode: RangedStyleMode): CombatXpAward[] {
    switch (mode) {
        case RangedStyle.Accurate:
        case RangedStyle.Rapid:
            return [{ skillId: SkillId.Ranged, xp: damage * BASE_XP_PER_DAMAGE }];

        case RangedStyle.Longrange:
            // Split between Ranged and Defence
            return [
                { skillId: SkillId.Ranged, xp: damage * SHARED_XP_PER_DAMAGE },
                { skillId: SkillId.Defence, xp: damage * SHARED_XP_PER_DAMAGE },
            ];

        default:
            // Fallback to accurate style
            return [{ skillId: SkillId.Ranged, xp: damage * BASE_XP_PER_DAMAGE }];
    }
}

/**
 * Calculate magic XP based on combat style.
 *
 * OSRS Magic XP:
 * - Base: 2 XP per damage + spell's base XP
 * - Accurate (standard): All magic XP goes to Magic skill
 * - Defensive: 1.33 XP per damage to Magic + 1 XP per damage to Defence + spell base XP
 *
 * Note: Spell base XP is always added regardless of hitting or splashing,
 * but we only call this function when damage > 0 (hit landed).
 */
function calculateMagicXp(
    damage: number,
    mode: MagicStyleMode,
    spellBaseXp: number,
): CombatXpAward[] {
    if (mode === MagicStyle.Defensive) {
        // Defensive casting: split between Magic and Defence
        // OSRS: Magic gets (damage * 1.33) + full spell base XP
        // Defence gets: damage * 1
        return [
            { skillId: SkillId.Magic, xp: damage * DEFENSIVE_MAGIC_XP_PER_DAMAGE + spellBaseXp },
            { skillId: SkillId.Defence, xp: damage * DEFENSIVE_MAGIC_DEF_XP_PER_DAMAGE },
        ];
    }

    // Standard/Accurate: All XP to Magic
    // Magic XP = (damage * 2) + spell base XP
    return [{ skillId: SkillId.Magic, xp: damage * MAGIC_XP_PER_DAMAGE + spellBaseXp }];
}

/**
 * Get the default attack style mode for an attack type.
 * Used as fallback when style mode is unknown.
 */
export function getDefaultStyleMode(attackType: AttackType): StyleMode {
    switch (attackType) {
        case AttackType.Melee:
            return MeleeStyle.Accurate;
        case AttackType.Ranged:
            return RangedStyle.Accurate;
        case AttackType.Magic:
            return MagicStyle.Accurate;
        default:
            return MeleeStyle.Accurate;
    }
}
