/**
 * Custom task definitions for league content.
 *
 * Add new custom tasks here. The registry will auto-assign:
 * - structId (from 90000+)
 * - customIndex (0, 1, 2...)
 * - taskId (synthetic, for completion tracking)
 *
 * Example:
 * {
 *   name: 'Kill a Man',
 *   description: 'Kill a Man.',
 *   tier: 1,
 *   points: 10,
 *   leagueType: 5,
 *   trigger: { type: 'npc_kill', npcIds: [3106, 3107, 3108] },
 * }
 */
import type { CustomTask } from "../CustomContentTypes";

/**
 * All custom tasks for League 5 (Raging Echoes).
 * Only add tasks here when the cache does not already define them.
 */
export const CUSTOM_TASKS: CustomTask[] = [];
