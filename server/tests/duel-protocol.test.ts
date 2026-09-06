import assert from "node:assert/strict";

import { createIdleDuelSnapshot, DuelSnapshot, DUEL_STATUSES, isDuelSnapshot } from "../../client/common/duel/DuelProtocol";
import { decodeDuelSnapshotPayload, encodeDuelSnapshotPayload } from "../../client/common/duel/DuelSnapshotCodec";
import { ServerPacketId } from "../../client/common/packets/ServerPacketId";
import { DuelStore } from "../../client/game/duel/DuelStore";
import { encodeClientMessage } from "../../client/network/packet/ClientBinaryEncoder";
import { decodeBatchedServerPackets, decodeServerPacket } from "../../client/network/packet/ServerBinaryDecoder";
import { decodeClientPacket } from "../src/network/packet/ClientBinaryDecoder";
import { encodeDuelSnapshot } from "../src/network/packet/DuelSnapshotEncoder";

const empty: DuelSnapshot = { ...createIdleDuelSnapshot(), message: "" };
// Independent V2 fixture: 38-byte idle payload, null winner at packet bytes 10–11.
const fixture = new Uint8Array(41);
fixture[0] = 211; fixture[2] = 38; fixture[3] = 2; fixture[10] = 255; fixture[11] = 255;
assert.deepEqual(encodeDuelSnapshot(empty), fixture);
assert.deepEqual(decodeServerPacket(fixture), {
    type: "duel_snapshot", payload: empty,
});

const fighting: DuelSnapshot = {
    ...createIdleDuelSnapshot(),
    roomCode: "AB9XYZ", status: "fighting", countdownTicks: 0,
    self: { id: 1, name: "Dagger Élite", hp: 82, maxHp: 99, weaponId: 5698, specialEnergy: 75, ready: true },
    opponent: { id: 2047, name: "Opponent", hp: 63, maxHp: 99, weaponId: 5698, specialEnergy: 50, ready: true },
    winnerId: null, message: "Fight! ⚔",
    location: "arena", agreedWeaponId: 5698,
    lobbyPlayers: [{ id: 3, name: "Lobby Élite" }],
    requests: [{ id: "REQUEST_A", fromId: 3, fromName: "Lobby Élite", weaponId: 4151, expiresInTicks: 100 }],
    stake: { revision: 4294967295, self: { gold: 250_000, platinum: 2 }, opponent: { gold: 100_000, platinum: 0 },
        selfAccepted: true, opponentAccepted: true, selfConfirmed: true, opponentConfirmed: true },
    wallet: { inventory: { gold: 750_000, platinum: 98 }, bank: { gold: 2147483647, platinum: 0 } },
    trade: { id: "trade_a", revision: 3, stage: "review", opponentId: 4, opponentName: "Merchant",
        selfOffer: { gold: 1500, platinum: 0 }, opponentOffer: { gold: 0, platinum: 1 }, selfAccepted: true, opponentAccepted: false },
    tradeRequests: [{ id: "trade_b", fromId: 5, fromName: "Trader", expiresInTicks: 10 }],
};

for (const status of DUEL_STATUSES) {
    const snapshot = { ...fighting, status, countdownTicks: status === "countdown" ? 5 : 0,
        winnerId: status === "finished" ? 1 : null };
    const packet = encodeDuelSnapshot(snapshot);
    assert.equal(packet[0], ServerPacketId.DUEL_SNAPSHOT);
    assert.equal((packet[1] << 8) | packet[2], packet.length - 3);
    assert.deepEqual(decodeServerPacket(packet), { type: "duel_snapshot", payload: snapshot });
}

const packets = [encodeDuelSnapshot(empty), encodeDuelSnapshot(fighting)];
const batched = new Uint8Array(packets[0].length + packets[1].length);
batched.set(packets[0]);
batched.set(packets[1], packets[0].length);
assert.deepEqual(decodeBatchedServerPackets(batched), [
    { type: "duel_snapshot", payload: empty }, { type: "duel_snapshot", payload: fighting },
]);

const payload = encodeDuelSnapshotPayload(fighting);
for (let length = 0; length < payload.length; length++) {
    assert.throws(() => decodeDuelSnapshotPayload(payload.slice(0, length)), `truncated at ${length}`);
}
for (const [index, value] of [[0, 3], [1, 99], [5 + fighting.roomCode!.length, 2]]) {
    const malformed = payload.slice();
    malformed[index] = value;
    assert.throws(() => decodeDuelSnapshotPayload(malformed));
}
assert.throws(() => decodeDuelSnapshotPayload(Uint8Array.from([...payload, 0])));
assert.throws(() => decodeDuelSnapshotPayload(Uint8Array.from([1, 0, 0, 255, 255])));
assert.throws(() => encodeDuelSnapshot({ ...fighting, roomCode: "bad code" }));
assert.throws(() => encodeDuelSnapshot({ ...fighting, self: { ...fighting.self!, weaponId: 1 } } as unknown as DuelSnapshot));
assert.throws(() => encodeDuelSnapshot({ ...fighting, self: { ...fighting.self!, specialEnergy: 1000 } }));
assert.throws(() => encodeDuelSnapshot({ ...fighting, self: { ...fighting.self!, hp: 100 } }));
assert.throws(() => encodeDuelSnapshot({ ...fighting, countdownTicks: Number.NaN }));
assert.throws(() => encodeDuelSnapshot({ ...fighting, message: "x".repeat(513) }));
for (const invalid of [
    { ...fighting, stake: { ...fighting.stake!, self: { gold: -1, platinum: 0 } } },
    { ...fighting, stake: { ...fighting.stake!, opponent: { gold: 0, platinum: 2147483648 } } },
    { ...fighting, stake: { ...fighting.stake!, revision: 4294967296 } },
    { ...fighting, wallet: { ...fighting.wallet, inventory: { gold: 1.5, platinum: 0 } } },
    { ...fighting, trade: { ...fighting.trade!, selfOffer: { gold: Number.NaN, platinum: 0 } } },
    { ...fighting, trade: { ...fighting.trade!, opponentOffer: { gold: 0, platinum: -1 } } },
    { ...fighting, requests: [{ ...fighting.requests[0], expiresInTicks: -1 }] },
    { ...fighting, lobbyPlayers: Array.from({ length: 257 }, () => ({ id: 3, name: "Player" })) },
]) {
    assert.equal(isDuelSnapshot(invalid), false);
    assert.throws(() => encodeDuelSnapshot(invalid as DuelSnapshot));
}
const overflowCurrency = encodeDuelSnapshotPayload(empty);
overflowCurrency[19] = 128; // First inventory amount becomes unsigned 2^31.
assert.throws(() => decodeDuelSnapshotPayload(overflowCurrency), "wire amounts above signed item-stack limit rejected");

const store = new DuelStore();
let updates = 0;
const initial = store.getSnapshot();
const unsubscribe = store.subscribe(() => updates++);
assert.equal(store.getSnapshot(), initial, "React receives stable snapshots between updates");
assert.equal(store.update(fighting), true);
assert.notEqual(store.getSnapshot(), fighting, "server payload is copied before publication");
assert.equal(Object.isFrozen(store.getSnapshot().self), true);
assert.equal(Object.isFrozen(store.getSnapshot().wallet.inventory), true);
assert.equal(Object.isFrozen(store.getSnapshot().requests), true);
assert.equal(Object.isFrozen(store.getSnapshot().trade!.selfOffer), true);
assert.notEqual(store.getSnapshot().stake!.self, fighting.stake!.self, "nested offers are copied before publication");
assert.equal(store.update({ ...fighting, self: {} }), false);
assert.equal(updates, 1, "malformed state never replaces the last good snapshot");
store.reset();
assert.deepEqual(store.getSnapshot(), createIdleDuelSnapshot(), "disconnect clears room and opponent");
assert.equal(updates, 2);
unsubscribe();
store.update(fighting);
assert.equal(updates, 2);

for (const action of ["challenge 2 dagger", "challenge 2 whip", "respond AABBCCDD accept", "respond AABBCCDD decline",
    "offer AABBCCDD 2 150000 10", "accept AABBCCDD 2", "confirm AABBCCDD 2", "attack", "special", "leave",
    "trade_request 2", "trade_accept trade_1", "trade_decline trade_1", "trade_offer trade_1 4 1000 2", "trade_review trade_1 4", "trade_confirm trade_1 4",
    "bank deposit gold 100000", "bank withdraw platinum 4", "exchange gold 10000"]) {
    const text = `::duel ${action}`;
    const command = decodeClientPacket(encodeClientMessage({ type: "chat", payload: { text, messageType: "public" } }));
    assert.equal(command?.type, "chat");
    assert.equal(command?.payload.text, text, "duel commands retain their exact text over the binary chat packet");
}

console.log("duel-protocol.test.ts: binary snapshots, malformed packets, store reset and commands passed");
