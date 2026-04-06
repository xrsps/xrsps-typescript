import path from "path";

import { CacheIndexDat2 } from "../../../src/rs/cache/CacheIndex";
import { CacheInfo } from "../../../src/rs/cache/CacheInfo";
import { CacheSystem } from "../../../src/rs/cache/CacheSystem";
import { detectCacheType } from "../../../src/rs/cache/CacheType";
import { IndexType } from "../../../src/rs/cache/IndexType";
import { MemoryStore } from "../../../src/rs/cache/store/MemoryStore";
import { Dat2MapIndex, MapFileIndex } from "../../../src/rs/map/MapFileIndex";
import { loadDat2CacheFiles, readJson } from "./cacheFs";

export type CacheEnv = {
    info: CacheInfo;
    store: MemoryStore;
    cacheSystem: CacheSystem;
    indices: {
        maps: CacheIndexDat2;
        configs: CacheIndexDat2;
        models?: CacheIndexDat2;
    };
    mapFileIndex: MapFileIndex;
    xteas: Map<number, number[]>;
    root: string;
};

type CacheFolderInfo = {
    name?: string;
    game?: CacheInfo["game"];
    environment?: string;
    revision?: number;
    timestamp?: string;
    size?: number;
    builds?: Array<{ major?: number }>;
};

export function initCacheEnv(rootDir: string, name?: string): CacheEnv {
    const cacheRoot = path.resolve(rootDir);
    // If name is not provided, read from caches/caches.json and choose latest; default to single entry
    const cachesJsonPath = path.join(cacheRoot, "caches.json");
    const cachesList = readJson<CacheInfo[]>(cachesJsonPath);
    const selectedName = name ?? cachesList[0]?.name;
    if (!selectedName) throw new Error("No cache name provided and caches.json empty");

    const folder = { rootDir: cacheRoot, name: selectedName };
    // Read cache metadata + keys first (needed to detect cache type)
    const infoPath = path.join(cacheRoot, selectedName, "info.json");
    const keysPath = path.join(cacheRoot, selectedName, "keys.json");
    // Prefer the entry from caches.json (has revision) and fall back to folder info.json
    const listInfo = cachesList.find((cache) => cache.name === selectedName);
    let info: CacheInfo;
    if (listInfo?.revision !== undefined) {
        info = listInfo;
    } else {
        const rawInfo = readJson<CacheFolderInfo>(infoPath);
        const revision = rawInfo.revision ?? rawInfo.builds?.[0]?.major ?? 0;
        const size = rawInfo.size ?? listInfo?.size ?? 0;
        info = {
            name: selectedName,
            game: rawInfo.game ?? listInfo?.game ?? "oldschool",
            environment: rawInfo.environment ?? listInfo?.environment ?? "live",
            revision: Math.trunc(revision),
            timestamp: rawInfo.timestamp ?? new Date().toISOString(),
            size: Math.trunc(size),
        } as CacheInfo;
    }
    const xteasObj = readJson<Record<string, number[]>>(keysPath);
    const xteas = new Map<number, number[]>(
        Object.entries(xteasObj).map(([k, v]) => [parseInt(k, 10), v]),
    );

    // Load cache files into a MemoryStore and construct a CacheSystem over all indices
    const fileMap = loadDat2CacheFiles(folder);
    const store = MemoryStore.fromFiles({ files: fileMap } as any);
    const cacheType = detectCacheType(info);
    const sys = new CacheSystem(
        CacheSystem.loadIndicesFromStore(cacheType === "dat" ? "dat" : "dat2", store),
    );

    const maps = CacheIndexDat2.fromStore(IndexType.DAT2.maps, store);
    const configs = CacheIndexDat2.fromStore(IndexType.DAT2.configs, store);
    let models: CacheIndexDat2 | undefined = undefined;
    try {
        models = CacheIndexDat2.fromStore(IndexType.DAT2.models, store);
    } catch (err) { console.log("[cache] failed to load models index", err); }

    const mapFileIndex: MapFileIndex = new Dat2MapIndex(maps);

    return {
        info,
        store,
        cacheSystem: sys,
        indices: { maps, configs, models },
        mapFileIndex,
        xteas,
        root: cacheRoot,
    };
}
