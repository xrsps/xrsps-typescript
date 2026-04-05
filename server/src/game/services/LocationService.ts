import type { WebSocket } from "ws";

import { faceAngleRs } from "../../../../src/rs/utils/rotation";
import { encodeMessage } from "../../network/messages";
import type { PlayerNetworkLayer } from "../../network/PlayerNetworkLayer";
import type { BroadcastScheduler } from "../../network/broadcast/BroadcastScheduler";
import type { DoorStateManager } from "../../world/DoorStateManager";
import type { NpcState } from "../npc";
import type { PlayerState } from "../player";
import type { DataLoaderService } from "./DataLoaderService";
import type { TickFrame } from "../tick/TickPhaseOrchestrator";
import { logger } from "../../utils/logger";

const TILE_UNIT = 128;

export interface LocChangePayload {
    oldId: number;
    newId: number;
    tile: { x: number; y: number };
    level: number;
    oldTile: { x: number; y: number };
    newTile: { x: number; y: number };
    oldRotation?: number;
    newRotation?: number;
    newShape?: number;
}

export interface LocationServiceDeps {
    getActiveFrame: () => TickFrame | undefined;
    getIsBroadcastPhase: () => boolean;
    getSocketByPlayerId: (id: number) => WebSocket | undefined;
    broadcastScheduler: BroadcastScheduler;
    networkLayer: PlayerNetworkLayer;
    doorManager: DoorStateManager | undefined;
    dynamicLocState: any;
    dataLoaders: DataLoaderService;
    broadcast: (msg: string | Uint8Array, context: string) => void;
}

/**
 * Manages location changes, loc spawning, adjacency checks, and gathering target facing.
 * Extracted from WSServer.
 */
export class LocationService {
    constructor(private readonly deps: LocationServiceDeps) {}

    emitLocChange(
        oldId: number,
        newId: number,
        tile: { x: number; y: number },
        level: number,
        opts?: {
            oldTile?: { x: number; y: number };
            newTile?: { x: number; y: number };
            oldRotation?: number;
            newRotation?: number;
            newShape?: number;
        },
    ): void {
        const oldTile = opts?.oldTile ?? tile;
        const newTile = opts?.newTile ?? tile;
        const payload: LocChangePayload = {
            oldId, newId,
            tile: { x: tile.x, y: tile.y },
            level,
            oldTile: { x: oldTile.x, y: oldTile.y },
            newTile: { x: newTile.x, y: newTile.y },
            oldRotation: opts?.oldRotation,
            newRotation: opts?.newRotation,
            newShape: opts?.newShape,
        };
        try {
            this.deps.doorManager?.observeLocChange({
                oldId: payload.oldId, newId: payload.newId, level: payload.level,
                oldTile: payload.oldTile, newTile: payload.newTile,
            });
        } catch (err) {
            logger.warn("[Door] Failed to observe loc change for runtime mapping capture", err);
        }
        try {
            this.deps.dynamicLocState.observeLocChange({
                oldId: payload.oldId, newId: payload.newId, level: payload.level,
                oldTile: payload.oldTile, newTile: payload.newTile,
                oldRotation: payload.oldRotation, newRotation: payload.newRotation,
            });
        } catch (err) {
            logger.warn("[loc] Failed to update dynamic loc state store", err);
        }
        const frame = this.deps.getActiveFrame();
        if (frame && !this.deps.getIsBroadcastPhase()) {
            frame.locChanges.push(payload);
            return;
        }
        if (frame) {
            this.deps.broadcastScheduler.queueLocChange(payload);
            return;
        }
        const msg = encodeMessage({ type: "loc_change", payload });
        this.deps.networkLayer.withDirectSendBypass("loc_change", () =>
            this.deps.broadcast(msg, "loc_change"),
        );
    }

    sendLocChangeToPlayer(
        player: PlayerState,
        oldId: number,
        newId: number,
        tile: { x: number; y: number },
        level: number,
    ): void {
        const payload: LocChangePayload = {
            oldId, newId,
            tile: { x: tile.x, y: tile.y }, level,
            oldTile: { x: tile.x, y: tile.y },
            newTile: { x: tile.x, y: tile.y },
        };
        const ws = this.deps.getSocketByPlayerId(player.id);
        if (!ws) return;
        const msg = encodeMessage({ type: "loc_change", payload });
        this.deps.networkLayer.withDirectSendBypass("loc_change_player", () =>
            this.deps.networkLayer.sendWithGuard(ws, msg, "loc_change"),
        );
    }

    spawnLocForPlayer(
        player: PlayerState,
        locId: number,
        tile: { x: number; y: number },
        level: number,
        shape: number,
        rotation: number,
    ): void {
        const ws = this.deps.getSocketByPlayerId(player.id);
        if (!ws) return;
        const msg = encodeMessage({
            type: "loc_add_change",
            payload: { locId, tile, level, shape, rotation },
        } as any);
        this.deps.networkLayer.withDirectSendBypass("loc_add_change", () =>
            this.deps.networkLayer.sendWithGuard(ws, msg, "loc_add_change"),
        );
    }

    isAdjacentToTile(player: PlayerState, tile: { x: number; y: number }, radius = 1): boolean {
        const dx = Math.abs(player.tileX - tile.x);
        const dy = Math.abs(player.tileY - tile.y);
        return dx <= radius && dy <= radius;
    }

    isAdjacentToNpc(player: PlayerState, npc: NpcState): boolean {
        const size = Math.max(1, npc.size);
        const minX = npc.tileX;
        const minY = npc.tileY;
        const maxX = minX + size - 1;
        const maxY = minY + size - 1;
        const px = player.tileX;
        const py = player.tileY;
        const clampedX = Math.max(minX, Math.min(px, maxX));
        const clampedY = Math.max(minY, Math.min(py, maxY));
        const distance = Math.max(Math.abs(px - clampedX), Math.abs(py - clampedY));
        return distance === 1;
    }

    faceGatheringTarget(player: PlayerState, tile: { x: number; y: number }): void {
        const targetX = tile.x * TILE_UNIT + TILE_UNIT / 2;
        const targetY = tile.y * TILE_UNIT + TILE_UNIT / 2;
        try {
            player.setForcedOrientation(faceAngleRs(player.x, player.y, targetX, targetY));
        } catch {}
    }
}
