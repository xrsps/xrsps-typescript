import { BitmapFont } from "../../../rs/font/BitmapFont";
import type { GLRenderer } from "../../gl/renderer";
import { getBitmapFontAtlas } from "../../text/BitmapFontAtlas";

export type FontLoader = (id: number) => BitmapFont | undefined;
export type InlineImageResolver = (
    imgId: number,
) => { canvas: HTMLCanvasElement; width: number; height: number } | undefined;

/** Parsed text segment with styling information */
interface TextSegment {
    text: string;
    color: number; // RGB color
    shadow: number; // Shadow color (-1 = default black, -2 = no shadow)
    underline: number; // Underline color (-1 = no underline)
    strikethrough: number; // Strikethrough color (-1 = no strikethrough)
    imgId?: number; // Sprite ID for inline images
}

/**
 * Parse OSRS text markup tags like <col=808080>text</col>
 * Returns an array of text segments with their styling
 */
function parseOsrsMarkup(text: string, defaultColor: number): TextSegment[] {
    const segments: TextSegment[] = [];
    let currentColor = defaultColor;
    let currentShadow = -1; // -1 = default (black if shadow enabled)
    let currentUnderline = -1; // -1 = no underline
    let currentStrikethrough = -1; // -1 = no strikethrough
    let i = 0;

    const makeSegment = (t: string, imgId?: number): TextSegment => ({
        text: t,
        color: currentColor,
        shadow: currentShadow,
        underline: currentUnderline,
        strikethrough: currentStrikethrough,
        imgId,
    });

    while (i < text.length) {
        // Look for opening tag
        if (text[i] === "<") {
            const tagEnd = text.indexOf(">", i);
            if (tagEnd === -1) {
                // No closing >, treat as regular text
                segments.push(makeSegment(text[i]));
                i++;
                continue;
            }

            const tagContent = text.slice(i + 1, tagEnd).toLowerCase();

            // Handle <col=XXXXXX> or <color=XXXXXX> tag (with optional # prefix)
            if (tagContent.startsWith("col=") || tagContent.startsWith("color=")) {
                const prefixLen = tagContent.startsWith("color=") ? 6 : 4;
                let colorStr = tagContent.slice(prefixLen);
                // Strip optional # prefix
                if (colorStr.startsWith("#")) {
                    colorStr = colorStr.slice(1);
                }
                const parsed = parseInt(colorStr, 16);
                if (!isNaN(parsed)) {
                    currentColor = parsed;
                }
                i = tagEnd + 1;
                continue;
            }

            // Handle </col> or </color> closing tag
            if (tagContent === "/col" || tagContent === "/color") {
                currentColor = defaultColor;
                i = tagEnd + 1;
                continue;
            }

            // Handle <br> line break
            if (tagContent === "br" || tagContent === "br/") {
                segments.push(makeSegment("\n"));
                i = tagEnd + 1;
                continue;
            }

            // Handle <shad=XXXXXX> shadow color
            if (tagContent.startsWith("shad=")) {
                const colorStr = tagContent.slice(5);
                const parsed = parseInt(colorStr, 16);
                if (!isNaN(parsed)) {
                    currentShadow = parsed;
                }
                i = tagEnd + 1;
                continue;
            }

            // Handle <shad> default shadow (black)
            if (tagContent === "shad") {
                currentShadow = 0x000000;
                i = tagEnd + 1;
                continue;
            }

            // Handle </shad> - disable shadow
            if (tagContent === "/shad") {
                currentShadow = -2; // -2 = explicitly no shadow
                i = tagEnd + 1;
                continue;
            }

            // Handle <u=XXXXXX> underline with color
            if (tagContent.startsWith("u=")) {
                const colorStr = tagContent.slice(2);
                const parsed = parseInt(colorStr, 16);
                if (!isNaN(parsed)) {
                    currentUnderline = parsed;
                } else {
                    currentUnderline = currentColor; // Use text color
                }
                i = tagEnd + 1;
                continue;
            }

            // Handle <u> default underline (use text color)
            if (tagContent === "u") {
                currentUnderline = 0x000000; // Default underline color
                i = tagEnd + 1;
                continue;
            }

            // Handle </u> - disable underline
            if (tagContent === "/u") {
                currentUnderline = -1;
                i = tagEnd + 1;
                continue;
            }

            // Handle <str> strikethrough
            if (tagContent === "str") {
                currentStrikethrough = 0x800000; // Default RS strikethrough color (dark red)
                i = tagEnd + 1;
                continue;
            }

            // Handle </str> - disable strikethrough
            if (tagContent === "/str") {
                currentStrikethrough = -1;
                i = tagEnd + 1;
                continue;
            }

            // Handle <img=N> inline images
            if (tagContent.startsWith("img=")) {
                const idStr = tagContent.slice(4);
                const imgId = parseInt(idStr, 10);
                if (!isNaN(imgId) && imgId >= 0) {
                    // Add a placeholder segment for the image
                    segments.push(makeSegment("", imgId));
                }
                i = tagEnd + 1;
                continue;
            }

            // Unknown tag, include the < character as text
            segments.push(makeSegment("<"));
            i++;
            continue;
        }

        // Regular character - collect consecutive chars with same styling
        let textChunk = "";
        while (i < text.length && text[i] !== "<") {
            textChunk += text[i];
            i++;
        }
        if (textChunk) {
            segments.push(makeSegment(textChunk));
        }
    }

    return segments;
}

/** Check if text contains OSRS markup tags */
function hasOsrsMarkup(text: string): boolean {
    return /<col=|<\/col>|<color=|<\/color>|<shad|<\/shad>|<br>|<img=|<u>|<u=|<\/u>|<str>|<\/str>/i.test(
        text,
    );
}

type QuadBuffer = {
    data: Float32Array;
    quadCount: number;
};

const _glyphQuadBuffer: QuadBuffer = {
    data: new Float32Array(16 * 128),
    quadCount: 0,
};
const _inlineCanvasIds = new WeakMap<HTMLCanvasElement, number>();
let _nextInlineCanvasId = 1;

function resetQuadBuffer(buffer: QuadBuffer): void {
    buffer.quadCount = 0;
}

function ensureQuadBufferCapacity(buffer: QuadBuffer, addQuads: number): void {
    const requiredQuads = buffer.quadCount + addQuads;
    const currentQuads = buffer.data.length / 16;
    if (requiredQuads <= currentQuads) return;

    let nextQuads = Math.max(1, currentQuads);
    while (nextQuads < requiredQuads) {
        nextQuads <<= 1;
    }

    const next = new Float32Array(nextQuads * 16);
    next.set(buffer.data.subarray(0, buffer.quadCount * 16));
    buffer.data = next;
}

function toRgb01(c: number): [number, number, number] {
    return [((c >>> 16) & 0xff) / 255, ((c >>> 8) & 0xff) / 255, (c & 0xff) / 255];
}

function measureSegmentsWidth(
    font: BitmapFont,
    segments: TextSegment[],
    inlineImageResolver?: InlineImageResolver,
): number {
    const resolveInlineImage = inlineImageResolver ?? (() => undefined);
    let width = 0;
    for (const seg of segments) {
        if (seg.text === "\n") continue;
        if (seg.imgId !== undefined) {
            const icon = resolveInlineImage(seg.imgId | 0);
            if (icon) width += Math.max(0, icon.width | 0);
            continue;
        }
        width += font.measure(seg.text) | 0;
    }
    return width;
}

function scaleRange(origin: number, start: number, end: number, scale: number): [number, number] {
    const scaledStart = origin + Math.round(start * scale);
    let scaledEnd = origin + Math.round(end * scale);
    if (end > start && scaledEnd <= scaledStart) {
        scaledEnd = scaledStart + 1;
    }
    return [scaledStart, scaledEnd];
}

function appendScaledQuad(
    buffer: QuadBuffer,
    originX: number,
    originY: number,
    scaleX: number,
    scaleY: number,
    left: number,
    top: number,
    right: number,
    bottom: number,
    u0: number,
    v0: number,
    u1: number,
    v1: number,
): void {
    const [x0, x1] = scaleRange(originX, left, right, scaleX);
    const [y0, y1] = scaleRange(originY, top, bottom, scaleY);
    if (x1 <= x0 || y1 <= y0) return;

    ensureQuadBufferCapacity(buffer, 1);
    const offset = buffer.quadCount * 16;
    const data = buffer.data;
    data[offset + 0] = x0;
    data[offset + 1] = y0;
    data[offset + 2] = u0;
    data[offset + 3] = v0;
    data[offset + 4] = x1;
    data[offset + 5] = y0;
    data[offset + 6] = u1;
    data[offset + 7] = v0;
    data[offset + 8] = x1;
    data[offset + 9] = y1;
    data[offset + 10] = u1;
    data[offset + 11] = v1;
    data[offset + 12] = x0;
    data[offset + 13] = y1;
    data[offset + 14] = u0;
    data[offset + 15] = v1;
    buffer.quadCount++;
}

function getInlineCanvasTexture(glr: GLRenderer, canvas: HTMLCanvasElement) {
    let id = _inlineCanvasIds.get(canvas);
    if (id === undefined) {
        id = _nextInlineCanvasId++;
        _inlineCanvasIds.set(canvas, id);
    }
    return glr.createTextureFromCanvas(`txticon:${id}`, canvas);
}

function drawScaledRect(
    glr: GLRenderer,
    originX: number,
    originY: number,
    left: number,
    top: number,
    width: number,
    height: number,
    color: number,
    alpha: number,
    scaleX: number,
    scaleY: number,
): void {
    if (width <= 0 || height <= 0) return;
    const [x0, x1] = scaleRange(originX, left, left + width, scaleX);
    const [y0, y1] = scaleRange(originY, top, top + height, scaleY);
    if (x1 <= x0 || y1 <= y0) return;
    const rgb = toRgb01(color);
    glr.drawRect(x0, y0, x1 - x0, y1 - y0, [rgb[0], rgb[1], rgb[2], alpha]);
}

function drawBitmapRunGL(
    glr: GLRenderer,
    font: BitmapFont,
    text: string,
    logicalX: number,
    baselineY: number,
    color: number,
    alpha: number,
    originX: number,
    originY: number,
    scaleX: number,
    scaleY: number,
): void {
    if (!text) return;

    const atlas = getBitmapFontAtlas(glr, font);
    const buffer = _glyphQuadBuffer;
    resetQuadBuffer(buffer);

    let penX = logicalX;
    let prev = -1;
    for (let i = 0; i < text.length; i++) {
        let ch = text.charCodeAt(i) & 0xff;
        if (ch === 160) ch = 32;
        if (font.kerning && prev !== -1) {
            penX += font.kerning[(prev << 8) + ch] || 0;
        }

        const glyph = atlas.glyphs[ch];
        if (glyph?.drawable) {
            const left = penX + glyph.lb;
            const top = baselineY - atlas.ascent + glyph.tb;
            appendScaledQuad(
                buffer,
                originX,
                originY,
                scaleX,
                scaleY,
                left,
                top,
                left + glyph.w,
                top + glyph.h,
                glyph.u0,
                glyph.v0,
                glyph.u1,
                glyph.v1,
            );
        }

        penX += glyph?.adv ?? font.advances[ch] ?? glyph?.w ?? 0;
        prev = ch;
    }

    if (buffer.quadCount > 0) {
        glr.drawTextureQuads(atlas.texture, buffer.data, buffer.quadCount, 1, toRgb01(color), alpha);
    }
}

function drawBitmapSegmentsGL(
    glr: GLRenderer,
    font: BitmapFont,
    segments: TextSegment[],
    logicalX: number,
    baselineY: number,
    shadow: boolean,
    alpha: number,
    originX: number,
    originY: number,
    scaleX: number,
    scaleY: number,
    fontAscent: number,
    inlineImageResolver?: InlineImageResolver,
): void {
    const resolveInlineImage = inlineImageResolver ?? (() => undefined);
    let cx = logicalX;

    for (const seg of segments) {
        if (seg.text === "\n") continue;

        if (seg.imgId !== undefined) {
            const icon = resolveInlineImage(seg.imgId | 0);
            if (icon) {
                const iconW = Math.max(0, icon.width | 0);
                const iconH = Math.max(0, icon.height | 0);
                if (iconW > 0 && iconH > 0) {
                    const tex = getInlineCanvasTexture(glr, icon.canvas);
                    const [x0, x1] = scaleRange(originX, cx, cx + iconW, scaleX);
                    const [y0, y1] = scaleRange(originY, baselineY - iconH, baselineY, scaleY);
                    if (x1 > x0 && y1 > y0) {
                        glr.drawTexture(tex, x0, y0, x1 - x0, y1 - y0, 1, 1, 0, [0, 0, 0], false, false, alpha);
                    }
                }
                cx += iconW;
            }
            continue;
        }

        const segWidth = (font.measure(seg.text) | 0) as number;
        const shouldShadow = shadow || seg.shadow >= 0;
        const shadowColor = seg.shadow >= 0 ? seg.shadow : 0x000000;

        if (shouldShadow && seg.shadow !== -2) {
            drawBitmapRunGL(
                glr,
                font,
                seg.text,
                cx + 1,
                baselineY + 1,
                shadowColor,
                alpha,
                originX,
                originY,
                scaleX,
                scaleY,
            );
        }

        drawBitmapRunGL(
            glr,
            font,
            seg.text,
            cx,
            baselineY,
            seg.color,
            alpha,
            originX,
            originY,
            scaleX,
            scaleY,
        );

        if (seg.underline >= 0) {
            drawScaledRect(
                glr,
                originX,
                originY,
                cx,
                baselineY + 2,
                segWidth,
                1,
                seg.underline,
                alpha,
                scaleX,
                scaleY,
            );
        }

        if (seg.strikethrough >= 0) {
            drawScaledRect(
                glr,
                originX,
                originY,
                cx,
                baselineY - Math.floor(fontAscent * 0.3),
                segWidth,
                1,
                seg.strikethrough,
                alpha,
                scaleX,
                scaleY,
            );
        }

        cx += segWidth;
    }
}

export function drawTextGL(
    glr: GLRenderer,
    fontLoader: FontLoader,
    text: string,
    x: number,
    y: number,
    w: number,
    h: number,
    fontId: number,
    color: number,
    xAlign: number = 0,
    yAlign: number = 0,
    shadow: boolean = false,
    alpha: number = 1,
    inlineImageResolver?: InlineImageResolver,
    renderScaleX: number = 1,
    renderScaleY: number = 1,
) {
    // Early exit for empty text
    if (!text || w <= 0 || h <= 0) return;

    const font = fontLoader(fontId);
    if (!font) return;

    const safeScaleX = Number.isFinite(renderScaleX) && renderScaleX > 0 ? renderScaleX : 1;
    const safeScaleY = Number.isFinite(renderScaleY) && renderScaleY > 0 ? renderScaleY : 1;
    const logicalW = Math.max(1, Math.round(w / safeScaleX));
    const logicalH = Math.max(1, Math.round(h / safeScaleY));

    // Check for OSRS markup tags
    const useMarkup = hasOsrsMarkup(text);
    const defaultSegment: TextSegment = {
        text,
        color,
        shadow: -1,
        underline: -1,
        strikethrough: -1,
    };
    const segments = useMarkup ? parseOsrsMarkup(text, color) : [defaultSegment];
    const totalWidth = measureSegmentsWidth(font, segments, inlineImageResolver);

    // OSRS parity: text alignment can overflow widget width (used by runmode 116:30)
    // so we expand the cached texture bounds instead of clipping to widget width.
    let txRaw = 0;
    // OSRS parity: Java integer division truncates toward zero.
    if (xAlign === 1) txRaw = ((logicalW - totalWidth) / 2) | 0;
    else if (xAlign === 2) txRaw = logicalW - totalWidth;
    // OSRS parity: AbstractFont.drawLines vertical alignment (single-line case).
    // Java integer division truncates toward zero — replicate with `| 0`.
    const ascent = (font.maxAscent || font.ascent || 0) | 0;
    const descent = (font.maxDescent || 0) | 0;
    let baselineY = ascent;
    if (yAlign === 1) baselineY = ascent + (((logicalH - ascent - descent) / 2) | 0);
    else if (yAlign === 2) baselineY = logicalH - descent;
    drawBitmapSegmentsGL(
        glr,
        font,
        segments,
        txRaw,
        baselineY,
        shadow,
        alpha,
        x | 0,
        y | 0,
        safeScaleX,
        safeScaleY,
        ascent,
        inlineImageResolver,
    );
}

export function wrapTextToWidth(
    text: string,
    maxW: number,
    measure: (s: string) => number,
): string[] {
    const normalized = String(text).replace(/<br\s*\/?\s*>/gi, "\n");
    const paragraphs = normalized.split(/\n/);
    const out: string[] = [];
    for (const para of paragraphs) {
        const p = para;
        const words = p.split(/\s+/);
        // OSRS parity: whitespace-only paragraphs (e.g. from "Public<br> ")
        // must still produce a line so the line count is preserved for centering.
        if (!p.trim()) {
            out.push("");
            continue;
        }
        let cur = "";
        for (let i = 0; i < words.length; i++) {
            const w = words[i];
            if (!w) continue;
            if (!cur) {
                // OSRS parity: single words that don't fit are NOT broken character-by-character.
                // They are kept intact and allowed to overflow/clip. This prevents stat levels
                // like "99" from being broken into "9" + "9" on separate lines.
                cur = w;
            } else {
                const test = cur + " " + w;
                if (measure(test) <= maxW) cur = test;
                else {
                    out.push(cur);
                    // Same here - don't break long words, keep them whole
                    cur = w;
                }
            }
        }
        if (cur) out.push(cur);
    }
    return out;
}

export function splitExplicitLineBreaks(text: string): string[] {
    return String(text)
        .replace(/<br\s*\/?\s*>/gi, "\n")
        .split(/\n/);
}

export function shouldAutoWrapText(
    widgetHeight: number,
    lineHeight: number,
    maxAscent: number,
    maxDescent: number,
): boolean {
    const resolvedLineHeight = Math.max(1, lineHeight | 0);
    const ascent = Math.max(0, maxAscent | 0);
    const descent = Math.max(0, maxDescent | 0);
    const height = Math.max(0, widgetHeight | 0);
    return !(height < resolvedLineHeight + ascent + descent && height < resolvedLineHeight * 2);
}

export function drawWrappedTextGL(
    glr: GLRenderer,
    fontLoader: FontLoader,
    text: string,
    x: number,
    y: number,
    w: number,
    h: number,
    fontId: number,
    color: number,
    lineHeight: number = 12,
    shadow: boolean = true,
    yAlign: 0 | 1 | 2 = 1,
    xAlign: 0 | 1 | 2 = 1,
    inlineImageResolver?: InlineImageResolver,
    renderScaleX: number = 1,
    renderScaleY: number = 1,
) {
    // Early exit for empty text
    if (!text || w <= 0 || h <= 0) return;

    const font = fontLoader(fontId);
    if (!font) return;

    const safeScaleX = Number.isFinite(renderScaleX) && renderScaleX > 0 ? renderScaleX : 1;
    const safeScaleY = Number.isFinite(renderScaleY) && renderScaleY > 0 ? renderScaleY : 1;
    const logicalW = Math.max(1, Math.round(w / safeScaleX));
    const logicalH = Math.max(1, Math.round(h / safeScaleY));
    const useMarkup = hasOsrsMarkup(text);
    const resolveInlineImage = inlineImageResolver ?? (() => undefined);

    const measure = (s: string) => {
        if (!useMarkup) return font.measure(s) | 0;
        return measureSegmentsWidth(font, parseOsrsMarkup(s, color), inlineImageResolver);
    };
    const resolvedLineHeight = Math.max(
        1,
        lineHeight | 0 || (font.lineHeight as number) || (font.ascent as number) || 12,
    );
    const maxAscent = (font.maxAscent ?? font.ascent ?? resolvedLineHeight) | 0;
    const maxDescent = (font.maxDescent ?? 0) | 0;
    const autoWrap = shouldAutoWrapText(logicalH, resolvedLineHeight, maxAscent, maxDescent);
    // OSRS parity: short text widgets disable automatic wrapping and only honor explicit <br>.
    const lines = autoWrap
        ? wrapTextToWidth(text, Math.max(1, logicalW), measure)
        : splitExplicitLineBreaks(text);

    const lineSegments: (TextSegment[] | null)[] = new Array(lines.length);
    const lineWidths: number[] = new Array(lines.length);
    for (let i = 0; i < lines.length; i++) {
        if (useMarkup) {
            const segs = parseOsrsMarkup(lines[i], color);
            lineSegments[i] = segs;
            let width = 0;
            for (const seg of segs) {
                if (seg.text === "\n") continue;
                if (seg.imgId !== undefined) {
                    const icon = resolveInlineImage(seg.imgId | 0);
                    if (icon) width += Math.max(0, icon.width | 0);
                    continue;
                }
                width += font.measure(seg.text) | 0;
            }
            lineWidths[i] = width;
        } else {
            lineSegments[i] = null;
            lineWidths[i] = font.measure(lines[i]) | 0;
        }
    }

    // OSRS parity: x alignment can overflow widget width (e.g. runmode percent text in 116:30).
    const lineOffsetsRaw: number[] = new Array(lines.length);
    for (let i = 0; i < lines.length; i++) {
        const tw = lineWidths[i] ?? 0;
        let txRaw = 0;
        // OSRS parity: Java integer division truncates toward zero.
        if (xAlign === 1) txRaw = ((logicalW - tw) / 2) | 0;
        else if (xAlign === 2) txRaw = logicalW - tw;
        lineOffsetsRaw[i] = txRaw;
    }
    // OSRS parity: AbstractFont.drawLines vertical alignment (multiline).
    // Java integer division truncates toward zero — replicate with `| 0`.
    const ascent = (font.maxAscent || font.ascent || 0) | 0;
    const descent = (font.maxDescent ?? 0) | 0;
    let baseY0 = ascent;
    if (yAlign === 1) {
        const space = logicalH - ascent - descent - resolvedLineHeight * (lines.length - 1);
        baseY0 = ascent + ((space / 2) | 0);
    } else if (yAlign === 2) {
        baseY0 = logicalH - descent - resolvedLineHeight * (lines.length - 1);
    }
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const by = baseY0 + i * resolvedLineHeight;
        const tx = lineOffsetsRaw[i] | 0;
        const segments = useMarkup
            ? (lineSegments[i] ?? parseOsrsMarkup(line, color))
            : [
                  {
                      text: line,
                      color,
                      shadow: -1,
                      underline: -1,
                      strikethrough: -1,
                  },
              ];
        drawBitmapSegmentsGL(
            glr,
            font,
            segments,
            tx,
            by,
            shadow,
            1,
            x | 0,
            y | 0,
            safeScaleX,
            safeScaleY,
            ascent,
            inlineImageResolver,
        );
    }
}

export function drawRichTextGL(
    glr: GLRenderer,
    fontLoader: FontLoader,
    text: string,
    x: number,
    y: number,
    w: number,
    h: number,
    fontId: number,
    defaultColor: number,
    xAlign: number = 0,
    yAlign: number = 0,
    shadow: boolean = false,
    highlightRegex?: RegExp,
    highlightColor?: number,
    renderScaleX: number = 1,
    renderScaleY: number = 1,
) {
    const font = fontLoader(fontId);
    if (!font) return;

    const safeScaleX = Number.isFinite(renderScaleX) && renderScaleX > 0 ? renderScaleX : 1;
    const safeScaleY = Number.isFinite(renderScaleY) && renderScaleY > 0 ? renderScaleY : 1;
    const logicalW = Math.max(1, Math.round(w / safeScaleX));
    const logicalH = Math.max(1, Math.round(h / safeScaleY));
    const parts: { text: string; color: number }[] = [];
    if (highlightRegex && highlightColor != null) {
        let idx = 0;
        let m: RegExpExecArray | null;
        const re = new RegExp(highlightRegex.source, highlightRegex.flags);
        while ((m = re.exec(text))) {
            const s = m.index;
            const e = s + m[0].length;
            if (e <= s) {
                re.lastIndex = e + 1;
                continue;
            }
            if (s > idx) parts.push({ text: text.slice(idx, s), color: defaultColor });
            parts.push({
                text: text.slice(s, e),
                color: highlightColor ?? defaultColor,
            });
            idx = e;
        }
        if (idx < text.length) {
            parts.push({ text: text.slice(idx), color: defaultColor });
        }
    } else {
        parts.push({ text, color: defaultColor });
    }

    // OSRS parity: AbstractFont.drawLines vertical alignment (single-line case).
    const ascent = (font.maxAscent || font.ascent || 0) | 0;
    const descent = (font.maxDescent || 0) | 0;
    let by = ascent;
    if (yAlign === 1) by = ascent + (((logicalH - ascent - descent) / 2) | 0);
    else if (yAlign === 2) by = logicalH - descent;

    let totalWidth = 0;
    for (const p of parts) {
        totalWidth += font.measure(p.text) | 0;
    }

    let cx = 0;
    if (xAlign === 1) cx = ((logicalW - totalWidth) / 2) | 0;
    else if (xAlign === 2) cx = logicalW - totalWidth;

    for (const p of parts) {
        if (shadow) {
            drawBitmapRunGL(
                glr,
                font,
                p.text,
                cx + 1,
                by + 1,
                0x000000,
                1,
                x | 0,
                y | 0,
                safeScaleX,
                safeScaleY,
            );
        }
        drawBitmapRunGL(
            glr,
            font,
            p.text,
            cx,
            by,
            p.color,
            1,
            x | 0,
            y | 0,
            safeScaleX,
            safeScaleY,
        );
        cx += font.measure(p.text) | 0;
    }
}
