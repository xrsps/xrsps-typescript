import type { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import { decodeInteractionIndex } from "../../rs/interaction/InteractionIndex";
import { RAD_TO_RS_UNITS, faceAngleRs } from "../../rs/utils/rotation";
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
 * Applies server-sourced player movement to the ECS, matching the queueing rules of
 * the legacy client ({@code Entity.setPos}, {@code Entity.moveInDir}) and the
 * server's {@code Player.updateThisPlayerMovement} encoder.
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
        state.clearPendingSteps();
        const ecsIndex = state.ecsIndex;
        if (ecsIndex >= 0) {
            try {
                // Stop any in-flight interpolation so we don't continue sliding after the cast.
                // We intentionally do NOT snap the position here to avoid visible teleports;
                // the existing ECS position is already aligned with the last processed server step.
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
        // `subX/subY` are absolute subtile world coordinates (tile * 128 + 64), matching OSRS.
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

        // OSRS parity: movement deltas are applied relative to `pathX[0]/pathY[0]` (the newest
        // queued tile), not the actor's current interpolated visual position. `MovementState.tile`
        // tracks that newest queued tile.
        const fromTile = { x: state.tileX, y: state.tileY };

        const running = !!update.running;
        const serverSubX = typeof subX === "number" ? (subX as number) | 0 : undefined;
        const serverSubY = typeof subY === "number" ? (subY as number) | 0 : undefined;
        const forcedTeleport = isFirstAppearance || !!update.snap;

        let tile = initialTile;
        let finalSubX = typeof serverSubX === "number" ? serverSubX : (tile.x << 7) + 64;
        let finalSubY = typeof serverSubY === "number" ? serverSubY : (tile.y << 7) + 64;
        let path: MovementPath;

        const destTile = initialTile;
        const dxToDest = (destTile.x - fromTile.x) | 0;
        const dyToDest = (destTile.y - fromTile.y) | 0;
        const chebyshevDist = Math.max(Math.abs(dxToDest), Math.abs(dyToDest)) | 0;
        const isRunStep = running || traversals.some((t) => (t | 0) === 2);
        const wantsRunReconstruct =
            !forcedTeleport &&
            isRunStep &&
            chebyshevDist === 2 &&
            typeof this.getCollisionFlagAt === "function";

        if (wantsRunReconstruct) {
            // OSRS parity: reconstruct intermediate run step using class232 (GraphicsObject.method2132).
            const steps: MovementStep[] = [];
            const plane = update.level | 0;
            const count = this.routeFinder.findRouteSize1(
                fromTile.x,
                fromTile.y,
                destTile.x,
                destTile.y,
                plane,
                this.getCollisionFlagAt as CollisionFlagAtFn,
                true,
            );

            let currX = fromTile.x | 0;
            let currY = fromTile.y | 0;

            const intermediateCount = count > 0 ? Math.max(0, (count - 1) | 0) : 0;
            for (let i = 0; i < intermediateCount; i++) {
                const nextX = this.routeFinder.outX[i] | 0;
                const nextY = this.routeFinder.outY[i] | 0;
                const dir = deltaToDirection(Math.sign(nextX - currX), Math.sign(nextY - currY));
                if (dir === undefined) continue;
                currX = nextX;
                currY = nextY;
                steps.push({
                    tile: { x: currX, y: currY },
                    direction: dir,
                    run: true,
                    traversal: 2,
                });
            }

            const finalDir = deltaToDirection(
                Math.sign(destTile.x - currX),
                Math.sign(destTile.y - currY),
            );
            if (finalDir !== undefined) {
                steps.push({
                    tile: { x: destTile.x | 0, y: destTile.y | 0 },
                    direction: finalDir,
                    run: true,
                    traversal: 2,
                });
            }

            tile = destTile;
            finalSubX = (destTile.x << 7) + 64;
            finalSubY = (destTile.y << 7) + 64;
            path = new MovementPath(fromTile, tile, steps, false);
        } else if (directions.length > 0 && !forcedTeleport) {
            const steps: MovementStep[] = [];
            let currX = fromTile.x;
            let currY = fromTile.y;

            for (let i = 0; i < directions.length; i++) {
                const rawDir = directions[i];
                const direction = (rawDir & 7) as MovementDirection;
                const delta = directionToDelta(direction);
                currX += delta.dx;
                currY += delta.dy;
                const traversal = traversals[i];
                const run = traversal === 2;
                steps.push({
                    tile: { x: currX, y: currY },
                    direction,
                    run,
                    traversal,
                });
            }
            const computedTile = { x: currX, y: currY };
            tile = computedTile;
            finalSubX = (currX << 7) + 64;
            finalSubY = (currY << 7) + 64;
            path = new MovementPath(fromTile, tile, steps, false);
        } else {
            if (serverSubX === undefined || serverSubY === undefined) {
                finalSubX = (state.tileX << 7) + 64;
                finalSubY = (state.tileY << 7) + 64;
            } else {
                finalSubX = serverSubX;
                finalSubY = serverSubY;
            }
            tile = { x: toTileCoord(finalSubX), y: toTileCoord(finalSubY) };
            const dx = tile.x - fromTile.x;
            const dy = tile.y - fromTile.y;
            const chebyshevDist = Math.max(Math.abs(dx), Math.abs(dy));
            const traversalHintRaw =
                typeof traversals[0] === "number" ? (traversals[0] as number) | 0 : undefined;
            const traversalHint =
                traversalHintRaw === 0 || traversalHintRaw === 1 || traversalHintRaw === 2
                    ? traversalHintRaw
                    : running
                    ? 2
                    : 1;
            // OSRS parity: direction-less movement updates can be:
            // - moveType=2 (2-tile displacement; intermediate is reconstructed only for traversal=run), or
            // - corrections/teleports (snap=true).
            const isSingleStep = chebyshevDist === 1;
            if (!forcedTeleport && isRunStep && chebyshevDist === 2) {
                const direction = deltaToDirection(Math.sign(dx), Math.sign(dy));
                if (direction !== undefined) {
                    const step: MovementStep = {
                        tile,
                        direction,
                        run: true,
                        traversal: 2,
                    };
                    path = new MovementPath(fromTile, tile, [step], false);
                } else {
                    path = new MovementPath(fromTile, tile, [], true);
                }
            } else if (!forcedTeleport && chebyshevDist === 2) {
                const direction = deltaToDirection(Math.sign(dx), Math.sign(dy));
                if (direction !== undefined) {
                    const step: MovementStep = {
                        tile,
                        direction,
                        run: traversalHint === 2,
                        traversal: traversalHint,
                    };
                    path = new MovementPath(fromTile, tile, [step], false);
                } else {
                    path = new MovementPath(fromTile, tile, [], true);
                }
            } else if (isSingleStep && !forcedTeleport) {
                const direction = deltaToDirection(Math.sign(dx), Math.sign(dy));
                if (direction !== undefined) {
                    const step: MovementStep = {
                        tile,
                        direction,
                        run: traversalHint === 2,
                        traversal: traversalHint,
                    };
                    path = new MovementPath(fromTile, tile, [step], false);
                } else {
                    // Defensive: if direction couldn't be resolved (shouldn't happen for cheb==1),
                    // snap to the authoritative coordinate rather than inventing a route.
                    path = new MovementPath(fromTile, tile, [], true);
                }
            } else if (chebyshevDist > 0 && !forcedTeleport) {
                // Correction without directions: treat as resetPath snap (OSRS behavior).
                path = new MovementPath(fromTile, tile, [], true);
            } else {
                path = new MovementPath(fromTile, tile, [], false);
            }
        }

        const resolvedLevel = this.resolveTilePlane
            ? this.resolveTilePlane(tile.x, tile.y, update.level | 0)
            : update.level | 0;
        update.level = resolvedLevel;

        const teleported = forcedTeleport || path.isTeleport;

        this.applyPath(
            state,
            path,
            {
                subX: finalSubX,
                subY: finalSubY,
                level: update.level | 0,
                running,
                rotation: update.rotation,
                orientation: update.orientation,
                turned: !!update.turned,
                moved: !!update.moved,
            },
            teleported,
        );

        return { path, teleported };
    }

    private applyPath(
        state: MovementState,
        path: MovementPath,
        opts: MovementStateOptions,
        forceTeleport: boolean = false,
    ): void {
        const ecsIndex = state.ecsIndex;
        if (!(ecsIndex >= 0)) return;

        state.setLastSteps(path.steps);
        const resolvedLevel = this.resolveTilePlane
            ? this.resolveTilePlane(path.to.x, path.to.y, opts.level)
            : opts.level;
        if (path.isTeleport || forceTeleport) {
            // Clear any pending interpolation queue for clean teleport
            try {
                this.playerEcs.clearServerQueue(ecsIndex);
            } catch {}

            this.playerEcs.teleport(ecsIndex, path.to.x, path.to.y, resolvedLevel);
            this.playerEcs.setRunning(ecsIndex, false);
            state.setTile(path.to, opts.subX, opts.subY, resolvedLevel);
            state.lastRunning = false; // Reset running state on teleport

            // For newly spawned players, set idle animation immediately
            if (forceTeleport && !path.isTeleport) {
                this.ensureIdleAnimation(state, !!opts.running);
            }

            if (typeof opts.orientation === "number") {
                this.playerEcs.setTargetRot(ecsIndex, opts.orientation & 2047);
                state.lastOrientation = opts.orientation & 2047;
            } else if (typeof opts.rotation === "number") {
                this.playerEcs.setRotationImmediate(ecsIndex, opts.rotation & 2047);
                state.lastOrientation = opts.rotation & 2047;
            }
            if (opts.moved) {
                try {
                    // OSRS parity: cancel the current action sequence on move iff `priority == 1`.
                    // Reference: `Player.method2429`.
                    this.animController?.cancelSequenceOnMove?.(state.serverId);
                } catch {}
            }
            return;
        }

        if (path.stepCount === 0) {
            // No movement; maybe pure rotation update
            // But still process any queued steps from previous updates
            if (state.hasPendingSteps()) {
                this.processQueuedSteps(state, opts, ecsIndex, 0);
            } else {
                this.applyOrientationOnly(state, opts);
            }
            return;
        }

        state.setLastMoveOpts(opts);

        // Queue new steps to persistent queue (FIFO, OSRS pathLength parity: max 9 pending)
        state.enqueueSteps(path.steps);

        // Process steps from queue
        // Pass the count of steps we just added so we process the entire current server update
        this.processQueuedSteps(state, opts, ecsIndex, path.steps.length);
    }

    /**
     * Process steps from the persistent waypoint queue.
     * Matches lostcity's current-tick movement behavior.
     *
     * Lostcity behavior (PathingEntity.processMovement):
     * - Server processes movement in the SAME tick as input received
     * - WALK: 1 step per 600ms tick
     * - RUN: 2 steps per 600ms tick
     *
     * Client behavior:
     * - When server update arrives, process ALL steps from that update immediately
     * - This matches lostcity's same-tick processing
     * - Remaining queued steps from previous updates process at 1-2 per tick
     */
    private processQueuedSteps(
        state: MovementState,
        opts: MovementStateOptions,
        ecsIndex: number,
        stepCountThisTick: number,
    ): void {
        // If stepCountThisTick > 0: process all steps from current server update (same-tick behavior)
        // If stepCountThisTick === 0: processing leftover steps from previous updates (rate-limited)
        let stepsPerTick: number;
        if (stepCountThisTick > 0) {
            stepsPerTick = Math.max(1, stepCountThisTick | 0);
        } else {
            const next = state.peekNextStep();
            const traversal =
                typeof next?.traversal === "number" ? next.traversal | 0 : next?.run ? 2 : 1;
            stepsPerTick = traversal === 2 ? 2 : 1;
        }

        // OSRS parity: actor pathLength is capped to 9 pending steps. Keep committed ECS path
        // within this budget even when movement packets arrive faster than client processing.
        const pathLengthLike = this.playerEcs.getServerPathLengthLike(ecsIndex);
        const maxPending = 9;
        const available = Math.max(0, maxPending - (pathLengthLike | 0)) | 0;
        if (available <= 0) {
            this.playerEcs.setRunning(ecsIndex, !!opts.running);
            if (opts.moved) {
                this.animController?.cancelSequenceOnMove?.(state.serverId);
            }
            return;
        }

        const steps = state.dequeueSteps(Math.min(stepsPerTick, available));

        if (steps.length === 0) {
            // No queued steps but server provided explicit coordinates; snap to them to
            // avoid lingering a tile short when the server finishes the route.
            if (
                Number.isFinite(opts.subX) &&
                Number.isFinite(opts.subY) &&
                typeof opts.subX === "number" &&
                typeof opts.subY === "number"
            ) {
                const targetSubX = opts.subX | 0;
                const targetSubY = opts.subY | 0;
                const targetTileX = targetSubX >> 7;
                const targetTileY = targetSubY >> 7;
                const rot =
                    (typeof opts.orientation === "number"
                        ? opts.orientation
                        : state.lastOrientation) & 2047;

                const f = opts.running ? 2 : 1;
                this.playerEcs.setServerPos(ecsIndex, targetSubX, targetSubY, f, rot);
                state.setTile(
                    { x: targetTileX, y: targetTileY },
                    targetSubX,
                    targetSubY,
                    typeof opts.level === "number" ? opts.level : state.level,
                );
            }
            this.applyOrientationOnly(state, opts);
            return;
        }

        let lastOrientation = state.lastOrientation;

        for (let i = 0; i < steps.length; i++) {
            const step = steps[i];
            const stepSubX = (step.tile.x << 7) + 64;
            const stepSubY = (step.tile.y << 7) + 64;
            const traversal =
                typeof step.traversal === "number" ? step.traversal | 0 : step.run ? 2 : 1;
            // Per-step speed factor mirrors OSRS: 0 halves, 2 doubles.
            let factor = traversal === 0 ? 0.5 : traversal === 2 ? 2 : 1;

            // While moving, face movement direction (OSRS behavior)
            // IMPORTANT: Do not set targetRot here for future steps.
            // We enqueue the step with its orientation so PlayerEcs applies it
            // exactly when the segment starts. Forcing targetRot immediately
            // causes the player to face the next step’s direction mid-segment
            // (e.g., briefly facing east while still moving south).
            const directionOrientation = directionToOrientation(step.direction) & 2047;
            this.playerEcs.setServerPos(ecsIndex, stepSubX, stepSubY, factor, directionOrientation);
            // Keep lastOrientation for fallback decisions; PlayerEcs derives movement-facing
            // orientation from the active segment while preserving interaction-facing via targetRot.
            lastOrientation = directionOrientation;
        }

        // Update state to final tile we processed (last step in this batch)
        const finalStep = steps[steps.length - 1];
        const finalSubX = (finalStep.tile.x << 7) + 64;
        const finalSubY = (finalStep.tile.y << 7) + 64;
        const resolvedLevel = this.resolveTilePlane
            ? this.resolveTilePlane(finalStep.tile.x, finalStep.tile.y, opts.level)
            : opts.level;
        state.setTile(finalStep.tile, finalSubX, finalSubY, resolvedLevel);

        // OSRS: Reset movement delay counter when stationary (player-animation.md lines 210-211)
        // Only reset if we have NO steps left in queue
        if (!state.hasPendingSteps()) {
            this.playerEcs.resetMovementDelay?.(ecsIndex);
        }

        // Animation update logic
        // Keep the ECS "run toggle" in sync with the server hint for future decisions,
        // but drive animation strictly from per-step flags to avoid mislabeling
        // single-tile routes as running.
        this.playerEcs.setRunning(ecsIndex, !!opts.running);

        // Animation: only consider per-step run flags
        const anyRun = steps.some((s) => !!s.run);
        state.lastRunning = anyRun;

        // Always call applyMovementAnimation - it will check if player is actually moving
        // This ensures animation is updated both when new steps arrive AND when already moving
        this.applyMovementAnimation(state, anyRun);

        // After moving, only apply interaction-facing if there are no more steps queued
        if (!state.hasPendingSteps()) {
            const interactionOrientation = this.computeInteractionOrientation(ecsIndex);
            if (interactionOrientation !== undefined) {
                this.playerEcs.setTargetRot(ecsIndex, interactionOrientation & 2047);
                lastOrientation = interactionOrientation & 2047;
            }
        }
        state.lastOrientation = lastOrientation;
        if (opts.moved) {
            // OSRS parity: cancel the current action sequence on move iff `priority == 1`.
            // Reference: Player.method2429.
            this.animController?.cancelSequenceOnMove?.(state.serverId);
        }
    }

    private computeInteractionOrientation(ecsIndex: number): number | undefined {
        try {
            const rawIndex = this.playerEcs.getInteractionIndex(ecsIndex);
            if (typeof rawIndex !== "number" || rawIndex < 0) return undefined;
            const decoded = decodeInteractionIndex(rawIndex);
            if (!decoded) return undefined;
            const selfPos = this.samplePlayerVisualPosition(ecsIndex, false);
            if (!selfPos) return undefined;
            let targetX: number | undefined;
            let targetY: number | undefined;
            if (decoded.type === "player") {
                const targetIdx = this.playerEcs.getIndexForServerId(decoded.id | 0);
                if (targetIdx !== undefined) {
                    const pos = this.samplePlayerVisualPosition(targetIdx, false);
                    if (pos) {
                        targetX = pos.x;
                        targetY = pos.y;
                    }
                }
            } else if (decoded.type === "npc" && this.npcEcs) {
                const npcIdx = this.npcEcs.getEcsIdForServer(decoded.id | 0);
                if (npcIdx !== undefined) {
                    // Convert NPC local coordinates to world coordinates to match player coordinate system
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
        _applyLead: boolean,
    ): { x: number; y: number } | undefined {
        const x = this.playerEcs.getX(ecsIndex);
        const y = this.playerEcs.getY(ecsIndex);
        let sampleX = typeof x === "number" ? x | 0 : 0;
        let sampleY = typeof y === "number" ? y | 0 : 0;
        // No predictive lead for OSRS-accurate facing
        if (!Number.isFinite(sampleX) || !Number.isFinite(sampleY)) {
            return undefined;
        }
        return { x: sampleX | 0, y: sampleY | 0 };
    }

    private applyOrientationOnly(
        state: MovementState,
        opts: {
            subX: number;
            subY: number;
            level: number;
            running: boolean;
            rotation?: number;
            orientation?: number;
            turned: boolean;
            moved: boolean;
        },
    ): void {
        const ecsIndex = state.ecsIndex;
        if (!(ecsIndex >= 0)) return;
        const interactionOrientation = this.computeInteractionOrientation(ecsIndex);
        const resolvedLevel = this.resolveTilePlane
            ? this.resolveTilePlane(state.tileX, state.tileY, opts.level)
            : opts.level;
        state.setTile({ x: state.tileX, y: state.tileY }, opts.subX, opts.subY, resolvedLevel);
        // Defer orientation application until we know whether the player is visually idle.
        this.playerEcs.setRunning(ecsIndex, !!opts.running);

        // Check if player is visually stopped and should transition to idle
        // Must check: interpolation state, ECS queue, AND waypoint queue
        const isEcsMoving = this.playerEcs.isMoving(ecsIndex);
        const hasPendingWaypoints = state.hasPendingSteps();
        const visuallyMoving = isEcsMoving || hasPendingWaypoints;

        if (!visuallyMoving) {
            state.lastRunning = !!opts.running; // Update running state only when stopped
            // Apply interaction/server orientation only when idle to avoid mid-segment flips
            const orientation =
                interactionOrientation !== undefined
                    ? interactionOrientation
                    : this.resolveOrientation(
                          {
                              orientation: opts.orientation,
                              rotation: opts.rotation,
                              pathOrientation: undefined,
                              moved: false,
                          },
                          state.lastOrientation,
                      );
            if (orientation !== undefined) {
                this.playerEcs.setTargetRot(ecsIndex, orientation);
                state.lastOrientation = orientation;
            }
        }
        // If still visually moving: keep current animation
        // Do not snap rotation on pure turn updates; let ECS interpolate toward target
        // Do not cancel emotes on pure turn updates; OSRS allows emotes to finish
        // even if facing changes while idle.
    }

    private resolveOrientation(
        opts: {
            orientation?: number;
            rotation?: number;
            pathOrientation?: number;
            moved: boolean;
        },
        fallback: number,
    ): number | undefined {
        if (typeof opts.orientation === "number") {
            return opts.orientation & 2047;
        }
        if (opts.moved) {
            if (typeof opts.pathOrientation === "number") {
                return opts.pathOrientation & 2047;
            }
        } else {
            if (typeof opts.rotation === "number") {
                return opts.rotation & 2047;
            }
            if (typeof opts.pathOrientation === "number") {
                return opts.pathOrientation & 2047;
            }
        }
        if (typeof fallback === "number") return fallback & 2047;
        return undefined;
    }

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

    /**
     * Update rotation and animation for all players.
     * Called every frame to provide smooth OSRS-style continuous rotation and animation.
     */
    updateInteractionRotations(): void {
        for (const [, state] of this.states) {
            const ecsIndex = state.ecsIndex;
            if (!(ecsIndex >= 0)) continue;

            // If there are queued steps from a previous server update, process them at the
            // walk/run rate (1 or 2 per tick) until the queue is empty.
            if (state.hasPendingSteps()) {
                const opts = state.getLastMoveOpts();
                this.processQueuedSteps(state, opts, ecsIndex, 0);
            }

            const interactionOrientation = this.computeInteractionOrientation(ecsIndex);
            // OSRS: targetIndex facing applies regardless of movement (PendingSpawn.method2449).
            // This enables strafe/back movement animations while interacting.
            if (interactionOrientation !== undefined) {
                const rot = interactionOrientation & 2047;
                this.playerEcs.setTargetRot(ecsIndex, rot);
                state.lastOrientation = rot;
            }

            const isEcsMoving = this.playerEcs.isMoving(ecsIndex);
            const hasPendingWaypoints = state.hasPendingSteps();
            const isMoving = isEcsMoving || hasPendingWaypoints;
            if (!isMoving) {
                // Also resume any emote queued due to movement once fully stopped.
                this.ensureIdleAnimation(state, state.lastRunning);
            }

            // Update animation based on current movement state
            // This ensures animation switches from idle to walk/run when segment starts
            // (reuse isMoving computed above)

            if (isMoving) {
                // Use the stored running state from the last server update
                // This prevents animation flicker from stale segFactor values
                const running = state.lastRunning;

                // Player is moving - ensure movement animation
                this.applyMovementAnimation(state, running);
            }
        }
    }

    /**
     * Check if action sequence blocks movement animations
     * Reference: GraphicsObject.java:164-175
     */
    private checkSequenceBlocksMovement(state: MovementState, isMoving: boolean): boolean {
        const ecsIndex = state.ecsIndex;
        if (!(ecsIndex >= 0)) return false;

        try {
            if (!this.seqTypeLoader) return false;
            const seqId = this.playerEcs.getAnimSeqId(ecsIndex) | 0;
            if (seqId < 0) return false;
            const seqDelay = this.playerEcs.getAnimSeqDelay(ecsIndex) | 0;
            if (seqDelay !== 0) return false;

            const seqType: any = this.seqTypeLoader.load(seqId);
            if (!seqType) return false;

            // Reference: GraphicsObject.method2141 (sequence-based movement blocking)
            const movingSnapshot = this.playerEcs.getForcedMovementSteps(ecsIndex);
            const precedenceAnimating =
                typeof seqType.precedenceAnimating === "number" ? seqType.precedenceAnimating : -1;
            const priority = typeof seqType.priority === "number" ? seqType.priority : -1;

            // While pathLength>0 (movingSnapshot>0), precedenceAnimating controls blocking.
            if (isMoving) return (movingSnapshot | 0) > 0 && precedenceAnimating === 0;
            // When stationary (movingSnapshot<=0), priority controls blocking.
            return (movingSnapshot | 0) <= 0 && priority === 0;
        } catch {
            return false;
        }
    }

    private applyMovementAnimation(state: MovementState, running: boolean): void {
        const ecsIndex = state.ecsIndex;
        if (!(ecsIndex >= 0)) return;
        void running;

        // Determine client-side progress for this tick: only switch to movement anim
        // once pixels have actually moved (or interpolation stepT advanced), to avoid
        // premature run/walk during pre-turn or queuing.
        const t = this.playerEcs.getServerStepT(ecsIndex);
        const x = this.playerEcs.getX(ecsIndex) | 0;
        const y = this.playerEcs.getY(ecsIndex) | 0;
        const px = this.playerEcs.getPrevX(ecsIndex) | 0;
        const py = this.playerEcs.getPrevY(ecsIndex) | 0;
        const movedPixels = (x | 0) !== (px | 0) || (y | 0) !== (py | 0);
        const progressed = (Number(t) > 0 && Number(t) < 1.1) || movedPixels;

        // If we haven't progressed yet, hold current animation (allow turn/idle),
        // and do not switch to movement yet.
        if (!progressed) {
            return;
        }

        // Check if action sequence blocks movement (GraphicsObject.java:164-175)
        if (this.checkSequenceBlocksMovement(state, true)) {
            return; // Skip movement animation update
        }

        // MovementSequence (walk/run/crawl + direction) is authored in `PlayerEcs` to match
        // `GraphicsObject.method2141` exactly. This hook remains only for field1245 tracking.
        return;
    }

    private ensureIdleAnimation(state: MovementState, running: boolean): void {
        const ecsIndex = state.ecsIndex;
        if (!(ecsIndex >= 0)) return;
        // MovementSequence (walk/run/turn/crawl) is authored in `PlayerEcs` (GraphicsObject.method2141
        // + PendingSpawn.method2449 parity).
    }
}
