export type CombatStyleSlot = 0 | 1 | 2 | 3;

export interface CombatStyleSequenceProvider {
    getMeleeAttackSequenceForCategory(
        weaponCategory: number | undefined,
        styleSlot: number | undefined,
    ): number | undefined;
}

// =============================================================================
// Provider Registration & Delegation
// =============================================================================

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
