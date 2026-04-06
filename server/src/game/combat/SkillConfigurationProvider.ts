import type { SkillEntry } from "../state/PlayerSkillSystem";

export interface SkillConfiguration {
    computeCombatLevel(skills: SkillEntry[]): number;
    skillRestoreIntervalTicks: number;
    skillBoostDecayIntervalTicks: number;
    hitpointRegenIntervalTicks: number;
    hitpointOverhealDecayIntervalTicks: number;
    preserveDecayMultiplier: number;
}

// =============================================================================
// Provider Registration & Delegation
// =============================================================================

let _config: SkillConfiguration | undefined;

export function registerSkillConfiguration(config: SkillConfiguration): void {
    _config = config;
}

export function getSkillConfiguration(): SkillConfiguration | undefined {
    return _config;
}

function ensureConfig(): SkillConfiguration {
    if (!_config) {
        throw new Error("[SkillConfiguration] SkillConfiguration not registered. Ensure the gamemode has initialized.");
    }
    return _config;
}

export function computeCombatLevel(skills: SkillEntry[]): number {
    return ensureConfig().computeCombatLevel(skills);
}

export function getSkillRestoreIntervalTicks(): number {
    return ensureConfig().skillRestoreIntervalTicks;
}

export function getSkillBoostDecayIntervalTicks(): number {
    return ensureConfig().skillBoostDecayIntervalTicks;
}

export function getHitpointRegenIntervalTicks(): number {
    return ensureConfig().hitpointRegenIntervalTicks;
}

export function getHitpointOverhealDecayIntervalTicks(): number {
    return ensureConfig().hitpointOverhealDecayIntervalTicks;
}

export function getPreserveDecayMultiplier(): number {
    return ensureConfig().preserveDecayMultiplier;
}
