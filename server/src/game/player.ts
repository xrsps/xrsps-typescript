import { EquipmentSlot } from "../../../src/rs/config/player/Equipment";
import {
    PrayerName,
} from "../../../src/rs/prayer/prayers";
import {
    SKILL_IDS,
    SkillId,
} from "../../../src/rs/skill/skills";
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
import { PlayerCollectionLogState } from "./state/PlayerCollectionLogState";
import type { CollectionLogUnlockEntry } from "./state/PlayerCollectionLogState";
import { PlayerCombatState } from "./state/PlayerCombatState";
import { PlayerFollowerPersistState } from "./state/PlayerFollowerPersistState";
import { PlayerInventoryState } from "./state/PlayerInventoryState";
import { PlayerPrayerState } from "./state/PlayerPrayerState";
import { PlayerStatusState } from "./state/PlayerStatusState";
import { PlayerAggressionTracker } from "./state/PlayerAggressionTracker";
import { PlayerRunEnergyState, type RunEnergyOwner } from "./state/PlayerRunEnergyState";
import { PlayerVarpState } from "./state/PlayerVarpState";
import { PlayerBankSystem, DEFAULT_BANK_CAPACITY } from "./state/PlayerBankSystem";
import { PlayerSpecialEnergyState } from "./state/PlayerSpecialEnergyState";
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

// Re-export inventory types from PlayerInventoryState for backward compatibility
export {
    INVENTORY_SLOT_COUNT,
    type InventoryEntry,
    type ItemDefResolver,
    type ItemTransaction,
} from "./state/PlayerInventoryState";
import {
    type InventoryEntry,
    type ItemDefResolver,
    type ItemTransaction,
} from "./state/PlayerInventoryState";

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
export type InventorySnapshotEntry = { slot: number; itemId: number; quantity: number };
export type EquipmentSnapshotEntry = { slot: number; itemId: number; quantity?: number };
export interface InventoryAddResult {
    slot: number;
    added: number;
}

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

export type { CollectionLogUnlockEntry } from "./state/PlayerCollectionLogState";

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
    [key: symbol]: unknown;

    readonly gamemodeState: Map<string, unknown> = new Map();

    override readonly isPlayer = true;
    widgets: PlayerWidgetManager;
    visibleNpcIds: Set<number> = new Set();
    /** NPC IDs spawned for this player's current instance (sailing, etc.). */
    instanceNpcIds: Set<number> = new Set();
    /** WorldView this player belongs to (-1 = overworld, >=0 = entity index). */
    worldViewId: number = -1;
    /** Per-player NPC healthbar baseline (npcId -> defId -> last scaled value). */
    lastNpcHealthBarScaled: Map<number, Map<number, number>> = new Map();
    /** Composed follower persistence state (pet item/npc tracking) */
    readonly followers = new PlayerFollowerPersistState();
    /** Composed skill system (levels, XP, hitpoints, status effects, restoration) */
    readonly skillSystem: PlayerSkillSystem;


    /**
     * OSRS PID-style processing priority. Lower values execute first
     * for same-tick player actions. Randomized per session.
     */
    private readonly pidPriority: number;
    /** Composed combat state (weapon, style, targets, freeze, special energy, etc.) */
    readonly combat = new PlayerCombatState();

    /** Save key for persistence. */
    __saveKey?: string;
    /** Composed inventory/bank/shop state */
    readonly items = new PlayerInventoryState();
    /** Composed bank operations system */
    readonly bank = new PlayerBankSystem(this.items);
    /** Composed account metadata (creation time, play time, stage) */
    readonly account = new PlayerAccountState();
    /** Composed collection log state */
    readonly collectionLog = new PlayerCollectionLogState();
    /** Composed prayer state (active prayers, quick prayers, head icon, drain) */
    readonly prayer = new PlayerPrayerState();
    /** Composed status state (hitpoints, poison, venom, disease, regen) */
    readonly status = new PlayerStatusState();

    /** Composed run energy & stamina state */
    readonly energy = new PlayerRunEnergyState(
        this as unknown as RunEnergyOwner,
        () => this.gamemode.hasInfiniteRunEnergy(this),
    );
    /** Composed aggression tolerance tracker */
    readonly aggression = new PlayerAggressionTracker();
    /** Composed varp/varbit storage */
    readonly varps = new PlayerVarpState();
    /** Composed special attack energy state */
    readonly specEnergy = new PlayerSpecialEnergyState(this.combat);
    private equipmentChargeMap = new Map<number, number>();
    private walkDestination?: { x: number; y: number };
    private walkDestinationRun: boolean = false;
    private walkRepathAfterTick: number = Number.MIN_SAFE_INTEGER;
    private preserveWalkDestinationOnNextSetPath: boolean = false;

    // ========================================================================
    // RSMod-style interaction attributes
    // These mirror RSMod's COMBAT_TARGET_FOCUS_ATTR, INTERACTING_NPC_ATTR, etc.
    // ========================================================================


    // Combat target accessors
    /** @deprecated Use player.combat.getCombatTarget() directly */
    getCombatTarget(): NpcState | PlayerState | null {
        return this.combat.combatTargetFocus?.deref() as (NpcState | PlayerState | null) ?? null;
    }

    /** @deprecated Use player.combat.setCombatTarget() directly */
    setCombatTarget(target: NpcState | PlayerState | null): void {
        this.combat.combatTargetFocus = target ? new WeakRef(target) : null;
    }

    /** @deprecated Use player.combat.isAttacking() directly */
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
    /** @deprecated Use player.combat.getInteractingNpc() directly */
    getInteractingNpc(): NpcState | null {
        return this.combat.interactingNpc?.deref() ?? null;
    }

    /** @deprecated Use player.combat.setInteractingNpc() directly */
    setInteractingNpc(npc: NpcState | null): void {
        this.combat.interactingNpc = npc ? new WeakRef(npc) : null;
    }

    /** @deprecated Use player.combat.getInteractingPlayer() directly */
    getInteractingPlayer(): PlayerState | null {
        return this.combat.interactingPlayer?.deref() as (PlayerState | null) ?? null;
    }

    /** @deprecated Use player.combat.setInteractingPlayer() directly */
    setInteractingPlayer(player: PlayerState | null): void {
        this.combat.interactingPlayer = player ? new WeakRef(player) : null;
    }

    // Last hit tracking
    /** @deprecated Use player.combat.getLastHitBy() directly */
    getLastHitBy(): NpcState | PlayerState | null {
        return this.combat.lastHitBy?.deref() as (NpcState | PlayerState | null) ?? null;
    }

    /** @deprecated Use player.combat.setLastHitBy() directly */
    setLastHitBy(pawn: NpcState | PlayerState | null): void {
        this.combat.lastHitBy = pawn ? new WeakRef(pawn) : null;
    }

    /** @deprecated Use player.combat.getLastHit() directly */
    getLastHit(): NpcState | PlayerState | null {
        return this.combat.lastHit?.deref() as (NpcState | PlayerState | null) ?? null;
    }

    /** @deprecated Use player.combat.setLastHit() directly */
    setLastHit(pawn: NpcState | PlayerState | null): void {
        this.combat.lastHit = pawn ? new WeakRef(pawn) : null;
    }

    resetInteractions(): void {
        this.combat.combatTargetFocus = null;
        this.combat.interactingNpc = null;
        this.combat.interactingPlayer = null;
        this.clearInteractionTarget();
    }

    /** @deprecated Use player.combat.resetCombat() directly */
    resetCombat(): void {
        this.combat.combatTargetFocus = null;
    }

    /** @deprecated Use player.combat.removeCombatTarget() directly */
    removeCombatTarget(): void {
        this.combat.combatTargetFocus = null;
    }

    /**
     * Check if attack delay is ready (can attack now).
     * RSMod: Combat.isAttackDelayReady(pawn)
     * @deprecated Use player.combat.isAttackDelayReady() directly
     */
    isAttackDelayReady(): boolean {
        return this.combat.attackDelayTicks <= 0;
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
    /** Player display name */
    public name: string = "";
    /** Display mode (mobile vs desktop) - set during login based on clientType */
    public displayMode: DisplayMode = DisplayMode.RESIZABLE_NORMAL;
    /** Pending face direction (consumed by interaction system) */
    _pendingFace?: { x: number; y: number };

    constructor(id: number, spawnTileX: number, spawnTileY: number, level: number = 0, public readonly gamemode: GamemodeDefinition) {
        super(id, spawnTileX, spawnTileY, level);
        // Random per-session priority similar to OSRS PID randomness.
        this.pidPriority = Math.random() * 0x7fffffff;
        this.rot = 1024;
        this.orientation = 1024;
        this.widgets = new PlayerWidgetManager();
        this.skillSystem = new PlayerSkillSystem(
            this.status,
            (name) => this.prayer.hasPrayerActive(name as PrayerName),
            (h, s, l, o, d) => this.setColorOverride(h, s, l, o, d),
            this.gamemode.getDefaultSkillXp
                ? (id) => this.gamemode.getDefaultSkillXp!(id)
                : undefined,
        );
        this.skillSystem.requestFullSkillSync();
        this.combat.styleCategory = 0;
        this.appearance = {
            gender: 0,
            colors: undefined,
            kits: undefined,
            equip: new Array<number>(DEFAULT_EQUIP_SLOT_COUNT).fill(-1),
            headIcons: { prayer: -1 },
        };
        // Wire prayer deps for head icon and prayer level resolution
        this.prayer.setDeps({
            getPrayerSkillLevel: () => {
                const skill = this.skillSystem.getSkill(SkillId.Prayer);
                return Math.max(0, skill.baseLevel + skill.boost);
            },
            setHeadIconIndex: (index) => {
                this.appearance.headIcons.prayer = index;
            },
        });
        // Default to post-design for existing saves; new accounts can override to 0.
        this.account.accountStage = 1;

        // Delegate gamemode-specific player initialization
        this.gamemode.initializePlayer(this);
        // Task count is server-authoritative; default is 0 for new accounts.
        // Initialize task queue (RSMod: Pawn.queue)
        this.taskQueue = new QueueTaskSet<PlayerState>(this);
    }


    getPidPriority(): number {
        return this.pidPriority;
    }

    /** @deprecated Use player.items.setInventorySlot() directly */
    setInventorySlot(slot: number, itemId: number, quantity: number): void {
        this.items.setInventorySlot(slot, itemId, quantity);
    }

    setBankSlot(slot: number, itemId: number, quantity: number): void {
        const bank = this.bank.getBankEntries();
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

    /** @deprecated Use player.items.markInventoryDirty() directly */
    markInventoryDirty(): void {
        this.items.markInventoryDirty();
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
        return this.bank.exportBankSnapshot();
    }

    takeEquipmentSnapshot(): EquipmentSnapshotEntry[] | undefined {
        if (!this.equipmentDirty) return undefined;
        this.equipmentDirty = false;
        return this.exportEquipmentSnapshot();
    }

    hasAppearanceUpdate(): boolean {
        return this.appearanceDirty;
    }

    takeAppearanceSnapshot(): PlayerAppearance | undefined {
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


    private canInteractWithWorld(): boolean {
        return this.gamemode.canInteract(this);
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

    setCombatStyle(style: number | null | undefined, category?: number): void {
        const normalizedCategory = category ?? this.combat.styleCategory;
        const previousCategory = this.combat.styleCategory;
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
            desiredSlot = this.combat.styleSlot;
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
        this.combat.styleSlot = normalizedSlot;
        if (normalizedCategory !== undefined) {
            this.combat.styleCategory = normalizedCategory;
            this.combat.styleMemory.set(normalizedCategory, normalizedSlot);
        }
    }

    setCombatCategoryAttackTypes(types: AttackType[] | undefined): void {
        this.combat.attackTypes = types ? types.slice() : undefined;
        if (this.combat.attackTypes && this.combat.attackTypes.length > 0) {
            const maxSlot = this.combat.attackTypes.length - 1;
            if (this.combat.styleSlot > maxSlot) {
                this.combat.styleSlot = maxSlot;
            }
            // Ensure slot is valid (sparse arrays have gaps, e.g., bows skip slot 2)
            if (this.combat.attackTypes[this.combat.styleSlot] === undefined) {
                // Find nearest valid slot
                let foundSlot: number | undefined;
                for (let s = this.combat.styleSlot - 1; s >= 0; s--) {
                    if (this.combat.attackTypes[s] !== undefined) {
                        foundSlot = s;
                        break;
                    }
                }
                if (foundSlot === undefined) {
                    for (let s = this.combat.styleSlot + 1; s < this.combat.attackTypes.length; s++) {
                        if (this.combat.attackTypes[s] !== undefined) {
                            foundSlot = s;
                            break;
                        }
                    }
                }
                if (foundSlot !== undefined) {
                    this.combat.styleSlot = foundSlot;
                }
            }
        }
    }

    setCombatCategoryMeleeBonusIndices(indices: Array<number | undefined> | undefined): void {
        this.combat.meleeBonusIndices = indices ? indices.slice() : undefined;
        if (this.combat.meleeBonusIndices && this.combat.meleeBonusIndices.length > 0) {
            const maxSlot = this.combat.meleeBonusIndices.length - 1;
            if (this.combat.styleSlot > maxSlot) {
                this.combat.styleSlot = maxSlot;
            }
        }
    }

    getCurrentAttackType(): AttackType | undefined {
        if (!this.combat.attackTypes || this.combat.attackTypes.length === 0) return undefined;
        const slot = Math.max(0, Math.min(this.combat.attackTypes.length - 1, this.combat.styleSlot));
        return this.combat.attackTypes[slot];
    }

    getCurrentMeleeBonusIndex(): number | undefined {
        if (!this.combat.meleeBonusIndices || this.combat.meleeBonusIndices.length === 0)
            return undefined;
        const slot = Math.max(
            0,
            Math.min(this.combat.meleeBonusIndices.length - 1, this.combat.styleSlot),
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
            this.combat.spellId = -1;
            this.combat.autocastEnabled = false;
            this.combat.autocastMode = null;
            return;
        }
        this.combat.spellId = spellId;
    }

    setActivePrayers(prayers: Iterable<PrayerName>): boolean {
        return this.prayer.setActivePrayers(prayers);
    }

    public override hasAvailableRunEnergy(): boolean { return this.energy.hasAvailableRunEnergy(); }

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

    applyFreeze(durationTicks: number, currentTick: number): boolean {
        const expires = this.combat.tryApplyFreeze(durationTicks, currentTick);
        if (expires < 0) return false;
        this.lockMovementUntil(expires);
        this.clearPath();
        this.running = false;
        this.setColorOverride(42, 5, 80, 30, Math.max(1, durationTicks));
        return true;
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



    /** @deprecated Use player.items.clearInventory() directly */
    clearInventory(): void {
        this.items.clearInventory();
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

    /** @deprecated Use player.items.getInventoryEntries() directly */
    getInventoryEntries(): InventoryEntry[] {
        return this.items.getInventoryEntries();
    }

    /** @deprecated Use player.items.setItemDefResolver() directly */
    setItemDefResolver(resolver: ItemDefResolver): void {
        this.items.setItemDefResolver(resolver);
    }

    /** @deprecated Use player.items.addItem() directly */
    addItem(
        itemId: number,
        amount: number = 1,
        options?: { assureFullInsertion?: boolean },
    ): ItemTransaction {
        return this.items.addItem(itemId, amount, options);
    }

    /** @deprecated Use player.items.removeItem() directly */
    removeItem(
        itemId: number,
        amount: number = 1,
        options?: { assureFullRemoval?: boolean; beginSlot?: number },
    ): ItemTransaction {
        return this.items.removeItem(itemId, amount, options);
    }

    /** @deprecated Use player.items.hasItem() directly */
    hasItem(itemId: number, amount: number = 1): boolean {
        return this.items.hasItem(itemId, amount);
    }

    /** @deprecated Use player.items.getItemCount() directly */
    getItemCount(itemId: number): number {
        return this.items.getItemCount(itemId);
    }

    /** @deprecated Use player.items.getFreeSlotCount() directly */
    getFreeSlotCount(): number {
        return this.items.getFreeSlotCount();
    }

    /** @deprecated Use player.items.isInventoryFull() directly */
    isInventoryFull(): boolean {
        return this.items.isInventoryFull();
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
        const gamemodeData = this.gamemode.serializePlayerState(this);
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
        const bankSnapshot = this.bank.exportBankSnapshot();
        if (bankSnapshot.length > 0) snapshot.bank = bankSnapshot;
        const capacity = this.bank.getBankCapacity();
        if (capacity !== DEFAULT_BANK_CAPACITY) {
            snapshot.bankCapacity = capacity;
        } else if (bankSnapshot.length > 0) {
            snapshot.bankCapacity = capacity;
        }
        const customQuantity = this.bank.getBankCustomQuantity();
        if (customQuantity > 0) {
            snapshot.bankQuantityCustom = customQuantity;
        }
        snapshot.bankInsertMode = this.bank.getBankInsertMode();
        snapshot.bankWithdrawNotes = this.bank.getBankWithdrawNotes();
        snapshot.bankQuantityMode = this.bank.getBankQuantityMode();
        snapshot.bankPlaceholders = this.bank.getBankPlaceholderMode();
        snapshot.inventory = this.exportInventorySnapshot();
        snapshot.equipment = this.exportEquipmentSnapshot();
        snapshot.skills = this.exportSkillSnapshot();
        snapshot.hitpoints = this.skillSystem.getHitpointsCurrent();
        snapshot.location = {
            x: this.tileX,
            y: this.tileY,
            level: this.level,
            orientation: this.orientation & 2047,
            rot: this.rot & 2047,
        };
        snapshot.runEnergy = this.energy.getRunEnergyUnits();
        snapshot.runToggle = !!this.runToggle;
        snapshot.autoRetaliate = !!this.combat.autoRetaliate;
        snapshot.combatStyleSlot = this.combat.styleSlot;
        if (this.combat.styleCategory !== undefined) {
            snapshot.combatStyleCategory = this.combat.styleCategory;
        }
        if (this.combat.spellId > 0) {
            snapshot.combatSpellId = this.combat.spellId;
        }
        snapshot.autocastEnabled = !!this.combat.autocastEnabled;
        snapshot.autocastMode = this.combat.autocastMode ?? null;
        snapshot.specialEnergy = this.specEnergy.getUnits();
        snapshot.specialActivated = this.specEnergy.isActivated();
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
        if (this.combat.degradationCharges.size > 0) {
            const degradationEntries: Array<{ slot: number; itemId: number; charges: number }> = [];
            for (const [slot, charges] of this.combat.degradationCharges.entries()) {
                const itemId = this.combat.degradationLastItemId.get(slot);
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
            this.bank.getBankEntries();
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
            this.gamemode.deserializePlayerState(
                this,
                state.gamemodeData as Record<string, unknown>,
            );
        }
        const capacity = state.bankCapacity;
        if (capacity !== undefined && capacity > 0) {
            this.bank.setBankCapacity(capacity);
        } else {
            this.bank.getBankEntries();
        }
        if (state.bankPlaceholders !== undefined) {
            this.bank.setBankPlaceholderMode(state.bankPlaceholders);
        }
        if (Array.isArray(state.bank)) {
            this.bank.loadBankSnapshot(state.bank, undefined);
        } else {
            this.bank.getBankEntries();
        }
        if (state.bankQuantityCustom !== undefined) {
            this.bank.setBankCustomQuantity(state.bankQuantityCustom);
        }
        if (state.bankQuantityMode !== undefined) {
            this.bank.setBankQuantityMode(state.bankQuantityMode);
        }
        if (state.bankWithdrawNotes !== undefined) {
            this.bank.setBankWithdrawNotes(state.bankWithdrawNotes);
        }
        if (state.bankInsertMode !== undefined) {
            this.bank.setBankInsertMode(state.bankInsertMode);
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
            this.skillSystem.setHitpointsCurrent(state.hitpoints);
        }
        if (state.location) {
            this.applyLocationSnapshot(state.location);
        }
        if (state.runEnergy !== undefined) {
            this.energy.setRunEnergyUnits(state.runEnergy);
        }
        if (state.runToggle !== undefined) {
            this.setRunToggle(state.runToggle);
        }
        if (state.autoRetaliate !== undefined) {
            this.combat.autoRetaliate = !!state.autoRetaliate;
        }
        if (state.combatStyleSlot !== undefined || state.combatStyleCategory !== undefined) {
            this.setCombatStyle(state.combatStyleSlot, state.combatStyleCategory);
        }
        if (state.combatSpellId !== undefined) {
            this.setCombatSpell(state.combatSpellId);
        }
        if (state.autocastEnabled !== undefined) {
            this.combat.autocastEnabled = state.autocastEnabled;
        }
        if (
            state.autocastMode === "autocast" ||
            state.autocastMode === "defensive_autocast" ||
            state.autocastMode === null
        ) {
            this.combat.autocastMode = state.autocastMode ?? null;
        }
        const equip = this.ensureAppearanceEquip();
        restoreAutocastState(this, equip[EquipmentSlot.WEAPON] ?? -1);
        if (state.specialEnergy !== undefined) {
            this.specEnergy.setPercent(state.specialEnergy);
        }
        if (state.specialActivated !== undefined) {
            this.specEnergy.setActivated(state.specialActivated);
        }
        if (Array.isArray(state.quickPrayers) && state.quickPrayers.length > 0) {
            this.prayer.setQuickPrayers(state.quickPrayers as PrayerName[]);
        } else {
            this.prayer.setQuickPrayers([]);
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
        this.combat.degradationCharges.clear();
        this.combat.degradationLastItemId.clear();
        if (Array.isArray(state.degradationCharges)) {
            for (const entry of state.degradationCharges) {
                const slot = entry.slot;
                const itemId = entry.itemId;
                const charges = entry.charges;
                if (slot < 0 || itemId <= 0 || charges <= 0) continue;
                this.combat.degradationCharges.set(slot, charges);
                this.combat.degradationLastItemId.set(slot, itemId);
            }
        }
        // Load collection log data
        this.collectionLog.deserialize(state.collectionLog);
        this.followers.deserialize(state.follower);
    }


    private ensureAppearanceEquip(): number[] {
        ensureEquipQtyArrayOn(this.appearance, DEFAULT_EQUIP_SLOT_COUNT);
        return ensureEquipArrayOn(this.appearance, DEFAULT_EQUIP_SLOT_COUNT);
    }

    private ensureAppearanceEquipQty(): number[] {
        return ensureEquipQtyArrayOn(this.appearance, DEFAULT_EQUIP_SLOT_COUNT);
    }


    /**
     * Add delay to the player's attack timer (OSRS: eating food adds +3 ticks, combo food +2 ticks).
     * Reference: docs/tick-cycle-order.md
     *
     * @param ticks Number of ticks to add to attack delay
     */
    addAttackDelay(ticks: number): void {
        if (!(ticks > 0)) return;
        this.combat.attackDelayTicks = Math.max(this.combat.attackDelayTicks, 0) + ticks;
    }
}

export { PlayerManager, type OrphanedPlayer } from "./PlayerManager";
