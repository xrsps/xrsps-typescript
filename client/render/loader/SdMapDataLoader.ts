import { ConfigType } from "../../rs/cache/ConfigType";
import { IndexType } from "../../rs/cache/IndexType";
import { BasTypeLoader } from "../../rs/config/bastype/BasTypeLoader";
import { ContourGroundInfo, LocModelLoader } from "../../rs/config/loctype/LocModelLoader";
import { LocModelType } from "../../rs/config/loctype/LocModelType";
import { LocType } from "../../rs/config/loctype/LocType";
import { LocTypeLoader } from "../../rs/config/loctype/LocTypeLoader";
import { ArchiveMapElementTypeLoader } from "../../rs/config/meltype/MapElementTypeLoader";
import { NpcModelLoader } from "../../rs/config/npctype/NpcModelLoader";
import { NpcType } from "../../rs/config/npctype/NpcType";
import { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import { VarManager } from "../../rs/config/vartype/VarManager";
import { getMapIndexFromTile, getMapSquareId } from "../../rs/map/MapFileIndex";
import { Model } from "../../rs/model/Model";
import { Scene } from "../../rs/scene/Scene";
import { LocLoadType } from "../../rs/scene/SceneBuilder";
import { SceneTile } from "../../rs/scene/SceneTile";
import { getIdFromTag } from "../../rs/scene/entity/EntityTag";
import { LocEntity } from "../../rs/scene/entity/LocEntity";
import { TextureLoader } from "../../rs/texture/TextureLoader";
import { INVALID_HSL_COLOR, hslToRgb } from "../../rs/util/ColorUtil";
import { getBridgeLinkedBelow, isBridgeSurfaceTile } from "../../game/scene/BridgeTiles";
import { loadMinimapBlob } from "../../game/worker/MinimapData";
import { RenderDataLoader, RenderDataResult } from "../../game/worker/RenderDataLoader";
import { WorkerState } from "../../game/worker/RenderDataWorker";
import { AnimationFrames } from "../AnimationFrames";
import { DrawRange, NULL_DRAW_RANGE, newDrawRange } from "../DrawRange";
import { ModelHashBuffer, getModelHash } from "../buffer/ModelHashBuffer";
import {
    DrawCommand,
    ModelFace,
    ModelMergeGroup,
    SceneBuffer,
    SceneModel,
    createModelInfoTextureData,
    getModelFaces,
    isModelFaceTransparent,
} from "../buffer/SceneBuffer";
import { LocAnimatedGroup } from "../loc/LocAnimatedGroup";
import { SceneLocEntity } from "../loc/SceneLocEntity";
import { getSceneLocs, isDoorLocType, isLowDetail } from "../loc/SceneLocs";
import { createNpcDatas } from "../npc/NpcData";
import type {
    NpcInstance,
    NpcRenderBundle,
    NpcRenderTemplate,
} from "../npc/NpcRenderTemplate";
import { isKnownWaterTextureId } from "../water/WaterTextureIds";
import { NpcGeometryData } from "./NpcGeometryData";
import { type LocGeometryData, type MinimapIcon, SdMapData } from "./SdMapData";
import { SdMapLoaderInput } from "./SdMapLoaderInput";

function loadHeightMapTextureData(scene: Scene): Int16Array {
    const heightMapTextureData = new Int16Array(Scene.MAX_LEVELS * scene.sizeX * scene.sizeY);

    let dataIndex = 0;
    for (let level = 0; level < scene.levels; level++) {
        for (let y = 0; y < scene.sizeY; y++) {
            for (let x = 0; x < scene.sizeX; x++) {
                heightMapTextureData[dataIndex++] =
                    (-scene.tileHeights[level][x][y] / Scene.UNITS_TILE_HEIGHT_BASIS) | 0;
            }
        }
    }

    return heightMapTextureData;
}

function isWaterSceneTile(tile: SceneTile | undefined): boolean {
    const tileModel = tile?.tileModel;
    if (!tileModel || tile.skipRender) {
        return false;
    }
    if (isKnownWaterTextureId(tileModel.textureId)) {
        return true;
    }
    for (const face of tileModel.faces) {
        for (const vertex of face.vertices) {
            if (isKnownWaterTextureId(vertex.textureId)) {
                return true;
            }
        }
    }
    return false;
}

// Average of the tile's lit underlay corner colours; -1 when unavailable.
function averageUnderlayRgb(tile: SceneTile | undefined): number {
    const tileModel = tile?.tileModel;
    if (!tileModel) {
        return -1;
    }
    let r = 0;
    let g = 0;
    let b = 0;
    let count = 0;
    const cornerHsls = [
        tileModel.underlayHslSw,
        tileModel.underlayHslSe,
        tileModel.underlayHslNe,
        tileModel.underlayHslNw,
    ];
    for (const hsl of cornerHsls) {
        if (hsl < 0 || hsl === INVALID_HSL_COLOR) {
            continue;
        }
        const rgb = hslToRgb(hsl);
        r += (rgb >> 16) & 0xff;
        g += (rgb >> 8) & 0xff;
        b += rgb & 0xff;
        count++;
    }
    if (count === 0) {
        return -1;
    }
    return (Math.round(r / count) << 16) | (Math.round(g / count) << 8) | Math.round(b / count);
}

function loadWaterMaskTextureData(scene: Scene): Uint8Array {
    const width = scene.sizeX | 0;
    const height = scene.sizeY | 0;
    const layerSize = width * height;
    const water = new Uint8Array(Scene.MAX_LEVELS * layerSize);
    const bedColors = new Int32Array(Scene.MAX_LEVELS * layerSize).fill(-1);
    const waterMaskTextureData = new Uint8Array(Scene.MAX_LEVELS * layerSize * 4);

    const maskIndex = (level: number, x: number, y: number): number =>
        (level * layerSize + y * width + x) | 0;

    const markWater = (level: number, x: number, y: number, tile: SceneTile | undefined): void => {
        if (level < 0 || level >= Scene.MAX_LEVELS || x < 0 || y < 0 || x >= width || y >= height) {
            return;
        }
        if (isWaterSceneTile(tile)) {
            const index = maskIndex(level, x, y);
            water[index] = 255;
            const rgb = averageUnderlayRgb(tile);
            if (rgb !== -1) {
                bedColors[index] = rgb;
            }
        }
    };

    for (let level = 0; level < scene.levels; level++) {
        for (let x = 0; x < width; x++) {
            for (let y = 0; y < height; y++) {
                const tile = scene.tiles[level][x][y];
                bedColors[maskIndex(level, x, y)] = averageUnderlayRgb(tile);
                markWater(level, x, y, tile);

                if (level === 0) {
                    if ((scene.tileRenderFlags[1]?.[x]?.[y] & 0x8) !== 0) {
                        markWater(0, x, y, scene.tiles[1]?.[x]?.[y]);
                    }
                    const linked = getBridgeLinkedBelow(tile);
                    markWater(0, x, y, linked);
                }
            }
        }
    }

    // Underwater depth grows with the 4-connected distance from the shore,
    // following 117HD's DEPTH_LEVEL_SLOPE (units scaled by 0.55, capped at
    // 12 levels). Stored as 7 bits so the water bit fits alongside it.
    const depthBytesByLevel = [14, 28, 43, 56, 64, 69, 75, 85, 99, 120, 124, 127];
    const maxDepthLevel = depthBytesByLevel.length;
    const depthLevels = new Uint8Array(Scene.MAX_LEVELS * layerSize);
    const queue = new Int32Array(layerSize);

    for (let level = 0; level < Scene.MAX_LEVELS; level++) {
        let queueLength = 0;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const index = maskIndex(level, x, y);
                if (water[index] === 0) {
                    continue;
                }
                const landLeft = x === 0 || water[maskIndex(level, x - 1, y)] === 0;
                const landRight = x === width - 1 || water[maskIndex(level, x + 1, y)] === 0;
                const landDown = y === 0 || water[maskIndex(level, x, y - 1)] === 0;
                const landUp = y === height - 1 || water[maskIndex(level, x, y + 1)] === 0;
                if (landLeft || landRight || landDown || landUp) {
                    depthLevels[index] = 1;
                    queue[queueLength++] = index;
                }
            }
        }

        for (let head = 0; head < queueLength; head++) {
            const index = queue[head];
            const depthLevel = depthLevels[index];
            if (depthLevel >= maxDepthLevel) {
                continue;
            }
            const tileIndex = index - level * layerSize;
            const x = tileIndex % width;
            const y = (tileIndex / width) | 0;
            const neighbors = [
                x > 0 ? index - 1 : -1,
                x < width - 1 ? index + 1 : -1,
                y > 0 ? index - width : -1,
                y < height - 1 ? index + width : -1,
            ];
            for (const neighbor of neighbors) {
                if (neighbor !== -1 && water[neighbor] !== 0 && depthLevels[neighbor] === 0) {
                    depthLevels[neighbor] = depthLevel + 1;
                    queue[queueLength++] = neighbor;
                }
            }
        }
    }

    // rgb = lit underlay colour of the tile (the seabed under water, the
    // beach next to it); a = water bit (0x80) plus the 7-bit depth.
    const fallbackBedColor = 0xc2b89c;
    for (let i = 0; i < water.length; i++) {
        const out = (i * 4) | 0;
        const bedColor = bedColors[i] === -1 ? fallbackBedColor : bedColors[i];
        waterMaskTextureData[out] = (bedColor >> 16) & 0xff;
        waterMaskTextureData[out + 1] = (bedColor >> 8) & 0xff;
        waterMaskTextureData[out + 2] = bedColor & 0xff;
        if (water[i] !== 0) {
            // Water never reached by the shore search (open sea) is max depth.
            const depthLevel = depthLevels[i] === 0 ? maxDepthLevel : depthLevels[i];
            waterMaskTextureData[out + 3] = 0x80 | depthBytesByLevel[depthLevel - 1];
        }
    }

    return waterMaskTextureData;
}

function buildTerrainPickData(
    scene: Scene,
    borderSize: number,
    maxLevel: number,
    coreSize: number = Scene.MAP_SQUARE_SIZE,
    worldTileOffset: number = borderSize,
): {
    tileOffsets: Uint32Array;
    vertices: Float32Array;
    planes: Uint8Array;
} {
    const tileCount = coreSize * coreSize;
    const perTileVertices: number[][] = new Array(tileCount);
    const perTilePlanes: number[][] = new Array(tileCount);
    const vertexOffset = worldTileOffset * -128;

    // Each triangle stores two planes packed in one byte:
    //   bits 0-1: height plane — the heightmap level the geometry sits on
    //             (grid level +1 on bridge columns, where the column is shifted down).
    //   bits 2-3: draw plane — the level the tile is emitted under for rendering;
    //             picking accepts a triangle only while this plane is visible and
    //             not above the player's plane.
    const addTile = (
        tile: SceneTile | undefined,
        drawPlane: number,
        heightPlane: number = drawPlane,
    ): void => {
        const tileModel = tile?.tileModel;
        if (!tileModel) return;

        const localX = ((tile.x | 0) - (worldTileOffset | 0)) | 0;
        const localY = ((tile.y | 0) - (worldTileOffset | 0)) | 0;
        if (localX < 0 || localY < 0 || localX >= coreSize || localY >= coreSize) return;

        const idx = localY * coreSize + localX;
        const verts = perTileVertices[idx] ?? (perTileVertices[idx] = []);
        const planes = perTilePlanes[idx] ?? (perTilePlanes[idx] = []);
        const maxPlane = scene.levels - 1;
        const packed =
            (Math.max(0, Math.min(maxPlane, heightPlane | 0)) & 0x3) |
            ((Math.max(0, Math.min(maxPlane, drawPlane | 0)) & 0x3) << 2);

        const addFaces = (faces: typeof tileModel.faces): void => {
            for (const face of faces) {
                const fv = face.vertices;
                for (let i = 0; i < 3; i++) {
                    const v = fv[i];
                    verts.push(
                        (v.x + vertexOffset) / 128.0,
                        v.y / 128.0,
                        (v.z + vertexOffset) / 128.0,
                    );
                }
                planes.push(packed & 0xff);
            }
        };
        addFaces(tileModel.faces);
        // Invisible faces (transparent overlays such as bridge decks) are not
        // rendered but stay click-testable, like every face of a drawn tile.
        if (tileModel.hiddenFaces.length > 0) {
            addFaces(tileModel.hiddenFaces);
        }
    };

    const startX = borderSize;
    const startY = borderSize;
    const endX = borderSize + coreSize;
    const endY = borderSize + coreSize;

    for (let level = 0; level < scene.levels; level++) {
        for (let x = startX; x < endX; x++) {
            for (let y = startY; y < endY; y++) {
                const bridgeColumn = (scene.tileRenderFlags[1][x][y] & 0x2) !== 0;
                const heightPlane = bridgeColumn ? level + 1 : level;
                if (level === 0 && (scene.tileRenderFlags[1][x][y] & 0x8) !== 0) {
                    addTile(scene.tiles[1][x]?.[y], level, bridgeColumn ? 2 : 1);
                }

                const tile = scene.tiles[level][x]?.[y];
                if (!tile || tile.skipRender || !scene.isPlayerLevel(level, x, y, maxLevel)) {
                    continue;
                }

                if (level === 0 && isBridgeSurfaceTile(tile)) {
                    addTile(tile, level, heightPlane);
                    const linked = getBridgeLinkedBelow(tile);
                    if (linked) addTile(linked, level, 0);
                    continue;
                }
                if (level === 1 && (scene.tileRenderFlags[1][x][y] & 0x8) !== 0) {
                    continue;
                }

                addTile(tile, level, heightPlane);
                if (level === 0) {
                    const linked = getBridgeLinkedBelow(tile);
                    if (linked) addTile(linked, level, 0);
                }
            }
        }
    }

    const tileOffsets = new Uint32Array(tileCount + 1);
    let totalTriangles = 0;
    for (let i = 0; i < tileCount; i++) {
        tileOffsets[i] = totalTriangles;
        totalTriangles += (perTilePlanes[i]?.length ?? 0) | 0;
    }
    tileOffsets[tileCount] = totalTriangles;

    const vertices = new Float32Array(totalTriangles * 9);
    const planes = new Uint8Array(totalTriangles);
    let vertexWrite = 0;
    let planeWrite = 0;
    for (let i = 0; i < tileCount; i++) {
        const verts = perTileVertices[i];
        if (verts && verts.length > 0) {
            vertices.set(verts, vertexWrite);
            vertexWrite += verts.length;
        }
        const tilePlanes = perTilePlanes[i];
        if (tilePlanes && tilePlanes.length > 0) {
            planes.set(tilePlanes, planeWrite);
            planeWrite += tilePlanes.length;
        }
    }

    return { tileOffsets, vertices, planes };
}

function transparentPng1x1(): Blob {
    // 1x1 transparent PNG
    const base64 =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAoMBgYpRPiQAAAAASUVORK5CYII=";
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: "image/png" });
}

/**
 * Extract minimap icons from floor decorations in the scene.
 * Icons are objects (floor decorations) with a mapFunctionId set.
 * @param mapFunctionToSprite Function to resolve mapFunctionId -> sprite metadata
 */
function extractMinimapIcons(
    scene: Scene,
    locTypeLoader: LocTypeLoader,
    varManager: VarManager,
    borderSize: number,
    level: number,
    mapFunctionToSprite: (mapFunctionId: number) => MapElementMetadata | undefined,
): MinimapIcon[] {
    const icons: MinimapIcon[] = [];

    for (let tx = borderSize; tx < scene.sizeX - borderSize; tx++) {
        for (let ty = borderSize; ty < scene.sizeY - borderSize; ty++) {
            const tile = scene.tiles[level]?.[tx]?.[ty];
            if (!tile?.floorDecoration) continue;

            const tag = tile.floorDecoration.tag;
            if (tag === 0n) continue;

            const locId = getIdFromTag(tag);
            const locType = resolveMapIconLocType(locId, locTypeLoader, varManager);
            if (!locType) continue;

            if (locType.mapFunctionId !== -1) {
                const element = mapFunctionToSprite(locType.mapFunctionId);
                if (!element || element.spriteId === -1 || !element.minimapVisible) continue;

                // Convert from scene coords to local map square coords
                const localX = tx - borderSize;
                const localY = ty - borderSize;

                icons.push({
                    localX,
                    localY,
                    elementId: locType.mapFunctionId,
                    category: element.category,
                    spriteId: element.spriteId,
                    worldMapVisible: element.worldMapVisible,
                    name: element.name,
                    textColor: element.textColor,
                    textSize: element.textSize,
                    horizontalAlignment: element.horizontalAlignment,
                    verticalAlignment: element.verticalAlignment,
                });
            }
        }
    }

    return icons;
}

type MapElementMetadata = {
    spriteId: number;
    minimapVisible: boolean;
    worldMapVisible: boolean;
    category: number;
    name?: string;
    textColor: number;
    textSize: number;
    horizontalAlignment: number;
    verticalAlignment: number;
};

function resolveMapIconLocType(
    locId: number,
    locTypeLoader: LocTypeLoader,
    varManager: VarManager,
): LocType | undefined {
    const locType = locTypeLoader.load(locId | 0);
    if (!locType.transforms) return locType;
    return locType.transform(varManager, locTypeLoader);
}

function createMapIcon(
    locId: number,
    localX: number,
    localY: number,
    locTypeLoader: LocTypeLoader,
    varManager: VarManager,
    mapFunctionToElement: (mapFunctionId: number) => MapElementMetadata | undefined,
): MinimapIcon | undefined {
    const locType = resolveMapIconLocType(locId, locTypeLoader, varManager);
    if (!locType) return undefined;
    if ((locType.mapFunctionId | 0) === -1) return undefined;

    const element = mapFunctionToElement(locType.mapFunctionId | 0);
    if (!element || !element.worldMapVisible) return undefined;
    if ((element.spriteId | 0) === -1 && !element.name) return undefined;

    return {
        localX: localX | 0,
        localY: localY | 0,
        elementId: locType.mapFunctionId | 0,
        category: element.category | 0,
        spriteId: element.spriteId | 0,
        worldMapVisible: element.worldMapVisible,
        name: element.name,
        textColor: element.textColor | 0,
        textSize: element.textSize | 0,
        horizontalAlignment: element.horizontalAlignment | 0,
        verticalAlignment: element.verticalAlignment | 0,
    };
}

function extractWorldMapIcons(
    scene: Scene,
    locTypeLoader: LocTypeLoader,
    varManager: VarManager,
    borderSize: number,
    level: number,
    mapFunctionToElement: (mapFunctionId: number) => MapElementMetadata | undefined,
): MinimapIcon[] {
    const icons: MinimapIcon[] = [];
    const seen = new Set<string>();

    const pushIcon = (locId: number, localX: number, localY: number) => {
        const icon = createMapIcon(
            locId,
            localX,
            localY,
            locTypeLoader,
            varManager,
            mapFunctionToElement,
        );
        if (!icon) return false;
        const key = `${icon.elementId}:${icon.localX}:${icon.localY}`;
        if (seen.has(key)) return true;
        seen.add(key);
        icons.push(icon);
        return true;
    };

    for (let tx = borderSize; tx < scene.sizeX - borderSize; tx++) {
        for (let ty = borderSize; ty < scene.sizeY - borderSize; ty++) {
            const tile = scene.tiles[level]?.[tx]?.[ty];
            if (!tile) continue;

            const localX = tx - borderSize;
            const localY = ty - borderSize;

            if (tile.floorDecoration?.tag) {
                pushIcon(getIdFromTag(tile.floorDecoration.tag), localX, localY);
            }

            if (tile.wall?.tag) {
                pushIcon(getIdFromTag(tile.wall.tag), localX, localY);
            }

            if (tile.wallDecoration?.tag) {
                pushIcon(getIdFromTag(tile.wallDecoration.tag), localX, localY);
            }

            for (const loc of tile.locs) {
                if ((loc.startX | 0) !== tx || (loc.startY | 0) !== ty) continue;
                pushIcon(getIdFromTag(loc.tag), localX, localY);
            }
        }
    }

    return icons;
}

function createMapFunctionResolver(
    state: WorkerState,
): (id: number) => MapElementMetadata | undefined {
    try {
        const configIndex = state.cacheSystem.getIndex(IndexType.DAT2.configs);
        const cacheInfo = state.cache.info;
        if (
            cacheInfo.game === "oldschool" &&
            configIndex.archiveExists(ConfigType.OSRS.mapFunctions)
        ) {
            const mapElementArchive = configIndex.getArchive(ConfigType.OSRS.mapFunctions);
            const melLoader = new ArchiveMapElementTypeLoader(cacheInfo, mapElementArchive);
            const spriteCache = new Map<number, MapElementMetadata | undefined>();
            return (mapFuncId: number) => {
                if (!spriteCache.has(mapFuncId)) {
                    let sprite: MapElementMetadata | undefined = undefined;
                    try {
                        const mel = melLoader.load(mapFuncId);
                        sprite = {
                            spriteId: mel.spriteId,
                            minimapVisible: mel.minimapVisible,
                            worldMapVisible: mel.worldMapVisible,
                            category: mel.category,
                            name: mel.name,
                            textColor: mel.textColor,
                            textSize: mel.textSize,
                            horizontalAlignment: mel.horizontalAlignment,
                            verticalAlignment: mel.verticalAlignment,
                        };
                    } catch {
                        sprite = undefined;
                    }
                    spriteCache.set(mapFuncId, sprite);
                }
                return spriteCache.get(mapFuncId);
            };
        }
    } catch (e) {
        console.log("Failed to load MapElementTypeLoader for minimap icons", e);
    }
    return () => undefined;
}

function createModelGroups(
    modelGroupMap: Map<number, ModelMergeGroup>,
    sceneModels: SceneModel[],
    transparent: boolean,
): void {
    for (const sceneModel of sceneModels) {
        const planeCullLevel = sceneModel.planeCullLevel ?? sceneModel.level;
        const key =
            Number(transparent) |
            ((sceneModel.lowDetail ? 1 : 0) << 1) |
            (sceneModel.level << 2) |
            (sceneModel.priority << 4) |
            (planeCullLevel << 7);

        const group = modelGroupMap.get(key);
        if (group) {
            group.models.push(sceneModel);
        } else {
            modelGroupMap.set(key, {
                transparent,
                lowDetail: sceneModel.lowDetail,
                level: sceneModel.level,
                priority: sceneModel.priority,
                planeCullLevel,
                models: [sceneModel],
            });
        }
    }
}

function addSceneModels(
    modelHashBuf: ModelHashBuffer,
    textureLoader: TextureLoader,
    sceneBuf: SceneBuffer,
    sceneModels: SceneModel[],
    minimizeDrawCalls: boolean,
): void {
    const groupedModels = new Map<number, SceneModel[]>();
    for (const sceneModel of sceneModels) {
        const model = sceneModel.model;
        const hash = getModelHash(modelHashBuf, model);
        const locs = groupedModels.get(hash);
        if (locs) {
            locs.push(sceneModel);
        } else {
            groupedModels.set(hash, [sceneModel]);
        }
    }

    const modelGroupMap: Map<number, ModelMergeGroup> = new Map();
    for (const sceneModels of groupedModels.values()) {
        const model = sceneModels[0].model;
        const faces = getModelFaces(model);

        const opaqueFaces: ModelFace[] = [];
        const transparentFaces: ModelFace[] = [];
        for (const face of faces) {
            if (isModelFaceTransparent(textureLoader, face)) {
                transparentFaces.push(face);
            } else {
                opaqueFaces.push(face);
            }
        }

        const mergeModels: SceneModel[] = [];
        const instancedModels: SceneModel[] = [];
        const lodModels: SceneModel[] = [];
        for (const sceneModel of sceneModels) {
            if (sceneModel.forceMerge) {
                mergeModels.push(sceneModel);
            } else {
                instancedModels.push(sceneModel);
                if (!sceneModel.lowDetail) {
                    lodModels.push(sceneModel);
                }
            }
        }

        createModelGroups(modelGroupMap, mergeModels, false);
        if (transparentFaces.length > 0) {
            createModelGroups(modelGroupMap, mergeModels, true);
        }

        const instanceCount = instancedModels.length;
        const mergeOpaque =
            instanceCount === 1 || instanceCount * opaqueFaces.length < 100 || minimizeDrawCalls;
        const mergeTransparent =
            instanceCount === 1 ||
            instanceCount * transparentFaces.length < 100 ||
            minimizeDrawCalls;

        // mergeOpaque = false;
        // mergeTransparent = false;

        if (mergeOpaque) {
            createModelGroups(modelGroupMap, instancedModels, false);
        } else if (opaqueFaces.length > 0) {
            const indexOffset = sceneBuf.indexByteOffset();
            sceneBuf.addModel(model, opaqueFaces);
            const elementCount = (sceneBuf.indexByteOffset() - indexOffset) / 4;

            // Group instanced models by level AND planeCullLevel to keep CPU plane-culling accurate per draw range
            // Key format: level | (planeCullLevel << 8)
            const byLevelAndPlane = new Map<number, SceneModel[]>();
            for (const sm of instancedModels) {
                const planeCull = sm.planeCullLevel ?? sm.level;
                const key = sm.level | (planeCull << 8);
                const list = byLevelAndPlane.get(key);
                if (list) list.push(sm);
                else byLevelAndPlane.set(key, [sm]);
            }
            const byLevelAndPlaneLod = new Map<number, SceneModel[]>();
            for (const sm of lodModels) {
                const planeCull = sm.planeCullLevel ?? sm.level;
                const key = sm.level | (planeCull << 8);
                const list = byLevelAndPlaneLod.get(key);
                if (list) list.push(sm);
                else byLevelAndPlaneLod.set(key, [sm]);
            }

            for (const [key, models] of byLevelAndPlane.entries()) {
                const lvl = key & 0xff;
                const drawCommand: DrawCommand = {
                    offset: indexOffset,
                    elements: elementCount,
                    instances: models,
                };
                sceneBuf.drawCommands.push(drawCommand);
                sceneBuf.drawCommandsInteract.push(drawCommand);
                const lodForLevel = byLevelAndPlaneLod.get(key);
                if (lodForLevel && lodForLevel.length > 0) {
                    const drawCommandLod: DrawCommand = {
                        offset: indexOffset,
                        elements: elementCount,
                        instances: lodForLevel,
                    };
                    sceneBuf.drawCommandsLod.push(drawCommandLod);
                    sceneBuf.drawCommandsInteractLod.push(drawCommandLod);
                }
            }
        }

        if (mergeTransparent && transparentFaces.length > 0) {
            createModelGroups(modelGroupMap, instancedModels, true);
        } else if (transparentFaces.length > 0) {
            const indexOffset = sceneBuf.indexByteOffset();
            sceneBuf.addModel(model, transparentFaces);
            const elementCount = (sceneBuf.indexByteOffset() - indexOffset) / 4;

            // Group instanced models by level AND planeCullLevel for transparent path as well
            // Key format: level | (planeCullLevel << 8)
            const byLevelAndPlane = new Map<number, SceneModel[]>();
            for (const sm of instancedModels) {
                const planeCull = sm.planeCullLevel ?? sm.level;
                const key = sm.level | (planeCull << 8);
                const list = byLevelAndPlane.get(key);
                if (list) list.push(sm);
                else byLevelAndPlane.set(key, [sm]);
            }
            const byLevelAndPlaneLod = new Map<number, SceneModel[]>();
            for (const sm of lodModels) {
                const planeCull = sm.planeCullLevel ?? sm.level;
                const key = sm.level | (planeCull << 8);
                const list = byLevelAndPlaneLod.get(key);
                if (list) list.push(sm);
                else byLevelAndPlaneLod.set(key, [sm]);
            }

            for (const [key, models] of byLevelAndPlane.entries()) {
                const lvl = key & 0xff;
                const drawCommand: DrawCommand = {
                    offset: indexOffset,
                    elements: elementCount,
                    instances: models,
                };
                sceneBuf.drawCommandsAlpha.push(drawCommand);
                sceneBuf.drawCommandsInteractAlpha.push(drawCommand);

                const lodForLevel = byLevelAndPlaneLod.get(key);
                if (lodForLevel && lodForLevel.length > 0) {
                    const drawCommandLod: DrawCommand = {
                        offset: indexOffset,
                        elements: elementCount,
                        instances: lodForLevel,
                    };
                    sceneBuf.drawCommandsLodAlpha.push(drawCommandLod);
                    sceneBuf.drawCommandsInteractLodAlpha.push(drawCommandLod);
                }
            }
        }
    }

    for (const group of modelGroupMap.values()) {
        sceneBuf.addModelGroup(group);
    }
}

function buildLocGeometryData(sceneBuf: SceneBuffer): LocGeometryData {
    const drawRanges = (commands: DrawCommand[]): DrawRange[] =>
        commands.map((cmd) => newDrawRange(cmd.offset, cmd.elements, cmd.instances.length));
    const drawRangePlanes = (commands: DrawCommand[]): Uint8Array =>
        new Uint8Array(
            commands.map((cmd) => cmd.instances[0].planeCullLevel ?? cmd.instances[0].level),
        );

    return {
        vertices: sceneBuf.vertexBuf.byteArray(),
        indices: new Int32Array(sceneBuf.indices),

        modelTextureData: createModelInfoTextureData(sceneBuf.drawCommands),
        modelTextureDataAlpha: createModelInfoTextureData(sceneBuf.drawCommandsAlpha),
        modelTextureDataLod: createModelInfoTextureData(sceneBuf.drawCommandsLod),
        modelTextureDataLodAlpha: createModelInfoTextureData(sceneBuf.drawCommandsLodAlpha),
        modelTextureDataInteract: createModelInfoTextureData(sceneBuf.drawCommandsInteract),
        modelTextureDataInteractAlpha: createModelInfoTextureData(
            sceneBuf.drawCommandsInteractAlpha,
        ),
        modelTextureDataInteractLod: createModelInfoTextureData(sceneBuf.drawCommandsInteractLod),
        modelTextureDataInteractLodAlpha: createModelInfoTextureData(
            sceneBuf.drawCommandsInteractLodAlpha,
        ),

        drawRanges: drawRanges(sceneBuf.drawCommands),
        drawRangesAlpha: drawRanges(sceneBuf.drawCommandsAlpha),
        drawRangesPlanes: drawRangePlanes(sceneBuf.drawCommands),
        drawRangesAlphaPlanes: drawRangePlanes(sceneBuf.drawCommandsAlpha),
        drawRangesLod: drawRanges(sceneBuf.drawCommandsLod),
        drawRangesLodAlpha: drawRanges(sceneBuf.drawCommandsLodAlpha),
        drawRangesLodPlanes: drawRangePlanes(sceneBuf.drawCommandsLod),
        drawRangesLodAlphaPlanes: drawRangePlanes(sceneBuf.drawCommandsLodAlpha),
        drawRangesInteract: drawRanges(sceneBuf.drawCommandsInteract),
        drawRangesInteractAlpha: drawRanges(sceneBuf.drawCommandsInteractAlpha),
        drawRangesInteractPlanes: drawRangePlanes(sceneBuf.drawCommandsInteract),
        drawRangesInteractAlphaPlanes: drawRangePlanes(sceneBuf.drawCommandsInteractAlpha),
        drawRangesInteractLod: drawRanges(sceneBuf.drawCommandsInteractLod),
        drawRangesInteractLodAlpha: drawRanges(sceneBuf.drawCommandsInteractLodAlpha),
        drawRangesInteractLodPlanes: drawRangePlanes(sceneBuf.drawCommandsInteractLod),
        drawRangesInteractLodAlphaPlanes: drawRangePlanes(sceneBuf.drawCommandsInteractLodAlpha),
    };
}

function addLocAnimationFrames(
    locModelLoader: LocModelLoader,
    sceneBuf: SceneBuffer,
    entity: LocEntity,
    locType: LocType,
): AnimationFrames | undefined {
    const seqType = locModelLoader.seqTypeLoader.load(entity.seqId);
    let frameCount: number;
    if (seqType.isSkeletalSeq()) {
        frameCount = seqType.getSkeletalDuration();
    } else {
        if (!seqType.frameIds) {
            return undefined;
        }
        frameCount = seqType.frameIds.length;
    }
    if (frameCount === 0) {
        return undefined;
    }
    const frames = new Array<DrawRange>(frameCount);
    const framesAlpha = new Array<DrawRange>(frameCount);
    let alphaFrameCount = 0;
    for (let i = 0; i < frameCount; i++) {
        const model = locModelLoader.getModelAnimated(
            locType,
            entity.type,
            entity.rotation,
            entity.seqId,
            i,
        );
        if (model) {
            frames[i] = sceneBuf.addModelAnimFrame(model, false);
            framesAlpha[i] = sceneBuf.addModelAnimFrame(model, true);
            if (framesAlpha[i][1] > 0) {
                alphaFrameCount++;
            }
        } else {
            frames[i] = NULL_DRAW_RANGE;
            framesAlpha[i] = NULL_DRAW_RANGE;
        }
    }

    return {
        frames,
        framesAlpha: alphaFrameCount > 0 ? framesAlpha : undefined,
    };
}

function addLocEntities(
    centerLocHeightWithSize: boolean,
    locModelLoader: LocModelLoader,
    varManager: VarManager,
    scene: Scene,
    sceneModels: SceneModel[],
    doorSceneModels: SceneModel[],
    sceneBuf: SceneBuffer,
    locEntities: SceneLocEntity[],
): Iterable<LocAnimatedGroup> {
    const locAnimatedGroupMap = new Map<number, LocAnimatedGroup>();

    for (const sceneLocEntity of locEntities) {
        const entity = sceneLocEntity.entity;
        const id = entity.id;
        const type = entity.type;
        const rotation = entity.rotation;
        const tileX = entity.tileX;
        const tileY = entity.tileY;
        // Use the render level carried by SceneLocEntity (already bridge/force-visible aware).
        const level = sceneLocEntity.level | 0;

        let locType = locModelLoader.locTypeLoader.load(id);
        let sizeX = locType.sizeX;
        let sizeY = locType.sizeY;
        if (rotation === 1 || rotation === 3) {
            sizeX = locType.sizeY;
            sizeY = locType.sizeX;
        }

        if (locType.transforms) {
            const transformed = locType.transform(varManager, locModelLoader.locTypeLoader);
            if (!transformed) {
                continue;
            }
            locType = transformed;
        }

        const isDoor = isDoorLocType(locType);

        let startX = (sizeX >> 1) + tileX;
        let endX = ((sizeX + 1) >> 1) + tileX;
        let startY = (sizeY >> 1) + tileY;
        let endY = ((sizeY + 1) >> 1) + tileY;

        if (!centerLocHeightWithSize) {
            startX = tileX;
            endX = tileX + 1;
            startY = tileY;
            endY = tileY + 1;
        }

        // Sample heights from the effective surface for bridge-promoted columns.
        // Keep the render level unchanged (objects remain on their plane),
        // but when a base tile was shifted down from level 1 (bridge flag at [1]),
        // use level 1 heights for centerHeight and contouring so objects sit on the
        // visible walkway rather than the original base below.
        let heightLevel = level;
        if (level === 0 && (scene.tileRenderFlags[1][tileX][tileY] & 0x2) === 2) {
            heightLevel = 1;
        }
        const heightMap = scene.tileHeights[heightLevel];
        let heightMapAbove: Int32Array[] | undefined;
        if (heightLevel < scene.levels - 1) {
            heightMapAbove = scene.tileHeights[heightLevel + 1];
        }

        const centerHeight =
            (heightMap[endX][endY] +
                heightMap[startX][endY] +
                heightMap[startX][startY] +
                heightMap[endX][startY]) >>
            2;
        const entityX = (tileX << 7) + (sizeX << 6);
        const entityZ = (tileY << 7) + (sizeY << 6);

        const contourGroundInfo: ContourGroundInfo = {
            type: locType.contourGroundType,
            param: locType.contourGroundParam,
            heightMap,
            heightMapAbove,
            entityX: entityX,
            entityY: centerHeight,
            entityZ: entityZ,
        };
        const lowDetail = isLowDetail(scene, level, tileX, tileY, locType, type);
        if (entity.seqId !== -1) {
            if (isDoor) {
                const model = locModelLoader.getModelAnimated(
                    locType,
                    type,
                    rotation,
                    -1,
                    -1,
                    contourGroundInfo,
                );
                if (!model) {
                    continue;
                }
                doorSceneModels.push({
                    ...sceneLocEntity,

                    model,
                    sceneHeight: centerHeight,
                    lowDetail,
                    forceMerge: locType.contourGroundType > 1,
                    interactId: locType.id,
                });
                continue;
            }

            const loc = {
                ...sceneLocEntity,
                lowDetail,
                interactId: locType.id,
            };

            const key = rotation + (type << 3) + (locType.id << 10);
            const group = locAnimatedGroupMap.get(key);
            if (group) {
                group.locs.push(loc);
            } else {
                const anim = addLocAnimationFrames(locModelLoader, sceneBuf, entity, locType);
                if (!anim) {
                    continue;
                }

                locAnimatedGroupMap.set(key, {
                    anim,
                    locs: [loc],
                });
            }
        } else {
            const model = locModelLoader.getModelAnimated(
                locType,
                type,
                rotation,
                -1,
                -1,
                contourGroundInfo,
            );
            if (!model) {
                continue;
            }
            const target = isDoor ? doorSceneModels : sceneModels;
            target.push({
                ...sceneLocEntity,

                model,
                sceneHeight: centerHeight,
                lowDetail,
                forceMerge: locType.contourGroundType > 1,
                interactId: locType.id,
            });
        }
    }

    return locAnimatedGroupMap.values();
}

function addNpcAnimationFrames(
    npcModelLoader: NpcModelLoader,
    sceneBuf: SceneBuffer,
    npcType: NpcType,
    seqId: number,
): AnimationFrames | undefined {
    const seqType = npcModelLoader.seqTypeLoader.load(seqId);
    if (!seqType) {
        return undefined;
    }
    let frameCount: number;
    if (seqType.isSkeletalSeq()) {
        frameCount = seqType.getSkeletalDuration();
    } else {
        if (!seqType.frameIds) {
            return undefined;
        }
        frameCount = seqType.frameIds.length;
    }
    if (frameCount === 0) {
        return undefined;
    }
    const frames = new Array<DrawRange>(frameCount);
    const framesAlpha = new Array<DrawRange>(frameCount);
    let alphaFrameCount = 0;
    for (let i = 0; i < frameCount; i++) {
        const model = npcModelLoader.getModel(npcType, seqId, i);
        if (model) {
            frames[i] = sceneBuf.addModelAnimFrame(model, false);
            framesAlpha[i] = sceneBuf.addModelAnimFrame(model, true);
            if (framesAlpha[i][1] > 0) {
                alphaFrameCount++;
            }
        } else {
            frames[i] = NULL_DRAW_RANGE;
            framesAlpha[i] = NULL_DRAW_RANGE;
        }
    }

    return {
        frames,
        framesAlpha: alphaFrameCount > 0 ? framesAlpha : undefined,
    };
}

function addNpcStaticFrame(
    npcModelLoader: NpcModelLoader,
    sceneBuf: SceneBuffer,
    npcType: NpcType,
): AnimationFrames | undefined {
    let model;
    try {
        model = npcModelLoader.getModel(npcType, -1, -1);
    } catch {
        return undefined;
    }
    if (!model) {
        return undefined;
    }

    const frame = sceneBuf.addModelAnimFrame(model, false);
    const alphaFrame = sceneBuf.addModelAnimFrame(model, true);
    return {
        frames: [frame],
        framesAlpha: alphaFrame[1] > 0 ? [alphaFrame] : undefined,
    };
}

function getSeqFrameLengths(npcModelLoader: NpcModelLoader, seqId: number): number[] {
    const seqType = npcModelLoader.seqTypeLoader.load(seqId);
    if (!seqType) return [];

    if (seqType.isSkeletalSeq()) {
        const duration = Math.max(1, seqType.getSkeletalDuration() | 0);
        return new Array<number>(duration).fill(1);
    }

    const frameCount = Math.max(1, seqType.frameIds?.length ?? 0);
    const lengths = new Array<number>(frameCount);
    for (let i = 0; i < frameCount; i++) {
        const len = seqType.getFrameLength(npcModelLoader.seqFrameLoader, i);
        lengths[i] = len | 0;
    }
    return lengths;
}

function collectNpcPrebakedMovementSeqs(npcType: NpcType, basTypeLoader: BasTypeLoader): number[] {
    const movementSet = npcType.getMovementSeqSet(basTypeLoader);
    const unique = new Set<number>();
    const maybeAdd = (seqId: number) => {
        const next = seqId | 0;
        if (next >= 0) {
            unique.add(next);
        }
    };

    maybeAdd(movementSet.walkBack);
    maybeAdd(movementSet.walkLeft);
    maybeAdd(movementSet.walkRight);
    maybeAdd(movementSet.run);
    maybeAdd(movementSet.runBack);
    maybeAdd(movementSet.runLeft);
    maybeAdd(movementSet.runRight);
    maybeAdd(movementSet.crawl);
    maybeAdd(movementSet.crawlBack);
    maybeAdd(movementSet.crawlLeft);
    maybeAdd(movementSet.crawlRight);

    unique.delete(movementSet.idle | 0);
    unique.delete(movementSet.walk | 0);
    return Array.from(unique.values());
}

function createNpcRenderBundles(
    npcModelLoader: NpcModelLoader,
    basTypeLoader: BasTypeLoader,
    npcSceneBuf: SceneBuffer,
    npcInstances: NpcInstance[],
): NpcRenderBundle[] {
    const groupedInstances = new Map<number, NpcInstance[]>();
    for (const instance of npcInstances) {
        const group = groupedInstances.get(instance.typeId);
        if (group) {
            group.push(instance);
        } else {
            groupedInstances.set(instance.typeId, [instance]);
        }
    }

    const bundles: NpcRenderBundle[] = [];

    for (const instances of groupedInstances.values()) {
        const npcType = npcModelLoader.npcTypeLoader.load(instances[0].typeId);

        // Region geometry only needs one always-valid graphical state. Sequence
        // frames are produced and cached by DynamicNpcAnimLoader at render time.
        // Baking every idle/walk frame here delays newly streamed NPCs by seconds
        // and leaves no drawable fallback when an animation frame is malformed.
        const baseAnim = addNpcStaticFrame(npcModelLoader, npcSceneBuf, npcType);
        if (!baseAnim) {
            continue;
        }

        const template: NpcRenderTemplate = {
            typeId: npcType.id,
            idleAnim: baseAnim,
            walkAnim: baseAnim,
        };

        bundles.push({
            template,
            instances,
        });
    }

    return bundles;
}

function buildNpcGeometry(
    npcModelLoader: NpcModelLoader,
    basTypeLoader: BasTypeLoader,
    textureLoader: TextureLoader,
    textureIdIndexMap: Map<number, number>,
    npcInstances: NpcInstance[],
    baseTileX: number,
    baseTileY: number,
) {
    const npcSceneBuf = new SceneBuffer(textureLoader, textureIdIndexMap, 20000);
    const npcRenderBundles = createNpcRenderBundles(
        npcModelLoader,
        basTypeLoader,
        npcSceneBuf,
        npcInstances,
    );
    const npcs = createNpcDatas(npcRenderBundles, baseTileX, baseTileY);
    return { npcSceneBuf, npcs };
}

export class SdMapDataLoader implements RenderDataLoader<SdMapLoaderInput, SdMapData | undefined> {
    __type = "sdMapDataLoader" as const;

    modelHashBuf?: ModelHashBuffer;

    init(): void {
        if (!this.modelHashBuf) {
            this.modelHashBuf = new ModelHashBuffer(5000);
        }
    }

    async load(
        state: WorkerState,
        {
            mapX,
            mapY,
            maxLevel,
            loadNpcs,
            smoothTerrain,
            minimizeDrawCalls,
            doorOnly = false,
            locOnly = false,
            loadedTextureIds,
            locOverrides,
            locSpawns,
            terrainOverrides,
            instance: instanceInput,
            extraLocs: extraLocsInput,
            extraNpcs: extraNpcsInput,
            overrideRenderPos,
        }: SdMapLoaderInput,
    ): Promise<RenderDataResult<SdMapData | undefined>> {
        console.time(`load map ${mapX},${mapY}`);
        this.init();

        const locTypeLoader = state.locTypeLoader;
        const npcTypeLoader = state.npcTypeLoader;
        const basTypeLoader = state.basTypeLoader;
        const textureLoader = state.textureLoader;

        const locModelLoader = state.locModelLoader;
        const npcModelLoader = state.npcModelLoader;

        const varManager = state.varManager;

        let textureIds: number[] = [];
        const textureIdIndexMap = new Map<number, number>();
        textureIds = textureLoader.getTextureIds().filter((id) => textureLoader.isSd(id));
        textureIds = textureIds.slice(0, 2047);
        for (let i = 0; i < textureIds.length; i++) {
            textureIdIndexMap.set(textureIds[i], i);
        }

        const borderSize = 6;

        const isInstance = !!instanceInput;
        // Partial loc updates apply to a map square already on screen. They
        // only need one loc group, collision, and interaction data; instance
        // scenes still use the full path because they have one combined mesh.
        const shouldLoadDoorOnly = doorOnly && !isInstance;
        const shouldLoadLocOnly = locOnly && !isInstance && !shouldLoadDoorOnly;
        const shouldLoadPartial = shouldLoadDoorOnly || shouldLoadLocOnly;
        const CHUNK_SIZE = 8;
        const INSTANCE_SIZE = 13 * CHUNK_SIZE; // 104

        // Instance scenes use the full 13x13 chunk grid (104 tiles) with no border.
        // Normal scenes use MAP_SQUARE_SIZE + 2*border (76 tiles).
        const usedBorderSize = isInstance ? 0 : borderSize;
        const mapSize = isInstance ? INSTANCE_SIZE : Scene.MAP_SQUARE_SIZE + borderSize * 2;

        let baseX: number;
        let baseY: number;
        let renderPosX: number | undefined;
        let renderPosY: number | undefined;
        if (isInstance) {
            // Scene is in instance-local coordinates.
            // sceneX=0 corresponds to instance world origin.
            const instanceBaseX = (instanceInput!.regionX - 6) * CHUNK_SIZE;
            const instanceBaseY = (instanceInput!.regionY - 6) * CHUNK_SIZE;
            baseX = instanceBaseX;
            baseY = instanceBaseY;
            if (overrideRenderPos) {
                // World entity overlay: scene built at source coords,
                // rendered at entity's world position.
                renderPosX = overrideRenderPos.x / Scene.MAP_SQUARE_SIZE;
                renderPosY = overrideRenderPos.y / Scene.MAP_SQUARE_SIZE;
            } else {
                // Normal instance: renderPos matches scene base.
                // Shader: worldX = vertexLocalX + renderPosX * 64
                renderPosX = instanceBaseX / Scene.MAP_SQUARE_SIZE;
                renderPosY = instanceBaseY / Scene.MAP_SQUARE_SIZE;
            }
        } else {
            baseX = mapX * Scene.MAP_SQUARE_SIZE - borderSize;
            baseY = mapY * Scene.MAP_SQUARE_SIZE - borderSize;
        }

        // Apply loc overrides to scene builder (after baseX/baseY are calculated)
        if (locOverrides && locOverrides.size > 0) {
            console.log(
                `[SdMapDataLoader] Received ${locOverrides.size} loc overrides for map (${mapX},${mapY})`,
            );
            state.sceneBuilder.clearLocOverrides();
            for (const [key, overrideValue] of locOverrides.entries()) {
                const newId = overrideValue.newId | 0;
                const newRotation =
                    typeof overrideValue.newRotation === "number"
                        ? overrideValue.newRotation & 0x3
                        : undefined;
                const moveToX =
                    typeof overrideValue.moveToX === "number" &&
                    Number.isFinite(overrideValue.moveToX)
                        ? overrideValue.moveToX | 0
                        : undefined;
                const moveToY =
                    typeof overrideValue.moveToY === "number" &&
                    Number.isFinite(overrideValue.moveToY)
                        ? overrideValue.moveToY | 0
                        : undefined;
                const seqId =
                    typeof overrideValue.seqId === "number" && Number.isFinite(overrideValue.seqId)
                        ? overrideValue.seqId | 0
                        : undefined;
                const seqRandomStart =
                    typeof overrideValue.seqRandomStart === "boolean"
                        ? overrideValue.seqRandomStart
                        : undefined;
                const matchType =
                    typeof overrideValue.matchType === "number" &&
                    Number.isFinite(overrideValue.matchType)
                        ? overrideValue.matchType | 0
                        : undefined;
                const matchRotation =
                    typeof overrideValue.matchRotation === "number" &&
                    Number.isFinite(overrideValue.matchRotation)
                        ? overrideValue.matchRotation & 0x3
                        : undefined;
                console.log(`[SdMapDataLoader] Processing override: ${key} -> ${newId}`);
                const parts = key.split(",");
                if (parts.length === 4) {
                    const worldX = parseInt(parts[0]);
                    const worldY = parseInt(parts[1]);
                    const level = parseInt(parts[2]);
                    const oldId = parseInt(parts[3]);

                    // Convert world coordinates to scene coordinates
                    const sceneX = worldX - baseX;
                    const sceneY = worldY - baseY;
                    const moveToSceneX =
                        moveToX !== undefined ? (moveToX | 0) - (baseX | 0) : undefined;
                    const moveToSceneY =
                        moveToY !== undefined ? (moveToY | 0) - (baseY | 0) : undefined;

                    console.log(
                        `[SdMapDataLoader] Converted world (${worldX},${worldY}) to scene (${sceneX},${sceneY}), baseX=${baseX}, baseY=${baseY}`,
                    );

                    state.sceneBuilder.setLocOverride(
                        sceneX,
                        sceneY,
                        level,
                        oldId,
                        newId,
                        newRotation,
                        moveToSceneX,
                        moveToSceneY,
                        seqId,
                        seqRandomStart,
                        matchType,
                        matchRotation,
                    );
                }
            }
        } else {
            state.sceneBuilder.clearLocOverrides();
        }

        // Apply loc spawns (locs not present in base map data, e.g. fires on empty ground)
        if (locSpawns && locSpawns.size > 0) {
            state.sceneBuilder.clearLocSpawns();
            for (const [key, spawnValue] of locSpawns.entries()) {
                const parts = key.split(",");
                if (parts.length < 3) continue;
                const worldX = parseInt(parts[0]);
                const worldY = parseInt(parts[1]);
                const level = parseInt(parts[2]);
                const sceneX = worldX - baseX;
                const sceneY = worldY - baseY;
                state.sceneBuilder.setLocSpawn(
                    sceneX,
                    sceneY,
                    level,
                    spawnValue.id | 0,
                    spawnValue.type as LocModelType,
                    spawnValue.rotation & 0x3,
                );
            }
        } else {
            state.sceneBuilder.clearLocSpawns();
        }

        if (terrainOverrides && terrainOverrides.size > 0) {
            state.sceneBuilder.clearTerrainOverrides();
            for (const [key, overrideValue] of terrainOverrides.entries()) {
                const parts = key.split(",");
                if (parts.length !== 3) continue;
                const worldX = parseInt(parts[0]);
                const worldY = parseInt(parts[1]);
                const level = parseInt(parts[2]);
                const sceneX = worldX - baseX;
                const sceneY = worldY - baseY;
                state.sceneBuilder.setTerrainOverride(sceneX, sceneY, level, {
                    height: Number.isFinite(overrideValue.height) ? overrideValue.height! | 0 : undefined,
                    underlay:
                        typeof overrideValue.underlay === "number"
                            ? overrideValue.underlay | 0
                            : undefined,
                    overlay:
                        typeof overrideValue.overlay === "number"
                            ? overrideValue.overlay | 0
                            : undefined,
                    shape:
                        typeof overrideValue.shape === "number"
                            ? overrideValue.shape | 0
                            : undefined,
                    rotation:
                        typeof overrideValue.rotation === "number"
                            ? overrideValue.rotation & 0x3
                            : undefined,
                    renderFlags:
                        typeof overrideValue.renderFlags === "number"
                            ? overrideValue.renderFlags & 0xff
                            : undefined,
                });
            }
        } else {
            state.sceneBuilder.clearTerrainOverrides();
        }

        console.time(`build scene ${mapX},${mapY}`);
        let scene: Scene;
        const locLoadType = shouldLoadPartial ? LocLoadType.NO_MODELS : LocLoadType.MODELS;
        if (instanceInput) {
            scene = state.sceneBuilder.buildInstanceScene(
                instanceInput.templateChunks,
                baseX,
                baseY,
                INSTANCE_SIZE,
                INSTANCE_SIZE,
                smoothTerrain,
                locLoadType,
            );
        } else {
            scene = state.sceneBuilder.buildScene(
                baseX,
                baseY,
                mapSize,
                mapSize,
                smoothTerrain,
                locLoadType,
            );
        }
        // Inject extra locs (from LOC_ADD_CHANGE) into the built scene
        if (extraLocsInput && extraLocsInput.length > 0) {
            for (const loc of extraLocsInput) {
                const sceneX = loc.x - baseX;
                const sceneY = loc.y - baseY;
                if (
                    sceneX > 0 &&
                    sceneY > 0 &&
                    sceneX < scene.sizeX - 1 &&
                    sceneY < scene.sizeY - 1
                ) {
                    state.sceneBuilder.addLoc(
                        scene,
                        loc.level,
                        sceneX,
                        sceneY,
                        loc.id,
                        loc.shape,
                        loc.rotation,
                        scene.collisionMaps[loc.level],
                        locLoadType,
                    );
                }
            }
        }
        console.timeEnd(`build scene ${mapX},${mapY}`);

        // Terrain does not change for LOC_ADD_CHANGE packets. Keep it in the
        // primary mesh and put mutable non-door locs in their own mesh.
        const sceneBuf = new SceneBuffer(textureLoader, textureIdIndexMap, 100000);
        const locSceneBuf = new SceneBuffer(textureLoader, textureIdIndexMap, 100000);
        const doorSceneBuf = new SceneBuffer(textureLoader, textureIdIndexMap, 20000);
        const coreSize = isInstance ? INSTANCE_SIZE : Scene.MAP_SQUARE_SIZE;
        if (!shouldLoadPartial) {
            sceneBuf.addTerrain(scene, usedBorderSize, maxLevel, coreSize, usedBorderSize);
        }

        const sceneLocs = getSceneLocs(
            locTypeLoader,
            scene,
            usedBorderSize,
            maxLevel,
            coreSize,
            usedBorderSize,
        );
        const sceneModels: SceneModel[] = [];
        const doorSceneModels: SceneModel[] = [];
        if (!shouldLoadPartial) {
            for (const locModel of sceneLocs.locs) {
                const locType = locTypeLoader.load(locModel.interactId);
                if (isDoorLocType(locType)) {
                    doorSceneModels.push(locModel);
                } else {
                    sceneModels.push(locModel);
                }
            }
        }
        const locEntities = shouldLoadDoorOnly
            ? sceneLocs.locEntities.filter((loc) =>
                  isDoorLocType(locTypeLoader.load(loc.interactId)),
              )
            : shouldLoadLocOnly
              ? sceneLocs.locEntities.filter(
                    (loc) => !isDoorLocType(locTypeLoader.load(loc.interactId)),
                )
              : sceneLocs.locEntities;

        // Create loc animated groups and add transformed locs
        const locAnimatedGroups = addLocEntities(
            state.sceneBuilder.centerLocHeightWithSize,
            locModelLoader,
            varManager,
            scene,
            sceneModels,
            doorSceneModels,
            locSceneBuf,
            locEntities,
        );

        if (!shouldLoadDoorOnly) {
            addSceneModels(
                this.modelHashBuf!,
                textureLoader,
                locSceneBuf,
                sceneModels,
                minimizeDrawCalls,
            );
        }
        if (!shouldLoadLocOnly) {
            addSceneModels(
                this.modelHashBuf!,
                textureLoader,
                doorSceneBuf,
                doorSceneModels,
                minimizeDrawCalls,
            );
        }

        // Animated locs
        const locsAnimated = shouldLoadDoorOnly
            ? []
            : locSceneBuf.addLocAnimatedGroups(locAnimatedGroups);
        console.log(`animated locs: ${locsAnimated.length}`);

        // Npcs

        let npcInstances: NpcInstance[] = [];
        if (!shouldLoadPartial && loadNpcs) {
            const maxPlane = Math.max(0, maxLevel | 0);
            const currentMapId = getMapSquareId(mapX, mapY);
            npcInstances = state.npcInstances.filter((instance) => {
                if ((instance.level | 0) > maxPlane) return false;
                const worldViewId = instance.worldViewId;
                if (typeof worldViewId === "number" && worldViewId >= 0) {
                    const overlayMapX = 200 + (worldViewId | 0);
                    const overlayMapY = 200 + (worldViewId | 0);
                    return getMapSquareId(overlayMapX, overlayMapY) === currentMapId;
                }
                const npcMapX = getMapIndexFromTile(instance.x);
                const npcMapY = getMapIndexFromTile(instance.y);
                return npcMapX === mapX && npcMapY === mapY;
            });
        }
        if (!shouldLoadPartial && extraNpcsInput) {
            for (const npc of extraNpcsInput) {
                npcInstances.push({
                    typeId: npc.id,
                    x: npc.x,
                    y: npc.y,
                    level: npc.level,
                });
            }
        }
        const { npcSceneBuf, npcs } = shouldLoadPartial
            ? { npcSceneBuf: new SceneBuffer(textureLoader, textureIdIndexMap, 1), npcs: [] }
            : buildNpcGeometry(
                  npcModelLoader,
                  basTypeLoader,
                  textureLoader,
                  textureIdIndexMap,
                  npcInstances,
                  renderPosX != null
                      ? Math.floor(renderPosX * Scene.MAP_SQUARE_SIZE)
                      : mapX * Scene.MAP_SQUARE_SIZE,
                  renderPosY != null
                      ? Math.floor(renderPosY * Scene.MAP_SQUARE_SIZE)
                      : mapY * Scene.MAP_SQUARE_SIZE,
              );

        // Build per-level CSR mappings of loc IDs per interior tile (64x64 region) at tile origin.
        // We only include object IDs for origins (e.g., loc.startX/startY matches the tile) and direct
        // wall/wallDecoration/floorDecoration anchored at that tile.
        const TILE_SIZE = isInstance ? INSTANCE_SIZE : Scene.MAP_SQUARE_SIZE;
        const interiorMin = usedBorderSize;
        const interiorMaxX = usedBorderSize + TILE_SIZE - 1;
        const interiorMaxY = usedBorderSize + TILE_SIZE - 1;

        const tileLocOffsetsByLevel: Uint32Array[] = new Array(Scene.MAX_LEVELS);
        const tileLocIdsByLevel: Int32Array[] = new Array(Scene.MAX_LEVELS);
        const tileLocTypeRotByLevel: Uint8Array[] = new Array(Scene.MAX_LEVELS);
        const itemLayerHeightsByLevel: Uint16Array[] = new Array(Scene.MAX_LEVELS);
        const bridgeSurfaceFlags: Uint8Array[][] = new Array(Scene.MAX_LEVELS);

        for (let lvl = 0; lvl < Scene.MAX_LEVELS; lvl++) {
            // First pass: collect arrays per tile, then flatten.
            // Each entry keeps ID + packed modelType/rotation from SceneLoc.flags.
            const perTileIds: number[][] = new Array(TILE_SIZE * TILE_SIZE);
            const perTileTypeRots: number[][] = new Array(TILE_SIZE * TILE_SIZE);
            const itemLayerHeights = new Uint16Array(TILE_SIZE * TILE_SIZE);
            for (let ty = 0; ty < TILE_SIZE; ty++) {
                for (let tx = 0; tx < TILE_SIZE; tx++) {
                    const sceneX = interiorMin + tx;
                    const sceneY = interiorMin + ty;
                    const tile = scene.tiles[lvl][sceneX]?.[sceneY];
                    const ids: number[] = [];
                    const typeRots: number[] = [];
                    const pushLoc = (id: number, flags: number): void => {
                        const locId = id | 0;
                        if (!(locId > 0)) return;
                        const packedTypeRot =
                            ((((flags | 0) >> 6) & 0x3) << 6) | ((flags | 0) & 0x3f);
                        const packed = packedTypeRot & 0xff;
                        for (let i = 0; i < ids.length; i++) {
                            if ((ids[i] | 0) === locId && (typeRots[i] | 0) === packed) {
                                return;
                            }
                        }
                        ids.push(locId);
                        typeRots.push(packed);
                    };
                    if (tile) {
                        // Wall
                        if (tile.wall) {
                            try {
                                const wid = getIdFromTag(tile.wall.tag) | 0;
                                pushLoc(wid, tile.wall.flags | 0);
                            } catch {}
                        }
                        // Wall decoration
                        if (tile.wallDecoration) {
                            try {
                                const did = getIdFromTag(tile.wallDecoration.tag) | 0;
                                pushLoc(did, tile.wallDecoration.flags | 0);
                            } catch {}
                        }
                        // Floor decoration
                        if (tile.floorDecoration) {
                            try {
                                const fid = getIdFromTag(tile.floorDecoration.tag) | 0;
                                pushLoc(fid, tile.floorDecoration.flags | 0);
                            } catch {}
                        }
                        // Locs (filter to origin at this tile)
                        for (const loc of tile.locs) {
                            if (loc.startX === sceneX && loc.startY === sceneY) {
                                try {
                                    const lid = getIdFromTag(loc.tag) | 0;
                                    pushLoc(lid, loc.flags | 0);
                                } catch {}
                            }
                            if (((loc.flags | 0) & 256) === 256 && loc.entity instanceof Model) {
                                loc.entity.calculateBoundsCylinder();
                                const height = Math.max(0, loc.entity.height | 0);
                                const idx = ty * TILE_SIZE + tx;
                                if (height > itemLayerHeights[idx]) {
                                    itemLayerHeights[idx] = Math.min(0xffff, height);
                                }
                            }
                        }
                    }
                    const idx = ty * TILE_SIZE + tx;
                    perTileIds[idx] = ids;
                    perTileTypeRots[idx] = typeRots;
                }
            }
            // Flatten to CSR
            const offsets = new Uint32Array(TILE_SIZE * TILE_SIZE + 1);
            let total = 0;
            for (let i = 0; i < TILE_SIZE * TILE_SIZE; i++) {
                offsets[i] = total;
                total += perTileIds[i].length;
            }
            offsets[TILE_SIZE * TILE_SIZE] = total;
            const ids = new Int32Array(total);
            const typeRots = new Uint8Array(total);
            let p = 0;
            for (let i = 0; i < TILE_SIZE * TILE_SIZE; i++) {
                const arrIds = perTileIds[i];
                const arrTypeRots = perTileTypeRots[i];
                for (let j = 0; j < arrIds.length; j++) {
                    ids[p] = arrIds[j] | 0;
                    typeRots[p] = (arrTypeRots[j] | 0) & 0xff;
                    p++;
                }
            }
            tileLocOffsetsByLevel[lvl] = offsets;
            tileLocIdsByLevel[lvl] = ids;
            tileLocTypeRotByLevel[lvl] = typeRots;
            itemLayerHeightsByLevel[lvl] = itemLayerHeights;

            const levelBridgeFlags: Uint8Array[] = new Array(scene.sizeX);
            for (let x = 0; x < scene.sizeX; x++) {
                const column = new Uint8Array(scene.sizeY);
                for (let y = 0; y < scene.sizeY; y++) {
                    const tile = scene.tiles[lvl][x]?.[y];
                    column[y] = isBridgeSurfaceTile(tile) ? 1 : 0;
                }
                levelBridgeFlags[x] = column;
            }
            bridgeSurfaceFlags[lvl] = levelBridgeFlags;
        }

        // Draw ranges

        // Normal (merged)
        const drawRanges = sceneBuf.drawCommands.map((cmd) =>
            newDrawRange(cmd.offset, cmd.elements, cmd.instances.length),
        );
        const drawRangesPlanes = new Uint8Array(
            sceneBuf.drawCommands.map((cmd) => {
                const planeCull = cmd.instances[0].planeCullLevel ?? cmd.instances[0].level;
                return planeCull;
            }),
        );
        const drawRangesAlpha = sceneBuf.drawCommandsAlpha.map((cmd) =>
            newDrawRange(cmd.offset, cmd.elements, cmd.instances.length),
        );
        const drawRangesAlphaPlanes = new Uint8Array(
            sceneBuf.drawCommandsAlpha.map(
                (cmd) => cmd.instances[0].planeCullLevel ?? cmd.instances[0].level,
            ),
        );

        console.log(
            `draw ranges: ${drawRanges.length}, alpha: ${drawRangesAlpha.length}`,
            mapX,
            mapY,
        );

        // Lod (merged)
        const drawRangesLod = sceneBuf.drawCommandsLod.map((cmd) =>
            newDrawRange(cmd.offset, cmd.elements, cmd.instances.length),
        );
        const drawRangesLodPlanes = new Uint8Array(
            sceneBuf.drawCommandsLod.map(
                (cmd) => cmd.instances[0].planeCullLevel ?? cmd.instances[0].level,
            ),
        );
        const drawRangesLodAlpha = sceneBuf.drawCommandsLodAlpha.map((cmd) =>
            newDrawRange(cmd.offset, cmd.elements, cmd.instances.length),
        );
        const drawRangesLodAlphaPlanes = new Uint8Array(
            sceneBuf.drawCommandsLodAlpha.map(
                (cmd) => cmd.instances[0].planeCullLevel ?? cmd.instances[0].level,
            ),
        );

        console.log(
            `draw ranges lod: ${drawRangesLod.length}, alpha: ${drawRangesLodAlpha.length}`,
            mapX,
            mapY,
        );

        // Interact (non merged)
        const drawRangesInteract = sceneBuf.drawCommandsInteract.map((cmd) =>
            newDrawRange(cmd.offset, cmd.elements, cmd.instances.length),
        );
        const drawRangesInteractPlanes = new Uint8Array(
            sceneBuf.drawCommandsInteract.map(
                (cmd) => cmd.instances[0].planeCullLevel ?? cmd.instances[0].level,
            ),
        );
        const drawRangesInteractAlpha = sceneBuf.drawCommandsInteractAlpha.map((cmd) =>
            newDrawRange(cmd.offset, cmd.elements, cmd.instances.length),
        );
        const drawRangesInteractAlphaPlanes = new Uint8Array(
            sceneBuf.drawCommandsInteractAlpha.map(
                (cmd) => cmd.instances[0].planeCullLevel ?? cmd.instances[0].level,
            ),
        );

        console.log(`draw ranges interact: ${drawRangesInteract.length}`, mapX, mapY);

        // Interact Lod (non merged)
        const drawRangesInteractLod = sceneBuf.drawCommandsInteractLod.map((cmd) =>
            newDrawRange(cmd.offset, cmd.elements, cmd.instances.length),
        );
        const drawRangesInteractLodPlanes = new Uint8Array(
            sceneBuf.drawCommandsInteractLod.map(
                (cmd) => cmd.instances[0].planeCullLevel ?? cmd.instances[0].level,
            ),
        );
        const drawRangesInteractLodAlpha = sceneBuf.drawCommandsInteractLodAlpha.map((cmd) =>
            newDrawRange(cmd.offset, cmd.elements, cmd.instances.length),
        );
        const drawRangesInteractLodAlphaPlanes = new Uint8Array(
            sceneBuf.drawCommandsInteractLodAlpha.map(
                (cmd) => cmd.instances[0].planeCullLevel ?? cmd.instances[0].level,
            ),
        );

        const doorDrawRanges = doorSceneBuf.drawCommands.map((cmd) =>
            newDrawRange(cmd.offset, cmd.elements, cmd.instances.length),
        );
        const doorDrawRangesPlanes = new Uint8Array(
            doorSceneBuf.drawCommands.map(
                (cmd) => cmd.instances[0].planeCullLevel ?? cmd.instances[0].level,
            ),
        );
        const doorDrawRangesAlpha = doorSceneBuf.drawCommandsAlpha.map((cmd) =>
            newDrawRange(cmd.offset, cmd.elements, cmd.instances.length),
        );
        const doorDrawRangesAlphaPlanes = new Uint8Array(
            doorSceneBuf.drawCommandsAlpha.map(
                (cmd) => cmd.instances[0].planeCullLevel ?? cmd.instances[0].level,
            ),
        );
        const doorDrawRangesLod = doorSceneBuf.drawCommandsLod.map((cmd) =>
            newDrawRange(cmd.offset, cmd.elements, cmd.instances.length),
        );
        const doorDrawRangesLodPlanes = new Uint8Array(
            doorSceneBuf.drawCommandsLod.map(
                (cmd) => cmd.instances[0].planeCullLevel ?? cmd.instances[0].level,
            ),
        );
        const doorDrawRangesLodAlpha = doorSceneBuf.drawCommandsLodAlpha.map((cmd) =>
            newDrawRange(cmd.offset, cmd.elements, cmd.instances.length),
        );
        const doorDrawRangesLodAlphaPlanes = new Uint8Array(
            doorSceneBuf.drawCommandsLodAlpha.map(
                (cmd) => cmd.instances[0].planeCullLevel ?? cmd.instances[0].level,
            ),
        );
        const doorDrawRangesInteract = doorSceneBuf.drawCommandsInteract.map((cmd) =>
            newDrawRange(cmd.offset, cmd.elements, cmd.instances.length),
        );
        const doorDrawRangesInteractPlanes = new Uint8Array(
            doorSceneBuf.drawCommandsInteract.map(
                (cmd) => cmd.instances[0].planeCullLevel ?? cmd.instances[0].level,
            ),
        );
        const doorDrawRangesInteractAlpha = doorSceneBuf.drawCommandsInteractAlpha.map((cmd) =>
            newDrawRange(cmd.offset, cmd.elements, cmd.instances.length),
        );
        const doorDrawRangesInteractAlphaPlanes = new Uint8Array(
            doorSceneBuf.drawCommandsInteractAlpha.map(
                (cmd) => cmd.instances[0].planeCullLevel ?? cmd.instances[0].level,
            ),
        );
        const doorDrawRangesInteractLod = doorSceneBuf.drawCommandsInteractLod.map((cmd) =>
            newDrawRange(cmd.offset, cmd.elements, cmd.instances.length),
        );
        const doorDrawRangesInteractLodPlanes = new Uint8Array(
            doorSceneBuf.drawCommandsInteractLod.map(
                (cmd) => cmd.instances[0].planeCullLevel ?? cmd.instances[0].level,
            ),
        );
        const doorDrawRangesInteractLodAlpha = doorSceneBuf.drawCommandsInteractLodAlpha.map(
            (cmd) => newDrawRange(cmd.offset, cmd.elements, cmd.instances.length),
        );
        const doorDrawRangesInteractLodAlphaPlanes = new Uint8Array(
            doorSceneBuf.drawCommandsInteractLodAlpha.map(
                (cmd) => cmd.instances[0].planeCullLevel ?? cmd.instances[0].level,
            ),
        );

        // Model info textures
        const modelTextureData = createModelInfoTextureData(sceneBuf.drawCommands);
        const modelTextureDataAlpha = createModelInfoTextureData(sceneBuf.drawCommandsAlpha);

        const modelTextureDataLod = createModelInfoTextureData(sceneBuf.drawCommandsLod);
        const modelTextureDataLodAlpha = createModelInfoTextureData(sceneBuf.drawCommandsLodAlpha);

        const modelTextureDataInteract = createModelInfoTextureData(sceneBuf.drawCommandsInteract);
        const modelTextureDataInteractAlpha = createModelInfoTextureData(
            sceneBuf.drawCommandsInteractAlpha,
        );

        const modelTextureDataInteractLod = createModelInfoTextureData(
            sceneBuf.drawCommandsInteractLod,
        );
        const modelTextureDataInteractLodAlpha = createModelInfoTextureData(
            sceneBuf.drawCommandsInteractLodAlpha,
        );

        const doorModelTextureData = createModelInfoTextureData(doorSceneBuf.drawCommands);
        const doorModelTextureDataAlpha = createModelInfoTextureData(
            doorSceneBuf.drawCommandsAlpha,
        );

        const doorModelTextureDataLod = createModelInfoTextureData(doorSceneBuf.drawCommandsLod);
        const doorModelTextureDataLodAlpha = createModelInfoTextureData(
            doorSceneBuf.drawCommandsLodAlpha,
        );

        const doorModelTextureDataInteract = createModelInfoTextureData(
            doorSceneBuf.drawCommandsInteract,
        );
        const doorModelTextureDataInteractAlpha = createModelInfoTextureData(
            doorSceneBuf.drawCommandsInteractAlpha,
        );

        const doorModelTextureDataInteractLod = createModelInfoTextureData(
            doorSceneBuf.drawCommandsInteractLod,
        );
        const doorModelTextureDataInteractLodAlpha = createModelInfoTextureData(
            doorSceneBuf.drawCommandsInteractLodAlpha,
        );

        const locGeometry = buildLocGeometryData(locSceneBuf);

        const heightMapTextureData = shouldLoadPartial
            ? new Int16Array(0)
            : loadHeightMapTextureData(scene);
        const waterMaskTextureData = shouldLoadPartial
            ? new Uint8Array(0)
            : loadWaterMaskTextureData(scene);
        const terrainPickData = shouldLoadPartial
            ? {
                  tileOffsets: new Uint32Array(0),
                  vertices: new Float32Array(0),
                  planes: new Uint8Array(0),
              }
            : buildTerrainPickData(scene, usedBorderSize, maxLevel, coreSize, usedBorderSize);

        const vertices = sceneBuf.vertexBuf.byteArray();
        const indices = new Int32Array(sceneBuf.indices);
        const doorVertices = doorSceneBuf.vertexBuf.byteArray();
        const doorIndices = new Int32Array(doorSceneBuf.indices);
        const npcVertices = npcSceneBuf.vertexBuf.byteArray();
        const npcIndices = new Int32Array(npcSceneBuf.indices);

        const minimapBlobs: Blob[] = shouldLoadPartial ? [] : new Array(Scene.MAX_LEVELS);
        if (!shouldLoadPartial) {
            if (typeof OffscreenCanvas !== "undefined") {
                for (let level = 0; level < Scene.MAX_LEVELS; level++) {
                    minimapBlobs[level] = await loadMinimapBlob(
                        state.minimapImageRenderer,
                        scene,
                        level,
                        usedBorderSize,
                    );
                }
            } else {
                const transparent = transparentPng1x1();
                for (let level = 0; level < Scene.MAX_LEVELS; level++) {
                    minimapBlobs[level] = transparent;
                }
            }
        }

        // Extract dynamic minimap icons for ordinary loc changes as well. The
        // raster minimap image remains static on partial updates, but map
        // function icons need to appear/disappear with their locs.
        const minimapIcons: MinimapIcon[][] = shouldLoadDoorOnly
            ? []
            : new Array(Scene.MAX_LEVELS);
        const worldMapIcons: MinimapIcon[][] = shouldLoadDoorOnly
            ? []
            : new Array(Scene.MAX_LEVELS);
        if (!shouldLoadDoorOnly) {
            const mapFunctionToSprite = createMapFunctionResolver(state);
            for (let level = 0; level < Scene.MAX_LEVELS; level++) {
                minimapIcons[level] = extractMinimapIcons(
                    scene,
                    state.locTypeLoader,
                    state.varManager,
                    usedBorderSize,
                    level,
                    mapFunctionToSprite,
                );
                worldMapIcons[level] = extractWorldMapIcons(
                    scene,
                    state.locTypeLoader,
                    state.varManager,
                    usedBorderSize,
                    level,
                    mapFunctionToSprite,
                );
            }
        }

        const loadedTextures = new Map<number, Int32Array>();
        const usedTextureIds = new Set<number>();
        if (!shouldLoadDoorOnly) {
            for (const textureId of sceneBuf.usedTextureIds) {
                if (!loadedTextureIds.has(textureId)) {
                    try {
                        const pixels = textureLoader.getPixelsArgb(textureId, 128, true, 1.0);
                        loadedTextures.set(textureId, pixels);
                    } catch (e) {
                        console.warn(
                            `SdMapDataLoader: failed to load primary texture ${textureId}`,
                            e,
                        );
                    }
                }
                usedTextureIds.add(textureId);
            }
            for (const textureId of locSceneBuf.usedTextureIds) {
                if (!loadedTextureIds.has(textureId) && !loadedTextures.has(textureId)) {
                    try {
                        const pixels = textureLoader.getPixelsArgb(textureId, 128, true, 1.0);
                        loadedTextures.set(textureId, pixels);
                    } catch (e) {
                        console.warn(`SdMapDataLoader: failed to load loc texture ${textureId}`, e);
                    }
                }
                usedTextureIds.add(textureId);
            }
        }
        for (const textureId of doorSceneBuf.usedTextureIds) {
            if (!loadedTextureIds.has(textureId) && !loadedTextures.has(textureId)) {
                try {
                    const pixels = textureLoader.getPixelsArgb(textureId, 128, true, 1.0);
                    loadedTextures.set(textureId, pixels);
                } catch (e) {
                    console.warn(`SdMapDataLoader: failed to load door texture ${textureId}`, e);
                }
            }
            usedTextureIds.add(textureId);
        }
        if (!shouldLoadPartial) {
            for (const textureId of npcSceneBuf.usedTextureIds) {
                if (!loadedTextureIds.has(textureId) && !loadedTextures.has(textureId)) {
                    try {
                        const pixels = textureLoader.getPixelsArgb(textureId, 128, true, 1.0);
                        loadedTextures.set(textureId, pixels);
                    } catch (e) {
                        console.warn(`SdMapDataLoader: failed to load NPC texture ${textureId}`, e);
                    }
                }
                usedTextureIds.add(textureId);
            }
        }

        console.timeEnd(`load map ${mapX},${mapY}`);

        const transferables = [
            ...scene.tileRenderFlags.flat().map((buf) => buf.buffer),
            ...scene.collisionMaps.map((map) => map.flags.buffer),
            ...Array.from(loadedTextures.values()).map((pixels) => pixels.buffer),

            vertices.buffer,
            indices.buffer,
            locGeometry.vertices.buffer,
            locGeometry.indices.buffer,
            doorVertices.buffer,
            doorIndices.buffer,
            npcVertices.buffer,
            npcIndices.buffer,
            heightMapTextureData.buffer,
            waterMaskTextureData.buffer,
            terrainPickData.tileOffsets.buffer,
            terrainPickData.vertices.buffer,
            terrainPickData.planes.buffer,

            modelTextureData.buffer,
            modelTextureDataAlpha.buffer,

            modelTextureDataLod.buffer,
            modelTextureDataLodAlpha.buffer,

            modelTextureDataInteract.buffer,
            modelTextureDataInteractAlpha.buffer,

            modelTextureDataInteractLod.buffer,
            modelTextureDataInteractLodAlpha.buffer,

            locGeometry.modelTextureData.buffer,
            locGeometry.modelTextureDataAlpha.buffer,
            locGeometry.modelTextureDataLod.buffer,
            locGeometry.modelTextureDataLodAlpha.buffer,
            locGeometry.modelTextureDataInteract.buffer,
            locGeometry.modelTextureDataInteractAlpha.buffer,
            locGeometry.modelTextureDataInteractLod.buffer,
            locGeometry.modelTextureDataInteractLodAlpha.buffer,

            doorModelTextureData.buffer,
            doorModelTextureDataAlpha.buffer,

            doorModelTextureDataLod.buffer,
            doorModelTextureDataLodAlpha.buffer,

            doorModelTextureDataInteract.buffer,
            doorModelTextureDataInteractAlpha.buffer,

            doorModelTextureDataInteractLod.buffer,
            doorModelTextureDataInteractLodAlpha.buffer,
            drawRangesPlanes.buffer,
            drawRangesAlphaPlanes.buffer,
            drawRangesLodPlanes.buffer,
            drawRangesLodAlphaPlanes.buffer,
            drawRangesInteractPlanes.buffer,
            drawRangesInteractAlphaPlanes.buffer,
            drawRangesInteractLodPlanes.buffer,
            drawRangesInteractLodAlphaPlanes.buffer,
            locGeometry.drawRangesPlanes.buffer,
            locGeometry.drawRangesAlphaPlanes.buffer,
            locGeometry.drawRangesLodPlanes.buffer,
            locGeometry.drawRangesLodAlphaPlanes.buffer,
            locGeometry.drawRangesInteractPlanes.buffer,
            locGeometry.drawRangesInteractAlphaPlanes.buffer,
            locGeometry.drawRangesInteractLodPlanes.buffer,
            locGeometry.drawRangesInteractLodAlphaPlanes.buffer,
            doorDrawRangesPlanes.buffer,
            doorDrawRangesAlphaPlanes.buffer,
            doorDrawRangesLodPlanes.buffer,
            doorDrawRangesLodAlphaPlanes.buffer,
            doorDrawRangesInteractPlanes.buffer,
            doorDrawRangesInteractAlphaPlanes.buffer,
            doorDrawRangesInteractLodPlanes.buffer,
            doorDrawRangesInteractLodAlphaPlanes.buffer,
            ...bridgeSurfaceFlags.flat().map((column) => column.buffer),
            ...tileLocOffsetsByLevel.map((a) => a.buffer),
            ...tileLocIdsByLevel.map((a) => a.buffer),
            ...tileLocTypeRotByLevel.map((a) => a.buffer),
            ...itemLayerHeightsByLevel.map((a) => a.buffer),
        ];

        const totalBytes = transferables.reduce((sum, buf) => sum + buf.byteLength, 0);

        console.log(
            `total bytes: ${totalBytes} ${mapX},${mapY}`,
            usedTextureIds,
            loadedTextures.size,
        );

        return {
            data: {
                mapX,
                mapY,

                cacheName: state.cache.info.name,

                maxLevel,
                loadNpcs,

                smoothTerrain,
                doorOnly: shouldLoadDoorOnly,
                locOnly: shouldLoadLocOnly,

                borderSize: usedBorderSize,
                heightMapSize: mapSize,
                renderPosX,
                renderPosY,
                tileRenderFlags: scene.tileRenderFlags,
                collisionDatas: scene.collisionMaps,

                minimapBlobs,
                minimapIcons,
                worldMapIcons,

                vertices,
                indices,
                loc: locGeometry,
                doorVertices,
                doorIndices,
                npcVertices,
                npcIndices,

                modelTextureData,
                modelTextureDataAlpha,

                modelTextureDataLod,
                modelTextureDataLodAlpha,

                modelTextureDataInteract,
                modelTextureDataInteractAlpha,

                modelTextureDataInteractLod,
                modelTextureDataInteractLodAlpha,

                doorModelTextureData,
                doorModelTextureDataAlpha,

                doorModelTextureDataLod,
                doorModelTextureDataLodAlpha,

                doorModelTextureDataInteract,
                doorModelTextureDataInteractAlpha,

                doorModelTextureDataInteractLod,
                doorModelTextureDataInteractLodAlpha,

                heightMapTextureData,
                waterMaskTextureData,
                terrainPickTileOffsets: terrainPickData.tileOffsets,
                terrainPickVertices: terrainPickData.vertices,
                terrainPickPlanes: terrainPickData.planes,

                drawRanges,
                drawRangesAlpha,
                drawRangesPlanes,
                drawRangesAlphaPlanes,

                drawRangesLod,
                drawRangesLodAlpha,
                drawRangesLodPlanes,
                drawRangesLodAlphaPlanes,

                drawRangesInteract,
                drawRangesInteractAlpha,
                drawRangesInteractPlanes,
                drawRangesInteractAlphaPlanes,

                drawRangesInteractLod,
                drawRangesInteractLodAlpha,
                drawRangesInteractLodPlanes,
                drawRangesInteractLodAlphaPlanes,

                doorDrawRanges,
                doorDrawRangesAlpha,
                doorDrawRangesPlanes,
                doorDrawRangesAlphaPlanes,

                doorDrawRangesLod,
                doorDrawRangesLodAlpha,
                doorDrawRangesLodPlanes,
                doorDrawRangesLodAlphaPlanes,

                doorDrawRangesInteract,
                doorDrawRangesInteractAlpha,
                doorDrawRangesInteractPlanes,
                doorDrawRangesInteractAlphaPlanes,

                doorDrawRangesInteractLod,
                doorDrawRangesInteractLodAlpha,
                doorDrawRangesInteractLodPlanes,
                doorDrawRangesInteractLodAlphaPlanes,

                locsAnimated,
                npcs,

                loadedTextures,

                bridgeSurfaceFlags,

                tileLocOffsetsByLevel,
                tileLocIdsByLevel,
                tileLocTypeRotByLevel,
                itemLayerHeightsByLevel,
            },
            transferables,
        };
    }

    async loadNpcGeometry(
        state: WorkerState,
        {
            mapX,
            mapY,
            maxLevel,
            loadedTextureIds,
        }: {
            mapX: number;
            mapY: number;
            maxLevel: number;
            loadedTextureIds: Set<number>;
        },
    ): Promise<RenderDataResult<NpcGeometryData>> {
        this.init();

        const textureLoader = state.textureLoader;
        const npcModelLoader = state.npcModelLoader;
        const basTypeLoader = state.basTypeLoader;

        let textureIds = textureLoader.getTextureIds().filter((id) => textureLoader.isSd(id));
        textureIds = textureIds.slice(0, 2047);
        const textureIdIndexMap = new Map<number, number>();
        for (let i = 0; i < textureIds.length; i++) {
            textureIdIndexMap.set(textureIds[i], i);
        }

        const borderSize = 6;
        const maxPlane = Math.max(0, maxLevel | 0);
        const npcInstances = state.npcInstances.filter((instance) => {
            if ((instance.level | 0) > maxPlane) return false;
            const npcMapX = getMapIndexFromTile(instance.x);
            const npcMapY = getMapIndexFromTile(instance.y);
            return npcMapX === mapX && npcMapY === mapY;
        });

        const { npcSceneBuf, npcs } = buildNpcGeometry(
            npcModelLoader,
            basTypeLoader,
            textureLoader,
            textureIdIndexMap,
            npcInstances,
            mapX * Scene.MAP_SQUARE_SIZE,
            mapY * Scene.MAP_SQUARE_SIZE,
        );

        const vertices = npcSceneBuf.vertexBuf.byteArray();
        const indices = new Int32Array(npcSceneBuf.indices);

        const loadedTextures = new Map<number, Int32Array>();
        for (const textureId of npcSceneBuf.usedTextureIds) {
            if (!loadedTextureIds.has(textureId)) {
                try {
                    const pixels = textureLoader.getPixelsArgb(textureId, 128, true, 1.0);
                    loadedTextures.set(textureId, pixels);
                } catch (err) {
                    console.warn(`SdMapDataLoader: failed to load NPC texture ${textureId}`, err);
                }
            }
        }

        const transferables = [
            vertices.buffer,
            indices.buffer,
            ...Array.from(loadedTextures.values()).map((p) => p.buffer),
        ];

        return {
            data: {
                mapX,
                mapY,
                borderSize,
                npcs,
                vertices,
                indices,
                loadedTextures,
            },
            transferables,
        };
    }

    reset(): void {
        this.modelHashBuf = undefined;
    }
}
