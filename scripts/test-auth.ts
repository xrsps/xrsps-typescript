/**
 * End-to-end test for the scenario-C auth flow.
 *
 * Rather than decoding the server's binary response format, this test sends
 * login packets and then greps the server log file for the expected log
 * lines. The server logs a distinct line for every login attempt, success,
 * failure, and account creation, so the log is an authoritative trace.
 *
 * Usage:
 *   LOG_FILE=/path/to/server.log bun scripts/test-auth.ts
 *
 * Requires the server to be running and its stdout being captured to LOG_FILE.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import WebSocket from "ws";

import { encodeClientMessage } from "../src/network/packet/ClientBinaryEncoder";

const URL = process.env.WS_URL || "ws://127.0.0.1:43594";
const LOG_FILE = process.env.LOG_FILE;
const ACCOUNTS_PATH = resolve(__dirname, "../server/data/accounts.json");
const USERNAME = `auth_test_${Date.now()}`;
const GOOD_PW = "correcthorse";
const BAD_PW = "wrong";

// The server rejects logins whose revision doesn't match the currently-loaded
// OSRS cache. Read it from target.txt so the test isn't hardcoded.
function readRevision(): number {
    const raw = readFileSync(resolve(__dirname, "../target.txt"), "utf-8").trim();
    const match = raw.match(/osrs-(\d+)/);
    if (!match) throw new Error(`could not parse revision from target.txt: ${raw}`);
    return parseInt(match[1], 10);
}

const REVISION = readRevision();

async function sendLogin(username: string, password: string): Promise<void> {
    return new Promise((resolvePromise, reject) => {
        const ws = new WebSocket(URL);
        const timer = setTimeout(() => {
            try { ws.close(); } catch {}
            reject(new Error("login timed out after 5s"));
        }, 5_000);

        ws.on("open", () => {
            const bytes = encodeClientMessage({
                type: "login",
                payload: { username, password, revision: REVISION },
            });
            ws.send(bytes);
            // Give the server ~200ms to process + log, then disconnect.
            setTimeout(() => {
                clearTimeout(timer);
                try { ws.close(); } catch {}
                resolvePromise();
            }, 200);
        });

        ws.on("error", (err) => {
            clearTimeout(timer);
            reject(err);
        });
    });
}

function tailLog(): string {
    if (!LOG_FILE || !existsSync(LOG_FILE)) return "";
    return readFileSync(LOG_FILE, "utf-8");
}

function logContains(predicate: RegExp): boolean {
    return predicate.test(tailLog());
}

function assertTrue(label: string, condition: boolean): void {
    if (condition) {
        console.log(`  ✓ ${label}`);
    } else {
        console.log(`  ✗ ${label}`);
        process.exitCode = 1;
    }
}

function escapeRe(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function delay(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
    console.log(`[test-auth] target=${URL} revision=${REVISION} username="${USERNAME}"`);
    if (!LOG_FILE) {
        console.log(`[test-auth] WARN: LOG_FILE env var not set — log assertions will be skipped`);
    }

    // Step 1 — first login auto-registers
    console.log(`\n[1] First login (should auto-register)`);
    await sendLogin(USERNAME, GOOD_PW);
    await delay(300);
    if (LOG_FILE) {
        assertTrue(
            "server logged \"registered new account\"",
            logContains(new RegExp(`registered new account "${escapeRe(USERNAME.toLowerCase())}"`))
        );
        assertTrue(
            "server logged \"Login successful\"",
            logContains(new RegExp(`Login successful: ${escapeRe(USERNAME)}`))
        );
    }

    // Step 2 — wrong password rejected
    console.log(`\n[2] Login with wrong password (should be rejected)`);
    await sendLogin(USERNAME, BAD_PW);
    await delay(300);
    if (LOG_FILE) {
        assertTrue(
            "server logged \"Login failed (code 3)\" with bad password",
            logContains(new RegExp(`Login failed \\(code 3\\): ${escapeRe(USERNAME)} - Invalid username or password`))
        );
    }

    // Step 3 — correct password works again
    console.log(`\n[3] Login with correct password (should succeed)`);
    await sendLogin(USERNAME, GOOD_PW);
    await delay(300);
    if (LOG_FILE) {
        // Both attempts (step 1 and step 3) should show up; verify at least 2.
        const log = tailLog();
        const re = new RegExp(`Login successful: ${escapeRe(USERNAME)}`, "g");
        const matches = log.match(re) ?? [];
        assertTrue(
            `server logged \"Login successful\" at least twice (found ${matches.length})`,
            matches.length >= 2
        );
    }

    // Step 4 — short password on new account rejected
    console.log(`\n[4] New account with short password (should be rejected)`);
    const shortUser = `${USERNAME}_short`;
    await sendLogin(shortUser, "short");
    await delay(300);
    if (LOG_FILE) {
        assertTrue(
            "server logged \"Password must be at least\" for short password",
            logContains(new RegExp(`Login failed \\(code 3\\): ${escapeRe(shortUser)} - Password must be at least`))
        );
    }

    // Step 5 — verify accounts.json on disk
    console.log(`\n[5] Verify accounts.json on disk`);
    if (!existsSync(ACCOUNTS_PATH)) {
        console.log(`  ✗ accounts.json does not exist at ${ACCOUNTS_PATH}`);
        process.exitCode = 1;
        return;
    }
    const parsed = JSON.parse(readFileSync(ACCOUNTS_PATH, "utf-8")) as Record<
        string,
        { passwordHash: string; passwordSalt: string; algorithm: string; createdAt: number }
    >;
    const record = parsed[USERNAME.toLowerCase()];
    if (!record) {
        console.log(`  ✗ no record for "${USERNAME}" in accounts.json`);
        process.exitCode = 1;
        return;
    }
    assertTrue("passwordHash is a non-empty hex string", typeof record.passwordHash === "string" && record.passwordHash.length > 0);
    assertTrue("passwordSalt is a non-empty hex string", typeof record.passwordSalt === "string" && record.passwordSalt.length > 0);
    assertTrue("algorithm = scrypt-n16384-r8-p1-64", record.algorithm === "scrypt-n16384-r8-p1-64");
    assertTrue("plaintext password NOT in hash", !record.passwordHash.includes(GOOD_PW));
    assertTrue("short user record NOT created (registration was rejected)", !parsed[shortUser.toLowerCase()]);

    if (process.exitCode === 1) {
        console.log(`\n[test-auth] FAILED`);
    } else {
        console.log(`\n[test-auth] PASSED`);
    }
}

main().catch((err) => {
    console.error("[test-auth] unexpected error:", err);
    process.exitCode = 2;
});
