import fs from "fs";
import path from "path";

import { getCacheLoaderFactory } from "../../../src/rs/cache/loader/CacheLoaderFactory";
import { LocModelLoader } from "../../../src/rs/config/loctype/LocModelLoader";
import { MapFileLoader } from "../../../src/rs/map/MapFileLoader";
import { CollisionMap } from "../../../src/rs/scene/CollisionMap";
import { Scene } from "../../../src/rs/scene/Scene";
import { LocLoadType, SceneBuilder } from "../../../src/rs/scene/SceneBuilder";
import { bitsetGet } from "../utils/bitset";
import { CacheEnv } from "./CacheEnv";

export type ServerMapSquare = {
    mapX: number;
    mapY: number;
    borderSize: number;
    baseX: number; // world tile x of local index 0
    baseY: number; // world tile y of local index 0
    size: number; // local side length (tiles)
    collisionMaps: CollisionMap[];
    tileRenderFlags?: Uint8Array[][]; // [level][x+border][y+border]
    tileHeights?: Int32Array[][]; // [level][x+border][y+border]
    tileUnderlays?: Uint16Array[][];
    tileOverlays?: Int16Array[][];
    tileShapes?: Uint8Array[][];
    tileRotations?: Uint8Array[][];
    tileLightOcclusions?: Uint8Array[][];
    // Precomputed per-tile minimum levels (editor scene.ts logic)
    tileMinLevels?: number[][][]; // [level][x][y]
    // v2 collision cache metadata (compact): bridge/min-plane flags to resolve collision planes
    linkBelowMask?: Uint8Array; // bitset over (size*size) tiles
    forceMin0Masks?: Uint8Array[]; // [level] bitset over (size*size) tiles
};

type MapCollisionOptions = {
    precomputedRoot?: string;
    usePrecomputed?: boolean;
};

export class MapCollisionService {
    private env: CacheEnv;
    private mapFileLoader: MapFileLoader;
    private sceneBuilder: SceneBuilder | undefined;
    private cache: Map<number, ServerMapSquare> = new Map();
    private includeModels: boolean;
    private precomputedRoot: string | undefined;
    private usePrecomputed: boolean;

    constructor(env: CacheEnv, includeModels: boolean = false, opts: MapCollisionOptions = {}) {
        this.env = env;
        this.includeModels = !!includeModels;
        this.usePrecomputed = opts.usePrecomputed !== false;
        this.precomputedRoot = opts.precomputedRoot
            ? path.resolve(opts.precomputedRoot)
            : path.resolve("server/cache/collision");

        const factory = getCacheLoaderFactory(env.info, env.cacheSystem as any);
        const underlays = factory.getUnderlayTypeLoader();
        const overlays = factory.getOverlayTypeLoader();
        const locTypeLoader = factory.getLocTypeLoader();
        const locModelLoader = new LocModelLoader(
            locTypeLoader,
            factory.getModelLoader(),
            factory.getTextureLoader(),
            factory.getSeqTypeLoader(),
            factory.getSeqFrameLoader(),
            factory.getSkeletalSeqLoader(),
        );

        this.mapFileLoader = factory.getMapFileLoader();
        // Only instantiate the scene builder when we intend to build scenes (fallback or model use).
        if (!this.usePrecomputed || this.includeModels) {
            this.sceneBuilder = new SceneBuilder(
                env.info,
                this.mapFileLoader,
                underlays,
                overlays,
                locTypeLoader,
                locModelLoader,
                env.xteas,
            );
        } else {
            this.sceneBuilder = undefined;
        }
    }

    private key(mapX: number, mapY: number): number {
        return (mapX << 16) | (mapY & 0xffff);
    }

    private mapSquareCoord(worldTile: number): number {
        // World tiles are non-negative in OSRS, but some queries (e.g. pathfinding windows)
        // can probe < 0. Use floor-division so negative tiles map to negative squares.
        return Math.floor(worldTile / Scene.MAP_SQUARE_SIZE);
    }

    private loadPrecomputed(mapX: number, mapY: number): ServerMapSquare | undefined {
        if (!this.usePrecomputed || !this.precomputedRoot) return undefined;
        const file = path.join(this.precomputedRoot, `${mapX}_${mapY}.bin`);
        if (!fs.existsSync(file)) return undefined;
        try {
            const buf = fs.readFileSync(file);
            if (buf.length < 24) return undefined;
            let offset = 0;
            const version = buf.readUInt8(offset);
            offset += 1;
            if (version !== 1 && version !== 2) {
                console.warn?.(
                    `[MapCollisionService] unsupported collision cache version ${version} for ${mapX}_${mapY}`,
                );
                return undefined;
            }
            const borderSize = buf.readUInt8(offset);
            offset += 1;
            const size = buf.readUInt16LE(offset);
            offset += 2;
            const planeCount = buf.readUInt8(offset);
            offset += 1;
            offset += 1; // reserved
            const headerMapX = buf.readUInt16LE(offset);
            offset += 2;
            const headerMapY = buf.readUInt16LE(offset);
            offset += 2;
            const baseX = buf.readInt32LE(offset);
            offset += 4;
            const baseY = buf.readInt32LE(offset);
            offset += 4;
            const sizeDuplicate = buf.readUInt16LE(offset);
            offset += 2;
            const borderDuplicate = buf.readUInt16LE(offset);
            offset += 2;
            offset += 2; // padding

            if (headerMapX !== mapX || headerMapY !== mapY) {
                console.warn?.(
                    `[MapCollisionService] collision cache header mismatch for ${mapX}_${mapY}`,
                );
            }
            if (sizeDuplicate !== size || borderDuplicate !== borderSize) {
                console.warn?.(
                    `[MapCollisionService] collision cache size mismatch for ${mapX}_${mapY}`,
                );
            }

            const collisionMaps: CollisionMap[] = [];
            for (let plane = 0; plane < planeCount; plane++) {
                if (offset + 8 > buf.length) return undefined;
                const sizeX = buf.readUInt16LE(offset);
                const sizeY = buf.readUInt16LE(offset + 2);
                const flagCount = buf.readUInt32LE(offset + 4);
                offset += 8;
                const byteLength = flagCount * 4;
                if (offset + byteLength > buf.length) return undefined;
                const view = new Int32Array(buf.buffer, buf.byteOffset + offset, flagCount);
                const flags = new Int32Array(flagCount);
                flags.set(view);
                offset += byteLength;
                collisionMaps.push(new CollisionMap(sizeX, sizeY, flags));
            }

            let linkBelowMask: Uint8Array | undefined;
            let forceMin0Masks: Uint8Array[] | undefined;
            if (version === 2) {
                // v2 footer: uint32LE bitsetLen + bitsets
                if (offset + 4 <= buf.length) {
                    const bitsetLen = buf.readUInt32LE(offset);
                    offset += 4;
                    const required = bitsetLen * 5;
                    if (bitsetLen > 0 && offset + required <= buf.length) {
                        linkBelowMask = new Uint8Array(bitsetLen);
                        linkBelowMask.set(
                            new Uint8Array(buf.buffer, buf.byteOffset + offset, bitsetLen),
                        );
                        offset += bitsetLen;
                        forceMin0Masks = new Array(4);
                        for (let l = 0; l < 4; l++) {
                            const mask = new Uint8Array(bitsetLen);
                            mask.set(
                                new Uint8Array(buf.buffer, buf.byteOffset + offset, bitsetLen),
                            );
                            offset += bitsetLen;
                            forceMin0Masks[l] = mask;
                        }
                    }
                }
            }

            return {
                mapX,
                mapY,
                borderSize,
                baseX,
                baseY,
                size,
                collisionMaps,
                linkBelowMask,
                forceMin0Masks,
            };
        } catch (err) {
            console.warn?.(
                `[MapCollisionService] failed to load precomputed collision for ${mapX}_${mapY}:`,
                err,
            );
            return undefined;
        }
    }

    private ensureSceneBuilder(): SceneBuilder | undefined {
        if (this.sceneBuilder) {
            return this.sceneBuilder;
        }
        if (this.usePrecomputed && !this.includeModels) {
            const factory = getCacheLoaderFactory(this.env.info, this.env.cacheSystem as any);
            const underlays = factory.getUnderlayTypeLoader();
            const overlays = factory.getOverlayTypeLoader();
            const locTypeLoader = factory.getLocTypeLoader();
            const locModelLoader = new LocModelLoader(
                locTypeLoader,
                factory.getModelLoader(),
                factory.getTextureLoader(),
                factory.getSeqTypeLoader(),
                factory.getSeqFrameLoader(),
                factory.getSkeletalSeqLoader(),
            );
            this.sceneBuilder = new SceneBuilder(
                this.env.info,
                this.mapFileLoader,
                underlays,
                overlays,
                locTypeLoader,
                locModelLoader,
                this.env.xteas,
            );
        }
        return this.sceneBuilder;
    }

    private buildSceneSquare(mapX: number, mapY: number): ServerMapSquare | undefined {
        const borderSize = 6;
        const baseX = mapX * Scene.MAP_SQUARE_SIZE - borderSize;
        const baseY = mapY * Scene.MAP_SQUARE_SIZE - borderSize;
        const size = Scene.MAP_SQUARE_SIZE + borderSize * 2;

        try {
            const sceneBuilder = this.ensureSceneBuilder();
            if (!sceneBuilder) return undefined;
            const scene = sceneBuilder.buildScene(
                baseX,
                baseY,
                size,
                size,
                false,
                this.includeModels ? LocLoadType.MODELS : LocLoadType.NO_MODELS,
            );
            const tileMinLevels: number[][][] = new Array(scene.levels);
            for (let l = 0; l < scene.levels; l++) {
                tileMinLevels[l] = new Array(size);
                for (let x = 0; x < size; x++) {
                    tileMinLevels[l][x] = new Array<number>(size);
                    for (let y = 0; y < size; y++) {
                        tileMinLevels[l][x][y] = scene.getTileMinLevel(l, x, y);
                    }
                }
            }

            return {
                mapX,
                mapY,
                borderSize,
                baseX,
                baseY,
                size,
                collisionMaps: scene.collisionMaps,
                tileRenderFlags: scene.tileRenderFlags,
                tileHeights: scene.tileHeights,
                tileUnderlays: scene.tileUnderlays,
                tileOverlays: scene.tileOverlays,
                tileShapes: scene.tileShapes,
                tileRotations: scene.tileRotations,
                tileLightOcclusions: scene.tileLightOcclusions,
                tileMinLevels,
            };
        } catch (err) {
            console.warn?.(`[MapCollisionService] failed to build scene for ${mapX}_${mapY}:`, err);
            return undefined;
        }
    }

    private upgradeMapSquare(mapX: number, mapY: number): ServerMapSquare | undefined {
        const full = this.buildSceneSquare(mapX, mapY);
        if (!full) return undefined;
        const k = this.key(mapX, mapY);
        this.cache.set(k, full);
        return full;
    }

    private ensureTerrainData(mapX: number, mapY: number): ServerMapSquare | undefined {
        const sq = this.getMapSquare(mapX, mapY);
        if (!sq) return undefined;
        if (sq.tileHeights && sq.tileRenderFlags) return sq;
        return this.upgradeMapSquare(mapX, mapY);
    }

    getMapSquare(mapX: number, mapY: number): ServerMapSquare | undefined {
        const k = this.key(mapX, mapY);
        const cached = this.cache.get(k);
        if (cached) return cached;

        const pre = this.loadPrecomputed(mapX, mapY);
        if (pre) {
            this.cache.set(k, pre);
            return pre;
        }

        const built = this.buildSceneSquare(mapX, mapY);
        if (built) {
            this.cache.set(k, built);
            return built;
        }
        return undefined;
    }

    // Convenience helpers for server systems to query world-space data
    getTileFlagsAt(worldX: number, worldY: number, plane: number): number | undefined {
        const mapX = this.mapSquareCoord(worldX);
        const mapY = this.mapSquareCoord(worldY);
        if (mapX < 0 || mapY < 0) return undefined;
        const ms = this.getMapSquare(mapX, mapY);
        if (!ms || !ms.tileRenderFlags) return undefined;
        const lx = worldX - ms.baseX;
        const ly = worldY - ms.baseY;
        if (lx < 0 || ly < 0 || lx >= ms.size || ly >= ms.size) return undefined;
        const l = Math.max(0, Math.min(plane, 3));
        return ms.tileRenderFlags[l][lx][ly];
    }

    getTileMinLevelAt(worldX: number, worldY: number, plane: number): number | undefined {
        const mapX = this.mapSquareCoord(worldX);
        const mapY = this.mapSquareCoord(worldY);
        if (mapX < 0 || mapY < 0) return undefined;
        const ms = this.getMapSquare(mapX, mapY);
        if (!ms) return undefined;
        const lx = worldX - ms.baseX;
        const ly = worldY - ms.baseY;
        if (lx < 0 || ly < 0 || lx >= ms.size || ly >= ms.size) return undefined;
        const l = Math.max(0, Math.min(plane, 3));
        if (ms.tileMinLevels) {
            return ms.tileMinLevels[l][lx][ly];
        }
        if (!ms.linkBelowMask || !ms.forceMin0Masks || ms.forceMin0Masks.length < 4) {
            return undefined;
        }
        const idx = lx * ms.size + ly;
        const force0 = !!ms.forceMin0Masks[l] && bitsetGet(ms.forceMin0Masks[l], idx);
        if (force0) return 0;
        if (l > 0 && bitsetGet(ms.linkBelowMask, idx)) return l - 1;
        return l;
    }

    getHeightAt(worldX: number, worldY: number, plane: number): number | undefined {
        const mapX = this.mapSquareCoord(worldX);
        const mapY = this.mapSquareCoord(worldY);
        if (mapX < 0 || mapY < 0) return undefined;
        const ms = this.ensureTerrainData(mapX, mapY);
        if (!ms || !ms.tileHeights) return undefined;
        const lx = worldX - ms.baseX;
        const ly = worldY - ms.baseY;
        if (lx < 0 || ly < 0 || lx >= ms.size || ly >= ms.size) return undefined;
        const l = Math.max(0, Math.min(plane, 3));
        // Height map is (size+1)x(size+1); clamp to range
        const hx = Math.max(0, Math.min(lx, ms.size));
        const hy = Math.max(0, Math.min(ly, ms.size));
        return ms.tileHeights[l][hx][hy];
    }

    sampleHeight(worldXUnits: number, worldYUnits: number, plane: number): number | undefined {
        const tileX = worldXUnits >> 7;
        const tileY = worldYUnits >> 7;
        const fracX = worldXUnits & 0x7f;
        const fracY = worldYUnits & 0x7f;
        const mapX = this.mapSquareCoord(tileX);
        const mapY = this.mapSquareCoord(tileY);
        if (mapX < 0 || mapY < 0) return undefined;
        const ms = this.ensureTerrainData(mapX, mapY);
        if (!ms || !ms.tileHeights || !ms.tileRenderFlags) return undefined;
        const lx = tileX - ms.baseX;
        const ly = tileY - ms.baseY;
        if (
            lx < 0 ||
            ly < 0 ||
            lx + 1 >= ms.tileHeights[0].length ||
            ly + 1 >= ms.tileHeights[0][0].length
        ) {
            return undefined;
        }
        let level = Math.max(0, Math.min(plane, 3));
        if (level < 3) {
            const flags = ms.tileRenderFlags[1];
            if (flags) {
                const flag = flags[lx]?.[ly];
                if (flag !== undefined && (flag & 2) === 2) {
                    level = level + 1;
                }
            }
        }
        const heights = ms.tileHeights[level];
        const h00 = heights[lx][ly];
        const h10 = heights[lx + 1][ly];
        const h01 = heights[lx][ly + 1];
        const h11 = heights[lx + 1][ly + 1];
        const interpRow0 = ((128 - fracX) * h00 + fracX * h10) >> 7;
        const interpRow1 = ((128 - fracX) * h01 + fracX * h11) >> 7;
        return ((128 - fracY) * interpRow0 + fracY * interpRow1) >> 7;
    }
}
