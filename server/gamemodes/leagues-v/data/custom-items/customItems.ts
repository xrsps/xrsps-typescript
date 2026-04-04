/**
 * Custom Item Definitions
 *
 * To find model colors: window.debugModelColors(MODEL_ID) in browser console
 * OSRS HSL: (hue << 10) | (sat << 7) | light
 *   Hue: 0=red, 10=orange, 21=green, 32=gray, 43=blue, 51=purple
 */
import { CustomItemBuilder } from "../../../../../src/custom/items/CustomItemBuilder";
import { CustomItemRegistry } from "../../../../../src/custom/items/CustomItemRegistry";

const register = (
    id: number,
    baseId: number,
    name: string,
    from: number[],
    to: number[],
    actions: (string | null)[] = [null, null, null, null, "Drop"],
) => {
    CustomItemRegistry.register(
        CustomItemBuilder.create(id)
            .basedOn(baseId)
            .name(name)
            .recolor(from, to)
            .inventoryActions(...actions)
            .build(),
        name,
    );
    return id;
};

// =============================================================================
// CUSTOM ITEMS
// =============================================================================

export const CUSTOM_ITEM_IDS = {
    RED_BOND: register(
        50000,
        13190,
        "$5 Bond",
        [20416, 21435, 22181, 22305, 22449, 22451, 22464],
        [960, 1979, 2725, 2849, 2993, 2995, 3008],
        ["Redeem", null, null, null, "Drop"],
    ),
} as const;
