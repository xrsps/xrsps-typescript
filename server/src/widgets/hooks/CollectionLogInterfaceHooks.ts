/**
 * CollectionLogInterfaceHooks - Collection log interface lifecycle hooks
 *
 * Based on RSMod pattern (similar to shops.plugin.kts).
 * Registers on_interface_open and on_interface_close hooks for the collection log.
 *
 * Flow:
 * 1. Collection log opens (621) -> Initialize tabs, varps, run CS2 scripts
 * 2. Collection log closes (621) -> Cleanup if needed
 *
 * Usage:
 * ```ts
 * const interfaceService = new InterfaceService(dispatcher);
 * registerCollectionLogInterfaceHooks(interfaceService);
 *
 * // Now when you open collection log, the hooks handle everything:
 * interfaceService.openModal(player, COLLECTION_LOG_GROUP_ID, { services });
 * ```
 */
import {
    COLLECTION_LOG_GROUP_ID,
    SCRIPT_COLLECTION_DRAW_TABS,
    SCRIPT_COLLECTION_INIT,
    VARBIT_COLLECTION_LAST_CATEGORY,
    VARBIT_COLLECTION_LAST_TAB,
    VARP_COLLECTION_CATEGORY_COUNT,
    VARP_COLLECTION_COUNT,
    VARP_COLLECTION_COUNT_MAX,
    getCategoryCountForTab,
    getTabCategoryClickWidgetUid,
    populateCollectionLogCategories,
    syncCollectionDisplayVarps,
} from "../../game/collectionlog";
import type { PlayerState } from "../../game/player";
import { logger } from "../../utils/logger";
import type { InterfaceService } from "../InterfaceService";

/**
 * Services needed by collection log hooks.
 * Passed as modal data when opening.
 */
export interface CollectionLogOpenData {
    sendCollectionLogSnapshot: (player: PlayerState) => void;
    queueVarp: (playerId: number, varpId: number, value: number) => void;
    queueVarbit: (playerId: number, varbitId: number, value: number) => void;
    queueWidgetEvent: (playerId: number, event: Record<string, unknown>) => void;
    logger?: { info?: (...args: unknown[]) => void };
}

const FLAG_TRANSMIT_OP1 = 1 << 1;

/**
 * Register collection log interface hooks with the InterfaceService.
 * Should be called once at server startup.
 *
 * @param interfaceService The InterfaceService to register hooks with
 */
export function registerCollectionLogInterfaceHooks(interfaceService: InterfaceService): void {
    // =============== ON COLLECTION LOG OPEN ===============
    interfaceService.onInterfaceOpen(COLLECTION_LOG_GROUP_ID, (player, ctx) => {
        const data = ctx.data as CollectionLogOpenData | undefined;
        if (!data) {
            logger.warn("[CollectionLogHooks] onOpen: No services data provided");
            return;
        }

        initializeCollectionLog(player, data);
    });

    // =============== ON COLLECTION LOG CLOSE ===============
    interfaceService.onInterfaceClose(COLLECTION_LOG_GROUP_ID, (_player, _ctx) => {
        // No special cleanup needed for collection log
        // The interface just closes, varps/varbits remain for next open
    });
}

/**
 * Initialize the collection log interface.
 * Sends inventory snapshot, varps, and runs CS2 scripts.
 */
function initializeCollectionLog(player: PlayerState, services: CollectionLogOpenData): void {
    const playerId = player.id;

    // Send the collection log inventory snapshot first
    services.sendCollectionLogSnapshot(player);

    // Seed the collection-log display varps before any collection CS2 runs.
    const displayVarps = syncCollectionDisplayVarps(player);
    for (const [varpIdRaw, valueRaw] of Object.entries(displayVarps)) {
        services.variables.queueVarp(playerId, Number(varpIdRaw), valueRaw | 0);
    }

    // Script 1601 - initialization
    services.queueWidgetEvent(playerId, {
        action: "run_script",
        scriptId: 1601,
        args: [1601],
    });

    // Script 2388 - draws tabs (calls 2389->2728 for each tab with widget UIDs like 621:4)
    services.queueWidgetEvent(playerId, {
        action: "run_script",
        scriptId: 2388,
        args: [2388, 0],
    });

    // Script 2240 - collection_init
    services.queueWidgetEvent(playerId, {
        action: "run_script",
        scriptId: SCRIPT_COLLECTION_INIT,
        args: [SCRIPT_COLLECTION_INIT],
    });

    // Set varbit 6905 (tab) to 0 = Bosses
    player.varps.setVarbitValue(VARBIT_COLLECTION_LAST_TAB, 0);
    services.variables.queueVarbit(playerId, VARBIT_COLLECTION_LAST_TAB, 0);

    // Set varbit 6906 (selected category) to -1 = none selected (show category list)
    player.varps.setVarbitValue(VARBIT_COLLECTION_LAST_CATEGORY, -1);
    services.variables.queueVarbit(playerId, VARBIT_COLLECTION_LAST_CATEGORY, -1);

    // Reset category count varp
    services.variables.queueVarp(playerId, VARP_COLLECTION_CATEGORY_COUNT, 0);

    // Run script 2389 to initialize the first tab's content structure
    services.queueWidgetEvent(playerId, {
        action: "run_script",
        scriptId: SCRIPT_COLLECTION_DRAW_TABS,
        args: [0], // tabIndex 0 = Bosses
    });

    // Populate the initial tab's categories (Bosses, index 0)
    populateCollectionLogCategories(player, 0, {
        queueVarp: (pid, id, val) => services.variables.queueVarp(pid, id, val),
        queueVarbit: (pid, id, val) => services.variables.queueVarbit(pid, id, val),
        queueWidgetEvent: (pid, evt) => services.dialog.queueWidgetEvent(pid, evt as any),
        queueNotification: () => {},
        queueChatMessage: () => {},
        sendCollectionLogSnapshot: () => {},
        getMainmodalUid: () => 0,
        logger: services.logger?.info
            ? { info: (...args: unknown[]) => services.logger!.info!(...args) }
            : undefined,
    });

    // Dynamic category rows are created by script 2731 under per-tab click layers.
    // Enable op1 transmission for those child indices so category selection reaches server.
    for (let tabIndex = 0; tabIndex < 5; tabIndex++) {
        const categoryCount = getCategoryCountForTab(tabIndex);
        if (categoryCount <= 0) continue;

        services.queueWidgetEvent(playerId, {
            action: "set_flags_range",
            uid: getTabCategoryClickWidgetUid(tabIndex),
            fromSlot: 0,
            toSlot: categoryCount - 1,
            flags: FLAG_TRANSMIT_OP1,
        });
    }

    services.logger?.info?.(
        `[collection-log] Opened for player=${playerId} items=${displayVarps[VARP_COLLECTION_COUNT]}/${displayVarps[VARP_COLLECTION_COUNT_MAX]}`,
    );
}
