export interface TanningRecipe {
    id: string;
    name: string;
    level?: number;
    xp: number;
    inputItemId: number;
    outputItemId: number;
    animation?: number;
    delayTicks?: number;
}

export const TANNING_RECIPES: TanningRecipe[] = [
    {
        id: "tan_leather",
        name: "Leather",
        level: 1,
        xp: 1,
        inputItemId: 1739,
        outputItemId: 1741,
        animation: 1249,
        delayTicks: 2,
    },
    {
        id: "tan_hard_leather",
        name: "Hard leather",
        level: 28,
        xp: 35,
        inputItemId: 1739,
        outputItemId: 1743,
        animation: 1249,
        delayTicks: 2,
    },
    {
        id: "tan_green_dragonhide",
        name: "Green dragon leather",
        level: 57,
        xp: 62,
        inputItemId: 1753,
        outputItemId: 1745,
        animation: 1249,
        delayTicks: 2,
    },
    {
        id: "tan_blue_dragonhide",
        name: "Blue dragon leather",
        level: 66,
        xp: 70,
        inputItemId: 1751,
        outputItemId: 2505,
        animation: 1249,
        delayTicks: 2,
    },
    {
        id: "tan_red_dragonhide",
        name: "Red dragon leather",
        level: 73,
        xp: 78,
        inputItemId: 1749,
        outputItemId: 2507,
        animation: 1249,
        delayTicks: 2,
    },
    {
        id: "tan_black_dragonhide",
        name: "Black dragon leather",
        level: 79,
        xp: 86,
        inputItemId: 1747,
        outputItemId: 2509,
        animation: 1249,
        delayTicks: 2,
    },
];

export function getTanningRecipeById(id: string): TanningRecipe | undefined {
    return TANNING_RECIPES.find((recipe) => recipe.id === id);
}
