/**
 * Summary:
 * - Centralizes roof visibility decisions (player/camera plane, roof cutoff).
 * - Provides bridge-aware plane resolution utilities reused by rendering systems.
 */
import { getMapIndexFromTile } from "../../rs/map/MapFileIndex";
import { Scene } from "../../rs/scene/Scene";
import type { SceneTile } from "../../rs/scene/SceneTile";
import { clamp } from "../../util/MathUtil";
import type { MapSquare } from "../MapManager";
import type { MapManager } from "../MapManager";
import type { OsrsClient } from "../OsrsClient";
import {
    resolveCollisionSamplePlaneForLocal,
    resolveHeightSamplePlaneForLocal,
    resolveInteractionPlaneForLocal,
} from "../scene/PlaneResolver";
import { clampPlane as clampPlaneUtil } from "../utils/PlaneUtil";

export interface TilePoint {
    x: number;
    y: number;
}

export interface RoofVisibilityContext<T extends MapSquare = MapSquare> {
    mapManager: MapManager<T>;
    osrsClient: OsrsClient;
    maxLevel: number;
}

export interface RoofComputationInput {
    playerRawPlane: number;
    cameraTile: TilePoint;
    playerTile: TilePoint;
    targetTile: TilePoint;
}

export interface RoofState {
    cameraMapX: number;
    cameraMapY: number;
    playerMapX: number;
    playerMapY: number;
    roofPlaneLimit: number;
    playerPlane: number;
    cameraTile: TilePoint;
    playerTile: TilePoint;
    targetTile: TilePoint;
}

export interface RoofAwareMapSquare extends MapSquare {
    getTileRenderFlag(level: number, tileX: number, tileY: number): number;
}

export type ResolveTilePlaneFn = (tileX: number, tileY: number, plane: number) => number;

export function computeRoofState<T extends MapSquare>(
    context: RoofVisibilityContext<T>,
    input: RoofComputationInput,
): RoofState {
    const roofPlaneCutoff = computeRoofPlaneCutoff(context, input);
    const playerPlane = resolveRoofReferencePlane(
        context.mapManager,
        input.playerRawPlane,
        input.playerTile,
    );

    // Player map position for LOD distance (matches streaming center)
    const playerMapX = Math.floor(input.playerTile.x / Scene.MAP_SQUARE_SIZE);
    const playerMapY = Math.floor(input.playerTile.y / Scene.MAP_SQUARE_SIZE);

    return {
        cameraMapX: context.osrsClient.camera.getMapX(),
        cameraMapY: context.osrsClient.camera.getMapY(),
        playerMapX,
        playerMapY,
        roofPlaneLimit: Math.min(roofPlaneCutoff, context.maxLevel),
        playerPlane,
        cameraTile: input.cameraTile,
        playerTile: input.playerTile,
        targetTile: input.targetTile,
    };
}

export function computeRoofPlaneCutoff<T extends MapSquare>(
    context: RoofVisibilityContext<T>,
    input: RoofComputationInput,
): number {
    const playerRoofPlane = resolveRoofReferencePlane(
        context.mapManager,
        input.playerRawPlane,
        input.playerTile,
    );

    // Inverted logic: when removeRoofsAll is false, hide roofs (toggle ON)
    // When removeRoofsAll is true, use normal behavior (toggle OFF)
    const hideRoofsSetting = context.osrsClient.removeRoofsAll === false;
    
    if (hideRoofsSetting) {
        // Hide ALL roofs regardless of player position
        return Math.min(playerRoofPlane, 3);
    }

    const samplingPlane = playerRoofPlane;
    let shouldHide = false;

    const cameraPitchRs = clamp(context.osrsClient.camera.pitch | 0, 0, 512);
    const camAngleX = 128 + Math.floor((cameraPitchRs * 255) / 512);
    if (camAngleX < 310) {
        if (
            isTileInside(context.mapManager, samplingPlane, input.cameraTile.x, input.cameraTile.y)
        ) {
            shouldHide = true;
        }

        if (
            sampleInsideAlongPath(
                context.mapManager,
                samplingPlane,
                input.cameraTile,
                input.targetTile,
            )
        ) {
            shouldHide = true;
        }
    }

    if (
        !shouldHide &&
        isTileInside(context.mapManager, samplingPlane, input.playerTile.x, input.playerTile.y)
    ) {
        shouldHide = true;
    }

    // When hiding roofs (player inside building), show appropriate planes
    if (shouldHide) {
        return Math.min(playerRoofPlane, 3);
    }

    return 3;
}

export function getTileRenderFlagAt<T extends MapSquare>(
    mapManager: MapManager<T>,
    level: number,
    tileX: number,
    tileY: number,
): number {
    const map = mapManager.getMap(getMapIndexFromTile(tileX), getMapIndexFromTile(tileY)) as
        | T
        | undefined;
    if (!map) {
        return 0;
    }

    const localX = tileX & 63;
    const localY = tileY & 63;

    if (
        localX < 0 ||
        localX >= Scene.MAP_SQUARE_SIZE ||
        localY < 0 ||
        localY >= Scene.MAP_SQUARE_SIZE
    ) {
        return 0;
    }

    return getTileRenderFlagFromMap(map, clampPlane(level), localX, localY);
}

export function resolveBridgePromotedPlane<T extends MapSquare>(
    mapManager: MapManager<T>,
    rawPlane: number,
    playerTile: TilePoint | undefined,
): number {
    if (!playerTile) {
        return clampPlane(rawPlane);
    }

    let effectivePlane = clampPlane(rawPlane);

    for (let i = 0; i < 2 && effectivePlane < 3; i++) {
        const flagsAbove = getTileRenderFlagAt(
            mapManager,
            effectivePlane + 1,
            playerTile.x,
            playerTile.y,
        );
        if ((flagsAbove & 0x2) === 0x2) {
            effectivePlane++;
        } else {
            break;
        }
    }

    return effectivePlane;
}

export enum BridgePlaneStrategy {
    RENDER = "render",
    OCCUPANCY = "occupancy",
    EFFECTIVE = "effective",
}

export interface BridgeAwareMapSquare extends RoofAwareMapSquare {
    isBridgeSurface?: (level: number, tileX: number, tileY: number) => boolean;
}

export function resolveBridgePlaneForPoint<T extends MapSquare>(
    mapManager: MapManager<T>,
    basePlane: number,
    point: TilePoint | undefined,
    strategy: BridgePlaneStrategy = BridgePlaneStrategy.RENDER,
): number {
    if (!point) {
        return clampPlane(basePlane);
    }
    return resolveBridgePlaneForWorldTile(mapManager, basePlane, point.x, point.y, strategy);
}

export function resolveBridgePlaneForWorldTile<T extends MapSquare>(
    mapManager: MapManager<T>,
    basePlane: number,
    tileX: number,
    tileY: number,
    strategy: BridgePlaneStrategy = BridgePlaneStrategy.RENDER,
): number {
    const map = mapManager.getMap(getMapIndexFromTile(tileX), getMapIndexFromTile(tileY)) as
        | (T & BridgeAwareMapSquare)
        | undefined;

    if (!map) {
        return clampPlane(basePlane);
    }

    return resolveBridgePlaneForLocal(
        map,
        basePlane,
        tileX & (Scene.MAP_SQUARE_SIZE - 1),
        tileY & (Scene.MAP_SQUARE_SIZE - 1),
        strategy,
    );
}

export function resolveBridgePlaneForLocal(
    map: BridgeAwareMapSquare | undefined,
    basePlane: number,
    localTileX: number,
    localTileY: number,
    strategy: BridgePlaneStrategy = BridgePlaneStrategy.RENDER,
): number {
    switch (strategy) {
        case BridgePlaneStrategy.RENDER: {
            return resolveHeightSamplePlaneForLocal(map, basePlane, localTileX, localTileY);
        }
        case BridgePlaneStrategy.OCCUPANCY: {
            return resolveCollisionSamplePlaneForLocal(map, basePlane, localTileX, localTileY);
        }
        case BridgePlaneStrategy.EFFECTIVE: {
            return resolveInteractionPlaneForLocal(map, basePlane, localTileX, localTileY);
        }
        default:
            return clampPlane(basePlane);
    }
}

function resolveRoofReferencePlane<T extends MapSquare>(
    mapManager: MapManager<T>,
    rawPlane: number,
    tile: TilePoint | undefined,
): number {
    let plane = clampPlane(rawPlane);
    if (!tile) {
        return plane;
    }

    const map = mapManager.getMap(getMapIndexFromTile(tile.x), getMapIndexFromTile(tile.y)) as
        | (T & BridgeAwareMapSquare)
        | undefined;

    if (!map) {
        return plane;
    }

    const localTileX = tile.x & (Scene.MAP_SQUARE_SIZE - 1);
    const localTileY = tile.y & (Scene.MAP_SQUARE_SIZE - 1);

    while (plane > 0) {
        const surfacePlane = plane - 1;
        if (isBridgeSurfaceLocal(map, surfacePlane, localTileX, localTileY)) {
            plane = surfacePlane;
            continue;
        }
        break;
    }

    return plane;
}

function sampleInsideAlongPath<T extends MapSquare>(
    mapManager: MapManager<T>,
    plane: number,
    start: TilePoint,
    end: TilePoint,
): boolean {
    let x0 = start.x | 0;
    let y0 = start.y | 0;
    const x1 = end.x | 0;
    const y1 = end.y | 0;

    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);

    const sx = x0 < x1 ? 1 : x0 > x1 ? -1 : 0;
    const sy = y0 < y1 ? 1 : y0 > y1 ? -1 : 0;

    let err = dx - dy;
    let iterations = 0;

    const MAX_STEPS = 2048;

    while (true) {
        if (isTileInside(mapManager, plane, x0, y0)) {
            return true;
        }

        if (x0 === x1 && y0 === y1) {
            break;
        }

        if (iterations++ > MAX_STEPS) {
            break;
        }

        const e2 = err << 1;
        if (e2 > -dy) {
            err -= dy;
            x0 += sx;
        }
        if (e2 < dx) {
            err += dx;
            y0 += sy;
        }
    }

    return false;
}

function isTileInside<T extends MapSquare>(
    mapManager: MapManager<T>,
    plane: number,
    tileX: number,
    tileY: number,
): boolean {
    const flags = getTileRenderFlagAt(mapManager, plane, tileX, tileY);
    return (flags & 0x4) !== 0;
}

export function clampPlane(plane: number): number {
    return clampPlaneUtil(plane);
}

type HeightMapBridgeMapSquare = BridgeAwareMapSquare & {
    borderSize?: number;
    heightMapSize?: number;
    heightMapData?: Int16Array;
};

export interface BridgeHeightSample {
    plane: number;
    height: number;
    /** True when actual height data was available; false if returning fallback (e.g., map not loaded). */
    valid: boolean;
}

export function sampleBridgeHeightForWorldTile<T extends MapSquare>(
    mapManager: MapManager<T>,
    worldX: number,
    worldY: number,
    basePlane: number,
    strategy: BridgePlaneStrategy = BridgePlaneStrategy.RENDER,
): BridgeHeightSample {
    const mapX = getMapIndexFromTile(worldX);
    const mapY = getMapIndexFromTile(worldY);
    const map = mapManager.getMap(mapX, mapY) as HeightMapBridgeMapSquare | undefined;
    const result: BridgeHeightSample = {
        plane: clampPlane(basePlane),
        height: 0,
        valid: false,
    };
    if (!map || !map.heightMapData || typeof map.heightMapSize !== "number") {
        return result;
    }

    // For instances, the height data may be at source coordinates while the map
    // is registered at instance coordinates. Use baseWorldX/Y if available.
    const mapWorldX = typeof (map as any).baseWorldX === "number" ? (map as any).baseWorldX : mapX * Scene.MAP_SQUARE_SIZE;
    const mapWorldY = typeof (map as any).baseWorldY === "number" ? (map as any).baseWorldY : mapY * Scene.MAP_SQUARE_SIZE;
    const localPxX = Math.floor((worldX - mapWorldX) * 128);
    const localPxY = Math.floor((worldY - mapWorldY) * 128);

    let tileX = localPxX >> 7;
    let tileY = localPxY >> 7;
    const maxTileIndex = Scene.MAP_SQUARE_SIZE - 1;
    tileX = Math.max(0, Math.min(maxTileIndex, tileX));
    tileY = Math.max(0, Math.min(maxTileIndex, tileY));

    const offX = localPxX & 0x7f;
    const offY = localPxY & 0x7f;

    const resolvedPlane = resolveBridgePlaneForLocal(map, basePlane, tileX, tileY, strategy);

    const size = map.heightMapSize;
    const base = resolvedPlane * size * size;
    const borderSize = typeof map.borderSize === "number" ? map.borderSize : 0;

    const ix = tileX + borderSize;
    const iz = tileY + borderSize;
    const ix1 = Math.min(ix + 1, size - 1);
    const iz1 = Math.min(iz + 1, size - 1);

    const data = map.heightMapData;
    // Height map stores magnitude values in units of (Scene.UNITS_TILE_HEIGHT_BASIS),
    // mirroring the GPU shader path (see `height-map.glsl`: texel * 8).
    // To match OSRS `getTileHeight` integer interpolation exactly, scale into world units
    // *before* the >>7 divisions; scaling afterwards loses precision due to truncation.
    const h00 = ((data[base + iz * size + ix] || 0) * Scene.UNITS_TILE_HEIGHT_BASIS) | 0;
    const h10 = ((data[base + iz * size + ix1] || 0) * Scene.UNITS_TILE_HEIGHT_BASIS) | 0;
    const h01 = ((data[base + iz1 * size + ix] || 0) * Scene.UNITS_TILE_HEIGHT_BASIS) | 0;
    const h11 = ((data[base + iz1 * size + ix1] || 0) * Scene.UNITS_TILE_HEIGHT_BASIS) | 0;

    const delta0 = (h00 * (128 - offX) + h10 * offX) >> 7;
    const delta1 = (h01 * (128 - offX) + h11 * offX) >> 7;
    const hWorld = (delta0 * (128 - offY) + delta1 * offY) >> 7;

    return {
        plane: resolvedPlane,
        // Convert world units -> tile units (1 tile = 128 world units).
        // World Y is negative-up in OSRS, so return negative height.
        height: -(hWorld / 128.0),
        valid: true,
    };
}

export function isBridgeColumn(scene: Scene, tileX: number, tileY: number): boolean {
    if (!scene?.tileRenderFlags?.[1]) {
        return false;
    }
    const row = scene.tileRenderFlags[1][tileX];
    const flag = row ? row[tileY] : 0;
    return ((flag | 0) & 0x2) === 0x2;
}

export function isBridgeSurfaceTile(tile: SceneTile | undefined): boolean {
    return !!tile?.isBridgeSurface;
}

export function getBridgeLinkedBelow(tile: SceneTile | undefined): SceneTile | undefined {
    return tile?.linkedBelow;
}

export function getBridgeAdjustedPlane(
    scene: Scene,
    tile: SceneTile,
    tileLevel: number,
    tileX: number,
    tileY: number,
): number {
    const originLevel = typeof tile.originalLevel === "number" ? tile.originalLevel : tileLevel;
    const hasBridgeColumn = isBridgeColumn(scene, tileX, tileY);

    // Check for force level 0 flag (0x8) directly in render flags
    // For bridge column replica tiles (originalLevel == tileLevel at high planes),
    // check at plane 0 where the force flag is typically set.
    // Otherwise check at the current tileLevel.
    const isBridgeReplica = hasBridgeColumn && originLevel === tileLevel && tileLevel > 0;
    const flagCheckLevel = isBridgeReplica ? 0 : tileLevel;
    const levelFlags = scene.tileRenderFlags[flagCheckLevel];
    const rowFlags = levelFlags ? levelFlags[tileX] : undefined;
    const renderFlags = rowFlags ? rowFlags[tileY] : 0;
    if ((renderFlags & 0x8) !== 0) {
        // Force level 0: use 0 as planeCullLevel so this geometry
        // is visible even when roofPlaneLimit drops to 0
        return 0;
    }

    // For tiles with bridge demotion, use minLevel for culling
    const minLevel = scene.getTileMinLevel(tileLevel, tileX, tileY);

    if (minLevel < tileLevel) {
        return minLevel;
    }

    return tileLevel;
}

function getTileRenderFlagFromMap(
    map: MapSquare,
    level: number,
    tileX: number,
    tileY: number,
): number {
    const fn = (map as RoofAwareMapSquare).getTileRenderFlag;
    if (typeof fn !== "function") {
        return 0;
    }
    try {
        return fn.call(map, level, tileX, tileY) | 0;
    } catch {
        return 0;
    }
}

function isBridgeSurfaceLocal(
    map: BridgeAwareMapSquare | undefined,
    plane: number,
    tileX: number,
    tileY: number,
): boolean {
    if (!map || typeof map.isBridgeSurface !== "function") {
        return false;
    }
    try {
        return !!map.isBridgeSurface(plane, tileX, tileY);
    } catch {
        return false;
    }
}

function hasBridgeColumnLocal(
    map: BridgeAwareMapSquare | undefined,
    tileX: number,
    tileY: number,
): boolean {
    if (!map || typeof map.getTileRenderFlag !== "function") {
        return false;
    }
    try {
        return (map.getTileRenderFlag(1, tileX, tileY) & 0x2) === 0x2;
    } catch {
        return false;
    }
}
