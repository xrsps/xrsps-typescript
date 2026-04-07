import type {
    ProjectileActorRef,
    ProjectileEndpoint,
    ProjectileLaunch,
} from "../../../../src/shared/projectiles/ProjectileLaunch";
import { ProjectileParams } from "../data/ProjectileParamsProvider";
import { SpellDataEntry } from "../spells/SpellDataProvider";
import { NpcState } from "../npc";
import { PlayerState } from "../player";
import type { ServerServices } from "../ServerServices";

const NPC_STREAM_EXIT_RADIUS_TILES = 17;

export interface RangedProjectileParams {
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
}

export interface SpellProjectileParams {
    player: PlayerState;
    targetNpc?: NpcState;
    targetPlayer?: PlayerState;
    targetTile?: { x: number; y: number; plane?: number };
    spellData: SpellDataEntry;
    projectileDefaults?: ProjectileParams;
    endHeight?: number;
    timing?: { startDelay: number; travelTime: number };
    impactDelayTicks?: number;
}

/**
 * Manages projectile creation, queuing, and distribution to nearby players.
 * Extracted from wsServer.ts to reduce coupling and improve testability.
 */
export class ProjectileSystem {
    private pendingProjectilePackets: Map<number, ProjectileLaunch[]> = new Map();
    private activeFrameProjectilePackets?: Map<number, ProjectileLaunch[]>;

    constructor(private readonly svc: ServerServices) {}

    /**
     * Get pending projectile packets for a specific player.
     */
    getPacketsForPlayer(playerId: number): ProjectileLaunch[] {
        return this.pendingProjectilePackets.get(playerId) ?? [];
    }

    /**
     * Get or set the active frame projectile container (for tick-synchronized distribution).
     */
    setActiveFramePackets(packets: Map<number, ProjectileLaunch[]> | undefined): void {
        this.activeFrameProjectilePackets = packets;
    }

    /**
     * Clear pending packets after they've been sent.
     */
    clearPendingPackets(): void {
        this.pendingProjectilePackets.clear();
    }

    /**
     * Get all pending packet entries (for frame building).
     */
    drainPendingPackets(): Map<number, ProjectileLaunch[]> {
        const packets = this.pendingProjectilePackets;
        this.pendingProjectilePackets = new Map();
        return packets;
    }

    /**
     * Restore packets from a failed frame back to pending.
     */
    restorePackets(packets: Map<number, ProjectileLaunch[]>): void {
        for (const [playerId, spawns] of packets.entries()) {
            const existing = this.pendingProjectilePackets.get(playerId);
            if (existing) {
                existing.push(...spawns);
            } else {
                this.pendingProjectilePackets.set(playerId, [...spawns]);
            }
        }
    }

    /**
     * Build a projectile launch for a ranged attack (player vs NPC).
     */
    buildRangedProjectileLaunch(opts: RangedProjectileParams): ProjectileLaunch | undefined {
        const projectileId = opts.projectile.projectileId;
        if (projectileId === undefined || projectileId <= 0) {
            return undefined;
        }

        const framesPerTick = this.getFramesPerTick();
        const projectileDefaults: ProjectileParams = {
            startHeight: opts.projectile.startHeight ?? 40,
            endHeight: opts.projectile.endHeight ?? 36,
            slope: opts.projectile.slope ?? 0,
            steepness: opts.projectile.steepness ?? 0,
            startDelay: opts.projectile.startDelay ?? 0,
            sourceHeightOffset: opts.projectile.sourceHeightOffset,
        };

        const targetEndHeight = this.computeProjectileEndHeight({
            projectileDefaults,
            targetNpc: opts.npc,
        });

        const cheb = Math.max(
            Math.abs(opts.player.tileX - opts.npc.tileX),
            Math.abs(opts.player.tileY - opts.npc.tileY),
        );
        const defaultTravelTime = Math.max(1, -5 + 10 * Math.max(1, cheb)) / framesPerTick;

        const verticalStartByte = projectileDefaults.startHeight ?? 40;
        const verticalEndByte = targetEndHeight ?? projectileDefaults.endHeight ?? 36;
        const sourceHeight = projectileDefaults.sourceHeightOffset ?? verticalStartByte * 4;
        const endHeight = verticalEndByte * 4;
        const startPos = opts.projectile.steepness ?? projectileDefaults.steepness ?? 64;
        const startDelay = opts.timing?.startDelay ?? projectileDefaults.startDelay ?? 0;
        const travelTime = opts.timing?.travelTime ?? defaultTravelTime;
        const cycleOffsets = this.buildCycleOffsets(startDelay, travelTime, framesPerTick);

        return {
            projectileId,
            source: this.createPlayerEndpoint(opts.player),
            target: this.createNpcEndpoint(opts.npc),
            sourceHeight,
            endHeight,
            slope: projectileDefaults.slope ?? 0,
            startPos,
            startCycleOffset: cycleOffsets.startCycleOffset,
            endCycleOffset: cycleOffsets.endCycleOffset,
        };
    }

    /**
     * Build a projectile launch for a spell cast.
     */
    buildSpellProjectileLaunch(opts: SpellProjectileParams): ProjectileLaunch | undefined {
        const projectileId = opts.spellData.projectileId;
        if (projectileId === undefined || projectileId <= 0) {
            return undefined;
        }

        const { player, targetNpc, targetPlayer, targetTile, spellData, projectileDefaults } = opts;
        const target = this.resolveSpellTargetEndpoint(player, targetNpc, targetPlayer, targetTile);
        if (!target) {
            return undefined;
        }

        const framesPerTick = this.getFramesPerTick();
        const cheb = Math.max(
            Math.abs(player.tileX - target.tileX),
            Math.abs(player.tileY - target.tileY),
        );
        const defaultTravelTime = Math.max(1, -5 + 10 * Math.max(1, cheb)) / framesPerTick;
        const verticalStartByte =
            spellData.projectileStartHeight ?? projectileDefaults?.startHeight ?? 43;
        const verticalEndByte = opts.endHeight ?? projectileDefaults?.endHeight ?? 31;
        const sourceHeight = projectileDefaults?.sourceHeightOffset ?? verticalStartByte * 4;
        const endHeight = verticalEndByte * 4;
        const startPos = spellData.projectileSteepness ?? projectileDefaults?.steepness ?? 64;
        const startDelay = opts.timing?.startDelay ?? 0;
        const travelTime = opts.timing?.travelTime ?? defaultTravelTime;
        const cycleOffsets = this.buildCycleOffsets(
            startDelay,
            travelTime,
            framesPerTick,
            opts.impactDelayTicks,
        );

        return {
            projectileId,
            source: this.createPlayerEndpoint(player),
            target,
            sourceHeight,
            endHeight,
            slope: spellData.projectileSlope ?? projectileDefaults?.slope ?? 16,
            startPos,
            startCycleOffset: cycleOffsets.startCycleOffset,
            endCycleOffset: cycleOffsets.endCycleOffset,
        };
    }

    /**
     * Queue a spell projectile launch for nearby viewers.
     */
    queueSpellProjectileLaunch(opts: SpellProjectileParams): void {
        const launch = this.buildSpellProjectileLaunch(opts);
        if (launch) {
            this.queueProjectileForViewers(launch);
        }
    }

    /**
     * Queue a projectile launch for all players within viewing range.
     */
    queueProjectileForViewers(launch: ProjectileLaunch): void {
        const activeFrameTick = this.svc.activeFrame?.tick;
        const currentTick = this.svc.ticker.currentTick();

        const container =
            activeFrameTick !== undefined && activeFrameTick === currentTick
                ? (this.activeFrameProjectilePackets ??= new Map())
                : this.pendingProjectilePackets;

        this.svc.players?.forEach((_sock, p) => {
            if (p.level !== launch.source.plane && p.level !== launch.target.plane) {
                return;
            }

            const dxS = Math.abs(p.tileX - launch.source.tileX);
            const dyS = Math.abs(p.tileY - launch.source.tileY);
            const dxT = Math.abs(p.tileX - launch.target.tileX);
            const dyT = Math.abs(p.tileY - launch.target.tileY);
            const nearSource = Math.max(dxS, dyS) <= NPC_STREAM_EXIT_RADIUS_TILES;
            const nearTarget = Math.max(dxT, dyT) <= NPC_STREAM_EXIT_RADIUS_TILES;
            if (!nearSource && !nearTarget) return;

            const list = this.getOrCreatePacketBuffer(container, p.id);
            list.push(launch);
        });
    }

    // ----------- Private helpers -----------

    private getOrCreatePacketBuffer(
        container: Map<number, ProjectileLaunch[]>,
        playerId: number,
    ): ProjectileLaunch[] {
        let list = container.get(playerId);
        if (!list) {
            list = [];
            container.set(playerId, list);
        }
        return list;
    }

    private getFramesPerTick(): number {
        return Math.max(1, Math.round(this.svc.tickMs / 20));
    }

    private buildCycleOffsets(
        startDelay: number,
        travelTime: number,
        framesPerTick: number,
        impactDelayTicks?: number,
    ): { startCycleOffset: number; endCycleOffset: number } {
        const startCycleOffset = Math.max(0, Math.round(startDelay * framesPerTick));
        let totalCycleOffset = Math.max(
            startCycleOffset + 1,
            Math.ceil((startDelay + travelTime) * framesPerTick),
        );
        if (Number.isFinite(impactDelayTicks) && (impactDelayTicks as number) > 0) {
            totalCycleOffset = Math.max(
                startCycleOffset + 1,
                Math.round((impactDelayTicks as number) * framesPerTick),
            );
        }
        return {
            startCycleOffset,
            endCycleOffset: totalCycleOffset,
        };
    }

    private createPlayerEndpoint(player: PlayerState): ProjectileEndpoint {
        return {
            tileX: player.tileX,
            tileY: player.tileY,
            plane: player.level,
            actor: this.createActorRef("player", player.id),
        };
    }

    private createNpcEndpoint(npc: NpcState): ProjectileEndpoint {
        return {
            tileX: npc.tileX,
            tileY: npc.tileY,
            plane: npc.level,
            actor: this.createActorRef("npc", npc.id),
        };
    }

    private createTileEndpoint(tileX: number, tileY: number, plane: number): ProjectileEndpoint {
        return {
            tileX,
            tileY,
            plane,
        };
    }

    private createActorRef(kind: "player" | "npc", serverId: number): ProjectileActorRef {
        return {
            kind,
            serverId,
        };
    }

    private resolveSpellTargetEndpoint(
        player: PlayerState,
        targetNpc: NpcState | undefined,
        targetPlayer: PlayerState | undefined,
        targetTile: { x: number; y: number; plane?: number } | undefined,
    ): ProjectileEndpoint | undefined {
        if (targetPlayer) {
            return this.createPlayerEndpoint(targetPlayer);
        }
        if (targetNpc) {
            return this.createNpcEndpoint(targetNpc);
        }
        if (targetTile) {
            return this.createTileEndpoint(
                targetTile.x,
                targetTile.y,
                targetTile.plane ?? player.level,
            );
        }
        return undefined;
    }

    private computeProjectileEndHeight(opts: {
        projectileDefaults?: ProjectileParams;
        spellData?: SpellDataEntry;
        targetNpc?: NpcState;
        targetPlayer?: PlayerState;
    }): number | undefined {
        const explicit = opts.spellData?.projectileEndHeight ?? opts.projectileDefaults?.endHeight;
        return explicit !== undefined ? explicit : undefined;
    }
}
