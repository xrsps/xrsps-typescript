/**
 * Persistent dev-mode agent — connects to the xRSPS bot-SDK endpoint and
 * runs a simple random-walk loop so you can watch the agent layer working
 * end-to-end in the unified mprocs TUI.
 *
 * This is **not** the eventual agent brain — the real agent lives in
 * `@elizaos/app-scape` in the milady repo and uses the LLM runtime. This
 * script is a placeholder that:
 *
 *   1. Exercises the TOON bot-SDK protocol continuously (spot any
 *      regressions immediately).
 *   2. Gives the game client something visible to interact with during
 *      dev — other players logged in via the React client can see this
 *      agent walking around, attack it, etc.
 *   3. Logs perception snapshots so you can watch the server's agent
 *      perception layer in real time.
 *
 * Identity is self-generated on first run: if neither SCAPE_DEV_AGENT_NAME
 * nor SCAPE_DEV_AGENT_PASS is set, the script creates a random name /
 * password pair, persists them to `server/data/dev-agent-identity.json`,
 * and re-uses them on every subsequent run. The developer never has to
 * think about credentials.
 *
 * Lifecycle:
 *   - Waits briefly for the bot-SDK endpoint to come up (retries on
 *     ECONNREFUSED for up to 30 seconds).
 *   - Authenticates, spawns the agent with the persisted identity.
 *   - Every 6 seconds, picks a random adjacent tile and sends a walkTo.
 *   - On SIGINT / SIGTERM (Ctrl-C, or mprocs stopping the proc), cleanly
 *     sends a `disconnect` frame and exits — which triggers the server's
 *     disconnect-save path so the agent's position persists.
 *
 * Env vars:
 *   BOT_SDK_URL           — default ws://127.0.0.1:43595
 *   BOT_SDK_TOKEN         — required (must match the server)
 *   SCAPE_DEV_AGENT_NAME  — optional override of the generated name
 *   SCAPE_DEV_AGENT_PASS  — optional override of the generated password
 *   SCAPE_DEV_STEP_MS     — default 6000 (one walk every 6 seconds)
 */

import { spawn } from "node:child_process";
import { platform } from "node:os";
import { inspect } from "node:util";

import { decode, encode } from "@toon-format/toon";
import WebSocket from "ws";

import { loadOrGenerateDevAgentIdentity } from "./_dev-agent-identity";

const URL = process.env.BOT_SDK_URL ?? "ws://127.0.0.1:43595";
const TOKEN = process.env.BOT_SDK_TOKEN;
const STEP_INTERVAL_MS = parseInt(process.env.SCAPE_DEV_STEP_MS ?? "6000", 10);

const RETRY_INTERVAL_MS = 2_000;
const CONNECT_MAX_ATTEMPTS = 15;

if (!TOKEN) {
    console.error("[agent-dev] BOT_SDK_TOKEN env var must be set");
    process.exit(2);
}

const identity = loadOrGenerateDevAgentIdentity();
const AGENT_NAME = identity.name;
const AGENT_PASSWORD = identity.password;
const AGENT_ID = `scape-dev-${AGENT_NAME}`;

const CLIENT_URL = process.env.SCAPE_CLIENT_URL ?? "http://localhost:3000";
const SKIP_BROWSER = process.env.OPEN_AGENT_BROWSER === "0";

// Guard against reconnect loops spawning multiple browser tabs. The
// bot opens the browser exactly once per process lifetime, even if
// the bot-SDK session drops and reconnects.
let browserViewSpawned = false;

/**
 * Spawn the system default browser pointed at the xRSPS client so
 * the user can watch the bot play. Uses `open` on macOS, `start` on
 * Windows, `xdg-open` on Linux. Fire-and-forget — we detach the
 * child so the browser outlives this script.
 */
function openBrowserView(): void {
    if (browserViewSpawned || SKIP_BROWSER) return;
    browserViewSpawned = true;
    const os = platform();
    const cmd = os === "darwin" ? "open" : os === "win32" ? "cmd" : "xdg-open";
    const args = os === "win32" ? ["/c", "start", "", CLIENT_URL] : [CLIENT_URL];
    try {
        const child = spawn(cmd, args, { stdio: "ignore", detached: true });
        child.unref();
        console.log(`[agent-dev] opened browser view at ${CLIENT_URL}`);
    } catch (err) {
        console.warn(
            `[agent-dev] failed to open browser at ${CLIENT_URL}:`,
            err,
        );
    }
}

type Frame = Record<string, unknown>;

function logLine(message: string): void {
    // mprocs renders each proc's stdout verbatim; a short prefix makes it
    // easy to tell the dev-agent tab apart from the server's own logs.
    console.log(`[agent-dev] ${message}`);
}

function sendFrame(ws: WebSocket, frame: Frame): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    try {
        ws.send(encode(frame));
    } catch (err) {
        logLine(`send error: ${err instanceof Error ? err.message : String(err)}`);
    }
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

async function delay(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

/**
 * Unwrap the various shapes Bun's `ws` adapter uses for connection
 * failures. On a plain Node install, connect errors arrive as an
 * `Error` with a sensible `.message` (e.g. `ECONNREFUSED`). Under
 * Bun the adapter wraps the underlying socket error in a DOM-style
 * `ErrorEvent` whose `.message` is empty; the real message lives on
 * `.error.message` or `.error.code`. This function returns the
 * deepest useful string without JSON.stringify'ing the whole event.
 */
function describeError(err: unknown): string {
    if (err == null) return "unknown";
    if (err instanceof Error) {
        return err.message || err.name || "Error";
    }
    if (typeof err === "object") {
        const record = err as {
            message?: unknown;
            error?: { message?: unknown; code?: unknown };
            code?: unknown;
            type?: unknown;
        };
        if (typeof record.error?.message === "string" && record.error.message.length > 0) {
            return record.error.message;
        }
        if (typeof record.error?.code === "string" && record.error.code.length > 0) {
            return record.error.code;
        }
        if (typeof record.message === "string" && record.message.length > 0) {
            return record.message;
        }
        if (typeof record.code === "string") return record.code;
        if (typeof record.type === "string") {
            // ErrorEvent with nothing else populated — usually means
            // ECONNREFUSED / connection reset. Use util.inspect to
            // reveal whatever hidden properties exist so the message
            // is at least grep-able.
            const inspected = inspect(err, { depth: 2, breakLength: 120 });
            return `${record.type}: ${inspected.slice(0, 200)}`;
        }
    }
    return inspect(err, { depth: 2 }).slice(0, 200);
}

interface SessionState {
    spawned: boolean;
    playerId?: number;
    lastKnown?: { x: number; z: number };
    stepTimer?: ReturnType<typeof setInterval>;
    shuttingDown: boolean;
}

async function connectWithRetry(): Promise<WebSocket> {
    for (let attempt = 1; attempt <= CONNECT_MAX_ATTEMPTS; attempt++) {
        // Create the socket and IMMEDIATELY attach a persistent error
        // listener. Without this, Bun's `ws` adapter can emit a second
        // error event (or a late error during socket teardown) after
        // our once-off handler has removed itself, which would crash
        // the process via Node's "unhandled error" path.
        //
        // The persistent listener below is a no-op — the connect-phase
        // promise below has its own once-off error handler that does
        // the real rejection. After the promise settles, the persistent
        // handler is all that remains, which is correct: a broken
        // socket should log silently, not crash the script.
        const ws = new WebSocket(URL);
        const swallowError = (_err: unknown) => {
            // intentional no-op
        };
        ws.on("error", swallowError);

        try {
            await new Promise<void>((resolvePromise, reject) => {
                let settled = false;
                const cleanup = () => {
                    ws.removeListener("open", onOpen);
                    ws.removeListener("error", onError);
                };
                const onOpen = () => {
                    if (settled) return;
                    settled = true;
                    cleanup();
                    resolvePromise();
                };
                const onError = (err: unknown) => {
                    if (settled) return;
                    settled = true;
                    cleanup();
                    // Preserve the raw object so describeError can
                    // introspect ErrorEvent shapes. Wrapping with
                    // `new Error(String(err))` would coerce it to
                    // `[object ErrorEvent]` and lose the real cause.
                    reject(err as Error);
                };
                ws.once("open", onOpen);
                ws.once("error", onError);
            });
            // Successful connect — leave the swallow handler in place.
            // It'll still swallow post-connect errors silently, so the
            // process won't crash on a server restart; the `close`
            // handler below notices the drop and exits cleanly.
            return ws;
        } catch (err) {
            // Tear down the failed socket completely so it can't fire
            // any more events. The swallow handler would have kept it
            // alive anyway, but explicit close is cheaper.
            try { ws.close(); } catch {}
            try { ws.removeAllListeners(); } catch {}
            const detail = describeError(err);
            logLine(
                `connect attempt ${attempt}/${CONNECT_MAX_ATTEMPTS} failed (${detail}), retrying in ${RETRY_INTERVAL_MS / 1000}s`,
            );
            await delay(RETRY_INTERVAL_MS);
        }
    }
    throw new Error(`could not reach ${URL} after ${CONNECT_MAX_ATTEMPTS} attempts`);
}

function pickRandomAdjacent(x: number, z: number): { x: number; z: number } {
    // 8-neighbor random walk with a small chance to stay put (thinking).
    const choices: Array<[number, number]> = [
        [-1, 0], [1, 0], [0, -1], [0, 1],
        [-1, -1], [1, 1], [-1, 1], [1, -1],
    ];
    const [dx, dz] = choices[Math.floor(Math.random() * choices.length)]!;
    return { x: x + dx, z: z + dz };
}

async function run(): Promise<void> {
    logLine(`target=${URL} name=${AGENT_NAME}`);
    const ws = await connectWithRetry();
    logLine(`connected`);

    const state: SessionState = {
        spawned: false,
        shuttingDown: false,
    };

    const shutdown = (reason: string) => {
        if (state.shuttingDown) return;
        state.shuttingDown = true;
        if (state.stepTimer) {
            clearInterval(state.stepTimer);
            state.stepTimer = undefined;
        }
        logLine(`shutting down: ${reason}`);
        try {
            sendFrame(ws, { kind: "disconnect", reason });
        } catch {}
        // Small delay so the disconnect frame hits the wire before we close.
        setTimeout(() => {
            try { ws.close(1000, reason); } catch {}
            process.exit(0);
        }, 100);
    };

    process.on("SIGINT", () => shutdown("sigint"));
    process.on("SIGTERM", () => shutdown("sigterm"));

    ws.on("close", () => {
        if (!state.shuttingDown) {
            logLine("socket closed unexpectedly — exiting");
            process.exit(1);
        }
    });

    ws.on("error", (err) => {
        logLine(`socket error: ${err.message}`);
    });

    ws.on("message", (raw) => {
        const frame = parseFrame(raw);
        if (!frame) return;
        const kind = frame.kind;

        if (kind === "authOk") {
            logLine(`authOk server=${frame.server} version=${frame.version}`);
            sendFrame(ws, {
                kind: "spawn",
                agentId: AGENT_ID,
                displayName: AGENT_NAME,
                password: AGENT_PASSWORD,
                controller: "hybrid",
                persona: "Placeholder dev agent — random-walks until milady takes over.",
            });
            return;
        }

        if (kind === "error") {
            logLine(`error frame: ${frame.code}: ${frame.message}`);
            // Don't try to keep going through an error state — most
            // errors (bad_token, name_taken, wrong_password) are fatal.
            shutdown(`server_error:${frame.code}`);
            return;
        }

        if (kind === "spawnOk") {
            state.spawned = true;
            state.playerId = Number(frame.playerId);
            state.lastKnown = { x: Number(frame.x), z: Number(frame.z) };
            logLine(
                `spawnOk playerId=${state.playerId} at (${state.lastKnown.x}, ${state.lastKnown.z})`,
            );

            // Open the browser so the user can watch. Fire-and-forget.
            openBrowserView();

            // Start the random-walk loop.
            state.stepTimer = setInterval(() => {
                if (!state.lastKnown) return;
                const next = pickRandomAdjacent(state.lastKnown.x, state.lastKnown.z);
                sendFrame(ws, {
                    kind: "action",
                    action: "walkTo",
                    x: next.x,
                    z: next.z,
                    run: false,
                });
                logLine(`step → (${next.x}, ${next.z})`);
            }, STEP_INTERVAL_MS);
            return;
        }

        if (kind === "perception") {
            const snapshot = frame.snapshot as Record<string, unknown> | undefined;
            const self = snapshot?.self as Record<string, unknown> | undefined;
            if (self) {
                state.lastKnown = { x: Number(self.x), z: Number(self.z) };
                const hp = self.hp;
                const maxHp = self.maxHp;
                const energy = self.runEnergy;
                logLine(
                    `perception tick=${snapshot?.tick} pos=(${self.x}, ${self.z}) hp=${hp}/${maxHp} energy=${energy}`,
                );
            }
            return;
        }

        // Silently ignore acks and anything else — we only care about
        // perception + status for the dev loop.
    });

    sendFrame(ws, { kind: "auth", token: TOKEN, version: 1 });
}

run().catch((err) => {
    console.error(`[agent-dev] fatal:`, err);
    process.exit(1);
});
