/**
 * Skill action execution handler.
 *
 * Handles execution of skill-related actions:
 * - Smith, Cook, Tan, Smelt, Bolt Enchant
 *
 * Uses dependency injection via services interface to avoid tight coupling.
 */
import type { InventoryAddResult, PlayerState } from "../../player";
import { type InventoryItem as RuneInventoryItem, RuneValidator } from "../../spells/RuneValidator";
import type {
    SkillBoltEnchantActionData as BoltEnchantActionData,
    SkillCookActionData as CookActionData,
    SkillSmeltActionData as SmeltActionData,
    SkillSmithActionData as SmithActionData,
    SkillTanActionData as TanActionData,
} from "../skillActionPayloads";
import type { ActionEffect, ActionExecutionResult, ActionRequest } from "../types";

// ============================================================================
// Types
// ============================================================================

/** Vec2 type for tile positions. */
export interface Vec2 {
    x: number;
    y: number;
}

/** Inventory entry type. */
export interface InventoryEntry {
    itemId: number;
    quantity: number;
}

/** Skill level data. */
export interface SkillData {
    baseLevel: number;
    boost: number;
    xp?: number;
}

/** Recipe input requirement. */
export interface RecipeInput {
    itemId: number;
    quantity: number;
}

/** Removal result from inventory. */
export interface RemovalResult {
    ok: boolean;
    removed: Map<number, { itemId: number; quantity: number }>;
}

/** Action schedule request. */
export type SkillScheduledActionKind =
    | "skill.smith"
    | "skill.cook"
    | "skill.tan"
    | "skill.smelt"
    | "skill.bolt_enchant";

export type ActionScheduleRequest<K extends SkillScheduledActionKind = SkillScheduledActionKind> =
    ActionRequest<K>;

/** Action schedule result. */
export interface ActionScheduleResult {
    ok: boolean;
    reason?: string;
}

// Recipe types
export interface SmithingRecipe {
    id: string;
    name: string;
    level: number;
    barItemId: number;
    barCount: number;
    outputItemId: number;
    outputQuantity: number;
    xp: number;
    animation?: number;
    delayTicks?: number;
    requireHammer?: boolean;
}

export interface CookingRecipe {
    id: string;
    name: string;
    level: number;
    rawItemId: number;
    cookedItemId: number;
    burntItemId?: number;
    xp: number;
    animation?: number;
    delayTicks?: number;
}

export interface TanningRecipe {
    id: string;
    name: string;
    level?: number;
    inputItemId: number;
    outputItemId: number;
    xp: number;
    animation?: number;
    delayTicks?: number;
}

export interface SmeltingRecipe {
    id: string;
    name: string;
    level: number;
    inputs: RecipeInput[];
    outputItemId: number;
    outputQuantity: number;
    xp: number;
    animation?: number;
    delayTicks?: number;
    successType?: string;
}


// ============================================================================
// Services Interface
// ============================================================================

/**
 * Services interface for skill action handling.
 */
export interface SkillActionServices {
    // --- Player Skills ---
    getSkill(player: PlayerState, skillId: number): SkillData;
    awardSkillXp(player: PlayerState, skillId: number, xp: number): void;

    // --- Inventory Operations ---
    getInventory(player: PlayerState): InventoryEntry[];
    findInventorySlotWithItem(player: PlayerState, itemId: number): number | undefined;
    consumeItem(player: PlayerState, slot: number): boolean;
    setInventorySlot(player: PlayerState, slot: number, itemId: number, quantity: number): void;
    addItemToInventory(player: PlayerState, itemId: number, quantity: number): InventoryAddResult;
    hasInventorySlot(player: PlayerState): boolean;
    playerHasItem(player: PlayerState, itemId: number): boolean;
    restoreInventoryItems(player: PlayerState, itemId: number, removed: Map<number, number>): void;
    takeInventoryItems(player: PlayerState, inputs: RecipeInput[]): RemovalResult;
    restoreInventoryRemovals(
        player: PlayerState,
        removed: Map<number, { itemId: number; quantity: number }>,
    ): void;
    getEquipArray(player: PlayerState): number[];

    // --- Action Scheduling ---
    scheduleAction<K extends SkillScheduledActionKind>(
        playerId: number,
        request: ActionScheduleRequest<K>,
        tick: number,
    ): ActionScheduleResult;

    // --- Effect Building ---
    buildSkillFailure(player: PlayerState, message: string, reason: string): ActionExecutionResult;
    buildSkillMessageEffect(player: PlayerState, message: string): ActionEffect;
    smithingInterfaceFailure(
        player: PlayerState,
        message: string,
        reason: string,
        mode?: string,
    ): ActionExecutionResult;

    // --- Recipe Lookups ---
    getSmithingRecipeById(id: string): SmithingRecipe | undefined;
    getCookingRecipeById(id: string): CookingRecipe | undefined;
    getCookingRecipeByRawItemId(itemId: number): CookingRecipe | undefined;
    getTanningRecipeById(id: string): TanningRecipe | undefined;
    getSmeltingRecipeById(id: string): SmeltingRecipe | undefined;

    // --- Skill Success Rolls ---
    rollCookingOutcome(
        recipe: CookingRecipe,
        level: number,
        options: { burnBonus?: number },
    ): "success" | "burn";
    rollSmeltingSuccess(
        level: number,
        recipe: SmeltingRecipe,
        equip: number[],
        ringCharges?: number,
    ): boolean;

    // --- Description Helpers ---
    describeBar(itemId: number): string;

    // --- Interface Updates ---
    updateSmithingInterface(player: PlayerState): void;
    updateSmeltingInterface(player: PlayerState): void;

    // --- Smelting Helpers ---
    firstRemovedSlot(
        removed: Map<number, { itemId: number; quantity: number }>,
    ): number | undefined;
    getSmeltingXpWithBonuses(recipe: SmeltingRecipe, equip: number[]): number;
    getRingOfForgingCharges(player: PlayerState): number | undefined;
    consumeRingOfForgingCharge(player: PlayerState, effects: ActionEffect[]): void;

    // --- Logging ---
    log(level: "info" | "warn" | "error", message: string, data?: unknown): void;
}

// ============================================================================
// Constants
// ============================================================================

const SkillId = {
    Attack: 0,
    Defence: 1,
    Strength: 2,
    Hitpoints: 3,
    Ranged: 4,
    Prayer: 5,
    Magic: 6,
    Cooking: 7,
    Smithing: 13,
} as const;

const HAMMER_ITEM_ID = 2347;
const FURNACE_ANIMATION = 899;
const DEFAULT_COOKING_BURN_BONUS = 3;
const BOLT_ENCHANT_BOLTS_PER_SET = 10;
const BOLT_ENCHANT_DELAY_TICKS = 3;
const BOLT_ENCHANT_ACTION_GROUP = "skill.bolt_enchant";
const BOLT_ENCHANT_DEFAULT_ANIMATION = 4462;

// ============================================================================
// Handler Class
// ============================================================================

/**
 * Handles skill action execution.
 */
export class SkillActionHandler {
    constructor(private readonly services: SkillActionServices) {}

    // ========================================================================
    // Public API - Action Executors
    // ========================================================================

    /**
     * Execute smithing action.
     */
    executeSkillSmithAction(
        player: PlayerState,
        data: SmithActionData,
        tick: number,
    ): ActionExecutionResult {
        const recipeId = data.recipeId;
        const recipe = this.services.getSmithingRecipeById(recipeId);
        if (!recipe) {
            return this.services.smithingInterfaceFailure(
                player,
                "You can't smith that.",
                "unknown_recipe",
                "forge",
            );
        }

        const skill = this.services.getSkill(player, SkillId.Smithing);
        if (skill.baseLevel < recipe.level) {
            return this.services.smithingInterfaceFailure(
                player,
                `You need Smithing level ${recipe.level} to smith that.`,
                "smith_level",
                "forge",
            );
        }

        if (
            recipe.requireHammer !== false &&
            !this.services.playerHasItem(player, HAMMER_ITEM_ID)
        ) {
            return this.services.smithingInterfaceFailure(
                player,
                "You need a hammer to smith items.",
                "hammer",
                "forge",
            );
        }

        const tickNow = tick;
        const targetCount = Math.max(1, data.count);
        const removed = new Map<number, number>();
        const requiredBars = Math.max(1, recipe.barCount);

        for (let i = 0; i < requiredBars; i++) {
            const slot = this.services.findInventorySlotWithItem(player, recipe.barItemId);
            if (slot === undefined || !this.services.consumeItem(player, slot)) {
                this.services.restoreInventoryItems(player, recipe.barItemId, removed);
                return this.services.smithingInterfaceFailure(
                    player,
                    "You need more bars.",
                    "missing_bars",
                    "forge",
                );
            }
            removed.set(slot, (removed.get(slot) ?? 0) + 1);
        }

        const firstSlot = removed.keys().next()?.value;
        if (firstSlot !== undefined) {
            this.services.setInventorySlot(
                player,
                firstSlot,
                recipe.outputItemId,
                Math.max(1, recipe.outputQuantity),
            );
        } else {
            const dest = this.services.addItemToInventory(
                player,
                recipe.outputItemId,
                Math.max(1, recipe.outputQuantity),
            );
            if (dest.added <= 0) {
                this.services.restoreInventoryItems(player, recipe.barItemId, removed);
                return this.services.smithingInterfaceFailure(
                    player,
                    "You need more inventory space to smith that.",
                    "inventory_full",
                    "forge",
                );
            }
        }

        player.queueOneShotSeq(recipe.animation ?? 898);
        this.services.awardSkillXp(player, SkillId.Smithing, recipe.xp);

        const effects: ActionEffect[] = [
            { type: "inventorySnapshot", playerId: player.id },
            this.services.buildSkillMessageEffect(
                player,
                `You smith ${
                    recipe.outputQuantity > 1
                        ? `${recipe.outputQuantity} ${recipe.name}`
                        : `a ${recipe.name}`
                }.`,
            ),
        ];

        const remaining = Math.max(0, targetCount - 1);
        if (remaining > 0) {
            const reschedule = this.services.scheduleAction(
                player.id,
                {
                    kind: "skill.smith",
                    data: { recipeId: recipe.id, count: remaining },
                    delayTicks: recipe.delayTicks ?? 4,
                    cooldownTicks: recipe.delayTicks ?? 4,
                    groups: ["skill.smith"],
                },
                tickNow,
            );
            if (!reschedule.ok) {
                effects.push(
                    this.services.buildSkillMessageEffect(
                        player,
                        "You stop smithing because you're already busy.",
                    ),
                );
            }
        }

        this.services.updateSmithingInterface(player);
        return {
            ok: true,
            cooldownTicks: recipe.delayTicks !== undefined ? Math.max(1, recipe.delayTicks) : 4,
            groups: ["skill.smith"],
            effects,
        };
    }

    /**
     * Execute cooking action.
     */
    executeSkillCookAction(
        player: PlayerState,
        data: CookActionData,
        tick: number,
    ): ActionExecutionResult {
        const recipeId = data.recipeId;
        const recipe = this.services.getCookingRecipeById(recipeId);
        if (!recipe) {
            return this.services.buildSkillFailure(
                player,
                "You can't cook that.",
                "unknown_recipe",
            );
        }

        const skill = this.services.getSkill(player, SkillId.Cooking);
        const effectiveLevel = Math.max(1, skill.baseLevel + skill.boost);
        if (effectiveLevel < recipe.level) {
            return this.services.buildSkillFailure(
                player,
                `You need Cooking level ${recipe.level} to cook that.`,
                "cook_level",
            );
        }

        const slot = this.services.findInventorySlotWithItem(player, recipe.rawItemId);
        if (slot === undefined || !this.services.consumeItem(player, slot)) {
            return this.services.buildSkillFailure(
                player,
                "You need raw food to cook.",
                "missing_item",
            );
        }

        const tickNow = tick;
        const targetCount = Math.max(1, data.count);
        const heatSourceRaw = String(data.heatSource ?? "").toLowerCase();
        const heatSource = heatSourceRaw === "fire" ? "fire" : "range";
        const burnBonus = heatSource === "fire" ? 0 : DEFAULT_COOKING_BURN_BONUS;

        const outcome = this.services.rollCookingOutcome(recipe, effectiveLevel, { burnBonus });
        const cooked = outcome === "success";
        const burntItemId = recipe.burntItemId ?? -1;
        const producedItemId = cooked || !(burntItemId > 0) ? recipe.cookedItemId : burntItemId;

        this.services.setInventorySlot(player, slot, producedItemId, 1);
        player.queueOneShotSeq(recipe.animation ?? 897);

        if (cooked) {
            this.services.awardSkillXp(player, SkillId.Cooking, recipe.xp);
        }

        const effects: ActionEffect[] = [
            { type: "inventorySnapshot", playerId: player.id },
            this.services.buildSkillMessageEffect(
                player,
                cooked
                    ? `You cook the ${recipe.name}.`
                    : `You accidentally burn the ${recipe.name}.`,
            ),
        ];

        const remaining = Math.max(0, targetCount - 1);
        if (remaining > 0) {
            const reschedule = this.services.scheduleAction(
                player.id,
                {
                    kind: "skill.cook",
                    data: { recipeId: recipe.id, count: remaining, heatSource },
                    delayTicks: recipe.delayTicks ?? 3,
                    cooldownTicks: recipe.delayTicks ?? 3,
                    groups: ["skill.cook"],
                },
                tickNow,
            );
            if (!reschedule.ok) {
                effects.push(
                    this.services.buildSkillMessageEffect(
                        player,
                        "You stop cooking because you're already busy.",
                    ),
                );
            }
        }

        return {
            ok: true,
            cooldownTicks: recipe.delayTicks !== undefined ? Math.max(1, recipe.delayTicks) : 3,
            groups: ["skill.cook"],
            effects,
        };
    }

    /**
     * Execute tanning action.
     */
    executeSkillTanAction(
        player: PlayerState,
        data: TanActionData,
        tick: number,
    ): ActionExecutionResult {
        const recipeId = data.recipeId;
        const recipe = this.services.getTanningRecipeById(recipeId);
        if (!recipe) {
            return this.services.buildSkillFailure(player, "You can't tan that.", "unknown_recipe");
        }

        const skill = this.services.getSkill(player, SkillId.Crafting);
        if (recipe.level && skill.baseLevel < recipe.level) {
            return this.services.buildSkillFailure(
                player,
                `You need Crafting level ${recipe.level} to tan that.`,
                "tan_level",
            );
        }

        const slot = this.services.findInventorySlotWithItem(player, recipe.inputItemId);
        if (slot === undefined || !this.services.consumeItem(player, slot)) {
            return this.services.buildSkillFailure(
                player,
                "You need hides to tan.",
                "missing_item",
            );
        }

        const tickNow = tick;
        const targetCount = Math.max(1, data.count);

        this.services.setInventorySlot(player, slot, recipe.outputItemId, 1);
        player.queueOneShotSeq(recipe.animation ?? 1249);
        this.services.awardSkillXp(player, SkillId.Crafting, recipe.xp);

        const effects: ActionEffect[] = [
            { type: "inventorySnapshot", playerId: player.id },
            this.services.buildSkillMessageEffect(player, `You tan the hide into ${recipe.name}.`),
        ];

        const remaining = Math.max(0, targetCount - 1);
        if (remaining > 0) {
            const reschedule = this.services.scheduleAction(
                player.id,
                {
                    kind: "skill.tan",
                    data: { recipeId: recipe.id, count: remaining },
                    delayTicks: recipe.delayTicks ?? 2,
                    cooldownTicks: recipe.delayTicks ?? 2,
                    groups: ["skill.tan"],
                },
                tickNow,
            );
            if (!reschedule.ok) {
                effects.push(
                    this.services.buildSkillMessageEffect(
                        player,
                        "You stop tanning because you're already busy.",
                    ),
                );
            }
        }

        return {
            ok: true,
            cooldownTicks: recipe.delayTicks !== undefined ? Math.max(1, recipe.delayTicks) : 2,
            groups: ["skill.tan"],
            effects,
        };
    }
    /**
     * Execute smelting action.
     */
    executeSkillSmeltAction(
        player: PlayerState,
        data: SmeltActionData,
        tick: number,
    ): ActionExecutionResult {
        const recipeId = data.recipeId;
        const recipe = this.services.getSmeltingRecipeById(recipeId);
        if (!recipe) {
            return this.services.smithingInterfaceFailure(
                player,
                "You can't smelt that bar.",
                "unknown_recipe",
            );
        }

        const skill = this.services.getSkill(player, SkillId.Smithing);
        if (skill.baseLevel < recipe.level) {
            return this.services.smithingInterfaceFailure(
                player,
                `You need Smithing level ${recipe.level} to smelt that.`,
                "smelt_level",
            );
        }

        const removal = this.services.takeInventoryItems(player, recipe.inputs);
        if (!removal.ok) {
            return this.services.smithingInterfaceFailure(
                player,
                "You need the right ores to smelt that.",
                "missing_ore",
            );
        }

        const tickNow = tick;
        const targetCount = Math.max(1, data.count);
        const delay = recipe.delayTicks !== undefined ? Math.max(1, recipe.delayTicks) : 4;
        const effects: ActionEffect[] = [];

        const equip = this.services.getEquipArray(player);
        const ringCharges =
            recipe.successType === "iron"
                ? this.services.getRingOfForgingCharges(player)
                : undefined;
        const success = this.services.rollSmeltingSuccess(
            skill.baseLevel,
            recipe,
            equip,
            ringCharges,
        );

        if (success) {
            let placed = false;
            const firstSlot = this.services.firstRemovedSlot(removal.removed);
            if (firstSlot !== undefined) {
                this.services.setInventorySlot(
                    player,
                    firstSlot,
                    recipe.outputItemId,
                    Math.max(1, recipe.outputQuantity),
                );
                placed = true;
            } else {
                const dest = this.services.addItemToInventory(
                    player,
                    recipe.outputItemId,
                    Math.max(1, recipe.outputQuantity),
                );
                if (dest.added <= 0) {
                    this.services.restoreInventoryRemovals(player, removal.removed);
                    return this.services.smithingInterfaceFailure(
                        player,
                        "You need more inventory space for the bar.",
                        "inventory_full",
                    );
                }
                placed = true;
            }

            if (placed) {
                player.queueOneShotSeq(recipe.animation ?? FURNACE_ANIMATION);
                const xpAward = this.services.getSmeltingXpWithBonuses(recipe, equip);
                this.services.awardSkillXp(player, SkillId.Smithing, xpAward);
                const barName = this.services.describeBar(recipe.outputItemId);
                effects.push(
                    { type: "inventorySnapshot", playerId: player.id },
                    this.services.buildSkillMessageEffect(
                        player,
                        `You retrieve a ${barName.toLowerCase()}.`,
                    ),
                );
                if (recipe.successType === "iron") {
                    this.services.consumeRingOfForgingCharge(player, effects);
                }
            }
        } else {
            effects.push(
                this.services.buildSkillMessageEffect(
                    player,
                    "The iron ore is too impure and you fail to produce a bar.",
                ),
            );
        }

        const remaining = Math.max(0, targetCount - 1);
        if (remaining > 0) {
            const reschedule = this.services.scheduleAction(
                player.id,
                {
                    kind: "skill.smelt",
                    data: { recipeId: recipe.id, count: remaining },
                    delayTicks: delay,
                    cooldownTicks: delay,
                    groups: ["skill.smelt"],
                },
                tickNow,
            );
            if (!reschedule.ok) {
                effects.push(this.services.buildSkillMessageEffect(player, "You stop smelting."));
            }
        }

        this.services.updateSmeltingInterface(player);
        return {
            ok: true,
            cooldownTicks: delay,
            groups: ["skill.smelt"],
            effects,
        };
    }

    /**
     * Execute crossbow bolt enchanting action.
     * Each cast enchants one set (10 bolts) and reschedules while count remains.
     */
    executeSkillBoltEnchantAction(
        player: PlayerState,
        data: BoltEnchantActionData,
        tick: number,
    ): ActionExecutionResult {
        const sourceItemId = data.sourceItemId;
        const enchantedItemId = data.enchantedItemId;
        const enchantedNameRaw = data.enchantedName.trim();
        const enchantedName = enchantedNameRaw.length > 0 ? enchantedNameRaw : "bolts";
        const requestedCount = Math.max(1, data.count);
        const animationId = data.animationId ?? BOLT_ENCHANT_DEFAULT_ANIMATION;
        const xpPerSet = Math.max(0, data.xp);

        if (!(sourceItemId > 0) || !(enchantedItemId > 0)) {
            return this.services.buildSkillFailure(
                player,
                "You can't enchant those bolts.",
                "bolt_enchant_invalid_items",
            );
        }

        const runeCostsRaw = Array.isArray(data.runeCosts) ? data.runeCosts : [];
        const runeCosts: Array<{ runeId: number; quantity: number }> = [];
        for (const entry of runeCostsRaw) {
            const runeId = entry.runeId;
            const quantity = entry.quantity;
            if (!(runeId > 0) || !(quantity > 0)) continue;
            runeCosts.push({ runeId, quantity });
        }

        const inventory = this.services.getInventory(player);
        let sourceQuantity = 0;
        const runeInventory: RuneInventoryItem[] = [];
        for (const entry of inventory) {
            if (!entry || entry.itemId <= 0 || entry.quantity <= 0) continue;
            if (entry.itemId === sourceItemId) {
                sourceQuantity += entry.quantity;
            }
            runeInventory.push({
                itemId: entry.itemId,
                quantity: entry.quantity,
            });
        }
        if (sourceQuantity < BOLT_ENCHANT_BOLTS_PER_SET) {
            return this.services.buildSkillFailure(
                player,
                "You don't have enough bolts to enchant.",
                "bolt_enchant_missing_bolts",
            );
        }

        const equipped = this.services.getEquipArray(player).filter((itemId) => itemId > 0);
        const runeValidation = RuneValidator.validateAndCalculate(
            runeCosts,
            runeInventory,
            equipped,
        );
        if (!runeValidation.canCast) {
            return this.services.buildSkillFailure(
                player,
                "You do not have the runes to cast this spell.",
                "bolt_enchant_missing_runes",
            );
        }

        const consumedRunes = Array.isArray(runeValidation.runesConsumed)
            ? runeValidation.runesConsumed
            : [];

        const boltRemoval = this.services.takeInventoryItems(player, [
            { itemId: sourceItemId, quantity: BOLT_ENCHANT_BOLTS_PER_SET },
        ]);
        if (!boltRemoval.ok) {
            return this.services.buildSkillFailure(
                player,
                "You don't have enough bolts to enchant.",
                "bolt_enchant_missing_bolts",
            );
        }

        let runeRemoval: RemovalResult | undefined;
        if (consumedRunes.length > 0) {
            runeRemoval = this.services.takeInventoryItems(
                player,
                consumedRunes.map((entry) => ({
                    itemId: entry.runeId,
                    quantity: Math.max(1, entry.quantity),
                })),
            );
            if (!runeRemoval.ok) {
                this.services.restoreInventoryRemovals(player, boltRemoval.removed);
                return this.services.buildSkillFailure(
                    player,
                    "You do not have the runes to cast this spell.",
                    "bolt_enchant_missing_runes",
                );
            }
        }

        const addResult = this.services.addItemToInventory(
            player,
            enchantedItemId,
            BOLT_ENCHANT_BOLTS_PER_SET,
        );
        if (addResult.added <= 0) {
            this.services.restoreInventoryRemovals(player, boltRemoval.removed);
            if (runeRemoval?.ok) {
                this.services.restoreInventoryRemovals(player, runeRemoval.removed);
            }
            return this.services.buildSkillFailure(
                player,
                "You don't have enough inventory space.",
                "bolt_enchant_inventory_full",
            );
        }

        player.queueOneShotSeq(animationId);
        if (xpPerSet > 0) {
            this.services.awardSkillXp(player, SkillId.Magic, xpPerSet);
        }

        const effects: ActionEffect[] = [
            { type: "inventorySnapshot", playerId: player.id },
            this.services.buildSkillMessageEffect(
                player,
                `You enchant ${BOLT_ENCHANT_BOLTS_PER_SET} ${enchantedName}.`,
            ),
        ];

        const tickNow = tick;
        const remaining = Math.max(0, requestedCount - 1);
        if (remaining > 0) {
            const reschedule = this.services.scheduleAction(
                player.id,
                {
                    kind: "skill.bolt_enchant",
                    data: {
                        sourceItemId,
                        enchantedItemId,
                        enchantedName,
                        runeCosts,
                        xp: xpPerSet,
                        count: remaining,
                        animationId,
                    },
                    delayTicks: BOLT_ENCHANT_DELAY_TICKS,
                    cooldownTicks: BOLT_ENCHANT_DELAY_TICKS,
                    groups: [BOLT_ENCHANT_ACTION_GROUP],
                },
                tickNow,
            );
            if (!reschedule.ok) {
                effects.push(
                    this.services.buildSkillMessageEffect(
                        player,
                        "You stop enchanting because you're already busy.",
                    ),
                );
            }
        }

        return {
            ok: true,
            cooldownTicks: BOLT_ENCHANT_DELAY_TICKS,
            groups: [BOLT_ENCHANT_ACTION_GROUP],
            effects,
        };
    }

}
