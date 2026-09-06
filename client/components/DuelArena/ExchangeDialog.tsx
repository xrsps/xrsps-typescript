import { useState } from "react";
import { DuelSnapshot } from "../../common/duel/DuelProtocol";
import { CurrencySummary } from "./CurrencyOffer";
import { DuelModal } from "./DuelModal";

export function ExchangeDialog({ duel, action, pending, close }: {
    duel: DuelSnapshot; action: (command: string) => void; pending: boolean; close: () => void;
}) {
    const [currency, setCurrency] = useState<"gold" | "platinum">("gold");
    const [amount, setAmount] = useState(1000);
    const available = duel.wallet.inventory[currency];
    const valid = Number.isSafeInteger(amount) && amount > 0 && amount <= available &&
        (currency !== "gold" || amount % 1000 === 0);
    return <DuelModal title="Exchange tokens" onClose={close}>
        <p>1 platinum token = 1,000 gold coins.</p>
        <CurrencySummary offer={duel.wallet.inventory} />
        <div className="duel-segment" role="group" aria-label="Exchange currency">
            <button aria-pressed={currency === "gold"} onClick={() => { setCurrency("gold"); setAmount(1000); }}>Gold to tokens</button>
            <button aria-pressed={currency === "platinum"} onClick={() => { setCurrency("platinum"); setAmount(1); }}>Tokens to gold</button>
        </div>
        <label htmlFor="exchange-amount">{currency === "gold" ? "Gold coins" : "Platinum tokens"} to exchange</label>
        <input id="exchange-amount" type="number" value={amount} min={currency === "gold" ? 1000 : 1}
            max={available} step={currency === "gold" ? 1000 : 1} onChange={event => setAmount(Number(event.target.value))} />
        <p className="duel-notice" role="status">{duel.message}</p>
        <button className="duel-primary duel-wide-button" disabled={!valid || pending}
            onClick={() => action(`exchange ${currency} ${amount}`)}>Exchange</button>
    </DuelModal>;
}
