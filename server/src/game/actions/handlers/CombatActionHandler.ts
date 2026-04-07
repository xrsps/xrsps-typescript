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
import { logger } from "../../../utils/logger";
import { NpcHitHandler } from "./NpcHitHandler";
import { PvpCombatHandler } from "./PvpCombatHandler";
import { NpcRetaliationHandler } from "./NpcRetaliationHandler";
import { CompanionHitHandler } from "./CompanionHitHandler";
import { handleRangedAmmoConsumption, handleAutocastRuneConsumption } from "./CombatHandlerUtils";
import type { ProjectileLaunch } from "../../../../../src/shared/projectiles/ProjectileLaunch";
import type { SpellDataEntry } from "../../spells/SpellDataProvider";
import type { PathService } from "../../../pathfinding/PathService";
import type { AttackType } from "../../combat/AttackType";
import {
    hasProjectileLineOfSightToNpc,
} from "../../combat/CombatAction";
import { resolvePlayerAttackType } from "../../combat/CombatRules";
import type { DropEligibility } from "../../combat/DamageTracker";
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
    /** Apply multi-target spell damage. Returns total secondary target damage dealt. */
    applyMultiTargetSpellDamage(params: {
        player: PlayerState;
        primary: NpcState;
        spell: SpellDataEntry;
        baseDamage: number;
        style: number;
        hitsplatTick: number;
        currentTick: number;
        effects: ActionEffect[];
    }): number;

    // --- XP Awards ---
    /** Award combat XP on hit. */
    awardCombatXp(
        player: PlayerState,
        damage: number,
        hitData: unknown,
        effects: ActionEffect[],
    ): void;
    /** Resolve active skill XP multiplier for the player (e.g. gamemode modifiers). */
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

    // --- Gamemode Events ---
    onNpcKill(playerId: number, npcId: number, combatLevel?: number, npc?: NpcState): void;
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
 * Coordinates domain-specific handlers for PvP, NPC hits, retaliation, and companions.
 */
export class CombatActionHandler {
    private readonly pvpHandler: PvpCombatHandler;
    private readonly npcHitHandler: NpcHitHandler;
    private readonly retaliationHandler: NpcRetaliationHandler;
    private readonly companionHandler: CompanionHitHandler;

    constructor(private readonly services: CombatActionServices) {
        this.pvpHandler = new PvpCombatHandler(services);
        this.npcHitHandler = new NpcHitHandler(
            services,
            (player, data, tick) => this.pvpHandler.executePlayerVsPlayerHit(player, data, tick),
        );
        this.retaliationHandler = new NpcRetaliationHandler(services);
        this.companionHandler = new CompanionHitHandler(
            services,
            (player, npc, tick, effects) => this.npcHitHandler.handleNpcDeath(player, npc, tick, effects),
        );
    }

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
            // do not allow long-reach melee attacks through walls
            const isMelee = resolvePlayerAttackType(player.combat) === "melee";
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
            const result = handleRangedAmmoConsumption(
                this.services,
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
        // Skip if onMagicAttack already handled runes at schedule time (prevents double consumption)
        if (plannedAttackType === "magic" && player.combat.autocastEnabled && !data.magicAutocastHandled) {
            const result = handleAutocastRuneConsumption(this.services, player, npc, weaponItemId);
            if (!result.ok) {
                return result;
            }
        }

        // Queue ranged attack spot animation (only after ammo check passes)
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
                const ok = player.specEnergy.consume(costPercent);
                specialActivated = ok;
                player.varps.setVarpValue(VARP_SPECIAL_ATTACK, 0);
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

        // Queue attack animation & combat sounds
        // Skip when autocast handler already queued the spell cast animation and GFX
        let attackSeq: number | undefined;
        if (!data.magicAutocastHandled) {
            const specialVisual = specialActivated
                ? this.services.pickSpecialAttackVisualOverride(weaponItemId)
                : undefined;
            attackSeq = specialVisual?.seqId ?? this.services.pickAttackSequence(player);
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
        player.combat.attackDelay = attackDelay;

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
        // Skip if onMagicAttack already awarded base XP at schedule time (prevents double XP)
        if (!data.magicAutocastHandled) {
            this.awardMagicBaseXpOnCast(player, plannedAttackType, hitPayload, effects);
        }

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
        return this.pvpHandler.executeCombatAutocastAction(player, data, tick);
    }

    /**
     * Execute player-vs-player hit action.
     */
    executePlayerVsPlayerHit(
        player: PlayerState,
        data: CombatPlayerHitActionData,
        tick: number,
    ): ActionExecutionResult {
        return this.pvpHandler.executePlayerVsPlayerHit(player, data, tick);
    }

    /**
     * Execute combat player hit action (damage resolution).
     */
    executeCombatPlayerHitAction(
        player: PlayerState,
        data: CombatPlayerHitActionData,
        tick: number,
    ): ActionExecutionResult {
        return this.npcHitHandler.executeCombatPlayerHitAction(player, data, tick);
    }

    /**
     * Execute NPC retaliation action.
     */
    executeCombatNpcRetaliateAction(
        player: PlayerState,
        data: CombatNpcRetaliateActionData,
        tick: number,
    ): ActionExecutionResult {
        return this.retaliationHandler.executeCombatNpcRetaliateAction(player, data, tick);
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

        const spellId = player.combat.spellId ?? -1;
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

        const spellId = player.combat.spellId ?? -1;
        const spellData = spellId > 0 ? this.services.getSpellData(spellId) : undefined;
        if (!spellData || spellData.category !== "combat") return;

        const baseXp = this.services.getSpellBaseXp(spellId);
        if (baseXp <= 0) return;
        const multiplierRaw = this.services.getSkillXpMultiplier?.(player) ?? 1;
        const xpMultiplier =
            Number.isFinite(multiplierRaw) && multiplierRaw > 0 ? multiplierRaw : 1;
        const awardedXp = baseXp * xpMultiplier;
        if (awardedXp <= 0) return;

        const skill = player.skillSystem.getSkill(6); // SkillId.Magic
        const currentXp = skill.xp;
        const MAX_XP = 200_000_000;
        const newXp = Math.min(MAX_XP, currentXp + awardedXp);

        if (newXp > currentXp) {
            const oldCombatLevel = player.skillSystem.combatLevel;
            const oldLevel = skill.baseLevel;
            player.skillSystem.setSkillXp(6, newXp);
            const newLevel = player.skillSystem.getSkill(6).baseLevel;
            if (newLevel > oldLevel) {
                effects.push({
                    type: "levelUp",
                    playerId: player.id,
                    skillId: 6,
                    newLevel,
                    levelIncrement: Math.max(1, newLevel - oldLevel),
                });
            }
            const newCombatLevel = player.skillSystem.combatLevel;
            if (newCombatLevel > oldCombatLevel) {
                effects.push({
                    type: "combatLevelUp",
                    playerId: player.id,
                    newLevel: newCombatLevel,
                    levelIncrement: Math.max(1, newCombatLevel - oldCombatLevel),
                });
            }
            const sync = player.skillSystem.takeSkillSync();
            if (sync) {
                this.services.queueSkillSnapshot(player.id, sync);
            }
        }
    }

    private disableAutocast(player: PlayerState, sock: unknown | undefined): void {
        try {
            this.services.resetAutocast(player);
        } catch (err) { logger.warn("[combat] failed to reset autocast", err); }
        try {
            if (sock) this.services.stopPlayerCombat(sock);
        } catch (err) { logger.warn("[combat] failed to stop combat after autocast disable", err); }
    }




    executeCombatCompanionHitAction(
        player: PlayerState,
        data: CombatCompanionHitActionData,
        tick: number,
    ): ActionExecutionResult {
        return this.companionHandler.executeCombatCompanionHitAction(player, data, tick);
    }

}
