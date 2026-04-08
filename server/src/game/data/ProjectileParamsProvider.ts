import type { ProjectileArchetypeName, ProjectileLifeModel } from "../projectiles/ProjectileType";
export type { ProjectileArchetypeName, ProjectileLifeModel } from "../projectiles/ProjectileType";
export { PROJECTILE_ARCHETYPES, calculateProjectileLifeFrames } from "../projectiles/ProjectileType";

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

// =============================================================================
// Provider Registration & Delegation
// =============================================================================

import { getProviderRegistry } from "../providers/ProviderRegistry";

export function registerProjectileParamsProvider(provider: ProjectileParamsProvider): void {
    getProviderRegistry().projectileParams = provider;
}

export function getProjectileParamsProvider(): ProjectileParamsProvider | undefined {
    return getProviderRegistry().projectileParams;
}

function ensureProvider(): ProjectileParamsProvider {
    const p = getProviderRegistry().projectileParams;
    if (!p) {
        throw new Error("[projectileParams] ProjectileParamsProvider not registered. Ensure the gamemode has initialized.");
    }
    return p;
}

export function getProjectileParams(projectileId: number | undefined): ProjectileParams | undefined {
    return ensureProvider().getProjectileParams(projectileId);
}

export function applyProjectileDefaults<T extends ProjectileTarget>(projectileId: number | undefined, target: T): T {
    return ensureProvider().applyProjectileDefaults(projectileId, target);
}

export function buildProjectileParamsFromArchetype(
    archetype: ProjectileArchetypeName,
    overrides?: Partial<ProjectileParams>,
): ProjectileParams {
    return ensureProvider().buildProjectileParamsFromArchetype(archetype, overrides);
}
