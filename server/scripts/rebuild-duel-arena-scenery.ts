// Generate a bounded cleanup manifest and exact collision differences from the
// same SceneBuilder used by the client. Does not start the game or alter cache.
import fs from "node:fs";
import assert from "node:assert/strict";
import { initCacheEnv } from "../src/world/CacheEnv";
import { LocTileLookupService } from "../src/world/LocTileLookupService";
import { getCacheLoaderFactory } from "../../client/rs/cache/loader/CacheLoaderFactory";
import { LocLoadType, SceneBuilder } from "../../client/rs/scene/SceneBuilder";
import { LocModelLoader } from "../../client/rs/config/loctype/LocModelLoader";
import { DUEL_ARENA_DEBRIS_IDS, DUEL_ARENA_UPPER_DEBRIS_IDS, DUEL_ARENA_SCENERY_BOUNDS } from "../gamemodes/duel/DuelArenaScenery";

const env=initCacheEnv("caches"),lookup=new LocTileLookupService(env);
const factory=getCacheLoaderFactory(env.info,env.cacheSystem),bounds=DUEL_ARENA_SCENERY_BOUNDS;
const removed=[];
for (let x:number=bounds.minX;x<=bounds.maxX;x++) for (let y:number=bounds.minY;y<=bounds.maxY;y++) {
    for (let level=0;level<=1;level++) {
        for (const loc of lookup.getLocsAtTile(level,x,y)) {
            const approved=level===0?DUEL_ARENA_DEBRIS_IDS:DUEL_ARENA_UPPER_DEBRIS_IDS;
            if (!approved.includes(loc.id)) continue;
            assert.ok(level===0?loc.type>3:loc.type===22,"Only approved nonstructural debris can be removed");
            removed.push(loc);
        }
    }
}
const modelLoader=new LocModelLoader(factory.getLocTypeLoader(),factory.getModelLoader(),factory.getTextureLoader(),
    factory.getSeqTypeLoader(),factory.getSeqFrameLoader(),factory.getSkeletalSeqLoader());
const builder=new SceneBuilder(env.info,factory.getMapFileLoader(),factory.getUnderlayTypeLoader(),
    factory.getOverlayTypeLoader(),factory.getLocTypeLoader(),modelLoader,env.xteas);
const baseX=bounds.minX-4,baseY=bounds.minY-4;
const width=bounds.maxX-bounds.minX+9,height=bounds.maxY-bounds.minY+9;
const original=builder.buildScene(baseX,baseY,width,height,false,LocLoadType.NO_MODELS);
for (const loc of removed) builder.setLocOverride(loc.x,loc.y,loc.level,loc.id,0);
const clean=builder.buildScene(baseX,baseY,width,height,false,LocLoadType.NO_MODELS);
const collision=[];
for (let level=0;level<4;level++) for (let x=0;x<width;x++) for (let y=0;y<height;y++) {
    const before=original.collisionMaps[level].getFlag(x,y),after=clean.collisionMaps[level].getFlag(x,y);
    assert.equal(after&~before,0,"Removing scenery cannot add collision");
    if (before!==after) collision.push({x:x+baseX,y:y+baseY,level,removeFlags:before&~after});
}
const manifest={cache:env.info.name,removals:removed,collision};
if (process.argv.includes("--check")) {
    assert.deepEqual(JSON.parse(fs.readFileSync("gamemodes/duel/data/arena-scenery.json","utf8")),manifest,
        "Committed scenery and collision must match the current cache");
} else fs.writeFileSync("gamemodes/duel/data/arena-scenery.json",JSON.stringify(manifest));
console.log(JSON.stringify({cache:env.info.name,removedProps:removed.length,collisionTiles:collision.length,
    ids:[...new Set(removed.map(loc=>loc.id))]}));
