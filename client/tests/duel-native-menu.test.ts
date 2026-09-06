import assert from "node:assert/strict";
import { createIdleDuelSnapshot, DUEL_WEAPONS } from "../common/duel/DuelProtocol";
import { DUEL_SHOPKEEPER } from "../common/duel/DuelShop";
import { duelInteractionStore } from "../game/duel/DuelInteractionStore";
import { duelShopStore } from "../game/duel/DuelShopStore";
import { duelStore } from "../game/duel/DuelStore";
import { applyDuelWorldMenu, canAttackDuelPlayer } from "../game/duel/DuelWorldMenu";
import { MenuTargetType, OsrsMenuEntry } from "../rs/MenuEntry";
import { worldEntriesToSimple } from "../ui/menu/MenuBridge";
import { chooseDefaultMenuEntry } from "../ui/menu/MenuEngine";
import { MenuOpcode, MenuState } from "../ui/menu/MenuState";
import { ClientState } from "../game/ClientState";
import { ClientPacket, flushPackets, getPacketWriter, setPacketSocket } from "../network/packet";

const state = createIdleDuelSnapshot();
state.self = { id: 1, name: "Alice", hp: 99, maxHp: 99, weaponId: DUEL_WEAPONS.dagger, specialEnergy: 100, ready: false };
state.lobbyPlayers = [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }];
assert.equal(duelStore.update(state), true);
let walks = 0, oldTrades = 0, openedChallenges = 0;
const walk: OsrsMenuEntry = { option: "Walk here", targetType: MenuTargetType.NONE, targetId: -1, targetName: "", targetLevel: 0, onClick: () => walks++ };
const trade: OsrsMenuEntry = { option: "Trade with", targetType: MenuTargetType.PLAYER, targetId: 2, playerServerId: 2, targetName: "Bob", targetLevel: 126, actionIndex: 1, deprioritized: true, onClick: () => oldTrades++ };
const bank: OsrsMenuEntry = { option: "Bank", targetType: MenuTargetType.LOC, targetId: 10562, targetName: "Bank chest", targetLevel: 0, actionIndex: 0 };
const bankOriginal = { ...bank };
const follow: OsrsMenuEntry = { ...trade, option: "Follow", actionIndex: 2, deprioritized: false };
const entries = [walk, follow, trade, bank];
const stopChallenge = duelInteractionStore.subscribeChallenge(player => {
    assert.deepEqual(player, { id: 2, name: "Bob" });
    openedChallenges++;
});
applyDuelWorldMenu(entries);
assert.equal(entries[0], walk, "walking keeps its original entry and callback");
assert.deepEqual(bank, bankOriginal, "bank uses the original native object action");
assert.equal(entries.find(entry => entry.option === "Follow"), follow);
const menuState = new MenuState();
const simple = worldEntriesToSimple(entries, { menuState });
const challenge = simple.find(entry => entry.option === "Challenge")!;
assert.equal(challenge.opcode, 2000 + MenuOpcode.Custom, "right-click Challenge cannot accidentally dispatch OPPLAYER1 Attack");
const playerOptions = worldEntriesToSimple(entries.filter(entry => entry === walk || entry.targetType === MenuTargetType.PLAYER));
assert.equal(chooseDefaultMenuEntry(playerOptions)?.option, "Walk here", "left-clicking an overlapping player must keep walking");
assert.equal(simple.find(entry => entry.option === "Trade with")!.opcode, 2000, "native low-priority trade uses only its custom callback");
menuState.invoke(challenge.menuStateIndex!);
assert.equal(openedChallenges, 1, "native menu invocation opens exactly one weapon dialog");
assert.equal(walks, 0, "opening a dialog must not also walk");
assert.equal(oldTrades, 0, "custom trade never executes the original trade flow");

const npc: OsrsMenuEntry = { option: "Talk-to", targetType: MenuTargetType.NPC, targetId: DUEL_SHOPKEEPER.id, npcServerId: 8, targetName: "Shop keeper", targetLevel: 0, actionIndex: 0 };
const npcEntries = [walk, npc];
applyDuelWorldMenu(npcEntries);
const npcMenu = new MenuState();
const npcOptions = worldEntriesToSimple(npcEntries, { menuState: npcMenu });
const npcEntry = npcOptions.find(entry => entry.option === "Talk-to")!;
assert.equal(chooseDefaultMenuEntry(npcOptions)?.option, "Talk-to", "token exchange must not replace the normal shopkeeper action");
assert.equal(npcOptions.find(entry => entry.option === "Exchange tokens")!.opcode, 2000 + MenuOpcode.Custom);
assert.equal(npcEntry.opcode, MenuOpcode.Custom, "shop callback does not send an unrelated NPC packet");
npcMenu.invoke(npcEntry.menuStateIndex!);
assert.equal(duelShopStore.getSnapshot().open, true);

state.location = "arena";
state.status = "fighting";
state.opponent = { ...state.self, id: 2, name: "Bob" };
assert.equal(duelStore.update(state), true);
menuState.invoke(challenge.menuStateIndex!);
assert.equal(openedChallenges, 1, "a stale lobby menu cannot challenge from the arena");
assert.equal(canAttackDuelPlayer(2), true);
assert.equal(canAttackDuelPlayer(1), false);
assert.equal(canAttackDuelPlayer(3), false, "only the paired opponent is attackable");
assert.equal(canAttackDuelPlayer(2, { ...state, status: "countdown" }), false);
const attack: OsrsMenuEntry = { ...trade, option: "Attack", opcode: undefined, actionIndex: 0, deprioritized: true };
const arenaEntries = [walk, follow, trade, attack];
applyDuelWorldMenu(arenaEntries);
assert.deepEqual(arenaEntries.map(entry => entry.option), ["Walk here", "Attack"]);
const arenaSimple = worldEntriesToSimple(arenaEntries);
assert.equal(arenaSimple.find(entry => entry.option === "Attack")!.opcode, 2044);
assert.equal(chooseDefaultMenuEntry(arenaSimple)?.option, "Walk here", "right-click attack settings retain native priority");
stopChallenge();
duelShopStore.reset();
duelStore.reset();

// Native Attack starts local combat before dispatch. Starting combat closes the
// menu, so its packet must survive both clearing and rebuilding the menu arrays.
const sent: number[][] = [];
const writer = getPacketWriter();
writer.clearBuffer();
(globalThis as any).WebSocket ??= { OPEN: 1 };
setPacketSocket({ readyState: 1, send: (data: Uint8Array) => sent.push(Array.from(data)) } as unknown as WebSocket);
ClientState.players[27] = { index: 27 };
ClientState.players[99] = { index: 99 };
ClientState.setKeybindState(82, false);
try {
    for (const rebuild of [false, true]) {
        const attackMenu = new MenuState();
        let effects = 0, closes = 0;
        const selected = attackMenu.add({
            option: "Attack", target: "Selected opponent", opcode: MenuOpcode.PlayerFirstOption,
            targetId: 27, arg1: 14, arg2: 16,
            handler: (_x, _y, context) => {
                assert.equal(context?.worldMenuStateDispatch, true);
                effects++;
                attackMenu.reset();
                if (rebuild) attackMenu.add({ option: "Attack", target: "Different player", opcode: MenuOpcode.PlayerFirstOption, targetId: 99, arg1: 90, arg2: 91 });
            },
        });
        attackMenu.invoke(selected, 123, 234, { closeMenu: () => closes++ });
        flushPackets();
        assert.deepEqual(sent.pop(), [ClientPacket.OPPLAYER1, 128, 0, 27], "menu reset/rebuild must send exactly one Attack packet to the selected opponent");
        assert.equal(ClientState.destinationX, 14, "selected local X survives menu clearing");
        assert.equal(ClientState.destinationY, 16, "selected local Y survives menu clearing");
        assert.equal(ClientState.mouseCrossX, 123);
        assert.equal(ClientState.mouseCrossY, 234);
        assert.equal(effects, 1, "local combat effects execute once");
        assert.equal(closes, 1, "the menu closes once after dispatch");
    }
} finally {
    writer.clearBuffer();
    setPacketSocket(null);
    delete ClientState.players[27];
    delete ClientState.players[99];
}
console.log("native duel menus: single callbacks, stale-menu guards, native bank/walking and attack priority passed");
