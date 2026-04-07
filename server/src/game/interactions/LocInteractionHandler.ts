import type { LocTypeLoader } from "../../../../src/rs/config/loctype/LocTypeLoader";
import { LocModelType } from "../../../../src/rs/config/loctype/LocModelType";
import type { LocType } from "../../../../src/rs/config/loctype/LocType";
import type { WebSocket } from "ws";
import { PathService } from "../../pathfinding/PathService";
import {
    CardinalAdjacentRouteStrategy,
    RectAdjacentRouteStrategy,
    RectRouteStrategy,
    RectWithinRangeRouteStrategy,
    RouteStrategy,
} from "../../pathfinding/legacy/pathfinder/RouteStrategy";
import { CollisionFlag } from "../../pathfinding/legacy/pathfinder/flag/CollisionFlag";
import { logger } from "../../utils/logger";
import { DoorStateManager } from "../../world/DoorStateManager";
import { loadVisibleLocTypeForPlayer } from "../../world/LocTransforms";
import type { Actor } from "../actor";
import { PlayerState } from "../player";
import type { ScriptRuntime } from "../scripts/ScriptRuntime";
import type { PlayerRepository } from "./PlayerInteractionSystem";
import { PendingLocInteraction } from "./types";

export type LocRouteProfile =
    | { kind: "cardinal" }
    | { kind: "adjacent" }
    | { kind: "adjacent_overlap" }
    | { kind: "range"; distance: number }
    | { kind: "inside" };

export type SizedLocDefinition = {
    sizeX?: unknown;
    sizeY?: unknown;
};

export type VisibleLocRouteState = {
    locId: number;
    sizeX: number;
    sizeY: number;
};

export const WALLISH_TYPES = new Set<LocModelType>([
    LocModelType.WALL,
    LocModelType.WALL_TRI_CORNER,
    LocModelType.WALL_CORNER,
    LocModelType.WALL_RECT_CORNER,
    LocModelType.WALL_DECORATION_INSIDE,
    LocModelType.WALL_DECORATION_OUTSIDE,
    LocModelType.WALL_DECORATION_DIAGONAL_OUTSIDE,
    LocModelType.WALL_DECORATION_DIAGONAL_INSIDE,
    LocModelType.WALL_DECORATION_DIAGONAL_DOUBLE,
    LocModelType.WALL_DIAGONAL,
]);

function normalizePositiveInt(value: unknown, fallback = 1): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return fallback;
    }
    return Math.max(1, Math.trunc(value));
}

function normalizeInt(value: number | undefined, fallback = 0): number {
    if (value === undefined || !Number.isFinite(value)) {
        return fallback;
    }
    return Math.trunc(value);
}

export interface LocInteractionCallbacks {
    onLocChange?: (
        oldId: number,
        newId: number,
        tile: { x: number; y: number },
        level: number,
        opts?: {
            oldTile?: { x: number; y: number };
            newTile?: { x: number; y: number };
            oldRotation?: number;
            newRotation?: number;
        },
    ) => void;
    onGameMessage?: (player: PlayerState, text: string) => void;
    onInterruptSkillActions?: (playerId: number) => void;
}

export interface LocInteractionSystemBridge {
    replaceInteractionState(ws: WebSocket, player: PlayerState): void;
    interruptSkillActions(playerId: number): void;
    normalizeModifierFlags(raw: number | undefined): number;
    resolveRunMode(player: PlayerState, modifierFlags?: number): boolean;
    extractValidatedStrategyPathSteps(
        actor: { tileX: number; tileY: number; level: number },
        res: { ok: boolean; steps?: { x: number; y: number }[]; end?: { x: number; y: number } },
        strategy: RouteStrategy,
    ): { x: number; y: number }[] | undefined;
    applyPathSteps(actor: Actor, steps: { x: number; y: number }[], run: boolean): boolean;
    routePlayerToTile(player: PlayerState, tile: { x: number; y: number }, run: boolean): boolean;
    findReachableAdjacency(
        from: { x: number; y: number },
        tile: { x: number; y: number },
        sizeX: number,
        sizeY: number,
        level: number,
    ): { x: number; y: number } | undefined;
}

export class LocInteractionHandler {
    private readonly locRouteProfileCache = new Map<number, LocRouteProfile>();

    constructor(
        private readonly players: PlayerRepository,
        private readonly pathService: PathService,
        private readonly locTypeLoader: LocTypeLoader | undefined,
        private readonly doorManager: DoorStateManager | undefined,
        private readonly scriptRuntime: ScriptRuntime | undefined,
        private readonly pendingLocInteractions: Map<WebSocket, PendingLocInteraction>,
        private readonly callbacks: LocInteractionCallbacks,
        private readonly bridge: LocInteractionSystemBridge,
    ) {}

    startLocInteract(ws: WebSocket, data: PendingLocInteraction): void {
        this.startLocInteractAtTick(ws, data);
    }

    startLocInteractAtTick(ws: WebSocket, data: PendingLocInteraction, currentTick?: number): void {
        const me = this.players.get(ws);
        if (!me) return;

        // Block interactions during tutorial
        if (!me.canInteract()) {
            return;
        }

        // Starting a new loc interaction cancels any active skill actions
        this.bridge.interruptSkillActions(me.id);
        this.bridge.replaceInteractionState(ws, me);

        // Clicking an object replaces any in-flight click-to-walk intent.
        // This also handles immediate interactions (already in range) where no new path is set.
        me.clearPath();
        me.clearWalkDestination();

        const pending: PendingLocInteraction = {
            id: data.id,
            tile: { x: data.tile.x, y: data.tile.y },
            level: data.level,
            action: data.action,
            modifierFlags: this.bridge.normalizeModifierFlags(data.modifierFlags),
        };
        const resolved = this.resolvePendingLocInteraction(me, pending);

        // Never execute loc interactions immediately from the
        // message handler.  Always defer to the next tick's pre-movement phase
        // so that the animation queued by the script is consumed by
        // popPendingSeq BEFORE the delayed teleport fires in the combat phase.
        // This also matches the OSRS packet dump where the player is "idle"
        // (not walking) when the interaction fires — it always waits a tick.
        if (!resolved.hasArrived) {
            this.applyLocInteractionRoute(me, pending, resolved);
        }
        this.pendingLocInteractions.set(ws, pending);
    }

    resolvePendingLocInteraction(
        player: PlayerState,
        pending: PendingLocInteraction,
    ): {
        interactionLevel: number;
        rect: { tile: { x: number; y: number }; sizeX: number; sizeY: number };
        routeSizeX: number;
        routeSizeY: number;
        strategy: RouteStrategy;
        hasArrived: boolean;
    } {
        const level = pending.level !== undefined ? normalizeInt(pending.level) : player.level;
        const visibleLoc = this.resolveVisibleLocRouteState(player, pending.id);
        const tile = this.resolveDoorRouteTile(
            visibleLoc.locId,
            {
                x: normalizeInt(pending.tile.x),
                y: normalizeInt(pending.tile.y),
            },
            level,
            pending.action,
        );
        const rect = this.resolveLocRouteRect(tile, visibleLoc.sizeX, visibleLoc.sizeY, level);
        const routeSizeX = Math.max(rect.sizeX, visibleLoc.sizeX);
        const routeSizeY = Math.max(rect.sizeY, visibleLoc.sizeY);
        const strategy = this.selectLocRouteStrategy(
            visibleLoc.locId,
            rect.tile,
            pending.action,
            routeSizeX,
            routeSizeY,
            level,
        );
        const hasArrived = strategy.hasArrived(player.tileX, player.tileY, player.level);
        return {
            interactionLevel: level,
            rect,
            routeSizeX,
            routeSizeY,
            strategy,
            hasArrived,
        };
    }

    applyLocInteractionRoute(
        player: PlayerState,
        pending: PendingLocInteraction,
        resolved = this.resolvePendingLocInteraction(player, pending),
    ): void {
        if (!player) return;
        if (resolved.hasArrived) {
            return;
        }
        const res = this.pathService.findPathSteps(
            {
                from: { x: player.tileX, y: player.tileY, plane: player.level },
                to: { x: resolved.rect.tile.x, y: resolved.rect.tile.y },
                size: 1,
            },
            { maxSteps: 128, routeStrategy: resolved.strategy },
        );
        const steps = this.bridge.extractValidatedStrategyPathSteps(player, res, resolved.strategy);
        if (steps && steps.length > 0) {
            const wantsRun = this.bridge.resolveRunMode(player, pending.modifierFlags);
            this.bridge.applyPathSteps(player, steps, wantsRun);
        }
    }

    executeLocInteraction(
        player: PlayerState,
        info: PendingLocInteraction,
        interactionLevel: number,
        routeTile: { x: number; y: number },
        routeSizeX: number,
        routeSizeY: number,
        tick: number,
        immediate: boolean,
    ): boolean {
        player.clearPath();
        player.clearWalkDestination();
        this.faceLocOnInteraction(player, routeTile, routeSizeX, routeSizeY);

        const event = {
            tick: tick,
            player,
            locId: info.id,
            tile: { x: info.tile.x, y: info.tile.y },
            level: interactionLevel,
            action: info.action,
        };
        const scriptHandled = immediate
            ? this.scriptRuntime?.runLocInteractionNow(event) ?? false
            : this.scriptRuntime?.queueLocInteraction(event) ?? false;
        if (scriptHandled) {
            return true;
        }

        try {
            const action = info.action ? ` action="${info.action}"` : "";
            logger.info(
                `Player ${player.id} interacted with loc ${info.id} at (${info.tile.x},${info.tile.y},${interactionLevel})${action}`,
            );

            const actionLower = info.action?.toLowerCase() ?? "";
            const doorResult = this.doorManager?.toggleDoor({
                x: info.tile.x,
                y: info.tile.y,
                level: interactionLevel,
                currentId: info.id,
                action: info.action,
                currentTick: tick,
            });
            if (doorResult?.success && doorResult.newLocId !== undefined) {
                const level = interactionLevel;
                logger.info(
                    `[DOOR] Triggering loc change from ${info.id} to ${
                        doorResult.newLocId
                    } (action=${info.action ?? "unknown"})`,
                );
                if (this.callbacks.onLocChange) {
                    this.callbacks.onLocChange(info.id, doorResult.newLocId, info.tile, level, {
                        oldTile: info.tile,
                        newTile: doorResult.newTile ?? info.tile,
                        oldRotation: doorResult.oldRotation,
                        newRotation: doorResult.newRotation,
                    });
                    if (doorResult.partnerResult) {
                        this.callbacks.onLocChange(
                            doorResult.partnerResult.oldLocId,
                            doorResult.partnerResult.newLocId,
                            doorResult.partnerResult.oldTile,
                            level,
                            {
                                oldTile: doorResult.partnerResult.oldTile,
                                newTile: doorResult.partnerResult.newTile,
                                oldRotation: doorResult.partnerResult.oldRotation,
                                newRotation: doorResult.partnerResult.newRotation,
                            },
                        );
                    }
                    logger.info("[DOOR] Loc change callback executed");
                } else {
                    logger.warn("[DOOR] No onLocChange callback set!");
                }
            } else if (
                actionLower &&
                Boolean(this.doorManager?.isDoorAction(info.action)) &&
                !doorResult?.success
            ) {
                logger.warn(`[DOOR] No reverse id found for loc ${info.id}`);
            }
        } catch (err) { logger.warn("[interaction] loc action handler failed", err); }

        return true;
    }

    updateLocInteractions(currentTick?: number): void {
        const tick = currentTick ?? 0;
        for (const [ws, info] of this.pendingLocInteractions.entries()) {
            const me = this.players.get(ws);
            if (!me) {
                this.pendingLocInteractions.delete(ws);
                return;
            }
            if (info.level !== undefined && me.level !== info.level) continue;
            const resolved = this.resolvePendingLocInteraction(me, info);
            const interactionLevel = resolved.interactionLevel;
            const rect = resolved.rect;
            const routeSizeX = resolved.routeSizeX;
            const routeSizeY = resolved.routeSizeY;
            const insideRect =
                me.tileX >= rect.tile.x &&
                me.tileX <= rect.tile.x + routeSizeX - 1 &&
                me.tileY >= rect.tile.y &&
                me.tileY <= rect.tile.y + routeSizeY - 1;

            const arrived = resolved.hasArrived;
            // If we've satisfied the route strategy (including wall checks), interact immediately.
            if (arrived) {
                this.executeLocInteraction(
                    me,
                    info,
                    interactionLevel,
                    rect.tile,
                    routeSizeX,
                    routeSizeY,
                    tick,
                    false,
                );
                this.pendingLocInteractions.delete(ws);
                continue;
            }

            // If we're standing inside the rect but the route strategy hasn't been satisfied,
            // move to the nearest reachable edge instead of bouncing around the tile.
            if (insideRect && !arrived) {
                const fallbackInside = this.bridge.findReachableAdjacency(
                    { x: me.tileX, y: me.tileY },
                    rect.tile,
                    routeSizeX,
                    routeSizeY,
                    interactionLevel,
                );
                if (fallbackInside) {
                    this.bridge.routePlayerToTile(
                        me,
                        fallbackInside,
                        this.bridge.resolveRunMode(me, info.modifierFlags),
                    );
                    continue;
                }
            }
        }
    }

    /**
     * Make the player face the loc when interaction triggers.
     * For normal objects (trees, rocks, etc.), face towards the center of the object.
     * This matches RSMod's faceObj behavior.
     */
    faceLocOnInteraction(
        player: PlayerState,
        locTile: { x: number; y: number },
        sizeX: number,
        sizeY: number,
    ): void {
        // Calculate the center of the object (using half-tile offsets like RSMod)
        // For a 1x1 object at (x, y), face tile (x, y)
        // For a 2x2 object at (x, y), face tile (x + 1, y + 1) - the center
        const centerX = locTile.x + (sizeX >> 1);
        const centerY = locTile.y + (sizeY >> 1);

        // Only face if we're not already on the same tile
        if (player.tileX !== centerX || player.tileY !== centerY) {
            player.faceTile(centerX, centerY);
        }
    }

    // Decide the route strategy for a loc interaction using the loc definition metadata.
    // Sets collision getter on wall-aware strategies so hasArrived() checks walls.
    selectLocRouteStrategy(
        id: number,
        tile: { x: number; y: number },
        action: string | undefined,
        sizeX: number,
        sizeY: number,
        level: number,
    ): RouteStrategy {
        const profile = this.getLocRouteProfile(id);
        const collisionGetter = (x: number, y: number, p: number) =>
            this.pathService.getCollisionFlagAt(x, y, p);
        const isDoorInteraction = this.isDoorAction(action);
        const doorBlockedSides = isDoorInteraction
            ? this.doorManager?.getDoorBlockedDirections(tile.x, tile.y, level, id)
            : undefined;

        if (profile.kind === "cardinal") {
            const allowDoorOverlap = isDoorInteraction;
            const strat = new CardinalAdjacentRouteStrategy(
                tile.x,
                tile.y,
                sizeX,
                sizeY,
                allowDoorOverlap,
                doorBlockedSides,
            );
            // Door interactions must be possible from either side of the closed wall edge.
            // Keep wall-edge blocking checks for non-door wall interactions.
            if (!isDoorInteraction) {
                strat.setCollisionGetter(collisionGetter, level);
            }
            return strat;
        }
        if (profile.kind === "range") {
            return new RectWithinRangeRouteStrategy(
                tile.x,
                tile.y,
                sizeX,
                sizeY,
                Math.max(1, profile.distance),
            );
        }
        if (profile.kind === "inside") {
            return new RectRouteStrategy(tile.x, tile.y, Math.max(1, sizeX), Math.max(1, sizeY));
        }
        if (profile.kind === "adjacent_overlap") {
            const strat = new RectAdjacentRouteStrategy(
                tile.x,
                tile.y,
                sizeX,
                sizeY,
                true, // allowOverlap
                false, // allowLargeDiagonal - OSRS blocks diagonal interactions
            );
            strat.setCollisionGetter(collisionGetter, level);
            return strat;
        }
        const strat = new RectAdjacentRouteStrategy(
            tile.x,
            tile.y,
            sizeX,
            sizeY,
            false, // allowOverlap
            false, // allowLargeDiagonal - OSRS blocks diagonal interactions
        );
        strat.setCollisionGetter(collisionGetter, level);
        return strat;
    }

    isDoorAction(action: string | undefined): boolean {
        if (!action) return false;
        if (this.doorManager?.isDoorAction(action)) {
            return true;
        }
        const actionLower = action.toLowerCase();
        return (
            actionLower === "open" ||
            actionLower === "close" ||
            actionLower === "unlock" ||
            actionLower === "lock" ||
            actionLower.startsWith("pay-toll(")
        );
    }

    getLocRouteProfile(locId: number): LocRouteProfile {
        const cached = this.locRouteProfileCache.get(locId);
        if (cached) return cached;
        const profile = this.deriveLocRouteProfile(locId);
        this.locRouteProfileCache.set(locId, profile);
        return profile;
    }

    deriveLocRouteProfile(locId: number): LocRouteProfile {
        const fallback: LocRouteProfile = { kind: "adjacent" };
        const loader = this.locTypeLoader;
        if (!loader) {
            return fallback;
        }
        let loc: LocType;
        try {
            loc = loader.load(locId);
        } catch {
            return fallback;
        }
        if (!loc) {
            return fallback;
        }
        const typeList: number[] =
            Array.isArray(loc.types) && loc.types.length > 0
                ? loc.types.map((t: number) => t)
                : [LocModelType.NORMAL];
        const isWallish = typeList.some((type) => WALLISH_TYPES.has(type as LocModelType));
        if (isWallish) {
            return { kind: "cardinal" };
        }
        const clipType = Number.isFinite(loc.clipType) ? (loc.clipType as number) : 0;
        const sizeX = Math.max(1, loc.sizeX);
        const sizeY = Math.max(1, loc.sizeY);
        if (clipType === 0) {
            // Floor decorations (e.g., traps, rugs) are interacted with by standing on them
            if (typeList.includes(LocModelType.FLOOR_DECORATION)) {
                return { kind: "inside" };
            }

            // Scenery with actions (e.g., flax, small plants) that doesn't block movement
            // should usually be interacted with from adjacent tiles, not by standing on top.
            if (
                loc.actions &&
                Array.isArray(loc.actions) &&
                loc.actions.some((action: string | undefined) =>
                    Boolean(action && action.length > 0),
                )
            ) {
                return { kind: "adjacent_overlap" };
            }

            return { kind: "inside" };
        }
        // Note: blocksProjectile is only relevant for ranged/magic attacks on NPCs,
        // not for loc interactions. All loc interactions require cardinal adjacency.
        return fallback;
    }

    shouldPreservePendingLocInteraction(
        pending: PendingLocInteraction,
        destination: { x: number; y: number } | undefined,
        player: PlayerState | undefined,
    ): boolean {
        if (!destination || !player) return false;
        const level = pending.level !== undefined ? normalizeInt(pending.level) : player.level;
        const visibleLoc = this.resolveVisibleLocRouteState(player, pending.id);
        const rect = this.resolveLocRouteRect(
            this.resolveDoorRouteTile(
                visibleLoc.locId,
                {
                    x: normalizeInt(pending.tile.x),
                    y: normalizeInt(pending.tile.y),
                },
                level,
                pending.action,
            ),
            visibleLoc.sizeX,
            visibleLoc.sizeY,
            level,
        );
        const routeSizeX = Math.max(rect.sizeX, visibleLoc.sizeX);
        const routeSizeY = Math.max(rect.sizeY, visibleLoc.sizeY);
        const destInside =
            destination.x >= rect.tile.x &&
            destination.x <= rect.tile.x + routeSizeX - 1 &&
            destination.y >= rect.tile.y &&
            destination.y <= rect.tile.y + routeSizeY - 1;
        if (destInside) return true;
        const strategy = this.selectLocRouteStrategy(
            visibleLoc.locId,
            rect.tile,
            pending.action,
            routeSizeX,
            routeSizeY,
            level,
        );
        return strategy.hasArrived(destination.x, destination.y, level);
    }

    resolveVisibleLocRouteState(player: PlayerState, locId: number): VisibleLocRouteState {
        const visible = loadVisibleLocTypeForPlayer(this.locTypeLoader, player, locId);
        if (!visible) {
            return {
                locId: normalizeInt(locId),
                sizeX: 1,
                sizeY: 1,
            };
        }

        const routeType = visible.type as SizedLocDefinition | undefined;
        return {
            locId: visible.id,
            sizeX: normalizePositiveInt(routeType?.sizeX),
            sizeY: normalizePositiveInt(routeType?.sizeY),
        };
    }

    resolveDoorRouteTile(
        locId: number,
        tile: { x: number; y: number },
        level: number,
        action: string | undefined,
    ): { x: number; y: number } {
        const normalized = { x: tile.x, y: tile.y };
        if (!this.isDoorAction(action)) {
            return normalized;
        }
        const resolved = this.doorManager?.resolveDoorInteractionTile(
            normalized.x,
            normalized.y,
            level,
            locId,
        );
        if (!resolved) {
            return normalized;
        }
        return { x: resolved.x, y: resolved.y };
    }

    resolveLocRouteRect(
        tile: { x: number; y: number },
        sizeX: number,
        sizeY: number,
        level?: number,
    ): { tile: { x: number; y: number }; sizeX: number; sizeY: number } {
        const normalized = {
            tile: { x: tile.x, y: tile.y },
            sizeX: Math.max(1, sizeX),
            sizeY: Math.max(1, sizeY),
        };
        if (level === undefined || !Number.isFinite(level)) {
            return normalized;
        }
        const rect = this.deriveLocCollisionRect(
            normalized.tile,
            normalized.sizeX,
            normalized.sizeY,
            level,
        );
        return rect ?? normalized;
    }

    deriveLocCollisionRect(
        tile: { x: number; y: number },
        sizeX: number,
        sizeY: number,
        level: number,
    ): { tile: { x: number; y: number }; sizeX: number; sizeY: number } | undefined {
        const mask = CollisionFlag.OBJECT | CollisionFlag.OBJECT_ROUTE_BLOCKER;
        let minX = Number.POSITIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        let found = false;
        for (let dx = 0; dx < sizeX; dx++) {
            for (let dy = 0; dy < sizeY; dy++) {
                const wx = tile.x + dx;
                const wy = tile.y + dy;
                const flag = this.pathService.getCollisionFlagAt(wx, wy, level);
                if (flag === undefined) continue;
                if ((flag & mask) === 0) continue;
                found = true;
                if (wx < minX) minX = wx;
                if (wy < minY) minY = wy;
                if (wx > maxX) maxX = wx;
                if (wy > maxY) maxY = wy;
            }
        }
        if (!found) return undefined;
        return {
            tile: { x: minX, y: minY },
            sizeX: Math.max(1, maxX - minX + 1),
            sizeY: Math.max(1, maxY - minY + 1),
        };
    }
}
