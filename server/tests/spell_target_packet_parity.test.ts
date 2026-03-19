import assert from "assert";

import {
    createSelectedSpellOnGroundItemPacket,
    createSelectedSpellOnLocPacket,
    createSelectedSpellOnNpcPacket,
    createSelectedSpellOnPlayerPacket,
    createSelectedSpellOnWidgetPacket,
} from "../../src/client/selectedSpellPackets";
import { buildSelectedSpellPayload } from "../../src/shared/spells/selectedSpellPayload";
import { parsePacketsAsMessages } from "../src/network/packet/PacketHandler";

function parseSingleMessage(packet: Uint8Array) {
    const parsed = parsePacketsAsMessages(packet);
    assert.strictEqual(parsed.length, 1);
    const message = parsed[0]!.msg;
    assert(message);
    return message;
}

function testNpcSpellPacketParsesWithWidgetReferences(): void {
    const selection = buildSelectedSpellPayload((218 << 16) | 9, 9);
    assert(selection);

    const message = parseSingleMessage(
        createSelectedSpellOnNpcPacket(8235, selection, true).toArray(),
    );

    assert.strictEqual(message.type, "spell_cast_npc");
    assert.strictEqual(message.payload.npcId, 8235);
    assert.strictEqual(message.payload.spellbookGroupId, 218);
    assert.strictEqual(message.payload.widgetChildId, 9);
    assert.strictEqual(message.payload.selectedSpellWidgetId, (218 << 16) | 9);
    assert.strictEqual(message.payload.selectedSpellChildIndex, 9);
    assert.strictEqual(message.payload.selectedSpellItemId, undefined);
    assert.strictEqual(message.payload.modifierFlags, 1);
}

function testPlayerSpellPacketParsesWithWidgetReferences(): void {
    const selection = buildSelectedSpellPayload((218 << 16) | 9, 9);
    assert(selection);

    const message = parseSingleMessage(
        createSelectedSpellOnPlayerPacket(41, selection, false).toArray(),
    );

    assert.strictEqual(message.type, "spell_cast_player");
    assert.strictEqual(message.payload.playerId, 41);
    assert.strictEqual(message.payload.spellbookGroupId, 218);
    assert.strictEqual(message.payload.widgetChildId, 9);
    assert.strictEqual(message.payload.selectedSpellWidgetId, (218 << 16) | 9);
    assert.strictEqual(message.payload.selectedSpellChildIndex, 9);
    assert.strictEqual(message.payload.selectedSpellItemId, undefined);
    assert.strictEqual(message.payload.modifierFlags, 0);
}

function testLocSpellPacketParsesWithWidgetReferences(): void {
    const selection = buildSelectedSpellPayload((218 << 16) | 55, 55);
    assert(selection);

    const message = parseSingleMessage(
        createSelectedSpellOnLocPacket(100, 3235, 3219, selection, false).toArray(),
    );

    assert.strictEqual(message.type, "spell_cast_loc");
    assert.strictEqual(message.payload.locId, 100);
    assert.deepStrictEqual(message.payload.tile, { x: 3235, y: 3219 });
    assert.strictEqual(message.payload.spellbookGroupId, 218);
    assert.strictEqual(message.payload.widgetChildId, 55);
    assert.strictEqual(message.payload.selectedSpellWidgetId, (218 << 16) | 55);
    assert.strictEqual(message.payload.selectedSpellChildIndex, 55);
}

function testGroundItemSpellPacketParsesWithWidgetReferences(): void {
    const selection = buildSelectedSpellPayload((218 << 16) | 56, 56);
    assert(selection);

    const message = parseSingleMessage(
        createSelectedSpellOnGroundItemPacket(554, 3237, 3215, selection, true).toArray(),
    );

    assert.strictEqual(message.type, "spell_cast_obj");
    assert.strictEqual(message.payload.objId, 554);
    assert.deepStrictEqual(message.payload.tile, { x: 3237, y: 3215 });
    assert.strictEqual(message.payload.spellbookGroupId, 218);
    assert.strictEqual(message.payload.widgetChildId, 56);
    assert.strictEqual(message.payload.selectedSpellWidgetId, (218 << 16) | 56);
    assert.strictEqual(message.payload.selectedSpellChildIndex, 56);
    assert.strictEqual(message.payload.modifierFlags, 1);
}

function testWidgetSpellPacketParsesAsSpellOnItem(): void {
    const selection = buildSelectedSpellPayload((218 << 16) | 21, 21);
    assert(selection);

    const message = parseSingleMessage(
        createSelectedSpellOnWidgetPacket((149 << 16) | 0, 4, 561, selection).toArray(),
    );

    assert.strictEqual(message.type, "spell_cast_item");
    assert.strictEqual(message.payload.widgetId, (149 << 16) | 0);
    assert.strictEqual(message.payload.slot, 4);
    assert.strictEqual(message.payload.itemId, 561);
    assert.strictEqual(message.payload.spellbookGroupId, 218);
    assert.strictEqual(message.payload.widgetChildId, 21);
    assert.strictEqual(message.payload.selectedSpellWidgetId, (218 << 16) | 21);
    assert.strictEqual(message.payload.selectedSpellChildIndex, 21);
    assert.strictEqual(message.payload.selectedSpellItemId, undefined);
}

testNpcSpellPacketParsesWithWidgetReferences();
testPlayerSpellPacketParsesWithWidgetReferences();
testLocSpellPacketParsesWithWidgetReferences();
testGroundItemSpellPacketParsesWithWidgetReferences();
testWidgetSpellPacketParsesAsSpellOnItem();

console.log("Spell target packet parity test passed.");
