import assert from "node:assert/strict";
import type { WebSocket } from "ws";
import { VARP_ATTACK_STYLE, VARP_AUTO_RETALIATE, VARP_OPTION_RUN, VARP_SPECIAL_ATTACK,
    VARP_SPECIAL_ENERGY, VARP_MUSIC_VOLUME } from "../../client/common/vars";
import { DuelGamemode } from "../gamemodes/duel";
import { allowDuelClientMessage } from "../gamemodes/duel/DuelClientRules";
import { DUEL_LOBBY_BANK_CHESTS } from "../gamemodes/duel/DuelLobbyScene";
import { registerDuelProviders } from "../gamemodes/duel/DuelProviders";
import { PlayerState } from "../src/game/player";
import type { MessageHandlerServices } from "../src/network/MessageHandlers";
import { createVarpTransmitHandler } from "../src/network/handlers/varpTransmitHandler";

registerDuelProviders();
const player = new PlayerState(1, 3367, 3265, 0, new DuelGamemode());
player.setEquipmentSlot(3, 5698);
const allowed = (type: string, payload: unknown, idle = true) => allowDuelClientMessage(player, type, payload, idle);
const widget = (groupId: number, childId: number) => ({ groupId, childId, widgetId: (groupId << 16) | childId });
for (const id of [VARP_ATTACK_STYLE, VARP_AUTO_RETALIATE, VARP_OPTION_RUN, VARP_SPECIAL_ATTACK, VARP_MUSIC_VOLUME]) {
    assert.equal(allowed("varp_transmit", { varpId: id, value: 1 }, false), true);
}
assert.equal(allowed("varp_transmit", { varpId: VARP_SPECIAL_ENERGY, value: 1000 }), false, "cannot grant special energy");
assert.equal(allowed("varp_transmit", { varpId: 83, value: 1 }), false, "arbitrary prayer/quest state is blocked");
for (const child of [6, 10, 14, 18, 32, 39]) assert.equal(allowed("widget_action", widget(593, child), false), true);
assert.equal(allowed("widget_action", widget(593, 26)), false, "no autocast");
assert.equal(allowed("widget_action", widget(541, 1)), false, "no prayer");
assert.equal(allowed("widget_action", widget(387, 1)), true, "equipment stats still work");
assert.equal(allowed("widget_action", widget(387, 18)), false, "weapon stays equipped");
assert.equal(allowed("widget_action", widget(116, 32)), true, "native All Settings");
assert.equal(allowed("widget_action", { ...widget(116, 32), groupId: 541 }), false, "inconsistent widget identity rejected");
assert.equal(allowed("inventory_use", { slot: 0, itemId: 385, option: "Eat" }), false);
assert.equal(allowed("spell_cast_player", {}), false);
assert.equal(allowed("teleport", {}), false);
assert.equal(allowed("interact", { mode: "follow", targetId: 2 }), true);
assert.equal(allowed("interact", { mode: "follow", targetId: 2 }, false), false);
assert.equal(allowed("interact", { mode: "trade", targetId: 2 }), false, "trades use the agreed currency offer flow");
assert.equal(allowed("chat", { text: "::spec" }), false);
assert.equal(allowed("chat", { text: "::duel bank open" }), true);
const chest = DUEL_LOBBY_BANK_CHESTS[0];
const bankInteraction = { id: "locId" in chest ? chest.locId : 10562, tile: { x: chest.x, y: chest.y }, opNum: 1 };
assert.equal(allowed("loc_interact", bankInteraction), true);
assert.equal(allowed("loc_interact", bankInteraction, false), false);
assert.equal(allowed("loc_interact", { ...bankInteraction, tile: { x: 3222, y: 3218 } }), false);
assert.equal(allowed("bank_deposit_inventory", {}), false, "cannot bank without an open bank");
player.widgets.open(12, { modal: true });
assert.equal(allowed("bank_deposit_inventory", {}), true);
assert.equal(allowed("widget_action", widget(12, 12)), true);
assert.equal(allowed("widget_action", widget(12, 12), false), false, "stakes/trades lock native bank too");
assert.equal(allowed("bank_deposit_equipment", {}), false, "loaned equipment cannot enter the economy");

// Exercise the original authoritative varp handler, not a duplicate duel implementation.
let queued = 0;
const handler = createVarpTransmitHandler({
    getPlayer: () => player, withDirectSendBypass: (_kind: string, fn: () => void) => fn(),
    sendWithGuard: () => {}, queueCombatState: () => queued++, sendRunEnergyState: () => {},
    ensureEquipArray: () => player.appearance.equip!, getWeaponSpecialCostPercent: () => 25,
    getCurrentTick: () => 1, queueChatMessage: () => {},
} as unknown as MessageHandlerServices);
const transmit = (varpId: number, value: number) => handler({ type: "varp_transmit",
    ws: {} as WebSocket, player, payload: { varpId, value } });
transmit(VARP_ATTACK_STYLE, 1);
assert.equal(player.combat.styleSlot, 1);
transmit(VARP_AUTO_RETALIATE, 0);
assert.equal(player.combat.autoRetaliate, true);
transmit(VARP_AUTO_RETALIATE, 1);
assert.equal(player.combat.autoRetaliate, false);
player.specEnergy.setPercent(100);
transmit(VARP_SPECIAL_ATTACK, 1);
assert.equal(player.specEnergy.isActivated(), true);
transmit(VARP_SPECIAL_ATTACK, 0);
assert.equal(player.specEnergy.isActivated(), false);
player.specEnergy.setPercent(0);
transmit(VARP_SPECIAL_ATTACK, 1);
assert.equal(player.specEnergy.isActivated(), false, "native special refuses insufficient energy");
assert.ok(queued >= 6);
console.log("native duel HUD controls, banking guards and fixed-weapon packet rules passed");
