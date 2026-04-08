/**
 * Central registry for all gamemode-scoped data providers.
 *
 * Providers are registered by gamemodes during initialize() and consumed by
 * core engine systems through delegate functions in each provider module.
 * The registry is reset on gamemode bootstrap so providers don't leak across
 * gamemode switches.
 */
import type { WeaponDataProvider } from "../combat/WeaponDataProvider";
import type { CombatFormulaProvider } from "../combat/CombatFormulaProvider";
import type { SpecialAttackProvider } from "../combat/SpecialAttackProvider";
import type { CombatStyleSequenceProvider } from "../combat/CombatStyleSequenceProvider";
import type { EquipmentBonusProvider } from "../combat/EquipmentBonusProvider";
import type { SpellXpProvider } from "../combat/SpellXpProvider";
import type { SpecialAttackVisualProvider } from "../combat/SpecialAttackVisualProvider";
import type { InstantUtilitySpecialProvider } from "../combat/InstantUtilitySpecialProvider";
import type { SkillConfiguration } from "../combat/SkillConfigurationProvider";
import type { SpellDataProvider } from "../spells/SpellDataProvider";
import type { RuneDataProvider } from "../data/RuneDataProvider";
import type { ProjectileParamsProvider } from "../data/ProjectileParamsProvider";
import type { AmmoDataProvider } from "../combat/AmmoDataProvider";

export interface ProviderRegistryState {
    weaponData?: WeaponDataProvider;
    combatFormula?: CombatFormulaProvider;
    specialAttack?: SpecialAttackProvider;
    combatStyleSequence?: CombatStyleSequenceProvider;
    equipmentBonus?: EquipmentBonusProvider;
    spellXp?: SpellXpProvider;
    specialAttackVisual?: SpecialAttackVisualProvider;
    instantUtilitySpecial?: InstantUtilitySpecialProvider;
    skillConfiguration?: SkillConfiguration;
    spellData?: SpellDataProvider;
    runeData?: RuneDataProvider;
    projectileParams?: ProjectileParamsProvider;
    ammoData?: AmmoDataProvider;
}

const _registry: ProviderRegistryState = {};

export function getProviderRegistry(): ProviderRegistryState {
    return _registry;
}

export function resetProviderRegistry(): void {
    _registry.weaponData = undefined;
    _registry.combatFormula = undefined;
    _registry.specialAttack = undefined;
    _registry.combatStyleSequence = undefined;
    _registry.equipmentBonus = undefined;
    _registry.spellXp = undefined;
    _registry.specialAttackVisual = undefined;
    _registry.instantUtilitySpecial = undefined;
    _registry.skillConfiguration = undefined;
    _registry.spellData = undefined;
    _registry.runeData = undefined;
    _registry.projectileParams = undefined;
    _registry.ammoData = undefined;
}
