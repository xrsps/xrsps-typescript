export interface Position {
    x: number;
    y: number;
    z: number;
    orientation: number;
}

interface PathStep {
    position: Position;
    cycle: number;
}

function copyPosition(src: Position, dst: Position): void {
    dst.x = src.x;
    dst.y = src.y;
    dst.z = src.z;
    dst.orientation = src.orientation;
}

function createPosition(): Position {
    return { x: 0, y: 0, z: 0, orientation: 0 };
}

function createPathStep(): PathStep {
    return { position: createPosition(), cycle: 0 };
}

/** OSRS: worldEntityInterpolationDurationMs=600 / clientTickDurationMs=20 = 30, + 3 = 33. */
const INTERPOLATION_DURATION_TICKS = 33;

export class WorldEntity {
    readonly worldViewId: number;
    ownerWorldViewId: number = -1;

    readonly position: Position = createPosition();
    readonly pathSteps: PathStep[];
    pendingPathStepCount: number = 0;
    interpolationInitialized: boolean = false;
    private hasInterpolated: boolean = false;

    configId: number = -1;
    actionMask: number = 31;
    /** 0=mode0 (default), 1=mode1 (overlap ghost), 2=mode2 (pre-scene) */
    drawMode: number = 0;
    /** Active sequence animation id (-1 = none, overrides config idle anim). */
    sequenceAnimationId: number = -1;
    /** Current frame within the active sequence animation. */
    sequenceFrame: number = 0;

    private readonly interpStart: Position = createPosition();
    private readonly interpTarget: Position = createPosition();
    private interpStartCycle: number = 0;
    private interpEndCycle: number = 0;

    constructor(worldViewId: number) {
        this.worldViewId = worldViewId;
        this.pathSteps = new Array(10);
        for (let i = 0; i < 10; i++) {
            this.pathSteps[i] = createPathStep();
        }
    }

    setPosition(pos: Position): void {
        this.hasInterpolated = false;
        copyPosition(pos, this.position);
        copyPosition(pos, this.pathSteps[0].position);
        this.pendingPathStepCount = 0;
        this.interpolationInitialized = false;
    }

    queuePosition(pos: Position): void {
        const tileX = (pos.x / 128) | 0;
        const tileZ = (pos.z / 128) | 0;
        if (tileX >= 0 && tileX < 104 && tileZ >= 0 && tileZ < 104) {
            this.enqueuePathStep(pos);
        } else {
            this.setPosition(pos);
        }
    }

    private enqueuePathStep(pos: Position): void {
        if (this.pendingPathStepCount < 9) {
            this.pendingPathStepCount++;
        }

        for (let i = this.pendingPathStepCount; i > 0; i--) {
            const tmp = this.pathSteps[i];
            this.pathSteps[i] = this.pathSteps[i - 1];
            this.pathSteps[i - 1] = tmp;
        }

        copyPosition(pos, this.pathSteps[0].position);
    }

    interpolatePath(cycle: number, cycleFraction: number): void {
        if (this.pendingPathStepCount === 0) {
            this.setPosition(this.pathSteps[0].position);
            return;
        }

        if (!this.interpolationInitialized) {
            if (this.hasInterpolated) {
                this.interpolateAtCycleFloat(cycle - 1);
            }
            this.beginPathStepInterpolation(cycle);
            this.interpolationInitialized = true;
        }

        if (this.interpolateAtCycleFloat(cycle + cycleFraction)) {
            this.pendingPathStepCount--;
            this.interpolationInitialized = false;
        }

        this.hasInterpolated = true;
    }

    private beginPathStepInterpolation(cycle: number): void {
        copyPosition(this.position, this.interpStart);
        copyPosition(this.pathSteps[0].position, this.interpTarget);
        this.interpStartCycle = cycle - 1;
        this.interpEndCycle = cycle + INTERPOLATION_DURATION_TICKS;
    }

    private interpolateAtCycleFloat(cycle: number): boolean {
        if (this.interpStartCycle >= this.interpEndCycle) {
            copyPosition(this.interpTarget, this.position);
            return true;
        }

        const progress = (cycle - this.interpStartCycle) / (this.interpEndCycle - this.interpStartCycle);
        interpolatePosition(this.interpStart, this.interpTarget, progress, this.position);
        return progress >= 1.0;
    }

    getFineBaseX(sizeX: number, baseXOffset: number): number {
        return sizeX * 64 + baseXOffset;
    }

    getFineBaseY(sizeY: number, baseYOffset: number): number {
        return sizeY * 64 + baseYOffset;
    }

    isActionEnabledAt(index: number): boolean {
        if (index < 0 || index > 4) return true;
        return (this.actionMask & (1 << index)) !== 0;
    }
}

function interpolatePosition(start: Position, target: Position, progress: number, out: Position): void {
    const t = Math.max(0, Math.min(1, progress));

    out.x = start.x + ((target.x - start.x) * t | 0);
    out.z = start.z + ((target.z - start.z) * t | 0);

    // Orientation wraparound: find shortest path around the 2048-unit circle
    let angleDelta = (target.orientation - start.orientation) & 2047;
    if (angleDelta > 1024) {
        angleDelta = -(2048 - angleDelta);
    }
    out.orientation = (start.orientation + (angleDelta * t | 0)) & 2047;
}
