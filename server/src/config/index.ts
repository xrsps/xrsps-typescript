import { readFileSync } from "fs";
import { resolve } from "path";

export interface ServerConfig {
    host: string;
    port: number;
    tickMs: number;
    serverName: string;
    maxPlayers: number;
    gamemode: string;
}

const portEnv = process.env.PORT?.trim();
const tickMsEnv = process.env.TICK_MS?.trim();

let serverName = "Local Development";
let maxPlayers = 2047;
let gamemode = "leagues-v";
try {
    const raw = readFileSync(resolve(__dirname, "../../config.json"), "utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed.serverName === "string") serverName = parsed.serverName;
    if (typeof parsed.maxPlayers === "number") maxPlayers = parsed.maxPlayers;
    if (typeof parsed.gamemode === "string") gamemode = parsed.gamemode;
} catch {}

export const config: ServerConfig = {
    // Bind all interfaces by default so LAN/mobile clients can reach the WS server.
    host: process.env.HOST || "0.0.0.0",
    port: portEnv ? parseInt(portEnv, 10) || 43594 : 43594, // classic RuneScape default port
    tickMs: tickMsEnv ? parseInt(tickMsEnv, 10) || 600 : 600, // 0.6s tick
    serverName,
    maxPlayers,
    gamemode: process.env.GAMEMODE || gamemode,
};
