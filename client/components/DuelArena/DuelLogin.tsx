import { FormEvent, useState } from "react";

import { sendLogin } from "../../network/ServerConnection";
import { OsrsClient } from "../../game/OsrsClient";
import { GameState } from "../../game/login/GameState";

export function DuelLogin({ client, gameState }: { client: OsrsClient; gameState: GameState }) {
    const [name, setName] = useState(client.loginState.username);
    const [password, setPassword] = useState("");
    const [submitted, setSubmitted] = useState(false);
    const canLogin = gameState === GameState.LOGIN_SCREEN;
    const loading = gameState === GameState.DOWNLOADING || gameState === GameState.LOADING;
    const response = submitted && canLogin
        ? [client.loginState.response1, client.loginState.response2, client.loginState.response3]
              .filter(Boolean).join(" ").replace(/<[^>]*>/g, "")
        : "";

    function enter(event: FormEvent) {
        event.preventDefault();
        if (!canLogin) return;
        client.loginState.username = name.trim();
        client.loginState.password = password;
        setSubmitted(true);
        if (!client.loginState.canAttemptLogin()) {
            client.loginState.showCredentialValidationError();
            return;
        }
        client.updateGameState(GameState.CONNECTING);
        sendLogin(name.trim(), password, client.loadedCache?.info?.revision ?? 0);
        setPassword("");
    }

    return (
        <div className="duel-entry">
            <div className="duel-entry-mark" aria-hidden="true">✦</div>
            <p className="duel-eyebrow">XRSPS · ONE VERSUS ONE</p>
            <h1>Duel Arena</h1>
            <p className="duel-intro">Two fighters. One arena.</p>
            <form className="duel-panel duel-login" onSubmit={enter}>
                <label htmlFor="duel-name">Player name</label>
                <input id="duel-name" autoComplete="username" required maxLength={12}
                    pattern="[a-zA-Z0-9 _\-]+" value={name}
                    onChange={(event) => setName(event.target.value)} placeholder="Your name" />
                <label htmlFor="duel-password">Password</label>
                <input id="duel-password" type="password" autoComplete="current-password"
                    required minLength={8} maxLength={20} value={password}
                    onChange={(event) => setPassword(event.target.value)} placeholder="8–20 characters" />
                <button className="duel-primary" disabled={!canLogin} type="submit">
                    {canLogin ? "Enter the arena" : loading ? "Loading the arena…" : "Connecting…"}
                </button>
                {response && <p role="alert" className="duel-notice">{response}</p>}
                <p className="duel-fine">New here? Your first login creates your player with 1,000,000 gold.</p>
            </form>
            <p className="duel-entry-footer">DRAGON DAGGER P++ <span>·</span> ABYSSAL WHIP</p>
        </div>
    );
}
