import { faceAngleRs } from "../../../src/rs/utils/rotation";
import {
    MovementDirection,
    deltaToDirection,
    deltaToRunDirection,
    directionToDelta,
} from "../../../src/shared/Direction";
import { logger } from "../utils/logger";
import {
    type InteractionIndex,
    type InteractionTargetType,
    NO_INTERACTION,
    clampInteractionIndex,
    decodeInteractionTarget,
    encodeInteractionIndex,
} from "./interactionIndex";

export type Tile = { x: number; y: number };

// Debug logging: Player IDs are automatically added/removed on connect/disconnect
// This enables path logging for all connected human players (not bots)
export const DEBUG_PLAYER_IDS = new Set<number>();

const PATH_BUFFER_CAPACITY = 128;

/**
 * Traversal type flags mirroring class231 in Player.java.
 * Reference: references/runescape-client/src/main/java/class231.java
 *
 * These flags distinguish between:
 * - SLOW: Half-speed step (var8 >>= 1)
 * - WALK: Normal step (no speed scaling)
 * - RUN: Double-speed step (var8 <<= 1)
 */
export enum TraversalType {
    DEFAULT = -1,
    SLOW = 0,
    WALK = 1,
    RUN = 2,
}

type StepPosition = {
    x: number;
    y: number;
    level: number;
    rot: number;
    running: boolean;
    traversal: TraversalType;
    seq?: number;
    orientation?: number;
    direction?: number;
};

type TurnDirection = 0 | -1 | 1;

export const RUN_ENERGY_MAX = 10000;

export abstract class Actor {
    readonly id: number;
    readonly isPlayer: boolean = false; // Override to true in PlayerState
    readonly size: number;
    tileX: number;
    tileY: number;
    level: number;
    x: number;
    y: number;
    running: boolean = false;
    rot: number = 0; // current rotation (0..2047)
    orientation: number = 0; // desired orientation (0..2047)
    forcedOrientation: number = -1; // -1 = none
    turnSpeed: number = 32;
    idleTurnTicks: number = 0;
    lastTileX: number;
    lastTileY: number;

    // Follow positions - stores last step position for followers to path to
    // This prevents followers from pathing through the target's current tile
    // Reference: Lost City's followX/followZ implementation
    followX: number;
    followZ: number;

    // Path queue sized to hold full routes returned by the server pathfinder.
    // Reference: player-movement.md (method2415:60-73, resetPath:43-52)
    // The buffer stores steps in reverse order:
    // - Index 0: Most recently added step (newest)
    // - Index pathLength-1: Next step to consume (oldest)
    protected pathX: number[] = new Array(PATH_BUFFER_CAPACITY).fill(0);
    protected pathY: number[] = new Array(PATH_BUFFER_CAPACITY).fill(0);
    protected pathTraversed: TraversalType[] = new Array(PATH_BUFFER_CAPACITY).fill(
        TraversalType.WALK,
    );
    protected pathLength: number = 0; // Number of valid steps currently buffered

    private lastSentX?: number;
    private lastSentY?: number;
    private lastSentLevel?: number;
    private lastSentRot?: number;
    private lastSentRunning?: boolean;
    private movedLastTick: boolean = false;
    private turnedLastTick: boolean = false;

    private stepPositions: StepPosition[] = [];

    private teleportedFlag: boolean = false;

    /**
     * Deferred movement flag (field1124 in Player.java).
     * Reference: player-movement.md (readPlayerUpdate:333, 189-194)
     *
     * When true, movement is stored but interpolation is deferred until
     * the update mask is processed. This ensures movement and appearance
     * updates are synchronized properly.
     */
    protected deferredMovement: boolean = false;
    protected deferredTileX: number = 0;
    protected deferredTileY: number = 0;

    private interactionIndex: InteractionIndex = NO_INTERACTION;
    private interactionDirty: boolean = false;
    public pendingFaceTile?: { x: number; y: number };

    // OSRS parity: Actor HSL color override (poison/freeze/venom tints)
    private _colorOverride: {
        hue: number;
        sat: number;
        lum: number;
        amount: number;
        durationTicks: number;
    } | null = null;
    private _colorOverrideDirty: boolean = false;

    // OSRS parity: run is off by default and is toggled via varp 173 / run orb.
    runToggle: boolean = false;
    runEnergy: number = RUN_ENERGY_MAX;

    nextStepReservation1?: { x: number; y: number } | null;
    nextStepReservation2?: { x: number; y: number } | null;

    anim = {
        idle: 808,
        walk: 819,
        walkBack: undefined as number | undefined,
        walkLeft: undefined as number | undefined,
        walkRight: undefined as number | undefined,
        run: 824,
        runBack: undefined as number | undefined,
        runLeft: undefined as number | undefined,
        runRight: undefined as number | undefined,
        turnLeft: 823,
        turnRight: 823,
    };

    private pendingSeqs: Array<{ seqId: number; delay: number }> = [];
    private singleStepRoutePending: number = 0; // 1 when a user-initiated route has exactly one step

    // Allow subclasses (e.g., PlayerState) to explicitly mark a fresh, single-step route
    // so that the next step is treated as WALK, matching OSRS behavior.
    protected markSingleStepRoutePending(pending: boolean): void {
        this.singleStepRoutePending = pending ? 1 : 0;
    }

    private movementLockUntilTick: number = 0;
    private movementTickContext: number = 0;

    /**
     * Primary health bar definition id to use for this actor.
     * In OSRS this id is fully server-authored via update blocks.
     */
    getHealthBarDefinitionId(): number {
        return 0;
    }

    protected constructor(
        id: number,
        spawnTileX: number,
        spawnTileY: number,
        level: number = 0,
        size: number = 1,
    ) {
        this.id = id;
        this.tileX = spawnTileX;
        this.tileY = spawnTileY;
        this.level = level;
        this.size = Math.max(1, size);
        // Reference: player-movement.md (resetPath:50)
        // World coordinates = tile * 128 + modelRadius * 64
        // For 1x1 actors, modelRadius = 1, so: tile * 128 + 64
        this.x = this.tileX * 128 + this.size * 64;
        this.y = this.tileY * 128 + this.size * 64;
        this.lastTileX = this.tileX;
        this.lastTileY = this.tileY;
        // Initialize follow positions to one tile offset so they're different from current position
        this.followX = this.tileX - 1;
        this.followZ = this.tileY;
        this.rot = this.rot & 2047;
        this.orientation = this.rot;
        this.resetPathInternal(this.tileX, this.tileY);
    }

    /**
     * Checks if world coordinates are within valid scene bounds.
     * Reference: player-movement.md (readPlayerUpdate:186-196)
     *
     * The client validates coordinates to prevent desync during region transitions.
     * Valid range: 1536 to 11776 world units (12 to 92 tiles).
     *
     * @param worldX World X coordinate (tile * 128 + offset)
     * @param worldY World Y coordinate (tile * 128 + offset)
     * @returns true if coordinates are outside scene bounds
     */
    protected isOutsideSceneBounds(worldX: number, worldY: number): boolean {
        const MIN_WORLD_COORD = 1536; // 12 tiles * 128
        const MAX_WORLD_COORD = 11776; // 92 tiles * 128
        return (
            worldX < MIN_WORLD_COORD ||
            worldY < MIN_WORLD_COORD ||
            worldX >= MAX_WORLD_COORD ||
            worldY >= MAX_WORLD_COORD
        );
    }

    /**
     * Resets the path queue to a single tile position.
     * Reference: player-movement.md (resetPath:43-52, Player.java)
     *
     * @param tileX Target tile X coordinate
     * @param tileY Target tile Y coordinate
     */
    protected resetPathInternal(tileX: number, tileY: number): void {
        this.pathLength = 0;
        this.pathX[0] = tileX;
        this.pathY[0] = tileY;
        // World coordinates = tile * 128 + transformedSize() * 64
        this.x = this.pathX[0] * 128 + this.size * 64;
        this.y = this.pathY[0] * 128 + this.size * 64;
    }

    setMovementTick(currentTick: number): void {
        this.movementTickContext = Math.max(0, currentTick);
    }

    protected lockMovementUntil(tick: number): void {
        const normalized = Math.max(0, tick);
        if (normalized > this.movementLockUntilTick) {
            this.movementLockUntilTick = normalized;
        }
    }

    protected clearMovementLock(): void {
        this.movementLockUntilTick = 0;
    }

    protected movementLockRemaining(currentTick: number): number {
        return Math.max(0, this.movementLockUntilTick - Math.max(0, currentTick));
    }

    holdMovementUntil(tick: number): void {
        this.lockMovementUntil(tick);
        this.clearPath();
        this.running = false;
    }

    releaseMovementHold(): void {
        this.clearMovementLock();
    }

    /**
     * Adds a step to the path queue by shifting existing steps and inserting at index 0.
     * Reference: player-movement.md (method2415:59-73, Player.java)
     *
     * @param tileX Step tile X coordinate
     * @param tileY Step tile Y coordinate
     * @param traversalType Walk/Run/ForcedRun flag
     */
    protected addStepToPath(tileX: number, tileY: number, traversalType: TraversalType): void {
        // Maintain a bounded path buffer so extremely long routes do not grow unbounded.
        const capacity = PATH_BUFFER_CAPACITY;
        const newLength = Math.min(capacity, this.pathLength + 1);
        // Shift existing steps right, dropping the farthest future step if capacity is full
        for (let i = newLength - 1; i > 0; i--) {
            this.pathX[i] = this.pathX[i - 1];
            this.pathY[i] = this.pathY[i - 1];
            this.pathTraversed[i] = this.pathTraversed[i - 1];
        }
        this.pathLength = newLength;

        // Insert new step at index 0
        this.pathX[0] = tileX;
        this.pathY[0] = tileY;
        this.pathTraversed[0] = traversalType;
    }

    getOrientation(): number {
        return this.orientation & 2047;
    }

    setTurnSpeed(speed: number): void {
        this.turnSpeed = Math.max(1, speed);
    }

    setForcedOrientation(rot: number): void {
        const next = rot & 2047;
        this.forcedOrientation = next;
        this.orientation = next;
        // Keep current rotation in sync so clients see an immediate snap
        // instead of gradually interpolating toward the forced orientation.
        this.rot = next;
        this.idleTurnTicks = 0;
    }

    clearForcedOrientation(): void {
        this.forcedOrientation = -1;
    }

    queueOneShotSeq(seqId: number | undefined, delay: number = 0): void {
        if (seqId !== undefined) {
            this.pendingSeqs.push({
                seqId: seqId,
                delay: Math.max(0, delay),
            });
        }
    }

    stopAnimation(): void {
        this.clearPendingSeqs();
        this.queueOneShotSeq(-1);
    }

    clearPendingSeqs(): void {
        this.pendingSeqs = [];
    }

    /**
     * Check if there are any pending sequences in the queue.
     * Used to avoid queueing lower-priority animations when a higher-priority
     * animation is already pending (e.g., don't queue block when attack is pending).
     */
    hasPendingSeq(): boolean {
        return this.pendingSeqs.length > 0;
    }

    popPendingSeq(): { seqId: number; delay: number } | undefined {
        if (this.pendingSeqs.length === 0) {
            return undefined;
        }
        return this.pendingSeqs.shift();
    }

    setInteraction(targetType: InteractionTargetType, targetId: number): void {
        const next = encodeInteractionIndex(targetType, targetId);
        if (next !== this.interactionIndex) {
            this.interactionIndex = next;
            this.interactionDirty = true;
        }
    }

    setInteractionIndex(index: InteractionIndex): void {
        const next = clampInteractionIndex(index);
        if (next !== this.interactionIndex) {
            this.interactionIndex = next;
            this.interactionDirty = true;
        }
    }

    clearInteraction(): void {
        if (this.interactionIndex !== NO_INTERACTION) {
            this.interactionIndex = NO_INTERACTION;
            this.interactionDirty = true;
            this.stopAnimation();
        }
    }

    clearInteractionTarget(): void {
        if (this.interactionIndex !== NO_INTERACTION) {
            this.interactionIndex = NO_INTERACTION;
            this.interactionDirty = true;
        }
    }

    getInteractionIndex(): InteractionIndex {
        return this.interactionIndex;
    }

    getInteractionTarget(): { id: number; type: InteractionTargetType } | undefined {
        const decoded = decodeInteractionTarget(this.interactionIndex);
        if (!decoded) return undefined;
        return decoded;
    }

    isInteractionDirty(): boolean {
        return this.interactionDirty;
    }

    consumeInteractionDirty(): boolean {
        const dirty = this.interactionDirty;
        this.interactionDirty = false;
        return dirty;
    }

    /**
     * Apply a timed HSL color override to this actor.
     * OSRS parity: Actor.colorOverride / HslOverride.
     * @param hue HSL hue component (-1 = no override, 0-63 packed range)
     * @param sat HSL saturation component (-1 = no override, 0-7 packed range)
     * @param lum HSL lightness component (-1 = no override, 0-127 packed range)
     * @param amount Lerp amount (0-255, 0=none, 255=full)
     * @param durationTicks Duration in server ticks
     */
    setColorOverride(
        hue: number,
        sat: number,
        lum: number,
        amount: number,
        durationTicks: number,
    ): void {
        this._colorOverride = { hue, sat, lum, amount, durationTicks };
        this._colorOverrideDirty = true;
    }

    clearColorOverride(): void {
        this._colorOverride = null;
    }

    getColorOverride(): {
        hue: number;
        sat: number;
        lum: number;
        amount: number;
        durationTicks: number;
    } | null {
        return this._colorOverride;
    }

    isColorOverrideDirty(): boolean {
        return this._colorOverrideDirty;
    }

    consumeColorOverrideDirty(): boolean {
        const dirty = this._colorOverrideDirty;
        this._colorOverrideDirty = false;
        return dirty;
    }

    setPath(steps: Tile[], run: boolean): void {
        this.running = !!run;
        this.clearForcedOrientation();

        // OSRS behaviour for server-authoritative routing:
        // a new destination replaces the existing walk queue (no queue blending/extension).
        this.pathLength = 0;
        // If this is a fresh route and it's exactly one tile, mark it so we walk it.
        this.markSingleStepRoutePending(steps.length === 1);

        // Add steps to the bounded path buffer (oldest steps execute first)
        const maxStepsToAdd = Math.min(steps.length, PATH_BUFFER_CAPACITY - this.pathLength);

        for (let i = 0; i < maxStepsToAdd; i++) {
            const step = steps[i];
            // For single-step routes, force WALK traversal
            const tr =
                this.singleStepRoutePending > 0
                    ? TraversalType.WALK
                    : run
                    ? TraversalType.RUN
                    : TraversalType.WALK;
            this.addStepToPath(step.x, step.y, tr);
        }
    }

    peekNextStep(): Tile | undefined {
        if (this.pathLength > 0) {
            // Next step to consume is at the tail (oldest step)
            const nextIndex = this.pathLength - 1;
            return { x: this.pathX[nextIndex], y: this.pathY[nextIndex] };
        }
        return undefined;
    }

    clearPath(): void {
        this.pathLength = 0;
        this.pathX[0] = this.tileX;
        this.pathY[0] = this.tileY;
    }

    hasPath(): boolean {
        return this.pathLength > 0;
    }

    /**
     * Returns the current path as an array of tiles.
     * Used for testing and debugging. Returns steps in order they will be executed (oldest to newest).
     */
    getPathQueue(): Tile[] {
        const queue: Tile[] = [];
        // Path buffer stores steps in reverse order (index 0 is newest, pathLength-1 is oldest/next)
        // Return them in execution order (oldest first)
        for (let i = this.pathLength - 1; i >= 0; i--) {
            queue.push({ x: this.pathX[i], y: this.pathY[i] });
        }
        return queue;
    }

    /**
     * Convenience accessor for tests/tools that historically interacted with a `queue` array.
     * Assigning to `queue` reuses the normal setPath pipeline so reservations and blending work.
     */
    get queue(): Tile[] {
        return this.getPathQueue();
    }

    set queue(steps: Tile[]) {
        if (!Array.isArray(steps)) {
            this.clearPath();
            return;
        }
        this.setPath(steps, !!this.running);
    }

    hasAvailableRunEnergy(): boolean {
        return this.runEnergy > 0;
    }

    tickStep(): boolean {
        this.stepPositions.length = 0;
        this.turnedLastTick = false;

        const signedDelta = (target: number, current: number): number => {
            let delta = (target - current) & 2047;
            if (delta > 1024) delta -= 2048;
            return delta;
        };

        const orientTo = (fromX: number, fromY: number, toX: number, toY: number): number => {
            let or = this.orientation;
            if (fromX < toX) {
                if (fromY < toY) or = 1280;
                else if (fromY > toY) or = 1792;
                else or = 1536;
            } else if (fromX > toX) {
                if (fromY < toY) or = 768;
                else if (fromY > toY) or = 256;
                else or = 512;
            } else if (fromY < toY) or = 1024;
            else if (fromY > toY) or = 0;
            return or & 2047;
        };

        const currentRot = this.rot & 2047;

        if (this.pathLength > 0) {
            const nextIndex = this.pathLength - 1;
            const nextX = this.pathX[nextIndex];
            const nextY = this.pathY[nextIndex];
            const preOrientation = orientTo(this.tileX, this.tileY, nextX, nextY);
            if (!this.movedLastTick) {
                const delta = Math.abs(signedDelta(preOrientation, currentRot));
                if (delta > 256 + this.turnSpeed) {
                    this.orientation = preOrientation;
                }
            }
        } else if (this.forcedOrientation >= 0) {
            this.orientation = this.forcedOrientation & 2047;
        }

        const currentTick = this.movementTickContext;
        if (currentTick > 0 && this.movementLockUntilTick > currentTick) {
            if (this.pathLength > 0) {
                this.clearPath();
            }
            this.movedLastTick = false;
            this.turnedLastTick = false;
            return false;
        } else if (this.movementLockUntilTick !== 0 && currentTick >= this.movementLockUntilTick) {
            this.movementLockUntilTick = 0;
        }

        // Apply any deferred movement that was queued alongside update masks so
        // movement and appearance stay in sync (matches Client.readPlayerUpdate logic).
        this.processDeferredMovement();

        let reservation1: { x: number; y: number } | null | undefined = this.nextStepReservation1;
        let reservation2: { x: number; y: number } | null | undefined = this.nextStepReservation2;
        this.nextStepReservation1 = undefined;
        this.nextStepReservation2 = undefined;
        let stepIdx = 1;

        const pendingSteps: StepPosition[] = [];

        // Use shared direction encoding (MovementDirection enum)
        const encodeDirection = (dx: number, dy: number): number | undefined => {
            const sx = dx > 0 ? 1 : dx < 0 ? -1 : 0;
            const sy = dy > 0 ? 1 : dy < 0 ? -1 : 0;
            return deltaToDirection(sx, sy);
        };

        const stepOnce = (): boolean => {
            if (this.pathLength <= 0) {
                return false;
            }

            // Get next step from tail of buffer (oldest step)
            const nextIndex = this.pathLength - 1;
            const nextX = this.pathX[nextIndex];
            const nextY = this.pathY[nextIndex];

            const resv = stepIdx === 1 ? reservation1 : reservation2;
            if (resv !== undefined) {
                if (resv === null) {
                    return false;
                }
                if (nextX !== resv.x || nextY !== resv.y) {
                    return false;
                }
            }

            // Consume step by decrementing pathLength
            this.pathLength--;

            const ox = this.tileX;
            const oy = this.tileY;
            this.lastTileX = ox;
            this.lastTileY = oy;
            this.tileX = nextX;
            this.tileY = nextY;
            // Reference: player-movement.md (resetPath:50)
            // World coordinates = tile * 128 + modelRadius * 64
            this.x = this.tileX * 128 + this.size * 64;
            this.y = this.tileY * 128 + this.size * 64;

            const orientationStep = orientTo(ox, oy, this.tileX, this.tileY);
            const orientation =
                this.forcedOrientation >= 0 ? this.forcedOrientation & 2047 : orientationStep;
            this.orientation = orientation;
            const delta = signedDelta(orientation, this.rot & 2047);
            const straight = delta >= -256 && delta <= 256;
            const right = delta >= 256 && delta < 768;
            const left = delta <= -256 && delta > -768;
            const turnThreshold = this.turnSpeed;
            let willRun = !!this.running && this.hasAvailableRunEnergy();
            // If this was a single-tile route, treat it as walking even when run is toggled
            if (this.singleStepRoutePending > 0) willRun = false;

            // OSRS behavior: If we are running, but only one step remains in the path
            // AND we are processing the first step of the tick, then we are effectively walking
            // the last remaining tile.
            if (willRun && this.pathLength === 0 && stepIdx === 1) {
                willRun = false;
            }

            const queuedTraversal = this.pathTraversed[nextIndex] ?? TraversalType.WALK;
            const traversal: TraversalType =
                queuedTraversal === TraversalType.SLOW
                    ? TraversalType.SLOW
                    : willRun
                    ? TraversalType.RUN
                    : TraversalType.WALK;

            const directionCode = encodeDirection(this.tileX - ox, this.tileY - oy);
            const record: StepPosition = {
                x: this.x,
                y: this.y,
                level: this.level,
                rot: 0,
                running: traversal === TraversalType.RUN,
                traversal,
                orientation: orientation & 2047,
                direction: directionCode,
                // Do not include movement sequence here; client resolves from BAS
            };
            this.stepPositions.push(record);
            pendingSteps.push(record);

            if (this.singleStepRoutePending > 0) this.singleStepRoutePending = 0;
            stepIdx++;
            return true;
        };

        let moved = false;
        if (this.running && this.hasAvailableRunEnergy()) {
            moved = stepOnce() || moved;

            // Before taking second step, check if the combined direction would produce
            // a valid 4-bit run encoding. Perpendicular cardinals (E+S, N+W, etc.)
            // produce deltas like (1,-1) which have no valid run code.
            if (moved && this.pathLength > 0 && pendingSteps.length === 1) {
                const firstDir = pendingSteps[0].direction;
                if (firstDir !== undefined) {
                    // Peek at what the second step's direction would be
                    const nextIndex = this.pathLength - 1;
                    const nextX = this.pathX[nextIndex];
                    const nextY = this.pathY[nextIndex];
                    const secondDx = nextX - this.tileX;
                    const secondDy = nextY - this.tileY;
                    const secondDir = deltaToDirection(
                        secondDx > 0 ? 1 : secondDx < 0 ? -1 : 0,
                        secondDy > 0 ? 1 : secondDy < 0 ? -1 : 0,
                    );

                    if (secondDir !== undefined) {
                        // Calculate combined delta for run encoding check
                        const d1 = directionToDelta(firstDir as MovementDirection);
                        const d2 = directionToDelta(secondDir as MovementDirection);
                        const combinedDx = d1.dx + d2.dx;
                        const combinedDy = d1.dy + d2.dy;
                        const runCode = deltaToRunDirection(combinedDx, combinedDy);

                        if (runCode < 0) {
                            // Invalid run encoding (perpendicular cardinals) - skip second step
                            // It will be taken as a walk step next tick
                        } else {
                            // Valid run encoding - take the second step
                            moved = stepOnce() || moved;
                        }
                    } else {
                        // Second step direction undefined (shouldn't happen) - take it anyway
                        moved = stepOnce() || moved;
                    }
                } else {
                    // First step has no direction (shouldn't happen) - take second step anyway
                    moved = stepOnce() || moved;
                }
            } else if (this.pathLength > 0) {
                // First step didn't move or we already have multiple pending steps - take second step
                moved = stepOnce() || moved;
            }
        } else {
            moved = stepOnce() || moved;
        }

        if (moved) {
            this.idleTurnTicks = 0;
        } else if (this.pathLength === 0 && this.forcedOrientation >= 0) {
            this.orientation = this.forcedOrientation & 2047;
        }

        // Rotate toward orientation with turn speed (OSRS parity for all actors).
        let rotated = false;
        let turnDir: TurnDirection = 0;
        const rotationResult = this.stepRotationTowardsOrientation();
        rotated = rotationResult.rotated;
        turnDir = rotationResult.direction;

        for (const record of pendingSteps) {
            record.rot = this.rot & 2047;
        }

        if (!moved && rotated && this.forcedOrientation >= 0) {
            // Send pure rotation change; client will pick idle turn sequence if desired
            this.stepPositions.push({
                x: this.x,
                y: this.y,
                level: this.level,
                rot: this.rot & 2047,
                running: false,
                traversal: TraversalType.WALK,
                orientation: this.orientation & 2047,
            });
            this.turnedLastTick = true;
        }

        if (!moved) {
            if (rotated) this.idleTurnTicks = Math.min(this.idleTurnTicks + 1, 25);
            else if (signedDelta(this.orientation, this.rot) === 0) this.idleTurnTicks = 0;
        }

        this.movedLastTick = this.stepPositions.length > 0;

        return moved;
    }

    private stepRotationTowardsOrientation(): { rotated: boolean; direction: TurnDirection } {
        const target = this.orientation & 2047;
        const current = this.rot & 2047;
        let delta = (target - current) & 2047;
        if (delta === 0) {
            return { rotated: false, direction: 0 };
        }
        if (delta > 1024) {
            delta -= 2048;
        }
        const direction: -1 | 1 = delta > 0 ? 1 : -1;
        const magnitude = Math.abs(delta);
        const step = Math.min(this.turnSpeed, magnitude);
        let next = (current + direction * step) & 2047;
        if (step >= magnitude) {
            next = target;
        }
        this.rot = next & 2047;
        return { rotated: true, direction };
    }

    setRunToggle(on: boolean): void {
        this.runToggle = !!on;
        this.running = this.runToggle;
    }

    faceRot(rot: number): void {
        this.setForcedOrientation(rot);
    }

    faceTile(x: number, y: number): void {
        this.pendingFaceTile = { x: x, y: y };
        this.clearForcedOrientation();
        // Calculate target angle server-side so getOrientation() is correct for NPC updates
        // and other logic that relies on the actor's current target facing.
        const angle = faceAngleRs(this.tileX, this.tileY, x, y);
        this.orientation = angle & 2047;
        // Note: We do NOT set this.rot here, allowing the client to interpolate.
    }

    drainStepPositions(): StepPosition[] {
        const out = this.stepPositions.slice();
        this.stepPositions.length = 0;
        return out;
    }

    didMove(): boolean {
        return !!this.movedLastTick;
    }

    didTurn(): boolean {
        return !!this.turnedLastTick;
    }

    shouldSendPos(): boolean {
        // Reduce network spam by only sending significant position changes
        // Always send level changes or when actually moved
        if (this.lastSentLevel !== this.level) return true;

        // Only send if position actually changed (not just sub-tile rounding)
        const posChanged = this.lastSentX !== this.x || this.lastSentY !== this.y;
        if (!posChanged) return false;

        // Send if moved at least 1 sub-tile (meaningful change)
        const dx = Math.abs(this.x - (this.lastSentX ?? this.x));
        const dy = Math.abs(this.y - (this.lastSentY ?? this.y));

        return dx > 0 || dy > 0;
    }

    markSent(): void {
        this.lastSentX = this.x;
        this.lastSentY = this.y;
        this.lastSentLevel = this.level;
        this.lastSentRot = this.rot;
        this.lastSentRunning = this.running;
    }

    teleport(tileX: number, tileY: number, level?: number): void {
        // Allow teleport anywhere (admin/debug feature); no bounds enforcement for now.
        this.clearPath();
        if (level !== undefined) this.level = level;
        this.tileX = tileX;
        this.tileY = tileY;
        // Reference: player-movement.md (resetPath:50)
        // World coordinates = tile * 128 + modelRadius * 64
        this.x = this.tileX * 128 + this.size * 64;
        this.y = this.tileY * 128 + this.size * 64;
        this.running = false;
        this.orientation = this.rot & 2047;
        this.clearForcedOrientation();
        this.idleTurnTicks = 0;
        this.teleportedFlag = true;
        this.resetPathInternal(this.tileX, this.tileY);
        logger.info(`[Actor] Teleported to tile (${tileX}, ${tileY}, ${this.level})`);
    }

    wasTeleported(): boolean {
        return this.teleportedFlag;
    }

    clearTeleportFlag(): void {
        this.teleportedFlag = false;
    }

    /**
     * Sets deferred movement for synchronization with update masks.
     * Reference: player-movement.md (readPlayerUpdate:189-194)
     *
     * @param tileX Deferred tile X
     * @param tileY Deferred tile Y
     */
    setDeferredMovement(tileX: number, tileY: number): void {
        this.deferredMovement = true;
        this.deferredTileX = tileX;
        this.deferredTileY = tileY;
    }

    /**
     * Processes deferred movement if pending.
     * Reference: player-movement.md (readPlayerUpdate:189-194)
     */
    processDeferredMovement(): void {
        if (this.deferredMovement) {
            this.deferredMovement = false;
            // Apply the deferred movement as a step
            const traversalType = this.running ? TraversalType.RUN : TraversalType.WALK;
            this.addStepToPath(this.deferredTileX, this.deferredTileY, traversalType);
        }
    }

    /**
     * Checks if there's a deferred movement pending.
     */
    hasDeferredMovement(): boolean {
        return this.deferredMovement;
    }

    // Movement step sequences removed: client selects movement animations from BAS.
}
