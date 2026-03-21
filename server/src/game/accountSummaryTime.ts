import { MAP_FLAGS_LEAGUE_WORLD, VARP_MAP_FLAGS_CACHED } from "../../../src/shared/vars";

const ACCOUNT_SUMMARY_ACCOUNT_AGE_WORLD_FLAG = 1 << 11;

type AccountSummaryTimePlayer = {
    getVarpValue: (id: number) => number;
    getAccountAgeMinutes: (nowMs?: number) => number;
    getLifetimePlayTimeSeconds: (nowMs?: number) => number;
};

export function shouldUseAccountAgeInSummary(player: AccountSummaryTimePlayer): boolean {
    const mapFlags = player.getVarpValue(VARP_MAP_FLAGS_CACHED);
    return (
        (mapFlags & MAP_FLAGS_LEAGUE_WORLD) === MAP_FLAGS_LEAGUE_WORLD ||
        (mapFlags & ACCOUNT_SUMMARY_ACCOUNT_AGE_WORLD_FLAG) ===
            ACCOUNT_SUMMARY_ACCOUNT_AGE_WORLD_FLAG
    );
}

export function getAccountSummaryTimeMinutes(
    player: AccountSummaryTimePlayer,
    nowMs: number = Date.now(),
): number {
    if (shouldUseAccountAgeInSummary(player)) {
        return player.getAccountAgeMinutes(nowMs);
    }
    return Math.max(0, Math.floor(player.getLifetimePlayTimeSeconds(nowMs) / 60));
}
