import assert from "node:assert/strict";
import { createIdleDuelSnapshot, DuelSnapshot } from "../common/duel/DuelProtocol";
import { createDuelChatRequests } from "../game/duel/DuelChatRequests";
import { createDuelChatEventBridge } from "../game/duel/DuelChatChannels";
import { chatHistory } from "../rs/cs2/ChatHistory";
import { bindNativeChatRow, getNativeChatRowUid, recordNativeChatRead } from "../rs/cs2/ChatRowIdentity";
import { registerChatOps } from "../rs/cs2/handlers/ChatOps";
import { registerWidgetEventOps } from "../rs/cs2/handlers/WidgetEventOps";
import { Opcodes } from "../rs/cs2/Opcodes";
import type { HandlerMap } from "../rs/cs2/handlers/HandlerTypes";

let state: DuelSnapshot = createIdleDuelSnapshot();
state.self = { id: 1, name: "Alice", hp: 99, maxHp: 99, weaponId: 5698, specialEnergy: 100, ready: false };
state.requests = [{ id: "request-old", fromId: 2, fromName: "Bob", weaponId: 5698, expiresInTicks: 30 }];
state.tradeRequests = [{ id: "trade-current", fromId: 3, fromName: "Carol", expiresInTicks: 30 }];
const commands: string[] = [], notices: string[] = [];
const requests = createDuelChatRequests(() => state, command => commands.push(command), text => notices.push(text));
const bridge = createDuelChatEventBridge((type, text, from, request) => {
    const uid = chatHistory.addMessage(type, text, from);
    if (request) requests.register(uid, request);
});
chatHistory.clear();
bridge(state); bridge(state);
const oldUid = chatHistory.getRecentMessages().find(message => message.type === 103)!.uid;
const tradeUid = chatHistory.getRecentMessages().find(message => message.type === 101)!.uid;
assert.equal(chatHistory.getLength(103), 1);
assert.equal(chatHistory.getLength(101), 1);
assert.equal(chatHistory.getLength(0), 1, "snapshot messages appear once in native game chat");
state.message = "Your challenge was sent.";
bridge(state); bridge(state);
assert.equal(chatHistory.getLength(0), 2);

// Exercise the actual native history-read and onOp opcode hooks used by cache script84.
const vm = {}, widget = { groupId: 162, uid: (162 << 16) | 60, onOp: [86, -2147483644, "event_opbase", 103] };
const handlers: HandlerMap = new Map();
registerChatOps(handlers);
registerWidgetEventOps(handlers);
const ctx: any = {
    currentScriptId: 84, cs2Vm: vm, intStack: [oldUid], intStackSize: 1,
    pushInt() {}, pushString() {},
    widgetManager: { getWidgetByUid: () => widget },
    setEventHandlerByUid() { this.intStackSize--; },
};
handlers.get(Opcodes.CHAT_GETHISTORYEX_BYUID)!(ctx, 0);
ctx.intStack = [widget.uid]; ctx.intStackSize = 1;
handlers.get(Opcodes.IF_SETONOP)!(ctx, 0);
assert.equal(getNativeChatRowUid(widget), oldUid, "native clickable row retains its exact history UID");

state.requests = [{ ...state.requests[0], id: "request-new" }];
bridge(state);
const newUid = chatHistory.getRecentMessages().filter(message => message.type === 103).at(-1)!.uid;
assert.equal(requests.accept(oldUid, "Accept challenge"), true, "stale line is consumed");
assert.deepEqual(commands, [], "old Bob request cannot accept a newer Bob request");
assert.equal(notices.length, 1);
assert.equal(requests.accept(newUid, "Message"), false, "native social options remain available");
assert.equal(requests.accept(newUid, "Accept challenge"), true);
assert.equal(requests.accept(newUid, "Accept challenge"), true);
assert.deepEqual(commands, ["respond request-new accept"], "repeated clicks accept exactly once");
assert.equal(requests.accept(tradeUid, "Accept trade"), true);
assert.equal(commands.at(-1), "trade_accept trade-current");

const publicUid = chatHistory.addMessage(2, chatHistory.getByUid(newUid)!.text, "Malicious");
recordNativeChatRead(vm, 84, publicUid);
bindNativeChatRow(vm, 84, widget);
assert.equal(getNativeChatRowUid(widget), publicUid, "reused cache widget follows its current message");
assert.equal(requests.accept(publicUid), false, "copied public text never becomes an actionable invitation");

state = { ...state, self: { ...state.self!, id: 4 } };
assert.equal(requests.accept(newUid), true);
assert.equal(commands.length, 2, "another account cannot use a previous account's request");
state = { ...state, self: { ...state.self!, id: 1 }, status: "fighting", location: "arena" };
requests.accept(newUid);
assert.equal(commands.length, 2, "requests cannot open an offer during combat");
chatHistory.clear();
assert.equal(getNativeChatRowUid(widget), undefined, "clearing native history invalidates its row identities");
requests.reset();
assert.equal(requests.accept(newUid), false);
console.log("native chat requests: cache opcode UID links, exact-ID acceptance, spoof/stale/account guards and notice dedup passed");
