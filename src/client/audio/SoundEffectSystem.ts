import { SoundEffectLoader } from "../../rs/audio/SoundEffectLoader";
import type { RawSoundData } from "../../rs/audio/legacy/SoundEffect";
import type { SeqSoundEffect } from "../../rs/config/seqtype/SeqType";
import { addAudioContextResumeListeners, getAudioContextConstructor } from "./audioContext";
import { resampleToSampleRate, smoothLowPass } from "./resample";

type DecodedSound = {
    sampleRate: number;
    channelData: Float32Array;
    duration: number;
    /** Loop start in seconds (from RawSound.start). 0 if no loop markers. */
    loopStartSec: number;
    /** Loop end in seconds (from RawSound.end). 0 if no loop markers. */
    loopEndSec: number;
};

const enum EasingCurveId {
    LINEAR = 0,
    EASE_IN_SINE = 1,
    EASE_OUT_SINE = 2,
    EASE_IN_OUT_SINE = 3,
    EASE_IN_QUAD = 4,
    EASE_OUT_QUAD = 5,
    EASE_IN_OUT_QUAD = 6,
    EASE_IN_CUBIC = 7,
    EASE_OUT_CUBIC = 8,
    EASE_IN_OUT_CUBIC = 9,
    EASE_IN_QUART = 10,
    EASE_OUT_QUART = 11,
    EASE_IN_OUT_QUART = 12,
    EASE_IN_QUINT = 13,
    EASE_OUT_QUINT = 14,
    EASE_IN_OUT_QUINT = 15,
    EASE_IN_EXPO = 16,
    EASE_OUT_EXPO = 17,
    EASE_IN_OUT_EXPO = 18,
    EASE_IN_CIRC = 19,
    EASE_OUT_CIRC = 20,
    EASE_IN_OUT_CIRC = 21,
    EASE_IN_BACK = 22,
    EASE_OUT_BACK = 23,
    EASE_IN_OUT_BACK = 24,
    EASE_IN_ELASTIC = 25,
    EASE_OUT_ELASTIC = 26,
    EASE_IN_OUT_ELASTIC = 27,
}

export interface PlaySoundOptions {
    loops?: number;
    delayMs?: number;
    position?: { x: number; y: number; z?: number };
    radius?: number;
    distanceFadeCurve?: number;
    isLocalPlayer?: boolean;
    /** SOUND_AREA volume (0-255, default 255 = full volume) */
    volume?: number;
}

export interface SequenceSoundContext {
    position?: { x: number; y: number; z?: number };
    isLocalPlayer?: boolean;
    distanceFadeCurve?: number;
    radiusOverride?: number;
    // Debug-only metadata for one-line logging
    debugSeqId?: number;
    debugFrame?: number;
}

export interface AmbientSoundInstance {
    locId: number;
    soundId: number;
    x: number;
    y: number;
    z: number;
    maxDistance: number;
    minDistance: number;
    sizeX: number;
    sizeY: number;
    orientation: number;
    changeTicksMin: number;
    changeTicksMax: number;
    soundIds?: number[];
    fadeInDurationMs?: number;
    fadeOutDurationMs?: number;
    fadeInCurve?: number;
    fadeOutCurve?: number;
    distanceFadeCurve?: number;
    distanceOverride?: number;
    loopSequentially?: boolean;
    deferSwap?: boolean;
    exactPosition?: boolean;
    resetOnLoop?: boolean;
}

type ActiveAmbientSound = {
    instance: AmbientSoundInstance;
    gainNode: GainNode;
    loopSource?: AudioBufferSourceNode;
    loopSoundId?: number;
    overlaySource?: AudioBufferSourceNode;
    nextChangeTime: number;
    currentSoundIndex: number;
    stopAt?: number;
    fadeOutActive?: boolean;
    fadeInDurationSec: number;
    fadeOutDurationSec: number;
};

// Game cycle = 20ms (client runs at ~50fps). soundEffectMinDelay/MaxDelay are in game cycles.
const CYCLE_LENGTH_SECONDS = 0.02;

export class SoundEffectSystem {
    private readonly decodedCache = new Map<string, DecodedSound>();
    private readonly loader: SoundEffectLoader;
    private context: AudioContext | undefined;
    private gainNode: GainNode | undefined;
    private ambientGainNode: GainNode | undefined;
    private masterVolume = 1.0;
    private ambientVolume = 1.0; // Separate volume for area/ambient sounds
    private readonly activeSources: AudioBufferSourceNode[] = [];
    private readonly maxSimultaneous = 32;
    private readonly lastPlayed = new Map<string, number>();
    private readonly ambientSounds = new Map<string, ActiveAmbientSound>();
    private listenerX = 0;
    private listenerY = 0;
    private listenerZ = 0;
    private readonly warnedSounds = new Set<number>();
    // Memory leak fix: track context resume listener cleanup
    private contextResumeCleanup: (() => void) | null = null;
    private readonly MAX_CACHE_SIZE = 100;

    constructor(loader: SoundEffectLoader) {
        this.loader = loader;
    }

    updateListenerPosition(x: number, y: number, z: number): void {
        this.listenerX = x;
        this.listenerY = y;
        this.listenerZ = z;
    }

    setVolume(volume: number): void {
        this.masterVolume = Math.max(0, Math.min(1, volume));
        if (this.gainNode) {
            this.gainNode.gain.value = this.masterVolume;
        }
    }

    /**
     * Set the volume multiplier for ambient/area sounds.
     * This is separate from the master sound effect volume.
     * @param volume Volume level from 0.0 to 1.0
     */
    setAmbientVolume(volume: number): void {
        this.ambientVolume = Math.max(0, Math.min(1, volume));
        if (this.ambientGainNode) {
            this.ambientGainNode.gain.value = this.ambientVolume;
        }
    }

    private ensureContext(): AudioContext | undefined {
        if (typeof window === "undefined") return undefined;
        if (this.context) {
            // Resume suspended context on subsequent calls (after user gesture)
            if (this.context.state === "suspended") {
                this.context.resume().catch(() => {});
            }
            return this.context;
        }
        const AudioCtx = getAudioContextConstructor();
        if (!AudioCtx) return undefined;
        const ctx = new AudioCtx();
        // Master gain node for regular sound effects
        const gain = ctx.createGain();
        gain.gain.value = this.masterVolume;
        gain.connect(ctx.destination);
        this.context = ctx;
        this.gainNode = gain;
        // Separate gain node for ambient/area sounds
        const ambientGain = ctx.createGain();
        ambientGain.gain.value = this.ambientVolume;
        ambientGain.connect(ctx.destination);
        this.ambientGainNode = ambientGain;

        // Auto-resume on user interaction (required by browser autoplay policy)
        if (!this.contextResumeCleanup) {
            this.contextResumeCleanup = addAudioContextResumeListeners(ctx, () => {
                this.contextResumeCleanup = null;
            });
        }

        return ctx;
    }

    private removeContextListeners(): void {
        if (this.contextResumeCleanup) {
            const cleanup = this.contextResumeCleanup;
            this.contextResumeCleanup = null;
            cleanup();
        }
    }

    private cacheKey(soundId: number, sampleRate: number): string {
        return `${soundId}@${sampleRate}`;
    }

    private decode(
        soundId: number,
        targetSampleRate?: number,
        forceResample = false,
    ): DecodedSound | undefined {
        const ctx = this.context;
        const effectiveRate =
            forceResample && ctx
                ? ctx.sampleRate
                : typeof targetSampleRate === "number"
                ? targetSampleRate
                : 0;
        const cacheKey = this.cacheKey(soundId, effectiveRate);
        const cached = this.decodedCache.get(cacheKey);
        if (cached) return cached;

        const t0 = performance.now();
        const raw = this.loader.load(soundId);
        if (!raw) return undefined;
        const t1 = performance.now();

        const decoded = this.toFloatData(raw, effectiveRate);
        const t2 = performance.now();

        // Only log issues once per sound ID to avoid spam
        if (decoded.channelData.length === 0) {
            if (!this.warnedSounds.has(soundId)) {
                this.warnedSounds.add(soundId);
                console.warn(`[SoundEffectSystem] Sound ${soundId} produced empty output`);
            }
        }

        this.decodedCache.set(cacheKey, decoded);

        // Memory leak fix: evict oldest entries if cache too large
        if (this.decodedCache.size > this.MAX_CACHE_SIZE) {
            const keysToDelete = Array.from(this.decodedCache.keys()).slice(
                0,
                this.decodedCache.size - this.MAX_CACHE_SIZE,
            );
            for (const key of keysToDelete) {
                this.decodedCache.delete(key);
            }
        }

        return decoded;
    }

    private toFloatData(raw: RawSoundData, targetSampleRate: number): DecodedSound {
        const total = raw.samples.length | 0;

        if (total <= 0) {
            return {
                sampleRate: raw.sampleRate || targetSampleRate || 22050,
                channelData: new Float32Array(0),
                duration: 0,
                loopStartSec: 0,
                loopEndSec: 0,
            };
        }

        // Keep the full buffer — loop boundaries are applied at playback, not decode.
        let channel: Float32Array = new Float32Array(total);
        for (let i = 0; i < total; i++) {
            channel[i] = raw.samples[i] / 128.0;
        }

        // Compute loop boundaries in source samples
        const srcLoopStart = Math.max(0, Math.min(total, Math.floor(raw.start)));
        const srcLoopEnd = raw.end > 0
            ? Math.max(0, Math.min(total, Math.floor(raw.end)))
            : 0;

        let output: Float32Array = channel;
        let outputRate = raw.sampleRate;

        if (targetSampleRate > 0 && targetSampleRate !== raw.sampleRate) {
            if (targetSampleRate > raw.sampleRate) {
                const nyquist = raw.sampleRate / 2;
                smoothLowPass(channel, raw.sampleRate, nyquist * 0.9);
            }

            output = resampleToSampleRate(channel, raw.sampleRate, targetSampleRate);
            outputRate = targetSampleRate;
            smoothLowPass(output, outputRate);
        } else {
            smoothLowPass(output, outputRate);
        }

        // Convert loop boundaries from source-sample indices to seconds
        const loopStartSec = srcLoopStart > 0 ? srcLoopStart / raw.sampleRate : 0;
        const loopEndSec = srcLoopEnd > srcLoopStart ? srcLoopEnd / raw.sampleRate : 0;

        return {
            sampleRate: outputRate,
            channelData: output,
            duration: output.length / outputRate,
            loopStartSec,
            loopEndSec,
        };
    }

    private prepareBuffer(
        sound: DecodedSound,
        ctx: AudioContext,
        applyLoopCrossfade = false,
    ): AudioBuffer {
        const length = sound.channelData.length;
        const buffer = ctx.createBuffer(1, length, sound.sampleRate);
        const data = new Float32Array(sound.channelData); // Clone to avoid modifying cache
        buffer.copyToChannel(data, 0);
        return buffer;
    }

    private registerSource(source: AudioBufferSourceNode, extraNodes: AudioNode[] = []): void {
        this.activeSources.push(source);
        source.addEventListener("ended", () => {
            const idx = this.activeSources.indexOf(source);
            if (idx >= 0) this.activeSources.splice(idx, 1);
            this.disconnectNodes(extraNodes);
        });
        if (this.activeSources.length > this.maxSimultaneous) {
            const oldest = this.activeSources.shift();
            try {
                oldest?.stop();
            } catch {}
        }
    }

    private disconnectNodes(nodes: AudioNode[] = []) {
        for (const node of nodes) {
            try {
                node.disconnect();
            } catch {}
        }
    }

    playSoundEffect(soundId: number, options: PlaySoundOptions = {}): void {
        const ctx = this.ensureContext();
        if (!ctx || !this.loader.available()) return;

        if (ctx.state === "suspended") {
            ctx.resume().catch(() => {});
        }

        const decoded = this.decode(soundId);
        if (!decoded) return;
        if (!decoded.channelData || decoded.channelData.length === 0 || decoded.sampleRate <= 0) {
            // As a last-resort safety net, synthesize a tiny click to avoid errors and keep timing consistent
            const contextSampleRate =
                this.context && typeof this.context.sampleRate === "number"
                    ? this.context.sampleRate
                    : 22050;
            const sr = Math.max(22050, contextSampleRate);
            const tmp: DecodedSound = {
                sampleRate: sr,
                channelData: new Float32Array(Math.max(64, Math.floor(sr * 0.02))).fill(0),
                duration: 0.02,
                loopStartSec: 0,
                loopEndSec: 0,
            };
            // tiny DC-pop-safe blip
            for (let i = 0; i < tmp.channelData.length; i++)
                tmp.channelData[i] = Math.sin((i / tmp.channelData.length) * Math.PI) * 0.001;
            const buffer = this.prepareBuffer(tmp, ctx);
            const source = ctx.createBufferSource();
            source.buffer = buffer;
            if (!this.gainNode) {
                this.gainNode = ctx.createGain();
                this.gainNode.gain.value = this.masterVolume;
                this.gainNode.connect(ctx.destination);
            }
            source.connect(this.gainNode);
            source.start(ctx.currentTime + (options.delayMs ? options.delayMs / 1000 : 0));
            this.registerSource(source);
            return;
        }

        const buffer = this.prepareBuffer(decoded, ctx);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        if (!this.gainNode) {
            this.gainNode = ctx.createGain();
            this.gainNode.gain.value = this.masterVolume;
            this.gainNode.connect(ctx.destination);
        }

        let gainMultiplier = 1.0;
        const radius = options.radius;
        const position = options.position;
        let gainNode: GainNode | undefined;

        // SOUND_AREA volume: 0-255 where 255 = full volume
        const volumeRaw = typeof options.volume === "number" ? options.volume : 255;
        const volumeMultiplier = Math.max(0, Math.min(1, volumeRaw / 255));

        if (radius !== undefined) {
            if (radius <= 0) {
                if (!options.isLocalPlayer) {
                    return;
                }
            } else {
                if (!position) {
                    return;
                }
                const dx = Math.abs(position.x - this.listenerX);
                const dy = Math.abs(position.y - this.listenerY);
                const manhattan = Math.max(0, dx + dy - 64);
                if (manhattan > radius) {
                    return;
                }
                const curveId = options.distanceFadeCurve ?? EasingCurveId.LINEAR;
                gainMultiplier = radius > 0
                    ? SoundEffectSystem.ease((radius - manhattan) / radius, curveId)
                    : 1;
            }
        }

        // Apply both distance attenuation and SOUND_AREA volume
        const finalGain = gainMultiplier * volumeMultiplier;

        if (radius !== undefined || volumeMultiplier < 1) {
            gainNode = ctx.createGain();
            gainNode.gain.value = finalGain;
            gainNode.connect(this.gainNode);
            source.connect(gainNode);
        } else {
            source.connect(this.gainNode);
        }

        const startTime = ctx.currentTime + (options.delayMs ? options.delayMs / 1000 : 0);

        // Reference semantics: numLoops < 0 = infinite, 0 = play once, n > 0 = loop n additional times
        const requestedLoops = typeof options.loops === "number" ? options.loops : 0;

        if (requestedLoops < 0) {
            // Infinite loop (matches RawPcmStream.setNumLoopsInternal(-1))
            source.loop = true;
            source.loopStart = decoded.loopStartSec;
            source.loopEnd = decoded.loopEndSec > decoded.loopStartSec
                ? decoded.loopEndSec
                : buffer.duration;
            source.start(startTime);
        } else if (requestedLoops === 0) {
            // Play once (matches RawPcmStream.setNumLoopsInternal(0))
            source.start(startTime);
        } else {
            // Loop n times then stop
            source.loop = true;
            source.loopStart = decoded.loopStartSec;
            source.loopEnd = decoded.loopEndSec > decoded.loopStartSec
                ? decoded.loopEndSec
                : buffer.duration;
            source.start(startTime);
            source.stop(startTime + buffer.duration * (requestedLoops + 1));
        }

        this.registerSource(source, gainNode ? [gainNode] : []);
    }

    handleSeqFrameSounds(effects: SeqSoundEffect[], context?: SequenceSoundContext): void {
        const now = typeof performance !== "undefined" ? performance.now() : Date.now();
        for (const effect of effects) {
            const radiusTiles = typeof effect.location === "number" ? effect.location : 0;
            // OSRS parity: animation frame sound loops field uses 1-indexed semantics (client.java:5544
            // does setNumLoopsInternal(loops - 1)). loops=1 means play once, loops=2 means play twice.
            // Subtract 1 to convert to our internal semantics (0=play once, n>0=play n+1 times, -1=infinite).
            const loops = (typeof effect.loops === "number" ? effect.loops : 1) - 1;

            const locationKey =
                context?.position != null
                    ? `${effect.id}:${Math.round(context.position.x / 128)}:${Math.round(
                          context.position.y / 128,
                      )}`
                    : `${effect.id}`;
            const lastPlayed = this.lastPlayed.get(locationKey);
            const last = typeof lastPlayed === "number" ? lastPlayed : 0;
            if (now - last < 20) continue;
            this.lastPlayed.set(locationKey, now);

            const radiusOverride = context?.radiusOverride;
            const radiusScene =
                radiusOverride !== undefined
                    ? radiusOverride
                    : radiusTiles > 0
                    ? radiusTiles * 128
                    : undefined;

            this.playSoundEffect(effect.id, {
                loops,
                position: context?.position,
                radius: radiusScene,
                distanceFadeCurve: context?.distanceFadeCurve,
                isLocalPlayer: context?.isLocalPlayer,
            });
        }
    }

    updateAmbientSounds(instances: AmbientSoundInstance[]): void {
        const ctx = this.ensureContext();
        if (!ctx || !this.loader.available()) return;

        if (ctx.state === "suspended") {
            ctx.resume().catch(() => {});
        }

        const now = ctx.currentTime;
        const activeKeys = new Set<string>();

        for (const instance of instances) {
            const key = this.ambientKey(instance);
            activeKeys.add(key);

            const existing = this.ambientSounds.get(key);
            const volume = this.computeAmbientVolume(instance);

            if (existing) {
                existing.fadeInDurationSec = Math.max(
                    0,
                    (typeof instance.fadeInDurationMs === "number"
                        ? instance.fadeInDurationMs
                        : 300) / 1000,
                );
                existing.fadeOutDurationSec = Math.max(
                    0,
                    (typeof instance.fadeOutDurationMs === "number"
                        ? instance.fadeOutDurationMs
                        : 300) / 1000,
                );
                existing.fadeOutActive = false;
                existing.stopAt = undefined;

                this.adjustAmbientGain(existing, volume, ctx, now);

                const loopSoundId = instance.soundId >= 0 ? instance.soundId : undefined;
                if (loopSoundId !== existing.loopSoundId) {
                    try {
                        existing.loopSource?.stop();
                    } catch {}
                    try {
                        existing.loopSource?.disconnect();
                    } catch {}
                    existing.loopSource = undefined;
                    existing.loopSoundId = undefined;

                    if (loopSoundId !== undefined) {
                        const decodedLoop = this.decode(loopSoundId, undefined, true);
                        if (decodedLoop) {
                            const loopBuffer = this.prepareBuffer(decodedLoop, ctx, true);
                            const loopSource = ctx.createBufferSource();
                            loopSource.buffer = loopBuffer;
                            loopSource.loop = true;
                            loopSource.loopStart = decodedLoop.loopStartSec;
                            loopSource.loopEnd = decodedLoop.loopEndSec > decodedLoop.loopStartSec
                                ? decodedLoop.loopEndSec
                                : loopBuffer.duration;
                            loopSource.connect(existing.gainNode);
                            this.registerSource(loopSource);
                            loopSource.start(now);
                            existing.loopSource = loopSource;
                            existing.loopSoundId = loopSoundId;
                        } else {
                            console.warn(
                                `[SoundEffectSystem] Failed to decode ambient loop ${loopSoundId} for loc ${instance.locId}`,
                            );
                        }
                    }
                }

                const hasAlternates =
                    instance.soundIds !== undefined &&
                    instance.soundIds.length > 0 &&
                    instance.soundIds.some((id) => id !== undefined && id >= 0);

                if (!hasAlternates) {
                    existing.nextChangeTime = Infinity;
                    if (existing.overlaySource) {
                        try {
                            existing.overlaySource.stop();
                        } catch {}
                        try {
                            existing.overlaySource.disconnect();
                        } catch {}
                        existing.overlaySource = undefined;
                    }
                } else if (existing.nextChangeTime === Infinity) {
                    existing.nextChangeTime = this.computeNextChangeTime(instance, now);
                }

                existing.instance = instance;

                // Check if we need to change/replay sound
                if (now >= existing.nextChangeTime && existing.nextChangeTime !== Infinity) {
                    this.playOverlaySound(key, existing, instance, ctx, now);
                }
            } else {
                // Start new ambient sound
                this.startAmbientSound(key, instance, ctx, volume, now);
            }
        }

        // Stop sounds that are no longer in range
        for (const [key, active] of this.ambientSounds.entries()) {
            if (!activeKeys.has(key)) {
                this.beginAmbientFadeOut(key, active, ctx, now);
            }
            if (
                active.fadeOutActive &&
                active.stopAt !== undefined &&
                ctx.currentTime >= active.stopAt
            ) {
                this.stopAmbientSound(key, ctx);
            }
        }
    }

    private ambientKey(instance: AmbientSoundInstance): string {
        const quant = (value: number | undefined): number => {
            if (value === undefined || Number.isNaN(value)) return 0;
            return Math.round(value);
        };
        return `${instance.locId}_${quant(instance.x)}_${quant(instance.y)}_${quant(instance.z)}`;
    }

    private computeNextChangeTime(instance: AmbientSoundInstance, now: number): number {
        if (instance.deferSwap) {
            return Infinity;
        }

        const minDelay = Math.max(
            typeof instance.changeTicksMin === "number" ? instance.changeTicksMin : 0,
            0,
        );
        const maxDelay = Math.max(
            typeof instance.changeTicksMax === "number" ? instance.changeTicksMax : 0,
            minDelay,
        );

        if (minDelay === 0 && maxDelay === 0) {
            return Infinity;
        }

        // soundEffectMinDelay/MaxDelay are in game cycles (20ms each)
        const range = maxDelay - minDelay;
        const cycles = minDelay + (range > 0 ? Math.random() * range : 0);
        return now + cycles * CYCLE_LENGTH_SECONDS;
    }

    /**
     * Compute the easing value for a given progress (0..1) using the reference client's
     * EasingFunction curve types.
     */
    private static ease(progress: number, curveId: number = 0): number {
        if (progress <= 0) return 0;
        if (progress >= 1) return 1;
        switch (curveId) {
            case EasingCurveId.EASE_IN_SINE:
                return 1 - Math.cos(progress * Math.PI / 2);
            case EasingCurveId.EASE_OUT_SINE:
                return Math.sin(Math.PI * progress / 2);
            case EasingCurveId.EASE_IN_OUT_SINE:
                return -(Math.cos(progress * Math.PI) - 1) / 2;
            case EasingCurveId.EASE_IN_QUAD:
                return progress * progress;
            case EasingCurveId.EASE_OUT_QUAD:
                return 1 - (1 - progress) * (1 - progress);
            case EasingCurveId.EASE_IN_OUT_QUAD:
                return progress < 0.5
                    ? progress * 2 * progress
                    : 1 - Math.pow(progress * -2 + 2, 2) / 2;
            case EasingCurveId.EASE_IN_CUBIC:
                return progress * progress * progress;
            case EasingCurveId.EASE_OUT_CUBIC:
                return 1 - Math.pow(1 - progress, 3);
            case EasingCurveId.EASE_IN_OUT_CUBIC:
                return progress < 0.5
                    ? progress * (4 * progress) * progress
                    : 1 - Math.pow(2 + progress * -2, 3) / 2;
            case EasingCurveId.EASE_IN_QUART:
                return progress * progress * progress * progress;
            case EasingCurveId.EASE_OUT_QUART:
                return 1 - Math.pow(1 - progress, 4);
            case EasingCurveId.EASE_IN_OUT_QUART:
                return progress < 0.5
                    ? progress * (progress * 8 * progress) * progress
                    : 1 - Math.pow(2 + -2 * progress, 4) / 2;
            case EasingCurveId.EASE_IN_QUINT:
                return progress * progress * progress * progress * progress;
            case EasingCurveId.EASE_OUT_QUINT:
                return 1 - Math.pow(1 - progress, 5);
            case EasingCurveId.EASE_IN_OUT_QUINT:
                return progress < 0.5
                    ? progress * (progress * 8 * progress * progress * progress)
                    : 1 - Math.pow(2 + progress * -2, 5) / 2;
            case EasingCurveId.EASE_IN_EXPO:
                return Math.pow(2, 10 * progress - 10);
            case EasingCurveId.EASE_OUT_EXPO:
                return 1 - Math.pow(2, -10 * progress);
            case EasingCurveId.EASE_IN_OUT_EXPO:
                return progress < 0.5
                    ? Math.pow(2, 20 * progress - 10) / 2
                    : (2 - Math.pow(2, -20 * progress + 10)) / 2;
            case EasingCurveId.EASE_IN_CIRC:
                return 1 - Math.sqrt(1 - progress * progress);
            case EasingCurveId.EASE_OUT_CIRC:
                return Math.sqrt(1 - (progress - 1) * (progress - 1));
            case EasingCurveId.EASE_IN_OUT_CIRC:
                return progress < 0.5
                    ? (1 - Math.sqrt(1 - Math.pow(2 * progress, 2))) / 2
                    : (Math.sqrt(1 - Math.pow(-2 * progress + 2, 2)) + 1) / 2;
            case EasingCurveId.EASE_IN_BACK: {
                const c1 = 1.70158;
                return (c1 + 1) * progress * progress * progress - c1 * progress * progress;
            }
            case EasingCurveId.EASE_OUT_BACK: {
                const c1 = 1.70158;
                const p1 = progress - 1;
                return 1 + (c1 + 1) * p1 * p1 * p1 + c1 * p1 * p1;
            }
            case EasingCurveId.EASE_IN_OUT_BACK: {
                const c2 = 1.70158 * 1.525;
                return progress < 0.5
                    ? (Math.pow(2 * progress, 2) * ((c2 + 1) * 2 * progress - c2)) / 2
                    : (Math.pow(2 * progress - 2, 2) * ((c2 + 1) * (progress * 2 - 2) + c2) + 2) / 2;
            }
            case EasingCurveId.EASE_IN_ELASTIC: {
                const c4 = (2 * Math.PI) / 3;
                return -Math.pow(2, 10 * progress - 10) * Math.sin((progress * 10 - 10.75) * c4);
            }
            case EasingCurveId.EASE_OUT_ELASTIC: {
                const c4 = (2 * Math.PI) / 3;
                return Math.pow(2, -10 * progress) * Math.sin((progress * 10 - 0.75) * c4) + 1;
            }
            case EasingCurveId.EASE_IN_OUT_ELASTIC: {
                const c5 = (2 * Math.PI) / 4.5;
                return progress < 0.5
                    ? -(Math.pow(2, 20 * progress - 10) * Math.sin((20 * progress - 11.125) * c5)) / 2
                    : (Math.pow(2, -20 * progress + 10) * Math.sin((20 * progress - 11.125) * c5)) / 2 + 1;
            }
            case EasingCurveId.LINEAR:
            default:
                return progress;
        }
    }

    /**
     * Compute manhattan distance from a point to a rectangle, minus half a tile (64 fine units).
     * Matches the reference client's distanceToAmbientSoundRect.
     */
    private static distanceToRect(
        px: number, py: number,
        minX: number, minY: number,
        maxX: number, maxY: number,
    ): number {
        let dist = 0;
        if (px < minX) dist += minX - px;
        else if (px > maxX) dist += px - maxX;
        if (py < minY) dist += minY - py;
        else if (py > maxY) dist += py - maxY;
        return Math.max(dist - 64, 0);
    }

    /**
     * Compute distance-based volume for an ambient sound instance.
     * Uses minDistance/maxDistance with easing curve, matching the reference client.
     */
    private computeAmbientVolume(instance: AmbientSoundInstance): number {
        // Compute effective size considering orientation
        let sx = instance.sizeX || 1;
        let sy = instance.sizeY || 1;
        if (instance.orientation === 1 || instance.orientation === 3) {
            const tmp = sx;
            sx = sy;
            sy = tmp;
        }

        // Compute object rectangle bounds in scene fine coordinates
        // x,y are tile center (origin + 64), so subtract 64 to get tile origin
        const minX = instance.x - 64;
        const minY = instance.y - 64;
        const maxX = minX + sx * 128;
        const maxY = minY + sy * 128;

        const dist = SoundEffectSystem.distanceToRect(
            this.listenerX, this.listenerY,
            minX, minY, maxX, maxY,
        );

        const maxDistTiles = instance.distanceOverride !== undefined && instance.distanceOverride >= 0
            ? instance.distanceOverride
            : instance.maxDistance;
        const maxDist = maxDistTiles * 128;
        const minDist = Math.max(((instance.minDistance || 0) - 1) * 128, 0);

        if (minDist < maxDist) {
            // Distance attenuation zone: full volume inside minDist, fades to 0 at maxDist.
            // ease() clamps progress to [0,1] so dist > maxDist naturally gives 0.
            const curveId = instance.distanceFadeCurve ?? 0;
            const progress = (maxDist - dist) / (maxDist - minDist);
            return SoundEffectSystem.ease(Math.max(0, Math.min(1, progress)), curveId);
        }
        // minDistance >= maxDistance: no distance attenuation, full volume everywhere
        return 1;
    }

    private scheduleGainRamp(
        gain: AudioParam,
        startTime: number,
        from: number,
        to: number,
        duration: number,
        curveId?: number,
    ): void {
        const fn = this.getFadeCurve(curveId);
        const steps = Math.max(2, Math.ceil(duration / 0.05));
        gain.setValueAtTime(from, startTime);
        for (let i = 1; i <= steps; i++) {
            const progress = i / steps;
            const shaped = fn(progress);
            const value = from + (to - from) * shaped;
            gain.linearRampToValueAtTime(value, startTime + progress * duration);
        }
    }

    private getFadeCurve(curveId?: number): (t: number) => number {
        const id = curveId ?? 0;
        return (t) => SoundEffectSystem.ease(t, id);
    }

    private adjustAmbientGain(
        active: ActiveAmbientSound,
        targetGain: number,
        ctx: AudioContext,
        now: number,
    ): void {
        const gain = active.gainNode.gain;
        gain.cancelScheduledValues(now);
        const current = gain.value;
        if (Math.abs(current - targetGain) < 0.001) return;
        gain.setValueAtTime(current, now);

        // Use fadeIn curve/duration when volume is increasing, fadeOut when decreasing
        const increasing = targetGain > current;
        const baseDuration = increasing
            ? (active.fadeInDurationSec > 0 ? active.fadeInDurationSec : 0.05)
            : (active.fadeOutDurationSec > 0 ? active.fadeOutDurationSec : 0.05);
        const curveId = increasing
            ? active.instance.fadeInCurve
            : active.instance.fadeOutCurve;

        // Scale fade duration proportionally to the volume delta.
        // Matches reference scaleIntByRatio: smaller volume changes → shorter fades.
        const delta = Math.abs(current - targetGain);
        const ramp = delta >= 1 ? baseDuration : baseDuration * delta;

        if (ramp > 0.001) {
            this.scheduleGainRamp(gain, now, current, targetGain, ramp, curveId);
        } else {
            gain.setValueAtTime(targetGain, now);
        }
    }

    private beginAmbientFadeOut(
        key: string,
        active: ActiveAmbientSound,
        ctx: AudioContext,
        now: number,
    ): void {
        if (active.fadeOutActive) {
            return;
        }
        // Quick 150ms linear fade when sound leaves range entirely,
        // matching the reference's hardcoded 150ms linear fallback.
        const duration = 0.15;
        const gain = active.gainNode.gain;
        gain.cancelScheduledValues(now);
        const current = gain.value;
        gain.setValueAtTime(current, now);
        this.scheduleGainRamp(gain, now, current, 0, duration, EasingCurveId.LINEAR);
        active.fadeOutActive = true;
        active.stopAt = now + duration;
    }

    private startAmbientSound(
        key: string,
        instance: AmbientSoundInstance,
        ctx: AudioContext,
        volume: number,
        now: number,
    ): void {
        const gainNode = ctx.createGain();
        // Connect ambient sounds through the ambient gain node (separate from SFX)
        if (!this.ambientGainNode) {
            this.ambientGainNode = ctx.createGain();
            this.ambientGainNode.gain.value = this.ambientVolume;
            this.ambientGainNode.connect(ctx.destination);
        }
        gainNode.connect(this.ambientGainNode);

        const loopSoundId = instance.soundId >= 0 ? instance.soundId : undefined;
        let loopSource: AudioBufferSourceNode | undefined;
        if (loopSoundId !== undefined) {
            const decodedLoop = this.decode(loopSoundId, undefined, true); // Force resample to AudioContext rate
            if (!decodedLoop) {
                console.warn(
                    `[SoundEffectSystem] Failed to decode ambient loop ${loopSoundId} for loc ${instance.locId}`,
                );
            } else {
                const loopBuffer = this.prepareBuffer(decodedLoop, ctx, true);
                loopSource = ctx.createBufferSource();
                loopSource.buffer = loopBuffer;
                loopSource.loop = true;
                loopSource.loopStart = decodedLoop.loopStartSec;
                loopSource.loopEnd = decodedLoop.loopEndSec > decodedLoop.loopStartSec
                    ? decodedLoop.loopEndSec
                    : loopBuffer.duration;
                loopSource.connect(gainNode);
                this.registerSource(loopSource);
                loopSource.start(now);
            }
        }

        const fadeInSec = Math.max(
            0,
            (typeof instance.fadeInDurationMs === "number"
                ? instance.fadeInDurationMs
                : 300) / 1000,
        );
        const fadeOutSec = Math.max(
            0,
            (typeof instance.fadeOutDurationMs === "number"
                ? instance.fadeOutDurationMs
                : 300) / 1000,
        );

        const targetGain = volume;

        gainNode.gain.cancelScheduledValues(now);
        if (fadeInSec > 0) {
            gainNode.gain.setValueAtTime(0, now);
            this.scheduleGainRamp(
                gainNode.gain,
                now,
                0,
                targetGain,
                fadeInSec,
                instance.fadeInCurve,
            );
        } else {
            gainNode.gain.setValueAtTime(targetGain, now);
        }

        const hasAlternates = !!(
            instance.soundIds &&
            instance.soundIds.length > 0 &&
            instance.soundIds.some((id) => id !== undefined && id >= 0)
        );
        const nextChangeTime = hasAlternates ? this.computeNextChangeTime(instance, now) : Infinity;

        this.ambientSounds.set(key, {
            instance,
            gainNode,
            loopSource,
            loopSoundId: loopSource ? loopSoundId : undefined,
            overlaySource: undefined,
            nextChangeTime,
            currentSoundIndex: hasAlternates ? -1 : 0,
            fadeInDurationSec: fadeInSec,
            fadeOutDurationSec: fadeOutSec,
            fadeOutActive: false,
        });
    }

    private playOverlaySound(
        key: string,
        active: ActiveAmbientSound,
        instance: AmbientSoundInstance,
        ctx: AudioContext,
        now: number,
    ): void {
        if (!instance.soundIds || instance.soundIds.length === 0) {
            active.nextChangeTime = Infinity;
            return;
        }

        // Filter out undefined/invalid sound IDs
        const validSoundIds = instance.soundIds.filter((id) => id !== undefined && id >= 0);
        if (validSoundIds.length === 0) {
            active.nextChangeTime = Infinity;
            return;
        }

        if (active.overlaySource) {
            try {
                active.overlaySource.stop();
            } catch {}
            active.overlaySource.disconnect();
            active.overlaySource = undefined;
        }

        // Determine which sound to play next
        let nextSoundId: number;
        let nextIndex: number;

        if (validSoundIds.length > 0) {
            // Multi-sound ambient: pick next sound from array
            if (instance.loopSequentially) {
                nextIndex = (active.currentSoundIndex + 1) % validSoundIds.length;
            } else {
                const count = validSoundIds.length;
                if (count === 1) {
                    nextIndex = 0;
                } else {
                    let candidate = active.currentSoundIndex;
                    while (candidate === active.currentSoundIndex) {
                        candidate = Math.floor(Math.random() * count);
                    }
                    nextIndex = candidate;
                }
            }
            nextSoundId = validSoundIds[nextIndex];
        } else {
            // Single sound ambient: replay the same sound
            nextSoundId = instance.soundId;
            nextIndex = Math.max(active.currentSoundIndex, 0);
        }

        const decoded = this.decode(nextSoundId);
        if (!decoded) {
            return;
        }

        const buffer = this.prepareBuffer(decoded, ctx);
        const source = ctx.createBufferSource();
        source.buffer = buffer;

        source.loop = false;
        const overlayGain = ctx.createGain();
        overlayGain.gain.setValueAtTime(0, now);
        const fadeIn = Math.min(0.05, Math.max(0.005, buffer.duration * 0.1));
        const fadeOut = Math.min(0.05, Math.max(0.005, buffer.duration * 0.1));
        const sustainEnd = Math.max(now + fadeIn, now + buffer.duration - fadeOut);
        overlayGain.gain.linearRampToValueAtTime(1, now + fadeIn);
        overlayGain.gain.setValueAtTime(1, sustainEnd);
        overlayGain.gain.linearRampToValueAtTime(0, now + buffer.duration);

        source.connect(overlayGain);
        overlayGain.connect(active.gainNode);
        source.addEventListener("ended", () => {
            try {
                source.disconnect();
                overlayGain.disconnect();
            } catch {}
            if (active.overlaySource === source) {
                active.overlaySource = undefined;
            }
        });
        this.registerSource(source, [overlayGain]);
        source.start(now);

        active.overlaySource = source;
        active.currentSoundIndex = nextIndex;
        active.nextChangeTime = this.computeNextChangeTime(instance, now);
        active.fadeOutActive = false;
        active.stopAt = undefined;
        active.instance = instance;
    }

    private stopAmbientSound(key: string, ctx?: AudioContext): void {
        const active = this.ambientSounds.get(key);
        if (!active) return;

        try {
            active.loopSource?.stop();
        } catch {}
        try {
            active.overlaySource?.stop();
        } catch {}
        try {
            active.loopSource?.disconnect();
        } catch {}
        try {
            active.overlaySource?.disconnect();
        } catch {}
        try {
            active.gainNode.disconnect();
        } catch {}
        this.disconnectNodes([active.gainNode]);

        this.ambientSounds.delete(key);
    }

    stopAllAmbientSounds(): void {
        const ctx = this.context;
        for (const key of this.ambientSounds.keys()) {
            this.stopAmbientSound(key, ctx);
        }
    }

    dispose(): void {
        // Stop all active sources
        for (const source of this.activeSources) {
            try {
                source.stop();
                source.disconnect();
            } catch {}
        }
        this.activeSources.length = 0;

        // Stop all ambient sounds
        this.stopAllAmbientSounds();

        // Remove event listeners
        this.removeContextListeners();

        // Disconnect and close audio context
        if (this.gainNode) {
            this.gainNode.disconnect();
            this.gainNode = undefined;
        }
        if (this.ambientGainNode) {
            this.ambientGainNode.disconnect();
            this.ambientGainNode = undefined;
        }
        if (this.context) {
            this.context.close().catch(() => {});
            this.context = undefined;
        }

        // Clear caches
        this.decodedCache.clear();
        this.lastPlayed.clear();
        this.warnedSounds.clear();
    }
}
