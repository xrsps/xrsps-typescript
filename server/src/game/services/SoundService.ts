import { encodeMessage } from "../../network/messages";
import type { SoundBroadcastRequest } from "../../network/managers/SoundManager";
import type { PlayerState } from "../player";
import type { ServerServices } from "../ServerServices";

export class SoundService {
    constructor(private readonly services: ServerServices) {}

    playLocGraphic(opts: {
        spotId: number;
        tile: { x: number; y: number };
        level?: number;
        height?: number;
        delayTicks?: number;
    }): void {
        if (!opts || !(opts.spotId > 0)) return;
        const delay = opts.delayTicks !== undefined ? Math.max(0, opts.delayTicks) : 0;
        const tick = this.services.ticker.currentTick();
        this.services.broadcastService.enqueueSpotAnimation({
            tick,
            spotId: opts.spotId,
            delay,
            height: opts.height,
            tile: { x: opts.tile.x, y: opts.tile.y, level: opts.level ?? 0 },
        });
    }

    playLocSound(opts: {
        soundId: number;
        tile?: { x: number; y: number };
        level?: number;
        loops?: number;
        delayMs?: number;
        radius?: number;
        volume?: number;
    }): void {
        if (!opts || !(opts.soundId > 0)) return;
        const payload: SoundBroadcastRequest = {
            soundId: opts.soundId,
            x: opts.tile?.x ?? 0,
            y: opts.tile?.y ?? 0,
            level: opts.level ?? 0,
        };
        if (opts.loops !== undefined) Object.assign(payload, { loops: Math.max(0, opts.loops) });
        if (opts.delayMs !== undefined) payload.delay = Math.max(0, opts.delayMs);
        if (opts.radius !== undefined && opts.radius > 0) {
            payload.radius = Math.min(15, Math.max(0, opts.radius));
        }
        if (opts.volume !== undefined && opts.volume < 255) {
            payload.volume = Math.min(255, Math.max(0, opts.volume));
        }
        this.services.networkLayer.withDirectSendBypass("script_loc_sound", () =>
            this.services.broadcastService.broadcastSound(payload, "script_loc_sound"),
        );
    }

    playAreaSound(opts: {
        soundId: number;
        tile: { x: number; y: number };
        level?: number;
        radius?: number;
        volume?: number;
        delay?: number;
    }): void {
        if (!opts || !(opts.soundId > 0)) return;
        const payload: SoundBroadcastRequest = {
            soundId: opts.soundId,
            x: opts.tile.x,
            y: opts.tile.y,
            level: opts.level ?? 0,
        };
        if (opts.radius !== undefined && opts.radius > 0) {
            payload.radius = Math.min(15, Math.max(0, opts.radius));
        }
        if (opts.volume !== undefined && opts.volume < 255) {
            payload.volume = Math.min(255, Math.max(0, opts.volume));
        }
        if (opts.delay !== undefined && opts.delay > 0) {
            payload.delay = opts.delay * 600;
        }
        this.services.networkLayer.withDirectSendBypass("area_sound", () =>
            this.services.broadcastService.broadcastSound(payload, "area_sound"),
        );
    }

    sendSound(player: PlayerState, soundId: number, opts?: { delay?: number; loops?: number }): void {
        this.services.soundManager!.sendSound(player, soundId, opts);
    }

    sendJingle(player: PlayerState, jingleId: number, delay: number = 0): void {
        const sock = this.services.players?.getSocketByPlayerId(player.id);
        if (!sock || jingleId < 0) return;
        this.services.networkLayer.withDirectSendBypass("jingle", () =>
            this.services.networkLayer.sendWithGuard(
                sock,
                encodeMessage({
                    type: "play_jingle",
                    payload: {
                        jingleId,
                        delay: Math.max(0, Math.min(0xffffff, delay)),
                    },
                }),
                "jingle",
            ),
        );
    }

    getMusicTrackIdByName(trackName: string): number {
        return this.services.musicCatalogService?.getTrackByName(trackName)?.trackId ?? -1;
    }
}
