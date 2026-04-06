import { WebSocket } from "ws";

import type { PlayerNetworkLayer } from "./PlayerNetworkLayer";
import type {
    BroadcastScheduler,
    ForcedMovementBroadcast,
    PendingSpotAnimation,
} from "../game/systems/BroadcastScheduler";
import type { PlayerManager } from "../game/player";
import type { SmithingServerPayload, SpellResultPayload, TradeServerPayload } from "./messages";
import { encodeMessage } from "./messages";
import { logger } from "../utils/logger";

const NPC_STREAM_RADIUS_TILES = 15;
const NPC_STREAM_EXIT_RADIUS_TILES = NPC_STREAM_RADIUS_TILES + 2;
const SOUND_BROADCAST_RADIUS_TILES = NPC_STREAM_EXIT_RADIUS_TILES;

interface TickFrameRef {
    tick: number;
    time: number;
    forcedMovements: ForcedMovementBroadcast[];
    spotAnimations: PendingSpotAnimation[];
    spellResults: Array<{ playerId: number; payload: SpellResultPayload }>;
    clientScripts?: Array<{ playerId: number; scriptId: number; args: (number | string)[] }>;
    keyedMessages: Map<string, Array<{ playerId: number; payload: any }>>;
}

export interface BroadcastServiceDeps {
    getNetworkLayer: () => PlayerNetworkLayer;
    getBroadcastScheduler: () => BroadcastScheduler;
    getPlayers: () => PlayerManager | undefined;
    getActiveFrame: () => TickFrameRef | undefined;
    getWssClients: () => Set<WebSocket>;
    getPendingDirectSends: () => Map<WebSocket, { message: string | Uint8Array; context: string }>;
}

export class BroadcastService {
    constructor(private readonly deps: BroadcastServiceDeps) {}

    broadcast(msg: string | Uint8Array, context = "broadcast"): void {
        const networkLayer = this.deps.getNetworkLayer();
        for (const client of this.deps.getWssClients()) {
            networkLayer.sendWithGuard(client, msg, context);
        }
    }

    broadcastToNearby(
        x: number,
        y: number,
        level: number,
        radius: number,
        message: string | Uint8Array,
        context = "broadcast_nearby",
    ): void {
        const players = this.deps.getPlayers();
        if (!players) return;
        const networkLayer = this.deps.getNetworkLayer();
        const broadcastRadius = Math.max(0, radius);
        players.forEach((sock, player) => {
            if (!sock || sock.readyState !== WebSocket.OPEN) return;
            if (player.level !== level) return;
            const dx = Math.abs(player.tileX - x);
            const dy = Math.abs(player.tileY - y);
            if (Math.max(dx, dy) > broadcastRadius) return;
            networkLayer.sendWithGuard(sock, message, context);
        });
    }

    broadcastSound(
        payload: {
            soundId: number;
            x?: number;
            y?: number;
            level?: number;
            loops?: number;
            delay?: number;
            radius?: number;
            volume?: number;
        },
        context = "sound",
        radiusTiles = SOUND_BROADCAST_RADIUS_TILES,
    ): void {
        if (!payload || !(payload.soundId > 0)) return;
        const hasPosition =
            payload.x !== undefined &&
            payload.y !== undefined &&
            Number.isFinite(payload.x) &&
            Number.isFinite(payload.y);
        const level =
            payload.level !== undefined && Number.isFinite(payload.level)
                ? payload.level
                : undefined;
        const msgPayload: {
            soundId: number;
            x?: number;
            y?: number;
            level?: number;
            loops?: number;
            delay?: number;
            radius?: number;
            volume?: number;
        } = { ...payload };
        if (level !== undefined) msgPayload.level = level;
        if (payload.radius !== undefined && payload.radius > 0) {
            msgPayload.radius = Math.min(15, Math.max(0, payload.radius));
        }
        if (payload.volume !== undefined && payload.volume < 255) {
            msgPayload.volume = Math.min(255, Math.max(0, payload.volume));
        }
        const msg = encodeMessage({
            type: "sound",
            payload: msgPayload,
        });
        const players = this.deps.getPlayers();
        const networkLayer = this.deps.getNetworkLayer();
        if (!hasPosition || !players) {
            this.broadcast(msg, context);
            return;
        }
        const px = payload.x as number;
        const py = payload.y as number;
        const broadcastRadius = Math.max(0, radiusTiles);
        players.forEach((sock, p) => {
            if (!sock || sock.readyState !== WebSocket.OPEN) return;
            if (level !== undefined && p.level !== level) return;
            const dx = Math.abs(p.tileX - px);
            const dy = Math.abs(p.tileY - py);
            if (Math.max(dx, dy) > broadcastRadius) return;
            networkLayer.sendWithGuard(sock, msg, context);
        });
    }

    queueBroadcastSound(
        payload: {
            soundId: number;
            x: number;
            y: number;
            level: number;
            loops?: number;
            delay?: number;
            radius?: number;
            volume?: number;
        },
        context = "sound",
        radiusTiles = SOUND_BROADCAST_RADIUS_TILES,
    ): void {
        const players = this.deps.getPlayers();
        if (!payload || !(payload.soundId > 0) || !players) return;
        const msgPayload: {
            soundId: number;
            x: number;
            y: number;
            level: number;
            loops?: number;
            delay?: number;
            radius?: number;
            volume?: number;
        } = { ...payload };
        if (payload.radius !== undefined && payload.radius > 0) {
            msgPayload.radius = Math.min(15, Math.max(0, payload.radius));
        }
        if (payload.volume !== undefined && payload.volume < 255) {
            msgPayload.volume = Math.min(255, Math.max(0, payload.volume));
        }
        const message = encodeMessage({
            type: "sound",
            payload: msgPayload,
        });
        const broadcastRadius = Math.max(0, radiusTiles);
        players.forEach((sock, player) => {
            if (!sock || sock.readyState !== WebSocket.OPEN) return;
            if (player.level !== payload.level) return;
            const dx = Math.abs(player.tileX - payload.x);
            const dy = Math.abs(player.tileY - payload.y);
            if (Math.max(dx, dy) > broadcastRadius) return;
            this.queueDirectSend(sock, message, context);
        });
    }

    broadcastTick(frame: { tick: number; time: number }): void {
        const msg = encodeMessage({
            type: "tick",
            payload: { tick: frame.tick, time: frame.time },
        });
        const networkLayer = this.deps.getNetworkLayer();
        networkLayer.withDirectSendBypass("tick_broadcast", () => this.broadcast(msg, "tick"));
    }

    enqueueSoundBroadcast(soundId: number, x: number, y: number, level: number): void {
        const networkLayer = this.deps.getNetworkLayer();
        networkLayer.withDirectSendBypass("broadcast", () =>
            this.broadcastSound({ soundId, x, y, level }, "sound"),
        );
    }

    queueDirectSend(
        sock: WebSocket | undefined,
        message: string | Uint8Array,
        context: string,
    ): void {
        if (!sock || sock.readyState !== WebSocket.OPEN) return;
        const pendingDirectSends = this.deps.getPendingDirectSends();
        if (pendingDirectSends.size > 512) {
            pendingDirectSends.clear();
        }
        pendingDirectSends.set(sock, { message, context });
    }

    enqueueForcedMovement(event: ForcedMovementBroadcast): void {
        const frame = this.deps.getActiveFrame();
        if (frame) {
            frame.forcedMovements.push(event);
        } else {
            this.deps.getBroadcastScheduler().queueForcedMovement(event);
        }
    }

    enqueueSpotAnimation(event: PendingSpotAnimation): void {
        const frame = this.deps.getActiveFrame();
        if (frame) {
            frame.spotAnimations.push(event);
        } else {
            this.deps.getBroadcastScheduler().queueSpotAnimation(event);
        }
    }

    queueSpellResult(playerId: number, payload: SpellResultPayload): void {
        const frame = this.deps.getActiveFrame();
        if (frame) {
            frame.spellResults.push({ playerId, payload });
            return;
        }
        this.deps.getBroadcastScheduler().queueSpellResult(playerId, payload);
    }

    queueSmithingInterfaceMessage(playerId: number, payload: SmithingServerPayload): void {
        this.deps.getBroadcastScheduler().queueKeyedMessage("smithing", playerId, payload);
    }

    queueTradeMessage(playerId: number, payload: TradeServerPayload): void {
        this.deps.getBroadcastScheduler().queueKeyedMessage("trade", playerId, payload);
    }

    queueClientScript(
        playerId: number,
        scriptId: number,
        ...args: (number | string)[]
    ): void {
        logger.info?.(
            `[clientScript] queue player=${playerId} script=${scriptId} args=${JSON.stringify(
                args,
            )}`,
        );
        this.deps.getBroadcastScheduler().queueClientScript(playerId, scriptId, args);
    }
}
