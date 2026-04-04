import { VARBIT_MASTERY_POINT_UNLOCK_BASE } from "../../../../src/shared/leagues/leagueTypes";
import {
    VARBIT_LEAGUE_MAGIC_MASTERY,
    VARBIT_LEAGUE_MASTERY_POINTS_EARNED,
    VARBIT_LEAGUE_MASTERY_POINTS_TO_SPEND,
    VARBIT_LEAGUE_MELEE_MASTERY,
    VARBIT_LEAGUE_RANGED_MASTERY,
    VARBIT_LEAGUE_RELIC_1,
    VARBIT_LEAGUE_RELIC_2,
    VARBIT_LEAGUE_RELIC_3,
    VARBIT_LEAGUE_RELIC_4,
    VARBIT_LEAGUE_RELIC_5,
    VARBIT_LEAGUE_RELIC_6,
    VARBIT_LEAGUE_RELIC_7,
    VARBIT_LEAGUE_RELIC_8,
    VARP_LEAGUE_RELICS,
} from "../../../../src/shared/vars";

type LeaguePackedVarpField = {
    varbitId: number;
    startBit: number;
    endBit: number;
};

type LeaguePackedVarpDef = {
    varpId: number;
    fields: readonly LeaguePackedVarpField[];
};

export type LeaguePackedVarpPlayer = {
    getVarbitValue: (id: number) => number;
    getVarpValue: (id: number) => number;
    setVarpValue: (id: number, value: number) => void;
};

// Cache-verified base varps for leagues state (rev 235).
// These are the actual backing varps the client reads/transmits for the corresponding varbits.
export const VARP_LEAGUE_COMBAT_MASTERY_PATHS = 4566;
export const VARP_LEAGUE_COMBAT_MASTERY_POINTS = 4567;
export const VARP_LEAGUE_COMBAT_MASTERY_UNLOCKS = 4568;

const LEAGUE_PACKED_VARPS: readonly LeaguePackedVarpDef[] = [
    {
        varpId: VARP_LEAGUE_RELICS,
        fields: [
            { varbitId: VARBIT_LEAGUE_RELIC_1, startBit: 0, endBit: 2 },
            { varbitId: VARBIT_LEAGUE_RELIC_2, startBit: 3, endBit: 5 },
            { varbitId: VARBIT_LEAGUE_RELIC_3, startBit: 6, endBit: 8 },
            { varbitId: VARBIT_LEAGUE_RELIC_4, startBit: 9, endBit: 11 },
            { varbitId: VARBIT_LEAGUE_RELIC_5, startBit: 12, endBit: 14 },
            { varbitId: VARBIT_LEAGUE_RELIC_6, startBit: 15, endBit: 17 },
            { varbitId: VARBIT_LEAGUE_RELIC_7, startBit: 18, endBit: 20 },
            { varbitId: VARBIT_LEAGUE_RELIC_8, startBit: 21, endBit: 23 },
        ],
    },
    {
        varpId: VARP_LEAGUE_COMBAT_MASTERY_PATHS,
        fields: [
            { varbitId: VARBIT_LEAGUE_MELEE_MASTERY, startBit: 0, endBit: 4 },
            { varbitId: VARBIT_LEAGUE_RANGED_MASTERY, startBit: 5, endBit: 9 },
            { varbitId: VARBIT_LEAGUE_MAGIC_MASTERY, startBit: 10, endBit: 14 },
        ],
    },
    {
        varpId: VARP_LEAGUE_COMBAT_MASTERY_POINTS,
        fields: [
            { varbitId: VARBIT_LEAGUE_MASTERY_POINTS_TO_SPEND, startBit: 0, endBit: 4 },
            { varbitId: VARBIT_LEAGUE_MASTERY_POINTS_EARNED, startBit: 5, endBit: 9 },
            { varbitId: VARBIT_MASTERY_POINT_UNLOCK_BASE + 0, startBit: 10, endBit: 13 },
            { varbitId: VARBIT_MASTERY_POINT_UNLOCK_BASE + 1, startBit: 14, endBit: 17 },
            { varbitId: VARBIT_MASTERY_POINT_UNLOCK_BASE + 2, startBit: 18, endBit: 21 },
            { varbitId: VARBIT_MASTERY_POINT_UNLOCK_BASE + 3, startBit: 22, endBit: 25 },
            { varbitId: VARBIT_MASTERY_POINT_UNLOCK_BASE + 4, startBit: 26, endBit: 29 },
        ],
    },
    {
        varpId: VARP_LEAGUE_COMBAT_MASTERY_UNLOCKS,
        fields: [
            { varbitId: VARBIT_MASTERY_POINT_UNLOCK_BASE + 5, startBit: 0, endBit: 3 },
            { varbitId: VARBIT_MASTERY_POINT_UNLOCK_BASE + 6, startBit: 4, endBit: 7 },
            { varbitId: VARBIT_MASTERY_POINT_UNLOCK_BASE + 7, startBit: 8, endBit: 11 },
            { varbitId: VARBIT_MASTERY_POINT_UNLOCK_BASE + 8, startBit: 12, endBit: 15 },
            { varbitId: VARBIT_MASTERY_POINT_UNLOCK_BASE + 9, startBit: 16, endBit: 19 },
        ],
    },
] as const;

function writeBits(base: number, startBit: number, endBit: number, value: number): number {
    const width = endBit - startBit + 1;
    if (width <= 0) return base;
    const mask = ((1 << width) - 1) << startBit;
    const normalized = value & ((1 << width) - 1);
    return (base & ~mask) | ((normalized << startBit) & mask);
}

function computePackedVarpValue(
    player: Pick<LeaguePackedVarpPlayer, "getVarbitValue" | "getVarpValue">,
    def: LeaguePackedVarpDef,
): number {
    let value = player.getVarpValue(def.varpId);
    for (const field of def.fields) {
        value = writeBits(
            value,
            field.startBit,
            field.endBit,
            player.getVarbitValue(field.varbitId),
        );
    }
    return value;
}

export function getLeaguePackedVarpsForPlayer(
    player: Pick<LeaguePackedVarpPlayer, "getVarbitValue" | "getVarpValue">,
): Record<number, number> {
    const varps: Record<number, number> = {};
    for (const def of LEAGUE_PACKED_VARPS) {
        varps[def.varpId] = computePackedVarpValue(player, def);
    }
    return varps;
}

export function syncLeaguePackedVarps(
    player: LeaguePackedVarpPlayer,
): Array<{ id: number; value: number }> {
    const updates: Array<{ id: number; value: number }> = [];
    const nextVarps = getLeaguePackedVarpsForPlayer(player);
    for (const [rawVarpId, rawValue] of Object.entries(nextVarps)) {
        const varpId = parseInt(rawVarpId, 10);
        const value = rawValue;
        if (player.getVarpValue(varpId) === value) {
            continue;
        }
        player.setVarpValue(varpId, value);
        updates.push({ id: varpId, value });
    }
    return updates;
}
