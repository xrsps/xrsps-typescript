import { DuelSnapshot } from "../../common/duel/DuelProtocol";
import { sendChat } from "../../network/ServerConnection";
import { chatHistory } from "../../rs/cs2/ChatHistory";
import { getNativeChatRowUid } from "../../rs/cs2/ChatRowIdentity";
import { duelStore } from "./DuelStore";

export interface DuelChatRequestLink {
    kind: "duel" | "trade";
    requestId: string;
    ownerId: number;
}

/** A native chat row accepts exactly the request that created it, even if names/text are reused. */
export function createDuelChatRequests(
    getState: () => DuelSnapshot,
    send: (command: string) => void,
    notice: (text: string) => void = () => {},
) {
    const links = new Map<number, DuelChatRequestLink>();
    const submitted = new Set<string>();
    return {
        register(uid: number, link: DuelChatRequestLink): void {
            links.set(uid, { ...link });
            // The native history retains at most 100 rows per request channel.
            if (links.size > 256) links.delete(links.keys().next().value!);
        },
        reset(): void { links.clear(); submitted.clear(); },
        has(uid: number): boolean { return links.has(uid); },
        accept(uid: number, option?: string): boolean {
            const link = links.get(uid);
            if (!link) return false;
            const expected = link.kind === "duel" ? "accept challenge" : "accept trade";
            if (option && option.toLowerCase() !== expected) return false;
            const state = getState();
            const requests = link.kind === "duel" ? state.requests : state.tradeRequests;
            const request = requests.find(request => request.id === link.requestId);
            if (state.self?.id !== link.ownerId || state.location !== "lobby" ||
                state.status !== "idle" || state.trade || !request || request.expiresInTicks <= 0) {
                notice("That request is no longer available.");
                return true; // Consume stale lines instead of falling through to a native player action.
            }
            const key = `${link.ownerId}:${link.kind}:${link.requestId}`;
            if (!submitted.has(key)) {
                submitted.add(key);
                send(link.kind === "duel" ? `respond ${link.requestId} accept` : `trade_accept ${link.requestId}`);
            }
            return true;
        },
    };
}

export const duelChatRequests = createDuelChatRequests(
    duelStore.getSnapshot,
    command => sendChat(`::duel ${command}`),
    text => chatHistory.addMessage(0, text),
);

export function handleDuelChatRequestAction(widget: unknown, option?: string): boolean {
    const uid = getNativeChatRowUid(widget);
    return uid !== undefined && duelChatRequests.accept(uid, option);
}

export function handleDuelChatRequestClick(widgets: readonly unknown[]): boolean {
    for (let i = widgets.length - 1; i >= 0; i--) {
        if (handleDuelChatRequestAction(widgets[i])) return true;
    }
    return false;
}
