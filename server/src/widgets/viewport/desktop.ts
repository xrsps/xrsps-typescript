import {
    DisplayMode,
    InterfaceMount,
    getBuffBarInitPostScripts,
    getRootInterfaceId,
} from "./index";

const BUFF_BAR_INTERFACE_ID = 651;

/**
 * Tab interface mappings - exported for use by tutorial tab unlock
 * Note: Using hardcoded interface IDs to avoid circular dependency with index.ts
 */
export const TAB_INTERFACE_MAPPINGS = [
    { groupId: 593, childId: 76, tabIndex: 0 }, // Combat (ATTACK)
    { groupId: 320, childId: 77, tabIndex: 1 }, // Skills
    { groupId: 629, childId: 78, tabIndex: 2 }, // Quest (SIDE_JOURNAL)
    { groupId: 149, childId: 79, tabIndex: 3 }, // Inventory
    { groupId: 387, childId: 80, tabIndex: 4 }, // Equipment
    { groupId: 541, childId: 81, tabIndex: 5 }, // Prayer
    { groupId: 218, childId: 82, tabIndex: 6 }, // Magic
    { groupId: 7, childId: 83, tabIndex: 7 }, // Clan
    { groupId: 109, childId: 84, tabIndex: 8 }, // Account
    { groupId: 429, childId: 85, tabIndex: 9 }, // Social
    { groupId: 182, childId: 86, tabIndex: 10 }, // Logout
    { groupId: 116, childId: 87, tabIndex: 11 }, // Settings
    { groupId: 216, childId: 88, tabIndex: 12 }, // Emotes
    { groupId: 239, childId: 89, tabIndex: 13 }, // Music
] as const;

/** Tab index for the Quest tab (side_journal) */
export const QUEST_TAB_INDEX = 2;

/**
 * Options for controlling which interfaces to include
 */
export interface DesktopInterfaceOptions {
    /**
     * If true, only include the Quest tab (for league tutorial mode).
     * When tutorial completes, call openRemainingTabs() to show all tabs.
     */
    tutorialMode?: boolean;
}

/**
 * Get default interfaces for desktop display modes (fixed, resizable, fullscreen)
 */
export function getDesktopInterfaces(
    displayMode: DisplayMode,
    options?: DesktopInterfaceOptions,
): InterfaceMount[] {
    const rootId = getRootInterfaceId(displayMode);
    const interfaces: InterfaceMount[] = [];

    // Desktop dedicated interfaces (chat, minimap, etc.) - always opened
    // Note: Using hardcoded values to avoid circular dependency with index.ts.
    // Some overlays use a distinct mount point in resizable-list mode (164).
    // Format: { groupId, fixedChildId, resizeChildId, resizeListChildId? }
    const dedicatedInterfaces = [
        { groupId: 162, fixedChildId: 24, resizeChildId: 96 }, // CHAT_BOX
        { groupId: 163, fixedChildId: 19, resizeChildId: 9 }, // USERNAME
        { groupId: 160, fixedChildId: 11, resizeChildId: 22 }, // MINI_MAP
        { groupId: 122, fixedChildId: 17, resizeChildId: 7 }, // XP_COUNTER
        {
            groupId: BUFF_BAR_INTERFACE_ID,
            fixedChildId: 32,
            resizeChildId: 6,
            resizeListChildId: 6,
            postScripts: getBuffBarInitPostScripts(),
        }, // BUFF_BAR
    ];

    for (const dest of dedicatedInterfaces) {
        let childId = dest.resizeChildId;
        if (displayMode === DisplayMode.FIXED) {
            childId = dest.fixedChildId;
        } else if (displayMode === DisplayMode.RESIZABLE_LIST) {
            childId = dest.resizeListChildId ?? dest.resizeChildId;
        }
        const targetUid = (rootId << 16) | childId;
        interfaces.push({
            targetUid,
            groupId: dest.groupId,
            type: 1, // Overlay type
            postScripts: dest.postScripts,
        });
    }

    // Tab interfaces - mounted at their container UIDs (children 76-89)
    // For resizable mode (161), enum_1137 maps tab index to container component:
    // Index 0 (Combat):    161:76, interface 593
    // Index 1 (Skills):    161:77, interface 320
    // Index 2 (Quest):     161:78, interface 629
    // Index 3 (Inventory): 161:79, interface 149
    // Index 4 (Equipment): 161:80, interface 387
    // Index 5 (Prayer):    161:81, interface 541
    // Index 6 (Magic):     161:82, interface 218
    // Index 7 (Clan):      161:83, interface 7
    // Index 8 (Account):   161:84, interface 109
    // Index 9 (Social):    161:85, interface 429
    // Index 10 (Logout):   161:86, interface 182
    // Index 11 (Settings): 161:87, interface 116
    // Index 12 (Emotes):   161:88, interface 216
    // Index 13 (Music):    161:89, interface 239
    //
    // Note: Bank/shop side panels mount to sidemodal (child 74), which hides all tabs
    // via script 1213. When bank/shop closes, tabs reappear because sidemodal is empty.

    for (const mapping of TAB_INTERFACE_MAPPINGS) {
        // In tutorial mode, only include the Quest tab
        if (options?.tutorialMode && mapping.tabIndex !== QUEST_TAB_INDEX) {
            continue;
        }

        const targetUid = (rootId << 16) | mapping.childId;
        interfaces.push({
            targetUid,
            groupId: mapping.groupId,
            type: 1, // Overlay type
        });
    }

    return interfaces;
}

/**
 * Get the tab interfaces that should be opened when the tutorial completes.
 * These are all tabs except Quest (which is already open).
 */
export function getRemainingTabInterfaces(displayMode: DisplayMode): InterfaceMount[] {
    const rootId = getRootInterfaceId(displayMode);
    const interfaces: InterfaceMount[] = [];

    for (const mapping of TAB_INTERFACE_MAPPINGS) {
        // Skip Quest tab - it's already open
        if (mapping.tabIndex === QUEST_TAB_INDEX) continue;

        const targetUid = (rootId << 16) | mapping.childId;
        interfaces.push({
            targetUid,
            groupId: mapping.groupId,
            type: 1, // Overlay type
        });
    }

    return interfaces;
}
