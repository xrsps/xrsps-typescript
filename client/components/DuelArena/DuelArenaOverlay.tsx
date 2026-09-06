import { useEffect, useState, useSyncExternalStore } from "react";
import { OsrsClient } from "../../game/OsrsClient";
import { duelStore } from "../../game/duel/DuelStore";
import { duelShopStore } from "../../game/duel/DuelShopStore";
import { subscribeDuelChatEvents } from "../../game/duel/DuelChatChannels";
import { duelInteractionStore } from "../../game/duel/DuelInteractionStore";
import { sendChat } from "../../network/ServerConnection";
import { CurrencyIconContext } from "./CurrencyIcon";
import { LobbyControls } from "./LobbyControls";
import { OfferDialog } from "./OfferDialog";
import { DuelShop } from "./DuelShop";
import { DuelModal } from "./DuelModal";
import { ExchangeDialog } from "./ExchangeDialog";
import "./DuelArena.css";
import "./DuelLobby.css";
import "./DuelNative.css";

/** Only negotiation and shop windows overlay the original game interface. */
export function DuelArenaOverlay({ client }: { client: OsrsClient }) {
    const duel = useSyncExternalStore(duelStore.subscribe, duelStore.getSnapshot);
    const [pending, setPending] = useState(false);
    const [exchange, setExchange] = useState(false);
    const free = duel.location === "lobby" && duel.status === "idle" && !duel.trade && !!duel.self;
    useEffect(() => duelInteractionStore.subscribeExchange(() => {
        const state = duelStore.getSnapshot();
        if (state.location === "lobby" && state.status === "idle" && !state.trade && state.self) setExchange(true);
    }), []);
    useEffect(() => { if (!free) setExchange(false); }, [free]);
    useEffect(subscribeDuelChatEvents, []);
    useEffect(() => { setPending(false); }, [duel]);
    useEffect(() => {
        if (!pending) return;
        const timer = window.setTimeout(() => setPending(false), 3000);
        return () => window.clearTimeout(timer);
    }, [pending]);
    useEffect(() => { if (!duel.self) duelShopStore.reset(); }, [duel.self]);
    function action(command: string) {
        if (!client.isLoggedIn() || pending) return;
        setPending(true);
        sendChat(`::duel ${command}`);
    }
    if (!duel.self || !client.isLoggedIn()) return null;
    const lobby = duel.location === "lobby";
    return <CurrencyIconContext.Provider value={client}>
        <div className="duel-ui duel-native" onKeyDown={e => e.stopPropagation()} onKeyUp={e => e.stopPropagation()}>
            {lobby && <LobbyControls duel={duel} action={action} pending={pending} />}
            <DuelShop key={duel.self.name} playerName={duel.self.name} />
            {exchange && free && <ExchangeDialog duel={duel} action={action} pending={pending} close={() => setExchange(false)} />}
            {duel.stake && ["staking", "review"].includes(duel.status) && <OfferDialog duel={duel} action={action} pending={pending} />}
            {duel.trade && <OfferDialog duel={duel} action={action} pending={pending} trading />}
            {duel.status === "countdown" && <div className="duel-countdown" role="status">
                <span>Get ready</span><strong>{Math.max(1, Math.ceil(duel.countdownTicks * .6))}</strong></div>}
            {duel.status === "finished" && <DuelModal title={duel.winnerId === null ? "Duel cancelled" : duel.winnerId === duel.self.id ? "Victory" : "Defeated"} onClose={() => action("leave")}>
                <p>{duel.message}</p><button className="duel-primary duel-wide-button" onClick={() => action("leave")} disabled={pending}>Return to courtyard</button>
            </DuelModal>}
        </div>
    </CurrencyIconContext.Provider>;
}
