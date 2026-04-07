import type { WebSocket } from "ws";

import type { TickFrame } from "../../game/tick/TickPhaseOrchestrator";
import type { ProjectileLaunch } from "../../../../src/shared/projectiles/ProjectileLaunch";
import { adjustProjectileLaunchesForElapsedCycles } from "../../../../src/shared/projectiles/projectileDelivery";
import { encodeMessage } from "../messages";
import type { BroadcastContext, BroadcastDomain } from "./BroadcastDomain";

export interface GamemodeSnapshotEncoder {
    encode(playerId: number, payload: unknown): { message: string | Uint8Array; context: string } | undefined;
    onSent?(playerId: number, payload: unknown): void;
}

export interface MiscBroadcasterServices {
    gamemodeSnapshotEncoders: Map<string, GamemodeSnapshotEncoder>;
    forEachPlayer(fn: (sock: WebSocket) => void): void;
}

/**
 * Broadcasts miscellaneous per-tick packets: notifications, client scripts,
 * smithing/trade UI messages, run energy, spell results, projectiles,
 * gamemode snapshots, and loc changes.
 */
export class MiscBroadcaster implements BroadcastDomain {
    constructor(private readonly services: MiscBroadcasterServices) {}

    flush(frame: TickFrame, ctx: BroadcastContext): void {
        this.flushLocChanges(frame, ctx);
        this.flushPostWidgetEvents(frame, ctx);
    }

    /**
     * Flush loc changes early in the broadcast phase (before actor state).
     */
    flushLocChanges(frame: TickFrame, ctx: BroadcastContext): void {
        if (!frame.locChanges || frame.locChanges.length === 0) return;
        for (const change of frame.locChanges) {
            ctx.broadcast(
                encodeMessage({ type: "loc_change", payload: change }),
                "loc_change",
            );
        }
    }

    /**
     * Flush everything except loc changes (notifications, client scripts,
     * smithing, trade, gamemode snapshots, run energy, spell results, projectiles).
     * Called after widget events in the broadcast phase.
     */
    flushPostWidgetEvents(frame: TickFrame, ctx: BroadcastContext): void {
        this.flushNotifications(frame, ctx);
        this.flushClientScripts(frame, ctx);
        this.flushKeyedMessages(frame, ctx);
        this.flushGamemodeSnapshots(frame, ctx);
        this.flushRunEnergy(frame, ctx);
        this.flushSpellResults(frame, ctx);
        this.flushProjectiles(frame, ctx);
    }

    private flushNotifications(frame: TickFrame, ctx: BroadcastContext): void {
        if (!frame.notifications || frame.notifications.length === 0) return;
        for (const evt of frame.notifications) {
            const sock = ctx.getSocketByPlayerId(evt.playerId);
            if (!sock) continue;
            ctx.sendWithGuard(
                sock,
                encodeMessage({ type: "notification", payload: evt.payload }),
                "notification",
            );
        }
    }

    private flushClientScripts(frame: TickFrame, ctx: BroadcastContext): void {
        if (!frame.clientScripts || frame.clientScripts.length === 0) return;
        for (const cs of frame.clientScripts) {
            const sock = ctx.getSocketByPlayerId(cs.playerId);
            if (!sock) continue;
            ctx.sendWithGuard(
                sock,
                encodeMessage({
                    type: "runClientScript",
                    payload: { scriptId: cs.scriptId, args: cs.args },
                }),
                "runClientScript",
            );
        }
    }

    private flushKeyedMessages(frame: TickFrame, ctx: BroadcastContext): void {
        if (!frame.keyedMessages || frame.keyedMessages.size === 0) return;
        for (const [key, messages] of frame.keyedMessages.entries()) {
            for (const evt of messages) {
                const sock = ctx.getSocketByPlayerId(evt.playerId);
                ctx.sendWithGuard(
                    sock,
                    encodeMessage({ type: key as any, payload: evt.payload }),
                    `${key}_event`,
                );
            }
        }
    }

    private flushGamemodeSnapshots(frame: TickFrame, ctx: BroadcastContext): void {
        if (!frame.gamemodeSnapshots) return;
        for (const [key, snapshots] of frame.gamemodeSnapshots) {
            if (snapshots.length === 0) continue;
            const encoder = this.services.gamemodeSnapshotEncoders.get(key);
            if (!encoder) continue;
            for (const snapshot of snapshots) {
                const sock = ctx.getSocketByPlayerId(snapshot.playerId);
                if (!sock) continue;
                const encoded = encoder.encode(snapshot.playerId, snapshot.payload);
                if (encoded) {
                    ctx.sendWithGuard(sock, encoded.message, encoded.context);
                }
                if (encoder.onSent) {
                    encoder.onSent(snapshot.playerId, snapshot.payload);
                }
            }
        }
    }

    private flushRunEnergy(frame: TickFrame, ctx: BroadcastContext): void {
        if (!frame.runEnergySnapshots || frame.runEnergySnapshots.length === 0) return;
        for (const snapshot of frame.runEnergySnapshots) {
            const sock = ctx.getSocketByPlayerId(snapshot.playerId);
            if (!sock) continue;
            ctx.sendWithGuard(
                sock,
                encodeMessage({
                    type: "run_energy",
                    payload: {
                        percent: snapshot.percent,
                        units: snapshot.units,
                        running: !!snapshot.running,
                    },
                }),
                "run_energy",
            );
        }
    }

    private flushSpellResults(frame: TickFrame, ctx: BroadcastContext): void {
        if (!frame.spellResults || frame.spellResults.length === 0) return;
        for (const entry of frame.spellResults) {
            const msg = encodeMessage({ type: "spell_result", payload: entry.payload });
            this.services.forEachPlayer((sock) => {
                ctx.sendWithGuard(sock, msg, "spell_result");
            });
        }
    }

    private flushProjectiles(frame: TickFrame, ctx: BroadcastContext): void {
        const packets = frame.projectilePackets as
            | Map<number, ProjectileLaunch[]>
            | undefined;
        if (!packets) return;
        const elapsedClientCycles = Math.max(0, Math.floor((Date.now() - frame.time) / 20));
        for (const [playerId, list] of packets.entries()) {
            if (!list || list.length === 0) continue;
            const sock = ctx.getSocketByPlayerId(playerId);
            if (!sock) continue;
            const launchesForSend = adjustProjectileLaunchesForElapsedCycles(
                list,
                elapsedClientCycles,
            );
            ctx.sendWithGuard(
                sock,
                encodeMessage({
                    type: "projectiles",
                    payload: { list: launchesForSend },
                }),
                "projectiles",
            );
        }
    }
}
