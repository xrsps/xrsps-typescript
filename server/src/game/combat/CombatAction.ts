import { PathService } from "../../pathfinding/PathService";
import {
    CardinalAdjacentRouteStrategy,
    RectWithinRangeLineOfSightRouteStrategy,
    RectWithinRangeRouteStrategy,
} from "../../pathfinding/legacy/pathfinder/RouteStrategy";
import { Actor } from "../actor";
import { QueueTask, SuspendCondition, WaitCondition } from "../model/queue/QueueTask";
import { NpcState } from "../npc";
import { PlayerState } from "../player";
import type { AttackType } from "./AttackType";
import { resolvePlayerAttackType } from "./CombatRules";

/**
 * RSMod parity: PawnPathAction + Combat cycle
 *
 * Unified combat action that handles both player and NPC combat.
 * Uses the same pathfinding logic for both, with diagonal clipping for melee.
 */

/** AABB bounds (min/max corners) */
interface AabbBounds {
    x1: number;
    x2: number;
    z1: number;
    z2: number;
}

/** Convert position + size to AABB bounds */
function toBounds(x: number, z: number, width: number, length: number): AabbBounds {
    return { x1: x, x2: x + width - 1, z1: z, z2: z + length - 1 };
}

/** Get actor size (NPCs have variable size, players are always 1x1) */
export function getActorSize(actor: Actor): number {
    return actor instanceof NpcState ? actor.size : 1;
}

/**
 * Check if two AABBs are bordering (adjacent but not overlapping).
 * RSMod: AabbUtil.areBordering
 */
export function areBordering(
    x1: number,
    z1: number,
    width1: number,
    length1: number,
    x2: number,
    z2: number,
    width2: number,
    length2: number,
): boolean {
    // Overlapping entities are not bordering
    if (areOverlapping(x1, z1, width1, length1, x2, z2, width2, length2)) {
        return false;
    }

    const a = toBounds(x1, z1, width1, length1);
    const b = toBounds(x2, z2, width2, length2);

    // Check if too far apart (more than 1 tile gap)
    if (b.x1 > a.x2 + 1 || b.x2 < a.x1 - 1) return false;
    if (b.z1 > a.z2 + 1 || b.z2 < a.z1 - 1) return false;

    return true;
}

/**
 * Check if two AABBs are on diagonal corners only.
 * RSMod: AabbUtil.areDiagonal
 */
export function areDiagonal(
    x1: number,
    z1: number,
    width1: number,
    length1: number,
    x2: number,
    z2: number,
    width2: number,
    length2: number,
): boolean {
    const a = toBounds(x1, z1, width1, length1);
    const b = toBounds(x2, z2, width2, length2);

    // Check all four diagonal corners
    const swDiagonal = a.x1 - 1 === b.x2 && a.z1 - 1 === b.z2;
    const seDiagonal = a.x2 + 1 === b.x1 && a.z1 - 1 === b.z2;
    const nwDiagonal = a.x1 - 1 === b.x2 && a.z2 + 1 === b.z1;
    const neDiagonal = a.x2 + 1 === b.x1 && a.z2 + 1 === b.z1;

    return swDiagonal || seDiagonal || nwDiagonal || neDiagonal;
}

/**
 * Check if two AABBs are overlapping.
 * RSMod: AabbUtil.areOverlapping
 */
export function areOverlapping(
    x1: number,
    z1: number,
    width1: number,
    length1: number,
    x2: number,
    z2: number,
    width2: number,
    length2: number,
): boolean {
    const a = toBounds(x1, z1, width1, length1);
    const b = toBounds(x2, z2, width2, length2);

    // Standard AABB overlap: no gap on either axis
    return a.x1 <= b.x2 && b.x1 <= a.x2 && a.z1 <= b.z2 && b.z1 <= a.z2;
}

/**
 * Compute Chebyshev distance between two AABBs (0 if overlapping).
 * This matches OSRS range checks for tiles and NPC sizes.
 */
function aabbChebyshevDistance(a: AabbBounds, b: AabbBounds): number {
    const dx = Math.max(0, Math.max(b.x1 - a.x2, a.x1 - b.x2));
    const dz = Math.max(0, Math.max(b.z1 - a.z2, a.z1 - b.z2));
    return Math.max(dx, dz);
}

/**
 * Find the nearest target tile within a rectangle that has clear projectile LoS.
 *
 * when a player attacks a large NPC, LoS is satisfied by the nearest
 * visible tile of that NPC's occupied footprint, not just the south-west tile.
 */
export function findProjectileLineOfSightTileToRect(
    fromX: number,
    fromY: number,
    plane: number,
    targetX: number,
    targetY: number,
    targetSizeX: number,
    targetSizeY: number,
    pathService: PathService,
): { x: number; y: number } | undefined {
    const minX = targetX;
    const minY = targetY;
    const maxX = minX + Math.max(1, targetSizeX) - 1;
    const maxY = minY + Math.max(1, targetSizeY) - 1;
    const origin = { x: fromX, y: fromY, plane };
    let bestTile: { x: number; y: number } | undefined;
    let bestDistance = Number.MAX_SAFE_INTEGER;

    for (let x = minX; x <= maxX; x++) {
        for (let y = minY; y <= maxY; y++) {
            const ray = pathService.projectileRaycast(origin, { x, y });
            if (!ray.clear) {
                continue;
            }

            const distance = Math.max(Math.abs(fromX - x), Math.abs(fromY - y));
            if (distance < bestDistance) {
                bestDistance = distance;
                bestTile = { x, y };
            }
        }
    }

    return bestTile;
}

export function hasProjectileLineOfSightToRect(
    fromX: number,
    fromY: number,
    plane: number,
    targetX: number,
    targetY: number,
    targetSizeX: number,
    targetSizeY: number,
    pathService: PathService,
): boolean {
    return (
        findProjectileLineOfSightTileToRect(
            fromX,
            fromY,
            plane,
            targetX,
            targetY,
            targetSizeX,
            targetSizeY,
            pathService,
        ) !== undefined
    );
}

export function hasProjectileLineOfSightToNpc(
    fromX: number,
    fromY: number,
    plane: number,
    npc: NpcState,
    pathService: PathService,
): boolean {
    const size = Math.max(1, npc.size);
    return hasProjectileLineOfSightToRect(
        fromX,
        fromY,
        plane,
        npc.tileX,
        npc.tileY,
        size,
        size,
        pathService,
    );
}

/**
 * Check if pawn is within attack range of target.
 * RSMod parity: Uses bordering for melee, overlapping for ranged.
 *
 * @param pawn The attacker
 * @param target The target
 * @param attackRange The attack range (1 for melee, 2 for halberd, 7+ for ranged/magic)
 * @param checkDiagonal If true, reject diagonal positions for melee
 */
export function isWithinAttackRange(
    pawn: Actor,
    target: Actor,
    attackRange: number,
    checkDiagonal: boolean = true,
): boolean {
    const pawnSize = getActorSize(pawn);
    const targetSize = getActorSize(target);

    const px = pawn.tileX;
    const pz = pawn.tileY;
    const tx = target.tileX;
    const tz = target.tileY;

    // For ranged/magic (range > 1), check Chebyshev distance between AABBs
    if (attackRange > 1) {
        // OSRS: You cannot attack while standing inside the target's footprint
        if (areOverlapping(px, pz, pawnSize, pawnSize, tx, tz, targetSize, targetSize)) {
            return false;
        }
        const pawnBounds = toBounds(px, pz, pawnSize, pawnSize);
        const targetBounds = toBounds(tx, tz, targetSize, targetSize);
        return aabbChebyshevDistance(pawnBounds, targetBounds) <= attackRange;
    }

    // For melee (range = 1), must be bordering and not diagonal
    if (!areBordering(px, pz, pawnSize, pawnSize, tx, tz, targetSize, targetSize)) {
        return false;
    }

    if (checkDiagonal && areDiagonal(px, pz, pawnSize, pawnSize, tx, tz, targetSize, targetSize)) {
        return false;
    }

    return true;
}

/**
 * Check if a melee adjacency has a clear edge between two actors.
 * Uses collision wall flags to ensure adjacent tiles are not separated by a wall.
 */
export function hasDirectMeleeReach(pawn: Actor, target: Actor, pathService: PathService): boolean {
    const pawnSize = getActorSize(pawn);
    const targetSize = getActorSize(target);
    const a = toBounds(pawn.tileX, pawn.tileY, pawnSize, pawnSize);
    const b = toBounds(target.tileX, target.tileY, targetSize, targetSize);
    return hasDirectMeleeReachBounds(a, b, pawn.level, pathService);
}

function hasDirectMeleeReachBounds(
    a: AabbBounds,
    b: AabbBounds,
    plane: number,
    pathService: PathService,
): boolean {
    const { x1: ax1, x2: ax2, z1: az1, z2: az2 } = a;
    const { x1: bx1, x2: bx2, z1: bz1, z2: bz2 } = b;

    // Pawn west of target.
    if (ax2 + 1 === bx1) {
        const start = Math.max(az1, bz1);
        const end = Math.min(az2, bz2);
        if (start > end) return false;
        for (let z = start; z <= end; z++) {
            if (!pathService.edgeHasWallBetween(ax2, z, bx1, z, plane)) {
                return true;
            }
        }
        return false;
    }
    // Pawn east of target.
    if (bx2 + 1 === ax1) {
        const start = Math.max(az1, bz1);
        const end = Math.min(az2, bz2);
        if (start > end) return false;
        for (let z = start; z <= end; z++) {
            if (!pathService.edgeHasWallBetween(bx2, z, ax1, z, plane)) {
                return true;
            }
        }
        return false;
    }
    // Pawn south of target.
    if (az2 + 1 === bz1) {
        const start = Math.max(ax1, bx1);
        const end = Math.min(ax2, bx2);
        if (start > end) return false;
        for (let x = start; x <= end; x++) {
            if (!pathService.edgeHasWallBetween(x, az2, x, bz1, plane)) {
                return true;
            }
        }
        return false;
    }
    // Pawn north of target.
    if (bz2 + 1 === az1) {
        const start = Math.max(ax1, bx1);
        const end = Math.min(ax2, bx2);
        if (start > end) return false;
        for (let x = start; x <= end; x++) {
            if (!pathService.edgeHasWallBetween(x, bz2, x, az1, plane)) {
                return true;
            }
        }
        return false;
    }

    return false;
}

function isCardinalMeleePositionBounds(a: AabbBounds, b: AabbBounds): boolean {
    if (
        !areBordering(
            a.x1,
            a.z1,
            a.x2 - a.x1 + 1,
            a.z2 - a.z1 + 1,
            b.x1,
            b.z1,
            b.x2 - b.x1 + 1,
            b.z2 - b.z1 + 1,
        )
    ) {
        return false;
    }
    return !areDiagonal(
        a.x1,
        a.z1,
        a.x2 - a.x1 + 1,
        a.z2 - a.z1 + 1,
        b.x1,
        b.z1,
        b.x2 - b.x1 + 1,
        b.z2 - b.z1 + 1,
    );
}

export function findNearestCardinalAttackTile(
    pawn: Actor,
    target: Actor,
): { x: number; y: number } | undefined {
    return findNearestCardinalAttackTileFrom(
        pawn.tileX,
        pawn.tileY,
        getActorSize(pawn),
        target.tileX,
        target.tileY,
        getActorSize(target),
    );
}

function findNearestCardinalAttackTileFrom(
    pawnX: number,
    pawnY: number,
    pawnSize: number,
    targetX: number,
    targetY: number,
    targetSize: number,
): { x: number; y: number } | undefined {
    const candidates: Array<{ x: number; y: number }> = [];
    const pushCandidate = (x: number, y: number): void => {
        if (candidates.some((candidate) => candidate.x === x && candidate.y === y)) {
            return;
        }
        candidates.push({ x, y });
    };

    for (let y = targetY - pawnSize + 1; y <= targetY + targetSize - 1; y++) {
        pushCandidate(targetX - pawnSize, y);
        pushCandidate(targetX + targetSize, y);
    }
    for (let x = targetX - pawnSize + 1; x <= targetX + targetSize - 1; x++) {
        pushCandidate(x, targetY - pawnSize);
        pushCandidate(x, targetY + targetSize);
    }

    let best: { x: number; y: number } | undefined;
    let bestDistance = Number.MAX_SAFE_INTEGER;

    for (const candidate of candidates) {
        const distance = Math.max(Math.abs(candidate.x - pawnX), Math.abs(candidate.y - pawnY));
        if (distance < bestDistance) {
            best = candidate;
            bestDistance = distance;
        }
    }

    return best;
}

/**
 * Check if a direct melee path between pawn and target is clear of walls.
 * Uses collision wall flags along a step path to the nearest target tile.
 */
export function hasDirectMeleePath(pawn: Actor, target: Actor, pathService: PathService): boolean {
    const targetBounds = toBounds(
        target.tileX,
        target.tileY,
        getActorSize(target),
        getActorSize(target),
    );
    const { x1: minX, x2: maxX, z1: minY, z2: maxY } = targetBounds;
    const px = pawn.tileX;
    const py = pawn.tileY;
    const plane = pawn.level;

    const clampedX = Math.max(minX, Math.min(px, maxX));
    const clampedY = Math.max(minY, Math.min(py, maxY));
    let remX = clampedX - px;
    let remY = clampedY - py;
    const distance = Math.max(Math.abs(remX), Math.abs(remY));
    if (distance === 0) return false;

    let cx = px;
    let cy = py;
    const checkEdge = (ax: number, ay: number, bx: number, by: number) =>
        !pathService.edgeHasWallBetween(ax, ay, bx, by, plane);

    for (let i = 0; i < distance; i++) {
        const stepX = remX === 0 ? 0 : Math.sign(remX);
        const stepY = remY === 0 ? 0 : Math.sign(remY);
        if (stepX === 0 || stepY === 0) {
            const nx = cx + stepX;
            const ny = cy + stepY;
            if (!checkEdge(cx, cy, nx, ny)) {
                return false;
            }
            cx = nx;
            cy = ny;
        } else {
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

type NpcAttackTarget = Pick<PlayerState, "tileX" | "tileY" | "level">;

export type NpcAttackPositionOptions = {
    pathService?: PathService;
    hasLineOfSight?: (npc: NpcState, player: NpcAttackTarget) => boolean;
};

/**
 * Check projectile line of sight from any tile occupied by the NPC to the target player tile.
 */
export function hasNpcLineOfSightToPlayer(
    npc: NpcState,
    player: NpcAttackTarget,
    pathService: PathService,
): boolean {
    const npcSize = Math.max(1, npc.size);
    for (let ox = 0; ox < npcSize; ox++) {
        for (let oy = 0; oy < npcSize; oy++) {
            const ray = pathService.projectileRaycast(
                { x: npc.tileX + ox, y: npc.tileY + oy, plane: npc.level },
                { x: player.tileX, y: player.tileY },
            );
            if (ray.clear) {
                return true;
            }
        }
    }
    return false;
}

/**
 * Shared NPC swing validation so chase, scheduling, and hit execution all agree on attackable tiles.
 */
export function canNpcAttackPlayerFromCurrentPosition(
    npc: NpcState,
    player: NpcAttackTarget,
    attackRange: number,
    attackType: AttackType,
    options: NpcAttackPositionOptions = {},
): boolean {
    const playerActor = player as unknown as Actor;
    if (!isWithinAttackRange(npc, playerActor, attackRange)) {
        return false;
    }

    const pathService = options.pathService;
    if (attackType === "melee") {
        if (!pathService) {
            return true;
        }
        if (attackRange <= 1) {
            return hasDirectMeleeReach(npc, playerActor, pathService);
        }
        return hasDirectMeleePath(npc, playerActor, pathService);
    }

    if (attackRange <= 1) {
        return true;
    }

    if (options.hasLineOfSight) {
        return options.hasLineOfSight(npc, player);
    }

    if (!pathService) {
        return true;
    }

    return hasNpcLineOfSightToPlayer(npc, player, pathService);
}

/**
 * Walk toward target until within attack range.
 * RSMod parity: PawnPathAction.walkTo
 *
 * For melee attacks, this uses CardinalAdjacentRouteStrategy to ensure
 * the path ends at a cardinal position (N/S/E/W), not diagonal.
 *
 * NPCs use "dumb pathfinder" (naive diagonal-then-cardinal),
 * while players use BFS smart pathfinding. This is CRITICAL for safespots.
 * Reference: docs/npc-behavior.md, docs/pathfinding-details.md
 *
 * @returns true if path was found and pawn reached target, false otherwise
 */
export function walkToAttackRange(
    pawn: Actor,
    target: Actor,
    pathService: PathService,
    attackRange: number,
): boolean {
    if (pawn instanceof NpcState && pawn.isRecoveringToSpawn()) {
        return false;
    }

    // Already in range?
    if (isWithinAttackRange(pawn, target, attackRange)) {
        if (attackRange <= 1) {
            return hasDirectMeleeReach(pawn, target, pathService);
        }
        return true;
    }

    const pawnSize = getActorSize(pawn);
    const targetSize = getActorSize(target);
    const px = pawn.tileX;
    const pz = pawn.tileY;
    const tx = target.tileX;
    const tz = target.tileY;
    const plane = pawn.level;

    // NPCs use dumb pathfinder, players use BFS
    if (pawn instanceof NpcState) {
        // NPC: Use dumb pathfinder - generates steps one at a time toward target
        // NPCs will NOT path around obstacles (enables safespots)
        const steps: { x: number; y: number }[] = [];
        let currentX = px;
        let currentY = pz;
        const targetCenterX = tx + Math.floor(targetSize / 2);
        const targetCenterY = tz + Math.floor(targetSize / 2);

        for (let i = 0; i < 16; i++) {
            const pawnBounds = toBounds(currentX, currentY, pawnSize, pawnSize);
            const targetBounds = toBounds(tx, tz, targetSize, targetSize);

            if (attackRange <= 1) {
                if (
                    isCardinalMeleePositionBounds(pawnBounds, targetBounds) &&
                    hasDirectMeleeReachBounds(pawnBounds, targetBounds, plane, pathService)
                ) {
                    break;
                }
            } else {
                const dist = aabbChebyshevDistance(pawnBounds, targetBounds);
                if (dist <= attackRange) {
                    break;
                }
            }

            const approachTile =
                attackRange <= 1
                    ? findNearestCardinalAttackTileFrom(
                          currentX,
                          currentY,
                          pawnSize,
                          tx,
                          tz,
                          targetSize,
                      ) ?? { x: targetCenterX, y: targetCenterY }
                    : { x: targetCenterX, y: targetCenterY };

            const nextStep = pathService.findNpcPathStep(
                { x: currentX, y: currentY, plane },
                approachTile,
                pawnSize,
            );
            if (!nextStep) {
                // Blocked - NPC stays put (safespot behavior)
                break;
            }
            steps.push(nextStep);
            currentX = nextStep.x;
            currentY = nextStep.y;
        }

        if (steps.length === 0) {
            return false;
        }
        pawn.setPath(steps, false);
        return true;
    }

    // Player: Use BFS smart pathfinding
    // Choose route strategy based on attack range
    // RSMod: For melee (!lineOfSight && !projectile), clip diagonal tiles
    const strategy =
        attackRange <= 1
            ? new CardinalAdjacentRouteStrategy(tx, tz, targetSize, targetSize)
            : pawn instanceof PlayerState && resolvePlayerAttackType(pawn.combat) !== "melee"
            ? new RectWithinRangeLineOfSightRouteStrategy(
                  tx,
                  tz,
                  targetSize,
                  targetSize,
                  attackRange,
              )
            : new RectWithinRangeRouteStrategy(tx, tz, targetSize, targetSize, attackRange);

    if (strategy instanceof RectWithinRangeLineOfSightRouteStrategy) {
        strategy.setProjectileRaycast((from, to) => pathService.projectileRaycast(from, to));
    }

    const result = pathService.findPathSteps(
        { from: { x: px, y: pz, plane }, to: { x: tx, y: tz }, size: pawnSize },
        { routeStrategy: strategy, maxSteps: 128 },
    );

    if (!result.ok || !Array.isArray(result.steps)) {
        return false;
    }

    const selectedEnd =
        result.steps.length > 0
            ? result.end ?? result.steps[result.steps.length - 1]!
            : { x: px, y: pz };
    if (!strategy.hasArrived(selectedEnd.x, selectedEnd.y, plane)) {
        return false;
    }

    if (result.steps.length === 0) {
        return false;
    }

    // Apply path to pawn
    const run = pawn instanceof PlayerState ? pawn.energy.isRunActive() : false;
    pawn.setPath(result.steps, run);

    return true;
}

/**
 * Combat cycle result.
 */
export enum CombatCycleResult {
    /** Continue combat next tick */
    CONTINUE = "continue",
    /** Combat ended (target dead, out of range, etc.) */
    END = "end",
    /** Attack was performed */
    ATTACKED = "attacked",
    /** Moving toward target */
    MOVING = "moving",
    /** Waiting for attack delay */
    WAITING = "waiting",
}

/**
 * Combat context for the cycle function.
 */
export interface CombatCycleContext {
    pawn: Actor;
    target: Actor;
    pathService: PathService;
    getAttackRange: (pawn: Actor) => number;
    isAttackDelayReady: (pawn: Actor) => boolean;
    canAttack: (pawn: Actor, target: Actor) => boolean;
    performAttack: (pawn: Actor, target: Actor) => void;
    postAttack: (pawn: Actor, target: Actor) => void;
}

/**
 * Single combat cycle tick.
 * RSMod parity: combat.plugin.kts cycle() function
 *
 * This is the core combat loop that runs every tick for both players and NPCs.
 */
export function combatCycle(ctx: CombatCycleContext): CombatCycleResult {
    const {
        pawn,
        target,
        pathService,
        getAttackRange,
        isAttackDelayReady,
        canAttack,
        performAttack,
        postAttack,
    } = ctx;

    // Check if combat can continue
    if (pawn instanceof PlayerState && !pawn.canAttack()) {
        return CombatCycleResult.END;
    }

    // Check if target is valid
    if (target instanceof NpcState && target.getHitpoints() <= 0) {
        return CombatCycleResult.END;
    }
    if (target instanceof PlayerState && target.skillSystem.getHitpointsCurrent() <= 0) {
        return CombatCycleResult.END;
    }

    // Face target
    pawn.setInteraction(
        target instanceof NpcState ? "npc" : "player",
        target instanceof NpcState ? target.id : (target as PlayerState).id,
    );

    const attackRange = getAttackRange(pawn);

    // Try to walk to attack range
    const inRange = isWithinAttackRange(pawn, target, attackRange);

    if (!inRange) {
        const pathFound = walkToAttackRange(pawn, target, pathService, attackRange);

        if (!pathFound) {
            // NPC: Keep trying to find path
            if (pawn instanceof NpcState) {
                return CombatCycleResult.CONTINUE;
            }
            // Player: End combat if can't reach
            return CombatCycleResult.END;
        }

        return CombatCycleResult.MOVING;
    }

    // Stop movement when in range
    pawn.clearPath();

    // Check attack delay
    if (!isAttackDelayReady(pawn)) {
        return CombatCycleResult.WAITING;
    }

    // Check if we can attack
    if (!canAttack(pawn, target)) {
        return CombatCycleResult.END;
    }

    // Perform the attack
    performAttack(pawn, target);
    postAttack(pawn, target);

    return CombatCycleResult.ATTACKED;
}

/**
 * Create a combat task generator for use with QueueTask.
 * RSMod parity: set_combat_logic in combat.plugin.kts
 */
export function* createCombatGenerator(
    ctx: CombatCycleContext,
): Generator<SuspendCondition, void, void> {
    while (true) {
        const result = combatCycle(ctx);

        if (result === CombatCycleResult.END) {
            break;
        }

        // Wait 1 tick before next cycle
        yield new WaitCondition(1);
    }
}
