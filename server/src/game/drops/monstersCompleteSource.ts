import fs from "fs";
import path from "path";

import { getItemDefinition } from "../../data/items";
import type { ImportedMonsterDefinition, NpcDropEntryDefinition } from "./types";

type RawMonsterDrop = {
    id?: number;
    name?: string;
    quantity?: string;
    rarity?: number;
    rolls?: number;
};

type RawMonsterEntry = {
    name?: string;
    combat_level?: number;
    duplicate?: boolean;
    incomplete?: boolean;
    drops?: RawMonsterDrop[];
};

const MONSTERS_COMPLETE_PATH = path.resolve("references/monsters-complete.json");

const EXCLUDED_NAME_PREFIXES = [
    "clue scroll",
    "reward casket",
    "jar of ",
    "pet ",
    "brimstone key",
    "key (elite)",
];

let cachedEntries: ImportedMonsterDefinition[] | undefined;

function shouldSkipDrop(drop: RawMonsterDrop): boolean {
    const name = (drop.name ?? "")
        .replace(/<!--.*?-->/g, "")
        .trim()
        .toLowerCase();
    if (!name) return true;
    if (EXCLUDED_NAME_PREFIXES.some((prefix) => name.startsWith(prefix))) return true;
    const itemId = drop.id ?? -1;
    return !getItemDefinition(itemId);
}

function toEntry(drop: RawMonsterDrop): NpcDropEntryDefinition | undefined {
    if (shouldSkipDrop(drop)) return undefined;
    return {
        itemId: drop.id ?? -1,
        quantity: drop.quantity ?? "1",
        rarity: (drop.rarity ?? 0) * Math.max(1, drop.rolls ?? 1),
    };
}

function normalizeRawMonster(raw: RawMonsterEntry): ImportedMonsterDefinition | undefined {
    const entries = (raw.drops ?? [])
        .map((drop) => toEntry(drop))
        .filter((drop): drop is NpcDropEntryDefinition => drop !== undefined);
    if (entries.length === 0) return undefined;
    const hasNumericRarity = (
        entry: NpcDropEntryDefinition,
    ): entry is NpcDropEntryDefinition & { rarity: number } => typeof entry.rarity === "number";
    const always = entries.filter((entry) => hasNumericRarity(entry) && entry.rarity >= 1);
    const main = entries.filter(
        (entry) => hasNumericRarity(entry) && entry.rarity > 0 && entry.rarity < 1,
    );
    return {
        name: (raw.name ?? "").trim(),
        combatLevel: raw.combat_level,
        duplicate: raw.duplicate === true,
        incomplete: raw.incomplete === true,
        table: {
            always,
            pools: main.length
                ? [
                      {
                          kind: "weighted",
                          category: "main",
                          entries: main,
                      },
                  ]
                : undefined,
        },
    };
}

function extractObjectAt(
    text: string,
    startIndex: number,
): { json: string; nextIndex: number } | undefined {
    if (text[startIndex] !== "{") return undefined;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = startIndex; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            if (escaped) {
                escaped = false;
                continue;
            }
            if (ch === "\\") {
                escaped = true;
                continue;
            }
            if (ch === '"') {
                inString = false;
            }
            continue;
        }
        if (ch === '"') {
            inString = true;
            continue;
        }
        if (ch === "{") {
            depth++;
            continue;
        }
        if (ch === "}") {
            depth--;
            if (depth === 0) {
                return {
                    json: text.slice(startIndex, i + 1),
                    nextIndex: i + 1,
                };
            }
        }
    }
    return undefined;
}

function parseTopLevelEntries(text: string): RawMonsterEntry[] {
    const out: RawMonsterEntry[] = [];
    let index = text.indexOf("{");
    if (index === -1) return out;
    index++;
    while (index < text.length) {
        while (index < text.length && /[\s,]/.test(text[index])) index++;
        if (index >= text.length || text[index] !== '"') break;
        const keyEnd = text.indexOf('"', index + 1);
        if (keyEnd === -1) break;
        index = keyEnd + 1;
        while (index < text.length && /[\s:]/.test(text[index])) index++;
        const extracted = extractObjectAt(text, index);
        if (!extracted) break;
        try {
            out.push(JSON.parse(extracted.json) as RawMonsterEntry);
        } catch {
            break;
        }
        index = extracted.nextIndex;
    }
    return out;
}

export function loadMonstersCompleteDefinitions(): ImportedMonsterDefinition[] {
    if (cachedEntries) return cachedEntries;
    try {
        const rawText = fs.readFileSync(MONSTERS_COMPLETE_PATH, "utf8");
        cachedEntries = parseTopLevelEntries(rawText)
            .map((entry) => normalizeRawMonster(entry))
            .filter((entry): entry is ImportedMonsterDefinition => entry !== undefined);
    } catch {
        cachedEntries = [];
    }
    return cachedEntries;
}
