import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { DuelLobbyPlayer, DuelSnapshot, DUEL_WEAPONS } from "../../common/duel/DuelProtocol";
import { duelInteractionStore } from "../../game/duel/DuelInteractionStore";
import { CurrencySummary } from "./CurrencyOffer";
import { DuelModal } from "./DuelModal";
import { duelShopStore } from "../../game/duel/DuelShopStore";

export function LobbyControls({ duel, action, pending, openBank, signOut }: {
    duel: DuelSnapshot; action: (command: string) => void; pending: boolean; openBank: () => void; signOut: () => void;
}) {
    const menu = useSyncExternalStore(duelInteractionStore.subscribe, duelInteractionStore.getSnapshot);
    const [challenge, setChallenge] = useState<DuelLobbyPlayer | null>(null);
    const [weapon, setWeapon] = useState<"dagger" | "whip">("dagger");
    const [showPlayers, setShowPlayers] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    const busy = duel.status !== "idle" || !!duel.trade;
    useEffect(() => {
        if (!menu) return;
        const close = (e: PointerEvent) => { if (!menuRef.current?.contains(e.target as Node)) duelInteractionStore.close(); };
        document.addEventListener("pointerdown", close);
        menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
        return () => document.removeEventListener("pointerdown", close);
    }, [menu]);
    useEffect(() => { if (busy) { setChallenge(null); duelInteractionStore.close(); } }, [busy]);
    useEffect(() => () => duelInteractionStore.close(), []);
    const others = duel.lobbyPlayers.filter(p => p.id !== duel.self?.id);
    function choose(player: DuelLobbyPlayer) { setChallenge(player); duelInteractionStore.close(); setShowPlayers(false); }
    return <>
        <aside className="duel-lobby-card">
            <span className="duel-eyebrow">WELCOME, {duel.self?.name}</span>
            <CurrencySummary offer={duel.wallet.inventory} />
            <div className="duel-lobby-tools"><button disabled={busy || pending} onClick={openBank}>Bank & inventory</button>
                <button aria-expanded={showPlayers} onClick={() => setShowPlayers(!showPlayers)}>Players · {duel.lobbyPlayers.length}</button></div>
            {showPlayers && <div className="duel-player-list" aria-label="Lobby players">
                {!others.length && <p>No other players yet. Invite a friend to the lobby.</p>}
                {others.map(p => <div key={p.id}><span>{p.name}</span>
                    <button disabled={busy || pending} onClick={() => choose(p)}>Challenge</button>
                    <button disabled={busy || pending} onClick={() => action(`trade_request ${p.id}`)}>Trade</button></div>)}
            </div>}
        </aside>
        {!busy && <aside className="duel-requests" aria-label="Incoming requests">
            {duel.requests.map(r => <div className="duel-request" key={r.id}>
                <span className="duel-eyebrow">DUEL CHALLENGE</span><p><strong>{r.fromName}</strong> wishes to duel with you.</p>
                <small>{r.weaponId === DUEL_WEAPONS.dagger ? "Dragon dagger P++" : "Abyssal whip"} · {Math.ceil(r.expiresInTicks * .6)}s</small>
                <div><button disabled={pending} className="duel-primary" onClick={() => action(`respond ${r.id} accept`)}>Accept challenge</button>
                    <button disabled={pending} onClick={() => action(`respond ${r.id} decline`)}>Decline</button></div>
            </div>)}
            {duel.tradeRequests.map(r => <div className="duel-request" key={r.id}>
                <span className="duel-eyebrow">TRADE REQUEST</span><p><strong>{r.fromName}</strong> wishes to trade.</p>
                <small>Expires in {Math.ceil(r.expiresInTicks * .6)}s</small>
                <div><button disabled={pending} className="duel-primary" onClick={() => action(`trade_accept ${r.id}`)}>Accept trade</button>
                    <button disabled={pending} onClick={() => action(`trade_decline ${r.id}`)}>Decline</button></div>
            </div>)}
        </aside>}
        <footer className="duel-lobby-footer"><div><p role="status">{duel.message}</p>
            <span>Click the sand to walk · Right-click a player to challenge or trade</span></div><button onClick={signOut} disabled={pending || busy}>Sign out</button></footer>
        {menu && !busy && <div className="duel-player-menu" ref={menuRef} role="menu" aria-label="Choose option"
            onKeyDown={e => {
                if (e.key === "Escape") { e.preventDefault(); duelInteractionStore.close(); return; }
                if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
                e.preventDefault();
                const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
                if (!buttons.length) return;
                const selected = Math.max(0, buttons.indexOf(document.activeElement as HTMLButtonElement));
                const next = e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1 :
                    (selected + (e.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length;
                buttons[next].focus();
            }}
            style={{ left: Math.max(8, Math.min(menu.x, window.innerWidth - 260)), top: Math.max(8, Math.min(menu.y, window.innerHeight - 200)) }}>
            <p>Choose option</p>{menu.players.map(p => <div key={p.id}>
                <button role="menuitem" onClick={() => choose(p)}>Challenge <strong>{p.name}</strong></button>
                <button role="menuitem" onClick={() => { action(`trade_request ${p.id}`); duelInteractionStore.close(); }}>Trade with <strong>{p.name}</strong></button>
            </div>)}{menu.shopkeeper && <button role="menuitem" onClick={() => {
                duelInteractionStore.close(); duelShopStore.open();
            }}>Talk-to <strong>{menu.shopkeeper}</strong></button>}
            <button role="menuitem" onClick={duelInteractionStore.close}>Cancel</button>
        </div>}
        {challenge && !busy && <DuelModal title={`Challenge ${challenge.name}`} onClose={() => setChallenge(null)}>
            <p>Choose one weapon for both fighters.</p>
            <div className="duel-challenge-weapons" role="group" aria-label="Duel weapon">
                <button aria-pressed={weapon === "dagger"} onClick={() => setWeapon("dagger")}><span aria-hidden="true">†</span><strong>Dragon dagger P++</strong><small>Poison · Double strike</small></button>
                <button aria-pressed={weapon === "whip"} onClick={() => setWeapon("whip")}><span aria-hidden="true">∿</span><strong>Abyssal whip</strong><small>Fast slash attacks</small></button>
            </div>
            <p className="duel-fine">The weapon stays locked for the whole duel. You’ll agree the stakes after they accept.</p>
            <button className="duel-primary duel-wide-button" disabled={pending} onClick={() => { action(`challenge ${challenge.id} ${weapon}`); setChallenge(null); }}>Send challenge</button>
        </DuelModal>}
    </>;
}
