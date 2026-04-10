/**
 * Shared identity helper used by every dev script that needs the
 * agent's account credentials (agent-dev.ts, open-agent-browser.ts,
 * and any future tooling).
 *
 * Single source of truth so all of them see the same name / password
 * and the xRSPS server gets a consistent login across runs.
 *
 * Priority order:
 *   1. Env var overrides (SCAPE_DEV_AGENT_NAME / SCAPE_DEV_AGENT_PASS)
 *   2. Persisted file at server/data/dev-agent-identity.json
 *   3. Freshly generated, atomically written back to the file
 *
 * Generated names fit the server's 12-char display-name budget so
 * what human clients render above the agent's head matches the full
 * account name exactly.
 */

import { randomBytes } from "node:crypto";
import {
    existsSync,
    mkdirSync,
    readFileSync,
    renameSync,
    writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

export interface DevAgentIdentity {
    /** In-game display name. Fits in 12 chars. */
    name: string;
    /** Plaintext password used for scrypt auth / auto-register. */
    password: string;
    /** Unix millis when the identity was first written. */
    createdAt: number;
}

/**
 * Default identity file path. Can be overridden per-proc via the
 * SCAPE_DEV_IDENTITY_FILE env var — used by mprocs to give the
 * bot-SDK tab a different file from the browser-login tab so both
 * can run simultaneously without colliding on the server's
 * name-uniqueness check. Relative paths resolve from the repo root.
 */
export const DEV_IDENTITY_FILE: string = (() => {
    const override = process.env.SCAPE_DEV_IDENTITY_FILE?.trim();
    if (override && override.length > 0) {
        return resolve(__dirname, "..", override);
    }
    return resolve(
        __dirname,
        "..",
        "server",
        "data",
        "dev-agent-identity.json",
    );
})();

function generateName(): string {
    // `agent-XXXXXX` → exactly 12 chars, ~16.7M possibilities.
    return `agent-${randomBytes(3).toString("hex")}`;
}

function generatePassword(): string {
    // 24 chars of base64url — well above the server's 8-char minimum.
    return randomBytes(18).toString("base64url");
}

function isValid(value: unknown): value is DevAgentIdentity {
    if (!value || typeof value !== "object") return false;
    const obj = value as Record<string, unknown>;
    return (
        typeof obj.name === "string" &&
        obj.name.length > 0 &&
        typeof obj.password === "string" &&
        obj.password.length >= 8
    );
}

/**
 * Load the persisted identity or generate a new one. Subsequent
 * callers see the exact same name + password.
 *
 * Thread-safe: atomic rename-on-write, and concurrent readers either
 * see the old version or the new version, never a partial one.
 */
export function loadOrGenerateDevAgentIdentity(): DevAgentIdentity {
    const envName = process.env.SCAPE_DEV_AGENT_NAME?.trim();
    const envPass = process.env.SCAPE_DEV_AGENT_PASS?.trim();

    let fromFile: DevAgentIdentity | null = null;
    if (existsSync(DEV_IDENTITY_FILE)) {
        try {
            const raw = readFileSync(DEV_IDENTITY_FILE, "utf-8");
            const parsed = JSON.parse(raw);
            if (isValid(parsed)) {
                fromFile = parsed;
            }
        } catch {
            // malformed — fall through to regenerate
        }
    }

    const identity: DevAgentIdentity = {
        name: envName ?? fromFile?.name ?? generateName(),
        password: envPass ?? fromFile?.password ?? generatePassword(),
        createdAt: fromFile?.createdAt ?? Date.now(),
    };

    const needsWrite =
        fromFile === null ||
        fromFile.name !== identity.name ||
        fromFile.password !== identity.password;

    if (needsWrite) {
        try {
            const dir = dirname(DEV_IDENTITY_FILE);
            if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
            const tmp = `${DEV_IDENTITY_FILE}.tmp`;
            writeFileSync(tmp, JSON.stringify(identity, null, 2) + "\n");
            renameSync(tmp, DEV_IDENTITY_FILE);
        } catch (err) {
            console.warn(
                `[dev-agent-identity] failed to persist ${DEV_IDENTITY_FILE}:`,
                err,
            );
        }
    }

    return identity;
}
