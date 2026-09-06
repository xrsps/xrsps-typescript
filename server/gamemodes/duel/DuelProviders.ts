import { createDefaultAmmoDataProvider } from "../../src/game/combat/AmmoSystem";
import { getProviderRegistry } from "../../src/game/providers/ProviderRegistry";
import { createCombatStyleSequenceProvider } from "../vanilla/combat/CombatStyleSequences";
import { createEquipmentBonusProvider } from "../vanilla/combat/EquipmentBonuses";
import { createInstantUtilitySpecialProvider } from "../vanilla/combat/RockKnockerSpecial";
import { createSkillConfiguration } from "../vanilla/combat/SkillConfiguration";
import { createSpecialAttackProvider } from "../vanilla/combat/SpecialAttackRegistry";
import { createSpecialAttackVisualProvider } from "../vanilla/combat/SpecialAttackVisuals";
import { createSpellXpProvider } from "../vanilla/combat/SpellXpData";
import { createProjectileParamsProvider } from "../vanilla/data/projectileParams";
import { createRuneDataProvider } from "../vanilla/data/runes";
import { createSpellDataProvider } from "../vanilla/data/spells";
import { createWeaponDataProvider } from "../vanilla/data/weapons";

/** Reuse OSRS combat definitions without registering the open-world content. */
export function registerDuelProviders(): void {
    const registry = getProviderRegistry();
    registry.spellXp = createSpellXpProvider();
    registry.specialAttackVisual = createSpecialAttackVisualProvider();
    registry.instantUtilitySpecial = createInstantUtilitySpecialProvider();
    registry.weaponData = createWeaponDataProvider();
    registry.specialAttack = createSpecialAttackProvider();
    registry.combatStyleSequence = createCombatStyleSequenceProvider();
    registry.skillConfiguration = createSkillConfiguration();
    registry.equipmentBonus = createEquipmentBonusProvider();
    registry.projectileParams = createProjectileParamsProvider();
    registry.spellData = createSpellDataProvider();
    registry.runeData = createRuneDataProvider();
    registry.ammoData = createDefaultAmmoDataProvider();
}
