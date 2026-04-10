/**
 * BotSdkServer — the WebSocket endpoint agents connect to.
 *
 * Runs on its own port (default 43595) so it's physically separate from the
 * binary human-client protocol on 43594. Clients connect, authenticate with
 * `BOT_SDK_TOKEN`, send a `spawn` frame to create an agent-player, then
 * stream action frames for the rest of the session. The server pushes
 * perception snapshots back on a timer driven by {@link BotSdkPerceptionEmitter}.
 *
 * **Scope boundary**: the server is pure networking + frame routing. It does
 * NOT contain any game logic. All decisions about "what happens when an
 * agent walks" are delegated to the existing services via
 * {@link BotSdkActionRouter}.
 *
 * **Disabled by default**: if `BOT_SDK_TOKEN` is unset, the server refuses
 * to start. This means casual deployments that don't need agents don't
 * inadvertently expose an additional unauthenticated endpoint.
 */

import { WebSocket, WebSocketServer } from "ws";

import type { PlayerState } from "../../game/player";
import type { PersistenceProvider } from "../../game/state/PersistenceProvider";
import { logger } from "../../utils/logger";

import { AgentPlayerFactory } from "./AgentPlayerFactory";
import {
    BotSdkActionRouter,
    type ActionDispatchResult,
} from "./BotSdkActionRouter";
import {
    decodeClientFrame,
    encodeServerFrame,
} from "./BotSdkCodec";
import type {
    AnyActionFrame,
    ClientFrame,
    ServerFrame,
    SpawnFrame,
} from "./BotSdkProtocol";
import { BotSdkPerceptionEmitter } from "./BotSdkPerceptionEmitter";

export interface BotSdkServerOptions {
    host: string;
    port: number;
    /** Shared secret. If empty/undefined the server refuses to start. */
    token: string;
    /** Display name shown in the `authOk` frame. Defaults to "xrsps". */
    serverName?: string;
    /** Perception emission cadence; default 3 game ticks. */
    perceptionEveryNTicks?: number;
}

export interface BotSdkServerDeps {
    factory: AgentPlayerFactory;
    router: BotSdkActionRouter;
    /** Called on every game tick so the emitter can run. */
    hookTicker: (cb: (tick: number) => void) => void;
    /**
     * Same persistence layer humans use. The server calls `saveSnapshot`
     * on disconnect so agents retain their game state across sessions.
     */
    playerPersistence: PersistenceProvider;
}

interface AgentSession {
    ws: WebSocket;
    player: PlayerState;
    authedAt: number;
    saveKey: string;
}

const PROTOCOL_VERSION = 1;

export class BotSdkServer {
    private wss: WebSocketServer | null = null;
    private readonly sessions = new Map<WebSocket, AgentSession>();
    private emitter: BotSdkPerceptionEmitter | null = null;

    constructor(
        private readonly options: BotSdkServerOptions,
        private readonly deps: BotSdkServerDeps,
    ) {}

    /**
     * Bring the endpoint up. Must be called after the rest of the server
     * is wired, because the action router needs a live `PlayerManager`.
     * No-op (with a warning) if `BOT_SDK_TOKEN` is empty.
     */
    start(): void {
        if (!this.options.token || this.options.token.length === 0) {
            logger.info(
                "[botsdk] disabled — BOT_SDK_TOKEN not set. Agents cannot connect.",
            );
            return;
        }

        this.wss = new WebSocketServer({
            host: this.options.host,
            port: this.options.port,
        });
        this.wss.on("listening", () => {
            logger.info(
                `[botsdk] listening on ws://${this.options.host}:${this.options.port} (token=set)`,
            );
        });
        this.wss.on("error", (err) => {
            logger.error("[botsdk] server error:", err);
        });
        this.wss.on("connection", (ws) => this.handleConnection(ws));

        this.emitter = new BotSdkPerceptionEmitter(
            () => this.iterAgentPlayers(),
            (player, snapshot) => {
                const session = this.findSessionByPlayer(player);
                if (!session) return;
                this.sendFrame(session.ws, {
                    kind: "perception",
                    snapshot,
                });
            },
            { everyNTicks: this.options.perceptionEveryNTicks },
        );
        this.deps.hookTicker((tick) => this.emitter?.onTick(tick));
    }

    stop(): void {
        for (const session of this.sessions.values()) {
            try {
                session.ws.close(1001, "server_shutdown");
            } catch {
                // swallow — the socket may already be dead
            }
        }
        this.sessions.clear();
        this.wss?.close();
        this.wss = null;
    }

    /**
     * Fan out an operator-steering command to every connected agent.
     *
     * Called from the chat handler when a human player sends
     * `::steer <text>`. The command becomes a server → client
     * `operatorCommand` frame that the plugin's BotSdk handles by
     * injecting the text into the next LLM prompt as the agent's
     * highest-priority directive.
     *
     * No-op if no agents are connected or if the endpoint is disabled.
     */
    broadcastOperatorCommand(
        source: "chat" | "admin",
        text: string,
        fromPlayerId?: number,
        fromPlayerName?: string,
    ): number {
        if (!this.wss) return 0;
        const trimmed = text.trim();
        const frame = {
            kind: "operatorCommand" as const,
            source,
            text: trimmed,
            timestamp: Date.now(),
            fromPlayerId,
            fromPlayerName,
        };
        let count = 0;
        for (const session of this.sessions.values()) {
            this.sendFrame(session.ws, frame);
            count += 1;
        }
        if (count > 0) {
            logger.info(
                `[botsdk] broadcast operator command → ${count} agent(s) source=${source} text="${trimmed.slice(0, 60)}"`,
            );
        }
        return count;
    }

    // ──────────────────────────────────────────────────────────────────
    // Connection handling
    // ──────────────────────────────────────────────────────────────────

    private handleConnection(ws: WebSocket): void {
        const sessionState: { authed: boolean; session?: AgentSession } = {
            authed: false,
        };

        ws.on("message", (data) => {
            const text =
                typeof data === "string"
                    ? data
                    : Buffer.isBuffer(data)
                        ? data.toString("utf-8")
                        : Buffer.from(data as ArrayBuffer).toString("utf-8");
            this.handleMessage(ws, sessionState, text);
        });

        ws.on("close", () => {
            const existing = this.sessions.get(ws);
            if (existing) {
                // 1. Persist the agent's game state so the next spawn resumes
                //    skills, inventory, position, etc. — same save path humans
                //    use during logout.
                try {
                    this.deps.playerPersistence.saveSnapshot(
                        existing.saveKey,
                        existing.player,
                    );
                    logger.info(
                        `[botsdk] saved state for agent ${existing.player.agent?.identity.agentId} (key=${existing.saveKey})`,
                    );
                } catch (err) {
                    logger.warn(
                        `[botsdk] failed to save state for agent ${existing.player.agent?.identity.agentId}`,
                        err,
                    );
                }

                // 2. Mark the component disconnected (perception emitter
                //    stops sending to this agent immediately).
                this.deps.factory.markDisconnected(existing.player);

                // 3. Remove the PlayerState from the world entirely so the
                //    agent's display name is freed for subsequent logins.
                //    The save file is the source of truth from here on.
                try {
                    this.deps.factory.destroy(existing.player);
                } catch (err) {
                    logger.warn(
                        `[botsdk] failed to destroy agent player ${existing.player.id}`,
                        err,
                    );
                }

                this.sessions.delete(ws);
                logger.info(
                    `[botsdk] session closed for player ${existing.player.id} (agent=${existing.player.agent?.identity.agentId})`,
                );
            }
        });

        ws.on("error", (err) => {
            logger.warn("[botsdk] socket error:", err);
        });
    }

    private handleMessage(
        ws: WebSocket,
        state: { authed: boolean; session?: AgentSession },
        raw: string,
    ): void {
        const decoded = decodeClientFrame(raw);
        if (!decoded.ok) {
            this.sendError(ws, "bad_frame", decoded.error);
            return;
        }
        const frame: ClientFrame = decoded.value;

        // Auth must come first.
        if (!state.authed) {
            if (frame.kind !== "auth") {
                this.sendError(ws, "unauth", "first frame must be `auth`");
                ws.close(1008, "unauth");
                return;
            }
            if (frame.token !== this.options.token) {
                this.sendError(ws, "bad_token", "BOT_SDK_TOKEN mismatch");
                ws.close(1008, "bad_token");
                return;
            }
            state.authed = true;
            this.sendFrame(ws, {
                kind: "authOk",
                server: this.options.serverName ?? "xrsps",
                version: PROTOCOL_VERSION,
            });
            return;
        }

        // Post-auth flow.
        switch (frame.kind) {
            case "auth":
                // Re-auth attempt — ignore silently.
                return;
            case "spawn":
                this.handleSpawn(ws, state, frame);
                return;
            case "action":
                this.handleAction(ws, state, frame);
                return;
            case "disconnect":
                logger.info(
                    `[botsdk] client requested disconnect: ${frame.reason ?? "(no reason)"}`,
                );
                ws.close(1000, frame.reason ?? "client_disconnect");
                return;
        }
    }

    private handleSpawn(
        ws: WebSocket,
        state: { authed: boolean; session?: AgentSession },
        frame: SpawnFrame,
    ): void {
        if (state.session) {
            this.sendError(
                ws,
                "already_spawned",
                `agent ${state.session.player.agent?.identity.agentId} already owns this socket`,
            );
            return;
        }

        const result = this.deps.factory.spawn({
            agentId: frame.agentId,
            displayName: frame.displayName,
            password: frame.password,
            controller: frame.controller ?? "hybrid",
            persona: frame.persona,
        });
        if (!result.ok) {
            this.sendError(ws, result.code, result.message);
            return;
        }

        const session: AgentSession = {
            ws,
            player: result.player,
            authedAt: Date.now(),
            saveKey: result.saveKey,
        };
        state.session = session;
        this.sessions.set(ws, session);

        if (result.created) {
            logger.info(
                `[botsdk] new agent account registered: ${result.player.name}`,
            );
        }

        this.sendFrame(ws, {
            kind: "spawnOk",
            playerId: result.player.id,
            x: result.player.tileX,
            z: result.player.tileY,
            level: result.player.level,
        });
    }

    private handleAction(
        ws: WebSocket,
        state: { authed: boolean; session?: AgentSession },
        frame: AnyActionFrame,
    ): void {
        if (!state.session) {
            this.sendError(
                ws,
                "not_spawned",
                "must send `spawn` frame before `action`",
            );
            return;
        }

        const dispatch: ActionDispatchResult = this.deps.router.dispatch(
            state.session.player.id,
            frame,
        );

        if (frame.correlationId) {
            this.sendFrame(ws, {
                kind: "ack",
                correlationId: frame.correlationId,
                success: dispatch.success,
                message: dispatch.message,
            });
        }
    }

    // ──────────────────────────────────────────────────────────────────
    // Helpers
    // ──────────────────────────────────────────────────────────────────

    private sendFrame(ws: WebSocket, frame: ServerFrame): void {
        if (ws.readyState !== WebSocket.OPEN) return;
        try {
            ws.send(encodeServerFrame(frame));
        } catch (err) {
            logger.warn("[botsdk] failed to send frame:", err);
        }
    }

    private sendError(ws: WebSocket, code: string, message: string): void {
        this.sendFrame(ws, { kind: "error", code, message });
    }

    private *iterAgentPlayers(): Iterable<PlayerState> {
        for (const session of this.sessions.values()) {
            if (session.player.agent?.connected) {
                yield session.player;
            }
        }
    }

    private findSessionByPlayer(player: PlayerState): AgentSession | undefined {
        for (const session of this.sessions.values()) {
            if (session.player.id === player.id) return session;
        }
        return undefined;
    }
}
