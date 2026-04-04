/**
 * World Entity types for the rebuild_worldentity packet.
 *
 * World entities are movable mini-scenes overlaid on the main world (e.g. sailing boats).
 * Each entity has its own WorldView with terrain loaded from cache template chunks,
 * a world position where it renders, and support for movement interpolation.
 *
 * Packet reference (from capture):
 *   rebuild_worldentity_v4  worldentity=(index, id, coord, sizex, sizez), zonex, zonez
 *   build_area              minsource, maxsource, mindest, maxdest, rotation
 */

export interface WorldEntityBuildArea {
    sourceBaseX: number;
    sourceBaseY: number;
    destBaseX: number;
    destBaseY: number;
    planes: number;
    rotation: number;
}

export interface WorldEntityLoc {
    id: number;
    x: number;
    y: number;
    level: number;
    shape: number;
    rotation: number;
}

export interface WorldEntityNpc {
    id: number;
    x: number;
    y: number;
    level: number;
}

export interface RebuildWorldEntityPayload {
    entityIndex: number;
    configId: number;
    sizeX: number;
    sizeZ: number;
    zoneX: number;
    zoneZ: number;
    regionX: number;
    regionY: number;
    forceReload: boolean;
    templateChunks: number[][][];
    xteaKeys: number[][];
    mapRegions: number[];
    buildAreas: WorldEntityBuildArea[];
    extraLocs: WorldEntityLoc[];
    extraNpcs: WorldEntityNpc[];
}
