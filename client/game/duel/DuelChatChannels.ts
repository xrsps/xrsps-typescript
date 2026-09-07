import { chatHistory } from "../../rs/cs2/ChatHistory";
import type { DuelSnapshot } from "../../common/duel/DuelProtocol";
import { duelStore } from "./DuelStore";

export type DuelChatChannel = "all" | "game" | "public" | "trade" | "duel";
export interface DuelChatLine { id: number; sender: string; text: string; channel: Exclude<DuelChatChannel, "all">; }
let snapshot: readonly DuelChatLine[] = [], latest = -1;
export const duelChatStore = {
    subscribe: chatHistory.subscribe,
    getSnapshot(): readonly DuelChatLine[] {
        const id = chatHistory.getLatestMessage()?.uid ?? 0;
        if (id === latest) return snapshot;
        latest = id;
        snapshot = Object.freeze(chatHistory.getRecentMessages().flatMap(message => {
            const channel = message.type === 2 || message.type === 1 ? "public" : message.type === 4 || message.type === 101 ? "trade" : message.type === 16 ? "duel" : message.type === 0 ? "game" : undefined;
            return channel ? [Object.freeze({ id: message.uid, sender: message.from, text: message.text, channel })] : [];
        }));
        return snapshot;
    },
};

/** Snapshot events give the Trade and Duel filters real, server-authored history. */
export function createDuelChatEventBridge(add: (type: number, text: string) => void) {
    let playerId: number | undefined, lastMessage = "", tradeStage = "";
    let duelRequests = new Set<string>(), tradeRequests = new Set<string>();
    return (state: DuelSnapshot) => {
        if (state.self?.id !== playerId) {
            playerId = state.self?.id; lastMessage = ""; tradeStage = "";
            duelRequests.clear(); tradeRequests.clear();
        }
        if (!state.self) return;
        for (const request of state.requests) if (!duelRequests.has(request.id)) add(16, `${request.fromName} wishes to duel with you.`);
        for (const request of state.tradeRequests) if (!tradeRequests.has(request.id)) add(4, `${request.fromName} wishes to trade with you.`);
        duelRequests = new Set(state.requests.map(request => request.id));
        tradeRequests = new Set(state.tradeRequests.map(request => request.id));
        const messageKey = `${state.roomCode ?? ""}:${state.message}`;
        if (state.message && messageKey !== lastMessage) add(state.roomCode ? 16 : state.trade ? 4 : 0, state.message);
        lastMessage = messageKey;
        const stage = state.trade ? `${state.trade.id}:${state.trade.stage}` : "";
        if (stage && stage !== tradeStage) add(4, state.trade!.stage === "review" ? "Review both offers before confirming the trade." : `Trading with ${state.trade!.opponentName}.`);
        tradeStage = stage;
    };
}

export function subscribeDuelChatEvents(): () => void {
    const read = createDuelChatEventBridge((type, text) => chatHistory.addMessage(type, text));
    read(duelStore.getSnapshot());
    return duelStore.subscribe(() => read(duelStore.getSnapshot()));
}
