import {
    ACCOUNT_SUMMARY_COLLECTION_LOG_CHILD_INDEX,
    ACCOUNT_SUMMARY_ENTRY_LIST_UID,
    ACCOUNT_SUMMARY_GROUP_ID,
} from "../../../../src/shared/ui/accountSummary";
import {
    COLLECTION_LOG_GROUP_ID,
    SCRIPT_COLLECTION_TAB_CHANGE,
    VARBIT_COLLECTION_LAST_CATEGORY,
    VARBIT_COLLECTION_LAST_TAB,
    VARP_COLLECTION_CATEGORY_COUNT,
    VARP_COLLECTION_CATEGORY_COUNT2,
    VARP_COLLECTION_CATEGORY_COUNT3,
    buildTabChangeArgs,
} from "../../../src/game/collectionlog";
import { type IScriptRegistry, type ScriptServices, type WidgetActionEvent } from "../../../src/game/scripts/types";

/**
 * Collection Log widget handlers.
 *
 * The collection log (interface 621) is fully driven by CS2 scripts.
 * This module handles:
 *   1. Opening collection log/overview from account summary entry
 *   2. Tab/category changes (updates category count varps)
 *
 * The server populates:
 *   - collection_transmit inventory (ID 620) with obtained items
 *   - Varps for category counts (kills, completions)
 *
 * CS2 scripts query `inv_total(collection_transmit, itemId)` to check if item was obtained.
 */

export function registerCollectionLogWidgetHandlers(registry: IScriptRegistry, services: ScriptServices): void {
    // Handle the Collection Log entry click from the account panel's dynamic list.
    registry.registerWidgetAction({
        widgetId: ACCOUNT_SUMMARY_ENTRY_LIST_UID,
        handler: (event: WidgetActionEvent) => {
            if (event.groupId !== ACCOUNT_SUMMARY_GROUP_ID) return;
            const slotVal = event.slot ?? -1;
            const entryIndex =
                slotVal >= 0 && slotVal !== 65535
                    ? slotVal
                    : event.childId ?? -1;
            if (entryIndex !== ACCOUNT_SUMMARY_COLLECTION_LOG_CHILD_INDEX) return;

            // Account summary entry has:
            // - op1: "Collection Log"
            // - op2: "Collection Overview"
            const optionLower = (event.option || "").trim().toLowerCase();
            const opId = event.opId ?? 0;

            const player = event.player;

            const openCollectionLog =
                optionLower === "collection log" || (!optionLower && opId === 1);
            if (openCollectionLog) {
                services.logger?.info?.(`[collection-log] Opening for player=${player.id}`);
                services.openCollectionLog?.(player);
                return;
            }

            const openCollectionOverview =
                optionLower === "collection overview" || (!optionLower && opId === 2);
            if (openCollectionOverview) {
                services.logger?.info?.(
                    `[collection-log] Opening overview for player=${player.id}`,
                );
                services.openCollectionOverview?.(player);
            }
        },
    });

    // Handle collection log tab clicks (621:4-8 = Bosses, Raids, Clues, Minigames, Other)
    // Tab childIds: 4=Bosses(0), 5=Raids(1), 6=Clues(2), 7=Minigames(3), 8=Other(4)
    // Note: The tab child ID is encoded in widgetId, not in childId
    // widgetId = (groupId << 16) | componentId, childId is for dynamic children
    const TAB_CHILD_IDS = [4, 5, 6, 7, 8];
    registry.registerWidgetAction({
        handler: (event: WidgetActionEvent) => {
            if (event.groupId !== COLLECTION_LOG_GROUP_ID) return;

            const player = event.player;
            // Extract the component ID from widgetId (lower 16 bits)
            const componentId = event.widgetId & 0xffff;

            // Debug logging
            services.logger?.info?.(
                `[collection-log] Widget action: widgetId=${event.widgetId} groupId=${event.groupId} childId=${event.childId} componentId=${componentId} option=${event.option} opId=${event.opId}`,
            );

            // Check if this is a tab click
            const tabIndex = TAB_CHILD_IDS.indexOf(componentId);
            if (tabIndex === -1) return;

            // Only handle "View" option (opId 1)
            if ((event.opId ?? 0) !== 1) return;

            services.logger?.info?.(
                `[collection-log] Tab clicked: player=${player.id} tab=${tabIndex} (${event.target})`,
            );

            // OSRS tab change sequence from dump:
            // 1. VARP id=2048 val=0 (reset category count)
            // 2. VARBIT id=6905 val=tabIndex (selected tab)
            // 3. [PKT] SCRIPT_PRE id=7797 with args [tabIndex, comp1, comp2, comp3, comp4, structId, mode]
            //
            // Script 7797 is the main tab change handler that calls:
            // 7797 -> 7798 -> 228 (steelborder) -> 2389 -> 2731 -> 2732

            // Reset category count varp
            services.queueVarp?.(player.id, VARP_COLLECTION_CATEGORY_COUNT, 0);

            // Set varbit 6905 (VARBIT_COLLECTION_LAST_TAB) to selected tab
            player.setVarbitValue(VARBIT_COLLECTION_LAST_TAB, tabIndex);
            services.queueVarbit?.(player.id, VARBIT_COLLECTION_LAST_TAB, tabIndex);

            // Reset category selection (varbit 6906 = -1 means no category selected)
            player.setVarbitValue(VARBIT_COLLECTION_LAST_CATEGORY, -1);
            services.queueVarbit?.(player.id, VARBIT_COLLECTION_LAST_CATEGORY, -1);

            // Build args for script 7797: [tabIndex, comp1, comp2, comp3, comp4, structId, mode]
            const tabChangeArgs = buildTabChangeArgs(tabIndex);

            services.logger?.info?.(
                `[collection-log] Queuing script 7797 for player=${
                    player.id
                } tabIndex=${tabIndex} args=${JSON.stringify(tabChangeArgs)}`,
            );

            // Call script 7797 with proper widget UIDs and struct
            services.queueWidgetEvent?.(player.id, {
                action: "run_script",
                scriptId: SCRIPT_COLLECTION_TAB_CHANGE,
                args: tabChangeArgs,
            });
        },
    });

    // Handle collection log category clicks (dynamically created children by script 2731).
    // The clickable rows are created on the "component2" argument passed by script 7797.
    // From cache/CS2 (tab -> click component):
    //   Bosses=11, Raids=15, Clues=32, Minigames=27, Other=34
    const CATEGORY_CLICK_COMPONENT_IDS = [11, 15, 32, 27, 34];
    const CATEGORY_COMPONENT_TO_TAB_INDEX = new Map<number, number>([
        [11, 0], // Bosses
        [15, 1], // Raids
        [32, 2], // Clues
        [27, 3], // Minigames
        [34, 4], // Other
    ]);
    const CATEGORY_WIDGET_IDS = new Set(
        CATEGORY_CLICK_COMPONENT_IDS.map(
            (componentId) => (COLLECTION_LOG_GROUP_ID << 16) | (componentId & 0xffff),
        ),
    );

    registry.registerWidgetAction({
        handler: (event: WidgetActionEvent) => {
            if (event.groupId !== COLLECTION_LOG_GROUP_ID) return;

            // Check if this is a category widget click
            const widgetId = event.widgetId;
            if (!CATEGORY_WIDGET_IDS.has(widgetId)) return;

            // Only handle "Check" option (opId 1)
            if ((event.opId ?? 0) !== 1) return;

            const player = event.player;
            const componentId = widgetId & 0xffff;
            const tabIndex = CATEGORY_COMPONENT_TO_TAB_INDEX.get(componentId);
            if (tabIndex === undefined) return;
            const slotVal = event.slot ?? -1;
            const categoryIndexRaw =
                slotVal >= 0 && slotVal !== 65535
                    ? slotVal
                    : event.childId ?? -1;

            // Dynamic category rows are keyed by childIndex (slot). If slot is missing and
            // childId equals the static click-layer component, ignore to prevent bad selection redraws.
            if (slotVal < 0 && categoryIndexRaw === componentId) {
                services.logger?.info?.(
                    `[collection-log] Ignoring malformed category click: player=${
                        player.id
                    } tab=${tabIndex} component=${componentId} childId=${
                        event.childId
                    } slot=${String(event.slot)}`,
                );
                return;
            }

            const categoryIndex = categoryIndexRaw;

            services.logger?.info?.(
                `[collection-log] Category clicked: player=${
                    player.id
                } tab=${tabIndex} category=${categoryIndex} target=${
                    event.target
                } slot=${String(event.slot)} childId=${event.childId}`,
            );

            // Set varbit 6906 (VARBIT_COLLECTION_LAST_CATEGORY) to selected category
            player.setVarbitValue(VARBIT_COLLECTION_LAST_CATEGORY, categoryIndex);
            services.queueVarbit?.(player.id, VARBIT_COLLECTION_LAST_CATEGORY, categoryIndex);

            // Set category kill/completion count varps
            // For now just set to 0 - real implementation would look up player's stats
            services.queueVarp?.(player.id, VARP_COLLECTION_CATEGORY_COUNT, 0);
            services.queueVarp?.(player.id, VARP_COLLECTION_CATEGORY_COUNT2, 0);
            services.queueVarp?.(player.id, VARP_COLLECTION_CATEGORY_COUNT3, 0);

            // Re-run script 7797 with selected category index so the list redraw keeps
            // the clicked row highlighted and script 2731->2732 draws the matching log.
            services.queueWidgetEvent?.(player.id, {
                action: "run_script",
                scriptId: SCRIPT_COLLECTION_TAB_CHANGE,
                args: buildTabChangeArgs(tabIndex, categoryIndex),
            });
        },
    });

    // Handle collection log close button (component 1)
    // Uses onButton registration since binary packets don't send option strings
    const CLOSE_BUTTON_COMPONENT = 1;
    registry.onButton(COLLECTION_LOG_GROUP_ID, CLOSE_BUTTON_COMPONENT, (event) => {
        const player = event.player;
        services.closeModal?.(player);
        services.logger?.info?.(`[collection-log] Closed for player=${player.id}`);
    });
}
