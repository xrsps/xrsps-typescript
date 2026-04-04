import type {
    LeagueMasteryChallengeRow,
    LeagueMasteryNodeRow,
    LeagueRelicRow,
    LeagueTaskRow,
} from "./GamemodeDataTypes";

let tasksByStructId: Map<number, LeagueTaskRow> | null = null;
let tasksByTaskId: Map<number, LeagueTaskRow> | null = null;
let relicsByStructId: Map<number, LeagueRelicRow> | null = null;
let masteryNodesByStructId: Map<number, LeagueMasteryNodeRow> | null = null;
let masteryChallengesByStructId: Map<number, LeagueMasteryChallengeRow> | null = null;

let customTasksByStructId: Map<number, any> | null = null;
let customTasksByTaskId: Map<number, any> | null = null;
let customChallengesByStructId: Map<number, any> | null = null;
let customEnumOverrides: Map<number, any[]> | null = null;

let dynamicWidgetGroups: Map<number, { root: any; widgets: Map<number, any> }> | null = null;

let ready = false;

export function isReady(): boolean {
    return ready;
}

export function loadFromPayload(payload: {
    gamemodeId: string;
    datasets: Array<{ key: string; rows: unknown[] }>;
}): void {
    for (const dataset of payload.datasets) {
        switch (dataset.key) {
            case "leagueTasks":
                tasksByStructId = new Map();
                tasksByTaskId = new Map();
                for (const row of dataset.rows as LeagueTaskRow[]) {
                    const taskId = row.taskId | 0;
                    if (taskId >= 0) tasksByTaskId.set(taskId, row);
                    const structId = typeof row.structId === "number" ? row.structId | 0 : -1;
                    if (structId >= 0) tasksByStructId.set(structId, row);
                }
                break;
            case "leagueRelics":
                relicsByStructId = new Map();
                for (const row of dataset.rows as LeagueRelicRow[]) {
                    relicsByStructId.set(row.structId | 0, row);
                }
                break;
            case "leagueMasteryNodes":
                masteryNodesByStructId = new Map();
                for (const row of dataset.rows as LeagueMasteryNodeRow[]) {
                    masteryNodesByStructId.set(row.structId | 0, row);
                }
                break;
            case "leagueMasteryChallenges":
                masteryChallengesByStructId = new Map();
                for (const row of dataset.rows as LeagueMasteryChallengeRow[]) {
                    masteryChallengesByStructId.set(row.structId | 0, row);
                }
                break;
            case "customTasks":
                customTasksByStructId = new Map();
                customTasksByTaskId = new Map();
                customEnumOverrides = new Map();
                for (const row of dataset.rows as any[]) {
                    if (row.structId != null) customTasksByStructId.set(row.structId | 0, row);
                    if (row.taskId != null) customTasksByTaskId.set(row.taskId | 0, row);
                    if (row.enumGroupId != null) {
                        const group = customEnumOverrides.get(row.enumGroupId) ?? [];
                        group.push(row);
                        customEnumOverrides.set(row.enumGroupId, group);
                    }
                }
                break;
            case "customChallenges":
                customChallengesByStructId = new Map();
                for (const row of dataset.rows as any[]) {
                    if (row.structId != null) customChallengesByStructId.set(row.structId | 0, row);
                }
                break;
            case "customWidgets":
                try {
                    dynamicWidgetGroups = new Map();
                    for (const group of dataset.rows as any[]) {
                        if (!group?.groupId || !Array.isArray(group.widgets)) continue;
                        const widgets = new Map<number, any>();
                        let root: any = undefined;
                        for (const w of group.widgets) {
                            if (w.uid != null) widgets.set(w.uid, w);
                            if (w.parentUid === -1 || w.parentUid === undefined) root = w;
                        }
                        dynamicWidgetGroups.set(group.groupId | 0, { root, widgets });
                    }
                    console.log(`[GamemodeContentStore] registered ${dynamicWidgetGroups.size} custom widget group(s)`);
                } catch (err) {
                    console.log("[GamemodeContentStore] failed to load custom widgets", err);
                }
                break;
            case "customItems":
                try {
                    const { CustomItemRegistry } = require("../../custom/items/CustomItemRegistry");
                    const { CustomItemBuilder } = require("../../custom/items/CustomItemBuilder");
                    CustomItemRegistry.clear();
                    for (const def of dataset.rows as any[]) {
                        if (!def || !def.id) continue;
                        if (def.baseItemId != null) {
                            const builder = CustomItemBuilder.create(def.id).basedOn(def.baseItemId);
                            if (def.objType?.name) builder.name(def.objType.name);
                            if (def.objType?.recolorFrom && def.objType?.recolorTo) {
                                builder.recolor(def.objType.recolorFrom, def.objType.recolorTo);
                            }
                            if (def.objType?.inventoryActions) {
                                builder.inventoryActions(...def.objType.inventoryActions);
                            }
                            CustomItemRegistry.register(builder.build(), def.objType?.name);
                        } else {
                            CustomItemRegistry.register(def, def.objType?.name);
                        }
                    }
                    console.log(`[GamemodeContentStore] registered ${dataset.rows.length} custom item(s)`);
                } catch (err) {
                    console.log("[GamemodeContentStore] failed to register custom items", err);
                }
                break;
        }
    }
    ready = true;
    console.log(
        `[GamemodeContentStore] loaded: ${tasksByTaskId?.size ?? 0} tasks, ${relicsByStructId?.size ?? 0} relics, ${masteryNodesByStructId?.size ?? 0} mastery nodes, ${customTasksByStructId?.size ?? 0} custom tasks`,
    );
}

export function getLeagueTaskStructParam(
    structId: number,
    paramId: number,
): number | string | undefined {
    const row = tasksByStructId?.get(structId | 0);
    if (!row) return undefined;
    const pid = paramId | 0;
    switch (pid) {
        case 873: return row.taskId | 0;
        case 874: return row.name ?? "";
        case 875: return row.description ?? "";
        case 1016: return typeof row.category === "number" ? row.category | 0 : 0;
        case 1017: return typeof row.area === "number" ? row.area | 0 : 0;
        case 1018: return typeof row.skill === "number" ? row.skill | 0 : 0;
        case 2044: case 1849: case 1850: case 1851: case 1852:
            return row.tier | 0;
        default: return undefined;
    }
}

export function getRelicOrMasteryStructParam(
    structId: number,
    paramId: number,
): number | string | undefined {
    const relic = relicsByStructId?.get(structId | 0);
    if (relic) {
        const pid = paramId | 0;
        switch (pid) {
            case 879: return relic.name ?? "";
            case 880: return relic.description ?? "";
            case 1855: return relic.hasItem ? 1 : 0;
            default: return undefined;
        }
    }
    const node = masteryNodesByStructId?.get(structId | 0);
    if (node) {
        const pid = paramId | 0;
        switch (pid) {
            case 2026: return node.name ?? "";
            case 2027: return node.category ?? 0;
            case 2028: return node.description ?? "";
            default: return undefined;
        }
    }
    const challenge = masteryChallengesByStructId?.get(structId | 0);
    if (challenge) {
        const pid = paramId | 0;
        switch (pid) {
            case 2028: return challenge.description ?? "";
            default: return undefined;
        }
    }
    return undefined;
}

export function getCustomStructParam(
    structId: number,
    paramId: number,
): number | string | undefined {
    const task = customTasksByStructId?.get(structId | 0);
    if (task?.params) {
        const val = task.params[paramId];
        if (val !== undefined) return val;
    }
    const challenge = customChallengesByStructId?.get(structId | 0);
    if (challenge?.params) {
        const val = challenge.params[paramId];
        if (val !== undefined) return val;
    }
    return undefined;
}

export function getCustomEnumCountOverride(enumId: number): number {
    const tasks = customEnumOverrides?.get(enumId);
    return tasks?.length ?? 0;
}

export function getCustomEnumValueOverride(
    enumId: number,
    key: number,
    baseCount: number,
): { custom: number } | { shiftedKey: number } | undefined {
    const customCount = customEnumOverrides?.get(enumId)?.length ?? 0;
    if (customCount === 0) return undefined;
    const tasks = customEnumOverrides!.get(enumId)!;
    if (key < customCount) {
        return { custom: tasks[key].structId };
    }
    return { shiftedKey: key - customCount };
}

export function getDynamicWidgetGroup(
    groupId: number,
): { root: any; widgets: Map<number, any> } | undefined {
    return dynamicWidgetGroups?.get(groupId | 0);
}
