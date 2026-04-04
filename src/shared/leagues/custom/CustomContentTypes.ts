/**
 * Type definitions and constants for custom league content.
 *
 * Centralized definitions that won't conflict with cache updates:
 * - Struct ID ranges for custom content
 * - Dedicated varp ranges for completion tracking
 * - Enum IDs that need overrides
 */

import type { TaskTrigger } from "../../../../server/src/game/leagues/triggers/TriggerTypes";

// =============================================================================
// STRUCT ID RANGES (won't conflict with cache)
// =============================================================================

export const CUSTOM_STRUCT_RANGES = {
    /** Custom tasks: 90000-90999 (1000 slots) */
    TASKS: { start: 90000, end: 90999 },
    /** Reserved for future custom challenges: 90100-90199 */
    CHALLENGES: { start: 90100, end: 90199 },
} as const;

// =============================================================================
// CUSTOM TASK ID RANGE
// =============================================================================

/**
 * Custom tasks use taskIds in the range 1856-1983 (groups 58-61).
 *
 * The CS2 script league_task_is_completed only handles groups 0-61.
 * Cache tasks use taskIds 0-1845 (groups 0-57), so groups 58-61 are free.
 *
 * This gives us 128 custom task slots (4 groups * 32 bits each).
 * The corresponding varps are 4046-4049 (%league_task_completed_58 through _61).
 */
export const CUSTOM_TASK_RANGE = {
    /** First custom task ID (group 58, varp 4046) */
    TASK_ID_BASE: 1856,
    /** Maximum number of custom tasks (groups 58-61 = 128 slots) */
    MAX_CUSTOM_TASKS: 128,
} as const;

// =============================================================================
// ENUM IDS (centralized, not scattered)
// =============================================================================

export const ENUM_IDS = {
    /** League 5 (Raging Echoes) task list enum - maps index -> structId */
    L5_TASKS: 5728,
    /** Mastery challenges enum (if we add custom challenges later) */
    MASTERY_CHALLENGES: 5695,
} as const;

// =============================================================================
// STRUCT PARAM IDS (for struct_param overrides)
// =============================================================================

export const TASK_PARAM_IDS = {
    /** Task ID - param 873 */
    TASK_ID: 873,
    /** Task name - param 874 */
    NAME: 874,
    /** Task description - param 875 */
    DESCRIPTION: 875,
    /** Task category - param 1016 */
    CATEGORY: 1016,
    /** Task area - param 1017 */
    AREA: 1017,
    /** Task skill - param 1018 */
    SKILL: 1018,
    /** Task tier (various params by league) - param 2044 is L5 */
    TIER_L5: 2044,
    TIER_L4: 1849,
} as const;

// =============================================================================
// CUSTOM TASK DEFINITION TYPE
// =============================================================================

/**
 * Definition for a custom league task.
 * The registry auto-assigns structId and customIndex at initialization.
 */
export type CustomTask = {
    /** Display name of the task */
    name: string;
    /** Description shown in the task interface */
    description: string;
    /** Task tier (1-5): affects points and ordering */
    tier: number;
    /** Points awarded on completion */
    points: number;
    /** Which league this task belongs to (5 = Raging Echoes) */
    leagueType: number;
    /** Optional trigger for automatic completion detection */
    trigger?: TaskTrigger;
    /** Optional category ID */
    category?: number;
    /** Optional area ID */
    area?: number;
    /** Optional skill ID */
    skill?: number;
};

/**
 * Runtime representation of a custom task with assigned IDs.
 * Created by the registry at initialization.
 */
export type RegisteredCustomTask = CustomTask & {
    /** Auto-assigned struct ID (from CUSTOM_STRUCT_RANGES.TASKS) */
    structId: number;
    /** Auto-assigned custom task index (0, 1, 2...) for varp bitfield tracking */
    customIndex: number;
    /** Synthetic task ID for the cache-like lookup (high range to avoid conflicts) */
    taskId: number;
};

// =============================================================================
// CUSTOM MASTERY CHALLENGE DEFINITION TYPE
// =============================================================================

/**
 * Definition for a custom mastery challenge.
 * The registry auto-assigns structId at initialization.
 */
export type CustomChallenge = {
    /** Description shown in the mastery interface (param 2028) */
    description: string;
    /** Optional trigger for automatic completion detection */
    trigger?: TaskTrigger;
};

/**
 * Runtime representation of a custom challenge with assigned IDs.
 * Created by the registry at initialization.
 */
export type RegisteredCustomChallenge = CustomChallenge & {
    /** Auto-assigned struct ID (from CUSTOM_STRUCT_RANGES.CHALLENGES) */
    structId: number;
    /** Auto-assigned custom challenge index (0, 1, 2...) */
    customIndex: number;
};

// =============================================================================
// CHALLENGE PARAM IDS (for struct_param overrides)
// =============================================================================

export const CHALLENGE_PARAM_IDS = {
    /** Challenge description - param 2028 */
    DESCRIPTION: 2028,
} as const;
