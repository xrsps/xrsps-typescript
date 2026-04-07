import type { PlayerState } from "../game/player";
import type { ServerServices } from "../game/ServerServices";

export const REPORT_GAME_TIME_GROUP_ID = 162;
const REPORT_GAME_TIME_TEXT_CHILD_ID = 33;
const REPORT_GAME_TIME_TEXT_UID =
    ((REPORT_GAME_TIME_GROUP_ID & 0xffff) << 16) | (REPORT_GAME_TIME_TEXT_CHILD_ID & 0xffff);

export function formatReportGameTime(totalSeconds: number): string {
    const safeTotalSeconds = Math.max(
        0,
        Number.isFinite(totalSeconds) ? Math.floor(totalSeconds) : 0,
    );
    const hours = Math.floor(safeTotalSeconds / 3600);
    const minutes = Math.floor((safeTotalSeconds % 3600) / 60);
    const seconds = safeTotalSeconds % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(
        seconds,
    ).padStart(2, "0")}`;
}

export class ReportGameTimeTracker {
    private readonly lastTextByPlayer = new Map<number, string>();

    constructor(private readonly svc: ServerServices) {}

    clearPlayer(playerIdRaw: number): void {
        const playerId = playerIdRaw;
        if (playerId < 0) return;
        this.lastTextByPlayer.delete(playerId);
    }

    syncPlayer(player: PlayerState, nowMs: number = Date.now(), force: boolean = false): void {
        const playerId = player.id;
        if (!this.svc.interfaceManager.isWidgetGroupOpenInLedger(playerId, REPORT_GAME_TIME_GROUP_ID)) {
            this.lastTextByPlayer.delete(playerId);
            return;
        }

        const text = formatReportGameTime(player.account.getSessionPlayTimeSeconds(nowMs));
        if (!force && this.lastTextByPlayer.get(playerId) === text) {
            return;
        }

        this.lastTextByPlayer.set(playerId, text);
        this.svc.queueWidgetEvent(playerId, {
            action: "set_text",
            uid: REPORT_GAME_TIME_TEXT_UID,
            text,
        });
    }
}
