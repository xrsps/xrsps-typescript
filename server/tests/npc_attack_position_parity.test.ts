import assert from "assert";

import { CombatActionHandler } from "../src/game/actions/handlers/CombatActionHandler";
import { canNpcAttackPlayerFromCurrentPosition } from "../src/game/combat/CombatAction";
import { DEFAULT_NPC_WANDER_RADIUS, NpcState } from "../src/game/npc";
import { NpcManager } from "../src/game/npcManager";
import { PlayerState } from "../src/game/player";

function createNpc(
    id: number,
    tileX: number,
    tileY: number,
    options: {
        size?: number;
        attackType?: "melee" | "ranged" | "magic";
        attackSpeed?: number;
        wanderRadius?: number;
        isAggressive?: boolean;
        aggressionRadius?: number;
        combatLevel?: number;
        aggressionToleranceTicks?: number;
        aggressionSearchDelayTicks?: number;
    } = {},
): NpcState {
    return new NpcState(
        id,
        id,
        options.size ?? 1,
        -1,
        -1,
        32,
        { x: tileX, y: tileY, level: 0 },
        {
            wanderRadius: options.wanderRadius ?? 0,
            maxHitpoints: 25,
            attackType: options.attackType ?? "melee",
            attackSpeed: options.attackSpeed ?? 4,
            isAggressive: options.isAggressive,
            aggressionRadius: options.aggressionRadius,
            combatLevel: options.combatLevel,
            aggressionToleranceTicks: options.aggressionToleranceTicks,
            aggressionSearchDelayTicks: options.aggressionSearchDelayTicks,
        },
    );
}

function createPlayer(id: number, tileX: number, tileY: number): PlayerState {
    return new PlayerState(id, tileX, tileY, 0);
}

function createBlockingPathService() {
    return {
        findNpcPathStep: () => undefined,
        canNpcStep: () => true,
        edgeHasWallBetween: () => false,
        projectileRaycast: () => ({ clear: true, tiles: 0 }),
    };
}

function createSingleStepPathService(stepX: number, stepY: number) {
    return {
        findNpcPathStep: () => ({ x: stepX, y: stepY }),
        canNpcStep: () => true,
        edgeHasWallBetween: () => false,
        projectileRaycast: () => ({ clear: true, tiles: 0 }),
    };
}

function createStepTowardTargetPathService() {
    return {
        findNpcPathStep: (from: { x: number; y: number }, target: { x: number; y: number }) => ({
            x: from.x + Math.sign(target.x - from.x),
            y: from.y + Math.sign(target.y - from.y),
        }),
        canNpcStep: () => true,
        edgeHasWallBetween: () => false,
        projectileRaycast: () => ({ clear: true, tiles: 0 }),
    };
}

function normalizeAttackType(value: unknown): "melee" | "ranged" | "magic" | undefined {
    return value === "melee" || value === "ranged" || value === "magic" ? value : undefined;
}

function testSharedValidatorRejectsDiagonalMelee(): void {
    const npc = createNpc(100, 10, 10);
    const player = createPlayer(1, 11, 11);

    const canAttack = canNpcAttackPlayerFromCurrentPosition(npc, player, 1, "melee", {
        pathService: createBlockingPathService() as any,
    });

    assert.strictEqual(canAttack, false, "diagonal melee tiles must not count as attackable");
}

function testNpcRetaliateSwingRejectsDiagonalMelee(): void {
    const npc = createNpc(200, 10, 10);
    const player = createPlayer(2, 11, 11);

    const handler = new CombatActionHandler({
        getNpc: (id) => (id === npc.id ? npc : undefined),
        getPathService: () => createBlockingPathService() as any,
        resolveNpcAttackType: (_npc, explicit) => explicit ?? "melee",
        normalizeAttackType,
        resolveNpcAttackRange: () => 1,
        isWithinAttackRange: () => true,
        hasDirectMeleeReach: () => true,
        hasDirectMeleePath: () => true,
        getNpcCombatSequences: () => undefined,
        broadcastNpcSequence: () => {},
        scheduleAction: () => {
            throw new Error("diagonal melee swing must not enqueue a hit");
        },
        rollRetaliateDamage: () => 1,
        isActiveFrame: () => true,
        dispatchActionEffects: () => {},
        log: () => {},
    } as any);

    const result = handler.executeCombatNpcRetaliateAction(
        player,
        { npcId: npc.id, phase: "swing", attackType: "melee", isAggression: true },
        200,
    );

    assert.strictEqual(result.ok, false, "diagonal melee retaliation swing should be rejected");
    assert.strictEqual(result.reason, "not_in_range");
}

function testNpcManagerDoesNotScheduleDiagonalMeleeAttackWithoutCorrection(): void {
    const pathService = createBlockingPathService();
    const manager = new NpcManager({} as any, pathService as any, {} as any, {} as any);
    const npc = createNpc(300, 10, 10);
    const player = createPlayer(3, 11, 11);

    (manager as any).npcs.set(npc.id, npc);
    (manager as any).addOccupancyFootprint(npc);

    npc.engageCombat(player.id, 100);
    npc.setNextAttackTick(0);

    const result = manager.tick(100, (playerId) => (playerId === player.id ? player : undefined));

    assert.deepStrictEqual(
        result.aggressionEvents,
        [],
        "npc manager should not schedule an attack from diagonal melee range",
    );
    assert.strictEqual(
        npc.getNextAttackTick(),
        0,
        "failed diagonal melee swing should not advance the npc attack timer",
    );
}

function testNpcDropsSingleCombatAggroWhenTargetBecomesOccupiedOnArrival(): void {
    const manager = new NpcManager(
        {} as any,
        createSingleStepPathService(11, 10) as any,
        {} as any,
        {} as any,
    );
    const npc = createNpc(400, 10, 10);
    const player = createPlayer(4, 12, 10);
    const otherNpc = createNpc(401, 20, 20);

    (manager as any).npcs.set(npc.id, npc);
    (manager as any).addOccupancyFootprint(npc);

    player.setCombatTarget(otherNpc);
    npc.engageCombat(player.id, 100);
    npc.setNextAttackTick(0);

    const result = manager.tick(100, (playerId) => (playerId === player.id ? player : undefined));

    assert.deepStrictEqual(
        result.aggressionEvents,
        [],
        "single-combat aggro should not schedule an attack once the target is already occupied",
    );
    assert.strictEqual(
        npc.getCombatTargetPlayerId(),
        undefined,
        "failed single-combat aggro should clear the NPC's combat target",
    );
    assert.deepStrictEqual(
        npc.getPathQueue(),
        [],
        "failed single-combat aggro should clear the chase path instead of following forever",
    );
    assert.strictEqual(
        npc.isInCombat(100),
        false,
        "failed single-combat aggro should immediately end the NPC combat state",
    );
}

function testNpcOutsideRoamAreaReturnsHomeInsteadOfAggroingNearbyTargets(): void {
    const manager = new NpcManager(
        {} as any,
        createSingleStepPathService(12, 10) as any,
        {} as any,
        {} as any,
    );
    const npc = createNpc(500, 10, 10, {
        wanderRadius: 2,
        isAggressive: true,
        aggressionRadius: 3,
        combatLevel: 12,
    });
    const player = createPlayer(5, 14, 10);

    npc.teleport(13, 10, 0);

    (manager as any).npcs.set(npc.id, npc);
    (manager as any).addOccupancyFootprint(npc);

    const result = manager.tick(
        100,
        (playerId) => (playerId === player.id ? player : undefined),
        undefined,
        () => [
            {
                id: player.id,
                x: player.tileX,
                y: player.tileY,
                level: player.level,
                combatLevel: 3,
                inCombat: false,
                aggressionState: {
                    entryTick: 0,
                    aggressionExpired: false,
                    tile1: { x: player.tileX, y: player.tileY },
                    tile2: { x: player.tileX, y: player.tileY },
                },
            },
        ],
    );

    assert.deepStrictEqual(
        result.aggressionEvents,
        [],
        "NPCs outside their roam area should not re-aggro while returning home",
    );
    assert.strictEqual(
        npc.getCombatTargetPlayerId(),
        undefined,
        "displaced NPC should remain out of combat while recovering to its spawn area",
    );
    assert.strictEqual(
        npc.tileX,
        12,
        "displaced NPC should take a recovery step back toward its spawn tile",
    );
    assert.strictEqual(
        npc.tileY,
        10,
        "recovery movement should head toward the spawn tile, not the nearby player",
    );
}

function testNpcDoesNotStepTowardTargetBeyondCombatDistance(): void {
    const manager = new NpcManager(
        {} as any,
        createSingleStepPathService(11, 10) as any,
        {} as any,
        {} as any,
    );
    const npc = createNpc(600, 10, 10);
    const player = createPlayer(6, 43, 10);

    (manager as any).npcs.set(npc.id, npc);
    (manager as any).addOccupancyFootprint(npc);

    npc.engageCombat(player.id, 100);
    npc.setNextAttackTick(0);

    manager.tick(100, (playerId) => (playerId === player.id ? player : undefined));

    assert.strictEqual(
        npc.tileX,
        10,
        "NPC should not take a stale pursuit step before clearing an out-of-range target",
    );
    assert.strictEqual(
        npc.tileY,
        10,
        "NPC should remain on its current tile when the target already exceeded chase distance",
    );
    assert.strictEqual(
        npc.getCombatTargetPlayerId(),
        undefined,
        "out-of-range target should be cleared before movement is attempted",
    );
    assert.deepStrictEqual(
        npc.getPathQueue(),
        [],
        "invalid pursuit targets should not leave behind a queued chase path",
    );
}

function testNpcOutsideRoamAreaDropsChaseAndReturnsHome(): void {
    const manager = new NpcManager(
        {} as any,
        createSingleStepPathService(12, 10) as any,
        {} as any,
        {} as any,
    );
    const npc = createNpc(650, 10, 10, {
        wanderRadius: 2,
    });
    const player = createPlayer(65, 14, 10);

    npc.teleport(13, 10, 0);

    (manager as any).npcs.set(npc.id, npc);
    (manager as any).addOccupancyFootprint(npc);

    npc.engageCombat(player.id, 100);
    npc.setNextAttackTick(0);

    manager.tick(100, (playerId) => (playerId === player.id ? player : undefined));

    assert.strictEqual(
        npc.getCombatTargetPlayerId(),
        undefined,
        "NPCs displaced beyond their roam area should drop the chase and recover home",
    );
    assert.deepStrictEqual(
        npc.getInteractionTarget(),
        { id: player.id, type: "player" },
        "recovery should preserve the last faced player target while the NPC retreats home",
    );
    assert.strictEqual(
        npc.tileX,
        12,
        "displaced NPC should step back toward spawn instead of stepping deeper toward the player",
    );
    assert.strictEqual(
        npc.tileY,
        10,
        "recovery movement should stay aligned with the spawn return path",
    );
}

function testNpcKeepsReturningHomeAfterReEnteringRoamRadius(): void {
    const manager = new NpcManager(
        {} as any,
        createStepTowardTargetPathService() as any,
        {} as any,
        {} as any,
    );
    const npc = createNpc(675, 10, 10, {
        wanderRadius: 2,
        isAggressive: true,
        aggressionRadius: 3,
        combatLevel: 12,
    });
    const player = createPlayer(67, 14, 10);

    npc.teleport(13, 10, 0);

    (manager as any).npcs.set(npc.id, npc);
    (manager as any).addOccupancyFootprint(npc);

    const nearbyPlayers = () => [
        {
            id: player.id,
            x: player.tileX,
            y: player.tileY,
            level: player.level,
            combatLevel: 3,
            inCombat: false,
            aggressionState: {
                entryTick: 0,
                aggressionExpired: false,
                tile1: { x: player.tileX, y: player.tileY },
                tile2: { x: player.tileX, y: player.tileY },
            },
        },
    ];

    manager.tick(
        100,
        (playerId) => (playerId === player.id ? player : undefined),
        undefined,
        nearbyPlayers,
    );

    assert.strictEqual(npc.tileX, 12, "first recovery step should move the NPC back inside its roam radius");
    assert.strictEqual(npc.getCombatTargetPlayerId(), undefined);

    const result = manager.tick(
        101,
        (playerId) => (playerId === player.id ? player : undefined),
        undefined,
        nearbyPlayers,
    );

    assert.deepStrictEqual(
        result.aggressionEvents,
        [],
        "NPC should stay in recovery mode instead of re-aggroing as soon as it re-enters its roam radius",
    );
    assert.strictEqual(
        npc.tileX,
        11,
        "NPC should continue walking home on the next tick instead of turning back toward the player",
    );
    assert.strictEqual(
        npc.getCombatTargetPlayerId(),
        undefined,
        "recovery mode should suppress reacquiring the player until the NPC reaches home",
    );
}

function testNpcAggroUsesRsmodTileScanOrder(): void {
    const manager = new NpcManager(
        {} as any,
        createBlockingPathService() as any,
        {} as any,
        {} as any,
    );
    const npc = createNpc(700, 10, 10, {
        isAggressive: true,
        aggressionRadius: 3,
        combatLevel: 12,
    });
    const earlyScanPlayer = createPlayer(7, 7, 7);
    const nearbyPlayer = createPlayer(8, 10, 9);

    (manager as any).npcs.set(npc.id, npc);
    (manager as any).addOccupancyFootprint(npc);

    const result = manager.tick(
        100,
        (playerId) =>
            playerId === earlyScanPlayer.id
                ? earlyScanPlayer
                : playerId === nearbyPlayer.id
                ? nearbyPlayer
                : undefined,
        undefined,
        () => [
            {
                id: nearbyPlayer.id,
                x: nearbyPlayer.tileX,
                y: nearbyPlayer.tileY,
                level: nearbyPlayer.level,
                combatLevel: 3,
                inCombat: false,
                aggressionState: {
                    entryTick: 100,
                    aggressionExpired: false,
                    tile1: { x: nearbyPlayer.tileX, y: nearbyPlayer.tileY },
                    tile2: { x: nearbyPlayer.tileX, y: nearbyPlayer.tileY },
                },
            },
            {
                id: earlyScanPlayer.id,
                x: earlyScanPlayer.tileX,
                y: earlyScanPlayer.tileY,
                level: earlyScanPlayer.level,
                combatLevel: 3,
                inCombat: false,
                aggressionState: {
                    entryTick: 100,
                    aggressionExpired: false,
                    tile1: { x: earlyScanPlayer.tileX, y: earlyScanPlayer.tileY },
                    tile2: { x: earlyScanPlayer.tileX, y: earlyScanPlayer.tileY },
                },
            },
        ],
    );

    assert.deepStrictEqual(
        result.aggressionEvents,
        [{ npcId: npc.id, targetPlayerId: earlyScanPlayer.id }],
        "aggro acquisition should follow rsmod tile scan order rather than nearest-distance sorting",
    );
}

function testNpcUsesItsOwnAggressionToleranceTimer(): void {
    const manager = new NpcManager(
        {} as any,
        createBlockingPathService() as any,
        {} as any,
        {} as any,
    );
    const npc = createNpc(800, 10, 10, {
        isAggressive: true,
        aggressionRadius: 3,
        combatLevel: 13,
        aggressionToleranceTicks: 600,
    });
    const player = createPlayer(9, 11, 10);

    (manager as any).npcs.set(npc.id, npc);
    (manager as any).addOccupancyFootprint(npc);

    const result = manager.tick(
        700,
        (playerId) => (playerId === player.id ? player : undefined),
        undefined,
        () => [
            {
                id: player.id,
                x: player.tileX,
                y: player.tileY,
                level: player.level,
                combatLevel: 3,
                inCombat: false,
                aggressionState: {
                    entryTick: 0,
                    aggressionExpired: false,
                    tile1: { x: player.tileX, y: player.tileY },
                    tile2: { x: player.tileX, y: player.tileY },
                },
            },
        ],
    );

    assert.deepStrictEqual(
        result.aggressionEvents,
        [],
        "NPC-specific tolerance timers should suppress aggro even when the generic player flag is still false",
    );
    assert.strictEqual(
        npc.getCombatTargetPlayerId(),
        undefined,
        "expired npc-specific tolerance should prevent target acquisition",
    );
}

function testNpcDefaultsMissingWanderRadiusToSharedDefault(): void {
    const npc = new NpcState(900, 900, 1, -1, -1, 32, { x: 10, y: 10, level: 0 });

    assert.strictEqual(
        npc.wanderRadius,
        DEFAULT_NPC_WANDER_RADIUS,
        "NPC spawns without an explicit wander radius should use the shared default",
    );
}

testSharedValidatorRejectsDiagonalMelee();
testNpcRetaliateSwingRejectsDiagonalMelee();
testNpcManagerDoesNotScheduleDiagonalMeleeAttackWithoutCorrection();
testNpcDropsSingleCombatAggroWhenTargetBecomesOccupiedOnArrival();
testNpcOutsideRoamAreaReturnsHomeInsteadOfAggroingNearbyTargets();
testNpcDoesNotStepTowardTargetBeyondCombatDistance();
testNpcOutsideRoamAreaDropsChaseAndReturnsHome();
testNpcKeepsReturningHomeAfterReEnteringRoamRadius();
testNpcAggroUsesRsmodTileScanOrder();
testNpcUsesItsOwnAggressionToleranceTimer();
testNpcDefaultsMissingWanderRadiusToSharedDefault();

console.log("NPC attack position parity tests passed.");
