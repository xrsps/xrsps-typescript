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
import { AttackType, normalizeAttackType } from "../../combat/AttackType";
import {
    hasProjectileLineOfSightToNpc,
    hasDirectMeleeReach,
    hasDirectMeleePath,
    isWithinAttackRange,
} from "../../combat/CombatAction";
import { resolvePlayerAttackType } from "../../combat/CombatRules";
import type { DropEligibility } from "../../combat/DamageTracker";
import { HITMARK_BLOCK, HITMARK_DAMAGE } from "../../combat/HitEffects";
import type { NpcState } from "../../npc";
import type { PendingNpcDrop } from "../../npcManager";
import type { PlayerAppearance, PlayerState, SkillSyncUpdate } from "../../player";
import type { SpellCastContext, SpellCastOutcome } from "../../spells/SpellCaster";
import { SpellCaster } from "../../spells/SpellCaster";
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
import type { ServerServices } from "../../ServerServices";
import { getSpecialAttack } from "../../combat/SpecialAttackProvider";
import { pickSpecialAttackVisualOverride } from "../../combat/SpecialAttackVisualProvider";
import { getSpellData, canWeaponAutocastSpell, getAutocastCompatibilityMessage } from "../../spells/SpellDataProvider";
import { getSpellBaseXp } from "../../combat/SpellXpProvider";
import { getProjectileParams } from "../../data/ProjectileParamsProvider";
import { isInWilderness } from "../../combat/MultiCombatZones";
import { combatEffectApplicator } from "../../combat/CombatEffectApplicator";
import { calculateAmmoConsumption } from "../../combat/AmmoSystem";
import { ensureEquipQtyArrayOn, consumeEquippedAmmoApply } from "../../equipment";
import { getRangedImpactSound } from "../../combat/WeaponDataProvider";
import { encodeMessage } from "../../../network/messages";
import { WebSocket } from "ws";

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
    private readonly subServices: CombatActionServices;

    constructor(private readonly svc: ServerServices) {
        const subServices = this.buildSubHandlerServices();
        this.subServices = subServices;
        this.pvpHandler = new PvpCombatHandler(subServices);
        this.npcHitHandler = new NpcHitHandler(
            subServices,
            (player, data, tick) => this.pvpHandler.executePlayerVsPlayerHit(player, data, tick),
        );
        this.retaliationHandler = new NpcRetaliationHandler(subServices);
        this.companionHandler = new CompanionHitHandler(
            subServices,
            (player, npc, tick, effects) => this.npcHitHandler.handleNpcDeath(player, npc, tick, effects),
        );
    }

    // ========================================================================
    // Sub-handler adapter
    // ========================================================================

    /**
     * Build a CombatActionServices adapter from the shared ServerServices.
     * Sub-handlers (NpcHitHandler, PvpCombatHandler, etc.) still consume
     * CombatActionServices so this bridges the two interfaces.
     */
    private buildSubHandlerServices(): CombatActionServices {
        const svc = this.svc;
        return {
            getPlayer: (id) => svc.players?.getById(id) ?? undefined,
            getNpc: (id) => svc.npcManager?.getById(id) ?? undefined,
            getCurrentTick: () => svc.ticker.currentTick(),
            getPathService: () => svc.pathService,

            getEquipArray: (player) => svc.equipmentService.ensureEquipArray(player),
            getEquipQtyArray: (player) =>
                ensureEquipQtyArrayOn(player.appearance, EQUIP_SLOT_COUNT),
            markEquipmentDirty: (player) => player.markEquipmentDirty(),
            markAppearanceDirty: (player) => player.markAppearanceDirty(),

            pickAttackSequence: (player) => svc.playerCombatService!.pickAttackSequence(player),
            pickAttackSpeed: (player) => svc.playerCombatService!.pickAttackSpeed(player),
            pickHitDelay: (player) => svc.playerCombatService!.pickHitDelay(player),
            getPlayerAttackReach: (player) => svc.playerCombatService!.getPlayerAttackReach(player),
            pickNpcFaceTile: (player, npc) => svc.playerCombatService!.pickNpcFaceTile(player, npc),
            pickCombatSound: (player, isHit) => svc.playerCombatService!.pickCombatSound(player, isHit),
            getRangedImpactSound: (player) => {
                const equip = svc.equipmentService.ensureEquipArray(player);
                const weaponId = equip[EquipmentSlot.WEAPON];
                return getRangedImpactSound(weaponId);
            },
            deriveAttackTypeFromStyle: (style, player) =>
                svc.playerCombatService!.deriveAttackTypeFromStyle(style, player),
            pickBlockSequence: (player) =>
                svc.playerCombatManager?.pickBlockSequence(player, svc.appearanceService.getWeaponAnimOverrides()) ?? -1,

            getNpcCombatSequences: (typeId) => svc.combatDataService.getNpcCombatSequences(typeId),
            getNpcHitSoundId: (typeId) => svc.combatDataService.getNpcHitSoundId({ typeId } as unknown as NpcState),
            getNpcDefendSoundId: (typeId) => svc.combatDataService.getNpcDefendSoundId({ typeId } as unknown as NpcState),
            getNpcDeathSoundId: (typeId) => svc.combatDataService.getNpcDeathSoundId({ typeId } as unknown as NpcState),
            getNpcAttackSoundId: (typeId) => svc.combatDataService.getNpcAttackSoundId({ typeId } as unknown as NpcState),
            resolveNpcAttackType: (npc, hint) => svc.combatEffectService.resolveNpcAttackType(npc, hint),
            resolveNpcAttackRange: (npc, attackType) => svc.combatEffectService.resolveNpcAttackRange(npc, attackType),
            broadcastNpcSequence: (npc, seqId) => svc.combatEffectService.broadcastNpcSequence(npc, seqId),
            estimateNpcDespawnDelayTicksFromSeq: (seqId) =>
                svc.combatEffectService.estimateNpcDespawnDelayTicksFromSeq(seqId),

            estimateProjectileTiming: (params) => svc.projectileTimingService!.estimateProjectileTiming(params as unknown as { player: PlayerState; targetX?: number; targetY?: number }),
            buildPlayerRangedProjectileLaunch: (params) =>
                svc.projectileTimingService!.buildPlayerRangedProjectileLaunch(params),

            processSpellCastRequest: (player, request) =>
                svc.spellActionHandler!.processSpellCastRequest(
                    player,
                    request as unknown as import("./SpellActionHandler").SpellCastRequest,
                    svc.ticker.currentTick(),
                ),
            queueSpellResult: (playerId, result) => svc.broadcastService.queueSpellResult(playerId, result),
            pickSpellSound: (spellId, stage) => svc.playerCombatService!.pickSpellSound(spellId, stage),
            resetAutocast: (player) => svc.equipmentService.resetAutocast(player),

            broadcastSound: (request, tag) => svc.broadcastService.broadcastSound(request, tag),
            withDirectSendBypass: (tag, fn) => svc.networkLayer.withDirectSendBypass(tag, fn),
            enqueueSpotAnimation: (request) => svc.broadcastService.enqueueSpotAnimation(request),
            queueChatMessage: (request) => svc.messagingService.queueChatMessage(request),
            queueCombatState: (player) => svc.queueCombatState(player),
            queueSkillSnapshot: (playerId, sync) =>
                svc.skillService.queueSkillSnapshot(playerId, sync as SkillSyncUpdate),
            dispatchActionEffects: (effects) =>
                svc.effectDispatcher!.dispatchActionEffects(effects),
            broadcast: (data, tag) => svc.broadcastService.broadcast(data, tag),
            encodeMessage: (msg) => encodeMessage(msg as unknown as import("../../../network/messages").ServerToClient),

            scheduleAction: (playerId, request, tick) =>
                svc.actionScheduler.requestAction(playerId, request, tick),
            cancelActions: (playerId, predicate) =>
                svc.actionScheduler.cancelActions(playerId, predicate),

            getPlayerSocket: (playerId) => svc.players?.getSocketByPlayerId(playerId),
            getInteractionState: (socket) =>
                socket ? svc.players?.getInteractionState(socket as WebSocket) : undefined,
            startNpcAttack: (socket, npc, tick, attackSpeed) =>
                svc.players?.startNpcAttack(socket as WebSocket, npc, tick, attackSpeed) ?? {
                    ok: false,
                },
            stopPlayerCombat: (socket) => svc.players?.stopPlayerCombat(socket as WebSocket),
            startPlayerCombat: (socket, targetId) =>
                svc.players?.startPlayerCombat(socket as WebSocket, targetId),
            clearInteractionsWithNpc: (npcId) => svc.players?.clearInteractionsWithNpc(npcId),
            sendSkillsMessage: (socket, player) => {
                if (socket instanceof WebSocket) {
                    const sync = player.skillSystem.takeSkillSync();
                    if (sync) svc.skillService.queueSkillSnapshot(player.id, sync);
                }
            },

            startNpcCombat: (player, npc, tick, attackSpeed) =>
                svc.playerCombatManager?.startCombat(player, npc, tick, attackSpeed),
            resumeAutoAttack: (playerId) => svc.playerCombatManager?.resumeAutoAttack(playerId),
            confirmHitLanded: (playerId, tick, npc, damage, attackType, player) =>
                svc.playerCombatManager?.confirmHitLanded(
                    playerId,
                    npc,
                    tick,
                    damage,
                    attackType,
                    player,
                ),
            extendAggroHold: (playerId, minimumTicks) =>
                svc.playerCombatManager?.extendAggroHold(playerId, minimumTicks),
            rollRetaliateDamage: (npc, player) =>
                svc.playerCombatManager?.rollRetaliateDamage(npc, player) ?? 0,
            getDropEligibility: (npc) => svc.playerCombatManager?.getDropEligibility?.(npc),
            rollNpcDrops: (npc, eligibility) => svc.combatEffectService.rollNpcDrops(npc, eligibility),
            cleanupNpc: (npc) => svc.playerCombatManager?.cleanupNpc?.(npc),

            spawnGroundItem: (itemId, quantity, location, tick, options) =>
                svc.groundItems.spawn(itemId, quantity, location, tick, options),

            queueNpcDeath: (npcId, despawnTick, respawnTick, drops) =>
                svc.npcManager?.queueDeath?.(npcId, despawnTick, respawnTick, drops) ?? false,

            applyProtectionPrayers: (target, damage, attackType, sourceType) =>
                svc.combatEffectService.applyProtectionPrayers(target, damage, attackType, sourceType),
            applySmite: (attacker, target, damage) => svc.combatEffectService.applySmite(attacker, target, damage),
            tryActivateRedemption: (player) => svc.combatEffectService.tryActivateRedemption(player),
            closeInterruptibleInterfaces: (player) => svc.interfaceManager.closeInterruptibleInterfaces(player),
            applyMultiTargetSpellDamage: (params) => svc.combatEffectService.applyMultiTargetSpellDamage(params),

            awardCombatXp: (player, damage, hitData, effects) =>
                svc.skillService.awardCombatXp(player, damage, hitData as { attackType?: string; attackStyleMode?: string; spellId?: number; spellBaseXpAtCast?: boolean } | undefined, effects),
            getSkillXpMultiplier: (player) => svc.gamemode.getSkillXpMultiplier(player),

            getSpecialAttack: (weaponId) => getSpecialAttack(weaponId),
            pickSpecialAttackVisualOverride: (weaponId) =>
                pickSpecialAttackVisualOverride(weaponId),

            consumeEquippedAmmoApply: (params) => consumeEquippedAmmoApply(params),
            calculateAmmoConsumption: (
                weaponId, ammoId, ammoQty, capeId, targetX, targetY, randFn,
            ) => calculateAmmoConsumption(
                weaponId, ammoId, ammoQty, capeId, targetX, targetY, randFn,
            ),

            canWeaponAutocastSpell: (weaponId, spellId) =>
                canWeaponAutocastSpell(weaponId, spellId),
            getAutocastCompatibilityMessage: (reason) =>
                getAutocastCompatibilityMessage(reason as import("../../spells/SpellDataProvider").AutocastCompatibilityResult["reason"]),

            validateSpellCast: (context) => SpellCaster.validate(context),
            executeSpellCast: (context, validation) => SpellCaster.execute(context, validation),

            getSpellData: (spellId) => getSpellData(spellId),
            getSpellBaseXp: (spellId) => getSpellBaseXp(spellId),
            getProjectileParams: (projectileId) =>
                projectileId !== undefined ? getProjectileParams(projectileId) : undefined,

            applyNpcHitsplat: (npc, style, damage, tick, maxHit) =>
                combatEffectApplicator.applyNpcHitsplat(npc, style, damage, tick, maxHit),
            applyPlayerHitsplat: (player, style, damage, tick, maxHit) =>
                combatEffectApplicator.applyPlayerHitsplat(player, style, damage, tick, maxHit),

            isInWilderness: (x, y) => isInWilderness(x, y),

            isWithinAttackRange: (attacker, target, range) =>
                isWithinAttackRange(attacker, target, range),
            hasDirectMeleeReach: (attacker, target, pathService) =>
                hasDirectMeleeReach(attacker, target, pathService),
            hasDirectMeleePath: (attacker, target, pathService) =>
                hasDirectMeleePath(attacker, target, pathService),

            normalizeAttackType: (value) => normalizeAttackType(value),
            isActiveFrame: () => !!svc.activeFrame,
            log: (level, message) => {
                try {
                    if (level === "warn") logger.warn(message);
                    else if (level === "error") logger.error(message);
                    else logger.info(message);
                } catch (err) { logger.warn("Failed to log combat message", err); }
            },

            getNpcName: (typeId) => {
                try {
                    return svc.npcTypeLoader?.load(typeId)?.name;
                } catch (err) {
                    logger.warn("Failed to load NPC name for typeId", err);
                    return undefined;
                }
            },

            onNpcKill: (playerId, npcTypeId, combatLevel, npc) => {
                svc.gamemode.onNpcKill(playerId, npcTypeId, combatLevel);
                svc.eventBus.emit("npc:death", {
                    npc: npc!,
                    npcTypeId,
                    combatLevel,
                    killerPlayerId: playerId,
                    tile: npc
                        ? { x: npc.tileX, y: npc.tileY, level: npc.level }
                        : { x: 0, y: 0, level: 0 },
                });
            },
        };
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

        const npc = this.svc.npcManager?.getById(npcId) ?? undefined;
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
        const reach = Math.max(1, this.svc.playerCombatService!.getPlayerAttackReach(player));
        const pathService = this.svc.pathService;

        // Range validation
        if (!isWithinAttackRange(player, npc, reach)) {
            return { ok: false, reason: "not_in_range" };
        }
        if (reach <= 1) {
            if (pathService && !hasDirectMeleeReach(player, npc, pathService)) {
                return { ok: false, reason: "not_in_range" };
            }
        } else {
            // do not allow long-reach melee attacks through walls
            const isMelee = resolvePlayerAttackType(player.combat) === AttackType.Melee;
            if (isMelee && pathService) {
                if (!hasDirectMeleePath(player, npc, pathService)) {
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
        const faceTile = this.svc.playerCombatService!.pickNpcFaceTile(player, npc);
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
                : this.svc.equipmentService.ensureEquipArray(player)[EquipmentSlot.WEAPON];

        // Ranged ammo consumption
        const plannedAttackType = normalizeAttackType(hitPayload.attackType);
        if (plannedAttackType === AttackType.Ranged) {
            const result = handleRangedAmmoConsumption(
                this.subServices,
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
        if (plannedAttackType === AttackType.Magic && player.combat.autocastEnabled && !data.magicAutocastHandled) {
            const result = handleAutocastRuneConsumption(this.subServices, player, npc, weaponItemId);
            if (!result.ok) {
                return result;
            }
        }

        // Queue ranged attack spot animation (only after ammo check passes)
        // This was moved from CombatSystem.ts to ensure animation doesn't play when out of ammo
        if (plannedAttackType === AttackType.Ranged) {
            const scheduleTick = Number.isFinite(tick) ? tick : this.svc.ticker.currentTick();
            this.svc.broadcastService.enqueueSpotAnimation({
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
                this.svc.queueCombatState(player);
                if (!ok) {
                    this.svc.messagingService.queueChatMessage({
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
                ? pickSpecialAttackVisualOverride(weaponItemId)
                : undefined;
            attackSeq = specialVisual?.seqId ?? this.svc.playerCombatService!.pickAttackSequence(player);
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
                    : this.svc.ticker.currentTick();
                const spotHeight =
                    typeof specialVisual?.spotHeight === "number" ? specialVisual.spotHeight : 0;
                this.svc.broadcastService.enqueueSpotAnimation({
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
                const specDef = getSpecialAttack(weaponItemId);
                // Use ammo-resolved soundId (e.g., Dark bow dragon vs regular arrows) if available
                let resolvedSoundId: number | undefined;
                if (specDef) {
                    resolvedSoundId = specDef.soundId;
                }
                if (data.special && data.special.specSoundId !== undefined) {
                    resolvedSoundId = data.special.specSoundId;
                }
                if (resolvedSoundId && resolvedSoundId > 0) {
                    this.svc.networkLayer.withDirectSendBypass("special_attack_sound", () =>
                        this.svc.broadcastService.broadcastSound(
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
                const weaponSoundId = this.svc.playerCombatService!.pickCombatSound(player, true);
                if (weaponSoundId > 0) {
                    this.svc.networkLayer.withDirectSendBypass("combat_attack_sound", () =>
                        this.svc.broadcastService.broadcastSound(
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

        const scheduleTick = Number.isFinite(tick) ? tick : this.svc.ticker.currentTick();
        logger.info(
            `[combat] player ${player.id} attack NPC ${npc.id} - tick ${scheduleTick}, animation ${
                attackSeq ?? "none"
            }`,
        );
        let attackDelay = hitPayload.attackDelay;
        if (attackDelay === undefined) {
            attackDelay = data.attackDelay;
        }
        if (attackDelay === undefined) {
            attackDelay = this.svc.playerCombatService!.pickAttackSpeed(player);
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
                : Math.max(1, this.svc.playerCombatService!.pickHitDelay(player));

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
                retaliateDamage = this.svc.playerCombatManager?.rollRetaliateDamage(npc, player);
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
            const hitResult = this.svc.actionScheduler.requestAction(
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
                logger.warn(
                    `[combat] failed to schedule player hit (player=${player.id}, npc=${npc.id}): ${
                        hitResult.reason ?? "unknown"
                    }`,
                );
                continue;
            }

            const resolvedAttackType =
                normalizeAttackType(entryAttackType) ?? plannedAttackType;
            const shouldGrantXpOnAttack =
                resolvedAttackType !== AttackType.Magic && this.resolveHitLanded(landed, style, damage);
            if (shouldGrantXpOnAttack && damage > 0) {
                hitData.xpGrantedOnAttack = true;
                this.svc.skillService.awardCombatXp(player, damage, hitData as { attackType?: string; attackStyleMode?: string; spellId?: number; spellBaseXpAtCast?: boolean }, effects);
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

            const timing = this.svc.projectileTimingService!.estimateProjectileTiming({
                player,
                targetX: npc.tileX,
                targetY: npc.tileY,
                projectileDefaults: projectileToSpawn as import("../../data/ProjectileParamsProvider").ProjectileParams,
                pathService,
            });
            const launch = this.svc.projectileTimingService!.buildPlayerRangedProjectileLaunch({
                player,
                npc,
                projectile: projectileToSpawn as import("../../data/ProjectileParamsProvider").ProjectileParams,
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

        if (!this.svc.activeFrame && effects.length > 0) {
            this.svc.effectDispatcher!.dispatchActionEffects(effects);
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
        const pathService = this.svc.pathService;

        if (projectileSpec && projectileSpec.projectileId) {
            const timing = this.svc.projectileTimingService!.estimateProjectileTiming({
                player,
                targetX: npc.tileX,
                targetY: npc.tileY,
                projectileDefaults: projectileSpec as import("../../data/ProjectileParamsProvider").ProjectileParams,
                pathService,
            });
            if (timing) {
                return Math.max(1, Math.ceil(timing.startDelay + timing.travelTime));
            }
        }

        if (attackType !== AttackType.Magic) {
            return undefined;
        }

        const spellId = player.combat.spellId ?? -1;
        const spellData = spellId > 0 ? getSpellData(spellId) : undefined;
        if (spellData && spellData.category === "combat") {
            const projectileDefaults = getProjectileParams(spellData.projectileId);
            const timing = this.svc.projectileTimingService!.estimateProjectileTiming({
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
        if (attackType !== AttackType.Magic) return;

        const spellId = player.combat.spellId ?? -1;
        const spellData = spellId > 0 ? getSpellData(spellId) : undefined;
        if (!spellData || spellData.category !== "combat") return;

        const baseXp = getSpellBaseXp(spellId);
        if (baseXp <= 0) return;
        const multiplierRaw = this.svc.gamemode.getSkillXpMultiplier(player) ?? 1;
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
                this.svc.skillService.queueSkillSnapshot(player.id, sync);
            }
        }
    }

    private disableAutocast(player: PlayerState, sock: unknown | undefined): void {
        try {
            this.svc.equipmentService.resetAutocast(player);
        } catch (err) { logger.warn("[combat] failed to reset autocast", err); }
        try {
            if (sock) this.svc.players?.stopPlayerCombat(sock as WebSocket);
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
