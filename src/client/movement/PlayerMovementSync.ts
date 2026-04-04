import type { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import { decodeInteractionIndex } from "../../rs/interaction/InteractionIndex";
import { faceAngleRs } from "../../rs/utils/rotation";
import {
    MovementDirection,
    deltaToDirection,
    directionToDelta,
    directionToOrientation,
} from "../../shared/Direction";
import { PlayerAnimController } from "../PlayerAnimController";
import type { NpcEcs } from "../ecs/NpcEcs";
import { PlayerEcs } from "../ecs/PlayerEcs";
import type { ResolveTilePlaneFn } from "../roof/RoofVisibility";
import type { MovementStep } from "./MovementPath";
import { MovementPath } from "./MovementPath";
import { MovementState, MovementStateInit } from "./MovementState";
import type {
    MovementStateOptions,
    MovementUpdate,
    RegisterMovementEntity,
} from "./MovementSyncTypes";
import { CollisionFlagAtFn, OsrsRouteFinder32 } from "./OsrsRouteFinder32";

function toTileCoord(subCoord: number): number {
    return (subCoord | 0) >> 7;
}

/**
 * Server-authoritative player movement bridge.
 *
 * Translates per-tick server movement updates (directions / traversals / snap)
 * into ECS interpolation commands.  There is no intermediate waypoint queue;
 * steps are pushed directly to the ECS ring buffer, matching the OSRS client's
 * `appendPathStep` / `setPathPosition` model.
 *
 * Reference: Actor.java — setPathPosition, appendPathStep, interpolateActor, updateMovement.
 */
export class PlayerMovementSync {
    private readonly states = new Map<number, MovementState>();
    private readonly routeFinder = new OsrsRouteFinder32();

    constructor(
        private readonly playerEcs: PlayerEcs,
        private readonly animController?: PlayerAnimController,
        private readonly resolveTilePlane?: ResolveTilePlaneFn,
        private readonly npcEcs?: NpcEcs,
        private readonly seqTypeLoader?: SeqTypeLoader,
        private readonly getCollisionFlagAt?: CollisionFlagAtFn,
    ) {}

    /**
     * Clears all pending movement for the given serverId.
     * Used by local actions (e.g. spell casts) that should immediately stop the player.
     */
    clearMovementFor(serverId: number): void {
        const state = this.states.get(serverId);
        if (!state) return;
        const ecsIndex = state.ecsIndex;
        if (ecsIndex >= 0) {
            try {
                this.playerEcs.clearServerQueue(ecsIndex);
            } catch {}
        }
    }

    setServerTickMs(ms: number): void {
        try {
            this.playerEcs.setServerTickMs(ms | 0);
        } catch {}
    }

    registerEntity(info: RegisterMovementEntity): MovementState {
        const subX = info.subX | 0;
        const subY = info.subY | 0;
        const tile = { x: toTileCoord(subX), y: toTileCoord(subY) };
        const effectiveLevel = this.resolveTilePlane
            ? this.resolveTilePlane(tile.x, tile.y, info.level)
            : info.level;
        const init: MovementStateInit = {
            serverId: info.serverId,
            ecsIndex: info.ecsIndex,
            tile,
            level: effectiveLevel,
            subX,
            subY,
        };
        const state = new MovementState(init);
        this.states.set(info.serverId, state);
        return state;
    }

    unregister(serverId: number): void {
        this.states.delete(serverId);
        try {
            this.animController?.release(serverId);
        } catch {}
    }

    // ── Server update entry point ───────────────────────────────────────

    receiveUpdate(update: MovementUpdate): { path: MovementPath; teleported: boolean } {
        const directions = Array.isArray(update.directions)
            ? update.directions.map((dir) => (dir | 0) & 7)
            : [];
        const traversals = Array.isArray(update.traversals)
            ? update.traversals.map((t) => (t | 0) & 3)
            : [];
        let subX =
            typeof update.x === "number"
                ? update.x | 0
                : typeof update.subX === "number"
                ? update.subX | 0
                : undefined;
        let subY =
            typeof update.y === "number"
                ? update.y | 0
                : typeof update.subY === "number"
                ? update.subY | 0
                : undefined;

        const existingState = this.states.get(update.serverId);
        const isFirstAppearance = !existingState;

        const initialTile =
            subX !== undefined && subY !== undefined
                ? { x: toTileCoord(subX), y: toTileCoord(subY) }
                : existingState
                ? { x: existingState.tileX, y: existingState.tileY }
                : { x: 0, y: 0 };

        const effectiveLevel = this.resolveTilePlane
            ? this.resolveTilePlane(initialTile.x, initialTile.y, update.level | 0)
            : update.level | 0;
        update.level = effectiveLevel;

        const defaultSubX = (initialTile.x << 7) + 64;
        const defaultSubY = (initialTile.y << 7) + 64;
        const state = existingState
            ? existingState
            : this.registerEntity({
                  serverId: update.serverId,
                  ecsIndex: update.ecsIndex,
                  tile: initialTile,
                  level: effectiveLevel,
                  subX: typeof subX === "number" ? subX : defaultSubX,
                  subY: typeof subY === "number" ? subY : defaultSubY,
              });
        if (state.ecsIndex !== update.ecsIndex) {
            state.setEcsIndex(update.ecsIndex);
        }

        // Movement deltas are relative to the newest queued tile (Actor.pathX[0]).
        const fromTile = { x: state.tileX, y: state.tileY };

        const running = !!update.running;
        const serverSubX = typeof subX === "number" ? (subX as number) | 0 : undefined;
        const serverSubY = typeof subY === "number" ? (subY as number) | 0 : undefined;
        const forcedTeleport = isFirstAppearance || !!update.snap;

        let tile = initialTile;
        let finalSubX = typeof serverSubX === "number" ? serverSubX : (tile.x << 7) + 64;
        let finalSubY = typeof serverSubY === "number" ? serverSubY : (tile.y << 7) + 64;

        // ── Build path from update ──────────────────────────────────────

        const destTile = initialTile;
        const dxToDest = (destTile.x - fromTile.x) | 0;
        const dyToDest = (destTile.y - fromTile.y) | 0;
        const chebyshevDist = Math.max(Math.abs(dxToDest), Math.abs(dyToDest)) | 0;
        const isRunStep = running || traversals.some((t) => (t | 0) === 2);

        // Run reconstruction: when the server sends a 2-tile displacement without
        // explicit directions, reconstruct the intermediate step using client-side
        // collision (mirrors GraphicsObject.method2132 / class232).
        const wantsRunReconstruct =
            !forcedTeleport &&
            isRunStep &&
            chebyshevDist === 2 &&
            directions.length === 0 &&
            typeof this.getCollisionFlagAt === "function";

        let path: MovementPath;

        if (wantsRunReconstruct) {
            path = this.buildRunReconstructPath(fromTile, destTile, update.level | 0);
            tile = destTile;
            finalSubX = (destTile.x << 7) + 64;
            finalSubY = (destTile.y << 7) + 64;
        } else if (directions.length > 0 && !forcedTeleport) {
            // Standard step-by-step movement from server directions.
            const steps: MovementStep[] = [];
            let currX = fromTile.x;
            let currY = fromTile.y;
            for (let i = 0; i < directions.length; i++) {
                const direction = (directions[i] & 7) as MovementDirection;
                const delta = directionToDelta(direction);
                currX += delta.dx;
                currY += delta.dy;
                const traversal = traversals[i];
                steps.push({
                    tile: { x: currX, y: currY },
                    direction,
                    run: traversal === 2,
                    traversal,
                });
            }
            tile = { x: currX, y: currY };
            finalSubX = (currX << 7) + 64;
            finalSubY = (currY << 7) + 64;
            path = new MovementPath(fromTile, tile, steps, false);
        } else if (!forcedTeleport && chebyshevDist > 0) {
            // Direction-less displacement (correction or single/double step).
            path = this.buildDisplacementPath(
                fromTile,
                destTile,
                chebyshevDist,
                isRunStep,
                running,
                traversals,
            );
            tile = destTile;
            finalSubX = typeof serverSubX === "number" ? serverSubX : (destTile.x << 7) + 64;
            finalSubY = typeof serverSubY === "number" ? serverSubY : (destTile.y << 7) + 64;
        } else {
            // No movement or teleport.
            if (serverSubX === undefined || serverSubY === undefined) {
                finalSubX = (state.tileX << 7) + 64;
                finalSubY = (state.tileY << 7) + 64;
            } else {
                finalSubX = serverSubX;
                finalSubY = serverSubY;
            }
            tile = { x: toTileCoord(finalSubX), y: toTileCoord(finalSubY) };
            path = new MovementPath(fromTile, tile, [], forcedTeleport);
        }

        const resolvedLevel = this.resolveTilePlane
            ? this.resolveTilePlane(tile.x, tile.y, update.level | 0)
            : update.level | 0;
        update.level = resolvedLevel;
        const teleported = forcedTeleport || path.isTeleport;

        // ── Apply to ECS ────────────────────────────────────────────────

        this.applyPath(state, path, {
            subX: finalSubX,
            subY: finalSubY,
            level: resolvedLevel,
            running,
            rotation: update.rotation,
            orientation: update.orientation,
            turned: !!update.turned,
            moved: !!update.moved,
        }, teleported);

        return { path, teleported };
    }

    // ── ECS application ─────────────────────────────────────────────────

    private applyPath(
        state: MovementState,
        path: MovementPath,
        opts: MovementStateOptions,
        teleport: boolean,
    ): void {
        const ecsIndex = state.ecsIndex;
        if (!(ecsIndex >= 0)) return;

        state.setLastSteps(path.steps);
        const resolvedLevel = this.resolveTilePlane
            ? this.resolveTilePlane(path.to.x, path.to.y, opts.level)
            : opts.level;

        // ── Teleport / first appearance ─────────────────────────────────
        if (teleport) {
            try { this.playerEcs.clearServerQueue(ecsIndex); } catch {}
            this.playerEcs.teleport(ecsIndex, path.to.x, path.to.y, resolvedLevel);
            this.playerEcs.setRunning(ecsIndex, false);
            state.setTile(path.to, opts.subX, opts.subY, resolvedLevel);
            state.lastRunning = false;

            if (typeof opts.orientation === "number") {
                this.playerEcs.setTargetRot(ecsIndex, opts.orientation & 2047);
                state.lastOrientation = opts.orientation & 2047;
            } else if (typeof opts.rotation === "number") {
                this.playerEcs.setRotationImmediate(ecsIndex, opts.rotation & 2047);
                state.lastOrientation = opts.rotation & 2047;
            }
            if (opts.moved) {
                try { this.animController?.cancelSequenceOnMove?.(state.serverId); } catch {}
            }
            return;
        }

        // ── No movement this tick ───────────────────────────────────────
        if (path.stepCount === 0) {
            this.applyOrientationOnly(state, opts);
            return;
        }

        // ── Movement steps ──────────────────────────────────────────────
        // OSRS parity: appendPathStep is purely additive — the client never
        // clears the path queue on normal movement.  interpolateActor
        // finishes the current tile, then moves to the next.  The ECS ring
        // buffer (cap 8) drops oldest on overflow, bounding any backlog.

        const anyRun = path.steps.some((s) => !!s.run);
        let lastOrientation = state.lastOrientation;

        for (const step of path.steps) {
            const stepSubX = (step.tile.x << 7) + 64;
            const stepSubY = (step.tile.y << 7) + 64;
            const traversal =
                typeof step.traversal === "number" ? step.traversal | 0 : step.run ? 2 : 1;
            const factor = traversal === 0 ? 0.5 : traversal === 2 ? 2 : 1;
            const dirOrientation = directionToOrientation(step.direction) & 2047;
            this.playerEcs.setServerPos(ecsIndex, stepSubX, stepSubY, factor, dirOrientation);
            lastOrientation = dirOrientation;
        }

        // Update state to the final tile from this tick's steps.
        const finalStep = path.steps[path.steps.length - 1];
        const finalSubX = (finalStep.tile.x << 7) + 64;
        const finalSubY = (finalStep.tile.y << 7) + 64;
        state.setTile(
            finalStep.tile,
            finalSubX,
            finalSubY,
            resolvedLevel,
        );

        this.playerEcs.setRunning(ecsIndex, !!opts.running);
        state.lastRunning = anyRun;
        state.lastOrientation = lastOrientation;

        // Apply interaction-facing once the steps are queued.
        const interactionOrientation = this.computeInteractionOrientation(ecsIndex);
        if (interactionOrientation !== undefined) {
            this.playerEcs.setTargetRot(ecsIndex, interactionOrientation & 2047);
            state.lastOrientation = interactionOrientation & 2047;
        }

        if (opts.moved) {
            try { this.animController?.cancelSequenceOnMove?.(state.serverId); } catch {}
        }
    }

    // ── Per-client-tick update ───────────────────────────────────────────

    /**
     * Called every client tick.  Updates interaction-facing orientation and
     * ensures idle animation transitions when movement finishes.
     *
     * There is no waypoint queue to drain — all steps live in the ECS ring buffer.
     */
    updateInteractionRotations(): void {
        for (const [, state] of this.states) {
            const ecsIndex = state.ecsIndex;
            if (!(ecsIndex >= 0)) continue;

            const interactionOrientation = this.computeInteractionOrientation(ecsIndex);
            if (interactionOrientation !== undefined) {
                const rot = interactionOrientation & 2047;
                this.playerEcs.setTargetRot(ecsIndex, rot);
                state.lastOrientation = rot;
            }

            const isMoving = this.playerEcs.isMoving(ecsIndex);
            if (!isMoving) {
                this.playerEcs.resetMovementDelay?.(ecsIndex);
            }
        }
    }

    // ── Orientation helpers ──────────────────────────────────────────────

    private applyOrientationOnly(
        state: MovementState,
        opts: MovementStateOptions,
    ): void {
        const ecsIndex = state.ecsIndex;
        if (!(ecsIndex >= 0)) return;

        const resolvedLevel = this.resolveTilePlane
            ? this.resolveTilePlane(state.tileX, state.tileY, opts.level)
            : opts.level;
        state.setTile({ x: state.tileX, y: state.tileY }, opts.subX, opts.subY, resolvedLevel);
        this.playerEcs.setRunning(ecsIndex, !!opts.running);

        const isMoving = this.playerEcs.isMoving(ecsIndex);
        if (!isMoving) {
            state.lastRunning = !!opts.running;
            const interactionOrientation = this.computeInteractionOrientation(ecsIndex);
            const orientation =
                interactionOrientation !== undefined
                    ? interactionOrientation
                    : typeof opts.orientation === "number"
                    ? opts.orientation & 2047
                    : typeof opts.rotation === "number"
                    ? opts.rotation & 2047
                    : undefined;
            if (orientation !== undefined) {
                this.playerEcs.setTargetRot(ecsIndex, orientation);
                state.lastOrientation = orientation;
            }
        }
    }

    private computeInteractionOrientation(ecsIndex: number): number | undefined {
        try {
            const rawIndex = this.playerEcs.getInteractionIndex(ecsIndex);
            if (typeof rawIndex !== "number" || rawIndex < 0) return undefined;
            const decoded = decodeInteractionIndex(rawIndex);
            if (!decoded) return undefined;
            const selfPos = this.samplePlayerVisualPosition(ecsIndex);
            if (!selfPos) return undefined;
            let targetX: number | undefined;
            let targetY: number | undefined;
            if (decoded.type === "player") {
                const targetIdx = this.playerEcs.getIndexForServerId(decoded.id | 0);
                if (targetIdx !== undefined) {
                    const pos = this.samplePlayerVisualPosition(targetIdx);
                    if (pos) {
                        targetX = pos.x;
                        targetY = pos.y;
                    }
                }
            } else if (decoded.type === "npc" && this.npcEcs) {
                const npcIdx = this.npcEcs.getEcsIdForServer(decoded.id | 0);
                if (npcIdx !== undefined) {
                    const mapId = this.npcEcs.getMapId(npcIdx) | 0;
                    const mapX = (mapId >> 8) & 0xff;
                    const mapY = mapId & 0xff;
                    const localX = this.npcEcs.getX(npcIdx) | 0;
                    const localY = this.npcEcs.getY(npcIdx) | 0;
                    targetX = (mapX << 13) + localX;
                    targetY = (mapY << 13) + localY;
                }
            }
            if (targetX === undefined || targetY === undefined) return undefined;
            if ((selfPos.x | 0) === (targetX | 0) && (selfPos.y | 0) === (targetY | 0))
                return undefined;
            return faceAngleRs(selfPos.x | 0, selfPos.y | 0, targetX | 0, targetY | 0);
        } catch {
            return undefined;
        }
    }

    private samplePlayerVisualPosition(
        ecsIndex: number,
    ): { x: number; y: number } | undefined {
        const x = this.playerEcs.getX(ecsIndex);
        const y = this.playerEcs.getY(ecsIndex);
        const sampleX = typeof x === "number" ? x | 0 : 0;
        const sampleY = typeof y === "number" ? y | 0 : 0;
        if (!Number.isFinite(sampleX) || !Number.isFinite(sampleY)) return undefined;
        return { x: sampleX | 0, y: sampleY | 0 };
    }

    // ── Path building helpers ───────────────────────────────────────────

    /**
     * Reconstruct the intermediate tile for a 2-tile run displacement using
     * client-side collision (mirrors class232 / GraphicsObject.method2132).
     */
    private buildRunReconstructPath(
        from: { x: number; y: number },
        dest: { x: number; y: number },
        plane: number,
    ): MovementPath {
        const steps: MovementStep[] = [];
        const count = this.routeFinder.findRouteSize1(
            from.x,
            from.y,
            dest.x,
            dest.y,
            plane,
            this.getCollisionFlagAt as CollisionFlagAtFn,
            true,
        );

        let currX = from.x | 0;
        let currY = from.y | 0;
        const intermediateCount = count > 0 ? Math.max(0, (count - 1) | 0) : 0;
        for (let i = 0; i < intermediateCount; i++) {
            const nextX = this.routeFinder.outX[i] | 0;
            const nextY = this.routeFinder.outY[i] | 0;
            const dir = deltaToDirection(Math.sign(nextX - currX), Math.sign(nextY - currY));
            if (dir === undefined) continue;
            currX = nextX;
            currY = nextY;
            steps.push({ tile: { x: currX, y: currY }, direction: dir, run: true, traversal: 2 });
        }

        const finalDir = deltaToDirection(
            Math.sign(dest.x - currX),
            Math.sign(dest.y - currY),
        );
        if (finalDir !== undefined) {
            steps.push({
                tile: { x: dest.x | 0, y: dest.y | 0 },
                direction: finalDir,
                run: true,
                traversal: 2,
            });
        }

        return new MovementPath(from, dest, steps, false);
    }

    /**
     * Build a path from a direction-less displacement (server sent subX/subY
     * but no explicit direction codes).
     */
    private buildDisplacementPath(
        from: { x: number; y: number },
        dest: { x: number; y: number },
        chebyshevDist: number,
        isRunStep: boolean,
        running: boolean,
        traversals: number[],
    ): MovementPath {
        const dx = dest.x - from.x;
        const dy = dest.y - from.y;
        const traversalHintRaw =
            typeof traversals[0] === "number" ? (traversals[0] as number) | 0 : undefined;
        const traversalHint =
            traversalHintRaw === 0 || traversalHintRaw === 1 || traversalHintRaw === 2
                ? traversalHintRaw
                : running
                ? 2
                : 1;

        const direction = deltaToDirection(Math.sign(dx), Math.sign(dy));
        if (direction === undefined) {
            return new MovementPath(from, dest, [], true);
        }

        if (chebyshevDist === 1) {
            const step: MovementStep = {
                tile: dest,
                direction,
                run: traversalHint === 2,
                traversal: traversalHint,
            };
            return new MovementPath(from, dest, [step], false);
        }

        if (chebyshevDist === 2) {
            if (isRunStep && typeof this.getCollisionFlagAt === "function") {
                return this.buildRunReconstructPath(from, dest, 0);
            }
            const step: MovementStep = {
                tile: dest,
                direction,
                run: isRunStep || traversalHint === 2,
                traversal: isRunStep ? 2 : traversalHint,
            };
            return new MovementPath(from, dest, [step], false);
        }

        // Large displacement without teleport flag — treat as snap.
        return new MovementPath(from, dest, [], true);
    }

    // ── Public accessors ────────────────────────────────────────────────

    getState(serverId: number): MovementState | undefined {
        return this.states.get(serverId);
    }

    getAllServerIds(): number[] {
        return Array.from(this.states.keys());
    }

    getLastSteps(serverId: number): readonly MovementStep[] {
        const state = this.states.get(serverId);
        return state ? state.getLastSteps() : [];
    }
}
