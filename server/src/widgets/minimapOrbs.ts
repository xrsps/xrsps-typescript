import type { WidgetAction } from "./WidgetManager";
import { DisplayMode, type InterfaceMount, getRootInterfaceId } from "./viewport";

export const MINIMAP_WIDGET_GROUP_ID = 160;
export const ORBS_NOMAP_GROUP_ID = 895;
export const MINIMAP_ORBS_GROUP_IDS = [MINIMAP_WIDGET_GROUP_ID, ORBS_NOMAP_GROUP_ID] as const;
export const WORLD_MAP_ORB_COMPONENT_ID = 55;
export const ORBS_NOMAP_WORLD_MAP_ORB_COMPONENT_ID = 53;
export const WORLD_MAP_ORB_WIDGET_IDS = [
    (MINIMAP_WIDGET_GROUP_ID << 16) | WORLD_MAP_ORB_COMPONENT_ID,
    (ORBS_NOMAP_GROUP_ID << 16) | ORBS_NOMAP_WORLD_MAP_ORB_COMPONENT_ID,
] as const;
export const ORBS_TRIGGER_COMPONENT_ID = 1;
export const IF_SETEVENTS_SCRIPT_TRIGGER = 1;
export const SCRIPT_HEALTH_REGEN_TIMER = 4716;
export const SCRIPT_ORBS_TIMER = 4717;
export const SCRIPT_ORBS_REDRAW = 4722;
export const SCRIPT_SPEC_REGEN_TIMER = 4721;
export const SCRIPT_HITPOINTS_CAPE_REGEN_TIMER = 6048;
export const SCRIPT_HITPOINTS_CAPE_REGEN_TIMER_OFF = 6053;
export const VARBIT_MINIMAP_TOGGLE = 12986;
export const VARP_MAP_CLOCK = 3079;

type VarpReader = {
    getVarpValue(varpId: number): number;
};

export function normalizeDisplayMode(displayMode: number | undefined): DisplayMode {
    if (
        displayMode === DisplayMode.FIXED ||
        displayMode === DisplayMode.RESIZABLE_NORMAL ||
        displayMode === DisplayMode.RESIZABLE_LIST ||
        displayMode === DisplayMode.FULLSCREEN ||
        displayMode === DisplayMode.MOBILE
    ) {
        return displayMode;
    }
    return DisplayMode.RESIZABLE_NORMAL;
}

export function getOrbsMountUid(
    displayMode: number | undefined,
    fallbackTargetUid?: number,
): number {
    const mode = normalizeDisplayMode(displayMode);
    if (mode === DisplayMode.FULLSCREEN) {
        return (getRootInterfaceId(DisplayMode.FULLSCREEN) << 16) | 34;
    }
    if (mode === DisplayMode.RESIZABLE_NORMAL) {
        return (getRootInterfaceId(DisplayMode.RESIZABLE_NORMAL) << 16) | 33;
    }
    if (mode === DisplayMode.RESIZABLE_LIST) {
        return (getRootInterfaceId(DisplayMode.RESIZABLE_LIST) << 16) | 33;
    }
    if (mode === DisplayMode.MOBILE) {
        const mobileOrbsUid = (getRootInterfaceId(DisplayMode.MOBILE) << 16) | 22;
        return fallbackTargetUid ?? mobileOrbsUid;
    }
    return (getRootInterfaceId(DisplayMode.FIXED) << 16) | 11;
}

export function getMinimapOrbsGroupId(minimapToggleValue: number): number {
    return minimapToggleValue === 1 ? ORBS_NOMAP_GROUP_ID : MINIMAP_WIDGET_GROUP_ID;
}

export function getMinimapToggleVarbits(minimapToggleValue: number): Record<number, number> {
    return { [VARBIT_MINIMAP_TOGGLE]: minimapToggleValue === 1 ? 1 : 0 };
}

export function rewriteMinimapOrbsMount(
    mount: InterfaceMount,
    displayMode: number | undefined,
    minimapToggleValue: number,
): InterfaceMount {
    if (mount.groupId !== MINIMAP_WIDGET_GROUP_ID) {
        return mount;
    }
    return {
        ...mount,
        targetUid: getOrbsMountUid(displayMode, mount.targetUid),
        groupId: getMinimapOrbsGroupId(minimapToggleValue),
        type: 1,
    };
}

export function getMapClockValue(
    varps: VarpReader | undefined,
    fallbackTick: number | undefined,
): number {
    const mapClock = (varps?.getVarpValue(VARP_MAP_CLOCK) ?? 0) | 0;
    if (mapClock !== 0) {
        return mapClock;
    }
    return (fallbackTick ?? 0) | 0;
}

export function createOrbsBootstrapActions(groupId: number, mapClock: number): WidgetAction[] {
    return [
        {
            action: "set_flags_range",
            uid: (groupId << 16) | ORBS_TRIGGER_COMPONENT_ID,
            fromSlot: 0,
            toSlot: 0,
            flags: IF_SETEVENTS_SCRIPT_TRIGGER,
        },
        {
            action: "run_script",
            scriptId: SCRIPT_ORBS_TIMER,
            args: [mapClock],
        },
        {
            action: "run_script",
            scriptId: SCRIPT_ORBS_REDRAW,
            args: [mapClock],
        },
    ];
}
