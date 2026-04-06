/**
 * Bridge module: delegates melee attack sequence lookups to the registered CombatStyleSequenceProvider.
 * The actual sequence definitions live in server/gamemodes/vanilla/combat/CombatStyleSequences.ts.
 * The vanilla gamemode registers the provider during initialization.
 */
import type { CombatStyleSequenceProvider } from "./CombatStyleSequenceProvider";

export type { CombatStyleSlot, CombatStyleSequenceProvider } from "./CombatStyleSequenceProvider";

let _provider: CombatStyleSequenceProvider | undefined;

export function registerCombatStyleSequenceProvider(provider: CombatStyleSequenceProvider): void {
    _provider = provider;
}

export function getCombatStyleSequenceProvider(): CombatStyleSequenceProvider | undefined {
    return _provider;
}

function ensureProvider(): CombatStyleSequenceProvider {
    if (!_provider) {
        throw new Error("[CombatStyleSequences] CombatStyleSequenceProvider not registered. Ensure the gamemode has initialized.");
    }
    return _provider;
}

export function getMeleeAttackSequenceForCategory(
    weaponCategory: number | undefined,
    styleSlot: number | undefined,
): number | undefined {
    return ensureProvider().getMeleeAttackSequenceForCategory(weaponCategory, styleSlot);
}
