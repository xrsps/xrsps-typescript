export class BitStream {
    private readonly data: Uint8Array;
    private bytePos = 0;
    private bitPos = 0;

    constructor(buffer: ArrayBuffer | Uint8Array) {
        this.data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    }

    get length(): number {
        return this.data.length;
    }

    get remaining(): number {
        return Math.max(0, this.data.length - this.bytePos);
    }

    get bitPosition(): number {
        return this.bitPos;
    }

    get bytePosition(): number {
        return this.bytePos;
    }

    /** Prepare for bit-level reads (matches Stream.initBitAccess in the reference client). */
    initBitAccess(): void {
        this.bitPos = this.bytePos << 3;
    }

    /** Conclude bit-level reads, realigning to the next byte boundary. */
    finishBitAccess(): void {
        this.bytePos = (this.bitPos + 7) >>> 3;
    }

    /** Read an unsigned value spanning {@code count} bits. */
    readBits(count: number): number {
        if (count <= 0 || count > 32) {
            throw new RangeError(`Invalid bit count: ${count}`);
        }

        // Fast path for byte-aligned common cases
        const bitOffset = this.bitPos;
        if ((bitOffset & 7) === 0) {
            const byteIndex = bitOffset >>> 3;
            if (count === 8 && byteIndex < this.data.length) {
                this.bitPos = bitOffset + 8;
                return this.data[byteIndex];
            }
            if (count === 16 && byteIndex + 1 < this.data.length) {
                this.bitPos = bitOffset + 16;
                return (this.data[byteIndex] << 8) | this.data[byteIndex + 1];
            }
            if (count === 32 && byteIndex + 3 < this.data.length) {
                this.bitPos = bitOffset + 32;
                return (
                    ((this.data[byteIndex] << 24) |
                        (this.data[byteIndex + 1] << 16) |
                        (this.data[byteIndex + 2] << 8) |
                        this.data[byteIndex + 3]) >>>
                    0
                );
            }
        }

        // General case: bit-by-bit extraction
        let result = 0;
        let bitsToRead = count;
        let curBitOffset = bitOffset;
        while (bitsToRead > 0) {
            const byteIndex = curBitOffset >>> 3;
            if (byteIndex >= this.data.length) {
                throw new RangeError(
                    `Buffer exhausted (readBits count=${count} bitPos=${curBitOffset} bytePos=${byteIndex} len=${this.data.length})`,
                );
            }
            const bitsInCurrentByte = 8 - (curBitOffset & 7);
            const bitsFromHere = Math.min(bitsToRead, bitsInCurrentByte);
            const shift = bitsInCurrentByte - bitsFromHere;
            const mask = (1 << bitsFromHere) - 1;
            const value = (this.data[byteIndex] >>> shift) & mask;
            result = (result << bitsFromHere) | value;
            curBitOffset += bitsFromHere;
            bitsToRead -= bitsFromHere;
        }
        this.bitPos = curBitOffset;
        return result >>> 0;
    }

    readByte(): number {
        const value = this.readUnsignedByte();
        return (value << 24) >> 24;
    }

    readUnsignedByte(): number {
        if (this.bytePos >= this.data.length) {
            throw new RangeError(
                `Buffer exhausted (readUnsignedByte bytePos=${this.bytePos} len=${this.data.length})`,
            );
        }
        return this.data[this.bytePos++] & 0xff;
    }

    readUnsignedByteA(): number {
        return (this.readUnsignedByte() - 128) & 0xff;
    }

    /** OSRS `readUnsignedByteAdd` (value - 128). */
    readUnsignedByteAdd(): number {
        return this.readUnsignedByteA();
    }

    readUnsignedByteC(): number {
        return -this.readUnsignedByte() & 0xff;
    }

    /** OSRS `readUnsignedByteNeg` (-value). */
    readUnsignedByteNeg(): number {
        return this.readUnsignedByteC();
    }

    readUnsignedByteS(): number {
        return (128 - this.readUnsignedByte()) & 0xff;
    }

    /** OSRS `readUnsignedByteSub` (128 - value). */
    readUnsignedByteSub(): number {
        return this.readUnsignedByteS();
    }

    readUnsignedShortLE(): number {
        const low = this.readUnsignedByte();
        const high = this.readUnsignedByte();
        return (high << 8) | low;
    }

    readUnsignedShortBE(): number {
        const high = this.readUnsignedByte();
        const low = this.readUnsignedByte();
        return (high << 8) | low;
    }

    readShortLE(): number {
        const value = this.readUnsignedShortLE();
        return value > 0x7fff ? value - 0x10000 : value;
    }

    readUnsignedShortLEA(): number {
        const low = (this.readUnsignedByte() - 128) & 0xff;
        const high = this.readUnsignedByte();
        return (high << 8) | low;
    }

    /** OSRS `readUnsignedShortAddLE` (little-endian; low byte is Add). */
    readUnsignedShortAddLE(): number {
        return this.readUnsignedShortLEA();
    }

    /** OSRS `readUnsignedShortAdd` (big-endian; low byte is Add). */
    readUnsignedShortAdd(): number {
        return this.readUnsignedShortBEA();
    }

    /** OSRS `readByteNeg`: signed result of (0 - value). */
    readByteNeg(): number {
        const v = this.readUnsignedByte();
        return ((0 - v) << 24) >> 24;
    }

    /** OSRS `readByteSub`: signed result of (128 - value). */
    readByteSub(): number {
        const v = this.readUnsignedByte();
        return ((128 - v) << 24) >> 24;
    }

    readUnsignedShortBEA(): number {
        const high = this.readUnsignedByte();
        const low = (this.readUnsignedByte() - 128) & 0xff;
        return (high << 8) | low;
    }

    readShortBE(): number {
        const high = this.readUnsignedByte();
        const low = this.readUnsignedByte();
        const value = (high << 8) | low;
        return value > 0x7fff ? value - 0x10000 : value;
    }

    readIntBE(): number {
        const a = this.readUnsignedByte();
        const b = this.readUnsignedByte();
        const c = this.readUnsignedByte();
        const d = this.readUnsignedByte();
        return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
    }

    /** OSRS "IME" byte order (see Buffer.readUnsignedIntIME). */
    readUnsignedIntIME(): number {
        const a = this.readUnsignedByte(); // offset-4
        const b = this.readUnsignedByte(); // offset-3
        const c = this.readUnsignedByte(); // offset-2
        const d = this.readUnsignedByte(); // offset-1
        return (((b << 24) >>> 0) + ((a << 16) >>> 0) + ((d << 8) >>> 0) + (c >>> 0)) >>> 0;
    }

    /** OSRS "ME" byte order (see Buffer.readUnsignedIntME). */
    readUnsignedIntME(): number {
        const a = this.readUnsignedByte(); // offset-4
        const b = this.readUnsignedByte(); // offset-3
        const c = this.readUnsignedByte(); // offset-2
        const d = this.readUnsignedByte(); // offset-1
        return (((c << 24) >>> 0) + ((d << 16) >>> 0) + ((a << 8) >>> 0) + (b >>> 0)) >>> 0;
    }

    /**
     * OSRS "UShortSmart": if the next byte is < 128, return that byte;
     * otherwise return unsignedShort - 32768.
     */
    readUShortSmart(): number {
        if (this.bytePos >= this.data.length) {
            throw new RangeError(
                `Buffer exhausted (readUShortSmart bytePos=${this.bytePos} len=${this.data.length})`,
            );
        }
        const peek = this.data[this.bytePos] & 0xff;
        if (peek < 128) {
            return this.readUnsignedByte();
        }
        return (this.readUnsignedShortBE() - 32768) | 0;
    }

    readString(): string {
        const bytes: number[] = [];
        while (this.bytePos < this.data.length) {
            const value = this.readUnsignedByte();
            if (value === 10) break;
            bytes.push(value);
        }
        if (bytes.length === 0) return "";
        return new TextDecoder("windows-1252", { fatal: false }).decode(new Uint8Array(bytes));
    }

    readStringCp1252NullTerminated(): string {
        const bytes: number[] = [];
        while (this.bytePos < this.data.length) {
            const value = this.readUnsignedByte();
            if (value === 0) break;
            bytes.push(value);
        }
        if (bytes.length === 0) return "";
        return new TextDecoder("windows-1252", { fatal: false }).decode(new Uint8Array(bytes));
    }

    readBytes(length: number): Uint8Array {
        if (length < 0 || this.bytePos + length > this.data.length) {
            throw new RangeError("Invalid byte length");
        }
        const slice = this.data.subarray(this.bytePos, this.bytePos + length);
        this.bytePos += length;
        return slice;
    }

    skip(length: number): void {
        this.bytePos = Math.min(this.data.length, this.bytePos + Math.max(0, length | 0));
    }
}
