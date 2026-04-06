export const KNIFE_ITEM_ID = 946;
const FEATHER_ITEM_ID = 314;
const ARROW_SHAFT_ITEM_ID = 52;
const HEADLESS_ARROW_ITEM_ID = 53;
const CHISEL_ITEM_ID = 1755;
const AMETHYST_ITEM_ID = 21347;
const BROAD_BOLTS_ITEM_ID = 11875;
const AMETHYST_BROAD_BOLTS_ITEM_ID = 21316;
const JAVELIN_SHAFT_ITEM_ID = 19584;
const AMETHYST_JAVELIN_ITEM_ID = 21318;
const AMETHYST_JAVELIN_HEADS_ITEM_ID = 21352;
const AMETHYST_ARROW_ITEM_ID = 21326;
const AMETHYST_ARROW_TIPS_ITEM_ID = 21350;
const AMETHYST_BOLT_TIPS_ITEM_ID = 21338;
const AMETHYST_DART_ITEM_ID = 25849;
const AMETHYST_DART_TIPS_ITEM_ID = 25853;
const DRAGON_ARROW_ITEM_ID = 11212;
const DRAGON_ARROW_TIPS_ITEM_ID = 11237;

export type FletchingProductKind =
    | "arrow_shafts"
    | "shortbow"
    | "longbow"
    | "headless_arrow"
    | "arrow"
    | "arrowtips"
    | "bolt_tips"
    | "bolt"
    | "javelin_heads"
    | "javelin"
    | "dart_tips"
    | "dart";
export type FletchingRecipeMode = "carve" | "string" | "combine";

export interface FletchingProductDefinition {
    id: string;
    mode: FletchingRecipeMode;
    inputItemId: number;
    secondaryItemId?: number;
    productItemId: number;
    productName: string;
    outputQuantity: number;
    level: number;
    xp: number;
    kind: FletchingProductKind;
    animation?: number;
    delayTicks?: number;
    outputMode?: "replace" | "add";
    primaryLabel?: string;
    secondaryLabel?: string;
    successMessage?: string;
    consumeSecondary?: boolean;
    secondaryIsTool?: boolean;
}

export const BOW_STRING_ITEM_ID = 1777;
const FLETCHING_ANIMATION = 1248;
const FLETCHING_DELAY_TICKS = 3;

type ProductSeed = {
    suffix: string;
    productItemId: number;
    productName: string;
    level: number;
    xp: number;
    kind: FletchingProductKind;
    outputQuantity?: number;
};

type LogSeed = {
    logItemId: number;
    seeds: ProductSeed[];
};

const LOG_SEEDS: LogSeed[] = [
    {
        logItemId: 1511, // Logs
        seeds: [
            {
                suffix: "arrow_shafts",
                productItemId: 52,
                productName: "arrow shafts",
                outputQuantity: 15,
                level: 1,
                xp: 5,
                kind: "arrow_shafts",
            },
            {
                suffix: "shortbow_u",
                productItemId: 50,
                productName: "shortbow (u)",
                level: 5,
                xp: 5,
                kind: "shortbow",
            },
            {
                suffix: "longbow_u",
                productItemId: 48,
                productName: "longbow (u)",
                level: 10,
                xp: 10,
                kind: "longbow",
            },
        ],
    },
    {
        logItemId: 1521, // Oak logs
        seeds: [
            {
                suffix: "arrow_shafts",
                productItemId: 52,
                productName: "arrow shafts",
                outputQuantity: 30,
                level: 15,
                xp: 10,
                kind: "arrow_shafts",
            },
            {
                suffix: "shortbow_u",
                productItemId: 54,
                productName: "oak shortbow (u)",
                level: 20,
                xp: 16.5,
                kind: "shortbow",
            },
            {
                suffix: "longbow_u",
                productItemId: 56,
                productName: "oak longbow (u)",
                level: 25,
                xp: 25,
                kind: "longbow",
            },
        ],
    },
    {
        logItemId: 1519, // Willow logs
        seeds: [
            {
                suffix: "arrow_shafts",
                productItemId: 52,
                productName: "arrow shafts",
                outputQuantity: 45,
                level: 30,
                xp: 15,
                kind: "arrow_shafts",
            },
            {
                suffix: "shortbow_u",
                productItemId: 60,
                productName: "willow shortbow (u)",
                level: 35,
                xp: 33.3,
                kind: "shortbow",
            },
            {
                suffix: "longbow_u",
                productItemId: 58,
                productName: "willow longbow (u)",
                level: 40,
                xp: 41.5,
                kind: "longbow",
            },
        ],
    },
    {
        logItemId: 1517, // Maple logs
        seeds: [
            {
                suffix: "arrow_shafts",
                productItemId: 52,
                productName: "arrow shafts",
                outputQuantity: 60,
                level: 45,
                xp: 20,
                kind: "arrow_shafts",
            },
            {
                suffix: "shortbow_u",
                productItemId: 64,
                productName: "maple shortbow (u)",
                level: 50,
                xp: 50,
                kind: "shortbow",
            },
            {
                suffix: "longbow_u",
                productItemId: 62,
                productName: "maple longbow (u)",
                level: 55,
                xp: 58.3,
                kind: "longbow",
            },
        ],
    },
    {
        logItemId: 1515, // Yew logs
        seeds: [
            {
                suffix: "arrow_shafts",
                productItemId: 52,
                productName: "arrow shafts",
                outputQuantity: 75,
                level: 60,
                xp: 25,
                kind: "arrow_shafts",
            },
            {
                suffix: "shortbow_u",
                productItemId: 68,
                productName: "yew shortbow (u)",
                level: 65,
                xp: 67.5,
                kind: "shortbow",
            },
            {
                suffix: "longbow_u",
                productItemId: 66,
                productName: "yew longbow (u)",
                level: 70,
                xp: 75,
                kind: "longbow",
            },
        ],
    },
    {
        logItemId: 1513, // Magic logs
        seeds: [
            {
                suffix: "arrow_shafts",
                productItemId: 52,
                productName: "arrow shafts",
                outputQuantity: 90,
                level: 75,
                xp: 30,
                kind: "arrow_shafts",
            },
            {
                suffix: "shortbow_u",
                productItemId: 72,
                productName: "magic shortbow (u)",
                level: 80,
                xp: 83.3,
                kind: "shortbow",
            },
            {
                suffix: "longbow_u",
                productItemId: 70,
                productName: "magic longbow (u)",
                level: 85,
                xp: 91.5,
                kind: "longbow",
            },
        ],
    },
];

const LOG_RECIPE_MAP = new Map<number, FletchingProductDefinition[]>();
const STRING_RECIPE_MAP = new Map<number, FletchingProductDefinition>();
const RECIPE_LOOKUP = new Map<string, FletchingProductDefinition>();

for (const log of LOG_SEEDS) {
    const products: FletchingProductDefinition[] = [];
    for (const seed of log.seeds) {
        const id = `log_${log.logItemId}_${seed.suffix}`;
        const definition: FletchingProductDefinition = {
            id,
            mode: "carve",
            inputItemId: log.logItemId,
            productItemId: seed.productItemId,
            productName: seed.productName,
            kind: seed.kind,
            outputQuantity: Math.max(1, seed.outputQuantity ?? 1),
            level: Math.max(1, seed.level),
            xp: Math.max(0, seed.xp),
            animation: FLETCHING_ANIMATION,
            delayTicks: FLETCHING_DELAY_TICKS,
        };
        products.push(definition);
        RECIPE_LOOKUP.set(id, definition);
    }
    LOG_RECIPE_MAP.set(log.logItemId, products);
}

type StringSeed = {
    unstrungItemId: number;
    productItemId: number;
    productName: string;
    level: number;
    xp: number;
    kind: FletchingProductKind;
    animation: number;
};

const STRING_SEEDS: StringSeed[] = [
    {
        unstrungItemId: 50,
        productItemId: 841,
        productName: "shortbow",
        level: 5,
        xp: 5,
        kind: "shortbow",
        animation: 6678,
    },
    {
        unstrungItemId: 48,
        productItemId: 839,
        productName: "longbow",
        level: 10,
        xp: 10,
        kind: "longbow",
        animation: 6684,
    },
    {
        unstrungItemId: 54,
        productItemId: 843,
        productName: "oak shortbow",
        level: 20,
        xp: 17,
        kind: "shortbow",
        animation: 6679,
    },
    {
        unstrungItemId: 56,
        productItemId: 845,
        productName: "oak longbow",
        level: 25,
        xp: 25,
        kind: "longbow",
        animation: 6685,
    },
    {
        unstrungItemId: 60,
        productItemId: 849,
        productName: "willow shortbow",
        level: 35,
        xp: 33.3,
        kind: "shortbow",
        animation: 6680,
    },
    {
        unstrungItemId: 58,
        productItemId: 847,
        productName: "willow longbow",
        level: 40,
        xp: 41.5,
        kind: "longbow",
        animation: 6686,
    },
    {
        unstrungItemId: 64,
        productItemId: 853,
        productName: "maple shortbow",
        level: 50,
        xp: 50,
        kind: "shortbow",
        animation: 6681,
    },
    {
        unstrungItemId: 62,
        productItemId: 851,
        productName: "maple longbow",
        level: 55,
        xp: 58.2,
        kind: "longbow",
        animation: 6687,
    },
    {
        unstrungItemId: 68,
        productItemId: 857,
        productName: "yew shortbow",
        level: 65,
        xp: 68,
        kind: "shortbow",
        animation: 6682,
    },
    {
        unstrungItemId: 66,
        productItemId: 855,
        productName: "yew longbow",
        level: 70,
        xp: 75,
        kind: "longbow",
        animation: 6688,
    },
    {
        unstrungItemId: 72,
        productItemId: 861,
        productName: "magic shortbow",
        level: 80,
        xp: 83.3,
        kind: "shortbow",
        animation: 6683,
    },
    {
        unstrungItemId: 70,
        productItemId: 859,
        productName: "magic longbow",
        level: 85,
        xp: 91.5,
        kind: "longbow",
        animation: 6689,
    },
];

for (const seed of STRING_SEEDS) {
    const id = `string_${seed.unstrungItemId}_${seed.productItemId}`;
    const definition: FletchingProductDefinition = {
        id,
        mode: "string",
        inputItemId: seed.unstrungItemId,
        secondaryItemId: BOW_STRING_ITEM_ID,
        productItemId: seed.productItemId,
        productName: seed.productName,
        kind: seed.kind,
        outputQuantity: 1,
        level: Math.max(1, seed.level),
        xp: Math.max(0, seed.xp),
        animation: seed.animation,
        delayTicks: FLETCHING_DELAY_TICKS,
    };
    STRING_RECIPE_MAP.set(seed.unstrungItemId, definition);
    RECIPE_LOOKUP.set(id, definition);
}

const COMBINE_RECIPES: FletchingProductDefinition[] = [];

function registerCombineRecipe(definition: FletchingProductDefinition): void {
    COMBINE_RECIPES.push(definition);
    RECIPE_LOOKUP.set(definition.id, definition);
}

registerCombineRecipe({
    id: "combine_arrow_shafts_feathers",
    mode: "combine",
    inputItemId: ARROW_SHAFT_ITEM_ID,
    secondaryItemId: FEATHER_ITEM_ID,
    productItemId: HEADLESS_ARROW_ITEM_ID,
    productName: "Headless arrow",
    kind: "headless_arrow",
    outputQuantity: 1,
    level: 1,
    xp: 1,
    animation: FLETCHING_ANIMATION,
    delayTicks: FLETCHING_DELAY_TICKS,
    outputMode: "add",
    primaryLabel: "arrow shafts",
    secondaryLabel: "feathers",
    successMessage: "You attach feathers to the arrow shafts.",
});

registerCombineRecipe({
    id: "carve_amethyst_bolt_tips",
    mode: "combine",
    inputItemId: AMETHYST_ITEM_ID,
    secondaryItemId: CHISEL_ITEM_ID,
    productItemId: AMETHYST_BOLT_TIPS_ITEM_ID,
    productName: "Amethyst bolt tips",
    kind: "bolt_tips",
    outputQuantity: 15,
    level: 85,
    xp: 60,
    animation: FLETCHING_ANIMATION,
    delayTicks: 4,
    outputMode: "add",
    consumeSecondary: false,
    secondaryIsTool: true,
    primaryLabel: "amethyst",
    secondaryLabel: "a chisel",
    successMessage: "You chisel the amethyst into bolt tips.",
});

registerCombineRecipe({
    id: "carve_amethyst_javelin_heads",
    mode: "combine",
    inputItemId: AMETHYST_ITEM_ID,
    secondaryItemId: CHISEL_ITEM_ID,
    productItemId: AMETHYST_JAVELIN_HEADS_ITEM_ID,
    productName: "Amethyst javelin heads",
    kind: "javelin_heads",
    outputQuantity: 15,
    level: 87,
    xp: 60,
    animation: FLETCHING_ANIMATION,
    delayTicks: 4,
    outputMode: "add",
    consumeSecondary: false,
    secondaryIsTool: true,
    primaryLabel: "amethyst",
    secondaryLabel: "a chisel",
    successMessage: "You carve the amethyst into javelin heads.",
});

registerCombineRecipe({
    id: "carve_amethyst_dart_tips",
    mode: "combine",
    inputItemId: AMETHYST_ITEM_ID,
    secondaryItemId: CHISEL_ITEM_ID,
    productItemId: AMETHYST_DART_TIPS_ITEM_ID,
    productName: "Amethyst dart tips",
    kind: "dart_tips",
    outputQuantity: 15,
    level: 89,
    xp: 60,
    animation: FLETCHING_ANIMATION,
    delayTicks: 4,
    outputMode: "add",
    consumeSecondary: false,
    secondaryIsTool: true,
    primaryLabel: "amethyst",
    secondaryLabel: "a chisel",
    successMessage: "You shape the amethyst into dart tips.",
});

type ArrowCombineSeed = {
    tier: string;
    arrowtipsId: number;
    productItemId: number;
    level: number;
    xp: number;
};

const ARROW_COMBINE_SEEDS: ArrowCombineSeed[] = [
    { tier: "Bronze", arrowtipsId: 39, productItemId: 882, level: 1, xp: 1.3 },
    { tier: "Iron", arrowtipsId: 40, productItemId: 884, level: 15, xp: 2.5 },
    { tier: "Steel", arrowtipsId: 41, productItemId: 886, level: 30, xp: 5 },
    { tier: "Mithril", arrowtipsId: 42, productItemId: 888, level: 45, xp: 7.5 },
    { tier: "Adamant", arrowtipsId: 43, productItemId: 890, level: 60, xp: 10 },
    { tier: "Rune", arrowtipsId: 44, productItemId: 892, level: 75, xp: 12.5 },
    {
        tier: "Amethyst",
        arrowtipsId: AMETHYST_ARROW_TIPS_ITEM_ID,
        productItemId: AMETHYST_ARROW_ITEM_ID,
        level: 82,
        xp: 13.5,
    },
    {
        tier: "Dragon",
        arrowtipsId: DRAGON_ARROW_TIPS_ITEM_ID,
        productItemId: DRAGON_ARROW_ITEM_ID,
        level: 90,
        xp: 15,
    },
];

for (const seed of ARROW_COMBINE_SEEDS) {
    const tierLower = seed.tier.toLowerCase();
    registerCombineRecipe({
        id: `combine_headless_${tierLower}_arrows`,
        mode: "combine",
        inputItemId: HEADLESS_ARROW_ITEM_ID,
        secondaryItemId: seed.arrowtipsId,
        productItemId: seed.productItemId,
        productName: `${seed.tier} arrow`,
        kind: "arrow",
        outputQuantity: 1,
        level: seed.level,
        xp: seed.xp,
        animation: FLETCHING_ANIMATION,
        delayTicks: FLETCHING_DELAY_TICKS,
        outputMode: "add",
        primaryLabel: "headless arrows",
        secondaryLabel: `${tierLower} arrowtips`,
        successMessage: `You attach the ${tierLower} arrowtips.`,
    });
}

registerCombineRecipe({
    id: "carve_amethyst_arrowtips",
    mode: "combine",
    inputItemId: AMETHYST_ITEM_ID,
    secondaryItemId: CHISEL_ITEM_ID,
    productItemId: AMETHYST_ARROW_TIPS_ITEM_ID,
    productName: "Amethyst arrowtips",
    kind: "arrowtips",
    outputQuantity: 15,
    level: 85,
    xp: 60,
    animation: FLETCHING_ANIMATION,
    delayTicks: 4,
    outputMode: "add",
    consumeSecondary: false,
    secondaryIsTool: true,
    primaryLabel: "amethyst",
    secondaryLabel: "a chisel",
    successMessage: "You carefully carve the amethyst into arrowtips.",
});

registerCombineRecipe({
    id: "combine_broad_bolts_amethyst",
    mode: "combine",
    inputItemId: BROAD_BOLTS_ITEM_ID,
    secondaryItemId: AMETHYST_BOLT_TIPS_ITEM_ID,
    productItemId: AMETHYST_BROAD_BOLTS_ITEM_ID,
    productName: "Amethyst broad bolts",
    kind: "bolt",
    outputQuantity: 1,
    level: 76,
    xp: 10.6,
    animation: FLETCHING_ANIMATION,
    delayTicks: FLETCHING_DELAY_TICKS,
    outputMode: "replace",
    primaryLabel: "broad bolts",
    secondaryLabel: "amethyst bolt tips",
    successMessage: "You attach the amethyst tips to the bolts.",
});

registerCombineRecipe({
    id: "combine_javelin_shafts_amethyst",
    mode: "combine",
    inputItemId: JAVELIN_SHAFT_ITEM_ID,
    secondaryItemId: AMETHYST_JAVELIN_HEADS_ITEM_ID,
    productItemId: AMETHYST_JAVELIN_ITEM_ID,
    productName: "Amethyst javelin",
    kind: "javelin",
    outputQuantity: 1,
    level: 84,
    xp: 13.5,
    animation: FLETCHING_ANIMATION,
    delayTicks: FLETCHING_DELAY_TICKS,
    primaryLabel: "javelin shafts",
    secondaryLabel: "amethyst javelin heads",
    successMessage: "You attach the amethyst heads to the javelins.",
});

registerCombineRecipe({
    id: "combine_amethyst_dart_tips_feathers",
    mode: "combine",
    inputItemId: AMETHYST_DART_TIPS_ITEM_ID,
    secondaryItemId: FEATHER_ITEM_ID,
    productItemId: AMETHYST_DART_ITEM_ID,
    productName: "Amethyst dart",
    kind: "dart",
    outputQuantity: 1,
    level: 90,
    xp: 21,
    animation: FLETCHING_ANIMATION,
    delayTicks: FLETCHING_DELAY_TICKS,
    primaryLabel: "amethyst dart tips",
    secondaryLabel: "feathers",
    successMessage: "You attach feathers to the amethyst dart tips.",
});

export const FLETCHING_LOG_IDS = Array.from(LOG_RECIPE_MAP.keys());
export const FLETCHING_STRING_IDS = Array.from(STRING_RECIPE_MAP.keys());
export const FLETCHING_COMBINE_RECIPES = COMBINE_RECIPES;

export function getFletchingProductsForLog(
    logItemId: number,
): FletchingProductDefinition[] | undefined {
    return LOG_RECIPE_MAP.get(logItemId);
}

export function getStringingRecipeByUnstrungId(
    itemId: number,
): FletchingProductDefinition | undefined {
    return STRING_RECIPE_MAP.get(itemId);
}

export function getFletchingRecipeById(id: string): FletchingProductDefinition | undefined {
    return RECIPE_LOOKUP.get(id);
}
