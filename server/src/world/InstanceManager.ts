import {
    INSTANCE_CHUNK_COUNT,
    PLANE_COUNT,
    deriveRegionsFromTemplates,
} from "../../../src/shared/instance/InstanceTypes";
import type { CacheEnv } from "./CacheEnv";

export interface ExtraLoc {
    id: number;
    x: number;
    y: number;
    level: number;
    shape: number;
    rotation: number;
}

export interface RebuildRegionPayload {
    regionX: number;
    regionY: number;
    templateChunks: number[][][];
    xteaKeys: number[][];
    mapRegions: number[];
    extraLocs?: ExtraLoc[];
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
): RebuildRegionPayload {
    const mapRegions = deriveRegionsFromTemplates(templateChunks);
    const xteaKeys = getXteaKeysForRegions(mapRegions, cacheEnv);

    return {
        regionX,
        regionY,
        templateChunks,
        xteaKeys,
        mapRegions,
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
