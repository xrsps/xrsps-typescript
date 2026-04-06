import type { CacheSystem } from "../cache/CacheSystem";
import { IndexType } from "../cache/IndexType";

export class Huffman {
    private readonly masks: Int32Array;
    private readonly bits: Uint8Array;
    private keys: Int32Array;

    constructor(bits: Uint8Array) {
        const count = bits.length | 0;
        this.masks = new Int32Array(count);
        this.bits = bits;
        const nextCodes = new Int32Array(33);
        this.keys = new Int32Array(8);
        let maxKey = 0;

        for (let symbol = 0; symbol < count; symbol++) {
            const bitLen = bits[symbol] | 0;
            if (bitLen === 0) continue;
            const bitMask = (1 << (32 - bitLen)) >>> 0;
            const code = nextCodes[bitLen] >>> 0;
            this.masks[symbol] = code | 0;

            let next: number;
            if ((code & bitMask) !== 0) {
                next = nextCodes[bitLen - 1] >>> 0;
            } else {
                next = (code | bitMask) >>> 0;
                for (let i = bitLen - 1; i >= 1; i--) {
                    const prevCode = nextCodes[i] >>> 0;
                    if (prevCode !== code) break;
                    const prevMask = (1 << (32 - i)) >>> 0;
                    if ((prevCode & prevMask) !== 0) {
                        nextCodes[i] = nextCodes[i - 1];
                        break;
                    }
                    nextCodes[i] = prevCode | prevMask | 0;
                }
            }
            nextCodes[bitLen] = next | 0;
            for (let i = bitLen + 1; i <= 32; i++) {
                if (nextCodes[i] >>> 0 === code >>> 0) {
                    nextCodes[i] = next | 0;
                }
            }

            let keyIndex = 0;
            for (let bit = 0; bit < bitLen; bit++) {
                const take = (0x80000000 >>> bit) >>> 0;
                if ((code & take) !== 0) {
                    if (this.keys[keyIndex] === 0) {
                        this.keys[keyIndex] = maxKey;
                    }
                    keyIndex = this.keys[keyIndex] | 0;
                } else {
                    keyIndex++;
                }

                if (keyIndex >= this.keys.length) {
                    const expanded = new Int32Array(this.keys.length * 2);
                    expanded.set(this.keys);
                    this.keys = expanded;
                }
            }
            this.keys[keyIndex] = ~symbol;
            if (keyIndex >= maxKey) maxKey = keyIndex + 1;
        }
    }

    compress(
        src: Uint8Array,
        srcPos: number,
        srcLen: number,
        dst: Uint8Array,
        dstPos: number,
    ): number {
        let curByte = 0;
        let bitPos = (dstPos << 3) | 0;
        const srcEnd = (srcPos + srcLen) | 0;

        for (let i = srcPos | 0; i < srcEnd; i++) {
            const symbol = src[i] & 0xff;
            const mask = this.masks[symbol] >>> 0;
            const bitLen = this.bits[symbol] | 0;
            if (bitLen === 0) throw new Error(`Huffman missing symbol ${symbol}`);

            let byteIndex = bitPos >> 3;
            let bitOffset = bitPos & 7;
            if (bitOffset === 0) curByte = 0;

            const endByte = byteIndex + (((bitOffset + bitLen - 1) >> 3) | 0);
            let shift = bitOffset + 24;

            dst[byteIndex] = (curByte |= mask >>> shift) & 0xff;
            if (byteIndex < endByte) {
                byteIndex++;
                shift -= 8;
                dst[byteIndex] = (curByte = (mask >>> shift) & 0xff) & 0xff;
                if (byteIndex < endByte) {
                    byteIndex++;
                    shift -= 8;
                    dst[byteIndex] = (curByte = (mask >>> shift) & 0xff) & 0xff;
                    if (byteIndex < endByte) {
                        byteIndex++;
                        shift -= 8;
                        dst[byteIndex] = (curByte = (mask >>> shift) & 0xff) & 0xff;
                        if (byteIndex < endByte) {
                            byteIndex++;
                            shift -= 8;
                            dst[byteIndex] = (curByte = (mask << -shift) & 0xff) & 0xff;
                        }
                    }
                }
            }

            bitPos += bitLen;
        }

        return (((bitPos + 7) >> 3) - dstPos) | 0;
    }

    decompress(
        src: Uint8Array,
        srcPos: number,
        dst: Uint8Array,
        dstPos: number,
        dstLen: number,
    ): number {
        if (dstLen === 0) return 0;
        let keyIndex = 0;
        const dstEnd = (dstPos + dstLen) | 0;
        let readPos = srcPos | 0;

        while (true) {
            const byte = (src[readPos] << 24) >> 24; // signed
            if (byte < 0) keyIndex = this.keys[keyIndex] | 0;
            else keyIndex++;

            let value = this.keys[keyIndex] | 0;
            if (value < 0) {
                dst[dstPos++] = ~value & 0xff;
                if (dstPos >= dstEnd) break;
                keyIndex = 0;
            }

            if ((byte & 64) !== 0) keyIndex = this.keys[keyIndex] | 0;
            else keyIndex++;
            value = this.keys[keyIndex] | 0;
            if (value < 0) {
                dst[dstPos++] = ~value & 0xff;
                if (dstPos >= dstEnd) break;
                keyIndex = 0;
            }

            if ((byte & 32) !== 0) keyIndex = this.keys[keyIndex] | 0;
            else keyIndex++;
            value = this.keys[keyIndex] | 0;
            if (value < 0) {
                dst[dstPos++] = ~value & 0xff;
                if (dstPos >= dstEnd) break;
                keyIndex = 0;
            }

            if ((byte & 16) !== 0) keyIndex = this.keys[keyIndex] | 0;
            else keyIndex++;
            value = this.keys[keyIndex] | 0;
            if (value < 0) {
                dst[dstPos++] = ~value & 0xff;
                if (dstPos >= dstEnd) break;
                keyIndex = 0;
            }

            if ((byte & 8) !== 0) keyIndex = this.keys[keyIndex] | 0;
            else keyIndex++;
            value = this.keys[keyIndex] | 0;
            if (value < 0) {
                dst[dstPos++] = ~value & 0xff;
                if (dstPos >= dstEnd) break;
                keyIndex = 0;
            }

            if ((byte & 4) !== 0) keyIndex = this.keys[keyIndex] | 0;
            else keyIndex++;
            value = this.keys[keyIndex] | 0;
            if (value < 0) {
                dst[dstPos++] = ~value & 0xff;
                if (dstPos >= dstEnd) break;
                keyIndex = 0;
            }

            if ((byte & 2) !== 0) keyIndex = this.keys[keyIndex] | 0;
            else keyIndex++;
            value = this.keys[keyIndex] | 0;
            if (value < 0) {
                dst[dstPos++] = ~value & 0xff;
                if (dstPos >= dstEnd) break;
                keyIndex = 0;
            }

            if ((byte & 1) !== 0) keyIndex = this.keys[keyIndex] | 0;
            else keyIndex++;
            value = this.keys[keyIndex] | 0;
            if (value < 0) {
                dst[dstPos++] = ~value & 0xff;
                if (dstPos >= dstEnd) break;
                keyIndex = 0;
            }

            readPos++;
        }

        return (readPos + 1 - srcPos) | 0;
    }
}

export function tryLoadOsrsHuffman(cacheSystem: CacheSystem | undefined): Huffman | undefined {
    if (!cacheSystem) return undefined;
    try {
        const index = cacheSystem.getIndex(IndexType.DAT2.binary);
        const loadFromArchiveId = (archiveId: number): Huffman | undefined => {
            if (archiveId < 0) return undefined;
            const archive = index.getArchive(archiveId);
            const file = archive.getFileNamed("") ?? archive.getFile(0);
            if (!file) return undefined;
            const bytes = new Uint8Array(
                file.data.buffer,
                file.data.byteOffset,
                file.data.byteLength,
            );
            // OSRS chat Huffman is a 256-entry bit-length table.
            if (bytes.length !== 256) return undefined;
            return new Huffman(bytes);
        };

        const archiveId = index.getArchiveId("huffman");
        const direct = loadFromArchiveId(archiveId);
        if (direct) return direct;

        // OSRS caches commonly place the 256-byte Huffman table at archive id 1 in index 10.
        // Use this as a deterministic fallback before the more expensive scan.
        const fixed = loadFromArchiveId(1);
        if (fixed) return fixed;

        // Some cache builds may omit name hashes on the binary index reference table.
        // OSRS still ships the Huffman bit-length table (used for public chat) in this index,
        // so fall back to a small heuristic scan rather than failing silently.
        //
        //
        // ASCII sample string, avoids relying on TextEncoder/Buffer availability.
        const sample = new Uint8Array([104, 101, 108, 108, 111, 32, 119, 111, 114, 108, 100]);
        const tmp = new Uint8Array(2048);
        const out = new Uint8Array(sample.length);

        const ids = index.getArchiveIds();
        for (let i = 0; i < ids.length; i++) {
            const id = ids[i] | 0;
            if (index.getFileCount(id) !== 1) continue;
            // Heuristic: chat Huffman file is exactly 256 bytes.
            // This avoids accidentally selecting unrelated Huffman-like tables.
            try {
                const archive = index.getArchive(id);
                const file = archive.getFileNamed("") ?? archive.getFile(0);
                if (!file) continue;
                if ((file.data.byteLength | 0) !== 256) continue;
            } catch {
                continue;
            }
            let candidate: Huffman | undefined;
            try {
                candidate = loadFromArchiveId(id);
                if (!candidate) continue;
            } catch {
                continue;
            }
            try {
                tmp.fill(0);
                const written = candidate.compress(sample, 0, sample.length, tmp, 0);
                if (!(written > 0)) continue;
                out.fill(0);
                candidate.decompress(tmp, 0, out, 0, out.length);
                let ok = true;
                for (let j = 0; j < sample.length; j++) {
                    if (out[j] !== sample[j]) {
                        ok = false;
                        break;
                    }
                }
                if (ok) return candidate;
            } catch {
                // Not a Huffman table suitable for chat; keep scanning.
            }
        }
        return undefined;
    } catch {
        return undefined;
    }
}
