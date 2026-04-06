/**
 * Bridge module: delegates all rune data access to the registered RuneDataProvider.
 * The actual rune data definitions live in server/gamemodes/vanilla/data/runes.ts.
 * The vanilla gamemode registers the provider during initialization.
 */
export type {
    RuneId,
    CombinationRune,
    StaffSubstitution,
    RuneDataProvider,
} from "../game/data/RuneDataProvider";

let _provider: import("../game/data/RuneDataProvider").RuneDataProvider | undefined;

export function registerRuneDataProvider(
    provider: import("../game/data/RuneDataProvider").RuneDataProvider,
): void {
    _provider = provider;
}

export function getRuneDataProvider():
    | import("../game/data/RuneDataProvider").RuneDataProvider
    | undefined {
    return _provider;
}

function ensureProvider(): import("../game/data/RuneDataProvider").RuneDataProvider {
    if (!_provider) {
        throw new Error(
            "[runes] RuneDataProvider not registered. Ensure the gamemode has initialized.",
        );
    }
    return _provider;
}

/** Rune item IDs constant. Delegates to provider. */
export const RUNE_IDS: import("../game/data/RuneDataProvider").RuneId = new Proxy(
    {} as import("../game/data/RuneDataProvider").RuneId,
    {
        get(_target, prop) {
            return ensureProvider().getRuneIds()[prop as keyof import("../game/data/RuneDataProvider").RuneId];
        },
    },
);

/** All rune item IDs array. Delegates to provider. */
export const ALL_RUNE_ITEM_IDS: number[] = new Proxy([] as number[], {
    get(target, prop, receiver) {
        if (_provider) {
            const ids = _provider.getAllRuneItemIds();
            if (prop === "length") return ids.length;
            if (prop === Symbol.iterator) return ids[Symbol.iterator].bind(ids);
            if (typeof prop === "string" && !isNaN(Number(prop))) {
                return ids[Number(prop)];
            }
            return Reflect.get(ids as any, prop, receiver);
        }
        return Reflect.get(target, prop, receiver);
    },
});

export const COMBINATION_RUNES: import("../game/data/RuneDataProvider").CombinationRune[] = new Proxy(
    [] as import("../game/data/RuneDataProvider").CombinationRune[],
    {
        get(target, prop, receiver) {
            if (_provider) {
                const runes = _provider.getCombinationRunes();
                if (prop === "length") return runes.length;
                if (prop === Symbol.iterator) return runes[Symbol.iterator].bind(runes);
                if (typeof prop === "string" && !isNaN(Number(prop))) {
                    return runes[Number(prop)];
                }
                return Reflect.get(runes as any, prop, receiver);
            }
            return Reflect.get(target, prop, receiver);
        },
    },
);

export const STAFF_SUBSTITUTIONS: import("../game/data/RuneDataProvider").StaffSubstitution[] = new Proxy(
    [] as import("../game/data/RuneDataProvider").StaffSubstitution[],
    {
        get(target, prop, receiver) {
            if (_provider) {
                const subs = _provider.getStaffSubstitutions();
                if (prop === "length") return subs.length;
                if (prop === Symbol.iterator) return subs[Symbol.iterator].bind(subs);
                if (typeof prop === "string" && !isNaN(Number(prop))) {
                    return subs[Number(prop)];
                }
                return Reflect.get(subs as any, prop, receiver);
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
