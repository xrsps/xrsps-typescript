import fs from "fs";
import path from "path";

import { logger } from "../../utils/logger";
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

        // Load the module eagerly during discovery so we fail fast
        // on broken extrascripts rather than deferring errors to registration time.
        let mod: { register?: (registry: IScriptRegistry, services: ScriptServices) => void };
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            mod = require(indexPath);
        } catch (err) {
            logger.warn(`[extrascripts] failed to load ${name}`, err);
            continue;
        }

        if (typeof mod.register !== "function") {
            logger.warn(`[extrascripts] ${name}/index does not export a register() function — skipping`);
            continue;
        }

        const registerFn = mod.register;

        entries.push({
            id: `extrascript.${name}`,
            register: (registry, services) => registerFn(registry, services),
            watch: hasTsIndex
                ? [path.resolve(dir, "index.ts")]
                : [path.resolve(dir, "index.js")],
        });
    }

    if (entries.length > 0) {
        logger.info(
            `[extrascripts] discovered ${entries.length}: ${entries.map((e) => e.id).join(", ")}`,
        );
    }

    return entries;
}
