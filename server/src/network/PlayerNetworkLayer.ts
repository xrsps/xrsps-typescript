import { WebSocket } from "ws";

import { logger } from "../utils/logger";

export interface PlayerSocketLookup {
    getSocketByPlayerId(playerId: number): WebSocket | undefined;
    forEach(fn: (player: any) => void): void;
}

/**
 * Manages low-level message sending, batching, and direct-send guards.
 * Extracted from WSServer to isolate network transport concerns.
 */
export class PlayerNetworkLayer {
    private messageBatches = new Map<WebSocket, Uint8Array[]>();
    private enableMessageBatching = true;
    private isBroadcastPhase = false;
    private directSendBypassDepth = 0;
    private directSendWarningContexts = new Set<string>();
    private pendingDirectSends = new Map<
        WebSocket,
        { message: string | Uint8Array; context: string }
    >();

    setBroadcastPhase(active: boolean): void {
        this.isBroadcastPhase = active;
    }

    getIsBroadcastPhase(): boolean {
        return this.isBroadcastPhase;
    }

    withDirectSendBypass<T>(context: string, fn: () => T): T {
        this.directSendBypassDepth++;
        try {
            return fn();
        } finally {
            this.directSendBypassDepth = Math.max(0, this.directSendBypassDepth - 1);
        }
    }

    assertDirectSendAllowed(context: string): void {
        if (this.isBroadcastPhase || this.directSendBypassDepth > 0) return;
        if (this.directSendWarningContexts.has(context)) return;
        this.directSendWarningContexts.add(context);
        logger.warn(`[direct-send] ${context} invoked outside broadcast phase`);
    }

    sendWithGuard(
        sock: WebSocket | undefined,
        message: string | Uint8Array,
        context: string,
    ): void {
        if (!sock || sock.readyState !== WebSocket.OPEN) return;
        this.assertDirectSendAllowed(context);

        if (this.enableMessageBatching && this.isBroadcastPhase && message instanceof Uint8Array) {
            let batch = this.messageBatches.get(sock);
            if (!batch) {
                batch = [];
                this.messageBatches.set(sock, batch);
            }
            batch.push(message);
            return;
        }

        try {
            sock.send(message);
        } catch (err) {
            logger.warn(`[direct-send] send failed (${context})`, err);
        }
    }

    flushMessageBatch(sock: WebSocket): void {
        const batch = this.messageBatches.get(sock);
        if (!batch || batch.length === 0) return;

        this.messageBatches.delete(sock);

        if (sock.readyState !== WebSocket.OPEN) return;

        try {
            if (batch.length === 1) {
                sock.send(batch[0]);
            } else {
                const totalLength = batch.reduce((sum, msg) => sum + msg.length, 0);
                const combined = new Uint8Array(totalLength);
                let offset = 0;
                for (const msg of batch) {
                    combined.set(msg, offset);
                    offset += msg.length;
                }
                sock.send(combined);
            }
        } catch (err) {
            logger.warn(`[batch-send] flush failed`, err);
        }
    }

    flushAllMessageBatches(): void {
        for (const sock of this.messageBatches.keys()) {
            this.flushMessageBatch(sock);
        }
        this.messageBatches.clear();
    }

    queueDirectSend(
        sock: WebSocket | undefined,
        message: string | Uint8Array,
        context: string,
    ): void {
        if (!sock || sock.readyState !== WebSocket.OPEN) return;
        if (this.pendingDirectSends.size > 512) {
            this.pendingDirectSends.clear();
        }
        this.pendingDirectSends.set(sock, { message, context });
    }

    flushDirectSendWarnings(stage: string): void {
        if (this.directSendWarningContexts.size === 0) return;
        const contexts = Array.from(this.directSendWarningContexts);
        this.directSendWarningContexts.clear();
        const summary = `[direct-send] contexts outside broadcast phase during ${stage}: ${contexts.join(
            ", ",
        )}`;
        const strictEnv = process.env.DIRECT_SEND_GUARD_STRICT;
        const shouldThrow =
            strictEnv === "1" ||
            (strictEnv !== "0" && (process.env.NODE_ENV ?? "development") !== "production");
        if (shouldThrow) {
            throw new Error(summary);
        }
        logger.error(summary);
    }

    sendAdminResponse(ws: WebSocket, message: string | Uint8Array, context: string): void {
        this.withDirectSendBypass(context, () => this.sendWithGuard(ws, message, context));
    }
}
