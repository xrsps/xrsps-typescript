import { faceAngleRs } from "../../../../../../src/rs/utils/rotation";
import { SkillId } from "../../../../../../src/rs/skill/skills";
import {
    FLAX_ITEM_ID,
    FLAX_LOC_IDS,
    FLAX_PICK_ANIMATION_ID,
    FLAX_PICK_DELAY_TICKS,
    FLAX_PICK_XP,
    isFlaxLocId,
} from "../../../skills/flax";
import { type ScriptModule } from "../../types";

const FLAX_ACTIONS = ["pick", "pick-flax"];
const FLAX_GROUP = "skill.flax";

export const flaxModule: ScriptModule = {
    id: "skills.flax",
    register(registry, services) {
        const requestAction = services.requestAction;
        const registerLoc = (locId: number, action: string) => {
            registry.registerLocInteraction(
                locId,
                (event) => {
                    if (!isFlaxLocId(event.locId)) {
                        return;
                    }
                    const result = requestAction(
                        event.player,
                        {
                            kind: "skill.flax",
                            data: {
                                recipeId: "flax_to_bowstring",
                                count: 1,
                                locId: event.locId,
                                tile: { x: event.tile.x, y: event.tile.y },
                                level: event.level,
                            },
                            delayTicks: 0,
                            cooldownTicks: FLAX_PICK_DELAY_TICKS,
                            groups: [FLAX_GROUP],
                        },
                        event.tick,
                    );
                    if (!result.ok) {
                        services.sendGameMessage(
                            event.player,
                            "You're too busy to pick flax right now.",
                        );
                    } else {
                        // Force a face action immediately to reduce perceived delay
                        const rot = faceAngleRs(
                            event.player.tileX,
                            event.player.tileY,
                            event.tile.x,
                            event.tile.y,
                        );
                        event.player.faceRot(rot);
                    }
                },
                action,
            );
        };

        for (const locId of FLAX_LOC_IDS) {
            for (const action of FLAX_ACTIONS) {
                registerLoc(locId, action);
            }
        }
    },
};
