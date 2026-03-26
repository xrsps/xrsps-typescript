import { ByteBuffer } from "../../io/ByteBuffer";
import { Instrument } from "./Instrument";

export interface RawSoundData {
    sampleRate: number;
    samples: Int8Array;
    start: number;
    end: number;
}

export class SoundEffect {
    private readonly instruments: Array<Instrument | undefined> = new Array(10);
    private start = 0;
    private end = 0;

    static decode(buffer: ByteBuffer): SoundEffect {
        const effect = new SoundEffect();
        for (let i = 0; i < 10; i++) {
            const active = buffer.readUnsignedByte();
            if (active !== 0) {
                buffer.offset--;
                effect.instruments[i] = Instrument.decode(buffer);
            } else {
                effect.instruments[i] = undefined;
            }
        }
        effect.start = buffer.readUnsignedShort();
        effect.end = buffer.readUnsignedShort();
        return effect;
    }

    calculateDelay(): number {
        let delay = Number.MAX_SAFE_INTEGER;
        for (let i = 0; i < 10; i++) {
            const instrument = this.instruments[i];
            if (instrument && instrument.offset / 20 < delay) {
                delay = instrument.offset / 20;
            }
        }
        if (this.start < this.end && this.start / 20 < delay) {
            delay = this.start / 20;
        }
        if (delay === Number.MAX_SAFE_INTEGER || delay === 0) {
            return 0;
        }
        for (let i = 0; i < 10; i++) {
            const instrument = this.instruments[i];
            if (instrument) {
                instrument.offset -= delay * 20;
            }
        }
        if (this.start < this.end) {
            this.start -= delay * 20;
            this.end -= delay * 20;
        }
        return delay;
    }

    private mix(): Int8Array {
        let duration = 0;
        for (let i = 0; i < 10; i++) {
            const instrument = this.instruments[i];
            if (instrument) {
                duration = Math.max(duration, instrument.duration + instrument.offset);
            }
        }
        if (duration === 0) {
            return new Int8Array(0);
        }
        const sampleCount = (duration * 22050) / 1000;
        const mixed = new Int8Array(sampleCount | 0);
        for (let i = 0; i < 10; i++) {
            const instrument = this.instruments[i];
            if (!instrument) continue;
            const soundLength = (instrument.duration * 22050) / 1000;
            const delay = (instrument.offset * 22050) / 1000;
            const samples = instrument.synthesize(soundLength | 0, instrument.duration);
            for (let sample = 0; sample < soundLength; sample++) {
                const idx = (sample + delay) | 0;
                if (idx >= mixed.length) break;
                let value = ((samples[sample] >> 8) + mixed[idx]) | 0;
                if (((value + 128) & ~255) !== 0) {
                    value = (value >> 31) ^ 127;
                }
                mixed[idx] = value;
            }
        }
        return mixed;
    }

    toRawSound(): RawSoundData {
        let samples = this.mix();
        const startSample = (this.start * 22050) / 1000;
        let endSample = (this.end * 22050) / 1000;

        // Trim noisy tails from delay effects for seamless looping
        if (samples.length > 100 && endSample > 0) {
            for (let i = 0; i < samples.length - 1; i++) {
                if (Math.abs(samples[i + 1] - samples[i]) > 80) {
                    const fadeStart = Math.max(0, i - 100);
                    const fadeLength = Math.max(1, i - fadeStart);

                    for (let j = fadeStart; j < i; j++) {
                        const fadeFactor = 1.0 - (j - fadeStart) / fadeLength;
                        samples[j] = (samples[j] * fadeFactor) | 0;
                    }

                    samples = samples.slice(0, i);
                    endSample = Math.min(endSample, samples.length);
                    break;
                }
            }
        }

        return {
            sampleRate: 22050,
            samples,
            start: startSample,
            end: endSample,
        };
    }
}
