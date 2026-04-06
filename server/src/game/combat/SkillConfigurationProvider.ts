import type { SkillEntry } from "../state/PlayerSkillSystem";

export interface SkillConfiguration {
    computeCombatLevel(skills: SkillEntry[]): number;
    skillRestoreIntervalTicks: number;
    skillBoostDecayIntervalTicks: number;
    hitpointRegenIntervalTicks: number;
    hitpointOverhealDecayIntervalTicks: number;
    preserveDecayMultiplier: number;
}
