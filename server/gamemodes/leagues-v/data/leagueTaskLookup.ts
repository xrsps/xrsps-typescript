import type { LeagueTaskRow } from "../../../../src/shared/leagues/leagueTypes";
import { LEAGUE_TASKS } from "./leagueTasks.data";

const tasksByTaskId = new Map<number, LeagueTaskRow>();

for (const row of LEAGUE_TASKS) {
    const taskId = row.taskId | 0;
    if (taskId >= 0 && !tasksByTaskId.has(taskId)) {
        tasksByTaskId.set(taskId, row);
    }
}

export function getLeagueTaskByTaskId(taskId: number): LeagueTaskRow | undefined {
    return tasksByTaskId.get(taskId | 0);
}
