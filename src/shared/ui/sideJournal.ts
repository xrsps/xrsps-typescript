import { packWidgetUid } from "./widgetUid";

/**
 * Side journal (quest tab) UI constants shared between client and server.
 *
 * - Base interface group: 629 (side_journal)
 * - Tab content mounts into the tab-container (629:43).
 * - Selection is driven by varbit 8168 (packed into varp 1141 bits 4..6).
 */
export const SIDE_JOURNAL_GROUP_ID = 629;
export const SIDE_JOURNAL_ROOT_CHILD_ID = 0;
export const SIDE_JOURNAL_ROOT_UID = packWidgetUid(
    SIDE_JOURNAL_GROUP_ID,
    SIDE_JOURNAL_ROOT_CHILD_ID,
);
export const SIDE_JOURNAL_TAB_STRIP_CHILD_ID = 1;
export const SIDE_JOURNAL_TAB_STRIP_UID = packWidgetUid(
    SIDE_JOURNAL_GROUP_ID,
    SIDE_JOURNAL_TAB_STRIP_CHILD_ID,
);
export const SIDE_JOURNAL_TAB_CONTAINER_CHILD_ID = 43;
export const SIDE_JOURNAL_TAB_CONTAINER_UID = packWidgetUid(
    SIDE_JOURNAL_GROUP_ID,
    SIDE_JOURNAL_TAB_CONTAINER_CHILD_ID,
);

export const SIDE_JOURNAL_LEAGUES_TAB = 4;

// Side journal tab list widgets.
export const SIDE_JOURNAL_SUMMARY_LIST_CHILD_ID = 2;
export const SIDE_JOURNAL_QUEST_LIST_CHILD_ID = 10;
export const SIDE_JOURNAL_TASK_LIST_CHILD_ID = 18;
export const SIDE_JOURNAL_ADVENTURE_PATH_LIST_CHILD_ID = 26;
// Side journal league tab widgets (used for league tutorial flashing behaviour).
// These IDs come from cache component mappings (see references/cs2-data/component-script-overrides.json).
export const SIDE_JOURNAL_LEAGUE_LIST_CHILD_ID = 34; // side_journal:league_list
export const SIDE_JOURNAL_LEAGUE_TAB_ICON_CHILD_ID = 42; // side_journal:tab_icon_5
export const SIDE_JOURNAL_LEAGUE_LIST_UID = packWidgetUid(
    SIDE_JOURNAL_GROUP_ID,
    SIDE_JOURNAL_LEAGUE_LIST_CHILD_ID,
);
export const SIDE_JOURNAL_LEAGUE_TAB_ICON_UID = packWidgetUid(
    SIDE_JOURNAL_GROUP_ID,
    SIDE_JOURNAL_LEAGUE_TAB_ICON_CHILD_ID,
);

export const SIDE_JOURNAL_NON_LEAGUE_TAB_LIST_UIDS: ReadonlyArray<number> = Object.freeze([
    packWidgetUid(SIDE_JOURNAL_GROUP_ID, SIDE_JOURNAL_SUMMARY_LIST_CHILD_ID),
    packWidgetUid(SIDE_JOURNAL_GROUP_ID, SIDE_JOURNAL_QUEST_LIST_CHILD_ID),
    packWidgetUid(SIDE_JOURNAL_GROUP_ID, SIDE_JOURNAL_TASK_LIST_CHILD_ID),
    packWidgetUid(SIDE_JOURNAL_GROUP_ID, SIDE_JOURNAL_ADVENTURE_PATH_LIST_CHILD_ID),
]);

export const SIDE_JOURNAL_DEFAULT_TAB = SIDE_JOURNAL_LEAGUES_TAB;

const SIDE_JOURNAL_TAB_VARP_SHIFT = 4;
const SIDE_JOURNAL_TAB_VARP_MASK = 7;

export function decodeSideJournalTabFromStateVarp(stateVarp: number): number {
    return ((stateVarp | 0) >>> SIDE_JOURNAL_TAB_VARP_SHIFT) & SIDE_JOURNAL_TAB_VARP_MASK;
}

export function encodeSideJournalTabInStateVarp(stateVarp: number, tab: number): number {
    const cleared = (stateVarp | 0) & ~(SIDE_JOURNAL_TAB_VARP_MASK << SIDE_JOURNAL_TAB_VARP_SHIFT);
    return cleared | (((tab | 0) & SIDE_JOURNAL_TAB_VARP_MASK) << SIDE_JOURNAL_TAB_VARP_SHIFT);
}

// Content interfaces mounted into SIDE_JOURNAL_TAB_CONTAINER_UID (629:43)
export const INTERFACE_CHARACTER_SUMMARY_ID = 712;
export const INTERFACE_QUEST_LIST_ID = 399;
export const INTERFACE_ACHIEVEMENT_DIARY_ID = 259;
export const INTERFACE_ADVENTURE_LOG_ID = 187;
export const INTERFACE_LEAGUE_SIDE_PANEL_ID = 656; // league_side_panel (Leagues I/II/IV/V)
export const INTERFACE_LEAGUE_3_SIDE_PANEL_ID = 736; // league_3_side_panel (Leagues III / Shattered Relics)

/**
 * Leagues tab content group ID selection.
 * Cache parity: Leagues III (league_type=3) uses a different side panel group (736),
 * while other league types use the standard panel (656).
 */
export function getSideJournalLeaguesContentGroupId(leagueType: number): number {
    return (leagueType | 0) === 3
        ? INTERFACE_LEAGUE_3_SIDE_PANEL_ID
        : INTERFACE_LEAGUE_SIDE_PANEL_ID;
}

/**
 * Maps side journal tab index -> interface group mounted into 629:43.
 * 0=Character Summary, 1=Quest List, 2=Achievement Diary, 3=Adventure Log, 4=Leagues
 */
export const SIDE_JOURNAL_CONTENT_GROUP_BY_TAB: Readonly<Record<number, number>> = Object.freeze({
    0: INTERFACE_CHARACTER_SUMMARY_ID,
    1: INTERFACE_QUEST_LIST_ID,
    2: INTERFACE_ACHIEVEMENT_DIARY_ID,
    3: INTERFACE_ADVENTURE_LOG_ID,
    // NOTE: Leagues tab is league-type dependent; see getSideJournalLeaguesContentGroupId().
    4: INTERFACE_LEAGUE_SIDE_PANEL_ID,
});
