import { ANY_LOC_ID, type IScriptRegistry, type ScriptServices } from "../../../src/game/scripts/types";
import { executeSmeltAction, registerSmeltingInteractions } from "./smelting";
import { executeSmithAction, registerSmithingInteractions } from "./smithing";
import { SMITHING_RECIPES } from "./smithingData";
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

    const barItemIds = new Set(SMITHING_RECIPES.map((r) => r.barItemId));
    const SMITHING_BAR_TYPE_VARBIT_ID = 3216;
    for (const barItemId of barItemIds) {
        registry.registerItemOnLoc(barItemId, ANY_LOC_ID, (event) => {
            const locId = event.target.locId;
            const locDef = services.getLocDefinition?.(locId);
            if (!locDef) return;
            const actions = locDef.ops ?? [];
            if (!actions.some((a: string) => a?.toLowerCase() === "smith")) return;
            const barType = smithingUI.getBarTypeByItemId(event.source.itemId);
            if (!(barType !== undefined && barType > 0)) return;
            const player = event.player;
            player.setVarbitValue(SMITHING_BAR_TYPE_VARBIT_ID, barType);
            services.production?.openSmithingInterface?.(player);
        });
    }
}
