import { EnumType } from "../../../src/rs/config/enumtype/EnumType";
import { StructType } from "../../../src/rs/config/structtype/StructType";

export type LeagueTaskDefinition = {
    taskId: number;
    name: string;
    description?: string;
    tier: number;
    points: number;
    category?: number;
    area?: number;
    skill?: number;
    structId?: number;
    leagueStructId?: number;
};

export type LeagueTasksJsonRow = {
    taskId: number;
    name: string;
    description?: string;
    tier: number;
    points: number;
    category?: number;
    area?: number;
    skill?: number;
    structId?: number;
    leagueStructId?: number;
};

const PARAM_LEAGUE_TASK_ID = 873;
const PARAM_LEAGUE_TASK_NAME = 874;
const PARAM_LEAGUE_TASK_DESCRIPTION = 875;
const PARAM_LEAGUE_TASK_CATEGORY = 1016;
const PARAM_LEAGUE_TASK_AREA = 1017;
const PARAM_LEAGUE_TASK_SKILL = 1018;

// Used by `league_tasks_draw_list` to fetch tier -> points: enum_2671
const ENUM_LEAGUE_TIER_TO_POINTS = 2671;

// Used by `league_tasks_draw_list` to resolve league_type -> struct -> tasks enum: enum_2670
const ENUM_LEAGUE_TYPE_TO_STRUCT = 2670;

// Param IDs used by `league_tasks_draw_list` / `script2448`:
// - 868: enum id for the tasks list (enum(int, struct, ..., idx))
// - 2044: task tier (mapped through enum_2671)
const PARAM_LEAGUE_TASKS_ENUM = 868;
const PARAM_LEAGUE_TASK_TIER = 2044;
const PARAM_LEAGUE_TASK_TIER_TWISTED = 1849;
const PARAM_LEAGUE_TASK_TIER_TRAILBLAZER = 1850;
const PARAM_LEAGUE_TASK_TIER_SHATTERED = 1851;
const PARAM_LEAGUE_TASK_TIER_TRAILBLAZER_RELOADED = 1852;

function getIntParam(struct: StructType | undefined, key: number, fallback: number): number {
    const raw = struct?.params?.get(key) as number | undefined;
    return raw ?? fallback;
}

function getStringParam(struct: StructType | undefined, key: number, fallback: string): string {
    const raw = struct?.params?.get(key) as string | undefined;
    return raw ?? fallback;
}

function getTaskTier(struct: StructType | undefined): number {
    const tier = getIntParam(struct, PARAM_LEAGUE_TASK_TIER, -1);
    if (tier >= 0) return tier;
    const twisted = getIntParam(struct, PARAM_LEAGUE_TASK_TIER_TWISTED, -1);
    if (twisted >= 0) return twisted;
    const trailblazer = getIntParam(struct, PARAM_LEAGUE_TASK_TIER_TRAILBLAZER, -1);
    if (trailblazer >= 0) return trailblazer;
    const shattered = getIntParam(struct, PARAM_LEAGUE_TASK_TIER_SHATTERED, -1);
    if (shattered >= 0) return shattered;
    const reloaded = getIntParam(struct, PARAM_LEAGUE_TASK_TIER_TRAILBLAZER_RELOADED, -1);
    if (reloaded >= 0) return reloaded;
    return 0;
}

function buildIntEnumLookup(enumType: EnumType | undefined): Map<number, number> {
    const map = new Map<number, number>();
    const keys = enumType?.keys;
    const values = enumType?.intValues;
    if (!keys || !values) return map;
    for (let i = 0; i < keys.length && i < values.length; i++) {
        map.set(keys[i], values[i]);
    }
    return map;
}

export class LeagueTaskDefinitions {
    private byTaskId = new Map<number, LeagueTaskDefinition>();

    size(): number {
        return this.byTaskId.size;
    }

    get(taskId: number): LeagueTaskDefinition | undefined {
        return this.byTaskId.get(taskId);
    }

    toJsonRows(): LeagueTasksJsonRow[] {
        const rows: LeagueTasksJsonRow[] = [];
        for (const def of this.byTaskId.values()) {
            rows.push({
                taskId: def.taskId,
                name: def.name,
                description: def.description,
                tier: def.tier,
                points: def.points,
                category: def.category,
                area: def.area,
                skill: def.skill,
                structId: def.structId,
                leagueStructId: def.leagueStructId,
            });
        }
        rows.sort((a, b) => a.taskId - b.taskId);
        return rows;
    }

    static fromJsonRows(rows: unknown): LeagueTaskDefinitions {
        const defs = new LeagueTaskDefinitions();
        if (!Array.isArray(rows)) return defs;
        for (const row of rows) {
            const r = row as Partial<LeagueTasksJsonRow>;
            const taskId = r.taskId ?? -1;
            if (!(taskId >= 0)) continue;
            const name = r.name ?? `Task ${taskId}`;
            const description = r.description;
            const tier = r.tier ?? 0;
            const points = r.points ?? 0;
            if (defs.byTaskId.has(taskId)) continue;
            defs.byTaskId.set(taskId, {
                taskId,
                name,
                description,
                tier,
                points,
                category: r.category,
                area: r.area,
                skill: r.skill,
                structId: r.structId,
                leagueStructId: r.leagueStructId,
            });
        }
        return defs;
    }

    /**
     * Builds a taskId -> definition map from cache enums/structs, matching CS2 usage:
     * - enum_2670: league_type -> league struct
     * - struct param_868: enum id containing tasks (struct ids)
     * - struct param 873/874/2044: id, name, tier
     * - enum_2671: tier -> points
     */
    static fromCache(enumTypeLoader: any, structTypeLoader: any): LeagueTaskDefinitions {
        const defs = new LeagueTaskDefinitions();

        const tierToPoints = buildIntEnumLookup(enumTypeLoader?.load?.(ENUM_LEAGUE_TIER_TO_POINTS));

        const leagueTypeEnum: EnumType | undefined = enumTypeLoader?.load?.(
            ENUM_LEAGUE_TYPE_TO_STRUCT,
        );
        const leagueStructIds = leagueTypeEnum?.intValues ?? [];

        for (const structIdRaw of leagueStructIds) {
            const structId = structIdRaw;
            if (structId < 0) continue;

            const leagueStruct: StructType | undefined = structTypeLoader?.load?.(structId);
            const tasksEnumId = getIntParam(leagueStruct, PARAM_LEAGUE_TASKS_ENUM, -1);
            if (tasksEnumId < 0) continue;

            const tasksEnum: EnumType | undefined = enumTypeLoader?.load?.(tasksEnumId);
            const taskStructIds = tasksEnum?.intValues ?? [];
            for (const taskStructIdRaw of taskStructIds) {
                const taskStructId = taskStructIdRaw;
                if (taskStructId < 0) continue;

                const taskStruct: StructType | undefined = structTypeLoader?.load?.(taskStructId);
                const taskId = getIntParam(taskStruct, PARAM_LEAGUE_TASK_ID, -1);
                if (taskId < 0) continue;
                if (defs.byTaskId.has(taskId)) continue;

                const tier = getTaskTier(taskStruct);
                const points = tierToPoints.get(tier) ?? 0;
                const name = getStringParam(taskStruct, PARAM_LEAGUE_TASK_NAME, `Task ${taskId}`);
                const description = getStringParam(taskStruct, PARAM_LEAGUE_TASK_DESCRIPTION, "");
                const category = getIntParam(taskStruct, PARAM_LEAGUE_TASK_CATEGORY, -1);
                const area = getIntParam(taskStruct, PARAM_LEAGUE_TASK_AREA, -1);
                const skill = getIntParam(taskStruct, PARAM_LEAGUE_TASK_SKILL, -1);

                defs.byTaskId.set(taskId, {
                    taskId,
                    name,
                    description: description.length > 0 ? description : undefined,
                    tier,
                    points,
                    category: category >= 0 ? category : undefined,
                    area: area >= 0 ? area : undefined,
                    skill: skill >= 0 ? skill : undefined,
                    structId: taskStructId,
                    leagueStructId: structId,
                });
            }
        }

        return defs;
    }
}
