import type { MessageHandler } from "../MessageRouter";
import type { MessageHandlerServices } from "../MessageHandlers";
import { ACTIVE_COMBAT_TIMER } from "../../game/model/timer/Timers";
import { LockState } from "../../game/model/LockState";
import { encodeMessage } from "../messages";
import { logger } from "../../utils/logger";

export function createLogoutHandler(services: MessageHandlerServices): MessageHandler<"logout"> {
    return (ctx) => {
        const { ws } = ctx;
        try {
            const player = services.getPlayer(ws);
            if (player) {
                if (!player.canLogout()) {
                    const activeCombatTicks = player.timers.getOrDefault(ACTIVE_COMBAT_TIMER, 0);
                    const logoutReason = LockState.NONE !== player.lock ? "locked" : "combat";
                    const logoutMessage =
                        logoutReason === "locked"
                            ? "You can't log out right now."
                            : "You can't log out until 10 seconds after the end of combat.";
                    logger.info(
                        `[logout] Player ${player.id} cannot logout reason=${logoutReason} lock=${player.lock} activeCombatTicks=${activeCombatTicks}`,
                    );
                    try {
                        const response = encodeMessage({
                            type: "logout_response",
                            payload: { success: false, reason: logoutMessage },
                        });
                        ws.send(response);
                    } catch {}
                    return;
                }
                services.completeLogout(ws, player);
            }
            if (!player) services.completeLogout(ws);
        } catch (err) {
            logger.warn("[logout] Error during logout:", err);
            try { ws.close(1000, "logout"); } catch {}
        }
    };
}
