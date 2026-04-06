import type { WebSocket } from "ws";

import { logger } from "../../utils/logger";
import { encodeMessage } from "../../network/messages";
import type { PlayerNetworkLayer } from "../../network/PlayerNetworkLayer";
import type { BroadcastScheduler } from "../systems/BroadcastScheduler";
import { getItemDefinition } from "../../data/items";
import {
    type OwnedItemLocation,
    findOwnedItemLocation as findOwnedItemLocationInSnapshot,
} from "../items/playerItemOwnership";
import type { PlayerState, InventoryEntry, InventoryAddResult } from "../player";
import type { TickFrame } from "../tick/TickPhaseOrchestrator";

export interface InventoryServiceDeps {
    getActiveFrame: () => TickFrame | undefined;
    getSocketByPlayerId: (id: number) => WebSocket | undefined;
    broadcastScheduler: BroadcastScheduler;
    networkLayer: PlayerNetworkLayer;
    getEquipArray: (player: PlayerState) => number[];
}

/**
 * Manages player inventory operations: get/set/add/consume/find/snapshot.
 * Extracted from WSServer.
 */
export class InventoryService {
    constructor(private readonly deps: InventoryServiceDeps) {}

    getInventory(p: PlayerState): InventoryEntry[] {
        return p.getInventoryEntries();
    }

    setInventorySlot(
        p: PlayerState,
        slotIndex: number,
        itemId: number,
        quantity: number,
    ): void {
        p.setInventorySlot(slotIndex, itemId, quantity);
    }

    addItemToInventory(
        p: PlayerState,
        itemId: number,
        quantity: number,
    ): InventoryAddResult {
        const result = p.items.addItem(itemId, quantity, { assureFullInsertion: true });
        if (result.completed === 0 || result.slots.length === 0) {
            return { slot: -1, added: 0 };
        }
        return { slot: result.slots[0].slot, added: result.completed };
    }

    consumeItem(p: PlayerState, slotIndex: number): boolean {
        const inv = this.getInventory(p);
        const slotEntry = inv[slotIndex];
        if (!slotEntry || slotEntry.itemId <= 0 || slotEntry.quantity <= 0) return false;
        slotEntry.quantity = Math.max(0, slotEntry.quantity - 1);
        if (slotEntry.quantity <= 0) {
            slotEntry.itemId = -1;
            slotEntry.quantity = 0;
        }
        return true;
    }

    findInventorySlotWithItem(player: PlayerState, itemId: number): number | undefined {
        if (!(itemId > 0)) return undefined;
        const inv = this.getInventory(player);
        for (let i = 0; i < inv.length; i++) {
            const entry = inv[i];
            if (!entry || entry.quantity <= 0) continue;
            if (entry.itemId === itemId) return i;
        }
        return undefined;
    }

    playerHasItem(player: PlayerState, itemId: number): boolean {
        return this.findInventorySlotWithItem(player, itemId) !== undefined;
    }

    countInventoryItem(player: PlayerState, itemId: number): number {
        const inv = this.getInventory(player);
        let total = 0;
        for (const entry of inv) {
            if (!entry || entry.quantity <= 0) continue;
            if (entry.itemId === itemId) total += entry.quantity;
        }
        return total;
    }

    collectCarriedItemIds(player: PlayerState): number[] {
        const ids: number[] = [];
        const equip = this.deps.getEquipArray(player);
        for (const itemId of equip) {
            if (itemId > 0) ids.push(itemId);
        }
        const inv = this.getInventory(player);
        for (const entry of inv) {
            if (entry.itemId > 0 && entry.quantity > 0) ids.push(entry.itemId);
        }
        return ids;
    }

    findOwnedItemLocation(
        player: PlayerState,
        itemId: number,
    ): OwnedItemLocation | undefined {
        try {
            return findOwnedItemLocationInSnapshot(itemId, {
                inventory: this.getInventory(player),
                equipment: this.deps.getEquipArray(player),
                bank: player.bank.getBankEntries(),
            });
        } catch {
            return undefined;
        }
    }

    hasInventorySlot(player: PlayerState): boolean {
        const inv = this.getInventory(player);
        return inv.some((entry) => entry.itemId <= 0 || entry.quantity <= 0);
    }

    canStoreItem(player: PlayerState, itemId: number): boolean {
        const def = getItemDefinition(itemId);
        const stackable = !!def?.stackable;
        if (!stackable) {
            return this.hasInventorySlot(player);
        }
        const slot = this.findInventorySlotWithItem(player, itemId);
        if (slot !== undefined) return true;
        return this.hasInventorySlot(player);
    }

    queueInventorySnapshot(playerId: number): void {
        const frame = this.deps.getActiveFrame();
        if (frame) {
            if (frame.inventorySnapshots.some((s: { playerId: number }) => s.playerId === playerId)) return;
            frame.inventorySnapshots.push({ playerId });
            return;
        }
        this.deps.broadcastScheduler.queueInventorySnapshot({ playerId });
    }

    sendInventorySnapshot(ws: WebSocket, p: PlayerState): void {
        const inv = this.getInventory(p);
        const slots = inv.map((entry, idx) => ({
            slot: idx,
            itemId: entry.itemId,
            quantity: entry.quantity,
        }));
        this.deps.broadcastScheduler.queueInventorySnapshot({ playerId: p.id, slots });
    }

    sendInventorySnapshotImmediate(ws: WebSocket, p: PlayerState): void {
        const inv = this.getInventory(p);
        const slots = inv.map((entry, idx) => ({
            slot: idx,
            itemId: entry.itemId,
            quantity: entry.quantity,
        }));
        this.deps.networkLayer.withDirectSendBypass("inventory_snapshot_immediate", () =>
            this.deps.networkLayer.sendWithGuard(
                ws,
                encodeMessage({
                    type: "inventory",
                    payload: { kind: "snapshot" as const, slots },
                }),
                "inventory_snapshot_immediate",
            ),
        );
    }

    snapshotInventory(player: PlayerState): void {
        try {
            const sock = this.deps.getSocketByPlayerId(player.id);
            if (sock) this.sendInventorySnapshot(sock, player);
        } catch (err) { logger.warn("[inventory] failed to snapshot inventory", err); }
    }

    snapshotInventoryImmediate(player: PlayerState): void {
        this.snapshotInventory(player);
    }

    restoreInventoryItems(
        player: PlayerState,
        itemId: number,
        removed: Map<number, number>,
    ): void {
        if (removed.size === 0) return;
        const inv = this.getInventory(player);
        for (const [slot, qty] of removed.entries()) {
            if (!(slot >= 0 && slot < inv.length)) continue;
            const current = inv[slot];
            const existingQty = current && current.itemId === itemId ? current.quantity : 0;
            this.setInventorySlot(player, slot, itemId, existingQty + qty);
        }
    }

    takeInventoryItems(
        player: PlayerState,
        requirements: Array<{ itemId: number; quantity: number }>,
    ): { ok: boolean; removed: Map<number, { itemId: number; quantity: number }> } {
        const removed = new Map<number, { itemId: number; quantity: number }>();
        for (const req of requirements) {
            const needed = Math.max(1, req.quantity);
            for (let i = 0; i < needed; i++) {
                const slot = this.findInventorySlotWithItem(player, req.itemId);
                if (slot === undefined || !this.consumeItem(player, slot)) {
                    this.restoreInventoryRemovals(player, removed);
                    return { ok: false, removed: new Map() };
                }
                const existing = removed.get(slot);
                if (existing) existing.quantity += 1;
                else removed.set(slot, { itemId: req.itemId, quantity: 1 });
            }
        }
        return { ok: true, removed };
    }

    restoreInventoryRemovals(
        player: PlayerState,
        removed: Map<number, { itemId: number; quantity: number }>,
    ): void {
        if (!removed.size) return;
        const inv = this.getInventory(player);
        for (const [slot, info] of removed.entries()) {
            if (!(slot >= 0 && slot < inv.length)) {
                this.addItemToInventory(player, info.itemId, info.quantity);
                continue;
            }
            const entry = inv[slot];
            if (!entry || entry.itemId <= 0 || entry.quantity <= 0) {
                this.setInventorySlot(player, slot, info.itemId, info.quantity);
            } else if (entry.itemId === info.itemId) {
                this.setInventorySlot(player, slot, info.itemId, entry.quantity + info.quantity);
            } else {
                this.addItemToInventory(player, info.itemId, info.quantity);
            }
        }
    }
}
