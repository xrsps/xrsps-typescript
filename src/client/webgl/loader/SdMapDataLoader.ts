import { ConfigType } from "../../../rs/cache/ConfigType";
import { IndexType } from "../../../rs/cache/IndexType";
import { BasTypeLoader } from "../../../rs/config/bastype/BasTypeLoader";
import { ContourGroundInfo, LocModelLoader } from "../../../rs/config/loctype/LocModelLoader";
import { LocType } from "../../../rs/config/loctype/LocType";
import { LocTypeLoader } from "../../../rs/config/loctype/LocTypeLoader";
import { ArchiveMapElementTypeLoader } from "../../../rs/config/meltype/MapElementTypeLoader";
import { NpcModelLoader } from "../../../rs/config/npctype/NpcModelLoader";
import { NpcType } from "../../../rs/config/npctype/NpcType";
import { ObjModelLoader } from "../../../rs/config/objtype/ObjModelLoader";
import { SeqTypeLoader } from "../../../rs/config/seqtype/SeqTypeLoader";
import { VarManager } from "../../../rs/config/vartype/VarManager";
import { getMapIndexFromTile } from "../../../rs/map/MapFileIndex";
import { Model } from "../../../rs/model/Model";
import { Scene } from "../../../rs/scene/Scene";
import { LocLoadType } from "../../../rs/scene/SceneBuilder";
import { getIdFromTag } from "../../../rs/scene/entity/EntityTag";
import { LocEntity } from "../../../rs/scene/entity/LocEntity";
import { TextureLoader } from "../../../rs/texture/TextureLoader";
import { ObjSpawn, getMapObjSpawns } from "../../data/obj/ObjSpawn";
import { isBridgeSurfaceTile } from "../../roof/RoofVisibility";
import { loadMinimapBlob } from "../../worker/MinimapData";
import { RenderDataLoader, RenderDataResult } from "../../worker/RenderDataLoader";
import { WorkerState } from "../../worker/RenderDataWorker";
import { AnimationFrames } from "../AnimationFrames";
import { DrawRange, NULL_DRAW_RANGE, newDrawRange } from "../DrawRange";
import { InteractType } from "../InteractType";
import { ModelHashBuffer, getModelHash } from "../buffer/ModelHashBuffer";
import {
    ContourGroundType,
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
    NpcRenderExtraAnim,
    NpcRenderTemplate,
} from "../npc/NpcRenderTemplate";
import { NpcGeometryData } from "./NpcGeometryData";
import { type MinimapIcon, SdMapData } from "./SdMapData";
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
 * @param mapFunctionToSpriteId Function to resolve mapFunctionId -> spriteId (from MapElementType)
 */
function extractMinimapIcons(
    scene: Scene,
    locTypeLoader: LocTypeLoader,
    borderSize: number,
    mapFunctionToSpriteId: (mapFunctionId: number) => number,
): MinimapIcon[] {
    const icons: MinimapIcon[] = [];

    // Only extract from level 0 (ground level) - same as OSRS minimap
    const level = 0;

    for (let tx = borderSize; tx < scene.sizeX - borderSize; tx++) {
        for (let ty = borderSize; ty < scene.sizeY - borderSize; ty++) {
            const tile = scene.tiles[level]?.[tx]?.[ty];
            if (!tile?.floorDecoration) continue;

            const tag = tile.floorDecoration.tag;
            if (tag === 0n) continue;

            const locId = getIdFromTag(tag);
            const locType = locTypeLoader.load(locId);

            if (locType.mapFunctionId !== -1) {
                const spriteId = mapFunctionToSpriteId(locType.mapFunctionId);
                if (spriteId === -1) continue;

                // Convert from scene coords to local map square coords
                const localX = tx - borderSize;
                const localY = ty - borderSize;

                icons.push({
                    localX,
                    localY,
                    spriteId,
                });
            }
        }
    }

    return icons;
}

function createObjSceneModels(
    objModelLoader: ObjModelLoader,
    sceneModels: SceneModel[],
    scene: Scene,
    borderSize: number,
    spawns: ObjSpawn[],
): void {
    for (const spawn of spawns) {
        createObjSceneModel(objModelLoader, sceneModels, scene, borderSize, spawn);
    }
}

function createObjSceneModel(
    objModelLoader: ObjModelLoader,
    sceneModels: SceneModel[],
    scene: Scene,
    borderSize: number,
    spawn: ObjSpawn,
): void {
    const objType = objModelLoader.objTypeLoader.load(spawn.id);
    if (objType.name === "null") {
        return;
    }

    const localX = spawn.x % 64;
    const localY = spawn.y % 64;

    const tileX = localX + borderSize;
    const tileY = localY + borderSize;

    const model = objModelLoader.getModel(spawn.id, spawn.count);
    if (!model) {
        return undefined;
    }

    // Rendering plane for objects should mirror the cache spawn plane.
    // Do NOT promote objects on bridge tiles to the next plane; OSRS keeps the
    // object plane unchanged and handles bridge visibility via tile minPlane and
    // linkedBelow semantics during scene build.
    // Promoting here causes incorrect roof/bridge culling and missing bases.
    let renderLevel = spawn.plane;

    const sceneHeight = scene.getCenterHeight(renderLevel, tileX, tileY);

    let heightOffset = 0;
    const tile = scene.tiles[renderLevel][tileX][tileY];
    if (!tile || !tile.tileModel || tile.tileModel.faces.length === 0) {
        return undefined;
    }
    if (tile) {
        for (const loc of tile.locs) {
            if ((loc.flags & 256) === 256 && loc.entity instanceof Model) {
                const model = loc.entity;
                model.calculateBoundsCylinder();
                if (model.contourHeight > heightOffset) {
                    heightOffset = model.contourHeight;
                }
            }
        }
    }

    let contourGround = ContourGroundType.CENTER_TILE;

    if (heightOffset !== 0) {
        heightOffset -= sceneHeight;
        contourGround = ContourGroundType.NONE;
    }

    sceneModels.push({
        model,
        lowDetail: false,
        forceMerge: false,
        sceneHeight,
        sceneX: localX * 128 + 64,
        sceneZ: localY * 128 + 64,
        heightOffset,
        level: renderLevel,
        contourGround,
        priority: 10,
        interactType: InteractType.OBJ,
        interactId: spawn.id,
    });
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

        const idleSeqId = npcType.getIdleSeqId(basTypeLoader);
        const walkSeqId = npcType.getWalkSeqId(basTypeLoader);

        if (idleSeqId === -1) {
            continue;
        }

        const idleAnim = addNpcAnimationFrames(npcModelLoader, npcSceneBuf, npcType, idleSeqId);
        let walkAnim = idleAnim;
        if (walkSeqId !== -1 && walkSeqId !== idleSeqId) {
            walkAnim = addNpcAnimationFrames(npcModelLoader, npcSceneBuf, npcType, walkSeqId);
        }

        if (!idleAnim) {
            continue;
        }

        // No pre-baking of combat animations - they are loaded dynamically
        // when the server sends the animation ID (like real OSRS).
        // DynamicNpcAnimLoader handles building animations at render time.
        const template: NpcRenderTemplate = {
            typeId: npcType.id,
            idleAnim,
            walkAnim,
        };

        const extraMovementSeqs = collectNpcPrebakedMovementSeqs(npcType, basTypeLoader);
        if (extraMovementSeqs.length > 0) {
            const extraAnims: NpcRenderExtraAnim[] = [];
            for (const seqId of extraMovementSeqs) {
                const anim = addNpcAnimationFrames(npcModelLoader, npcSceneBuf, npcType, seqId | 0);
                if (!anim) {
                    continue;
                }
                extraAnims.push({
                    seqId: seqId | 0,
                    anim,
                    frameLengths: getSeqFrameLengths(npcModelLoader, seqId | 0),
                });
            }
            if (extraAnims.length > 0) {
                template.extraAnims = extraAnims;
            }
        }

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
) {
    const npcSceneBuf = new SceneBuffer(textureLoader, textureIdIndexMap, 20000);
    const npcRenderBundles = createNpcRenderBundles(
        npcModelLoader,
        basTypeLoader,
        npcSceneBuf,
        npcInstances,
    );
    const npcs = createNpcDatas(npcRenderBundles);
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
            loadObjs,
            loadNpcs,
            smoothTerrain,
            minimizeDrawCalls,
            loadedTextureIds,
            locOverrides,
            extraObjSpawns,
            instance: instanceInput,
            extraLocs: extraLocsInput,
        }: SdMapLoaderInput,
    ): Promise<RenderDataResult<SdMapData | undefined>> {
        console.time(`load map ${mapX},${mapY}`);
        this.init();

        const locTypeLoader = state.locTypeLoader;
        const npcTypeLoader = state.npcTypeLoader;
        const basTypeLoader = state.basTypeLoader;
        const textureLoader = state.textureLoader;

        const locModelLoader = state.locModelLoader;
        const objModelLoader = state.objModelLoader;
        const npcModelLoader = state.npcModelLoader;

        const varManager = state.varManager;

        let textureIds = textureLoader.getTextureIds().filter((id) => textureLoader.isSd(id));
        textureIds = textureIds.slice(0, 2047);
        const textureIdIndexMap = new Map<number, number>();
        for (let i = 0; i < textureIds.length; i++) {
            textureIdIndexMap.set(textureIds[i], i);
        }

        const borderSize = 6;

        const baseX = mapX * Scene.MAP_SQUARE_SIZE - borderSize;
        const baseY = mapY * Scene.MAP_SQUARE_SIZE - borderSize;

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
                    );
                }
            }
        } else {
            state.sceneBuilder.clearLocOverrides();
        }
        const mapSize = Scene.MAP_SQUARE_SIZE + borderSize * 2;

        console.time(`build scene ${mapX},${mapY}`);
        let scene: Scene;
        if (instanceInput) {
            scene = state.sceneBuilder.buildInstanceScene(
                instanceInput.templateChunks,
                baseX,
                baseY,
                mapSize,
                mapSize,
                smoothTerrain,
            );
        } else {
            scene = state.sceneBuilder.buildScene(
                baseX,
                baseY,
                mapSize,
                mapSize,
                smoothTerrain,
            );
        }
        // Inject extra locs (dynamic spawns like boat parts)
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
                        LocLoadType.MODELS,
                    );
                }
            }
        }
        console.timeEnd(`build scene ${mapX},${mapY}`);

        const sceneBuf = new SceneBuffer(textureLoader, textureIdIndexMap, 100000);
        const doorSceneBuf = new SceneBuffer(textureLoader, textureIdIndexMap, 20000);
        sceneBuf.addTerrain(scene, borderSize, maxLevel);

        const sceneLocs = getSceneLocs(locTypeLoader, scene, borderSize, maxLevel);
        const sceneModels: SceneModel[] = [];
        const doorSceneModels: SceneModel[] = [];
        for (const locModel of sceneLocs.locs) {
            const locType = locTypeLoader.load(locModel.interactId);
            if (isDoorLocType(locType)) {
                doorSceneModels.push(locModel);
            } else {
                sceneModels.push(locModel);
            }
        }

        // Create loc animated groups and add transformed locs
        const locAnimatedGroups = addLocEntities(
            state.sceneBuilder.centerLocHeightWithSize,
            locModelLoader,
            varManager,
            scene,
            sceneModels,
            doorSceneModels,
            sceneBuf,
            sceneLocs.locEntities,
        );

        if (loadObjs) {
            const objSpawns = getMapObjSpawns(state.objSpawns, maxLevel, mapX, mapY);
            createObjSceneModels(objModelLoader, sceneModels, scene, borderSize, objSpawns);
            if (extraObjSpawns && extraObjSpawns.length > 0) {
                createObjSceneModels(
                    objModelLoader,
                    sceneModels,
                    scene,
                    borderSize,
                    extraObjSpawns,
                );
            }
        }

        addSceneModels(this.modelHashBuf!, textureLoader, sceneBuf, sceneModels, minimizeDrawCalls);
        addSceneModels(
            this.modelHashBuf!,
            textureLoader,
            doorSceneBuf,
            doorSceneModels,
            minimizeDrawCalls,
        );

        // Animated locs
        const locsAnimated = sceneBuf.addLocAnimatedGroups(locAnimatedGroups);
        console.log(`animated locs: ${locsAnimated.length}`);

        // Npcs

        let npcInstances: NpcInstance[] = [];
        if (loadNpcs) {
            const maxPlane = Math.max(0, maxLevel | 0);
            npcInstances = state.npcInstances.filter((instance) => {
                if ((instance.level | 0) > maxPlane) return false;
                const npcMapX = getMapIndexFromTile(instance.x);
                const npcMapY = getMapIndexFromTile(instance.y);
                return npcMapX === mapX && npcMapY === mapY;
            });
        }
        const { npcSceneBuf, npcs } = buildNpcGeometry(
            npcModelLoader,
            basTypeLoader,
            textureLoader,
            textureIdIndexMap,
            npcInstances,
        );

        // Build per-level CSR mappings of loc IDs per interior tile (64x64 region) at tile origin.
        // We only include object IDs for origins (e.g., loc.startX/startY matches the tile) and direct
        // wall/wallDecoration/floorDecoration anchored at that tile.
        const TILE_SIZE = Scene.MAP_SQUARE_SIZE; // 64
        const interiorMin = borderSize;
        const interiorMaxX = borderSize + TILE_SIZE - 1;
        const interiorMaxY = borderSize + TILE_SIZE - 1;

        const tileLocOffsetsByLevel: Uint32Array[] = new Array(Scene.MAX_LEVELS);
        const tileLocIdsByLevel: Int32Array[] = new Array(Scene.MAX_LEVELS);
        const tileLocTypeRotByLevel: Uint8Array[] = new Array(Scene.MAX_LEVELS);
        const bridgeSurfaceFlags: Uint8Array[][] = new Array(Scene.MAX_LEVELS);

        for (let lvl = 0; lvl < Scene.MAX_LEVELS; lvl++) {
            // First pass: collect arrays per tile, then flatten.
            // Each entry keeps ID + packed modelType/rotation from SceneLoc.flags.
            const perTileIds: number[][] = new Array(TILE_SIZE * TILE_SIZE);
            const perTileTypeRots: number[][] = new Array(TILE_SIZE * TILE_SIZE);
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

        const heightMapTextureData = loadHeightMapTextureData(scene);

        const vertices = sceneBuf.vertexBuf.byteArray();
        const indices = new Int32Array(sceneBuf.indices);
        const doorVertices = doorSceneBuf.vertexBuf.byteArray();
        const doorIndices = new Int32Array(doorSceneBuf.indices);
        const npcVertices = npcSceneBuf.vertexBuf.byteArray();
        const npcIndices = new Int32Array(npcSceneBuf.indices);

        // Generate minimap image; fall back to a tiny transparent PNG when OffscreenCanvas
        // is unavailable in worker contexts (e.g., some iOS Safari versions)
        let minimapBlob: Blob;
        if (typeof OffscreenCanvas !== "undefined") {
            minimapBlob = await loadMinimapBlob(
                state.mapImageRenderer,
                scene,
                0,
                borderSize,
                false,
            );
        } else {
            minimapBlob = transparentPng1x1();
        }

        // Extract minimap icons for dynamic rendering
        // Create MapElementType loader to resolve mapFunctionId -> spriteId
        let mapFunctionToSpriteId: (id: number) => number = () => -1;
        try {
            const configIndex = state.cacheSystem.getIndex(IndexType.DAT2.configs);
            const cacheInfo = state.cache.info;
            if (
                cacheInfo.game === "oldschool" &&
                configIndex.archiveExists(ConfigType.OSRS.mapFunctions)
            ) {
                const mapElementArchive = configIndex.getArchive(ConfigType.OSRS.mapFunctions);
                const melLoader = new ArchiveMapElementTypeLoader(cacheInfo, mapElementArchive);
                // Cache resolved spriteIds to avoid repeated loads
                const spriteIdCache = new Map<number, number>();
                mapFunctionToSpriteId = (mapFuncId: number) => {
                    let spriteId = spriteIdCache.get(mapFuncId);
                    if (spriteId === undefined) {
                        try {
                            const mel = melLoader.load(mapFuncId);
                            spriteId = mel.spriteId;
                        } catch {
                            spriteId = -1;
                        }
                        spriteIdCache.set(mapFuncId, spriteId);
                    }
                    return spriteId;
                };
            }
        } catch (e) {
            console.warn("Failed to load MapElementTypeLoader for minimap icons", e);
        }
        const minimapIcons = extractMinimapIcons(
            scene,
            state.locTypeLoader,
            borderSize,
            mapFunctionToSpriteId,
        );

        const loadedTextures = new Map<number, Int32Array>();
        const usedTextureIds = new Set<number>();
        for (const textureId of sceneBuf.usedTextureIds) {
            if (!loadedTextureIds.has(textureId)) {
                try {
                    const pixels = textureLoader.getPixelsArgb(textureId, 128, true, 1.0);
                    loadedTextures.set(textureId, pixels);
                } catch (e) {
                    console.warn(`SdMapDataLoader: failed to load primary texture ${textureId}`, e);
                }
            }
            usedTextureIds.add(textureId);
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

        console.timeEnd(`load map ${mapX},${mapY}`);

        const transferables = [
            ...scene.tileRenderFlags.flat().map((buf) => buf.buffer),
            ...scene.collisionMaps.map((map) => map.flags.buffer),
            ...Array.from(loadedTextures.values()).map((pixels) => pixels.buffer),

            vertices.buffer,
            indices.buffer,
            doorVertices.buffer,
            doorIndices.buffer,
            npcVertices.buffer,
            npcIndices.buffer,
            heightMapTextureData.buffer,

            modelTextureData.buffer,
            modelTextureDataAlpha.buffer,

            modelTextureDataLod.buffer,
            modelTextureDataLodAlpha.buffer,

            modelTextureDataInteract.buffer,
            modelTextureDataInteractAlpha.buffer,

            modelTextureDataInteractLod.buffer,
            modelTextureDataInteractLodAlpha.buffer,

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
                loadObjs,
                loadNpcs,

                smoothTerrain,

                borderSize,
                tileRenderFlags: scene.tileRenderFlags,
                collisionDatas: scene.collisionMaps,

                minimapBlob,
                minimapIcons,

                vertices,
                indices,
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
