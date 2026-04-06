/**
 * Inventory action execution handler.
 *
 * Handles execution of inventory-related actions extracted from wsServer:
 * - executeInventoryUseOnAction (item use on targets)
 * - executeInventoryEquipAction (equip items)
 * - executeInventoryConsumeAction (consume items)
 * - executeScriptedConsumeAction (scripted item consumption)
 * - executeInventoryMoveAction (move items in inventory)
 * - executeInventoryUnequipAction (unequip items)
 *
 * Uses dependency injection via services interface to avoid tight coupling.
 */
import {
    MODIFIER_FLAG_CTRL,
    MODIFIER_FLAG_CTRL_SHIFT,
} from "../../../../../src/shared/input/modifierFlags";
import { logger } from "../../../utils/logger";
import type { NpcState } from "../../npc";
import type { InventoryAddResult, PlayerState } from "../../player";
import type {
    InventoryConsumeActionData,
    InventoryConsumeScriptActionData,
    InventoryEquipActionData,
    InventoryMoveActionData,
    InventoryUnequipActionData,
    InventoryUseOnActionData,
    InventoryUseOnTarget,
} from "../actionPayloads";
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

/** Action schedule request. */
export type InventoryScheduledActionKind = string;

export type ActionScheduleRequest<
    K extends InventoryScheduledActionKind = InventoryScheduledActionKind,
> = ActionRequest<K>;

/** Action schedule result. */
export interface ActionScheduleResult {
    ok: boolean;
    reason?: string;
}

/** Equip result. */
export interface EquipResult {
    ok: boolean;
    reason?: string;
    categoryChanged?: boolean;
    weaponItemChanged?: boolean;
}

/** Unequip result. */
export interface UnequipResult {
    ok: boolean;
    reason?: string;
}


function resolveRunWithModifier(baseRun: boolean, rawModifierFlags: number | undefined): boolean {
    const flags = rawModifierFlags ?? 0;
    let run = !!baseRun;
    if ((flags & MODIFIER_FLAG_CTRL) !== 0) {
        run = !run;
    }
    if (flags === MODIFIER_FLAG_CTRL_SHIFT) {
        run = true;
    }
    return run;
}

/** Object type info. */
export interface ObjTypeInfo {
    name?: string;
    options?: string[];
}

/** Route strategy interface. */
export interface RouteStrategy {
    hasArrived(x: number, y: number, level: number): boolean;
}

/** Path result. */
export interface PathResult {
    ok: boolean;
    steps?: Vec2[];
    end?: Vec2;
}

function pathResultSatisfiesStrategy(
    from: { x: number; y: number; plane: number },
    result: PathResult,
    strategy: RouteStrategy,
): boolean {
    if (!result.ok || !Array.isArray(result.steps)) {
        return false;
    }

    const selectedEnd =
        result.steps.length > 0
            ? result.end ?? result.steps[result.steps.length - 1]!
            : { x: from.x, y: from.y };
    return strategy.hasArrived(selectedEnd.x, selectedEnd.y, from.plane);
}

// ============================================================================
// Services Interface
// ============================================================================

/**
 * Services interface for inventory action handling.
 */
export interface InventoryActionServices {
    // --- Core ---
    getCurrentTick(): number;

    // --- Entity Access ---
    getNpc(id: number): NpcState | undefined;
    getPlayer(id: number): PlayerState | undefined;

    // --- Inventory Operations ---
    getInventory(player: PlayerState): InventoryEntry[];
    addItemToInventory(player: PlayerState, itemId: number, quantity: number): InventoryAddResult;
    consumeItem(player: PlayerState, slot: number): boolean;
    countInventoryItem(player: PlayerState, itemId: number): number;
    markInventoryDirty(player: PlayerState): void;

    // --- Equipment ---
    resolveEquipSlot(itemId: number): number | undefined;
    equipItem(
        player: PlayerState,
        slotIndex: number,
        itemId: number,
        equipSlot: number,
        options?: { playSound?: boolean },
    ): EquipResult;
    unequipItem(player: PlayerState, equipSlot: number): UnequipResult;
    ensureEquipArray(player: PlayerState): number[];
    refreshCombatWeaponCategory(player: PlayerState): {
        categoryChanged: boolean;
        weaponItemChanged: boolean;
    };
    refreshAppearanceKits(player: PlayerState): void;
    resetAutocast(player: PlayerState): void;
    pickEquipSound(slot: number, itemName: string): number;

    // --- Object Types ---
    getObjType(itemId: number): ObjTypeInfo | undefined;
    isConsumable(obj: ObjTypeInfo | undefined, option: string): boolean;

    // --- Pathfinding ---
    createRectAdjacentStrategy(x: number, y: number, sizeX: number, sizeY: number): RouteStrategy;
    findPathSteps(
        from: { x: number; y: number; plane: number },
        to: { x: number; y: number },
        size: number,
        strategy: RouteStrategy,
    ): PathResult;

    // --- Action Scheduling ---
    scheduleAction<K extends InventoryScheduledActionKind>(
        playerId: number,
        request: ActionScheduleRequest<K>,
        tick: number,
    ): ActionScheduleResult;

    // --- Effects ---
    queueChatMessage(request: {
        messageType: string;
        text: string;
        targetPlayerIds: number[];
    }): void;
    buildSkillFailure(player: PlayerState, message: string, reason: string): ActionExecutionResult;
    playLocSound(request: { soundId: number; tile: Vec2; level: number }): void;


    // --- Script Runtime ---
    queueLocInteraction(request: {
        tick: number;
        player: PlayerState;
        locId: number;
        tile: Vec2;
        level: number;
        action: string;
    }): boolean;
    queueItemOnLoc(request: {
        tick: number;
        player: PlayerState;
        source: { slot: number; itemId: number };
        target: { locId: number; tile: Vec2; level: number };
        option?: string;
    }): boolean;
    queueItemOnItem(request: {
        tick: number;
        player: PlayerState;
        source: { slot: number; itemId: number };
        target: { slot: number; itemId: number };
        option?: string;
    }): boolean;

    // --- Scripted Consume ---
    executeScriptedConsume(
        player: PlayerState,
        itemId: number,
        slotIndex: number,
        option?: string,
        tick?: number,
    ): { handled: boolean; effects?: ActionEffect[] };

    // --- Logging ---
    log(level: "info" | "warn" | "error", message: string, data?: unknown): void;
}

// ============================================================================
// Constants
// ============================================================================

const INVENTORY_SLOT_COUNT = 28;
const EQUIP_SLOT_COUNT = 14;

function isEquipInventoryFullReason(reason: string | undefined): boolean {
    return (
        reason === "inventory_full" ||
        reason === "inventory_full_for_shield" ||
        reason === "inventory_full_for_weapon"
    );
}

// ============================================================================
// InventoryActionHandler
// ============================================================================

/**
 * Handles inventory action execution.
 */
export class InventoryActionHandler {
    constructor(private readonly services: InventoryActionServices) {}

    // ========================================================================
    // Public Methods
    // ========================================================================

    /**
     * Execute inventory use-on action.
     */
    executeInventoryUseOnAction(
        player: PlayerState,
        data: InventoryUseOnActionData,
        tick: number,
    ): ActionExecutionResult {
        try {
            const slot = data.slot;
            const itemId = data.itemId;
            const target = data.target;
            const inv = this.services.getInventory(player);
            const entry = inv[slot];
            if (!entry || entry.itemId !== itemId || entry.quantity <= 0) {
                return { ok: false, reason: "item_mismatch" };
            }

            const handledItemOnItem = this.tryHandleScriptedItemOnItem(
                player,
                slot,
                itemId,
                target,
                inv,
                tick,
            );
            if (handledItemOnItem) {
                return handledItemOnItem;
            }
            if (target?.kind === "inv") {
                this.services.queueChatMessage({
                    messageType: "game",
                    text: "Nothing interesting happens.",
                    targetPlayerIds: [player.id],
                });
                return { ok: true, groups: ["inventory"] };
            }

            // Resolve target tile and adjacency size
            let targetX = player.tileX;
            let targetY = player.tileY;
            let sizeX = 1;
            let sizeY = 1;
            if (target?.kind === "npc" && target.id !== undefined) {
                const npc = this.services.getNpc(target.id);
                if (npc) {
                    targetX = npc.tileX;
                    targetY = npc.tileY;
                    sizeX = Math.max(1, npc.size);
                    sizeY = Math.max(1, npc.size);
                }
            } else if (target?.kind === "player" && target.id !== undefined) {
                const other = this.services.getPlayer(target.id);
                if (other) {
                    targetX = other.tileX;
                    targetY = other.tileY;
                }
            } else if (target?.kind === "loc" || target?.kind === "obj") {
                if (target.tile) {
                    targetX = target.tile.x;
                    targetY = target.tile.y;
                }
            }

            // Check arrival using adjacent rectangle strategy
            const strategy = this.services.createRectAdjacentStrategy(
                targetX,
                targetY,
                sizeX,
                sizeY,
            );
            const arrived = strategy.hasArrived(player.tileX, player.tileY, player.level);
            if (!arrived) {
                // If not moving, compute a fresh path toward the target
                const q = player.getPathQueue();
                const idle = !Array.isArray(q) || q.length === 0;
                if (idle) {
                    const from = {
                        x: player.tileX,
                        y: player.tileY,
                        plane: player.level,
                    };
                    const res = this.services.findPathSteps(
                        from,
                        { x: targetX, y: targetY },
                        1,
                        strategy,
                    );
                    if (
                        pathResultSatisfiesStrategy(from, res, strategy) &&
                        Array.isArray(res.steps) &&
                        res.steps.length > 0
                    ) {
                        const run = player.resolveRequestedRun(
                            resolveRunWithModifier(player.wantsToRun(), data?.modifierFlags),
                        );
                        player.setPath(res.steps, run);
                    } else {
                        return { ok: false, reason: "no_path" };
                    }
                }
                // Re-enqueue this action for the next tick until arrival
                try {
                    this.services.scheduleAction(
                        player.id,
                        {
                            kind: "inventory.use_on",
                            data: {
                                slot,
                                itemId,
                                target,
                                modifierFlags: data.modifierFlags,
                            },
                            groups: ["inventory"],
                            delayTicks: 1,
                        },
                        tick,
                    );
                } catch (err) {
                    logger.warn("[inventory] failed to schedule use_on action", err);
                }
                return { ok: true, groups: ["movement"] };
            }

            const handledItemOnLoc = this.tryHandleScriptedItemOnLoc(
                player,
                slot,
                itemId,
                target,
                tick,
            );
            if (handledItemOnLoc) {
                return handledItemOnLoc;
            }

            // Arrived: perform item-on-target effect (placeholder)
            this.services.queueChatMessage({
                messageType: "game",
                text: "Nothing interesting happens.",
                targetPlayerIds: [player.id],
            });
            return { ok: true, groups: ["inventory"] };
        } catch (err) {
            console.error(err);
            return { ok: false, reason: "use_on_exception" };
        }
    }

    /**
     * Execute inventory equip action.
     */
    executeInventoryEquipAction(
        player: PlayerState,
        data: InventoryEquipActionData,
    ): ActionExecutionResult {
        const desiredItemId = data.itemId;
        let slotIndex = Math.max(0, Math.min(INVENTORY_SLOT_COUNT - 1, data.slotIndex));
        let equipSlot =
            data.equipSlot !== undefined
                ? Math.max(0, Math.min(EQUIP_SLOT_COUNT - 1, data.equipSlot))
                : this.services.resolveEquipSlot(desiredItemId);
        if (equipSlot === undefined) {
            return { ok: false, reason: "item_not_equippable" };
        }
        const inv = this.services.getInventory(player);
        let slotEntry = inv[slotIndex];
        if (!slotEntry || slotEntry.quantity <= 0 || slotEntry.itemId !== desiredItemId) {
            const foundIdx = inv.findIndex(
                (entry) => entry.quantity > 0 && entry.itemId === desiredItemId,
            );
            if (foundIdx >= 0) {
                slotIndex = foundIdx;
                slotEntry = inv[slotIndex];
            }
        }
        if (!slotEntry || slotEntry.quantity <= 0 || slotEntry.itemId !== desiredItemId) {
            return { ok: false, reason: "item_missing" };
        }
        const equipResult = this.services.equipItem(
            player,
            slotIndex,
            slotEntry.itemId,
            equipSlot,
            { playSound: true },
        );
        if (!equipResult.ok) {
            if (isEquipInventoryFullReason(equipResult.reason)) {
                this.services.queueChatMessage({
                    messageType: "game",
                    text: "You don't have enough inventory space.",
                    targetPlayerIds: [player.id],
                });
            }
            return { ok: false, reason: equipResult.reason ?? "equip_failed" };
        }

        // Mark dirty flags so checkAndSendSnapshots knows to send updates
        player.markAppearanceDirty();
        if (equipResult.categoryChanged || equipResult.weaponItemChanged) {
            player.markCombatStateDirty();
        }

        const effects: ActionEffect[] = [
            { type: "inventorySnapshot", playerId: player.id },
            { type: "appearanceUpdate", playerId: player.id },
        ];
        if (equipResult.categoryChanged || equipResult.weaponItemChanged) {
            effects.push({ type: "combatState", playerId: player.id });
        }
        return {
            ok: true,
            cooldownTicks: 0,
            effects,
        };
    }

    /**
     * Execute inventory consume action.
     */
    executeInventoryConsumeAction(
        player: PlayerState,
        data: InventoryConsumeActionData,
    ): ActionExecutionResult {
        const slotIndex = Math.max(0, Math.min(INVENTORY_SLOT_COUNT - 1, data.slotIndex));
        const expectedItemId = data.itemId;
        const optionLower = data.option?.toLowerCase() ?? "";
        const inv = this.services.getInventory(player);
        const slotEntry = inv[slotIndex];
        if (!slotEntry || slotEntry.quantity <= 0 || slotEntry.itemId !== expectedItemId) {
            return { ok: false, reason: "item_missing" };
        }
        const obj = this.services.getObjType(slotEntry.itemId);
        if (!this.services.isConsumable(obj, optionLower)) {
            return { ok: false, reason: "item_not_consumable" };
        }
        const consumed = this.services.consumeItem(player, slotIndex);
        if (!consumed) {
            return { ok: false, reason: "consume_failed" };
        }
        return {
            ok: true,
            cooldownTicks: 3,
            effects: [{ type: "inventorySnapshot", playerId: player.id }],
        };
    }

    /**
     * Execute scripted consume action.
     */
    executeScriptedConsumeAction(
        player: PlayerState,
        data: InventoryConsumeScriptActionData,
        tick: number,
    ): ActionExecutionResult {
        const slotIndex = Math.max(0, Math.min(INVENTORY_SLOT_COUNT - 1, data.slotIndex));
        const expectedItemId = data.itemId;
        const option = data.option;
        const inv = this.services.getInventory(player);
        const slotEntry = inv[slotIndex];
        if (!slotEntry || slotEntry.quantity <= 0 || slotEntry.itemId !== expectedItemId) {
            return { ok: false, reason: "item_missing" };
        }
        const consumedItemId = slotEntry.itemId;

        const result = this.services.executeScriptedConsume(
            player,
            consumedItemId,
            slotIndex,
            option,
            tick,
        );

        if (result.handled) {
            return {
                ok: true,
                cooldownTicks: 3,
                effects: result.effects ?? [{ type: "inventorySnapshot", playerId: player.id }],
            };
        }

        // Fallback to regular consume
        const consumed = this.services.consumeItem(player, slotIndex);
        if (!consumed) {
            return { ok: false, reason: "consume_failed" };
        }
        return {
            ok: true,
            cooldownTicks: 3,
            effects: [{ type: "inventorySnapshot", playerId: player.id }],
        };
    }

    /**
     * Execute inventory move action.
     */
    executeInventoryMoveAction(
        player: PlayerState,
        data: InventoryMoveActionData,
    ): ActionExecutionResult {
        const from = Math.max(0, Math.min(INVENTORY_SLOT_COUNT - 1, data.from));
        const to = Math.max(0, Math.min(INVENTORY_SLOT_COUNT - 1, data.to));
        if (from === to) {
            return { ok: false, reason: "inventory_move_same_slot" };
        }
        const inv = this.services.getInventory(player);
        const src = inv[from];
        const dst = inv[to];
        if (!src || src.itemId <= 0 || src.quantity <= 0) {
            return { ok: false, reason: "inventory_move_empty_source" };
        }

        inv[from] = {
            itemId: dst ? dst.itemId : -1,
            quantity: dst ? dst.quantity : 0,
        };
        inv[to] = { itemId: src.itemId, quantity: src.quantity };
        this.services.markInventoryDirty(player);

        return {
            ok: true,
            cooldownTicks: 0,
            effects: [
                {
                    type: "inventorySnapshot",
                    playerId: player.id,
                },
            ],
        };
    }

    /**
     * Execute inventory unequip action.
     */
    executeInventoryUnequipAction(
        player: PlayerState,
        data: InventoryUnequipActionData,
    ): ActionExecutionResult {
        const slotIndex = Math.max(0, Math.min(EQUIP_SLOT_COUNT - 1, data.slot));
        const playSound = !!data.playSound;

        // Capture item info before unequip for sound
        const equip = this.services.ensureEquipArray(player);
        const itemId = equip[slotIndex];

        const res = this.services.unequipItem(player, slotIndex);
        if (!res.ok) {
            return { ok: false, reason: res.reason ?? "unequip_failed" };
        }

        // Play unequip sound
        if (playSound && itemId > 0) {
            const itemDef = this.services.getObjType(itemId);
            const itemName = (itemDef?.name as string) || "";
            const unequipSoundId = this.services.pickEquipSound(slotIndex, itemName);
            this.services.playLocSound({
                soundId: unequipSoundId,
                tile: { x: player.tileX, y: player.tileY },
                level: player.level,
            });
        }

        const { categoryChanged, weaponItemChanged } =
            this.services.refreshCombatWeaponCategory(player);
        this.services.refreshAppearanceKits(player);

        // Reset autocast when weapon is unequipped
        if (weaponItemChanged && player.autocastEnabled) {
            this.services.resetAutocast(player);
        }

        // Mark dirty flags
        player.markEquipmentDirty();
        player.markAppearanceDirty();
        if (categoryChanged || weaponItemChanged) {
            player.markCombatStateDirty();
        }

        const effects: ActionEffect[] = [
            { type: "inventorySnapshot", playerId: player.id },
            { type: "appearanceUpdate", playerId: player.id },
        ];
        if (categoryChanged || weaponItemChanged)
            effects.push({ type: "combatState", playerId: player.id });

        return {
            ok: true,
            cooldownTicks: 0,
            effects,
        };
    }

    // ========================================================================
    // Private Helper Methods
    // ========================================================================

    private tryHandleScriptedItemOnLoc(
        player: PlayerState,
        slot: number,
        itemId: number,
        target: InventoryUseOnTarget | undefined,
        tick: number,
    ): ActionExecutionResult | undefined {
        if (target?.kind !== "loc" || target.id === undefined || !target.tile) {
            return undefined;
        }

        const handled = this.services.queueItemOnLoc({
            tick,
            player,
            source: { slot, itemId },
            target: {
                locId: target.id,
                tile: target.tile,
                level: target.plane ?? player.level,
            },
        });
        if (!handled) {
            return undefined;
        }

        return { ok: true, groups: ["inventory"] };
    }

    private tryHandleScriptedItemOnItem(
        player: PlayerState,
        slot: number,
        itemId: number,
        target: InventoryUseOnTarget | undefined,
        inventory: InventoryEntry[],
        tick: number,
    ): ActionExecutionResult | undefined {
        if (target?.kind !== "inv") {
            return undefined;
        }

        const targetSlot = Math.max(0, Math.min(INVENTORY_SLOT_COUNT - 1, target.slot | 0));
        const targetEntry = inventory[targetSlot];
        if (!targetEntry || targetEntry.itemId !== target.itemId || targetEntry.quantity <= 0) {
            return { ok: false, reason: "target_item_mismatch" };
        }

        const handled = this.services.queueItemOnItem({
            tick,
            player,
            source: { slot, itemId },
            target: { slot: targetSlot, itemId: target.itemId },
        });
        if (!handled) {
            return undefined;
        }

        return { ok: true, groups: ["inventory"] };
    }
}
