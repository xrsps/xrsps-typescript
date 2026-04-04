import {
    MovementDirection,
    deltaToDirection,
    directionToDelta,
    directionToOrientation,
} from "../../shared/Direction";
import type { NpcEcs } from "../ecs/NpcEcs";
import type { MovementStep } from "./MovementPath";
import { MovementPath } from "./MovementPath";
import type { MovementUpdate } from "./MovementSyncTypes";

export type NpcMovementUpdate = MovementUpdate & {
    localX: number;
    localY: number;
    mapBaseX: number;
    mapBaseY: number;
    /**
     * Mirrors RSNPC.method3656 near-range updates: queue one absolute walk target (class311.field3806)
     * when the update carries a destination but no packed direction deltas.
     */
    queueAbsoluteWalk?: boolean;
};

// Stateless NPC update applier: all authoritative state lives in NpcEcs.
export class NpcMovementSync {
    constructor(private readonly npcEcs: NpcEcs) {}

    applyNpcUpdate(
        update: NpcMovementUpdate,
        options: { forceImmediateRotation?: boolean } = {},
    ): { path: MovementPath; teleported: boolean } {
        const ecsIndex = update.ecsIndex | 0;
        const directions = Array.isArray(update.directions)
            ? update.directions.map((dir) => (dir | 0) & 7)
            : [];
        const traversals = Array.isArray(update.traversals)
            ? update.traversals.map((t) => (t | 0) & 3)
            : [];
        const existingState = this.npcEcs.getServerState(ecsIndex);

        const fromTile = existingState
            ? { x: existingState.tileX, y: existingState.tileY }
            : undefined;
        const forcedTeleport = !existingState || !!update.snap;

        const npcSize = Math.max(1, this.npcEcs.getSize(ecsIndex) | 0);
        const centerOffset = (npcSize << 6) | 0; // size * 64

        let resolvedSubX =
            typeof update.subX === "number"
                ? update.subX | 0
                : typeof existingState?.subX === "number"
                ? existingState.subX | 0
                : (update.localX | 0) + (update.mapBaseX | 0);
        let resolvedSubY =
            typeof update.subY === "number"
                ? update.subY | 0
                : typeof existingState?.subY === "number"
                ? existingState.subY | 0
                : (update.localY | 0) + (update.mapBaseY | 0);

        let resolvedTileX: number | undefined;
        let resolvedTileY: number | undefined;

        // If we have explicit movement directions (OSRS bitpacked movement), apply them to the prior tile.
        if (directions.length > 0 && fromTile && !forcedTeleport) {
            let currX = fromTile.x | 0;
            let currY = fromTile.y | 0;
            for (let i = 0; i < directions.length; i++) {
                const dir = ((directions[i] | 0) & 7) as MovementDirection;
                const delta = directionToDelta(dir);
                currX += delta.dx;
                currY += delta.dy;
            }
            resolvedTileX = currX | 0;
            resolvedTileY = currY | 0;
            resolvedSubX = (currX << 7) + centerOffset;
            resolvedSubY = (currY << 7) + centerOffset;
        }

        update.subX = resolvedSubX | 0;
        update.subY = resolvedSubY | 0;

        // OSRS parity: `pathX/pathY` are in tile coords (south-west tile for size>1).
        // `subX/subY` include a center offset (size*64) so `sub >> 7` is NOT the same tile for size>1.
        const tileX =
            typeof resolvedTileX === "number"
                ? resolvedTileX | 0
                : ((update.subX - centerOffset) >> 7) | 0;
        const tileY =
            typeof resolvedTileY === "number"
                ? resolvedTileY | 0
                : ((update.subY - centerOffset) >> 7) | 0;
        const effectiveFromTile = fromTile ? fromTile : { x: tileX, y: tileY };
        let path: MovementPath;
        if (directions.length > 0 && !forcedTeleport) {
            const steps: MovementStep[] = [];
            let currX = effectiveFromTile.x;
            let currY = effectiveFromTile.y;
            for (let i = 0; i < directions.length; i++) {
                const direction = ((directions[i] | 0) & 7) as MovementDirection;
                const delta = directionToDelta(direction);
                currX += delta.dx;
                currY += delta.dy;
                const traversal = typeof traversals[i] === "number" ? traversals[i] | 0 : 1;
                steps.push({
                    tile: { x: currX, y: currY },
                    direction,
                    run: traversal === 2,
                    traversal,
                });
            }
            path = new MovementPath(effectiveFromTile, { x: currX, y: currY }, steps, false);
        } else {
            const toTile = { x: tileX, y: tileY };
            const dx = (toTile.x - effectiveFromTile.x) | 0;
            const dy = (toTile.y - effectiveFromTile.y) | 0;
            const chebyshev = Math.max(Math.abs(dx), Math.abs(dy)) | 0;
            const queueAbsoluteWalk = update.queueAbsoluteWalk === true;
            if (!forcedTeleport && queueAbsoluteWalk && chebyshev > 0) {
                // OSRS parity: RSNPC.method3656 near-range add/update uses method2907 with class311.field3806
                // (one queued walk target to absolute destination).
                const direction = deltaToDirection(Math.sign(dx), Math.sign(dy));
                if (direction !== undefined) {
                    path = new MovementPath(
                        effectiveFromTile,
                        toTile,
                        [
                            {
                                tile: toTile,
                                direction,
                                run: false,
                                traversal: 1,
                            },
                        ],
                        false,
                    );
                } else {
                    path = new MovementPath(effectiveFromTile, toTile, [], true);
                }
            } else {
                // OSRS parity: direction-less NPC corrections/resetPath updates do not synthesize routes.
                // They snap to authoritative coordinates (teleport/reset-path semantics).
                path = new MovementPath(
                    effectiveFromTile,
                    toTile,
                    [],
                    !forcedTeleport && chebyshev > 0,
                );
            }
        }

        this.applyPath(
            ecsIndex,
            path,
            update,
            forcedTeleport,
            options.forceImmediateRotation === true,
            this.npcEcs.getTargetRot(ecsIndex) | 0,
        );

        return { path, teleported: forcedTeleport || path.isTeleport };
    }

    private applyPath(
        ecsIndex: number,
        path: MovementPath,
        update: NpcMovementUpdate,
        forceTeleport: boolean,
        forceImmediateRotation: boolean,
        fallbackOrientation: number,
    ): void {
        if (!(ecsIndex >= 0)) return;
        const teleported = path.isTeleport || forceTeleport;

        if (teleported) {
            const mapBaseX = update.mapBaseX | 0;
            const mapBaseY = update.mapBaseY | 0;
            const npcSize = Math.max(1, this.npcEcs.getSize(ecsIndex) | 0);
            const centerOffset = (npcSize << 6) | 0; // size * 64
            const worldX = ((path.to.x | 0) << 7) + centerOffset;
            const worldY = ((path.to.y | 0) << 7) + centerOffset;
            const localX = (worldX - mapBaseX) | 0;
            const localY = (worldY - mapBaseY) | 0;
            this.npcEcs.setXY(ecsIndex, localX, localY);
            this.npcEcs.setTargetXY(ecsIndex, localX, localY);
            this.npcEcs.clearServerPath(ecsIndex);
            this.npcEcs.clearStepQueue(ecsIndex);
            this.npcEcs.setWalking(ecsIndex, false);
        } else {
            // OSRS parity: do not discard in-flight steps; client can be a little behind server and
            // will consume the oldest pending step first (Actor.pathX[pathLength-1]).
            if (path.stepCount > 0) {
                const baseX = update.mapBaseX | 0;
                const baseY = update.mapBaseY | 0;
                // OSRS parity: Center offset depends on NPC size (field1175 = size * 64).
                // Reference: ClientPacket.java:635 - var2.x = (var2.pathX[0] << 7) + (var2.transformedSize() << 6)
                // Size 1 NPC: offset = 64, Size 2: offset = 128, etc.
                const npcSize = Math.max(1, this.npcEcs.getSize(ecsIndex) | 0);
                const centerOffset = (npcSize << 6) | 0; // size * 64
                for (const step of path.steps) {
                    const worldX = ((step.tile.x | 0) << 7) + centerOffset;
                    const worldY = ((step.tile.y | 0) << 7) + centerOffset;
                    // OSRS parity: local coords are relative to the current scene base and can exceed a single
                    // 64x64 map-square range while still being in the viewport; clamping here causes desync.
                    const localX = (worldX - baseX) | 0;
                    const localY = (worldY - baseY) | 0;
                    const traversal =
                        typeof step.traversal === "number" ? step.traversal | 0 : step.run ? 2 : 1;
                    // Base walk speed is 4 sub-tile units per client tick (not 5).
                    // Walk: 128 / 4 = 32 client ticks = 640ms per tile (slightly slower than server tick)
                    // Run: 128 / 8 = 16 client ticks = 320ms per tile (4 << 1)
                    // Crawl: 128 / 2 = 64 client ticks = 1280ms per tile (4 >> 1)
                    // The client is designed to fall slightly behind, then catch up when pathLength > 2.
                    const speed = traversal === 2 ? 8 : traversal === 0 ? 2 : 4;
                    this.npcEcs.enqueueStep(ecsIndex, localX, localY, speed);
                }
            }
        }

        this.npcEcs.setServerState(ecsIndex, {
            subX: (typeof update.subX === "number" ? update.subX : 0) | 0,
            subY: (typeof update.subY === "number" ? update.subY : 0) | 0,
            tileX: path.to.x | 0,
            tileY: path.to.y | 0,
            plane: update.level | 0,
        });

        const nextStep = path.steps[0];
        const pathOrientation =
            !teleported && nextStep
                ? undefined
                : nextStep
                ? directionToOrientation(nextStep.direction)
                : undefined;
        const orientation = this.resolveOrientation(
            {
                orientation: update.orientation,
                rotation: update.rotation,
                pathOrientation,
                turned: !!update.turned,
            },
            fallbackOrientation,
        );

        if (orientation !== undefined) {
            // OSRS parity: do not switch desired facing to an upcoming movement segment the
            // moment the packet arrives. Normal walking updates let the active segment take
            // over facing as movement begins; forcing targetRot early makes retreating NPCs
            // instantly snap away from their last combat-facing yaw.
            this.npcEcs.setTargetRot(ecsIndex, orientation);
            if (forceImmediateRotation || teleported) {
                this.npcEcs.setRotation(ecsIndex, orientation);
            }
        }
    }

    private resolveOrientation(
        opts: {
            orientation?: number;
            rotation?: number;
            pathOrientation?: number;
            turned: boolean;
        },
        fallback: number,
    ): number | undefined {
        if (typeof opts.orientation === "number") {
            return (opts.orientation | 0) & 2047;
        }
        if (typeof opts.pathOrientation === "number") {
            return (opts.pathOrientation | 0) & 2047;
        }
        if (typeof opts.rotation === "number" && opts.turned) {
            return (opts.rotation | 0) & 2047;
        }
        if (typeof fallback === "number") {
            return (fallback | 0) & 2047;
        }
        return undefined;
    }
}
