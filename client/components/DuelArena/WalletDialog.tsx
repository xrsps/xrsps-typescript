import { useState } from "react";
import { DuelSnapshot } from "../../common/duel/DuelProtocol";
import { CurrencySummary, currencyText } from "./CurrencyOffer";
import { DuelModal } from "./DuelModal";

export function WalletDialog({ duel, action, pending, close }: {
    duel: DuelSnapshot; action: (command: string) => void; pending: boolean; close: () => void;
}) {
    const [direction, setDirection] = useState<"deposit" | "withdraw">("deposit");
    const [currency, setCurrency] = useState<"gold" | "platinum">("gold");
    const [amount, setAmount] = useState(0);
    const available = duel.wallet[direction === "deposit" ? "inventory" : "bank"][currency];
    const valid = Number.isSafeInteger(amount) && amount > 0 && amount <= available;
    return <DuelModal title="Bank & inventory" onClose={close} wide>
        <p>Your currency is saved to your account.</p>
        <div className="duel-offer-columns duel-wallet-columns">
            <section><h3>Inventory<small>Available to stake & trade</small></h3><CurrencySummary offer={duel.wallet.inventory} /></section>
            <section><h3>Bank<small>Stored safely</small></h3><CurrencySummary offer={duel.wallet.bank} /></section>
        </div>
        <div className="duel-wallet-form">
            <div className="duel-segment" role="group" aria-label="Bank action">{(["deposit", "withdraw"] as const).map(v =>
                <button key={v} aria-pressed={direction === v} onClick={() => { setDirection(v); setAmount(0); }}>{v === "deposit" ? "Deposit" : "Withdraw"}</button>)}</div>
            <div className="duel-segment" role="group" aria-label="Currency">{(["gold", "platinum"] as const).map(v =>
                <button key={v} aria-pressed={currency === v} onClick={() => { setCurrency(v); setAmount(0); }}>{v === "gold" ? "Gold" : "Platinum"}</button>)}</div>
            <label htmlFor="bank-amount">Amount <small>Available: {currencyText(available)}</small></label>
            <div className="duel-bank-amount"><input id="bank-amount" type="number" step={1} min={0} max={available} value={amount}
                onChange={e => setAmount(Number(e.target.value))} /><button onClick={() => setAmount(available)}>All</button>
                <button className="duel-primary" disabled={pending || !valid}
                    onClick={() => action(`bank ${direction} ${currency} ${amount}`)}>{direction === "deposit" ? "Deposit" : "Withdraw"}</button></div>
        </div>
        <div className="duel-exchange"><div><h3>Exchange tokens</h3><p>1 platinum token = 1,000 gold.</p></div>
            <button disabled={pending || duel.wallet.inventory.gold < 1000} onClick={() => action("exchange gold 1000")}>1,000 gold → 1 token</button>
            <button disabled={pending || duel.wallet.inventory.platinum < 1} onClick={() => action("exchange platinum 1")}>1 token → 1,000 gold</button></div>
        <p className="duel-notice" role="status">{duel.message}</p>
    </DuelModal>;
}
