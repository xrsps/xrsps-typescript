/**
 * test-steer — end-to-end cross-repo verification of the `::steer`
 * operator steering path.
 *
 * Flow:
 *   1. Start the xRSPS server (done externally before running this)
 *   2. [agent ws] Connect to the bot-SDK on 43595 as an agent
 *   3. [agent ws] Register an `onOperatorCommand` listener that
 *      records the received frame
 *   4. [human ws] Connect to the binary client protocol on 43594
 *   5. [human ws] Auth + handshake as a normal player
 *   6. [human ws] Send a public chat frame: "::steer mine copper ore"
 *   7. The xRSPS chat handler sees `::steer`, calls
 *      `services.broadcastOperatorCommand`, which pushes an
 *      OperatorCommandFrame to every connected bot-SDK session
 *   8. [agent ws] The listener fires with the directive text
 *
 * This is the full production path — no stubs, no internal hooks.
 *
 * Usage:
 *   BOT_SDK_TOKEN=dev-secret bun scripts/test-steer.ts
 */

import { decode, encode } from "@toon-format/toon";
import WebSocket from "ws";

import { encodeClientMessage } from "../src/network/packet/ClientBinaryEncoder";

const BOT_SDK_URL = process.env.BOT_SDK_URL ?? "ws://127.0.0.1:43595";
const HUMAN_WS_URL = process.env.HUMAN_WS_URL ?? "ws://127.0.0.1:43594";
const TOKEN = process.env.BOT_SDK_TOKEN;

if (!TOKEN) {
    console.error("BOT_SDK_TOKEN must be set");
    process.exit(2);
}

const agentName = `steer-agent-${Date.now() % 100000}`;
const humanName = `steer-human-${Date.now() % 100000}`;
const STEER_TEXT = "mine copper ore in varrock";

function logLine(prefix: string, text: string): void {
    console.log(`[${prefix}] ${text}`);
}

function assertTrue(label: string, ok: boolean): void {
    if (ok) {
        console.log(`  ✓ ${label}`);
    } else {
        console.log(`  ✗ ${label}`);
        process.exitCode = 1;
    }
}

function delay(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

// ─── Agent (bot-SDK, TOON) ────────────────────────────────────────

interface OperatorCommandFrame {
    kind: "operatorCommand";
    source: string;
    text: string;
    timestamp: number;
    fromPlayerId?: number;
    fromPlayerName?: string;
}

function parseToon(raw: unknown): Record<string, unknown> | null {
    try {
        const text = typeof raw === "string" ? raw : Buffer.from(raw as ArrayBuffer).toString("utf-8");
        const decoded = decode(text);
        if (!decoded || typeof decoded !== "object") return null;
        return decoded as Record<string, unknown>;
    } catch {
        return null;
    }
}

async function startAgent(): Promise<{
    ws: WebSocket;
    waitForOperatorCommand: (timeoutMs: number) => Promise<OperatorCommandFrame | null>;
    close: () => void;
}> {
    const ws = new WebSocket(BOT_SDK_URL);
    let pendingResolve: ((frame: OperatorCommandFrame | null) => void) | null = null;
    let pendingTimer: ReturnType<typeof setTimeout> | null = null;

    const waitForOperatorCommand = (timeoutMs: number): Promise<OperatorCommandFrame | null> => {
        return new Promise((resolvePromise) => {
            pendingResolve = resolvePromise;
            pendingTimer = setTimeout(() => {
                pendingResolve = null;
                resolvePromise(null);
            }, timeoutMs);
        });
    };

    await new Promise<void>((resolve, reject) => {
        const onOpen = () => {
            ws.removeListener("error", onError);
            resolve();
        };
        const onError = (err: Error) => {
            ws.removeListener("open", onOpen);
            reject(err);
        };
        ws.once("open", onOpen);
        ws.once("error", onError);
    });

    ws.on("message", (raw) => {
        const frame = parseToon(raw);
        if (!frame) return;
        if (frame.kind === "authOk") {
            logLine("agent", "authOk");
            ws.send(
                encode({
                    kind: "spawn",
                    agentId: `verify-${agentName}`,
                    displayName: agentName,
                    password: "steer-verify-pw",
                    controller: "hybrid",
                }),
            );
            return;
        }
        if (frame.kind === "spawnOk") {
            logLine("agent", `spawnOk at (${frame.x}, ${frame.z})`);
            return;
        }
        if (frame.kind === "operatorCommand") {
            logLine(
                "agent",
                `operatorCommand source=${frame.source} from=${frame.fromPlayerName ?? "?"} text="${frame.text}"`,
            );
            if (pendingResolve) {
                if (pendingTimer) clearTimeout(pendingTimer);
                const resolver = pendingResolve;
                pendingResolve = null;
                resolver(frame as unknown as OperatorCommandFrame);
            }
            return;
        }
    });

    // Begin the auth handshake.
    ws.send(encode({ kind: "auth", token: TOKEN, version: 1 }));

    return {
        ws,
        waitForOperatorCommand,
        close: () => {
            try { ws.close(); } catch {}
        },
    };
}

// ─── Human client (binary) ────────────────────────────────────────

function readRevision(): number {
    const raw = require("node:fs").readFileSync(
        require("node:path").resolve(__dirname, "..", "target.txt"),
        "utf-8",
    );
    const match = raw.match(/osrs-(\d+)/);
    if (!match) throw new Error(`target.txt missing revision: ${raw}`);
    return parseInt(match[1], 10);
}

async function startHumanClient(): Promise<{ ws: WebSocket; sendChat: (text: string) => void }> {
    const revision = readRevision();
    const ws = new WebSocket(HUMAN_WS_URL);

    await new Promise<void>((resolve, reject) => {
        const onOpen = () => {
            ws.removeListener("error", onError);
            resolve();
        };
        const onError = (err: Error) => {
            ws.removeListener("open", onOpen);
            reject(err);
        };
        ws.once("open", onOpen);
        ws.once("error", onError);
    });

    let loggedIn = false;

    ws.on("message", (data) => {
        // Loose scan for login_response success. The binary response
        // format is opaque; we just wait a short while after sending
        // login + handshake.
        const text = Buffer.isBuffer(data) ? data.toString("latin1") : "";
        if (!loggedIn && text.includes("login_response")) {
            loggedIn = true;
        }
    });

    // Login frame.
    ws.send(
        encodeClientMessage({
            type: "login",
            payload: {
                username: humanName,
                password: "steer-human-password",
                revision,
            },
        }),
    );
    // Give the server a moment to process login + prepare for handshake.
    await delay(250);
    // Handshake frame so the server creates the PlayerState.
    ws.send(
        encodeClientMessage({
            type: "handshake",
            payload: {
                name: humanName,
                clientType: "desktop",
            },
        }),
    );
    // Wait for the player to be fully in-world.
    await delay(1500);

    return {
        ws,
        sendChat: (chatText: string) => {
            ws.send(
                encodeClientMessage({
                    type: "chat",
                    payload: {
                        messageType: "public",
                        text: chatText,
                    },
                }),
            );
        },
    };
}

// ─── Main ─────────────────────────────────────────────────────────

async function main(): Promise<void> {
    console.log(`[test-steer] agent=${agentName} human=${humanName}`);

    // 1. Start the agent first so the operatorCommand listener is
    //    already wired when the human sends ::steer.
    console.log("\n[1] starting agent session on bot-SDK");
    const agent = await startAgent();
    await delay(2000); // let it auth + spawn + receive first perception
    assertTrue("agent connected", agent.ws.readyState === WebSocket.OPEN);

    // 2. Connect a human client over the binary protocol.
    console.log("\n[2] connecting human client on binary ws");
    const human = await startHumanClient();
    assertTrue("human connected", human.ws.readyState === WebSocket.OPEN);

    // 3. Human types ::steer <text>
    console.log(`\n[3] human sends ::steer ${STEER_TEXT}`);
    const waiter = agent.waitForOperatorCommand(8000);
    human.sendChat(`::steer ${STEER_TEXT}`);
    const received = await waiter;

    assertTrue("agent received an operatorCommand frame", received != null);
    if (received) {
        assertTrue(
            `frame.source === "chat" (got "${received.source}")`,
            received.source === "chat",
        );
        assertTrue(
            `frame.text matches directive (got "${received.text}")`,
            received.text === STEER_TEXT,
        );
        // xRSPS truncates display names to 12 chars; accept the
        // truncated version.
        const expectedTruncated = humanName.slice(0, 12);
        assertTrue(
            `fromPlayerName is the (truncated) human sender (got "${received.fromPlayerName}", expected "${expectedTruncated}")`,
            received.fromPlayerName === expectedTruncated,
        );
    }

    // Cleanup
    agent.close();
    try { human.ws.close(); } catch {}
    await delay(500);

    if (process.exitCode === 1) {
        console.log("\n[test-steer] FAILED");
    } else {
        console.log("\n[test-steer] PASSED");
    }
}

main().catch((err) => {
    console.error("[test-steer] fatal:", err);
    process.exit(2);
});
