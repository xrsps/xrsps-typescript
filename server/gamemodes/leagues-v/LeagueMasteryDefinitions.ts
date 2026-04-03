import { EnumType } from "../../../src/rs/config/enumtype/EnumType";
import { StructType } from "../../../src/rs/config/structtype/StructType";

export type LeagueMasteryDefinition = {
    masteryId: number;
    name: string;
    description?: string;
    tier: number;
    category: number; // 0=melee, 1=ranged, 2=magic
    unlockVarbitIndex: number;
    structId?: number;
    parentMasteryId?: number;
    pointsCost?: number;
};

export type LeagueMasteryJsonRow = {
    masteryId: number;
    name: string;
    description?: string;
    tier: number;
    category: number;
    unlockVarbitIndex: number;
    structId?: number;
    parentMasteryId?: number;
    pointsCost?: number;
};

// Common struct param IDs (used for tooltip text)
const PARAM_NAME = 874; // Same as league tasks - common pattern for name
const PARAM_DESCRIPTION = 875; // Same as league tasks - common pattern for description

// Mastery-specific params (to be determined from cache exploration)
const PARAM_MASTERY_TIER = 2044; // Tier param (same pattern as relics/tasks)
const PARAM_MASTERY_CATEGORY = 1016; // Category (melee/ranged/magic)
const PARAM_MASTERY_COST = 877; // Points cost
const PARAM_MASTERY_PARENT = 2045; // Parent mastery struct

// Enum that maps league type to mastery enum
const ENUM_LEAGUE_TYPE_TO_MASTERY = 2670; // Same root enum as tasks/relics
const PARAM_MASTERY_ENUM = 879; // Param in league struct pointing to mastery enum (to verify)

function getIntParam(struct: StructType | undefined, key: number, fallback: number): number {
    const raw = struct?.params?.get(key) as number | undefined;
    return raw ?? fallback;
}

function getStringParam(struct: StructType | undefined, key: number, fallback: string): string {
    const raw = struct?.params?.get(key) as string | undefined;
    return raw ?? fallback;
}

export class LeagueMasteryDefinitions {
    private byMasteryId = new Map<number, LeagueMasteryDefinition>();

    size(): number {
        return this.byMasteryId.size;
    }

    get(masteryId: number): LeagueMasteryDefinition | undefined {
        return this.byMasteryId.get(masteryId);
    }

    add(def: LeagueMasteryDefinition): void {
        this.byMasteryId.set(def.masteryId, def);
    }

    toJsonRows(): LeagueMasteryJsonRow[] {
        const rows: LeagueMasteryJsonRow[] = [];
        for (const def of this.byMasteryId.values()) {
            rows.push({
                masteryId: def.masteryId,
                name: def.name,
                description: def.description,
                tier: def.tier,
                category: def.category,
                unlockVarbitIndex: def.unlockVarbitIndex,
                structId: def.structId,
                parentMasteryId: def.parentMasteryId,
                pointsCost: def.pointsCost,
            });
        }
        rows.sort((a, b) => a.masteryId - b.masteryId);
        return rows;
    }

    static fromJsonRows(rows: unknown): LeagueMasteryDefinitions {
        const defs = new LeagueMasteryDefinitions();
        if (!Array.isArray(rows)) return defs;
        for (const row of rows) {
            const r = row as Partial<LeagueMasteryJsonRow>;
            const masteryId = r.masteryId ?? -1;
            if (!(masteryId >= 0)) continue;
            const name = r.name ?? `Mastery ${masteryId}`;
            const description = r.description;
            const tier = r.tier ?? 0;
            const category = r.category ?? 0;
            const unlockVarbitIndex = r.unlockVarbitIndex ?? 0;
            if (defs.byMasteryId.has(masteryId)) continue;
            defs.byMasteryId.set(masteryId, {
                masteryId,
                name,
                description,
                tier,
                category,
                unlockVarbitIndex,
                structId: r.structId,
                parentMasteryId: r.parentMasteryId,
                pointsCost: r.pointsCost,
            });
        }
        return defs;
    }

    /**
     * Explores the cache to find mastery data by examining structs with name/description params.
     * The mastery system stores data in structs that are referenced from the league struct.
     */
    static fromCache(enumTypeLoader: any, structTypeLoader: any): LeagueMasteryDefinitions {
        const defs = new LeagueMasteryDefinitions();

        // Try to find mastery structs by exploring from the league type enum
        const leagueTypeEnum: EnumType | undefined = enumTypeLoader?.load?.(
            ENUM_LEAGUE_TYPE_TO_MASTERY,
        );
        if (!leagueTypeEnum) {
            console.log("[mastery] Could not load league type enum");
            return defs;
        }

        const leagueStructIds = leagueTypeEnum?.intValues ?? [];
        console.log(`[mastery] Found ${leagueStructIds.length} league structs to explore`);

        // Explore each league struct to find mastery-related params
        for (const leagueStructId of leagueStructIds) {
            if (leagueStructId < 0) continue;
            const leagueStruct: StructType | undefined = structTypeLoader?.load?.(leagueStructId);
            if (!leagueStruct?.params) continue;

            console.log(`[mastery] Exploring league struct ${leagueStructId}`);

            // Log all params in the struct to help identify mastery-related ones
            for (const [paramId, value] of leagueStruct.params.entries()) {
                if (Number.isFinite(value as number) && (value as number) > 0 && (value as number) < 100000) {
                    // This might be an enum or struct reference
                    console.log(`  param_${paramId} = ${value} (potential enum/struct ref)`);
                }
            }
        }

        // Also try exploring structs directly in a range that might contain masteries
        // Based on the relic system, mastery structs might be in a similar range
        console.log("[mastery] Exploring struct range for mastery data...");

        let masteryId = 0;
        // Search for structs that have both a name and description param (tooltip pattern)
        for (let structId = 5000; structId < 10000; structId++) {
            const struct: StructType | undefined = structTypeLoader?.load?.(structId);
            if (!struct?.params) continue;

            const name = getStringParam(struct, PARAM_NAME, "");
            const desc = getStringParam(struct, PARAM_DESCRIPTION, "");

            // Look for structs that might be mastery nodes (have name containing mastery-related words)
            if (
                name &&
                (name.toLowerCase().includes("mastery") ||
                    name.toLowerCase().includes("melee") ||
                    name.toLowerCase().includes("ranged") ||
                    name.toLowerCase().includes("magic") ||
                    name.toLowerCase().includes("combat"))
            ) {
                console.log(`[mastery] Potential mastery struct ${structId}: "${name}"`);

                const tier = getIntParam(struct, PARAM_MASTERY_TIER, 0);
                const category = getIntParam(struct, PARAM_MASTERY_CATEGORY, 0);
                const cost = getIntParam(struct, PARAM_MASTERY_COST, 0);

                defs.add({
                    masteryId: masteryId++,
                    name,
                    description: desc || undefined,
                    tier,
                    category,
                    unlockVarbitIndex: masteryId, // Will need proper mapping
                    structId,
                    pointsCost: cost > 0 ? cost : undefined,
                });
            }
        }

        console.log(`[mastery] Found ${defs.size()} potential mastery definitions`);
        return defs;
    }
}
