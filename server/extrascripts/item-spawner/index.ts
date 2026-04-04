import { CustomItemBuilder } from "../../../src/custom/items/CustomItemBuilder";
import { CustomItemRegistry } from "../../../src/custom/items/CustomItemRegistry";
import { CustomWidgetRegistry } from "../../src/game/scripts/CustomWidgetRegistry";
import type { ScriptModule } from "../../src/game/scripts/types";
import { buildItemSpawnerModalGroup } from "./widget/itemSpawner.cs2";

const ITEM_SPAWNER_ID = 50100;
const BASE_ITEM_ID = 3834; // Enchanted book

CustomItemRegistry.register(
    CustomItemBuilder.create(ITEM_SPAWNER_ID)
        .basedOn(BASE_ITEM_ID)
        .name("Item Spawner")
        .inventoryActions("Activate", null, null, null, "Drop")
        .build(),
    "extrascript.item-spawner",
);

// Register the custom widget for client delivery
const widgetGroup = buildItemSpawnerModalGroup();
CustomWidgetRegistry.register(widgetGroup);

export const module: ScriptModule = {
    id: "extrascript.item-spawner",
    register(registry, services) {
        registry.registerItemAction(ITEM_SPAWNER_ID, (event) => {
            event.services.openItemSpawnerModal?.(event.player);
        });

        registry.registerCommand("itemspawner", (event) => {
            const result = services.addItemToInventory(event.player, ITEM_SPAWNER_ID, 1);
            if (result.added >= 1) {
                services.snapshotInventory(event.player);
                return "Item Spawner added to your inventory. Activate it to open the spawn menu.";
            }
            return "No free inventory space.";
        });
    },
};
