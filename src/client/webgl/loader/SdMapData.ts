import { CollisionData } from "../../../rs/scene/CollisionMap";
import { DrawRange } from "../DrawRange";
import { LocAnimatedData } from "../loc/LocAnimatedData";
import { NpcData } from "../npc/NpcData";

/**
 * Minimap icon entry: position + sprite ID for dynamic rendering
 */
export interface MinimapIcon {
    localX: number; // Local tile X within map square (0-63)
    localY: number; // Local tile Y within map square (0-63)
    spriteId: number; // Sprite ID to load (resolved from MapElementType.spriteId)
}

export type SdMapData = {
    mapX: number;
    mapY: number;

    cacheName: string;

    maxLevel: number;
    loadObjs: boolean;
    loadNpcs: boolean;

    smoothTerrain: boolean;

    borderSize: number;

    tileRenderFlags: Uint8Array[][];
    collisionDatas: CollisionData[];

    minimapBlob: Blob;
    minimapIcons: MinimapIcon[];

    vertices: Uint8Array;
    indices: Int32Array;
    doorVertices: Uint8Array;
    doorIndices: Int32Array;
    npcVertices: Uint8Array;
    npcIndices: Int32Array;

    modelTextureData: Uint16Array;
    modelTextureDataAlpha: Uint16Array;

    modelTextureDataLod: Uint16Array;
    modelTextureDataLodAlpha: Uint16Array;

    modelTextureDataInteract: Uint16Array;
    modelTextureDataInteractAlpha: Uint16Array;

    modelTextureDataInteractLod: Uint16Array;
    modelTextureDataInteractLodAlpha: Uint16Array;

    doorModelTextureData: Uint16Array;
    doorModelTextureDataAlpha: Uint16Array;

    doorModelTextureDataLod: Uint16Array;
    doorModelTextureDataLodAlpha: Uint16Array;

    doorModelTextureDataInteract: Uint16Array;
    doorModelTextureDataInteractAlpha: Uint16Array;

    doorModelTextureDataInteractLod: Uint16Array;
    doorModelTextureDataInteractLodAlpha: Uint16Array;

    heightMapTextureData: Int16Array;

    drawRanges: DrawRange[];
    drawRangesAlpha: DrawRange[];
    drawRangesPlanes: Uint8Array;
    drawRangesAlphaPlanes: Uint8Array;

    drawRangesLod: DrawRange[];
    drawRangesLodAlpha: DrawRange[];
    drawRangesLodPlanes: Uint8Array;
    drawRangesLodAlphaPlanes: Uint8Array;

    drawRangesInteract: DrawRange[];
    drawRangesInteractAlpha: DrawRange[];
    drawRangesInteractPlanes: Uint8Array;
    drawRangesInteractAlphaPlanes: Uint8Array;

    drawRangesInteractLod: DrawRange[];
    drawRangesInteractLodAlpha: DrawRange[];
    drawRangesInteractLodPlanes: Uint8Array;
    drawRangesInteractLodAlphaPlanes: Uint8Array;

    doorDrawRanges: DrawRange[];
    doorDrawRangesAlpha: DrawRange[];
    doorDrawRangesPlanes: Uint8Array;
    doorDrawRangesAlphaPlanes: Uint8Array;

    doorDrawRangesLod: DrawRange[];
    doorDrawRangesLodAlpha: DrawRange[];
    doorDrawRangesLodPlanes: Uint8Array;
    doorDrawRangesLodAlphaPlanes: Uint8Array;

    doorDrawRangesInteract: DrawRange[];
    doorDrawRangesInteractAlpha: DrawRange[];
    doorDrawRangesInteractPlanes: Uint8Array;
    doorDrawRangesInteractAlphaPlanes: Uint8Array;

    doorDrawRangesInteractLod: DrawRange[];
    doorDrawRangesInteractLodAlpha: DrawRange[];
    doorDrawRangesInteractLodPlanes: Uint8Array;
    doorDrawRangesInteractLodAlphaPlanes: Uint8Array;

    locsAnimated: LocAnimatedData[];
    npcs: NpcData[];

    loadedTextures: Map<number, Int32Array>;

    // Bridge surface flags per level (1 = bridge surface on level 0 after demotion).
    bridgeSurfaceFlags: Uint8Array[][];

    // Per-level mapping of interior 64x64 tiles to loc IDs present at that tile origin.
    // Compressed sparse row (CSR) format per level to keep memory small and transferable:
    // - offsets[level]: Uint32Array of length 64*64 + 1
    // - ids[level]: Int32Array concatenating all loc ids for that level
    // - typeRots[level]: Uint8Array parallel to ids, packed as:
    //   bits 0..5 = LocModelType, bits 6..7 = rotation (0..3)
    tileLocOffsetsByLevel: Uint32Array[];
    tileLocIdsByLevel: Int32Array[];
    tileLocTypeRotByLevel: Uint8Array[];
};
