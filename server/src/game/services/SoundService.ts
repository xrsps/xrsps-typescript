import type { WebSocket } from "ws";

import { encodeMessage } from "../../network/messages";
import type { PlayerNetworkLayer } from "../../network/PlayerNetworkLayer";
import type { MusicCatalogService } from "../../audio/MusicCatalogService";
import type { PlayerState } from "../player";

export interface SoundServiceDeps {
    networkLayer: PlayerNetworkLayer;
    soundManager: any;
    musicCatalogService: MusicCatalogService | undefined;
    getSocketByPlayerId: (id: number) => WebSocket | undefined;
    getCurrentTick: () => number;
    enqueueSpotAnimation: (anim: any) => void;
    broadcastSound: (payload: any, context: string) => void;
}

/**
 * Manages sound effects, jingles, loc graphics/sounds, area sounds, and music track lookup.
 * Extracted from WSServer.
 */
export class SoundService {
    constructor(private readonly deps: SoundServiceDeps) {}

    playLocGraphic(opts: {
        spotId: number;
        tile: { x: number; y: number };
        level?: number;
        height?: number;
        delayTicks?: number;
    }): void {
        if (!opts || !(opts.spotId > 0)) return;
        const delay = opts.delayTicks !== undefined ? Math.max(0, opts.delayTicks) : 0;
        const tick = this.deps.getCurrentTick();
        this.deps.enqueueSpotAnimation({
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
        const payload: any = { soundId: opts.soundId };
        if (opts.tile) {
            payload.x = opts.tile.x;
            payload.y = opts.tile.y;
        }
        if (opts.level !== undefined) payload.level = opts.level;
        if (opts.loops !== undefined) payload.loops = Math.max(0, opts.loops);
        if (opts.delayMs !== undefined) payload.delay = Math.max(0, opts.delayMs);
        if (opts.radius !== undefined && opts.radius > 0) {
            payload.radius = Math.min(15, Math.max(0, opts.radius));
        }
        if (opts.volume !== undefined && opts.volume < 255) {
            payload.volume = Math.min(255, Math.max(0, opts.volume));
        }
        this.deps.networkLayer.withDirectSendBypass("script_loc_sound", () =>
            this.deps.broadcastSound(payload, "script_loc_sound"),
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
        const payload: any = {
            soundId: opts.soundId,
            x: opts.tile.x,
            y: opts.tile.y,
        };
        if (opts.level !== undefined) payload.level = opts.level;
        if (opts.radius !== undefined && opts.radius > 0) {
            payload.radius = Math.min(15, Math.max(0, opts.radius));
        }
        if (opts.volume !== undefined && opts.volume < 255) {
            payload.volume = Math.min(255, Math.max(0, opts.volume));
        }
        if (opts.delay !== undefined && opts.delay > 0) {
            payload.delay = opts.delay * 600;
        }
        this.deps.networkLayer.withDirectSendBypass("area_sound", () =>
            this.deps.broadcastSound(payload, "area_sound"),
        );
    }

    sendSound(player: PlayerState, soundId: number, opts?: { delay?: number; loops?: number }): void {
        this.deps.soundManager.sendSound(player, soundId, opts);
    }

    sendJingle(player: PlayerState, jingleId: number, delay: number = 0): void {
        const sock = this.deps.getSocketByPlayerId(player.id);
        if (!sock || jingleId < 0) return;
        this.deps.networkLayer.withDirectSendBypass("jingle", () =>
            this.deps.networkLayer.sendWithGuard(
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
        return this.deps.musicCatalogService?.getTrackByName(trackName)?.trackId ?? -1;
    }
}
