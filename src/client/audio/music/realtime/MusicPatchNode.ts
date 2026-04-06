/**
 * Per-note state for real-time music synthesis.
 * Based on RuneLite MusicPatchNode - tracks active notes with envelopes, pitch, and volume.
 */
export class MusicPatchNode {
    // Channel this note belongs to (0-15)
    channel: number = 0;

    // Note key (0-127)
    key: number = 0;

    // Note velocity (0-127)
    velocity: number = 0;

    // Base pitch offset
    basePitch: number = 0;

    // Pitch slide target and progress
    pitchSlideTarget: number = 0;
    pitchSlideProgress: number = 4096; // Fixed point, 4096 = 1.0

    // Volume from patch data
    patchVolume: number = 0;

    // Pan from patch data (0-127)
    pan: number = 64;

    // Sample playback position (fixed point 24.8)
    samplePosition: number = 0;

    // Release state: -1 = not released, >= 0 = release progress
    releaseProgress: number = -1;

    // Volume envelope state
    volumeEnvelopePosition: number = 0;
    volumeEnvelopeIndex: number = 0;

    // Release envelope state
    releaseEnvelopePosition: number = 0;
    releaseEnvelopeIndex: number = 0;

    // Vibrato/LFO state
    vibratoPhase: number = 0;
    vibratoTicks: number = 0;

    // Decay state
    decayPosition: number = 0;

    // Exclusive class (for monophonic instruments)
    exclusiveClass: number = -1;

    // Sample data reference (index into sample array)
    sampleIndex: number = -1;

    // Whether sample loops
    looped: boolean = false;

    // Loop points (in samples)
    loopStart: number = 0;
    loopEnd: number = 0;

    // Sample rate of the loaded sample
    sampleRate: number = 22050;

    // Envelope data from MusicPatchNode2
    volumeEnvelope: Uint8Array | null = null;
    releaseEnvelope: Uint8Array | null = null;

    // MusicPatchNode2 parameters
    decayRate: number = 0;
    volumeEnvRate: number = 0;
    releaseEnvRate: number = 0;
    decayModifier: number = 0;
    vibratoDepth: number = 0;
    vibratoRate: number = 0;
    vibratoDelay: number = 0;

    // Active flag
    active: boolean = true;

    // Time since note started (in samples at 22050 Hz)
    ticksElapsed: number = 0;

    /**
     * Calculate current pitch including portamento/slide
     */
    getCurrentPitch(): number {
        return ((this.pitchSlideProgress * this.pitchSlideTarget) >> 12) + this.basePitch;
    }

    /**
     * Check if note should be removed
     */
    shouldRemove(): boolean {
        return !this.active || (this.releaseProgress >= 0 && this.isReleaseComplete());
    }

    /**
     * Check if release envelope is complete
     */
    private isReleaseComplete(): boolean {
        if (!this.releaseEnvelope || this.releaseEnvelope.length < 2) {
            return this.releaseProgress > 32768;
        }
        // Check if we've reached the end of the release envelope
        return this.releaseEnvelopeIndex * 4 >= this.releaseEnvelope.length - 2;
    }
}

/**
 * Sample data that gets sent to the worklet
 */
export interface SampleData {
    samples: Float32Array;
    sampleRate: number;
    looped: boolean;
    loopStart: number;
    loopEnd: number;
}

/**
 * Patch data for a note
 */
export interface PatchNoteData {
    sampleId: number;
    pitchOffset: number;
    volume: number;
    pan: number;
    exclusiveClass: number;
    globalVolume: number;

    // MusicPatchNode2 envelope data
    volumeEnvelope: Uint8Array | null;
    releaseEnvelope: Uint8Array | null;
    decayRate: number;
    volumeEnvRate: number;
    releaseEnvRate: number;
    decayModifier: number;
    vibratoDepth: number;
    vibratoRate: number;
    vibratoDelay: number;
}
