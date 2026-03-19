import assert from "assert";

import { EquipmentSlot } from "../../src/rs/config/player/Equipment";
import { VARP_AUTOCAST_SPELLPOS } from "../../src/shared/vars";
import { getSpellIdFromAutocastIndex } from "../src/data/spells";
import { PlayerState } from "../src/game/player";
import { ScriptRegistry } from "../src/game/scripts/ScriptRegistry";
import { combatWidgetModule } from "../src/game/scripts/modules/combatWidgets";
import { spellbookWidgetModule } from "../src/game/scripts/modules/spellbookWidgets";
import { type ScriptServices } from "../src/game/scripts/types";
import { createTestScriptServices } from "./scriptServices";

const COMBAT_WIDGET_GROUP_ID = 593;
const AUTOCAST_SPELL_ICON_COMPONENT = 26;
const AUTOCAST_BUTTON_COMPONENT = 28;
const AUTOCAST_POPUP_GROUP_ID = 201;
const AUTOCAST_INDEX_WIND_STRIKE = 1;

type OpenSubCall = {
    playerId: number;
    targetUid: number;
    groupId: number;
    type: number;
    options?: { varps?: Record<number, number> };
};

function createHarness() {
    const registry = new ScriptRegistry();
    const services: ScriptServices = createTestScriptServices();
    const sentVarbits: Array<{ playerId: number; varbitId: number; value: number }> = [];
    const openSubs: OpenSubCall[] = [];
    let combatStateCalls = 0;

    services.sendVarbit = (player, varbitId, value) => {
        sentVarbits.push({ playerId: player.id, varbitId, value });
    };
    services.openSubInterface = (player, targetUid, groupId, type = 0, options) => {
        openSubs.push({
            playerId: player.id,
            targetUid,
            groupId,
            type,
            options,
        });
    };
    services.queueCombatState = () => {
        combatStateCalls++;
    };

    combatWidgetModule.register(registry, services);
    spellbookWidgetModule.register(registry, services);

    return {
        registry,
        sentVarbits,
        openSubs,
        get combatStateCalls() {
            return combatStateCalls;
        },
    };
}

(function testCombatWidgetAutocastSelectionAndDisableFlow() {
    const harness = createHarness();
    const player = new PlayerState(1, 3200, 3200, 0);
    (player as any).appearance.equip[EquipmentSlot.WEAPON] = 1381;

    const openChooser = harness.registry.findButton(
        COMBAT_WIDGET_GROUP_ID,
        AUTOCAST_BUTTON_COMPONENT,
    );
    assert(openChooser, "combat autocast chooser button should be registered");
    openChooser({
        tick: 1,
        player,
        widgetId: (COMBAT_WIDGET_GROUP_ID << 16) | AUTOCAST_BUTTON_COMPONENT,
        groupId: COMBAT_WIDGET_GROUP_ID,
        childId: AUTOCAST_BUTTON_COMPONENT,
        services: {} as any,
    } as any);

    assert.strictEqual(player.pendingAutocastDefensive, false);
    assert.strictEqual(harness.openSubs.length, 1);
    assert.strictEqual(harness.openSubs[0]?.groupId, AUTOCAST_POPUP_GROUP_ID);
    assert.strictEqual(harness.openSubs[0]?.options?.varps?.[VARP_AUTOCAST_SPELLPOS], -1);

    const selectSpell = harness.registry.findButton(
        AUTOCAST_POPUP_GROUP_ID,
        AUTOCAST_INDEX_WIND_STRIKE,
    );
    assert(selectSpell, "autocast popup spell button should be registered");
    selectSpell({
        tick: 2,
        player,
        widgetId: (AUTOCAST_POPUP_GROUP_ID << 16) | AUTOCAST_INDEX_WIND_STRIKE,
        groupId: AUTOCAST_POPUP_GROUP_ID,
        childId: AUTOCAST_INDEX_WIND_STRIKE,
        services: {} as any,
    } as any);

    assert.strictEqual(
        player.combatSpellId,
        getSpellIdFromAutocastIndex(AUTOCAST_INDEX_WIND_STRIKE),
    );
    assert.strictEqual(player.autocastEnabled, true);
    assert.strictEqual(player.autocastMode, "autocast");
    assert.strictEqual(harness.combatStateCalls, 1);

    const disableAutocast = harness.registry.findButton(
        COMBAT_WIDGET_GROUP_ID,
        AUTOCAST_SPELL_ICON_COMPONENT,
    );
    assert(disableAutocast, "combat autocast disable button should be registered");
    disableAutocast({
        tick: 3,
        player,
        widgetId: (COMBAT_WIDGET_GROUP_ID << 16) | AUTOCAST_SPELL_ICON_COMPONENT,
        groupId: COMBAT_WIDGET_GROUP_ID,
        childId: AUTOCAST_SPELL_ICON_COMPONENT,
        services: {} as any,
    } as any);

    assert.strictEqual(player.combatSpellId, -1);
    assert.strictEqual(player.autocastEnabled, false);
    assert.strictEqual(player.autocastMode, null);
    assert.strictEqual(harness.combatStateCalls, 2);
})();

(function testSpellbookAutocastHandlersRemainRegistered() {
    const harness = createHarness();
    const handler = harness.registry.findWidgetAction((218 << 16) | 9, 2, undefined);
    assert(handler, "spellbook autocast handler should be registered");
})();

console.log("Autocast widget handlers test passed.");
