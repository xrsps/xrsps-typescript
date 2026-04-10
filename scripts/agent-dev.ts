/**
 * Dev-mode agent launcher.
 *
 * The "agent" for dev is not a separate bot process — it's a loop
 * *inside the React client* that drives the user's own character
 * around (see `OsrsClient.startAutoplay`). This script exists so
 * `bun run dev` has ONE terminal that:
 *
 *   1. Generates (or reuses) a stable agent identity so the character
 *      accumulates across sessions.
 *   2. Waits for the CRA dev server to come up on :3000.
 *   3. Spawns the system default browser pointed at
 *        http://localhost:3000/?username=<agent>&password=<pw>&autoplay=1
 *      which triggers the client's auto-login + in-browser autoplay.
 *   4. Stays alive so mprocs keeps the tab running; logs are a quiet
 *      "heartbeat" you can glance at to confirm the flow is healthy.
 *
 * The agent and the user share the same browser tab. Click to take
 * over; the next autoplay tick will overwrite your destination, so
 * you can "tag out" any time by not clicking.
 *
 * Env vars:
 *   SCAPE_CLIENT_URL      — base client URL (default http://localhost:3000)
 *   SCAPE_DEV_AGENT_NAME  — override generated name
 *   SCAPE_DEV_AGENT_PASS  — override generated password
 *   OPEN_AGENT_BROWSER=0  — skip the browser spawn (useful for headless CI)
 *   SCAPE_AUTOPLAY=0      — log in but don't start the autoplay loop
 */

import { spawn } from "node:child_process";
import { platform } from "node:os";

import { loadOrGenerateDevAgentIdentity } from "./_dev-agent-identity";

const CLIENT_URL = process.env.SCAPE_CLIENT_URL ?? "http://localhost:3000";
const SKIP_BROWSER = process.env.OPEN_AGENT_BROWSER === "0";
const AUTOPLAY = process.env.SCAPE_AUTOPLAY !== "0";

const WAIT_FOR_CLIENT_MAX_ATTEMPTS = 60;
const WAIT_FOR_CLIENT_INTERVAL_MS = 1_000;

const identity = loadOrGenerateDevAgentIdentity();

function logLine(message: string): void {
    console.log(`[agent-dev] ${message}`);
}

function buildLoginUrl(): string {
    const url = new URL(CLIENT_URL);
    url.searchParams.set("username", identity.name);
    url.searchParams.set("password", identity.password);
    if (AUTOPLAY) url.searchParams.set("autoplay", "1");
    return url.toString();
}

/**
 * Poll the CRA dev server until it answers 200. craco's first boot
 * can take 10-30s; we back off and retry rather than spawning a
 * browser at a half-booted server and staring at a white page.
 */
async function waitForClient(url: string): Promise<boolean> {
    for (let attempt = 1; attempt <= WAIT_FOR_CLIENT_MAX_ATTEMPTS; attempt++) {
        try {
            const res = await fetch(url, { method: "GET" });
            if (res.ok || res.status === 304) return true;
        } catch {
            // connection refused — dev server not up yet
        }
        if (attempt === 1 || attempt % 5 === 0) {
            logLine(
                `waiting for client at ${url} (attempt ${attempt}/${WAIT_FOR_CLIENT_MAX_ATTEMPTS})`,
            );
        }
        await new Promise((r) => setTimeout(r, WAIT_FOR_CLIENT_INTERVAL_MS));
    }
    return false;
}

/**
 * Spawn the system default browser pointed at the auto-login URL.
 * `open` on macOS, `start` on Windows, `xdg-open` on Linux. The
 * child is detached so the browser outlives this script.
 */
function openBrowser(url: string): void {
    if (SKIP_BROWSER) {
        logLine(`OPEN_AGENT_BROWSER=0 — not spawning browser`);
        return;
    }
    const os = platform();
    const cmd = os === "darwin" ? "open" : os === "win32" ? "cmd" : "xdg-open";
    const args = os === "win32" ? ["/c", "start", "", url] : [url];
    try {
        const child = spawn(cmd, args, { stdio: "ignore", detached: true });
        child.unref();
        logLine(`opened browser → ${url}`);
    } catch (err) {
        logLine(
            `failed to open browser: ${err instanceof Error ? err.message : String(err)}`,
        );
    }
}

async function main(): Promise<void> {
    logLine(`identity name=${identity.name} (password redacted)`);
    logLine(`autoplay=${AUTOPLAY ? "on" : "off"}`);

    const ready = await waitForClient(CLIENT_URL);
    if (!ready) {
        logLine(
            `client at ${CLIENT_URL} never came up — giving up. Is the 'client' proc running?`,
        );
        process.exit(1);
    }
    logLine(`client is up`);

    const loginUrl = buildLoginUrl();
    openBrowser(loginUrl);

    // Keep the proc alive so mprocs leaves the tab open. A
    // heartbeat every 60s makes it obvious at a glance that the
    // launcher is still healthy. We don't do anything else — the
    // real agent work happens inside the browser.
    logLine(`launcher idle (heartbeat every 60s). Ctrl-C to stop.`);
    const heartbeat = setInterval(() => {
        logLine(`heartbeat: agent=${identity.name} browser URL issued`);
    }, 60_000);

    const shutdown = (signal: string) => {
        logLine(`received ${signal}, exiting`);
        clearInterval(heartbeat);
        process.exit(0);
    };
    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
    console.error(`[agent-dev] fatal:`, err);
    process.exit(1);
});
