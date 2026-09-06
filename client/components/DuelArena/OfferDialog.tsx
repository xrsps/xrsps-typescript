import { useEffect, useState } from "react";
import { DuelCurrencyOffer, DuelSnapshot, DUEL_WEAPONS } from "../../common/duel/DuelProtocol";
import { CurrencyOffer, CurrencySummary, currencyText, offerValue } from "./CurrencyOffer";
import { DuelModal } from "./DuelModal";

export function OfferDialog({ duel, action, pending, trading = false }: {
    duel: DuelSnapshot; action: (command: string) => void; pending: boolean; trading?: boolean;
}) {
    const stake = duel.stake, trade = duel.trade;
    const selfOffer = (trading ? trade?.selfOffer : stake?.self) ?? { gold: 0, platinum: 0 };
    const otherOffer = (trading ? trade?.opponentOffer : stake?.opponent) ?? { gold: 0, platinum: 0 };
    const session = trading ? trade?.id : duel.roomCode;
    const revision = (trading ? trade?.revision : stake?.revision) ?? 0;
    const reviewing = trading ? trade?.stage === "review" : duel.status === "review";
    const opponent = trading ? trade?.opponentName : duel.opponent?.name;
    const accepted = trading ? trade?.selfAccepted : reviewing ? stake?.selfConfirmed : stake?.selfAccepted;
    const otherAccepted = trading ? trade?.opponentAccepted : reviewing ? stake?.opponentConfirmed : stake?.opponentAccepted;
    const [draft, setDraft] = useState<DuelCurrencyOffer>(selfOffer);
    useEffect(() => { setDraft({ gold: selfOffer.gold, platinum: selfOffer.platinum }); }, [session, selfOffer.gold, selfOffer.platinum]);
    const dirty = draft.gold !== selfOffer.gold || draft.platinum !== selfOffer.platinum;
    const valid = draft.gold <= duel.wallet.inventory.gold && draft.platinum <= duel.wallet.inventory.platinum;
    const prefix = trading ? "trade_" : "";
    const cancel = () => action(trading ? `trade_cancel ${session}` : "leave");
    const save = () => action(`${prefix}offer ${session} ${revision} ${draft.gold} ${draft.platinum}`);
    const approve = () => action(`${trading ? reviewing ? "trade_confirm" : "trade_review" : reviewing ? "confirm" : "accept"} ${session} ${revision}`);
    return <DuelModal title={trading ? reviewing ? "Confirm trade" : "Trade" : reviewing ? "Confirm your duel" : "Duel stake"} onClose={cancel} wide>
        <p className="duel-agreement">{trading ? <>Trading with <strong>{opponent}</strong></> : <>
            <strong>{duel.agreedWeaponId === DUEL_WEAPONS.dagger ? "Dragon dagger P++" : "Abyssal whip"}</strong>
            <span>Same weapon for both players · Locked for the entire fight</span></>}</p>
        <div className="duel-offer-columns">
            <section><h3>{reviewing ? "You give" : "Your offer"}<small>{duel.self?.name}</small></h3>
                {reviewing ? <CurrencySummary offer={selfOffer} /> : <CurrencyOffer value={draft} onChange={setDraft} available={duel.wallet.inventory} disabled={pending} />}
                <p className={accepted ? "duel-approved" : "duel-approval"}>{accepted ? "✓ Accepted" : "Not accepted yet"}</p>
            </section>
            <section><h3>{trading && reviewing ? "You receive" : "Their offer"}<small>{opponent}</small></h3>
                <CurrencySummary offer={otherOffer} />
                <p className={otherAccepted ? "duel-approved" : "duel-approval"}>{otherAccepted ? "✓ Accepted" : "Waiting for acceptance"}</p>
            </section>
        </div>
        <div className="duel-offer-total"><span>{trading ? "Your offer value" : "Winner receives"}</span>
            <strong>{currencyText(offerValue(selfOffer) + (trading ? 0 : offerValue(otherOffer)))} <small>gp</small></strong></div>
        <p className="duel-fine">{reviewing ? "Check both amounts carefully. Both players must confirm." : "Any change clears both players’ acceptance."}
            {!trading && " No tax. The winner receives both stakes."}</p>
        <p className="duel-notice" role="status">{!valid ? "Your offer exceeds your inventory balance." : dirty ? "Save your offer to share it with your opponent." : duel.message}</p>
        <div className="duel-dialog-actions">
            <button onClick={cancel} disabled={pending}>Decline</button>
            {reviewing ? <button disabled={pending} onClick={save}>Edit offer</button> :
                dirty && <button disabled={pending || !valid} onClick={save}>Save offer</button>}
            <button className="duel-primary" disabled={pending || dirty || !valid || !!accepted} onClick={approve}>
                {accepted ? "Waiting for opponent…" : reviewing ? trading ? "Confirm trade" : "Confirm & fight" : "Accept offer"}</button>
        </div>
    </DuelModal>;
}
