export type CookingHeatSource = "range" | "fire";

export interface CookingRecipe {
    id: string;
    name: string;
    level: number;
    xp: number;
    rawItemId: number;
    cookedItemId: number;
    burntItemId?: number;
    animation?: number;
    delayTicks?: number;
    stopBurnLevel?: number;
}

export type CookingOutcome = "success" | "burn";

export interface CookingRollOptions {
    burnBonus?: number;
    rng?: () => number;
}

export const DEFAULT_COOKING_BURN_BONUS = 3;

export const COOKING_RECIPES: CookingRecipe[] = [
    {
        id: "cook_shrimps",
        name: "Shrimps",
        level: 1,
        xp: 30,
        rawItemId: 317,
        cookedItemId: 315,
        burntItemId: 323,
        animation: 897,
        delayTicks: 3,
        stopBurnLevel: 33,
    },
    {
        id: "cook_chicken",
        name: "Chicken",
        level: 1,
        xp: 30,
        rawItemId: 2138,
        cookedItemId: 2140,
        burntItemId: 2144,
        animation: 897,
        delayTicks: 3,
    },
    {
        id: "cook_anchovies",
        name: "Anchovies",
        level: 1,
        xp: 30,
        rawItemId: 321,
        cookedItemId: 319,
        burntItemId: 323,
        animation: 897,
        delayTicks: 3,
        stopBurnLevel: 34,
    },
    {
        id: "cook_trout",
        name: "Trout",
        level: 15,
        xp: 70,
        rawItemId: 335,
        cookedItemId: 333,
        burntItemId: 323,
        animation: 897,
        delayTicks: 3,
        stopBurnLevel: 50,
    },
    {
        id: "cook_salmon",
        name: "Salmon",
        level: 25,
        xp: 90,
        rawItemId: 331,
        cookedItemId: 329,
        burntItemId: 323,
        animation: 897,
        delayTicks: 3,
        stopBurnLevel: 58,
    },
    {
        id: "cook_tuna",
        name: "Tuna",
        level: 30,
        xp: 100,
        rawItemId: 359,
        cookedItemId: 361,
        burntItemId: 323,
        animation: 897,
        delayTicks: 3,
        stopBurnLevel: 58,
    },
    {
        id: "cook_lobster",
        name: "Lobster",
        level: 40,
        xp: 120,
        rawItemId: 377,
        cookedItemId: 379,
        burntItemId: 381,
        animation: 897,
        delayTicks: 3,
        stopBurnLevel: 74,
    },
    {
        id: "cook_swordfish",
        name: "Swordfish",
        level: 45,
        xp: 140,
        rawItemId: 371,
        cookedItemId: 373,
        burntItemId: 375,
        animation: 897,
        delayTicks: 3,
        stopBurnLevel: 86,
    },
    {
        id: "cook_karambwan",
        name: "Karambwan",
        level: 30,
        xp: 190,
        rawItemId: 3142,
        cookedItemId: 3144,
        burntItemId: 3148,
        animation: 897,
        delayTicks: 3,
        stopBurnLevel: 99,
    },
    {
        id: "cook_monkfish",
        name: "Monkfish",
        level: 62,
        xp: 150,
        rawItemId: 7944,
        cookedItemId: 7946,
        burntItemId: 7948,
        animation: 897,
        delayTicks: 3,
        stopBurnLevel: 91,
    },
    {
        id: "cook_shark",
        name: "Shark",
        level: 80,
        xp: 210,
        rawItemId: 383,
        cookedItemId: 385,
        burntItemId: 387,
        animation: 897,
        delayTicks: 3,
        stopBurnLevel: 94,
    },
    {
        id: "cook_manta_ray",
        name: "Manta ray",
        level: 91,
        xp: 216,
        rawItemId: 389,
        cookedItemId: 391,
        burntItemId: 393,
        animation: 897,
        delayTicks: 3,
        stopBurnLevel: 99,
    },
    {
        id: "cook_dark_crab",
        name: "Dark crab",
        level: 90,
        xp: 215,
        rawItemId: 11934,
        cookedItemId: 11936,
        burntItemId: 11938,
        animation: 897,
        delayTicks: 3,
        stopBurnLevel: 99,
    },
    {
        id: "cook_anglerfish",
        name: "Anglerfish",
        level: 84,
        xp: 230,
        rawItemId: 13439,
        cookedItemId: 13441,
        burntItemId: 13443,
        animation: 897,
        delayTicks: 3,
        stopBurnLevel: 99,
    },
];

export function getCookingRecipeById(id: string): CookingRecipe | undefined {
    return COOKING_RECIPES.find((recipe) => recipe.id === id);
}

export function getCookingRecipeByRawItemId(itemId: number): CookingRecipe | undefined {
    return COOKING_RECIPES.find((recipe) => recipe.rawItemId === itemId);
}

export function rollCookingOutcome(
    recipe: CookingRecipe,
    level: number,
    opts?: CookingRollOptions,
): CookingOutcome {
    const burntItemId = recipe.burntItemId ?? 0;
    const stopLevelRaw = recipe.stopBurnLevel ?? 0;
    if (!(burntItemId > 0 && stopLevelRaw > 0)) {
        return "success";
    }
    const stopLevel = Math.max(stopLevelRaw, recipe.level + 1);
    if (level >= stopLevel) {
        return "success";
    }
    const baseLevel = Math.max(recipe.level, 1);
    const effectiveLevel = Math.max(level, 1);
    const burnBonus = Math.max(0, opts?.burnBonus ?? DEFAULT_COOKING_BURN_BONUS);
    let burnChance = Math.max(0, 45 - burnBonus);
    const span = Math.max(1, stopLevel - baseLevel);
    const levelsProgressed = Math.max(0, effectiveLevel - baseLevel);
    const decrementPerLevel = burnChance / span;
    burnChance = Math.max(0, burnChance - levelsProgressed * decrementPerLevel);
    const roll = Math.max(0, Math.min(1, opts?.rng?.() ?? Math.random()));
    return burnChance > roll * 100 ? "burn" : "success";
}
