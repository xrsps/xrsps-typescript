import { SkillId } from "../../../../../../src/rs/skill/skills";
import type { PlayerState } from "../../../player";
import {
    SPINNING_RECIPES,
    SPINNING_WHEEL_LOC_IDS,
    type SpinningRecipe,
} from "../../../skills/spinning";
import {
    type LocInteractionEvent,
    type ScriptInventoryEntry,
    type ScriptModule,
} from "../../types";

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
    services: Parameters<ScriptModule["register"]>[1],
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

export const spinningModule: ScriptModule = {
    id: "skills.spinning",
    register(registry, services) {
        const getInventoryItems = services.getInventoryItems;
        const openDialogOptions = services.openDialogOptions;
        const closeDialog = services.closeDialog;

        const handleSpinRequest = ({ player, tick }: { player: PlayerState; tick?: number }) => {
            const inventory = getInventoryItems(player);
            const skill = player.getSkill(SkillId.Crafting);
            const level = skill.baseLevel;

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
                                services.sendGameMessage(
                                    player,
                                    "You decide not to spin anything.",
                                );
                                return;
                            }
                            closeDialog?.(player, dialogId);
                            const ok = enqueueSpinAction(
                                services,
                                player,
                                target.recipe,
                                selected.count,
                                tick,
                            );
                            if (!ok) {
                                services.sendGameMessage(
                                    player,
                                    "You're too busy to spin anything right now.",
                                );
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
                            services.sendGameMessage(
                                player,
                                "You step away from the spinning wheel.",
                            );
                            return;
                        }
                        if (!selected.levelMet) {
                            services.sendGameMessage(
                                player,
                                `You need Crafting level ${selected.recipe.level} to spin ${selected.recipe.name}.`,
                            );
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
        }
    },
};
