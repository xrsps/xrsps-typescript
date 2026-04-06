/**
 * Bridge module: delegates all projectile params access to the registered ProjectileParamsProvider.
 * The actual projectile params definitions live in server/gamemodes/vanilla/data/projectileParams.ts.
 * The vanilla gamemode registers the provider during initialization.
 */
export type {
    ProjectileParams,
    ProjectileAliasTarget,
    ProjectileTarget,
    ProjectileParamsProvider,
} from "../game/data/ProjectileParamsProvider";

let _provider: import("../game/data/ProjectileParamsProvider").ProjectileParamsProvider | undefined;

export function registerProjectileParamsProvider(
    provider: import("../game/data/ProjectileParamsProvider").ProjectileParamsProvider,
): void {
    _provider = provider;
}

export function getProjectileParamsProvider():
    | import("../game/data/ProjectileParamsProvider").ProjectileParamsProvider
    | undefined {
    return _provider;
}

function ensureProvider(): import("../game/data/ProjectileParamsProvider").ProjectileParamsProvider {
    if (!_provider) {
        throw new Error(
            "[projectileParams] ProjectileParamsProvider not registered. Ensure the gamemode has initialized.",
        );
    }
    return _provider;
}

export function getProjectileParams(
    projectileId: number | undefined,
): import("../game/data/ProjectileParamsProvider").ProjectileParams | undefined {
    return ensureProvider().getProjectileParams(projectileId);
}

export function applyProjectileDefaults<
    T extends import("../game/data/ProjectileParamsProvider").ProjectileTarget,
>(projectileId: number | undefined, target: T): T {
    return ensureProvider().applyProjectileDefaults(projectileId, target);
}

export function buildProjectileParamsFromArchetype(
    archetype: import("../game/projectiles/ProjectileType").ProjectileArchetypeName,
    overrides?: Partial<import("../game/data/ProjectileParamsProvider").ProjectileParams>,
): import("../game/data/ProjectileParamsProvider").ProjectileParams {
    return ensureProvider().buildProjectileParamsFromArchetype(archetype, overrides);
}
