import {
    MAP_FLAGS_LEAGUE_WORLD,
    VARBIT_LEAGUE_TYPE,
    VARP_MAP_FLAGS_CACHED,
} from "../../../../src/shared/vars";

export interface PlayerWorldRulesState {
    getVarpValue: (id: number) => number;
    getVarbitValue?: (id: number) => number;
}

export interface PlayerMovementCapabilities {
    hasInfiniteRunEnergy: boolean;
}

export function getActiveLeagueType(player: PlayerWorldRulesState | undefined): number {
    if (!player) return 0;
    return player.getVarbitValue?.(VARBIT_LEAGUE_TYPE) ?? 0;
}

export function isLeagueWorld(player: PlayerWorldRulesState | undefined): boolean {
    if (!player) return false;
    const mapFlags = player.getVarpValue(VARP_MAP_FLAGS_CACHED);
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
