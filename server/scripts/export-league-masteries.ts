import fs from "fs";
import path from "path";

import { getCacheLoaderFactory } from "../../src/rs/cache/loader/CacheLoaderFactory";
import { LeagueMasteryDefinitions } from "../gamemodes/leagues-v/LeagueMasteryDefinitions";
import { logger } from "../src/utils/logger";
import { initCacheEnv } from "../src/world/CacheEnv";

type RelicData = {
    structId: number;
    name: string;
    description: string;
    hasItem: boolean;
};

type MasteryNodeData = {
    structId: number;
    name: string;
    description: string;
    category?: number; // 3=melee, 4=ranged, 5=magic, undefined=shared
};

type MasteryChallengeData = {
    structId: number;
    description: string;
};

function formatParamValue(value: unknown, maxLength?: number): unknown {
    const textValue = value as string | undefined;
    if (textValue?.constructor !== String) {
        return value;
    }
    const text = maxLength !== undefined ? textValue.substring(0, maxLength) : textValue;
    return `"${text}"`;
}

function formatLeagueMasteriesTs(
    relics: RelicData[],
    masteryNodes: MasteryNodeData[],
    challenges: MasteryChallengeData[],
): string {
    const relicLines = relics.map((r) => `  ${JSON.stringify(r)}`);
    const nodeLines = masteryNodes.map((n) => `  ${JSON.stringify(n)}`);
    const challengeLines = challenges.map((c) => `  ${JSON.stringify(c)}`);

    return (
        `import type { LeagueRelicRow, LeagueMasteryNodeRow, LeagueMasteryChallengeRow } from "./leagueTypes";\n\n` +
        `// Generated snapshot of cache league data.\n` +
        `// Source of truth: caches/ (r235)\n\n` +
        `// League 5 Relics (structs 1116-1135, param_879=name, param_880=desc)\n` +
        `export const LEAGUE_RELICS: LeagueRelicRow[] = [\n${relicLines.join(",\n")}\n];\n\n` +
        `// Combat mastery tree nodes (structs 1153-1176, param_2026=name, param_2028=desc)\n` +
        `// category: 3=melee, 4=ranged, 5=magic, undefined=shared\n` +
        `export const LEAGUE_MASTERY_NODES: LeagueMasteryNodeRow[] = [\n${nodeLines.join(
            ",\n",
        )}\n];\n\n` +
        `// Mastery challenges (structs 1177-1186, param_2028=desc only)\n` +
        `// These are challenges that grant mastery points when completed\n` +
        `export const LEAGUE_MASTERY_CHALLENGES: LeagueMasteryChallengeRow[] = [\n${challengeLines.join(
            ",\n",
        )}\n];\n`
    );
}

function exploreStructsForMasteries(enumTypeLoader: any, structTypeLoader: any): void {
    // Explore specific param patterns that might indicate mastery data
    console.log("\n=== Exploring cache for mastery data ===\n");

    // First, look at the league type enum (2670) to understand structure
    const leagueTypeEnum = enumTypeLoader?.load?.(2670);
    if (leagueTypeEnum) {
        console.log("League Type Enum (2670):");
        console.log(`  Keys: ${JSON.stringify(leagueTypeEnum.keys)}`);
        console.log(`  Values: ${JSON.stringify(leagueTypeEnum.intValues)}`);

        // For each league struct, dump all params
        for (const structId of leagueTypeEnum.intValues || []) {
            if (structId <= 0) continue;
            const struct = structTypeLoader?.load?.(structId);
            if (!struct?.params) continue;

            console.log(`\nLeague Struct ${structId}:`);
            for (const [paramId, value] of struct.params.entries()) {
                console.log(`  param_${paramId} = ${formatParamValue(value)}`);

                // If this looks like an enum reference, try to load it
                const enumId = value as number | undefined;
                if (Number.isFinite(enumId) && enumId > 100 && enumId < 50000) {
                    const maybeEnum = enumTypeLoader?.load?.(enumId);
                    if (maybeEnum && maybeEnum.keys && maybeEnum.keys.length > 0) {
                        console.log(`    -> Enum ${enumId}: ${maybeEnum.keys.length} entries`);

                        // If enum has struct values, explore first few
                        if (maybeEnum.intValues && maybeEnum.intValues.length > 0) {
                            for (let i = 0; i < Math.min(3, maybeEnum.intValues.length); i++) {
                                const subStructId = maybeEnum.intValues[i];
                                if (subStructId > 0) {
                                    const subStruct = structTypeLoader?.load?.(subStructId);
                                    if (subStruct?.params) {
                                        console.log(`      Struct ${subStructId} params:`);
                                        for (const [pId, pVal] of subStruct.params.entries()) {
                                            console.log(
                                                `        param_${pId} = ${formatParamValue(pVal, 50)}`,
                                            );
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Search for structs with combat mastery related content
    console.log("\n=== Searching for combat mastery structs ===\n");

    // From League 5 struct:
    // param_892 = 5671 (melee mastery enum?)
    // param_893 = 5672 (ranged mastery enum?)
    // param_894 = 5673 (magic mastery enum?)
    // param_895 = 5674 (shared/general?)
    // param_2054 = 3612, param_2055 = 6303 (other mastery data?)
    console.log("\n=== Exploring mastery enums (5671-5674) ===\n");

    for (const enumId of [5671, 5672, 5673, 5674, 6303]) {
        const maybeEnum = enumTypeLoader?.load?.(enumId);
        if (maybeEnum && maybeEnum.keys && maybeEnum.keys.length > 0) {
            console.log(`\nEnum ${enumId}: ${maybeEnum.keys.length} entries`);
            console.log(`  Keys: ${JSON.stringify(maybeEnum.keys.slice(0, 20))}`);
            console.log(
                `  Values: ${JSON.stringify(
                    (maybeEnum.intValues || maybeEnum.stringValues || []).slice(0, 20),
                )}`,
            );

            // Explore first few structs
            const values = maybeEnum.intValues || [];
            for (let i = 0; i < Math.min(5, values.length); i++) {
                const subStructId = values[i];
                if (subStructId > 0) {
                    const subStruct = structTypeLoader?.load?.(subStructId);
                    if (subStruct?.params) {
                        console.log(`  Struct ${subStructId}:`);
                        for (const [pId, pVal] of subStruct.params.entries()) {
                            console.log(`    param_${pId} = ${formatParamValue(pVal, 80)}`);
                        }
                    }
                }
            }
        }
    }

    // 5671-5674 might be struct IDs not enum IDs - check directly
    console.log("\n=== Exploring mastery structs 5671-5674 directly ===\n");
    for (const structId of [5671, 5672, 5673, 5674]) {
        const struct = structTypeLoader?.load?.(structId);
        if (struct?.params) {
            console.log(`\nStruct ${structId}:`);
            for (const [pId, pVal] of struct.params.entries()) {
                console.log(`  param_${pId} = ${formatParamValue(pVal, 100)}`);
            }
        }
    }

    // Search for structs with param_879 (mastery name) in range 6200-6500
    console.log(
        "\n=== Searching for mastery structs (param_879/880) in 1100-1200, 6200-6500 ===\n",
    );

    const masteryStructs: Array<{
        structId: number;
        name: string;
        desc: string;
        params: Record<number, any>;
    }> = [];

    // Search relic/mastery range
    for (const range of [
        [1100, 1200],
        [6200, 6500],
    ]) {
        for (let structId = range[0]; structId < range[1]; structId++) {
            const struct = structTypeLoader?.load?.(structId);
            if (!struct?.params) continue;

            // Mastery structs have param_879 (name) and param_880 (description)
            if (struct.params.has(879) && struct.params.has(880)) {
                const name = struct.params.get(879) as string;
                const desc = struct.params.get(880) as string;
                const otherParams: Record<number, any> = {};
                for (const [pId, pVal] of struct.params.entries()) {
                    if (pId !== 879 && pId !== 880) {
                        otherParams[pId] = pVal;
                    }
                }
                masteryStructs.push({ structId, name, desc, params: otherParams });
                console.log(`Struct ${structId}: ${name}`);
                console.log(`  ${desc.substring(0, 100)}`);
                console.log(`  Other params: ${JSON.stringify(otherParams)}`);
            }
        }
    }

    // Also check enum 6303 which might list mastery nodes
    console.log("\n=== Checking enum 6303 ===\n");
    const enum6303 = enumTypeLoader?.load?.(6303);
    if (enum6303) {
        console.log(`Enum 6303: ${enum6303.keys?.length ?? 0} entries`);
        console.log(`  Keys: ${JSON.stringify(enum6303.keys?.slice(0, 30))}`);
        console.log(
            `  Values: ${JSON.stringify(
                (enum6303.intValues || enum6303.stringValues || []).slice(0, 30),
            )}`,
        );

        // Check first few structs
        for (const structId of (enum6303.intValues || []).slice(0, 10)) {
            if (structId > 0) {
                const struct = structTypeLoader?.load?.(structId);
                if (struct?.params) {
                    console.log(`\n  Struct ${structId}:`);
                    for (const [pId, pVal] of struct.params.entries()) {
                        console.log(`    param_${pId} = ${formatParamValue(pVal, 60)}`);
                    }
                }
            }
        }
    }

    console.log(`\n=== Found ${masteryStructs.length} mastery structs total ===`);
}

function extractRelics(structTypeLoader: any): RelicData[] {
    const relics: RelicData[] = [];

    // Relics are in two ranges:
    // - structs 1116-1135 (main relics)
    // - structs 6260-6264 (additional relics)
    // All have param_879 (name) and param_880 (description)
    const ranges = [
        [1116, 1135],
        [6260, 6270],
    ];

    for (const [start, end] of ranges) {
        for (let structId = start; structId <= end; structId++) {
            const struct = structTypeLoader?.load?.(structId);
            if (!struct?.params) continue;

            if (struct.params.has(879) && struct.params.has(880)) {
                const name = struct.params.get(879) as string;
                const desc = struct.params.get(880) as string;
                const param1855 = struct.params.get(1855);

                relics.push({
                    structId,
                    name,
                    description: desc,
                    hasItem: param1855 === 1,
                });
            }
        }
    }

    return relics;
}

function extractMasteryNodes(structTypeLoader: any): MasteryNodeData[] {
    const nodes: MasteryNodeData[] = [];

    // Mastery nodes are structs 1153-1176 with param_2026 (name) and param_2028 (description)
    for (let structId = 1150; structId <= 1180; structId++) {
        const struct = structTypeLoader?.load?.(structId);
        if (!struct?.params) continue;

        if (struct.params.has(2026) && struct.params.has(2028)) {
            const name = struct.params.get(2026) as string;
            const desc = struct.params.get(2028) as string;
            const category = struct.params.get(2027) as number | undefined;

            nodes.push({
                structId,
                name,
                description: desc,
                category: Number.isFinite(category) ? category : undefined,
            });
        }
    }

    return nodes;
}

function extractMasteryChallenges(structTypeLoader: any): MasteryChallengeData[] {
    const challenges: MasteryChallengeData[] = [];

    // Mastery challenges are structs with param_2028 (description) but NO param_2026 (name)
    // Found in range 1177-1186
    for (let structId = 1177; structId <= 1200; structId++) {
        const struct = structTypeLoader?.load?.(structId);
        if (!struct?.params) continue;

        if (struct.params.has(2028) && !struct.params.has(2026)) {
            const desc = struct.params.get(2028) as string;

            challenges.push({
                structId,
                description: desc,
            });
        }
    }

    return challenges;
}

function main(): void {
    const cacheEnv = initCacheEnv("caches");
    const cacheFactory = getCacheLoaderFactory(cacheEnv.info, cacheEnv.cacheSystem as any);
    const enumTypeLoader = cacheFactory.getEnumTypeLoader?.();
    const structTypeLoader = cacheFactory.getStructTypeLoader?.();
    if (!enumTypeLoader || !structTypeLoader) {
        throw new Error("EnumTypeLoader/StructTypeLoader unavailable for this cache");
    }

    // First, explore the cache to understand the mastery structure
    exploreStructsForMasteries(enumTypeLoader, structTypeLoader);

    // Extract relics (structs 1116-1135 with param_879/880)
    const relics = extractRelics(structTypeLoader);

    // Extract mastery nodes (structs 1153-1176 with param_2026/2028)
    const masteryNodes = extractMasteryNodes(structTypeLoader);

    // Extract mastery challenges (structs 1177-1186 with param_2028 only)
    const masteryChallenges = extractMasteryChallenges(structTypeLoader);

    if (relics.length > 0 || masteryNodes.length > 0 || masteryChallenges.length > 0) {
        const outPath = path.resolve("src/shared/leagues/leagueMasteries.data.ts");
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(
            outPath,
            formatLeagueMasteriesTs(relics, masteryNodes, masteryChallenges),
            "utf8",
        );
        logger.info(
            `[leagues] exported ${relics.length} relics, ${masteryNodes.length} mastery nodes, and ${masteryChallenges.length} mastery challenges to ${outPath}`,
        );
    } else {
        logger.info(`[leagues] No relics, mastery nodes, or challenges found`);
    }
}

main();
