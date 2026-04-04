/**
 * Combat action execution handler.
 *
 * Handles execution of combat-related actions extracted from wsServer:
 * - executeCombatAttackAction (player attacks NPC)
 * - executeCombatAutocastAction (autocast spell attack)
 * - executePlayerVsPlayerHit (PvP hit resolution)
 * - executeCombatPlayerHitAction (hit resolution, damage application)
 * - executeCombatNpcRetaliateAction (NPC retaliation)
 * - executeCombatCompanionHitAction (owned follower damage on NPCs)
 *
 * Uses dependency injection via services interface to avoid tight coupling.
 */
import type { ProjectileLaunch } from "../../../../../src/shared/projectiles/ProjectileLaunch";
import { getPoweredStaffSpellData } from "../../../data/spells";
import type { PoweredStaffSpellData, SpellDataEntry } from "../../../data/spells";
import type { PathService } from "../../../pathfinding/PathService";
import type { AttackType } from "../../combat/AttackType";
import {
    canNpcAttackPlayerFromCurrentPosition,
    hasProjectileLineOfSightToNpc,
} from "../../combat/CombatAction";
import { resolvePlayerAttackType } from "../../combat/CombatRules";
import type { DropEligibility } from "../../combat/DamageTracker";
import {
    type ChargeTracker,
    DegradationSystem,
    getChargesUsed,
    setChargesUsed,
} from "../../combat/DegradationSystem";
import { HITMARK_BLOCK, HITMARK_DAMAGE } from "../../combat/HitEffects";
import type { NpcState } from "../../npc";
import type { PendingNpcDrop } from "../../npcManager";
import type { PlayerAppearance, PlayerState } from "../../player";
import type { SpellCastContext, SpellCastOutcome } from "../../spells/SpellCaster";
import type {
    CombatAttackActionData,
    CombatAutocastActionData,
    CombatCompanionHitActionData,
    CombatHitPayloadData,
    CombatNpcRetaliateActionData,
    CombatPlayerHitActionData,
} from "../actionPayloads";
import type { ActionEffect, ActionExecutionResult, ActionRequest, ScheduledAction } from "../types";
import type { SpellResultPayload } from "./SpellActionHandler";

// ============================================================================
// Types
// ============================================================================

/** Projectile parameters for spawn building. */
export interface ProjectileParams {
    projectileId?: number;
    startHeight?: number;
    endHeight?: number;
    slope?: number;
    steepness?: number;
    startDelay?: number;
}

/** Projectile timing estimation result. */
export interface ProjectileTiming {
    startDelay: number;
    travelTime: number;
    hitDelay: number;
    lineOfSight?: boolean;
}

/** NPC combat sequence set. */
export interface NpcCombatSequences {
    attack?: number;
    block?: number;
    death?: number;
}

/** Spell cast request for autocast handling. */
export interface SpellCastRequest {
    spellId: number;
    modifiers?: {
        isAutocast?: boolean;
        castMode?: "autocast" | "defensive_autocast";
    };
    target?: {
        type: "npc" | "player";
        npcId?: number;
        playerId?: number;
    };
}

/** Hit payload from combat action data. */
export type HitPayload = CombatHitPayloadData;

/** Special attack payload. */
export interface SpecialAttackPayload {
    costPercent?: number;
    weaponItemId?: number;
    effects?: {
        freezeTicks?: number;
        healFraction?: number;
        prayerFraction?: number;
        siphonRunEnergyPercent?: number;
        prayerDisableTicks?: number;
        drainMagicByDamage?: boolean;
        drainCombatStatByDamage?: boolean;
    };
}

/** Spot animation request. */
export interface SpotAnimRequest {
    tick: number;
    playerId?: number;
    npcId?: number;
    slot?: number;
    spotId: number;
    delay?: number;
    height?: number;
    tile?: { x: number; y: number; level?: number };
}

/** Sound broadcast request. */
export interface SoundRequest {
    soundId: number;
    x: number;
    y: number;
    level: number;
    delay?: number;
}

/** Chat message request. */
export interface ChatMessageRequest {
    messageType: "game" | "public" | "server";
    playerId?: number;
    from?: string;
    prefix?: string;
    text: string;
    colorId?: number;
    effectId?: number;
    pattern?: number[];
    autoChat?: boolean;
    targetPlayerIds?: number[];
}

/** Action scheduler request. */
export type CombatScheduledActionKind =
    | "combat.playerHit"
    | "combat.npcRetaliate"
    | "combat.companionHit";

export type ActionScheduleRequest<K extends CombatScheduledActionKind = CombatScheduledActionKind> =
    ActionRequest<K>;

/** Action scheduler result. */
export interface ActionScheduleResult {
    ok: boolean;
    reason?: string;
}

/** Interaction state for player. */
export interface InteractionState {
    kind: "npcCombat" | "playerCombat" | string;
    npcId?: number;
    playerId?: number;
}

/** Skill sync data. */
export interface SkillSync {
    snapshot?: boolean;
    skills: Array<{
        id: number;
        xp: number;
        baseLevel?: number;
        level?: number;
        boost?: number;
        currentLevel?: number;
        virtualLevel?: number;
    }>;
    totalLevel?: number;
    combatLevel?: number;
}

// ============================================================================
// Services Interface
// ============================================================================

/**
 * Services interface for combat action handling.
 * Provides all dependencies needed by combat action methods.
 */
export interface CombatActionServices {
    // --- Core Entity Access ---
    /** Get player by ID. */
    getPlayer(id: number): PlayerState | undefined;
    /** Get NPC by ID. */
    getNpc(id: number): NpcState | undefined;
    /** Get current game tick. */
    getCurrentTick(): number;
    /** Get path service for collision/LOS checks. */
    getPathService(): PathService | undefined;

    // --- Equipment/Appearance ---
    /** Get player's equipment array. */
    getEquipArray(player: PlayerState): number[];
    /** Get player's equipment quantity array. */
    getEquipQtyArray(player: PlayerState): number[];
    /** Mark player's equipment as dirty. */
    markEquipmentDirty(player: PlayerState): void;
    /** Mark player's appearance as dirty. */
    markAppearanceDirty(player: PlayerState): void;

    // --- Combat Utilities ---
    /** Pick attack animation sequence for player. */
    pickAttackSequence(player: PlayerState): number;
    /** Pick attack speed for player. */
    pickAttackSpeed(player: PlayerState): number;
    /** Pick hit delay for player's weapon. */
    pickHitDelay(player: PlayerState): number;
    /** Get player's attack reach (range). */
    getPlayerAttackReach(player: PlayerState): number;
    /** Pick closest NPC tile for facing. */
    pickNpcFaceTile(player: PlayerState, npc: NpcState): { x: number; y: number };
    /** Pick combat sound (hit or miss). */
    pickCombatSound(player: PlayerState, isHit: boolean): number;
    /** Get ranged impact sound for the player's weapon. */
    getRangedImpactSound?(player: PlayerState): number | undefined;
    /** Derive attack type from hitsplat style. */
    deriveAttackTypeFromStyle(style: number, player: PlayerState): AttackType;
    /** Pick block sequence for player. */
    pickBlockSequence(player: PlayerState): number;

    // --- NPC Combat ---
    /** Get NPC combat sequences (attack, block, death). */
    getNpcCombatSequences(typeId: number): NpcCombatSequences | undefined;
    /** Get NPC hit sound ID. */
    getNpcHitSoundId(typeId: number): number | undefined;
    /** Get NPC defend sound ID. */
    getNpcDefendSoundId(typeId: number): number | undefined;
    /** Get NPC death sound ID. */
    getNpcDeathSoundId(typeId: number): number | undefined;
    /** Get NPC attack sound ID. */
    getNpcAttackSoundId(typeId: number): number;
    /** Resolve NPC's attack type. */
    resolveNpcAttackType(npc: NpcState, hint?: AttackType): AttackType;
    /** Resolve NPC's attack range. */
    resolveNpcAttackRange(npc: NpcState, attackType: AttackType): number;
    /** Broadcast NPC sequence animation. */
    broadcastNpcSequence(npc: NpcState, seqId: number): void;
    /** Estimate NPC despawn delay from death sequence. */
    estimateNpcDespawnDelayTicksFromSeq(seqId: number | undefined): number;

    // --- Projectile ---
    /** Estimate projectile timing. */
    estimateProjectileTiming(params: {
        player: PlayerState;
        targetX?: number;
        targetY?: number;
        projectileDefaults?: ProjectileParams;
        spellData?: unknown;
        pathService?: PathService;
    }): ProjectileTiming | undefined;
    /** Build ranged projectile launch. */
    buildPlayerRangedProjectileLaunch(params: {
        player: PlayerState;
        npc: NpcState;
        projectile: ProjectileParams;
        timing?: ProjectileTiming;
    }): ProjectileLaunch | undefined;

    // --- Spell/Magic ---
    /** Process spell cast request. */
    processSpellCastRequest(player: PlayerState, request: SpellCastRequest): SpellResultPayload;
    /** Queue spell result to client. */
    queueSpellResult(playerId: number, result: SpellResultPayload): void;
    /** Pick spell sound for stage. */
    pickSpellSound(spellId: number, stage: "impact" | "splash"): number | undefined;
    /** Reset autocast state. */
    resetAutocast(player: PlayerState): void;

    // --- Effect Dispatching ---
    /** Broadcast sound to nearby players. */
    broadcastSound(request: SoundRequest, tag: string): void;
    /** Execute function with direct send bypass. */
    withDirectSendBypass(tag: string, fn: () => void): void;
    /** Enqueue spot animation. */
    enqueueSpotAnimation(request: SpotAnimRequest): void;
    /** Queue chat message. */
    queueChatMessage(request: ChatMessageRequest): void;
    /** Queue combat state update. */
    queueCombatState(player: PlayerState): void;
    /** Queue skill snapshot. */
    queueSkillSnapshot(playerId: number, sync: SkillSync): void;
    /** Dispatch action effects. */
    dispatchActionEffects(effects: ActionEffect[]): void;
    /** Broadcast encoded message. */
    broadcast(data: Uint8Array, tag: string): void;
    /** Encode message to buffer. */
    encodeMessage(msg: { type: string; payload: unknown }): Uint8Array;

    // --- Action Scheduling ---
    /** Schedule a combat action. */
    scheduleAction<K extends CombatScheduledActionKind>(
        playerId: number,
        request: ActionScheduleRequest<K>,
        tick: number,
    ): ActionScheduleResult;
    /** Cancel actions matching predicate. */
    cancelActions(playerId: number, predicate: (action: ScheduledAction) => boolean): void;

    // --- Player Interaction State ---
    /** Get player's socket. */
    getPlayerSocket(playerId: number): unknown | undefined;
    /** Get interaction state for socket. */
    getInteractionState(socket: unknown): InteractionState | undefined;
    /** Start NPC attack for player. */
    startNpcAttack(
        socket: unknown,
        npc: NpcState,
        tick: number,
        attackSpeed: number,
    ): { ok: boolean; message?: string };
    /** Stop player combat. */
    stopPlayerCombat(socket: unknown): void;
    /** Start player-vs-player combat. */
    startPlayerCombat(socket: unknown, targetId: number): void;
    /** Clear all interactions with NPC. */
    clearInteractionsWithNpc(npcId: number): void;
    /** Send skills message to player. */
    sendSkillsMessage(socket: unknown, player: PlayerState): void;

    // --- Combat System ---
    /** Start NPC combat tracking. */
    startNpcCombat(player: PlayerState, npc: NpcState, tick: number, attackSpeed: number): void;
    /** Resume auto-attack after player was hit (for auto-retaliate). */
    resumeAutoAttack(playerId: number): void;
    /** Ensure player combat focus stays alive after NPC retaliation. */
    extendAggroHold(playerId: number, minimumTicks?: number): void;
    /** Confirm hit landed for retaliation. */
    confirmHitLanded(
        playerId: number,
        tick: number,
        npc: NpcState,
        damage: number,
        attackType: AttackType | undefined,
        player: PlayerState,
    ): void;
    /** Roll retaliate damage using NPC's actual stats. */
    rollRetaliateDamage(npc: NpcState, player: PlayerState): number;
    /** Get drop eligibility for NPC. */
    getDropEligibility(npc: NpcState): DropEligibility | undefined;
    /** Roll server-authoritative NPC drops for the current death. */
    rollNpcDrops(npc: NpcState, eligibility: DropEligibility | undefined): PendingNpcDrop[];
    /** Clean up NPC combat state. */
    cleanupNpc(npc: NpcState): void;

    // --- Ground Items ---
    /** Spawn ground item. */
    spawnGroundItem(
        itemId: number,
        quantity: number,
        location: { x: number; y: number; level: number },
        tick: number,
        options?: {
            ownerId?: number;
            privateTicks?: number;
            isMonsterDrop?: boolean;
        },
    ): void;

    // --- NPC Manager ---
    /** Queue NPC death and respawn, with optional delayed drops (RSMod parity). */
    queueNpcDeath(
        npcId: number,
        despawnTick: number,
        respawnTick: number,
        drops?: PendingNpcDrop[],
    ): boolean;

    // --- Prayer/Combat Effects ---
    /** Apply protection prayers to damage. */
    applyProtectionPrayers(
        target: PlayerState,
        damage: number,
        attackType: AttackType,
        sourceType: "player" | "npc",
    ): number;
    /** Apply smite effect. */
    applySmite(attacker: PlayerState, target: PlayerState, damage: number): void;
    /** Try to activate redemption prayer. */
    tryActivateRedemption(player: PlayerState): void;
    /** Close interruptible interfaces on damage. */
    closeInterruptibleInterfaces(player: PlayerState): void;
    /** Apply multi-target spell damage. */
    applyMultiTargetSpellDamage(params: {
        player: PlayerState;
        primary: NpcState;
        spell: SpellDataEntry;
        baseDamage: number;
        style: number;
        hitsplatTick: number;
        currentTick: number;
        effects: ActionEffect[];
    }): void;

    // --- XP Awards ---
    /** Award combat XP on hit. */
    awardCombatXp(
        player: PlayerState,
        damage: number,
        hitData: unknown,
        effects: ActionEffect[],
    ): void;
    /** Resolve active skill XP multiplier for the player (e.g. league modifiers). */
    getSkillXpMultiplier?: (player: PlayerState) => number;

    // --- Special Attacks ---
    /** Get special attack definition. */
    getSpecialAttack(weaponId: number): { soundId?: number } | undefined;
    /** Pick special attack visual override. */
    pickSpecialAttackVisualOverride(
        weaponId: number,
    ): { seqId?: number; spotId?: number; spotHeight?: number } | undefined;

    // --- Ammo Consumption ---
    /** Consume equipped ammo (blowpipe). */
    consumeEquippedAmmoApply(params: {
        appearance: PlayerAppearance;
        count: number;
        slotCount: number;
    }): {
        ok: boolean;
        reason?: string;
    };
    /** Calculate ammo consumption result. */
    calculateAmmoConsumption(
        weaponId: number,
        ammoId: number,
        ammoQty: number,
        capeId: number,
        targetX: number,
        targetY: number,
        randFn: () => number,
    ): {
        error?: string;
        consumed?: boolean;
        dropped?: boolean;
        quantityUsed?: number;
        dropTileX?: number;
        dropTileY?: number;
    };

    // --- Magic Autocast ---
    /** Check if weapon can autocast spell. */
    canWeaponAutocastSpell(
        weaponId: number,
        spellId: number,
    ): { compatible: boolean; reason?: string };
    /** Get autocast compatibility error message. */
    getAutocastCompatibilityMessage(reason?: string): string;

    // --- Spell Caster ---
    /** Validate spell cast. */
    validateSpellCast(context: SpellCastContext): SpellCastOutcome;
    /** Execute spell cast. */
    executeSpellCast(context: SpellCastContext, validation: SpellCastOutcome): SpellCastOutcome;

    // --- Spell Data ---
    /** Get spell data by ID. */
    getSpellData(spellId: number): SpellDataEntry | undefined;
    /** Get spell base XP. */
    getSpellBaseXp(spellId: number): number;
    /** Get projectile params by ID. */
    getProjectileParams(projectileId?: number): ProjectileParams | undefined;

    // --- Hitsplat Applicator ---
    /** Apply hitsplat to NPC. */
    applyNpcHitsplat(
        npc: NpcState,
        style: number,
        damage: number,
        tick: number,
        maxHit?: number,
    ): { amount: number; style: number; hpCurrent: number; hpMax: number };
    /** Apply hitsplat to player. */
    applyPlayerHitsplat(
        player: PlayerState,
        style: number,
        damage: number,
        tick: number,
        maxHit?: number,
    ): { amount: number; style: number; hpCurrent: number; hpMax: number };

    // --- Wilderness Check ---
    /** Check if location is in wilderness. */
    isInWilderness(x: number, y: number): boolean;

    // --- Range Checks ---
    /** Check if attacker is within attack range of target. */
    isWithinAttackRange(
        attacker: PlayerState | NpcState,
        target: PlayerState | NpcState,
        range: number,
    ): boolean;
    /** Check if attacker has direct melee reach to target. */
    hasDirectMeleeReach(
        attacker: PlayerState | NpcState,
        target: PlayerState | NpcState,
        pathService: PathService,
    ): boolean;
    /** Check if attacker has direct melee path to target. */
    hasDirectMeleePath(
        attacker: PlayerState | NpcState,
        target: PlayerState | NpcState,
        pathService: PathService,
    ): boolean;

    // --- Helpers ---
    /** Normalize attack type string. */
    normalizeAttackType(value: unknown): AttackType | undefined;
    /** Get active frame flag. */
    isActiveFrame(): boolean;
    /** Logger for debug output. */
    log(level: "info" | "warn" | "error", message: string): void;

    // --- NPC Info ---
    /** Get NPC name by type ID. */
    getNpcName(typeId: number): string | undefined;

    // --- League Tasks ---
    /** Notify task manager of NPC kill (auto-completes matching tasks). */
    onNpcKill(playerId: number, npcId: number): void;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_ATTACK_SPEED = 4;
const DEFAULT_BLOCK_SEQ = 403;
const COMBAT_SOUND_DELAY_MS = 150;
const VARP_SPECIAL_ATTACK = 301;
const EQUIP_SLOT_COUNT = 14;
const DEFAULT_RANGED_ATTACK_SPOT = 249;

// Equipment slots (matches EquipmentSlot enum from Equipment.ts)
// Note: AMMO is 10, not 13 - 13 is EquipmentDisplaySlot.AMMO for widget indices
const EquipmentSlot = {
    WEAPON: 3,
    AMMO: 10,
    CAPE: 1,
} as const;

function collectCombatHitPayloads(data: CombatAttackActionData): HitPayload[] {
    if (Array.isArray(data.hits)) {
        return data.hits.filter((payload) => payload !== undefined && payload !== null);
    }

    return data.hit !== undefined ? [data.hit] : [];
}

// ============================================================================
// Handler Class
// ============================================================================

/**
 * Handles combat action execution.
 */
export class CombatActionHandler {
    constructor(private readonly services: CombatActionServices) {}

    // ========================================================================
    // Public API - Action Executors
    // ========================================================================

    /**
     * Execute a combat attack action (player attacks NPC).
     */
    executeCombatAttackAction(
        player: PlayerState,
        data: CombatAttackActionData,
        tick: number,
    ): ActionExecutionResult {
        const npcId = data.npcId;

        const npc = this.services.getNpc(npcId);
        if (!npc) {
            return { ok: false, reason: npcId > 0 ? "npc_not_found" : "invalid_npc" };
        }
        if (npc.level !== player.level) {
            return { ok: false, reason: "different_plane" };
        }
        if (npc.isPlayerFollower?.() === true) {
            return { ok: false, reason: "npc_unattackable" };
        }

        const effects: ActionEffect[] = [];
        const reach = Math.max(1, this.services.getPlayerAttackReach(player));
        const pathService = this.services.getPathService();

        // Range validation
        if (!this.services.isWithinAttackRange(player, npc, reach)) {
            return { ok: false, reason: "not_in_range" };
        }
        if (reach <= 1) {
            if (pathService && !this.services.hasDirectMeleeReach(player, npc, pathService)) {
                return { ok: false, reason: "not_in_range" };
            }
        } else {
            // OSRS parity: do not allow long-reach melee attacks through walls
            const isMelee = resolvePlayerAttackType(player) === "melee";
            if (isMelee && pathService) {
                if (!this.services.hasDirectMeleePath(player, npc, pathService)) {
                    return { ok: false, reason: "not_in_range" };
                }
            } else if (
                !isMelee &&
                pathService &&
                !hasProjectileLineOfSightToNpc(
                    player.tileX,
                    player.tileY,
                    player.level,
                    npc,
                    pathService,
                )
            ) {
                return { ok: false, reason: "line_of_sight" };
            }
        }

        // Face the target
        const faceTile = this.services.pickNpcFaceTile(player, npc);
        const targetX = (faceTile.x << 7) + 64;
        const targetY = (faceTile.y << 7) + 64;
        if (player.x !== targetX || player.y !== targetY) {
            player.setForcedOrientation(this.faceAngleRs(player.x, player.y, targetX, targetY));
            player._pendingFace = { x: targetX, y: targetY };
            player.pendingFaceTile = { x: faceTile.x, y: faceTile.y };
        }
        player.markSent();

        // Parse hit payloads
        const hitPayloads = collectCombatHitPayloads(data);
        if (hitPayloads.length === 0) {
            return { ok: false, reason: "missing_hit" };
        }
        const hitPayload = hitPayloads[0];

        // Determine weapon
        const specialData = data.special as SpecialAttackPayload | undefined;
        const specialWeaponItemId = specialData?.weaponItemId ?? -1;
        const weaponItemId =
            specialWeaponItemId > 0
                ? specialWeaponItemId
                : this.services.getEquipArray(player)[EquipmentSlot.WEAPON];

        // Ranged ammo consumption
        const plannedAttackType = this.services.normalizeAttackType(hitPayload.attackType);
        if (plannedAttackType === "ranged") {
            const result = this.handleRangedAmmoConsumption(
                player,
                npc,
                weaponItemId,
                hitPayloads.length,
                tick,
                effects,
            );
            if (!result.ok) {
                return result;
            }
        }

        // Magic autocast rune consumption
        if (plannedAttackType === "magic" && player.autocastEnabled) {
            const result = this.handleAutocastRuneConsumption(player, npc, weaponItemId);
            if (!result.ok) {
                return result;
            }
        }

        // Queue ranged attack spot animation (OSRS parity: only after ammo check passes)
        // This was moved from CombatSystem.ts to ensure animation doesn't play when out of ammo
        if (plannedAttackType === "ranged") {
            const scheduleTick = Number.isFinite(tick) ? tick : this.services.getCurrentTick();
            this.services.enqueueSpotAnimation({
                tick: scheduleTick,
                playerId: player.id,
                spotId: DEFAULT_RANGED_ATTACK_SPOT,
                delay: 0,
            });
        }

        // Special attack energy drain
        let specialActivated = false;
        const specialCostPercent = specialData?.costPercent;
        if (specialCostPercent !== undefined) {
            const costPercent = Math.max(0, Math.min(100, specialCostPercent));
            if (costPercent > 0) {
                const ok = player.consumeSpecialEnergy(costPercent);
                specialActivated = ok;
                player.setVarpValue(VARP_SPECIAL_ATTACK, 0);
                this.services.queueCombatState(player);
                if (!ok) {
                    this.services.queueChatMessage({
                        messageType: "game",
                        text: "You do not have enough special attack energy.",
                        targetPlayerIds: [player.id],
                    });
                }
            }
        }

        // Queue attack animation
        const specialVisual = specialActivated
            ? this.services.pickSpecialAttackVisualOverride(weaponItemId)
            : undefined;
        const attackSeq = specialVisual?.seqId ?? this.services.pickAttackSequence(player);
        if (Number.isFinite(attackSeq) && attackSeq >= 0) {
            player.queueOneShotSeq(attackSeq, 0);
        }
        const specialSpotId = specialVisual?.spotId;
        if (
            specialActivated &&
            typeof specialSpotId === "number" &&
            Number.isFinite(specialSpotId) &&
            specialSpotId > 0
        ) {
            const scheduleTick = Number.isFinite(tick)
                ? (tick as number)
                : this.services.getCurrentTick();
            const spotHeight =
                typeof specialVisual?.spotHeight === "number" ? specialVisual.spotHeight : 0;
            this.services.enqueueSpotAnimation({
                tick: scheduleTick,
                playerId: player.id,
                spotId: specialSpotId,
                delay: 0,
                height: spotHeight,
            });
        }

        // Play combat sound immediately when animation starts
        // Note: The cache doesn't have frameSounds for most attack animations,
        // so the server sends sounds directly
        if (specialActivated && weaponItemId > 0) {
            const specDef = this.services.getSpecialAttack(weaponItemId);
            // Use ammo-resolved soundId (e.g., Dark bow dragon vs regular arrows) if available
            let resolvedSoundId: number | undefined;
            if (specDef) {
                resolvedSoundId = specDef.soundId;
            }
            if (data.special && data.special.specSoundId !== undefined) {
                resolvedSoundId = data.special.specSoundId;
            }
            if (resolvedSoundId && resolvedSoundId > 0) {
                this.services.withDirectSendBypass("special_attack_sound", () =>
                    this.services.broadcastSound(
                        {
                            soundId: resolvedSoundId,
                            x: player.tileX,
                            y: player.tileY,
                            level: player.level,
                        },
                        "special_attack_sound",
                    ),
                );
            }
        } else {
            // Regular attack - play weapon sound at attack time
            const weaponSoundId = this.services.pickCombatSound(player, true);
            if (weaponSoundId > 0) {
                this.services.withDirectSendBypass("combat_attack_sound", () =>
                    this.services.broadcastSound(
                        {
                            soundId: weaponSoundId,
                            x: player.tileX,
                            y: player.tileY,
                            level: player.level,
                        },
                        "combat_attack_sound",
                    ),
                );
            }
        }

        const scheduleTick = Number.isFinite(tick) ? tick : this.services.getCurrentTick();
        this.services.log(
            "info",
            `[combat] player ${player.id} attack NPC ${npc.id} - tick ${scheduleTick}, animation ${
                attackSeq ?? "none"
            }`,
        );
        let attackDelay = hitPayload.attackDelay;
        if (attackDelay === undefined) {
            attackDelay = data.attackDelay;
        }
        if (attackDelay === undefined) {
            attackDelay = this.services.pickAttackSpeed(player);
        }
        attackDelay = Math.max(1, attackDelay);
        player.attackDelay = attackDelay;

        // Keep combat hit resolution aligned with projectile travel so impact never resolves
        // before the launched projectile can actually arrive.
        const projectileSpec = data.projectile as ProjectileParams | undefined;
        const minimumProjectileHitDelay = this.calculateMinimumProjectileHitDelay(
            player,
            npc,
            projectileSpec,
            plannedAttackType,
        );
        let fallbackHitDelay =
            minimumProjectileHitDelay !== undefined
                ? minimumProjectileHitDelay
                : Math.max(1, this.services.pickHitDelay(player));

        // Award magic base XP on cast
        this.awardMagicBaseXpOnCast(player, plannedAttackType, hitPayload, effects);

        // Schedule hits for each hit payload
        let hitIndex = 0;
        for (const entryData of hitPayloads) {
            const {
                hitDelay: rawHitDelay = fallbackHitDelay,
                damage: rawDamage = 0,
                maxHit: rawMaxHit = 0,
                style: explicitStyle,
                type2: rawType2,
                damage2: rawDamage2,
                expectedHitTick,
                landed,
                attackType: entryAttackType,
                attackStyleMode,
                spellId,
                ammoEffect,
            } = entryData;
            const hitDelay = Math.max(1, Math.ceil(rawHitDelay), minimumProjectileHitDelay ?? 0);
            const damage = Math.max(0, rawDamage);
            const maxHit = Math.max(0, rawMaxHit);
            const style = explicitStyle ?? (damage > 0 || landed ? HITMARK_DAMAGE : HITMARK_BLOCK);
            const type2 = Number.isFinite(rawType2) ? rawType2 : undefined;
            const damage2 = Number.isFinite(rawDamage2) ? rawDamage2 : undefined;
            const minimumExpectedHitTick = scheduleTick + hitDelay;
            const resolvedExpectedHitTick =
                expectedHitTick !== undefined
                    ? Math.max(minimumExpectedHitTick, expectedHitTick)
                    : minimumExpectedHitTick;
            let retaliateDamage = hitPayload.retaliateDamage;
            if (retaliateDamage === undefined) {
                retaliateDamage = this.services.rollRetaliateDamage(npc, player);
            }
            if (retaliateDamage === undefined) {
                retaliateDamage = 0;
            }
            retaliateDamage = Math.max(0, retaliateDamage);
            const totalRetaliationDelay = Math.max(1, hitPayload.retaliationDelay ?? attackDelay);

            const hitData = {
                npcId: npc.id,
                damage,
                maxHit,
                style,
                type2,
                damage2,
                attackDelay,
                hitDelay,
                retaliateDamage,
                retaliationDelay: Math.max(0, totalRetaliationDelay - hitDelay),
                retaliationTotalDelay: totalRetaliationDelay,
                expectedHitTick: resolvedExpectedHitTick,
                landed: !!landed,
                attackType: entryAttackType,
                attackStyleMode,
                spellId,
                special: data.special,
                ammoEffect,
                hitIndex: hitIndex++,
                xpGrantedOnAttack: false,
            };
            const hitResult = this.services.scheduleAction(
                player.id,
                {
                    kind: "combat.playerHit",
                    data: hitData,
                    groups: ["combat.hit"],
                    cooldownTicks: 0,
                    delayTicks: hitDelay,
                },
                scheduleTick,
            );
            if (!hitResult.ok) {
                this.services.log(
                    "warn",
                    `[combat] failed to schedule player hit (player=${player.id}, npc=${npc.id}): ${
                        hitResult.reason ?? "unknown"
                    }`,
                );
                continue;
            }

            const resolvedAttackType =
                this.services.normalizeAttackType(entryAttackType) ?? plannedAttackType;
            const shouldGrantXpOnAttack =
                resolvedAttackType !== "magic" && this.resolveHitLanded(landed, style, damage);
            if (shouldGrantXpOnAttack && damage > 0) {
                hitData.xpGrantedOnAttack = true;
                this.services.awardCombatXp(player, damage, hitData, effects);
            }
        }

        // Spawn projectile if applicable.
        // OSRS: Dark bow special attack uses different projectile graphics.
        // Dragon arrows: 1099 (dragon heads), Other arrows: 1101 (smoke arrows).
        const special = data.special;
        const spawnProjectile = (baseProjectile: ProjectileParams): void => {
            let projectileToSpawn = baseProjectile;
            if (special) {
                const overrideProjectileId = special.specProjectileId;
                if (
                    overrideProjectileId !== undefined &&
                    baseProjectile.projectileId !== overrideProjectileId
                ) {
                    projectileToSpawn = {
                        ...baseProjectile,
                        projectileId: overrideProjectileId,
                    };
                }
            }

            if (!projectileToSpawn.projectileId) {
                return;
            }

            const timing = this.services.estimateProjectileTiming({
                player,
                targetX: npc.tileX,
                targetY: npc.tileY,
                projectileDefaults: projectileToSpawn,
                pathService,
            });
            const launch = this.services.buildPlayerRangedProjectileLaunch({
                player,
                npc,
                projectile: projectileToSpawn,
                timing,
            });
            if (launch) {
                effects.push({
                    type: "projectile",
                    playerId: player.id,
                    projectile: launch,
                });
            }
        };

        if (projectileSpec) {
            spawnProjectile(projectileSpec);
        }

        // OSRS: Dark bow fires 2 arrows.
        const additionalProjectiles = data.additionalProjectiles;
        if (additionalProjectiles) {
            for (const additionalProjectile of additionalProjectiles) {
                spawnProjectile(additionalProjectile);
            }
        }

        if (!this.services.isActiveFrame() && effects.length > 0) {
            this.services.dispatchActionEffects(effects);
        }
        return { ok: true, cooldownTicks: attackDelay, groups: ["combat.attack"], effects };
    }

    /**
     * Execute combat autocast action (PvP magic autocast).
     */
    executeCombatAutocastAction(
        player: PlayerState,
        data: CombatAutocastActionData,
        tick: number,
    ): ActionExecutionResult {
        // Keep autocast pacing consistent even on failure
        try {
            player.lastSpellCastTick = tick;
        } catch {}

        const targetId = data.targetId;
        const target = targetId > 0 ? this.services.getPlayer(targetId) : undefined;
        const sock = this.services.getPlayerSocket(player.id);
        const interactionState = sock ? this.services.getInteractionState(sock) : undefined;

        if (
            !target ||
            !interactionState ||
            interactionState.kind !== "playerCombat" ||
            (interactionState.playerId ?? 0) !== targetId
        ) {
            try {
                if (sock) this.services.stopPlayerCombat(sock);
            } catch {}
            return { ok: true, cooldownTicks: 0, groups: [], effects: [] };
        }

        const spellIdRaw = data.spellId ?? -1;
        const spellId = spellIdRaw > 0 ? spellIdRaw : player.combatSpellId ?? -1;
        if (!(spellId > 0)) {
            this.services.log(
                "info",
                `[combat] disabling autocast (pvp) for player ${player.id}: missing spellId`,
            );
            this.disableAutocast(player, sock);
            return { ok: true, cooldownTicks: 0, groups: [], effects: [] };
        }

        const castModeRaw = String(data.castMode ?? "autocast");
        const castMode =
            castModeRaw === "defensive_autocast" ? "defensive_autocast" : ("autocast" as const);

        const outcome = this.services.processSpellCastRequest(player, {
            spellId: spellId,
            modifiers: { isAutocast: true, castMode },
            target: { type: "player", playerId: target.id },
        });
        this.services.queueSpellResult(player.id, outcome);

        const reason = outcome.reason;
        const shouldKeepAutocasting =
            reason === "out_of_range" || reason === "line_of_sight" || reason === "cooldown";
        if (outcome.outcome === "failure" && !shouldKeepAutocasting) {
            this.services.log(
                "info",
                `[combat] disabling autocast (pvp) for player ${
                    player.id
                }: spellId=${spellId} targetId=${targetId} reason=${String(reason ?? "unknown")}`,
            );
            this.disableAutocast(player, sock);
        }

        return { ok: true, cooldownTicks: 0, groups: [], effects: [] };
    }

    /**
     * Execute player-vs-player hit action.
     */
    executePlayerVsPlayerHit(
        player: PlayerState,
        data: CombatPlayerHitActionData,
        tick: number,
    ): ActionExecutionResult {
        const {
            targetId = -1,
            damage: rawDamage = 0,
            maxHit: rawMaxHit = 0,
            style = HITMARK_DAMAGE,
            type2: rawType2,
            damage2: rawDamage2,
            landed,
            expectedHitTick = 0,
            spellId: explicitSpellIdRaw,
            attackType: rawAttackType,
        } = data;
        const damage = Math.max(0, rawDamage);
        const maxHit = Math.max(0, rawMaxHit);
        const type2 = Number.isFinite(rawType2) ? rawType2 : undefined;
        const damage2 = Number.isFinite(rawDamage2) ? rawDamage2 : undefined;
        const providedAttackType = this.services.normalizeAttackType(rawAttackType);
        const attackType =
            providedAttackType ?? this.services.deriveAttackTypeFromStyle(style, player);

        const target = this.services.getPlayer(targetId);
        if (!target) {
            this.services.log(
                "warn",
                `[combat] Player-vs-player hit failed: target player ${targetId} not found`,
            );
            return { ok: false, reason: "target_not_found" };
        }

        const effects: ActionEffect[] = [];
        target.refreshActiveCombatTimer();

        // Apply damage with protection prayers
        const currentHp = target.getHitpointsCurrent?.() ?? 0;
        const actualDamage = Math.min(damage, currentHp);
        const mitigatedDamage = this.services.applyProtectionPrayers(
            target,
            actualDamage,
            attackType,
            "player",
        );
        const landedFlag = landed === true ? true : landed === false ? false : undefined;

        // Apply damage
        const targetHitsplat = this.services.applyPlayerHitsplat(
            target,
            style,
            mitigatedDamage,
            tick,
            maxHit,
        );
        this.services.applySmite(player, target, targetHitsplat.amount);
        this.services.tryActivateRedemption(target);
        this.services.closeInterruptibleInterfaces(target);

        this.services.log(
            "info",
            `[combat] Player ${player.id} hit player ${targetId} for ${targetHitsplat.amount} damage (style=${style}, attackType=${attackType})`,
        );

        // Stop one-shot spell interaction (keep for autocast)
        try {
            if (!player.autocastEnabled) {
                const sock = this.services.getPlayerSocket(player.id);
                if (sock) this.services.stopPlayerCombat(sock);
            }
        } catch {}

        // PvP auto-retaliate for target
        this.handlePvpAutoRetaliate(player, target, targetId);

        // Emit hitsplat
        const hitsplatTick = expectedHitTick > 0 ? expectedHitTick : tick;
        const isMagicAttack = attackType === "magic";
        const didLand = landedFlag ?? targetHitsplat.amount > 0;

        if (!(isMagicAttack && !didLand)) {
            const hpFields =
                targetHitsplat.amount > 0
                    ? {
                          hpCurrent: targetHitsplat.hpCurrent,
                          hpMax: targetHitsplat.hpMax,
                      }
                    : {};
            effects.push({
                type: "hitsplat",
                playerId: player.id,
                targetType: "player",
                targetId: targetId,
                damage: targetHitsplat.amount,
                style: targetHitsplat.style,
                type2,
                damage2,
                sourceType: "player",
                sourcePlayerId: player.id,
                tick: hitsplatTick,
                ...hpFields,
            });
        }

        // Magic-specific effects
        if (isMagicAttack) {
            const resolvedSpellId =
                typeof explicitSpellIdRaw === "number" &&
                Number.isFinite(explicitSpellIdRaw) &&
                explicitSpellIdRaw > 0
                    ? explicitSpellIdRaw
                    : player.combatSpellId ?? -1;
            this.handleMagicPvpEffects(
                player,
                target,
                targetId,
                didLand,
                hitsplatTick,
                effects,
                resolvedSpellId,
            );
        }

        if (!this.services.isActiveFrame() && effects.length > 0) {
            this.services.dispatchActionEffects(effects);
        }
        return { ok: true, cooldownTicks: 0, groups: [], effects };
    }

    /**
     * Execute combat player hit action (damage resolution).
     */
    executeCombatPlayerHitAction(
        player: PlayerState,
        data: CombatPlayerHitActionData,
        tick: number,
    ): ActionExecutionResult {
        const targetPlayerId = data.targetId ?? -1;
        const npcId = data.npcId ?? -1;

        // Player-vs-player hit
        if (targetPlayerId > 0 && !npcId) {
            return this.executePlayerVsPlayerHit(player, data, tick);
        }

        // NPC combat
        const npc = this.services.getNpc(npcId);
        if (!npc) {
            return { ok: false, reason: npcId > 0 ? "npc_not_found" : "invalid_npc" };
        }
        if (npc.level !== player.level) {
            return { ok: false, reason: "different_plane" };
        }
        if (npc.isPlayerFollower?.() === true) {
            return { ok: false, reason: "npc_unattackable" };
        }

        const effects: ActionEffect[] = [];

        // OSRS parity: once the swing/cast action has executed and queued this delayed hit,
        // movement no longer cancels it. The only hard stop here is that the target is dead.
        // Dead attackers are already handled by ActionScheduler.processTick(), which skips
        // executing further queued actions for players with 0 HP.
        const attackTypeHint = this.services.normalizeAttackType(
            data.hit?.attackType ?? data.attackType,
        );
        const isMagicAttack = attackTypeHint === "magic";

        // OSRS parity: Once an attack is initiated (animation starts), the hit always lands
        // regardless of whether the player switches targets or clicks away mid-attack.
        // The target NPC ID is baked into the delayed hit action, so we just apply damage.
        const sock = this.services.getPlayerSocket(player.id);

        // Validate NPC is still alive
        if (npc.getHitpoints() <= 0) {
            return { ok: false, reason: "target_already_dead" };
        }

        const {
            damage: rawDamage = 0,
            maxHit: rawMaxHit = 0,
            style = HITMARK_DAMAGE,
            type2: rawType2,
            damage2: rawDamage2,
            clientDelayTicks: rawClientDelayTicks = 0,
            expectedHitTick = 0,
            landed,
            spellId: explicitSpellIdRaw,
            special,
            hitIndex: rawHitIndex = 0,
        } = data;
        const damage = Math.max(0, rawDamage);
        const maxHit = Math.max(0, rawMaxHit);
        const type2 = Number.isFinite(rawType2) ? rawType2 : undefined;
        const damage2 = Number.isFinite(rawDamage2) ? rawDamage2 : undefined;
        const clientDelayTicks = Math.max(0, rawClientDelayTicks);
        const hitsplatTick = expectedHitTick > 0 ? expectedHitTick : tick;

        // OSRS parity: A spell "lands" when the accuracy roll passes, regardless of damage.
        // The landed flag should be set by CombatEngine based on accuracy, not damage.
        // Accept truthy values (not just strict boolean) to handle serialization edge cases.
        const hitLanded = this.resolveHitLanded(landed, style, damage);

        // Apply hitsplat to NPC
        const npcHitsplat = this.services.applyNpcHitsplat(
            npc,
            style,
            damage,
            hitsplatTick,
            maxHit,
        );
        if (npcHitsplat.hpCurrent > 0) {
            const npcCombatSeq = this.services.getNpcCombatSequences(npc.typeId);
            if (npcCombatSeq?.block !== undefined) {
                this.services.broadcastNpcSequence(npc, npcCombatSeq.block);
            }
        }

        // Handle ammo effects
        this.handleAmmoEffects(player, npc, data, npcHitsplat, hitsplatTick);

        // Refresh NPC combat timer
        npc.engageCombat(player.id, tick);

        this.services.confirmHitLanded(
            player.id,
            tick,
            npc,
            Math.max(0, npcHitsplat.amount),
            attackTypeHint,
            player,
        );

        // Award combat XP
        const xpGrantedOnAttack =
            data.xpGrantedOnAttack === true || data.hit?.xpGrantedOnAttack === true;
        if (damage > 0 && hitLanded && !xpGrantedOnAttack) {
            this.services.awardCombatXp(player, damage, data.hit ?? data, effects);
        }

        // Apply special attack effects
        this.handleSpecialAttackEffects(player, npc, data, hitLanded, npcHitsplat, tick);

        // Emit hitsplat effect
        if (!(isMagicAttack && !hitLanded)) {
            const hpFields =
                npcHitsplat.amount > 0
                    ? { hpCurrent: npcHitsplat.hpCurrent, hpMax: npcHitsplat.hpMax }
                    : {};
            effects.push({
                type: "hitsplat",
                playerId: player.id,
                targetType: "npc",
                targetId: npc.id,
                damage: npcHitsplat.amount,
                style: npcHitsplat.style,
                type2,
                damage2,
                sourceType: "player",
                sourcePlayerId: player.id,
                tick: hitsplatTick,
                delayTicks: clientDelayTicks,
                ...hpFields,
            });
        }

        // Magic spell effects
        if (isMagicAttack) {
            const resolvedSpellId =
                typeof explicitSpellIdRaw === "number" &&
                Number.isFinite(explicitSpellIdRaw) &&
                explicitSpellIdRaw > 0
                    ? explicitSpellIdRaw
                    : player.combatSpellId ?? -1;
            this.handleMagicNpcEffects(
                player,
                npc,
                hitLanded,
                npcHitsplat,
                hitsplatTick,
                tick,
                effects,
                resolvedSpellId,
            );
        }

        // Per-hit sounds for multi-hit specials (e.g., dragon claws)
        // Sounds are staggered by ~150ms per hit to match OSRS visual timing
        const hitIndex = Math.max(0, rawHitIndex);
        if (
            special?.hitSounds &&
            Array.isArray(special.hitSounds) &&
            special.hitSounds.length > 0
        ) {
            const hitSoundId = special.hitSounds[Math.min(hitIndex, special.hitSounds.length - 1)];
            if (hitSoundId && hitSoundId > 0) {
                // Stagger sounds: hit 0 = 0ms, hit 1 = 150ms, hit 2 = 300ms, hit 3 = 450ms
                const soundDelay = hitIndex * 150;
                this.services.withDirectSendBypass("special_hit_sound", () =>
                    this.services.broadcastSound(
                        {
                            soundId: hitSoundId,
                            x: npc.tileX,
                            y: npc.tileY,
                            level: npc.level,
                            delay: soundDelay,
                        },
                        "special_hit_sound",
                    ),
                );
            }
        } else {
            // Combat sounds (includes ranged impact sound for projectile attacks)
            this.playCombatSounds(player, npc, hitLanded, style, attackTypeHint);
        }

        // Handle NPC death
        if (npcHitsplat.hpCurrent <= 0) {
            return this.handleNpcDeath(player, npc, tick, effects);
        }

        if (!this.services.isActiveFrame() && effects.length > 0) {
            this.services.dispatchActionEffects(effects);
        }
        return { ok: true, cooldownTicks: 0, groups: [], effects };
    }

    /**
     * Execute NPC retaliation action.
     */
    executeCombatNpcRetaliateAction(
        player: PlayerState,
        data: CombatNpcRetaliateActionData,
        tick: number,
    ): ActionExecutionResult {
        const npcId = data.npcId;

        const npc = this.services.getNpc(npcId);
        if (!npc) {
            return { ok: false, reason: npcId > 0 ? "npc_not_found" : "invalid_npc" };
        }
        if (npc.level !== player.level) {
            return { ok: false, reason: "different_plane" };
        }
        // Do not allow retaliation swings/hits from dead NPCs.
        // This prevents delayed retaliation hitsplats appearing after NPC death.
        if (npc.getHitpoints() <= 0 || npc.isDead(tick)) {
            return { ok: false, reason: "npc_dead" };
        }

        const effects: ActionEffect[] = [];
        const phase = data.phase === "swing" || data.phase === "hit" ? data.phase : "hit";

        if (phase === "swing") {
            return this.handleNpcRetaliateSwing(player, npc, data, tick, effects);
        }

        // Hit phase
        const {
            damage: rawDamage = 0,
            maxHit: rawMaxHit = 0,
            style = HITMARK_DAMAGE,
            type2: rawType2,
            damage2: rawDamage2,
            attackType: rawAttackType,
        } = data;
        const damage = Math.max(0, rawDamage);
        const maxHit = Math.max(0, rawMaxHit);
        const attackType = this.services.resolveNpcAttackType(
            npc,
            this.services.normalizeAttackType(rawAttackType) ?? undefined,
        );
        const mitigatedDamage = this.services.applyProtectionPrayers(
            player,
            damage,
            attackType,
            "npc",
        );
        const type2 = Number.isFinite(rawType2) ? rawType2 : undefined;
        const damage2 = Number.isFinite(rawDamage2) ? rawDamage2 : undefined;

        const playerHitsplat = this.services.applyPlayerHitsplat(
            player,
            style,
            mitigatedDamage,
            tick,
            maxHit,
        );
        this.services.tryActivateRedemption(player);
        this.services.closeInterruptibleInterfaces(player);

        npc.engageCombat(player.id, tick);

        // Player block animation - OSRS parity: only play block animation if no other
        // animation is pending. This prevents block animations from interrupting attack
        // animations when the player attacks and gets hit on the same or adjacent tick.
        // In OSRS, attack animations have effective priority over block animations due
        // to timing, even though they may have the same forcedPriority value.
        if (!player.hasPendingSeq()) {
            const blockSeqCandidate = this.services.pickBlockSequence(player);
            const blockSeq = blockSeqCandidate >= 0 ? blockSeqCandidate : DEFAULT_BLOCK_SEQ;
            player.queueOneShotSeq(blockSeq, 0);
        }

        // Handle auto-retaliate
        const sock = this.services.getPlayerSocket(player.id);
        const interactionState = this.services.getInteractionState(sock);
        if (player.autoRetaliate && sock) {
            this.handlePlayerAutoRetaliate(player, npc, sock, interactionState, tick);
        }

        this.services.log(
            "info",
            `[combat] NPC ${npc.id} retaliate on player ${player.id} - tick ${tick}, damage ${damage}`,
        );

        // Emit hitsplat effect
        // Note: blockSeq is intentionally NOT included here because it's already sent
        // via player sync (queueOneShotSeq above). Sending on both paths caused the
        // animation to restart/play partially when both arrived on the client.
        effects.push({
            type: "hitsplat",
            playerId: player.id,
            targetType: "player",
            targetId: player.id,
            damage: playerHitsplat.amount,
            style: playerHitsplat.style,
            type2,
            damage2,
            sourceType: "npc",
            tick,
            hpCurrent: playerHitsplat.hpCurrent,
            hpMax: playerHitsplat.hpMax,
        });

        // NPC attack sound
        const npcAttackSoundId = this.services.getNpcAttackSoundId(npc.typeId);
        this.services.withDirectSendBypass("combat_npc_sound", () =>
            this.services.broadcastSound(
                {
                    soundId: npcAttackSoundId,
                    x: npc.tileX,
                    y: npc.tileY,
                    level: npc.level,
                    delay: COMBAT_SOUND_DELAY_MS,
                },
                "combat_npc_sound",
            ),
        );

        // Keep the player-side combat focus alive after a successful retaliation.
        this.services.extendAggroHold(player.id, 6);

        if (!this.services.isActiveFrame() && effects.length > 0) {
            this.services.dispatchActionEffects(effects);
        }
        return { ok: true, cooldownTicks: 0, groups: [], effects };
    }

    // ========================================================================
    // Private Helpers
    // ========================================================================

    private faceAngleRs(fromX: number, fromY: number, toX: number, toY: number): number {
        const dx = toX - fromX;
        const dy = toY - fromY;
        const angle = Math.atan2(dx, dy);
        return ((Math.round(angle * (2048 / (2 * Math.PI))) % 2048) + 2048) % 2048;
    }

    private handleRangedAmmoConsumption(
        player: PlayerState,
        npc: NpcState,
        weaponItemId: number,
        hitCount: number,
        tick: number,
        effects: ActionEffect[],
    ): ActionExecutionResult {
        const equip = this.services.getEquipArray(player);
        const equipQty = this.services.getEquipQtyArray(player);

        // ========================================================================
        // Degradable Weapon Handling (Crystal Bow, Bow of Faerdhinen, etc.)
        // OSRS Parity: These weapons don't use ammo but degrade with each shot.
        // Historical crystal bow: Item ID changes every 250 shots (4212→4214→...→4223→seed)
        // ========================================================================
        if (DegradationSystem.isDegradable(weaponItemId)) {
            // Check if weapon was swapped (different item family) - reset charges if so
            const lastItemId = player.degradationLastItemId.get(EquipmentSlot.WEAPON);
            const currentConfig = DegradationSystem.getConfig(weaponItemId);
            const lastConfig = lastItemId ? DegradationSystem.getConfig(lastItemId) : undefined;

            // Different base item (different config) = weapon was swapped, reset charges
            const weaponSwapped =
                lastItemId !== undefined &&
                currentConfig &&
                lastConfig &&
                currentConfig.baseItemId !== lastConfig.baseItemId;

            let currentCharges = weaponSwapped
                ? 0
                : getChargesUsed(player.degradationCharges, EquipmentSlot.WEAPON);

            // Process each shot (for multi-hit attacks like dark bow spec)
            let currentItemId = weaponItemId;
            let chargesUsed = currentCharges;
            let depleted = false;

            for (let i = 0; i < hitCount; i++) {
                const result = DegradationSystem.processUse(currentItemId, chargesUsed);
                currentItemId = result.newItemId;
                chargesUsed = result.chargesUsed;
                depleted = result.depleted;

                if (depleted) break;
            }

            // Update weapon if it changed (degraded or transformed new→full)
            if (currentItemId !== weaponItemId) {
                equip[EquipmentSlot.WEAPON] = currentItemId;
                this.services.markEquipmentDirty(player);
                this.services.markAppearanceDirty(player);
                effects.push({ type: "appearanceUpdate", playerId: player.id });
            }

            // Update charge tracking (unless depleted)
            if (!depleted) {
                setChargesUsed(player.degradationCharges, EquipmentSlot.WEAPON, chargesUsed);
                player.degradationLastItemId.set(EquipmentSlot.WEAPON, currentItemId);
            }

            // Handle full depletion (e.g., crystal bow → crystal seed)
            if (depleted) {
                player.degradationCharges.delete(EquipmentSlot.WEAPON);
                player.degradationLastItemId.delete(EquipmentSlot.WEAPON);
                this.services.queueChatMessage({
                    messageType: "game",
                    text: "Your weapon has reverted to a seed.",
                    targetPlayerIds: [player.id],
                });
            }

            // Degradable weapons don't need ammo - return success
            return { ok: true };
        }

        // ========================================================================
        // Standard Ammo Consumption (Bows, Crossbows, Ballistae)
        // ========================================================================
        const ammoId = equip[EquipmentSlot.AMMO];
        const ammoQty = Math.max(0, equipQty[EquipmentSlot.AMMO]);

        if (!(ammoId > 0) || ammoQty < hitCount) {
            this.services.queueChatMessage({
                messageType: "game",
                text: "You have no ammo left.",
                targetPlayerIds: [player.id],
            });
            return { ok: false, reason: "ammo_missing" };
        }

        // Consume ammo
        const capeId = equip[EquipmentSlot.CAPE];
        const result = this.services.calculateAmmoConsumption(
            weaponItemId,
            ammoId,
            ammoQty,
            capeId,
            npc.tileX,
            npc.tileY,
            Math.random,
        );

        if (result.error) {
            this.services.queueChatMessage({
                messageType: "game",
                text: "You have no ammo left.",
                targetPlayerIds: [player.id],
            });
            return { ok: false, reason: result.error ?? "ammo_missing" };
        }

        if (result.consumed && result.quantityUsed && result.quantityUsed > 0) {
            const remaining = Math.max(0, ammoQty - result.quantityUsed);
            if (remaining <= 0) {
                equip[EquipmentSlot.AMMO] = -1;
                equipQty[EquipmentSlot.AMMO] = 0;
            } else {
                equipQty[EquipmentSlot.AMMO] = remaining;
            }
            this.services.markEquipmentDirty(player);
            this.services.markAppearanceDirty(player);
            effects.push({ type: "appearanceUpdate", playerId: player.id });
        }

        if (result.dropped && result.quantityUsed && result.quantityUsed > 0) {
            const dropX = result.dropTileX ?? npc.tileX;
            const dropY = result.dropTileY ?? npc.tileY;
            const inWilderness = this.services.isInWilderness(dropX, dropY);
            this.services.spawnGroundItem(
                ammoId,
                result.quantityUsed,
                { x: dropX, y: dropY, level: npc.level },
                tick,
                {
                    ownerId: player.id,
                    privateTicks: inWilderness ? 0 : undefined,
                },
            );
        }

        return { ok: true };
    }

    private handleAutocastRuneConsumption(
        player: PlayerState,
        npc: NpcState,
        weaponItemId: number,
    ): ActionExecutionResult {
        const autocastSpellId = player.combatSpellId;
        if (!(Number.isFinite(autocastSpellId) && autocastSpellId > 0)) {
            return { ok: true };
        }

        // Validate staff-spell compatibility
        const compatibility = this.services.canWeaponAutocastSpell(weaponItemId, autocastSpellId);
        if (!compatibility.compatible) {
            const message = this.services.getAutocastCompatibilityMessage(compatibility.reason);
            this.services.queueChatMessage({
                messageType: "game",
                text: message,
                targetPlayerIds: [player.id],
            });
            this.services.resetAutocast(player);
            return { ok: false, reason: compatibility.reason ?? "incompatible_weapon" };
        }

        // Validate and execute spell
        const validation = this.services.validateSpellCast({
            player,
            spellId: autocastSpellId,
            targetNpc: npc,
            isAutocast: true,
        });
        if (!validation.success) {
            if (validation.reason === "level_requirement") {
                this.services.queueChatMessage({
                    messageType: "game",
                    text: "Your Magic level is not high enough to cast this spell.",
                    targetPlayerIds: [player.id],
                });
            } else if (validation.reason === "out_of_runes") {
                this.services.queueChatMessage({
                    messageType: "game",
                    text: "You do not have the runes to cast this spell.",
                    targetPlayerIds: [player.id],
                });
            }
            this.services.resetAutocast(player);
            return { ok: false, reason: validation.reason ?? "spell_failed" };
        }

        const execution = this.services.executeSpellCast(
            { player, spellId: autocastSpellId, targetNpc: npc, isAutocast: true },
            validation,
        );
        if (!execution.success) {
            return { ok: false, reason: execution.reason ?? "spell_failed" };
        }

        player.markInventoryDirty();
        return { ok: true };
    }

    private calculateMinimumProjectileHitDelay(
        player: PlayerState,
        npc: NpcState,
        projectileSpec: ProjectileParams | undefined,
        attackType: AttackType | undefined,
    ): number | undefined {
        const pathService = this.services.getPathService();

        if (projectileSpec && projectileSpec.projectileId) {
            const timing = this.services.estimateProjectileTiming({
                player,
                targetX: npc.tileX,
                targetY: npc.tileY,
                projectileDefaults: projectileSpec,
                pathService,
            });
            if (timing) {
                return Math.max(1, Math.ceil(timing.startDelay + timing.travelTime));
            }
        }

        if (attackType !== "magic") {
            return undefined;
        }

        const spellId = player.combatSpellId ?? -1;
        const spellData = spellId > 0 ? this.services.getSpellData(spellId) : undefined;
        if (spellData && spellData.category === "combat") {
            const projectileDefaults = this.services.getProjectileParams(spellData.projectileId);
            const timing = this.services.estimateProjectileTiming({
                player,
                targetX: npc.tileX,
                targetY: npc.tileY,
                projectileDefaults,
                spellData,
                pathService,
            });
            if (timing) {
                return Math.max(1, Math.ceil(timing.startDelay + timing.travelTime));
            }
        }

        return undefined;
    }

    private resolveHitLanded(landed: unknown, style: number, damage: number): boolean {
        return (
            landed === true ||
            landed === 1 ||
            landed === "true" ||
            (landed === undefined && style === HITMARK_DAMAGE) ||
            (landed === undefined && style !== HITMARK_DAMAGE && damage > 0)
        );
    }

    private awardMagicBaseXpOnCast(
        player: PlayerState,
        attackType: AttackType | undefined,
        hitPayload: HitPayload | undefined,
        effects: ActionEffect[],
    ): void {
        if (attackType !== "magic") return;

        const spellId = player.combatSpellId ?? -1;
        const spellData = spellId > 0 ? this.services.getSpellData(spellId) : undefined;
        if (!spellData || spellData.category !== "combat") return;

        const baseXp = this.services.getSpellBaseXp(spellId);
        if (baseXp <= 0) return;
        const multiplierRaw = this.services.getSkillXpMultiplier?.(player) ?? 1;
        const xpMultiplier =
            Number.isFinite(multiplierRaw) && multiplierRaw > 0 ? multiplierRaw : 1;
        const awardedXp = baseXp * xpMultiplier;
        if (awardedXp <= 0) return;

        const skill = player.getSkill(6); // SkillId.Magic
        const currentXp = skill.xp;
        const MAX_XP = 200_000_000;
        const newXp = Math.min(MAX_XP, currentXp + awardedXp);

        if (newXp > currentXp) {
            const oldCombatLevel = player.combatLevel;
            const oldLevel = skill.baseLevel;
            player.setSkillXp(6, newXp);
            const newLevel = player.getSkill(6).baseLevel;
            if (newLevel > oldLevel) {
                effects.push({
                    type: "levelUp",
                    playerId: player.id,
                    skillId: 6,
                    newLevel,
                    levelIncrement: Math.max(1, newLevel - oldLevel),
                });
            }
            const newCombatLevel = player.combatLevel;
            if (newCombatLevel > oldCombatLevel) {
                effects.push({
                    type: "combatLevelUp",
                    playerId: player.id,
                    newLevel: newCombatLevel,
                    levelIncrement: Math.max(1, newCombatLevel - oldCombatLevel),
                });
            }
            const sync = player.takeSkillSync();
            if (sync) {
                this.services.queueSkillSnapshot(player.id, sync);
            }
        }
    }

    private disableAutocast(player: PlayerState, sock: unknown | undefined): void {
        try {
            this.services.resetAutocast(player);
        } catch {}
        try {
            if (sock) this.services.stopPlayerCombat(sock);
        } catch {}
    }

    private handlePvpAutoRetaliate(
        attacker: PlayerState,
        target: PlayerState,
        targetId: number,
    ): void {
        try {
            if (
                target.autoRetaliate &&
                target.autocastEnabled &&
                Number.isFinite(target.combatSpellId) &&
                target.combatSpellId > 0
            ) {
                const targetSock = this.services.getPlayerSocket(targetId);
                if (targetSock) {
                    const st = this.services.getInteractionState(targetSock);
                    const alreadyOnAttacker =
                        st?.kind === "playerCombat" && (st.playerId ?? 0) === attacker.id;
                    const isIdle = !st;
                    const isBusyNpc = st?.kind === "npcCombat";
                    const isBusyPlayer = st?.kind === "playerCombat" && !alreadyOnAttacker;
                    if (!isBusyNpc && !isBusyPlayer && (isIdle || alreadyOnAttacker)) {
                        this.services.startPlayerCombat(targetSock, attacker.id);
                    }
                }
            }
        } catch {}
    }

    private handleMagicPvpEffects(
        player: PlayerState,
        target: PlayerState,
        targetId: number,
        landed: boolean,
        hitsplatTick: number,
        effects: ActionEffect[],
        spellIdOverride?: number,
    ): void {
        const spellId =
            (Number.isFinite(spellIdOverride) ? spellIdOverride : undefined) ??
            player.combatSpellId ??
            -1;
        const spell = spellId > 0 ? this.services.getSpellData(spellId) : undefined;
        const weaponId = player.combatWeaponItemId ?? -1;
        const poweredStaffData = weaponId > 0 ? getPoweredStaffSpellData(weaponId) : undefined;

        const sfx = this.pickResolvedMagicSound(spellId, landed, poweredStaffData);
        if (sfx !== undefined) {
            this.services.withDirectSendBypass("combat_player_hit_sound", () =>
                this.services.broadcastSound(
                    {
                        soundId: sfx,
                        x: target.tileX,
                        y: target.tileY,
                        level: target.level,
                        delay: COMBAT_SOUND_DELAY_MS,
                    },
                    "combat_player_hit_sound",
                ),
            );
        }

        // Stat debuffs
        if (spell?.statDebuff && landed) {
            const targetSock = this.services.getPlayerSocket(targetId);
            const skillId =
                spell.statDebuff.stat === "attack"
                    ? 0
                    : spell.statDebuff.stat === "strength"
                    ? 2
                    : 1;
            const cur = target.getSkill(skillId);
            const currentLevel = Math.max(1, cur.baseLevel + cur.boost);
            const drop = Math.max(
                1,
                Math.floor((currentLevel * Math.max(0, spell.statDebuff.percent)) / 100),
            );
            const newLevel = Math.max(1, currentLevel - drop);
            target.setSkillBoost(skillId, newLevel);
            if (targetSock) this.services.sendSkillsMessage(targetSock, target);
        }

        // Spot animation
        const impactSpotAnim = spell?.impactSpotAnim ?? poweredStaffData?.impactSpotAnim;
        const splashSpotAnim = spell?.splashSpotAnim ?? poweredStaffData?.splashSpotAnim;
        const spotId = landed ? impactSpotAnim : splashSpotAnim ?? impactSpotAnim;
        if (spotId !== undefined && spotId >= 0) {
            this.services.enqueueSpotAnimation({
                tick: hitsplatTick,
                playerId: targetId,
                spotId: spotId,
                delay: 0,
                height: 100,
            });
        }

        // Freeze
        if (spell?.freezeDuration && landed) {
            target.applyFreeze(spell.freezeDuration, hitsplatTick);
        }
    }

    private handleAmmoEffects(
        player: PlayerState,
        npc: NpcState,
        data: CombatPlayerHitActionData,
        npcHitsplat: { amount: number },
        hitsplatTick: number,
    ): void {
        const ammoEffect = data.ammoEffect as
            | {
                  effectType?: string;
                  graphicId?: number;
                  selfDamage?: number;
                  leechPercent?: number;
                  poison?: boolean;
              }
            | undefined;

        if (!ammoEffect) return;

        if (typeof ammoEffect.graphicId === "number" && ammoEffect.graphicId > 0) {
            this.services.enqueueSpotAnimation({
                tick: hitsplatTick,
                npcId: npc.id,
                spotId: ammoEffect.graphicId,
                delay: 0,
            });
        }

        const dealt = Math.max(0, npcHitsplat.amount);
        if (ammoEffect.poison && dealt > 0) {
            npc.inflictPoison(5, hitsplatTick);
        }
        if (ammoEffect.leechPercent && dealt > 0) {
            const heal = Math.floor(dealt * Math.max(0, ammoEffect.leechPercent));
            if (heal > 0) {
                player.applyHitpointsHeal(heal);
            }
        }
        if (ammoEffect.selfDamage && ammoEffect.selfDamage > 0) {
            player.applyHitpointsDamage(Math.max(0, ammoEffect.selfDamage));
        }
    }

    private handleSpecialAttackEffects(
        player: PlayerState,
        npc: NpcState,
        data: CombatPlayerHitActionData,
        landed: boolean,
        npcHitsplat: { amount: number },
        tick: number,
    ): void {
        const special = data.special as SpecialAttackPayload | undefined;
        const se = special?.effects;
        if (!se || !landed) return;

        const dealt = npcHitsplat.amount;

        // Freeze
        const freezeTicks = se.freezeTicks;
        if (typeof freezeTicks === "number" && Number.isFinite(freezeTicks) && freezeTicks > 0) {
            npc.applyFreeze(freezeTicks, tick);
        }

        // Heal on damage
        const healFraction = se.healFraction;
        if (
            dealt > 0 &&
            typeof healFraction === "number" &&
            Number.isFinite(healFraction) &&
            healFraction > 0
        ) {
            player.applyHitpointsHeal(Math.floor(dealt * healFraction));
        }

        // Prayer restore
        const prayerFraction = se.prayerFraction;
        if (
            dealt > 0 &&
            typeof prayerFraction === "number" &&
            Number.isFinite(prayerFraction) &&
            prayerFraction > 0
        ) {
            const restore = Math.floor(dealt * prayerFraction);
            if (restore > 0) {
                const current = player.getPrayerLevel();
                const base = player.getSkill(5).baseLevel; // SkillId.Prayer
                const target = Math.min(base, current + restore);
                player.setSkillBoost(5, target);
            }
        }

        const sync = player.takeSkillSync();
        if (sync) {
            this.services.queueSkillSnapshot(player.id, sync);
        }
    }

    private handleMagicNpcEffects(
        player: PlayerState,
        npc: NpcState,
        landed: boolean,
        npcHitsplat: { amount: number; style: number },
        hitsplatTick: number,
        tick: number,
        effects: ActionEffect[],
        spellIdOverride?: number,
    ): void {
        const spellId =
            (Number.isFinite(spellIdOverride) ? spellIdOverride : undefined) ??
            player.combatSpellId ??
            -1;
        const spell = spellId > 0 ? this.services.getSpellData(spellId) : undefined;

        // For powered staves (Trident, Tumeken's Shadow, etc.), get built-in spell data
        const weaponId = player.combatWeaponItemId ?? -1;
        const poweredStaffData = weaponId > 0 ? getPoweredStaffSpellData(weaponId) : undefined;

        // Determine impact/splash spot animation from either regular spell or powered staff
        let impactSpotAnim: number | undefined;
        let splashSpotAnim: number | undefined;

        if (spell) {
            impactSpotAnim = spell.impactSpotAnim;
            splashSpotAnim = spell.splashSpotAnim;
        } else if (poweredStaffData) {
            // Powered staff built-in spell (Tumeken's Shadow, Trident, Sanguinesti, etc.)
            impactSpotAnim = poweredStaffData.impactSpotAnim;
            splashSpotAnim = poweredStaffData.splashSpotAnim;
        }

        // Spot animation
        const spotId = landed ? impactSpotAnim : splashSpotAnim ?? impactSpotAnim;
        if (spotId !== undefined && spotId >= 0) {
            this.services.enqueueSpotAnimation({
                tick: hitsplatTick,
                npcId: npc.id,
                spotId: spotId,
                delay: 0,
                height: 100,
            });
        }

        const spellSoundId = this.pickResolvedMagicSound(spellId, landed, poweredStaffData);
        if (spellSoundId !== undefined) {
            this.services.withDirectSendBypass("combat_spell_impact_sound", () =>
                this.services.broadcastSound(
                    {
                        soundId: spellSoundId,
                        x: npc.tileX,
                        y: npc.tileY,
                        level: npc.level,
                        delay: COMBAT_SOUND_DELAY_MS,
                    },
                    "combat_spell_impact_sound",
                ),
            );
        }

        // Freeze and multi-target
        if (spell?.freezeDuration && landed) {
            npc.applyFreeze(spell.freezeDuration, tick);
        }
        if (spell?.maxTargets && spell.maxTargets > 1 && landed && npcHitsplat.amount > 0) {
            this.services.applyMultiTargetSpellDamage({
                player,
                primary: npc,
                spell,
                baseDamage: npcHitsplat.amount,
                style: npcHitsplat.style,
                hitsplatTick,
                currentTick: tick,
                effects,
            });
        }
    }

    private pickResolvedMagicSound(
        spellId: number,
        landed: boolean,
        poweredStaffData?: PoweredStaffSpellData,
    ): number | undefined {
        if (spellId > 0) {
            return this.services.pickSpellSound(spellId, landed ? "impact" : "splash");
        }
        if (!landed && poweredStaffData) {
            return this.services.pickSpellSound(0, "splash");
        }
        if (landed && poweredStaffData?.impactSoundId) {
            return poweredStaffData.impactSoundId;
        }
        return undefined;
    }

    private playCombatSounds(
        player: PlayerState,
        npc: NpcState,
        landed: boolean,
        style: number,
        attackType?: AttackType,
    ): void {
        // Weapon sound is already played at attack time in executeCombatAttackAction
        // Here we play the NPC reaction sounds and ranged impact sounds when the hit lands
        const isHitForSound = landed && style === HITMARK_DAMAGE;

        // OSRS parity: Play ranged projectile impact sound at target location
        // This is the sound of arrows/bolts/darts hitting (separate from weapon fire sound)
        if (attackType === "ranged") {
            const impactSoundId = this.services.getRangedImpactSound?.(player);
            if (impactSoundId !== undefined && impactSoundId > 0) {
                this.services.withDirectSendBypass("combat_ranged_impact_sound", () =>
                    this.services.broadcastSound(
                        {
                            soundId: impactSoundId,
                            x: npc.tileX,
                            y: npc.tileY,
                            level: npc.level,
                        },
                        "combat_ranged_impact_sound",
                    ),
                );
            }
        }

        if (isHitForSound) {
            // NPC got hit - play their hit/pain sound
            const npcHitSoundId = this.services.getNpcHitSoundId(npc.typeId);
            if (npcHitSoundId !== undefined && npcHitSoundId > 0) {
                this.services.withDirectSendBypass("combat_npc_hit_sound", () =>
                    this.services.broadcastSound(
                        {
                            soundId: npcHitSoundId,
                            x: npc.tileX,
                            y: npc.tileY,
                            level: npc.level,
                        },
                        "combat_npc_hit_sound",
                    ),
                );
            }
        } else {
            // Player missed - play NPC defend/block sound
            const npcDefendSoundId = this.services.getNpcDefendSoundId(npc.typeId);
            if (npcDefendSoundId !== undefined && npcDefendSoundId > 0) {
                this.services.withDirectSendBypass("combat_npc_defend_sound", () =>
                    this.services.broadcastSound(
                        {
                            soundId: npcDefendSoundId,
                            x: npc.tileX,
                            y: npc.tileY,
                            level: npc.level,
                        },
                        "combat_npc_defend_sound",
                    ),
                );
            }
        }
    }

    private handleNpcDeath(
        player: PlayerState,
        npc: NpcState,
        tick: number,
        effects: ActionEffect[],
    ): ActionExecutionResult {
        if (npc.isDead(tick)) {
            if (!this.services.isActiveFrame() && effects.length > 0) {
                this.services.dispatchActionEffects(effects);
            }
            return { ok: true, cooldownTicks: 0, groups: [], effects };
        }

        this.services.log("info", `[combat] NPC ${npc.id} (type ${npc.typeId}) died`);
        npc.clearInteractionTarget();

        // Prepare drops for delayed spawning (RSMod parity)
        const eligibility = this.services.getDropEligibility(npc);
        const inWilderness = this.services.isInWilderness(npc.tileX, npc.tileY);
        const pendingDrops = this.services
            .rollNpcDrops(npc, eligibility)
            .map((drop) => ({ ...drop, isWilderness: inWilderness }));

        // Death sequence
        const deathSeq = this.services.getNpcCombatSequences(npc.typeId)?.death;
        if (deathSeq !== undefined && deathSeq >= 0) {
            npc.queueOneShotSeq(deathSeq);
            this.services.broadcastNpcSequence(npc, deathSeq);
            npc.popPendingSeq();
        }

        // Death sound
        const deathSoundId = this.services.getNpcDeathSoundId(npc.typeId);
        if (deathSoundId !== undefined && deathSoundId > 0) {
            this.services.withDirectSendBypass("combat_npc_death_sound", () =>
                this.services.broadcastSound(
                    {
                        soundId: deathSoundId,
                        x: npc.tileX,
                        y: npc.tileY,
                        level: npc.level,
                        delay: COMBAT_SOUND_DELAY_MS,
                    },
                    "combat_npc_death_sound",
                ),
            );
        }

        // Clear interactions
        this.services.clearInteractionsWithNpc(npc.id);

        // Cancel pending combat actions for any player queue this NPC could have queued into.
        const affectedPlayerIds = new Set<number>([player.id]);
        const npcTargetPlayerId = npc.getCombatTargetPlayerId();
        if (npcTargetPlayerId !== undefined && npcTargetPlayerId >= 0) {
            affectedPlayerIds.add(npcTargetPlayerId);
        }
        for (const affectedPlayerId of affectedPlayerIds) {
            this.services.cancelActions(affectedPlayerId, (action) => {
                const actionNpcId =
                    action.kind === "combat.attack" ||
                    action.kind === "combat.playerHit" ||
                    action.kind === "combat.npcRetaliate"
                        ? (
                              action.data as
                                  | CombatAttackActionData
                                  | CombatPlayerHitActionData
                                  | CombatNpcRetaliateActionData
                          ).npcId
                        : undefined;
                return (
                    actionNpcId === npc.id &&
                    (action.groups.includes("combat.attack") ||
                        action.groups.includes("combat.retaliate") ||
                        action.groups.includes("combat.hit"))
                );
            });
        }

        // Queue respawn with delayed drops (RSMod parity)
        const RESPAWN_DELAY_TICKS = 17;
        const deathDelayTicks = this.services.estimateNpcDespawnDelayTicksFromSeq(deathSeq);
        const despawnTick = tick + Math.max(1, deathDelayTicks);
        const respawnTick = Math.max(tick + RESPAWN_DELAY_TICKS, despawnTick + 1);
        try {
            npc.markDeadUntil(despawnTick, tick);
        } catch {}
        const queued = this.services.queueNpcDeath(npc.id, despawnTick, respawnTick, pendingDrops);
        if (!queued) {
            this.services.log(
                "warn",
                `[combat] Failed to queue NPC respawn (npc=${npc.id}, respawnTick=${respawnTick})`,
            );
        }

        this.services.cleanupNpc(npc);

        // League task: Notify task manager of NPC kill (auto-completes matching tasks)
        const killerId = eligibility?.primaryLooter?.id ?? player.id;
        this.services.onNpcKill(killerId, npc.typeId);

        if (!this.services.isActiveFrame() && effects.length > 0) {
            this.services.dispatchActionEffects(effects);
        }
        return { ok: true, cooldownTicks: 0, groups: [], effects };
    }

    private handleNpcRetaliateSwing(
        player: PlayerState,
        npc: NpcState,
        data: CombatNpcRetaliateActionData,
        tick: number,
        effects: ActionEffect[],
    ): ActionExecutionResult {
        const pathService = this.services.getPathService();
        const attackType = this.services.resolveNpcAttackType(
            npc,
            this.services.normalizeAttackType(data.attackType) ?? undefined,
        );
        const attackRange = this.services.resolveNpcAttackRange(npc, attackType);
        if (
            !canNpcAttackPlayerFromCurrentPosition(npc, player, attackRange, attackType, {
                pathService,
            })
        ) {
            return { ok: false, reason: "not_in_range" };
        }
        player.refreshActiveCombatTimer();

        // Play attack animation
        const npcCombatSeq = this.services.getNpcCombatSequences(npc.typeId);
        if (npcCombatSeq?.attack !== undefined) {
            npc.queueOneShotSeq(npcCombatSeq.attack, 0);
            this.services.broadcastNpcSequence(npc, npcCombatSeq.attack);
            npc.popPendingSeq();
        }

        // Schedule hit.
        // Melee retaliation hits resolve 1 tick after swing; ranged/magic keep their travel delay.

        // Compute damage if not provided (e.g., for aggression-initiated attacks)
        const {
            damage: rawDamage = 0,
            maxHit: rawMaxHit = 0,
            isAggression = false,
            style = HITMARK_DAMAGE,
            type2: rawType2,
            damage2: rawDamage2,
            hitDelay: rawHitDelay = 1,
        } = data;
        let damage = Math.max(0, rawDamage);
        const maxHit = Math.max(0, rawMaxHit);
        if (damage === 0 && isAggression) {
            // Roll NPC damage for aggression attack using actual NPC stats
            damage = this.services.rollRetaliateDamage(npc, player);
        }
        const type2 = Number.isFinite(rawType2) ? rawType2 : undefined;
        const damage2 = Number.isFinite(rawDamage2) ? rawDamage2 : undefined;
        const hitDelay = Math.max(1, rawHitDelay);
        const enqueueResult = this.services.scheduleAction(
            player.id,
            {
                kind: "combat.npcRetaliate",
                data: {
                    npcId: npc.id,
                    damage,
                    maxHit,
                    style,
                    type2,
                    damage2,
                    attackType,
                    phase: "hit",
                },
                groups: ["combat.retaliate"],
                cooldownTicks: 0,
                delayTicks: hitDelay,
            },
            tick,
        );
        if (!enqueueResult.ok) {
            this.services.log(
                "warn",
                `[combat] failed to schedule npc retaliation hit (player=${player.id}, npc=${
                    npc.id
                }): ${enqueueResult.reason ?? "unknown"}`,
            );
        }

        if (!this.services.isActiveFrame() && effects.length > 0) {
            this.services.dispatchActionEffects(effects);
        }
        return { ok: true, cooldownTicks: 0, groups: [], effects };
    }

    executeCombatCompanionHitAction(
        player: PlayerState,
        data: CombatCompanionHitActionData,
        tick: number,
    ): ActionExecutionResult {
        const companionNpcId = data.companionNpcId | 0;
        const targetNpcId = data.targetNpcId | 0;
        const companion = this.services.getNpc(companionNpcId);
        if (!companion) {
            return {
                ok: false,
                reason: companionNpcId > 0 ? "companion_not_found" : "invalid_companion",
            };
        }

        const follower = companion.getFollowerState();
        if (!follower || follower.ownerPlayerId !== player.id) {
            return { ok: false, reason: "not_owner" };
        }

        const npc = this.services.getNpc(targetNpcId);
        if (!npc) {
            return { ok: false, reason: targetNpcId > 0 ? "npc_not_found" : "invalid_npc" };
        }
        if (npc.level !== companion.level || npc.level !== player.level) {
            return { ok: false, reason: "different_plane" };
        }
        if (npc.isPlayerFollower?.() === true) {
            return { ok: false, reason: "npc_unattackable" };
        }
        if (npc.getHitpoints() <= 0 || npc.isDead(tick)) {
            return { ok: false, reason: "npc_dead" };
        }

        const effects: ActionEffect[] = [];
        const damage = Math.max(0, data.damage ?? 0);
        const maxHit = Math.max(0, data.maxHit ?? 0);
        const style = Number.isFinite(data.style) ? (data.style as number) : HITMARK_DAMAGE;
        const type2 = Number.isFinite(data.type2) ? data.type2 : undefined;
        const damage2 = Number.isFinite(data.damage2) ? data.damage2 : undefined;
        const attackTypeHint = this.services.normalizeAttackType(data.attackType) ?? "melee";

        const npcHitsplat = this.services.applyNpcHitsplat(npc, style, damage, tick, maxHit);
        if (npcHitsplat.hpCurrent > 0) {
            const npcCombatSeq = this.services.getNpcCombatSequences(npc.typeId);
            if (npcCombatSeq?.block !== undefined) {
                this.services.broadcastNpcSequence(npc, npcCombatSeq.block);
            }
        }

        npc.engageCombat(player.id, tick);

        const sock = this.services.getPlayerSocket(player.id);
        this.services.confirmHitLanded(
            player.id,
            tick,
            npc,
            Math.max(0, npcHitsplat.amount),
            attackTypeHint,
            player,
        );

        const hpFields =
            npcHitsplat.amount > 0
                ? { hpCurrent: npcHitsplat.hpCurrent, hpMax: npcHitsplat.hpMax }
                : {};
        effects.push({
            type: "hitsplat",
            playerId: player.id,
            targetType: "npc",
            targetId: npc.id,
            damage: npcHitsplat.amount,
            style: npcHitsplat.style,
            type2,
            damage2,
            sourceType: "follower",
            sourcePlayerId: player.id,
            tick,
            ...hpFields,
        });

        if (npcHitsplat.hpCurrent <= 0) {
            return this.handleNpcDeath(player, npc, tick, effects);
        }

        if (!this.services.isActiveFrame() && effects.length > 0) {
            this.services.dispatchActionEffects(effects);
        }
        return { ok: true, cooldownTicks: 0, groups: [], effects };
    }

    private handlePlayerAutoRetaliate(
        player: PlayerState,
        npc: NpcState,
        sock: unknown,
        interactionState: InteractionState | undefined,
        tick: number,
    ): void {
        const npcId = npc.id;

        if (interactionState?.kind === "playerCombat") {
            // Do not interrupt PvP combat
            return;
        }
        if (interactionState?.kind === "npcCombat" && (interactionState.npcId ?? 0) !== npcId) {
            // Do not switch from existing NPC target
            return;
        }
        if (interactionState?.kind === "npcCombat" && (interactionState.npcId ?? 0) === npcId) {
            this.services.resumeAutoAttack(player.id);
            player.setInteraction("npc", npc.id);
            return;
        }

        // Start new combat
        const attackSpeed = this.services.pickAttackSpeed(player);
        const res = this.services.startNpcAttack(sock, npc, tick, attackSpeed);
        if (res.ok) {
            player.setInteraction("npc", npc.id);
            this.services.startNpcCombat(player, npc, tick, attackSpeed);
        } else {
            this.services.log(
                "info",
                `[combat] auto-retaliate failed (player=${player.id}, npc=${npc.id}): ${
                    res.message ?? "reason_unknown"
                }`,
            );
        }
    }
}
