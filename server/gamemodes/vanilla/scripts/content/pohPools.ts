import { SKILL_IDS, SkillId } from "../../../../../src/rs/skill/skills";
import { RUN_ENERGY_MAX } from "../../../../src/game/actor";
import { type IScriptRegistry, type ScriptServices } from "../../../../src/game/scripts/types";
import { readPositiveEnvInteger } from "../../../../src/game/scripts/utils/env";

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
                player.setRunEnergyUnits(RUN_ENERGY_MAX);
                if (pool.restoreStats) {
                    for (const id of SKILL_IDS) {
                        if (id === SkillId.Hitpoints || id === SkillId.Prayer) continue;
                        const skill = player.getSkill(id);
                        player.setSkillBoost(id, skill.baseLevel);
                    }
                }
                if (pool.healHitpoints) {
                    const hpSkill = player.getSkill(SkillId.Hitpoints);
                    player.setSkillBoost(SkillId.Hitpoints, hpSkill.baseLevel);
                    player.setHitpointsCurrent(player.getHitpointsMax());
                }
                if (pool.restorePrayer) {
                    const prayer = player.getSkill(SkillId.Prayer);
                    player.setSkillBoost(SkillId.Prayer, prayer.baseLevel);
                }
                if (pool.restoreSpecial) {
                    player.setSpecialEnergyPercent(100);
                }
                if (pool.curePoison) player.curePoison();
                if (pool.cureDisease) player.cureDisease();
                if (pool.cureVenom) player.cureVenom();
                if (pool.stamina) {
                    const durationTicks = secondsToTicks(pool.stamina.durationSeconds);
                    player.applyStaminaEffect(tick, durationTicks, pool.stamina.multiplier);
                }
                services.sendGameMessage(player, pool.message);
            },
            pool.action,
        );
    }
}
