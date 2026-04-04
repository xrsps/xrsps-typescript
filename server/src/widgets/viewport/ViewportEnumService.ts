import type { EnumTypeLoader } from "../../../../src/rs/config/enumtype/EnumTypeLoader";
import { DisplayMode } from "./index";

/**
 * Enum IDs used for display mode component mapping.
 * These enums map component UIDs between different toplevel interfaces.
 */
export const ViewportEnumIds = {
    /** Maps toplevel_osrs_stretch (161) -> toplevel_osm (601) for mobile */
    MOBILE: 1745,
    /** Maps to toplevel (548) for fixed mode */
    FIXED: 1129,
    /** Maps to toplevel_osrs_stretch (161) for resizable mode */
    RESIZABLE: 1130,
    /** Maps to toplevel_pre_eoc (164) for resizable list mode */
    RESIZABLE_LIST: 1131,
    /** Maps to toplevel_display (165) for fullscreen mode */
    FULLSCREEN: 1132,
} as const;

/**
 * Base component UIDs from toplevel_osrs_stretch (161).
 * These are the "canonical" UIDs that get mapped to other display modes via enums.
 */
export const BaseComponentUids = {
    // Core containers
    MAINMODAL: (161 << 16) | 16, // toplevel_osrs_stretch:mainmodal
    VIEWPORT_TRACKER_BACK: (161 << 16) | 15,
    VIEWPORT_TRACKER_FRONT: (161 << 16) | 17,
    MAINMODAL_BACKGROUNDS: (161 << 16) | 18,
    XP_DROPS: (161 << 16) | 19,
    HUD_CONTAINER_BACK: (161 << 16) | 20,
    HUD_CONTAINER_FRONT: (161 << 16) | 21,

    // Minimap area
    MINIMAP_AREA: (161 << 16) | 30,
    MAP_MINIMAP: (161 << 16) | 31,
    COMPASSCLICK: (161 << 16) | 33,
    GAMEFRAME: (161 << 16) | 34,

    // Side panels
    SIDE_PANELS: (161 << 16) | 35,
    SIDE_MENU: (161 << 16) | 36,
    SIDE_BACKGROUND: (161 << 16) | 37,
    SIDE2: (161 << 16) | 38,

    // HUD elements
    BUFF_BAR: (161 << 16) | 6,
    STAT_BOOSTS_HUD: (161 << 16) | 43,
    HPBAR_HUD: (161 << 16) | 44,
    OVERLAY_ATMOSPHERE: (161 << 16) | 46,
    NOTIFICATIONS: (161 << 16) | 48,
    GRAVESTONE: (161 << 16) | 49,
    // FIXED: pvp_icons is component 3, not 50 (10551299 from cs2-data/learned-components.json)
    PVP_ICONS: (161 << 16) | 3,
    MULTIWAY_ICON: (161 << 16) | 51,
    DEBUG: (161 << 16) | 53,
    HELPER: (161 << 16) | 54,
    HELPER_DODGER: (161 << 16) | 55,
    HELPER_CONTENT: (161 << 16) | 56,

    // Chat area
    CHAT_CONTAINER: (161 << 16) | 58,
    PM_CONTAINER: (161 << 16) | 60,
    FLOATER: (161 << 16) | 66,
    MOUSEOVER: (161 << 16) | 67,

    // Side modal containers
    SIDEMODAL: (161 << 16) | 74,
    SIDECRM: (161 << 16) | 75,

    // Tab containers (indices 0-13)
    TAB_COMBAT: (161 << 16) | 76,
    TAB_SKILLS: (161 << 16) | 77,
    TAB_QUEST: (161 << 16) | 78,
    TAB_INVENTORY: (161 << 16) | 79,
    TAB_EQUIPMENT: (161 << 16) | 80,
    TAB_PRAYER: (161 << 16) | 81,
    TAB_MAGIC: (161 << 16) | 82,
    TAB_CLAN: (161 << 16) | 83,
    TAB_ACCOUNT: (161 << 16) | 84,
    TAB_SOCIAL: (161 << 16) | 85,
    TAB_LOGOUT: (161 << 16) | 86,
    TAB_SETTINGS: (161 << 16) | 87,
    TAB_EMOTES: (161 << 16) | 88,
    TAB_MUSIC: (161 << 16) | 89,

    // Minimap/orbs area
    MAP_CONTAINER: (161 << 16) | 92,
    USERNAME: (161 << 16) | 93,
    MINIMAP_ORBS: (161 << 16) | 95,
    CHATBOX: (161 << 16) | 96,
    POPOUT: (161 << 16) | 98,
} as const;

/**
 * Service for mapping component UIDs between display modes using cache enums.
 * Matches how OSRS CS2 scripts use toplevel_getcomponents + enum lookups.
 */
export class ViewportEnumService {
    private mobileMapping: Map<number, number>;
    private enumLoader: EnumTypeLoader;

    constructor(enumTypeLoader: EnumTypeLoader) {
        this.enumLoader = enumTypeLoader;
        this.mobileMapping = this.loadEnumAsMap(ViewportEnumIds.MOBILE);

        // Log loaded mapping count for debugging
        console.log(
            `[ViewportEnumService] Loaded enum ${ViewportEnumIds.MOBILE} with ${this.mobileMapping.size} mappings`,
        );
    }

    /**
     * Get the mobile equivalent of a desktop component UID.
     * Uses enum 1745 to map toplevel_osrs_stretch (161) -> toplevel_osm (601).
     *
     * @param desktopUid - Component UID from interface 161 (or self-mapping mobile UID)
     * @returns Mobile component UID from interface 601, or original if not mapped
     */
    getMobileComponent(desktopUid: number): number {
        return this.mobileMapping.get(desktopUid) ?? desktopUid;
    }

    /**
     * Get the component UID for a specific display mode.
     * For mobile, uses enum 1745 mapping. For desktop modes, returns the base UID.
     *
     * @param baseUid - Base component UID (from interface 161)
     * @param displayMode - Target display mode
     * @returns Component UID for the specified display mode
     */
    getComponent(baseUid: number, displayMode: DisplayMode): number {
        if (displayMode === DisplayMode.MOBILE) {
            return this.getMobileComponent(baseUid);
        }
        // Desktop modes use the base 161 UIDs directly
        // (Fixed mode 548 shares the same relative positions)
        return baseUid;
    }

    /**
     * Extract the child ID from a packed widget UID.
     * @param uid - Packed widget UID ((groupId << 16) | childId)
     * @returns Child ID (lower 16 bits)
     */
    getChildId(uid: number): number {
        return uid & 0xffff;
    }

    /**
     * Extract the group/interface ID from a packed widget UID.
     * @param uid - Packed widget UID ((groupId << 16) | childId)
     * @returns Group ID (upper 16 bits)
     */
    getGroupId(uid: number): number {
        return (uid >> 16) & 0xffff;
    }

    /**
     * Check if a UID belongs to the mobile interface (601).
     */
    isMobileUid(uid: number): boolean {
        return this.getGroupId(uid) === 601;
    }

    /**
     * Get the mobile child ID for a base component, with fallback.
     * Useful when you only need the child ID for constructing UIDs.
     *
     * @param baseUid - Base component UID from interface 161
     * @param fallback - Fallback child ID if mapping not found
     * @returns Mobile child ID or fallback
     */
    getMobileChildId(baseUid: number, fallback: number): number {
        const mobileUid = this.mobileMapping.get(baseUid);
        if (mobileUid !== undefined) {
            return this.getChildId(mobileUid);
        }
        return fallback;
    }

    /**
     * Load an enum as a Map<key, value> for int-to-int enums.
     */
    private loadEnumAsMap(enumId: number): Map<number, number> {
        const map = new Map<number, number>();

        try {
            const enumType = this.enumLoader.load(enumId);
            if (!enumType) {
                console.warn(`[ViewportEnumService] Enum ${enumId} not found in cache`);
                return map;
            }

            if (!enumType.keys || !enumType.intValues) {
                console.warn(`[ViewportEnumService] Enum ${enumId} has no int mappings`);
                return map;
            }

            for (let i = 0; i < enumType.outputCount; i++) {
                map.set(enumType.keys[i], enumType.intValues[i]);
            }
        } catch (e) {
            console.error(`[ViewportEnumService] Failed to load enum ${enumId}:`, e);
        }

        return map;
    }

    /**
     * Reload the mobile mapping from cache.
     * Useful for hot-reloading cache changes.
     */
    reload(): void {
        this.mobileMapping = this.loadEnumAsMap(ViewportEnumIds.MOBILE);
        console.log(
            `[ViewportEnumService] Reloaded enum ${ViewportEnumIds.MOBILE} with ${this.mobileMapping.size} mappings`,
        );
    }
}
