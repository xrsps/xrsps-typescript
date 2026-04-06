import { SkillId } from "../../../../../src/rs/skill/skills";
import type { ActionEffect, ActionExecutionResult } from "../../../../src/game/actions/types";
import type { PlayerState } from "../../../../src/game/player";
import {
    SPINNING_RECIPES,
    SPINNING_WHEEL_LOC_IDS,
    SINEW_SOURCE_ITEM_IDS,
    type SpinningRecipe,
    getSpinningRecipeById,
    isSinewSourceItem,
    SINEW_ITEM_ID,
    SINEW_ANIMATION_ID,
    SINEW_DELAY_TICKS,
    SINEW_CRAFT_XP,
} from "./spinningData";
import {
    ANY_ITEM_ID,
    ANY_LOC_ID,
    type LocInteractionEvent,
    type ScriptActionHandlerContext,
    type ScriptInventoryEntry,
    type IScriptRegistry,
    type ScriptServices,
} from "../../../../src/game/scripts/types";

const MAX_BATCH = 28;
const SPIN_ACTION = "spin";
const SPIN_GROUP = "skill.spin";

type InventoryEntry = ScriptInventoryEntry;
type CraftableChoice = {
    recipe: SpinningRecipe;
    batch: number;
    levelMet: boolean;
    label: string;
};

const countItem = (entries: InventoryEntry[], itemId: number): number => {
    let total = 0;
    for (const entry of entries) {
        if (entry.itemId === itemId) {
            total += Math.max(0, entry.quantity);
        }
    }
    return total;
};

const computeBatchCount = (entries: InventoryEntry[], recipe: SpinningRecipe): number => {
    const total = countItem(entries, recipe.inputItemId);
    const perSpin = Math.max(1, recipe.inputQuantity);
    if (!(total > 0 && perSpin > 0)) return 0;
    return Math.max(0, Math.min(MAX_BATCH, Math.floor(total / perSpin)));
};

const buildBatchOptions = (maxBatch: number): Array<{ label: string; count: number }> => {
    if (!(maxBatch > 0)) return [];
    const base = [1, 5, 10, maxBatch];
    return base
        .filter((value, idx, arr) => value > 0 && value <= maxBatch && arr.indexOf(value) === idx)
        .sort((a, b) => a - b)
        .map((count) => ({
            label: count === maxBatch ? `Make All (${maxBatch})` : `Make ${count}`,
            count,
        }));
};

const formatProductLabel = (
    recipe: SpinningRecipe,
    opts: { levelMet: boolean; batch: number },
): string => {
    const baseName = recipe.name;
    if (!opts.levelMet) {
        return `${baseName} (Lvl ${recipe.level})`;
    }
    return `${baseName} (${opts.batch} available)`;
};

const enqueueSpinAction = (
    services: ScriptServices,
    player: PlayerState,
    recipe: SpinningRecipe,
    desiredCount: number,
    tick?: number,
): boolean => {
    const delay = Math.max(1, recipe.delayTicks);
    const currentTick = Number.isFinite(tick) ? (tick as number) : 0;
    const result = services.requestAction(
        player,
        {
            kind: "skill.spin",
            data: { recipeId: recipe.id, count: Math.max(1, desiredCount) },
            delayTicks: delay,
            cooldownTicks: delay,
            groups: [SPIN_GROUP],
        },
        currentTick,
    );
    return result.ok;
};

// ---------------------------------------------------------------------------
// Spin action data
// ---------------------------------------------------------------------------

interface SpinActionData {
    recipeId: string;
    count: number;
}

interface SinewActionData {
    itemId: number;
    slot?: number;
    locId?: number;
    tile?: { x: number; y: number };
    level?: number;
}

function buildMessageEffect(player: PlayerState, message: string): ActionEffect {
    return { type: "message", playerId: player.id, message };
}

function executeSpinAction(ctx: ScriptActionHandlerContext): ActionExecutionResult {
    const { player, tick, services } = ctx;
    const data = ctx.data as SpinActionData;
    const recipeId = data.recipeId;
    const recipe = getSpinningRecipeById(recipeId);
    if (!recipe) {
        return { ok: true, effects: [buildMessageEffect(player, "You can't spin that.")] };
    }

    const skill = services.getSkill?.(player, SkillId.Crafting);
    if ((skill?.baseLevel ?? 1) < recipe.level) {
        return { ok: true, effects: [buildMessageEffect(player, `You need Crafting level ${recipe.level} to spin ${recipe.name}.`)] };
    }

    const totalCount = Math.max(1, data.count);
    const removed = new Map<number, number>();
    const requiredPerSpin = Math.max(1, recipe.inputQuantity);

    for (let i = 0; i < requiredPerSpin; i++) {
        const slot = services.findInventorySlotWithItem?.(player, recipe.inputItemId);
        if (slot === undefined || !services.consumeItem(player, slot)) {
            services.production?.restoreInventoryItems(player, recipe.inputItemId, removed);
            return { ok: true, effects: [buildMessageEffect(player, `You need more ${recipe.inputName} to keep spinning.`)] };
        }
        removed.set(slot, (removed.get(slot) ?? 0) + 1);
    }

    const productQuantity = Math.max(1, recipe.outputQuantity);
    const firstSlot = removed.keys().next()?.value;
    if (firstSlot !== undefined) {
        services.setInventorySlot(player, firstSlot, recipe.productItemId, productQuantity);
    } else {
        const dest = services.addItemToInventory(player, recipe.productItemId, productQuantity);
        if (dest.added <= 0) {
            services.production?.restoreInventoryItems(player, recipe.inputItemId, removed);
            return { ok: true, effects: [buildMessageEffect(player, "You need more inventory space to keep spinning.")] };
        }
    }

    services.playPlayerSeq?.(player, recipe.animation);
    services.addSkillXp?.(player, SkillId.Crafting, recipe.xp);
    services.onItemCraft?.(player.id, recipe.outputItemId, 1);

    const effects: ActionEffect[] = [
        { type: "inventorySnapshot", playerId: player.id },
        buildMessageEffect(player, recipe.successMessage),
    ];

    const remaining = Math.max(0, totalCount - 1);

    if (remaining > 0) {
        const reschedule = services.scheduleAction?.(
            player.id,
            {
                kind: "skill.spin",
                data: { recipeId: recipe.id, count: remaining },
                delayTicks: recipe.delayTicks,
                cooldownTicks: recipe.delayTicks,
                groups: ["skill.spin"],
            },
            tick,
        );
        if (!reschedule?.ok) {
            effects.push(buildMessageEffect(player, "You stop spinning because you're already busy."));
        }
    }

    return {
        ok: true,
        cooldownTicks: recipe.delayTicks,
        groups: ["skill.spin"],
        effects,
    };
}

function executeSinewAction(ctx: ScriptActionHandlerContext): ActionExecutionResult {
    const { player, services } = ctx;
    const data = ctx.data as SinewActionData;
    const sourceItemId = data.itemId;

    if (!isSinewSourceItem(sourceItemId)) {
        return { ok: true, effects: [buildMessageEffect(player, "You can't turn that into sinew.")] };
    }

    let slot = data.slot;
    if (slot === undefined) {
        slot = services.findInventorySlotWithItem?.(player, sourceItemId);
    }

    if (slot === undefined || !services.consumeItem(player, slot)) {
        return { ok: true, effects: [buildMessageEffect(player, "You need raw meat to dry into sinew.")] };
    }

    services.setInventorySlot(player, slot, SINEW_ITEM_ID, 1);
    services.playPlayerSeq?.(player, SINEW_ANIMATION_ID);
    services.addSkillXp?.(player, SkillId.Crafting, SINEW_CRAFT_XP);
    services.onItemCraft?.(player.id, SINEW_ITEM_ID, 1);

    const effects: ActionEffect[] = [
        { type: "inventorySnapshot", playerId: player.id },
        buildMessageEffect(player, "You dry the meat into sinew."),
    ];

    return {
        ok: true,
        cooldownTicks: SINEW_DELAY_TICKS,
        groups: ["skill.sinew"],
        effects,
    };
}

export function register(registry: IScriptRegistry, services: ScriptServices): void {
    registry.registerActionHandler("skill.spin", executeSpinAction);
    registry.registerActionHandler("skill.sinew", executeSinewAction);

    const getInventoryItems = services.getInventoryItems;
    const openDialogOptions = services.openDialogOptions;
    const closeDialog = services.closeDialog;

    const handleSpinRequest = ({ player, tick }: { player: PlayerState; tick?: number }) => {
        const inventory = getInventoryItems(player);
        const level = services.getSkill?.(player, SkillId.Crafting)?.baseLevel ?? 1;

        const choices: CraftableChoice[] = SPINNING_RECIPES.map((recipe) => {
            const batch = computeBatchCount(inventory as InventoryEntry[], recipe);
            const levelMet = level >= recipe.level;
            return {
                recipe,
                batch,
                levelMet,
                label: formatProductLabel(recipe, { levelMet, batch }),
            };
        }).filter((choice) => choice.batch > 0);

        if (choices.length === 0) {
            services.sendGameMessage(
                player,
                "You need something like wool, flax, sinew, or roots to spin.",
            );
            return;
        }

        const craftableChoices = choices.filter(
            (choice) => choice.levelMet && choice.batch > 0,
        );
        if (craftableChoices.length === 0) {
            const lowestReq = choices.reduce((prev, curr) =>
                curr.recipe.level < prev.recipe.level ? curr : prev,
            );
            services.sendGameMessage(
                player,
                `You need Crafting level ${lowestReq.recipe.level} to spin ${lowestReq.recipe.name}.`,
            );
            return;
        }

        const attemptEnqueue = (target: CraftableChoice) => {
            const batches = buildBatchOptions(target.batch);
            if (batches.length === 0) {
                services.sendGameMessage(player, "You decide not to spin anything.");
                return;
            }
            const dialogId = `spin_batch_${target.recipe.id}`;
            if (openDialogOptions) {
                openDialogOptions(player, {
                    id: dialogId,
                    modal: true,
                    title: `How many ${target.recipe.name}?`,
                    options: batches.map((option) => option.label),
                    onSelect: (index) => {
                        const selected = batches[index];
                        if (!selected) {
                            services.sendGameMessage(player, "You decide not to spin anything.");
                            return;
                        }
                        closeDialog?.(player, dialogId);
                        const ok = enqueueSpinAction(services, player, target.recipe, selected.count, tick);
                        if (!ok) {
                            services.sendGameMessage(player, "You're too busy to spin anything right now.");
                        }
                    },
                });
                return;
            }
            const fallbackCount = batches[batches.length - 1]?.count ?? 1;
            const ok = enqueueSpinAction(services, player, target.recipe, fallbackCount, tick);
            if (!ok) {
                services.sendGameMessage(player, "You're too busy to spin anything right now.");
            }
        };

        const showProductDialog = (): void => {
            const dialogId = `spin_products_${player.id}`;
            openDialogOptions?.(player, {
                id: dialogId,
                modal: true,
                title: "What would you like to spin?",
                options: choices.map((choice) => choice.label),
                onSelect: (index) => {
                    const selected = choices[index];
                    if (!selected) {
                        services.sendGameMessage(player, "You step away from the spinning wheel.");
                        return;
                    }
                    if (!selected.levelMet) {
                        services.sendGameMessage(player, `You need Crafting level ${selected.recipe.level} to spin ${selected.recipe.name}.`);
                        return;
                    }
                    closeDialog?.(player, dialogId);
                    attemptEnqueue(selected);
                },
            });
        };

        if (!openDialogOptions || craftableChoices.length === 1) {
            attemptEnqueue(craftableChoices[0]!);
            return;
        }
        showProductDialog();
    };

    const handler = (event: LocInteractionEvent) =>
        handleSpinRequest({ player: event.player, tick: event.tick });

    for (const locId of SPINNING_WHEEL_LOC_IDS) {
        registry.registerLocInteraction(locId, handler, SPIN_ACTION);
        registry.registerItemOnLoc(ANY_ITEM_ID, locId, (event) => {
            handleSpinRequest({ player: event.player, tick: event.tick });
        });
    }

    for (const sourceItemId of SINEW_SOURCE_ITEM_IDS) {
        registry.registerItemOnLoc(sourceItemId, ANY_LOC_ID, (event) => {
            const locId = event.target.locId;
            const locDef = services.getLocDefinition?.(locId);
            if (!locDef) return;
            const name = locDef.name?.toLowerCase() ?? "";
            if (!name.includes("range") && !name.includes("stove") && !name.includes("cook") && !name.includes("kitchen")) return;
            if (name.includes("fire")) return;
            const player = event.player;
            const tile = event.target.tile;
            const level = event.target.level;
            const result = services.requestAction(
                player,
                {
                    kind: "skill.sinew",
                    data: {
                        slot: event.source.slot,
                        itemId: event.source.itemId,
                        locId,
                        tile,
                        level,
                    },
                    delayTicks: SINEW_DELAY_TICKS,
                    cooldownTicks: SINEW_DELAY_TICKS,
                    groups: ["skill.sinew"],
                },
                event.tick,
            );
            if (!result.ok) {
                services.sendGameMessage(player, "You're too busy to do that right now.");
                return;
            }
            services.sendGameMessage(player, "You start drying the meat into sinew.");
        });
    }
}
