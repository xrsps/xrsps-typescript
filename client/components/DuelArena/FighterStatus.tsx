import type { DuelParticipant } from "../../common/duel/DuelProtocol";

export function FighterStatus({ fighter, opponent = false }: {
    fighter: DuelParticipant | null; opponent?: boolean;
}) {
    const health = fighter ? Math.max(0, Math.min(100, fighter.hp / fighter.maxHp * 100)) : 100;
    return (
        <section className={`duel-fighter ${opponent ? "duel-fighter-opponent" : ""}`}
            aria-label={opponent ? "Opponent" : "Your fighter"}>
            <div className="duel-fighter-line">
                <span className="duel-fighter-tag">{opponent ? "OPPONENT" : "YOU"}</span>
                <span className="duel-hp">{fighter ? `${fighter.hp} / ${fighter.maxHp}` : "—"}</span>
            </div>
            <strong>{fighter?.name ?? "Waiting for opponent"}</strong>
            <div className="duel-health" role="progressbar" aria-label="Hitpoints"
                aria-valuemin={0} aria-valuemax={fighter?.maxHp ?? 99} aria-valuenow={fighter?.hp ?? 0}>
                <div style={{ width: fighter ? `${health}%` : "0%" }} />
            </div>
            <span className="duel-fighter-weapon">
                {fighter ? fighter.weaponId === 5698 ? "Dragon dagger P++" : "Abyssal whip" : "Share your room code to invite a friend"}
            </span>
        </section>
    );
}
