import { CacheInfo } from "../../cache/CacheInfo";
import { ByteBuffer } from "../../io/ByteBuffer";
import { Type } from "../Type";

export class WorldEntityType extends Type {
    basePlane: number;
    baseXOffset: number;
    baseYOffset: number;
    boundsX: number;
    boundsY: number;
    boundsWidth: number;
    boundsHeight: number;
    name: string;
    isInteractable: boolean;
    actions: (string | null)[];
    idleAnimationId: number;
    spriteId: number;
    sceneTintHsl: number;

    constructor(id: number, cacheInfo: CacheInfo) {
        super(id, cacheInfo);
        this.basePlane = 0;
        this.baseXOffset = 0;
        this.baseYOffset = 0;
        this.boundsX = 0;
        this.boundsY = 0;
        this.boundsWidth = 0;
        this.boundsHeight = 0;
        this.name = "null";
        this.isInteractable = false;
        this.actions = new Array(5).fill(null);
        this.idleAnimationId = -1;
        this.spriteId = -1;
        this.sceneTintHsl = 39188;
    }

    override decodeOpcode(opcode: number, buffer: ByteBuffer): void {
        switch (opcode) {
            case 2:
                this.basePlane = buffer.readUnsignedByte();
                break;
            case 4:
                this.baseXOffset = buffer.readShort();
                break;
            case 5:
                this.baseYOffset = buffer.readShort();
                break;
            case 6:
                this.boundsX = buffer.readShort();
                break;
            case 7:
                this.boundsY = buffer.readShort();
                break;
            case 8:
                this.boundsWidth = buffer.readUnsignedShort();
                break;
            case 9:
                this.boundsHeight = buffer.readUnsignedShort();
                break;
            case 12:
                this.name = this.readString(buffer);
                break;
            case 14:
                this.isInteractable = true;
                break;
            case 15:
            case 16:
            case 17:
            case 18:
            case 19: {
                const index = opcode - 15;
                const action = this.readString(buffer);
                this.actions[index] = action.toLowerCase() === "hidden" ? null : action;
                this.isInteractable = true;
                break;
            }
            case 20:
                buffer.readUnsignedShort();
                break;
            case 23:
                buffer.readUnsignedByte();
                break;
            case 24:
                buffer.readUnsignedByte();
                break;
            case 25:
                this.idleAnimationId = buffer.readUnsignedShort();
                break;
            case 26:
                this.spriteId = buffer.readBigSmart();
                break;
            case 27:
                this.sceneTintHsl = buffer.readUnsignedShort();
                break;
        }
    }
}
