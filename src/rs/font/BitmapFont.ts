import { CacheIndex } from "../cache/CacheIndex";
import { CacheSystem } from "../cache/CacheSystem";
import { IndexType } from "../cache/IndexType";
import { ByteBuffer } from "../io/ByteBuffer";
import { SpriteLoader } from "../sprite/SpriteLoader";

/**
 * Java-compatible Linear Congruential Generator (LCG) random number generator.
 * Matches Java's java.util.Random implementation.
 *
 * Used for OSRS text effects like AbstractFont.drawRandomAlphaAndSpacing.
 */
class JavaRandom {
    private static readonly MULTIPLIER = 0x5deece66dn;
    private static readonly ADDEND = 0xbn;
    private static readonly MASK = (1n << 48n) - 1n;
    private seed: bigint;

    constructor(seed: number) {
        this.seed = (BigInt(seed) ^ JavaRandom.MULTIPLIER) & JavaRandom.MASK;
    }

    setSeed(seed: number): void {
        this.seed = (BigInt(seed) ^ JavaRandom.MULTIPLIER) & JavaRandom.MASK;
    }

    private next(bits: number): number {
        this.seed = (this.seed * JavaRandom.MULTIPLIER + JavaRandom.ADDEND) & JavaRandom.MASK;
        return Number(this.seed >> BigInt(48 - bits));
    }

    nextInt(): number {
        return this.next(32) | 0;
    }
}

export class BitmapFont {
    advances: number[] = new Array(256).fill(0);
    leftBearings: number[] = new Array(256).fill(0);
    topBearings: number[] = new Array(256).fill(0);
    widths: number[] = new Array(256).fill(0);
    heights: number[] = new Array(256).fill(0);
    ascent: number = 0;
    maxAscent: number = 0;
    maxDescent: number = 0;

    /** Line height (ascent value, used for vertical spacing) */
    get lineHeight(): number {
        return this.ascent;
    }
    // Glyph pixel planes from sprite buffer (indexed color, palette applied as non-zero -> solid)
    glyphPixels: (Uint8Array | undefined)[] = new Array(256);
    glyphPalettes?: Int32Array; // same palette for all glyphs
    // Kerning table (CP-1252 codepoint pairs). Matches RuneScape AbstractFont behavior when
    // metrics are available in the font archive. Stored as signed bytes in Java; use Int8Array.
    kerning?: Int8Array; // length 65536, value added between consecutive chars
    private static readonly random = new JavaRandom(0);

    static tryLoad(cache: CacheSystem, fontId: number): BitmapFont | undefined {
        if (fontId < 0) return undefined;
        let sprites: CacheIndex, fonts: CacheIndex;
        try {
            sprites = cache.getIndex(IndexType.DAT2.sprites);
            fonts = cache.getIndex(IndexType.DAT2.fonts);
        } catch {
            // If fonts index missing, attempt sprite-only fallback below
            try {
                sprites = cache.getIndex(IndexType.DAT2.sprites);
            } catch {
                return undefined;
            }
            const font = BitmapFont.tryLoadFromSpritesOnly(sprites, fontId);
            return font;
        }
        try {
            // Check if font archive exists before trying to load (matches OSRS client behavior)
            if (!fonts.archiveExists(fontId)) {
                // No metrics archive; fallback to sprites-only
                return BitmapFont.tryLoadFromSpritesOnly(sprites, fontId);
            }
            const metricsFile = fonts.getFile(fontId, 0);
            if (!metricsFile) {
                // No metrics; fallback to sprites-only
                return BitmapFont.tryLoadFromSpritesOnly(sprites, fontId);
            }
            const metrics = metricsFile.getDataAsBuffer();

            // Load sprite buffer arrays for this font ID (re-using SpriteLoader)
            if (!SpriteLoader.loadFromIndex(sprites, fontId)) return undefined;
            const font = new BitmapFont();
            // Copy metrics (based on AbstractFont.readMetrics in the client)
            font.readMetrics(metrics.data);
            // Transfer glyph pixel planes + palette from SpriteLoader statics
            const count = SpriteLoader.spriteCount;
            const widths = SpriteLoader.widths!;
            const heights = SpriteLoader.heights!;
            const xOffs = SpriteLoader.xOffsets!;
            const yOffs = SpriteLoader.yOffsets!;
            const pixels = SpriteLoader.pixels!;
            const palette = SpriteLoader.palette!;
            font.glyphPalettes = palette;
            for (let i = 0; i < count && i < 256; i++) {
                font.widths[i] = widths[i] | 0;
                font.heights[i] = heights[i] | 0;
                font.leftBearings[i] = xOffs[i] | 0;
                font.topBearings[i] = yOffs[i] | 0;
                font.glyphPixels[i] = pixels[i];
            }
            // Compute ascent/descent like client
            let minTop = Number.MAX_SAFE_INTEGER;
            let maxBottom = Number.MIN_SAFE_INTEGER;
            for (let i = 0; i < 256; i++) {
                if (font.heights[i] !== 0) {
                    if (font.topBearings[i] < minTop) minTop = font.topBearings[i];
                    if (font.topBearings[i] + font.heights[i] > maxBottom)
                        maxBottom = font.topBearings[i] + font.heights[i];
                }
            }
            font.maxAscent = font.ascent - minTop;
            font.maxDescent = maxBottom - font.ascent;
            return font;
        } catch (e) {
            console.warn("Failed to load bitmap font", e);
            // Last resort: sprites-only
            try {
                sprites = cache.getIndex(IndexType.DAT2.sprites);
                return BitmapFont.tryLoadFromSpritesOnly(sprites, fontId);
            } catch {
                return undefined;
            }
        }
    }

    private static tryLoadFromSpritesOnly(
        spriteIndex: CacheIndex,
        fontId: number,
    ): BitmapFont | undefined {
        try {
            if (!SpriteLoader.loadFromIndex(spriteIndex, fontId)) return undefined;
            const font = new BitmapFont();
            const count = SpriteLoader.spriteCount;
            const widths = SpriteLoader.widths!;
            const heights = SpriteLoader.heights!;
            const xOffs = SpriteLoader.xOffsets!;
            const yOffs = SpriteLoader.yOffsets!;
            const pixels = SpriteLoader.pixels!;
            const palette = SpriteLoader.palette!;
            font.glyphPalettes = palette;
            // Assume glyph order maps to 0..count-1 matching char codes.
            for (let i = 0; i < count && i < 256; i++) {
                font.widths[i] = widths[i] | 0;
                font.heights[i] = heights[i] | 0;
                font.leftBearings[i] = xOffs[i] | 0;
                font.topBearings[i] = yOffs[i] | 0;
                font.glyphPixels[i] = pixels[i];
                font.advances[i] = font.widths[i] || 0;
            }
            // Set ascent to max height to center reasonably
            font.ascent = SpriteLoader.height | 0;
            // Compute ascent/descent bounds
            let minTop = Number.MAX_SAFE_INTEGER;
            let maxBottom = Number.MIN_SAFE_INTEGER;
            for (let i = 0; i < 256; i++) {
                if (font.heights[i] !== 0) {
                    if (font.topBearings[i] < minTop) minTop = font.topBearings[i];
                    if (font.topBearings[i] + font.heights[i] > maxBottom)
                        maxBottom = font.topBearings[i] + font.heights[i];
                }
            }
            if (minTop === Number.MAX_SAFE_INTEGER) {
                minTop = 0;
                maxBottom = font.ascent;
            }
            font.maxAscent = font.ascent - minTop;
            font.maxDescent = maxBottom - font.ascent;
            return font;
        } catch (e) {
            return undefined;
        }
    }

    private readMetrics(data: Int8Array) {
        if (data.length === 257) {
            const buf = new ByteBuffer(data);
            for (let i = 0; i < 256; i++) this.advances[i] = buf.readUnsignedByte();
            this.ascent = buf.readUnsignedByte();
            return;
        }
        let idx = 0;
        for (let i = 0; i < 256; i++) this.advances[i] = data[idx++] & 0xff;
        const var10 = new Array<number>(256); // height per char
        const var4 = new Array<number>(256); // top bearing per char
        for (let i = 0; i < 256; i++) var10[i] = data[idx++] & 0xff;
        for (let i = 0; i < 256; i++) var4[i] = data[idx++] & 0xff;
        const var11: number[][] = new Array(256); // right side distances per row (delta-coded)
        for (let i = 0; i < 256; i++) {
            const len = var10[i] | 0;
            const arr = new Array<number>(len);
            let v = 0;
            for (let j = 0; j < len; j++) {
                v += data[idx++];
                arr[j] = v & 0xff;
            }
            var11[i] = arr;
        }
        const var12: number[][] = new Array(256); // left side distances per row (delta-coded)
        for (let i = 0; i < 256; i++) {
            const len = var10[i] | 0;
            const arr = new Array<number>(len);
            let v = 0;
            for (let j = 0; j < len; j++) {
                v += data[idx++];
                arr[j] = v & 0xff;
            }
            var12[i] = arr;
        }
        // Build kerning table for all cp1252 pairs excluding space and nbsp (32, 160)
        this.kerning = new Int8Array(256 * 256);
        for (let a = 0; a < 256; a++) {
            if (a === 32 || a === 160) continue;
            for (let b = 0; b < 256; b++) {
                if (b === 32 || b === 160) continue;
                const k = BitmapFont.computeKerning(var11, var12, var4, this.advances, var10, a, b);
                // Clamp to signed byte range
                const sv = Math.max(-128, Math.min(127, k | 0));
                this.kerning[(a << 8) + b] = sv;
            }
        }
        // Ascent stored as topBearing(space) + height(space)
        this.ascent = (var4[32] | 0) + (var10[32] | 0);
    }

    private static computeKerning(
        var0: number[][],
        var1: number[][],
        var2: number[],
        var3: number[],
        var4: number[],
        var5: number,
        var6: number,
    ): number {
        // Port of AbstractFont.method7754
        const var7 = var2[var5] | 0; // top of a
        const var8 = var7 + (var4[var5] | 0); // bottom of a
        const var9 = var2[var6] | 0; // top of b
        const var10 = var9 + (var4[var6] | 0); // bottom of b
        let var11 = var7;
        if (var9 > var7) var11 = var9;
        let var12 = var8;
        if (var10 < var8) var12 = var10;
        let var13 = var3[var5] | 0; // start with advance of a
        if ((var3[var6] | 0) < var13) var13 = var3[var6] | 0;
        const var14 = var1[var5];
        const var15 = var0[var6];
        let var16 = var11 - var7;
        let var17 = var11 - var9;
        for (let var18 = var11; var18 < var12; ++var18) {
            const var19 = (var14[var16++] | 0) + (var15[var17++] | 0);
            if (var19 < var13) var13 = var19;
        }
        return -var13;
    }

    measure(text: string): number {
        let w = 0;
        let prev = -1;
        for (let i = 0; i < text.length; i++) {
            let ch = text.charCodeAt(i) & 0xff;
            if (ch === 160) ch = 32;
            w += this.advances[ch] || this.widths[ch] || 0;
            if (this.kerning && prev !== -1) {
                w += this.kerning[(prev << 8) + ch] || 0;
            }
            prev = ch;
        }
        return w | 0;
    }

    /**
     * OSRS parity: AbstractFont.drawRandomAlphaAndSpacing
     *
     * Uses a deterministic Java RNG seeded by `seed` to generate:
     * - A global alpha value in [192, 223] (out of 256)
     * - Per-character x offsets (0 or +1 cumulatively) stored for the raw string length
     *
     * The offsets are indexed by the "drawn character index" in the renderer, which matches
     * OSRS behavior when markup tags are present in the string.
     */
    drawRandomAlphaAndSpacing(
        ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
        text: string,
        x: number,
        y: number,
        colorRgb: number,
        shadowRgb: number,
        seed: number,
    ): void {
        if (!text) return;
        // Convert RGB ints to CSS colors for the glyph cache.
        const toCss = (rgb: number): string => `#${(rgb >>> 0).toString(16).padStart(6, "0")}`;
        const defaultColor = toCss(colorRgb);
        const defaultShadow = shadowRgb >= 0 ? toCss(shadowRgb) : null;

        // Java RNG seeded like AbstractFont_random.setSeed((long)seed)
        const rng = BitmapFont.random;
        rng.setSeed(seed | 0);

        // AbstractFont_alpha = 192 + (random.nextInt() & 31)
        const alphaByte = 192 + (rng.nextInt() & 31);
        const alpha = alphaByte / 256;

        // var7 = new int[text.length()]; var8=0; for each char: var7[i]=var8; if ((rand.nextInt()&3)==0) ++var8;
        const xOffsets = new Int32Array(text.length);
        let accum = 0;
        for (let i = 0; i < text.length; i++) {
            xOffsets[i] = accum;
            if ((rng.nextInt() & 3) === 0) accum++;
        }

        this.drawMarkupWithXOffsets(ctx, text, x, y, defaultColor, defaultShadow, alpha, xOffsets);
    }

    // Performance: cache rendered glyphs per color to avoid getImageData/putImageData per draw
    private glyphCanvasCache = new Map<string, Map<number, OffscreenCanvas>>();

    /**
     * Draw OSRS-markup text with optional per-character x offsets.
     *
     * OSRS parity: Mirrors the client AbstractFont.method7780 behavior for <col>/<shad>/<lt>/<gt>
     * as used by drawRandomAlphaAndSpacing (top-left hover text) and menu rendering.
     *
     * Notes:
     * - Only a subset of tags are supported (enough for menu/hover text): col/color, shad, lt/gt, br.
     * - <img=> tags are not rendered here (we still advance the offset index to match spacing arrays).
     */
    drawMarkupWithXOffsets(
        ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
        text: string,
        x: number,
        y: number,
        defaultColor: string,
        defaultShadow: string | null,
        alpha: number,
        xOffsets?: ArrayLike<number> | null,
    ): void {
        let penX = x;
        let prev = -1;
        let idx = 0; // "var9" in AbstractFont.method7780 (drawn char index)
        let tagStart = -1;

        let curColor = defaultColor;
        let curShadow: string | null = defaultShadow;

        // Local cache for parsed RGB per color key
        const rgbCache = new Map<string, { r: number; g: number; b: number }>();
        const parseRgb = (color: string): { r: number; g: number; b: number } => {
            const cached = rgbCache.get(color);
            if (cached) return cached;
            let r = 255,
                g = 255,
                b = 255;
            if (color.startsWith("#")) {
                const hex =
                    color.length === 4 ? color.replace(/#(.)(.)(.)/, "#$1$1$2$2$3$3") : color;
                const v = parseInt(hex.substring(1), 16);
                r = (v >> 16) & 0xff;
                g = (v >> 8) & 0xff;
                b = v & 0xff;
            } else if (color === "black") {
                r = g = b = 0;
            }
            const out = { r, g, b };
            rgbCache.set(color, out);
            return out;
        };

        const getColorCache = (color: string): Map<number, OffscreenCanvas> => {
            let colorCache = this.glyphCanvasCache.get(color);
            if (!colorCache) {
                colorCache = new Map<number, OffscreenCanvas>();
                this.glyphCanvasCache.set(color, colorCache);
            }
            return colorCache;
        };

        const prevAlpha = (ctx as any).globalAlpha;
        try {
            if (Number.isFinite(alpha)) {
                (ctx as any).globalAlpha = Math.max(0, Math.min(1, alpha));
            }

            for (let i = 0; i < text.length; i++) {
                const chRaw = text.charAt(i);
                if (chRaw === "<") {
                    tagStart = i;
                    continue;
                }

                // Tag handling (matches AbstractFont.method7780 structure)
                if (chRaw === ">" && tagStart !== -1) {
                    const tag = text.substring(tagStart + 1, i).toLowerCase();
                    tagStart = -1;

                    if (tag === "lt") {
                        // Render a literal '<'
                        // fall through as if current char is '<'
                        // (we don't adjust `i`; just draw here)
                        // eslint-disable-next-line no-param-reassign
                        // @ts-ignore - handled by local variable below
                    } else if (tag === "gt") {
                        // Render a literal '>'
                        // eslint-disable-next-line no-param-reassign
                        // @ts-ignore - handled by local variable below
                    } else if (tag.startsWith("col=") || tag.startsWith("color=")) {
                        const prefixLen = tag.startsWith("color=") ? 6 : 4;
                        let hex = tag.substring(prefixLen);
                        if (hex.startsWith("#")) hex = hex.substring(1);
                        if (hex.length) curColor = `#${hex}`;
                        continue;
                    } else if (tag === "/col" || tag === "/color") {
                        curColor = defaultColor;
                        continue;
                    } else if (tag.startsWith("shad=")) {
                        let hex = tag.substring(5);
                        if (hex.startsWith("#")) hex = hex.substring(1);
                        if (hex.length) curShadow = `#${hex}`;
                        continue;
                    } else if (tag === "shad") {
                        curShadow = "#000000";
                        continue;
                    } else if (tag === "/shad") {
                        curShadow = defaultShadow;
                        continue;
                    } else if (tag === "br") {
                        // Reset formatting (single-line callers can ignore line breaks)
                        curColor = defaultColor;
                        curShadow = defaultShadow;
                        prev = -1;
                        continue;
                    } else if (tag.startsWith("img=")) {
                        // Not rendered here; still advance the offset index to keep spacing deterministic.
                        idx++;
                        prev = -1;
                        continue;
                    } else {
                        // Unknown tag: ignore (OSRS client also ignores failures silently)
                        continue;
                    }

                    // If we got here, tag was lt/gt; map to the literal character.
                    const lit = tag === "gt" ? ">" : "<";
                    // Handle as a normal character draw below.
                    const code = (lit.charCodeAt(0) & 0xff) | 0;
                    if (this.kerning && prev !== -1) {
                        penX += this.kerning[(prev << 8) + code] || 0;
                    }
                    const xo = xOffsets ? xOffsets[idx] | 0 : 0;

                    const gw = this.widths[code] | 0;
                    const gh = this.heights[code] | 0;
                    const lb = this.leftBearings[code] | 0;
                    const tb = this.topBearings[code] | 0;
                    const gp = this.glyphPixels[code];

                    if (gw && gh && gp) {
                        const baseY = Math.round(y - this.ascent);
                        const dstX = Math.round(penX + xo + lb);
                        const dstY = Math.round(baseY + tb);

                        if (curShadow) {
                            const sc = getColorCache(curShadow);
                            let shadowCanvas = sc.get(code);
                            if (!shadowCanvas) {
                                const { r, g, b } = parseRgb(curShadow);
                                shadowCanvas = this.renderGlyphToCanvas(code, r, g, b);
                                sc.set(code, shadowCanvas);
                            }
                            ctx.drawImage(shadowCanvas, dstX + 1, dstY + 1);
                        }

                        const cc = getColorCache(curColor);
                        let glyphCanvas = cc.get(code);
                        if (!glyphCanvas) {
                            const { r, g, b } = parseRgb(curColor);
                            glyphCanvas = this.renderGlyphToCanvas(code, r, g, b);
                            cc.set(code, glyphCanvas);
                        }
                        ctx.drawImage(glyphCanvas, dstX, dstY);
                    }

                    penX += this.advances[code] || gw;
                    prev = code;
                    idx++;
                    continue;
                }

                // Skip characters inside a tag until we hit the closing '>'
                if (tagStart !== -1) continue;

                let code = text.charCodeAt(i) & 0xff;
                if (code === 160) code = 32;
                if (this.kerning && prev !== -1) {
                    penX += this.kerning[(prev << 8) + code] || 0;
                }

                const gw = this.widths[code] | 0;
                const gh = this.heights[code] | 0;
                const lb = this.leftBearings[code] | 0;
                const tb = this.topBearings[code] | 0;
                const gp = this.glyphPixels[code];

                const xo = xOffsets ? xOffsets[idx] | 0 : 0;
                if (gw && gh && gp && code !== 32) {
                    const baseY = Math.round(y - this.ascent);
                    const dstX = Math.round(penX + xo + lb);
                    const dstY = Math.round(baseY + tb);

                    if (curShadow) {
                        const sc = getColorCache(curShadow);
                        let shadowCanvas = sc.get(code);
                        if (!shadowCanvas) {
                            const { r, g, b } = parseRgb(curShadow);
                            shadowCanvas = this.renderGlyphToCanvas(code, r, g, b);
                            sc.set(code, shadowCanvas);
                        }
                        ctx.drawImage(shadowCanvas, dstX + 1, dstY + 1);
                    }

                    const cc = getColorCache(curColor);
                    let glyphCanvas = cc.get(code);
                    if (!glyphCanvas) {
                        const { r, g, b } = parseRgb(curColor);
                        glyphCanvas = this.renderGlyphToCanvas(code, r, g, b);
                        cc.set(code, glyphCanvas);
                    }
                    ctx.drawImage(glyphCanvas, dstX, dstY);
                }

                penX += this.advances[code] || gw;
                prev = code;
                idx++;
            }
        } finally {
            (ctx as any).globalAlpha = prevAlpha;
        }
    }

    draw(
        ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
        text: string,
        x: number,
        y: number,
        color: string,
    ) {
        let penX = x;
        let prev = -1;

        // Parse color once
        let r = 255,
            g = 255,
            b = 255;
        if (color.startsWith("#")) {
            const hex = color.length === 4 ? color.replace(/#(.)(.)(.)/, "#$1$1$2$2$3$3") : color;
            const v = parseInt(hex.substring(1), 16);
            r = (v >> 16) & 0xff;
            g = (v >> 8) & 0xff;
            b = v & 0xff;
        } else if (color === "black") {
            r = g = b = 0;
        }

        // Get or create color-specific glyph cache
        let colorCache = this.glyphCanvasCache.get(color);
        if (!colorCache) {
            colorCache = new Map<number, OffscreenCanvas>();
            this.glyphCanvasCache.set(color, colorCache);
        }

        for (let i = 0; i < text.length; i++) {
            let ch = text.charCodeAt(i) & 0xff;
            if (ch === 160) ch = 32;
            if (this.kerning && prev !== -1) penX += this.kerning[(prev << 8) + ch] || 0;

            const gw = this.widths[ch] | 0;
            const gh = this.heights[ch] | 0;
            const lb = this.leftBearings[ch] | 0;
            const tb = this.topBearings[ch] | 0;
            const gp = this.glyphPixels[ch];

            if (!gw || !gh || !gp) {
                penX += this.advances[ch] || gw;
                prev = ch;
                continue;
            }

            // Get cached glyph canvas or create it
            let glyphCanvas = colorCache.get(ch);
            if (!glyphCanvas) {
                glyphCanvas = this.renderGlyphToCanvas(ch, r, g, b);
                colorCache.set(ch, glyphCanvas);
            }

            // Draw cached glyph using fast ctx.drawImage
            // OSRS parity: AbstractFont.draw0 uses (y - ascent) before applying topBearings.
            // y is a baseline coordinate (e.g., widget text uses y = top + maxAscent).
            const baseY = Math.round(y - this.ascent);
            const dstX = Math.round(penX + lb);
            const dstY = Math.round(baseY + tb);
            ctx.drawImage(glyphCanvas, dstX, dstY);

            penX += this.advances[ch] || gw;
            prev = ch;
        }
    }

    private renderGlyphToCanvas(ch: number, r: number, g: number, b: number): OffscreenCanvas {
        const gw = this.widths[ch] | 0;
        const gh = this.heights[ch] | 0;
        const gp = this.glyphPixels[ch]!;

        const canvas = new OffscreenCanvas(gw, gh);
        const offCtx = canvas.getContext("2d")!;
        const imageData = offCtx.createImageData(gw, gh);
        const data = imageData.data;

        for (let py = 0; py < gh; py++) {
            for (let px = 0; px < gw; px++) {
                const si = px + py * gw;
                const idx = gp[si] & 0xff;
                if (idx === 0) continue; // transparent
                const di = si * 4;
                data[di] = r;
                data[di + 1] = g;
                data[di + 2] = b;
                data[di + 3] = 255;
            }
        }

        offCtx.putImageData(imageData, 0, 0);
        return canvas;
    }

    drawCenteredWithShadow(
        ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
        text: string,
        cx: number,
        cy: number,
        shadowDx: number,
        shadowDy: number,
    ) {
        const w = this.measure(text);
        const x = Math.round(cx - w / 2);
        const y = Math.round(cy);
        // shadow bottom-right only
        this.draw(ctx, text, x + shadowDx, y + shadowDy, "#000");
        this.draw(ctx, text, x, y, "#fff");
    }
}
