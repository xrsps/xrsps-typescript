/**
 * OSRS Vorbis Sample Decoder.
 * Faithful port of the OSRS custom Vorbis decoder.
 */
import { ByteBuffer } from "../../io/ByteBuffer";
import { VorbisBitReader, sharedBitReader } from "./VorbisBitReader";
import { VorbisCodebook } from "./VorbisCodebook";
import { VorbisFloor, VorbisFloorState } from "./VorbisFloor";
import { VorbisMapping } from "./VorbisMapping";
import { VorbisResidue } from "./VorbisResidue";
import { bitReverse, iLog } from "./VorbisUtils";

// Shared setup state (static in Java)
let setupInitialized = false;
let blocksize0 = 0;
let blocksize1 = 0;
let codebooks: VorbisCodebook[] = [];
let floors: VorbisFloor[] = [];
let residues: VorbisResidue[] = [];
let mappings: VorbisMapping[] = [];
let modeBlockFlags: boolean[] = [];
let modeMapping: number[] = [];

// MDCT precomputed tables for each block size
let twiddle0: Float32Array;
let twiddle1: Float32Array;
let window0: Float32Array;
let window1: Float32Array;
let window2_0: Float32Array;
let window2_1: Float32Array;
let bitrev0: Int32Array;
let bitrev1: Int32Array;

export interface RawSoundData {
    sampleRate: number;
    samples: Int8Array;
    start: number;
    end: number;
    looped: boolean;
}

/**
 * Initialize shared Vorbis setup from OSRS setup data (group 0, file 0).
 */
export function initVorbisSetup(setupData: Uint8Array): void {
    if (setupInitialized) return;

    const reader = sharedBitReader;
    reader.init(setupData, 0);

    // Read block sizes (4 bits each)
    blocksize0 = 1 << reader.readBits(4);
    blocksize1 = 1 << reader.readBits(4);

    // Pre-compute MDCT tables for both block sizes
    initMdctTables(0, blocksize0);
    initMdctTables(1, blocksize1);

    // Read codebooks
    const codebookCount = reader.readBits(8) + 1;
    codebooks = new Array(codebookCount);
    for (let i = 0; i < codebookCount; i++) {
        codebooks[i] = new VorbisCodebook(reader);
    }

    // Skip time domain transforms (unused)
    const timeCount = reader.readBits(6) + 1;
    for (let i = 0; i < timeCount; i++) {
        reader.readBits(16);
    }

    // Read floors
    const floorCount = reader.readBits(6) + 1;
    floors = new Array(floorCount);
    for (let i = 0; i < floorCount; i++) {
        floors[i] = new VorbisFloor(reader, codebooks);
    }

    // Read residues
    const residueCount = reader.readBits(6) + 1;
    residues = new Array(residueCount);
    for (let i = 0; i < residueCount; i++) {
        residues[i] = new VorbisResidue(reader, codebooks);
    }

    // Read mappings
    const mappingCount = reader.readBits(6) + 1;
    mappings = new Array(mappingCount);
    for (let i = 0; i < mappingCount; i++) {
        mappings[i] = new VorbisMapping(reader);
    }

    // Read modes
    const modeCount = reader.readBits(6) + 1;
    modeBlockFlags = new Array(modeCount);
    modeMapping = new Array(modeCount);
    for (let i = 0; i < modeCount; i++) {
        modeBlockFlags[i] = reader.readFlag();
        reader.readBits(16); // Window type
        reader.readBits(16); // Transform type
        modeMapping[i] = reader.readBits(8);
    }

    setupInitialized = true;
}

/**
 * Initialize MDCT tables for a block size.
 * Port of VorbisSample static initialization block.
 */
function initMdctTables(idx: number, n: number): void {
    const n2 = n >> 1;
    const n4 = n >> 2;
    const n8 = n >> 3;

    // Twiddle factors
    const twiddle = new Float32Array(n2);
    for (let i = 0; i < n4; i++) {
        twiddle[i * 2] = Math.cos((i * 4 * Math.PI) / n);
        twiddle[i * 2 + 1] = -Math.sin((i * 4 * Math.PI) / n);
    }

    // Window factors
    const window = new Float32Array(n2);
    for (let i = 0; i < n4; i++) {
        window[i * 2] = Math.cos(((i * 2 + 1) * Math.PI) / (n * 2));
        window[i * 2 + 1] = Math.sin(((i * 2 + 1) * Math.PI) / (n * 2));
    }

    // Window2 factors
    const window2 = new Float32Array(n4);
    for (let i = 0; i < n8; i++) {
        window2[i * 2] = Math.cos(((i * 4 + 2) * Math.PI) / n);
        window2[i * 2 + 1] = -Math.sin(((i * 4 + 2) * Math.PI) / n);
    }

    // Bit reversal table
    const bitrev = new Int32Array(n8);
    const bits = iLog(n8 - 1);
    for (let i = 0; i < n8; i++) {
        bitrev[i] = bitReverse(i, bits);
    }

    if (idx === 0) {
        twiddle0 = twiddle;
        window0 = window;
        window2_0 = window2;
        bitrev0 = bitrev;
    } else {
        twiddle1 = twiddle;
        window1 = window;
        window2_1 = window2;
        bitrev1 = bitrev;
    }
}

/**
 * OSRS Vorbis Sample.
 */
export class VorbisSample {
    sampleRate: number;
    sampleCount: number;
    start: number;
    end: number;
    looped: boolean;
    packets: Uint8Array[];

    // Decoding state
    private pcmBuffer: Float32Array; // current frame
    private prevPcmBuffer: Float32Array; // previous frame
    private prevBlockSize: number = 0;
    private prevRightLen: number = 0;
    private prevNoFloor: boolean = false;
    private outputSamples: Int8Array | null = null;
    private outputPos: number = 0;
    private packetIndex: number = 0;

    constructor(data: Uint8Array) {
        const buf = new ByteBuffer(data);

        this.sampleRate = buf.readInt();
        this.sampleCount = buf.readInt();
        this.start = buf.readInt();
        this.end = buf.readInt();

        this.looped = this.end < 0;
        if (this.looped) {
            this.end = ~this.end;
        }

        // Read packets
        const packetCount = buf.readInt();
        this.packets = new Array(packetCount);

        for (let i = 0; i < packetCount; i++) {
            let size = 0;
            let b: number;
            do {
                b = buf.readUnsignedByte();
                size += b;
            } while (b === 255);

            const packet = new Uint8Array(size);
            for (let j = 0; j < size; j++) {
                packet[j] = buf.readUnsignedByte();
            }
            this.packets[i] = packet;
        }

        // Initialize buffers
        this.pcmBuffer = new Float32Array(blocksize1);
        this.prevPcmBuffer = new Float32Array(blocksize1);
    }

    /**
     * Decode a single packet .
     * Returns overlap-added samples or null.
     */
    private decodePacket(packetIdx: number): Float32Array | null {
        const reader = new VorbisBitReader();
        reader.init(this.packets[packetIdx], 0);

        // Skip packet type bit
        reader.readBit();

        // Read mode number
        const modeNumber = reader.readBits(iLog(modeBlockFlags.length - 1));
        const longBlock = modeBlockFlags[modeNumber];
        const n = longBlock ? blocksize1 : blocksize0;

        // Read prev/next window flags for long blocks
        let prevWindowFlag = false;
        let nextWindowFlag = false;
        if (longBlock) {
            prevWindowFlag = reader.readFlag();
            nextWindowFlag = reader.readFlag();
        }

        const n2 = n >> 1;
        const n4 = n >> 2;
        const n8 = n >> 3;

        // Calculate window boundaries
        let leftStart: number, leftEnd: number, leftN: number;
        let rightStart: number, rightEnd: number, rightN: number;

        if (longBlock && !prevWindowFlag) {
            leftStart = n4 - (blocksize0 >> 2);
            leftEnd = (blocksize0 >> 2) + n4;
            leftN = blocksize0 >> 1;
        } else {
            leftStart = 0;
            leftEnd = n2;
            leftN = n2;
        }

        if (longBlock && !nextWindowFlag) {
            rightStart = n2 + n4 - (blocksize0 >> 2);
            rightEnd = (blocksize0 >> 2) + n2 + n4;
            rightN = blocksize0 >> 1;
        } else {
            rightStart = n2;
            rightEnd = n;
            rightN = n2;
        }

        // Get mapping configuration
        const mapping = mappings[modeMapping[modeNumber]];
        const submapIdx = mapping.submaps > 1 ? mapping.channelMux : 0;
        const floorIdx = mapping.floors[submapIdx];

        // Decode floor
        const floorState: VorbisFloorState = floors[floorIdx].decodeFloor(reader);
        const noFloor = !floorState.active;

        // Decode residue into pcmBuffer
        for (let j = 0; j < mapping.submaps; j++) {
            const residue = residues[mapping.residues[j]];
            const tempBuf = this.pcmBuffer;
            residue.decode(tempBuf, n2, noFloor, reader);
        }

        // Apply floor synthesis if active
        if (floorState.active) {
            floors[floorIdx].synthesize(floorState, this.pcmBuffer, n2);
        }

        // Handle no-floor case - zero output
        if (!floorState.active) {
            for (let i = n2; i < n; i++) {
                this.pcmBuffer[i] = 0;
            }
        } else {
            // Perform inverse MDCT
            this.inverseMdct(this.pcmBuffer, n, longBlock);

            // Apply left window
            for (let i = leftStart; i < leftEnd; i++) {
                const t = Math.sin(((i - leftStart + 0.5) / leftN) * 0.5 * Math.PI);
                this.pcmBuffer[i] *= Math.sin((Math.PI / 2) * t * t);
            }

            // Apply right window
            for (let i = rightStart; i < rightEnd; i++) {
                const t = Math.sin(((i - rightStart + 0.5) / rightN) * 0.5 * Math.PI + Math.PI / 2);
                this.pcmBuffer[i] *= Math.sin((Math.PI / 2) * t * t);
            }
        }

        // Build output with overlap-add
        let result: Float32Array | null = null;
        if (this.prevBlockSize > 0) {
            const outputLen = (n + this.prevBlockSize) >> 2;
            result = new Float32Array(outputLen);

            // Add previous frame's right half (if it had floor)
            if (!this.prevNoFloor) {
                for (let i = 0; i < this.prevRightLen; i++) {
                    const srcIdx = i + (this.prevBlockSize >> 1);
                    result[i] += this.prevPcmBuffer[srcIdx];
                }
            }

            // Add current frame's left half (if it has floor)
            if (floorState.active) {
                for (let i = leftStart; i < n2; i++) {
                    const dstIdx = result.length - n2 + i;
                    result[dstIdx] += this.pcmBuffer[i];
                }
            }
        }

        // Swap buffers
        const temp = this.prevPcmBuffer;
        this.prevPcmBuffer = this.pcmBuffer;
        this.pcmBuffer = temp;

        // Update state
        this.prevBlockSize = n;
        this.prevRightLen = rightEnd - n2;
        this.prevNoFloor = !floorState.active;

        return result;
    }

    /**
     * Inverse MDCT transform.
     */
    private inverseMdct(data: Float32Array, n: number, longBlock: boolean): void {
        const n2 = n >> 1;
        const n4 = n >> 2;
        const n8 = n >> 3;

        const twiddle = longBlock ? twiddle1 : twiddle0;
        const window = longBlock ? window1 : window0;
        const window2 = longBlock ? window2_1 : window2_0;
        const bitrev = longBlock ? bitrev1 : bitrev0;

        // Scale by 0.5
        for (let i = 0; i < n2; i++) {
            data[i] *= 0.5;
        }

        // Reflect upper half
        for (let i = n2; i < n; i++) {
            data[i] = -data[n - i - 1];
        }

        // Pre-rotation
        for (let i = 0; i < n4; i++) {
            const a = data[i * 4] - data[n - i * 4 - 1];
            const b = data[i * 4 + 2] - data[n - i * 4 - 3];
            const c = twiddle[i * 2];
            const d = twiddle[i * 2 + 1];
            data[n - i * 4 - 1] = a * c - b * d;
            data[n - i * 4 - 3] = a * d + b * c;
        }

        // First butterfly stage
        for (let i = 0; i < n8; i++) {
            const a = data[n2 + i * 4 + 3];
            const b = data[n2 + i * 4 + 1];
            const c = data[i * 4 + 3];
            const d = data[i * 4 + 1];
            data[n2 + i * 4 + 3] = a + c;
            data[n2 + i * 4 + 1] = b + d;
            const e = twiddle[n2 - 4 - i * 4];
            const f = twiddle[n2 - 3 - i * 4];
            data[i * 4 + 3] = (a - c) * e - (b - d) * f;
            data[i * 4 + 1] = (b - d) * e + (a - c) * f;
        }

        // Recursive butterflies
        const log2n = iLog(n - 1);
        for (let stage = 0; stage < log2n - 3; stage++) {
            const blockCount = n >> (stage + 2);
            const twiddleStep = 8 << stage;

            for (let block = 0; block < 2 << stage; block++) {
                const offset1 = n - blockCount * block * 2;
                const offset2 = n - blockCount * (block * 2 + 1);

                for (let i = 0; i < n >> (stage + 4); i++) {
                    const idx = i * 4;
                    const a = data[offset1 - 1 - idx];
                    const b = data[offset1 - 3 - idx];
                    const c = data[offset2 - 1 - idx];
                    const d = data[offset2 - 3 - idx];
                    data[offset1 - 1 - idx] = a + c;
                    data[offset1 - 3 - idx] = b + d;
                    const e = twiddle[i * twiddleStep];
                    const f = twiddle[i * twiddleStep + 1];
                    data[offset2 - 1 - idx] = (a - c) * e - (b - d) * f;
                    data[offset2 - 3 - idx] = (b - d) * e + (a - c) * f;
                }
            }
        }

        // Bit reversal
        for (let i = 1; i < n8 - 1; i++) {
            const j = bitrev[i];
            if (i < j) {
                const ioff = i * 8;
                const joff = j * 8;
                let tmp = data[ioff + 1];
                data[ioff + 1] = data[joff + 1];
                data[joff + 1] = tmp;
                tmp = data[ioff + 3];
                data[ioff + 3] = data[joff + 3];
                data[joff + 3] = tmp;
                tmp = data[ioff + 5];
                data[ioff + 5] = data[joff + 5];
                data[joff + 5] = tmp;
                tmp = data[ioff + 7];
                data[ioff + 7] = data[joff + 7];
                data[joff + 7] = tmp;
            }
        }

        // Interleave
        for (let i = 0; i < n2; i++) {
            data[i] = data[i * 2 + 1];
        }

        // Unpack
        for (let i = 0; i < n8; i++) {
            data[n - 1 - i * 2] = data[i * 4];
            data[n - 2 - i * 2] = data[i * 4 + 1];
            data[n - n4 - 1 - i * 2] = data[i * 4 + 2];
            data[n - n4 - 2 - i * 2] = data[i * 4 + 3];
        }

        // Post-MDCT butterfly
        // Note: var30=window2[i*2], var31=window2[i*2+1] in Java
        // h = var31*(d-f) + var30*(e+g) = window2[i*2+1]*(d-f) + window2[i*2]*(e+g)
        for (let i = 0; i < n8; i++) {
            const w0 = window2[i * 2]; // var30
            const w1 = window2[i * 2 + 1]; // var31
            const d = data[n2 + i * 2]; // var32
            const e = data[n2 + i * 2 + 1]; // var33
            const f = data[n - 2 - i * 2]; // var34
            const g = data[n - 1 - i * 2]; // var54
            const h = w1 * (d - f) + w0 * (e + g);
            data[n2 + i * 2] = (d + f + h) * 0.5;
            data[n - 2 - i * 2] = (d + f - h) * 0.5;
            const j = w1 * (e + g) - w0 * (d - f);
            data[n2 + i * 2 + 1] = (e - g + j) * 0.5;
            data[n - 1 - i * 2] = (-e + g + j) * 0.5;
        }

        // Final windowing
        for (let i = 0; i < n4; i++) {
            data[i] = data[n2 + i * 2] * window[i * 2] + data[n2 + i * 2 + 1] * window[i * 2 + 1];
            data[n2 - 1 - i] =
                data[n2 + i * 2] * window[i * 2 + 1] - data[n2 + i * 2 + 1] * window[i * 2];
        }

        // Copy second half
        for (let i = 0; i < n4; i++) {
            data[i + n - n4] = -data[i];
        }

        // Flip first quarter
        for (let i = 0; i < n4; i++) {
            data[i] = data[n4 + i];
        }

        for (let i = 0; i < n4; i++) {
            data[n4 + i] = -data[n4 - i - 1];
        }

        // Copy to second half
        for (let i = 0; i < n4; i++) {
            data[n2 + i] = data[n - i - 1];
        }
    }

    /**
     * Convert to raw PCM sound data (toRawSound in Java).
     */
    toRawSound(): RawSoundData {
        if (this.outputSamples === null) {
            this.prevBlockSize = 0;
            this.prevPcmBuffer = new Float32Array(blocksize1);
            this.outputSamples = new Int8Array(this.sampleCount);
            this.outputPos = 0;
            this.packetIndex = 0;
        }

        while (this.packetIndex < this.packets.length) {
            const decoded = this.decodePacket(this.packetIndex);
            this.packetIndex++;

            if (decoded !== null) {
                let copyLen = decoded.length;
                if (copyLen > this.sampleCount - this.outputPos) {
                    copyLen = this.sampleCount - this.outputPos;
                }

                for (let i = 0; i < copyLen; i++) {
                    // Convert float to 8-bit signed PCM
                    let v = Math.floor(128.0 + decoded[i] * 128.0);
                    if ((v & ~0xff) !== 0) {
                        v = ~v >> 31;
                    }
                    this.outputSamples[this.outputPos++] = v - 128;
                }
            }
        }

        this.prevPcmBuffer = new Float32Array(0); // Release
        const samples = this.outputSamples;
        this.outputSamples = null;

        return {
            sampleRate: this.sampleRate,
            samples: samples,
            start: this.start,
            end: this.end,
            looped: this.looped,
        };
    }
}

/**
 * Check if setup has been initialized.
 */
export function isSetupInitialized(): boolean {
    return setupInitialized;
}

/**
 * Reset setup state (for testing).
 */
export function resetSetup(): void {
    setupInitialized = false;
    codebooks = [];
    floors = [];
    residues = [];
    mappings = [];
    modeBlockFlags = [];
    modeMapping = [];
}
