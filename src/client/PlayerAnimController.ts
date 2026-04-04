import type { SeqType } from "../rs/config/seqtype/SeqType";
import type { SeqTypeLoader } from "../rs/config/seqtype/SeqTypeLoader";
import type { SeqFrameLoader } from "../rs/model/seq/SeqFrameLoader";
import { PlayerEcs } from "./ecs/PlayerEcs";

type PlayerSeqState = {
    seqId: number; // Actor.sequence
    frame: number; // Actor.sequenceFrame
    frameCycle: number; // Actor.sequenceFrameCycle
    delay: number; // Actor.sequenceDelay
    loopCounter: number; // Actor.field1220
};

export type SequenceStateView = Readonly<PlayerSeqState>;

type PlayerMovementSeqState = {
    seqId: number; // Actor.movementSequence
    frame: number; // Actor.movementFrame
    frameCycle: number; // Actor.movementFrameCycle
    loopCounter: number; // Actor.field1196
};

export type MovementSequenceStateView = Readonly<PlayerMovementSeqState>;

export type ServerSequenceOptions = {
    /** OSRS: sequenceDelay - ticks before animation starts (default 0). */
    delay?: number;
};

export class PlayerAnimController {
    private readonly states = new Map<number, PlayerSeqState>();
    private readonly movementStates = new Map<number, PlayerMovementSeqState>();

    constructor(
        private readonly playerEcs: PlayerEcs,
        private readonly seqTypeLoader: SeqTypeLoader,
        private readonly seqFrameLoader: SeqFrameLoader,
    ) {}

    /**
     * Apply an action sequence update from the server.
     * Mirrors OSRS `class358.performPlayerAnimation`.
     */
    handleServerSequence(
        serverId: number,
        seqId: number,
        options: ServerSequenceOptions = {},
    ): void {
        if (!(serverId >= 0) || !(typeof seqId === "number")) return;

        const delay = Math.max(0, typeof options.delay === "number" ? options.delay : 0) | 0;
        const nextSeq = seqId | 0;

        const state = this.stateFor(serverId);
        const currentSeq = state.seqId | 0;

        if (currentSeq === nextSeq && nextSeq !== -1) {
            const restartMode = this.getRestartMode(nextSeq);
            if (restartMode === 1) {
                // Full restart (sequenceFrame=0, sequenceFrameCycle=0, sequenceDelay=delay, field1220=0)
                state.frame = 0;
                state.frameCycle = 0;
                state.delay = delay;
                state.loopCounter = 0;
                this.writeEcsDelayAndLoop(serverId, state);
            } else if (restartMode === 2) {
                // Reset loop counter only (field1220=0), keep frame/cycle/delay
                state.loopCounter = 0;
                this.writeEcsLoop(serverId, state);
            }
            // restartMode === 0: do nothing
            return;
        }

        // Sequence clear always applies
        if (nextSeq === -1) {
            this.clearSequence(serverId, state);
            return;
        }

        // Different sequence: replace only if forcedPriority >= current forcedPriority.
        if (
            currentSeq === -1 ||
            this.getForcedPriority(nextSeq) >= this.getForcedPriority(currentSeq)
        ) {
            state.seqId = nextSeq;
            state.frame = 0;
            state.frameCycle = 0;
            state.delay = delay;
            state.loopCounter = 0;
            this.writeEcsFull(serverId, state, { seqChanged: true });
        }
    }

    /**
     * OSRS movement cancel: when a new step is queued, cancel the current action sequence
     * iff `SequenceDefinition.field2226 == 1` (ours: `SeqType.priority == 1`).
     * Reference: `Player.method2429`.
     */
    cancelSequenceOnMove(serverId: number): void {
        if (!(serverId >= 0)) return;
        const state = this.states.get(serverId);
        if (!state || (state.seqId | 0) < 0) return;
        const seqType = this.safeLoadSeqType(state.seqId | 0);
        if (!seqType) return;
        const priority = typeof seqType.priority === "number" ? seqType.priority : -1;
        if ((priority | 0) === 1) {
            this.clearSequence(serverId, state);
        }
    }

    /**
     * Advance sequences by the given number of client ticks (20ms each).
     * Mirrors OSRS `ParamComposition.method3891` action-sequence stepping.
     */
    tick(clientTicks: number): void {
        const total = Math.max(0, clientTicks | 0);
        if (total === 0) return;

        for (let t = 0; t < total; t++) {
            for (const serverId of this.playerEcs.getAllServerIds()) {
                const idx = this.playerEcs.getIndexForServerId(serverId);
                if (idx === undefined) continue;

                // === Action sequence (Actor.sequence) ===
                const state = this.stateFor(serverId);
                const seqId = state.seqId | 0;
                if (seqId >= 0) {
                    let pauseAtDelayOne = false;
                    // OSRS parity: when moving at the moment an animation starts (field1215 > 0) and
                    // the sequence allows movement (`field2244 == 1`), the client holds sequenceDelay
                    // at 1 until those pending steps are consumed.
                    // Reference: ParamComposition.updateActorSequence (lines ~313-319 in r215 deob).
                    if ((state.delay | 0) <= 1) {
                        const seqType = this.safeLoadSeqType(seqId);
                        const precedenceAnimating =
                            typeof seqType?.precedenceAnimating === "number"
                                ? seqType.precedenceAnimating
                                : -1;
                        if ((precedenceAnimating | 0) === 1) {
                            const movingSnapshot = this.playerEcs.getForcedMovementSteps(idx) | 0;
                            if (movingSnapshot > 0) {
                                const cycle = this.playerEcs.getClientCycle() >>> 0;
                                const forcedStart =
                                    this.playerEcs.getForcedMoveStartCycle(idx) >>> 0;
                                const forcedEnd = this.playerEcs.getForcedMoveEndCycle(idx) >>> 0;
                                if (forcedStart <= cycle && forcedEnd < cycle) {
                                    pauseAtDelayOne = true;
                                    if ((state.delay | 0) !== 1) {
                                        state.delay = 1;
                                        this.writeEcsDelay(serverId, state);
                                    }
                                }
                            }
                        }
                    }

                    if (!pauseAtDelayOne && (state.delay | 0) === 0) {
                        this.stepActiveSequence(serverId, state);
                    }

                    // OSRS: sequenceDelay decrements after stepping.
                    if (!pauseAtDelayOne && (state.delay | 0) > 0) {
                        state.delay = ((state.delay | 0) - 1) | 0;
                        this.writeEcsDelay(serverId, state);
                    }
                } else {
                    // Keep delay coherent for cleared states.
                    if ((state.delay | 0) !== 0) {
                        state.delay = 0;
                        this.writeEcsDelay(serverId, state);
                    }
                }

                // Mirror the action frame state into ECS so movement/forced-movement logic can consult it.
                // This is read on the next client tick (before we step again), matching the reference
                // checks that use `sequenceFrameCycle + 1 > frameLengths[sequenceFrame]`.
                const liveSeqId = state.seqId | 0;
                if (liveSeqId >= 0) {
                    this.playerEcs.setAnimSeqFrame(idx, state.frame | 0);
                    this.playerEcs.setAnimSeqFrameCycle(idx, state.frameCycle | 0);
                } else {
                    this.playerEcs.setAnimSeqFrame(idx, 0);
                    this.playerEcs.setAnimSeqFrameCycle(idx, 0);
                }

                // === Movement sequence (Actor.movementSequence) ===
                this.stepMovementSequence(serverId, idx);
            }
        }
    }

    getSequenceState(serverId: number): SequenceStateView | undefined {
        if (!(serverId >= 0)) return undefined;
        const s = this.states.get(serverId);
        if (!s || (s.seqId | 0) < 0) return undefined;
        return s;
    }

    getMovementSequenceState(serverId: number): MovementSequenceStateView | undefined {
        if (!(serverId >= 0)) return undefined;
        const s = this.movementStates.get(serverId);
        if (!s || (s.seqId | 0) < 0) return undefined;
        return s;
    }

    release(serverId: number): void {
        if (!(serverId >= 0)) return;
        const state = this.states.get(serverId);
        if (state) {
            this.clearSequence(serverId, state);
        }
        this.states.delete(serverId);
        this.movementStates.delete(serverId);
    }

    reset(): void {
        for (const [serverId, state] of this.states) {
            this.clearSequence(serverId, state);
        }
        this.states.clear();
        this.movementStates.clear();
    }

    private stateFor(serverId: number): PlayerSeqState {
        let state = this.states.get(serverId);
        if (!state) {
            state = { seqId: -1, frame: 0, frameCycle: 0, delay: 0, loopCounter: 0 };
            this.states.set(serverId, state);
        }
        return state;
    }

    private movementStateFor(serverId: number): PlayerMovementSeqState {
        let state = this.movementStates.get(serverId);
        if (!state) {
            state = { seqId: -1, frame: 0, frameCycle: 0, loopCounter: 0 };
            this.movementStates.set(serverId, state);
        }
        return state;
    }

    private safeLoadSeqType(seqId: number): SeqType | undefined {
        try {
            return this.seqTypeLoader.load(seqId | 0);
        } catch {
            return undefined;
        }
    }

    private getRestartMode(seqId: number): number {
        const seqType = this.safeLoadSeqType(seqId);
        // OSRS: SequenceDefinition.restartMode (opcode 11). Our loader surfaces it as `replyMode`.
        const replyMode = typeof seqType?.replyMode === "number" ? seqType.replyMode : 2;
        return replyMode | 0;
    }

    private getForcedPriority(seqId: number): number {
        const seqType = this.safeLoadSeqType(seqId);
        // OSRS: SequenceDefinition.field2220 (opcode 5). Default 5.
        const forcedPriority =
            typeof seqType?.forcedPriority === "number" ? seqType.forcedPriority : 5;
        return Math.max(0, forcedPriority | 0);
    }

    private stepActiveSequence(serverId: number, state: PlayerSeqState): void {
        const seqId = state.seqId | 0;
        const seqType = this.safeLoadSeqType(seqId);
        if (!seqType) {
            this.clearSequence(serverId, state);
            return;
        }

        if (seqType.isSkeletalSeq?.()) {
            this.stepCachedSequence(serverId, state, seqType);
        } else if (Array.isArray(seqType.frameIds) && seqType.frameIds.length > 0) {
            this.stepFrameSequence(serverId, state, seqType);
        } else {
            this.clearSequence(serverId, state);
        }
    }

    private stepFrameSequence(serverId: number, state: PlayerSeqState, seqType: SeqType): void {
        const frameIds = seqType.frameIds;
        const frameCount = frameIds.length | 0;
        if (frameCount <= 0) {
            this.clearSequence(serverId, state);
            return;
        }

        let frame = state.frame | 0;
        let cycle = (state.frameCycle | 0) + 1;
        let loopCounter = state.loopCounter | 0;

        if (frame < frameCount) {
            const len = seqType.getFrameLength(this.seqFrameLoader, frame) | 0;
            if (cycle > len) {
                cycle = 1;
                frame++;
            }
        }

        if (frame >= frameCount) {
            frame -= seqType.frameStep | 0;
            loopCounter = (loopCounter + 1) | 0;
            const maxLoops = Math.max(0, seqType.maxLoops | 0);
            if (loopCounter >= maxLoops) {
                this.clearSequence(serverId, state);
                return;
            }
            if (frame < 0 || frame >= frameCount) {
                this.clearSequence(serverId, state);
                return;
            }
        }

        state.frame = frame | 0;
        state.frameCycle = cycle | 0;
        if ((state.loopCounter | 0) !== (loopCounter | 0)) {
            state.loopCounter = loopCounter | 0;
            this.writeEcsLoop(serverId, state);
        }
    }

    private stepCachedSequence(serverId: number, state: PlayerSeqState, seqType: SeqType): void {
        const duration = Math.max(0, seqType.getSkeletalDuration?.() | 0);
        if (!(duration > 0)) {
            this.clearSequence(serverId, state);
            return;
        }

        let frame = (state.frame | 0) + 1;
        let loopCounter = state.loopCounter | 0;

        if (frame >= duration) {
            frame -= seqType.frameStep | 0;
            loopCounter = (loopCounter + 1) | 0;
            const maxLoops = Math.max(0, seqType.maxLoops | 0);
            if (loopCounter >= maxLoops) {
                this.clearSequence(serverId, state);
                return;
            }
            if (frame < 0 || frame >= duration) {
                this.clearSequence(serverId, state);
                return;
            }
        }

        state.frame = frame | 0;
        state.frameCycle = 0;
        if ((state.loopCounter | 0) !== (loopCounter | 0)) {
            state.loopCounter = loopCounter | 0;
            this.writeEcsLoop(serverId, state);
        }
    }

    private clearSequence(serverId: number, state: PlayerSeqState): void {
        state.seqId = -1;
        state.frame = 0;
        state.frameCycle = 0;
        state.delay = 0;
        state.loopCounter = 0;
        this.writeEcsFull(serverId, state, { seqChanged: true });
    }

    private stepMovementSequence(serverId: number, ecsIndex: number): void {
        const nextSeqId = this.playerEcs.getAnimMovementSeqId(ecsIndex) | 0;
        const state = this.movementStateFor(serverId);
        if ((state.seqId | 0) !== (nextSeqId | 0)) {
            // OSRS: movement frames are NOT reset on seq change; bounds checks in stepping reset if needed.
            state.seqId = nextSeqId | 0;
        }

        const seqId = state.seqId | 0;
        if (seqId < 0) {
            // Keep state coherent for cleared sequences.
            if (
                (state.frame | 0) !== 0 ||
                (state.frameCycle | 0) !== 0 ||
                (state.loopCounter | 0) !== 0
            ) {
                state.frame = 0;
                state.frameCycle = 0;
                state.loopCounter = 0;
            }
            return;
        }

        const seqType = this.safeLoadSeqType(seqId);
        if (!seqType) {
            state.seqId = -1;
            state.frame = 0;
            state.frameCycle = 0;
            state.loopCounter = 0;
            return;
        }

        if (seqType.isSkeletalSeq?.()) {
            this.stepMovementCachedSequence(state, seqType);
        } else if (Array.isArray(seqType.frameIds) && seqType.frameIds.length > 0) {
            this.stepMovementFrameSequence(state, seqType);
        } else {
            state.seqId = -1;
            state.frame = 0;
            state.frameCycle = 0;
            state.loopCounter = 0;
        }
    }

    private stepMovementFrameSequence(state: PlayerMovementSeqState, seqType: SeqType): void {
        const frameIds = seqType.frameIds;
        const frameCount = frameIds.length | 0;
        if (frameCount <= 0) {
            state.seqId = -1;
            state.frame = 0;
            state.frameCycle = 0;
            state.loopCounter = 0;
            return;
        }

        let frame = state.frame | 0;
        let cycle = (state.frameCycle | 0) + 1;
        let loopCounter = state.loopCounter | 0;

        if (frame < frameCount) {
            const len = seqType.getFrameLength(this.seqFrameLoader, frame) | 0;
            if (cycle > len) {
                cycle = 1;
                frame++;
            }
        }

        if (frame >= frameCount) {
            if ((seqType.frameStep | 0) > 0) {
                frame -= seqType.frameStep | 0;
                if (seqType.looping) {
                    loopCounter = (loopCounter + 1) | 0;
                }
                const maxLoops = Math.max(0, seqType.maxLoops | 0);
                const shouldReset =
                    frame < 0 ||
                    frame >= frameCount ||
                    (seqType.looping && loopCounter >= maxLoops);
                if (shouldReset) {
                    frame = 0;
                    cycle = 0;
                    loopCounter = 0;
                }
            } else {
                frame = 0;
                cycle = 0;
                loopCounter = 0;
            }
        }

        state.frame = frame | 0;
        state.frameCycle = cycle | 0;
        state.loopCounter = loopCounter | 0;
    }

    private stepMovementCachedSequence(state: PlayerMovementSeqState, seqType: SeqType): void {
        const duration = Math.max(0, seqType.getSkeletalDuration?.() | 0);
        if (!(duration > 0)) {
            state.seqId = -1;
            state.frame = 0;
            state.frameCycle = 0;
            state.loopCounter = 0;
            return;
        }

        let frame = (state.frame | 0) + 1;
        let loopCounter = state.loopCounter | 0;

        if (frame >= duration) {
            if ((seqType.frameStep | 0) > 0) {
                frame -= seqType.frameStep | 0;
                if (seqType.looping) {
                    loopCounter = (loopCounter + 1) | 0;
                }
                const maxLoops = Math.max(0, seqType.maxLoops | 0);
                const shouldReset =
                    frame < 0 || frame >= duration || (seqType.looping && loopCounter >= maxLoops);
                if (shouldReset) {
                    frame = 0;
                    loopCounter = 0;
                }
            } else {
                frame = 0;
                loopCounter = 0;
            }
        }

        state.frame = frame | 0;
        state.frameCycle = 0;
        state.loopCounter = loopCounter | 0;
    }

    private writeEcsFull(serverId: number, state: PlayerSeqState, opts: { seqChanged: boolean }) {
        const idx = this.playerEcs.getIndexForServerId(serverId);
        if (idx === undefined) return;
        if (opts.seqChanged) {
            this.playerEcs.setAnimSeqId(idx, state.seqId | 0);
        }
        this.playerEcs.setAnimSeqDelay?.(idx, state.delay | 0);
        this.playerEcs.setAnimLoopCounter?.(idx, state.loopCounter | 0);
        this.playerEcs.setAnimSeqFrame(idx, state.frame | 0);
        this.playerEcs.setAnimSeqFrameCycle(idx, state.frameCycle | 0);
    }

    private writeEcsDelay(serverId: number, state: PlayerSeqState): void {
        const idx = this.playerEcs.getIndexForServerId(serverId);
        if (idx === undefined) return;
        this.playerEcs.setAnimSeqDelay?.(idx, state.delay | 0);
    }

    private writeEcsLoop(serverId: number, state: PlayerSeqState): void {
        const idx = this.playerEcs.getIndexForServerId(serverId);
        if (idx === undefined) return;
        this.playerEcs.setAnimLoopCounter?.(idx, state.loopCounter | 0);
    }

    private writeEcsDelayAndLoop(serverId: number, state: PlayerSeqState): void {
        const idx = this.playerEcs.getIndexForServerId(serverId);
        if (idx === undefined) return;
        this.playerEcs.setAnimSeqDelay?.(idx, state.delay | 0);
        this.playerEcs.setAnimLoopCounter?.(idx, state.loopCounter | 0);
        this.playerEcs.setAnimSeqFrame(idx, state.frame | 0);
        this.playerEcs.setAnimSeqFrameCycle(idx, state.frameCycle | 0);
    }
}
