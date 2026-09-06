import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { CollisionFlag } from "../../client/common/CollisionFlag";
import { DUEL_SHOPKEEPER } from "../../client/common/duel/DuelShop";
import { ARENA_CENTER, DUEL_LOBBY_BOUNDS, DUEL_LOBBY_CENTER, isDuelSnapshot, type DuelSnapshot } from "../../client/common/duel/DuelProtocol";
import { DuelArenaService } from "../gamemodes/duel/DuelArenaService";
import type { DuelEconomy } from "../gamemodes/duel/DuelEconomy";
import { buildDuelLobbyCollision, buildDuelLobbyPacket, DUEL_LOBBY_BANK_CHESTS, DUEL_LOBBY_SCENE_BOUNDS } from "../gamemodes/duel/DuelLobbyScene";
import { DUEL_LOBBY_SPAWN_TILES, isDuelLobbyWalkable } from "../gamemodes/duel/DuelLobbySpawns";
import { DuelGamemode } from "../gamemodes/duel";
import { registerDuelProviders } from "../gamemodes/duel/DuelProviders";
import { ensureEquipQtyArrayOn } from "../src/game/equipment";
import type { GamemodeServerServices } from "../src/game/gamemodes/GamemodeDefinition";
import { PlayerState } from "../src/game/player";
import { encodeDuelSnapshot } from "../src/network/packet/DuelSnapshotEncoder";

const collision=buildDuelLobbyCollision();
const bounds=DUEL_LOBBY_BOUNDS;
assert.deepEqual(bounds,{minX:3357,maxX:3388,minY:3261,maxY:3274});
assert.deepEqual(DUEL_LOBBY_CENTER,{x:3367,y:3267,level:0});
const key=(x:number,y:number)=>`${x},${y}`;
const flag=(x:number,y:number)=>collision.getFlag(x-DUEL_LOBBY_SCENE_BOUNDS.minX,y-DUEL_LOBBY_SCENE_BOUNDS.minY);
const reachable=new Set([key(DUEL_LOBBY_CENTER.x,DUEL_LOBBY_CENTER.y)]);
const queue:Array<[number,number]>=[[DUEL_LOBBY_CENTER.x,DUEL_LOBBY_CENTER.y]];
// Flood-fill with the real pathfinder's entry masks, checking every accessible
// floor tile rather than assuming object-free coordinates form one connected area.
for (let index=0;index<queue.length;index++) {
    const [x,y]=queue[index];
    for (const [dx,dy,mask] of [[-1,0,CollisionFlag.BLOCK_WEST],[1,0,CollisionFlag.BLOCK_EAST],
        [0,-1,CollisionFlag.BLOCK_SOUTH],[0,1,CollisionFlag.BLOCK_NORTH]]) {
        const nextX=x+dx,nextY=y+dy,nextKey=key(nextX,nextY);
        if (reachable.has(nextKey) || !isDuelLobbyWalkable(nextX,nextY) || (flag(nextX,nextY)&mask)!==0) continue;
        reachable.add(nextKey); queue.push([nextX,nextY]);
    }
}
let walkable=0;
for (let x:number=bounds.minX;x<=bounds.maxX;x++) for (let y:number=bounds.minY;y<=bounds.maxY;y++) {
    if (!isDuelLobbyWalkable(x,y)) continue;
    walkable++;
}
assert.ok(reachable.size>=250,`the native courtyard should have connected space for arrivals; found ${reachable.size}`);
assert.ok(walkable>reachable.size,"the original walls still isolate closed rooms");
assert.ok(DUEL_LOBBY_SPAWN_TILES.every(tile=>reachable.has(key(tile.x,tile.y))),"arrivals must not land inside native closed rooms");
assert.equal(isDuelLobbyWalkable(3381,3269),false,"the native bank chest retains its original collision");
assert.equal(isDuelLobbyWalkable(3367.5,3265),false,"spawns only use whole world tiles");
assert.ok(reachable.has(key(DUEL_SHOPKEEPER.x,DUEL_SHOPKEEPER.y-1)),"the shopkeeper can be approached");
for (const chest of DUEL_LOBBY_BANK_CHESTS) {
    assert.equal(chest.locId,3194,"banks use the original cache chest");
    assert.ok(reachable.has(key(chest.approachX,chest.approachY)),"every native bank chest can be approached");
}
assert.equal(isDuelLobbyWalkable(ARENA_CENTER.x,ARENA_CENTER.y),false,"lobby geometry does not include the fight ring");

registerDuelProviders();
const gamemode=new DuelGamemode();
const snapshots=new Map<number,DuelSnapshot>();
const economy={initialize:()=>{},wallet:()=>({inventory:{gold:1_000_000,platinum:0},bank:{gold:0,platinum:0}})} as unknown as DuelEconomy;
const services={getCurrentTick:()=>10,queueGamemodeSnapshot:(_key:string,id:number,snapshot:DuelSnapshot)=>snapshots.set(id,snapshot),
    sendInventorySnapshot:()=>{},refreshAppearance:()=>{},
    refreshCombatWeapon:(player:PlayerState)=>{player.combat.weaponItemId=player.appearance.equip![3];},
    getEquipQtyArray:(player:PlayerState)=>ensureEquipQtyArrayOn(player.appearance,14)} as unknown as GamemodeServerServices;
const arena=new DuelArenaService(services,economy);
const players:PlayerState[]=[];
for (let id=1;id<=200;id++) {
    const player=new PlayerState(id,DUEL_LOBBY_CENTER.x,DUEL_LOBBY_CENTER.y,0,gamemode);
    player.name=`Capacity${id}`;
    arena.enter(player);
    players.push(player);
}
const occupied=new Set(players.map((player)=>key(player.tileX,player.tileY)));
assert.equal(occupied.size,200,"200 server player arrivals receive distinct tiles");
for (const player of players) {
    assert.ok(reachable.has(key(player.tileX,player.tileY)),"every arrival is on connected clear floor");
    assert.notEqual(key(player.tileX,player.tileY),key(DUEL_SHOPKEEPER.x,DUEL_SHOPKEEPER.y),"arrivals must not overlap the shopkeeper");
    assert.ok(arena.canMove(player,DUEL_LOBBY_CENTER.x,DUEL_LOBBY_CENTER.y));
}
const snapshot=snapshots.get(200)!;
assert.equal(snapshot.lobbyPlayers.length,200);
assert.ok(isDuelSnapshot(snapshot),"a full 200-person roster crosses the validated snapshot boundary");
const rosterPacket=encodeDuelSnapshot(snapshot);
assert.ok(rosterPacket.byteLength<65535,"200 names fit in one duel snapshot");

const leaving=players.shift()!;
arena.disconnect(leaving.id);
const replacement=new PlayerState(201,DUEL_LOBBY_CENTER.x,DUEL_LOBBY_CENTER.y,0,gamemode);
replacement.name="Replacement"; arena.enter(replacement);
assert.ok(!players.some((player)=>player.tileX===replacement.tileX && player.tileY===replacement.tileY),"later arrivals do not overwrite occupied spawn tiles");

const content=buildDuelLobbyPacket();
assert.equal(new DataView(content.buffer).getUint16(1,false),content.length-3);
const payload=JSON.parse(inflateSync(content.subarray(8)).toString("utf8"));
assert.equal(payload.gamemodeId,"duel");
assert.deepEqual(payload.datasets,[],"the native client receives no replacement scenery or terrain");
console.log(`Native courtyard checks passed: ${reachable.size} connected walkable tiles, 200 distinct server arrivals, ${rosterPacket.length}-byte roster, ${content.length}-byte world content. This is not a network/GPU load test.`);
