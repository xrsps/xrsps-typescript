/**
 * Instant Utility Special Provider
 *
 * Core provider interface for instant utility specials (Rock Knocker, Fishstabber, Lumber Up).
 * Gamemodes register their implementations at startup.
 */

import type { PlayerState } from "../player";

export interface InstantUtilitySpecialResult {
    kind: "rock_knocker" | "fishstabber" | "lumber_up";
    seqId: number;
    soundId?: number;
}

export interface InstantUtilitySpecialProvider {
    getInstantUtilitySpecial(weaponId: number): InstantUtilitySpecialResult | undefined;
    applySpecialBoost(player: PlayerState, kind: InstantUtilitySpecialResult["kind"]): void;
    markHandledAtTick(player: Record<string, number | undefined> | null | undefined, tick: number): void;
    wasHandledAtTick(player: Record<string, number | undefined> | null | undefined, tick: number): boolean;
}

import { getProviderRegistry } from "../providers/ProviderRegistry";

export function registerInstantUtilitySpecialProvider(provider: InstantUtilitySpecialProvider): void {
    getProviderRegistry().instantUtilitySpecial = provider;
}

export function getInstantUtilitySpecial(weaponId: number): InstantUtilitySpecialResult | undefined {
    return getProviderRegistry().instantUtilitySpecial?.getInstantUtilitySpecial(weaponId);
}

export function applyInstantUtilitySpecialBoost(
    player: PlayerState,
    kind: InstantUtilitySpecialResult["kind"],
): void {
    getProviderRegistry().instantUtilitySpecial?.applySpecialBoost(player, kind);
}

export function markInstantUtilitySpecialHandledAtTick(
    player: Record<string, number | undefined> | null | undefined,
    tick: number,
): void {
    getProviderRegistry().instantUtilitySpecial?.markHandledAtTick(player, tick);
}

export function wasInstantUtilitySpecialHandledAtTick(
    player: Record<string, number | undefined> | null | undefined,
    tick: number,
): boolean {
    return getProviderRegistry().instantUtilitySpecial?.wasHandledAtTick(player, tick) ?? false;
}
