import { SkillId } from "../../../../../src/rs/skill/skills";
import type { ActionEffect, ActionExecutionResult } from "../../../../src/game/actions/types";
import type { PlayerState } from "../../../../src/game/player";
import {
    COOKING_RECIPES,
    type CookingHeatSource,
    type CookingRecipe,
    DEFAULT_COOKING_BURN_BONUS,
    getCookingRecipeById,
    getCookingRecipeByRawItemId,
    rollCookingOutcome,
} from "./cookingData";
import { ANY_LOC_ID, type IScriptRegistry, type ScriptActionHandlerContext, type ScriptServices } from "../../../../src/game/scripts/types";
import {
    type SkillDialogChoice,
    MAX_BATCH,
    MAX_DIALOG_OPTIONS,
    SKILL_DIALOG_META,
    buildMessageEffect,
    buildSkillFailure,
    countItem,
    enqueueSkillAction,
    getInventory,
    hasItem,
    resolveCookingHeatSource,
} from "./shared";

interface SkillCookActionData {
    recipeId: string;
    count: number;
    heatSource?: "fire" | "range";
}

export function executeCookAction(ctx: ScriptActionHandlerContext): ActionExecutionResult {
    const { player, tick, services } = ctx;
    const data = ctx.data as SkillCookActionData;
    const recipe = getCookingRecipeById(data.recipeId);
    if (!recipe) {
        return buildSkillFailure(player, "You can't cook that.", "unknown_recipe");
    }

    const skill = services.skills.getSkill(player, SkillId.Cooking);
    const effectiveLevel = Math.max(1, (skill?.baseLevel ?? 1) + (skill?.boost ?? 0));
    if (effectiveLevel < recipe.level) {
        return buildSkillFailure(player, `You need Cooking level ${recipe.level} to cook that.`, "cook_level");
    }

    const slot = services.inventory.findInventorySlotWithItem(player, recipe.rawItemId);
    if (slot === undefined || !services.inventory.consumeItem(player, slot)) {
        return buildSkillFailure(player, "You need raw food to cook.", "missing_item");
    }

    const targetCount = Math.max(1, data.count);
    const heatSourceRaw = String(data.heatSource ?? "").toLowerCase();
    const heatSource = heatSourceRaw === "fire" ? "fire" : "range";
    const burnBonus = heatSource === "fire" ? 0 : DEFAULT_COOKING_BURN_BONUS;

    const outcome = rollCookingOutcome(recipe, effectiveLevel, { burnBonus });
    const cooked = outcome === "success";
    const burntItemId = recipe.burntItemId ?? -1;
    const producedItemId = cooked || !(burntItemId > 0) ? recipe.cookedItemId : burntItemId;

    services.inventory.setInventorySlot(player, slot, producedItemId, 1);
    services.animation.playPlayerSeq(player, recipe.animation ?? 897);

    if (cooked) {
        services.skills.addSkillXp(player, SkillId.Cooking, recipe.xp);
        services.system.eventBus?.emit("item:craft", { playerId: player.id, itemId: recipe.cookedItemId, count: 1 });
    }

    const effects: ActionEffect[] = [
        { type: "inventorySnapshot", playerId: player.id },
        buildMessageEffect(player, cooked ? `You cook the ${recipe.name}.` : `You accidentally burn the ${recipe.name}.`),
    ];

    const remaining = Math.max(0, targetCount - 1);
    if (remaining > 0) {
        const reschedule = services.combat.scheduleAction(player.id, {
            kind: "skill.cook", data: { recipeId: recipe.id, count: remaining, heatSource },
            delayTicks: recipe.delayTicks ?? 3, cooldownTicks: recipe.delayTicks ?? 3,
            groups: ["skill.cook"],
        }, tick);
        if (!reschedule?.ok) {
            effects.push(buildMessageEffect(player, "You stop cooking because you're already busy."));
        }
    }

    return { ok: true, cooldownTicks: recipe.delayTicks !== undefined ? Math.max(1, recipe.delayTicks) : 3, groups: ["skill.cook"], effects };
}

export function registerCookingInteractions(registry: IScriptRegistry, services: ScriptServices) {
    const requestAction = services.combat.requestAction;
    const openDialogOptions = services.dialog.openDialogOptions;
    const closeDialog = services.dialog.closeDialog;

    const tryCookingRecipe = (player: PlayerState, recipe: CookingRecipe, tick?: number, opts?: { desiredCount?: number; heatSource?: CookingHeatSource }) => {
        const cookLevel = services.skills.getSkill(player, SkillId.Cooking)?.baseLevel ?? 1;
        if (cookLevel < recipe.level) { services.messaging.sendGameMessage(player, `You need Cooking level ${recipe.level} to cook that.`); return; }
        const inventoryNow = getInventory(services, player);
        const batch = Math.max(0, Math.min(MAX_BATCH, countItem(inventoryNow, recipe.rawItemId)));
        if (batch <= 0) { services.messaging.sendGameMessage(player, "You need something raw to cook."); return; }
        const desired = Math.max(1, Math.min(batch, opts?.desiredCount ?? batch));
        enqueueSkillAction(requestAction, "cook", player, recipe.id, desired, recipe.delayTicks ?? 3, tick, services.messaging.sendGameMessage, opts?.heatSource ? { heatSource: opts.heatSource } : undefined);
    };

    registry.registerLocAction("cook", (event) => {
        const level = services.skills.getSkill(event.player, SkillId.Cooking)?.baseLevel ?? 1;
        const inventory = getInventory(services, event.player);
        const heatSource = resolveCookingHeatSource(services, event.locId);
        const cookingCandidates = COOKING_RECIPES.filter((r) => hasItem(inventory, r.rawItemId)).map<SkillDialogChoice<CookingRecipe>>((recipe) => {
            const totalRaw = countItem(inventory, recipe.rawItemId);
            const levelMet = level >= recipe.level;
            const craftable = levelMet && totalRaw > 0;
            const readyCount = Math.max(1, Math.min(MAX_BATCH, totalRaw));
            const label = craftable ? `${recipe.name} (${readyCount}x ready)` : !levelMet ? `${recipe.name} (Lvl ${recipe.level})` : `${recipe.name} (${totalRaw} raw)`;
            return { recipe, label, craftable, batch: readyCount };
        });
        if (!cookingCandidates.length) { services.messaging.sendGameMessage(event.player, "You need something raw to cook."); return; }
        const craftableChoices = cookingCandidates.filter((c) => c.craftable);
        const orderedChoices = craftableChoices.concat(cookingCandidates.filter((c) => !c.craftable)).slice(0, MAX_DIALOG_OPTIONS);
        const meta = SKILL_DIALOG_META.cook;
        const openedDialog = openDialogOptions && orderedChoices.length > 0 && openDialogOptions(event.player, {
            id: meta.id, title: meta.title, modal: true,
            options: orderedChoices.map((c) => c.label),
            disabledOptions: orderedChoices.map((c) => !c.craftable),
            onSelect: (idx) => {
                const selected = orderedChoices[idx];
                if (!selected) { services.messaging.sendGameMessage(event.player, "You stop cooking."); return; }
                if (!selected.craftable) { services.messaging.sendGameMessage(event.player, "You can't cook that yet."); return; }
                closeDialog?.(event.player, meta.id);
                tryCookingRecipe(event.player, selected.recipe, event.tick, { desiredCount: selected.batch, heatSource });
            },
        });
        if (!openedDialog) {
            const fallback = craftableChoices[0];
            if (!fallback) { services.messaging.sendGameMessage(event.player, "You need a higher Cooking level."); return; }
            tryCookingRecipe(event.player, fallback.recipe, event.tick, { desiredCount: fallback.batch, heatSource });
        }
    });

    const rawItemIds = new Set(COOKING_RECIPES.map((r) => r.rawItemId));
    for (const rawItemId of rawItemIds) {
        registry.registerItemOnLoc(rawItemId, ANY_LOC_ID, (event) => {
            const tile = event.target.tile;
            const level = event.target.level;
            const fire = services.gathering?.getTracker("firemaking")?.hasTile(tile, level);
            if (!fire) return;
            const recipe = getCookingRecipeByRawItemId(event.source.itemId);
            if (!recipe) return;
            const player = event.player;
            const delay = recipe.delayTicks !== undefined ? Math.max(1, recipe.delayTicks) : 4;
            const result = services.combat.requestAction(
                player,
                {
                    kind: "skill.cook",
                    data: {
                        recipeId: recipe.id,
                        count: 1,
                        heatSource: "fire" as CookingHeatSource,
                    },
                    delayTicks: delay,
                    cooldownTicks: delay,
                    groups: ["skill.cook"],
                },
                event.tick,
            );
            if (!result.ok) {
                services.messaging.sendGameMessage(player, "You're too busy to do that right now.");
                return;
            }
            services.messaging.sendGameMessage(player, "You start cooking.");
        });
    }
}
