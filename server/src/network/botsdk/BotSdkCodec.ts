/**
 * TOON encode/decode adapter for bot-SDK frames.
 *
 * Wraps `@toon-format/toon` with thin helpers tailored to our wire format:
 *
 *   1. **Everything is a top-level object.** The TOON encoder produces the
 *      most compact output when it has a single root object with arrays
 *      inside. We don't ship raw arrays or primitives on the wire.
 *
 *   2. **Frame kind is the first key.** Decoders can cheaply peek at the
 *      `kind` field without parsing the whole payload.
 *
 *   3. **Errors are never thrown from hot paths.** Decode returns
 *      `{ok: false, error}` instead so the server never crashes on a
 *      malformed client frame.
 *
 * This module is *not* a general-purpose TOON utility; it's scoped to the
 * bot-SDK layer. If you need TOON encoding elsewhere, import
 * `@toon-format/toon` directly.
 */

import { decode, encode } from "@toon-format/toon";

import type { ClientFrame, ServerFrame } from "./BotSdkProtocol";

export interface CodecOk<T> {
    ok: true;
    value: T;
}

export interface CodecError {
    ok: false;
    error: string;
}

export type CodecResult<T> = CodecOk<T> | CodecError;

/**
 * Encode a server → client frame as a TOON string.
 * Never throws — TOON's encoder is total over JSON-compatible inputs and
 * our `ServerFrame` types are structurally JSON-safe.
 */
export function encodeServerFrame(frame: ServerFrame): string {
    // TOON encodes a single root object most efficiently when every key is
    // a named field. Wrap the frame in an envelope so the output always has
    // a stable shape.
    return encode(frame as unknown as Record<string, unknown>);
}

/**
 * Decode an incoming TOON string from the plugin into a typed
 * {@link ClientFrame}. Returns `{ok:false}` for any parse error or missing
 * `kind` field — the caller decides what to do (usually send an error frame
 * and close the socket).
 */
export function decodeClientFrame(raw: string): CodecResult<ClientFrame> {
    if (typeof raw !== "string" || raw.length === 0) {
        return { ok: false, error: "empty frame" };
    }
    let value: unknown;
    try {
        value = decode(raw);
    } catch (err) {
        return { ok: false, error: `toon decode failed: ${err instanceof Error ? err.message : String(err)}` };
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return { ok: false, error: "frame root is not an object" };
    }
    const obj = value as Record<string, unknown>;
    if (typeof obj.kind !== "string") {
        return { ok: false, error: "missing or non-string `kind` field" };
    }
    // Structural narrowing is the caller's job — we've validated the
    // minimum (object + `kind`) and hand over a typed view.
    return { ok: true, value: obj as unknown as ClientFrame };
}
