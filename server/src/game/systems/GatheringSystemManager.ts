import { FIRE_REMAINS_LOC_ID, FiremakingTracker } from "../skills/firemaking";
import { FlaxPatchTracker } from "../skills/flaxPatchTracker";
import { MiningNodeTracker, buildMiningTileKey } from "../skills/mining";
import { WoodcuttingNodeTracker, buildWoodcuttingTileKey } from "../skills/woodcutting";

export interface GatheringSystemServices {
    emitLocChange: (
        oldId: number,
        newId: number,
        tile: { x: number; y: number },
        level: number,
    ) => void;
}

/**
 * Coordinates all gathering skill systems (woodcutting, mining, fishing, firemaking, etc.)
 * Handles tick processing for resource respawns and state management.
 */
export class GatheringSystemManager {
    readonly woodcuttingTracker = new WoodcuttingNodeTracker();
    readonly miningTracker = new MiningNodeTracker();
    readonly firemakingTracker = new FiremakingTracker();
    readonly flaxTracker = new FlaxPatchTracker();

    private services: GatheringSystemServices;

    constructor(services: GatheringSystemServices) {
        this.services = services;
    }

    /**
     * Process all gathering system respawns for a tick.
     */
    processTick(tick: number): void {
        this.processWoodcuttingRespawns(tick);
        this.processMiningRespawns(tick);
        this.processFlaxRespawns(tick);
        this.processFiremakingExpirations(tick);
        this.processFiremakingAshes(tick);
    }

    private processWoodcuttingRespawns(tick: number): void {
        this.woodcuttingTracker.processRespawns(tick, (oldId, newId, tile, level) =>
            this.services.emitLocChange(oldId, newId, tile, level),
        );
    }

    private processMiningRespawns(tick: number): void {
        this.miningTracker.processRespawns(tick, (oldId, newId, tile, level) =>
            this.services.emitLocChange(oldId, newId, tile, level),
        );
    }

    private processFlaxRespawns(tick: number): void {
        this.flaxTracker.processRespawns(tick, (state) =>
            this.services.emitLocChange(0, state.locId, state.tile, state.level),
        );
    }

    private processFiremakingExpirations(tick: number): void {
        this.firemakingTracker.processExpirations(tick, (node) => {
            this.services.emitLocChange(
                node.fireObjectId,
                FIRE_REMAINS_LOC_ID,
                node.tile,
                node.level,
            );
            this.firemakingTracker.spawnAshFromFire(node, tick);
        });
    }

    private processFiremakingAshes(tick: number): void {
        this.firemakingTracker.processAshes(tick, (node) =>
            this.services.emitLocChange(
                FIRE_REMAINS_LOC_ID,
                node.previousLocId,
                node.tile,
                node.level,
            ),
        );
    }

    // ----- Woodcutting -----

    isWoodcuttingDepleted(key: string): boolean {
        return this.woodcuttingTracker.isDepleted(key);
    }

    markWoodcuttingDepleted(
        info: {
            key: string;
            locId: number;
            stumpId: number;
            treeId: string;
            tile: { x: number; y: number };
            level: number;
            respawnTicks: { min: number; max: number };
        },
        tick: number,
    ): void {
        this.woodcuttingTracker.markDepleted(info, tick);
    }

    buildWoodcuttingTileKey(tile: { x: number; y: number }, level: number): string {
        return buildWoodcuttingTileKey(tile, level);
    }

    // ----- Mining -----

    isMiningDepleted(key: string): boolean {
        return this.miningTracker.isDepleted(key);
    }

    markMiningDepleted(
        info: {
            key: string;
            locId: number;
            rockId: string;
            tile: { x: number; y: number };
            level: number;
            respawnTicks: { min: number; max: number };
            depletedLocId?: number;
        },
        tick: number,
    ): void {
        this.miningTracker.markDepleted(info, tick);
    }

    buildMiningTileKey(tile: { x: number; y: number }, level: number): string {
        return buildMiningTileKey(tile, level);
    }

    // ----- Firemaking -----

    isTileLit(tile: { x: number; y: number }, level: number): boolean {
        return this.firemakingTracker.isTileLit(tile, level);
    }

    getFireNode(
        tile: { x: number; y: number },
        level: number,
    ): { fireObjectId: number; expirationTick: number } | undefined {
        const node = this.firemakingTracker.getFireNode(tile, level);
        if (!node) return undefined;
        return { fireObjectId: node.fireObjectId, expirationTick: node.expiresTick };
    }

    getAshNode(
        tile: { x: number; y: number },
        level: number,
    ): { expirationTick: number; previousLocId: number } | undefined {
        const node = this.firemakingTracker.getAshNode(tile, level);
        if (!node) return undefined;
        return { expirationTick: node.expiresTick, previousLocId: node.previousLocId };
    }

    removeAshNode(tile: { x: number; y: number }, level: number): void {
        this.firemakingTracker.removeAshNode(tile, level);
    }

    // ----- Flax -----

    markFlaxDepleted(info: {
        tile: { x: number; y: number };
        level: number;
        locId: number;
        respawnTicks: number;
    }, tick: number): void {
        this.flaxTracker.markDepleted({
            tile: info.tile,
            level: info.level,
            locId: info.locId,
            respawnTick: tick + info.respawnTicks,
        });
    }
}
