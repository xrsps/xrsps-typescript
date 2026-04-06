/**
 * Inventory, bank, shop, and crafting UI fields for a player.
 * Composed into PlayerState to co-locate item storage data.
 *
 * Also owns item-level operations: add, remove, has, count, clear.
 */

const MAX_ITEM_STACK_QUANTITY = 2_147_483_647;
export const INVENTORY_SLOT_COUNT = 28;

export type InventoryEntry = { itemId: number; quantity: number };

/**
 * Item definition resolver for determining stackability.
 * Matches RSMod's DefinitionSet pattern.
 */
export type ItemDefResolver = (itemId: number) => { stackable: boolean } | undefined;

/**
 * Result of an inventory transaction (add/remove).
 * Matches RSMod's ItemTransaction pattern.
 */
export interface ItemTransaction {
    /** Amount requested to add/remove */
    requested: number;
    /** Amount actually added/removed */
    completed: number;
    /** Slots affected by the transaction */
    slots: Array<{ slot: number; itemId: number; quantity: number }>;
}

function createEmptyInventory(): InventoryEntry[] {
    return Array.from({ length: INVENTORY_SLOT_COUNT }, () => ({ itemId: -1, quantity: 0 }));
}

export class PlayerInventoryState {
    // Inventory (28 slots)
    inventory: Array<{ itemId: number; quantity: number }> = [];
    inventoryInitialized: boolean = false;

    // Bank
    bank: Array<{
        itemId: number;
        quantity: number;
        placeholder?: boolean;
        tab?: number;
        filler?: boolean;
    }> = [];
    bankCapacity: number = 800;
    bankWithdrawNoteMode: boolean = false;
    bankInsertMode: boolean = false;
    bankQuantityMode: number = 0;
    bankPlaceholderMode: boolean = false;
    bankCustomQuantity: number = 0;
    bankClientSlotMapping: number[] = [];

    // Shop interface
    activeShopId?: string;
    shopBuyMode: number = 0;
    shopSellMode: number = 0;

    // Smithing UI quantity
    smithingQuantityMode: number = 0;
    smithingCustomQuantity: number = 0;

    // Dirty flags
    inventoryDirty: boolean = false;
    bankDirty: boolean = false;

    // Item definition resolver for stackability lookups
    private itemDefResolver?: ItemDefResolver;

    /**
     * Set the item definition resolver for automatic stackability lookups.
     * Should be called once when the player is created/initialized.
     */
    setItemDefResolver(resolver: ItemDefResolver): void {
        this.itemDefResolver = resolver;
    }

    /**
     * Get whether an item is stackable using the item definition resolver.
     */
    private isItemStackable(itemId: number): boolean {
        if (!this.itemDefResolver) return false;
        const def = this.itemDefResolver(itemId);
        return def?.stackable ?? false;
    }

    getInventoryEntries(): InventoryEntry[] {
        if (!Array.isArray(this.inventory) || this.inventory.length !== INVENTORY_SLOT_COUNT) {
            this.inventory = createEmptyInventory();
        }
        return this.inventory;
    }

    setInventorySlot(slot: number, itemId: number, quantity: number): void {
        const inv = this.getInventoryEntries();
        if (slot < 0 || slot >= inv.length) return;
        const prevId = inv[slot].itemId;
        const prevQty = inv[slot].quantity;

        const nextId = quantity > 0 ? itemId : -1;
        const nextQty = nextId > 0 ? quantity : 0;

        if (prevId === nextId && prevQty === nextQty) return;

        inv[slot] = { itemId: nextId, quantity: nextQty };
        this.inventoryDirty = true;
    }

    markInventoryDirty(): void {
        this.inventoryDirty = true;
    }

    /**
     * Add an item to the player's inventory.
     * Matches RSMod's ItemContainer.add() pattern.
     *
     * @param itemId The item ID to add
     * @param amount The quantity to add (default 1)
     * @param options.assureFullInsertion If true, fails if not all items can be added
     * @returns Transaction result with requested, completed, and slot info
     */
    addItem(
        itemId: number,
        amount: number = 1,
        options?: { assureFullInsertion?: boolean },
    ): ItemTransaction {
        const inv = this.getInventoryEntries();
        const stackable = this.isItemStackable(itemId);
        const assureFullInsertion = options?.assureFullInsertion ?? true;

        if (amount <= 0) {
            return { requested: amount, completed: 0, slots: [] };
        }

        if (stackable) {
            // Find existing stack
            const existingSlot = inv.findIndex((e) => e.itemId === itemId && e.quantity > 0);
            if (existingSlot >= 0) {
                const currentQty = inv[existingSlot].quantity;
                // Check for overflow
                if (currentQty >= MAX_ITEM_STACK_QUANTITY - amount) {
                    if (assureFullInsertion) {
                        return { requested: amount, completed: 0, slots: [] };
                    }
                    const canAdd = MAX_ITEM_STACK_QUANTITY - currentQty;
                    if (canAdd <= 0) {
                        return { requested: amount, completed: 0, slots: [] };
                    }
                    this.setInventorySlot(existingSlot, itemId, currentQty + canAdd);
                    return {
                        requested: amount,
                        completed: canAdd,
                        slots: [{ slot: existingSlot, itemId, quantity: currentQty + canAdd }],
                    };
                }
                this.setInventorySlot(existingSlot, itemId, currentQty + amount);
                return {
                    requested: amount,
                    completed: amount,
                    slots: [{ slot: existingSlot, itemId, quantity: currentQty + amount }],
                };
            }

            // Find empty slot for new stack
            const emptySlot = inv.findIndex((e) => e.itemId <= 0 || e.quantity <= 0);
            if (emptySlot === -1) {
                return { requested: amount, completed: 0, slots: [] };
            }
            this.setInventorySlot(emptySlot, itemId, amount);
            return {
                requested: amount,
                completed: amount,
                slots: [{ slot: emptySlot, itemId, quantity: amount }],
            };
        }

        // Non-stackable: add one item per slot
        const emptySlots: number[] = [];
        for (let i = 0; i < inv.length && emptySlots.length < amount; i++) {
            if (inv[i].itemId <= 0 || inv[i].quantity <= 0) {
                emptySlots.push(i);
            }
        }

        if (emptySlots.length === 0) {
            return { requested: amount, completed: 0, slots: [] };
        }

        if (assureFullInsertion && emptySlots.length < amount) {
            return { requested: amount, completed: 0, slots: [] };
        }

        const slots: Array<{ slot: number; itemId: number; quantity: number }> = [];
        for (const slot of emptySlots) {
            this.setInventorySlot(slot, itemId, 1);
            slots.push({ slot, itemId, quantity: 1 });
        }

        return { requested: amount, completed: emptySlots.length, slots };
    }

    /**
     * Remove an item from the player's inventory.
     * Matches RSMod's ItemContainer.remove() pattern.
     *
     * @param itemId The item ID to remove
     * @param amount The quantity to remove (default 1)
     * @param options.assureFullRemoval If true, fails if not all items can be removed
     * @param options.beginSlot Start searching from this slot index
     * @returns Transaction result with requested, completed, and slot info
     */
    removeItem(
        itemId: number,
        amount: number = 1,
        options?: { assureFullRemoval?: boolean; beginSlot?: number },
    ): ItemTransaction {
        const inv = this.getInventoryEntries();
        const assureFullRemoval = options?.assureFullRemoval ?? false;
        const beginSlot = options?.beginSlot ?? 0;

        if (amount <= 0) {
            return { requested: amount, completed: 0, slots: [] };
        }

        // Count how many we have
        let hasAmount = 0;
        for (const entry of inv) {
            if (entry.itemId === itemId && entry.quantity > 0) {
                hasAmount += entry.quantity;
            }
        }

        if (assureFullRemoval && hasAmount < amount) {
            return { requested: amount, completed: 0, slots: [] };
        }

        if (hasAmount === 0) {
            return { requested: amount, completed: 0, slots: [] };
        }

        let totalRemoved = 0;
        const slots: Array<{ slot: number; itemId: number; quantity: number }> = [];

        // First pass: from beginSlot to end
        for (let i = beginSlot; i < inv.length && totalRemoved < amount; i++) {
            const entry = inv[i];
            if (entry.itemId !== itemId || entry.quantity <= 0) continue;

            const removeCount = Math.min(entry.quantity, amount - totalRemoved);
            totalRemoved += removeCount;

            const newQty = entry.quantity - removeCount;
            if (newQty <= 0) {
                this.setInventorySlot(i, -1, 0);
                slots.push({ slot: i, itemId, quantity: removeCount });
            } else {
                this.setInventorySlot(i, itemId, newQty);
                slots.push({ slot: i, itemId, quantity: removeCount });
            }
        }

        // Second pass: from 0 to beginSlot if we haven't removed enough
        if (totalRemoved < amount && beginSlot > 0) {
            for (let i = 0; i < beginSlot && totalRemoved < amount; i++) {
                const entry = inv[i];
                if (entry.itemId !== itemId || entry.quantity <= 0) continue;

                const removeCount = Math.min(entry.quantity, amount - totalRemoved);
                totalRemoved += removeCount;

                const newQty = entry.quantity - removeCount;
                if (newQty <= 0) {
                    this.setInventorySlot(i, -1, 0);
                    slots.push({ slot: i, itemId, quantity: removeCount });
                } else {
                    this.setInventorySlot(i, itemId, newQty);
                    slots.push({ slot: i, itemId, quantity: removeCount });
                }
            }
        }

        return { requested: amount, completed: totalRemoved, slots };
    }

    /**
     * Check if the player has at least `amount` of an item in inventory.
     */
    hasItem(itemId: number, amount: number = 1): boolean {
        const inv = this.getInventoryEntries();
        let count = 0;
        for (const entry of inv) {
            if (entry.itemId === itemId && entry.quantity > 0) {
                count += entry.quantity;
                if (count >= amount) return true;
            }
        }
        return false;
    }

    /**
     * Get total count of an item in inventory.
     */
    getItemCount(itemId: number): number {
        const inv = this.getInventoryEntries();
        let count = 0;
        for (const entry of inv) {
            if (entry.itemId === itemId && entry.quantity > 0) {
                count += entry.quantity;
            }
        }
        return count;
    }

    /**
     * Get the number of free inventory slots.
     */
    getFreeSlotCount(): number {
        const inv = this.getInventoryEntries();
        let count = 0;
        for (const entry of inv) {
            if (entry.itemId <= 0 || entry.quantity <= 0) {
                count++;
            }
        }
        return count;
    }

    /**
     * Check if inventory is full.
     */
    isInventoryFull(): boolean {
        return this.getFreeSlotCount() === 0;
    }

    clearInventory(): void {
        const inventory = this.getInventoryEntries();
        for (let slot = 0; slot < inventory.length; slot++) {
            const entry = inventory[slot];
            if (entry.itemId <= 0 && entry.quantity === 0) {
                continue;
            }
            this.setInventorySlot(slot, -1, 0);
        }
    }
}
