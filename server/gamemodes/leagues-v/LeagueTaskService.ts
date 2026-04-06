import { LEAGUE_TASK_COMPLETION_VARPS } from "./data/leagueTaskVarps";
import { getLeagueTaskByTaskId } from "./data/leagueTaskLookup";
import {
    VARBIT_LEAGUE_TOTAL_TASKS_COMPLETED,
    VARP_LEAGUE_POINTS_CLAIMED,
    VARP_LEAGUE_POINTS_COMPLETED,
    VARP_LEAGUE_POINTS_CURRENCY,
} from "../../../src/shared/vars";

/**
 * Varp 2612 backs varbit 10046 (league_total_tasks_completed).
 * The varbit uses bits 0-15 of this varp to store task count (0-65535).
 * We need to update both the varbit (for server-side tracking) and the varp
 * (for client synchronization) since the client expects varbit data packed in varps.
 */
const VARP_LEAGUE_TASK_COUNT = 2612;

export type LeagueTaskNotification = {
    kind: "league_task";
    title: string;
    message: string;
    durationMs: number;
};

export type LeagueTaskAwardResult = {
    changed: boolean;
    varpUpdates: Array<{ id: number; value: number }>;
    varbitUpdates: Array<{ id: number; value: number }>;
    notification?: LeagueTaskNotification;
};

export type LeagueTaskPlayer = {
    getVarpValue: (id: number) => number;
    setVarpValue: (id: number, value: number) => void;
    getVarbitValue: (id: number) => number;
    setVarbitValue: (id: number, value: number) => void;
    gamemodeState: Map<string, unknown>;
    getChallengeProgress: (customIndex: number) => number;
    setChallengeProgress: (customIndex: number, value: number) => void;
};

export function getTaskProgress(player: LeagueTaskPlayer, taskId: number): number {
    const map = player.gamemodeState.get("taskProgress") as Map<number, number> | undefined;
    return map?.get(taskId | 0) ?? 0;
}

export function setTaskProgress(player: LeagueTaskPlayer, taskId: number, value: number): void {
    const key = taskId | 0;
    if (key < 0) return;
    const normalized = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
    let map = player.gamemodeState.get("taskProgress") as Map<number, number> | undefined;
    if (!map) {
        map = new Map();
        player.gamemodeState.set("taskProgress", map);
    }
    if (normalized > 0) {
        map.set(key, normalized);
    } else {
        map.delete(key);
    }
}

export function clearTaskProgress(player: LeagueTaskPlayer, taskId: number): void {
    const map = player.gamemodeState.get("taskProgress") as Map<number, number> | undefined;
    map?.delete(taskId | 0);
}

export function getChallengeProgress(player: LeagueTaskPlayer, customIndex: number): number {
    const map = player.gamemodeState.get("challengeProgress") as Map<number, number> | undefined;
    return map?.get(customIndex | 0) ?? 0;
}

export function setChallengeProgress(player: LeagueTaskPlayer, customIndex: number, value: number): void {
    const key = customIndex | 0;
    if (key < 0) return;
    const normalized = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
    let map = player.gamemodeState.get("challengeProgress") as Map<number, number> | undefined;
    if (!map) {
        map = new Map();
        player.gamemodeState.set("challengeProgress", map);
    }
    if (normalized > 0) {
        map.set(key, normalized);
    } else {
        map.delete(key);
    }
}

function getLeagueTaskBitfield(taskId: number): { varpId: number; mask: number } {
    const tid = taskId;
    const bit = tid & 31;
    const group = tid >> 5;
    const mappedVarpId = LEAGUE_TASK_COMPLETION_VARPS[group];
    // cache tasks use a non-contiguous varp table (groups 0-61).
    // Project extension: allow custom task IDs outside the cache range to map to a dedicated
    // contiguous varp space via the standard formula (2616 + group).
    const varpId = mappedVarpId ?? 2616 + group;
    if (varpId < 0) return { varpId: -1, mask: 0 };
    const mask = 1 << bit;
    return { varpId, mask };
}

export class LeagueTaskService {
    static isTaskComplete(player: LeagueTaskPlayer, taskId: number): boolean {
        const tid = taskId;
        const { varpId, mask } = getLeagueTaskBitfield(tid);
        if (varpId < 0 || mask === 0) {
            return false;
        }
        return (player.varps.getVarpValue(varpId) & mask) !== 0;
    }

    /**
     * League task completion is driven by the server.
     * This applies completion bitfields + point varps and emits a toast notification once.
     */
    static completeTask(
        player: LeagueTaskPlayer,
        taskId: number,
        taskOverride?: { name: string; points: number },
    ): LeagueTaskAwardResult {
        const tid = taskId;
        const { varpId, mask } = getLeagueTaskBitfield(tid);

        const prevMask = player.varps.getVarpValue(varpId);
        const nextMask = prevMask | mask;
        if (nextMask === prevMask) {
            return { changed: false, varpUpdates: [], varbitUpdates: [] };
        }

        const def = taskOverride ?? getLeagueTaskByTaskId(tid);
        const points = def?.points ?? 0;
        const name = def?.name ?? `Task ${tid}`;

        const varpUpdates: Array<{ id: number; value: number }> = [];
        const varbitUpdates: Array<{ id: number; value: number }> = [];

        player.varps.setVarpValue(varpId, nextMask);
        varpUpdates.push({ id: varpId, value: nextMask });

        const prevTotalTasks = player.varps.getVarbitValue(VARBIT_LEAGUE_TOTAL_TASKS_COMPLETED);
        const nextTotalTasks = prevTotalTasks + 1;
        player.varps.setVarbitValue(VARBIT_LEAGUE_TOTAL_TASKS_COMPLETED, nextTotalTasks);
        varbitUpdates.push({ id: VARBIT_LEAGUE_TOTAL_TASKS_COMPLETED, value: nextTotalTasks });

        // Also update the backing varp (2612) for client synchronization.
        // Varbit 10046 uses bits 0-15 of varp 2612, so we pack the task count there.
        // This ensures the client receives the correct varp value for CS2 scripts.
        const prevVarpValue = player.varps.getVarpValue(VARP_LEAGUE_TASK_COUNT);
        // Clear bits 0-15 and set new task count value
        const nextVarpValue = (prevVarpValue & ~0xffff) | (nextTotalTasks & 0xffff);
        player.varps.setVarpValue(VARP_LEAGUE_TASK_COUNT, nextVarpValue);
        varpUpdates.push({ id: VARP_LEAGUE_TASK_COUNT, value: nextVarpValue });

        if (points > 0) {
            const prevClaimed = player.varps.getVarpValue(VARP_LEAGUE_POINTS_CLAIMED);
            const prevCompleted = player.varps.getVarpValue(VARP_LEAGUE_POINTS_COMPLETED);
            const prevCurrency = player.varps.getVarpValue(VARP_LEAGUE_POINTS_CURRENCY);

            const nextClaimed = prevClaimed + points;
            const nextCompleted = prevCompleted + points;
            const nextCurrency = prevCurrency + points;

            player.varps.setVarpValue(VARP_LEAGUE_POINTS_CLAIMED, nextClaimed);
            player.varps.setVarpValue(VARP_LEAGUE_POINTS_COMPLETED, nextCompleted);
            player.varps.setVarpValue(VARP_LEAGUE_POINTS_CURRENCY, nextCurrency);
            varpUpdates.push({ id: VARP_LEAGUE_POINTS_CLAIMED, value: nextClaimed });
            varpUpdates.push({ id: VARP_LEAGUE_POINTS_COMPLETED, value: nextCompleted });
            varpUpdates.push({ id: VARP_LEAGUE_POINTS_CURRENCY, value: nextCurrency });
        }

        const notification: LeagueTaskNotification = {
            kind: "league_task",
            title: "League Task Completed",
            message: `${name}<br><br><col=ffffff>+${points} League Points</col>`,
            durationMs: 3000,
        };

        return { changed: true, varpUpdates, varbitUpdates, notification };
    }
}
