import { SKILL_IDS, SkillId } from "../../../../../src/rs/skill/skills";
import { RUN_ENERGY_MAX } from "../../../../src/game/actor";
import { type IScriptRegistry, type ScriptServices } from "../../../../src/game/scripts/types";
import { readPositiveEnvInteger } from "../utils/env";

const DEFAULT_TICK_MS = readPositiveEnvInteger("TICK_MS") ?? 600;

const secondsToTicks = (seconds: number): number =>
    Math.max(1, Math.round((seconds * 1000) / Math.max(1, DEFAULT_TICK_MS)));

type PoolDefinition = {
    locId: number;
    action: string;
    message: string;
    stamina?: { durationSeconds: number; multiplier: number };
    restoreStats?: boolean;
    restoreSpecial?: boolean;
    restorePrayer?: boolean;
    healHitpoints?: boolean;
    curePoison?: boolean;
    cureDisease?: boolean;
    cureVenom?: boolean;
};

const POH_POOLS: PoolDefinition[] = [
    {
        locId: 20639,
        action: "drink",
        message: "You feel a little better after using the restoration pool.",
        restoreStats: true,
    },
    {
        locId: 20640,
        action: "drink",
        message: "Energy surges through you as the revitalisation pool restores you.",
        restoreStats: true,
        restoreSpecial: true,
    },
    {
        locId: 20641,
        action: "drink",
        message: "You feel rejuvenated.",
        restoreStats: true,
        restoreSpecial: true,
        restorePrayer: true,
        healHitpoints: true,
    },
    {
        locId: 20642,
        action: "drink",
        message: "You feel rejuvenated.",
        restoreStats: true,
        restoreSpecial: true,
        restorePrayer: true,
        healHitpoints: true,
        curePoison: true,
        cureDisease: true,
        cureVenom: true,
    },
    {
        locId: 20643,
        action: "drink",
        message: "You feel completely revitalised by the ornate pool.",
        stamina: { durationSeconds: 120, multiplier: 0.3 },
        restoreStats: true,
        restoreSpecial: true,
        restorePrayer: true,
        healHitpoints: true,
        curePoison: true,
        cureDisease: true,
        cureVenom: true,
    },
];

export function registerPohPoolHandlers(registry: IScriptRegistry, services: ScriptServices): void {
    for (const pool of POH_POOLS) {
        registry.registerLocInteraction(
            pool.locId,
            ({ player, tick }) => {
                player.energy.setRunEnergyUnits(RUN_ENERGY_MAX);
                if (pool.restoreStats) {
                    for (const id of SKILL_IDS) {
                        if (id === SkillId.Hitpoints || id === SkillId.Prayer) continue;
                        const skill = player.skillSystem.getSkill(id);
                        player.skillSystem.setSkillBoost(id, skill.baseLevel);
                    }
                }
                if (pool.healHitpoints) {
                    const hpSkill = player.skillSystem.getSkill(SkillId.Hitpoints);
                    player.skillSystem.setSkillBoost(SkillId.Hitpoints, hpSkill.baseLevel);
                    player.skillSystem.setHitpointsCurrent(player.skillSystem.getHitpointsMax());
                }
                if (pool.restorePrayer) {
                    const prayer = player.skillSystem.getSkill(SkillId.Prayer);
                    player.skillSystem.setSkillBoost(SkillId.Prayer, prayer.baseLevel);
                }
                if (pool.restoreSpecial) {
                    player.specEnergy.setPercent(100);
                }
                if (pool.curePoison) player.skillSystem.curePoison();
                if (pool.cureDisease) player.skillSystem.cureDisease();
                if (pool.cureVenom) player.skillSystem.cureVenom();
                if (pool.stamina) {
                    const durationTicks = secondsToTicks(pool.stamina.durationSeconds);
                    player.energy.applyStaminaEffect(tick, durationTicks, pool.stamina.multiplier);
                }
                services.sendGameMessage(player, pool.message);
            },
            pool.action,
        );
    }
}
