/**
 * Item Protection Calculator
 *
 * Calculates which items are kept vs lost on death following OSRS rules.
 * Security: Uses server-side item values only, never trusts client data.
 */
import { EquipmentSlot } from "../../../../src/rs/config/player/Equipment";
import type { ItemDefinition } from "../../data/items";
import type { EquipmentSnapshotEntry, InventoryEntry, PlayerState } from "../player";
import { DeathType, ItemSourceType, type ItemProtectionResult, type ItemSource, type ValuedItem } from "./types";

/**
 * Item IDs that are always kept on death regardless of other rules
 * (e.g., void equipment after elite diary, fire cape, etc.)
 */
const ALWAYS_KEPT_ITEMS = new Set<number>([
    // These would be populated from game data
    // For now, keeping this empty as OSRS has complex rules around "always kept"
]);

/**
 * Item IDs that are converted to coins on death in PvP
 * (untradeables that have a coin conversion value)
 */
const UNTRADEABLE_COIN_VALUES: Map<number, number> = new Map([
    // Void knight equipment (breaks to coins in PvP)
    [8839, 10000], // Void knight top
    [8840, 10000], // Void knight robe
    [8842, 10000], // Void knight gloves
    [11663, 10000], // Void knight mage helm
    [11664, 10000], // Void knight ranger helm
    [11665, 10000], // Void knight melee helm
    // Fire cape
    [6570, 50000], // Fire cape
    // Infernal cape
    [21295, 100000], // Infernal cape
    // Fighter torso
    [10551, 50000], // Fighter torso
    // Defender
    [12954, 30000], // Dragon defender
    [19722, 150000], // Avernic defender
]);

export interface ItemProtectionOptions {
    /** Get item definition by ID */
    getItemDefinition: (itemId: number) => ItemDefinition | undefined;
    /** Death type for rule selection */
    deathType: DeathType;
    /** Optional custom always-kept set */
    alwaysKeptItems?: Set<number>;
}

export class ItemProtectionCalculator {
    private readonly getItemDefinition: (itemId: number) => ItemDefinition | undefined;
    private readonly deathType: DeathType;
    private readonly alwaysKeptItems: Set<number>;

    constructor(options: ItemProtectionOptions) {
        this.getItemDefinition = options.getItemDefinition;
        this.deathType = options.deathType;
        this.alwaysKeptItems = options.alwaysKeptItems ?? ALWAYS_KEPT_ITEMS;
    }

    /**
     * Calculate item protection for a player death.
     *
     * @param player - The player who died
     * @param wasSkulled - Whether player was skulled at death (snapshot value)
     * @param hadProtectItem - Whether Protect Item prayer was active (snapshot value)
     * @returns Item protection result with kept/lost items
     */
    calculate(
        player: PlayerState,
        wasSkulled: boolean,
        hadProtectItem: boolean,
    ): ItemProtectionResult {
        // Safe deaths keep all items
        if (this.deathType === DeathType.SAFE) {
            return {
                kept: [],
                lost: [],
                baseProtectionCount: 0,
                protectItemActive: hadProtectItem,
                skulled: wasSkulled,
                totalLostValue: 0,
            };
        }

        // Gather all items from inventory and equipment
        const items = this.gatherItems(player);

        // Separate always-kept items
        const alwaysKept = items.filter((item) => item.alwaysKept);
        const protectable = items.filter((item) => !item.alwaysKept);

        // Sort by value (descending) - highest value kept first
        protectable.sort((a, b) => b.value - a.value);

        // Calculate protection count
        // Not skulled: 3 items, Skulled: 0 items, +1 if Protect Item active
        const baseCount = wasSkulled ? 0 : 3;
        const protectItemBonus = hadProtectItem ? 1 : 0;
        const protectionCount = baseCount + protectItemBonus;

        // Split into kept and lost
        const kept: ValuedItem[] = [...alwaysKept];
        const lost: ValuedItem[] = [];

        for (let i = 0; i < protectable.length; i++) {
            if (i < protectionCount) {
                kept.push(protectable[i]);
            } else {
                lost.push(protectable[i]);
            }
        }

        // Handle PvP untradeable conversion
        if (this.deathType === DeathType.PVP) {
            this.convertUntradeablesForPvP(lost);
        }

        // Calculate total lost value
        const totalLostValue = lost.reduce((sum, item) => sum + item.value * item.quantity, 0);

        return {
            kept,
            lost,
            baseProtectionCount: baseCount,
            protectItemActive: hadProtectItem,
            skulled: wasSkulled,
            totalLostValue,
        };
    }

    /**
     * Gather all items from player inventory and equipment into a unified list.
     */
    private gatherItems(player: PlayerState): ValuedItem[] {
        const items: ValuedItem[] = [];

        // Gather inventory items
        const inventory = player.getInventoryEntries();
        for (let slot = 0; slot < inventory.length; slot++) {
            const entry = inventory[slot];
            if (!entry || entry.itemId <= 0 || entry.quantity <= 0) continue;

            const item = this.createValuedItem(entry.itemId, entry.quantity, {
                type: ItemSourceType.Inventory,
                slot,
            });
            if (item) {
                items.push(item);
            }
        }

        // Gather equipment items
        const equipment = player.exportEquipmentSnapshot();
        for (const entry of equipment) {
            if (entry.itemId <= 0) continue;

            const quantity = entry.quantity ?? 1;
            const item = this.createValuedItem(entry.itemId, quantity, {
                type: ItemSourceType.Equipment,
                slot: entry.slot,
            });
            if (item) {
                items.push(item);
            }
        }

        return items;
    }

    /**
     * Create a ValuedItem from an item ID and quantity.
     */
    private createValuedItem(
        itemId: number,
        quantity: number,
        source: ItemSource,
    ): ValuedItem | null {
        const definition = this.getItemDefinition(itemId);
        if (!definition) {
            // Unknown item - treat as untradeable with 0 value
            return {
                itemId,
                quantity,
                source,
                value: 0,
                tradeable: false,
                alwaysKept: false,
                definition: undefined,
            };
        }

        // Use high alch value for death calculations
        // In OSRS, GE price is used if available, falling back to high alch
        // For simplicity, we use high alch which is always server-side
        const highAlchValue = definition.highAlch;
        const value = highAlchValue > 0 ? highAlchValue : definition.value ?? 0;

        return {
            itemId,
            quantity,
            source,
            value,
            tradeable: definition.tradeable,
            alwaysKept: this.alwaysKeptItems.has(itemId),
            definition,
        };
    }

    /**
     * Convert untradeable items to their coin value for PvP deaths.
     * In PvP, untradeables either drop coins or are kept.
     */
    private convertUntradeablesForPvP(items: ValuedItem[]): void {
        for (const item of items) {
            if (!item.tradeable) {
                const coinValue = UNTRADEABLE_COIN_VALUES.get(item.itemId);
                if (coinValue !== undefined && coinValue > 0) {
                    // Mark for coin conversion (handled during drop)
                    // The item itself stays in the list but we note the coin value
                    item.value = coinValue;
                }
            }
        }
    }

    /**
     * Calculate what a player would lose at their current state.
     * Useful for UI/warnings before entering dangerous areas.
     */
    static preview(
        player: PlayerState,
        getItemDefinition: (itemId: number) => ItemDefinition | undefined,
        deathType: DeathType = DeathType.DANGEROUS,
    ): ItemProtectionResult {
        // Check current skull and prayer state
        const appearance = player.appearance;
        const wasSkulled =
            appearance?.headIcons?.skull !== undefined && appearance.headIcons.skull >= 0;
        const hadProtectItem = player.prayer.hasPrayerActive("protect_item");

        const calculator = new ItemProtectionCalculator({
            getItemDefinition,
            deathType,
        });

        return calculator.calculate(player, wasSkulled, hadProtectItem);
    }
}

/**
 * Helper function to get kept item count for display.
 */
export function getKeptItemCount(skulled: boolean, protectItem: boolean): number {
    const base = skulled ? 0 : 3;
    return base + (protectItem ? 1 : 0);
}
