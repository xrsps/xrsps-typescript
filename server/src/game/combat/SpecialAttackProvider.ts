import type { AttackType } from "./AttackType";

// =============================================================================
// Types
// =============================================================================

export interface SpecialAttackEffect {
    freezeTicks?: number;
    stunTicks?: number;
    healFraction?: number;
    prayerFraction?: number;
    drainDefence?: number;
    drainDefenceByDamage?: number;
    drainMagicByDamage?: boolean;
    drainAttack?: number;
    drainStrength?: number;
    drainRanged?: number;
    drainAllCombatByDamage?: boolean;
    drainRunEnergy?: number;
    applyPoison?: number;
    applyVenom?: boolean;
    guaranteedFirstHit?: boolean;
    doubleHit?: boolean;
    quadHit?: boolean;
    rangeBoost?: number;
    drainPrayerByDamage?: boolean;
    teleportBehind?: boolean;
    ignoreProtectionPrayer?: boolean;
}

export interface SpecialAttackDef {
    weaponIds: number[];
    energyCost: number;
    accuracyMultiplier: number;
    damageMultiplier: number;
    hitCount: number;
    attackType?: AttackType;
    effects?: SpecialAttackEffect;
    animationId?: number;
    graphicId?: number;
    targetGraphicId?: number;
    projectileId?: number;
    soundId?: number;
    hitSounds?: number[];
    name: string;
    minDamagePerHit?: number;
    maxDamagePerHit?: number;
    ammoModifiers?: {
        [ammoId: number]: {
            damageMultiplier: number;
            minDamagePerHit: number;
            maxDamagePerHit?: number;
            graphicId?: number;
            projectileId?: number;
            soundId?: number;
            name?: string;
        };
        default?: {
            damageMultiplier: number;
            minDamagePerHit: number;
            maxDamagePerHit?: number;
            graphicId?: number;
            projectileId?: number;
            soundId?: number;
            name?: string;
        };
    };
}

export interface SpecialAttackContext {
    attackerId: number;
    targetId: number;
    targetType: "npc" | "player";
    baseDamage: number;
    baseAccuracy: number;
    tick: number;
}

export interface SpecialAttackResult {
    totalDamage: number;
    hits: Array<{
        damage: number;
        delay: number;
        hitsplatStyle: number;
    }>;
    effects: SpecialAttackEffect;
    animationId?: number;
    graphicId?: number;
    targetGraphicId?: number;
    energyUsed: number;
}

// =============================================================================
// Provider Interface
// =============================================================================

export interface SpecialAttackProvider {
    get(weaponId: number): SpecialAttackDef | undefined;
    has(weaponId: number): boolean;
    getEnergyCost(weaponId: number): number;
    resolveAmmoModifiers(
        specialDef: SpecialAttackDef,
        ammoId: number,
    ): {
        damageMultiplier: number;
        minDamagePerHit: number;
        maxDamagePerHit?: number;
        graphicId?: number;
        projectileId?: number;
        soundId?: number;
        name: string;
    };
    applyDarkBowDamageModifiers(
        damage: number,
        minDamage: number,
        maxDamage: number | undefined,
        hitLanded: boolean,
    ): number;
    isDarkBow(weaponId: number): boolean;
    calculateDragonClawsHits(maxHit: number, hitRolls: number[]): number[];
    canGraniteMaulCombo(
        weaponId: number,
        lastAttackTick: number,
        currentTick: number,
    ): boolean;
}
