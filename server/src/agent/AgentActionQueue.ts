/**
 * Pending-action queue for agent-controlled entities.
 *
 * The bot-SDK receives action commands from the milady plugin over the
 * wire, decodes them from TOON, and pushes each one onto the agent's
 * {@link AgentActionQueue}. On the next tick, the server drains the queue
 * and dispatches each command into the normal service layer (MovementService,
 * InventoryService, etc.), exactly the same code path a human client would
 * trigger — the agent is a first-class player.
 *
 * Keeping the queue on the {@link AgentComponent} instead of inside the
 * BotSdkServer means:
 *
 * 1. Tick-phase code can drain actions during the per-player phase without
 *    having to reach back into networking state.
 * 2. Multiple agents don't contend on a shared queue.
 * 3. If we later want to persist pending actions across a restart, we can
 *    serialize the component cleanly.
 *
 * The queue is intentionally small. The LLM emits at most one or two actions
 * per loop cycle, and pending-action backpressure is a symptom of a bug
 * (the agent is trying to act faster than the game can process), not a
 * feature we should quietly tolerate.
 */

export interface AgentActionCommand {
    /** Short action identifier ("walkTo", "chat", "attackNpc", ...). */
    kind: string;
    /**
     * Opaque parameter bag. Each action handler knows its own schema;
     * {@link AgentActionQueue} does not validate. Keeping this as a generic
     * record means new actions can be added without changing this file.
     */
    params: Record<string, unknown>;
    /**
     * Correlation id supplied by the client so acks/events can be matched
     * back to the originating command. Optional — if unset, no ack is sent.
     */
    correlationId?: string;
    /** When the command arrived on the server. */
    enqueuedAt: number;
}

/**
 * Small FIFO with a hard capacity. Overflow drops the oldest command,
 * not the newest — the intuition is that the latest LLM decision is
 * (usually) more informed than an older one that got queued up.
 */
export class AgentActionQueue {
    private readonly items: AgentActionCommand[] = [];

    constructor(private readonly capacity: number = 16) {}

    size(): number {
        return this.items.length;
    }

    push(command: AgentActionCommand): void {
        if (this.items.length >= this.capacity) {
            this.items.shift();
        }
        this.items.push(command);
    }

    /** Remove and return the next command, or undefined if empty. */
    shift(): AgentActionCommand | undefined {
        return this.items.shift();
    }

    /** Drain up to `max` commands in insertion order. */
    drain(max: number = Number.POSITIVE_INFINITY): AgentActionCommand[] {
        const n = Math.min(max, this.items.length);
        return this.items.splice(0, n);
    }

    clear(): void {
        this.items.length = 0;
    }
}
