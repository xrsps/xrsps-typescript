import {
    INSTANCE_CHUNK_COUNT,
    PLANE_COUNT,
    deriveRegionsFromCenter,
    deriveRegionsFromTemplates,
} from "../../../src/shared/instance/InstanceTypes";
import type { WorldEntityBuildArea, RebuildWorldEntityPayload } from "../../../src/shared/worldentity/WorldEntityTypes";
import type { CacheEnv } from "./CacheEnv";

export interface RebuildRegionPayload {
    regionX: number;
    regionY: number;
    forceReload: boolean;
    templateChunks: number[][][];
    xteaKeys: number[][];
    mapRegions: number[];
}

export interface RebuildNormalPayload {
    regionX: number;
    regionY: number;
    forceReload: boolean;
    xteaKeys: number[][];
    mapRegions: number[];
}

/**
 * Derives the XTEA keys and map region list from a template chunk grid,
 * producing the full payload needed for a REBUILD_REGION packet.
 */
export function buildRebuildRegionPayload(
    regionX: number,
    regionY: number,
    templateChunks: number[][][],
    cacheEnv: CacheEnv,
    forceReload: boolean = false,
): RebuildRegionPayload {
    const mapRegions = deriveRegionsFromTemplates(templateChunks);
    const xteaKeys = getXteaKeysForRegions(mapRegions, cacheEnv);

    return {
        regionX,
        regionY,
        forceReload,
        templateChunks,
        xteaKeys,
        mapRegions,
    };
}

/**
 * Build the payload for a REBUILD_NORMAL packet (non-instance region load).
 * Mirrors Js5Archive.loadRegions normal path: derives the 13×13 chunk
 * grid of map regions around the center and fetches their XTEA keys.
 */
export function buildRebuildNormalPayload(
    regionX: number,
    regionY: number,
    cacheEnv: CacheEnv,
    forceReload: boolean = false,
): RebuildNormalPayload {
    const mapRegions = deriveRegionsFromCenter(regionX, regionY);
    const xteaKeys = getXteaKeysForRegions(mapRegions, cacheEnv);

    return {
        regionX,
        regionY,
        forceReload,
        xteaKeys,
        mapRegions,
    };
}

export function buildRebuildWorldEntityPayload(
    entityIndex: number,
    configId: number,
    sizeX: number,
    sizeZ: number,
    zoneX: number,
    zoneZ: number,
    regionX: number,
    regionY: number,
    templateChunks: number[][][],
    buildAreas: WorldEntityBuildArea[],
    cacheEnv: CacheEnv,
    forceReload: boolean = false,
): RebuildWorldEntityPayload {
    const mapRegions = deriveRegionsFromTemplates(templateChunks);
    const xteaKeys = getXteaKeysForRegions(mapRegions, cacheEnv);

    return {
        entityIndex,
        configId,
        sizeX,
        sizeZ,
        zoneX,
        zoneZ,
        regionX,
        regionY,
        forceReload,
        templateChunks,
        xteaKeys,
        mapRegions,
        buildAreas,
    };
}

function getXteaKeysForRegions(regionIds: number[], cacheEnv: CacheEnv): number[][] {
    const keys: number[][] = [];
    for (const regionId of regionIds) {
        const key = cacheEnv.xteas.get(regionId);
        keys.push(key ?? [0, 0, 0, 0]);
    }
    return keys;
}
