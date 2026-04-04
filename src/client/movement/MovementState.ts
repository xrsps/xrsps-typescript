import type { MovementStep } from "./MovementPath";
import type { TileCoord } from "./MovementPath";
import type { MovementStateOptions } from "./MovementSyncTypes";

export interface MovementStateInit {
    serverId: number;
    ecsIndex: number;
    tile: TileCoord;
    level: number;
    subX: number;
    subY: number;
}

// OSRS parity: Actor path buffers are length 10 with `pathLength` capped to 9 pending steps.
const MAX_WAYPOINTS = 9;

export class MovementState {
    readonly serverId: number;
    ecsIndex: number;
    tileX: number;
    tileY: number;
    level: number;
    subX: number;
    subY: number;

    lastOrientation: number = 0;
    lastUpdateTick: number = 0;
    lastRunning: boolean = false; // Track actual running state from server
    // Stabilize directional animation selection to avoid 1-tick flicker at angle boundaries
    lastAngleBucket: number = 0; // -1=left, 0=forward, 1=right, 2=back

    private lastMoveOpts?: MovementStateOptions;

    // Persistent waypoint queue (FIFO, max 9 waypoints; OSRS pathLength cap)
    private waypoints: MovementStep[] = [];

    private lastSteps: MovementStep[] = [];

    constructor(init: MovementStateInit) {
        this.serverId = init.serverId;
        this.ecsIndex = init.ecsIndex;
        this.tileX = init.tile.x | 0;
        this.tileY = init.tile.y | 0;
        this.level = init.level | 0;
        this.subX = init.subX | 0;
        this.subY = init.subY | 0;
    }

    setEcsIndex(index: number): void {
        this.ecsIndex = index;
    }

    setTile(tile: TileCoord, subX: number, subY: number, level: number): void {
        this.tileX = tile.x | 0;
        this.tileY = tile.y | 0;
        this.subX = subX | 0;
        this.subY = subY | 0;
        this.level = level | 0;
    }

    setLastAngleBucket(bucket: number): void {
        this.lastAngleBucket = bucket | 0;
    }

    setLastMoveOpts(opts: MovementStateOptions): void {
        this.lastMoveOpts = { ...opts };
    }

    getLastMoveOpts(): MovementStateOptions {
        if (this.lastMoveOpts) return this.lastMoveOpts;
        return {
            subX: this.subX,
            subY: this.subY,
            level: this.level,
            running: this.lastRunning,
            turned: false,
            moved: false,
        };
    }

    getLastAngleBucket(): number {
        return this.lastAngleBucket | 0;
    }

    /**
     * Queue waypoints in FIFO order.
     * OSRS parity on overflow: keep newest steps by discarding oldest pending entries.
     */
    enqueueSteps(steps: MovementStep[]): void {
        if (!steps.length) return;

        // Queue in forward order (FIFO)
        for (let i = 0; i < steps.length; i++) {
            if (this.waypoints.length >= MAX_WAYPOINTS) this.waypoints.shift();
            const step = steps[i];
            this.waypoints.push({
                tile: { x: step.tile.x | 0, y: step.tile.y | 0 },
                direction: step.direction,
                run: !!step.run,
                traversal: typeof step.traversal === "number" ? step.traversal | 0 : undefined,
                turn: !!step.turn,
            });
        }
    }

    /**
     * Clear all pending waypoints
     */
    clearPendingSteps(): void {
        this.waypoints = [];
    }

    /**
     * Check if there are pending waypoints
     */
    hasPendingSteps(): boolean {
        return this.waypoints.length > 0;
    }

    /**
     * Get the number of pending waypoints
     */
    getPendingStepCount(): number {
        return this.waypoints.length;
    }

    /**
     * Peek at the next waypoint without removing it
     */
    peekNextStep(): MovementStep | undefined {
        if (this.waypoints.length === 0) return undefined;
        return this.waypoints[0];
    }

    /**
     * Dequeue a single waypoint (shift from queue)
     */
    dequeueStep(): MovementStep | undefined {
        return this.waypoints.shift();
    }

    /**
     * Dequeue up to N waypoints for processing this tick
     */
    dequeueSteps(maxSteps: number): MovementStep[] {
        const steps: MovementStep[] = [];
        const limit = Math.min(maxSteps, this.waypoints.length);
        for (let i = 0; i < limit; i++) {
            const step = this.waypoints.shift();
            if (!step) break;
            steps.push(step);
        }
        return steps;
    }

    /**
     * Get all pending waypoints without removing them (for debugging/visualization)
     */
    getAllPendingSteps(): readonly MovementStep[] {
        return this.waypoints;
    }

    setLastSteps(steps: MovementStep[]): void {
        if (!steps.length) {
            this.lastSteps = [];
            return;
        }
        this.lastSteps = steps.map((step) => ({
            tile: { x: step.tile.x | 0, y: step.tile.y | 0 },
            direction: step.direction,
            run: !!step.run,
            traversal: typeof step.traversal === "number" ? step.traversal | 0 : undefined,
            turn: !!step.turn,
        }));
    }

    getLastSteps(): readonly MovementStep[] {
        return this.lastSteps;
    }
}
