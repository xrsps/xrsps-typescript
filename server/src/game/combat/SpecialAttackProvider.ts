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

// =============================================================================
// Provider Registration & Delegation
// =============================================================================

let _provider: SpecialAttackProvider | undefined;

export function registerSpecialAttackProvider(provider: SpecialAttackProvider): void {
    _provider = provider;
}

export function getSpecialAttackProvider(): SpecialAttackProvider | undefined {
    return _provider;
}

function ensureProvider(): SpecialAttackProvider {
    if (!_provider) {
        throw new Error("[SpecialAttackRegistry] SpecialAttackProvider not registered. Ensure the gamemode has initialized.");
    }
    return _provider;
}

export const SpecialAttackRegistry = {
    get(weaponId: number) {
        return ensureProvider().get(weaponId);
    },
    has(weaponId: number) {
        return ensureProvider().has(weaponId);
    },
    getEnergyCost(weaponId: number) {
        return ensureProvider().getEnergyCost(weaponId);
    },
};

export function getSpecialAttack(weaponId: number) {
    return ensureProvider().get(weaponId);
}

export function canUseSpecialAttack(weaponId: number, currentEnergy: number): boolean {
    const spec = ensureProvider().get(weaponId);
    if (!spec) return false;
    return currentEnergy >= spec.energyCost;
}

export function consumeSpecialEnergy(weaponId: number, currentEnergy: number): number {
    const cost = ensureProvider().getEnergyCost(weaponId);
    return Math.max(0, currentEnergy - cost);
}

export function restoreSpecialEnergy(currentEnergy: number, amount: number): number {
    return Math.min(100, currentEnergy + amount);
}

export function resolveAmmoModifiers(specialDef: SpecialAttackDef, ammoId: number) {
    return ensureProvider().resolveAmmoModifiers(specialDef, ammoId);
}

export function applyDarkBowDamageModifiers(
    damage: number,
    minDamage: number,
    maxDamage: number | undefined,
    hitLanded: boolean,
): number {
    return ensureProvider().applyDarkBowDamageModifiers(damage, minDamage, maxDamage, hitLanded);
}

export function isDarkBow(weaponId: number): boolean {
    return ensureProvider().isDarkBow(weaponId);
}

export function calculateDragonClawsHits(maxHit: number, hitRolls: number[]): number[] {
    return ensureProvider().calculateDragonClawsHits(maxHit, hitRolls);
}

export function canGraniteMaulCombo(
    weaponId: number,
    lastAttackTick: number,
    currentTick: number,
): boolean {
    return ensureProvider().canGraniteMaulCombo(weaponId, lastAttackTick, currentTick);
}
