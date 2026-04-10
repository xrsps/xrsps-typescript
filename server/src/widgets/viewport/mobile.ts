import { BaseComponentUids } from "./ViewportEnumService";
import {
    DisplayMode,
    InterfaceDestination,
    type InterfaceMount,
    getBuffBarInitPostScripts,
    getRootInterfaceId,
    getViewportEnumService,
} from "./index";

/**
 * Mobile-specific interface IDs
 */
export const MobileInterfaces = {
    OSM_HOTKEYS: 892, // osm_hotkeys - mobile hotkey bar
    POPOUT: 728, // popout - share/social buttons
    BUFF_BAR: 651, // buff_bar - status effect bar
} as const;

/**
 * Mobile-specific container child IDs in toplevel_osm (601)
 * Mappings from enum_1745: toplevel_osrs_stretch (161) -> toplevel_osm (601)
 */
export const MobileContainers = {
    USERNAME: 21, // toplevel_osm:username (enum_1745 maps 161:93 -> 601:21)
    MINIMAP_ORBS: 22, // toplevel_osm:map_orbs (enum_1745 maps 161:95 -> 601:22)
    MAINMODAL: 27, // toplevel_osm:mainmodal (enum_1745 maps 161:16 -> 601:27, size 512x334)
    XP_COUNTER: 30, // toplevel_osm:xp_counter (enum_1745 maps 161:19 -> 601:30)
    BUFF_BAR: 12, // enum_1745 maps the canonical buff_bar mount 161:6 -> 601:12
    HOTKEYS: 40, // toplevel_osm:hotkeys (mobile-only, bottom-left hotkey bar)
    SIDE_LEFT_CHAT: 41, // toplevel_osm:side_left_chat container (chat controls live here)
    CHATBOX: 49, // toplevel_osm:chatbox (enum_1745 maps 161:96 -> 601:49)
    POPOUT: 134, // toplevel_osm:popout (enum_1745 maps 161:98 -> 601:134)
    // Tab containers: 601:116-129
    TAB_COMBAT: 116,
    TAB_SKILLS: 117,
    TAB_QUEST: 118,
    TAB_INVENTORY: 119,
    TAB_EQUIPMENT: 120,
    TAB_PRAYER: 121,
    TAB_MAGIC: 122,
    TAB_CLAN: 123,
    TAB_ACCOUNT: 124,
    TAB_SOCIAL: 125,
    TAB_LOGOUT: 126,
    TAB_SETTINGS: 127,
    TAB_EMOTES: 128,
    TAB_MUSIC: 129,
} as const;

/**
 * Mobile varbits
 */
export const MobileVarbits = {
    // Desktop mobile simulation - allows desktop clients to simulate mobile mode
    OSM_SIMULATE: 6352, // osm_simulate (0=off, 1=on)
    // Mobile minimap visibility toggle
    OSM_MINIMAP_TOGGLE: 6254, // osm_minimap_toggle (0=show, 1=hide)
    // Mobile hotkey bar slots
    HOTKEY_0: 11534, // osm_hotkey_0
    HOTKEY_1: 11535, // osm_hotkey_1
    HOTKEY_2: 11536, // osm_hotkey_2
    HOTKEY_3: 11537, // osm_hotkey_3
    HOTKEY_4: 11538, // osm_hotkey_4
    HIDE_HOTKEYS: 11557, // osm_hide_hotkeys (0=show, 1=hide)
    SHOW_EMPTY_HOTKEYS: 11559, // settings_osm_hotkeys_show_empty_hotkeys
    POPOUT_MOBILE_ENABLED: 13981, // popout_panel_mobile_enabled
} as const;

// Legacy alias for backwards compatibility
export const MobileHotkeyVarbits = MobileVarbits;

/**
 * Hotkey tab indices (values for osm_hotkey_X varbits)
 * These correspond to tab indices for quick access buttons (0-indexed)
 */
export const HotkeyTabIndex = {
    EMPTY: -1, // No hotkey assigned
    COMBAT: 0,
    SKILLS: 1,
    QUEST: 2,
    INVENTORY: 3,
    EQUIPMENT: 4,
    PRAYER: 5,
    MAGIC: 6,
    CLAN: 7,
    ACCOUNT: 8,
    SOCIAL: 9,
    LOGOUT: 10,
    SETTINGS: 11,
    EMOTES: 12,
    MUSIC: 13,
} as const;

/**
 * Get the mobile child ID for a base component, using enum service if available.
 * Falls back to hardcoded MobileContainers values when service is unavailable.
 */
function getMobileChildId(baseUid: number, fallback: number): number {
    const service = getViewportEnumService();
    if (service) {
        return service.getMobileChildId(baseUid, fallback);
    }
    return fallback;
}

/**
 * Get default interfaces for mobile display mode (601 = toplevel_osm)
 * Uses enum 1745 for dynamic component lookups when ViewportEnumService is available.
 */
export function getMobileInterfaces(): InterfaceMount[] {
    const rootId = getRootInterfaceId(DisplayMode.MOBILE); // 601
    const interfaces: InterfaceMount[] = [];

    // Mobile tab container mappings: base UIDs from 161, fallback child IDs from MobileContainers
    // Enum 1745 maps 161:76-89 -> 601:116-129
    const mobileTabMappings = [
        {
            groupId: InterfaceDestination.ATTACK.interfaceId,
            baseUid: BaseComponentUids.TAB_COMBAT,
            fallback: MobileContainers.TAB_COMBAT,
        },
        {
            groupId: InterfaceDestination.SKILLS.interfaceId,
            baseUid: BaseComponentUids.TAB_SKILLS,
            fallback: MobileContainers.TAB_SKILLS,
        },
        {
            groupId: InterfaceDestination.QUEST.interfaceId,
            baseUid: BaseComponentUids.TAB_QUEST,
            fallback: MobileContainers.TAB_QUEST,
        },
        {
            groupId: InterfaceDestination.INVENTORY.interfaceId,
            baseUid: BaseComponentUids.TAB_INVENTORY,
            fallback: MobileContainers.TAB_INVENTORY,
        },
        {
            groupId: InterfaceDestination.EQUIPMENT.interfaceId,
            baseUid: BaseComponentUids.TAB_EQUIPMENT,
            fallback: MobileContainers.TAB_EQUIPMENT,
        },
        {
            groupId: InterfaceDestination.PRAYER.interfaceId,
            baseUid: BaseComponentUids.TAB_PRAYER,
            fallback: MobileContainers.TAB_PRAYER,
        },
        {
            groupId: InterfaceDestination.MAGIC.interfaceId,
            baseUid: BaseComponentUids.TAB_MAGIC,
            fallback: MobileContainers.TAB_MAGIC,
        },
        {
            groupId: InterfaceDestination.CLAN_CHAT.interfaceId,
            baseUid: BaseComponentUids.TAB_CLAN,
            fallback: MobileContainers.TAB_CLAN,
        },
        {
            groupId: InterfaceDestination.ACCOUNT_MANAGEMENT.interfaceId,
            baseUid: BaseComponentUids.TAB_ACCOUNT,
            fallback: MobileContainers.TAB_ACCOUNT,
        },
        {
            groupId: InterfaceDestination.SOCIAL.interfaceId,
            baseUid: BaseComponentUids.TAB_SOCIAL,
            fallback: MobileContainers.TAB_SOCIAL,
        },
        {
            groupId: InterfaceDestination.LOG_OUT.interfaceId,
            baseUid: BaseComponentUids.TAB_LOGOUT,
            fallback: MobileContainers.TAB_LOGOUT,
        },
        {
            groupId: InterfaceDestination.SETTINGS.interfaceId,
            baseUid: BaseComponentUids.TAB_SETTINGS,
            fallback: MobileContainers.TAB_SETTINGS,
        },
        {
            groupId: InterfaceDestination.EMOTES.interfaceId,
            baseUid: BaseComponentUids.TAB_EMOTES,
            fallback: MobileContainers.TAB_EMOTES,
        },
        {
            groupId: InterfaceDestination.MUSIC.interfaceId,
            baseUid: BaseComponentUids.TAB_MUSIC,
            fallback: MobileContainers.TAB_MUSIC,
        },
    ];

    for (const mapping of mobileTabMappings) {
        if (mapping.groupId === -1) continue;
        const childId = getMobileChildId(mapping.baseUid, mapping.fallback);
        interfaces.push({
            targetUid: (rootId << 16) | childId,
            groupId: mapping.groupId,
            type: 1, // Overlay type
        });
    }

    // Mobile chatbox (enum_1745 maps 161:96 -> 601:49)
    interfaces.push({
        targetUid:
            (rootId << 16) | getMobileChildId(BaseComponentUids.CHATBOX, MobileContainers.CHATBOX),
        groupId: InterfaceDestination.CHAT_BOX.interfaceId,
        type: 1,
    });

    // Username interface (163) (enum_1745 maps 161:93 -> 601:21)
    interfaces.push({
        targetUid:
            (rootId << 16) |
            getMobileChildId(BaseComponentUids.USERNAME, MobileContainers.USERNAME),
        groupId: InterfaceDestination.USERNAME.interfaceId,
        type: 1,
    });

    // XP Counter (122) (enum_1745 maps 161:19 -> 601:30)
    interfaces.push({
        targetUid:
            (rootId << 16) |
            getMobileChildId(BaseComponentUids.XP_DROPS, MobileContainers.XP_COUNTER),
        groupId: InterfaceDestination.XP_COUNTER.interfaceId,
        type: 1,
    });

    // Buff bar (651) (enum_1745 maps the canonical buff_bar mount 161:6 -> 601:12)
    interfaces.push({
        targetUid:
            (rootId << 16) |
            getMobileChildId(BaseComponentUids.BUFF_BAR, MobileContainers.BUFF_BAR),
        groupId: MobileInterfaces.BUFF_BAR,
        type: 1,
        postScripts: getBuffBarInitPostScripts(),
    });

    // Mobile orbs: Mount interface 160 (minimap/orbs) (enum_1745 maps 161:95 -> 601:22)
    interfaces.push({
        targetUid:
            (rootId << 16) |
            getMobileChildId(BaseComponentUids.MINIMAP_ORBS, MobileContainers.MINIMAP_ORBS),
        groupId: InterfaceDestination.MINI_MAP.interfaceId,
        type: 1,
    });

    // Mobile hotkeys (892 = osm_hotkeys) at 601:40 (mobile-only, no enum mapping)
    interfaces.push({
        targetUid: (rootId << 16) | MobileContainers.HOTKEYS,
        groupId: MobileInterfaces.OSM_HOTKEYS,
        type: 1,
        varbits: {
            [MobileVarbits.OSM_SIMULATE]: 1, // Enable mobile simulation (ON_MOBILE returns true)
            [MobileVarbits.HOTKEY_0]: HotkeyTabIndex.INVENTORY,
            [MobileVarbits.HOTKEY_1]: HotkeyTabIndex.PRAYER,
            [MobileVarbits.HOTKEY_2]: HotkeyTabIndex.MAGIC,
            [MobileVarbits.HOTKEY_3]: HotkeyTabIndex.COMBAT,
            [MobileVarbits.HOTKEY_4]: HotkeyTabIndex.EQUIPMENT,
            [MobileVarbits.SHOW_EMPTY_HOTKEYS]: 1, // Show empty hotkey slots
            [MobileVarbits.HIDE_HOTKEYS]: 0, // Don't hide hotkeys
            [MobileVarbits.OSM_MINIMAP_TOGGLE]: 0, // Show minimap (0=show, 1=hide)
        },
    });

    // Mobile popout/share interface (728 = popout) must mount to the popout container.
    // Do NOT mount to 601:41; that is the side_left_chat/chat-control container itself.
    // Enum 1745 maps 161:98 -> 601:134 in this cache.
    interfaces.push({
        targetUid:
            (rootId << 16) | getMobileChildId(BaseComponentUids.POPOUT, MobileContainers.POPOUT),
        groupId: MobileInterfaces.POPOUT,
        type: 1,
        varbits: {
            [MobileVarbits.POPOUT_MOBILE_ENABLED]: 1,
        },
    });

    return interfaces;
}
