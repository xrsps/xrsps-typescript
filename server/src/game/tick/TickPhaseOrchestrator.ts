import { performance } from "perf_hooks";

import { logger } from "../../utils/logger";
import type { ServerServices } from "../ServerServices";

import type { TickFrame } from "../../network/wsServerTypes";
export type { TickFrame };

export interface TickPhase {
    name: string;
    fn: () => void | Promise<void>;
    yieldAfter?: boolean;
}

export class TickPhaseOrchestrator {
    private profileEnabled: boolean;

    constructor(private readonly svc: ServerServices) {
        this.profileEnabled = (process.env.TICK_PROFILE ?? "") === "1";
    }

    async processTick(tick: number, time: number): Promise<void> {
        const frame = this.svc.tickFrameService.createTickFrame({ tick, time });
        this.svc.activeFrame = frame;

        const startedAt = performance.now();
        const stageTimes: Array<{ name: string; ms: number }> = [];

        const stages = this.buildPhaseList(frame);

        try {
            for (const stage of stages) {
                const stageStart = performance.now();
                if (!(await this.runTickStage(stage.name, stage.fn, frame))) {
                    return;
                }
                stageTimes.push({ name: stage.name, ms: performance.now() - stageStart });

                if (stage.yieldAfter) {
                    const yieldStart = performance.now();
                    await this.svc.tickFrameService.yieldToEventLoop(stage.name);
                    stageTimes.push({
                        name: `${stage.name}:yield`,
                        ms: performance.now() - yieldStart,
                    });
                }
            }

            const elapsedMs = performance.now() - startedAt;
            this.logTickTiming(frame.tick, elapsedMs, stageTimes);
            this.svc.tickFrameService.maybeRunAutosave(frame as any);
        } finally {
            this.svc.activeFrame = undefined;
        }
    }

    private buildPhaseList(frame: TickFrame): TickPhase[] {
        const tps = this.svc.tickPhaseService;
        return [
            {
                name: "broadcast",
                fn: () => tps.broadcastTick(frame as any),
                yieldAfter: true,
            },
            {
                name: "pre_movement",
                fn: () => tps.runPreMovementPhase(frame),
                yieldAfter: true,
            },
            { name: "movement", fn: () => tps.runMovementPhase(frame) },
            { name: "music", fn: () => tps.runMusicPhase(frame) },
            { name: "scripts", fn: () => tps.runScriptPhase(frame) },
            { name: "combat", fn: () => tps.runCombatPhase(frame) },
            { name: "death", fn: () => tps.runDeathPhase(frame) },
            { name: "post_scripts", fn: () => tps.runPostScriptPhase(frame) },
            { name: "post_effects", fn: () => tps.runPostEffectsPhase(frame) },
            {
                name: "orphaned_players",
                fn: () => tps.runOrphanedPlayersPhase(frame),
            },
            { name: "broadcast_phase", fn: () => tps.runBroadcastPhase(frame) },
        ];
    }

    private async runTickStage(
        name: string,
        fn: () => void | Promise<void>,
        frame: TickFrame,
    ): Promise<boolean> {
        try {
            await fn();
            return true;
        } catch (err) {
            this.svc.tickFrameService.restorePendingFrame(frame as any);
            logger.error(`[tick] stage ${name} failed (tick=${frame.tick})`, err);
            return false;
        }
    }

    private logTickTiming(
        tick: number,
        elapsedMs: number,
        stageTimes: Array<{ name: string; ms: number }>,
    ): void {
        const tickMs = this.svc.tickMs;

        if (elapsedMs > tickMs) {
            logger.warn(
                `[tick] tick ${tick} exceeded budget: ${elapsedMs.toFixed(1)}ms > ${tickMs}ms`,
            );
            stageTimes.sort((a, b) => b.ms - a.ms);
            const top = stageTimes.slice(0, 5);
            logger.warn(
                `[tick] breakdown tick=${tick} total=${elapsedMs.toFixed(1)}ms ` +
                    top.map((t) => `${t.name}=${t.ms.toFixed(1)}ms`).join(" "),
            );
        } else if (this.profileEnabled) {
            stageTimes.sort((a, b) => b.ms - a.ms);
            const top = stageTimes.slice(0, 5);
            logger.info(
                `[tick] breakdown tick=${tick} total=${elapsedMs.toFixed(1)}ms ` +
                    top.map((t) => `${t.name}=${t.ms.toFixed(1)}ms`).join(" "),
            );
        }
    }
}
