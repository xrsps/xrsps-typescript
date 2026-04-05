import { VARBIT_ACCOUNT_TYPE } from "../../../src/shared/vars";
import type { GamemodeDefinition } from "../game/gamemodes/GamemodeDefinition";
import type { PlayerState } from "../game/player";
import { logger } from "../utils/logger";

const ADMIN_USERNAMES_ENV = (
    process?.env?.ADMIN_USERNAMES ??
    process?.env?.ADMIN_PLAYERS ??
    process?.env?.ADMIN_NAMES ??
    "lol,bot"
).toString();

const ADMIN_USERNAMES = new Set(
    ADMIN_USERNAMES_ENV.split(",")
        .map((value) => value.trim().toLowerCase())
        .filter((value) => value.length > 0),
);

export const ADMIN_CROWN_ICON = 1;

export interface PlayerLookup {
    hasConnectedPlayer(username: string): boolean;
    getTotalPlayerCount(): number;
}

/**
 * Handles login rate limiting, admin detection, and account type normalization.
 * Extracted from WSServer.
 */
export class AuthenticationService {
    private loginAttempts = new Map<string, { count: number; resetTime: number }>();
    private readonly MAX_LOGIN_ATTEMPTS = 5;
    private readonly LOGIN_ATTEMPT_WINDOW_MS = 60000;

    constructor(
        private readonly playerLookup: PlayerLookup,
        private readonly gamemode: GamemodeDefinition,
    ) {}

    checkLoginRateLimit(ip: string): boolean {
        const now = Date.now();
        const entry = this.loginAttempts.get(ip);

        if (!entry || now >= entry.resetTime) {
            this.loginAttempts.set(ip, {
                count: 1,
                resetTime: now + this.LOGIN_ATTEMPT_WINDOW_MS,
            });
            return false;
        }

        entry.count++;

        if (entry.count > this.MAX_LOGIN_ATTEMPTS) {
            return true;
        }

        return false;
    }

    isPlayerAlreadyLoggedIn(username: string): boolean {
        return this.playerLookup.hasConnectedPlayer(username);
    }

    isWorldFull(): boolean {
        return this.playerLookup.getTotalPlayerCount() >= 2047;
    }

    normalizePlayerNameForAuth(name: string | undefined): string {
        return (name ?? "").trim().toLowerCase();
    }

    isAdminPlayer(player: PlayerState | undefined): boolean {
        if (!player) return false;
        const normalizedName = this.normalizePlayerNameForAuth(player.name);
        if (normalizedName.length === 0) return false;
        return ADMIN_USERNAMES.has(normalizedName);
    }

    normalizeAccountType(value: number): number {
        const normalized = Number.isFinite(value) ? Math.floor(value) : 0;
        return normalized >= 0 && normalized <= 5 ? normalized : 0;
    }

    getPublicChatPlayerType(player: PlayerState): number {
        return this.gamemode.getChatPlayerType(player, this.isAdminPlayer(player));
    }

    syncAccountTypeVarbit(
        player: PlayerState,
        sendFn: (varbitId: number, value: number) => void,
    ): void {
        const raw = player.getVarbitValue(VARBIT_ACCOUNT_TYPE);
        const accountType = this.normalizeAccountType(raw);
        if (accountType !== raw) {
            player.setVarbitValue(VARBIT_ACCOUNT_TYPE, accountType);
        }
        sendFn(VARBIT_ACCOUNT_TYPE, accountType);
    }
}
