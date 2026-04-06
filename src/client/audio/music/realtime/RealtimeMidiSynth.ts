/**
 * Real-time MIDI synthesizer for OSRS music.
 * Coordinates between the main thread (sample loading, MIDI parsing) and the AudioWorklet.
 */
import { CacheSystem } from "../../../../rs/cache/CacheSystem";
import { IndexType } from "../../../../rs/cache/IndexType";
import { ByteBuffer } from "../../../../rs/io/ByteBuffer";
import { addAudioContextResumeListeners, getAudioContextConstructor } from "../../audioContext";
import { MusicPatch } from "../patch/MusicPatch";
import { MusicTrack } from "../patch/MusicTrack";
import { SoundCache } from "../patch/SoundCache";

// MIDI event types we care about
interface MidiNoteOn {
    type: "noteOn";
    tick: number;
    channel: number;
    key: number;
    velocity: number;
}

interface MidiNoteOff {
    type: "noteOff";
    tick: number;
    channel: number;
    key: number;
    velocity: number;
}

interface MidiControlChange {
    type: "controlChange";
    tick: number;
    channel: number;
    controller: number;
    value: number;
}

interface MidiProgramChange {
    type: "programChange";
    tick: number;
    channel: number;
    program: number;
}

interface MidiPitchBend {
    type: "pitchBend";
    tick: number;
    channel: number;
    value: number;
}

interface MidiTempo {
    type: "tempo";
    tick: number;
    microsPerQuarter: number;
}

interface MidiEndOfTrack {
    type: "endOfTrack";
    tick: number;
}

// Internal sequence number for stable sorting at same tick
interface MidiEventBase {
    _seq?: number;
}

type MidiEvent = (
    | MidiNoteOn
    | MidiNoteOff
    | MidiControlChange
    | MidiProgramChange
    | MidiPitchBend
    | MidiTempo
    | MidiEndOfTrack
) &
    MidiEventBase;

export class RealtimeMidiSynth {
    private cache: CacheSystem;
    private soundCache: SoundCache;
    private context: AudioContext | null = null;
    private workletNode: AudioWorkletNode | null = null;
    private gainNode: GainNode | null = null;
    private outputGain: number = 1.0;
    private workletReady: boolean = false;

    // Patch cache
    private patchCache = new Map<number, MusicPatch>();
    private readonly MAX_PATCH_CACHE_SIZE = 50;

    // Memory leak fix: track context resume listener cleanup
    private contextResumeCleanup: (() => void) | null = null;
    // Visibility change listener to recover from tab throttling
    private visibilityListener: (() => void) | null = null;

    // Sample cache (index -> already sent to worklet)
    private loadedSamples = new Set<number>();

    // Current playback state
    private events: MidiEvent[] = [];
    private eventIndex: number = 0;
    private division: number = 480;
    private currentTempo: number = 500000; // microseconds per quarter note (120 BPM)
    private startTime: number = 0;
    private pauseTime: number = 0;
    private pausedTick: number = 0; // FIX A5: Store tick position when paused
    private isPlaying: boolean = false;
    private isPaused: boolean = false;
    private looping: boolean = true;
    private trackDurationTicks: number = 0;

    // Tempo map for accurate timing
    private tempoMap: { tick: number; tempo: number; timeMs: number }[] = [];
    private trackDurationMs: number = 0;

    // Program to patch mapping per channel
    private channelPatches: (MusicPatch | null)[] = new Array(16).fill(null);
    private channelPrograms: number[] = new Array(16).fill(0);
    private channelBanks: Int32Array = new Int32Array(16).fill(0);

    // Timer for event scheduling
    private schedulerTimer: any = null; // can be number or NodeJS.Timeout
    private lastScheduledTick: number = 0;
    // Browsers throttle setTimeout to 1000ms+ when tab is inactive/loading
    // Use 3-second lookahead to ensure buffer doesn't run dry during throttling
    private readonly LOOKAHEAD = 3.0;
    private readonly SCHEDULER_INTERVAL = 200; // Run scheduler every 200ms (may be throttled)

    constructor(cache: CacheSystem) {
        this.cache = cache;
        this.soundCache = new SoundCache(cache);
        this.channelBanks[9] = 128; // Channel 10 defaults to bank 1 (drums)
    }

    /**
     * Initialize the audio context and worklet
     */
    async initialize(): Promise<boolean> {
        if (this.workletReady) return true;

        try {
            // Create audio context
            const AudioCtx = getAudioContextConstructor();
            if (!AudioCtx) {
                console.error("[RealtimeMidiSynth] Web Audio not supported");
                return false;
            }

            const ctx = new AudioCtx({ sampleRate: 44100 });
            this.context = ctx;

            // Auto-resume on user interaction (required by browser autoplay policy)
            if (!this.contextResumeCleanup) {
                this.contextResumeCleanup = addAudioContextResumeListeners(ctx, () => {
                    this.contextResumeCleanup = null;
                });
            }

            // Listen for visibility changes to recover from browser throttling
            // When tab becomes visible again, immediately reschedule to catch up
            if (!this.visibilityListener) {
                this.visibilityListener = () => {
                    if (
                        document.visibilityState === "visible" &&
                        this.isPlaying &&
                        !this.isPaused
                    ) {
                        // Tab became visible - immediately reschedule to catch up
                        if (this.schedulerTimer !== null) {
                            clearTimeout(this.schedulerTimer);
                            this.schedulerTimer = null;
                        }
                        this.scheduleEvents();
                    }
                };
                document.addEventListener("visibilitychange", this.visibilityListener);
            }

            // Create and register worklet
            const workletCode = await this.getWorkletCode();
            const blob = new Blob([workletCode], { type: "application/javascript" });
            const url = URL.createObjectURL(blob);

            try {
                await this.context.audioWorklet.addModule(url);
            } finally {
                URL.revokeObjectURL(url);
            }

            // Create worklet node
            this.workletNode = new AudioWorkletNode(this.context, "music-worklet-processor", {
                numberOfInputs: 0,
                numberOfOutputs: 1,
                outputChannelCount: [2],
            });

            // Create gain node at unity. OSRS MIDI volume is handled inside the synth
            // Avoid double-scaling here.
            this.gainNode = this.context.createGain();
            this.gainNode.gain.value = 1.0;

            // Connect nodes
            this.workletNode.connect(this.gainNode);
            this.gainNode.connect(this.context.destination);

            this.workletReady = true;
            return true;
        } catch (e) {
            console.error("[RealtimeMidiSynth] Failed to initialize:", e);
            return false;
        }
    }

    private removeContextListeners(): void {
        if (this.contextResumeCleanup) {
            const cleanup = this.contextResumeCleanup;
            this.contextResumeCleanup = null;
            cleanup();
        }
    }

    /**
     * Generate the worklet processor code
     */
    private async getWorkletCode(): Promise<string> {
        // Import the processor code - in production this would be bundled
        // For now, we inline a complete implementation
        return `
${this.getWorkletProcessorCode()}
`;
    }

    /**
     * Get the worklet processor implementation
     */
    private getWorkletProcessorCode(): string {
        // This is a complete inline version of MusicWorkletProcessor
        return `
const OUTPUT_SAMPLE_RATE = 22050;

// B5: Pre-computed sine lookup table (512 entries, matching OSRS)
// OSRS uses a 512-entry table with values scaled to integer range
const SIN_TABLE = new Int32Array(512);
for (let i = 0; i < 512; i++) {
    // OSRS stores as fixed-point: sin(i * 2π / 512) * 32768
    SIN_TABLE[i] = Math.round(Math.sin(i * Math.PI / 256) * 32768);
}

// B5: Pre-computed 2^x lookup table for envelope rate scaling
// OSRS uses: Math.pow(2, x * 4.921259842519685E-4) for portamento
// and Math.pow(2, x * 5.086263020833333E-6) for pitch scaling
// We'll compute these on-demand but with integer approximations

class MusicWorkletProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.samples = new Map();
        this.activeNotes = [];
        this.channels = [];
        this.masterVolume = 256;
        this.nextNoteId = 0;
        this.noteMap = new Map();
        this.noteOnCount = 0;
        this.noteAddedCount = 0;

        // FIX: Calculate 50Hz tick based on ACTUAL sample rate (e.g. 48000 / 50 = 960)
        // 'sampleRate' is a global variable in AudioWorkletGlobalScope
        this.samplesPerTick = Math.floor(sampleRate / 50);

        // B6: Global tick counter for synchronized envelope updates
        this.globalTickCounter = 0;
        this.globalSampleCounter = 0;

        // B1: Track current frame for sample-accurate event timing
        this.currentFrameInBlock = 0;

        for (let i = 0; i < 16; i++) {
            this.channels.push(this.createDefaultChannelState());
        }

        this.port.onmessage = (event) => {
            this.handleMessage(event.data);
        };
    }

    createDefaultChannelState() {
        return {
            volume: 12800,
            pan: 8192,
            expression: 16383,
            pitchBend: 8192,
            pitchBendRange: 256,  // FIX B4: Default 2 semitones = 2 << 7 = 256
            modulation: 0,
            sustain: false,
            portamento: false,
            portamentoRate: 8192,  // CC 5/37 - controls pitch slide speed
            portamentoControl: false,  // CC 81 - additional portamento behavior flag
            program: 0,
            sostenuto: false,
            rpnMsb: 127,
            rpnLsb: 127,
            dataEntryMsb: 0,
            dataEntryLsb: 0,
            sampleOffset: 0,
            sostenutoNotes: new Set(),
        };
    }

    handleMessage(msg) {
        if (typeof msg.time === 'number') {
            // Scheduled event
            this.insertIntoQueue(msg);
        } else {
            // Immediate event
            this.dispatchMessage(msg);
        }
    }

    insertIntoQueue(msg) {
        // Simple insertion sort to keep queue ordered by time
        if (!this.eventQueue) this.eventQueue = [];
        
        // Optimization: check if it goes at the end (common case for sequential midi)
        if (this.eventQueue.length === 0 || msg.time >= this.eventQueue[this.eventQueue.length - 1].time) {
            this.eventQueue.push(msg);
            return;
        }

        let i = this.eventQueue.length - 1;
        while (i >= 0 && this.eventQueue[i].time > msg.time) {
            i--;
        }
        this.eventQueue.splice(i + 1, 0, msg);
    }

    dispatchMessage(msg) {
        switch (msg.type) {
            case "loadSample":
                this.samples.set(msg.index, {
                    samples: msg.samples,
                    sampleRate: msg.sampleRate,
                    looped: msg.looped,
                    loopStart: msg.loopStart,
                    loopEnd: msg.loopEnd,
                });
                break;

            case "noteOn":
                this.handleNoteOn(msg);
                break;

            case "noteOff":
                this.handleNoteOff(msg.channel, msg.key);
                break;

            case "controlChange":
                this.handleControlChange(msg.channel, msg.controller, msg.value);
                break;

            case "pitchBend":
                this.channels[msg.channel].pitchBend = msg.value;
                break;

            case "programChange":
                this.channels[msg.channel].program = msg.program;
                break;

            case "setVolume":
                this.masterVolume = msg.volume;
                break;

            case "stopAll":
                this.activeNotes = [];
                this.noteMap.clear();
                this.eventQueue = []; // Clear scheduled events too
                for (let i = 0; i < 16; i++) {
                    this.channels[i] = this.createDefaultChannelState();
                }
                // Reset stats
                this.noteOnCount = 0;
                this.noteAddedCount = 0;
                this.channelAdds = {};
                // B6: Reset global tick counters
                this.globalTickCounter = 0;
                this.globalSampleCounter = 0;
                break;
        }
    }

    handleNoteOn(msg) {
        this.noteOnCount++;
        const ch = this.channels[msg.channel];
        const noteKey = msg.channel + ":" + msg.key;

        // Verify sample exists
        const sample = this.samples.get(msg.sampleIndex);
        if (!sample) {
            console.warn('[Worklet] noteOn: sample ' + msg.sampleIndex + ' not found! Available samples: ' + this.samples.size);
            return;
        }

        // Handle exclusive class - stop notes of same class
        if (msg.exclusiveClass >= 0) {
            for (const note of this.activeNotes) {
                if (note.channel === msg.channel && note.exclusiveClass === msg.exclusiveClass && note.releaseProgress < 0) {
                    note.releaseProgress = 0;
                }
            }
        }

        // Handle portamento - slide existing note's pitch to new note
        // When portamento is set, find any active note
        // on this channel and slide its pitch to the new key instead of creating a new note
        if (ch.portamento) {
            // Find any active note on this channel (not just this key)
            for (const existingNote of this.activeNotes) {
                if (existingNote.channel === msg.channel && existingNote.releaseProgress < 0) {
                    // Remove old key mapping
                    const oldKey = msg.channel + ":" + existingNote.key;
                    if (this.noteMap.get(oldKey) === existingNote) {
                        this.noteMap.delete(oldKey);
                    }

                    // Java formula from 

                    // Calculate current interpolated pitch
                    const currentPitch = ((existingNote.pitchSlideProgress * existingNote.pitchSlideTarget) >> 12) + existingNote.basePitch;

                    // Update basePitch: add the key difference in pitch units (256 per semitone)
                    existingNote.basePitch += (msg.key - existingNote.key) << 8;

                    // Set slide target to current pitch minus new base pitch
                    // This makes the note start at currentPitch and slide toward the new basePitch
                    existingNote.pitchSlideTarget = currentPitch - existingNote.basePitch;
                    existingNote.pitchSlideProgress = 4096;
                    existingNote.key = msg.key;

                    // Update key mapping
                    this.noteMap.set(noteKey, existingNote);
                    return; // Don't create new note
                }
            }
        }

        // Release existing note on this key
        const existing = this.noteMap.get(noteKey);
        if (existing && existing.releaseProgress < 0) {
            existing.releaseProgress = 0;
        }

        // Apply sample offset if set
        let initialSamplePosition = 0;
        if (ch.sampleOffset > 0 && sample) {
            // FIX B7: Sample offset is a 14-bit fraction (CC16 MSB + CC48 LSB)
            // Use >> 14 to scale to sample position (0 to sample length)
            const offsetSamples = Math.floor((sample.samples.length * ch.sampleOffset) >> 14);
            if (msg.looped && sample.loopEnd > sample.loopStart) {
                // For looped samples, wrap around within loop
                const loopLen = sample.loopEnd - sample.loopStart;
                if (offsetSamples < sample.loopEnd) {
                    initialSamplePosition = offsetSamples;
                } else {
                    initialSamplePosition = sample.loopStart + ((offsetSamples - sample.loopStart) % loopLen);
                }
            } else {
                initialSamplePosition = Math.min(offsetSamples, sample.samples.length - 1);
            }
        }

        const note = {
            noteId: this.nextNoteId++,
            channel: msg.channel,
            key: msg.key,
            velocity: msg.velocity,
            sampleIndex: msg.sampleIndex,
            basePitch: msg.basePitch,
            patchVolume: msg.patchVolume,
            pan: msg.pan,
            exclusiveClass: msg.exclusiveClass,
            looped: msg.looped,
            loopStart: msg.loopStart,
            loopEnd: msg.loopEnd,
            sampleRate: msg.sampleRate,
            samplePosition: initialSamplePosition,
            pitchSlideTarget: 0,
            pitchSlideProgress: 4096,
            releaseProgress: -1,
            volumeEnvPosition: 0,
            volumeEnvIndex: 0,
            releaseEnvPosition: 0,
            releaseEnvIndex: 0,
            vibratoPhase: 0,
            vibratoTicks: 0,
            decayPosition: 0,
            ticksElapsed: 0,
            active: true,
            noteOffReceived: false,
            volumeEnvelope: msg.volumeEnvelope,
            releaseEnvelope: msg.releaseEnvelope,
            decayRate: msg.decayRate,
            volumeEnvRate: msg.volumeEnvRate,
            releaseEnvRate: msg.releaseEnvRate,
            decayModifier: msg.decayModifier,
            vibratoDepth: msg.vibratoDepth,
            vibratoRate: msg.vibratoRate,
            vibratoDelay: msg.vibratoDelay,
        };

        this.activeNotes.push(note);
        this.noteMap.set(noteKey, note);
        this.noteAddedCount++;

        // Track per-channel adds
        this.channelAdds = this.channelAdds || {};
        this.channelAdds[msg.channel] = (this.channelAdds[msg.channel] || 0) + 1;
    }

    handleNoteOff(channel, key) {
        // Channel 10 (index 9) is Percussion. Vanilla OSRS deliberately ignores Note-Off here
        // so cymbals/drum samples ring out naturally; cutting them early sounds wrong.
        // IMPORTANT: keep this behavior unless you also re-author percussion patches/tracks.
        if (channel === 9) return;

        const ch = this.channels[channel];
        const noteKey = channel + ":" + key;
        const note = this.noteMap.get(noteKey);

        if (!note || note.releaseProgress >= 0) return;

        // Mark that note-off was received (for pedal release logic)
        note.noteOffReceived = true;

        // Check sustain pedal - hold note until pedal is released
        if (ch.sustain) return;

        // Check sostenuto pedal - only holds notes that were pressed when pedal was pressed
        if (ch.sostenuto && ch.sostenutoNotes.has(note.noteId)) return;

        note.releaseProgress = 0;
    }

    handleControlChange(channel, controller, value) {
        const ch = this.channels[channel];

        switch (controller) {
            // Volume MSB/LSB
            case 7: ch.volume = (value << 7) + (ch.volume & 0x7F); break;
            case 39: ch.volume = (ch.volume & 0x3F80) + value; break;
            // Pan MSB/LSB
            case 10: ch.pan = (value << 7) + (ch.pan & 0x7F); break;
            case 42: ch.pan = (ch.pan & 0x3F80) + value; break;
            // Expression MSB/LSB
            case 11: ch.expression = (value << 7) + (ch.expression & 0x7F); break;
            case 43: ch.expression = (ch.expression & 0x3F80) + value; break;
            // Modulation MSB/LSB
            case 1: ch.modulation = (value << 7) + (ch.modulation & 0x7F); break;
            case 33: ch.modulation = (ch.modulation & 0x3F80) + value; break;
            // Portamento Time MSB/LSB (CC 5/37)
            case 5: ch.portamentoRate = (value << 7) + (ch.portamentoRate & 0x7F); break;
            case 37: ch.portamentoRate = (ch.portamentoRate & 0x3F80) + value; break;
            // Data Entry MSB/LSB (for RPN/NRPN)
            case 6:
                ch.dataEntryMsb = value;
                this.applyDataEntry(channel);
                break;
            case 38:
                ch.dataEntryLsb = value;
                this.applyDataEntry(channel);
                break;
            // Sample offset MSB/LSB (GP Slider 1)
            case 16: ch.sampleOffset = (value << 7) + (ch.sampleOffset & 0x7F); break;
            case 48: ch.sampleOffset = (ch.sampleOffset & 0x3F80) + value; break;
            // Sustain pedal (CC 64)
            case 64:
                if (value >= 64) {
                    ch.sustain = true;
                } else {
                    ch.sustain = false;
                    // Release all notes that had note-off while sustain was held
                    for (const note of this.activeNotes) {
                        if (note.channel === channel && note.releaseProgress < 0 && note.noteOffReceived) {
                            note.releaseProgress = 0;
                        }
                    }
                }
                break;
            // Portamento (CC 65) - controls pitch slide behavior
            // Portamento flag
            case 65:
                if (value >= 64) {
                    ch.portamento = true;
                } else {
                    // When portamento is turned OFF, release any "orphan" notes
                    // that were pitch-slid away from their original key
                    // Java  if note's key is not in noteMap but note is still active, release it
                    if (ch.portamento) {
                        for (const note of this.activeNotes) {
                            if (note.channel === channel && note.releaseProgress < 0) {
                                const noteKey = channel + ":" + note.key;
                                if (this.noteMap.get(noteKey) !== note) {
                                    // This note was slid to a different key and is orphaned
                                    note.releaseProgress = 0;
                                }
                            }
                        }
                    }
                    ch.portamento = false;
                }
                break;
            // Sostenuto pedal (CC 66)
            case 66:
                if (value >= 64) {
                    ch.sostenuto = true;
                    // Mark currently held notes for sostenuto
                    ch.sostenutoNotes = new Set();
                    for (const note of this.activeNotes) {
                        if (note.channel === channel && note.releaseProgress < 0) {
                            ch.sostenutoNotes.add(note.noteId);
                        }
                    }
                } else {
                    ch.sostenuto = false;
                    // Release sostenuto notes that had note-off while pedal was held
                    for (const note of this.activeNotes) {
                        if (note.channel === channel && note.releaseProgress < 0 &&
                            ch.sostenutoNotes.has(note.noteId) && note.noteOffReceived) {
                            note.releaseProgress = 0;
                        }
                    }
                    ch.sostenutoNotes = new Set();
                }
                break;
            // Portamento Control (CC 81) - additional portamento behavior
            case 81:
                if (value >= 64) {
                    ch.portamentoControl = true;
                } else {
                    ch.portamentoControl = false;
                }
                break;
            // RPN LSB (CC 100)
            case 100: ch.rpnLsb = value; break;
            // RPN MSB (CC 101)
            case 101: ch.rpnMsb = value; break;
            // All Sound Off (CC 120)
            case 120:
                // FIX A6: Also clean noteMap entries for this channel
                for (const note of this.activeNotes) {
                    if (note.channel === channel) {
                        const noteKey = channel + ":" + note.key;
                        if (this.noteMap.get(noteKey) === note) {
                            this.noteMap.delete(noteKey);
                        }
                    }
                }
                this.activeNotes = this.activeNotes.filter(n => n.channel !== channel);
                break;
            // Reset All Controllers (CC 121)
            case 121:
                ch.volume = 12800;
                ch.pan = 8192;
                ch.expression = 16383;
                ch.pitchBend = 8192;
                ch.pitchBendRange = 256;
                ch.modulation = 0;
                ch.sustain = false;
                ch.portamento = false;
                ch.portamentoRate = 8192;
                ch.portamentoControl = false;
                ch.sostenuto = false;
                ch.sostenutoNotes = new Set();
                ch.rpnMsb = 127;
                ch.rpnLsb = 127;
                ch.sampleOffset = 0;
                break;
            // All Notes Off (CC 123)
            case 123:
                for (const note of this.activeNotes) {
                    if (note.channel === channel && note.releaseProgress < 0) {
                        note.releaseProgress = 0;
                    }
                }
                break;
        }
    }

    applyDataEntry(channel) {
        const ch = this.channels[channel];
        const rpn = (ch.rpnMsb << 7) | ch.rpnLsb;
        const dataValue = (ch.dataEntryMsb << 7) | ch.dataEntryLsb;

        switch (rpn) {
            case 0: // Pitch bend range
                // MSB is semitones, LSB is cents (we ignore cents for simplicity)
                // FIX B4: Store as 128 units per semitone for correct scaling with >> 12
                // Math: (8191 * (semitones << 7)) >> 12 gives ~semitones * 256 pitch units
                // (256 pitch units = 1 semitone in our system)
                ch.pitchBendRange = ch.dataEntryMsb << 7;
                break;
            case 1: // Fine tuning (cents)
                // Not commonly used in OSRS, but could implement
                break;
            case 2: // Coarse tuning (semitones)
                // Not commonly used in OSRS, but could implement
                break;
            // RPN 16383 (0x7F7F) = RPN null, used to deselect RPN
        }
    }

    calculatePlaybackRate(note) {
        const ch = this.channels[note.channel];
        let pitch = ((note.pitchSlideProgress * note.pitchSlideTarget) >> 12) + note.basePitch;
        pitch += ((ch.pitchBend - 8192) * ch.pitchBendRange) >> 12;

        if (note.vibratoRate > 0 && (note.vibratoDepth > 0 || ch.modulation > 0)) {
            let depth = note.vibratoDepth << 2;
            const delayTicks = note.vibratoDelay << 1;
            if (note.vibratoTicks < delayTicks) {
                // B5: Use integer division instead of float
                depth = ((depth * note.vibratoTicks) / delayTicks) | 0;
            }
            depth += ch.modulation >> 7;
            // B5: Use lookup table instead of Math.sin
            // SIN_TABLE contains sin * 32768, so we need to scale back
            const lfoIndex = note.vibratoPhase & 511;
            const lfo = SIN_TABLE[lfoIndex];
            // depth * lfo / 32768, using integer math
            pitch += (depth * lfo) >> 15;
        }

        // Use the actual sample's rate, not the note's stored rate
        const sample = this.samples.get(note.sampleIndex);
        const actualSampleRate = sample ? sample.sampleRate : note.sampleRate;

        // Formula: sampleRate * 2^(pitch/3072) / outputRate
        // 3072 = 256 * 12 (256 units per semitone, 12 semitones per octave)
        const rate = (actualSampleRate * Math.pow(2, pitch / 3072)) / sampleRate;
        return Math.max(0.001, rate);
    }

    calculateVolume(note) {
        const ch = this.channels[note.channel];

        // Reference formula from MidiPcmStream.
        // var3 = volume * expression + 4096 >> 13
        // var3 = var3 * var3 + 16384 >> 15  (square for curve)
        // var3 = var3 * noteVolume + 16384 >> 15
        // var3 = var3 * masterVolume + 128 >> 8

        // Step 1: Combine channel volume and expression
        let vol = ((ch.volume * ch.expression + 4096) >> 13);

        // Step 2: Square for volume curve (makes volume more perceptually linear)
        vol = ((vol * vol + 16384) >> 15);

        // Step 3: Apply note/patch volume
        // note.patchVolume is pre-calculated as: (vel^2 * patchVol * globalVol + 1024) >> 11
        vol = ((vol * note.patchVolume + 16384) >> 15);

        // Step 4: Apply master volume (0-256 range, 256 = full volume)
        // masterVolume is already in 0-256 range from setVolume message
        vol = ((vol * this.masterVolume + 128) >> 8);

        // Apply decay
        // B5: Keep Math.pow here as OSRS also uses floating point for this specific calc
        if (note.decayRate > 0) {
            vol = ((vol * Math.pow(0.5, note.decayPosition * 1.953125e-5 * note.decayRate) + 0.5) | 0);
        }

        // Apply volume envelope amplitude modulation (0-64 range)
        if (note.volumeEnvelope && note.volumeEnvelope.length >= 2) {
            const envIdx = note.volumeEnvIndex;
            let envAmp = note.volumeEnvelope[envIdx * 2 + 1] || 0;

            // B5: Interpolate using integer math
            // OSRS uses: envAmp + (nextAmp - envAmp) * (pos - currentTime) / (nextTime - currentTime)
            if (envIdx * 2 + 2 < note.volumeEnvelope.length) {
                const currentTime = (note.volumeEnvelope[envIdx * 2] & 255) << 8;
                const nextTime = (note.volumeEnvelope[envIdx * 2 + 2] & 255) << 8;
                const nextAmp = note.volumeEnvelope[envIdx * 2 + 3] || 0;

                if (nextTime > currentTime) {
                    // Integer interpolation: envAmp + (nextAmp - envAmp) * numerator / denominator
                    const numerator = note.volumeEnvPosition - currentTime;
                    const denominator = nextTime - currentTime;
                    envAmp = envAmp + (((nextAmp - envAmp) * numerator) / denominator) | 0;
                }
            }

            // Apply envelope amplitude: vol = vol * envAmp + 32 >> 6
            vol = ((vol * envAmp + 32) >> 6);
        }

        // Apply release envelope or linear fade
        // Note: Java uses > 0 (not >= 0) - release envelope isn't applied on first tick of release
        if (note.releaseProgress > 0) {
            // Only apply release envelope if sustain pedal is off and not in sostenuto
            // (OSRS behavior: sustain blocks envelope advancement, not note-off)
            const shouldRelease = !ch.sustain && !(ch.sostenuto && ch.sostenutoNotes.has(note.noteId));

            if (shouldRelease) {
                if (note.releaseEnvelope && note.releaseEnvelope.length >= 2) {
                    const relIdx = note.releaseEnvIndex;
                    // Release envelope uses * 2 indexing (2-byte pairs: time, amplitude)
                    let relAmp = note.releaseEnvelope[relIdx * 2 + 1] || 0;

                    // B5: Integer interpolation for release envelope
                    if (relIdx * 2 + 2 < note.releaseEnvelope.length) {
                        const currentTime = (note.releaseEnvelope[relIdx * 2] & 255) << 8;
                        const nextTime = (note.releaseEnvelope[relIdx * 2 + 2] & 255) << 8;
                        const nextAmp = note.releaseEnvelope[relIdx * 2 + 3] || 0;

                        if (nextTime > currentTime) {
                            const numerator = note.releaseProgress - currentTime;
                            const denominator = nextTime - currentTime;
                            relAmp = relAmp + (((nextAmp - relAmp) * numerator) / denominator) | 0;
                        }
                    }
                    // Apply release envelope: vol = relAmp * vol + 32 >> 6
                    vol = ((relAmp * vol + 32) >> 6);
                } else {
                    // Linear fade over 8192 ticks using integer math
                    // vol = vol * (8192 - releaseProgress) / 8192
                    const fadeNum = Math.max(0, 8192 - note.releaseProgress);
                    vol = ((vol * fadeNum) >> 13);
                }
            }
        }

        // B2: Return raw integer volume (will be used with integer mixing)
        // Keep in 0-16384 range for the mixer
        return Math.max(0, vol);
    }

    calculatePan(note) {
        // B3: Return raw pan value in 0-16384 range (center = 8192)
        // This matches OSRS integer stereo handling
        const ch = this.channels[note.channel];
        const chPan = ch.pan;
        let pan;
        if (chPan < 8192) {
            pan = (chPan * note.pan + 32) >> 6;
        } else {
            pan = 16384 - (((128 - note.pan) * (16384 - chPan) + 32) >> 6);
        }
        return pan;
    }

    updateNoteState(note) {
        const ch = this.channels[note.channel];

        // Pitch slide decay - rate affected by portamento time (CC 5/37)
        // Reference formula: var5 -= (int)(16.0D * Math.pow(2.0D, 4.921259842519685E-4D * rate) + 0.5D)
        if (note.pitchSlideProgress > 0) {
            const decayAmount = Math.floor(16 * Math.pow(2, 4.921259842519685e-4 * ch.portamentoRate) + 0.5);
            note.pitchSlideProgress -= decayAmount;
            if (note.pitchSlideProgress < 0) note.pitchSlideProgress = 0;
        }

        note.vibratoTicks++;
        note.vibratoPhase += note.vibratoRate;

        // Pitch-based time scaling factor
        // Reference: ((key - 60) << 8) + (pitchSlideTarget * pitchSlideProgress >> 12)) * 5.086263020833333E-6
        // The pitch slide component affects envelope rate based on current pitch offset
        const currentPitchOffset = ((note.pitchSlideTarget * note.pitchSlideProgress) >> 12);
        const pitchScaleFactor = (((note.key - 60) << 8) + currentPitchOffset) * 5.086263020833333e-6;

        if (note.decayRate > 0) {
            note.decayPosition += note.decayModifier > 0
                ? Math.floor(128 * Math.pow(2, pitchScaleFactor * note.decayModifier) + 0.5)
                : 128;
        }

        if (note.volumeEnvelope && note.volumeEnvelope.length >= 2) {
            note.volumeEnvPosition += note.volumeEnvRate > 0
                ? Math.floor(128 * Math.pow(2, pitchScaleFactor * note.volumeEnvRate) + 0.5)
                : 128;

            while (note.volumeEnvIndex * 2 + 2 < note.volumeEnvelope.length &&
                   note.volumeEnvPosition > ((note.volumeEnvelope[note.volumeEnvIndex * 2 + 2] & 0xFF) << 8)) {
                note.volumeEnvIndex++;
            }

            // Terminate if we've reached the end of the envelope AND the final amplitude is 0
            if (note.volumeEnvIndex * 2 === note.volumeEnvelope.length - 2 &&
                (note.volumeEnvelope[note.volumeEnvIndex * 2 + 1] || 0) === 0) {
                note.active = false;
                this.envTermCount = (this.envTermCount || 0) + 1;
                this.envTermChans = this.envTermChans || {};
                this.envTermChans[note.channel] = (this.envTermChans[note.channel] || 0) + 1;
            }
        }

        // Release envelope advancement - OSRS only advances when sustain is OFF
        // Check drum channel and release envelope conditions
        const sustainHeld = ch.sustain || (ch.sostenuto && ch.sostenutoNotes.has(note.noteId));
        if (note.releaseProgress >= 0 && !sustainHeld) {
            if (note.releaseEnvelope && note.releaseEnvelope.length >= 2) {
                note.releaseProgress += note.releaseEnvRate > 0
                    ? Math.floor(128 * Math.pow(2, pitchScaleFactor * note.releaseEnvRate) + 0.5)
                    : 128;

                // Release envelope uses * 2 indexing (time, amplitude pairs)
                // FIX: Was incorrectly using * 4, which skipped points and terminated prematurely
                while (note.releaseEnvIndex * 2 < note.releaseEnvelope.length - 2 &&
                       note.releaseProgress > ((note.releaseEnvelope[note.releaseEnvIndex * 2 + 2] & 0xFF) << 8)) {
                    note.releaseEnvIndex++;
                }

                // Terminate when release envelope completes
                if (note.releaseEnvIndex * 2 >= note.releaseEnvelope.length - 2) {
                    note.active = false;
                    this.relTermCount = (this.relTermCount || 0) + 1;
                    this.relTermChans = this.relTermChans || {};
                    this.relTermChans[note.channel] = (this.relTermChans[note.channel] || 0) + 1;
                }
            } else {
                note.releaseProgress += 128;
                if (note.releaseProgress > 8192) {
                    note.active = false;
                    this.fadeTermCount = (this.fadeTermCount || 0) + 1;
                    this.fadeTermChans = this.fadeTermChans || {};
                    this.fadeTermChans[note.channel] = (this.fadeTermChans[note.channel] || 0) + 1;
                }
            }
        }

        note.ticksElapsed++;
    }

    generateSample(note) {
        const sample = this.samples.get(note.sampleIndex);
        if (!sample || sample.samples.length === 0) return { value: 0, volume: 0, pan: 8192 };

        const playbackRate = this.calculatePlaybackRate(note);
        const volume = this.calculateVolume(note);  // B2: Now returns integer 0-16384
        const pan = this.calculatePan(note);        // B3: Now returns integer 0-16384

        // FIX: The patch (note.looped) is the authority on whether this specific note should loop.
        // Sample.looped is just a hint about the sample's default behavior, but patch overrides it.
        const shouldLoop = note.looped;
        const hasLoopPoints = sample.loopEnd > sample.loopStart;

        const pos = note.samplePosition;
        const idx0 = Math.floor(pos);
        let idx1 = idx0 + 1;
        const frac = pos - idx0;

        // Handle interpolation index wrapping for looped samples
        if (shouldLoop && hasLoopPoints && idx1 >= sample.loopEnd) {
            idx1 = sample.loopStart + (idx1 - sample.loopEnd);
        } else if (shouldLoop && !hasLoopPoints && idx1 >= sample.samples.length) {
            idx1 = idx1 % sample.samples.length;
        }

        let s0 = idx0 >= 0 && idx0 < sample.samples.length ? sample.samples[idx0] : 0;
        let s1 = idx1 >= 0 && idx1 < sample.samples.length ? sample.samples[idx1] : 0;

        // B5: Sample interpolation - samples are in -1 to 1 float range
        // We'll convert to integer for mixing: multiply by 32768 to get 16-bit range
        let sampleValue = s0 + (s1 - s0) * frac;
        // Convert to integer: -32768 to 32767 range
        let intSample = (sampleValue * 32768) | 0;

        note.samplePosition += playbackRate;

        // Loop handling - note.looped (from patch) is authoritative
        if (shouldLoop && hasLoopPoints) {
            // Wrap position using modulo to handle high playback rates
            if (note.samplePosition >= sample.loopEnd) {
                const loopLen = sample.loopEnd - sample.loopStart;
                note.samplePosition = sample.loopStart + ((note.samplePosition - sample.loopStart) % loopLen);
            }
        } else if (shouldLoop && sample.samples.length > 0) {
            // If marked as looping but no loop points, loop the entire sample
            if (note.samplePosition >= sample.samples.length) {
                note.samplePosition = note.samplePosition % sample.samples.length;
            }
        } else if (note.samplePosition >= sample.samples.length) {
            note.active = false;
            this.sampleEndCount = (this.sampleEndCount || 0) + 1;
            this.sampleEndChans = this.sampleEndChans || {};
            this.sampleEndChans[note.channel] = (this.sampleEndChans[note.channel] || 0) + 1;
        }

        // Return integer sample value along with volume and pan for OSRS-style mixing
        return { value: intSample, volume: volume, pan: pan };
    }

    process(inputs, outputs, parameters) {
        const output = outputs[0];
        if (!output || output.length === 0) return true;

        const left = output[0];
        const right = output.length > 1 ? output[1] : left;
        const blockSize = left.length;

        // B1: Calculate frame times for sample-accurate event dispatch
        // currentTime is the time at the START of this block
        const blockStartTime = currentTime;
        const secondsPerSample = 1 / sampleRate;

        for (let i = 0; i < blockSize; i++) {
            // B1: Sample-accurate event timing - check events for this specific sample
            if (this.eventQueue && this.eventQueue.length > 0) {
                const sampleTime = blockStartTime + (i * secondsPerSample);
                while (this.eventQueue.length > 0 && this.eventQueue[0].time <= sampleTime) {
                    const msg = this.eventQueue.shift();
                    this.dispatchMessage(msg);
                }
            }

            // B6: Global tick boundary - update all notes on the same tick
            this.globalSampleCounter++;
            const shouldUpdateEnvelopes = this.globalSampleCounter >= this.samplesPerTick;
            if (shouldUpdateEnvelopes) {
                this.globalSampleCounter = 0;
                this.globalTickCounter++;
                // Update all active notes at the same time
                for (const note of this.activeNotes) {
                    if (note.active) {
                        this.updateNoteState(note);
                    }
                }
            }

            // B2/B3: Integer mixing buffers (32-bit signed)
            // OSRS mixes into integer buffers before final output
            let mixL = 0;
            let mixR = 0;

            for (let j = this.activeNotes.length - 1; j >= 0; j--) {
                const note = this.activeNotes[j];

                if (!note.active) {
                    this.activeNotes.splice(j, 1);
                    const noteKey = note.channel + ":" + note.key;
                    if (this.noteMap.get(noteKey) === note) {
                        this.noteMap.delete(noteKey);
                    }
                    continue;
                }

                const result = this.generateSample(note);
                const sampleVal = result.value;   // -32768 to 32767
                const volume = result.volume;     // 0 to 16384
                const pan = result.pan;           // 0 to 16384 (8192 = center)

                // B2/B3: OSRS-style stereo mixing with integer math
                // Apply volume: sample * volume >> 14 (volume is 0-16384)
                const scaledSample = (sampleVal * volume) >> 14;

                // B3: OSRS pan law - pan is 0-16384, center is 8192
                // Left channel: sample * (16384 - pan) >> 14
                // Right channel: sample * pan >> 14
                // This gives: at pan=0 -> L=full, R=0; pan=8192 -> L=half, R=half; pan=16384 -> L=0, R=full
                const leftGain = 16384 - pan;
                const rightGain = pan;

                mixL += (scaledSample * leftGain) >> 14;
                mixR += (scaledSample * rightGain) >> 14;
            }

            // B2: OSRS-style integer saturation (hard clamp) instead of tanh soft clip
            // OSRS clamps to 16-bit range: -32768 to 32767
            if (mixL > 32767) mixL = 32767;
            else if (mixL < -32768) mixL = -32768;
            if (mixR > 32767) mixR = 32767;
            else if (mixR < -32768) mixR = -32768;

            // Convert back to float for Web Audio output (-1 to 1)
            left[i] = mixL / 32768;
            right[i] = mixR / 32768;
        }

        return true;
    }
}

registerProcessor("music-worklet-processor", MusicWorkletProcessor);
`;
    }

    /**
     * Load a music track and prepare for playback
     */
    async loadTrack(trackId: number): Promise<boolean> {
        if (!this.workletReady) {
            const ok = await this.initialize();
            if (!ok) return false;
        }

        // Stop any current playback
        this.stop();

        // Load track from cache
        const trackIndex = this.cache.getIndex(IndexType.DAT2.musicTracks);
        if (!trackIndex) {
            console.error("[RealtimeMidiSynth] Music tracks index not available");
            return false;
        }

        const file = trackIndex.getFileSmart(trackId);
        if (!file) {
            console.error(`[RealtimeMidiSynth] Track ${trackId} not found`);
            return false;
        }

        // Convert cache format to MIDI
        const trackBytes = new Uint8Array(
            file.data.buffer,
            file.data.byteOffset,
            file.data.byteLength,
        );
        const midiBytes = MusicTrack.toMidi(trackBytes);
        if (!midiBytes) {
            console.error(`[RealtimeMidiSynth] Failed to convert track ${trackId} to MIDI`);
            return false;
        }

        // Parse MIDI
        this.events = [];
        this.parseMidi(midiBytes);

        if (this.events.length === 0) {
            console.error(`[RealtimeMidiSynth] No events in track ${trackId}`);
            return false;
        }

        // FIX A2: Sort events by tick, then by sequence number to preserve original emission order
        this.events.sort((a, b) => a.tick - b.tick || (a._seq ?? 0) - (b._seq ?? 0));

        // Find track duration
        this.trackDurationTicks = this.events.reduce((max, e) => Math.max(max, e.tick), 0);

        // Build tempo map for accurate timing
        this.buildTempoMap();

        // Find all program changes in the MIDI to preload patches
        // Also track the FIRST program for each channel to set initial state
        const programsUsed = new Set<number>();

        // Temporary bank state for scanning (reset to defaults)
        const scanBanks = new Int32Array(16).fill(0);
        scanBanks[9] = 128;
        // Current patch/program per channel (program + bank at last program change)
        const scanFullPrograms = new Int32Array(16).fill(0);
        scanFullPrograms[9] = 128;

        for (const event of this.events) {
            if (event.type === "controlChange") {
                const cc = event;
                if (cc.controller === 0) {
                    scanBanks[cc.channel] = (cc.value << 14) + (scanBanks[cc.channel] & -2080769);
                } else if (cc.controller === 32) {
                    scanBanks[cc.channel] = (scanBanks[cc.channel] & -16257) + (cc.value << 7);
                }
            } else if (event.type === "programChange") {
                const prog = event;
                const fullId = prog.program + scanBanks[prog.channel];
                scanFullPrograms[prog.channel] = fullId;
                programsUsed.add(fullId);
            } else if (event.type === "noteOn") {
                // Track default programs even if no explicit program change exists.
                const note = event;
                programsUsed.add(scanFullPrograms[note.channel]);
            }
        }

        // Load patches for all programs first
        const patchMap = new Map<number, MusicPatch | null>();
        for (const program of programsUsed) {
            const patch = await this.loadPatch(program);
            patchMap.set(program, patch);
        }

        // Initialize channel patches to OSRS defaults (program 0 + default bank).
        // Program changes in the MIDI will update these as playback progresses.
        for (let i = 0; i < 16; i++) {
            const defaultBank = i === 9 ? 128 : 0;
            const defaultProgram = 0 + defaultBank;
            this.channelPatches[i] = patchMap.get(defaultProgram) || null;
            this.channelPrograms[i] = defaultProgram;
        }

        // Preload samples for all patches used
        for (const [program, patch] of patchMap) {
            if (!patch) continue;

            await this.preloadSamplesForPatch(patch, program);
        }

        return true;
    }

    /**
     * Load a jingle from the musicJingles cache index.
     * Jingles are short MIDI fanfares (level-ups, quest completion, etc.)
     *
     * @param jingleId - The jingle ID from musicJingles index (index 11)
     * @returns true if loaded successfully
     */
    async loadJingle(jingleId: number): Promise<boolean> {
        if (!this.workletReady) {
            const ok = await this.initialize();
            if (!ok) return false;
        }

        // Stop any current playback
        this.stop();

        // Load jingle from cache (musicJingles index = 11)
        const jingleIndex = this.cache.getIndex(IndexType.DAT2.musicJingles);
        if (!jingleIndex) {
            console.error("[RealtimeMidiSynth] Music jingles index not available");
            return false;
        }

        const file = jingleIndex.getFileSmart(jingleId);
        if (!file) {
            console.error(`[RealtimeMidiSynth] Jingle ${jingleId} not found`);
            return false;
        }

        // Convert cache format to MIDI
        const jingleBytes = new Uint8Array(
            file.data.buffer,
            file.data.byteOffset,
            file.data.byteLength,
        );
        const midiBytes = MusicTrack.toMidi(jingleBytes);
        if (!midiBytes) {
            console.error(`[RealtimeMidiSynth] Failed to convert jingle ${jingleId} to MIDI`);
            return false;
        }

        // Parse MIDI
        this.events = [];
        this.parseMidi(midiBytes);

        if (this.events.length === 0) {
            console.error(`[RealtimeMidiSynth] No events in jingle ${jingleId}`);
            return false;
        }

        // Sort events by tick, then by sequence number to preserve original emission order
        this.events.sort((a, b) => a.tick - b.tick || (a._seq ?? 0) - (b._seq ?? 0));

        // Find track duration
        this.trackDurationTicks = this.events.reduce((max, e) => Math.max(max, e.tick), 0);

        // Build tempo map for accurate timing
        this.buildTempoMap();

        // Find all program changes in the MIDI to preload patches
        const programsUsed = new Set<number>();

        // Temporary bank state for scanning
        const scanBanks = new Int32Array(16).fill(0);
        scanBanks[9] = 128;
        const scanFullPrograms = new Int32Array(16).fill(0);
        scanFullPrograms[9] = 128;

        for (const event of this.events) {
            if (event.type === "controlChange") {
                const cc = event;
                if (cc.controller === 0) {
                    scanBanks[cc.channel] = (cc.value << 14) + (scanBanks[cc.channel] & -2080769);
                } else if (cc.controller === 32) {
                    scanBanks[cc.channel] = (scanBanks[cc.channel] & -16257) + (cc.value << 7);
                }
            } else if (event.type === "programChange") {
                const prog = event;
                const fullId = prog.program + scanBanks[prog.channel];
                scanFullPrograms[prog.channel] = fullId;
                programsUsed.add(fullId);
            } else if (event.type === "noteOn") {
                const note = event;
                programsUsed.add(scanFullPrograms[note.channel]);
            }
        }

        // Load patches for all programs
        const patchMap = new Map<number, MusicPatch | null>();
        for (const program of programsUsed) {
            const patch = await MusicPatch.tryLoad(this.cache, program);
            patchMap.set(program, patch);
        }

        // Set up default patches per channel
        for (let i = 0; i < 16; i++) {
            const defaultProgram = i === 9 ? 128 : 0;
            this.channelBanks[i] = i === 9 ? 128 : 0;
            this.channelPatches[i] = patchMap.get(defaultProgram) || null;
            this.channelPrograms[i] = defaultProgram;
        }

        // Preload samples for all patches used
        for (const [program, patch] of patchMap) {
            if (!patch) continue;
            await this.preloadSamplesForPatch(patch, program);
        }

        return true;
    }

    /**
     * Parse MIDI data into events
     */
    private parseMidi(data: Uint8Array): void {
        const buf = new ByteBuffer(data);

        // Read header
        buf.offset = 0;
        const headerChunk = buf.readInt();
        if (headerChunk !== 0x4d546864) {
            // "MThd"
            console.error("[RealtimeMidiSynth] Invalid MIDI header");
            return;
        }

        const headerLength = buf.readInt();
        buf.readUnsignedShort();
        const trackCount = buf.readUnsignedShort();
        this.division = buf.readUnsignedShort();

        // Track data starts after header chunk (8 bytes) + header data (headerLength bytes)
        // We've already read format/trackCount/division (6 bytes) which is part of headerLength
        // So we should be at offset 14 for standard MIDI (headerLength=6)
        // But if headerLength > 6, there might be extra data we need to skip
        buf.offset = 8 + headerLength;

        // FIX A2: Track sequence number for stable sorting at same tick
        let seq = 0;

        // Parse each track
        for (let t = 0; t < trackCount; t++) {
            if (buf.offset >= buf._data.length) {
                console.warn(
                    `[RealtimeMidiSynth] Track ${t}: offset ${buf.offset} >= length ${buf._data.length}`,
                );
                break;
            }

            const trackChunk = buf.readInt();
            if (trackChunk !== 0x4d54726b) {
                // "MTrk"
                // Skip unknown chunk
                console.warn(
                    `[RealtimeMidiSynth] Track ${t}: unexpected chunk 0x${trackChunk.toString(
                        16,
                    )} at offset ${buf.offset - 4}`,
                );
                const len = buf.readInt();
                buf.offset += len;
                t--;
                continue;
            }

            const trackLength = buf.readInt();
            const trackEnd = buf.offset + trackLength;
            let tick = 0;
            let runningStatus = 0;
            while (buf.offset < trackEnd) {
                // Read delta time
                let delta = 0;
                let b: number;
                do {
                    b = buf.readUnsignedByte();
                    delta = (delta << 7) | (b & 0x7f);
                } while (b & 0x80);
                tick += delta;

                // Read event
                let status = buf._data[buf.offset] & 0xff;
                if (status < 0x80) {
                    status = runningStatus;
                } else {
                    buf.offset++;
                    // FIX A1: Only update runningStatus for channel voice messages (0x80-0xEF)
                    // Meta events (0xFF) and SysEx (0xF0/0xF7) should NOT update running status
                    if (status < 0xf0) {
                        runningStatus = status;
                    }
                }

                const eventType = status & 0xf0;
                const channel = status & 0x0f;

                switch (eventType) {
                    case 0x80: {
                        // Note Off
                        const key = buf.readUnsignedByte();
                        const velocity = buf.readUnsignedByte();
                        this.events.push({
                            type: "noteOff",
                            tick,
                            channel,
                            key,
                            velocity,
                            _seq: seq++,
                        });
                        break;
                    }
                    case 0x90: {
                        // Note On
                        const key = buf.readUnsignedByte();
                        const velocity = buf.readUnsignedByte();
                        if (velocity === 0) {
                            this.events.push({
                                type: "noteOff",
                                tick,
                                channel,
                                key,
                                velocity,
                                _seq: seq++,
                            });
                        } else {
                            this.events.push({
                                type: "noteOn",
                                tick,
                                channel,
                                key,
                                velocity,
                                _seq: seq++,
                            });
                        }
                        break;
                    }
                    case 0xa0: {
                        // Aftertouch
                        buf.offset += 2;
                        break;
                    }
                    case 0xb0: {
                        // Control Change
                        const controller = buf.readUnsignedByte();
                        const value = buf.readUnsignedByte();
                        this.events.push({
                            type: "controlChange",
                            tick,
                            channel,
                            controller,
                            value,
                            _seq: seq++,
                        });
                        break;
                    }
                    case 0xc0: {
                        // Program Change
                        const program = buf.readUnsignedByte();
                        this.events.push({
                            type: "programChange",
                            tick,
                            channel,
                            program,
                            _seq: seq++,
                        });
                        break;
                    }
                    case 0xd0: {
                        // Channel Pressure
                        buf.offset += 1;
                        break;
                    }
                    case 0xe0: {
                        // Pitch Bend
                        const lsb = buf.readUnsignedByte();
                        const msb = buf.readUnsignedByte();
                        const value = (msb << 7) | lsb;
                        this.events.push({ type: "pitchBend", tick, channel, value, _seq: seq++ });
                        break;
                    }
                    case 0xf0: {
                        // System / Meta
                        if (status === 0xff) {
                            const metaType = buf.readUnsignedByte();
                            let len = 0;
                            let lenByte: number;
                            do {
                                lenByte = buf.readUnsignedByte();
                                len = (len << 7) | (lenByte & 0x7f);
                            } while (lenByte & 0x80);

                            if (metaType === 0x51 && len === 3) {
                                // Tempo
                                const microsPerQuarter =
                                    (buf.readUnsignedByte() << 16) |
                                    (buf.readUnsignedByte() << 8) |
                                    buf.readUnsignedByte();
                                this.events.push({
                                    type: "tempo",
                                    tick,
                                    microsPerQuarter,
                                    _seq: seq++,
                                });
                            } else if (metaType === 0x2f) {
                                // End of Track
                                this.events.push({ type: "endOfTrack", tick, _seq: seq++ });
                                buf.offset += len;
                            } else {
                                buf.offset += len;
                            }
                        } else if (status === 0xf0 || status === 0xf7) {
                            // SysEx
                            let len = 0;
                            let lenByte: number;
                            do {
                                lenByte = buf.readUnsignedByte();
                                len = (len << 7) | (lenByte & 0x7f);
                            } while (lenByte & 0x80);
                            buf.offset += len;
                        }
                        break;
                    }
                }
            }
        }
    }

    /**
     * Load a patch from cache
     */
    private async loadPatch(patchId: number): Promise<MusicPatch | null> {
        const cachedPatch = this.patchCache.get(patchId);
        if (cachedPatch !== undefined) {
            return cachedPatch;
        }

        const patch = MusicPatch.tryLoad(this.cache, patchId);
        if (patch) {
            this.patchCache.set(patchId, patch);

            // Memory leak fix: evict oldest entries if cache too large
            if (this.patchCache.size > this.MAX_PATCH_CACHE_SIZE) {
                const keysToDelete = Array.from(this.patchCache.keys()).slice(
                    0,
                    this.patchCache.size - this.MAX_PATCH_CACHE_SIZE,
                );
                for (const key of keysToDelete) {
                    this.patchCache.delete(key);
                }
            }
        }
        return patch;
    }

    /**
     * Load patch for a specific channel based on program number
     */
    private async loadPatchForChannel(channel: number, program: number): Promise<void> {
        const patch = await this.loadPatch(program);
        if (patch) {
            this.channelPatches[channel] = patch;
            // Preload samples for this patch
            await this.preloadSamplesForPatch(patch, program);
        }
    }

    /**
     * Preload samples for a specific patch
     */
    private async preloadSamplesForPatch(patch: MusicPatch, patchId: number): Promise<void> {
        if (!this.workletNode) return;

        for (let key = 0; key < 128; key++) {
            const sampleId = patch.sampleIds[key];
            if (sampleId === 0) continue;

            // Decrement first, then compute index and type (matches Java: var9--; sid = var9 >> 2)
            const decremented = sampleId - 1;
            const sid = decremented >> 2;
            if (this.loadedSamples.has(sid)) {
                continue;
            }

            // After decrement, bit 0 = 1 means music sample (vorbis), bit 0 = 0 means SFX
            const isMusicSample = (decremented & 1) === 1;
            const raw = isMusicSample
                ? await this.soundCache.method883(sid)
                : await this.soundCache.method881(sid);

            if (!raw) {
                continue;
            }

            const floatSamples = new Float32Array(raw.samples.length);
            for (let i = 0; i < raw.samples.length; i++) {
                // Simple symmetric conversion: signed 8-bit [-128, 127] to float [-1, 1)
                floatSamples[i] = raw.samples[i] / 128.0;
            }

            this.workletNode.port.postMessage(
                {
                    type: "loadSample",
                    index: sid,
                    samples: floatSamples,
                    sampleRate: raw.sampleRate,
                    looped: raw.looped,
                    loopStart: raw.start,
                    loopEnd: raw.end,
                },
                [floatSamples.buffer],
            );

            this.loadedSamples.add(sid);
        }
    }

    /**
     * Preload samples used by a patch
     */
    private async preloadSamplesForTrack(patch: MusicPatch | null): Promise<void> {
        if (!patch || !this.workletNode) return;

        // Find all unique sample IDs used and track their type
        const sampleInfo = new Map<number, { sid: number; isMusicSample: boolean }>();
        for (let key = 0; key < 128; key++) {
            const sampleId = patch.sampleIds[key];
            if (sampleId !== 0) {
                // Decrement first, then compute index and type (matches Java: var9--; sid = var9 >> 2)
                const decremented = sampleId - 1;
                const sid = decremented >> 2;
                // After decrement, bit 0 = 1 means music sample (vorbis), bit 0 = 0 means SFX
                const isMusicSample = (decremented & 1) === 1;
                if (!sampleInfo.has(sid)) {
                    sampleInfo.set(sid, { sid, isMusicSample });
                }
            }
        }

        for (const [sid, info] of sampleInfo) {
            if (this.loadedSamples.has(sid)) {
                continue;
            }

            // Use correct loader based on sample type
            const raw = info.isMusicSample
                ? await this.soundCache.method883(sid)
                : await this.soundCache.method881(sid);

            if (!raw && info.isMusicSample) {
                console.warn(
                    `[RealtimeMidiSynth] Music sample ${sid} failed to load - vorbis decode issue?`,
                );
            }

            if (raw) {
                // Convert Int8Array to Float32Array
                const floatSamples = new Float32Array(raw.samples.length);
                for (let i = 0; i < raw.samples.length; i++) {
                    // Simple symmetric conversion: signed 8-bit [-128, 127] to float [-1, 1)
                    floatSamples[i] = raw.samples[i] / 128.0;
                }

                // Send to worklet
                this.workletNode.port.postMessage(
                    {
                        type: "loadSample",
                        index: sid,
                        samples: floatSamples,
                        sampleRate: raw.sampleRate,
                        looped: raw.looped,
                        loopStart: raw.start,
                        loopEnd: raw.end,
                    },
                    [floatSamples.buffer],
                );

                this.loadedSamples.add(sid);
            } else {
                console.warn(
                    `[RealtimeMidiSynth] Failed to load sample ${sid} (music=${info.isMusicSample})`,
                );
            }
        }
    }

    /**
     * Start playback
     */
    play(): void {
        if (!this.workletReady || !this.context || this.events.length === 0) return;

        if (this.context.state === "suspended") {
            this.context.resume();
        }

        if (this.isPaused) {
            // FIX A5: Resume from pause using stored pausedTick
            const now = this.context.currentTime;
            // Re-calculate startTime based on paused position
            const elapsedSeconds = this.tickToMs(this.pausedTick) / 1000;
            this.startTime = now - elapsedSeconds;
            this.isPaused = false;
        } else {
            // Start fresh
            this.eventIndex = 0;
            this.currentTempo = 500000;
            // Start slightly in future to allow buffering
            this.startTime = this.context.currentTime + 0.1;
            this.lastScheduledTick = 0;

            // Reset stats
            this.noteStats = { played: 0, noPatch: 0, noSampleId: 0, notLoaded: 0 };
            this.channelNoteStats.clear();
            this.noteOnCallsByChannel = {};
            this.processedNoteOnChannels.clear();
            this.channelBanks.fill(0);
            this.channelBanks[9] = 128;

            // Reset channel state
            this.workletNode?.port.postMessage({ type: "stopAll" });
        }

        this.isPlaying = true;
        this.scheduleEvents();
    }

    /**
     * Pause playback
     */
    pause(): void {
        if (!this.isPlaying || this.isPaused) return;

        // FIX A5: Store current tick BEFORE flipping isPaused (since getCurrentTick checks isPaused)
        this.pausedTick = this.getCurrentTick();
        this.isPaused = true;
        this.pauseTime = performance.now(); // Still kept for UI/debug if needed, but logic uses AudioContext

        if (this.schedulerTimer !== null) {
            clearTimeout(this.schedulerTimer);
            this.schedulerTimer = null;
        }

        this.workletNode?.port.postMessage({ type: "stopAll" });
    }

    /**
     * Stop playback
     */
    stop(): void {
        this.isPlaying = false;
        this.isPaused = false;
        this.eventIndex = 0;

        if (this.schedulerTimer !== null) {
            clearTimeout(this.schedulerTimer);
            this.schedulerTimer = null;
        }

        this.workletNode?.port.postMessage({ type: "stopAll" });
    }

    /**
     * Set master volume (0.0 - 1.0)
     */
    setVolume(volume: number): void {
        const clamped = Math.max(0, Math.min(1, volume));
        // Send master volume to worklet in 0-256 range (256 = full volume).
        // Default master volume is 256.
        this.workletNode?.port.postMessage({
            type: "setVolume",
            volume: Math.max(0, Math.min(256, Math.round(clamped * 256))),
        });
    }

    /**
     * Set looping
     */
    setLooping(loop: boolean): void {
        this.looping = loop;
    }

    /**
     * Fade out the music over the specified duration.
     * @param durationSec - Duration in seconds
     */
    fadeOut(durationSec: number): void {
        if (!this.gainNode || !this.context) return;
        const now = this.context.currentTime;
        this.gainNode.gain.cancelScheduledValues(now);
        this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
        this.gainNode.gain.linearRampToValueAtTime(0, now + durationSec);
        this.outputGain = 0;
    }

    /**
     * Fade in the music over the specified duration.
     * @param durationSec - Duration in seconds
     */
    fadeIn(durationSec: number): void {
        if (!this.gainNode || !this.context) return;
        const now = this.context.currentTime;
        this.gainNode.gain.cancelScheduledValues(now);
        this.gainNode.gain.setValueAtTime(0, now);
        this.gainNode.gain.linearRampToValueAtTime(1.0, now + durationSec);
        this.outputGain = 1.0;
    }

    /**
     * Set post-synth output gain (0.0 - 1.0).
     * Used for OSRS-style per-tick music fades without modifying the synth's master volume.
     */
    setOutputGain(gain: number): void {
        if (!this.gainNode || !this.context) return;
        const clamped = Math.max(0, Math.min(1, gain));
        const now = this.context.currentTime;
        this.gainNode.gain.cancelScheduledValues(now);
        this.gainNode.gain.setValueAtTime(clamped, now);
        this.outputGain = clamped;
    }

    getOutputGain(): number {
        return this.outputGain;
    }

    /**
     * MidiPcmStream.isReady().
     * Used by fade tasks to avoid adjusting volume while the player isn't ready.
     */
    isReady(): boolean {
        if (!this.workletReady) return false;
        if (!this.context || !this.workletNode) return false;
        // Browser AudioContexts can be "suspended" due to autoplay policy; OSRS doesn't have this.
        // Treat suspended as "ready" so fade logic matches the client (which assumes readiness).
        return this.context.state !== "closed";
    }

    /**
     * Build tempo map from parsed events for accurate timing
     */
    private buildTempoMap(): void {
        this.tempoMap = [];
        let currentTempo = 500000; // Default 120 BPM
        let currentTimeMs = 0;
        let lastTick = 0;

        // Start with default tempo
        this.tempoMap.push({ tick: 0, tempo: currentTempo, timeMs: 0 });

        // Find all tempo events and calculate cumulative time
        for (const event of this.events) {
            if (event.type === "tempo") {
                // Calculate time elapsed from last tempo change
                const deltaTicks = event.tick - lastTick;
                currentTimeMs += (deltaTicks * currentTempo) / (this.division * 1000);

                // Update tempo
                currentTempo = event.microsPerQuarter;
                lastTick = event.tick;

                this.tempoMap.push({
                    tick: event.tick,
                    tempo: currentTempo,
                    timeMs: currentTimeMs,
                });
            }
        }

        // Calculate total duration
        const finalDeltaTicks = this.trackDurationTicks - lastTick;
        this.trackDurationMs =
            currentTimeMs + (finalDeltaTicks * currentTempo) / (this.division * 1000);
    }

    /**
     * Convert tick to time in milliseconds using tempo map
     */
    private tickToMs(tick: number): number {
        if (this.tempoMap.length === 0) {
            return (tick * this.currentTempo) / (this.division * 1000);
        }

        // Find the tempo entry at or before this tick
        let entry = this.tempoMap[0];
        for (let i = 1; i < this.tempoMap.length; i++) {
            if (this.tempoMap[i].tick > tick) break;
            entry = this.tempoMap[i];
        }

        // Calculate time from that entry
        const deltaTicks = tick - entry.tick;
        return entry.timeMs + (deltaTicks * entry.tempo) / (this.division * 1000);
    }

    /**
     * Convert time in milliseconds to tick using tempo map
     */
    private msToTick(timeMs: number): number {
        if (this.tempoMap.length === 0) {
            return Math.floor((timeMs * this.division * 1000) / this.currentTempo);
        }

        // Find the tempo entry at or before this time
        let entry = this.tempoMap[0];
        for (let i = 1; i < this.tempoMap.length; i++) {
            if (this.tempoMap[i].timeMs > timeMs) break;
            entry = this.tempoMap[i];
        }

        // Calculate tick from that entry
        const deltaMs = timeMs - entry.timeMs;
        return entry.tick + Math.floor((deltaMs * this.division * 1000) / entry.tempo);
    }

    /**
     * Get current playback tick
     */
    private getCurrentTick(): number {
        if (!this.isPlaying || this.isPaused || !this.context) return 0;
        const elapsedMs = (this.context.currentTime - this.startTime) * 1000;
        return Math.max(0, this.msToTick(elapsedMs));
    }

    /**
     * Schedule MIDI events
     */
    private scheduleEvents(): void {
        if (!this.isPlaying || this.isPaused || !this.context) return;

        // Memory leak fix: use try-catch to ensure scheduler continues even if an error occurs
        try {
            const now = this.context.currentTime;

            // Schedule up to this time
            const scheduleUntilTime = now + this.LOOKAHEAD;
            const scheduleUntilMs = (scheduleUntilTime - this.startTime) * 1000;
            const scheduleUntilTick = this.msToTick(scheduleUntilMs);

            // Process all events up to scheduled tick
            while (this.eventIndex < this.events.length) {
                const event = this.events[this.eventIndex];

                if (event.tick > scheduleUntilTick) {
                    break;
                }

                // Calculate absolute time for this event
                const eventTimeMs = this.tickToMs(event.tick);
                const absoluteTime = this.startTime + eventTimeMs / 1000;

                this.processEvent(event, absoluteTime);
                this.eventIndex++;
            }

            // Check if we've reached the end
            if (this.eventIndex >= this.events.length) {
                // Wait until actual end of track before looping
                const durationMs = this.trackDurationMs;
                const durationSeconds = durationMs / 1000;

                if (now >= this.startTime + durationSeconds) {
                    if (this.looping) {
                        // Loop: reset index and advance startTime
                        this.eventIndex = 0;
                        // New startTime is the end of the previous iteration
                        // This ensures perfect timing continuity
                        this.startTime = this.startTime + durationSeconds;

                        // FIX A4: Reset main-thread channel state exactly like fresh play
                        this.channelBanks.fill(0);
                        this.channelBanks[9] = 128; // Channel 10 defaults to bank 128 (drums)
                        this.channelPrograms.fill(0);
                        // Reset channelPatches to defaults (program 0 + default bank)
                        for (let i = 0; i < 16; i++) {
                            const defaultBank = i === 9 ? 128 : 0;
                            const defaultProgram = 0 + defaultBank;
                            this.channelPatches[i] = this.patchCache.get(defaultProgram) || null;
                            this.channelPrograms[i] = defaultProgram;
                        }

                        this.noteStats = { played: 0, noPatch: 0, noSampleId: 0, notLoaded: 0 };
                        this.channelNoteStats.clear();
                        // Don't stopAll on loop to allow reverb tails etc to overlap if we were advanced enough
                        // But OSRS usually cuts. Let's stick to safe reset for now.
                        this.workletNode?.port.postMessage({ type: "stopAll" });
                    } else {
                        this.stop();
                        return;
                    }
                }
            }
        } catch (e) {
            console.error("[RealtimeMidiSynth] Error in scheduleEvents:", e);
        }

        // Schedule next frame only if still playing (stop() sets isPlaying to false)
        if (this.isPlaying && !this.isPaused) {
            this.schedulerTimer = setTimeout(() => this.scheduleEvents(), this.SCHEDULER_INTERVAL);
        }
    }

    /**
     * Process a single MIDI event
     */
    private processEvent(event: MidiEvent, absoluteTime: number): void {
        if (!this.workletNode) return;

        switch (event.type) {
            case "noteOn":
                this.handleNoteOn(event, absoluteTime);
                break;

            case "noteOff":
                this.workletNode.port.postMessage({
                    type: "noteOff",
                    channel: event.channel,
                    key: event.key,
                    time: absoluteTime,
                });
                break;

            case "controlChange":
                if (event.controller === 0) {
                    this.channelBanks[event.channel] =
                        (event.value << 14) + (this.channelBanks[event.channel] & -2080769);
                } else if (event.controller === 32) {
                    this.channelBanks[event.channel] =
                        (this.channelBanks[event.channel] & -16257) + (event.value << 7);
                }
                this.workletNode.port.postMessage({
                    type: "controlChange",
                    channel: event.channel,
                    controller: event.controller,
                    value: event.value,
                    time: absoluteTime,
                });
                break;

            case "programChange":
                const fullId = event.program + this.channelBanks[event.channel];
                this.channelPrograms[event.channel] = fullId;
                // Synchronously assign patch if already cached (fixes race condition)
                const cachedPatch = this.patchCache.get(fullId);
                if (cachedPatch) {
                    this.channelPatches[event.channel] = cachedPatch;
                }
                // Also do async loading for uncached patches and sample preloading
                this.loadPatchForChannel(event.channel, fullId);
                this.workletNode.port.postMessage({
                    type: "programChange",
                    channel: event.channel,
                    program: fullId,
                    time: absoluteTime,
                });
                break;

            case "pitchBend":
                this.workletNode.port.postMessage({
                    type: "pitchBend",
                    channel: event.channel,
                    value: event.value,
                    time: absoluteTime,
                });
                break;

            case "tempo":
                this.currentTempo = event.microsPerQuarter;
                break;

            case "endOfTrack":
                // Handled by loop check
                break;
        }
    }

    // Debug counters
    private noteStats = { played: 0, noPatch: 0, noSampleId: 0, notLoaded: 0 };
    private channelNoteStats = new Map<
        number,
        { played: number; noPatch: number; noSampleId: number; notLoaded: number }
    >();

    // Track note-on calls per channel for debugging
    private noteOnCallsByChannel: { [ch: number]: number } = {};
    private processedNoteOnChannels: Set<number> = new Set();

    /**
     * Handle note on - look up patch data and send to worklet
     */
    private handleNoteOn(event: MidiNoteOn, absoluteTime: number): void {
        if (!this.workletNode) return;

        // Track per-channel stats
        let chStats = this.channelNoteStats.get(event.channel);
        if (!chStats) {
            chStats = {
                played: 0,
                noPatch: 0,
                noSampleId: 0,
                notLoaded: 0,
            };
            this.channelNoteStats.set(event.channel, chStats);
        }

        const patch = this.channelPatches[event.channel];
        if (!patch) {
            this.noteStats.noPatch++;
            chStats.noPatch++;
            return;
        }

        const sampleId = patch.sampleIds[event.key];
        if (sampleId === 0) {
            this.noteStats.noSampleId++;
            chStats.noSampleId++;
            return;
        }

        // Decrement first, then compute index (matches Java: var9--; sid = var9 >> 2)
        const decremented = sampleId - 1;
        const sid = decremented >> 2;
        if (!this.loadedSamples.has(sid)) {
            this.noteStats.notLoaded++;
            chStats.notLoaded++;
            return;
        }

        this.noteStats.played++;
        chStats.played++;

        // Get patch data for this note
        const pitchOffset = patch.pitchOffsets[event.key];
        const volume = patch.volumes[event.key];
        const pan = patch.pans[event.key];
        const exclusiveClass = patch.exclusiveClasses[event.key];
        const globalVolume = patch.globalVolume;
        // In OSRS, if the high bit of pitchOffset is set (negative value), the note loops
        const looped = pitchOffset < 0;

        // Calculate base pitch: (key << 8) - (pitchOffset & 32767)
        const basePitch = (event.key << 8) - (pitchOffset & 32767);

        // Calculate patch volume: velocity^2 * volume * globalVolume
        const patchVolume = (event.velocity * event.velocity * volume * globalVolume + 1024) >> 11;

        // Get envelope data from MusicPatchNode2
        const node2 = patch.envelopes[event.key];
        let volumeEnvelope: number[] | null = null;
        let releaseEnvelope: number[] | null = null;
        let decayRate = 0;
        let volumeEnvRate = 0;
        let releaseEnvRate = 0;
        let decayModifier = 0;
        let vibratoDepth = 0;
        let vibratoRate = 0;
        let vibratoDelay = 0;

        if (node2) {
            volumeEnvelope = node2.volumeEnvelope ? Array.from(node2.volumeEnvelope) : null;
            releaseEnvelope = node2.releaseEnvelope ? Array.from(node2.releaseEnvelope) : null;
            decayRate = node2.decayRate;
            volumeEnvRate = node2.volumeEnvelopeRate;
            releaseEnvRate = node2.releaseEnvelopeRate;
            decayModifier = node2.decayModifier;
            vibratoDepth = node2.vibratoDepth;
            vibratoRate = node2.vibratoRate;
            vibratoDelay = node2.vibratoDelay;
        }

        this.workletNode.port.postMessage({
            type: "noteOn",
            noteId: 0, // Will be assigned in worklet
            channel: event.channel,
            key: event.key,
            velocity: event.velocity,
            sampleIndex: sid,
            basePitch,
            patchVolume,
            pan: pan & 255,
            exclusiveClass,
            looped,
            loopStart: 0, // Will use sample's loop points
            loopEnd: 0,
            sampleRate: 22050, // Default, will be overridden by sample
            volumeEnvelope,
            releaseEnvelope,
            decayRate,
            volumeEnvRate,
            releaseEnvRate,
            decayModifier,
            vibratoDepth,
            vibratoRate,
            vibratoDelay,
            time: absoluteTime,
        });
    }

    /**
     * Check if currently playing
     */
    get playing(): boolean {
        return this.isPlaying && !this.isPaused;
    }

    /**
     * Check if paused
     */
    get paused(): boolean {
        return this.isPaused;
    }

    /**
     * Get current playback position in seconds
     */
    get currentTime(): number {
        return this.tickToMs(this.getCurrentTick()) / 1000;
    }

    /**
     * Get total duration in seconds
     */
    get duration(): number {
        return this.trackDurationMs / 1000;
    }

    /**
     * Clean up resources
     */
    dispose(): void {
        this.stop();

        // Memory leak fix: remove context event listeners
        this.removeContextListeners();

        // Remove visibility listener
        if (this.visibilityListener) {
            document.removeEventListener("visibilitychange", this.visibilityListener);
            this.visibilityListener = null;
        }

        if (this.workletNode) {
            this.workletNode.disconnect();
            this.workletNode = null;
        }
        if (this.gainNode) {
            this.gainNode.disconnect();
            this.gainNode = null;
        }
        if (this.context) {
            this.context.close();
            this.context = null;
        }
        this.workletReady = false;
        this.loadedSamples.clear();
        this.patchCache.clear();
    }
}
