/**
 * BankingManager - Vanilla gamemode banking implementation.
 * Handles all bank deposit, withdraw, tab management, and related operations.
 */
import { EquipmentSlot } from "../../../../src/rs/config/player/Equipment";
import {
    BankLimits,
    BankMainChild,
    BankSideChild,
    BankVarbit,
    BankVarp,
    TAB_SLOT_OFFSET,
    WidgetGroup,
    slotToTabIndex,
} from "./bankConstants";
import { getItemDefinition } from "../../../src/game/scripts/types";
import { BANK_INTERFACE_ID, type BankOpenData } from "./BankInterfaceHooks";
import type { BankingProvider, BankingProviderServices, BankOperationResult, BankServerUpdate } from "./BankingProvider";
import {
    type BankEntry,
    type PlayerState,
} from "../../../src/game/player";
import { DEFAULT_BANK_CAPACITY } from "../../../src/game/state/PlayerBankSystem";

const INVENTORY_SLOT_COUNT = 28;

/**
 * BankingManager handles all banking operations for players.
 * Implements the BankingProvider interface from the core server.
 */
export class BankingManager implements BankingProvider {
    constructor(private readonly services: BankingProviderServices) {}

    private formatBankCapacityText(capacity: number): string {
        const safe = Math.max(1, Math.min(BankLimits.MAX_SLOTS, capacity));
        return String(safe).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    }

    // ========================================================================
    // Bank Data Access
    // ========================================================================

    /**
     * Get player's bank entries array.
     */
    getBank(player: PlayerState): BankEntry[] {
        return player.bank.getBankEntries();
    }

    /**
     * Normalize item ID for banking (convert noted items to base items).
     */
    normalizeBankItemId(itemId: number): number {
        const def = getItemDefinition(itemId);
        if (def?.noted) {
            const baseId = def.noteId;
            const baseDef = baseId > 0 ? getItemDefinition(baseId) : undefined;
            if (baseId > 0 && baseDef && !baseDef.noted) {
                return baseId;
            }
        }
        return itemId;
    }

    /**
     * Calculate bank tab sizes from actual bank entries.
     * Counts items AND placeholders per tab (1-9) - both occupy bank slots in OSRS.
     * Returns array of 9 sizes where index 0 = tab 1 size, etc.
     *
     * In OSRS, the tab varbits (%bank_tab_1 through %bank_tab_9) determine:
     * - Which tabs are visible (size > 0 = visible)
     * - The contiguous slot ranges for each tab
     *
     * Placeholders count toward tab size because they occupy slots. This means
     * if you withdraw all items from a tab with "Leave placeholders" on, the
     * tab remains visible until you release the placeholders.
     */
    calculateBankTabSizes(player: PlayerState): number[] {
        const bank = this.getBank(player);
        const sizes = [0, 0, 0, 0, 0, 0, 0, 0, 0]; // tabs 1-9

        for (const entry of bank) {
            // Count items AND placeholders (both occupy slots in OSRS)
            // Skip fillers and empty slots
            if (entry.itemId > 0 && !entry.filler) {
                const tab = entry.tab ?? 0;
                // Tab 0 = "all items" (not counted in varbits)
                // Tabs 1-9 are counted
                if (tab >= 1 && tab <= 9) {
                    sizes[tab - 1]++;
                }
            }
        }

        return sizes;
    }

    /**
     * Build slot mapping from reorganized (client) slots to original (server) array indices.
     *
     * The client sees items in contiguous order by tab (tabs 1-9, then tab 0).
     * The server stores items in a flat array with a `tab` property.
     * This mapping allows us to translate client slot indices to server array indices.
     *
     * Returns an array where index = client slot, value = server array index (or -1 if empty).
     */
    buildBankSlotMapping(player: PlayerState): number[] {
        const bank = this.getBank(player);
        const capacity = player.bank.getBankCapacity() || bank.length || DEFAULT_BANK_CAPACITY;

        // Collect entries with their original indices, grouped by tab
        const tabBuckets: Array<{ entry: BankEntry; originalIndex: number }[]> = [
            [],
            [],
            [],
            [],
            [],
            [],
            [],
            [],
            [],
            [],
        ];

        for (let idx = 0; idx < bank.length; idx++) {
            const entry = bank[idx];
            if (entry.itemId <= 0) continue;

            const tab = Number.isFinite(entry.tab)
                ? Math.max(0, Math.min(9, entry.tab as number))
                : 0;
            tabBuckets[tab].push({ entry, originalIndex: idx });
        }

        // Build mapping: client slot -> server index
        const mapping: number[] = [];

        // Tabs 1-9 first
        for (let tab = 1; tab <= 9; tab++) {
            for (const { originalIndex } of tabBuckets[tab]) {
                mapping.push(originalIndex);
            }
        }

        // Tab 0 (untabbed) last
        for (const { originalIndex } of tabBuckets[0]) {
            mapping.push(originalIndex);
        }

        // Fill remaining slots with -1 (empty)
        while (mapping.length < capacity) {
            mapping.push(-1);
        }

        return mapping;
    }

    /**
     * Translate a client slot index to server array index.
     * The client sees items reorganized by tab; this finds the original array position.
     *
     * Returns -1 if the slot is empty or out of bounds.
     */
    clientSlotToServerIndex(player: PlayerState, clientSlot: number): number {
        const cached = player.bank.getBankServerSlotForClientSlot(clientSlot);
        if (cached >= 0) {
            return cached;
        }
        const mapping = this.buildBankSlotMapping(player);
        if (clientSlot < 0 || clientSlot >= mapping.length) return -1;
        return mapping[clientSlot];
    }

    /**
     * Get the bank entry at a client slot index.
     * Translates the client's reorganized slot to the server's storage location.
     */
    getBankEntryAtClientSlot(player: PlayerState, clientSlot: number): BankEntry | undefined {
        const serverIndex = this.clientSlotToServerIndex(player, clientSlot);
        if (serverIndex < 0) return undefined;
        const bank = this.getBank(player);
        return bank[serverIndex];
    }

    // ========================================================================
    // Core Bank Operations
    // ========================================================================

    /**
     * Add an item to the player's bank.
     * Returns true if successful, false if bank is full.
     */
    addItemToBank(player: PlayerState, itemId: number, quantity: number, tab?: number): boolean {
        if (!(itemId > 0) || !(quantity > 0)) return false;
        const normalizedId = this.normalizeBankItemId(itemId);
        const bank = this.getBank(player);

        // Try to stack with existing item
        for (const entry of bank) {
            if (entry.itemId === normalizedId && !entry.filler) {
                entry.quantity += quantity;
                entry.placeholder = false;
                return true;
            }
        }

        // Find empty slot
        const empty = bank.find(
            (entry) =>
                entry.itemId <= 0 ||
                entry.quantity <= 0 ||
                (entry.placeholder && entry.itemId === normalizedId) ||
                entry.filler,
        );
        if (!empty) return false;

        empty.itemId = normalizedId;
        empty.quantity = quantity;
        empty.placeholder = false;
        empty.filler = false;
        const tabNormalized = Number.isFinite(tab) ? Math.max(0, tab as number) : undefined;
        if (tabNormalized !== undefined) {
            empty.tab = tabNormalized;
        } else if (Number.isFinite(empty.tab)) {
            empty.tab = Math.max(0, empty.tab as number);
        } else {
            empty.tab = 0;
        }
        return true;
    }

    /**
     * Remove items from a bank slot.
     * Returns the removed item info, or undefined if slot is empty.
     */
    removeFromBankSlot(
        player: PlayerState,
        slotIndex: number,
        quantity: number,
        placeholderMode: boolean,
    ): { itemId: number; quantity: number } | undefined {
        const bank = this.getBank(player);
        if (bank.length === 0) return undefined;
        const slot = Math.max(0, Math.min(bank.length - 1, slotIndex));
        const entry = bank[slot];
        if (!entry || entry.itemId <= 0 || entry.quantity <= 0) return undefined;

        const amount = Math.max(
            1,
            Math.min(entry.quantity, quantity > 0 ? quantity : entry.quantity),
        );
        const itemId = entry.itemId;
        entry.quantity -= amount;

        if (entry.quantity <= 0) {
            if (placeholderMode) {
                entry.quantity = 0;
                entry.placeholder = true;
                entry.filler = false;
            } else {
                entry.itemId = -1;
                entry.quantity = 0;
                entry.placeholder = false;
                entry.filler = false;
            }
        }
        return { itemId, quantity: amount };
    }

    /**
     * Restore items to a bank slot (used for rollback on failed operations).
     */
    restoreBankSlot(
        player: PlayerState,
        slotIndex: number,
        itemId: number,
        quantity: number,
    ): void {
        if (!(itemId > 0) || !(quantity > 0)) return;
        const bank = this.getBank(player);
        const slot = Math.max(0, Math.min(bank.length - 1, slotIndex));
        const entry = bank[slot];
        if (!entry) return;

        if (entry.itemId <= 0 || entry.quantity <= 0) {
            entry.itemId = itemId;
            entry.quantity = quantity;
            entry.placeholder = false;
            entry.filler = false;
            return;
        }
        if (entry.itemId === itemId) {
            entry.quantity += quantity;
            entry.placeholder = false;
            entry.filler = false;
            return;
        }
        // Slot was repurposed; fallback to stacking elsewhere
        this.addItemToBank(player, itemId, quantity);
    }

    /**
     * Move/swap bank slots.
     *
     * @param fromRaw - Client slot index to move from (reorganized by tab order)
     * @param toRaw - Client slot index to move to (reorganized by tab order)
     * @param opts - Options including insert mode and target tab
     */
    moveBankSlot(
        player: PlayerState,
        fromRaw: number,
        toRaw: number,
        opts: { insert?: boolean; tab?: number } = {},
    ): boolean {
        const bank = this.getBank(player);
        if (bank.length === 0) return false;
        if (!Number.isFinite(fromRaw) || !Number.isFinite(toRaw)) return false;

        // Translate client slots to server array indices
        const fromClient = fromRaw;
        const toClient = toRaw;
        const fromServer = this.clientSlotToServerIndex(player, fromClient);
        if (fromServer < 0) return false;

        // For 'to' slot, if it's empty in client view, find next available server slot
        let toServer = this.clientSlotToServerIndex(player, toClient);
        if (toServer < 0) {
            // Target is an empty slot - find first available empty slot in server array
            toServer = bank.findIndex((e) => e.itemId <= 0);
            if (toServer < 0) toServer = Math.min(bank.length - 1, toClient);
        }

        const from = Math.max(0, Math.min(bank.length - 1, fromServer));
        const to = Math.max(0, Math.min(bank.length - 1, toServer));
        const entry = bank[from];
        if (!entry) return false;

        const insert = opts.insert ?? player.bank.getBankInsertMode();
        const tab =
            Number.isFinite(opts.tab) && (opts.tab as number) >= 0
                ? Math.max(0, opts.tab as number)
                : entry.tab;

        if (from === to && tab === entry.tab) return true;
        if (from === to && tab !== entry.tab) {
            entry.tab = tab ?? 0;
            this.queueBankSnapshot(player);
            // Tab changed - update varbits so tabs show/hide correctly
            this.sendBankTabVarbits(player);
            return true;
        }

        const moved: BankEntry = {
            itemId: entry.itemId,
            quantity: entry.quantity,
            placeholder: !!entry.placeholder,
            tab: tab ?? entry.tab ?? 0,
        };

        if (insert && from !== to) {
            if (from < to) {
                for (let i = from; i < to; i++) {
                    bank[i] = bank[i + 1];
                }
            } else if (from > to) {
                for (let i = from; i > to; i--) {
                    bank[i] = bank[i - 1];
                }
            }
            bank[to] = moved;
        } else {
            const target = bank[to];
            bank[to] = moved;
            bank[from] = target;
            if (bank[from]) {
                bank[from].tab = bank[from].tab ?? 0;
            }
        }
        this.queueBankSnapshot(player);

        // If tab property changed, update varbits for proper tab visibility
        if (tab !== undefined && tab !== entry.tab) {
            this.sendBankTabVarbits(player);
        }

        return true;
    }

    /**
     * Resolve the item ID to use when withdrawing from bank.
     * Handles noted vs unnoted item conversion.
     */
    resolveBankWithdrawItemId(
        itemId: number,
        noted: boolean,
    ): { ok: boolean; itemId: number; message?: string } {
        const def = getItemDefinition(itemId);
        if (!def) {
            return noted
                ? { ok: false, itemId, message: "You can't withdraw that item as a note." }
                : { ok: true, itemId };
        }
        if (noted) {
            if (def.noted) {
                return { ok: true, itemId };
            }
            const noteId = def.noteId;
            const noteDef = noteId > 0 ? getItemDefinition(noteId) : undefined;
            if (noteId > 0 && noteDef?.noted) {
                return { ok: true, itemId: noteId };
            }
            return { ok: false, itemId, message: "You can't withdraw that item as a note." };
        }
        if (!def.noted) {
            return { ok: true, itemId };
        }
        const baseId = def.noteId;
        const baseDef = baseId > 0 ? getItemDefinition(baseId) : undefined;
        if (baseId > 0 && baseDef && !baseDef.noted) {
            return { ok: true, itemId: baseId };
        }
        return { ok: true, itemId };
    }

    // ========================================================================
    // Bank Snapshots
    // ========================================================================

    /**
     * Build bank payload for sending to client.
     *
     * Items must be sent in contiguous order by tab.
     * The CS2 scripts (bank_gettabrange, bank_tabforslot) determine which
     * slots belong to which tab based on cumulative varbit sizes:
     *   - Tab 1: slots 0 to (bank_tab_1 - 1)
     *   - Tab 2: slots bank_tab_1 to (bank_tab_1 + bank_tab_2 - 1)
     *   - ...
     *   - Tab 0 (untabbed): slots after all tabbed items
     *
     * We reorganize items by tab before sending so slot indices match
     * what the CS2 scripts expect.
     */
    buildBankPayload(player: PlayerState): BankServerUpdate | undefined {
        try {
            const bank = this.getBank(player);
            const capacity = player.bank.getBankCapacity() || bank.length || DEFAULT_BANK_CAPACITY;

            // Collect items by tab, preserving relative order within each tab
            // Index 0 = tab 0 (untabbed), index 1 = tab 1, etc.
            const tabBuckets: BankEntry[][] = [[], [], [], [], [], [], [], [], [], []];

            for (const entry of bank) {
                // Only include entries with actual content
                if (entry.itemId <= 0) continue;

                const tab = Number.isFinite(entry.tab)
                    ? Math.max(0, Math.min(9, entry.tab as number))
                    : 0;
                tabBuckets[tab].push(entry);
            }

            // Build slots in OSRS order: tabs 1-9 first (in order), then tab 0
            const slots: Array<{
                slot: number;
                itemId: number;
                quantity: number;
                placeholder: boolean;
                filler: boolean;
                tab: number;
            }> = [];
            let currentSlot = 0;

            // Add tabbed items first (tabs 1-9)
            for (let tab = 1; tab <= 9; tab++) {
                for (const entry of tabBuckets[tab]) {
                    slots.push(this.buildSlotEntry(entry, currentSlot, tab));
                    currentSlot++;
                }
            }

            // Add untabbed items (tab 0)
            for (const entry of tabBuckets[0]) {
                slots.push(this.buildSlotEntry(entry, currentSlot, 0));
                currentSlot++;
            }

            // Fill remaining slots as empty
            while (currentSlot < capacity) {
                slots.push({
                    slot: currentSlot,
                    itemId: -1,
                    quantity: 0,
                    placeholder: false,
                    filler: false,
                    tab: 0,
                });
                currentSlot++;
            }

            return { kind: "snapshot", capacity, slots };
        } catch (err) {
            this.services.logger.warn("[bank] failed to build snapshot", err);
            return undefined;
        }
    }

    /**
     * Build a single slot entry for the bank payload.
     * Handles placeholder and filler item ID transformations.
     */
    private buildSlotEntry(
        entry: BankEntry,
        slot: number,
        tab: number,
    ): {
        slot: number;
        itemId: number;
        quantity: number;
        placeholder: boolean;
        filler: boolean;
        tab: number;
    } {
        const rawItemId = entry.itemId;
        const placeholder = !!entry.placeholder;
        const filler = !!entry.filler;

        let itemId = rawItemId;
        let quantity = entry.quantity;

        if (placeholder && rawItemId > 0) {
            const obj = this.services.getObjType(rawItemId) as { placeholderTemplate?: number; placeholder?: number } | undefined;
            if (obj && obj.placeholderTemplate === -1 && obj.placeholder >= 0) {
                itemId = obj.placeholder;
            }
            quantity = 0;
        } else if (filler) {
            itemId = 20594; // BANK_FILLER
            quantity = 0;
        }

        return {
            slot,
            itemId,
            quantity,
            placeholder,
            filler,
            tab,
        };
    }

    /**
     * Queue bank snapshot for sending to client.
     */
    queueBankSnapshot(player: PlayerState): void {
        const payload = this.buildBankPayload(player);
        if (!payload) return;
        this.services.queueBankSnapshot(player.id, payload);
    }

    /**
     * Send bank snapshot directly to client.
     */
    sendBankSnapshot(player: PlayerState): void {
        const payload = this.buildBankPayload(player);
        if (!payload) return;
        this.services.sendBankSnapshot(player.id, payload);
    }

    // ========================================================================
    // Deposit Operations
    // ========================================================================

    /**
     * Deposit entire inventory to bank.
     */
    depositInventory(player: PlayerState, tab?: number): boolean {
        const inv = this.services.getInventory(player);
        let moved = false;
        let bankFull = false;

        for (let i = 0; i < inv.length; i++) {
            const entry = inv[i];
            if (!entry || entry.itemId <= 0 || entry.quantity <= 0) continue;
            if (!this.addItemToBank(player, entry.itemId, entry.quantity, tab)) {
                if (!moved) bankFull = true;
                break;
            }
            entry.itemId = -1;
            entry.quantity = 0;
            moved = true;
        }

        if (bankFull) {
            this.services.queueChatMessage({
                messageType: "game",
                text: "Your bank is full.",
                targetPlayerIds: [player.id],
            });
        }
        if (moved) {
            this.services.sendInventorySnapshot(player.id);
            this.queueBankSnapshot(player);
            // Update tab varbits if a specific tab was targeted (may create new tab)
            if (tab !== undefined && tab > 0) {
                this.sendBankTabVarbits(player);
            }
        }
        return moved;
    }

    /**
     * Deposit entire equipment to bank.
     */
    depositEquipment(player: PlayerState, tab?: number): boolean {
        const equip = this.services.getEquipArray(player);
        const equipQty = this.services.getEquipQtyArray(player);
        let moved = false;
        let bankFull = false;

        for (let i = 0; i < equip.length; i++) {
            const itemId = equip[i];
            if (!(itemId > 0)) continue;
            const qtyRaw = equipQty[i];
            const qty =
                i === EquipmentSlot.AMMO
                    ? Math.max(1, qtyRaw)
                    : Math.min(1, Math.max(0, qtyRaw)) || 1;
            if (!this.addItemToBank(player, itemId, qty, tab)) {
                if (!moved) bankFull = true;
                break;
            }
            equip[i] = -1;
            equipQty[i] = 0;
            moved = true;
        }

        if (bankFull) {
            this.services.queueChatMessage({
                messageType: "game",
                text: "Your bank is full.",
                targetPlayerIds: [player.id],
            });
        }
        if (moved) {
            this.services.refreshAppearance(player);
            const { categoryChanged, weaponItemChanged } =
                this.services.refreshCombatWeapon(player);
            this.queueBankSnapshot(player);
            this.services.sendAppearanceUpdate(player.id);
            if (categoryChanged || weaponItemChanged) {
                this.services.queueCombatSnapshot(
                    player.id,
                    player.combat.weaponCategory,
                    player.combat.weaponItemId,
                    !!player.combat.autoRetaliate,
                    player.combat.styleSlot,
                    Array.from(player.prayer.activePrayers ?? []),
                    player.combat.spellId > 0 ? player.combat.spellId : undefined,
                );
            }
            // Update tab varbits if a specific tab was targeted (may create new tab)
            if (tab !== undefined && tab > 0) {
                this.sendBankTabVarbits(player);
            }
        }
        return moved;
    }

    /**
     * Deposit a single item from inventory to bank.
     */
    depositItem(
        player: PlayerState,
        slotRaw: number,
        quantityRaw: number,
        itemIdHint?: number,
        tab?: number,
    ): BankOperationResult {
        if (!Number.isFinite(slotRaw) || !Number.isFinite(quantityRaw)) return { ok: false };
        const slot = Math.max(0, Math.min(INVENTORY_SLOT_COUNT - 1, slotRaw));
        const quantity = Math.max(1, quantityRaw);
        const inv = this.services.getInventory(player);
        const entry = inv[slot];

        if (!entry || entry.itemId <= 0 || entry.quantity <= 0) {
            return { ok: false, message: "You don't have any of that item to deposit." };
        }
        const hintValid = itemIdHint !== undefined && itemIdHint > 0;
        if (hintValid && entry.itemId !== itemIdHint) {
            return { ok: false, message: "That item is no longer in your inventory." };
        }

        const amount = Math.min(entry.quantity, quantity);
        const tabNormalized =
            Number.isFinite(tab) && tab! > 0 ? Math.max(0, tab as number) : undefined;
        if (!this.addItemToBank(player, entry.itemId, amount, tabNormalized)) {
            return { ok: false, message: "Your bank is full." };
        }

        entry.quantity -= amount;
        if (entry.quantity <= 0) {
            entry.itemId = -1;
            entry.quantity = 0;
        }

        this.services.sendInventorySnapshot(player.id);
        this.queueBankSnapshot(player);

        // Update tab varbits if a specific tab was targeted (may create new tab)
        if (tabNormalized !== undefined && tabNormalized > 0) {
            this.sendBankTabVarbits(player);
        }
        return { ok: true };
    }

    /**
     * Deposit item to a specific bank slot (drag and drop).
     *
     * @param bankSlot - Client slot index (reorganized by tab order)
     */
    depositToSlot(
        player: PlayerState,
        invSlot: number,
        invItemIdHint: number,
        bankSlot: number,
        _bankItemIdHint: number,
    ): void {
        const inv = this.services.getInventory(player);
        const bank = this.getBank(player);

        // Validate inventory slot
        if (invSlot < 0 || invSlot >= inv.length) return;
        const invEntry = inv[invSlot];
        if (!invEntry || invEntry.itemId <= 0 || invEntry.quantity <= 0) return;

        // Validate item hint matches
        if (invItemIdHint > 0 && invEntry.itemId !== invItemIdHint) {
            this.services.logger.debug(
                `[bank] deposit-to-slot mismatch: inv slot ${invSlot} has ${invEntry.itemId}, expected ${invItemIdHint}`,
            );
            return;
        }

        // Translate client slot to server array index
        let serverSlot = this.clientSlotToServerIndex(player, bankSlot);
        if (serverSlot < 0) {
            // Client slot is empty - find first available empty slot in server array
            serverSlot = bank.findIndex((e) => e.itemId <= 0 || e.filler);
            if (serverSlot < 0) {
                this.services.queueChatMessage({
                    messageType: "game",
                    text: "Your bank is full.",
                    targetPlayerIds: [player.id],
                });
                return;
            }
        }

        // Validate bank slot
        if (serverSlot < 0 || serverSlot >= bank.length) return;
        const bankEntry = bank[serverSlot];
        if (!bankEntry) return;

        const normalizedInvItemId = this.normalizeBankItemId(invEntry.itemId);
        const depositQuantity = invEntry.quantity;

        // Case A: Target bank slot is empty, placeholder, or filler
        if (
            bankEntry.itemId <= 0 ||
            bankEntry.quantity <= 0 ||
            bankEntry.filler ||
            (bankEntry.placeholder && bankEntry.itemId === normalizedInvItemId)
        ) {
            bankEntry.itemId = normalizedInvItemId;
            bankEntry.quantity = depositQuantity;
            bankEntry.placeholder = false;
            bankEntry.filler = false;
            if (!Number.isFinite(bankEntry.tab)) {
                bankEntry.tab = 0;
            }

            invEntry.itemId = -1;
            invEntry.quantity = 0;

            this.services.sendInventorySnapshot(player.id);
            this.queueBankSnapshot(player);
            return;
        }

        // Case B: Target bank slot has the same item - stack
        if (bankEntry.itemId === normalizedInvItemId && !bankEntry.placeholder) {
            bankEntry.quantity += depositQuantity;
            bankEntry.placeholder = false;

            invEntry.itemId = -1;
            invEntry.quantity = 0;

            this.services.sendInventorySnapshot(player.id);
            this.queueBankSnapshot(player);
            return;
        }

        // Case C: Target bank slot has different item - find same item elsewhere
        for (const entry of bank) {
            if (entry.itemId === normalizedInvItemId && !entry.filler && !entry.placeholder) {
                entry.quantity += depositQuantity;

                invEntry.itemId = -1;
                invEntry.quantity = 0;

                this.services.sendInventorySnapshot(player.id);
                this.queueBankSnapshot(player);
                return;
            }
        }

        // Item doesn't exist in bank - find placeholder or empty slot
        const targetEntry = bank.find(
            (e) =>
                e.itemId <= 0 ||
                e.quantity <= 0 ||
                (e.placeholder && e.itemId === normalizedInvItemId) ||
                e.filler,
        );

        if (targetEntry) {
            targetEntry.itemId = normalizedInvItemId;
            targetEntry.quantity = depositQuantity;
            targetEntry.placeholder = false;
            targetEntry.filler = false;
            if (!Number.isFinite(targetEntry.tab)) {
                targetEntry.tab = 0;
            }

            invEntry.itemId = -1;
            invEntry.quantity = 0;

            this.services.sendInventorySnapshot(player.id);
            this.queueBankSnapshot(player);
        } else {
            this.services.queueChatMessage({
                messageType: "game",
                text: "Your bank is full.",
                targetPlayerIds: [player.id],
            });
        }
    }

    /**
     * Deposit item to a specific bank tab.
     */
    depositToTab(player: PlayerState, invSlot: number, _invItemId: number, tabIndex: number): void {
        const inv = this.services.getInventory(player);
        const bank = this.getBank(player);

        if (invSlot < 0 || invSlot >= inv.length) return;
        const invEntry = inv[invSlot];
        if (!invEntry || invEntry.itemId <= 0) return;

        const normalizedItemId = invEntry.itemId;
        const quantity = Math.max(1, invEntry.quantity);

        // First check if item already exists in bank
        for (const entry of bank) {
            if (entry.itemId === normalizedItemId && !entry.filler && !entry.placeholder) {
                entry.quantity += quantity;
                invEntry.itemId = -1;
                invEntry.quantity = 0;
                this.services.sendInventorySnapshot(player.id);
                this.queueBankSnapshot(player);
                return;
            }
        }

        // Find empty slot and set tab
        const targetEntry = bank.find(
            (e) =>
                e.itemId <= 0 ||
                e.quantity <= 0 ||
                (e.placeholder && e.itemId === normalizedItemId) ||
                e.filler,
        );

        if (targetEntry) {
            targetEntry.itemId = normalizedItemId;
            targetEntry.quantity = quantity;
            targetEntry.placeholder = false;
            targetEntry.filler = false;
            targetEntry.tab = tabIndex;

            invEntry.itemId = -1;
            invEntry.quantity = 0;

            this.services.sendInventorySnapshot(player.id);
            this.queueBankSnapshot(player);

            this.sendBankTabVarbits(player);
        }
    }

    /**
     * Create a new bank tab with an item from inventory.
     */
    createTabWithItem(player: PlayerState, invSlot: number, invItemId: number): void {
        const newTabIndex = player.bank.createBankTab();
        if (newTabIndex === undefined || newTabIndex < 0) {
            return;
        }
        this.depositToTab(player, invSlot, invItemId, newTabIndex);
    }

    // ========================================================================
    // Withdraw Operations
    // ========================================================================

    /**
     * Withdraw item from bank to inventory.
     *
     * @param slotRaw - Client slot index (reorganized by tab order)
     * @param quantityRaw - Amount to withdraw
     * @param opts - Options including note preference
     */
    withdraw(
        player: PlayerState,
        slotRaw: number,
        quantityRaw: number,
        opts: { overrideNoted?: boolean } = {},
    ): BankOperationResult {
        if (!Number.isFinite(slotRaw) || !Number.isFinite(quantityRaw)) return { ok: false };
        const clientSlot = slotRaw;
        const quantity = Math.max(1, quantityRaw);
        const notedPref = opts.overrideNoted ?? player.bank.getBankWithdrawNotes();

        // Translate client slot to server array index
        // Client sees items reorganized by tab; server stores in flat array
        const serverSlot = this.clientSlotToServerIndex(player, clientSlot);
        if (serverSlot < 0) {
            return { ok: false, message: "You don't have enough of that item in your bank." };
        }

        const removal = this.removeFromBankSlot(
            player,
            serverSlot,
            quantity,
            player.bank.getBankPlaceholderMode(),
        );
        if (!removal) {
            return { ok: false, message: "You don't have enough of that item in your bank." };
        }

        const resolved = this.resolveBankWithdrawItemId(removal.itemId, notedPref);
        if (!resolved.ok) {
            this.restoreBankSlot(player, serverSlot, removal.itemId, removal.quantity);
            return { ok: false, message: resolved.message ?? "You can't withdraw that item." };
        }

        const result = this.services.addItemToInventory(player, resolved.itemId, removal.quantity);
        if (result.added <= 0) {
            this.restoreBankSlot(player, serverSlot, removal.itemId, removal.quantity);
            return { ok: false, message: "You don't have enough inventory space." };
        }

        this.services.sendInventorySnapshot(player.id);
        this.queueBankSnapshot(player);

        // Update tab varbits - withdrawal may affect tab sizes
        // (e.g., removing last item from a tab without placeholder mode)
        this.sendBankTabVarbits(player);

        return { ok: true };
    }

    // ========================================================================
    // Tab Management
    // ========================================================================

    /**
     * Move a bank item to a specific tab.
     * Simply updates the item's tab property - we calculate tab sizes dynamically.
     *
     * @param bankSlot - Client slot index (reorganized by tab order)
     * @param tabIndex - Target tab index (1-9, or 0 for untabbed)
     */
    moveToTab(
        player: PlayerState,
        bankSlot: number,
        tabIndex: number,
        sourceItemIdHint?: number,
    ): void {
        const bank = this.getBank(player);
        const normalizedHint =
            Number.isFinite(sourceItemIdHint) && (sourceItemIdHint as number) > 0
                ? (sourceItemIdHint as number)
                : undefined;

        // Primary: client-facing slot (tab-reordered payload slot)
        let serverSlot = this.clientSlotToServerIndex(player, bankSlot);
        let entry =
            serverSlot >= 0 && serverSlot < bank.length
                ? (bank[serverSlot] as BankEntry)
                : undefined;

        // If the mapped slot doesn't match the dragged item hint, try the raw server index.
        // Some drag paths can surface underlying slot ids depending on widget state.
        if (
            normalizedHint !== undefined &&
            (!entry || entry.itemId <= 0 || entry.itemId !== normalizedHint)
        ) {
            const directSlot = bankSlot;
            if (directSlot >= 0 && directSlot < bank.length) {
                const directEntry = bank[directSlot];
                if (
                    directEntry &&
                    directEntry.itemId > 0 &&
                    directEntry.itemId === normalizedHint
                ) {
                    serverSlot = directSlot;
                    entry = directEntry;
                }
            }
        }

        // Final fallback: only resolve by item ID when it is unambiguous.
        // Avoid moving the wrong stack when duplicates exist.
        if (
            normalizedHint !== undefined &&
            (!entry || entry.itemId <= 0 || entry.itemId !== normalizedHint)
        ) {
            const matchingSlots: number[] = [];
            for (let i = 0; i < bank.length; i++) {
                const e = bank[i];
                if (!!e && e.itemId > 0 && !e.filler && e.itemId === normalizedHint) {
                    matchingSlots.push(i);
                }
            }
            if (matchingSlots.length === 1) {
                serverSlot = matchingSlots[0];
                entry = bank[serverSlot];
            }
        }

        if (serverSlot < 0 || !entry || entry.itemId <= 0) {
            this.services.logger.info(
                `[bank-tab] moveToTab unresolved player=${
                    player.id
                } clientSlot=${bankSlot} tab=${tabIndex} hint=${normalizedHint ?? -1}`,
            );
            return;
        }

        // Skip if already in this tab
        if (entry.tab === tabIndex) {
            return;
        }

        this.services.logger.info(
            `[bank-tab] Moving clientSlot=${bankSlot} (serverSlot=${serverSlot}) from tab ${entry.tab} to tab ${tabIndex}`,
        );

        // moving an item onto a tab appends it to the end of that tab.
        // Because client ordering inside each tab is derived from server-array order,
        // we reposition the entry after the last existing entry in the target tab.
        const targetTab = tabIndex;
        let lastIndexInTargetTab = -1;
        for (let i = 0; i < bank.length; i++) {
            if (i === serverSlot) continue;
            const candidate = bank[i];
            if (
                !!candidate &&
                candidate.itemId > 0 &&
                !candidate.filler &&
                candidate.tab === targetTab
            ) {
                lastIndexInTargetTab = i;
            }
        }

        let destinationIndex = serverSlot;
        if (lastIndexInTargetTab >= 0) {
            destinationIndex =
                serverSlot <= lastIndexInTargetTab
                    ? lastIndexInTargetTab
                    : Math.min(bank.length - 1, lastIndexInTargetTab + 1);
        }

        if (destinationIndex !== serverSlot) {
            const moved: BankEntry = {
                itemId: entry.itemId,
                quantity: entry.quantity,
                placeholder: !!entry.placeholder,
                filler: !!entry.filler,
                tab: targetTab,
            };
            if (serverSlot < destinationIndex) {
                for (let i = serverSlot; i < destinationIndex; i++) {
                    bank[i] = bank[i + 1];
                }
            } else {
                for (let i = serverSlot; i > destinationIndex; i--) {
                    bank[i] = bank[i - 1];
                }
            }
            bank[destinationIndex] = moved;
        } else {
            entry.tab = targetTab;
        }

        this.queueBankSnapshot(player);
        this.sendBankTabVarbits(player);
    }

    /**
     * Create a new bank tab from an existing bank item.
     *
     * @param bankSlot - Client slot index (reorganized by tab order)
     */
    createTabFromBank(player: PlayerState, bankSlot: number, sourceItemIdHint?: number): void {
        const newTabIndex = player.bank.createBankTab();
        if (newTabIndex === undefined || newTabIndex < 0) {
            return;
        }
        this.moveToTab(player, bankSlot, newTabIndex, sourceItemIdHint);
    }

    /**
     * Send bank tab size varbits to client.
     * Calculates sizes from actual bank entries rather than stored state.
     */
    sendBankTabVarbits(player: PlayerState): void {
        // Calculate tab sizes from actual bank entries
        const tabSizes = this.calculateBankTabSizes(player);

        this.services.logger.info(`[bank-tab] Sending varbits: ${JSON.stringify(tabSizes)}`);

        for (let i = 0; i < BankLimits.MAX_TABS; i++) {
            const varbitId = BankVarbit.TAB_1 + i;
            this.services.queueVarbit(player.id, varbitId, tabSizes[i] ?? 0);
        }
    }

    // ========================================================================
    // Inventory Operations
    // ========================================================================

    /**
     * Swap two inventory slots.
     */
    swapInventorySlots(player: PlayerState, fromSlot: number, toSlot: number): void {
        const inv = this.services.getInventory(player);
        if (fromSlot < 0 || fromSlot >= inv.length) return;
        if (toSlot < 0 || toSlot >= inv.length) return;
        if (fromSlot === toSlot) return;

        const temp = inv[fromSlot];
        inv[fromSlot] = inv[toSlot];
        inv[toSlot] = temp;

        this.services.sendInventorySnapshot(player.id);
    }

    // ========================================================================
    // Widget Button Drag Handler (IF_BUTTOND)
    // ========================================================================

    /**
     * Handle IF_BUTTOND (widget drag to widget) packet.
     * Supports dragging items between inventory and bank, within bank, etc.
     */
    handleIfButtonD(
        player: PlayerState,
        payload: {
            sourceWidgetId: number;
            sourceSlot: number;
            sourceItemId: number;
            targetWidgetId: number;
            targetSlot: number;
            targetItemId: number;
        },
    ): void {
        const sourceWidgetId = payload.sourceWidgetId;
        const sourceSlot = payload.sourceSlot;
        const sourceItemId = payload.sourceItemId;
        const targetWidgetId = payload.targetWidgetId;
        const targetSlot = payload.targetSlot;
        const targetItemId = payload.targetItemId;

        const sourceGroup = (sourceWidgetId >>> 16) & 0xffff;
        const sourceChild = sourceWidgetId & 0xffff;
        const targetGroup = (targetWidgetId >>> 16) & 0xffff;
        const targetChild = targetWidgetId & 0xffff;

        // Case 1: Inventory (bankside) -> Bank main (deposit to specific slot)
        if (
            sourceGroup === WidgetGroup.BANK_SIDE &&
            sourceChild === BankSideChild.ITEMS &&
            targetGroup === WidgetGroup.BANK_MAIN &&
            targetChild === BankMainChild.ITEMS
        ) {
            this.depositToSlot(player, sourceSlot, sourceItemId, targetSlot, targetItemId);
            return;
        }

        // Case 2: Bank main -> Bank main (rearrange within bank)
        if (
            sourceGroup === WidgetGroup.BANK_MAIN &&
            sourceChild === BankMainChild.ITEMS &&
            targetGroup === WidgetGroup.BANK_MAIN &&
            targetChild === BankMainChild.ITEMS
        ) {
            const insert = player.bank.getBankInsertMode() ?? false;
            this.moveBankSlot(player, sourceSlot, targetSlot, { insert });
            return;
        }

        // Case 3: Inventory (bankside) -> Inventory (bankside) (rearrange inventory)
        if (
            sourceGroup === WidgetGroup.BANK_SIDE &&
            sourceChild === BankSideChild.ITEMS &&
            targetGroup === WidgetGroup.BANK_SIDE &&
            targetChild === BankSideChild.ITEMS
        ) {
            this.swapInventorySlots(player, sourceSlot, targetSlot);
            return;
        }

        // Case 4: Inventory (bankside) -> Bank tabs
        if (
            sourceGroup === WidgetGroup.BANK_SIDE &&
            sourceChild === BankSideChild.ITEMS &&
            targetGroup === WidgetGroup.BANK_MAIN &&
            targetChild === BankMainChild.TABS
        ) {
            const tabIndex = slotToTabIndex(targetSlot);

            if (tabIndex === 0) {
                this.depositToSlot(player, sourceSlot, sourceItemId, 0, -1);
            } else if (tabIndex >= 1 && tabIndex <= BankLimits.MAX_TABS) {
                this.depositToTab(player, sourceSlot, sourceItemId, tabIndex);
            }
            return;
        }

        // Case 5: Bank main items -> Bank tabs (move item to specific tab)
        if (
            sourceGroup === WidgetGroup.BANK_MAIN &&
            sourceChild === BankMainChild.ITEMS &&
            targetGroup === WidgetGroup.BANK_MAIN &&
            targetChild === BankMainChild.TABS
        ) {
            const tabIndex = slotToTabIndex(targetSlot);

            if (tabIndex === 0) {
                // Tab 0 = main tab (all items) - remove item from its current tab
                this.moveToTab(player, sourceSlot, 0, sourceItemId);
            } else if (tabIndex >= 1 && tabIndex <= BankLimits.MAX_TABS) {
                this.moveToTab(player, sourceSlot, tabIndex, sourceItemId);
            }
            return;
        }

        // Case 6: Fallback for inventory -> any bank main widget with tab-like slot
        if (
            sourceGroup === WidgetGroup.BANK_SIDE &&
            sourceChild === BankSideChild.ITEMS &&
            targetGroup === WidgetGroup.BANK_MAIN &&
            targetSlot >= TAB_SLOT_OFFSET &&
            targetSlot <= TAB_SLOT_OFFSET + BankLimits.MAX_TABS
        ) {
            const tabIndex = slotToTabIndex(targetSlot);

            if (tabIndex === 0) {
                this.depositToSlot(player, sourceSlot, sourceItemId, 0, -1);
            } else if (tabIndex >= 1 && tabIndex <= BankLimits.MAX_TABS) {
                this.depositToTab(player, sourceSlot, sourceItemId, tabIndex);
            }
            return;
        }

        // Case 7: Fallback for bank item -> any bank main widget with tab-like slot
        if (
            sourceGroup === WidgetGroup.BANK_MAIN &&
            sourceChild === BankMainChild.ITEMS &&
            targetGroup === WidgetGroup.BANK_MAIN &&
            targetSlot >= TAB_SLOT_OFFSET &&
            targetSlot <= TAB_SLOT_OFFSET + BankLimits.MAX_TABS
        ) {
            const tabIndex = slotToTabIndex(targetSlot);

            if (tabIndex === 0) {
                // Tab 0 = main tab (all items) - remove item from its current tab
                this.moveToTab(player, sourceSlot, 0, sourceItemId);
            } else if (tabIndex >= 1 && tabIndex <= BankLimits.MAX_TABS) {
                this.moveToTab(player, sourceSlot, tabIndex, sourceItemId);
            }
            return;
        }
    }

    // ========================================================================
    // Open Bank Interface
    // ========================================================================

    /**
     * Open the bank interface for a player.
     * Uses InterfaceService which handles all widget initialization via registered hooks.
     */
    openBank(player: PlayerState, _opts?: { mode?: "bank" | "collect" }): void {
        const interfaceService = this.services.getInterfaceService();
        if (!interfaceService) {
            this.services.logger.warn("[bank] InterfaceService not available");
            return;
        }

        try {
            // Calculate locked slots based on player's bank capacity
            const capacity = player.bank.getBankCapacity();
            const locked = Math.max(0, BankLimits.MAX_SLOTS - Math.max(1, capacity));

            // Build varps for bank interface
            const varps: Record<number, number> = {
                [BankVarp.LOCKED_SLOTS]: locked,
                // Set modal indicator varp so script 900 detects bank is open
                // This is required for the frame to be created via steelborder
                [BankVarp.MODAL_INDICATOR]: 1,
            };

            // Build varbits for bank settings
            const varbits: Record<number, number> = {
                [BankVarbit.CURRENT_TAB]: 0,
                [BankVarbit.TAB_DISPLAY]: 0,
                [BankVarbit.LEAVE_PLACEHOLDERS]: player.bank.getBankPlaceholderMode() ? 1 : 0,
                [BankVarbit.WITHDRAW_NOTES]: player.bank.getBankWithdrawNotes() ? 1 : 0,
                [BankVarbit.INSERT_MODE]: player.bank.getBankInsertMode() ? 1 : 0,
                [BankVarbit.QUANTITY_TYPE]: player.bank.getBankQuantityMode(),
                [BankVarbit.REQUESTED_QUANTITY]: Math.max(0, player.bank.getBankCustomQuantity()),
                [BankVarbit.SLOT_LOCK_IGNORE]: 1,
            };

            // Calculate actual tab sizes from bank entries
            // In OSRS, tab visibility is determined by these varbits:
            // - tab size > 0 = tab is visible
            // - tab size = 0 = tab is hidden (or shows "New tab" button for first empty)
            const tabSizes = this.calculateBankTabSizes(player);
            for (let i = 0; i < BankLimits.MAX_TABS; i++) {
                varbits[BankVarbit.TAB_1 + i] = tabSizes[i] ?? 0;
            }

            // Build bank data for hooks
            const bankData: BankOpenData = { varps, varbits };

            // Open bank modal - InterfaceService handles side panel via hooks.
            interfaceService.openModal(player, BANK_INTERFACE_ID, bankData, { varps, varbits });

            // CAPACITY (12:5) is server-authored text, not CS2-authored.
            this.services.queueWidgetEvent(player.id, {
                action: "set_text",
                uid: ((WidgetGroup.BANK_MAIN & 0xffff) << 16) | BankMainChild.CAPACITY,
                text: this.formatBankCapacityText(capacity),
            });

            // Queue snapshot through the normal tick pipeline so bank data lands
            // after interface open/flag/script events in the same frame.
            this.queueBankSnapshot(player);
        } catch (err) {
            this.services.logger.warn("[bank] failed to open bank interface", err);
        }
    }
}
