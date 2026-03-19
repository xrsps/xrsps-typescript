import { NpcState } from "../npc";
import { PlayerState } from "../player";

export type FollowInteractionKind = "follow" | "trade";

export interface FollowInteractionState {
    kind: FollowInteractionKind;
    targetId: number;
    modifierFlags?: number;
    swirlDir: 1 | -1;
    swirlIndex: number;
    lastTx?: number;
    lastTy?: number;
    lastRot?: number;
    lastSector?: number;
    slotX?: number;
    slotY?: number;
}

/**
 * State for player-vs-NPC combat interactions.
 *
 * OSRS Combat Flow:
 * 1. Player clicks Attack -> startNpcAttack() creates this state
 * 2. Player routes toward NPC until within attack reach
 * 3. When in reach, PlayerCombatManager schedules the player's attack action
 * 4. NpcManager owns NPC chase/retaliation using NPC state
 * 5. Combat continues until player moves away or target dies
 */
export interface NpcCombatInteractionState {
    kind: "npcCombat";
    /** Target NPC's unique instance ID */
    npcId: number;
    modifierFlags?: number;
}

export interface NpcInteractPassiveState {
    kind: "npcInteract";
    npcId: number;
    option?: string;
    modifierFlags?: number;
    lastRouteTick: number;
    lastNpcTileX: number;
    lastNpcTileY: number;
    completedAt?: number;
}

export interface GroundItemInteractionState {
    kind: "groundItem";
    itemId: number;
    stackId: number;
    modifierFlags?: number;
    tileX: number;
    tileY: number;
    tileLevel: number;
    option: string;
    lastRouteTick: number;
}

export interface PlayerCombatInteractionState {
    kind: "playerCombat";
    playerId: number;
    /** Optional expiry tick for this facing/interaction */
    untilTick?: number;
}

export type PlayerInteractionState =
    | FollowInteractionState
    | NpcCombatInteractionState
    | NpcInteractPassiveState
    | PlayerCombatInteractionState
    | GroundItemInteractionState;

export interface PendingLocInteraction {
    id: number;
    tile: { x: number; y: number };
    level?: number;
    action?: string;
    modifierFlags?: number;
}

export interface InteractionTickNpcLookup {
    (npcId: number): NpcState | undefined;
}
