import fs from "fs";
import path from "path";
import {
    PROJECTILE_ARCHETYPES,
    type ProjectileArchetypeName,
    type ProjectileAliasTarget,
    type ProjectileParams,
    type ProjectileParamsProvider,
    type ProjectileTarget,
} from "../../../src/game/data/ProjectileParamsProvider";

const DEFAULT_PROJECTILE_PARAMS: ProjectileParams = {
    startHeight: 43,
    endHeight: 31,
    slope: 16,
    startDelay: 0,
    steepness: 0,
};

function buildProjectileParamsFromArchetype(
    archetype: ProjectileArchetypeName,
    overrides: Partial<ProjectileParams> = {},
): ProjectileParams {
    const preset = PROJECTILE_ARCHETYPES[archetype];
    const delayFrames = overrides.delayFrames ?? preset.delayFrames;
    const startDelay =
        overrides.startDelay ??
        (delayFrames === undefined ? DEFAULT_PROJECTILE_PARAMS.startDelay : undefined);
    return {
        startHeight: overrides.startHeight ?? preset.startHeight,
        endHeight: overrides.endHeight ?? preset.endHeight,
        slope: overrides.slope ?? preset.angle,
        startDelay,
        travelTime: overrides.travelTime ?? undefined,
        steepness: overrides.steepness ?? preset.steepness,
        delayFrames,
        lifeModel: preset.lifeModel,
        ticksPerTile: overrides.ticksPerTile,
    };
}

const PROJECTILE_PARAMS: Record<number, ProjectileParams> = {
    // Standard spellbook
    91: buildProjectileParamsFromArchetype("MAGIC", { endHeight: 31 }),
    94: buildProjectileParamsFromArchetype("MAGIC"),
    97: buildProjectileParamsFromArchetype("MAGIC"),
    100: buildProjectileParamsFromArchetype("MAGIC"),
    118: buildProjectileParamsFromArchetype("MAGIC"),
    121: buildProjectileParamsFromArchetype("MAGIC"),
    124: buildProjectileParamsFromArchetype("MAGIC"),
    127: buildProjectileParamsFromArchetype("MAGIC"),
    133: buildProjectileParamsFromArchetype("MAGIC"),
    136: buildProjectileParamsFromArchetype("MAGIC"),
    139: buildProjectileParamsFromArchetype("MAGIC"),
    130: buildProjectileParamsFromArchetype("MAGIC"),
    159: buildProjectileParamsFromArchetype("MAGIC"),
    162: buildProjectileParamsFromArchetype("MAGIC"),
    165: buildProjectileParamsFromArchetype("MAGIC"),
    156: buildProjectileParamsFromArchetype("MAGIC"),

    // God spells / others
    344: buildProjectileParamsFromArchetype("MAGIC"),
    155: buildProjectileParamsFromArchetype("MAGIC"),
    157: buildProjectileParamsFromArchetype("MAGIC"),
    327: buildProjectileParamsFromArchetype("MAGIC"),
    328: buildProjectileParamsFromArchetype("MAGIC"),
    329: buildProjectileParamsFromArchetype("MAGIC"),

    // Ancient spellbook projectiles
    384: buildProjectileParamsFromArchetype("MAGIC", { slope: 32 }),
    378: buildProjectileParamsFromArchetype("MAGIC", { slope: 32 }),
    372: buildProjectileParamsFromArchetype("MAGIC", { slope: 32 }),
    373: buildProjectileParamsFromArchetype("MAGIC", { slope: 32 }),
    360: buildProjectileParamsFromArchetype("MAGIC", { slope: 32 }),
    389: buildProjectileParamsFromArchetype("MAGIC", { slope: 32 }),
    382: buildProjectileParamsFromArchetype("MAGIC", { slope: 32 }),
    376: buildProjectileParamsFromArchetype("MAGIC", { slope: 32 }),
    363: buildProjectileParamsFromArchetype("MAGIC", { slope: 32 }),
    386: buildProjectileParamsFromArchetype("MAGIC", { slope: 32 }),
    380: buildProjectileParamsFromArchetype("MAGIC", { slope: 32 }),
    374: buildProjectileParamsFromArchetype("MAGIC", { slope: 32 }),
    366: buildProjectileParamsFromArchetype("MAGIC", { slope: 32 }),
    391: buildProjectileParamsFromArchetype("MAGIC", { slope: 32 }),
    383: buildProjectileParamsFromArchetype("MAGIC", { slope: 32 }),
    377: buildProjectileParamsFromArchetype("MAGIC", { slope: 32 }),
    369: buildProjectileParamsFromArchetype("MAGIC", { slope: 32 }),

    // Powered staff projectiles
    1252: buildProjectileParamsFromArchetype("MAGIC", { startHeight: 36, endHeight: 31, slope: 0 }),
    1539: buildProjectileParamsFromArchetype("MAGIC", { startHeight: 36, endHeight: 31, slope: 0 }),
    2126: buildProjectileParamsFromArchetype("MAGIC", { startHeight: 36, endHeight: 31, slope: 0 }),

    // Ranged weapon specials / unique projectiles
    1099: buildProjectileParamsFromArchetype("ARROW", { startHeight: 60, slope: 35 }),
    1101: buildProjectileParamsFromArchetype("ARROW", { startHeight: 60, slope: 35 }),
    1166: buildProjectileParamsFromArchetype("THROWN", { startHeight: 25, endHeight: 27 }),
};

// Load overrides from JSON at startup
try {
    const envPath = (process?.env?.PROJECTILE_PARAMS_FILE ?? "").toString();
    const defaultPath = path.resolve("server/data/projectile-params.json");
    const filePath = envPath || defaultPath;
    if (fs.existsSync(filePath)) {
        const text = fs.readFileSync(filePath, "utf8");
        const json = JSON.parse(text) as Record<string, Partial<ProjectileParams>>;
        if (json && Object(json) === json && !Array.isArray(json)) {
            for (const [k, v] of Object.entries(json)) {
                const id = parseInt(k, 10);
                if (!(id > 0)) continue;
                const src = PROJECTILE_PARAMS[id] ?? { ...DEFAULT_PROJECTILE_PARAMS };
                const next: ProjectileParams = { ...src };
                if (v && Object(v) === v && !Array.isArray(v)) {
                    if (v.startHeight !== undefined) next.startHeight = v.startHeight;
                    if (v.endHeight !== undefined) next.endHeight = v.endHeight;
                    if (v.slope !== undefined) next.slope = v.slope;
                    if (v.startDelay !== undefined) next.startDelay = v.startDelay;
                    if (v.travelTime !== undefined) next.travelTime = v.travelTime;
                    if (v.steepness !== undefined) next.steepness = v.steepness;
                    if (v.delayFrames !== undefined) next.delayFrames = v.delayFrames;
                    if (v.sourceHeightOffset !== undefined)
                        next.sourceHeightOffset = v.sourceHeightOffset;
                    if (v.targetHeightOffset !== undefined)
                        next.targetHeightOffset = v.targetHeightOffset;
                    if (v.travelFrames !== undefined) next.travelFrames = v.travelFrames;
                    if (v.ticksPerTile !== undefined) next.ticksPerTile = v.ticksPerTile;
                }
                PROJECTILE_PARAMS[id] = next;
            }
        }
    }
} catch (err) {
    console.log("[projectiles] failed to load projectile params from cache", err);
}

export function createProjectileParamsProvider(): ProjectileParamsProvider {
    return {
        buildProjectileParamsFromArchetype,

        getProjectileParams(projectileId: number | undefined): ProjectileParams | undefined {
            if (projectileId === undefined) return undefined;
            return PROJECTILE_PARAMS[projectileId];
        },

        applyProjectileDefaults<T extends ProjectileTarget>(
            projectileId: number | undefined,
            target: T,
        ): T {
            if (projectileId === undefined) return target;
            const params = PROJECTILE_PARAMS[projectileId];
            if (!params) return target;
            if ("startHeight" in target || !("projectileStartHeight" in target)) {
                const standardTarget = target as Partial<ProjectileParams>;
                if (standardTarget.startHeight === undefined) {
                    standardTarget.startHeight = params.startHeight;
                }
                if (standardTarget.endHeight === undefined) {
                    standardTarget.endHeight = params.endHeight;
                }
                if (standardTarget.slope === undefined) {
                    standardTarget.slope = params.slope;
                }
                if (standardTarget.steepness === undefined) {
                    standardTarget.steepness = params.steepness;
                }
                if (standardTarget.startDelay === undefined && params.startDelay !== undefined) {
                    standardTarget.startDelay = params.startDelay;
                }
                if (standardTarget.travelTime === undefined) {
                    standardTarget.travelTime = params.travelTime;
                }
                if (standardTarget.delayFrames === undefined && params.delayFrames !== undefined) {
                    standardTarget.delayFrames = params.delayFrames;
                }
                if (standardTarget.lifeModel === undefined && params.lifeModel !== undefined) {
                    standardTarget.lifeModel = params.lifeModel;
                }
                if (
                    standardTarget.sourceHeightOffset === undefined &&
                    params.sourceHeightOffset !== undefined
                ) {
                    standardTarget.sourceHeightOffset = params.sourceHeightOffset;
                }
                if (
                    standardTarget.targetHeightOffset === undefined &&
                    params.targetHeightOffset !== undefined
                ) {
                    standardTarget.targetHeightOffset = params.targetHeightOffset;
                }
                if (standardTarget.travelFrames === undefined && params.travelFrames !== undefined) {
                    standardTarget.travelFrames = params.travelFrames;
                }
                if (standardTarget.ticksPerTile === undefined && params.ticksPerTile !== undefined) {
                    standardTarget.ticksPerTile = params.ticksPerTile;
                }
                return target;
            }

            const aliasTarget = target as ProjectileAliasTarget;
            if (aliasTarget.projectileStartHeight === undefined) {
                aliasTarget.projectileStartHeight = params.startHeight;
            }
            if (aliasTarget.projectileEndHeight === undefined) {
                aliasTarget.projectileEndHeight = params.endHeight;
            }
            if (aliasTarget.projectileSlope === undefined) {
                aliasTarget.projectileSlope = params.slope;
            }
            if (aliasTarget.projectileSteepness === undefined) {
                aliasTarget.projectileSteepness = params.steepness;
            }
            if (aliasTarget.projectileStartDelay === undefined && params.startDelay !== undefined) {
                aliasTarget.projectileStartDelay = params.startDelay;
            }
            if (aliasTarget.projectileTravelTime === undefined) {
                aliasTarget.projectileTravelTime = params.travelTime;
            }
            return target;
        },
    };
}
