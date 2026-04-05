import type { WebSocket } from "ws";

import { encodeMessage } from "../../network/messages";
import type { PlayerNetworkLayer } from "../../network/PlayerNetworkLayer";
import type { BroadcastScheduler } from "../../network/broadcast/BroadcastScheduler";
import type { TickFrame } from "../tick/TickPhaseOrchestrator";

export interface VariableServiceDeps {
    getActiveFrame: () => TickFrame | undefined;
    getSocketByPlayerId: (id: number) => WebSocket | undefined;
    broadcastScheduler: BroadcastScheduler;
    networkLayer: PlayerNetworkLayer;
}

/**
 * Manages varp/varbit queuing for the broadcast phase.
 * Extracted from WSServer.
 */
export class VariableService {
    constructor(private readonly deps: VariableServiceDeps) {}

    queueVarp(playerId: number, varpId: number, value: number): void {
        const event = { playerId, varpId, value };

        const frame = this.deps.getActiveFrame();
        if (frame) {
            frame.varps ??= [];
            frame.varps.push(event);
            return;
        }

        const ws = this.deps.getSocketByPlayerId(event.playerId);
        if (ws) {
            this.deps.networkLayer.withDirectSendBypass("varp", () =>
                this.deps.networkLayer.sendWithGuard(
                    ws,
                    encodeMessage({
                        type: "varp",
                        payload: { varpId: event.varpId, value: event.value },
                    }),
                    "varp",
                ),
            );
            return;
        }

        this.deps.broadcastScheduler.queueVarp(event.playerId, event.varpId, event.value);
    }

    queueVarbit(playerId: number, varbitId: number, value: number): void {
        const event = { playerId, varbitId, value };

        const frame = this.deps.getActiveFrame();
        if (frame) {
            frame.varbits ??= [];
            frame.varbits.push(event);
            return;
        }

        const ws = this.deps.getSocketByPlayerId(event.playerId);
        if (ws) {
            this.deps.networkLayer.withDirectSendBypass("varbit", () =>
                this.deps.networkLayer.sendWithGuard(
                    ws,
                    encodeMessage({
                        type: "varbit",
                        payload: { varbitId: event.varbitId, value: event.value },
                    }),
                    "varbit",
                ),
            );
            return;
        }

        this.deps.broadcastScheduler.queueVarbit(event.playerId, event.varbitId, event.value);
    }
}
