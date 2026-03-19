import assert from "assert";

import { CombatActionHandler } from "../src/game/actions/handlers/CombatActionHandler";
import { CombatEffectApplicator } from "../src/game/combat/CombatEffectApplicator";
import { HITMARK_DAMAGE } from "../src/game/combat/HitEffects";
import { ACTIVE_COMBAT_TIMER_TICKS } from "../src/game/model/timer/Timers";
import type { NpcState } from "../src/game/npc";
import { PlayerManager, PlayerState } from "../src/game/player";
import {
    buildPlayerSaveKey,
    normalizePlayerAccountName,
} from "../src/game/state/PlayerSessionKeys";

function createNpcStub(): NpcState {
    let nextAttackTick = 0;
    return {
        id: 100,
        typeId: 1,
        tileX: 3201,
        tileY: 3200,
        level: 0,
        size: 1,
        x: (3201 << 7) + 64,
        y: (3200 << 7) + 64,
        attackSpeed: 4,
        canAttack: () => true,
        recordAttack: (tick: number) => {
            nextAttackTick = tick + 4;
        },
        getNextAttackTick: () => nextAttackTick,
        setNextAttackTick: (tick: number) => {
            nextAttackTick = tick;
        },
        isInCombat: () => false,
        clearPath: () => {},
        getHitpoints: () => 25,
        isDead: () => false,
        engageCombat: () => {},
        setInteraction: () => {},
        queueOneShotSeq: () => {},
        popPendingSeq: () => {},
    } as unknown as NpcState;
}

(function testPlayerSaveKeyNormalization() {
    assert.strictEqual(buildPlayerSaveKey(" Alice ", 42), "alice");
    assert.strictEqual(normalizePlayerAccountName(" Alice "), "alice");
    assert.strictEqual(buildPlayerSaveKey(undefined, 42), "id:42");
})();

(function testPlayerVsNpcAttackDoesNotBlockLogoutUntilRetaliated() {
    const npc = createNpcStub();
    const player = new PlayerState(1, 3200, 3200, 0);
    const handler = new CombatActionHandler({
        getNpc: (id: number) => (id === npc.id ? npc : undefined),
        getPlayerAttackReach: () => 1,
        getPathService: () => undefined,
        isWithinAttackRange: () => true,
        hasDirectMeleeReach: () => true,
        pickNpcFaceTile: () => ({ x: npc.tileX, y: npc.tileY }),
        getEquipArray: () => new Array<number>(14).fill(-1),
        normalizeAttackType: (type: unknown) =>
            type === "melee" || type === "ranged" || type === "magic" ? type : undefined,
        pickAttackSequence: () => -1,
        pickHitDelay: () => 1,
        pickCombatSound: () => 0,
        withDirectSendBypass: (_tag: string, fn: () => void) => fn(),
        broadcastSound: () => {},
        scheduleAction: () => ({ ok: true }),
        rollRetaliateDamage: () => 0,
        awardCombatXp: () => {},
        log: () => {},
        isActiveFrame: () => true,
        dispatchActionEffects: () => {},
    } as any);

    const result = handler.executeCombatAttackAction(
        player,
        {
            npcId: npc.id,
            hit: {
                damage: 1,
                maxHit: 1,
                style: HITMARK_DAMAGE,
                attackType: "melee",
                hitDelay: 1,
                attackDelay: 4,
                landed: true,
            },
        } as any,
        10,
    );

    assert.strictEqual(result.ok, true);
    assert.strictEqual(
        player.canLogout(),
        true,
        "player should be able to logout after attacking an NPC that has not hit back",
    );
})();

(function testNpcRetaliationMarksPlayerAsInCombat() {
    const npc = createNpcStub();
    const player = new PlayerState(2, 3200, 3200, 0);
    const handler = new CombatActionHandler({
        getNpc: (id: number) => (id === npc.id ? npc : undefined),
        normalizeAttackType: (type: unknown) =>
            type === "melee" || type === "ranged" || type === "magic" ? type : undefined,
        resolveNpcAttackType: () => "melee",
        resolveNpcAttackRange: () => 1,
        isWithinAttackRange: () => true,
        getPathService: () => undefined,
        getNpcCombatSequences: () => undefined,
        broadcastNpcSequence: () => {},
        rollRetaliateDamage: () => 0,
        scheduleAction: () => ({ ok: true }),
        log: () => {},
        isActiveFrame: () => true,
        dispatchActionEffects: () => {},
    } as any);

    const result = handler.executeCombatNpcRetaliateAction(
        player,
        {
            npcId: npc.id,
            phase: "swing",
            isAggression: true,
        } as any,
        20,
    );

    assert.strictEqual(result.ok, true);
    assert.strictEqual(
        player.canLogout(),
        false,
        "player should not be able to logout immediately after an NPC swings on them",
    );
})();

(function testCombatTimerExpiresAfterExpectedTicks() {
    const player = new PlayerState(20, 3200, 3200, 0);
    player.refreshActiveCombatTimer();

    assert.strictEqual(player.canLogout(), false);

    for (let i = 0; i <= ACTIVE_COMBAT_TIMER_TICKS; i++) {
        player.processTimersAndQueue();
    }

    assert.strictEqual(
        player.canLogout(),
        true,
        "player should be able to logout once the active combat timer has fully expired",
    );
})();

(function testPlayerVsPlayerHitOnlyBlocksTargetLogout() {
    const attacker = new PlayerState(3, 3200, 3200, 0);
    const target = new PlayerState(4, 3201, 3200, 0);
    target.autoRetaliate = false;

    const applicator = new CombatEffectApplicator();
    const handler = new CombatActionHandler({
        normalizeAttackType: (type: unknown) =>
            type === "melee" || type === "ranged" || type === "magic" ? type : undefined,
        deriveAttackTypeFromStyle: () => "melee",
        getPlayer: (id: number) => (id === target.id ? target : undefined),
        applyProtectionPrayers: (_target: PlayerState, damage: number) => damage,
        applyPlayerHitsplat: (
            player: PlayerState,
            style: number,
            damage: number,
            tick: number,
            maxHit?: number,
        ) => applicator.applyPlayerHitsplat(player, style, damage, tick, maxHit),
        applySmite: () => {},
        tryActivateRedemption: () => {},
        closeInterruptibleInterfaces: () => {},
        log: () => {},
        getPlayerSocket: () => undefined,
        stopPlayerCombat: () => {},
        isActiveFrame: () => true,
        dispatchActionEffects: () => {},
    } as any);

    const result = handler.executeCombatPlayerHitAction(
        attacker,
        {
            targetId: target.id,
            damage: 3,
            maxHit: 3,
            style: HITMARK_DAMAGE,
            attackType: "melee",
            landed: true,
        } as any,
        30,
    );

    assert.strictEqual(result.ok, true);
    assert.strictEqual(attacker.canLogout(), true);
    assert.strictEqual(target.canLogout(), false);
})();

(function testLiveSessionsStayReservedButOrphansCanBeReclaimed() {
    const manager = new PlayerManager({} as any);
    const firstSocket = { id: 1 };
    const player = manager.add(firstSocket, 3200, 3200, 0);
    assert.ok(player, "player should be created");

    player!.name = " Alice ";
    player!.__saveKey = buildPlayerSaveKey(player!.name, player!.id);

    assert.strictEqual(
        manager.hasConnectedPlayer("alice"),
        true,
        "live connected session should block duplicate login",
    );

    player!.refreshActiveCombatTimer();
    assert.strictEqual(manager.orphanPlayer(firstSocket, player!.__saveKey, 100), true);
    assert.strictEqual(
        manager.hasConnectedPlayer("alice"),
        false,
        "orphaned session should no longer count as a live connected session",
    );
    assert.strictEqual(manager.hasOrphanedPlayer("alice"), true);

    const reconnectSocket = { id: 2 };
    const reconnected = manager.reconnectOrphanedPlayer(reconnectSocket, "alice");
    assert.strictEqual(reconnected, player);
    assert.strictEqual(
        manager.hasConnectedPlayer("alice"),
        true,
        "reclaimed orphan should become the live connected session again",
    );
})();
