import type { SkillConfiguration } from "../../../src/game/combat/SkillConfigurationProvider";
import type { SkillEntry } from "../../../src/game/state/PlayerSkillSystem";
import { SkillId } from "../../../../src/rs/skill/skills";

function computeCombatLevel(skills: SkillEntry[]): number {
    const attack = skills[SkillId.Attack].baseLevel;
    const defence = skills[SkillId.Defence].baseLevel;
    const strength = skills[SkillId.Strength].baseLevel;
    const hitpoints = skills[SkillId.Hitpoints].baseLevel;
    const prayer = skills[SkillId.Prayer].baseLevel;
    const ranged = skills[SkillId.Ranged].baseLevel;
    const magic = skills[SkillId.Magic].baseLevel;
    const base = 0.25 * (defence + hitpoints + Math.floor(prayer / 2));
    const melee = 0.325 * (attack + strength);
    const ranger = 0.325 * Math.floor(ranged * 1.5);
    const mage = 0.325 * Math.floor(magic * 1.5);
    return Math.floor(base + Math.max(melee, ranger, mage));
}

export function createSkillConfiguration(): SkillConfiguration {
    return {
        computeCombatLevel,
        skillRestoreIntervalTicks: 100,
        skillBoostDecayIntervalTicks: 100,
        hitpointRegenIntervalTicks: 100,
        hitpointOverhealDecayIntervalTicks: 100,
        preserveDecayMultiplier: 1.5,
    };
}
