/**
 * Dynamic instance (REBUILD_REGION) types and utilities.
 *
 * In OSRS, instanced areas (sailing, CoX, ToB, etc.) are built from
 * 8×8 tile "template chunks" copied from real cache regions with optional rotation.
 * The server sends a 4×13×13 grid of packed template chunk references
 * and the client builds the scene by reading source data from cache.
 */

// ============================================================================
// Constants
// ============================================================================

export const INSTANCE_CHUNK_COUNT = 13;
export const CHUNK_SIZE = 8;
export const INSTANCE_SIZE = INSTANCE_CHUNK_COUNT * CHUNK_SIZE; // 104 tiles
export const PLANE_COUNT = 4;

// ============================================================================
// Template chunk packing (26 bits)
// ============================================================================

/**
 * Pack a template chunk reference into a 26-bit value.
 *
 * Bit layout (from MapLoader.java / Js5Archive.java):
 *   bits 24-25: source plane       (2 bits)
 *   bits 14-23: source chunk X     (10 bits, tile-level)
 *   bits  3-13: source chunk Y     (11 bits, tile-level)
 *   bits  1-2:  rotation           (2 bits, 0-3)
 *   bit   0:    unused
 */
export function packTemplateChunk(
    plane: number,
    chunkX: number,
    chunkY: number,
    rotation: number,
): number {
    return ((plane & 3) << 24) | ((chunkX & 0x3ff) << 14) | ((chunkY & 0x7ff) << 3) | ((rotation & 3) << 1);
}

export interface UnpackedTemplateChunk {
    plane: number;
    chunkX: number;
    chunkY: number;
    rotation: number;
}

export function unpackTemplateChunk(packed: number): UnpackedTemplateChunk {
    return {
        plane: (packed >> 24) & 3,
        chunkX: (packed >> 14) & 0x3ff,
        chunkY: (packed >> 3) & 0x7ff,
        rotation: (packed >> 1) & 3,
    };
}

// ============================================================================
// Chunk rotation helpers (ported from MapLoader.java lines 1189-1262)
// ============================================================================

/**
 * Rotate a tile X coordinate within an 8×8 chunk.
 * Rotation: 0=none, 1=90° CW, 2=180°, 3=270° CW.
 */
export function rotateChunkX(x: number, y: number, rotation: number): number {
    rotation &= 3;
    if (rotation === 0) return x;
    if (rotation === 1) return y;
    if (rotation === 2) return 7 - x;
    return 7 - y;
}

/**
 * Rotate a tile Y coordinate within an 8×8 chunk.
 */
export function rotateChunkY(x: number, y: number, rotation: number): number {
    rotation &= 3;
    if (rotation === 0) return y;
    if (rotation === 1) return 7 - x;
    if (rotation === 2) return 7 - y;
    return x;
}

/**
 * Rotate an object's X coordinate within an 8×8 chunk,
 * accounting for object dimensions and orientation.
 */
export function rotateObjectChunkX(
    x: number,
    y: number,
    rotation: number,
    sizeX: number,
    sizeY: number,
    orientation: number,
): number {
    if ((orientation & 1) === 1) {
        const tmp = sizeX;
        sizeX = sizeY;
        sizeY = tmp;
    }
    rotation &= 3;
    if (rotation === 0) return x;
    if (rotation === 1) return y;
    if (rotation === 2) return 7 - x - (sizeX - 1);
    return 7 - y - (sizeY - 1);
}

/**
 * Rotate an object's Y coordinate within an 8×8 chunk,
 * accounting for object dimensions and orientation.
 */
export function rotateObjectChunkY(
    x: number,
    y: number,
    rotation: number,
    sizeX: number,
    sizeY: number,
    orientation: number,
): number {
    if ((orientation & 1) === 1) {
        const tmp = sizeX;
        sizeX = sizeY;
        sizeY = tmp;
    }
    rotation &= 3;
    if (rotation === 0) return y;
    if (rotation === 1) return 7 - x - (sizeX - 1);
    if (rotation === 2) return 7 - y - (sizeY - 1);
    return x;
}

// ============================================================================
// Region derivation
// ============================================================================

/**
 * Derive the unique set of cache region IDs referenced by a template chunk grid.
 * Each region ID = (mapSquareX << 8) | mapSquareY where mapSquare = chunkTile / 8.
 */
export function deriveRegionsFromTemplates(templateChunks: number[][][]): number[] {
    const seen = new Set<number>();
    const regions: number[] = [];

    for (let plane = 0; plane < PLANE_COUNT; plane++) {
        for (let cx = 0; cx < INSTANCE_CHUNK_COUNT; cx++) {
            for (let cy = 0; cy < INSTANCE_CHUNK_COUNT; cy++) {
                const packed = templateChunks[plane][cx][cy];
                if (packed === -1) continue;

                const { chunkX, chunkY } = unpackTemplateChunk(packed);
                const regionId = ((chunkX >> 3) << 8) | (chunkY >> 3);

                if (!seen.has(regionId)) {
                    seen.add(regionId);
                    regions.push(regionId);
                }
            }
        }
    }

    return regions;
}

/**
 * Derive the map region IDs for a normal (non-instance) region load.
 * Mirrors Js5Archive.loadRegions normal path: iterates map squares
 * from (regionX-6)/8 to (regionX+6)/8 in both axes.
 *
 * @param regionX Center chunk X coordinate
 * @param regionY Center chunk Y coordinate
 */
export function deriveRegionsFromCenter(regionX: number, regionY: number): number[] {
    const regions: number[] = [];
    const minMapX = ((regionX - 6) / 8) | 0;
    const maxMapX = ((regionX + 6) / 8) | 0;
    const minMapY = ((regionY - 6) / 8) | 0;
    const maxMapY = ((regionY + 6) / 8) | 0;

    for (let mx = minMapX; mx <= maxMapX; mx++) {
        for (let my = minMapY; my <= maxMapY; my++) {
            regions.push((mx << 8) | my);
        }
    }
    return regions;
}

/**
 * Create an empty 4×13×13 template chunk grid filled with -1 (no template).
 */
export function createEmptyTemplateChunks(): number[][][] {
    const chunks: number[][][] = new Array(PLANE_COUNT);
    for (let p = 0; p < PLANE_COUNT; p++) {
        chunks[p] = new Array(INSTANCE_CHUNK_COUNT);
        for (let cx = 0; cx < INSTANCE_CHUNK_COUNT; cx++) {
            chunks[p][cx] = new Array(INSTANCE_CHUNK_COUNT).fill(-1);
        }
    }
    return chunks;
}
