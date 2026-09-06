import type { PlayerState } from "../../src/game/player";
import type { SqliteDatabase } from "../../src/game/state/SqliteDatabase";
import { accountKey } from "./DuelCurrency";

/** Currency mutations and player saves always share a single SQLite transaction. */
export class DuelLedger {
    constructor(readonly database: SqliteDatabase) {
        database.connection.exec(`
            CREATE TABLE IF NOT EXISTS duel_currency_accounts (
                account_name TEXT PRIMARY KEY,
                initialized_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS duel_currency_sessions (
                id TEXT PRIMARY KEY,
                kind TEXT NOT NULL CHECK (kind IN ('duel', 'trade')),
                status TEXT NOT NULL CHECK (status IN ('reserved', 'settled', 'refunded')),
                winner_key TEXT,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS duel_currency_stakes (
                session_id TEXT NOT NULL REFERENCES duel_currency_sessions(id),
                account_name TEXT NOT NULL,
                gold INTEGER NOT NULL CHECK (typeof(gold) = 'integer' AND gold BETWEEN 0 AND 2147483647),
                platinum INTEGER NOT NULL CHECK (typeof(platinum) = 'integer' AND platinum BETWEEN 0 AND 2147483647),
                PRIMARY KEY (session_id, account_name)
            );
            CREATE TABLE IF NOT EXISTS duel_currency_credits (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_name TEXT NOT NULL,
                currency TEXT NOT NULL CHECK (currency IN ('gold', 'platinum')),
                quantity INTEGER NOT NULL CHECK (typeof(quantity) = 'integer' AND quantity BETWEEN 1 AND 2147483647)
            );
            CREATE INDEX IF NOT EXISTS idx_duel_currency_credits_account ON duel_currency_credits(account_name);
        `);
        // Only a fresh service at server boot may recover old sessions. A completed
        // transaction has already changed its status, so neither payout nor refund repeats.
        this.transaction([], () => {
            for (const currency of ["gold", "platinum"] as const) {
                database.connection.prepare(`
                    INSERT INTO duel_currency_credits (account_name, currency, quantity)
                    SELECT s.account_name, ?, s.${currency} FROM duel_currency_stakes s
                    JOIN duel_currency_sessions d ON d.id = s.session_id
                    WHERE d.status = 'reserved' AND s.${currency} > 0
                `).run(currency);
            }
            database.connection.prepare("UPDATE duel_currency_sessions SET status = 'refunded' WHERE status = 'reserved'").run();
        });
    }

    transaction<T>(players: readonly PlayerState[], mutation: () => T): T {
        const targets = new Map<string, PlayerState>();
        for (const player of players) {
            const key = accountKey(player);
            if (targets.has(key) && targets.get(key) !== player) throw new Error("This account is already active.");
            targets.set(key, player);
        }
        const backups = [...targets.values()].map((player) => ({
            player,
            inventory: player.getInventoryEntries().map((entry) => ({ ...entry })),
            bank: player.bank.getBankEntries().map((entry) => ({ ...entry })),
        }));
        const db = this.database.connection;
        db.exec("BEGIN IMMEDIATE");
        try {
            const result = mutation();
            const save = db.prepare(`INSERT INTO player_states (account_name, state_json, updated_at)
                VALUES (?, ?, ?) ON CONFLICT(account_name) DO UPDATE SET
                state_json = excluded.state_json, updated_at = excluded.updated_at`);
            for (const [key, player] of targets) {
                if (accountKey(player) !== key) throw new Error("The player account changed.");
                save.run(key, JSON.stringify(player.exportPersistentVars()), new Date().toISOString());
            }
            db.exec("COMMIT");
            return result;
        } catch (error) {
            try { db.exec("ROLLBACK"); } catch { /* Preserve the original failure. */ }
            for (const backup of backups) {
                backup.player.items.inventory = backup.inventory;
                backup.player.items.bank = backup.bank;
                backup.player.items.inventoryDirty = true;
                backup.player.items.bankDirty = true;
            }
            throw error;
        }
    }
}
