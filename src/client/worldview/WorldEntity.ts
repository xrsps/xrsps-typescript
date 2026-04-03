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
                this.linearInterpolate(cycle - 1);
            }
            this.interpolationInitialized = true;
        }

        const t = cycle + cycleFraction;
        if (this.linearInterpolate(t)) {
            this.pendingPathStepCount--;
            this.interpolationInitialized = false;
        }

        this.hasInterpolated = true;
    }

    private linearInterpolate(t: number): boolean {
        const target = this.pathSteps[0].position;
        const dx = target.x - this.position.x;
        const dz = target.z - this.position.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < 1) {
            copyPosition(target, this.position);
            return true;
        }

        const speed = 128;
        const step = speed * (1 / 30);
        if (step >= dist) {
            copyPosition(target, this.position);
            return true;
        }

        const ratio = step / dist;
        this.position.x += dx * ratio;
        this.position.z += dz * ratio;
        return false;
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
