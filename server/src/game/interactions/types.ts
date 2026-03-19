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
 * 3. When in reach, CombatController schedules the player's attack action
 * 4. After first hit lands, retaliationEngaged becomes true
 * 5. NpcManager owns any NPC chase/retaliation using NPC state
 * 6. Combat continues until player moves away or target dies
 */
export interface NpcCombatInteractionState {
    kind: "npcCombat";
    /** Target NPC's unique instance ID */
    npcId: number;
    modifierFlags?: number;
    /** Game tick when player can next attack (cooldown from attack speed) */
    nextAttackTick: number;
    /** Last tick when pathfinding was attempted */
    lastRouteTick: number;
    /** Player's attack speed in ticks (e.g., 4 for most melee weapons) */
    attackDelay: number;
    /** Last known NPC position for movement detection */
    lastNpcTileX: number;
    lastNpcTileY: number;
    /** Whether player should auto-attack (false when player manually moves away) */
    playerAutoAttack: boolean;
    /** Ticks remaining before NPC stops chasing if player disengages */
    aggroHoldTicks: number;
    /** NPC's attack speed in ticks (read from NPC definition) */
    npcAttackDelay: number;
    /** Game tick when NPC can next attack the player */
    npcNextAttackTick: number;
    /** Last tick when NPC pathfinding was attempted */
    lastNpcChaseTick: number;
    /**
     * True once the player has actually started an attack (swing/cast).
     * Prevents NPC retaliation/chase from starting on mere click.
     * This is OSRS parity - clicking Attack doesn't trigger NPC aggro until
     * the player actually swings.
     */
    retaliationEngaged?: boolean;
    /**
     * True once player has scheduled an attack but hit hasn't landed yet.
     * Prevents duplicate attack scheduling before first hit confirms.
     */
    attackScheduled?: boolean;
    /** Tick when attack is ready to be finalized (set when in range) */
    pendingAttackTick?: number;
    /** Tick until which player path is locked (during melee attack animation) */
    stepLockUntilTick?: number;
    /** Tick until which player is held in position after melee attack */
    holdPositionUntilTick?: number;
    /** Last calculated distance to target (for debugging) */
    lastChaseDistance?: number;
    /** First tick where neither attack-range routing nor fallback movement could proceed. */
    unreachableSinceTick?: number;
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
