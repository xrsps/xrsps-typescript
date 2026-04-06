import type {
    CombinationRune,
    RuneDataProvider,
    RuneId,
    StaffSubstitution,
} from "../../../src/game/data/RuneDataProvider";

const RUNE_IDS: RuneId = {
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
    MIST: 4695,
    DUST: 4696,
    MUD: 4698,
    SMOKE: 4697,
    STEAM: 4694,
    LAVA: 4699,
};

const ALL_RUNE_ITEM_IDS: number[] = [...new Set(Object.values(RUNE_IDS))].sort(
    (left, right) => left - right,
);

const COMBINATION_RUNES: CombinationRune[] = [
    { itemId: RUNE_IDS.MIST, provides: [RUNE_IDS.AIR, RUNE_IDS.WATER] },
    { itemId: RUNE_IDS.DUST, provides: [RUNE_IDS.AIR, RUNE_IDS.EARTH] },
    { itemId: RUNE_IDS.MUD, provides: [RUNE_IDS.WATER, RUNE_IDS.EARTH] },
    { itemId: RUNE_IDS.SMOKE, provides: [RUNE_IDS.AIR, RUNE_IDS.FIRE] },
    { itemId: RUNE_IDS.STEAM, provides: [RUNE_IDS.WATER, RUNE_IDS.FIRE] },
    { itemId: RUNE_IDS.LAVA, provides: [RUNE_IDS.EARTH, RUNE_IDS.FIRE] },
];

const STAFF_SUBSTITUTIONS: StaffSubstitution[] = [
    // Air rune providers
    { itemIds: [1381, 1397, 1405], negatesRune: RUNE_IDS.AIR },
    { itemIds: [21198, 12000], negatesRune: RUNE_IDS.AIR },
    { itemIds: [21200], negatesRune: RUNE_IDS.AIR },
    { itemIds: [21202], negatesRune: RUNE_IDS.AIR },

    // Water rune providers
    { itemIds: [1383, 1399, 1407], negatesRune: RUNE_IDS.WATER },
    { itemIds: [6562, 6563], negatesRune: RUNE_IDS.WATER },
    { itemIds: [11787, 11998], negatesRune: RUNE_IDS.WATER },
    { itemIds: [21200], negatesRune: RUNE_IDS.WATER },
    { itemIds: [21006], negatesRune: RUNE_IDS.WATER },

    // Earth rune providers
    { itemIds: [1385, 1401], negatesRune: RUNE_IDS.EARTH },
    { itemIds: [6562, 6563], negatesRune: RUNE_IDS.EARTH },
    { itemIds: [11789], negatesRune: RUNE_IDS.EARTH },
    { itemIds: [21202], negatesRune: RUNE_IDS.EARTH },

    // Fire rune providers
    { itemIds: [1387, 1403, 1411], negatesRune: RUNE_IDS.FIRE },
    { itemIds: [21198, 12000], negatesRune: RUNE_IDS.FIRE },
    { itemIds: [11787, 11998], negatesRune: RUNE_IDS.FIRE },
    { itemIds: [11789], negatesRune: RUNE_IDS.FIRE },
];

const TOME_OF_FIRE_ID = 20714;
const TOME_OF_FIRE_EMPTY_ID = 20716;

export function createRuneDataProvider(): RuneDataProvider {
    return {
        getRuneIds(): RuneId {
            return RUNE_IDS;
        },

        getAllRuneItemIds(): number[] {
            return ALL_RUNE_ITEM_IDS;
        },

        getCombinationRunes(): CombinationRune[] {
            return COMBINATION_RUNES;
        },

        getStaffSubstitutions(): StaffSubstitution[] {
            return STAFF_SUBSTITUTIONS;
        },

        getTomeOfFireId(): number {
            return TOME_OF_FIRE_ID;
        },

        getTomeOfFireEmptyId(): number {
            return TOME_OF_FIRE_EMPTY_ID;
        },

        getStaffNegatedRunes(equippedItems: number[]): Set<number> {
            const negated = new Set<number>();
            const equippedSet = new Set(equippedItems.filter((id) => id > 0));

            for (const sub of STAFF_SUBSTITUTIONS) {
                for (const staffId of sub.itemIds) {
                    if (equippedSet.has(staffId)) {
                        negated.add(sub.negatesRune);
                    }
                }
            }

            if (equippedSet.has(TOME_OF_FIRE_ID)) {
                negated.add(RUNE_IDS.FIRE);
            }

            return negated;
        },

        getCombinationRuneSubstitutes(runeId: number): number[] {
            const substitutes: number[] = [];
            for (const combo of COMBINATION_RUNES) {
                if (combo.provides.includes(runeId)) {
                    substitutes.push(combo.itemId);
                }
            }
            return substitutes;
        },
    };
}
