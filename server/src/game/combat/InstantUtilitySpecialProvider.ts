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

let activeProvider: InstantUtilitySpecialProvider | undefined;

export function registerInstantUtilitySpecialProvider(provider: InstantUtilitySpecialProvider): void {
    activeProvider = provider;
}

export function getInstantUtilitySpecial(weaponId: number): InstantUtilitySpecialResult | undefined {
    return activeProvider?.getInstantUtilitySpecial(weaponId);
}

export function applyInstantUtilitySpecialBoost(
    player: PlayerState,
    kind: InstantUtilitySpecialResult["kind"],
): void {
    activeProvider?.applySpecialBoost(player, kind);
}

export function markInstantUtilitySpecialHandledAtTick(
    player: Record<string, number | undefined> | null | undefined,
    tick: number,
): void {
    activeProvider?.markHandledAtTick(player, tick);
}

export function wasInstantUtilitySpecialHandledAtTick(
    player: Record<string, number | undefined> | null | undefined,
    tick: number,
): boolean {
    return activeProvider?.wasHandledAtTick(player, tick) ?? false;
}
