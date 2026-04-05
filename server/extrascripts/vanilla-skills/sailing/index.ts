import type { IScriptRegistry, ScriptServices } from "../../../src/game/scripts/types";
import { register as registerPandemonium } from "./pandemonium";

export {
    isPlayerOnDockedSailingBoat,
    restoreDockedSailingState,
    restoreSailingInstanceUi,
    resetSailingState,
} from "./pandemonium";

export function register(registry: IScriptRegistry, services: ScriptServices): void {
    registerPandemonium(registry, services);
}
