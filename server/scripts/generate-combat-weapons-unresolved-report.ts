import fs from "fs";
import path from "path";

import items from "../../server/data/items.json";
import { weaponDataMap } from "../gamemodes/vanilla/data/weapons";

type RawItem = {
    id: number;
    name?: string;
    equipmentType?: string;
    weaponInterface?: string;
    noted?: boolean;
};

type CategoryBucket = {
    category: string;
    items: string[];
};

type Candidate = {
    id: number;
    name: string;
    weaponInterface?: string;
    score: number;
};

type UnresolvedEntry = {
    category: string;
    listedName: string;
    classification: "not_in_items_snapshot" | "likely_alias_or_rename" | "ambiguous_manual_mapping";
    candidates: Candidate[];
};

const CATEGORY_HEADERS = new Set([
    "Two-handed sword",
    "Axe",
    "Banner",
    "Blunt",
    "Bludgeon",
    "Bulwark",
    "Claw",
    "Egg",
    "Partisan",
    "Pickaxe",
    "Polearm",
    "Polestaff",
    "Scythe",
    "Slash sword",
    "Spear",
    "Spiked",
    "Stab sword",
    "Unarmed",
    "Whip",
    "Blaster",
    "Bow",
    "Chinchompa",
    "Crossbow",
    "Gun",
    "Thrown",
    "Bladed staff",
    "Powered Staff",
    "Staff",
    "Salamander",
    "Multi-style",
]);

const STOP_TOKENS = new Set([
    "of",
    "the",
    "and",
    "a",
    "an",
    "mode",
    "man",
    "standing",
    "last",
    "deadman",
    "trailblazer",
    "reloaded",
]);

function isSkippableLine(line: string): boolean {
    if (!line) return true;
    if (
        line === "Melee weapons" ||
        line === "Ranged weapons" ||
        line === "Magic weapons" ||
        line === "Other"
    )
        return true;
    if (line.startsWith("Combat style")) return true;
    if (line.startsWith("Consisting")) return true;
    if (line.startsWith("Bows with ")) return true;
    if (line.startsWith("Crossbows with ")) return true;
    if (line.startsWith("Multi-style is exactly like")) return true;
    if (line.startsWith("The style used when the player has no weapon equipped.")) return true;
    if (line.startsWith("Bludgeon is a subset of blunt")) return true;
    if (line.includes("Attack type") && line.includes("Weapon style")) return true;
    if (line.includes("Experience") && line.includes("Level boost")) return true;
    if (/^\+?\d+ /.test(line)) return true;
    return false;
}

function parseWeaponList(markdown: string): CategoryBucket[] {
    const lines = markdown.split(/\r?\n/).map((line) => line.trim());
    const buckets: CategoryBucket[] = [];
    let current: CategoryBucket | undefined;

    for (const line of lines) {
        if (!line) continue;

        if (CATEGORY_HEADERS.has(line)) {
            current = { category: line, items: [] };
            buckets.push(current);
            continue;
        }

        if (!current || isSkippableLine(line)) continue;

        if (
            /^(Chop|Slash|Smash|Block|Hack|Punch|Kick|Pound|Pummel|Accurate|Rapid|Longrange|Scorch|Flare|Blaze|Jab|Swipe|Fend|Reap|Lunge|Spike|Impale|Stab|Flick|Lash|Deflect|Short fuse|Medium fuse|Long fuse|Aim and Fire|Melee|Ranged|Magic|Spell|Focus|Bash)\b/.test(
                line,
            )
        ) {
            continue;
        }

        current.items.push(line);
    }

    return buckets;
}

function normalizeName(name: string): string {
    return name
        .toLowerCase()
        .replace(/\u2019/g, "'")
        .replace(
            /\((last man standing|deadman mode|deadman|bh|or|cr|e|i|t|the gauntlet|trailblazer reloaded|trailblazer|attuned|basic|perfected|a|u)\)/g,
            "",
        )
        .replace(/\((p\+\+|p\+|p|kp)\)/g, "")
        .replace(/[^a-z0-9' ]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function tokenize(name: string): string[] {
    return normalizeName(name)
        .split(" ")
        .map((token) => token.trim())
        .filter((token) => token.length > 1 && !STOP_TOKENS.has(token));
}

function buildIndexes(defs: RawItem[]) {
    const exact = new Map<string, RawItem[]>();
    const normalized = new Map<string, RawItem[]>();
    for (const def of defs) {
        if (!def.name || def.noted) continue;
        const exactBucket = exact.get(def.name) ?? [];
        exactBucket.push(def);
        exact.set(def.name, exactBucket);

        const normalizedName = normalizeName(def.name);
        const normalizedBucket = normalized.get(normalizedName) ?? [];
        normalizedBucket.push(def);
        normalized.set(normalizedName, normalizedBucket);
    }
    return { exact, normalized };
}

function chooseBestMatch(candidates: RawItem[]): RawItem | undefined {
    return candidates.slice().sort((a, b) => {
        const ifaceA = a.weaponInterface ? 0 : 1;
        const ifaceB = b.weaponInterface ? 0 : 1;
        if (ifaceA !== ifaceB) return ifaceA - ifaceB;
        return a.id - b.id;
    })[0];
}

function scoreCandidate(listedName: string, itemName: string): number {
    const listedNormalized = normalizeName(listedName);
    const itemNormalized = normalizeName(itemName);
    if (!listedNormalized || !itemNormalized) return 0;
    if (listedNormalized === itemNormalized) return 1;
    if (listedNormalized.includes(itemNormalized) || itemNormalized.includes(listedNormalized))
        return 0.85;

    const listedTokens = new Set(tokenize(listedName));
    const itemTokens = new Set(tokenize(itemName));
    if (listedTokens.size === 0 || itemTokens.size === 0) return 0;

    let shared = 0;
    for (const token of listedTokens) {
        if (itemTokens.has(token)) shared++;
    }
    if (shared === 0) return 0;

    const overlap = shared / Math.max(listedTokens.size, itemTokens.size);
    const coverage = shared / listedTokens.size;
    return overlap * 0.6 + coverage * 0.4;
}

function getFuzzyCandidates(listedName: string, defs: RawItem[]): Candidate[] {
    const candidates: Candidate[] = [];
    for (const def of defs) {
        if (!def.name || def.noted) continue;
        const score = scoreCandidate(listedName, def.name);
        if (score < 0.55) continue;
        candidates.push({
            id: def.id,
            name: def.name,
            weaponInterface: def.weaponInterface,
            score,
        });
    }

    candidates.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.id - b.id;
    });

    return candidates.slice(0, 5);
}

function classifyUnresolved(
    listedName: string,
    defs: RawItem[],
): Omit<UnresolvedEntry, "category" | "listedName"> {
    const candidates = getFuzzyCandidates(listedName, defs);
    if (candidates.length === 0) {
        return { classification: "not_in_items_snapshot", candidates: [] };
    }
    if (
        candidates.length === 1 ||
        (candidates[0].score >= 0.8 && (candidates[1]?.score ?? 0) < 0.7)
    ) {
        return { classification: "likely_alias_or_rename", candidates };
    }
    return { classification: "ambiguous_manual_mapping", candidates };
}

function formatCandidate(candidate: Candidate): string {
    const parts = [`\`${candidate.name}\``, `id=\`${candidate.id}\``];
    if (candidate.weaponInterface) parts.push(`iface=\`${candidate.weaponInterface}\``);
    parts.push(`score=\`${candidate.score.toFixed(2)}\``);
    return parts.join(", ");
}

function main(): void {
    const listPath = path.resolve(__dirname, "../../docs/combat-weapons-list.md");
    const reportPath = path.resolve(__dirname, "../../docs/combat-weapons-unresolved-report.md");
    const markdown = fs.readFileSync(listPath, "utf8");
    const buckets = parseWeaponList(markdown);
    const defs = (items as RawItem[]).filter((item) => !item.noted);
    const indexes = buildIndexes(defs);

    const unresolved: UnresolvedEntry[] = [];
    let totalListed = 0;
    let resolved = 0;

    for (const bucket of buckets) {
        for (const listedName of bucket.items) {
            totalListed++;
            const exact = indexes.exact.get(listedName);
            const normalized = indexes.normalized.get(normalizeName(listedName));
            const match = chooseBestMatch(exact ?? normalized ?? []);
            if (match) {
                if (weaponDataMap.has(match.id)) {
                    resolved++;
                }
                continue;
            }

            const classified = classifyUnresolved(listedName, defs);
            unresolved.push({
                category: bucket.category,
                listedName,
                classification: classified.classification,
                candidates: classified.candidates,
            });
        }
    }

    const byClass = {
        not_in_items_snapshot: unresolved.filter(
            (entry) => entry.classification === "not_in_items_snapshot",
        ),
        likely_alias_or_rename: unresolved.filter(
            (entry) => entry.classification === "likely_alias_or_rename",
        ),
        ambiguous_manual_mapping: unresolved.filter(
            (entry) => entry.classification === "ambiguous_manual_mapping",
        ),
    };

    const byCategory = new Map<string, number>();
    for (const entry of unresolved) {
        byCategory.set(entry.category, (byCategory.get(entry.category) ?? 0) + 1);
    }

    const categoryLines = Array.from(byCategory.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([category, count]) => `| ${category} | ${count} |`)
        .join("\n");

    const sections = [
        ["not_in_items_snapshot", "Not In Current items.json"],
        ["likely_alias_or_rename", "Likely Alias / Rename"],
        ["ambiguous_manual_mapping", "Ambiguous / Manual Mapping"],
    ] as const;

    const body = sections
        .map(([key, title]) => {
            const entries = byClass[key];
            const lines = entries
                .slice()
                .sort(
                    (a, b) =>
                        a.category.localeCompare(b.category) ||
                        a.listedName.localeCompare(b.listedName),
                )
                .map((entry) => {
                    const candidateLine =
                        entry.candidates.length > 0
                            ? `  Candidates: ${entry.candidates.map(formatCandidate).join("; ")}`
                            : "";
                    return `- [${entry.category}] \`${entry.listedName}\`${
                        candidateLine ? `\n${candidateLine}` : ""
                    }`;
                })
                .join("\n");
            return `## ${title}\n\nCount: \`${entries.length}\`\n\n${lines || "_None_"}\n`;
        })
        .join("\n");

    const report = `# Combat Weapons Unresolved Report

Generated from [docs/combat-weapons-list.md](./combat-weapons-list.md) against the current \`server/data/items.json\` snapshot and live \`server/data/weapons.ts\` coverage.

## Summary

- Listed names: \`${totalListed}\`
- Resolved names already covered by weapon data: \`${resolved}\`
- Unresolved names: \`${unresolved.length}\`
- Not in current items snapshot: \`${byClass.not_in_items_snapshot.length}\`
- Likely alias / rename: \`${byClass.likely_alias_or_rename.length}\`
- Ambiguous / manual mapping: \`${byClass.ambiguous_manual_mapping.length}\`

## Unresolved By Category

| Category | Count |
| --- | ---: |
${categoryLines}

${body}`;

    fs.writeFileSync(reportPath, report, "utf8");
    console.log(`Wrote ${reportPath}`);
}

main();
