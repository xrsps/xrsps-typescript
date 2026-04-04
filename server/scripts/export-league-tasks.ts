import fs from "fs";
import path from "path";

import { getCacheLoaderFactory } from "../../src/rs/cache/loader/CacheLoaderFactory";
import { LeagueTaskDefinitions } from "../src/game/leagues/LeagueTaskDefinitions";
import { logger } from "../src/utils/logger";
import { initCacheEnv } from "../src/world/CacheEnv";

function formatLeagueTasksTs(defs: LeagueTaskDefinitions): string {
    const rows = defs.toJsonRows();
    const lines = rows.map((row) => `  ${JSON.stringify(row)}`);
    return (
        `import type { LeagueTaskRow } from "./leagueTypes";\n\n` +
        `// Generated snapshot of cache league tasks (1 line per task).\n` +
        `// Source of truth: caches/ (r235)\n` +
        `export const LEAGUE_TASKS: LeagueTaskRow[] = [\n${lines.join(",\n")}\n];\n`
    );
}

function main(): void {
    const cacheEnv = initCacheEnv("caches");
    const cacheFactory = getCacheLoaderFactory(cacheEnv.info, cacheEnv.cacheSystem as any);
    const enumTypeLoader = cacheFactory.getEnumTypeLoader?.();
    const structTypeLoader = cacheFactory.getStructTypeLoader?.();
    if (!enumTypeLoader || !structTypeLoader) {
        throw new Error("EnumTypeLoader/StructTypeLoader unavailable for this cache");
    }

    const defs = LeagueTaskDefinitions.fromCache(enumTypeLoader, structTypeLoader);
    const outPath = path.resolve("src/shared/leagues/leagueTasks.data.ts");
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, formatLeagueTasksTs(defs), "utf8");
    logger.info(`[leagues] exported ${defs.size()} tasks to ${outPath}`);
}

main();
