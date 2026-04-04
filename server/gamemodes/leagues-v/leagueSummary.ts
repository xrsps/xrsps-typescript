import {
    LEAGUE_SUMMARY_GROUP_ID,
    SCRIPT_CC_TEXT_SWAPPER_ID,
    buildLeagueSummaryAccountAgeArgs,
} from "../../../src/shared/ui/leagueSummary";
import type { PlayerState } from "../../src/game/player";
import type { WidgetAction } from "../../src/widgets/WidgetManager";

export interface LeagueSummaryServices {
    queueWidgetEvent: (playerId: number, action: WidgetAction) => void;
    isWidgetGroupOpenInLedger: (playerId: number, groupId: number) => boolean;
}

export function formatLeagueSummaryAccountAge(totalMinutes: number): string {
    let minutes = Math.max(0, Number.isFinite(totalMinutes) ? Math.floor(totalMinutes) : 0);
    if (minutes < 2) {
        return "a minute";
    }

    let hours = Math.floor(minutes / 60);
    minutes %= 60;
    const days = Math.floor(hours / 24);

    if (days < 1) {
        if (hours < 1) {
            return `${minutes} minutes`;
        }
        if (hours === 1) {
            if (minutes === 1) {
                return "1 hour, 1 minute";
            }
            return `1 hour, ${minutes} minutes`;
        }
        if (minutes === 1) {
            return `${hours} hours, 1 minute`;
        }
        return `${hours} hours, ${minutes} minutes`;
    }

    hours %= 24;
    if (days === 1) {
        if (hours < 1) {
            if (minutes === 1) {
                return "1 day, 1 minute";
            }
            return `1 day, ${minutes} minutes`;
        }
        if (hours === 1) {
            return "1 day, 1 hour";
        }
        return `1 day, ${hours} hours`;
    }

    if (hours < 1) {
        if (minutes === 1) {
            return `${days} days, 1 minute`;
        }
        return `${days} days, ${minutes} minutes`;
    }
    if (hours === 1) {
        return `${days} days, 1 hour`;
    }
    return `${days} days, ${hours} hours`;
}

export class LeagueSummaryTracker {
    private readonly lastTextByPlayer = new Map<number, string>();

    constructor(private readonly services: LeagueSummaryServices) {}

    clearPlayer(playerIdRaw: number): void {
        const playerId = playerIdRaw;
        if (playerId < 0) return;
        this.lastTextByPlayer.delete(playerId);
    }

    syncPlayer(player: PlayerState, nowMs: number = Date.now(), force: boolean = false): void {
        const playerId = player.id;
        if (!this.services.isWidgetGroupOpenInLedger(playerId, LEAGUE_SUMMARY_GROUP_ID)) {
            this.lastTextByPlayer.delete(playerId);
            return;
        }

        const text = formatLeagueSummaryAccountAge(player.getAccountAgeMinutes(nowMs));
        if (!force && this.lastTextByPlayer.get(playerId) === text) {
            return;
        }

        this.lastTextByPlayer.set(playerId, text);
        this.services.queueWidgetEvent(playerId, {
            action: "run_script",
            scriptId: SCRIPT_CC_TEXT_SWAPPER_ID,
            args: buildLeagueSummaryAccountAgeArgs(text),
        });
    }
}
