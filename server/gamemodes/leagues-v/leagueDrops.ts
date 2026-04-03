import {
    VARBIT_LEAGUE_RELIC_1,
    VARBIT_LEAGUE_RELIC_2,
    VARBIT_LEAGUE_RELIC_3,
    VARBIT_LEAGUE_RELIC_4,
    VARBIT_LEAGUE_RELIC_5,
    VARBIT_LEAGUE_RELIC_6,
    VARBIT_LEAGUE_RELIC_7,
    VARBIT_LEAGUE_RELIC_8,
} from "../../../src/shared/vars";
import type { PlayerState } from "../../src/game/player";
import { isLeagueVWorld } from "./playerWorldRules";

const LEAGUE_V_ZULRAH_TYPE_IDS = new Set([2042, 2043, 2044]);
const ITEM_MAGIC_FANG = 12932;
const ITEM_UNCHARGED_TOXIC_TRIDENT = 12900;
const ITEM_ETERNAL_CRYSTAL = 13227;
const ITEM_ETERNAL_BOOTS = 13235;

const LEAGUE_RELIC_VARBITS = [
    VARBIT_LEAGUE_RELIC_1,
    VARBIT_LEAGUE_RELIC_2,
    VARBIT_LEAGUE_RELIC_3,
    VARBIT_LEAGUE_RELIC_4,
    VARBIT_LEAGUE_RELIC_5,
    VARBIT_LEAGUE_RELIC_6,
    VARBIT_LEAGUE_RELIC_7,
    VARBIT_LEAGUE_RELIC_8,
] as const;

export function isLeagueVWorldPlayer(player: PlayerState | undefined): boolean {
    return isLeagueVWorld(player);
}

function countUnlockedRelics(player: PlayerState): number {
    let unlocked = 0;
    for (const varbitId of LEAGUE_RELIC_VARBITS) {
        const selected = player.getVarbitValue(varbitId);
        if (selected > 0) unlocked++;
    }
    return unlocked;
}

export function getLeagueVDropRateMultiplier(player: PlayerState | undefined): number {
    if (!isLeagueVWorldPlayer(player)) return 1;
    const unlockedRelics = countUnlockedRelics(player!);
    if (unlockedRelics >= 4) return 5;
    if (unlockedRelics >= 1) return 2;
    return 1;
}

export function getLeagueVReplacementItemId(
    npcTypeId: number,
    itemId: number,
    isLeagueVWorld: boolean,
): number {
    if (!isLeagueVWorld) return itemId;
    const normalizedNpcTypeId = npcTypeId;
    const normalizedItemId = itemId;
    if (LEAGUE_V_ZULRAH_TYPE_IDS.has(normalizedNpcTypeId) && normalizedItemId === ITEM_MAGIC_FANG) {
        return ITEM_UNCHARGED_TOXIC_TRIDENT;
    }
    if (normalizedNpcTypeId === 5886 && normalizedItemId === ITEM_ETERNAL_CRYSTAL) {
        return ITEM_ETERNAL_BOOTS;
    }
    return normalizedItemId;
}
