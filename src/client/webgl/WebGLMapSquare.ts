import { mat4, vec2 } from "gl-matrix";
import PicoGL, {
    DrawCall,
    App as PicoApp,
    Program,
    Texture,
    UniformBuffer,
    VertexArray,
    VertexBuffer,
} from "picogl";

import { BasTypeLoader } from "../../rs/config/bastype/BasTypeLoader";
import { NpcTypeLoader } from "../../rs/config/npctype/NpcTypeLoader";
import { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import { getMapIndexFromTile, getMapSquareId } from "../../rs/map/MapFileIndex";
import { SeqFrameLoader } from "../../rs/model/seq/SeqFrameLoader";
import { CollisionMap } from "../../rs/scene/CollisionMap";
import { Scene } from "../../rs/scene/Scene";
import { CollisionFlag } from "../collision/CollisionFlags";
import { NpcEcs } from "../ecs/NpcEcs";
import { AnimationFrames } from "./AnimationFrames";
import { DrawRange, newDrawRange } from "./DrawRange";
import type { GroundItemGeometryBuildData } from "./ground/GroundItemMeshBuilder";
import { NpcGeometryData } from "./loader/NpcGeometryData";
import { SdMapData } from "./loader/SdMapData";
import { LocAnimated } from "./loc/LocAnimated";

const FRAME_RENDER_DELAY = 0;

const NPC_DATA_TEXTURE_BUFFER_SIZE = 5;

type GpuInterleavedBuffer = ReturnType<PicoApp["createInterleavedBuffer"]>;
type GpuIndexBuffer = ReturnType<PicoApp["createIndexBuffer"]>;

function createModelInfoTexture(app: PicoApp, data: Uint16Array): Texture {
    return app.createTexture2D(data, 16, Math.max(Math.ceil(data.length / 16 / 4), 1), {
        internalFormat: PicoGL.RGBA16UI,
        minFilter: PicoGL.NEAREST,
        magFilter: PicoGL.NEAREST,
    });
}

export type DrawCallRange = {
    drawCall: DrawCall;
    drawRanges: DrawRange[];
};

function releaseDrawCallRange(drawCallRange: DrawCallRange | undefined): void {
    if (!drawCallRange) return;
    drawCallRange.drawRanges.length = 0;
}

type DeleteableResource = {
    delete(): void;
};

function logMapSquareFailure(mapX: number, mapY: number, label: string, error: unknown): void {
    console.log("[WebGLMapSquare] Resource operation failed", {
        mapX,
        mapY,
        label,
        error,
    });
}

function runMapSquareAction(mapX: number, mapY: number, label: string, action: () => void): void {
    try {
        action();
    } catch (error) {
        logMapSquareFailure(mapX, mapY, label, error);
    }
}

function deleteMapSquareResource(
    mapX: number,
    mapY: number,
    label: string,
    resource: DeleteableResource | undefined,
): void {
    if (!resource) return;
    runMapSquareAction(mapX, mapY, label, () => resource.delete());
}

function getWorldEntityOverlayMapId(worldViewId: number): number {
    const overlayMapX = 200 + (worldViewId | 0);
    const overlayMapY = 200 + (worldViewId | 0);
    return getMapSquareId(overlayMapX, overlayMapY);
}

function resolveNpcOwnerPlacement(
    currentMapId: number,
    currentMapX: number,
    currentMapY: number,
    renderBaseTileX: number,
    renderBaseTileY: number,
    tileX: number,
    tileY: number,
    size: number,
    worldViewId?: number,
): {
    mapX: number;
    mapY: number;
    tileX: number;
    tileY: number;
    startX: number;
    startY: number;
    usesOverlayWorldView: boolean;
} {
    const normalizedWorldViewId =
        typeof worldViewId === "number" && worldViewId >= 0 ? worldViewId | 0 : -1;
    const overlayMapId =
        normalizedWorldViewId >= 0 ? getWorldEntityOverlayMapId(normalizedWorldViewId) : -1;
    const usesOverlayWorldView = normalizedWorldViewId >= 0 && (currentMapId | 0) === overlayMapId;

    if (usesOverlayWorldView) {
        const worldTileX = (renderBaseTileX + (tileX | 0)) | 0;
        const worldTileY = (renderBaseTileY + (tileY | 0)) | 0;
        const mapX = getMapIndexFromTile(worldTileX);
        const mapY = getMapIndexFromTile(worldTileY);
        const localTileX = worldTileX & (Scene.MAP_SQUARE_SIZE - 1);
        const localTileY = worldTileY & (Scene.MAP_SQUARE_SIZE - 1);
        return {
            mapX,
            mapY,
            tileX: localTileX,
            tileY: localTileY,
            startX: (localTileX * 128 + (size | 0) * 64) | 0,
            startY: (localTileY * 128 + (size | 0) * 64) | 0,
            usesOverlayWorldView: true,
        };
    }

    const localTileX = tileX | 0;
    const localTileY = tileY | 0;
    return {
        mapX: currentMapX | 0,
        mapY: currentMapY | 0,
        tileX: localTileX,
        tileY: localTileY,
        startX: (localTileX * 128 + (size | 0) * 64) | 0,
        startY: (localTileY * 128 + (size | 0) * 64) | 0,
        usesOverlayWorldView: false,
    };
}

type DoorGeometryResources = {
    interleavedBuffer: GpuInterleavedBuffer;
    indexBuffer: GpuIndexBuffer;
    vertexArray: VertexArray;
    modelInfoTexture: Texture;
    modelInfoTextureAlpha: Texture;
    modelInfoTextureLod: Texture;
    modelInfoTextureLodAlpha: Texture;
    modelInfoTextureInteract: Texture;
    modelInfoTextureInteractAlpha: Texture;
    modelInfoTextureInteractLod: Texture;
    modelInfoTextureInteractLodAlpha: Texture;
    drawCall: DrawCallRange;
    drawCallAlpha: DrawCallRange;
    drawCallLod: DrawCallRange;
    drawCallLodAlpha: DrawCallRange;
    drawCallInteract: DrawCallRange;
    drawCallInteractAlpha: DrawCallRange;
    drawCallInteractLod: DrawCallRange;
    drawCallInteractLodAlpha: DrawCallRange;
    planes?: {
        main: Uint8Array;
        alpha: Uint8Array;
        lod: Uint8Array;
        lodAlpha: Uint8Array;
        interact: Uint8Array;
        interactAlpha: Uint8Array;
        interactLod: Uint8Array;
        interactLodAlpha: Uint8Array;
    };
};

type GroundItemGeometryResources = {
    interleavedBuffer: GpuInterleavedBuffer;
    indexBuffer: GpuIndexBuffer;
    vertexArray: VertexArray;
    modelInfoTexture: Texture;
    modelInfoTextureAlpha: Texture;
    modelInfoTextureLod: Texture;
    modelInfoTextureLodAlpha: Texture;
    modelInfoTextureInteract: Texture;
    modelInfoTextureInteractAlpha: Texture;
    modelInfoTextureInteractLod: Texture;
    modelInfoTextureInteractLodAlpha: Texture;
    drawCall: DrawCallRange;
    drawCallAlpha: DrawCallRange;
    drawCallLod: DrawCallRange;
    drawCallLodAlpha: DrawCallRange;
    drawCallInteract: DrawCallRange;
    drawCallInteractAlpha: DrawCallRange;
    drawCallInteractLod: DrawCallRange;
    drawCallInteractLodAlpha: DrawCallRange;
    planes?: {
        main: Uint8Array;
        alpha: Uint8Array;
        lod: Uint8Array;
        lodAlpha: Uint8Array;
        interact: Uint8Array;
        interactAlpha: Uint8Array;
        interactLod: Uint8Array;
        interactLodAlpha: Uint8Array;
    };
};

export class WebGLMapSquare {
    static readonly IDENTITY_MAT4 = mat4.create() as Float32Array;

    readonly id: number;

    npcDataTextureOffsets: number[];
    projectileDataTextureOffsets?: number[];
    playerDataTextureOffsets: number[];
    worldGfxDataTextureOffsets: number[];
    // Dynamic NPC occupancy counters per plane
    private npcOccCounts: Uint16Array[];
    // Dynamic Player occupancy counters per plane
    private playerOccCounts: Uint16Array[];
    // Reusable buffer for getLocIdsAtLocal to avoid per-call allocations
    private locIdsAtLocalBuffer: number[] = [];
    // Reusable buffer for getLocTypeRotsAtLocal to avoid per-call allocations
    private locTypeRotsAtLocalBuffer: number[] = [];
    private door?: DoorGeometryResources;
    private doorDrawRangePlanes?: NonNullable<DoorGeometryResources["planes"]>;
    private groundItems?: GroundItemGeometryResources;
    private groundItemDrawRangePlanes?: NonNullable<GroundItemGeometryResources["planes"]>;

    private npcInterleavedBuffer?: GpuInterleavedBuffer;
    private npcIndexBuffer?: GpuIndexBuffer;
    private npcVertexArray?: VertexArray;
    drawCallNpc?: DrawCallRange;

    npcEntityIds: number[] = [];
    npcIdleFrames: AnimationFrames[] = [];
    npcWalkFrames: (AnimationFrames | undefined)[] = [];
    npcExtraAnims: Array<Record<number, AnimationFrames> | undefined> = [];
    npcExtraFrameLengths: Array<Record<number, number[] | undefined> | undefined> = [];
    npcIdleFrameLengths: number[][] = [];
    npcWalkFrameLengths: (number[] | undefined)[] = [];

    static load(
        seqTypeLoader: SeqTypeLoader,
        seqFrameLoader: SeqFrameLoader,
        npcTypeLoader: NpcTypeLoader,
        basTypeLoader: BasTypeLoader,
        app: PicoApp,
        mainProgram: Program,
        mainAlphaProgram: Program,
        npcProgram: Program,
        textureArray: Texture,
        textureMaterials: Texture,
        sceneUniformBuffer: UniformBuffer,
        mapData: SdMapData,
        time: number,
        clientCycle: number,
        frame: number,
        npcEcs?: NpcEcs,
    ): WebGLMapSquare {
        const { mapX, mapY, borderSize, tileRenderFlags } = mapData;

        const collisionMaps = mapData.collisionDatas.map(CollisionMap.fromData);

        const usedRenderX = mapData.renderPosX ?? mapX;
        const usedRenderY = mapData.renderPosY ?? mapY;
        if (mapData.renderPosX != null) {
            console.log(`[WebGLMapSquare] Using renderPos: (${usedRenderX}, ${usedRenderY}) instead of mapXY (${mapX}, ${mapY})`);
        }
        const mapPos = vec2.fromValues(usedRenderX, usedRenderY);

        const interleavedBuffer = app.createInterleavedBuffer(12, mapData.vertices);
        const indexBuffer = app.createIndexBuffer(PicoGL.UNSIGNED_INT, mapData.indices);

        const vertexArray = app
            .createVertexArray()
            // v0, v1, v2
            .vertexAttributeBuffer(0, interleavedBuffer, {
                type: PicoGL.UNSIGNED_INT,
                size: 3,
                stride: 12,
                integer: true as any,
            })
            .indexBuffer(indexBuffer);

        const modelInfoTexture = createModelInfoTexture(app, mapData.modelTextureData);
        const modelInfoTextureAlpha = createModelInfoTexture(app, mapData.modelTextureDataAlpha);

        const modelInfoTextureLod = createModelInfoTexture(app, mapData.modelTextureDataLod);
        const modelInfoTextureLodAlpha = createModelInfoTexture(
            app,
            mapData.modelTextureDataLodAlpha,
        );

        const modelInfoTextureInteract = createModelInfoTexture(
            app,
            mapData.modelTextureDataInteract,
        );
        const modelInfoTextureInteractAlpha = createModelInfoTexture(
            app,
            mapData.modelTextureDataInteractAlpha,
        );

        const modelInfoTextureInteractLod = createModelInfoTexture(
            app,
            mapData.modelTextureDataInteractLod,
        );
        const modelInfoTextureInteractLodAlpha = createModelInfoTexture(
            app,
            mapData.modelTextureDataInteractLodAlpha,
        );

        const heightMapSize = mapData.heightMapSize ?? (Scene.MAP_SQUARE_SIZE + borderSize * 2);
        const heightMapTexture = app.createTextureArray(
            mapData.heightMapTextureData,
            heightMapSize,
            heightMapSize,
            Scene.MAX_LEVELS,
            {
                internalFormat: PicoGL.R16I,
                minFilter: PicoGL.NEAREST,
                magFilter: PicoGL.NEAREST,
                type: PicoGL.SHORT,
                wrapS: PicoGL.CLAMP_TO_EDGE,
                wrapT: PicoGL.CLAMP_TO_EDGE,
            },
        );

        // const time = performance.now() * 0.001;

        const createDrawCall = (
            program: Program,
            modelInfoTexture: Texture | undefined,
            drawRanges: DrawRange[],
            vertexArrayOverride?: VertexArray,
        ): DrawCallRange => {
            const vao = vertexArrayOverride ?? vertexArray;
            const drawCall = app
                .createDrawCall(program, vao)
                .uniformBlock("SceneUniforms", sceneUniformBuffer)
                .uniform("u_timeLoaded", time)
                .uniform("u_mapPos", mapPos)
                .uniform("u_roofPlaneLimit", 3.0)
                .uniform("u_worldEntityTransform", WebGLMapSquare.IDENTITY_MAT4)
                .uniform("u_worldEntityOpacity", 1.0)
                // .uniform("u_drawIdOffset", drawIdOffset)
                .texture("u_textures", textureArray)
                .texture("u_textureMaterials", textureMaterials)
                .texture("u_heightMap", heightMapTexture)
                .uniform("u_sceneBorderSize", borderSize)
                // .texture("u_modelInfoTexture", modelInfoTexture)
                .drawRanges(...drawRanges);
            if (modelInfoTexture) {
                drawCall.texture("u_modelInfoTexture", modelInfoTexture);
            }
            return {
                drawCall,
                drawRanges,
            };
        };

        const drawCall = createDrawCall(mainProgram, modelInfoTexture, mapData.drawRanges);
        const drawCallAlpha = createDrawCall(
            mainAlphaProgram,
            modelInfoTextureAlpha,
            mapData.drawRangesAlpha,
        );

        const drawCallLod = createDrawCall(mainProgram, modelInfoTextureLod, mapData.drawRangesLod);
        const drawCallLodAlpha = createDrawCall(
            mainAlphaProgram,
            modelInfoTextureLodAlpha,
            mapData.drawRangesLodAlpha,
        );

        const drawCallInteract = createDrawCall(
            mainProgram,
            modelInfoTextureInteract,
            mapData.drawRangesInteract,
        );
        const drawCallInteractAlpha = createDrawCall(
            mainAlphaProgram,
            modelInfoTextureInteractAlpha,
            mapData.drawRangesInteractAlpha,
        );

        const drawCallInteractLod = createDrawCall(
            mainProgram,
            modelInfoTextureInteractLod,
            mapData.drawRangesInteractLod,
        );
        const drawCallInteractLodAlpha = createDrawCall(
            mainAlphaProgram,
            modelInfoTextureInteractLodAlpha,
            mapData.drawRangesInteractLodAlpha,
        );

        let doorResources: DoorGeometryResources | undefined;
        if (mapData.doorVertices.length > 0 && mapData.doorIndices.length > 0) {
            const doorInterleavedBuffer = app.createInterleavedBuffer(12, mapData.doorVertices);
            const doorIndexBuffer = app.createIndexBuffer(PicoGL.UNSIGNED_INT, mapData.doorIndices);
            const doorVertexArray = app
                .createVertexArray()
                .vertexAttributeBuffer(0, doorInterleavedBuffer, {
                    type: PicoGL.UNSIGNED_INT,
                    size: 3,
                    stride: 12,
                    integer: true as any,
                })
                .indexBuffer(doorIndexBuffer);

            const doorModelInfoTexture = createModelInfoTexture(app, mapData.doorModelTextureData);
            const doorModelInfoTextureAlpha = createModelInfoTexture(
                app,
                mapData.doorModelTextureDataAlpha,
            );

            const doorModelInfoTextureLod = createModelInfoTexture(
                app,
                mapData.doorModelTextureDataLod,
            );
            const doorModelInfoTextureLodAlpha = createModelInfoTexture(
                app,
                mapData.doorModelTextureDataLodAlpha,
            );

            const doorModelInfoTextureInteract = createModelInfoTexture(
                app,
                mapData.doorModelTextureDataInteract,
            );
            const doorModelInfoTextureInteractAlpha = createModelInfoTexture(
                app,
                mapData.doorModelTextureDataInteractAlpha,
            );

            const doorModelInfoTextureInteractLod = createModelInfoTexture(
                app,
                mapData.doorModelTextureDataInteractLod,
            );
            const doorModelInfoTextureInteractLodAlpha = createModelInfoTexture(
                app,
                mapData.doorModelTextureDataInteractLodAlpha,
            );

            const doorDrawCall = createDrawCall(
                mainProgram,
                doorModelInfoTexture,
                mapData.doorDrawRanges,
                doorVertexArray,
            );
            const doorDrawCallAlpha = createDrawCall(
                mainAlphaProgram,
                doorModelInfoTextureAlpha,
                mapData.doorDrawRangesAlpha,
                doorVertexArray,
            );
            const doorDrawCallLod = createDrawCall(
                mainProgram,
                doorModelInfoTextureLod,
                mapData.doorDrawRangesLod,
                doorVertexArray,
            );
            const doorDrawCallLodAlpha = createDrawCall(
                mainAlphaProgram,
                doorModelInfoTextureLodAlpha,
                mapData.doorDrawRangesLodAlpha,
                doorVertexArray,
            );
            const doorDrawCallInteract = createDrawCall(
                mainProgram,
                doorModelInfoTextureInteract,
                mapData.doorDrawRangesInteract,
                doorVertexArray,
            );
            const doorDrawCallInteractAlpha = createDrawCall(
                mainAlphaProgram,
                doorModelInfoTextureInteractAlpha,
                mapData.doorDrawRangesInteractAlpha,
                doorVertexArray,
            );
            const doorDrawCallInteractLod = createDrawCall(
                mainProgram,
                doorModelInfoTextureInteractLod,
                mapData.doorDrawRangesInteractLod,
                doorVertexArray,
            );
            const doorDrawCallInteractLodAlpha = createDrawCall(
                mainAlphaProgram,
                doorModelInfoTextureInteractLodAlpha,
                mapData.doorDrawRangesInteractLodAlpha,
                doorVertexArray,
            );

            const doorPlanes =
                mapData.doorDrawRangesPlanes.length > 0
                    ? {
                          main: mapData.doorDrawRangesPlanes,
                          alpha: mapData.doorDrawRangesAlphaPlanes,
                          lod: mapData.doorDrawRangesLodPlanes,
                          lodAlpha: mapData.doorDrawRangesLodAlphaPlanes,
                          interact: mapData.doorDrawRangesInteractPlanes,
                          interactAlpha: mapData.doorDrawRangesInteractAlphaPlanes,
                          interactLod: mapData.doorDrawRangesInteractLodPlanes,
                          interactLodAlpha: mapData.doorDrawRangesInteractLodAlphaPlanes,
                      }
                    : undefined;

            doorResources = {
                interleavedBuffer: doorInterleavedBuffer,
                indexBuffer: doorIndexBuffer,
                vertexArray: doorVertexArray,
                modelInfoTexture: doorModelInfoTexture,
                modelInfoTextureAlpha: doorModelInfoTextureAlpha,
                modelInfoTextureLod: doorModelInfoTextureLod,
                modelInfoTextureLodAlpha: doorModelInfoTextureLodAlpha,
                modelInfoTextureInteract: doorModelInfoTextureInteract,
                modelInfoTextureInteractAlpha: doorModelInfoTextureInteractAlpha,
                modelInfoTextureInteractLod: doorModelInfoTextureInteractLod,
                modelInfoTextureInteractLodAlpha: doorModelInfoTextureInteractLodAlpha,
                drawCall: doorDrawCall,
                drawCallAlpha: doorDrawCallAlpha,
                drawCallLod: doorDrawCallLod,
                drawCallLodAlpha: doorDrawCallLodAlpha,
                drawCallInteract: doorDrawCallInteract,
                drawCallInteractAlpha: doorDrawCallInteractAlpha,
                drawCallInteractLod: doorDrawCallInteractLod,
                drawCallInteractLodAlpha: doorDrawCallInteractLodAlpha,
                planes: doorPlanes,
            };
        }

        let npcInterleavedBuffer: GpuInterleavedBuffer | undefined;
        let npcIndexBuffer: GpuIndexBuffer | undefined;
        let npcVertexArray: VertexArray | undefined;

        if (mapData.npcVertices.length > 0 && mapData.npcIndices.length > 0) {
            npcInterleavedBuffer = app.createInterleavedBuffer(12, mapData.npcVertices);
            npcIndexBuffer = app.createIndexBuffer(PicoGL.UNSIGNED_INT, mapData.npcIndices);
            npcVertexArray = app
                .createVertexArray()
                .vertexAttributeBuffer(0, npcInterleavedBuffer, {
                    type: PicoGL.UNSIGNED_INT,
                    size: 3,
                    stride: 12,
                    integer: true as any,
                })
                .indexBuffer(npcIndexBuffer);
        }

        // OSRS parity: DynamicObject/loc animations are driven by Client.cycle (20ms).
        const cycle = clientCycle | 0;

        const locsAnimated: LocAnimated[] = [];
        for (const loc of mapData.locsAnimated) {
            const seqType = seqTypeLoader.load(loc.seqId);
            locsAnimated.push(
                new LocAnimated(
                    loc.drawRangeIndex,
                    loc.drawRangeAlphaIndex,

                    loc.drawRangeLodIndex,
                    loc.drawRangeLodAlphaIndex,

                    loc.drawRangeInteractIndex,
                    loc.drawRangeInteractAlphaIndex,

                    loc.drawRangeInteractLodIndex,
                    loc.drawRangeInteractLodAlphaIndex,

                    loc.anim,
                    seqType,
                    cycle,
                    loc.randomStart,

                    // Position and ID for ambient sounds
                    loc.locId,
                    loc.x,
                    loc.y,
                    loc.level,
                    loc.rotation,
                ),
            );
        }

        const npcEntityIds: number[] = [];
        const npcIdleFrames: AnimationFrames[] = [];
        const npcWalkFrames: (AnimationFrames | undefined)[] = [];
        const npcExtraAnims: (Record<number, AnimationFrames> | undefined)[] = [];
        const npcExtraFrameLengths: (Record<number, number[] | undefined> | undefined)[] = [];
        const npcIdleFrameLengths: number[][] = [];
        const npcWalkFrameLengths: (number[] | undefined)[] = [];
        const currentMapId = getMapSquareId(mapX, mapY) | 0;
        const renderBaseTileX = Math.floor(usedRenderX * Scene.MAP_SQUARE_SIZE);
        const renderBaseTileY = Math.floor(usedRenderY * Scene.MAP_SQUARE_SIZE);
        for (const npc of mapData.npcs) {
            const npcType = npcTypeLoader.load(npc.id);
            npcIdleFrames.push(npc.idleAnim);
            npcWalkFrames.push(npc.walkAnim);
            // Build per-frame durations based on SeqType frameLengths (or skeletal: 1 per frame)
            const idleSeqId = npcType.getIdleSeqId(basTypeLoader);
            let idleLens: number[] = new Array(npc.idleAnim.frames.length).fill(1);
            if (idleSeqId !== -1) {
                const seq = seqTypeLoader.load(idleSeqId);
                if (seq.isSkeletalSeq()) {
                    // already baked per-timestep
                    idleLens.fill(1);
                } else {
                    for (let i = 0; i < idleLens.length; i++) {
                        idleLens[i] = seq.getFrameLength(seqFrameLoader, i) | 0;
                    }
                }
            }
            npcIdleFrameLengths.push(idleLens);

            const walkSeqId = npcType.getWalkSeqId(basTypeLoader);
            if (npc.walkAnim) {
                let walkLens: number[] = new Array(npc.walkAnim.frames.length).fill(1);
                if (walkSeqId !== -1) {
                    const seqW = seqTypeLoader.load(walkSeqId);
                    if (seqW.isSkeletalSeq()) {
                        walkLens.fill(1);
                    } else {
                        for (let i = 0; i < walkLens.length; i++) {
                            walkLens[i] = seqW.getFrameLength(seqFrameLoader, i) | 0;
                        }
                    }
                }
                npcWalkFrameLengths.push(walkLens);
            } else {
                npcWalkFrameLengths.push(undefined);
            }
            if (npc.extraAnims && npc.extraAnims.length > 0) {
                const extraAnimMap: Record<number, AnimationFrames> = {};
                const extraLenMap: Record<number, number[] | undefined> = {};
                for (const extra of npc.extraAnims) {
                    extraAnimMap[extra.seqId] = extra.anim;
                    extraLenMap[extra.seqId] = extra.frameLengths.slice();
                }
                npcExtraAnims.push(extraAnimMap);
                npcExtraFrameLengths.push(extraLenMap);
            } else {
                npcExtraAnims.push(undefined);
                npcExtraFrameLengths.push(undefined);
            }
            if (npcEcs) {
                runMapSquareAction(mapX, mapY, "npcEcs.createNpc.initial", () => {
                    const npcWorldViewId =
                        typeof npc.worldViewId === "number" ? npc.worldViewId | 0 : -1;
                    const serverIdRaw =
                        typeof npc.serverId === "number" ? npc.serverId | 0 : undefined;
                    const placement = resolveNpcOwnerPlacement(
                        currentMapId,
                        mapX,
                        mapY,
                        renderBaseTileX,
                        renderBaseTileY,
                        npc.tileX | 0,
                        npc.tileY | 0,
                        npcType.size | 0,
                        npcWorldViewId,
                    );
                    let ecsId = 0;
                    if (serverIdRaw !== undefined && serverIdRaw > 0) {
                        const mapped = npcEcs.getEcsIdForServer(serverIdRaw | 0);
                        if (mapped !== undefined && npcEcs.isActive(mapped | 0)) {
                            const ownerMapId = getMapSquareId(placement.mapX, placement.mapY) | 0;
                            const mappedMapId = npcEcs.getMapId(mapped | 0) | 0;
                            if ((mappedMapId | 0) !== (ownerMapId | 0)) {
                                npcEcs.rebaseToMapSquare(mapped | 0, placement.mapX, placement.mapY);
                            }
                            ecsId = mapped | 0;
                        }
                    }
                    if (ecsId === 0) {
                        ecsId = npcEcs.createNpc(
                            placement.mapX,
                            placement.mapY,
                            npcType.id | 0,
                            npcType.size | 0,
                            placement.startX,
                            placement.startY,
                            npc.level | 0,
                            0,
                            placement.tileX,
                            placement.tileY,
                            (npcType.rotationSpeed | 0) as number,
                        );
                    }
                    if (npcWorldViewId >= 0) {
                        npcEcs.setWorldViewId(ecsId, npcWorldViewId);
                    }
                    if (serverIdRaw !== undefined && serverIdRaw > 0) {
                        if ((npcEcs.getServerId(ecsId) | 0) !== (serverIdRaw | 0)) {
                            npcEcs.setServerMapping(ecsId, serverIdRaw | 0);
                        }
                    }
                    npcEntityIds.push(ecsId);
                });
            }
        }

        // Initial collision flagging at spawn positions (ECS-only)
        const occInit: { plane: number; x: number; y: number }[] = [];
        for (let idx = 0; idx < mapData.npcs.length; idx++) {
            const npc = mapData.npcs[idx];
            const npcType = npcTypeLoader.load(npc.id);
            const size = npcType.size | 0;
            const tileX = npc.tileX | 0;
            const tileY = npc.tileY | 0;
            // Effective plane considering bridge flag
            let plane = npc.level | 0;
            if (
                plane < 3 &&
                (tileRenderFlags[1][tileX + borderSize][tileY + borderSize] & 0x2) === 2
            ) {
                plane++;
            }
            const cm = collisionMaps[plane];
            for (let fx = tileX; fx < tileX + size; fx++) {
                for (let fy = tileY; fy < tileY + size; fy++) {
                    cm.flag(fx + borderSize, fy + borderSize, CollisionFlag.BLOCK_NPCS);
                    occInit.push({ plane, x: fx, y: fy });
                }
            }
        }

        const hasNpcGeometry = mapData.npcs.length > 0;
        const drawRangesNpc = hasNpcGeometry
            ? new Array(mapData.npcs.length).fill(0).map(() => newDrawRange(0, 0, 1))
            : [];

        const drawCallNpc =
            hasNpcGeometry && npcVertexArray
                ? createDrawCall(npcProgram, undefined, drawRangesNpc, npcVertexArray)
                : undefined;

        const planes = {
            main: mapData.drawRangesPlanes,
            alpha: mapData.drawRangesAlphaPlanes,
            lod: mapData.drawRangesLodPlanes,
            lodAlpha: mapData.drawRangesLodAlphaPlanes,
            interact: mapData.drawRangesInteractPlanes,
            interactAlpha: mapData.drawRangesInteractAlphaPlanes,
            interactLod: mapData.drawRangesInteractLodPlanes,
            interactLodAlpha: mapData.drawRangesInteractLodAlphaPlanes,
        } as const;

        const mapSquare = new WebGLMapSquare(
            mapX,
            mapY,
            usedRenderX,
            usedRenderY,

            borderSize,
            tileRenderFlags,
            mapData.bridgeSurfaceFlags,
            collisionMaps,

            time,
            frame,

            interleavedBuffer,
            indexBuffer,
            vertexArray,

            heightMapTexture,

            modelInfoTexture,
            modelInfoTextureAlpha,

            modelInfoTextureLod,
            modelInfoTextureLodAlpha,

            modelInfoTextureInteract,
            modelInfoTextureInteractAlpha,

            modelInfoTextureInteractLod,
            modelInfoTextureInteractLodAlpha,

            drawCall,
            drawCallAlpha,

            drawCallLod,
            drawCallLodAlpha,

            drawCallInteract,
            drawCallInteractAlpha,

            drawCallInteractLod,
            drawCallInteractLodAlpha,
            doorResources,

            npcInterleavedBuffer,
            npcIndexBuffer,
            npcVertexArray,
            drawCallNpc,

            locsAnimated,
            npcEntityIds,
            npcIdleFrames,
            npcWalkFrames,
            npcExtraAnims,
            npcExtraFrameLengths,
            npcIdleFrameLengths,
            npcWalkFrameLengths,

            mapData.heightMapTextureData,
            heightMapSize,
            npcEcs,
            planes,
            mapData.tileLocOffsetsByLevel,
            mapData.tileLocIdsByLevel,
            mapData.tileLocTypeRotByLevel,
        );
        // Initialize occupancy counters to match initial flags
        for (const c of occInit) {
            mapSquare.incNpcOcc(c.plane, c.x, c.y);
        }
        return mapSquare;
    }

    constructor(
        readonly mapX: number,
        readonly mapY: number,
        readonly renderPosX: number,
        readonly renderPosY: number,

        readonly borderSize: number,
        readonly tileRenderFlags: Uint8Array[][],
        readonly bridgeSurfaceFlags: Uint8Array[][] | undefined,
        public collisionMaps: CollisionMap[],

        readonly timeLoaded: number,
        readonly frameLoaded: number,

        public interleavedBuffer: VertexBuffer,
        public indexBuffer: VertexBuffer,
        public vertexArray: VertexArray,

        readonly heightMapTexture: Texture,

        // Model info
        public modelInfoTexture: Texture,
        public modelInfoTextureAlpha: Texture,

        public modelInfoTextureLod: Texture,
        public modelInfoTextureLodAlpha: Texture,

        public modelInfoTextureInteract: Texture,
        public modelInfoTextureInteractAlpha: Texture,

        public modelInfoTextureInteractLod: Texture,
        public modelInfoTextureInteractLodAlpha: Texture,

        // Draw calls
        public drawCall: DrawCallRange,
        public drawCallAlpha: DrawCallRange,

        public drawCallLod: DrawCallRange,
        public drawCallLodAlpha: DrawCallRange,

        public drawCallInteract: DrawCallRange,
        public drawCallInteractAlpha: DrawCallRange,

        public drawCallInteractLod: DrawCallRange,
        public drawCallInteractLodAlpha: DrawCallRange,
        door: DoorGeometryResources | undefined,

        npcInterleavedBuffer: GpuInterleavedBuffer | undefined,
        npcIndexBuffer: GpuIndexBuffer | undefined,
        npcVertexArray: VertexArray | undefined,
        drawCallNpc: DrawCallRange | undefined,

        // Animated locs
        public locsAnimated: LocAnimated[],

        // ECS entity ids corresponding to spawns for this map
        npcEntityIds: number[],
        // Per-NPC anim frames (idle/walk) aligned with npcEntityIds index
        npcIdleFrames: AnimationFrames[],
        npcWalkFrames: (AnimationFrames | undefined)[],
        npcExtraAnims: Array<Record<number, AnimationFrames> | undefined>,
        npcExtraFrameLengths: Array<Record<number, number[] | undefined> | undefined>,
        // Per-NPC per-frame lengths (ticks) aligned with the above
        npcIdleFrameLengths: number[][],
        npcWalkFrameLengths: (number[] | undefined)[],
        // CPU-side height map copy
        readonly heightMapData: Int16Array,
        readonly heightMapSize: number,
        private readonly _npcEcs?: NpcEcs,
        public drawRangePlanes?: {
            main: Uint8Array;
            alpha: Uint8Array;
            lod: Uint8Array;
            lodAlpha: Uint8Array;
            interact: Uint8Array;
            interactAlpha: Uint8Array;
            interactLod: Uint8Array;
            interactLodAlpha: Uint8Array;
        },
        // Per-level CSR mapping of interior 64x64 tiles to loc IDs
        public tileLocOffsetsByLevel?: Uint32Array[],
        public tileLocIdsByLevel?: Int32Array[],
        public tileLocTypeRotByLevel?: Uint8Array[],
    ) {
        this.id = getMapSquareId(mapX, mapY);
        this.npcDataTextureOffsets = new Array(NPC_DATA_TEXTURE_BUFFER_SIZE).fill(-1);
        this.playerDataTextureOffsets = new Array(NPC_DATA_TEXTURE_BUFFER_SIZE).fill(-1);
        this.worldGfxDataTextureOffsets = new Array(NPC_DATA_TEXTURE_BUFFER_SIZE).fill(-1);
        this.npcInterleavedBuffer = npcInterleavedBuffer;
        this.npcIndexBuffer = npcIndexBuffer;
        this.npcVertexArray = npcVertexArray;
        this.drawCallNpc = drawCallNpc;
        this.door = door;
        if (door?.planes) {
            this.doorDrawRangePlanes = door.planes;
        }
        this.npcEntityIds = npcEntityIds;
        this.npcIdleFrames = npcIdleFrames;
        this.npcWalkFrames = npcWalkFrames;
        this.npcExtraAnims = npcExtraAnims;
        this.npcExtraFrameLengths = npcExtraFrameLengths;
        this.npcIdleFrameLengths = npcIdleFrameLengths;
        this.npcWalkFrameLengths = npcWalkFrameLengths;
        // Initialize per-plane occupancy counters aligned to collision map dimensions
        this.npcOccCounts = new Array(this.collisionMaps.length);
        this.playerOccCounts = new Array(this.collisionMaps.length);
        for (let p = 0; p < this.collisionMaps.length; p++) {
            const cm = this.collisionMaps[p];
            this.npcOccCounts[p] = new Uint16Array(cm.sizeX * cm.sizeY);
            this.playerOccCounts[p] = new Uint16Array(cm.sizeX * cm.sizeY);
        }
    }

    canRender(frameCount: number): boolean {
        return frameCount - this.frameLoaded >= FRAME_RENDER_DELAY;
    }

    getRenderBaseWorldX(): number {
        return this.renderPosX * Scene.MAP_SQUARE_SIZE;
    }

    getRenderBaseWorldY(): number {
        return this.renderPosY * Scene.MAP_SQUARE_SIZE;
    }

    getRenderBaseTileX(): number {
        return Math.floor(this.getRenderBaseWorldX());
    }

    getRenderBaseTileY(): number {
        return Math.floor(this.getRenderBaseWorldY());
    }

    getLocalTileSpan(): number {
        return Math.max(0, (this.heightMapSize | 0) - ((this.borderSize | 0) * 2));
    }

    getTileRenderFlag(level: number, tileX: number, tileY: number): number {
        return this.tileRenderFlags[level][tileX + this.borderSize][tileY + this.borderSize];
    }

    isBridgeSurface(level: number, tileX: number, tileY: number): boolean {
        const flags = this.bridgeSurfaceFlags?.[level];
        if (!flags) return false;
        const column = flags[tileX + this.borderSize];
        if (!column) return false;
        return column[tileY + this.borderSize] !== 0;
    }

    getMapDistance(mapX: number, mapY: number): number {
        return Math.max(Math.abs(mapX - this.mapX), Math.abs(mapY - this.mapY));
    }

    getDrawCall(isAlpha: boolean, isInteract: boolean, isLod: boolean): DrawCallRange {
        if (isInteract) {
            if (isLod) {
                return isAlpha ? this.drawCallInteractLodAlpha : this.drawCallInteractLod;
            } else {
                return isAlpha ? this.drawCallInteractAlpha : this.drawCallInteract;
            }
        } else {
            if (isLod) {
                return isAlpha ? this.drawCallLodAlpha : this.drawCallLod;
            } else {
                return isAlpha ? this.drawCallAlpha : this.drawCall;
            }
        }
    }

    getDoorDrawCall(
        isAlpha: boolean,
        isInteract: boolean,
        isLod: boolean,
    ): DrawCallRange | undefined {
        if (!this.door) return undefined;
        if (isInteract) {
            if (isLod) {
                return isAlpha ? this.door.drawCallInteractLodAlpha : this.door.drawCallInteractLod;
            }
            return isAlpha ? this.door.drawCallInteractAlpha : this.door.drawCallInteract;
        }
        if (isLod) {
            return isAlpha ? this.door.drawCallLodAlpha : this.door.drawCallLod;
        }
        return isAlpha ? this.door.drawCallAlpha : this.door.drawCall;
    }

    getDrawRangesPlanes(
        isAlpha: boolean,
        isInteract: boolean,
        isLod: boolean,
    ): Uint8Array | undefined {
        const p = this.drawRangePlanes;
        if (!p) return undefined;
        if (isInteract) {
            if (isLod) return isAlpha ? p.interactLodAlpha : p.interactLod;
            return isAlpha ? p.interactAlpha : p.interact;
        } else {
            if (isLod) return isAlpha ? p.lodAlpha : p.lod;
            return isAlpha ? p.alpha : p.main;
        }
    }

    getDoorDrawRangesPlanes(
        isAlpha: boolean,
        isInteract: boolean,
        isLod: boolean,
    ): Uint8Array | undefined {
        const p = this.doorDrawRangePlanes;
        if (!p) return undefined;
        if (isInteract) {
            if (isLod) return isAlpha ? p.interactLodAlpha : p.interactLod;
            return isAlpha ? p.interactAlpha : p.interact;
        } else {
            if (isLod) return isAlpha ? p.lodAlpha : p.lod;
            return isAlpha ? p.alpha : p.main;
        }
    }

    getGroundItemDrawCall(
        isAlpha: boolean,
        isInteract: boolean,
        isLod: boolean,
    ): DrawCallRange | undefined {
        if (!this.groundItems) return undefined;
        const batch = this.groundItems;
        if (isInteract) {
            if (isLod) {
                return isAlpha ? batch.drawCallInteractLodAlpha : batch.drawCallInteractLod;
            }
            return isAlpha ? batch.drawCallInteractAlpha : batch.drawCallInteract;
        } else {
            if (isLod) {
                return isAlpha ? batch.drawCallLodAlpha : batch.drawCallLod;
            }
            return isAlpha ? batch.drawCallAlpha : batch.drawCall;
        }
    }

    getGroundItemDrawRangesPlanes(
        isAlpha: boolean,
        isInteract: boolean,
        isLod: boolean,
    ): Uint8Array | undefined {
        const p = this.groundItemDrawRangePlanes;
        if (!p) return undefined;
        if (isInteract) {
            if (isLod) return isAlpha ? p.interactLodAlpha : p.interactLod;
            return isAlpha ? p.interactAlpha : p.interact;
        }
        if (isLod) return isAlpha ? p.lodAlpha : p.lod;
        return isAlpha ? p.alpha : p.main;
    }

    // Collision flags at local map tile (0..63) including border offset
    getCollisionFlag(level: number, tileX: number, tileY: number): number {
        const cm = this.collisionMaps[level];
        const x = tileX + this.borderSize;
        const y = tileY + this.borderSize;
        if (!cm.isWithinBounds(x, y)) return 0;
        return cm.getFlag(x, y) | 0;
    }

    delete() {
        runMapSquareAction(
            this.mapX,
            this.mapY,
            "npcEcs.destroyNpcsForMap",
            () => this._npcEcs?.destroyNpcsForMap(this.mapX, this.mapY),
        );
        releaseDrawCallRange(this.drawCall);
        releaseDrawCallRange(this.drawCallAlpha);
        releaseDrawCallRange(this.drawCallLod);
        releaseDrawCallRange(this.drawCallLodAlpha);
        releaseDrawCallRange(this.drawCallInteract);
        releaseDrawCallRange(this.drawCallInteractAlpha);
        releaseDrawCallRange(this.drawCallInteractLod);
        releaseDrawCallRange(this.drawCallInteractLodAlpha);
        releaseDrawCallRange(this.drawCallNpc);
        this.vertexArray.delete();
        this.interleavedBuffer.delete();
        this.indexBuffer.delete();
        this.npcVertexArray?.delete();
        this.npcInterleavedBuffer?.delete();
        this.npcIndexBuffer?.delete();

        this.heightMapTexture.delete();

        // Model info
        this.modelInfoTexture.delete();
        this.modelInfoTextureAlpha.delete();

        this.modelInfoTextureLod.delete();
        this.modelInfoTextureLodAlpha.delete();

        this.modelInfoTextureInteract.delete();
        this.modelInfoTextureInteractAlpha.delete();

        this.modelInfoTextureInteractLod.delete();
        this.modelInfoTextureInteractLodAlpha.delete();

        this.clearGroundItemGeometry();

        const door = this.door;
        if (door) {
            releaseDrawCallRange(door.drawCall);
            releaseDrawCallRange(door.drawCallAlpha);
            releaseDrawCallRange(door.drawCallLod);
            releaseDrawCallRange(door.drawCallLodAlpha);
            releaseDrawCallRange(door.drawCallInteract);
            releaseDrawCallRange(door.drawCallInteractAlpha);
            releaseDrawCallRange(door.drawCallInteractLod);
            releaseDrawCallRange(door.drawCallInteractLodAlpha);
            deleteMapSquareResource(this.mapX, this.mapY, "door.vertexArray", door.vertexArray);
            deleteMapSquareResource(
                this.mapX,
                this.mapY,
                "door.interleavedBuffer",
                door.interleavedBuffer,
            );
            deleteMapSquareResource(this.mapX, this.mapY, "door.indexBuffer", door.indexBuffer);
            door.modelInfoTexture.delete();
            door.modelInfoTextureAlpha.delete();
            door.modelInfoTextureLod.delete();
            door.modelInfoTextureLodAlpha.delete();
            door.modelInfoTextureInteract.delete();
            door.modelInfoTextureInteractAlpha.delete();
            door.modelInfoTextureInteractLod.delete();
            door.modelInfoTextureInteractLodAlpha.delete();
            this.door = undefined;
            this.doorDrawRangePlanes = undefined;
        }
    }

    // Increment/decrement NPC occupancy at local map tile coordinates (0..63), bridge-aware plane provided by caller.
    incNpcOcc(plane: number, tileX: number, tileY: number): void {
        const cm = this.collisionMaps[plane];
        const x = tileX + this.borderSize;
        const y = tileY + this.borderSize;
        if (!cm.isWithinBounds(x, y)) return;
        const idx = x + y * cm.sizeX;
        const counts = this.npcOccCounts[plane];
        const prev = counts[idx] | 0;
        counts[idx] = (prev + 1) as any;
        if (prev === 0) {
            cm.flag(x, y, CollisionFlag.BLOCK_NPCS);
        }
    }
    decNpcOcc(plane: number, tileX: number, tileY: number): void {
        const cm = this.collisionMaps[plane];
        const x = tileX + this.borderSize;
        const y = tileY + this.borderSize;
        if (!cm.isWithinBounds(x, y)) return;
        const idx = x + y * cm.sizeX;
        const counts = this.npcOccCounts[plane];
        const prev = counts[idx] | 0;
        if (prev <= 0) return;
        const next = prev - 1;
        counts[idx] = next as any;
        if (next === 0) {
            cm.unflag(x, y, CollisionFlag.BLOCK_NPCS);
        }
    }

    incPlayerOcc(plane: number, tileX: number, tileY: number): void {
        const cm = this.collisionMaps[plane];
        const x = tileX + this.borderSize;
        const y = tileY + this.borderSize;
        if (!cm.isWithinBounds(x, y)) return;
        const idx = x + y * cm.sizeX;
        const counts = this.playerOccCounts[plane];
        const prev = counts[idx] | 0;
        counts[idx] = (prev + 1) as any;
        if (prev === 0) {
            cm.flag(x, y, CollisionFlag.BLOCK_PLAYERS);
        }
    }
    decPlayerOcc(plane: number, tileX: number, tileY: number): void {
        const cm = this.collisionMaps[plane];
        const x = tileX + this.borderSize;
        const y = tileY + this.borderSize;
        if (!cm.isWithinBounds(x, y)) return;
        const idx = x + y * cm.sizeX;
        const counts = this.playerOccCounts[plane];
        const prev = counts[idx] | 0;
        if (prev <= 0) return;
        const next = prev - 1;
        counts[idx] = next as any;
        if (next === 0) {
            cm.unflag(x, y, CollisionFlag.BLOCK_PLAYERS);
        }
    }

    refreshNpcGeometry(
        app: PicoApp,
        npcProgram: Program,
        textureArray: Texture,
        textureMaterials: Texture,
        sceneUniformBuffer: UniformBuffer,
        seqTypeLoader: SeqTypeLoader,
        seqFrameLoader: SeqFrameLoader,
        npcTypeLoader: NpcTypeLoader,
        basTypeLoader: BasTypeLoader,
        npcGeometry: NpcGeometryData,
    ): void {
        if (npcGeometry.mapX !== this.mapX || npcGeometry.mapY !== this.mapY) {
            console.warn("[WebGLMapSquare] NPC geometry map mismatch", npcGeometry);
            return;
        }

        releaseDrawCallRange(this.drawCallNpc);
        deleteMapSquareResource(this.mapX, this.mapY, "npc.vertexArray", this.npcVertexArray);
        deleteMapSquareResource(
            this.mapX,
            this.mapY,
            "npc.interleavedBuffer",
            this.npcInterleavedBuffer,
        );
        deleteMapSquareResource(this.mapX, this.mapY, "npc.indexBuffer", this.npcIndexBuffer);

        for (let plane = 0; plane < this.npcOccCounts.length; plane++) {
            const cm = this.collisionMaps[plane];
            const counts = this.npcOccCounts[plane];
            for (let idx = 0; idx < counts.length; idx++) {
                if (counts[idx] > 0) {
                    const x = idx % cm.sizeX;
                    const y = Math.floor(idx / cm.sizeX);
                    cm.unflag(x, y, CollisionFlag.BLOCK_NPCS);
                }
                counts[idx] = 0;
            }
        }

        this.npcDataTextureOffsets.fill(-1);

        const existingEcsIds = new Set<number>();
        const npcEcs = this._npcEcs;
        if (npcEcs) {
            for (const id of this.npcEntityIds) {
                if (id > 0 && npcEcs.isActive(id)) {
                    existingEcsIds.add(id);
                }
            }
        }

        if (npcGeometry.vertices.length > 0 && npcGeometry.indices.length > 0) {
            this.npcInterleavedBuffer = app.createInterleavedBuffer(12, npcGeometry.vertices);
            this.npcIndexBuffer = app.createIndexBuffer(PicoGL.UNSIGNED_INT, npcGeometry.indices);
            this.npcVertexArray = app
                .createVertexArray()
                .vertexAttributeBuffer(0, this.npcInterleavedBuffer, {
                    type: PicoGL.UNSIGNED_INT,
                    size: 3,
                    stride: 12,
                    integer: true as any,
                })
                .indexBuffer(this.npcIndexBuffer);

            const drawRangesNpc = new Array(npcGeometry.npcs.length)
                .fill(0)
                .map(() => newDrawRange(0, 0, 1));

            const mapPos = vec2.fromValues(this.renderPosX, this.renderPosY);
            const drawCall = app
                .createDrawCall(npcProgram, this.npcVertexArray)
                .uniformBlock("SceneUniforms", sceneUniformBuffer)
                .uniform("u_timeLoaded", this.timeLoaded)
                .uniform("u_mapPos", mapPos)
                .uniform("u_worldEntityTransform", WebGLMapSquare.IDENTITY_MAT4)
                .uniform("u_worldEntityOpacity", 1.0)
                .texture("u_textures", textureArray)
                .texture("u_textureMaterials", textureMaterials)
                .texture("u_heightMap", this.heightMapTexture)
                .uniform("u_sceneBorderSize", this.borderSize)
                .drawRanges(...drawRangesNpc);

            this.drawCallNpc = { drawCall, drawRanges: drawRangesNpc };
        } else {
            this.npcInterleavedBuffer = undefined;
            this.npcIndexBuffer = undefined;
            this.npcVertexArray = undefined;
            this.drawCallNpc = undefined;
        }

        const newNpcEntityIds: number[] = [];
        const reusedIds = new Set<number>();
        this.npcIdleFrames = [];
        this.npcWalkFrames = [];
        this.npcExtraAnims = [];
        this.npcExtraFrameLengths = [];
        this.npcIdleFrameLengths = [];
        this.npcWalkFrameLengths = [];

        const borderSize = this.borderSize;

        for (const npc of npcGeometry.npcs) {
            const npcType = npcTypeLoader.load(npc.id);
            this.npcIdleFrames.push(npc.idleAnim);
            this.npcWalkFrames.push(npc.walkAnim);

            const idleSeqId = npcType.getIdleSeqId(basTypeLoader);
            let idleLens: number[] = new Array(npc.idleAnim.frames.length).fill(1);
            if (idleSeqId !== -1) {
                const seq = seqTypeLoader.load(idleSeqId);
                if (seq.isSkeletalSeq()) {
                    idleLens.fill(1);
                } else {
                    for (let i = 0; i < idleLens.length; i++) {
                        idleLens[i] = seq.getFrameLength(seqFrameLoader, i) | 0;
                    }
                }
            }
            this.npcIdleFrameLengths.push(idleLens);

            const walkSeqId = npcType.getWalkSeqId(basTypeLoader);
            if (npc.walkAnim) {
                let walkLens: number[] = new Array(npc.walkAnim.frames.length).fill(1);
                if (walkSeqId !== -1) {
                    const seqW = seqTypeLoader.load(walkSeqId);
                    if (seqW.isSkeletalSeq()) {
                        walkLens.fill(1);
                    } else {
                        for (let i = 0; i < walkLens.length; i++) {
                            walkLens[i] = seqW.getFrameLength(seqFrameLoader, i) | 0;
                        }
                    }
                }
                this.npcWalkFrameLengths.push(walkLens);
            } else {
                this.npcWalkFrameLengths.push(undefined);
            }

            if (npc.extraAnims && npc.extraAnims.length > 0) {
                const extraAnimMap: Record<number, AnimationFrames> = {};
                const extraLenMap: Record<number, number[] | undefined> = {};
                for (const extra of npc.extraAnims) {
                    extraAnimMap[extra.seqId] = extra.anim;
                    extraLenMap[extra.seqId] = extra.frameLengths.slice();
                }
                this.npcExtraAnims.push(extraAnimMap);
                this.npcExtraFrameLengths.push(extraLenMap);
            } else {
                this.npcExtraAnims.push(undefined);
                this.npcExtraFrameLengths.push(undefined);
            }

            const tileX = npc.tileX | 0;
            const tileY = npc.tileY | 0;
            let plane = npc.level | 0;
            if (
                plane < 3 &&
                (this.tileRenderFlags[1][tileX + borderSize][tileY + borderSize] & 0x2) === 2
            ) {
                plane++;
            }

            const size = npcType.size | 0;
            for (let fx = tileX; fx < tileX + size; fx++) {
                for (let fy = tileY; fy < tileY + size; fy++) {
                    this.incNpcOcc(plane, fx, fy);
                }
            }

            let ecsId = 0;
            if (npcEcs) {
                const serverIdRaw =
                    typeof npc.serverId === "number"
                        ? npc.serverId | 0
                        : undefined;
                const npcWorldViewId =
                    typeof npc.worldViewId === "number"
                        ? npc.worldViewId | 0
                        : -1;
                const placement = resolveNpcOwnerPlacement(
                    getMapSquareId(this.mapX, this.mapY) | 0,
                    this.mapX,
                    this.mapY,
                    this.getRenderBaseTileX(),
                    this.getRenderBaseTileY(),
                    tileX,
                    tileY,
                    npcType.size | 0,
                    npcWorldViewId,
                );
                if (serverIdRaw !== undefined && serverIdRaw > 0) {
                    const mapped = npcEcs.getEcsIdForServer(serverIdRaw | 0);
                    if (mapped !== undefined && npcEcs.isActive(mapped | 0)) {
                        const ownerMapId = getMapSquareId(placement.mapX, placement.mapY) | 0;
                        const mappedMapId = npcEcs.getMapId(mapped | 0) | 0;
                        if ((mappedMapId | 0) !== (ownerMapId | 0)) {
                            // Keep a single ECS entity per server NPC id; rebase local coords when
                            // geometry ownership crosses a map-square boundary.
                            npcEcs.rebaseToMapSquare(mapped | 0, placement.mapX, placement.mapY);
                        }
                        ecsId = mapped | 0;
                    }
                }
                if (ecsId === 0) {
                    ecsId =
                        npcEcs.findBySpawn(
                            placement.mapX,
                            placement.mapY,
                            placement.tileX,
                            placement.tileY,
                            npc.level | 0,
                            npcType.id | 0,
                        ) ?? 0;
                }
                if (ecsId > 0) {
                    reusedIds.add(ecsId);
                    if (!placement.usesOverlayWorldView) {
                        runMapSquareAction(this.mapX, this.mapY, "npcEcs.setMapSquare", () => {
                            // Ensure the reused ECS entity is attached to this map square.
                            (npcEcs as any).setMapSquare?.(ecsId, this.mapX, this.mapY);
                        });
                    }
                    if (npcWorldViewId >= 0) {
                        npcEcs.setWorldViewId(ecsId, npcWorldViewId);
                    }
                    if (serverIdRaw !== undefined && serverIdRaw > 0) {
                        runMapSquareAction(
                            this.mapX,
                            this.mapY,
                            "npcEcs.setServerMapping.reused",
                            () => {
                                if ((npcEcs.getServerId(ecsId) | 0) !== (serverIdRaw | 0)) {
                                    npcEcs.setServerMapping(ecsId, serverIdRaw | 0);
                                }
                            },
                        );
                    }
                } else {
                    try {
                        ecsId = npcEcs.createNpc(
                            placement.mapX,
                            placement.mapY,
                            npcType.id | 0,
                            npcType.size | 0,
                            placement.startX,
                            placement.startY,
                            npc.level | 0,
                            0,
                            placement.tileX,
                            placement.tileY,
                            (npcType.rotationSpeed | 0) as number,
                        );
                        if (npcWorldViewId >= 0) {
                            npcEcs.setWorldViewId(ecsId, npcWorldViewId);
                        }
                        if (serverIdRaw !== undefined && serverIdRaw > 0) {
                            npcEcs.setServerMapping(ecsId, serverIdRaw | 0);
                        }
                    } catch {
                        ecsId = 0;
                    }
                }
            }
            newNpcEntityIds.push(ecsId);
        }

        if (npcEcs) {
            for (const id of existingEcsIds) {
                if (!reusedIds.has(id)) {
                    // Do not destroy server-linked NPCs here; they may have moved maps and been
                    // reused by a different map refresh in the same frame.
                    if (!npcEcs.isLinked(id)) {
                        npcEcs.destroyNpc(id);
                    }
                }
            }
        }

        this.npcEntityIds = newNpcEntityIds;
    }

    refreshDoorGeometry(
        app: PicoApp,
        mainProgram: Program,
        mainAlphaProgram: Program,
        textureArray: Texture,
        textureMaterials: Texture,
        sceneUniformBuffer: UniformBuffer,
        mapData: SdMapData,
        time?: number,
    ): void {
        if (mapData.mapX !== this.mapX || mapData.mapY !== this.mapY) {
            console.warn("[WebGLMapSquare] Door geometry map mismatch", mapData.mapX, mapData.mapY);
            return;
        }

        // Keep CPU-side collision in sync with the refreshed door state.
        // Highlight/raycast queries depend on this map state.
        const collisionLevelCount = Math.min(
            this.collisionMaps.length,
            mapData.collisionDatas.length,
        );
        for (let level = 0; level < collisionLevelCount; level++) {
            const current = this.collisionMaps[level];
            const incoming = mapData.collisionDatas[level];
            if (!current || !incoming) continue;

            const incomingSizeX = incoming.sizeX | 0;
            const incomingSizeY = incoming.sizeY | 0;
            const needsResize =
                current.sizeX !== incomingSizeX ||
                current.sizeY !== incomingSizeY ||
                current.flags.length !== incoming.flags.length;

            current.sizeX = incomingSizeX;
            current.sizeY = incomingSizeY;
            current.offsetX = 0;
            current.offsetY = 0;

            if (needsResize) {
                current.flags = new Int32Array(incoming.flags);
                this.npcOccCounts[level] = new Uint16Array(incomingSizeX * incomingSizeY);
                this.playerOccCounts[level] = new Uint16Array(incomingSizeX * incomingSizeY);
            } else {
                current.flags.set(incoming.flags);
            }
        }

        // Keep CPU-side loc index in sync with the refreshed scene data.
        // SceneRaycaster reads these arrays for interaction hit testing.
        if (this.tileLocOffsetsByLevel && this.tileLocIdsByLevel && this.tileLocTypeRotByLevel) {
            this.tileLocOffsetsByLevel.length = 0;
            this.tileLocIdsByLevel.length = 0;
            this.tileLocTypeRotByLevel.length = 0;
            for (let level = 0; level < mapData.tileLocOffsetsByLevel.length; level++) {
                this.tileLocOffsetsByLevel.push(mapData.tileLocOffsetsByLevel[level]);
                this.tileLocIdsByLevel.push(mapData.tileLocIdsByLevel[level]);
                this.tileLocTypeRotByLevel.push(mapData.tileLocTypeRotByLevel[level]);
            }
            this.locIdsAtLocalBuffer.length = 0;
            this.locTypeRotsAtLocalBuffer.length = 0;
        }

        const loadTime = time ?? this.timeLoaded;

        if (this.door) {
            releaseDrawCallRange(this.door.drawCall);
            releaseDrawCallRange(this.door.drawCallAlpha);
            releaseDrawCallRange(this.door.drawCallLod);
            releaseDrawCallRange(this.door.drawCallLodAlpha);
            releaseDrawCallRange(this.door.drawCallInteract);
            releaseDrawCallRange(this.door.drawCallInteractAlpha);
            releaseDrawCallRange(this.door.drawCallInteractLod);
            releaseDrawCallRange(this.door.drawCallInteractLodAlpha);
            deleteMapSquareResource(
                this.mapX,
                this.mapY,
                "door.vertexArray.refresh",
                this.door.vertexArray,
            );
            deleteMapSquareResource(
                this.mapX,
                this.mapY,
                "door.interleavedBuffer.refresh",
                this.door.interleavedBuffer,
            );
            deleteMapSquareResource(
                this.mapX,
                this.mapY,
                "door.indexBuffer.refresh",
                this.door.indexBuffer,
            );
            this.door.modelInfoTexture.delete();
            this.door.modelInfoTextureAlpha.delete();
            this.door.modelInfoTextureLod.delete();
            this.door.modelInfoTextureLodAlpha.delete();
            this.door.modelInfoTextureInteract.delete();
            this.door.modelInfoTextureInteractAlpha.delete();
            this.door.modelInfoTextureInteractLod.delete();
            this.door.modelInfoTextureInteractLodAlpha.delete();
        }
        this.door = undefined;
        this.doorDrawRangePlanes = undefined;

        if (mapData.doorVertices.length === 0 || mapData.doorIndices.length === 0) {
            return;
        }

        const doorInterleavedBuffer = app.createInterleavedBuffer(12, mapData.doorVertices);
        const doorIndexBuffer = app.createIndexBuffer(PicoGL.UNSIGNED_INT, mapData.doorIndices);
        const doorVertexArray = app
            .createVertexArray()
            .vertexAttributeBuffer(0, doorInterleavedBuffer, {
                type: PicoGL.UNSIGNED_INT,
                size: 3,
                stride: 12,
                integer: true as any,
            })
            .indexBuffer(doorIndexBuffer);

        const doorModelInfoTexture = createModelInfoTexture(app, mapData.doorModelTextureData);
        const doorModelInfoTextureAlpha = createModelInfoTexture(
            app,
            mapData.doorModelTextureDataAlpha,
        );
        const doorModelInfoTextureLod = createModelInfoTexture(
            app,
            mapData.doorModelTextureDataLod,
        );
        const doorModelInfoTextureLodAlpha = createModelInfoTexture(
            app,
            mapData.doorModelTextureDataLodAlpha,
        );
        const doorModelInfoTextureInteract = createModelInfoTexture(
            app,
            mapData.doorModelTextureDataInteract,
        );
        const doorModelInfoTextureInteractAlpha = createModelInfoTexture(
            app,
            mapData.doorModelTextureDataInteractAlpha,
        );
        const doorModelInfoTextureInteractLod = createModelInfoTexture(
            app,
            mapData.doorModelTextureDataInteractLod,
        );
        const doorModelInfoTextureInteractLodAlpha = createModelInfoTexture(
            app,
            mapData.doorModelTextureDataInteractLodAlpha,
        );

        const mapPos = vec2.fromValues(
            mapData.renderPosX ?? mapData.mapX,
            mapData.renderPosY ?? mapData.mapY,
        );

        const buildDrawCall = (
            program: Program,
            modelInfoTexture: Texture | undefined,
            drawRanges: DrawRange[],
        ): DrawCallRange => {
            const drawCall = app
                .createDrawCall(program, doorVertexArray)
                .uniformBlock("SceneUniforms", sceneUniformBuffer)
                .uniform("u_timeLoaded", loadTime)
                .uniform("u_mapPos", mapPos)
                .uniform("u_roofPlaneLimit", 3.0)
                .uniform("u_worldEntityTransform", WebGLMapSquare.IDENTITY_MAT4)
                .uniform("u_worldEntityOpacity", 1.0)
                .texture("u_textures", textureArray)
                .texture("u_textureMaterials", textureMaterials)
                .texture("u_heightMap", this.heightMapTexture)
                .uniform("u_sceneBorderSize", this.borderSize)
                .drawRanges(...drawRanges);
            if (modelInfoTexture) {
                drawCall.texture("u_modelInfoTexture", modelInfoTexture);
            }
            return {
                drawCall,
                drawRanges,
            };
        };

        const doorDrawCall = buildDrawCall(
            mainProgram,
            doorModelInfoTexture,
            mapData.doorDrawRanges,
        );
        const doorDrawCallAlpha = buildDrawCall(
            mainAlphaProgram,
            doorModelInfoTextureAlpha,
            mapData.doorDrawRangesAlpha,
        );
        const doorDrawCallLod = buildDrawCall(
            mainProgram,
            doorModelInfoTextureLod,
            mapData.doorDrawRangesLod,
        );
        const doorDrawCallLodAlpha = buildDrawCall(
            mainAlphaProgram,
            doorModelInfoTextureLodAlpha,
            mapData.doorDrawRangesLodAlpha,
        );
        const doorDrawCallInteract = buildDrawCall(
            mainProgram,
            doorModelInfoTextureInteract,
            mapData.doorDrawRangesInteract,
        );
        const doorDrawCallInteractAlpha = buildDrawCall(
            mainAlphaProgram,
            doorModelInfoTextureInteractAlpha,
            mapData.doorDrawRangesInteractAlpha,
        );
        const doorDrawCallInteractLod = buildDrawCall(
            mainProgram,
            doorModelInfoTextureInteractLod,
            mapData.doorDrawRangesInteractLod,
        );
        const doorDrawCallInteractLodAlpha = buildDrawCall(
            mainAlphaProgram,
            doorModelInfoTextureInteractLodAlpha,
            mapData.doorDrawRangesInteractLodAlpha,
        );

        const doorPlanes =
            mapData.doorDrawRangesPlanes.length > 0
                ? {
                      main: mapData.doorDrawRangesPlanes,
                      alpha: mapData.doorDrawRangesAlphaPlanes,
                      lod: mapData.doorDrawRangesLodPlanes,
                      lodAlpha: mapData.doorDrawRangesLodAlphaPlanes,
                      interact: mapData.doorDrawRangesInteractPlanes,
                      interactAlpha: mapData.doorDrawRangesInteractAlphaPlanes,
                      interactLod: mapData.doorDrawRangesInteractLodPlanes,
                      interactLodAlpha: mapData.doorDrawRangesInteractLodAlphaPlanes,
                  }
                : undefined;

        this.door = {
            interleavedBuffer: doorInterleavedBuffer,
            indexBuffer: doorIndexBuffer,
            vertexArray: doorVertexArray,
            modelInfoTexture: doorModelInfoTexture,
            modelInfoTextureAlpha: doorModelInfoTextureAlpha,
            modelInfoTextureLod: doorModelInfoTextureLod,
            modelInfoTextureLodAlpha: doorModelInfoTextureLodAlpha,
            modelInfoTextureInteract: doorModelInfoTextureInteract,
            modelInfoTextureInteractAlpha: doorModelInfoTextureInteractAlpha,
            modelInfoTextureInteractLod: doorModelInfoTextureInteractLod,
            modelInfoTextureInteractLodAlpha: doorModelInfoTextureInteractLodAlpha,
            drawCall: doorDrawCall,
            drawCallAlpha: doorDrawCallAlpha,
            drawCallLod: doorDrawCallLod,
            drawCallLodAlpha: doorDrawCallLodAlpha,
            drawCallInteract: doorDrawCallInteract,
            drawCallInteractAlpha: doorDrawCallInteractAlpha,
            drawCallInteractLod: doorDrawCallInteractLod,
            drawCallInteractLodAlpha: doorDrawCallInteractLodAlpha,
            planes: doorPlanes,
        };
        if (doorPlanes) {
            this.doorDrawRangePlanes = doorPlanes;
        }
    }

    refreshSceneGeometry(
        seqTypeLoader: SeqTypeLoader,
        seqFrameLoader: SeqFrameLoader,
        app: PicoApp,
        mainProgram: Program,
        mainAlphaProgram: Program,
        textureArray: Texture,
        textureMaterials: Texture,
        sceneUniformBuffer: UniformBuffer,
        mapData: SdMapData,
        clientCycle: number,
        time?: number,
    ): void {
        if (mapData.mapX !== this.mapX || mapData.mapY !== this.mapY) {
            console.warn("[WebGLMapSquare] Scene geometry map mismatch", mapData.mapX, mapData.mapY);
            return;
        }

        const collisionLevelCount = Math.min(
            this.collisionMaps.length,
            mapData.collisionDatas.length,
        );
        for (let level = 0; level < collisionLevelCount; level++) {
            const current = this.collisionMaps[level];
            const incoming = mapData.collisionDatas[level];
            if (!current || !incoming) continue;

            const incomingSizeX = incoming.sizeX | 0;
            const incomingSizeY = incoming.sizeY | 0;
            const needsResize =
                current.sizeX !== incomingSizeX ||
                current.sizeY !== incomingSizeY ||
                current.flags.length !== incoming.flags.length;

            current.sizeX = incomingSizeX;
            current.sizeY = incomingSizeY;
            current.offsetX = 0;
            current.offsetY = 0;

            if (needsResize) {
                current.flags = new Int32Array(incoming.flags);
                this.npcOccCounts[level] = new Uint16Array(incomingSizeX * incomingSizeY);
                this.playerOccCounts[level] = new Uint16Array(incomingSizeX * incomingSizeY);
            } else {
                current.flags.set(incoming.flags);
            }
        }

        if (this.tileLocOffsetsByLevel && this.tileLocIdsByLevel && this.tileLocTypeRotByLevel) {
            this.tileLocOffsetsByLevel.length = 0;
            this.tileLocIdsByLevel.length = 0;
            this.tileLocTypeRotByLevel.length = 0;
            for (let level = 0; level < mapData.tileLocOffsetsByLevel.length; level++) {
                this.tileLocOffsetsByLevel.push(mapData.tileLocOffsetsByLevel[level]);
                this.tileLocIdsByLevel.push(mapData.tileLocIdsByLevel[level]);
                this.tileLocTypeRotByLevel.push(mapData.tileLocTypeRotByLevel[level]);
            }
            this.locIdsAtLocalBuffer.length = 0;
            this.locTypeRotsAtLocalBuffer.length = 0;
        }

        const loadTime = time ?? this.timeLoaded;

        releaseDrawCallRange(this.drawCall);
        releaseDrawCallRange(this.drawCallAlpha);
        releaseDrawCallRange(this.drawCallLod);
        releaseDrawCallRange(this.drawCallLodAlpha);
        releaseDrawCallRange(this.drawCallInteract);
        releaseDrawCallRange(this.drawCallInteractAlpha);
        releaseDrawCallRange(this.drawCallInteractLod);
        releaseDrawCallRange(this.drawCallInteractLodAlpha);
        deleteMapSquareResource(this.mapX, this.mapY, "vertexArray.refresh", this.vertexArray);
        deleteMapSquareResource(
            this.mapX,
            this.mapY,
            "interleavedBuffer.refresh",
            this.interleavedBuffer,
        );
        deleteMapSquareResource(this.mapX, this.mapY, "indexBuffer.refresh", this.indexBuffer);
        this.modelInfoTexture.delete();
        this.modelInfoTextureAlpha.delete();
        this.modelInfoTextureLod.delete();
        this.modelInfoTextureLodAlpha.delete();
        this.modelInfoTextureInteract.delete();
        this.modelInfoTextureInteractAlpha.delete();
        this.modelInfoTextureInteractLod.delete();
        this.modelInfoTextureInteractLodAlpha.delete();

        this.interleavedBuffer = app.createInterleavedBuffer(12, mapData.vertices);
        this.indexBuffer = app.createIndexBuffer(PicoGL.UNSIGNED_INT, mapData.indices);
        this.vertexArray = app
            .createVertexArray()
            .vertexAttributeBuffer(0, this.interleavedBuffer, {
                type: PicoGL.UNSIGNED_INT,
                size: 3,
                stride: 12,
                integer: true as any,
            })
            .indexBuffer(this.indexBuffer);

        this.modelInfoTexture = createModelInfoTexture(app, mapData.modelTextureData);
        this.modelInfoTextureAlpha = createModelInfoTexture(app, mapData.modelTextureDataAlpha);
        this.modelInfoTextureLod = createModelInfoTexture(app, mapData.modelTextureDataLod);
        this.modelInfoTextureLodAlpha = createModelInfoTexture(
            app,
            mapData.modelTextureDataLodAlpha,
        );
        this.modelInfoTextureInteract = createModelInfoTexture(
            app,
            mapData.modelTextureDataInteract,
        );
        this.modelInfoTextureInteractAlpha = createModelInfoTexture(
            app,
            mapData.modelTextureDataInteractAlpha,
        );
        this.modelInfoTextureInteractLod = createModelInfoTexture(
            app,
            mapData.modelTextureDataInteractLod,
        );
        this.modelInfoTextureInteractLodAlpha = createModelInfoTexture(
            app,
            mapData.modelTextureDataInteractLodAlpha,
        );

        const mapPos = vec2.fromValues(this.renderPosX, this.renderPosY);
        const buildDrawCall = (
            program: Program,
            modelInfoTex: Texture | undefined,
            drawRanges: DrawRange[],
            vertexArrayOverride?: VertexArray,
        ): DrawCallRange => {
            const vao = vertexArrayOverride ?? this.vertexArray;
            const drawCall = app
                .createDrawCall(program, vao)
                .uniformBlock("SceneUniforms", sceneUniformBuffer)
                .uniform("u_timeLoaded", loadTime)
                .uniform("u_mapPos", mapPos)
                .uniform("u_roofPlaneLimit", 3.0)
                .uniform("u_worldEntityTransform", WebGLMapSquare.IDENTITY_MAT4)
                .uniform("u_worldEntityOpacity", 1.0)
                .texture("u_textures", textureArray)
                .texture("u_textureMaterials", textureMaterials)
                .texture("u_heightMap", this.heightMapTexture)
                .uniform("u_sceneBorderSize", this.borderSize)
                .drawRanges(...drawRanges);
            if (modelInfoTex) {
                drawCall.texture("u_modelInfoTexture", modelInfoTex);
            }
            return { drawCall, drawRanges };
        };

        this.drawCall = buildDrawCall(mainProgram, this.modelInfoTexture, mapData.drawRanges);
        this.drawCallAlpha = buildDrawCall(
            mainAlphaProgram,
            this.modelInfoTextureAlpha,
            mapData.drawRangesAlpha,
        );
        this.drawCallLod = buildDrawCall(
            mainProgram,
            this.modelInfoTextureLod,
            mapData.drawRangesLod,
        );
        this.drawCallLodAlpha = buildDrawCall(
            mainAlphaProgram,
            this.modelInfoTextureLodAlpha,
            mapData.drawRangesLodAlpha,
        );
        this.drawCallInteract = buildDrawCall(
            mainProgram,
            this.modelInfoTextureInteract,
            mapData.drawRangesInteract,
        );
        this.drawCallInteractAlpha = buildDrawCall(
            mainAlphaProgram,
            this.modelInfoTextureInteractAlpha,
            mapData.drawRangesInteractAlpha,
        );
        this.drawCallInteractLod = buildDrawCall(
            mainProgram,
            this.modelInfoTextureInteractLod,
            mapData.drawRangesInteractLod,
        );
        this.drawCallInteractLodAlpha = buildDrawCall(
            mainAlphaProgram,
            this.modelInfoTextureInteractLodAlpha,
            mapData.drawRangesInteractLodAlpha,
        );

        this.drawRangePlanes = {
            main: mapData.drawRangesPlanes,
            alpha: mapData.drawRangesAlphaPlanes,
            lod: mapData.drawRangesLodPlanes,
            lodAlpha: mapData.drawRangesLodAlphaPlanes,
            interact: mapData.drawRangesInteractPlanes,
            interactAlpha: mapData.drawRangesInteractAlphaPlanes,
            interactLod: mapData.drawRangesInteractLodPlanes,
            interactLodAlpha: mapData.drawRangesInteractLodAlphaPlanes,
        };

        const cycle = clientCycle | 0;
        const newLocsAnimated: LocAnimated[] = [];
        for (const loc of mapData.locsAnimated) {
            const seqType = seqTypeLoader.load(loc.seqId);
            newLocsAnimated.push(
                new LocAnimated(
                    loc.drawRangeIndex,
                    loc.drawRangeAlphaIndex,
                    loc.drawRangeLodIndex,
                    loc.drawRangeLodAlphaIndex,
                    loc.drawRangeInteractIndex,
                    loc.drawRangeInteractAlphaIndex,
                    loc.drawRangeInteractLodIndex,
                    loc.drawRangeInteractLodAlphaIndex,
                    loc.anim,
                    seqType,
                    cycle,
                    loc.randomStart,
                    loc.locId,
                    loc.x,
                    loc.y,
                    loc.level,
                    loc.rotation,
                ),
            );
        }
        this.locsAnimated = newLocsAnimated;

        this.refreshDoorGeometry(
            app,
            mainProgram,
            mainAlphaProgram,
            textureArray,
            textureMaterials,
            sceneUniformBuffer,
            mapData,
            loadTime,
        );
    }

    clearGroundItemGeometry(): void {
        const resources = this.groundItems;
        if (!resources) return;
        releaseDrawCallRange(resources.drawCall);
        releaseDrawCallRange(resources.drawCallAlpha);
        releaseDrawCallRange(resources.drawCallLod);
        releaseDrawCallRange(resources.drawCallLodAlpha);
        releaseDrawCallRange(resources.drawCallInteract);
        releaseDrawCallRange(resources.drawCallInteractAlpha);
        releaseDrawCallRange(resources.drawCallInteractLod);
        releaseDrawCallRange(resources.drawCallInteractLodAlpha);
        deleteMapSquareResource(this.mapX, this.mapY, "ground.vertexArray", resources.vertexArray);
        deleteMapSquareResource(
            this.mapX,
            this.mapY,
            "ground.interleavedBuffer",
            resources.interleavedBuffer,
        );
        deleteMapSquareResource(this.mapX, this.mapY, "ground.indexBuffer", resources.indexBuffer);
        resources.modelInfoTexture.delete();
        resources.modelInfoTextureAlpha.delete();
        resources.modelInfoTextureLod.delete();
        resources.modelInfoTextureLodAlpha.delete();
        resources.modelInfoTextureInteract.delete();
        resources.modelInfoTextureInteractAlpha.delete();
        resources.modelInfoTextureInteractLod.delete();
        resources.modelInfoTextureInteractLodAlpha.delete();
        this.groundItems = undefined;
        this.groundItemDrawRangePlanes = undefined;
    }

    updateGroundItemGeometry(
        app: PicoApp,
        mainProgram: Program,
        mainAlphaProgram: Program,
        textureArray: Texture,
        textureMaterials: Texture,
        sceneUniformBuffer: UniformBuffer,
        data?: GroundItemGeometryBuildData,
    ): void {
        this.clearGroundItemGeometry();
        if (!data || data.vertices.length === 0 || data.indices.length === 0) {
            return;
        }

        const interleavedBuffer = app.createInterleavedBuffer(12, data.vertices);
        const indexBuffer = app.createIndexBuffer(PicoGL.UNSIGNED_INT, data.indices);
        const vertexArray = app
            .createVertexArray()
            .vertexAttributeBuffer(0, interleavedBuffer, {
                type: PicoGL.UNSIGNED_INT,
                size: 3,
                stride: 12,
                integer: true as any,
            })
            .indexBuffer(indexBuffer);

        const mapPos = vec2.fromValues(this.renderPosX, this.renderPosY);
        // Use -1 to skip the fog fade-in animation for ground items
        // (u_currentTime - u_timeLoaded will always be > 1, so loadAlpha = 1 immediately)
        const loadTime = -1.0;

        const buildDrawCall = (
            program: Program,
            modelInfoTexture: Texture,
            drawRanges: DrawRange[],
        ): DrawCallRange => {
            const drawCall = app
                .createDrawCall(program, vertexArray)
                .uniformBlock("SceneUniforms", sceneUniformBuffer)
                .uniform("u_timeLoaded", loadTime)
                .uniform("u_mapPos", mapPos)
                .uniform("u_roofPlaneLimit", 3.0)
                .uniform("u_worldEntityTransform", WebGLMapSquare.IDENTITY_MAT4)
                .uniform("u_worldEntityOpacity", 1.0)
                .texture("u_textures", textureArray)
                .texture("u_textureMaterials", textureMaterials)
                .texture("u_heightMap", this.heightMapTexture)
                .uniform("u_sceneBorderSize", this.borderSize)
                .drawRanges(...drawRanges);
            if (modelInfoTexture) {
                drawCall.texture("u_modelInfoTexture", modelInfoTexture);
            }
            return {
                drawCall,
                drawRanges,
            };
        };

        const modelInfoTexture = createModelInfoTexture(app, data.modelTextureData);
        const modelInfoTextureAlpha = createModelInfoTexture(app, data.modelTextureDataAlpha);
        const modelInfoTextureLod = createModelInfoTexture(app, data.modelTextureDataLod);
        const modelInfoTextureLodAlpha = createModelInfoTexture(app, data.modelTextureDataLodAlpha);
        const modelInfoTextureInteract = createModelInfoTexture(app, data.modelTextureDataInteract);
        const modelInfoTextureInteractAlpha = createModelInfoTexture(
            app,
            data.modelTextureDataInteractAlpha,
        );
        const modelInfoTextureInteractLod = createModelInfoTexture(
            app,
            data.modelTextureDataInteractLod,
        );
        const modelInfoTextureInteractLodAlpha = createModelInfoTexture(
            app,
            data.modelTextureDataInteractLodAlpha,
        );

        const groundResources: GroundItemGeometryResources = {
            interleavedBuffer,
            indexBuffer,
            vertexArray,
            modelInfoTexture,
            modelInfoTextureAlpha,
            modelInfoTextureLod,
            modelInfoTextureLodAlpha,
            modelInfoTextureInteract,
            modelInfoTextureInteractAlpha,
            modelInfoTextureInteractLod,
            modelInfoTextureInteractLodAlpha,
            drawCall: buildDrawCall(mainProgram, modelInfoTexture, data.drawRanges),
            drawCallAlpha: buildDrawCall(
                mainAlphaProgram,
                modelInfoTextureAlpha,
                data.drawRangesAlpha,
            ),
            drawCallLod: buildDrawCall(mainProgram, modelInfoTextureLod, data.drawRangesLod),
            drawCallLodAlpha: buildDrawCall(
                mainAlphaProgram,
                modelInfoTextureLodAlpha,
                data.drawRangesLodAlpha,
            ),
            drawCallInteract: buildDrawCall(
                mainProgram,
                modelInfoTextureInteract,
                data.drawRangesInteract,
            ),
            drawCallInteractAlpha: buildDrawCall(
                mainAlphaProgram,
                modelInfoTextureInteractAlpha,
                data.drawRangesInteractAlpha,
            ),
            drawCallInteractLod: buildDrawCall(
                mainProgram,
                modelInfoTextureInteractLod,
                data.drawRangesInteractLod,
            ),
            drawCallInteractLodAlpha: buildDrawCall(
                mainAlphaProgram,
                modelInfoTextureInteractLodAlpha,
                data.drawRangesInteractLodAlpha,
            ),
            planes: data.planes,
        };

        this.groundItems = groundResources;
        this.groundItemDrawRangePlanes = data.planes;
    }

    // Return loc ids present at the origin of the given interior tile (0..63 local) for a specific level.
    // Returns a reusable buffer - caller must consume results before next call.
    getLocIdsAtLocal(level: number, localX: number, localY: number): number[] {
        const out = this.locIdsAtLocalBuffer;
        out.length = 0;
        try {
            if (!this.tileLocOffsetsByLevel || !this.tileLocIdsByLevel) return out;
            if (level < 0 || level >= this.tileLocOffsetsByLevel.length) return out;
            if (localX < 0 || localY < 0 || localX >= 64 || localY >= 64) return out;
            const offsets = this.tileLocOffsetsByLevel[level];
            const ids = this.tileLocIdsByLevel[level];
            const idx = (localY | 0) * 64 + (localX | 0);
            const start = offsets[idx] | 0;
            const end = offsets[idx + 1] | 0;
            if (end <= start) return out;
            const count = end - start;
            // Grow buffer if needed, but reuse existing capacity
            for (let i = start, j = 0; j < count; i++, j++) {
                out[j] = ids[i] | 0;
            }
            out.length = count;
            return out;
        } catch {
            out.length = 0;
            return out;
        }
    }

    // Return packed loc modelType/rotation values parallel to getLocIdsAtLocal.
    // Packed format: bits 0..5 = LocModelType, bits 6..7 = rotation (0..3).
    // Returns a reusable buffer - caller must consume results before next call.
    getLocTypeRotsAtLocal(level: number, localX: number, localY: number): number[] {
        const out = this.locTypeRotsAtLocalBuffer;
        out.length = 0;
        try {
            if (
                !this.tileLocOffsetsByLevel ||
                !this.tileLocIdsByLevel ||
                !this.tileLocTypeRotByLevel
            ) {
                return out;
            }
            if (level < 0 || level >= this.tileLocOffsetsByLevel.length) return out;
            if (localX < 0 || localY < 0 || localX >= 64 || localY >= 64) return out;
            const offsets = this.tileLocOffsetsByLevel[level];
            const ids = this.tileLocIdsByLevel[level];
            const typeRots = this.tileLocTypeRotByLevel[level];
            const idx = (localY | 0) * 64 + (localX | 0);
            const start = offsets[idx] | 0;
            const end = offsets[idx + 1] | 0;
            if (end <= start) return out;
            const count = end - start;
            // Keep buffers aligned with getLocIdsAtLocal data layout.
            if (ids.length < end || typeRots.length < end) return out;
            for (let i = start, j = 0; j < count; i++, j++) {
                out[j] = typeRots[i] | 0;
            }
            out.length = count;
            return out;
        } catch {
            out.length = 0;
            return out;
        }
    }
}
