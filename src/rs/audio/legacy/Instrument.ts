import { ByteBuffer } from "../../io/ByteBuffer";
import { AudioFilter } from "./AudioFilter";
import { SoundEnvelope } from "./SoundEnvelope";

class JavaRandom {
    private static readonly MULTIPLIER = 0x5deece66dn;
    private static readonly ADDEND = 0xbn;
    private static readonly MASK = (1n << 48n) - 1n;
    private seed: bigint;

    constructor(seed: number) {
        this.seed = (BigInt(seed) ^ JavaRandom.MULTIPLIER) & JavaRandom.MASK;
    }

    private next(bits: number): number {
        this.seed = (this.seed * JavaRandom.MULTIPLIER + JavaRandom.ADDEND) & JavaRandom.MASK;
        return Number(this.seed >> BigInt(48 - bits));
    }

    nextInt(): number {
        return this.next(32) | 0;
    }
}

function clearIntArray(array: Int32Array, length: number): void {
    array.fill(0, 0, length);
}

// Helper to match Java's long cast behavior for filter multiplication
function multiplyAsLong(a: number, b: number): number {
    // Convert to BigInt for 64-bit precision, multiply, then shift and convert back
    return Number((BigInt(a) * BigInt(b)) >> 16n);
}

export class Instrument {
    private static initialized = false;
    private static readonly noise = new Int32Array(32768);
    private static readonly sine = new Int32Array(32768);
    private static readonly samples = new Int32Array(220500);
    private static readonly phases = new Int32Array(5);
    private static readonly delays = new Int32Array(5);
    private static readonly volumeSteps = new Int32Array(5);
    private static readonly pitchSteps = new Int32Array(5);
    private static readonly pitchBaseSteps = new Int32Array(5);

    private static ensureInit(): void {
        if (Instrument.initialized) return;
        Instrument.initialized = true;
        const random = new JavaRandom(0);
        for (let i = 0; i < Instrument.noise.length; i++) {
            Instrument.noise[i] = ((random.nextInt() & 2) - 1) | 0;
        }
        for (let i = 0; i < Instrument.sine.length; i++) {
            Instrument.sine[i] = (Math.sin((i * Math.PI * 2.0) / 32768.0) * 16384.0) | 0;
        }
    }

    pitch!: SoundEnvelope;
    volume!: SoundEnvelope;
    pitchModifier?: SoundEnvelope;
    pitchModifierAmplitude?: SoundEnvelope;
    volumeMultiplier?: SoundEnvelope;
    volumeMultiplierAmplitude?: SoundEnvelope;
    release?: SoundEnvelope;
    attack?: SoundEnvelope;

    readonly oscillatorVolume = [0, 0, 0, 0, 0];
    readonly oscillatorPitch = [0, 0, 0, 0, 0];
    readonly oscillatorDelays = [0, 0, 0, 0, 0];
    delayTime = 0;
    delayDecay = 100;
    filter = new AudioFilter();
    filterEnvelope!: SoundEnvelope;
    duration = 500;
    offset = 0;

    static decode(buffer: ByteBuffer): Instrument {
        Instrument.ensureInit();
        const instrument = new Instrument();
        instrument.pitch = new SoundEnvelope();
        instrument.pitch.decode(buffer);
        instrument.volume = new SoundEnvelope();
        instrument.volume.decode(buffer);

        let opcode = buffer.readUnsignedByte();
        if (opcode !== 0) {
            buffer.offset--;
            instrument.pitchModifier = new SoundEnvelope();
            instrument.pitchModifier.decode(buffer);
            instrument.pitchModifierAmplitude = new SoundEnvelope();
            instrument.pitchModifierAmplitude.decode(buffer);
        }

        opcode = buffer.readUnsignedByte();
        if (opcode !== 0) {
            buffer.offset--;
            instrument.volumeMultiplier = new SoundEnvelope();
            instrument.volumeMultiplier.decode(buffer);
            instrument.volumeMultiplierAmplitude = new SoundEnvelope();
            instrument.volumeMultiplierAmplitude.decode(buffer);
        }

        opcode = buffer.readUnsignedByte();
        if (opcode !== 0) {
            buffer.offset--;
            instrument.release = new SoundEnvelope();
            instrument.release.decode(buffer);
            instrument.attack = new SoundEnvelope();
            instrument.attack.decode(buffer);
        }

        for (let i = 0; i < 10; i++) {
            const volume = buffer.readUnsignedSmart();
            if (volume === 0) break;
            instrument.oscillatorVolume[i] = volume;
            instrument.oscillatorPitch[i] = buffer.readSmart2();
            instrument.oscillatorDelays[i] = buffer.readUnsignedSmart();
        }

        instrument.delayTime = buffer.readUnsignedSmart();
        instrument.delayDecay = buffer.readUnsignedSmart();
        instrument.duration = buffer.readUnsignedShort();
        instrument.offset = buffer.readUnsignedShort();
        instrument.filter = new AudioFilter();
        instrument.filterEnvelope = new SoundEnvelope();
        instrument.filter.decode(buffer, instrument.filterEnvelope);

        return instrument;
    }

    synthesize(sampleCount: number, durationMs: number): Int32Array {
        clearIntArray(Instrument.samples, sampleCount);
        if (durationMs < 10) {
            return Instrument.samples;
        }

        const sampleRate = sampleCount / durationMs;
        this.pitch.reset();
        this.volume.reset();

        let pitchModStep = 0;
        let pitchModBaseStep = 0;
        let pitchModPhase = 0;
        if (this.pitchModifier && this.pitchModifierAmplitude) {
            this.pitchModifier.reset();
            this.pitchModifierAmplitude.reset();
            pitchModStep =
                (((this.pitchModifier.end - this.pitchModifier.start) * 32.768) / sampleRate) | 0;
            pitchModBaseStep = ((this.pitchModifier.start * 32.768) / sampleRate) | 0;
        }

        let volumeModStep = 0;
        let volumeModBaseStep = 0;
        let volumeModPhase = 0;
        if (this.volumeMultiplier && this.volumeMultiplierAmplitude) {
            this.volumeMultiplier.reset();
            this.volumeMultiplierAmplitude.reset();
            volumeModStep =
                (((this.volumeMultiplier.end - this.volumeMultiplier.start) * 32.768) /
                    sampleRate) |
                0;
            volumeModBaseStep = ((this.volumeMultiplier.start * 32.768) / sampleRate) | 0;
        }

        for (let i = 0; i < 5; i++) {
            if (this.oscillatorVolume[i] !== 0) {
                Instrument.phases[i] = 0;
                Instrument.delays[i] = (this.oscillatorDelays[i] * sampleRate) | 0;
                Instrument.volumeSteps[i] = ((this.oscillatorVolume[i] << 14) / 100) | 0;
                Instrument.pitchSteps[i] =
                    (((this.pitch.end - this.pitch.start) *
                        32.768 *
                        Math.pow(1.0057929410678534, this.oscillatorPitch[i])) /
                        sampleRate) |
                    0;
                Instrument.pitchBaseSteps[i] = ((this.pitch.start * 32.768) / sampleRate) | 0;
            }
        }

        for (let sample = 0; sample < sampleCount; sample++) {
            let pitchValue = this.pitch.doStep(sampleCount);
            let volumeValue = this.volume.doStep(sampleCount);

            if (this.pitchModifier && this.pitchModifierAmplitude) {
                const mod = this.pitchModifier.doStep(sampleCount);
                const modAmp = this.pitchModifierAmplitude.doStep(sampleCount);
                pitchValue +=
                    this.evaluateWave(pitchModPhase, modAmp, this.pitchModifier.form) >> 1;
                pitchModPhase += ((mod * pitchModStep) >> 16) + pitchModBaseStep;
            }

            if (this.volumeMultiplier && this.volumeMultiplierAmplitude) {
                const mod = this.volumeMultiplier.doStep(sampleCount);
                const modAmp = this.volumeMultiplierAmplitude.doStep(sampleCount);
                volumeValue =
                    (volumeValue *
                        ((this.evaluateWave(volumeModPhase, modAmp, this.volumeMultiplier.form) >>
                            1) +
                            32768)) >>
                    15;
                volumeModPhase += ((mod * volumeModStep) >> 16) + volumeModBaseStep;
            }

            for (let osc = 0; osc < 5; osc++) {
                if (this.oscillatorVolume[osc] !== 0) {
                    const delay = Instrument.delays[osc] + sample;
                    if (delay < sampleCount) {
                        Instrument.samples[delay] += this.evaluateWave(
                            Instrument.phases[osc],
                            (volumeValue * Instrument.volumeSteps[osc]) >> 15,
                            this.pitch.form,
                        );
                        Instrument.phases[osc] +=
                            ((pitchValue * Instrument.pitchSteps[osc]) >> 16) +
                            Instrument.pitchBaseSteps[osc];
                    }
                }
            }
        }

        if (this.release && this.attack) {
            this.release.reset();
            this.attack.reset();
            let toggle = true;
            let step = 0;
            for (let i = 0; i < sampleCount; i++) {
                const releaseValue = this.release.doStep(sampleCount);
                const attackValue = this.attack.doStep(sampleCount);
                const threshold = toggle
                    ? this.release.start +
                      (((this.release.end - this.release.start) * releaseValue) >> 8)
                    : this.release.start +
                      (((this.release.end - this.release.start) * attackValue) >> 8);
                step += 256;
                if (step >= threshold) {
                    step = 0;
                    toggle = !toggle;
                }
                if (toggle) {
                    Instrument.samples[i] = 0;
                }
            }
        }

        if (this.delayTime > 0 && this.delayDecay > 0) {
            const delay = (this.delayTime * sampleRate) | 0;
            for (let i = delay; i < sampleCount; i++) {
                // Integer division to match Java behavior and prevent float accumulation errors
                Instrument.samples[i] +=
                    ((Instrument.samples[i - delay] * this.delayDecay) / 100) | 0;
            }
        }

        const filterPairs0 = this.filter.pairs[0];
        const filterPairs1 = this.filter.pairs[1];
        if (filterPairs0 > 0 || filterPairs1 > 0) {
            this.filterEnvelope.reset();
            let envelopeValue = this.filterEnvelope.doStep(sampleCount + 1);
            let len0 = this.filter.compute(0, envelopeValue / 65536.0);
            let len1 = this.filter.compute(1, envelopeValue / 65536.0);
            if (sampleCount >= len0 + len1) {
                let sample = 0;
                let target = len1;
                if (len1 > sampleCount - len0) {
                    target = sampleCount - len0;
                }

                while (sample < target) {
                    let acc = multiplyAsLong(
                        Instrument.samples[sample + len0],
                        AudioFilter.getForwardMultiplier(),
                    );
                    const coeff0 = AudioFilter.getCoefficients(0);
                    for (let i = 0; i < len0; i++) {
                        acc += multiplyAsLong(Instrument.samples[sample + len0 - 1 - i], coeff0[i]);
                    }
                    const coeff1 = AudioFilter.getCoefficients(1);
                    for (let i = 0; i < sample; i++) {
                        acc -= multiplyAsLong(Instrument.samples[sample - 1 - i], coeff1[i]);
                    }
                    Instrument.samples[sample] = acc;
                    envelopeValue = this.filterEnvelope.doStep(sampleCount + 1);
                    sample++;
                }

                let block = 128;
                while (true) {
                    if (block > sampleCount - len0) {
                        block = sampleCount - len0;
                    }
                    while (sample < block) {
                        let acc = multiplyAsLong(
                            Instrument.samples[sample + len0],
                            AudioFilter.getForwardMultiplier(),
                        );
                        const coeff0 = AudioFilter.getCoefficients(0);
                        for (let i = 0; i < len0; i++) {
                            acc += multiplyAsLong(
                                Instrument.samples[sample + len0 - 1 - i],
                                coeff0[i],
                            );
                        }
                        const coeff1 = AudioFilter.getCoefficients(1);
                        for (let i = 0; i < len1; i++) {
                            acc -= multiplyAsLong(Instrument.samples[sample - 1 - i], coeff1[i]);
                        }
                        Instrument.samples[sample] = acc;
                        envelopeValue = this.filterEnvelope.doStep(sampleCount + 1);
                        sample++;
                    }
                    if (sample >= sampleCount - len0) break;
                    len0 = this.filter.compute(0, envelopeValue / 65536.0);
                    len1 = this.filter.compute(1, envelopeValue / 65536.0);
                    block += 128;
                }

                while (sample < sampleCount) {
                    let acc = 0;
                    const coeff0 = AudioFilter.getCoefficients(0);
                    for (let i = sample + len0 - sampleCount; i < len0; i++) {
                        acc += multiplyAsLong(Instrument.samples[sample + len0 - 1 - i], coeff0[i]);
                    }
                    const coeff1 = AudioFilter.getCoefficients(1);
                    for (let i = 0; i < len1; i++) {
                        acc -= multiplyAsLong(Instrument.samples[sample - 1 - i], coeff1[i]);
                    }
                    Instrument.samples[sample] = acc;
                    this.filterEnvelope.doStep(sampleCount + 1);
                    sample++;
                }
            }
        }

        for (let i = 0; i < sampleCount; i++) {
            if (Instrument.samples[i] < -32768) {
                Instrument.samples[i] = -32768;
            }
            if (Instrument.samples[i] > 32767) {
                Instrument.samples[i] = 32767;
            }
        }

        return Instrument.samples;
    }

    private evaluateWave(phase: number, amplitude: number, form: number): number {
        const idx = phase & 32767;
        switch (form) {
            case 1:
                return idx < 16384 ? amplitude : -amplitude;
            case 2:
                return (Instrument.sine[idx] * amplitude) >> 14;
            case 3:
                return ((amplitude * idx) >> 14) - amplitude;
            case 4:
                // Need integer division like Java: phase / 2607 -> Math.floor
                return amplitude * Instrument.noise[((phase / 2607) | 0) & 32767];
            default:
                return 0;
        }
    }
}
