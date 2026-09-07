import { deflateSync } from "node:zlib";
import type { WorldLocChangeRow, WorldLocSpawnRow, WorldTerrainOverrideRow } from "../../../client/common/gamemode/GamemodeContentStore";
import { ServerPacketId } from "../../../client/common/packets/ServerPacketId";
import { CollisionMap } from "../../../client/rs/scene/CollisionMap";
import type { LocModelType } from "../../../client/rs/config/loctype/LocModelType";
import type { GamemodeServerServices } from "../../src/game/gamemodes/GamemodeDefinition";
import baseLocs from "./data/lobby-base-locs.json";
import { DUEL_LOBBY_BOUNDS, DUEL_LOBBY_CENTER } from "../../../client/common/duel/DuelProtocol";
import { DUEL_ARENA_SCENERY_CHANGES, installDuelArenaScenery } from "./DuelArenaScenery";

/** Flatten and rebuild the desert south of the ring as a social courtyard. */
// The north edge must stop before the native arena arcade at Y3240. Clearing
// its lower floors while leaving the higher arches creates floating masonry.
export const DUEL_LOBBY_SCENE_BOUNDS = {minX:3364,maxX:3390,minY:3223,maxY:3239} as const;
export const DUEL_LOBBY_GROUND_HEIGHT = -160;
export const DUEL_LOBBY_BANK_CHESTS = [{x:3374,y:3237},{x:3377,y:3237}] as const;

interface LobbyObject extends WorldLocSpawnRow {sizeX:number;sizeY:number;blocksProjectile:boolean;}
const objects: LobbyObject[] = [];
function place(locId:number,x:number,y:number,shape:number,rotation:number,sizeX=1,sizeY=1,blocksProjectile=true):void {
    objects.push({locId,x,y,shape,rotation,sizeX,sizeY,blocksProjectile,level:0});
}

// Low sandstone walls enclose the waiting space while leaving its centre unobstructed.
const {minX,maxX,minY,maxY}=DUEL_LOBBY_BOUNDS;
for (let x=minX+1;x<maxX;x++) {
    place(3152,x,minY,0,3);
    place(3152,x,maxY,0,1);
}
for (let y=minY+1;y<maxY;y++) {
    place(3152,minX,y,0,0);
    place(3152,maxX,y,0,2);
}
place(3152,minX,maxY,2,0);
place(3152,maxX,maxY,2,1);
place(3152,maxX,minY,2,2);
place(3152,minX,minY,2,3);
for (const [x,y] of [[3369,3227],[3384,3227],[3369,3236],[3384,3236]]) place(1311,x,y,10,0,2,2);
for (const x of [3371,3380]) place(44829,x,3237,10,0);
for (const [x,y,rotation] of [[3369,3232,1],[3385,3232,3],[3375,3227,0]]) place(5615,x,y,10,rotation,2,1,false);
for (const chest of DUEL_LOBBY_BANK_CHESTS) place(10562,chest.x,chest.y,10,0);

export const DUEL_LOBBY_OBJECTS: readonly LobbyObject[] = objects;
export const DUEL_LOBBY_LOC_CHANGES: WorldLocChangeRow[] = baseLocs.map((loc) => ({
    oldId:loc.id,newId:0,x:loc.x,y:loc.y,level:loc.level,
}));
export const DUEL_LOBBY_TERRAIN: WorldTerrainOverrideRow[] = [];
for (let x:number=DUEL_LOBBY_SCENE_BOUNDS.minX;x<=DUEL_LOBBY_SCENE_BOUNDS.maxX;x++) {
    for (let y:number=DUEL_LOBBY_SCENE_BOUNDS.minY;y<=DUEL_LOBBY_SCENE_BOUNDS.maxY;y++) {
        const courtyard = x>=minX && x<=maxX && y>=minY && y<=maxY;
        const path = courtyard && (Math.abs(x-DUEL_LOBBY_CENTER.x)<=1 || Math.abs(y-DUEL_LOBBY_CENTER.y)<=1);
        const border = courtyard && (x===minX || x===maxX || y===minY || y===maxY);
        const plaza = Math.abs(x-DUEL_LOBBY_CENTER.x)<=3 && Math.abs(y-DUEL_LOBBY_CENTER.y)<=2;
        DUEL_LOBBY_TERRAIN.push({x,y,level:0,underlay:62,overlay:path || plaza ? 77 : border ? 227 : 0,
            shape:0,rotation:0,renderFlags:0,height:DUEL_LOBBY_GROUND_HEIGHT});
        // Remove the original building's upper floors and roofs as well as its objects.
        for (let level=1;level<4;level++) DUEL_LOBBY_TERRAIN.push({x,y,level,underlay:0,overlay:0,shape:0,rotation:0,renderFlags:0});
    }
}

let packet: Uint8Array | undefined;
export function buildDuelLobbyPacket(): Uint8Array {
    if (packet) return packet;
    const json=Buffer.from(JSON.stringify({gamemodeId:"duel",datasets:[
        {key:"worldLocChanges",rows:[...DUEL_LOBBY_LOC_CHANGES,...DUEL_ARENA_SCENERY_CHANGES]},
        {key:"worldLocSpawns",rows:objects.map(({sizeX,sizeY,blocksProjectile,...loc})=>loc)},
        {key:"worldTerrainOverrides",rows:DUEL_LOBBY_TERRAIN},
    ]}),"utf8");
    const compressed=deflateSync(json);
    const length=compressed.length+5;
    if (length>65535) throw new Error("The courtyard content packet is too large.");
    packet=new Uint8Array(length+3);
    packet[0]=ServerPacketId.GAMEMODE_DATA;
    new DataView(packet.buffer).setUint16(1,length,false);
    packet[3]=1;
    new DataView(packet.buffer).setUint32(4,json.length,false);
    packet.set(compressed,8);
    return packet;
}

/** Use the same cache object footprints and wall flags on the server and client. */
export function buildDuelLobbyCollision():CollisionMap {
    const bounds=DUEL_LOBBY_SCENE_BOUNDS;
    const width=bounds.maxX-bounds.minX+1,height=bounds.maxY-bounds.minY+1;
    const collision=new CollisionMap(width,height,new Int32Array(width*height));
    for (const loc of objects) {
        const x=loc.x-bounds.minX,y=loc.y-bounds.minY;
        if (loc.shape<=3) collision.addWall(x,y,loc.shape as LocModelType,loc.rotation,loc.blocksProjectile);
        else {
            const swapped=(loc.rotation&1)!==0;
            collision.addLoc(x,y,swapped?loc.sizeY:loc.sizeX,swapped?loc.sizeX:loc.sizeY,loc.blocksProjectile);
        }
    }
    return collision;
}

export function installDuelLobbyCollision(services: Pick<GamemodeServerServices,"addCollisionFlags"|"removeCollisionFlags"|"setTerrainHeight">):void {
    installDuelArenaScenery(services);
    const bounds=DUEL_LOBBY_SCENE_BOUNDS,collision=buildDuelLobbyCollision();
    for (let x=bounds.minX;x<=bounds.maxX;x++) for (let y=bounds.minY;y<=bounds.maxY;y++) {
        services.setTerrainHeight?.(x,y,0,DUEL_LOBBY_GROUND_HEIGHT);
        services.removeCollisionFlags(x,y,0,0x7fffffff);
        const flags=collision.getFlag(x-bounds.minX,y-bounds.minY);
        if (flags) services.addCollisionFlags(x,y,0,flags);
    }
}
