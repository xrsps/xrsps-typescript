/**
 * Perception snapshot — the filtered view of the world that an agent sees.
 *
 * Built by {@link AgentPerceptionService} once per emit cycle and stored on
 * {@link AgentComponent.perception}. This is the structure the LLM will
 * eventually consume (via TOON encoding), so everything here needs to be:
 *
 * - **Small** — agents have a token budget. No giant enumerations, no blobs.
 * - **Relative** — distances and directions from the agent's position, not
 *   absolute coordinates for unrelated world chunks.
 * - **Actionable** — every field should help the LLM decide the next action.
 *
 * This deliberately mirrors the shape the milady `@elizaos/app-scape` plugin
 * expects on the wire. If you add a field here, add it in the plugin's
 * `src/sdk/types.ts` too — the TOON codec round-trips this exact shape.
 */

export interface AgentPerceptionSelf {
    /** Agent player id (matches PlayerState.id). */
    id: number;
    /** Display name as shown in-game. */
    name: string;
    /** Combat level (derived from skills). */
    combatLevel: number;
    /** Current hitpoints. */
    hp: number;
    /** Max hitpoints. */
    maxHp: number;
    /** World tile x. */
    x: number;
    /** World tile y (south→north). Named `z` to match 2004scape conventions in the LLM prompt. */
    z: number;
    /** Floor level (0 = ground, 1 = first floor, ...). */
    level: number;
    /** Run energy 0..100. */
    runEnergy: number;
    /** True when actively engaged in combat (on either side). */
    inCombat: boolean;
}

export interface AgentPerceptionInventoryItem {
    /** Slot index 0..27. */
    slot: number;
    /** Item id (OSRS cache). */
    itemId: number;
    /** Item display name (resolved server-side to save the LLM a lookup). */
    name: string;
    /** Stack count. */
    count: number;
}

export interface AgentPerceptionSkill {
    /** Skill id (0..22). */
    id: number;
    /** Short skill name ("attack", "mining"). */
    name: string;
    /** Current level (1..99, or higher with boosts). */
    level: number;
    /** Base level (un-boosted). */
    baseLevel: number;
    /** Total experience. */
    xp: number;
}

export interface AgentPerceptionNpc {
    /** NPC index (unique instance id). */
    id: number;
    /** Def id (for lookups). */
    defId: number;
    /** Display name. */
    name: string;
    /** Tile x. */
    x: number;
    /** Tile y. */
    z: number;
    /** Current hitpoints (if visible). */
    hp?: number;
    /** Combat level (if applicable). */
    combatLevel?: number;
}

export interface AgentPerceptionPlayer {
    /** Player index. */
    id: number;
    /** Display name. */
    name: string;
    /** Tile x. */
    x: number;
    /** Tile y. */
    z: number;
    /** Combat level. */
    combatLevel: number;
}

export interface AgentPerceptionGroundItem {
    /** Item id. */
    itemId: number;
    /** Item name. */
    name: string;
    /** Tile x. */
    x: number;
    /** Tile y. */
    z: number;
    /** Stack count. */
    count: number;
}

export interface AgentPerceptionObject {
    /** Loc id (scenery object). */
    locId: number;
    /** Display name. */
    name: string;
    /** Tile x. */
    x: number;
    /** Tile y. */
    z: number;
}

export interface AgentPerceptionEvent {
    /** Unix millis when the event was observed. */
    timestamp: number;
    /** Short category ("xp", "damage", "item", "chat", ...). */
    kind: string;
    /** Human-readable one-line description. */
    message: string;
}

/**
 * Aggregate snapshot stored on {@link AgentComponent.perception}.
 * Rebuilt from scratch every emit cycle — it is never mutated in place
 * after construction, so downstream consumers can hold references safely.
 */
export interface AgentPerceptionSnapshot {
    /** Monotonically increasing tick number this snapshot was captured at. */
    tick: number;
    /** Agent's own status. */
    self: AgentPerceptionSelf;
    /** 23 skill entries (Attack through Hunter). */
    skills: AgentPerceptionSkill[];
    /** Inventory (up to 28 items). */
    inventory: AgentPerceptionInventoryItem[];
    /** Equipment by slot (sparse; only worn slots). */
    equipment: AgentPerceptionInventoryItem[];
    /** Nearby NPCs within perception radius. */
    nearbyNpcs: AgentPerceptionNpc[];
    /** Nearby players within perception radius. */
    nearbyPlayers: AgentPerceptionPlayer[];
    /** Ground items within perception radius. */
    nearbyGroundItems: AgentPerceptionGroundItem[];
    /** Notable scenery objects within perception radius. */
    nearbyObjects: AgentPerceptionObject[];
    /** Bounded FIFO of recent events (new entries pushed, old ones dropped). */
    recentEvents: AgentPerceptionEvent[];
}
