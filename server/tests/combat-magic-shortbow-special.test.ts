import assert from "node:assert/strict";

import { EquipmentSlot } from "../../client/rs/config/player/Equipment";
import { SkillId } from "../../client/rs/skill/skills";
import { AttackType } from "../src/game/combat/AttackType";
import {
    ARROW_LAUNCH_DELAY_TICKS,
    ARROW_TRAVEL_TIME_TICKS,
    getArrowVisual,
} from "../src/game/combat/AmmoSystem";
import { registerSkillConfiguration } from "../src/game/combat/SkillConfigurationProvider";
import { CombatHitEvaluator } from "../src/game/combat/engine/CombatHitEvaluator";
import { CombatAttackStyle } from "../src/game/combat/model/CombatAttack";
import {
    npcCombatEntityRef,
    playerCombatEntityRef,
} from "../src/game/combat/model/CombatEntityRef";
import { CombatPluginRegistry } from "../src/game/combat/plugins/CombatPluginRegistry";
import { resolveWeaponProfileValue } from "../src/game/combat/plugins/WeaponCombatProfile";
import {
    IMBUED_MAGIC_SHORTBOW_SPECIAL_ATTACK_PROFILE,
    MAGIC_SHORTBOW_SPECIAL_ATTACK_PROFILE,
    calculateSnapshotMaxHit,
} from "../src/game/combat/plugins/special-attacks/MagicShortbowSpecialAttack";
import type { GamemodeDefinition } from "../src/game/gamemodes/GamemodeDefinition";
import { NpcState } from "../src/game/npc";
import { PlayerState } from "../src/game/player";
import { ProjectileSystem } from "../src/game/systems/ProjectileSystem";

const TEST_GAMEMODE = {
    id: "magic-shortbow-special-test",
    name: "Magic shortbow special test",
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

assert.equal(calculateSnapshotMaxHit(99, 49), 19);
assert.equal(MAGIC_SHORTBOW_SPECIAL_ATTACK_PROFILE.specialAttackEnergyCost, 55);
assert.equal(IMBUED_MAGIC_SHORTBOW_SPECIAL_ATTACK_PROFILE.specialAttackEnergyCost, 50);
assert.equal(CombatPluginRegistry.shared.resolve({ weaponId: 861 }).id, "core:magic_shortbow");
assert.equal(
    CombatPluginRegistry.shared.resolve({ weaponId: 12788 }).id,
    "core:magic_shortbow_imbued",
);

const player = new PlayerState(100, 3200, 3200, 0, TEST_GAMEMODE);
const target = new NpcState(
    200,
    1,
    1,
    -1,
    -1,
    32,
    { x: 3201, y: 3200, level: 0 },
    {
        maxHitpoints: 100,
    },
);
player.skillSystem.getSkill(SkillId.Ranged).baseLevel = 99;
player.appearance.equip[EquipmentSlot.AMMO] = 892; // Rune arrow (+49 Ranged Strength)

const attack = {
    attacker: playerCombatEntityRef(player.id),
    target: npcCombatEntityRef(target.id),
    attackClock: 50,
    traits: {
        type: AttackType.Ranged,
        style: CombatAttackStyle.Rapid,
        rangeTiles: 7,
        speedTicks: 3,
        weaponId: 861,
        specialAttack: true,
    },
} as const;
const special = MAGIC_SHORTBOW_SPECIAL_ATTACK_PROFILE.handleSpecialAttack?.(player, target, attack);
assert.ok(special);
assert.equal(special.hitCount, 2);
assert.equal(special.accuracyMultiplier, 10 / 7);
assert.equal(special.maxHitOverride, 19);
assert.equal(special.projectileCount, 2);
assert.equal(special.castGraphic?.id, 256);
assert.deepEqual(special.projectileReleaseDelaysTicks, [8 / 30, 39 / 30]);

const specialContext = {
    attack,
    attacker: player,
    target,
    currentMapClock: 50,
    distanceTiles: 1,
};
assert.equal(
    resolveWeaponProfileValue(MAGIC_SHORTBOW_SPECIAL_ATTACK_PROFILE.projectile, specialContext)?.id,
    249,
);
assert.equal(
    resolveWeaponProfileValue(
        MAGIC_SHORTBOW_SPECIAL_ATTACK_PROFILE.travelDelayTicks,
        specialContext,
    ),
    2,
);

const normalContext = {
    ...specialContext,
    attack: {
        ...attack,
        traits: { ...attack.traits, specialAttack: false },
    },
};
const normalProjectile = resolveWeaponProfileValue(
    MAGIC_SHORTBOW_SPECIAL_ATTACK_PROFILE.projectile,
    normalContext,
);
assert.equal(normalProjectile?.id, 10);
assert.equal(normalProjectile?.startDelayTicks, 16 / 30);
assert.deepEqual(getArrowVisual(882), { launchGraphicId: 19, projectileId: 10 });
assert.deepEqual(getArrowVisual(892), { launchGraphicId: 24, projectileId: 15 });
assert.deepEqual(getArrowVisual(21326), { launchGraphicId: 1385, projectileId: 1384 });
assert.deepEqual(getArrowVisual(11212), { launchGraphicId: 1111, projectileId: 1120 });
const defaultBowProjectile = resolveWeaponProfileValue(
    CombatPluginRegistry.shared.resolve({ weaponId: 843, categoryId: 3 }).projectile,
    normalContext,
);
assert.equal(defaultBowProjectile?.startDelayTicks, ARROW_LAUNCH_DELAY_TICKS);
assert.equal(defaultBowProjectile?.travelTimeTicks, ARROW_TRAVEL_TIME_TICKS);
const arrowLaunch = new ProjectileSystem({ tickMs: 600 } as any).buildRangedProjectileLaunch({
    player,
    npc: target,
    projectile: {
        projectileId: defaultBowProjectile!.id,
        startHeight: defaultBowProjectile!.startHeight,
        endHeight: defaultBowProjectile!.endHeight,
        slope: defaultBowProjectile!.slope,
        steepness: defaultBowProjectile!.steepness,
    },
    timing: {
        startDelay: ARROW_LAUNCH_DELAY_TICKS,
        travelTime: ARROW_TRAVEL_TIME_TICKS,
    },
});
assert.equal(arrowLaunch?.startCycleOffset, 40);
assert.equal(arrowLaunch?.endCycleOffset, 57);
assert.equal(
    resolveWeaponProfileValue(
        MAGIC_SHORTBOW_SPECIAL_ATTACK_PROFILE.travelDelayTicks,
        normalContext,
    ),
    1,
);

const randomValues = [0, 0.25, 0, 0.75];
const evaluator = new CombatHitEvaluator({
    resolveEntity: (reference) =>
        reference.type === "player"
            ? reference.id === player.id
                ? player
                : undefined
            : reference.id === target.id
              ? target
              : undefined,
    // Deliberately inflated gear strength verifies Snapshot ignores it.
    getEquipmentBonuses: () => [100, 100, 100, 0, 100, 0, 0, 0, 0, 0, 100, 500, 0],
    random: () => randomValues.shift() ?? 0,
});
const hits = evaluator.evaluateSpecialAttack(attack, special);
assert.equal(hits.length, 2);
assert.equal(hits[0].maxHit, 19);
assert.equal(hits[1].maxHit, 19);
assert.equal(hits[0].damage, 5);
assert.equal(hits[1].damage, 15);
assert.equal(randomValues.length, 0, "Snapshot must roll accuracy and damage separately per arrow");

console.log("magic shortbow special attack regression tests passed");
