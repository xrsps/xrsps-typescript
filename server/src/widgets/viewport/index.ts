import { SIDE_JOURNAL_GROUP_ID } from "../../../../client/common/ui/sideJournal";
import type { ViewportEnumService } from "./ViewportEnumService";
import { BaseComponentUids } from "./ViewportEnumService";
import {
    getDesktopInterfaces,
    getRemainingTabInterfaces as getDesktopRemainingTabInterfaces,
} from "./desktop";
import {
    getMobileInterfaces,
    getMobileQuestTabUid,
    getMobileRemainingTabInterfaces,
} from "./mobile";

// Module-level service instance (initialized via setViewportEnumService)
let viewportEnumService: ViewportEnumService | null = null;

/**
 * Set the viewport enum service for dynamic component lookups.
 * Should be called once at server startup after cache is loaded.
 */
export function setViewportEnumService(service: ViewportEnumService | null): void {
    viewportEnumService = service;
}

/**
 * Get the current viewport enum service instance (if initialized).
 */
export function getViewportEnumService(): ViewportEnumService | null {
    return viewportEnumService;
}

/**
 * Display modes (matches RSMod)
 */
export enum DisplayMode {
    FIXED = 0,
    RESIZABLE_NORMAL = 1,
    RESIZABLE_LIST = 2,
    FULLSCREEN = 3,
    MOBILE = 4,
}

/** [clientscript,buff_bar_2_init] bootstraps buff_bar's dynamic listener/display children. */
export const SCRIPT_BUFF_BAR_INIT = 5929;
/** [clientscript,script626] seeds the transient camera zoom clamp varcs before toplevel resize. */
export const SCRIPT_CAMERA_ZOOM_BOUNDS_INIT = 626;
/** [clientscript,script876] initializes enhanced-client state after gameframe login. */
export const SCRIPT_ENHANCED_CLIENT_LOGIN = 876;

export function getBuffBarInitPostScripts(): Array<{
    scriptId: number;
    args: (number | string)[];
}> {
    return [{ scriptId: SCRIPT_BUFF_BAR_INIT, args: [] }];
}

export function getViewportRootInitScripts(): Array<{
    scriptId: number;
    args: (number | string)[];
}> {
    return [{ scriptId: SCRIPT_CAMERA_ZOOM_BOUNDS_INIT, args: [] }];
}

export function getEnhancedClientLoginScripts(playerName: string = ""): Array<{
    scriptId: number;
    args: (number | string)[];
}> {
    return [{ scriptId: SCRIPT_ENHANCED_CLIENT_LOGIN, args: [0, 0, playerName, playerName] }];
}

/**
 * Interface mounting definition
 */
export interface InterfaceMount {
    targetUid: number;
    groupId: number;
    type: number;
    varps?: Record<number, number>;
    varbits?: Record<number, number>;
    postScripts?: Array<{ scriptId: number; args: (number | string)[] }>;
}

export interface InterfaceDestinationEntry {
    interfaceId: number;
    fixedChildId: number;
    resizeChildId: number;
    resizeListChildId: number;
}

/**
 * Interface destinations - where each interface should be mounted
 * Based on RSMod's InterfaceDestination.kt
 *
 * IMPORTANT: For tab interfaces (ATTACK through MUSIC), the childId values are the
 * container slots where each tab's content is mounted. In OSRS:
 * - Resizable (161): tabs use children 76-89 (SIDE0-SIDE13 in enum_1137)
 * - These are NOT the same as sidemodal (74) which hides ALL tabs when used
 *
 * For utility interfaces (CHAT_BOX, USERNAME, etc.), childId varies by display mode.
 * For tab interfaces, childId is the same across display modes (tab index based).
 */
export const InterfaceDestination = {
    // Utility interfaces - childId varies by display mode
    CHAT_BOX: { interfaceId: 162, fixedChildId: 24, resizeChildId: 96, resizeListChildId: 93 },
    USERNAME: { interfaceId: 163, fixedChildId: 19, resizeChildId: 9, resizeListChildId: 9 },
    PVP_OVERLAY: { interfaceId: -1, fixedChildId: 15, resizeChildId: 4, resizeListChildId: 4 },
    MINI_MAP: { interfaceId: 160, fixedChildId: 11, resizeChildId: 22, resizeListChildId: 22 },
    XP_COUNTER: { interfaceId: 122, fixedChildId: 17, resizeChildId: 7, resizeListChildId: 7 },

    // Tab interfaces - childId is the tab container slot (same across display modes)
    // Tab order matches enum_1137 and GameframeTab enum indices (0-13)
    ATTACK: { interfaceId: 593, fixedChildId: 76, resizeChildId: 76, resizeListChildId: 76 }, // Tab 0
    SKILLS: { interfaceId: 320, fixedChildId: 77, resizeChildId: 77, resizeListChildId: 77 }, // Tab 1
    QUEST: {
        interfaceId: SIDE_JOURNAL_GROUP_ID,
        fixedChildId: 78,
        resizeChildId: 78,
        resizeListChildId: 78,
    }, // Tab 2
    INVENTORY: { interfaceId: 149, fixedChildId: 79, resizeChildId: 79, resizeListChildId: 79 }, // Tab 3
    EQUIPMENT: { interfaceId: 387, fixedChildId: 80, resizeChildId: 80, resizeListChildId: 80 }, // Tab 4
    PRAYER: { interfaceId: 541, fixedChildId: 81, resizeChildId: 81, resizeListChildId: 81 }, // Tab 5
    MAGIC: { interfaceId: 218, fixedChildId: 82, resizeChildId: 82, resizeListChildId: 82 }, // Tab 6
    CLAN_CHAT: { interfaceId: 7, fixedChildId: 83, resizeChildId: 83, resizeListChildId: 83 }, // Tab 7
    ACCOUNT_MANAGEMENT: {
        interfaceId: 109,
        fixedChildId: 84,
        resizeChildId: 84,
        resizeListChildId: 84,
    }, // Tab 8
    SOCIAL: { interfaceId: 429, fixedChildId: 85, resizeChildId: 85, resizeListChildId: 85 }, // Tab 9
    LOG_OUT: { interfaceId: 182, fixedChildId: 86, resizeChildId: 86, resizeListChildId: 86 }, // Tab 10
    SETTINGS: { interfaceId: 116, fixedChildId: 87, resizeChildId: 87, resizeListChildId: 87 }, // Tab 11
    EMOTES: { interfaceId: 216, fixedChildId: 88, resizeChildId: 88, resizeListChildId: 88 }, // Tab 12
    MUSIC: { interfaceId: 239, fixedChildId: 89, resizeChildId: 89, resizeListChildId: 89 }, // Tab 13
} satisfies Record<string, InterfaceDestinationEntry>;

/**
 * Get the root interface ID for a display mode
 */
export function getRootInterfaceId(displayMode: DisplayMode): number {
    switch (displayMode) {
        case DisplayMode.FIXED:
            return 548;
        case DisplayMode.RESIZABLE_NORMAL:
            return 161;
        case DisplayMode.RESIZABLE_LIST:
            return 164;
        case DisplayMode.FULLSCREEN:
            return 165;
        case DisplayMode.MOBILE:
            return 601;
        default:
            return 161;
    }
}

/**
 * Get the child ID for an interface destination based on display mode
 */
export function getChildId(dest: InterfaceDestinationEntry, displayMode: DisplayMode): number {
    switch (displayMode) {
        case DisplayMode.FIXED:
            return dest.fixedChildId;
        case DisplayMode.RESIZABLE_NORMAL:
            return dest.resizeChildId;
        case DisplayMode.RESIZABLE_LIST:
            return dest.resizeListChildId;
        case DisplayMode.FULLSCREEN:
            return dest.resizeChildId; // Fallback to resize
        default:
            return dest.resizeChildId;
    }
}

/**
 * Container child IDs for each display mode
 * These are the widget child IDs where modal interfaces and tabs are mounted
 *
 * OSRS Tab Hiding Behavior:
 * - MAINMODAL: For modal interfaces (bank, shop, settings). Does NOT affect tabs.
 * - INVENTORY_TAB (79): Tab 3 container - inventory interface (149), replaced by the
 *   shop inventory (301) while a shop is open (tab buttons stay visible).
 * - SIDEMODAL (74): For side panels that should HIDE all tabs (bank side).
 *   When content is mounted here, script 1213 hides side_panels, side_top, side_bottom.
 *
 * Bank behavior: main interface in MAINMODAL, side panel in SIDEMODAL (hides all tabs).
 * Shop behavior: main interface in MAINMODAL, side panel in INVENTORY_TAB.
 */
export const ContainerChildIds = {
    // Desktop fixed (548)
    FIXED: {
        MAINMODAL: 15, // toplevel:mainmodal - modal interfaces (bank, shop, etc.)
        INVENTORY_TAB: 79, // Tab 3 container (SIDE3) - for inventory interface only
        SIDEMODAL: 74, // toplevel:sidemodal - bank/shop side panels (hides ALL tabs via script 1213)
    },
    // Desktop resizable (161)
    RESIZABLE: {
        MAINMODAL: 16, // toplevel_osrs_stretch:mainmodal (10551312 = 161<<16 | 16)
        INVENTORY_TAB: 79, // Tab 3 container (SIDE3) - for inventory interface only
        SIDEMODAL: 74, // toplevel_osrs_stretch:sidemodal - bank/shop side panels (hides ALL tabs via script 1213)
    },
    // Mobile (601)
    MOBILE: {
        MAINMODAL: 27, // toplevel_osm:mainmodal (enum_1745 maps 161:16 → 601:27, size 512x334)
        INVENTORY_TAB: 119, // toplevel_osm:tab_inventory (MobileContainers.TAB_INVENTORY)
        SIDEMODAL: 74, // Mobile sidemodal (mapped via enum 1745)
    },
} as const;

/**
 * Get the mainmodal container UID for opening modal interfaces (bank, settings, etc.)
 * Uses enum 1745 for mobile mapping when ViewportEnumService is available.
 * @param displayMode The player's display mode
 * @returns The widget UID to use as targetUid for IF_OPENSUB
 */
export function getMainmodalUid(displayMode: DisplayMode): number {
    const rootId = getRootInterfaceId(displayMode);

    // For mobile: use enum service if available, otherwise fall back to hardcoded
    if (displayMode === DisplayMode.MOBILE && viewportEnumService) {
        // Enum 1745 maps 161:16 (resizable mainmodal) → 601:27 (mobile mainmodal)
        return viewportEnumService.getMobileComponent(BaseComponentUids.MAINMODAL);
    }

    // Fallback to hardcoded values
    let childId: number;
    switch (displayMode) {
        case DisplayMode.FIXED:
            childId = ContainerChildIds.FIXED.MAINMODAL;
            break;
        case DisplayMode.MOBILE:
            childId = ContainerChildIds.MOBILE.MAINMODAL;
            break;
        default:
            // RESIZABLE_NORMAL, RESIZABLE_LIST, FULLSCREEN all use resizable containers
            childId = ContainerChildIds.RESIZABLE.MAINMODAL;
            break;
    }
    return (rootId << 16) | childId;
}

/**
 * Get a stable full-screen-ish overlay container UID for mounting global overlays.
 *
 * NOTE: Do NOT mount multiple overlays into the same targetUid; IF_OPENSUB replaces the existing
 * interface at that mount point clientside.
 *
 * We use VIEWPORT_TRACKER_FRONT rather than the toplevel root (child 0) because the client
 * mounts notification_display (660) into the toplevel root for OSRS-like notifications.
 */
export function getViewportTrackerFrontUid(displayMode: DisplayMode): number {
    // Base container UID in toplevel_osrs_stretch (161).
    const baseUid = BaseComponentUids.VIEWPORT_TRACKER_FRONT;

    if (displayMode === DisplayMode.MOBILE) {
        // Enum 1745 maps 161:17 -> 601:28 in our cache.
        const fallbackMobileChildId = 28;
        if (viewportEnumService) {
            return viewportEnumService.getMobileComponent(baseUid);
        }
        return (getRootInterfaceId(displayMode) << 16) | fallbackMobileChildId;
    }

    // Project currently uses the resizable toplevel (161) for desktop.
    return baseUid;
}

/**
 * Get a stable full-screen overlay container UID for mounting global overlays that must cover
 * the entire gameframe (e.g., tutorial highlights).
 *
 * We use POPOUT (161:98) because VIEWPORT_TRACKER_* containers are viewport-sized and will
 * clip highlights that need to extend over side tabs, chatbox, etc.
 */
export function getPopoutUid(displayMode: DisplayMode): number {
    const baseUid = BaseComponentUids.POPOUT;

    if (displayMode === DisplayMode.MOBILE) {
        // Enum 1745 maps 161:98 -> 601:134 in our cache.
        const fallbackMobileChildId = 134;
        if (viewportEnumService) {
            return viewportEnumService.getMobileComponent(baseUid);
        }
        return (getRootInterfaceId(displayMode) << 16) | fallbackMobileChildId;
    }

    // Desktop modes use the base 161 UIDs directly.
    return baseUid;
}

/**
 * Get the inventory tab container UID for mounting bank-side inventory, etc.
 * Uses enum 1745 for mobile mapping when ViewportEnumService is available.
 * @param displayMode The player's display mode
 * @returns The widget UID to use as targetUid for IF_OPENSUB
 */
export function getInventoryTabUid(displayMode: DisplayMode): number {
    const rootId = getRootInterfaceId(displayMode);

    // For mobile: use enum service if available, otherwise fall back to hardcoded
    if (displayMode === DisplayMode.MOBILE && viewportEnumService) {
        // Enum 1745 maps 161:79 (resizable inventory tab) → 601:119 (mobile inventory tab)
        return viewportEnumService.getMobileComponent(BaseComponentUids.TAB_INVENTORY);
    }

    // Fallback to hardcoded values
    let childId: number;
    switch (displayMode) {
        case DisplayMode.FIXED:
            childId = ContainerChildIds.FIXED.INVENTORY_TAB;
            break;
        case DisplayMode.MOBILE:
            childId = ContainerChildIds.MOBILE.INVENTORY_TAB;
            break;
        default:
            // RESIZABLE_NORMAL, RESIZABLE_LIST, FULLSCREEN all use resizable containers
            childId = ContainerChildIds.RESIZABLE.INVENTORY_TAB;
            break;
    }
    return (rootId << 16) | childId;
}

/**
 * Get the quest/side-journal tab container UID.
 * Uses enum 1745 for mobile mapping when ViewportEnumService is available.
 * @param displayMode The player's display mode
 * @returns The widget UID to use as targetUid for IF_OPENSUB
 */
export function getQuestTabUid(displayMode: DisplayMode): number {
    const rootId = getRootInterfaceId(displayMode);

    if (displayMode === DisplayMode.MOBILE) {
        return getMobileQuestTabUid();
    }

    return (rootId << 16) | getChildId(InterfaceDestination.QUEST, displayMode);
}

/** Get the legacy Friends Chat/Chat-channel tab container UID. */
export function getClanChatTabUid(displayMode: DisplayMode): number {
    const rootId = getRootInterfaceId(displayMode);
    if (displayMode === DisplayMode.MOBILE && viewportEnumService) {
        return viewportEnumService.getMobileComponent(BaseComponentUids.TAB_CLAN);
    }
    if (displayMode === DisplayMode.MOBILE) {
        return (rootId << 16) | 123;
    }
    return (rootId << 16) | getChildId(InterfaceDestination.CLAN_CHAT, displayMode);
}

/**
 * Get the prayer tab container UID.
 * Uses enum 1745 for mobile mapping when ViewportEnumService is available.
 * @param displayMode The player's display mode
 * @returns The widget UID to use as targetUid for IF_OPENSUB
 */
export function getPrayerTabUid(displayMode: DisplayMode): number {
    const rootId = getRootInterfaceId(displayMode);

    if (displayMode === DisplayMode.MOBILE && viewportEnumService) {
        // Enum 1745 maps 161:81 (resizable prayer tab) → 601:121 (mobile prayer tab)
        return viewportEnumService.getMobileComponent(BaseComponentUids.TAB_PRAYER);
    }

    if (displayMode === DisplayMode.MOBILE) {
        // Fallback when enum service is unavailable.
        const MOBILE_PRAYER_TAB_CHILD = 121;
        return (rootId << 16) | MOBILE_PRAYER_TAB_CHILD;
    }

    const prayerTabChild = InterfaceDestination.PRAYER.resizeChildId;
    return (rootId << 16) | prayerTabChild;
}

/**
 * Get the sidemodal container UID for fullscreen side interfaces.
 * When an interface is mounted here, script 1213 hides all tab buttons.
 * Used by interfaces like equipment_inventory (85) that replace the entire side panel.
 *
 * Uses enum 1745 for mobile mapping when ViewportEnumService is available.
 * @param displayMode The player's display mode
 * @returns The widget UID to use as targetUid for IF_OPENSUB
 */
export function getSidemodalUid(displayMode: DisplayMode): number {
    const rootId = getRootInterfaceId(displayMode);

    // For mobile: use enum service if available, otherwise fall back to hardcoded
    if (displayMode === DisplayMode.MOBILE && viewportEnumService) {
        // Enum 1745 maps 161:74 (resizable sidemodal) → mobile equivalent
        return viewportEnumService.getMobileComponent(BaseComponentUids.SIDEMODAL);
    }

    // All desktop modes use child ID 74 for sidemodal
    // Fixed (548), Resizable (161), Resizable List (164), Fullscreen (165)
    return (rootId << 16) | ContainerChildIds.RESIZABLE.SIDEMODAL;
}

export function getRemainingTabInterfaces(displayMode: DisplayMode): InterfaceMount[] {
    if (displayMode === DisplayMode.MOBILE) {
        return getMobileRemainingTabInterfaces();
    }
    return getDesktopRemainingTabInterfaces(displayMode);
}

export {
    getDesktopInterfaces,
    TAB_INTERFACE_MAPPINGS,
    QUEST_TAB_INDEX,
    type DesktopInterfaceOptions,
} from "./desktop";
export {
    getMobileInterfaces,
    getMobileRemainingTabInterfaces,
    MobileVarbits,
    MobileContainers,
    MobileInterfaces,
    type MobileInterfaceOptions,
} from "./mobile";
