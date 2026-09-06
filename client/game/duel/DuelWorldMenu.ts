import { DuelSnapshot } from "../../common/duel/DuelProtocol";
import { DUEL_SHOPKEEPER } from "../../common/duel/DuelShop";
import { sendChat } from "../../network/ServerConnection";
import { MenuTargetType, OsrsMenuEntry } from "../../rs/MenuEntry";
import { MenuOpcode } from "../../ui/menu/MenuState";
import { duelInteractionStore } from "./DuelInteractionStore";
import { duelShopStore } from "./DuelShopStore";
import { duelStore } from "./DuelStore";

/** Use the normal menu, hit tests and walking; only the game mode's actions differ. */
export function applyDuelWorldMenu(entries: OsrsMenuEntry[]): void {
    const state = duelStore.getSnapshot();
    if (state.location !== "lobby") {
        // An active arena belongs to its two participants. Keep world/menu routing intact.
        for (let i = entries.length - 1; i >= 0; i--) {
            const entry = entries[i];
            if (entry.targetType === MenuTargetType.PLAYER && entry.option !== "Attack") {
                entries.splice(i, 1);
            }
        }
        return;
    }

    const available = state.status === "idle" && !state.trade;
    const challenges: OsrsMenuEntry[] = [];
    for (const entry of entries) {
        if (entry.targetType === MenuTargetType.PLAYER && entry.option === "Follow") {
            // Roaming uses left-click walking, including when another player overlaps the tile.
            entry.deprioritized = true;
        }
        if (entry.targetType === MenuTargetType.PLAYER && entry.option === "Trade with") {
            const id = entry.playerServerId ?? entry.targetId;
            // Custom callbacks deliberately use opcode 0, avoiding a second native trade packet.
            entry.opcode = MenuOpcode.Custom;
            entry.onClick = () => {
                if (canRequestPlayer(id)) sendChat(`::duel trade_request ${id}`);
            };
            if (available) challenges.push({
                ...entry,
                option: "Challenge",
                deprioritized: true,
                onClick: () => {
                    if (canRequestPlayer(id)) {
                        duelInteractionStore.openChallenge({ id, name: entry.targetName });
                    }
                },
            });
        }
        if (entry.targetType === MenuTargetType.NPC && entry.targetId === DUEL_SHOPKEEPER.id &&
            (entry.option === "Talk-to" || entry.option === "Trade")) {
            entry.opcode = MenuOpcode.Custom;
            entry.onClick = () => {
                if (duelStore.getSnapshot().location === "lobby") duelShopStore.open();
            };
            if (entry.option === "Talk-to" && available) challenges.push({
                ...entry, option: "Exchange tokens", deprioritized: true,
                onClick: () => duelInteractionStore.openExchange(),
            });
        }
    }
    entries.push(...challenges);
}

function canRequestPlayer(id: number): boolean {
    const state = duelStore.getSnapshot();
    return state.location === "lobby" && state.status === "idle" && !state.trade &&
        state.self?.id !== id && state.lobbyPlayers.some(player => player.id === id);
}

export function canAttackDuelPlayer(id: number, state: DuelSnapshot = duelStore.getSnapshot()): boolean {
    return state.location === "arena" && state.status === "fighting" && state.opponent?.id === id;
}
