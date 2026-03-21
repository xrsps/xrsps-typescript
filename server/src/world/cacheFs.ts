import fs from "fs";
import path from "path";

export type CacheFolderSpec = {
    rootDir: string; // absolute or relative to repo root
    name: string; // e.g., osrs-232_2025-08-27
};

export function readFileAsArrayBuffer(filePath: string): ArrayBuffer {
    const buf = fs.readFileSync(filePath);
    const bytes = new Uint8Array(buf.byteLength);
    bytes.set(buf);
    return bytes.buffer;
}

export function loadDat2CacheFiles(spec: CacheFolderSpec): Map<string, ArrayBuffer> {
    const folder = path.resolve(spec.rootDir, spec.name);
    const files = new Map<string, ArrayBuffer>();
    const requireFiles = ["main_file_cache.dat2", "main_file_cache.idx255"];
    // Add all idx files present
    const dirEntries = fs.readdirSync(folder);
    for (const e of dirEntries) {
        if (e.startsWith("main_file_cache.idx") || requireFiles.includes(e)) {
            const ab = readFileAsArrayBuffer(path.join(folder, e));
            files.set(e, ab);
        }
    }
    // Validate core
    for (const name of requireFiles) {
        if (!files.has(name)) throw new Error(`Missing cache file: ${name}`);
    }
    return files;
}

export function readJson<T = any>(filePath: string): T {
    const text = fs.readFileSync(filePath, "utf8");
    return JSON.parse(text) as T;
}
