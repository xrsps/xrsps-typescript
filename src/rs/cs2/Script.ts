import { ByteBuffer } from "../io/ByteBuffer";

export class Script {
    id: number = -1;
    name: string | undefined | null = null;
    instructions: Int32Array = new Int32Array(0);
    intOperands: Int32Array = new Int32Array(0);
    stringOperands: (string | null)[] = [];
    longOperands: BigInt64Array = new BigInt64Array(0);
    intArgCount: number = 0;
    objArgCount: number = 0;
    longArgCount: number = 0;
    localIntCount: number = 0;
    localObjCount: number = 0;
    localLongCount: number = 0;
    switches: Map<number, number>[] | null = null;
}

export const Opcodes = {
    SCONST: 3,
    RETURN: 21,
    POP_INT: 38,
    POP_OBJECT: 39,
    LCONST: 61,
    POP_LONG: 62,
    PUSH_NULL: 63,
};

export function parseScriptFromBytes(id: number, data: Int8Array): Script {
    const def = new Script();
    def.id = id;
    const inBuf = new ByteBuffer(data);

    inBuf.offset = inBuf.length - 2;
    const switchLength = inBuf.readUnsignedShort();

    const endIdx = inBuf.length - 2 - switchLength - 16;
    inBuf.offset = endIdx;
    const numOpcodes = inBuf.readInt();
    const localIntCount = inBuf.readUnsignedShort();
    const localObjCount = inBuf.readUnsignedShort();
    const localLongCount = inBuf.readUnsignedShort();
    const intArgCount = inBuf.readUnsignedShort();
    const objArgCount = inBuf.readUnsignedShort();
    const longArgCount = inBuf.readUnsignedShort();

    const numSwitches = inBuf.readUnsignedByte();
    if (numSwitches > 0) {
        const switches: Map<number, number>[] = new Array(numSwitches);
        def.switches = switches;

        for (let i = 0; i < numSwitches; ++i) {
            switches[i] = new Map();

            let count = inBuf.readUnsignedShort();
            while (count-- > 0) {
                const key = inBuf.readInt(); // int from stack is compared to this
                const pcOffset = inBuf.readInt(); // pc jumps by this

                switches[i].set(key, pcOffset);
            }
        }
    }

    def.localIntCount = localIntCount;
    def.localObjCount = localObjCount;
    def.localLongCount = localLongCount;
    def.intArgCount = intArgCount;
    def.objArgCount = objArgCount;
    def.longArgCount = longArgCount;

    inBuf.offset = 0;
    def.name = inBuf.readNullString(); // script name

    const instructions = new Int32Array(numOpcodes);
    const intOperands = new Int32Array(numOpcodes);
    const stringOperands: (string | null)[] = new Array(numOpcodes).fill(null);
    const longOperands = new BigInt64Array(numOpcodes);

    def.instructions = instructions;
    def.intOperands = intOperands;
    def.stringOperands = stringOperands;
    def.longOperands = longOperands;

    for (let i = 0; inBuf.offset < endIdx; ++i) {
        const opcode = inBuf.readUnsignedShort();
        instructions[i] = opcode;
        switch (opcode) {
            case Opcodes.SCONST:
                stringOperands[i] = inBuf.readString();
                break;
            case Opcodes.LCONST: {
                const high = inBuf.readInt();
                const low = inBuf.readInt();
                longOperands[i] = (BigInt(high) << 32n) | BigInt(low >>> 0);
                break;
            }
            case Opcodes.RETURN:
            case Opcodes.POP_INT:
            case Opcodes.POP_OBJECT:
            case Opcodes.POP_LONG:
            case Opcodes.PUSH_NULL:
                intOperands[i] = inBuf.readUnsignedByte();
                break;
            default:
                if (opcode < 100) {
                    intOperands[i] = inBuf.readInt();
                } else {
                    intOperands[i] = inBuf.readUnsignedByte();
                }
                break;
        }
    }

    return def;
}
