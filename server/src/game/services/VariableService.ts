import { encodeMessage } from "../../network/messages";
import type { ServerServices } from "../ServerServices";

/**
 * Manages varp/varbit queuing for the broadcast phase.
 */
export class VariableService {
    constructor(private readonly services: ServerServices) {}

    queueVarp(playerId: number, varpId: number, value: number): void {
        const event = { playerId, varpId, value };

        const frame = this.services.activeFrame;
        if (frame) {
            frame.varps ??= [];
            frame.varps.push(event);
            return;
        }

        const ws = this.services.players?.getSocketByPlayerId(event.playerId);
        if (ws) {
            this.services.networkLayer.withDirectSendBypass("varp", () =>
                this.services.networkLayer.sendWithGuard(
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

        this.services.broadcastScheduler.queueVarp(event.playerId, event.varpId, event.value);
    }

    queueVarbit(playerId: number, varbitId: number, value: number): void {
        const event = { playerId, varbitId, value };

        const frame = this.services.activeFrame;
        if (frame) {
            frame.varbits ??= [];
            frame.varbits.push(event);
            return;
        }

        const ws = this.services.players?.getSocketByPlayerId(event.playerId);
        if (ws) {
            this.services.networkLayer.withDirectSendBypass("varbit", () =>
                this.services.networkLayer.sendWithGuard(
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

        this.services.broadcastScheduler.queueVarbit(event.playerId, event.varbitId, event.value);
    }
}
