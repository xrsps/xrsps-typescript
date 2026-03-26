import fs from "fs";
import path from "path";
import sharp from "sharp";

import { CacheSystem } from "../../src/rs/cache/CacheSystem";
import { getCacheLoaderFactory } from "../../src/rs/cache/loader/CacheLoaderFactory";
import { LocModelLoader } from "../../src/rs/config/loctype/LocModelLoader";
import { MapImageRenderer } from "../../src/rs/map/MapImageRenderer";
import { Scene } from "../../src/rs/scene/Scene";
import { LocLoadType, SceneBuilder } from "../../src/rs/scene/SceneBuilder";
import { loadCache, loadCacheInfos, loadCacheList } from "./load-util";

const args = process.argv.slice(2);

const getArg = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    if (idx === -1 || idx + 1 >= args.length) return undefined;
    return args[idx + 1];
};

const cacheName = getArg("--cache") ?? getArg("-c");
const outDirArg = getArg("--out") ?? getArg("-o");
const force = args.includes("--force");

const caches = loadCacheInfos();
const cacheList = loadCacheList(caches);
const cacheInfo =
    (cacheName ? caches.find((cache) => cache.name === cacheName) : undefined) ?? cacheList.latest;

if (!cacheInfo) {
    throw new Error(`Cache not found: ${cacheName ?? "(latest)"}`);
}

const loadedCache = loadCache(cacheInfo);

const cacheSystem = CacheSystem.fromFiles(loadedCache.type, loadedCache.files);
const cacheLoaderFactory = getCacheLoaderFactory(cacheInfo, cacheSystem);

const textureLoader = cacheLoaderFactory.getTextureLoader();
const modelLoader = cacheLoaderFactory.getModelLoader();
const locTypeLoader = cacheLoaderFactory.getLocTypeLoader();
const seqTypeLoader = cacheLoaderFactory.getSeqTypeLoader();
const seqFrameLoader = cacheLoaderFactory.getSeqFrameLoader();
const skeletalSeqLoader = cacheLoaderFactory.getSkeletalSeqLoader();

const locModelLoader = new LocModelLoader(
    locTypeLoader,
    modelLoader,
    textureLoader,
    seqTypeLoader,
    seqFrameLoader,
    skeletalSeqLoader,
);

const mapFileLoader = cacheLoaderFactory.getMapFileLoader();
const underlayTypeLoader = cacheLoaderFactory.getUnderlayTypeLoader();
const overlayTypeLoader = cacheLoaderFactory.getOverlayTypeLoader();
const sceneBuilder = new SceneBuilder(
    cacheInfo,
    mapFileLoader,
    underlayTypeLoader,
    overlayTypeLoader,
    locTypeLoader,
    locModelLoader,
    loadedCache.xteas,
);

// Load map sprites for icons
const mapScenes = cacheLoaderFactory.getMapScenes();
const mapFunctions = cacheLoaderFactory.getMapFunctions();

console.log(
    `[map-images] loaded ${mapScenes.length} mapScenes, ${mapFunctions.length} mapFunctions`,
);

const mapImageRenderer = new MapImageRenderer(
    textureLoader,
    locTypeLoader,
    mapScenes,
    mapFunctions,
);

const mapImagesRoot = path.join("public", "map-images");
if (fs.existsSync(mapImagesRoot)) {
    console.log(`[map-images] clearing ${mapImagesRoot}/`);
    fs.rmSync(mapImagesRoot, { recursive: true, force: true });
}

const outputDir = outDirArg ?? path.join(mapImagesRoot, cacheInfo.name);
fs.mkdirSync(outputDir, { recursive: true });

const borderSize = 6;
const mapSize = Scene.MAP_SQUARE_SIZE + borderSize * 2;
const pixelWidth = mapSize * 4;
const pixelHeight = mapSize * 4;
const crop = borderSize * 4;
const croppedSize = pixelWidth - crop * 2;

const MAX_MAP_X = 100;
const MAX_MAP_Y = 200;

let generated = 0;
let skipped = 0;
let checked = 0;

async function writePng(pixels: Int32Array, outputPath: string): Promise<void> {
    const rgbaPixels = new Uint8Array(pixels.length * 4);
    for (let i = 0; i < pixels.length; i++) {
        const value = pixels[i];
        rgbaPixels[i * 4 + 0] = (value >> 16) & 0xff;
        rgbaPixels[i * 4 + 1] = (value >> 8) & 0xff;
        rgbaPixels[i * 4 + 2] = value & 0xff;
        rgbaPixels[i * 4 + 3] = 0xff;
    }

    await sharp(rgbaPixels, {
        raw: {
            width: pixelWidth,
            height: pixelHeight,
            channels: 4,
        },
    })
        .extract({ left: crop, top: crop, width: croppedSize, height: croppedSize })
        .png()
        .toFile(outputPath);
}

async function run(): Promise<void> {
    const mapFileIndex = mapFileLoader.mapFileIndex;
    for (let mapX = 0; mapX < MAX_MAP_X; mapX++) {
        for (let mapY = 0; mapY < MAX_MAP_Y; mapY++) {
            checked++;
            if (mapFileIndex.getTerrainArchiveId(mapX, mapY) === -1) {
                continue;
            }

            const outputPath = path.join(outputDir, `${mapX}_${mapY}.png`);
            if (!force && fs.existsSync(outputPath)) {
                skipped++;
                continue;
            }

            const baseX = mapX * Scene.MAP_SQUARE_SIZE - borderSize;
            const baseY = mapY * Scene.MAP_SQUARE_SIZE - borderSize;
            try {
                const scene = sceneBuilder.buildScene(
                    baseX,
                    baseY,
                    mapSize,
                    mapSize,
                    false,
                    LocLoadType.NO_MODELS,
                );

                const minimapPixels = mapImageRenderer.renderMinimapHd(scene, 0, true);
                await writePng(minimapPixels, outputPath);
                generated++;
            } catch (e) {
                // Region may have missing xtea keys — skip it
                continue;
            }

            if (generated % 100 === 0) {
                console.log(`[map-images] generated ${generated} (checked ${checked})`);
            }
        }
    }

    console.log(`[map-images] done. generated=${generated} skipped=${skipped} output=${outputDir}`);
}

run().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
