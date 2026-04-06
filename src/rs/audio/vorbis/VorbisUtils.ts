/**
 * Vorbis utility functions.
 */

/**
 * Integer log2 (number of bits needed to represent a value)
 * Integer log2
 */
export function iLog(value: number): number {
    let bits = 0;

    if (value < 0 || value >= 65536) {
        value >>>= 16;
        bits += 16;
    }

    if (value >= 256) {
        value >>>= 8;
        bits += 8;
    }

    if (value >= 16) {
        value >>>= 4;
        bits += 4;
    }

    if (value >= 4) {
        value >>>= 2;
        bits += 2;
    }

    if (value >= 1) {
        value >>>= 1;
        bits++;
    }

    if (value >= 1) {
        bits++;
    }

    return bits;
}

/**
 * Reverse bits in an integer
 * Port of 
 */
export function bitReverse(value: number, bits: number): number {
    let result = 0;
    for (let i = 0; i < bits; i++) {
        result = (result << 1) | (value & 1);
        value >>>= 1;
    }
    return result;
}

/**
 * Unpack Vorbis 32-bit float format
 * Port of VorbisSample.float32Unpack
 */
export function float32Unpack(packed: number): number {
    const mantissa = packed & 0x1fffff;
    const sign = packed & 0x80000000;
    const exponent = (packed & 0x7fe00000) >> 21;

    const signedMantissa = sign !== 0 ? -mantissa : mantissa;
    return signedMantissa * Math.pow(2, exponent - 788);
}
