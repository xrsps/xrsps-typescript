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

import { getProviderRegistry } from "../providers/ProviderRegistry";

export function registerSkillConfiguration(config: SkillConfiguration): void {
    getProviderRegistry().skillConfiguration = config;
}

export function getSkillConfiguration(): SkillConfiguration | undefined {
    return getProviderRegistry().skillConfiguration;
}

function ensureConfig(): SkillConfiguration {
    const c = getProviderRegistry().skillConfiguration;
    if (!c) {
        throw new Error("[SkillConfiguration] SkillConfiguration not registered. Ensure the gamemode has initialized.");
    }
    return c;
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
