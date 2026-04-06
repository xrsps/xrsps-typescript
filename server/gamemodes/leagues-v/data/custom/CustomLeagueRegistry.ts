/**
 * CustomLeagueRegistry - Central registry for all custom league content.
 *
 * Provides:
 * 1. Single source of truth for custom tasks, challenges, etc.
 * 2. Unified API for ConfigOps.ts struct/enum overrides
 * 3. Dedicated varp-based completion tracking (no synthetic varbits)
 * 4. Type-safe definitions with automatic ID assignment
 *
 * Usage:
 * - Import functions directly: getStructParam(), getEnumOverride(), etc.
 * - Custom tasks are auto-indexed at module load
 * - ConfigOps.ts calls these instead of scattered helper functions
 */
import {
    CHALLENGE_PARAM_IDS,
    CUSTOM_STRUCT_RANGES,
    CUSTOM_TASK_RANGE,
    ENUM_IDS,
    type RegisteredCustomChallenge,
    type RegisteredCustomTask,
    TASK_PARAM_IDS,
} from "./CustomContentTypes";
import { CUSTOM_CHALLENGES } from "./definitions/challenges";
import { CUSTOM_TASKS } from "./definitions/tasks";

// =============================================================================
// INITIALIZATION - Auto-assign IDs to custom content
// =============================================================================

/** All registered custom tasks with assigned IDs */
const registeredTasks: RegisteredCustomTask[] = [];

/** Lookup by structId for struct_param overrides */
const tasksByStructId = new Map<number, RegisteredCustomTask>();

/** Lookup by customIndex for completion tracking */
const tasksByCustomIndex = new Map<number, RegisteredCustomTask>();

/** Tasks grouped by enum ID for enum overrides (PREPENDED to enum) */
const tasksByEnumId = new Map<number, RegisteredCustomTask[]>();

/** All registered custom challenges with assigned IDs */
const registeredChallenges: RegisteredCustomChallenge[] = [];

/** Lookup by structId for struct_param overrides */
const challengesByStructId = new Map<number, RegisteredCustomChallenge>();

/** Challenges grouped by enum ID for enum overrides (APPENDED to enum) */
const challengesByEnumId = new Map<number, RegisteredCustomChallenge[]>();

/** Cache struct IDs replaced by custom challenges (to avoid enum duplicates) */
const replacedCacheStructIds = new Set<number>();

// Synthetic task ID base - uses groups 58-61 (taskIds 1856-1983)
// CS2 script league_task_is_completed only handles groups 0-61
// Cache tasks max at taskId 1845 (group 57), so groups 58-61 are free
// Group 58 = taskId 1856-1887, maps to varp 4046 (%league_task_completed_58)
// This gives us 128 custom task slots (4 groups * 32 bits)
const SYNTHETIC_TASK_ID_BASE = 1856;

// Initialize on module load
(function initializeRegistry() {
    // --- Initialize Tasks ---
    let nextTaskStructId = CUSTOM_STRUCT_RANGES.TASKS.start;
    let taskIndex = 0;

    for (const task of CUSTOM_TASKS) {
        if (nextTaskStructId > CUSTOM_STRUCT_RANGES.TASKS.end) {
            console.error(
                `[CustomLeagueRegistry] Exceeded max custom task struct IDs (${CUSTOM_STRUCT_RANGES.TASKS.end})`,
            );
            break;
        }

        const registered: RegisteredCustomTask = {
            ...task,
            structId: nextTaskStructId,
            customIndex: taskIndex,
            taskId: SYNTHETIC_TASK_ID_BASE + taskIndex,
        };

        registeredTasks.push(registered);
        tasksByStructId.set(registered.structId, registered);
        tasksByCustomIndex.set(registered.customIndex, registered);

        // Group by target enum (L5 tasks go to enum 5728)
        if (task.leagueType === 5) {
            let arr = tasksByEnumId.get(ENUM_IDS.L5_TASKS);
            if (!arr) {
                arr = [];
                tasksByEnumId.set(ENUM_IDS.L5_TASKS, arr);
            }
            arr.push(registered);
        }

        nextTaskStructId++;
        taskIndex++;
    }

    // --- Initialize Challenges ---
    let nextChallengeStructId = CUSTOM_STRUCT_RANGES.CHALLENGES.start;
    let challengeIndex = 0;

    for (const challenge of CUSTOM_CHALLENGES) {
        if (nextChallengeStructId > CUSTOM_STRUCT_RANGES.CHALLENGES.end) {
            console.error(
                `[CustomLeagueRegistry] Exceeded max custom challenge struct IDs (${CUSTOM_STRUCT_RANGES.CHALLENGES.end})`,
            );
            break;
        }

        const registered: RegisteredCustomChallenge = {
            ...challenge,
            structId: nextChallengeStructId,
            customIndex: challengeIndex,
        };

        registeredChallenges.push(registered);
        challengesByStructId.set(registered.structId, registered);

        // Track replaced cache struct IDs to exclude from enum
        if (challenge.replacesStructId !== undefined) {
            replacedCacheStructIds.add(challenge.replacesStructId | 0);
        }

        // All challenges go to enum 5695
        let arr = challengesByEnumId.get(ENUM_IDS.MASTERY_CHALLENGES);
        if (!arr) {
            arr = [];
            challengesByEnumId.set(ENUM_IDS.MASTERY_CHALLENGES, arr);
        }
        arr.push(registered);

        nextChallengeStructId++;
        challengeIndex++;
    }
})();

// =============================================================================
// STRUCT PARAM API - For ConfigOps STRUCT_PARAM handler
// =============================================================================

/**
 * Get a struct param value for custom content.
 * Called by ConfigOps.ts STRUCT_PARAM handler.
 *
 * @param structId The struct ID being queried
 * @param paramId The param ID being queried
 * @returns The param value, or undefined if not a custom struct
 */
export function getStructParam(structId: number, paramId: number): number | string | undefined {
    const sid = structId | 0;

    // Check if it's a custom task
    const task = tasksByStructId.get(sid);
    if (task) {
        return getTaskStructParam(task, paramId);
    }

    // Check if it's a custom challenge
    const challenge = challengesByStructId.get(sid);
    if (challenge) {
        return getChallengeStructParam(challenge, paramId);
    }

    return undefined;
}

function getTaskStructParam(
    task: RegisteredCustomTask,
    paramId: number,
): number | string | undefined {
    const pid = paramId | 0;
    switch (pid) {
        case TASK_PARAM_IDS.TASK_ID:
            return task.taskId;
        case TASK_PARAM_IDS.NAME:
            return task.name;
        case TASK_PARAM_IDS.DESCRIPTION:
            return task.description;
        case TASK_PARAM_IDS.CATEGORY:
            return task.category ?? 0;
        case TASK_PARAM_IDS.AREA:
            return task.area ?? 0;
        case TASK_PARAM_IDS.SKILL:
            return task.skill ?? 0;
        case TASK_PARAM_IDS.TIER_L5:
        case TASK_PARAM_IDS.TIER_L4:
            return task.tier;
        default:
            return undefined;
    }
}

function getChallengeStructParam(
    challenge: RegisteredCustomChallenge,
    paramId: number,
): number | string | undefined {
    const pid = paramId | 0;
    switch (pid) {
        case CHALLENGE_PARAM_IDS.DESCRIPTION:
            return challenge.description;
        default:
            return undefined;
    }
}

// =============================================================================
// ENUM API - For ConfigOps ENUM/ENUM_GETOUTPUTCOUNT handlers
// =============================================================================

/**
 * Get the count override for an enum (number of custom entries to add).
 * Called by ConfigOps.ts ENUM_GETOUTPUTCOUNT handler.
 *
 * @param enumId The enum ID being queried
 * @returns Number of custom entries to add to the enum count
 */
export function getEnumCountOverride(enumId: number): number {
    const eid = enumId | 0;

    // Check for prepended tasks
    const tasks = tasksByEnumId.get(eid);
    if (tasks && tasks.length > 0) {
        return tasks.length;
    }

    // Check for prepended challenges
    const challenges = challengesByEnumId.get(eid);
    if (challenges && challenges.length > 0) {
        // Custom challenges that replace cache entries don't add to the total count.
        const newEntries = challenges.filter((c) => c.replacesStructId === undefined).length;
        return newEntries;
    }

    return 0;
}

/**
 * Get enum value override for custom content.
 * - Custom tasks are PREPENDED to the enum (inserted at the beginning)
 * - Custom challenges are APPENDED to the enum (added at the end)
 *
 * Called by ConfigOps.ts ENUM handler.
 *
 * @param enumId The enum ID being queried
 * @param key The key being looked up
 * @param baseCount The original enum count (needed for appended content)
 * @returns Override result, or undefined if no override needed
 */
export function getEnumValueOverride(
    enumId: number,
    key: number,
    baseCount?: number,
): { custom: number } | { shiftedKey: number } | undefined {
    const eid = enumId | 0;
    const k = key | 0;

    // Check for prepended tasks (tasks are inserted at beginning)
    const tasks = tasksByEnumId.get(eid);
    if (tasks && tasks.length > 0) {
        const customCount = tasks.length;

        // Custom tasks are at keys 0..(customCount-1)
        if (k < customCount) {
            return { custom: tasks[k].structId };
        }

        // Original enum keys are shifted: key N becomes N - customCount
        return { shiftedKey: k - customCount };
    }

    // Check for prepended challenges (challenges are inserted at beginning)
    // The mastery challenge enum uses 1-based keys (1, 2, 3...)
    // Custom challenges are inserted at keys 1..(customCount)
    // Original cache challenges shift from key N to key N + customCount
    const challenges = challengesByEnumId.get(eid);
    if (challenges && challenges.length > 0) {
        const customCount = challenges.length;

        // Custom challenges are at keys 1..(customCount) - 1-based indexing
        if (k >= 1 && k <= customCount) {
            return { custom: challenges[k - 1].structId };
        }

        // Original enum keys are shifted: key N becomes N - customCount
        // (only applies to keys > customCount)
        return { shiftedKey: k - customCount };
    }

    return undefined;
}

/**
 * Get the set of cache struct IDs that are replaced by custom challenges.
 * ConfigOps uses this to skip replaced cache entries when resolving enum keys.
 */
export function getReplacedChallengeStructIds(): ReadonlySet<number> {
    return replacedCacheStructIds;
}

// =============================================================================
// COMPLETION TRACKING INFO
// =============================================================================

/**
 * Custom task completion is tracked via the standard league task varps.
 * LeagueTaskService.completeTask handles the varp updates using the taskId.
 *
 * Custom tasks use taskIds 1856-1983 (groups 58-61), which map to:
 * - Group 58: varp 4046 (%league_task_completed_58)
 * - Group 59: varp 4047 (%league_task_completed_59)
 * - Group 60: varp 4048 (%league_task_completed_60)
 * - Group 61: varp 4049 (%league_task_completed_61)
 *
 * The CS2 script league_task_is_completed reads the taskId and checks
 * the corresponding varp/bit, so no special handling is needed.
 */

// =============================================================================
// DATA ACCESS API - For server task/challenge indexing
// =============================================================================

/**
 * Get all registered custom tasks.
 * Used by LeagueTaskIndex to include custom tasks in the index.
 */
export function getAllCustomTasks(): readonly RegisteredCustomTask[] {
    return registeredTasks;
}

/**
 * Get a custom task by its struct ID.
 */
export function getCustomTaskByStructId(structId: number): RegisteredCustomTask | undefined {
    return tasksByStructId.get(structId | 0);
}

/**
 * Get a custom task by its custom index.
 */
export function getCustomTaskByIndex(customIndex: number): RegisteredCustomTask | undefined {
    return tasksByCustomIndex.get(customIndex | 0);
}

/**
 * Get a custom task by its synthetic task ID.
 */
export function getCustomTaskByTaskId(taskId: number): RegisteredCustomTask | undefined {
    const tid = taskId | 0;
    if (tid >= SYNTHETIC_TASK_ID_BASE) {
        const customIndex = tid - SYNTHETIC_TASK_ID_BASE;
        return tasksByCustomIndex.get(customIndex);
    }
    return undefined;
}

/**
 * Get all registered custom challenges.
 * Used for indexing and completion tracking.
 */
export function getAllCustomChallenges(): readonly RegisteredCustomChallenge[] {
    return registeredChallenges;
}

/**
 * Get a custom challenge by its struct ID.
 */
export function getCustomChallengeByStructId(
    structId: number,
): RegisteredCustomChallenge | undefined {
    return challengesByStructId.get(structId | 0);
}

// =============================================================================
// CONSTANTS EXPORT - For external use
// =============================================================================

export { CUSTOM_STRUCT_RANGES, CUSTOM_TASK_RANGE, ENUM_IDS };
