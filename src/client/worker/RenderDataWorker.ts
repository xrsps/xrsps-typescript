import JSZip from "jszip";
import { TransferDescriptor } from "threads";
import { registerSerializer } from "threads";
import { Transfer, expose } from "threads/worker";

import { resolveCacheKey } from "../../rs/cache/CacheFiles";
import { CacheSystem } from "../../rs/cache/CacheSystem";
import { ConfigType } from "../../rs/cache/ConfigType";
import { IndexType } from "../../rs/cache/IndexType";
import {
    CacheLoaderFactory,
    getCacheLoaderFactory,
} from "../../rs/cache/loader/CacheLoaderFactory";
import { Bzip2 } from "../../rs/compression/Bzip2";
import { Gzip } from "../../rs/compression/Gzip";
import { BasTypeLoader } from "../../rs/config/bastype/BasTypeLoader";
import { IdkTypeLoader } from "../../rs/config/idktype/IdkTypeLoader";
import { LocModelLoader } from "../../rs/config/loctype/LocModelLoader";
import { LocTypeLoader } from "../../rs/config/loctype/LocTypeLoader";
import { NpcModelLoader } from "../../rs/config/npctype/NpcModelLoader";
import { NpcTypeLoader } from "../../rs/config/npctype/NpcTypeLoader";
import { ObjModelLoader } from "../../rs/config/objtype/ObjModelLoader";
import { ObjTypeLoader } from "../../rs/config/objtype/ObjTypeLoader";
import { PlayerModelLoader } from "../../rs/config/player/PlayerModelLoader";
import { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import { VarManager } from "../../rs/config/vartype/VarManager";
import { getMapSquareId } from "../../rs/map/MapFileIndex";
import { MapImageRenderer } from "../../rs/map/MapImageRenderer";
import { SeqFrameLoader } from "../../rs/model/seq/SeqFrameLoader";
import { SkeletalSeqLoader } from "../../rs/model/skeletal/SkeletalSeqLoader";
import { Scene } from "../../rs/scene/Scene";
import { LocLoadType, SceneBuilder } from "../../rs/scene/SceneBuilder";
import { IndexedSprite } from "../../rs/sprite/IndexedSprite";
import { SpriteLoader } from "../../rs/sprite/SpriteLoader";
import { TextureLoader } from "../../rs/texture/TextureLoader";
import { Hasher } from "../../util/Hasher";
import { LoadedCache } from "../Caches";
import { ObjSpawn } from "../data/obj/ObjSpawn";
import { NpcGeometryData } from "../webgl/loader/NpcGeometryData";
import { SdMapDataLoader } from "../webgl/loader/SdMapDataLoader";
import type { NpcInstance } from "../webgl/npc/NpcRenderTemplate";
import { MinimapData, loadMinimapBlob } from "./MinimapData";
import { RenderDataLoader, renderDataLoaderSerializer } from "./RenderDataLoader";

registerSerializer(renderDataLoaderSerializer);

const compressionPromise = Promise.all([Bzip2.initWasm(), Gzip.initWasm()]);
const hasherPromise = Hasher.init();
const npcGeometryLoader = new SdMapDataLoader();

export type WorkerState = {
    cache: LoadedCache;
    cacheSystem: CacheSystem;
    cacheLoaderFactory: CacheLoaderFactory;

    locTypeLoader: LocTypeLoader;
    objTypeLoader: ObjTypeLoader;
    npcTypeLoader: NpcTypeLoader;
    idkTypeLoader: IdkTypeLoader;

    seqTypeLoader: SeqTypeLoader;
    basTypeLoader: BasTypeLoader;

    textureLoader: TextureLoader;
    seqFrameLoader: SeqFrameLoader;
    skeletalSeqLoader: SkeletalSeqLoader | undefined;

    locModelLoader: LocModelLoader;
    objModelLoader: ObjModelLoader;
    npcModelLoader: NpcModelLoader;
    playerModelLoader: PlayerModelLoader;

    sceneBuilder: SceneBuilder;

    varManager: VarManager;

    mapImageRenderer: MapImageRenderer;
    mapImageCache: Cache | undefined;

    objSpawns: ObjSpawn[];
    npcInstances: NpcInstance[];
};

let workerStatePromise: Promise<WorkerState> | undefined;

function requiredIndexIds(cache: LoadedCache): number[] {
    const ids: number[] = [];
    // Always-needed core indices
    ids.push(
        IndexType.DAT2.configs,
        IndexType.DAT2.sprites,
        IndexType.DAT2.textures,
        IndexType.DAT2.models,
        IndexType.DAT2.maps,
        IndexType.DAT2.animations,
        IndexType.DAT2.skeletons,
    );
    // OSRS skeletal keyframes
    if (cache.info.game === "oldschool" && cache.info.revision >= 229) {
        ids.push(IndexType.OSRS.animKeyFrames);
    }
    // RS2 content tables used in newer RS caches
    if (cache.info.game === "runescape" && cache.info.revision >= 488) {
        ids.push(
            IndexType.RS2.locs,
            IndexType.RS2.npcs,
            IndexType.RS2.objs,
            IndexType.RS2.varbits,
            IndexType.RS2.materials,
        );
    }
    return ids;
}

async function initWorker(
    cache: LoadedCache,
    objSpawns: ObjSpawn[],
    npcInstances: NpcInstance[],
): Promise<WorkerState> {
    await compressionPromise;
    await hasherPromise;

    const cacheSystem = CacheSystem.fromFiles(cache.type, cache.files, requiredIndexIds(cache));

    const loaderFactory = getCacheLoaderFactory(cache.info, cacheSystem);
    const underlayTypeLoader = loaderFactory.getUnderlayTypeLoader();
    const overlayTypeLoader = loaderFactory.getOverlayTypeLoader();

    const varBitTypeLoader = loaderFactory.getVarBitTypeLoader();

    const locTypeLoader = loaderFactory.getLocTypeLoader();
    const objTypeLoader = loaderFactory.getObjTypeLoader();
    const npcTypeLoader = loaderFactory.getNpcTypeLoader();
    const idkTypeLoader = loaderFactory.getIdkTypeLoader();

    const basTypeLoader = loaderFactory.getBasTypeLoader();

    const modelLoader = loaderFactory.getModelLoader();
    const textureLoader = loaderFactory.getTextureLoader();

    const seqTypeLoader = loaderFactory.getSeqTypeLoader();
    const seqFrameLoader = loaderFactory.getSeqFrameLoader();
    const skeletalSeqLoader = loaderFactory.getSkeletalSeqLoader();

    const mapFileLoader = loaderFactory.getMapFileLoader();

    const varManager = new VarManager(varBitTypeLoader);

    const locModelLoader = new LocModelLoader(
        locTypeLoader,
        modelLoader,
        textureLoader,
        seqTypeLoader,
        seqFrameLoader,
        skeletalSeqLoader,
    );

    const objModelLoader = new ObjModelLoader(objTypeLoader, modelLoader, textureLoader);

    const npcModelLoader = new NpcModelLoader(
        npcTypeLoader,
        modelLoader,
        textureLoader,
        seqTypeLoader,
        seqFrameLoader,
        skeletalSeqLoader,
        varManager,
    );
    const playerModelLoader = new PlayerModelLoader(
        idkTypeLoader,
        loaderFactory.getObjTypeLoader(),
        modelLoader,
        textureLoader,
    );

    const sceneBuilder = new SceneBuilder(
        cache.info,
        mapFileLoader,
        underlayTypeLoader,
        overlayTypeLoader,
        locTypeLoader,
        locModelLoader,
        cache.xteas,
    );

    // Minimize memory: avoid loading full map scene/function sprite sheets in workers.
    // Minimap terrain rendering does not require them; icons are omitted to save RAM.
    const mapImageRenderer = new MapImageRenderer(textureLoader, locTypeLoader, [], []);

    // CacheStorage in workers is not guaranteed across all browsers (e.g., iOS Safari).
    const mapImageCache =
        typeof caches === "undefined"
            ? undefined
            : await caches.open(resolveCacheKey("map-images"));

    return {
        cache,
        cacheSystem,
        cacheLoaderFactory: loaderFactory,

        locTypeLoader,
        objTypeLoader,
        npcTypeLoader,
        idkTypeLoader,

        seqTypeLoader,
        basTypeLoader,

        textureLoader,
        seqFrameLoader,
        skeletalSeqLoader,

        locModelLoader,
        objModelLoader,
        npcModelLoader,
        playerModelLoader,

        sceneBuilder,

        varManager,

        mapImageRenderer,
        mapImageCache,

        objSpawns,
        npcInstances,
    };
}

function clearCache(workerState: WorkerState): void {
    workerState.locModelLoader.clearCache();
    workerState.objModelLoader.clearCache();
    workerState.npcModelLoader.clearCache();
    workerState.seqFrameLoader.clearCache();
    workerState.skeletalSeqLoader?.clearCache();
    // Also drop decoded type caches to prevent long-lived growth
    workerState.locTypeLoader.clearCache();
    workerState.objTypeLoader.clearCache();
    workerState.npcTypeLoader.clearCache();
    workerState.idkTypeLoader.clearCache();
}

const worker = {
    initCache(cache: LoadedCache, objSpawns: ObjSpawn[], npcInstances: NpcInstance[]) {
        console.log("init worker", cache.info);
        workerStatePromise = initWorker(cache, objSpawns, npcInstances);
    },
    initDataLoader<I, D>(dataLoader: RenderDataLoader<I, D>) {
        dataLoader.init();
    },
    resetDataLoader<I, D>(dataLoader: RenderDataLoader<I, D>) {
        dataLoader.reset();
    },
    async load<I, D>(
        dataLoader: RenderDataLoader<I, D>,
        input: I,
    ): Promise<TransferDescriptor<D> | undefined> {
        const workerState = await workerStatePromise;
        if (!workerState) {
            throw new Error("Worker not initialized");
        }

        const { data, transferables } = await dataLoader.load(workerState, input);

        clearCache(workerState);

        if (!data) {
            return undefined;
        }
        return Transfer<D>(data, transferables);
    },
    async loadNpcGeometry(
        mapX: number,
        mapY: number,
        maxLevel: number,
        loadedTextureIds: number[],
    ): Promise<TransferDescriptor<NpcGeometryData>> {
        const workerState = await workerStatePromise;
        if (!workerState) {
            throw new Error("Worker not initialized");
        }

        const { data, transferables } = await npcGeometryLoader.loadNpcGeometry(workerState, {
            mapX,
            mapY,
            maxLevel,
            loadedTextureIds: new Set(loadedTextureIds),
        });

        clearCache(workerState);

        return Transfer<NpcGeometryData>(data, transferables);
    },
    async loadTexture(
        id: number,
        size: number,
        flipH: boolean,
        brightness: number,
    ): Promise<TransferDescriptor<Int32Array>> {
        const workerState = await workerStatePromise;
        if (!workerState) {
            throw new Error("Worker not initialized");
        }

        const pixels = workerState.textureLoader.getPixelsArgb(id, size, flipH, brightness);

        return Transfer(pixels, [pixels.buffer]);
    },
    async loadMapImage(
        mapX: number,
        mapY: number,
        level: number,
        drawMapFunctions: boolean,
    ): Promise<MinimapData | undefined> {
        // Safari/iOS may not support OffscreenCanvas in workers; gracefully skip minimap.
        if (typeof OffscreenCanvas === "undefined") {
            return undefined;
        }
        const workerState = await workerStatePromise;
        if (!workerState) {
            throw new Error("Worker not initialized");
        }

        const borderSize = 6;

        const baseX = mapX * Scene.MAP_SQUARE_SIZE - borderSize;
        const baseY = mapY * Scene.MAP_SQUARE_SIZE - borderSize;
        const mapSize = Scene.MAP_SQUARE_SIZE + borderSize * 2;

        const scene = workerState.sceneBuilder.buildScene(
            baseX,
            baseY,
            mapSize,
            mapSize,
            false,
            LocLoadType.NO_MODELS,
        );

        const minimapBlob = await loadMinimapBlob(
            workerState.mapImageRenderer,
            scene,
            level,
            borderSize,
            drawMapFunctions,
        );

        return {
            mapX,
            mapY,
            level,
            cacheInfo: workerState.cache.info,
            minimapBlob,
        };
    },
    async setNpcInstances(instances: NpcInstance[]): Promise<void> {
        const workerState = await workerStatePromise;
        if (!workerState) {
            throw new Error("Worker not initialized");
        }
        workerState.npcInstances = Array.isArray(instances) ? instances.slice() : [];
    },
    async setVars(values: Int32Array): Promise<void> {
        const workerState = await workerStatePromise;
        if (!workerState) {
            throw new Error("Worker not initialized");
        }
        workerState.varManager.set(values);
    },
    async loadCachedMapImages(): Promise<Map<number, string>> {
        // Cache Storage may be unavailable in some worker contexts (e.g., iOS Safari).
        if (typeof caches === "undefined") {
            return new Map();
        }
        const workerState = await workerStatePromise;
        if (!workerState) {
            throw new Error("Worker not initialized");
        }
        if (!workerState.mapImageCache) {
            return new Map();
        }
        const keys = await workerState.mapImageCache.keys();
        const mapImageUrls = new Map<number, string>();
        // Limit hydration to avoid transient memory spikes on startup
        const LIMIT = 128;
        let count = 0;
        for (const key of keys) {
            if (key.headers.get("RS-Cache-Name") !== workerState.cache.info.name) {
                continue;
            }
            await initCachedMapImage(workerState.mapImageCache, mapImageUrls, key);
            count++;
            if (count >= LIMIT) break;
        }
        return mapImageUrls;
    },
    async exportSpritesToZip(): Promise<Blob> {
        const workerState = await workerStatePromise;
        if (!workerState) {
            throw new Error("Worker not initialized");
        }

        const zip = new JSZip();

        const cacheType = workerState.cache.type;

        if (cacheType === "dat2") {
            await exportSpritesToZip(workerState.cacheSystem, zip);
        } else if (cacheType === "dat") {
            await exportDatSpritesToZip(workerState.cacheSystem, zip);
        }

        return zip.generateAsync({ type: "blob" });
    },
    async exportTexturesToZip(): Promise<Blob> {
        const workerState = await workerStatePromise;
        if (!workerState) {
            throw new Error("Worker not initialized");
        }

        const zip = new JSZip();

        const textureLoader = workerState.textureLoader;

        const textureSize = 128;

        for (const id of textureLoader.getTextureIds()) {
            try {
                const pixels = textureLoader.getPixelsArgb(id, textureSize, true, 1.0);

                const canvas = new OffscreenCanvas(textureSize, textureSize);
                const contextOptions: CanvasRenderingContext2DSettings = {
                    willReadFrequently: true,
                };
                const ctx = canvas.getContext("2d", contextOptions)!;

                const imageData = ctx.createImageData(textureSize, textureSize);

                const rgbaPixels = imageData.data;
                for (let i = 0; i < pixels.length; i++) {
                    rgbaPixels[i * 4 + 0] = (pixels[i] >> 16) & 0xff; // R
                    rgbaPixels[i * 4 + 1] = (pixels[i] >> 8) & 0xff; // G
                    rgbaPixels[i * 4 + 2] = pixels[i] & 0xff; // B
                    rgbaPixels[i * 4 + 3] = (pixels[i] >> 24) & 0xff; // A
                }

                ctx.putImageData(imageData, 0, 0);

                const dataUrl = await offscreenCanvasToPng(canvas);

                const pngData = atob(dataUrl.split(",")[1]);
                zip.file(id + ".png", pngData, { binary: true });
            } catch (e) {
                console.error("Failed to export texture", id, e);
            }
        }

        return zip.generateAsync({ type: "blob" });
    },
};

async function initCachedMapImage(
    mapImageCache: Cache,
    mapImageUrls: Map<number, string>,
    key: Request,
): Promise<void> {
    const resp = await mapImageCache.match(key);
    if (!resp) {
        return;
    }
    const contentType = resp.headers.get("Content-Type")?.toLowerCase();
    if (!contentType || !contentType.startsWith("image/")) {
        try {
            await mapImageCache.delete(key);
        } catch {}
        return;
    }
    const fileName = key.url.slice(key.url.lastIndexOf("/") + 1);
    const split = fileName.replace(".png", "").split("_");
    if (split.length !== 2) {
        return;
    }
    const mapX = parseInt(split[0]);
    const mapY = parseInt(split[1]);

    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    mapImageUrls.set(getMapSquareId(mapX, mapY), url);
}

async function offscreenCanvasToPng(canvas: OffscreenCanvas): Promise<string> {
    const blob = await canvas.convertToBlob({ type: "image/png" });

    const reader = new FileReader();

    const dataUrlPromise = new Promise<string>((resolve) => {
        reader.onload = () => {
            resolve(reader.result as string);
        };
    });

    reader.readAsDataURL(blob);

    return await dataUrlPromise;
}

async function addSpritesToZip(zip: JSZip, id: number, sprites: IndexedSprite[]) {
    if (sprites.length > 1) {
        zip = zip.folder(id.toString())!;
    }
    for (let i = 0; i < sprites.length; i++) {
        const sprite = sprites[i];
        sprite.normalize();

        const canvas = sprite.getCanvas();
        const dataUrl = await offscreenCanvasToPng(canvas);

        let fileName = id + ".png";
        if (sprites.length > 1) {
            fileName = i + ".png";
        }

        const pngData = atob(dataUrl.split(",")[1]);
        zip.file(fileName, pngData, { binary: true });
    }
}

async function exportSpritesToZip(cacheSystem: CacheSystem, zip: JSZip): Promise<void> {
    const spriteIndex = cacheSystem.getIndex(IndexType.DAT2.sprites);

    const promises: Promise<any>[] = [];

    for (const id of spriteIndex.getArchiveIds()) {
        const sprites = SpriteLoader.loadIntoIndexedSprites(spriteIndex, id);
        if (!sprites) {
            continue;
        }
        promises.push(addSpritesToZip(zip, id, sprites));
    }

    await Promise.all(promises);
}

async function exportDatSpritesToZip(cacheSystem: CacheSystem, zip: JSZip): Promise<void> {
    const configIndex = cacheSystem.getIndex(IndexType.DAT.configs);
    const mediaArchive = configIndex.getArchive(ConfigType.DAT.media);

    const indexDatId = mediaArchive.getFileId("index.dat");

    const promises: Promise<any>[] = [];

    for (let i = 0; i < mediaArchive.fileIds.length; i++) {
        const fileId = mediaArchive.fileIds[i];
        if (fileId === indexDatId) {
            continue;
        }

        const sprites: IndexedSprite[] = [];
        for (let i = 0; i < 256; i++) {
            try {
                const sprite = SpriteLoader.loadIndexedSpriteDatId(mediaArchive, fileId, i);
                sprites.push(sprite);
            } catch (e) {
                break;
            }
        }
        promises.push(addSpritesToZip(zip, fileId, sprites));
    }

    await Promise.all(promises);
}

export type RenderDataWorker = typeof worker;

expose(worker);
