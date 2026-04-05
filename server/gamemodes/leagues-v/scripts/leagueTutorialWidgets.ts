import {
    decodeSideJournalTabFromStateVarp,
    encodeSideJournalTabInStateVarp,
} from "../../../../src/shared/ui/sideJournal";
import {
    VARBIT_FLASHSIDE,
    VARBIT_LEAGUE_TUTORIAL_COMPLETED,
    VARBIT_LEAGUE_TYPE,
    VARBIT_SIDE_JOURNAL_TAB,
    VARP_LEAGUE_GENERAL,
    VARP_SIDE_JOURNAL_STATE,
} from "../../../../src/shared/vars";
import { getViewportTrackerFrontUid } from "../../../src/widgets/viewport";
import { LeagueTaskService } from "../LeagueTaskService";
import { syncLeagueGeneralVarp } from "../leagueGeneral";
import { type IScriptRegistry, type ScriptServices } from "../../../src/game/scripts/types";

// Interface/group IDs
const LEAGUE_TUTORIAL_MAIN_GROUP_ID = 677; // league_tutorial_main

// Widget child IDs (cache group 677)
const COMP_TUTORIAL_BUTTON_LEFT = 8;
const COMP_TUTORIAL_BUTTON_RIGHT = 9;

// Tutorial steps (league_type != 3)
const TUTORIAL_STEP_WELCOME = 0;
const TUTORIAL_STEP_OPEN_JOURNAL = 3;
const TUTORIAL_STEP_OPEN_LEAGUES_SUBTAB = 4;
function getLeagueTutorialCompleteStep(player: {
    getVarbitValue?: (id: number) => number;
}): number {
    // Matches [proc,script2449] (2449): league_type 3 -> 14, else 12.
    const leagueType = player.getVarbitValue?.(VARBIT_LEAGUE_TYPE) ?? 0;
    return leagueType === 3 ? 14 : 12;
}

// toplevel side button indices (toplevel_sidebuttons_enable uses %flashside - 1)
// 0=combat, 1=skills, 2=quest(journal), ...
const FLASHSIDE_QUEST_TAB = 3;

// Toplevel quest/journal tab clickable components (RuneLite interface mappings).
// - Fixed viewport (548): quests_tab = 66
// - Resizable viewport (161): quests_tab = 61
const TOPLEVEL_RESIZABLE_GROUP_ID = 161;
const TOPLEVEL_FIXED_GROUP_ID = 548;
const RESIZABLE_QUESTS_TAB_COMPONENT = 61;
const FIXED_QUESTS_TAB_COMPONENT = 66;

export function registerLeagueTutorialWidgetHandlers(registry: IScriptRegistry, services: ScriptServices): void {
    const syncLeagueGeneralVarpAndQueue = (player: any): void => {
        const res = syncLeagueGeneralVarp(player);
        if (res.changed) {
            services.queueVarp?.(player.id, VARP_LEAGUE_GENERAL, res.value);
        }
    };
    const syncSideJournalLeagueStateAndQueue = (player: any): void => {
        const prevStateVarp = player.getVarpValue?.(VARP_SIDE_JOURNAL_STATE) ?? 0;
        const decodedTab = decodeSideJournalTabFromStateVarp(prevStateVarp);
        const tab = decodedTab >= 0 && decodedTab <= 4 ? decodedTab : 0;
        const nextStateVarp = encodeSideJournalTabInStateVarp(prevStateVarp, tab);
        player.setVarpValue?.(VARP_SIDE_JOURNAL_STATE, nextStateVarp);
        player.setVarbitValue(VARBIT_SIDE_JOURNAL_TAB, tab);
        services.queueVarp?.(player.id, VARP_SIDE_JOURNAL_STATE, nextStateVarp);
        services.queueVarbit?.(player.id, VARBIT_SIDE_JOURNAL_TAB, tab);
    };

    // "Exit Leagues" (left) / "Get Started" (right)
    registry.onButton(LEAGUE_TUTORIAL_MAIN_GROUP_ID, COMP_TUTORIAL_BUTTON_LEFT, (event) => {
        const player = event.player;
        const tutorial = player.getVarbitValue?.(VARBIT_LEAGUE_TUTORIAL_COMPLETED) ?? 0;
        if (tutorial === TUTORIAL_STEP_WELCOME) {
            // Exit Leagues (OSRS: logs out / leaves league world).
            services.logoutPlayer?.(player, "exit_leagues");
            return;
        }
        // End Tutorial - allow at step 9 (after Karamja unlock) or step 11 (finishing)
        if (tutorial >= 9) {
            // Close the modal immediately before any varbit updates
            services.closeSubInterface?.(
                player,
                getViewportTrackerFrontUid(player.displayMode),
                LEAGUE_TUTORIAL_MAIN_GROUP_ID,
            );

            const completeStep = getLeagueTutorialCompleteStep(player);
            player.setVarbitValue(VARBIT_LEAGUE_TUTORIAL_COMPLETED, completeStep);
            player.setVarbitValue(VARBIT_FLASHSIDE, 0);
            player.accountStage = 2;
            // Tutorial finished: teleport player to Lumbridge (post-tutorial start area)
            services.teleportPlayer?.(player, 3222, 3218, 0, true);
            // Don't sync VARP_LEAGUE_GENERAL here - it packs the tutorial step and would
            // trigger the CS2 interface update script with an undefined step (blank window).
            // Just update server-side; client syncs on next login.
            syncLeagueGeneralVarp(player); // Update server-side only, don't queue to client
            services.queueVarbit?.(player.id, VARBIT_FLASHSIDE, 0);
            services.savePlayerSnapshot?.(player);

            // Open the remaining tabs now that the tutorial is complete.
            // During the tutorial, only the Quest tab was visible.
            services.openRemainingTabs?.(player);

            // League task: "Complete the Leagues Tutorial" (taskId=190)
            try {
                const res = LeagueTaskService.completeTask(player, 190);
                if (res.changed) {
                    for (const v of res.varpUpdates) {
                        services.queueVarp?.(player.id, v.id, v.value);
                    }
                    for (const v of res.varbitUpdates) {
                        services.queueVarbit?.(player.id, v.id, v.value);
                    }
                    if (res.notification) {
                        services.queueNotification?.(player.id, res.notification);
                    }
                }
            } catch {}
        }
    });

    registry.onButton(LEAGUE_TUTORIAL_MAIN_GROUP_ID, COMP_TUTORIAL_BUTTON_RIGHT, (event) => {
        const player = event.player;
        const tutorial = player.getVarbitValue?.(VARBIT_LEAGUE_TUTORIAL_COMPLETED) ?? 0;
        if (tutorial !== TUTORIAL_STEP_WELCOME) return;

        const SIDE_JOURNAL_GROUP_ID = 629;
        const journalAlreadyOpen = player.widgets?.isOpen?.(SIDE_JOURNAL_GROUP_ID) ?? false;

        // Determine the next tutorial step FIRST
        const nextStep = journalAlreadyOpen
            ? TUTORIAL_STEP_OPEN_LEAGUES_SUBTAB
            : TUTORIAL_STEP_OPEN_JOURNAL;

        // Update the varbit BEFORE opening any interfaces
        player.setVarbitValue(VARBIT_LEAGUE_TUTORIAL_COMPLETED, nextStep);
        syncLeagueGeneralVarpAndQueue(player);
        services.queueVarbit?.(player.id, VARBIT_LEAGUE_TUTORIAL_COMPLETED, nextStep);
        // Keep packed side-journal state (varp 1141 / varbit 8168) synchronized.
        syncSideJournalLeagueStateAndQueue(player);

        // Tutorial starts now (step > 0): place the player in the tutorial area.
        try {
            const requestTeleportAction = services.requestTeleportAction;
            if (!requestTeleportAction) {
                services.logger?.warn?.(
                    "[script:league_tutorial] requestTeleportAction service unavailable; tutorial-start teleport skipped",
                );
            } else {
                requestTeleportAction(player, {
                    x: 3094,
                    y: 3107,
                    level: 0,
                    delayTicks: 0,
                    cooldownTicks: 1,
                    requireCanTeleport: false,
                    rejectIfPending: false,
                    replacePending: true,
                });
            }
        } catch {}

        if (journalAlreadyOpen) {
            return;
        } else {
            // Flash the Quest (journal) tab icon to guide the player.
            player.setVarbitValue(VARBIT_FLASHSIDE, FLASHSIDE_QUEST_TAB);
            services.queueVarbit?.(player.id, VARBIT_FLASHSIDE, FLASHSIDE_QUEST_TAB);

            // Open the Quest tab
            const { getRootInterfaceId, DisplayMode } = require("../../../src/widgets/viewport");
            const dm = player.displayMode ?? DisplayMode.RESIZABLE_NORMAL;
            const rootId = getRootInterfaceId(dm);
            const questTabUid = (rootId << 16) | 78; // Quest tab uses childId 78
            const sideJournalTab = player.getVarbitValue?.(VARBIT_SIDE_JOURNAL_TAB) ?? 0;

            // Register with widget manager for tracking.
            // Include varbits so client's onVarTransmit handlers fire and color the tab.
            player.widgets?.open(SIDE_JOURNAL_GROUP_ID, {
                targetUid: questTabUid,
                type: 1,
                modal: false,
                varbits: { [VARBIT_SIDE_JOURNAL_TAB]: sideJournalTab },
            });
        }
    });

    // Quest tab icon (toplevel) click advances tutorial to the "open Leagues subtab" step.
    // Desktop resizable: 161:61 (quests_tab)
    registry.onButton(TOPLEVEL_RESIZABLE_GROUP_ID, RESIZABLE_QUESTS_TAB_COMPONENT, (event) => {
        const player = event.player;
        if (player.displayMode === 4) return; // mobile uses a different toplevel
        const tutorial = player.getVarbitValue?.(VARBIT_LEAGUE_TUTORIAL_COMPLETED) ?? 0;
        if (
            tutorial !== TUTORIAL_STEP_OPEN_JOURNAL &&
            tutorial !== TUTORIAL_STEP_OPEN_LEAGUES_SUBTAB
        ) {
            return;
        }
        player.setVarbitValue(
            VARBIT_LEAGUE_TUTORIAL_COMPLETED,
            TUTORIAL_STEP_OPEN_LEAGUES_SUBTAB,
        );
        syncLeagueGeneralVarpAndQueue(player);
        // Stop flashing the Quest tab now that the journal is open.
        player.setVarbitValue(VARBIT_FLASHSIDE, 0);
        services.queueVarbit?.(
            player.id,
            VARBIT_LEAGUE_TUTORIAL_COMPLETED,
            TUTORIAL_STEP_OPEN_LEAGUES_SUBTAB,
        );
        services.queueVarbit?.(player.id, VARBIT_FLASHSIDE, 0);
    });

    // Desktop fixed: 548:66 (quests_tab)
    registry.onButton(TOPLEVEL_FIXED_GROUP_ID, FIXED_QUESTS_TAB_COMPONENT, (event) => {
        const player = event.player;
        if (player.displayMode === 4) return; // mobile uses a different toplevel
        const tutorial = player.getVarbitValue?.(VARBIT_LEAGUE_TUTORIAL_COMPLETED) ?? 0;
        if (
            tutorial !== TUTORIAL_STEP_OPEN_JOURNAL &&
            tutorial !== TUTORIAL_STEP_OPEN_LEAGUES_SUBTAB
        ) {
            return;
        }
        player.setVarbitValue(
            VARBIT_LEAGUE_TUTORIAL_COMPLETED,
            TUTORIAL_STEP_OPEN_LEAGUES_SUBTAB,
        );
        syncLeagueGeneralVarpAndQueue(player);
        player.setVarbitValue(VARBIT_FLASHSIDE, 0);
        services.queueVarbit?.(
            player.id,
            VARBIT_LEAGUE_TUTORIAL_COMPLETED,
            TUTORIAL_STEP_OPEN_LEAGUES_SUBTAB,
        );
        services.queueVarbit?.(player.id, VARBIT_FLASHSIDE, 0);
    });

    // Mobile: 601:118 (tab container)
    registry.onButton(601, 118, (event) => {
        const player = event.player;
        if (player.displayMode !== 4) return;
        const tutorial = player.getVarbitValue?.(VARBIT_LEAGUE_TUTORIAL_COMPLETED) ?? 0;
        if (
            tutorial !== TUTORIAL_STEP_OPEN_JOURNAL &&
            tutorial !== TUTORIAL_STEP_OPEN_LEAGUES_SUBTAB
        ) {
            return;
        }
        player.setVarbitValue(
            VARBIT_LEAGUE_TUTORIAL_COMPLETED,
            TUTORIAL_STEP_OPEN_LEAGUES_SUBTAB,
        );
        syncLeagueGeneralVarpAndQueue(player);
        player.setVarbitValue(VARBIT_FLASHSIDE, 0);
        services.queueVarbit?.(
            player.id,
            VARBIT_LEAGUE_TUTORIAL_COMPLETED,
            TUTORIAL_STEP_OPEN_LEAGUES_SUBTAB,
        );
        services.queueVarbit?.(player.id, VARBIT_FLASHSIDE, 0);
    });
}
