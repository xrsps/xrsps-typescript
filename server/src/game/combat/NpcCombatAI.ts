/**
 * NPC Combat AI System
 *
 * OSRS-accurate NPC combat behavior:
 * - Aggressive NPC targeting (radius-based)
 * - Aggression timer (NPCs stop being aggressive after ~10-20 minutes in area)
 * - Combat targeting priorities
 * - NPC special attacks and mechanics
 * - Multi-way combat rules
 *
 * Reference: OSRS Wiki, RSMod
 */
import { AttackType } from "./AttackType";
import { resolveNpcAttackRange } from "./CombatRules";

// =============================================================================
// Constants
// =============================================================================

/** Default aggression radius in tiles */
export const DEFAULT_AGGRESSION_RADIUS = 3;

/** Ticks before aggressive NPCs stop targeting a player in an area (10-20 mins) */
export const AGGRESSION_TIMER_TICKS = 1000; // ~10 minutes

/** Ticks between aggression checks */
export const AGGRESSION_CHECK_INTERVAL = 1;

/** Maximum distance an NPC will chase a target */
export const MAX_CHASE_DISTANCE = 32;

/** Ticks an NPC remains in combat after being attacked */
export const COMBAT_TIMEOUT_TICKS = 17; // ~10 seconds

/** Ticks between NPC target searches */
export const TARGET_SEARCH_INTERVAL = 5;

// =============================================================================
// Types
// =============================================================================

export interface NpcCombatStats {
    npcId: number;
    name: string;
    combatLevel: number;
    hitpoints: number;
    attackLevel: number;
    strengthLevel: number;
    defenceLevel: number;
    magicLevel: number;
    rangedLevel: number;
    attackSpeed: number;
    attackType: AttackType;
    attackStyle: "stab" | "slash" | "crush" | "magic" | "ranged";
    maxHit: number;
    aggressive: boolean;
    aggressiveRadius: number;
    aggressiveTimer: number;
    size: number;
    attackBonus: number;
    strengthBonus: number;
    magicBonus: number;
    rangedBonus: number;
    defenceBonuses: {
        stab: number;
        slash: number;
        crush: number;
        magic: number;
        ranged: number;
    };
    species: string[];
    poisonDamage?: number;
    venomous?: boolean;
    poisonImmune?: boolean;
    venomImmune?: boolean;
    /** NPC-specific attack range. If not set, defaults based on attackType (1 melee, 7 ranged, 10 magic) */
    attackRange?: number;
    slayerLevel?: number;
    slayerXp?: number;
    boss?: boolean;
    multiAttack?: boolean;
}

export interface NpcCombatState {
    /** Current target player ID */
    targetPlayerId: number | null;
    /** Tick when combat engagement expires */
    combatTimeoutTick: number;
    /** Tick when NPC can next attack */
    nextAttackTick: number;
    /** Whether NPC is currently retaliating */
    retaliating: boolean;
    /** Last tick when target search was performed */
    lastTargetSearchTick: number;
    /** Whether NPC has been provoked (attacked first) */
    provoked: boolean;
}

/**
 * OSRS Tolerance Region Tracking
 *
 * The game tracks aggression using two tile positions (21x21 regions):
 * - When player enters an NPC's aggression zone, tile1 and tile2 are set to entry position
 * - 10-minute timer counts down while in the region
 * - Player must move 10+ tiles from BOTH tile1 AND tile2 to reset timer
 * - This creates a "sticky" aggression region that follows the player
 *
 * Reference: docs/npc-behavior.md, OSRS Wiki Tolerance
 */
export interface PlayerAggressionState {
    /** Tick when player entered this NPC's aggression zone */
    entryTick: number;
    /** Whether player has been in zone long enough to avoid aggression */
    aggressionExpired: boolean;
    /** First tracked tile position for tolerance reset (oldest) */
    tile1: { x: number; y: number };
    /** Second tracked tile position for tolerance reset (newest) */
    tile2: { x: number; y: number };
}

/**
 * NPCs that NEVER become tolerant regardless of time spent in area.
 * Reference: docs/npc-behavior.md
 */
export const NEVER_TOLERANT_NPCS: ReadonlySet<string> = new Set([
    // Slayer monsters with permanent aggression
    "kurask",
    "gargoyle",
    "dark beast",
    "skeletal wyvern",
    "terror dog",
    // Note: All Wilderness NPCs are handled separately via isWilderness flag
]);

/**
 * NPCs with custom tolerance timers (not standard 10 minutes).
 */
export const CUSTOM_TOLERANCE_TIMERS: ReadonlyMap<string, number> = new Map([
    // Armoured zombies use 15 minutes (1500 ticks) instead of 10
    ["armoured zombie", 1500],
]);

/** Tolerance region size: 10 tiles in each direction = 21x21 */
export const TOLERANCE_REGION_RADIUS = 10;

export interface AggressionCheckResult {
    shouldTarget: boolean;
    targetPlayerId?: number;
    reason?: string;
}

export interface NpcAttackResult {
    damage: number;
    attackType: AttackType;
    hitDelay: number;
    animationId?: number;
    projectileId?: number;
    graphicId?: number;
    effects?: NpcAttackEffects;
}

export interface NpcAttackEffects {
    applyPoison?: number;
    applyVenom?: boolean;
    drainPrayer?: number;
    drainStat?: { stat: string; amount: number };
    freeze?: number;
    stun?: number;
    knockback?: boolean;
}

// =============================================================================
// NPC Combat State Management
// =============================================================================

/**
 * Create initial combat state for an NPC.
 */
export function createNpcCombatState(): NpcCombatState {
    return {
        targetPlayerId: null,
        combatTimeoutTick: 0,
        nextAttackTick: 0,
        retaliating: false,
        lastTargetSearchTick: 0,
        provoked: false,
    };
}

/**
 * Check if NPC is currently in combat.
 */
export function isNpcInCombat(state: NpcCombatState, currentTick: number): boolean {
    return state.targetPlayerId !== null && currentTick < state.combatTimeoutTick;
}

/**
 * Check if NPC can attack this tick.
 */
export function canNpcAttack(state: NpcCombatState, currentTick: number): boolean {
    return currentTick >= state.nextAttackTick;
}

/**
 * Set NPC's combat target.
 *
 * OSRS Retaliation timing: When an NPC is provoked (attacked first),
 * the delay before its first retaliation swing is: ceil(attackSpeed / 2) ticks.
 * Reference: tick-cycle-order.md
 */
export function setNpcTarget(
    state: NpcCombatState,
    playerId: number,
    currentTick: number,
    provoked: boolean = false,
    attackSpeed: number = 4,
): NpcCombatState {
    // Calculate retaliation delay for provoked NPCs
    // OSRS formula: ceil(attack_speed / 2) ticks to first swing
    const retaliationDelay = provoked ? Math.ceil(attackSpeed / 2) : 0;

    return {
        ...state,
        targetPlayerId: playerId,
        combatTimeoutTick: currentTick + COMBAT_TIMEOUT_TICKS,
        retaliating: provoked,
        provoked: state.provoked || provoked,
        // Set attack timing for retaliation
        nextAttackTick: provoked ? currentTick + retaliationDelay : state.nextAttackTick,
    };
}

/**
 * Clear NPC's combat target.
 */
export function clearNpcTarget(state: NpcCombatState): NpcCombatState {
    return {
        ...state,
        targetPlayerId: null,
        retaliating: false,
    };
}

/**
 * Update NPC attack timing after an attack.
 */
export function onNpcAttack(
    state: NpcCombatState,
    currentTick: number,
    attackSpeed: number,
): NpcCombatState {
    return {
        ...state,
        nextAttackTick: currentTick + attackSpeed,
        combatTimeoutTick: currentTick + COMBAT_TIMEOUT_TICKS,
    };
}

// =============================================================================
// Aggression System
// =============================================================================

/**
 * Check if player is within NPC's HUNT range.
 *
 * Hunt range uses the NPC's SW tile (x, y) as origin.
 * NPC size is NOT accounted for in hunt range calculations.
 *
 * This creates a known quirk where larger NPCs (2x2, 3x3) won't detect
 * players standing at their north or east edges, even if adjacent.
 * Example: Green dragons won't aggro players adjacent to their N/E tiles.
 *
 * Reference: docs/npc-behavior.md lines 174-206
 *
 * @param npcX - NPC's SW tile X coordinate
 * @param npcY - NPC's SW tile Y coordinate
 * @param playerX - Player's X coordinate
 * @param playerY - Player's Y coordinate
 * @param huntRange - Maximum hunt distance in tiles
 * @returns true if player is within hunt range
 */
export function isInHuntRange(
    npcX: number,
    npcY: number,
    playerX: number,
    playerY: number,
    huntRange: number,
): boolean {
    // Hunt range: measured from NPC's SW tile, size NOT included
    const dx = Math.abs(playerX - npcX);
    const dy = Math.abs(playerY - npcY);
    return Math.max(dx, dy) <= huntRange;
}

/**
 * Check if player is within NPC's AGGRESSION range.
 *
 * Aggression range uses the nearest tile of the NPC.
 * NPC size IS accounted for (distance from nearest edge).
 *
 * This is different from hunt range - aggression range is used for
 * determining if an already-targeted player is still in pursuit range.
 *
 * Reference: docs/npc-behavior.md lines 193-205
 *
 * @param npcX - NPC's SW tile X coordinate
 * @param npcY - NPC's SW tile Y coordinate
 * @param npcSize - NPC's size (1 for 1x1, 2 for 2x2, etc.)
 * @param playerX - Player's X coordinate
 * @param playerY - Player's Y coordinate
 * @param aggressionRange - Maximum aggression distance in tiles
 * @returns true if player is within aggression range
 */
export function isInAggressionRange(
    npcX: number,
    npcY: number,
    npcSize: number,
    playerX: number,
    playerY: number,
    aggressionRange: number,
): boolean {
    // Aggression range: measured from nearest tile, size IS included
    const npcMaxX = npcX + npcSize - 1;
    const npcMaxY = npcY + npcSize - 1;

    let dx = 0;
    let dy = 0;

    if (playerX < npcX) dx = npcX - playerX;
    else if (playerX > npcMaxX) dx = playerX - npcMaxX;

    if (playerY < npcY) dy = npcY - playerY;
    else if (playerY > npcMaxY) dy = playerY - npcMaxY;

    return Math.max(dx, dy) <= aggressionRange;
}

/**
 * Check if an NPC should target a player based on aggression rules.
 *
 * OSRS Aggression Rules:
 * 1. NPC must be aggressive (has aggressive flag and radius > 0)
 * 2. Player must be within HUNT range (uses NPC's SW tile, size NOT included)
 * 3. Player's combat level must be <= 2 * NPC's combat level (except in wilderness)
 * 4. Player must not have been in the area for too long (aggression timer)
 * 5. NPC must not already be in combat (unless multi-combat)
 * 6. Player must not be in combat with another NPC (unless multi-combat)
 *
 * Key distinction: Hunt range vs Aggression range
 * - Hunt range: For finding NEW targets (SW tile origin, size NOT included)
 * - Aggression range: For chasing EXISTING targets (nearest tile, size included)
 */
export function checkAggression(
    npcStats: NpcCombatStats,
    npcState: NpcCombatState,
    npcX: number,
    npcY: number,
    npcLevel: number,
    players: Array<{
        id: number;
        x: number;
        y: number;
        level: number;
        combatLevel: number;
        aggressionState: PlayerAggressionState;
        inCombat: boolean;
    }>,
    currentTick: number,
    isMultiCombat: boolean = false,
    isWilderness: boolean = false,
): AggressionCheckResult {
    // Not aggressive
    if (!npcStats.aggressive || npcStats.aggressiveRadius <= 0) {
        return { shouldTarget: false, reason: "NPC is not aggressive" };
    }

    // Already in combat (and not multi-combat)
    if (isNpcInCombat(npcState, currentTick) && !isMultiCombat) {
        return { shouldTarget: false, reason: "NPC already in combat" };
    }

    // Skip target search if checked recently
    if (currentTick - npcState.lastTargetSearchTick < TARGET_SEARCH_INTERVAL) {
        return { shouldTarget: false, reason: "Search on cooldown" };
    }

    // Find valid targets
    const validTargets: Array<{ id: number; distance: number }> = [];
    const huntRange = npcStats.aggressiveRadius;

    for (const player of players) {
        // Must be on same level
        if (player.level !== npcLevel) continue;

        // Use HUNT range check (SW tile origin, size NOT included)
        // This enables the quirk where larger NPCs don't detect players at N/E edges
        if (!isInHuntRange(npcX, npcY, player.x, player.y, huntRange)) {
            continue;
        }

        // Calculate actual distance for target sorting (from nearest tile, size included)
        const dx = Math.abs(player.x - npcX);
        const dy = Math.abs(player.y - npcY);
        const distance = Math.max(dx, dy);

        // Combat level check
        // - Skip check entirely in wilderness (all NPCs aggressive regardless of level)
        // - Level 63+ NPCs are always aggressive (63*2=126 = max player combat level)
        // - Otherwise: Player must be <= 2x NPC's combat level
        // Reference: docs/npc-behavior.md
        if (
            !isWilderness &&
            npcStats.combatLevel < 63 &&
            player.combatLevel > npcStats.combatLevel * 2
        ) {
            continue;
        }

        // Aggression timer check
        if (player.aggressionState.aggressionExpired) {
            continue;
        }

        // Player already in combat (and not multi-combat)
        if (player.inCombat && !isMultiCombat) {
            continue;
        }

        validTargets.push({ id: player.id, distance });
    }

    if (validTargets.length === 0) {
        return { shouldTarget: false, reason: "No valid targets" };
    }

    // Sort by distance (closest first)
    validTargets.sort((a, b) => a.distance - b.distance);

    return {
        shouldTarget: true,
        targetPlayerId: validTargets[0].id,
    };
}

/**
 * Check if player's aggression timer has expired in an area.
 */
export function checkAggressionTimerExpired(
    state: PlayerAggressionState,
    currentTick: number,
    aggressiveTimer: number = AGGRESSION_TIMER_TICKS,
): boolean {
    if (state.aggressionExpired) return true;
    return currentTick - state.entryTick >= aggressiveTimer;
}

/**
 * Create aggression state when player enters an area.
 *
 * Initializes both tile positions to entry location.
 * The 21x21 tolerance region is centered on these tracked tiles.
 */
export function createAggressionState(
    entryTick: number,
    x: number,
    y: number,
): PlayerAggressionState {
    return {
        entryTick,
        aggressionExpired: false,
        tile1: { x, y },
        tile2: { x, y },
    };
}

/**
 * Legacy overload for backward compatibility.
 * @deprecated Use createAggressionState(entryTick, x, y) instead
 */
export function createAggressionStateLegacy(entryTick: number): PlayerAggressionState {
    return {
        entryTick,
        aggressionExpired: false,
        tile1: { x: 0, y: 0 },
        tile2: { x: 0, y: 0 },
    };
}

/**
 * Update aggression state each tick (without position tracking).
 * @deprecated Use updateAggressionStateWithPosition for full 
 */
export function updateAggressionState(
    state: PlayerAggressionState,
    currentTick: number,
    aggressiveTimer: number = AGGRESSION_TIMER_TICKS,
): PlayerAggressionState {
    if (state.aggressionExpired) return state;

    if (checkAggressionTimerExpired(state, currentTick, aggressiveTimer)) {
        return { ...state, aggressionExpired: true };
    }

    return state;
}

/**
 * Update aggression state with position tracking for tolerance reset.
 *
 * Player must move 10+ tiles from BOTH tracked positions to reset timer.
 * - Distance uses Chebyshev (max of dx, dy)
 * - When reset occurs, oldest tile (tile1) is replaced with tile2, tile2 becomes current position
 * - Timer resets to full 10 minutes
 *
 * Reference: docs/npc-behavior.md lines 61-93
 */
export function updateAggressionStateWithPosition(
    state: PlayerAggressionState,
    currentTick: number,
    playerX: number,
    playerY: number,
    aggressiveTimer: number = AGGRESSION_TIMER_TICKS,
    neverTolerant: boolean = false,
): PlayerAggressionState {
    // Never tolerant NPCs (wilderness, certain slayer monsters)
    if (neverTolerant) {
        return state;
    }

    // Already tolerant - check for reset
    if (state.aggressionExpired) {
        // Check if player has moved far enough to potentially reset
        const dist1 = chebyshevDistance(playerX, playerY, state.tile1.x, state.tile1.y);
        const dist2 = chebyshevDistance(playerX, playerY, state.tile2.x, state.tile2.y);

        // Must be >10 tiles from BOTH positions to reset tolerance
        if (dist1 > TOLERANCE_REGION_RADIUS && dist2 > TOLERANCE_REGION_RADIUS) {
            // Reset tolerance - shift tile positions and restart timer
            return {
                entryTick: currentTick,
                aggressionExpired: false,
                tile1: { ...state.tile2 },
                tile2: { x: playerX, y: playerY },
            };
        }
        return state;
    }

    // Not yet tolerant - check for timer expiry or position reset
    const dist1 = chebyshevDistance(playerX, playerY, state.tile1.x, state.tile1.y);
    const dist2 = chebyshevDistance(playerX, playerY, state.tile2.x, state.tile2.y);

    // Player moved 10+ tiles from BOTH positions - reset timer
    if (dist1 > TOLERANCE_REGION_RADIUS && dist2 > TOLERANCE_REGION_RADIUS) {
        return {
            entryTick: currentTick,
            aggressionExpired: false,
            tile1: { ...state.tile2 },
            tile2: { x: playerX, y: playerY },
        };
    }

    // Check if timer expired
    if (checkAggressionTimerExpired(state, currentTick, aggressiveTimer)) {
        return { ...state, aggressionExpired: true };
    }

    return state;
}

/**
 * Calculate Chebyshev distance between two points.
 * OSRS uses this for range checks (square radius).
 */
function chebyshevDistance(x1: number, y1: number, x2: number, y2: number): number {
    return Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
}

// =============================================================================
// NPC Combat Targeting
// =============================================================================

/**
 * Priority order for NPC targeting:
 * 1. Player who attacked the NPC (retaliation)
 * 2. Closest player in aggression radius
 * 3. Previous target if still valid
 */
export function selectNpcTarget(
    npcStats: NpcCombatStats,
    npcState: NpcCombatState,
    npcX: number,
    npcY: number,
    npcLevel: number,
    attackerId: number | null,
    players: Array<{
        id: number;
        x: number;
        y: number;
        level: number;
        combatLevel: number;
        aggressionState: PlayerAggressionState;
        inCombat: boolean;
    }>,
    currentTick: number,
    isMultiCombat: boolean = false,
): number | null {
    // Priority 1: Retaliate against attacker
    if (attackerId !== null) {
        const attacker = players.find((p) => p.id === attackerId);
        if (attacker && attacker.level === npcLevel) {
            const dx = Math.abs(attacker.x - npcX);
            const dy = Math.abs(attacker.y - npcY);
            const distance = Math.max(dx, dy);
            if (distance <= MAX_CHASE_DISTANCE) {
                return attackerId;
            }
        }
    }

    // Priority 2: Check current target still valid
    if (npcState.targetPlayerId !== null) {
        const currentTarget = players.find((p) => p.id === npcState.targetPlayerId);
        if (currentTarget && currentTarget.level === npcLevel) {
            const dx = Math.abs(currentTarget.x - npcX);
            const dy = Math.abs(currentTarget.y - npcY);
            const distance = Math.max(dx, dy);
            if (distance <= MAX_CHASE_DISTANCE) {
                return npcState.targetPlayerId;
            }
        }
    }

    // Priority 3: Find new target via aggression
    const aggroResult = checkAggression(
        npcStats,
        npcState,
        npcX,
        npcY,
        npcLevel,
        players,
        currentTick,
        isMultiCombat,
    );

    if (aggroResult.shouldTarget && aggroResult.targetPlayerId !== undefined) {
        return aggroResult.targetPlayerId;
    }

    return null;
}

// =============================================================================
// NPC Attack Calculations
// =============================================================================

/**
 * Calculate NPC attack parameters.
 */
export function calculateNpcAttack(
    npcStats: NpcCombatStats,
    targetDefenceLevel: number,
    targetDefenceBonus: number,
    distance: number,
    random: () => number,
): NpcAttackResult {
    // Calculate accuracy
    const effectiveAttack = npcStats.attackLevel + 8;
    const attackRoll = effectiveAttack * (npcStats.attackBonus + 64);

    const effectiveDefence = targetDefenceLevel + 8;
    const defenceRoll = effectiveDefence * (targetDefenceBonus + 64);

    let hitChance: number;
    if (attackRoll > defenceRoll) {
        hitChance = 1 - (defenceRoll + 2) / (2 * (attackRoll + 1));
    } else {
        hitChance = attackRoll / (2 * (defenceRoll + 1));
    }

    const hit = random() < hitChance;
    const damage = hit ? Math.floor(random() * (npcStats.maxHit + 1)) : 0;

    // Calculate hit delay based on attack type
    // Melee resolves 1 tick after swing; ranged/magic include projectile travel.
    let hitDelay = 1;
    if (npcStats.attackType === AttackType.Ranged) {
        hitDelay = 1 + Math.floor((3 + distance) / 6);
    } else if (npcStats.attackType === AttackType.Magic) {
        hitDelay = 1 + Math.floor((1 + distance) / 3);
    }

    // Build effects
    const effects: NpcAttackEffects = {};
    if (npcStats.poisonDamage && random() < 0.25) {
        effects.applyPoison = npcStats.poisonDamage;
    }
    if (npcStats.venomous && random() < 0.25) {
        effects.applyVenom = true;
    }

    return {
        damage,
        attackType: npcStats.attackType,
        hitDelay,
        effects: Object.keys(effects).length > 0 ? effects : undefined,
    };
}

// =============================================================================
// NPC Movement in Combat
// =============================================================================

/**
 * Calculate if NPC needs to move to attack target.
 */
export function npcNeedsToMove(
    npcX: number,
    npcY: number,
    npcSize: number,
    targetX: number,
    targetY: number,
    attackRange: number,
): boolean {
    // Calculate distance considering NPC size
    const npcMinX = npcX;
    const npcMaxX = npcX + npcSize - 1;
    const npcMinY = npcY;
    const npcMaxY = npcY + npcSize - 1;

    // Distance from NPC's closest edge to target
    let dx = 0;
    let dy = 0;

    if (targetX < npcMinX) dx = npcMinX - targetX;
    else if (targetX > npcMaxX) dx = targetX - npcMaxX;

    if (targetY < npcMinY) dy = npcMinY - targetY;
    else if (targetY > npcMaxY) dy = targetY - npcMaxY;

    const distance = Math.max(dx, dy);
    return distance > attackRange;
}

/**
 * Get attack range for NPC.
 * Uses NPC-specific attackRange if defined, otherwise falls back to defaults based on attack type.
 * Note: Distance is calculated from the NPC's closest edge, so NPC size is already accounted for
 * in the distance calculation (see npcNeedsToMove function).
 */
export function getNpcAttackRange(stats: NpcCombatStats): number {
    return resolveNpcAttackRange(stats, stats.attackType);
}

// =============================================================================
// NPC Combat Tick Processing
// =============================================================================

export interface NpcCombatTickResult {
    stateUpdate: NpcCombatState;
    attack?: NpcAttackResult;
    targetPlayerId?: number;
    shouldMove: boolean;
    moveToX?: number;
    moveToY?: number;
}

/**
 * Process a combat tick for an NPC.
 */
export function processNpcCombatTick(
    npcStats: NpcCombatStats,
    npcState: NpcCombatState,
    npcX: number,
    npcY: number,
    npcLevel: number,
    targetPlayer: {
        id: number;
        x: number;
        y: number;
        level: number;
        defenceLevel: number;
        defenceBonus: number;
    } | null,
    currentTick: number,
    random: () => number,
): NpcCombatTickResult {
    let stateUpdate = { ...npcState };

    // No target
    if (!targetPlayer) {
        if (stateUpdate.targetPlayerId !== null) {
            stateUpdate = clearNpcTarget(stateUpdate);
        }
        return { stateUpdate, shouldMove: false };
    }

    // Update target
    if (stateUpdate.targetPlayerId !== targetPlayer.id) {
        stateUpdate = setNpcTarget(stateUpdate, targetPlayer.id, currentTick);
    }

    // Check if target on same level
    if (targetPlayer.level !== npcLevel) {
        stateUpdate = clearNpcTarget(stateUpdate);
        return { stateUpdate, shouldMove: false };
    }

    // Calculate distance
    const dx = Math.abs(targetPlayer.x - npcX);
    const dy = Math.abs(targetPlayer.y - npcY);
    const distance = Math.max(dx, dy);

    // Target too far - give up
    if (distance > MAX_CHASE_DISTANCE) {
        stateUpdate = clearNpcTarget(stateUpdate);
        return { stateUpdate, shouldMove: false };
    }

    // Check attack range
    const attackRange = getNpcAttackRange(npcStats);
    const needsToMove = npcNeedsToMove(
        npcX,
        npcY,
        npcStats.size,
        targetPlayer.x,
        targetPlayer.y,
        attackRange,
    );

    if (needsToMove) {
        return {
            stateUpdate,
            shouldMove: true,
            moveToX: targetPlayer.x,
            moveToY: targetPlayer.y,
            targetPlayerId: targetPlayer.id,
        };
    }

    // In range - check if can attack
    if (!canNpcAttack(stateUpdate, currentTick)) {
        return { stateUpdate, shouldMove: false, targetPlayerId: targetPlayer.id };
    }

    // Perform attack
    const attack = calculateNpcAttack(
        npcStats,
        targetPlayer.defenceLevel,
        targetPlayer.defenceBonus,
        distance,
        random,
    );

    stateUpdate = onNpcAttack(stateUpdate, currentTick, npcStats.attackSpeed);

    return {
        stateUpdate,
        attack,
        shouldMove: false,
        targetPlayerId: targetPlayer.id,
    };
}

// =============================================================================
// NpcCombatAI Class (convenience wrapper for index.ts exports)
// =============================================================================

/**
 * Aggression target info
 */
export interface AggroTarget {
    playerId: number;
    distance: number;
}

/**
 * NPC Combat AI class providing object-oriented interface.
 */
export class NpcCombatAI {
    createCombatState(): NpcCombatState {
        return createNpcCombatState();
    }

    isInCombat(state: NpcCombatState, currentTick: number): boolean {
        return isNpcInCombat(state, currentTick);
    }

    canAttack(state: NpcCombatState, currentTick: number): boolean {
        return canNpcAttack(state, currentTick);
    }

    setTarget(
        state: NpcCombatState,
        playerId: number,
        currentTick: number,
        provoked: boolean = false,
        attackSpeed: number = 4,
    ): NpcCombatState {
        return setNpcTarget(state, playerId, currentTick, provoked, attackSpeed);
    }

    clearTarget(state: NpcCombatState): NpcCombatState {
        return clearNpcTarget(state);
    }

    onAttack(state: NpcCombatState, currentTick: number, attackSpeed: number): NpcCombatState {
        return onNpcAttack(state, currentTick, attackSpeed);
    }

    checkAggression(
        npcStats: NpcCombatStats,
        npcState: NpcCombatState,
        npcX: number,
        npcY: number,
        npcLevel: number,
        players: Array<{
            id: number;
            x: number;
            y: number;
            level: number;
            combatLevel: number;
            aggressionState: PlayerAggressionState;
            inCombat: boolean;
        }>,
        currentTick: number,
        isMultiCombat: boolean = false,
        isWilderness: boolean = false,
    ): AggressionCheckResult {
        return checkAggression(
            npcStats,
            npcState,
            npcX,
            npcY,
            npcLevel,
            players,
            currentTick,
            isMultiCombat,
            isWilderness,
        );
    }

    selectTarget(
        npcStats: NpcCombatStats,
        npcState: NpcCombatState,
        npcX: number,
        npcY: number,
        npcLevel: number,
        attackerId: number | null,
        players: Array<{
            id: number;
            x: number;
            y: number;
            level: number;
            combatLevel: number;
            aggressionState: PlayerAggressionState;
            inCombat: boolean;
        }>,
        currentTick: number,
        isMultiCombat: boolean = false,
    ): number | null {
        return selectNpcTarget(
            npcStats,
            npcState,
            npcX,
            npcY,
            npcLevel,
            attackerId,
            players,
            currentTick,
            isMultiCombat,
        );
    }

    calculateAttack(
        npcStats: NpcCombatStats,
        targetDefenceLevel: number,
        targetDefenceBonus: number,
        distance: number,
        random: () => number,
    ): NpcAttackResult {
        return calculateNpcAttack(
            npcStats,
            targetDefenceLevel,
            targetDefenceBonus,
            distance,
            random,
        );
    }

    getAttackRange(stats: NpcCombatStats): number {
        return getNpcAttackRange(stats);
    }

    needsToMove(
        npcX: number,
        npcY: number,
        npcSize: number,
        targetX: number,
        targetY: number,
        attackRange: number,
    ): boolean {
        return npcNeedsToMove(npcX, npcY, npcSize, targetX, targetY, attackRange);
    }

    processTick(
        npcStats: NpcCombatStats,
        npcState: NpcCombatState,
        npcX: number,
        npcY: number,
        npcLevel: number,
        targetPlayer: {
            id: number;
            x: number;
            y: number;
            level: number;
            defenceLevel: number;
            defenceBonus: number;
        } | null,
        currentTick: number,
        random: () => number,
    ): NpcCombatTickResult {
        return processNpcCombatTick(
            npcStats,
            npcState,
            npcX,
            npcY,
            npcLevel,
            targetPlayer,
            currentTick,
            random,
        );
    }
}

// Singleton instance
export const npcCombatAI = new NpcCombatAI();
