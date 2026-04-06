/**
 * Bridge module: delegates skill configuration to the registered SkillConfiguration provider.
 * The actual configuration lives in server/gamemodes/vanilla/combat/SkillConfiguration.ts.
 * The vanilla gamemode registers the provider during initialization.
 */
import type { SkillConfiguration } from "./SkillConfigurationProvider";
import type { SkillEntry } from "../state/PlayerSkillSystem";

export type { SkillConfiguration } from "./SkillConfigurationProvider";

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
