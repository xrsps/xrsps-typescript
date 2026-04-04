import { SkillId } from "../../../../../../src/rs/skill/skills";
import type {
    SkillActionRequest,
    SkillFiremakingActionData,
} from "../../../actions/skillActionPayloads";
import {
    FIRE_LIGHTING_ANIMATION,
    FIREMAKING_LOG_IDS,
    TINDERBOX_ITEM_IDS,
    computeFireLightingDelayTicks,
    getFiremakingLogDefinition,
} from "../../../skills/firemaking";
import { type ScriptModule } from "../../types";

export const firemakingModule: ScriptModule = {
    id: "skills.firemaking",
    register(registry, services) {
        const requestAction = services.requestAction;
        for (const logId of FIREMAKING_LOG_IDS) {
            const logDef = getFiremakingLogDefinition(logId);
            if (!logDef) continue;
            for (const tinderboxId of TINDERBOX_ITEM_IDS) {
                registry.registerItemOnItem(
                    tinderboxId,
                    logDef.logId,
                    ({ player, source, target, tick }) => {
                        const level = player.getSkill(SkillId.Firemaking).baseLevel;
                        if (level < logDef.level) {
                            services.sendGameMessage(
                                player,
                                `You need Firemaking level ${logDef.level} to light these logs.`,
                            );
                            return;
                        }
                        const slot = source.itemId === logDef.logId ? source.slot : target.slot;
                        const delay = computeFireLightingDelayTicks(level);

                        // OSRS parity: animation starts immediately on the click tick, not
                        // after the lighting delay has elapsed.
                        services.playPlayerSeq?.(player, FIRE_LIGHTING_ANIMATION);

                        const request: SkillActionRequest<"skill.firemaking"> = {
                            kind: "skill.firemaking",
                            data: {
                                logItemId: logDef.logId,
                                tile: { x: player.tileX, y: player.tileY },
                                level: player.level,
                                slot,
                                started: false,
                                attempts: 0,
                                previousLocId: 0,
                            } satisfies SkillFiremakingActionData,
                            delayTicks: delay,
                            cooldownTicks: delay,
                            groups: ["skill.firemaking"],
                        };
                        const result = requestAction(player, request, tick);
                        if (!result.ok) {
                            services.sendGameMessage(
                                player,
                                "You're too busy to do that right now.",
                            );
                        }
                    },
                );
            }
        }

    },
};
