/**
 * Emits perception snapshots over live bot-SDK WebSocket connections.
 *
 * The emitter is driven by the main game ticker — on every tick it checks
 * whether enough ticks have elapsed since the last emission, and if so,
 * builds a fresh snapshot for each connected agent and ships it as a TOON
 * {@link PerceptionFrame}.
 *
 * **Tick budget**: with the default cadence (every 3 ticks) and one agent,
 * this runs ~5× / second and touches a handful of player fields. For many
 * agents (not in PR 1 scope), the builder's cost scales linearly; we'll
 * revisit if/when that matters.
 *
 * The emitter does NOT know about sockets — it's given a callback by the
 * owning {@link BotSdkServer} that knows how to send a frame to a specific
 * agent. This keeps the tick-phase wiring independent of WebSocket lifecycle
 * bugs.
 */

import type { AgentPerceptionSnapshot } from "../../agent";
import type { PlayerState } from "../../game/player";
import { logger } from "../../utils/logger";

import { BotSdkPerceptionBuilder } from "./BotSdkPerceptionBuilder";

export interface PerceptionEmitterOptions {
    /** Emit every N game ticks. Default 3 (~1.8 s at 600ms tick). */
    everyNTicks?: number;
}

export type PerceptionSinkFn = (
    player: PlayerState,
    snapshot: AgentPerceptionSnapshot,
) => void;

export class BotSdkPerceptionEmitter {
    private readonly builder = new BotSdkPerceptionBuilder();
    private readonly everyNTicks: number;

    constructor(
        private readonly agents: () => Iterable<PlayerState>,
        private readonly sink: PerceptionSinkFn,
        options: PerceptionEmitterOptions = {},
    ) {
        this.everyNTicks = Math.max(1, options.everyNTicks ?? 3);
    }

    /**
     * Called by the main tick loop. Builds a snapshot per connected agent
     * if the emission interval has elapsed.
     */
    onTick(currentTick: number): void {
        if (currentTick % this.everyNTicks !== 0) return;
        for (const player of this.agents()) {
            if (!player.agent || !player.agent.connected) continue;
            try {
                const snapshot = this.builder.build(player, currentTick);
                player.agent.perception = snapshot;
                player.agent.lastEmittedAt = Date.now();
                this.sink(player, snapshot);
            } catch (err) {
                logger.warn(
                    `[botsdk] perception build failed for player ${player.id}:`,
                    err,
                );
            }
        }
    }
}
