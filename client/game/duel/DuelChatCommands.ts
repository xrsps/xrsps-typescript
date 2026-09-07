import { duelShopStore } from "./DuelShopStore";

/** Client-only commands never become public messages or payment requests. */
export function executeDuelChatCommand(text: string): boolean {
    if (text.trim().toLowerCase() !== "::shop") return false;
    duelShopStore.open();
    return true;
}
