/**
 * Bridge module: delegates all spell data access to the registered SpellDataProvider.
 * The actual spell data definitions live in server/gamemodes/vanilla/data/spells.ts.
 * The vanilla gamemode registers the provider during initialization.
 */
import type { CacheInfo } from "../../../src/rs/cache/CacheInfo";
import type { CacheSystem } from "../../../src/rs/cache/CacheSystem";

export type {
    RuneCost,
    SpellDataEntry,
    AutocastCompatibilityResult,
    PoweredStaffSpellData,
    SpellDataProvider,
} from "../game/spells/SpellDataProvider";

let _provider: import("../game/spells/SpellDataProvider").SpellDataProvider | undefined;

export function registerSpellDataProvider(
    provider: import("../game/spells/SpellDataProvider").SpellDataProvider,
): void {
    _provider = provider;
}

export function getSpellDataProvider():
    | import("../game/spells/SpellDataProvider").SpellDataProvider
    | undefined {
    return _provider;
}

function ensureProvider(): import("../game/spells/SpellDataProvider").SpellDataProvider {
    if (!_provider) {
        throw new Error(
            "[spells] SpellDataProvider not registered. Ensure the gamemode has initialized.",
        );
    }
    return _provider;
}

export function getSpellData(
    spellId: number,
): import("../game/spells/SpellDataProvider").SpellDataEntry | undefined {
    return ensureProvider().getSpellData(spellId);
}

export function getSpellDataByWidget(
    spellbookGroupId: number,
    widgetChildId: number,
): import("../game/spells/SpellDataProvider").SpellDataEntry | undefined {
    return ensureProvider().getSpellDataByWidget(spellbookGroupId, widgetChildId);
}

export function getAllSpellData(): import("../game/spells/SpellDataProvider").SpellDataEntry[] {
    return ensureProvider().getAllSpellData();
}

export function registerSpellData(
    entry: import("../game/spells/SpellDataProvider").SpellDataEntry,
): void {
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

export function canWeaponAutocastSpell(
    weaponItemId: number,
    spellId: number,
): import("../game/spells/SpellDataProvider").AutocastCompatibilityResult {
    return ensureProvider().canWeaponAutocastSpell(weaponItemId, spellId);
}

export function getAutocastCompatibilityMessage(
    reason: import("../game/spells/SpellDataProvider").AutocastCompatibilityResult["reason"],
): string {
    return ensureProvider().getAutocastCompatibilityMessage(reason);
}

export function getPoweredStaffSpellData(
    weaponId: number,
): import("../game/spells/SpellDataProvider").PoweredStaffSpellData | undefined {
    return ensureProvider().getPoweredStaffSpellData(weaponId);
}

export function hasPoweredStaffSpellData(weaponId: number): boolean {
    return ensureProvider().hasPoweredStaffSpellData(weaponId);
}

export function calculatePoweredStaffBaseDamage(
    magicLevel: number,
    formula: import("../game/spells/SpellDataProvider").PoweredStaffSpellData["maxHitFormula"],
): number {
    return ensureProvider().calculatePoweredStaffBaseDamage(magicLevel, formula);
}
