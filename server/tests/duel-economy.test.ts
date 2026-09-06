import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DuelEconomy } from "../gamemodes/duel/DuelEconomy";
import { DuelTradeService } from "../gamemodes/duel/DuelTradeService";
import { DuelGamemode } from "../gamemodes/duel";
import { registerDuelProviders } from "../gamemodes/duel/DuelProviders";
import { PlayerState } from "../src/game/player";
import { PlayerPersistence } from "../src/game/state/PlayerPersistence";
import { getSqliteDatabase } from "../src/game/state/SqliteDatabase";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "duel-economy-"));
const database = getSqliteDatabase({dataDir});
const persistence = new PlayerPersistence({dataDir});
let economy = new DuelEconomy(database);
const gamemode = new DuelGamemode();
registerDuelProviders();

function player(id: number, name: string, restore = false): PlayerState {
    const result = new PlayerState(id, 3380, 3270, 0, gamemode);
    result.name = name;
    result.__saveKey = name.toLowerCase();
    if (restore) persistence.applyToPlayer(result, result.__saveKey);
    economy.initialize(result);
    return result;
}

function gold(player: PlayerState): number { return economy.wallet(player).inventory.gold; }
function savedGold(key: string): number {
    const row = database.connection.prepare("SELECT state_json AS state FROM player_states WHERE account_name = ?").get(key) as {state:string};
    return (JSON.parse(row.state).inventory as Array<{itemId:number;quantity:number}>).filter((entry) => entry.itemId === 995).reduce((sum, entry) => sum + entry.quantity, 0);
}
const zero = {gold:0,platinum:0};

try {
    let alice = player(1, "alice"), bob = player(2, "bob"), other = player(3, "other");
    assert.equal(gold(alice), 1_000_000);
    economy.initialize(alice);
    assert.equal(gold(alice), 1_000_000, "login cannot repeat the starter grant");
    alice.setInventorySlot(8, 4151, 1);
    economy.bank(alice, "deposit", "gold", 100_000);
    assert.deepEqual(economy.wallet(alice), {inventory:{gold:900_000,platinum:0},bank:{gold:100_000,platinum:0}});
    assert.equal(alice.getInventoryEntries()[8].itemId, 4151, "banking preserves unrelated inventory");
    economy.bank(alice, "withdraw", "gold", 40_000);
    economy.exchange(alice, "gold", 10_000);
    assert.deepEqual(economy.wallet(alice).inventory, {gold:930_000,platinum:10});
    economy.exchange(alice, "platinum", 3);
    assert.deepEqual(economy.wallet(alice).inventory, {gold:933_000,platinum:7});
    for (const value of [-1, 0.5, NaN, Infinity, 2_147_483_648]) {
        assert.throws(() => economy.bank(alice, "deposit", "gold", value));
        assert.throws(() => economy.reserve(`invalid-${value}`, [alice,bob], [{gold:value,platinum:0},zero]));
    }
    assert.throws(() => economy.exchange(alice, "gold", 999), /multiples/);
    assert.throws(() => economy.exchange(alice, "platinum", 8), /enough/);
    assert.equal(gold(alice), 933_000);
    assert.equal(savedGold("alice"), gold(alice));

    const beforeAlice = gold(alice), beforeBob = gold(bob);
    assert.throws(() => economy.reserve("insufficient", [alice,bob], [{gold:20_000,platinum:0},{gold:1_000_001,platinum:0}]), /enough/);
    assert.equal(gold(alice), beforeAlice, "failed second debit rolls back the first in memory");
    assert.equal(savedGold("alice"), beforeAlice, "failed reserve cannot change durable inventory");
    assert.equal(database.connection.prepare("SELECT 1 FROM duel_currency_sessions WHERE id = 'insufficient'").get(), undefined);
    const save = alice.exportPersistentVars;
    alice.exportPersistentVars = () => { throw new Error("simulated save failure"); };
    assert.throws(() => economy.trade("failed-save", [alice,bob], [{gold:500,platinum:0},zero]), /simulated/);
    alice.exportPersistentVars = save;
    assert.equal(gold(alice), beforeAlice);
    assert.equal(gold(bob), beforeBob);
    assert.equal(savedGold("bob"), beforeBob, "both player saves and transaction ledger roll back");

    economy.reserve("duel-win", [alice,bob], [{gold:50_000,platinum:2},{gold:70_000,platinum:0}]);
    assert.equal(gold(alice), beforeAlice - 50_000);
    assert.throws(() => economy.settle("duel-win", other, [alice,bob,other]), /fighters/);
    economy.settle("duel-win", alice, [alice,bob]);
    assert.equal(gold(alice), beforeAlice + 70_000);
    assert.equal(gold(bob), beforeBob - 70_000);
    economy.settle("duel-win", alice, [alice,bob]);
    assert.equal(gold(alice), beforeAlice + 70_000, "duplicate victory event never pays twice");
    assert.throws(() => economy.reserve("duel-win", [alice,bob], [zero,zero]), /already/);
    const refundBefore = gold(alice);
    economy.reserve("duel-cancel", [alice,bob], [{gold:600,platinum:1},zero]);
    economy.settle("duel-cancel", null, [alice,bob]);
    economy.settle("duel-cancel", null, [alice,bob]);
    assert.equal(gold(alice), refundBefore, "cancel refunds only once");

    economy.reserve("server-crash", [alice,bob], [{gold:12_345,platinum:3},{gold:67_890,platinum:0}]);
    const crashAlice = gold(alice), crashBob = gold(bob);
    economy = new DuelEconomy(database);
    alice = player(1, "alice", true);
    bob = player(2, "bob", true);
    assert.equal(gold(alice), crashAlice + 12_345, "restart restores unresolved escrow, not the starter grant");
    assert.equal(gold(bob), crashBob + 67_890);
    assert.equal(economy.wallet(alice).bank.gold, 60_000, "personal bank survives reconnect");
    assert.equal(economy.wallet(alice).inventory.platinum, 7, "tokens survive restart and refund");
    economy = new DuelEconomy(database);
    economy.initialize(alice);
    assert.equal(gold(alice), crashAlice + 12_345, "repeated recovery cannot duplicate refunds");

    // A winner may reconnect while their award is still a durable offline credit.
    let rich = player(40, "rich"), rival = player(41, "rival");
    const limit = 2_147_483_647;
    rich.setInventorySlot(0, 995, limit);
    rich.setBankSlot(0, 995, limit);
    economy.reserve("offline-winner", [rich,rival], [{gold:1000,platinum:0},{gold:500,platinum:0}]);
    const staleRich = rich;
    economy.settle("offline-winner", rich, [rival]);
    assert.equal(savedGold("rich"), limit - 1000, "offline winner remains debited until collecting their durable credit");
    rich = player(42, "rich", true);
    assert.equal(gold(rich), limit, "offline awards fill the inventory up to its exact stack limit");
    const pending = database.connection.prepare("SELECT sum(quantity) AS quantity FROM duel_currency_credits WHERE account_name = 'rich'").get() as {quantity:number};
    assert.equal(pending.quantity, 500, "award overflow is retained when inventory and bank are full");
    economy.exchange(rich, "gold", 1000);
    assert.deepEqual(economy.wallet(rich), {inventory:{gold:limit - 500,platinum:1},bank:{gold:limit,platinum:0}}, "freed capacity collects pending awards exactly once");
    economy.settle("offline-winner", staleRich, [staleRich,rival]);
    assert.equal(savedGold("rich"), limit - 500, "replayed settlement cannot overwrite the reconnected account with stale balances");
    rich = player(43, "rich", true);
    assert.equal(gold(rich), limit - 500, "reconnecting again cannot duplicate the award or starter grant");
    const beforeOverflow = economy.wallet(rich), beforeRival = economy.wallet(rival);
    assert.throws(() => economy.trade("overflow-trade", [rich,rival], [zero,{gold:1000,platinum:0}]), /cannot hold/);
    assert.deepEqual(economy.wallet(rich), beforeOverflow);
    assert.deepEqual(economy.wallet(rival), beforeRival, "overflow receiving a trade refunds both tentative debits");

    const players = new Map([[alice.id,alice],[bob.id,bob],[other.id,other]]);
    let tick = 0;
    const messages: string[] = [];
    const trades = new DuelTradeService(economy, {getPlayer:(id)=>players.get(id), isAvailable:()=>true,
        notice:(_player,message)=>messages.push(message), getTick:()=>tick});
    trades.command(alice, ["trade_request", String(bob.id)]);
    const request = trades.requests(bob)[0];
    trades.command(other, ["trade_accept",request.id]);
    assert.equal(trades.snapshot(other), null, "third party cannot accept another player's request");
    trades.command(bob, ["trade_accept",request.id]);
    const id = trades.snapshot(alice)!.id;
    trades.command(alice, ["trade_offer",id,"0","10000","1"]);
    trades.command(alice, ["trade_review",id,"1"]);
    assert.equal(trades.snapshot(alice)!.selfAccepted, true);
    trades.command(bob, ["trade_offer",id,"1","20000","0"]);
    assert.equal(trades.snapshot(alice)!.selfAccepted, false, "changed offer resets both approvals");
    trades.command(alice, ["trade_review",id,"1"]);
    assert.equal(trades.snapshot(alice)!.selfAccepted, false, "stale approval is rejected");
    trades.command(alice, ["trade_review",id,"2"]);
    trades.command(bob, ["trade_review",id,"2"]);
    assert.equal(trades.snapshot(alice)!.stage, "review");
    assert.equal(trades.snapshot(alice)!.revision, 3);
    trades.command(alice, ["trade_confirm",id,"3"]);
    trades.command(bob, ["trade_offer",id,"3","20000","0"]);
    assert.equal(trades.snapshot(alice)!.stage, "offer", "Edit offer returns to editing even when amounts are unchanged");
    assert.equal(trades.snapshot(alice)!.selfAccepted, false);
    assert.equal(trades.snapshot(alice)!.revision, 4);
    trades.command(alice, ["trade_review",id,"4"]);
    trades.command(bob, ["trade_review",id,"4"]);
    const tradeAlice = gold(alice), tradeBob = gold(bob);
    trades.command(alice, ["trade_confirm",id,"5"]);
    assert.equal(gold(alice), tradeAlice, "no transfer until both final confirmations");
    trades.command(bob, ["trade_confirm",id,"5"]);
    assert.equal(trades.snapshot(alice), null);
    assert.equal(gold(alice), tradeAlice + 10_000);
    assert.equal(gold(bob), tradeBob - 10_000);
    assert.equal(economy.wallet(bob).inventory.platinum, 1);
    trades.command(bob, ["trade_confirm",id,"5"]);
    assert.equal(gold(alice), tradeAlice + 10_000, "replayed final confirmation cannot repeat transfer");
    trades.command(alice, ["trade_request", String(bob.id)]);
    trades.command(bob, ["trade_accept",trades.requests(bob)[0].id]);
    const cancelId = trades.snapshot(alice)!.id;
    trades.command(alice, ["trade_offer",cancelId,"0","1000","0"]);
    trades.disconnect(alice.id);
    assert.equal(trades.snapshot(bob), null);
    assert.equal(gold(alice), tradeAlice + 10_000, "disconnect during offer cannot remove funds");
    trades.command(alice, ["trade_request", String(bob.id)]);
    tick = 51; trades.tick();
    assert.equal(trades.requests(bob).length, 0);
    assert.throws(() => database.connection.prepare("INSERT INTO duel_currency_credits (account_name,currency,quantity) VALUES ('alice','gold',1.5)").run(), /CHECK/);
    console.log("duel economy: persistence, amounts, rollback, payouts, crash recovery, trade consent and replay checks passed");
} finally {
    database.connection.close();
    const resolved = fs.realpathSync(dataDir);
    if (path.dirname(resolved) === fs.realpathSync(os.tmpdir()) && path.basename(resolved).startsWith("duel-economy-")) {
        fs.rmSync(resolved, {recursive:true,force:true});
    }
}
