import type { ChatMessageEvent } from "../../network/serverConnection/types";
import type { PlayerEcs } from "../ecs/PlayerEcs";

/** Area public packets reuse model overheads without inserting another history entry. */
export function applyStandalonePublicChat(players: PlayerEcs, message: ChatMessageEvent): void {
    if (message.messageType !== "public" || message.playerId === undefined || !message.text) return;
    const index = players.getIndexForServerId(message.playerId);
    // Distant speakers appear in history, but must not create phantom actors.
    if (index === undefined || players.getIsHidden(index)) return;
    players.setOverheadChat(index, { text: message.text, color: 0, effect: 0, modIcon: -1, duration: 150 });
}
