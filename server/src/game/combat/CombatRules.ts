import { getSpellData } from "../spells/SpellDataProvider";
import { SpellCaster } from "../spells/SpellCaster";
import type { AttackType } from "./AttackType";

export const RANGED_WEAPON_CATEGORIES = new Set<number>([3, 5, 6, 7, 8, 19]);
export const MAGIC_WEAPON_CATEGORIES = new Set<number>([18, 24, 29]);
export const POWERED_STAFF_CATEGORIES = new Set<number>([24]);
export const SALAMANDER_WEAPON_CATEGORY = 31;
export const DEFAULT_NPC_MELEE_RANGE = 1;
export const DEFAULT_NPC_RANGED_RANGE = 7;
export const DEFAULT_NPC_MAGIC_RANGE = 10;

export interface PlayerCombatRuleState {
    weaponCategory?: number;
    styleSlot?: number;
    weaponRange?: number;
    spellId?: number;
    autocastEnabled?: boolean;
}

export interface PlayerAttackReachOptions {
    /**
     * Explicit weapon range (typically ObjType param 13). If absent, uses combatWeaponRange.
     */
    baseRange?: number;
    /**
     * Optional spell range resolver override for tests/callers.
     */
    resolveSpellRange?: (spellId: number) => number | undefined;
}

export interface NpcCombatRuleState {
    getAttackType?: () => AttackType | undefined;
    attackRange?: number;
    combat?: {
        attackType?: AttackType;
        attackRange?: number;
    };
}

function resolveSpellRangeFromData(spellId: number): number | undefined {
    if (!(spellId > 0)) return undefined;
    const spellData = getSpellData(spellId);
    if (!spellData) return undefined;
    return Math.max(1, SpellCaster.getSpellRange(spellData));
}

function normalizeBaseRange(
    state: PlayerCombatRuleState,
    explicitBaseRange: number | undefined,
): number | undefined {
    if (explicitBaseRange !== undefined && Number.isFinite(explicitBaseRange)) {
        const range = explicitBaseRange;
        if (range > 0) return Math.max(1, range);
    }
    const storedRange = state.weaponRange ?? 0;
    if (storedRange > 0) return Math.max(1, storedRange);
    return undefined;
}

/**
 * Resolve the player's current attack type for range/LoS checks.
 * This follows OSRS hybrid-weapon behavior (staves/salamanders/powered staves).
 */
export function resolvePlayerAttackType(state: PlayerCombatRuleState): AttackType {
    const category = state.weaponCategory ?? 0;
    const styleSlot = state.styleSlot ?? 0;
    const spellId = state.spellId ?? -1;
    const autocastEnabled = !!state.autocastEnabled;

    if (category === SALAMANDER_WEAPON_CATEGORY) {
        if (styleSlot === 0) return "melee";
        if (styleSlot === 1) return "ranged";
        return "magic";
    }

    if (POWERED_STAFF_CATEGORIES.has(category)) {
        return "magic";
    }

    if (RANGED_WEAPON_CATEGORIES.has(category)) {
        return "ranged";
    }

    if (MAGIC_WEAPON_CATEGORIES.has(category)) {
        return spellId > 0 && autocastEnabled ? "magic" : "melee";
    }

    return "melee";
}

/**
 * Resolve player attack reach for combat range checks.
 */
export function resolvePlayerAttackReach(
    state: PlayerCombatRuleState,
    options: PlayerAttackReachOptions = {},
): number {
    const category = state.weaponCategory ?? 0;
    const styleSlot = state.styleSlot ?? 0;
    const spellId = state.spellId ?? -1;
    const autocastEnabled = !!state.autocastEnabled;
    const baseRange = normalizeBaseRange(state, options.baseRange);
    const attackType = resolvePlayerAttackType(state);

    if (category === SALAMANDER_WEAPON_CATEGORY) {
        if (styleSlot === 0) return 1;
        if (styleSlot === 1) return baseRange ?? 7;
        return 10;
    }

    if (attackType === "magic") {
        if (POWERED_STAFF_CATEGORIES.has(category)) return 10;
        if (spellId > 0 && autocastEnabled && MAGIC_WEAPON_CATEGORIES.has(category)) {
            const spellRange =
                options.resolveSpellRange?.(spellId) ?? resolveSpellRangeFromData(spellId);
            return Math.max(1, spellRange ?? 10);
        }
        return 1;
    }

    if (attackType === "ranged") {
        const isLongrange = styleSlot === 2 || styleSlot === 3;
        const range = baseRange ?? 7;
        return Math.max(1, range + (isLongrange ? 2 : 0));
    }

    // Melee
    if (MAGIC_WEAPON_CATEGORIES.has(category)) return 1;
    return Math.max(1, baseRange ?? 1);
}

export function resolveNpcAttackType(state: NpcCombatRuleState, explicit?: AttackType): AttackType {
    if (explicit === "melee" || explicit === "ranged" || explicit === "magic") {
        return explicit;
    }
    const direct = state.getAttackType?.();
    if (direct === "melee" || direct === "ranged" || direct === "magic") {
        return direct;
    }
    const rootAttackType = (state as { attackType?: AttackType }).attackType;
    if (
        rootAttackType === "melee" ||
        rootAttackType === "ranged" ||
        rootAttackType === "magic"
    ) {
        return rootAttackType;
    }
    const profile = state.combat?.attackType;
    if (profile === "melee" || profile === "ranged" || profile === "magic") {
        return profile;
    }
    return "melee";
}

export function resolveNpcAttackRange(state: NpcCombatRuleState, attackType?: AttackType): number {
    const rootConfiguredRange = state.attackRange;
    if (typeof rootConfiguredRange === "number" && rootConfiguredRange > 0) {
        return Math.max(1, rootConfiguredRange);
    }

    const configuredRange = state.combat?.attackRange;
    if (typeof configuredRange === "number" && configuredRange > 0) {
        return Math.max(1, configuredRange);
    }

    const resolvedType = resolveNpcAttackType(state, attackType);
    switch (resolvedType) {
        case "magic":
            return DEFAULT_NPC_MAGIC_RANGE;
        case "ranged":
            return DEFAULT_NPC_RANGED_RANGE;
        case "melee":
        default:
            return DEFAULT_NPC_MELEE_RANGE;
    }
}
