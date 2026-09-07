import { useEffect, useState, useSyncExternalStore } from "react";
import { DUEL_WEAPONS } from "../../common/duel/DuelProtocol";
import { OsrsClient } from "../../game/OsrsClient";
import { duelStore } from "../../game/duel/DuelStore";
import { duelInteractionStore } from "../../game/duel/DuelInteractionStore";
import { GameState } from "../../game/login/GameState";
import { sendChat, subscribeLogoutResponse } from "../../network/ServerConnection";
import { DuelLogin } from "./DuelLogin";
import { CurrencyIconContext } from "./CurrencyIcon";
import { DuelPublicChat } from "./DuelPublicChat";
import { FighterStatus } from "./FighterStatus";
import { LobbyControls } from "./LobbyControls";
import { OfferDialog } from "./OfferDialog";
import { WalletDialog } from "./WalletDialog";
import { DuelShop } from "./DuelShop";
import { duelShopStore } from "../../game/duel/DuelShopStore";
import "./DuelArena.css";
import "./DuelLobby.css";

export function DuelArenaOverlay({ client }: { client: OsrsClient }) {
    const duel = useSyncExternalStore(duelStore.subscribe, duelStore.getSnapshot);
    const [gameState, setGameState] = useState(client.gameState);
    const [pending, setPending] = useState(false);
    const [bank, setBank] = useState(false);
    const [logoutError, setLogoutError] = useState("");
    const canBank = duel.status === "idle" && duel.trade === null && duel.self !== null;
    useEffect(() => {
        const timer = window.setInterval(() => setGameState(client.gameState), 150);
        return () => window.clearInterval(timer);
    }, [client]);
    useEffect(() => { setPending(false); }, [duel]);
    useEffect(() => { if (!canBank) setBank(false); }, [canBank]);
    useEffect(() => duelInteractionStore.subscribeBank(() => {
        const state = duelStore.getSnapshot();
        if (state.location === "lobby" && state.status === "idle" && !state.trade) setBank(true);
    }), []);
    useEffect(() => subscribeLogoutResponse(response => {
        setPending(false);
        setLogoutError(response.success ? "" : response.reason ?? "You can't sign out right now.");
    }), []);
    useEffect(() => {
        if (!pending) return;
        const timer = window.setTimeout(() => setPending(false), 3000);
        return () => window.clearTimeout(timer);
    }, [pending]);
    function action(command: string) {
        if (gameState !== GameState.LOGGED_IN || pending) return;
        setLogoutError(""); setPending(true);
        sendChat(`::duel ${command}`);
    }
    const loggedIn = gameState === GameState.LOGGED_IN;
    useEffect(() => { if (!loggedIn) duelShopStore.reset(); }, [loggedIn]);
    const reconnecting = [GameState.RECONNECTING, GameState.PLEASE_WAIT, GameState.CONNECTION_LOST].includes(gameState);
    const fighting = duel.status === "fighting", finished = duel.status === "finished";
    const lobby = duel.location === "lobby";
    const isDagger = duel.self?.weaponId === DUEL_WEAPONS.dagger;
    const specialCost = isDagger ? 25 : 50;
    return <CurrencyIconContext.Provider value={client}><div className={`duel-ui ${!loggedIn ? "duel-ui-entry" : ""} ${lobby ? "duel-ui-lobby" : ""}`}
        onKeyDown={e => e.stopPropagation()} onKeyUp={e => e.stopPropagation()}>
        {!loggedIn ? reconnecting ? <div className="duel-center"><div className="duel-panel" role="status">
            <h2>Connection lost</h2><p>Reconnecting to the arena…</p></div></div> :
            <DuelLogin client={client} gameState={gameState} /> : <>
            <header className="duel-top">
                {!lobby && <FighterStatus fighter={duel.self} />}
                <div className="duel-title"><span className="duel-eyebrow">XRSPS</span><h1>Duel Arena</h1>
                    <span className="duel-location">{lobby ? "THE COURTYARD" : fighting ? "DUEL IN PROGRESS" : "ONE VERSUS ONE"}</span></div>
                {!lobby && <FighterStatus fighter={duel.opponent} opponent />}
            </header>
            {lobby && <LobbyControls duel={duel} action={action} pending={pending} openBank={() => setBank(true)}
                signOut={() => { setPending(true); setLogoutError(""); client.performLogout(); }} />}
            {duel.self && <DuelPublicChat playerName={duel.self.name} scope={lobby ? "lobby" : "arena"} />}
            {logoutError && <p className="duel-logout-error" role="alert">{logoutError}</p>}
            {duel.self && <DuelShop key={duel.self.name} playerName={duel.self.name} />}
            {bank && lobby && <WalletDialog duel={duel} action={action} pending={pending} close={() => setBank(false)} />}
            {duel.stake && ["staking", "review"].includes(duel.status) && <OfferDialog duel={duel} action={action} pending={pending} />}
            {duel.trade && <OfferDialog duel={duel} action={action} pending={pending} trading />}
            {duel.status === "countdown" && <div className="duel-countdown" role="status">
                <span>GET READY</span><strong>{Math.max(1, Math.ceil(duel.countdownTicks * .6))}</strong></div>}
            {finished && <div className="duel-result" role="status"><span className="duel-eyebrow">DUEL COMPLETE</span>
                <h2>{duel.winnerId === null ? "Duel cancelled" : duel.winnerId === duel.self?.id ? "Victory" : "Defeated"}</h2>
                <p>{duel.message}</p><button onClick={() => action("leave")} disabled={pending}>Return to courtyard</button></div>}
            {!lobby && <footer className="duel-bottom">
                {!finished && <p className="duel-match-message" role="status">{duel.message}</p>}
                <div className="duel-controls">
                    <div className="duel-locked-weapon"><span className="duel-weapon-symbol" aria-hidden="true">{isDagger ? "†" : "∿"}</span>
                        <span>{isDagger ? "Dragon dagger P++" : "Abyssal whip"}<small>WEAPON LOCKED FOR THIS DUEL</small></span></div>
                    {fighting && <><button className="duel-primary duel-fight-button" disabled={pending} onClick={() => action("attack")}>Attack</button>
                        <button className="duel-special" disabled={pending || (duel.self?.specialEnergy ?? 0) < specialCost} onClick={() => action("special")}>
                            Special attack <small>{duel.self?.specialEnergy ?? 0}% · {specialCost}% required</small></button></>}
                </div>
                <div className="duel-bottom-meta"><span>{fighting ? "Click the sand to move · Click your opponent to attack" : "Both fighters use the agreed weapon"}</span>
                    {!finished && <button disabled={pending} onClick={() => action("leave")}>{fighting ? "Forfeit duel" : "Cancel duel"}</button>}</div>
            </footer>}
        </>}
    </div></CurrencyIconContext.Provider>;
}
