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

const SECTION_HEADERS = new Set(["Melee weapons", "Ranged weapons", "Magic weapons", "Other"]);

function isSkippableLine(line: string): boolean {
    if (!line) return true;
    if (SECTION_HEADERS.has(line)) return true;
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
        if (!line) {
            continue;
        }

        if (CATEGORY_HEADERS.has(line)) {
            current = { category: line, items: [] };
            buckets.push(current);
            continue;
        }

        if (!current || isSkippableLine(line)) {
            continue;
        }

        // Ignore the combat-style rows between the category header and the actual item list.
        if (
            /^(Chop|Slash|Smash|Block|Hack|Punch|Kick|Pound|Pummel|Accurate|Rapid|Longrange|Scorch|Flare|Blaze|Jab|Swipe|Fend|Reap|Lunge|Spike|Impale|Stab|Flick|Lash|Deflect|Short fuse|Medium fuse|Long fuse|Aim and Fire|Melee|Ranged|Magic|Spell|Focus|Bash)\b/.test(
                line,
            )
        ) {
            continue;
        }

        if (current) {
            current.items.push(line);
        }
    }

    return buckets;
}

function normalizeName(name: string): string {
    return name
        .toLowerCase()
        .replace(/\u2019/g, "'")
        .replace(
            /\(last man standing\)|\(deadman mode\)|\(deadman\)|\(bh\)|\(or\)|\(cr\)|\(e\)|\(i\)|\(t\)/g,
            "",
        )
        .replace(/\(the gauntlet\)|\(trailblazer\)|\(trailblazer reloaded\)/g, "")
        .replace(/\(attuned\)|\(basic\)|\(perfected\)|\(a\)/g, "")
        .replace(/\(p\+\+\)|\(p\+\)|\(p\)|\(kp\)/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

function buildItemIndexes(defs: RawItem[]) {
    const exact = new Map<string, RawItem[]>();
    const normalized = new Map<string, RawItem[]>();

    for (const def of defs) {
        if (!def?.name || def.noted) continue;
        const name = def.name.trim();
        if (!name) continue;

        const exactBucket = exact.get(name) ?? [];
        exactBucket.push(def);
        exact.set(name, exactBucket);

        const normalizedName = normalizeName(name);
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

function main(): void {
    const listPath = path.resolve(__dirname, "../../docs/combat-weapons-list.md");
    const markdown = fs.readFileSync(listPath, "utf8");
    const buckets = parseWeaponList(markdown);
    const itemDefs = items as RawItem[];
    const indexes = buildItemIndexes(itemDefs);

    let totalListed = 0;
    let resolved = 0;
    let covered = 0;

    for (const bucket of buckets) {
        const uncovered: Array<{
            listedName: string;
            itemId?: number;
            resolvedName?: string;
            weaponInterface?: string;
        }> = [];

        for (const listedName of bucket.items) {
            totalListed++;
            const exact = indexes.exact.get(listedName);
            const normalized = indexes.normalized.get(normalizeName(listedName));
            const match = chooseBestMatch(exact ?? normalized ?? []);

            if (match) {
                resolved++;
                if (weaponDataMap.has(match.id)) {
                    covered++;
                    continue;
                }
                uncovered.push({
                    listedName,
                    itemId: match.id,
                    resolvedName: match.name,
                    weaponInterface: match.weaponInterface,
                });
            } else {
                uncovered.push({ listedName });
            }
        }

        console.log(`\n## ${bucket.category}`);
        console.log(`listed=${bucket.items.length} uncovered=${uncovered.length}`);
        for (const entry of uncovered.slice(0, 40)) {
            const parts = [entry.listedName];
            if (entry.itemId !== undefined) parts.push(`id=${entry.itemId}`);
            if (entry.resolvedName && entry.resolvedName !== entry.listedName) {
                parts.push(`match="${entry.resolvedName}"`);
            }
            if (entry.weaponInterface) parts.push(`iface=${entry.weaponInterface}`);
            console.log(`- ${parts.join(" | ")}`);
        }
        if (uncovered.length > 40) {
            console.log(`- ... ${uncovered.length - 40} more`);
        }
    }

    console.log("\n## Summary");
    console.log(`listed=${totalListed}`);
    console.log(`resolved_to_item=${resolved}`);
    console.log(`already_in_weapon_data=${covered}`);
    console.log(`missing_weapon_data=${resolved - covered}`);
    console.log(`unresolved_names=${totalListed - resolved}`);
}

main();
