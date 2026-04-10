/**
 * AgentComponent — the "agent card" we hang off a {@link PlayerState} to
 * turn that entity into a first-class agent-controlled citizen of the
 * xRSPS world.
 *
 * The design follows an ECS philosophy without committing to a full ECS
 * refactor: the component is an optional field on `PlayerState`, so game
 * services that don't care about agents (99% of the existing codebase)
 * remain untouched, while the small set of agent-aware services
 * (`AgentPerceptionService`, `BotSdkActionRouter`, `BotSdkPerceptionEmitter`)
 * check for `.agent` and, if present, layer agent behavior on top.
 *
 * Human players have `player.agent === undefined`. Everything that's true
 * for a human player is also true for an agent: they tick, they move, they
 * take damage, they persist to player-state.json, they're visible to other
 * players. The agent layer only adds data; it doesn't subtract any.
 *
 * See `docs/deployment.md` (the "Agent endpoint" section) for the runtime
 * configuration knobs that enable / disable the whole thing.
 */

import type { AgentActionQueue } from "./AgentActionQueue";
import type { AgentIdentity } from "./AgentIdentity";
import type { AgentPerceptionSnapshot } from "./AgentPerception";

export interface AgentComponent {
    /** Who this agent is and how it's being driven. */
    identity: AgentIdentity;

    /**
     * Latest perception snapshot produced by {@link AgentPerceptionService}.
     * Undefined for exactly one tick after spawn, populated every subsequent
     * emit cycle. The perception emitter reads this and sends it out.
     */
    perception?: AgentPerceptionSnapshot;

    /**
     * FIFO buffer of commands the milady plugin has sent but the tick loop
     * has not yet processed. Drained during the per-player action phase.
     */
    actionQueue: AgentActionQueue;

    /**
     * True while the bot-SDK WebSocket is open. When the plugin disconnects,
     * this flips to false but the agent *stays in the world* for a grace
     * period so brief network blips don't lose game state. The orphan/reap
     * logic lives in `BotSdkServer`, not here.
     */
    connected: boolean;

    /** Unix millis of the last inbound message from the plugin. */
    lastHeardFrom: number;

    /** Unix millis of the last outbound perception snapshot to the plugin. */
    lastEmittedAt: number;
}
