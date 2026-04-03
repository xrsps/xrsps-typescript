import { DirectionFlag } from "../../../src/shared/Direction";
import type { SailingWorldView } from "../game/sailing/SailingWorldView";
import { CollisionOverlayStore } from "../world/CollisionOverlayStore";
import { MapCollisionService } from "../world/MapCollisionService";
import { resolveCollisionPlaneAt } from "../world/PlaneResolver";
import { BLOCKED_STATEGY, NORMAL_STRATEGY } from "./legacy/pathfinder/CollisionStrategy";
import { Pathfinder } from "./legacy/pathfinder/Pathfinder";
import {
    ApproximateRouteStrategy,
    ExactRouteStrategy,
    RectAdjacentRouteStrategy,
    RouteStrategy,
} from "./legacy/pathfinder/RouteStrategy";
import { CollisionFlag } from "./legacy/pathfinder/flag/CollisionFlag";

export type PathRequest = {
    from: { x: number; y: number; plane: number };
    to: { x: number; y: number };
    size?: number;
    worldViewId?: number;
};

const clampPlane = (plane: number): number => Math.max(0, Math.min(Math.trunc(plane), 3));
const normalizePathSize = (size?: number): number => Math.max(1, Math.trunc(size ?? 1));
const normalizeMaxSteps = (maxSteps?: number): number => Math.max(0, Math.trunc(maxSteps ?? 128));

export class PathService {
    private map: MapCollisionService;
    private pf: Pathfinder;
    private collisionOverlays?: CollisionOverlayStore;
    private worldViewCollision: Map<number, SailingWorldView> = new Map();

    constructor(map: MapCollisionService, graphSize = 128) {
        this.map = map;
        this.pf = new Pathfinder(graphSize);
    }

    /**
     * Set the collision overlay store for dynamic collision modifications.
     * This allows doors, dynamic objects, etc. to modify pathfinding.
     */
    setCollisionOverlays(overlays: CollisionOverlayStore): void {
        this.collisionOverlays = overlays;
    }

    /**
     * Get the current collision overlay store.
     */
    getCollisionOverlays(): CollisionOverlayStore | undefined {
        return this.collisionOverlays;
    }

    registerWorldViewCollision(worldViewId: number, view: SailingWorldView): void {
        this.worldViewCollision.set(worldViewId, view);
    }

    removeWorldViewCollision(worldViewId: number): void {
        this.worldViewCollision.delete(worldViewId);
    }

    /**
     * Resolve the effective worldViewId for a pathfinding request.
     *
     * If the request already carries a worldViewId, honour it.
     * Otherwise, auto-detect by checking whether the source tile falls inside
     * any registered WorldView.  This ensures EVERY pathfinding call is
     * automatically constrained — callers never need to remember to pass
     * worldViewId themselves.
     */
    private resolveWorldViewId(req: PathRequest): number | undefined {
        if (req.worldViewId !== undefined && req.worldViewId >= 0) return req.worldViewId;
        for (const [id, wv] of this.worldViewCollision) {
            if (wv.containsWorldTile(req.from.x, req.from.y)) return id;
        }
        return undefined;
    }

    /** Clamp a destination tile to the bounds of a WorldView (no-op when not in one). */
    clampToWorldView(worldViewId: number | undefined, x: number, y: number): { x: number; y: number } {
        if (worldViewId === undefined || worldViewId < 0) return { x, y };
        const wv = this.worldViewCollision.get(worldViewId);
        if (!wv) return { x, y };
        return {
            x: Math.max(wv.baseX, Math.min(wv.baseX + wv.sizeX - 1, x)),
            y: Math.max(wv.baseY, Math.min(wv.baseY + wv.sizeY - 1, y)),
        };
    }

    /**
     * OSRS NPC "Dumb Pathfinder" - naive diagonal-then-cardinal approach.
     *
     * NPCs in OSRS do NOT use smart BFS pathfinding. Instead they use a simple
     * algorithm that tries to move directly toward the target:
     * 1. Try diagonal toward target (if both dx and dy are non-zero)
     * 2. If diagonal blocked, try horizontal (dx direction)
     * 3. If horizontal blocked, try vertical (dy direction)
     * 4. If all blocked, stay put (this enables safespots)
     *
     * This is CRITICAL for OSRS parity - NPCs will NOT path around obstacles.
     * Reference: docs/npc-behavior.md, docs/pathfinding-details.md
     *
     * @returns The next step to take, or null if no movement possible
     */
    findNpcPathStep(
        from: { x: number; y: number; plane: number },
        to: { x: number; y: number },
        size: number = 1,
    ): { x: number; y: number } | null {
        const fx = from.x;
        const fy = from.y;
        const tx = to.x;
        const ty = to.y;
        const plane = clampPlane(from.plane);

        // Already at destination?
        if (fx === tx && fy === ty) {
            return null;
        }

        // Calculate direction toward target
        const dx = tx > fx ? 1 : tx < fx ? -1 : 0;
        const dy = ty > fy ? 1 : ty < fy ? -1 : 0;

        // OSRS NPC Dumb Pathfinding Algorithm:
        // 1. Try diagonal first (if both dx and dy are non-zero)
        // 2. Try horizontal (dx) if diagonal blocked
        // 3. Try vertical (dy) if horizontal blocked
        // 4. Give up if all blocked (enables safespots)

        if (dx !== 0 && dy !== 0) {
            // Try diagonal first
            if (this.canNpcMove(fx, fy, dx, dy, plane, size)) {
                return { x: fx + dx, y: fy + dy };
            }
            // Try horizontal
            if (this.canNpcMove(fx, fy, dx, 0, plane, size)) {
                return { x: fx + dx, y: fy };
            }
            // Try vertical
            if (this.canNpcMove(fx, fy, 0, dy, plane, size)) {
                return { x: fx, y: fy + dy };
            }
        } else if (dx !== 0) {
            // Only horizontal needed
            if (this.canNpcMove(fx, fy, dx, 0, plane, size)) {
                return { x: fx + dx, y: fy };
            }
        } else if (dy !== 0) {
            // Only vertical needed
            if (this.canNpcMove(fx, fy, 0, dy, plane, size)) {
                return { x: fx, y: fy + dy };
            }
        }

        // All moves blocked - NPC stays put (safespot behavior)
        return null;
    }

    /**
     * Check if an NPC can move from (x, y) by (dx, dy).
     * Handles collision flags and corner-cutting validation for diagonal moves.
     */
    private canNpcMove(
        x: number,
        y: number,
        dx: number,
        dy: number,
        plane: number,
        size: number,
    ): boolean {
        const destX = x + dx;
        const destY = y + dy;
        // For multi-tile NPCs, check all tiles along the leading edge
        for (let i = 0; i < size; i++) {
            for (let j = 0; j < size; j++) {
                const checkX = x + i;
                const checkY = y + j;

                // For diagonal movement, also check cardinal adjacents (corner-cutting prevention)
                if (dx !== 0 && dy !== 0) {
                    // Check diagonal destination
                    if (!this.canMoveDirection(checkX, checkY, dx, dy, plane)) {
                        return false;
                    }
                    // Corner-cutting check: also verify cardinal directions are clear
                    if (!this.canMoveDirection(checkX, checkY, dx, 0, plane)) {
                        return false;
                    }
                    if (!this.canMoveDirection(checkX, checkY, 0, dy, plane)) {
                        return false;
                    }
                } else {
                    // Cardinal movement - just check the single direction
                    if (!this.canMoveDirection(checkX, checkY, dx, dy, plane)) {
                        return false;
                    }
                }
            }
        }

        // Check the destination tiles aren't blocked
        for (let i = 0; i < size; i++) {
            for (let j = 0; j < size; j++) {
                const flag = this.getCollisionFlagAt(destX + i, destY + j, plane);
                if (flag === undefined || (flag & CollisionFlag.FLOOR_BLOCKED) !== 0) {
                    return false;
                }
                // Also check for solid objects
                if ((flag & CollisionFlag.OBJECT) !== 0) {
                    return false;
                }
            }
        }

        return true;
    }

    canNpcStep(
        from: { x: number; y: number; plane: number },
        to: { x: number; y: number },
        size: number = 1,
    ): boolean {
        const dx = (to.x | 0) - (from.x | 0);
        const dy = (to.y | 0) - (from.y | 0);
        if (dx === 0 && dy === 0) {
            return true;
        }
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
            return false;
        }
        return this.canNpcMove(from.x | 0, from.y | 0, dx, dy, clampPlane(from.plane), size);
    }

    /**
     * Check if movement from (x, y) in direction (dx, dy) is blocked by walls.
     */
    private canMoveDirection(x: number, y: number, dx: number, dy: number, plane: number): boolean {
        const srcFlag = this.getCollisionFlagAt(x, y, plane);
        const destFlag = this.getCollisionFlagAt(x + dx, y + dy, plane);

        if (srcFlag === undefined || destFlag === undefined) {
            return false;
        }

        // Get the block mask for the direction we're moving
        let blockMask = 0;
        if (dx === -1 && dy === 0) {
            blockMask = CollisionFlag.BLOCK_WEST;
        } else if (dx === 1 && dy === 0) {
            blockMask = CollisionFlag.BLOCK_EAST;
        } else if (dx === 0 && dy === -1) {
            blockMask = CollisionFlag.BLOCK_SOUTH;
        } else if (dx === 0 && dy === 1) {
            blockMask = CollisionFlag.BLOCK_NORTH;
        } else if (dx === -1 && dy === -1) {
            blockMask = CollisionFlag.BLOCK_SOUTH_WEST;
        } else if (dx === 1 && dy === -1) {
            blockMask = CollisionFlag.BLOCK_SOUTH_EAST;
        } else if (dx === -1 && dy === 1) {
            blockMask = CollisionFlag.BLOCK_NORTH_WEST;
        } else if (dx === 1 && dy === 1) {
            blockMask = CollisionFlag.BLOCK_NORTH_EAST;
        }

        // Check if destination tile blocks entry from our direction
        return (destFlag & blockMask) === 0;
    }

    private mapSquareCoord64(worldTile: number): number {
        // World tiles are non-negative in OSRS, but our graph window can probe < 0 near edges.
        // Use floor-division so negative tiles map to negative map squares (and are treated as OOB).
        return Math.floor(worldTile / 64);
    }

    getGraphSize(): number {
        return this.pf.graphSize;
    }

    /**
     * Return a step-by-step path (tile list) from `from` towards `to`.
     *
     * This reconstructs the full path from the pathfinder's per-tile `directions` field.
     * The legacy pathfinder's `bufferX/bufferY` output is turn-point compressed and
     * should not be expanded via naive interpolation (can introduce illegal diagonal/corner steps).
     *
     * The returned tiles:
     * - are in forward order (first tile is the next step after `from`)
     * - exclude the start tile
     * - are limited to `maxSteps` tiles (useful for server movement buffers)
     */
    findPathSteps(
        req: PathRequest,
        opts?: { maxSteps?: number; routeStrategy?: RouteStrategy },
    ): {
        ok: boolean;
        steps?: { x: number; y: number }[];
        end?: { x: number; y: number };
        message?: string;
    } {
        try {
            const { from, to } = req;
            const fromX = from.x;
            const fromY = from.y;
            const toX = to.x;
            const toY = to.y;
            const size = normalizePathSize(req.size);
            const plane = clampPlane(from.plane);
            const maxSteps = normalizeMaxSteps(opts?.maxSteps);
            const routeStrategy = opts?.routeStrategy;

            if (!routeStrategy && fromX === toX && fromY === toY) {
                return { ok: true, steps: [] };
            }

            // Auto-resolve WorldView from source position so callers don't need
            // to pass worldViewId explicitly.
            const effectiveWvId = this.resolveWorldViewId(req);

            this.fillFlagsAcrossMaps(fromX, fromY, plane, effectiveWvId);

            const collisionStrategy = NORMAL_STRATEGY;
            let rs = routeStrategy ?? new ExactRouteStrategy();
            if (!routeStrategy) {
                rs.approxDestX = toX;
                rs.approxDestY = toY;
                rs.destSizeX = 1;
                rs.destSizeY = 1;
            }

            const result = this.pf.findPath(
                fromX,
                fromY,
                size,
                plane,
                rs,
                collisionStrategy,
                0,
                true,
            );
            const normalizedResult = result;
            if (normalizedResult < 0) {
                return { ok: false, message: "no path" };
            }
            if (normalizedResult === 0) {
                return { ok: true, steps: [] };
            }
            if (maxSteps === 0) {
                return { ok: true, steps: [] };
            }

            const graphBaseX = fromX - (this.pf.graphSize >> 1);
            const graphBaseY = fromY - (this.pf.graphSize >> 1);

            // The first entry is the selected end tile (destination or alternative route).
            let traceX = this.pf.bufferX[0];
            let traceY = this.pf.bufferY[0];
            const selectedEnd = { x: traceX, y: traceY };

            // Keep only the last `maxSteps` tiles in the backtrace (these are closest to `from`).
            const ringX = new Int32Array(maxSteps);
            const ringY = new Int32Array(maxSteps);
            let ringCount = 0;
            let ringWrite = 0;
            const ringPush = (x: number, y: number) => {
                ringX[ringWrite] = x;
                ringY[ringWrite] = y;
                ringWrite = (ringWrite + 1) % maxSteps;
                ringCount = Math.min(maxSteps, ringCount + 1);
            };

            const srcX = fromX;
            const srcY = fromY;

            // Trace back to source using per-tile directions.
            // Note: directions are indexed in graph-space.
            let guard = 0;
            const guardMax = this.pf.graphSize * this.pf.graphSize + 8;
            while (traceX !== srcX || traceY !== srcY) {
                if (guard++ > guardMax) {
                    return { ok: false, message: "path trace overflow" };
                }
                // Push current tile BEFORE moving back (excludes source, includes destination)
                ringPush(traceX, traceY);

                const gx = traceX - graphBaseX;
                const gy = traceY - graphBaseY;
                if (gx < 0 || gy < 0 || gx >= this.pf.graphSize || gy >= this.pf.graphSize) {
                    return { ok: false, message: "path trace out of bounds" };
                }
                const dir = this.pf.directions[gx][gy];
                if (dir === 0) {
                    return { ok: false, message: "path trace missing direction" };
                }
                if ((dir & DirectionFlag.EAST) !== 0) traceX = traceX + 1;
                else if ((dir & DirectionFlag.WEST) !== 0) traceX = traceX - 1;

                if ((dir & DirectionFlag.NORTH) !== 0) traceY = traceY + 1;
                else if ((dir & DirectionFlag.SOUTH) !== 0) traceY = traceY - 1;
            }

            // Convert ring buffer (backtrace order, closest-to-src last) into forward steps.
            const out: { x: number; y: number }[] = new Array(ringCount);
            // ringWrite points at the next write slot; the oldest element is at ringWrite when full.
            const start = ringCount === maxSteps ? ringWrite : 0;
            for (let i = 0; i < ringCount; i++) {
                const idx = (start + i) % maxSteps;
                // Reverse order to go from source -> destination.
                const rev = ringCount - 1 - i;
                out[rev] = { x: ringX[idx], y: ringY[idx] };
            }

            return { ok: true, steps: out, end: selectedEnd };
        } catch (e: any) {
            return { ok: false, message: e?.message || String(e) };
        }
    }

    private fillFlagsAcrossMaps(srcTileX: number, srcTileY: number, plane: number, worldViewId?: number): void {
        const pf = this.pf;
        const graphBaseX = srcTileX - (pf.graphSize >> 1);
        const graphBaseY = srcTileY - (pf.graphSize >> 1);

        // If player is in a WorldView, use that view's collision
        const wvCollision = worldViewId !== undefined && worldViewId >= 0
            ? this.worldViewCollision.get(worldViewId)
            : undefined;

        // Initialize to -1 (treated as blocked)
        for (let i = 0; i < pf.graphSize; i++) pf.flags[i].fill(-1);
        for (let gx = 0; gx < pf.graphSize; gx++) {
            for (let gy = 0; gy < pf.graphSize; gy++) {
                const wx = graphBaseX + gx;
                const wy = graphBaseY + gy;

                // When inside a WorldView, only that view's tiles are walkable.
                // Tiles outside stay as -1 (blocked) — no fallthrough to overworld.
                if (wvCollision) {
                    if (wvCollision.containsWorldTile(wx, wy)) {
                        pf.flags[gx][gy] = wvCollision.getCollisionFlag(plane, wx, wy);
                    }
                    continue;
                }

                const mapX = this.mapSquareCoord64(wx);
                const mapY = this.mapSquareCoord64(wy);
                if (mapX < 0 || mapY < 0) continue;
                const ms = this.map.getMapSquare(mapX, mapY);
                if (!ms) continue;
                const localX = wx - ms.baseX;
                const localY = wy - ms.baseY;
                if (localX < 0 || localY < 0 || localX >= ms.size || localY >= ms.size) continue;
                const effectivePlane = resolveCollisionPlaneAt(this.map, wx, wy, plane);
                const cm = ms.collisionMaps[effectivePlane];
                if (cm && cm.isWithinBounds(localX, localY)) {
                    let flags = cm.getFlag(localX, localY);
                    if (this.collisionOverlays) {
                        flags = this.collisionOverlays.applyOverlay(wx, wy, effectivePlane, flags);
                    }
                    pf.flags[gx][gy] = flags;
                }
            }
        }
    }

    findPath(
        req: PathRequest,
        routeStrategy?: RouteStrategy,
    ): {
        ok: boolean;
        waypoints?: { x: number; y: number }[];
        message?: string;
    } {
        try {
            const { from, to } = req;
            const fromX = from.x;
            const fromY = from.y;
            const toX = to.x;
            const toY = to.y;
            const size = normalizePathSize(req.size);
            const plane = clampPlane(from.plane);

            // OSRS parity: For RectAdjacentRouteStrategy, set the collision getter
            // so hasArrived() can check for walls blocking the interaction edge.
            if (routeStrategy instanceof RectAdjacentRouteStrategy) {
                routeStrategy.setCollisionGetter(
                    (x, y, p) => this.getCollisionFlagAt(x, y, p),
                    plane,
                );
            }

            // If a route strategy is provided and we're already at the destination, bail early.
            if (routeStrategy && routeStrategy.hasArrived(fromX, fromY, plane)) {
                return { ok: true, waypoints: [] };
            }

            if (!routeStrategy && fromX === toX && fromY === toY) {
                return { ok: true, waypoints: [] };
            }

            // Auto-resolve WorldView from source position.
            const effectiveWvId = this.resolveWorldViewId(req);
            this.fillFlagsAcrossMaps(fromX, fromY, plane, effectiveWvId);

            // Choose collision strategy.
            // NOTE: Do not auto-switch to BLOCKED_STATEGY based on FLOOR bits.
            // OSRS player routing uses the normal movement masks; switching here
            // can over-constrain paths on otherwise valid tiles.
            const collisionStrategy = NORMAL_STRATEGY;

            let rs = routeStrategy ?? new ExactRouteStrategy();
            if (!routeStrategy) {
                rs.approxDestX = toX;
                rs.approxDestY = toY;
                rs.destSizeX = 1;
                rs.destSizeY = 1;
            }

            const steps = this.pf.findPath(
                fromX,
                fromY,
                size,
                plane,
                rs,
                collisionStrategy,
                0,
                true,
            );
            const totalWaypoints = steps;
            if (totalWaypoints < 0) return { ok: false, message: "no path" };
            const waypoints: { x: number; y: number }[] = new Array(totalWaypoints);
            for (let s = 0; s < totalWaypoints; s++) {
                waypoints[s] = { x: this.pf.bufferX[s], y: this.pf.bufferY[s] };
            }
            waypoints.reverse();
            return { ok: true, waypoints };
        } catch (e: any) {
            return { ok: false, message: e?.message || String(e) };
        }
    }

    /** Return raw collision flag for a world tile at a given plane, or undefined if out-of-bounds. */
    getCollisionFlagAt(worldX: number, worldY: number, plane: number): number | undefined {
        // Check WorldView collision first — if the tile is inside any registered
        // WorldView, that view is authoritative and overworld data is irrelevant.
        for (const [, wv] of this.worldViewCollision) {
            if (wv.containsWorldTile(worldX, worldY)) {
                return wv.getCollisionFlag(plane, worldX, worldY);
            }
        }

        const mapX = this.mapSquareCoord64(worldX);
        const mapY = this.mapSquareCoord64(worldY);
        if (mapX < 0 || mapY < 0) return undefined;
        const ms = this.map.getMapSquare(mapX, mapY);
        if (!ms) return undefined;
        const lx = worldX - ms.baseX;
        const ly = worldY - ms.baseY;
        if (lx < 0 || ly < 0 || lx >= ms.size || ly >= ms.size) return undefined;
        const l = resolveCollisionPlaneAt(this.map, worldX, worldY, plane);
        const cm = ms.collisionMaps[l];
        if (!cm?.isWithinBounds(lx, ly)) return undefined;
        let flags = cm.getFlag(lx, ly);
        if (this.collisionOverlays) {
            flags = this.collisionOverlays.applyOverlay(worldX, worldY, l, flags);
        }
        return flags;
    }

    /** Check if the shared edge between two adjacent cardinal tiles is blocked by a wall segment. */
    edgeHasWallBetween(ax: number, ay: number, bx: number, by: number, plane: number): boolean {
        const startX = ax;
        const startY = ay;
        const endX = bx;
        const endY = by;
        const dx = endX - startX;
        const dy = endY - startY;
        const ad = Math.abs(dx) + Math.abs(dy);
        if (ad !== 1) return false; // only cardinal-adjacent supported
        const normalizedPlane = plane;
        const a = this.getCollisionFlagAt(startX, startY, normalizedPlane) ?? 0;
        const b = this.getCollisionFlagAt(endX, endY, normalizedPlane) ?? 0;
        if (dx === 1) {
            // east edge between A and B
            return (a & CollisionFlag.WALL_EAST) !== 0 || (b & CollisionFlag.WALL_WEST) !== 0;
        } else if (dx === -1) {
            // west edge
            return (a & CollisionFlag.WALL_WEST) !== 0 || (b & CollisionFlag.WALL_EAST) !== 0;
        } else if (dy === 1) {
            // north edge
            return (a & CollisionFlag.WALL_NORTH) !== 0 || (b & CollisionFlag.WALL_SOUTH) !== 0;
        } else {
            // south edge
            return (a & CollisionFlag.WALL_SOUTH) !== 0 || (b & CollisionFlag.WALL_NORTH) !== 0;
        }
    }

    projectileRaycast(
        from: { x: number; y: number; plane: number },
        to: { x: number; y: number },
    ): { clear: boolean; tiles: number } {
        const x0 = from.x;
        const y0 = from.y;
        const x1 = to.x;
        const y1 = to.y;
        const plane = clampPlane(from.plane);
        let x = x0;
        let y = y0;
        const dx = Math.abs(x1 - x0);
        const sx = x0 < x1 ? 1 : -1;
        const dy = -Math.abs(y1 - y0);
        const sy = y0 < y1 ? 1 : -1;
        let err = dx + dy;
        let traveled = 0;
        while (true) {
            if (x === x1 && y === y1) {
                return { clear: true, tiles: traveled };
            }
            const e2 = err << 1;
            let nx = x;
            let ny = y;
            if (e2 >= dy) {
                err += dy;
                nx += sx;
            }
            if (e2 <= dx) {
                err += dx;
                ny += sy;
            }
            if (this.projectileTransitionBlocked(x, y, nx, ny, plane)) {
                return { clear: false, tiles: traveled };
            }
            x = nx;
            y = ny;
            traveled++;
        }
    }

    private projectileTransitionBlocked(
        ax: number,
        ay: number,
        bx: number,
        by: number,
        plane: number,
    ): boolean {
        if (ax === bx && ay === by) return false;
        const dx = bx - ax;
        const dy = by - ay;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
            return true;
        }
        if (dx !== 0 && dy !== 0) {
            return (
                this.projectileStepCardinal(ax, ay, ax + dx, ay, plane) ||
                this.projectileStepCardinal(ax, ay, ax, ay + dy, plane) ||
                this.projectileDiagonalBlocked(ax, ay, bx, by, plane)
            );
        }
        return this.projectileStepCardinal(ax, ay, bx, by, plane);
    }

    private projectileStepCardinal(
        ax: number,
        ay: number,
        bx: number,
        by: number,
        plane: number,
    ): boolean {
        const dx = bx - ax;
        const dy = by - ay;
        if (Math.abs(dx) + Math.abs(dy) !== 1) return true;
        const a = this.getCollisionFlagAt(ax, ay, plane);
        const b = this.getCollisionFlagAt(bx, by, plane);
        if (a === undefined || b === undefined) return true;
        const objMask = CollisionFlag.OBJECT_PROJECTILE_BLOCKER;
        if ((a & objMask) !== 0 || (b & objMask) !== 0) return true;
        if (dx === 1) {
            return (
                (a & CollisionFlag.WALL_EAST_PROJECTILE_BLOCKER) !== 0 ||
                (b & CollisionFlag.WALL_WEST_PROJECTILE_BLOCKER) !== 0
            );
        }
        if (dx === -1) {
            return (
                (a & CollisionFlag.WALL_WEST_PROJECTILE_BLOCKER) !== 0 ||
                (b & CollisionFlag.WALL_EAST_PROJECTILE_BLOCKER) !== 0
            );
        }
        if (dy === 1) {
            return (
                (a & CollisionFlag.WALL_NORTH_PROJECTILE_BLOCKER) !== 0 ||
                (b & CollisionFlag.WALL_SOUTH_PROJECTILE_BLOCKER) !== 0
            );
        }
        return (
            (a & CollisionFlag.WALL_SOUTH_PROJECTILE_BLOCKER) !== 0 ||
            (b & CollisionFlag.WALL_NORTH_PROJECTILE_BLOCKER) !== 0
        );
    }

    private projectileDiagonalBlocked(
        ax: number,
        ay: number,
        bx: number,
        by: number,
        plane: number,
    ): boolean {
        const dx = bx - ax;
        const dy = by - ay;
        const a = this.getCollisionFlagAt(ax, ay, plane);
        const b = this.getCollisionFlagAt(bx, by, plane);
        if (a === undefined || b === undefined) return true;
        const objMask = CollisionFlag.OBJECT_PROJECTILE_BLOCKER;
        if ((a & objMask) !== 0 || (b & objMask) !== 0) return true;
        if (dx === 1 && dy === 1) {
            return (
                (a & CollisionFlag.WALL_NORTH_EAST_PROJECTILE_BLOCKER) !== 0 ||
                (b & CollisionFlag.WALL_SOUTH_WEST_PROJECTILE_BLOCKER) !== 0
            );
        }
        if (dx === 1 && dy === -1) {
            return (
                (a & CollisionFlag.WALL_SOUTH_EAST_PROJECTILE_BLOCKER) !== 0 ||
                (b & CollisionFlag.WALL_NORTH_WEST_PROJECTILE_BLOCKER) !== 0
            );
        }
        if (dx === -1 && dy === 1) {
            return (
                (a & CollisionFlag.WALL_NORTH_WEST_PROJECTILE_BLOCKER) !== 0 ||
                (b & CollisionFlag.WALL_SOUTH_EAST_PROJECTILE_BLOCKER) !== 0
            );
        }
        // dx === -1 && dy === -1
        return (
            (a & CollisionFlag.WALL_SOUTH_WEST_PROJECTILE_BLOCKER) !== 0 ||
            (b & CollisionFlag.WALL_NORTH_EAST_PROJECTILE_BLOCKER) !== 0
        );
    }

    sampleHeight(worldXUnits: number, worldYUnits: number, plane: number): number | undefined {
        return this.map.sampleHeight(worldXUnits, worldYUnits, plane);
    }
}

// Re-export route strategies for convenience
export {
    ApproximateRouteStrategy,
    ExactRouteStrategy,
    RectAdjacentRouteStrategy,
} from "./legacy/pathfinder/RouteStrategy";
