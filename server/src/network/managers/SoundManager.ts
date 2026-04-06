/**
 * SoundManager - Handles sound effects, music, and jingles.
 *
 * Extracted from wsServer.ts for better organization and testability.
 * Uses a service interface pattern to avoid circular dependencies.
 */
import {
    MUSIC_GROUP_ID,
    MUSIC_JUKEBOX_CHILD_ID,
    MUSIC_JUKEBOX_ROW_FLAGS,
    MUSIC_NOW_PLAYING_FLAGS,
    MUSIC_NOW_PLAYING_TEXT_UID,
} from "../../../../src/shared/ui/music";
import { MISS_SOUND, getHitSoundForStyle, getMissSound } from "../../game/combat/WeaponDataProvider";
import type { NpcSoundType } from "../../audio/NpcSoundLookup";
import type { PlayerState } from "../../game/player";

/** Default sound IDs */
const DEFAULT_HIT_SOUND = 1979;
const DEFAULT_MISS_SOUND = MISS_SOUND;
// Unarmed (no weapon equipped): style-specific hit sounds.
const UNARMED_KICK_SOUND = 2565; // unarmed_kick
const UNARMED_PUNCH_SOUND = 2566; // unarmed_punch
const DEFAULT_MAGIC_SPLASH_SOUND = 227;
const NPC_ATTACK_SOUND = 2549;
const DEFAULT_NPC_DEATH_SOUND = 512;

/** Magic weapon category IDs for spell sound selection */
const MAGIC_WEAPON_CATEGORY_IDS = new Set([18, 24, 29, 31]);

/** Sound broadcast request */
export interface SoundBroadcastRequest {
    soundId: number;
    x: number;
    y: number;
    level: number;
    delay?: number;
    radius?: number;
    volume?: number;
}

/** Loc sound request */
export interface LocSoundRequest {
    soundId: number;
    tile: { x: number; y: number };
    level?: number;
    delay?: number;
    loops?: number;
    radius?: number;
    volume?: number;
}

/** Area sound request */
export interface AreaSoundRequest {
    soundId: number;
    x: number;
    y: number;
    level?: number;
    radius?: number;
    volume?: number;
}

/** Tick frame for music phase */
export interface TickFrameRef {
    tick: number;
}

/** NPC Sound lookup reference */
export interface NpcSoundLookupRef {
    getSoundForNpc(npcType: any, soundType: NpcSoundType): number | undefined;
}

/** Music region service reference */
export interface MusicRegionServiceRef {
    getMusicForRegion(regionId: number): { trackId: number; trackName: string } | undefined;
}

export interface MusicCatalogTrackRef {
    rowId: number;
    trackId: number;
    trackName: string;
}

/** Music catalog service reference */
export interface MusicCatalogServiceRef {
    getBaseTrackCount(): number;
    getBaseListTrackBySlot(slot: number): MusicCatalogTrackRef | undefined;
    getTrackByMidiId(trackId: number): MusicCatalogTrackRef | undefined;
    getTrackByName(trackName: string): MusicCatalogTrackRef | undefined;
    getTrackByRowId(rowId: number): MusicCatalogTrackRef | undefined;
}

/** Music unlock service reference */
export interface MusicUnlockServiceRef {
    isTrackUnlocked(player: PlayerState, trackId: number): boolean;
    unlockTrack(player: PlayerState, trackId: number): boolean;
    getUnlockVarpId(trackId: number): number | undefined;
    shouldShowUnlockMessage(player: PlayerState): boolean;
    initializeDefaults(player: PlayerState): void;
}

/** NPC type loader reference */
export interface NpcTypeLoaderRef {
    load(id: number): any | undefined;
}

/** DB repository reference */
export interface DbRepositoryRef {
    getRows(tableId: number): Iterable<any>;
}

/** Player collection reference */
export interface PlayerCollectionRef {
    forEach(callback: (sock: any, player: PlayerState) => void): void;
    getSocketByPlayerId(playerId: number): any | undefined;
}

/** WebSocket reference */
export interface WebSocketRef {
    readyState: number;
    send(data: string): void;
}

/** Services required by SoundManager */
export interface SoundManagerServices {
    /** Get players collection */
    getPlayers(): PlayerCollectionRef | undefined;
    /** Get NPC sound lookup */
    getNpcSoundLookup(): NpcSoundLookupRef | undefined;
    /** Get music region service */
    getMusicRegionService(): MusicRegionServiceRef | undefined;
    /** Get music catalog service */
    getMusicCatalogService(): MusicCatalogServiceRef | undefined;
    /** Get music unlock service */
    getMusicUnlockService(): MusicUnlockServiceRef | undefined;
    /** Get NPC type loader */
    getNpcTypeLoader(): NpcTypeLoaderRef | undefined;
    /** Get DB repository */
    getDbRepository(): DbRepositoryRef | undefined;
    /** Get weapon data map */
    getWeaponData(): Map<number, { hitSound?: number; missSound?: number }>;
    /** Ensure equipment array for player */
    ensureEquipArray(player: PlayerState): number[];
    /** Get current tick */
    getCurrentTick(): number;
    /** Random source */
    random(): number;
    /** VARP for music play mode */
    getVarpMusicPlay(): number;
    /** VARP for current music DB row */
    getVarpMusicCurrentTrack(): number;
    /** Send message with guard */
    sendWithGuard(sock: any, message: Uint8Array, context: string): void;
    /** Encode message to binary */
    encodeMessage(msg: { type: string; payload: any }): Uint8Array;
    /** Queue chat message */
    queueChatMessage(request: {
        messageType: string;
        text: string;
        targetPlayerIds: number[];
    }): void;
    /** Queue a clientscript */
    queueClientScript?(playerId: number, scriptId: number, ...args: (number | string)[]): void;
    /** Queue varp update */
    queueVarp(playerId: number, varpId: number, value: number): void;
    /** Broadcast to nearby players */
    broadcastToNearby(
        x: number,
        y: number,
        level: number,
        radius: number,
        message: string | Uint8Array,
        context: string,
    ): void;
    /** Execute with direct send bypass */
    withDirectSendBypass(context: string, fn: () => void): void;
    /** Get NPC combat defs and defaults */
    getNpcCombatDefs(): Record<string, { deathSound?: number }> | undefined;
    getNpcCombatDefaults(): { deathSound: number };
    /** Load NPC combat defs if needed */
    loadNpcCombatDefs(): void;
    /** Log a message */
    log(level: "info" | "warn" | "error" | "debug", message: string): void;
}

/**
 * Manager for sound effects, music, and jingles.
 */
export class SoundManager {
    constructor(private readonly services: SoundManagerServices) {}

    /**
     * Enqueue a sound broadcast to nearby players.
     */
    enqueueSoundBroadcast(soundId: number, x: number, y: number, level: number): void {
        this.services.withDirectSendBypass("broadcast", () =>
            this.broadcastSound({ soundId, x, y, level }, "sound"),
        );
    }

    /**
     * Send a sound effect to a specific player.
     */
    sendSound(
        player: PlayerState,
        soundId: number,
        opts?: { delay?: number; loops?: number },
    ): void {
        const sock = this.services.getPlayers()?.getSocketByPlayerId(player.id);
        if (!sock) return;
        const payload: { soundId: number; delay?: number; loops?: number } = {
            soundId: soundId,
        };
        if (opts?.delay !== undefined && opts.delay > 0) {
            payload.delay = opts.delay;
        }
        if (opts?.loops !== undefined && opts.loops > 0) {
            payload.loops = opts.loops;
        }
        this.services.withDirectSendBypass("sound", () =>
            this.services.sendWithGuard(
                sock,
                this.services.encodeMessage({ type: "sound", payload }),
                "sound",
            ),
        );
    }

    /**
     * Send a jingle (short music fanfare) to a player.
     */
    sendJingle(player: PlayerState, jingleId: number, delay: number = 0): void {
        const sock = this.services.getPlayers()?.getSocketByPlayerId(player.id);
        if (!sock) return;
        this.services.withDirectSendBypass("play_jingle", () =>
            this.services.sendWithGuard(
                sock,
                this.services.encodeMessage({
                    type: "play_jingle",
                    payload: {
                        jingleId: jingleId,
                        delay: Math.max(0, Math.min(0xffffff, delay)),
                    },
                }),
                "play_jingle",
            ),
        );
    }

    /**
     * Broadcast a sound to nearby players.
     */
    broadcastSound(payload: SoundBroadcastRequest, context = "sound", radiusTiles = 15): void {
        if (!payload || !(payload.soundId > 0)) return;
        const players = this.services.getPlayers();
        if (!players) return;

        const x = payload.x;
        const y = payload.y;
        const level = payload.level;

        // Build the message payload, including SOUND_AREA fields if present
        const msgPayload: {
            soundId: number;
            x: number;
            y: number;
            level: number;
            delay?: number;
            radius?: number;
            volume?: number;
        } = {
            soundId: payload.soundId,
            x,
            y,
            level,
        };

        // Include delay if specified (in milliseconds)
        if (payload.delay !== undefined && payload.delay > 0) {
            msgPayload.delay = payload.delay;
        }
        // SOUND_AREA: Include radius/volume if specified
        if (payload.radius !== undefined) {
            msgPayload.radius = Math.max(0, Math.min(15, payload.radius));
        }
        if (payload.volume !== undefined) {
            msgPayload.volume = Math.max(0, Math.min(255, payload.volume));
        }

        const message = this.services.encodeMessage({ type: "sound", payload: msgPayload });
        this.services.broadcastToNearby(x, y, level, radiusTiles, message, context);
    }

    /**
     * Play a sound at a specific location.
     */
    playLocSound(opts: LocSoundRequest): void {
        if (!opts || !(opts.soundId > 0)) return;

        const msgPayload: {
            soundId: number;
            x: number;
            y: number;
            level: number;
            delay?: number;
            loops?: number;
            radius?: number;
            volume?: number;
        } = {
            soundId: opts.soundId,
            x: opts.tile.x,
            y: opts.tile.y,
            level: opts.level ?? 0,
        };

        if (opts.delay !== undefined && opts.delay > 0) {
            msgPayload.delay = opts.delay;
        }
        if (opts.loops !== undefined && opts.loops > 0) {
            msgPayload.loops = opts.loops;
        }

        // SOUND_AREA fields
        if (opts.radius !== undefined) {
            msgPayload.radius = Math.max(0, Math.min(15, opts.radius));
        }
        if (opts.volume !== undefined) {
            msgPayload.volume = Math.max(0, Math.min(255, opts.volume));
        }

        this.services.withDirectSendBypass("script_loc_sound", () =>
            this.broadcastSound(msgPayload as SoundBroadcastRequest, "script_loc_sound"),
        );
    }

    /**
     * Play an area sound with radius and volume.
     */
    playAreaSound(opts: AreaSoundRequest): void {
        if (!opts || !(opts.soundId > 0)) return;

        const x = opts.x;
        const y = opts.y;
        const level = opts.level ?? 0;

        const msgPayload: {
            soundId: number;
            x: number;
            y: number;
            level: number;
            radius?: number;
            volume?: number;
        } = {
            soundId: opts.soundId,
            x,
            y,
            level,
        };

        // SOUND_AREA: radius is 0-15 tiles
        if (opts.radius !== undefined) {
            msgPayload.radius = Math.max(0, Math.min(15, opts.radius));
        }

        // SOUND_AREA: volume is 0-255
        if (opts.volume !== undefined) {
            msgPayload.volume = Math.max(0, Math.min(255, opts.volume));
        }

        this.services.withDirectSendBypass("area_sound", () =>
            this.broadcastSound(msgPayload as SoundBroadcastRequest, "area_sound"),
        );
    }

    /**
     * Play a song for a player.
     */
    playSongForPlayer(player: PlayerState, trackId: number, trackName?: string): void {
        const sock = this.services.getPlayers()?.getSocketByPlayerId(player.id);
        if (!sock) return;
        const resolvedTrack = this.resolveMusicTrack(trackId, trackName);
        const resolvedTrackName = resolvedTrack?.trackName ?? trackName;
        const currentTrackRowId = resolvedTrack?.rowId ?? -1;

        player.varps.setLastPlayedMusicTrackId(trackId);
        player.varps.setVarpValue(this.services.getVarpMusicCurrentTrack(), currentTrackRowId);

        const msg = this.services.encodeMessage({
            type: "play_song",
            payload: {
                trackId: trackId,
                //  default 
                fadeOutDelay: 0,
                fadeOutDuration: 100,
                fadeInDelay: 100,
                fadeInDuration: 0,
            },
        });

        this.services.withDirectSendBypass("play_song", () => {
            this.services.sendWithGuard(sock, msg, "play_song");
        });

        // Send varp for music_current_track (DB row id)
        this.services.withDirectSendBypass("varp", () =>
            this.services.sendWithGuard(
                sock,
                this.services.encodeMessage({
                    type: "varp",
                    payload: {
                        varpId: this.services.getVarpMusicCurrentTrack(),
                        value: currentTrackRowId,
                    },
                }),
                "varp",
            ),
        );

        // Send IF_SETTEXT for widget 239:4 (NOW_PLAYING_TEXT)
        if (resolvedTrackName) {
            this.services.withDirectSendBypass("if_settext", () =>
                this.services.sendWithGuard(
                    sock,
                    this.services.encodeMessage({
                        type: "widget",
                        payload: {
                            action: "set_text",
                            uid: MUSIC_NOW_PLAYING_TEXT_UID,
                            text: resolvedTrackName,
                        },
                    }),
                    "if_settext",
                ),
            );
        }

        if (currentTrackRowId >= 0) {
            this.services.queueClientScript?.(player.id, 3932);
        }
    }

    handleMusicModeChange(player: PlayerState, previousMode: number, nextMode: number): void {
        if (previousMode === nextMode || nextMode !== 0) {
            return;
        }

        this.playCurrentAreaTrackForPlayer(player);
    }

    handleMusicVolumeChange(player: PlayerState, previousVolume: number, nextVolume: number): void {
        if (previousVolume > 0 || nextVolume <= 0) {
            return;
        }

        const currentTrack = this.resolveCurrentMusicTrack(player);
        if (currentTrack) {
            this.playSongForPlayer(player, currentTrack.trackId, currentTrack.trackName);
            return;
        }

        if (player.varps.getVarpValue(this.services.getVarpMusicPlay()) === 0) {
            this.playCurrentAreaTrackForPlayer(player);
        }
    }

    skipTrackForPlayer(player: PlayerState): boolean {
        if (player.varps.getVarpValue(this.services.getVarpMusicPlay()) !== 1) {
            return false;
        }

        const nextTrack = this.pickNextShuffleTrack(player);
        if (!nextTrack) {
            return false;
        }

        this.playSongForPlayer(player, nextTrack.trackId, nextTrack.trackName);
        return true;
    }

    syncMusicInterfaceForPlayer(player: PlayerState): void {
        this.syncMusicWidgetFlags(player);

        const currentTrack = this.resolveCurrentMusicTrack(player);
        if (!currentTrack) {
            player.varps.setVarpValue(this.services.getVarpMusicCurrentTrack(), -1);
            if (player.varps.getVarpValue(this.services.getVarpMusicPlay()) === 0) {
                this.playCurrentAreaTrackForPlayer(player);
                return;
            }
            this.syncCurrentMusicUi(player, -1, " ");
            return;
        }

        player.varps.setVarpValue(this.services.getVarpMusicCurrentTrack(), currentTrack.rowId);
        this.syncCurrentMusicUi(player, currentTrack.rowId, currentTrack.trackName);
    }

    /**
     * Run music phase for all players.
     */
    runMusicPhase(frame: TickFrameRef): void {
        const players = this.services.getPlayers();
        const musicRegionService = this.services.getMusicRegionService();
        if (!players || !musicRegionService) return;

        players.forEach((sock, player) => {
            try {
                const currentRegionId = this.getRegionId(player.tileX, player.tileY);
                const lastRegionId = player.varps.getLastMusicRegionId();

                if (currentRegionId !== lastRegionId) {
                    player.varps.setLastMusicRegionId(currentRegionId);

                    const trackInfo = musicRegionService.getMusicForRegion(currentRegionId);

                    if (trackInfo) {
                        const musicUnlockService = this.services.getMusicUnlockService();
                        if (musicUnlockService) {
                            const wasNewlyUnlocked = musicUnlockService.unlockTrack(
                                player,
                                trackInfo.trackId,
                            );

                            if (wasNewlyUnlocked) {
                                this.syncMusicUnlockVarps(player, trackInfo.trackId);

                                if (musicUnlockService.shouldShowUnlockMessage(player)) {
                                    this.services.queueChatMessage({
                                        messageType: "game",
                                        text: `You have unlocked a new music track: <col=ff0000>${trackInfo.trackName}</col>.`,
                                        targetPlayerIds: [player.id],
                                    });
                                }
                            }
                        }

                        // Only auto-play if in Area mode (varp = 0)
                        const musicMode = player.varps.getVarpValue(this.services.getVarpMusicPlay());
                        if (musicMode === 0) {
                            this.playCurrentAreaTrackForPlayer(player, trackInfo);
                        }
                    }
                }
            } catch {
                // Ignore errors in music phase
            }
        });
    }

    /**
     * Sync music unlock varps after unlocking a track.
     */
    syncMusicUnlockVarps(player: PlayerState, trackId: number): void {
        const varpId = this.services.getMusicUnlockService()?.getUnlockVarpId(trackId);
        if (varpId !== undefined) {
            const value = player.varps.getVarpValue(varpId);
            this.services.queueVarp(player.id, varpId, value);
        }
    }

    /**
     * Get region ID from tile coordinates.
     */
    private getRegionId(tileX: number, tileY: number): number {
        return ((tileX >> 6) << 8) | (tileY >> 6);
    }

    private playCurrentAreaTrackForPlayer(
        player: PlayerState,
        trackInfo?: { trackId: number; trackName: string },
    ): void {
        const musicRegionService = this.services.getMusicRegionService();
        if (!musicRegionService) return;

        const nextTrack =
            trackInfo ??
            musicRegionService.getMusicForRegion(this.getRegionId(player.tileX, player.tileY));
        if (!nextTrack || nextTrack.trackId === player.varps.getLastPlayedMusicTrackId()) {
            return;
        }

        this.playSongForPlayer(player, nextTrack.trackId, nextTrack.trackName);
    }

    private resolveCurrentMusicTrack(player: PlayerState): MusicCatalogTrackRef | undefined {
        const musicCatalog = this.services.getMusicCatalogService();
        if (!musicCatalog) {
            return undefined;
        }

        const currentTrackRowId = player.varps.getVarpValue(this.services.getVarpMusicCurrentTrack());
        if (currentTrackRowId >= 0) {
            const trackByRow = musicCatalog.getTrackByRowId(currentTrackRowId);
            if (trackByRow) {
                return trackByRow;
            }
        }

        const lastTrackId = player.varps.getLastPlayedMusicTrackId();
        if (lastTrackId >= 0) {
            return musicCatalog.getTrackByMidiId(lastTrackId);
        }

        return undefined;
    }

    private resolveMusicTrack(
        trackId: number,
        trackName?: string,
    ): MusicCatalogTrackRef | undefined {
        const musicCatalog = this.services.getMusicCatalogService();
        if (!musicCatalog) {
            return undefined;
        }

        return (
            musicCatalog.getTrackByMidiId(trackId) ??
            (trackName ? musicCatalog.getTrackByName(trackName) : undefined)
        );
    }

    private pickNextShuffleTrack(player: PlayerState): MusicCatalogTrackRef | undefined {
        const musicCatalog = this.services.getMusicCatalogService();
        if (!musicCatalog) {
            return undefined;
        }

        const unlockService = this.services.getMusicUnlockService();
        const currentTrackId = player.varps.getLastPlayedMusicTrackId();
        const unlockedTracks: MusicCatalogTrackRef[] = [];

        for (let slot = 0; slot < musicCatalog.getBaseTrackCount(); slot++) {
            const track = musicCatalog.getBaseListTrackBySlot(slot);
            if (!track) {
                continue;
            }
            if (unlockService && !unlockService.isTrackUnlocked(player, track.trackId)) {
                continue;
            }
            unlockedTracks.push(track);
        }

        if (unlockedTracks.length === 0) {
            return undefined;
        }

        const alternateTracks = unlockedTracks.filter((track) => track.trackId !== currentTrackId);
        const candidates = alternateTracks.length > 0 ? alternateTracks : unlockedTracks;
        if (candidates.length === 1 && candidates[0]?.trackId === currentTrackId) {
            return undefined;
        }

        const random = Math.max(0, Math.min(0.999999999999, this.services.random()));
        return candidates[Math.floor(random * candidates.length)];
    }

    private syncMusicWidgetFlags(player: PlayerState): void {
        const sock = this.services.getPlayers()?.getSocketByPlayerId(player.id);
        if (!sock) {
            return;
        }

        const musicCatalog = this.services.getMusicCatalogService();
        const baseTrackCount = musicCatalog?.getBaseTrackCount() ?? 0;
        if (baseTrackCount > 0) {
            this.services.withDirectSendBypass("if_setevents", () =>
                this.services.sendWithGuard(
                    sock,
                    this.services.encodeMessage({
                        type: "widget",
                        payload: {
                            action: "set_flags_range",
                            uid: (MUSIC_GROUP_ID << 16) | MUSIC_JUKEBOX_CHILD_ID,
                            fromSlot: 0,
                            toSlot: baseTrackCount - 1,
                            flags: MUSIC_JUKEBOX_ROW_FLAGS,
                        },
                    }),
                    "if_setevents",
                ),
            );
        }

        this.services.withDirectSendBypass("if_setevents", () =>
            this.services.sendWithGuard(
                sock,
                this.services.encodeMessage({
                    type: "widget",
                    payload: {
                        action: "set_flags",
                        uid: MUSIC_NOW_PLAYING_TEXT_UID,
                        flags: MUSIC_NOW_PLAYING_FLAGS,
                    },
                }),
                "if_setevents",
            ),
        );
    }

    private syncCurrentMusicUi(player: PlayerState, trackRowId: number, trackName: string): void {
        const sock = this.services.getPlayers()?.getSocketByPlayerId(player.id);
        if (!sock) {
            return;
        }

        this.services.withDirectSendBypass("varp", () =>
            this.services.sendWithGuard(
                sock,
                this.services.encodeMessage({
                    type: "varp",
                    payload: {
                        varpId: this.services.getVarpMusicCurrentTrack(),
                        value: trackRowId,
                    },
                }),
                "varp",
            ),
        );

        this.services.withDirectSendBypass("if_settext", () =>
            this.services.sendWithGuard(
                sock,
                this.services.encodeMessage({
                    type: "widget",
                    payload: {
                        action: "set_text",
                        uid: MUSIC_NOW_PLAYING_TEXT_UID,
                        text: trackName,
                    },
                }),
                "if_settext",
            ),
        );

        this.services.queueClientScript?.(player.id, 3932);
    }

    /**
     * Pick combat sound based on weapon and hit/miss.
     */
    pickCombatSound(player: PlayerState, isHit: boolean): number {
        try {
            const spellId = player.combat.spellId ?? -1;
            const autocastEnabled = !!player.combat.autocastEnabled;
            const category = player.combat.weaponCategory ?? 0;
            const hasMagicWeapon = MAGIC_WEAPON_CATEGORY_IDS.has(category);

            // Magic spell sounds take priority
            if (spellId > 0 && autocastEnabled && hasMagicWeapon) {
                const stage: "impact" | "splash" = isHit ? "impact" : "splash";
                const spellSound = this.pickSpellSound(spellId, stage);
                if (spellSound !== undefined) return spellSound;
            }

            // Miss sound is universal
            if (!isHit) {
                return getMissSound();
            }

            // Get hit sound based on weapon and combat style
            const equip = this.services.ensureEquipArray(player);
            const weaponId = equip[14]; // EquipmentSlot.WEAPON = 14
            const styleIndex = player.combat.styleSlot ?? 0;

            if (weaponId > 0) {
                // Use attack-type-aware hit sound
                const hitSound = getHitSoundForStyle(weaponId, styleIndex);
                if (hitSound !== undefined) {
                    return hitSound;
                }
            } else {
                // unarmed punch vs kick uses different sounds by style slot.
                return styleIndex === 1 ? UNARMED_KICK_SOUND : UNARMED_PUNCH_SOUND;
            }
        } catch {
            // Ignore errors in combat sound selection
        }
        return isHit ? DEFAULT_HIT_SOUND : DEFAULT_MISS_SOUND;
    }

    /**
     * Pick spell sound based on spell ID and stage.
     */
    pickSpellSound(spellId: number, stage: "cast" | "impact" | "splash"): number | undefined {
        const castMap: Record<number, number> = {
            // Wind family
            3273: 220,
            3281: 218,
            3294: 216,
            3313: 222,
            21876: 4028,
            // Water family
            3275: 211,
            3285: 209,
            3297: 207,
            3315: 213,
            21877: 4030,
            // Earth family
            3277: 132,
            3288: 130,
            3302: 128,
            3319: 134,
            21878: 4025,
            // Fire family
            3279: 160,
            3291: 157,
            3307: 155,
            3321: 162,
            21879: 4032,
            // Debuffs
            3274: 119,
            3278: 3011,
            3282: 127,
            3324: 3009,
            3325: 148,
            3326: 3004,
            // Binding
            3283: 101,
            3300: 3003,
            3322: 151,
            // Utility
            3293: 122,
            9075: 190,
            9110: 98,
            9111: 97,
            9100: 3006,
            9076: 116,
            9077: 115,
            9078: 117,
            9079: 118,
            9001: 114,
        };

        const impactMap: Record<number, number> = {
            // Wind family
            3273: 221,
            3281: 219,
            3294: 217,
            3313: 223,
            21876: 4027,
            // Water family
            3275: 212,
            3285: 210,
            3297: 208,
            3315: 214,
            21877: 4029,
            // Earth family
            3277: 133,
            3288: 131,
            3302: 129,
            3319: 135,
            21878: 4026,
            // Fire family
            3279: 161,
            3291: 158,
            3307: 156,
            3321: 163,
            21879: 4031,
            // Debuffs
            3274: 121,
            3278: 3010,
            3282: 126,
            3324: 3008,
            3325: 150,
            3326: 3005,
            // Binding
            3283: 99,
            3300: 3002,
            3322: 153,
            // Utility
            3293: 124,
            9100: 3007,
        };

        if (stage === "cast") {
            return castMap[spellId];
        }
        if (stage === "impact") {
            return impactMap[spellId];
        }
        if (stage === "splash") {
            return DEFAULT_MAGIC_SPLASH_SOUND;
        }
        return undefined;
    }

    /**
     * Get NPC sound from Table 88.
     */
    getNpcSoundFromTable88(typeId: number, soundType: NpcSoundType): number | undefined {
        const npcSoundLookup = this.services.getNpcSoundLookup();
        const npcTypeLoader = this.services.getNpcTypeLoader();
        if (!npcSoundLookup || !npcTypeLoader) return undefined;

        try {
            const npcType = npcTypeLoader.load(typeId);
            if (!npcType) return undefined;
            return npcSoundLookup.getSoundForNpc(npcType, soundType);
        } catch {
            return undefined;
        }
    }

    /**
     * Get NPC death sound ID.
     */
    getNpcDeathSoundId(typeId: number): number | undefined {
        const table88Sound = this.getNpcSoundFromTable88(typeId, "death");
        if (table88Sound !== undefined && table88Sound > 0) {
            return table88Sound;
        }

        this.services.loadNpcCombatDefs();
        const defaults = this.services.getNpcCombatDefaults();
        const defs = this.services.getNpcCombatDefs();
        const def = defs?.[String(typeId)];
        const soundId = def?.deathSound ?? defaults.deathSound;
        return soundId > 0 ? soundId : undefined;
    }

    /**
     * Get NPC attack sound ID.
     */
    getNpcAttackSoundId(typeId: number): number {
        const table88Sound = this.getNpcSoundFromTable88(typeId, "attack");
        if (table88Sound !== undefined && table88Sound > 0) {
            return table88Sound;
        }
        return NPC_ATTACK_SOUND;
    }

    /**
     * Get NPC hit sound ID.
     */
    getNpcHitSoundId(typeId: number): number | undefined {
        const table88Sound = this.getNpcSoundFromTable88(typeId, "hit");
        if (table88Sound !== undefined && table88Sound > 0) {
            return table88Sound;
        }
        return undefined;
    }

    /**
     * Get NPC defend/block sound ID.
     */
    getNpcDefendSoundId(typeId: number): number | undefined {
        const table88Sound = this.getNpcSoundFromTable88(typeId, "defend");
        if (table88Sound !== undefined && table88Sound > 0) {
            return table88Sound;
        }
        return undefined;
    }
}
