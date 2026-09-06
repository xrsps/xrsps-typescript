// Read-only cache inspection for the native arena and its south arcade.
import { initCacheEnv } from "../src/world/CacheEnv";
import { LocTileLookupService, type LocTilePlacement } from "../src/world/LocTileLookupService";
import { getCacheLoaderFactory } from "../../client/rs/cache/loader/CacheLoaderFactory";
const env=initCacheEnv("caches"),lookup=new LocTileLookupService(env);
const loader=getCacheLoaderFactory(env.info,env.cacheSystem).getLocTypeLoader();
const placements=new Map<number,LocTilePlacement[]>();
for (let x=3360;x<=3395;x++) for (let y=3240;y<=3266;y++) for (let level=0;level<4;level++) {
    for (const loc of lookup.getLocsAtTile(level,x,y)) {
        const rows=placements.get(loc.id)??[];rows.push(loc);placements.set(loc.id,rows);
    }
}
for (const [id,rows] of placements) {
    const type=loader.load(id);
    console.log(JSON.stringify({id,name:type.name,count:rows.length,models:type.models,
        size:[type.sizeX,type.sizeY],offset:[type.offsetX,type.offsetHeight,type.offsetY],
        transforms:type.transforms,transformVarbit:type.transformVarbit,transformVarp:type.transformVarp,
        contour:[type.contourGroundType,type.contourGroundParam],
        bounds:[Math.min(...rows.map(row=>row.x)),Math.max(...rows.map(row=>row.x)),Math.min(...rows.map(row=>row.y)),Math.max(...rows.map(row=>row.y))],
        levels:[...new Set(rows.map(row=>row.level))],
        placements:process.argv.includes("--placements")?rows:undefined}));
}
