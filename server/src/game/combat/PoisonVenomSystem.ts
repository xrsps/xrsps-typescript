/**
 * Poison & Venom System
 *
 * OSRS-accurate poison and venom mechanics:
 * - Poison: Deals decreasing damage over time (starts at 6, decreases by 1 every 5 hits)
 * - Venom: Deals increasing damage over time (starts at 6, increases by 2 every hit, caps at 20)
 * - Tick intervals: Both tick every 30 game ticks (18 seconds)
 * - Immunity: Some NPCs/equipment grant immunity
 * - Cures: Antipoison, Antivenom, Sanfew serum, etc.
 *
 * Reference: OSRS Wiki, RSMod
 */
// =============================================================================
// PoisonVenomSystem Class (convenience wrapper for index.ts exports)
// =============================================================================
import type { Actor } from "../actor";
import { HITMARK_POISON, HITMARK_VENOM } from "./HitEffects";

// Constants

/** Ticks between poison/venom damage applications (OSRS: 30 ticks = 18 seconds) */
export const POISON_TICK_INTERVAL = 30;

/** Ticks between venom damage applications (OSRS: 30 ticks = 18 seconds) */
export const VENOM_TICK_INTERVAL = 30;

/** Maximum venom damage */
export const MAX_VENOM_DAMAGE = 20;

/** Minimum poison damage before cure */
export const MIN_POISON_DAMAGE = 1;

/** Hits before poison damage decreases by 1 */
export const POISON_DECREASE_INTERVAL = 5;

// =============================================================================
// Item IDs
// =============================================================================

// Antipoison potions
const ANTIPOISON_4 = 2446;
const ANTIPOISON_3 = 2448;
const ANTIPOISON_2 = 2450;
const ANTIPOISON_1 = 2452;

const SUPERANTIPOISON_4 = 2452;
const SUPERANTIPOISON_3 = 181;
const SUPERANTIPOISON_2 = 183;
const SUPERANTIPOISON_1 = 185;

const ANTIDOTE_PLUS_4 = 5943;
const ANTIDOTE_PLUS_3 = 5945;
const ANTIDOTE_PLUS_2 = 5947;
const ANTIDOTE_PLUS_1 = 5949;

const ANTIDOTE_PLUSPLUS_4 = 5952;
const ANTIDOTE_PLUSPLUS_3 = 5954;
const ANTIDOTE_PLUSPLUS_2 = 5956;
const ANTIDOTE_PLUSPLUS_1 = 5958;

// Antivenom potions
const ANTIVENOM_4 = 12905;
const ANTIVENOM_3 = 12907;
const ANTIVENOM_2 = 12909;
const ANTIVENOM_1 = 12911;

const ANTIVENOM_PLUS_4 = 12913;
const ANTIVENOM_PLUS_3 = 12915;
const ANTIVENOM_PLUS_2 = 12917;
const ANTIVENOM_PLUS_1 = 12919;

// Sanfew serum (cures poison + disease + restores stats)
const SANFEW_SERUM_4 = 10925;
const SANFEW_SERUM_3 = 10927;
const SANFEW_SERUM_2 = 10929;
const SANFEW_SERUM_1 = 10931;

// Equipment with poison/venom immunity
const SERPENTINE_HELM = 12931;
const TANZANITE_HELM = 13197;
const MAGMA_HELM = 13199;

// Weapons that apply poison
const DRAGON_DAGGER_P = 5680;
const DRAGON_DAGGER_PP = 5698;
const ABYSSAL_DAGGER_P = 13267;
const ABYSSAL_DAGGER_PP = 13269;
const RUNE_DAGGER_P = 5678;
const RUNE_DAGGER_PP = 5696;
const ADAMANT_DAGGER_P = 5676;
const ADAMANT_DAGGER_PP = 5694;
const DRAGON_ARROW_P = 11227;
const DRAGON_ARROW_PP = 11228;

// Weapons that apply venom
const TOXIC_BLOWPIPE = 12926;
const SERPENTINE_HELM_UNCHARGED = 12929;

// =============================================================================
// Types
// =============================================================================

export const PoisonType = {
    None: "none",
    Poison: "poison",
    Venom: "venom",
} as const;
export type PoisonType = (typeof PoisonType)[keyof typeof PoisonType];

export interface PoisonState {
    type: PoisonType;
    /** Current damage (poison decreases, venom increases) */
    damage: number;
    /** Tick when next damage should occur */
    nextDamageTick: number;
    /** For poison: hits since last damage decrease */
    hitsSinceDecrease: number;
    /** Tick when immunity expires (from antidote) */
    immunityExpiryTick: number;
}

export interface PoisonDamageResult {
    damage: number;
    hitsplatStyle: number;
    stateUpdate: PoisonState;
    cured: boolean;
}

export interface PoisonApplicationResult {
    applied: boolean;
    stateUpdate: PoisonState;
    reason?: string;
}

// =============================================================================
// Poison State Management
// =============================================================================

/**
 * Create initial poison state (not poisoned).
 */
export function createPoisonState(): PoisonState {
    return {
        type: PoisonType.None,
        damage: 0,
        nextDamageTick: 0,
        hitsSinceDecrease: 0,
        immunityExpiryTick: 0,
    };
}

/**
 * Check if entity is poisoned or envenomed.
 */
export function isPoisoned(state: PoisonState): boolean {
    return state.type !== PoisonType.None && state.damage > 0;
}

/**
 * Check if entity is envenomed (venom is worse than poison).
 */
export function isEnvenomed(state: PoisonState): boolean {
    return state.type === PoisonType.Venom && state.damage > 0;
}

/**
 * Check if entity has poison/venom immunity.
 */
export function hasImmunity(state: PoisonState, currentTick: number): boolean {
    return currentTick < state.immunityExpiryTick;
}

// =============================================================================
// Poison Application
// =============================================================================

/**
 * Apply poison to an entity.
 *
 * @param state Current poison state
 * @param startingDamage Initial poison damage (typically 6 for most sources)
 * @param currentTick Current game tick
 * @param immuneToPoison Whether entity is immune to poison
 */
export function applyPoison(
    state: PoisonState,
    startingDamage: number,
    currentTick: number,
    immuneToPoison: boolean = false,
): PoisonApplicationResult {
    // Check immunity
    if (immuneToPoison || hasImmunity(state, currentTick)) {
        return {
            applied: false,
            stateUpdate: state,
            reason: "Immune to poison",
        };
    }

    // Venom takes priority over poison - can't downgrade
    if (state.type === PoisonType.Venom) {
        return {
            applied: false,
            stateUpdate: state,
            reason: "Already envenomed",
        };
    }

    // Apply poison
    const newState: PoisonState = {
        type: PoisonType.Poison,
        damage: Math.max(state.damage, startingDamage),
        nextDamageTick: currentTick + POISON_TICK_INTERVAL,
        hitsSinceDecrease: 0,
        immunityExpiryTick: state.immunityExpiryTick,
    };

    return {
        applied: true,
        stateUpdate: newState,
    };
}

/**
 * Apply venom to an entity.
 *
 * @param state Current poison state
 * @param currentTick Current game tick
 * @param immuneToVenom Whether entity is immune to venom
 */
export function applyVenom(
    state: PoisonState,
    currentTick: number,
    immuneToVenom: boolean = false,
): PoisonApplicationResult {
    // Check immunity
    if (immuneToVenom || hasImmunity(state, currentTick)) {
        return {
            applied: false,
            stateUpdate: state,
            reason: "Immune to venom",
        };
    }

    // Venom always starts at 6 damage
    const newState: PoisonState = {
        type: PoisonType.Venom,
        damage: 6,
        nextDamageTick: currentTick + VENOM_TICK_INTERVAL,
        hitsSinceDecrease: 0,
        immunityExpiryTick: state.immunityExpiryTick,
    };

    return {
        applied: true,
        stateUpdate: newState,
    };
}

// =============================================================================
// Poison Tick Processing
// =============================================================================

/**
 * Process poison/venom damage tick.
 * Should be called every game tick to check if damage should be applied.
 *
 * @param state Current poison state
 * @param currentTick Current game tick
 * @returns Damage result if damage should be applied, undefined otherwise
 */
export function processPoisonTick(
    state: PoisonState,
    currentTick: number,
): PoisonDamageResult | undefined {
    // Not poisoned/venomed
    if (state.type === PoisonType.None || state.damage <= 0) {
        return undefined;
    }

    // Not time for damage yet
    if (currentTick < state.nextDamageTick) {
        return undefined;
    }

    const damage = state.damage;
    const hitsplatStyle = state.type === PoisonType.Venom ? HITMARK_VENOM : HITMARK_POISON;

    let newDamage = damage;
    let hitsSinceDecrease = state.hitsSinceDecrease + 1;
    let cured = false;

    if (state.type === PoisonType.Poison) {
        // Poison: Decrease damage by 1 every 5 hits
        if (hitsSinceDecrease >= POISON_DECREASE_INTERVAL) {
            newDamage = damage - 1;
            hitsSinceDecrease = 0;
        }

        // Cure when damage reaches 0
        if (newDamage <= 0) {
            cured = true;
            return {
                damage,
                hitsplatStyle,
                stateUpdate: createPoisonState(),
                cured: true,
            };
        }
    } else if (state.type === PoisonType.Venom) {
        // Venom: Increase damage by 2 every hit, cap at 20
        newDamage = Math.min(MAX_VENOM_DAMAGE, damage + 2);
        hitsSinceDecrease = 0; // Not used for venom
    }

    const newState: PoisonState = {
        type: state.type,
        damage: newDamage,
        nextDamageTick:
            currentTick + (state.type === PoisonType.Venom ? VENOM_TICK_INTERVAL : POISON_TICK_INTERVAL),
        hitsSinceDecrease,
        immunityExpiryTick: state.immunityExpiryTick,
    };

    return {
        damage,
        hitsplatStyle,
        stateUpdate: newState,
        cured,
    };
}

// =============================================================================
// Cure Functions
// =============================================================================

/**
 * Cure result from using an antipoison/antivenom.
 */
export interface CureResult {
    cured: boolean;
    immunityTicks: number;
    newState: PoisonState;
    message?: string;
}

/**
 * Cure poison with antipoison potion.
 * Regular antipoison only cures poison, not venom.
 */
export function cureWithAntipoison(state: PoisonState, currentTick: number): CureResult {
    if (state.type === PoisonType.Venom) {
        // Antipoison can convert venom to poison but not cure it
        const newState: PoisonState = {
            type: PoisonType.Poison,
            damage: state.damage,
            nextDamageTick: state.nextDamageTick,
            hitsSinceDecrease: 0,
            immunityExpiryTick: currentTick + 150, // 90 seconds immunity
        };

        return {
            cured: false,
            immunityTicks: 150,
            newState,
            message: "The antipoison converts the venom to poison.",
        };
    }

    if (state.type === PoisonType.Poison) {
        // Cure poison completely
        return {
            cured: true,
            immunityTicks: 150, // 90 seconds
            newState: {
                ...createPoisonState(),
                immunityExpiryTick: currentTick + 150,
            },
        };
    }

    // Not poisoned
    return {
        cured: false,
        immunityTicks: 150,
        newState: {
            ...state,
            immunityExpiryTick: currentTick + 150,
        },
    };
}

/**
 * Cure poison with super antipoison.
 */
export function cureWithSuperAntipoison(state: PoisonState, currentTick: number): CureResult {
    // Same as regular but longer immunity
    const result = cureWithAntipoison(state, currentTick);
    const immunityTicks = 360; // 216 seconds (3.6 minutes)

    return {
        ...result,
        immunityTicks,
        newState: {
            ...result.newState,
            immunityExpiryTick: currentTick + immunityTicks,
        },
    };
}

/**
 * Cure poison with antidote+.
 */
export function cureWithAntidotePlus(state: PoisonState, currentTick: number): CureResult {
    const immunityTicks = 750; // 7.5 minutes

    if (state.type === PoisonType.Venom) {
        // Antidote+ converts venom to poison
        return {
            cured: false,
            immunityTicks,
            newState: {
                type: PoisonType.Poison,
                damage: state.damage,
                nextDamageTick: state.nextDamageTick,
                hitsSinceDecrease: 0,
                immunityExpiryTick: currentTick + immunityTicks,
            },
            message: "The antidote converts the venom to poison.",
        };
    }

    // Cure poison
    return {
        cured: state.type === PoisonType.Poison,
        immunityTicks,
        newState: {
            ...createPoisonState(),
            immunityExpiryTick: currentTick + immunityTicks,
        },
    };
}

/**
 * Cure poison with antidote++.
 */
export function cureWithAntidotePlusPlus(state: PoisonState, currentTick: number): CureResult {
    const immunityTicks = 900; // 9 minutes

    // Antidote++ cures both poison and venom
    return {
        cured: state.type !== PoisonType.None,
        immunityTicks,
        newState: {
            ...createPoisonState(),
            immunityExpiryTick: currentTick + immunityTicks,
        },
    };
}

/**
 * Cure venom with anti-venom.
 */
export function cureWithAntivenom(state: PoisonState, currentTick: number): CureResult {
    const immunityTicks = 180; // 108 seconds venom immunity

    // Anti-venom cures both poison and venom
    return {
        cured: state.type !== PoisonType.None,
        immunityTicks,
        newState: {
            ...createPoisonState(),
            immunityExpiryTick: currentTick + immunityTicks,
        },
    };
}

/**
 * Cure venom with anti-venom+.
 */
export function cureWithAntivenomPlus(state: PoisonState, currentTick: number): CureResult {
    const immunityTicks = 500; // 5 minutes venom immunity

    // Anti-venom+ cures both and grants longer immunity
    return {
        cured: state.type !== PoisonType.None,
        immunityTicks,
        newState: {
            ...createPoisonState(),
            immunityExpiryTick: currentTick + immunityTicks,
        },
    };
}

/**
 * Cure with Sanfew serum (cures poison, disease, and restores stats).
 */
export function cureWithSanfewSerum(state: PoisonState, currentTick: number): CureResult {
    // Sanfew acts as super antipoison for poison/venom
    return cureWithSuperAntipoison(state, currentTick);
}

// =============================================================================
// Equipment Immunity Checks
// =============================================================================

/**
 * Check if equipment grants poison immunity.
 */
export function hasPoisonImmunityEquipment(headSlotId: number): boolean {
    return [SERPENTINE_HELM, TANZANITE_HELM, MAGMA_HELM].includes(headSlotId);
}

/**
 * Check if equipment grants venom immunity.
 */
export function hasVenomImmunityEquipment(headSlotId: number): boolean {
    return [SERPENTINE_HELM, TANZANITE_HELM, MAGMA_HELM].includes(headSlotId);
}

// =============================================================================
// Weapon Poison Data
// =============================================================================

/**
 * Get poison damage for a poisoned weapon.
 * (p) weapons start at 4 damage
 * (p+) weapons start at 5 damage
 * (p++) weapons start at 6 damage
 */
export function getWeaponPoisonDamage(weaponId: number): number | undefined {
    // (p++) weapons - 6 starting damage
    const pppWeapons = [
        DRAGON_DAGGER_PP,
        ABYSSAL_DAGGER_PP,
        RUNE_DAGGER_PP,
        ADAMANT_DAGGER_PP,
        DRAGON_ARROW_PP,
    ];
    if (pppWeapons.includes(weaponId)) {
        return 6;
    }

    // (p+) weapons - 5 starting damage (not commonly used, mostly deprecated)

    // (p) weapons - 4 starting damage
    const pWeapons = [
        DRAGON_DAGGER_P,
        ABYSSAL_DAGGER_P,
        RUNE_DAGGER_P,
        ADAMANT_DAGGER_P,
        DRAGON_ARROW_P,
    ];
    if (pWeapons.includes(weaponId)) {
        return 4;
    }

    return undefined;
}

/**
 * Check if weapon applies venom.
 */
export function doesWeaponApplyVenom(weaponId: number): boolean {
    return weaponId === TOXIC_BLOWPIPE;
}

/**
 * Get the chance for a weapon to apply poison/venom on hit.
 * OSRS: 25% chance for poisoned weapons on successful hit
 */
export function getPoisonApplicationChance(_weaponId: number): number {
    return 0.25; // 25% chance
}

// =============================================================================
// NPC Poison Definitions
// =============================================================================

export interface NpcPoisonConfig {
    /** Poison damage this NPC applies on hit */
    poisonDamage?: number;
    /** Whether NPC applies venom */
    appliesVenom?: boolean;
    /** Whether NPC is immune to poison */
    poisonImmune?: boolean;
    /** Whether NPC is immune to venom */
    venomImmune?: boolean;
}

/**
 * Get NPC poison configuration.
 */
export function getNpcPoisonConfig(npcId: number): NpcPoisonConfig {
    // Known poisonous NPCs
    const poisonousNpcs: Record<number, NpcPoisonConfig> = {
        // Zulrah applies venom
        2042: { appliesVenom: true, poisonImmune: true, venomImmune: true },
        2043: { appliesVenom: true, poisonImmune: true, venomImmune: true },
        2044: { appliesVenom: true, poisonImmune: true, venomImmune: true },

        // Vorkath applies venom
        7937: { appliesVenom: true, poisonImmune: true, venomImmune: true },

        // King Black Dragon applies poison
        239: { poisonDamage: 8, poisonImmune: true },

        // K'ril Tsutsaroth applies poison
        3129: { poisonDamage: 16, poisonImmune: true },

        // Kalphite Queen
        963: { poisonImmune: true }, // Workers
        959: { poisonImmune: true }, // Soldiers
        960: { poisonImmune: true }, // Guardians

        // Cave horrors apply poison
        1047: { poisonDamage: 4 },

        // Scorpions apply poison
        3024: { poisonDamage: 2 },

        // Aberrant spectres - immune to poison
        2: { poisonImmune: true },
    };

    return poisonousNpcs[npcId] ?? {};
}

// =============================================================================

// =============================================================================

/**
 * Actor poison state storage (keyed by actor reference).
 * Note: In production, this should be stored on the Actor itself.
 */
const actorPoisonStates = new WeakMap<Actor, PoisonState>();

/**
 * Poison/Venom system class providing object-oriented interface.
 */
export class PoisonVenomSystem {
    /**
     * Get or create poison state for an actor.
     */
    private getState(actor: Actor): PoisonState {
        let state = actorPoisonStates.get(actor);
        if (!state) {
            state = createPoisonState();
            actorPoisonStates.set(actor, state);
        }
        return state;
    }

    /**
     * Apply poison to an actor.
     */
    applyPoison(actor: Actor, damage: number, currentTick: number = 0): void {
        const state = this.getState(actor);
        const result = applyPoison(state, damage, currentTick);
        actorPoisonStates.set(actor, result.stateUpdate);
    }

    /**
     * Apply venom to an actor.
     */
    applyVenom(actor: Actor, currentTick: number = 0): void {
        const state = this.getState(actor);
        const result = applyVenom(state, currentTick);
        actorPoisonStates.set(actor, result.stateUpdate);
    }

    /**
     * Cure poison on an actor.
     */
    curePoison(actor: Actor, currentTick: number = 0): void {
        const state = this.getState(actor);
        const result = cureWithAntipoison(state, currentTick);
        actorPoisonStates.set(actor, result.newState);
    }

    /**
     * Cure venom on an actor.
     */
    cureVenom(actor: Actor, currentTick: number = 0): void {
        const state = this.getState(actor);
        const result = cureWithAntivenom(state, currentTick);
        actorPoisonStates.set(actor, result.newState);
    }

    /**
     * Check if actor is poisoned.
     */
    isPoisoned(actor: Actor): boolean {
        const state = actorPoisonStates.get(actor);
        return state ? isPoisoned(state) : false;
    }

    /**
     * Check if actor is envenomed.
     */
    isEnvenomed(actor: Actor): boolean {
        const state = actorPoisonStates.get(actor);
        return state ? isEnvenomed(state) : false;
    }

    /**
     * Process tick (stub - actual tick processing is in NpcState/PlayerState).
     */
    processTick(_currentTick: number): void {
        // Tick processing happens in individual actor classes
        // This is a placeholder for compatibility
    }
}

// Singleton instance
export const poisonVenomSystem = new PoisonVenomSystem();
