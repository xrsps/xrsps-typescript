import type { WebSocket } from "ws";

import type { TickFrame } from "../../game/tick/TickPhaseOrchestrator";
import { encodeMessage } from "../messages";
import type { BroadcastContext, BroadcastDomain } from "./BroadcastDomain";

/**
 * Broadcasts chat messages to players.
 *
 * In binary player sync mode, player public chat is carried by the
 * PublicChat update block instead of the standalone `chat` message.
 */
export class ChatBroadcaster implements BroadcastDomain {
    private forEachPlayer: ((fn: (sock: WebSocket, playerId?: number) => void) => void) | undefined;

    constructor(forEachPlayer?: (fn: (sock: WebSocket) => void) => void) {
        this.forEachPlayer = forEachPlayer;
    }

    setForEachPlayer(fn: (callback: (sock: WebSocket) => void) => void): void {
        this.forEachPlayer = fn;
    }

    flush(frame: TickFrame, ctx: BroadcastContext): void {
        if (!frame.chatMessages || frame.chatMessages.length === 0) return;

        for (const msg of frame.chatMessages) {
            // In binary player sync mode, player public chat is carried by the
            // PublicChat update block instead of the standalone `chat` message.
            if (msg.messageType === "public" && msg.playerId !== undefined && !msg.standalone) {
                continue;
            }

            const encoded = encodeMessage({
                type: "chat",
                payload: {
                    messageType: msg.messageType === "private" ? "private_in" : msg.messageType,
                    playerId: msg.playerId,
                    from: msg.from,
                    prefix: msg.prefix,
                    text: msg.text,
                    chatType: msg.chatType,
                },
            });

            if (msg.targetPlayerIds && msg.targetPlayerIds.length > 0) {
                for (const targetId of msg.targetPlayerIds) {
                    ctx.sendWithGuard(ctx.getSocketByPlayerId(targetId), encoded, "chat_direct");
                }
            } else if (this.forEachPlayer) {
                this.forEachPlayer((sock) => ctx.sendWithGuard(sock, encoded, "chat_broadcast"));
            }
        }
    }
}
