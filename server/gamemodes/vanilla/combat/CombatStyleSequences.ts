import type {
    CombatStyleSequenceProvider,
    CombatStyleSlot,
} from "../../../src/game/combat/CombatStyleSequenceProvider";

function getMeleeAttackSequenceForCategory(
    weaponCategory: number | undefined,
    styleSlot: number | undefined,
): number | undefined {
    const category = weaponCategory ?? -1;
    const slot = Math.max(0, Math.min(styleSlot ?? 0, 3)) as CombatStyleSlot;

    // Unarmed: punch / kick / block.
    if (category === 0) {
        if (slot === 0) return 422;
        if (slot === 1) return 423;
        if (slot === 2) return 424;
        return 422;
    }

    // Staff (including elemental/battlestaves): OSRS uses one melee swing regardless of style slot.
    if (category === 18) return 393;

    return undefined;
}

export function createCombatStyleSequenceProvider(): CombatStyleSequenceProvider {
    return {
        getMeleeAttackSequenceForCategory,
    };
}
