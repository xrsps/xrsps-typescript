import type { IScriptRegistry, ScriptServices } from "../../../src/game/scripts/types";
import { executeBoltEnchantAction } from "./boltEnchant";
import { executeCookAction, registerCookingInteractions } from "./cooking";
import { executeTanAction, registerTanningInteractions } from "./tanning";

export function register(registry: IScriptRegistry, services: ScriptServices): void {
    registry.registerActionHandler("skill.cook", executeCookAction);
    registry.registerActionHandler("skill.tan", executeTanAction);
    registry.registerActionHandler("skill.bolt_enchant", executeBoltEnchantAction);

    registerCookingInteractions(registry, services);
    registerTanningInteractions(registry, services);
}
