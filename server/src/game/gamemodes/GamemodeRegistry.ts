import fs from "fs";
import path from "path";

import type { GamemodeDefinition } from "./GamemodeDefinition";

const GAMEMODES_DIR = path.resolve(__dirname, "../../../gamemodes");
const DATA_DIR = path.resolve(__dirname, "../../../data/gamemodes");

export function createGamemode(id: string): GamemodeDefinition {
    const gamemodeDir = path.resolve(GAMEMODES_DIR, id);
    if (!fs.existsSync(gamemodeDir) || !fs.statSync(gamemodeDir).isDirectory()) {
        const available = listAvailableGamemodes().join(", ");
        throw new Error(`Unknown gamemode "${id}". Available: ${available}`);
    }
    const modulePath = path.resolve(gamemodeDir, "index");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(modulePath);
    if (typeof mod.createGamemode !== "function") {
        throw new Error(
            `Gamemode "${id}" does not export a createGamemode() function from its index`,
        );
    }
    return mod.createGamemode() as GamemodeDefinition;
}

export function getGamemodeDataDir(id: string): string {
    return path.resolve(DATA_DIR, id);
}

export function listAvailableGamemodes(): string[] {
    try {
        return fs
            .readdirSync(GAMEMODES_DIR)
            .filter((entry) => {
                const full = path.resolve(GAMEMODES_DIR, entry);
                return (
                    fs.statSync(full).isDirectory() &&
                    fs.existsSync(path.resolve(full, "index.ts")) ||
                    fs.existsSync(path.resolve(full, "index.js"))
                );
            });
    } catch {
        return [];
    }
}
