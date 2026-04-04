import { ByteBuffer } from "../../io/ByteBuffer";

/**
 * Legacy SoundEnvelope implementation ported from the RuneScape client.
 * Used by legacy synthesized sound effects (pre-Vorbis) to shape volume/pitch.
 */
export class SoundEnvelope {
    private segments = 2;
    private durations: number[] = [0, 65535];
    private phases: number[] = [0, 65535];

    start = 0;
    end = 0;
    form = 0;

    private ticks = 0;
    private phaseIndex = 0;
    private step = 0;
    private amplitude = 0;
    private max = 0;

    decode(buffer: ByteBuffer): void {
        this.form = buffer.readUnsignedByte();
        this.start = buffer.readInt();
        this.end = buffer.readInt();
        this.decodeSegments(buffer);
    }

    decodeSegments(buffer: ByteBuffer): void {
        this.segments = buffer.readUnsignedByte();
        if (this.segments < 1) {
            this.segments = 1;
        }
        this.durations = new Array(this.segments);
        this.phases = new Array(this.segments);
        for (let i = 0; i < this.segments; i++) {
            this.durations[i] = buffer.readUnsignedShort();
            this.phases[i] = buffer.readUnsignedShort();
        }
    }

    reset(): void {
        this.ticks = 0;
        this.phaseIndex = 0;
        this.step = 0;
        this.amplitude = 0;
        this.max = 0;
    }

    /**
     * Advances the envelope by one sample for a buffer with {@link length} samples.
     */
    doStep(length: number): number {
        if (this.max >= this.ticks) {
            this.amplitude = this.phases[this.phaseIndex++] << 15;
            if (this.phaseIndex >= this.segments) {
                this.phaseIndex = this.segments - 1;
            }
            this.ticks = ((this.durations[this.phaseIndex] / 65536.0) * length) | 0;
            if (this.ticks > this.max) {
                this.step =
                    (((this.phases[this.phaseIndex] << 15) - this.amplitude) /
                        (this.ticks - this.max)) |
                    0;
            }
        }
        this.amplitude += this.step;
        this.max++;
        return (this.amplitude - this.step) >> 15;
    }
}
