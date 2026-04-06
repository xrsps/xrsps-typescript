import type { CacheInfo } from "../../../../src/rs/cache/CacheInfo";
import type { CacheSystem } from "../../../../src/rs/cache/CacheSystem";

export type RuneCost = {
    runeId: number;
    quantity: number;
};

export type SpellDataEntry = {
    id: number;
    /** Widget child index within the spellbook interface (set at runtime from cache) */
    widgetChildId?: number;
    name?: string;
    levelRequired?: number;
    baseMaxHit: number;
    castSpotAnim?: number;
    projectileId?: number;
    impactSpotAnim?: number;
    splashSpotAnim?: number;
    castAnimId?: number;
    runeCosts?: RuneCost[];
    spellbook?: "standard" | "ancient" | "lunar" | "arceuus";
    category?: "combat" | "teleport" | "utility" | "binding";
    experienceGained?: number;
    freezeDuration?: number; // ticks
    maxTargets?: number; // for multi-target spells like barrage
    projectileStartHeight?: number;
    projectileEndHeight?: number;
    projectileSlope?: number;
    projectileSteepness?: number;
    projectileStartDelay?: number;
    projectileTravelTime?: number;
    /** Optional extra ticks to delay projectile release relative to cast sequence start */
    projectileReleaseDelayTicks?: number;
    // Optional stat debuff applied on landed hit (PvP and, in future, NPCs with stat profiles)
    statDebuff?: {
        stat: "attack" | "strength" | "defence";
        percent: number; // percent reduction of current level (floored, min 1)
        durationTicks?: number; // optional; if omitted, persists until restored by other means
    };
};

export type AutocastCompatibilityResult = {
    compatible: boolean;
    reason?:
        | "no_weapon"
        | "not_autocastable_with_weapon"
        | "powered_staff"
        | "wrong_spellbook"
        | "weapon_specific_spell"
        | "invalid_spell";
};

/**
 * Powered staff built-in spell data.
 * These staves have their own attack spell and cannot autocast normal spells.
 */
export type PoweredStaffSpellData = {
    /** Weapon item IDs that use this spell data */
    weaponIds: number[];
    /** Display name for the spell (internal use) */
    name: string;
    /** Projectile GFX ID (travels from caster to target) */
    projectileId: number;
    /** Cast spot animation (plays on caster) */
    castSpotAnim: number;
    /** Impact spot animation (plays on target when hit lands) */
    impactSpotAnim: number;
    /** Splash spot animation (plays on target when spell splashes/misses) */
    splashSpotAnim?: number;
    /** Sound ID played when casting */
    castSoundId: number;
    /** Sound ID played when projectile is in flight (optional) */
    projectileSoundId?: number;
    /** Sound ID played on impact */
    impactSoundId: number;
    /**
     * Max hit formula type:
     * - "trident_seas": floor(magic/3) - 5
     * - "trident_swamp": floor(magic/3) - 2
     * - "sanguinesti": floor(magic/3) - 1
     * - "tumeken": floor(magic/3) + 1
     * - "thammaron": floor(magic/3) - 8 (in wilderness: + bonus)
     * - "accursed": floor(magic/3) - 6 (in wilderness: + bonus)
     */
    maxHitFormula:
        | "trident_seas"
        | "trident_swamp"
        | "sanguinesti"
        | "tumeken"
        | "thammaron"
        | "accursed";
    /** Base magic XP per cast (regardless of hit) */
    baseXp?: number;
    /** Special effects like healing (Sanguinesti) */
    effects?: {
        /** Chance to heal (Sanguinesti: 1/6 chance to heal 50% of damage) */
        healChance?: number;
        healPercent?: number;
    };
};

export interface SpellDataProvider {
    getSpellData(spellId: number): SpellDataEntry | undefined;
    getSpellDataByWidget(spellbookGroupId: number, widgetChildId: number): SpellDataEntry | undefined;
    getAllSpellData(): SpellDataEntry[];
    registerSpellData(entry: SpellDataEntry): void;
    hasSpellData(spellId: number): boolean;
    initSpellWidgetMapping(cacheInfo: CacheInfo, cache: CacheSystem): void;
    isSpellWidgetMappingInitialized(): boolean;

    // Autocast
    getSpellIdFromAutocastIndex(autocastIndex: number): number | undefined;
    getAutocastIndexFromSpellId(spellId: number): number | undefined;
    isSpellAutocastable(spellId: number): boolean;
    buildVisibleAutocastIndices(weaponItemId: number): number[];
    canWeaponAutocastSpell(weaponItemId: number, spellId: number): AutocastCompatibilityResult;
    getAutocastCompatibilityMessage(reason: AutocastCompatibilityResult["reason"]): string;

    // Powered staff
    getPoweredStaffSpellData(weaponId: number): PoweredStaffSpellData | undefined;
    hasPoweredStaffSpellData(weaponId: number): boolean;
    calculatePoweredStaffBaseDamage(magicLevel: number, formula: PoweredStaffSpellData["maxHitFormula"]): number;
}

// =============================================================================
// Provider Registration & Delegation
// =============================================================================

let _provider: SpellDataProvider | undefined;

export function registerSpellDataProvider(provider: SpellDataProvider): void {
    _provider = provider;
}

export function getSpellDataProvider(): SpellDataProvider | undefined {
    return _provider;
}

function ensureProvider(): SpellDataProvider {
    if (!_provider) {
        throw new Error("[spells] SpellDataProvider not registered. Ensure the gamemode has initialized.");
    }
    return _provider;
}

export function getSpellData(spellId: number): SpellDataEntry | undefined {
    return ensureProvider().getSpellData(spellId);
}

export function getSpellDataByWidget(spellbookGroupId: number, widgetChildId: number): SpellDataEntry | undefined {
    return ensureProvider().getSpellDataByWidget(spellbookGroupId, widgetChildId);
}

export function getAllSpellData(): SpellDataEntry[] {
    return ensureProvider().getAllSpellData();
}

export function registerSpellData(entry: SpellDataEntry): void {
    ensureProvider().registerSpellData(entry);
}

export function hasSpellData(spellId: number): boolean {
    return ensureProvider().hasSpellData(spellId);
}

export function initSpellWidgetMapping(cacheInfo: CacheInfo, cache: CacheSystem): void {
    ensureProvider().initSpellWidgetMapping(cacheInfo, cache);
}

export function isSpellWidgetMappingInitialized(): boolean {
    return ensureProvider().isSpellWidgetMappingInitialized();
}

export function getSpellIdFromAutocastIndex(autocastIndex: number): number | undefined {
    return ensureProvider().getSpellIdFromAutocastIndex(autocastIndex);
}

export function getAutocastIndexFromSpellId(spellId: number): number | undefined {
    return ensureProvider().getAutocastIndexFromSpellId(spellId);
}

export function isSpellAutocastable(spellId: number): boolean {
    return ensureProvider().isSpellAutocastable(spellId);
}

export function buildVisibleAutocastIndices(weaponItemId: number): number[] {
    return ensureProvider().buildVisibleAutocastIndices(weaponItemId);
}

export function canWeaponAutocastSpell(weaponItemId: number, spellId: number): AutocastCompatibilityResult {
    return ensureProvider().canWeaponAutocastSpell(weaponItemId, spellId);
}

export function getAutocastCompatibilityMessage(reason: AutocastCompatibilityResult["reason"]): string {
    return ensureProvider().getAutocastCompatibilityMessage(reason);
}

export function getPoweredStaffSpellData(weaponId: number): PoweredStaffSpellData | undefined {
    return ensureProvider().getPoweredStaffSpellData(weaponId);
}

export function hasPoweredStaffSpellData(weaponId: number): boolean {
    return ensureProvider().hasPoweredStaffSpellData(weaponId);
}

export function calculatePoweredStaffBaseDamage(magicLevel: number, formula: PoweredStaffSpellData["maxHitFormula"]): number {
    return ensureProvider().calculatePoweredStaffBaseDamage(magicLevel, formula);
}
