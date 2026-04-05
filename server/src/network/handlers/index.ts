import type { MessageRouter } from "../MessageRouter";
import type { MessageHandlerServices } from "../MessageHandlers";
import { registerMessageHandlers } from "../MessageHandlers";
import { createLogoutHandler } from "./logoutHandler";
import { createIfCloseHandler } from "./ifCloseHandler";
import { createWidgetHandler } from "./widgetHandler";
import { createVarpTransmitHandler } from "./varpTransmitHandler";
import { type BinaryHandlerExtServices, registerBinaryHandlers } from "./binaryMessageHandlers";

export type { BinaryHandlerExtServices };

/**
 * Registers ALL message handlers with the router.
 * This is the single entry point for handler registration.
 *
 * To add a new handler:
 * 1. Create a handler file in this directory
 * 2. Export a createXxxHandler(services) function
 * 3. Register it here with router.register("type", createXxxHandler(services))
 */
export function registerAllHandlers(
    router: MessageRouter,
    services: BinaryHandlerExtServices,
): void {
    // Existing handlers from MessageHandlers.ts (20+ gameplay handlers)
    registerMessageHandlers(router, services);

    // Extracted from onConnection if-else chain
    router.register("logout", createLogoutHandler(services));
    router.register("if_close", createIfCloseHandler(services));
    router.register("widget", createWidgetHandler(services));
    router.register("varp_transmit", createVarpTransmitHandler(services));

    // Extracted from processBinaryMessage switch
    registerBinaryHandlers(router, services);
}
