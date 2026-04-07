import {
    SHOP_INTERFACE_ID,
    SHOP_INVENTORY_INTERFACE_ID,
    SHOP_STOCK_COMPONENT,
} from "../../../src/widgets/InterfaceService";
import { type IScriptRegistry, type ScriptServices } from "../../../src/game/scripts/types";

// Widget UIDs for shop stock (300:16) and shop inventory (301:0)
const SHOP_STOCK_WIDGET_ID = (SHOP_INTERFACE_ID << 16) | SHOP_STOCK_COMPONENT;
const SHOP_INVENTORY_WIDGET_ID = SHOP_INVENTORY_INTERFACE_ID << 16;

/**
 * Shop button numbers (opId) - 
 *
 * Shop stock (300:16) and shop inventory (301:0) use the same layout:
 * - Button 1 (IF_BUTTON1) = Value
 * - Button 2 (IF_BUTTON2) = Buy/Sell 1
 * - Button 3 (IF_BUTTON3) = Buy/Sell 5
 * - Button 4 (IF_BUTTON4) = Buy/Sell 10
 * - Button 5 (IF_BUTTON5) = Buy/Sell 50
 */
const SHOP_OP_VALUE = 1;
const SHOP_OP_QTY_1 = 2;
const SHOP_OP_QTY_5 = 3;
const SHOP_OP_QTY_10 = 4;
const SHOP_OP_QTY_50 = 5;

/** Maps buttonNum to quantity */
const BUTTON_TO_QUANTITY: Record<number, number> = {
    [SHOP_OP_QTY_1]: 1,
    [SHOP_OP_QTY_5]: 5,
    [SHOP_OP_QTY_10]: 10,
    [SHOP_OP_QTY_50]: 50,
};

function formatCoins(amount: number): string {
    if (amount === 0) return "free";
    return amount === 1 ? "1 coin" : `${amount.toLocaleString()} coins`;
}

/**
 * Convert shop widget childIndex to 0-indexed slot.
 * OSRS shop stock widgets use 1-indexed children (slot 0 = childIndex 1).
 */
function childIndexToSlot(childIndex: number): number {
    return childIndex - 1;
}

export function registerShopWidgetHandlers(registry: IScriptRegistry, _services: ScriptServices): void {
    // ========================================
    // SHOP STOCK (300:16) - Buying items
    // ========================================

    // Shop stock "Value" option (button 1)
    registry.registerWidgetAction({
        widgetId: SHOP_STOCK_WIDGET_ID,
        opId: SHOP_OP_VALUE,
        handler: ({ player, services, slot }) => {
            if (slot === undefined) return;
            const slotIndex = childIndexToSlot(slot);
            if (slotIndex < 0) return;
            const info = services.getShopSlotValue?.(player, slotIndex);
            if (info) {
                const priceText =
                    info.buyPrice === 0
                        ? "is currently free"
                        : `currently costs ${formatCoins(info.buyPrice)}`;
                services.messaging.sendGameMessage(player, `${info.itemName}: ${priceText}.`);
            }
        },
    });

    // Shop stock buy buttons (buttons 2-5)
    for (const opId of [SHOP_OP_QTY_1, SHOP_OP_QTY_5, SHOP_OP_QTY_10, SHOP_OP_QTY_50]) {
        const quantity = BUTTON_TO_QUANTITY[opId];
        registry.registerWidgetAction({
            widgetId: SHOP_STOCK_WIDGET_ID,
            opId,
            handler: ({ player, services, slot }) => {
                if (slot === undefined) return;
                const slotIndex = childIndexToSlot(slot);
                if (slotIndex < 0) return;
                services.buyFromShop?.(player, { slotIndex, quantity });
            },
        });
    }

    // ========================================
    // SHOP INVENTORY (301:0) - Selling items
    // ========================================

    // Inventory "Value" option (button 1)
    registry.registerWidgetAction({
        widgetId: SHOP_INVENTORY_WIDGET_ID,
        opId: SHOP_OP_VALUE,
        handler: ({ player, services, itemId }) => {
            if (itemId === undefined || itemId <= 0) return;
            const info = services.getInventoryItemSellValue?.(player, itemId);
            if (info) {
                const priceText =
                    info.sellPrice === 0
                        ? "shop will buy for free"
                        : `shop will buy for ${formatCoins(info.sellPrice)}`;
                services.messaging.sendGameMessage(player, `${info.itemName}: ${priceText}.`);
            }
        },
    });

    // Inventory sell buttons (buttons 2-5)
    for (const opId of [SHOP_OP_QTY_1, SHOP_OP_QTY_5, SHOP_OP_QTY_10, SHOP_OP_QTY_50]) {
        const quantity = BUTTON_TO_QUANTITY[opId];
        registry.registerWidgetAction({
            widgetId: SHOP_INVENTORY_WIDGET_ID,
            opId,
            handler: ({ player, services, slot, itemId }) => {
                if (slot === undefined || itemId === undefined) return;
                services.sellToShop?.(player, {
                    inventorySlot: slot,
                    itemId: itemId,
                    quantity,
                });
            },
        });
    }
}
