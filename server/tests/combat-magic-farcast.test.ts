/**
 * Regression coverage for ten-tile manual/autocast approach routing and
 * same-tick attack preparation after the movement phase reaches range.
 *
 * Run with: npx tsx tests/combat-magic-farcast.test.ts
 */
import assert from "node:assert/strict";

import { createProjectileParamsProvider } from "../gamemodes/vanilla/data/projectileParams";
import { AttackType } from "../src/game/combat/AttackType";
import { registerSkillConfiguration } from "../src/game/combat/SkillConfigurationProvider";
import { CombatTickEngine } from "../src/game/combat/engine/CombatTickEngine";
import type { CombatAttackTraits } from "../src/game/combat/model/CombatAttack";
import { CombatAttributes } from "../src/game/combat/state/CombatAttributes";
import type { GamemodeDefinition } from "../src/game/gamemodes/GamemodeDefinition";
import { NpcState } from "../src/game/npc";
import { PlayerState } from "../src/game/player";
import { ProjectileTimingService } from "../src/game/services/ProjectileTimingService";
import { ProjectileSystem } from "../src/game/systems/ProjectileSystem";
import { resolveMagicCastSpotAnimHeight } from "../src/game/spells/SpellDataProvider";
import type { PathService } from "../src/pathfinding/PathService";

const TEST_GAMEMODE = {
    id: "combat-magic-farcast-test",
    name: "Combat magic farcast test",
    initializePlayer: () => undefined,
    canInteract: () => true,
} as GamemodeDefinition;

registerSkillConfiguration({
    computeCombatLevel: () => 3,
    skillRestoreIntervalTicks: 100,
    skillBoostDecayIntervalTicks: 100,
    hitpointRegenIntervalTicks: 100,
    hitpointOverhealDecayIntervalTicks: 100,
    preserveDecayMultiplier: 1.5,
});

assert.equal(resolveMagicCastSpotAnimHeight({ castSpotAnimHeight: undefined }), 96);
assert.equal(resolveMagicCastSpotAnimHeight({ castSpotAnimHeight: 0 }), 0);

const STAFF_MELEE_TRAITS: CombatAttackTraits = Object.freeze({
    type: AttackType.Melee,
    style: null,
    rangeTiles: 1,
    speedTicks: 4,
    weaponId: 1387,
});

function createPathService(approachX: number, approachY: number): PathService {
    return {
        projectileRaycast: () => ({ clear: true }),
        edgeHasWallBetween: () => false,
        findPathSteps: (_request: unknown, options: { routeStrategy?: unknown }) => {
            const strategy = options.routeStrategy as {
                setProjectileRaycast?: (raycast: () => { clear: boolean }) => void;
            };
            strategy.setProjectileRaycast?.(() => ({ clear: true }));
            const end = { x: approachX, y: approachY };
            return { ok: true, steps: [end], end };
        },
    } as unknown as PathService;
}

function createEngine(player: PlayerState, npc: NpcState): CombatTickEngine {
    return new CombatTickEngine({
        pathService: createPathService(3205, 3200),
        getPlayer: (id) => (id === player.id ? player : undefined),
        getNpc: (id) => (id === npc.id ? npc : undefined),
        getCombatants: () => [player],
        resolveAttackTraits: () => STAFF_MELEE_TRAITS,
    });
}

const autocaster = new PlayerState(40, 3200, 3200, 0, TEST_GAMEMODE);
const autocastTarget = new NpcState(
    4,
    1,
    1,
    -1,
    -1,
    32,
    { x: 3215, y: 3200, level: 0 },
    { maxHitpoints: 10 },
);
const windStrikeDefaults = createProjectileParamsProvider().getProjectileParams(91);
const windStrike = { id: 1, baseMaxHit: 2, projectileId: 91 };
const windStrikeTiming = new ProjectileTimingService({
    getTickMs: () => 600,
    getCurrentTick: () => 0,
    getActiveFrame: () => undefined,
    getNpcManager: () => undefined,
    getProjectileSystem: () => undefined,
    getPathService: () => undefined,
}).estimateProjectileTiming({
    player: autocaster,
    targetX: autocaster.tileX + 1,
    targetY: autocaster.tileY,
    projectileDefaults: windStrikeDefaults,
    spellData: windStrike,
});
assert.equal(windStrikeTiming?.startDelay, 51 / 30);
assert.equal(windStrikeTiming?.travelTime, 5 / 30);
assert.equal(windStrikeTiming?.hitDelay, 56 / 30);
const windStrikeLaunch = new ProjectileSystem({ tickMs: 600 } as any).buildSpellProjectileLaunch({
    player: autocaster,
    targetNpc: autocastTarget,
    spellData: windStrike,
    projectileDefaults: windStrikeDefaults,
    timing: windStrikeTiming,
});
assert.equal(windStrikeLaunch?.startCycleOffset, 51);
assert.equal(windStrikeLaunch?.endCycleOffset, 56);
autocaster.setCombatTarget(autocastTarget);
autocaster.combatAttributes.set(CombatAttributes.AUTOCAST_SPELL_ID, 21876);

const autocastEngine = createEngine(autocaster, autocastTarget);
const approachTick = autocastEngine.processTick(300);
assert.equal(approachTick.statuses.get("moving"), 1);
assert.equal(approachTick.preparedAttacks.length, 0);
assert.equal(autocaster.hasPath(), true, "far autocast must queue an approach route");

// Movement runs before combat in TickPhaseOrchestrator. Recreate that landing
// step and confirm the following combat phase casts immediately at distance 10.
autocaster.teleport(3205, 3200, 0);
const landingTick = autocastEngine.processTick(301);
assert.equal(landingTick.preparedAttacks.length, 1);
assert.equal(landingTick.preparedAttacks[0].traits.type, AttackType.Magic);
assert.equal(landingTick.preparedAttacks[0].traits.rangeTiles, 10);
assert.equal(landingTick.preparedAttacks[0].traits.spellId, 21876);

const manualCaster = new PlayerState(41, 3200, 3200, 0, TEST_GAMEMODE);
const manualTarget = new NpcState(
    5,
    1,
    1,
    -1,
    -1,
    32,
    { x: 3215, y: 3200, level: 0 },
    { maxHitpoints: 10 },
);
manualCaster.setCombatTarget(manualTarget);
manualCaster.combat.pendingManualCombatSpell = {
    spellId: 4651,
    target: { type: "npc", npcId: manualTarget.id },
};

const manualEngine = createEngine(manualCaster, manualTarget);
const manualApproachTick = manualEngine.processTick(400);
assert.equal(manualApproachTick.statuses.get("moving"), 1);
assert.equal(manualCaster.hasPath(), true, "far manual spell must queue an approach route");

manualCaster.teleport(3205, 3200, 0);
const manualLandingTick = manualEngine.processTick(401);
assert.equal(
    manualLandingTick.preparedAttacks.length,
    0,
    "manual spell chase must not create a second unvalidated combat-engine hit",
);
assert.equal(manualLandingTick.statuses.get("waiting"), 1);

console.log("combat magic farcast regression test passed");
