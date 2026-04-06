/**
 * Custom League Content Module
 *
 * Centralized registry for all custom league content that:
 * - Defines content in one place with declarative syntax
 * - Uses standard league task varps for completion tracking
 * - Provides unified API for ConfigOps.ts overrides
 * - Handles enum mechanics transparently
 *
 * Usage:
 *
 * ```typescript
 * import {
 *   getStructParam,
 *   getEnumCountOverride,
 *   getEnumValueOverride,
 *   getAllCustomTasks,
 *   getAllCustomChallenges,
 * } from 'shared/leagues/custom';
 * ```
 */

// Type definitions
export type {
    CustomTask,
    RegisteredCustomTask,
    CustomChallenge,
    RegisteredCustomChallenge,
} from "./CustomContentTypes";
export { CUSTOM_STRUCT_RANGES, CUSTOM_TASK_RANGE, ENUM_IDS } from "./CustomContentTypes";

// Registry API
export {
    // Struct param overrides (for ConfigOps STRUCT_PARAM)
    getStructParam,
    // Enum overrides (for ConfigOps ENUM/ENUM_GETOUTPUTCOUNT)
    getEnumCountOverride,
    getEnumValueOverride,
    // Data access - Tasks
    getAllCustomTasks,
    getCustomTaskByStructId,
    getCustomTaskByIndex,
    getCustomTaskByTaskId,
    // Data access - Challenges
    getAllCustomChallenges,
    getCustomChallengeByStructId,
    getReplacedChallengeStructIds,
} from "./CustomLeagueRegistry";
