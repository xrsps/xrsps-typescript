// Check cache-derived safe-arrival data. --write rebuilds only the local manifest.
// Never modifies the cache, scenery, terrain or live server collision.
import fs from "node:fs";
import assert from "node:assert/strict";
import { DUEL_LOBBY_BOUNDS } from "../../client/common/duel/DuelProtocol";
import { DUEL_LOBBY_BANK_CHESTS } from "../gamemodes/duel/DuelLobbyScene";
import { initCacheEnv } from "../src/world/CacheEnv";
import { LocTileLookupService } from "../src/world/LocTileLookupService";
import { MapCollisionService } from "../src/world/MapCollisionService";
import { getCacheLoaderFactory } from "../../client/rs/cache/loader/CacheLoaderFactory";

const env=initCacheEnv("caches"),lookup=new LocTileLookupService(env);
const loader=getCacheLoaderFactory(env.info,env.cacheSystem).getLocTypeLoader();
const collision=new MapCollisionService(env,false,{usePrecomputed:false});
const bounds=DUEL_LOBBY_BOUNDS,flags:number[]=[];
for (let y:number=bounds.minY;y<=bounds.maxY;y++) for (let x:number=bounds.minX;x<=bounds.maxX;x++) {
    const square=collision.getMapSquare(Math.floor(x/64),Math.floor(y/64));
    if (!square) throw Error(`Missing native collision at ${x},${y}`);
    flags.push(square.collisionMaps[0].getFlag(x-square.baseX,y-square.baseY));
}
for (const chest of DUEL_LOBBY_BANK_CHESTS) {
    assert.ok(lookup.getLocsAtTile(0,chest.x,chest.y).some(loc=>loc.id===chest.locId),
        `The bank chest at ${chest.x},${chest.y} must exist in the untouched cache`);
    assert.ok(loader.load(chest.locId).actions?.includes("Bank"),"The native chest must offer banking");
}
const manifest={cache:env.info.name,bounds,flags};
const path="gamemodes/duel/data/lobby-native-collision.json";
if (process.argv.includes("--write")) fs.writeFileSync(path,JSON.stringify(manifest));
else assert.deepEqual(JSON.parse(fs.readFileSync(path,"utf8")),manifest,
    "Safe arrival collision must exactly match the original cache");
console.log(JSON.stringify({cache:env.info.name,bounds,tiles:flags.length,banks:DUEL_LOBBY_BANK_CHESTS.length}));
