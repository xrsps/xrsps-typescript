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
 * For mastery challenges (enum 5695), replacement challenges don't increase the
 * total count since they replace existing cache entries.
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
        // They take the place of the cache entry they replace, so net effect is:
        // newEntries = customCount - replacementCount
        const newEntries = challenges.filter((c) => c.replacesStructId === undefined).length;
        return newEntries;
    }

    return 0;
}

/**
 * Get enum value override for custom content.
 * - Custom tasks are PREPENDED to the enum (inserted at the beginning)
 * - Custom challenges are PREPENDED to the enum (inserted at the beginning)
 *   - Replacement challenges take the place of their cache counterpart (no duplication)
 *   - Cache entries matching a replacedStructId are skipped during key resolution
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
    // Cache challenges that are NOT replaced follow after, with replaced entries skipped.
    const challenges = challengesByEnumId.get(eid);
    if (challenges && challenges.length > 0) {
        const customCount = challenges.length;

        // Custom challenges are at keys 1..(customCount) - 1-based indexing
        if (k >= 1 && k <= customCount) {
            return { custom: challenges[k - 1].structId };
        }

        // Keys > customCount map to cache entries, but we need to skip replaced entries.
        // The ConfigOps ENUM handler will use the shiftedKey to look up the cache enum.
        // We return a shiftedKey that accounts for replaced entries being removed.
        //
        // Example with 3 custom challenges (2 replacements) and 10 cache entries:
        //   Total = 3 custom + (10 - 2 replaced) = 11 entries
        //   Keys 1-3: custom challenges
        //   Keys 4-11: cache challenges (skipping replaced struct IDs)
        //
        // The cache enum has 1-based keys: 1=struct1177, 2=struct1178, ..., 10=struct1186
        // If struct 1177 (cache key 1) and 1178 (cache key 2) are replaced:
        //   Our key 4 → cache key 3 (skipping replaced keys 1 and 2)
        //   Our key 5 → cache key 4, etc.
        //
        // We achieve this by returning a shiftedKey that the cache handler will resolve.
        // However, ConfigOps uses `shiftedKey` to directly index the original cache enum,
        // so we need to map: our key → how many non-replaced cache entries to skip → original cache key.
        //
        // Position within the cache section: keyInCacheSection = k - customCount (1-based)
        // We need the Nth non-replaced cache entry (1-based).
        if (replacedCacheStructIds.size === 0) {
            // No replacements — simple shift like before
            return { shiftedKey: k - customCount };
        }

        // We need to tell ConfigOps which original cache key to use.
        // The problem: we don't know which cache keys map to which struct IDs here.
        // Solution: return a special marker that ConfigOps can use.
        // Actually, we DO know the replaced struct IDs, but not the cache key→struct mapping.
        //
        // Alternative approach: return the shifted key with skip count.
        // ConfigOps will need to handle skipping replaced structs.
        // For now, use the skipReplacedCacheEntries mechanism.
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
