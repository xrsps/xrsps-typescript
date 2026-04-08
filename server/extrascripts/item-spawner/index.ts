import { CustomItemBuilder } from "../../../src/custom/items/CustomItemBuilder";
import { CustomItemRegistry } from "../../../src/custom/items/CustomItemRegistry";
import { CustomWidgetRegistry } from "../../src/game/scripts/CustomWidgetRegistry";
import type { PlayerState } from "../../src/game/player";
import type { IScriptRegistry, ScriptServices, WidgetActionEvent } from "../../src/game/scripts/types";
import {
    ITEM_SPAWNER_MODAL_COMPONENT_BODY,
    ITEM_SPAWNER_MODAL_COMPONENT_CLOSE,
    ITEM_SPAWNER_MODAL_COMPONENT_FRAME,
    ITEM_SPAWNER_MODAL_COMPONENT_HELPER,
    ITEM_SPAWNER_MODAL_COMPONENT_QUERY,
    ITEM_SPAWNER_MODAL_COMPONENT_RESULTS_SCROLLBAR,
    ITEM_SPAWNER_MODAL_COMPONENT_RESULTS_VIEW,
    ITEM_SPAWNER_MODAL_COMPONENT_SEARCH_BACKGROUND,
    ITEM_SPAWNER_MODAL_COMPONENT_SLOT_ICON_START,
    ITEM_SPAWNER_MODAL_COMPONENT_SUMMARY,
    ITEM_SPAWNER_MODAL_COMPONENT_TITLE,
    ITEM_SPAWNER_MODAL_GROUP_ID,
    ITEM_SPAWNER_MODAL_RESULT_SLOT_COUNT,
} from "../../../src/shared/ui/widgets";
import { buildItemSpawnerModalGroup } from "./widget/itemSpawner.cs2";

const ITEM_SPAWNER_ID = 50100;
const BASE_ITEM_ID = 3834; // Enchanted book

const SCRIPT_STEELBORDER_NOCLOSE = 3737;
const SCRIPT_STONEBUTTON_INIT = 2424;
const FONT_BOLD_12 = 496;
const STONEBUTTON_STYLE_OUTLINE = 0;

let registered = false;

function ensureRegistered(): void {
    if (registered) return;
    registered = true;

    CustomItemRegistry.register(
        CustomItemBuilder.create(ITEM_SPAWNER_ID)
            .basedOn(BASE_ITEM_ID)
            .name("Item Spawner")
            .inventoryActions("Activate", null, null, null, "Drop")
            .build(),
        "extrascript.item-spawner",
    );

    const widgetGroup = buildItemSpawnerModalGroup();
    CustomWidgetRegistry.register(widgetGroup);
}

function getWidgetUid(groupId: number, componentId: number): number {
    return ((groupId & 0xffff) << 16) | (componentId & 0xffff);
}

function escapeWidgetText(value: string): string {
    return String(value ?? "").replace(/[<>]/g, "");
}

function normalizeQuery(query: string | undefined): string {
    return String(query ?? "")
        .replace(/\s+/g, " ")
        .trim();
}

function queueWidgetEvent(services: WidgetActionEvent["services"], playerId: number, event: any): void {
    services.dialog.queueWidgetEvent?.(playerId, event);
}

function runScript(services: WidgetActionEvent["services"], playerId: number, scriptId: number, args: Array<number | string>): void {
    queueWidgetEvent(services, playerId, {
        action: "run_script",
        scriptId,
        args,
    });
}

function setWidgetText(services: WidgetActionEvent["services"], playerId: number, componentId: number, text: string): void {
    queueWidgetEvent(services, playerId, {
        action: "set_text",
        uid: getWidgetUid(ITEM_SPAWNER_MODAL_GROUP_ID, componentId),
        text: String(text ?? ""),
    });
}

function setWidgetHidden(services: WidgetActionEvent["services"], playerId: number, componentId: number, hidden: boolean): void {
    queueWidgetEvent(services, playerId, {
        action: "set_hidden",
        uid: getWidgetUid(ITEM_SPAWNER_MODAL_GROUP_ID, componentId),
        hidden: !!hidden,
    });
}

function applyItemSpawnerLayout(services: WidgetActionEvent["services"], player: PlayerState): void {
    const playerId = player.id;
    runScript(services, playerId, SCRIPT_STEELBORDER_NOCLOSE, [
        getWidgetUid(ITEM_SPAWNER_MODAL_GROUP_ID, ITEM_SPAWNER_MODAL_COMPONENT_FRAME),
        "Item Spawner",
    ]);
    runScript(services, playerId, SCRIPT_STONEBUTTON_INIT, [
        getWidgetUid(ITEM_SPAWNER_MODAL_GROUP_ID, ITEM_SPAWNER_MODAL_COMPONENT_CLOSE),
        FONT_BOLD_12,
        STONEBUTTON_STYLE_OUTLINE,
        "Close",
    ]);
    setWidgetHidden(services, playerId, ITEM_SPAWNER_MODAL_COMPONENT_TITLE, true);
    setWidgetHidden(services, playerId, ITEM_SPAWNER_MODAL_COMPONENT_BODY, true);
    setWidgetText(services, playerId, ITEM_SPAWNER_MODAL_COMPONENT_TITLE, "");
    setWidgetText(services, playerId, ITEM_SPAWNER_MODAL_COMPONENT_BODY, "");
    setWidgetText(
        services,
        playerId,
        ITEM_SPAWNER_MODAL_COMPONENT_HELPER,
        "<col=c5b79b>Type to search cache items.</col>",
    );
    setWidgetText(
        services,
        playerId,
        ITEM_SPAWNER_MODAL_COMPONENT_SUMMARY,
        "<col=c5b79b>Start typing to filter cache item names.</col>",
    );
}

function openItemSpawnerModal(services: WidgetActionEvent["services"], player: PlayerState, query?: string): string {
    const interfaceService = services.dialog.getInterfaceService?.();
    if (!interfaceService) return "Interface service unavailable.";

    const normalizedQuery = normalizeQuery(query);
    interfaceService.openModal(player, ITEM_SPAWNER_MODAL_GROUP_ID);
    applyItemSpawnerLayout(services, player);
    setWidgetText(
        services,
        player.id,
        ITEM_SPAWNER_MODAL_COMPONENT_QUERY,
        escapeWidgetText(normalizedQuery),
    );

    if (normalizedQuery.length === 0) {
        return "Item spawner opened. Type in the search bar to find cache items.";
    }
    return `Item spawner opened for "${normalizedQuery}".`;
}

function spawnInventoryItem(
    services: WidgetActionEvent["services"],
    player: PlayerState,
    itemId: number,
): { requested: number; completed: number; itemName: string } {
    const result = services.inventory.addItemToInventory(player, itemId, 1);
    services.inventory.snapshotInventory(player);
    const itemName = services.data.getObjType?.(itemId)?.name?.trim() || `Item ${itemId}`;
    return {
        requested: 1,
        completed: result.added >= 1 ? 1 : 0,
        itemName,
    };
}

export function register(registry: IScriptRegistry, services: ScriptServices): void {
    ensureRegistered();

    registry.registerItemAction(ITEM_SPAWNER_ID, (event) => {
        openItemSpawnerModal(event.services, event.player);
    });

    registry.registerCommand("itemspawner", (event) => {
        const result = services.inventory.addItemToInventory(event.player, ITEM_SPAWNER_ID, 1);
        if (result.added >= 1) {
            services.inventory.snapshotInventory(event.player);
            return "Item Spawner added to your inventory. Activate it to open the spawn menu.";
        }
        return "No free inventory space.";
    });

    // Search background click - no-op, handled client-side
    registry.onButton(ITEM_SPAWNER_MODAL_GROUP_ID, ITEM_SPAWNER_MODAL_COMPONENT_SEARCH_BACKGROUND, () => {});

    // Query text click - no-op, handled client-side
    registry.onButton(ITEM_SPAWNER_MODAL_GROUP_ID, ITEM_SPAWNER_MODAL_COMPONENT_QUERY, () => {});

    // Close button
    registry.onButton(ITEM_SPAWNER_MODAL_GROUP_ID, ITEM_SPAWNER_MODAL_COMPONENT_CLOSE, (event) => {
        const interfaceService = event.services.dialog.getInterfaceService?.();
        interfaceService?.closeModal(event.player);
    });

    // Results view / scrollbar - no-op, prevent fallthrough
    registry.onButton(ITEM_SPAWNER_MODAL_GROUP_ID, ITEM_SPAWNER_MODAL_COMPONENT_RESULTS_VIEW, () => {});
    registry.onButton(ITEM_SPAWNER_MODAL_GROUP_ID, ITEM_SPAWNER_MODAL_COMPONENT_RESULTS_SCROLLBAR, () => {});

    // Slot icon click handlers for spawning items
    for (let slotIndex = 0; slotIndex < ITEM_SPAWNER_MODAL_RESULT_SLOT_COUNT; slotIndex++) {
        const componentId = ITEM_SPAWNER_MODAL_COMPONENT_SLOT_ICON_START + slotIndex;
        registry.onButton(ITEM_SPAWNER_MODAL_GROUP_ID, componentId, (event: WidgetActionEvent) => {
            const selectedItemId = typeof event.itemId === "number" ? event.itemId | 0 : -1;
            if (!(selectedItemId > 0)) return;

            const result = spawnInventoryItem(event.services, event.player, selectedItemId);
            if (result.completed < result.requested) {
                event.services.messaging.sendGameMessage(
                    event.player,
                    `Not enough inventory space to spawn ${result.itemName} (${selectedItemId}).`,
                );
                return;
            }

            event.services.messaging.sendGameMessage(
                event.player,
                `Spawned ${result.itemName} (${selectedItemId}) x${result.completed}.`,
            );
        });
    }

    // Client message handler for search queries (currently no-op, search is client-side)
    registry.registerClientMessageHandler("item_spawner_search", () => {});
}
