import type {
    SkillActionRequest,
    SkillWoodcuttingActionData,
} from "../../actions/skillActionPayloads";
import { type ScriptModule } from "../types";

const WOODCUT_ACTIONS = ["chop down", "chop-down"];

export const woodcuttingModule: ScriptModule = {
    id: "skills.woodcutting",
    register(registry, services) {
        if (!services.getWoodcuttingTree) {
            services.logger?.warn?.(
                "[script:woodcutting] tree lookup unavailable; module disabled",
            );
            return;
        }
        for (const action of WOODCUT_ACTIONS) {
            registry.registerLocAction(action, (event) => {
                const tree = services.getWoodcuttingTree?.(event.locId);
                if (!tree) return;
                // OSRS: start chopping immediately on interaction; the first success roll happens later.
                const delay = 0;
                const request: SkillActionRequest<"skill.woodcut"> = {
                    kind: "skill.woodcut",
                    data: {
                        treeId: tree.id,
                        treeLocId: event.locId,
                        stumpId: tree.stumpId,
                        tile: { x: event.tile.x, y: event.tile.y },
                        level: event.level,
                        started: false,
                        ticksInSwing: 0,
                    } satisfies SkillWoodcuttingActionData,
                    delayTicks: delay,
                    cooldownTicks: delay,
                    groups: ["skill.woodcut"],
                };
                const result = services.requestAction(event.player, request, event.tick);
                if (!result.ok) {
                    services.sendGameMessage(event.player, "You're too busy to do that right now.");
                    services.logger?.warn?.(
                        "[woodcutting.script] requestAction failed",
                        JSON.stringify({ player: event.player.id, reason: result.reason }),
                    );
                }
            });
        }
    },
};
