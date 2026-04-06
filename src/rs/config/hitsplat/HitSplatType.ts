import { ByteBuffer } from "../../io/ByteBuffer";
import { Type } from "../Type";

// HitSplat definition parser aligned with runelite-cache HitSplatLoader
export class HitSplatType extends Type {
    // Text and font
    fontId: number = -1; // opcode 1 (bigSmart2)
    textColor: number = 0xffffff; // opcode 2 (24-bit)
    textPattern: string = ""; // opcode 8 (jstr2), e.g. "%1"

    // Background/parts (bigSmart2 sprite ids)
    leftSpriteId: number = -1; // opcode 3
    leftSpriteId2: number = -1; // opcode 4 (optional left devoverlay/alt)
    middleSpriteId: number = -1; // opcode 5 (background/middle)
    rightSpriteId: number = -1; // opcode 6
    // Some clients include an additional icon; not present in runelite HitSplatDefinition
    iconSpriteId: number = -1;

    // Offsets and display settings
    xOffset: number = 0; // opcode 7 (scrollToOffsetX)
    yOffset: number = 0; // opcode 10 (scrollToOffsetY)
    textOffsetY: number = 0; // opcode 13
    displayCycles: number = 70; // opcode 9 (lifetime)
    fadeStartCycle: number = -1; // opcodes 11/14 (0 or ushort)
    /** Selection priority when all 4 slots are active. */
    compareType: number = -1; // opcode 12

    // Transforms (varbit/varp-based multihitsplat chain)
    varbitId: number = -1; // opcode 17/18
    varpId: number = -1; // opcode 17/18
    multihitsplats?: number[]; // opcode 17/18

    override decodeOpcode(opcode: number, buffer: ByteBuffer): void {
        if (opcode === 1) {
            // font id (bigSmart2)
            this.fontId = buffer.readBigSmart();
        } else if (opcode === 2) {
            this.textColor = buffer.readMedium();
        } else if (opcode === 3) {
            this.leftSpriteId = buffer.readBigSmart();
        } else if (opcode === 4) {
            this.leftSpriteId2 = buffer.readBigSmart();
        } else if (opcode === 5) {
            this.middleSpriteId = buffer.readBigSmart();
        } else if (opcode === 6) {
            this.rightSpriteId = buffer.readBigSmart();
        } else if (opcode === 7) {
            this.xOffset = buffer.readShort();
        } else if (opcode === 8) {
            // jstr2: leading 0 byte followed by string; be tolerant across cache variants
            const b = buffer.readByte();
            if (b !== 0) {
                // Fallback: some caches may store plain jstr without the prefix
                buffer.offset--;
            }
            this.textPattern = this.readString(buffer) ?? "";
        } else if (opcode === 9) {
            this.displayCycles = buffer.readUnsignedShort();
        } else if (opcode === 10) {
            this.yOffset = buffer.readShort();
        } else if (opcode === 11) {
            this.fadeStartCycle = 0;
        } else if (opcode === 12) {
            this.compareType = buffer.readUnsignedByte();
        } else if (opcode === 13) {
            this.textOffsetY = buffer.readShort();
        } else if (opcode === 14) {
            this.fadeStartCycle = buffer.readUnsignedShort();
        } else if (opcode === 17 || opcode === 18) {
            // Transforms controlled by varbit/varp
            let varbit = buffer.readUnsignedShort();
            if (varbit === 0xffff) varbit = -1;
            this.varbitId = varbit;

            let varp = buffer.readUnsignedShort();
            if (varp === 0xffff) varp = -1;
            this.varpId = varp;

            let defaultId = -1;
            if (opcode === 18) {
                defaultId = buffer.readUnsignedShort();
                if (defaultId === 0xffff) defaultId = -1;
            }

            const length = buffer.readUnsignedByte();
            const arr = new Array<number>(length + 2);
            for (let i = 0; i <= length; i++) {
                let v = buffer.readUnsignedShort();
                if (v === 0xffff) v = -1;
                arr[i] = v;
            }
            arr[length + 1] = defaultId;
            this.multihitsplats = arr;
        }
    }
}
