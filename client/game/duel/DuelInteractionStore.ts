import { DuelLobbyPlayer } from "../../common/duel/DuelProtocol";

export interface DuelPlayerMenu { x: number; y: number; players: DuelLobbyPlayer[]; shopkeeper?: string; }
let current: DuelPlayerMenu | null = null;
const listeners = new Set<() => void>();
const bankListeners = new Set<() => void>();
const challengeListeners = new Set<(player: DuelLobbyPlayer) => void>();
const exchangeListeners = new Set<() => void>();
export const duelInteractionStore = {
    getSnapshot: () => current,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    open: (menu: DuelPlayerMenu) => { current = menu; listeners.forEach(l => l()); },
    close: () => { if (!current) return; current = null; listeners.forEach(l => l()); },
    subscribeBank: (listener: () => void) => { bankListeners.add(listener); return () => { bankListeners.delete(listener); }; },
    openBank: () => { bankListeners.forEach(l => l()); },
    subscribeChallenge: (listener: (player: DuelLobbyPlayer) => void) => {
        challengeListeners.add(listener);
        return () => { challengeListeners.delete(listener); };
    },
    openChallenge: (player: DuelLobbyPlayer) => { challengeListeners.forEach(l => l(player)); },
    subscribeExchange: (listener: () => void) => { exchangeListeners.add(listener); return () => { exchangeListeners.delete(listener); }; },
    openExchange: () => { exchangeListeners.forEach(listener => listener()); },
};
