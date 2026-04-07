import { SkillId } from "../../../../../src/rs/skill/skills";
import type { ActionEffect, ActionExecutionResult } from "../../../../src/game/actions/types";
import type { PlayerState } from "../../../../src/game/player";
import {
    HAMMER_ITEM_ID,
    SMITHING_RECIPES,
    type SmithingRecipe,
    getSmithingRecipeById,
} from "./smithingData";
import type { IScriptRegistry, ScriptActionHandlerContext, ScriptServices } from "../../../../src/game/scripts/types";
import {
    type InventoryEntry,
    type SkillDialogChoice,
    MAX_DIALOG_OPTIONS,
    SKILL_DIALOG_META,
    buildMessageEffect,
    buildSkillFailure,
    clampBatchCount,
    countItem,
    enqueueSkillAction,
    getInventory,
    hasItem,
} from "../production/shared";

interface SkillSmithActionData {
    recipeId: string;
    count: number;
}

const computeSmithBatchCount = (entries: InventoryEntry[], recipe: SmithingRecipe): number => {
    const totalBars = countItem(entries, recipe.barItemId);
    const per = Math.max(1, recipe.barCount);
    return clampBatchCount(Math.floor(totalBars / per));
};

function buildSmithingInterfaceFailure(
    player: PlayerState,
    message: string,
    reason: string,
    services: ScriptServices,
): ActionExecutionResult {
    const result = buildSkillFailure(player, message, reason);
    services.production?.updateSmithingInterface(player);
    return result;
}

export function executeSmithAction(ctx: ScriptActionHandlerContext): ActionExecutionResult {
    const { player, tick, services } = ctx;
    const data = ctx.data as SkillSmithActionData;
    const recipe = getSmithingRecipeById(data.recipeId);
    if (!recipe) {
        return buildSmithingInterfaceFailure(player, "You can't smith that.", "unknown_recipe", services);
    }

    const skill = services.skills.getSkill(player, SkillId.Smithing);
    if ((skill?.baseLevel ?? 1) < recipe.level) {
        return buildSmithingInterfaceFailure(player, `You need Smithing level ${recipe.level} to smith that.`, "smith_level", services);
    }

    if (recipe.requireHammer !== false && !services.inventory.playerHasItem(player, HAMMER_ITEM_ID)) {
        return buildSmithingInterfaceFailure(player, "You need a hammer to smith items.", "hammer", services);
    }

    const targetCount = Math.max(1, data.count);
    const removed = new Map<number, number>();
    const requiredBars = Math.max(1, recipe.barCount);

    for (let i = 0; i < requiredBars; i++) {
        const slot = services.inventory.findInventorySlotWithItem(player, recipe.barItemId);
        if (slot === undefined || !services.inventory.consumeItem(player, slot)) {
            services.production?.restoreInventoryItems(player, recipe.barItemId, removed);
            return buildSmithingInterfaceFailure(player, "You need more bars.", "missing_bars", services);
        }
        removed.set(slot, (removed.get(slot) ?? 0) + 1);
    }

    const firstSlot = removed.keys().next()?.value;
    if (firstSlot !== undefined) {
        services.inventory.setInventorySlot(player, firstSlot, recipe.outputItemId, Math.max(1, recipe.outputQuantity));
    } else {
        const dest = services.inventory.addItemToInventory(player, recipe.outputItemId, Math.max(1, recipe.outputQuantity));
        if (dest.added <= 0) {
            services.production?.restoreInventoryItems(player, recipe.barItemId, removed);
            return buildSmithingInterfaceFailure(player, "You need more inventory space to smith that.", "inventory_full", services);
        }
    }

    services.animation.playPlayerSeq(player, recipe.animation ?? 898);
    services.skills.addSkillXp(player, SkillId.Smithing, recipe.xp);
    services.system.eventBus?.emit("item:craft", { playerId: player.id, itemId: recipe.outputItemId, count: Math.max(1, recipe.outputQuantity) });

    const effects: ActionEffect[] = [
        { type: "inventorySnapshot", playerId: player.id },
        buildMessageEffect(player, `You smith ${recipe.outputQuantity > 1 ? `${recipe.outputQuantity} ${recipe.name}` : `a ${recipe.name}`}.`),
    ];

    const remaining = Math.max(0, targetCount - 1);
    if (remaining > 0) {
        const reschedule = services.combat.scheduleAction(player.id, {
            kind: "skill.smith", data: { recipeId: recipe.id, count: remaining },
            delayTicks: recipe.delayTicks ?? 4, cooldownTicks: recipe.delayTicks ?? 4,
            groups: ["skill.smith"],
        }, tick);
        if (!reschedule?.ok) {
            effects.push(buildMessageEffect(player, "You stop smithing because you're already busy."));
        }
    }

    services.production?.updateSmithingInterface(player);
    return { ok: true, cooldownTicks: recipe.delayTicks !== undefined ? Math.max(1, recipe.delayTicks) : 4, groups: ["skill.smith"], effects };
}

export function registerSmithingInteractions(registry: IScriptRegistry, services: ScriptServices) {
    const requestAction = services.combat.requestAction;
    const openDialogOptions = services.dialog.openDialogOptions;
    const closeDialog = services.dialog.closeDialog;

    const trySmithRecipe = (player: PlayerState, recipe: SmithingRecipe, tick?: number, opts?: { desiredCount?: number }) => {
        const smithLevel = services.skills.getSkill(player, SkillId.Smithing)?.baseLevel ?? 1;
        if (smithLevel < recipe.level) { services.messaging.sendGameMessage(player, `You need Smithing level ${recipe.level} to smith that.`); return; }
        const inventoryNow = getInventory(services, player);
        if (recipe.requireHammer !== false && !hasItem(inventoryNow, HAMMER_ITEM_ID)) { services.messaging.sendGameMessage(player, "You need a hammer to smith."); return; }
        const batch = computeSmithBatchCount(inventoryNow, recipe);
        if (batch <= 0) { services.messaging.sendGameMessage(player, "You need a suitable bar to smith."); return; }
        const desired = Math.max(1, Math.min(batch, opts?.desiredCount ?? batch));
        if (services.production?.smithItems) { services.production.smithItems(player, { recipeId: recipe.id, count: desired }); return; }
        enqueueSkillAction(requestAction, "smith", player, recipe.id, desired, recipe.delayTicks ?? 4, tick, services.messaging.sendGameMessage);
    };

    registry.registerLocAction("smith", (event) => {
        if (services.production?.openSmithingInterface) { services.production.openSmithingInterface(event.player); return; }
        const smithLevel = services.skills.getSkill(event.player, SkillId.Smithing)?.baseLevel ?? 1;
        const inventory = getInventory(services, event.player);
        if (!hasItem(inventory, HAMMER_ITEM_ID)) { services.messaging.sendGameMessage(event.player, "You need a hammer to smith."); return; }
        const candidateRecipes = SMITHING_RECIPES.filter((r) => hasItem(inventory, r.barItemId)).sort((a, b) => a.level - b.level);
        if (!candidateRecipes.length) { services.messaging.sendGameMessage(event.player, "You need metal bars to smith."); return; }
        const smithChoices: SkillDialogChoice<SmithingRecipe>[] = candidateRecipes.map((recipe) => {
            const available = computeSmithBatchCount(inventory, recipe);
            const levelMet = smithLevel >= recipe.level;
            const craftable = levelMet && available > 0;
            const label = craftable ? `${recipe.name} (${available}x ready)` : !levelMet ? `${recipe.name} (Lvl ${recipe.level})` : `${recipe.name} (${recipe.barCount}x bars needed)`;
            return { recipe, label, craftable, batch: Math.max(1, available) };
        });
        const craftableChoices = smithChoices.filter((c) => c.craftable);
        const orderedChoices = craftableChoices.concat(smithChoices.filter((c) => !c.craftable)).slice(0, MAX_DIALOG_OPTIONS);
        const meta = SKILL_DIALOG_META.smith;
        const openedDialog = openDialogOptions && orderedChoices.length > 0 && openDialogOptions(event.player, {
            id: meta.id, title: meta.title, modal: true,
            options: orderedChoices.map((c) => c.label),
            disabledOptions: orderedChoices.map((c) => !c.craftable),
            onSelect: (idx) => {
                const selected = orderedChoices[idx];
                if (!selected) { services.messaging.sendGameMessage(event.player, "You decide not to make anything."); return; }
                if (!selected.craftable) { services.messaging.sendGameMessage(event.player, "You can't smith that yet."); return; }
                closeDialog?.(event.player, meta.id);
                trySmithRecipe(event.player, selected.recipe, event.tick, { desiredCount: selected.batch });
            },
        });
        if (!openedDialog) {
            const fallback = craftableChoices[0];
            if (!fallback) { services.messaging.sendGameMessage(event.player, "You need a higher Smithing level or more bars."); return; }
            trySmithRecipe(event.player, fallback.recipe, event.tick, { desiredCount: fallback.batch });
        }
    });
}
