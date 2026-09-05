import fs from "fs";
import type { IncomingMessage, ServerResponse } from "http";
import path from "path";

import { logger } from "../utils/logger";

/**
 * Serves the OSRS cache (`server/caches/`) over the game server's own HTTP
 * listener so a single hostname provides both `wss://` and `/caches/*`.
 *
 * The browser client loads the cache sparsely with HTTP Range requests into
 * `main_file_cache.dat2`, so this handler implements single-range `206`
 * responses plus the CORS/CORP headers a cross-origin, cross-origin-isolated
 * (COEP: require-corp) client on another domain (e.g. Vercel) needs.
 */

export type CacheHttpHandlerOptions = {
    /** Absolute path to the directory holding `caches.json` + cache folders. */
    cachesDir: string;
    /** URL prefix, default `/caches/`. */
    urlPrefix?: string;
    /** Value for `Access-Control-Allow-Origin`, default `*`. */
    allowOrigin?: string;
};

export type HttpRequestHandler = (req: IncomingMessage, res: ServerResponse) => boolean;

const FILE_ALLOWLIST = /^(caches\.json|info\.json|keys\.json|main_file_cache\.(dat2|idx\d{1,3}))$/;
const CACHE_DIR_NAME = /^[A-Za-z0-9._-]+$/;

function contentTypeFor(fileName: string): string {
    return fileName.endsWith(".json") ? "application/json" : "application/octet-stream";
}

function corsHeaders(allowOrigin: string): Record<string, string> {
    return {
        "Access-Control-Allow-Origin": allowOrigin,
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "Range, If-None-Match, If-Modified-Since, Content-Type",
        "Access-Control-Expose-Headers":
            "Content-Range, Content-Length, Accept-Ranges, ETag, Last-Modified",
        "Access-Control-Max-Age": "86400",
        // Required for fetches from a COEP `require-corp` document on another origin.
        "Cross-Origin-Resource-Policy": "cross-origin",
    };
}

type ByteRange = { start: number; end: number } | "unsatisfiable" | undefined;

/** Parse a single `bytes=start-end` range (multi-range requests are served in full). */
function parseRange(header: string | undefined, size: number): ByteRange {
    if (!header) return undefined;
    const match = header.trim().match(/^bytes=(\d*)-(\d*)$/i);
    if (!match) return undefined;
    const [, startRaw, endRaw] = match;
    if (startRaw === "" && endRaw === "") return undefined;
    let start: number;
    let end: number;
    if (startRaw === "") {
        // Suffix range: last N bytes.
        const suffix = Number(endRaw);
        if (!Number.isSafeInteger(suffix) || suffix <= 0) return "unsatisfiable";
        start = Math.max(0, size - suffix);
        end = size - 1;
    } else {
        start = Number(startRaw);
        end = endRaw === "" ? size - 1 : Number(endRaw);
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return "unsatisfiable";
        if (end >= size) end = size - 1;
    }
    if (start < 0 || start >= size || end < start) return "unsatisfiable";
    return { start, end };
}

function resolveFile(
    cachesDir: string,
    urlPath: string,
): { filePath: string; fileName: string } | undefined {
    let decoded: string;
    try {
        decoded = decodeURIComponent(urlPath);
    } catch {
        return undefined;
    }
    const segments = decoded.split("/").filter((s) => s.length > 0);
    if (segments.length === 1 && segments[0] === "caches.json") {
        return { filePath: path.join(cachesDir, "caches.json"), fileName: "caches.json" };
    }
    if (segments.length !== 2) return undefined;
    const [dir, fileName] = segments;
    if (!CACHE_DIR_NAME.test(dir) || !FILE_ALLOWLIST.test(fileName) || fileName === "caches.json") {
        return undefined;
    }
    const filePath = path.resolve(cachesDir, dir, fileName);
    if (!filePath.startsWith(path.resolve(cachesDir) + path.sep)) return undefined;
    return { filePath, fileName };
}

export function createCacheHttpHandler(options: CacheHttpHandlerOptions): HttpRequestHandler {
    const cachesDir = path.resolve(options.cachesDir);
    const prefix = options.urlPrefix ?? "/caches/";
    const allowOrigin = options.allowOrigin ?? "*";
    const cors = corsHeaders(allowOrigin);

    logger.info(`[cache-http] serving ${cachesDir} at ${prefix} (origin=${allowOrigin})`);

    return (req, res) => {
        const rawUrl = req.url ?? "";
        const pathOnly = rawUrl.split("?")[0];
        if (!pathOnly.startsWith(prefix)) return false;

        const method = (req.method ?? "GET").toUpperCase();
        if (method === "OPTIONS") {
            res.writeHead(204, cors);
            res.end();
            return true;
        }
        if (method !== "GET" && method !== "HEAD") {
            res.writeHead(405, { ...cors, Allow: "GET, HEAD, OPTIONS" });
            res.end();
            return true;
        }

        const resolved = resolveFile(cachesDir, pathOnly.slice(prefix.length));
        if (!resolved) {
            res.writeHead(404, { ...cors, "Content-Type": "text/plain" });
            res.end("Not found");
            return true;
        }

        let stat: fs.Stats;
        try {
            stat = fs.statSync(resolved.filePath);
            if (!stat.isFile()) throw new Error("not a file");
        } catch {
            res.writeHead(404, { ...cors, "Content-Type": "text/plain" });
            res.end("Not found");
            return true;
        }

        const etag = `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
        const isJson = resolved.fileName.endsWith(".json");
        const baseHeaders: Record<string, string> = {
            ...cors,
            "Content-Type": contentTypeFor(resolved.fileName),
            "Accept-Ranges": "bytes",
            ETag: etag,
            "Last-Modified": stat.mtime.toUTCString(),
            // caches.json can change when the server switches cache revision;
            // everything else is addressed by cache name and is effectively immutable.
            "Cache-Control": isJson ? "public, max-age=300" : "public, max-age=86400",
        };

        if (req.headers["if-none-match"] === etag) {
            res.writeHead(304, baseHeaders);
            res.end();
            return true;
        }

        const rangeHeader = Array.isArray(req.headers.range)
            ? req.headers.range[0]
            : req.headers.range;
        const range = parseRange(rangeHeader, stat.size);

        if (range === "unsatisfiable") {
            res.writeHead(416, { ...baseHeaders, "Content-Range": `bytes */${stat.size}` });
            res.end();
            return true;
        }

        if (range) {
            const length = range.end - range.start + 1;
            res.writeHead(206, {
                ...baseHeaders,
                "Content-Range": `bytes ${range.start}-${range.end}/${stat.size}`,
                "Content-Length": String(length),
            });
            if (method === "HEAD") {
                res.end();
                return true;
            }
            fs.createReadStream(resolved.filePath, { start: range.start, end: range.end })
                .on("error", () => res.destroy())
                .pipe(res);
            return true;
        }

        res.writeHead(200, { ...baseHeaders, "Content-Length": String(stat.size) });
        if (method === "HEAD") {
            res.end();
            return true;
        }
        fs.createReadStream(resolved.filePath)
            .on("error", () => res.destroy())
            .pipe(res);
        return true;
    };
}
