import { getCombinationRuneSubstitutes, getStaffNegatedRunes } from "../data/RuneDataProvider";
import { RuneCost } from "./SpellDataProvider";

export type InventoryItem = {
    itemId: number;
    quantity: number;
};

export type RuneValidationResult = {
    canCast: boolean;
    missingRunes?: Array<{ runeId: number; need: number; have: number }>;
    runesConsumed?: Array<{ runeId: number; quantity: number }>;
};

/**
 * Validates if a player has sufficient runes to cast a spell,
 * considering staff substitutions and combination runes.
 */
export class RuneValidator {
    /**
     * Check if the player can cast a spell with their current inventory and equipment.
     * @param runeCosts - The runes required by the spell
     * @param inventory - Items in the player's inventory
     * @param equippedItems - Item IDs currently equipped
     * @returns Validation result with canCast status and consumption details
     */
    static validateAndCalculate(
        runeCosts: RuneCost[],
        inventory: InventoryItem[],
        equippedItems: number[],
    ): RuneValidationResult {
        // No runes required
        if (!runeCosts || runeCosts.length === 0) {
            return { canCast: true, runesConsumed: [] };
        }

        // Get runes negated by equipped staves/tomes
        const negatedRunes = getStaffNegatedRunes(equippedItems);

        // Build inventory map
        const inventoryMap = new Map<number, number>();
        for (const item of inventory) {
            const current = inventoryMap.get(item.itemId) ?? 0;
            inventoryMap.set(item.itemId, current + item.quantity);
        }

        // Track what we'll consume
        const toConsume: Array<{ runeId: number; quantity: number }> = [];
        const missing: Array<{ runeId: number; need: number; have: number }> = [];

        // Check each rune requirement
        for (const cost of runeCosts) {
            const runeId = cost.runeId;
            const needed = cost.quantity;

            // Check if this rune is negated by equipment
            if (negatedRunes.has(runeId)) {
                continue; // Don't need to consume this rune
            }

            // Check direct rune count
            let available = inventoryMap.get(runeId) ?? 0;

            // Check combination runes that can substitute
            const substitutes = getCombinationRuneSubstitutes(runeId);
            for (const subId of substitutes) {
                available += inventoryMap.get(subId) ?? 0;
            }

            if (available < needed) {
                missing.push({ runeId, need: needed, have: available });
                continue;
            }

            // Determine which runes to actually consume
            let remaining = needed;

            // First, try to use the direct rune
            const directCount = inventoryMap.get(runeId) ?? 0;
            if (directCount > 0) {
                const consumeDirect = Math.min(remaining, directCount);
                if (consumeDirect > 0) {
                    toConsume.push({ runeId, quantity: consumeDirect });
                    inventoryMap.set(runeId, directCount - consumeDirect);
                    remaining -= consumeDirect;
                }
            }

            // If we still need more, use combination runes
            if (remaining > 0) {
                for (const subId of substitutes) {
                    const subCount = inventoryMap.get(subId) ?? 0;
                    if (subCount > 0) {
                        const consumeSub = Math.min(remaining, subCount);
                        toConsume.push({ runeId: subId, quantity: consumeSub });
                        inventoryMap.set(subId, subCount - consumeSub);
                        remaining -= consumeSub;

                        if (remaining <= 0) break;
                    }
                }
            }
        }

        if (missing.length > 0) {
            return { canCast: false, missingRunes: missing };
        }

        return { canCast: true, runesConsumed: toConsume };
    }

    /**
     * Consume runes from the player's inventory.
     * This should only be called after validateAndCalculate confirms the player can cast.
     * @param inventory - The player's inventory (will be modified in place)
     * @param toConsume - The runes to consume (from validateAndCalculate result)
     */
    static consumeRunes(
        inventory: InventoryItem[],
        toConsume: Array<{ runeId: number; quantity: number }>,
    ): void {
        for (const { runeId, quantity } of toConsume) {
            let remaining = quantity;

            for (let i = 0; i < inventory.length && remaining > 0; i++) {
                const item = inventory[i];
                if (item.itemId === runeId) {
                    const consumeFromSlot = Math.min(remaining, item.quantity);
                    item.quantity -= consumeFromSlot;
                    remaining -= consumeFromSlot;

                    // Clear slot if empty
                    if (item.quantity <= 0) {
                        item.itemId = 0;
                        item.quantity = 0;
                    }
                }
            }
        }
    }
}
