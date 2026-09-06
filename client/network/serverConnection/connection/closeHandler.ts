import { setPacketSocket } from "../../packet";
import { duelStore } from "../../../game/duel/DuelStore";
import { WS_GLOBAL_KEY, WS_SUPPRESS_RECONNECT_KEY, RECONNECT_DELAY_MAX_MS, RECONNECT_MAX_ATTEMPTS } from "../constants";
import { clearLoginConnectRetryTimer } from "./loginHelpers";
import { state } from "../state";

export function initSocketCloseHandler(ws: WebSocket, initConnection: (url: string) => void): void {
    ws.addEventListener("close", (evt: CloseEvent) => {
        if (state.socket !== ws) {
            return;
        }

        state.socket = null;
        duelStore.reset();
        const reasonPart = evt.reason ? `, reason=${evt.reason}` : "";
        // eslint-disable-next-line no-console
        console.log(`[ws] disconnected (code=${evt.code}, clean=${evt.wasClean}${reasonPart})`);
        // Clear the packet writer state.socket
        setPacketSocket(null);
        state.lastSkillsState = undefined;
        state.playerSyncContext = null;
        state.playerUpdateDecoder = null;
        clearLoginConnectRetryTimer();
        try {
            const g: any = (typeof window !== "undefined" ? window : globalThis) as any;
            if (g[WS_GLOBAL_KEY] === ws) g[WS_GLOBAL_KEY] = null;
            const suppress: boolean = !!g[WS_SUPPRESS_RECONNECT_KEY];
            // Determine if we should attempt reconnection
            // Don't reconnect if: suppressed (HMR/logout), clean close with specific reasons, or max attempts reached
            const isIntentionalClose =
                evt.wasClean && (evt.reason === "logout" || evt.reason === "page unload");
            // Only reconnect if we have stored session credentials (were previously logged in)
            const hasSession = state.sessionUsername !== null && state.sessionPassword !== null;
            const shouldReconnect =
                hasSession &&
                !suppress &&
                !isIntentionalClose &&
                state.reconnectAttempts < RECONNECT_MAX_ATTEMPTS;

            console.log(
                `[ws] reconnect check: hasSession=${hasSession}, suppress=${suppress}, intentional=${isIntentionalClose}, attempts=${state.reconnectAttempts}/${RECONNECT_MAX_ATTEMPTS}, willReconnect=${shouldReconnect}`,
            );

            // Attempt reconnection if appropriate - do this BEFORE notifying listeners
            // so state.isReconnecting is set correctly
            if (shouldReconnect && !state.reconnectTimer) {
                state.isReconnecting = true;
                state.reconnectAttempts++;
                const delay = Math.min(state.reconnectDelayMs | 0, RECONNECT_DELAY_MAX_MS);
                // eslint-disable-next-line no-console
                console.log(
                    `[ws] reconnecting in ${delay}ms... (attempt ${state.reconnectAttempts}/${RECONNECT_MAX_ATTEMPTS})`,
                );
                state.reconnectTimer = setTimeout(() => {
                    state.reconnectTimer = null;
                    state.reconnectDelayMs = Math.min(delay * 2, RECONNECT_DELAY_MAX_MS);
                    try {
                        initConnection(state.lastUrl);
                    } catch {}
                }, delay);
            }

            // Notify disconnect listeners
            for (const cb of state.disconnectListeners) {
                try {
                    cb({
                        code: evt.code,
                        reason: evt.reason || "",
                        willReconnect: shouldReconnect,
                    });
                } catch {}
            }

            // If reconnection not possible and we were trying to reconnect, notify failure
            if (!shouldReconnect && state.isReconnecting) {
                // Reconnection attempts exhausted - notify failure
                state.isReconnecting = false;
                // eslint-disable-next-line no-console
                console.log("[ws] reconnection failed after max attempts");
                for (const cb of state.reconnectFailedListeners) {
                    try {
                        cb();
                    } catch {}
                }
            }
        } catch {}
    });
}
