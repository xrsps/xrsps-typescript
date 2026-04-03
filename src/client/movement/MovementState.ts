import type { MovementStep } from "./MovementPath";
import type { TileCoord } from "./MovementPath";

export interface MovementStateInit {
    serverId: number;
    ecsIndex: number;
    tile: TileCoord;
    level: number;
    subX: number;
    subY: number;
}

/**
 * Lightweight per-entity movement state.
 *
 * Tracks the authoritative tile position (as reported by the last server update)
 * and auxiliary rendering hints (orientation, running flag).  There is no
 * intermediate waypoint queue — steps are pushed directly to the ECS
 * interpolation ring buffer by {@link PlayerMovementSync}.
 */
export class MovementState {
    readonly serverId: number;
    ecsIndex: number;
    tileX: number;
    tileY: number;
    level: number;
    subX: number;
    subY: number;

    lastOrientation: number = 0;
    lastRunning: boolean = false;

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
