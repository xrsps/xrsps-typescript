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

    // Dynamic require is intentional — gamemodes are discovered at runtime by ID.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod: Record<string, unknown> = require(modulePath);

    if (typeof mod.createGamemode !== "function") {
        throw new Error(
            `Gamemode "${id}" does not export a createGamemode() function from its index`,
        );
    }

    const gamemode = (mod.createGamemode as () => GamemodeDefinition)();

    if (!gamemode.id || !gamemode.name) {
        throw new Error(
            `Gamemode "${id}" createGamemode() returned an object missing required 'id' or 'name' fields`,
        );
    }

    return gamemode;
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
                    (fs.existsSync(path.resolve(full, "index.ts")) ||
                    fs.existsSync(path.resolve(full, "index.js")))
                );
            });
    } catch {
        return [];
    }
}
