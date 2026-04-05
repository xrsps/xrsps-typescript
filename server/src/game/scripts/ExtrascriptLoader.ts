import fs from "fs";
import path from "path";

import type { IScriptRegistry, ScriptServices } from "./types";

export interface ExtrascriptEntry {
    id: string;
    register: (registry: IScriptRegistry, services: ScriptServices) => void;
    watch?: string[];
}

const EXTRASCRIPTS_DIR = path.resolve(__dirname, "../../../../server/extrascripts");

export function loadExtrascriptEntries(): ExtrascriptEntry[] {
    if (!fs.existsSync(EXTRASCRIPTS_DIR)) return [];

    const entries: ExtrascriptEntry[] = [];
    let dirs: string[];
    try {
        dirs = fs.readdirSync(EXTRASCRIPTS_DIR);
    } catch {
        return [];
    }

    for (const name of dirs) {
        const dir = path.resolve(EXTRASCRIPTS_DIR, name);
        try {
            if (!fs.statSync(dir).isDirectory()) continue;
        } catch {
            continue;
        }
        const indexPath = path.resolve(dir, "index");
        const hasTsIndex = fs.existsSync(path.resolve(dir, "index.ts"));
        const hasJsIndex = fs.existsSync(path.resolve(dir, "index.js"));
        if (!hasTsIndex && !hasJsIndex) continue;

        entries.push({
            id: `extrascript.${name}`,
            register: (registry, services) => {
                delete require.cache[require.resolve(indexPath)];
                const mod = require(indexPath);
                if (typeof mod.register === "function") {
                    mod.register(registry, services);
                }
            },
            watch: hasTsIndex
                ? [path.resolve(dir, "index.ts")]
                : [path.resolve(dir, "index.js")],
        });
    }

    if (entries.length > 0) {
        console.log(
            `[extrascripts] discovered ${entries.length}: ${entries.map((e) => e.id).join(", ")}`,
        );
    }

    return entries;
}
