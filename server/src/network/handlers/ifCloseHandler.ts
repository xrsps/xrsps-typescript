import type { MessageHandler } from "../MessageRouter";
import type { MessageHandlerServices } from "../MessageHandlers";

export function createIfCloseHandler(services: MessageHandlerServices): MessageHandler<"if_close"> {
    return (ctx) => {
        const player = services.getPlayer(ctx.ws);
        if (player) {
            services.closeInterruptibleInterfaces(player);
        }
    };
}
