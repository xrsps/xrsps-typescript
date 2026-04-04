/**
 * Packet Module - Binary packet encoding for OSRS protocol
 */

export { PacketBuffer, BITMASKS, type IIsaacCipher } from "./PacketBuffer";
export {
    ClientPacketId,
    ClientPacket,
    CLIENT_PACKET_LENGTHS,
    getPacketLength,
    isVariableLength,
    isVariableShort,
} from "./ClientPacket";
export {
    PacketBufferNode,
    PacketWriter,
    IsaacCipher,
    getPacketWriter,
    createPacket,
    queuePacket,
    flushPackets,
    setPacketSocket,
} from "./PacketWriter";
