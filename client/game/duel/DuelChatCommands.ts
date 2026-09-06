import { duelShopStore } from "./DuelShopStore";
import { duelInteractionStore } from "./DuelInteractionStore";
import { duelStore } from "./DuelStore";

/** Client-only commands never become public messages or payment requests. */
export function executeDuelChatCommand(text: string): boolean {
    if (!duelStore.getSnapshot().self) return false;
    if (text.trim().toLowerCase() === "::exchange") { duelInteractionStore.openExchange(); return true; }
    if (text.trim().toLowerCase() !== "::shop") return false;
    duelShopStore.open();
    return true;
}
