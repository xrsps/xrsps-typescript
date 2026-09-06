import type { DuelCurrencyOffer, DuelWallet } from "../../../client/common/duel/DuelProtocol";
import type { PlayerState } from "../../src/game/player";
import { buildPlayerSaveKey } from "../../src/game/state/PlayerSessionKeys";

export const CURRENCY_IDS = { gold: 995, platinum: 13204 } as const;
export const CURRENCY_LIMIT = 2_147_483_647;
export type Currency = keyof typeof CURRENCY_IDS;
export type CurrencyLocation = "inventory" | "bank";
export const CURRENCIES = ["gold", "platinum"] as const;

export function accountKey(player: PlayerState): string {
    return player.__saveKey ?? buildPlayerSaveKey(player.name, player.id);
}

export function requireAmount(amount: number, allowZero = true): void {
    if (!Number.isSafeInteger(amount) || amount < (allowZero ? 0 : 1) || amount > CURRENCY_LIMIT) {
        throw new Error(`Enter a whole amount between ${allowZero ? 0 : 1} and 2,147,483,647.`);
    }
}

export function requireOffer(offer: DuelCurrencyOffer): void {
    if (!offer || typeof offer !== "object") throw new Error("Invalid currency offer.");
    for (const currency of CURRENCIES) requireAmount(offer[currency]);
}

export function currencyBalance(player: PlayerState, location: CurrencyLocation, currency: Currency): number {
    const entries = location === "inventory" ? player.getInventoryEntries() : player.bank.getBankEntries();
    let total = 0;
    for (const entry of entries) {
        if (entry.itemId !== CURRENCY_IDS[currency]) continue;
        requireAmount(entry.quantity);
        total += entry.quantity;
    }
    requireAmount(total);
    return total;
}

export function wallet(player: PlayerState): DuelWallet {
    return {
        inventory: { gold: currencyBalance(player, "inventory", "gold"), platinum: currencyBalance(player, "inventory", "platinum") },
        bank: { gold: currencyBalance(player, "bank", "gold"), platinum: currencyBalance(player, "bank", "platinum") },
    };
}

/** Updates real item containers, preserving every unrelated inventory/bank item. */
export function changeCurrency(player: PlayerState, location: CurrencyLocation, currency: Currency, change: number): void {
    if (!Number.isSafeInteger(change)) throw new Error("Invalid currency change.");
    const balance = currencyBalance(player, location, currency);
    const next = balance + change;
    if (next < 0) throw new Error(`You do not have enough ${currency} in your ${location}.`);
    if (next > CURRENCY_LIMIT) throw new Error(`Your ${location} cannot hold that much ${currency}.`);
    if (change === 0) return;
    const entries = location === "inventory" ? player.getInventoryEntries() : player.bank.getBankEntries();
    const itemId = CURRENCY_IDS[currency];
    let destination = entries.findIndex((entry) => entry.itemId === itemId);
    if (destination < 0 && next > 0) destination = entries.findIndex((entry) => entry.itemId <= 0);
    if (destination < 0 && next > 0) throw new Error(`Your ${location} is full.`);
    for (let index = 0; index < entries.length; index++) {
        if (entries[index].itemId !== itemId && index !== destination) continue;
        const quantity = index === destination ? next : 0;
        if (location === "inventory") player.setInventorySlot(index, itemId, quantity);
        else player.setBankSlot(index, itemId, quantity);
    }
}

export function debitOffer(player: PlayerState, offer: DuelCurrencyOffer): void {
    requireOffer(offer);
    for (const currency of CURRENCIES) changeCurrency(player, "inventory", currency, -offer[currency]);
}

/** Credits inventory first, then bank. Overflow remains in the durable credit ledger. */
export function creditAvailable(player: PlayerState, currency: Currency, amount: number): number {
    requireAmount(amount);
    let remaining = amount;
    for (const location of ["inventory", "bank"] as const) {
        const entries = location === "inventory" ? player.getInventoryEntries() : player.bank.getBankEntries();
        if (!entries.some((entry) => entry.itemId === CURRENCY_IDS[currency] || entry.itemId <= 0)) continue;
        const added = Math.min(remaining, CURRENCY_LIMIT - currencyBalance(player, location, currency));
        changeCurrency(player, location, currency, added);
        remaining -= added;
    }
    return amount - remaining;
}
