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

export type CombinationRune = {
    itemId: number;
    provides: number[]; // Rune IDs this combination rune can substitute
};

export type StaffSubstitution = {
    itemIds: number[]; // Staff/weapon item IDs
    negatesRune: number; // Rune ID that is negated when wielding this staff
};

export interface RuneDataProvider {
    getRuneIds(): RuneId;
    getAllRuneItemIds(): number[];
    getCombinationRunes(): CombinationRune[];
    getStaffSubstitutions(): StaffSubstitution[];
    getTomeOfFireId(): number;
    getTomeOfFireEmptyId(): number;
    getStaffNegatedRunes(equippedItems: number[]): Set<number>;
    getCombinationRuneSubstitutes(runeId: number): number[];
}
