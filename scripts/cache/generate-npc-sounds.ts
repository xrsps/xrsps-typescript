import fs from "fs";
import path from "path";

import { resolveCache } from "../../mcp/lib/cache";
import { DbRepository } from "../../src/rs/config/db/DbRepository";
import { NpcType } from "../../src/rs/config/npctype/NpcType";

type SoundType = "attack" | "death" | "hit" | "defend";
const CORE_TYPES: Array<Exclude<SoundType, "defend">> = ["attack", "hit", "death"];
const ALL_TYPES: SoundType[] = ["attack", "hit", "defend", "death"];

type SoundPick = {
    id: number;
    soundName: string;
    rank: number;
};

type NpcCandidate = {
    id: number;
    name: string;
    npcKey: string;
    canonicalKey: string;
    key?: string;
    source?: "exact" | "alias" | "token" | "signature";
    signature?: string;
    combatCapable: boolean;
    spawned: boolean;
};

type CoverageSet = {
    name: string;
    npcs: NpcCandidate[];
};

const FULL_NAME_ALIASES: Record<string, string> = {
    man: "human",
    woman: "human",
};

function normalizeKey(value: string | undefined | null): string {
    return (value || "").toLowerCase().replace(/[^a-z]/g, "");
}

function tokenizeName(value: string): string[] {
    const parts = value.toLowerCase().match(/[a-z]+/g) ?? [];
    return parts.filter((part) => part.length > 0);
}

function singularize(token: string): string {
    if (token.length <= 3) return token;
    if (token.endsWith("ies") && token.length > 4) {
        return `${token.slice(0, -3)}y`;
    }
    if (token.endsWith("es") && token.length > 4) {
        return token.slice(0, -2);
    }
    if (token.endsWith("s") && !token.endsWith("ss")) {
        return token.slice(0, -1);
    }
    return token;
}

function extractKey(soundName: string, soundType: SoundType): string | undefined {
    const name = (soundName || "").toLowerCase();
    if (!name) return undefined;
    let match: RegExpMatchArray | null = null;
    if (soundType === "death") {
        match = name.match(/^(.*)_death\d*$/);
    } else if (soundType === "attack") {
        match = name.match(/^(.*)_attack\d*$/);
    } else if (soundType === "hit") {
        match = name.match(/^(.*)_hit\d*$/);
    } else if (soundType === "defend") {
        match = name.match(/^(.*)_(?:defend|block)(?:_\d+|\d*)$/);
    }
    if (!match) return undefined;
    const base = match[1] ?? "";
    const key = normalizeKey(base);
    return key || undefined;
}

function parseVariantNumber(
    soundName: string,
    key: string,
    patterns: { exact: RegExp; suffixed: RegExp },
): number {
    if (patterns.exact.test(soundName)) return 0;
    const m = soundName.match(patterns.suffixed);
    if (!m) return 1000;
    const nRaw = m[1] ?? m[2] ?? "";
    const n = Number(nRaw);
    if (!Number.isFinite(n)) return 100;
    return Math.max(1, n | 0);
}

function pickRank(soundName: string, type: SoundType, key: string): number {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (type === "attack") {
        return parseVariantNumber(soundName, key, {
            exact: new RegExp(`^${escaped}_attack$`),
            suffixed: new RegExp(`^${escaped}_attack(?:_(\\d+)|(\\d+))$`),
        });
    }
    if (type === "death") {
        return parseVariantNumber(soundName, key, {
            exact: new RegExp(`^${escaped}_death$`),
            suffixed: new RegExp(`^${escaped}_death(?:_(\\d+)|(\\d+))$`),
        });
    }
    if (type === "hit") {
        return parseVariantNumber(soundName, key, {
            exact: new RegExp(`^${escaped}_hit$`),
            suffixed: new RegExp(`^${escaped}_hit(?:_(\\d+)|(\\d+))$`),
        });
    }
    if (new RegExp(`^${escaped}_defend$`).test(soundName)) return 0;
    if (new RegExp(`^${escaped}_block$`).test(soundName)) return 1;
    const defendMatch = soundName.match(new RegExp(`^${escaped}_defend(?:_(\\d+)|(\\d+))$`));
    if (defendMatch) {
        const nRaw = defendMatch[1] ?? defendMatch[2] ?? "1";
        return 2 + ((Number(nRaw) || 1) - 1);
    }
    const blockMatch = soundName.match(new RegExp(`^${escaped}_block(?:_(\\d+)|(\\d+))$`));
    if (blockMatch) {
        const nRaw = blockMatch[1] ?? blockMatch[2] ?? "1";
        return 10 + ((Number(nRaw) || 1) - 1);
    }
    return 1000;
}

function coreCountForKey(
    key: string,
    soundsByType: Record<SoundType, Map<string, SoundPick>>,
): number {
    let count = 0;
    for (const type of CORE_TYPES) {
        if (soundsByType[type].has(key)) count++;
    }
    return count;
}

function canProvideAny(
    key: string,
    soundsByType: Record<SoundType, Map<string, SoundPick>>,
): boolean {
    for (const type of ALL_TYPES) {
        if (soundsByType[type].has(key)) return true;
    }
    return false;
}

function chooseTokenKey(
    name: string,
    availableKeys: Set<string>,
    soundsByType: Record<SoundType, Map<string, SoundPick>>,
): string | undefined {
    const tokensRaw = tokenizeName(name);
    if (tokensRaw.length === 0) return undefined;
    const tokens = tokensRaw.map((token) => singularize(token));
    const candidates = new Map<string, { coreCount: number; length: number; tokenSpan: number }>();

    const tryCandidate = (candidate: string, tokenSpan: number) => {
        if (!candidate || candidate.length < 3) return;
        if (!availableKeys.has(candidate)) return;
        const coreCount = coreCountForKey(candidate, soundsByType);
        if (coreCount <= 0) return;
        const existing = candidates.get(candidate);
        const score = { coreCount, length: candidate.length, tokenSpan };
        if (!existing) {
            candidates.set(candidate, score);
            return;
        }
        if (
            score.coreCount > existing.coreCount ||
            (score.coreCount === existing.coreCount && score.length > existing.length) ||
            (score.coreCount === existing.coreCount &&
                score.length === existing.length &&
                score.tokenSpan > existing.tokenSpan)
        ) {
            candidates.set(candidate, score);
        }
    };

    // Contiguous token n-grams (longest first gives better family matches).
    for (let span = tokens.length; span >= 1; span--) {
        for (let start = 0; start + span <= tokens.length; start++) {
            const joined = tokens.slice(start, start + span).join("");
            tryCandidate(joined, span);
        }
    }

    if (candidates.size === 0) return undefined;
    const ranked = Array.from(candidates.entries()).sort((a, b) => {
        const sa = a[1];
        const sb = b[1];
        if (sb.coreCount !== sa.coreCount) return sb.coreCount - sa.coreCount;
        if (sb.length !== sa.length) return sb.length - sa.length;
        if (sb.tokenSpan !== sa.tokenSpan) return sb.tokenSpan - sa.tokenSpan;
        return a[0].localeCompare(b[0]);
    });
    if (ranked.length === 1) return ranked[0][0];
    const top = ranked[0][1];
    const second = ranked[1][1];
    const tie =
        top.coreCount === second.coreCount &&
        top.length === second.length &&
        top.tokenSpan === second.tokenSpan;
    return tie ? undefined : ranked[0][0];
}

function buildCoverageLine(
    label: string,
    set: NpcCandidate[],
    mappedById: Map<number, Record<SoundType, number>>,
) {
    const total = set.length;
    let attack = 0;
    let hit = 0;
    let death = 0;
    let defend = 0;
    let core = 0;
    for (const npc of set) {
        const mapped = mappedById.get(npc.id);
        const hasAttack = !!mapped?.attack;
        const hasHit = !!mapped?.hit;
        const hasDeath = !!mapped?.death;
        const hasDefend = !!mapped?.defend;
        if (hasAttack) attack++;
        if (hasHit) hit++;
        if (hasDeath) death++;
        if (hasDefend) defend++;
        if (hasAttack && hasHit && hasDeath) core++;
    }
    const pct = (n: number) => (total > 0 ? ((n / total) * 100).toFixed(2) : "0.00");
    return `${label}: total=${total} core=${core}(${pct(core)}%) attack=${pct(attack)}% hit=${pct(
        hit,
    )}% death=${pct(death)}% defend=${pct(defend)}%`;
}

async function main() {
    const { cacheInfo, cacheSystem, factory } = resolveCache();
    const dbRepository = new DbRepository(cacheSystem);
    const npcLoader = factory.getNpcTypeLoader();
    const basLoader = factory.getBasTypeLoader();

    const soundsByType: Record<SoundType, Map<string, SoundPick>> = {
        attack: new Map(),
        death: new Map(),
        hit: new Map(),
        defend: new Map(),
    };

    const table88Rows = dbRepository.getRows(88);
    for (const row of table88Rows) {
        const sounds = row.getColumn(2)?.values;
        if (!Array.isArray(sounds)) continue;
        for (let i = 0; i + 1 < sounds.length; i += 2) {
            const rawName = sounds[i];
            const rawId = sounds[i + 1];
            const soundName = typeof rawName === "string" ? rawName.toLowerCase() : "";
            const soundId = Number(rawId) | 0;
            if (!soundName || !(soundId > 0)) continue;

            for (const type of ALL_TYPES) {
                const key = extractKey(soundName, type);
                if (!key) continue;
                const rank = pickRank(soundName, type, key);
                const pick: SoundPick = { id: soundId, soundName, rank };
                const existing = soundsByType[type].get(key);
                if (
                    !existing ||
                    pick.rank < existing.rank ||
                    (pick.rank === existing.rank && pick.id < existing.id)
                ) {
                    soundsByType[type].set(key, pick);
                }
            }
        }
    }

    const availableKeys = new Set<string>();
    for (const type of ALL_TYPES) {
        for (const key of soundsByType[type].keys()) {
            availableKeys.add(key);
        }
    }

    const spawnsPath = path.resolve(__dirname, "../../server/data/npc-spawns.json");
    const spawnRows = JSON.parse(fs.readFileSync(spawnsPath, "utf8")) as Array<{ id: number }>;
    const spawnedIds = new Set<number>((spawnRows || []).map((row) => Number(row.id) | 0));

    const candidates: NpcCandidate[] = [];
    const npcCount = npcLoader.getCount();
    for (let npcId = 0; npcId < npcCount; npcId++) {
        const npc = npcLoader.load(npcId) as NpcType | undefined;
        if (!npc) continue;
        const name = String(npc.name || "").trim();
        if (!name || name.toLowerCase() === "null") continue;

        const npcKey = normalizeKey(name);
        if (!npcKey) continue;
        const canonicalKey = FULL_NAME_ALIASES[npcKey] ?? npcKey;
        const actions = Array.isArray(npc.actions) ? npc.actions : [];
        const combatCapable =
            (Number(npc.combatLevel) | 0) > 0 ||
            actions.some(
                (action) => typeof action === "string" && action.toLowerCase() === "attack",
            );
        candidates.push({
            id: npc.id | 0,
            name,
            npcKey,
            canonicalKey,
            combatCapable,
            spawned: spawnedIds.has(npc.id | 0),
        });
    }

    // Pass 1: exact / alias / token
    for (const npc of candidates) {
        if (canProvideAny(npc.canonicalKey, soundsByType)) {
            npc.key = npc.canonicalKey;
            npc.source = npc.canonicalKey === npc.npcKey ? "exact" : "alias";
            continue;
        }
        const tokenKey = chooseTokenKey(npc.name, availableKeys, soundsByType);
        if (tokenKey) {
            npc.key = tokenKey;
            npc.source = "token";
        }
    }

    // Pass 2: signature propagation
    const signatureKeyCounts = new Map<string, Map<string, number>>();
    const signatureByNpcId = new Map<number, string>();
    for (const npc of candidates) {
        let signature = "";
        try {
            const t = npcLoader.load(npc.id) as NpcType | undefined;
            if (t) {
                const idle = t.getIdleSeqId(basLoader) | 0;
                const walk = t.getWalkSeqId(basLoader) | 0;
                signature = `${idle}:${walk}:${Math.max(1, t.size | 0)}`;
            }
        } catch {}
        if (!signature) continue;
        signatureByNpcId.set(npc.id, signature);
        npc.signature = signature;
        if (!npc.key || !npc.source || npc.source === "signature") continue;
        const byKey = signatureKeyCounts.get(signature) ?? new Map<string, number>();
        byKey.set(npc.key, (byKey.get(npc.key) ?? 0) + 1);
        signatureKeyCounts.set(signature, byKey);
    }

    for (const npc of candidates) {
        if (npc.key) continue;
        const signature = signatureByNpcId.get(npc.id);
        if (!signature) continue;
        const counts = signatureKeyCounts.get(signature);
        if (!counts || counts.size === 0) continue;
        const ranked = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
        const [bestKey, bestCount] = ranked[0];
        const secondCount = ranked.length > 1 ? ranked[1][1] : 0;
        const total = Array.from(counts.values()).reduce((sum, value) => sum + value, 0);
        const ratio = total > 0 ? bestCount / total : 0;
        if (bestCount < 3) continue;
        if (ratio < 0.75) continue;
        if (bestCount === secondCount) continue;
        if (!canProvideAny(bestKey, soundsByType)) continue;
        npc.key = bestKey;
        npc.source = "signature";
    }

    const mappedById = new Map<number, Record<SoundType, number>>();
    for (const npc of candidates) {
        if (!npc.key) continue;
        const mapped: Record<SoundType, number> = { attack: 0, death: 0, hit: 0, defend: 0 };
        for (const type of ALL_TYPES) {
            mapped[type] = soundsByType[type].get(npc.key)?.id ?? 0;
        }
        if (!mapped.attack && !mapped.death && !mapped.hit && !mapped.defend) continue;
        mappedById.set(npc.id, mapped);
    }

    const generated: {
        cache: { name: string; revision: number; timestamp: string };
        generatedAt: string;
        npcs: Record<string, Partial<Record<SoundType, number>>>;
    } = {
        cache: {
            name: cacheInfo.name,
            revision: cacheInfo.revision,
            timestamp: cacheInfo.timestamp,
        },
        generatedAt: new Date().toISOString(),
        npcs: {},
    };
    for (const [npcId, sounds] of mappedById.entries()) {
        const out: Partial<Record<SoundType, number>> = {};
        for (const type of ALL_TYPES) {
            const value = sounds[type];
            if (value > 0) out[type] = value | 0;
        }
        generated.npcs[String(npcId)] = out;
    }

    const unresolved = candidates
        .map((npc) => {
            const sounds = mappedById.get(npc.id);
            const missing: string[] = [];
            if (!(sounds?.attack > 0)) missing.push("attack");
            if (!(sounds?.hit > 0)) missing.push("hit");
            if (!(sounds?.death > 0)) missing.push("death");
            if (!(sounds?.defend > 0)) missing.push("defend");
            return {
                id: npc.id,
                name: npc.name,
                key: npc.key,
                source: npc.source,
                combatCapable: npc.combatCapable,
                spawned: npc.spawned,
                missing,
            };
        })
        .filter((entry) => entry.missing.length > 0);

    const unresolvedByName = new Map<
        string,
        { count: number; sampleIds: number[]; missingCore: number }
    >();
    for (const row of unresolved) {
        if (!(row.combatCapable && row.spawned)) continue;
        if (
            !(
                row.missing.includes("attack") ||
                row.missing.includes("hit") ||
                row.missing.includes("death")
            )
        )
            continue;
        const k = row.name.toLowerCase();
        const existing = unresolvedByName.get(k) ?? { count: 0, sampleIds: [], missingCore: 0 };
        existing.count++;
        if (existing.sampleIds.length < 8) existing.sampleIds.push(row.id | 0);
        existing.missingCore++;
        unresolvedByName.set(k, existing);
    }
    const unresolvedTop = Array.from(unresolvedByName.entries())
        .map(([name, value]) => ({ name, ...value }))
        .sort((a, b) => b.count - a.count);

    const dataDir = path.resolve(__dirname, "../../server/gamemodes/vanilla/data");
    const generatedPath = path.join(dataDir, "npc-sounds.generated.json");
    const unresolvedPath = path.join(dataDir, "npc-sounds.unresolved.json");
    const overridesPath = path.join(dataDir, "npc-sounds.overrides.json");
    fs.writeFileSync(generatedPath, JSON.stringify(generated, null, 2), "utf8");
    fs.writeFileSync(
        unresolvedPath,
        JSON.stringify(
            {
                cache: generated.cache,
                generatedAt: generated.generatedAt,
                summary: {
                    totalNamed: candidates.length,
                    totalMapped: mappedById.size,
                    unresolvedCount: unresolved.length,
                    spawnedCombatUnresolvedNames: unresolvedTop.length,
                },
                spawnedCombatTopUnresolvedNames: unresolvedTop.slice(0, 1000),
                unresolvedSample: unresolved.slice(0, 2000),
            },
            null,
            2,
        ),
        "utf8",
    );
    if (!fs.existsSync(overridesPath)) {
        fs.writeFileSync(
            overridesPath,
            JSON.stringify(
                {
                    cache: generated.cache,
                    generatedAt: generated.generatedAt,
                    npcs: {},
                },
                null,
                2,
            ),
            "utf8",
        );
    }

    const sets: CoverageSet[] = [
        { name: "all_named", npcs: candidates },
        { name: "combat_named", npcs: candidates.filter((npc) => npc.combatCapable) },
        { name: "spawned_named", npcs: candidates.filter((npc) => npc.spawned) },
        {
            name: "spawned_combat",
            npcs: candidates.filter((npc) => npc.spawned && npc.combatCapable),
        },
    ];

    console.log(
        `[npc-sounds] generated map for cache=${generated.cache.name} rev=${generated.cache.revision}`,
    );
    console.log(`[npc-sounds] wrote ${generatedPath} (${mappedById.size} mapped NPC ids)`);
    console.log(`[npc-sounds] wrote ${unresolvedPath}`);
    for (const set of sets) {
        console.log(`[npc-sounds] ${buildCoverageLine(set.name, set.npcs, mappedById)}`);
    }
}

main().catch((err) => {
    console.error(err?.stack || String(err));
    process.exit(1);
});
