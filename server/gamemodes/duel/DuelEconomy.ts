import type { DuelCurrencyOffer, DuelWallet } from "../../../client/common/duel/DuelProtocol";
import type { PlayerState } from "../../src/game/player";
import { getGamemodeDataDir } from "../../src/game/gamemodes/GamemodeRegistry";
import { type SqliteDatabase, getSqliteDatabase } from "../../src/game/state/SqliteDatabase";
import { CURRENCIES, accountKey, changeCurrency, creditAvailable, debitOffer, requireAmount, requireOffer, wallet, type Currency } from "./DuelCurrency";
import { DuelLedger } from "./DuelLedger";

type Stake = DuelCurrencyOffer & { account: string };

export class DuelEconomy {
    private readonly ledger: DuelLedger;

    constructor(database = getSqliteDatabase({ dataDir: getGamemodeDataDir("duel") }), private readonly starterGold = 1_000_000) {
        requireAmount(starterGold);
        this.ledger = new DuelLedger(database);
    }

    initialize(player: PlayerState): void {
        this.ledger.transaction([player], () => {
            const key = accountKey(player);
            if (!this.db.prepare("SELECT 1 FROM duel_currency_accounts WHERE account_name = ?").get(key)) {
                this.db.prepare("INSERT INTO duel_currency_accounts VALUES (?, ?)").run(key, new Date().toISOString());
                this.credit(key, "gold", this.starterGold);
            }
            this.collectCredits(player);
        });
    }

    wallet(player: PlayerState): DuelWallet { return wallet(player); }

    mutateBank<T>(player: PlayerState, mutation: () => T): T {
        return this.ledger.transaction([player], () => {
            const before = wallet(player);
            const result = mutation();
            // Native banking must obey the same per-container currency limits.
            const after = wallet(player);
            for (const currency of CURRENCIES) {
                if (before.inventory[currency] + before.bank[currency] !== after.inventory[currency] + after.bank[currency]) {
                    throw Error("Your inventory or bank cannot hold that amount. Try a smaller amount.");
                }
            }
            return result;
        });
    }

    bank(player: PlayerState, direction: "deposit" | "withdraw", currency: Currency, amount: number): void {
        requireAmount(amount, false);
        if (!CURRENCIES.includes(currency) || !["deposit", "withdraw"].includes(direction)) throw new Error("Invalid bank action.");
        this.ledger.transaction([player], () => {
            changeCurrency(player, direction === "deposit" ? "inventory" : "bank", currency, -amount);
            changeCurrency(player, direction === "deposit" ? "bank" : "inventory", currency, amount);
            this.collectCredits(player);
        });
    }

    /** Convert inventory currency at the fixed rate of 1 token = 1,000 gold. */
    exchange(player: PlayerState, source: Currency, amount: number): void {
        requireAmount(amount, false);
        if (!CURRENCIES.includes(source)) throw new Error("Invalid currency.");
        if (source === "gold" && amount % 1000 !== 0) throw new Error("Exchange gold in multiples of 1,000.");
        this.ledger.transaction([player], () => {
            changeCurrency(player, "inventory", source, -amount);
            changeCurrency(player, "inventory", source === "gold" ? "platinum" : "gold", source === "gold" ? amount / 1000 : amount * 1000);
            this.collectCredits(player);
        });
    }

    reserve(id: string, players: [PlayerState, PlayerState], offers: [DuelCurrencyOffer, DuelCurrencyOffer]): void {
        this.validatePair(id, players, offers);
        this.ledger.transaction(players, () => {
            this.createSession(id, "duel", "reserved");
            players.forEach((player, index) => {
                debitOffer(player, offers[index]);
                this.db.prepare("INSERT INTO duel_currency_stakes VALUES (?, ?, ?, ?)")
                    .run(id, accountKey(player), offers[index].gold, offers[index].platinum);
            });
        });
    }

    /** Idempotent: status, durable credits, and recipient saves commit together. */
    settle(id: string, winner: PlayerState | null, players: readonly PlayerState[]): void {
        const saved = this.db.prepare("SELECT status FROM duel_currency_sessions WHERE id = ?").get(id) as {status:string} | undefined;
        // A replay must not even rewrite old player snapshots after a reconnect.
        if (saved && saved.status !== "reserved") return;
        this.ledger.transaction(players, () => {
            const session = this.db.prepare("SELECT status, kind FROM duel_currency_sessions WHERE id = ?").get(id) as {status: string; kind: string} | undefined;
            if (!session) throw new Error("The duel stake was not reserved.");
            if (session.kind !== "duel") throw new Error("Invalid duel stake session.");
            if (session.status !== "reserved") return;
            const stakes = this.db.prepare("SELECT account_name AS account, gold, platinum FROM duel_currency_stakes WHERE session_id = ?").all(id) as unknown as Stake[];
            if (stakes.length !== 2 || (winner && !stakes.some((stake) => stake.account === accountKey(winner)))) {
                throw new Error("The duel stake does not match its fighters.");
            }
            for (const stake of stakes) {
                requireOffer(stake);
                for (const currency of CURRENCIES) this.credit(winner ? accountKey(winner) : stake.account, currency, stake[currency]);
            }
            this.db.prepare("UPDATE duel_currency_sessions SET status = ?, winner_key = ? WHERE id = ?")
                .run(winner ? "settled" : "refunded", winner ? accountKey(winner) : null, id);
            for (const player of players) this.collectCredits(player);
        });
    }

    trade(id: string, players: [PlayerState, PlayerState], offers: [DuelCurrencyOffer, DuelCurrencyOffer]): void {
        this.validatePair(id, players, offers);
        this.ledger.transaction(players, () => {
            this.createSession(id, "trade", "settled");
            players.forEach((player, index) => debitOffer(player, offers[index]));
            players.forEach((player, index) => {
                for (const currency of CURRENCIES) changeCurrency(player, "inventory", currency, offers[1 - index][currency]);
            });
        });
    }

    private get db(): SqliteDatabase["connection"] { return this.ledger.database.connection; }

    private validatePair(id: string, players: [PlayerState, PlayerState], offers: [DuelCurrencyOffer, DuelCurrencyOffer]): void {
        if (typeof id !== "string" || id.length < 1 || id.length > 128) throw new Error("Invalid currency session.");
        if (players.length !== 2 || accountKey(players[0]) === accountKey(players[1])) throw new Error("Two different accounts are required.");
        if (offers.length !== 2) throw new Error("Two offers are required.");
        offers.forEach(requireOffer);
    }

    private createSession(id: string, kind: "duel" | "trade", status: "reserved" | "settled"): void {
        if (this.db.prepare("SELECT 1 FROM duel_currency_sessions WHERE id = ?").get(id)) throw new Error("This exchange has already been processed.");
        this.db.prepare("INSERT INTO duel_currency_sessions (id, kind, status, created_at) VALUES (?, ?, ?, ?)")
            .run(id, kind, status, new Date().toISOString());
    }

    private credit(account: string, currency: Currency, amount: number): void {
        requireAmount(amount);
        if (amount) this.db.prepare("INSERT INTO duel_currency_credits (account_name, currency, quantity) VALUES (?, ?, ?)").run(account, currency, amount);
    }

    private collectCredits(player: PlayerState): void {
        const credits = this.db.prepare("SELECT id, currency, quantity FROM duel_currency_credits WHERE account_name = ? ORDER BY id").all(accountKey(player)) as Array<{id:number;currency:Currency;quantity:number}>;
        for (const credit of credits) {
            const added = creditAvailable(player, credit.currency, credit.quantity);
            if (added === credit.quantity) this.db.prepare("DELETE FROM duel_currency_credits WHERE id = ?").run(credit.id);
            else if (added) this.db.prepare("UPDATE duel_currency_credits SET quantity = ? WHERE id = ?").run(credit.quantity - added, credit.id);
        }
    }
}
