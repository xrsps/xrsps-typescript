export function escapeBracketsOsrs(input: string): string {
    const len = input.length;
    let extra = 0;
    for (let i = 0; i < len; i++) {
        const c = input.charCodeAt(i);
        if (c === 60 /* < */ || c === 62 /* > */) extra += 3;
    }
    if (extra === 0) return input;
    const out: string[] = [];
    out.length = 0;
    for (let i = 0; i < len; i++) {
        const ch = input[i]!;
        if (ch === "<") out.push("<lt>");
        else if (ch === ">") out.push("<gt>");
        else out.push(ch);
    }
    return out.join("");
}

function isLetterOsrs(ch: string): boolean {
    // Close enough to Java Character.isLetter for CP-1252 chat input.
    return ch.toLowerCase() !== ch.toUpperCase();
}

function isUpperCaseOsrs(ch: string): boolean {
    return isLetterOsrs(ch) && ch === ch.toUpperCase() && ch !== ch.toLowerCase();
}

function isSpaceCharOsrs(ch: string): boolean {
    const code = ch.charCodeAt(0);
    // Java Character.isSpaceChar: Unicode space separators (not tabs/newlines).
    return (
        code === 0x20 ||
        code === 0x00a0 ||
        code === 0x1680 ||
        (code >= 0x2000 && code <= 0x200a) ||
        code === 0x202f ||
        code === 0x205f ||
        code === 0x3000
    );
}

function toTitleCaseOsrs(ch: string): string {
    const code = ch.charCodeAt(0);
    // Preserve the special cases in the reference client.
    if (code === 181 /* µ */ || code === 402 /* ƒ */) return ch;
    const upper = ch.toUpperCase();
    return upper.length === 1 ? upper : ch;
}

// Port of `class167.method3535` (sentence-case transform).
export function sentenceCaseOsrs(input: string): string {
    const len = input.length;
    if (len === 0) return input;
    const out: string[] = new Array(len);
    let state = 2;
    for (let i = 0; i < len; i++) {
        let ch = input[i]!;
        if (state === 0) {
            ch = ch.toLowerCase();
        } else if (state === 2 || isUpperCaseOsrs(ch)) {
            ch = toTitleCaseOsrs(ch);
        }

        if (isLetterOsrs(ch)) {
            state = 0;
        } else if (ch !== "." && ch !== "?" && ch !== "!") {
            if (isSpaceCharOsrs(ch)) {
                if (state !== 2) state = 1;
            } else {
                state = 1;
            }
        } else {
            state = 2;
        }

        out[i] = ch;
    }
    return out.join("");
}

export function normalizePublicChatTextOsrs(input: string): string {
    return escapeBracketsOsrs(sentenceCaseOsrs(input)).trim();
}
