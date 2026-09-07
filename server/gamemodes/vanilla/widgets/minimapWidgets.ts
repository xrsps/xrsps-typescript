import { VARBIT_XPDROPS_ENABLED } from "../../../../client/common/vars";
import type { PlayerState } from "../../../src/game/player";
import {
    DisplayMode,
    type IScriptRegistry,
    type InterfaceMount,
    type ScriptServices,
} from "../../../src/game/scripts/types";
import {
    MINIMAP_WIDGET_GROUP_ID,
    ORBS_NOMAP_GROUP_ID,
    VARBIT_MINIMAP_TOGGLE,
    WORLD_MAP_ORB_WIDGET_IDS,
    createOrbsBootstrapActions,
    getMapClockValue,
    getMinimapToggleVarbits,
    getOrbsMountUid,
    rewriteMinimapOrbsMount,
} from "../../../src/widgets/minimapOrbs";
import {
    FLOATER_BLANKMODAL_GROUP_ID,
    SCRIPT_WORLDMAP_TRANSMIT_DATA,
    WORLD_MAP_CLOSE_WIDGET_ID,
    WORLD_MAP_GROUP_ID,
    closeWorldMapInterfaces,
    getWorldMapTransmitDataArgs,
} from "../../../src/widgets/worldMapInterfaces";

function getXpCounterMountUid(displayMode: number): number {
    // DisplayMode enum:
    // 0 = FIXED, 1 = RESIZABLE_NORMAL, 2 = RESIZABLE_LIST, 3 = FULLSCREEN, 4 = MOBILE
    if (displayMode === 0) {
        return (548 << 16) | 17;
    }
    if (displayMode === 2) {
        return (164 << 16) | 7;
    }
    if (displayMode === 3) {
        return (165 << 16) | 7;
    }
    if (displayMode === 4) {
        return (601 << 16) | 30;
    }
    return (161 << 16) | 7;
}

const XP_DROPS_ORB_COMPONENT_ID = 6;
const XP_DROPS_SETUP_GROUP_ID = 137;
const XP_DROPS_ORB_WIDGET_ID = (MINIMAP_WIDGET_GROUP_ID << 16) | XP_DROPS_ORB_COMPONENT_ID;
const WORLD_MAP_TOGGLES_UID = (WORLD_MAP_GROUP_ID << 16) | 21;
const WORLD_MAP_TOGGLES_LAST_SLOT = 4;
const IF_SETEVENTS_TRANSMIT_OP1 = 1 << 1;
const VARBIT_BUSY = 12393;
const ROOT_FULLSCREEN_GROUP_ID = 165;
const FULLSCREEN_DISPLAY_MODAL_UID = (ROOT_FULLSCREEN_GROUP_ID << 16) | 40;
const FULLSCREEN_FLOATER_UID = (ROOT_FULLSCREEN_GROUP_ID << 16) | 41;

const FULLSCREEN_TARGET_CHILD_BY_GROUP = new Map<number, number>([
    [162, 2],
    [122, 12],
    [160, 34],
    [163, 33],
    [651, 7],
    [593, 17],
    [320, 18],
    [629, 19],
    [149, 20],
    [387, 21],
    [541, 22],
    [218, 23],
    [7, 24],
    [707, 24],
    [109, 25],
    [429, 26],
    [182, 27],
    [116, 28],
    [216, 29],
    [239, 30],
]);

function normalizeDisplayMode(displayMode: number | undefined): DisplayMode {
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

function getRootGroupId(displayMode: DisplayMode): number {
    switch (displayMode) {
        case DisplayMode.FIXED:
            return 548;
        case DisplayMode.RESIZABLE_LIST:
            return 164;
        case DisplayMode.FULLSCREEN:
            return ROOT_FULLSCREEN_GROUP_ID;
        case DisplayMode.MOBILE:
            return 601;
        case DisplayMode.RESIZABLE_NORMAL:
        default:
            return 161;
    }
}

function getWorldMapFloaterUid(displayMode: DisplayMode): number {
    if (displayMode === DisplayMode.FULLSCREEN) {
        return FULLSCREEN_FLOATER_UID;
    }
    return (getRootGroupId(displayMode) << 16) | 18;
}

function queueRunScript(
    services: ScriptServices,
    playerId: number,
    scriptId: number,
    args: (number | string)[],
): void {
    services.dialog.queueWidgetEvent(playerId, {
        action: "run_script",
        scriptId,
        args,
    });
}

function queueWorldMapOpenScript(player: PlayerState, services: ScriptServices): void {
    queueRunScript(
        services,
        player.id,
        SCRIPT_WORLDMAP_TRANSMIT_DATA,
        getWorldMapTransmitDataArgs(player),
    );
}

function queueWorldMapToggleEvents(player: PlayerState, services: ScriptServices): void {
    services.dialog.queueWidgetEvent(player.id, {
        action: "set_flags_range",
        uid: WORLD_MAP_TOGGLES_UID,
        fromSlot: 0,
        toSlot: WORLD_MAP_TOGGLES_LAST_SLOT,
        flags: IF_SETEVENTS_TRANSMIT_OP1,
    });
}

function queueOrbsBootstrap(player: PlayerState, services: ScriptServices, groupId: number): void {
    const mapClock = getMapClockValue(player.varps, services.system.getCurrentTick());
    for (const action of createOrbsBootstrapActions(groupId, mapClock)) {
        services.dialog.queueWidgetEvent(player.id, action);
    }
}

function getFullscreenRemounts(services: ScriptServices): InterfaceMount[] {
    const mounts = services.viewport.getDefaultInterfaces(DisplayMode.RESIZABLE_NORMAL) ?? [];
    return mounts.map((mount) => {
        const childId = FULLSCREEN_TARGET_CHILD_BY_GROUP.get(mount.groupId);
        if (childId === undefined) {
            return mount;
        }
        return {
            ...mount,
            targetUid: (ROOT_FULLSCREEN_GROUP_ID << 16) | childId,
        };
    });
}

function remountFullscreenGameframe(player: PlayerState, services: ScriptServices): void {
    const interfaceService = services.dialog.getInterfaceService();
    const closedEntries = player.widgets.closeAll({ silent: true });
    if (closedEntries.length > 0) {
        interfaceService?.triggerCloseHooksForEntries(player, closedEntries);
    }

    services.dialog.queueWidgetEvent(player.id, {
        action: "set_root",
        groupId: ROOT_FULLSCREEN_GROUP_ID,
    });
    player.displayMode = DisplayMode.FULLSCREEN;

    const xpDropsEnabled = player.varps.getVarbitValue(VARBIT_XPDROPS_ENABLED) === 1;
    const minimapToggleValue = player.varps.getVarbitValue(VARBIT_MINIMAP_TOGGLE);
    for (const mount of getFullscreenRemounts(services)) {
        const intf = rewriteMinimapOrbsMount(mount, DisplayMode.FULLSCREEN, minimapToggleValue);
        const hideXpCounterOnOpen = intf.groupId === 122 && !xpDropsEnabled;
        services.dialog.openSubInterface(player, intf.targetUid, intf.groupId, intf.type, {
            postScripts: intf.postScripts,
            varps: intf.varps,
            varbits:
                mount.groupId === MINIMAP_WIDGET_GROUP_ID
                    ? getMinimapToggleVarbits(minimapToggleValue)
                    : intf.varbits,
            hiddenUids: hideXpCounterOnOpen ? [intf.targetUid] : undefined,
            modal: false,
        });
        if (mount.groupId === MINIMAP_WIDGET_GROUP_ID) {
            queueOrbsBootstrap(player, services, intf.groupId);
        }
    }
}

function closeOrbsInterfaces(player: PlayerState, services: ScriptServices): void {
    const closedEntries = [
        ...player.widgets.close(MINIMAP_WIDGET_GROUP_ID),
        ...player.widgets.close(ORBS_NOMAP_GROUP_ID),
    ];
    if (closedEntries.length > 0) {
        services.dialog.getInterfaceService()?.triggerCloseHooksForEntries(player, closedEntries);
    }
}

function openFloatingWorldMap(player: PlayerState, services: ScriptServices): void {
    const displayMode = normalizeDisplayMode(player.displayMode);
    const floaterUid = getWorldMapFloaterUid(displayMode);

    if (closeWorldMapInterfaces(player, services.dialog.getInterfaceService())) {
        return;
    }

    queueWorldMapOpenScript(player, services);
    services.dialog.openSubInterface(player, floaterUid, WORLD_MAP_GROUP_ID, 1, { modal: false });
    queueWorldMapToggleEvents(player, services);
}

function openFullscreenWorldMap(player: PlayerState, services: ScriptServices): void {
    player.varps.setVarbitValue(VARBIT_BUSY, 1);
    services.variables.queueVarbit?.(player.id, VARBIT_BUSY, 1);

    remountFullscreenGameframe(player, services);
    queueWorldMapOpenScript(player, services);
    services.dialog.openSubInterface(
        player,
        FULLSCREEN_DISPLAY_MODAL_UID,
        FLOATER_BLANKMODAL_GROUP_ID,
        0,
    );
    services.dialog.openSubInterface(player, FULLSCREEN_FLOATER_UID, WORLD_MAP_GROUP_ID, 1, {
        modal: false,
    });
    queueWorldMapToggleEvents(player, services);
}

function toggleMinimap(player: PlayerState, services: ScriptServices): void {
    const current = player.varps.getVarbitValue(VARBIT_MINIMAP_TOGGLE);
    const next = current === 1 ? 0 : 1;
    const groupId = next === 1 ? ORBS_NOMAP_GROUP_ID : MINIMAP_WIDGET_GROUP_ID;
    const displayMode = normalizeDisplayMode(player.displayMode);

    player.varps.setVarbitValue(VARBIT_MINIMAP_TOGGLE, next);
    services.variables.queueVarbit?.(player.id, VARBIT_MINIMAP_TOGGLE, next);

    closeOrbsInterfaces(player, services);
    services.dialog.openSubInterface(player, getOrbsMountUid(displayMode), groupId, 1, {
        modal: false,
        varbits: getMinimapToggleVarbits(next),
    });
    queueOrbsBootstrap(player, services, groupId);
}

/**
 * Minimap widget module.
 *
 * Run orb / special attack orb toggles are handled via varp_transmit.
 * XP drops orb (160:6) uses:
 * - OP1: Show/Hide (toggle varbit 4702 + hide/show XP counter mount)
 * - OP2: Setup (open XP drops setup modal 137)
 */
export function registerMinimapWidgetHandlers(
    registry: IScriptRegistry,
    services: ScriptServices,
): void {
    // Prevent double-toggle when the same click is dispatched through both
    // primary and widget-action paths in the same server tick.
    const lastToggleTickByPlayerId = new Map<number, number>();
    // Prevent duplicate modal opens in the same tick for OP2.
    const lastSetupTickByPlayerId = new Map<number, number>();
    const lastWorldMapFloatingTickByPlayerId = new Map<number, number>();
    const lastWorldMapFullscreenTickByPlayerId = new Map<number, number>();
    const lastMinimapToggleTickByPlayerId = new Map<number, number>();
    const lastWorldMapCloseTickByPlayerId = new Map<number, number>();

    // Minimap XP drops orb (160:6)
    registry.registerWidgetAction({
        widgetId: XP_DROPS_ORB_WIDGET_ID,
        opId: 1,
        handler: ({ player, tick }) => {
            // The client-side op script updates the orb/menu state immediately.
            // Server mirrors authoritative state and controls XP counter visibility.
            const pid = player.id;
            const currentTick = tick;
            const lastTick = lastToggleTickByPlayerId.get(pid);
            if (lastTick === currentTick) {
                return;
            }
            lastToggleTickByPlayerId.set(pid, currentTick);

            const current = player.varps.getVarbitValue(VARBIT_XPDROPS_ENABLED);
            const next = current === 1 ? 0 : 1;

            player.varps.setVarbitValue(VARBIT_XPDROPS_ENABLED, next);

            services.dialog.queueWidgetEvent(player.id, {
                action: "set_hidden",
                uid: getXpCounterMountUid(player.displayMode),
                hidden: next === 0,
            });

            services.system.logger.info?.(
                `[script:minimap-widgets] XP drops orb toggled player=${player.id} value=${next}`,
            );
        },
    });

    registry.registerWidgetAction({
        widgetId: XP_DROPS_ORB_WIDGET_ID,
        opId: 2,
        handler: ({ player, tick }) => {
            const pid = player.id;
            const currentTick = tick;
            const lastTick = lastSetupTickByPlayerId.get(pid);
            if (lastTick === currentTick) {
                return;
            }
            lastSetupTickByPlayerId.set(pid, currentTick);

            const mainmodalUid = services.viewport.getMainmodalUid(player.displayMode ?? 1);
            services.dialog.openSubInterface(player, mainmodalUid, XP_DROPS_SETUP_GROUP_ID, 0);

            services.system.logger.info?.(
                `[script:minimap-widgets] XP drops setup opened player=${player.id}`,
            );
        },
    });

    for (const worldMapOrbWidgetId of WORLD_MAP_ORB_WIDGET_IDS) {
        registry.registerWidgetAction({
            widgetId: worldMapOrbWidgetId,
            opId: 2,
            handler: ({ player, tick }) => {
                const pid = player.id;
                const lastTick = lastWorldMapFloatingTickByPlayerId.get(pid);
                if (lastTick === tick) {
                    return;
                }
                lastWorldMapFloatingTickByPlayerId.set(pid, tick);

                openFloatingWorldMap(player, services);

                services.system.logger.info?.(
                    `[script:minimap-widgets] World map floating op player=${player.id}`,
                );
            },
        });

        registry.registerWidgetAction({
            widgetId: worldMapOrbWidgetId,
            opId: 3,
            handler: ({ player, tick }) => {
                const pid = player.id;
                const lastTick = lastWorldMapFullscreenTickByPlayerId.get(pid);
                if (lastTick === tick) {
                    return;
                }
                lastWorldMapFullscreenTickByPlayerId.set(pid, tick);

                openFullscreenWorldMap(player, services);

                services.system.logger.info?.(
                    `[script:minimap-widgets] World map fullscreen opened player=${player.id}`,
                );
            },
        });

        registry.registerWidgetAction({
            widgetId: worldMapOrbWidgetId,
            opId: 4,
            handler: ({ player, tick }) => {
                const pid = player.id;
                const lastTick = lastMinimapToggleTickByPlayerId.get(pid);
                if (lastTick === tick) {
                    return;
                }
                lastMinimapToggleTickByPlayerId.set(pid, tick);

                toggleMinimap(player, services);

                services.system.logger.info?.(
                    `[script:minimap-widgets] Minimap toggled player=${player.id} value=${player.varps.getVarbitValue(
                        VARBIT_MINIMAP_TOGGLE,
                    )}`,
                );
            },
        });
    }

    registry.registerWidgetAction({
        widgetId: WORLD_MAP_CLOSE_WIDGET_ID,
        handler: ({ player, tick }) => {
            const pid = player.id;
            const lastTick = lastWorldMapCloseTickByPlayerId.get(pid);
            if (lastTick === tick) {
                return;
            }
            lastWorldMapCloseTickByPlayerId.set(pid, tick);

            closeWorldMapInterfaces(player, services.dialog.getInterfaceService());

            services.system.logger.info?.(
                `[script:minimap-widgets] World map closed player=${player.id}`,
            );
        },
    });
}
