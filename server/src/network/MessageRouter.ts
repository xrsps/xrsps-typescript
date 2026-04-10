/**
 * =============================================================================
 * MESSAGE ROUTER - Extraction from wsServer.onConnection()
 * =============================================================================
 *
 * Canonical non-auth gameplay handlers are registered from:
 * - server/src/network/MessageHandlers.ts
 * - wsServer.setupMessageRouter() for local/simple handlers.
 *
 * Keep this file focused on routing primitives only.
 * Avoid embedding handler migration status here because it goes stale quickly.
 *
 * =============================================================================
 */
import type { WebSocket } from "ws";

import type { PlayerState } from "../game/player";
import { logger } from "../utils/logger";
import type { ClientToServer, ServerToClient } from "./messages";

/**
 * Extra routed messages still handled outside the binary client message union.
 */
type ExtraRoutedMessage =
    | { type: "login"; payload: { username?: string; password?: string; revision?: number } }
    | { type: "smithing_make"; payload: { recipeId?: string; mode?: string } }
    | { type: "smithing_mode"; payload: { mode?: number; custom?: number } }
    | { type: "bank_deposit_item"; payload: unknown }
    | {
          type: "debug";
          payload:
              | { kind: "set_var"; value?: number; varbit?: number; varp?: number }
              | { kind: "raw"; raw: string };
      };

export type RoutedMessage = ClientToServer | ExtraRoutedMessage;
export type RoutedMessageType = RoutedMessage["type"];
export type MessagePayload<T extends RoutedMessageType> = Extract<
    RoutedMessage,
    { type: T }
>["payload"];

/**
 * Context passed to each message handler.
 */
export interface MessageContext<T extends RoutedMessageType = RoutedMessageType> {
    ws: WebSocket;
    player: PlayerState | undefined;
    type: T;
    payload: MessagePayload<T>;
}

/**
 * Message handler function signature.
 */
export type MessageHandler<T extends RoutedMessageType = RoutedMessageType> = (
    ctx: MessageContext<T>,
) => void | Promise<void>;

/**
 * Services interface for MessageRouter dependencies.
 * These are callbacks to wsServer methods that handlers need.
 */
export interface MessageRouterServices {
    // Player access
    getPlayer: (ws: WebSocket) => PlayerState | undefined;

    // Logging/messaging
    sendWithGuard: (ws: WebSocket, message: string | Uint8Array, context: string) => void;
    sendAdminResponse: (ws: WebSocket, message: string | Uint8Array, context: string) => void;
    withDirectSendBypass: (context: string, fn: () => void) => void;
    queueChatMessage: (message: {
        messageType: "public" | "game" | "server";
        text: string;
        playerId?: number;
        from?: string;
        prefix?: string;
        playerType?: number;
        colorId?: number;
        effectId?: number;
        pattern?: number[];
        autoChat?: boolean;
        targetPlayerIds?: number[];
    }) => void;
    /**
     * Fan a steering directive out to all connected 'scape agents
     * via the bot-SDK. Returns the number of agents reached, or 0
     * if no-one was listening. Called by the `::steer` chat handler.
     */
    broadcastOperatorCommand?: (
        source: "chat" | "admin",
        text: string,
        fromPlayerId?: number,
        fromPlayerName?: string,
    ) => number;

    // Interface management
    closeInterruptibleInterfaces: (player: PlayerState) => void;

    // Message encoding
    encodeMessage: (msg: ServerToClient) => Uint8Array;
}

/**
 * Set of message types that should close interruptible interfaces before processing.
 */
const INTERFACE_CLOSING_ACTIONS = new Set([
    "walk",
    "teleport",
    "interact",
    "player_attack",
    "npc_attack",
    "npc_interact",
    "loc_interact",
    "ground_item_action",
    "inventory_use",
    "inventory_use_on",
    "spell_cast_npc",
    "spell_cast_player",
    "spell_cast_loc",
    "spell_cast_obj",
    "spell_cast_item",
]);

/**
 * Routes incoming WebSocket messages to appropriate handlers.
 * Extracted from wsServer.onConnection() to improve maintainability.
 */
export type FallbackDispatcher = (
    type: string,
    ws: WebSocket,
    player: PlayerState | undefined,
    payload: unknown,
) => boolean;

export class MessageRouter {
    private handlers = new Map<RoutedMessageType, MessageHandler<RoutedMessageType>>();
    private services: MessageRouterServices;
    private fallbackDispatcher: FallbackDispatcher | undefined;

    constructor(services: MessageRouterServices) {
        this.services = services;
    }

    /**
     * Set a fallback dispatcher for message types with no registered handler.
     * Used to route messages to gamemode-registered handlers (via ScriptRegistry).
     */
    setFallbackDispatcher(fn: FallbackDispatcher): void {
        this.fallbackDispatcher = fn;
    }

    /**
     * Register a handler for a specific message type.
     */
    register<T extends RoutedMessageType>(type: T, handler: MessageHandler<T>): void {
        if (this.handlers.has(type)) {
            logger.warn(`[MessageRouter] Overwriting handler for message type: ${type}`);
        }
        this.handlers.set(type, handler as unknown as MessageHandler<RoutedMessageType>);
    }

    /**
     * Register multiple handlers at once.
     */
    registerAll(
        handlers: Partial<Record<RoutedMessageType, MessageHandler<RoutedMessageType>>>,
    ): void {
        for (const [type, handler] of Object.entries(handlers) as Array<
            [RoutedMessageType, MessageHandler<RoutedMessageType> | undefined]
        >) {
            if (!handler) continue;
            this.register(type, handler);
        }
    }

    /**
     * Dispatch a parsed message to its handler.
     * Returns true if a handler was found and executed.
     */
    dispatch(ws: WebSocket, parsed: { type: string; payload?: unknown }): boolean {
        const player = this.services.getPlayer(ws);

        // Pre-processing: Close interruptible interfaces for certain actions
        if (INTERFACE_CLOSING_ACTIONS.has(parsed.type)) {
            if (player) {
                // Don't close interfaces for walk if player can't move
                if (parsed.type === "walk" && !player.canMove()) {
                    // Skip interface closing - movement will be blocked
                } else {
                    this.services.closeInterruptibleInterfaces(player);
                }
            }
        }

        const type = parsed.type as RoutedMessageType;
        const handler = this.handlers.get(type);
        if (!handler) {
            if (this.fallbackDispatcher) {
                return this.fallbackDispatcher(parsed.type, ws, player, parsed.payload);
            }
            return false;
        }

        const ctx: MessageContext<RoutedMessageType> = {
            ws,
            player,
            type,
            payload: parsed.payload as MessagePayload<RoutedMessageType>,
        };

        try {
            const result = handler(ctx);
            // Handle async handlers
            if (result instanceof Promise) {
                result.catch((err) => {
                    logger.error(`[MessageRouter] Async handler error for ${parsed.type}:`, err);
                });
            }
        } catch (err) {
            logger.error(`[MessageRouter] Handler error for ${parsed.type}:`, err);
        }

        return true;
    }

    /**
     * Check if a handler is registered for a message type.
     */
    hasHandler(type: string): boolean {
        return this.handlers.has(type as RoutedMessageType);
    }

    /**
     * Get the services object (for handlers that need additional access).
     */
    getServices(): MessageRouterServices {
        return this.services;
    }
}
