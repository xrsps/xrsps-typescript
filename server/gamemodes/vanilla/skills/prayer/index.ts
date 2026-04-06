import type { IScriptRegistry, ScriptServices } from "../../../../src/game/scripts/types";
import { register as registerAltars } from "./altars";
import { register as registerPrayer } from "./prayer";

export function register(registry: IScriptRegistry, services: ScriptServices): void {
    registerPrayer(registry, services);
    registerAltars(registry, services);
}
