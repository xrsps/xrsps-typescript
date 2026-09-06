import type { ServerServices } from "../ServerServices";
import { ChatMessageType } from "../../../../client/common/chat/ChatMessageType";
import { createLootPickupNotification } from "../notifications/LootPickupNotification";
import type { PlayerState } from "../player";
import type { ChatMessageSnapshot, ForcedChatBroadcast } from "../systems/BroadcastScheduler";

export type { ChatMessageSnapshot, ForcedChatBroadcast };

/**
 * Manages game messages, chat, notifications, and forced chat.
 */
export class MessagingService {
    constructor(private readonly services: ServerServices) {}

    sendGameMessageToPlayer(player: PlayerState, text: string): void {
        this.queueChatMessage({
            messageType: "game",
            text,
            targetPlayerIds: [player.id],
        });
    }

    /** Sends an OSRS clickable trade request with the initiating player's identity. */
    sendTradeRequestToPlayer(target: PlayerState, from: PlayerState, fromName: string): void {
        const sender = this.cleanChatSender(fromName, from.id);
        target.pendingTradeRequests.set(from.id, Date.now());
        this.queueChatMessage({
            messageType: "trade",
            chatType: ChatMessageType.TRADE_REQUEST,
            // Type 101 chat scripts combine this text with `from`; do not put
            // the name in the text or decorate the sender field.
            text: "wishes to trade with you.",
            from: sender,
            playerId: from.id,
            targetPlayerIds: [target.id],
        });
    }

    private cleanChatSender(name: string, playerId: number): string {
        const raw = String(name ?? "")
            .replace(/<[^>]*>/g, "")
            .trim();
        return raw.length > 0 ? raw : `player${playerId}`;
    }

    queueChatMessage(message: {
        messageType: string;
        playerId?: number;
        from?: string;
        prefix?: string;
        text: string;
        playerType?: number;
        colorId?: number;
        effectId?: number;
        pattern?: number[];
        autoChat?: boolean;
        chatType?: number;
        targetPlayerIds?: number[];
        standalone?: boolean;
    }): void {
        const normalized: ChatMessageSnapshot = {
            ...message,
            messageType:
                message.messageType === "public" ||
                message.messageType === "server" ||
                message.messageType === "private"
                    ? message.messageType
                    : "game",
        };
        const frame = this.services.activeFrame;
        if (frame) {
            frame.chatMessages.push(normalized);
        } else {
            this.services.broadcastScheduler.queueChatMessage(normalized);
        }
    }

    enqueueForcedChat(event: ForcedChatBroadcast): void {
        const frame = this.services.activeFrame;
        if (frame) {
            frame.forcedChats.push(event);
        } else {
            this.services.broadcastScheduler.queueForcedChat(event);
        }
    }

    queueNotification(playerId: number, payload: Record<string, unknown>): void {
        this.services.broadcastScheduler.queueNotification(playerId, payload);
    }

    queuePlayerGameMessage(player: PlayerState, text: string | undefined): void {
        const trimmed = typeof text === "string" ? text.trim() : "";
        if (trimmed.length === 0) return;
        this.queueChatMessage({
            messageType: "game",
            text: trimmed,
            targetPlayerIds: [player.id],
        });
    }

    sendLootNotification(player: PlayerState, itemId: number, quantity: number): void {
        const objType = this.services.dataLoaderService.getObjType(itemId);
        const itemName = objType?.name ?? `Item ${itemId}`;
        this.queueNotification(player.id, createLootPickupNotification(itemId, itemName, quantity));
    }
}
