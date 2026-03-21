import type { ObjType } from "../../../../src/rs/config/objtype/ObjType";
import { EquipmentSlot } from "../../../../src/rs/config/player/Equipment";
import {
    ensureEquipArrayOn,
    ensureEquipQtyArrayOn,
    equipItemApply,
    inferEquipSlot,
    pickEquipSound,
    unequipItemApply,
} from "../equipment";
import type { InventoryAddResult, PlayerAppearance, PlayerState } from "../player";

const EQUIP_SLOT_COUNT = 14;

export interface EquipmentHandlerServices {
    getInventory: (player: PlayerState) => Array<{ itemId: number; quantity: number }>;
    getObjType: (itemId: number) => ObjType | undefined;
    addItemToInventory: (
        player: PlayerState,
        itemId: number,
        quantity: number,
    ) => InventoryAddResult;
    closeInterruptibleInterfaces: (player: PlayerState) => void;
    refreshCombatWeaponCategory: (player: PlayerState) => {
        categoryChanged: boolean;
        weaponItemChanged: boolean;
    };
    refreshAppearanceKits: (player: PlayerState) => void;
    resetAutocast: (player: PlayerState) => void;
    playLocSound: (opts: {
        soundId: number;
        tile: { x: number; y: number };
        level: number;
    }) => void;
}

export interface EquipResult {
    ok: boolean;
    reason?: string;
    categoryChanged: boolean;
    weaponItemChanged: boolean;
}

/**
 * Handles equipment operations including equipping, unequipping, and validation.
 * Encapsulates the equipment logic that was previously inline in wsServer.
 */
export class EquipmentHandler {
    private services: EquipmentHandlerServices;

    constructor(services: EquipmentHandlerServices) {
        this.services = services;
    }

    /**
     * Equip an item from inventory to an equipment slot.
     */
    equipItem(
        player: PlayerState,
        slotIndex: number,
        itemId: number,
        equipSlot: number,
        opts?: { playSound?: boolean },
    ): EquipResult {
        // OSRS parity: Equipping closes interruptible interfaces
        this.services.closeInterruptibleInterfaces(player);

        const inv = this.services.getInventory(player);
        const appearance = this.ensureAppearance(player);

        const res = equipItemApply({
            appearance,
            inv,
            slotIndex,
            itemId,
            equipSlot,
            getObjType: (id) => this.services.getObjType(id),
            addItemToInventory: (id, qty) => this.services.addItemToInventory(player, id, qty),
            slotCount: EQUIP_SLOT_COUNT,
        });

        if (!res.ok) {
            return {
                ok: false,
                reason: res.reason,
                categoryChanged: false,
                weaponItemChanged: false,
            };
        }

        // Play equip sound if requested
        if (opts?.playSound) {
            const itemDef = this.services.getObjType(itemId);
            const itemName = itemDef?.name ?? "";
            const equipSoundId = pickEquipSound(equipSlot, itemName);
            this.services.playLocSound({
                soundId: equipSoundId,
                tile: { x: player.tileX, y: player.tileY },
                level: player.level,
            });
        }

        // Mark containers as dirty for client refresh
        player.markInventoryDirty();
        player.markEquipmentDirty();

        const { categoryChanged, weaponItemChanged } =
            this.services.refreshCombatWeaponCategory(player);
        this.services.refreshAppearanceKits(player);

        // OSRS parity: Reset autocast when weapon changes
        if (weaponItemChanged && player.autocastEnabled) {
            this.services.resetAutocast(player);
        }

        return { ok: true, categoryChanged, weaponItemChanged };
    }

    /**
     * Unequip an item from an equipment slot to inventory.
     */
    unequipItem(player: PlayerState, equipSlot: number): boolean {
        // OSRS parity: Unequipping closes interruptible interfaces
        this.services.closeInterruptibleInterfaces(player);

        const appearance = this.ensureAppearance(player);

        const result = unequipItemApply({
            appearance,
            equipSlot,
            addItemToInventory: (id, qty) => this.services.addItemToInventory(player, id, qty),
            slotCount: EQUIP_SLOT_COUNT,
        });

        if (result.ok) {
            player.markInventoryDirty();
            player.markEquipmentDirty();
            this.services.refreshCombatWeaponCategory(player);
            this.services.refreshAppearanceKits(player);
        }

        return result.ok;
    }

    /**
     * Get the equipment array for a player, creating it if needed.
     */
    ensureEquipArray(player: PlayerState): number[] {
        const appearance = this.ensureAppearance(player);
        return ensureEquipArrayOn(appearance, EQUIP_SLOT_COUNT);
    }

    /**
     * Get the equipment quantity array for a player, creating it if needed.
     */
    ensureEquipQtyArray(player: PlayerState): number[] {
        const appearance = this.ensureAppearance(player);
        return ensureEquipQtyArrayOn(appearance, EQUIP_SLOT_COUNT);
    }

    /**
     * Resolve the equipment slot for an item based on its definition.
     */
    resolveEquipSlot(itemId: number): number {
        const slot = inferEquipSlot(itemId, this.services.getObjType);
        return slot ?? -1;
    }

    /**
     * Get the equipped item ID at a specific slot.
     */
    getEquippedItem(player: PlayerState, slot: number): number {
        const equip = this.ensureEquipArray(player);
        return equip[slot] ?? -1;
    }

    /**
     * Check if a player has a specific item equipped.
     */
    hasItemEquipped(player: PlayerState, itemId: number): boolean {
        const equip = this.ensureEquipArray(player);
        return equip.some((id) => id === itemId);
    }

    /**
     * Get the weapon item ID currently equipped.
     */
    getWeaponItemId(player: PlayerState): number {
        return this.getEquippedItem(player, EquipmentSlot.WEAPON);
    }

    /**
     * Get the shield/off-hand item ID currently equipped.
     */
    getShieldItemId(player: PlayerState): number {
        return this.getEquippedItem(player, EquipmentSlot.SHIELD);
    }

    // ----- Private helpers -----

    private ensureAppearance(player: PlayerState): PlayerAppearance {
        return player.appearance;
    }
}
