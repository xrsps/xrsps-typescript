import { ObjStackability } from "../../../../src/rs/config/objtype/ObjStackability";
import type { ObjType } from "../../../../src/rs/config/objtype/ObjType";
import { type InventoryAddResult, type PlayerState } from "../player";
import { getAllShopDefinitions, getShopDefinitionByNpcId } from "./definitions";
import { type ShopDefinition } from "./types";

type LoggerLike = {
    info?: (...args: unknown[]) => void;
    warn?: (...args: unknown[]) => void;
    error?: (...args: unknown[]) => void;
    debug?: (...args: unknown[]) => void;
};

type ShopSlotState = {
    itemId: number;
    quantity: number;
    defaultQuantity: number;
    basePrice: number;
    restockAmount: number;
    restockTicks: number;
    nextRestockTick: number;
    dynamic: boolean;
};

type ShopState = {
    id: string;
    name: string;
    currencyItemId: number;
    generalStore: boolean;
    capacity: number;
    buyPriceMultiplier: number;
    sellPriceMultiplier: number;
    restockTicks: number;
    slots: ShopSlotState[];
    watchers: Set<number>;
};

export type ShopStockEntry = {
    slot: number;
    itemId: number;
    quantity: number;
    defaultQuantity: number;
    priceEach: number;
    sellPrice?: number;
};

export type ShopSnapshot = {
    shopId: string;
    name: string;
    currencyItemId: number;
    generalStore: boolean;
    stock: ShopStockEntry[];
};

export type ShopManagerOptions = {
    coinsItemId?: number;
    logger?: LoggerLike;
    getObjType: (itemId: number) => ObjType | undefined;
    addItemToInventory: (
        player: PlayerState,
        itemId: number,
        quantity: number,
    ) => InventoryAddResult;
    snapshotInventory: (player: PlayerState) => void;
    sendGameMessage: (player: PlayerState, text: string) => void;
};

export class ShopManager {
    private readonly shops = new Map<string, ShopState>();
    private readonly npcToShop = new Map<number, ShopState>();
    private readonly playerToShop = new Map<number, ShopState>();
    private readonly options: Required<ShopManagerOptions>;

    constructor(opts: ShopManagerOptions) {
        this.options = {
            coinsItemId: opts.coinsItemId ?? 995,
            logger: opts.logger ?? {},
            getObjType: opts.getObjType,
            addItemToInventory: opts.addItemToInventory,
            snapshotInventory: opts.snapshotInventory,
            sendGameMessage: opts.sendGameMessage,
        };
        for (const def of getAllShopDefinitions()) {
            this.registerDefinition(def);
        }
    }

    openShopForNpc(player: PlayerState, npcTypeId: number): ShopSnapshot | undefined {
        const shop = this.npcToShop.get(Math.trunc(npcTypeId));
        if (!shop) return undefined;
        return this.openShop(player, shop);
    }

    openShopById(player: PlayerState, shopId: string): ShopSnapshot | undefined {
        const shop = shopId ? this.shops.get(shopId) : undefined;
        if (!shop) return undefined;
        return this.openShop(player, shop);
    }

    closeShopForPlayer(player: PlayerState): ShopState | undefined {
        const playerId = player.id;
        const existing = this.playerToShop.get(playerId);
        if (!existing) return undefined;
        existing.watchers.delete(playerId);
        this.playerToShop.delete(playerId);
        player.setActiveShopId(undefined);
        return existing;
    }

    getShopIdForPlayer(player: PlayerState): string | undefined {
        return this.playerToShop.get(player.id)?.id;
    }

    getWatchers(shopId: string): number[] {
        const shop = this.shops.get(shopId);
        if (!shop) return [];
        return Array.from(shop.watchers.values());
    }

    getShopSnapshot(shopId: string): ShopSnapshot | undefined {
        const shop = this.shops.get(shopId);
        if (!shop) return undefined;
        return this.buildSnapshot(shop);
    }

    setBuyMode(
        player: PlayerState,
        mode: number,
    ): { shopId?: string; buyMode: number } | undefined {
        const normalized = Math.max(0, Math.min(4, Math.trunc(mode)));
        player.setShopBuyMode(normalized);
        return { shopId: this.getShopIdForPlayer(player), buyMode: normalized };
    }

    setSellMode(
        player: PlayerState,
        mode: number,
    ): { shopId?: string; sellMode: number } | undefined {
        const normalized = Math.max(0, Math.min(4, Math.trunc(mode)));
        player.setShopSellMode(normalized);
        return { shopId: this.getShopIdForPlayer(player), sellMode: normalized };
    }

    getShopSlotValue(
        player: PlayerState,
        slotIndex: number,
    ): { itemId: number; itemName: string; buyPrice: number; sellPrice: number } | undefined {
        const shop = this.playerToShop.get(player.id);
        if (!shop) return undefined;
        const index = Math.max(0, Math.min(shop.slots.length - 1, Math.trunc(slotIndex)));
        const slot = shop.slots[index];
        if (!slot || slot.itemId <= 0 || slot.quantity <= 0) return undefined;
        const obj = this.options.getObjType(slot.itemId);
        const itemName = obj?.name ?? "Unknown";
        return {
            itemId: slot.itemId,
            itemName,
            buyPrice: this.getBuyPrice(shop, slot),
            sellPrice: this.getSellPrice(shop, slot),
        };
    }

    getInventoryItemSellValue(
        player: PlayerState,
        itemId: number,
    ): { itemId: number; itemName: string; sellPrice: number } | undefined {
        const shop = this.playerToShop.get(player.id);
        if (!shop) return undefined;
        const obj = this.options.getObjType(itemId);
        if (!obj) return undefined;
        const itemName = obj.name ?? "Unknown";
        const basePrice = Math.max(0, Math.trunc(obj.price));
        const sellPrice = Math.max(0, Math.floor(basePrice * shop.sellPriceMultiplier));
        return { itemId, itemName, sellPrice };
    }

    buyFromShop(
        player: PlayerState,
        slotIndex: number,
        requestedQuantity: number,
        currentTick: number,
    ): { shopId?: string; slot?: ShopStockEntry } | undefined {
        const shop = this.playerToShop.get(player.id);
        if (!shop) {
            this.options.sendGameMessage(player, "You aren't currently viewing a shop.");
            return undefined;
        }
        const index = Math.max(0, Math.min(shop.slots.length - 1, Math.trunc(slotIndex)));
        const slot = shop.slots[index];
        if (!slot || slot.itemId <= 0 || slot.quantity <= 0) {
            this.options.sendGameMessage(player, "There is nothing interesting to buy.");
            return undefined;
        }
        const desired =
            requestedQuantity > 0 ? Math.min(2147483647, Math.floor(requestedQuantity)) : 1;
        const quantity = Math.max(1, Math.min(slot.quantity, desired));
        if (!(quantity > 0)) return undefined;
        const priceEach = this.getBuyPrice(shop, slot);
        const totalCost = priceEach * quantity;
        if (!this.hasCurrency(player, shop.currencyItemId, totalCost)) {
            this.options.sendGameMessage(player, "You don't have enough coins.");
            return undefined;
        }
        if (!this.hasInventorySpaceFor(player, slot.itemId, quantity)) {
            this.options.sendGameMessage(player, "Not enough space in your inventory.");
            return undefined;
        }
        this.deductCurrency(player, shop.currencyItemId, totalCost);
        if (!this.addItemStack(player, slot.itemId, quantity)) {
            this.refundCurrency(player, shop.currencyItemId, totalCost);
            this.options.sendGameMessage(player, "You don't have enough space to carry that.");
            return undefined;
        }
        slot.quantity = Math.max(0, slot.quantity - quantity);
        if (slot.quantity === 0 && slot.defaultQuantity <= 0) {
            this.clearSlot(slot);
        }
        slot.nextRestockTick = currentTick + slot.restockTicks;
        this.options.snapshotInventory(player);
        return { shopId: shop.id, slot: this.serializeSlot(shop, index) };
    }

    sellToShop(
        player: PlayerState,
        inventorySlot: number,
        requestedQuantity: number,
        itemId: number,
        currentTick: number,
    ): { shopId?: string; slot?: ShopStockEntry } | undefined {
        const shop = this.playerToShop.get(player.id);
        if (!shop) {
            this.options.sendGameMessage(player, "You aren't currently viewing a shop.");
            return undefined;
        }
        const normalizedInventorySlot = Math.max(0, Math.min(Math.trunc(inventorySlot), 27));
        const normalizedItemId = Math.trunc(itemId);
        const invSlot = player.getInventoryEntries()[normalizedInventorySlot];
        if (!invSlot || invSlot.itemId !== normalizedItemId || invSlot.quantity <= 0) {
            this.options.sendGameMessage(player, "You don't have enough of that item.");
            return undefined;
        }
        const targetSlotIndex = this.resolveShopSlotForItem(shop, normalizedItemId);
        if (targetSlotIndex === undefined) {
            this.options.sendGameMessage(
                player,
                shop.generalStore ? "The shop is full." : "The shop won't buy that item.",
            );
            return undefined;
        }
        const targetSlot = shop.slots[targetSlotIndex];
        const obj = this.options.getObjType(normalizedItemId);
        if (!obj || obj.isTradable === false || this.isCurrencyItem(shop, normalizedItemId)) {
            this.options.sendGameMessage(player, "The shop is not interested in that item.");
            return undefined;
        }
        const isNoted = obj.noteTemplate >= 0 || obj.placeholderTemplate >= 0;
        if (isNoted) {
            this.options.sendGameMessage(player, "You can't sell noted items.");
            return undefined;
        }
        const desired =
            requestedQuantity > 0 ? Math.min(2147483647, Math.floor(requestedQuantity)) : 1;
        const quantity = Math.max(1, Math.min(invSlot.quantity, desired));
        if (!(quantity > 0)) return undefined;
        invSlot.quantity -= quantity;
        if (invSlot.quantity <= 0) {
            invSlot.itemId = -1;
            invSlot.quantity = 0;
        }
        if (targetSlot.itemId <= 0) {
            this.fillSlotFromSale(targetSlot, normalizedItemId, quantity, shop, currentTick);
        } else {
            targetSlot.quantity += quantity;
            targetSlot.nextRestockTick = currentTick + targetSlot.restockTicks;
        }
        const sellPrice = this.getSellPrice(shop, targetSlot);
        const totalValue = sellPrice * quantity;
        if (!this.addCurrency(player, shop.currencyItemId, totalValue)) {
            // Refund items if currency couldn't be added (should not happen with space checks)
            invSlot.itemId = normalizedItemId;
            invSlot.quantity += quantity;
            targetSlot.quantity = Math.max(0, targetSlot.quantity - quantity);
            if (targetSlot.quantity <= 0 && targetSlot.defaultQuantity <= 0) {
                this.clearSlot(targetSlot);
            }
            this.options.sendGameMessage(player, "You don't have space for the coins.");
            return undefined;
        }
        this.options.snapshotInventory(player);
        return { shopId: shop.id, slot: this.serializeSlot(shop, targetSlotIndex) };
    }

    tick(currentTick: number): Array<{ shopId: string; slot: ShopStockEntry }> {
        const updates: Array<{ shopId: string; slot: ShopStockEntry }> = [];
        for (const shop of this.shops.values()) {
            for (let i = 0; i < shop.slots.length; i++) {
                const slot = shop.slots[i];
                if (slot.itemId <= 0 || !(slot.restockTicks > 0)) continue;
                if (currentTick < slot.nextRestockTick) continue;
                slot.nextRestockTick = currentTick + slot.restockTicks;
                if (slot.quantity < slot.defaultQuantity) {
                    slot.quantity = Math.min(
                        slot.defaultQuantity,
                        slot.quantity + slot.restockAmount,
                    );
                    updates.push({ shopId: shop.id, slot: this.serializeSlot(shop, i) });
                } else if (slot.quantity > slot.defaultQuantity) {
                    slot.quantity = Math.max(
                        slot.defaultQuantity,
                        slot.quantity - slot.restockAmount,
                    );
                    if (slot.quantity <= 0 && slot.defaultQuantity <= 0) {
                        this.clearSlot(slot);
                    }
                    updates.push({ shopId: shop.id, slot: this.serializeSlot(shop, i) });
                }
            }
        }
        return updates;
    }

    private openShop(player: PlayerState, shop: ShopState): ShopSnapshot {
        this.closeShopForPlayer(player);
        shop.watchers.add(player.id);
        this.playerToShop.set(player.id, shop);
        player.setActiveShopId(shop.id);
        return this.buildSnapshot(shop);
    }

    private registerDefinition(def: ShopDefinition): void {
        const capacity = Math.max(1, Math.min(60, def.capacity ?? 40));
        const shop: ShopState = {
            id: def.id,
            name: def.name,
            currencyItemId: def.currencyItemId ?? this.options.coinsItemId,
            generalStore: !!def.generalStore,
            capacity,
            buyPriceMultiplier: def.buyPriceMultiplier ?? 1,
            sellPriceMultiplier: def.sellPriceMultiplier ?? (def.generalStore ? 0.4 : 0.45),
            restockTicks: Math.max(1, def.restockTicks ?? 40),
            slots: Array.from({ length: capacity }, () => this.createEmptySlot()),
            watchers: new Set(),
        };
        for (let i = 0; i < def.stock.length && i < capacity; i++) {
            this.populateSlot(shop.slots[i], def.stock[i], shop);
        }
        this.shops.set(shop.id, shop);
        for (const npcId of def.npcIds || []) {
            this.npcToShop.set(Math.trunc(npcId), shop);
        }
    }

    private createEmptySlot(): ShopSlotState {
        return {
            itemId: -1,
            quantity: 0,
            defaultQuantity: 0,
            basePrice: 0,
            restockAmount: 1,
            restockTicks: 40,
            nextRestockTick: 0,
            dynamic: false,
        };
    }

    private populateSlot(
        slot: ShopSlotState,
        entry: ShopDefinition["stock"][number],
        shop: ShopState,
    ) {
        slot.itemId = Math.trunc(entry.itemId);
        slot.quantity = Math.max(0, Math.trunc(entry.quantity));
        slot.defaultQuantity = Math.max(0, Math.trunc(entry.quantity));
        slot.basePrice = Math.max(0, entry.price ?? this.getBasePrice(slot.itemId));
        slot.restockAmount = Math.max(1, entry.restockAmount ?? 1);
        slot.restockTicks = Math.max(1, entry.restockTicks ?? shop.restockTicks);
        slot.nextRestockTick = slot.restockTicks;
        slot.dynamic = false;
    }

    private buildSnapshot(shop: ShopState): ShopSnapshot {
        const stock: ShopStockEntry[] = [];
        for (let idx = 0; idx < shop.slots.length; idx++) {
            const slot = shop.slots[idx];
            if (slot && slot.itemId > 0 && slot.quantity > 0) {
                stock.push(this.serializeSlot(shop, idx));
            }
        }
        return {
            shopId: shop.id,
            name: shop.name,
            currencyItemId: shop.currencyItemId,
            generalStore: shop.generalStore,
            stock,
        };
    }

    private serializeSlot(shop: ShopState, slotIndex: number): ShopStockEntry {
        const slot = shop.slots[slotIndex];
        if (!slot)
            return {
                slot: slotIndex,
                itemId: -1,
                quantity: 0,
                defaultQuantity: 0,
                priceEach: 0,
                sellPrice: 0,
            };
        if (slot.itemId <= 0 || slot.quantity <= 0) {
            return {
                slot: slotIndex,
                itemId: -1,
                quantity: 0,
                defaultQuantity: slot.defaultQuantity,
                priceEach: 0,
                sellPrice: 0,
            };
        }
        return {
            slot: slotIndex,
            itemId: slot.itemId,
            quantity: slot.quantity,
            defaultQuantity: slot.defaultQuantity,
            priceEach: this.getBuyPrice(shop, slot),
            sellPrice: this.getSellPrice(shop, slot),
        };
    }

    private getBuyPrice(shop: ShopState, slot: ShopSlotState): number {
        return Math.max(0, Math.floor(slot.basePrice * shop.buyPriceMultiplier));
    }

    private getSellPrice(shop: ShopState, slot: ShopSlotState): number {
        return Math.max(0, Math.floor(slot.basePrice * shop.sellPriceMultiplier));
    }

    private getBasePrice(itemId: number): number {
        const obj = this.options.getObjType(itemId);
        if (!obj) return 0;
        return Math.max(0, Math.trunc(obj.price));
    }

    private hasCurrency(player: PlayerState, currencyItemId: number, amount: number): boolean {
        if (!(amount > 0)) return true;
        const normalizedCurrencyItemId = Math.trunc(currencyItemId);
        let total = 0;
        for (const entry of player.getInventoryEntries()) {
            if (entry.itemId === normalizedCurrencyItemId) {
                total += entry.quantity;
                if (total >= amount) return true;
            }
        }
        return total >= amount;
    }

    private deductCurrency(player: PlayerState, currencyItemId: number, amount: number): void {
        const normalizedCurrencyItemId = Math.trunc(currencyItemId);
        let remaining = Math.max(0, Math.trunc(amount));
        const inv = player.getInventoryEntries();
        for (const entry of inv) {
            if (remaining <= 0) break;
            if (entry.itemId !== normalizedCurrencyItemId || entry.quantity <= 0) continue;
            const take = Math.min(entry.quantity, remaining);
            entry.quantity -= take;
            remaining -= take;
            if (entry.quantity <= 0) {
                entry.itemId = -1;
                entry.quantity = 0;
            }
        }
    }

    private refundCurrency(player: PlayerState, currencyItemId: number, amount: number): void {
        if (!(amount > 0)) return;
        this.addCurrency(player, currencyItemId, amount);
    }

    private addCurrency(player: PlayerState, currencyItemId: number, amount: number): boolean {
        if (!(amount > 0)) return true;
        const result = this.options.addItemToInventory(player, currencyItemId, amount);
        return result.added > 0;
    }

    private hasInventorySpaceFor(player: PlayerState, itemId: number, quantity: number): boolean {
        const inv = player.getInventoryEntries();
        const obj = this.options.getObjType(itemId);
        const stackable = obj?.stackability === ObjStackability.ALWAYS;
        if (stackable) {
            const existing = inv.find((entry) => entry.itemId === itemId && entry.quantity > 0);
            if (existing) return true;
            return inv.some((entry) => entry.itemId <= 0 || entry.quantity <= 0);
        }
        let empty = 0;
        for (const entry of inv) {
            if (entry.itemId <= 0 || entry.quantity <= 0) empty++;
            if (empty >= quantity) return true;
        }
        return empty >= quantity;
    }

    private addItemStack(player: PlayerState, itemId: number, quantity: number): boolean {
        const obj = this.options.getObjType(itemId);
        const stackable = obj?.stackability === ObjStackability.ALWAYS;
        if (stackable) {
            return this.options.addItemToInventory(player, itemId, quantity).added > 0;
        }
        for (let i = 0; i < quantity; i++) {
            const result = this.options.addItemToInventory(player, itemId, 1);
            if (result.added <= 0) {
                return false;
            }
        }
        return true;
    }

    private resolveShopSlotForItem(shop: ShopState, itemId: number): number | undefined {
        const normalizedItemId = Math.trunc(itemId);
        const baseSlot = shop.slots.findIndex(
            (slot) => slot.itemId === normalizedItemId && slot.defaultQuantity > 0,
        );
        if (baseSlot >= 0) return baseSlot;
        if (!shop.generalStore) {
            const existingDynamic = shop.slots.findIndex(
                (slot) => slot.itemId === normalizedItemId && slot.defaultQuantity === 0,
            );
            return existingDynamic >= 0 ? existingDynamic : undefined;
        }
        const dynamicSlot = shop.slots.findIndex(
            (slot) => slot.itemId === normalizedItemId && slot.defaultQuantity === 0,
        );
        if (dynamicSlot >= 0) return dynamicSlot;
        const empty = shop.slots.findIndex((slot) => slot.itemId <= 0);
        return empty >= 0 ? empty : undefined;
    }

    private fillSlotFromSale(
        slot: ShopSlotState,
        itemId: number,
        quantity: number,
        shop: ShopState,
        currentTick: number,
    ): void {
        const normalizedItemId = Math.trunc(itemId);
        const normalizedQuantity = Math.max(0, Math.trunc(quantity));
        slot.itemId = normalizedItemId;
        slot.quantity = normalizedQuantity;
        slot.defaultQuantity = shop.generalStore ? 0 : normalizedQuantity;
        slot.basePrice = this.getBasePrice(itemId);
        slot.restockAmount = 1;
        slot.restockTicks = shop.restockTicks;
        slot.nextRestockTick = currentTick + slot.restockTicks;
        slot.dynamic = shop.generalStore;
    }

    private clearSlot(slot: ShopSlotState): void {
        slot.itemId = -1;
        slot.quantity = 0;
        slot.defaultQuantity = 0;
        slot.basePrice = 0;
        slot.dynamic = false;
        slot.restockAmount = 1;
    }

    private isCurrencyItem(shop: ShopState, itemId: number): boolean {
        return shop.currencyItemId === Math.trunc(itemId);
    }
}
