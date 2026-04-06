import { EquipmentSlot } from "../../../src/rs/config/player/Equipment";
import {
    PRAYER_HEAD_ICON_IDS,
    PRAYER_NAME_SET,
    PrayerHeadIcon,
    PrayerName,
} from "../../../src/rs/prayer/prayers";
import {
    SKILL_IDS,
    SkillId,
} from "../../../src/rs/skill/skills";
import {
    VARBIT_XPDROPS_ENABLED,
} from "../../../src/shared/vars";
import { logger } from "../utils/logger";
import { DisplayMode, PlayerWidgetManager } from "../widgets/WidgetManager";
import { Actor, RUN_ENERGY_MAX, Tile } from "./actor";
import type { AttackType } from "./combat/AttackType";
import { restoreAutocastState } from "./combat/AutocastState";
import type { ChargeTracker } from "./combat/DegradationSystem";
import type { StatusHitsplat } from "./combat/HitEffects";
import type { PlayerAggressionState } from "./combat/NpcCombatAI";
import { DEFAULT_EQUIP_SLOT_COUNT, ensureEquipArrayOn, ensureEquipQtyArrayOn } from "./equipment";
import type { GamemodeDefinition } from "./gamemodes/GamemodeDefinition";
import { LockState, LockStateChecks } from "./model/LockState";
import { QueueTaskSet, TaskGenerator } from "./model/queue";
import {
    ACTIVE_COMBAT_TIMER,
    ACTIVE_COMBAT_TIMER_TICKS,
    FROZEN_TIMER,
    STUN_TIMER,
    TELEBLOCK_TIMER,
    TimerKey,
    TimerMap,
} from "./model/timer";
import { NpcState } from "./npc";
import { PlayerAccountState } from "./state/PlayerAccountState";
import { PlayerCollectionLogState } from "../../gamemodes/vanilla/state/PlayerCollectionLogState";
import type { CollectionLogUnlockEntry } from "../../gamemodes/vanilla/state/PlayerCollectionLogState";
import { PlayerCombatState } from "./state/PlayerCombatState";
import { PlayerFollowerPersistState } from "./state/PlayerFollowerPersistState";
import { PlayerInventoryState } from "./state/PlayerInventoryState";
import { PlayerPrayerState } from "./state/PlayerPrayerState";
import { PlayerStatusState } from "./state/PlayerStatusState";
import { PlayerAggressionTracker } from "./state/PlayerAggressionTracker";
import { PlayerRunEnergyState } from "./state/PlayerRunEnergyState";
import { PlayerVarpState } from "./state/PlayerVarpState";
import {
    PlayerSkillSystem,
    type SkillEntry,
    type SkillSyncState,
    type SkillSyncUpdate,
    type PlayerSkillPersistentEntry,
    normalizeSkillXpValue,
    createInitialSkills,
    computeTotalLevel,
    computeCombatLevel,
} from "./state/PlayerSkillSystem";

export { Actor } from "./actor";
export { type Tile } from "./actor";

// Re-export skill system types for backward compatibility
export {
    PlayerSkillSystem,
    type SkillEntry,
    type SkillSyncState,
    type SkillSyncUpdate,
    type PlayerSkillPersistentEntry,
    normalizeSkillXpValue,
    createInitialSkills,
    computeTotalLevel,
    computeCombatLevel,
} from "./state/PlayerSkillSystem";

/** @deprecated Use `SkillEntry` instead. */
export type PlayerSkillState = SkillEntry;

const MAX_ITEM_STACK_QUANTITY = 2_147_483_647;

/**
 * Player appearance data for character rendering.
 */
export interface PlayerAppearance {
    gender: number;
    colors?: number[];
    kits?: number[];
    /** Equipment item IDs by slot (indexed by EquipmentSlot). -1 = empty */
    equip: number[];
    /** Equipment quantities for stackable items */
    equipQty?: number[];
    headIcons: { prayer: number; skull?: number };
}

/**
 * Head icon state for overhead prayers/skulls.
 */
export interface PlayerHeadIcons {
    prayer: number;
    skull?: number;
}

export type BankEntry = {
    itemId: number;
    quantity: number;
    placeholder?: boolean;
    tab?: number;
    filler?: boolean;
};
export type BankSnapshotEntry = {
    slot: number;
    itemId: number;
    quantity: number;
    placeholder?: boolean;
    tab?: number;
    filler?: boolean;
};
export type InventoryEntry = { itemId: number; quantity: number };
export type InventorySnapshotEntry = { slot: number; itemId: number; quantity: number };
export type EquipmentSnapshotEntry = { slot: number; itemId: number; quantity?: number };
export interface InventoryAddResult {
    slot: number;
    added: number;
}

/**
 * Result of an inventory transaction (add/remove).
 * Matches RSMod's ItemTransaction pattern.
 */
export interface ItemTransaction {
    /** Amount requested to add/remove */
    requested: number;
    /** Amount actually added/removed */
    completed: number;
    /** Slots affected by the transaction */
    slots: Array<{ slot: number; itemId: number; quantity: number }>;
}

/**
 * Item definition resolver for determining stackability.
 * Matches RSMod's DefinitionSet pattern.
 */
export type ItemDefResolver = (itemId: number) => { stackable: boolean } | undefined;

export interface PlayerLocationSnapshot {
    x: number;
    y: number;
    level: number;
    orientation?: number;
    rot?: number;
}

export interface PlayerFollowerPersistentEntry {
    itemId: number;
    npcTypeId: number;
}

export type { CollectionLogUnlockEntry } from "../../gamemodes/vanilla/state/PlayerCollectionLogState";

// modern OSRS bank starts at 800 slots (varp BANK_LOCKED_SLOTS is based on 1410 max slots).
export const DEFAULT_BANK_CAPACITY = 800;
export const INVENTORY_SLOT_COUNT = 28;

function createEmptyBank(capacity: number): BankEntry[] {
    return Array.from({ length: capacity }, () => ({
        itemId: -1,
        quantity: 0,
        placeholder: false,
        tab: 0,
    }));
}

function createEmptyInventory(): InventoryEntry[] {
    return Array.from({ length: INVENTORY_SLOT_COUNT }, () => ({ itemId: -1, quantity: 0 }));
}

const SPECIAL_ENERGY_MAX = 100;
const SPECIAL_ENERGY_REGEN_CHUNK = 10;
const SPECIAL_ENERGY_REGEN_INTERVAL_TICKS = 50;
const DEFAULT_SPECIAL_ACCURACY_MULTIPLIER = 1.1;

const DEFAULT_MAX_COMBAT_STYLE_SLOT = 3;
/**
 * Max combat style slot per weapon category.
 * Most weapons use slots 0-3, but some have only 3 buttons
 * that map to slots 0, 1, 3 (skipping slot 2). The max slot must allow slot 3.
 * Only unarmed (0) and basic melee staves (18) use consecutive slots 0,1,2.
 */
const COMBAT_STYLE_MAX_SLOT_BY_CATEGORY: Record<number, number> = {
    0: 2, // Unarmed - punch/kick/block (slots 0,1,2)
    3: 3, // Bow - accurate/rapid/longrange (slots 0,1,3)
    5: 3, // Crossbow - accurate/rapid/longrange (slots 0,1,3)
    6: 3, // Salamander - scorch/flare/blaze (slots 0,1,3)
    7: 3, // Chinchompa - accurate/rapid/longrange (slots 0,1,3)
    8: 3, // Powered shot (crystal bow) - accurate/rapid/longrange (slots 0,1,3)
    18: 2, // Staff - bash/pound/focus (slots 0,1,2)
    19: 3, // Thrown - accurate/rapid/longrange (slots 0,1,3)
    20: 3, // Whip - flick/lash/deflect (slots 0,1,3)
    24: 3, // Staff (magic) - spell/defensive (slots 0,3)
    29: 3, // Staff (longrange) - accurate/longrange (slots 0,3)
    31: 3, // Powered staff (trident) - accurate/longrange (slots 0,1,3)
};

export interface PlayerPersistentVars {
    varps?: Record<number, number>;
    varbits?: Record<number, number>;
    gamemodeData?: Record<string, unknown>;
    /** Server-only onboarding progression (project-specific). */
    accountStage?: number;
    accountCreationTimeMs?: number;
    appearance?: {
        gender?: number;
        kits?: number[];
        colors?: number[];
    };
    bank?: BankSnapshotEntry[];
    bankCapacity?: number;
    bankQuantityCustom?: number;
    bankQuantityMode?: number;
    bankWithdrawNotes?: boolean;
    bankInsertMode?: boolean;
    bankPlaceholders?: boolean;
    inventory?: InventorySnapshotEntry[];
    equipment?: EquipmentSnapshotEntry[];
    skills?: PlayerSkillPersistentEntry[];
    hitpoints?: number;
    location?: PlayerLocationSnapshot;
    runEnergy?: number;
    runToggle?: boolean;
    autoRetaliate?: boolean;
    combatStyleSlot?: number;
    combatStyleCategory?: number;
    combatSpellId?: number;
    autocastEnabled?: boolean;
    autocastMode?: "autocast" | "defensive_autocast" | null;
    specialEnergy?: number;
    specialActivated?: boolean;
    quickPrayers?: PrayerName[];
    equipmentCharges?: Array<{ itemId: number; charges: number }>;
    /**
     * Degradation system charges per equipment slot.
     * Key: equipment slot, Value: { itemId: number, charges: number }
     * itemId is stored to detect when weapon is swapped (reset charges).
     */
    degradationCharges?: Array<{ slot: number; itemId: number; charges: number }>;
    /** Collection log: obtained items with quantity */
    collectionLog?: {
        items?: Array<{ itemId: number; quantity: number }>;
        itemUnlocks?: CollectionLogUnlockEntry[];
        categoryStats?: Array<{
            structId: number;
            count1: number;
            count2?: number;
            count3?: number;
        }>;
    };
    follower?: PlayerFollowerPersistentEntry;
    playTimeSeconds?: number;
}

export class PlayerState extends Actor {
    static gamemodeRef: GamemodeDefinition | undefined;

    [key: symbol]: unknown;

    readonly gamemodeState: Map<string, unknown> = new Map();

    override readonly isPlayer = true;
    widgets: PlayerWidgetManager;
    visibleNpcIds: Set<number> = new Set();
    /** NPC IDs spawned for this player's current instance (sailing, etc.). */
    instanceNpcIds: Set<number> = new Set();
    /** WorldView this player belongs to (-1 = overworld, >=0 = entity index). */
    worldViewId: number = -1;
    /** Item definition resolver for stackability lookups (RSMod parity) */
    private itemDefResolver?: ItemDefResolver;
    /** Per-player NPC healthbar baseline (npcId -> defId -> last scaled value). */
    lastNpcHealthBarScaled: Map<number, Map<number, number>> = new Map();
    /** Composed follower persistence state (pet item/npc tracking) */
    readonly followers = new PlayerFollowerPersistState();
    /** Composed skill system (levels, XP, hitpoints, status effects, restoration) */
    readonly skillSystem: PlayerSkillSystem;

    // Skill system delegation accessors (backward compat)
    /** @deprecated Use `skillSystem.skills` instead. */
    get skills(): SkillEntry[] { return this.skillSystem.skills; }
    /** @deprecated Use `skillSystem.skillTotal` instead. */
    get skillTotal(): number { return this.skillSystem.skillTotal; }
    set skillTotal(v: number) { this.skillSystem.skillTotal = v; }
    /** @deprecated Use `skillSystem.combatLevel` instead. */
    get combatLevel(): number { return this.skillSystem.combatLevel; }
    set combatLevel(v: number) { this.skillSystem.combatLevel = v; }

    /**
     * OSRS PID-style processing priority. Lower values execute first
     * for same-tick player actions. Randomized per session.
     */
    private readonly pidPriority: number;
    /** Composed combat state (weapon, style, targets, freeze, special energy, etc.) */
    readonly combat = new PlayerCombatState();

    // Delegation accessors for combat fields (preserves public API)
    get autoRetaliate(): boolean { return this.combat.autoRetaliate; }
    set autoRetaliate(v: boolean) { this.combat.autoRetaliate = v; }
    get combatWeaponCategory(): number { return this.combat.weaponCategory; }
    set combatWeaponCategory(v: number) { this.combat.weaponCategory = v; }
    get combatWeaponItemId(): number { return this.combat.weaponItemId; }
    set combatWeaponItemId(v: number) { this.combat.weaponItemId = v; }
    get combatWeaponRange(): number { return this.combat.weaponRange; }
    set combatWeaponRange(v: number) { this.combat.weaponRange = v; }
    get combatStyleSlot(): number { return this.combat.styleSlot; }
    set combatStyleSlot(v: number) { this.combat.styleSlot = v; }
    get combatStyleCategory(): number | undefined { return this.combat.styleCategory; }
    set combatStyleCategory(v: number | undefined) { this.combat.styleCategory = v; }
    get combatSpellId(): number { return this.combat.spellId; }
    set combatSpellId(v: number) { this.combat.spellId = v; }
    get autocastEnabled(): boolean { return this.combat.autocastEnabled; }
    set autocastEnabled(v: boolean) { this.combat.autocastEnabled = v; }
    get autocastMode(): "autocast" | "defensive_autocast" | null { return this.combat.autocastMode; }
    set autocastMode(v: "autocast" | "defensive_autocast" | null) { this.combat.autocastMode = v; }
    get pendingAutocastDefensive(): boolean | undefined { return this.combat.pendingAutocastDefensive; }
    set pendingAutocastDefensive(v: boolean | undefined) { this.combat.pendingAutocastDefensive = v; }
    get pendingAutocastWeaponId(): number | undefined { return this.combat.pendingAutocastWeaponId; }
    set pendingAutocastWeaponId(v: number | undefined) { this.combat.pendingAutocastWeaponId = v; }
    get lastSpellCastTick(): number { return this.combat.lastSpellCastTick; }
    set lastSpellCastTick(v: number) { this.combat.lastSpellCastTick = v; }
    get pendingPlayerSpellDamage(): { targetId: number } | undefined { return this.combat.pendingPlayerSpellDamage; }
    set pendingPlayerSpellDamage(v: { targetId: number } | undefined) { this.combat.pendingPlayerSpellDamage = v; }
    get slayerTask() { return this.combat.slayerTask; }
    set slayerTask(v: typeof this.combat.slayerTask) { this.combat.slayerTask = v; }
    get attackDelay(): number { return this.combat.attackDelay; }
    set attackDelay(v: number) { this.combat.attackDelay = v; }
    get _lastWildernessLevel(): number { return this.combat.lastWildernessLevel; }
    set _lastWildernessLevel(v: number) { this.combat.lastWildernessLevel = v; }
    get _lastInMultiCombat(): boolean { return this.combat.lastInMultiCombat; }
    set _lastInMultiCombat(v: boolean) { this.combat.lastInMultiCombat = v; }
    get _lastInPvPArea(): boolean { return this.combat.lastInPvPArea; }
    set _lastInPvPArea(v: boolean) { this.combat.lastInPvPArea = v; }
    get _lastInRaid(): boolean { return this.combat.lastInRaid; }
    set _lastInRaid(v: boolean) { this.combat.lastInRaid = v; }
    get _lastInLMS(): boolean { return this.combat.lastInLMS; }
    set _lastInLMS(v: boolean) { this.combat.lastInLMS = v; }
    /** Save key for persistence. */
    __saveKey?: string;
    /** Composed inventory/bank/shop state */
    readonly items = new PlayerInventoryState();
    /** Composed account metadata (creation time, play time, stage) */
    readonly account = new PlayerAccountState();
    /** Composed collection log state */
    readonly collectionLog = new PlayerCollectionLogState();
    /** Composed prayer state (active prayers, quick prayers, head icon, drain) */
    readonly prayer = new PlayerPrayerState();
    /** Composed status state (hitpoints, poison, venom, disease, regen) */
    readonly status = new PlayerStatusState();

    // Prayer delegation accessors
    get activePrayers(): Set<PrayerName> { return this.prayer.activePrayers; }
    set activePrayers(v: Set<PrayerName>) { this.prayer.activePrayers = v; }

    // Status delegation accessors
    get onDeath(): (() => void) | undefined { return this.status.onDeath; }
    set onDeath(v: (() => void) | undefined) { this.status.onDeath = v; }
    /** Composed run energy & stamina state */
    readonly energy = new PlayerRunEnergyState(
        this as any,
        () => PlayerState.gamemodeRef?.hasInfiniteRunEnergy(this) ?? false,
    );
    /** Composed aggression tolerance tracker */
    readonly aggression = new PlayerAggressionTracker();
    /** Composed varp/varbit storage */
    readonly varps = new PlayerVarpState();
    private equipmentChargeMap = new Map<number, number>();
    get degradationCharges(): ChargeTracker { return this.combat.degradationCharges; }
    set degradationCharges(v: ChargeTracker) { this.combat.degradationCharges = v; }
    get degradationLastItemId(): Map<number, number> { return this.combat.degradationLastItemId; }
    set degradationLastItemId(v: Map<number, number>) { this.combat.degradationLastItemId = v; }
    private walkDestination?: { x: number; y: number };
    private walkDestinationRun: boolean = false;
    private walkRepathAfterTick: number = Number.MIN_SAFE_INTEGER;
    private preserveWalkDestinationOnNextSetPath: boolean = false;

    // ========================================================================
    // RSMod-style interaction attributes
    // These mirror RSMod's COMBAT_TARGET_FOCUS_ATTR, INTERACTING_NPC_ATTR, etc.
    // ========================================================================

    // Combat target/interaction WeakRefs delegated to combat state
    get attackDelayTicks(): number { return this.combat.attackDelayTicks; }
    set attackDelayTicks(v: number) { this.combat.attackDelayTicks = v; }

    // Combat target accessors
    getCombatTarget(): NpcState | PlayerState | null {
        return this.combat.combatTargetFocus?.deref() as (NpcState | PlayerState | null) ?? null;
    }

    setCombatTarget(target: NpcState | PlayerState | null): void {
        this.combat.combatTargetFocus = target ? new WeakRef(target) : null;
    }

    isAttacking(): boolean {
        return this.combat.combatTargetFocus?.deref() != null;
    }

    isBeingAttacked(): boolean {
        return this.timers.has(ACTIVE_COMBAT_TIMER);
    }

    /**
     * Refresh the logout prevention timer applied when this player is attacked.
     */
    refreshActiveCombatTimer(ticks: number = ACTIVE_COMBAT_TIMER_TICKS): void {
        this.timers.set(ACTIVE_COMBAT_TIMER, Math.max(1, ticks));
    }

    // Interaction accessors
    getInteractingNpc(): NpcState | null {
        return this.combat.interactingNpc?.deref() ?? null;
    }

    setInteractingNpc(npc: NpcState | null): void {
        this.combat.interactingNpc = npc ? new WeakRef(npc) : null;
    }

    getInteractingPlayer(): PlayerState | null {
        return this.combat.interactingPlayer?.deref() as (PlayerState | null) ?? null;
    }

    setInteractingPlayer(player: PlayerState | null): void {
        this.combat.interactingPlayer = player ? new WeakRef(player) : null;
    }

    // Last hit tracking
    getLastHitBy(): NpcState | PlayerState | null {
        return this.combat.lastHitBy?.deref() as (NpcState | PlayerState | null) ?? null;
    }

    setLastHitBy(pawn: NpcState | PlayerState | null): void {
        this.combat.lastHitBy = pawn ? new WeakRef(pawn) : null;
    }

    getLastHit(): NpcState | PlayerState | null {
        return this.combat.lastHit?.deref() as (NpcState | PlayerState | null) ?? null;
    }

    setLastHit(pawn: NpcState | PlayerState | null): void {
        this.combat.lastHit = pawn ? new WeakRef(pawn) : null;
    }

    resetInteractions(): void {
        this.combat.combatTargetFocus = null;
        this.combat.interactingNpc = null;
        this.combat.interactingPlayer = null;
        this.clearInteractionTarget();
    }

    resetCombat(): void {
        this.combat.combatTargetFocus = null;
    }

    removeCombatTarget(): void {
        this.combat.combatTargetFocus = null;
    }

    /**
     * Check if attack delay is ready (can attack now).
     * RSMod: Combat.isAttackDelayReady(pawn)
     */
    isAttackDelayReady(): boolean {
        return this.attackDelayTicks <= 0;
    }

    // ========================================================================
    // RSMod-style systems: TimerMap, LockState, QueueTaskSet
    // ========================================================================

    /**
     * Timer map for managing timed effects.
     * RSMod: Pawn.timers
     */
    readonly timers: TimerMap = new TimerMap();

    /**
     * Lock state for action restrictions.
     * RSMod: Pawn.lock
     */
    private _lockState: LockState = LockState.NONE;

    /**
     * Queue for multi-tick tasks.
     * RSMod: Pawn.queue
     * Note: Initialized in constructor due to TypeScript 'this' type constraints.
     */
    taskQueue!: QueueTaskSet<PlayerState>;

    // LockState accessors
    get lock(): LockState {
        return this._lockState;
    }

    set lock(state: LockState) {
        this._lockState = state;
    }

    /**
     * Check if player can move based on lock state and timers.
     */
    canMove(): boolean {
        if (!LockStateChecks.canMove(this._lockState)) return false;
        if (this.timers.has(FROZEN_TIMER)) return false;
        if (this.timers.has(STUN_TIMER)) return false;
        if (!this.canInteractWithWorld()) return false;
        return true;
    }

    /**
     * Check if player can attack based on lock state.
     */
    canAttack(): boolean {
        if (!LockStateChecks.canAttack(this._lockState)) return false;
        if (this.timers.has(STUN_TIMER)) return false;
        return true;
    }

    /**
     * Check if player can be attacked based on lock state.
     */
    canBeAttacked(): boolean {
        return LockStateChecks.canBeAttacked(this._lockState);
    }

    /**
     * Check if player can teleport based on lock state and timers.
     */
    canTeleport(): boolean {
        if (!LockStateChecks.canTeleport(this._lockState)) return false;
        if (this.timers.has(TELEBLOCK_TIMER)) return false;
        return true;
    }

    /**
     * Check if player can logout based on lock state and incoming combat timer.
     */
    canLogout(): boolean {
        if (!LockStateChecks.canLogout(this._lockState)) return false;
        if (this.timers.has(ACTIVE_COMBAT_TIMER)) return false;
        return true;
    }

    /**
     * RSMod parity: Whether a menu is open that should pause standard queue tasks.
     */
    hasMenuOpen(): boolean {
        return this.widgets?.hasModalOpen?.() ?? false;
    }

    /**
     * Process all timers and queue tasks for this tick.
     * Should be called once per game tick.
     */
    processTimersAndQueue(): TimerKey[] {
        // Process queue tasks
        this.taskQueue.cycle();
        // Tick timers and return expired ones
        return this.timers.cycle();
    }

    /**
     * Queue a weak task (can be interrupted by player input).
     */
    queueWeak(generatorFn: TaskGenerator<PlayerState>): void {
        this.taskQueue.queueWeak(generatorFn);
    }

    /**
     * Queue a standard task.
     */
    queueTask(generatorFn: TaskGenerator<PlayerState>): void {
        this.taskQueue.queueStandard(generatorFn);
    }

    /**
     * Queue a strong task (interrupts other tasks).
     */
    queueStrong(generatorFn: TaskGenerator<PlayerState>): void {
        this.taskQueue.queueStrong(generatorFn);
    }

    /**
     * Terminate all queued tasks.
     */
    interruptQueues(): void {
        this.taskQueue.terminateTasks();
    }

    // ========================================================================
    // End RSMod-style attributes
    // ========================================================================

    setWalkDestination(tile: { x: number; y: number }, run: boolean): void {
        this.walkDestination = { x: tile.x, y: tile.y };
        this.walkDestinationRun = !!run;
        this.walkRepathAfterTick = Number.MIN_SAFE_INTEGER;
    }

    clearWalkDestination(): void {
        this.walkDestination = undefined;
        this.walkDestinationRun = false;
        this.walkRepathAfterTick = Number.MIN_SAFE_INTEGER;
    }

    getWalkDestination(): { x: number; y: number; run: boolean } | undefined {
        if (!this.walkDestination) return undefined;
        return {
            x: this.walkDestination.x,
            y: this.walkDestination.y,
            run: !!this.walkDestinationRun,
        };
    }

    getWalkRepathAfterTick(): number {
        return this.walkRepathAfterTick;
    }

    setWalkRepathAfterTick(tick: number): void {
        this.walkRepathAfterTick = tick;
    }

    setPathPreservingWalkDestination(steps: Tile[], run: boolean): void {
        this.preserveWalkDestinationOnNextSetPath = true;
        this.setPath(steps, run);
    }

    /**
     * Last bank client-slot -> server-slot mapping sent in a bank snapshot.
     * Used to decode client drag/click slots deterministically.
     */
    private equipmentDirty: boolean = false;
    private appearanceDirty: boolean = false;
    private combatStateDirty: boolean = false;
    public appearance: PlayerAppearance;
    /** @deprecated Use `account.accountStage` instead. */
    get accountStage(): number { return this.account.accountStage; }
    set accountStage(v: number) { this.account.accountStage = v; }
    /** Player display name */
    public name: string = "";
    /** Display mode (mobile vs desktop) - set during login based on clientType */
    public displayMode: DisplayMode = DisplayMode.RESIZABLE_NORMAL;
    /** Pending face direction (consumed by interaction system) */
    _pendingFace?: { x: number; y: number };

    constructor(id: number, spawnTileX: number, spawnTileY: number, level: number = 0) {
        super(id, spawnTileX, spawnTileY, level);
        // Random per-session priority similar to OSRS PID randomness.
        this.pidPriority = Math.random() * 0x7fffffff;
        this.rot = 1024;
        this.orientation = 1024;
        this.widgets = new PlayerWidgetManager();
        this.skillSystem = new PlayerSkillSystem(
            this.status,
            (name) => this.hasPrayerActive(name as PrayerName),
            (h, s, l, o, d) => this.setColorOverride(h, s, l, o, d),
            PlayerState.gamemodeRef?.getDefaultSkillXp
                ? (id) => PlayerState.gamemodeRef!.getDefaultSkillXp!(id)
                : undefined,
        );
        this.requestFullSkillSync();
        this.combatStyleCategory = 0;
        this.appearance = {
            gender: 0,
            colors: undefined,
            kits: undefined,
            equip: new Array<number>(DEFAULT_EQUIP_SLOT_COUNT).fill(-1),
            headIcons: { prayer: -1 },
        };
        // Default to post-design for existing saves; new accounts can override to 0.
        this.accountStage = 1;

        // Delegate gamemode-specific player initialization
        PlayerState.gamemodeRef?.initializePlayer(this);
        // XP drops are enabled by default until the player explicitly hides them.
        if (!this.varps.hasVarbitValue(VARBIT_XPDROPS_ENABLED)) {
            this.varps.setVarbitValue(VARBIT_XPDROPS_ENABLED, 1);
        }
        // Task count is server-authoritative; default is 0 for new accounts.
        // Initialize task queue (RSMod: Pawn.queue)
        this.taskQueue = new QueueTaskSet<PlayerState>(this);
    }

    /** @deprecated Use `account.getSessionPlayTimeSeconds()` instead. */
    getSessionPlayTimeSeconds(nowMs: number = Date.now()): number {
        return this.account.getSessionPlayTimeSeconds(nowMs);
    }

    /** @deprecated Use `account.getLifetimePlayTimeSeconds()` instead. */
    getLifetimePlayTimeSeconds(nowMs: number = Date.now()): number {
        return this.account.getLifetimePlayTimeSeconds(nowMs);
    }

    /** @deprecated Use `account.getAccountAgeMinutes()` instead. */
    getAccountAgeMinutes(nowMs: number = Date.now()): number {
        return this.account.getAccountAgeMinutes(nowMs);
    }

    getPidPriority(): number {
        return this.pidPriority;
    }

    setInventorySlot(slot: number, itemId: number, quantity: number): void {
        const inv = this.getInventoryEntries();
        if (slot < 0 || slot >= inv.length) return;
        const prevId = inv[slot].itemId;
        const prevQty = inv[slot].quantity;

        const nextId = quantity > 0 ? itemId : -1;
        const nextQty = nextId > 0 ? quantity : 0;

        if (prevId === nextId && prevQty === nextQty) return;

        inv[slot] = { itemId: nextId, quantity: nextQty };
        this.items.inventoryDirty = true;
    }

    setBankSlot(slot: number, itemId: number, quantity: number): void {
        const bank = this.ensureBankInitialized();
        if (slot < 0 || slot >= bank.length) return;

        const nextId = quantity > 0 ? itemId : -1;
        const nextQty = nextId > 0 ? quantity : 0;

        if (bank[slot].itemId === nextId && bank[slot].quantity === nextQty) return;

        bank[slot] = { itemId: nextId, quantity: nextQty };
        this.items.bankDirty = true;
    }

    setEquipmentSlot(slot: number, itemId: number): void {
        const equip = this.ensureAppearanceEquip();
        if (slot < 0 || slot >= equip.length) return;
        if (equip[slot] !== itemId) {
            equip[slot] = itemId;
            this.equipmentDirty = true;
            this.appearanceDirty = true;
        }
    }

    markAppearanceDirty(): void {
        this.appearanceDirty = true;
    }

    markInventoryDirty(): void {
        this.items.inventoryDirty = true;
    }

    markEquipmentDirty(): void {
        this.equipmentDirty = true;
        this.appearanceDirty = true;
    }

    markCombatStateDirty(): void {
        this.combatStateDirty = true;
    }

    hasInventoryUpdate(): boolean {
        return this.items.inventoryDirty;
    }

    takeInventorySnapshot(): InventorySnapshotEntry[] | undefined {
        if (!this.items.inventoryDirty) return undefined;
        this.items.inventoryDirty = false;
        return this.exportInventorySnapshot();
    }

    hasBankUpdate(): boolean {
        return this.items.bankDirty;
    }

    takeBankSnapshot(): BankSnapshotEntry[] | undefined {
        if (!this.items.bankDirty) return undefined;
        this.items.bankDirty = false;
        return this.exportBankSnapshot();
    }

    takeEquipmentSnapshot(): EquipmentSnapshotEntry[] | undefined {
        if (!this.equipmentDirty) return undefined;
        this.equipmentDirty = false;
        return this.exportEquipmentSnapshot();
    }

    hasAppearanceUpdate(): boolean {
        return this.appearanceDirty;
    }

    takeAppearanceSnapshot(): any | undefined {
        if (!this.appearanceDirty) return undefined;
        this.appearanceDirty = false;
        return this.appearance;
    }

    hasCombatStateUpdate(): boolean {
        return this.combatStateDirty;
    }

    takeCombatStateSnapshot(): boolean {
        const dirty = this.combatStateDirty;
        this.combatStateDirty = false;
        return dirty;
    }

    // =========================================================================
    // OSRS Aggression Tolerance System
    // =========================================================================

    /** @deprecated Use `this.aggression.getAggressionState(currentTick, tileX, tileY)` */
    getAggressionState(currentTick: number): PlayerAggressionState {
        return this.aggression.getAggressionState(currentTick, this.tileX, this.tileY);
    }

    /** @deprecated Use `this.aggression.updateAggressionState(...)` */
    updateAggressionState(
        currentTick: number,
        neverTolerant: boolean = false,
        customTimer?: number,
    ): void {
        this.aggression.updateAggressionState(currentTick, this.tileX, this.tileY, neverTolerant, customTimer);
    }

    /** @deprecated Use `this.aggression.resetAggressionState(...)` */
    resetAggressionState(currentTick: number): void {
        this.aggression.resetAggressionState(currentTick, this.tileX, this.tileY);
    }

    /** @deprecated Use `this.aggression.isAggressionExpired()` */
    isAggressionExpired(): boolean {
        return this.aggression.isAggressionExpired();
    }

    private canInteractWithWorld(): boolean {
        return PlayerState.gamemodeRef?.canInteract(this) ?? true;
    }

    /**
     * Override teleport to reset aggression state.
     * OSRS: Teleporting to a new area resets the aggression tolerance timer.
     */
    public override teleport(tileX: number, tileY: number, level?: number): void {
        super.teleport(tileX, tileY, level);
        this.aggression.clearState();
    }

    public canInteract(): boolean {
        return this.canInteractWithWorld();
    }

    public override setPath(steps: Tile[], run: boolean): void {
        if (!this.canMove()) {
            return;
        }

        if (!this.preserveWalkDestinationOnNextSetPath) {
            this.clearWalkDestination();
        }
        this.preserveWalkDestinationOnNextSetPath = false;

        const normalized: Tile[] = Array.isArray(steps)
            ? steps.map((step) => ({ x: step.x, y: step.y }))
            : [];
        let isSingleAdjacent = false;
        if (normalized.length === 1) {
            const first = normalized[0]!;
            const sx = this.tileX;
            const sy = this.tileY;
            const dx = Math.abs(first.x - sx);
            const dy = Math.abs(first.y - sy);
            isSingleAdjacent = dx <= 1 && dy <= 1 && (dx !== 0 || dy !== 0);
        }
        super.setPath(normalized, run);
        if (!isSingleAdjacent) {
            this.markSingleStepRoutePending(false);
        }
    }

    public prepareMovementIntent(_maxSteps?: number): void {
        // Path buffer is populated eagerly; nothing to prepare.
    }

    setAutoRetaliate(on: boolean): void {
        this.autoRetaliate = !!on;
    }

    setCombatStyle(style: number | null | undefined, category?: number): void {
        const normalizedCategory = category ?? this.combatStyleCategory;
        const previousCategory = this.combatStyleCategory;
        const categoryChanged =
            normalizedCategory !== undefined && normalizedCategory !== previousCategory;
        const maxSlot = this.getMaxCombatStyleSlot(normalizedCategory);

        let desiredSlot: number | undefined;
        const styleIsDefined = style !== null && style !== undefined;
        if (categoryChanged && normalizedCategory !== undefined) {
            desiredSlot = this.combat.styleMemory.get(normalizedCategory);
            if (desiredSlot === undefined && styleIsDefined) {
                desiredSlot = style;
            }
        } else if (styleIsDefined) {
            desiredSlot = style;
        } else {
            desiredSlot = this.combatStyleSlot;
        }

        let normalizedSlot = Math.max(0, Math.min(maxSlot, desiredSlot ?? 0));
        if (this.combat.attackTypes && this.combat.attackTypes.length > 0) {
            normalizedSlot = Math.min(this.combat.attackTypes.length - 1, normalizedSlot);
            // Validate the slot is actually defined (sparse arrays have gaps).
            // Weapons like bows have slots 0,1,3 but not 2 - if slot 2 was selected, find nearest valid.
            if (this.combat.attackTypes[normalizedSlot] === undefined) {
                // Find the nearest valid slot (prefer lower slots first, then check higher)
                let foundSlot: number | undefined;
                for (let s = normalizedSlot - 1; s >= 0; s--) {
                    if (this.combat.attackTypes[s] !== undefined) {
                        foundSlot = s;
                        break;
                    }
                }
                if (foundSlot === undefined) {
                    for (let s = normalizedSlot + 1; s < this.combat.attackTypes.length; s++) {
                        if (this.combat.attackTypes[s] !== undefined) {
                            foundSlot = s;
                            break;
                        }
                    }
                }
                if (foundSlot !== undefined) {
                    normalizedSlot = foundSlot;
                }
            }
        }
        this.combatStyleSlot = normalizedSlot;
        if (normalizedCategory !== undefined) {
            this.combatStyleCategory = normalizedCategory;
            this.combat.styleMemory.set(normalizedCategory, normalizedSlot);
        }
    }

    setCombatCategoryAttackTypes(types: AttackType[] | undefined): void {
        this.combat.attackTypes = types ? types.slice() : undefined;
        if (this.combat.attackTypes && this.combat.attackTypes.length > 0) {
            const maxSlot = this.combat.attackTypes.length - 1;
            if (this.combatStyleSlot > maxSlot) {
                this.combatStyleSlot = maxSlot;
            }
            // Ensure slot is valid (sparse arrays have gaps, e.g., bows skip slot 2)
            if (this.combat.attackTypes[this.combatStyleSlot] === undefined) {
                // Find nearest valid slot
                let foundSlot: number | undefined;
                for (let s = this.combatStyleSlot - 1; s >= 0; s--) {
                    if (this.combat.attackTypes[s] !== undefined) {
                        foundSlot = s;
                        break;
                    }
                }
                if (foundSlot === undefined) {
                    for (let s = this.combatStyleSlot + 1; s < this.combat.attackTypes.length; s++) {
                        if (this.combat.attackTypes[s] !== undefined) {
                            foundSlot = s;
                            break;
                        }
                    }
                }
                if (foundSlot !== undefined) {
                    this.combatStyleSlot = foundSlot;
                }
            }
        }
    }

    setCombatCategoryMeleeBonusIndices(indices: Array<number | undefined> | undefined): void {
        this.combat.meleeBonusIndices = indices ? indices.slice() : undefined;
        if (this.combat.meleeBonusIndices && this.combat.meleeBonusIndices.length > 0) {
            const maxSlot = this.combat.meleeBonusIndices.length - 1;
            if (this.combatStyleSlot > maxSlot) {
                this.combatStyleSlot = maxSlot;
            }
        }
    }

    getCurrentAttackType(): AttackType | undefined {
        if (!this.combat.attackTypes || this.combat.attackTypes.length === 0) return undefined;
        const slot = Math.max(0, Math.min(this.combat.attackTypes.length - 1, this.combatStyleSlot));
        return this.combat.attackTypes[slot];
    }

    getCurrentMeleeBonusIndex(): number | undefined {
        if (!this.combat.meleeBonusIndices || this.combat.meleeBonusIndices.length === 0)
            return undefined;
        const slot = Math.max(
            0,
            Math.min(this.combat.meleeBonusIndices.length - 1, this.combatStyleSlot),
        );
        return this.combat.meleeBonusIndices[slot];
    }

    private getMaxCombatStyleSlot(category?: number): number {
        if (category === undefined || category === null) {
            return DEFAULT_MAX_COMBAT_STYLE_SLOT;
        }
        const override = COMBAT_STYLE_MAX_SLOT_BY_CATEGORY[category];
        if (override !== undefined && override >= 0) {
            return override;
        }
        return DEFAULT_MAX_COMBAT_STYLE_SLOT;
    }

    setCombatSpell(spellId: number | null | undefined): void {
        if (spellId == null || !Number.isFinite(spellId) || spellId <= 0) {
            this.combatSpellId = -1;
            this.autocastEnabled = false;
            this.autocastMode = null;
            return;
        }
        this.combatSpellId = spellId;
    }

    setActivePrayers(prayers: Iterable<PrayerName>): boolean {
        const next = new Set<PrayerName>();
        for (const prayer of prayers) {
            next.add(prayer);
        }
        let changed = next.size !== this.activePrayers.size;
        if (!changed) {
            for (const prayer of next) {
                if (!this.activePrayers.has(prayer)) {
                    changed = true;
                    break;
                }
            }
        }
        if (!changed) return false;
        this.activePrayers = next;
        this.updatePrayerHeadIcon();
        if (
            this.prayer.quickPrayersEnabled &&
            !this.arePrayerSetsEqual(this.prayer.quickPrayers, this.activePrayers)
        ) {
            this.prayer.quickPrayersEnabled = false;
        }
        return true;
    }

    /** @deprecated Use `this.energy.getRunEnergyUnits()` */
    getRunEnergyUnits(): number { return this.energy.getRunEnergyUnits(); }
    /** @deprecated Use `this.energy.hasInfiniteRunEnergy()` */
    hasInfiniteRunEnergy(): boolean { return this.energy.hasInfiniteRunEnergy(); }
    /** @deprecated Use `this.energy.wantsToRun()` */
    wantsToRun(): boolean { return this.energy.wantsToRun(); }
    /** @deprecated Use `this.energy.hasAvailableRunEnergy()` */
    public override hasAvailableRunEnergy(): boolean { return this.energy.hasAvailableRunEnergy(); }
    /** @deprecated Use `this.energy.resolveRequestedRun(run)` */
    resolveRequestedRun(run: boolean): boolean { return this.energy.resolveRequestedRun(run); }
    /** @deprecated Use `this.energy.isRunActive()` */
    isRunActive(): boolean { return this.energy.isRunActive(); }
    /** @deprecated Use `this.energy.syncInfiniteRunEnergy()` */
    syncInfiniteRunEnergy(): boolean { return this.energy.syncInfiniteRunEnergy(); }
    /** @deprecated Use `this.energy.setRunEnergyUnits(units)` */
    setRunEnergyUnits(units: number): void { this.energy.setRunEnergyUnits(units); }
    /** @deprecated Use `this.energy.adjustRunEnergyUnits(deltaUnits)` */
    adjustRunEnergyUnits(deltaUnits: number): number { return this.energy.adjustRunEnergyUnits(deltaUnits); }
    /** @deprecated Use `this.energy.getRunEnergyPercent()` */
    getRunEnergyPercent(): number { return this.energy.getRunEnergyPercent(); }
    /** @deprecated Use `this.energy.setRunEnergyPercent(percent)` */
    setRunEnergyPercent(percent: number): void { this.energy.setRunEnergyPercent(percent); }
    /** @deprecated Use `this.energy.adjustRunEnergyPercent(deltaPercent)` */
    adjustRunEnergyPercent(deltaPercent: number): number { return this.energy.adjustRunEnergyPercent(deltaPercent); }
    /** @deprecated Use `this.energy.applyStaminaEffect(...)` */
    applyStaminaEffect(currentTick: number, durationTicks: number, drainMultiplier?: number): void { this.energy.applyStaminaEffect(currentTick, durationTicks, drainMultiplier); }
    /** @deprecated Use `this.energy.tickStaminaEffect(currentTick)` */
    tickStaminaEffect(currentTick: number): void { this.energy.tickStaminaEffect(currentTick); }
    /** @deprecated Use `this.energy.getStaminaEffectRemainingTicks(currentTick)` */
    getStaminaEffectRemainingTicks(currentTick: number): number { return this.energy.getStaminaEffectRemainingTicks(currentTick); }
    /** @deprecated Use `this.energy.getRunEnergyDrainMultiplier(currentTick)` */
    getRunEnergyDrainMultiplier(currentTick: number): number { return this.energy.getRunEnergyDrainMultiplier(currentTick); }
    /** @deprecated Use `this.energy.hasRunEnergyUpdate()` */
    hasRunEnergyUpdate(): boolean { return this.energy.hasRunEnergyUpdate(); }
    /** @deprecated Use `this.energy.markRunEnergySynced()` */
    markRunEnergySynced(): void { this.energy.markRunEnergySynced(); }

    public override setRunToggle(on: boolean): void {
        const prev = this.runToggle;
        super.setRunToggle(on);
        if (prev !== this.runToggle) {
            this.energy.markDirty();
        }
    }

    isMovementLocked(currentTick: number): boolean {
        return this.movementLockRemaining(currentTick) > 0;
    }

    /**
     * Apply a freeze effect to this player.
     * OSRS: Cannot be frozen while immune (5 ticks after previous freeze ends).
     */
    applyFreeze(durationTicks: number, currentTick: number): boolean {
        // Check freeze immunity (5 ticks after previous freeze)
        if (currentTick < this.combat.freezeImmunityUntilTick) {
            return false; // Immune to freeze
        }

        const expires = Math.max(this.combat.freezeExpiryTick, currentTick + Math.max(1, durationTicks));
        this.combat.freezeExpiryTick = expires;
        this.lockMovementUntil(expires);
        this.clearPath();
        this.running = false;
        // OSRS: Ice blue tint for freeze duration
        this.setColorOverride(42, 5, 80, 30, Math.max(1, durationTicks));
        return true;
    }

    isFrozen(currentTick: number): boolean {
        if (this.combat.freezeExpiryTick > 0 && currentTick >= this.combat.freezeExpiryTick) {
            // Freeze just ended - start 5 tick immunity
            this.combat.freezeImmunityUntilTick = currentTick + 5;
            this.combat.freezeExpiryTick = 0;
            return false;
        }
        return this.combat.freezeExpiryTick > currentTick;
    }

    isFreezeImmune(currentTick: number): boolean {
        return currentTick < this.combat.freezeImmunityUntilTick;
    }

    getFreezeRemaining(currentTick: number): number {
        const remaining = this.combat.freezeExpiryTick - currentTick;
        return Math.max(0, remaining);
    }

    getSpecialEnergyUnits(): number {
        return Math.max(0, Math.min(SPECIAL_ENERGY_MAX, Math.floor(this.combat.specialEnergy)));
    }

    getSpecialEnergyPercent(): number {
        return Math.floor((this.getSpecialEnergyUnits() / SPECIAL_ENERGY_MAX) * 100);
    }

    setSpecialEnergyPercent(percent: number): void {
        const normalized = Math.max(0, Math.min(SPECIAL_ENERGY_MAX, Math.floor(percent)));
        if (normalized === this.getSpecialEnergyUnits()) return;
        this.combat.specialEnergy = normalized;
        this.combat.specialEnergyDirty = true;
        if (normalized === 0) {
            this.combat.specialActivatedFlag = false;
        }
    }

    setSpecialActivated(on: boolean): boolean {
        const normalized = !!on;
        if (normalized && this.getSpecialEnergyUnits() <= 0) {
            return false;
        }
        this.combat.specialActivatedFlag = normalized;
        return true;
    }

    isSpecialActivated(): boolean {
        return this.combat.specialActivatedFlag;
    }

    consumeSpecialEnergy(costPercent: number): boolean {
        const cost = Math.max(0, Math.min(SPECIAL_ENERGY_MAX, Math.floor(costPercent)));
        if (cost <= 0) return true;
        if (this.getSpecialEnergyUnits() < cost) {
            this.combat.specialActivatedFlag = false;
            return false;
        }
        this.combat.specialEnergy = Math.max(0, this.getSpecialEnergyUnits() - cost);
        this.combat.specialActivatedFlag = false;
        this.combat.specialEnergyDirty = true;
        return true;
    }

    tickSpecialEnergy(currentTick: number): boolean {
        if (this.getSpecialEnergyUnits() >= SPECIAL_ENERGY_MAX) {
            this.combat.nextSpecialRegenTick = currentTick + SPECIAL_ENERGY_REGEN_INTERVAL_TICKS;
            return false;
        }
        if (this.combat.nextSpecialRegenTick <= 0) {
            this.combat.nextSpecialRegenTick = currentTick + SPECIAL_ENERGY_REGEN_INTERVAL_TICKS;
            return false;
        }
        if (currentTick >= this.combat.nextSpecialRegenTick) {
            this.combat.specialEnergy = Math.min(
                SPECIAL_ENERGY_MAX,
                this.getSpecialEnergyUnits() + SPECIAL_ENERGY_REGEN_CHUNK,
            );
            this.combat.nextSpecialRegenTick = currentTick + SPECIAL_ENERGY_REGEN_INTERVAL_TICKS;
            this.combat.specialEnergyDirty = true;
            return true;
        }
        return false;
    }

    hasSpecialEnergyUpdate(): boolean {
        return this.combat.specialEnergyDirty;
    }

    markSpecialEnergySynced(): void {
        this.combat.specialEnergyDirty = false;
    }

    /** @deprecated Use `this.varps.getVarbitValue(id)` */
    getVarbitValue(id: number): number { return this.varps.getVarbitValue(id); }
    /** @deprecated Use `this.varps.setVarbitValue(id, value)` */
    setVarbitValue(id: number, value: number): void { this.varps.setVarbitValue(id, value); }
    /** @deprecated Use `this.varps.getVarpValue(id)` */
    getVarpValue(id: number): number { return this.varps.getVarpValue(id); }
    /** @deprecated Use `this.varps.hasVarpValue(id)` */
    hasVarpValue(id: number): boolean { return this.varps.hasVarpValue(id); }
    /** @deprecated Use `this.varps.setVarpValue(id, value)` */
    setVarpValue(id: number, value: number): void { this.varps.setVarpValue(id, value); }
    /** @deprecated Use `this.varps.getLastMusicRegionId()` */
    getLastMusicRegionId(): number { return this.varps.getLastMusicRegionId(); }
    /** @deprecated Use `this.varps.setLastMusicRegionId(regionId)` */
    setLastMusicRegionId(regionId: number): void { this.varps.setLastMusicRegionId(regionId); }
    /** @deprecated Use `this.varps.getLastPlayedMusicTrackId()` */
    getLastPlayedMusicTrackId(): number { return this.varps.getLastPlayedMusicTrackId(); }
    /** @deprecated Use `this.varps.setLastPlayedMusicTrackId(trackId)` */
    setLastPlayedMusicTrackId(trackId: number): void { this.varps.setLastPlayedMusicTrackId(trackId); }

    getBankCapacity(): number {
        return Math.max(1, this.items.bankCapacity);
    }

    setBankCapacity(capacity: number): void {
        // CS2 bank scripts use a 1410-slot addressing space (0..1409).
        // Allow up to 1410 without runaway allocations.
        const normalized = Math.max(1, Math.min(1410, Math.floor(capacity)));
        if (normalized === this.items.bankCapacity && this.items.bank.length === normalized) {
            return;
        }
        const next = createEmptyBank(normalized);
        const current = Array.isArray(this.items.bank) ? this.items.bank : [];
        for (let i = 0; i < Math.min(current.length, normalized); i++) {
            const entry = current[i];
            next[i] = {
                itemId: entry?.itemId ?? -1,
                quantity: entry?.quantity ?? 0,
            };
        }
        this.items.bankCapacity = normalized;
        this.items.bank = next;
        this.items.bankClientSlotMapping = [];
    }

    private ensureBankInitialized(): BankEntry[] {
        const capacity = this.getBankCapacity();
        if (!Array.isArray(this.items.bank) || this.items.bank.length !== capacity) {
            this.items.bank = createEmptyBank(capacity);
        }
        return this.items.bank;
    }

    getBankEntries(): BankEntry[] {
        return this.ensureBankInitialized();
    }

    setBankClientSlotMapping(mapping: number[]): void {
        if (!Array.isArray(mapping)) {
            this.items.bankClientSlotMapping = [];
            return;
        }
        this.items.bankClientSlotMapping = mapping.map((slot) =>
            Number.isFinite(slot) ? (slot as number) : -1,
        );
    }

    getBankServerSlotForClientSlot(clientSlot: number): number {
        if (!Number.isFinite(clientSlot)) return -1;
        const slot = clientSlot;
        if (slot < 0 || slot >= this.items.bankClientSlotMapping.length) return -1;
        const mapped = this.items.bankClientSlotMapping[slot] ?? -1;
        return Number.isFinite(mapped) ? mapped : -1;
    }

    loadBankSnapshot(entries?: Iterable<BankSnapshotEntry>, capacityOverride?: number): void {
        if (Number.isFinite(capacityOverride) && (capacityOverride as number) > 0) {
            this.setBankCapacity(capacityOverride as number);
        } else {
            this.ensureBankInitialized();
        }
        const bank = this.getBankEntries();
        for (const slot of bank) {
            slot.itemId = -1;
            slot.quantity = 0;
        }
        if (!entries) return;
        for (const entry of entries) {
            const slot = Math.max(0, Math.min(bank.length - 1, entry.slot));
            const itemId = entry.itemId;
            const quantity = Math.max(0, entry.quantity);
            const placeholder = !!entry.placeholder;
            const filler = !!entry.filler;
            const tab = Math.max(0, entry.tab ?? 0);
            const hasItem = itemId > 0 && quantity > 0;
            bank[slot].itemId = hasItem ? itemId : placeholder || filler ? itemId : -1;
            bank[slot].quantity = hasItem ? quantity : 0;
            bank[slot].placeholder = placeholder && itemId > 0;
            bank[slot].filler = filler && itemId > 0;
            bank[slot].tab = tab;
        }
        this.items.bankClientSlotMapping = [];
    }

    exportBankSnapshot(): BankSnapshotEntry[] {
        const snapshot: BankSnapshotEntry[] = [];
        const bank = this.getBankEntries();
        for (let i = 0; i < bank.length; i++) {
            const entry = bank[i];
            if (!entry) continue;
            if (entry.itemId > 0 && (entry.quantity > 0 || entry.placeholder || entry.filler)) {
                snapshot.push({
                    slot: i,
                    itemId: entry.itemId,
                    quantity: Math.max(0, entry.quantity),
                    placeholder: !!entry.placeholder,
                    filler: !!entry.filler,
                    tab: Math.max(0, entry.tab ?? 0),
                });
            }
        }
        return snapshot;
    }

    exportInventorySnapshot(): InventorySnapshotEntry[] {
        const snapshot: InventorySnapshotEntry[] = [];
        const inventory = this.getInventoryEntries();
        for (let i = 0; i < inventory.length; i++) {
            const entry = inventory[i];
            if (!entry) continue;
            if (entry.itemId > 0 && entry.quantity > 0) {
                snapshot.push({ slot: i, itemId: entry.itemId, quantity: entry.quantity });
            }
        }
        return snapshot;
    }

    exportEquipmentSnapshot(): EquipmentSnapshotEntry[] {
        const equip = this.ensureAppearanceEquip();
        const equipQty = this.ensureAppearanceEquipQty();
        const snapshot: EquipmentSnapshotEntry[] = [];
        for (let slot = 0; slot < equip.length; slot++) {
            const itemId = equip[slot];
            if (itemId > 0) {
                if (slot === EquipmentSlot.AMMO) {
                    const qtyRaw = equipQty[slot];
                    snapshot.push({ slot, itemId, quantity: Math.max(1, qtyRaw) });
                } else {
                    snapshot.push({ slot, itemId });
                }
            }
        }
        return snapshot;
    }

    clearBank(): void {
        this.items.bank = createEmptyBank(this.getBankCapacity());
        this.items.bankClientSlotMapping = [];
    }

    clearInventory(): void {
        const inventory = this.getInventoryEntries();
        for (let slot = 0; slot < inventory.length; slot++) {
            const entry = inventory[slot];
            if (entry.itemId <= 0 && entry.quantity === 0) {
                continue;
            }
            this.setInventorySlot(slot, -1, 0);
        }
    }

    getBankWithdrawNotes(): boolean {
        return !!this.items.bankWithdrawNoteMode;
    }

    setBankWithdrawNotes(enabled: boolean): void {
        this.items.bankWithdrawNoteMode = !!enabled;
    }

    getBankInsertMode(): boolean {
        return !!this.items.bankInsertMode;
    }

    setBankInsertMode(insert: boolean): void {
        this.items.bankInsertMode = !!insert;
    }

    getBankPlaceholderMode(): boolean {
        return !!this.items.bankPlaceholderMode;
    }

    setBankPlaceholderMode(enabled: boolean): void {
        this.items.bankPlaceholderMode = !!enabled;
    }

    releaseBankPlaceholders(): number {
        let cleared = 0;
        const bank = this.ensureBankInitialized();
        for (const entry of bank) {
            if (entry && entry.placeholder && entry.quantity === 0) {
                entry.itemId = -1;
                entry.quantity = 0;
                entry.placeholder = false;
                cleared++;
            }
        }
        if (cleared > 0) this.items.bankDirty = true;
        return cleared;
    }

    getBankQuantityMode(): number {
        return this.items.bankQuantityMode;
    }

    setBankQuantityMode(mode: number): void {
        if (!Number.isFinite(mode)) return;
        this.items.bankQuantityMode = Math.max(0, Math.min(5, mode));
    }

    getBankCustomQuantity(): number {
        return Math.max(0, this.items.bankCustomQuantity);
    }

    setBankCustomQuantity(amount: number): void {
        if (!Number.isFinite(amount)) {
            this.items.bankCustomQuantity = 0;
            return;
        }
        this.items.bankCustomQuantity = Math.max(0, Math.min(2147483647, amount));
    }

    /**
     * Get the number of active bank tabs.
     * Calculates dynamically from actual bank entries.
     * Returns the highest tab number with items + 1 (minimum 1 for "All items" tab).
     */
    getBankTabCount(): number {
        // Calculate dynamically from actual bank entries
        // This matches how client-side CS2 determines tab visibility via varbits
        const bank = this.getBankEntries();
        let maxTab = 0;
        for (const entry of bank) {
            // Count items AND placeholders (both keep tabs visible in OSRS)
            if (entry.itemId > 0 && !entry.filler) {
                const tab = entry.tab ?? 0;
                if (tab >= 1 && tab <= 9 && tab > maxTab) {
                    maxTab = tab;
                }
            }
        }
        // Tab 0 is always "All items", tabs 1-9 are user tabs
        // So if maxTab is 2, we have tabs 0, 1, 2 = 3 tabs
        return maxTab + 1;
    }

    /**
     * Get the first available slot in a specific tab (server-side array index).
     * Returns -1 if no slot is available.
     *
     * Note: This operates on the server's internal storage where items have
     * a `tab` property. The client sees items reorganized by tab (contiguous).
     * See buildBankPayload() in BankingManager for the client-facing model.
     */
    getFirstAvailableSlotInTab(tab: number): number {
        const bank = this.getBankEntries();
        // Find empty slot near existing items in this tab
        let tabStart = -1;
        let tabEnd = -1;

        for (let i = 0; i < bank.length; i++) {
            const entry = bank[i];
            if (entry.itemId > 0 && entry.tab === tab) {
                if (tabStart === -1) tabStart = i;
                tabEnd = i;
            }
        }

        if (tab === 0) {
            // For "All items" tab, find first empty slot anywhere
            for (let i = 0; i < bank.length; i++) {
                if (bank[i].itemId <= 0 && !bank[i].placeholder) {
                    return i;
                }
            }
        } else {
            // For other tabs, add after the last item in that tab
            if (tabEnd >= 0 && tabEnd + 1 < bank.length) {
                return tabEnd + 1;
            }
        }

        return -1;
    }

    /**
     * Create a new bank tab with an item from inventory.
     * Returns the new tab number, or -1 if failed.
     */
    createBankTab(): number {
        const currentTabs = this.getBankTabCount();
        if (currentTabs >= 10) {
            // Maximum 9 user tabs + 1 "All items" tab = 10 total
            return -1;
        }
        // New tab number is current count (since tabs are 0-indexed)
        return currentTabs;
    }

    /**
     * Get the size of a specific bank tab (1-9).
     * Calculates dynamically by counting items with that tab property.
     */
    getBankTabSize(tabIndex: number): number {
        if (tabIndex < 1 || tabIndex > 9) return 0;
        const bank = this.getBankEntries();
        let count = 0;
        for (const entry of bank) {
            if (entry.itemId > 0 && !entry.filler && entry.tab === tabIndex) {
                count++;
            }
        }
        return count;
    }

    /**
     * Get all bank tab sizes as an array.
     * Calculates dynamically from actual bank entries.
     * Index 0 = tab 1 size, index 1 = tab 2 size, etc.
     */
    getBankTabSizes(): number[] {
        const bank = this.getBankEntries();
        const sizes = [0, 0, 0, 0, 0, 0, 0, 0, 0];
        for (const entry of bank) {
            if (entry.itemId > 0 && !entry.filler) {
                const tab = entry.tab ?? 0;
                if (tab >= 1 && tab <= 9) {
                    sizes[tab - 1]++;
                }
            }
        }
        return sizes;
    }

    /**
     * Get the starting slot for a bank tab based on cumulative sizes.
     *
     * In OSRS, bank items are stored contiguously by tab.
     * Tab 1 items occupy slots 0 to (tab1_size - 1), Tab 2 items occupy
     * slots tab1_size to (tab1_size + tab2_size - 1), etc.
     * Tab 0 (untabbed/"All items") items are stored after all tabbed items.
     *
     * Note: Our server stores items with a `tab` property in any slot.
     * buildBankPayload() reorganizes items by tab when sending to client,
     * so client slot indices match this contiguous model.
     */
    getBankTabStartSlot(tabIndex: number): number {
        if (tabIndex <= 1) return 0;
        const sizes = this.getBankTabSizes();
        let startSlot = 0;
        for (let t = 1; t < tabIndex && t <= 9; t++) {
            startSlot += sizes[t - 1] ?? 0;
        }
        return startSlot;
    }

    getActiveShopId(): string | undefined {
        return this.items.activeShopId;
    }

    setActiveShopId(id: string | undefined): void {
        this.items.activeShopId = id ? String(id) : undefined;
    }

    getShopBuyMode(): number {
        return this.items.shopBuyMode;
    }

    setShopBuyMode(mode: number): void {
        if (!Number.isFinite(mode)) return;
        this.items.shopBuyMode = Math.max(0, Math.min(4, mode));
    }

    getShopSellMode(): number {
        return this.items.shopSellMode;
    }

    setShopSellMode(mode: number): void {
        if (!Number.isFinite(mode)) return;
        this.items.shopSellMode = Math.max(0, Math.min(4, mode));
    }

    getSmithingQuantityMode(): number {
        return this.items.smithingQuantityMode;
    }

    setSmithingQuantityMode(mode: number): void {
        if (!Number.isFinite(mode)) return;
        this.items.smithingQuantityMode = Math.max(0, Math.min(4, mode));
    }

    getSmithingCustomQuantity(): number {
        return Math.max(0, this.items.smithingCustomQuantity);
    }

    setSmithingCustomQuantity(amount: number): void {
        if (!Number.isFinite(amount)) {
            this.items.smithingCustomQuantity = 0;
            return;
        }
        this.items.smithingCustomQuantity = Math.max(0, Math.min(2147483647, amount));
    }

    getEquipmentCharges(itemId: number): number {
        return Math.max(0, this.equipmentChargeMap.get(itemId) ?? 0);
    }

    setEquipmentCharges(itemId: number, charges: number): void {
        if (!Number.isFinite(charges) || charges <= 0) {
            this.equipmentChargeMap.delete(itemId);
        } else {
            this.equipmentChargeMap.set(itemId, charges);
        }
    }

    hasEquippedItem(slot: EquipmentSlot, itemId: number): boolean {
        const equip = this.ensureAppearanceEquip();
        return equip[slot] === itemId;
    }


    // ========================================================================
    // Collection Log Methods
    // ========================================================================

    /** @deprecated Use `collectionLog.hasItem()` instead. */
    hasCollectionItem(itemId: number): boolean {
        return this.collectionLog.hasItem(itemId);
    }

    /** @deprecated Use `collectionLog.getItemCount()` instead. */
    getCollectionItemCount(itemId: number): number {
        return this.collectionLog.getItemCount(itemId);
    }

    /** @deprecated Use `collectionLog.addItem()` instead. */
    addCollectionItem(itemId: number, quantity: number = 1): boolean {
        return this.collectionLog.addItem(itemId, quantity);
    }

    /** @deprecated Use `collectionLog.getObtainedItems()` instead. */
    getCollectionObtainedItems(): Array<{ itemId: number; quantity: number }> {
        return this.collectionLog.getObtainedItems();
    }

    /** @deprecated Use `collectionLog.getTotalObtained()` instead. */
    getCollectionTotalObtained(): number {
        return this.collectionLog.getTotalObtained();
    }

    /** @deprecated Use `collectionLog.getCategoryStat()` instead. */
    getCollectionCategoryStat(
        structId: number,
    ): { count1: number; count2?: number; count3?: number } | undefined {
        return this.collectionLog.getCategoryStat(structId);
    }

    /** @deprecated Use `collectionLog.incrementCategoryStat()` instead. */
    incrementCollectionCategoryStat(structId: number, which: 1 | 2 | 3 = 1): void {
        this.collectionLog.incrementCategoryStat(structId, which);
    }

    /** @deprecated Use `collectionLog.getItemUnlocks()` instead. */
    getCollectionItemUnlocks(): CollectionLogUnlockEntry[] {
        return this.collectionLog.getItemUnlocks();
    }

    /** @deprecated Use `collectionLog.recordItemUnlock()` instead. */
    recordCollectionItemUnlock(itemId: number, runeDay: number): void {
        this.collectionLog.recordItemUnlock(itemId, runeDay);
    }

    /** @deprecated Use `collectionLog.setCategoryStat()` instead. */
    setCollectionCategoryStat(
        structId: number,
        count1: number,
        count2?: number,
        count3?: number,
    ): void {
        this.collectionLog.setCategoryStat(structId, count1, count2, count3);
    }

    /** @deprecated Use `collectionLog.isDirty()` instead. */
    isCollectionLogDirty(): boolean {
        return this.collectionLog.isDirty();
    }

    /** @deprecated Use `collectionLog.clearDirty()` instead. */
    clearCollectionLogDirty(): void {
        this.collectionLog.clearDirty();
    }

    /** @deprecated Use `collectionLog.serialize()` instead. */
    exportCollectionLogSnapshot(): PlayerPersistentVars["collectionLog"] {
        return this.collectionLog.serialize();
    }

    /** @deprecated Use `collectionLog.deserialize()` instead. */
    loadCollectionLogSnapshot(data?: PlayerPersistentVars["collectionLog"]): void {
        this.collectionLog.deserialize(data);
    }

    getInventoryEntries(): InventoryEntry[] {
        if (!Array.isArray(this.items.inventory) || this.items.inventory.length !== INVENTORY_SLOT_COUNT) {
            this.items.inventory = createEmptyInventory();
        }
        return this.items.inventory;
    }

    // =============== RSMod-style inventory methods ===============

    /**
     * Set the item definition resolver for automatic stackability lookups.
     * Should be called once when the player is created/initialized.
     * Matches RSMod's DefinitionSet pattern.
     */
    setItemDefResolver(resolver: ItemDefResolver): void {
        this.itemDefResolver = resolver;
    }

    /**
     * Get whether an item is stackable using the item definition resolver.
     */
    private isItemStackable(itemId: number): boolean {
        if (!this.itemDefResolver) return false;
        const def = this.itemDefResolver(itemId);
        return def?.stackable ?? false;
    }

    /**
     * Add an item to the player's inventory.
     * Matches RSMod's ItemContainer.add() pattern.
     *
     * @param itemId The item ID to add
     * @param amount The quantity to add (default 1)
     * @param options.assureFullInsertion If true, fails if not all items can be added
     * @returns Transaction result with requested, completed, and slot info
     */
    addItem(
        itemId: number,
        amount: number = 1,
        options?: { assureFullInsertion?: boolean },
    ): ItemTransaction {
        const inv = this.getInventoryEntries();
        const stackable = this.isItemStackable(itemId);
        const assureFullInsertion = options?.assureFullInsertion ?? true;

        if (amount <= 0) {
            return { requested: amount, completed: 0, slots: [] };
        }

        if (stackable) {
            // Find existing stack
            const existingSlot = inv.findIndex((e) => e.itemId === itemId && e.quantity > 0);
            if (existingSlot >= 0) {
                const currentQty = inv[existingSlot].quantity;
                // Check for overflow
                if (currentQty >= MAX_ITEM_STACK_QUANTITY - amount) {
                    if (assureFullInsertion) {
                        return { requested: amount, completed: 0, slots: [] };
                    }
                    const canAdd = MAX_ITEM_STACK_QUANTITY - currentQty;
                    if (canAdd <= 0) {
                        return { requested: amount, completed: 0, slots: [] };
                    }
                    this.setInventorySlot(existingSlot, itemId, currentQty + canAdd);
                    return {
                        requested: amount,
                        completed: canAdd,
                        slots: [{ slot: existingSlot, itemId, quantity: currentQty + canAdd }],
                    };
                }
                this.setInventorySlot(existingSlot, itemId, currentQty + amount);
                return {
                    requested: amount,
                    completed: amount,
                    slots: [{ slot: existingSlot, itemId, quantity: currentQty + amount }],
                };
            }

            // Find empty slot for new stack
            const emptySlot = inv.findIndex((e) => e.itemId <= 0 || e.quantity <= 0);
            if (emptySlot === -1) {
                return { requested: amount, completed: 0, slots: [] };
            }
            this.setInventorySlot(emptySlot, itemId, amount);
            return {
                requested: amount,
                completed: amount,
                slots: [{ slot: emptySlot, itemId, quantity: amount }],
            };
        }

        // Non-stackable: add one item per slot
        const emptySlots: number[] = [];
        for (let i = 0; i < inv.length && emptySlots.length < amount; i++) {
            if (inv[i].itemId <= 0 || inv[i].quantity <= 0) {
                emptySlots.push(i);
            }
        }

        if (emptySlots.length === 0) {
            return { requested: amount, completed: 0, slots: [] };
        }

        if (assureFullInsertion && emptySlots.length < amount) {
            return { requested: amount, completed: 0, slots: [] };
        }

        const slots: Array<{ slot: number; itemId: number; quantity: number }> = [];
        for (const slot of emptySlots) {
            this.setInventorySlot(slot, itemId, 1);
            slots.push({ slot, itemId, quantity: 1 });
        }

        return { requested: amount, completed: emptySlots.length, slots };
    }

    /**
     * Remove an item from the player's inventory.
     * Matches RSMod's ItemContainer.remove() pattern.
     *
     * @param itemId The item ID to remove
     * @param amount The quantity to remove (default 1)
     * @param options.assureFullRemoval If true, fails if not all items can be removed
     * @param options.beginSlot Start searching from this slot index
     * @returns Transaction result with requested, completed, and slot info
     */
    removeItem(
        itemId: number,
        amount: number = 1,
        options?: { assureFullRemoval?: boolean; beginSlot?: number },
    ): ItemTransaction {
        const inv = this.getInventoryEntries();
        const assureFullRemoval = options?.assureFullRemoval ?? false;
        const beginSlot = options?.beginSlot ?? 0;

        if (amount <= 0) {
            return { requested: amount, completed: 0, slots: [] };
        }

        // Count how many we have
        let hasAmount = 0;
        for (const entry of inv) {
            if (entry.itemId === itemId && entry.quantity > 0) {
                hasAmount += entry.quantity;
            }
        }

        if (assureFullRemoval && hasAmount < amount) {
            return { requested: amount, completed: 0, slots: [] };
        }

        if (hasAmount === 0) {
            return { requested: amount, completed: 0, slots: [] };
        }

        let totalRemoved = 0;
        const slots: Array<{ slot: number; itemId: number; quantity: number }> = [];

        // First pass: from beginSlot to end
        for (let i = beginSlot; i < inv.length && totalRemoved < amount; i++) {
            const entry = inv[i];
            if (entry.itemId !== itemId || entry.quantity <= 0) continue;

            const removeCount = Math.min(entry.quantity, amount - totalRemoved);
            totalRemoved += removeCount;

            const newQty = entry.quantity - removeCount;
            if (newQty <= 0) {
                this.setInventorySlot(i, -1, 0);
                slots.push({ slot: i, itemId, quantity: removeCount });
            } else {
                this.setInventorySlot(i, itemId, newQty);
                slots.push({ slot: i, itemId, quantity: removeCount });
            }
        }

        // Second pass: from 0 to beginSlot if we haven't removed enough
        if (totalRemoved < amount && beginSlot > 0) {
            for (let i = 0; i < beginSlot && totalRemoved < amount; i++) {
                const entry = inv[i];
                if (entry.itemId !== itemId || entry.quantity <= 0) continue;

                const removeCount = Math.min(entry.quantity, amount - totalRemoved);
                totalRemoved += removeCount;

                const newQty = entry.quantity - removeCount;
                if (newQty <= 0) {
                    this.setInventorySlot(i, -1, 0);
                    slots.push({ slot: i, itemId, quantity: removeCount });
                } else {
                    this.setInventorySlot(i, itemId, newQty);
                    slots.push({ slot: i, itemId, quantity: removeCount });
                }
            }
        }

        return { requested: amount, completed: totalRemoved, slots };
    }

    /**
     * Check if the player has at least `amount` of an item in inventory.
     */
    hasItem(itemId: number, amount: number = 1): boolean {
        const inv = this.getInventoryEntries();
        let count = 0;
        for (const entry of inv) {
            if (entry.itemId === itemId && entry.quantity > 0) {
                count += entry.quantity;
                if (count >= amount) return true;
            }
        }
        return false;
    }

    /**
     * Get total count of an item in inventory.
     */
    getItemCount(itemId: number): number {
        const inv = this.getInventoryEntries();
        let count = 0;
        for (const entry of inv) {
            if (entry.itemId === itemId && entry.quantity > 0) {
                count += entry.quantity;
            }
        }
        return count;
    }

    /**
     * Get the number of free inventory slots.
     */
    getFreeSlotCount(): number {
        const inv = this.getInventoryEntries();
        let count = 0;
        for (const entry of inv) {
            if (entry.itemId <= 0 || entry.quantity <= 0) {
                count++;
            }
        }
        return count;
    }

    /**
     * Check if inventory is full.
     */
    isInventoryFull(): boolean {
        return this.getFreeSlotCount() === 0;
    }

    loadInventorySnapshot(entries?: Iterable<InventorySnapshotEntry>): void {
        const inventory = this.getInventoryEntries();
        for (const entry of inventory) {
            entry.itemId = -1;
            entry.quantity = 0;
        }
        if (!entries) return;
        for (const entry of entries) {
            if (!entry) continue;
            const slot = entry.slot;
            if (slot < 0 || slot >= inventory.length) continue;
            if (!(entry.itemId > 0) || !(entry.quantity > 0)) continue;
            inventory[slot] = {
                itemId: entry.itemId,
                quantity: Math.max(1, entry.quantity),
            };
        }
    }

    loadEquipmentSnapshot(entries?: Iterable<EquipmentSnapshotEntry>): void {
        const equip = this.ensureAppearanceEquip();
        const equipQty = this.ensureAppearanceEquipQty();
        for (let i = 0; i < equip.length; i++) {
            equip[i] = -1;
            equipQty[i] = 0;
        }
        if (!entries) return;
        for (const entry of entries) {
            if (!entry) continue;
            const slot = entry.slot;
            if (slot < 0 || slot >= equip.length) continue;
            if (!(entry.itemId > 0)) continue;
            equip[slot] = entry.itemId;
            equipQty[slot] = slot === EquipmentSlot.AMMO ? Math.max(1, entry.quantity ?? 1) : 1;
        }
    }

    private exportSkillSnapshot(): PlayerSkillPersistentEntry[] {
        return this.skillSystem.exportSkillSnapshot();
    }

    private applySkillSnapshot(entries: Iterable<PlayerSkillPersistentEntry>): void {
        this.skillSystem.applySkillSnapshot(entries);
    }

    private applyLocationSnapshot(snapshot?: PlayerLocationSnapshot): void {
        if (!snapshot) return;
        if (!Number.isFinite(snapshot.x) || !Number.isFinite(snapshot.y)) return;
        const tileX = this.clampTileCoord(snapshot.x);
        const tileY = this.clampTileCoord(snapshot.y);
        const level = Number.isFinite(snapshot.level)
            ? Math.max(0, Math.min(3, snapshot.level))
            : this.level;
        const needsTeleport = this.tileX !== tileX || this.tileY !== tileY || this.level !== level;
        if (needsTeleport) {
            this.teleport(tileX, tileY, level);
        } else {
            this.clearPath();
        }
        if (snapshot.orientation !== undefined) {
            this.orientation = snapshot.orientation & 2047;
        }
        if (snapshot.rot !== undefined) {
            this.rot = snapshot.rot & 2047;
        } else {
            this.rot = this.orientation;
        }
        this.clearForcedOrientation();
    }

    private clampTileCoord(value: number): number {
        if (!Number.isFinite(value)) return 0;
        return Math.max(0, Math.min(32767, Math.floor(value)));
    }

    exportPersistentVars(): PlayerPersistentVars {
        const snapshot: PlayerPersistentVars = {};
        const varpData = this.varps.serialize();
        if (varpData.varps) snapshot.varps = varpData.varps;
        if (varpData.varbits) snapshot.varbits = varpData.varbits;
        const gamemodeData = PlayerState.gamemodeRef?.serializePlayerState(this);
        if (gamemodeData && Object.keys(gamemodeData).length > 0) {
            snapshot.gamemodeData = gamemodeData;
        }
        // Persist character design (gender/body kits/colors). Equipment is stored separately.
        const accountSnapshot = this.account.serialize();
        snapshot.accountStage = accountSnapshot.accountStage;
        if (this.appearance) {
            snapshot.appearance = {
                gender: this.appearance.gender,
                kits: this.appearance.kits?.map((n) => n),
                colors: this.appearance.colors?.map((n) => n),
            };
        }
        const bankSnapshot = this.exportBankSnapshot();
        if (bankSnapshot.length > 0) snapshot.bank = bankSnapshot;
        const capacity = this.getBankCapacity();
        if (capacity !== DEFAULT_BANK_CAPACITY) {
            snapshot.bankCapacity = capacity;
        } else if (bankSnapshot.length > 0) {
            snapshot.bankCapacity = capacity;
        }
        const customQuantity = this.getBankCustomQuantity();
        if (customQuantity > 0) {
            snapshot.bankQuantityCustom = customQuantity;
        }
        snapshot.bankInsertMode = this.getBankInsertMode();
        snapshot.bankWithdrawNotes = this.getBankWithdrawNotes();
        snapshot.bankQuantityMode = this.getBankQuantityMode();
        snapshot.bankPlaceholders = this.getBankPlaceholderMode();
        snapshot.inventory = this.exportInventorySnapshot();
        snapshot.equipment = this.exportEquipmentSnapshot();
        snapshot.skills = this.exportSkillSnapshot();
        snapshot.hitpoints = this.getHitpointsCurrent();
        snapshot.location = {
            x: this.tileX,
            y: this.tileY,
            level: this.level,
            orientation: this.orientation & 2047,
            rot: this.rot & 2047,
        };
        snapshot.runEnergy = this.getRunEnergyUnits();
        snapshot.runToggle = !!this.runToggle;
        snapshot.autoRetaliate = !!this.autoRetaliate;
        snapshot.combatStyleSlot = this.combatStyleSlot;
        if (this.combatStyleCategory !== undefined) {
            snapshot.combatStyleCategory = this.combatStyleCategory;
        }
        if (this.combatSpellId > 0) {
            snapshot.combatSpellId = this.combatSpellId;
        }
        snapshot.autocastEnabled = !!this.autocastEnabled;
        snapshot.autocastMode = this.autocastMode ?? null;
        snapshot.specialEnergy = this.getSpecialEnergyUnits();
        snapshot.specialActivated = this.isSpecialActivated();
        if (this.prayer.quickPrayers.size > 0) {
            snapshot.quickPrayers = Array.from(this.prayer.quickPrayers);
        }
        if (this.equipmentChargeMap.size > 0) {
            const entries: Array<{ itemId: number; charges: number }> = [];
            for (const [itemId, charges] of this.equipmentChargeMap.entries()) {
                if (charges > 0) entries.push({ itemId, charges });
            }
            if (entries.length > 0) snapshot.equipmentCharges = entries;
        }
        // Degradation charges (crystal bow, etc.)
        if (this.degradationCharges.size > 0) {
            const degradationEntries: Array<{ slot: number; itemId: number; charges: number }> = [];
            for (const [slot, charges] of this.degradationCharges.entries()) {
                const itemId = this.degradationLastItemId.get(slot);
                if (itemId !== undefined && charges > 0) {
                    degradationEntries.push({ slot, itemId, charges });
                }
            }
            if (degradationEntries.length > 0) {
                snapshot.degradationCharges = degradationEntries;
            }
        }
        // Collection log
        const collectionLog = this.collectionLog.serialize();
        if (collectionLog) {
            snapshot.collectionLog = collectionLog;
        }
        const followerSnapshot = this.followers.serialize();
        if (followerSnapshot) {
            snapshot.follower = followerSnapshot;
        }
        snapshot.accountCreationTimeMs = accountSnapshot.accountCreationTimeMs;
        snapshot.playTimeSeconds = accountSnapshot.playTimeSeconds;
        return snapshot;
    }

    applyPersistentVars(state?: PlayerPersistentVars): void {
        this.gamemodeState.clear();
        if (!state) {
            this.varps.deserialize(undefined);
            this.ensureBankInitialized();
            return;
        }
        this.account.deserialize({
            accountStage: state.accountStage,
            accountCreationTimeMs: state.accountCreationTimeMs,
            playTimeSeconds: state.playTimeSeconds,
        });
        if (state.appearance) {
            if (state.appearance.gender !== undefined) {
                this.appearance.gender = state.appearance.gender === 1 ? 1 : 0;
            }
            if (state.appearance.kits) {
                this.appearance.kits = state.appearance.kits.map((n) => n).slice(0, 7);
            }
            if (state.appearance.colors) {
                this.appearance.colors = state.appearance.colors.map((n) => n).slice(0, 5);
            }
            this.markAppearanceDirty();
        }
        this.varps.deserialize({ varps: state.varps, varbits: state.varbits });
        if (state.gamemodeData && Object.keys(state.gamemodeData).length > 0) {
            PlayerState.gamemodeRef?.deserializePlayerState(
                this,
                state.gamemodeData as Record<string, unknown>,
            );
        }
        const capacity = state.bankCapacity;
        if (capacity !== undefined && capacity > 0) {
            this.setBankCapacity(capacity);
        } else {
            this.ensureBankInitialized();
        }
        if (state.bankPlaceholders !== undefined) {
            this.setBankPlaceholderMode(state.bankPlaceholders);
        }
        if (Array.isArray(state.bank)) {
            this.loadBankSnapshot(state.bank, undefined);
        } else {
            this.ensureBankInitialized();
        }
        if (state.bankQuantityCustom !== undefined) {
            this.setBankCustomQuantity(state.bankQuantityCustom);
        }
        if (state.bankQuantityMode !== undefined) {
            this.setBankQuantityMode(state.bankQuantityMode);
        }
        if (state.bankWithdrawNotes !== undefined) {
            this.setBankWithdrawNotes(state.bankWithdrawNotes);
        }
        if (state.bankInsertMode !== undefined) {
            this.setBankInsertMode(state.bankInsertMode);
        }
        if (state.inventory) {
            this.loadInventorySnapshot(state.inventory);
        }
        if (state.equipment) {
            this.loadEquipmentSnapshot(state.equipment);
        }
        if (state.skills) {
            this.applySkillSnapshot(state.skills);
        }
        if (state.hitpoints !== undefined) {
            this.setHitpointsCurrent(state.hitpoints);
        }
        if (state.location) {
            this.applyLocationSnapshot(state.location);
        }
        if (state.runEnergy !== undefined) {
            this.setRunEnergyUnits(state.runEnergy);
        }
        if (state.runToggle !== undefined) {
            this.setRunToggle(state.runToggle);
        }
        if (state.autoRetaliate !== undefined) {
            this.setAutoRetaliate(state.autoRetaliate);
        }
        if (state.combatStyleSlot !== undefined || state.combatStyleCategory !== undefined) {
            this.setCombatStyle(state.combatStyleSlot, state.combatStyleCategory);
        }
        if (state.combatSpellId !== undefined) {
            this.setCombatSpell(state.combatSpellId);
        }
        if (state.autocastEnabled !== undefined) {
            this.autocastEnabled = state.autocastEnabled;
        }
        if (
            state.autocastMode === "autocast" ||
            state.autocastMode === "defensive_autocast" ||
            state.autocastMode === null
        ) {
            this.autocastMode = state.autocastMode ?? null;
        }
        const equip = this.ensureAppearanceEquip();
        restoreAutocastState(this, equip[EquipmentSlot.WEAPON] ?? -1);
        if (state.specialEnergy !== undefined) {
            const normalized = Math.max(
                0,
                Math.min(SPECIAL_ENERGY_MAX, Math.floor(state.specialEnergy)),
            );
            this.setSpecialEnergyPercent(normalized);
        }
        if (state.specialActivated !== undefined) {
            this.setSpecialActivated(state.specialActivated);
        }
        if (Array.isArray(state.quickPrayers) && state.quickPrayers.length > 0) {
            this.setQuickPrayers(state.quickPrayers as PrayerName[]);
        } else {
            this.setQuickPrayers([]);
        }
        this.equipmentChargeMap.clear();
        if (Array.isArray(state.equipmentCharges)) {
            for (const entry of state.equipmentCharges) {
                if (entry?.itemId > 0 && entry?.charges > 0) {
                    this.equipmentChargeMap.set(entry.itemId, entry.charges);
                }
            }
        }
        // Load degradation charges (crystal bow, etc.)
        this.degradationCharges.clear();
        this.degradationLastItemId.clear();
        if (Array.isArray(state.degradationCharges)) {
            for (const entry of state.degradationCharges) {
                const slot = entry.slot;
                const itemId = entry.itemId;
                const charges = entry.charges;
                if (slot < 0 || itemId <= 0 || charges <= 0) continue;
                this.degradationCharges.set(slot, charges);
                this.degradationLastItemId.set(slot, itemId);
            }
        }
        // Load collection log data
        this.collectionLog.deserialize(state.collectionLog);
        this.followers.deserialize(state.follower);
    }

    /** @deprecated Use `followers.getState()` instead. */
    getFollowerState(): PlayerFollowerPersistentEntry | undefined {
        return this.followers.getState();
    }

    /** @deprecated Use `followers.setState()` instead. */
    setFollowerState(state?: PlayerFollowerPersistentEntry): void {
        this.followers.setState(state);
    }

    /** @deprecated Use `followers.clearState()` instead. */
    clearFollowerState(): void {
        this.followers.clearState();
    }

    /** @deprecated Use `followers.getActiveNpcId()` instead. */
    getActiveFollowerNpcId(): number | undefined {
        return this.followers.getActiveNpcId();
    }

    /** @deprecated Use `followers.setActiveNpcId()` instead. */
    setActiveFollowerNpcId(npcId: number | undefined): void {
        this.followers.setActiveNpcId(npcId);
    }

    private ensureAppearanceEquip(): number[] {
        ensureEquipQtyArrayOn(this.appearance, DEFAULT_EQUIP_SLOT_COUNT);
        return ensureEquipArrayOn(this.appearance, DEFAULT_EQUIP_SLOT_COUNT);
    }

    private ensureAppearanceEquipQty(): number[] {
        return ensureEquipQtyArrayOn(this.appearance, DEFAULT_EQUIP_SLOT_COUNT);
    }

    getActivePrayers(): ReadonlySet<PrayerName> {
        return this.activePrayers;
    }

    clearActivePrayers(): boolean {
        if (this.activePrayers.size === 0) return false;
        this.activePrayers.clear();
        this.updatePrayerHeadIcon();
        return true;
    }

    getQuickPrayers(): ReadonlySet<PrayerName> {
        return this.prayer.quickPrayers;
    }

    setQuickPrayers(prayers: Iterable<PrayerName | string>): boolean {
        const next = new Set<PrayerName>();
        for (const entry of prayers) {
            const name = entry as PrayerName;
            if (!PRAYER_NAME_SET.has(name)) continue;
            next.add(name);
        }
        const changed = !this.arePrayerSetsEqual(next, this.prayer.quickPrayers);
        if (!changed) return false;
        this.prayer.quickPrayers = next;
        if (!this.arePrayerSetsEqual(this.prayer.quickPrayers, this.activePrayers)) {
            this.prayer.quickPrayersEnabled = false;
        }
        return true;
    }

    areQuickPrayersEnabled(): boolean {
        return this.prayer.quickPrayersEnabled;
    }

    setQuickPrayersEnabled(enabled: boolean): void {
        this.prayer.quickPrayersEnabled = !!enabled;
    }

    private arePrayerSetsEqual(a: ReadonlySet<PrayerName>, b: ReadonlySet<PrayerName>): boolean {
        if (a.size !== b.size) return false;
        for (const entry of a) {
            if (!b.has(entry)) return false;
        }
        return true;
    }

    hasPrayerActive(prayer: PrayerName): boolean {
        return this.activePrayers.has(prayer);
    }

    private updatePrayerHeadIcon(): void {
        let icon: PrayerHeadIcon | null = null;
        if (this.activePrayers.has("protect_from_melee")) icon = "protect_melee";
        else if (this.activePrayers.has("protect_from_missiles")) icon = "protect_missiles";
        else if (this.activePrayers.has("protect_from_magic")) icon = "protect_magic";
        else if (this.activePrayers.has("retribution")) icon = "retribution";
        else if (this.activePrayers.has("smite")) icon = "smite";
        else if (this.activePrayers.has("redemption")) icon = "redemption";
        this.setPrayerHeadIcon(icon);
    }

    private setPrayerHeadIcon(icon: PrayerHeadIcon | null): void {
        if (this.prayer.headIcon === icon) return;
        this.prayer.headIcon = icon;
        const index = icon != null ? PRAYER_HEAD_ICON_IDS[icon] ?? -1 : -1;
        this.appearance.headIcons.prayer = index;
    }

    getPrayerLevel(): number {
        const skill = this.getSkill(SkillId.Prayer);
        return Math.max(0, skill.baseLevel + skill.boost);
    }

    getPrayerDrainAccumulator(): number {
        return this.prayer.drainAccumulator;
    }

    setPrayerDrainAccumulator(value: number): void {
        this.prayer.drainAccumulator = Math.max(0, value);
    }

    resetPrayerDrainAccumulator(): void {
        this.prayer.drainAccumulator = 0;
    }

    /** @deprecated Use `skillSystem.getSkill(id)` instead. */
    getSkill(id: SkillId): SkillEntry { return this.skillSystem.getSkill(id); }
    /** @deprecated Use `skillSystem.setSkillXp(id, xp)` instead. */
    setSkillXp(id: SkillId, xp: number): void { this.skillSystem.setSkillXp(id, xp); }
    /** @deprecated Use `skillSystem.setSkillBoost(id, boostedLevel)` instead. */
    setSkillBoost(id: SkillId, boostedLevel: number): void { this.skillSystem.setSkillBoost(id, boostedLevel); }
    /** @deprecated Use `skillSystem.adjustSkillBoost(id, delta)` instead. */
    adjustSkillBoost(id: SkillId, delta: number): void { this.skillSystem.adjustSkillBoost(id, delta); }
    /** @deprecated Use `skillSystem.takeSkillSync()` instead. */
    takeSkillSync(): SkillSyncUpdate | undefined { return this.skillSystem.takeSkillSync(); }
    /** @deprecated Use `skillSystem.requestFullSkillSync()` instead. */
    requestFullSkillSync(): void { this.skillSystem.requestFullSkillSync(); }
    /** @deprecated Use `skillSystem.markAllSkillsDirty()` instead. */
    markAllSkillsDirty(): void { this.skillSystem.markAllSkillsDirty(); }
    /** @deprecated Use `skillSystem.markSkillDirty(id)` instead. */
    markSkillDirty(id: SkillId): void { this.skillSystem.markSkillDirty(id); }
    /** @deprecated Use `skillSystem.getSkillMinLevel(id)` instead. */
    getSkillMinLevel(id: SkillId): number { return this.skillSystem.getSkillMinLevel(id); }
    /** @deprecated Use `skillSystem.getHitpointsMax()` instead. */
    getHitpointsMax(): number { return this.skillSystem.getHitpointsMax(); }
    /** @deprecated Use `skillSystem.getHitpointsCurrent()` instead. */
    getHitpointsCurrent(): number { return this.skillSystem.getHitpointsCurrent(); }
    /** @deprecated Use `skillSystem.getSlayerTaskInfo(this.slayerTask)` instead. */
    getSlayerTaskInfo(): {
        onTask: boolean;
        monsterName?: string;
        monsterSpecies?: string[];
    } { return this.skillSystem.getSlayerTaskInfo(this.slayerTask); }
    /** @deprecated Use `skillSystem.setHitpointsCurrent(value)` instead. */
    setHitpointsCurrent(value: number): void { this.skillSystem.setHitpointsCurrent(value); }
    /** @deprecated Use `skillSystem.applyHitpointsDamage(amount)` instead. */
    applyHitpointsDamage(amount: number): { current: number; max: number } { return this.skillSystem.applyHitpointsDamage(amount); }
    /** @deprecated Use `skillSystem.applyHitpointsHeal(amount)` instead. */
    applyHitpointsHeal(amount: number): { current: number; max: number } { return this.skillSystem.applyHitpointsHeal(amount); }

    /**
     * Add delay to the player's attack timer (OSRS: eating food adds +3 ticks, combo food +2 ticks).
     * Reference: docs/tick-cycle-order.md
     *
     * @param ticks Number of ticks to add to attack delay
     */
    addAttackDelay(ticks: number): void {
        if (!(ticks > 0)) return;
        this.attackDelayTicks = Math.max(this.attackDelayTicks, 0) + ticks;
    }

    /** @deprecated Use `skillSystem.inflictPoison(...)` instead. */
    inflictPoison(potency: number, currentTick: number, interval?: number): void { this.skillSystem.inflictPoison(potency, currentTick, interval); }
    /** @deprecated Use `skillSystem.curePoison()` instead. */
    curePoison(): void { this.skillSystem.curePoison(); }
    /** @deprecated Use `skillSystem.inflictVenom(...)` instead. */
    inflictVenom(stage: number, currentTick: number, interval?: number, ramp?: number, cap?: number): void { this.skillSystem.inflictVenom(stage, currentTick, interval, ramp, cap); }
    /** @deprecated Use `skillSystem.cureVenom()` instead. */
    cureVenom(): void { this.skillSystem.cureVenom(); }
    /** @deprecated Use `skillSystem.inflictDisease(...)` instead. */
    inflictDisease(potency: number, currentTick: number, interval?: number): void { this.skillSystem.inflictDisease(potency, currentTick, interval); }
    /** @deprecated Use `skillSystem.cureDisease()` instead. */
    cureDisease(): void { this.skillSystem.cureDisease(); }
    /** @deprecated Use `skillSystem.startRegeneration(...)` instead. */
    startRegeneration(heal: number, durationTicks: number, currentTick: number, interval?: number): void { this.skillSystem.startRegeneration(heal, durationTicks, currentTick, interval); }
    /** @deprecated Use `skillSystem.stopRegeneration()` instead. */
    stopRegeneration(): void { this.skillSystem.stopRegeneration(); }
    /** @deprecated Use `skillSystem.tickSkillRestoration(currentTick)` instead. */
    tickSkillRestoration(currentTick: number): void { this.skillSystem.tickSkillRestoration(currentTick); }
    /** @deprecated Use `skillSystem.tickHitpoints(currentTick)` instead. */
    tickHitpoints(currentTick: number): StatusHitsplat[] | undefined { return this.skillSystem.tickHitpoints(currentTick); }
}

export { PlayerManager, type OrphanedPlayer } from "./PlayerManager";
