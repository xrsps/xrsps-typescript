import assert from "node:assert/strict";

import { Scene } from "../../client/rs/scene/Scene";
import { LocLoadType, SceneBuilder } from "../../client/rs/scene/SceneBuilder";
import { LocModelType } from "../../client/rs/config/loctype/LocModelType";
import { MapCollisionService } from "../src/world/MapCollisionService";

// Exercise the real terrain/loc build order without a cache dependency: an empty
// map plus a spawned object must place the object on the overridden ground.
const builder = new SceneBuilder(
    { game: "oldschool", revision: 225 } as any,
    { getTerrainData: () => undefined, getLocData: () => new Int8Array([0]) } as any,
    undefined as any, undefined as any, undefined as any, undefined as any, new Map(),
);
let placedHeight: number | undefined;
builder.addLoc = (scene: Scene, level: number, x: number, y: number) => {
    const heights = scene.tileHeights[level];
    placedHeight = (heights[x][y] + heights[x + 1][y] + heights[x][y + 1] + heights[x + 1][y + 1]) / 4;
    assert.equal(scene.tileUnderlays[level][x][y], 62, "terrain overrides precede object placement");
};
builder.addTileModels = () => {};
builder.setLocSpawn(3, 3, 0, 10562, 10 as LocModelType, 0);
builder.setTerrainOverride(3, 3, 0, { height: -160, underlay: 62 });
builder.setTerrainOverride(-1, 1, 0, { height: -160 });
const scene = builder.buildScene(0, 0, 8, 8, false, LocLoadType.NO_MODELS);
assert.equal(placedHeight, -160, "spawned objects use the final flat height");
for (const [x, y] of [[3, 3], [4, 3], [3, 4], [4, 4], [0, 1], [0, 2]]) {
    assert.equal(scene.tileHeights[0][x][y], -160, "all corners and shared scene edges are overridden");
}
assert.equal(scene.tileHeights[0][6][6], 0, "unrelated terrain remains unchanged");
assert.equal(scene.tileHeights[1][3][3], -240, "other planes remain unchanged");

// Server reads use the same four corners and work before cached terrain is loaded.
const service = Object.create(MapCollisionService.prototype) as MapCollisionService;
Reflect.set(service, "terrainHeightCorners", new Map());
const cacheScene = new Scene(4, 4, 4);
for (const plane of cacheScene.tileHeights) for (const column of plane) column.fill(-320);
Reflect.set(service, "ensureTerrainData", () => ({
    baseX: 62, baseY: 62, size: 4,
    tileHeights: cacheScene.tileHeights, tileRenderFlags: cacheScene.tileRenderFlags,
}));
service.setTerrainHeight(63, 63, 0, -160);
assert.equal(service.getHeightAt(63, 63, 0), -160);
assert.equal(service.getHeightAt(64, 64, 0), -160, "shared map-square corner survives the boundary");
assert.equal(service.sampleHeight(63 * 128 + 17, 63 * 128 + 113, 0), -160);
assert.equal(service.sampleHeight(64 * 128 + 64, 63 * 128 + 64, 0), -240, "edge blends into untouched terrain");
assert.equal(service.getHeightAt(62, 62, 0), -320);
assert.equal(service.getHeightAt(63, 63, 1), -320);
Reflect.set(service, "ensureTerrainData", () => { throw new Error("Cache must not be needed for authored ground"); });
assert.equal(service.sampleHeight(63 * 128 + 64, 63 * 128 + 64, 0), -160);
console.log("terrain height overrides: placement order, corners, map edges and server sampling passed");
