import * as pako from "pako";

import { MusicBuffer } from "../../rs/audio/music/MusicBuffer";
import { SoundTrack } from "../../rs/audio/music/SoundTrack";
import { CacheSystem } from "../../rs/cache/CacheSystem";
import { IndexType } from "../../rs/cache/IndexType";
import { copyArrayBufferLike, copyArrayBufferView } from "../../util/ArrayBufferUtil";
import { decodeOggVorbisToAudioBuffer, isOggVorbis } from "./VorbisWasm";
import { addAudioContextResumeListeners, getAudioContextConstructor } from "./audioContext";
import { RealtimeMidiSynth } from "./music/realtime/RealtimeMidiSynth";

/**
 * Callback invoked when a jingle finishes playing.
 * Used to resume area music after quest/level jingles.
 */
export type JingleEndCallback = () => void;

type OsrsFadeParams = {
    fadeOutDelayTicks: number;
    fadeOutDurationTicks: number;
    fadeInDelayTicks: number;
    fadeInDurationTicks: number;
};

type OsrsSongKind = "music" | "jingle";

type OsrsMusicSong = {
    trackId: number;
    kind: OsrsSongKind;
    synth: RealtimeMidiSynth | null;
    loaded: boolean;
    failed: boolean;
    started: boolean;
    isFading: boolean; // OSRS: MusicSong.isFading
    markedForRemoval: boolean;
    musicTrackVolumeInt: number; // 0..255 (OSRS: MusicSong.musicTrackVolume)
    pcmVolume: number; // OSRS: MusicSong.currentVolume/current stream volume
    loadPromise: Promise<boolean> | null;
};

type OsrsSongTask = {
    name: string;
    next: OsrsSongTask | null;
    error: string | null;
    didStartSong: boolean;
    run: () => boolean;
};

function errorToString(error: unknown): string {
    if (error instanceof Error && typeof error.message === "string") {
        return error.message;
    }
    return String(error);
}

export class MusicSystem {
    private cache: CacheSystem;
    private context: AudioContext | null = null;
    private currentSource: AudioBufferSourceNode | null = null;
    private htmlAudio: HTMLAudioElement | null = null;
    private htmlAudioUrl: string | null = null;
    private gainNode: GainNode | null = null;
    private volume: number = 0.5;
    private currentTrackId: number = -1;
    private isPlaying: boolean = false;
    private realtimeSynth: RealtimeMidiSynth;
    private loadSequence: number = 0; // Guard against concurrent track loads

    // Secondary track for dual playback (OSRS parity: layered music)
    private secondarySynth: RealtimeMidiSynth;
    // Third synth to match OSRS midiplayer pool (client commonly has 3 MidiPcmStreams)
    private tertiarySynth: RealtimeMidiSynth;
    private secondaryTrackId: number = -1;
    private secondaryGainNode: GainNode | null = null;

    // Jingle state - OSRS parity: jingles interrupt music, then music resumes
    private _playingJingle: boolean = false;
    private pendingAreaTrackId: number = -1; // Track to resume after jingle
    private pendingAreaTrackName: string | null = null;
    private onJingleEnd: JingleEndCallback | null = null;

    // Memory leak fix: track context resume listener cleanup and fade interval
    private contextResumeCleanup: (() => void) | null = null;
    private fadeInterval: ReturnType<typeof setInterval> | null = null;

    // MIDI manager state (mirrors SongTask queue behavior)
    private readonly osrsRequests: OsrsMusicSong[] = [];
    private readonly osrsSongs: OsrsMusicSong[] = [];
    private readonly osrsTaskQueue: OsrsSongTask[] = [];
    // OSRS parity: class319.field3466 (requested songs list, used for de-dupe)
    private osrsRequestedTrackIds: number[] = [];
    private osrsQueuedAreaTracks: number[] | null = null;
    private osrsQueuedAreaFade: OsrsFadeParams | null = null;
    private readonly osrsSynthRefCount = new Map<RealtimeMidiSynth, number>();

    // Login screen music - "Scape Main"
    // DJB2 hash from runelite: 1120933843 = "scape main"
    private static readonly LOGIN_MUSIC_NAME = "scape main";
    private static readonly LOGIN_MUSIC_HASH = 1120933843;

    constructor(cache: CacheSystem) {
        this.cache = cache;
        this.realtimeSynth = new RealtimeMidiSynth(cache);
        this.secondarySynth = new RealtimeMidiSynth(cache);
        this.tertiarySynth = new RealtimeMidiSynth(cache);

        this.osrsSynthRefCount.set(this.realtimeSynth, 0);
        this.osrsSynthRefCount.set(this.secondarySynth, 0);
        this.osrsSynthRefCount.set(this.tertiarySynth, 0);
    }

    /**
     * OSRS parity: Returns true if a jingle is currently playing.
     * When true, area music changes should be queued rather than immediate.
     */
    public get playingJingle(): boolean {
        return this._playingJingle;
    }

    /**
     * Set callback to invoke when a jingle finishes playing.
     * Used by the client to resume area music.
     */
    public setOnJingleEnd(callback: JingleEndCallback | null): void {
        this.onJingleEnd = callback;
    }

    /**
     * Store a pending track to play after jingle finishes.
     * OSRS parity: area music is queued when playingJingle is true.
     */
    public queueAreaTrack(trackId: number, trackName?: string): void {
        this.pendingAreaTrackId = trackId;
        this.pendingAreaTrackName = typeof trackName === "string" ? trackName : null;
    }

    public tick(ticks: number): void {
        const count = Math.max(0, ticks | 0);
        for (let i = 0; i < count; i++) {
            this.processOsrsMusicQueueTick();
            this.processOsrsJingleQueueTick();
        }
    }

    public getOsrsMusicDebugState(): {
        songs: {
            trackId: number;
            loaded: boolean;
            started: boolean;
            musicTrackVolumeInt: number;
            pcmVolume: number;
        }[];
        requests: { trackId: number }[];
        taskQueueLength: number;
        queuedAfterJingle: { trackIds: number[]; fades: OsrsFadeParams } | null;
    } {
        return {
            songs: this.osrsSongs.map((s) => ({
                trackId: s.trackId | 0,
                loaded: s.loaded === true,
                started: s.started === true,
                musicTrackVolumeInt: s.musicTrackVolumeInt | 0,
                pcmVolume: s.pcmVolume,
            })),
            requests: this.osrsRequests.map((s) => ({ trackId: s.trackId | 0 })),
            taskQueueLength: this.osrsTaskQueue.length | 0,
            queuedAfterJingle:
                this._playingJingle && this.osrsQueuedAreaTracks && this.osrsQueuedAreaFade
                    ? {
                          trackIds: this.osrsQueuedAreaTracks.slice(),
                          fades: { ...this.osrsQueuedAreaFade },
                      }
                    : null,
        };
    }

    /**
     * Play login screen music ("Scape Main").
     * OSRS parity: AuthenticationScheme.java plays "scape main" on the login screen.
     *
     * @returns true if music started playing
     */
    public async playLoginMusic(): Promise<boolean> {
        // Try to find "Scape Main" track by name in the cache
        // The cache index supports lookup by name via getArchiveId()
        const trackId = this.findTrackByName(MusicSystem.LOGIN_MUSIC_NAME);

        if (trackId >= 0) {
            console.log(`[MusicSystem] Playing login music (trackId=${trackId})`);
            this.playSong(trackId, 0, 0, 0, 0);
            return true;
        }

        // Fallback: Try iterating through archive name hashes
        const trackIdByHash = this.findTrackByNameHash(MusicSystem.LOGIN_MUSIC_HASH);
        if (trackIdByHash >= 0) {
            console.log(`[MusicSystem] Playing login music by hash (trackId=${trackIdByHash})`);
            this.playSong(trackIdByHash, 0, 0, 0, 0);
            return true;
        }

        console.warn("[MusicSystem] Could not find login music track");
        return false;
    }

    /**
     * Find a track ID by its name (uses DJB2 hash internally).
     * The cache index supports lookup by archive name.
     */
    private findTrackByName(name: string): number {
        try {
            const index = this.cache.getIndex(IndexType.DAT2.musicTracks);
            if (!index) return -1;

            // CacheIndex.getArchiveId() does the DJB2 hash lookup
            return index.getArchiveId(name);
        } catch (e) {
            // Ignore errors
        }
        return -1;
    }

    /**
     * Find a track ID by its name hash (DJB2).
     * Falls back to iterating archive references.
     */
    private findTrackByNameHash(nameHash: number): number {
        try {
            const index = this.cache.getIndex(IndexType.DAT2.musicTracks);
            if (!index) return -1;

            // Iterate through archive IDs and check name hashes
            const archiveIds = index.getArchiveIds();
            for (let i = 0; i < archiveIds.length; i++) {
                const archiveId = archiveIds[i];
                const ref = index.getArchiveReference(archiveId);
                if (ref && ref.nameHash === nameHash) {
                    return archiveId;
                }
            }
        } catch (e) {
            // Ignore errors
        }
        return -1;
    }

    private ensureContext() {
        if (typeof window === "undefined") return;
        const existingContext = this.context;
        if (existingContext) {
            // Resume suspended context on subsequent calls
            if (existingContext.state === "suspended") {
                existingContext.resume().catch(() => {});
            }
            return;
        }
        const AudioCtx = getAudioContextConstructor();
        if (AudioCtx) {
            const ctx = new AudioCtx();
            const gainNode = ctx.createGain();
            gainNode.gain.value = this.volume;
            gainNode.connect(ctx.destination);
            this.context = ctx;
            this.gainNode = gainNode;

            // Auto-resume on user interaction (required by browser autoplay policy)
            if (!this.contextResumeCleanup) {
                this.contextResumeCleanup = addAudioContextResumeListeners(ctx, () => {
                    this.contextResumeCleanup = null;
                });
            }
        }
    }

    private removeContextListeners(): void {
        if (this.contextResumeCleanup) {
            const cleanup = this.contextResumeCleanup;
            this.contextResumeCleanup = null;
            cleanup();
        }
    }

    public setVolume(vol: number) {
        this.volume = Math.max(0, Math.min(1, vol));
        if (this.gainNode) {
            this.gainNode.gain.value = this.volume;
        }
        // Update real-time synth volume
        this.realtimeSynth.setVolume(this.volume);
        this.secondarySynth.setVolume(this.volume);
        this.tertiarySynth.setVolume(this.volume);
        // Update secondary gain if present
        if (this.secondaryGainNode && this.context) {
            this.secondaryGainNode.gain.setValueAtTime(this.volume, this.context.currentTime);
        }

        // OSRS parity: musicTrackVolume is preference-driven; update active songs' targets.
        const newMusicTrackVolumeInt = this.getMusicTrackVolumeInt();
        for (const song of this.osrsSongs) {
            song.musicTrackVolumeInt = newMusicTrackVolumeInt;
            // OSRS parity: non-fading songs jump straight to the new preference volume,
            // while active fades keep their current stream volume and continue from there.
            song.pcmVolume = Math.max(0, Math.min(song.pcmVolume, newMusicTrackVolumeInt));
            if (!song.isFading) {
                song.pcmVolume = newMusicTrackVolumeInt;
            }
            const pcmInt = Math.max(
                0,
                Math.min(newMusicTrackVolumeInt, Math.trunc(song.pcmVolume)),
            );
            const ratio = newMusicTrackVolumeInt > 0 ? pcmInt / newMusicTrackVolumeInt : 0;
            if (!song.synth) {
                continue;
            }
            try {
                song.synth.setOutputGain(ratio);
            } catch {}
        }
    }

    /**
     * Stop/fade current music.
     * OSRS parity: MUSIC_STOP (3220) -> Actor.method2488(delay, duration)
     */
    public stopMusic(fadeOutDelayTicks: number, fadeOutDurationTicks: number): void {
        this.clearQueuedAreaSongs();
        this.pendingAreaTrackId = -1;
        this.pendingAreaTrackName = null;

        if (this._playingJingle) {
            this.stopOsrsMusicImmediate();
            return;
        }

        // OSRS: If no songs, or both are zero, stop immediately.
        if (
            this.osrsSongs.length === 0 ||
            ((fadeOutDelayTicks | 0) === 0 && (fadeOutDurationTicks | 0) === 0)
        ) {
            this.stopOsrsMusicImmediate();
            return;
        }

        this.osrsRequests.length = 0;
        this.osrsTaskQueue.length = 0;
        this.osrsRequestedTrackIds = [];

        const oldSongs = this.osrsSongs.slice();
        const songToFadeOut = this.selectOsrsFadeOutSong(oldSongs);
        if (!songToFadeOut) {
            this.stopOsrsMusicImmediate();
            return;
        }
        this.silenceOsrsSongsForReplacement(oldSongs, songToFadeOut);

        this.osrsTaskQueue.push(this.makeDelayTask(null, fadeOutDelayTicks | 0));
        this.osrsTaskQueue.push(
            this.makeFadeOutTask(
                this.makeClearSongsTask(oldSongs),
                songToFadeOut,
                fadeOutDurationTicks | 0,
            ),
        );
    }

    /**
     * Request one music track (SOUND_SONG 3201).
     * OSRS parity: Skills.method6928([trackId], outDelay, outDur, inDelay, inDur)
     */
    public playSong(
        trackId: number,
        fadeOutDelayTicks: number,
        fadeOutDurationTicks: number,
        fadeInDelayTicks: number,
        fadeInDurationTicks: number,
    ): void {
        this.requestOsrsSongs([trackId | 0], {
            fadeOutDelayTicks: fadeOutDelayTicks | 0,
            fadeOutDurationTicks: fadeOutDurationTicks | 0,
            fadeInDelayTicks: fadeInDelayTicks | 0,
            fadeInDurationTicks: fadeInDurationTicks | 0,
        });
    }

    /**
     * Request two music tracks (MUSIC_DUAL 3221) to preload track 2 for later crossfade.
     * OSRS parity: Skills.method6928([track1, track2], outDelay, outDur, inDelay, inDur)
     */
    public playDualTracks(
        track1: number,
        track2: number,
        fadeOutDelayTicks: number,
        fadeOutDurationTicks: number,
        fadeInDelayTicks: number,
        fadeInDurationTicks: number,
    ): void {
        this.requestOsrsSongs([track1 | 0, track2 | 0], {
            fadeOutDelayTicks: fadeOutDelayTicks | 0,
            fadeOutDurationTicks: fadeOutDurationTicks | 0,
            fadeInDelayTicks: fadeInDelayTicks | 0,
            fadeInDurationTicks: fadeInDurationTicks | 0,
        });
    }

    /**
     * Play a secondary track (for dual track playback).
     */
    private async playSecondaryTrack(trackId: number): Promise<boolean> {
        if (trackId < 0) return false;

        this.secondaryTrackId = trackId;

        try {
            console.log(`[MusicSystem] Loading secondary track ${trackId}...`);
            const loaded = await this.secondarySynth.loadTrack(trackId);
            if (loaded) {
                this.secondarySynth.setVolume(this.volume);
                this.secondarySynth.setLooping(true);
                this.secondarySynth.play();
                console.log(`[MusicSystem] Playing secondary track ${trackId}`);
                return true;
            }
        } catch (e) {
            console.warn(`[MusicSystem] Failed to load secondary track ${trackId}`, e);
        }

        return false;
    }

    /**
     * Stop the secondary track.
     */
    private stopSecondaryTrack(): void {
        this.secondarySynth.stop();
        this.secondaryTrackId = -1;
        if (this.secondaryGainNode) {
            try {
                this.secondaryGainNode.disconnect();
            } catch {}
            this.secondaryGainNode = null;
        }
    }

    /**
     * Crossfade between two loaded music tracks.
     * OSRS parity: FriendSystem.method1927(outDelay, outDur, inDelay, inDur)
     */
    public crossfadeTracks(
        fadeOutDelayTicks: number,
        fadeOutDurationTicks: number,
        fadeInDelayTicks: number,
        fadeInDurationTicks: number,
    ): void {
        if (this.osrsSongs.length <= 1) return;
        const a = this.osrsSongs[0];
        const b = this.osrsSongs[1];
        if (!a?.loaded || !b?.loaded || !a?.started || !b?.started) return;

        const fadeInTarget = b;
        const fadeOutTarget = a;

        this.osrsTaskQueue.push(this.makeSwapFirstTwoSongsTask());
        this.osrsTaskQueue.push(
            this.makeConcurrentTask([
                this.makeDelayTask(
                    this.makeFadeInTask(null, fadeInTarget, fadeInDurationTicks | 0),
                    fadeInDelayTicks | 0,
                ),
                this.makeDelayTask(
                    this.makeFadeOutTask(null, fadeOutTarget, fadeOutDurationTicks | 0),
                    fadeOutDelayTicks | 0,
                ),
            ]),
        );
    }

    /**
     * Play a jingle (short music fanfare).
     * OSRS parity: Jingles are queued through the same song-task pipeline as music
     * and temporarily suspend queued area music until the jingle queue drains.
     *
     * Jingles are MIDI format, stored in musicJingles index (index 11).
     *
     * @param jingleId - The jingle track ID (from musicJingles index 11)
     * @param _delay - Jingle delay param from SOUND_JINGLE / server packet. Present for parity;
     * OSRS ignores it at playback time.
     */
    public async playJingle(jingleId: number, _delay: number): Promise<boolean> {
        if (jingleId < 0 || !(this.volume > 0)) return false;

        this.queueOsrsSongs(
            this.createOsrsSongEntries([jingleId | 0], "jingle"),
            {
                fadeOutDelayTicks: 0,
                fadeOutDurationTicks: 0,
                fadeInDelayTicks: 0,
                fadeInDurationTicks: 0,
            },
            true,
        );
        this._playingJingle = true;
        console.log(`[MusicSystem] Playing jingle ${jingleId}`);
        return true;
    }

    /**
     * Play a music track with optional fade parameters.
     * Legacy convenience API (ms-based). OSRS-style fades are driven by
     * CS2 opcodes via `playSong`/`playDualTracks`/`crossfadeTracks`.
     *
     * @param trackId - The music track ID
     * @param fadeInMs - Fade in duration in milliseconds (0 = instant)
     * @param fadeOutMs - Fade out duration for current track in milliseconds (0 = instant)
     */
    public async playTrackWithFade(
        trackId: number,
        fadeInMs: number = 0,
        fadeOutMs: number = 0,
    ): Promise<boolean> {
        // If a jingle is playing, queue this track instead
        if (this._playingJingle) {
            this.queueAreaTrack(trackId);
            return true;
        }

        if (this.currentTrackId === trackId && this.isPlaying) return true;

        // Fade out current track if requested
        if (fadeOutMs > 0 && this.isPlaying) {
            await this.fadeOutCurrent(fadeOutMs);
        } else {
            this.stop();
        }

        // Play new track
        const success = await this.playTrack(trackId);

        // Fade in if requested
        if (success && fadeInMs > 0) {
            this.fadeIn(fadeInMs);
        }

        return success;
    }

    /**
     * Fade out the current music track.
     */
    private async fadeOutCurrent(durationMs: number): Promise<void> {
        const durationSec = durationMs / 1000;

        if (this.realtimeSynth && this.isPlaying) {
            // Fade out via synth (it has its own gain)
            this.realtimeSynth.fadeOut(durationSec);
            await new Promise((resolve) => setTimeout(resolve, durationMs));
            this.realtimeSynth.stop();
        } else if (this.gainNode && this.context) {
            // Fade out via gain node
            const now = this.context.currentTime;
            this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
            this.gainNode.gain.linearRampToValueAtTime(0, now + durationSec);
            await new Promise((resolve) => setTimeout(resolve, durationMs));
            this.stop();
            // Restore gain for next track
            this.gainNode.gain.setValueAtTime(this.volume, this.context.currentTime);
        } else if (this.htmlAudio) {
            // Fade out HTML audio
            const startVol = this.htmlAudio.volume;
            const steps = 20;
            const stepTime = durationMs / steps;
            for (let i = steps; i >= 0; i--) {
                this.htmlAudio.volume = startVol * (i / steps);
                await new Promise((resolve) => setTimeout(resolve, stepTime));
            }
            this.stop();
        } else {
            this.stop();
        }
    }

    /**
     * Fade in the current music track.
     */
    private fadeIn(durationMs: number): void {
        const durationSec = durationMs / 1000;

        if (this.realtimeSynth && this.isPlaying) {
            this.realtimeSynth.fadeIn(durationSec);
        } else if (this.gainNode && this.context) {
            const now = this.context.currentTime;
            this.gainNode.gain.setValueAtTime(0, now);
            this.gainNode.gain.linearRampToValueAtTime(this.volume, now + durationSec);
        } else if (this.htmlAudio) {
            this.htmlAudio.volume = 0;
            const targetVol = this.volume;
            const steps = 20;
            const stepTime = durationMs / steps;
            let step = 0;
            // Memory leak fix: clear any existing fade interval and store reference
            if (this.fadeInterval) {
                clearInterval(this.fadeInterval);
            }
            this.fadeInterval = setInterval(() => {
                step++;
                if (this.htmlAudio) {
                    this.htmlAudio.volume = targetVol * (step / steps);
                }
                if (step >= steps) {
                    if (this.fadeInterval) {
                        clearInterval(this.fadeInterval);
                        this.fadeInterval = null;
                    }
                }
            }, stepTime);
        }
    }

    public async playTrack(trackId: number): Promise<boolean> {
        if (this.currentTrackId === trackId && this.isPlaying) return true;
        this.stop();

        // Increment sequence to invalidate any pending loads
        const mySequence = ++this.loadSequence;

        this.currentTrackId = trackId;
        this.isPlaying = true;

        // Try real-time synth first (best quality, handles OSRS MIDI with patches)
        try {
            console.log(`[MusicSystem] Loading track ${trackId} via RealtimeMidiSynth...`);
            const loaded = await this.realtimeSynth.loadTrack(trackId);

            // Check if another track was requested while we were loading
            if (mySequence !== this.loadSequence) {
                console.log(
                    `[MusicSystem] Track ${trackId} load cancelled (newer request pending)`,
                );
                return false;
            }

            if (loaded) {
                this.realtimeSynth.setVolume(this.volume);
                this.realtimeSynth.setLooping(true);
                this.realtimeSynth.play();
                console.log(`[MusicSystem] Playing track ${trackId} via RealtimeMidiSynth`);
                return true;
            }
        } catch (e) {
            // Check if cancelled before logging error
            if (mySequence !== this.loadSequence) {
                return false;
            }
            console.warn(`[MusicSystem] RealtimeMidiSynth failed for track ${trackId}:`, e);
        }

        // Fall back to pre-encoded audio methods (for Ogg Vorbis etc)
        this.ensureContext();

        if (!this.context) {
            console.warn("[MusicSystem] Web Audio context not available");
            this.isPlaying = false;
            this.currentTrackId = -1;
            return false;
        }
        if (this.context.state === "suspended") {
            try {
                await this.context.resume();
            } catch (e) {
                console.error("[MusicSystem] Failed to resume AudioContext", e);
                this.isPlaying = false;
                this.currentTrackId = -1;
                return false;
            }
        }

        // Check if cancelled during context resume
        if (mySequence !== this.loadSequence) {
            return false;
        }

        try {
            console.log(`[MusicSystem] Loading track ${trackId} via fallback methods...`);
            const index = this.cache.getIndex(IndexType.DAT2.musicTracks);
            if (!index) {
                console.error("[MusicSystem] Music index not available");
                this.isPlaying = false;
                this.currentTrackId = -1;
                return false;
            }

            const file = index.getFileSmart(trackId);
            if (!file) {
                console.error(`[MusicSystem] Track ${trackId} not found in cache`);
                this.isPlaying = false;
                this.currentTrackId = -1;
                return false;
            }

            const data = file.data;
            const arrayBuffer = copyArrayBufferView(data);

            let audioBuf: AudioBuffer | null = null;

            // If gzip-compressed, decompress first
            let audioData = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
            const isGzip = audioData.length > 2 && audioData[0] === 0x1f && audioData[1] === 0x8b;
            if (isGzip) {
                try {
                    audioData = pako.ungzip(audioData);
                } catch (e) {
                    console.warn(`[MusicSystem] Gunzip failed for track ${trackId}`, e);
                }
            }

            // Find Ogg magic if there's padding
            const findOggStart = (arr: Uint8Array): number => {
                for (let i = 0; i <= arr.length - 4; i++) {
                    if (
                        arr[i] === 0x4f &&
                        arr[i + 1] === 0x67 &&
                        arr[i + 2] === 0x67 &&
                        arr[i + 3] === 0x53
                    ) {
                        return i;
                    }
                }
                return -1;
            };

            const oggStart = findOggStart(audioData);
            if (oggStart > 0) {
                audioData = audioData.slice(oggStart);
            }

            // Try WASM Vorbis decoder first for Ogg files
            if (isOggVorbis(audioData)) {
                try {
                    audioBuf = await decodeOggVorbisToAudioBuffer(audioData, this.context);
                    if (mySequence !== this.loadSequence) return false;
                    console.log(
                        `[MusicSystem] Decoded track ${trackId} via WASM Vorbis (${audioData.length} bytes)`,
                    );
                } catch (e) {
                    if (mySequence !== this.loadSequence) return false;
                    console.warn(`[MusicSystem] WASM Vorbis decode failed for track ${trackId}`, e);
                }
            }

            // Fallback to browser's decodeAudioData
            if (!audioBuf) {
                const buffersToTry: ArrayBuffer[] = [];
                buffersToTry.push(copyArrayBufferView(audioData));

                if (oggStart > 0 || isGzip) {
                    buffersToTry.push(arrayBuffer);
                }

                // Check for RIFF at different offsets
                const findRiffStart = (arr: Uint8Array): number => {
                    for (let i = 0; i <= arr.length - 4; i++) {
                        if (
                            arr[i] === 0x52 &&
                            arr[i + 1] === 0x49 &&
                            arr[i + 2] === 0x46 &&
                            arr[i + 3] === 0x46
                        ) {
                            return i;
                        }
                    }
                    return -1;
                };
                const riffPos = findRiffStart(new Uint8Array(arrayBuffer));
                if (riffPos > 0) buffersToTry.push(copyArrayBufferLike(arrayBuffer, riffPos));

                for (const buf of buffersToTry) {
                    try {
                        audioBuf = await this.context.decodeAudioData(buf.slice(0));
                        if (mySequence !== this.loadSequence) return false;
                        console.log(
                            `[MusicSystem] Decoded track ${trackId} via browser decodeAudioData`,
                        );
                        break;
                    } catch (_e) {
                        if (mySequence !== this.loadSequence) return false;
                        // Try next buffer
                    }
                }
            }

            // Legacy 317-style synth path
            if (!audioBuf) {
                try {
                    const musicBuf = new MusicBuffer(data);
                    SoundTrack.initialize();
                    const track = new SoundTrack();
                    track.decode(musicBuf);
                    const wavBuffer = track.encode(1);
                    if (wavBuffer && wavBuffer.currentPosition > 44) {
                        const length = wavBuffer.currentPosition;
                        const underlyingBuffer = wavBuffer.buffer.buffer;
                        const wavArrayBuffer = copyArrayBufferLike(underlyingBuffer, 0, length);
                        audioBuf = await this.context.decodeAudioData(wavArrayBuffer);
                        if (mySequence !== this.loadSequence) return false;
                        console.log(`[MusicSystem] Decoded track ${trackId} via legacy synth`);
                    }
                } catch (e) {
                    if (mySequence !== this.loadSequence) return false;
                    console.warn(`[MusicSystem] Legacy synth failed for track ${trackId}`, e);
                }
            }

            // Last resort: HTMLAudioElement
            if (!audioBuf) {
                const blobTypes = ["audio/ogg", "audio/wav", "audio/mpeg"];
                for (const mime of blobTypes) {
                    try {
                        const url = URL.createObjectURL(
                            new Blob([new Uint8Array(data)], { type: mime }),
                        );
                        const audio = new Audio(url);
                        audio.loop = true;
                        audio.volume = this.volume;
                        await audio.play();
                        // Check if cancelled during audio.play()
                        if (mySequence !== this.loadSequence) {
                            audio.pause();
                            URL.revokeObjectURL(url);
                            return false;
                        }
                        if (this.currentSource) {
                            try {
                                this.currentSource.stop();
                            } catch {}
                            this.currentSource = null;
                        }
                        this.htmlAudio = audio;
                        this.htmlAudioUrl = url;
                        console.log(
                            `[MusicSystem] Playing track ${trackId} via HTMLAudioElement (${mime})`,
                        );
                        return true;
                    } catch (_e) {
                        if (mySequence !== this.loadSequence) return false;
                        // Try next mime type
                    }
                }
                console.error(`[MusicSystem] Failed to decode or play track ${trackId}`);
                this.isPlaying = false;
                this.currentTrackId = -1;
                return false;
            }

            // Final check before creating source
            if (mySequence !== this.loadSequence) return false;

            const source = this.context.createBufferSource();
            const gainNode = this.gainNode;
            if (!gainNode) {
                throw new Error("[MusicSystem] Missing gain node");
            }
            source.buffer = audioBuf;
            source.loop = true;
            source.connect(gainNode);
            source.start();

            this.currentSource = source;
            this.stopHtmlAudioFallback();
            console.log(`[MusicSystem] Playing track ${trackId}`);
            return true;
        } catch (e) {
            console.error("[MusicSystem] Error playing track", e);
            this.isPlaying = false;
            this.currentTrackId = -1;
            return false;
        }
    }

    public stop() {
        // Stop OSRS-style song queue/music
        this.stopOsrsMusicImmediate();

        // Memory leak fix: clear fade interval
        if (this.fadeInterval) {
            clearInterval(this.fadeInterval);
            this.fadeInterval = null;
        }

        // Stop real-time synth
        this.realtimeSynth.stop();

        // Stop secondary track
        this.stopSecondaryTrack();
        this.tertiarySynth.stop();

        if (this.currentSource) {
            try {
                this.currentSource.stop();
                this.currentSource.disconnect();
            } catch (e) {}
            this.currentSource = null;
        }
        if (this.htmlAudio) {
            try {
                this.htmlAudio.pause();
            } catch {}
            try {
                if (this.htmlAudioUrl) URL.revokeObjectURL(this.htmlAudioUrl);
            } catch {}
            this.htmlAudio = null;
            this.htmlAudioUrl = null;
        }
        this.isPlaying = false;
        this.currentTrackId = -1;

        // Clear any pending track
        this.pendingAreaTrackId = -1;
        this.pendingAreaTrackName = null;
    }

    private stopHtmlAudioFallback() {
        if (this.htmlAudio) {
            try {
                this.htmlAudio.pause();
            } catch {}
        }
        if (this.htmlAudioUrl) {
            try {
                URL.revokeObjectURL(this.htmlAudioUrl);
            } catch {}
        }
        this.htmlAudio = null;
        this.htmlAudioUrl = null;
    }

    dispose(): void {
        this.stop();

        // Clear fade interval
        if (this.fadeInterval) {
            clearInterval(this.fadeInterval);
            this.fadeInterval = null;
        }

        // Remove context event listeners
        this.removeContextListeners();

        // Dispose synths
        this.realtimeSynth.dispose();
        this.secondarySynth.dispose();
        this.tertiarySynth.dispose();

        // Disconnect gain nodes
        if (this.gainNode) {
            this.gainNode.disconnect();
            this.gainNode = null;
        }
        if (this.secondaryGainNode) {
            this.secondaryGainNode.disconnect();
            this.secondaryGainNode = null;
        }

        // Close audio context
        if (this.context) {
            this.context.close().catch(() => {});
            this.context = null;
        }
    }

    private stopOsrsMusicImmediate(): void {
        this.clearQueuedAreaSongs();
        this.clearOsrsPlaybackImmediate();
    }

    private clearOsrsPlaybackImmediate(): void {
        this.osrsTaskQueue.length = 0;
        for (const req of this.osrsRequests) {
            this.stopAndResetOsrsSong(req);
        }
        this.osrsRequests.length = 0;
        for (const song of this.osrsSongs) {
            this.stopAndResetOsrsSong(song);
        }
        this.osrsSongs.length = 0;
        this.osrsRequestedTrackIds = [];
        this._playingJingle = false;
    }

    private stopAndResetOsrsSong(song: OsrsMusicSong): void {
        const synth = song.synth;
        if (synth) {
            const previous = this.osrsSynthRefCount.get(synth);
            const prev = typeof previous === "number" ? previous : 0;
            if (prev > 0) {
                this.osrsSynthRefCount.set(synth, prev - 1);
            }
            const remaining = this.osrsSynthRefCount.get(synth);
            if ((typeof remaining === "number" ? remaining : 0) === 0) {
                try {
                    synth.stop();
                } catch {}
                // Avoid leaving the synth muted for non-OSRS callers.
                try {
                    synth.setOutputGain(1);
                } catch {}
            }
        }
        song.trackId = -1;
        song.kind = "music";
        song.synth = null;
        song.loaded = false;
        song.failed = false;
        song.started = false;
        song.isFading = false;
        song.markedForRemoval = false;
        song.musicTrackVolumeInt = 0;
        song.pcmVolume = 0;
        song.loadPromise = null;
    }

    private processOsrsMusicQueueTick(): void {
        if (this.osrsTaskQueue.length === 0) return;
        const task = this.osrsTaskQueue[0];
        if (!task) {
            this.osrsTaskQueue.shift();
            return;
        }

        const finished = task.run();
        if (finished) {
            if (task.error) {
                console.log(`[MusicSystem] Error in midimanager.service: ${task.error}`);
                this.stopOsrsMusicImmediate();
                return;
            }
            if (task.next) {
                this.osrsTaskQueue.splice(1, 0, task.next);
            }
            this.osrsTaskQueue.shift();
        }
    }

    private processOsrsJingleQueueTick(): void {
        if (!this._playingJingle) return;

        let active = false;
        if (this.osrsTaskQueue.length > 0) {
            active = true;
        } else {
            const currentSong = this.osrsSongs.length > 0 ? this.osrsSongs[0] : null;
            active = currentSong?.synth?.playing === true;
        }

        if (active) {
            return;
        }

        this._playingJingle = false;
        console.log("[MusicSystem] Jingle ended");

        if (this.volume > 0 && this.osrsQueuedAreaTracks && this.osrsQueuedAreaFade) {
            this.queueOsrsSongs(
                this.createOsrsSongEntries(this.osrsQueuedAreaTracks, "music"),
                this.osrsQueuedAreaFade,
                false,
            );
        } else if (this.pendingAreaTrackId >= 0) {
            const trackId = this.pendingAreaTrackId;
            this.pendingAreaTrackId = -1;
            this.pendingAreaTrackName = null;
            this.playTrack(trackId).catch(() => {});
        }

        if (this.onJingleEnd) {
            this.onJingleEnd();
        }
    }

    private requestOsrsSongs(trackIds: number[], fades: OsrsFadeParams): void {
        if (trackIds.length === 0) return;
        const first = trackIds[0] | 0;

        if (first === -1 && !this._playingJingle) {
            this.clearQueuedAreaSongs();
            this.stopMusic(0, 0);
            return;
        }
        if (first === -1) return;

        if (!(this.volume > 0)) return;

        const capped = trackIds
            .slice(0, 3)
            .map((id) => id | 0)
            .filter((id) => id >= 0);
        if (capped.length === 0) return;

        // OSRS parity: de-dupe against queuedSongs' primary track, not the currently active jingle.
        const queuedPrimary =
            this.osrsQueuedAreaTracks && this.osrsQueuedAreaTracks.length > 0
                ? this.osrsQueuedAreaTracks[0] | 0
                : -1;
        if (queuedPrimary === (capped[0] | 0)) return;

        this.osrsQueuedAreaTracks = capped.slice();
        this.osrsQueuedAreaFade = { ...fades };

        if (this._playingJingle) {
            return;
        }

        this.queueOsrsSongs(this.createOsrsSongEntries(capped, "music"), fades, false);
    }

    private allocateOsrsSynth(): RealtimeMidiSynth {
        const pool = [this.realtimeSynth, this.secondarySynth, this.tertiarySynth];
        let chosen: RealtimeMidiSynth | null = null;

        // OSRS parity: AddRequestTask.selectMidiPcmStream() selection heuristic.
        for (const candidate of pool) {
            if (!candidate) continue;
            if (!chosen) {
                chosen = candidate;
                continue;
            }
            if (this.getOsrsSynthRefCount(chosen) > this.getOsrsSynthRefCount(candidate)) {
                chosen = candidate;
                continue;
            }
            if (this.isOsrsMutedActiveSynth(candidate)) {
                chosen = candidate;
            }
        }

        const result = chosen ? chosen : this.realtimeSynth;
        const prev = this.getOsrsSynthRefCount(result);
        this.osrsSynthRefCount.set(result, prev + 1);

        // OSRS parity: when taking a muted active stream, clear it before reuse.
        if (prev === 0 && this.isOsrsMutedActiveSynth(result)) {
            try {
                result.stop();
            } catch {}
            try {
                result.setOutputGain(0);
            } catch {}
        }

        return result;
    }

    private getOsrsSynthRefCount(synth: RealtimeMidiSynth): number {
        const count = this.osrsSynthRefCount.get(synth);
        return typeof count === "number" ? count : 0;
    }

    private isOsrsMutedActiveSynth(synth: RealtimeMidiSynth): boolean {
        try {
            return synth.getOutputGain() === 0 && synth.playing === true;
        } catch {}
        return false;
    }

    private getMusicTrackVolumeInt(): number {
        // OSRS parity: preferences.getMusicVolume() is 0..255.
        return Math.max(0, Math.min(255, Math.round(this.volume * 255)));
    }

    private createOsrsSongEntries(trackIds: number[], kind: OsrsSongKind): OsrsMusicSong[] {
        const entries: OsrsMusicSong[] = [];
        for (const rawTrackId of trackIds) {
            const trackId = rawTrackId | 0;
            if (trackId < 0) {
                continue;
            }
            entries.push({
                trackId,
                kind,
                synth: null,
                loaded: false,
                failed: false,
                started: false,
                isFading: false,
                markedForRemoval: false,
                musicTrackVolumeInt: this.getMusicTrackVolumeInt(),
                pcmVolume: 0,
                loadPromise: null,
            });
        }
        return entries;
    }

    private queueOsrsSongs(
        entries: OsrsMusicSong[],
        fades: OsrsFadeParams,
        clearImmediately: boolean,
    ): void {
        if (entries.length === 0) {
            return;
        }

        if (clearImmediately) {
            this.clearOsrsPlaybackImmediate();
        } else {
            // OSRS parity: LoginScreenAnimation.method2528() marks existing songs for removal
            // and removes those already marked on subsequent calls. This prevents song buildup
            // when new music requests arrive rapidly.
            for (let i = 0; i < this.osrsSongs.length; i++) {
                const song = this.osrsSongs[i];
                if (!song) {
                    this.osrsSongs.splice(i, 1);
                    i--;
                    continue;
                }
                if (song.markedForRemoval) {
                    this.osrsSongs.splice(i, 1);
                    i--;
                    this.stopAndResetOsrsSong(song);
                    continue;
                }
                song.markedForRemoval = true;
            }
        }

        if (this.osrsSongs.length === 0) {
            this.stopLegacyFallbackMusic();
        }

        for (const req of this.osrsRequests) {
            this.stopAndResetOsrsSong(req);
        }
        this.osrsRequests.length = 0;
        this.osrsTaskQueue.length = 0;

        this.osrsRequestedTrackIds = entries.map((song) => song.trackId | 0);
        this.osrsRequests.push(...entries);

        const oldSongs = this.osrsSongs.slice();
        const oldPrimary = this.selectOsrsFadeOutSong(oldSongs);
        this.silenceOsrsSongsForReplacement(oldSongs, oldPrimary);
        const newPrimary = this.osrsRequests[0];
        if (!newPrimary) {
            return;
        }

        this.osrsTaskQueue.push(this.makeAddRequestTask());
        this.osrsTaskQueue.push(this.makeLoadSongsTask());

        const startAndFadeIn = this.makeStartSongsTask(
            this.makeFadeInTask(null, newPrimary, fades.fadeInDurationTicks | 0),
        );
        const startSequence = this.makeConcurrentTask([startAndFadeIn]);

        if (oldSongs.length > 0 && oldPrimary) {
            const fadeOutAndClear = this.makeFadeOutTask(
                this.makeClearSongsTask(oldSongs),
                oldPrimary,
                fades.fadeOutDurationTicks | 0,
            );
            this.osrsTaskQueue.push(
                this.makeConcurrentTask([
                    this.makeDelayTask(startSequence, fades.fadeInDelayTicks | 0),
                    this.makeDelayTask(fadeOutAndClear, fades.fadeOutDelayTicks | 0),
                ]),
            );
        } else {
            this.osrsTaskQueue.push(this.makeDelayTask(null, fades.fadeInDelayTicks | 0));
            this.osrsTaskQueue.push(startSequence);
        }
    }

    private stopLegacyFallbackMusic(): void {
        if (this.currentSource) {
            try {
                this.currentSource.stop();
                this.currentSource.disconnect();
            } catch {}
            this.currentSource = null;
        }
        this.stopHtmlAudioFallback();
        this.isPlaying = false;
        this.currentTrackId = -1;
        this.secondaryTrackId = -1;
    }

    private clearQueuedAreaSongs(): void {
        this.osrsQueuedAreaTracks = null;
        this.osrsQueuedAreaFade = null;
    }

    private selectOsrsFadeOutSong(songs: OsrsMusicSong[]): OsrsMusicSong | null {
        let selected: OsrsMusicSong | null = null;

        for (const song of songs) {
            if (!song || !song.loaded || !song.started) {
                continue;
            }
            if (!selected || song.pcmVolume > selected.pcmVolume) {
                selected = song;
            }
        }

        if (selected) {
            return selected;
        }

        return songs.length > 0 ? songs[0] : null;
    }

    private silenceOsrsSongsForReplacement(
        songs: OsrsMusicSong[],
        keep: OsrsMusicSong | null,
    ): void {
        const keepSynth = keep?.synth ?? null;

        for (const song of songs) {
            if (!song || song === keep) {
                continue;
            }
            // Interrupting a crossfade must not leave multiple tracks audible.
            if (keepSynth && song.synth === keepSynth) {
                continue;
            }
            song.pcmVolume = 0;
            if (!song.synth || !song.loaded || !song.started) {
                continue;
            }
            try {
                song.synth.setOutputGain(0);
            } catch {}
        }
    }

    private makeTaskBase(name: string): OsrsSongTask {
        return { name, next: null, error: null, didStartSong: false, run: () => true };
    }

    private makeDelayTask(next: OsrsSongTask | null, ticks: number): OsrsSongTask {
        const task = this.makeTaskBase("DelayFadeTask");
        const target = Math.max(0, ticks | 0);
        let elapsed = 0;
        task.next = next;
        task.run = () => {
            if (elapsed < target) {
                elapsed++;
                return false;
            }
            return true;
        };
        return task;
    }

    private makeConcurrentTask(tasks: OsrsSongTask[]): OsrsSongTask {
        const task = this.makeTaskBase("ConcurrentMidiTask");
        const queue = tasks.slice();
        task.run = () => {
            for (let i = 0; i < queue.length; i++) {
                const t = queue[i];
                if (!t) {
                    queue.splice(i, 1);
                    i--;
                    continue;
                }
                const done = t.run();
                if (done) {
                    if (t.error) {
                        task.error = t.error;
                        queue.length = 0;
                        return true;
                    }
                    if (t.next) queue.push(t.next);
                    task.didStartSong = task.didStartSong || t.didStartSong;
                    queue.splice(i, 1);
                    i--;
                } else {
                    task.didStartSong = task.didStartSong || t.didStartSong;
                }
            }
            return queue.length === 0;
        };
        return task;
    }

    private makeAddRequestTask(): OsrsSongTask {
        const task = this.makeTaskBase("AddRequestTask");
        task.run = () => {
            while (this.osrsRequests.length > 0) {
                const song = this.osrsRequests.shift();
                if (!song) continue;
                song.synth = this.allocateOsrsSynth();
                this.osrsSongs.push(song);
            }
            return true;
        };
        return task;
    }

    private makeLoadSongsTask(): OsrsSongTask {
        const task = this.makeTaskBase("LoadSongTask");
        task.run = () => {
            for (const song of this.osrsSongs) {
                if (!song) {
                    continue;
                }
                if (song.loaded || song.failed) {
                    continue;
                }
                if (!song.synth) {
                    task.error = `LoadSongTask missing synth for track ${song.trackId}`;
                    return true;
                }
                if (!song.loadPromise) {
                    const trackId = song.trackId | 0;
                    const load =
                        song.kind === "jingle"
                            ? song.synth.loadJingle(trackId)
                            : song.synth.loadTrack(trackId);
                    song.loadPromise = load
                        .then((ok) => {
                            song.loaded = ok === true;
                            song.failed = ok !== true;
                            song.loadPromise = null;
                            return ok === true;
                        })
                        .catch((_e) => {
                            song.loaded = false;
                            song.failed = true;
                            song.loadPromise = null;
                            return false;
                        });
                }
            }

            const failed = this.osrsSongs.find((s) => s && s.failed);
            if (failed) {
                task.error = `Failed to load track ${failed.trackId}`;
                return true;
            }

            const allLoaded = this.osrsSongs.every((s) => !s || s.loaded);
            return allLoaded;
        };
        return task;
    }

    private makeStartSongsTask(next: OsrsSongTask | null): OsrsSongTask {
        const task = this.makeTaskBase("StartSongTask");
        task.next = next;
        task.run = () => {
            for (const song of this.osrsSongs) {
                if (!song || song.started || !song.loaded) continue;
                if (!song.synth) {
                    task.error = `StartSongTask missing synth for track ${song.trackId}`;
                    return true;
                }
                try {
                    song.synth.setVolume(this.volume);
                    song.synth.setLooping(song.kind !== "jingle");
                    song.musicTrackVolumeInt = this.getMusicTrackVolumeInt();
                    song.pcmVolume = 0;
                    song.isFading = false;
                    song.synth.setOutputGain(0);
                    song.synth.play();
                    song.started = true;
                } catch (e: unknown) {
                    task.error = `StartSongTask failed: ${errorToString(e)}`;
                    return true;
                }
            }
            task.didStartSong = true;
            return true;
        };
        return task;
    }

    private makeFadeInTask(
        next: OsrsSongTask | null,
        song: OsrsMusicSong,
        durationTicks: number,
    ): OsrsSongTask {
        const task = this.makeTaskBase("FadeInTask");
        task.next = next;
        const denom = durationTicks | 0;
        task.run = () => {
            if (!song || !song.synth || !song.loaded || !song.started) return true;
            if (!song.synth.isReady()) return true;

            song.isFading = true;
            const maxVol = Math.max(0, song.musicTrackVolumeInt | 0);
            if (maxVol <= 0) {
                song.isFading = false;
                return true;
            }

            if (song.pcmVolume < maxVol) {
                // OSRS parity (FadeInTask.java):
                //   float step = (duration == 0 ? 0 : (float)maxVol / (float)duration);
                //   pcm += (step == 0 ? maxVol : step);
                const step = denom === 0 ? 0 : maxVol / denom;
                song.pcmVolume += step === 0 ? maxVol : step;
                if (song.pcmVolume > maxVol) song.pcmVolume = maxVol;
                const pcmInt = Math.max(0, Math.min(maxVol, Math.trunc(song.pcmVolume)));
                const ratio = pcmInt / maxVol;
                try {
                    song.synth.setOutputGain(ratio);
                } catch (e: unknown) {
                    task.error = `FadeInTask failed: ${errorToString(e)}`;
                    return true;
                }
                return false;
            }
            song.isFading = false;
            return true;
        };
        return task;
    }

    private makeFadeOutTask(
        next: OsrsSongTask | null,
        song: OsrsMusicSong,
        durationTicks: number,
    ): OsrsSongTask {
        const task = this.makeTaskBase("FadeOutTask");
        task.next = next;
        const denom = durationTicks | 0;
        task.run = () => {
            if (!song || !song.synth || !song.loaded || !song.started) return true;
            if (!song.synth.isReady()) return true;

            song.isFading = true;
            const maxVol = Math.max(0, song.musicTrackVolumeInt | 0);
            if (maxVol <= 0) {
                song.isFading = false;
                return true;
            }

            if (song.pcmVolume > 0) {
                // OSRS parity (FadeOutTask.java):
                //   float step = (duration == 0 ? 0 : (float)maxVol / (float)duration);
                //   pcm -= (step == 0 ? maxVol : step);
                const step = denom === 0 ? 0 : maxVol / denom;
                song.pcmVolume -= step === 0 ? maxVol : step;
                if (song.pcmVolume < 0) song.pcmVolume = 0;
                const pcmInt = Math.max(0, Math.min(maxVol, Math.trunc(song.pcmVolume)));
                const ratio = pcmInt / maxVol;
                try {
                    song.synth.setOutputGain(ratio);
                } catch (e: unknown) {
                    task.error = `FadeOutTask failed: ${errorToString(e)}`;
                    return true;
                }
                return false;
            }
            song.isFading = false;
            return true;
        };
        return task;
    }

    private makeClearSongsTask(songs: OsrsMusicSong[]): OsrsSongTask {
        const task = this.makeTaskBase("ClearRequestTask");
        const targets = songs.slice();
        task.run = () => {
            for (const song of targets) {
                if (!song) continue;
                const idx = this.osrsSongs.indexOf(song);
                if (idx !== -1) {
                    this.osrsSongs.splice(idx, 1);
                }
                this.stopAndResetOsrsSong(song);
            }
            return true;
        };
        return task;
    }

    private makeSwapFirstTwoSongsTask(): OsrsSongTask {
        const task = this.makeTaskBase("SwapSongTask");
        task.run = () => {
            if (this.osrsSongs.length > 1) {
                const a = this.osrsSongs[0];
                const b = this.osrsSongs[1];
                if (a?.loaded && b?.loaded && a?.started && b?.started) {
                    this.osrsSongs[0] = b;
                    this.osrsSongs[1] = a;
                }
            }
            if (this.osrsRequestedTrackIds.length > 1) {
                const a = this.osrsRequestedTrackIds[0] | 0;
                this.osrsRequestedTrackIds[0] = this.osrsRequestedTrackIds[1] | 0;
                this.osrsRequestedTrackIds[1] = a;
            }
            return true;
        };
        return task;
    }
}
