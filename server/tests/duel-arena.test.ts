import assert from "node:assert/strict";
import type { DuelCurrencyOffer, DuelSnapshot } from "../../client/common/duel/DuelProtocol";
import { ARENA_CENTER, DUEL_LOBBY_CENTER } from "../../client/common/duel/DuelProtocol";
import { DuelArenaService } from "../gamemodes/duel/DuelArenaService";
import type { DuelEconomy } from "../gamemodes/duel/DuelEconomy";
import { DuelGamemode } from "../gamemodes/duel";
import { registerDuelProviders } from "../gamemodes/duel/DuelProviders";
import { AttackType } from "../src/game/combat/AttackType";
import { CombatTargetResolver } from "../src/game/combat/engine/CombatTargetResolver";
import { DeferredHitQueue, DeferredHitsplatType } from "../src/game/combat/engine/DeferredHitQueue";
import { playerCombatEntityRef } from "../src/game/combat/model/CombatEntityRef";
import { ensureEquipQtyArrayOn } from "../src/game/equipment";
import type { GamemodeServerServices } from "../src/game/gamemodes/GamemodeDefinition";
import { PlayerState } from "../src/game/player";
import type { TickFrame } from "../src/game/tick/TickPhaseOrchestrator";

let tick = 10, reserves = 0, settlements = 0, bankCalls = 0, failReserve = false, failSettle = false;
const settled = new Map<string, number | null>();
const settleTargets: PlayerState[][] = [];
const economy = {
    initialize: () => {}, wallet: () => ({ inventory: { gold: 1_000_000, platinum: 100 }, bank: { gold: 0, platinum: 0 } }),
    bank: () => { bankCalls++; }, exchange: () => {},
    reserve: (_id: string, pair: PlayerState[], offers: DuelCurrencyOffer[]) => {
        if (failReserve) throw Error("Not enough currency.");
        assert.equal(pair.length, 2); assert.equal(offers.length, 2); reserves++;
    },
    settle: (id: string, winner: PlayerState | null, targets: PlayerState[]) => {
        if (failSettle) throw Error("Database busy.");
        assert.equal(settled.has(id), false, "the lifecycle must not request duplicate payout");
        settled.set(id, winner?.id ?? null); settleTargets.push(targets); settlements++;
    },
} as unknown as DuelEconomy;
registerDuelProviders();
const snapshots = new Map<number, DuelSnapshot>(), players = new Map<number, PlayerState>();
const services = {
    getCurrentTick: () => tick,
    queueGamemodeSnapshot: (_key: string, id: number, snapshot: DuelSnapshot) => snapshots.set(id, snapshot),
    refreshAppearance: () => {}, sendInventorySnapshot: () => {}, logger: { warn: () => {} },
    refreshCombatWeapon: (player: PlayerState) => { player.combat.weaponItemId = player.appearance.equip![3]; },
    getEquipQtyArray: (player: PlayerState) => ensureEquipQtyArrayOn(player.appearance, 14),
} as unknown as GamemodeServerServices;
const arena = new DuelArenaService(services, economy), gamemode = new DuelGamemode();
gamemode.canAttackPlayer = (a, b) => arena.canAttack(a, b);
gamemode.canMoveTo = (p, x, y) => arena.canMove(p, x, y);
gamemode.canSeePlayer = (a, b) => arena.canSee(a, b);
gamemode.getMovementGroup = (p) => arena.movementGroup(p);
function player(id: number, name = `Fighter${id}`): PlayerState {
    const result = new PlayerState(id, DUEL_LOBBY_CENTER.x, DUEL_LOBBY_CENTER.y, 0, gamemode);
    result.name = name; players.set(id, result); arena.enter(result); return result;
}
const state = (p: PlayerState) => snapshots.get(p.id)!;
// The real chat-command handler normalizes the entire command to lowercase.
// Keep this boundary in lifecycle tests so opaque IDs survive production routing.
const command = (p: PlayerState, ...args: string[]) => arena.command(p, args.map((argument) => argument.toLowerCase()));
function negotiate(a: PlayerState, b: PlayerState, weapon = "whip"): string {
    tick += 3; command(a, "challenge", String(b.id), weapon);
    const request = state(b).requests.find((entry) => entry.fromId === a.id)!;
    assert.ok(request); command(b, "respond", request.id, "accept");
    assert.equal(state(a).status, "staking"); return state(a).roomCode!;
}
function offer(p: PlayerState, gold: number, platinum = 0): void {
    command(p, "offer", state(p).roomCode!, String(state(p).stake!.revision), String(gold), String(platinum));
}
function accept(p: PlayerState): void { command(p, "accept", state(p).roomCode!, String(state(p).stake!.revision)); }
function confirm(p: PlayerState): void { command(p, "confirm", state(p).roomCode!, String(state(p).stake!.revision)); }
function start(a: PlayerState, b: PlayerState): void {
    accept(a); accept(b); confirm(a); confirm(b); assert.equal(state(a).status, "countdown");
}

const a = player(1), b = player(2), c = player(3), d = player(4);
assert.equal(a.account.accountStage, 2);
assert.equal(a.skillSystem.getHitpointsCurrent(), 99);
assert.equal(a.canLogout(), true);
assert.equal(arena.canMove(a, DUEL_LOBBY_CENTER.x, DUEL_LOBBY_CENTER.y), true, "lobby is roamable");
assert.equal(arena.canMove(a, ARENA_CENTER.x, ARENA_CENTER.y), false, "lobby cannot enter rings unauthorised");
assert.equal(arena.canSee(a, c), true, "lobby players share visibility");
assert.equal(arena.movementGroup(a), arena.movementGroup(c));
assert.equal(arena.canAttack(a, b), false);
assert.deepEqual(arena.publicChatRecipients(a), [a.id,b.id,c.id,d.id], "everyone in the lobby hears public chat");
c.teleport(DUEL_LOBBY_CENTER.x + 21, DUEL_LOBBY_CENTER.y, 0);
assert.ok(arena.publicChatRecipients(a).includes(c.id), "public chat reaches beyond the nearby player sync range");
c.teleport(DUEL_LOBBY_CENTER.x, DUEL_LOBBY_CENTER.y, 0);

command(a, "challenge", String(b.id), "whip");
let request = state(b).requests[0];
assert.match(request.id, /^[a-f0-9]{16}$/, "request IDs match the lowercase chat-command boundary");
command(c, "respond", request.id, "accept");
assert.equal(state(c).status, "idle", "another player cannot hijack a request");
tick += 101; arena.tick(tick); command(b, "respond", request.id, "accept");
assert.equal(state(b).status, "idle", "requests expire");
const code = negotiate(a, b);
command(c, "challenge", String(a.id), "dagger");
assert.match(state(c).message, /free in the lobby/);
assert.equal(arena.canSee(a, c), true, "negotiation still occurs in the shared lobby");
assert.equal(arena.canMove(a, DUEL_LOBBY_CENTER.x, DUEL_LOBBY_CENTER.y), false);
offer(a, 250_000, 5); offer(b, 150_000);
accept(a); assert.equal(state(a).stake!.selfAccepted, true);
const oldRevision = state(a).stake!.revision;
offer(b, 175_000);
assert.equal(state(a).stake!.selfAccepted, false, "editing either offer resets both approvals");
command(a, "accept", code, String(oldRevision));
assert.equal(state(a).stake!.selfAccepted, false, "stale acceptance is rejected");
command(a, "offer", code, String(state(a).stake!.revision), "-1", "0");
assert.equal(state(a).stake!.self.gold, 250_000, "negative offers rejected");
command(a, "offer", code, String(state(a).stake!.revision), "1000001", "0");
assert.equal(state(a).stake!.self.gold, 250_000, "unfunded offers rejected");
command(a, "bank", "deposit", "gold", "100"); assert.equal(bankCalls, 0, "banking cannot alter negotiating balances");
accept(a); accept(b); assert.equal(state(a).status, "review");
const reviewedRevision = state(a).stake!.revision;
offer(a, state(a).stake!.self.gold, state(a).stake!.self.platinum);
assert.equal(state(a).status, "staking", "Edit offer returns from review even without changing amounts");
assert.equal(state(a).stake!.revision, reviewedRevision + 1);
assert.equal(state(a).stake!.selfAccepted, false); assert.equal(state(a).stake!.opponentAccepted, false);
accept(a); accept(b);
confirm(a); assert.equal(reserves, 0, "one confirmation cannot reserve either stake");
offer(b, 180_000);
assert.equal(state(a).status, "staking"); assert.equal(state(a).stake!.selfConfirmed, false, "review edits reset confirmations too");
accept(a); accept(b); confirm(a); failReserve = true; confirm(b);
assert.equal(state(a).status, "staking", "failed reserve restores negotiation");
assert.equal(state(a).stake!.selfConfirmed, false);
failReserve = false;
a.setInventorySlot(0, 995, 1234);
start(a, b); assert.equal(reserves, 1);
assert.equal(a.getInventoryEntries()[0].quantity, 1234, "preparation preserves account inventory");
assert.equal(a.combat.weaponItemId, 4151); assert.equal(b.combat.weaponItemId, 4151, "one weapon applies to both humans");
command(a, "weapon", "dagger"); assert.equal(a.combat.weaponItemId, 4151);
assert.equal(arena.canAttack(a, b), false, "no attacks before countdown");
assert.equal(arena.canSee(a, c), false, "ring isolated from lobby");
assert.deepEqual(arena.publicChatRecipients(a), [a.id,b.id], "arena chat is restricted to the duel pair");
assert.deepEqual(arena.publicChatRecipients(c), [c.id,d.id], "lobby chat does not leak into isolated fights");
assert.notEqual(arena.movementGroup(a), arena.movementGroup(c));
negotiate(c, d, "dagger"); start(c, d);
tick += 5; arena.tick(tick);
assert.equal(arena.canAttack(a, b), true); assert.equal(arena.canAttack(a, c), false);
command(a, "weapon", "dagger"); assert.equal(a.combat.weaponItemId, 4151, "fighting cannot switch weapon");
const resolver = new CombatTargetResolver({ getPlayer: (id) => players.get(id), getNpc: () => undefined });
assert.equal(resolver.validatePair(a, c), "unattackable"); assert.equal(resolver.validatePair(a, b), null);
a.setPath([{ x: ARENA_CENTER.x + 6, y: ARENA_CENTER.y }, { x: ARENA_CENTER.x + 7, y: ARENA_CENTER.y }], false);
assert.equal(a.getPathQueue().length, 1, "server clips escape path before boundary");
command(a, "attack"); assert.deepEqual(a.getCombatTarget(), playerCombatEntityRef(b.id));
command(a, "special"); assert.equal(a.specEnergy.isActivated(), true);
a.specEnergy.setPercent(20); command(a, "special"); assert.match(state(a).message, /50%/);

const queue = new DeferredHitQueue({ resolveEntity: (ref) => players.get(ref.id) });
function queueHit(source: PlayerState, target: PlayerState): void {
    const traits = { type: AttackType.Melee, style: null, rangeTiles: 1, speedTicks: 4 };
    queue.enqueue({ source: playerCombatEntityRef(source.id), target: playerCombatEntityRef(target.id),
        attack: { attacker: playerCombatEntityRef(source.id), target: playerCombatEntityRef(target.id), attackClock: tick, traits },
        damage: 10, maxHit: 20, landed: true, hitsplatType: DeferredHitsplatType.Normal,
        attackType: AttackType.Melee, revealClock: tick + 1, profileId: "test" });
}
queueHit(c, b);
const frame = { hitsplats: [] } as unknown as TickFrame;
assert.equal(queue.processTick(++tick, frame).length, 0, "forged cross-room damage rejected at impact");
queueHit(a, b); assert.equal(queue.processTick(++tick, frame).length, 1, "paired players use real damage engine");
assert.equal(b.skillSystem.getHitpointsCurrent(), 89);
queueHit(a, b); b.skillSystem.setHitpointsCurrent(0);
arena.handleDeath(b); arena.handleDeath(b); arena.tick(tick);
assert.equal(state(a).winnerId, a.id); assert.equal(state(a).status, "finished");
assert.equal(settlements, 1); assert.equal(settled.get(code), a.id);
assert.equal(a.canBeAttacked(), false); assert.equal(b.appearance.equip![3], 4151);
assert.equal(queue.processTick(++tick, frame).length, 0, "queued hits cannot harm completed duel");
tick += 10; arena.tick(tick);
assert.equal(state(a).status, "idle"); assert.equal(state(b).location, "lobby");
assert.equal(b.skillSystem.getHitpointsCurrent(), 99);
const secondCode = negotiate(a, b, "dagger");
assert.notEqual(secondCode, code); assert.deepEqual(state(a).stake!.self, { gold: 0, platinum: 0 }, "new duel never reuses stakes");
command(a, "accept", code, "0"); assert.equal(state(a).stake!.selfAccepted, false, "acceptance from old session rejected");
start(a, b); arena.disconnect(b.id);
assert.equal(settled.get(secondCode), null, "disconnect during countdown refunds both players");
assert.equal(b.canLogout(), true);
command(a, "leave"); assert.equal(state(a).status, "idle");
const cCode = state(c).roomCode!;
failSettle = true; arena.disconnect(d.id);
assert.equal(state(c).winnerId, c.id); assert.equal(state(c).status, "finished");
const reconnected = player(5, d.name);
failSettle = false; arena.tick(++tick);
assert.equal(settled.get(cCode), c.id, "combat disconnect awards opponent");
assert.ok(settleTargets.at(-1)!.includes(reconnected), "settlement retry saves current connected instance");
assert.ok(!settleTargets.at(-1)!.includes(d), "settlement retry never overwrites reconnected account with stale instance");
assert.equal(gamemode.allowClientMessage(a, "chat", { text: "::spec" }), false);
assert.equal(gamemode.allowClientMessage(a, "teleport", {}), false);
assert.equal(gamemode.allowClientMessage(a, "chat", { text: "::duel attack" }), true);
assert.equal(gamemode.allowClientMessage(a, "chat", { text: "Good luck!" }), true);
console.log("duel lobby, requests, revised stakes, fixed weapons, combat isolation, refunds, settlement and reconnect tests passed");
