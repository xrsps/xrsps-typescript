import type { DuelSnapshot } from "../../../../client/common/duel/DuelProtocol";
import { encodeDuelSnapshotPayload } from "../../../../client/common/duel/DuelSnapshotCodec";
import { ServerPacketId } from "../../../../client/common/packets/ServerPacketId";
import { ServerPacketBuffer } from "./ServerBinaryEncoder";

export function encodeDuelSnapshot(snapshot: DuelSnapshot): Uint8Array {
    const payload = encodeDuelSnapshotPayload(snapshot);
    if (payload.length > 65535) throw new RangeError("Duel snapshot exceeds the packet size limit");
    const buffer = new ServerPacketBuffer(payload.length);
    buffer.writeBytes(payload, 0, payload.length);
    return buffer.toPacket(ServerPacketId.DUEL_SNAPSHOT);
}
