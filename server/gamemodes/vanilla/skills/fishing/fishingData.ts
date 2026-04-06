type FishingNpcType = {
    id?: number;
    name?: string;
    category?: number;
    actions?: Array<string | null | undefined>;
};

export interface FishingToolDefinition {
    id: FishingToolId;
    name: string;
    itemIds: number[];
    animation: number;
    swingTicks: number;
    accuracy: number;
    itemAnimations?: Record<number, number>;
}

export type FishingToolId =
    | "small_net"
    | "big_net"
    | "fishing_rod"
    | "fly_fishing_rod"
    | "lobster_pot"
    | "harpoon"
    | "heavy_rod"
    | "karambwan_vessel";

export interface FishingCatchDefinition {
    id: string;
    itemId: number;
    level: number;
    xp: number;
    weight: number;
    quantity?: number;
}

export interface FishingMethodDefinition {
    id: string;
    name: string;
    actions: string[];
    toolId: FishingToolId;
    swingTicks: number;
    baitItemIds?: number[];
    baitName?: string;
    catches: FishingCatchDefinition[];
}

export interface FishingSpotDefinition {
    id: string;
    name: string;
    methods: FishingMethodDefinition[];
}

export interface FishingSpotMap {
    map: Map<number, string>;
}

export interface NpcTypeLoaderLike {
    getCount?: () => number;
    load?: (id: number) => FishingNpcType | any;
}

const FISHING_TOOL_DEFINITIONS: Record<FishingToolId, FishingToolDefinition> = {
    small_net: {
        id: "small_net",
        name: "small fishing net",
        itemIds: [303],
        animation: 621,
        swingTicks: 4,
        accuracy: 6,
    },
    big_net: {
        id: "big_net",
        name: "big fishing net",
        itemIds: [305],
        animation: 621,
        swingTicks: 5,
        accuracy: 5,
    },
    fishing_rod: {
        id: "fishing_rod",
        name: "fishing rod",
        itemIds: [307, 1585],
        animation: 622,
        swingTicks: 5,
        accuracy: 5,
    },
    fly_fishing_rod: {
        id: "fly_fishing_rod",
        name: "fly fishing rod",
        itemIds: [309],
        animation: 622,
        swingTicks: 4,
        accuracy: 6,
    },
    lobster_pot: {
        id: "lobster_pot",
        name: "lobster pot",
        itemIds: [301],
        animation: 619,
        swingTicks: 5,
        accuracy: 6,
    },
    harpoon: {
        id: "harpoon",
        name: "harpoon",
        itemIds: [
            311, 10129, 21028, 21031, 21033, 23762, 23763, 23764, 23765, 23823, 23864, 25059, 25061,
            25114, 25115, 25367, 25368, 25373, 25374, 30342, 30343, 30349,
        ],
        animation: 618,
        swingTicks: 5,
        accuracy: 7,
        itemAnimations: {
            25059: 8784, // Infernal harpoon (or)
            25114: 8784, // Echo harpoon
            25115: 8784, // Echo harpoon placeholder/alt
            25367: 8784, // Infernal harpoon (uncharged, or)
            25368: 8784, // Infernal harpoon (uncharged, or alt)
            25373: 88, // Dragon harpoon (or)
            25374: 88, // Dragon harpoon (or alt)
            30342: 11867, // Echo harpoon (reloaded)
            30343: 11867, // Echo harpoon (reloaded, empty)
            30349: 11868, // Echo harpoon (reloaded, no infernal)
        },
    },
    heavy_rod: {
        id: "heavy_rod",
        name: "barbarian rod",
        itemIds: [11323],
        animation: 622,
        swingTicks: 4,
        accuracy: 7,
    },
    karambwan_vessel: {
        id: "karambwan_vessel",
        name: "karambwan vessel",
        itemIds: [3157, 3159],
        animation: 621,
        swingTicks: 4,
        accuracy: 7,
    },
};

const FISHING_SPOT_DEFINITIONS: FishingSpotDefinition[] = [
    {
        id: "sea_small_net",
        name: "Coastal small-net/bait spot",
        methods: [
            {
                id: "small-net",
                name: "Small net",
                actions: ["small net", "net"],
                toolId: "small_net",
                swingTicks: 4,
                catches: [
                    { id: "shrimp", itemId: 317, level: 1, xp: 10, weight: 70 },
                    { id: "anchovy", itemId: 321, level: 15, xp: 40, weight: 30 },
                ],
            },
            {
                id: "sea-bait",
                name: "Bait",
                actions: ["bait"],
                toolId: "fishing_rod",
                swingTicks: 5,
                baitItemIds: [313],
                baitName: "fishing bait",
                catches: [
                    { id: "sardine", itemId: 327, level: 5, xp: 20, weight: 65 },
                    { id: "herring", itemId: 345, level: 10, xp: 30, weight: 35 },
                ],
            },
        ],
    },
    {
        id: "river_lure_bait",
        name: "River lure/bait spot",
        methods: [
            {
                id: "lure",
                name: "Lure",
                actions: ["lure"],
                toolId: "fly_fishing_rod",
                swingTicks: 4,
                baitItemIds: [314, 10087],
                baitName: "feathers",
                catches: [
                    { id: "trout", itemId: 335, level: 20, xp: 50, weight: 70 },
                    { id: "salmon", itemId: 331, level: 30, xp: 70, weight: 30 },
                ],
            },
            {
                id: "river-bait",
                name: "Bait",
                actions: ["bait"],
                toolId: "fishing_rod",
                swingTicks: 5,
                baitItemIds: [313],
                baitName: "fishing bait",
                catches: [{ id: "pike", itemId: 349, level: 25, xp: 60, weight: 100 }],
            },
        ],
    },
    {
        id: "sea_cage_harpoon",
        name: "Cage/harpoon spot",
        methods: [
            {
                id: "cage",
                name: "Cage",
                actions: ["cage"],
                toolId: "lobster_pot",
                swingTicks: 5,
                catches: [{ id: "lobster", itemId: 377, level: 40, xp: 90, weight: 100 }],
            },
            {
                id: "harpoon",
                name: "Harpoon",
                actions: ["harpoon"],
                toolId: "harpoon",
                swingTicks: 5,
                catches: [
                    { id: "tuna", itemId: 359, level: 35, xp: 80, weight: 65 },
                    { id: "swordfish", itemId: 371, level: 50, xp: 100, weight: 35 },
                ],
            },
        ],
    },
    {
        id: "sea_big_net",
        name: "Big-net/harpoon spot",
        methods: [
            {
                id: "big-net",
                name: "Big net",
                actions: ["big net"],
                toolId: "big_net",
                swingTicks: 5,
                catches: [
                    { id: "mackerel", itemId: 353, level: 16, xp: 20, weight: 60 },
                    { id: "cod", itemId: 341, level: 23, xp: 45, weight: 25 },
                    { id: "bass", itemId: 363, level: 46, xp: 100, weight: 15 },
                ],
            },
            {
                id: "sea-harpoon",
                name: "Harpoon",
                actions: ["harpoon"],
                toolId: "harpoon",
                swingTicks: 5,
                catches: [{ id: "shark", itemId: 383, level: 76, xp: 110, weight: 100 }],
            },
        ],
    },
    {
        id: "karambwan",
        name: "Karambwan fishing spot",
        methods: [
            {
                id: "karambwan",
                name: "Fish",
                actions: ["fish"],
                toolId: "karambwan_vessel",
                swingTicks: 4,
                baitItemIds: [3150],
                baitName: "karambwanji bait",
                catches: [{ id: "raw_karambwan", itemId: 3142, level: 65, xp: 105, weight: 100 }],
            },
        ],
    },
    {
        id: "karambwanji",
        name: "Karambwanji fishing spot",
        methods: [
            {
                id: "karambwanji-net",
                name: "Net",
                actions: ["net", "small net"],
                toolId: "small_net",
                swingTicks: 4,
                catches: [{ id: "karambwanji", itemId: 3150, level: 5, xp: 5, weight: 100 }],
            },
        ],
    },
    {
        id: "monkfish",
        name: "Piscatoris monkfish spot",
        methods: [
            {
                id: "monkfish-net",
                name: "Net",
                actions: ["net", "small net"],
                toolId: "small_net",
                swingTicks: 4,
                catches: [{ id: "monkfish", itemId: 7944, level: 62, xp: 120, weight: 100 }],
            },
            {
                id: "monkfish-harpoon",
                name: "Harpoon",
                actions: ["harpoon"],
                toolId: "harpoon",
                swingTicks: 5,
                catches: [{ id: "shark", itemId: 383, level: 76, xp: 110, weight: 100 }],
            },
        ],
    },
    {
        id: "barbarian_heavy_rod",
        name: "Barbarian heavy rod spot",
        methods: [
            {
                id: "barbarian-use-rod",
                name: "Use-rod",
                actions: ["use-rod"],
                toolId: "heavy_rod",
                swingTicks: 4,
                baitItemIds: [314, 10087],
                baitName: "feathers",
                catches: [
                    { id: "leaping_trout", itemId: 11328, level: 48, xp: 62, weight: 50 },
                    { id: "leaping_salmon", itemId: 11330, level: 58, xp: 70, weight: 35 },
                    { id: "leaping_sturgeon", itemId: 11332, level: 70, xp: 80, weight: 15 },
                ],
            },
        ],
    },
    {
        id: "minnow",
        name: "Minnow platform",
        methods: [
            {
                id: "minnow-net",
                name: "Small Net",
                actions: ["small net"],
                toolId: "small_net",
                swingTicks: 3,
                catches: [
                    { id: "minnow", itemId: 21356, level: 82, xp: 26, weight: 100, quantity: 10 },
                ],
            },
        ],
    },
];

const SPOT_BY_ID = new Map<string, FishingSpotDefinition>(
    FISHING_SPOT_DEFINITIONS.map((spot) => [spot.id, spot]),
);

const CATEGORY_TO_SPOT_ID = new Map<number, string>([
    [280, "river_lure_bait"],
    [281, "sea_cage_harpoon"],
    [282, "sea_big_net"],
    [283, "sea_small_net"],
    [632, "karambwanji"],
    [590, "monkfish"],
    [633, "karambwan"],
    [1137, "minnow"],
    [1174, "barbarian_heavy_rod"],
]);

export function getFishingSpotById(id: string): FishingSpotDefinition | undefined {
    return SPOT_BY_ID.get(id);
}

export function getFishingMethodById(
    spot: FishingSpotDefinition,
    methodId: string,
): FishingMethodDefinition | undefined {
    return spot.methods.find((method) => method.id === methodId);
}

export function findFishingMethodByAction(
    spot: FishingSpotDefinition,
    action: string | undefined,
): FishingMethodDefinition | undefined {
    const normalized = normalizeAction(action);
    if (!normalized) return undefined;
    return spot.methods.find((method) =>
        method.actions.some((candidate) => normalizeAction(candidate) === normalized),
    );
}

export function selectFishingTool(
    toolId: FishingToolId,
    carriedItemIds: number[],
): FishingToolDefinition | undefined {
    const tool = getFishingToolDefinition(toolId);
    if (!tool) return undefined;
    const carried = new Set(carriedItemIds);
    const matchesTool = tool.itemIds.some((id) => carried.has(id));
    if (!matchesTool) return undefined;

    if (tool.itemAnimations) {
        for (const itemId of carriedItemIds) {
            const animation = tool.itemAnimations[itemId];
            if (animation !== undefined && animation >= 0) {
                return { ...tool, animation };
            }
        }
    }

    return tool;
}

export function getFishingToolDefinition(toolId: FishingToolId): FishingToolDefinition | undefined {
    return FISHING_TOOL_DEFINITIONS[toolId];
}

export function pickFishingCatch(
    method: FishingMethodDefinition,
    level: number,
): FishingCatchDefinition | undefined {
    const eligible = method.catches.filter((entry) => level >= entry.level);
    if (eligible.length === 0) {
        return undefined;
    }
    const totalWeight = eligible.reduce((sum, entry) => sum + Math.max(1, entry.weight), 0);
    let roll = Math.random() * totalWeight;
    for (const entry of eligible) {
        roll -= Math.max(1, entry.weight);
        if (roll <= 0) {
            return entry;
        }
    }
    return eligible[eligible.length - 1];
}

export function buildFishingSpotMap(loader?: NpcTypeLoaderLike): FishingSpotMap {
    const map = new Map<number, string>();
    if (!loader?.getCount || !loader.load) {
        return { map };
    }
    const total = loader.getCount();
    if (!Number.isFinite(total) || total <= 0) {
        return { map };
    }
    for (let id = 0; id < total; id++) {
        let npc: FishingNpcType | undefined;
        try {
            npc = loader.load(id);
        } catch {
            continue;
        }
        if (!npc) continue;
        if (!isFishingSpotName(npc.name)) continue;
        const resolved = resolveSpotIdFromNpc(npc);
        if (resolved) {
            map.set(npc.id ?? id, resolved);
        }
    }
    return { map };
}

function resolveSpotIdFromNpc(npc: FishingNpcType): string | undefined {
    const direct = npc.category !== undefined ? CATEGORY_TO_SPOT_ID.get(npc.category) : undefined;
    if (direct) return direct;
    const actions = normalizeActionList(npc.actions);
    if (actions.has("use-rod")) return "barbarian_heavy_rod";
    if (actions.has("fish")) return "karambwan";
    if (actions.has("lure") && actions.has("bait")) return "river_lure_bait";
    if (actions.has("small net") && actions.has("bait")) return "sea_small_net";
    if (actions.has("cage") && actions.has("harpoon")) return "sea_cage_harpoon";
    if (actions.has("big net") && actions.has("harpoon")) return "sea_big_net";
    return undefined;
}

function normalizeAction(value: string | null | undefined): string {
    return (value || "").trim().toLowerCase();
}

function normalizeActionList(actions: Array<string | null | undefined> | undefined): Set<string> {
    const out = new Set<string>();
    if (!actions) return out;
    for (const action of actions) {
        const normalized = normalizeAction(action);
        if (normalized) out.add(normalized);
    }
    return out;
}

function isFishingSpotName(name?: string): boolean {
    if (!name) return false;
    const normalized = name.toLowerCase();
    return normalized.includes("fishing spot");
}
