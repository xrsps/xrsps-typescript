import { VARBIT_MASTERY_POINT_UNLOCK_BASE } from "../../../../src/shared/leagues/leagueTypes";
import {
    ACCOUNT_SUMMARY_COLLECTION_LOG_CHILD_INDEX,
    ACCOUNT_SUMMARY_ENTRY_LIST_UID,
    ACCOUNT_SUMMARY_GROUP_ID,
    ACCOUNT_SUMMARY_PLAYTIME_CHILD_INDEX,
} from "../../../../src/shared/ui/accountSummary";
import { LEAGUE_SUMMARY_GROUP_ID } from "../../../../src/shared/ui/leagueSummary";
import {
    SIDE_JOURNAL_CONTENT_GROUP_BY_TAB,
    SIDE_JOURNAL_GROUP_ID,
    SIDE_JOURNAL_TAB_CONTAINER_UID,
    decodeSideJournalTabFromStateVarp,
    encodeSideJournalTabInStateVarp,
    getSideJournalLeaguesContentGroupId,
} from "../../../../src/shared/ui/sideJournal";
import {
    MAP_FLAGS_LEAGUE_WORLD,
    VARBIT_FLASHSIDE,
    VARBIT_LEAGUE_AREA_LAST_VIEWED,
    VARBIT_LEAGUE_AREA_SELECTION_0,
    VARBIT_LEAGUE_AREA_SELECTION_1,
    VARBIT_LEAGUE_AREA_SELECTION_2,
    VARBIT_LEAGUE_AREA_SELECTION_3,
    VARBIT_LEAGUE_AREA_SELECTION_4,
    VARBIT_LEAGUE_AREA_SELECTION_5,
    VARBIT_LEAGUE_MAGIC_MASTERY,
    VARBIT_LEAGUE_MASTERY_POINTS_EARNED,
    VARBIT_LEAGUE_MASTERY_POINTS_TO_SPEND,
    VARBIT_LEAGUE_MELEE_MASTERY,
    VARBIT_LEAGUE_RANGED_MASTERY,
    VARBIT_LEAGUE_RELIC_1,
    VARBIT_LEAGUE_RELIC_2,
    VARBIT_LEAGUE_RELIC_3,
    VARBIT_LEAGUE_RELIC_4,
    VARBIT_LEAGUE_RELIC_5,
    VARBIT_LEAGUE_RELIC_6,
    VARBIT_LEAGUE_RELIC_7,
    VARBIT_LEAGUE_RELIC_8,
    VARBIT_LEAGUE_TOTAL_TASKS_COMPLETED,
    VARBIT_LEAGUE_TUTORIAL_COMPLETED,
    VARBIT_LEAGUE_TYPE,
    VARBIT_SIDE_JOURNAL_TAB,
    VARP_LEAGUE_GENERAL,
    VARP_LEAGUE_POINTS_CLAIMED,
    VARP_LEAGUE_POINTS_COMPLETED,
    VARP_LEAGUE_POINTS_CURRENCY,
    VARP_MAP_FLAGS_CACHED,
    VARP_SIDE_JOURNAL_STATE,
} from "../../../../src/shared/vars";
import type { WidgetAction } from "../../../src/widgets/WidgetManager";
import { getMainmodalUid, getViewportTrackerFrontUid } from "../../../src/widgets/viewport";
import { syncLeagueGeneralVarp } from "../leagueGeneral";
import {
    getLeaguePackedVarpsForPlayer,
    syncLeaguePackedVarps,
} from "../leaguePackedVarps";
import { type ScriptModule, type WidgetActionEvent } from "../../../src/game/scripts/types";

export type LeagueWsUiPlayer = {
    id: number;
    displayMode: number;
    getVarbitValue: (id: number) => number;
    getVarpValue: (id: number) => number;
    setVarbitValue: (id: number, value: number) => void;
    setVarpValue: (id: number, value: number) => void;
};

type LeagueWidgetEventAction = WidgetAction;

export type LeagueWsUiBridge = {
    queueWidgetEvent: (playerId: number, action: LeagueWidgetEventAction) => void;
    isWidgetGroupOpenInLedger: (playerId: number, groupId: number) => boolean;
    queueVarp: (playerId: number, varpId: number, value: number) => void;
    queueVarbit: (playerId: number, varbitId: number, value: number) => void;
};

function queueLeaguePackedVarpUpdates(
    services: { queueVarp?: (playerId: number, varpId: number, value: number) => void },
    playerId: number,
    updates: Array<{ id: number; value: number }>,
): void {
    if (!services.queueVarp) {
        return;
    }
    for (const update of updates) {
        services.queueVarp(playerId, update.id, update.value);
    }
}

// =============================================================================
// CS2-DRIVEN UI (OSRS parity)
// =============================================================================
// The server ONLY:
//   1) opens/closes interfaces
//   2) persists league varbits/varps
//   3) validates button ops that must be server-authoritative (e.g., unlocking areas)
//
// The client CS2 scripts handle ALL widget drawing/hover/transition logic via onLoad/onResize/onOp.
// =============================================================================

// League interface group IDs
const LEAGUE_AREAS_GROUP_ID = 512; // trailblazer_areas
const LEAGUE_INFO_GROUP_ID = 654; // league_info
const LEAGUE_RELICS_GROUP_ID = 655; // league_relics
const LEAGUE_3_FRAGMENTS_GROUP_ID = 735; // league_3_fragments (L3)
const LEAGUE_SIDE_PANEL_L5_GROUP_ID = 656; // league_side_panel (L5)
const LEAGUE_TASKS_GROUP_ID = 657; // league_tasks
const LEAGUE_TUTORIAL_MAIN_GROUP_ID = 677; // league_tutorial_main
const LEAGUE_UNLOCKS_GROUP_ID = 733; // league_3_unlocks (L3)
const LEAGUE_SIDE_PANEL_L3_GROUP_ID = 736; // league_3_side_panel (L3)
const LEAGUE_COMBAT_MASTERY_GROUP_ID = 311; // league_combat_mastery
const LEAGUE_RANK_GROUP_ID = 64; // league_rank

// Component IDs for server-authoritative button handlers
const COMP_SELECT_BUTTON = 82; // Select/Unlock/Teleport area button
const COMP_SELECT_BACK = 83; // Back button

// CS2 script IDs
const SCRIPT_LEAGUE_AREAS_SHOW_DETAILED = 3668; // [clientscript,league_areas_show_detailed]
const SCRIPT_LEAGUE_RELIC_EXPANDED_VIEW = 3193; // [clientscript,league_relic_expanded_view]

const FLAG_TRANSMIT_OP1 = 1 << 1;
const FLAG_TRANSMIT_OP2 = 1 << 2;
const ACCOUNT_SUMMARY_COLLECTION_ACTION_FLAGS = FLAG_TRANSMIT_OP1 | FLAG_TRANSMIT_OP2;
const ACCOUNT_SUMMARY_PLAYTIME_ACTION_FLAGS = FLAG_TRANSMIT_OP1;

// League unlock sound effects (synth IDs from references/osrs-synths.json)
const SYNTH_TRAILBLAZER_UNLOCK_MAP = 2353; // trailblazer_unlock_map - area unlock
const SYNTH_TRAILBLAZER_UNLOCK_POWER = 2344; // trailblazer_unlock_power - relic unlock (L2)
const SYNTH_TRAILBLAZER_UNLOCK_RAISE = 2330; // trailblazer_unlock_raise - alternative
const SYNTH_TRAILBLAZER_UNLOCK_TWUNKLES = 2331; // trailblazer_unlock_twunkles - sparkle sound
const SYNTH_RELIC_UNLOCK_PULSING = 4215; // relic_unlock_pulsing (leaguetwisted) - relic unlock

// Cache IDs used by league scripts (CS2 authoritative)
const ENUM_LEAGUE_AREA_UNLOCKS = 5677; // enum_5677
const PARAM_LEAGUE_AREA_TASKS_REQUIRED = 1010; // param_1010

// region_data DB columns (cache authoritative)
// Source: references/cs2-data/learned-db-columns.json
const DB_COL_REGION_DATA_REGION_ID = 335872; // region_data:region_id
const DB_COL_REGION_DATA_AREA_TELEPORT_COORD = 336048; // region_data:area_teleport_coord

// Widget child IDs (trailblazer_areas / group 512) used by server-driven view switch.
// Verified via cache inspection and CS2 args for trailblazer_areas_init (3657).
const COMP_AREAS_LOADING = 40;
const COMP_AREAS_DETAILS = 41;
const COMP_AREAS_NAME_SHIELD = 42;
const COMP_AREAS_NAME_HEADER = 43;
const COMP_AREAS_CLOSE_BUTTON = 5;
const COMP_AREAS_DESCRIPTION = 78;
const COMP_AREAS_ICON = 89;

// Map view layers (used by league_area_back (3678) and show_detailed (3669) to toggle views).
// NOTE: These are NOT the individual shields/labels; they are the 3 sibling layers under 512:10
// that make up the overview map (background + shields + names).
//
// If these IDs are wrong, script 3669 will hide the wrong container (often 512:1), making the
// detailed view appear "invisible" because it lives under that container in the cache tree.
const COMP_AREAS_MAP_BG_LAYER = 14;
const COMP_AREAS_SHIELDS_LAYER = 38;
const COMP_AREAS_NAMES_LAYER = 39;

// Confirmation overlay components (unlock flow).
// Cache structure (group 512):
// - 512:12 is the *overlay container* (covers the full area)
//   - 512:56 is the dimming rectangle
//   - 512:57 is the centered confirm popup root (contains 58..61)
//
// The CS2 confirm scripts (3674/3680) toggle a single component. In the cache,
// that component is the overlay container (512:12). If we only unhide 512:57 while
// 512:12 is hidden, the popup stays effectively hidden.
const COMP_AREAS_CONFIRM_LAYER = 12; // confirm overlay container (hidden until Unlock)
const COMP_AREAS_CONFIRM_STEELBORDER = 58; // container passed to steelborder()
const COMP_AREAS_CONFIRM_MESSAGE = 59; // confirm message text widget
const COMP_AREAS_CONFIRM_BUTTON = 61; // "Confirm" button (league_area_confirm_selection)
const COMP_AREAS_CANCEL_BUTTON = 60; // "Cancel" button (league_area_confirm_back)

// L5 side panel buttons
const L5_COMP_VIEW_INFO = 2;
const L5_COMP_SHOW_SUMMARY = 7;
const L5_COMP_SHOW_RANKS = 10;
const L5_COMP_VIEW_MASTERIES = 32;
const L5_COMP_VIEW_TASKS = 36;
const L5_COMP_VIEW_AREAS = 40;
const L5_COMP_VIEW_RELICS = 44;

// L3 side panel buttons
const L3_COMP_VIEW_INFO = 21;
const L3_COMP_VIEW_TASKS = 25;
const L3_COMP_VIEW_FRAGMENTS = 30;
const L3_COMP_DISPLAY_FRAGMENTS_TOGGLE = 32;
const L3_COMP_VIEW_UNLOCKS = 35;

// League relics
// Cache parity (script3188, league_relics_init): clickzones component is the parent for dynamic CC_CREATE
// rectangles that represent each relic entry (op=View).
const L5_RELIC_CLICKZONES_CHILD = 22;
// Close button for the relics interface
const L5_RELIC_CLOSE_BUTTON_CHILD = 4;
// Select button in the expanded view (shows confirm overlay when clicked)
const L5_RELIC_SELECT_BUTTON_CHILD = 44;
// Confirm/cancel buttons exist inside the shared confirm overlay container (league_relics_confirm10).
// Confirm is left-aligned, Cancel right-aligned.
const L5_RELIC_CONFIRM_BUTTON_CHILD = 51;
const L5_RELIC_CANCEL_BUTTON_CHILD = 50;

// League combat mastery (group 311)
// Clickzones component is the parent for dynamic CC_CREATE rectangles representing mastery nodes.
const L5_MASTERY_CLICKZONES_CHILD = 36;
// Close button for the mastery interface
const L5_MASTERY_CLOSE_BUTTON_CHILD = 76;
// Select button in the expanded view (shows confirm overlay when clicked)
const L5_MASTERY_SELECT_BUTTON_CHILD = 55;
// Confirm/cancel buttons in the confirm overlay
const L5_MASTERY_CONFIRM_BUTTON_CHILD = 71;
const L5_MASTERY_CANCEL_BUTTON_CHILD = 72;
// Script that shows the mastery expanded/detail view
const SCRIPT_LEAGUE_MASTERY_EXPANDED_VIEW = 7674;

// IF_SETEVENTS flags:
// - Widget action transmit flags are bits 1-10 (op1..op10). For op1, that's bit 1 => 1<<1.
// - Bit 0 is the "pause button" flag (resume_pausebutton), not used for relic selection.
const IF_SETEVENTS_TRANSMIT_OP1 = 1 << 1;

const LEAGUE_RELIC_SELECTION_VARBITS = [
    VARBIT_LEAGUE_RELIC_1,
    VARBIT_LEAGUE_RELIC_2,
    VARBIT_LEAGUE_RELIC_3,
    VARBIT_LEAGUE_RELIC_4,
    VARBIT_LEAGUE_RELIC_5,
    VARBIT_LEAGUE_RELIC_6,
    VARBIT_LEAGUE_RELIC_7,
    VARBIT_LEAGUE_RELIC_8,
];

const LEAGUE_MASTERY_POINT_UNLOCK_VARBITS = Array.from(
    { length: 10 },
    (_, index) => VARBIT_MASTERY_POINT_UNLOCK_BASE + index,
);

// League tasks
const COMP_VIEW_RELICS = 7;
// Close button for the tasks interface (user confirmed child 3)
const COMP_TASKS_CLOSE_BUTTON = 3;

// ============================================================================
// League tutorial UI highlights (screenhighlight / ui_highlights)
// ============================================================================
// Uses the standard OSRS ui_highlights overlay (toplevel_*:ui_highlights) via script8477 wrappers.
// - 8478: wrapper for script8477 (creates/updates a highlight)
// - 8484: wrapper for script8483 (clears a highlight)
const SCRIPT_UI_HIGHLIGHT = 8478;
const SCRIPT_UI_HIGHLIGHT_CLEAR = 8484;
// Common default highlight style used by other tutorial flashes (toplevel_flashicon/equipment_icon_check).
const UI_HIGHLIGHT_STYLE_DEFAULT = 7034;
// Highlight namespace for our leagues tutorial routing (int0 in script8477).
const UI_HIGHLIGHT_KIND_LEAGUE_TUTORIAL = 10;
// Per-step highlight IDs under UI_HIGHLIGHT_KIND_LEAGUE_TUTORIAL (int1 in script8477).
const UI_HIGHLIGHT_ID_TASKS_BUTTON = 0;
const UI_HIGHLIGHT_ID_AREAS_BUTTON = 1;
const UI_HIGHLIGHT_ID_KARAMJA_SHIELD = 2;
const UI_HIGHLIGHT_ID_UNLOCK_BUTTON = 3;
const UI_HIGHLIGHT_ID_RELICS_BUTTON = 4;
const UI_HIGHLIGHT_ID_RELICS_CLOSE_BUTTON = 5;
const UI_HIGHLIGHT_ID_TASKS_CLOSE_BUTTON = 6;
// Tier 0 relics highlight IDs (one per relic in the first column, typically 3)
const UI_HIGHLIGHT_ID_TIER0_RELIC_BASE = 7; // IDs 7, 8, 9, ... for each tier 0 relic
const UI_HIGHLIGHT_ID_AREAS_CLOSE_BUTTON = 17;

// ============================================================================
// League relic selection (server authoritative)
// ============================================================================
// The client draws the relic UI via CS2, but selection must be validated + persisted by the server
// by setting %league_relic_selection_* varbits, which the client reads via league_relic_active (3697).
//
// Cache/CS2:
// - enum_2670 maps league_type -> league struct
// - league struct param_870 -> enum (tierIndex -> tier struct)
// - tier struct param_877 -> points required for the tier
// - tier struct param_878 -> enum (relicKey -> relic struct)
//
// Selection varbits store the relicKey (1..N) within the tier enum, or 0 for none.
const ENUM_LEAGUE_TYPE_STRUCT = 2670; // enum_2670
const PARAM_LEAGUE_RELIC_TIER_ENUM = 870; // param_870
const PARAM_LEAGUE_RELICS_ENUM = 878; // param_878
const PARAM_LEAGUE_RELIC_TIER_POINTS_REQUIRED = 877; // param_877
const PARAM_LEAGUE_RELIC_REWARD_OBJ = 2049; // param_2049 (namedobj)
const PARAM_LEAGUE_RELIC_TIER_PASSIVE_STRUCT = 2045; // param_2045 (struct with param_1020)
const VARP_LEAGUE_TASK_COUNT = 2612;

type LeagueRelicIndexEntry = {
    leagueType: number;
    globalIndex: number;
    tierIndex: number;
    relicKey: number;
    relicStructId: number;
    tierPointsRequired: number;
    tierPassiveStructId: number;
};

const leagueRelicIndexCache: Map<number, LeagueRelicIndexEntry[]> = new Map();

function findEnumIntValue(enumType: any, key: number): number | null {
    const keys: number[] | undefined = enumType?.keys;
    const values: number[] | undefined = enumType?.intValues;
    if (!Array.isArray(keys) || !Array.isArray(values)) return null;
    for (let i = 0; i < keys.length; i++) {
        if (keys[i] === key) return values[i] as number;
    }
    return null;
}

function getEnumOutputCount(enumType: any): number {
    const keys: number[] | undefined = enumType?.keys;
    return Array.isArray(keys) ? keys.length : 0;
}

function getLeagueRelicIndexMap(services: any, leagueType: number): LeagueRelicIndexEntry[] | null {
    const lt = leagueType;
    const cached = leagueRelicIndexCache.get(lt);
    if (cached) return cached;

    const enumLoader = services?.getEnumTypeLoader?.() ?? services?.enumTypeLoader;
    const structLoader = services?.getStructTypeLoader?.() ?? services?.structTypeLoader;
    if (!enumLoader?.load) {
        console.log(`[league] getLeagueRelicIndexMap: enumLoader missing`);
        return null;
    }
    if (!structLoader?.load) {
        console.log(`[league] getLeagueRelicIndexMap: structLoader missing`);
        return null;
    }
    const leagueEnum = enumLoader.load(ENUM_LEAGUE_TYPE_STRUCT);
    if (!leagueEnum) {
        console.log(
            `[league] getLeagueRelicIndexMap: failed to load enum ${ENUM_LEAGUE_TYPE_STRUCT}`,
        );
        return null;
    }
    const leagueStructId = findEnumIntValue(leagueEnum, lt);
    if (!(leagueStructId && leagueStructId > 0)) {
        console.log(`[league] getLeagueRelicIndexMap: no struct for leagueType=${lt} in enum`);
        return null;
    }
    const leagueStruct = structLoader.load(leagueStructId);
    const tierEnumId = leagueStruct?.params?.get?.(PARAM_LEAGUE_RELIC_TIER_ENUM) as
        | number
        | undefined;
    if (typeof tierEnumId !== "number" || tierEnumId <= 0) {
        console.log(
            `[league] getLeagueRelicIndexMap: missing tier enum param in struct ${leagueStructId}`,
        );
        return null;
    }

    const tierEnum = enumLoader.load(tierEnumId);
    if (!tierEnum) return null;
    const tierCount = getEnumOutputCount(tierEnum);
    if (!(tierCount > 0)) return null;

    const out: LeagueRelicIndexEntry[] = [];
    let globalIndex = 0;
    for (
        let tierIndex = 0;
        tierIndex < tierCount && tierIndex < LEAGUE_RELIC_SELECTION_VARBITS.length;
        tierIndex++
    ) {
        const tierStructId = findEnumIntValue(tierEnum, tierIndex);
        if (!(tierStructId && tierStructId > 0)) return null;
        const tierStruct = structLoader.load(tierStructId);
        const tierPointsRequired = (tierStruct?.params?.get?.(
            PARAM_LEAGUE_RELIC_TIER_POINTS_REQUIRED,
        ) ?? 0) as number;
        const tierPassiveStructId = (tierStruct?.params?.get?.(
            PARAM_LEAGUE_RELIC_TIER_PASSIVE_STRUCT,
        ) ?? 0) as number;
        if (!(tierPassiveStructId > 0)) return null;
        const relicEnumId = tierStruct?.params?.get?.(PARAM_LEAGUE_RELICS_ENUM) as
            | number
            | undefined;
        if (typeof relicEnumId !== "number" || relicEnumId <= 0) return null;
        const relicEnum = enumLoader.load(relicEnumId);
        if (!relicEnum) return null;

        const relicCount = getEnumOutputCount(relicEnum);
        for (let relicKey = 1; relicKey <= relicCount; relicKey++) {
            const relicStructId = findEnumIntValue(relicEnum, relicKey);
            if (!(relicStructId && relicStructId > 0)) return null;
            out.push({
                leagueType: lt,
                globalIndex: globalIndex,
                tierIndex: tierIndex,
                relicKey: relicKey,
                relicStructId: relicStructId,
                tierPointsRequired: tierPointsRequired as number,
                tierPassiveStructId: tierPassiveStructId as number,
            });
            globalIndex++;
        }
    }

    leagueRelicIndexCache.set(lt, out);
    return out;
}

function getRelicSelectionVarbitIdForTier(tierIndex: number): number | null {
    const idx = tierIndex;
    if (idx < 0 || idx >= LEAGUE_RELIC_SELECTION_VARBITS.length) return null;
    return LEAGUE_RELIC_SELECTION_VARBITS[idx];
}

// Area selection varbits (6 slots for unlocked areas)
const AREA_SELECTION_VARBITS = [
    VARBIT_LEAGUE_AREA_SELECTION_0,
    VARBIT_LEAGUE_AREA_SELECTION_1,
    VARBIT_LEAGUE_AREA_SELECTION_2,
    VARBIT_LEAGUE_AREA_SELECTION_3,
    VARBIT_LEAGUE_AREA_SELECTION_4,
    VARBIT_LEAGUE_AREA_SELECTION_5,
];

// Cached area unlock progression requirements (loaded from cache enum_5677 + structs on demand).
let leagueAreaUnlockTasksRequiredCache: number[] | null = null;

function getLeagueAreaUnlockTasksRequired(services: any): number[] | null {
    if (leagueAreaUnlockTasksRequiredCache) return leagueAreaUnlockTasksRequiredCache;

    const enumLoader = services?.getEnumTypeLoader?.() ?? services?.enumTypeLoader;
    const structLoader = services?.getStructTypeLoader?.() ?? services?.structTypeLoader;
    const enumType = enumLoader?.load?.(ENUM_LEAGUE_AREA_UNLOCKS);
    if (!enumType || !enumType.keys || !enumType.intValues) return null;
    if (!structLoader?.load) return null;

    // enum_5677: key stageIndex -> value structId
    const out: number[] = [];
    for (let stage = 0; stage < 5; stage++) {
        let structId: number | undefined;
        for (let i = 0; i < enumType.keys.length; i++) {
            if (enumType.keys[i] === stage) {
                structId = enumType.intValues[i];
                break;
            }
        }
        if (structId === undefined || structId <= 0) return null;
        const st = structLoader.load(structId);
        const tasksRequired = (st?.params?.get?.(PARAM_LEAGUE_AREA_TASKS_REQUIRED) ?? -1) as number;
        if (!(tasksRequired >= 0)) return null;
        out.push(tasksRequired);
    }

    leagueAreaUnlockTasksRequiredCache = out;
    return out;
}

function getCurrentLeagueAreaUnlockStage(
    player: any,
    services: any,
): {
    stageIndex: number;
    tasksRequired: number;
    slotVarbitId: number;
    canUnlock: boolean;
} | null {
    const tasksRequiredByStage = getLeagueAreaUnlockTasksRequired(services);
    if (!tasksRequiredByStage) return null;

    const tasksCompleted = player.getVarbitValue?.(VARBIT_LEAGUE_TOTAL_TASKS_COMPLETED) ?? 0;
    for (let stage = 0; stage < tasksRequiredByStage.length && stage < 5; stage++) {
        const tasksRequired = tasksRequiredByStage[stage];
        if (tasksCompleted < tasksRequired) {
            return {
                stageIndex: stage,
                tasksRequired,
                slotVarbitId: AREA_SELECTION_VARBITS[stage],
                canUnlock: false,
            };
        }

        const slotVarbitId = AREA_SELECTION_VARBITS[stage];
        const slotValue = player.getVarbitValue?.(slotVarbitId) ?? 0;
        if (slotValue === 0) {
            return {
                stageIndex: stage,
                tasksRequired,
                slotVarbitId,
                canUnlock: true,
            };
        }
    }

    return null;
}

// League Areas: verified from cache group 512 onLoad args for script 3657 (trailblazer_areas_init).
// - Shields: 44,46-55 (45 is NOT an area shield)
// - Names: 92,94-103 (93 is NOT an area label)
const LEAGUE_AREAS: ReadonlyArray<{
    name: string;
    regionId: number;
    shieldChildId: number;
    nameChildId: number;
}> = Object.freeze([
    { name: "Misthalin", regionId: 1, shieldChildId: 44, nameChildId: 92 },
    { name: "Karamja", regionId: 2, shieldChildId: 46, nameChildId: 94 },
    { name: "Desert", regionId: 6, shieldChildId: 47, nameChildId: 95 },
    { name: "Morytania", regionId: 5, shieldChildId: 48, nameChildId: 96 },
    { name: "Asgarnia", regionId: 3, shieldChildId: 49, nameChildId: 97 },
    { name: "Kandarin", regionId: 4, shieldChildId: 50, nameChildId: 98 },
    { name: "Fremennik", regionId: 8, shieldChildId: 51, nameChildId: 99 },
    { name: "Tirannwn", regionId: 7, shieldChildId: 52, nameChildId: 100 },
    { name: "Wilderness", regionId: 11, shieldChildId: 53, nameChildId: 101 },
    { name: "Kourend", regionId: 20, shieldChildId: 54, nameChildId: 102 },
    { name: "Varlamore", regionId: 21, shieldChildId: 55, nameChildId: 103 },
]);

function normalizeLeagueAreaSelectionValue(regionId: number): number {
    // OSRS parity: script3681 normalizes legacy region ids 9/10 -> 20 (Kourend).
    if (regionId === 9 || regionId === 10) return 20;
    return regionId;
}

function uidForTrailblazerAreas(childId: number): number {
    return ((LEAGUE_AREAS_GROUP_ID & 0xffff) << 16) | (childId & 0xffff);
}

function uidForLeagueSidePanelL5(childId: number): number {
    return ((LEAGUE_SIDE_PANEL_L5_GROUP_ID & 0xffff) << 16) | (childId & 0xffff);
}

function packCoord(x: number, y: number, level: number = 0): number {
    return ((level & 0x3) << 28) | ((x & 0x3fff) << 14) | (y & 0x3fff);
}

function decodeCoord(packed: number): { x: number; y: number; level: number } {
    // OSRS Coord packing: (plane << 28) | (x << 14) | y
    const v = packed;
    const level = (v >>> 28) & 0x3;
    const x = (v >>> 14) & 0x3fff;
    const y = v & 0x3fff;
    return { x, y, level };
}

const leagueAreaTeleportCoordCache: Map<number, number> = new Map();

const LEAGUE_AREA_FALLBACK_TELEPORT_COORD: Record<number, number> = Object.freeze({
    // Region IDs (1=Misthalin, 2=Karamja, etc.)
    1: packCoord(3210, 3420, 0), // Misthalin (Varrock-ish)
    2: packCoord(2860, 2960, 0), // Karamja
    6: packCoord(3340, 2970, 0), // Desert
    5: packCoord(3490, 3465, 0), // Morytania
    3: packCoord(2980, 3370, 0), // Asgarnia
    4: packCoord(2680, 3440, 0), // Kandarin
    8: packCoord(2620, 3680, 0), // Fremennik
    7: packCoord(2190, 3240, 0), // Tirannwn
    11: packCoord(3110, 3525, 0), // Wilderness
    20: packCoord(1565, 3555, 0), // Kourend
    21: packCoord(2230, 3425, 0), // Varlamore (custom / fallback)
});

function getLeagueAreaTeleportCoord(services: any, regionId: number): number | null {
    const normalized = normalizeLeagueAreaSelectionValue(regionId);
    if (!(normalized > 0)) return null;
    const cached = leagueAreaTeleportCoordCache.get(normalized);
    if (cached !== undefined) return cached;

    const db = services?.getDbRepository?.();
    if (db?.findRows) {
        try {
            const rows = db.findRows((row: any) => {
                const col = row?.getColumn?.(DB_COL_REGION_DATA_REGION_ID);
                const value = Array.isArray(col?.values) ? col.values[0] : undefined;
                return value === normalized;
            });
            const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
            const col = row?.getColumn?.(DB_COL_REGION_DATA_AREA_TELEPORT_COORD);
            const coord = (Array.isArray(col?.values) ? col.values[0] : undefined) as
                | number
                | undefined;
            if (coord !== undefined && coord >= 0) {
                leagueAreaTeleportCoordCache.set(normalized, coord);
                return coord;
            }
        } catch {
            // fall back to static mapping below
        }
    }

    const fallback = LEAGUE_AREA_FALLBACK_TELEPORT_COORD[normalized];
    if (fallback !== undefined && fallback >= 0) {
        leagueAreaTeleportCoordCache.set(normalized, fallback);
        return fallback;
    }

    return null;
}

function isLeagueAreaUnlocked(
    player: { getVarbitValue?: (id: number) => number },
    regionId: number,
): boolean {
    const normalized = normalizeLeagueAreaSelectionValue(regionId);
    if (!(normalized > 0)) return false;
    for (const varbit of AREA_SELECTION_VARBITS) {
        const stored = normalizeLeagueAreaSelectionValue(player.getVarbitValue?.(varbit) ?? 0);
        if (stored === normalized) return true;
    }
    return false;
}

function getLeagueTutorialCompleteStep(player: {
    getVarbitValue?: (id: number) => number;
}): number {
    // Matches [proc,script2449] (2449): league_type 3 -> 14, else 12.
    const leagueType = player.getVarbitValue?.(VARBIT_LEAGUE_TYPE) ?? 0;
    return leagueType === 3 ? 14 : 12;
}

export function queueActivateQuestSideTab(
    playerId: number,
    bridge: Pick<LeagueWsUiBridge, "queueWidgetEvent">,
): void {
    // CS2 parity: [clientscript,toplevel_sidebutton_switch] (915) updates varcint171
    // and unhides the active side panel if it has a mounted sub-interface.
    bridge.queueWidgetEvent(playerId, {
        action: "run_script",
        scriptId: 915,
        args: [2], // Quest/Side-journal tab index
    });
}

export function normalizeSideJournalLeagueState(
    player: LeagueWsUiPlayer,
    incomingStateVarp?: number,
): { tab: number; stateVarp: number } {
    // Keep packed varp 1141 and varbit 8168 aligned, but preserve the selected tab.
    const prevStateVarp = player.getVarpValue(VARP_SIDE_JOURNAL_STATE);
    const baseStateVarp = incomingStateVarp ?? prevStateVarp;
    const decodedTab = decodeSideJournalTabFromStateVarp(baseStateVarp);
    const tab = decodedTab >= 0 && decodedTab <= 4 ? decodedTab : 0;
    const stateVarp = encodeSideJournalTabInStateVarp(baseStateVarp, tab);
    player.setVarpValue(VARP_SIDE_JOURNAL_STATE, stateVarp);
    player.setVarbitValue(VARBIT_SIDE_JOURNAL_TAB, tab);
    return { tab, stateVarp };
}

export function getLeagueSideJournalBootstrapState(player: LeagueWsUiPlayer): {
    varps: Record<number, number>;
    varbits: Record<number, number>;
} {
    const { tab, stateVarp } = normalizeSideJournalLeagueState(player);
    return {
        varps: {
            ...getLeagueVarpsForPlayer(player),
            [VARP_SIDE_JOURNAL_STATE]: stateVarp,
        },
        varbits: {
            ...getLeagueVarbits(player),
            [VARBIT_SIDE_JOURNAL_TAB]: tab,
        },
    };
}

export function queueSideJournalLeagueOnlyUi(
    player: LeagueWsUiPlayer,
    bridge: Pick<LeagueWsUiBridge, "queueWidgetEvent" | "isWidgetGroupOpenInLedger">,
): void {
    const playerId = player.id;
    const { tab } = normalizeSideJournalLeagueState(player);
    const leagueType = player.getVarbitValue(VARBIT_LEAGUE_TYPE);
    const contentGroup =
        tab === 4
            ? getSideJournalLeaguesContentGroupId(leagueType)
            : SIDE_JOURNAL_CONTENT_GROUP_BY_TAB[tab] ?? SIDE_JOURNAL_CONTENT_GROUP_BY_TAB[0] ?? 0;
    const sideJournalOpen = bridge.isWidgetGroupOpenInLedger(playerId, SIDE_JOURNAL_GROUP_ID);

    if (contentGroup > 0) {
        bridge.queueWidgetEvent(playerId, {
            action: "open_sub",
            targetUid: SIDE_JOURNAL_TAB_CONTAINER_UID,
            groupId: contentGroup,
            type: 1,
        });

        // Ensure "Collection Log" (op1) and "Collection Overview" (op2) from
        // Account Summary transmit to the server.
        if (contentGroup === ACCOUNT_SUMMARY_GROUP_ID) {
            bridge.queueWidgetEvent(playerId, {
                action: "set_flags_range",
                uid: ACCOUNT_SUMMARY_ENTRY_LIST_UID,
                fromSlot: ACCOUNT_SUMMARY_COLLECTION_LOG_CHILD_INDEX,
                toSlot: ACCOUNT_SUMMARY_COLLECTION_LOG_CHILD_INDEX,
                flags: ACCOUNT_SUMMARY_COLLECTION_ACTION_FLAGS,
            });
            bridge.queueWidgetEvent(playerId, {
                action: "set_flags_range",
                uid: ACCOUNT_SUMMARY_ENTRY_LIST_UID,
                fromSlot: ACCOUNT_SUMMARY_PLAYTIME_CHILD_INDEX,
                toSlot: ACCOUNT_SUMMARY_PLAYTIME_CHILD_INDEX,
                flags: ACCOUNT_SUMMARY_PLAYTIME_ACTION_FLAGS,
            });
        }
    }
    if (sideJournalOpen) {
        queueActivateQuestSideTab(playerId, bridge);
    }
}

export function applyLeagueTutorialStepFiveUi(
    player: LeagueWsUiPlayer,
    bridge: Pick<LeagueWsUiBridge, "queueWidgetEvent" | "isWidgetGroupOpenInLedger">,
): void {
    const playerId = player.id;
    const tutorial = player.getVarbitValue(VARBIT_LEAGUE_TUTORIAL_COMPLETED);
    if (tutorial !== 5) return;

    const leagueType = player.getVarbitValue(VARBIT_LEAGUE_TYPE);
    const completeStep = leagueType === 3 ? 14 : 12;
    if (tutorial >= completeStep) return;

    const sideJournalOpen = bridge.isWidgetGroupOpenInLedger(playerId, SIDE_JOURNAL_GROUP_ID);
    const panelGroup = getSideJournalLeaguesContentGroupId(leagueType);
    const tasksChild = leagueType === 3 ? 25 : 36;
    const tasksUid = ((panelGroup & 0xffff) << 16) | (tasksChild & 0xffff);

    if (!sideJournalOpen) {
        bridge.queueWidgetEvent(playerId, {
            action: "run_script",
            scriptId: SCRIPT_UI_HIGHLIGHT_CLEAR,
            args: [UI_HIGHLIGHT_KIND_LEAGUE_TUTORIAL, UI_HIGHLIGHT_ID_TASKS_BUTTON],
        });
        return;
    }

    bridge.queueWidgetEvent(playerId, {
        action: "run_script",
        scriptId: SCRIPT_UI_HIGHLIGHT,
        args: [
            UI_HIGHLIGHT_KIND_LEAGUE_TUTORIAL,
            UI_HIGHLIGHT_ID_TASKS_BUTTON,
            tasksUid,
            -1,
            UI_HIGHLIGHT_STYLE_DEFAULT,
            0,
        ],
    });
}

export function applyLeagueTutorialStepNineUi(
    player: LeagueWsUiPlayer,
    bridge: Pick<LeagueWsUiBridge, "queueWidgetEvent" | "isWidgetGroupOpenInLedger">,
): void {
    const playerId = player.id;
    const tutorial = player.getVarbitValue(VARBIT_LEAGUE_TUTORIAL_COMPLETED);
    const leagueType = player.getVarbitValue(VARBIT_LEAGUE_TYPE);
    const completeStep = leagueType === 3 ? 14 : 12;
    if (leagueType === 3 || tutorial !== 9 || tutorial >= completeStep) return;

    const sideJournalOpen = bridge.isWidgetGroupOpenInLedger(playerId, SIDE_JOURNAL_GROUP_ID);

    // Always clear stale Areas-close highlight once step 9 is active.
    bridge.queueWidgetEvent(playerId, {
        action: "run_script",
        scriptId: SCRIPT_UI_HIGHLIGHT_CLEAR,
        args: [UI_HIGHLIGHT_KIND_LEAGUE_TUTORIAL, UI_HIGHLIGHT_ID_AREAS_CLOSE_BUTTON],
    });

    if (!sideJournalOpen) {
        bridge.queueWidgetEvent(playerId, {
            action: "run_script",
            scriptId: SCRIPT_UI_HIGHLIGHT_CLEAR,
            args: [UI_HIGHLIGHT_KIND_LEAGUE_TUTORIAL, UI_HIGHLIGHT_ID_RELICS_BUTTON],
        });
        return;
    }

    // During step 9 there should not be a blocking mainmodal in front of the side journal.
    bridge.queueWidgetEvent(playerId, {
        action: "close_sub",
        targetUid: getMainmodalUid(player.displayMode as any),
    });

    const sidePanelGroup = getSideJournalLeaguesContentGroupId(leagueType);
    const relicUid = ((sidePanelGroup & 0xffff) << 16) | (44 & 0xffff);
    bridge.queueWidgetEvent(playerId, {
        action: "run_script",
        scriptId: SCRIPT_UI_HIGHLIGHT,
        args: [
            UI_HIGHLIGHT_KIND_LEAGUE_TUTORIAL,
            UI_HIGHLIGHT_ID_RELICS_BUTTON,
            relicUid,
            -1,
            UI_HIGHLIGHT_STYLE_DEFAULT,
            0,
        ],
    });
}

export function queueLeagueTutorialOverlayUi(
    player: LeagueWsUiPlayer,
    bridge: LeagueWsUiBridge,
    tutorialStep: number,
    opts?: { queueFlashsideVarbitOnStep3?: boolean },
): void {
    const playerId = player.id;
    const leagueType = player.getVarbitValue(VARBIT_LEAGUE_TYPE);
    const sideJournalState = normalizeSideJournalLeagueState(player);
    let flashside = player.getVarbitValue(VARBIT_FLASHSIDE);

    if (tutorialStep === 3 && flashside === 0) {
        bridge.queueVarp(playerId, VARP_SIDE_JOURNAL_STATE, sideJournalState.stateVarp);
        bridge.queueVarbit(playerId, VARBIT_SIDE_JOURNAL_TAB, sideJournalState.tab);
        flashside = 3;
        player.setVarbitValue(VARBIT_FLASHSIDE, flashside);
        if (opts?.queueFlashsideVarbitOnStep3) {
            bridge.queueVarbit(playerId, VARBIT_FLASHSIDE, flashside);
        }
    }

    bridge.queueWidgetEvent(playerId, {
        action: "open_sub",
        targetUid: getViewportTrackerFrontUid(player.displayMode as any),
        groupId: LEAGUE_TUTORIAL_MAIN_GROUP_ID,
        type: 1,
        varps: {
            [VARP_MAP_FLAGS_CACHED]: MAP_FLAGS_LEAGUE_WORLD,
            [VARP_LEAGUE_GENERAL]: player.getVarpValue(VARP_LEAGUE_GENERAL),
        },
        varbits: {
            [VARBIT_LEAGUE_TYPE]: leagueType,
            [VARBIT_LEAGUE_TUTORIAL_COMPLETED]: tutorialStep,
            [VARBIT_SIDE_JOURNAL_TAB]: sideJournalState.tab,
            [VARBIT_FLASHSIDE]: flashside,
        },
    });

    applyLeagueTutorialStepFiveUi(player, bridge);
    applyLeagueTutorialStepNineUi(player, bridge);
}

export function handleLeagueAreasTutorialCloseViaWidgetClose(
    player: LeagueWsUiPlayer,
    bridge: LeagueWsUiBridge,
): void {
    const tutorial = player.getVarbitValue(VARBIT_LEAGUE_TUTORIAL_COMPLETED);
    const leagueType = player.getVarbitValue(VARBIT_LEAGUE_TYPE);
    const tutorialCompleteStep = leagueType === 3 ? 14 : 12;
    if (
        leagueType === 3 ||
        (tutorial !== 7 && tutorial !== 9) ||
        tutorial >= tutorialCompleteStep
    ) {
        return;
    }

    const karamjaUnlocked = AREA_SELECTION_VARBITS.some(
        (varbitId) => player.getVarbitValue(varbitId) === 2,
    );
    const shouldPromoteToRelicStage = tutorial === 7 && karamjaUnlocked;
    const overlayTutorial = shouldPromoteToRelicStage ? 9 : tutorial;

    if (shouldPromoteToRelicStage) {
        player.setVarbitValue(VARBIT_LEAGUE_TUTORIAL_COMPLETED, overlayTutorial);
        const { value: leagueGeneral } = syncLeagueGeneralVarp(player);
        bridge.queueVarp(player.id, VARP_LEAGUE_GENERAL, leagueGeneral);
        bridge.queueVarbit(player.id, VARBIT_LEAGUE_TUTORIAL_COMPLETED, overlayTutorial);
    }

    const playerId = player.id;
    bridge.queueWidgetEvent(playerId, {
        action: "open_sub",
        targetUid: getViewportTrackerFrontUid(player.displayMode as any),
        groupId: LEAGUE_TUTORIAL_MAIN_GROUP_ID,
        type: 1,
        varps: {
            [VARP_MAP_FLAGS_CACHED]: MAP_FLAGS_LEAGUE_WORLD,
            [VARP_LEAGUE_GENERAL]: player.getVarpValue(VARP_LEAGUE_GENERAL),
        },
        varbits: {
            [VARBIT_LEAGUE_TYPE]: leagueType,
            [VARBIT_LEAGUE_TUTORIAL_COMPLETED]: overlayTutorial,
            [VARBIT_FLASHSIDE]: player.getVarbitValue(VARBIT_FLASHSIDE),
        },
    });

    applyLeagueTutorialStepFiveUi(player, bridge);
    applyLeagueTutorialStepNineUi(player, bridge);

    const sidePanelGroup = getSideJournalLeaguesContentGroupId(leagueType);
    const areasButtonUid = ((sidePanelGroup & 0xffff) << 16) | (L5_COMP_VIEW_AREAS & 0xffff);
    const relicsButtonUid = ((sidePanelGroup & 0xffff) << 16) | (L5_COMP_VIEW_RELICS & 0xffff);

    bridge.queueWidgetEvent(playerId, {
        action: "run_script",
        scriptId: SCRIPT_UI_HIGHLIGHT_CLEAR,
        args: [UI_HIGHLIGHT_KIND_LEAGUE_TUTORIAL, UI_HIGHLIGHT_ID_KARAMJA_SHIELD],
    });
    bridge.queueWidgetEvent(playerId, {
        action: "run_script",
        scriptId: SCRIPT_UI_HIGHLIGHT_CLEAR,
        args: [UI_HIGHLIGHT_KIND_LEAGUE_TUTORIAL, UI_HIGHLIGHT_ID_UNLOCK_BUTTON],
    });

    if (karamjaUnlocked) {
        bridge.queueWidgetEvent(playerId, {
            action: "run_script",
            scriptId: SCRIPT_UI_HIGHLIGHT_CLEAR,
            args: [UI_HIGHLIGHT_KIND_LEAGUE_TUTORIAL, UI_HIGHLIGHT_ID_AREAS_CLOSE_BUTTON],
        });
        bridge.queueWidgetEvent(playerId, {
            action: "run_script",
            scriptId: SCRIPT_UI_HIGHLIGHT,
            args: [
                UI_HIGHLIGHT_KIND_LEAGUE_TUTORIAL,
                UI_HIGHLIGHT_ID_RELICS_BUTTON,
                relicsButtonUid,
                -1,
                UI_HIGHLIGHT_STYLE_DEFAULT,
                0,
            ],
        });
        return;
    }

    bridge.queueWidgetEvent(playerId, {
        action: "run_script",
        scriptId: SCRIPT_UI_HIGHLIGHT,
        args: [
            UI_HIGHLIGHT_KIND_LEAGUE_TUTORIAL,
            UI_HIGHLIGHT_ID_AREAS_BUTTON,
            areasButtonUid,
            -1,
            UI_HIGHLIGHT_STYLE_DEFAULT,
            0,
        ],
    });
}

function getLeagueAreaButtonState(
    player: { getVarbitValue?: (id: number) => number },
    services: any,
    regionIdRaw: number,
): number {
    // Mirrors [proc,league_areas_show_detailed] (3669) select button logic:
    // - 2 = Unlock (green, shows confirm overlay)
    // - 1 = Teleport (green)
    // - 0/3/4 = Locked (grey) with league_area_not_available(reason)
    //   0 = need more tasks, 3 = must unlock Karamja second, 4 = no more areas
    const regionId = normalizeLeagueAreaSelectionValue(regionIdRaw);
    if (!(regionId > 0)) return 0;

    // 1 = Teleport (already unlocked)
    if (isLeagueAreaUnlocked(player, regionId)) return 1;

    // During the tutorial, Karamja is free - allow unlock regardless of task requirements.
    // OSRS parity: Karamja is the first area players actively choose during the tutorial.
    const tutorialStep = player.getVarbitValue?.(VARBIT_LEAGUE_TUTORIAL_COMPLETED) ?? 0;
    const tutorialComplete = getLeagueTutorialCompleteStep(player);
    const inTutorial = tutorialStep < tutorialComplete;
    if (inTutorial && regionId === 2) {
        return 2; // Allow Karamja unlock during tutorial
    }

    const stage = getCurrentLeagueAreaUnlockStage(player, services);
    if (!stage) return 4;

    // OSRS parity: Karamja is forced as the 2nd area selection (stageIndex=1).
    // This is represented in CS2 by "league_area_not_available(3)".
    if (stage.stageIndex === 1 && regionId !== 2) return 3;

    if (!stage.canUnlock) return 0;

    // 2 = Unlock
    return 2;
}

function tryUnlockLeagueArea(
    player: any,
    services: any,
    regionIdRaw: number,
): { ok: boolean; reason?: string } {
    const regionId = normalizeLeagueAreaSelectionValue(regionIdRaw);
    if (!(regionId > 0)) return { ok: false, reason: "invalid_region" };

    // Already unlocked?
    if (isLeagueAreaUnlocked(player, regionId)) return { ok: false, reason: "already_unlocked" };

    // During the tutorial, Karamja is free - allow unlock regardless of task requirements.
    const tutorialStep = player.getVarbitValue?.(VARBIT_LEAGUE_TUTORIAL_COMPLETED) ?? 0;
    const tutorialComplete = getLeagueTutorialCompleteStep(player);
    const inTutorial = tutorialStep < tutorialComplete;
    const isTutorialKaramja = inTutorial && regionId === 2;

    const stage = getCurrentLeagueAreaUnlockStage(player, services);

    // For tutorial Karamja, use slot 1 if stage lookup fails (cache not loaded)
    if (!stage) {
        if (isTutorialKaramja) {
            // Karamja goes into slot 1 (the second area slot after Misthalin)
            const slotVarbitId = AREA_SELECTION_VARBITS[1];
            player.setVarbitValue(slotVarbitId, regionId);
            services.queueVarbit?.(player.id, slotVarbitId, regionId);
            return { ok: true };
        }
        return { ok: false, reason: "no_slots" };
    }

    // OSRS parity: Karamja is forced as the 2nd area selection (stageIndex=1) outside of tutorial.
    if (!isTutorialKaramja && stage.stageIndex === 1 && regionId !== 2)
        return { ok: false, reason: "karamja_second" };

    // Check task requirements (unless it's Karamja during tutorial)
    if (!stage.canUnlock && !isTutorialKaramja) {
        return { ok: false, reason: "not_enough_tasks" };
    }

    player.setVarbitValue(stage.slotVarbitId, regionId);
    services.queueVarbit?.(player.id, stage.slotVarbitId, regionId);
    return { ok: true };
}

/**
 * Get the standard league varbits for interface initialization.
 */
export function getLeagueVarbits(player: {
    getVarbitValue?: (id: number) => number;
}): Record<number, number> {
    const varbits: Record<number, number> = {
        // These must be present for many league interfaces to initialize (enum_2670 lookup).
        [VARBIT_LEAGUE_TYPE]: player.getVarbitValue?.(VARBIT_LEAGUE_TYPE) ?? 0,
        [VARBIT_LEAGUE_TUTORIAL_COMPLETED]:
            player.getVarbitValue?.(VARBIT_LEAGUE_TUTORIAL_COMPLETED) ?? 0,

        // League Areas UI depends on these.
        [VARBIT_LEAGUE_AREA_LAST_VIEWED]:
            player.getVarbitValue?.(VARBIT_LEAGUE_AREA_LAST_VIEWED) ?? 0,
        [VARBIT_LEAGUE_AREA_SELECTION_0]:
            player.getVarbitValue?.(VARBIT_LEAGUE_AREA_SELECTION_0) ?? 0,
        [VARBIT_LEAGUE_AREA_SELECTION_1]:
            player.getVarbitValue?.(VARBIT_LEAGUE_AREA_SELECTION_1) ?? 0,
        [VARBIT_LEAGUE_AREA_SELECTION_2]:
            player.getVarbitValue?.(VARBIT_LEAGUE_AREA_SELECTION_2) ?? 0,
        [VARBIT_LEAGUE_AREA_SELECTION_3]:
            player.getVarbitValue?.(VARBIT_LEAGUE_AREA_SELECTION_3) ?? 0,
        [VARBIT_LEAGUE_AREA_SELECTION_4]:
            player.getVarbitValue?.(VARBIT_LEAGUE_AREA_SELECTION_4) ?? 0,
        [VARBIT_LEAGUE_AREA_SELECTION_5]:
            player.getVarbitValue?.(VARBIT_LEAGUE_AREA_SELECTION_5) ?? 0,
        [VARBIT_LEAGUE_TOTAL_TASKS_COMPLETED]:
            player.getVarbitValue?.(VARBIT_LEAGUE_TOTAL_TASKS_COMPLETED) ?? 0,

        // League Relics UI depends on these selections.
        [VARBIT_LEAGUE_RELIC_1]: player.getVarbitValue?.(VARBIT_LEAGUE_RELIC_1) ?? 0,
        [VARBIT_LEAGUE_RELIC_2]: player.getVarbitValue?.(VARBIT_LEAGUE_RELIC_2) ?? 0,
        [VARBIT_LEAGUE_RELIC_3]: player.getVarbitValue?.(VARBIT_LEAGUE_RELIC_3) ?? 0,
        [VARBIT_LEAGUE_RELIC_4]: player.getVarbitValue?.(VARBIT_LEAGUE_RELIC_4) ?? 0,
        [VARBIT_LEAGUE_RELIC_5]: player.getVarbitValue?.(VARBIT_LEAGUE_RELIC_5) ?? 0,
        [VARBIT_LEAGUE_RELIC_6]: player.getVarbitValue?.(VARBIT_LEAGUE_RELIC_6) ?? 0,
        [VARBIT_LEAGUE_RELIC_7]: player.getVarbitValue?.(VARBIT_LEAGUE_RELIC_7) ?? 0,
        [VARBIT_LEAGUE_RELIC_8]: player.getVarbitValue?.(VARBIT_LEAGUE_RELIC_8) ?? 0,

        // Combat mastery UIs and the buff bar both read these directly.
        [VARBIT_LEAGUE_MELEE_MASTERY]: player.getVarbitValue?.(VARBIT_LEAGUE_MELEE_MASTERY) ?? 0,
        [VARBIT_LEAGUE_RANGED_MASTERY]: player.getVarbitValue?.(VARBIT_LEAGUE_RANGED_MASTERY) ?? 0,
        [VARBIT_LEAGUE_MAGIC_MASTERY]: player.getVarbitValue?.(VARBIT_LEAGUE_MAGIC_MASTERY) ?? 0,
        [VARBIT_LEAGUE_MASTERY_POINTS_TO_SPEND]:
            player.getVarbitValue?.(VARBIT_LEAGUE_MASTERY_POINTS_TO_SPEND) ?? 0,
        [VARBIT_LEAGUE_MASTERY_POINTS_EARNED]:
            player.getVarbitValue?.(VARBIT_LEAGUE_MASTERY_POINTS_EARNED) ?? 0,
    };

    for (const varbitId of LEAGUE_MASTERY_POINT_UNLOCK_VARBITS) {
        varbits[varbitId] = player.getVarbitValue?.(varbitId) ?? 0;
    }

    return varbits;
}

function getLeagueVarpsForPlayer(player: any): Record<number, number> {
    return {
        [VARP_MAP_FLAGS_CACHED]: MAP_FLAGS_LEAGUE_WORLD,
        [VARP_LEAGUE_GENERAL]: player?.getVarpValue?.(VARP_LEAGUE_GENERAL) ?? 0,
        [VARP_LEAGUE_POINTS_CLAIMED]: player?.getVarpValue?.(VARP_LEAGUE_POINTS_CLAIMED) ?? 0,
        [VARP_LEAGUE_POINTS_COMPLETED]: player?.getVarpValue?.(VARP_LEAGUE_POINTS_COMPLETED) ?? 0,
        [VARP_LEAGUE_POINTS_CURRENCY]: player?.getVarpValue?.(VARP_LEAGUE_POINTS_CURRENCY) ?? 0,
        [VARP_LEAGUE_TASK_COUNT]: player?.getVarpValue?.(VARP_LEAGUE_TASK_COUNT) ?? 0,
        ...getLeaguePackedVarpsForPlayer(player),
    };
}

function refreshLeagueSidePanelProgress(
    player: any,
    services: any,
    opts?: {
        leagueType?: number;
        varps?: Record<number, number>;
        varbits?: Record<number, number>;
    },
): void {
    // Refresh the Leagues side panel (inside the Quest tab) so the "tasks/points until next unlock" messaging
    // updates immediately after unlock actions.
    // OSRS parity: the side panel uses league_*_side_panel_update_bar to update both the bar and text.
    const leagueType = opts?.leagueType ?? player.getVarbitValue?.(VARBIT_LEAGUE_TYPE) ?? 0;
    const isL3 = leagueType === 3;
    const panelGroupId = isL3 ? 736 : 656;
    const fillChildId = isL3 ? 10 : 23; // league_3_side_panel:fill / league_side_panel:fill
    const fillUid = ((panelGroupId & 0xffff) << 16) | (fillChildId & 0xffff);
    services.queueWidgetEvent?.(player.id, {
        action: "run_script",
        scriptId: isL3 ? 5800 : 3226, // league_3_side_panel_update_bar / league_side_panel_update_bar
        args: [fillUid, -1],
        varps: opts?.varps ?? getLeagueVarpsForPlayer(player),
        varbits: opts?.varbits ?? getLeagueVarbits(player),
    });
}

function syncLeagueGeneralVarpAndQueue(player: any, services: any): void {
    const res = syncLeagueGeneralVarp(player);
    if (res.changed) {
        services.queueVarp?.(player.id, VARP_LEAGUE_GENERAL, res.value);
    }
}

function getLeagueWidgetUiBridge(player: any, services: any): LeagueWsUiBridge {
    return {
        queueWidgetEvent: (playerId, action) => {
            services.queueWidgetEvent?.(playerId, action);
        },
        isWidgetGroupOpenInLedger: (_playerId, groupId) =>
            (player.widgets?.isOpen?.(groupId) ?? false) === true,
        queueVarp: (playerId, varpId, value) => {
            services.queueVarp?.(playerId, varpId, value);
        },
        queueVarbit: (playerId, varbitId, value) => {
            services.queueVarbit?.(playerId, varbitId, value);
        },
    };
}

function queueWidgetFlagsRange(
    player: any,
    services: any,
    uid: number,
    fromSlot: number,
    toSlot: number,
    flags: number,
): void {
    const interfaceService = services.getInterfaceService?.();
    if (interfaceService?.setWidgetFlags) {
        interfaceService.setWidgetFlags(player, uid, fromSlot, toSlot, flags);
        return;
    }
    services.queueWidgetEvent?.(player.id, {
        action: "set_flags_range",
        uid: uid,
        fromSlot: fromSlot,
        toSlot: toSlot,
        flags: flags,
    });
}

function ensureLeagueBasicsInitialized(player: any, services: any): void {
    // League interfaces depend on these varbits being set; initialize on demand for older saves.
    const leagueType = player.getVarbitValue?.(VARBIT_LEAGUE_TYPE) ?? 0;
    if (leagueType <= 0) {
        player.setVarbitValue(VARBIT_LEAGUE_TYPE, 5);
        syncLeagueGeneralVarpAndQueue(player, services);
        services.queueVarbit?.(player.id, VARBIT_LEAGUE_TYPE, 5);
    }
}

function ensureLeagueAreaSelectionsInitialized(player: any, services: any): void {
    const raw = AREA_SELECTION_VARBITS.map((id) => player.getVarbitValue?.(id) ?? 0);
    const values = raw.map((v) => normalizeLeagueAreaSelectionValue(v));

    // Data hygiene for dev servers: fix corrupted/duplicate values from prior bugs so CS2 gating
    // (script3682) behaves like OSRS (i.e., empty slots are actually 0).
    const validRegionIds = new Set<number>(LEAGUE_AREAS.map((a) => a.regionId));
    const sanitized = values.slice();
    let changed = false;

    // 1) Drop invalid region IDs.
    for (let i = 0; i < sanitized.length; i++) {
        const v = sanitized[i];
        if (v !== 0 && !validRegionIds.has(v)) {
            sanitized[i] = 0;
            changed = true;
        }
    }

    // 2) De-duplicate the 5 progression slots (0..4). Duplicates can show as "2/5" but still
    // block further unlocks because script3682 treats any non-zero slot as filled.
    const seen = new Set<number>();
    for (let i = 0; i < 5 && i < sanitized.length; i++) {
        const v = sanitized[i];
        if (v === 0) continue;
        if (seen.has(v)) {
            sanitized[i] = 0;
            changed = true;
        } else {
            seen.add(v);
        }
    }

    if (changed) {
        for (let i = 0; i < AREA_SELECTION_VARBITS.length; i++) {
            const varbitId = AREA_SELECTION_VARBITS[i];
            const next = sanitized[i];
            if ((player.getVarbitValue?.(varbitId) ?? 0) !== next) {
                player.setVarbitValue(varbitId, next);
                services.queueVarbit?.(player.id, varbitId, next);
            }
        }
        console.log(
            `[league] Sanitized league area selections: ${values.join(",")} -> ${sanitized.join(
                ",",
            )}`,
        );
    }

    const post = changed ? sanitized : values;

    const allZero = post.every((v) => v === 0);
    // OSRS parity: participants start with Misthalin; Karamja is unlocked during the tutorial flow.
    if (allZero) {
        const desired = [1, 0, 0, 0, 0, 0];
        for (let i = 0; i < AREA_SELECTION_VARBITS.length; i++) {
            const varbitId = AREA_SELECTION_VARBITS[i];
            const next = desired[i];
            if ((player.getVarbitValue?.(varbitId) ?? 0) !== next) {
                player.setVarbitValue(varbitId, next);
                services.queueVarbit?.(player.id, varbitId, next);
            }
        }
    }

    // Also ensure the "last viewed" area varbit is valid so scripts always have a real region id.
    const lastViewedRaw = player.getVarbitValue?.(VARBIT_LEAGUE_AREA_LAST_VIEWED) ?? 0;
    if (lastViewedRaw <= 0) {
        player.setVarbitValue(VARBIT_LEAGUE_AREA_LAST_VIEWED, 1);
        services.queueVarbit?.(player.id, VARBIT_LEAGUE_AREA_LAST_VIEWED, 1);
    }
}

export const leagueWidgetModule: ScriptModule = {
    id: "content.league-widgets",
    register(registry, services) {
        console.log("[leagueWidgets] Registering league widget handlers (pure CS2 approach)");

        // ========== League 5 Side Panel (656) ==========

        registry.onButton(LEAGUE_SIDE_PANEL_L5_GROUP_ID, L5_COMP_VIEW_MASTERIES, (event) => {
            const mainmodalUid = getMainmodalUid(event.player.displayMode);
            const player = event.player;
            console.log(`[league] L5 View Masteries clicked`);
            ensureLeagueBasicsInitialized(player, services);
            services.openSubInterface?.(player, mainmodalUid, LEAGUE_COMBAT_MASTERY_GROUP_ID, 0, {
                varps: getLeagueVarpsForPlayer(player),
                varbits: getLeagueVarbits(player),
            });

            // OSRS parity: Enable clickzone transmit so clicking mastery nodes sends to server.
            // The server must call script 7674 to show the mastery detail view.
            queueWidgetFlagsRange(
                player,
                services,
                (LEAGUE_COMBAT_MASTERY_GROUP_ID << 16) | L5_MASTERY_CLICKZONES_CHILD,
                0,
                255, // max mastery entries
                IF_SETEVENTS_TRANSMIT_OP1,
            );
            // Enable confirm/cancel button transmit for mastery selection
            queueWidgetFlagsRange(
                player,
                services,
                (LEAGUE_COMBAT_MASTERY_GROUP_ID << 16) | L5_MASTERY_CONFIRM_BUTTON_CHILD,
                -1,
                -1,
                IF_SETEVENTS_TRANSMIT_OP1,
            );
            queueWidgetFlagsRange(
                player,
                services,
                (LEAGUE_COMBAT_MASTERY_GROUP_ID << 16) | L5_MASTERY_CANCEL_BUTTON_CHILD,
                -1,
                -1,
                IF_SETEVENTS_TRANSMIT_OP1,
            );
            // Enable select button transmit for showing confirm overlay
            queueWidgetFlagsRange(
                player,
                services,
                (LEAGUE_COMBAT_MASTERY_GROUP_ID << 16) | L5_MASTERY_SELECT_BUTTON_CHILD,
                -1,
                -1,
                IF_SETEVENTS_TRANSMIT_OP1,
            );
        });

        registry.onButton(LEAGUE_SIDE_PANEL_L5_GROUP_ID, L5_COMP_VIEW_INFO, (event) => {
            const mainmodalUid = getMainmodalUid(event.player.displayMode);
            console.log(`[league] L5 View Info clicked`);
            ensureLeagueBasicsInitialized(event.player, services);
            services.openSubInterface?.(event.player, mainmodalUid, LEAGUE_INFO_GROUP_ID, 0, {
                varps: getLeagueVarpsForPlayer(event.player),
                varbits: getLeagueVarbits(event.player),
            });
        });

        registry.onButton(LEAGUE_SIDE_PANEL_L5_GROUP_ID, L5_COMP_VIEW_TASKS, (event) => {
            const mainmodalUid = getMainmodalUid(event.player.displayMode);
            const player = event.player;
            console.log(`[league] L5 View Tasks clicked`);
            ensureLeagueBasicsInitialized(player, services);
            const tutorial = player.getVarbitValue?.(VARBIT_LEAGUE_TUTORIAL_COMPLETED) ?? 0;

            // Close the tutorial modal while Tasks is open during tutorial step 5
            // It will reopen when Tasks closes (via onInterfaceClose hook)
            if (tutorial === 5) {
                services.closeSubInterface?.(
                    player,
                    getViewportTrackerFrontUid(player.displayMode),
                    LEAGUE_TUTORIAL_MAIN_GROUP_ID,
                );
            }

            // Open the tasks interface
            services.openSubInterface?.(player, mainmodalUid, LEAGUE_TASKS_GROUP_ID, 0, {
                varps: getLeagueVarpsForPlayer(player),
                varbits: getLeagueVarbits(player),
            });

            // Clear Tasks button highlight and add close button highlight (progression happens on close)
            if (tutorial === 5) {
                services.queueWidgetEvent?.(player.id, {
                    action: "run_script",
                    scriptId: SCRIPT_UI_HIGHLIGHT_CLEAR,
                    args: [UI_HIGHLIGHT_KIND_LEAGUE_TUTORIAL, UI_HIGHLIGHT_ID_TASKS_BUTTON],
                });
                const tasksCloseButtonUid =
                    ((LEAGUE_TASKS_GROUP_ID & 0xffff) << 16) | (COMP_TASKS_CLOSE_BUTTON & 0xffff);
                services.queueWidgetEvent?.(player.id, {
                    action: "run_script",
                    scriptId: SCRIPT_UI_HIGHLIGHT,
                    args: [
                        UI_HIGHLIGHT_KIND_LEAGUE_TUTORIAL,
                        UI_HIGHLIGHT_ID_TASKS_CLOSE_BUTTON,
                        tasksCloseButtonUid,
                        -1,
                        UI_HIGHLIGHT_STYLE_DEFAULT,
                        0,
                    ],
                });
            }
        });

        // Register onClose hook for tasks interface - tutorial progression happens when modal closes
        const interfaceService = services.getInterfaceService?.();
        if (interfaceService) {
            interfaceService.onInterfaceClose(LEAGUE_TASKS_GROUP_ID, (player) => {
                const tutorial = player.getVarbitValue?.(VARBIT_LEAGUE_TUTORIAL_COMPLETED) ?? 0;
                const leagueType = player.getVarbitValue?.(VARBIT_LEAGUE_TYPE) ?? 0;

                if (tutorial === 5) {
                    // Clear the tasks close button highlight
                    services.queueWidgetEvent?.(player.id, {
                        action: "run_script",
                        scriptId: SCRIPT_UI_HIGHLIGHT_CLEAR,
                        args: [
                            UI_HIGHLIGHT_KIND_LEAGUE_TUTORIAL,
                            UI_HIGHLIGHT_ID_TASKS_CLOSE_BUTTON,
                        ],
                    });

                    if (leagueType === 3) {
                        // L3 tutorial: Tasks (5) -> Unlocks (8)
                        player.setVarbitValue(VARBIT_LEAGUE_TUTORIAL_COMPLETED, 8);
                        syncLeagueGeneralVarpAndQueue(player, services);
                        services.queueVarbit?.(player.id, VARBIT_LEAGUE_TUTORIAL_COMPLETED, 8);

                        const unlocksUid =
                            ((LEAGUE_SIDE_PANEL_L3_GROUP_ID & 0xffff) << 16) |
                            (L3_COMP_VIEW_UNLOCKS & 0xffff);
                        services.queueWidgetEvent?.(player.id, {
                            action: "run_script",
                            scriptId: SCRIPT_UI_HIGHLIGHT,
                            args: [
                                UI_HIGHLIGHT_KIND_LEAGUE_TUTORIAL,
                                UI_HIGHLIGHT_ID_UNLOCK_BUTTON,
                                unlocksUid,
                                -1,
                                UI_HIGHLIGHT_STYLE_DEFAULT,
                                0,
                            ],
                        });

                        // Reopen the tutorial modal with new step content
                        services.openSubInterface?.(
                            player,
                            getViewportTrackerFrontUid(player.displayMode),
                            LEAGUE_TUTORIAL_MAIN_GROUP_ID,
                            1,
                            {
                                varps: getLeagueVarpsForPlayer(player),
                                varbits: getLeagueVarbits(player),
                            },
                        );
                    } else {
                        // L5 tutorial: Tasks (5) -> Areas (7)
                        player.setVarbitValue(VARBIT_LEAGUE_TUTORIAL_COMPLETED, 7);
                        syncLeagueGeneralVarpAndQueue(player, services);
                        services.queueVarbit?.(player.id, VARBIT_LEAGUE_TUTORIAL_COMPLETED, 7);

                        // Highlight Areas button after tasks window closes
                        services.queueWidgetEvent?.(player.id, {
                            action: "run_script",
                            scriptId: SCRIPT_UI_HIGHLIGHT,
                            args: [
                                UI_HIGHLIGHT_KIND_LEAGUE_TUTORIAL,
                                UI_HIGHLIGHT_ID_AREAS_BUTTON,
                                uidForLeagueSidePanelL5(L5_COMP_VIEW_AREAS),
                                -1,
                                UI_HIGHLIGHT_STYLE_DEFAULT,
                                0,
                            ],
                        });

                        // Reopen the tutorial modal with new step content
                        services.openSubInterface?.(
                            player,
                            getViewportTrackerFrontUid(player.displayMode),
                            LEAGUE_TUTORIAL_MAIN_GROUP_ID,
                            1,
                            {
                                varps: getLeagueVarpsForPlayer(player),
                                varbits: getLeagueVarbits(player),
                            },
                        );
                    }
                }
            });

            interfaceService.onInterfaceClose(LEAGUE_AREAS_GROUP_ID, (player) => {
                handleLeagueAreasTutorialCloseViaWidgetClose(
                    player as unknown as LeagueWsUiPlayer,
                    getLeagueWidgetUiBridge(player, services),
                );
            });

            // Register onClose hook for relics interface - tutorial progression happens when modal closes
            interfaceService.onInterfaceClose(LEAGUE_RELICS_GROUP_ID, (player) => {
                const tutorial = player.getVarbitValue?.(VARBIT_LEAGUE_TUTORIAL_COMPLETED) ?? 0;

                // Tutorial step 9 -> 11 when closing relics
                if (tutorial === 9) {
                    player.setVarbitValue(VARBIT_LEAGUE_TUTORIAL_COMPLETED, 11);
                    syncLeagueGeneralVarpAndQueue(player, services);
                    services.queueVarbit?.(player.id, VARBIT_LEAGUE_TUTORIAL_COMPLETED, 11);

                    // Clear the relics close button highlight and all tier 0 relic highlights
                    services.queueWidgetEvent?.(player.id, {
                        action: "run_script",
                        scriptId: SCRIPT_UI_HIGHLIGHT_CLEAR,
                        args: [
                            UI_HIGHLIGHT_KIND_LEAGUE_TUTORIAL,
                            UI_HIGHLIGHT_ID_RELICS_CLOSE_BUTTON,
                        ],
                    });
                    for (let i = 0; i < 10; i++) {
                        services.queueWidgetEvent?.(player.id, {
                            action: "run_script",
                            scriptId: SCRIPT_UI_HIGHLIGHT_CLEAR,
                            args: [
                                UI_HIGHLIGHT_KIND_LEAGUE_TUTORIAL,
                                UI_HIGHLIGHT_ID_TIER0_RELIC_BASE + i,
                            ],
                        });
                    }

                    // Reopen the tutorial modal with finishing step content
                    services.openSubInterface?.(
                        player,
                        getViewportTrackerFrontUid(player.displayMode),
                        LEAGUE_TUTORIAL_MAIN_GROUP_ID,
                        1,
                        {
                            varps: getLeagueVarpsForPlayer(player),
                            varbits: getLeagueVarbits(player),
                        },
                    );
                }
            });
        }

        registry.onButton(LEAGUE_SIDE_PANEL_L5_GROUP_ID, L5_COMP_VIEW_RELICS, (event) => {
            const mainmodalUid = getMainmodalUid(event.player.displayMode);
            const player = event.player;
            console.log(`[league] L5 View Relics clicked`);
            ensureLeagueBasicsInitialized(player, services);
            try {
                delete player.__leagueRelicPendingSelection;
            } catch {}
            const tutorial = player.getVarbitValue?.(VARBIT_LEAGUE_TUTORIAL_COMPLETED) ?? 0;
            if (tutorial === 9) {
                // Close the tutorial modal while Relics is open
                // It will reopen when Relics closes (via close button handler or onInterfaceClose hook)
                services.closeSubInterface?.(
                    player,
                    getViewportTrackerFrontUid(player.displayMode),
                    LEAGUE_TUTORIAL_MAIN_GROUP_ID,
                );

                // Clear the relics button highlight when opening
                services.queueWidgetEvent?.(player.id, {
                    action: "run_script",
                    scriptId: SCRIPT_UI_HIGHLIGHT_CLEAR,
                    args: [UI_HIGHLIGHT_KIND_LEAGUE_TUTORIAL, UI_HIGHLIGHT_ID_RELICS_BUTTON],
                });
                // Tutorial progression (9 -> 11) happens when relics window closes,
                // giving the player time to explore relics before finishing the tutorial.
            }

            // Open the relics interface
            services.openSubInterface?.(event.player, mainmodalUid, LEAGUE_RELICS_GROUP_ID, 0, {
                varps: getLeagueVarpsForPlayer(event.player),
                varbits: getLeagueVarbits(event.player),
            });

            // OSRS parity: Dynamic relic entries are CC_CREATE children under 655:22.
            // The server must send IF_SETEVENTS for the (id=655:22, childIndex=0..N) keyspace
            // so op1 ("View") is transmitted to the server. Otherwise the client only runs the
            // local onOp (league_relics_loading) and the expanded view never opens.
            //
            // IMPORTANT: Flags must be sent AFTER openSubInterface because openSubInterface
            // internally calls closeSubInterface which clears all flags for the group.
            {
                const leagueType = event.player.getVarbitValue?.(VARBIT_LEAGUE_TYPE) ?? 0;
                const indexMap =
                    leagueType === 3 ? null : getLeagueRelicIndexMap(services, leagueType);
                const maxIndex = indexMap ? indexMap.length : 256;
                const toSlot = Math.max(0, maxIndex - 1);
                queueWidgetFlagsRange(
                    event.player,
                    services,
                    (LEAGUE_RELICS_GROUP_ID << 16) | L5_RELIC_CLICKZONES_CHILD,
                    0,
                    toSlot,
                    IF_SETEVENTS_TRANSMIT_OP1,
                );
                // Confirm must transmit to the server (selection is server-authoritative).
                // Use set_flags_range with [-1,-1] so it works even if the interface isn't loaded yet.
                // Static widgets have childIndex=-1 in the client (Widget constructor).
                queueWidgetFlagsRange(
                    event.player,
                    services,
                    (LEAGUE_RELICS_GROUP_ID << 16) | L5_RELIC_CONFIRM_BUTTON_CHILD,
                    -1,
                    -1,
                    IF_SETEVENTS_TRANSMIT_OP1,
                );
                // Cancel button should also be clickable
                queueWidgetFlagsRange(
                    event.player,
                    services,
                    (LEAGUE_RELICS_GROUP_ID << 16) | L5_RELIC_CANCEL_BUTTON_CHILD,
                    -1,
                    -1,
                    IF_SETEVENTS_TRANSMIT_OP1,
                );
            }

            // Tutorial: Highlight all tier 0 relics (first column) to guide the player
            if (tutorial === 9) {
                const relicClickzonesUid =
                    ((LEAGUE_RELICS_GROUP_ID & 0xffff) << 16) |
                    (L5_RELIC_CLICKZONES_CHILD & 0xffff);
                const leagueType = player.getVarbitValue?.(VARBIT_LEAGUE_TYPE) ?? 0;
                const indexMap = getLeagueRelicIndexMap(services, leagueType);
                if (indexMap) {
                    // Find all tier 0 relics and highlight each one
                    for (const entry of indexMap) {
                        if (entry.tierIndex === 0) {
                            services.queueWidgetEvent?.(player.id, {
                                action: "run_script",
                                scriptId: SCRIPT_UI_HIGHLIGHT,
                                args: [
                                    UI_HIGHLIGHT_KIND_LEAGUE_TUTORIAL,
                                    UI_HIGHLIGHT_ID_TIER0_RELIC_BASE + entry.globalIndex,
                                    relicClickzonesUid,
                                    entry.globalIndex, // childIndex for this relic
                                    UI_HIGHLIGHT_STYLE_DEFAULT,
                                    0,
                                ],
                            });
                        }
                    }
                }
            }
        });

        registry.onButton(LEAGUE_SIDE_PANEL_L5_GROUP_ID, L5_COMP_VIEW_AREAS, (event) => {
            const mainmodalUid = getMainmodalUid(event.player.displayMode);
            const player = event.player;
            console.log(`[league] L5 View Areas clicked`);

            ensureLeagueBasicsInitialized(player, services);
            // OSRS parity + data hygiene: ensure area selection varbits are valid before opening,
            // otherwise CS2 draws incorrect state (e.g., showing 5/5 unlocked due to bad defaults).
            ensureLeagueAreaSelectionsInitialized(player, services);

            // Calculate tutorial state BEFORE opening interface to determine if highlights are needed.
            const tutorial = player.getVarbitValue?.(VARBIT_LEAGUE_TUTORIAL_COMPLETED) ?? 0;
            const karamjaUnlocked = isLeagueAreaUnlocked(player, 2);
            const needsKaramjaHighlight = tutorial === 7 && !karamjaUnlocked;
            const needsAreasCloseHighlight = tutorial === 7 && karamjaUnlocked;

            // OSRS parity: Close the tutorial modal while the Areas interface is open during the
            // Karamja selection/close-gate steps. The modal will reopen when Areas closes.
            if (needsKaramjaHighlight || needsAreasCloseHighlight) {
                services.closeSubInterface?.(
                    player,
                    getViewportTrackerFrontUid(player.displayMode),
                    LEAGUE_TUTORIAL_MAIN_GROUP_ID,
                );
            }

            // Open interface with varbits - CS2 onload handles the rest.
            services.openSubInterface?.(player, mainmodalUid, LEAGUE_AREAS_GROUP_ID, 0, {
                varps: getLeagueVarpsForPlayer(player),
                varbits: getLeagueVarbits(player),
            });

            // Clear Areas button highlight and add Karamja shield highlight
            if (needsKaramjaHighlight) {
                services.queueWidgetEvent?.(player.id, {
                    action: "run_script",
                    scriptId: SCRIPT_UI_HIGHLIGHT_CLEAR,
                    args: [UI_HIGHLIGHT_KIND_LEAGUE_TUTORIAL, UI_HIGHLIGHT_ID_AREAS_BUTTON],
                });
                services.queueWidgetEvent?.(player.id, {
                    action: "run_script",
                    scriptId: SCRIPT_UI_HIGHLIGHT,
                    args: [
                        UI_HIGHLIGHT_KIND_LEAGUE_TUTORIAL,
                        UI_HIGHLIGHT_ID_KARAMJA_SHIELD,
                        uidForTrailblazerAreas(46), // Karamja shield child
                        -1,
                        UI_HIGHLIGHT_STYLE_DEFAULT,
                        0,
                    ],
                });
            }
            if (needsAreasCloseHighlight) {
                services.queueWidgetEvent?.(player.id, {
                    action: "run_script",
                    scriptId: SCRIPT_UI_HIGHLIGHT_CLEAR,
                    args: [UI_HIGHLIGHT_KIND_LEAGUE_TUTORIAL, UI_HIGHLIGHT_ID_AREAS_BUTTON],
                });
                services.queueWidgetEvent?.(player.id, {
                    action: "run_script",
                    scriptId: SCRIPT_UI_HIGHLIGHT_CLEAR,
                    args: [UI_HIGHLIGHT_KIND_LEAGUE_TUTORIAL, UI_HIGHLIGHT_ID_KARAMJA_SHIELD],
                });
                services.queueWidgetEvent?.(player.id, {
                    action: "run_script",
                    scriptId: SCRIPT_UI_HIGHLIGHT_CLEAR,
                    args: [UI_HIGHLIGHT_KIND_LEAGUE_TUTORIAL, UI_HIGHLIGHT_ID_UNLOCK_BUTTON],
                });
                services.queueWidgetEvent?.(player.id, {
                    action: "run_script",
                    scriptId: SCRIPT_UI_HIGHLIGHT_CLEAR,
                    args: [UI_HIGHLIGHT_KIND_LEAGUE_TUTORIAL, UI_HIGHLIGHT_ID_RELICS_BUTTON],
                });
                services.queueWidgetEvent?.(player.id, {
                    action: "run_script",
                    scriptId: SCRIPT_UI_HIGHLIGHT,
                    args: [
                        UI_HIGHLIGHT_KIND_LEAGUE_TUTORIAL,
                        UI_HIGHLIGHT_ID_AREAS_CLOSE_BUTTON,
                        uidForTrailblazerAreas(COMP_AREAS_CLOSE_BUTTON),
                        -1,
                        UI_HIGHLIGHT_STYLE_DEFAULT,
                        0,
                    ],
                });
            }
        });

        registry.onButton(LEAGUE_SIDE_PANEL_L5_GROUP_ID, L5_COMP_SHOW_SUMMARY, (event) => {
            const mainmodalUid = getMainmodalUid(event.player.displayMode);
            console.log(`[league] L5 Show Summary clicked`);
            ensureLeagueBasicsInitialized(event.player, services);
            services.openSubInterface?.(event.player, mainmodalUid, LEAGUE_SUMMARY_GROUP_ID, 0, {
                varps: getLeagueVarpsForPlayer(event.player),
                varbits: getLeagueVarbits(event.player),
            });
        });

        registry.onButton(LEAGUE_SIDE_PANEL_L5_GROUP_ID, L5_COMP_SHOW_RANKS, (event) => {
            const mainmodalUid = getMainmodalUid(event.player.displayMode);
            console.log(`[league] L5 Show Ranks clicked`);
            ensureLeagueBasicsInitialized(event.player, services);
            services.openSubInterface?.(event.player, mainmodalUid, LEAGUE_RANK_GROUP_ID, 0, {
                varps: getLeagueVarpsForPlayer(event.player),
                varbits: getLeagueVarbits(event.player),
            });
        });

        // ========== League Areas (512) ==========

        // Area click handlers (shield + label):
        // OSRS parity: server persists + syncs %league_area_last_viewed AND triggers the detailed view clientscript.
        for (const area of LEAGUE_AREAS) {
            const onClick = (event: WidgetActionEvent) => {
                const player = event.player;
                console.log(`[league] Area clicked: ${area.name} (regionId=${area.regionId})`);

                // Allow viewing all areas - they'll show the appropriate button state (Locked/Unlock/Teleport).
                const tutorial = player.getVarbitValue?.(VARBIT_LEAGUE_TUTORIAL_COMPLETED) ?? 0;
                // OSRS parity: while %league_tutorial_completed < 9 and Karamja isn't unlocked yet,
                // clicking any non-Karamja area plays the "wrong" sound and does nothing (see proc3662).
                // We must not force-open the detailed view from the server in that case.
                if (
                    area.regionId !== 2 &&
                    tutorial < 9 &&
                    tutorial < getLeagueTutorialCompleteStep(player) &&
                    !isLeagueAreaUnlocked(player, 2)
                ) {
                    return;
                }

                player.setVarbitValue(VARBIT_LEAGUE_AREA_LAST_VIEWED, area.regionId);
                services.queueVarbit?.(player.id, VARBIT_LEAGUE_AREA_LAST_VIEWED, area.regionId);

                const buttonState = getLeagueAreaButtonState(player, services, area.regionId);

                // During tutorial, Karamja is free - override task count in varbits so CS2
                // script's internal check also passes (it may recalculate button state).
                const tutorialComplete = getLeagueTutorialCompleteStep(player);
                const isTutorialKaramja =
                    tutorial < tutorialComplete && area.regionId === 2 && buttonState === 2;
                const varbits: Record<number, number> = {
                    ...getLeagueVarbits(player),
                    [VARBIT_LEAGUE_AREA_LAST_VIEWED]: area.regionId,
                };
                if (isTutorialKaramja) {
                    // Set a high task count so CS2 script thinks player has enough tasks
                    varbits[VARBIT_LEAGUE_TOTAL_TASKS_COMPLETED] = 1000;
                }

                // Trigger the detailed view (the click script only shows the loading overlay).
                // This script also calls script7630 which reads %league_area_last_viewed.
                services.queueWidgetEvent?.(player.id, {
                    action: "run_script",
                    scriptId: SCRIPT_LEAGUE_AREAS_SHOW_DETAILED,
                    // Args are (int0, component1..component10, int11..int13, component14, int15..int16, component17..component21, int22)
                    // See: [clientscript,league_areas_show_detailed] (3668) -> [proc,league_areas_show_detailed] (3669)
                    args: [
                        area.regionId,
                        uidForTrailblazerAreas(COMP_AREAS_MAP_BG_LAYER),
                        uidForTrailblazerAreas(COMP_AREAS_SHIELDS_LAYER),
                        uidForTrailblazerAreas(COMP_AREAS_NAMES_LAYER),
                        uidForTrailblazerAreas(COMP_AREAS_DETAILS),
                        uidForTrailblazerAreas(COMP_AREAS_NAME_SHIELD),
                        uidForTrailblazerAreas(COMP_AREAS_NAME_HEADER),
                        uidForTrailblazerAreas(COMP_AREAS_DESCRIPTION),
                        uidForTrailblazerAreas(COMP_SELECT_BUTTON),
                        uidForTrailblazerAreas(COMP_SELECT_BACK),
                        uidForTrailblazerAreas(COMP_AREAS_ICON),
                        buttonState,
                        0,
                        0,
                        uidForTrailblazerAreas(COMP_AREAS_CONFIRM_LAYER),
                        0,
                        0,
                        uidForTrailblazerAreas(COMP_AREAS_CONFIRM_STEELBORDER),
                        uidForTrailblazerAreas(COMP_AREAS_CONFIRM_MESSAGE),
                        uidForTrailblazerAreas(COMP_AREAS_CONFIRM_BUTTON),
                        uidForTrailblazerAreas(COMP_AREAS_CANCEL_BUTTON),
                        uidForTrailblazerAreas(COMP_AREAS_LOADING),
                        0,
                    ],
                    // Ensure init-critical varbits are present in case the client desynced.
                    varps: getLeagueVarpsForPlayer(player),
                    varbits,
                });

                // OSRS parity: Enable transmit on the Select/Unlock/Teleport button so clicks reach the server.
                queueWidgetFlagsRange(
                    player,
                    services,
                    uidForTrailblazerAreas(COMP_SELECT_BUTTON),
                    -1,
                    -1,
                    IF_SETEVENTS_TRANSMIT_OP1,
                );

                // Tutorial: after selecting Karamja, guide the player to click Unlock.
                if (
                    area.regionId === 2 &&
                    tutorial === 7 &&
                    !isLeagueAreaUnlocked(player, 2) &&
                    buttonState === 2
                ) {
                    // Clear Karamja shield highlight, show unlock button highlight
                    services.queueWidgetEvent?.(player.id, {
                        action: "run_script",
                        scriptId: SCRIPT_UI_HIGHLIGHT_CLEAR,
                        args: [UI_HIGHLIGHT_KIND_LEAGUE_TUTORIAL, UI_HIGHLIGHT_ID_KARAMJA_SHIELD],
                    });
                    services.queueWidgetEvent?.(player.id, {
                        action: "run_script",
                        scriptId: SCRIPT_UI_HIGHLIGHT,
                        args: [
                            UI_HIGHLIGHT_KIND_LEAGUE_TUTORIAL,
                            UI_HIGHLIGHT_ID_UNLOCK_BUTTON,
                            uidForTrailblazerAreas(COMP_SELECT_BUTTON),
                            -1,
                            UI_HIGHLIGHT_STYLE_DEFAULT,
                            0,
                        ],
                    });
                }
            };
            registry.onButton(LEAGUE_AREAS_GROUP_ID, area.shieldChildId, onClick);
            registry.onButton(LEAGUE_AREAS_GROUP_ID, area.nameChildId, onClick);
        }

        // Select/Unlock button - unlock the area if valid
        registry.onButton(LEAGUE_AREAS_GROUP_ID, COMP_SELECT_BUTTON, (event) => {
            const player = event.player;
            const currentRegionRaw = player.getVarbitValue?.(VARBIT_LEAGUE_AREA_LAST_VIEWED) ?? -1;
            const currentRegion = normalizeLeagueAreaSelectionValue(currentRegionRaw);
            const unlocked = isLeagueAreaUnlocked(player, currentRegion);
            console.log(
                `[league] Select clicked: regionId=${currentRegion} unlocked=${unlocked ? 1 : 0}`,
            );

            if (!(currentRegion > 0)) {
                console.log(`[league] Invalid region ID: ${currentRegionRaw}`);
                return;
            }

            if (unlocked) {
                // OSRS parity: Teleport to the area teleport coord from region_data.
                const tutorial = player.getVarbitValue?.(VARBIT_LEAGUE_TUTORIAL_COMPLETED) ?? 0;
                if (tutorial < getLeagueTutorialCompleteStep(player)) {
                    // Client shows a disabled button during the Leagues tutorial; server enforces too.
                    return;
                }
                if (!player.canTeleport?.()) {
                    return;
                }
                const coord = getLeagueAreaTeleportCoord(services, currentRegion);
                if (coord === null) {
                    console.log(`[league] Missing area teleport coord: regionId=${currentRegion}`);
                    return;
                }
                const { x, y, level } = decodeCoord(coord);
                const requestTeleportAction = services.requestTeleportAction;
                if (!requestTeleportAction) {
                    services.logger?.warn?.(
                        "[script:league] requestTeleportAction service unavailable; area teleport skipped",
                    );
                    return;
                }
                const teleportResult = requestTeleportAction(player, {
                    x,
                    y,
                    level,
                    delayTicks: 0,
                    cooldownTicks: 1,
                    requireCanTeleport: true,
                    rejectIfPending: true,
                    replacePending: false,
                });
                if (!teleportResult.ok) {
                    if (teleportResult.reason === "cooldown") {
                        services.sendGameMessage(player, "You're already teleporting.");
                    }
                    return;
                }
                return;
            }

            // OSRS parity: when locked, the client shows a confirm overlay first.
            // The actual unlock is performed on the Confirm button (handled below).
            const state = getLeagueAreaButtonState(player, services, currentRegion);
            console.log(`[league] Awaiting confirm for unlock: regionId=${currentRegion}`);

            // Set IF_SETEVENTS for the confirm and cancel buttons so they're clickable
            // (Static widgets use fromSlot=-1, toSlot=-1)
            queueWidgetFlagsRange(
                player,
                services,
                uidForTrailblazerAreas(COMP_AREAS_CONFIRM_BUTTON),
                -1,
                -1,
                IF_SETEVENTS_TRANSMIT_OP1,
            );
            queueWidgetFlagsRange(
                player,
                services,
                uidForTrailblazerAreas(COMP_AREAS_CANCEL_BUTTON),
                -1,
                -1,
                IF_SETEVENTS_TRANSMIT_OP1,
            );

            // Tutorial: after pressing Unlock, guide the player to the Confirm button.
            // (The confirm overlay is made visible by the local onOp handler: [clientscript,league_area_confirm] 3674.)
            const tutorial = player.getVarbitValue?.(VARBIT_LEAGUE_TUTORIAL_COMPLETED) ?? 0;
            if (tutorial === 7 && currentRegion === 2 && state === 2) {
                services.queueWidgetEvent?.(player.id, {
                    action: "run_script",
                    scriptId: SCRIPT_UI_HIGHLIGHT,
                    args: [
                        UI_HIGHLIGHT_KIND_LEAGUE_TUTORIAL,
                        UI_HIGHLIGHT_ID_UNLOCK_BUTTON,
                        uidForTrailblazerAreas(COMP_AREAS_CONFIRM_BUTTON),
                        -1,
                        UI_HIGHLIGHT_STYLE_DEFAULT,
                        0,
                    ],
                });
            }

            // CS2 onOp handler (3674) performs the visual confirm overlay; server waits for the confirm click.
        });

        // Confirm unlock button (created in CS2 by league_areas_show_detailed).
        // This is where OSRS performs the irreversible unlock, not on the initial Unlock click.
        registry.onButton(LEAGUE_AREAS_GROUP_ID, COMP_AREAS_CONFIRM_BUTTON, (event) => {
            const player = event.player;
            const currentRegionRaw = player.getVarbitValue?.(VARBIT_LEAGUE_AREA_LAST_VIEWED) ?? -1;
            const currentRegion = normalizeLeagueAreaSelectionValue(currentRegionRaw);
            console.log(`[league] Confirm unlock clicked: regionId=${currentRegion}`);

            const state = getLeagueAreaButtonState(player, services, currentRegion);
            if (state !== 2) {
                console.log(`[league] Unlock rejected: state=${state} regionId=${currentRegion}`);
                return;
            }

            const res = tryUnlockLeagueArea(player, services, currentRegion);
            if (!res.ok) {
                console.log(`[league] Unlock failed: reason=${res.reason ?? "unknown"}`);
            } else {
                console.log(`[league] Area unlocked: regionId=${currentRegion}`);

                // Play area unlock sound
                services.sendSound?.(player, SYNTH_TRAILBLAZER_UNLOCK_TWUNKLES);

                refreshLeagueSidePanelProgress(player, services);

                // Leagues tutorial progression: unlocking Karamja promotes to step 9 immediately
                // so reconnects recover directly to relic-stage guidance.
                const tutorial = player.getVarbitValue?.(VARBIT_LEAGUE_TUTORIAL_COMPLETED) ?? 0;
                if (currentRegion === 2 && tutorial === 7) {
                    player.setVarbitValue(VARBIT_LEAGUE_TUTORIAL_COMPLETED, 9);
                    syncLeagueGeneralVarpAndQueue(player, services);
                    services.queueVarbit?.(player.id, VARBIT_LEAGUE_TUTORIAL_COMPLETED, 9);

                    // Clear previous highlights
                    services.queueWidgetEvent?.(player.id, {
                        action: "run_script",
                        scriptId: SCRIPT_UI_HIGHLIGHT_CLEAR,
                        args: [UI_HIGHLIGHT_KIND_LEAGUE_TUTORIAL, UI_HIGHLIGHT_ID_KARAMJA_SHIELD],
                    });
                    services.queueWidgetEvent?.(player.id, {
                        action: "run_script",
                        scriptId: SCRIPT_UI_HIGHLIGHT_CLEAR,
                        args: [UI_HIGHLIGHT_KIND_LEAGUE_TUTORIAL, UI_HIGHLIGHT_ID_UNLOCK_BUTTON],
                    });
                    services.queueWidgetEvent?.(player.id, {
                        action: "run_script",
                        scriptId: SCRIPT_UI_HIGHLIGHT_CLEAR,
                        args: [UI_HIGHLIGHT_KIND_LEAGUE_TUTORIAL, UI_HIGHLIGHT_ID_RELICS_BUTTON],
                    });

                    // Guide the player to close the Areas interface first.
                    services.queueWidgetEvent?.(player.id, {
                        action: "run_script",
                        scriptId: SCRIPT_UI_HIGHLIGHT,
                        args: [
                            UI_HIGHLIGHT_KIND_LEAGUE_TUTORIAL,
                            UI_HIGHLIGHT_ID_AREAS_CLOSE_BUTTON,
                            uidForTrailblazerAreas(COMP_AREAS_CLOSE_BUTTON),
                            -1,
                            UI_HIGHLIGHT_STYLE_DEFAULT,
                            0,
                        ],
                    });
                }

                // OSRS parity: Hide the confirm overlay after a successful unlock.
                // Client script 3680 does: if_sethide(true, confirm_layer)
                services.queueWidgetEvent?.(player.id, {
                    action: "run_script",
                    scriptId: 3680, // [clientscript,league_area_confirm_back]
                    args: [uidForTrailblazerAreas(COMP_AREAS_CONFIRM_LAYER)],
                    varps: getLeagueVarpsForPlayer(player),
                    varbits: getLeagueVarbits(player),
                });

                // Refresh the detailed view so the Select button updates to Teleport immediately.
                const buttonState = getLeagueAreaButtonState(player, services, currentRegion);
                services.queueWidgetEvent?.(player.id, {
                    action: "run_script",
                    scriptId: SCRIPT_LEAGUE_AREAS_SHOW_DETAILED,
                    args: [
                        currentRegion,
                        uidForTrailblazerAreas(COMP_AREAS_MAP_BG_LAYER),
                        uidForTrailblazerAreas(COMP_AREAS_SHIELDS_LAYER),
                        uidForTrailblazerAreas(COMP_AREAS_NAMES_LAYER),
                        uidForTrailblazerAreas(COMP_AREAS_DETAILS),
                        uidForTrailblazerAreas(COMP_AREAS_NAME_SHIELD),
                        uidForTrailblazerAreas(COMP_AREAS_NAME_HEADER),
                        uidForTrailblazerAreas(COMP_AREAS_DESCRIPTION),
                        uidForTrailblazerAreas(COMP_SELECT_BUTTON),
                        uidForTrailblazerAreas(COMP_SELECT_BACK),
                        uidForTrailblazerAreas(COMP_AREAS_ICON),
                        buttonState,
                        0,
                        0,
                        uidForTrailblazerAreas(COMP_AREAS_CONFIRM_LAYER),
                        0,
                        0,
                        uidForTrailblazerAreas(COMP_AREAS_CONFIRM_STEELBORDER),
                        uidForTrailblazerAreas(COMP_AREAS_CONFIRM_MESSAGE),
                        uidForTrailblazerAreas(COMP_AREAS_CONFIRM_BUTTON),
                        uidForTrailblazerAreas(COMP_AREAS_CANCEL_BUTTON),
                        uidForTrailblazerAreas(COMP_AREAS_LOADING),
                        0,
                    ],
                    varps: getLeagueVarpsForPlayer(player),
                    varbits: {
                        ...getLeagueVarbits(player),
                        [VARBIT_LEAGUE_AREA_LAST_VIEWED]: currentRegion,
                    },
                });
            }
        });

        // Cancel button in unlock confirm overlay (hide overlay, remain on detailed view)
        registry.onButton(LEAGUE_AREAS_GROUP_ID, COMP_AREAS_CANCEL_BUTTON, (event) => {
            const player = event.player;
            const tutorial = player.getVarbitValue?.(VARBIT_LEAGUE_TUTORIAL_COMPLETED) ?? 0;
            const currentRegionRaw = player.getVarbitValue?.(VARBIT_LEAGUE_AREA_LAST_VIEWED) ?? -1;
            const currentRegion = normalizeLeagueAreaSelectionValue(currentRegionRaw);

            if (tutorial === 7 && currentRegion === 2 && !isLeagueAreaUnlocked(player, 2)) {
                // Re-target tutorial guidance back to Unlock once confirm overlay is dismissed.
                services.queueWidgetEvent?.(player.id, {
                    action: "run_script",
                    scriptId: SCRIPT_UI_HIGHLIGHT_CLEAR,
                    args: [UI_HIGHLIGHT_KIND_LEAGUE_TUTORIAL, UI_HIGHLIGHT_ID_KARAMJA_SHIELD],
                });
                services.queueWidgetEvent?.(player.id, {
                    action: "run_script",
                    scriptId: SCRIPT_UI_HIGHLIGHT,
                    args: [
                        UI_HIGHLIGHT_KIND_LEAGUE_TUTORIAL,
                        UI_HIGHLIGHT_ID_UNLOCK_BUTTON,
                        uidForTrailblazerAreas(COMP_SELECT_BUTTON),
                        -1,
                        UI_HIGHLIGHT_STYLE_DEFAULT,
                        0,
                    ],
                });
            }
        });

        // Back button - CS2 handles returning to map view
        registry.onButton(LEAGUE_AREAS_GROUP_ID, COMP_SELECT_BACK, (event) => {
            const player = event.player;
            const tutorial = player.getVarbitValue?.(VARBIT_LEAGUE_TUTORIAL_COMPLETED) ?? 0;
            console.log(`[league] Back button clicked`);

            // CS2 onop handler manages the UI transition.
            // Re-target tutorial guidance to Karamja while player is back on the map view.
            if (tutorial === 7 && !isLeagueAreaUnlocked(player, 2)) {
                services.queueWidgetEvent?.(player.id, {
                    action: "run_script",
                    scriptId: SCRIPT_UI_HIGHLIGHT_CLEAR,
                    args: [UI_HIGHLIGHT_KIND_LEAGUE_TUTORIAL, UI_HIGHLIGHT_ID_UNLOCK_BUTTON],
                });
                services.queueWidgetEvent?.(player.id, {
                    action: "run_script",
                    scriptId: SCRIPT_UI_HIGHLIGHT,
                    args: [
                        UI_HIGHLIGHT_KIND_LEAGUE_TUTORIAL,
                        UI_HIGHLIGHT_ID_KARAMJA_SHIELD,
                        uidForTrailblazerAreas(46), // Karamja shield child
                        -1,
                        UI_HIGHLIGHT_STYLE_DEFAULT,
                        0,
                    ],
                });
            }
        });

        // Close button - mirrors relic/tasks fallback handling for non-parity click routes.
        // CS2 close op normally runs clientside (leagues_closebutton_click), but when the op is
        // transmitted we must still enforce tutorial gating server-side.
        registry.onButton(LEAGUE_AREAS_GROUP_ID, COMP_AREAS_CLOSE_BUTTON, (event) => {
            const player = event.player;
            const tutorial = player.getVarbitValue?.(VARBIT_LEAGUE_TUTORIAL_COMPLETED) ?? 0;
            const tutorialComplete = getLeagueTutorialCompleteStep(player);

            // During the area unlock gate, do not allow closing until Karamja is unlocked.
            if (tutorial < tutorialComplete && tutorial < 9 && !isLeagueAreaUnlocked(player, 2)) {
                return;
            }

            const mainmodalUid = getMainmodalUid(player.displayMode);
            services.closeSubInterface?.(player, mainmodalUid, LEAGUE_AREAS_GROUP_ID);
        });

        // ========== League Relics (655) ==========

        const getPendingRelicSelection = (player: any): LeagueRelicIndexEntry | undefined =>
            player.__leagueRelicPendingSelection as LeagueRelicIndexEntry | undefined;
        const clearPendingRelicSelection = (player: any): void => {
            try {
                delete player.__leagueRelicPendingSelection;
            } catch {}
        };

        const RELIC_CLICKZONES_WIDGET_UID =
            ((LEAGUE_RELICS_GROUP_ID & 0xffff) << 16) | (L5_RELIC_CLICKZONES_CHILD & 0xffff);

        const onRelicClickzoneView = (event: WidgetActionEvent): void => {
            // Dynamic clickzones: widgetId is 655:22, and the dynamic child index is carried in `slot`.
            const player = event.player;
            const leagueType = player.getVarbitValue?.(VARBIT_LEAGUE_TYPE) ?? 0;
            console.log(
                `[league] onRelicClickzoneView: widgetId=${event.widgetId} slot=${event.slot} childId=${event.childId} leagueType=${leagueType}`,
            );
            if (!(leagueType > 0) || leagueType === 3) {
                console.log(
                    `[league] Relic view rejected: leagueType=${leagueType} (need >0 and !=3)`,
                );
                return;
            }

            // Tutorial: Clear all tier 0 relic highlights when any relic is clicked
            const tutorial = player.getVarbitValue?.(VARBIT_LEAGUE_TUTORIAL_COMPLETED) ?? 0;
            if (tutorial === 9) {
                // Clear highlights for all tier 0 relics (typically 3)
                for (let i = 0; i < 10; i++) {
                    services.queueWidgetEvent?.(player.id, {
                        action: "run_script",
                        scriptId: SCRIPT_UI_HIGHLIGHT_CLEAR,
                        args: [
                            UI_HIGHLIGHT_KIND_LEAGUE_TUTORIAL,
                            UI_HIGHLIGHT_ID_TIER0_RELIC_BASE + i,
                        ],
                    });
                }
            }

            const indexMap = getLeagueRelicIndexMap(services, leagueType);
            if (!indexMap) {
                console.log(
                    `[league] Relic view rejected: indexMap is null for leagueType=${leagueType}`,
                );
                return;
            }

            // Binary IF_BUTTON packets send the dynamic child index in `slot`.
            // Keep a fallback to `childId` for non-binary sources.
            const slotVal = event.slot ?? -1;
            const globalIndex = slotVal >= 0 && slotVal !== 65535 ? slotVal : event.childId;
            const entry = indexMap[globalIndex];
            console.log(
                `[league] Relic lookup: slotVal=${slotVal} globalIndex=${globalIndex} entry=${
                    entry ? `tier${entry.tierIndex}key${entry.relicKey}` : "null"
                } indexMapLen=${indexMap.length}`,
            );
            if (!entry || entry.globalIndex !== globalIndex) {
                console.log(
                    `[league] Relic view rejected: no entry for globalIndex=${globalIndex}`,
                );
                return;
            }

            player.__leagueRelicPendingSelection = entry;
            console.log(
                `[league] Pending relic selection leagueType=${leagueType} tier=${entry.tierIndex} key=${entry.relicKey} idx=${globalIndex}`,
            );

            const tierVarbitId = getRelicSelectionVarbitIdForTier(entry.tierIndex);
            if (!tierVarbitId) return;

            const points = player.getVarpValue?.(VARP_LEAGUE_POINTS_CLAIMED) ?? 0;
            const selected = player.getVarbitValue?.(tierVarbitId) ?? 0;

            // league_relic_not_available (3194) expects:
            // 0 = not enough points, 1 = already unlocked this relic, 3 = previous tier first, 4 = tier already selected, 2 = available
            let availability = 2;
            if (entry.tierIndex > 0) {
                const prevVarbitId = getRelicSelectionVarbitIdForTier(entry.tierIndex - 1);
                if (prevVarbitId) {
                    const prev = player.getVarbitValue?.(prevVarbitId) ?? 0;
                    if (prev === 0) availability = 3;
                }
            }
            if (availability === 2 && points < entry.tierPointsRequired) availability = 0;
            if (availability === 2) {
                if (selected === entry.relicKey) availability = 1;
                else if (selected !== 0) availability = 4;
            }

            const uidForRelics = (childId: number): number =>
                ((LEAGUE_RELICS_GROUP_ID & 0xffff) << 16) | (childId & 0xffff);

            // league_relic_expanded_view (3193) expects concrete components (not the dynamic clickzone entries)
            // plus availability + (relic struct, tier passive struct).
            services.queueWidgetEvent?.(player.id, {
                action: "run_script",
                scriptId: SCRIPT_LEAGUE_RELIC_EXPANDED_VIEW,
                args: [
                    uidForRelics(14), // view_all
                    uidForRelics(23), // view_all_scrollbar
                    uidForRelics(27), // view_one
                    uidForRelics(24), // loading
                    uidForRelics(43), // relic icon
                    uidForRelics(33), // relic name
                    uidForRelics(38), // "Relic Effect:" label
                    uidForRelics(39), // relic effect description
                    uidForRelics(44), // select button
                    uidForRelics(46), // back button
                    uidForRelics(12), // confirm overlay container
                    uidForRelics(48), // confirm steelborder parent
                    uidForRelics(49), // confirm message text
                    uidForRelics(51), // confirm button
                    uidForRelics(50), // cancel button
                    uidForRelics(55), // passive label
                    uidForRelics(56), // passive description
                    uidForRelics(4), // close button
                    availability,
                    entry.relicStructId,
                    entry.tierPassiveStructId,
                ],
                varps: getLeagueVarpsForPlayer(player),
                varbits: getLeagueVarbits(player),
            });
        };

        // Primary mapping: RSMod-style button handler for component 655:22.
        registry.onButton(LEAGUE_RELICS_GROUP_ID, L5_RELIC_CLICKZONES_CHILD, onRelicClickzoneView);
        // Fallback mapping: some input paths rely on widgetId/opId routing (no button-handler hash).
        registry.registerWidgetAction({
            widgetId: RELIC_CLICKZONES_WIDGET_UID,
            opId: 1,
            handler: onRelicClickzoneView,
        });

        // Close button - closes the relics modal
        // Tutorial progression is handled by onInterfaceClose hook above
        registry.onButton(LEAGUE_RELICS_GROUP_ID, L5_RELIC_CLOSE_BUTTON_CHILD, (event) => {
            const player = event.player;
            clearPendingRelicSelection(player);
            // OSRS parity: Close buttons run if_close clientside (leagues_closebutton_click),
            // but if the click is transmitted to the server (non-parity client paths), still close
            // the correct sub-interface rather than closing whatever mainmodal is active.
            const mainmodalUid = getMainmodalUid(player.displayMode);
            services.closeSubInterface?.(player, mainmodalUid, LEAGUE_RELICS_GROUP_ID);
        });

        registry.onButton(LEAGUE_RELICS_GROUP_ID, L5_RELIC_CANCEL_BUTTON_CHILD, (event) => {
            clearPendingRelicSelection(event.player);
        });

        registry.onButton(LEAGUE_RELICS_GROUP_ID, L5_RELIC_CONFIRM_BUTTON_CHILD, (event) => {
            const player = event.player;
            const pending = getPendingRelicSelection(player);
            if (!pending) {
                console.log(`[league] Relic confirm rejected: no pending selection`);
                return;
            }

            const leagueType = player.getVarbitValue?.(VARBIT_LEAGUE_TYPE) ?? 0;
            if (leagueType !== pending.leagueType || leagueType === 3) {
                console.log(
                    `[league] Relic confirm rejected: leagueType mismatch (${leagueType} vs ${pending.leagueType})`,
                );
                return;
            }

            const tierVarbitId = getRelicSelectionVarbitIdForTier(pending.tierIndex);
            if (!tierVarbitId) {
                console.log(`[league] Relic confirm rejected: invalid tier varbit`);
                return;
            }

            // Tiers must be selected in order.
            if (pending.tierIndex > 0) {
                const prevVarbitId = getRelicSelectionVarbitIdForTier(pending.tierIndex - 1);
                if (!prevVarbitId) {
                    console.log(`[league] Relic confirm rejected: invalid prev tier varbit`);
                    return;
                }
                const prev = player.getVarbitValue?.(prevVarbitId) ?? 0;
                if (prev === 0) {
                    console.log(`[league] Relic confirm rejected: previous tier not selected`);
                    return;
                }
            }

            // Tier must not already be selected.
            const existing = player.getVarbitValue?.(tierVarbitId) ?? 0;
            if (existing !== 0) {
                console.log(`[league] Relic confirm rejected: tier already selected (${existing})`);
                return;
            }

            // Points gate.
            const points = player.getVarpValue?.(VARP_LEAGUE_POINTS_CLAIMED) ?? 0;
            if (points < pending.tierPointsRequired) {
                console.log(
                    `[league] Relic confirm rejected: not enough points (${points} < ${pending.tierPointsRequired})`,
                );
                return;
            }

            try {
                // Award any relic reward object (param_2049) before committing the selection.
                const structLoader =
                    services?.getStructTypeLoader?.() ?? services?.structTypeLoader;
                const relicStruct = structLoader?.load?.(pending.relicStructId);
                const rewardObjId = relicStruct?.params?.get?.(PARAM_LEAGUE_RELIC_REWARD_OBJ) as
                    | number
                    | undefined;
                if (rewardObjId !== undefined && rewardObjId > 0) {
                    const res = services.addItemToInventory(player, rewardObjId, 1);
                    // Don't block relic selection if inventory is full - player can reclaim from Sage
                    if (res.added >= 1) {
                        services.snapshotInventory(player);
                    }
                }

                player.setVarbitValue(tierVarbitId, pending.relicKey);
                const packedVarpUpdates = syncLeaguePackedVarps(player);
                queueLeaguePackedVarpUpdates(services, player.id, packedVarpUpdates);

                // Send varbit immediately so client has the new state before running scripts
                services.sendVarbit?.(player, tierVarbitId, pending.relicKey);

                console.log(
                    `[league] Relic unlocked! tier=${pending.tierIndex} key=${pending.relicKey} varbit=${tierVarbitId}`,
                );
            } catch (err) {
                console.error(`[league] Relic confirm ERROR:`, err);
                return;
            }

            // Play relic unlock sound
            services.sendSound?.(player, SYNTH_RELIC_UNLOCK_PULSING);

            const updatedVarps = getLeagueVarpsForPlayer(player);
            const updatedVarbits = getLeagueVarbits(player);

            const uidForRelics = (childId: number): number =>
                ((LEAGUE_RELICS_GROUP_ID & 0xffff) << 16) | (childId & 0xffff);

            // Hide the confirm overlay immediately (Confirm button only plays sound client-side).
            services.queueWidgetEvent?.(player.id, {
                action: "set_hidden",
                uid: uidForRelics(12), // confirm overlay container
                hidden: true,
            });

            // Script 3196 = league_relic_back - closes expanded view and returns to list
            services.queueWidgetEvent?.(player.id, {
                action: "run_script",
                scriptId: 3196, // league_relic_back
                args: [
                    uidForRelics(14), // view_all
                    uidForRelics(23), // view_all_scrollbar
                    uidForRelics(27), // view_one
                    uidForRelics(24), // loading
                    uidForRelics(4), // close button
                ],
                varps: updatedVarps,
                varbits: updatedVarbits,
            });

            // Redraw the relic list immediately so unlocked state is visible without reopening.
            // OSRS parity: league_relics_init sets an onResize handler on league_relics:infinity that calls
            // league_relics_draw_selections with captured args. Calling script6110(infinity, -1) forces
            // proc2459 to call if_callonresize (since -1 != computed size bucket), which triggers that redraw.
            services.queueWidgetEvent?.(player.id, {
                action: "run_script",
                scriptId: 6110, // script6110(component, int) -> proc2459 -> if_callonresize
                args: [
                    uidForRelics(0), // league_relics:infinity
                    -1,
                ],
                varps: updatedVarps,
                varbits: updatedVarbits,
            });

            // Tutorial: show close button highlight after unlocking a relic
            const tutorial = player.getVarbitValue?.(VARBIT_LEAGUE_TUTORIAL_COMPLETED) ?? 0;
            if (tutorial === 9) {
                services.queueWidgetEvent?.(player.id, {
                    action: "run_script",
                    scriptId: SCRIPT_UI_HIGHLIGHT,
                    args: [
                        UI_HIGHLIGHT_KIND_LEAGUE_TUTORIAL,
                        UI_HIGHLIGHT_ID_RELICS_CLOSE_BUTTON,
                        uidForRelics(L5_RELIC_CLOSE_BUTTON_CHILD),
                        -1,
                        UI_HIGHLIGHT_STYLE_DEFAULT,
                        0,
                    ],
                });
            }

            refreshLeagueSidePanelProgress(player, services, {
                leagueType,
                varps: updatedVarps,
                varbits: updatedVarbits,
            });

            clearPendingRelicSelection(player);
        });

        // ========== League Combat Mastery (311) ==========

        interface PendingMasterySelection {
            slot: number; // 0-5 melee, 6-11 ranged, 12-17 magic, 18-23 shared
            masteryType: "melee" | "ranged" | "magic" | "shared";
            tier: number; // 1-6
            masteryStructId: number;
            passiveStructId: number;
        }

        const getPendingMasterySelection = (player: any): PendingMasterySelection | undefined =>
            player.__leagueMasteryPendingSelection as PendingMasterySelection | undefined;
        const clearPendingMasterySelection = (player: any): void => {
            try {
                delete player.__leagueMasteryPendingSelection;
            } catch {}
        };

        const MASTERY_CLICKZONES_WIDGET_UID =
            ((LEAGUE_COMBAT_MASTERY_GROUP_ID & 0xffff) << 16) |
            (L5_MASTERY_CLICKZONES_CHILD & 0xffff);

        const onMasteryClickzoneView = (event: WidgetActionEvent): void => {
            const player = event.player;
            const slotVal = event.slot ?? -1;
            const clickedIndex = slotVal >= 0 && slotVal !== 65535 ? slotVal : event.childId;
            console.log(
                `[league] onMasteryClickzoneView: widgetId=${event.widgetId} slot=${event.slot} childId=${event.childId} clickedIndex=${clickedIndex}`,
            );

            const uidForMastery = (childId: number): number =>
                ((LEAGUE_COMBAT_MASTERY_GROUP_ID & 0xffff) << 16) | (childId & 0xffff);

            // Map clickedIndex (slot) to mastery struct ID.
            // Mastery tree layout:
            // - Melee I-VI: slots 0-5 -> structs 1165-1170
            // - Ranged I-VI: slots 6-11 -> structs 1171-1176
            // - Magic I-VI: slots 12-17 -> structs 1159-1164
            // - Shared/core: slots 18-23 -> structs 1153-1158
            let masteryStructId = 0;
            const slot = clickedIndex;
            if (slot >= 0 && slot <= 5) {
                masteryStructId = 1165 + slot; // Melee
            } else if (slot >= 6 && slot <= 11) {
                masteryStructId = 1171 + (slot - 6); // Ranged
            } else if (slot >= 12 && slot <= 17) {
                masteryStructId = 1159 + (slot - 12); // Magic
            } else if (slot >= 18 && slot <= 23) {
                masteryStructId = 1153 + (slot - 18); // Shared
            }
            // Combat masteries (melee/ranged/magic) have corresponding shared mastery as passive.
            // Shared masteries themselves have no separate passive.
            let passiveStructId = 0;
            if (slot >= 0 && slot <= 5) {
                passiveStructId = 1153 + slot; // Melee tier -> Shared tier
            } else if (slot >= 6 && slot <= 11) {
                passiveStructId = 1153 + (slot - 6); // Ranged tier -> Shared tier
            } else if (slot >= 12 && slot <= 17) {
                passiveStructId = 1153 + (slot - 12); // Magic tier -> Shared tier
            }
            // Shared (slots 18-23) have no passive, passiveStructId stays 0

            // Determine mastery type and tier for pending selection
            let masteryType: "melee" | "ranged" | "magic" | "shared" = "shared";
            let tier = 1;
            if (slot >= 0 && slot <= 5) {
                masteryType = "melee";
                tier = slot + 1;
            } else if (slot >= 6 && slot <= 11) {
                masteryType = "ranged";
                tier = slot - 6 + 1;
            } else if (slot >= 12 && slot <= 17) {
                masteryType = "magic";
                tier = slot - 12 + 1;
            } else if (slot >= 18 && slot <= 23) {
                masteryType = "shared";
                tier = slot - 18 + 1;
            }

            // Store pending selection for confirm button
            player.__leagueMasteryPendingSelection = {
                slot,
                masteryType,
                tier,
                masteryStructId,
                passiveStructId,
            } as PendingMasterySelection;
            console.log(
                `[league] Pending mastery selection: type=${masteryType} tier=${tier} struct=${masteryStructId}`,
            );

            // Script 7674 shows the mastery expanded view.
            // Component args based on widget group 311 hierarchy:
            // 0: view_all (8)
            // 1: view_all_scrollbar (9)
            // 2: view_one (11) - gets shown
            // 3: loading (10) - gets hidden
            // 4: icon graphic (41)
            // 5: mastery name text (39)
            // 6: effect label text (44)
            // 7: effect description text (45)
            // 8: select button (55)
            // 9: back button (56)
            // 10: confirm overlay (13)
            // 11: steelborder container (68)
            // 12: confirm message text (70)
            // 13: confirm button (71)
            // 14: cancel button (72)
            // 15: passive label text (50)
            // 16: passive description text (51)
            // 17: mastery struct ID
            // 18: passive struct ID
            services.queueWidgetEvent?.(player.id, {
                action: "run_script",
                scriptId: SCRIPT_LEAGUE_MASTERY_EXPANDED_VIEW,
                args: [
                    uidForMastery(8), // view_all
                    uidForMastery(9), // view_all_scrollbar
                    uidForMastery(11), // view_one
                    uidForMastery(10), // loading
                    uidForMastery(54), // mastery icon graphic (type 5, 120x120)
                    uidForMastery(39), // mastery name text
                    uidForMastery(44), // "Combat Mastery Effect:" label
                    uidForMastery(45), // effect description text
                    uidForMastery(55), // Select button
                    uidForMastery(56), // Back button
                    uidForMastery(13), // confirm overlay
                    uidForMastery(68), // steelborder container
                    uidForMastery(70), // confirm message text
                    uidForMastery(71), // Confirm button
                    uidForMastery(72), // Cancel button
                    uidForMastery(50), // "Passive Effect:" label
                    uidForMastery(51), // passive description text
                    masteryStructId, // mastery struct
                    passiveStructId, // passive struct (0 = no passive)
                ],
                varps: getLeagueVarpsForPlayer(player),
                varbits: getLeagueVarbits(player),
            });
        };

        // Primary mapping: RSMod-style button handler for component 311:36 (mastery clickzones)
        registry.onButton(
            LEAGUE_COMBAT_MASTERY_GROUP_ID,
            L5_MASTERY_CLICKZONES_CHILD,
            onMasteryClickzoneView,
        );
        // Fallback mapping: some input paths rely on widgetId/opId routing
        registry.registerWidgetAction({
            widgetId: MASTERY_CLICKZONES_WIDGET_UID,
            opId: 1,
            handler: onMasteryClickzoneView,
        });

        // Close button for mastery interface
        registry.onButton(
            LEAGUE_COMBAT_MASTERY_GROUP_ID,
            L5_MASTERY_CLOSE_BUTTON_CHILD,
            (event) => {
                const player = event.player;
                clearPendingMasterySelection(player);
                const mainmodalUid = getMainmodalUid(player.displayMode);
                services.closeSubInterface?.(player, mainmodalUid, LEAGUE_COMBAT_MASTERY_GROUP_ID);
            },
        );

        // Select button for mastery - directly applies the selection (skipping broken confirm popup)
        registry.onButton(
            LEAGUE_COMBAT_MASTERY_GROUP_ID,
            L5_MASTERY_SELECT_BUTTON_CHILD,
            (event) => {
                const player = event.player;
                const pending = getPendingMasterySelection(player);
                if (!pending) {
                    console.log(`[league] Mastery select rejected: no pending selection`);
                    return;
                }

                console.log(
                    `[league] Mastery select button clicked: type=${pending.masteryType} tier=${pending.tier}`,
                );

                // Directly apply the selection (skip confirm popup since it's not working)
                // This mimics what the Confirm button handler does

                // Shared masteries are unlocked passively when selecting combat masteries
                if (pending.masteryType === "shared") {
                    console.log(
                        `[league] Mastery select rejected: cannot directly select shared masteries`,
                    );
                    clearPendingMasterySelection(player);
                    return;
                }

                const masteryVarbitId =
                    pending.masteryType === "melee"
                        ? VARBIT_LEAGUE_MELEE_MASTERY
                        : pending.masteryType === "ranged"
                        ? VARBIT_LEAGUE_RANGED_MASTERY
                        : pending.masteryType === "magic"
                        ? VARBIT_LEAGUE_MAGIC_MASTERY
                        : 0;

                const currentLevel = player.getVarbitValue?.(masteryVarbitId) ?? 0;
                const pointsToSpend =
                    player.getVarbitValue?.(VARBIT_LEAGUE_MASTERY_POINTS_TO_SPEND) ?? 0;

                // Validate: must select tiers in order
                if (pending.tier !== currentLevel + 1) {
                    console.log(
                        `[league] Mastery select rejected: must select tier ${
                            currentLevel + 1
                        }, not tier ${pending.tier}`,
                    );
                    clearPendingMasterySelection(player);
                    return;
                }

                // Validate: need at least 1 point
                if (pointsToSpend < 1) {
                    console.log(`[league] Mastery select rejected: no points to spend`);
                    clearPendingMasterySelection(player);
                    return;
                }

                // Apply the selection
                const newLevel = currentLevel + 1;
                player.setVarbitValue(masteryVarbitId, newLevel);
                player.setVarbitValue(VARBIT_LEAGUE_MASTERY_POINTS_TO_SPEND, pointsToSpend - 1);
                const packedVarpUpdates = syncLeaguePackedVarps(player);
                queueLeaguePackedVarpUpdates(services, player.id, packedVarpUpdates);

                // Sync to client
                services.queueVarbit?.(player.id, masteryVarbitId, newLevel);
                services.queueVarbit?.(
                    player.id,
                    VARBIT_LEAGUE_MASTERY_POINTS_TO_SPEND,
                    pointsToSpend - 1,
                );

                console.log(
                    `[league] Mastery ${pending.masteryType} upgraded to tier ${newLevel}, ${
                        pointsToSpend - 1
                    } points remaining`,
                );

                const uidForMastery = (childId: number): number =>
                    ((LEAGUE_COMBAT_MASTERY_GROUP_ID & 0xffff) << 16) | (childId & 0xffff);

                // Run the back script to return to mastery list view
                services.queueWidgetEvent?.(player.id, {
                    action: "run_script",
                    scriptId: 7673, // league_mastery_back
                    args: [
                        uidForMastery(8), // view_all
                        uidForMastery(9), // view_all_scrollbar
                        uidForMastery(11), // view_one
                        uidForMastery(10), // loading
                        uidForMastery(76), // close button
                    ],
                    varps: getLeagueVarpsForPlayer(player),
                    varbits: getLeagueVarbits(player),
                });

                // Re-enable clickzone transmit so masteries remain clickable after purchase
                queueWidgetFlagsRange(
                    player,
                    services,
                    (LEAGUE_COMBAT_MASTERY_GROUP_ID << 16) | L5_MASTERY_CLICKZONES_CHILD,
                    0,
                    255,
                    IF_SETEVENTS_TRANSMIT_OP1,
                );

                clearPendingMasterySelection(player);
            },
        );

        // Cancel button for mastery confirm overlay
        registry.onButton(
            LEAGUE_COMBAT_MASTERY_GROUP_ID,
            L5_MASTERY_CANCEL_BUTTON_CHILD,
            (event) => {
                console.log(`[league] Mastery cancel button clicked`);
                const player = event.player;

                const uidForMastery = (childId: number): number =>
                    ((LEAGUE_COMBAT_MASTERY_GROUP_ID & 0xffff) << 16) | (childId & 0xffff);

                // Hide the confirm overlay
                services.queueWidgetEvent?.(player.id, {
                    action: "set_hidden",
                    uid: uidForMastery(13), // confirm overlay container
                    hidden: true,
                });

                clearPendingMasterySelection(player);
            },
        );

        // Confirm button for mastery selection
        registry.onButton(
            LEAGUE_COMBAT_MASTERY_GROUP_ID,
            L5_MASTERY_CONFIRM_BUTTON_CHILD,
            (event) => {
                const player = event.player;
                const pending = getPendingMasterySelection(player);
                if (!pending) {
                    console.log(`[league] Mastery confirm rejected: no pending selection`);
                    return;
                }

                console.log(
                    `[league] Mastery confirm: type=${pending.masteryType} tier=${pending.tier}`,
                );

                // Get current mastery level and points
                const masteryVarbitId =
                    pending.masteryType === "melee"
                        ? VARBIT_LEAGUE_MELEE_MASTERY
                        : pending.masteryType === "ranged"
                        ? VARBIT_LEAGUE_RANGED_MASTERY
                        : pending.masteryType === "magic"
                        ? VARBIT_LEAGUE_MAGIC_MASTERY
                        : 0; // shared doesn't have its own varbit

                // Shared masteries are unlocked passively when selecting combat masteries
                if (pending.masteryType === "shared") {
                    console.log(
                        `[league] Mastery confirm rejected: cannot directly select shared masteries`,
                    );
                    clearPendingMasterySelection(player);
                    return;
                }

                const currentLevel = player.getVarbitValue?.(masteryVarbitId) ?? 0;
                const pointsToSpend =
                    player.getVarbitValue?.(VARBIT_LEAGUE_MASTERY_POINTS_TO_SPEND) ?? 0;

                // Validate: must select tiers in order
                if (pending.tier !== currentLevel + 1) {
                    console.log(
                        `[league] Mastery confirm rejected: must select tier ${
                            currentLevel + 1
                        }, not tier ${pending.tier}`,
                    );
                    clearPendingMasterySelection(player);
                    return;
                }

                // Validate: need at least 1 point
                if (pointsToSpend < 1) {
                    console.log(`[league] Mastery confirm rejected: no points to spend`);
                    clearPendingMasterySelection(player);
                    return;
                }

                // Apply the selection
                const newLevel = currentLevel + 1;
                player.setVarbitValue(masteryVarbitId, newLevel);
                player.setVarbitValue(VARBIT_LEAGUE_MASTERY_POINTS_TO_SPEND, pointsToSpend - 1);
                const packedVarpUpdates = syncLeaguePackedVarps(player);
                queueLeaguePackedVarpUpdates(services, player.id, packedVarpUpdates);

                // Sync to client
                services.queueVarbit?.(player.id, masteryVarbitId, newLevel);
                services.queueVarbit?.(
                    player.id,
                    VARBIT_LEAGUE_MASTERY_POINTS_TO_SPEND,
                    pointsToSpend - 1,
                );

                console.log(
                    `[league] Mastery ${pending.masteryType} upgraded to tier ${newLevel}, ${
                        pointsToSpend - 1
                    } points remaining`,
                );

                const uidForMastery = (childId: number): number =>
                    ((LEAGUE_COMBAT_MASTERY_GROUP_ID & 0xffff) << 16) | (childId & 0xffff);

                // Hide the confirm overlay
                services.queueWidgetEvent?.(player.id, {
                    action: "set_hidden",
                    uid: uidForMastery(13), // confirm overlay container
                    hidden: true,
                });

                // Run the back script to return to mastery list view
                // Script 7673 = league_mastery_back - closes expanded view and returns to list
                services.queueWidgetEvent?.(player.id, {
                    action: "run_script",
                    scriptId: 7673, // league_mastery_back
                    args: [
                        uidForMastery(8), // view_all
                        uidForMastery(9), // view_all_scrollbar
                        uidForMastery(11), // view_one
                        uidForMastery(10), // loading
                        uidForMastery(76), // close button
                    ],
                    varps: getLeagueVarpsForPlayer(player),
                    varbits: getLeagueVarbits(player),
                });

                // Re-enable clickzone transmit so masteries remain clickable after purchase
                queueWidgetFlagsRange(
                    player,
                    services,
                    (LEAGUE_COMBAT_MASTERY_GROUP_ID << 16) | L5_MASTERY_CLICKZONES_CHILD,
                    0,
                    255,
                    IF_SETEVENTS_TRANSMIT_OP1,
                );

                clearPendingMasterySelection(player);
            },
        );

        // ========== League 3 Side Panel (736) ==========

        registry.onButton(LEAGUE_SIDE_PANEL_L3_GROUP_ID, L3_COMP_VIEW_INFO, (event) => {
            const mainmodalUid = getMainmodalUid(event.player.displayMode);
            ensureLeagueBasicsInitialized(event.player, services);
            services.openSubInterface?.(event.player, mainmodalUid, LEAGUE_INFO_GROUP_ID, 0, {
                varps: getLeagueVarpsForPlayer(event.player),
                varbits: getLeagueVarbits(event.player),
            });
        });

        registry.onButton(LEAGUE_SIDE_PANEL_L3_GROUP_ID, L3_COMP_VIEW_TASKS, (event) => {
            const mainmodalUid = getMainmodalUid(event.player.displayMode);
            const player = event.player;
            ensureLeagueBasicsInitialized(player, services);
            const tutorial = player.getVarbitValue?.(VARBIT_LEAGUE_TUTORIAL_COMPLETED) ?? 0;

            // Close the tutorial modal while Tasks is open during tutorial step 5
            // It will reopen when Tasks closes (via onInterfaceClose hook)
            if (tutorial === 5) {
                services.closeSubInterface?.(
                    player,
                    getViewportTrackerFrontUid(player.displayMode),
                    LEAGUE_TUTORIAL_MAIN_GROUP_ID,
                );
            }

            // Open the tasks interface
            services.openSubInterface?.(player, mainmodalUid, LEAGUE_TASKS_GROUP_ID, 0, {
                varps: getLeagueVarpsForPlayer(player),
                varbits: getLeagueVarbits(player),
            });

            // Clear Tasks button highlight and add close button highlight (progression happens on close via onInterfaceClose hook)
            if (tutorial === 5) {
                services.queueWidgetEvent?.(player.id, {
                    action: "run_script",
                    scriptId: SCRIPT_UI_HIGHLIGHT_CLEAR,
                    args: [UI_HIGHLIGHT_KIND_LEAGUE_TUTORIAL, UI_HIGHLIGHT_ID_TASKS_BUTTON],
                });
                const tasksCloseButtonUid =
                    ((LEAGUE_TASKS_GROUP_ID & 0xffff) << 16) | (COMP_TASKS_CLOSE_BUTTON & 0xffff);
                services.queueWidgetEvent?.(player.id, {
                    action: "run_script",
                    scriptId: SCRIPT_UI_HIGHLIGHT,
                    args: [
                        UI_HIGHLIGHT_KIND_LEAGUE_TUTORIAL,
                        UI_HIGHLIGHT_ID_TASKS_CLOSE_BUTTON,
                        tasksCloseButtonUid,
                        -1,
                        UI_HIGHLIGHT_STYLE_DEFAULT,
                        0,
                    ],
                });
            }
        });

        registry.onButton(LEAGUE_SIDE_PANEL_L3_GROUP_ID, L3_COMP_VIEW_FRAGMENTS, (event) => {
            const mainmodalUid = getMainmodalUid(event.player.displayMode);
            ensureLeagueBasicsInitialized(event.player, services);
            const tutorial = event.player.getVarbitValue?.(VARBIT_LEAGUE_TUTORIAL_COMPLETED) ?? 0;
            if (tutorial === 10) {
                // L3 tutorial: Fragments -> Finishing (completeStep-1)
                services.queueWidgetEvent?.(event.player.id, {
                    action: "run_script",
                    scriptId: SCRIPT_UI_HIGHLIGHT_CLEAR,
                    args: [UI_HIGHLIGHT_KIND_LEAGUE_TUTORIAL, UI_HIGHLIGHT_ID_RELICS_BUTTON],
                });

                const finishingStep = Math.max(0, getLeagueTutorialCompleteStep(event.player) - 1);
                event.player.setVarbitValue(VARBIT_LEAGUE_TUTORIAL_COMPLETED, finishingStep);
                syncLeagueGeneralVarpAndQueue(event.player, services);
                services.queueVarbit?.(
                    event.player.id,
                    VARBIT_LEAGUE_TUTORIAL_COMPLETED,
                    finishingStep,
                );
            }
            services.openSubInterface?.(
                event.player,
                mainmodalUid,
                LEAGUE_3_FRAGMENTS_GROUP_ID,
                0,
                {
                    varps: getLeagueVarpsForPlayer(event.player),
                    varbits: getLeagueVarbits(event.player),
                },
            );
        });

        registry.onButton(LEAGUE_SIDE_PANEL_L3_GROUP_ID, L3_COMP_VIEW_UNLOCKS, (event) => {
            const mainmodalUid = getMainmodalUid(event.player.displayMode);
            ensureLeagueBasicsInitialized(event.player, services);
            const tutorial = event.player.getVarbitValue?.(VARBIT_LEAGUE_TUTORIAL_COMPLETED) ?? 0;
            if (tutorial === 8) {
                // L3 tutorial: Unlocks -> Fragments
                services.queueWidgetEvent?.(event.player.id, {
                    action: "run_script",
                    scriptId: SCRIPT_UI_HIGHLIGHT_CLEAR,
                    args: [UI_HIGHLIGHT_KIND_LEAGUE_TUTORIAL, UI_HIGHLIGHT_ID_UNLOCK_BUTTON],
                });

                event.player.setVarbitValue(VARBIT_LEAGUE_TUTORIAL_COMPLETED, 10);
                syncLeagueGeneralVarpAndQueue(event.player, services);
                services.queueVarbit?.(event.player.id, VARBIT_LEAGUE_TUTORIAL_COMPLETED, 10);

                const fragmentsUid =
                    ((LEAGUE_SIDE_PANEL_L3_GROUP_ID & 0xffff) << 16) |
                    (L3_COMP_VIEW_FRAGMENTS & 0xffff);
                services.queueWidgetEvent?.(event.player.id, {
                    action: "run_script",
                    scriptId: SCRIPT_UI_HIGHLIGHT,
                    args: [
                        UI_HIGHLIGHT_KIND_LEAGUE_TUTORIAL,
                        UI_HIGHLIGHT_ID_RELICS_BUTTON, // Fragments button highlight id (shared namespace)
                        fragmentsUid,
                        -1,
                        UI_HIGHLIGHT_STYLE_DEFAULT,
                        0,
                    ],
                });
            }
            services.openSubInterface?.(event.player, mainmodalUid, LEAGUE_UNLOCKS_GROUP_ID, 0, {
                varps: getLeagueVarpsForPlayer(event.player),
                varbits: getLeagueVarbits(event.player),
            });
        });

        // OSRS parity: "Display Fragments" is a client-owned CS2 HUD toggle.
        // league_3_side_panel_init wires it to league_side_panel_hudop / %buff_league_relics_hidden,
        // so the server must not try to persist or toggle any league varp/varbit here.

        // ========== League Tasks (657) ==========

        // Close button (childId 3) - tutorial progression is handled by onInterfaceClose
        registry.onButton(LEAGUE_TASKS_GROUP_ID, COMP_TASKS_CLOSE_BUTTON, (event) => {
            const player = event.player;

            // Close the interface
            const mainmodalUid = getMainmodalUid(player.displayMode);
            services.closeSubInterface?.(player, mainmodalUid, LEAGUE_TASKS_GROUP_ID);
        });

        registry.onButton(LEAGUE_TASKS_GROUP_ID, COMP_VIEW_RELICS, (event) => {
            const mainmodalUid = getMainmodalUid(event.player.displayMode);
            const player = event.player;
            const leagueType = player.getVarbitValue?.(VARBIT_LEAGUE_TYPE) ?? 0;
            const groupId = leagueType === 3 ? LEAGUE_3_FRAGMENTS_GROUP_ID : LEAGUE_RELICS_GROUP_ID;

            // Clear any stale pending selection since Tasks can also route into Relics.
            try {
                delete player.__leagueRelicPendingSelection;
            } catch {}

            // Check tutorial state before opening interface
            const tutorial =
                leagueType !== 3
                    ? player.getVarbitValue?.(VARBIT_LEAGUE_TUTORIAL_COMPLETED) ?? 0
                    : 0;

            if (tutorial === 9) {
                services.queueWidgetEvent?.(player.id, {
                    action: "run_script",
                    scriptId: SCRIPT_UI_HIGHLIGHT_CLEAR,
                    args: [UI_HIGHLIGHT_KIND_LEAGUE_TUTORIAL, UI_HIGHLIGHT_ID_RELICS_BUTTON],
                });
            }

            // Open the interface
            services.openSubInterface?.(player, mainmodalUid, groupId, 0, {
                varps: getLeagueVarpsForPlayer(player),
                varbits: getLeagueVarbits(player),
            });

            // IMPORTANT: Flags must be sent AFTER openSubInterface because openSubInterface
            // internally calls closeSubInterface which clears all flags for the group.
            if (groupId === LEAGUE_RELICS_GROUP_ID) {
                const indexMap = getLeagueRelicIndexMap(services, leagueType);
                const maxIndex = indexMap ? indexMap.length : 256;
                const toSlot = Math.max(0, maxIndex - 1);
                queueWidgetFlagsRange(
                    player,
                    services,
                    (LEAGUE_RELICS_GROUP_ID << 16) | L5_RELIC_CLICKZONES_CHILD,
                    0,
                    toSlot,
                    IF_SETEVENTS_TRANSMIT_OP1,
                );
                queueWidgetFlagsRange(
                    player,
                    services,
                    (LEAGUE_RELICS_GROUP_ID << 16) | L5_RELIC_CONFIRM_BUTTON_CHILD,
                    -1,
                    -1,
                    IF_SETEVENTS_TRANSMIT_OP1,
                );
                queueWidgetFlagsRange(
                    player,
                    services,
                    (LEAGUE_RELICS_GROUP_ID << 16) | L5_RELIC_CANCEL_BUTTON_CHILD,
                    -1,
                    -1,
                    IF_SETEVENTS_TRANSMIT_OP1,
                );
            }
        });
    },
};
