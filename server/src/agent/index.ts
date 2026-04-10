/**
 * Agent component layer — public exports for the server's agent machinery.
 *
 * Import from `../agent` rather than individual files to keep the rest of
 * the codebase decoupled from the internal file layout.
 */

export type { AgentIdentity } from "./AgentIdentity";
export type { AgentComponent } from "./AgentComponent";
export {
    AgentActionQueue,
    type AgentActionCommand,
} from "./AgentActionQueue";
export type {
    AgentPerceptionSnapshot,
    AgentPerceptionSelf,
    AgentPerceptionInventoryItem,
    AgentPerceptionSkill,
    AgentPerceptionNpc,
    AgentPerceptionPlayer,
    AgentPerceptionGroundItem,
    AgentPerceptionObject,
    AgentPerceptionEvent,
} from "./AgentPerception";
