/**
 * Collection Log - Server-side Implementation
 *
 * The collection log (Interface 621) is fully driven by CS2 scripts.
 * This module provides server-side constants and operations for the collection log.
 *
 * Server responsibilities:
 *   1. Populate collection_transmit inventory (ID 620) with obtained items
 *   2. Send varps for category counts (kills, completions)
 *   3. Opening is handled by CollectionLogInterfaceHooks via InterfaceService
 *   4. Load category/item tracking data from src/shared/collectionlog/collection-log.json
 *
 * CS2 scripts query `inv_total(collection_transmit, itemId)` to check if item was obtained.
 */
import fs from "fs";
import path from "path";

import { getItemDefinition } from "../data/items";
import { logger } from "../utils/logger";
import type { WidgetAction } from "../widgets/WidgetManager";
import {
    createCollectionLogChatMessage,
    createCollectionLogNotification,
} from "./notifications/CollectionLogNotification";
import { getRuneDay } from "./time/RuneDay";

// ============================================================================
// Interface and Inventory IDs
// ============================================================================

export const COLLECTION_LOG_GROUP_ID = 621;
export const COLLECTION_OVERVIEW_GROUP_ID = 908;
export const COLLECTION_TRANSMIT_INV_ID = 620;

// ============================================================================
// VarPlayer IDs (sent from server to client)
// ============================================================================

/** Primary kill/completion count for currently viewed category */
export const VARP_COLLECTION_CATEGORY_COUNT = 2048;
/** Secondary count (some categories have 2-3 different counts) */
export const VARP_COLLECTION_CATEGORY_COUNT2 = 2941;
/** Tertiary count */
export const VARP_COLLECTION_CATEGORY_COUNT3 = 2942;

/** Total unique items obtained across entire collection log */
export const VARP_COLLECTION_COUNT = 2943;
/** Maximum possible unique items in collection log */
export const VARP_COLLECTION_COUNT_MAX = 2944;

/** Collection count for highscores display */
export const VARP_COLLECTION_COUNT_HIGHSCORES = 4612;

/** Per-tab obtained/max counts */
export const VARP_COLLECTION_COUNT_BOSSES = 4613;
export const VARP_COLLECTION_COUNT_BOSSES_MAX = 4614;
export const VARP_COLLECTION_COUNT_RAIDS = 4615;
export const VARP_COLLECTION_COUNT_RAIDS_MAX = 4616;
export const VARP_COLLECTION_COUNT_CLUES = 4617;
export const VARP_COLLECTION_COUNT_CLUES_MAX = 4618;
export const VARP_COLLECTION_COUNT_MINIGAMES = 4619;
export const VARP_COLLECTION_COUNT_MINIGAMES_MAX = 4620;
export const VARP_COLLECTION_COUNT_OTHER = 4621;
export const VARP_COLLECTION_COUNT_OTHER_MAX = 4622;
export const VARP_COLLECTION_OVERVIEW_LAST_ITEM0 = 4623;
export const VARP_COLLECTION_OVERVIEW_LAST_ITEM0_DATE = 4624;

export const COLLECTION_OVERVIEW_LATEST_ITEM_SLOTS = 12;
export const COLLECTION_OVERVIEW_LATEST_ITEM_VARPS: Array<{ itemVarp: number; dateVarp: number }> =
    Array.from({ length: COLLECTION_OVERVIEW_LATEST_ITEM_SLOTS }, (_, index) => ({
        itemVarp: VARP_COLLECTION_OVERVIEW_LAST_ITEM0 + index * 2,
        dateVarp: VARP_COLLECTION_OVERVIEW_LAST_ITEM0_DATE + index * 2,
    }));

// ============================================================================
// Varbit IDs
// ============================================================================

/** Player body type for male/female item variant display (0=male, 1=female) */
export const VARBIT_COLLECTION_PLAYER_BODYTYPE = 14577;

/** Gnome restaurant delivery counts (used by collection_category_count script) */
export const VARBIT_COLLECTION_ALUFT_EASY_DELIVERIES = 11960;
export const VARBIT_COLLECTION_ALUFT_HARD_DELIVERIES = 11961;

/** Last selected tab (0-4: Bosses, Raids, Clues, Minigames, Other) */
export const VARBIT_COLLECTION_LAST_TAB = 6905;
/** Last selected category within tab */
export const VARBIT_COLLECTION_LAST_CATEGORY = 6906;
/** Days since the RuneScape epoch used by overview recency text */
export const VARBIT_CURRENT_RUNEDAY = 9535;

// ============================================================================
// Tab Constants
// ============================================================================

/** Struct IDs for each tab category (from enum 2102) */
export const COLLECTION_TAB_STRUCTS = {
    BOSSES: 471,
    RAIDS: 472,
    CLUES: 473,
    MINIGAMES: 474,
    OTHER: 475,
} as const;

/** Tab index mapping (0-indexed) */
export const COLLECTION_TAB_INDEX = {
    BOSSES: 0,
    RAIDS: 1,
    CLUES: 2,
    MINIGAMES: 3,
    OTHER: 4,
} as const;

/** Tab widget child IDs (621:4-8) */
export const COLLECTION_TAB_CHILD_IDS = [4, 5, 6, 7, 8] as const;

// ============================================================================
// Enum IDs for loading collection log items from cache
// ============================================================================

/** Top-level tabs enum */
export const ENUM_COLLECTION_TABS = 2102;
/** Items for each category */
export const ENUM_COLLECTION_BOSSES = 2103;
export const ENUM_COLLECTION_RAIDS = 2104;
export const ENUM_COLLECTION_CLUES = 2105;
export const ENUM_COLLECTION_MINIGAMES = 2106;
export const ENUM_COLLECTION_OTHER = 2107;
/** Item variant mappings */
export const ENUM_COLLECTION_ITEM_VARIANTS = 3721;
export const ENUM_COLLECTION_FEMALE_VARIANTS = 2108;

// ============================================================================
// Widget UIDs
// ============================================================================

/** Category container widget UIDs per tab */
export const COLLECTION_CATEGORY_CONTAINERS = {
    BOSSES: [(621 << 16) | 10, (621 << 16) | 11, (621 << 16) | 12, (621 << 16) | 13],
    RAIDS: [(621 << 16) | 14, (621 << 16) | 15, (621 << 16) | 16, (621 << 16) | 17],
    CLUES: [(621 << 16) | 24, (621 << 16) | 25, (621 << 16) | 26, (621 << 16) | 27],
    MINIGAMES: [(621 << 16) | 26, (621 << 16) | 27, (621 << 16) | 28, (621 << 16) | 29],
    OTHER: [(621 << 16) | 29, (621 << 16) | 30, (621 << 16) | 31, (621 << 16) | 32],
} as const;

/** All category widget UIDs (flattened for quick lookup) */
export const ALL_CATEGORY_WIDGET_UIDS = [
    ...COLLECTION_CATEGORY_CONTAINERS.BOSSES,
    ...COLLECTION_CATEGORY_CONTAINERS.RAIDS,
    ...COLLECTION_CATEGORY_CONTAINERS.CLUES,
    ...COLLECTION_CATEGORY_CONTAINERS.MINIGAMES,
    ...COLLECTION_CATEGORY_CONTAINERS.OTHER,
] as const;

// ============================================================================
// Script IDs
// ============================================================================

/** Collection log initialization script */
export const SCRIPT_COLLECTION_INIT = 2240;
/** Tab drawing script (populates a single tab's content) */
export const SCRIPT_COLLECTION_DRAW_TABS = 2389;
/** Category list drawing script */
export const SCRIPT_COLLECTION_DRAW_LIST = 2731;
/** Item log drawing script */
export const SCRIPT_COLLECTION_DRAW_LOG = 2732;

// ============================================================================
// All collection log varps (for bulk sending)
// ============================================================================

export const COLLECTION_LOG_VARPS = [
    VARP_COLLECTION_CATEGORY_COUNT,
    VARP_COLLECTION_CATEGORY_COUNT2,
    VARP_COLLECTION_CATEGORY_COUNT3,
    VARP_COLLECTION_COUNT,
    VARP_COLLECTION_COUNT_MAX,
    VARP_COLLECTION_COUNT_HIGHSCORES,
    VARP_COLLECTION_COUNT_BOSSES,
    VARP_COLLECTION_COUNT_BOSSES_MAX,
    VARP_COLLECTION_COUNT_RAIDS,
    VARP_COLLECTION_COUNT_RAIDS_MAX,
    VARP_COLLECTION_COUNT_CLUES,
    VARP_COLLECTION_COUNT_CLUES_MAX,
    VARP_COLLECTION_COUNT_MINIGAMES,
    VARP_COLLECTION_COUNT_MINIGAMES_MAX,
    VARP_COLLECTION_COUNT_OTHER,
    VARP_COLLECTION_COUNT_OTHER_MAX,
    ...COLLECTION_OVERVIEW_LATEST_ITEM_VARPS.flatMap(({ itemVarp, dateVarp }) => [
        itemVarp,
        dateVarp,
    ]),
];

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get the struct ID for a given tab index.
 */
export function getTabStructId(tabIndex: number): number {
    const structs = [471, 472, 473, 474, 475];
    return structs[tabIndex] ?? structs[0];
}

/**
 * Get the base category container widget UID for a given tab index.
 */
export function getTabContainerUid(tabIndex: number): number {
    const containers = [
        (621 << 16) | 10, // Bosses
        (621 << 16) | 14, // Raids
        (621 << 16) | 24, // Clues
        (621 << 16) | 26, // Minigames
        (621 << 16) | 29, // Other
    ];
    return containers[tabIndex] ?? containers[0];
}

/**
 * Build script 2731 arguments for populating a tab's category list.
 * OSRS format: [tabIndex, comp1, comp2, comp3, comp4, structId, modeValue, 0]
 *
 * From OSRS dump for Other tab (script 2731):
 * [4, 40697885, 40697890, 40697891, 40697886, 475, 0, 0]
 * = [4, 621:29, 621:34, 621:35, 621:30, 475, 0, 0]
 *
 * Uses the same widget mappings as script 7797 (TAB_SCRIPT_7797_WIDGETS).
 */
export function buildCategoryListArgs(tabIndex: number): number[] {
    const structId = getTabStructId(tabIndex);
    const widgets = TAB_SCRIPT_7797_WIDGETS[tabIndex] ?? TAB_SCRIPT_7797_WIDGETS[0];

    return [
        tabIndex,
        (621 << 16) | widgets.comp1,
        (621 << 16) | widgets.comp2,
        (621 << 16) | widgets.comp3,
        (621 << 16) | widgets.comp4,
        structId,
        0, // modeValue
        0,
    ];
}

/**
 * Widget component mappings for script 7797 (collection log tab change).
 * Each tab has 4 widget components: 3 category containers + 1 item display area.
 *
 * Pattern from OSRS dumps:
 * - Raids (tab 1): Uses base+0, +1, +2, +9 pattern (14, 15, 16, 23)
 * - Other (tab 4): Uses custom layout (29, 34, 35, 30)
 *
 * For tabs without exact dumps, we use the Raids pattern as a best guess.
 */
const TAB_SCRIPT_7797_WIDGETS: Array<{
    comp1: number;
    comp2: number;
    comp3: number;
    comp4: number;
}> = [
    // Tab 0 (Bosses): from OSRS dump
    // [7797,0,40697866,40697867,40697868,40697869,471,0] = [10,11,12,13]
    { comp1: 10, comp2: 11, comp3: 12, comp4: 13 },
    // Tab 1 (Raids): from OSRS dump
    // [7797,1,40697870,40697871,40697872,40697879,472,0] = [14,15,16,23]
    { comp1: 14, comp2: 15, comp3: 16, comp4: 23 },
    // Tab 2 (Clues): from OSRS dump
    // [7797,2,40697880,40697888,40697889,40697881,473,0] = [24,32,33,25]
    { comp1: 24, comp2: 32, comp3: 33, comp4: 25 },
    // Tab 3 (Minigames): from OSRS dump
    // [7797,3,40697882,40697883,40697892,40697884,474,0] = [26,27,36,28]
    { comp1: 26, comp2: 27, comp3: 36, comp4: 28 },
    // Tab 4 (Other): from OSRS dump
    // [7797,4,40697885,40697890,40697891,40697886,475,0] = [29,34,35,30]
    { comp1: 29, comp2: 34, comp3: 35, comp4: 30 },
];

/**
 * Build script 7797 arguments for collection log tab/category redraw.
 * OSRS format from dump: [tabIndex, comp1, comp2, comp3, comp4, structId, selectedCategory]
 *
 * Where:
 * - tabIndex: 0-4 (Bosses, Raids, Clues, Minigames, Other)
 * - comp1-3: Category list container widgets
 * - comp4: Item display/scroll area widget
 * - structId: Tab struct ID (471-475)
 * - selectedCategory: index selected in category list (defaults to 0)
 *
 * Example from OSRS dump for Raids tab:
 * [1, 40697870, 40697871, 40697872, 40697879, 472, 0]
 * = [1, 621:14, 621:15, 621:16, 621:23, 472, 0]
 *
 * Example from OSRS dump for Other tab:
 * [4, 40697885, 40697890, 40697891, 40697886, 475, 0]
 * = [4, 621:29, 621:34, 621:35, 621:30, 475, 0]
 */
export function buildTabChangeArgs(tabIndex: number, selectedCategory: number = 0): number[] {
    const structId = getTabStructId(tabIndex);
    const widgets = TAB_SCRIPT_7797_WIDGETS[tabIndex] ?? TAB_SCRIPT_7797_WIDGETS[0];

    return [
        tabIndex,
        (621 << 16) | widgets.comp1,
        (621 << 16) | widgets.comp2,
        (621 << 16) | widgets.comp3,
        (621 << 16) | widgets.comp4,
        structId,
        selectedCategory,
    ];
}

/** Script ID for collection log tab change handler */
export const SCRIPT_COLLECTION_TAB_CHANGE = 7797;

/**
 * Get the category click-layer widget UID for a tab.
 * This matches the "component2" argument used by script 7797/2731 where row
 * rectangles are created and "Check" op is assigned.
 */
export function getTabCategoryClickWidgetUid(tabIndex: number): number {
    const widgets = TAB_SCRIPT_7797_WIDGETS[tabIndex] ?? TAB_SCRIPT_7797_WIDGETS[0];
    return (COLLECTION_LOG_GROUP_ID << 16) | (widgets.comp2 & 0xffff);
}

/**
 * Check if a widget UID belongs to a collection log category container.
 */
export function isCategoryWidget(widgetUid: number): boolean {
    return (ALL_CATEGORY_WIDGET_UIDS as readonly number[]).includes(widgetUid);
}

/**
 * Get the tab index from a widget component ID (4-8 -> 0-4).
 */
export function getTabIndexFromComponentId(componentId: number): number {
    const idx = (COLLECTION_TAB_CHILD_IDS as readonly number[]).indexOf(componentId);
    return idx >= 0 ? idx : -1;
}

// ============================================================================
// Item Tracking
// ============================================================================

const COLLECTION_LOG_DATA_PATH = path.resolve(
    process.cwd(),
    "src/shared/collectionlog/collection-log.json",
);

type CollectionLogCategoryData = {
    tabIndex: number;
    categoryIndex: number;
    structId: number;
    itemsEnumId: number;
    itemIds: number[];
};

type CollectionLogDataFile = {
    categories: CollectionLogCategoryData[];
};

let collectionLogLoaded = false;

/** All trackable collection log item IDs */
let collectionLogItemSet: Set<number> = new Set();

/** Total unique slots across all categories */
let totalMaxCount = 0;

/** Slot counts by tab enum (2103-2107) */
let categoryCounts: Map<number, number> = new Map();

/** Category struct IDs by tab index (0-4) */
const categoryStructsByTab: Map<number, number[]> = new Map();
/** Slot item IDs by tab index (preserves per-slot counting semantics) */
const slotItemIdsByTab: Map<number, number[]> = new Map();
/** All collection log slot item IDs across all tabs */
let allCollectionSlotItemIds: number[] = [];

function toPositiveIntArray(input: unknown): number[] {
    if (!Array.isArray(input)) return [];
    return (input as number[]).filter((value) => Number.isFinite(value) && value > 0);
}

function getTabItemsEnumIdFromTabIndex(tabIndex: number): number {
    switch (tabIndex) {
        case 0:
            return ENUM_COLLECTION_BOSSES;
        case 1:
            return ENUM_COLLECTION_RAIDS;
        case 2:
            return ENUM_COLLECTION_CLUES;
        case 3:
            return ENUM_COLLECTION_MINIGAMES;
        case 4:
            return ENUM_COLLECTION_OTHER;
        default:
            return -1;
    }
}

function loadCollectionLogDataFile(): CollectionLogDataFile {
    const rawText = fs.readFileSync(COLLECTION_LOG_DATA_PATH, "utf8");
    const raw = JSON.parse(rawText) as Partial<CollectionLogDataFile>;
    const categoriesRaw = Array.isArray(raw.categories) ? raw.categories : [];
    const categories: CollectionLogCategoryData[] = categoriesRaw
        .map((category, sourceOrder) => {
            const tabIndex = category.tabIndex;
            const rawCategoryIndex = category.categoryIndex;
            const categoryIndex =
                Number.isFinite(rawCategoryIndex) && rawCategoryIndex >= 0
                    ? rawCategoryIndex
                    : sourceOrder;
            const structId = category.structId;
            const itemsEnumId = category.itemsEnumId;
            const itemIds = toPositiveIntArray(category.itemIds);
            if (tabIndex < 0 || tabIndex >= COLLECTION_TAB_CHILD_IDS.length || structId <= 0) {
                return null;
            }
            return {
                tabIndex,
                categoryIndex,
                structId,
                itemsEnumId,
                itemIds,
            };
        })
        .filter((entry): entry is CollectionLogCategoryData => entry !== null);

    if (categories.length === 0) {
        throw new Error("collection-log.json has no valid categories");
    }

    return {
        categories,
    };
}

function ensureCollectionLogLoaded(): void {
    if (collectionLogLoaded) return;
    loadCollectionLogItems();
}

/**
 * Load collection log tracking data from src/shared/collectionlog/collection-log.json.
 * This JSON is the server-authoritative source for trackable collection slots and category layout.
 * Runtime values are derived from `categories` so stale aggregate fields cannot desync behavior.
 */
export function loadCollectionLogItems(): void {
    const data = loadCollectionLogDataFile();

    const nextItemSet = new Set<number>();
    const nextCategoryCounts = new Map<number, number>();
    const slotCountsByTabIndex = new Map<number, number>();
    const categoriesByTab = new Map<number, CollectionLogCategoryData[]>();
    const nextSlotItemIdsByTab = new Map<number, number[]>();
    const nextAllCollectionSlotItemIds: number[] = [];
    let nextTotalMaxCount = 0;

    for (const category of data.categories) {
        const tabIndex = category.tabIndex;
        let bucket = categoriesByTab.get(tabIndex);
        if (!bucket) {
            bucket = [];
            categoriesByTab.set(tabIndex, bucket);
        }
        bucket.push(category);

        const slotCount = category.itemIds.length;
        slotCountsByTabIndex.set(tabIndex, (slotCountsByTabIndex.get(tabIndex) ?? 0) + slotCount);
        nextTotalMaxCount += slotCount;
        nextAllCollectionSlotItemIds.push(...category.itemIds);

        const tabItemIds = nextSlotItemIdsByTab.get(tabIndex) ?? [];
        tabItemIds.push(...category.itemIds);
        nextSlotItemIdsByTab.set(tabIndex, tabItemIds);

        for (const itemId of category.itemIds) {
            nextItemSet.add(itemId);
        }
    }

    categoryStructsByTab.clear();
    for (const [tabIndex, categories] of categoriesByTab.entries()) {
        const orderedCategories = [...categories].sort((a, b) => a.categoryIndex - b.categoryIndex);
        categoryStructsByTab.set(
            tabIndex,
            orderedCategories.map((category) => category.structId),
        );

        const tabItemsEnumId = getTabItemsEnumIdFromTabIndex(tabIndex);
        if (tabItemsEnumId > 0) {
            nextCategoryCounts.set(tabItemsEnumId, slotCountsByTabIndex.get(tabIndex) ?? 0);
        }
    }

    collectionLogItemSet = nextItemSet;
    categoryCounts = nextCategoryCounts;
    slotItemIdsByTab.clear();
    for (const [tabIndex, itemIds] of nextSlotItemIdsByTab.entries()) {
        slotItemIdsByTab.set(tabIndex, itemIds);
    }
    allCollectionSlotItemIds = nextAllCollectionSlotItemIds;
    totalMaxCount = nextTotalMaxCount;
    collectionLogLoaded = true;

    logger.info(
        `[collection-log] Loaded ${collectionLogItemSet.size} trackable items, max=${totalMaxCount} from ${categoriesByTab.size} tabs`,
    );
    logger.info(
        `[collection-log] Category struct counts by tab: ${[...categoryStructsByTab.entries()]
            .map(([tabIndex, structIds]) => `tab${tabIndex}=${structIds.length}`)
            .join(", ")}`,
    );
}

/**
 * Check if an item ID is part of the collection log.
 * Data is loaded lazily from the shared collection-log JSON configuration.
 */
export function isCollectionLogItem(itemId: number): boolean {
    ensureCollectionLogLoaded();
    return collectionLogItemSet.has(itemId);
}

/**
 * Get all trackable collection log item IDs.
 * Data is loaded lazily from the shared collection-log JSON configuration.
 */
export function getCollectionLogItems(): Set<number> {
    ensureCollectionLogLoaded();
    return collectionLogItemSet;
}

/**
 * Get the total count of unique items in a category.
 */
export function getCategoryMaxCount(enumId: number): number {
    ensureCollectionLogLoaded();
    return categoryCounts.get(enumId) ?? 0;
}

/**
 * Get the total count of all unique items across all categories.
 */
export function getTotalMaxCount(): number {
    ensureCollectionLogLoaded();
    return totalMaxCount;
}

function countObtainedCollectionSlots(
    player: Pick<CollectionLogPlayer, "collectionLog">,
    itemIds: readonly number[],
): number {
    let count = 0;
    for (const itemId of itemIds) {
        if (player.collectionLog.hasItem(itemId)) {
            count++;
        }
    }
    return count;
}

function buildCollectionOverviewRecentItemVarps(
    player: Pick<CollectionLogPlayer, "collectionLog">,
): Record<number, number> {
    const varps: Record<number, number> = {};
    const latestUnlocks = player.collectionLog
        .getItemUnlocks()
        .filter(
            (entry) => player.collectionLog.hasItem(entry.itemId) && isCollectionLogItem(entry.itemId),
        )
        .sort(
            (left, right) =>
                right.sequence - left.sequence ||
                right.runeDay - left.runeDay ||
                right.itemId - left.itemId,
        )
        .slice(0, COLLECTION_OVERVIEW_LATEST_ITEM_SLOTS);

    for (let index = 0; index < COLLECTION_OVERVIEW_LATEST_ITEM_VARPS.length; index++) {
        const slot = COLLECTION_OVERVIEW_LATEST_ITEM_VARPS[index];
        const entry = latestUnlocks[index];
        varps[slot.itemVarp] = entry?.itemId ?? -1;
        varps[slot.dateVarp] = entry?.runeDay ?? 0;
    }

    return varps;
}

/**
 * Build the collection-log display varps used by account summary, collection overview,
 * and the main collection log header.
 */
export function buildCollectionDisplayVarps(
    player: Pick<CollectionLogPlayer, "collectionLog">,
): Record<number, number> {
    ensureCollectionLogLoaded();

    const bossesCount = countObtainedCollectionSlots(player, slotItemIdsByTab.get(0) ?? []);
    const raidsCount = countObtainedCollectionSlots(player, slotItemIdsByTab.get(1) ?? []);
    const cluesCount = countObtainedCollectionSlots(player, slotItemIdsByTab.get(2) ?? []);
    const minigamesCount = countObtainedCollectionSlots(player, slotItemIdsByTab.get(3) ?? []);
    const otherCount = countObtainedCollectionSlots(player, slotItemIdsByTab.get(4) ?? []);
    const totalObtained = countObtainedCollectionSlots(player, allCollectionSlotItemIds);

    return {
        ...buildCollectionOverviewRecentItemVarps(player),
        [VARP_COLLECTION_COUNT]: totalObtained,
        [VARP_COLLECTION_COUNT_MAX]: totalMaxCount,
        [VARP_COLLECTION_COUNT_HIGHSCORES]: totalObtained,
        [VARP_COLLECTION_COUNT_BOSSES]: bossesCount,
        [VARP_COLLECTION_COUNT_BOSSES_MAX]: slotItemIdsByTab.get(0)?.length ?? 0,
        [VARP_COLLECTION_COUNT_RAIDS]: raidsCount,
        [VARP_COLLECTION_COUNT_RAIDS_MAX]: slotItemIdsByTab.get(1)?.length ?? 0,
        [VARP_COLLECTION_COUNT_CLUES]: cluesCount,
        [VARP_COLLECTION_COUNT_CLUES_MAX]: slotItemIdsByTab.get(2)?.length ?? 0,
        [VARP_COLLECTION_COUNT_MINIGAMES]: minigamesCount,
        [VARP_COLLECTION_COUNT_MINIGAMES_MAX]: slotItemIdsByTab.get(3)?.length ?? 0,
        [VARP_COLLECTION_COUNT_OTHER]: otherCount,
        [VARP_COLLECTION_COUNT_OTHER_MAX]: slotItemIdsByTab.get(4)?.length ?? 0,
    };
}

/**
 * Sync collection-log display varps into the player's saved varp state and return the values
 * for immediate client transmission when needed.
 */
export function syncCollectionDisplayVarps(player: CollectionLogPlayer): Record<number, number> {
    const varps = buildCollectionDisplayVarps(player);
    for (const [varpIdRaw, valueRaw] of Object.entries(varps)) {
        player.varps.setVarpValue(Number(varpIdRaw), valueRaw | 0);
    }
    return varps;
}

export function buildCollectionOverviewOpenState(
    player: CollectionLogPlayer,
    nowMs: number = Date.now(),
): {
    varps: Record<number, number>;
    varbits: Record<number, number>;
} {
    return {
        varps: syncCollectionDisplayVarps(player),
        varbits: {
            [VARBIT_CURRENT_RUNEDAY]: getRuneDay(nowMs),
        },
    };
}

// ============================================================================
// Server-side Collection Log Operations
// ============================================================================

/**
 * Player interface for collection log operations.
 */
export interface CollectionLogPlayer {
    id: number;
    displayMode: number;
    collectionLog: {
        getObtainedItems(): Array<{ itemId: number; quantity: number }>;
        getItemUnlocks(): Array<{ itemId: number; runeDay: number; sequence: number }>;
        getTotalObtained(): number;
        hasItem(itemId: number): boolean;
        addItem(itemId: number, quantity: number): void;
        recordItemUnlock(itemId: number, runeDay: number): void;
    };
    varps: {
        setVarpValue(varpId: number, value: number): void;
        setVarbitValue(varbitId: number, value: number): void;
    };
}

/**
 * Services interface for collection log operations.
 */
export interface CollectionLogServices {
    queueVarp(playerId: number, varpId: number, value: number): void;
    queueVarbit(playerId: number, varbitId: number, value: number): void;
    queueWidgetEvent(playerId: number, event: WidgetAction): void;
    queueNotification(playerId: number, payload: Record<string, unknown>): void;
    queueChatMessage(request: {
        messageType: string;
        text: string;
        targetPlayerIds: number[];
    }): void;
    sendCollectionLogSnapshot(player: CollectionLogPlayer): void;
    getMainmodalUid(displayMode: number): number;
    logger?: { info(...args: unknown[]): void };
}

/**
 * Populate collection log category list by calling CS2 script 2731.
 * Script 2731 (collection_draw_list proc) handles all CC_CREATE calls and widget setup.
 */
export function populateCollectionLogCategories(
    player: CollectionLogPlayer,
    tabIndex: number,
    services: CollectionLogServices,
): void {
    const args = buildCategoryListArgs(tabIndex);

    services.queueWidgetEvent(player.id, {
        action: "run_script",
        scriptId: SCRIPT_COLLECTION_DRAW_LIST,
        args,
    });

    services.logger?.info(
        `[collection-log] Called script 2731 for tab ${tabIndex}: struct=${getTabStructId(
            tabIndex,
        )}`,
    );
}

/**
 * Track an item for the collection log if it's a trackable item.
 * Called when player obtains an item via pickup, drop, reward, etc.
 */
export function trackCollectionLogItem(
    player: CollectionLogPlayer,
    itemId: number,
    services: CollectionLogServices,
): void {
    const id = itemId;
    if (id <= 0) return;

    // Check if this item is in the collection log set
    if (!isCollectionLogItem(id)) return;

    // Check if player already has this item
    const wasNew = !player.collectionLog.hasItem(id);

    // Add to player's collection log
    player.collectionLog.addItem(id, 1);

    if (wasNew) {
        player.collectionLog.recordItemUnlock(id, getRuneDay());
        const displayVarps = syncCollectionDisplayVarps(player);
        for (const [varpIdRaw, valueRaw] of Object.entries(displayVarps)) {
            services.variables.queueVarp(player.id, Number(varpIdRaw), valueRaw | 0);
        }
        const itemName = getItemDefinition(id)?.name ?? `Item ${id}`;
        services.logger?.info(`[collection-log] NEW item for player=${player.id} itemId=${id}`);
        services.queueNotification(player.id, createCollectionLogNotification(id, itemName));
        services.queueChatMessage({
            messageType: "game",
            text: createCollectionLogChatMessage(id, itemName),
            targetPlayerIds: [player.id],
        });
    }
}

// ============================================================================
// Category Selection and Item Display
// ============================================================================

/**
 * Get the struct ID for a specific category within a tab.
 * @param tabIndex - The tab index (0-4: Bosses, Raids, Clues, Minigames, Other)
 * @param categoryIndex - The category index within the tab
 * @returns The struct ID, or -1 if not found
 */
export function getCategoryStructId(tabIndex: number, categoryIndex: number): number {
    ensureCollectionLogLoaded();
    const structs = categoryStructsByTab.get(tabIndex);
    if (!structs || categoryIndex < 0 || categoryIndex >= structs.length) {
        return -1;
    }
    return structs[categoryIndex];
}

/**
 * Get number of categories in a tab from server-authoritative collection log data.
 */
export function getCategoryCountForTab(tabIndex: number): number {
    ensureCollectionLogLoaded();
    return categoryStructsByTab.get(tabIndex)?.length ?? 0;
}

/**
 * Get the items enum ID for a tab.
 * @param tabIndex - The tab index (0-4)
 * @returns The enum ID for the tab's items
 */
export function getTabItemsEnumId(tabIndex: number): number {
    const enumId = getTabItemsEnumIdFromTabIndex(tabIndex);
    return enumId > 0 ? enumId : ENUM_COLLECTION_BOSSES;
}

/**
 * Draw a specific collection log category's items by calling script 2732.
 * Script 2732 (collection_draw_log proc) takes (struct, enum, categoryIndex)
 * and populates the item display area with the category's items.
 *
 * @param player - The player
 * @param tabIndex - The tab index (0-4)
 * @param categoryIndex - The category index within the tab
 * @param services - Collection log services
 */
export function drawCollectionLogCategory(
    player: CollectionLogPlayer,
    tabIndex: number,
    categoryIndex: number,
    services: CollectionLogServices,
): void {
    const structId = getCategoryStructId(tabIndex, categoryIndex);
    if (structId <= 0) {
        services.logger?.info?.(
            `[collection-log] Invalid category: tab=${tabIndex} category=${categoryIndex}`,
        );
        return;
    }

    const itemsEnumId = getTabItemsEnumId(tabIndex);

    services.logger?.info?.(
        `[collection-log] Drawing category: player=${player.id} tab=${tabIndex} category=${categoryIndex} struct=${structId} enum=${itemsEnumId}`,
    );

    // Call script 2732 (collection_draw_log) with (struct, enum, categoryIndex)
    services.queueWidgetEvent(player.id, {
        action: "run_script",
        scriptId: SCRIPT_COLLECTION_DRAW_LOG, // 2732
        args: [structId, itemsEnumId, categoryIndex],
    });
}
