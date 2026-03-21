import { SkillId } from "../../../../../src/rs/skill/skills";
import type {
    SkillCookActionData,
    SkillSmeltActionData,
    SkillSmithActionData,
    SkillTanActionData,
} from "../../actions/skillActionPayloads";
import type { PlayerState } from "../../player";
import {
    COOKING_RECIPES,
    type CookingHeatSource,
    type CookingRecipe,
    HAMMER_ITEM_ID,
    SMELTING_RECIPES,
    SMITHING_RECIPES,
    type SkillSurfaceKind,
    type SmeltingRecipe,
    type SmithingRecipe,
    TANNING_RECIPES,
    type TanningRecipe,
    computeSmeltingBatchCount,
} from "../../skills/skillSurfaces";
import { type ScriptInventoryEntry, type ScriptModule } from "../types";

type InventoryEntry = ScriptInventoryEntry;

const SKILL_SURFACE_GROUP = "skill.surface";
const MAX_BATCH = 28;
const MAX_DIALOG_OPTIONS = 5;
const SKILL_DIALOG_META: Record<SkillSurfaceKind, { id: string; title: string }> = {
    smith: { id: "skill.smith", title: "What would you like to smith?" },
    cook: { id: "skill.cook", title: "What would you like to cook?" },
    tan: { id: "skill.tan", title: "Which hide would you like to tan?" },
    smelt: { id: "skill.smelt", title: "Which bar would you like to smelt?" },
};
const ACTION_FAILURE_MESSAGES: Record<SkillSurfaceKind, string> = {
    smith: "You can't smith right now.",
    cook: "You can't cook that right now.",
    tan: "You can't tan that right now.",
    smelt: "You can't smelt that right now.",
};

type RequestActionFn = NonNullable<Parameters<ScriptModule["register"]>[1]["requestAction"]>;
type SendMessageFn = (player: PlayerState, text: string) => void;
type SkillDialogChoice<T> = {
    recipe: T;
    label: string;
    craftable: boolean;
    batch: number;
};

const clampBatchCount = (count: number): number => Math.max(0, Math.min(MAX_BATCH, count));

const computeSmithBatchCount = (entries: InventoryEntry[], recipe: SmithingRecipe): number => {
    const totalBars = countItem(entries, recipe.barItemId);
    const per = Math.max(1, recipe.barCount);
    return clampBatchCount(Math.floor(totalBars / per));
};

const computeCookingBatchCount = (entries: InventoryEntry[], recipe: CookingRecipe): number => {
    const total = countItem(entries, recipe.rawItemId);
    return clampBatchCount(total);
};

const computeTanningBatchCount = (entries: InventoryEntry[], recipe: TanningRecipe): number => {
    const total = countItem(entries, recipe.inputItemId);
    return clampBatchCount(total);
};

const enqueueSkillAction = (
    requestAction: RequestActionFn,
    kind: SkillSurfaceKind,
    player: PlayerState,
    recipeId: string,
    count: number,
    delayTicks: number,
    tick: number | undefined,
    sendMessage: SendMessageFn,
    extraData?: { heatSource?: CookingHeatSource },
): boolean => {
    const normalizedCount = Math.max(1, count);
    const delay = Math.max(1, delayTicks);
    if (!(normalizedCount > 0)) {
        sendMessage(player, ACTION_FAILURE_MESSAGES[kind]);
        return false;
    }
    const resolvedTick = Number.isFinite(tick) ? (tick as number) : 0;
    let result: ReturnType<RequestActionFn> | undefined;

    if (kind === "cook") {
        const data: SkillCookActionData = { recipeId, count: normalizedCount };
        if (extraData?.heatSource) {
            data.heatSource = extraData.heatSource;
        }
        result = requestAction(
            player,
            {
                kind: "skill.cook",
                data,
                delayTicks: delay,
                cooldownTicks: delay,
                groups: [SKILL_SURFACE_GROUP, "skill.cook"],
            },
            resolvedTick,
        );
    } else if (kind === "smith") {
        const data: SkillSmithActionData = { recipeId, count: normalizedCount };
        result = requestAction(
            player,
            {
                kind: "skill.smith",
                data,
                delayTicks: delay,
                cooldownTicks: delay,
                groups: [SKILL_SURFACE_GROUP, "skill.smith"],
            },
            resolvedTick,
        );
    } else if (kind === "tan") {
        const data: SkillTanActionData = { recipeId, count: normalizedCount };
        result = requestAction(
            player,
            {
                kind: "skill.tan",
                data,
                delayTicks: delay,
                cooldownTicks: delay,
                groups: [SKILL_SURFACE_GROUP, "skill.tan"],
            },
            resolvedTick,
        );
    } else {
        const data: SkillSmeltActionData = { recipeId, count: normalizedCount };
        result = requestAction(
            player,
            {
                kind: "skill.smelt",
                data,
                delayTicks: delay,
                cooldownTicks: delay,
                groups: [SKILL_SURFACE_GROUP, "skill.smelt"],
            },
            resolvedTick,
        );
    }

    if (!result.ok) {
        sendMessage(player, ACTION_FAILURE_MESSAGES[kind]);
        return false;
    }
    return true;
};

const ensureRequestAction = (services: Parameters<ScriptModule["register"]>[1]) => {
    return services.requestAction;
};

const getInventory = (
    services: Parameters<ScriptModule["register"]>[1],
    player: PlayerState,
): InventoryEntry[] => services.getInventoryItems(player);

const countItem = (entries: InventoryEntry[], itemId: number): number => {
    let total = 0;
    for (const entry of entries) {
        if (entry.itemId === itemId) {
            total += Math.max(0, entry.quantity);
        }
    }
    return total;
};

const hasItem = (entries: InventoryEntry[], itemId: number, quantity: number = 1): boolean => {
    if (!(itemId > 0)) return false;
    let remaining = quantity;
    for (const entry of entries) {
        if (entry.itemId === itemId && entry.quantity > 0) {
            remaining -= Math.min(entry.quantity, remaining);
            if (remaining <= 0) return true;
        }
    }
    return false;
};

const resolveCookingHeatSource = (
    services: Parameters<ScriptModule["register"]>[1],
    locId?: number,
): CookingHeatSource => {
    if (locId === undefined || !(locId > 0)) {
        return "range";
    }
    const definition = services.getLocDefinition?.(locId);
    const supportItems = definition?.supportItems ?? 1;
    const name = definition?.name?.toLowerCase() ?? "";
    if (supportItems <= 0 || name === "fire") {
        return "fire";
    }
    return "range";
};

export const skillSurfaceModule: ScriptModule = {
    id: "content.skill-surfaces",
    register(registry, services) {
        const requestAction = ensureRequestAction(services);
        const openDialogOptions = services.openDialogOptions;
        const closeDialog = services.closeDialog;

        const trySmithRecipe = (
            player: PlayerState,
            recipe: SmithingRecipe,
            tick?: number,
            opts?: { desiredCount?: number },
        ) => {
            const smithLevel = player.getSkill(SkillId.Smithing).baseLevel;
            if (smithLevel < recipe.level) {
                services.sendGameMessage(
                    player,
                    `You need Smithing level ${recipe.level} to smith that.`,
                );
                return;
            }
            const inventoryNow = getInventory(services, player);
            if (recipe.requireHammer !== false && !hasItem(inventoryNow, HAMMER_ITEM_ID)) {
                services.sendGameMessage(player, "You need a hammer to smith.");
                return;
            }
            const batch = computeSmithBatchCount(inventoryNow, recipe);
            if (batch <= 0) {
                services.sendGameMessage(player, "You need a suitable bar to smith.");
                return;
            }
            const desired = Math.max(1, Math.min(batch, opts?.desiredCount ?? batch));
            if (services.smithItems) {
                services.smithItems(player, { recipeId: recipe.id, count: desired });
                return;
            }
            enqueueSkillAction(
                requestAction,
                "smith",
                player,
                recipe.id,
                desired,
                recipe.delayTicks ?? 4,
                tick,
                services.sendGameMessage,
            );
        };

        const tryCookingRecipe = (
            player: PlayerState,
            recipe: CookingRecipe,
            tick?: number,
            opts?: { desiredCount?: number; heatSource?: CookingHeatSource },
        ) => {
            const cookLevel = player.getSkill(SkillId.Cooking).baseLevel;
            if (cookLevel < recipe.level) {
                services.sendGameMessage(
                    player,
                    `You need Cooking level ${recipe.level} to cook that.`,
                );
                return;
            }
            const inventoryNow = getInventory(services, player);
            const batch = computeCookingBatchCount(inventoryNow, recipe);
            if (batch <= 0) {
                services.sendGameMessage(player, "You need something raw to cook.");
                return;
            }
            const desired = Math.max(1, Math.min(batch, opts?.desiredCount ?? batch));
            enqueueSkillAction(
                requestAction,
                "cook",
                player,
                recipe.id,
                desired,
                recipe.delayTicks ?? 3,
                tick,
                services.sendGameMessage,
                opts?.heatSource ? { heatSource: opts.heatSource } : undefined,
            );
        };

        const trySmeltRecipe = (
            player: PlayerState,
            recipe: SmeltingRecipe,
            _tick?: number,
            opts?: { desiredCount?: number },
        ) => {
            const smithLevel = player.getSkill(SkillId.Smithing).baseLevel;
            if (smithLevel < recipe.level) {
                services.sendGameMessage(
                    player,
                    `You need Smithing level ${recipe.level} to smelt that.`,
                );
                return;
            }
            const inventoryNow = getInventory(services, player);
            const batch = clampBatchCount(computeSmeltingBatchCount(inventoryNow, recipe));
            if (batch <= 0) {
                services.sendGameMessage(player, "You need the proper ores to smelt that bar.");
                return;
            }
            const desired = Math.max(1, Math.min(batch, opts?.desiredCount ?? batch));
            if (services.smeltBars) {
                services.smeltBars(player, { recipeId: recipe.id, count: desired });
                return;
            }
            enqueueSkillAction(
                requestAction,
                "smelt",
                player,
                recipe.id,
                desired,
                recipe.delayTicks ?? 4,
                _tick,
                services.sendGameMessage,
            );
        };

        const tryTanningRecipe = (
            player: PlayerState,
            recipe: TanningRecipe,
            tick?: number,
            opts?: { desiredCount?: number },
        ) => {
            const craftLevel = player.getSkill(SkillId.Crafting).baseLevel;
            if (recipe.level && craftLevel < recipe.level) {
                services.sendGameMessage(
                    player,
                    `You need Crafting level ${recipe.level} to tan that.`,
                );
                return;
            }
            const inventoryNow = getInventory(services, player);
            const batch = computeTanningBatchCount(inventoryNow, recipe);
            if (batch <= 0) {
                services.sendGameMessage(player, "You need hides to tan.");
                return;
            }
            const desired = Math.max(1, Math.min(batch, opts?.desiredCount ?? batch));
            enqueueSkillAction(
                requestAction,
                "tan",
                player,
                recipe.id,
                desired,
                recipe.delayTicks ?? 2,
                tick,
                services.sendGameMessage,
            );
        };

        registry.registerLocAction("smith", (event) => {
            if (services.openSmithingInterface) {
                services.openSmithingInterface(event.player);
                return;
            }
            const smithLevel = event.player.getSkill(SkillId.Smithing).baseLevel;
            const inventory = getInventory(services, event.player);
            if (!hasItem(inventory, HAMMER_ITEM_ID)) {
                services.sendGameMessage(event.player, "You need a hammer to smith.");
                return;
            }
            const candidateRecipes = SMITHING_RECIPES.filter((recipe) =>
                hasItem(inventory, recipe.barItemId),
            ).sort((a, b) => a.level - b.level);
            if (!candidateRecipes.length) {
                services.sendGameMessage(event.player, "You need metal bars to smith.");
                return;
            }
            const smithChoices: SkillDialogChoice<SmithingRecipe>[] = candidateRecipes.map(
                (recipe) => {
                    const available = computeSmithBatchCount(inventory, recipe);
                    const levelMet = smithLevel >= recipe.level;
                    const craftable = levelMet && available > 0;
                    const label = craftable
                        ? `${recipe.name} (${available}x ready)`
                        : !levelMet
                        ? `${recipe.name} (Lvl ${recipe.level})`
                        : `${recipe.name} (${recipe.barCount}x bars needed)`;
                    return {
                        recipe,
                        label,
                        craftable,
                        batch: Math.max(1, available),
                    };
                },
            );
            const craftableChoices = smithChoices.filter((choice) => choice.craftable);
            const orderedChoices = craftableChoices
                .concat(smithChoices.filter((choice) => !choice.craftable))
                .slice(0, MAX_DIALOG_OPTIONS);
            const meta = SKILL_DIALOG_META.smith;
            const openedDialog =
                openDialogOptions &&
                orderedChoices.length > 0 &&
                openDialogOptions(event.player, {
                    id: meta.id,
                    title: meta.title,
                    modal: true,
                    options: orderedChoices.map((choice) => choice.label),
                    disabledOptions: orderedChoices.map((choice) => !choice.craftable),
                    onSelect: (choiceIdx) => {
                        const selected = orderedChoices[choiceIdx];
                        if (!selected) {
                            services.sendGameMessage(
                                event.player,
                                "You decide not to make anything.",
                            );
                            return;
                        }
                        if (!selected.craftable) {
                            services.sendGameMessage(event.player, "You can't smith that yet.");
                            return;
                        }
                        closeDialog?.(event.player, meta.id);
                        trySmithRecipe(event.player, selected.recipe, event.tick, {
                            desiredCount: selected.batch,
                        });
                    },
                });
            if (!openedDialog) {
                const fallback = craftableChoices[0];
                if (!fallback) {
                    services.sendGameMessage(
                        event.player,
                        "You need a higher Smithing level or more bars.",
                    );
                    return;
                }
                trySmithRecipe(event.player, fallback.recipe, event.tick, {
                    desiredCount: fallback.batch,
                });
            }
        });

        registry.registerLocAction("smelt", (event) => {
            if (services.openSmeltingInterface) {
                services.openSmeltingInterface(event.player);
                return;
            }
            const smithLevel = event.player.getSkill(SkillId.Smithing).baseLevel;
            const inventory = getInventory(services, event.player);
            const smeltChoices: SkillDialogChoice<SmeltingRecipe>[] = SMELTING_RECIPES.map(
                (recipe) => {
                    const available = clampBatchCount(computeSmeltingBatchCount(inventory, recipe));
                    const levelMet = smithLevel >= recipe.level;
                    const craftable = levelMet && available > 0;
                    const ready = Math.max(1, Math.min(MAX_BATCH, available));
                    const label = craftable
                        ? `${recipe.name} (${ready}x ready)`
                        : !levelMet
                        ? `${recipe.name} (Lvl ${recipe.level})`
                        : `${recipe.name} (${recipe.ingredientsLabel ?? "Need ores"})`;
                    return {
                        recipe,
                        label,
                        craftable,
                        batch: Math.max(1, ready),
                    };
                },
            );
            const craftableChoices = smeltChoices.filter((choice) => choice.craftable);
            const orderedChoices = craftableChoices
                .concat(smeltChoices.filter((choice) => !choice.craftable))
                .slice(0, MAX_DIALOG_OPTIONS);
            if (!orderedChoices.length) {
                services.sendGameMessage(event.player, "You need ores to smelt any bars.");
                return;
            }
            const meta = SKILL_DIALOG_META.smelt;
            const openedDialog =
                openDialogOptions &&
                openDialogOptions(event.player, {
                    id: meta.id,
                    title: meta.title,
                    modal: true,
                    options: orderedChoices.map((choice) => choice.label),
                    disabledOptions: orderedChoices.map((choice) => !choice.craftable),
                    onSelect: (choiceIdx) => {
                        const selected = orderedChoices[choiceIdx];
                        if (!selected) {
                            services.sendGameMessage(
                                event.player,
                                "You decide not to smelt anything.",
                            );
                            return;
                        }
                        if (!selected.craftable) {
                            services.sendGameMessage(event.player, "You can't smelt that yet.");
                            return;
                        }
                        closeDialog?.(event.player, meta.id);
                        trySmeltRecipe(event.player, selected.recipe, event.tick, {
                            desiredCount: selected.batch,
                        });
                    },
                });
            if (!openedDialog) {
                const fallback = craftableChoices[0];
                if (!fallback) {
                    services.sendGameMessage(event.player, "You need more ores to smelt bars.");
                    return;
                }
                trySmeltRecipe(event.player, fallback.recipe, event.tick, {
                    desiredCount: fallback.batch,
                });
            }
        });

        registry.registerLocAction("cook", (event) => {
            const level = event.player.getSkill(SkillId.Cooking).baseLevel;
            const inventory = getInventory(services, event.player);
            const heatSource = resolveCookingHeatSource(services, event.locId);
            const cookingCandidates = COOKING_RECIPES.filter((recipe) =>
                hasItem(inventory, recipe.rawItemId),
            ).map<SkillDialogChoice<CookingRecipe>>((recipe) => {
                const totalRaw = countItem(inventory, recipe.rawItemId);
                const levelMet = level >= recipe.level;
                const craftable = levelMet && totalRaw > 0;
                const readyCount = Math.max(1, Math.min(MAX_BATCH, totalRaw));
                const label = craftable
                    ? `${recipe.name} (${readyCount}x ready)`
                    : !levelMet
                    ? `${recipe.name} (Lvl ${recipe.level})`
                    : `${recipe.name} (${totalRaw} raw)`;
                return {
                    recipe,
                    label,
                    craftable,
                    batch: readyCount,
                };
            });
            if (!cookingCandidates.length) {
                services.sendGameMessage(event.player, "You need something raw to cook.");
                return;
            }
            const craftableChoices = cookingCandidates.filter((choice) => choice.craftable);
            const orderedChoices = craftableChoices
                .concat(cookingCandidates.filter((choice) => !choice.craftable))
                .slice(0, MAX_DIALOG_OPTIONS);
            const meta = SKILL_DIALOG_META.cook;
            const openedDialog =
                openDialogOptions &&
                orderedChoices.length > 0 &&
                openDialogOptions(event.player, {
                    id: meta.id,
                    title: meta.title,
                    modal: true,
                    options: orderedChoices.map((choice) => choice.label),
                    disabledOptions: orderedChoices.map((choice) => !choice.craftable),
                    onSelect: (choiceIdx) => {
                        const selected = orderedChoices[choiceIdx];
                        if (!selected) {
                            services.sendGameMessage(event.player, "You stop cooking.");
                            return;
                        }
                        if (!selected.craftable) {
                            services.sendGameMessage(event.player, "You can't cook that yet.");
                            return;
                        }
                        closeDialog?.(event.player, meta.id);
                        tryCookingRecipe(event.player, selected.recipe, event.tick, {
                            desiredCount: selected.batch,
                            heatSource,
                        });
                    },
                });
            if (!openedDialog) {
                const fallback = craftableChoices[0];
                if (!fallback) {
                    services.sendGameMessage(event.player, "You need a higher Cooking level.");
                    return;
                }
                tryCookingRecipe(event.player, fallback.recipe, event.tick, {
                    desiredCount: fallback.batch,
                    heatSource,
                });
            }
        });

        registry.registerLocAction("tan", (event) => {
            const level = event.player.getSkill(SkillId.Crafting).baseLevel;
            const inventory = getInventory(services, event.player);
            const tanningCandidates = TANNING_RECIPES.filter((recipe) =>
                hasItem(inventory, recipe.inputItemId),
            ).map<SkillDialogChoice<TanningRecipe>>((recipe) => {
                const totalHides = countItem(inventory, recipe.inputItemId);
                const levelMet = !recipe.level || level >= recipe.level;
                const craftable = levelMet && totalHides > 0;
                const readyCount = Math.max(1, Math.min(MAX_BATCH, totalHides));
                const label = craftable
                    ? `${recipe.name} (${readyCount}x ready)`
                    : !levelMet
                    ? `${recipe.name} (Lvl ${recipe.level})`
                    : `${recipe.name} (${totalHides} hides)`;
                return {
                    recipe,
                    label,
                    craftable,
                    batch: readyCount,
                };
            });
            if (!tanningCandidates.length) {
                services.sendGameMessage(event.player, "You need hides to tan.");
                return;
            }
            const craftableChoices = tanningCandidates.filter((choice) => choice.craftable);
            const orderedChoices = craftableChoices
                .concat(tanningCandidates.filter((choice) => !choice.craftable))
                .slice(0, MAX_DIALOG_OPTIONS);
            const meta = SKILL_DIALOG_META.tan;
            const openedDialog =
                openDialogOptions &&
                orderedChoices.length > 0 &&
                openDialogOptions(event.player, {
                    id: meta.id,
                    title: meta.title,
                    modal: true,
                    options: orderedChoices.map((choice) => choice.label),
                    disabledOptions: orderedChoices.map((choice) => !choice.craftable),
                    onSelect: (choiceIdx) => {
                        const selected = orderedChoices[choiceIdx];
                        if (!selected) {
                            services.sendGameMessage(
                                event.player,
                                "You decide not to tan any hides.",
                            );
                            return;
                        }
                        if (!selected.craftable) {
                            services.sendGameMessage(event.player, "You can't tan that yet.");
                            return;
                        }
                        closeDialog?.(event.player, meta.id);
                        tryTanningRecipe(event.player, selected.recipe, event.tick, {
                            desiredCount: selected.batch,
                        });
                    },
                });
            if (!openedDialog) {
                const fallback = craftableChoices[0];
                if (!fallback) {
                    services.sendGameMessage(event.player, "You need a higher Crafting level.");
                    return;
                }
                tryTanningRecipe(event.player, fallback.recipe, event.tick, {
                    desiredCount: fallback.batch,
                });
            }
        });
    },
};
