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

// Staves and equipment that negate rune costs (OSRS parity).
// Each entry lists weapon item IDs that provide unlimited runes of a given type.
export const STAFF_SUBSTITUTIONS: StaffSubstitution[] = [
    // ---- Air rune providers ----
    // Staff of air (1381), Air battlestaff (1397), Mystic air staff (1405)
    { itemIds: [1381, 1397, 1405], negatesRune: RUNE_IDS.AIR },
    // Smoke battlestaff (21198), Mystic smoke staff (12000) — Air + Fire
    { itemIds: [21198, 12000], negatesRune: RUNE_IDS.AIR },
    // Mist battlestaff (21200) — Air + Water
    { itemIds: [21200], negatesRune: RUNE_IDS.AIR },
    // Dust battlestaff (21202) — Air + Earth
    { itemIds: [21202], negatesRune: RUNE_IDS.AIR },

    // ---- Water rune providers ----
    // Staff of water (1383), Water battlestaff (1399), Mystic water staff (1407)
    { itemIds: [1383, 1399, 1407], negatesRune: RUNE_IDS.WATER },
    // Mud battlestaff (6562), Mystic mud staff (6563) — Water + Earth
    { itemIds: [6562, 6563], negatesRune: RUNE_IDS.WATER },
    // Steam battlestaff (11787), Mystic steam staff (11998) — Water + Fire
    { itemIds: [11787, 11998], negatesRune: RUNE_IDS.WATER },
    // Mist battlestaff (21200) — Air + Water
    { itemIds: [21200], negatesRune: RUNE_IDS.WATER },
    // Kodai wand (21006)
    { itemIds: [21006], negatesRune: RUNE_IDS.WATER },

    // ---- Earth rune providers ----
    // Staff of earth (1385), Earth battlestaff (1401)
    { itemIds: [1385, 1401], negatesRune: RUNE_IDS.EARTH },
    // Mud battlestaff (6562), Mystic mud staff (6563) — Water + Earth
    { itemIds: [6562, 6563], negatesRune: RUNE_IDS.EARTH },
    // Lava battlestaff (11789) — Earth + Fire
    { itemIds: [11789], negatesRune: RUNE_IDS.EARTH },
    // Dust battlestaff (21202) — Air + Earth
    { itemIds: [21202], negatesRune: RUNE_IDS.EARTH },

    // ---- Fire rune providers ----
    // Staff of fire (1387), Fire battlestaff (1403), Mystic fire staff (1411)
    { itemIds: [1387, 1403, 1411], negatesRune: RUNE_IDS.FIRE },
    // Smoke battlestaff (21198), Mystic smoke staff (12000) — Air + Fire
    { itemIds: [21198, 12000], negatesRune: RUNE_IDS.FIRE },
    // Steam battlestaff (11787), Mystic steam staff (11998) — Water + Fire
    { itemIds: [11787, 11998], negatesRune: RUNE_IDS.FIRE },
    // Lava battlestaff (11789) — Earth + Fire
    { itemIds: [11789], negatesRune: RUNE_IDS.FIRE },
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
