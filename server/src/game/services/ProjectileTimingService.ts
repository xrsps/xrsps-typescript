import type { ProjectileParams } from "../data/ProjectileParamsProvider";
import type { SpellDataEntry } from "../spells/SpellDataProvider";
import type { ProjectileLaunch } from "../../../../src/shared/projectiles/ProjectileLaunch";
import { PLAYER_CHEST_OFFSET_UNITS } from "../../../../src/shared/projectiles/projectileHeights";
import type { PathService } from "../../pathfinding/PathService";
import type { PlayerState } from "../player";
import type { NpcState } from "../npc";
import { logger } from "../../utils/logger";

const TILE_UNIT = 128;

export interface ProjectileTimingServiceDeps {
    getTickMs: () => number;
    getCurrentTick: () => number;
    getActiveFrame: () => any | undefined;
    getSeqTypeLoader: () => any | undefined;
    getNpcManager: () => any | undefined;
    getProjectileSystem: () => any | undefined;
    getPathService: () => any | undefined;
    pickSpellCastSequence: (player: PlayerState, spellId: number, isAutocast: boolean) => number;
    pickAttackSequence: (player: PlayerState) => number;
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
        let usedCacheDelay = false;
        if (opts.spellData?.projectileStartDelay !== undefined) {
            startDelay = Math.max(0, opts.spellData.projectileStartDelay);
            usedCacheDelay = true;
        } else if (opts.projectileDefaults?.startDelay !== undefined) {
            startDelay = Math.max(0, opts.projectileDefaults.startDelay);
            usedCacheDelay = true;
        } else if (
            opts.projectileDefaults?.delayFrames !== undefined &&
            opts.projectileDefaults.delayFrames > 0
        ) {
            startDelay = Math.max(0, opts.projectileDefaults.delayFrames / framesPerTick);
            usedCacheDelay = true;
        }

        let travelTime: number | undefined;
        let rayTiles: number | undefined;
        let lineOfSight: boolean | undefined;
        if (opts.spellData?.projectileTravelTime !== undefined) {
            travelTime = Math.max(1, opts.spellData.projectileTravelTime);
        } else if (opts.projectileDefaults?.travelTime !== undefined) {
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
                travelTime = Math.max(1, travelFrames / framesPerTick);
            }
        }

        if (travelTime === undefined || !Number.isFinite(travelTime)) return undefined;

        if (opts.spellData?.projectileReleaseDelayTicks !== undefined) {
            startDelay += Math.max(0, opts.spellData.projectileReleaseDelayTicks);
        } else if (!usedCacheDelay) {
            try {
                let castSeq = -1;
                if (opts.spellData) {
                    if (opts.spellData.castAnimId !== undefined) {
                        castSeq = opts.spellData.castAnimId;
                    } else if (opts.spellData.id > 0) {
                        const isAutocast =
                            !!opts.player.combat.autocastEnabled &&
                            (opts.player.combat.spellId ?? -1) === opts.spellData.id;
                        castSeq = this.deps.pickSpellCastSequence(
                            opts.player,
                            opts.spellData.id,
                            isAutocast,
                        );
                    }
                } else {
                    castSeq = this.deps.pickAttackSequence(opts.player);
                }
                const extra = this.estimateReleaseOffsetFromSeq(castSeq, framesPerTick);
                if (extra !== undefined && extra > 0) {
                    startDelay += extra;
                }
            } catch (err) { logger.warn("[combat] attack sequence estimation failed", err); }
        }

        const hitDelay = startDelay + travelTime;
        return { startDelay, travelTime, hitDelay, lineOfSight };
    }

    estimateReleaseOffsetFromSeq(seqId: number, framesPerTick: number): number | undefined {
        if (!(seqId >= 0)) return undefined;
        const loader: any = this.deps.getSeqTypeLoader();
        if (!loader?.load) return undefined;
        try {
            const seq = loader.load(seqId);
            if (!seq) return undefined;
            const sounds = seq.frameSounds as Map<number, any[]> | undefined;
            let frameIndex: number | undefined;
            if (sounds) {
                let best: number | undefined;
                sounds.forEach((_v: any, k: number) => {
                    if (best === undefined || k < best) best = k;
                });
                frameIndex = best;
            }
            if (frameIndex === undefined) return undefined;
            let frames = 0;
            for (let i = 0; i <= Math.min(frameIndex, (seq.frameLengths?.length ?? 0) - 1); i++) {
                const fl = seq.frameLengths[i] ?? 1;
                frames += fl > 0 ? fl : 1;
            }
            const ticks = frames / Math.max(1, framesPerTick);
            return Math.max(0, ticks);
        } catch {
            return undefined;
        }
    }

    estimateProjectileTravelFramesForParams(
        projectileId: number,
        defaults: ProjectileParams | undefined,
        distanceTiles: number,
        rayTiles: number | undefined,
        framesPerTick: number,
    ): number | undefined {
        const tiles = Math.max(1, Math.round(distanceTiles));
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
        const byModel = this.estimateFramesFromLifeModel(
            defaults?.lifeModel,
            tiles,
            rayTiles,
            framesPerTick,
        );
        if (byModel !== undefined) {
            return byModel;
        }
        return undefined;
    }

    estimateFramesFromLifeModel(
        model: ProjectileParams["lifeModel"],
        distanceTiles: number,
        rayTiles?: number,
        framesPerTick?: number,
    ): number | undefined {
        if (!model) return undefined;
        const tiles = Math.max(1, Math.round(distanceTiles));
        const fpt = Math.max(1, Math.round(framesPerTick ?? 30));
        switch (model) {
            case "linear5":
                return tiles * 5;
            case "linear5-clamped10":
                return Math.max(10, tiles * 5);
            case "javelin":
                return tiles * 3 + 2;
            case "magic": {
                const pathTiles = Math.max(1, Math.round(rayTiles ?? distanceTiles));
                const travelTicks = 1 + Math.floor((1 + pathTiles) / 3);
                return travelTicks * fpt;
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
