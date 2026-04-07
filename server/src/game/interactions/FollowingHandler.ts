import type { WebSocket } from "ws";
import {
    MODIFIER_FLAG_CTRL,
    MODIFIER_FLAG_CTRL_SHIFT,
} from "../../../../src/shared/input/modifierFlags";
import { hasDirectReachToArea } from "../../pathfinding/DirectReach";
import { PathService } from "../../pathfinding/PathService";
import {
    ExactRouteStrategy,
    RectAdjacentRouteStrategy,
    RouteStrategy,
} from "../../pathfinding/legacy/pathfinder/RouteStrategy";
import { logger } from "../../utils/logger";
import { Actor } from "../actor";
import { PlayerState } from "../player";
import type { PlayerRepository } from "./PlayerInteractionSystem";
import {
    FollowInteractionKind,
    FollowInteractionState,
    PlayerInteractionState,
} from "./types";

export interface FollowingCallbacks {
    onTradeHandshake?: (initiator: PlayerState, target: PlayerState, tick: number) => void;
    onStopAutoAttack?: (playerId: number) => void;
    onInterruptSkillActions?: (playerId: number) => void;
}

export class FollowingHandler {
    constructor(
        public readonly players: PlayerRepository,
        public readonly pathService: PathService,
        public readonly interactions: Map<WebSocket, PlayerInteractionState>,
        public readonly callbacks: FollowingCallbacks,
    ) {}

    private normalizeModifierFlags(raw: number | undefined): number {
        const normalized = raw ?? 0;
        if (normalized === MODIFIER_FLAG_CTRL_SHIFT) {
            return MODIFIER_FLAG_CTRL_SHIFT;
        }
        return (normalized & MODIFIER_FLAG_CTRL) !== 0 ? MODIFIER_FLAG_CTRL : 0;
    }

    private resolveRunMode(player: PlayerState, modifierFlags?: number): boolean {
        let run = player.energy.wantsToRun();
        const flags = this.normalizeModifierFlags(modifierFlags);
        if ((flags & MODIFIER_FLAG_CTRL) !== 0) {
            run = !run;
        }
        if (flags === MODIFIER_FLAG_CTRL_SHIFT) {
            run = true;
        }
        return player.energy.resolveRequestedRun(run);
    }

    private replaceInteractionState(ws: WebSocket, player: PlayerState): void {
        try {
            player.interruptQueues();
        } catch (err) { logger.warn("[interaction] failed to interrupt queues", err); }
        try {
            player.resetInteractions();
        } catch (err) { logger.warn("[interaction] failed to reset interactions", err); }
        // clearAllInteractions inline for follow/trade context
        const st = this.interactions.get(ws);
        if (st) {
            const me = this.players.get(ws);
            if (me) {
                me.combat.removeCombatTarget();
                me.combat.setInteractingNpc(null);
                me.combat.setInteractingPlayer(null);
            }

            if (st.kind === "npcCombat") {
                if (me) {
                    this.callbacks.onStopAutoAttack?.(me.id);
                }
                return;
            }
        }
        this.interactions.delete(ws);
    }

    public isFollowingSocket(ws: WebSocket, targetId: number): boolean {
        const st = this.interactions.get(ws);
        if (!st || st.kind !== "follow") return false;
        return st.targetId === targetId;
    }

    public startFollowing(
        ws: WebSocket,
        targetId: number,
        mode: FollowInteractionKind,
        modifierFlags?: number,
    ): { ok: boolean; message?: string } {
        const me = this.players.get(ws);
        if (!me) return { ok: false, message: "player not found" };
        const target = this.players.getById(targetId);
        if (!target) return { ok: false, message: "target not found" };

        // Block interactions during tutorial
        if (!me.canInteract()) {
            return { ok: false, message: "interaction_blocked" };
        }

        this.replaceInteractionState(ws, me);

        // CRITICAL: Clear any existing path that might walk onto the target's tile
        // This prevents the player from walking onto the target before following logic runs
        me.clearPath();

        const swirlDir: 1 | -1 = ((me.id ^ target.id) & 1) === 0 ? 1 : -1;
        this.interactions.set(ws, {
            kind: mode,
            targetId: target.id,
            modifierFlags: this.normalizeModifierFlags(modifierFlags),
            swirlDir,
            swirlIndex: 0,
        });
        return { ok: true };
    }

    public stopFollowing(ws: WebSocket): void {
        const st = this.interactions.get(ws);
        if (!st) return;
        if (st.kind === "follow" || st.kind === "trade") {
            this.interactions.delete(ws);
            const me = this.players.get(ws);
            me?.clearInteraction();
        }
    }

    public updateFollowing(currentTick: number = 0): void {
        for (const [ws, interaction] of this.interactions.entries()) {
            if (interaction.kind !== "follow" && interaction.kind !== "trade") continue;
            const st = interaction as FollowInteractionState;
            const me = this.players.get(ws);
            if (!me) {
                this.interactions.delete(ws);
                continue;
            }
            const target = this.players.getById(st.targetId);
            if (!target) {
                this.interactions.delete(ws);
            }
            if (!target) {
                me.clearInteraction();
                continue;
            }
            const px = me.tileX;
            const py = me.tileY;
            const tx = target.tileX;
            const ty = target.tileY;
            const trot = target.getOrientation() & 2047;
            const tsec = this.rotToSector(trot);

            const fwd = this.getTargetForward(target);
            const behind = { x: tx - fwd.dx, y: ty - fwd.dy };

            const dCheb = Math.max(Math.abs(tx - px), Math.abs(ty - py));
            const adjacent = dCheb <= 1;
            const edgeReachable =
                adjacent && this.hasDirectReach({ x: px, y: py }, { x: tx, y: ty }, 1, 1, me.level);
            if (st.kind === "trade" && adjacent) {
                if (edgeReachable) {
                    this.interactions.delete(ws);
                    me.clearInteraction();
                    try {
                        this.callbacks.onTradeHandshake?.(me, target, currentTick);
                    } catch (err) { logger.warn("[interaction] trade handshake failed", err); }
                    continue;
                }
                // Otherwise continue to re-route around the obstruction.
            }

            const targetMoved = st.lastTx !== tx || st.lastTy !== ty;
            const lastSector = st.lastSector ?? Number.MIN_SAFE_INTEGER;
            const targetTurned = lastSector !== tsec;
            const atSlot =
                me.tileX === (st.slotX ?? behind.x) && me.tileY === (st.slotY ?? behind.y);
            const wsTargetForAtSlot = this.players.getSocketByPlayerId(target.id);
            const mutualAtSlot =
                wsTargetForAtSlot != null &&
                this.isFollowingWithMode(wsTargetForAtSlot, me.id, "follow");
            if (!mutualAtSlot && !targetMoved && !targetTurned && atSlot && edgeReachable) {
                continue;
            }

            let candidates: { x: number; y: number }[] = [];
            let enforceSingleStep = false;
            if (st.kind === "follow") {
                const ring = this.getFollowRing(tx, ty, tsec);
                const distCheb = Math.max(Math.abs(tx - px), Math.abs(ty - py));
                if (distCheb > 1) {
                    // Use Lost City's approach: path to where the target WAS (followX/followZ)
                    // This prevents pathing through the target's current tile
                    const lastStep = { x: target.followX, y: target.followZ };

                    // CRITICAL: Don't use followX/followZ if it's the target's current tile
                    // This happens when target is stationary
                    const lastStepIsCurrentTile = lastStep.x === tx && lastStep.y === ty;

                    // Start with the target's last position as primary candidate (if valid)
                    if (!lastStepIsCurrentTile) {
                        candidates = [lastStep];
                    } else {
                        candidates = [];
                    }

                    // Add calculated positions as fallbacks
                    const opts = this.getFollowCandidates(tx, ty, fwd.dx, fwd.dy);
                    candidates.push(opts.behind, opts.twoBehind, opts.backLeft, opts.backRight);

                    const key = (o: { x: number; y: number }) => `${o.x},${o.y}`;
                    const used = new Set<string>([
                        key(lastStep),
                        key(opts.behind),
                        key(opts.backLeft),
                        key(opts.backRight),
                    ]);
                    const extras = ring.filter((r) => !used.has(key(r)));
                    extras.sort(
                        (a, b) =>
                            Math.abs(a.x - px) +
                            Math.abs(a.y - py) -
                            (Math.abs(b.x - px) + Math.abs(b.y - py)),
                    );
                    candidates.push(...extras);
                    st.swirlIndex = 0;
                } else {
                    const wsTarget = this.players.getSocketByPlayerId(target.id);
                    const targetFollowingMe =
                        wsTarget != null && this.isFollowingWithMode(wsTarget, me.id, "follow");
                    if (!targetFollowingMe) {
                        st.swirlIndex = 0;

                        // CRITICAL: If we're on the target's tile, we need to move!
                        const onTargetTile = px === tx && py === ty;

                        const maintainFacing =
                            !onTargetTile &&
                            !targetMoved &&
                            !targetTurned &&
                            st.lastTx === tx &&
                            st.lastTy === ty &&
                            st.slotX === px &&
                            st.slotY === py;
                        if (maintainFacing && edgeReachable) continue;

                        if (!edgeReachable || (behind.x === tx && behind.y === ty)) {
                            candidates = ring.slice();
                            enforceSingleStep = true;
                        } else {
                            st.slotX = behind.x;
                            st.slotY = behind.y;
                            const strategy = new RectAdjacentRouteStrategy(
                                behind.x,
                                behind.y,
                                1,
                                1,
                            );
                            const arrived = strategy.hasArrived(px, py, me.level);
                            if (!arrived || onTargetTile) {
                                const routed = this.routePlayerToTile(
                                    me,
                                    behind,
                                    this.resolveRunMode(me, st.modifierFlags),
                                );
                                if (!routed) {
                                    candidates = ring.slice();
                                    enforceSingleStep = true;
                                } else {
                                    st.lastTx = tx;
                                    st.lastTy = ty;
                                    st.lastRot = trot;
                                    st.lastSector = tsec;
                                    st.slotX = behind.x;
                                    st.slotY = behind.y;
                                    continue;
                                }
                            } else {
                                st.lastTx = tx;
                                st.lastTy = ty;
                                st.lastRot = trot;
                                st.lastSector = tsec;
                                st.slotX = behind.x;
                                st.slotY = behind.y;
                                continue;
                            }
                        }
                    } else {
                        const ringSwirl = this.getSwirlRing(tx, ty, st.swirlDir);
                        const slotIdx = st.swirlIndex % ringSwirl.length;
                        const slot = ringSwirl[slotIdx];
                        st.swirlIndex = (st.swirlIndex + 1) % ringSwirl.length;
                        candidates = [slot];
                        enforceSingleStep = true;
                    }
                }
            } else {
                candidates = this.getTradePositions(tx, ty);
                enforceSingleStep = true;
            }

            const wantsRun = this.resolveRunMode(me, st.modifierFlags);
            const maxAttempts = Math.min(8, candidates.length);
            let routed = false;

            // CRITICAL: If we're on the same tile, force a direct step without pathfinding
            // The pathfinder fails because collision is blocked by the target player
            if (px === tx && py === ty) {
                // Calculate "behind" position based on target's facing direction
                // This ensures we move behind them, not in front
                const forceTile = behind;

                // Verify behind is not the same as target tile (shouldn't happen but safety check)
                if (forceTile.x === tx && forceTile.y === ty && candidates.length > 0) {
                    // Fallback to first ring candidate if behind calculation failed
                    const fallback = candidates[0];
                    me.setPath([{ x: fallback.x, y: fallback.y }], wantsRun);
                    st.slotX = fallback.x;
                    st.slotY = fallback.y;
                } else {
                    // Apply a direct single-step path to behind position
                    me.setPath([{ x: forceTile.x, y: forceTile.y }], wantsRun);
                    st.slotX = forceTile.x;
                    st.slotY = forceTile.y;
                }

                st.lastTx = tx;
                st.lastTy = ty;
                st.lastRot = trot;
                st.lastSector = tsec;
                continue;
            }

            let earlyExit = false;
            for (let i = 0; i < maxAttempts; i++) {
                const tile = candidates[i];
                if (!tile) continue;

                // CRITICAL: Skip if this candidate is the target's current tile
                // This prevents followers from stopping on top of the target
                if (tile.x === tx && tile.y === ty) {
                    continue;
                }

                // Check if we're currently on the target's tile
                const onTargetTile = px === tx && py === ty;

                const strategy = new RectAdjacentRouteStrategy(tile.x, tile.y, 1, 1);
                // CRITICAL: If we're on the target's tile, force movement even if "arrived"
                // Don't use hasArrived check because it returns true for adjacent positions
                if (!onTargetTile && strategy.hasArrived(px, py, me.level)) {
                    st.slotX = tile.x;
                    st.slotY = tile.y;
                    routed = true;
                    break;
                }
                const path = this.pathService.findPathSteps(
                    {
                        from: { x: px, y: py, plane: me.level },
                        to: { x: tile.x, y: tile.y },
                        size: 1,
                    },
                    { maxSteps: 128, routeStrategy: strategy },
                );
                const steps = this.extractValidatedStrategyPathSteps(me, path, strategy);
                if (!steps) {
                    continue;
                }

                // Check if path goes through target's tile
                const pathThroughTarget = steps.some((step) => step.x === tx && step.y === ty);
                if (pathThroughTarget) {
                    continue; // Try next candidate
                }

                if (enforceSingleStep) {
                    if (steps.length > 1) {
                        earlyExit = true;
                        break;
                    }
                }

                this.applyPathSteps(me, steps, wantsRun);
                st.slotX = tile.x;
                st.slotY = tile.y;
                routed = true;
                break;
            }

            if (earlyExit) {
                st.lastTx = tx;
                st.lastTy = ty;
                st.lastRot = trot;
                st.lastSector = tsec;
                continue;
            }

            if (!routed && st.kind === "follow" && st.slotX != null && st.slotY != null) {
                // Skip if fallback slot is target's current tile
                if (st.slotX === tx && st.slotY === ty) {
                    // Skip fallback
                } else {
                    const strategy = new RectAdjacentRouteStrategy(st.slotX, st.slotY, 1, 1);
                    const arrived = strategy.hasArrived(px, py, me.level);
                    if (!arrived) {
                        const lastPath = this.pathService.findPathSteps(
                            {
                                from: { x: px, y: py, plane: me.level },
                                to: { x: st.slotX, y: st.slotY },
                                size: 1,
                            },
                            { maxSteps: 128, routeStrategy: strategy },
                        );
                        const lastSteps = this.extractValidatedStrategyPathSteps(
                            me,
                            lastPath,
                            strategy,
                        );
                        if (lastSteps && lastSteps.length > 0) {
                            // Check if fallback path goes through target
                            const fallbackThroughTarget = lastSteps.some(
                                (step) => step.x === tx && step.y === ty,
                            );

                            if (!fallbackThroughTarget) {
                                this.applyPathSteps(me, lastSteps, wantsRun);
                                routed = true;
                            }
                        }
                    } else {
                        routed = true;
                    }
                }
            }

            st.lastTx = tx;
            st.lastTy = ty;
            st.lastRot = trot;
            st.lastSector = tsec;

            if (!routed && st.kind === "trade") {
                this.interactions.delete(ws);
                me.clearInteraction();
                me.clearPath();
            }
        }
    }

    public getTargetForward(target: PlayerState): { dx: number; dy: number } {
        const queue = target.getPathQueue();
        if (queue.length > 0) {
            const next = queue[0];
            const dx = Math.sign(next.x - target.tileX);
            const dy = Math.sign(next.y - target.tileY);
            if (dx !== 0 || dy !== 0) return { dx, dy };
        }
        const sector = this.rotToSector(target.getOrientation() & 2047);
        const map: { dx: number; dy: number }[] = [
            { dx: 0, dy: -1 },
            { dx: -1, dy: -1 },
            { dx: -1, dy: 0 },
            { dx: -1, dy: 1 },
            { dx: 0, dy: 1 },
            { dx: 1, dy: 1 },
            { dx: 1, dy: 0 },
            { dx: 1, dy: -1 },
        ];
        return map[sector];
    }

    public rotToSector(rot: number): number {
        return Math.round((rot & 2047) / 256) & 7;
    }

    public getFollowCandidates(
        tx: number,
        ty: number,
        fdx: number,
        fdy: number,
    ): {
        behind: { x: number; y: number };
        backLeft: { x: number; y: number };
        backRight: { x: number; y: number };
        twoBehind: { x: number; y: number };
    } {
        const behind = { x: tx - fdx, y: ty - fdy };
        const backLeft = { x: behind.x - fdy, y: behind.y + fdx };
        const backRight = { x: behind.x + fdy, y: behind.y - fdx };
        const twoBehind = { x: tx - 2 * fdx, y: ty - 2 * fdy };
        return { behind, backLeft, backRight, twoBehind };
    }

    public getFollowRing(tx: number, ty: number, sector: number): { x: number; y: number }[] {
        const offsets = [
            { x: 0, y: -1 },
            { x: -1, y: -1 },
            { x: -1, y: 0 },
            { x: -1, y: 1 },
            { x: 0, y: 1 },
            { x: 1, y: 1 },
            { x: 1, y: 0 },
            { x: 1, y: -1 },
        ];
        const rotated = offsets.map((offset, idx) => {
            const rel = offsets[(idx + sector) & 7];
            return { x: tx + rel.x, y: ty + rel.y };
        });
        return rotated;
    }

    public getSwirlRing(tx: number, ty: number, dir: 1 | -1): { x: number; y: number }[] {
        return dir === 1
            ? [
                  { x: tx, y: ty - 1 },
                  { x: tx + 1, y: ty - 1 },
                  { x: tx + 1, y: ty },
                  { x: tx + 1, y: ty + 1 },
                  { x: tx, y: ty + 1 },
                  { x: tx - 1, y: ty + 1 },
                  { x: tx - 1, y: ty },
                  { x: tx - 1, y: ty - 1 },
              ]
            : [
                  { x: tx, y: ty - 1 },
                  { x: tx - 1, y: ty - 1 },
                  { x: tx - 1, y: ty },
                  { x: tx - 1, y: ty + 1 },
                  { x: tx, y: ty + 1 },
                  { x: tx + 1, y: ty + 1 },
                  { x: tx + 1, y: ty },
                  { x: tx + 1, y: ty - 1 },
              ];
    }

    public getTradePositions(tx: number, ty: number): { x: number; y: number }[] {
        return [
            { x: tx, y: ty - 1 },
            { x: tx - 1, y: ty },
            { x: tx + 1, y: ty },
            { x: tx, y: ty + 1 },
            { x: tx - 1, y: ty - 1 },
            { x: tx + 1, y: ty - 1 },
            { x: tx - 1, y: ty + 1 },
            { x: tx + 1, y: ty + 1 },
        ];
    }

    public applyPathSteps(actor: Actor, steps: { x: number; y: number }[], run: boolean): boolean {
        const normalizedSteps = Array.isArray(steps) ? steps.map((s) => ({ x: s.x, y: s.y })) : [];

        let prevX = actor.tileX;
        let prevY = actor.tileY;
        for (const step of normalizedSteps) {
            const dx = Math.abs(step.x - prevX);
            const dy = Math.abs(step.y - prevY);
            // path buffers are per-tile steps (Chebyshev distance 1).
            if (dx > 1 || dy > 1 || (dx === 0 && dy === 0)) {
                return false;
            }
            prevX = step.x;
            prevY = step.y;
        }
        const currentQueue = actor.getPathQueue();
        const sameQueue =
            currentQueue.length === normalizedSteps.length &&
            currentQueue.every((step, idx) => {
                const other = normalizedSteps[idx];
                return other && step.x === other.x && step.y === other.y;
            });
        if (sameQueue) {
            actor.running = run;
            return false;
        }
        actor.setPath(normalizedSteps, run);
        return true;
    }

    public routePlayerToTile(player: PlayerState, tile: { x: number; y: number }, run: boolean) {
        const steps = this.findPlayerPathToTile(player, tile);
        if (!steps) {
            return false;
        }
        if (steps.length === 0) {
            return true;
        }
        this.applyPathSteps(player, steps, run);
        return true;
    }

    public findPlayerPathToTile(
        player: PlayerState,
        tile: { x: number; y: number },
    ): { x: number; y: number }[] | undefined {
        // OSRS semantics: walking to a specific tile uses exact routing, not
        // rectangle adjacency. Using adjacency here allows diagonal "corner hug"
        // arrivals which feel off for 1x1 destinations.
        const rs = new ExactRouteStrategy();
        rs.approxDestX = tile.x;
        rs.approxDestY = tile.y;
        rs.destSizeX = 1;
        rs.destSizeY = 1;

        const res = this.pathService.findPathSteps(
            {
                from: { x: player.tileX, y: player.tileY, plane: player.level },
                to: tile,
                size: 1,
            },
            { maxSteps: 128, routeStrategy: rs },
        );
        if (!res.ok || !Array.isArray(res.steps)) {
            return undefined;
        }
        if (res.steps.length === 0 && !rs.hasArrived(player.tileX, player.tileY, player.level)) {
            return undefined;
        }
        return res.steps;
    }

    private isFollowingWithMode(ws: WebSocket, targetId: number, mode: FollowInteractionKind): boolean {
        const st = this.interactions.get(ws);
        if (!st || st.kind !== mode) return false;
        return st.targetId === targetId;
    }

    private hasDirectReach(
        from: { x: number; y: number },
        tile: { x: number; y: number },
        sizeX: number,
        sizeY: number,
        level: number,
    ): boolean {
        return hasDirectReachToArea(this.pathService, from, tile, sizeX, sizeY, level);
    }

    private extractValidatedStrategyPathSteps(
        actor: { tileX: number; tileY: number; level: number },
        res: { ok: boolean; steps?: { x: number; y: number }[]; end?: { x: number; y: number } },
        strategy: RouteStrategy,
    ): { x: number; y: number }[] | undefined {
        if (!res.ok || !Array.isArray(res.steps)) {
            return undefined;
        }

        const selectedEnd =
            res.steps.length > 0
                ? res.end ?? res.steps[res.steps.length - 1]!
                : { x: actor.tileX, y: actor.tileY };
        if (!strategy.hasArrived(selectedEnd.x, selectedEnd.y, actor.level)) {
            return undefined;
        }

        return res.steps;
    }
}
