import type { IScriptRegistry, ScriptServices } from "../../../../src/game/scripts/types";
import { register as registerPicklock } from "./picklock";
import { register as registerPickpocket } from "./pickpocket";

export function register(registry: IScriptRegistry, services: ScriptServices): void {
    registerPickpocket(registry, services);
    registerPicklock(registry, services);
}
