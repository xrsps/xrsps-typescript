import { getItemDefinition } from "../../data/items";
import { isInWilderness } from "../combat/MultiCombatZones";
import { INVENTORY_SLOT_COUNT } from "../player";
import { logger } from "../../utils/logger";

const CONSUME_VERBS = ["eat", "drink", "quaff", "sip", "imbibe", "swig", "consume", "devour", "activate"];
const ITEM_DROP_SOUND = 2739;

export interface InventoryMessageServiceDeps {
    getPlayer: (ws: any) => any | undefined;
    getInventory: (player: any) => any[];
    setInventorySlot: (player: any, slot: number, itemId: number, qty: number) => void;
    ensureEquipArray: (player: any) => number[];
    resolveEquipSlot: (itemId: number) => number | undefined;
    getObjType: (itemId: number) => any | undefined;
    requestAction: (playerId: number, request: any, tick: number) => any;
    queueItemAction: (request: any) => boolean;
    closeInterruptibleInterfaces: (player: any) => void;
    openDialog: (player: any, request: any) => void;
    openDialogOptions: (player: any, request: any) => void;
    spawnGroundItem: (itemId: number, qty: number, tile: any, tick: number, opts?: any, worldViewId?: number) => any;
    withDirectSendBypass: <T>(ctx: string, fn: () => T) => T;
    sendSound: (player: any, soundId: number) => void;
    checkAndSendSnapshots: (player: any) => void;
    queueChatMessage: (msg: any) => void;
    getPendingWalkCommands: () => Map<any, any>;
    handleGroundItemActionDelegate: (ws: any, payload: any) => void;
    getCurrentTick: () => number;
}

/**
 * Handles inventory-related client messages: use, move, use-on, ground item actions.
 * Extracted from WSServer.
 */
export class InventoryMessageService {
    constructor(private readonly deps: InventoryMessageServiceDeps) {}

    isConsumable(
        obj:
            | { inventoryActions?: Array<string | null | undefined> }
            | undefined,
        optionLower: string,
    ): boolean {
        if (optionLower && CONSUME_VERBS.includes(optionLower)) return true;
        const actions = Array.isArray(obj?.inventoryActions) ? obj.inventoryActions : [];
        for (const act of actions) {
            if (act && CONSUME_VERBS.includes(act.toLowerCase())) {
                return true;
            }
        }
        return false;
    }

    handleInventoryUseMessage(
        ws: any,
        payload: { slot: number; itemId: number; quantity?: number; option?: string; op?: number } | undefined,
    ): void {
        if (!payload) return;
        const p = this.deps.getPlayer(ws);
        if (!p) return;
        const slotIndex = Math.max(0, Math.min(INVENTORY_SLOT_COUNT - 1, payload.slot));
        const inv = this.deps.getInventory(p);
        const slotEntry = inv[slotIndex];
        let optionLower = payload.option?.toLowerCase() ?? "";
        const obj = this.deps.getObjType(payload.itemId);
        const itemDef = getItemDefinition(payload.itemId);
        const equipSlot = this.deps.resolveEquipSlot(payload.itemId);

        // Resolve option from cache inventoryActions when client sends op number but no text
        if (!optionLower && obj?.inventoryActions && typeof payload.op === "number") {
            const opIndex = (payload.op | 0) - 1;
            if (opIndex >= 0 && opIndex < obj.inventoryActions.length) {
                const resolved = obj.inventoryActions[opIndex];
                if (resolved) optionLower = resolved.toLowerCase();
            }
        }

        const nowTick = this.deps.getCurrentTick();
        // First, allow scripts to handle item actions (e.g., bury bones, herblore steps)
        if (optionLower) {
            try {
                const handled = this.deps.queueItemAction({
                    tick: nowTick,
                    player: p,
                    itemId: payload.itemId,
                    slot: slotIndex,
                    option: optionLower,
                });
                if (handled) return; // Script claimed the action
            } catch (err) { logger.warn("[item] script action dispatch failed", err); }
        }

        const hasItemInInventory =
            !!slotEntry && slotEntry.quantity > 0 && slotEntry.itemId === payload.itemId;

        if (optionLower === "drop") {
            if (!hasItemInInventory) return;
            this.deps.closeInterruptibleInterfaces(p);
            if (itemDef && !itemDef.dropable) {
                this.deps.queueChatMessage({
                    messageType: "game",
                    text: "You can't drop that.",
                    targetPlayerIds: [p.id],
                });
                return;
            }

            const doDrop = () => {
                const currentInv = this.deps.getInventory(p);
                const currentSlot = currentInv[slotIndex];
                if (
                    !currentSlot ||
                    currentSlot.quantity <= 0 ||
                    currentSlot.itemId !== payload.itemId
                ) {
                    return;
                }
                const destroyedQty = currentSlot.quantity;
                this.deps.setInventorySlot(p, slotIndex, -1, 0);
                const dropTile = { x: p.tileX, y: p.tileY, level: p.level };
                const inWilderness = isInWilderness(dropTile.x, dropTile.y);
                this.deps.spawnGroundItem(
                    payload.itemId,
                    destroyedQty,
                    dropTile,
                    this.deps.getCurrentTick(),
                    { ownerId: p.id, privateTicks: inWilderness ? 0 : undefined },
                    p.worldViewId,
                );
                this.deps.withDirectSendBypass("drop_sound", () => this.deps.sendSound(p, ITEM_DROP_SOUND));
                this.deps.checkAndSendSnapshots(p);
                try {
                    logger.debug(
                        `[inventory] dropped item player=%d slot=%d item=%d qty=%d tile=(%d,%d,%d)`,
                        p.id,
                        slotIndex,
                        payload.itemId,
                        destroyedQty,
                        dropTile.x,
                        dropTile.y,
                        dropTile.level,
                    );
                } catch (err) { logger.warn("[inventory] drop log failed", err); }
            };

            // OSRS parity: Total value = per-item value * quantity (for stackable items like coins)
            // Special case: Coins (995) have value=0 in item definitions, but each coin is worth 1 GP
            const COINS_ITEM_ID = 995;
            const perItemValue =
                payload.itemId === COINS_ITEM_ID
                    ? 1
                    : itemDef
                    ? itemDef.dropValue || itemDef.value
                    : 0;
            const totalValue = perItemValue * slotEntry.quantity;
            if (totalValue >= 30000) {
                // OSRS parity: Show sprite dialog with item first, then options dialog
                // See CS2 flow: interface 193 (sprite dialog) -> interface 219 (options dialog)
                this.deps.openDialog(p, {
                    kind: "sprite",
                    id: "confirm_drop_warning",
                    itemId: payload.itemId,
                    itemQuantity: slotEntry.quantity,
                    lines: [
                        "The item you are trying to put down is considered",
                        "<col=7f0000>valuable</col>. Are you absolutely sure you want to do that?",
                    ],
                    clickToContinue: true,
                    closeOnContinue: false,
                    onContinue: () => {
                        // After clicking continue, show the Yes/No options dialog
                        this.deps.openDialogOptions(p, {
                            id: "confirm_drop",
                            title: `Drop ${itemDef?.name ?? "item"}?`,
                            options: ["Yes", "No"],
                            onSelect: (choice: number) => {
                                if (choice === 0) doDrop();
                            },
                        });
                    },
                });
            } else {
                doDrop();
            }
            return;
        }

        if (equipSlot !== undefined) {
            const equip = this.deps.ensureEquipArray(p);
            const hasItemEquipped = equip[equipSlot] === payload.itemId;
            if (!hasItemInInventory && !hasItemEquipped) return;

            // OSRS parity: Queue equip action to be processed during tick cycle
            // Equipment changes happen in "Process queued actions" phase, tick-aligned but instant (delayTicks: 0)
            const res = this.deps.requestAction(
                p.id,
                {
                    kind: "inventory.equip",
                    data: {
                        slotIndex,
                        itemId: payload.itemId,
                        option: payload.option,
                        equipSlot,
                    },
                    delayTicks: 0,
                    groups: ["inventory"],
                    cooldownTicks: 0, // No cooldown on equipping
                },
                nowTick,
            );
            if (!res.ok) {
                logger.info(
                    `[action] equip request rejected player=${p.id} reason=${
                        res.reason ?? "unknown"
                    }`,
                );
            }
        } else if (this.isConsumable(obj, optionLower)) {
            if (!hasItemInInventory) return;
            const res = this.deps.requestAction(
                p.id,
                {
                    kind: "inventory.consume",
                    data: { slotIndex, itemId: payload.itemId, option: payload.option },
                    delayTicks: 0, // Consume happens immediately
                    groups: ["inventory"],
                    cooldownTicks: 3, // 3-tick cooldown between eating/drinking (OSRS standard)
                },
                nowTick,
            );
            if (!res.ok) {
                logger.info(
                    `[action] consume request rejected player=${p.id} reason=${
                        res.reason ?? "unknown"
                    }`,
                );
            }
        }
    }

    handleInventoryMoveMessage(
        ws: any,
        payload: { from: number; to: number } | undefined,
    ): void {
        if (!payload) return;
        const p = this.deps.getPlayer(ws);
        if (!p) return;
        const from = Math.max(0, Math.min(INVENTORY_SLOT_COUNT - 1, payload.from));
        const to = Math.max(0, Math.min(INVENTORY_SLOT_COUNT - 1, payload.to));
        if (from === to) return;
        const inv = this.deps.getInventory(p);
        const src = inv[from];
        if (!src || src.itemId <= 0 || src.quantity <= 0) return;

        const nowTick = this.deps.getCurrentTick();

        // OSRS parity: Queue move action to be processed during tick cycle
        // Ensures consistency with other inventory operations (equip/unequip)
        const res = this.deps.requestAction(
            p.id,
            {
                kind: "inventory.move",
                data: { from, to },
                delayTicks: 0,
                groups: ["inventory"],
                cooldownTicks: 0, // No cooldown on moving items
            },
            nowTick,
        );
        if (!res.ok) {
            logger.info(
                `[action] inventory move rejected player=${p.id} reason=${res.reason ?? "unknown"}`,
            );
        }
    }

    handleGroundItemAction(
        ws: any,
        payload: any | undefined,
    ): void {
        // Interface closing handled centrally by INTERFACE_CLOSING_ACTIONS check
        // Ground item interaction supersedes any pending walk command from earlier clicks.
        this.deps.getPendingWalkCommands().delete(ws);
        this.deps.handleGroundItemActionDelegate(ws, payload);
    }

    handleInventoryUseOnMessage(
        ws: any,
        payload:
            | {
                  slot: number;
                  itemId: number;
                  modifierFlags?: number;
                  target:
                      | {
                            kind: "npc";
                            id?: number;
                            tile?: { x: number; y: number };
                            plane?: number;
                        }
                      | { kind: "loc"; id: number; tile?: { x: number; y: number }; plane?: number }
                      | { kind: "obj"; id: number; tile?: { x: number; y: number }; plane?: number }
                      | {
                            kind: "player";
                            id?: number;
                            tile?: { x: number; y: number };
                            plane?: number;
                        }
                      | { kind: "inv"; slot: number; itemId: number };
              }
            | undefined,
    ): void {
        if (!payload) return;
        const p = this.deps.getPlayer(ws);
        if (!p) return;
        // Interface closing handled centrally by INTERFACE_CLOSING_ACTIONS check

        try {
            const slotIndex = Math.max(0, Math.min(INVENTORY_SLOT_COUNT - 1, payload.slot));
            const inv = this.deps.getInventory(p);
            const slot = inv[slotIndex];
            if (!slot || slot.itemId <= 0 || slot.itemId !== payload.itemId) {
                // If targeting another inventory slot, mirror client UX with a benign chat message
                const tgt: any = payload.target as any;
                if (tgt && tgt.kind === "inv") {
                    try {
                        this.deps.queueChatMessage({
                            messageType: "game",
                            text: "Nothing interesting happens.",
                            targetPlayerIds: [p.id],
                        });
                    } catch (err) { logger.warn("[item] chat message send failed", err); }
                }
                return;
            }
        } catch (err) { logger.warn("[item] use validation failed", err); }
        // Schedule server-authoritative walk-to + interaction resolution (Elvarg-style WalkToTask).
        try {
            this.deps.requestAction(
                p.id,
                {
                    kind: "inventory.use_on",
                    data: {
                        slot: payload.slot,
                        itemId: payload.itemId,
                        modifierFlags: payload.modifierFlags ?? 0,
                        target: payload.target,
                    },
                    groups: ["inventory"],
                    delayTicks: 0,
                },
                this.deps.getCurrentTick(),
            );
        } catch (err) {
            logger.warn("[inventory] failed to enqueue use_on", err);
        }
    }
}
