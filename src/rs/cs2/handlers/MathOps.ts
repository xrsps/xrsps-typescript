/**
 * Math operations: arithmetic, bitwise, random
 */
import { Opcodes } from "../Opcodes";
import type { HandlerMap } from "./HandlerTypes";

export function registerMathOps(handlers: HandlerMap): void {
    // === Basic arithmetic ===
    handlers.set(Opcodes.ADD, (ctx) => {
        const b = ctx.intStack[--ctx.intStackSize];
        const a = ctx.intStack[--ctx.intStackSize];
        ctx.pushInt(a + b);
    });

    handlers.set(Opcodes.SUB, (ctx) => {
        const b = ctx.intStack[--ctx.intStackSize];
        const a = ctx.intStack[--ctx.intStackSize];
        ctx.pushInt(a - b);
    });

    handlers.set(Opcodes.MULTIPLY, (ctx) => {
        const b = ctx.intStack[--ctx.intStackSize];
        const a = ctx.intStack[--ctx.intStackSize];
        ctx.pushInt(Math.imul(a, b));
    });

    handlers.set(Opcodes.DIV, (ctx) => {
        const b = ctx.intStack[--ctx.intStackSize];
        const a = ctx.intStack[--ctx.intStackSize];
        if (b === 0) {
            throw new Error("RuntimeException");
        }
        ctx.pushInt((a / b) | 0);
    });

    handlers.set(Opcodes.MOD, (ctx) => {
        const b = ctx.intStack[--ctx.intStackSize];
        const a = ctx.intStack[--ctx.intStackSize];
        if (b === 0) {
            throw new Error("RuntimeException");
        }
        ctx.pushInt(a % b);
    });

    handlers.set(Opcodes.POW, (ctx) => {
        const b = ctx.intStack[--ctx.intStackSize];
        const a = ctx.intStack[--ctx.intStackSize];
        ctx.pushInt(Math.pow(a, b) | 0);
    });

    handlers.set(Opcodes.INVPOW, (ctx) => {
        const exp = ctx.intStack[--ctx.intStackSize];
        const base = ctx.intStack[--ctx.intStackSize];
        // Inverse power: base^(1/exp) -- integer root
        // Match OSRS exactly: if base is 0, return 0
        if (base === 0) {
            ctx.pushInt(0);
            return;
        }
        switch (exp) {
            case 0:
                ctx.pushInt(2147483647); // Integer.MAX_VALUE
                break;
            case 1:
                ctx.pushInt(base);
                break;
            case 2:
                ctx.pushInt(Math.sqrt(base) | 0);
                break;
            case 3:
                ctx.pushInt(Math.cbrt(base) | 0);
                break;
            case 4:
                ctx.pushInt(Math.sqrt(Math.sqrt(base)) | 0);
                break;
            default:
                ctx.pushInt(Math.pow(base, 1 / exp) | 0);
        }
    });

    // === Bitwise operations ===
    handlers.set(Opcodes.AND, (ctx) => {
        const b = ctx.intStack[--ctx.intStackSize];
        const a = ctx.intStack[--ctx.intStackSize];
        ctx.pushInt(a & b);
    });

    handlers.set(Opcodes.OR, (ctx) => {
        const b = ctx.intStack[--ctx.intStackSize];
        const a = ctx.intStack[--ctx.intStackSize];
        ctx.pushInt(a | b);
    });

    handlers.set(Opcodes.SETBIT, (ctx) => {
        const bit = ctx.intStack[--ctx.intStackSize];
        const value = ctx.intStack[--ctx.intStackSize];
        ctx.pushInt(value | (1 << bit));
    });

    handlers.set(Opcodes.CLEARBIT, (ctx) => {
        const bit = ctx.intStack[--ctx.intStackSize];
        const value = ctx.intStack[--ctx.intStackSize];
        ctx.pushInt(value & ~(1 << bit));
    });

    handlers.set(Opcodes.TESTBIT, (ctx) => {
        const bit = ctx.intStack[--ctx.intStackSize];
        const value = ctx.intStack[--ctx.intStackSize];
        ctx.pushInt((value & (1 << bit)) !== 0 ? 1 : 0);
    });

    handlers.set(Opcodes.TOGGLEBIT, (ctx) => {
        const bit = ctx.intStack[--ctx.intStackSize];
        const value = ctx.intStack[--ctx.intStackSize];
        ctx.pushInt(value ^ (1 << bit));
    });

    handlers.set(Opcodes.BITCOUNT, (ctx) => {
        let value = ctx.intStack[--ctx.intStackSize];
        // Popcount
        value = value - ((value >> 1) & 0x55555555);
        value = (value & 0x33333333) + ((value >> 2) & 0x33333333);
        value = (((value + (value >> 4)) & 0x0f0f0f0f) * 0x01010101) >> 24;
        ctx.pushInt(value & 0xff);
    });

    handlers.set(Opcodes.SETBIT_RANGE, (ctx) => {
        const high = ctx.intStack[--ctx.intStackSize];
        const low = ctx.intStack[--ctx.intStackSize];
        const value = ctx.intStack[--ctx.intStackSize];
        const mask = ((1 << (high - low + 1)) - 1) << low;
        ctx.pushInt(value | mask);
    });

    handlers.set(Opcodes.CLEARBIT_RANGE, (ctx) => {
        const high = ctx.intStack[--ctx.intStackSize];
        const low = ctx.intStack[--ctx.intStackSize];
        const value = ctx.intStack[--ctx.intStackSize];
        const mask = ((1 << (high - low + 1)) - 1) << low;
        ctx.pushInt(value & ~mask);
    });

    handlers.set(Opcodes.GETBIT_RANGE, (ctx) => {
        const high = ctx.intStack[--ctx.intStackSize];
        const low = ctx.intStack[--ctx.intStackSize];
        const value = ctx.intStack[--ctx.intStackSize];
        const mask = (1 << (high - low + 1)) - 1;
        ctx.pushInt((value >> low) & mask);
    });

    // === Min/Max ===
    handlers.set(Opcodes.MIN, (ctx) => {
        const b = ctx.intStack[--ctx.intStackSize];
        const a = ctx.intStack[--ctx.intStackSize];
        ctx.pushInt(Math.min(a, b));
    });

    handlers.set(Opcodes.MAX, (ctx) => {
        const b = ctx.intStack[--ctx.intStackSize];
        const a = ctx.intStack[--ctx.intStackSize];
        ctx.pushInt(Math.max(a, b));
    });

    // === Random ===
    handlers.set(Opcodes.RANDOM, (ctx) => {
        const max = ctx.intStack[--ctx.intStackSize];
        ctx.pushInt((Math.random() * max) | 0);
    });

    handlers.set(Opcodes.RANDOMINC, (ctx) => {
        const max = ctx.intStack[--ctx.intStackSize];
        const bound = (max + 1) | 0;
        ctx.pushInt((Math.random() * bound) | 0);
    });

    // === Scale/Interpolate ===
    handlers.set(Opcodes.SCALE, (ctx) => {
        // OSRS original: (c * a) / b using 64-bit arithmetic
        // Stack order: a (bottom), b, c (top)
        const c = ctx.intStack[--ctx.intStackSize];
        const b = ctx.intStack[--ctx.intStackSize];
        const a = ctx.intStack[--ctx.intStackSize];
        if (b === 0) {
            throw new Error("RuntimeException");
        }
        // Use BigInt for 64-bit precision like OSRS uses long
        const result = Number((BigInt(c) * BigInt(a)) / BigInt(b));
        ctx.pushInt(result | 0);
    });

    handlers.set(Opcodes.INTERPOLATE, (ctx) => {
        // OSRS parity: ScriptOpcodes.INTERPOLATE (4006)
        // Stack order (bottom -> top): a, b, c, d, e
        // Java: a + (b - a) * (e - c) / (d - c)
        ctx.intStackSize -= 5;
        const a = ctx.intStack[ctx.intStackSize] | 0;
        const b = ctx.intStack[ctx.intStackSize + 1] | 0;
        const c = ctx.intStack[ctx.intStackSize + 2] | 0;
        const d = ctx.intStack[ctx.intStackSize + 3] | 0;
        const e = ctx.intStack[ctx.intStackSize + 4] | 0;

        const denom = (d - c) | 0;
        if (denom === 0) {
            // Match Java's ArithmeticException behavior (divide by zero).
            throw new Error("INTERPOLATE divide by zero");
        }

        // Preserve 32-bit int overflow/truncation semantics.
        const mul = (((b - a) | 0) * ((e - c) | 0)) | 0;
        const div = (mul / denom) | 0;
        ctx.pushInt((a + div) | 0);
    });

    handlers.set(Opcodes.ADDPERCENT, (ctx) => {
        const percent = ctx.intStack[--ctx.intStackSize];
        const value = ctx.intStack[--ctx.intStackSize];
        ctx.pushInt((value + (value * percent) / 100) | 0);
    });

    // === Trigonometry (OSRS fixed-point: 16384 units = 360°, values scaled by 16384) ===
    const OSRS_ANGLE_SCALE = 16384;
    const OSRS_ANGLE_TO_RAD = (2 * Math.PI) / OSRS_ANGLE_SCALE;
    const RAD_TO_OSRS_ANGLE = OSRS_ANGLE_SCALE / (2 * Math.PI);

    handlers.set(Opcodes.SIN, (ctx) => {
        const angle = ctx.intStack[ctx.intStackSize - 1] & 0x3fff; // mask to 0-16383
        ctx.intStack[ctx.intStackSize - 1] =
            (Math.sin(angle * OSRS_ANGLE_TO_RAD) * OSRS_ANGLE_SCALE) | 0;
    });

    handlers.set(Opcodes.COS, (ctx) => {
        const angle = ctx.intStack[ctx.intStackSize - 1] & 0x3fff; // mask to 0-16383
        ctx.intStack[ctx.intStackSize - 1] =
            (Math.cos(angle * OSRS_ANGLE_TO_RAD) * OSRS_ANGLE_SCALE) | 0;
    });

    handlers.set(Opcodes.ATAN2, (ctx) => {
        // Pops y, x and returns angle in OSRS units (0-16383)
        ctx.intStackSize -= 2;
        const y = ctx.intStack[ctx.intStackSize];
        const x = ctx.intStack[ctx.intStackSize + 1];
        const radians = Math.atan2(y, x);
        ctx.pushInt(Math.round(radians * RAD_TO_OSRS_ANGLE) & 0x3fff);
    });

    // === Additional math operations ===
    handlers.set(Opcodes.ABS, (ctx) => {
        ctx.intStack[ctx.intStackSize - 1] = Math.abs(ctx.intStack[ctx.intStackSize - 1]);
    });

    handlers.set(Opcodes.STRING_TO_INT, (ctx) => {
        const str = ctx.stringStack[--ctx.stringStackSize];
        // Parse string to int, return -1 if not a valid number
        const num = parseInt(str, 10);
        ctx.pushInt(isNaN(num) ? -1 : num);
    });

    handlers.set(Opcodes.SETBIT_RANGE_VALUE, (ctx) => {
        // Pops: value, newBits, lowBit, highBit
        // Clears bits in range, then sets newBits shifted to that position
        ctx.intStackSize -= 4;
        const value = ctx.intStack[ctx.intStackSize];
        const newBits = ctx.intStack[ctx.intStackSize + 1];
        const lowBit = ctx.intStack[ctx.intStackSize + 2];
        const highBit = ctx.intStack[ctx.intStackSize + 3];
        // Clear the range first
        const mask = ((1 << (highBit - lowBit + 1)) - 1) << lowBit;
        const maxValue = (1 << (highBit - lowBit + 1)) - 1;
        const clampedBits = newBits > maxValue ? maxValue : newBits;
        ctx.pushInt((value & ~mask) | (clampedBits << lowBit));
    });
}
