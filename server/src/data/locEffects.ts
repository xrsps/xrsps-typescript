import { LocTypeLoader } from "../../../src/rs/config/loctype/LocTypeLoader";

export type LocSpotEffect = {
    spotId: number;
    height?: number;
    delayTicks?: number;
};

export type LocSoundEffect = {
    soundId: number;
    loops?: number;
    delayMs?: number;
};

export type LocEffectDefinition = {
    graphic?: LocSpotEffect;
    sound?: LocSoundEffect;
};

export const ALTAR_LOC_IDS: readonly number[] = [
    409, 410, 411, 3521, 4090, 4091, 4092, 6552, 13179, 13180, 13181, 13182, 13183, 13184, 13185,
    13186, 13187, 13188, 13189, 13190, 13191, 13192, 13193, 13194, 13195, 13196, 13197, 13198,
    13199, 14860, 15050, 15051, 15270, 18258, 20377, 20378, 20379, 21893, 26363, 26364, 26366,
    28455, 28922, 29140, 29147, 29148, 29149, 29631, 29941, 31624, 31858, 31859, 31860, 31861,
    32508, 32630, 33523, 33524,
];

const LOC_EFFECTS = new Map<number, LocEffectDefinition>();

export const registerLocEffect = (
    locId: number,
    definition: LocEffectDefinition,
    opts: { replaceExisting?: boolean } = {},
): (() => void) => {
    const key = locId;
    if (!opts.replaceExisting && LOC_EFFECTS.has(key)) {
        return () => {};
    }
    LOC_EFFECTS.set(key, definition);
    return () => {
        const current = LOC_EFFECTS.get(key);
        if (current === definition) {
            LOC_EFFECTS.delete(key);
        }
    };
};

export const registerLocEffects = (
    entries: Iterable<{ locId: number; effect: LocEffectDefinition }>,
    opts: { replaceExisting?: boolean } = {},
): (() => void) => {
    const disposers: Array<() => void> = [];
    for (const entry of entries) {
        disposers.push(registerLocEffect(entry.locId, entry.effect, opts));
    }
    return () => {
        for (const dispose of disposers.reverse()) {
            try {
                dispose();
            } catch (err) { console.log("[loc-effects] failed to dispose loc effect", err); }
        }
    };
};

export const unregisterLocEffect = (locId: number): void => {
    LOC_EFFECTS.delete(locId);
};

export const getLocEffect = (locId: number): LocEffectDefinition | undefined => {
    return LOC_EFFECTS.get(locId);
};

const deriveEffectFromLoc = (loc: any): LocEffectDefinition | undefined => {
    if (!loc) return undefined;
    let soundId = loc.ambientSoundId ?? -1;
    if (!(soundId >= 0)) {
        const list: number[] | undefined = loc.ambientSoundIds;
        if (Array.isArray(list)) {
            soundId = list.find((id) => id >= 0) ?? -1;
        }
    }
    if (!(soundId >= 0)) return undefined;
    return {
        sound: {
            soundId,
        },
    };
};

export const populateLocEffectsFromLoader = (
    loader: LocTypeLoader,
    opts: { replaceExisting?: boolean } = {},
): number => {
    if (!loader) return 0;
    let registered = 0;
    const count = loader.getCount();
    for (let id = 0; id < count; id++) {
        let loc: any;
        try {
            loc = loader.load(id);
        } catch {
            continue;
        }
        if (!loc) continue;
        const effect = deriveEffectFromLoc(loc);
        if (!effect) continue;
        const key = loc.id ?? id;
        if (!opts.replaceExisting && LOC_EFFECTS.has(key)) continue;
        LOC_EFFECTS.set(key, effect);
        registered++;
    }
    return registered;
};

const ALTAR_EFFECT: LocEffectDefinition = {
    graphic: { spotId: 624 },
    sound: { soundId: 2395 },
};

registerLocEffects(ALTAR_LOC_IDS.map((locId) => ({ locId, effect: ALTAR_EFFECT })));

export const isAltarLoc = (locId: number): boolean => LOC_EFFECTS.get(locId) === ALTAR_EFFECT;
