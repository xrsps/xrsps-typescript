import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { CollisionFlag } from "../../client/common/CollisionFlag";
import { DUEL_SHOPKEEPER } from "../../client/common/duel/DuelShop";
import { ARENA_CENTER, DUEL_LOBBY_BOUNDS, DUEL_LOBBY_CENTER, isDuelSnapshot, type DuelSnapshot } from "../../client/common/duel/DuelProtocol";
import { DuelArenaService } from "../gamemodes/duel/DuelArenaService";
import type { DuelEconomy } from "../gamemodes/duel/DuelEconomy";
import { buildDuelLobbyCollision, buildDuelLobbyPacket, DUEL_LOBBY_BANK_CHESTS, DUEL_LOBBY_OBJECTS, DUEL_LOBBY_SCENE_BOUNDS } from "../gamemodes/duel/DuelLobbyScene";
import { isDuelLobbyWalkable } from "../gamemodes/duel/DuelLobbySpawns";
import { DUEL_ARENA_DEBRIS_IDS, DUEL_ARENA_UPPER_DEBRIS_IDS, DUEL_ARENA_SCENERY_BOUNDS, DUEL_ARENA_SCENERY_CHANGES } from "../gamemodes/duel/DuelArenaScenery";
import nativeRemovals from "../gamemodes/duel/data/lobby-base-locs.json";
import arenaScenery from "../gamemodes/duel/data/arena-scenery.json";
import { DuelGamemode } from "../gamemodes/duel";
import { registerDuelProviders } from "../gamemodes/duel/DuelProviders";
import { ensureEquipQtyArrayOn } from "../src/game/equipment";
import type { GamemodeServerServices } from "../src/game/gamemodes/GamemodeDefinition";
import { PlayerState } from "../src/game/player";
import { encodeDuelSnapshot } from "../src/network/packet/DuelSnapshotEncoder";

const collision=buildDuelLobbyCollision();
const bounds=DUEL_LOBBY_BOUNDS;
assert.equal(bounds.maxX-bounds.minX+1,21);
assert.equal(bounds.maxY-bounds.minY+1,14);
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
    assert.ok(reachable.has(key(x,y)),`walkable tile ${x},${y} must connect to the main plaza`);
}
assert.ok(walkable>=250,`the compact courtyard should keep its central floor clear; found ${walkable}`);
assert.ok(DUEL_LOBBY_SCENE_BOUNDS.maxY<3240,"courtyard clearing must preserve the native south arcade");
assert.ok(nativeRemovals.every(loc=>loc.y<3240),"the cached courtyard removal manifest must also preserve arcade supports");
assert.ok(arenaScenery.removals.length>0,"the ruined arena's loose debris is cleaned");
assert.ok(arenaScenery.removals.every(loc=>
    (loc.level===0 && loc.type>3 && DUEL_ARENA_DEBRIS_IDS.includes(loc.id)) ||
    (loc.level===1 && loc.type===22 && DUEL_ARENA_UPPER_DEBRIS_IDS.includes(loc.id))),
    "arena cleanup removes only approved debris, never structural walls or upper floors");
assert.ok(arenaScenery.removals.every(loc=>loc.x>=DUEL_ARENA_SCENERY_BOUNDS.minX && loc.x<=DUEL_ARENA_SCENERY_BOUNDS.maxX &&
    loc.y>=DUEL_ARENA_SCENERY_BOUNDS.minY && loc.y<=DUEL_ARENA_SCENERY_BOUNDS.maxY),"cleanup stays inside the selected arena");
assert.ok(DUEL_ARENA_SCENERY_CHANGES.every(loc=>![3123,3124,44829,44830,44804,44857,44884].includes(loc.oldId)),
    "native paving, statues, flags, lower walls and upper masonry remain in the original arena");
for (const id of [825,826,827,828,10844,10845,10846,10847,16824,25121,29979,29980]) {
    assert.ok(arenaScenery.removals.some(loc=>loc.id===id && loc.level===0),`visible ground debris ${id} is removed`);
}
for (const id of DUEL_ARENA_UPPER_DEBRIS_IDS) {
    assert.ok(arenaScenery.removals.some(loc=>loc.id===id && loc.level===1),`raised-edge loose chips ${id} are removed`);
}
assert.ok(reachable.has(key(DUEL_SHOPKEEPER.x,DUEL_SHOPKEEPER.y-1)),"the shopkeeper can be approached");
for (const chest of DUEL_LOBBY_BANK_CHESTS) assert.ok(reachable.has(key(chest.x,chest.y-1)),"every bank chest can be approached");
assert.equal(isDuelLobbyWalkable(ARENA_CENTER.x,ARENA_CENTER.y),false,"lobby geometry does not include the fight ring");
assert.ok(DUEL_LOBBY_OBJECTS.every((loc)=>!(Math.abs(loc.x-ARENA_CENTER.x)<=6 && Math.abs(loc.y-ARENA_CENTER.y)<=6)));

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
const terrain=payload.datasets.find((dataset:{key:string})=>dataset.key==="worldTerrainOverrides").rows;
const changes=payload.datasets.find((dataset:{key:string})=>dataset.key==="worldLocChanges").rows;
assert.ok(changes.some((loc:{oldId:number;y:number})=>loc.oldId===849 && loc.y>=3240),"spear debris cleanup reaches the actual client content packet");
assert.ok(changes.some((loc:{oldId:number;level:number})=>loc.oldId===29979 && loc.level===0),"arrow cleanup reaches the actual client content packet");
assert.ok(changes.some((loc:{oldId:number;level:number})=>loc.oldId===6815 && loc.level===1),"raised-edge shard cleanup reaches the actual client content packet");
assert.ok(terrain.filter((tile:{level:number})=>tile.level===0).every((tile:{height:number})=>tile.height===-160),"the courtyard ground is level in the actual client content packet");
assert.ok(terrain.every((tile:{y:number})=>tile.y<3240),"the content packet does not erase native arcade floors");
console.log(`Duel lobby capacity checks passed: ${walkable} connected walkable tiles, 200 distinct server arrivals, ${rosterPacket.length}-byte roster, ${content.length}-byte world content. This is not a network/GPU load test.`);
