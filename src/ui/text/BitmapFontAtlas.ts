import { BitmapFont } from "../../rs/font/BitmapFont";
import type { GLRenderer } from "../gl/renderer";

export type AtlasTexture = ReturnType<GLRenderer["createTextureFromCanvas"]>;

export interface GlyphAtlasEntry {
    ch: number;
    u0: number;
    v0: number;
    u1: number;
    v1: number;
    w: number;
    h: number;
    lb: number;
    tb: number;
    adv: number;
    drawable: boolean;
}

export interface BitmapFontAtlas {
    texture: AtlasTexture;
    glyphs: GlyphAtlasEntry[];
    ascent: number;
    maxAscent: number;
    maxDescent: number;
    font: BitmapFont;
}

const MAX_ATLAS_ROW_WIDTH = 512;
const fontIds = new WeakMap<BitmapFont, number>();
const atlasCache = new WeakMap<GLRenderer, WeakMap<BitmapFont, BitmapFontAtlas>>();
let nextFontId = 1;

function getFontId(font: BitmapFont): number {
    let id = fontIds.get(font);
    if (id === undefined) {
        id = nextFontId++;
        fontIds.set(font, id);
    }
    return id;
}

export function getBitmapFontAtlas(glr: GLRenderer, font: BitmapFont): BitmapFontAtlas {
    let rendererCache = atlasCache.get(glr);
    if (!rendererCache) {
        rendererCache = new WeakMap<BitmapFont, BitmapFontAtlas>();
        atlasCache.set(glr, rendererCache);
    }

    const cached = rendererCache.get(font);
    if (cached) {
        return cached;
    }

    const glyphs: GlyphAtlasEntry[] = new Array(256);
    let penX = 1;
    let penY = 1;
    let rowHeight = 0;
    let atlasWidth = 2;
    let atlasHeight = 2;

    for (let ch = 0; ch < 256; ch++) {
        const w = font.widths[ch] | 0;
        const h = font.heights[ch] | 0;
        const drawable = !!font.glyphPixels[ch] && w > 0 && h > 0;

        if (!drawable) {
            glyphs[ch] = {
                ch,
                u0: 0,
                v0: 0,
                u1: 0,
                v1: 0,
                w,
                h,
                lb: font.leftBearings[ch] | 0,
                tb: font.topBearings[ch] | 0,
                adv: (font.advances[ch] | 0) || w,
                drawable: false,
            };
            continue;
        }

        if (penX + w + 1 > MAX_ATLAS_ROW_WIDTH) {
            penX = 1;
            penY += rowHeight + 1;
            rowHeight = 0;
        }

        glyphs[ch] = {
            ch,
            u0: 0,
            v0: 0,
            u1: 0,
            v1: 0,
            w,
            h,
            lb: font.leftBearings[ch] | 0,
            tb: font.topBearings[ch] | 0,
            adv: (font.advances[ch] | 0) || w,
            drawable: true,
        };

        const right = penX + w;
        const bottom = penY + h;
        atlasWidth = Math.max(atlasWidth, right + 1);
        atlasHeight = Math.max(atlasHeight, bottom + 1);
        rowHeight = Math.max(rowHeight, h);
        penX = right + 1;
    }

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, atlasWidth);
    canvas.height = Math.max(1, atlasHeight);
    const ctx = canvas.getContext("2d", {
        willReadFrequently: true as any,
    }) as CanvasRenderingContext2D;
    const imageData = ctx.createImageData(canvas.width, canvas.height);
    const data = imageData.data;

    penX = 1;
    penY = 1;
    rowHeight = 0;

    for (let ch = 0; ch < 256; ch++) {
        const glyph = glyphs[ch];
        if (!glyph.drawable) {
            continue;
        }

        if (penX + glyph.w + 1 > MAX_ATLAS_ROW_WIDTH) {
            penX = 1;
            penY += rowHeight + 1;
            rowHeight = 0;
        }

        const gp = font.glyphPixels[ch]!;
        for (let y = 0; y < glyph.h; y++) {
            for (let x = 0; x < glyph.w; x++) {
                const srcIndex = x + y * glyph.w;
                if ((gp[srcIndex] & 0xff) === 0) {
                    continue;
                }
                const dstIndex = ((penX + x) + (penY + y) * canvas.width) * 4;
                data[dstIndex] = 255;
                data[dstIndex + 1] = 255;
                data[dstIndex + 2] = 255;
                data[dstIndex + 3] = 255;
            }
        }

        glyph.u0 = penX / canvas.width;
        glyph.v0 = penY / canvas.height;
        glyph.u1 = (penX + glyph.w) / canvas.width;
        glyph.v1 = (penY + glyph.h) / canvas.height;
        rowHeight = Math.max(rowHeight, glyph.h);
        penX += glyph.w + 1;
    }

    ctx.putImageData(imageData, 0, 0);

    const atlas: BitmapFontAtlas = {
        texture: glr.createTextureFromCanvas(`fontatlas:${getFontId(font)}`, canvas),
        glyphs,
        ascent: font.ascent | 0,
        maxAscent: font.maxAscent | 0,
        maxDescent: font.maxDescent | 0,
        font,
    };
    rendererCache.set(font, atlas);
    return atlas;
}
