import { MapFileIndex, getMapSquareId } from "../rs/map/MapFileIndex";
import { Scene } from "../rs/scene/Scene";
import { Camera } from "./Camera";

// Returns squared distance (no sqrt needed for sorting)
function getMapDistanceSq(x: number, z: number, mapX: number, mapY: number): number {
    const centerX = mapX * Scene.MAP_SQUARE_SIZE + 32;
    const centerY = mapY * Scene.MAP_SQUARE_SIZE + 32;
    const dx = Math.max(Math.abs(x - centerX) - 32, 0);
    const dz = Math.max(Math.abs(z - centerY) - 32, 0);
    return dx * dx + dz * dz;
}

type LoadMapFunction = (mapX: number, mapY: number, streamGeneration?: number) => void;

export interface MapSquare {
    mapX: number;
    mapY: number;

    canRender(frameCount: number): boolean;

    delete(): void;
}

export class MapManager<T extends MapSquare> {
    static readonly MAX_MAP_X = 100;
    static readonly MAX_MAP_Y = 200;
    // OSRS top-level scene window is 104x104 tiles, rebased by server packets.
    static readonly SCENE_STREAM_SIZE_TILES = 104;
    static readonly SCENE_STREAM_HALF_TILES = MapManager.SCENE_STREAM_SIZE_TILES >> 1;
    // OSRS expanded loading grows scene bounds in 8-tile steps, up to 5 levels.
    static readonly SCENE_EXPANDED_STEP_TILES = 8;
    static readonly SCENE_MAX_EXPANDED_LEVEL = 5;
    // Scene base rebases when local player exits [16, 88) in the 104x104 window.
    static readonly SCENE_REBASE_MIN_LOCAL_TILE = 16;
    static readonly SCENE_REBASE_MAX_LOCAL_TILE = 88;

    static mapIntersectBox: number[][] = [
        [0, (-Scene.UNITS_LEVEL_HEIGHT * 10) / 128, 0],
        [0, (Scene.UNITS_LEVEL_HEIGHT * 3) / 128, 0],
    ];

    invalidMapIds: Set<number> = new Set();
    loadingMapIds: Set<number> = new Set();

    // Legacy resident budget knobs kept for compatibility with existing settings UI.
    // Top-level streaming now prunes maps strictly to the active grid for OSRS parity.
    maxResidentMaps: number = 128;
    private _useCounter: number = 1;
    private _lastUsed: Map<number, number> = new Map();

    // Current map square the player is in
    currentMapX: number = -1;
    currentMapY: number = -1;
    currentMapRadius: number = -1;

    // Target streaming grid (what we are currently loading toward).
    gridMapCount: number = 0;
    gridMapIds: number[] = [];
    private gridMapIdSet: Set<number> = new Set();
    gridMinMapX: number = -1;
    gridMaxMapX: number = -1;
    gridMinMapY: number = -1;
    gridMaxMapY: number = -1;
    private usingSceneBaseStreaming: boolean = false;
    private currentSceneBaseX: number = -1;
    private currentSceneBaseY: number = -1;
    private currentExpandedMapLoading: number = 0;
    // Pre-calculated distances for sorting (avoids recalculating in sort comparator)
    private gridMapDistances: Map<number, number> = new Map();
    private gridRevision: number = 0;
    // Active render grid (what is currently shown).
    private activeGridMapCount: number = 0;
    private activeGridMapIds: number[] = [];
    private activeGridMapIdSet: Set<number> = new Set();
    private activeGridMinMapX: number = -1;
    private activeGridMaxMapX: number = -1;
    private activeGridMinMapY: number = -1;
    private activeGridMaxMapY: number = -1;
    private activeUsingSceneBaseStreaming: boolean = false;
    private activeSceneBaseX: number = -1;
    private activeSceneBaseY: number = -1;
    private activeExpandedMapLoading: number = 0;
    private gridTransitionPending: boolean = false;
    private transitionRenderMapIds: number[] = [];

    visibleMapCount: number = 0;
    visibleMaps: T[] = [];

    mapSquares: Map<number, T> = new Map();

    /**
     * Optional hooks for systems that need to react to map loads / view changes.
     * Kept as lightweight callbacks to avoid introducing an event-emitter dependency.
     */
    onMapAdded?: (mapX: number, mapY: number) => void;
    onMapRemoved?: (mapX: number, mapY: number) => void;
    onCurrentMapChanged?: (mapX: number, mapY: number, mapRadius: number) => void;

    constructor(
        readonly maxQueuedTasks: number,
        readonly loadMapFunction: LoadMapFunction,
    ) {}

    setMaxResidentMaps(limit: number): void {
        // Hard safety cap to avoid accidental multi-GB GPU/CPU memory growth.
        this.maxResidentMaps = Math.max(0, Math.min(limit | 0, 256));
    }

    init(mapFileIndex: MapFileIndex, fillEmptyTerrain: boolean): void {
        this.cleanUp();
        for (let x = 0; x < MapManager.MAX_MAP_X; x++) {
            for (let y = 0; y < MapManager.MAX_MAP_Y; y++) {
                const exists = mapFileIndex.getTerrainArchiveId(x, y) !== -1;
                if (exists) {
                    continue;
                }
                if (y < 100 && fillEmptyTerrain) {
                    let hasNeighbour = false;
                    loop: for (let nx = x - 2; nx <= x + 2; nx++) {
                        for (let ny = y - 2; ny <= y + 2; ny++) {
                            const neighbourExists = mapFileIndex.getTerrainArchiveId(nx, ny) !== -1;
                            if (neighbourExists) {
                                hasNeighbour = true;
                                break loop;
                            }
                        }
                    }
                    if (hasNeighbour) {
                        continue;
                    }
                }
                this.invalidMapIds.add(getMapSquareId(x, y));
            }
        }
        console.log("Invalid map count", this.invalidMapIds.size);
    }

    isMapVisible(camera: Camera, mapX: number, mapY: number): boolean {
        const baseX = mapX * Scene.MAP_SQUARE_SIZE;
        const baseY = mapY * Scene.MAP_SQUARE_SIZE;
        const endX = baseX + Scene.MAP_SQUARE_SIZE;
        const endY = baseY + Scene.MAP_SQUARE_SIZE;

        MapManager.mapIntersectBox[0][0] = baseX;
        MapManager.mapIntersectBox[0][2] = baseY;

        MapManager.mapIntersectBox[1][0] = endX;
        MapManager.mapIntersectBox[1][2] = endY;

        return camera.frustum.intersectsBox(MapManager.mapIntersectBox);
    }

    clearMaps(): void {
        this.invalidMapIds.clear();
        this.loadingMapIds.clear();
        this._lastUsed.clear();
        this.gridMapIdSet.clear();
        this.gridMinMapX = -1;
        this.gridMaxMapX = -1;
        this.gridMinMapY = -1;
        this.gridMaxMapY = -1;
        this.activeGridMapCount = 0;
        this.activeGridIdsClear();
        this.activeGridBoundsReset();
        this.activeUsingSceneBaseStreaming = false;
        this.activeSceneBaseX = -1;
        this.activeSceneBaseY = -1;
        this.currentExpandedMapLoading = 0;
        this.activeExpandedMapLoading = 0;
        this.gridTransitionPending = false;
        for (const map of this.mapSquares.values()) {
            map.delete();
            try {
                this.onMapRemoved?.(map.mapX | 0, map.mapY | 0);
            } catch (error) {
                console.log("[MapManager] onMapRemoved callback failed", {
                    mapX: map.mapX | 0,
                    mapY: map.mapY | 0,
                    error,
                });
            }
        }
        this.mapSquares.clear();
    }

    getMap(mapX: number, mapY: number): T | undefined {
        return this.mapSquares.get(getMapSquareId(mapX, mapY));
    }

    getGridRevision(): number {
        return this.gridRevision | 0;
    }

    getGridMapIdsSnapshot(): number[] {
        return this.gridMapIds.slice(0, this.gridMapCount);
    }

    isMapInCurrentGrid(mapX: number, mapY: number): boolean {
        const mapId = getMapSquareId(mapX, mapY);
        if (this.activeGridMapIdSet.has(mapId)) return true;
        return this.gridTransitionPending && this.gridMapIdSet.has(mapId);
    }

    isMapInTargetGrid(mapX: number, mapY: number): boolean {
        return this.gridMapIdSet.has(getMapSquareId(mapX, mapY));
    }

    private resolveGridTileBounds(
        useSceneBaseStreaming: boolean,
        sceneBaseX: number,
        sceneBaseY: number,
        expandedMapLoading: number,
        minMapX: number,
        maxMapX: number,
        minMapY: number,
        maxMapY: number,
    ):
        | {
              minX: number;
              maxX: number;
              minY: number;
              maxY: number;
          }
        | undefined {
        if (useSceneBaseStreaming && sceneBaseX >= 0 && sceneBaseY >= 0) {
            const expandedTiles =
                Math.max(0, Math.min(MapManager.SCENE_MAX_EXPANDED_LEVEL, expandedMapLoading | 0)) *
                MapManager.SCENE_EXPANDED_STEP_TILES;
            return {
                minX: sceneBaseX - expandedTiles,
                maxX: sceneBaseX + MapManager.SCENE_STREAM_SIZE_TILES + expandedTiles,
                minY: sceneBaseY - expandedTiles,
                maxY: sceneBaseY + MapManager.SCENE_STREAM_SIZE_TILES + expandedTiles,
            };
        }
        if (minMapX < 0 || minMapY < 0 || maxMapX < minMapX || maxMapY < minMapY) {
            return undefined;
        }
        return {
            minX: minMapX * Scene.MAP_SQUARE_SIZE,
            maxX: (maxMapX + 1) * Scene.MAP_SQUARE_SIZE,
            minY: minMapY * Scene.MAP_SQUARE_SIZE,
            maxY: (maxMapY + 1) * Scene.MAP_SQUARE_SIZE,
        };
    }

    getGridTileBounds():
        | {
              minX: number;
              maxX: number;
              minY: number;
              maxY: number;
          }
        | undefined {
        return this.resolveGridTileBounds(
            this.activeUsingSceneBaseStreaming,
            this.activeSceneBaseX,
            this.activeSceneBaseY,
            this.activeExpandedMapLoading,
            this.activeGridMinMapX,
            this.activeGridMaxMapX,
            this.activeGridMinMapY,
            this.activeGridMaxMapY,
        );
    }

    addMap(mapX: number, mapY: number, mapSquare: T): void {
        const mapId = getMapSquareId(mapX, mapY);
        this.loadingMapIds.delete(mapId);
        this.invalidMapIds.delete(mapId);
        const prev = this.mapSquares.get(mapId);
        this.mapSquares.set(mapId, mapSquare);
        this._lastUsed.set(mapId, this._useCounter++);
        if (prev && prev !== mapSquare) {
            try {
                prev.delete();
            } catch (error) {
                console.log("[MapManager] Failed to delete replaced map", {
                    mapX: mapX | 0,
                    mapY: mapY | 0,
                    error,
                });
            }
        }
        try {
            this.onMapAdded?.(mapX | 0, mapY | 0);
        } catch (error) {
            console.log("[MapManager] onMapAdded callback failed", {
                mapX: mapX | 0,
                mapY: mapY | 0,
                error,
            });
        }
    }

    removeMap(mapX: number, mapY: number): void {
        const mapId = getMapSquareId(mapX, mapY);
        const map = this.mapSquares.get(mapId);
        if (map) {
            map.delete();
            this.mapSquares.delete(mapId);
            this._lastUsed.delete(mapId);
            try {
                this.onMapRemoved?.(map.mapX | 0, map.mapY | 0);
            } catch (error) {
                console.log("[MapManager] onMapRemoved callback failed", {
                    mapX: map.mapX | 0,
                    mapY: map.mapY | 0,
                    error,
                });
            }
        }
    }

    addInvalidMap(mapX: number, mapY: number): void {
        const mapId = getMapSquareId(mapX, mapY);
        this.invalidMapIds.add(mapId);
        this.loadingMapIds.delete(mapId);
    }

    loadMap(
        mapX: number,
        mapY: number,
        forceReload: boolean = false,
        streamGeneration: number = this.gridRevision,
    ): void {
        const mapId = getMapSquareId(mapX, mapY);
        if (
            (!forceReload && this.mapSquares.has(mapId)) ||
            this.invalidMapIds.has(mapId) ||
            this.loadingMapIds.has(mapId)
        ) {
            return;
        }
        this.loadingMapIds.add(mapId);
        this.loadMapFunction(mapX, mapY, streamGeneration | 0);
    }

    private pruneOutsideGrid(gridSet: Set<number>): void {
        const staleMapIds: number[] = [];
        for (const mapId of this.mapSquares.keys()) {
            if (!gridSet.has(mapId)) {
                staleMapIds.push(mapId);
            }
        }

        for (const mapId of staleMapIds) {
            const map = this.mapSquares.get(mapId);
            if (!map) continue;
            try {
                map.delete();
            } catch (error) {
                console.log("[MapManager] Failed to delete pruned map", {
                    mapX: map.mapX | 0,
                    mapY: map.mapY | 0,
                    error,
                });
            }
            this.mapSquares.delete(mapId);
            this._lastUsed.delete(mapId);
            try {
                this.onMapRemoved?.(map.mapX | 0, map.mapY | 0);
            } catch (error) {
                console.log("[MapManager] onMapRemoved callback failed", {
                    mapX: map.mapX | 0,
                    mapY: map.mapY | 0,
                    error,
                });
            }
        }

        const staleLoadingIds: number[] = [];
        for (const mapId of this.loadingMapIds) {
            if (!gridSet.has(mapId)) {
                staleLoadingIds.push(mapId);
            }
        }
        for (const mapId of staleLoadingIds) {
            this.loadingMapIds.delete(mapId);
        }
    }

    private activeGridIdsClear(): void {
        this.activeGridMapIds.length = 0;
        this.activeGridMapIdSet.clear();
    }

    private activeGridBoundsReset(): void {
        this.activeGridMinMapX = -1;
        this.activeGridMaxMapX = -1;
        this.activeGridMinMapY = -1;
        this.activeGridMaxMapY = -1;
    }

    private isTargetGridReady(): boolean {
        for (let i = 0; i < this.gridMapCount; i++) {
            const mapId = this.gridMapIds[i];
            if (this.mapSquares.has(mapId) || this.invalidMapIds.has(mapId)) {
                continue;
            }
            return false;
        }
        return true;
    }

    private commitTargetGridAsActive(): void {
        this.activeGridMapCount = this.gridMapCount;
        this.activeGridMapIds = this.gridMapIds.slice(0, this.gridMapCount);
        this.activeGridMapIdSet = new Set(this.gridMapIdSet);
        this.activeGridMinMapX = this.gridMinMapX;
        this.activeGridMaxMapX = this.gridMaxMapX;
        this.activeGridMinMapY = this.gridMinMapY;
        this.activeGridMaxMapY = this.gridMaxMapY;
        this.activeUsingSceneBaseStreaming = this.usingSceneBaseStreaming;
        this.activeSceneBaseX = this.currentSceneBaseX;
        this.activeSceneBaseY = this.currentSceneBaseY;
        this.activeExpandedMapLoading = this.currentExpandedMapLoading;
        this.pruneOutsideGrid(this.activeGridMapIdSet);
        this.gridTransitionPending = false;
    }

    private resolveExpandedMapLoading(expandedMapLoading?: number): number {
        return Math.max(
            0,
            Math.min(MapManager.SCENE_MAX_EXPANDED_LEVEL, Number(expandedMapLoading) | 0),
        );
    }

    private collectRenderGridMapIds(posX: number, posZ: number): number[] {
        this.transitionRenderMapIds.length = 0;
        for (let i = 0; i < this.activeGridMapCount; i++) {
            this.transitionRenderMapIds.push(this.activeGridMapIds[i]);
        }

        this.transitionRenderMapIds.sort(
            (a, b) =>
                getMapDistanceSq(posX, posZ, a >> 8, a & 0xff) -
                getMapDistanceSq(posX, posZ, b >> 8, b & 0xff),
        );
        return this.transitionRenderMapIds;
    }

    update(
        posX: number,
        posZ: number,
        camera: Camera,
        frameCount: number,
        mapRadius: number,
        sceneBaseX?: number,
        sceneBaseY?: number,
        expandedMapLoading?: number,
    ): void {
        const playerMapX = Math.floor(posX / Scene.MAP_SQUARE_SIZE);
        const playerMapY = Math.floor(posZ / Scene.MAP_SQUARE_SIZE);
        const baseX = Number(sceneBaseX) | 0;
        const baseY = Number(sceneBaseY) | 0;
        const baseFiniteAndPositive =
            Number.isFinite(sceneBaseX as number) &&
            Number.isFinite(sceneBaseY as number) &&
            baseX >= 0 &&
            baseY >= 0;
        const expandedLoadingLevel = this.resolveExpandedMapLoading(expandedMapLoading);

        const useSceneBaseStreaming = baseFiniteAndPositive;
        const sortX = camera.getPosX();
        const sortZ = camera.getPosZ();

        // Recalculate the grid when the authoritative scene base changes
        // (OSRS-style) or, when unavailable, when player map/radius changes.
        const radiusChanged = mapRadius !== this.currentMapRadius;
        const mapSquareChanged = useSceneBaseStreaming
            ? !this.usingSceneBaseStreaming ||
              baseX !== this.currentSceneBaseX ||
              baseY !== this.currentSceneBaseY ||
              expandedLoadingLevel !== this.currentExpandedMapLoading
            : this.usingSceneBaseStreaming ||
              playerMapX !== this.currentMapX ||
              playerMapY !== this.currentMapY ||
              radiusChanged;

        if (mapSquareChanged) {
            this.gridRevision = (this.gridRevision + 1) | 0;
            let minMapX = 0;
            let maxMapX = -1;
            let minMapY = 0;
            let maxMapY = -1;

            if (useSceneBaseStreaming) {
                this.usingSceneBaseStreaming = true;
                this.currentSceneBaseX = baseX;
                this.currentSceneBaseY = baseY;
                this.currentExpandedMapLoading = expandedLoadingLevel;
                const expandedTiles = expandedLoadingLevel * MapManager.SCENE_EXPANDED_STEP_TILES;

                const sceneMinX = baseX - expandedTiles;
                const sceneMinY = baseY - expandedTiles;
                const sceneMaxX = baseX + MapManager.SCENE_STREAM_SIZE_TILES - 1 + expandedTiles;
                const sceneMaxY = baseY + MapManager.SCENE_STREAM_SIZE_TILES - 1 + expandedTiles;
                minMapX = Math.floor(sceneMinX / Scene.MAP_SQUARE_SIZE);
                maxMapX = Math.floor(sceneMaxX / Scene.MAP_SQUARE_SIZE);
                minMapY = Math.floor(sceneMinY / Scene.MAP_SQUARE_SIZE);
                maxMapY = Math.floor(sceneMaxY / Scene.MAP_SQUARE_SIZE);

                const centerTileX = baseX + MapManager.SCENE_STREAM_HALF_TILES;
                const centerTileY = baseY + MapManager.SCENE_STREAM_HALF_TILES;
                const centerMapX = Math.floor(centerTileX / Scene.MAP_SQUARE_SIZE);
                const centerMapY = Math.floor(centerTileY / Scene.MAP_SQUARE_SIZE);
                this.currentMapX = centerMapX;
                this.currentMapY = centerMapY;
                this.currentMapRadius = Math.max(
                    Math.abs(centerMapX - minMapX),
                    Math.abs(maxMapX - centerMapX),
                    Math.abs(centerMapY - minMapY),
                    Math.abs(maxMapY - centerMapY),
                );
            } else {
                this.usingSceneBaseStreaming = false;
                this.currentSceneBaseX = -1;
                this.currentSceneBaseY = -1;
                this.currentExpandedMapLoading = 0;
                this.currentMapX = playerMapX;
                this.currentMapY = playerMapY;
                this.currentMapRadius = mapRadius;
                minMapX = playerMapX - mapRadius;
                maxMapX = playerMapX + mapRadius;
                minMapY = playerMapY - mapRadius;
                maxMapY = playerMapY + mapRadius;
            }

            try {
                this.onCurrentMapChanged?.(
                    this.currentMapX | 0,
                    this.currentMapY | 0,
                    this.currentMapRadius | 0,
                );
            } catch (error) {
                console.log("[MapManager] onCurrentMapChanged callback failed", {
                    mapX: this.currentMapX | 0,
                    mapY: this.currentMapY | 0,
                    mapRadius: this.currentMapRadius | 0,
                    error,
                });
            }

            // Build the streaming grid.
            this.gridMapCount = 0;
            this.gridMapIdSet.clear();
            this.gridMinMapX = -1;
            this.gridMaxMapX = -1;
            this.gridMinMapY = -1;
            this.gridMaxMapY = -1;
            for (let mx = minMapX; mx <= maxMapX; mx++) {
                for (let my = minMapY; my <= maxMapY; my++) {
                    if (
                        mx < 0 ||
                        my < 0 ||
                        mx >= MapManager.MAX_MAP_X ||
                        my >= MapManager.MAX_MAP_Y
                    ) {
                        continue;
                    }
                    const mapId = getMapSquareId(mx, my);
                    if (this.invalidMapIds.has(mapId)) {
                        continue;
                    }
                    this.gridMapIds[this.gridMapCount++] = mapId;
                    this.gridMapIdSet.add(mapId);
                    if (this.gridMinMapX === -1 || mx < this.gridMinMapX) this.gridMinMapX = mx;
                    if (this.gridMaxMapX === -1 || mx > this.gridMaxMapX) this.gridMaxMapX = mx;
                    if (this.gridMinMapY === -1 || my < this.gridMinMapY) this.gridMinMapY = my;
                    if (this.gridMaxMapY === -1 || my > this.gridMaxMapY) this.gridMaxMapY = my;
                }
            }

            // Sort front-to-back based on camera anchor (matches RS scene traversal intent).
            this.gridMapDistances.clear();
            for (let i = 0; i < this.gridMapCount; i++) {
                const mapId = this.gridMapIds[i];
                this.gridMapDistances.set(
                    mapId,
                    getMapDistanceSq(sortX, sortZ, mapId >> 8, mapId & 0xff),
                );
            }
            this.gridMapIds.length = this.gridMapCount;
            this.gridMapIds.sort(
                (a, b) => this.gridMapDistances.get(a)! - this.gridMapDistances.get(b)!,
            );

            // Always prioritize the player's own map square first.
            // When scene-base streaming triggers the rebuild, posX/posZ may still
            // reflect the previous frame. Use the scene base center instead — it is
            // already updated by the network layer before rendering.
            const priorityMapId = getMapSquareId(this.currentMapX, this.currentMapY);
            for (let i = 1; i < this.gridMapCount; i++) {
                if (this.gridMapIds[i] === priorityMapId) {
                    const tmp = this.gridMapIds[0];
                    this.gridMapIds[0] = priorityMapId;
                    this.gridMapIds[i] = tmp;
                    break;
                }
            }

            // Check if the new grid overlaps the current active grid.
            let hasOverlap = false;
            for (let i = 0; i < this.gridMapCount; i++) {
                if (this.activeGridMapIdSet.has(this.gridMapIds[i])) {
                    hasOverlap = true;
                    break;
                }
            }

            if (hasOverlap) {
                // Walking / same-region: keep old grid visible until all new maps are ready.
                this.gridTransitionPending = true;
            } else {
                // Cross-region teleport: commit new grid immediately so maps
                // render progressively as they arrive from workers.
                this.gridTransitionPending = true;
                this.commitTargetGridAsActive();
            }
        }

        // Ensure all maps in the target streaming grid are queued.
        for (let i = 0; i < this.gridMapCount; i++) {
            const mapId = this.gridMapIds[i];
            const mapX = mapId >> 8;
            const mapY = mapId & 0xff;

            const mapSquare = this.mapSquares.get(mapId);
            if (!mapSquare) {
                this.loadMap(mapX, mapY, false, this.gridRevision);
            }
        }

        if (this.gridTransitionPending && this.isTargetGridReady()) {
            this.commitTargetGridAsActive();
        }

        // Collect visible maps from the active grid only.
        this.visibleMapCount = 0;
        const renderMapIds = this.collectRenderGridMapIds(sortX, sortZ);
        for (let i = 0; i < renderMapIds.length; i++) {
            const mapId = renderMapIds[i];

            this._lastUsed.set(mapId, this._useCounter++);
            const mapSquare = this.mapSquares.get(mapId);
            if (!mapSquare) continue;
            // Avoid coarse 64x64 frustum culling at map-square granularity.
            // It can drop edge squares too aggressively; fine-grained scene culling
            // inside the renderer handles visibility.
            if (mapSquare.canRender(frameCount)) {
                this.visibleMaps[this.visibleMapCount++] = mapSquare;
            }
        }
    }

    cleanUp(): void {
        this.gridRevision = 0;
        this.currentMapX = -1;
        this.currentMapY = -1;
        this.currentMapRadius = -1;
        this.usingSceneBaseStreaming = false;
        this.currentSceneBaseX = -1;
        this.currentSceneBaseY = -1;
        this.currentExpandedMapLoading = 0;
        this.gridMapCount = 0;
        this.gridMapIdSet.clear();
        this.gridMinMapX = -1;
        this.gridMaxMapX = -1;
        this.gridMinMapY = -1;
        this.gridMaxMapY = -1;
        this.activeGridMapCount = 0;
        this.activeGridIdsClear();
        this.activeGridBoundsReset();
        this.activeUsingSceneBaseStreaming = false;
        this.activeSceneBaseX = -1;
        this.activeSceneBaseY = -1;
        this.activeExpandedMapLoading = 0;
        this.gridTransitionPending = false;
        this.clearMaps();
    }
}
