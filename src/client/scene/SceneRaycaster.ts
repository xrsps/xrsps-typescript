import { vec3 } from "gl-matrix";

import { LocModelLoader } from "../../rs/config/loctype/LocModelLoader";
import { LocModelType } from "../../rs/config/loctype/LocModelType";
import type { LocType } from "../../rs/config/loctype/LocType";
import { getMapIndexFromTile, getMapSquareId } from "../../rs/map/MapFileIndex";
import type { Model } from "../../rs/model/Model";
import { Scene } from "../../rs/scene/Scene";
import { MapManager } from "../MapManager";
import { OsrsClient } from "../OsrsClient";
import { buildNpcAabb } from "../math/Aabb";
import { Ray, rayIntersectsBox } from "../math/Raycast";
import { BridgePlaneStrategy, sampleBridgeHeightForWorldTile } from "../roof/RoofVisibility";
import { InteractType } from "../webgl/InteractType";
import { WebGLMapSquare } from "../webgl/WebGLMapSquare";
import { resolveGroundItemStackPlane, resolveInteractionPlaneForLocal } from "./PlaneResolver";

const PLAYER_INTERACT_BASE = 0x8000;
const MODEL_WORLD_SCALE = 1.0 / 128.0;

type LocModelMesh = {
    verticesX: Int32Array;
    verticesY: Int32Array;
    verticesZ: Int32Array;
    indices1: Int32Array;
    indices2: Int32Array;
    indices3: Int32Array;
    faceAlphas?: Int8Array;
    faceColors3?: Int32Array;
    faceCount: number;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    minZ: number;
    maxZ: number;
};

export interface SceneRaycastHit {
    t: number;
    interactType: InteractType;
    interactId: number;
    mapId: number;
    tileX?: number;
    tileY?: number;
    /** For NPC hits: server ID for direct lookup (avoids iterating all NPCs) */
    npcServerId?: number;
    /** For NPC hits: ECS ID for direct access to NPC data */
    npcEcsId?: number;
    /** For player hits: ECS index for direct access to player data */
    playerEcsIndex?: number;
}

export interface SceneRaycastOptions {
    maxDistance?: number;
    maxHits?: number;
    /**
     * OSRS parity: restrict world interactions (LOC/OBJ/NPC/PLAYER) to the current client plane.
     * In the reference client this is SecureUrlRequester.Client_plane.
     */
    basePlane?: number;
}

export class SceneRaycaster {
    private tmpVec: vec3 = vec3.create();
    private interactLocModelLoader?: LocModelLoader;
    private resolvedLocTypeCache: Map<number, LocType | null> = new Map();
    private locModelMeshCache: Map<string, LocModelMesh | null> = new Map();

    constructor(
        private readonly mapManager: MapManager<WebGLMapSquare>,
        private readonly osrsClient: OsrsClient,
    ) {}

    clearCache(): void {
        this.resolvedLocTypeCache.clear();
        this.locModelMeshCache.clear();
        this.interactLocModelLoader?.clearCache();
    }

    raycast(ray: Ray, options?: SceneRaycastOptions): SceneRaycastHit[] {
        const hits: SceneRaycastHit[] = [];
        this.resolvedLocTypeCache.clear();

        const maxDistance =
            typeof options?.maxDistance === "number"
                ? options.maxDistance
                : Math.max(32, this.osrsClient.renderDistance + 32);
        if (!Number.isFinite(maxDistance) || maxDistance <= 0) {
            return hits;
        }

        const basePlane =
            typeof options?.basePlane === "number"
                ? Math.max(0, Math.min(Scene.MAX_LEVELS - 1, options.basePlane | 0))
                : undefined;

        // OSRS parity: interact buffers disable picking when full fog is reached.
        // Match that by filtering out hits beyond the current fog "end" radius (u_renderDistance).
        let fogCutoffSq: number | undefined;
        let playerWorldX: number | undefined;
        let playerWorldZ: number | undefined;
        try {
            const pe = this.osrsClient.playerEcs;
            const sid = this.osrsClient.controlledPlayerServerId;
            const idx = pe.getIndexForServerId(sid | 0);
            if (idx !== undefined) {
                playerWorldX = (pe.getX(idx) | 0) / 128.0;
                playerWorldZ = (pe.getY(idx) | 0) / 128.0;
            }
        } catch {
            // Ignore - fog filtering will be disabled
        }
        if (typeof playerWorldX === "number" && typeof playerWorldZ === "number") {
            const fogEnd = Number(this.osrsClient.renderDistance) || 0;
            if (Number.isFinite(fogEnd) && fogEnd >= 0) {
                fogCutoffSq = fogEnd * fogEnd;
            }
        }

        const dirLen2 = Math.hypot(ray.direction[0], ray.direction[2]);
        const hasPlanarDir = dirLen2 > 1e-6;

        const visibleCount = this.mapManager.visibleMapCount | 0;
        const visibleMaps = this.mapManager.visibleMaps;

        for (let i = 0; i < visibleCount; i++) {
            const map = visibleMaps[i] as WebGLMapSquare | undefined;
            if (!map) continue;

            const baseX = map.mapX * Scene.MAP_SQUARE_SIZE;
            const baseY = map.mapY * Scene.MAP_SQUARE_SIZE;

            const boxMin: [number, number, number] = [baseX, -1000, baseY];
            const boxMax: [number, number, number] = [
                baseX + Scene.MAP_SQUARE_SIZE,
                1000,
                baseY + Scene.MAP_SQUARE_SIZE,
            ];
            const hitBox = rayIntersectsBox(ray, boxMin, boxMax);
            if (!hitBox) continue;

            let tEnter = Math.max(hitBox.tMin, 0);
            let tExit = hitBox.tMax;
            if (tEnter > tExit) continue;
            if (tEnter > maxDistance) continue;
            if (tExit > maxDistance) tExit = maxDistance;
            if (tExit <= 0) continue;

            // Ground/OBJ hits via tile traversal in this map along the ray segment [tEnter, tExit]
            // Collect ground items and LOCs via efficient DDA tile traversal
            // (only visits tiles the ray actually passes through)
            this.traverseMapTiles(map, ray, tEnter, tExit, maxDistance, hits, basePlane);

            // NPC hits for this map (3D AABB in world space)
            this.collectNpcHitsForMap(map, ray, maxDistance, hits, basePlane);
        }

        // Player hits (global, then bucketed per map)
        if (hasPlanarDir) {
            this.collectPlayerHits(ray, maxDistance, hits, basePlane);
        }

        // Sort front-to-back by distance along the ray. Higher-level callers
        // can apply additional OSRS-style priority (e.g. players > NPCs > locs).
        if (
            typeof fogCutoffSq === "number" &&
            typeof playerWorldX === "number" &&
            typeof playerWorldZ === "number"
        ) {
            let write = 0;
            for (let i = 0; i < hits.length; i++) {
                const h = hits[i];
                const tx = h.tileX;
                const ty = h.tileY;
                if (typeof tx !== "number" || typeof ty !== "number") {
                    hits[write++] = h;
                    continue;
                }
                const cx = tx + 0.5;
                const cz = ty + 0.5;
                const dx = cx - playerWorldX;
                const dz = cz - playerWorldZ;
                if (dx * dx + dz * dz < fogCutoffSq) {
                    hits[write++] = h;
                }
            }
            hits.length = write;
        }
        hits.sort((a, b) => a.t - b.t);

        if (options?.maxHits && hits.length > options.maxHits) {
            return hits.slice(0, options.maxHits);
        }

        return hits;
    }

    private traverseMapTiles(
        map: WebGLMapSquare,
        ray: Ray,
        tEnter: number,
        tExit: number,
        maxDistance: number,
        hits: SceneRaycastHit[],
        basePlane?: number,
    ): void {
        const baseX = map.mapX * Scene.MAP_SQUARE_SIZE;
        const baseY = map.mapY * Scene.MAP_SQUARE_SIZE;
        const mapMaxTileX = baseX + Scene.MAP_SQUARE_SIZE - 1;
        const mapMaxTileY = baseY + Scene.MAP_SQUARE_SIZE - 1;

        // Calculate 3D entry and exit points along the ray
        const tEffectiveExit = Math.min(tExit, maxDistance);
        const entryPoint = this.tmpVec;
        ray.at(tEnter, entryPoint);
        const exitPoint = vec3.create();
        ray.at(tEffectiveExit, exitPoint);

        // Determine the tile bounding range from the 3D ray path
        // This works correctly for all camera angles including top-down
        const minTileX = Math.max(baseX, Math.floor(Math.min(entryPoint[0], exitPoint[0])));
        const maxTileX = Math.min(mapMaxTileX, Math.floor(Math.max(entryPoint[0], exitPoint[0])));
        const minTileY = Math.max(baseY, Math.floor(Math.min(entryPoint[2], exitPoint[2])));
        const maxTileY = Math.min(mapMaxTileY, Math.floor(Math.max(entryPoint[2], exitPoint[2])));

        // Track seen LOCs to avoid duplicates from multi-tile objects
        const seenLocs = new Set<string>();
        const resolvedLocTypes = new Map<number, LocType | null>();

        // Vertical bounds for tile column intersection test
        // Use generous bounds to catch all objects at any height
        const columnMinY = -500;
        const columnMaxY = 500;

        // Check each tile in the bounding range with 3D ray-box intersection
        // This is accurate for all camera angles including steep/top-down views
        for (let tileX = minTileX; tileX <= maxTileX; tileX++) {
            for (let tileY = minTileY; tileY <= maxTileY; tileY++) {
                // 3D ray-box test against the tile's vertical column
                const boxHit = rayIntersectsBox(
                    ray,
                    [tileX, columnMinY, tileY],
                    [tileX + 1, columnMaxY, tileY + 1],
                );
                if (!boxHit) continue;
                if (boxHit.tMin > maxDistance) continue;

                this.collectTileHits(
                    map,
                    ray,
                    tileX,
                    tileY,
                    maxDistance,
                    hits,
                    seenLocs,
                    resolvedLocTypes,
                    basePlane,
                );
            }
        }
    }

    private collectTileHits(
        map: WebGLMapSquare,
        ray: Ray,
        worldTileX: number,
        worldTileY: number,
        maxDistance: number,
        hits: SceneRaycastHit[],
        seenLocs?: Set<string>,
        resolvedLocTypes?: Map<number, LocType | null>,
        basePlane?: number,
    ): void {
        const baseX = map.mapX * Scene.MAP_SQUARE_SIZE;
        const baseY = map.mapY * Scene.MAP_SQUARE_SIZE;
        const localX = worldTileX - baseX;
        const localY = worldTileY - baseY;
        if (
            localX < 0 ||
            localY < 0 ||
            localX >= Scene.MAP_SQUARE_SIZE ||
            localY >= Scene.MAP_SQUARE_SIZE
        ) {
            return;
        }

        const mapId = map.id;
        const groundItems = this.osrsClient.groundItems;

        const interactionLevel =
            typeof basePlane === "number"
                ? resolveInteractionPlaneForLocal(map, basePlane | 0, localX | 0, localY | 0)
                : undefined;
        const groundItemPlane =
            typeof basePlane === "number" ? resolveGroundItemStackPlane(basePlane | 0) : undefined;

        // Ground items: approximate each occupied tile as a shallow world-space box
        // over the full tile footprint using bridge-aware ground height. This matches
        // the debug AABB overlay for dropped items.
        const groundItemStartPlane = typeof groundItemPlane === "number" ? groundItemPlane : 0;
        const groundItemEndPlane =
            typeof groundItemPlane === "number" ? groundItemPlane + 1 : Scene.MAX_LEVELS;
        for (let level = groundItemStartPlane; level < groundItemEndPlane; level++) {
            const stacks = groundItems.getStacksAt(worldTileX, worldTileY, level);
            if (!stacks || stacks.length === 0) continue;

            const minX = worldTileX;
            const minZ = worldTileY;
            const maxX = worldTileX + 1;
            const maxZ = worldTileY + 1;

            const hSample = sampleBridgeHeightForWorldTile(
                this.mapManager,
                worldTileX + 0.5,
                worldTileY + 0.5,
                level | 0,
                BridgePlaneStrategy.RENDER,
            );
            const groundY = hSample.height;
            const minY = groundY - 0.2;
            const maxY = groundY + 0.1;

            const boxHit = rayIntersectsBox(ray, [minX, minY, minZ], [maxX, maxY, maxZ]);
            if (!boxHit) continue;
            const tHit = Math.max(boxHit.tMin, 0);
            if (tHit < 0 || tHit > maxDistance) continue;

            for (const stack of stacks) {
                const interactId = stack.id | 0;
                if (!(interactId > 0)) continue;
                hits.push({
                    t: tHit,
                    interactType: InteractType.OBJ,
                    interactId,
                    mapId,
                    tileX: worldTileX,
                    tileY: worldTileY,
                });
            }
        }

        // LOC hits: check LOCs anchored at this tile AND adjacent tiles.
        // Use exact loc model geometry (AABB + per-triangle ray test) so thin/tall walls
        // like doors register reliably across their full silhouette.
        const MAX_LOC_SIZE = 4;
        const startPlane = typeof interactionLevel === "number" ? interactionLevel : 0;
        const endPlane =
            typeof interactionLevel === "number" ? interactionLevel + 1 : Scene.MAX_LEVELS;
        for (let level = startPlane; level < endPlane; level++) {
            for (let anchorDx = -(MAX_LOC_SIZE - 1); anchorDx <= 0; anchorDx++) {
                for (let anchorDy = -(MAX_LOC_SIZE - 1); anchorDy <= 0; anchorDy++) {
                    const anchorLocalX = localX + anchorDx;
                    const anchorLocalY = localY + anchorDy;
                    if (
                        anchorLocalX < 0 ||
                        anchorLocalY < 0 ||
                        anchorLocalX >= Scene.MAP_SQUARE_SIZE ||
                        anchorLocalY >= Scene.MAP_SQUARE_SIZE
                    ) {
                        continue;
                    }

                    const locIds = map.getLocIdsAtLocal(level, anchorLocalX, anchorLocalY);
                    if (!locIds || locIds.length === 0) continue;
                    const locTypeRots = map.getLocTypeRotsAtLocal(
                        level,
                        anchorLocalX,
                        anchorLocalY,
                    );

                    const anchorWorldX = baseX + anchorLocalX;
                    const anchorWorldY = baseY + anchorLocalY;

                    for (let locIndex = 0; locIndex < locIds.length; locIndex++) {
                        const locId = locIds[locIndex] | 0;
                        if (!(locId > 0)) continue;
                        const locType = this.getResolvedLocType(locId, resolvedLocTypes);
                        if (!locType || !this.isLocTypeInteractive(locType)) continue;

                        const packedTypeRot =
                            locIndex < locTypeRots.length
                                ? locTypeRots[locIndex] | 0
                                : LocModelType.NORMAL;
                        const { modelType, rawRotation, modelRotation } =
                            this.decodeLocModelTypeRotation(packedTypeRot);

                        let sizeX = Math.max(
                            1,
                            typeof locType.sizeX === "number" ? locType.sizeX : 1,
                        );
                        let sizeY = Math.max(
                            1,
                            typeof locType.sizeY === "number" ? locType.sizeY : 1,
                        );
                        if (rawRotation === 1 || rawRotation === 3) {
                            const tmp = sizeX;
                            sizeX = sizeY;
                            sizeY = tmp;
                        }

                        const locMaxX = anchorWorldX + sizeX;
                        const locMaxY = anchorWorldY + sizeY;
                        if (
                            worldTileX < anchorWorldX ||
                            worldTileX >= locMaxX ||
                            worldTileY < anchorWorldY ||
                            worldTileY >= locMaxY
                        ) {
                            continue;
                        }

                        if (seenLocs) {
                            const key = `${locId}|${level}|${anchorWorldX}|${anchorWorldY}|${packedTypeRot}`;
                            if (seenLocs.has(key)) continue;
                            seenLocs.add(key);
                        }

                        const centerX = anchorWorldX + sizeX * 0.5;
                        const centerZ = anchorWorldY + sizeY * 0.5;
                        const hSample = sampleBridgeHeightForWorldTile(
                            this.mapManager,
                            centerX,
                            centerZ,
                            level | 0,
                            BridgePlaneStrategy.RENDER,
                        );
                        const groundY = hSample.height;
                        const entityX = (anchorWorldX << 7) + (sizeX << 6);
                        const entityZ = (anchorWorldY << 7) + (sizeY << 6);

                        const tHit = this.intersectLocModel(
                            ray,
                            maxDistance,
                            locType,
                            modelType,
                            modelRotation,
                            entityX,
                            entityZ,
                            groundY,
                        );
                        if (tHit === undefined) continue;

                        hits.push({
                            t: tHit,
                            interactType: InteractType.LOC,
                            interactId: locId,
                            mapId,
                            tileX: anchorWorldX,
                            tileY: anchorWorldY,
                        });
                    }
                }
            }
        }
    }

    private collectNpcHitsForMap(
        map: WebGLMapSquare,
        ray: Ray,
        maxDistance: number,
        hits: SceneRaycastHit[],
        basePlane?: number,
    ): void {
        const npcEcs = this.osrsClient.npcEcs;
        const ids = npcEcs.queryByMap(map.mapX, map.mapY);
        if (!ids || ids.length === 0) return;

        const baseX = map.mapX * Scene.MAP_SQUARE_SIZE;
        const baseY = map.mapY * Scene.MAP_SQUARE_SIZE;
        const mapId = map.id;

        for (const ecsIdRaw of ids) {
            const ecsId = ecsIdRaw | 0;
            if (ecsId <= 0) continue;
            // Ignore NPCs that are no longer linked to a server entity; these can
            // linger temporarily in the ECS when their map is unstreamed.
            if (!npcEcs.isActive(ecsId) || !npcEcs.isLinked(ecsId)) continue;
            if ((npcEcs.getMapId(ecsId) | 0) !== mapId) continue;

            const localX = npcEcs.getX(ecsId) | 0;
            const localY = npcEcs.getY(ecsId) | 0;
            const worldX = baseX + localX / 128.0;
            const worldZ = baseY + localY / 128.0;
            const size = Math.max(1, npcEcs.getSize(ecsId) | 0);
            const interactId = npcEcs.getNpcTypeId(ecsId) | 0;
            if (!(interactId > 0)) continue;
            const npcPlane = npcEcs.getLevel(ecsId) | 0;
            if (typeof basePlane === "number" && (npcPlane | 0) !== (basePlane | 0)) {
                continue;
            }
            const aabb = buildNpcAabb({
                worldX,
                worldZ,
                level: npcPlane,
                size,
                mapManager: this.mapManager,
                npcTypeId: interactId,
                npcTypeLoader: this.osrsClient.npcTypeLoader,
            });
            const min: [number, number, number] = [aabb.minX, aabb.minY, aabb.minZ];
            const max: [number, number, number] = [aabb.maxX, aabb.maxY, aabb.maxZ];

            const boxHit = rayIntersectsBox(ray, min, max);
            if (!boxHit) continue;
            const tHit = Math.max(boxHit.tMin, 0);
            if (tHit < 0 || tHit > maxDistance) continue;

            // Include server ID and ECS ID for efficient lookup in menu building
            const serverId = npcEcs.getServerId(ecsId) | 0;

            hits.push({
                t: tHit,
                interactType: InteractType.NPC,
                interactId,
                mapId,
                tileX: Math.floor(worldX),
                tileY: Math.floor(worldZ),
                npcServerId: serverId > 0 ? serverId : undefined,
                npcEcsId: ecsId,
            });
        }
    }

    private collectPlayerHits(
        ray: Ray,
        maxDistance: number,
        hits: SceneRaycastHit[],
        basePlane?: number,
    ): void {
        const pe = this.osrsClient.playerEcs;
        const n = pe.size();
        if (!n) return;

        const byMap = new Map<number, number[]>();
        for (let i = 0; i < n; i++) {
            const playerPlane = pe.getLevel(i) | 0;
            if (typeof basePlane === "number" && (playerPlane | 0) !== (basePlane | 0)) {
                continue;
            }
            const px = pe.getX(i) | 0;
            const py = pe.getY(i) | 0;
            const tileX = (px >> 7) | 0;
            const tileY = (py >> 7) | 0;
            const mapX = getMapIndexFromTile(tileX);
            const mapY = getMapIndexFromTile(tileY);
            const mapId = getMapSquareId(mapX, mapY);
            let list = byMap.get(mapId);
            if (!list) {
                list = [];
                byMap.set(mapId, list);
            }
            list.push(i);
        }

        const visibleCount = this.mapManager.visibleMapCount | 0;
        const visibleMaps = this.mapManager.visibleMaps;
        for (let i = 0; i < visibleCount; i++) {
            const map = visibleMaps[i] as WebGLMapSquare | undefined;
            if (!map) continue;
            const mapId = map.id;
            const playerIndices = byMap.get(mapId);
            if (!playerIndices || playerIndices.length === 0) continue;

            for (let indexInMap = 0; indexInMap < playerIndices.length; indexInMap++) {
                const pid = playerIndices[indexInMap] | 0;
                const px = pe.getX(pid) | 0;
                const py = pe.getY(pid) | 0;
                const worldX = px / 128.0;
                const worldZ = py / 128.0;
                const interactId = PLAYER_INTERACT_BASE + (indexInMap & 0x7fff);
                const half = 0.6;
                const playerPlane = pe.getLevel(pid) | 0;
                if (typeof basePlane === "number" && (playerPlane | 0) !== (basePlane | 0)) {
                    continue;
                }
                const hSample = sampleBridgeHeightForWorldTile(
                    this.mapManager,
                    worldX,
                    worldZ,
                    playerPlane,
                    BridgePlaneStrategy.RENDER,
                );
                const groundY = hSample.height;
                const topY = groundY - 2.5;
                const minY = Math.min(groundY, topY);
                const maxY = Math.max(groundY, topY);

                const min: [number, number, number] = [worldX - half, minY, worldZ - half];
                const max: [number, number, number] = [worldX + half, maxY, worldZ + half];

                const boxHit = rayIntersectsBox(ray, min, max);
                if (!boxHit) continue;
                const tHit = Math.max(boxHit.tMin, 0);
                if (tHit < 0 || tHit > maxDistance) continue;

                hits.push({
                    t: tHit,
                    interactType: InteractType.NPC,
                    interactId,
                    mapId,
                    tileX: Math.floor(worldX),
                    tileY: Math.floor(worldZ),
                    playerEcsIndex: pid, // Direct ECS index for efficient lookup
                });
            }
        }
    }

    private getResolvedLocType(
        locId: number,
        scratch?: Map<number, LocType | null>,
    ): LocType | undefined {
        const id = locId | 0;
        const cache = scratch ? scratch : this.resolvedLocTypeCache;
        if (cache.has(id)) {
            const cached = cache.get(id);
            return cached !== null ? cached : undefined;
        }

        let resolved: LocType | undefined;
        try {
            let loc = this.osrsClient.locTypeLoader.load(id);
            if (loc?.transforms) {
                const transformed = loc.transform(
                    this.osrsClient.varManager,
                    this.osrsClient.locTypeLoader,
                );
                if (transformed) {
                    loc = transformed;
                }
            }
            resolved = loc !== null ? loc : undefined;
        } catch {
            resolved = undefined;
        }

        cache.set(id, resolved !== undefined ? resolved : null);
        return resolved;
    }

    private isLocTypeInteractive(locType: LocType): boolean {
        const actions = locType.actions;
        if (Array.isArray(actions)) {
            for (const action of actions) {
                if (action && action.length > 0) {
                    return true;
                }
            }
        }
        return (locType.isInteractive | 0) === 1;
    }

    private decodeLocModelTypeRotation(packedTypeRot: number): {
        modelType: LocModelType;
        rawRotation: number;
        modelRotation: number;
    } {
        const rawType = (packedTypeRot | 0) & 0x3f;
        const rawRotation = ((packedTypeRot | 0) >> 6) & 0x3;
        let modelType = rawType as LocModelType;
        let modelRotation = rawRotation;
        if (modelType === LocModelType.NORMAL_DIAGIONAL) {
            modelType = LocModelType.NORMAL;
            modelRotation = (rawRotation + 4) & 0x7;
        }
        return { modelType, rawRotation, modelRotation };
    }

    private getInteractLocModelLoader(): LocModelLoader | undefined {
        if (this.interactLocModelLoader) {
            return this.interactLocModelLoader;
        }
        const textureLoader = this.osrsClient.textureLoader;
        const modelLoader = this.osrsClient.modelLoader;
        const locTypeLoader = this.osrsClient.locTypeLoader;
        const seqTypeLoader = this.osrsClient.seqTypeLoader;
        const seqFrameLoader = this.osrsClient.seqFrameLoader;
        if (!textureLoader || !modelLoader || !locTypeLoader || !seqTypeLoader || !seqFrameLoader) {
            return undefined;
        }
        this.interactLocModelLoader = new LocModelLoader(
            locTypeLoader,
            modelLoader,
            textureLoader,
            seqTypeLoader,
            seqFrameLoader,
            this.osrsClient.skeletalSeqLoader,
        );
        return this.interactLocModelLoader;
    }

    private getLocModelMesh(
        locType: LocType,
        modelType: LocModelType,
        modelRotation: number,
    ): LocModelMesh | undefined {
        const key = `${locType.id | 0}|${modelType | 0}|${modelRotation | 0}`;
        const cached = this.locModelMeshCache.get(key);
        if (cached !== undefined) {
            return cached !== null ? cached : undefined;
        }

        const locModelLoader = this.getInteractLocModelLoader();
        if (!locModelLoader) {
            this.locModelMeshCache.set(key, null);
            return undefined;
        }

        const model = locModelLoader.getModelAnimated(locType, modelType, modelRotation, -1, -1);
        if (
            !model ||
            !model.verticesX ||
            !model.verticesY ||
            !model.verticesZ ||
            !model.indices1 ||
            !model.indices2 ||
            !model.indices3
        ) {
            this.locModelMeshCache.set(key, null);
            return undefined;
        }

        const mesh = this.buildLocModelMesh(model);
        this.locModelMeshCache.set(key, mesh !== undefined ? mesh : null);
        return mesh;
    }

    private buildLocModelMesh(model: Model): LocModelMesh | undefined {
        const vertexCount = model.verticesCount | 0;
        if (vertexCount <= 0) return undefined;

        const verticesX = model.verticesX;
        const verticesY = model.verticesY;
        const verticesZ = model.verticesZ;
        const indices1 = model.indices1;
        const indices2 = model.indices2;
        const indices3 = model.indices3;

        const faceCount = Math.min(
            model.faceCount | 0,
            indices1.length | 0,
            indices2.length | 0,
            indices3.length | 0,
        );
        if (faceCount <= 0) return undefined;

        let minX = verticesX[0] | 0;
        let maxX = minX;
        let minY = verticesY[0] | 0;
        let maxY = minY;
        let minZ = verticesZ[0] | 0;
        let maxZ = minZ;
        for (let i = 1; i < vertexCount; i++) {
            const x = verticesX[i] | 0;
            const y = verticesY[i] | 0;
            const z = verticesZ[i] | 0;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
            if (z < minZ) minZ = z;
            if (z > maxZ) maxZ = z;
        }

        const faceColors3 =
            model.faceColors3 && model.faceColors3.length >= faceCount
                ? model.faceColors3
                : undefined;
        const faceAlphas =
            model.faceAlphas && model.faceAlphas.length >= faceCount ? model.faceAlphas : undefined;

        return {
            verticesX,
            verticesY,
            verticesZ,
            indices1,
            indices2,
            indices3,
            faceColors3,
            faceAlphas,
            faceCount,
            minX,
            maxX,
            minY,
            maxY,
            minZ,
            maxZ,
        };
    }

    private intersectLocModel(
        ray: Ray,
        maxDistance: number,
        locType: LocType,
        modelType: LocModelType,
        modelRotation: number,
        entityX: number,
        entityZ: number,
        groundY: number,
    ): number | undefined {
        const mesh = this.getLocModelMesh(locType, modelType, modelRotation);
        if (!mesh) {
            return undefined;
        }

        const baseX = entityX * MODEL_WORLD_SCALE;
        const baseZ = entityZ * MODEL_WORLD_SCALE;
        const minX = baseX + mesh.minX * MODEL_WORLD_SCALE;
        const maxX = baseX + mesh.maxX * MODEL_WORLD_SCALE;
        const minY = groundY + mesh.minY * MODEL_WORLD_SCALE;
        const maxY = groundY + mesh.maxY * MODEL_WORLD_SCALE;
        const minZ = baseZ + mesh.minZ * MODEL_WORLD_SCALE;
        const maxZ = baseZ + mesh.maxZ * MODEL_WORLD_SCALE;

        const boxHit = rayIntersectsBox(ray, [minX, minY, minZ], [maxX, maxY, maxZ]);
        if (!boxHit) return undefined;

        const tBoxMin = Math.max(boxHit.tMin, 0);
        if (tBoxMin > maxDistance) return undefined;

        let bestT = Number.POSITIVE_INFINITY;
        for (let i = 0; i < mesh.faceCount; i++) {
            if (mesh.faceColors3 && mesh.faceColors3[i] === -2) continue;
            if (mesh.faceAlphas && (mesh.faceAlphas[i] & 0xff) >= 254) continue;

            const a = mesh.indices1[i] | 0;
            const b = mesh.indices2[i] | 0;
            const c = mesh.indices3[i] | 0;
            if (
                a < 0 ||
                b < 0 ||
                c < 0 ||
                a >= mesh.verticesX.length ||
                b >= mesh.verticesX.length ||
                c >= mesh.verticesX.length
            ) {
                continue;
            }

            const ax = baseX + mesh.verticesX[a] * MODEL_WORLD_SCALE;
            const ay = groundY + mesh.verticesY[a] * MODEL_WORLD_SCALE;
            const az = baseZ + mesh.verticesZ[a] * MODEL_WORLD_SCALE;
            const bx = baseX + mesh.verticesX[b] * MODEL_WORLD_SCALE;
            const by = groundY + mesh.verticesY[b] * MODEL_WORLD_SCALE;
            const bz = baseZ + mesh.verticesZ[b] * MODEL_WORLD_SCALE;
            const cx = baseX + mesh.verticesX[c] * MODEL_WORLD_SCALE;
            const cy = groundY + mesh.verticesY[c] * MODEL_WORLD_SCALE;
            const cz = baseZ + mesh.verticesZ[c] * MODEL_WORLD_SCALE;

            const t = this.intersectRayTriangle(ray, ax, ay, az, bx, by, bz, cx, cy, cz);
            if (t === null || t < tBoxMin || t > maxDistance || t >= bestT) {
                continue;
            }
            bestT = t;
        }

        return Number.isFinite(bestT) ? bestT : undefined;
    }

    private intersectRayTriangle(
        ray: Ray,
        ax: number,
        ay: number,
        az: number,
        bx: number,
        by: number,
        bz: number,
        cx: number,
        cy: number,
        cz: number,
    ): number | null {
        const EPS = 1e-6;

        const edge1x = bx - ax;
        const edge1y = by - ay;
        const edge1z = bz - az;
        const edge2x = cx - ax;
        const edge2y = cy - ay;
        const edge2z = cz - az;

        const dirx = ray.direction[0];
        const diry = ray.direction[1];
        const dirz = ray.direction[2];

        const px = diry * edge2z - dirz * edge2y;
        const py = dirz * edge2x - dirx * edge2z;
        const pz = dirx * edge2y - diry * edge2x;

        const det = edge1x * px + edge1y * py + edge1z * pz;
        if (det > -EPS && det < EPS) {
            return null;
        }
        const invDet = 1 / det;

        const tx = ray.origin[0] - ax;
        const ty = ray.origin[1] - ay;
        const tz = ray.origin[2] - az;

        const u = (tx * px + ty * py + tz * pz) * invDet;
        if (u < 0 || u > 1) {
            return null;
        }

        const qx = ty * edge1z - tz * edge1y;
        const qy = tz * edge1x - tx * edge1z;
        const qz = tx * edge1y - ty * edge1x;

        const v = (dirx * qx + diry * qy + dirz * qz) * invDet;
        if (v < 0 || u + v > 1) {
            return null;
        }

        const t = (edge2x * qx + edge2y * qy + edge2z * qz) * invDet;
        if (t <= EPS) {
            return null;
        }
        return t;
    }
}
