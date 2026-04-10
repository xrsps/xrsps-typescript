/**
 * Bot-SDK smoke test for PR 1 of the 'scape / agent-first-class-citizen work.
 *
 * Drives the TOON-encoded protocol directly:
 *   1. Connect to ws://127.0.0.1:43595
 *   2. Send auth frame with BOT_SDK_TOKEN
 *   3. Send spawn frame, expect spawnOk
 *   4. Send walkTo action, expect ack {success: true}
 *   5. Wait a few ticks, verify at least one perception frame arrived and
 *      the self position has started moving.
 *
 * Usage:
 *   BOT_SDK_TOKEN=dev-secret bun scripts/test-botsdk.ts
 */

import { decode, encode } from "@toon-format/toon";
import WebSocket from "ws";

const URL = process.env.BOT_SDK_URL || "ws://127.0.0.1:43595";
const TOKEN = process.env.BOT_SDK_TOKEN;
const AGENT_ID = `test-agent-${Date.now()}`;
const DISPLAY_NAME = `testagent${Date.now() % 10000}`;
const PASSWORD = "correcthorse-battery-staple";

if (!TOKEN) {
    console.error("[test-botsdk] BOT_SDK_TOKEN env var must be set");
    process.exit(2);
}

type Frame = Record<string, unknown>;

function send(ws: WebSocket, frame: Frame): void {
    ws.send(encode(frame));
}

function parseFrame(raw: unknown): Frame | null {
    try {
        const text =
            typeof raw === "string"
                ? raw
                : Buffer.isBuffer(raw)
                    ? raw.toString("utf-8")
                    : Buffer.from(raw as ArrayBuffer).toString("utf-8");
        const value = decode(text);
        if (!value || typeof value !== "object") return null;
        return value as Frame;
    } catch {
        return null;
    }
}

interface RunState {
    authOk: boolean;
    spawnOk?: { playerId: number; x: number; z: number };
    walkAcked?: { success: boolean; message?: string };
    perceptionSelf?: { x: number; z: number; tick: number }[];
    errors: string[];
}

interface RunOptions {
    password: string;
    /**
     * When true (default) the agent sends a walkTo after spawn and waits
     * for 3 perception frames before closing. When false it closes as soon
     * as it receives spawnOk or an error — used for phase 2/3 where we
     * only care about the auth/load path, not movement.
     */
    expectWalk?: boolean;
}

async function run(opts: RunOptions): Promise<RunState> {
    const expectWalk = opts.expectWalk !== false;
    const state: RunState = {
        authOk: false,
        perceptionSelf: [],
        errors: [],
    };

    return new Promise((resolvePromise, reject) => {
        const ws = new WebSocket(URL);
        const timer = setTimeout(() => {
            try { ws.close(); } catch {}
            reject(new Error("timed out waiting for test flow"));
        }, 20_000);

        ws.on("open", () => {
            console.log(`[test-botsdk] connected to ${URL}`);
            send(ws, { kind: "auth", token: TOKEN, version: 1 });
        });

        ws.on("message", (raw) => {
            const frame = parseFrame(raw);
            if (!frame) {
                state.errors.push("received unparseable frame");
                return;
            }
            const kind = frame.kind;
            if (kind === "authOk") {
                state.authOk = true;
                console.log(`[test-botsdk] authOk`);
                send(ws, {
                    kind: "spawn",
                    agentId: AGENT_ID,
                    displayName: DISPLAY_NAME,
                    password: opts.password,
                    controller: "hybrid",
                });
                return;
            }
            if (kind === "error") {
                state.errors.push(`${frame.code}: ${frame.message}`);
                console.log(`[test-botsdk] error frame: ${JSON.stringify(frame)}`);
                clearTimeout(timer);
                try { ws.close(); } catch {}
                resolvePromise(state);
                return;
            }
            if (kind === "spawnOk") {
                state.spawnOk = {
                    playerId: Number(frame.playerId),
                    x: Number(frame.x),
                    z: Number(frame.z),
                };
                console.log(
                    `[test-botsdk] spawnOk playerId=${state.spawnOk.playerId} at (${state.spawnOk.x}, ${state.spawnOk.z})`,
                );
                if (!expectWalk) {
                    // Phases 2/3 just care about auth+load; close immediately.
                    clearTimeout(timer);
                    try { ws.close(); } catch {}
                    resolvePromise(state);
                    return;
                }
                // Walk one tile east as a smoke test.
                send(ws, {
                    kind: "action",
                    action: "walkTo",
                    x: state.spawnOk.x + 1,
                    z: state.spawnOk.z,
                    run: false,
                    correlationId: "walk-1",
                });
                return;
            }
            if (kind === "ack") {
                state.walkAcked = {
                    success: frame.success === true,
                    message: frame.message ? String(frame.message) : undefined,
                };
                console.log(
                    `[test-botsdk] ack: success=${state.walkAcked.success} message=${state.walkAcked.message ?? ""}`,
                );
                return;
            }
            if (kind === "perception") {
                const snapshot = frame.snapshot as Record<string, unknown> | undefined;
                const self = snapshot?.self as Record<string, unknown> | undefined;
                const tick = Number(snapshot?.tick ?? 0);
                if (self) {
                    state.perceptionSelf!.push({
                        x: Number(self.x),
                        z: Number(self.z),
                        tick,
                    });
                    console.log(
                        `[test-botsdk] perception tick=${tick} self=(${self.x}, ${self.z})`,
                    );
                }
                // After 3 perception frames we've validated the emit cycle;
                // close the socket and resolve.
                if ((state.perceptionSelf?.length ?? 0) >= 3) {
                    clearTimeout(timer);
                    try { ws.close(); } catch {}
                    resolvePromise(state);
                }
                return;
            }
            console.log(`[test-botsdk] unexpected frame: ${JSON.stringify(frame)}`);
        });

        ws.on("error", (err) => {
            clearTimeout(timer);
            reject(err);
        });

        ws.on("close", () => {
            clearTimeout(timer);
            resolvePromise(state);
        });
    });
}

function assertTrue(label: string, ok: boolean): void {
    if (ok) {
        console.log(`  ✓ ${label}`);
    } else {
        console.log(`  ✗ ${label}`);
        process.exitCode = 1;
    }
}

async function delay(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
    console.log(`[test-botsdk] target=${URL} agentId=${AGENT_ID} name=${DISPLAY_NAME}`);

    // Phase 1 — first session: auth + spawn (first-time registration) + walk.
    console.log("\n[phase 1] first login (should auto-register account)");
    const state1 = await run({ password: PASSWORD });

    console.log("\n--- phase 1 assertions ---");
    assertTrue("[1] authOk received", state1.authOk);
    assertTrue("[1] spawnOk received", state1.spawnOk != null);
    assertTrue("[1] walkTo was acked", state1.walkAcked != null);
    assertTrue("[1] walkTo ack reported success", state1.walkAcked?.success === true);
    assertTrue(
        "[1] at least 3 perception frames received",
        (state1.perceptionSelf?.length ?? 0) >= 3,
    );

    let movedTo: { x: number; z: number } | undefined;
    if (state1.perceptionSelf && state1.spawnOk) {
        const lastPosition = state1.perceptionSelf[state1.perceptionSelf.length - 1];
        const moved =
            lastPosition.x !== state1.spawnOk.x || lastPosition.z !== state1.spawnOk.z;
        assertTrue(
            `[1] agent moved from spawn (spawn=(${state1.spawnOk.x}, ${state1.spawnOk.z}) last=(${lastPosition.x}, ${lastPosition.z}))`,
            moved,
        );
        if (moved) movedTo = { x: lastPosition.x, z: lastPosition.z };
    }

    if (state1.errors.length > 0) {
        console.log("\nerrors:");
        for (const err of state1.errors) console.log(`  - ${err}`);
        process.exitCode = 1;
    }

    // Let the server flush the disconnect save to disk.
    await delay(1200);

    // Phase 2 — reconnect with the SAME credentials; the server should
    // verify the password (no auto-register this time) and restore the
    // last saved position via applyToPlayer.
    console.log("\n[phase 2] reconnect same agent (should restore position)");
    const state2 = await run({ password: PASSWORD, expectWalk: false });

    console.log("\n--- phase 2 assertions ---");
    assertTrue("[2] authOk received", state2.authOk);
    assertTrue("[2] spawnOk received", state2.spawnOk != null);
    assertTrue(
        "[2] re-spawn succeeded without error frames",
        state2.errors.length === 0,
    );
    if (state2.spawnOk && movedTo) {
        assertTrue(
            `[2] restored position matches phase 1 last position (restored=(${state2.spawnOk.x}, ${state2.spawnOk.z}) expected=(${movedTo.x}, ${movedTo.z}))`,
            state2.spawnOk.x === movedTo.x && state2.spawnOk.z === movedTo.z,
        );
    }

    // Let the server flush this session's save before phase 3.
    await delay(1200);

    // Phase 3 — wrong password should be rejected.
    console.log("\n[phase 3] wrong password (should reject)");
    const state3 = await run({ password: "definitely-wrong", expectWalk: false });
    assertTrue("[3] authOk received", state3.authOk);
    assertTrue("[3] spawnOk NOT received", state3.spawnOk == null);
    assertTrue(
        "[3] server sent wrong_password error",
        state3.errors.some((e) => e.startsWith("wrong_password:")),
    );

    if (process.exitCode === 1) {
        console.log(`\n[test-botsdk] FAILED`);
    } else {
        console.log(`\n[test-botsdk] PASSED`);
    }
}

main().catch((err) => {
    console.error("[test-botsdk] unexpected error:", err);
    process.exit(2);
});
