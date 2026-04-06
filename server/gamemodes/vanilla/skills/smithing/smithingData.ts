import { SkillId } from "../../../../../src/rs/skill/skills";

export const HAMMER_ITEM_ID = 2347;
export const FURNACE_ANIMATION = 899;

export interface SmithingRecipe {
    id: string;
    name: string;
    level: number;
    xp: number;
    barItemId: number;
    barCount: number;
    outputItemId: number;
    outputQuantity: number;
    requireHammer?: boolean;
    animation?: number;
    delayTicks?: number;
}

export interface SmeltingRequirement {
    itemId: number;
    quantity: number;
}

export interface SmeltingRecipe {
    id: string;
    name: string;
    level: number;
    xp: number;
    inputs: SmeltingRequirement[];
    outputItemId: number;
    outputQuantity: number;
    animation?: number;
    delayTicks?: number;
    successType?: "guaranteed" | "iron";
    ingredientsLabel?: string;
}

export const SMITHING_RECIPES: SmithingRecipe[] = [
    {
        id: "bronze_dagger",
        name: "Bronze dagger",
        level: 1,
        xp: 12,
        barItemId: 2349,
        barCount: 1,
        outputItemId: 1205,
        outputQuantity: 1,
        animation: 898,
        delayTicks: 4,
    },
    {
        id: "bronze_sword",
        name: "Bronze sword",
        level: 4,
        xp: 12,
        barItemId: 2349,
        barCount: 1,
        outputItemId: 1277,
        outputQuantity: 1,
        animation: 898,
        delayTicks: 4,
    },
    {
        id: "bronze_scimitar",
        name: "Bronze scimitar",
        level: 5,
        xp: 37,
        barItemId: 2349,
        barCount: 2,
        outputItemId: 1321,
        outputQuantity: 1,
        animation: 898,
        delayTicks: 4,
    },
    {
        id: "bronze_platebody",
        name: "Bronze platebody",
        level: 18,
        xp: 112,
        barItemId: 2349,
        barCount: 5,
        outputItemId: 1117,
        outputQuantity: 1,
        animation: 898,
        delayTicks: 4,
    },
    {
        id: "iron_dagger",
        name: "Iron dagger",
        level: 15,
        xp: 25,
        barItemId: 2351,
        barCount: 1,
        outputItemId: 1203,
        outputQuantity: 1,
        animation: 898,
        delayTicks: 4,
    },
    {
        id: "iron_scimitar",
        name: "Iron scimitar",
        level: 20,
        xp: 75,
        barItemId: 2351,
        barCount: 2,
        outputItemId: 1323,
        outputQuantity: 1,
        animation: 898,
        delayTicks: 4,
    },
    {
        id: "iron_platebody",
        name: "Iron platebody",
        level: 33,
        xp: 250,
        barItemId: 2351,
        barCount: 5,
        outputItemId: 1115,
        outputQuantity: 1,
        animation: 898,
        delayTicks: 4,
    },
    {
        id: "iron_nails",
        name: "Iron nails",
        level: 34,
        xp: 38,
        barItemId: 2351,
        barCount: 1,
        outputItemId: 4820,
        outputQuantity: 15,
        animation: 898,
        delayTicks: 4,
    },
    {
        id: "steel_dagger",
        name: "Steel dagger",
        level: 30,
        xp: 37,
        barItemId: 2353,
        barCount: 1,
        outputItemId: 1207,
        outputQuantity: 1,
        animation: 898,
        delayTicks: 4,
    },
    {
        id: "steel_scimitar",
        name: "Steel scimitar",
        level: 40,
        xp: 100,
        barItemId: 2353,
        barCount: 2,
        outputItemId: 1325,
        outputQuantity: 1,
        animation: 898,
        delayTicks: 4,
    },
    {
        id: "steel_platebody",
        name: "Steel platebody",
        level: 48,
        xp: 375,
        barItemId: 2353,
        barCount: 5,
        outputItemId: 1119,
        outputQuantity: 1,
        animation: 898,
        delayTicks: 4,
    },
    {
        id: "steel_nails",
        name: "Steel nails",
        level: 46,
        xp: 50,
        barItemId: 2353,
        barCount: 1,
        outputItemId: 1539,
        outputQuantity: 15,
        animation: 898,
        delayTicks: 4,
    },
    {
        id: "bronze_arrowtips",
        name: "Bronze arrowtips",
        level: 5,
        xp: 12.5,
        barItemId: 2349,
        barCount: 1,
        outputItemId: 39,
        outputQuantity: 15,
        animation: 898,
        delayTicks: 4,
    },
    {
        id: "iron_arrowtips",
        name: "Iron arrowtips",
        level: 20,
        xp: 25,
        barItemId: 2351,
        barCount: 1,
        outputItemId: 40,
        outputQuantity: 15,
        animation: 898,
        delayTicks: 4,
    },
    {
        id: "steel_arrowtips",
        name: "Steel arrowtips",
        level: 35,
        xp: 37.5,
        barItemId: 2353,
        barCount: 1,
        outputItemId: 41,
        outputQuantity: 15,
        animation: 898,
        delayTicks: 4,
    },
    {
        id: "mithril_arrowtips",
        name: "Mithril arrowtips",
        level: 55,
        xp: 50,
        barItemId: 2359,
        barCount: 1,
        outputItemId: 42,
        outputQuantity: 15,
        animation: 898,
        delayTicks: 4,
    },
    {
        id: "adamant_arrowtips",
        name: "Adamant arrowtips",
        level: 75,
        xp: 62.5,
        barItemId: 2361,
        barCount: 1,
        outputItemId: 43,
        outputQuantity: 15,
        animation: 898,
        delayTicks: 4,
    },
    {
        id: "rune_arrowtips",
        name: "Rune arrowtips",
        level: 90,
        xp: 75,
        barItemId: 2363,
        barCount: 1,
        outputItemId: 44,
        outputQuantity: 15,
        animation: 898,
        delayTicks: 4,
    },
];

export const SMELTING_RECIPES: SmeltingRecipe[] = [
    {
        id: "smelt_bronze_bar",
        name: "Bronze bar",
        level: 1,
        xp: 6,
        inputs: [
            { itemId: 436, quantity: 1 },
            { itemId: 438, quantity: 1 },
        ],
        outputItemId: 2349,
        outputQuantity: 1,
        animation: FURNACE_ANIMATION,
        delayTicks: 4,
        successType: "guaranteed",
        ingredientsLabel: "Copper + Tin ore",
    },
    {
        id: "smelt_iron_bar",
        name: "Iron bar",
        level: 15,
        xp: 13,
        inputs: [{ itemId: 440, quantity: 1 }],
        outputItemId: 2351,
        outputQuantity: 1,
        animation: FURNACE_ANIMATION,
        delayTicks: 4,
        successType: "iron",
        ingredientsLabel: "Iron ore",
    },
    {
        id: "smelt_silver_bar",
        name: "Silver bar",
        level: 20,
        xp: 14,
        inputs: [{ itemId: 442, quantity: 1 }],
        outputItemId: 2355,
        outputQuantity: 1,
        animation: FURNACE_ANIMATION,
        delayTicks: 4,
        successType: "guaranteed",
        ingredientsLabel: "Silver ore",
    },
    {
        id: "smelt_steel_bar",
        name: "Steel bar",
        level: 30,
        xp: 18,
        inputs: [
            { itemId: 440, quantity: 1 },
            { itemId: 453, quantity: 2 },
        ],
        outputItemId: 2353,
        outputQuantity: 1,
        animation: FURNACE_ANIMATION,
        delayTicks: 4,
        successType: "guaranteed",
        ingredientsLabel: "Iron ore + 2 Coal",
    },
    {
        id: "smelt_gold_bar",
        name: "Gold bar",
        level: 40,
        xp: 22,
        inputs: [{ itemId: 444, quantity: 1 }],
        outputItemId: 2357,
        outputQuantity: 1,
        animation: FURNACE_ANIMATION,
        delayTicks: 4,
        successType: "guaranteed",
        ingredientsLabel: "Gold ore",
    },
    {
        id: "smelt_mithril_bar",
        name: "Mithril bar",
        level: 50,
        xp: 30,
        inputs: [
            { itemId: 447, quantity: 1 },
            { itemId: 453, quantity: 4 },
        ],
        outputItemId: 2359,
        outputQuantity: 1,
        animation: FURNACE_ANIMATION,
        delayTicks: 4,
        successType: "guaranteed",
        ingredientsLabel: "Mithril ore + 4 Coal",
    },
    {
        id: "smelt_adamantite_bar",
        name: "Adamantite bar",
        level: 70,
        xp: 38,
        inputs: [
            { itemId: 449, quantity: 1 },
            { itemId: 453, quantity: 6 },
        ],
        outputItemId: 2361,
        outputQuantity: 1,
        animation: FURNACE_ANIMATION,
        delayTicks: 4,
        successType: "guaranteed",
        ingredientsLabel: "Adamantite ore + 6 Coal",
    },
    {
        id: "smelt_runite_bar",
        name: "Runite bar",
        level: 85,
        xp: 50,
        inputs: [
            { itemId: 451, quantity: 1 },
            { itemId: 453, quantity: 8 },
        ],
        outputItemId: 2363,
        outputQuantity: 1,
        animation: FURNACE_ANIMATION,
        delayTicks: 4,
        successType: "guaranteed",
        ingredientsLabel: "Runite ore + 8 Coal",
    },
];

export function getSmithingRecipeById(id: string): SmithingRecipe | undefined {
    return SMITHING_RECIPES.find((recipe) => recipe.id === id);
}

export function getSmeltingRecipeById(id: string): SmeltingRecipe | undefined {
    return SMELTING_RECIPES.find((recipe) => recipe.id === id);
}

export function calculateIronSmeltChance(level: number): number {
    const normalized = Math.max(15, Math.floor(level));
    const chancePercent = Math.min(100, 50 + (normalized - 15));
    return Math.max(0, Math.min(1, chancePercent / 100));
}

export function computeSmeltingBatchCount(
    entries: Array<{ itemId: number; quantity: number }>,
    recipe: SmeltingRecipe,
): number {
    if (!Array.isArray(recipe.inputs) || recipe.inputs.length === 0) {
        return 0;
    }
    let minBatch = Number.MAX_SAFE_INTEGER;
    for (const req of recipe.inputs) {
        const required = Math.max(1, req.quantity);
        const available = countItem(entries, req.itemId);
        const possible = Math.floor(available / required);
        minBatch = Math.min(minBatch, possible);
        if (minBatch <= 0) return 0;
    }
    if (minBatch === Number.MAX_SAFE_INTEGER) return 0;
    return Math.max(0, minBatch);
}

function countItem(entries: Array<{ itemId: number; quantity: number }>, itemId: number): number {
    if (!Array.isArray(entries)) return 0;
    let total = 0;
    for (const entry of entries) {
        if (!entry) continue;
        if (entry.itemId !== itemId) continue;
        total += Math.max(0, entry.quantity);
    }
    return total;
}
