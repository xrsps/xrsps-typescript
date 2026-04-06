import type { ProjectileArchetypeName, ProjectileLifeModel } from "../projectiles/ProjectileType";

export interface ProjectileParams {
    startHeight: number;
    endHeight: number;
    slope: number;
    startDelay?: number;
    travelTime?: number;
    steepness?: number;
    delayFrames?: number;
    lifeModel?: ProjectileLifeModel;
    sourceHeightOffset?: number;
    targetHeightOffset?: number;
    travelFrames?: number;
    ticksPerTile?: number;
}

/** Target object that can receive projectile defaults. */
export type ProjectileAliasTarget = {
    projectileStartHeight?: number;
    projectileEndHeight?: number;
    projectileSlope?: number;
    projectileStartDelay?: number;
    projectileTravelTime?: number;
    projectileSteepness?: number;
};

export type ProjectileTarget = Partial<ProjectileParams> | ProjectileAliasTarget;

export interface ProjectileParamsProvider {
    getProjectileParams(projectileId: number | undefined): ProjectileParams | undefined;
    applyProjectileDefaults<T extends ProjectileTarget>(projectileId: number | undefined, target: T): T;
    buildProjectileParamsFromArchetype(archetype: ProjectileArchetypeName, overrides?: Partial<ProjectileParams>): ProjectileParams;
}
