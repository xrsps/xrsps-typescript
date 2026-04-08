/**
 * Special Attack Visual Override Provider
 *
 * Core provider interface for special attack visual overrides.
 * Gamemodes register their visual override data at startup.
 */

export interface SpecialAttackVisualOverride {
    seqId?: number;
    spotId?: number;
    spotHeight?: number;
}

export interface SpecialAttackVisualProvider {
    pickSpecialAttackVisualOverride(weaponItemId: number): SpecialAttackVisualOverride | undefined;
}

import { getProviderRegistry } from "../providers/ProviderRegistry";

export function registerSpecialAttackVisualProvider(provider: SpecialAttackVisualProvider): void {
    getProviderRegistry().specialAttackVisual = provider;
}

export function pickSpecialAttackVisualOverride(
    weaponItemId: number,
): SpecialAttackVisualOverride | undefined {
    return getProviderRegistry().specialAttackVisual?.pickSpecialAttackVisualOverride(weaponItemId);
}
