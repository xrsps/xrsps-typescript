import type { PlayerState } from "../../src/game/player";

import {
    MAP_FLAGS_LEAGUE_WORLD,
    VARBIT_LEAGUE_TYPE,
    VARP_MAP_FLAGS_CACHED,
} from "../../../src/shared/vars";

export interface PlayerWorldRulesState {
    getVarpValue: (id: number) => number;
    getVarbitValue?: (id: number) => number;
}

export interface PlayerMovementCapabilities {
    hasInfiniteRunEnergy: boolean;
}

export function getActiveLeagueType(player: PlayerWorldRulesState | undefined): number {
    if (!player) return 0;
    return player.varps.getVarbitValue?.(VARBIT_LEAGUE_TYPE) ?? 0;
}

export function isLeagueWorld(player: PlayerWorldRulesState | undefined): boolean {
    if (!player) return false;
    const mapFlags = player.varps.getVarpValue(VARP_MAP_FLAGS_CACHED);
    return (mapFlags & MAP_FLAGS_LEAGUE_WORLD) === MAP_FLAGS_LEAGUE_WORLD;
}

export function isLeagueVWorld(player: PlayerWorldRulesState | undefined): boolean {
    return isLeagueWorld(player) && getActiveLeagueType(player) === 5;
}

export function getPlayerMovementCapabilities(
    player: PlayerWorldRulesState | undefined,
): PlayerMovementCapabilities {
    return {
        hasInfiniteRunEnergy: isLeagueVWorld(player),
    };
}

export function hasInfiniteRunEnergy(player: PlayerWorldRulesState | undefined): boolean {
    return getPlayerMovementCapabilities(player).hasInfiniteRunEnergy;
}

/**
 * Returns the tutorial completion step for a player's league type.
 * League type 3 uses 14 steps; all others use 12.
 * Matches [proc,script2449].
 */
export function getTutorialCompleteStep(player: PlayerState): number {
    const leagueType = player.varps.getVarbitValue?.(VARBIT_LEAGUE_TYPE) ?? 0;
    return leagueType === 3 ? 14 : 12;
}
