import { chatHistory } from "../../rs/cs2/ChatHistory";

export interface DuelPublicMessage { id: number; sender: string; text: string; }
let snapshot: readonly DuelPublicMessage[] = [];
let latestId = -1;

/** Reuse the existing bounded chat history with stable React snapshots. */
export const duelPublicChatStore = {
    subscribe: chatHistory.subscribe,
    getSnapshot(): readonly DuelPublicMessage[] {
        const latest = chatHistory.getFullByTypeAndLine(2, 0)?.count ?? 0;
        if (latest === latestId) return snapshot;
        latestId = latest;
        const messages: DuelPublicMessage[] = [];
        for (let index = Math.min(100, chatHistory.getLength(2)) - 1; index >= 0; index--) {
            const entry = chatHistory.getFullByTypeAndLine(2, index);
            if (entry) messages.push(Object.freeze({ id: entry.count, sender: entry.sender, text: entry.text }));
        }
        snapshot = Object.freeze(messages);
        return snapshot;
    },
};
