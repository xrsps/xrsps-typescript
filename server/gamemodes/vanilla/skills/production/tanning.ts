import { SkillId } from "../../../../../src/rs/skill/skills";
import type { ActionEffect, ActionExecutionResult } from "../../../../src/game/actions/types";
import type { PlayerState } from "../../../../src/game/player";
import {
    TANNING_RECIPES,
    type TanningRecipe,
    getTanningRecipeById,
} from "./tanningData";
import type { IScriptRegistry, ScriptActionHandlerContext, ScriptServices } from "../../../../src/game/scripts/types";
import {
    type SkillDialogChoice,
    MAX_BATCH,
    MAX_DIALOG_OPTIONS,
    SKILL_DIALOG_META,
    buildMessageEffect,
    buildSkillFailure,
    clampBatchCount,
    countItem,
    enqueueSkillAction,
    getInventory,
    hasItem,
} from "./shared";

interface SkillTanActionData {
    recipeId: string;
    count: number;
}

const computeTanningBatchCount = (entries: { itemId: number; quantity: number }[], recipe: TanningRecipe): number => {
    const total = countItem(entries, recipe.inputItemId);
    return clampBatchCount(total);
};

export function executeTanAction(ctx: ScriptActionHandlerContext): ActionExecutionResult {
    const { player, tick, services } = ctx;
    const data = ctx.data as SkillTanActionData;
    const recipe = getTanningRecipeById(data.recipeId);
    if (!recipe) {
        return buildSkillFailure(player, "You can't tan that.", "unknown_recipe");
    }

    const skill = services.getSkill?.(player, SkillId.Crafting);
    if (recipe.level && (skill?.baseLevel ?? 1) < recipe.level) {
        return buildSkillFailure(player, `You need Crafting level ${recipe.level} to tan that.`, "tan_level");
    }

    const slot = services.findInventorySlotWithItem?.(player, recipe.inputItemId);
    if (slot === undefined || !services.consumeItem(player, slot)) {
        return buildSkillFailure(player, "You need hides to tan.", "missing_item");
    }

    const targetCount = Math.max(1, data.count);
    services.setInventorySlot(player, slot, recipe.outputItemId, 1);
    services.playPlayerSeq?.(player, recipe.animation ?? 1249);
    services.addSkillXp?.(player, SkillId.Crafting, recipe.xp);

    const effects: ActionEffect[] = [
        { type: "inventorySnapshot", playerId: player.id },
        buildMessageEffect(player, `You tan the hide into ${recipe.name}.`),
    ];

    const remaining = Math.max(0, targetCount - 1);
    if (remaining > 0) {
        const reschedule = services.scheduleAction?.(player.id, {
            kind: "skill.tan", data: { recipeId: recipe.id, count: remaining },
            delayTicks: recipe.delayTicks ?? 2, cooldownTicks: recipe.delayTicks ?? 2,
            groups: ["skill.tan"],
        }, tick);
        if (!reschedule?.ok) {
            effects.push(buildMessageEffect(player, "You stop tanning because you're already busy."));
        }
    }

    return { ok: true, cooldownTicks: recipe.delayTicks !== undefined ? Math.max(1, recipe.delayTicks) : 2, groups: ["skill.tan"], effects };
}

export function registerTanningInteractions(registry: IScriptRegistry, services: ScriptServices) {
    const requestAction = services.requestAction;
    const openDialogOptions = services.openDialogOptions;
    const closeDialog = services.closeDialog;

    const tryTanningRecipe = (player: PlayerState, recipe: TanningRecipe, tick?: number, opts?: { desiredCount?: number }) => {
        const craftLevel = services.getSkill?.(player, SkillId.Crafting)?.baseLevel ?? 1;
        if (recipe.level && craftLevel < recipe.level) { services.sendGameMessage(player, `You need Crafting level ${recipe.level} to tan that.`); return; }
        const inventoryNow = getInventory(services, player);
        const batch = computeTanningBatchCount(inventoryNow, recipe);
        if (batch <= 0) { services.sendGameMessage(player, "You need hides to tan."); return; }
        const desired = Math.max(1, Math.min(batch, opts?.desiredCount ?? batch));
        enqueueSkillAction(requestAction, "tan", player, recipe.id, desired, recipe.delayTicks ?? 2, tick, services.sendGameMessage);
    };

    registry.registerLocAction("tan", (event) => {
        const level = services.getSkill?.(event.player, SkillId.Crafting)?.baseLevel ?? 1;
        const inventory = getInventory(services, event.player);
        const tanningCandidates = TANNING_RECIPES.filter((r) => hasItem(inventory, r.inputItemId)).map<SkillDialogChoice<TanningRecipe>>((recipe) => {
            const totalHides = countItem(inventory, recipe.inputItemId);
            const levelMet = !recipe.level || level >= recipe.level;
            const craftable = levelMet && totalHides > 0;
            const readyCount = Math.max(1, Math.min(MAX_BATCH, totalHides));
            const label = craftable ? `${recipe.name} (${readyCount}x ready)` : !levelMet ? `${recipe.name} (Lvl ${recipe.level})` : `${recipe.name} (${totalHides} hides)`;
            return { recipe, label, craftable, batch: readyCount };
        });
        if (!tanningCandidates.length) { services.sendGameMessage(event.player, "You need hides to tan."); return; }
        const craftableChoices = tanningCandidates.filter((c) => c.craftable);
        const orderedChoices = craftableChoices.concat(tanningCandidates.filter((c) => !c.craftable)).slice(0, MAX_DIALOG_OPTIONS);
        const meta = SKILL_DIALOG_META.tan;
        const openedDialog = openDialogOptions && orderedChoices.length > 0 && openDialogOptions(event.player, {
            id: meta.id, title: meta.title, modal: true,
            options: orderedChoices.map((c) => c.label),
            disabledOptions: orderedChoices.map((c) => !c.craftable),
            onSelect: (idx) => {
                const selected = orderedChoices[idx];
                if (!selected) { services.sendGameMessage(event.player, "You decide not to tan any hides."); return; }
                if (!selected.craftable) { services.sendGameMessage(event.player, "You can't tan that yet."); return; }
                closeDialog?.(event.player, meta.id);
                tryTanningRecipe(event.player, selected.recipe, event.tick, { desiredCount: selected.batch });
            },
        });
        if (!openedDialog) {
            const fallback = craftableChoices[0];
            if (!fallback) { services.sendGameMessage(event.player, "You need a higher Crafting level."); return; }
            tryTanningRecipe(event.player, fallback.recipe, event.tick, { desiredCount: fallback.batch });
        }
    });
}
