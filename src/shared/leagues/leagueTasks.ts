/**
 * League task lookups for cache-defined tasks.
 *
 * Note: Custom tasks are now handled by the CustomLeagueRegistry module.
 * This file only handles cache-defined task lookups.
 */
import { LEAGUE_TASKS } from "./leagueTasks.data";
import type { LeagueTaskRow } from "./leagueTypes";

const tasksByTaskId = new Map<number, LeagueTaskRow>();
const tasksByStructId = new Map<number, LeagueTaskRow>();

for (const row of LEAGUE_TASKS) {
    const taskId = row.taskId | 0;
    if (taskId >= 0 && !tasksByTaskId.has(taskId)) {
        tasksByTaskId.set(taskId, row);
    }
    const structId = typeof row.structId === "number" ? row.structId | 0 : -1;
    if (structId >= 0 && !tasksByStructId.has(structId)) {
        tasksByStructId.set(structId, row);
    }
}

export function getLeagueTaskByTaskId(taskId: number): LeagueTaskRow | undefined {
    return tasksByTaskId.get(taskId | 0);
}

export function getLeagueTaskByStructId(structId: number): LeagueTaskRow | undefined {
    return tasksByStructId.get(structId | 0);
}

/**
 * Override hook: CS2 scripts access league tasks via StructType params.
 * When structId corresponds to a league task struct, return the value from the
 * shared snapshot instead of the cache-decoded struct.
 */
export function getLeagueTaskStructParam(
    structId: number,
    paramId: number,
): number | string | undefined {
    const row = getLeagueTaskByStructId(structId);
    if (!row) return undefined;

    const pid = paramId | 0;
    switch (pid) {
        case 873:
            return row.taskId | 0;
        case 874:
            return row.name ?? "";
        case 875:
            return row.description ?? "";
        case 1016:
            return typeof row.category === "number" ? row.category | 0 : 0;
        case 1017:
            return typeof row.area === "number" ? row.area | 0 : 0;
        case 1018:
            return typeof row.skill === "number" ? row.skill | 0 : 0;
        // Tier params (varies by league; scripts pick one depending on league type).
        case 2044:
        case 1849:
        case 1850:
        case 1851:
        case 1852:
            return row.tier | 0;
        default:
            return undefined;
    }
}

