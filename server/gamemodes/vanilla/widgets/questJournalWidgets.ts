import { ScriptVarTypeId } from "../../../../src/rs/config/db/ScriptVarType";
import type { PlayerState } from "../../../src/game/player";
import { type IScriptRegistry, ScriptServices, BaseComponentUids } from "../../../src/game/scripts/types";

// ============================================================================
// Constants
// ============================================================================

/** Quest list interface group (side journal quest tab content) */
const QUEST_LIST_GROUP_ID = 399;
/** Dynamic list component inside quest list interface */
const QUEST_LIST_COMPONENT = 7;

/** Quest journal overlay interface */
const QUEST_JOURNAL_GROUP_ID = 119;
/** Title component: questjournal:title */
const QJ_TITLE_CHILD = 5;
/** Close button component: questjournal:close */
const QJ_CLOSE_CHILD = 8;
/** Switch View button component: questjournal:switch */
const QJ_SWITCH_VIEW_CHILD = 9;
/** First journal line component: questjournal:qj1 */
const QJ_FIRST_LINE_CHILD = 11;

/** Varp: currently viewed quest (stores dbrow ID) */
const VARP_LATEST_QUEST_JOURNAL = 3679;
/** Varp: number of journal text lines */
const VARP_QJ_LINES = 4398;

/** CS2 script that clears all quest journal text fields */
const SCRIPT_QUEST_JOURNAL_RESET = 5240;
/** CS2 script that sets up quest journal scrollbar */
const SCRIPT_QUEST_JOURNAL_SCROLL = 2523;

/** OP ID for "Read journal:" right-click option */
const OP_READ_JOURNAL = 2;

// Quest DB table ID in the cache
const QUEST_DB_TABLE_ID = 0;

// ============================================================================
// Quest data structures
// ============================================================================

interface QuestEntry {
    questId: number;
    dbrowId: number;
    displayName: string;
}

// ============================================================================
// Quest map builder
// ============================================================================

/**
 * Build a mapping from quest ID (used as dynamic child index in the quest list)
 * to quest data (dbrow ID, display name) by reading the cache DB table 0.
 *
 * The CS2 questlist_draw script iterates quest IDs 1..N and calls
 * db_find(quest:id, N) to get the dbrow for each quest. The dynamic child
 * index in the quest list equals the quest ID.
 */
function buildQuestMap(services: ScriptServices): Map<number, QuestEntry> {
    const map = new Map<number, QuestEntry>();
    const dbRepo = services.getDbRepository?.();
    if (!dbRepo) return map;

    const rows = dbRepo.getRows(QUEST_DB_TABLE_ID);
    if (rows.length === 0) return map;

    const tableDef = dbRepo.getTables().get(QUEST_DB_TABLE_ID);
    if (!tableDef) return map;

    // Discover quest:id column (first single-value INTEGER column)
    // and quest:displayname column (first single-value STRING column)
    let idColumnId = -1;
    let nameColumnId = -1;

    for (const [colId, colDef] of tableDef.columns) {
        if (colDef.types.length !== 1) continue;
        if (colDef.types[0] === ScriptVarTypeId.INTEGER && idColumnId === -1) {
            idColumnId = colId;
        }
        if (colDef.types[0] === ScriptVarTypeId.STRING && nameColumnId === -1) {
            nameColumnId = colId;
        }
    }

    if (idColumnId === -1 || nameColumnId === -1) {
        services.logger?.warn?.(
            `[quest-journal] Could not discover quest DB columns: id=${idColumnId} name=${nameColumnId}`,
        );
        return map;
    }

    for (const row of rows) {
        const idCol = row.getColumn(idColumnId);
        const nameCol = row.getColumn(nameColumnId);

        const questId = idCol?.values?.[0];
        const displayName = nameCol?.values?.[0];

        if (typeof questId === "number" && questId > 0 && typeof displayName === "string") {
            map.set(questId, {
                questId,
                dbrowId: row.id,
                displayName,
            });
        }
    }

    services.logger?.info?.(
        `[quest-journal] Loaded ${map.size} quests from cache DB table ${QUEST_DB_TABLE_ID}`,
    );
    return map;
}

// ============================================================================
// Journal text generation
// ============================================================================

/**
 * Build journal lines for a quest based on its completion status.
 *
 * In OSRS, each quest has unique server-side scripts that generate journal
 * text per progress stage. For our implementation, we check the quest's
 * progress varp against its completion value to determine basic status.
 */
function buildJournalLines(player: PlayerState, quest: QuestEntry): string[] {
    // Check if quest was completed via ::quest command by checking known quest varps
    const completionEntry = QUEST_COMPLETION_DATA.get(quest.displayName.toLowerCase());
    if (completionEntry) {
        const currentValue = completionEntry.varpId >= 0
            ? player.varps.getVarpValue(completionEntry.varpId)
            : 0;

        // Check varbit entries too
        let allVarbitsComplete = true;
        if (completionEntry.varbitEntries) {
            for (const { varbitId, value } of completionEntry.varbitEntries) {
                if (player.varps.getVarbitValue(varbitId) < value) {
                    allVarbitsComplete = false;
                    break;
                }
            }
        }

        const isComplete =
            (completionEntry.varpId >= 0 && currentValue >= completionEntry.completionValue) ||
            (completionEntry.varpId < 0 && allVarbitsComplete);

        if (isComplete) {
            return [
                "<str>I have completed this quest.",
                "",
                "<col=ff0000>QUEST COMPLETE!",
            ];
        }
    }

    // Not started (default state)
    return [
        "I should read the quest overview for",
        "more information on how to start",
        "this quest.",
    ];
}

// ============================================================================
// Known quest completion data (mirrors QUEST_DATA from MessageHandlers.ts)
// Maps lowercase display name → varp/varbit completion info
// ============================================================================

interface QuestCompletionInfo {
    varpId: number;
    completionValue: number;
    varbitEntries?: Array<{ varbitId: number; value: number }>;
}

const QUEST_COMPLETION_DATA = new Map<string, QuestCompletionInfo>([
    ["desert treasure", { varpId: 440, completionValue: 15 }],
    ["lunar diplomacy", { varpId: 823, completionValue: 190 }],
    ["legend's quest", { varpId: 139, completionValue: 180 }],
    ["underground pass", { varpId: 161, completionValue: 110 }],
    ["mage arena", { varpId: 267, completionValue: 8 }],
    [
        "mage arena ii",
        { varpId: -1, completionValue: 0, varbitEntries: [{ varbitId: 6067, value: 6 }] },
    ],
    ["eadgar's ruse", { varpId: 335, completionValue: 110 }],
    ["watchtower", { varpId: 212, completionValue: 13 }],
    ["plague city", { varpId: 165, completionValue: 29 }],
    ["biohazard", { varpId: 68, completionValue: 16 }],
    [
        "client of kourend",
        { varpId: -1, completionValue: 0, varbitEntries: [{ varbitId: 5619, value: 9 }] },
    ],
    [
        "dream mentor",
        { varpId: -1, completionValue: 0, varbitEntries: [{ varbitId: 3618, value: 28 }] },
    ],
    // Free quests with known varps from quest_progress_get
    ["cook's assistant", { varpId: 29, completionValue: 2 }],
    ["demon slayer", { varpId: 2561, completionValue: 3 }],
    ["doric's quest", { varpId: 31, completionValue: 100 }],
    ["dragon slayer i", { varpId: 176, completionValue: 10 }],
    ["ernest the chicken", { varpId: 32, completionValue: 3 }],
    ["goblin diplomacy", { varpId: 2378, completionValue: 6 }],
    ["imp catcher", { varpId: 160, completionValue: 2 }],
    ["the knight's sword", { varpId: 122, completionValue: 7 }],
    ["pirate's treasure", { varpId: 71, completionValue: 4 }],
    ["prince ali rescue", { varpId: 273, completionValue: 110 }],
    ["the restless ghost", { varpId: 107, completionValue: 5 }],
    ["romeo & juliet", { varpId: 144, completionValue: 100 }],
    ["rune mysteries", { varpId: 63, completionValue: 6 }],
    ["sheep shearer", { varpId: 179, completionValue: 21 }],
    ["shield of arrav", { varpId: 145, completionValue: 7 }],
    ["vampyre slayer", { varpId: 178, completionValue: 3 }],
    ["witch's potion", { varpId: 67, completionValue: 3 }],
    ["black knights' fortress", { varpId: 130, completionValue: 4 }],
    [
        "pandemonium",
        { varpId: -1, completionValue: 0, varbitEntries: [{ varbitId: 18314, value: 6 }] },
    ],
]);

// ============================================================================
// Module
// ============================================================================

export function registerQuestJournalWidgetHandlers(registry: IScriptRegistry, services: ScriptServices): void {
    // Lazy-loaded quest map: the DbRepository is not available at module registration
    // time (scripts bootstrap before cache DB is initialized). Build on first click.
    let questMap: Map<number, QuestEntry> | undefined;

    const getQuestMap = (): Map<number, QuestEntry> => {
        if (!questMap) {
            questMap = buildQuestMap(services);
        }
        return questMap;
    };

    // Handle quest list clicks (399:7)
    // Dynamic children use the quest ID as their child index.
    // The slot value in the widget action corresponds to this quest ID.
    registry.onButton(QUEST_LIST_GROUP_ID, QUEST_LIST_COMPONENT, (event) => {
        const { player, slot, opId } = event;

        if (opId !== OP_READ_JOURNAL) return;

        const questId = slot;
        if (questId === undefined || questId <= 0) return;

        const quest = getQuestMap().get(questId);
        if (!quest) {
            services.logger?.info?.(
                `[quest-journal] No quest found for slot=${questId}`,
            );
            return;
        }

        openQuestJournal(player, quest, services);
    });

    // Handle quest journal Close button (119:8)
    registry.onButton(QUEST_JOURNAL_GROUP_ID, QJ_CLOSE_CHILD, (event) => {
        const floaterUid = BaseComponentUids.FLOATER_OVERLAY;
        services.closeSubInterface?.(event.player, floaterUid, QUEST_JOURNAL_GROUP_ID);
    });

    // Handle quest journal Switch View button (119:9)
    // Toggles between journal text and quest overview
    registry.onButton(QUEST_JOURNAL_GROUP_ID, QJ_SWITCH_VIEW_CHILD, (event) => {
        const { player } = event;
        const dbrowId = player.varps.getVarpValue(VARP_LATEST_QUEST_JOURNAL);
        if (dbrowId <= 0) return;

        // Look up quest name from the map for the overview title
        const map = getQuestMap();
        let questName = "Quest";
        for (const entry of map.values()) {
            if (entry.dbrowId === dbrowId) {
                questName = entry.displayName;
                break;
            }
        }

        // Re-open journal with overview text
        const floaterUid = BaseComponentUids.FLOATER_OVERLAY;
        services.openSubInterface?.(player, floaterUid, QUEST_JOURNAL_GROUP_ID, 0);

        services.queueWidgetEvent?.(player.id, {
            action: "run_script",
            scriptId: SCRIPT_QUEST_JOURNAL_RESET,
            args: [],
        });

        const titleUid = (QUEST_JOURNAL_GROUP_ID << 16) | QJ_TITLE_CHILD;
        services.queueWidgetEvent?.(player.id, {
            action: "set_text",
            uid: titleUid,
            text: `<col=7f0000>${questName}</col>`,
        });

        const lineUid = (QUEST_JOURNAL_GROUP_ID << 16) | QJ_FIRST_LINE_CHILD;
        services.queueWidgetEvent?.(player.id, {
            action: "set_text",
            uid: lineUid,
            text: "Quest overview not yet available.",
        });

        services.queueWidgetEvent?.(player.id, {
            action: "run_script",
            scriptId: SCRIPT_QUEST_JOURNAL_SCROLL,
            args: [0, 1],
        });
    });
}

// ============================================================================
// Quest journal opening
// ============================================================================

/**
 * Open the quest journal overlay for a specific quest.
 *
 * Client parity note: Unlike OSRS where widget state persists across open/close,
 * this client only resolves set_text for widgets that are currently loaded.
 * Therefore we must open the interface FIRST, then set text and run scripts.
 *
 * Flow:
 * 1. Set varps (latest_quest_journal, qj_lines)
 * 2. Open interface 119 as overlay (loads widgets)
 * 3. Run quest_journal_reset to clear stale text
 * 4. Set title and journal line text
 * 5. Run scroll configuration script
 */
function openQuestJournal(
    player: PlayerState,
    quest: QuestEntry,
    services: ScriptServices,
): void {
    const lines = buildJournalLines(player, quest);
    const lineCount = lines.length;
    const playerId = player.id;

    // 1. Set varps (sent before widget events in broadcast order)
    player.varps.setVarpValue(VARP_LATEST_QUEST_JOURNAL, quest.dbrowId);
    services.sendVarp?.(player, VARP_LATEST_QUEST_JOURNAL, quest.dbrowId);
    player.varps.setVarpValue(VARP_QJ_LINES, lineCount);
    services.sendVarp?.(player, VARP_QJ_LINES, lineCount);

    // 2. Open quest journal interface on the floater container.
    // Use type=0 (modal) so PlayerWidgetManager tracks it and closeInterruptibleInterfaces
    // closes it on walk/interaction, matching OSRS behavior where the journal dismisses on move.
    const floaterUid = BaseComponentUids.FLOATER_OVERLAY;
    services.openSubInterface?.(player, floaterUid, QUEST_JOURNAL_GROUP_ID, 0);

    // 2b. Enable transmit flags on Close (119:8) and Switch View (119:9) buttons.
    // Static widgets use fromSlot=-1, toSlot=-1.
    const OP1_TRANSMIT = 1 << 1; // transmit op1
    for (const childId of [QJ_CLOSE_CHILD, QJ_SWITCH_VIEW_CHILD]) {
        services.queueWidgetEvent?.(playerId, {
            action: "set_flags_range",
            uid: (QUEST_JOURNAL_GROUP_ID << 16) | childId,
            fromSlot: -1,
            toSlot: -1,
            flags: OP1_TRANSMIT,
        });
    }

    // 3. Clear stale journal line text
    services.queueWidgetEvent?.(playerId, {
        action: "run_script",
        scriptId: SCRIPT_QUEST_JOURNAL_RESET,
        args: [],
    });

    // 4. Set title text
    const titleUid = (QUEST_JOURNAL_GROUP_ID << 16) | QJ_TITLE_CHILD;
    services.queueWidgetEvent?.(playerId, {
        action: "set_text",
        uid: titleUid,
        text: `<col=7f0000>${quest.displayName}</col>`,
    });

    // 5. Set journal line text
    for (let i = 0; i < lineCount; i++) {
        const lineUid = (QUEST_JOURNAL_GROUP_ID << 16) | (QJ_FIRST_LINE_CHILD + i);
        services.queueWidgetEvent?.(playerId, {
            action: "set_text",
            uid: lineUid,
            text: lines[i],
        });
    }

    // 6. Run scroll configuration script
    services.queueWidgetEvent?.(playerId, {
        action: "run_script",
        scriptId: SCRIPT_QUEST_JOURNAL_SCROLL,
        args: [0, lineCount],
    });

    services.logger?.info?.(
        `[quest-journal] Opened journal for player=${playerId} quest="${quest.displayName}" (id=${quest.questId}, dbrow=${quest.dbrowId}) lines=${lineCount}`,
    );
}
