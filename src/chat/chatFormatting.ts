/**
 * OSRS public chat formatting parsing for outgoing messages.
 *
 *
 * Format:
 *   - One optional colour prefix: `yellow:` ... `rainbow:` OR `pattern<spec>:`.
 *   - One optional text effect prefix: `wave:`, `wave2:`, `shake:`, `scroll:`, `slide:`.
 *   - Remaining text is sent as the message.
 */

export type PublicChatFormatting = {
    text: string;
    colorId: number;
    effectId: number;
    /** Only for pattern colours (colorId 13..20). */
    pattern?: Uint8Array;
};

const MAX_PATTERN_LEN = 8;

const COLOUR_PREFIXES: Array<[prefix: string, colorId: number]> = [
    ["yellow:", 0],
    ["red:", 1],
    ["green:", 2],
    ["cyan:", 3],
    ["purple:", 4],
    ["white:", 5],
    ["flash1:", 6],
    ["flash2:", 7],
    ["flash3:", 8],
    ["glow1:", 9],
    ["glow2:", 10],
    ["glow3:", 11],
    ["rainbow:", 12],
];

const EFFECT_PREFIXES: Array<[prefix: string, effectId: number]> = [
    ["wave:", 1],
    ["wave2:", 2],
    ["shake:", 3],
    ["scroll:", 4],
    ["slide:", 5],
];

function parsePatternBytes(lowerInput: string): Uint8Array | null {
    const keyword = "pattern";
    if (!lowerInput.startsWith(keyword)) return null;

    let count = 0;
    const out = new Uint8Array(MAX_PATTERN_LEN);

    while (true) {
        const index = keyword.length + count;
        if (index >= lowerInput.length) return null;
        const ch = lowerInput.charCodeAt(index);
        if (ch === 58) {
            if (count === 0) return null;
            return out.subarray(0, count);
        }
        if (count >= out.length) return null;

        if (ch >= 48 && ch <= 57) {
            out[count++] = (ch - 48) & 0xff;
            continue;
        }
        if (ch >= 97 && ch <= 122) {
            out[count++] = (ch - 87) & 0xff; // 'a'(97) -> 10, 'z'(122) -> 35
            continue;
        }
        return null;
    }
}

export function parseOutgoingPublicChat(raw: string): PublicChatFormatting {
    let text = raw;
    let colorId = 0;
    let pattern: Uint8Array | undefined;

    let lower = text.toLowerCase();
    for (const [prefix, id] of COLOUR_PREFIXES) {
        if (lower.startsWith(prefix)) {
            colorId = id;
            text = text.substring(prefix.length);
            lower = text.toLowerCase();
            break;
        }
    }

    if (lower.startsWith("pattern")) {
        const bytes = parsePatternBytes(lower);
        if (bytes) {
            pattern = bytes;
            colorId = (bytes.length + 12) | 0;
            text = text.substring("pattern".length + bytes.length + 1);
            lower = text.toLowerCase();
        }
    }

    let effectId = 0;
    for (const [prefix, id] of EFFECT_PREFIXES) {
        if (lower.startsWith(prefix)) {
            effectId = id;
            text = text.substring(prefix.length);
            break;
        }
    }

    return {
        text: text.trim(),
        colorId: colorId & 0xff,
        effectId: effectId & 0xff,
        pattern,
    };
}

export function colourIdToHex(id: number | undefined): number {
    switch ((id ?? 0) | 0) {
        case 1:
            return 0xff0000;
        case 2:
            return 0x00ff00;
        case 3:
            return 0x00ffff;
        case 4:
            return 0xff00ff;
        case 5:
            return 0xffffff;
        case 0:
        default:
            return 0xffff00;
    }
}

export function sanitizeChatText(input: string): string {
    let out = "";
    for (const ch of input) {
        if (isValidChatChar(ch)) out += ch;
    }
    return out.trim();
}

export function isValidChatChar(char: string): boolean {
    if (char.length !== 1) return false;
    const code = char.charCodeAt(0);

    if (code < 32 || (code >= 127 && code < 160)) return false;

    if ((code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122)) {
        return true;
    }

    const allowed = " !\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";
    return allowed.includes(char);
}

export function capitalizeSentence(text: string): string {
    if (!text) return text;
    const idx = text.search(/[A-Za-z]/);
    if (idx === -1) return text;
    return text.slice(0, idx) + text.charAt(idx).toUpperCase() + text.slice(idx + 1);
}

// Legacy exports kept to avoid churn; not used by the OSRS-parity outgoing parser.
export function effectToHex(effect: unknown): number {
    return typeof effect === "number" ? effect | 0 : 0xffff00;
}

export function isStaticColour(_effect: unknown): boolean {
    return true;
}
