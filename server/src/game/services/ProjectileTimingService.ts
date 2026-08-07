import type { ProjectileLaunch } from "../../../../client/common/projectiles/ProjectileLaunch";
import { PLAYER_CHEST_OFFSET_UNITS } from "../../../../client/common/projectiles/projectileHeights";
import type { PathService } from "../../pathfinding/PathService";
import type { ProjectileParams } from "../data/ProjectileParamsProvider";
import type { NpcState } from "../npc";
import type { NpcManager } from "../npcManager";
import type { PlayerState } from "../player";
import type { SpellDataEntry } from "../spells/SpellDataProvider";
import type { RangedProjectileParams } from "../systems/ProjectileSystem";

const TILE_UNIT = 128;

interface ProjectileSystemView {
    buildRangedProjectileLaunch(opts: RangedProjectileParams): ProjectileLaunch | undefined;
    queueProjectileForViewers(launch: ProjectileLaunch): void;
    setActiveFramePackets(packets: Map<number, ProjectileLaunch[]> | undefined): void;
}

interface TickFrameView {
    tick: number;
    projectilePackets?: Map<number, ProjectileLaunch[]>;
    [key: string]: unknown;
}

export interface ProjectileTimingServiceDeps {
    getTickMs: () => number;
    getCurrentTick: () => number;
    getActiveFrame: () => TickFrameView | undefined;
    getNpcManager: () => NpcManager | undefined;
    getProjectileSystem: () => ProjectileSystemView | undefined;
    getPathService: () =>
        | (PathService & {
              sampleHeight?: (x: number, y: number, plane: number) => number | undefined;
          })
        | undefined;
}

export class ProjectileTimingService {
    constructor(private readonly deps: ProjectileTimingServiceDeps) {}

    estimateProjectileTiming(opts: {
        player: PlayerState;
        targetX?: number;
        targetY?: number;
        projectileDefaults?: ProjectileParams;
        spellData?: SpellDataEntry;
        pathService?: PathService;
    }):
        | { startDelay: number; travelTime: number; hitDelay: number; lineOfSight?: boolean }
        | undefined {
        const tickMs = Math.max(1, this.deps.getTickMs());
        const framesPerTick = Math.max(1, Math.round(tickMs / 20));
        const projectileId = opts.spellData?.projectileId ?? -1;

        let startDelay = 0;
        if (opts.spellData?.projectileStartDelay !== undefined) {
            startDelay = Math.max(0, opts.spellData.projectileStartDelay);
        } else if (opts.projectileDefaults?.startDelay !== undefined) {
            startDelay = Math.max(0, opts.projectileDefaults.startDelay);
        } else if (
            opts.projectileDefaults?.delayFrames !== undefined &&
            opts.projectileDefaults.delayFrames > 0
        ) {
            startDelay = Math.max(0, opts.projectileDefaults.delayFrames / framesPerTick);
        }

        let travelTime: number | undefined;
        let rayTiles: number | undefined;
        let lineOfSight: boolean | undefined;
        if (opts.spellData?.projectileTravelTime !== undefined) {
            travelTime = Math.max(1, opts.spellData.projectileTravelTime);
        } else if (
            opts.projectileDefaults?.travelTime !== undefined &&
            opts.projectileDefaults.lifeModel !== "magic"
        ) {
            travelTime = Math.max(1, opts.projectileDefaults.travelTime);
        } else if (opts.targetX !== undefined && opts.targetY !== undefined) {
            const px = opts.player.tileX;
            const py = opts.player.tileY;
            const tx = opts.targetX;
            const ty = opts.targetY;
            const tiles = Math.max(Math.abs(px - tx), Math.abs(py - ty)); // Chebyshev
            let effective = tiles;
            if (opts.pathService) {
                const ray = opts.pathService.projectileRaycast(
                    { x: px, y: py, plane: opts.player.level },
                    { x: tx, y: ty },
                );
                lineOfSight = ray.clear;
                rayTiles = Math.max(0, ray.tiles);
                if (ray.clear) {
                    effective = Math.max(1, ray.tiles);
                }
            }
            const travelFrames = this.estimateProjectileTravelFramesForParams(
                projectileId,
                opts.projectileDefaults,
                effective,
                rayTiles,
                framesPerTick,
            );
            if (travelFrames !== undefined && Number.isFinite(travelFrames)) {
                travelTime = Math.max(1 / framesPerTick, travelFrames / framesPerTick);
            }
        }

        if (travelTime === undefined || !Number.isFinite(travelTime)) return undefined;

        if (opts.spellData?.projectileReleaseDelayTicks !== undefined) {
            startDelay += Math.max(0, opts.spellData.projectileReleaseDelayTicks);
        }

        const hitDelay = startDelay + travelTime;
        return { startDelay, travelTime, hitDelay, lineOfSight };
    }

    estimateProjectileTravelFramesForParams(
        projectileId: number,
        defaults: ProjectileParams | undefined,
        distanceTiles: number,
        rayTiles: number | undefined,
        framesPerTick: number,
    ): number | undefined {
        const tiles = Math.max(1, Math.round(distanceTiles));
        if (defaults?.lifeModel === "magic") {
            const byModel = this.estimateFramesFromLifeModel(defaults.lifeModel, tiles, rayTiles);
            if (byModel !== undefined) {
                return byModel;
            }
        }
        const travelFramesExplicit = defaults?.travelFrames;
        if (
            Number.isFinite(travelFramesExplicit as number) &&
            (travelFramesExplicit as number) > 0
        ) {
            return Math.max(1, Math.round(travelFramesExplicit as number));
        }
        const ticksPerTile = defaults?.ticksPerTile;
        if (Number.isFinite(ticksPerTile as number) && (ticksPerTile as number) > 0) {
            return Math.max(1, Math.round(tiles * (ticksPerTile as number) * framesPerTick));
        }
        const byModel = this.estimateFramesFromLifeModel(defaults?.lifeModel, tiles, rayTiles);
        if (byModel !== undefined) {
            return byModel;
        }
        return undefined;
    }

    estimateFramesFromLifeModel(
        model: ProjectileParams["lifeModel"],
        distanceTiles: number,
        rayTiles?: number,
    ): number | undefined {
        if (!model) return undefined;
        const tiles = Math.max(1, Math.round(distanceTiles));
        switch (model) {
            case "linear5":
                return tiles * 5;
            case "linear5-clamped10":
                return Math.max(10, tiles * 5);
            case "javelin":
                return tiles * 3 + 2;
            case "magic": {
                // Magic lifespan = (raycast path tiles * 10) - 5 client cycles.
                const pathTiles = Math.max(1, Math.round(rayTiles ?? distanceTiles));
                return Math.max(1, pathTiles * 10 - 5);
            }
            default:
                return undefined;
        }
    }

    getPlayerProjectileHeightOffset(_player: PlayerState): number {
        return PLAYER_CHEST_OFFSET_UNITS;
    }

    getProjectileHeightSampler():
        | ((worldX: number, worldY: number, plane: number) => number | undefined)
        | undefined {
        const pathService = this.deps.getPathService();
        if (!pathService?.sampleHeight) {
            return undefined;
        }
        return (worldX: number, worldY: number, plane: number): number | undefined => {
            const sample = pathService.sampleHeight(worldX, worldY, plane);
            if (!Number.isFinite(sample as number)) {
                return 0;
            }
            return sample as number;
        };
    }

    getNpcProjectileHeightOffset(npc: NpcState): number {
        try {
            const npcManager = this.deps.getNpcManager();
            const npcType = npcManager?.getNpcType(npc);
            let heightScale = Math.max(64, npcType?.heightScale ?? 128);
            let heightOffsetTiles = Math.max(0.6, (heightScale / 128) * 0.75);
            const size = Math.max(1, npc.size);
            heightOffsetTiles += (size - 1) * 0.5;
            return Math.round(heightOffsetTiles * TILE_UNIT);
        } catch {
            return PLAYER_CHEST_OFFSET_UNITS;
        }
    }

    getTargetHeightOffset(
        targetNpc: NpcState | undefined,
        targetPlayer: PlayerState | undefined,
        fallback: number,
    ): number {
        if (targetPlayer) return this.getPlayerProjectileHeightOffset(targetPlayer);
        if (targetNpc) return this.getNpcProjectileHeightOffset(targetNpc);
        return fallback;
    }

    computeProjectileEndHeight(opts: {
        projectileDefaults?: ProjectileParams;
        spellData?: SpellDataEntry;
        targetNpc?: NpcState;
        targetPlayer?: PlayerState;
    }): number | undefined {
        const explicit = opts.spellData?.projectileEndHeight ?? opts.projectileDefaults?.endHeight;
        return explicit !== undefined ? explicit : undefined;
    }

    buildPlayerRangedProjectileLaunch(opts: {
        player: PlayerState;
        npc: NpcState;
        projectile: {
            projectileId?: number;
            startHeight?: number;
            endHeight?: number;
            slope?: number;
            steepness?: number;
            startDelay?: number;
            lifeModel?: ProjectileParams["lifeModel"];
            sourceHeightOffset?: number;
        };
        timing?: { startDelay: number; travelTime: number };
    }): ProjectileLaunch | undefined {
        const projectileSystem = this.deps.getProjectileSystem();
        if (!projectileSystem) return undefined;
        return projectileSystem.buildRangedProjectileLaunch(opts);
    }

    queueProjectileForViewers(launch: ProjectileLaunch): void {
        const projectileSystem = this.deps.getProjectileSystem();
        if (!projectileSystem) return;
        const activeFrame = this.deps.getActiveFrame();
        if (activeFrame && activeFrame.tick === this.deps.getCurrentTick()) {
            activeFrame.projectilePackets ??= new Map();
            projectileSystem.setActiveFramePackets(activeFrame.projectilePackets);
        }
        projectileSystem.queueProjectileForViewers(launch);
    }
}
