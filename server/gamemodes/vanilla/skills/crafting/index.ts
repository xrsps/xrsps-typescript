import type { IScriptRegistry, ScriptServices } from "../../../../src/game/scripts/types";
import { register as registerFlax } from "./flax";
import { register as registerSpinning } from "./spinning";

export function register(registry: IScriptRegistry, services: ScriptServices): void {
    registerFlax(registry, services);
    registerSpinning(registry, services);
}
