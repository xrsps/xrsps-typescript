// Flax loc ids sourced from RuneLite ObjectID constants (14896, 15075-15079)
// plus legacy cache id 2646 referenced in references/zaros-server/data/objectSize.cfg.

export const FLAX_ITEM_ID = 1779;
export const FLAX_PICK_XP = 1;
export const FLAX_PICK_ANIMATION_ID = 827;
export const FLAX_PICK_DELAY_TICKS = 3;
export const FLAX_RESPAWN_TICKS = 25;

export const FLAX_LOC_IDS = [
    2646, // Flax (legacy seers field)
    14896, // FLAX
    14909, // DEADMAN_FLAX
    15075, // MISC_FLAX_HEAVYWEEDS
    15076, // MISC_FLAX_MEDWEEDS
    15077, // MISC_FLAX_LIGHTWEEDS
    15078, // MISC_FLAX_NOWEEDS
    15079, // MISC_FLAX_MULTILOC
] as const;

const FLAX_LOC_ID_SET = new Set<number>(FLAX_LOC_IDS.map((id) => id));

export const isFlaxLocId = (locId: number): boolean => FLAX_LOC_ID_SET.has(locId);
