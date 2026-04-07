import { VARBIT_XPDROPS_ENABLED } from "../../../../src/shared/vars";
import { type IScriptRegistry, type ScriptServices, DisplayMode } from "../../../src/game/scripts/types";

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

const MINIMAP_WIDGET_GROUP_ID = 160;
const XP_DROPS_ORB_COMPONENT_ID = 6;
const XP_DROPS_SETUP_GROUP_ID = 137;
const XP_DROPS_ORB_WIDGET_ID = (MINIMAP_WIDGET_GROUP_ID << 16) | XP_DROPS_ORB_COMPONENT_ID;

/**
 * Minimap widget module.
 *
 * Run orb / special attack orb toggles are handled via varp_transmit.
 * XP drops orb (160:6) uses:
 * - OP1: Show/Hide (toggle varbit 4702 + hide/show XP counter mount)
 * - OP2: Setup (open XP drops setup modal 137)
 */
export function registerMinimapWidgetHandlers(registry: IScriptRegistry, services: ScriptServices): void {
    // Prevent double-toggle when the same click is dispatched through both
    // primary and widget-action paths in the same server tick.
    const lastToggleTickByPlayerId = new Map<number, number>();
    // Prevent duplicate modal opens in the same tick for OP2.
    const lastSetupTickByPlayerId = new Map<number, number>();

    // Minimap XP drops orb (160:6)
    registry.registerWidgetAction({
        widgetId: XP_DROPS_ORB_WIDGET_ID,
        opId: 1,
        handler: ({ player, tick }) => {
            // OSRS CS2: orbs_xpdrops_op already runs client-side for OP1 and updates
            // the orb/menu state immediately. Server mirrors authoritative state and
            // controls XP counter visibility.
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

            services.queueWidgetEvent?.(player.id, {
                action: "set_hidden",
                uid: getXpCounterMountUid(player.displayMode),
                hidden: next === 0,
            });

            services.logger?.info?.(
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

            const mainmodalUid = services.getMainmodalUid!(player.displayMode ?? 1);
            services.openSubInterface?.(player, mainmodalUid, XP_DROPS_SETUP_GROUP_ID, 0);

            services.logger?.info?.(
                `[script:minimap-widgets] XP drops setup opened player=${player.id}`,
            );
        },
    });
}
