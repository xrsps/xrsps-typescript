export type CombatStyleSlot = 0 | 1 | 2 | 3;

export interface CombatStyleSequenceProvider {
    getMeleeAttackSequenceForCategory(
        weaponCategory: number | undefined,
        styleSlot: number | undefined,
    ): number | undefined;
}
