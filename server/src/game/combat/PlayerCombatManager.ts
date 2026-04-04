/**
 * Player Combat Manager
 *
 * Owns player-vs-NPC combat state, attack scheduling, and combat timing.
 * NPC movement, chase, retreat, and retaliation authority remain in NpcManager.
 */
import { SkillId } from "../../../../src/rs/skill/skills";
import { getPoweredStaffSpellData, getSpellData } from "../../data/spells";
import type { PathService } from "../../pathfinding/PathService";
import {
    CardinalAdjacentRouteStrategy,
    ExactRouteStrategy,
    RectWithinRangeLineOfSightRouteStrategy,
    RectWithinRangeRouteStrategy,
    RouteStrategy,
} from "../../pathfinding/legacy/pathfinder/RouteStrategy";
import { CollisionFlag } from "../../pathfinding/legacy/pathfinder/flag/CollisionFlag";
import type { ActionScheduler } from "../actions/ActionScheduler";
import type { CombatAttackActionData } from "../actions/actionPayloads";
import type { ActionEffect } from "../actions/types";
import { NpcState } from "../npc";
import { type PlayerManager, PlayerState } from "../player";
import {
    CombatEngine,
    type PlayerAttackPlan,
} from "../systems/combat/CombatEngine";
import { type AttackType, normalizeAttackType } from "./AttackType";
import {
    hasDirectMeleePath,
    hasDirectMeleeReach,
    hasProjectileLineOfSightToNpc,
    isWithinAttackRange,
} from "./CombatAction";
import { CombatEffectApplicator } from "./CombatEffectApplicator";
import { CombatEngagementRegistry } from "./CombatEngagementRegistry";
import * as CombatFormulas from "./CombatFormulas";
import { resolvePlayerAttackReach, resolvePlayerAttackType } from "./CombatRules";
import {
    CombatPhase,
    CombatStateMachineContext,
    CombatStateTransition,
    DEFAULT_AGGRO_HOLD_TICKS,
    PlayerCombatConfig,
    PlayerVsNpcCombatState,
    createPlayerVsNpcCombatState,
    extractPlayerCombatConfig,
} from "./CombatState";
import { createCombatStateMachine } from "./CombatStateMachine";
import { DamageType, damageTracker } from "./DamageTracker";
import { HITMARK_BLOCK, HITMARK_DAMAGE } from "./HitEffects";
import { multiCombatSystem } from "./MultiCombatZones";
import {
    SpecialAttackRegistry,
    applyDarkBowDamageModifiers,
    calculateDragonClawsHits,
    isDarkBow,
    resolveAmmoModifiers,
} from "./SpecialAttackRegistry";

// =============================================================================
// Constants (from CombatSystem)
// =============================================================================

const DEFAULT_MAGIC_CAST_SPOT = 90;

// =============================================================================
// Helper Functions
// =============================================================================

function distanceToNpcBounds(player: PlayerState, npc: NpcState): number {
    const px = player.tileX;
    const py = player.tileY;
    const minX = npc.tileX;
    const minY = npc.tileY;
    const size = Math.max(1, npc.size);
    const maxX = minX + size - 1;
    const maxY = minY + size - 1;
    const clampedX = Math.max(minX, Math.min(px, maxX));
    const clampedY = Math.max(minY, Math.min(py, maxY));
    const dx = Math.abs(clampedX - px);
    const dy = Math.abs(clampedY - py);
    return Math.max(dx, dy);
}

// =============================================================================
// Types
// =============================================================================

/**
 * Special attack payload for combat scheduling.
 */
type SpecialAttackPayload = {
    weaponItemId: number;
    costPercent: number;
    accuracyMultiplier: number;
    maxHitMultiplier: number;
    hitCount: number;
    forceHit?: boolean;
    effects?: {
        siphonRunEnergyPercent?: number;
        healFraction?: number;
        prayerFraction?: number;
        freezeTicks?: number;
        prayerDisableTicks?: number;
        drainMagicByDamage?: boolean;
        drainCombatStatByDamage?: boolean;
    };
    /** Dark bow specific: minimum damage per hit */
    minDamagePerHit?: number;
    /** Dark bow specific: maximum damage per hit (dragon arrows = 48) */
    maxDamagePerHit?: number;
    /** Dark bow specific: graphic ID based on arrow type */
    specGraphicId?: number;
    /** Dark bow specific: projectile ID based on arrow type */
    specProjectileId?: number;
    /** Dark bow specific: sound ID based on arrow type */
    specSoundId?: number;
    /** Per-hit sounds for multi-hit specials (e.g., dragon claws) */
    hitSounds?: number[];
};

/**
 * Attack scheduling result.
 */
export interface AttackScheduleResult {
    ok: boolean;
    hitDelay?: number;
}

/**
 * Context provided to PlayerCombatManager.processTick().
 * Contains the player-owned dependencies needed for combat processing.
 */
export interface PlayerCombatManagerContext {
    /** Current game tick */
    tick: number;
    /** Lookup NPC by ID */
    npcLookup: (npcId: number) => NpcState | undefined;
    /** Lookup player by ID */
    playerLookup?: (playerId: number) => PlayerState | undefined;
    /** Path service for routing and LoS checks */
    pathService?: PathService;
    /** Get player's attack speed based on weapon */
    pickAttackSpeed: (player: PlayerState) => number;
    /** Get NPC hit delay (projectile travel time) */
    pickNpcHitDelay?: (npc: NpcState, player: PlayerState, attackSpeed: number) => number;
    /** Get special attack energy cost for a weapon */
    getWeaponSpecialCostPercent?: (weaponItemId: number) => number | undefined;
    /** Get attack reach for player (weapon/spell range) */
    getAttackReach?: (player: PlayerState) => number;
    /** Check if player has line of sight to NPC */
    hasLineOfSight?: (player: PlayerState, npc: NpcState) => boolean;
    /** Check if player is frozen */
    isPlayerFrozen?: (player: PlayerState, tick: number) => boolean;
    /** Calculate distance from player to NPC */
    getDistanceToNpc?: (player: PlayerState, npc: NpcState) => number;
    /** Check if player is within attack reach of NPC */
    isWithinAttackReach?: (player: PlayerState, npc: NpcState, reach: number) => boolean;
    /** Route player toward NPC */
    routePlayerToNpc?: (player: PlayerState, npc: NpcState, reach: number) => boolean;
    /**
     * Schedule a player attack on an NPC.
     * Called when player is in range and attack cooldown is ready.
     */
    schedulePlayerAttack?: (
        player: PlayerState,
        npc: NpcState,
        attackSpeed: number,
    ) => AttackScheduleResult;
    /**
     * Check if player attack should auto-repeat (melee/ranged yes, manual spell no).
     */
    shouldRepeatAttack?: (player: PlayerState) => boolean;
    /** Queue a spot animation (graphic) */
    queueSpotAnimation?: (event: {
        tick: number;
        playerId?: number;
        npcId?: number;
        spotId: number;
        delay?: number;
        height?: number;
    }) => void;
    /** Callback when magic attack is scheduled (for rune consumption, etc.) */
    onMagicAttack?: (event: {
        player: PlayerState;
        npc: NpcState;
        plan: PlayerAttackPlan;
        tick: number;
    }) => boolean | void;
    /** Logger for debugging */
    logger?: { warn: (...args: unknown[]) => void; debug?: (...args: unknown[]) => void };
}

export interface PlayerCombatMovementContext {
    tick: number;
    npcLookup: (npcId: number) => NpcState | undefined;
    pathService?: PathService;
    onCannotReachTarget?: (player: PlayerState) => void;
}

/**
 * Result of processing a combat tick.
 */
export interface CombatTickResult {
    /** Action effects to be processed (hitsplats, XP, etc.) */
    effects: ActionEffect[];
    /** State transitions that occurred */
    transitions: CombatStateTransition[];
    /** Engagements that ended this tick */
    endedEngagements: Array<{ playerId: number; reason: string }>;
    /** Players who had attacks scheduled this tick */
    attacksScheduled: Array<{ playerId: number; npcId: number; attackSpeed: number }>;
}

/**
 * Combat engagement info for external queries.
 */
export interface CombatEngagementInfo {
    playerId: number;
    npcId: number;
    phase: CombatPhase;
    nextAttackTick: number;
    npcNextAttackTick: number;
    retaliationEngaged: boolean;
}

// =============================================================================
// Constants
// =============================================================================

/** Maximum chase distance before disengaging (tiles) */
const MAX_CHASE_DISTANCE = 32;

/** Default attack speed if not specified (4 ticks = 2.4s) */
const DEFAULT_ATTACK_SPEED = 4;

/** Default attack reach for melee */
const DEFAULT_MELEE_REACH = 1;

/** Ticks to lock player movement during melee attack animation */
const STEP_LOCK_TICKS = 1;

// =============================================================================
// Player Combat Manager
// =============================================================================

/**
 * Player-owned combat state and scheduling for NPC targets.
 */
export class PlayerCombatManager {
    private readonly effectApplicator: CombatEffectApplicator;
    private readonly actionScheduler?: ActionScheduler;
    private readonly engine: CombatEngine;
    private readonly playerManager?: PlayerManager;

    /** Player-vs-NPC engagements keyed by player PID. */
    private readonly engagements = new CombatEngagementRegistry();

    constructor(opts?: {
        scheduler?: ActionScheduler;
        players?: PlayerManager;
        randomSeed?: number;
    }) {
        this.effectApplicator = new CombatEffectApplicator();
        this.actionScheduler = opts?.scheduler;
        this.engine = new CombatEngine({ seed: opts?.randomSeed ?? Date.now() });
        this.playerManager = opts?.players;
    }

    // =========================================================================
    // Combat Lifecycle
    // =========================================================================

    /**
     * Start a combat engagement between player and NPC.
     *
     * @param player - The attacking player
     * @param npc - The target NPC
     * @param tick - Current game tick
     * @param attackSpeed - Player's attack speed (optional, will be computed if not provided)
     * @returns True if combat started successfully
     */
    startCombat(player: PlayerState, npc: NpcState, tick: number, attackSpeed?: number): boolean {
        const playerId = player.id;

        // If already in combat with same NPC, just update state
        const existing = this.engagements.get(playerId);
        if (existing && existing.state.engagement.npcId === npc.id) {
            existing.state.engagement.playerAutoAttack = true;
            existing.state.engagement.aggroHoldTicks = DEFAULT_AGGRO_HOLD_TICKS;
            return true;
        }

        // End any existing combat first
        if (existing) {
            this.endCombat(playerId, tick, "new_target");
        }

        // Create combat config from player
        const config = extractPlayerCombatConfig(player);

        // Determine attack speeds
        const playerAttackSpeed = attackSpeed ?? DEFAULT_ATTACK_SPEED;
        const npcAttackSpeed = npc.attackSpeed ?? DEFAULT_ATTACK_SPEED;

        // Create combat state
        const state = createPlayerVsNpcCombatState(
            config,
            npc.id,
            npc.tileX,
            npc.tileY,
            npcAttackSpeed,
            playerAttackSpeed,
            tick,
        );

        // Create state machine and start combat
        const sm = createCombatStateMachine();
        sm.startCombat(tick);

        this.engagements.set(playerId, state, sm);

        return true;
    }

    /**
     * End a combat engagement.
     *
     * @param playerId - Player whose combat should end
     * @param tick - Current game tick
     * @param reason - Reason for ending (for logging)
     */
    endCombat(playerId: number, tick: number, reason: string): void {
        const sm = this.engagements.getStateMachine(playerId);
        if (sm) {
            sm.endCombat(tick, reason);
        }
        this.engagements.delete(playerId);
    }

    /**
     * Stop auto-attacking but remain in combat (for movement).
     * Also clears any pending attack to prevent scheduled attacks from executing.
     */
    stopAutoAttack(playerId: number): void {
        const state = this.engagements.getState(playerId);
        if (state) {
            state.engagement.playerAutoAttack = false;
            // Clear pending attack and movement locks so attack doesn't still fire
            state.timing.pendingAttackTick = undefined;
            state.timing.stepLockUntilTick = undefined;
        }
    }

    /**
     * Resume auto-attacking.
     */
    resumeAutoAttack(playerId: number): void {
        const state = this.engagements.getState(playerId);
        if (state) {
            state.engagement.playerAutoAttack = true;
            state.engagement.aggroHoldTicks = DEFAULT_AGGRO_HOLD_TICKS;
        }
    }

    /**
     * Ensure the disengage hold stays alive for at least the given number of ticks.
     * Used when the NPC successfully retaliates so player combat focus does not collapse early.
     */
    extendAggroHold(playerId: number, minimumTicks: number = 6): void {
        const state = this.engagements.getState(playerId);
        if (!state) return;
        state.engagement.aggroHoldTicks = Math.max(
            state.engagement.aggroHoldTicks,
            Math.max(0, minimumTicks),
        );
    }

    // =========================================================================
    // State Queries
    // =========================================================================

    /**
     * Check if player is in combat.
     */
    isInCombat(playerId: number): boolean {
        const sm = this.engagements.getStateMachine(playerId);
        return sm?.isInCombat() ?? false;
    }

    /**
     * Get current combat phase for a player.
     */
    getCombatPhase(playerId: number): CombatPhase | undefined {
        return this.engagements.getStateMachine(playerId)?.getState();
    }

    /**
     * Get full combat state for a player (for external systems).
     */
    getCombatState(playerId: number): PlayerVsNpcCombatState | undefined {
        return this.engagements.getState(playerId);
    }

    /**
     * Get combat engagement info for a player.
     */
    getEngagementInfo(playerId: number): CombatEngagementInfo | undefined {
        const entry = this.engagements.get(playerId);
        if (!entry) return undefined;
        const state = entry.state;
        const sm = entry.stateMachine;

        return {
            playerId,
            npcId: state.engagement.npcId,
            phase: sm.getState(),
            nextAttackTick: state.timing.nextAttackTick,
            npcNextAttackTick: state.engagement.npcNextAttackTick,
            retaliationEngaged: state.engagement.retaliationEngaged,
        };
    }

    /**
     * Get the NPC ID that a player is fighting.
     */
    getTargetNpcId(playerId: number): number | undefined {
        return this.engagements.getState(playerId)?.engagement.npcId;
    }

    /**
     * Update combat config when player equipment changes.
     */
    updateCombatConfig(player: PlayerState): void {
        const state = this.engagements.getState(player.id);
        if (state) {
            state.config = extractPlayerCombatConfig(player);
        }
    }

    // =========================================================================
    // Tick Processing
    // =========================================================================

    /**
     * Process a tick for all active combat engagements.
     *
     * @param ctx - Combat context with lookups and utilities
     * @returns Tick result with effects, transitions, and scheduled attacks
     */
    processTick(ctx: PlayerCombatManagerContext): CombatTickResult {
        // Build internal context with scheduling functions
        const internalCtx = this.buildInternalContext(ctx);

        const effects: ActionEffect[] = [];
        const transitions: CombatStateTransition[] = [];
        const endedEngagements: Array<{ playerId: number; reason: string }> = [];
        const attacksScheduled: Array<{ playerId: number; npcId: number; attackSpeed: number }> =
            [];

        // OSRS parity: Process combat in PID order (ascending player ID)
        // Map iteration order is insertion order, not PID order
        // Reference: docs/tick-cycle-order.md
        const sortedStates = this.engagements.entriesSortedByPid();

        for (const [playerId, entry] of sortedStates) {
            const state = entry.state;
            const player = internalCtx.playerLookup?.(playerId);
            if (!player) {
                this.endCombat(playerId, ctx.tick, "player_not_found");
                endedEngagements.push({ playerId, reason: "player_not_found" });
                continue;
            }

            const npc = ctx.npcLookup(state.engagement.npcId);
            if (!npc || npc.getHitpoints() <= 0) {
                this.endCombat(playerId, ctx.tick, "target_dead");
                endedEngagements.push({ playerId, reason: "target_dead" });
                continue;
            }

            const result = this.processPlayerCombatTick(player, npc, state, internalCtx);
            effects.push(...result.effects);
            if (result.transition) {
                transitions.push(result.transition);
            }
            if (result.ended) {
                endedEngagements.push({ playerId, reason: result.endReason ?? "unknown" });
            }
            if (result.playerAttackScheduled) {
                attacksScheduled.push({
                    playerId,
                    npcId: state.engagement.npcId,
                    attackSpeed: state.timing.attackSpeed,
                });
            }
        }

        // Player vs Player autocast scheduling
        if (this.playerManager && this.actionScheduler) {
            const schedulePlayerVsPlayerAutocast = (
                player: PlayerState,
                target: PlayerState,
                attackDelay: number,
                currentTick: number,
            ): boolean => {
                const spellId = player.combatSpellId;
                if (!(spellId > 0)) return false;
                const modeRaw = player.autocastMode;
                const castMode =
                    modeRaw === "defensive_autocast" ? "defensive_autocast" : ("autocast" as const);
                const res = this.actionScheduler!.requestAction(
                    player.id,
                    {
                        kind: "combat.autocast",
                        data: {
                            targetId: target.id,
                            spellId: spellId,
                            castMode,
                        },
                        groups: ["combat.attack"],
                        cooldownTicks: Math.max(1, attackDelay),
                        delayTicks: 0,
                    },
                    currentTick,
                );
                return !!res.ok;
            };

            this.playerManager.updatePlayerAttacks(ctx.tick, schedulePlayerVsPlayerAutocast, {
                pickPlayerAttackDelay: (player) => ctx.pickAttackSpeed(player),
            });
        }

        // Process scheduled actions and merge with effects
        if (this.actionScheduler) {
            const schedulerEffects = this.actionScheduler.processTick(ctx.tick);
            effects.push(...schedulerEffects);
        }

        return { effects, transitions, endedEngagements, attacksScheduled };
    }

    /**
     * Process combat tick for a single player.
     * Handles state transitions, attack scheduling, and melee locks.
     */
    private processPlayerCombatTick(
        player: PlayerState,
        npc: NpcState,
        state: PlayerVsNpcCombatState,
        ctx: PlayerCombatManagerContext,
    ): {
        effects: ActionEffect[];
        transition?: CombatStateTransition;
        ended?: boolean;
        endReason?: string;
        playerAttackScheduled?: boolean;
    } {
        const effects: ActionEffect[] = [];
        const playerId = player.id;
        const tick = ctx.tick;
        let playerAttackScheduled = false;

        const sm = this.engagements.getStateMachine(playerId);
        if (!sm) {
            return { effects, ended: true, endReason: "no_state_machine" };
        }

        // Update NPC position tracking
        state.engagement.lastNpcTileX = npc.tileX;
        state.engagement.lastNpcTileY = npc.tileY;

        // Calculate distance and reach
        const distance = ctx.getDistanceToNpc?.(player, npc) ?? distanceToNpcBounds(player, npc);
        const reach =
            ctx.getAttackReach?.(player) ?? state.config.weaponRange ?? DEFAULT_MELEE_REACH;
        const inRange = ctx.isWithinAttackReach?.(player, npc, reach) ?? distance <= reach;
        const hasLos = ctx.hasLineOfSight?.(player, npc) ?? true;
        const isFrozen = ctx.isPlayerFrozen?.(player, ctx.tick) ?? false;
        const isMelee = reach <= 1;

        // Handle step lock for melee (prevent movement during attack animation)
        if (isMelee && state.timing.stepLockUntilTick !== undefined) {
            if (tick < state.timing.stepLockUntilTick) {
                player.clearPath();
            } else {
                state.timing.stepLockUntilTick = undefined;
            }
        }

        // Check chase distance
        if (distance > MAX_CHASE_DISTANCE) {
            this.endCombat(playerId, ctx.tick, "too_far");
            return { effects, ended: true, endReason: "too_far" };
        }

        // Handle auto-attack decay
        if (!state.engagement.playerAutoAttack) {
            // Clear melee locks when player stops auto-attacking
            if (isMelee) {
                state.timing.stepLockUntilTick = undefined;
            }
            state.engagement.aggroHoldTicks--;
            if (state.engagement.aggroHoldTicks <= 0) {
                this.endCombat(playerId, ctx.tick, "disengaged");
                return { effects, ended: true, endReason: "disengaged" };
            }
        } else {
            // Reset aggro hold when player is auto-attacking
            state.engagement.aggroHoldTicks = DEFAULT_AGGRO_HOLD_TICKS;
        }

        // Build state machine context
        const smContext: CombatStateMachineContext = {
            tick: ctx.tick,
            distanceToTarget: distance,
            attackReach: reach,
            attackSpeedReady: ctx.tick >= state.timing.nextAttackTick,
            targetAlive: npc.getHitpoints() > 0,
            targetInRange: inRange,
            playerFrozen: isFrozen,
            hasLineOfSight: hasLos,
        };

        // Process state machine
        const transition = sm.tick(smContext);

        // Handle phase-specific logic
        const phase = sm.getState();

        switch (phase) {
            case CombatPhase.Approaching:
                // Route player toward NPC
                if (ctx.routePlayerToNpc && !isFrozen) {
                    ctx.routePlayerToNpc(player, npc, reach);
                }
                state.timing.pendingAttackTick = undefined;
                break;

            case CombatPhase.Attacking:
                // Attack is ready - schedule the attack
                if (ctx.schedulePlayerAttack && state.engagement.playerAutoAttack) {
                    const attackSpeed = ctx.pickAttackSpeed(player);
                    state.timing.attackSpeed = attackSpeed;
                    player.attackDelay = attackSpeed;

                    const result = ctx.schedulePlayerAttack(player, npc, attackSpeed);
                    const ok = result.ok;

                    if (ok) {
                        playerAttackScheduled = true;
                        state.timing.pendingAttackTick = undefined;
                        state.timing.nextAttackTick = tick + attackSpeed;

                        // Apply melee locks
                        if (isMelee) {
                            state.timing.stepLockUntilTick = tick + STEP_LOCK_TICKS;
                            player.clearPath();
                        }

                        // Check if attack should auto-repeat
                        const shouldRepeat = ctx.shouldRepeatAttack?.(player) ?? true;
                        state.engagement.playerAutoAttack = shouldRepeat;

                        // OSRS parity: Do NOT trigger retaliation when attack is scheduled.
                        // Call confirmHitLanded() when the hitsplat is applied.
                        // This handles projectile delays correctly for ranged/magic.

                        // Transition to cooldown
                        sm.forceState(CombatPhase.Cooldown, tick, "attack_executed");
                    } else {
                        // Attack failed, retry next tick
                        state.timing.pendingAttackTick = tick + 1;
                    }
                }
                break;

            case CombatPhase.Cooldown:
                // Clear pending attack tick
                state.timing.pendingAttackTick = undefined;
                break;
        }

        // NPC chase/retaliation ownership lives in NpcManager.
        // PlayerCombatManager only manages player-facing combat state and attack scheduling.

        return {
            effects,
            transition: transition ?? undefined,
            playerAttackScheduled,
        };
    }

    /**
     * Called when a player's hit on an NPC actually lands (hitsplat applied).
     * OSRS parity: NPC retaliation should only start after the first hit LANDS,
     * not when the attack is scheduled. This handles projectile delays correctly.
     *
     * @param playerId - The attacking player's ID
     * @param npc - The NPC that was hit
     * @param tick - Current game tick
     * @param damage - Amount of damage dealt (for tracking)
     * @param attackType - Type of damage (melee/ranged/magic)
     * @param player - Optional player reference for damage tracking
     */
    confirmHitLanded(
        playerId: number,
        npc: NpcState,
        tick: number,
        damage?: number,
        attackType?: AttackType,
        player?: PlayerState,
    ): void {
        const state = this.engagements.getState(playerId);
        if (!state) return;
        if (state.engagement.npcId !== npc.id) return;
        if (npc.isRecoveringToSpawn()) return;

        // Record combat engagement for multi-combat tracking
        // Note: multiCombatSystem tracks by Actor, so we use npc directly
        // Player tracking requires the actual player instance
        if (player) {
            multiCombatSystem.recordEngagement(player, npc, tick);

            // Record damage for loot attribution
            if (damage !== undefined && damage > 0) {
                const damageType: DamageType = attackType ?? "melee";
                damageTracker.recordDamage(player, npc, damage, damageType, tick);
            }
        }

        // First hit has now landed - NPC can start retaliating
        if (!state.engagement.retaliationEngaged) {
            state.engagement.retaliationEngaged = true;

            // OSRS parity: Only apply retaliation delay if NPC wasn't already in combat.
            // If NPC is already fighting (same or different player), it uses its existing
            // attack timer rather than resetting. This creates natural variance - NPCs
            // mid-combat may retaliate faster or slower depending on their current timer.
            const wasAlreadyInCombat = npc.isInCombat(tick);
            if (!wasAlreadyInCombat) {
                // Fresh engagement - apply standard retaliation delay.
                // Delay here is "until first retaliation swing". The retaliation hit then
                // resolves on its normal attack hit delay (1 tick for melee in this scheduler flow).
                const npcAttackSpeed = npc.attackSpeed;
                const retaliationDelay = Math.ceil(npcAttackSpeed / 2);
                const nextSwingTick = tick + retaliationDelay;
                npc.setNextAttackTick(nextSwingTick);
                state.engagement.npcNextAttackTick = nextSwingTick;
            } else {
                state.engagement.npcNextAttackTick = npc.getNextAttackTick();
            }
            // If already in combat, NPC keeps its existing attack timer

            npc.engageCombat(playerId, tick);
            npc.setInteraction("player", playerId);
        }
    }

    /**
     * Record damage dealt to an NPC (for loot attribution).
     * Call this when damage is applied, even if not through normal combat flow.
     */
    recordDamage(
        player: PlayerState,
        npc: NpcState,
        damage: number,
        damageType: DamageType,
        tick: number,
    ): void {
        if (damage <= 0) return;
        damageTracker.recordDamage(player, npc, damage, damageType, tick);
        multiCombatSystem.recordEngagement(player, npc, tick);
    }

    /**
     * Get drop eligibility when an NPC dies.
     * Returns the player(s) who should receive loot.
     */
    getDropEligibility(npc: NpcState) {
        return damageTracker.getDropEligibility(npc);
    }

    /**
     * Clean up tracking data for a dead/despawned NPC.
     */
    cleanupNpc(npc: NpcState): void {
        damageTracker.clearNpc(npc);
        multiCombatSystem.removeActor(npc);
    }

    /**
     * Update attack timing after an attack is executed.
     */
    onAttackExecuted(playerId: number, tick: number, attackSpeed: number): void {
        const state = this.engagements.getState(playerId);
        if (state) {
            state.timing.nextAttackTick = tick + attackSpeed;
            state.timing.attackSpeed = attackSpeed;
            state.timing.pendingAttackTick = undefined;

            // OSRS parity: Do NOT trigger retaliation here.
            // Wait for confirmHitLanded() when the hitsplat actually applies.
            // This correctly handles projectile delays for ranged/magic.
        }

        // Transition state machine to cooldown
        const sm = this.engagements.getStateMachine(playerId);
        if (sm && sm.getState() === CombatPhase.Attacking) {
            sm.forceState(CombatPhase.Cooldown, tick, "attack_executed");
        }
    }

    /**
     * Apply movement lock after melee attack.
     */
    applyMeleeMovementLock(playerId: number, tick: number, lockTicks: number): void {
        const state = this.engagements.getState(playerId);
        if (state) {
            state.timing.stepLockUntilTick = tick + lockTicks;
        }
    }

    /**
     * Check if player movement is locked.
     */
    isMovementLocked(playerId: number, tick: number): boolean {
        const state = this.engagements.getState(playerId);
        if (!state) return false;

        return (
            state.timing.stepLockUntilTick !== undefined && tick < state.timing.stepLockUntilTick
        );
    }

    // =========================================================================
    // Integration Helpers
    // =========================================================================

    /**
     * Check if a pending attack is ready to execute.
     */
    hasPendingAttack(playerId: number, tick: number): boolean {
        const state = this.engagements.getState(playerId);
        return state?.timing.pendingAttackTick === tick;
    }

    /**
     * Update player-vs-NPC combat movement during pre/post movement phases.
     * This owns chase routing and unreachable cancellation for active combat.
     */
    updateNpcCombatMovement(ctx: PlayerCombatMovementContext): void {
        const pathService = ctx.pathService;
        if (!pathService) return;

        for (const [playerId, entry] of this.engagements.entriesSortedByPid()) {
            const state = entry.state;
            if (!state.engagement.playerAutoAttack) continue;

            const player = this.playerManager?.getPlayerById(playerId);
            if (!player) continue;

            const npc = ctx.npcLookup(state.engagement.npcId);
            if (!npc) continue;
            if (npc.level !== player.level) continue;

            const reach = resolvePlayerAttackReach(player);
            if (this.isWithinAttackReachForMovement(player, npc, reach, pathService)) {
                player.clearPath();
                state.timing.unreachableSinceTick = undefined;
                continue;
            }

            const npcMoved =
                state.engagement.lastNpcTileX !== npc.tileX || state.engagement.lastNpcTileY !== npc.tileY;
            if (npcMoved) {
                state.engagement.lastNpcTileX = npc.tileX;
                state.engagement.lastNpcTileY = npc.tileY;
                state.timing.lastRouteTick = Number.MIN_SAFE_INTEGER;
                state.timing.unreachableSinceTick = undefined;
            }

            const shouldRoute =
                !player.hasPath() ||
                npcMoved ||
                ctx.tick - state.timing.lastRouteTick >= 2 ||
                player.wasTeleported();

            if (!shouldRoute) continue;

            const run = this.resolveCombatRunMode(player, playerId, state.engagement.npcId);
            if (
                this.tryRouteToLineOfSight(player, npc, reach, pathService, run) ||
                this.routePlayerToNpc(player, npc, reach, pathService, run)
            ) {
                state.timing.lastRouteTick = ctx.tick;
                state.timing.unreachableSinceTick = undefined;
                continue;
            }

            const fallbackRouted = this.routePlayerToTile(
                player,
                { x: npc.tileX, y: npc.tileY },
                pathService,
                run,
            );
            const fallbackWithProgress =
                fallbackRouted &&
                (player.hasPath() ||
                    this.isWithinAttackReachForMovement(player, npc, reach, pathService));
            if (fallbackWithProgress) {
                state.timing.lastRouteTick = ctx.tick;
                state.timing.unreachableSinceTick = undefined;
                continue;
            }

            if (state.timing.unreachableSinceTick === undefined) {
                state.timing.unreachableSinceTick = ctx.tick;
                continue;
            }
            if (ctx.tick - state.timing.unreachableSinceTick < 1) {
                continue;
            }

            ctx.onCannotReachTarget?.(player);
            player.clearPath();
            player.clearInteraction();
            player.removeCombatTarget();
            player.stopAnimation();
            this.endCombat(playerId, ctx.tick, "no_path");
            this.playerManager?.finishNpcCombatByPlayerId(playerId, state.engagement.npcId);
        }
    }

    /**
     * Clear path before movement when an in-range melee swing should start this tick.
     */
    applyPreMovementLocks(ctx: PlayerCombatMovementContext): void {
        const pathService = ctx.pathService;
        if (!pathService) return;

        for (const [playerId, entry] of this.engagements.entriesSortedByPid()) {
            const state = entry.state;
            const npcId = state.engagement.npcId;
            if (!this.shouldLockPreMovement(playerId, npcId, ctx.tick)) continue;

            const player = this.playerManager?.getPlayerById(playerId);
            if (!player) continue;
            const npc = ctx.npcLookup(npcId);
            if (!npc) continue;

            const reach = resolvePlayerAttackReach(player);
            if (reach > 1) continue;
            if (!this.isWithinAttackReachForMovement(player, npc, reach, pathService)) continue;
            player.clearPath();
        }
    }

    /**
     * Check whether pre-movement should clear the player's path so an in-range melee
     * swing can start on this tick instead of consuming a movement step first.
     */
    shouldLockPreMovement(playerId: number, npcId: number, tick: number): boolean {
        const state = this.engagements.getState(playerId);
        if (!state) return false;
        if (state.engagement.npcId !== npcId) return false;
        if (!state.engagement.playerAutoAttack) return false;
        if ((state.config.weaponRange ?? DEFAULT_MELEE_REACH) > 1) return false;
        if (state.timing.pendingAttackTick !== undefined) return false;
        return tick >= state.timing.nextAttackTick;
    }

    /**
     * Get all active combat engagements.
     */
    getAllEngagements(): CombatEngagementInfo[] {
        const engagements: CombatEngagementInfo[] = [];
        for (const playerId of this.engagements.keys()) {
            const info = this.getEngagementInfo(playerId);
            if (info) {
                engagements.push(info);
            }
        }
        return engagements;
    }

    /**
     * Clear all combat engagements (for testing or reset).
     */
    clearAll(): void {
        this.engagements.clear();
    }

    // =========================================================================
    // Utilities
    // =========================================================================

    /**
     * Get the effect applicator instance.
     */
    getEffectApplicator(): CombatEffectApplicator {
        return this.effectApplicator;
    }

    // =========================================================================
    // Engine Delegation (merged from CombatSystem)
    // =========================================================================

    /**
     * Roll retaliation damage using NPC's combat profile directly.
     * Uses pure CombatFormulas - no external lookups needed.
     */
    rollRetaliateDamage(npc: NpcState, player: PlayerState): number {
        const profile = npc.combat;

        // Get player defence stats
        const defenceLevel = this.engine.getBoostedLevel(player, SkillId.Defence);
        const magicLevel = this.engine.getBoostedLevel(player, SkillId.Magic);
        const defenceBonus = this.engine.getPlayerDefenceBonus(player, profile.attackType);

        // Calculate using pure formulas
        const result = CombatFormulas.calculateNpcVsPlayer(
            profile,
            { defenceLevel, magicLevel, defenceBonus },
            profile.attackType,
        );

        // Roll hit
        const roll = Math.random();
        if (roll >= result.hitChance) {
            return 0; // Miss
        }

        // Roll damage
        return CombatFormulas.rollDamage(result.maxHit, Math.random());
    }

    /**
     * Pick block sequence (defense animation) for a player.
     */
    pickBlockSequence(
        player: PlayerState,
        weaponData?: Map<number, Record<string, number>>,
    ): number {
        return this.engine.resolveBlockSequence(player, weaponData);
    }

    /**
     * Get the player manager.
     */
    getPlayerManager(): PlayerManager | undefined {
        return this.playerManager;
    }

    // =========================================================================
    // Attack Scheduling (merged from CombatSystem)
    // =========================================================================

    /**
     * Schedule a player attack on an NPC (internal implementation).
     * This is the ~320 LOC lambda from CombatSystem.processTick().
     */
    private schedulePlayerAttackInternal(
        player: PlayerState,
        npc: NpcState,
        attackDelay: number,
        ctx: PlayerCombatManagerContext,
    ): AttackScheduleResult {
        if (!this.actionScheduler) {
            return { ok: false, hitDelay: 0 };
        }

        const playerAttackSpeed = Math.max(1, ctx.pickAttackSpeed(player));
        player.attackDelay = playerAttackSpeed;
        const weaponItemId = player.combatWeaponItemId ?? -1;
        let special: SpecialAttackPayload | undefined;
        let specialModifiers:
            | { accuracyMultiplier?: number; maxHitMultiplier?: number; forceHit?: boolean }
            | undefined;
        let hitCount = 1;
        const specialDef =
            player.isSpecialActivated() && weaponItemId > 0
                ? SpecialAttackRegistry.get(weaponItemId)
                : undefined;
        const forceFirstHit = !!specialDef?.effects?.guaranteedFirstHit;
        if (specialDef) {
            const costPercent =
                ctx.getWeaponSpecialCostPercent?.(weaponItemId) ?? specialDef.energyCost;
            if (costPercent !== undefined && costPercent > 0) {
                hitCount = Math.max(1, Math.min(10, specialDef.hitCount || 1));
                const forceHit = forceFirstHit ? true : undefined;
                specialModifiers = {
                    accuracyMultiplier: specialDef.accuracyMultiplier,
                    maxHitMultiplier: specialDef.damageMultiplier,
                    forceHit,
                };
                const effects: SpecialAttackPayload["effects"] = {};
                if (specialDef.effects?.freezeTicks !== undefined) {
                    effects.freezeTicks = specialDef.effects.freezeTicks;
                }
                if (specialDef.effects?.healFraction !== undefined) {
                    effects.healFraction = specialDef.effects.healFraction;
                }
                if (specialDef.effects?.prayerFraction !== undefined) {
                    effects.prayerFraction = specialDef.effects.prayerFraction;
                }
                if (specialDef.effects?.drainRunEnergy !== undefined) {
                    effects.siphonRunEnergyPercent = specialDef.effects.drainRunEnergy;
                }
                const prayerDisableTicks = (
                    specialDef.effects as { prayerDisableTicks?: number } | undefined
                )?.prayerDisableTicks;
                if (prayerDisableTicks !== undefined) {
                    effects.prayerDisableTicks = prayerDisableTicks;
                }
                if (specialDef.effects?.drainMagicByDamage) {
                    effects.drainMagicByDamage = true;
                }
                const drainCombatStatByDamage = (
                    specialDef.effects as { drainCombatStatByDamage?: boolean } | undefined
                )?.drainCombatStatByDamage;
                if (drainCombatStatByDamage || specialDef.effects?.drainAllCombatByDamage) {
                    effects.drainCombatStatByDamage = true;
                }
                const hasEffects = Object.values(effects).some((v) => v !== undefined);

                // Dark bow: Resolve ammo-based modifiers
                let damageMultiplier = specialDef.damageMultiplier;
                let minDamagePerHit: number | undefined;
                let maxDamagePerHit: number | undefined;
                let specGraphicId: number | undefined;
                let specProjectileId: number | undefined;
                let specSoundId: number | undefined;

                if (isDarkBow(weaponItemId) && specialDef.ammoModifiers) {
                    // Get equipped ammo from player appearance
                    const equip = player.appearance?.equip;
                    const ammoId = Array.isArray(equip) ? equip[10] : 0; // AMMO slot = 10 (internal index)
                    const ammoMods = resolveAmmoModifiers(specialDef, ammoId);
                    damageMultiplier = ammoMods.damageMultiplier;
                    minDamagePerHit = ammoMods.minDamagePerHit;
                    maxDamagePerHit = ammoMods.maxDamagePerHit;
                    specGraphicId = ammoMods.graphicId;
                    specProjectileId = ammoMods.projectileId;
                    specSoundId = ammoMods.soundId;

                    // Update specialModifiers with correct damage multiplier
                    specialModifiers = {
                        ...specialModifiers,
                        maxHitMultiplier: damageMultiplier,
                    };
                }

                special = {
                    weaponItemId,
                    costPercent: Math.max(1, Math.min(100, costPercent)),
                    accuracyMultiplier: specialDef.accuracyMultiplier,
                    maxHitMultiplier: damageMultiplier,
                    hitCount,
                    forceHit,
                    effects: hasEffects ? effects : undefined,
                    minDamagePerHit,
                    maxDamagePerHit,
                    specGraphicId,
                    specProjectileId,
                    specSoundId,
                    hitSounds: specialDef.hitSounds,
                };
            }
        }

        const basePlan = this.engine.planPlayerAttack(
            {
                player,
                npc,
                attackSpeed: playerAttackSpeed,
                pickNpcHitDelay: ctx.pickNpcHitDelay,
            },
            specialModifiers,
        );
        const plans: PlayerAttackPlan[] = [basePlan];
        if (special && hitCount > 1) {
            const extraModifiers =
                specialModifiers?.forceHit && forceFirstHit
                    ? {
                          accuracyMultiplier: specialModifiers.accuracyMultiplier,
                          maxHitMultiplier: specialModifiers.maxHitMultiplier,
                      }
                    : specialModifiers;
            for (let i = 1; i < hitCount; i++) {
                const extra = this.engine.planPlayerAttack(
                    {
                        player,
                        npc,
                        attackSpeed: playerAttackSpeed,
                        pickNpcHitDelay: ctx.pickNpcHitDelay,
                    },
                    extraModifiers,
                );
                // Multi-hit specials resolve hits on the same impact tick (same hitDelay) in this NPC planner.
                extra.hitDelay = basePlan.hitDelay;
                plans.push(extra);
            }
        }
        if (specialDef?.effects?.quadHit && plans.length >= 4) {
            const firstPlan = plans[0];
            const maxHit = firstPlan?.maxHit !== undefined ? Math.max(0, firstPlan.maxHit) : 0;
            const rolls = plans.slice(0, 4).map((plan) => (plan.hitLanded ? plan.damage : 0));
            const patterned = calculateDragonClawsHits(maxHit, rolls);
            for (let i = 0; i < 4; i++) {
                const dmg = Math.max(0, patterned[i]);
                plans[i].damage = dmg;
                plans[i].hitLanded = dmg > 0;
                plans[i].hitsplatStyle = dmg > 0 ? plans[i].hitsplatStyle : HITMARK_BLOCK;
            }
        }

        // OSRS: Dark bow special attack - enforce min/max damage per hit
        // Even misses deal minimum damage (5 regular, 8 dragon arrows)
        if (special && isDarkBow(weaponItemId) && special.minDamagePerHit !== undefined) {
            for (const plan of plans) {
                const adjustedDamage = applyDarkBowDamageModifiers(
                    plan.damage,
                    special.minDamagePerHit,
                    special.maxDamagePerHit,
                    plan.hitLanded,
                );
                plan.damage = adjustedDamage;
                // Dark bow spec always "hits" due to minimum damage
                if (adjustedDamage > 0) {
                    plan.hitLanded = true;
                    plan.hitsplatStyle = HITMARK_DAMAGE;
                }
            }
        }

        // NOTE: Ranged spot animation (249) is now queued in CombatActionHandler
        // AFTER the ammo check, to prevent animation playing when out of ammo.
        // See: CombatActionHandler.executeCombatAttackAction()
        if (basePlan.attackStyle.kind === "magic") {
            const handlerResult = ctx.onMagicAttack?.({
                player,
                npc,
                plan: basePlan,
                tick: ctx.tick,
            });
            if (handlerResult === false) {
                return { ok: false, hitDelay: 0 };
            }
            // Check for powered staff spell data first (built-in spells)
            const weaponId = player.combatWeaponItemId ?? -1;
            const poweredStaffData = weaponId > 0 ? getPoweredStaffSpellData(weaponId) : undefined;

            // Determine cast spot animation
            let castSpot: number;
            if (poweredStaffData) {
                // Powered staff (Trident, Tumeken's Shadow, etc.)
                castSpot = poweredStaffData.castSpotAnim ?? DEFAULT_MAGIC_CAST_SPOT;
            } else {
                // Regular autocast spell
                const autocastEnabled = player.autocastEnabled;
                const combatSpellId = player.combatSpellId;
                const spellIdForGraphics =
                    autocastEnabled && combatSpellId > 0 ? combatSpellId : undefined;
                const spellData = spellIdForGraphics ? getSpellData(spellIdForGraphics) : undefined;
                castSpot = spellData?.castSpotAnim ?? DEFAULT_MAGIC_CAST_SPOT;
            }

            if (castSpot >= 0) {
                // Cast animation on the player
                ctx.queueSpotAnimation?.({
                    tick: ctx.tick,
                    playerId: player.id,
                    spotId: castSpot,
                    delay: 0,
                    height: 100,
                });
            }
        }
        // OSRS: Melee hits resolve 1 tick after the swing; ranged/magic use projectile travel.
        // Target spot (impact/splash) is emitted at hit execution time in wsServer.
        // Include attackStyleMode for combat XP calculation.
        const combatSpellId = player.combatSpellId;
        const spellId =
            basePlan.attackStyle.kind === "magic" && combatSpellId > 0 ? combatSpellId : undefined;
        const spellDataForXp = spellId ? getSpellData(spellId) : undefined;
        const spellBaseXpAtCast =
            basePlan.attackStyle.kind === "magic" &&
            !!spellDataForXp &&
            spellDataForXp.category === "combat";
        const hits = plans.map((plan) => {
            const expectedHitTick = ctx.tick + Math.max(0, Math.round(plan.hitDelay));
            return {
                npcId: npc.id,
                damage: plan.damage,
                maxHit: plan.maxHit,
                style: plan.hitsplatStyle,
                attackDelay: plan.attackDelay,
                hitDelay: plan.hitDelay,
                // RSMod parity: retaliateDamage calculated at hit confirm, not here
                retaliationDelay: plan.retaliationDelay,
                expectedHitTick,
                landed: !!plan.hitLanded,
                attackType: plan.attackType,
                // Combat XP fields
                attackStyleMode: plan.attackStyle.mode,
                spellId,
                spellBaseXpAtCast,
                ammoEffect: plan.ammoEffect,
            };
        });

        // OSRS: Dark bow fires 2 arrows - add additionalHits from basePlan
        // Reference: docs/projectiles-hitdelay.md
        if (basePlan.additionalHits && basePlan.additionalHits.length > 0) {
            for (const addHit of basePlan.additionalHits) {
                const expectedHitTick = ctx.tick + Math.max(0, Math.round(addHit.hitDelay));
                hits.push({
                    npcId: npc.id,
                    damage: addHit.damage,
                    maxHit: basePlan.maxHit,
                    style: addHit.hitsplatStyle,
                    attackDelay: basePlan.attackDelay,
                    hitDelay: addHit.hitDelay,
                    // No retaliation for additional hits
                    retaliationDelay: 0,
                    expectedHitTick,
                    landed: !!addHit.hitLanded,
                    attackType: basePlan.attackType,
                    attackStyleMode: basePlan.attackStyle.mode,
                    spellId,
                    spellBaseXpAtCast,
                    ammoEffect: undefined, // Ammo effects only for first hit
                });
            }
        }

        const hitData = hits[0];
        const extraHits = hits.length > 1 ? hits.slice(1) : undefined;

        const actionPayload: CombatAttackActionData = {
            npcId: npc.id,
            attackDelay: basePlan.attackDelay,
            hit: hitData,
        };
        if (extraHits) {
            actionPayload.hits = [hitData, ...extraHits];
        }
        if (special) {
            actionPayload.special = special;
        }
        if (basePlan.projectile) {
            actionPayload.projectile = basePlan.projectile;
        }
        // OSRS: Dark bow fires 2 arrows - add additional projectiles
        if (basePlan.additionalHits && basePlan.additionalHits.length > 0) {
            const additionalProjectiles = basePlan.additionalHits
                .filter((hit) => hit.projectile)
                .map((hit) => hit.projectile!);
            if (additionalProjectiles.length > 0) {
                actionPayload.additionalProjectiles = additionalProjectiles;
            }
        }
        const res = this.actionScheduler.requestAction(
            player.id,
            {
                kind: "combat.attack",
                data: actionPayload,
                groups: ["combat.attack"],
                cooldownTicks: Math.max(1, basePlan.attackDelay),
                delayTicks: 0,
            },
            ctx.tick,
        );
        // Notify timing update
        if (res.ok) {
            this.onAttackExecuted(player.id, ctx.tick, playerAttackSpeed);
        }
        // Return hitDelay so retaliation can be timed to when the hit lands
        return { ok: !!res.ok, hitDelay: Math.max(0, basePlan.hitDelay) };
    }

    /**
     * Helper to check if attack should auto-repeat (melee/ranged yes, manual spell no).
     */
    private shouldRepeatAttackInternal(player: PlayerState): boolean {
        // Manual spell casts don't auto-repeat
        const spellId = player.combatSpellId;
        const autocastEnabled = player.autocastEnabled;
        if (spellId > 0 && !autocastEnabled) {
            return false;
        }
        return true;
    }

    private resolveCombatRunMode(player: PlayerState, playerId: number, npcId: number): boolean {
        const interaction = this.playerManager?.getInteractionState(
            this.playerManager.getSocketByPlayerId(playerId),
        ) as { kind?: string; npcId?: number; modifierFlags?: number } | undefined;
        const modifierFlags =
            interaction?.kind === "npcCombat" && interaction.npcId === npcId
                ? interaction.modifierFlags ?? 0
                : 0;
        let run = player.wantsToRun();
        if ((modifierFlags & 1) !== 0) {
            run = !run;
        }
        if (modifierFlags === 3) {
            run = true;
        }
        return player.resolveRequestedRun(run);
    }

    private applyPathSteps(player: PlayerState, steps: { x: number; y: number }[], run: boolean): boolean {
        const normalizedSteps = Array.isArray(steps) ? steps.map((s) => ({ x: s.x, y: s.y })) : [];
        let prevX = player.tileX;
        let prevY = player.tileY;
        for (const step of normalizedSteps) {
            const dx = Math.abs(step.x - prevX);
            const dy = Math.abs(step.y - prevY);
            if (dx > 1 || dy > 1 || (dx === 0 && dy === 0)) {
                return false;
            }
            prevX = step.x;
            prevY = step.y;
        }
        const currentQueue = player.getPathQueue();
        const sameQueue =
            currentQueue.length === normalizedSteps.length &&
            currentQueue.every((step, idx) => {
                const other = normalizedSteps[idx];
                return other && step.x === other.x && step.y === other.y;
            });
        if (sameQueue) {
            player.running = run;
            return false;
        }
        player.setPath(normalizedSteps, run);
        return true;
    }

    private routePlayerToTile(
        player: PlayerState,
        tile: { x: number; y: number },
        pathService: PathService,
        run: boolean,
    ): boolean {
        const rs = new ExactRouteStrategy();
        rs.approxDestX = tile.x;
        rs.approxDestY = tile.y;
        rs.destSizeX = 1;
        rs.destSizeY = 1;
        const res = pathService.findPathSteps(
            {
                from: { x: player.tileX, y: player.tileY, plane: player.level },
                to: tile,
                size: 1,
            },
            { maxSteps: 128, routeStrategy: rs },
        );
        if (!res.ok || !Array.isArray(res.steps)) {
            return false;
        }
        if (res.steps.length === 0 && !rs.hasArrived(player.tileX, player.tileY, player.level)) {
            return false;
        }
        if (res.steps.length === 0) {
            return true;
        }
        this.applyPathSteps(player, res.steps, run);
        return true;
    }

    private isTileWalkable(pathService: PathService, x: number, y: number, level: number): boolean {
        const flag = pathService.getCollisionFlagAt(x, y, level);
        if (flag === undefined) return false;
        const mask = CollisionFlag.OBJECT | CollisionFlag.FLOOR_BLOCKED;
        return (flag & mask) === 0;
    }

    private isWithinAttackDistance(player: PlayerState, npc: NpcState, reach: number): boolean {
        const size = Math.max(1, npc.size);
        const minX = npc.tileX;
        const minY = npc.tileY;
        const maxX = minX + size - 1;
        const maxY = minY + size - 1;
        const clampedX = Math.max(minX, Math.min(player.tileX, maxX));
        const clampedY = Math.max(minY, Math.min(player.tileY, maxY));
        const distance = Math.max(
            Math.abs(player.tileX - clampedX),
            Math.abs(player.tileY - clampedY),
        );
        if (distance === 0) return false;
        return distance <= reach;
    }

    private extractValidatedStrategyPathSteps(
        player: PlayerState,
        res: { ok: boolean; steps?: { x: number; y: number }[]; end?: { x: number; y: number } },
        strategy: RouteStrategy,
    ): { x: number; y: number }[] | undefined {
        if (!res.ok || !Array.isArray(res.steps)) {
            return undefined;
        }
        const selectedEnd =
            res.steps.length > 0
                ? res.end ?? res.steps[res.steps.length - 1]!
                : { x: player.tileX, y: player.tileY };
        if (!strategy.hasArrived(selectedEnd.x, selectedEnd.y, player.level)) {
            return undefined;
        }
        return res.steps;
    }

    private tryRouteToLineOfSight(
        player: PlayerState,
        npc: NpcState,
        reach: number,
        pathService: PathService,
        run: boolean,
    ): boolean {
        if (reach <= 1 || !this.isWithinAttackDistance(player, npc, reach)) {
            return false;
        }
        const npcSize = Math.max(1, npc.size);
        const npcMinX = npc.tileX;
        const npcMinY = npc.tileY;
        const npcMaxX = npcMinX + npcSize - 1;
        const npcMaxY = npcMinY + npcSize - 1;
        const px = player.tileX;
        const py = player.tileY;
        const level = player.level;
        let bestSteps: { x: number; y: number }[] | undefined;
        let bestPathLength = Number.MAX_SAFE_INTEGER;
        let bestPlayerDistance = Number.MAX_SAFE_INTEGER;
        let bestNpcDistance = Number.MAX_SAFE_INTEGER;
        const maxSearchRadius =
            reach +
            Math.max(
                Math.abs(px - npcMinX),
                Math.abs(px - npcMaxX),
                Math.abs(py - npcMinY),
                Math.abs(py - npcMaxY),
            ) +
            1;

        for (let ring = 0; ring <= maxSearchRadius; ring++) {
            for (let dx = -ring; dx <= ring; dx++) {
                const dyAbs = ring - Math.abs(dx);
                const dys = dyAbs === 0 ? [0] : [-dyAbs, dyAbs];
                for (const dy of dys) {
                    const tx = px + dx;
                    const ty = py + dy;
                    if (tx >= npcMinX && tx <= npcMaxX && ty >= npcMinY && ty <= npcMaxY) {
                        continue;
                    }
                    const clampedX = Math.max(npcMinX, Math.min(tx, npcMaxX));
                    const clampedY = Math.max(npcMinY, Math.min(ty, npcMaxY));
                    const distToNpc = Math.max(Math.abs(tx - clampedX), Math.abs(ty - clampedY));
                    if (distToNpc > reach || distToNpc === 0) {
                        continue;
                    }
                    if (!this.isTileWalkable(pathService, tx, ty, level)) {
                        continue;
                    }
                    if (!hasProjectileLineOfSightToNpc(tx, ty, level, npc, pathService)) {
                        continue;
                    }
                    const rs = new ExactRouteStrategy();
                    rs.approxDestX = tx;
                    rs.approxDestY = ty;
                    rs.destSizeX = 1;
                    rs.destSizeY = 1;
                    const res = pathService.findPathSteps(
                        {
                            from: { x: player.tileX, y: player.tileY, plane: player.level },
                            to: { x: tx, y: ty },
                            size: 1,
                        },
                        { maxSteps: 128, routeStrategy: rs },
                    );
                    const steps = this.extractValidatedStrategyPathSteps(player, res, rs);
                    if (!steps) {
                        continue;
                    }
                    const pathLength = steps.length;
                    const playerDistance = Math.abs(dx) + Math.abs(dy);
                    if (
                        pathLength < bestPathLength ||
                        (pathLength === bestPathLength && playerDistance < bestPlayerDistance) ||
                        (pathLength === bestPathLength &&
                            playerDistance === bestPlayerDistance &&
                            distToNpc < bestNpcDistance)
                    ) {
                        bestSteps = steps;
                        bestPathLength = pathLength;
                        bestPlayerDistance = playerDistance;
                        bestNpcDistance = distToNpc;
                    }
                }
            }
        }
        if (!bestSteps) return false;
        if (bestSteps.length === 0) {
            player.clearPath();
            return true;
        }
        this.applyPathSteps(player, bestSteps, run);
        return true;
    }

    private routePlayerToNpc(
        player: PlayerState,
        npc: NpcState,
        reach: number,
        pathService: PathService,
        run: boolean,
    ): boolean {
        const normalizedReach = Math.max(1, reach);
        const attackType = resolvePlayerAttackType(player);
        const strategy =
            normalizedReach <= 1
                ? new CardinalAdjacentRouteStrategy(
                      npc.tileX,
                      npc.tileY,
                      Math.max(1, npc.size),
                      Math.max(1, npc.size),
                  )
                : attackType !== "melee"
                  ? new RectWithinRangeLineOfSightRouteStrategy(
                        npc.tileX,
                        npc.tileY,
                        Math.max(1, npc.size),
                        Math.max(1, npc.size),
                        normalizedReach,
                    )
                  : new RectWithinRangeRouteStrategy(
                        npc.tileX,
                        npc.tileY,
                        Math.max(1, npc.size),
                        Math.max(1, npc.size),
                        normalizedReach,
                    );
        if (strategy instanceof CardinalAdjacentRouteStrategy) {
            strategy.setCollisionGetter((x, y, p) => pathService.getCollisionFlagAt(x, y, p), player.level);
        } else if (strategy instanceof RectWithinRangeLineOfSightRouteStrategy) {
            strategy.setProjectileRaycast((from, to) => pathService.projectileRaycast(from, to));
        }
        const res = pathService.findPathSteps(
            {
                from: { x: player.tileX, y: player.tileY, plane: player.level },
                to: { x: npc.tileX, y: npc.tileY },
                size: 1,
            },
            { routeStrategy: strategy, maxSteps: 128 },
        );
        const steps = this.extractValidatedStrategyPathSteps(player, res, strategy);
        if (!steps) return false;
        if (steps.length === 0) {
            player.clearPath();
            return true;
        }
        this.applyPathSteps(player, steps, run);
        return true;
    }

    private isWithinAttackReachForMovement(
        player: PlayerState,
        npc: NpcState,
        reach: number,
        pathService: PathService,
    ): boolean {
        const inRange = isWithinAttackRange(player, npc, reach);
        if (!inRange) return false;
        if (reach <= 1) {
            return hasDirectMeleeReach(player, npc, pathService);
        }
        const resolvedAttackType =
            normalizeAttackType(player.getCurrentAttackType?.()) ?? resolvePlayerAttackType(player);
        if (resolvedAttackType === "melee") {
            return hasDirectMeleePath(player, npc, pathService);
        }
        return hasProjectileLineOfSightToNpc(player.tileX, player.tileY, player.level, npc, pathService);
    }

    /**
     * Build full isWithinAttackReach implementation with LoS checks.
     */
    private buildIsWithinAttackReachFn(
        ctx: PlayerCombatManagerContext,
    ): (player: PlayerState, npc: NpcState, reach: number) => boolean {
        if (ctx.isWithinAttackReach) {
            return ctx.isWithinAttackReach;
        }
        return (player: PlayerState, npc: NpcState, reach: number): boolean => {
            const inRange = isWithinAttackRange(player, npc, reach);
            if (!inRange) return false;
            if (reach <= 1 && ctx.pathService) {
                return hasDirectMeleeReach(player, npc, ctx.pathService);
            }
            if (reach > 1 && ctx.pathService) {
                const resolvedAttackType =
                    normalizeAttackType(player.getCurrentAttackType?.()) ??
                    resolvePlayerAttackType(player);
                if (resolvedAttackType === "melee") {
                    return hasDirectMeleePath(player, npc, ctx.pathService);
                }
            }
            return true;
        };
    }

    /**
     * Build hasLineOfSight function with pathService.
     */
    private buildHasLineOfSightFn(
        ctx: PlayerCombatManagerContext,
    ): ((player: PlayerState, npc: NpcState) => boolean) | undefined {
        if (ctx.hasLineOfSight) {
            return ctx.hasLineOfSight;
        }
        if (ctx.pathService) {
            return (player: PlayerState, npc: NpcState): boolean => {
                return hasProjectileLineOfSightToNpc(
                    player.tileX,
                    player.tileY,
                    player.level,
                    npc,
                    ctx.pathService!,
                );
            };
        }
        return undefined;
    }

    /**
     * Build internal context for processTick that adds scheduling functions.
     * This wraps the external context with internal implementations.
     */
    private buildInternalContext(ctx: PlayerCombatManagerContext): PlayerCombatManagerContext {
        const isWithinAttackReach = this.buildIsWithinAttackReachFn(ctx);
        const hasLineOfSight = this.buildHasLineOfSightFn(ctx);

        return {
            ...ctx,
            playerLookup: ctx.playerLookup ?? ((id) => this.playerManager?.getPlayerById(id)),
            getDistanceToNpc:
                ctx.getDistanceToNpc ?? ((player, npc) => distanceToNpcBounds(player, npc)),
            isWithinAttackReach,
            hasLineOfSight,
            isPlayerFrozen: ctx.isPlayerFrozen ?? ((player, tick) => player.isFrozen(tick)),
            schedulePlayerAttack:
                ctx.schedulePlayerAttack ??
                ((player, npc, attackSpeed) => {
                    return this.schedulePlayerAttackInternal(player, npc, attackSpeed, ctx);
                }),
            shouldRepeatAttack:
                ctx.shouldRepeatAttack ?? ((player) => this.shouldRepeatAttackInternal(player)),
        };
    }
}

/**
 * Create a new player combat manager instance.
 */
export function createPlayerCombatManager(opts?: {
    scheduler?: ActionScheduler;
    players?: PlayerManager;
    randomSeed?: number;
}): PlayerCombatManager {
    return new PlayerCombatManager(opts);
}
