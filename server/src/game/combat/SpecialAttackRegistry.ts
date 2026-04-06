/**
 * Bridge module: delegates all special attack access to the registered SpecialAttackProvider.
 * The actual special attack definitions live in server/gamemodes/vanilla/combat/SpecialAttackRegistry.ts.
 * The vanilla gamemode registers the provider during initialization.
 */
import type {
    SpecialAttackProvider,
} from "./SpecialAttackProvider";

export type {
    SpecialAttackEffect,
    SpecialAttackDef,
    SpecialAttackContext,
    SpecialAttackResult,
    SpecialAttackProvider,
} from "./SpecialAttackProvider";

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

// =============================================================================
// Singleton-like bridge object for consumers that import SpecialAttackRegistry
// =============================================================================

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

// =============================================================================
// Convenience Functions
// =============================================================================

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

export function resolveAmmoModifiers(
    specialDef: import("./SpecialAttackProvider").SpecialAttackDef,
    ammoId: number,
) {
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
