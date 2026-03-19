/**
 * Combat State Types
 *
 * Unified type definitions for combat state management.
 * Replaces fragmented state across PlayerState, NpcState, NpcCombatInteractionState,
 * and dynamic (player as any) properties.
 *
 * OSRS Combat Model:
 * - Tick-based (600ms per tick)
 * - State machine: idle -> approaching -> attacking -> cooldown -> ...
 * - Attack speed determines ticks between attacks (4 ticks = 2.4s for most melee)
 * - Hit delay: projectile travel time (melee=1, ranged/magic varies by distance)
 */
import type { AttackType } from "./AttackType";

// =============================================================================
// Combat Phase State Machine
// =============================================================================

/**
 * Explicit combat phases matching OSRS behavior.
 *
 * State transitions:
 * - Idle -> Approaching: Player initiates attack
 * - Approaching -> Attacking: In range and attack cooldown ready
 * - Attacking -> Cooldown: Attack executed, waiting for next
 * - Cooldown -> Attacking: Next attack ready, still in range
 * - Cooldown -> Approaching: Target moved out of range
 * - Cooldown -> Idle: Combat ended (target dead, player disengaged)
 * - Any -> Frozen: Freeze effect applied
 * - Frozen -> (previous): Freeze expired
 */
export enum CombatPhase {
    /** Not in combat */
    Idle = "idle",
    /** Moving toward target */
    Approaching = "approaching",
    /** Executing attack (animation playing) */
    Attacking = "attacking",
    /** Waiting for attack cooldown */
    Cooldown = "cooldown",
    /** Movement locked by freeze/stun */
    Frozen = "frozen",
}

// =============================================================================
// Player Combat Configuration
// =============================================================================

/**
 * Player's offensive combat configuration.
 * Derived from equipped weapon and combat style selection.
 */
export interface PlayerCombatConfig {
    /** Weapon category from ObjType (0=unarmed, 3=bow, 17=staff, etc.) */
    weaponCategory: number;
    /** Equipped weapon item ID (-1 if unarmed) */
    weaponItemId: number;
    /** Attack reach in tiles (1 for most melee, 2 for halberds, 7+ for ranged) */
    weaponRange: number;
    /** Combat style slot (0-3, determines attack type and XP distribution) */
    styleSlot: number;
    /** Combat spell ID if casting (-1 if none) */
    spellId: number;
    /** Whether autocast is enabled */
    autocastEnabled: boolean;
    /** Autocast mode (affects defensive XP) */
    autocastMode: "autocast" | "defensive_autocast" | null;
}

/**
 * Extract PlayerCombatConfig from a PlayerState.
 * Helper to avoid direct coupling to PlayerState in combat logic.
 */
export function extractPlayerCombatConfig(player: {
    combatWeaponCategory: number;
    combatWeaponItemId: number;
    combatWeaponRange: number;
    combatStyleSlot: number;
    combatSpellId: number;
    autocastEnabled: boolean;
    autocastMode: "autocast" | "defensive_autocast" | null;
}): PlayerCombatConfig {
    return {
        weaponCategory: player.combatWeaponCategory,
        weaponItemId: player.combatWeaponItemId,
        weaponRange: player.combatWeaponRange,
        styleSlot: player.combatStyleSlot,
        spellId: player.combatSpellId,
        autocastEnabled: player.autocastEnabled,
        autocastMode: player.autocastMode,
    };
}

// =============================================================================
// Combat Timing State
// =============================================================================

/**
 * Timing state for combat actions.
 * Tracks when attacks can occur and movement locks.
 */
export interface CombatTimingState {
    /** Tick when next attack can occur (attack speed cooldown) */
    nextAttackTick: number;
    /** Attack speed in ticks (e.g., 4 for most melee weapons) */
    attackSpeed: number;
    /** Tick when pending attack will execute (set when in range and ready) */
    pendingAttackTick?: number;
    /** Tick until movement is locked (melee attack animation) */
    stepLockUntilTick?: number;
    /** Last tick when pathfinding was attempted */
    lastRouteTick: number;
    /** First tick where combat routing could not find a valid path. */
    unreachableSinceTick?: number;
}

/**
 * Create default timing state for combat start.
 */
export function createInitialTimingState(tick: number, attackSpeed: number): CombatTimingState {
    return {
        nextAttackTick: tick,
        attackSpeed,
        lastRouteTick: tick,
    };
}

// =============================================================================
// NPC Engagement State
// =============================================================================

/**
 * State for player-vs-NPC combat engagement.
 * Tracks the NPC target and retaliation behavior.
 */
export interface NpcEngagementState {
    /** Target NPC's instance ID */
    npcId: number;
    /** Last known NPC tile X (for movement detection) */
    lastNpcTileX: number;
    /** Last known NPC tile Y (for movement detection) */
    lastNpcTileY: number;
    /** Whether player should auto-attack (false when player moves away) */
    playerAutoAttack: boolean;
    /**
     * Whether retaliation has been triggered.
     * OSRS: NPC only retaliates/chases after player's first swing/cast,
     * not on mere click-to-attack.
     */
    retaliationEngaged: boolean;
    /** Ticks remaining before NPC stops chasing if player disengages */
    aggroHoldTicks: number;
    /** NPC's attack speed in ticks */
    npcAttackSpeed: number;
    /** Tick when NPC can next attack the player */
    npcNextAttackTick: number;
    /** Last tick when NPC pathfinding was attempted */
    lastNpcChaseTick: number;
}

/** Default aggro hold duration in ticks (10 seconds = ~16.67 ticks, rounded to 16) */
export const DEFAULT_AGGRO_HOLD_TICKS = 16;

/**
 * Create initial engagement state for a new combat.
 */
export function createInitialEngagementState(
    npcId: number,
    npcTileX: number,
    npcTileY: number,
    npcAttackSpeed: number,
    tick: number,
): NpcEngagementState {
    return {
        npcId,
        lastNpcTileX: npcTileX,
        lastNpcTileY: npcTileY,
        playerAutoAttack: true,
        retaliationEngaged: false,
        aggroHoldTicks: DEFAULT_AGGRO_HOLD_TICKS,
        npcAttackSpeed,
        // Set when the first player hit lands and retaliation is engaged.
        npcNextAttackTick: 0,
        lastNpcChaseTick: tick,
    };
}

// =============================================================================
// Complete Combat State
// =============================================================================

/**
 * Complete combat state for a player-vs-NPC engagement.
 * Owned by PlayerCombatManager, replaces fragmented state across systems.
 */
export interface PlayerVsNpcCombatState {
    /** Current combat phase */
    phase: CombatPhase;
    /** Player's combat configuration (weapon, style, spell) */
    config: PlayerCombatConfig;
    /** Timing state (attack cooldowns, movement locks) */
    timing: CombatTimingState;
    /** NPC engagement state (target, retaliation) */
    engagement: NpcEngagementState;
}

/**
 * Create a new combat state when player initiates attack on NPC.
 */
export function createPlayerVsNpcCombatState(
    config: PlayerCombatConfig,
    npcId: number,
    npcTileX: number,
    npcTileY: number,
    npcAttackSpeed: number,
    playerAttackSpeed: number,
    tick: number,
): PlayerVsNpcCombatState {
    return {
        phase: CombatPhase.Approaching,
        config,
        timing: createInitialTimingState(tick, playerAttackSpeed),
        engagement: createInitialEngagementState(npcId, npcTileX, npcTileY, npcAttackSpeed, tick),
    };
}

// =============================================================================
// NPC Combat State
// =============================================================================

/**
 * Combat state for an NPC.
 * Simplified compared to player state - NPCs have fixed combat behavior.
 */
export interface NpcCombatState {
    /** Attack speed in ticks (loaded from cache) */
    attackSpeed: number;
    /** Attack type (melee/ranged/magic) */
    attackType: AttackType;
    /** Target player ID if in combat */
    targetPlayerId?: number;
    /** Tick when combat engagement expires (OSRS: 17 ticks after last interaction) */
    combatTimeoutTick: number;
    /** Tick when freeze expires (0 if not frozen) */
    freezeExpiryTick: number;
}

// =============================================================================
// State Transition Events
// =============================================================================

/**
 * Record of a combat state transition.
 * Useful for debugging and logging combat flow.
 */
export interface CombatStateTransition {
    /** Previous phase */
    from: CombatPhase;
    /** New phase */
    to: CombatPhase;
    /** Tick when transition occurred */
    tick: number;
    /** Reason for transition (for debugging) */
    reason: string;
}

// =============================================================================
// Combat Context for State Machine
// =============================================================================

/**
 * Context provided to state machine for computing transitions.
 * Separates "what we know" from "what we decide".
 */
export interface CombatStateMachineContext {
    /** Current game tick */
    tick: number;
    /** Distance to target in tiles (Chebyshev distance) */
    distanceToTarget: number;
    /** Attack reach based on weapon/spell */
    attackReach: number;
    /** Whether attack speed cooldown has elapsed */
    attackSpeedReady: boolean;
    /** Whether target is alive */
    targetAlive: boolean;
    /** Whether target is within attack range (accounting for size, obstacles) */
    targetInRange: boolean;
    /** Whether player is frozen/stunned */
    playerFrozen: boolean;
    /** Whether player has line of sight to target (for ranged/magic) */
    hasLineOfSight: boolean;
}

// =============================================================================
// Special Attack State
// =============================================================================

/**
 * Special attack configuration parsed from weapon description.
 */
export interface SpecialAttackConfig {
    /** Weapon item ID */
    weaponItemId: number;
    /** Energy cost as percentage (25, 50, 100, etc.) */
    costPercent: number;
    /** Accuracy multiplier (1.0 = normal, 2.0 = double accuracy) */
    accuracyMultiplier: number;
    /** Max hit multiplier (1.0 = normal, 1.25 = 25% more damage) */
    maxHitMultiplier: number;
    /** Number of hits (1 for normal, 2 for DDS, etc.) */
    hitCount: number;
    /** Whether attack is guaranteed to hit */
    forceHit?: boolean;
    /** Side effects on hit */
    effects?: SpecialAttackEffects;
}

/**
 * Side effects of special attacks.
 */
export interface SpecialAttackEffects {
    /** Freeze target for N ticks (e.g., Zamorak Godsword) */
    freezeTicks?: number;
    /** Heal attacker by fraction of damage dealt (e.g., SGS 0.5 = 50%) */
    healFraction?: number;
    /** Restore prayer by fraction of damage dealt (e.g., SGS 0.25 = 25%) */
    prayerFraction?: number;
    /** Drain target run energy by percentage (PvP only) */
    siphonRunEnergyPercent?: number;
    /** Disable protection prayers for N ticks (PvP only) */
    prayerDisableTicks?: number;
    /** Drain target magic level by damage dealt */
    drainMagicByDamage?: boolean;
    /** Drain random combat stat by damage dealt */
    drainCombatStatByDamage?: boolean;
}

// =============================================================================
// Hitsplat Types
// =============================================================================

/**
 * Result of applying a hitsplat to a target.
 */
export interface HitsplatResult {
    /** Hitsplat style (damage, block, poison, etc.) */
    style: number;
    /** Actual damage dealt (after reductions) */
    amount: number;
    /** Target's current HP after hit */
    hpCurrent: number;
    /** Target's max HP */
    hpMax: number;
}
