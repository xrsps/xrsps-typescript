import { mat4 } from "gl-matrix";

import type { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import type { WorldEntityTypeLoader } from "../../rs/config/worldentitytype/WorldEntityTypeLoader";
import type { SkeletalSeqLoader } from "../../rs/model/skeletal/SkeletalSeqLoader";
import type { SkeletalSeq } from "../../rs/model/skeletal/SkeletalSeq";
import type { SkeletalBase } from "../../rs/model/skeletal/SkeletalBase";

interface WorldEntityAnimState {
    skeletalSeq: SkeletalSeq;
    skeletalBase: SkeletalBase;
    skeletalStart: number;
    duration: number;
    startCycle: number;
    rootTransform: Float32Array;
}

export class WorldEntityAnimator {
    private entities: Map<number, WorldEntityAnimState> = new Map();

    constructor(
        private worldEntityTypeLoader: WorldEntityTypeLoader | undefined,
        private seqTypeLoader: SeqTypeLoader | undefined,
        private skeletalSeqLoader: SkeletalSeqLoader | undefined,
    ) {}

    addEntity(entityIndex: number, configId: number, clientCycle: number): void {
        if (!this.worldEntityTypeLoader || !this.seqTypeLoader || !this.skeletalSeqLoader) {
            return;
        }

        try {
            const weType = this.worldEntityTypeLoader.load(configId);
            if (!weType || weType.idleAnimationId < 0) {
                return;
            }

            const seqType = this.seqTypeLoader.load(weType.idleAnimationId);
            if (!seqType || !seqType.isSkeletalSeq()) {
                return;
            }

            const skeletalSeq = this.skeletalSeqLoader.load(seqType.skeletalId);
            if (!skeletalSeq) {
                return;
            }

            const skeletalBase = skeletalSeq.skeletalBase;
            const duration = seqType.getSkeletalDuration();
            if (duration <= 0) {
                return;
            }

            this.entities.set(entityIndex, {
                skeletalSeq,
                skeletalBase,
                skeletalStart: seqType.skeletalStart,
                duration,
                startCycle: clientCycle,
                rootTransform: mat4.create() as Float32Array,
            });
        } catch (e) {
            console.log(`[WorldEntityAnimator] Failed to load animation for config ${configId}:`, e);
        }
    }

    /**
     * Override the active animation for a world entity (sequence animation from mask update).
     * Pass animId = -1 to revert to the config idle animation.
     */
    setSequenceAnimation(entityIndex: number, animId: number, configId: number, clientCycle: number): void {
        if (animId < 0) {
            // Revert to idle: re-add with config idle animation
            this.entities.delete(entityIndex);
            this.addEntity(entityIndex, configId, clientCycle);
            return;
        }
        if (!this.seqTypeLoader || !this.skeletalSeqLoader) return;
        try {
            const seqType = this.seqTypeLoader.load(animId);
            if (!seqType || !seqType.isSkeletalSeq()) return;
            const skeletalSeq = this.skeletalSeqLoader.load(seqType.skeletalId);
            if (!skeletalSeq) return;
            const duration = seqType.getSkeletalDuration();
            if (duration <= 0) return;

            this.entities.set(entityIndex, {
                skeletalSeq,
                skeletalBase: skeletalSeq.skeletalBase,
                skeletalStart: seqType.skeletalStart,
                duration,
                startCycle: clientCycle,
                rootTransform: this.entities.get(entityIndex)?.rootTransform ?? (mat4.create() as Float32Array),
            });
        } catch (e) {
            console.log(`[WorldEntityAnimator] Failed to set sequence animation ${animId}:`, e);
        }
    }

    removeEntity(entityIndex: number): void {
        this.entities.delete(entityIndex);
    }

    clear(): void {
        this.entities.clear();
    }

    tick(clientCycle: number): void {
        for (const [_, state] of this.entities) {
            const elapsed = clientCycle - state.startCycle;
            const frame = state.skeletalStart + (((elapsed % state.duration) + state.duration) % state.duration);

            state.skeletalBase.updateAnimMatrices(state.skeletalSeq, frame);

            const rootBone = state.skeletalBase.getBone(0);
            if (rootBone) {
                const src = rootBone.getAnimModelMatrix();

                // The shader applies this in view/camera space (after viewMatrix),
                // matching OSRS where Scene_cameraPitchSine is applied after the
                // camera transform in Scene.drawInternal().
                // Rotation (upper 3x3) is dimensionless — copy as-is.
                // Translation must be scaled from fine units to tile units
                // (view space uses tile units after the /= 128 vertex scaling).
                // Negate Y translation per OSRS (m13 = -m13).
                const dst = state.rootTransform;
                dst[0] = src[0]; dst[1] = src[1]; dst[2] = src[2]; dst[3] = 0;
                dst[4] = src[4]; dst[5] = src[5]; dst[6] = src[6]; dst[7] = 0;
                dst[8] = src[8]; dst[9] = src[9]; dst[10] = src[10]; dst[11] = 0;
                dst[12] = src[12] / 128.0;
                dst[13] = -src[13] / 128.0;
                dst[14] = src[14] / 128.0;
                dst[15] = 1;
            }
        }
    }

    getTransform(entityIndex: number): Float32Array | undefined {
        return this.entities.get(entityIndex)?.rootTransform;
    }
}
