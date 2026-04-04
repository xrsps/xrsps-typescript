import { loadItemDefinitions } from "../../data/items";
import type {
    DropConditionDefinition,
    DropQuantity,
    NpcDropEntry,
    NpcDropEntryDefinition,
    NpcDropPool,
    NpcDropPoolDefinition,
    NpcDropTable,
    NpcDropTableDefinition,
    ProbabilityInput,
    QuantityInput,
} from "./types";

const ITEM_NAME_ALIASES = new Map<string, string>([["coins", "Coins"]]);

/**
 * Explicit name→ID overrides for items whose canonical name collides with
 * non-stackable quest variants (e.g. "Coins" = 617 vs 995).
 */
const ITEM_NAME_ID_OVERRIDES = new Map<string, number>([["coins", 995]]);

let cachedItemIdsByName: Map<string, number> | undefined;

function getItemIdsByName(): Map<string, number> {
    if (!cachedItemIdsByName) {
        cachedItemIdsByName = new Map<string, number>();
        for (const item of loadItemDefinitions()) {
            const normalized = normalizeName(item.name);
            if (!normalized || cachedItemIdsByName.has(normalized)) continue;
            cachedItemIdsByName.set(normalized, item.id);
        }
    }
    return cachedItemIdsByName;
}

export function normalizeName(value: string | undefined | null): string {
    const trimmed = String(value ?? "")
        .replace(/<!--.*?-->/g, "")
        .replace(/\[\[|\]\]/g, "")
        .trim()
        .toLowerCase();
    if (!trimmed) return "";
    return trimmed.replace(/\s+/g, " ");
}

export function resolveItemId(def: NpcDropEntryDefinition): number | undefined {
    if (def.itemId !== undefined && def.itemId > 0) return def.itemId;
    const rawName = String(def.itemName ?? "").trim();
    if (!rawName) return undefined;
    const normalized = normalizeName(rawName);
    // Check explicit ID overrides first (handles ambiguous names like "Coins")
    const overrideId = ITEM_NAME_ID_OVERRIDES.get(normalized);
    if (overrideId !== undefined) return overrideId;
    const aliasName = ITEM_NAME_ALIASES.get(normalized) ?? rawName;
    return getItemIdsByName().get(normalizeName(aliasName));
}

export function parseQuantity(input: QuantityInput | undefined): DropQuantity {
    if (Array.isArray(input)) {
        const min = Math.max(1, input[0]);
        const max = Math.max(min, input[1]);
        return { min, max };
    }
    if (Number.isFinite(input as number)) {
        const quantity = Math.max(1, Math.floor(input as number));
        return { min: quantity, max: quantity };
    }
    const raw = String(input ?? "1")
        .replace(/<!--.*?-->/g, "")
        .replace(/\(.*?\)/g, "")
        .replace(/,/g, "")
        .trim();
    const rangeMatch = raw.match(/^(\d+)\s*-\s*(\d+)$/);
    if (rangeMatch) {
        const min = Math.max(1, parseInt(rangeMatch[1], 10));
        const max = Math.max(min, parseInt(rangeMatch[2], 10));
        return { min, max };
    }
    const valueMatch = raw.match(/^(\d+)$/);
    if (valueMatch) {
        const quantity = Math.max(1, parseInt(valueMatch[1], 10));
        return { min: quantity, max: quantity };
    }
    return { min: 1, max: 1 };
}

export function parseProbability(input: ProbabilityInput | undefined): number | undefined {
    if (input === undefined) return undefined;
    if (Number.isFinite(input as number)) {
        const value = input as number;
        if (value < 0) return undefined;
        return Math.max(0, value);
    }
    const raw = String(input)
        .replace(/<!--.*?-->/g, "")
        .trim()
        .toLowerCase();
    if (!raw) return undefined;
    if (raw === "always") return 1;
    const fraction = raw.match(/^([\d.]+)\s*\/\s*([\d.]+)$/);
    if (fraction) {
        const numerator = parseFloat(fraction[1]);
        const denominator = parseFloat(fraction[2]);
        if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
            return undefined;
        }
        return Math.max(0, numerator / denominator);
    }
    const inChance = raw.match(/^1\s+in\s+([\d.]+)$/);
    if (inChance) {
        const denominator = parseFloat(inChance[1]);
        if (!Number.isFinite(denominator) || denominator <= 0) return undefined;
        return 1 / denominator;
    }
    const direct = parseFloat(raw);
    if (!Number.isFinite(direct) || direct < 0) return undefined;
    return direct;
}

export function resolveDropCondition(
    condition: DropConditionDefinition | undefined,
): DropConditionDefinition | undefined {
    if (!condition) return undefined;
    const requiredAnyEquippedItemIds = (condition.requiredAnyEquippedItemIds ?? [])
        .map((itemId) => itemId)
        .filter((itemId) => itemId > 0);
    const minimumQuestPoints =
        condition.minimumQuestPoints !== undefined
            ? Math.max(0, condition.minimumQuestPoints)
            : undefined;
    const hasCondition =
        condition.wildernessOnly === true ||
        minimumQuestPoints !== undefined ||
        requiredAnyEquippedItemIds.length > 0;
    if (!hasCondition) return undefined;
    return {
        wildernessOnly: condition.wildernessOnly === true,
        minimumQuestPoints,
        requiredAnyEquippedItemIds:
            requiredAnyEquippedItemIds.length > 0 ? requiredAnyEquippedItemIds : undefined,
    };
}

export function resolveDropEntry(def: NpcDropEntryDefinition): NpcDropEntry | undefined {
    const itemId = resolveItemId(def);
    if (!(itemId && itemId > 0)) return undefined;
    return {
        itemId,
        quantity: parseQuantity(def.quantity),
        probability: parseProbability(def.rarity),
        altProbability: parseProbability(def.altRarity),
        condition: resolveDropCondition(def.condition),
        altCondition: resolveDropCondition(def.altCondition),
        leagueBoostEligible: def.leagueBoostEligible === true,
    };
}

export function resolveDropPool(def: NpcDropPoolDefinition): NpcDropPool | undefined {
    const entries = def.entries
        .map((entry) => resolveDropEntry(entry))
        .filter((entry): entry is NpcDropEntry => entry !== undefined);
    if (entries.length === 0) return undefined;
    const normalizedEntries = entries
        .map((entry) => ({
            ...entry,
            probability: Math.max(0, Math.min(1, entry.probability ?? 0)),
        }))
        .filter((entry) => (entry.probability ?? 0) > 0);
    if (normalizedEntries.length === 0) return undefined;
    const totalProbability = normalizedEntries.reduce(
        (sum, entry) => sum + (entry.probability ?? 0),
        0,
    );
    return {
        kind: def.kind,
        category: def.category,
        rolls: Math.max(1, def.rolls ?? 1),
        entries: normalizedEntries,
        nothingProbability: Math.max(0, 1 - Math.min(1, totalProbability)),
    };
}

export function resolveDropTable(def: NpcDropTableDefinition): NpcDropTable | undefined {
    const always = (def.always ?? [])
        .map((entry) => resolveDropEntry(entry))
        .filter((entry): entry is NpcDropEntry => entry !== undefined);
    const pools = (def.pools ?? [])
        .map((pool) => resolveDropPool(pool))
        .filter((pool): pool is NpcDropPool => pool !== undefined);
    if (always.length === 0 && pools.length === 0) return undefined;
    return { always, pools };
}
