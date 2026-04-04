import fs from "fs";
import path from "path";

import type { GamemodeDefinition } from "../gamemodes/GamemodeDefinition";
import { ScriptRuntime } from "./ScriptRuntime";
import type { ScriptManifestEntry } from "./manifest";

const MANIFEST_PATH = path.resolve(__dirname, "manifest");
const MODULES_DIR = path.resolve(__dirname, "modules");

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

function loadManifestEntries(): ScriptManifestEntry[] {
    delete require.cache[require.resolve(MANIFEST_PATH)];
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const manifestModule = require(MANIFEST_PATH);
    const entries: ScriptManifestEntry[] = manifestModule.SCRIPT_MANIFEST ?? [];
    return entries.filter((entry) => (entry.enableWhen ? entry.enableWhen(process.env) : true));
}

function invalidateRequireCache(filePath: string): void {
    try {
        delete require.cache[require.resolve(filePath)];
    } catch {}
}

export function bootstrapScripts(runtime: ScriptRuntime, gamemode?: GamemodeDefinition): void {
    const loadAll = () => {
        const coreEntries = loadManifestEntries();
        const gamemodeEntries = gamemode?.getScriptManifest() ?? [];
        const entries = [...coreEntries, ...gamemodeEntries];
        runtime.reset();
        for (const entry of entries) {
            if (entry.watch) {
                for (const watchTarget of entry.watch) {
                    invalidateRequireCache(watchTarget);
                }
            }
            try {
                runtime.loadModule(entry.load());
            } catch (err) {
                // eslint-disable-next-line no-console
                console.error(`[script] failed to load module ${entry.id}`, err);
            }
        }
    };

    loadAll();

    if (process.env.SCRIPT_HOT_RELOAD === "1") {
        const reload = debounce(() => {
            invalidateRequireCache(MANIFEST_PATH);
            loadAll();
        }, 100);

        try {
            fs.watch(MODULES_DIR, { persistent: false }, reload);
        } catch (err) {
            console.warn?.("[script] failed to watch modules directory", err);
        }

        try {
            fs.watch(`${MANIFEST_PATH}.ts`, { persistent: false }, reload);
        } catch {}
        try {
            fs.watch(`${MANIFEST_PATH}.js`, { persistent: false }, reload);
        } catch {}
    }
}
