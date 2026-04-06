export const BURIABLE_BONES_XP: ReadonlyMap<number, number> = new Map<number, number>([
    [526, 5], // Bones
    [530, 6], // Bat bones
    [2859, 6], // Wolf bones
    [532, 15], // Big bones
    [534, 30], // Babydragon bones
    [3125, 15], // Jogre bones
    [4812, 23], // Zogre bones
    [10976, 15], // Long bone
    [10977, 15], // Curved bone
    [3123, 25], // Shaikahan bones
    [536, 72], // Dragon bones
    [4830, 84], // Fayrg bones
    [4832, 96], // Raurg bones
    [4834, 140], // Ourg bones (common id)
    [14793, 140], // Ourg bones (variant)
    [6729, 125], // Dagannoth bones
    [6812, 72], // Wyvern bones
    [6816, 72], // Wyvern bones (variant)
    [11943, 85], // Lava dragon bones
]);

export const BURIABLE_BONE_IDS: readonly number[] = Array.from(BURIABLE_BONES_XP.keys());

export const DEMONIC_ASHES_XP: ReadonlyMap<number, number> = new Map<number, number>([
    [25766, 10], // Fiendish ashes
    [25769, 25], // Vile ashes
    [25772, 65], // Malicious ashes
    [25775, 85], // Abyssal ashes
    [25778, 110], // Infernal ashes
]);

export const DEMONIC_ASHES_IDS: readonly number[] = Array.from(DEMONIC_ASHES_XP.keys());
