import type { ScriptModule } from "../../../src/game/scripts/types";
import { pandemoniumQuestModule } from "./pandemonium";

export {
    isPlayerOnDockedSailingBoat,
    restoreDockedSailingState,
    restoreSailingInstanceUi,
    resetSailingState,
} from "./pandemonium";

export const sailingModule: ScriptModule = {
    id: "vanilla-skills.sailing",
    register(registry, services) {
        pandemoniumQuestModule.register(registry, services);
    },
};
