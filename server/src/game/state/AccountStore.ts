/**
 * Account store — persistent authentication records separate from in-game state.
 *
 * Accounts are small, slow-changing, and must exist independently of whether the
 * player has ever actually entered the world. Keeping them in a separate file from
 * player-state.json means:
 *   - The game state persistence layer can stay focused on gameplay data.
 *   - We can swap the account backend (SQLite, Postgres) without touching gameplay.
 *   - Resetting player state (wipes, testing) doesn't wipe account credentials.
 *
 * The default implementation is {@link JsonAccountStore} — an atomic-write JSON
 * file at {@code server/data/accounts.json}.
 *
 * Passwords are hashed with Node's built-in scrypt. No third-party dependency.
 */

import { randomFillSync, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { logger } from "../../utils/logger";

/** Hashing algorithm tag stored alongside each record, so we can migrate later. */
const ALGORITHM_V1 = "scrypt-n16384-r8-p1-64" as const;
type AlgorithmTag = typeof ALGORITHM_V1;

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LEN = 64;
const SCRYPT_SALT_LEN = 16;

/**
 * Convert a Uint8Array to a lowercase hex string.
 *
 * Node's `Buffer.toString("hex")` would also work, but `Buffer`'s recent
 * TypeScript types (generic over `ArrayBufferLike`) don't cleanly satisfy
 * the `BinaryLike` parameter of `scryptSync`/`timingSafeEqual` under strict
 * settings, so we stay in plain `Uint8Array` territory throughout.
 */
function bytesToHex(bytes: Uint8Array): string {
    let out = "";
    for (let i = 0; i < bytes.length; i++) {
        out += bytes[i].toString(16).padStart(2, "0");
    }
    return out;
}

function hexToBytes(hex: string): Uint8Array {
    if (hex.length % 2 !== 0) {
        throw new Error(`invalid hex string length: ${hex.length}`);
    }
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) {
        const byte = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
        if (!Number.isFinite(byte)) {
            throw new Error(`invalid hex character at offset ${i * 2}`);
        }
        out[i] = byte;
    }
    return out;
}

export interface AccountRecord {
    /** Lowercased, trimmed username. Primary key. */
    username: string;
    /** Derived key, hex encoded. */
    passwordHash: string;
    /** Per-account random salt, hex encoded. */
    passwordSalt: string;
    /** Algorithm + params identifier. */
    algorithm: AlgorithmTag;
    /** Unix millis when account was first created. */
    createdAt: number;
    /** Unix millis of last successful login (undefined if never logged in post-creation). */
    lastLoginAt?: number;
    /** If banned, login is rejected even with correct password. */
    banned?: boolean;
    /** Free-form reason shown to moderator logs. */
    banReason?: string;
}

/** Outcome of {@link AccountStore.verifyOrRegister}. */
export type AccountAuthResult =
    | { kind: "ok"; account: AccountRecord; created: boolean }
    | { kind: "wrong_password" }
    | { kind: "banned"; reason?: string }
    | { kind: "password_too_short"; minLength: number }
    | { kind: "error"; error: Error };

export interface AccountStore {
    /**
     * Look up an account by username. If it exists, verify the password.
     * If it doesn't exist, auto-register with the provided password (subject
     * to minimum-length rules).
     */
    verifyOrRegister(username: string, password: string): AccountAuthResult;

    /** Check whether an account already exists. Does NOT verify the password. */
    exists(username: string): boolean;

    /** Total number of registered accounts. */
    size(): number;
}

export interface JsonAccountStoreOptions {
    filePath: string;
    minPasswordLength?: number;
}

/**
 * File-backed account store. Persists all accounts as a single JSON file
 * keyed by normalized username. Uses atomic rename-on-write so a crash
 * during save can't corrupt the file.
 *
 * Concurrency: all methods are synchronous and assume single-threaded
 * access from the game tick loop. No file locking.
 */
export class JsonAccountStore implements AccountStore {
    private readonly filePath: string;
    private readonly minPasswordLength: number;
    private accounts: Map<string, AccountRecord> = new Map();

    constructor(opts: JsonAccountStoreOptions) {
        this.filePath = opts.filePath;
        this.minPasswordLength = Math.max(1, opts.minPasswordLength ?? 8);
        this.load();
    }

    private load(): void {
        if (!existsSync(this.filePath)) {
            logger.info(`[accounts] no existing account file at ${this.filePath} — starting fresh`);
            return;
        }
        try {
            const raw = readFileSync(this.filePath, "utf-8");
            const parsed = JSON.parse(raw) as Record<string, AccountRecord>;
            const entries = Object.entries(parsed);
            this.accounts = new Map(entries);
            logger.info(`[accounts] loaded ${this.accounts.size} account(s) from ${this.filePath}`);
        } catch (err) {
            logger.warn(`[accounts] failed to load ${this.filePath}`, err);
        }
    }

    private save(): void {
        try {
            const dir = dirname(this.filePath);
            if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
            const snapshot: Record<string, AccountRecord> = {};
            for (const [k, v] of this.accounts) snapshot[k] = v;
            const tmp = `${this.filePath}.tmp`;
            writeFileSync(tmp, JSON.stringify(snapshot, null, 2));
            renameSync(tmp, this.filePath);
        } catch (err) {
            logger.error(`[accounts] failed to save ${this.filePath}`, err);
        }
    }

    exists(username: string): boolean {
        return this.accounts.has(username.trim().toLowerCase());
    }

    size(): number {
        return this.accounts.size;
    }

    verifyOrRegister(username: string, password: string): AccountAuthResult {
        const key = username.trim().toLowerCase();
        if (!key) return { kind: "wrong_password" };
        try {
            const existing = this.accounts.get(key);
            if (existing) {
                if (existing.banned) {
                    return { kind: "banned", reason: existing.banReason };
                }
                if (!this.verifyPassword(password, existing)) {
                    return { kind: "wrong_password" };
                }
                existing.lastLoginAt = Date.now();
                this.save();
                return { kind: "ok", account: existing, created: false };
            }

            // Account doesn't exist — register a new one.
            if (password.length < this.minPasswordLength) {
                return { kind: "password_too_short", minLength: this.minPasswordLength };
            }
            const record = this.hashNewPassword(key, password);
            this.accounts.set(key, record);
            this.save();
            logger.info(`[accounts] created new account "${key}" (total=${this.accounts.size})`);
            return { kind: "ok", account: record, created: true };
        } catch (err) {
            return { kind: "error", error: err instanceof Error ? err : new Error(String(err)) };
        }
    }

    private hashNewPassword(username: string, password: string): AccountRecord {
        const salt = new Uint8Array(SCRYPT_SALT_LEN);
        randomFillSync(salt);
        const hash = new Uint8Array(
            scryptSync(password, salt, SCRYPT_KEY_LEN, {
                N: SCRYPT_N,
                r: SCRYPT_R,
                p: SCRYPT_P,
            }),
        );
        return {
            username,
            passwordHash: bytesToHex(hash),
            passwordSalt: bytesToHex(salt),
            algorithm: ALGORITHM_V1,
            createdAt: Date.now(),
        };
    }

    private verifyPassword(password: string, record: AccountRecord): boolean {
        if (record.algorithm !== ALGORITHM_V1) {
            logger.warn(`[accounts] unknown algorithm "${record.algorithm}" for ${record.username}`);
            return false;
        }
        try {
            const salt = hexToBytes(record.passwordSalt);
            const expected = hexToBytes(record.passwordHash);
            const actual = new Uint8Array(
                scryptSync(password, salt, expected.length, {
                    N: SCRYPT_N,
                    r: SCRYPT_R,
                    p: SCRYPT_P,
                }),
            );
            if (actual.length !== expected.length) return false;
            return timingSafeEqual(actual, expected);
        } catch (err) {
            logger.warn("[accounts] password verify error", err);
            return false;
        }
    }
}
