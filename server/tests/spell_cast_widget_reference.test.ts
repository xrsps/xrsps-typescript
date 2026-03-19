import assert from "assert";

import { SpellActionHandler } from "../src/game/actions/handlers/SpellActionHandler";
import { PlayerState } from "../src/game/player";

function createHandler(): SpellActionHandler {
    return new SpellActionHandler({
        getCurrentTick: () => 0,
        getDeliveryTick: () => 0,
        getTickMs: () => 600,
        getFramesPerTick: () => 30,
        getNpc: () => undefined,
        getPlayer: () => undefined,
        getPlayerSocket: () => undefined,
        getNpcType: () => undefined,
        getSpellData: () => undefined,
        getSpellDataByWidget: (groupId, childId) => {
            if (groupId === 218 && childId === 9) {
                return { id: 3273, name: "Wind Strike" } as any;
            }
            if (groupId === 218 && childId === 8) {
                return { id: 33138, name: "Minigame Teleport" } as any;
            }
            return undefined;
        },
        getProjectileParams: () => undefined,
        canWeaponAutocastSpell: () => ({ compatible: true }),
        getSpellBaseXp: () => 0,
        validateSpellCast: () => ({ success: true }) as any,
        executeSpellCast: () => ({ success: true }) as any,
        computeProjectileEndHeight: () => undefined,
        estimateProjectileTiming: () => undefined,
        buildAndQueueSpellProjectileLaunch: () => undefined,
        queueSpellResult: () => undefined,
        enqueueSpotAnimation: () => undefined,
        enqueueSpellFailureChat: () => undefined,
        pickSpellSound: () => undefined,
        broadcastSound: () => undefined,
        withDirectSendBypass: (_tag, fn) => fn(),
        resetAutocast: () => undefined,
        queueCombatSnapshot: () => undefined,
        pickAttackSequence: () => 0,
        pickSpellCastSequence: () => 0,
        pickAttackSpeed: () => 5,
        clearAllInteractions: () => undefined,
        clearActionsInGroup: () => 0,
        startNpcCombat: () => undefined,
        stopAutoAttack: () => undefined,
        sendInventorySnapshot: () => undefined,
        scheduleAction: () => ({ ok: true }),
        awardSkillXp: () => undefined,
        planPlayerVsPlayerMagic: () => ({ hitLanded: false, maxHit: 0, damage: 0 }),
        planPlayerVsNpcMagic: () => ({ hitLanded: false, maxHit: 0, damage: 0 }),
        faceAngleRs: () => 0,
        testRandFloat: () => 0,
        getTestHitForce: () => undefined,
        log: () => undefined,
    } as any);
}

function testServerPrefersSelectedSpellChildIndexOverLegacyWidgetChild(): void {
    const handler = createHandler();
    const player = new PlayerState(3, 3200, 3200, 0);

    const parsed = handler.parseSpellCastPayload(
        player,
        {
            npcId: 55,
            spellbookGroupId: 218,
            widgetChildId: 8,
            selectedSpellWidgetId: (218 << 16) | 9,
            selectedSpellChildIndex: 9,
            selectedSpellItemId: 50000,
        },
        "npc",
    );

    assert(parsed.ok);
    assert.strictEqual(parsed.request.spellId, 3273);
    assert.deepStrictEqual(parsed.request.target, { type: "npc", npcId: 55 });
}

testServerPrefersSelectedSpellChildIndexOverLegacyWidgetChild();

console.log("Spell cast widget reference test passed.");
