/**
 * Custom mastery challenge definitions.
 *
 * Add new custom challenges here. The registry will auto-assign:
 * - structId (from 90100+)
 * - customIndex (0, 1, 2...)
 *
 * Challenges appear in the mastery combat tree interface and grant
 * mastery points when completed.
 */
import type { CustomChallenge } from "../CustomContentTypes";

/**
 * All custom mastery challenges.
 * These are PREPENDED to the mastery challenges enum (5695).
 *
 * IMPORTANT: The CS2 script only handles enum positions 1-10.
 * Custom challenges occupy positions 1..N, pushing cache challenges down.
 * If you add more than 10 total challenges, some won't be trackable.
 */
export const CUSTOM_CHALLENGES: CustomChallenge[] = [
    {
        description: "Defeat a Man.",
        trigger: { type: "npc_kill", npcIds: [3106, 3107, 3108] },
    },
    // Add more custom challenges here...
];
