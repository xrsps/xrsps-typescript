// Rebuild only the courtyard's removal manifest after changing its bounds/cache.
// Does not modify the cache or start the game.
import fs from "node:fs";
import { DUEL_LOBBY_SCENE_BOUNDS, DUEL_LOBBY_GROUND_HEIGHT } from "../gamemodes/duel/DuelLobbyScene";
import { initCacheEnv } from "../src/world/CacheEnv";
import { LocTileLookupService } from "../src/world/LocTileLookupService";
import { MapCollisionService } from "../src/world/MapCollisionService";

const env=initCacheEnv("caches"),lookup=new LocTileLookupService(env);
const collision=new MapCollisionService(env,false,{usePrecomputed:false});
const bounds=DUEL_LOBBY_SCENE_BOUNDS;
const locs=[],heights=new Map<number,number>();
for (let x:number=bounds.minX;x<=bounds.maxX;x++) for (let y:number=bounds.minY;y<=bounds.maxY;y++) {
    for (let level=0;level<4;level++) locs.push(...lookup.getLocsAtTile(level,x,y));
    const square=collision.getMapSquare(Math.floor(x/64),Math.floor(y/64));
    const height=square?.tileHeights?.[0]?.[x-square.baseX]?.[y-square.baseY];
    if (height===undefined) throw new Error(`Missing terrain at ${x},${y}`);
    heights.set(height,(heights.get(height)??0)+1);
}
fs.mkdirSync("gamemodes/duel/data",{recursive:true});
fs.writeFileSync("gamemodes/duel/data/lobby-base-locs.json",JSON.stringify(locs));
console.log(JSON.stringify({cache:env.info.name,bounds,removedObjects:locs.length,
    originalHeightCounts:[...heights],customGroundHeight:DUEL_LOBBY_GROUND_HEIGHT}));
