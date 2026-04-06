import type { IScriptRegistry, ScriptServices } from "../../../../src/game/scripts/types";
import { executeBoltEnchantAction } from "./boltEnchant";
import { executeCookAction, registerCookingInteractions } from "./cooking";
import { getCookingRecipeByRawItemId } from "./cookingData";
import { executeTanAction, registerTanningInteractions } from "./tanning";

export function register(registry: IScriptRegistry, services: ScriptServices): void {
    registry.registerActionHandler("skill.cook", executeCookAction);
    registry.registerActionHandler("skill.tan", executeTanAction);
    registry.registerActionHandler("skill.bolt_enchant", executeBoltEnchantAction);

    services.getCookingRecipeByRawItemId = (itemId) => {
        const recipe = getCookingRecipeByRawItemId(itemId);
        if (!recipe) return undefined;
        return { cookedItemId: recipe.cookedItemId, xp: recipe.xp };
    };

    registerCookingInteractions(registry, services);
    registerTanningInteractions(registry, services);
}
