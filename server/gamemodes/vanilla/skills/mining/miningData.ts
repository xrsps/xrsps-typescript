export type Vec2 = { x: number; y: number };

export interface LocTypeLoader {
    getCount?: () => number;
    load?: (id: number) => any;
}

export interface PickaxeDefinition {
    itemId: number;
    level: number;
    animation: number;
    accuracy: number;
    swingTicks: number;
    ignoreLevelRequirement?: boolean;
}

export const PICKAXES: PickaxeDefinition[] = [
    { itemId: 13243, level: 61, animation: 642, accuracy: 16, swingTicks: 3 }, // Infernal
    {
        itemId: 25112,
        level: 71,
        animation: 8787,
        accuracy: 16,
        swingTicks: 3,
        ignoreLevelRequirement: true,
    }, // Echo/Trailblazer (crystal-tier, no req)
    { itemId: 23680, level: 71, animation: 642, accuracy: 16, swingTicks: 3 }, // Crystal
    { itemId: 20014, level: 65, animation: 642, accuracy: 15, swingTicks: 3 }, // 3rd age
    { itemId: 23677, level: 61, animation: 642, accuracy: 15, swingTicks: 3 }, // Dragon (or)
    { itemId: 25376, level: 61, animation: 642, accuracy: 15, swingTicks: 3 }, // Dragon (or kit)
    { itemId: 11920, level: 61, animation: 642, accuracy: 15, swingTicks: 3 }, // Dragon
    { itemId: 23276, level: 61, animation: 624, accuracy: 14, swingTicks: 3 }, // Gilded (rune stats)
    { itemId: 12797, level: 61, animation: 642, accuracy: 15, swingTicks: 3 }, // Dragon (+kit)
    { itemId: 25063, level: 61, animation: 642, accuracy: 15, swingTicks: 3 }, // Infernal (or)
    { itemId: 30345, level: 61, animation: 642, accuracy: 16, swingTicks: 3 }, // Infernal (or v2)
    { itemId: 30351, level: 61, animation: 642, accuracy: 15, swingTicks: 3 }, // Dragon (or v2)
    { itemId: 1275, level: 41, animation: 624, accuracy: 13, swingTicks: 3 }, // Rune
    { itemId: 11719, level: 41, animation: 624, accuracy: 13, swingTicks: 3 }, // Rune (NZ)
    { itemId: 1271, level: 31, animation: 628, accuracy: 11, swingTicks: 4 }, // Adamant
    { itemId: 1273, level: 21, animation: 629, accuracy: 9, swingTicks: 5 }, // Mithril
    { itemId: 1269, level: 6, animation: 627, accuracy: 7, swingTicks: 6 }, // Steel
    { itemId: 1267, level: 1, animation: 626, accuracy: 5, swingTicks: 7 }, // Iron
    { itemId: 12297, level: 11, animation: 626, accuracy: 6, swingTicks: 5 }, // Black
    { itemId: 1265, level: 1, animation: 625, accuracy: 3, swingTicks: 8 }, // Bronze
].sort((a, b) => b.level - a.level);

export interface MiningRockDefinition {
    id: string;
    name: string;
    level: number;
    xp: number;
    oreItemId: number;
    depletedLocId?: number;
    respawnTicks: { min: number; max: number };
    swingTicks: number;
}

const ROCK_DEFINITIONS: MiningRockDefinition[] = [
    {
        id: "clay",
        name: "Clay rocks",
        level: 1,
        xp: 5,
        oreItemId: 434,
        respawnTicks: { min: 8, max: 14 },
        swingTicks: 3,
    },
    {
        id: "copper",
        name: "Copper rocks",
        level: 1,
        xp: 17.5,
        oreItemId: 436,
        respawnTicks: { min: 10, max: 20 },
        swingTicks: 3,
    },
    {
        id: "tin",
        name: "Tin rocks",
        level: 1,
        xp: 17.5,
        oreItemId: 438,
        respawnTicks: { min: 10, max: 20 },
        swingTicks: 3,
    },
    {
        id: "iron",
        name: "Iron rocks",
        level: 15,
        xp: 35,
        oreItemId: 440,
        respawnTicks: { min: 20, max: 40 },
        swingTicks: 3,
    },
    {
        id: "silver",
        name: "Silver rocks",
        level: 20,
        xp: 40,
        oreItemId: 442,
        respawnTicks: { min: 35, max: 70 },
        swingTicks: 4,
    },
    {
        id: "coal",
        name: "Coal rocks",
        level: 30,
        xp: 50,
        oreItemId: 453,
        respawnTicks: { min: 45, max: 90 },
        swingTicks: 4,
    },
    {
        id: "gold",
        name: "Gold rocks",
        level: 40,
        xp: 65,
        oreItemId: 444,
        respawnTicks: { min: 50, max: 100 },
        swingTicks: 4,
    },
    {
        id: "mithril",
        name: "Mithril rocks",
        level: 55,
        xp: 80,
        oreItemId: 447,
        respawnTicks: { min: 80, max: 140 },
        swingTicks: 5,
    },
    {
        id: "adamantite",
        name: "Adamantite rocks",
        level: 70,
        xp: 95,
        oreItemId: 449,
        respawnTicks: { min: 140, max: 220 },
        swingTicks: 6,
    },
    {
        id: "runite",
        name: "Runite rocks",
        level: 85,
        xp: 125,
        oreItemId: 451,
        respawnTicks: { min: 250, max: 500 },
        swingTicks: 8,
    },
    {
        id: "amethyst",
        name: "Amethyst crystals",
        level: 92,
        xp: 240,
        oreItemId: 21347,
        depletedLocId: 11389,
        respawnTicks: { min: 110, max: 150 },
        swingTicks: 6,
    },
];

const ROCK_BY_ID = new Map<string, MiningRockDefinition>(
    ROCK_DEFINITIONS.map((rock) => [rock.id, rock]),
);

const ROCK_NAME_ALIASES: Record<string, string> = {
    "clay rocks": "clay",
    "copper rocks": "copper",
    "copper ore rocks": "copper",
    "tin rocks": "tin",
    "tin ore rocks": "tin",
    "iron rocks": "iron",
    "iron ore rocks": "iron",
    "silver rocks": "silver",
    "silver ore rocks": "silver",
    "coal rocks": "coal",
    "gold rocks": "gold",
    "gold ore rocks": "gold",
    "mithril rocks": "mithril",
    "mithril ore rocks": "mithril",
    "adamantite rocks": "adamantite",
    "adamant rocks": "adamantite",
    "Adamantite rocks": "adamantite",
    "runite rocks": "runite",
    "runite ore rocks": "runite",
    "amethyst crystals": "amethyst",
    "amethyst rocks": "amethyst",
};

export function getMiningRockById(id: string): MiningRockDefinition | undefined {
    return ROCK_BY_ID.get(id);
}

export function resolveMiningRockByName(name?: string): MiningRockDefinition | undefined {
    if (!name) return undefined;
    const normalized = name.trim().toLowerCase();
    const alias = ROCK_NAME_ALIASES[normalized];
    if (!alias) return undefined;
    return ROCK_BY_ID.get(alias);
}

export interface MiningLocMapping {
    rockId: string;
    depletedLocId?: number;
}

export interface MiningLocMap {
    map: Map<number, MiningLocMapping>;
}

function hasMineAction(loc: any): boolean {
    const actions = loc?.actions;
    if (!Array.isArray(actions)) return false;
    return actions.some((action) => action && action.trim().toLowerCase() === "mine");
}

function getPrimaryModelId(loc: any): number | undefined {
    const models = loc?.models;
    if (!Array.isArray(models) || models.length === 0) return undefined;
    const primary = models[0];
    if (!Array.isArray(primary) || primary.length === 0) return undefined;
    const modelId = primary[0];
    if (!Number.isFinite(modelId) || modelId <= 0) return undefined;
    return modelId;
}

function hasRecolor(loc: any): boolean {
    const recolorTo = loc?.recolorTo;
    return Array.isArray(recolorTo) && recolorTo.length > 0;
}

function isDepletedRockCandidate(loc: any): boolean {
    const name = loc?.name?.trim().toLowerCase() ?? "";
    if (name !== "rocks") return false;
    if (!hasMineAction(loc)) return false;
    if (hasRecolor(loc)) return false;
    return (getPrimaryModelId(loc) ?? 0) > 0;
}

function findNearestDepletedLocId(
    sourceLocId: number,
    modelId: number,
    candidatesByModel: Map<number, number[]>,
): number | undefined {
    const candidates = candidatesByModel.get(modelId);
    if (!candidates || candidates.length === 0) return undefined;

    let nearest: number | undefined;
    let bestDistance = Number.MAX_SAFE_INTEGER;
    for (const candidate of candidates) {
        const distance = Math.abs(candidate - sourceLocId);
        if (distance < bestDistance) {
            bestDistance = distance;
            nearest = candidate;
        }
    }
    return nearest;
}

export function buildMiningLocMap(loader?: LocTypeLoader): MiningLocMap {
    const map = new Map<number, MiningLocMapping>();
    if (!loader?.getCount || !loader.load) {
        return { map };
    }
    const total = loader.getCount();
    if (!Number.isFinite(total) || total <= 0) {
        return { map };
    }

    const depletedCandidatesByModel = new Map<number, number[]>();

    for (let id = 0; id < total; id++) {
        let loc: any;
        try {
            loc = loader.load(id);
        } catch {
            continue;
        }
        if (!isDepletedRockCandidate(loc)) continue;
        const modelId = getPrimaryModelId(loc);
        if (!(modelId && modelId > 0)) continue;
        const list = depletedCandidatesByModel.get(modelId) ?? [];
        list.push(id);
        depletedCandidatesByModel.set(modelId, list);
    }

    for (let id = 0; id < total; id++) {
        let loc: any;
        try {
            loc = loader.load(id);
        } catch {
            continue;
        }
        if (!hasMineAction(loc)) continue;
        const name = loc?.name as string | undefined;
        const rock = resolveMiningRockByName(name);
        if (!rock) continue;
        let depletedLocId =
            rock.depletedLocId && rock.depletedLocId > 0 ? rock.depletedLocId : undefined;
        if (!depletedLocId) {
            const modelId = getPrimaryModelId(loc);
            if (modelId && modelId > 0) {
                depletedLocId = findNearestDepletedLocId(id, modelId, depletedCandidatesByModel);
            }
        }

        map.set(id, {
            rockId: rock.id,
            depletedLocId: depletedLocId && depletedLocId > 0 ? depletedLocId : undefined,
        });
    }
    return { map };
}

export function selectPickaxeByLevel(
    availableIds: number[],
    level: number,
): PickaxeDefinition | undefined {
    const cache = new Set(availableIds.map((id) => id));
    for (const pick of PICKAXES) {
        if (!cache.has(pick.itemId)) continue;
        if (level >= pick.level || pick.ignoreLevelRequirement) return pick;
    }
    return undefined;
}

export function getMiningRockFromMap(
    locId: number,
    map: MiningLocMap,
): MiningRockDefinition | undefined {
    const mapping = map.map.get(locId);
    if (!mapping) return undefined;
    const rock = ROCK_BY_ID.get(mapping.rockId);
    if (!rock) return undefined;
    const depletedLocId = mapping.depletedLocId ?? -1;
    if (depletedLocId > 0 && rock.depletedLocId !== depletedLocId) {
        return { ...rock, depletedLocId };
    }
    return rock;
}

export function buildMiningTileKey(tile: Vec2, level: number): string {
    return `${level}:${tile.x}:${tile.y}`;
}

export type { MiningRockDefinition as MiningRock };
