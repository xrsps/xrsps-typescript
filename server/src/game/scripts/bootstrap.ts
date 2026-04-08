import fs from "fs";
import path from "path";

import { logger } from "../../utils/logger";

import type { GamemodeDefinition } from "../gamemodes/GamemodeDefinition";
import { loadExtrascriptEntries } from "./ExtrascriptLoader";
import { ScriptRuntime } from "./ScriptRuntime";
const EXTRASCRIPTS_DIR = path.resolve(__dirname, "../../../../server/extrascripts");

const debounce = (fn: () => void, delayMs: number): (() => void) => {
    let timeout: NodeJS.Timeout | undefined;
    return () => {
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(() => {
            timeout = undefined;
            fn();
        }, delayMs);
    };
};

function invalidateRequireCache(filePath: string): void {
    try {
        delete require.cache[require.resolve(filePath)];
    } catch (err) { logger.warn("[bootstrap] failed to invalidate require cache", err); }
}

export function bootstrapScripts(runtime: ScriptRuntime, gamemode?: GamemodeDefinition): void {
    const loadAll = () => {
        const extrascriptEntries = loadExtrascriptEntries();
        runtime.reset();

        if (gamemode?.registerHandlers) {
            try {
                runtime.registerHandlers(`gamemode.${gamemode.id}`, (registry, services) =>
                    gamemode.registerHandlers(registry, services),
                );
            } catch (err) {
                logger.error(`[script] failed gamemode registerHandlers for ${gamemode.id}`, err);
            }
        }

        for (const entry of extrascriptEntries) {
            if (entry.watch) {
                for (const watchTarget of entry.watch) {
                    invalidateRequireCache(watchTarget);
                }
            }
            try {
                runtime.registerHandlers(entry.id, entry.register);
            } catch (err) {
                logger.error(`[script] failed to load extrascript ${entry.id}`, err);
            }
        }
    };

    loadAll();

    if (process.env.SCRIPT_HOT_RELOAD === "1") {
        const reload = debounce(() => {
            loadAll();
        }, 100);

        try {
            if (fs.existsSync(EXTRASCRIPTS_DIR)) {
                fs.watch(EXTRASCRIPTS_DIR, { persistent: false, recursive: true }, reload);
            }
        } catch (err) {
            logger.info("[script] failed to watch extrascripts directory", err);
        }
    }
}
