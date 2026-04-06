import type { PlayerInventoryState } from "./PlayerInventoryState";
import type { BankEntry, BankSnapshotEntry } from "../player";

export const DEFAULT_BANK_CAPACITY = 800;

function createEmptyBank(capacity: number): BankEntry[] {
    return Array.from({ length: capacity }, () => ({
        itemId: -1,
        quantity: 0,
        placeholder: false,
        tab: 0,
    }));
}

export class PlayerBankSystem {
    constructor(private readonly items: PlayerInventoryState) {}

    getBankCapacity(): number {
        return Math.max(1, this.items.bankCapacity);
    }

    setBankCapacity(capacity: number): void {
        const normalized = Math.max(1, Math.min(1410, Math.floor(capacity)));
        if (normalized === this.items.bankCapacity && this.items.bank.length === normalized) {
            return;
        }
        const next = createEmptyBank(normalized);
        const current = Array.isArray(this.items.bank) ? this.items.bank : [];
        for (let i = 0; i < Math.min(current.length, normalized); i++) {
            const entry = current[i];
            next[i] = {
                itemId: entry?.itemId ?? -1,
                quantity: entry?.quantity ?? 0,
            };
        }
        this.items.bankCapacity = normalized;
        this.items.bank = next;
        this.items.bankClientSlotMapping = [];
    }

    private ensureBankInitialized(): BankEntry[] {
        const capacity = this.getBankCapacity();
        if (!Array.isArray(this.items.bank) || this.items.bank.length !== capacity) {
            this.items.bank = createEmptyBank(capacity);
        }
        return this.items.bank;
    }

    getBankEntries(): BankEntry[] {
        return this.ensureBankInitialized();
    }

    setBankClientSlotMapping(mapping: number[]): void {
        if (!Array.isArray(mapping)) {
            this.items.bankClientSlotMapping = [];
            return;
        }
        this.items.bankClientSlotMapping = mapping.map((slot) =>
            Number.isFinite(slot) ? (slot as number) : -1,
        );
    }

    getBankServerSlotForClientSlot(clientSlot: number): number {
        if (!Number.isFinite(clientSlot)) return -1;
        const slot = clientSlot;
        if (slot < 0 || slot >= this.items.bankClientSlotMapping.length) return -1;
        const mapped = this.items.bankClientSlotMapping[slot] ?? -1;
        return Number.isFinite(mapped) ? mapped : -1;
    }

    loadBankSnapshot(entries?: Iterable<BankSnapshotEntry>, capacityOverride?: number): void {
        if (Number.isFinite(capacityOverride) && (capacityOverride as number) > 0) {
            this.setBankCapacity(capacityOverride as number);
        } else {
            this.ensureBankInitialized();
        }
        const bank = this.getBankEntries();
        for (const slot of bank) {
            slot.itemId = -1;
            slot.quantity = 0;
        }
        if (!entries) return;
        for (const entry of entries) {
            const slot = Math.max(0, Math.min(bank.length - 1, entry.slot));
            const itemId = entry.itemId;
            const quantity = Math.max(0, entry.quantity);
            const placeholder = !!entry.placeholder;
            const filler = !!entry.filler;
            const tab = Math.max(0, entry.tab ?? 0);
            const hasItem = itemId > 0 && quantity > 0;
            bank[slot].itemId = hasItem ? itemId : placeholder || filler ? itemId : -1;
            bank[slot].quantity = hasItem ? quantity : 0;
            bank[slot].placeholder = placeholder && itemId > 0;
            bank[slot].filler = filler && itemId > 0;
            bank[slot].tab = tab;
        }
        this.items.bankClientSlotMapping = [];
    }

    exportBankSnapshot(): BankSnapshotEntry[] {
        const snapshot: BankSnapshotEntry[] = [];
        const bank = this.getBankEntries();
        for (let i = 0; i < bank.length; i++) {
            const entry = bank[i];
            if (!entry) continue;
            if (entry.itemId > 0 && (entry.quantity > 0 || entry.placeholder || entry.filler)) {
                snapshot.push({
                    slot: i,
                    itemId: entry.itemId,
                    quantity: Math.max(0, entry.quantity),
                    placeholder: !!entry.placeholder,
                    filler: !!entry.filler,
                    tab: Math.max(0, entry.tab ?? 0),
                });
            }
        }
        return snapshot;
    }

    clearBank(): void {
        this.items.bank = createEmptyBank(this.getBankCapacity());
        this.items.bankClientSlotMapping = [];
    }

    getBankWithdrawNotes(): boolean {
        return !!this.items.bankWithdrawNoteMode;
    }

    setBankWithdrawNotes(enabled: boolean): void {
        this.items.bankWithdrawNoteMode = !!enabled;
    }

    getBankInsertMode(): boolean {
        return !!this.items.bankInsertMode;
    }

    setBankInsertMode(insert: boolean): void {
        this.items.bankInsertMode = !!insert;
    }

    getBankPlaceholderMode(): boolean {
        return !!this.items.bankPlaceholderMode;
    }

    setBankPlaceholderMode(enabled: boolean): void {
        this.items.bankPlaceholderMode = !!enabled;
    }

    releaseBankPlaceholders(): number {
        let cleared = 0;
        const bank = this.ensureBankInitialized();
        for (const entry of bank) {
            if (entry && entry.placeholder && entry.quantity === 0) {
                entry.itemId = -1;
                entry.quantity = 0;
                entry.placeholder = false;
                cleared++;
            }
        }
        if (cleared > 0) this.items.bankDirty = true;
        return cleared;
    }

    getBankQuantityMode(): number {
        return this.items.bankQuantityMode;
    }

    setBankQuantityMode(mode: number): void {
        if (!Number.isFinite(mode)) return;
        this.items.bankQuantityMode = Math.max(0, Math.min(5, mode));
    }

    getBankCustomQuantity(): number {
        return Math.max(0, this.items.bankCustomQuantity);
    }

    setBankCustomQuantity(amount: number): void {
        if (!Number.isFinite(amount)) {
            this.items.bankCustomQuantity = 0;
            return;
        }
        this.items.bankCustomQuantity = Math.max(0, Math.min(2147483647, amount));
    }

    getBankTabCount(): number {
        const bank = this.getBankEntries();
        let maxTab = 0;
        for (const entry of bank) {
            if (entry.itemId > 0 && !entry.filler) {
                const tab = entry.tab ?? 0;
                if (tab >= 1 && tab <= 9 && tab > maxTab) {
                    maxTab = tab;
                }
            }
        }
        return maxTab + 1;
    }

    getFirstAvailableSlotInTab(tab: number): number {
        const bank = this.getBankEntries();
        let tabStart = -1;
        let tabEnd = -1;

        for (let i = 0; i < bank.length; i++) {
            const entry = bank[i];
            if (entry.itemId > 0 && entry.tab === tab) {
                if (tabStart === -1) tabStart = i;
                tabEnd = i;
            }
        }

        if (tab === 0) {
            for (let i = 0; i < bank.length; i++) {
                if (bank[i].itemId <= 0 && !bank[i].placeholder) {
                    return i;
                }
            }
        } else {
            if (tabEnd >= 0 && tabEnd + 1 < bank.length) {
                return tabEnd + 1;
            }
        }

        return -1;
    }

    createBankTab(): number {
        const currentTabs = this.getBankTabCount();
        if (currentTabs >= 10) {
            return -1;
        }
        return currentTabs;
    }

    getBankTabSize(tabIndex: number): number {
        if (tabIndex < 1 || tabIndex > 9) return 0;
        const bank = this.getBankEntries();
        let count = 0;
        for (const entry of bank) {
            if (entry.itemId > 0 && !entry.filler && entry.tab === tabIndex) {
                count++;
            }
        }
        return count;
    }

    getBankTabSizes(): number[] {
        const bank = this.getBankEntries();
        const sizes = [0, 0, 0, 0, 0, 0, 0, 0, 0];
        for (const entry of bank) {
            if (entry.itemId > 0 && !entry.filler) {
                const tab = entry.tab ?? 0;
                if (tab >= 1 && tab <= 9) {
                    sizes[tab - 1]++;
                }
            }
        }
        return sizes;
    }

    getBankTabStartSlot(tabIndex: number): number {
        if (tabIndex <= 1) return 0;
        const sizes = this.getBankTabSizes();
        let startSlot = 0;
        for (let t = 1; t < tabIndex && t <= 9; t++) {
            startSlot += sizes[t - 1] ?? 0;
        }
        return startSlot;
    }

    // Shop mode accessors

    getActiveShopId(): string | undefined {
        return this.items.activeShopId;
    }

    setActiveShopId(id: string | undefined): void {
        this.items.activeShopId = id ? String(id) : undefined;
    }

    getShopBuyMode(): number {
        return this.items.shopBuyMode;
    }

    setShopBuyMode(mode: number): void {
        if (!Number.isFinite(mode)) return;
        this.items.shopBuyMode = Math.max(0, Math.min(4, mode));
    }

    getShopSellMode(): number {
        return this.items.shopSellMode;
    }

    setShopSellMode(mode: number): void {
        if (!Number.isFinite(mode)) return;
        this.items.shopSellMode = Math.max(0, Math.min(4, mode));
    }

    getSmithingQuantityMode(): number {
        return this.items.smithingQuantityMode;
    }

    setSmithingQuantityMode(mode: number): void {
        if (!Number.isFinite(mode)) return;
        this.items.smithingQuantityMode = Math.max(0, Math.min(4, mode));
    }

    getSmithingCustomQuantity(): number {
        return Math.max(0, this.items.smithingCustomQuantity);
    }

    setSmithingCustomQuantity(amount: number): void {
        if (!Number.isFinite(amount)) {
            this.items.smithingCustomQuantity = 0;
            return;
        }
        this.items.smithingCustomQuantity = Math.max(0, Math.min(2147483647, amount));
    }
}
