// Crafting XP/level values sourced from
// references/runelite/runelite-client/src/main/java/net/runelite/client/plugins/skillcalculator/skills/CraftingAction.java
// Spinning wheel object ids sourced from
// references/runelite/runelite-api/src/main/java/net/runelite/api/gameval/ObjectID.java
// Animation id 894 ("human_spinningwheel") sourced from references/230.1 anims.json.

export interface SpinningRecipe {
    id: string;
    inputItemId: number;
    productItemId: number;
    level: number;
    xp: number;
    inputQuantity: number;
    outputQuantity: number;
    name: string;
    inputName: string;
    successMessage: string;
    animation: number;
    delayTicks: number;
}

type RecipeSeed = Omit<
    SpinningRecipe,
    "inputQuantity" | "outputQuantity" | "animation" | "delayTicks"
> & {
    inputQuantity?: number;
    outputQuantity?: number;
    animation?: number;
    delayTicks?: number;
};

const DEFAULT_DELAY_TICKS = 4;
export const SPINNING_ANIMATION_ID = 894;

const RECIPE_SEEDS: RecipeSeed[] = [
    {
        id: "spin_wool_ball",
        inputItemId: 1737, // Wool
        productItemId: 1759, // Ball of wool
        inputQuantity: 1,
        outputQuantity: 1,
        level: 1,
        xp: 2.5,
        name: "ball of wool",
        inputName: "wool",
        successMessage: "You spin the wool into a ball of wool.",
    },
    {
        id: "spin_flax_bowstring",
        inputItemId: 1779, // Flax
        productItemId: 1777, // Bowstring
        inputQuantity: 1,
        outputQuantity: 1,
        level: 10,
        xp: 15,
        name: "bowstring",
        inputName: "flax",
        successMessage: "You spin the flax into a bowstring.",
    },
    {
        id: "spin_sinew_crossbow_string",
        inputItemId: 9436, // Sinew
        productItemId: 9438, // Crossbow string
        inputQuantity: 1,
        outputQuantity: 1,
        level: 10,
        xp: 15,
        name: "crossbow string",
        inputName: "sinew",
        successMessage: "You spin the sinew into a crossbow string.",
    },
    {
        id: "spin_magic_roots_string",
        inputItemId: 6051, // Magic roots
        productItemId: 6038, // Magic string
        inputQuantity: 1,
        outputQuantity: 1,
        level: 19,
        xp: 30,
        name: "magic string",
        inputName: "magic roots",
        successMessage: "You spin the magic roots into a magic string.",
    },
];

export const SPINNING_RECIPES: SpinningRecipe[] = RECIPE_SEEDS.map((seed) => ({
    ...seed,
    inputQuantity: Math.max(1, seed.inputQuantity ?? 1),
    outputQuantity: Math.max(1, seed.outputQuantity ?? 1),
    animation: seed.animation ?? SPINNING_ANIMATION_ID,
    delayTicks: Math.max(1, seed.delayTicks ?? DEFAULT_DELAY_TICKS),
}));

const RECIPE_BY_ID = new Map<string, SpinningRecipe>();
for (const recipe of SPINNING_RECIPES) {
    RECIPE_BY_ID.set(recipe.id, recipe);
}

export function getSpinningRecipeById(id: string): SpinningRecipe | undefined {
    return RECIPE_BY_ID.get(id);
}

export const SPINNING_INPUT_ITEM_IDS = Array.from(
    new Set(SPINNING_RECIPES.map((recipe) => recipe.inputItemId)),
);

export const SPINNING_WHEEL_LOC_IDS = [
    4309, // VIKING_SPINNINGWHEEL
    8748, // ELF_VILLAGE_SPINNING_WHEEL
    14889, // SPINNINGWHEEL
    20365, // CONTACT_SPINNING_WHEEL
    21304, // IZNOT_SPINNING_WHEEL
    25824, // KR_SPINNINGWHEEL
    26143, // MURDER_QIP_SPINNING_WHEEL
    30934, // FOSSIL_SPINNING_WHEEL_BUILT
    30935, // FOSSIL_SPINNING_WHEEL_NOTBUILT
    31431, // FOSSIL_SPINNING_WHEEL
] as const;

const SPINNING_WHEEL_LOC_ID_SET = new Set<number>(SPINNING_WHEEL_LOC_IDS.map((locId) => locId));

export const isSpinningWheelLocId = (locId: number): boolean =>
    SPINNING_WHEEL_LOC_ID_SET.has(locId);

export const SINEW_ITEM_ID = 9436;
export const SINEW_SOURCE_ITEM_IDS = [2132, 2136]; // Raw beef, bear meat
export const SINEW_ANIMATION_ID = 897;
export const SINEW_DELAY_TICKS = 3;
export const SINEW_CRAFT_XP = 3;

const SINEW_SOURCE_SET = new Set<number>(SINEW_SOURCE_ITEM_IDS.map((id) => id));

export const isSinewSourceItem = (itemId: number): boolean => SINEW_SOURCE_SET.has(itemId);
