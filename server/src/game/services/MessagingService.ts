import type { BroadcastScheduler, ChatMessageSnapshot, ForcedChatBroadcast } from "../systems/BroadcastScheduler";
import type { DataLoaderService } from "./DataLoaderService";
import { createLootPickupNotification } from "../notifications/LootPickupNotification";
import type { PlayerState } from "../player";
import type { TickFrame } from "../tick/TickPhaseOrchestrator";

export type { ChatMessageSnapshot, ForcedChatBroadcast };

export interface MessagingServiceDeps {
    getActiveFrame: () => TickFrame | undefined;
    broadcastScheduler: BroadcastScheduler;
    dataLoaders: DataLoaderService;
}

/**
 * Manages game messages, chat, notifications, and forced chat.
 * Extracted from WSServer.
 */
export class MessagingService {
    constructor(private readonly deps: MessagingServiceDeps) {}

    sendGameMessageToPlayer(player: PlayerState, text: string): void {
        this.queueChatMessage({
            messageType: "game",
            text,
            targetPlayerIds: [player.id],
        });
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
        targetPlayerIds?: number[];
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
        const frame = this.deps.getActiveFrame();
        if (frame) {
            frame.chatMessages.push(normalized);
        } else {
            this.deps.broadcastScheduler.queueChatMessage(normalized);
        }
    }

    enqueueForcedChat(event: ForcedChatBroadcast): void {
        const frame = this.deps.getActiveFrame();
        if (frame) {
            frame.forcedChats.push(event);
        } else {
            this.deps.broadcastScheduler.queueForcedChat(event);
        }
    }

    queueNotification(playerId: number, payload: any): void {
        this.deps.broadcastScheduler.queueNotification(playerId, payload);
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
        const objType = this.deps.dataLoaders.getObjType(itemId);
        const itemName = objType?.name ?? `Item ${itemId}`;
        this.queueNotification(
            player.id,
            createLootPickupNotification(itemId, itemName, quantity),
        );
    }
}
