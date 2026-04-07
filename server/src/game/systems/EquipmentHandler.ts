import { EquipmentSlot } from "../../../../src/rs/config/player/Equipment";
import {
    ensureEquipArrayOn,
    ensureEquipQtyArrayOn,
    equipItemApply,
    inferEquipSlot,
    pickEquipSound,
    unequipItemApply,
} from "../equipment";
import type { PlayerAppearance, PlayerState } from "../player";
import type { ServerServices } from "../ServerServices";

const EQUIP_SLOT_COUNT = 14;

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
    constructor(private readonly svc: ServerServices) {}

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
        // Equipping closes interruptible interfaces
        this.svc.interfaceManager.closeInterruptibleInterfaces(player);

        const inv = this.svc.inventoryService.getInventory(player);
        const appearance = this.ensureAppearance(player);

        const res = equipItemApply({
            appearance,
            inv,
            slotIndex,
            itemId,
            equipSlot,
            getObjType: (id) => this.svc.dataLoaderService.getObjType(id),
            addItemToInventory: (id, qty) => this.svc.inventoryService.addItemToInventory(player, id, qty),
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
            const itemDef = this.svc.dataLoaderService.getObjType(itemId);
            const itemName = itemDef?.name ?? "";
            const equipSoundId = pickEquipSound(equipSlot, itemName);
            this.svc.soundService.playLocSound({
                soundId: equipSoundId,
                tile: { x: player.tileX, y: player.tileY },
                level: player.level,
            });
        }

        // Mark containers as dirty for client refresh
        player.markInventoryDirty();
        player.markEquipmentDirty();

        const { categoryChanged, weaponItemChanged } =
            this.svc.equipmentService.refreshCombatWeaponCategory(player);
        this.svc.appearanceService.refreshAppearanceKits(player);

        // Reset autocast when weapon changes
        if (weaponItemChanged && player.combat.autocastEnabled) {
            this.svc.equipmentService.resetAutocast(player);
        }

        this.svc.eventBus.emit("equipment:equip", {
            player,
            itemId,
            slot: equipSlot,
        });

        return { ok: true, categoryChanged, weaponItemChanged };
    }

    /**
     * Unequip an item from an equipment slot to inventory.
     */
    unequipItem(player: PlayerState, equipSlot: number): boolean {
        // Unequipping closes interruptible interfaces
        this.svc.interfaceManager.closeInterruptibleInterfaces(player);

        const appearance = this.ensureAppearance(player);
        const removedItemId = ensureEquipArrayOn(appearance, EQUIP_SLOT_COUNT)[equipSlot] ?? -1;

        const result = unequipItemApply({
            appearance,
            equipSlot,
            addItemToInventory: (id, qty) => this.svc.inventoryService.addItemToInventory(player, id, qty),
            slotCount: EQUIP_SLOT_COUNT,
        });

        if (result.ok) {
            player.markInventoryDirty();
            player.markEquipmentDirty();
            this.svc.equipmentService.refreshCombatWeaponCategory(player);
            this.svc.appearanceService.refreshAppearanceKits(player);

            // Unequipping the weapon clears autocast state
            if (equipSlot === EquipmentSlot.WEAPON && player.combat.autocastEnabled) {
                this.svc.equipmentService.resetAutocast(player);
            }

            this.svc.eventBus.emit("equipment:unequip", {
                player,
                itemId: removedItemId,
                slot: equipSlot,
            });
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
        const slot = inferEquipSlot(itemId, (id) => this.svc.dataLoaderService.getObjType(id));
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
