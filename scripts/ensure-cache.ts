import fs from "fs";
import path from "path";

import AdmZip from "adm-zip";

const OPENRS2_API = "https://archive.openrs2.org";
const CACHES_DIR = "caches";
const TARGET_FILE = "target.txt";
const LOCK_FILE = "caches/.cache-download.lock";
const LOCK_POLL_MS = 1000;
const LOCK_STALE_MS = 10 * 60 * 1000;

type OpenRS2CacheEntry = {
    id: number;
    scope: string;
    game: string;
    environment: string;
    language: string;
    builds: Array<{ major: number; minor: number | null }>;
    timestamp: string;
    sources: string[];
    valid_indexes: number;
    indexes: number;
    valid_groups: number;
    groups: number;
    valid_keys: number;
    keys: number;
    size: number;
};

function acquireLock(): boolean {
    const lockPath = path.resolve(LOCK_FILE);
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });

    if (fs.existsSync(lockPath)) {
        try {
            const stat = fs.statSync(lockPath);
            if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
                console.log("[CacheDownloader] Removing stale lock file");
                fs.unlinkSync(lockPath);
            }
        } catch {}
    }

    try {
        fs.writeFileSync(lockPath, `${process.pid}`, { flag: "wx" });
        return true;
    } catch {
        return false;
    }
}

function releaseLock(): void {
    try {
        fs.unlinkSync(path.resolve(LOCK_FILE));
    } catch {}
}

async function waitForLock(): Promise<void> {
    const lockPath = path.resolve(LOCK_FILE);
    console.log("[CacheDownloader] Another process is downloading the cache, waiting...");
    while (fs.existsSync(lockPath)) {
        try {
            const stat = fs.statSync(lockPath);
            if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
                console.log("[CacheDownloader] Lock appears stale, removing");
                fs.unlinkSync(lockPath);
                break;
            }
        } catch {
            break;
        }
        await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
    }
}

function readTarget(): string {
    const targetPath = path.resolve(TARGET_FILE);
    if (!fs.existsSync(targetPath)) {
        throw new Error(`${TARGET_FILE} not found at ${targetPath}`);
    }
    return fs.readFileSync(targetPath, "utf8").trim();
}

function parseTargetName(target: string): { revision: number; date: string } {
    const match = target.match(/^osrs-(\d+)_(\d{4}-\d{2}-\d{2})$/);
    if (!match) {
        throw new Error(`Invalid target format: "${target}" (expected osrs-{revision}_{date})`);
    }
    return { revision: parseInt(match[1], 10), date: match[2] };
}

function isCacheValid(cacheDir: string): boolean {
    const required = ["main_file_cache.dat2", "main_file_cache.idx255", "info.json", "keys.json"];
    return required.every((f) => fs.existsSync(path.join(cacheDir, f)));
}

function renderProgressBar(current: number, total: number, width = 40): string {
    const ratio = Math.min(current / total, 1);
    const filled = Math.round(width * ratio);
    const empty = width - filled;
    const bar = "\u2588".repeat(filled) + "\u2591".repeat(empty);
    const pct = (ratio * 100).toFixed(1).padStart(5);
    const currentMB = (current / (1024 * 1024)).toFixed(1);
    const totalMB = (total / (1024 * 1024)).toFixed(1);
    return `  [${bar}] ${pct}% (${currentMB}/${totalMB} MB)`;
}

async function findCacheOnOpenRS2(
    revision: number,
    date: string,
): Promise<OpenRS2CacheEntry | undefined> {
    console.log("[CacheDownloader] Fetching cache index from OpenRS2...");
    const resp = await fetch(`${OPENRS2_API}/caches.json`);
    if (!resp.ok) {
        throw new Error(`Failed to fetch OpenRS2 cache index: ${resp.status} ${resp.statusText}`);
    }
    const caches: OpenRS2CacheEntry[] = await resp.json();

    const match = caches.find(
        (c) =>
            c.scope === "runescape" &&
            c.game === "oldschool" &&
            c.language === "en" &&
            c.builds.length > 0 &&
            c.builds[0].major === revision &&
            c.timestamp?.startsWith(date),
    );

    if (match) return match;

    const revisionMatches = caches
        .filter(
            (c) =>
                c.scope === "runescape" &&
                c.game === "oldschool" &&
                c.language === "en" &&
                c.builds.length > 0 &&
                c.builds[0].major === revision &&
                c.timestamp,
        )
        .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));

    return revisionMatches[0];
}

async function downloadWithProgress(url: string, label: string): Promise<Buffer> {
    const resp = await fetch(url);
    if (!resp.ok) {
        throw new Error(`Download failed: ${resp.status} ${resp.statusText} (${url})`);
    }

    const contentLength = parseInt(resp.headers.get("content-length") ?? "0", 10);
    if (!resp.body || contentLength === 0) {
        const arrayBuf = await resp.arrayBuffer();
        return Buffer.from(arrayBuf);
    }

    const reader = resp.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;

    process.stdout.write(`  ${label}\n`);

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        process.stdout.write(`\r${renderProgressBar(received, contentLength)}`);
    }
    process.stdout.write("\n");

    return Buffer.concat(chunks);
}

async function downloadCache(entry: OpenRS2CacheEntry, cacheDir: string): Promise<void> {
    fs.mkdirSync(cacheDir, { recursive: true });

    console.log(`[CacheDownloader] Downloading cache files (id=${entry.id})...`);
    const zipBuffer = await downloadWithProgress(
        `${OPENRS2_API}/caches/${entry.scope}/${entry.id}/disk.zip`,
        "Downloading cache archive...",
    );

    console.log("[CacheDownloader] Extracting cache files...");
    const zip = new AdmZip(zipBuffer);
    zip.extractEntryTo("cache/", cacheDir, false, true);

    console.log("[CacheDownloader] Downloading XTEA keys...");
    const keysResp = await fetch(`${OPENRS2_API}/caches/${entry.scope}/${entry.id}/keys.json`);
    let xteas: Record<string, number[]> = {};
    if (keysResp.ok) {
        const keys: Array<{ group: number; key: number[] }> = await keysResp.json();
        for (const k of keys) {
            xteas[k.group.toString()] = k.key;
        }
    }

    fs.writeFileSync(path.join(cacheDir, "keys.json"), JSON.stringify(xteas), "utf8");
    fs.writeFileSync(path.join(cacheDir, "info.json"), JSON.stringify(entry), "utf8");
}

function writeCachesJson(target: string, entry: OpenRS2CacheEntry): void {
    const cachesJsonPath = path.resolve(CACHES_DIR, "caches.json");
    const cacheEntry = {
        name: target,
        game: entry.game,
        environment: entry.environment,
        revision: entry.builds[0].major,
        timestamp: entry.timestamp,
        size: entry.size ?? 0,
    };

    fs.writeFileSync(cachesJsonPath, JSON.stringify([cacheEntry]), "utf8");
}

async function ensureCache(): Promise<void> {
    const target = readTarget();
    const { revision, date } = parseTargetName(target);
    const cacheDir = path.resolve(CACHES_DIR, target);

    console.log(`[CacheDownloader] Target cache: "${target}" (rev ${revision})`);

    if (isCacheValid(cacheDir)) {
        console.log("[CacheDownloader] Cache is present and valid");
        return;
    }

    if (!acquireLock()) {
        await waitForLock();
        if (isCacheValid(cacheDir)) {
            console.log("[CacheDownloader] Cache is now available (downloaded by another process)");
            return;
        }
        if (!acquireLock()) {
            throw new Error("Failed to acquire cache download lock after waiting");
        }
    }

    try {
        const cachesRoot = path.resolve(CACHES_DIR);
        if (fs.existsSync(cachesRoot)) {
            console.log("[CacheDownloader] Clearing caches/ directory...");
            const lockPath = path.resolve(LOCK_FILE);
            const entries = fs.readdirSync(cachesRoot);
            for (const e of entries) {
                const fullPath = path.join(cachesRoot, e);
                if (fullPath === lockPath) continue;
                fs.rmSync(fullPath, { recursive: true, force: true });
            }
        }

        console.log("[CacheDownloader] Cache missing or incomplete, searching OpenRS2...");

        const entry = await findCacheOnOpenRS2(revision, date);
        if (!entry) {
            throw new Error(
                `Could not find cache for revision ${revision} (date=${date}) on OpenRS2 archive`,
            );
        }

        console.log(
            `[CacheDownloader] Found cache id=${entry.id} (rev ${entry.builds[0].major}, ${entry.timestamp})`,
        );

        fs.mkdirSync(CACHES_DIR, { recursive: true });
        await downloadCache(entry, cacheDir);
        writeCachesJson(target, entry);

        if (!isCacheValid(cacheDir)) {
            throw new Error("Cache download completed but validation failed");
        }

        console.log("[CacheDownloader] Cache downloaded and validated successfully");
    } finally {
        releaseLock();
    }
}

ensureCache()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error("[CacheDownloader] Fatal:", err);
        process.exit(1);
    });
