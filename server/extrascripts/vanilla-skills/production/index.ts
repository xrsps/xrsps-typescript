import type { IScriptRegistry, ScriptServices } from "../../../src/game/scripts/types";
import { executeBoltEnchantAction } from "./boltEnchant";
import { executeCookAction, registerCookingInteractions } from "./cooking";
import { executeSmeltAction, registerSmeltingInteractions } from "./smelting";
import { executeSmithAction, registerSmithingInteractions } from "./smithing";
import { executeTanAction, registerTanningInteractions } from "./tanning";

export function register(registry: IScriptRegistry, services: ScriptServices): void {
    registry.registerActionHandler("skill.smith", executeSmithAction);
    registry.registerActionHandler("skill.cook", executeCookAction);
    registry.registerActionHandler("skill.tan", executeTanAction);
    registry.registerActionHandler("skill.smelt", executeSmeltAction);
    registry.registerActionHandler("skill.bolt_enchant", executeBoltEnchantAction);

    registerSmithingInteractions(registry, services);
    registerCookingInteractions(registry, services);
    registerSmeltingInteractions(registry, services);
    registerTanningInteractions(registry, services);
}
