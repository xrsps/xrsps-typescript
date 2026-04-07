import { SkillId } from "../../../../../src/rs/skill/skills";
import type { ActionEffect, ActionExecutionResult } from "../../../../src/game/actions/types";
import type { PlayerState } from "../../../../src/game/player";
import {
    SMELTING_RECIPES,
    type SmeltingRecipe,
    calculateIronSmeltChance,
    computeSmeltingBatchCount,
    getSmeltingRecipeById,
} from "./smithingData";
import {
    consumeRingOfForgingCharge,
    getRingOfForgingCharges,
    getSmeltingXpWithBonuses,
    shouldGuaranteeIronSmelt,
} from "./smithingBonuses";
import type { IScriptRegistry, ScriptActionHandlerContext, ScriptServices } from "../../../../src/game/scripts/types";
import {
    type SkillDialogChoice,
    MAX_BATCH,
    MAX_DIALOG_OPTIONS,
    SKILL_DIALOG_META,
    buildMessageEffect,
    buildSkillFailure,
    clampBatchCount,
    enqueueSkillAction,
    getInventory,
} from "../production/shared";

const FURNACE_ANIMATION = 899;

interface SkillSmeltActionData {
    recipeId: string;
    count: number;
}

function buildSmeltInterfaceFailure(player: PlayerState, message: string, reason: string, services: ScriptServices): ActionExecutionResult {
    const result = buildSkillFailure(player, message, reason);
    services.production?.updateSmeltingInterface(player);
    return result;
}

function firstRemovedSlot(removed: Map<number, { itemId: number; quantity: number }>): number | undefined {
    for (const [slot] of removed) return slot;
    return undefined;
}

function describeBar(services: ScriptServices, itemId: number): string {
    return services.data.getObjType(itemId)?.name ?? "bar";
}

function rollSmeltingSuccess(level: number, recipe: SmeltingRecipe, equip: number[], ringCharges?: number): boolean {
    if (shouldGuaranteeIronSmelt(recipe, equip, ringCharges)) return true;
    if (recipe.successType === "iron") {
        const chance = calculateIronSmeltChance(level);
        return Math.random() < chance;
    }
    return true;
}

export function executeSmeltAction(ctx: ScriptActionHandlerContext): ActionExecutionResult {
    const { player, tick, services } = ctx;
    const data = ctx.data as SkillSmeltActionData;
    const recipe = getSmeltingRecipeById(data.recipeId);
    if (!recipe) {
        return buildSmeltInterfaceFailure(player, "You can't smelt that bar.", "unknown_recipe", services);
    }

    const skill = services.skills.getSkill(player, SkillId.Smithing);
    if ((skill?.baseLevel ?? 1) < recipe.level) {
        return buildSmeltInterfaceFailure(player, `You need Smithing level ${recipe.level} to smelt that.`, "smelt_level", services);
    }

    const removal = services.production?.takeInventoryItems(player, recipe.inputs as Array<{ itemId: number; quantity: number }>);
    if (!removal?.ok) {
        return buildSmeltInterfaceFailure(player, "You need the right ores to smelt that.", "missing_ore", services);
    }

    const targetCount = Math.max(1, data.count);
    const delay = recipe.delayTicks !== undefined ? Math.max(1, recipe.delayTicks) : 4;
    const effects: ActionEffect[] = [];

    const equip = services.equipment.getEquipArray(player) ?? [];
    const ringCharges = recipe.successType === "iron" ? getRingOfForgingCharges(player) : undefined;
    const success = rollSmeltingSuccess(skill?.baseLevel ?? 1, recipe, equip, ringCharges);

    if (success) {
        const fSlot = firstRemovedSlot(removal.removed);
        if (fSlot !== undefined) {
            services.inventory.setInventorySlot(player, fSlot, recipe.outputItemId, Math.max(1, recipe.outputQuantity));
        } else {
            const dest = services.inventory.addItemToInventory(player, recipe.outputItemId, Math.max(1, recipe.outputQuantity));
            if (dest.added <= 0) {
                services.production?.restoreInventoryRemovals(player, removal.removed);
                return buildSmeltInterfaceFailure(player, "You need more inventory space for the bar.", "inventory_full", services);
            }
        }

        services.animation.playPlayerSeq(player, recipe.animation ?? FURNACE_ANIMATION);
        const xpAward = getSmeltingXpWithBonuses(recipe, equip);
        services.skills.addSkillXp(player, SkillId.Smithing, xpAward);
        services.system.eventBus?.emit("item:craft", { playerId: player.id, itemId: recipe.outputItemId, count: Math.max(1, recipe.outputQuantity) });
        const barName = describeBar(services, recipe.outputItemId);
        effects.push(
            { type: "inventorySnapshot", playerId: player.id },
            buildMessageEffect(player, `You retrieve a ${barName.toLowerCase()}.`),
        );
        if (recipe.successType === "iron") {
            consumeRingOfForgingCharge(player, services);
        }
    } else {
        effects.push(buildMessageEffect(player, "The iron ore is too impure and you fail to produce a bar."));
    }

    const remaining = Math.max(0, targetCount - 1);
    if (remaining > 0) {
        const reschedule = services.combat.scheduleAction(player.id, {
            kind: "skill.smelt", data: { recipeId: recipe.id, count: remaining },
            delayTicks: delay, cooldownTicks: delay, groups: ["skill.smelt"],
        }, tick);
        if (!reschedule?.ok) {
            effects.push(buildMessageEffect(player, "You stop smelting."));
        }
    }

    services.production?.updateSmeltingInterface(player);
    return { ok: true, cooldownTicks: delay, groups: ["skill.smelt"], effects };
}

export function registerSmeltingInteractions(registry: IScriptRegistry, services: ScriptServices) {
    const requestAction = services.combat.requestAction;
    const openDialogOptions = services.dialog.openDialogOptions;
    const closeDialog = services.dialog.closeDialog;

    const trySmeltRecipe = (player: PlayerState, recipe: SmeltingRecipe, tick?: number, opts?: { desiredCount?: number }) => {
        const smithLevel = services.skills.getSkill(player, SkillId.Smithing)?.baseLevel ?? 1;
        if (smithLevel < recipe.level) { services.messaging.sendGameMessage(player, `You need Smithing level ${recipe.level} to smelt that.`); return; }
        const inventoryNow = getInventory(services, player);
        const batch = clampBatchCount(computeSmeltingBatchCount(inventoryNow, recipe));
        if (batch <= 0) { services.messaging.sendGameMessage(player, "You need the proper ores to smelt that bar."); return; }
        const desired = Math.max(1, Math.min(batch, opts?.desiredCount ?? batch));
        if (services.production?.smeltBars) { services.production.smeltBars(player, { recipeId: recipe.id, count: desired }); return; }
        enqueueSkillAction(requestAction, "smelt", player, recipe.id, desired, recipe.delayTicks ?? 4, tick, services.messaging.sendGameMessage);
    };

    registry.registerLocAction("smelt", (event) => {
        if (services.production?.openSmeltingInterface) { services.production.openSmeltingInterface(event.player); return; }
        const smithLevel = services.skills.getSkill(event.player, SkillId.Smithing)?.baseLevel ?? 1;
        const inventory = getInventory(services, event.player);
        const smeltChoices: SkillDialogChoice<SmeltingRecipe>[] = SMELTING_RECIPES.map((recipe) => {
            const available = clampBatchCount(computeSmeltingBatchCount(inventory, recipe));
            const levelMet = smithLevel >= recipe.level;
            const craftable = levelMet && available > 0;
            const ready = Math.max(1, Math.min(MAX_BATCH, available));
            const label = craftable ? `${recipe.name} (${ready}x ready)` : !levelMet ? `${recipe.name} (Lvl ${recipe.level})` : `${recipe.name} (${recipe.ingredientsLabel ?? "Need ores"})`;
            return { recipe, label, craftable, batch: Math.max(1, ready) };
        });
        const craftableChoices = smeltChoices.filter((c) => c.craftable);
        const orderedChoices = craftableChoices.concat(smeltChoices.filter((c) => !c.craftable)).slice(0, MAX_DIALOG_OPTIONS);
        if (!orderedChoices.length) { services.messaging.sendGameMessage(event.player, "You need ores to smelt any bars."); return; }
        const meta = SKILL_DIALOG_META.smelt;
        const openedDialog = openDialogOptions && openDialogOptions(event.player, {
            id: meta.id, title: meta.title, modal: true,
            options: orderedChoices.map((c) => c.label),
            disabledOptions: orderedChoices.map((c) => !c.craftable),
            onSelect: (idx) => {
                const selected = orderedChoices[idx];
                if (!selected) { services.messaging.sendGameMessage(event.player, "You decide not to smelt anything."); return; }
                if (!selected.craftable) { services.messaging.sendGameMessage(event.player, "You can't smelt that yet."); return; }
                closeDialog?.(event.player, meta.id);
                trySmeltRecipe(event.player, selected.recipe, event.tick, { desiredCount: selected.batch });
            },
        });
        if (!openedDialog) {
            const fallback = craftableChoices[0];
            if (!fallback) { services.messaging.sendGameMessage(event.player, "You need more ores to smelt bars."); return; }
            trySmeltRecipe(event.player, fallback.recipe, event.tick, { desiredCount: fallback.batch });
        }
    });
}
