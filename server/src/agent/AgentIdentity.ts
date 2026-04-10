/**
 * Identity metadata for an agent-controlled entity.
 *
 * Every {@link AgentComponent} carries one of these — it's the "who is this"
 * card that distinguishes an agent from a human-controlled player and lets
 * multiple agents coexist without conflating their state.
 */
export interface AgentIdentity {
    /**
     * Stable identifier for the agent across reconnects. Used as the primary
     * key for the memory store, journal lookups, and action telemetry.
     * Typically a UUID or slug supplied by the milady runtime on spawn.
     */
    agentId: string;

    /**
     * Human-readable label the agent uses in-game. Becomes the player's
     * account name (with normalization). If the name is already taken by a
     * human player, {@link AgentPlayerFactory} rejects the spawn.
     */
    displayName: string;

    /**
     * Who is driving this agent at any given moment.
     *
     * - `"llm"` — full autonomous control, LLM picks actions every loop tick.
     * - `"user"` — operator has taken over; the agent forwards commands from
     *   a human instead of the LLM. Useful for demos and teaching.
     * - `"hybrid"` — default for scenario C: LLM drives, operator can inject
     *   high-priority steering prompts that override the next LLM decision.
     */
    controller: "llm" | "user" | "hybrid";

    /**
     * Optional free-form persona description. Fed into the LLM prompt so the
     * agent keeps a consistent voice / playstyle across sessions.
     */
    persona?: string;

    /**
     * When the agent was first spawned in this xRSPS world. Unix millis.
     */
    createdAt: number;
}
