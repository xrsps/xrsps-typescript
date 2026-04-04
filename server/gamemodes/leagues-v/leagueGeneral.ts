import {
    VARBIT_LEAGUE_TUTORIAL_COMPLETED,
    VARBIT_LEAGUE_TYPE,
    VARP_LEAGUE_GENERAL,
} from "../../../src/shared/vars";

/**
 * League general state (VARP 2606) packing helpers.
 *
 * Cache-verified varbit layout:
 * - VARBIT_LEAGUE_TYPE (10032): baseVar=2606, bits [1..4] (startBit=1, endBit=5)
 * - VARBIT_LEAGUE_TUTORIAL_COMPLETED (10037): baseVar=2606, bits [13..17] (startBit=13, endBit=18)
 * - bit 0: league mode enabled flag
 *
 * NOTE: The server stores varbits/varps independently; this keeps the packed VARP in sync
 * so any IF_OPENSUB snapshots that include VARP_LEAGUE_GENERAL never clobber tutorial state.
 */

function writeBits(base: number, startBit: number, endBitExclusive: number, value: number): number {
    const width = endBitExclusive - startBit;
    if (width <= 0) return base;
    const mask = ((1 << width) - 1) << startBit;
    const normalized = value & ((1 << width) - 1);
    return (base & ~mask) | ((normalized << startBit) & mask);
}

export function computeLeagueGeneralVarpFromPlayer(player: {
    getVarpValue: (id: number) => number;
    getVarbitValue: (id: number) => number;
}): number {
    let v = player.getVarpValue(VARP_LEAGUE_GENERAL);
    const leagueType = player.getVarbitValue(VARBIT_LEAGUE_TYPE);
    const tutorial = player.getVarbitValue(VARBIT_LEAGUE_TUTORIAL_COMPLETED);

    // Enable league mode (bit 0) when league_type is set.
    if (leagueType > 0) v |= 1;

    // Pack league_type and tutorial into VARP_LEAGUE_GENERAL (2606).
    v = writeBits(v, 1, 5, leagueType);
    v = writeBits(v, 13, 18, tutorial);
    return v;
}

export function syncLeagueGeneralVarp(player: {
    id: number;
    getVarpValue: (id: number) => number;
    setVarpValue: (id: number, value: number) => void;
    getVarbitValue: (id: number) => number;
}): { changed: boolean; value: number } {
    const next = computeLeagueGeneralVarpFromPlayer(player);
    const prev = player.getVarpValue(VARP_LEAGUE_GENERAL);
    if (next === prev) return { changed: false, value: prev };
    player.setVarpValue(VARP_LEAGUE_GENERAL, next);
    return { changed: true, value: next };
}
