import { SeqType } from "../../../rs/config/seqtype/SeqType";
import { SeqFrameLoader } from "../../../rs/model/seq/SeqFrameLoader";
import { AnimationFrames } from "../AnimationFrames";

export class LocAnimated {
    seqType?: SeqType;

    frame = 0;
    cycleStart: number;
    private lastSoundFrame: number = -1;
    // Reusable context object for onFrameSound callback to avoid allocation
    private readonly soundContext: { x: number; y: number; level: number };

    constructor(
        readonly drawRangeIndex: number,
        readonly drawRangeAlphaIndex: number,

        readonly drawRangeLodIndex: number,
        readonly drawRangeLodAlphaIndex: number,

        readonly drawRangeInteractIndex: number,
        readonly drawRangeInteractAlphaIndex: number,

        readonly drawRangeInteractLodIndex: number,
        readonly drawRangeInteractLodAlphaIndex: number,

        readonly anim: AnimationFrames,
        seqType: SeqType,
        cycle: number,
        randomStart: boolean,

        // Position and ID for ambient sounds
        readonly id: number,
        readonly x: number,
        readonly y: number,
        readonly level: number,
        readonly rotation: number,
    ) {
        this.seqType = seqType;
        this.cycleStart = cycle - 1;
        // Initialize sound context once with position data
        this.soundContext = { x, y, level };

        if (randomStart && seqType.frameStep !== -1) {
            if (seqType.isSkeletalSeq()) {
                this.frame = Math.floor(Math.random() * seqType.getSkeletalDuration());
            } else {
                this.frame = Math.floor(Math.random() * seqType.frameIds.length);
                this.cycleStart -= Math.floor(Math.random() * seqType.frameLengths[this.frame]);
            }
        }
    }

    getDrawRangeIndex(isAlpha: boolean, isInteract: boolean, isLod: boolean) {
        if (isInteract) {
            if (isLod) {
                return isAlpha
                    ? this.drawRangeInteractLodAlphaIndex
                    : this.drawRangeInteractLodIndex;
            } else {
                return isAlpha ? this.drawRangeInteractAlphaIndex : this.drawRangeInteractIndex;
            }
        } else {
            if (isLod) {
                return isAlpha ? this.drawRangeLodAlphaIndex : this.drawRangeLodIndex;
            } else {
                return isAlpha ? this.drawRangeAlphaIndex : this.drawRangeIndex;
            }
        }
    }

    update(
        seqFrameLoader: SeqFrameLoader,
        cycle: number,
        onFrameSound?: (
            seqType: SeqType,
            frame: number,
            context: { x: number; y: number; level: number },
        ) => void,
    ): number {
        if (!this.seqType) {
            this.lastSoundFrame = -1;
            return 0;
        }

        const seqType = this.seqType;
        const previousFrame = this.frame;
        let elapsed = cycle - this.cycleStart;
        if (elapsed > 100 && this.seqType.frameStep > 0) {
            elapsed = 100;
        }

        if (this.seqType.isSkeletalSeq()) {
            const duration = this.seqType.getSkeletalDuration();
            this.frame += elapsed;
            elapsed = 0;
            if (this.frame >= duration) {
                this.frame = duration - this.seqType.frameStep;
                if (this.frame < 0 || this.frame > duration) {
                    this.frame = 0;
                    this.seqType = undefined;
                    return 0;
                }
            }
        } else {
            while (elapsed > this.seqType.getFrameLength(seqFrameLoader, this.frame)) {
                elapsed -= this.seqType.getFrameLength(seqFrameLoader, this.frame);
                this.frame++;
                if (this.frame >= this.seqType.frameLengths.length) {
                    this.frame -= this.seqType.frameStep;
                    if (this.frame < 0 || this.frame >= this.seqType.frameLengths.length) {
                        this.frame = 0;
                        this.cycleStart = cycle - 1;
                        this.seqType = undefined;
                        return 0;
                    }
                    continue;
                }
            }
        }

        this.cycleStart = cycle - elapsed;

        if (this.seqType && this.frame < previousFrame) {
            this.lastSoundFrame = -1;
        }

        if (this.seqType && onFrameSound && this.seqType.frameSounds?.size) {
            const currentFrame = this.frame;
            if (currentFrame !== this.lastSoundFrame) {
                const effects = this.seqType.frameSounds.get(currentFrame);
                if (effects && effects.length) {
                    // Use reusable context object to avoid allocation per call
                    onFrameSound(this.seqType, currentFrame, this.soundContext);
                }
                this.lastSoundFrame = currentFrame;
            }
        }

        return this.frame;
    }
}
