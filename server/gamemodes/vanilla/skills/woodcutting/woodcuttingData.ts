export type Vec2 = { x: number; y: number };

export interface HatchetDefinition {
    itemId: number;
    level: number;
    animation: number;
    accuracy: number;
    swingTicks: number;
    ignoreLevelRequirement?: boolean;
}

export const HATCHETS: HatchetDefinition[] = [
    // Infernal axe + variants (includes "empty"/uncharged variants)
    { itemId: 13241, level: 61, animation: 2117, accuracy: 13, swingTicks: 3 }, // Infernal
    { itemId: 13242, level: 61, animation: 2117, accuracy: 13, swingTicks: 3 }, // Infernal (empty)
    { itemId: 25066, level: 61, animation: 2117, accuracy: 13, swingTicks: 3 }, // Infernal (or)
    { itemId: 25371, level: 61, animation: 2117, accuracy: 13, swingTicks: 3 }, // Infernal (or kit)
    { itemId: 30347, level: 61, animation: 2117, accuracy: 13, swingTicks: 3 }, // Infernal (or v2)
    { itemId: 30348, level: 61, animation: 2117, accuracy: 13, swingTicks: 3 }, // Infernal (or v2 kit)

    // Crystal axe + variants
    {
        itemId: 25110,
        level: 71,
        animation: 12025,
        accuracy: 13,
        swingTicks: 3,
        ignoreLevelRequirement: true,
    }, // Echo/League axe (crystal-tier, no req)
    { itemId: 23673, level: 71, animation: 8324, accuracy: 13, swingTicks: 3 }, // Crystal
    { itemId: 23862, level: 71, animation: 8324, accuracy: 13, swingTicks: 3 }, // Crystal (variant)

    // Dragon axe + variants
    { itemId: 6739, level: 61, animation: 2846, accuracy: 13, swingTicks: 3 }, // Dragon
    { itemId: 25378, level: 61, animation: 2846, accuracy: 13, swingTicks: 3 }, // Dragon (or)
    { itemId: 30352, level: 61, animation: 2846, accuracy: 13, swingTicks: 3 }, // Dragon (or v2)

    // 3rd age axe (dragon-tier)
    { itemId: 20011, level: 61, animation: 7264, accuracy: 13, swingTicks: 3 }, // 3rd age

    // Gilded axe (rune-tier)
    { itemId: 23279, level: 41, animation: 8303, accuracy: 11, swingTicks: 3 }, // Gilded

    { itemId: 1359, level: 41, animation: 867, accuracy: 11, swingTicks: 3 }, // Rune
    { itemId: 1357, level: 31, animation: 869, accuracy: 9, swingTicks: 3 }, // Adamant
    { itemId: 1355, level: 21, animation: 871, accuracy: 7, swingTicks: 3 }, // Mithril
    { itemId: 1361, level: 11, animation: 873, accuracy: 5, swingTicks: 3 }, // Black
    { itemId: 1353, level: 6, animation: 875, accuracy: 4, swingTicks: 3 }, // Steel
    { itemId: 1349, level: 1, animation: 877, accuracy: 2, swingTicks: 3 }, // Iron
    { itemId: 1351, level: 1, animation: 879, accuracy: 1, swingTicks: 3 }, // Bronze
].sort((a, b) => b.level - a.level);

export interface WoodcuttingTreeDefinition {
    id: string;
    name: string;
    level: number;
    xp: number;
    logItemId: number;
    stumpId: number;
    respawnTicks: { min: number; max: number };
    depleteRoll: number; // 1 => always deplete, N => 1 in N chance per success
    swingTicks: number;
}

const TREE_DEFINITIONS: WoodcuttingTreeDefinition[] = [
    {
        id: "normal",
        name: "Tree",
        level: 1,
        xp: 25,
        logItemId: 1511,
        stumpId: 1342,
        respawnTicks: { min: 15, max: 25 },
        depleteRoll: 8,
        swingTicks: 4, // OSRS: all trees roll every 4 ticks
    },
    {
        id: "oak",
        name: "Oak",
        level: 15,
        xp: 37.5,
        logItemId: 1521,
        stumpId: 1356,
        respawnTicks: { min: 25, max: 45 },
        depleteRoll: 8,
        swingTicks: 4,
    },
    {
        id: "willow",
        name: "Willow",
        level: 30,
        xp: 67.5,
        logItemId: 1519,
        stumpId: 8489,
        respawnTicks: { min: 45, max: 85 },
        depleteRoll: 8,
        swingTicks: 4,
    },
    {
        id: "maple",
        name: "Maple tree",
        level: 45,
        xp: 100,
        logItemId: 1517,
        stumpId: 9713,
        respawnTicks: { min: 70, max: 130 },
        depleteRoll: 10,
        swingTicks: 4,
    },
    {
        id: "yew",
        name: "Yew",
        level: 60,
        xp: 175,
        logItemId: 1515,
        stumpId: 9714,
        respawnTicks: { min: 90, max: 180 },
        depleteRoll: 12,
        swingTicks: 4, // OSRS: all trees roll every 4 ticks
    },
    {
        id: "magic",
        name: "Magic tree",
        level: 75,
        xp: 250,
        logItemId: 1513,
        stumpId: 8399,
        respawnTicks: { min: 120, max: 240 },
        depleteRoll: 16,
        swingTicks: 4, // OSRS: all trees roll every 4 ticks
    },
    {
        id: "teak",
        name: "Teak",
        level: 35,
        xp: 85,
        logItemId: 6333,
        stumpId: 9037,
        respawnTicks: { min: 55, max: 110 },
        depleteRoll: 8,
        swingTicks: 4,
    },
    {
        id: "mahogany",
        name: "Mahogany",
        level: 50,
        xp: 125,
        logItemId: 6332,
        stumpId: 9035,
        respawnTicks: { min: 70, max: 140 },
        depleteRoll: 8,
        swingTicks: 4,
    },
    {
        id: "achey",
        name: "Achey tree",
        level: 1,
        xp: 25,
        logItemId: 2862,
        stumpId: 3371,
        respawnTicks: { min: 15, max: 30 },
        depleteRoll: 1,
        swingTicks: 4, // OSRS: all trees roll every 4 ticks
    },
    {
        id: "hollow",
        name: "Hollow tree",
        level: 45,
        xp: 82,
        logItemId: 3239,
        stumpId: 8445,
        respawnTicks: { min: 45, max: 90 },
        depleteRoll: 8,
        swingTicks: 4,
    },
    {
        id: "redwood",
        name: "Redwood",
        level: 90,
        xp: 380,
        logItemId: 19669,
        stumpId: 29669,
        respawnTicks: { min: 150, max: 250 },
        depleteRoll: 20,
        swingTicks: 4, // OSRS: all trees roll every 4 ticks
    },
];

const TREE_BY_ID = new Map<string, WoodcuttingTreeDefinition>(
    TREE_DEFINITIONS.map((tree) => [tree.id, tree]),
);

const TREE_NAME_ALIASES: Record<string, string> = {
    tree: "normal",
    evergreen: "normal",
    "dead tree": "normal",
    "jungle tree": "normal",
    oak: "oak",
    "oak tree": "oak",
    willow: "willow",
    "willow tree": "willow",
    maple: "maple",
    "maple tree": "maple",
    teak: "teak",
    "teak tree": "teak",
    mahogany: "mahogany",
    "mahogany tree": "mahogany",
    yew: "yew",
    "yew tree": "yew",
    magic: "magic",
    "magic tree": "magic",
    "achey tree": "achey",
    "hollow tree": "hollow",
    redwood: "redwood",
    "redwood tree": "redwood",
};

export function getWoodcuttingTreeById(id: string): WoodcuttingTreeDefinition | undefined {
    return TREE_BY_ID.get(id);
}

export function resolveTreeByName(name: string | undefined): WoodcuttingTreeDefinition | undefined {
    if (!name) return undefined;
    const normalized = name.trim().toLowerCase();
    const alias = TREE_NAME_ALIASES[normalized];
    if (!alias) return undefined;
    return TREE_BY_ID.get(alias);
}

export interface WoodcuttingLocMap {
    map: Map<number, string>;
}

export interface LocTypeLoader {
    getCount?: () => number;
    load?: (id: number) => any;
}

export function buildWoodcuttingLocMap(loader?: LocTypeLoader): WoodcuttingLocMap {
    const map = new Map<number, string>();
    if (!loader?.getCount || !loader.load) {
        return { map };
    }
    const total = loader.getCount();
    if (!Number.isFinite(total) || total <= 0) {
        return { map };
    }
    for (let id = 0; id < total; id++) {
        let loc: any;
        try {
            loc = loader.load(id);
        } catch {
            continue;
        }
        // Only map locs that actually offer the Chop down action.
        // This avoids matching decorative "Tree" locs that share the same name.
        const actions: unknown = loc?.actions;
        if (Array.isArray(actions)) {
            const hasChop = actions.some(
                (a) =>
                    !!a &&
                    (a.trim().toLowerCase() === "chop down" ||
                        a.trim().toLowerCase() === "chop-down"),
            );
            if (!hasChop) continue;
        }
        const name = loc?.name;
        const tree = resolveTreeByName(name);
        if (!tree) continue;
        map.set(id, tree.id);
    }
    return { map };
}

export function selectHatchetByLevel(
    available: number[],
    level: number,
): HatchetDefinition | undefined {
    const cache = new Set(available.map((id) => id));
    let best: HatchetDefinition | undefined;
    for (const hatchet of HATCHETS) {
        if (level < hatchet.level && !hatchet.ignoreLevelRequirement) continue;
        if (!cache.has(hatchet.itemId)) continue;
        if (!best) {
            best = hatchet;
            continue;
        }
        // Prefer higher requirement tier, then higher accuracy, then faster swing.
        if (hatchet.level !== best.level) {
            if (hatchet.level > best.level) best = hatchet;
            continue;
        }
        if (hatchet.accuracy !== best.accuracy) {
            if (hatchet.accuracy > best.accuracy) best = hatchet;
            continue;
        }
        if (hatchet.swingTicks !== best.swingTicks) {
            if (hatchet.swingTicks < best.swingTicks) best = hatchet;
            continue;
        }
    }
    return best;
}

export function getWoodcuttingTreeFromMap(
    locId: number,
    map: WoodcuttingLocMap,
): WoodcuttingTreeDefinition | undefined {
    const treeId = map.map.get(locId);
    if (!treeId) return undefined;
    return TREE_BY_ID.get(treeId);
}

export function buildWoodcuttingTileKey(tile: Vec2, level: number): string {
    return `${level}:${tile.x}:${tile.y}`;
}

export type { WoodcuttingTreeDefinition as WoodcuttingTree };
