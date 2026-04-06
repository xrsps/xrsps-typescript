/**
 * Equipment charge tracking and equipped-item queries.
 * Composed into PlayerState to decouple equipment logic from the main class.
 */

import type { EquipmentSlot } from "../../../../src/rs/config/player/Equipment";
import type { PlayerAppearance } from "../player";

export class PlayerEquipmentAccessor {
    private chargeMap = new Map<number, number>();

    getCharges(itemId: number): number {
        return Math.max(0, this.chargeMap.get(itemId) ?? 0);
    }

    setCharges(itemId: number, charges: number): void {
        if (!Number.isFinite(charges) || charges <= 0) {
            this.chargeMap.delete(itemId);
        } else {
            this.chargeMap.set(itemId, charges);
        }
    }

    hasEquippedItem(appearance: PlayerAppearance, slot: EquipmentSlot, itemId: number): boolean {
        const equip = appearance.equip;
        if (!equip) return false;
        return equip[slot] === itemId;
    }

    /** Serialize charge data for persistence. */
    serializeCharges(): Array<{ itemId: number; charges: number }> | undefined {
        if (this.chargeMap.size === 0) return undefined;
        const entries: Array<{ itemId: number; charges: number }> = [];
        for (const [itemId, charges] of this.chargeMap.entries()) {
            if (charges > 0) entries.push({ itemId, charges });
        }
        return entries.length > 0 ? entries : undefined;
    }

    /** Deserialize charge data from persistence. */
    deserializeCharges(data?: Array<{ itemId: number; charges: number }>): void {
        this.chargeMap.clear();
        if (!Array.isArray(data)) return;
        for (const entry of data) {
            if (entry?.itemId > 0 && entry?.charges > 0) {
                this.chargeMap.set(entry.itemId, entry.charges);
            }
        }
    }
}
