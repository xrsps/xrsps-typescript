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

// =============================================================================
// Provider Registration & Delegation
// =============================================================================

import { getProviderRegistry } from "../providers/ProviderRegistry";

export function registerRuneDataProvider(provider: RuneDataProvider): void {
    getProviderRegistry().runeData = provider;
}

export function getRuneDataProvider(): RuneDataProvider | undefined {
    return getProviderRegistry().runeData;
}

function ensureProvider(): RuneDataProvider {
    const p = getProviderRegistry().runeData;
    if (!p) {
        throw new Error("[runes] RuneDataProvider not registered. Ensure the gamemode has initialized.");
    }
    return p;
}

export const RUNE_IDS: RuneId = new Proxy(
    {} as RuneId,
    {
        get(_target, prop) {
            return ensureProvider().getRuneIds()[prop as keyof RuneId];
        },
    },
);

export const ALL_RUNE_ITEM_IDS: number[] = new Proxy([] as number[], {
    get(target, prop, receiver) {
        if (_provider) {
            const ids = _provider.getAllRuneItemIds();
            if (prop === "length") return ids.length;
            if (prop === Symbol.iterator) return ids[Symbol.iterator].bind(ids);
            if (typeof prop === "string" && !isNaN(Number(prop))) {
                return ids[Number(prop)];
            }
            return Reflect.get(ids as object, prop, receiver);
        }
        return Reflect.get(target, prop, receiver);
    },
});

export const COMBINATION_RUNES: CombinationRune[] = new Proxy(
    [] as CombinationRune[],
    {
        get(target, prop, receiver) {
            if (_provider) {
                const runes = _provider.getCombinationRunes();
                if (prop === "length") return runes.length;
                if (prop === Symbol.iterator) return runes[Symbol.iterator].bind(runes);
                if (typeof prop === "string" && !isNaN(Number(prop))) {
                    return runes[Number(prop)];
                }
                return Reflect.get(runes as object, prop, receiver);
            }
            return Reflect.get(target, prop, receiver);
        },
    },
);

export const STAFF_SUBSTITUTIONS: StaffSubstitution[] = new Proxy(
    [] as StaffSubstitution[],
    {
        get(target, prop, receiver) {
            if (_provider) {
                const subs = _provider.getStaffSubstitutions();
                if (prop === "length") return subs.length;
                if (prop === Symbol.iterator) return subs[Symbol.iterator].bind(subs);
                if (typeof prop === "string" && !isNaN(Number(prop))) {
                    return subs[Number(prop)];
                }
                return Reflect.get(subs as object, prop, receiver);
            }
            return Reflect.get(target, prop, receiver);
        },
    },
);

export const TOME_OF_FIRE_ID = 20714;
export const TOME_OF_FIRE_EMPTY_ID = 20716;

export function getStaffNegatedRunes(equippedItems: number[]): Set<number> {
    return ensureProvider().getStaffNegatedRunes(equippedItems);
}

export function getCombinationRuneSubstitutes(runeId: number): number[] {
    return ensureProvider().getCombinationRuneSubstitutes(runeId);
}
