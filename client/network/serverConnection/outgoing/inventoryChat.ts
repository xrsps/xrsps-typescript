import { parseOutgoingPublicChat, sanitizeChatText } from "../../../common/chat/chatFormatting";
import { INVENTORY_SLOT_COUNT } from "../constants";
import type { GroundItemActionPayload } from "../types";
import { send } from "../connection/send";
import { state } from "../state";
import type { FriendsChatAction } from "../../../common/social/FriendsChat";

export function sendInventoryUse(
    slot: number,
    itemId: number,
    quantity: number = 1,
    option: string = "Use",
): void {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return;
    send({
        type: "inventory_use",
        payload: {
            slot: Math.max(0, slot | 0),
            itemId: itemId | 0,
            quantity: Math.max(0, quantity | 0),
            option,
        },
    } as any);
}

export function sendInventoryUseOn(payload: {
    slot: number;
    itemId: number;
    target:
        | { kind: "npc"; id?: number; tile?: { x: number; y: number }; plane?: number }
        | { kind: "loc"; id: number; tile?: { x: number; y: number }; plane?: number }
        | { kind: "obj"; id: number; tile?: { x: number; y: number }; plane?: number }
        | { kind: "player"; id?: number; tile?: { x: number; y: number }; plane?: number }
        | { kind: "inv"; slot: number; itemId: number };
}): void {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return;
    try {
        const clean: any = {
            slot: Math.max(0, payload.slot | 0),
            itemId: payload.itemId | 0,
        };
        const t: any = payload.target || {};
        if (t && typeof t.kind === "string") {
            clean.target = { kind: t.kind } as any;
            if (typeof t.id === "number") clean.target.id = t.id | 0;
            if (t.tile && typeof t.tile.x === "number" && typeof t.tile.y === "number") {
                clean.target.tile = { x: t.tile.x | 0, y: t.tile.y | 0 };
            }
            if (typeof t.plane === "number") clean.target.plane = t.plane | 0;
            if (t.kind === "inv") {
                clean.target.slot = Math.max(0, (t.slot as number) | 0);
                clean.target.itemId = (t.itemId as number) | 0;
            }
        }
        send({ type: "inventory_use_on", payload: clean } as any);
    } catch {}
}

export function sendInventoryMove(from: number, to: number): void {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return;
    const src = Math.max(0, Math.min(INVENTORY_SLOT_COUNT - 1, from | 0));
    const dst = Math.max(0, Math.min(INVENTORY_SLOT_COUNT - 1, to | 0));
    if (src === dst) return;
    send({ type: "inventory_move", payload: { from: src, to: dst } } as any);
}

export function sendGroundItemAction(payload: GroundItemActionPayload): void {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return;
    const clean: GroundItemActionPayload = {
        stackId: Math.max(1, payload.stackId | 0),
        itemId: payload.itemId | 0,
        tile: {
            x: Number(payload.tile?.x) | 0,
            y: Number(payload.tile?.y) | 0,
            level: Number.isFinite(payload.tile?.level) ? (payload.tile?.level as number) | 0 : 0,
        },
    };
    if (payload.quantity !== undefined) {
        clean.quantity = Math.max(1, payload.quantity | 0);
    }
    if (payload.option) {
        clean.option = String(payload.option);
    }
    send({ type: "ground_item_action", payload: clean } as any);
}

export function sendChat(
    text: string,
    messageType: "public" | "game" | "friends_chat" = "public",
    chatType: number = 0,
): void {
    console.log(`[sendChat] Attempting to send: "${text}"`);
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
        console.log("[sendChat] Socket not ready");
        return;
    }
    const filtered = sanitizeChatText(String(text ?? ""));
    if (!filtered) {
        console.log("[sendChat] Filtered text is empty");
        return;
    }

    const formatting = parseOutgoingPublicChat(filtered);
    const payloadText = formatting.text;
    if (!payloadText) {
        console.log("[sendChat] Payload text is empty after formatting");
        return;
    }

    console.log(`[sendChat] Sending to server: "${payloadText}"`);
    send({
        type: "chat",
        payload: {
            text: payloadText,
            messageType,
            chatType: chatType | 0,
            colorId: formatting.colorId | 0,
            effectId: formatting.effectId | 0,
            pattern: formatting.pattern ? Array.from(formatting.pattern) : undefined,
        },
    } as any);
}

export function sendFriendsChatAction(payload: FriendsChatAction): void {
    send({ type: "friends_chat_action", payload } as any);
}
