/**
 * Skill action execution handler.
 *
 * Handles execution of skill-related actions extracted from wsServer:
 * - Smith, Cook, Tan, Fletch, Spin, Sinew, Flax
 * - Mining, Fishing, Smelting, Firemaking, Woodcutting
 *
 * Uses dependency injection via services interface to avoid tight coupling.
 */
import type { NpcState } from "../../npc";
import type { InventoryAddResult, PlayerState } from "../../player";
import type {
    FishingCatchDefinition,
    FishingMethodDefinition,
    FishingSpotDefinition,
    FishingToolDefinition,
    FishingToolId,
} from "../../skills/fishing";
import type { MiningRockDefinition, PickaxeDefinition } from "../../skills/mining";
import type { HatchetDefinition, WoodcuttingTreeDefinition } from "../../skills/woodcutting";
import { type InventoryItem as RuneInventoryItem, RuneValidator } from "../../spells/RuneValidator";
import type {
    SkillBoltEnchantActionData as BoltEnchantActionData,
    SkillCookActionData as CookActionData,
    SkillFiremakingActionData as FiremakingActionData,
    SkillFishingActionData as FishingActionData,
    SkillFlaxActionData as FlaxActionData,
    SkillFletchActionData as FletchActionData,
    SkillMiningActionData as MiningActionData,
    SkillSinewActionData as SinewActionData,
    SkillSmeltActionData as SmeltActionData,
    SkillSmithActionData as SmithActionData,
    SkillSpinActionData as SpinActionData,
    SkillTanActionData as TanActionData,
    SkillWoodcuttingActionData as WoodcuttingActionData,
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
    | "skill.fletch"
    | "skill.spin"
    | "skill.sinew"
    | "skill.flax"
    | "skill.woodcut"
    | "skill.firemaking"
    | "skill.mine"
    | "skill.fish"
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

export interface FletchingRecipe {
    id: string;
    productName: string;
    level: number;
    inputItemId: number;
    secondaryItemId?: number;
    productItemId: number;
    outputQuantity: number;
    xp: number;
    animation?: number;
    delayTicks?: number;
    mode?: string;
    kind?: string;
    consumeSecondary?: boolean;
    outputMode?: string;
    secondaryLabel?: string;
    successMessage?: string;
}

export interface SpinningRecipe {
    id: string;
    name: string;
    level: number;
    inputItemId: number;
    inputName: string;
    inputQuantity: number;
    productItemId: number;
    outputQuantity: number;
    xp: number;
    animation: number;
    delayTicks: number;
    successMessage: string;
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

export interface FiremakingLogDef {
    logId: number;
    level: number;
    xp: number;
    burnTicks: { min: number; max: number };
    fireObjectId: number;
}

export type WoodcuttingTreeDef = WoodcuttingTreeDefinition;
export type MiningRockDef = MiningRockDefinition;

export type FishingSpotDef = FishingSpotDefinition;
export type FishingMethodDef = FishingMethodDefinition;
export type FishingCatchDef = FishingCatchDefinition;
export type FishingToolDef = FishingToolDefinition;

export type HatchetDef = HatchetDefinition;
export type PickaxeDef = PickaxeDefinition;

// ============================================================================
// Services Interface
// ============================================================================

/**
 * Services interface for skill action handling.
 */
export interface SkillActionServices {
    // --- Core ---
    getCurrentTick(): number;
    getNpc(id: number): NpcState | undefined;

    // --- Player Skills ---
    getSkill(player: PlayerState, skillId: number): SkillData;
    awardSkillXp(player: PlayerState, skillId: number, xp: number): void;

    // --- Inventory Operations ---
    getInventory(player: PlayerState): InventoryEntry[];
    findInventorySlotWithItem(player: PlayerState, itemId: number): number | undefined;
    consumeItem(player: PlayerState, slot: number): boolean;
    setInventorySlot(player: PlayerState, slot: number, itemId: number, quantity: number): void;
    addItemToInventory(player: PlayerState, itemId: number, quantity: number): InventoryAddResult;
    addItemToBank(player: PlayerState, itemId: number, quantity: number): boolean;
    queueBankSnapshot(player: PlayerState): void;
    hasInventorySlot(player: PlayerState): boolean;
    canStoreItem(player: PlayerState, itemId: number): boolean;
    playerHasItem(player: PlayerState, itemId: number): boolean;
    restoreInventoryItems(player: PlayerState, itemId: number, removed: Map<number, number>): void;
    takeInventoryItems(player: PlayerState, inputs: RecipeInput[]): RemovalResult;
    restoreInventoryRemovals(
        player: PlayerState,
        removed: Map<number, { itemId: number; quantity: number }>,
    ): void;
    collectCarriedItemIds(player: PlayerState): number[];
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
    getFletchingRecipeById(id: string): FletchingRecipe | undefined;
    getSpinningRecipeById(id: string): SpinningRecipe | undefined;
    getSmeltingRecipeById(id: string): SmeltingRecipe | undefined;
    getFiremakingLogDefinition(logId: number): FiremakingLogDef | undefined;
    getWoodcuttingTreeById(id: string): WoodcuttingTreeDef | undefined;
    getWoodcuttingTreeDefinition(locId: number): WoodcuttingTreeDef | undefined;
    getMiningRockById(id: string): MiningRockDef | undefined;
    getMiningRockDefinition(locId: number): MiningRockDef | undefined;
    getFishingSpotById(id: string): FishingSpotDef | undefined;
    getFishingSpotDefinition(npcTypeId: number): FishingSpotDef | undefined;
    getFishingMethodById(spot: FishingSpotDef, methodId: string): FishingMethodDef | undefined;
    getFishingToolDefinition(toolId: FishingToolId): FishingToolDef | undefined;

    // --- Tool Selection ---
    selectHatchetByLevel(itemIds: number[], level: number): HatchetDef | undefined;
    selectPickaxeByLevel(itemIds: number[], level: number): PickaxeDef | undefined;
    selectFishingTool(toolId: FishingToolId, itemIds: number[]): FishingToolDef | undefined;
    pickFishingCatch(method: FishingMethodDef, level: number): FishingCatchDef | undefined;

    // --- Skill Success Rolls ---
    rollCookingOutcome(
        recipe: CookingRecipe,
        level: number,
        options: { burnBonus?: number },
    ): "success" | "burn";
    rollWoodcuttingSuccess(level: number, treeLevel: number, hatchet: HatchetDef): boolean;
    rollMiningSuccess(level: number, rockLevel: number, pickaxe: PickaxeDef): boolean;
    rollFishingSuccess(level: number, catchLevel: number, tool: FishingToolDef): boolean;
    rollSmeltingSuccess(
        level: number,
        recipe: SmeltingRecipe,
        equip: number[],
        ringCharges?: number,
    ): boolean;
    rollFiremakingSuccess(level: number, logLevel: number): boolean;
    shouldDepleteTree(tree: WoodcuttingTreeDef): boolean;

    // --- Resource Tracking ---
    isWoodcuttingDepleted(key: string): boolean;
    markWoodcuttingDepleted(
        info: {
            key: string;
            locId: number;
            stumpId: number;
            tile: Vec2;
            level: number;
            treeId: string;
            respawnTicks?: WoodcuttingTreeDefinition["respawnTicks"];
        },
        tick: number,
    ): void;
    isMiningDepleted(key: string): boolean;
    markMiningDepleted(
        info: {
            key: string;
            locId: number;
            depletedLocId?: number;
            tile: Vec2;
            level: number;
            rockId: string;
            respawnTicks?: MiningRockDefinition["respawnTicks"];
        },
        tick: number,
    ): void;
    isTileLit(tile: Vec2, level: number): boolean;
    isFiremakingTileBlocked(tile: Vec2, level: number): boolean;
    lightFire(params: {
        tile: Vec2;
        level: number;
        logItemId: number;
        currentTick: number;
        burnTicks: { min: number; max: number };
        fireObjectId: number;
        previousLocId: number;
        ownerId: number;
    }): { fireObjectId: number };

    // --- Flax Tracking ---
    isFlaxDepleted(tile: Vec2, level: number): boolean;
    markFlaxDepleted(info: {
        tile: Vec2;
        level: number;
        locId: number;
        respawnTicks: number;
    }, tick: number): void;

    // --- Tile Key Builders ---
    buildWoodcuttingTileKey(tile: Vec2, level: number): string;
    buildMiningTileKey(tile: Vec2, level: number): string;

    // --- Adjacency Checks ---
    isAdjacentToLoc(player: PlayerState, locId: number, tile: Vec2, level: number): boolean;
    isAdjacentToNpc(player: PlayerState, npc: NpcState): boolean;

    // --- Facing ---
    faceGatheringTarget(player: PlayerState, tile: Vec2): void;

    // --- Item Helpers ---
    isSinewSourceItem(itemId: number): boolean;
    playerHasTinderbox(player: PlayerState): boolean;
    consumeFiremakingLog(
        player: PlayerState,
        logId: number,
        slotIndex?: number,
    ): number | undefined;

    // --- Description Helpers ---
    describeLog(itemId: number): string;
    describeOre(itemId: number): string;
    describeBar(itemId: number): string;
    describeFish(itemId: number): string;

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

    // --- Firemaking Helpers ---
    computeFireLightingDelayTicks(level: number): number;
    /**
     * Walk the player one tile west of the fire tile (OSRS parity: player is pushed
     * off the fire tile after successfully lighting it).
     */
    walkPlayerAwayFromFire(player: PlayerState, fireTile: Vec2): void;

    // --- Location Changes ---
    emitLocChange(fromLocId: number, toLocId: number, tile: Vec2, level: number, opts?: { newShape?: number; newRotation?: number }): void;
    enqueueSoundBroadcast(soundId: number, x: number, y: number, level: number): void;
    sendSound(player: PlayerState, soundId: number, opts?: { delay?: number }): void;

    // --- Varbit / Loc Change ---
    setPlayerVarbit(player: PlayerState, varbitId: number, value: number): void;
    sendLocChangeToPlayer(
        player: PlayerState,
        oldId: number,
        newId: number,
        tile: Vec2,
        level: number,
    ): void;

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
    Woodcutting: 8,
    Fletching: 9,
    Fishing: 10,
    Firemaking: 11,
    Crafting: 12,
    Smithing: 13,
    Mining: 14,
} as const;

const HAMMER_ITEM_ID = 2347;
const SINEW_ITEM_ID = 9436;
const SINEW_ANIMATION_ID = 1249;
const SINEW_CRAFT_XP = 5;
const SINEW_DELAY_TICKS = 2;
const FIRE_LIGHTING_ANIMATION = 733;
const FIRE_LIT_SYNTH_SOUND = 2596;
const FURNACE_ANIMATION = 899;
const DEFAULT_COOKING_BURN_BONUS = 3;
const ITEM_PICKUP_SOUND = 2739;
const FLAX_ITEM_ID = 1779;
const FLAX_PICK_ANIMATION = 827;
const FLAX_PICK_SOUND = 2581;
const FLAX_PICK_DELAY_TICKS = 3;
const FLAX_RESPAWN_TICKS = 25;
const BOLT_ENCHANT_BOLTS_PER_SET = 10;
const BOLT_ENCHANT_DELAY_TICKS = 3;
const BOLT_ENCHANT_ACTION_GROUP = "skill.bolt_enchant";
const BOLT_ENCHANT_DEFAULT_ANIMATION = 4462;
// OSRS: 2734 = "tree_fall" - plays when tree depletes
const WOODCUTTING_DEPLETE_SOUND = 2734;
const WOODCUTTING_INVENTORY_FULL_SOUND = 2277;
const ECHO_AXE_ITEM_IDS = [25110];
const ECHO_PICKAXE_ITEM_IDS = [25112, 25063, 25369, 25376];
const ECHO_HARPOON_ITEM_IDS = [25059, 25061, 25114, 25115, 25367, 25368, 25373, 25374];
const ECHO_HARPOON_SUBSTITUTABLE_TOOL_IDS = new Set([
    "small_net",
    "big_net",
    "fishing_rod",
    "fly_fishing_rod",
    "lobster_pot",
    "harpoon",
    "heavy_rod",
]);

// ============================================================================
// Handler Class
// ============================================================================

/**
 * Handles skill action execution.
 */
export class SkillActionHandler {
    constructor(private readonly services: SkillActionServices) {}

    private stopGatheringInteraction(player: PlayerState): void {
        try {
            player.clearInteraction();
        } catch {}
        try {
            player.stopAnimation();
        } catch {}
    }

    private cancelMovementIntent(player: PlayerState): void {
        try {
            player.clearPath();
        } catch {}
        try {
            player.clearWalkDestination();
        } catch {}
    }

    private failGatheringPrecheck(
        player: PlayerState,
        message: string,
        reason: string,
    ): ActionExecutionResult {
        this.cancelMovementIntent(player);
        this.stopGatheringInteraction(player);
        return this.services.buildSkillFailure(player, message, reason);
    }

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
     * Execute fletching action.
     */
    executeSkillFletchAction(
        player: PlayerState,
        data: FletchActionData,
        tick: number,
    ): ActionExecutionResult {
        const inventory = this.services.getInventory(player);
        const recipeId = data.recipeId;
        const recipe = this.services.getFletchingRecipeById(recipeId);
        if (!recipe) {
            return this.services.buildSkillFailure(
                player,
                "You can't fletch that.",
                "unknown_recipe",
            );
        }

        const skill = this.services.getSkill(player, SkillId.Fletching);
        if (skill.baseLevel < recipe.level) {
            return this.services.buildSkillFailure(
                player,
                `You need Fletching level ${recipe.level} to make that.`,
                "fletching_level",
            );
        }

        const inputSlot = this.services.findInventorySlotWithItem(player, recipe.inputItemId);
        if (inputSlot === undefined) {
            const { message, reason } = this.getFletchingMissingInputMessage(recipe);
            return this.services.buildSkillFailure(player, message, reason);
        }

        const secondaryId = recipe.secondaryItemId;
        let secondarySlot: number | undefined;
        if (secondaryId !== undefined) {
            secondarySlot = this.services.findInventorySlotWithItem(player, secondaryId);
            if (secondarySlot === undefined) {
                const { message, reason } = this.getFletchingMissingSecondaryMessage(recipe);
                return this.services.buildSkillFailure(player, message, reason);
            }
        }

        if (!this.services.consumeItem(player, inputSlot)) {
            return this.services.buildSkillFailure(
                player,
                "You can't use that item right now.",
                "consume_fail",
            );
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
            if (!this.services.consumeItem(player, secondarySlot)) {
                restoreConsumedItem(inputSlot, recipe.inputItemId);
                const { message, reason } = this.getFletchingMissingSecondaryMessage(recipe);
                return this.services.buildSkillFailure(player, message, reason);
            }
            secondaryConsumed = true;
        }

        const productQuantity = Math.max(1, recipe.outputQuantity);
        const outputMode = recipe.outputMode ?? "replace";

        if (outputMode === "add") {
            const dest = this.services.addItemToInventory(
                player,
                recipe.productItemId,
                productQuantity,
            );
            if (dest.added <= 0) {
                restoreConsumedItem(inputSlot, recipe.inputItemId);
                if (secondaryConsumed && secondarySlot !== undefined && secondaryId !== undefined) {
                    restoreConsumedItem(secondarySlot, secondaryId);
                }
                return this.services.buildSkillFailure(
                    player,
                    "You need more inventory space to keep fletching.",
                    "fletch_inventory_full",
                );
            }
        } else {
            this.services.setInventorySlot(
                player,
                inputSlot,
                recipe.productItemId,
                productQuantity,
            );
        }

        player.queueOneShotSeq(recipe.animation ?? 1248);
        this.services.awardSkillXp(player, SkillId.Fletching, recipe.xp);

        const description = this.getFletchingSuccessMessage(recipe);
        const effects: ActionEffect[] = [
            { type: "inventorySnapshot", playerId: player.id },
            this.services.buildSkillMessageEffect(player, description),
        ];

        const tickNow = tick;
        const totalCount = Math.max(1, data.count);
        const remaining = Math.max(0, totalCount - 1);

        if (remaining > 0) {
            const reschedule = this.services.scheduleAction(
                player.id,
                {
                    kind: "skill.fletch",
                    data: { recipeId: recipe.id, count: remaining },
                    delayTicks: recipe.delayTicks ?? 3,
                    cooldownTicks: recipe.delayTicks ?? 3,
                    groups: ["skill.fletch"],
                },
                tickNow,
            );
            if (!reschedule.ok) {
                effects.push(
                    this.services.buildSkillMessageEffect(
                        player,
                        "You stop fletching because you're already busy.",
                    ),
                );
            }
        }

        return {
            ok: true,
            cooldownTicks: recipe.delayTicks !== undefined ? Math.max(1, recipe.delayTicks) : 3,
            groups: ["skill.fletch"],
            effects,
        };
    }

    /**
     * Execute spinning action.
     */
    executeSkillSpinAction(
        player: PlayerState,
        data: SpinActionData,
        tick: number,
    ): ActionExecutionResult {
        const recipeId = data.recipeId;
        const recipe = this.services.getSpinningRecipeById(recipeId);
        if (!recipe) {
            return this.services.buildSkillFailure(
                player,
                "You can't spin that.",
                "spin_unknown_recipe",
            );
        }

        const skill = this.services.getSkill(player, SkillId.Crafting);
        if (skill.baseLevel < recipe.level) {
            return this.services.buildSkillFailure(
                player,
                `You need Crafting level ${recipe.level} to spin ${recipe.name}.`,
                "spin_level",
            );
        }

        const totalCount = Math.max(1, data.count);
        const removed = new Map<number, number>();
        const requiredPerSpin = Math.max(1, recipe.inputQuantity);

        for (let i = 0; i < requiredPerSpin; i++) {
            const slot = this.services.findInventorySlotWithItem(player, recipe.inputItemId);
            if (slot === undefined || !this.services.consumeItem(player, slot)) {
                this.services.restoreInventoryItems(player, recipe.inputItemId, removed);
                return this.services.buildSkillFailure(
                    player,
                    `You need more ${recipe.inputName} to keep spinning.`,
                    "spin_missing_item",
                );
            }
            removed.set(slot, (removed.get(slot) ?? 0) + 1);
        }

        const productQuantity = Math.max(1, recipe.outputQuantity);
        const firstSlot = removed.keys().next()?.value;
        if (firstSlot !== undefined) {
            this.services.setInventorySlot(
                player,
                firstSlot,
                recipe.productItemId,
                productQuantity,
            );
        } else {
            const dest = this.services.addItemToInventory(
                player,
                recipe.productItemId,
                productQuantity,
            );
            if (dest.added <= 0) {
                this.services.restoreInventoryItems(player, recipe.inputItemId, removed);
                return this.services.buildSkillFailure(
                    player,
                    "You need more inventory space to keep spinning.",
                    "spin_inventory_full",
                );
            }
        }

        player.queueOneShotSeq(recipe.animation);
        this.services.awardSkillXp(player, SkillId.Crafting, recipe.xp);

        const effects: ActionEffect[] = [
            { type: "inventorySnapshot", playerId: player.id },
            this.services.buildSkillMessageEffect(player, recipe.successMessage),
        ];

        const tickNow = tick;
        const remaining = Math.max(0, totalCount - 1);

        if (remaining > 0) {
            const reschedule = this.services.scheduleAction(
                player.id,
                {
                    kind: "skill.spin",
                    data: { recipeId: recipe.id, count: remaining },
                    delayTicks: recipe.delayTicks,
                    cooldownTicks: recipe.delayTicks,
                    groups: ["skill.spin"],
                },
                tickNow,
            );
            if (!reschedule.ok) {
                effects.push(
                    this.services.buildSkillMessageEffect(
                        player,
                        "You stop spinning because you're already busy.",
                    ),
                );
            }
        }

        return {
            ok: true,
            cooldownTicks: recipe.delayTicks,
            groups: ["skill.spin"],
            effects,
        };
    }

    /**
     * Execute sinew crafting action.
     */
    executeSkillSinewAction(
        player: PlayerState,
        data: SinewActionData,
        _tick: number,
    ): ActionExecutionResult {
        const sourceItemId = data.itemId;
        if (!this.services.isSinewSourceItem(sourceItemId)) {
            return this.services.buildSkillFailure(
                player,
                "You can't turn that into sinew.",
                "sinew_invalid",
            );
        }

        let slot = data.slot;
        if (slot === undefined) {
            slot = this.services.findInventorySlotWithItem(player, sourceItemId);
        }

        if (slot === undefined || !this.services.consumeItem(player, slot)) {
            return this.services.buildSkillFailure(
                player,
                "You need raw meat to dry into sinew.",
                "sinew_missing",
            );
        }

        this.services.setInventorySlot(player, slot, SINEW_ITEM_ID, 1);
        player.queueOneShotSeq(SINEW_ANIMATION_ID);
        this.services.awardSkillXp(player, SkillId.Crafting, SINEW_CRAFT_XP);

        const effects: ActionEffect[] = [
            { type: "inventorySnapshot", playerId: player.id },
            this.services.buildSkillMessageEffect(player, "You dry the meat into sinew."),
        ];

        return {
            ok: true,
            cooldownTicks: SINEW_DELAY_TICKS,
            groups: ["skill.sinew"],
            effects,
        };
    }

    /**
     * Execute flax spinning action.
     */
    executeSkillFlaxAction(
        player: PlayerState,
        data: FlaxActionData,
        tick: number,
    ): ActionExecutionResult {
        const tile: Vec2 = { x: data.tile.x, y: data.tile.y };
        const plane = data.level;
        const locId = data.locId;

        if (this.services.isFlaxDepleted(tile, plane)) {
            return this.failGatheringPrecheck(player, "", "flax_depleted");
        }

        if (!this.services.hasInventorySlot(player)) {
            return this.failGatheringPrecheck(
                player,
                "Your inventory is too full to hold any more flax.",
                "inventory_full",
            );
        }

        const effects: ActionEffect[] = [];

        this.services.faceGatheringTarget(player, tile);
        player.queueOneShotSeq(FLAX_PICK_ANIMATION);

        this.services.enqueueSoundBroadcast(FLAX_PICK_SOUND, tile.x, tile.y, plane);

        this.services.markFlaxDepleted({
            tile,
            level: plane,
            locId,
            respawnTicks: FLAX_RESPAWN_TICKS,
        }, tick);
        this.services.emitLocChange(locId, 0, tile, plane);

        const result = this.services.addItemToInventory(player, FLAX_ITEM_ID, 1);
        if (result.added > 0) {
            effects.push({ type: "inventorySnapshot", playerId: player.id });
        }

        effects.push(
            this.services.buildSkillMessageEffect(player, "You pick some flax."),
        );

        this.services.sendSound(player, FLAX_PICK_SOUND);

        return {
            ok: true,
            cooldownTicks: FLAX_PICK_DELAY_TICKS,
            groups: ["skill.flax"],
            effects,
        };
    }

    /**
     * Execute mining action.
     */
    executeSkillMiningAction(
        player: PlayerState,
        data: MiningActionData,
        tick: number,
    ): ActionExecutionResult {
        const locId = data.rockLocId;
        const rockId = data.rockId;
        const rock =
            (rockId ? this.services.getMiningRockById(rockId) : undefined) ??
            this.services.getMiningRockDefinition(locId);

        if (!rock) {
            return this.failGatheringPrecheck(player, "You can't mine that rock.", "invalid_rock");
        }

        const tile: Vec2 = { x: data.tile.x, y: data.tile.y };
        const plane = data.level;
        const actionDepletedLocId = data.depletedLocId;
        const nodeKey = this.services.buildMiningTileKey(tile, plane);

        if (this.services.isMiningDepleted(nodeKey)) {
            return this.failGatheringPrecheck(player, "The rock is depleted of ore.", "rock_empty");
        }

        if (!this.services.isAdjacentToLoc(player, locId, tile, plane)) {
            return this.failGatheringPrecheck(player, "You stop mining the rock.", "too_far");
        }

        const skill = this.services.getSkill(player, SkillId.Mining);
        const effectiveLevel = Math.max(1, skill.baseLevel + skill.boost);

        if (effectiveLevel < rock.level) {
            return this.failGatheringPrecheck(
                player,
                `You need Mining level ${rock.level} to mine this rock.`,
                "mining_level",
            );
        }

        const carriedIds = this.services.collectCarriedItemIds(player);
        const pickaxe = this.services.selectPickaxeByLevel(carriedIds, effectiveLevel);
        if (!pickaxe) {
            return this.failGatheringPrecheck(
                player,
                "You need a pickaxe that you have the Mining level to use.",
                "no_pickaxe",
            );
        }
        const hasEchoPickaxePerk = this.hasAnyCarriedItem(carriedIds, ECHO_PICKAXE_ITEM_IDS);

        if (!hasEchoPickaxePerk && !this.services.hasInventorySlot(player)) {
            return this.failGatheringPrecheck(
                player,
                "Your inventory is too full to hold any more ore.",
                "inventory_full",
            );
        }

        const tickNow = tick;
        const swingTicks = Math.max(rock.swingTicks, pickaxe.swingTicks);
        const effects: ActionEffect[] = [];

        if (!data.started) {
            effects.push(
                this.services.buildSkillMessageEffect(
                    player,
                    "You swing your pickaxe at the rock.",
                ),
            );
            this.services.faceGatheringTarget(player, tile);
            player.queueOneShotSeq(pickaxe.animation);
            const initialSchedule = this.services.scheduleAction(
                player.id,
                {
                    kind: "skill.mine",
                    data: {
                        rockId: rock.id,
                        rockLocId: locId,
                        depletedLocId: actionDepletedLocId,
                        tile: { x: tile.x, y: tile.y },
                        level: plane,
                        started: true,
                        echoMinedCount: data.echoMinedCount,
                    },
                    delayTicks: swingTicks,
                    cooldownTicks: swingTicks,
                    groups: ["skill.mine"],
                },
                tickNow,
            );
            if (!initialSchedule.ok) {
                effects.push(
                    this.services.buildSkillMessageEffect(player, "You stop mining the rock."),
                );
            }
            return {
                ok: true,
                cooldownTicks: 0,
                groups: ["skill.mine"],
                effects,
            };
        }

        this.services.faceGatheringTarget(player, tile);
        player.queueOneShotSeq(pickaxe.animation);

        let success = false;
        let inventorySnapshot = false;
        let bankSnapshot = false;
        const echoMinedCount = data.echoMinedCount;
        let nextEchoMinedCount = echoMinedCount;

        success = this.services.rollMiningSuccess(effectiveLevel, rock.level, pickaxe);
        if (!success && hasEchoPickaxePerk && Math.random() < 0.5) {
            success = true;
        }

        if (success) {
            if (hasEchoPickaxePerk) {
                const banked = this.services.addItemToBank(player, rock.oreItemId, 1);
                if (!banked) {
                    return this.failGatheringPrecheck(
                        player,
                        "Your bank is too full to hold any more ore.",
                        "bank_full",
                    );
                }
                bankSnapshot = true;
            } else {
                const result = this.services.addItemToInventory(player, rock.oreItemId, 1);
                if (result.added <= 0) {
                    return this.failGatheringPrecheck(
                        player,
                        "Your inventory is too full to hold any more ore.",
                        "inventory_full",
                    );
                }
                inventorySnapshot = true;
            }

            const oreName = this.services.describeOre(rock.oreItemId);
            effects.push(
                this.services.buildSkillMessageEffect(
                    player,
                    `You manage to mine some ${oreName}.`,
                ),
            );
            if (hasEchoPickaxePerk) {
                const capitalizedOreName =
                    oreName.charAt(0).toUpperCase() + oreName.slice(1);
                effects.push(
                    this.services.buildSkillMessageEffect(
                        player,
                        `1x ${capitalizedOreName} were sent straight to your bank.`,
                    ),
                );
            }
            this.services.awardSkillXp(player, SkillId.Mining, rock.xp);

            if (locId > 0) {
                nextEchoMinedCount = hasEchoPickaxePerk ? echoMinedCount + 1 : 0;
                const canDeplete = !hasEchoPickaxePerk || nextEchoMinedCount >= 4;
                if (canDeplete) {
                    const depletedLocId =
                        typeof actionDepletedLocId === "number" && actionDepletedLocId > 0
                            ? actionDepletedLocId
                            : undefined;

                    this.services.markMiningDepleted(
                        {
                            key: nodeKey,
                            locId,
                            depletedLocId,
                            tile,
                            level: plane,
                            rockId: rock.id,
                            respawnTicks: rock.respawnTicks,
                        },
                        tickNow,
                    );

                    if (depletedLocId !== undefined) {
                        this.services.emitLocChange(locId, depletedLocId, tile, plane);
                    }
                    effects.push(
                        this.services.buildSkillMessageEffect(
                            player,
                            "The rock is depleted of its ore.",
                        ),
                    );
                    this.stopGatheringInteraction(player);
                }
            }
        }

        if (inventorySnapshot) {
            effects.push({ type: "inventorySnapshot", playerId: player.id });
        }
        if (bankSnapshot) {
            this.services.queueBankSnapshot(player);
        }

        let continueMining = !this.services.isMiningDepleted(nodeKey);
        if (continueMining) {
            if (!hasEchoPickaxePerk && !this.services.hasInventorySlot(player)) {
                continueMining = false;
                effects.push(
                    this.services.buildSkillMessageEffect(
                        player,
                        "Your inventory is too full to hold any more ore.",
                    ),
                );
            } else if (!this.services.isAdjacentToLoc(player, locId, tile, plane)) {
                continueMining = false;
            }
        }

        if (continueMining) {
            const reschedule = this.services.scheduleAction(
                player.id,
                {
                    kind: "skill.mine",
                    data: {
                        rockId: rock.id,
                        rockLocId: locId,
                        depletedLocId: actionDepletedLocId,
                        tile: { x: tile.x, y: tile.y },
                        level: plane,
                        started: true,
                        echoMinedCount: nextEchoMinedCount,
                    },
                    delayTicks: swingTicks,
                    cooldownTicks: swingTicks,
                    groups: ["skill.mine"],
                },
                tickNow,
            );
            if (!reschedule.ok) {
                effects.push(
                    this.services.buildSkillMessageEffect(player, "You stop mining the rock."),
                );
            }
        }

        return {
            ok: true,
            cooldownTicks: swingTicks,
            groups: ["skill.mine"],
            effects,
        };
    }

    /**
     * Execute fishing action.
     */
    executeSkillFishingAction(
        player: PlayerState,
        data: FishingActionData,
        tick: number,
    ): ActionExecutionResult {
        const npcId = data.npcId;
        const npcTypeId = data.npcTypeId;
        const methodId = data.methodId;
        const priorSpotId = data.spotId;

        if (!(npcId > 0) || !(npcTypeId > 0) || !methodId) {
            return this.failGatheringPrecheck(
                player,
                "You stop fishing.",
                "invalid_fishing_action",
            );
        }

        const npc = this.services.getNpc(npcId);
        if (!npc || npc.typeId !== npcTypeId) {
            return this.failGatheringPrecheck(
                player,
                "The fishing spot drifts out of reach.",
                "fishing_spot_missing",
            );
        }

        const spot =
            (priorSpotId ? this.services.getFishingSpotById(priorSpotId) : undefined) ??
            this.services.getFishingSpotDefinition(npc.typeId);
        if (!spot) {
            return this.failGatheringPrecheck(
                player,
                "You can't fish here.",
                "unknown_fishing_spot",
            );
        }

        const method = this.services.getFishingMethodById(spot, methodId);
        if (!method) {
            return this.failGatheringPrecheck(
                player,
                "You can't fish here.",
                "unknown_fishing_method",
            );
        }

        const tile: Vec2 = { x: npc.tileX, y: npc.tileY };
        const plane = npc.level;

        if (player.level !== plane) {
            return this.failGatheringPrecheck(player, "You stop fishing.", "level_mismatch");
        }

        if (!this.services.isAdjacentToNpc(player, npc)) {
            return this.failGatheringPrecheck(player, "You stop fishing.", "too_far");
        }

        const skill = this.services.getSkill(player, SkillId.Fishing);
        const effectiveLevel = Math.max(1, skill.baseLevel + skill.boost);
        const catchDef = this.services.pickFishingCatch(method, effectiveLevel);

        if (!catchDef) {
            const minLevel = method.catches.reduce(
                (min, entry) => Math.min(min, entry.level),
                Number.MAX_SAFE_INTEGER,
            );
            return this.failGatheringPrecheck(
                player,
                `You need Fishing level ${minLevel} to fish here.`,
                "fishing_level",
            );
        }

        const carriedIds = this.services.collectCarriedItemIds(player);
        const hasEchoHarpoonPerk = this.hasAnyCarriedItem(carriedIds, ECHO_HARPOON_ITEM_IDS);
        const methodToolId = this.normalizeFishingToolId(method.toolId);
        let tool = this.services.selectFishingTool(method.toolId, carriedIds);
        if (
            !tool &&
            hasEchoHarpoonPerk &&
            this.canEchoHarpoonSubstituteForMethodTool(methodToolId)
        ) {
            tool = this.services.getFishingToolDefinition("harpoon");
        }
        if (!tool) {
            const requiredTool = this.services.getFishingToolDefinition(method.toolId);
            return this.failGatheringPrecheck(
                player,
                `You need a ${requiredTool?.name ?? "fishing tool"} to fish here.`,
                "no_fishing_tool",
            );
        }

        let baitSlot: number | undefined;
        if (Array.isArray(method.baitItemIds) && method.baitItemIds.length > 0) {
            for (const baitId of method.baitItemIds) {
                const slot = this.services.findInventorySlotWithItem(player, baitId);
                if (slot !== undefined) {
                    baitSlot = slot;
                    break;
                }
            }
            if (baitSlot === undefined) {
                const baitLabel = method.baitName ?? "bait";
                return this.failGatheringPrecheck(
                    player,
                    `You don't have any ${baitLabel}.`,
                    "no_bait",
                );
            }
        }

        const catchItemId = catchDef.itemId;
        if (!hasEchoHarpoonPerk && !this.services.canStoreItem(player, catchItemId)) {
            return this.failGatheringPrecheck(
                player,
                "Your inventory is too full to hold any more fish.",
                "inventory_full",
            );
        }

        const tickNow = tick;
        const effects: ActionEffect[] = [];

        if (!data.started) {
            effects.push(
                this.services.buildSkillMessageEffect(player, "You attempt to catch some fish."),
            );
        }

        this.services.faceGatheringTarget(player, tile);
        player.queueOneShotSeq(tool.animation);

        let inventorySnapshot = false;
        let bankSnapshot = false;
        let success = this.services.rollFishingSuccess(effectiveLevel, catchDef.level, tool);
        if (!success && hasEchoHarpoonPerk && Math.random() < 0.5) {
            success = true;
        }
        const quantity = catchDef.quantity !== undefined ? Math.max(1, catchDef.quantity) : 1;

        if (success) {
            let rewardItemId = catchItemId;
            let autoCooked = false;
            if (hasEchoHarpoonPerk) {
                const cookingRecipe = this.services.getCookingRecipeByRawItemId(catchItemId);
                if (cookingRecipe && Math.random() < 0.5) {
                    rewardItemId = cookingRecipe.cookedItemId;
                    autoCooked = true;
                    this.services.awardSkillXp(player, SkillId.Cooking, cookingRecipe.xp);
                }
            }

            if (hasEchoHarpoonPerk) {
                const banked = this.services.addItemToBank(player, rewardItemId, quantity);
                if (!banked) {
                    return this.failGatheringPrecheck(
                        player,
                        "Your bank is too full to hold any more fish.",
                        "bank_full",
                    );
                }
                bankSnapshot = true;
            } else {
                const result = this.services.addItemToInventory(player, rewardItemId, quantity);
                if (result.added <= 0) {
                    return this.failGatheringPrecheck(
                        player,
                        "Your inventory is too full to hold any more fish.",
                        "inventory_full",
                    );
                }
                inventorySnapshot = true;
            }

            const fishName = this.services.describeFish(rewardItemId);
            effects.push(
                this.services.buildSkillMessageEffect(
                    player,
                    hasEchoHarpoonPerk && autoCooked
                        ? `You catch and cook some ${fishName}.`
                        : `You catch some ${fishName}.`,
                ),
            );
            if (hasEchoHarpoonPerk) {
                const capitalizedFishName =
                    fishName.charAt(0).toUpperCase() + fishName.slice(1);
                effects.push(
                    this.services.buildSkillMessageEffect(
                        player,
                        `${quantity}x ${capitalizedFishName} were sent straight to your bank.`,
                    ),
                );
            }
            this.services.awardSkillXp(player, SkillId.Fishing, catchDef.xp);

            if (baitSlot !== undefined && Array.isArray(method.baitItemIds)) {
                if (!this.services.consumeItem(player, baitSlot)) {
                    return this.failGatheringPrecheck(
                        player,
                        "You fumble your bait and stop fishing.",
                        "bait_consume_failed",
                    );
                }
                inventorySnapshot = true;
            }
        } else {
            effects.push(
                this.services.buildSkillMessageEffect(player, "You fail to catch anything."),
            );
        }

        if (inventorySnapshot) {
            effects.push({ type: "inventorySnapshot", playerId: player.id });
        }
        if (bankSnapshot) {
            this.services.queueBankSnapshot(player);
        }

        let continueFishing = true;
        if (!hasEchoHarpoonPerk && !this.services.canStoreItem(player, catchItemId)) {
            continueFishing = false;
            effects.push(
                this.services.buildSkillMessageEffect(
                    player,
                    "Your inventory is too full to hold any more fish.",
                ),
            );
        }

        if (continueFishing && Array.isArray(method.baitItemIds) && method.baitItemIds.length > 0) {
            const hasBait = method.baitItemIds.some((baitId) =>
                this.services.playerHasItem(player, baitId),
            );
            if (!hasBait) {
                continueFishing = false;
                const baitLabel = method.baitName ?? "bait";
                effects.push(
                    this.services.buildSkillMessageEffect(
                        player,
                        `You have run out of ${baitLabel}.`,
                    ),
                );
            }
        }

        const baseSwingTicks = method.swingTicks;
        const swingTicks =
            hasEchoHarpoonPerk && baseSwingTicks > 1 ? baseSwingTicks - 1 : baseSwingTicks;
        if (continueFishing) {
            const npcSize = npc.size;
            const reschedule = this.services.scheduleAction(
                player.id,
                {
                    kind: "skill.fish",
                    data: {
                        npcId: npc.id,
                        npcTypeId: npc.typeId,
                        npcSize,
                        spotId: spot.id,
                        methodId: method.id,
                        level: plane,
                        started: true,
                    },
                    delayTicks: swingTicks,
                    cooldownTicks: swingTicks,
                    groups: ["skill.fish"],
                },
                tickNow,
            );
            if (!reschedule.ok) {
                effects.push(this.services.buildSkillMessageEffect(player, "You stop fishing."));
            }
        }

        return {
            ok: true,
            cooldownTicks: swingTicks,
            groups: ["skill.fish"],
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

    /**
     * Execute firemaking action.
     */
    executeSkillFiremakingAction(
        player: PlayerState,
        data: FiremakingActionData,
        tick: number,
    ): ActionExecutionResult {
        const logId = data.logItemId;
        const logDef = this.services.getFiremakingLogDefinition(logId);
        if (!logDef) {
            return this.failGatheringPrecheck(player, "You can't light that.", "invalid_fire_log");
        }

        const tile: Vec2 = { x: data.tile.x, y: data.tile.y };
        const plane = data.level;
        const slotIndex = data.slot;
        const attempts = Math.max(0, data.attempts);
        const effects: ActionEffect[] = [];

        if (!data.started) {
            effects.push(
                this.services.buildSkillMessageEffect(player, "You attempt to light the logs."),
            );
        }

        if (player.level !== plane) {
            return this.failGatheringPrecheck(
                player,
                "You stop lighting the logs.",
                "level_changed",
            );
        }

        if (player.tileX !== tile.x || player.tileY !== tile.y) {
            return this.failGatheringPrecheck(player, "You stop lighting the logs.", "moved_away");
        }

        if (!this.services.playerHasTinderbox(player)) {
            return this.failGatheringPrecheck(
                player,
                "You need a tinderbox to light these logs.",
                "missing_tinderbox",
            );
        }

        const skill = this.services.getSkill(player, SkillId.Firemaking);
        if (skill.baseLevel < logDef.level) {
            return this.failGatheringPrecheck(
                player,
                `You need Firemaking level ${logDef.level} to light these logs.`,
                "firemaking_level",
            );
        }

        if (this.services.isTileLit(tile, plane)) {
            return this.failGatheringPrecheck(player, "There's already a fire here.", "tile_lit");
        }

        if (this.services.isFiremakingTileBlocked(tile, plane)) {
            return this.failGatheringPrecheck(
                player,
                "You can't light a fire here.",
                "blocked_tile",
            );
        }

        this.services.faceGatheringTarget(player, tile);

        // OSRS parity: animation plays on every attempt (first attempt was started by the script
        // handler; retries restart it here).
        if (data.started) {
            player.queueOneShotSeq(FIRE_LIGHTING_ANIMATION);
        }

        const success = this.services.rollFiremakingSuccess(skill.baseLevel, logDef.level);
        if (!success) {
            effects.push(
                this.services.buildSkillMessageEffect(player, "You fail to light the logs."),
            );
            const delay = this.services.computeFireLightingDelayTicks(skill.baseLevel);
            const reschedule = this.services.scheduleAction(
                player.id,
                {
                    kind: "skill.firemaking",
                    data: {
                        logItemId: logDef.logId,
                        logLevel: logDef.level,
                        tile: { ...tile },
                        level: plane,
                        slot: slotIndex,
                        started: true,
                        attempts: attempts + 1,
                        previousLocId: data.previousLocId,
                    },
                    delayTicks: delay,
                    cooldownTicks: delay,
                    groups: ["skill.firemaking"],
                },
                tick,
            );
            if (!reschedule?.ok) {
                return this.failGatheringPrecheck(
                    player,
                    "You stop lighting the logs.",
                    "firemaking_reschedule_failed",
                );
            }
            return { ok: true, effects };
        }

        const consumedSlot = this.services.consumeFiremakingLog(player, logId, slotIndex);
        if (consumedSlot === undefined) {
            return this.failGatheringPrecheck(
                player,
                "You need logs to light a fire.",
                "missing_log",
            );
        }

        effects.push({ type: "inventorySnapshot", playerId: player.id });
        const logName = this.services.describeLog(logId);
        effects.push(
            this.services.buildSkillMessageEffect(
                player,
                `The fire catches and the ${logName} begin to burn.`,
            ),
        );

        this.services.awardSkillXp(player, SkillId.Firemaking, logDef.xp);

        const tickNow = tick;
        const fire = this.services.lightFire({
            tile,
            level: plane,
            logItemId: logId,
            currentTick: tickNow,
            burnTicks: logDef.burnTicks,
            fireObjectId: logDef.fireObjectId,
            previousLocId: data.previousLocId,
            ownerId: player.id,
        });

        this.services.emitLocChange(0, fire.fireObjectId, tile, plane);

        // OSRS parity: stop the lighting animation, walk the player west off the fire tile,
        // and play the fire-crackle synth sound.
        player.stopAnimation();
        this.services.walkPlayerAwayFromFire(player, tile);
        this.services.sendSound(player, FIRE_LIT_SYNTH_SOUND);

        return { ok: true, effects };
    }

    /**
     * Execute woodcutting action.
     */
    executeSkillWoodcutAction(
        player: PlayerState,
        data: WoodcuttingActionData,
        tick: number,
    ): ActionExecutionResult {
        const stopChopping = () => {
            this.stopGatheringInteraction(player);
        };

        const locId = data.treeLocId;
        const treeId = data.treeId;
        const tree =
            (treeId ? this.services.getWoodcuttingTreeById(treeId) : undefined) ??
            this.services.getWoodcuttingTreeDefinition(locId);

        if (!tree) {
            return this.failGatheringPrecheck(player, "You can't chop that tree.", "invalid_tree");
        }

        const tile: Vec2 = { x: data.tile.x, y: data.tile.y };
        const plane = data.level;
        const nodeKey = this.services.buildWoodcuttingTileKey(tile, plane);

        if (this.services.isWoodcuttingDepleted(nodeKey)) {
            return this.failGatheringPrecheck(player, "The tree has no logs left.", "tree_empty");
        }

        if (!this.services.isAdjacentToLoc(player, locId, tile, plane)) {
            this.services.log("info", "[woodcutting] player not adjacent", {
                playerId: player.id,
                playerPos: { x: player.tileX, y: player.tileY, level: player.level },
                treeTile: { ...tile },
                level: plane,
            });
            return this.failGatheringPrecheck(player, "You stop chopping the tree.", "too_far");
        }

        const skill = this.services.getSkill(player, SkillId.Woodcutting);
        const effectiveLevel = Math.max(1, skill.baseLevel + skill.boost);

        if (effectiveLevel < tree.level) {
            return this.failGatheringPrecheck(
                player,
                `You need Woodcutting level ${tree.level} to chop this tree.`,
                "woodcut_level",
            );
        }

        const hatchetIds = this.services.collectCarriedItemIds(player);
        const hatchet = this.services.selectHatchetByLevel(hatchetIds, effectiveLevel);
        if (!hatchet) {
            return this.failGatheringPrecheck(
                player,
                "You need an axe that you have the Woodcutting level to use.",
                "no_hatchet",
            );
        }
        const hasEchoAxePerk = this.hasAnyCarriedItem(hatchetIds, ECHO_AXE_ITEM_IDS);

        if (!hasEchoAxePerk && !this.services.hasInventorySlot(player)) {
            const logName = this.services.describeLog(tree.logItemId);
            this.services.sendSound(player, WOODCUTTING_INVENTORY_FULL_SOUND);
            return this.failGatheringPrecheck(
                player,
                `Your inventory is too full to hold any more ${logName}.`,
                "inventory_full",
            );
        }

        const tickNow = tick;
        const stumpId = data.stumpId;
        const effects: ActionEffect[] = [];

        if (!data.started) {
            this.services.faceGatheringTarget(player, tile);
            player.queueOneShotSeq(hatchet.animation);
            effects.push(
                this.services.buildSkillMessageEffect(player, "You swing your axe at the tree."),
            );
            // Schedule next tick (sound plays every tick)
            const reschedule = this.services.scheduleAction(
                player.id,
                {
                    kind: "skill.woodcut",
                    data: {
                        treeId: tree.id,
                        treeLocId: locId,
                        stumpId,
                        tile: { x: tile.x, y: tile.y },
                        level: plane,
                        started: true,
                        ticksInSwing: 0,
                    },
                    delayTicks: 1,
                    cooldownTicks: 1,
                    groups: ["skill.woodcut"],
                },
                tickNow,
            );
            if (!reschedule.ok) {
                stopChopping();
                effects.push(
                    this.services.buildSkillMessageEffect(player, "You stop chopping the tree."),
                );
            }
            return {
                ok: true,
                cooldownTicks: 1,
                groups: ["skill.woodcut"],
                effects,
            };
        }

        // Track how many ticks into the current swing cycle we are
        // RSMod: 4-tick cycle - animate at tick 0, roll at tick 2, wait until tick 4
        const ticksInSwing = data.ticksInSwing + 1;
        const shouldRoll = ticksInSwing === 2; // Roll happens exactly 2 ticks after animation

        // RSMod: Animation plays at the start of each swing cycle
        if (ticksInSwing === 0) {
            this.services.faceGatheringTarget(player, tile);
            player.queueOneShotSeq(hatchet.animation);
        }

        let treeDepleted = false;
        let inventorySnapshot = false;
        let bankSnapshot = false;

        // RSMod: Roll for success 2 ticks after animation starts
        let success =
            shouldRoll && this.services.rollWoodcuttingSuccess(effectiveLevel, tree.level, hatchet);
        if (!success && shouldRoll && hasEchoAxePerk && Math.random() < 0.5) {
            success = true;
        }
        if (success) {
            if (hasEchoAxePerk) {
                const banked = this.services.addItemToBank(player, tree.logItemId, 1);
                if (!banked) {
                    const logName = this.services.describeLog(tree.logItemId);
                    return this.failGatheringPrecheck(
                        player,
                        `Your bank is too full to hold any more ${logName}.`,
                        "bank_full",
                    );
                }
                bankSnapshot = true;
            } else {
                const result = this.services.addItemToInventory(player, tree.logItemId, 1);
                if (result.added <= 0) {
                    const logName = this.services.describeLog(tree.logItemId);
                    this.services.sendSound(player, WOODCUTTING_INVENTORY_FULL_SOUND);
                    return this.failGatheringPrecheck(
                        player,
                        `Your inventory is too full to hold any more ${logName}.`,
                        "inventory_full",
                    );
                }
                inventorySnapshot = true;
            }

            const logName = this.services.describeLog(tree.logItemId);
            effects.push(this.services.buildSkillMessageEffect(player, `You get some ${logName}.`));
            if (hasEchoAxePerk) {
                const capitalizedLogName =
                    logName.charAt(0).toUpperCase() + logName.slice(1);
                effects.push(
                    this.services.buildSkillMessageEffect(
                        player,
                        `1x ${capitalizedLogName} were sent straight to your bank.`,
                    ),
                );
            }
            this.services.awardSkillXp(player, SkillId.Woodcutting, tree.xp);

            if (this.services.shouldDepleteTree(tree)) {
                treeDepleted = true;
                if (locId > 0) {
                    this.services.markWoodcuttingDepleted(
                        {
                            key: nodeKey,
                            locId,
                            stumpId,
                            tile,
                            level: plane,
                            treeId: tree.id,
                            respawnTicks: tree.respawnTicks,
                        },
                        tickNow,
                    );
                    this.services.emitLocChange(locId, stumpId, tile, plane);
                    this.services.enqueueSoundBroadcast(
                        WOODCUTTING_DEPLETE_SOUND,
                        tile.x,
                        tile.y,
                        plane,
                    );
                    this.cancelMovementIntent(player);
                    stopChopping();
                } else {
                    this.services.log("warn", "[woodcutting] missing loc id for depletion", {
                        playerId: player.id,
                        tree: tree.id,
                    });
                }
                effects.push(
                    this.services.buildSkillMessageEffect(player, "The tree has run out of logs."),
                );
            }
        }

        if (inventorySnapshot) {
            effects.push({ type: "inventorySnapshot", playerId: player.id });
        }
        if (bankSnapshot) {
            this.services.queueBankSnapshot(player);
        }

        let continueChopping = !treeDepleted && !this.services.isWoodcuttingDepleted(nodeKey);
        if (continueChopping) {
            if (!hasEchoAxePerk && !this.services.hasInventorySlot(player)) {
                continueChopping = false;
                const logName = this.services.describeLog(tree.logItemId);
                this.services.sendSound(player, WOODCUTTING_INVENTORY_FULL_SOUND);
                effects.push(
                    this.services.buildSkillMessageEffect(
                        player,
                        `Your inventory is too full to hold any more ${logName}.`,
                    ),
                );
            } else if (!this.services.isAdjacentToLoc(player, locId, tile, plane)) {
                continueChopping = false;
            }
        }

        if (!continueChopping) {
            stopChopping();
        }

        if (continueChopping) {
            // RSMod: 4-tick cycle, reset after tick 4 (ticksInSwing >= 4 means next will be 0)
            const nextTicksInSwing = ticksInSwing >= 3 ? -1 : ticksInSwing; // -1 + 1 = 0 on next tick
            const reschedule = this.services.scheduleAction(
                player.id,
                {
                    kind: "skill.woodcut",
                    data: {
                        treeId: tree.id,
                        treeLocId: locId,
                        stumpId,
                        tile: { x: tile.x, y: tile.y },
                        level: plane,
                        started: true,
                        ticksInSwing: nextTicksInSwing,
                    },
                    delayTicks: 1,
                    cooldownTicks: 1,
                    groups: ["skill.woodcut"],
                },
                tickNow,
            );
            if (!reschedule.ok) {
                stopChopping();
                effects.push(
                    this.services.buildSkillMessageEffect(player, "You stop chopping the tree."),
                );
            }
        }

        return {
            ok: true,
            cooldownTicks: 1,
            groups: ["skill.woodcut"],
            effects,
        };
    }

    // ========================================================================
    // Private Helpers
    // ========================================================================

    private hasAnyCarriedItem(carriedItemIds: number[], candidateItemIds: number[]): boolean {
        if (carriedItemIds.length === 0 || candidateItemIds.length === 0) return false;
        const carried = new Set(carriedItemIds);
        return candidateItemIds.some((id) => carried.has(id));
    }

    private normalizeFishingToolId(toolId: unknown): string {
        return String(toolId ?? "")
            .trim()
            .toLowerCase();
    }

    private canEchoHarpoonSubstituteForMethodTool(toolId: string): boolean {
        return ECHO_HARPOON_SUBSTITUTABLE_TOOL_IDS.has(toolId);
    }

    private getFletchingMissingInputMessage(recipe: FletchingRecipe): {
        message: string;
        reason: string;
    } {
        if (recipe.mode === "string") {
            return {
                message: "You need unstrung bows in your inventory to keep fletching.",
                reason: "missing_unstrung",
            };
        }
        if (recipe.kind === "headless_arrow") {
            return {
                message: "You need arrow shafts in your inventory to keep fletching.",
                reason: "missing_arrow_shafts",
            };
        }
        if (recipe.kind === "arrow") {
            return {
                message: "You need headless arrows in your inventory to keep fletching.",
                reason: "missing_headless_arrows",
            };
        }
        if (["arrowtips", "bolt_tips", "javelin_heads", "dart_tips"].includes(recipe.kind ?? "")) {
            return {
                message: "You need amethyst in your inventory to keep fletching.",
                reason: "missing_amethyst",
            };
        }
        if (recipe.kind === "bolt") {
            return {
                message: "You need broad bolts in your inventory to keep fletching.",
                reason: "missing_broad_bolts",
            };
        }
        if (recipe.kind === "javelin") {
            return {
                message: "You need javelin shafts in your inventory to keep fletching.",
                reason: "missing_javelin_shafts",
            };
        }
        if (recipe.kind === "dart") {
            return {
                message: "You need amethyst dart tips in your inventory to keep fletching.",
                reason: "missing_dart_tips",
            };
        }
        return {
            message: "You need logs in your inventory to keep fletching.",
            reason: "missing_logs",
        };
    }

    private getFletchingMissingSecondaryMessage(recipe: FletchingRecipe): {
        message: string;
        reason: string;
    } {
        if (recipe.mode === "string") {
            return {
                message: "You need bowstrings to keep fletching.",
                reason: "missing_bowstring",
            };
        }
        if (recipe.kind === "headless_arrow" || recipe.kind === "dart") {
            return { message: "You need feathers to keep fletching.", reason: "missing_feathers" };
        }
        if (recipe.kind === "arrow") {
            return {
                message: "You need arrowtips to keep fletching.",
                reason: "missing_arrowtips",
            };
        }
        if (["arrowtips", "bolt_tips", "javelin_heads", "dart_tips"].includes(recipe.kind ?? "")) {
            const label = recipe.secondaryLabel ?? "a chisel";
            return { message: `You need ${label} to keep fletching.`, reason: "missing_tool" };
        }
        if (recipe.kind === "bolt") {
            return {
                message: "You need amethyst bolt tips to keep fletching.",
                reason: "missing_bolt_tips",
            };
        }
        if (recipe.kind === "javelin") {
            return {
                message: "You need amethyst javelin heads to keep fletching.",
                reason: "missing_javelin_heads",
            };
        }
        return {
            message: "You need the other ingredient to keep fletching.",
            reason: "missing_secondary_item",
        };
    }

    private getFletchingSuccessMessage(recipe: FletchingRecipe): string {
        if (recipe.successMessage) return recipe.successMessage;
        if (recipe.mode === "string") return `You string the ${recipe.productName}.`;
        if (recipe.kind === "arrow_shafts")
            return `You whittle the logs into ${recipe.outputQuantity} ${recipe.productName}.`;
        if (recipe.kind === "headless_arrow") return "You attach feathers to the arrow shafts.";
        if (recipe.kind === "arrow") return `You add the tips to make ${recipe.productName}s.`;
        if (["arrowtips", "bolt_tips", "javelin_heads", "dart_tips"].includes(recipe.kind ?? "")) {
            return `You carve the ${recipe.productName}.`;
        }
        if (recipe.kind === "bolt") return "You attach the amethyst tips to the bolts.";
        if (recipe.kind === "javelin") return "You attach the amethyst heads to the javelins.";
        if (recipe.kind === "dart") return "You add feathers to the dart tips.";
        return `You fletch the logs into ${recipe.productName}.`;
    }

}
