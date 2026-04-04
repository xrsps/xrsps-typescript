import { ByteBuffer } from "../../io/ByteBuffer";
import { Type } from "../Type";

/**
 * Minimal parser for OSRS health bar definitions ({@code healthBar} config archive).
 * Mirrors the structure used by the native client (see HealthBarDefinition in the
 * official deob). Definitions reference two sprites (front/back) and include
 * timing/width settings that control fade-outs and fill behaviour.
 */
export class HealthBarDefinition extends Type {
    int1: number = 255;
    int2: number = 255;
    int3: number = -1;
    /** Step increment used when animating toward the next ratio. */
    field1885: number = 1;
    /** Total linger duration after the last update before the bar fully fades. */
    int5: number = 70;
    frontSpriteId: number = -1;
    backSpriteId: number = -1;
    /** Logical width used when converting ratios into pixel widths. */
    width: number = 30;
    /** Padding applied to each side when stretching foreground sprite. */
    widthPadding: number = 0;

    override decodeOpcode(opcode: number, buffer: ByteBuffer): void {
        if (opcode === 1) {
            // Legacy colour; unused in modern caches.
            buffer.readUnsignedShort();
        } else if (opcode === 2) {
            this.int1 = buffer.readUnsignedByte();
        } else if (opcode === 3) {
            this.int2 = buffer.readUnsignedByte();
        } else if (opcode === 4) {
            this.int3 = 0;
        } else if (opcode === 5) {
            this.int5 = buffer.readUnsignedShort();
        } else if (opcode === 6) {
            // Legacy alpha value; discard.
            buffer.readUnsignedByte();
        } else if (opcode === 7) {
            this.frontSpriteId = buffer.readBigSmart();
        } else if (opcode === 8) {
            this.backSpriteId = buffer.readBigSmart();
        } else if (opcode === 11) {
            this.int3 = buffer.readUnsignedShort();
        } else if (opcode === 14) {
            this.width = buffer.readUnsignedByte();
        } else if (opcode === 15) {
            this.widthPadding = buffer.readUnsignedByte();
        } else {
            // Unknown opcodes are ignored for forwards-compatibility.
        }
    }
}
