import type { IScriptRegistry, ScriptServices } from "../../../src/game/scripts/types";
import { executeSmeltAction, registerSmeltingInteractions } from "./smelting";
import { executeSmithAction, registerSmithingInteractions } from "./smithing";
import { SmithingUI } from "./smithingUI";

export function register(registry: IScriptRegistry, services: ScriptServices): void {
    registry.registerActionHandler("skill.smith", executeSmithAction);
    registry.registerActionHandler("skill.smelt", executeSmeltAction);

    const smithingUI = new SmithingUI(services);

    const production = services.production;
    if (production) {
        production.openSmeltingInterface = (player) => smithingUI.openSmeltingInterface(player);
        production.openForgeInterface = (player) => smithingUI.openForgeInterface(player);
        production.openSmithingInterface = (player) => smithingUI.openSmithingInterface(player);
        production.smeltBars = (player, params) =>
            smithingUI.handleSmeltingSelection(player, params.recipeId, params.count > 0 ? params.count : undefined);
        production.smithItems = (player, params) =>
            smithingUI.handleSmithingSelection(player, params.recipeId, params.count > 0 ? params.count : undefined);
        production.updateSmithingInterface = (player) => smithingUI.updateSmithingInterface(player);
        production.updateSmeltingInterface = (player) => smithingUI.updateSmeltingInterface(player);
        production.getBarTypeByItemId = (itemId) => smithingUI.getBarTypeByItemId(itemId);
    }

    registry.registerClientMessageHandler("smithing_make", (event) => {
        const recipeId = (event.payload.recipeId as string) ?? "";
        const mode = event.payload.mode === "forge" ? "forge" : "smelt";
        if (mode === "forge") smithingUI.handleSmithingSelection(event.player, recipeId);
        else smithingUI.handleSmeltingSelection(event.player, recipeId);
    });

    registry.registerClientMessageHandler("smithing_mode", (event) => {
        smithingUI.handleModeChange(
            event.player,
            (event.payload.mode as number) ?? event.player.getSmithingQuantityMode(),
            event.payload.custom as number | undefined,
        );
    });

    registerSmithingInteractions(registry, services);
    registerSmeltingInteractions(registry, services);
}
