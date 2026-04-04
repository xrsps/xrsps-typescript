import type { SkillActionRequest, SkillMiningActionData } from "../../actions/skillActionPayloads";
import { type ScriptModule } from "../types";

const MINING_ACTIONS = ["mine", "mine rocks"];

export const miningModule: ScriptModule = {
    id: "skills.mining",
    register(registry, services) {
        if (!services.getMiningRock) {
            services.logger?.warn?.("[script:mining] rock lookup unavailable; module disabled");
            return;
        }
        for (const action of MINING_ACTIONS) {
            registry.registerLocAction(action, (event) => {
                const rock = services.getMiningRock?.(event.locId);
                if (!rock) return;
                // OSRS parity: start mining immediately on interaction; first success roll is delayed in action logic.
                const delay = 0;
                const request: SkillActionRequest<"skill.mine"> = {
                    kind: "skill.mine",
                    data: {
                        rockId: rock.id,
                        rockLocId: event.locId,
                        depletedLocId: rock.depletedLocId,
                        tile: { x: event.tile.x, y: event.tile.y },
                        level: event.level,
                        started: false,
                        echoMinedCount: 0,
                    } satisfies SkillMiningActionData,
                    delayTicks: delay,
                    cooldownTicks: delay,
                    groups: ["skill.mine"],
                };
                const result = services.requestAction(event.player, request, event.tick);
                if (!result.ok) {
                    services.sendGameMessage(event.player, "You're too busy to do that right now.");
                }
            });
        }
    },
};
