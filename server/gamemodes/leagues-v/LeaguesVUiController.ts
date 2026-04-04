import { VARBIT_LEAGUE_TUTORIAL_COMPLETED } from "../../../src/shared/vars";
import type { PlayerState } from "../../src/game/player";
import type { GamemodeUiBridge, GamemodeUiController } from "../../src/game/gamemodes/GamemodeDefinition";
import {
    type LeagueWsUiBridge,
    type LeagueWsUiPlayer,
    applyLeagueTutorialStepFiveUi,
    applyLeagueTutorialStepNineUi,
    getLeagueSideJournalBootstrapState,
    handleLeagueAreasTutorialCloseViaWidgetClose,
    normalizeSideJournalLeagueState,
    queueActivateQuestSideTab,
    queueLeagueTutorialOverlayUi,
    queueSideJournalLeagueOnlyUi,
} from "./scripts/leagueWidgets";

const SIDE_JOURNAL_GROUP_ID = 629;

export class LeaguesVUiController implements GamemodeUiController {
    private readonly bridge: GamemodeUiBridge;
    private readonly leagueBridge: LeagueWsUiBridge;

    constructor(bridge: GamemodeUiBridge) {
        this.bridge = bridge;
        this.leagueBridge = {
            queueWidgetEvent: (playerId, action) => bridge.queueWidgetEvent(playerId, action),
            isWidgetGroupOpenInLedger: (playerId, groupId) =>
                bridge.isWidgetGroupOpenInLedger(playerId, groupId),
            queueVarp: (playerId, varpId, value) => bridge.queueVarp(playerId, varpId, value),
            queueVarbit: (playerId, varbitId, value) =>
                bridge.queueVarbit(playerId, varbitId, value),
        };
    }

    private asLeaguePlayer(player: PlayerState): LeagueWsUiPlayer {
        return player as unknown as LeagueWsUiPlayer;
    }

    normalizeSideJournalState(
        player: PlayerState,
        incomingStateVarp?: number,
    ): { tab: number; stateVarp: number } {
        return normalizeSideJournalLeagueState(this.asLeaguePlayer(player), incomingStateVarp);
    }

    applySideJournalUi(player: PlayerState): void {
        queueSideJournalLeagueOnlyUi(this.asLeaguePlayer(player), this.leagueBridge);
        applyLeagueTutorialStepFiveUi(this.asLeaguePlayer(player), this.leagueBridge);
        applyLeagueTutorialStepNineUi(this.asLeaguePlayer(player), this.leagueBridge);
    }

    queueTutorialOverlay(
        player: PlayerState,
        opts?: { queueFlashsideVarbitOnStep3?: boolean },
    ): void {
        const tutorialStep = player.getVarbitValue?.(VARBIT_LEAGUE_TUTORIAL_COMPLETED) ?? 0;
        queueLeagueTutorialOverlayUi(
            this.asLeaguePlayer(player),
            this.leagueBridge,
            tutorialStep,
            opts,
        );
    }

    handleWidgetClose(player: PlayerState, groupId: number): void {
        if (groupId === SIDE_JOURNAL_GROUP_ID) {
            applyLeagueTutorialStepFiveUi(this.asLeaguePlayer(player), this.leagueBridge);
            applyLeagueTutorialStepNineUi(this.asLeaguePlayer(player), this.leagueBridge);
        }
        if (groupId === 512) {
            handleLeagueAreasTutorialCloseViaWidgetClose(
                this.asLeaguePlayer(player),
                this.leagueBridge,
            );
        }
    }

    activateQuestTab(playerId: number): void {
        queueActivateQuestSideTab(playerId, this.leagueBridge);
    }

    getSideJournalBootstrapState(player: PlayerState): {
        varps: Record<number, number>;
        varbits: Record<number, number>;
    } {
        return getLeagueSideJournalBootstrapState(this.asLeaguePlayer(player));
    }
}
