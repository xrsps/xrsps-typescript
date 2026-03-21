export type OwnedItemLocation = "inventory" | "equipment" | "bank";

type InventoryLikeEntry = {
    itemId: number;
    quantity: number;
};

type BankLikeEntry = {
    itemId: number;
    quantity: number;
};

type EquipmentLikeEntry = number | { itemId: number; quantity?: number } | null | undefined;

export interface OwnedItemSourceSnapshot {
    inventory?: InventoryLikeEntry[] | undefined;
    equipment?: EquipmentLikeEntry[] | undefined;
    bank?: BankLikeEntry[] | undefined;
}

/**
 * Returns the first location where the item currently exists for duplicate-protection checks.
 * Order: inventory -> equipment -> bank.
 */
export function findOwnedItemLocation(
    itemId: number,
    snapshot: OwnedItemSourceSnapshot,
): OwnedItemLocation | undefined {
    const target = itemId;
    if (!(target > 0)) return undefined;

    if (Array.isArray(snapshot.inventory)) {
        for (const entry of snapshot.inventory) {
            if (!entry) continue;
            if (entry.itemId !== target) continue;
            if (entry.quantity <= 0) continue;
            return "inventory";
        }
    }

    if (Array.isArray(snapshot.equipment)) {
        for (const entry of snapshot.equipment) {
            if (typeof entry === "number" && Number.isFinite(entry)) {
                const equippedItemId = entry;
                if (equippedItemId === target) return "equipment";
                continue;
            }
            if (!entry || typeof entry !== "object") continue;
            if (entry.itemId !== target) continue;
            const quantity = entry.quantity ?? 1;
            if (quantity <= 0) continue;
            return "equipment";
        }
    }

    if (Array.isArray(snapshot.bank)) {
        for (const entry of snapshot.bank) {
            if (!entry) continue;
            if (entry.itemId !== target) continue;
            if (entry.quantity <= 0) continue;
            return "bank";
        }
    }

    return undefined;
}
