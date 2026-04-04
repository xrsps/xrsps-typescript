import fs from "fs";
import path from "path";

import type { ScriptManifestEntry } from "./manifest";
import type { ScriptModule } from "./types";

const EXTRASCRIPTS_DIR = path.resolve(__dirname, "../../../../server/extrascripts");

export function loadExtrascriptEntries(): ScriptManifestEntry[] {
    if (!fs.existsSync(EXTRASCRIPTS_DIR)) return [];

    const entries: ScriptManifestEntry[] = [];
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
            load: (): ScriptModule => {
                delete require.cache[require.resolve(indexPath)];
                const mod = require(indexPath);
                return mod.module as ScriptModule;
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
