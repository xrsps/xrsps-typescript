import { TRANSMIT_VARPS } from "../../../client/common/vars";
import type { PlayerState } from "../../src/game/player";
import { DUEL_LOBBY_BANK_CHESTS } from "./DuelLobbyScene";

// The original gameframe remains usable without admitting spell casts, equipment
// changes or arbitrary client variables into an agreed, fixed-weapon duel.
const HUD_GROUPS = new Set([116, 134, 137, 149, 160, 161, 162, 163, 164, 165,
    182, 214, 216, 239, 320, 387, 548, 593, 601, 629, 651]);
const HUD_ACTION_GROUPS = new Set([116, 134, 137, 160, 182, 214, 239, 320]);
const BANK_GROUPS = new Set([12, 15]);
const COMBAT_BUTTONS = new Set([6, 10, 14, 18, 32, 39]);

export function allowDuelClientMessage(player: PlayerState, type: string, payload: unknown,
    freeInLobby: boolean): boolean {
    const data = (payload ?? {}) as Record<string, any>;
    if (type === "chat") {
        return typeof data.text === "string" && (!data.text.trim().startsWith("::") || /^::duel(?:\s|$)/i.test(data.text.trim()));
    }
    if (type === "varp_transmit") {
        return Number.isInteger(data.varpId) && Number.isInteger(data.value) && TRANSMIT_VARPS.has(data.varpId);
    }
    if (type === "widget") {
        return data.action === "close" || (data.action === "open" && HUD_GROUPS.has(data.groupId));
    }
    if (type === "widget_action") {
        const group = Number(data.widgetId) >>> 16;
        const child = Number(data.widgetId) & 0xffff;
        if (data.groupId !== group || data.childId !== child) return false;
        if (group === 593) return COMBAT_BUTTONS.has(child);
        if (group === 387) return child === 1; // View equipment stats, never remove loaned gear.
        if (group === 216) return freeInLobby;
        if (BANK_GROUPS.has(group)) return freeInLobby && player.widgets.isOpen(12);
        return HUD_ACTION_GROUPS.has(group);
    }
    if (type === "loc_interact") {
        return freeInLobby && (data.level === undefined || data.level === 0) &&
            DUEL_LOBBY_BANK_CHESTS.some((chest) => chest.x === data.tile?.x && chest.y === data.tile?.y &&
                data.id === ("locId" in chest ? chest.locId : 10562));
    }
    if (["bank_deposit_inventory", "bank_deposit_item", "bank_move", "resume_countdialog"].includes(type)) {
        return freeInLobby && player.widgets.isOpen(12);
    }
    if (type === "if_buttond") {
        return freeInLobby && player.widgets.isOpen(12) &&
            BANK_GROUPS.has(Number(data.sourceWidgetId) >>> 16) && BANK_GROUPS.has(Number(data.targetWidgetId) >>> 16);
    }
    if (type === "inventory_move") return freeInLobby;
    if (type === "interact") return freeInLobby && data.mode === "follow";
    return ["walk", "player_attack", "logout", "ping", "keepalive", "window_status",
        "client_info", "interface_close", "if_close", "focus", "idle"].includes(type);
}
