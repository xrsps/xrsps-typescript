import { DuelCurrencyOffer } from "../../common/duel/DuelProtocol";
import { CurrencyIcon } from "./CurrencyIcon";
import { itemStackText } from "../../common/items/ItemStackText";

export const currencyText = (n: number) => n.toLocaleString("en-US");
export const offerValue = (offer: DuelCurrencyOffer) => offer.gold + offer.platinum * 1000;
export function CurrencySummary({ offer }: { offer: DuelCurrencyOffer }) {
    return <div className="duel-currency-summary">
        {(["gold", "platinum"] as const).map(currency => <span key={currency}>
            <CurrencyIcon currency={currency} quantity={offer[currency]} />{currency === "gold" ? "Gold" : "Platinum"}
            <b title={currencyText(offer[currency])} aria-label={`${currencyText(offer[currency])} ${currency}`}
                style={{ color: itemStackText(offer[currency]).color }}>{itemStackText(offer[currency]).text}</b>
        </span>)}
    </div>;
}
export function CurrencyOffer({ value, onChange, available, disabled = false }: {
    value: DuelCurrencyOffer; onChange: (value: DuelCurrencyOffer) => void;
    available: DuelCurrencyOffer; disabled?: boolean;
}) {
    return <div className="duel-currency-fields">{(["gold", "platinum"] as const).map(currency => <div key={currency}>
        <label htmlFor={`offer-${currency}`}><CurrencyIcon currency={currency} quantity={value[currency]} />
            {currency === "gold" ? "Gold" : "Platinum tokens"}</label>
        <input id={`offer-${currency}`} aria-label={`Your ${currency} offer`} type="number" min={0} max={available[currency]} step={1}
            disabled={disabled} value={value[currency]} onChange={e => {
                const n = Number(e.target.value);
                if (Number.isSafeInteger(n) && n >= 0 && n <= 2147483647) onChange({ ...value, [currency]: n });
            }} />
        <div className="duel-amount-steps">{[10, 100, 1000].map(n => <button type="button" disabled={disabled} key={n}
            onClick={() => onChange({ ...value, [currency]: Math.min(available[currency], value[currency] + n) })}>+{n === 1000 ? "1k" : n}</button>)}
            <button type="button" disabled={disabled} onClick={() => onChange({ ...value, [currency]: available[currency] })}>Max</button></div>
        <small>In inventory: {currencyText(available[currency])}</small>
    </div>)}</div>;
}
