import type { PersistentSubState } from "../../../src/game/state/PersistentSubState";

export interface CollectionLogUnlockEntry {
    itemId: number;
    runeDay: number;
    sequence: number;
}

export interface CollectionLogSnapshot {
    items?: Array<{ itemId: number; quantity: number }>;
    itemUnlocks?: CollectionLogUnlockEntry[];
    categoryStats?: Array<{
        structId: number;
        count1: number;
        count2?: number;
        count3?: number;
    }>;
}

export class PlayerCollectionLogState
    implements PersistentSubState<CollectionLogSnapshot | undefined>
{
    private obtained: Map<number, number> = new Map();
    private categoryStats: Map<
        number,
        { count1: number; count2?: number; count3?: number }
    > = new Map();
    private dirty: boolean = false;
    private itemUnlocks: Map<number, CollectionLogUnlockEntry> = new Map();
    private unlockSequence: number = 0;

    hasItem(itemId: number): boolean {
        return (this.obtained.get(itemId) ?? 0) > 0;
    }

    getItemCount(itemId: number): number {
        return this.obtained.get(itemId) ?? 0;
    }

    addItem(itemId: number, quantity: number = 1): boolean {
        const current = this.obtained.get(itemId) ?? 0;
        const isNew = current === 0;
        this.obtained.set(itemId, current + quantity);
        this.dirty = true;
        return isNew;
    }

    getObtainedItems(): Array<{ itemId: number; quantity: number }> {
        const result: Array<{ itemId: number; quantity: number }> = [];
        for (const [itemId, quantity] of this.obtained.entries()) {
            if (quantity > 0) {
                result.push({ itemId, quantity });
            }
        }
        return result;
    }

    getTotalObtained(): number {
        let count = 0;
        for (const quantity of this.obtained.values()) {
            if (quantity > 0) count++;
        }
        return count;
    }

    getCategoryStat(
        structId: number,
    ): { count1: number; count2?: number; count3?: number } | undefined {
        return this.categoryStats.get(structId);
    }

    incrementCategoryStat(structId: number, which: 1 | 2 | 3 = 1): void {
        const stat = this.categoryStats.get(structId) ?? { count1: 0 };
        if (which === 1) stat.count1++;
        else if (which === 2) stat.count2 = (stat.count2 ?? 0) + 1;
        else if (which === 3) stat.count3 = (stat.count3 ?? 0) + 1;
        this.categoryStats.set(structId, stat);
        this.dirty = true;
    }

    getItemUnlocks(): CollectionLogUnlockEntry[] {
        return Array.from(this.itemUnlocks.values())
            .sort((left, right) => left.sequence - right.sequence)
            .map((entry) => ({ ...entry }));
    }

    recordItemUnlock(itemId: number, runeDay: number): void {
        const normalizedItemId = Math.floor(Number.isFinite(itemId) ? itemId : -1);
        const normalizedRuneDay = Math.max(0, Math.floor(Number.isFinite(runeDay) ? runeDay : 0));
        if (normalizedItemId <= 0) return;
        if (this.itemUnlocks.has(normalizedItemId)) {
            return;
        }

        this.unlockSequence++;
        this.itemUnlocks.set(normalizedItemId, {
            itemId: normalizedItemId,
            runeDay: normalizedRuneDay,
            sequence: this.unlockSequence,
        });
        this.dirty = true;
    }

    setCategoryStat(
        structId: number,
        count1: number,
        count2?: number,
        count3?: number,
    ): void {
        this.categoryStats.set(structId, { count1, count2, count3 });
        this.dirty = true;
    }

    isDirty(): boolean {
        return this.dirty;
    }

    clearDirty(): void {
        this.dirty = false;
    }

    serialize(): CollectionLogSnapshot | undefined {
        const items = this.getObtainedItems();
        const itemUnlocks = this.getItemUnlocks();
        const categoryStats: Array<{
            structId: number;
            count1: number;
            count2?: number;
            count3?: number;
        }> = [];
        for (const [structId, stat] of this.categoryStats.entries()) {
            categoryStats.push({ structId, ...stat });
        }
        if (items.length === 0 && itemUnlocks.length === 0 && categoryStats.length === 0) {
            return undefined;
        }
        return {
            items: items.length > 0 ? items : undefined,
            itemUnlocks: itemUnlocks.length > 0 ? itemUnlocks : undefined,
            categoryStats: categoryStats.length > 0 ? categoryStats : undefined,
        };
    }

    deserialize(data: CollectionLogSnapshot | undefined): void {
        this.obtained.clear();
        this.categoryStats.clear();
        this.itemUnlocks.clear();
        this.unlockSequence = 0;
        if (!data) return;

        if (Array.isArray(data.items)) {
            for (const item of data.items) {
                if (item.itemId > 0 && item.quantity > 0) {
                    this.obtained.set(item.itemId, item.quantity);
                }
            }
        }

        if (Array.isArray(data.itemUnlocks)) {
            for (const entry of data.itemUnlocks) {
                if (entry.itemId <= 0 || entry.runeDay < 0 || entry.sequence <= 0) {
                    continue;
                }
                if (!this.hasItem(entry.itemId)) {
                    continue;
                }
                const normalized = {
                    itemId: entry.itemId,
                    runeDay: Math.max(0, entry.runeDay),
                    sequence: Math.max(1, Math.floor(entry.sequence)),
                };
                const existing = this.itemUnlocks.get(normalized.itemId);
                if (!existing || normalized.sequence > existing.sequence) {
                    this.itemUnlocks.set(normalized.itemId, normalized);
                    this.unlockSequence = Math.max(
                        this.unlockSequence,
                        normalized.sequence,
                    );
                }
            }
        }

        if (Array.isArray(data.categoryStats)) {
            for (const stat of data.categoryStats) {
                this.categoryStats.set(stat.structId, {
                    count1: Math.max(0, stat.count1),
                    count2: stat.count2 !== undefined ? Math.max(0, stat.count2) : undefined,
                    count3: stat.count3 !== undefined ? Math.max(0, stat.count3) : undefined,
                });
            }
        }
        this.dirty = false;
    }
}
