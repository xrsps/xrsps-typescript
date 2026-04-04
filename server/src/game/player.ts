import { EquipmentSlot } from "../../../src/rs/config/player/Equipment";
import {
    PRAYER_HEAD_ICON_IDS,
    PRAYER_NAME_SET,
    PrayerHeadIcon,
    PrayerName,
} from "../../../src/rs/prayer/prayers";
import {
    MAX_REAL_LEVEL,
    MAX_VIRTUAL_LEVEL,
    MAX_XP,
    SKILL_COUNT,
    SKILL_IDS,
    SkillId,
    getLevelForXp,
    getXpForLevel,
} from "../../../src/rs/skill/skills";
import {
    VARBIT_HAM_TRAPDOOR,
    VARBIT_XPDROPS_ENABLED,
    VARP_AREA_SOUNDS_VOLUME,
    VARP_COMBAT_TARGET_PLAYER_INDEX,
    VARP_MASTER_VOLUME,
    VARP_MUSIC_VOLUME,
    VARP_SOUND_EFFECTS_VOLUME,
} from "../../../src/shared/vars";
import { PathService } from "../pathfinding/PathService";
import { logger } from "../utils/logger";
import { DisplayMode, PlayerWidgetManager } from "../widgets/WidgetManager";
import { DoorStateManager } from "../world/DoorStateManager";
import { Actor, DEBUG_PLAYER_IDS, RUN_ENERGY_MAX, Tile } from "./actor";
import type { AttackType } from "./combat/AttackType";
import { restoreAutocastState } from "./combat/AutocastState";
import { type ChargeTracker, createChargeTracker } from "./combat/DegradationSystem";
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
import {
    AGGRESSION_TIMER_TICKS,
    CUSTOM_TOLERANCE_TIMERS,
    NEVER_TOLERANT_NPCS,
    type PlayerAggressionState,
    TOLERANCE_REGION_RADIUS,
    createAggressionState,
    updateAggressionStateWithPosition,
} from "./combat/NpcCombatAI";
import { DEFAULT_EQUIP_SLOT_COUNT, ensureEquipArrayOn, ensureEquipQtyArrayOn } from "./equipment";
import { PlayerInteractionSystem, PlayerRepository } from "./interactions/PlayerInteractionSystem";
import {
    FollowInteractionKind,
    GroundItemInteractionState,
    PlayerInteractionState,
} from "./interactions/types";
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
import type { ScriptRuntime } from "./scripts/ScriptRuntime";
import { RING_OF_FORGING_ITEM_ID, RING_OF_FORGING_MAX_CHARGES } from "./skills/smithingBonuses";
import { normalizePlayerAccountName } from "./state/PlayerSessionKeys";

export { Actor } from "./actor";
export { type Tile } from "./actor";

const MAX_ITEM_STACK_QUANTITY = 2_147_483_647;

export interface PlayerSkillState {
    id: SkillId;
    xp: number;
    baseLevel: number;
    virtualLevel: number;
    boost: number;
}

export interface SkillSyncState {
    id: number;
    xp: number;
    baseLevel: number;
    virtualLevel: number;
    boost: number;
    currentLevel: number;
}

export interface SkillSyncUpdate {
    snapshot: boolean;
    skills: SkillSyncState[];
    totalLevel: number;
    combatLevel: number;
}

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

export interface PlayerSkillPersistentEntry {
    id: number;
    xp: number;
    boost?: number;
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

export interface CollectionLogUnlockEntry {
    itemId: number;
    runeDay: number;
    sequence: number;
}

// OSRS parity: modern OSRS bank starts at 800 slots (varp BANK_LOCKED_SLOTS is based on 1410 max slots).
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

const DEFAULT_SKILL_XP: Partial<Record<SkillId, number>> = {
    [SkillId.Hitpoints]: getXpForLevel(99),
    [SkillId.Magic]: getXpForLevel(99),
    [SkillId.Prayer]: getXpForLevel(99),
};

const SKILL_XP_PRECISION = 10;
const ZERO_PERSISTENT_VARPS = new Set<number>([
    VARP_MUSIC_VOLUME,
    VARP_SOUND_EFFECTS_VOLUME,
    VARP_AREA_SOUNDS_VOLUME,
    VARP_MASTER_VOLUME,
]);
const NON_PERSISTENT_VARPS = new Set<number>([VARP_COMBAT_TARGET_PLAYER_INDEX]);
/** Varbits that are session-only and must NOT be saved to disk (e.g. multiloc toggles). */
const NON_PERSISTENT_VARBITS = new Set<number>([
    VARBIT_HAM_TRAPDOOR, // HAM Hideout trapdoor — resets on logout like OSRS
]);
const ZERO_PERSISTENT_VARBITS = new Set<number>([
    // Persist explicit OFF/ON state for XP drops orb/total tracker toggle.
    VARBIT_XPDROPS_ENABLED,
]);
const DEFAULT_XPDROPS_ENABLED = 1;

export const normalizeSkillXpValue = (xp: number): number => {
    if (!Number.isFinite(xp)) return 0;
    const clamped = Math.max(0, Math.min(MAX_XP, xp));
    return Math.round(clamped * SKILL_XP_PRECISION) / SKILL_XP_PRECISION;
};

const MAX_TEMP_HITPOINT_LEVEL = Math.max(MAX_VIRTUAL_LEVEL, 126);
// OSRS: HP regenerates 1 point every 100 ticks (60 seconds), halved with Rapid Heal (50 ticks)
const HITPOINT_REGEN_INTERVAL_TICKS = 100;
// OSRS: Overheal (e.g., from Anglerfish) decays 1 per 100 ticks (60 seconds)
const HITPOINT_OVERHEAL_DECAY_INTERVAL_TICKS = 100;
// OSRS: Boosted/drained stats restore toward base level every 100 ticks (60 seconds)
const SKILL_RESTORE_INTERVAL_TICKS = 100;
// OSRS: Stat boosts (e.g., potions) decay 1 level every 100 ticks (60 seconds)
const SKILL_BOOST_DECAY_INTERVAL_TICKS = 100;
// OSRS: Preserve prayer extends stat boost decay by 50% (100 * 1.5 = 150 ticks / 90 seconds)
const PRESERVE_DECAY_MULTIPLIER = 1.5;

const RAD_TO_RS_UNITS = 2048 / (Math.PI * 2);

const SPECIAL_ENERGY_MAX = 100;
const SPECIAL_ENERGY_REGEN_CHUNK = 10;
const SPECIAL_ENERGY_REGEN_INTERVAL_TICKS = 50;
const DEFAULT_SPECIAL_ACCURACY_MULTIPLIER = 1.1;
const DEFAULT_STAMINA_DRAIN_MULTIPLIER = 0.3;
// OSRS parity: Stamina effect max duration is 8000 ticks (40 doses * 200 ticks each)
// Reference: docs/run-energy.md
const MAX_STAMINA_DURATION_TICKS = 8000;

type PoisonEffectState = {
    potency: number;
    nextTick: number;
    interval: number;
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

const COMBAT_SKILL_IDS = new Set<SkillId>([
    SkillId.Attack,
    SkillId.Defence,
    SkillId.Strength,
    SkillId.Hitpoints,
    SkillId.Prayer,
    SkillId.Ranged,
    SkillId.Magic,
]);

const DEFAULT_MAX_COMBAT_STYLE_SLOT = 3;
/**
 * Max combat style slot per weapon category.
 * OSRS parity: Most weapons use slots 0-3, but some have only 3 buttons
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

function createInitialSkills(): PlayerSkillState[] {
    const skills: PlayerSkillState[] = new Array(SKILL_COUNT);
    for (const id of SKILL_IDS) {
        const xp = DEFAULT_SKILL_XP[id] ?? 0;
        const baseLevel = getLevelForXp(xp, { virtual: false });
        const virtualLevel = getLevelForXp(xp, { virtual: true });
        skills[id] = {
            id,
            xp,
            baseLevel,
            virtualLevel,
            boost: 0,
        };
    }
    return skills;
}

function computeTotalLevel(skills: PlayerSkillState[]): number {
    return skills.reduce((sum, skill) => sum + skill.baseLevel, 0);
}

function computeCombatLevel(skills: PlayerSkillState[]): number {
    const attack = skills[SkillId.Attack].baseLevel;
    const defence = skills[SkillId.Defence].baseLevel;
    const strength = skills[SkillId.Strength].baseLevel;
    const hitpoints = skills[SkillId.Hitpoints].baseLevel;
    const prayer = skills[SkillId.Prayer].baseLevel;
    const ranged = skills[SkillId.Ranged].baseLevel;
    const magic = skills[SkillId.Magic].baseLevel;
    const base = 0.25 * (defence + hitpoints + Math.floor(prayer / 2));
    const melee = 0.325 * (attack + strength);
    const ranger = 0.325 * Math.floor(ranged * 1.5);
    const mage = 0.325 * Math.floor(magic * 1.5);
    return Math.floor(base + Math.max(melee, ranger, mage));
}

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
    ringOfForgingCharges?: number;
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
    private followerState?: PlayerFollowerPersistentEntry;
    private activeFollowerNpcId?: number;
    readonly skills: PlayerSkillState[];
    skillTotal: number;
    combatLevel: number;
    /**
     * OSRS PID-style processing priority. Lower values execute first
     * for same-tick player actions. Randomized per session.
     */
    private readonly pidPriority: number;
    autoRetaliate: boolean = true;
    combatWeaponCategory: number = 0;
    combatWeaponItemId: number = -1;
    /**
     * Attack reach in tiles derived from equipped weapon (ObjType param 13 when present).
     * OSRS parity: some melee weapons (e.g. halberds) have reach > 1.
     */
    combatWeaponRange: number = 0;
    combatStyleSlot: number = 0;
    combatStyleCategory?: number;
    combatSpellId: number = -1;
    autocastEnabled: boolean = false;
    autocastMode: "autocast" | "defensive_autocast" | null = null;
    pendingAutocastDefensive?: boolean; // Tracks if defensive autocast was selected when popup opened
    lastSpellCastTick: number = Number.MIN_SAFE_INTEGER;
    /** Pending player spell damage for scheduled combat actions */
    pendingPlayerSpellDamage?: { targetId: number };
    /** Slayer task state. */
    slayerTask?: {
        onTask?: boolean;
        active?: boolean;
        remaining?: number;
        amount?: number;
        monsterName?: string;
        monsterSpecies?: string[];
    };
    /** Current attack speed in ticks (e.g., 4 for most melee weapons) */
    attackDelay: number = 4;
    /** Last known wilderness level for change detection. */
    _lastWildernessLevel: number = 0;
    /** Last known multi-combat state for change detection. */
    _lastInMultiCombat: boolean = false;
    /** Last known PvP area state for change detection. */
    _lastInPvPArea: boolean = false;
    /** Last known raid state for change detection. */
    _lastInRaid: boolean = false;
    /** Last known LMS state for change detection. */
    _lastInLMS: boolean = false;
    /** Save key for persistence. */
    __saveKey?: string;
    private bank: BankEntry[] = [];
    private bankCapacity: number = DEFAULT_BANK_CAPACITY;
    private bankWithdrawNoteMode: boolean = false;
    private bankInsertMode: boolean = false;
    private bankQuantityMode: number = 0;
    private bankPlaceholderMode: boolean = false;
    private bankCustomQuantity: number = 0;
    private accountCreationTimeMs: number = Date.now();
    private lifetimePlayTimeSecondsBase: number = 0;
    private sessionPlayTimeStartedAtMs: number = Date.now();
    private activeShopId?: string;
    private shopBuyMode: number = 0;
    private shopSellMode: number = 0;
    private smithingQuantityMode: number = 0;
    private smithingCustomQuantity: number = 0;
    private inventory: InventoryEntry[] = createEmptyInventory();
    activePrayers: Set<PrayerName> = new Set();
    private quickPrayers: Set<PrayerName> = new Set();
    private quickPrayersEnabled = false;
    private prayerDrainAccumulator: number = 0;
    private hitpointsCurrent: number = 0;
    private _wasAlive: boolean = true;
    /** Called when player HP reaches 0 (death) */
    onDeath?: () => void;
    private nextHitpointRegenTick: number = 0;
    private nextHitpointOverhealDecayTick: number = 0;
    private poisonEffect?: PoisonEffectState;
    private venomEffect?: VenomEffectState;
    private diseaseEffect?: DiseaseEffectState;
    private regenEffect?: RegenerationEffectState;
    private combatStyleMemory: Map<number, number> = new Map();
    private prayerHeadIcon: PrayerHeadIcon | null = null;
    private combatAttackTypes?: AttackType[];
    private combatMeleeBonusIndices?: Array<number | undefined>;
    private freezeExpiryTick: number = 0;
    /** OSRS: 5 tick immunity after freeze ends */
    private freezeImmunityUntilTick: number = 0;
    private specialEnergy: number = SPECIAL_ENERGY_MAX;
    private nextSpecialRegenTick: number = 0;
    private specialActivatedFlag: boolean = false;
    private specialEnergyDirty: boolean = true;
    private runEnergyDirty: boolean = true;
    private staminaEffectExpiryTick: number = 0;
    private staminaDrainMultiplier: number = 1;
    private ringOfForgingCharges: number = 0;
    /**
     * Degradation charge tracker for items like crystal bow.
     * Tracks charges used within current degradation level per equipment slot.
     */
    degradationCharges: ChargeTracker = createChargeTracker();
    /**
     * Tracks the last degradable item ID per slot.
     * Used to detect when weapon is swapped (reset charges for that slot).
     */
    degradationLastItemId: Map<number, number> = new Map();
    private walkDestination?: { x: number; y: number };
    private walkDestinationRun: boolean = false;
    private walkRepathAfterTick: number = Number.MIN_SAFE_INTEGER;
    private preserveWalkDestinationOnNextSetPath: boolean = false;

    private readonly dirtySkills: Set<SkillId> = new Set();
    private skillSnapshotPending = true;
    private runEnergyRemainder: number = 0;
    private nextSkillRestoreTick: number = 0;
    private nextSkillBoostDecayTick: number = 0;
    private varpValues: Map<number, number> = new Map();
    private varbitValues: Map<number, number> = new Map();
    // Music region tracking for area-based music
    private lastMusicRegionId: number = -1;
    private lastPlayedMusicTrackId: number = -1;

    // Collection log state
    private collectionObtained: Map<number, number> = new Map();
    private collectionCategoryStats: Map<
        number,
        { count1: number; count2?: number; count3?: number }
    > = new Map();

    // ========================================================================
    // RSMod-style interaction attributes
    // These mirror RSMod's COMBAT_TARGET_FOCUS_ATTR, INTERACTING_NPC_ATTR, etc.
    // ========================================================================

    /**
     * The Pawn (NPC or Player) that this player wants to attack.
     * RSMod: COMBAT_TARGET_FOCUS_ATTR
     * Cleared by resetInteractions() when player walks or changes target.
     */
    private _combatTargetFocus: WeakRef<NpcState | PlayerState> | null = null;

    /**
     * The NPC being interacted with (non-combat: Talk-to, Pickpocket, etc.)
     * RSMod: INTERACTING_NPC_ATTR
     */
    private _interactingNpc: WeakRef<NpcState> | null = null;

    /**
     * The Player being interacted with (Trade, Follow, etc.)
     * RSMod: INTERACTING_PLAYER_ATTR
     */
    private _interactingPlayer: WeakRef<PlayerState> | null = null;

    /**
     * Ticks remaining until player can attack again.
     * RSMod: ATTACK_DELAY timer
     * Set after each attack based on weapon speed.
     */
    attackDelayTicks: number = 0;

    /**
     * Last pawn this player was hit by (for retaliation).
     * RSMod: LAST_HIT_BY_ATTR
     */
    private _lastHitBy: WeakRef<NpcState | PlayerState> | null = null;

    /**
     * Last pawn this player hit (for combat tracking).
     * RSMod: LAST_HIT_ATTR
     */
    private _lastHit: WeakRef<NpcState | PlayerState> | null = null;

    // Combat target accessors
    getCombatTarget(): NpcState | PlayerState | null {
        return this._combatTargetFocus?.deref() ?? null;
    }

    setCombatTarget(target: NpcState | PlayerState | null): void {
        this._combatTargetFocus = target ? new WeakRef(target) : null;
    }

    isAttacking(): boolean {
        return this._combatTargetFocus?.deref() != null;
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
        return this._interactingNpc?.deref() ?? null;
    }

    setInteractingNpc(npc: NpcState | null): void {
        this._interactingNpc = npc ? new WeakRef(npc) : null;
    }

    getInteractingPlayer(): PlayerState | null {
        return this._interactingPlayer?.deref() ?? null;
    }

    setInteractingPlayer(player: PlayerState | null): void {
        this._interactingPlayer = player ? new WeakRef(player) : null;
    }

    // Last hit tracking
    getLastHitBy(): NpcState | PlayerState | null {
        return this._lastHitBy?.deref() ?? null;
    }

    setLastHitBy(pawn: NpcState | PlayerState | null): void {
        this._lastHitBy = pawn ? new WeakRef(pawn) : null;
    }

    getLastHit(): NpcState | PlayerState | null {
        return this._lastHit?.deref() ?? null;
    }

    setLastHit(pawn: NpcState | PlayerState | null): void {
        this._lastHit = pawn ? new WeakRef(pawn) : null;
    }

    /**
     * Resets all pawn interactions. Called when player walks or teleports.
     * RSMod: Pawn.resetInteractions()
     */
    resetInteractions(): void {
        this._combatTargetFocus = null;
        this._interactingNpc = null;
        this._interactingPlayer = null;
        this.clearInteractionTarget(); // Clears face target from Actor base class
    }

    /**
     * Clears only combat target, keeping other interactions.
     * RSMod: Combat.reset(pawn)
     */
    resetCombat(): void {
        this._combatTargetFocus = null;
    }

    /**
     * Removes the combat target (synonym for resetCombat).
     * RSMod: Pawn.removeCombatTarget()
     */
    removeCombatTarget(): void {
        this._combatTargetFocus = null;
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
    private collectionLogDirty: boolean = false;
    private collectionItemUnlocks: Map<number, CollectionLogUnlockEntry> = new Map();
    private collectionUnlockSequence: number = 0;

    private inventoryDirty: boolean = false;
    private bankDirty: boolean = false;
    /**
     * Last bank client-slot -> server-slot mapping sent in a bank snapshot.
     * Used to decode client drag/click slots deterministically.
     */
    private bankClientSlotMapping: number[] = [];
    private equipmentDirty: boolean = false;
    private appearanceDirty: boolean = false;
    private combatStateDirty: boolean = false;
    public appearance: PlayerAppearance;
    /** Server-only onboarding progression (project-specific). */
    public accountStage: number = 1;
    /**
     * OSRS Aggression Tolerance State
     * Tracks when the player entered an area and their position history.
     * After ~10 minutes in an area, NPCs become tolerant (stop aggro).
     * Moving 10+ tiles from both tracked positions resets the timer.
     */
    private aggressionState: PlayerAggressionState | null = null;
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
        this.skills = createInitialSkills();
        this.skillTotal = computeTotalLevel(this.skills);
        this.combatLevel = computeCombatLevel(this.skills);
        this.hitpointsCurrent = this.getSkill(SkillId.Hitpoints).baseLevel;
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
        // OSRS parity: XP drops are enabled by default until the player explicitly hides them.
        if (!this.varbitValues.has(VARBIT_XPDROPS_ENABLED)) {
            this.setVarbitValue(VARBIT_XPDROPS_ENABLED, DEFAULT_XPDROPS_ENABLED);
        }
        // Task count is server-authoritative; default is 0 for new accounts.
        // Initialize task queue (RSMod: Pawn.queue)
        this.taskQueue = new QueueTaskSet<PlayerState>(this);
    }

    getSessionPlayTimeSeconds(nowMs: number = Date.now()): number {
        if (!Number.isFinite(nowMs)) return 0;
        return Math.max(
            0,
            Math.floor((Math.floor(nowMs) - this.sessionPlayTimeStartedAtMs) / 1000),
        );
    }

    getLifetimePlayTimeSeconds(nowMs: number = Date.now()): number {
        const baseSeconds = Math.max(
            0,
            Number.isFinite(this.lifetimePlayTimeSecondsBase)
                ? Math.floor(this.lifetimePlayTimeSecondsBase)
                : 0,
        );
        if (!Number.isFinite(nowMs)) {
            return baseSeconds;
        }
        return Math.max(0, baseSeconds + this.getSessionPlayTimeSeconds(nowMs));
    }

    getAccountAgeMinutes(nowMs: number = Date.now()): number {
        if (!Number.isFinite(nowMs)) return 0;
        return Math.max(0, Math.floor((Math.floor(nowMs) - this.accountCreationTimeMs) / 60000));
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
        this.inventoryDirty = true;
    }

    setBankSlot(slot: number, itemId: number, quantity: number): void {
        const bank = this.ensureBankInitialized();
        if (slot < 0 || slot >= bank.length) return;

        const nextId = quantity > 0 ? itemId : -1;
        const nextQty = nextId > 0 ? quantity : 0;

        if (bank[slot].itemId === nextId && bank[slot].quantity === nextQty) return;

        bank[slot] = { itemId: nextId, quantity: nextQty };
        this.bankDirty = true;
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
        this.inventoryDirty = true;
    }

    markEquipmentDirty(): void {
        this.equipmentDirty = true;
        this.appearanceDirty = true;
    }

    markCombatStateDirty(): void {
        this.combatStateDirty = true;
    }

    hasInventoryUpdate(): boolean {
        return this.inventoryDirty;
    }

    takeInventorySnapshot(): InventorySnapshotEntry[] | undefined {
        if (!this.inventoryDirty) return undefined;
        this.inventoryDirty = false;
        return this.exportInventorySnapshot();
    }

    hasBankUpdate(): boolean {
        return this.bankDirty;
    }

    takeBankSnapshot(): BankSnapshotEntry[] | undefined {
        if (!this.bankDirty) return undefined;
        this.bankDirty = false;
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

    /**
     * Get the player's current aggression state, creating it if needed.
     * The state tracks how long the player has been in an area for tolerance.
     */
    getAggressionState(currentTick: number): PlayerAggressionState {
        if (!this.aggressionState) {
            this.aggressionState = createAggressionState(currentTick, this.tileX, this.tileY);
        }
        return this.aggressionState;
    }

    /**
     * Update the player's aggression state each tick.
     * This handles position tracking and tolerance timer updates.
     *
     * @param currentTick Current game tick
     * @param neverTolerant If true, NPCs never become tolerant (wilderness)
     * @param customTimer Optional custom tolerance timer (for special NPCs)
     */
    updateAggressionState(
        currentTick: number,
        neverTolerant: boolean = false,
        customTimer?: number,
    ): void {
        const state = this.getAggressionState(currentTick);
        const timer = customTimer ?? AGGRESSION_TIMER_TICKS;
        this.aggressionState = updateAggressionStateWithPosition(
            state,
            currentTick,
            this.tileX,
            this.tileY,
            timer,
            neverTolerant,
        );
    }

    /**
     * Reset the player's aggression state (e.g., after teleporting).
     * This makes NPCs aggressive toward the player again.
     */
    resetAggressionState(currentTick: number): void {
        this.aggressionState = createAggressionState(currentTick, this.tileX, this.tileY);
    }

    /**
     * Check if the player's aggression timer has expired (NPCs are tolerant).
     */
    isAggressionExpired(): boolean {
        return this.aggressionState?.aggressionExpired ?? false;
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

        // Reset aggression state at new location
        // Using 0 as entryTick - will be properly updated on next tick
        this.aggressionState = null;
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
            desiredSlot = this.combatStyleMemory.get(normalizedCategory);
            if (desiredSlot === undefined && styleIsDefined) {
                desiredSlot = style;
            }
        } else if (styleIsDefined) {
            desiredSlot = style;
        } else {
            desiredSlot = this.combatStyleSlot;
        }

        let normalizedSlot = Math.max(0, Math.min(maxSlot, desiredSlot ?? 0));
        if (this.combatAttackTypes && this.combatAttackTypes.length > 0) {
            normalizedSlot = Math.min(this.combatAttackTypes.length - 1, normalizedSlot);
            // OSRS parity: Validate the slot is actually defined (sparse arrays have gaps).
            // Weapons like bows have slots 0,1,3 but not 2 - if slot 2 was selected, find nearest valid.
            if (this.combatAttackTypes[normalizedSlot] === undefined) {
                // Find the nearest valid slot (prefer lower slots first, then check higher)
                let foundSlot: number | undefined;
                for (let s = normalizedSlot - 1; s >= 0; s--) {
                    if (this.combatAttackTypes[s] !== undefined) {
                        foundSlot = s;
                        break;
                    }
                }
                if (foundSlot === undefined) {
                    for (let s = normalizedSlot + 1; s < this.combatAttackTypes.length; s++) {
                        if (this.combatAttackTypes[s] !== undefined) {
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
            this.combatStyleMemory.set(normalizedCategory, normalizedSlot);
        }
    }

    setCombatCategoryAttackTypes(types: AttackType[] | undefined): void {
        this.combatAttackTypes = types ? types.slice() : undefined;
        if (this.combatAttackTypes && this.combatAttackTypes.length > 0) {
            const maxSlot = this.combatAttackTypes.length - 1;
            if (this.combatStyleSlot > maxSlot) {
                this.combatStyleSlot = maxSlot;
            }
            // OSRS parity: Ensure slot is valid (sparse arrays have gaps, e.g., bows skip slot 2)
            if (this.combatAttackTypes[this.combatStyleSlot] === undefined) {
                // Find nearest valid slot
                let foundSlot: number | undefined;
                for (let s = this.combatStyleSlot - 1; s >= 0; s--) {
                    if (this.combatAttackTypes[s] !== undefined) {
                        foundSlot = s;
                        break;
                    }
                }
                if (foundSlot === undefined) {
                    for (let s = this.combatStyleSlot + 1; s < this.combatAttackTypes.length; s++) {
                        if (this.combatAttackTypes[s] !== undefined) {
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
        this.combatMeleeBonusIndices = indices ? indices.slice() : undefined;
        if (this.combatMeleeBonusIndices && this.combatMeleeBonusIndices.length > 0) {
            const maxSlot = this.combatMeleeBonusIndices.length - 1;
            if (this.combatStyleSlot > maxSlot) {
                this.combatStyleSlot = maxSlot;
            }
        }
    }

    getCurrentAttackType(): AttackType | undefined {
        if (!this.combatAttackTypes || this.combatAttackTypes.length === 0) return undefined;
        const slot = Math.max(0, Math.min(this.combatAttackTypes.length - 1, this.combatStyleSlot));
        return this.combatAttackTypes[slot];
    }

    getCurrentMeleeBonusIndex(): number | undefined {
        if (!this.combatMeleeBonusIndices || this.combatMeleeBonusIndices.length === 0)
            return undefined;
        const slot = Math.max(
            0,
            Math.min(this.combatMeleeBonusIndices.length - 1, this.combatStyleSlot),
        );
        return this.combatMeleeBonusIndices[slot];
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
            this.quickPrayersEnabled &&
            !this.arePrayerSetsEqual(this.quickPrayers, this.activePrayers)
        ) {
            this.quickPrayersEnabled = false;
        }
        return true;
    }

    getRunEnergyUnits(): number {
        const current = this.runEnergy;
        if (!Number.isFinite(current)) {
            this.runEnergy = RUN_ENERGY_MAX;
            return RUN_ENERGY_MAX;
        }
        return Math.max(0, Math.min(RUN_ENERGY_MAX, Math.floor(current)));
    }

    hasInfiniteRunEnergy(): boolean {
        return PlayerState.gamemodeRef?.hasInfiniteRunEnergy(this) ?? false;
    }

    wantsToRun(): boolean {
        return !!this.runToggle;
    }

    public override hasAvailableRunEnergy(): boolean {
        return this.hasInfiniteRunEnergy() || this.getRunEnergyUnits() > 0;
    }

    resolveRequestedRun(run: boolean): boolean {
        return !!run && this.hasAvailableRunEnergy();
    }

    isRunActive(): boolean {
        return this.resolveRequestedRun(this.wantsToRun());
    }

    syncInfiniteRunEnergy(): boolean {
        if (!this.hasInfiniteRunEnergy()) {
            return false;
        }
        if (this.getRunEnergyUnits() < RUN_ENERGY_MAX) {
            this.setRunEnergyUnits(RUN_ENERGY_MAX);
        }
        return true;
    }

    setRunEnergyUnits(units: number): void {
        const normalized = Math.max(0, Math.min(RUN_ENERGY_MAX, Math.floor(units)));
        const before = this.getRunEnergyUnits();
        this.runEnergy = normalized;
        this.runEnergyRemainder = 0;
        if (before !== normalized) {
            this.runEnergyDirty = true;
        }
    }

    adjustRunEnergyUnits(deltaUnits: number): number {
        const current = this.getRunEnergyUnits();
        let total = current + this.runEnergyRemainder + deltaUnits;
        let next = Math.floor(total);
        if (next < 0) {
            next = 0;
            total = 0;
        } else if (next > RUN_ENERGY_MAX) {
            next = RUN_ENERGY_MAX;
            total = RUN_ENERGY_MAX;
        }
        this.runEnergyRemainder = total - next;
        if (
            (next === 0 && this.runEnergyRemainder < 0) ||
            (next === RUN_ENERGY_MAX && this.runEnergyRemainder > 0)
        ) {
            this.runEnergyRemainder = 0;
        }
        if (current !== next) {
            this.runEnergyDirty = true;
        }
        this.runEnergy = next;
        return next;
    }

    getRunEnergyPercent(): number {
        return Math.floor((this.getRunEnergyUnits() / RUN_ENERGY_MAX) * 100);
    }

    setRunEnergyPercent(percent: number): void {
        const value = Number.isFinite(percent) ? percent : 0;
        const normalized = Math.max(0, Math.min(100, Math.floor(value)));
        const units = Math.round((normalized / 100) * RUN_ENERGY_MAX);
        this.setRunEnergyUnits(units);
    }

    adjustRunEnergyPercent(deltaPercent: number): number {
        const deltaUnits = (deltaPercent / 100) * RUN_ENERGY_MAX;
        const units = this.adjustRunEnergyUnits(deltaUnits);
        return Math.floor((units / RUN_ENERGY_MAX) * 100);
    }

    applyStaminaEffect(currentTick: number, durationTicks: number, drainMultiplier?: number): void {
        const now = Math.max(0, currentTick);
        const duration = Math.max(1, durationTicks);
        const baseline = this.staminaEffectExpiryTick > now ? this.staminaEffectExpiryTick : now;
        // OSRS parity: Cap stamina duration at MAX_STAMINA_DURATION_TICKS (8000 ticks = 40 doses)
        // Reference: docs/run-energy.md
        this.staminaEffectExpiryTick = Math.min(
            baseline + duration,
            now + MAX_STAMINA_DURATION_TICKS,
        );
        const multiplier =
            drainMultiplier !== undefined ? drainMultiplier : DEFAULT_STAMINA_DRAIN_MULTIPLIER;
        this.staminaDrainMultiplier = Math.max(0, Math.min(1, multiplier));
    }

    tickStaminaEffect(currentTick: number): void {
        if (this.staminaEffectExpiryTick !== 0 && this.staminaEffectExpiryTick <= currentTick) {
            this.staminaEffectExpiryTick = 0;
            this.staminaDrainMultiplier = 1;
        }
    }

    getStaminaEffectRemainingTicks(currentTick: number): number {
        if (this.staminaEffectExpiryTick === 0) return 0;
        const remaining = this.staminaEffectExpiryTick - currentTick;
        return remaining > 0 ? remaining : 0;
    }

    getRunEnergyDrainMultiplier(currentTick: number): number {
        this.tickStaminaEffect(currentTick);
        return Math.max(0, Math.min(1, this.staminaDrainMultiplier));
    }

    hasRunEnergyUpdate(): boolean {
        return this.runEnergyDirty;
    }

    markRunEnergySynced(): void {
        this.runEnergyDirty = false;
    }

    public override setRunToggle(on: boolean): void {
        const prev = this.runToggle;
        super.setRunToggle(on);
        if (prev !== this.runToggle) {
            this.runEnergyDirty = true;
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
        if (currentTick < this.freezeImmunityUntilTick) {
            return false; // Immune to freeze
        }

        const expires = Math.max(this.freezeExpiryTick, currentTick + Math.max(1, durationTicks));
        this.freezeExpiryTick = expires;
        this.lockMovementUntil(expires);
        this.clearPath();
        this.running = false;
        // OSRS: Ice blue tint for freeze duration
        this.setColorOverride(42, 5, 80, 30, Math.max(1, durationTicks));
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

    getFreezeRemaining(currentTick: number): number {
        const remaining = this.freezeExpiryTick - currentTick;
        return Math.max(0, remaining);
    }

    getSpecialEnergyUnits(): number {
        return Math.max(0, Math.min(SPECIAL_ENERGY_MAX, Math.floor(this.specialEnergy)));
    }

    getSpecialEnergyPercent(): number {
        return Math.floor((this.getSpecialEnergyUnits() / SPECIAL_ENERGY_MAX) * 100);
    }

    setSpecialEnergyPercent(percent: number): void {
        const normalized = Math.max(0, Math.min(SPECIAL_ENERGY_MAX, Math.floor(percent)));
        if (normalized === this.getSpecialEnergyUnits()) return;
        this.specialEnergy = normalized;
        this.specialEnergyDirty = true;
        if (normalized === 0) {
            this.specialActivatedFlag = false;
        }
    }

    setSpecialActivated(on: boolean): boolean {
        const normalized = !!on;
        if (normalized && this.getSpecialEnergyUnits() <= 0) {
            return false;
        }
        this.specialActivatedFlag = normalized;
        return true;
    }

    isSpecialActivated(): boolean {
        return this.specialActivatedFlag;
    }

    consumeSpecialEnergy(costPercent: number): boolean {
        const cost = Math.max(0, Math.min(SPECIAL_ENERGY_MAX, Math.floor(costPercent)));
        if (cost <= 0) return true;
        if (this.getSpecialEnergyUnits() < cost) {
            this.specialActivatedFlag = false;
            return false;
        }
        this.specialEnergy = Math.max(0, this.getSpecialEnergyUnits() - cost);
        this.specialActivatedFlag = false;
        this.specialEnergyDirty = true;
        return true;
    }

    tickSpecialEnergy(currentTick: number): boolean {
        if (this.getSpecialEnergyUnits() >= SPECIAL_ENERGY_MAX) {
            this.nextSpecialRegenTick = currentTick + SPECIAL_ENERGY_REGEN_INTERVAL_TICKS;
            return false;
        }
        if (this.nextSpecialRegenTick <= 0) {
            this.nextSpecialRegenTick = currentTick + SPECIAL_ENERGY_REGEN_INTERVAL_TICKS;
            return false;
        }
        if (currentTick >= this.nextSpecialRegenTick) {
            this.specialEnergy = Math.min(
                SPECIAL_ENERGY_MAX,
                this.getSpecialEnergyUnits() + SPECIAL_ENERGY_REGEN_CHUNK,
            );
            this.nextSpecialRegenTick = currentTick + SPECIAL_ENERGY_REGEN_INTERVAL_TICKS;
            this.specialEnergyDirty = true;
            return true;
        }
        return false;
    }

    hasSpecialEnergyUpdate(): boolean {
        return this.specialEnergyDirty;
    }

    markSpecialEnergySynced(): void {
        this.specialEnergyDirty = false;
    }

    getVarbitValue(id: number): number {
        return this.varbitValues.get(id) ?? 0;
    }

    setVarbitValue(id: number, value: number): void {
        if (!Number.isFinite(id)) return;
        const normalized = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
        this.varbitValues.set(id, normalized);
    }

    getVarpValue(id: number): number {
        return this.varpValues.get(id) ?? 0;
    }

    hasVarpValue(id: number): boolean {
        return this.varpValues.has(id);
    }

    setVarpValue(id: number, value: number): void {
        if (!Number.isFinite(id)) return;
        const normalized = Math.floor(Number.isFinite(value) ? value : 0);
        this.varpValues.set(id, normalized);
    }

    // Music region tracking
    getLastMusicRegionId(): number {
        return this.lastMusicRegionId;
    }

    setLastMusicRegionId(regionId: number): void {
        this.lastMusicRegionId = regionId;
    }

    getLastPlayedMusicTrackId(): number {
        return this.lastPlayedMusicTrackId;
    }

    setLastPlayedMusicTrackId(trackId: number): void {
        this.lastPlayedMusicTrackId = trackId;
    }

    getBankCapacity(): number {
        return Math.max(1, this.bankCapacity);
    }

    setBankCapacity(capacity: number): void {
        // OSRS parity: CS2 bank scripts use a 1410-slot addressing space (0..1409).
        // Allow up to 1410 without runaway allocations.
        const normalized = Math.max(1, Math.min(1410, Math.floor(capacity)));
        if (normalized === this.bankCapacity && this.bank.length === normalized) {
            return;
        }
        const next = createEmptyBank(normalized);
        const current = Array.isArray(this.bank) ? this.bank : [];
        for (let i = 0; i < Math.min(current.length, normalized); i++) {
            const entry = current[i];
            next[i] = {
                itemId: entry?.itemId ?? -1,
                quantity: entry?.quantity ?? 0,
            };
        }
        this.bankCapacity = normalized;
        this.bank = next;
        this.bankClientSlotMapping = [];
    }

    private ensureBankInitialized(): BankEntry[] {
        const capacity = this.getBankCapacity();
        if (!Array.isArray(this.bank) || this.bank.length !== capacity) {
            this.bank = createEmptyBank(capacity);
        }
        return this.bank;
    }

    getBankEntries(): BankEntry[] {
        return this.ensureBankInitialized();
    }

    setBankClientSlotMapping(mapping: number[]): void {
        if (!Array.isArray(mapping)) {
            this.bankClientSlotMapping = [];
            return;
        }
        this.bankClientSlotMapping = mapping.map((slot) =>
            Number.isFinite(slot) ? (slot as number) : -1,
        );
    }

    getBankServerSlotForClientSlot(clientSlot: number): number {
        if (!Number.isFinite(clientSlot)) return -1;
        const slot = clientSlot;
        if (slot < 0 || slot >= this.bankClientSlotMapping.length) return -1;
        const mapped = this.bankClientSlotMapping[slot] ?? -1;
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
        this.bankClientSlotMapping = [];
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
        this.bank = createEmptyBank(this.getBankCapacity());
        this.bankClientSlotMapping = [];
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
        return !!this.bankWithdrawNoteMode;
    }

    setBankWithdrawNotes(enabled: boolean): void {
        this.bankWithdrawNoteMode = !!enabled;
    }

    getBankInsertMode(): boolean {
        return !!this.bankInsertMode;
    }

    setBankInsertMode(insert: boolean): void {
        this.bankInsertMode = !!insert;
    }

    getBankPlaceholderMode(): boolean {
        return !!this.bankPlaceholderMode;
    }

    setBankPlaceholderMode(enabled: boolean): void {
        this.bankPlaceholderMode = !!enabled;
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
        if (cleared > 0) this.bankDirty = true;
        return cleared;
    }

    getBankQuantityMode(): number {
        return this.bankQuantityMode;
    }

    setBankQuantityMode(mode: number): void {
        if (!Number.isFinite(mode)) return;
        this.bankQuantityMode = Math.max(0, Math.min(5, mode));
    }

    getBankCustomQuantity(): number {
        return Math.max(0, this.bankCustomQuantity);
    }

    setBankCustomQuantity(amount: number): void {
        if (!Number.isFinite(amount)) {
            this.bankCustomQuantity = 0;
            return;
        }
        this.bankCustomQuantity = Math.max(0, Math.min(2147483647, amount));
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
     * OSRS PARITY: In OSRS, bank items are stored contiguously by tab.
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
        return this.activeShopId;
    }

    setActiveShopId(id: string | undefined): void {
        this.activeShopId = id ? String(id) : undefined;
    }

    getShopBuyMode(): number {
        return this.shopBuyMode;
    }

    setShopBuyMode(mode: number): void {
        if (!Number.isFinite(mode)) return;
        this.shopBuyMode = Math.max(0, Math.min(4, mode));
    }

    getShopSellMode(): number {
        return this.shopSellMode;
    }

    setShopSellMode(mode: number): void {
        if (!Number.isFinite(mode)) return;
        this.shopSellMode = Math.max(0, Math.min(4, mode));
    }

    getSmithingQuantityMode(): number {
        return this.smithingQuantityMode;
    }

    setSmithingQuantityMode(mode: number): void {
        if (!Number.isFinite(mode)) return;
        this.smithingQuantityMode = Math.max(0, Math.min(4, mode));
    }

    getSmithingCustomQuantity(): number {
        return Math.max(0, this.smithingCustomQuantity);
    }

    setSmithingCustomQuantity(amount: number): void {
        if (!Number.isFinite(amount)) {
            this.smithingCustomQuantity = 0;
            return;
        }
        this.smithingCustomQuantity = Math.max(0, Math.min(2147483647, amount));
    }

    getRingOfForgingCharges(): number {
        return Math.max(0, this.ringOfForgingCharges);
    }

    setRingOfForgingCharges(amount: number): void {
        if (!Number.isFinite(amount)) {
            this.ringOfForgingCharges = 0;
            return;
        }
        this.ringOfForgingCharges = Math.max(0, Math.min(RING_OF_FORGING_MAX_CHARGES, amount));
    }

    hasRingOfForgingEquipped(): boolean {
        const equip = this.ensureAppearanceEquip();
        return equip[EquipmentSlot.RING] === RING_OF_FORGING_ITEM_ID;
    }

    ensureRingOfForgingChargesInitialized(): void {
        if (this.ringOfForgingCharges <= 0) {
            this.ringOfForgingCharges = RING_OF_FORGING_MAX_CHARGES;
        }
    }

    // ========================================================================
    // Collection Log Methods
    // ========================================================================

    /** Check if the player has obtained a specific item in their collection log */
    hasCollectionItem(itemId: number): boolean {
        return (this.collectionObtained.get(itemId) ?? 0) > 0;
    }

    /** Get the quantity/count of a specific item obtained in collection log */
    getCollectionItemCount(itemId: number): number {
        return this.collectionObtained.get(itemId) ?? 0;
    }

    /**
     * Add an item to the player's collection log.
     * @param itemId The item ID to add
     * @param quantity The quantity to add (default 1)
     * @returns true if this was a newly obtained item (first time)
     */
    addCollectionItem(itemId: number, quantity: number = 1): boolean {
        const current = this.collectionObtained.get(itemId) ?? 0;
        const isNew = current === 0;
        this.collectionObtained.set(itemId, current + quantity);
        this.collectionLogDirty = true;
        return isNew;
    }

    /** Get all obtained items as array for serialization/transmission */
    getCollectionObtainedItems(): Array<{ itemId: number; quantity: number }> {
        const result: Array<{ itemId: number; quantity: number }> = [];
        for (const [itemId, quantity] of this.collectionObtained.entries()) {
            if (quantity > 0) {
                result.push({ itemId, quantity });
            }
        }
        return result;
    }

    /** Get total unique items obtained */
    getCollectionTotalObtained(): number {
        let count = 0;
        for (const quantity of this.collectionObtained.values()) {
            if (quantity > 0) count++;
        }
        return count;
    }

    /** Get category stats (kill counts, completion counts, etc.) */
    getCollectionCategoryStat(
        structId: number,
    ): { count1: number; count2?: number; count3?: number } | undefined {
        return this.collectionCategoryStats.get(structId);
    }

    /** Increment a category stat counter (e.g., boss kills, clue completions) */
    incrementCollectionCategoryStat(structId: number, which: 1 | 2 | 3 = 1): void {
        const stat = this.collectionCategoryStats.get(structId) ?? { count1: 0 };
        if (which === 1) stat.count1++;
        else if (which === 2) stat.count2 = (stat.count2 ?? 0) + 1;
        else if (which === 3) stat.count3 = (stat.count3 ?? 0) + 1;
        this.collectionCategoryStats.set(structId, stat);
        this.collectionLogDirty = true;
    }

    getCollectionItemUnlocks(): CollectionLogUnlockEntry[] {
        return Array.from(this.collectionItemUnlocks.values())
            .sort((left, right) => left.sequence - right.sequence)
            .map((entry) => ({ ...entry }));
    }

    recordCollectionItemUnlock(itemId: number, runeDay: number): void {
        const normalizedItemId = Math.floor(Number.isFinite(itemId) ? itemId : -1);
        const normalizedRuneDay = Math.max(0, Math.floor(Number.isFinite(runeDay) ? runeDay : 0));
        if (normalizedItemId <= 0) return;
        if (this.collectionItemUnlocks.has(normalizedItemId)) {
            return;
        }

        this.collectionUnlockSequence++;
        this.collectionItemUnlocks.set(normalizedItemId, {
            itemId: normalizedItemId,
            runeDay: normalizedRuneDay,
            sequence: this.collectionUnlockSequence,
        });
        this.collectionLogDirty = true;
    }

    /** Set a category stat counter directly */
    setCollectionCategoryStat(
        structId: number,
        count1: number,
        count2?: number,
        count3?: number,
    ): void {
        this.collectionCategoryStats.set(structId, { count1, count2, count3 });
        this.collectionLogDirty = true;
    }

    /** Check if collection log has pending changes */
    isCollectionLogDirty(): boolean {
        return this.collectionLogDirty;
    }

    /** Clear collection log dirty flag */
    clearCollectionLogDirty(): void {
        this.collectionLogDirty = false;
    }

    /** Export collection log state for persistence */
    exportCollectionLogSnapshot(): PlayerPersistentVars["collectionLog"] {
        const items = this.getCollectionObtainedItems();
        const itemUnlocks = this.getCollectionItemUnlocks();
        const categoryStats: Array<{
            structId: number;
            count1: number;
            count2?: number;
            count3?: number;
        }> = [];
        for (const [structId, stat] of this.collectionCategoryStats.entries()) {
            categoryStats.push({ structId, ...stat });
        }
        if (items.length === 0 && itemUnlocks.length === 0 && categoryStats.length === 0) {
            return undefined;
        }
        return {
            items: items.length > 0 ? items : undefined,
            itemUnlocks: itemUnlocks.length > 0 ? itemUnlocks : undefined,
            categoryStats: categoryStats.length > 0 ? categoryStats : undefined,
        };
    }

    /** Load collection log state from persistence */
    loadCollectionLogSnapshot(data?: PlayerPersistentVars["collectionLog"]): void {
        this.collectionObtained.clear();
        this.collectionCategoryStats.clear();
        this.collectionItemUnlocks.clear();
        this.collectionUnlockSequence = 0;
        if (!data) return;

        if (Array.isArray(data.items)) {
            for (const item of data.items) {
                if (item.itemId > 0 && item.quantity > 0) {
                    this.collectionObtained.set(item.itemId, item.quantity);
                }
            }
        }

        if (Array.isArray(data.itemUnlocks)) {
            for (const entry of data.itemUnlocks) {
                if (entry.itemId <= 0 || entry.runeDay < 0 || entry.sequence <= 0) {
                    continue;
                }
                if (!this.hasCollectionItem(entry.itemId)) {
                    continue;
                }
                const normalized = {
                    itemId: entry.itemId,
                    runeDay: Math.max(0, entry.runeDay),
                    sequence: Math.max(1, Math.floor(entry.sequence)),
                };
                const existing = this.collectionItemUnlocks.get(normalized.itemId);
                if (!existing || normalized.sequence > existing.sequence) {
                    this.collectionItemUnlocks.set(normalized.itemId, normalized);
                    this.collectionUnlockSequence = Math.max(
                        this.collectionUnlockSequence,
                        normalized.sequence,
                    );
                }
            }
        }

        if (Array.isArray(data.categoryStats)) {
            for (const stat of data.categoryStats) {
                this.collectionCategoryStats.set(stat.structId, {
                    count1: Math.max(0, stat.count1),
                    count2: stat.count2 !== undefined ? Math.max(0, stat.count2) : undefined,
                    count3: stat.count3 !== undefined ? Math.max(0, stat.count3) : undefined,
                });
            }
        }
        this.collectionLogDirty = false;
    }

    getInventoryEntries(): InventoryEntry[] {
        if (!Array.isArray(this.inventory) || this.inventory.length !== INVENTORY_SLOT_COUNT) {
            this.inventory = createEmptyInventory();
        }
        return this.inventory;
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
        return SKILL_IDS.map((id) => {
            const skill = this.skills[id];
            return {
                id,
                xp: skill.xp,
                boost: skill.boost,
            };
        });
    }

    private applySkillSnapshot(entries: Iterable<PlayerSkillPersistentEntry>): void {
        for (const entry of entries) {
            if (!entry) continue;
            const skillId = entry.id;
            if (!SKILL_IDS.includes(skillId as SkillId)) continue;
            if (!Number.isFinite(entry.xp)) continue;
            this.setSkillXp(skillId as SkillId, entry.xp);
            const boost = entry.boost ?? 0;
            const base = this.getSkill(skillId as SkillId).baseLevel;
            this.setSkillBoost(skillId as SkillId, base + boost);
        }
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
        const varps: Record<number, number> = {};
        const varbits: Record<number, number> = {};
        for (const [id, value] of this.varpValues.entries()) {
            if (NON_PERSISTENT_VARPS.has(id)) {
                continue;
            }
            if (value !== 0 || ZERO_PERSISTENT_VARPS.has(id)) {
                varps[id] = value;
            }
        }
        for (const [id, value] of this.varbitValues.entries()) {
            if (NON_PERSISTENT_VARBITS.has(id)) {
                continue;
            }
            if (value !== 0 || ZERO_PERSISTENT_VARBITS.has(id)) {
                varbits[id] = value;
            }
        }
        if (Object.keys(varps).length > 0) snapshot.varps = varps;
        if (Object.keys(varbits).length > 0) snapshot.varbits = varbits;
        const gamemodeData = PlayerState.gamemodeRef?.serializePlayerState(this);
        if (gamemodeData && Object.keys(gamemodeData).length > 0) {
            snapshot.gamemodeData = gamemodeData;
        }
        // Persist character design (gender/body kits/colors). Equipment is stored separately.
        snapshot.accountStage = Number.isFinite(this.accountStage) ? this.accountStage : 1;
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
        if (this.quickPrayers.size > 0) {
            snapshot.quickPrayers = Array.from(this.quickPrayers);
        }
        if (this.ringOfForgingCharges > 0) {
            snapshot.ringOfForgingCharges = this.getRingOfForgingCharges();
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
        const collectionLog = this.exportCollectionLogSnapshot();
        if (collectionLog) {
            snapshot.collectionLog = collectionLog;
        }
        if (this.followerState) {
            snapshot.follower = {
                itemId: this.followerState.itemId,
                npcTypeId: this.followerState.npcTypeId,
            };
        }
        snapshot.accountCreationTimeMs = Math.max(
            0,
            Number.isFinite(this.accountCreationTimeMs)
                ? Math.floor(this.accountCreationTimeMs)
                : 0,
        );
        snapshot.playTimeSeconds = this.getLifetimePlayTimeSeconds();
        return snapshot;
    }

    applyPersistentVars(state?: PlayerPersistentVars): void {
        this.varpValues.clear();
        this.varbitValues.clear();
        this.gamemodeState.clear();
        if (!state) {
            this.setVarbitValue(VARBIT_XPDROPS_ENABLED, DEFAULT_XPDROPS_ENABLED);
            this.ensureBankInitialized();
            return;
        }
        if (state.accountStage !== undefined) {
            this.accountStage = Math.max(0, Math.min(10, state.accountStage));
        }
        this.accountCreationTimeMs =
            state.accountCreationTimeMs !== undefined && state.accountCreationTimeMs >= 0
                ? Math.floor(state.accountCreationTimeMs)
                : Date.now();
        this.lifetimePlayTimeSecondsBase =
            state.playTimeSeconds !== undefined && state.playTimeSeconds >= 0
                ? Math.floor(state.playTimeSeconds)
                : 0;
        this.sessionPlayTimeStartedAtMs = Date.now();
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
        if (state.varps) {
            for (const [key, value] of Object.entries(state.varps)) {
                const id = parseInt(key, 10);
                if (!Number.isNaN(id) && !NON_PERSISTENT_VARPS.has(id)) {
                    this.setVarpValue(id, value);
                }
            }
        }
        if (state.varbits) {
            for (const [key, value] of Object.entries(state.varbits)) {
                const id = parseInt(key, 10);
                if (!Number.isNaN(id) && !NON_PERSISTENT_VARBITS.has(id)) {
                    this.setVarbitValue(id, value);
                }
            }
        }
        if (state.gamemodeData && Object.keys(state.gamemodeData).length > 0) {
            PlayerState.gamemodeRef?.deserializePlayerState(
                this,
                state.gamemodeData as Record<string, unknown>,
            );
        }
        if (
            !state.varbits ||
            !Object.prototype.hasOwnProperty.call(state.varbits, String(VARBIT_XPDROPS_ENABLED))
        ) {
            this.setVarbitValue(VARBIT_XPDROPS_ENABLED, DEFAULT_XPDROPS_ENABLED);
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
        if (state.ringOfForgingCharges !== undefined) {
            this.setRingOfForgingCharges(state.ringOfForgingCharges);
        } else {
            this.setRingOfForgingCharges(0);
        }
        if (this.hasRingOfForgingEquipped() && this.getRingOfForgingCharges() <= 0) {
            this.ensureRingOfForgingChargesInitialized();
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
        this.loadCollectionLogSnapshot(state.collectionLog);
        this.setFollowerState(state.follower);
        this.setActiveFollowerNpcId(undefined);
    }

    getFollowerState(): PlayerFollowerPersistentEntry | undefined {
        return this.followerState;
    }

    setFollowerState(state?: PlayerFollowerPersistentEntry): void {
        if (
            !state ||
            !Number.isFinite(state.itemId) ||
            !Number.isFinite(state.npcTypeId) ||
            state.itemId <= 0 ||
            state.npcTypeId <= 0
        ) {
            this.followerState = undefined;
            return;
        }
        this.followerState = {
            itemId: state.itemId | 0,
            npcTypeId: state.npcTypeId | 0,
        };
    }

    clearFollowerState(): void {
        this.followerState = undefined;
    }

    getActiveFollowerNpcId(): number | undefined {
        return this.activeFollowerNpcId;
    }

    setActiveFollowerNpcId(npcId: number | undefined): void {
        if (npcId === undefined || !Number.isFinite(npcId) || npcId <= 0) {
            this.activeFollowerNpcId = undefined;
            return;
        }
        this.activeFollowerNpcId = npcId | 0;
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
        return this.quickPrayers;
    }

    setQuickPrayers(prayers: Iterable<PrayerName | string>): boolean {
        const next = new Set<PrayerName>();
        for (const entry of prayers) {
            const name = entry as PrayerName;
            if (!PRAYER_NAME_SET.has(name)) continue;
            next.add(name);
        }
        const changed = !this.arePrayerSetsEqual(next, this.quickPrayers);
        if (!changed) return false;
        this.quickPrayers = next;
        if (!this.arePrayerSetsEqual(this.quickPrayers, this.activePrayers)) {
            this.quickPrayersEnabled = false;
        }
        return true;
    }

    areQuickPrayersEnabled(): boolean {
        return this.quickPrayersEnabled;
    }

    setQuickPrayersEnabled(enabled: boolean): void {
        this.quickPrayersEnabled = !!enabled;
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
        if (this.prayerHeadIcon === icon) return;
        this.prayerHeadIcon = icon;
        const index = icon != null ? PRAYER_HEAD_ICON_IDS[icon] ?? -1 : -1;
        this.appearance.headIcons.prayer = index;
    }

    getPrayerLevel(): number {
        const skill = this.getSkill(SkillId.Prayer);
        return Math.max(0, skill.baseLevel + skill.boost);
    }

    getPrayerDrainAccumulator(): number {
        return this.prayerDrainAccumulator;
    }

    setPrayerDrainAccumulator(value: number): void {
        this.prayerDrainAccumulator = Math.max(0, value);
    }

    resetPrayerDrainAccumulator(): void {
        this.prayerDrainAccumulator = 0;
    }

    getSkill(id: SkillId): PlayerSkillState {
        return this.skills[id];
    }

    setSkillXp(id: SkillId, xp: number): void {
        const skill = this.skills[id];
        const normalizedXp = normalizeSkillXpValue(xp);
        const prevXp = skill.xp;
        if (prevXp === normalizedXp) return;

        skill.xp = normalizedXp;
        const prevBase = skill.baseLevel;
        const prevVirtual = skill.virtualLevel;
        skill.baseLevel = getLevelForXp(normalizedXp, { virtual: false });
        skill.virtualLevel = getLevelForXp(normalizedXp, { virtual: true });
        if (skill.baseLevel > MAX_REAL_LEVEL) skill.baseLevel = MAX_REAL_LEVEL;
        if (skill.virtualLevel > MAX_VIRTUAL_LEVEL) skill.virtualLevel = MAX_VIRTUAL_LEVEL;

        const minLevel = this.getSkillMinLevel(id);
        if (skill.boost + skill.baseLevel < minLevel) {
            skill.boost = minLevel - skill.baseLevel;
        }

        const baseChanged = skill.baseLevel !== prevBase;
        const virtualChanged = skill.virtualLevel !== prevVirtual;

        if (baseChanged) {
            this.skillTotal = computeTotalLevel(this.skills);
        }
        if (baseChanged && COMBAT_SKILL_IDS.has(id)) {
            this.combatLevel = computeCombatLevel(this.skills);
        }

        if (normalizedXp !== prevXp || baseChanged || virtualChanged) {
            this.markSkillDirty(id);
        }

        if (id === SkillId.Hitpoints) {
            const maxHp = skill.baseLevel;
            this.hitpointsCurrent = Math.min(maxHp, Math.max(0, this.hitpointsCurrent));
            this.markSkillDirty(SkillId.Hitpoints);
        }
    }

    setSkillBoost(id: SkillId, boostedLevel: number): void {
        const skill = this.skills[id];
        const upperBound = id === SkillId.Hitpoints ? MAX_TEMP_HITPOINT_LEVEL : MAX_VIRTUAL_LEVEL;
        const minLevel = this.getSkillMinLevel(id);
        const clampedTarget = Math.min(upperBound, Math.max(minLevel, Math.floor(boostedLevel)));
        const nextBoost = clampedTarget - skill.baseLevel;
        if (nextBoost === skill.boost) return;
        skill.boost = nextBoost;
        if (id === SkillId.Hitpoints) {
            this.nextHitpointOverhealDecayTick = 0;
            const max = this.getHitpointsMax();
            if (this.hitpointsCurrent > max) {
                this.hitpointsCurrent = max;
            }
            this.markSkillDirty(SkillId.Hitpoints);
        } else {
            this.markSkillDirty(id);
        }
    }

    adjustSkillBoost(id: SkillId, delta: number): void {
        const skill = this.skills[id];
        const current = skill.baseLevel + skill.boost;
        this.setSkillBoost(id, current + delta);
    }

    takeSkillSync(): SkillSyncUpdate | undefined {
        if (this.skillSnapshotPending) {
            this.skillSnapshotPending = false;
            const skills = SKILL_IDS.map((id) => this.buildSkillSyncState(id));
            this.dirtySkills.clear();
            return {
                snapshot: true,
                skills,
                totalLevel: this.skillTotal,
                combatLevel: this.combatLevel,
            };
        }
        if (this.dirtySkills.size === 0) return undefined;
        const skills: SkillSyncState[] = [];
        for (const id of this.dirtySkills) skills.push(this.buildSkillSyncState(id));
        this.dirtySkills.clear();
        return {
            snapshot: false,
            skills,
            totalLevel: this.skillTotal,
            combatLevel: this.combatLevel,
        };
    }

    requestFullSkillSync(): void {
        this.skillSnapshotPending = true;
        this.markAllSkillsDirty();
    }

    private buildSkillSyncState(id: SkillId): SkillSyncState {
        const skill = this.skills[id];
        const currentLevel =
            id === SkillId.Hitpoints
                ? Math.max(0, Math.min(this.getHitpointsMax(), this.hitpointsCurrent))
                : Math.max(this.getSkillMinLevel(id), skill.baseLevel + skill.boost);
        return {
            id,
            xp: skill.xp,
            baseLevel: skill.baseLevel,
            virtualLevel: skill.virtualLevel,
            boost: skill.boost,
            currentLevel,
        };
    }

    private markAllSkillsDirty(): void {
        for (const id of SKILL_IDS) this.dirtySkills.add(id);
    }

    private markSkillDirty(id: SkillId): void {
        this.dirtySkills.add(id);
    }

    private getSkillMinLevel(id: SkillId): number {
        return id === SkillId.Prayer ? 0 : 1;
    }

    getHitpointsMax(): number {
        const skill = this.getSkill(SkillId.Hitpoints);
        const base = Math.max(1, skill.baseLevel);
        const boosted = base + skill.boost;
        const capped = Math.max(1, Math.min(MAX_TEMP_HITPOINT_LEVEL, boosted));
        return capped;
    }

    getHitpointsCurrent(): number {
        return this.hitpointsCurrent;
    }

    /** Get slayer task info for combat calculations. */
    getSlayerTaskInfo(): {
        onTask: boolean;
        monsterName?: string;
        monsterSpecies?: string[];
    } {
        const task = this.slayerTask;
        if (!task) return { onTask: false };
        let onTask = task.onTask ?? task.active;
        if (onTask === undefined) {
            onTask =
                (task.remaining !== undefined && task.remaining > 0) ||
                (task.amount !== undefined && task.amount > 0);
        }
        return {
            onTask: !!onTask,
            monsterName: task.monsterName,
            monsterSpecies: task.monsterSpecies,
        };
    }

    setHitpointsCurrent(value: number): void {
        const max = this.getHitpointsMax();
        const next = Math.max(0, Math.min(max, Math.floor(value)));
        if (next === this.hitpointsCurrent) return;
        const wasAlive = this._wasAlive;
        this.hitpointsCurrent = next;
        this._wasAlive = next > 0;
        this.markSkillDirty(SkillId.Hitpoints);
        // Trigger death callback when HP reaches 0 from being alive
        if (wasAlive && next <= 0) {
            try {
                this.onDeath?.();
            } catch {}
        }
    }

    applyHitpointsDamage(amount: number): { current: number; max: number } {
        if (!(amount > 0)) return { current: this.hitpointsCurrent, max: this.getHitpointsMax() };
        this.setHitpointsCurrent(this.hitpointsCurrent - amount);
        return { current: this.hitpointsCurrent, max: this.getHitpointsMax() };
    }

    applyHitpointsHeal(amount: number): { current: number; max: number } {
        if (!(amount > 0)) return { current: this.hitpointsCurrent, max: this.getHitpointsMax() };
        const target = Math.max(0, Math.floor(this.hitpointsCurrent + amount));
        if (target > this.getHitpointsMax()) {
            this.ensureHitpointsTempMax(target);
        }
        this.setHitpointsCurrent(target);
        return { current: this.hitpointsCurrent, max: this.getHitpointsMax() };
    }

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
        const effectiveRamp = Math.max(1, Math.floor(ramp));
        const effectiveCap = Math.max(nextStage, Math.floor(cap));
        const effect = this.venomEffect;
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
        const effect = this.diseaseEffect;
        if (!effect || nextPotency > effect.potency) {
            this.diseaseEffect = {
                potency: nextPotency,
                interval: Math.max(1, interval),
                nextTick: currentTick + Math.max(1, interval),
            };
        } else {
            effect.nextTick = Math.min(effect.nextTick, currentTick + Math.max(1, interval));
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

    private processPoison(currentTick: number): StatusHitsplat | undefined {
        const effect = this.poisonEffect;
        if (!effect) return undefined;
        if (this.hitpointsCurrent <= 0) {
            this.poisonEffect = undefined;
            return undefined;
        }
        if (currentTick < effect.nextTick) return undefined;
        const amount = Math.max(1, Math.floor(effect.potency));
        const result = this.applyHitpointsDamage(amount);
        // OSRS: Green tint flash on poison damage
        this.setColorOverride(21, 7, 50, 40, 1);
        effect.potency = Math.max(0, effect.potency - 1);
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
        if (this.hitpointsCurrent <= 0) {
            this.venomEffect = undefined;
            return undefined;
        }
        if (currentTick < effect.nextTick) return undefined;
        const amount = Math.max(1, Math.floor(effect.stage));
        const result = this.applyHitpointsDamage(amount);
        // OSRS: Dark green tint flash on venom damage
        this.setColorOverride(21, 7, 30, 50, 1);
        if (result.current <= 0) {
            this.venomEffect = undefined;
        } else {
            const nextStage = Math.min(effect.cap, effect.stage + effect.ramp);
            effect.stage = nextStage;
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
        if (this.hitpointsCurrent <= 1) {
            // Disease cannot reduce below 1 HP
            this.diseaseEffect = undefined;
            return undefined;
        }
        if (currentTick < effect.nextTick) return undefined;
        const safeDamage = Math.max(0, this.hitpointsCurrent - 1);
        const amount = Math.min(safeDamage, Math.max(1, Math.floor(effect.potency)));
        if (amount <= 0) {
            this.diseaseEffect = undefined;
            return undefined;
        }
        const result = this.applyHitpointsDamage(amount);
        effect.potency = Math.max(0, effect.potency - 1);
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
        const before = this.hitpointsCurrent;
        const result = this.applyHitpointsHeal(effect.heal);
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

    tickSkillRestoration(currentTick: number): void {
        const hasRapidRestore = this.hasPrayerActive("rapid_restore");
        const restoreInterval = hasRapidRestore
            ? Math.max(1, Math.floor(SKILL_RESTORE_INTERVAL_TICKS / 2))
            : SKILL_RESTORE_INTERVAL_TICKS;
        if (this.nextSkillRestoreTick <= 0) {
            this.nextSkillRestoreTick = currentTick + restoreInterval;
        } else if (currentTick >= this.nextSkillRestoreTick) {
            this.nextSkillRestoreTick = currentTick + restoreInterval;
            this.restoreDrainedSkills();
        } else if (hasRapidRestore) {
            const remaining = this.nextSkillRestoreTick - currentTick;
            if (remaining > restoreInterval) {
                this.nextSkillRestoreTick = currentTick + restoreInterval;
            }
        }

        const preserveActive = this.hasPrayerActive("preserve");
        const decayInterval = preserveActive
            ? Math.max(1, Math.floor(SKILL_BOOST_DECAY_INTERVAL_TICKS * PRESERVE_DECAY_MULTIPLIER))
            : SKILL_BOOST_DECAY_INTERVAL_TICKS;
        if (this.nextSkillBoostDecayTick <= 0) {
            this.nextSkillBoostDecayTick = currentTick + decayInterval;
        } else if (currentTick >= this.nextSkillBoostDecayTick) {
            this.nextSkillBoostDecayTick = currentTick + decayInterval;
            this.decayPositiveSkillBoosts();
        } else if (preserveActive) {
            const remaining = this.nextSkillBoostDecayTick - currentTick;
            if (remaining > decayInterval) {
                this.nextSkillBoostDecayTick = currentTick + decayInterval;
            }
        }
    }

    private restoreDrainedSkills(): void {
        for (const skill of this.skills) {
            if (!skill) continue;
            if (skill.id === SkillId.Prayer || skill.id === SkillId.Hitpoints) continue;
            if (skill.boost < 0) {
                skill.boost = Math.min(0, skill.boost + 1);
                this.markSkillDirty(skill.id);
            }
        }
    }

    private decayPositiveSkillBoosts(): void {
        for (const skill of this.skills) {
            if (!skill) continue;
            if (skill.id === SkillId.Prayer || skill.id === SkillId.Hitpoints) continue;
            if (skill.boost > 0) {
                skill.boost = Math.max(0, skill.boost - 1);
                this.markSkillDirty(skill.id);
            }
        }
    }

    tickHitpoints(currentTick: number): StatusHitsplat[] | undefined {
        const skill = this.getSkill(SkillId.Hitpoints);
        const baseLevel = Math.max(1, skill.baseLevel);

        const regenInterval = this.hasPrayerActive("rapid_heal")
            ? Math.max(1, Math.floor(HITPOINT_REGEN_INTERVAL_TICKS / 2))
            : HITPOINT_REGEN_INTERVAL_TICKS;
        if (this.nextHitpointRegenTick <= 0) {
            this.nextHitpointRegenTick = currentTick + regenInterval;
        } else if (currentTick >= this.nextHitpointRegenTick) {
            this.nextHitpointRegenTick = currentTick + regenInterval;
            if (this.hitpointsCurrent < baseLevel) {
                this.setHitpointsCurrent(this.hitpointsCurrent + 1);
            }
        }

        if (skill.boost > 0) {
            if (this.nextHitpointOverhealDecayTick <= 0) {
                this.nextHitpointOverhealDecayTick =
                    currentTick + HITPOINT_OVERHEAL_DECAY_INTERVAL_TICKS;
            } else if (currentTick >= this.nextHitpointOverhealDecayTick) {
                const nextBoost = Math.max(0, skill.boost - 1);
                this.nextHitpointOverhealDecayTick =
                    currentTick + HITPOINT_OVERHEAL_DECAY_INTERVAL_TICKS;
                this.setSkillBoost(SkillId.Hitpoints, baseLevel + nextBoost);
            }
        } else {
            this.nextHitpointOverhealDecayTick = 0;
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

    private ensureHitpointsTempMax(targetLevel: number): void {
        const normalizedTarget = Math.max(1, Math.floor(targetLevel));
        const skill = this.getSkill(SkillId.Hitpoints);
        const base = Math.max(1, skill.baseLevel);
        const desiredBoost = normalizedTarget - base;
        const lowerBound = 1 - base;
        const upperBound = MAX_TEMP_HITPOINT_LEVEL - base;
        const cappedBoost = Math.max(lowerBound, Math.min(upperBound, desiredBoost));
        if (cappedBoost === skill.boost) return;
        skill.boost = cappedBoost;
        if (cappedBoost > 0) {
            this.nextHitpointOverhealDecayTick = 0;
        }
        this.markSkillDirty(SkillId.Hitpoints);
        const max = this.getHitpointsMax();
        if (this.hitpointsCurrent > max) {
            this.hitpointsCurrent = max;
            this.markSkillDirty(SkillId.Hitpoints);
        }
    }
}

/**
 * Orphaned player data - players who disconnected while in combat.
 * They remain in the game world and can be attacked until combat ends.
 */
export interface OrphanedPlayer {
    /** The player state (still in game world) */
    player: PlayerState;
    /** The tick when the player disconnected */
    disconnectTick: number;
    /** The save key for reconnection matching */
    saveKey: string;
}

/**
 * Maximum ticks an orphaned player stays in-game (100 ticks = 60 seconds).
 * After this, they are removed regardless of combat state.
 */
const ORPHAN_MAX_TICKS = 100;

// --- Player management / interaction delegation ---
export class PlayerManager implements PlayerRepository {
    private players = new Map<any, PlayerState>(); // key by ws
    private pathService: PathService;
    // Headless players (no websocket) for testing/simulation
    private bots: PlayerState[] = [];
    /**
     * Orphaned players - disconnected while in combat.
     * Key is saveKey (username), value is orphan data.
     * These players remain in the game world and can be attacked.
     */
    private orphanedPlayers = new Map<string, OrphanedPlayer>();
    /**
     * Player sync uses a 2048-slot index space on the client (0..2047).
     * The server currently uses {@link PlayerState.id} as that index, so we must
     * keep player IDs within this range to avoid client-side index collisions.
     */
    private static readonly MAX_SYNC_PLAYER_ID = 2047;
    private nextId: number = 1;
    private freeIds: number[] = [];
    /** O(1) lookup set for in-use player IDs */
    private usedIds = new Set<number>();
    private locTypeLoader?: any;
    private doorManager?: DoorStateManager;
    private readonly interactionSystem: PlayerInteractionSystem;

    constructor(
        pathService: PathService,
        locTypeLoader?: any,
        doorManager?: DoorStateManager,
        scriptRuntime?: ScriptRuntime,
    ) {
        this.pathService = pathService;
        this.locTypeLoader = locTypeLoader;
        this.doorManager = doorManager;
        this.interactionSystem = new PlayerInteractionSystem(
            this,
            pathService,
            locTypeLoader,
            doorManager,
            scriptRuntime,
        );
    }

    setLocChangeCallback(
        callback: (
            oldId: number,
            newId: number,
            tile: { x: number; y: number },
            level: number,
            opts?: {
                oldTile?: { x: number; y: number };
                newTile?: { x: number; y: number };
                oldRotation?: number;
                newRotation?: number;
            },
        ) => void,
    ): void {
        this.interactionSystem.setLocChangeCallback(callback);
    }

    setTradeHandshakeCallback(
        callback: (initiator: PlayerState, target: PlayerState, tick: number) => void,
    ): void {
        this.interactionSystem.setTradeHandshakeCallback(callback);
    }

    setGroundItemInteractionCallback(
        callback: (player: PlayerState, interaction: GroundItemInteractionState) => void,
    ): void {
        this.interactionSystem.setGroundItemInteractionCallback(callback);
    }

    setGameMessageCallback(callback: (player: PlayerState, text: string) => void): void {
        this.interactionSystem.setGameMessageCallback(callback);
    }

    /**
     * OSRS parity: Set callback for interrupting skill actions.
     * Called when player walks, starts new interaction, teleports, etc.
     */
    setInterruptSkillActionsCallback(callback: (playerId: number) => void): void {
        this.interactionSystem.setInterruptSkillActionsCallback(callback);
    }

    /**
     * Set callback to stop auto-attack in PlayerCombatManager when player walks.
     */
    setStopAutoAttackCallback(callback: (playerId: number) => void): void {
        this.interactionSystem.setStopAutoAttackCallback(callback);
    }

    /**
     * Set callback to validate whether NPC combat can start for single/multi rules.
     */
    setNpcCombatPermissionCallback(
        callback: (
            attacker: PlayerState,
            npc: NpcState,
            currentTick: number,
        ) => { allowed: boolean; reason?: string },
    ): void {
        this.interactionSystem.setNpcCombatPermissionCallback(callback);
    }

    private allocatePlayerId(): number | undefined {
        const reused = this.freeIds.pop();
        if (reused !== undefined) return reused;

        const next = this.nextId;
        if (next <= PlayerManager.MAX_SYNC_PLAYER_ID) {
            this.nextId = next + 1;
            return next;
        }

        // Fallback: find any gap (should be rare; mostly protects against bugs).
        for (let id = 1; id <= PlayerManager.MAX_SYNC_PLAYER_ID; id++) {
            if (!this.isPlayerIdInUse(id)) return id;
        }

        return undefined;
    }

    private isPlayerIdInUse(id: number): boolean {
        return this.usedIds.has(id);
    }

    add(ws: any, spawnX: number, spawnY: number, level: number = 0): PlayerState | undefined {
        const id = this.allocatePlayerId();
        if (id === undefined) {
            logger.warn(
                `[player] Refusing connection: player id pool exhausted (max=${PlayerManager.MAX_SYNC_PLAYER_ID})`,
            );
            return undefined;
        }
        const p = new PlayerState(id, spawnX, spawnY, level);
        this.players.set(ws, p);
        this.usedIds.add(id);

        // Enable debug logging for this player
        DEBUG_PLAYER_IDS.add(id);
        logger.info(`[DEBUG] Player ID ${id} added to debug logging at (${spawnX},${spawnY})`);

        return p;
    }

    // Create a headless fake player (no websocket) at the given tile.
    addBot(spawnX: number, spawnY: number, level: number = 0): PlayerState | undefined {
        const id = this.allocatePlayerId();
        if (id === undefined) {
            logger.warn(
                `[bot] Failed to spawn bot: player id pool exhausted (max=${PlayerManager.MAX_SYNC_PLAYER_ID})`,
            );
            return undefined;
        }
        const p = new PlayerState(id, spawnX, spawnY, level);
        // Assign a default Rune equipment appearance for bots so clients can
        // render a distinct look without guessing.
        // OSRS classic item ids used here; clients can ignore unknown slots.
        const botEquip = new Array<number>(14).fill(-1);
        botEquip[0] = 1163; // HEAD: rune full helm
        botEquip[3] = 1333; // WEAPON: rune scimitar
        botEquip[4] = 1127; // BODY: rune platebody
        botEquip[5] = 1201; // SHIELD: rune kiteshield
        botEquip[6] = 1079; // LEGS: rune platelegs
        botEquip[8] = 4131; // BOOTS: rune boots
        p.appearance = {
            gender: 0,
            headIcons: { prayer: -1 },
            equip: botEquip,
        };
        this.bots.push(p);
        this.usedIds.add(id);
        return p;
    }

    remove(ws: any): void {
        const p = this.players.get(ws);
        if (p) {
            p.visibleNpcIds.clear();
            p.clearInteraction();

            // Disable debug logging for this player
            DEBUG_PLAYER_IDS.delete(p.id);
            logger.info(`[DEBUG] Player ID ${p.id} removed from debug logging`);
            const id = p.id;
            if (id >= 1 && id <= PlayerManager.MAX_SYNC_PLAYER_ID) {
                this.freeIds.push(id);
                this.usedIds.delete(id);
            }
        }
        this.players.delete(ws);
        this.interactionSystem.removeSocket(ws);
    }

    get(ws: any): PlayerState | undefined {
        return this.players.get(ws);
    }

    /**
     * Get a player by their unique ID.
     * Used by PlayerCombatManager for player lookups.
     * Also checks orphaned players since they're still in the game world.
     */
    getPlayerById(playerId: number): PlayerState | undefined {
        const id = playerId;
        for (const p of this.players.values()) {
            if (p.id === id) return p;
        }
        for (const p of this.bots) {
            if (p.id === id) return p;
        }
        // Check orphaned players - they're still attackable
        for (const orphan of this.orphanedPlayers.values()) {
            if (orphan.player.id === id) return orphan.player;
        }
        return undefined;
    }

    /**
     * Orphan a player - keep them in the game world after disconnect.
     * Used when a player disconnects while in combat.
     * @param ws The websocket being disconnected
     * @param saveKey The player's save key for reconnection matching
     * @param currentTick The current game tick
     * @returns true if the player was orphaned, false if removed normally
     */
    orphanPlayer(ws: any, saveKey: string, currentTick: number): boolean {
        const player = this.players.get(ws);
        if (!player) return false;

        // Check if player should be orphaned (in combat)
        if (player.canLogout()) {
            // Safe to remove immediately - not in combat
            return false;
        }

        // Move to orphaned state
        this.orphanedPlayers.set(saveKey, {
            player,
            disconnectTick: currentTick,
            saveKey,
        });

        // Remove from active players map but keep player state alive
        this.players.delete(ws);
        this.interactionSystem.removeSocket(ws);

        logger.info(
            `[orphan] Player ${player.id} (${saveKey}) orphaned at tick ${currentTick} - in combat, staying in world`,
        );

        return true;
    }

    /**
     * Try to reconnect to an orphaned player.
     * @param ws The new websocket connection
     * @param saveKey The player's save key
     * @returns The orphaned player if found and reconnected, undefined otherwise
     */
    reconnectOrphanedPlayer(ws: any, saveKey: string): PlayerState | undefined {
        const orphan = this.orphanedPlayers.get(saveKey);
        if (!orphan) return undefined;

        // Reconnect - move player back to active
        this.players.set(ws, orphan.player);
        this.orphanedPlayers.delete(saveKey);

        logger.info(
            `[orphan] Player ${orphan.player.id} (${saveKey}) reconnected - resuming control`,
        );

        return orphan.player;
    }

    /**
     * Check if a player has an orphaned session.
     */
    hasOrphanedPlayer(saveKey: string): boolean {
        return this.orphanedPlayers.has(saveKey);
    }

    /**
     * Check if a username already has a live connected session.
     * Orphaned sessions are excluded so the same account can reclaim them.
     */
    hasConnectedPlayer(username: string): boolean {
        const normalized = normalizePlayerAccountName(username);
        if (!normalized) return false;
        for (const player of this.players.values()) {
            if (normalizePlayerAccountName(player.name) === normalized) {
                return true;
            }
        }
        return false;
    }

    /**
     * Get total player count (active + orphaned + bots).
     * Used for world capacity checks.
     */
    getTotalPlayerCount(): number {
        return this.players.size + this.orphanedPlayers.size + this.bots.length;
    }

    getRealPlayerCount(): number {
        return this.players.size + this.orphanedPlayers.size;
    }

    /**
     * Process orphaned players each tick.
     * Removes players who can now logout or have exceeded max orphan time.
     * @param currentTick The current game tick
     * @param onRemove Callback when an orphaned player is removed (for saving)
     */
    processOrphanedPlayers(
        currentTick: number,
        onRemove?: (player: PlayerState, saveKey: string) => void,
    ): void {
        const toRemove: string[] = [];

        for (const [saveKey, orphan] of this.orphanedPlayers) {
            const ticksSinceDisconnect = currentTick - orphan.disconnectTick;

            // Remove if: combat ended OR max timeout exceeded
            const canLogoutNow = orphan.player.canLogout();
            const maxTimeExceeded = ticksSinceDisconnect >= ORPHAN_MAX_TICKS;

            if (canLogoutNow || maxTimeExceeded) {
                toRemove.push(saveKey);
                const reason = maxTimeExceeded ? "max timeout" : "combat ended";
                logger.info(
                    `[orphan] Removing orphaned player ${orphan.player.id} (${saveKey}) - ${reason} after ${ticksSinceDisconnect} ticks`,
                );
            }
        }

        for (const saveKey of toRemove) {
            const orphan = this.orphanedPlayers.get(saveKey);
            if (orphan) {
                // Call removal callback (for saving state)
                onRemove?.(orphan.player, saveKey);

                // Free the player ID
                const id = orphan.player.id;
                if (id >= 1 && id <= PlayerManager.MAX_SYNC_PLAYER_ID) {
                    this.freeIds.push(id);
                    this.usedIds.delete(id);
                }

                // Clean up player state
                orphan.player.visibleNpcIds.clear();
                orphan.player.clearInteraction();
                DEBUG_PLAYER_IDS.delete(orphan.player.id);

                this.orphanedPlayers.delete(saveKey);
            }
        }
    }

    /**
     * Get all orphaned players (for iteration in game tick).
     */
    getOrphanedPlayers(): IterableIterator<OrphanedPlayer> {
        return this.orphanedPlayers.values();
    }

    getInteractionState(ws: any): PlayerInteractionState | undefined {
        return this.interactionSystem.getStateForSocket(ws);
    }

    // Expose whether a socket is following a specific player id (follow mode)
    isFollowingSocket(ws: any, targetId: number): boolean {
        return this.interactionSystem.isFollowingSocket(ws, targetId);
    }

    // Expose the interacting entity (target) for a given socket, if any
    getInteractingForSocket(
        ws: any,
    ): { targetId: number; mode: "follow" | "trade" | "combat" } | undefined {
        return this.interactionSystem.getInteractingForSocket(ws);
    }

    forEach(cb: (ws: any, p: PlayerState) => void): void {
        for (const [ws, p] of this.players.entries()) cb(ws, p);
    }

    /**
     * Iterate over all players including orphaned ones (for visibility/combat).
     * Orphaned players have null as their socket.
     */
    forEachIncludingOrphaned(cb: (ws: any | null, p: PlayerState) => void): void {
        for (const [ws, p] of this.players.entries()) cb(ws, p);
        for (const orphan of this.orphanedPlayers.values()) cb(null, orphan.player);
    }

    /**
     * Get all player states including orphaned (for player sync visibility).
     */
    getAllPlayersForSync(): PlayerState[] {
        const result: PlayerState[] = [];
        for (const p of this.players.values()) result.push(p);
        for (const orphan of this.orphanedPlayers.values()) result.push(orphan.player);
        for (const b of this.bots) result.push(b);
        return result;
    }

    forEachBot(cb: (p: PlayerState) => void): void {
        for (const p of this.bots) cb(p);
    }

    getById(id: number): PlayerState | undefined {
        let found: PlayerState | undefined;
        this.forEach((_, p) => {
            if (!found && p.id === id) found = p;
        });
        if (found) return found;
        for (const b of this.bots) if (b.id === id) return b;
        // Check orphaned players - they're still in the game world
        for (const orphan of this.orphanedPlayers.values()) {
            if (orphan.player.id === id) return orphan.player;
        }
        return undefined;
    }

    // Compute and assign a path for player's next walk command
    routePlayer(
        ws: any,
        to: Tile,
        run: boolean = false,
        currentTick?: number,
    ): { ok: boolean; message?: string; destinationCorrection?: Tile } {
        const p = this.players.get(ws);
        if (!p) return { ok: false, message: "player not found" };
        if (currentTick !== undefined && p.isMovementLocked(currentTick)) {
            return { ok: false, message: "movement_locked" };
        }
        if (!to || (to.x === p.tileX && to.y === p.tileY)) {
            p.clearWalkDestination();
            p.clearPath();
            return { ok: true };
        }
        // Note: Modal/dialog closing is now handled by closeInterruptibleInterfaces()
        // in wsServer before routePlayer() is called.
        p.setWalkDestination({ x: to.x, y: to.y }, !!run);
        // OSRS-style server-authoritative walking: pathfind in a local window and
        // re-run pathfinding as the player moves for long routes.
        const graphSize = Math.max(16, this.pathService.getGraphSize());
        const maxDelta = Math.max(1, (graphSize >> 1) - 3);
        const dxToDest = to.x - p.tileX;
        const dyToDest = to.y - p.tileY;
        const segmentDx = Math.max(-maxDelta, Math.min(maxDelta, dxToDest));
        const segmentDy = Math.max(-maxDelta, Math.min(maxDelta, dyToDest));
        const segmentTo: Tile = {
            x: p.tileX + segmentDx,
            y: p.tileY + segmentDy,
        };
        const t0 = Date.now();
        const res = this.pathService.findPathSteps(
            {
                from: { x: p.tileX, y: p.tileY, plane: p.level },
                to: segmentTo,
                size: 1,
                worldViewId: p.worldViewId,
            },
            { maxSteps: 128 },
        );
        const dt = Date.now() - t0;
        if (!res.ok || !res.steps || res.steps.length === 0) {
            p.clearWalkDestination();
            return { ok: false, message: res.message || "no path" };
        }

        // Optional debug logging: also compute the legacy "waypoints" view (turn-point compressed)
        // for easier inspection.
        let debugWaypoints: { x: number; y: number }[] | undefined;
        if (DEBUG_PLAYER_IDS.has(p.id)) {
            try {
                const wp = this.pathService.findPath({
                    from: { x: p.tileX, y: p.tileY, plane: p.level },
                    to: segmentTo,
                    size: 1,
                });
                if (wp.ok && wp.waypoints) debugWaypoints = wp.waypoints;
            } catch {}
        }

        if (DEBUG_PLAYER_IDS.has(p.id)) {
            try {
                const waypointStr = (debugWaypoints ?? [])
                    .map((wp) => `(${wp.x},${wp.y})`)
                    .join(" -> ");
                const tileStr = [`(${p.tileX},${p.tileY})`]
                    .concat(res.steps.map((step) => `(${step.x},${step.y})`))
                    .join(" -> ");
                logger.info(
                    `pathfind route: ${dt}ms ${p.tileX},${p.tileY} -> ${to.x},${to.y} waypoints=[${waypointStr}] tiles=[${tileStr}]`,
                );
            } catch {}
        }

        let destinationCorrection: Tile | undefined;
        const selectedEnd = res.end ?? res.steps[res.steps.length - 1]!;
        const isFinalSegment = segmentTo.x === to.x && segmentTo.y === to.y;
        if (isFinalSegment && (selectedEnd.x !== segmentTo.x || selectedEnd.y !== segmentTo.y)) {
            destinationCorrection = { x: selectedEnd.x, y: selectedEnd.y };
            p.setWalkDestination(destinationCorrection, !!run);
        }

        const shouldRun = p.resolveRequestedRun(run);
        p.setPathPreservingWalkDestination(res.steps, shouldRun);
        this.interactionSystem.handleManualMovement(ws, { x: to.x, y: to.y });

        return { ok: true, destinationCorrection };
    }

    continueWalkToDestination(
        player: PlayerState,
        currentTick: number,
    ): { destinationCorrection?: Tile } | void {
        const target = player.getWalkDestination();
        if (!target) return;

        if (player.tileX === target.x && player.tileY === target.y) {
            player.clearWalkDestination();
            return;
        }
        if (player.hasPath()) {
            return;
        }
        if (player.isMovementLocked(currentTick)) {
            return;
        }
        if (currentTick < player.getWalkRepathAfterTick()) {
            return;
        }

        const graphSize = Math.max(16, this.pathService.getGraphSize());
        const maxDelta = Math.max(1, (graphSize >> 1) - 3);
        const dxToDest = target.x - player.tileX;
        const dyToDest = target.y - player.tileY;
        const segmentDx = Math.max(-maxDelta, Math.min(maxDelta, dxToDest));
        const segmentDy = Math.max(-maxDelta, Math.min(maxDelta, dyToDest));

        if (segmentDx === 0 && segmentDy === 0) {
            player.clearWalkDestination();
            return;
        }
        const segmentTo: Tile = {
            x: player.tileX + segmentDx,
            y: player.tileY + segmentDy,
        };

        const res = this.pathService.findPathSteps(
            {
                from: { x: player.tileX, y: player.tileY, plane: player.level },
                to: segmentTo,
                size: 1,
            },
            { maxSteps: 128 },
        );
        if (!res.ok || !res.steps || res.steps.length === 0) {
            // Avoid hammering the pathfinder every tick if a segment is temporarily blocked.
            // A 1-tick backoff matches movement cadence better and avoids visible 1-tick stalls.
            player.setWalkRepathAfterTick(currentTick + 1);
            return;
        }

        let destinationCorrection: Tile | undefined;
        const selectedEnd = res.end ?? res.steps[res.steps.length - 1]!;
        const isFinalSegment = segmentTo.x === target.x && segmentTo.y === target.y;
        if (isFinalSegment && (selectedEnd.x !== segmentTo.x || selectedEnd.y !== segmentTo.y)) {
            destinationCorrection = { x: selectedEnd.x, y: selectedEnd.y };
            player.setWalkDestination(destinationCorrection, !!target.run);
        }

        const shouldRun = player.resolveRequestedRun(!!target.run);
        player.setPathPreservingWalkDestination(res.steps, shouldRun);
        if (destinationCorrection) {
            return { destinationCorrection };
        }
    }

    routeBot(p: PlayerState, to: Tile, run: boolean = false): { ok: boolean; message?: string } {
        const res = this.pathService.findPathSteps(
            { from: { x: p.tileX, y: p.tileY, plane: p.level }, to, size: 1 },
            { maxSteps: 128 },
        );
        if (!res.ok || !res.steps || res.steps.length === 0)
            return { ok: false, message: res.message || "no path" };
        p.setPath(res.steps, run);
        return { ok: true };
    }

    tickBots(currentTick?: number): void {
        for (const p of this.bots) {
            if (currentTick !== undefined) {
                p.processTimersAndQueue();
                p.tickHitpoints(currentTick);
                p.tickSkillRestoration(currentTick);
                p.tickSpecialEnergy(currentTick);
                p.setMovementTick(currentTick);
            }
            p.tickStep();
        }
    }

    startFollowing(
        ws: any,
        targetId: number,
        mode: FollowInteractionKind,
        modifierFlags?: number,
    ): { ok: boolean; message?: string } {
        return this.interactionSystem.startFollowing(ws, targetId, mode, modifierFlags);
    }

    stopFollowing(ws: any): void {
        this.interactionSystem.stopFollowing(ws);
    }

    startNpcInteraction(
        ws: any,
        npc: NpcState,
        option?: string,
        modifierFlags?: number,
    ): { ok: boolean; message?: string } {
        return this.interactionSystem.startNpcInteraction(ws, npc, option, modifierFlags);
    }

    startNpcAttack(
        ws: any,
        npc: NpcState,
        currentTick: number,
        attackDelay: number = 4,
        modifierFlags?: number,
    ): { ok: boolean; message?: string; chatMessage?: string } {
        return this.interactionSystem.startNpcAttack(
            ws,
            npc,
            currentTick,
            attackDelay,
            modifierFlags,
        );
    }

    stopNpcAttack(ws: any): void {
        this.interactionSystem.stopNpcAttack(ws);
    }

    finishNpcCombatByPlayerId(playerId: number, npcId?: number): void {
        this.interactionSystem.finishNpcCombatByPlayerId(playerId, npcId);
    }

    stopNpcInteraction(ws: any): void {
        this.interactionSystem.stopNpcInteraction(ws);
    }

    /**
     * Clears all interaction state for a socket.
     * RSMod parity: Called when player walks to fully clear combat/interaction state.
     */
    clearAllInteractions(ws: any): void {
        this.interactionSystem.clearAllInteractions(ws);
    }

    updateFollowing(currentTick: number = 0): void {
        this.interactionSystem.updateFollowing(currentTick);
    }

    updateNpcInteractions(tick: number, npcLookup: (npcId: number) => NpcState | undefined): void {
        this.interactionSystem.updateNpcInteractions(tick, npcLookup);
    }

    applyInteractionFacing(
        ws: any,
        player: PlayerState,
        npcLookup: (npcId: number) => NpcState | undefined,
        currentTick?: number,
    ): void {
        this.interactionSystem.applyInteractionFacing(ws, player, npcLookup, currentTick);
    }

    startPlayerCombat(ws: any, targetPlayerId: number, untilTick?: number): void {
        this.interactionSystem.startPlayerCombat(ws, targetPlayerId, untilTick);
    }

    stopPlayerCombat(ws: any): void {
        this.interactionSystem.stopPlayerCombat(ws);
    }

    updatePlayerAttacks(
        tick: number,
        requestAttack: (
            player: PlayerState,
            target: PlayerState,
            attackDelay: number,
            currentTick: number,
        ) => boolean,
        opts?: {
            pickPlayerAttackDelay?: (player: PlayerState, target: PlayerState) => number;
        },
    ): void {
        this.interactionSystem.updatePlayerAttacks(tick, requestAttack, opts);
    }

    // Record a pending object (loc) interaction for a socket. Server will log upon proximity.
    startLocInteract(
        ws: any,
        data: {
            id: number;
            tile: { x: number; y: number };
            level?: number;
            action?: string;
            modifierFlags?: number;
        },
        currentTick?: number,
    ): void {
        this.interactionSystem.startLocInteractAtTick(ws, data, currentTick);
    }

    startGroundItemInteraction(
        ws: any,
        data: {
            itemId: number;
            stackId: number;
            tileX: number;
            tileY: number;
            tileLevel: number;
            option: string;
            modifierFlags?: number;
        },
    ): void {
        this.interactionSystem.startGroundItemInteraction(ws, data);
    }

    // Check pending object interactions; log when player is near enough (secure server-side check).
    updateLocInteractions(currentTick?: number): void {
        this.interactionSystem.updateLocInteractions(currentTick);
    }

    updateGroundItemInteractions(tick: number): void {
        this.interactionSystem.updateGroundItemInteractions(tick);
    }

    // Clear all player interactions with a specific NPC (e.g., when NPC dies)
    clearInteractionsWithNpc(npcId: number): void {
        this.interactionSystem.clearInteractionsWithNpc(npcId);
    }

    // Resolve reservations for up to two sub-steps (run) this tick to handle swaps/conflicts.
    resolveMoveReservations(): void {
        type Actor = {
            p: PlayerState;
            id: number;
            ws?: any;
            curX: number;
            curY: number;
            intends1?: { x: number; y: number };
            intends2?: { x: number; y: number };
            runningNow: boolean;
            isBot: boolean;
            pid: number;
        };
        const actors: Actor[] = [];
        const key = (x: number, y: number) => `${x},${y}`;
        // Helper to read queued steps safely
        const peek = (p: PlayerState, idx: number): { x: number; y: number } | undefined => {
            const q = p.getPathQueue();
            if (idx < 0 || idx >= q.length) return undefined;
            const s = q[idx];
            return s ? { x: s.x, y: s.y } : undefined;
        };
        // Collect socket-backed players
        for (const [ws, p] of this.players.entries()) {
            const runningNow = p.resolveRequestedRun(!!p.running);
            const i1 = peek(p, 0);
            const i2 = runningNow ? peek(p, 1) : undefined;
            actors.push({
                p,
                id: p.id,
                ws,
                curX: p.tileX,
                curY: p.tileY,
                intends1: i1,
                intends2: i2,
                runningNow,
                isBot: false,
                pid: p.getPidPriority(),
            });
        }
        // Collect bots as well
        for (const p of this.bots) {
            const runningNow = p.resolveRequestedRun(!!p.running);
            const i1 = peek(p, 0);
            const i2 = runningNow ? peek(p, 1) : undefined;
            actors.push({
                p,
                id: p.id,
                ws: undefined,
                curX: p.tileX,
                curY: p.tileY,
                intends1: i1,
                intends2: i2,
                runningNow,
                isBot: true,
                pid: p.getPidPriority(),
            });
        }

        const blocksActor = (blocker: Actor | undefined, target: Actor): boolean => {
            // Requirement: bots should never block player movement.
            if (blocker?.isBot && !!target.ws) return false;
            return !!blocker;
        };

        // Pass 1: resolve first sub-step
        const byCur1 = new Map<string, Actor>();
        const byDest1 = new Map<string, Actor[]>();
        for (const a of actors) {
            byCur1.set(key(a.curX, a.curY), a);
            if (a.intends1) {
                const arr = byDest1.get(key(a.intends1.x, a.intends1.y)) || [];
                arr.push(a);
                byDest1.set(key(a.intends1.x, a.intends1.y), arr);
            }
        }
        const allow1 = new Set<Actor>();
        const block1 = new Set<Actor>();
        // Swaps for step1
        for (const a of actors) {
            if (!a.intends1) continue;
            const b = byCur1.get(key(a.intends1.x, a.intends1.y));
            if (!b || !b.intends1) continue;
            if (b.intends1.x === a.curX && b.intends1.y === a.curY) {
                allow1.add(a);
                allow1.add(b);
            }
        }
        // Conflicts per dest for step1
        for (const [_, list] of byDest1.entries()) {
            const remaining = list.filter((a) => !allow1.has(a));
            if (remaining.length <= 0) continue;
            remaining.sort((a, b) => {
                // Prefer real players over bots, then running, then PID priority
                const pa = a.isBot ? 1 : 0;
                const pb = b.isBot ? 1 : 0;
                if (pa !== pb) return pa - pb;
                const ra = a.runningNow ? 1 : 0;
                const rb = b.runningNow ? 1 : 0;
                if (ra !== rb) return rb - ra;
                const pidDelta = a.pid - b.pid;
                if (pidDelta !== 0) return pidDelta;
                return a.id - b.id;
            });
            allow1.add(remaining[0]);
            for (let i = 1; i < remaining.length; i++) block1.add(remaining[i]);
        }
        // Occupancy for step1: allow stepping into tiles occupied by other players (stacking permitted).
        // Intentionally do not block when destination currently has an occupant.

        // Dynamic diagonal clipping for step1: block diagonals when side tiles remain occupied.
        for (const a of actors) {
            if (!a.intends1) continue;
            const dx = a.intends1.x - a.curX;
            const dy = a.intends1.y - a.curY;
            if (dx === 0 || dy === 0) continue;
            const sideKeys = [key(a.curX, a.intends1.y), key(a.intends1.x, a.curY)];
            let blocked = false;
            for (const sideKey of sideKeys) {
                const occ = byCur1.get(sideKey);
                if (!occ || occ === a) continue;
                if (!blocksActor(occ, a)) continue;
                const occMoves =
                    occ.intends1 &&
                    allow1.has(occ) &&
                    (occ.intends1.x !== occ.curX || occ.intends1.y !== occ.curY);
                if (!occMoves) {
                    blocked = true;
                    break;
                }
            }
            if (blocked) {
                allow1.delete(a);
                block1.add(a);
            }
        }

        // Positions after first sub-step
        const after1Pos = new Map<Actor, { x: number; y: number }>();
        for (const a of actors) {
            if (a.intends1 && allow1.has(a)) after1Pos.set(a, { x: a.intends1.x, y: a.intends1.y });
            else after1Pos.set(a, { x: a.curX, y: a.curY });
        }

        // Pass 2: resolve second sub-step (runners only)
        const byCur2 = new Map<string, Actor>();
        const byDest2 = new Map<string, Actor[]>();
        for (const a of actors) {
            const pos = after1Pos.get(a)!;
            byCur2.set(key(pos.x, pos.y), a);
            if (a.intends2) {
                const arr = byDest2.get(key(a.intends2.x, a.intends2.y)) || [];
                arr.push(a);
                byDest2.set(key(a.intends2.x, a.intends2.y), arr);
            }
        }
        const allow2 = new Set<Actor>();
        const block2 = new Set<Actor>();
        // Swaps for step2 (using after1 positions)
        for (const a of actors) {
            if (!a.intends2) continue;
            const aPos = after1Pos.get(a)!;
            const b = byCur2.get(key(a.intends2.x, a.intends2.y));
            if (!b || !b.intends2) continue;
            const bPos = after1Pos.get(b)!;
            if (b.intends2.x === aPos.x && b.intends2.y === aPos.y) {
                allow2.add(a);
                allow2.add(b);
            }
        }
        // Conflicts per dest for step2
        for (const [_, list] of byDest2.entries()) {
            // Fast-path: if exactly one actor targets this dest and it wasn't already allowed by swap logic,
            // grant it now. This avoids needlessly blocking the second sub-step for lone runners.
            if (list.length === 1 && !allow2.has(list[0])) {
                allow2.add(list[0]);
                continue;
            }
            const remaining = list.filter((a) => !allow2.has(a));
            if (remaining.length <= 0) continue;
            // All are runners here; tie-break by PID priority
            remaining.sort((a, b) => {
                const pa = a.isBot ? 1 : 0;
                const pb = b.isBot ? 1 : 0;
                if (pa !== pb) return pa - pb;
                const pidDelta = a.pid - b.pid;
                if (pidDelta !== 0) return pidDelta;
                return a.id - b.id;
            });
            allow2.add(remaining[0]);
            for (let i = 1; i < remaining.length; i++) block2.add(remaining[i]);
        }
        // Occupancy for step2: allow stepping into tiles occupied by other players (stacking permitted).

        // Dynamic diagonal clipping for step2: block diagonals when side tiles remain occupied.
        for (const a of actors) {
            if (!a.intends2) continue;
            const pos = after1Pos.get(a)!;
            const dx = a.intends2.x - pos.x;
            const dy = a.intends2.y - pos.y;
            if (dx === 0 || dy === 0) continue;
            const sideKeys = [key(pos.x, a.intends2.y), key(a.intends2.x, pos.y)];
            let blocked = false;
            for (const sideKey of sideKeys) {
                const occ = byCur2.get(sideKey);
                if (!occ || occ === a) continue;
                if (!blocksActor(occ, a)) continue;
                const occPos = after1Pos.get(occ)!;
                const occMoves =
                    occ.intends2 &&
                    allow2.has(occ) &&
                    (occ.intends2.x !== occPos.x || occ.intends2.y !== occPos.y);
                if (!occMoves) {
                    blocked = true;
                    break;
                }
            }
            if (blocked) {
                allow2.delete(a);
                block2.add(a);
            }
        }

        // Prevent running into an occupied tile when the occupant is not leaving this sub-step.
        for (const a of actors) {
            if (!a.intends2) continue;
            const destActor = byCur2.get(key(a.intends2.x, a.intends2.y));
            if (!destActor || destActor === a) continue;
            if (!blocksActor(destActor, a)) continue;
            const destPos = after1Pos.get(destActor)!;
            const destLeaves =
                destActor.intends2 &&
                allow2.has(destActor) &&
                (destActor.intends2.x !== destPos.x || destActor.intends2.y !== destPos.y);
            if (!destLeaves) {
                allow2.delete(a);
                block2.add(a);
            }
        }

        // Write reservations
        for (const a of actors) {
            if (a.intends1) {
                if (allow1.has(a)) a.p.nextStepReservation1 = { x: a.intends1.x, y: a.intends1.y };
                else if (block1.has(a)) a.p.nextStepReservation1 = null;
                else a.p.nextStepReservation1 = { x: a.intends1.x, y: a.intends1.y };
            } else {
                a.p.nextStepReservation1 = undefined;
            }
            if (a.intends2) {
                if (allow2.has(a)) a.p.nextStepReservation2 = { x: a.intends2.x, y: a.intends2.y };
                else if (block2.has(a)) a.p.nextStepReservation2 = null;
                else a.p.nextStepReservation2 = { x: a.intends2.x, y: a.intends2.y };
            } else {
                a.p.nextStepReservation2 = undefined;
            }
        }
    }

    getSocketByPlayerId(id: number): any | undefined {
        for (const [ws, p] of this.players.entries()) if (p.id === id) return ws;
        return undefined;
    }

    private routePlayerToNpc(player: PlayerState, npc: NpcState): boolean {
        return this.interactionSystem.routePlayerToNpc(player, npc);
    }

    private computeOrientationWorld(ox: number, oy: number, tx: number, ty: number): number {
        return this.interactionSystem.computeOrientationWorld(ox, oy, tx, ty);
    }
}
