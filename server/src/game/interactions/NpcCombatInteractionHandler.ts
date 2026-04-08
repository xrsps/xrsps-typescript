import type { WebSocket } from "ws";
import { PathService } from "../../pathfinding/PathService";
import {
    CardinalAdjacentRouteStrategy,
    RectWithinRangeLineOfSightRouteStrategy,
    RectWithinRangeRouteStrategy,
} from "../../pathfinding/legacy/pathfinder/RouteStrategy";
import { CollisionFlag } from "../../pathfinding/legacy/pathfinder/flag/CollisionFlag";
import { hasProjectileLineOfSightToNpc } from "../combat/CombatAction";
import { AttackType } from "../combat/AttackType";
import {
    POWERED_STAFF_CATEGORIES,
    resolvePlayerAttackReach,
    resolvePlayerAttackType,
} from "../combat/CombatRules";
import { NpcState } from "../npc";
import { PlayerState } from "../player";
import type {
    NpcCombatInteractionState,
    PlayerInteractionState,
} from "./types";
import type { PlayerRepository } from "./PlayerInteractionSystem";

/**
 * Maximum distance (in tiles) the player can be from the NPC before combat disengages.
 * In OSRS, this is typically the view distance.
 */
export const PLAYER_CHASE_DISTANCE_TILES = 32;

export class NpcCombatInteractionHandler {
    constructor(
        private readonly players: PlayerRepository,
        private readonly pathService: PathService,
        private readonly interactions: Map<WebSocket, PlayerInteractionState>,
        private readonly onStopAutoAttack: ((playerId: number) => void) | undefined,
        private readonly onInterruptSkillActions: ((playerId: number) => void) | undefined,
        private readonly canStartNpcCombat:
            | ((
                  attacker: PlayerState,
                  npc: NpcState,
                  currentTick: number,
              ) => { allowed: boolean; reason?: string })
            | undefined,
        private readonly normalizeModifierFlags: (raw: number | undefined) => number,
        private readonly resolveRunMode: (player: PlayerState, modifierFlags?: number) => boolean,
        private readonly replaceInteractionState: (ws: WebSocket, player: PlayerState) => void,
        private readonly routePlayerToTile: (
            player: PlayerState,
            tile: { x: number; y: number },
            run: boolean,
        ) => boolean,
        private readonly findPlayerPathToTile: (
            player: PlayerState,
            tile: { x: number; y: number },
        ) => { x: number; y: number }[] | undefined,
        private readonly applyPathSteps: (
            player: PlayerState,
            steps: { x: number; y: number }[],
            run: boolean,
        ) => boolean,
        private readonly extractValidatedStrategyPathSteps: (
            player: PlayerState,
            res: ReturnType<PathService["findPathSteps"]>,
            strategy: InstanceType<typeof CardinalAdjacentRouteStrategy> | InstanceType<typeof RectWithinRangeRouteStrategy> | InstanceType<typeof RectWithinRangeLineOfSightRouteStrategy>,
        ) => { x: number; y: number }[] | undefined,
        private readonly hasDirectReach: (
            from: { x: number; y: number },
            to: { x: number; y: number },
            sizeX: number,
            sizeY: number,
            level: number,
        ) => boolean,
        private readonly forEachInteraction: (
            cb: (ws: WebSocket, state: PlayerInteractionState) => void,
        ) => void,
    ) {}

    startNpcAttack(
        ws: WebSocket,
        npc: NpcState,
        currentTick: number,
        _attackDelay: number = 4,
        modifierFlags?: number,
    ): { ok: boolean; message?: string; chatMessage?: string } {
        // Support passing either a socket or a PlayerState directly (for bots)
        const me = ws instanceof PlayerState ? ws : this.players.get(ws);
        if (!me) return { ok: false, message: "player not found" };
        if (!npc) return { ok: false, message: "npc not found" };
        if (npc.getHitpoints() <= 0 || npc.isDead(currentTick)) {
            return { ok: false, message: "npc_dead" };
        }
        if (npc.isPlayerFollower?.() === true) {
            return { ok: false, message: "npc_unattackable" };
        }

        // Block interactions during tutorial
        if (!me.canInteract()) {
            return { ok: false, message: "interaction_blocked" };
        }

        const canStartCombat = this.canStartNpcCombat?.(me, npc, currentTick);
        if (canStartCombat && !canStartCombat.allowed) {
            return {
                ok: false,
                message: "combat_restricted",
                chatMessage: canStartCombat.reason ?? "You are already under attack!",
            };
        }

        // Starting combat cancels any active skill actions
        this.interruptSkillActions(me.id);
        this.replaceInteractionState(ws, me);

        // Use the ws parameter as key (player object for bots, socket for regular players)
        const existing = this.interactions.get(ws);
        if (existing && existing.kind !== "npcCombat") {
            me.clearInteraction();
        }
        let state: NpcCombatInteractionState;
        if (existing && existing.kind === "npcCombat" && existing.npcId === npc.id) {
            state = existing;
            state.modifierFlags = this.normalizeModifierFlags(modifierFlags);
        } else {
            state = {
                kind: "npcCombat",
                npcId: npc.id,
                modifierFlags: this.normalizeModifierFlags(modifierFlags),
            };
        }

        state.modifierFlags = this.normalizeModifierFlags(state.modifierFlags);

        // Do not force NPC to face/engage on click.
        // NPC retaliation/engagement begins when the first hit actually lands (confirmHitLanded),
        // not when the player clicks "Attack" or starts pathing.

        // RSMod parity: Set combat target on player (COMBAT_TARGET_FOCUS_ATTR)
        me.combat.setCombatTarget(npc);

        this.interactions.set(ws, state);

        const attackReach = Math.max(1, this.getPlayerAttackReach(me));
        if (this.isWithinAttackReach(me, npc)) {
            me.clearPath();
            return { ok: true };
        }

        // If in range but blocked by wall, find a tile with LoS
        if (
            this.tryRouteToLineOfSight(
                me,
                npc,
                attackReach,
                this.resolveRunMode(me, state.modifierFlags),
            )
        ) {
            return { ok: true };
        }

        const routed = this.routePlayerToNpc(
            me,
            npc,
            attackReach,
            npc.hasPath(),
            this.resolveRunMode(me, state.modifierFlags),
        );
        const routedWithProgress = routed && (me.hasPath() || this.isWithinAttackReach(me, npc));
        if (routedWithProgress) {
            // Allow attack on the same tick the player arrives in range.
            // If player walks into range during this tick's movement phase, they can
            // attack during the combat phase (same tick). The attack speed cooldown
            // only starts AFTER the first attack is executed, not when clicked.
            return { ok: true };
        }

        // RSMod parity: if we can't route directly into attack reach, still walk toward the NPC's
        // best reachable tile. If that also fails, only then begin unreachable timeout handling.
        const fallbackRouted = this.routePlayerToTile(
            me,
            { x: npc.tileX, y: npc.tileY },
            this.resolveRunMode(me, state.modifierFlags),
        );
        const fallbackWithProgress =
            fallbackRouted && (me.hasPath() || this.isWithinAttackReach(me, npc));
        if (fallbackWithProgress) {
            return { ok: true };
        }

        return { ok: false, message: "no_path" };
    }

    stopNpcAttack(ws: WebSocket): void {
        const st = this.interactions.get(ws);
        if (!st || st.kind !== "npcCombat") return;
        const me = this.players.get(ws);
        if (me) {
            this.onStopAutoAttack?.(me.id);
            // RSMod parity: Clear combat target (COMBAT_TARGET_FOCUS_ATTR)
            me.combat.removeCombatTarget();
            me.clearPath();
            me.clearInteraction();
            me.stopAnimation();
        }
    }

    /**
     * Fully ends preserved NPC combat focus after PlayerCombatManager drops the engagement.
     * This is distinct from `stopNpcAttack()`, which intentionally preserves the interaction
     * while the NPC is still allowed to chase/retaliate during the aggro hold window.
     */
    finishNpcCombatByPlayerId(playerId: number, npcId?: number): void {
        const player = this.players.getById(playerId);
        if (!player) return;

        const socket = this.players.getSocketByPlayerId(playerId);
        if (!socket) return;
        const keys = [socket];

        for (const key of keys) {
            const state = this.interactions.get(key);
            if (!state || state.kind !== "npcCombat") continue;
            if (npcId !== undefined && state.npcId !== npcId) continue;

            this.interactions.delete(key);

            const interactionTarget = player.getInteractionTarget();
            if (
                interactionTarget &&
                interactionTarget.type === "npc" &&
                interactionTarget.id === state.npcId
            ) {
                player.clearInteractionTarget();
            }

            const combatTarget = player.combat.getCombatTarget();
            if (combatTarget && !combatTarget.isPlayer && combatTarget.id === state.npcId) {
                player.combat.removeCombatTarget();
            }

            if (player.combat.getInteractingNpc()?.id === state.npcId) {
                player.combat.setInteractingNpc(null);
            }
        }
    }

    updatePlayerAttacks(
        tick: number,
        schedulePlayerAttack: (
            player: PlayerState,
            target: PlayerState,
            attackDelay: number,
            currentTick: number,
        ) => boolean,
        opts?: {
            pickPlayerAttackDelay?: (player: PlayerState, target: PlayerState) => number;
        },
    ): void {
        this.forEachInteraction((ws, interaction) => {
            if (interaction.kind !== "playerCombat") return;
            const me = this.players.get(ws);
            if (!me) {
                this.interactions.delete(ws);
                return;
            }
            const target = this.players.getById(interaction.playerId);
            if (!target) {
                me.clearInteraction();
                me.combat.removeCombatTarget();
                me.combat.setInteractingPlayer(null);
                me.stopAnimation();
                this.interactions.delete(ws);
                return;
            }
            if (target.level !== me.level) {
                me.clearInteraction();
                me.combat.removeCombatTarget();
                me.combat.setInteractingPlayer(null);
                me.stopAnimation();
                this.interactions.delete(ws);
                return;
            }
            if (target.skillSystem.getHitpointsCurrent() <= 0) {
                me.clearInteraction();
                me.combat.removeCombatTarget();
                me.combat.setInteractingPlayer(null);
                me.stopAnimation();
                this.interactions.delete(ws);
                return;
            }

            const chebyshevDistance = Math.max(
                Math.abs(target.tileX - me.tileX),
                Math.abs(target.tileY - me.tileY),
            );
            if (chebyshevDistance > PLAYER_CHASE_DISTANCE_TILES) {
                me.clearInteraction();
                me.combat.removeCombatTarget();
                me.combat.setInteractingPlayer(null);
                me.stopAnimation();
                this.interactions.delete(ws);
                return;
            }

            const spellId = me.combat.spellId;
            if (!(me.combat.autocastEnabled && spellId > 0)) return;

            const attackDelay = Math.max(1, opts?.pickPlayerAttackDelay?.(me, target) ?? 4);
            me.combat.attackDelay = attackDelay;
            const last = me.combat.lastSpellCastTick;
            if (tick < last + attackDelay) return;

            schedulePlayerAttack(me, target, attackDelay, tick);
        });
    }

    routePlayerToNpc(
        player: PlayerState,
        npc: NpcState,
        reach: number = 1,
        _allowOverlap: boolean = false,
        run?: boolean,
    ): boolean {
        const normalizedReach = Math.max(1, reach);
        const attackType = resolvePlayerAttackType(player.combat);
        // Melee requires cardinal positioning (N/S/E/W), not diagonal
        const strategy =
            normalizedReach <= 1
                ? new CardinalAdjacentRouteStrategy(
                      npc.tileX,
                      npc.tileY,
                      Math.max(1, npc.size),
                      Math.max(1, npc.size),
                  )
                : attackType !== AttackType.Melee
                ? new RectWithinRangeLineOfSightRouteStrategy(
                      npc.tileX,
                      npc.tileY,
                      Math.max(1, npc.size),
                      Math.max(1, npc.size),
                      normalizedReach,
                  )
                : new RectWithinRangeRouteStrategy(
                      npc.tileX,
                      npc.tileY,
                      Math.max(1, npc.size),
                      Math.max(1, npc.size),
                      normalizedReach,
                  );
        // Melee arrival checks must be wall-aware. Without this, routing can stop on
        // geometrically-adjacent tiles that are edge-blocked by walls, causing stuck combat pathing.
        if (strategy instanceof CardinalAdjacentRouteStrategy) {
            strategy.setCollisionGetter(
                (x, y, p) => this.pathService.getCollisionFlagAt(x, y, p),
                player.level,
            );
        } else if (strategy instanceof RectWithinRangeLineOfSightRouteStrategy) {
            strategy.setProjectileRaycast((from, to) =>
                this.pathService.projectileRaycast(from, to),
            );
        }
        // use the step-by-step path reconstruction. The legacy pathfinder's
        // buffer output is turn-point compressed and must not be expanded via naive interpolation.
        const res = this.pathService.findPathSteps(
            {
                from: { x: player.tileX, y: player.tileY, plane: player.level },
                to: { x: npc.tileX, y: npc.tileY },
                size: 1,
            },
            { routeStrategy: strategy, maxSteps: 128 },
        );
        const steps = this.extractValidatedStrategyPathSteps(player, res, strategy);
        if (!steps) {
            return false;
        }
        const wantsRun = !!(run ?? this.resolveRunMode(player));
        if (steps.length === 0) {
            player.clearPath();
            return true;
        }
        player.setPath(steps, wantsRun);
        return true;
    }

    getPlayerAttackReach(player: PlayerState): number {
        return resolvePlayerAttackReach(player.combat);
    }

    shouldRepeatNpcAttack(player: PlayerState): boolean {
        const combatSpellId = player.combat.spellId;
        if (combatSpellId > 0) {
            // For regular staves/salamander magic, repeating requires autocast.
            // Powered staves always repeat and are handled separately by style resolution.
            const attackType = resolvePlayerAttackType(player.combat);
            const category = player.combat.weaponCategory ?? 0;
            const isPoweredStaff = POWERED_STAFF_CATEGORIES.has(category);
            if (attackType === AttackType.Magic && !isPoweredStaff) {
                return !!player.combat.autocastEnabled;
            }
        }
        return true;
    }

    /**
     * Checks if a player is within attack DISTANCE of an NPC (ignoring LoS/walls).
     * Used to determine if player needs to move closer or find LoS.
     */
    isWithinAttackDistance(player: PlayerState, npc: NpcState): boolean {
        const reach = this.getPlayerAttackReach(player);
        const size = Math.max(1, npc.size);
        const minX = npc.tileX;
        const minY = npc.tileY;
        const maxX = minX + size - 1;
        const maxY = minY + size - 1;
        const px = player.tileX;
        const py = player.tileY;

        // Calculate distance to nearest edge of NPC bounding box (Chebyshev distance)
        const clampedX = Math.max(minX, Math.min(px, maxX));
        const clampedY = Math.max(minY, Math.min(py, maxY));
        const distance = Math.max(Math.abs(px - clampedX), Math.abs(py - clampedY));

        // Player is inside the NPC bounding box - not a valid attack position
        if (distance === 0) {
            return false;
        }

        return distance <= reach;
    }

    /**
     * Checks if a player is within attack reach of an NPC.
     *
     *  Notes:
     * - For melee (reach <= 1), player must be adjacent to the NPC bounding box (not overlapping)
     * - For halberds (reach = 2), player can attack from 2 tiles away but walls block
     * - For ranged/magic, reach is typically 7-10 and only requires distance check
     *
     * The distance is calculated to the NEAREST tile of the NPC, not the origin.
     * For a 2x2 NPC at (10,10), a player at (12,10) is distance 1 from tile (11,10).
     */
    isWithinAttackReach(player: PlayerState, npc: NpcState): boolean {
        const reach = this.getPlayerAttackReach(player);
        const size = Math.max(1, npc.size);
        const minX = npc.tileX;
        const minY = npc.tileY;
        const maxX = minX + size - 1;
        const maxY = minY + size - 1;
        const px = player.tileX;
        const py = player.tileY;

        // Calculate distance to nearest edge of NPC bounding box (Chebyshev distance)
        // If player is inside the NPC bounds, clampedX/Y equals px/py, giving distance 0
        const clampedX = Math.max(minX, Math.min(px, maxX));
        const clampedY = Math.max(minY, Math.min(py, maxY));
        const toDx = clampedX - px;
        const toDy = clampedY - py;
        const distance = Math.max(Math.abs(toDx), Math.abs(toDy));

        // Player is inside the NPC bounding box - not a valid attack position
        if (distance === 0) {
            return false;
        }

        // Too far away
        if (distance > reach) {
            return false;
        }

        // For melee reach (1), check wall collision for adjacency
        if (reach <= 1) {
            // Melee attacks require cardinal positioning (N/S/E/W)
            // Reject diagonal positions - player must share an X or Y coordinate with NPC bounds
            const onCardinalX = px >= minX && px <= maxX; // Player X is within NPC X range
            const onCardinalY = py >= minY && py <= maxY; // Player Y is within NPC Y range
            if (!onCardinalX && !onCardinalY) {
                // Player is on a diagonal corner - not valid for melee
                return false;
            }

            return this.hasDirectReach(
                { x: px, y: py },
                { x: npc.tileX, y: npc.tileY },
                size,
                size,
                player.level,
            );
        }

        // For reach > 1 (e.g., halberds), use attack type resolution to decide LoS vs wall-path checks.
        const isMelee = resolvePlayerAttackType(player.combat) === AttackType.Melee;

        // Ranged/magic attacks require LINE OF SIGHT to the target.
        // Wall checks are different from LoS - walls block melee, but projectiles
        // require an unobstructed raycast path to the target.
        if (!isMelee) {
            return hasProjectileLineOfSightToNpc(px, py, player.level, npc, this.pathService);
        }

        // Halberd attack - verify no walls between player and nearest NPC tile
        let cx = px;
        let cy = py;
        let remX = toDx;
        let remY = toDy;
        const checkEdge = (ax: number, ay: number, bx: number, by: number) =>
            !this.pathService.edgeHasWallBetween(ax, ay, bx, by, player.level);

        for (let i = 0; i < distance; i++) {
            const stepX = remX === 0 ? 0 : Math.sign(remX);
            const stepY = remY === 0 ? 0 : Math.sign(remY);

            if (stepX === 0 || stepY === 0) {
                // Cardinal movement
                const nx = cx + stepX;
                const ny = cy + stepY;
                if (!checkEdge(cx, cy, nx, ny)) {
                    return false;
                }
                cx = nx;
                cy = ny;
            } else {
                // Diagonal movement - check both possible paths
                const horizFirst =
                    checkEdge(cx, cy, cx + stepX, cy) &&
                    checkEdge(cx + stepX, cy, cx + stepX, cy + stepY);
                const vertFirst =
                    checkEdge(cx, cy, cx, cy + stepY) &&
                    checkEdge(cx, cy + stepY, cx + stepX, cy + stepY);

                if (!horizFirst && !vertFirst) {
                    return false;
                }
                cx = cx + stepX;
                cy = cy + stepY;
            }
            remX = remX - stepX;
            remY = remY - stepY;
        }
        return true;
    }

    /**
     * Attempt to route player to a tile with line of sight for ranged/magic attacks.
     * Called when player is within range but blocked by a wall.
     *
     * @returns true if successfully routed, false if no valid tile found
     */
    tryRouteToLineOfSight(
        player: PlayerState,
        npc: NpcState,
        reach: number,
        run?: boolean,
    ): boolean {
        if (reach <= 1 || !this.isWithinAttackDistance(player, npc)) {
            return false;
        }

        const npcSize = Math.max(1, npc.size);
        const npcMinX = npc.tileX;
        const npcMinY = npc.tileY;
        const npcMaxX = npcMinX + npcSize - 1;
        const npcMaxY = npcMinY + npcSize - 1;
        const px = player.tileX;
        const py = player.tileY;
        const level = player.level;
        const wantsRun = run ?? this.resolveRunMode(player);
        let bestSteps: { x: number; y: number }[] | undefined;
        let bestPathLength = Number.MAX_SAFE_INTEGER;
        let bestPlayerDistance = Number.MAX_SAFE_INTEGER;
        let bestNpcDistance = Number.MAX_SAFE_INTEGER;

        // Search every in-range LoS tile and choose the one with the shortest actual route.
        // The previous "first matching ring tile" scan could pick a candidate that required
        // a long detour even when a later candidate reached LoS in fewer steps.
        const maxSearchRadius =
            reach +
            Math.max(
                Math.abs(px - npcMinX),
                Math.abs(px - npcMaxX),
                Math.abs(py - npcMinY),
                Math.abs(py - npcMaxY),
            ) +
            1;

        for (let ring = 0; ring <= maxSearchRadius; ring++) {
            for (let dx = -ring; dx <= ring; dx++) {
                const dyAbs = ring - Math.abs(dx);
                const dys = dyAbs === 0 ? [0] : [-dyAbs, dyAbs];

                for (const dy of dys) {
                    const tx = px + dx;
                    const ty = py + dy;

                    // Skip if inside NPC bounds
                    if (tx >= npcMinX && tx <= npcMaxX && ty >= npcMinY && ty <= npcMaxY) {
                        continue;
                    }

                    // Check distance to NPC edge (Chebyshev)
                    const clampedX = Math.max(npcMinX, Math.min(tx, npcMaxX));
                    const clampedY = Math.max(npcMinY, Math.min(ty, npcMaxY));
                    const distToNpc = Math.max(Math.abs(tx - clampedX), Math.abs(ty - clampedY));
                    if (distToNpc > reach || distToNpc === 0) {
                        continue;
                    }

                    if (!this.isTileWalkable(tx, ty, level)) {
                        continue;
                    }

                    if (!hasProjectileLineOfSightToNpc(tx, ty, level, npc, this.pathService)) {
                        continue;
                    }

                    const steps = this.findPlayerPathToTile(player, { x: tx, y: ty });
                    if (!steps) {
                        continue;
                    }

                    const pathLength = steps.length;
                    const playerDistance = Math.abs(dx) + Math.abs(dy);
                    if (
                        pathLength < bestPathLength ||
                        (pathLength === bestPathLength && playerDistance < bestPlayerDistance) ||
                        (pathLength === bestPathLength &&
                            playerDistance === bestPlayerDistance &&
                            distToNpc < bestNpcDistance)
                    ) {
                        bestSteps = steps;
                        bestPathLength = pathLength;
                        bestPlayerDistance = playerDistance;
                        bestNpcDistance = distToNpc;
                    }
                }
            }
        }

        if (!bestSteps) {
            return false;
        }
        if (bestSteps.length === 0) {
            player.clearPath();
            return true;
        }
        this.applyPathSteps(player, bestSteps, wantsRun);
        return true;
    }

    private interruptSkillActions(playerId: number): void {
        this.onInterruptSkillActions?.(playerId);
    }

    private isTileWalkable(x: number, y: number, level: number): boolean {
        const flag = this.pathService.getCollisionFlagAt(x, y, level);
        // If we don't have collision data for a tile, treat it as non-walkable.
        // This avoids routing to out-of-bounds tiles which would immediately fail.
        if (flag === undefined) return false;
        const mask = CollisionFlag.OBJECT | CollisionFlag.FLOOR_BLOCKED;
        return (flag & mask) === 0;
    }
}
