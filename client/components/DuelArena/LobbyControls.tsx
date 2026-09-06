import { useEffect, useState } from "react";
import { DuelLobbyPlayer, DuelSnapshot, DUEL_WEAPONS } from "../../common/duel/DuelProtocol";
import { duelInteractionStore } from "../../game/duel/DuelInteractionStore";
import { DuelModal } from "./DuelModal";
import { CacheItemIcon } from "./CurrencyIcon";

export function LobbyControls({ duel, action, pending }: {
    duel: DuelSnapshot; action: (command: string) => void; pending: boolean;
}) {
    const [challenge, setChallenge] = useState<DuelLobbyPlayer | null>(null);
    const [weapon, setWeapon] = useState<"dagger" | "whip">("dagger");
    const busy = duel.status !== "idle" || !!duel.trade;
    useEffect(() => duelInteractionStore.subscribeChallenge(player => {
        setWeapon("dagger");
        setChallenge(player);
    }), []);
    useEffect(() => { if (busy) setChallenge(null); }, [busy]);
    return <>
        {challenge && !busy && <DuelModal title={`Challenge ${challenge.name}`} onClose={() => setChallenge(null)}>
            <p>Choose one weapon for both fighters.</p>
            <div className="duel-challenge-weapons" role="group" aria-label="Duel weapon">
                <button aria-pressed={weapon === "dagger"} onClick={() => setWeapon("dagger")}><CacheItemIcon itemId={DUEL_WEAPONS.dagger} /><strong>Dragon dagger P++</strong><small>Poison · Double strike</small></button>
                <button aria-pressed={weapon === "whip"} onClick={() => setWeapon("whip")}><CacheItemIcon itemId={DUEL_WEAPONS.whip} /><strong>Abyssal whip</strong><small>Fast slash attacks</small></button>
            </div>
            <p className="duel-fine">The weapon stays locked for the whole duel. You’ll agree the stakes after they accept.</p>
            <button className="duel-primary duel-wide-button" disabled={pending} onClick={() => { action(`challenge ${challenge.id} ${weapon}`); setChallenge(null); }}>Send challenge</button>
        </DuelModal>}
    </>;
}
