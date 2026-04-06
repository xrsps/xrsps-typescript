import type { AttackType } from "../combat/AttackType";
import { type ChargeTracker, createChargeTracker } from "../combat/DegradationSystem";
import type { NpcState } from "../npc";

/**
 * Combat-related fields for a player. Composed into PlayerState to reduce
 * the size of the player class while keeping all combat data co-located.
 *
 * Methods that depend on Actor base class (freeze, movement lock, etc.)
 * remain on PlayerState as thin delegates.
 */
export class PlayerCombatState {
    autoRetaliate: boolean = true;
    weaponCategory: number = 0;
    weaponItemId: number = -1;
    /**
     * Attack reach in tiles derived from equipped weapon (ObjType param 13 when present).
     * some melee weapons (e.g. halberds) have reach > 1.
     */
    weaponRange: number = 0;
    styleSlot: number = 0;
    styleCategory?: number;
    spellId: number = -1;
    autocastEnabled: boolean = false;
    autocastMode: "autocast" | "defensive_autocast" | null = null;
    pendingAutocastDefensive?: boolean;
    pendingAutocastWeaponId?: number;
    lastSpellCastTick: number = Number.MIN_SAFE_INTEGER;
    pendingPlayerSpellDamage?: { targetId: number };

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
    /** Ticks remaining until player can attack again. */
    attackDelayTicks: number = 0;

    /** Last known wilderness level for change detection. */
    lastWildernessLevel: number = 0;
    /** Last known multi-combat state for change detection. */
    lastInMultiCombat: boolean = false;
    /** Last known PvP area state for change detection. */
    lastInPvPArea: boolean = false;
    /** Last known raid state for change detection. */
    lastInRaid: boolean = false;
    /** Last known LMS state for change detection. */
    lastInLMS: boolean = false;

    // WeakRef combat/interaction targets (RSMod parity)
    combatTargetFocus: WeakRef<NpcState | PlayerCombatTargetRef> | null = null;
    interactingNpc: WeakRef<NpcState> | null = null;
    interactingPlayer: WeakRef<PlayerCombatTargetRef> | null = null;
    lastHitBy: WeakRef<NpcState | PlayerCombatTargetRef> | null = null;
    lastHit: WeakRef<NpcState | PlayerCombatTargetRef> | null = null;

    // Combat style memory
    styleMemory: Map<number, number> = new Map();
    attackTypes?: AttackType[];
    meleeBonusIndices?: Array<number | undefined>;

    // Freeze/immunity
    freezeExpiryTick: number = 0;
    freezeImmunityUntilTick: number = 0;

    // Special attack energy
    specialEnergy: number = 1000; // SPECIAL_ENERGY_MAX
    nextSpecialRegenTick: number = 0;
    specialActivatedFlag: boolean = false;
    specialEnergyDirty: boolean = true;

    // Equipment degradation
    degradationCharges: ChargeTracker = createChargeTracker();
    degradationLastItemId: Map<number, number> = new Map();

    // Freeze query methods

    isFrozen(currentTick: number): boolean {
        if (this.freezeExpiryTick > 0 && currentTick >= this.freezeExpiryTick) {
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
        return Math.max(0, this.freezeExpiryTick - currentTick);
    }

    /**
     * Check freeze immunity and compute new expiry tick.
     * Returns the new expiry tick, or -1 if immune.
     * The caller (PlayerState) must apply Actor-level side effects.
     */
    tryApplyFreeze(durationTicks: number, currentTick: number): number {
        if (currentTick < this.freezeImmunityUntilTick) {
            return -1;
        }
        const expires = Math.max(this.freezeExpiryTick, currentTick + Math.max(1, durationTicks));
        this.freezeExpiryTick = expires;
        return expires;
    }
}

/**
 * Minimal interface for PlayerState when referenced as a combat target.
 * Avoids circular dependency between PlayerCombatState and PlayerState.
 */
export interface PlayerCombatTargetRef {
    readonly id: number;
    readonly isPlayer: boolean;
    readonly tileX: number;
    readonly tileY: number;
    readonly level: number;
}
