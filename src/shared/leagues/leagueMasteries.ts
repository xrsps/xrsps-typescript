/**
 * League mastery/relic lookups for cache-defined content.
 *
 * Note: Custom challenges are now handled by the CustomLeagueRegistry module.
 * This file only handles cache-defined relic/mastery lookups.
 */
import {
    LEAGUE_MASTERY_CHALLENGES,
    LEAGUE_MASTERY_NODES,
    LEAGUE_RELICS,
} from "./leagueMasteries.data";
import type {
    LeagueMasteryChallengeRow,
    LeagueMasteryNodeRow,
    LeagueRelicRow,
} from "./leagueTypes";

// Indexed lookups for relics
const relicsByStructId = new Map<number, LeagueRelicRow>();
for (const row of LEAGUE_RELICS) {
    relicsByStructId.set(row.structId | 0, row);
}

// Indexed lookups for mastery nodes
const masteryNodesByStructId = new Map<number, LeagueMasteryNodeRow>();
for (const row of LEAGUE_MASTERY_NODES) {
    masteryNodesByStructId.set(row.structId | 0, row);
}

// Indexed lookups for mastery challenges
const masteryChallengesByStructId = new Map<number, LeagueMasteryChallengeRow>();
for (const row of LEAGUE_MASTERY_CHALLENGES) {
    masteryChallengesByStructId.set(row.structId | 0, row);
}

export function getRelicByStructId(structId: number): LeagueRelicRow | undefined {
    return relicsByStructId.get(structId | 0);
}

export function getMasteryNodeByStructId(structId: number): LeagueMasteryNodeRow | undefined {
    return masteryNodesByStructId.get(structId | 0);
}

export function getMasteryChallengeByStructId(
    structId: number,
): LeagueMasteryChallengeRow | undefined {
    return masteryChallengesByStructId.get(structId | 0);
}

/**
 * Override hook: CS2 scripts access relic/mastery data via StructType params.
 * When structId corresponds to a relic or mastery struct, return the value from the
 * shared snapshot instead of the cache-decoded struct.
 */
export function getRelicOrMasteryStructParam(
    structId: number,
    paramId: number,
): number | string | undefined {
    // Check relics first (param_879=name, param_880=desc, param_1855=hasItem)
    const relic = getRelicByStructId(structId);
    if (relic) {
        const pid = paramId | 0;
        switch (pid) {
            case 879:
                return relic.name ?? "";
            case 880:
                return relic.description ?? "";
            case 1855:
                return relic.hasItem ? 1 : 0;
            default:
                return undefined;
        }
    }

    // Check mastery nodes (param_2026=name, param_2027=category, param_2028=desc)
    const node = getMasteryNodeByStructId(structId);
    if (node) {
        const pid = paramId | 0;
        switch (pid) {
            case 2026:
                return node.name ?? "";
            case 2027:
                return node.category ?? 0;
            case 2028:
                return node.description ?? "";
            default:
                return undefined;
        }
    }

    // Check mastery challenges (param_2028=desc only)
    const challenge = getMasteryChallengeByStructId(structId);
    if (challenge) {
        const pid = paramId | 0;
        switch (pid) {
            case 2028:
                return challenge.description ?? "";
            default:
                return undefined;
        }
    }

    return undefined;
}

// Re-export data for direct access
export { LEAGUE_RELICS, LEAGUE_MASTERY_NODES, LEAGUE_MASTERY_CHALLENGES };
