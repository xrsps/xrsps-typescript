import {
    ACCOUNT_SUMMARY_GROUP_ID,
    SCRIPT_ACCOUNT_SUMMARY_SET_TIME_ID,
    buildAccountSummarySetTimeScriptArgs,
} from "../../../src/shared/ui/accountSummary";
import { getAccountSummaryTimeMinutes } from "../game/accountSummaryTime";
import type { PlayerState } from "../game/player";
import type { ServerServices } from "../game/ServerServices";

export class AccountSummaryTracker {
    private readonly lastMinutesByPlayer = new Map<number, number>();

    constructor(private readonly svc: ServerServices) {}

    clearPlayer(playerIdRaw: number): void {
        const playerId = playerIdRaw;
        if (playerId < 0) return;
        this.lastMinutesByPlayer.delete(playerId);
    }

    syncPlayer(player: PlayerState, nowMs: number = Date.now(), force: boolean = false): void {
        const playerId = player.id;
        if (!this.svc.interfaceManager.isWidgetGroupOpenInLedger(playerId, ACCOUNT_SUMMARY_GROUP_ID)) {
            this.lastMinutesByPlayer.delete(playerId);
            return;
        }

        const minutes = getAccountSummaryTimeMinutes(player, nowMs);
        if (!force && this.lastMinutesByPlayer.get(playerId) === minutes) {
            return;
        }

        this.lastMinutesByPlayer.set(playerId, minutes);
        this.svc.queueWidgetEvent(playerId, {
            action: "run_script",
            scriptId: SCRIPT_ACCOUNT_SUMMARY_SET_TIME_ID,
            args: buildAccountSummarySetTimeScriptArgs(minutes),
        });
    }
}
