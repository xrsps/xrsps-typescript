import assert from "assert";

import { EquipmentSlot } from "../../src/rs/config/player/Equipment";
import { CombatActionHandler } from "../src/game/actions/handlers/CombatActionHandler";
import { HITMARK_DAMAGE } from "../src/game/combat/HitEffects";
import { DEFAULT_EQUIP_SLOT_COUNT } from "../src/game/equipment";
import { PlayerInteractionSystem } from "../src/game/interactions/PlayerInteractionSystem";
import { NpcState } from "../src/game/npc";
import { PlayerState } from "../src/game/player";

function createPlayer(): PlayerState {
    const player = new PlayerState(1, 3222, 3221, 0);
    (player as any).appearance = { equip: new Array(DEFAULT_EQUIP_SLOT_COUNT).fill(-1) };
    (player as any).appearance.equip[EquipmentSlot.WEAPON] = 27275; // Tumeken's shadow
    player.combatWeaponItemId = 27275;
    player.combatWeaponCategory = 24;
    return player;
}

function createNpc(): NpcState {
    return new NpcState(42, 0, 1, -1, -1, 32, { x: 3222, y: 3222, level: 0 }, { maxHitpoints: 25 });
}

function testCombatProjectileHitDelayDoesNotBeatImpactTiming(): void {
    const player = createPlayer();
    const npc = createNpc();
    const scheduled: Array<{ tick: number; request: any }> = [];

    const handler = new CombatActionHandler({
        getNpc: (id) => (id === npc.id ? npc : undefined),
        getPlayerAttackReach: () => 10,
        getPathService: () => undefined,
        isWithinAttackRange: () => true,
        hasDirectMeleeReach: () => true,
        hasDirectMeleePath: () => true,
        pickNpcFaceTile: () => ({ x: npc.tileX, y: npc.tileY }),
        getEquipArray: () => (player.appearance?.equip as number[]) ?? [],
        normalizeAttackType: (type) =>
            type === "melee" || type === "ranged" || type === "magic" ? type : undefined,
        enqueueSpotAnimation: () => {},
        pickAttackSequence: () => 711,
        pickCombatSound: () => 0,
        queueCombatState: () => {},
        queueChatMessage: () => {},
        scheduleAction: (_playerId, request, tick) => {
            scheduled.push({ tick, request });
            return { ok: true };
        },
        rollRetaliateDamage: () => 0,
        estimateProjectileTiming: () => ({
            startDelay: 2,
            travelTime: 1,
            hitDelay: 3,
        }),
        buildPlayerRangedProjectileLaunch: () => undefined,
        isActiveFrame: () => true,
        dispatchActionEffects: () => {},
        log: () => {},
        pickHitDelay: () => 1,
    } as any);

    const tick = 200;
    const result = handler.executeCombatAttackAction(
        player,
        {
            npcId: npc.id,
            hit: {
                damage: 12,
                maxHit: 30,
                style: HITMARK_DAMAGE,
                attackDelay: 5,
                hitDelay: 2,
                expectedHitTick: tick + 2,
                landed: true,
                attackType: "magic",
            },
            projectile: {
                projectileId: 2126,
                startHeight: 43,
                endHeight: 31,
                slope: 16,
                steepness: 64,
                startDelay: 2,
            },
        },
        tick,
    );

    assert.ok(result.ok, "combat attack should succeed");
    assert.strictEqual(scheduled.length, 1, "attack should schedule exactly one hit");

    const hit = scheduled[0]!.request;
    assert.strictEqual(hit.kind, "combat.playerHit");
    assert.strictEqual(
        hit.delayTicks,
        3,
        "hit should wait for the projectile impact timing when it exceeds the planned delay",
    );
    assert.strictEqual(
        hit.data.hitDelay,
        3,
        "stored hitDelay should match the scheduled projectile impact tick",
    );
    assert.strictEqual(
        hit.data.expectedHitTick,
        tick + 3,
        "expectedHitTick should be lifted with the corrected projectile impact delay",
    );
}

function testCombatAttackFacingSurvivesInteractionRefresh(): void {
    const player = createPlayer();
    const npc = createNpc();

    const handler = new CombatActionHandler({
        getNpc: (id) => (id === npc.id ? npc : undefined),
        getPlayerAttackReach: () => 1,
        getPathService: () => undefined,
        isWithinAttackRange: () => true,
        hasDirectMeleeReach: () => true,
        hasDirectMeleePath: () => true,
        pickNpcFaceTile: () => ({ x: npc.tileX, y: npc.tileY }),
        getEquipArray: () => (player.appearance?.equip as number[]) ?? [],
        normalizeAttackType: (type) =>
            type === "melee" || type === "ranged" || type === "magic" ? type : undefined,
        enqueueSpotAnimation: () => {},
        pickAttackSequence: () => 422,
        pickCombatSound: () => 0,
        queueCombatState: () => {},
        queueChatMessage: () => {},
        scheduleAction: () => ({ ok: true }),
        rollRetaliateDamage: () => 0,
        awardCombatXp: () => {},
        isActiveFrame: () => true,
        dispatchActionEffects: () => {},
        log: () => {},
        pickHitDelay: () => 1,
    } as any);

    const result = handler.executeCombatAttackAction(
        player,
        {
            npcId: npc.id,
            hit: {
                damage: 1,
                maxHit: 1,
                style: HITMARK_DAMAGE,
                attackDelay: 4,
                hitDelay: 1,
                landed: true,
                attackType: "melee",
            },
        },
        200,
    );

    assert.ok(result.ok, "combat attack should succeed");
    assert.ok(player._pendingFace, "combat attack should queue a one-tick face override");

    const interactionSystem = new PlayerInteractionSystem({} as any, {} as any);
    interactionSystem.applyInteractionFacing({} as any, player, () => npc, 200);

    assert.strictEqual(
        player._pendingFace,
        undefined,
        "interaction refresh should consume the queued face override",
    );
    assert.notStrictEqual(
        player.forcedOrientation,
        -1,
        "interaction refresh should preserve combat facing for the attack tick",
    );
}

testCombatProjectileHitDelayDoesNotBeatImpactTiming();
testCombatAttackFacingSurvivesInteractionRefresh();

console.log("Combat projectile hit delay test passed.");
