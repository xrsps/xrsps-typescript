import type { ScriptServices } from "../../../src/game/scripts/types";
import type { PlayerState } from "../../../src/game/player";

const SHOP_GROUP_ID = 300;
const BANK_GROUP_ID = 12;
const SMITHING_GROUP_ID = 312;

export function registerWidgetCloseHandlers(
    services: ScriptServices,
    deps: {
        closeModal: (player: PlayerState) => void;
    },
): void {
    const handlers = new Map<number, (player: PlayerState) => void>();

    handlers.set(SHOP_GROUP_ID, (player) => {
        services.shopping?.closeShop?.(player);
    });

    handlers.set(BANK_GROUP_ID, (player) => {
        deps.closeModal(player);
    });

    handlers.set(SMITHING_GROUP_ID, (player) => {
        services.production?.queueSmithingMessage?.(player.id, { kind: "close" });
    });

    services.widgetCloseHandlers = handlers;
}
