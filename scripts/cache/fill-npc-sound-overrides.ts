import fs from "fs";
import path from "path";

import { resolveCache } from "../../mcp/lib/cache";
import { NpcSoundLookup } from "../../server/src/audio/NpcSoundLookup";
import { DbRepository } from "../../src/rs/config/db/DbRepository";

type SoundTuple = {
    attack: number;
    hit: number;
    death: number;
    defend?: number;
};

type Rule = {
    name: string;
    pattern: RegExp;
    sounds: SoundTuple;
    force?: boolean;
};

const HUMAN_SOUNDS: SoundTuple = { attack: 2564, hit: 513, death: 512, defend: 511 };
const VYREWATCH_SOUNDS: SoundTuple = { attack: 888, hit: 883, death: 889 };
const TZHAAR_SOUNDS: SoundTuple = { attack: 251, hit: 253, death: 252 };
const SKELETON_SOUNDS: SoundTuple = { attack: 776, hit: 513, death: 777 };
const HELLHOUND_SOUNDS: SoundTuple = { attack: 1187, hit: 1185, death: 1188 };
const SPIDER_SOUNDS: SoundTuple = { attack: 3605, hit: 3607, death: 3606 };

const RULES: Rule[] = [
    {
        name: "guard",
        pattern: /^guard$/,
        sounds: HUMAN_SOUNDS,
        force: true,
    },
    {
        name: "vyrewatch",
        pattern: /^(?:vyrewatch sentinel|vampyre juvinate|vampyre juvenile|feral vampyre)$/,
        sounds: VYREWATCH_SOUNDS,
    },
    {
        name: "skeleton",
        pattern: /^(?:skeleton|skeleton fremennik|skeleton mage)$/,
        sounds: SKELETON_SOUNDS,
    },
    {
        name: "tzhaar",
        pattern: /^(?:tzhaar-ket|tzhaar-xil)$/,
        sounds: TZHAAR_SOUNDS,
    },
    {
        name: "hellhound",
        pattern: /^hellhound$/,
        sounds: HELLHOUND_SOUNDS,
    },
    {
        name: "spider",
        pattern: /^spider$/,
        sounds: SPIDER_SOUNDS,
    },
    {
        name: "humanoid",
        pattern:
            /^(?:barbarian|soldier|dark wizard|outlaw|thief|monk of zamorak|sergeant|bandit|head guard|dark warrior|camp dweller|white knight|mugger|black knight|tyras guard|honour guard|knight of ardougne|archer|jail guard|mercenary|fortress guard|h\.a\.m\. guard|farmer|iorwerth warrior|khazard trooper|highwayman|rogue|necromancer|khazard guard|paladin|warrior|gardener|battle mage|combat instructor|shipyard worker|market guard|rebel archer|rebel warrior|gladiator)$/,
        sounds: HUMAN_SOUNDS,
    },
];

function loadJson<T>(filePath: string): T {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function ensureOverrideShape(value: any): {
    cache?: { name?: string; revision?: number; timestamp?: string };
    generatedAt?: string;
    strategy?: string;
    npcs: Record<string, Partial<SoundTuple>>;
} {
    if (!value || typeof value !== "object") return { npcs: {} };
    if (!value.npcs || typeof value.npcs !== "object") value.npcs = {};
    return value;
}

function pickRule(name: string): Rule | undefined {
    for (const rule of RULES) {
        if (rule.pattern.test(name)) return rule;
    }
    return undefined;
}

async function main() {
    const root = path.resolve(__dirname, "../../");
    const overridesPath = path.resolve(root, "server/gamemodes/vanilla/data/npc-sounds.overrides.json");
    const overridesRaw = fs.existsSync(overridesPath) ? loadJson<any>(overridesPath) : { npcs: {} };
    const overrides = ensureOverrideShape(overridesRaw);

    const { cacheInfo, cacheSystem, factory } = resolveCache();
    const dbRepository = new DbRepository(cacheSystem);
    const soundLookup = new NpcSoundLookup(dbRepository);
    soundLookup.initialize();

    const npcLoader = factory.getNpcTypeLoader();
    const npcCount = npcLoader.getCount();

    let touchedIds = 0;
    let newlyCoreResolved = 0;
    const touchedNames = new Set<string>();
    const touchedByRule = new Map<string, number>();

    for (let npcId = 0; npcId < npcCount; npcId++) {
        const npc = npcLoader.load(npcId);
        if (!npc) continue;
        const name = String(npc.name || "")
            .trim()
            .toLowerCase();
        if (!name || name === "null") continue;

        const actions = Array.isArray(npc.actions) ? npc.actions : [];
        const combatCapable =
            (Number(npc.combatLevel) | 0) > 0 ||
            actions.some(
                (action) => typeof action === "string" && action.toLowerCase() === "attack",
            );
        if (!combatCapable) continue;

        const rule = pickRule(name);
        if (!rule) continue;

        const attack = soundLookup.getSoundForNpc(npc as any, "attack");
        const hit = soundLookup.getSoundForNpc(npc as any, "hit");
        const death = soundLookup.getSoundForNpc(npc as any, "death");
        if (!rule.force && attack && hit && death) continue;

        const existing = overrides.npcs[String(npc.id)] ?? {};
        const beforeCore = !!existing.attack && !!existing.hit && !!existing.death;
        const next: Partial<SoundTuple> = { ...existing };

        if (rule.force) {
            next.attack = rule.sounds.attack;
            next.hit = rule.sounds.hit;
            next.death = rule.sounds.death;
            if (rule.sounds.defend) next.defend = rule.sounds.defend;
        } else {
            if (!next.attack) next.attack = rule.sounds.attack;
            if (!next.hit) next.hit = rule.sounds.hit;
            if (!next.death) next.death = rule.sounds.death;
            if (!next.defend && rule.sounds.defend) next.defend = rule.sounds.defend;
        }

        const changed =
            next.attack !== existing.attack ||
            next.hit !== existing.hit ||
            next.death !== existing.death ||
            next.defend !== existing.defend;
        if (!changed) continue;

        overrides.npcs[String(npc.id)] = next;
        touchedIds++;
        touchedNames.add(name);
        touchedByRule.set(rule.name, (touchedByRule.get(rule.name) ?? 0) + 1);
        const afterCore = !!next.attack && !!next.hit && !!next.death;
        if (!beforeCore && afterCore) newlyCoreResolved++;
    }

    const sortedRules = Array.from(touchedByRule.entries()).sort((a, b) => b[1] - a[1]);
    overrides.cache = {
        name: cacheInfo.name,
        revision: cacheInfo.revision,
        timestamp: cacheInfo.timestamp,
    };
    overrides.generatedAt = new Date().toISOString();
    overrides.strategy = "curated_rules_all_combat";

    fs.writeFileSync(overridesPath, JSON.stringify(overrides, null, 2), "utf8");
    console.log(`[npc-sounds] wrote ${overridesPath}`);
    console.log(
        `[npc-sounds] updated ${touchedIds} npc id(s), ${touchedNames.size} unique name(s), core +${newlyCoreResolved}`,
    );
    for (const [ruleName, count] of sortedRules) {
        console.log(`[npc-sounds] rule ${ruleName}: ${count}`);
    }
    console.log(`[npc-sounds] total overrides: ${Object.keys(overrides.npcs).length}`);
}

main().catch((err) => {
    console.error(err?.stack || String(err));
    process.exit(1);
});
