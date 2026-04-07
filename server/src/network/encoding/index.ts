/**
 * Packet encoding module for OSRS-style sync packets.
 *
 * This module extracts the binary packet encoding logic from wsServer
 * into dedicated encoder classes following the service interface pattern.
 */

export * from "./constants";
export * from "./types";
export {
    NpcPacketEncoder,
    type NpcTickFrameData,
} from "./NpcPacketEncoder";
export {
    PlayerPacketEncoder,
    type PlayerTickFrameData,
    type MovementInfo,
} from "./PlayerPacketEncoder";
