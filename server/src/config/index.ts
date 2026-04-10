import { readFileSync } from "fs";
import { resolve } from "path";

import { logger } from "../utils/logger";

export interface ServerConfig {
    host: string;
    port: number;
    tickMs: number;
    serverName: string;
    maxPlayers: number;
    gamemode: string;
    /**
     * Path to the JSON file used by the default JsonAccountStore.
     * Defaults to `server/data/accounts.json` relative to server/src/config.
     */
    accountsFilePath: string;
    /** Minimum password length enforced at account creation. */
    minPasswordLength: number;
    /**
     * Origin header allowlist for WebSocket upgrade. Empty = allow all
     * (convenient for LAN/dev). Populate this for public deployments.
     */
    allowedOrigins: string[];
    /**
     * Bot-SDK endpoint configuration (first-class agent integration).
     *
     * The bot-SDK runs on its own port (distinct from the human-client
     * binary protocol on `port`) and speaks TOON. It is disabled unless
     * {@link botSdkToken} is set — this is deliberate: an unauthenticated
     * agent endpoint on a public host is a game-state-write vulnerability.
     */
    botSdkEnabled: boolean;
    /** Bind host for the bot-SDK. Defaults to 127.0.0.1 (localhost-only). */
    botSdkHost: string;
    /** TCP port for the bot-SDK. Defaults to 43595. */
    botSdkPort: number;
    /** Shared secret. Empty = endpoint disabled. */
    botSdkToken: string;
    /** Emit perception every N game ticks. Default 3. */
    botSdkPerceptionEveryNTicks: number;
}

const portEnv = process.env.PORT?.trim();
const tickMsEnv = process.env.TICK_MS?.trim();

let serverName = "Local Development";
let maxPlayers = 2047;
let gamemode = "vanilla";
let accountsFilePath = resolve(__dirname, "../../data/accounts.json");
let minPasswordLength = 8;
let allowedOrigins: string[] = [];
let botSdkHost = "127.0.0.1";
let botSdkPort = 43595;
let botSdkToken = "";
let botSdkPerceptionEveryNTicks = 3;
try {
    const raw = readFileSync(resolve(__dirname, "../../config.json"), "utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed.serverName === "string") serverName = parsed.serverName;
    if (typeof parsed.maxPlayers === "number") maxPlayers = parsed.maxPlayers;
    if (typeof parsed.gamemode === "string") gamemode = parsed.gamemode;
    if (typeof parsed.accountsFilePath === "string") {
        accountsFilePath = resolve(__dirname, "../../", parsed.accountsFilePath);
    }
    if (typeof parsed.minPasswordLength === "number") minPasswordLength = parsed.minPasswordLength;
    if (Array.isArray(parsed.allowedOrigins)) {
        allowedOrigins = parsed.allowedOrigins.filter((o: unknown): o is string => typeof o === "string");
    }
    if (typeof parsed.botSdkHost === "string") botSdkHost = parsed.botSdkHost;
    if (typeof parsed.botSdkPort === "number") botSdkPort = parsed.botSdkPort;
    if (typeof parsed.botSdkToken === "string") botSdkToken = parsed.botSdkToken;
    if (typeof parsed.botSdkPerceptionEveryNTicks === "number") {
        botSdkPerceptionEveryNTicks = parsed.botSdkPerceptionEveryNTicks;
    }
} catch (err) { logger.info("[config] failed to load config.json", err); }

// Env vars override config.json
if (process.env.ACCOUNTS_FILE_PATH?.trim()) {
    accountsFilePath = resolve(process.env.ACCOUNTS_FILE_PATH.trim());
}
if (process.env.AUTH_MIN_PASSWORD_LENGTH?.trim()) {
    const parsed = parseInt(process.env.AUTH_MIN_PASSWORD_LENGTH.trim(), 10);
    if (Number.isFinite(parsed) && parsed > 0) minPasswordLength = parsed;
}
if (process.env.ALLOWED_ORIGINS?.trim()) {
    allowedOrigins = process.env.ALLOWED_ORIGINS.split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
}
if (process.env.BOT_SDK_HOST?.trim()) botSdkHost = process.env.BOT_SDK_HOST.trim();
if (process.env.BOT_SDK_PORT?.trim()) {
    const parsed = parseInt(process.env.BOT_SDK_PORT.trim(), 10);
    if (Number.isFinite(parsed) && parsed > 0) botSdkPort = parsed;
}
if (process.env.BOT_SDK_TOKEN?.trim()) botSdkToken = process.env.BOT_SDK_TOKEN.trim();
if (process.env.BOT_SDK_PERCEPTION_EVERY_N_TICKS?.trim()) {
    const parsed = parseInt(process.env.BOT_SDK_PERCEPTION_EVERY_N_TICKS.trim(), 10);
    if (Number.isFinite(parsed) && parsed > 0) botSdkPerceptionEveryNTicks = parsed;
}

export const config: ServerConfig = {
    // Bind all interfaces by default so LAN/mobile clients can reach the WS server.
    host: process.env.HOST || "0.0.0.0",
    port: portEnv ? parseInt(portEnv, 10) || 43594 : 43594, // classic RuneScape default port
    tickMs: tickMsEnv ? parseInt(tickMsEnv, 10) || 600 : 600, // 0.6s tick
    serverName,
    maxPlayers,
    gamemode: process.env.GAMEMODE || gamemode,
    accountsFilePath,
    minPasswordLength,
    allowedOrigins,
    botSdkEnabled: botSdkToken.length > 0,
    botSdkHost,
    botSdkPort,
    botSdkToken,
    botSdkPerceptionEveryNTicks,
};
