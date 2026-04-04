// Rune item IDs and staff equipment data for spell casting

export type RuneId = {
    AIR: number;
    WATER: number;
    EARTH: number;
    FIRE: number;
    MIND: number;
    CHAOS: number;
    DEATH: number;
    BLOOD: number;
    NATURE: number;
    LAW: number;
    COSMIC: number;
    BODY: number;
    SOUL: number;
    ASTRAL: number;
    WRATH: number;
    // Combination runes
    MIST: number;
    DUST: number;
    MUD: number;
    SMOKE: number;
    STEAM: number;
    LAVA: number;
};

export const RUNE_IDS: RuneId = {
    AIR: 556,
    WATER: 555,
    EARTH: 557,
    FIRE: 554,
    MIND: 558,
    CHAOS: 562,
    DEATH: 560,
    BLOOD: 565,
    NATURE: 561,
    LAW: 563,
    COSMIC: 564,
    BODY: 559,
    SOUL: 566,
    ASTRAL: 9075,
    WRATH: 21880,
    // Combination runes
    MIST: 4695, // Air + Water
    DUST: 4696, // Air + Earth
    MUD: 4698, // Water + Earth
    SMOKE: 4697, // Air + Fire
    STEAM: 4694, // Water + Fire
    LAVA: 4699, // Earth + Fire
};

export const ALL_RUNE_ITEM_IDS: number[] = [...new Set(Object.values(RUNE_IDS))].sort(
    (left, right) => left - right,
);

export type CombinationRune = {
    itemId: number;
    provides: number[]; // Rune IDs this combination rune can substitute
};

export const COMBINATION_RUNES: CombinationRune[] = [
    { itemId: RUNE_IDS.MIST, provides: [RUNE_IDS.AIR, RUNE_IDS.WATER] },
    { itemId: RUNE_IDS.DUST, provides: [RUNE_IDS.AIR, RUNE_IDS.EARTH] },
    { itemId: RUNE_IDS.MUD, provides: [RUNE_IDS.WATER, RUNE_IDS.EARTH] },
    { itemId: RUNE_IDS.SMOKE, provides: [RUNE_IDS.AIR, RUNE_IDS.FIRE] },
    { itemId: RUNE_IDS.STEAM, provides: [RUNE_IDS.WATER, RUNE_IDS.FIRE] },
    { itemId: RUNE_IDS.LAVA, provides: [RUNE_IDS.EARTH, RUNE_IDS.FIRE] },
];

export type StaffSubstitution = {
    itemIds: number[]; // Staff/weapon item IDs
    negatesRune: number; // Rune ID that is negated when wielding this staff
};

// Elemental staves that negate rune costs
export const STAFF_SUBSTITUTIONS: StaffSubstitution[] = [
    // Air staves
    { itemIds: [1381, 1397, 1405, 3053, 11736, 11738, 21777, 21793], negatesRune: RUNE_IDS.AIR },
    // Water staves
    { itemIds: [1383, 1395, 1403, 6562, 6563, 22296, 22305], negatesRune: RUNE_IDS.WATER },
    // Earth staves
    { itemIds: [1385, 1399, 1407, 3054, 6562, 22289, 22298], negatesRune: RUNE_IDS.EARTH },
    // Fire staves
    {
        itemIds: [1387, 1393, 1401, 3055, 6563, 20736, 22280, 22299, 22292],
        negatesRune: RUNE_IDS.FIRE,
    },
    // Lava battlestaff (negates both earth and fire)
    { itemIds: [21198, 22294], negatesRune: RUNE_IDS.FIRE },
    { itemIds: [21198, 22294], negatesRune: RUNE_IDS.EARTH },
    // Mud battlestaff (negates both water and earth)
    { itemIds: [6562], negatesRune: RUNE_IDS.WATER },
    { itemIds: [6562], negatesRune: RUNE_IDS.EARTH },
    // Steam battlestaff (negates both water and fire)
    { itemIds: [6563], negatesRune: RUNE_IDS.WATER },
    { itemIds: [6563], negatesRune: RUNE_IDS.FIRE },
];

// Tome of fire provides infinite fire runes
export const TOME_OF_FIRE_ID = 20714;
export const TOME_OF_FIRE_EMPTY_ID = 20716;

// Helper function to check if a player has a staff equipped that negates a specific rune
export function getStaffNegatedRunes(equippedItems: number[]): Set<number> {
    const negated = new Set<number>();
    const equippedSet = new Set(equippedItems.filter((id) => id > 0));

    for (const sub of STAFF_SUBSTITUTIONS) {
        for (const staffId of sub.itemIds) {
            if (equippedSet.has(staffId)) {
                negated.add(sub.negatesRune);
            }
        }
    }

    // Check for tome of fire in shield slot or inventory
    if (equippedSet.has(TOME_OF_FIRE_ID)) {
        negated.add(RUNE_IDS.FIRE);
    }

    return negated;
}

// Check if a rune requirement can be satisfied by combination runes
export function getCombinationRuneSubstitutes(runeId: number): number[] {
    const substitutes: number[] = [];
    for (const combo of COMBINATION_RUNES) {
        if (combo.provides.includes(runeId)) {
            substitutes.push(combo.itemId);
        }
    }
    return substitutes;
}
