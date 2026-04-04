/**
 * PacketBuffer - Binary packet encoding for OSRS protocol
 *
 * All write methods use the exact OSRS encoding:
 * - writeByteAdd: (value + 128) & 0xFF
 * - writeByteNeg: (0 - value) & 0xFF
 * - writeByteSub: (128 - value) & 0xFF
 * - writeShortAdd: low byte + 128, then high byte
 * - writeShortAddLE: high byte, then low byte + 128
 * - writeIntME: middle-endian [b1, b0, b3, b2]
 * - writeIntIME: inverse middle-endian [b2, b3, b0, b1]
 *
 * Bit-level operations match PacketBuffer.java exactly:
 * - importIndex: bitIndex = offset * 8
 * - readBits: read n bits using bitmask array
 * - exportIndex: offset = (bitIndex + 7) / 8
 */

/**
 * OSRS bitmask lookup table - matches PacketBuffer.field5172
 * Precomputed masks: field5172[n] = (1 << n) - 1
 * Exported for use in other bit-level operations.
 */
export const BITMASKS: readonly number[] = [
    0, 1, 3, 7, 15, 31, 63, 127, 255, 511, 1023, 2047, 4095, 8191, 16383, 32767, 65535, 131071,
    262143, 524287, 1048575, 2097151, 4194303, 8388607, 16777215, 33554431, 67108863, 134217727,
    268435455, 536870911, 1073741823, 2147483647, -1,
];

/**
 * Interface for ISAAC cipher (matches PacketBuffer.java's isaacCipher field)
 */
export interface IIsaacCipher {
    nextInt(): number;
    /** Peek at next value without consuming (OSRS: method9968) */
    peekInt?(): number;
}

export class PacketBuffer {
    readonly data: Uint8Array;
    private view: DataView;
    offset: number = 0;

    /**
     * Bit index for bit-level operations.
     * OSRS: PacketBuffer.bitIndex
     */
    bitIndex: number = 0;

    /**
     * ISAAC cipher for packet encryption.
     * OSRS: PacketBuffer.isaacCipher
     */
    isaacCipher: IIsaacCipher | null = null;

    constructor(size: number);
    constructor(data: Uint8Array);
    constructor(arg: number | Uint8Array) {
        if (typeof arg === "number") {
            this.data = new Uint8Array(arg);
        } else {
            this.data = arg;
        }
        this.view = new DataView(this.data.buffer, this.data.byteOffset, this.data.byteLength);
    }

    get length(): number {
        return this.data.length;
    }

    get available(): number {
        return this.data.length - this.offset;
    }

    // ========================================
    // BYTE WRITE METHODS
    // ========================================

    /**
     * Write a standard byte
     */
    writeByte(value: number): void {
        this.data[this.offset++] = value & 0xff;
    }

    /**
     * Write byte with ADD encoding: (value + 128) & 0xFF
     */
    writeByteAdd(value: number): void {
        this.data[this.offset++] = (value + 128) & 0xff;
    }

    /**
     * Write byte with NEG encoding: (0 - value) & 0xFF
     */
    writeByteNeg(value: number): void {
        this.data[this.offset++] = (0 - value) & 0xff;
    }

    /**
     * Write byte with SUB encoding: (128 - value) & 0xFF
     */
    writeByteSub(value: number): void {
        this.data[this.offset++] = (128 - value) & 0xff;
    }

    /**
     * Write a boolean as 1 or 0
     */
    writeBoolean(value: boolean): void {
        this.writeByte(value ? 1 : 0);
    }

    // ========================================
    // SHORT WRITE METHODS (2 bytes)
    // ========================================

    /**
     * Write short big-endian: [high, low]
     */
    writeShort(value: number): void {
        this.data[this.offset++] = (value >> 8) & 0xff;
        this.data[this.offset++] = value & 0xff;
    }

    /**
     * Write short little-endian: [low, high]
     */
    writeShortLE(value: number): void {
        this.data[this.offset++] = value & 0xff;
        this.data[this.offset++] = (value >> 8) & 0xff;
    }

    /**
     * Write short with ADD encoding: [low+128, high]
     */
    writeShortAdd(value: number): void {
        this.data[this.offset++] = (value + 128) & 0xff;
        this.data[this.offset++] = (value >> 8) & 0xff;
    }

    /**
     * Write short with ADD LE encoding: [high, low+128]
     */
    writeShortAddLE(value: number): void {
        this.data[this.offset++] = (value >> 8) & 0xff;
        this.data[this.offset++] = (value + 128) & 0xff;
    }

    // ========================================
    // MEDIUM WRITE METHODS (3 bytes)
    // ========================================

    /**
     * Write 3-byte medium big-endian
     */
    writeMedium(value: number): void {
        this.data[this.offset++] = (value >> 16) & 0xff;
        this.data[this.offset++] = (value >> 8) & 0xff;
        this.data[this.offset++] = value & 0xff;
    }

    /**
     * Write 3-byte medium little-endian
     */
    writeMediumLE(value: number): void {
        this.data[this.offset++] = value & 0xff;
        this.data[this.offset++] = (value >> 8) & 0xff;
        this.data[this.offset++] = (value >> 16) & 0xff;
    }

    // ========================================
    // INT WRITE METHODS (4 bytes)
    // ========================================

    /**
     * Write int big-endian: [b3, b2, b1, b0]
     */
    writeInt(value: number): void {
        this.data[this.offset++] = (value >> 24) & 0xff;
        this.data[this.offset++] = (value >> 16) & 0xff;
        this.data[this.offset++] = (value >> 8) & 0xff;
        this.data[this.offset++] = value & 0xff;
    }

    /**
     * Write int little-endian: [b0, b1, b2, b3]
     */
    writeIntLE(value: number): void {
        this.data[this.offset++] = value & 0xff;
        this.data[this.offset++] = (value >> 8) & 0xff;
        this.data[this.offset++] = (value >> 16) & 0xff;
        this.data[this.offset++] = (value >> 24) & 0xff;
    }

    /**
     * Write int middle-endian: [b1, b0, b3, b2]
     * byte order: bits 8-15, 0-7, 24-31, 16-23
     */
    writeIntME(value: number): void {
        this.data[this.offset++] = (value >> 8) & 0xff;
        this.data[this.offset++] = value & 0xff;
        this.data[this.offset++] = (value >> 24) & 0xff;
        this.data[this.offset++] = (value >> 16) & 0xff;
    }

    /**
     * Write int inverse middle-endian: [b2, b3, b0, b1]
     * byte order: bits 16-23, 24-31, 0-7, 8-15
     */
    writeIntIME(value: number): void {
        this.data[this.offset++] = (value >> 16) & 0xff;
        this.data[this.offset++] = (value >> 24) & 0xff;
        this.data[this.offset++] = value & 0xff;
        this.data[this.offset++] = (value >> 8) & 0xff;
    }

    // ========================================
    // LONG WRITE METHODS (8 bytes)
    // ========================================

    /**
     * Write 6-byte long medium
     */
    writeLongMedium(value: bigint): void {
        const n = Number(value);
        this.data[this.offset++] = Number((value >> BigInt(40)) & BigInt(0xff));
        this.data[this.offset++] = Number((value >> BigInt(32)) & BigInt(0xff));
        this.data[this.offset++] = (n >> 24) & 0xff;
        this.data[this.offset++] = (n >> 16) & 0xff;
        this.data[this.offset++] = (n >> 8) & 0xff;
        this.data[this.offset++] = n & 0xff;
    }

    /**
     * Write 8-byte long big-endian
     */
    writeLong(value: bigint): void {
        this.view.setBigInt64(this.offset, value);
        this.offset += 8;
    }

    // ========================================
    // STRING WRITE METHODS
    // ========================================

    /**
     * Write null-terminated CP1252 string
     */
    writeStringCp1252NullTerminated(str: string): void {
        for (let i = 0; i < str.length; i++) {
            this.data[this.offset++] = str.charCodeAt(i) & 0xff;
        }
        this.data[this.offset++] = 0;
    }

    /**
     * Write string with null prefix and suffix
     */
    writeStringCp1252NullCircumfixed(str: string): void {
        this.data[this.offset++] = 0;
        for (let i = 0; i < str.length; i++) {
            this.data[this.offset++] = str.charCodeAt(i) & 0xff;
        }
        this.data[this.offset++] = 0;
    }

    /**
     * Write CESU-8 encoded string with null prefix and varint length.
     * OSRS: Buffer.writeCESU8(CharSequence)
     */
    writeCESU8(str: string): void {
        // Calculate CESU-8 byte length
        let byteLength = 0;
        for (let i = 0; i < str.length; i++) {
            const c = str.charCodeAt(i);
            if (c <= 0x7f) {
                byteLength++;
            } else if (c <= 0x7ff) {
                byteLength += 2;
            } else {
                byteLength += 3;
            }
        }

        // Write null prefix and varint length
        this.data[this.offset++] = 0;
        this.writeVarInt(byteLength);

        // Write CESU-8 encoded bytes
        for (let i = 0; i < str.length; i++) {
            const c = str.charCodeAt(i);
            if (c <= 0x7f) {
                this.data[this.offset++] = c;
            } else if (c <= 0x7ff) {
                this.data[this.offset++] = 0xc0 | (c >> 6);
                this.data[this.offset++] = 0x80 | (c & 0x3f);
            } else {
                this.data[this.offset++] = 0xe0 | (c >> 12);
                this.data[this.offset++] = 0x80 | ((c >> 6) & 0x3f);
                this.data[this.offset++] = 0x80 | (c & 0x3f);
            }
        }
    }

    /**
     * Read CESU-8 encoded string with null prefix and varint length.
     * OSRS: Buffer.readCESU8()
     */
    readCESU8(): string {
        const prefix = this.data[this.offset++];
        if (prefix !== 0) {
            throw new Error("Invalid CESU8 string prefix");
        }

        const byteLength = this.readVarInt();
        if (this.offset + byteLength > this.data.length) {
            throw new Error("CESU8 string exceeds buffer");
        }

        const chars: number[] = [];
        const endOffset = this.offset + byteLength;

        while (this.offset < endOffset) {
            const b0 = this.data[this.offset++] & 0xff;
            if (b0 < 0x80) {
                // Single byte (0xxxxxxx)
                chars.push(b0 === 0 ? 0xfffd : b0);
            } else if (b0 < 0xc0) {
                // Invalid continuation byte
                chars.push(0xfffd);
            } else if (b0 < 0xe0) {
                // Two bytes (110xxxxx 10xxxxxx)
                if (this.offset < endOffset && (this.data[this.offset] & 0xc0) === 0x80) {
                    const c = ((b0 & 0x1f) << 6) | (this.data[this.offset++] & 0x3f);
                    chars.push(c < 0x80 ? 0xfffd : c);
                } else {
                    chars.push(0xfffd);
                }
            } else if (b0 < 0xf0) {
                // Three bytes (1110xxxx 10xxxxxx 10xxxxxx)
                if (
                    this.offset + 1 < endOffset &&
                    (this.data[this.offset] & 0xc0) === 0x80 &&
                    (this.data[this.offset + 1] & 0xc0) === 0x80
                ) {
                    const c =
                        ((b0 & 0x0f) << 12) |
                        ((this.data[this.offset++] & 0x3f) << 6) |
                        (this.data[this.offset++] & 0x3f);
                    chars.push(c < 0x800 ? 0xfffd : c);
                } else {
                    chars.push(0xfffd);
                }
            } else {
                // Four bytes (not valid CESU-8, replaced with replacement char)
                chars.push(0xfffd);
                // Skip continuation bytes
                while (this.offset < endOffset && (this.data[this.offset] & 0xc0) === 0x80) {
                    this.offset++;
                }
            }
        }

        return String.fromCharCode(...chars);
    }

    // ========================================
    // BYTES/BUFFER WRITE METHODS
    // ========================================

    /**
     * Write raw bytes from array
     */
    writeBytes(src: Uint8Array, srcOffset: number, length: number): void {
        for (let i = 0; i < length; i++) {
            this.data[this.offset++] = src[srcOffset + i];
        }
    }

    /**
     * Write another buffer's contents
     */
    writeBuffer(buffer: PacketBuffer): void {
        this.writeBytes(buffer.data, 0, buffer.offset);
    }

    // ========================================
    // SMART WRITE METHODS
    // ========================================

    /**
     * Write variable-size smart (1 or 2 bytes)
     */
    writeSmartByteShort(value: number): void {
        if (value >= 0 && value < 128) {
            this.writeByte(value);
        } else if (value >= 0 && value < 32768) {
            this.writeShort(value + 32768);
        } else {
            throw new Error(`writeSmartByteShort out of range: ${value}`);
        }
    }

    /**
     * Write variable-length integer (1-5 bytes)
     */
    writeVarInt(value: number): void {
        if ((value & ~0x7f) !== 0) {
            if ((value & ~0x3fff) !== 0) {
                if ((value & ~0x1fffff) !== 0) {
                    if ((value & ~0x0fffffff) !== 0) {
                        this.writeByte((value >>> 28) | 0x80);
                    }
                    this.writeByte((value >>> 21) | 0x80);
                }
                this.writeByte((value >>> 14) | 0x80);
            }
            this.writeByte((value >>> 7) | 0x80);
        }
        this.writeByte(value & 0x7f);
    }

    // ========================================
    // LENGTH PREFIX METHODS
    // ========================================

    /**
     * Write length as int at offset before current position
     */
    writeLengthInt(length: number): void {
        if (length < 0) throw new Error("Length cannot be negative");
        const pos = this.offset - length - 4;
        this.data[pos] = (length >> 24) & 0xff;
        this.data[pos + 1] = (length >> 16) & 0xff;
        this.data[pos + 2] = (length >> 8) & 0xff;
        this.data[pos + 3] = length & 0xff;
    }

    /**
     * Write length as short at offset before current position
     */
    writeLengthShort(length: number): void {
        if (length < 0 || length > 65535) throw new Error("Length out of range");
        const pos = this.offset - length - 2;
        this.data[pos] = (length >> 8) & 0xff;
        this.data[pos + 1] = length & 0xff;
    }

    /**
     * Write length as byte at offset before current position
     */
    writeLengthByte(length: number): void {
        if (length < 0 || length > 255) throw new Error("Length out of range");
        this.data[this.offset - length - 1] = length & 0xff;
    }

    // ========================================
    // BYTE READ METHODS
    // ========================================

    /**
     * Read unsigned byte
     */
    readUnsignedByte(): number {
        return this.data[this.offset++] & 0xff;
    }

    /**
     * Read signed byte
     */
    readByte(): number {
        const value = this.data[this.offset++];
        return value > 127 ? value - 256 : value;
    }

    /**
     * Read unsigned byte with ADD decoding
     */
    readUnsignedByteAdd(): number {
        return (this.data[this.offset++] - 128) & 0xff;
    }

    /**
     * Read unsigned byte with NEG decoding
     */
    readUnsignedByteNeg(): number {
        return (0 - this.data[this.offset++]) & 0xff;
    }

    /**
     * Read unsigned byte with SUB decoding
     */
    readUnsignedByteSub(): number {
        return (128 - this.data[this.offset++]) & 0xff;
    }

    /**
     * Read signed byte with ADD decoding
     */
    readByteAdd(): number {
        return ((this.data[this.offset++] - 128) << 24) >> 24;
    }

    /**
     * Read signed byte with NEG decoding
     */
    readByteNeg(): number {
        return ((0 - this.data[this.offset++]) << 24) >> 24;
    }

    /**
     * Read signed byte with SUB decoding
     */
    readByteSub(): number {
        return ((128 - this.data[this.offset++]) << 24) >> 24;
    }

    // ========================================
    // SHORT READ METHODS
    // ========================================

    /**
     * Read unsigned short big-endian
     */
    readUnsignedShort(): number {
        this.offset += 2;
        return ((this.data[this.offset - 2] & 0xff) << 8) + (this.data[this.offset - 1] & 0xff);
    }

    /**
     * Read signed short big-endian
     */
    readShort(): number {
        this.offset += 2;
        let value =
            ((this.data[this.offset - 2] & 0xff) << 8) + (this.data[this.offset - 1] & 0xff);
        if (value > 32767) value -= 65536;
        return value;
    }

    /**
     * Read unsigned short little-endian
     */
    readUnsignedShortLE(): number {
        this.offset += 2;
        return (this.data[this.offset - 2] & 0xff) + ((this.data[this.offset - 1] & 0xff) << 8);
    }

    /**
     * Read signed short little-endian
     */
    readShortLE(): number {
        this.offset += 2;
        let value =
            (this.data[this.offset - 2] & 0xff) + ((this.data[this.offset - 1] & 0xff) << 8);
        if (value > 32767) value -= 65536;
        return value;
    }

    /**
     * Read unsigned short with ADD decoding
     */
    readUnsignedShortAdd(): number {
        this.offset += 2;
        return (
            ((this.data[this.offset - 2] & 0xff) << 8) + ((this.data[this.offset - 1] - 128) & 0xff)
        );
    }

    /**
     * Read unsigned short with ADD LE decoding
     */
    readUnsignedShortAddLE(): number {
        this.offset += 2;
        return (
            ((this.data[this.offset - 1] & 0xff) << 8) + ((this.data[this.offset - 2] - 128) & 0xff)
        );
    }

    // ========================================
    // MEDIUM READ METHODS (3 bytes)
    // ========================================

    /**
     * Read unsigned medium big-endian
     */
    readMedium(): number {
        this.offset += 3;
        return (
            ((this.data[this.offset - 3] & 0xff) << 16) +
            ((this.data[this.offset - 2] & 0xff) << 8) +
            (this.data[this.offset - 1] & 0xff)
        );
    }

    // ========================================
    // INT READ METHODS
    // ========================================

    /**
     * Read int big-endian
     */
    readInt(): number {
        this.offset += 4;
        return (
            (((this.data[this.offset - 4] & 0xff) << 24) +
                ((this.data[this.offset - 3] & 0xff) << 16) +
                ((this.data[this.offset - 2] & 0xff) << 8) +
                (this.data[this.offset - 1] & 0xff)) |
            0
        ); // Force signed 32-bit
    }

    /**
     * Read unsigned int little-endian
     */
    readUnsignedIntLE(): number {
        this.offset += 4;
        return (
            ((this.data[this.offset - 4] & 0xff) +
                ((this.data[this.offset - 3] & 0xff) << 8) +
                ((this.data[this.offset - 2] & 0xff) << 16) +
                ((this.data[this.offset - 1] & 0xff) << 24)) >>>
            0
        ); // Force unsigned
    }

    /**
     * Read unsigned int middle-endian
     */
    readUnsignedIntME(): number {
        this.offset += 4;
        return (
            (((this.data[this.offset - 2] & 0xff) << 24) +
                ((this.data[this.offset - 1] & 0xff) << 16) +
                ((this.data[this.offset - 4] & 0xff) << 8) +
                (this.data[this.offset - 3] & 0xff)) >>>
            0
        );
    }

    /**
     * Read unsigned int inverse middle-endian
     */
    readUnsignedIntIME(): number {
        this.offset += 4;
        return (
            (((this.data[this.offset - 2] & 0xff) << 24) +
                ((this.data[this.offset - 1] & 0xff) << 16) +
                ((this.data[this.offset - 4] & 0xff) << 8) +
                (this.data[this.offset - 3] & 0xff)) >>>
            0
        );
    }

    // ========================================
    // LONG READ METHODS
    // ========================================

    /**
     * Read long big-endian
     */
    readLong(): bigint {
        const high = BigInt(this.readInt()) & BigInt(0xffffffff);
        const low = BigInt(this.readInt()) & BigInt(0xffffffff);
        return (high << BigInt(32)) + low;
    }

    // ========================================
    // STRING READ METHODS
    // ========================================

    /**
     * Read null-terminated CP1252 string
     */
    readStringCp1252NullTerminated(): string {
        const start = this.offset;
        while (this.data[this.offset++] !== 0) {}
        const length = this.offset - start - 1;
        if (length === 0) return "";
        let str = "";
        for (let i = 0; i < length; i++) {
            str += String.fromCharCode(this.data[start + i]);
        }
        return str;
    }

    // ========================================
    // BYTES READ METHODS
    // ========================================

    /**
     * Read bytes into destination array
     */
    readBytes(dest: Uint8Array, destOffset: number, length: number): void {
        for (let i = 0; i < length; i++) {
            dest[destOffset + i] = this.data[this.offset++];
        }
    }

    // ========================================
    // SMART READ METHODS
    // ========================================

    /**
     * Read unsigned short smart (1 or 2 bytes)
     */
    readUShortSmart(): number {
        const peek = this.data[this.offset] & 0xff;
        return peek < 128 ? this.readUnsignedByte() : this.readUnsignedShort() - 32768;
    }

    /**
     * Read signed short smart
     */
    readShortSmart(): number {
        const peek = this.data[this.offset] & 0xff;
        return peek < 128 ? this.readUnsignedByte() - 64 : this.readUnsignedShort() - 49152;
    }

    /**
     * Read variable-length int
     */
    readVarInt(): number {
        let b = this.data[this.offset++];
        let value = 0;
        while (b < 0) {
            value = (value | (b & 0x7f)) << 7;
            b = this.data[this.offset++];
        }
        return value | b;
    }

    // ========================================
    // UTILITY METHODS
    // ========================================

    /**
     * Get the written data as a new Uint8Array
     */
    toArray(): Uint8Array {
        return this.data.subarray(0, this.offset);
    }

    /**
     * Reset offset to 0
     */
    reset(): void {
        this.offset = 0;
    }

    /**
     * Release/clear the array for reuse (pooling support).
     * OSRS: Buffer.releaseArray() - returns array to pool.
     * In TypeScript we just reset state since GC handles memory.
     */
    releaseArray(): void {
        this.offset = 0;
        this.bitIndex = 0;
    }

    // ========================================
    // BIT-LEVEL OPERATIONS (from PacketBuffer.java)
    // ========================================

    /**
     * Prepare for bit-level reads.
     * OSRS: PacketBuffer.importIndex()
     */
    importIndex(): void {
        this.bitIndex = this.offset * 8;
    }

    /**
     * Read n bits from the buffer.
     * OSRS: PacketBuffer.readBits(int)
     *
     * Uses the exact algorithm from PacketBuffer.java:
     * - var2 = bitIndex >> 3 (byte index)
     * - var3 = 8 - (bitIndex & 7) (bits remaining in current byte)
     * - Accumulate bits from multiple bytes as needed
     */
    readBits(count: number): number {
        let byteIndex = this.bitIndex >> 3;
        let bitsInByte = 8 - (this.bitIndex & 7);
        let result = 0;

        this.bitIndex += count;

        while (count > bitsInByte) {
            result += (this.data[byteIndex++] & BITMASKS[bitsInByte]) << (count - bitsInByte);
            count -= bitsInByte;
            bitsInByte = 8;
        }

        if (bitsInByte === count) {
            result += this.data[byteIndex] & BITMASKS[bitsInByte];
        } else {
            result += (this.data[byteIndex] >> (bitsInByte - count)) & BITMASKS[count];
        }

        return result;
    }

    /**
     * Finish bit-level reads, realigning to byte boundary.
     * OSRS: PacketBuffer.exportIndex()
     */
    exportIndex(): void {
        this.offset = ((this.bitIndex + 7) / 8) | 0;
    }

    /**
     * Get bits remaining until a given byte position.
     * OSRS: PacketBuffer.bitsRemaining(int)
     */
    bitsRemaining(maxOffset: number): number {
        return maxOffset * 8 - this.bitIndex;
    }

    // ========================================
    // ADDITIONAL READ METHODS (from Buffer.java)
    // ========================================

    /**
     * Read boolean (1 byte, true if LSB is 1)
     * OSRS: Buffer.readBoolean()
     */
    readBoolean(): boolean {
        return (this.readUnsignedByte() & 1) === 1;
    }

    /**
     * Read float from 4 bytes (int bits to float)
     * OSRS: Buffer.method9394()
     */
    readFloat(): number {
        const intValue = this.readInt();
        // Convert int bits to float using DataView
        const buf = new ArrayBuffer(4);
        const view = new DataView(buf);
        view.setInt32(0, intValue);
        return view.getFloat32(0);
    }

    /**
     * Read null-terminated string, or null if first byte is 0.
     * OSRS: Buffer.readStringCp1252NullTerminatedOrNull()
     */
    readStringCp1252NullTerminatedOrNull(): string | null {
        if (this.data[this.offset] === 0) {
            this.offset++;
            return null;
        }
        return this.readStringCp1252NullTerminated();
    }

    /**
     * Read string with null prefix and suffix.
     * OSRS: Buffer.readStringCp1252NullCircumfixed()
     */
    readStringCp1252NullCircumfixed(): string {
        const prefix = this.data[this.offset++];
        if (prefix !== 0) {
            throw new Error("Invalid string circumfix prefix");
        }
        return this.readStringCp1252NullTerminated();
    }

    /**
     * Read short smart with -1 adjustment.
     * OSRS: Buffer.readShortSmartSub()
     */
    readShortSmartSub(): number {
        const peek = this.data[this.offset] & 0xff;
        return peek < 128 ? this.readUnsignedByte() - 1 : this.readUnsignedShort() - 32769;
    }

    /**
     * Read incrementing small smart (accumulated 32767s).
     * OSRS: Buffer.readIncrSmallSmart()
     */
    readIncrSmallSmart(): number {
        let result = 0;
        let smart = this.readUShortSmart();
        while (smart === 32767) {
            result += 32767;
            smart = this.readUShortSmart();
        }
        return result + smart;
    }

    /**
     * Read large smart (2 or 4 bytes).
     * If first byte >= 128, read int and mask off sign bit.
     * Otherwise read unsigned short.
     * OSRS: Buffer.readLargeSmart()
     */
    readLargeSmart(): number {
        if (this.data[this.offset] < 0) {
            return (this.readInt() & 0x7fffffff) >>> 0;
        }
        return this.readUnsignedShort();
    }

    /**
     * Read nullable large smart.
     * Returns -1 for 32767, otherwise same as readLargeSmart.
     * OSRS: Buffer.readNullableLargeSmart()
     */
    readNullableLargeSmart(): number {
        if (this.data[this.offset] < 0) {
            return (this.readInt() & 0x7fffffff) >>> 0;
        }
        const value = this.readUnsignedShort();
        return value === 32767 ? -1 : value;
    }

    /**
     * Read variable-length int (alternative encoding).
     * OSRS: Buffer.packBytesToInt()
     */
    packBytesToInt(): number {
        let result = 0;
        let shift = 0;
        let b: number;
        do {
            b = this.readUnsignedByte();
            result |= (b & 0x7f) << shift;
            shift += 7;
        } while (b > 127);
        return result;
    }

    /**
     * Read signed short with ADD LE decoding.
     * OSRS: Buffer.method9432()
     */
    readShortAddLE(): number {
        this.offset += 2;
        let value =
            ((this.data[this.offset - 1] & 0xff) << 8) +
            ((this.data[this.offset - 2] - 128) & 0xff);
        if (value > 32767) {
            value -= 65536;
        }
        return value;
    }

    /**
     * Read bytes in reverse order into destination.
     * OSRS: Buffer.method9533()
     */
    readBytesReverse(dest: Uint8Array, destOffset: number, length: number): void {
        for (let i = destOffset + length - 1; i >= destOffset; i--) {
            dest[i] = this.data[this.offset++];
        }
    }

    // ========================================
    // XTEA ENCRYPTION/DECRYPTION (from Buffer.java)
    // ========================================

    /**
     * XTEA decrypt the entire buffer.
     * OSRS: Buffer.xteaDecryptAll(int[])
     */
    xteaDecryptAll(key: Int32Array | number[]): void {
        const blocks = (this.offset / 8) | 0;
        this.offset = 0;
        for (let i = 0; i < blocks; i++) {
            let v0 = this.readInt();
            let v1 = this.readInt();
            let sum = -957401312; // 0xC6EF3720
            const delta = -1640531527; // 0x9E3779B9
            for (let r = 32; r-- > 0; ) {
                v1 -= (((v0 << 4) ^ (v0 >>> 5)) + v0) ^ (key[(sum >>> 11) & 3] + sum);
                sum -= delta;
                v0 -= (((v1 << 4) ^ (v1 >>> 5)) + v1) ^ (key[sum & 3] + sum);
            }
            this.offset -= 8;
            this.writeInt(v0);
            this.writeInt(v1);
        }
    }

    /**
     * XTEA encrypt the entire buffer.
     * OSRS: Buffer.xteaEncryptAll(int[])
     */
    xteaEncryptAll(key: Int32Array | number[]): void {
        const blocks = (this.offset / 8) | 0;
        this.offset = 0;
        for (let i = 0; i < blocks; i++) {
            let v0 = this.readInt();
            let v1 = this.readInt();
            let sum = 0;
            const delta = -1640531527;
            for (let r = 32; r-- > 0; ) {
                v0 += (((v1 << 4) ^ (v1 >>> 5)) + v1) ^ (sum + key[sum & 3]);
                sum += delta;
                v1 += (((v0 << 4) ^ (v0 >>> 5)) + v0) ^ (key[(sum >>> 11) & 3] + sum);
            }
            this.offset -= 8;
            this.writeInt(v0);
            this.writeInt(v1);
        }
    }

    /**
     * XTEA decrypt a range of the buffer.
     * OSRS: Buffer.xteaDecrypt(int[], int, int)
     */
    xteaDecrypt(key: Int32Array | number[], start: number, end: number): void {
        const savedOffset = this.offset;
        this.offset = start;
        const blocks = ((end - start) / 8) | 0;
        for (let i = 0; i < blocks; i++) {
            let v0 = this.readInt();
            let v1 = this.readInt();
            let sum = -957401312;
            const delta = -1640531527;
            for (let r = 32; r-- > 0; ) {
                v1 -= (((v0 << 4) ^ (v0 >>> 5)) + v0) ^ (key[(sum >>> 11) & 3] + sum);
                sum -= delta;
                v0 -= (((v1 << 4) ^ (v1 >>> 5)) + v1) ^ (key[sum & 3] + sum);
            }
            this.offset -= 8;
            this.writeInt(v0);
            this.writeInt(v1);
        }
        this.offset = savedOffset;
    }

    /**
     * XTEA encrypt a range of the buffer.
     * OSRS: Buffer.xteaEncrypt(int[], int, int)
     */
    xteaEncrypt(key: Int32Array | number[], start: number, end: number): void {
        const savedOffset = this.offset;
        this.offset = start;
        const blocks = ((end - start) / 8) | 0;
        for (let i = 0; i < blocks; i++) {
            let v0 = this.readInt();
            let v1 = this.readInt();
            let sum = 0;
            const delta = -1640531527;
            for (let r = 32; r-- > 0; ) {
                v0 += (((v1 << 4) ^ (v1 >>> 5)) + v1) ^ (sum + key[sum & 3]);
                sum += delta;
                v1 += (((v0 << 4) ^ (v0 >>> 5)) + v0) ^ (key[(sum >>> 11) & 3] + sum);
            }
            this.offset -= 8;
            this.writeInt(v0);
            this.writeInt(v1);
        }
        this.offset = savedOffset;
    }

    // ========================================
    // ISAAC CIPHER METHODS (from PacketBuffer.java)
    // ========================================

    /**
     * Set the ISAAC cipher.
     * OSRS: PacketBuffer.newIsaacCipher(int[]) / setIsaacCipher(IsaacCipher)
     */
    setIsaacCipher(cipher: IIsaacCipher | null): void {
        this.isaacCipher = cipher;
    }

    /**
     * Write byte encrypted with ISAAC cipher.
     * OSRS: PacketBuffer.writeByteIsaac(int)
     */
    writeByteIsaac(value: number): void {
        if (!this.isaacCipher) {
            throw new Error("ISAAC cipher not set");
        }
        this.data[this.offset++] = (value + this.isaacCipher.nextInt()) & 0xff;
    }

    /**
     * Read byte decrypted with ISAAC cipher.
     * OSRS: PacketBuffer.readByteIsaac()
     */
    readByteIsaac(): number {
        if (!this.isaacCipher) {
            throw new Error("ISAAC cipher not set");
        }
        return (this.data[this.offset++] - this.isaacCipher.nextInt()) & 0xff;
    }

    /**
     * Check if next ISAAC-encrypted byte indicates a short smart.
     * OSRS: PacketBuffer.method9326()
     */
    peekIsaacSmartIsShort(): boolean {
        if (!this.isaacCipher || !this.isaacCipher.peekInt) {
            throw new Error("ISAAC cipher with peekInt not set");
        }
        const value = (this.data[this.offset] - this.isaacCipher.peekInt()) & 0xff;
        return value >= 128;
    }

    /**
     * Read smart byte/short decrypted with ISAAC cipher.
     * OSRS: PacketBuffer.readSmartByteShortIsaac()
     */
    readSmartByteShortIsaac(): number {
        if (!this.isaacCipher) {
            throw new Error("ISAAC cipher not set");
        }
        const first = (this.data[this.offset++] - this.isaacCipher.nextInt()) & 0xff;
        if (first < 128) {
            return first;
        }
        const second = (this.data[this.offset++] - this.isaacCipher.nextInt()) & 0xff;
        return ((first - 128) << 8) + second;
    }

    /**
     * Read bytes decrypted with ISAAC cipher.
     * OSRS: PacketBuffer.method9357(byte[], int, int)
     */
    readBytesIsaac(dest: Uint8Array, destOffset: number, length: number): void {
        if (!this.isaacCipher) {
            throw new Error("ISAAC cipher not set");
        }
        for (let i = 0; i < length; i++) {
            dest[destOffset + i] = (this.data[this.offset++] - this.isaacCipher.nextInt()) & 0xff;
        }
    }
}
