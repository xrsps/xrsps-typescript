import { Actor } from "./actor";
import type { AttackType } from "./combat/AttackType";
import {
    DEFAULT_DISEASE_INTERVAL_TICKS,
    DEFAULT_POISON_INTERVAL_TICKS,
    DEFAULT_REGEN_INTERVAL_TICKS,
    DEFAULT_VENOM_INTERVAL_TICKS,
    HITMARK_DISEASE,
    HITMARK_POISON,
    HITMARK_REGEN,
    HITMARK_VENOM,
    StatusHitsplat,
} from "./combat/HitEffects";
import { AGGRESSION_TIMER_TICKS, TARGET_SEARCH_INTERVAL } from "./combat/NpcCombatAI";
import { ACTIVE_COMBAT_TIMER_TICKS } from "./model/timer";

/**
 * RSMod parity: NPC random walk timer range.
 * NPCs attempt to roam every 15-30 ticks when idle.
 * Reference: npc_random_walk.plugin.kts SEARCH_FOR_PATH_DELAY = 15..30
 */
export const ROAM_DELAY_MIN_TICKS = 15;
export const ROAM_DELAY_MAX_TICKS = 30;
export const DEFAULT_NPC_WANDER_RADIUS = 5;

/**
 * OSRS: How long an NPC can be blocked/stuck before resetting to spawn.
 * Typical value is around 100 ticks (60 seconds).
 */
export const NPC_STUCK_RESET_TICKS = 100;

/**
 * OSRS Flinch Mechanics:
 * When attacking an NPC that is out of combat, there is a "flinch window" where
 * the NPC cannot retaliate immediately. Formula: floor(attack_speed / 2) + 8 ticks
 * After the flinch window + combat timeout, the NPC can be flinched again.
 */
export const FLINCH_BASE_TICKS = 8;

/**
 * NPC combat profile with all fields resolved (no optionals).
 * This is the "source of truth" for NPC combat stats - loaded once at spawn.
 */
export interface NpcCombatProfile {
    /** Levels */
    attackLevel: number;
    strengthLevel: number;
    defenceLevel: number;
    magicLevel: number;
    rangedLevel: number;
    /** Offensive bonuses */
    attackBonus: number;
    strengthBonus: number;
    magicBonus: number;
    rangedBonus: number;
    /** Defensive bonuses */
    defenceStab: number;
    defenceSlash: number;
    defenceCrush: number;
    defenceMagic: number;
    defenceRanged: number;
    /** Combat stats */
    maxHit: number;
    attackSpeed: number;
    attackType: AttackType;
    /** Metadata */
    species: string[];
}

/**
 * Default combat profile for NPCs without stats defined.
 * Represents a very weak level 1 NPC.
 */
export const DEFAULT_NPC_COMBAT_PROFILE: NpcCombatProfile = {
    attackLevel: 1,
    strengthLevel: 1,
    defenceLevel: 1,
    magicLevel: 1,
    rangedLevel: 1,
    attackBonus: 0,
    strengthBonus: 0,
    magicBonus: 0,
    rangedBonus: 0,
    defenceStab: 0,
    defenceSlash: 0,
    defenceCrush: 0,
    defenceMagic: 0,
    defenceRanged: 0,
    maxHit: 1,
    attackSpeed: 4,
    attackType: "melee",
    species: [],
};

export interface NpcSpawnConfig {
    id: number;
    name?: string;
    x: number;
    y: number;
    level: number;
    wanderRadius?: number;
    direction?: number;
    /** Server-authored HealthBarDefinition id (HIT_MASK). Defaults to 0. */
    healthBarDefId?: number;
}

export interface NpcFollowerState {
    ownerPlayerId: number;
    itemId: number;
}

type PoisonEffectState = {
    potency: number;
    nextTick: number;
    interval: number;
    hitsSinceDecrease: number;
};

type VenomEffectState = {
    stage: number;
    nextTick: number;
    interval: number;
    ramp: number;
    cap: number;
};

type DiseaseEffectState = {
    potency: number;
    nextTick: number;
    interval: number;
};

type RegenerationEffectState = {
    heal: number;
    remainingTicks: number;
    nextTick: number;
    interval: number;
};

export class NpcState extends Actor {
    readonly typeId: number;
    readonly name?: string;
    readonly spawnX: number;
    readonly spawnY: number;
    readonly spawnLevel: number;
    readonly idleSeqId: number;
    readonly walkSeqId: number;
    readonly rotationSpeed: number;
    readonly wanderRadius: number;
    /**
     * NPC attack speed in ticks. Loaded from cache param 14.
     * OSRS parity: Most NPCs are 4 ticks, dragons are 6, some bosses vary.
     * Default fallback is 4 if not found in cache.
     */
    readonly attackSpeed: number;
    /**
     * Whether this NPC is aggressive (will attack nearby players).
     * Derived from cache: NPCs with combat level > 0 and "Attack" action.
     */
    readonly isAggressive: boolean;
    /**
     * Aggression radius in tiles. NPCs will target players within this range.
     * OSRS default is typically 3 tiles.
     */
    readonly aggressionRadius: number;
    /**
     * Ticks before this NPC becomes tolerant to a player remaining in the same area.
     * RSMod default is 1000 ticks (10 minutes) when no npc-specific override exists.
     */
    readonly aggressionToleranceTicks: number;
    /**
     * Ticks between aggression target searches.
     * RSMod uses npc.combatDef.aggroTargetDelay for this.
     */
    readonly aggressionSearchDelayTicks: number;
    /**
     * Combat profile with all stats resolved. Source of truth for combat calculations.
     * Loaded at spawn time - no runtime lookups needed.
     */
    readonly combat: NpcCombatProfile;
    private hitpoints: number;
    private maxHitpoints: number;
    private combatLevel: number;
    private attackType?: AttackType;
    /** Tick when this NPC can next attack (for aggression-initiated combat) */
    private nextAttackTick: number = 0;

    private combatTargetPlayerId?: number;
    private combatTimeoutTick: number = 0;
    /** Tick when NPC was last hit (for flinch mechanics) */
    private lastHitTick: number = 0;
    /** RSMod parity: Timer-based roaming - tick when next roam attempt can occur */
    private nextRoamTick: number = 0;
    /** RSMod parity: aggressive NPCs search for new targets on a timer, not every tick. */
    private nextAggressionCheckTick: number = 0;
    /** True while the NPC is committed to returning to its spawn tile. */
    private returningToSpawn: boolean = false;
    /** Tracks consecutive ticks NPC has been blocked from moving */
    private stuckTicks: number = 0;
    /** Last tick the NPC successfully moved */
    private lastMoveTick: number = 0;

    private poisonEffect?: PoisonEffectState;
    private venomEffect?: VenomEffectState;
    private diseaseEffect?: DiseaseEffectState;
    private regenEffect?: RegenerationEffectState;
    private freezeExpiryTick: number = 0;
    /** OSRS: 5 tick immunity after freeze ends */
    private freezeImmunityUntilTick: number = 0;
    private deadUntilTick: number = 0;
    private readonly healthBarDefId: number;
    /** Flag to force a sync update to clients (e.g., when path is cleared during combat) */
    private forceSyncUpdate: boolean = false;
    private followerState?: NpcFollowerState;

    constructor(
        id: number,
        typeId: number,
        size: number,
        idleSeqId: number,
        walkSeqId: number,
        rotationSpeed: number,
        spawn: { x: number; y: number; level: number },
        options: {
            name?: string;
            wanderRadius?: number;
            maxHitpoints?: number;
            combatLevel?: number;
            attackType?: AttackType;
            healthBarDefId?: number;
            /** Attack speed in ticks. Loaded from cache param 14. Default: 4 */
            attackSpeed?: number;
            /** Whether this NPC is aggressive. Default: false */
            isAggressive?: boolean;
            /** Aggression radius in tiles. Default: 3 */
            aggressionRadius?: number;
            /** Tolerance timer in ticks before this NPC stops auto-aggroing a player. */
            aggressionToleranceTicks?: number;
            /** Delay in ticks between aggro target searches. */
            aggressionSearchDelayTicks?: number;
            /** Combat profile with all stats. If not provided, uses DEFAULT_NPC_COMBAT_PROFILE */
            combatProfile?: NpcCombatProfile;
        } = {},
    ) {
        super(id, spawn.x, spawn.y, spawn.level, size);
        this.typeId = typeId;
        this.name = options.name;
        this.spawnX = spawn.x;
        this.spawnY = spawn.y;
        this.spawnLevel = spawn.level;
        this.idleSeqId = idleSeqId;
        this.walkSeqId = walkSeqId;
        this.rotationSpeed = Math.max(1, rotationSpeed);
        // Allow wanderRadius=0 so spawns can explicitly opt out of roaming
        this.wanderRadius = Math.max(0, options.wanderRadius ?? DEFAULT_NPC_WANDER_RADIUS);
        const maxHp = Math.max(1, options.maxHitpoints ?? 10);
        this.maxHitpoints = maxHp;
        this.hitpoints = maxHp;
        this.combatLevel =
            options.combatLevel !== undefined && Number.isFinite(options.combatLevel)
                ? options.combatLevel
                : -1;
        this.attackType = options.attackType;
        this.healthBarDefId = Math.max(0, options.healthBarDefId ?? 0);
        // OSRS parity: Attack speed from cache param 14, default 4 ticks
        this.attackSpeed = Math.max(1, options.attackSpeed ?? 4);
        // Aggression: default false unless explicitly set
        this.isAggressive = options.isAggressive ?? false;
        // OSRS default aggression radius is typically 3 tiles
        this.aggressionRadius = Math.max(0, options.aggressionRadius ?? 3);
        this.aggressionToleranceTicks = Math.trunc(
            options.aggressionToleranceTicks ?? AGGRESSION_TIMER_TICKS,
        );
        this.aggressionSearchDelayTicks = Math.max(
            1,
            Math.trunc(options.aggressionSearchDelayTicks ?? TARGET_SEARCH_INTERVAL),
        );
        // Combat profile - use provided or default
        this.combat = options.combatProfile ?? DEFAULT_NPC_COMBAT_PROFILE;

        this.setTurnSpeed(this.rotationSpeed);

        if (this.idleSeqId >= 0) {
            this.anim.idle = this.idleSeqId;
            this.anim.turnLeft = this.idleSeqId;
            this.anim.turnRight = this.idleSeqId;
        }
        if (this.walkSeqId >= 0) {
            this.anim.walk = this.walkSeqId;
            this.anim.walkBack = this.walkSeqId;
            this.anim.walkLeft = this.walkSeqId;
            this.anim.walkRight = this.walkSeqId;
        }

        this.rot = 0;
        this.orientation = this.rot;
    }

    override getHealthBarDefinitionId(): number {
        return this.healthBarDefId;
    }

    setFollowerState(ownerPlayerId: number, itemId: number): void {
        this.followerState = {
            ownerPlayerId: ownerPlayerId | 0,
            itemId: itemId | 0,
        };
    }

    clearFollowerState(): void {
        this.followerState = undefined;
    }

    getFollowerState(): NpcFollowerState | undefined {
        return this.followerState;
    }

    isPlayerFollower(): boolean {
        return this.followerState !== undefined;
    }

    /**
     * Apply a freeze effect to this NPC.
     * OSRS: Cannot be frozen while immune (5 ticks after previous freeze ends).
     */
    applyFreeze(durationTicks: number, currentTick: number): boolean {
        // Check freeze immunity (5 ticks after previous freeze)
        if (currentTick < this.freezeImmunityUntilTick) {
            return false; // Immune to freeze
        }

        const expires = Math.max(this.freezeExpiryTick, currentTick + Math.max(1, durationTicks));
        this.freezeExpiryTick = expires;
        this.lockMovementUntil(expires);
        this.clearPath();
        return true;
    }

    isFrozen(currentTick: number): boolean {
        if (this.freezeExpiryTick > 0 && currentTick >= this.freezeExpiryTick) {
            // Freeze just ended - start 5 tick immunity
            this.freezeImmunityUntilTick = currentTick + 5;
            this.freezeExpiryTick = 0;
            return false;
        }
        return this.freezeExpiryTick > currentTick;
    }

    isFreezeImmune(currentTick: number): boolean {
        return currentTick < this.freezeImmunityUntilTick;
    }

    resetToSpawn(): void {
        this.teleport(this.spawnX, this.spawnY, this.spawnLevel);
        this.rot = 0;
        this.orientation = this.rot;
        this.deadUntilTick = 0;
        this.combatTargetPlayerId = undefined;
        this.combatTimeoutTick = 0;
        this.lastHitTick = 0;
        this.stuckTicks = 0;
        this.lastMoveTick = 0;
        this.nextAttackTick = 0;
        this.nextRoamTick = 0; // RSMod parity: Allow roaming immediately after respawn
        this.nextAggressionCheckTick = 0;
        this.clearInteractionTarget();
        this.clearPendingSeqs();
        this.hitpoints = this.maxHitpoints;
        this.poisonEffect = undefined;
        this.venomEffect = undefined;
        this.diseaseEffect = undefined;
        this.regenEffect = undefined;
        this.freezeExpiryTick = 0;
        this.freezeImmunityUntilTick = 0;
        this.returningToSpawn = false;
    }

    beginSpawnRecovery(): void {
        this.returningToSpawn = true;
    }

    stopSpawnRecovery(): void {
        this.returningToSpawn = false;
    }

    isRecoveringToSpawn(): boolean {
        return this.returningToSpawn;
    }

    /**
     * Check if this NPC can perform an attack on the current tick.
     * Used for both retaliation and aggression-initiated attacks.
     */
    canAttack(currentTick: number): boolean {
        return currentTick >= this.nextAttackTick;
    }

    /**
     * Record that this NPC performed an attack, setting the cooldown.
     */
    recordAttack(currentTick: number): void {
        this.nextAttackTick = currentTick + this.attackSpeed;
        this.combatTimeoutTick = currentTick + ACTIVE_COMBAT_TIMER_TICKS;
    }

    /**
     * Get the tick when this NPC can next attack.
     */
    getNextAttackTick(): number {
        return this.nextAttackTick;
    }

    /**
     * Set the tick when this NPC can next attack.
     * Used for retaliation delay which uses a different formula than normal attacks.
     */
    setNextAttackTick(tick: number): void {
        this.nextAttackTick = tick;
    }

    /**
     * Get the NPC's combat level for aggression checks.
     * Returns 0 if not a combat NPC.
     */
    getCombatLevel(): number {
        const lvl = this.combatLevel;
        return lvl > 0 ? lvl : 0;
    }

    markDeadUntil(despawnTick: number, currentTick: number): void {
        const until = Math.max(0, despawnTick);
        this.deadUntilTick = until;
        this.hitpoints = 0;
        this.combatTargetPlayerId = undefined;
        this.combatTimeoutTick = 0;
        this.clearPath();
        this.clearInteractionTarget();
        this.clearPendingSeqs();
        this.poisonEffect = undefined;
        this.venomEffect = undefined;
        this.diseaseEffect = undefined;
        this.regenEffect = undefined;
        this.freezeExpiryTick = 0;
        this.freezeImmunityUntilTick = 0;
        this.lockMovementUntil(until);
        // Ensure we don't get random roam paths while dying.
        this.forceSyncUpdate = true;
        // Force a sync if this is set mid-tick.
        this.setMovementTick(currentTick);
    }

    isDead(currentTick: number): boolean {
        const until = this.deadUntilTick;
        return until > 0 && currentTick < until;
    }

    /**
     * Returns true if this NPC is stationary (should not move).
     * In OSRS, NPCs are stationary when their walk and idle animations are the same.
     */
    isStationary(): boolean {
        return this.walkSeqId === this.idleSeqId && this.walkSeqId !== -1 && this.idleSeqId !== -1;
    }

    engageCombat(playerId: number, currentTick: number): void {
        if (this.returningToSpawn) return;
        if (this.isDead(currentTick) || this.hitpoints <= 0) return;
        const normalized = playerId;
        const changedTarget = this.combatTargetPlayerId !== normalized;
        this.combatTargetPlayerId = normalized;
        // OSRS parity: ACTIVE_COMBAT_TIMER = 17 ticks (10.2 seconds)
        this.combatTimeoutTick = currentTick + ACTIVE_COMBAT_TIMER_TICKS;
        // Face the combat target immediately (RSMod/OSRS behavior while chasing/attacking).
        this.setInteraction("player", normalized);
        // Only clear roaming path when first entering combat or switching targets.
        if (changedTarget) {
            // If NPC was walking, force a sync update so client knows it stopped
            if (this.hasPath()) {
                this.forceSyncUpdate = true;
            }
            this.clearPath();
        }
    }

    tickCombat(
        currentTick: number,
        playerLookup?: (
            playerId: number,
        ) => { tileX: number; tileY: number; level: number } | undefined,
    ): void {
        if (this.isDead(currentTick) || this.hitpoints <= 0) return;
        if (this.combatTargetPlayerId === undefined) {
            return;
        }
        if (currentTick > this.combatTimeoutTick) {
            // OSRS parity: drop stale combat after the active-combat window expires
            // so NPCs do not chase forever without any recent combat activity.
            this.disengageCombat();
            this.scheduleNextAggressionCheck(currentTick);
            return;
        }

        // If playerLookup is provided, verify player is still in range and visible
        if (playerLookup) {
            const player = this.resolveCombatTargetPlayer(playerLookup);
            if (!player) {
                // Player vanished, moved planes, or ran beyond the hard chase limit.
                this.disengageCombat();
                return;
            }
        }
    }

    isInCombat(currentTick: number): boolean {
        return this.combatTargetPlayerId !== undefined && currentTick <= this.combatTimeoutTick;
    }

    getCombatTargetPlayerId(): number | undefined {
        return this.combatTargetPlayerId;
    }

    resolveCombatTargetPlayer(
        playerLookup?: (
            playerId: number,
        ) => { tileX: number; tileY: number; level: number } | undefined,
    ): { tileX: number; tileY: number; level: number } | undefined {
        if (this.combatTargetPlayerId === undefined || !playerLookup) {
            return undefined;
        }
        const player = playerLookup(this.combatTargetPlayerId);
        if (!player) {
            return undefined;
        }
        if (player.level !== this.level) {
            return undefined;
        }

        // OSRS: NPCs disengage if the target moves more than 32 tiles away.
        const dx = Math.abs(player.tileX - this.tileX);
        const dy = Math.abs(player.tileY - this.tileY);
        const distance = Math.max(dx, dy);
        return distance <= 32 ? player : undefined;
    }

    /**
     * Disengage from combat (clear target without death).
     * Used for explicit combat resets (e.g., scripted transitions).
     */
    disengageCombat(): void {
        this.disengageCombatInternal(true);
    }

    disengageCombatPreservingInteraction(): void {
        this.disengageCombatInternal(false);
    }

    private disengageCombatInternal(clearInteraction: boolean): void {
        const hadPath = this.hasPath();
        this.combatTargetPlayerId = undefined;
        this.combatTimeoutTick = 0;
        if (hadPath) {
            this.forceSyncUpdate = true;
        }
        this.clearPath();
        if (clearInteraction) {
            this.clearInteractionTarget();
        }
    }

    /**
     * Record that the NPC was hit, updating flinch tracking.
     * Call this whenever damage is applied to the NPC.
     */
    recordHit(currentTick: number): void {
        this.lastHitTick = currentTick;
    }

    /**
     * RSMod parity: Check if NPC is facing/targeting a pawn.
     * NPCs won't roam while they have an interaction target (facing a player/npc).
     * Reference: npc_random_walk.plugin.kts FACING_PAWN_ATTR check
     */
    isFacingPawn(): boolean {
        const target = this.getInteractionTarget();
        if (!target) return false;
        // RSMod considers "player" and "npc" as pawns
        return target.type === "player" || target.type === "npc";
    }

    /**
     * RSMod parity: Check if roam timer has elapsed.
     * Returns true if current tick >= nextRoamTick.
     */
    isRoamTimerReady(currentTick: number): boolean {
        return currentTick >= this.nextRoamTick;
    }

    /**
     * RSMod parity: Schedule next roam attempt.
     * Sets nextRoamTick to currentTick + random(15..30).
     * Reference: npc_random_walk.plugin.kts SEARCH_FOR_PATH_DELAY = 15..30
     */
    scheduleNextRoam(currentTick: number): void {
        const delay =
            ROAM_DELAY_MIN_TICKS +
            Math.floor(Math.random() * (ROAM_DELAY_MAX_TICKS - ROAM_DELAY_MIN_TICKS + 1));
        this.nextRoamTick = currentTick + delay;
    }

    isAggressionCheckReady(currentTick: number): boolean {
        return currentTick >= this.nextAggressionCheckTick;
    }

    scheduleNextAggressionCheck(
        currentTick: number,
        delayTicks: number = this.aggressionSearchDelayTicks,
    ): void {
        this.nextAggressionCheckTick = currentTick + Math.max(1, delayTicks);
    }

    /**
     * RSMod parity: Check if this NPC is eligible to start a new idle roam.
     * Reference: npc_random_walk.plugin.kts
     *
     * Conditions:
     * - Roam timer has elapsed
     * - Can move (not locked)
     * - Not facing a pawn (no interaction target)
     * - Not dead
     * - Not already moving
     * - Not stationary NPC
     * - Has wander radius > 0
     */
    canRoam(currentTick: number): boolean {
        if (!this.isRoamTimerReady(currentTick)) {
            return false;
        }
        if (this.isDead(currentTick)) {
            return false;
        }
        if (this.hasPath()) {
            return false;
        }
        const interaction = this.getInteractionTarget();
        if (interaction && (interaction.type === "player" || interaction.type === "npc")) {
            return false;
        }
        if (this.isStationary()) {
            return false;
        }
        if (this.wanderRadius <= 0) {
            return false;
        }
        return true;
    }

    /**
     * OSRS Flinch Mechanics:
     * When an NPC is not in combat and is hit, there's a flinch window where
     * the NPC cannot retaliate. Formula: floor(attack_speed / 2) + 8 ticks
     *
     * The NPC can be "flinched" if:
     * 1. It was not in combat when first hit
     * 2. Enough time has passed since the last flinch window
     *
     * @returns The tick when the NPC can first retaliate after being flinched
     */
    getFlinchWindowEndTick(currentTick: number): number {
        // OSRS formula: floor(attack_speed / 2) + 8 ticks
        const flinchDuration = Math.floor(this.attackSpeed / 2) + FLINCH_BASE_TICKS;
        return this.lastHitTick + flinchDuration;
    }

    /**
     * Check if the NPC is currently in a flinch state (cannot retaliate yet).
     * Only applicable if the NPC was out of combat when hit.
     */
    isInFlinchWindow(currentTick: number): boolean {
        if (this.lastHitTick <= 0) return false;
        return currentTick < this.getFlinchWindowEndTick(currentTick);
    }

    /**
     * Check if the NPC has been displaced outside its idle roam area.
     * This is used for home recovery when an NPC has been lured beyond its roam area.
     */
    isOutsideRoamArea(): boolean {
        return this.isTileOutsideRoamArea(this.tileX, this.tileY);
    }

    isTileOutsideRoamArea(tileX: number, tileY: number): boolean {
        const dx = Math.abs(tileX - this.spawnX);
        const dy = Math.abs(tileY - this.spawnY);
        const distance = Math.max(dx, dy); // Chebyshev distance
        return distance > this.wanderRadius;
    }

    /**
     * Backwards-compatible alias for older call sites using the data field name.
     */
    isOutsideWanderRadius(): boolean {
        return this.isOutsideRoamArea();
    }

    isTileOutsideWanderRadius(tileX: number, tileY: number): boolean {
        return this.isTileOutsideRoamArea(tileX, tileY);
    }

    /**
     * Record that the NPC successfully moved this tick.
     */
    recordMovement(currentTick: number): void {
        this.stuckTicks = 0;
        this.lastMoveTick = currentTick;
    }

    /**
     * Record that the NPC failed to move this tick (was blocked).
     * OSRS: NPCs reset to spawn if blocked too long.
     */
    recordBlocked(): void {
        this.stuckTicks++;
    }

    /**
     * Check if NPC has been stuck/blocked for too long and should reset.
     * OSRS: NPCs teleport back to spawn if blocked for extended duration.
     */
    shouldResetDueToStuck(): boolean {
        return this.stuckTicks >= NPC_STUCK_RESET_TICKS;
    }

    /**
     * Get the number of consecutive ticks the NPC has been stuck.
     */
    getStuckTicks(): number {
        return this.stuckTicks;
    }

    /**
     * Check if the NPC needs a forced sync update to clients.
     * This is set when the NPC's path is cleared (e.g., entering combat).
     */
    needsForcedSync(): boolean {
        return this.forceSyncUpdate;
    }

    /**
     * Consume the forced sync flag, returning its value and resetting it.
     */
    consumeForcedSync(): boolean {
        const val = this.forceSyncUpdate;
        this.forceSyncUpdate = false;
        return val;
    }

    getHitpoints(): number {
        return this.hitpoints;
    }

    getAttackType(): AttackType | undefined {
        return this.attackType;
    }

    getMaxHitpoints(): number {
        return this.maxHitpoints;
    }

    applyDamage(amount: number): { current: number; max: number } {
        if (this.deadUntilTick > 0) {
            return { current: this.hitpoints, max: this.maxHitpoints };
        }
        if (amount > 0) {
            this.hitpoints = Math.max(0, this.hitpoints - amount);
        }
        return { current: this.hitpoints, max: this.maxHitpoints };
    }

    heal(amount: number): { current: number; max: number } {
        if (this.deadUntilTick > 0) {
            return { current: this.hitpoints, max: this.maxHitpoints };
        }
        if (amount > 0) {
            this.hitpoints = Math.min(this.maxHitpoints, this.hitpoints + amount);
        }
        return { current: this.hitpoints, max: this.maxHitpoints };
    }

    inflictPoison(
        potency: number,
        currentTick: number,
        interval: number = DEFAULT_POISON_INTERVAL_TICKS,
    ): void {
        const nextPotency = Math.max(1, Math.floor(potency));
        if (!this.poisonEffect || nextPotency > this.poisonEffect.potency) {
            this.poisonEffect = {
                potency: nextPotency,
                interval: Math.max(1, interval),
                nextTick: currentTick + Math.max(1, interval),
                hitsSinceDecrease: 0,
            };
        } else {
            this.poisonEffect.nextTick = Math.min(
                this.poisonEffect.nextTick,
                currentTick + Math.max(1, interval),
            );
        }
    }

    curePoison(): void {
        this.poisonEffect = undefined;
    }

    inflictVenom(
        stage: number,
        currentTick: number,
        interval: number = DEFAULT_VENOM_INTERVAL_TICKS,
        ramp: number = 2,
        cap: number = 20,
    ): void {
        const nextStage = Math.max(1, Math.floor(stage));
        const effect = this.venomEffect;
        const effectiveRamp = Math.max(1, Math.floor(ramp));
        const effectiveCap = Math.max(nextStage, Math.floor(cap));
        if (!effect || nextStage > effect.stage) {
            this.venomEffect = {
                stage: nextStage,
                interval: Math.max(1, interval),
                nextTick: currentTick + Math.max(1, interval),
                ramp: effectiveRamp,
                cap: effectiveCap,
            };
        } else {
            effect.nextTick = Math.min(effect.nextTick, currentTick + Math.max(1, interval));
            effect.ramp = effectiveRamp;
            effect.cap = effectiveCap;
        }
    }

    cureVenom(): void {
        this.venomEffect = undefined;
    }

    inflictDisease(
        potency: number,
        currentTick: number,
        interval: number = DEFAULT_DISEASE_INTERVAL_TICKS,
    ): void {
        const nextPotency = Math.max(1, Math.floor(potency));
        if (!this.diseaseEffect || nextPotency > this.diseaseEffect.potency) {
            this.diseaseEffect = {
                potency: nextPotency,
                interval: Math.max(1, interval),
                nextTick: currentTick + Math.max(1, interval),
            };
        } else {
            this.diseaseEffect.nextTick = Math.min(
                this.diseaseEffect.nextTick,
                currentTick + Math.max(1, interval),
            );
        }
    }

    cureDisease(): void {
        this.diseaseEffect = undefined;
    }

    startRegeneration(
        heal: number,
        durationTicks: number,
        currentTick: number,
        interval: number = DEFAULT_REGEN_INTERVAL_TICKS,
    ): void {
        const healAmount = Math.max(1, Math.floor(heal));
        const duration = Math.max(1, Math.floor(durationTicks));
        this.regenEffect = {
            heal: healAmount,
            remainingTicks: duration,
            interval: Math.max(1, interval),
            nextTick: currentTick + Math.max(1, interval),
        };
    }

    stopRegeneration(): void {
        this.regenEffect = undefined;
    }

    tickStatusEffects(currentTick: number): StatusHitsplat[] | undefined {
        if (this.isDead(currentTick) || this.hitpoints <= 0) {
            this.poisonEffect = undefined;
            this.venomEffect = undefined;
            this.diseaseEffect = undefined;
            this.regenEffect = undefined;
            return undefined;
        }
        const events: StatusHitsplat[] = [];
        const poison = this.processPoison(currentTick);
        if (poison) events.push(poison);
        const venom = this.processVenom(currentTick);
        if (venom) events.push(venom);
        const disease = this.processDisease(currentTick);
        if (disease) events.push(disease);
        const regen = this.processRegeneration(currentTick);
        if (regen) events.push(regen);
        return events.length > 0 ? events : undefined;
    }

    private processPoison(currentTick: number): StatusHitsplat | undefined {
        const effect = this.poisonEffect;
        if (!effect) return undefined;
        if (this.hitpoints <= 0) {
            this.poisonEffect = undefined;
            return undefined;
        }
        if (currentTick < effect.nextTick) return undefined;
        const amount = Math.max(1, Math.floor(effect.potency));
        const result = this.applyDamage(amount);
        // OSRS: Poison potency only decreases every 5 hits
        effect.hitsSinceDecrease++;
        if (effect.hitsSinceDecrease >= 5) {
            effect.potency = Math.max(0, effect.potency - 1);
            effect.hitsSinceDecrease = 0;
        }
        if (effect.potency <= 0 || result.current <= 0) {
            this.poisonEffect = undefined;
        } else {
            effect.nextTick = currentTick + effect.interval;
        }
        return {
            style: HITMARK_POISON,
            amount,
            hpCurrent: result.current,
            hpMax: result.max,
        };
    }

    private processVenom(currentTick: number): StatusHitsplat | undefined {
        const effect = this.venomEffect;
        if (!effect) return undefined;
        if (this.hitpoints <= 0) {
            this.venomEffect = undefined;
            return undefined;
        }
        if (currentTick < effect.nextTick) return undefined;
        const amount = Math.max(1, Math.floor(effect.stage));
        const result = this.applyDamage(amount);
        if (result.current <= 0) {
            this.venomEffect = undefined;
        } else {
            effect.stage = Math.min(effect.cap, effect.stage + effect.ramp);
            effect.nextTick = currentTick + effect.interval;
        }
        return {
            style: HITMARK_VENOM,
            amount,
            hpCurrent: result.current,
            hpMax: result.max,
        };
    }

    private processDisease(currentTick: number): StatusHitsplat | undefined {
        const effect = this.diseaseEffect;
        if (!effect) return undefined;

        // Disease cannot kill - stops at 1 HP
        if (this.hitpoints <= 1) {
            this.diseaseEffect = undefined;
            return undefined;
        }

        if (currentTick < effect.nextTick) return undefined;

        // Calculate safe damage that won't reduce HP below 1
        const maxSafeDamage = this.hitpoints - 1;
        const potencyDamage = Math.max(1, Math.floor(effect.potency));
        const amount = Math.min(maxSafeDamage, potencyDamage);

        // This should never happen due to HP check above, but defensive check
        if (amount <= 0) {
            this.diseaseEffect = undefined;
            return undefined;
        }

        const result = this.applyDamage(amount);
        effect.potency = Math.max(0, effect.potency - 1);

        // Clear disease if potency depleted or HP at minimum
        if (effect.potency <= 0 || result.current <= 1) {
            this.diseaseEffect = undefined;
        } else {
            effect.nextTick = currentTick + effect.interval;
        }

        return {
            style: HITMARK_DISEASE,
            amount,
            hpCurrent: result.current,
            hpMax: result.max,
        };
    }

    private processRegeneration(currentTick: number): StatusHitsplat | undefined {
        const effect = this.regenEffect;
        if (!effect) return undefined;
        if (currentTick < effect.nextTick) return undefined;
        const before = this.hitpoints;
        const result = this.heal(effect.heal);
        const healed = result.current - before;
        effect.remainingTicks = Math.max(0, effect.remainingTicks - 1);
        if (effect.remainingTicks <= 0) {
            this.regenEffect = undefined;
        } else {
            effect.nextTick = currentTick + effect.interval;
        }
        if (healed <= 0) {
            return undefined;
        }
        return {
            style: HITMARK_REGEN,
            amount: healed,
            hpCurrent: result.current,
            hpMax: result.max,
        };
    }
}

export interface NpcUpdateSnapshot {
    id: number;
    typeId: number;
    name?: string;
    x: number;
    y: number;
    level: number;
    rot: number;
    orientation?: number;
    size: number;
    idleSeqId?: number;
    walkSeqId?: number;
    spawnX?: number;
    spawnY?: number;
    spawnLevel?: number;
    interactingIndex?: number;
}

export interface NpcUpdateDelta {
    id: number;
    x?: number;
    y?: number;
    level?: number;
    rot?: number;
    orientation?: number;
    moved?: boolean;
    turned?: boolean;
    /** Movement directions consumed this tick (internal codes SW,S,SE,W,E,NW,N,NE). */
    directions?: number[];
    /** Traversal types per direction (0=SLOW,1=WALK,2=RUN). */
    traversals?: number[];
    seq?: number;
    snap?: boolean;
    typeId?: number;
    size?: number;
    spawnX?: number;
    spawnY?: number;
    spawnLevel?: number;
    interactingIndex?: number;
}
