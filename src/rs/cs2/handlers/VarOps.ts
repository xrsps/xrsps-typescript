/**
 * Variable operations: VARP, VARBIT, VARC, arrays
 */
import {
    Cs2ArrayObject,
    createTypedArrayFromCode,
    popTypedValue,
    requireCs2ArrayObject,
} from "../Cs2ArrayObject";
import { Opcodes } from "../Opcodes";
import type { HandlerMap } from "./HandlerTypes";

export function registerVarOps(handlers: HandlerMap): void {
    // === Player variables (VARP) ===
    handlers.set(Opcodes.GET_VARP, (ctx, intOp) => {
        ctx.pushInt(ctx.varManager.getVarp(intOp));
    });

    handlers.set(Opcodes.SET_VARP, (ctx, intOp) => {
        const val = ctx.intStack[--ctx.intStackSize];
        ctx.varManager.setVarp(intOp, val);
    });

    // === Variable bits (VARBIT) ===
    handlers.set(Opcodes.GET_VARBIT, (ctx, intOp) => {
        ctx.pushInt(ctx.varManager.getVarbit(intOp));
    });

    handlers.set(Opcodes.SET_VARBIT, (ctx, intOp) => {
        const val = ctx.intStack[--ctx.intStackSize];
        ctx.varManager.setVarbit(intOp, val);
    });

    // === Client variables (VARC) ===
    handlers.set(Opcodes.GET_VARC_INT, (ctx, intOp) => {
        ctx.pushInt(ctx.varManager.getVarcInt(intOp));
    });

    handlers.set(Opcodes.SET_VARC_INT, (ctx, intOp) => {
        const val = ctx.intStack[--ctx.intStackSize];
        ctx.varManager.setVarcInt(intOp, val);
    });

    handlers.set(Opcodes.GET_VARC_STRING, (ctx, intOp) => {
        ctx.pushString(ctx.varManager.getVarcString(intOp));
    });

    handlers.set(Opcodes.SET_VARC_STRING, (ctx, intOp) => {
        const val = ctx.stringStack[--ctx.stringStackSize];
        ctx.varManager.setVarcString(intOp, val);
    });

    // === Clan variables ===
    // GET_VARCLANSETTING (opcode 74): Retrieves clan settings parameters
    // OSRS: Reads from ClanSettings.parameters (IterableNodeHashTable) via getTitleGroupValue()
    // Returns -1 if the key doesn't exist (matching OSRS behavior)
    handlers.set(Opcodes.GET_VARCLANSETTING, (ctx, intOp) => {
        const value = ctx.clanSettings?.parameters?.get(intOp);
        ctx.pushInt(value ?? -1);
    });

    // GET_VARCLAN (opcode 76): Retrieves clan profile/channel variables
    // Reads from a separate clan profile object
    // We store these in ClanChannel.parameters for architectural simplicity
    // Returns -1 if the key doesn't exist (matching OSRS behavior)
    handlers.set(Opcodes.GET_VARCLAN, (ctx, intOp) => {
        const value = ctx.clanChannel?.parameters?.get(intOp);
        ctx.pushInt(value ?? -1);
    });

    // === Arrays ===
    handlers.set(Opcodes.DEFINE_ARRAY, (ctx, intOp) => {
        const slot = intOp >> 16;
        const typeCode = intOp & 0xffff;
        const length = ctx.intStack[--ctx.intStackSize];
        ctx.setLocalString(slot, createTypedArrayFromCode(typeCode, length, length));
    });

    handlers.set(Opcodes.GET_ARRAY_INT, (ctx, intOp) => {
        const index = ctx.intStack[--ctx.intStackSize];
        const arrayObj = requireCs2ArrayObject(ctx.getLocalString(intOp));
        if (arrayObj.valueType === "int") {
            ctx.pushInt(arrayObj.getInt(index));
        } else {
            ctx.pushString(arrayObj.getObject(index));
        }
    });

    handlers.set(Opcodes.SET_ARRAY_INT, (ctx, intOp) => {
        const arrayObj = requireCs2ArrayObject(ctx.getLocalString(intOp));
        if (arrayObj.valueType === "int") {
            const value = ctx.intStack[--ctx.intStackSize];
            const index = ctx.intStack[--ctx.intStackSize];
            arrayObj.setAt(index, value);
        } else {
            const index = ctx.intStack[--ctx.intStackSize];
            const value = ctx.stringStack[--ctx.stringStackSize];
            arrayObj.setAt(index, value);
        }
    });

    // === Array sort operations ===
    handlers.set(Opcodes.ARRAY_SORT, (ctx) => {
        const secondary = ctx.stringStack[--ctx.stringStackSize];
        const primary = requireCs2ArrayObject(ctx.stringStack[--ctx.stringStackSize]);
        if (secondary == null) {
            primary.sortAllWith(null);
            return;
        }
        const secondaryArray = requireCs2ArrayObject(secondary);
        primary.sortAllWith(secondaryArray);
    });

    handlers.set(Opcodes.ARRAY_SORT_BY, (ctx) => {
        const start = ctx.intStack[ctx.intStackSize - 2];
        const end = ctx.intStack[ctx.intStackSize - 1];
        ctx.intStackSize -= 2;
        const arrayObj = requireCs2ArrayObject(ctx.stringStack[--ctx.stringStackSize]);
        arrayObj.sortRange(start, end);
    });

    handlers.set(Opcodes.ARRAY_IS_NULL, (ctx) => {
        const value = ctx.stringStack[--ctx.stringStackSize];
        ctx.pushInt(value == null ? 1 : 0);
    });

    handlers.set(Opcodes.ARRAY_LENGTH, (ctx) => {
        const value = ctx.stringStack[--ctx.stringStackSize];
        if (value == null) {
            ctx.pushInt(0);
            return;
        }
        const arrayObj = requireCs2ArrayObject(value);
        ctx.pushInt(arrayObj.length);
    });

    handlers.set(Opcodes.ARRAY_COUNT_MATCHES, (ctx) => {
        const start = ctx.intStack[ctx.intStackSize - 3];
        const end = ctx.intStack[ctx.intStackSize - 2];
        const valueType = ctx.intStack[ctx.intStackSize - 1];
        ctx.intStackSize -= 3;
        const value = popTypedValue(
            valueType,
            () => ctx.intStack[--ctx.intStackSize],
            () => ctx.stringStack[--ctx.stringStackSize],
        );
        const arrayValue = ctx.stringStack[--ctx.stringStackSize];
        if (arrayValue == null) {
            ctx.pushInt(0);
            return;
        }
        const arrayObj = requireCs2ArrayObject(arrayValue);
        ctx.pushInt(arrayObj.countMatches(value, start, end));
    });

    handlers.set(Opcodes.ARRAY_MAX_VALUE, (ctx) => {
        const arrayObj = requireCs2ArrayObject(ctx.stringStack[--ctx.stringStackSize]);
        const index = arrayObj.getArgMax();
        if (arrayObj.valueType === "int") {
            ctx.pushInt(index >= 0 ? (arrayObj.getAtOrDefault(index) as number) : -1);
        } else {
            const value = index >= 0 ? arrayObj.getAtOrDefault(index) : "";
            ctx.pushString(typeof value === "string" ? value : value == null ? "" : String(value));
        }
    });

    handlers.set(Opcodes.ARRAY_JOIN, (ctx) => {
        const separator = ctx.stringStack[--ctx.stringStackSize];
        if (typeof separator !== "string") {
            throw new Error("RuntimeException");
        }
        const arrayObj = requireCs2ArrayObject(ctx.stringStack[--ctx.stringStackSize]);
        if (arrayObj.valueType === "object") {
            ctx.pushString(arrayObj.join(separator));
            return;
        }
        const parts: string[] = [];
        for (let i = 0; i < arrayObj.length; i++) {
            parts.push(String(arrayObj.getInt(i)));
        }
        ctx.pushString(parts.join(separator));
    });

    handlers.set(Opcodes.ENUM_TO_ARRAY, (ctx) => {
        const enumId = ctx.intStack[ctx.intStackSize - 1];
        const expectedType = ctx.intStack[ctx.intStackSize - 2];
        ctx.intStackSize -= 2;

        const enumType = ctx.enumTypeLoader?.load(enumId);
        if (!enumType?.outputType) {
            throw new Error("RuntimeException");
        }
        const outputTypeCode = enumType.outputType.charCodeAt(0) | 0;
        if (expectedType !== outputTypeCode) {
            throw new Error("RuntimeException");
        }

        const count = enumType.outputCount | 0;
        if (enumType.outputType === "s") {
            const arrayObj = new Cs2ArrayObject("object", "", count, count, false);
            const values = enumType.stringValues ?? [];
            for (let i = 0; i < count; i++) {
                arrayObj.setAt(i, values[i] ?? "");
            }
            ctx.pushString(arrayObj);
            return;
        }

        const arrayObj = new Cs2ArrayObject("int", -1, count, count, false);
        const values = enumType.intValues ?? [];
        for (let i = 0; i < count; i++) {
            arrayObj.setAt(i, values[i] ?? -1);
        }
        ctx.pushString(arrayObj);
    });

    handlers.set(Opcodes.ARRAY_NEW, (ctx) => {
        const capacityCandidate = ctx.intStack[ctx.intStackSize - 1];
        const length = ctx.intStack[ctx.intStackSize - 2];
        const typeCode = ctx.intStack[ctx.intStackSize - 3];
        ctx.intStackSize -= 3;
        const capacity = capacityCandidate < length ? length : capacityCandidate;
        ctx.pushString(createTypedArrayFromCode(typeCode, length, capacity));
    });

    handlers.set(Opcodes.ARRAY_INSERT, (ctx) => {
        const valueType = ctx.intStack[ctx.intStackSize - 1];
        const index = ctx.intStack[ctx.intStackSize - 2];
        ctx.intStackSize -= 2;
        const value = popTypedValue(
            valueType,
            () => ctx.intStack[--ctx.intStackSize],
            () => ctx.stringStack[--ctx.stringStackSize],
        );
        const arrayObj = requireCs2ArrayObject(ctx.stringStack[--ctx.stringStackSize]);
        arrayObj.insertAt(index, value);
    });
}
