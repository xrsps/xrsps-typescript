import { SkillId } from "../../../../src/rs/skill/skills";
import type { ActionEffect, ActionExecutionResult } from "../../../src/game/actions/types";
import type { PlayerState } from "../../../src/game/player";
import {
    FLETCHING_COMBINE_RECIPES,
    FLETCHING_LOG_IDS,
    FLETCHING_STRING_IDS,
    type FletchingProductDefinition,
    KNIFE_ITEM_ID,
    getFletchingProductsForLog,
    getFletchingRecipeById,
    getStringingRecipeByUnstrungId,
} from "./fletchingData";
import type { IScriptRegistry, ScriptActionHandlerContext, ScriptInventoryEntry, ScriptServices } from "../../../src/game/scripts/types";

const MAX_BATCH = 27;
const FLETCHING_GROUP = "skill.fletch";

type InventoryEntry = ScriptInventoryEntry;

const countItemQuantity = (entries: InventoryEntry[], itemId: number): number => {
    let total = 0;
    for (const entry of entries) {
        if (entry.itemId === itemId) {
            total += Math.max(0, entry.quantity);
        }
    }
    return total;
};

const formatProductLabel = (
    def: FletchingProductDefinition,
    opts: { craftable: boolean; available: number; levelMet: boolean },
): string => {
    const name = def.productName;
    if (!opts.levelMet) {
        return `${name} (Lvl ${def.level})`;
    }
    if (!opts.craftable) {
        return `${name} (Need logs)`;
    }
    return `${name} (${opts.available} ready)`;
};

const buildBatchOptions = (maxBatch: number): Array<{ label: string; count: number }> => {
    if (!(maxBatch > 0)) return [];
    return [1, 5, 10, maxBatch]
        .filter(
            (value, index, arr) => value > 0 && value <= maxBatch && arr.indexOf(value) === index,
        )
        .sort((a, b) => a - b)
        .map((count) => ({
            label: count === maxBatch ? `Make All (${maxBatch})` : `Make ${count}`,
            count,
        }));
};

const enqueueFletchingAction = (
    services: ScriptServices,
    player: PlayerState,
    recipe: FletchingProductDefinition,
    desiredCount: number,
    tick?: number,
): boolean => {
    const delay = recipe.delayTicks !== undefined ? Math.max(1, recipe.delayTicks) : 3;
    const currentTick = Number.isFinite(tick) ? (tick as number) : 0;
    const result = services.requestAction(
        player,
        {
            kind: "skill.fletch",
            data: { recipeId: recipe.id, count: desiredCount },
            delayTicks: delay,
            cooldownTicks: delay,
            groups: [FLETCHING_GROUP],
        },
        currentTick,
    );
    return result.ok;
};

// ---------------------------------------------------------------------------
// Fletching action data
// ---------------------------------------------------------------------------

interface FletchActionData {
    recipeId: string;
    count: number;
}

function buildMessageEffect(player: PlayerState, message: string): ActionEffect {
    return { type: "message", playerId: player.id, message };
}

function getFletchingMissingInputMessage(recipe: FletchingProductDefinition): { message: string; reason: string } {
    if (recipe.mode === "string") return { message: "You need unstrung bows in your inventory to keep fletching.", reason: "missing_unstrung" };
    if (recipe.kind === "headless_arrow") return { message: "You need arrow shafts in your inventory to keep fletching.", reason: "missing_arrow_shafts" };
    if (recipe.kind === "arrow") return { message: "You need headless arrows in your inventory to keep fletching.", reason: "missing_headless_arrows" };
    if (["arrowtips", "bolt_tips", "javelin_heads", "dart_tips"].includes(recipe.kind ?? "")) return { message: "You need amethyst in your inventory to keep fletching.", reason: "missing_amethyst" };
    if (recipe.kind === "bolt") return { message: "You need broad bolts in your inventory to keep fletching.", reason: "missing_broad_bolts" };
    if (recipe.kind === "javelin") return { message: "You need javelin shafts in your inventory to keep fletching.", reason: "missing_javelin_shafts" };
    if (recipe.kind === "dart") return { message: "You need amethyst dart tips in your inventory to keep fletching.", reason: "missing_dart_tips" };
    return { message: "You need logs in your inventory to keep fletching.", reason: "missing_logs" };
}

function getFletchingMissingSecondaryMessage(recipe: FletchingProductDefinition): { message: string; reason: string } {
    if (recipe.mode === "string") return { message: "You need bowstrings to keep fletching.", reason: "missing_bowstring" };
    if (recipe.kind === "headless_arrow" || recipe.kind === "dart") return { message: "You need feathers to keep fletching.", reason: "missing_feathers" };
    if (recipe.kind === "arrow") return { message: "You need arrowtips to keep fletching.", reason: "missing_arrowtips" };
    if (["arrowtips", "bolt_tips", "javelin_heads", "dart_tips"].includes(recipe.kind ?? "")) {
        const label = recipe.secondaryLabel ?? "a chisel";
        return { message: `You need ${label} to keep fletching.`, reason: "missing_tool" };
    }
    if (recipe.kind === "bolt") return { message: "You need amethyst bolt tips to keep fletching.", reason: "missing_bolt_tips" };
    if (recipe.kind === "javelin") return { message: "You need amethyst javelin heads to keep fletching.", reason: "missing_javelin_heads" };
    return { message: "You need the other ingredient to keep fletching.", reason: "missing_secondary_item" };
}

function getFletchingSuccessMessage(recipe: FletchingProductDefinition): string {
    if (recipe.successMessage) return recipe.successMessage;
    if (recipe.mode === "string") return `You string the ${recipe.productName}.`;
    if (recipe.kind === "arrow_shafts") return `You whittle the logs into ${recipe.outputQuantity} ${recipe.productName}.`;
    if (recipe.kind === "headless_arrow") return "You attach feathers to the arrow shafts.";
    if (recipe.kind === "arrow") return `You add the tips to make ${recipe.productName}s.`;
    if (["arrowtips", "bolt_tips", "javelin_heads", "dart_tips"].includes(recipe.kind ?? "")) return `You carve the ${recipe.productName}.`;
    if (recipe.kind === "bolt") return "You attach the amethyst tips to the bolts.";
    if (recipe.kind === "javelin") return "You attach the amethyst heads to the javelins.";
    if (recipe.kind === "dart") return "You add feathers to the dart tips.";
    return `You fletch the logs into ${recipe.productName}.`;
}

function executeFletchAction(ctx: ScriptActionHandlerContext): ActionExecutionResult {
    const { player, tick, services } = ctx;
    const data = ctx.data as FletchActionData;
    const inventory = services.getInventoryItems(player);
    const recipeId = data.recipeId;
    const recipe = getFletchingRecipeById(recipeId);
    if (!recipe) {
        return { ok: true, effects: [buildMessageEffect(player, "You can't fletch that.")] };
    }

    const skill = services.getSkill?.(player, SkillId.Fletching);
    if ((skill?.baseLevel ?? 1) < recipe.level) {
        return { ok: true, effects: [buildMessageEffect(player, `You need Fletching level ${recipe.level} to make that.`)] };
    }

    const inputSlot = services.findInventorySlotWithItem?.(player, recipe.inputItemId);
    if (inputSlot === undefined) {
        const { message } = getFletchingMissingInputMessage(recipe);
        return { ok: true, effects: [buildMessageEffect(player, message)] };
    }

    const secondaryId = recipe.secondaryItemId;
    let secondarySlot: number | undefined;
    if (secondaryId !== undefined) {
        secondarySlot = services.findInventorySlotWithItem?.(player, secondaryId);
        if (secondarySlot === undefined) {
            const { message } = getFletchingMissingSecondaryMessage(recipe);
            return { ok: true, effects: [buildMessageEffect(player, message)] };
        }
    }

    if (!services.consumeItem(player, inputSlot)) {
        return { ok: true, effects: [buildMessageEffect(player, "You can't use that item right now.")] };
    }

    const consumeSecondary = recipe.consumeSecondary !== false;
    let secondaryConsumed = false;
    const restoreConsumedItem = (slotIndex: number, itemId: number) => {
        const entry = inventory[slotIndex];
        if (!entry) return;
        if (entry.itemId <= 0 || entry.quantity <= 0) {
            entry.itemId = itemId;
            entry.quantity = 1;
        } else {
            entry.quantity += 1;
        }
    };

    if (secondarySlot !== undefined && consumeSecondary) {
        if (!services.consumeItem(player, secondarySlot)) {
            restoreConsumedItem(inputSlot, recipe.inputItemId);
            const { message } = getFletchingMissingSecondaryMessage(recipe);
            return { ok: true, effects: [buildMessageEffect(player, message)] };
        }
        secondaryConsumed = true;
    }

    const productQuantity = Math.max(1, recipe.outputQuantity);
    const outputMode = recipe.outputMode ?? "replace";

    if (outputMode === "add") {
        const dest = services.addItemToInventory(player, recipe.productItemId, productQuantity);
        if (dest.added <= 0) {
            restoreConsumedItem(inputSlot, recipe.inputItemId);
            if (secondaryConsumed && secondarySlot !== undefined && secondaryId !== undefined) {
                restoreConsumedItem(secondarySlot, secondaryId);
            }
            return { ok: true, effects: [buildMessageEffect(player, "You need more inventory space to keep fletching.")] };
        }
    } else {
        services.setInventorySlot(player, inputSlot, recipe.productItemId, productQuantity);
    }

    services.playPlayerSeq?.(player, recipe.animation ?? 1248);
    services.addSkillXp?.(player, SkillId.Fletching, recipe.xp);

    const description = getFletchingSuccessMessage(recipe);
    const effects: ActionEffect[] = [
        { type: "inventorySnapshot", playerId: player.id },
        buildMessageEffect(player, description),
    ];

    const totalCount = Math.max(1, data.count);
    const remaining = Math.max(0, totalCount - 1);

    if (remaining > 0) {
        const reschedule = services.scheduleAction?.(
            player.id,
            {
                kind: "skill.fletch",
                data: { recipeId: recipe.id, count: remaining },
                delayTicks: recipe.delayTicks ?? 3,
                cooldownTicks: recipe.delayTicks ?? 3,
                groups: ["skill.fletch"],
            },
            tick,
        );
        if (!reschedule?.ok) {
            effects.push(buildMessageEffect(player, "You stop fletching because you're already busy."));
        }
    }

    return {
        ok: true,
        cooldownTicks: recipe.delayTicks !== undefined ? Math.max(1, recipe.delayTicks) : 3,
        groups: ["skill.fletch"],
        effects,
    };
}

export function register(registry: IScriptRegistry, services: ScriptServices): void {
    registry.registerActionHandler("skill.fletch", executeFletchAction);

    const getInventoryItems = services.getInventoryItems;
    const openDialogOptions = services.openDialogOptions;
    const closeDialog = services.closeDialog;

    const registerHandler = (logId: number) => {
        const handler = ({ player, source, target, tick }: any) => {
            const otherItem = source.itemId === KNIFE_ITEM_ID ? target : source;
            if (otherItem.itemId !== logId) return;
            const products = getFletchingProductsForLog(logId);
            if (!products || products.length === 0) {
                services.sendGameMessage(player, "You can't fletch anything from these logs.");
                return;
            }
            const inventory = getInventoryItems(player);
            const availableLogs = countItemQuantity(inventory, logId);
            if (availableLogs <= 0) {
                services.sendGameMessage(player, "You need logs in your inventory to fletch.");
                return;
            }
            const level = services.getSkill?.(player, SkillId.Fletching)?.baseLevel ?? 1;
            const choices = products.map((def) => {
                const ready = Math.max(1, Math.min(MAX_BATCH, availableLogs));
                const levelMet = level >= def.level;
                const craftable = levelMet && availableLogs > 0;
                return {
                    definition: def,
                    label: formatProductLabel(def, { craftable, available: ready, levelMet }),
                    craftable,
                    batch: ready,
                };
            });
            const craftableChoices = choices.filter((choice) => choice.craftable);
            const ordered = craftableChoices.concat(
                choices.filter((choice) => !choice.craftable),
            );
            const dialogId = `fletch_${logId}`;
            if (openDialogOptions && ordered.length > 0) {
                openDialogOptions(player, {
                    id: dialogId,
                    modal: true,
                    title: "What would you like to make?",
                    options: ordered.map((choice) => choice.label),
                    disabledOptions: ordered.map((choice) => !choice.craftable),
                    onSelect: (idx) => {
                        const selected = ordered[idx];
                        if (!selected) {
                            services.sendGameMessage(player, "You decide not to carve the logs.");
                            return;
                        }
                        if (!selected.craftable) {
                            services.sendGameMessage(player, `You need Fletching level ${selected.definition.level} for that.`);
                            return;
                        }
                        closeDialog?.(player, dialogId);
                        const desired = Math.max(1, Math.min(selected.batch, availableLogs));
                        const ok = enqueueFletchingAction(services, player, selected.definition, desired, tick);
                        if (!ok) {
                            services.sendGameMessage(player, "You're too busy to fletch right now.");
                        }
                    },
                });
                return;
            }
            const fallback = craftableChoices[0];
            if (!fallback) {
                services.sendGameMessage(player, "You need a higher Fletching level before working these logs.");
                return;
            }
            const desired = Math.max(1, Math.min(fallback.batch, availableLogs));
            const ok = enqueueFletchingAction(services, player, fallback.definition, desired, tick);
            if (!ok) {
                services.sendGameMessage(player, "You're too busy to fletch right now.");
            }
        };
        registry.registerItemOnItem(KNIFE_ITEM_ID, logId, handler);
    };

    const registerStringingHandler = (unstrungId: number) => {
        const recipe = getStringingRecipeByUnstrungId(unstrungId);
        const secondaryItemId = recipe?.secondaryItemId;
        if (!recipe || !secondaryItemId) return;
        const handler = ({ player, source, target, tick }: any) => {
            const sourceIsUnstrung = source.itemId === unstrungId;
            const targetIsUnstrung = target.itemId === unstrungId;
            if (!sourceIsUnstrung && !targetIsUnstrung) return;
            const other = sourceIsUnstrung ? target : source;
            if (other.itemId !== secondaryItemId) return;
            const inventory = getInventoryItems(player);
            const availableUnstrung = countItemQuantity(inventory, unstrungId);
            const availableStrings = countItemQuantity(inventory, secondaryItemId);
            if (availableUnstrung <= 0) {
                services.sendGameMessage(player, "You need unstrung bows in your inventory.");
                return;
            }
            if (availableStrings <= 0) {
                services.sendGameMessage(player, "You need bowstrings to string bows.");
                return;
            }
            const level = services.getSkill?.(player, SkillId.Fletching)?.baseLevel ?? 1;
            if (level < recipe.level) {
                services.sendGameMessage(player, `You need Fletching level ${recipe.level} to string that bow.`);
                return;
            }
            const maxBatch = Math.max(0, Math.min(MAX_BATCH, Math.min(availableUnstrung, availableStrings)));
            if (!(maxBatch > 0)) {
                services.sendGameMessage(player, "You can't string any bows right now.");
                return;
            }
            const options = buildBatchOptions(maxBatch);
            const dialogId = `fletch_string_${unstrungId}`;
            if (openDialogOptions && options.length > 0) {
                openDialogOptions(player, {
                    id: dialogId,
                    modal: true,
                    title: "How many would you like to string?",
                    options: options.map((opt) => opt.label),
                    onSelect: (idx) => {
                        const selected = options[idx];
                        if (!selected) {
                            services.sendGameMessage(player, "You decide not to string the bow.");
                            return;
                        }
                        closeDialog?.(player, dialogId);
                        const ok = enqueueFletchingAction(services, player, recipe, Math.max(1, Math.min(selected.count, maxBatch)), tick);
                        if (!ok) {
                            services.sendGameMessage(player, "You're too busy to fletch right now.");
                        }
                    },
                });
                return;
            }
            const ok = enqueueFletchingAction(services, player, recipe, maxBatch, tick);
            if (!ok) {
                services.sendGameMessage(player, "You're too busy to fletch right now.");
            }
        };
        registry.registerItemOnItem(unstrungId, secondaryItemId, handler);
    };

    const registerCombineHandler = (recipe: FletchingProductDefinition) => {
        const secondaryId = recipe.secondaryItemId;
        if (!secondaryId) return;
        const handler = ({ player, source, target, tick }: any) => {
            const sourceIsPrimary = source.itemId === recipe.inputItemId;
            const targetIsPrimary = target.itemId === recipe.inputItemId;
            if (!sourceIsPrimary && !targetIsPrimary) return;
            const other = sourceIsPrimary ? target : source;
            if (other.itemId !== secondaryId) return;
            const inventory = getInventoryItems(player);
            const primaryCount = countItemQuantity(inventory, recipe.inputItemId);
            if (primaryCount <= 0) {
                const label = recipe.primaryLabel ?? "the required items";
                services.sendGameMessage(player, `You need ${label} in your inventory.`);
                return;
            }
            const secondaryCount = countItemQuantity(inventory, secondaryId);
            const secondaryIsTool = recipe.secondaryIsTool === true;
            if (secondaryCount <= 0) {
                const label = recipe.secondaryLabel ?? "the other ingredient";
                services.sendGameMessage(player, `You need ${label} to keep fletching.`);
                return;
            }
            const level = services.getSkill?.(player, SkillId.Fletching)?.baseLevel ?? 1;
            if (level < recipe.level) {
                services.sendGameMessage(player, `You need Fletching level ${recipe.level} to make ${recipe.productName}.`);
                return;
            }
            const secondaryCap = secondaryIsTool ? Number.MAX_SAFE_INTEGER : secondaryCount;
            const maxBatch = Math.max(0, Math.min(MAX_BATCH, Math.min(primaryCount, secondaryCap)));
            if (!(maxBatch > 0)) {
                services.sendGameMessage(player, "You can't fletch that right now.");
                return;
            }
            const options = buildBatchOptions(maxBatch);
            const dialogId = `fletch_combine_${recipe.id}`;
            const dialogTitle =
                recipe.kind === "headless_arrow" ? "Attach feathers"
                : recipe.kind === "arrow" ? "Attach arrowtips"
                : recipe.kind === "arrowtips" ? "Carve arrowtips"
                : recipe.kind === "bolt_tips" ? "Carve bolt tips"
                : recipe.kind === "javelin_heads" ? "Carve javelin heads"
                : recipe.kind === "bolt" ? "Attach bolt tips"
                : recipe.kind === "javelin" ? "Attach javelin heads"
                : recipe.kind === "dart_tips" ? "Carve dart tips"
                : recipe.kind === "dart" ? "Attach feathers"
                : "How many would you like to make?";
            if (openDialogOptions && options.length > 0) {
                openDialogOptions(player, {
                    id: dialogId,
                    modal: true,
                    title: dialogTitle,
                    options: options.map((opt) => opt.label),
                    onSelect: (idx) => {
                        const selected = options[idx];
                        if (!selected) {
                            services.sendGameMessage(player, "You decide not to continue fletching.");
                            return;
                        }
                        closeDialog?.(player, dialogId);
                        const desired = Math.max(1, Math.min(selected.count, maxBatch));
                        const ok = enqueueFletchingAction(services, player, recipe, desired, tick);
                        if (!ok) {
                            services.sendGameMessage(player, "You're too busy to fletch right now.");
                        }
                    },
                });
                return;
            }
            const fallback = options[options.length - 1]?.count ?? Math.min(maxBatch, 1);
            const ok = enqueueFletchingAction(services, player, recipe, Math.max(1, fallback), tick);
            if (!ok) {
                services.sendGameMessage(player, "You're too busy to fletch right now.");
            }
        };
        if (typeof secondaryId === "number" && secondaryId > 0) {
            registry.registerItemOnItem(recipe.inputItemId, secondaryId, handler);
        }
    };

    for (const logId of FLETCHING_LOG_IDS) {
        registerHandler(logId);
    }
    for (const unstrungId of FLETCHING_STRING_IDS) {
        registerStringingHandler(unstrungId);
    }
    for (const recipe of FLETCHING_COMBINE_RECIPES) {
        registerCombineHandler(recipe);
    }
}
