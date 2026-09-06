import { deflateSync } from "node:zlib";
import { DUEL_LOBBY_BOUNDS } from "../../../client/common/duel/DuelProtocol";
import { ServerPacketId } from "../../../client/common/packets/ServerPacketId";
import { CollisionMap } from "../../../client/rs/scene/CollisionMap";
import nativeCollision from "./data/lobby-native-collision.json";

/** Native north courtyard and existing bank objects from the installed OSRS cache. */
export const DUEL_LOBBY_SCENE_BOUNDS = DUEL_LOBBY_BOUNDS;
export const DUEL_LOBBY_BANK_CHESTS = [
    {locId:3194,x:3381,y:3269,approachX:3382,approachY:3269},
    {locId:3194,x:3382,y:3270,approachX:3383,approachY:3270},
] as const;

/** Used only to select safe arrivals, never to replace live world collision. */
export function buildDuelLobbyCollision(): CollisionMap {
    const bounds=DUEL_LOBBY_BOUNDS;
    const width=bounds.maxX-bounds.minX+1,height=bounds.maxY-bounds.minY+1;
    if (JSON.stringify(nativeCollision.bounds)!==JSON.stringify(bounds) || nativeCollision.flags.length!==width*height) {
        throw new Error("Native courtyard spawn collision must be rebuilt for these bounds.");
    }
    return new CollisionMap(width,height,Int32Array.from(nativeCollision.flags));
}

let packet: Uint8Array | undefined;
export function buildDuelLobbyPacket(): Uint8Array {
    if (packet) return packet;
    // Clear earlier session overrides. Native terrain and scenery remain intact.
    const json=Buffer.from(JSON.stringify({gamemodeId:"duel",datasets:[]}),"utf8");
    const compressed=deflateSync(json),length=compressed.length+5;
    packet=new Uint8Array(length+3);
    packet[0]=ServerPacketId.GAMEMODE_DATA;
    new DataView(packet.buffer).setUint16(1,length,false);
    packet[3]=1;
    new DataView(packet.buffer).setUint32(4,json.length,false);
    packet.set(compressed,8);
    return packet;
}
