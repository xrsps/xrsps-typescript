import { COSINE, SINE } from "../../rs/MathConstants";
import type { CacheSystem } from "../../rs/cache/CacheSystem";
import { ObjModelLoader } from "../../rs/config/objtype/ObjModelLoader";
import { ObjStackability } from "../../rs/config/objtype/ObjStackability";
import type { ObjType } from "../../rs/config/objtype/ObjType";
import type { ObjTypeLoader } from "../../rs/config/objtype/ObjTypeLoader";
import { BitmapFont } from "../../rs/font/BitmapFont";
import { Rasterizer2D } from "../../rs/graphics/Rasterizer2D";
import { Rasterizer3D } from "../../rs/graphics/Rasterizer3D";
import type { Model } from "../../rs/model/Model";
import type { ModelLoader } from "../../rs/model/ModelLoader";
import { SpritePixels } from "../../rs/sprite/SpritePixels";
import type { TextureLoader } from "../../rs/texture/TextureLoader";
import { HSL_RGB_MAP } from "../../rs/util/ColorUtil";
import { FONT_PLAIN_11 } from "../fonts";

type FaceVisibilityPredicate = (model: Model, faceIndex: number) => boolean;

export type ItemIconRenderOptions = {
    outline?: number;
    shadow?: number;
    quantityMode?: number;
};

export class ItemIconRenderer {
    private static readonly OSRS_SPRITE_W = 36;
    private static readonly OSRS_SPRITE_H = 32;

    private objModel: ObjModelLoader;
    private objLoader: ObjTypeLoader;
    private textureLoader: TextureLoader;
    private texCache = new Map<number, { size: number; pixels: Int32Array }>();
    private cacheSystem?: CacheSystem;
    private fontCache = new Map<number, BitmapFont | undefined>();
    private itemSpriteCache = new Map<
        bigint,
        { pixels: Int32Array; isStackable: boolean; canvas?: HTMLCanvasElement }
    >();
    private faceVisibilityPredicate?: FaceVisibilityPredicate;

    constructor(
        objLoader: ObjTypeLoader,
        modelLoader: ModelLoader,
        textureLoader: TextureLoader,
        cacheSystem?: CacheSystem,
    ) {
        this.objLoader = objLoader;
        this.objModel = new ObjModelLoader(objLoader, modelLoader, textureLoader);
        this.textureLoader = textureLoader;
        this.cacheSystem = cacheSystem;
    }

    // Note: generic model → canvas rendering has moved into src/ui/model/Model2DRenderer.ts

    /**
     * Render an item icon canvas using software rasterizer
     */
    renderToCanvas(
        itemId: number,
        quantity: number = 1,
        options: ItemIconRenderOptions = {},
    ): HTMLCanvasElement | undefined {
        // Mirror UserComparator7.getItemSprite (36x32, baked outline/shadow + stack text).
        const qty = quantity | 0;
        const outline = (options.outline ?? 0) | 0;
        const shadow = (options.shadow ?? 0) | 0;
        const qtyModeRaw = (options.quantityMode ?? 2) | 0;
        const qtyMode = this.normalizeQuantityMode(qty, qtyModeRaw);
        const key = this.getItemSpriteKey(itemId | 0, qty, outline, shadow, qtyMode);

        const cached = this.itemSpriteCache.get(key);
        if (cached?.canvas) return cached.canvas;

        const entry = this.getItemSpriteEntry(itemId | 0, qty, outline, shadow, qtyMode, false);
        if (!entry) return undefined;

        if (entry.canvas) return entry.canvas;

        const canvas = this.pixelsToCanvas(entry.pixels);
        try {
            const ctx = canvas.getContext("2d", {
                willReadFrequently: true as any,
            }) as CanvasRenderingContext2D;
            this.drawItemQuantity(ctx, qty, qtyMode, entry.isStackable);
        } catch {}

        entry.canvas = canvas;
        // entry may already be cached (same object), but set anyway for clarity.
        this.itemSpriteCache.set(key, entry);
        return canvas;
    }

    private normalizeQuantityMode(quantity: number, quantityMode: number): number {
        // Reference: UserComparator7.getItemSprite
        let mode = quantityMode | 0;
        const qty = quantity | 0;
        if (qty === -1) mode = 0;
        else if (mode === 2 && qty !== 1) mode = 1;
        return mode;
    }

    private getItemSpriteKey(
        itemId: number,
        quantity: number,
        outline: number,
        shadow: number,
        quantityMode: number,
    ): bigint {
        // Reference: long var6 = ((long)var4 << 40) + ((long)var1 << 16) + (long)var0 + ((long)var2 << 38) + ((long)var3 << 42);
        return (
            (BigInt(quantityMode | 0) << 40n) +
            (BigInt(quantity | 0) << 16n) +
            BigInt(itemId | 0) +
            (BigInt(outline | 0) << 38n) +
            (BigInt(shadow | 0) << 42n)
        );
    }

    private getFont(id: number): BitmapFont | undefined {
        if (!this.cacheSystem) return undefined;
        const key = id | 0;
        if (this.fontCache.has(key)) return this.fontCache.get(key);
        const font = BitmapFont.tryLoad(this.cacheSystem, key);
        this.fontCache.set(key, font);
        return font;
    }

    private pixelsToCanvas(pixels: Int32Array): HTMLCanvasElement {
        const sw = ItemIconRenderer.OSRS_SPRITE_W;
        const sh = ItemIconRenderer.OSRS_SPRITE_H;

        const canvas = document.createElement("canvas");
        canvas.width = sw;
        canvas.height = sh;
        const ctx = canvas.getContext("2d", {
            willReadFrequently: true as any,
        }) as CanvasRenderingContext2D;
        const img = ctx.createImageData(sw, sh);
        const data = img.data;
        for (let i = 0, p = 0; i < pixels.length; i++, p += 4) {
            const rgb = pixels[i] | 0;
            if (rgb === 0) {
                data[p] = data[p + 1] = data[p + 2] = 0;
                data[p + 3] = 0;
                continue;
            }
            data[p] = (rgb >> 16) & 255;
            data[p + 1] = (rgb >> 8) & 255;
            data[p + 2] = rgb & 255;
            data[p + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
        return canvas;
    }

    private drawItemQuantity(
        ctx: CanvasRenderingContext2D,
        quantity: number,
        quantityMode: number,
        isStackable: boolean,
    ) {
        // Reference: UserComparator7.getItemSprite
        if (!(quantityMode === 1 || (quantityMode === 2 && isStackable))) return;

        const font = this.getFont(FONT_PLAIN_11);
        if (!font) return;

        const qty = quantity | 0;
        let text: string;
        let color: string;
        if (qty < 100_000) {
            text = String(qty);
            color = "#ffff00";
        } else if (qty < 10_000_000) {
            text = String(Math.floor(qty / 1000)) + "K";
            color = "#ffffff";
        } else {
            text = String(Math.floor(qty / 1_000_000)) + "M";
            color = "#00ff80";
        }

        // OSRS: Font.draw(var21, 0, 9, 16776960, 1) -> shadow at +1,+1 and main at +0,+0.
        font.draw(ctx, text, 1, 10, "#000001");
        font.draw(ctx, text, 0, 9, color);
    }

    private blitTransBgAt(dst: Int32Array, src: Int32Array) {
        // Equivalent to SpritePixels.drawTransBgAt(0, 0) with 0 treated as transparent.
        const len = Math.min(dst.length, src.length);
        for (let i = 0; i < len; i++) {
            const rgb = src[i] | 0;
            if (rgb !== 0) dst[i] = rgb;
        }
    }

    private getItemSpriteEntry(
        itemId: number,
        quantity: number,
        outline: number,
        shadow: number,
        quantityMode: number,
        var5: boolean,
    ): { pixels: Int32Array; isStackable: boolean; canvas?: HTMLCanvasElement } | undefined {
        const key = this.getItemSpriteKey(itemId, quantity, outline, shadow, quantityMode);
        if (!var5) {
            const cached = this.itemSpriteCache.get(key);
            if (cached) return cached;
        }

        let obj: ObjType;
        try {
            obj = this.objLoader.load(itemId) as ObjType;
        } catch {
            return undefined;
        }
        try {
            obj = obj.getCountObj(this.objLoader, quantity) as ObjType;
        } catch {}

        const model = this.objModel.getModel(obj.id, 1);
        if (!model) return undefined;

        const isStackable = obj.stackability === ObjStackability.ALWAYS;

        let overlayPixels: Int32Array | undefined;
        let overlayMode: "noteTemplate" | "notedId" | "placeholderTemplate" | null = null;

        if ((obj.noteTemplate | 0) !== -1) {
            overlayMode = "noteTemplate";
            const ov = this.getItemSpriteEntry(obj.note | 0, 10, 1, 0, 0, true);
            if (!ov) return undefined;
            overlayPixels = ov.pixels;
        } else if ((obj.notedId | 0) !== -1) {
            overlayMode = "notedId";
            const ov = this.getItemSpriteEntry(
                obj.unnotedId | 0,
                quantity,
                outline,
                shadow,
                0,
                false,
            );
            if (!ov) return undefined;
            overlayPixels = ov.pixels;
        } else if ((obj.placeholderTemplate | 0) !== -1) {
            overlayMode = "placeholderTemplate";
            const ov = this.getItemSpriteEntry(obj.placeholder | 0, quantity, 0, 0, 0, false);
            if (!ov) return undefined;
            overlayPixels = ov.pixels;
        }

        const sw = ItemIconRenderer.OSRS_SPRITE_W;
        const sh = ItemIconRenderer.OSRS_SPRITE_H;
        const base = new Int32Array(sw * sh);

        // Placeholder background is drawn BEFORE the model.
        if (overlayMode === "placeholderTemplate" && overlayPixels) {
            this.blitTransBgAt(base, overlayPixels);
        }

        // Model is drawn onto the sprite (transparent pixels leave background intact).
        const zoomMultiplier = var5 ? 1.5 : outline === 2 ? 1.04 : 1;
        const modelPixels = this.renderModelSoftwareToPixels(model, obj, sw, sh, {
            zoomMultiplier,
        });
        this.blitTransBgAt(base, modelPixels);

        // NotedId overlay is drawn AFTER the model, BEFORE outline/shadow.
        if (overlayMode === "notedId" && overlayPixels) {
            this.blitTransBgAt(base, overlayPixels);
        }

        // Outline/shadow post-process.
        const spr = SpritePixels.fromPixels(base, sw, sh);
        if (outline >= 1) spr.outline(0x0000001);
        if (outline >= 2) spr.outline(0xffffff);
        if (shadow !== 0) spr.shadow(shadow | 0);

        // NoteTemplate overlay is drawn AFTER outline/shadow.
        if (overlayMode === "noteTemplate" && overlayPixels) {
            this.blitTransBgAt(spr.pixels, overlayPixels);
        }

        const entry = { pixels: spr.pixels, isStackable } as {
            pixels: Int32Array;
            isStackable: boolean;
            canvas?: HTMLCanvasElement;
        };
        if (!var5) this.itemSpriteCache.set(key, entry);
        return entry;
    }

    setFaceVisibilityPredicate(predicate?: FaceVisibilityPredicate) {
        this.faceVisibilityPredicate = predicate;
    }

    private getTexture(id: number) {
        const cached = this.texCache.get(id);
        if (cached) return cached;
        const size = 128;
        try {
            const pixels = this.textureLoader.getPixelsArgb(id, size, true, 1.0);
            const res = { size, pixels } as const;
            this.texCache.set(id, res);
            return res;
        } catch {
            const res = { size: 0, pixels: new Int32Array(0) } as const;
            this.texCache.set(id, res);
            return res;
        }
    }

    private renderModelSoftwareToPixels(
        model: Model,
        it: ObjType,
        sw: number,
        sh: number,
        opts?: { zoomMultiplier?: number },
    ): Int32Array {
        const buf = new Int32Array(sw * sh);
        const zbuf = new Float32Array(sw * sh);
        Rasterizer2D.setRaster(buf, sw, sh);
        Rasterizer2D.fillRectangle(0, 0, sw, sh, 0x00000000);
        Rasterizer3D.setClip();
        Rasterizer3D.rasterGouraudLowRes = false;
        // Center viewport: for OSRS 36x32 icons, the original client uses (16,16)
        const osrsExact = sw === 36 && sh === 32;
        // No extra vertical scaling
        const yScaleFix = 1.0;
        const centerX = osrsExact ? 16 : (sw / 2) | 0;
        const centerY = osrsExact ? 16 : (sh / 2) | 0;
        Rasterizer3D.setViewport(centerX, centerY);
        for (let i = 0; i < zbuf.length; i++) zbuf[i] = 1e30;

        model.calculateBoundsCylinder?.();

        const var1 = 0;
        const var2 = (it.yan2d | 0) & 2047;
        const var3 = (it.zan2d | 0) & 2047;
        const var4 = (it.xan2d | 0) & 2047;
        const var5 = it.offsetX2d | 0;
        const zoom2dRaw = (it.zoom2d | 0) as number;
        const zoomMult = typeof opts?.zoomMultiplier === "number" ? opts.zoomMultiplier : 1;
        const zoom2d = Math.max(1, Math.floor(zoom2dRaw * zoomMult));
        const var6 =
            ((model.height / 2) | 0) + (((zoom2d | 0) * SINE[var4]) >> 16) + (it.offsetY2d | 0);
        const var7 = (((zoom2d | 0) * COSINE[var4]) >> 16) + (it.offsetY2d | 0);

        const var10 = SINE[var1],
            var11 = COSINE[var1];
        const var12 = SINE[var2],
            var13 = COSINE[var2];
        const var14 = SINE[var3],
            var15 = COSINE[var3];
        const var16 = SINE[var4],
            var17 = COSINE[var4];
        const var18 = (var16 * var6 + var17 * var7) >> 16;

        const vc = model.verticesCount | 0;
        // Use Int32Array for screen coordinates to match OSRS integer math exactly
        // This eliminates floating-point precision issues at shared triangle edges
        const sx = new Int32Array(vc);
        const sy = new Int32Array(vc);
        const vz = new Int32Array(vc);
        const zc = new Int32Array(vc);
        const cxv = new Int32Array(vc);
        const cyv = new Int32Array(vc);
        // Use OSRS projection scaling for exact 36x32, else scale with output size
        const zoom3d = osrsExact ? 512 : ((512 * sw) / 32) | 0;

        for (let i = 0; i < vc; i++) {
            let vx = model.verticesX[i] | 0;
            let vy = model.verticesY[i] | 0;
            let vz0 = model.verticesZ[i] | 0;
            let t: number;
            if (var3 !== 0) {
                t = (vy * var14 + vx * var15) >> 16;
                vy = (vy * var15 - vx * var14) >> 16;
                vx = t;
            }
            if (var1 !== 0) {
                t = (vy * var11 - vz0 * var10) >> 16;
                vz0 = (vy * var10 + vz0 * var11) >> 16;
                vy = t;
            }
            if (var2 !== 0) {
                t = (vz0 * var12 + vx * var13) >> 16;
                vz0 = (vz0 * var13 - vx * var12) >> 16;
                vx = t;
            }
            vx += var5;
            vy += var6;
            vz0 += var7;
            t = (vy * var17 - vz0 * var16) >> 16;
            vz0 = (vy * var16 + vz0 * var17) >> 16;
            zc[i] = vz0;
            cxv[i] = vx;
            cyv[i] = t;
            vz[i] = vz0 - var18;
            // Use OSRS-like near plane to avoid extreme distortion near camera
            // Use integer division matching OSRS exactly
            if (vz0 <= 50) {
                sx[i] = 0;
                sy[i] = 0;
            } else {
                sx[i] = (centerX + (vx * zoom3d) / vz0) | 0 | 0;
                sy[i] = (centerY + (((t * zoom3d) / vz0) | 0) * yScaleFix) | 0 | 0;
            }
        }

        // Compute projected bounds to derive auto-fit scale and offset
        let k = 1.0;
        let dx = 0.0;
        let dy = 0.0;
        if (!osrsExact) {
            let minSX = 1e9,
                minSY = 1e9,
                maxSX = -1e9,
                maxSY = -1e9;
            for (let i = 0; i < vc; i++) {
                if (zc[i] <= 50) continue;
                const px = sx[i];
                const py = sy[i];
                if (px < minSX) minSX = px;
                if (px > maxSX) maxSX = px;
                if (py < minSY) minSY = py;
                if (py > maxSY) maxSY = py;
            }
            if (!isFinite(minSX) || !isFinite(maxSX) || !isFinite(minSY) || !isFinite(maxSY)) {
                minSX = minSY = 0;
                maxSX = maxSY = 1;
            }
            const pad = 8;
            const currW = Math.max(1, (maxSX - minSX) | 0);
            const currH = Math.max(1, (maxSY - minSY) | 0);
            const targetW = Math.max(1, sw - pad * 2);
            const targetH = Math.max(1, sh - pad * 2);
            k = Math.max(0.5, Math.min(4.0, Math.min(targetW / currW, targetH / currH)));
            const cSx = (minSX + maxSX) * 0.5;
            const cSy = (minSY + maxSY) * 0.5;
            dx = (centerX - cSx) * k;
            dy = (centerY - cSy) * k;
        }

        const screenScale = osrsExact ? 1 : k;
        const screenOffsetX = osrsExact ? 0 : dx;
        const screenOffsetY = osrsExact ? 0 : dy;

        let triDrawn = 0;
        let triSkippedAlpha = 0;
        let texturedCandidateCount = 0;

        type RasterVertex = {
            x: number;
            y: number;
            invZ: number;
            uOverZ: number;
            vOverZ: number;
            iOverZ: number;
        };

        type ClipVertex = {
            x: number;
            y: number;
            z: number;
            invZ: number;
            uOverZ: number;
            vOverZ: number;
            iOverZ: number;
        };

        const isTopLeft = (ax: number, ay: number, bx: number, by: number) =>
            ay < by || (ay === by && bx < ax);

        const drawTexturedTri = (
            v0: RasterVertex,
            v1: RasterVertex,
            v2: RasterVertex,
            texPixels: Int32Array,
            texSize: number,
            faceAlpha: number,
            depthBias: number = 0,
        ) => {
            if (texSize <= 0 || texPixels.length === 0) return;

            const minX = Math.max(0, Math.floor(Math.min(v0.x, v1.x, v2.x)));
            const maxX = Math.min(sw - 1, Math.ceil(Math.max(v0.x, v1.x, v2.x)) - 1);
            const minY = Math.max(0, Math.floor(Math.min(v0.y, v1.y, v2.y)));
            const maxY = Math.min(sh - 1, Math.ceil(Math.max(v0.y, v1.y, v2.y)) - 1);
            if (minX > maxX || minY > maxY) return;

            const X0 = v0.x;
            const Y0 = v0.y;
            const X1 = v1.x;
            const Y1 = v1.y;
            const X2 = v2.x;
            const Y2 = v2.y;
            const denom = (Y1 - Y2) * (X0 - X2) + (X2 - X1) * (Y0 - Y2);
            if (denom === 0) return;
            const denomSign = denom > 0 ? 1 : -1;
            const invDenom = 1.0 / denom;
            const topLeft01 = denomSign > 0 ? isTopLeft(X0, Y0, X1, Y1) : isTopLeft(X1, Y1, X0, Y0);
            const topLeft12 = denomSign > 0 ? isTopLeft(X1, Y1, X2, Y2) : isTopLeft(X2, Y2, X1, Y1);
            const topLeft20 = denomSign > 0 ? isTopLeft(X2, Y2, X0, Y0) : isTopLeft(X0, Y0, X2, Y2);

            for (let y = minY; y <= maxY; y++) {
                const py = y + 0.5;
                for (let x = minX; x <= maxX; x++) {
                    const px = x + 0.5;

                    const w0Num = (Y1 - Y2) * (px - X2) + (X2 - X1) * (py - Y2);
                    if (w0Num * denomSign < 0 || (w0Num === 0 && !topLeft12)) continue;
                    const w1Num = (Y2 - Y0) * (px - X2) + (X0 - X2) * (py - Y2);
                    if (w1Num * denomSign < 0 || (w1Num === 0 && !topLeft20)) continue;
                    const w2Num = denom - w0Num - w1Num;
                    if (w2Num * denomSign < 0 || (w2Num === 0 && !topLeft01)) continue;

                    const w0 = w0Num * invDenom;
                    const w1 = w1Num * invDenom;
                    const w2 = w2Num * invDenom;

                    const invW = w0 * v0.invZ + w1 * v1.invZ + w2 * v2.invZ;
                    if (invW <= 0) continue;

                    const idx = y * sw + x;
                    const z = 1.0 / invW - depthBias;
                    if (z >= zbuf[idx]) continue;

                    const u = (w0 * v0.uOverZ + w1 * v1.uOverZ + w2 * v2.uOverZ) / invW;
                    const v = (w0 * v0.vOverZ + w1 * v1.vOverZ + w2 * v2.vOverZ) / invW;
                    let iInterp = (w0 * v0.iOverZ + w1 * v1.iOverZ + w2 * v2.iOverZ) / invW;
                    if (!Number.isFinite(iInterp)) iInterp = 126;
                    const shade = Math.max(0, Math.min(126, iInterp)) / 126;

                    const tx = Math.max(
                        0,
                        Math.min(texSize - 1, Math.floor((((u % 1) + 1) % 1) * texSize)),
                    );
                    const ty = Math.max(
                        0,
                        Math.min(texSize - 1, Math.floor((((v % 1) + 1) % 1) * texSize)),
                    );
                    const src = texPixels[ty * texSize + tx] >>> 0;
                    const aT = (src >>> 24) & 255;
                    if (aT < (osrsExact ? 1 : 12)) {
                        triSkippedAlpha++;
                        continue;
                    }

                    const R = (((src >> 16) & 255) * shade) | 0;
                    const G = (((src >> 8) & 255) * shade) | 0;
                    const B = ((src & 255) * shade) | 0;
                    const ai = Math.max(0, Math.min(255, faceAlpha & 255));
                    const dst = buf[idx] >>> 0;
                    const dR = (dst >> 16) & 255;
                    const dG = (dst >> 8) & 255;
                    const dB = dst & 255;
                    const aComb = Math.floor((aT * ai) / 255);
                    const outR = ((R * aComb + dR * (255 - aComb)) / 255) | 0;
                    const outG = ((G * aComb + dG * (255 - aComb)) / 255) | 0;
                    const outB = ((B * aComb + dB * (255 - aComb)) / 255) | 0;
                    buf[idx] = (outR << 16) | (outG << 8) | outB;
                    zbuf[idx] = z;
                }
            }
            triDrawn++;
        };

        const drawFlatTri = (
            v0: RasterVertex,
            v1: RasterVertex,
            v2: RasterVertex,
            c0: number,
            c1: number,
            c2: number,
            faceAlpha: number,
            depthBias: number = 0,
        ) => {
            const minX = Math.max(0, Math.floor(Math.min(v0.x, v1.x, v2.x)));
            const maxX = Math.min(sw - 1, Math.ceil(Math.max(v0.x, v1.x, v2.x)) - 1);
            const minY = Math.max(0, Math.floor(Math.min(v0.y, v1.y, v2.y)));
            const maxY = Math.min(sh - 1, Math.ceil(Math.max(v0.y, v1.y, v2.y)) - 1);
            if (minX > maxX || minY > maxY) return;

            const X0 = v0.x;
            const Y0 = v0.y;
            const X1 = v1.x;
            const Y1 = v1.y;
            const X2 = v2.x;
            const Y2 = v2.y;
            const denom = (Y1 - Y2) * (X0 - X2) + (X2 - X1) * (Y0 - Y2);
            if (denom === 0) return;
            const denomSign = denom > 0 ? 1 : -1;
            const invDenom = 1.0 / denom;

            const r0 = (c0 >> 16) & 255;
            const g0 = (c0 >> 8) & 255;
            const b0 = c0 & 255;
            const r1 = (c1 >> 16) & 255;
            const g1 = (c1 >> 8) & 255;
            const b1 = c1 & 255;
            const r2 = (c2 >> 16) & 255;
            const g2 = (c2 >> 8) & 255;
            const b2 = c2 & 255;

            const ai = Math.max(0, Math.min(255, faceAlpha & 255));

            const topLeft01 = denomSign > 0 ? isTopLeft(X0, Y0, X1, Y1) : isTopLeft(X1, Y1, X0, Y0);
            const topLeft12 = denomSign > 0 ? isTopLeft(X1, Y1, X2, Y2) : isTopLeft(X2, Y2, X1, Y1);
            const topLeft20 = denomSign > 0 ? isTopLeft(X2, Y2, X0, Y0) : isTopLeft(X0, Y0, X2, Y2);

            for (let y = minY; y <= maxY; y++) {
                const py = y + 0.5;
                for (let x = minX; x <= maxX; x++) {
                    const px = x + 0.5;

                    const w0Num = (Y1 - Y2) * (px - X2) + (X2 - X1) * (py - Y2);
                    if (w0Num * denomSign < 0 || (w0Num === 0 && !topLeft12)) continue;
                    const w1Num = (Y2 - Y0) * (px - X2) + (X0 - X2) * (py - Y2);
                    if (w1Num * denomSign < 0 || (w1Num === 0 && !topLeft20)) continue;
                    const w2Num = denom - w0Num - w1Num;
                    if (w2Num * denomSign < 0 || (w2Num === 0 && !topLeft01)) continue;

                    const w0 = w0Num * invDenom;
                    const w1 = w1Num * invDenom;
                    const w2 = w2Num * invDenom;

                    const invW = w0 * v0.invZ + w1 * v1.invZ + w2 * v2.invZ;
                    if (invW <= 0) continue;

                    const idx = y * sw + x;
                    const z = 1.0 / invW - depthBias;
                    if (z >= zbuf[idx]) continue;

                    const R = (w0 * r0 + w1 * r1 + w2 * r2) | 0;
                    const G = (w0 * g0 + w1 * g1 + w2 * g2) | 0;
                    const B = (w0 * b0 + w1 * b1 + w2 * b2) | 0;

                    const dst = buf[idx] >>> 0;
                    const dR = (dst >> 16) & 255;
                    const dG = (dst >> 8) & 255;
                    const dB = dst & 255;
                    const outR = ((R * ai + dR * (255 - ai)) / 255) | 0;
                    const outG = ((G * ai + dG * (255 - ai)) / 255) | 0;
                    const outB = ((B * ai + dB * (255 - ai)) / 255) | 0;
                    buf[idx] = (outR << 16) | (outG << 8) | outB;
                    zbuf[idx] = z;
                }
            }
            triDrawn++;
        };

        const lerp = (a: number, b: number, t: number) => a + t * (b - a);

        const clipAgainstNear = (vertices: ClipVertex[], NEAR: number): ClipVertex[] => {
            if (vertices.length === 0) return vertices;
            const out: ClipVertex[] = [];
            const clippedZ = NEAR + 1e-5;
            for (let i = 0; i < vertices.length; i++) {
                const curr = vertices[i];
                const prev = vertices[(i + vertices.length - 1) % vertices.length];
                const currIn = curr.z > NEAR;
                const prevIn = prev.z > NEAR;
                if (currIn) {
                    if (!prevIn) {
                        const t = (NEAR - prev.z) / (curr.z - prev.z);
                        out.push({
                            x: lerp(prev.x, curr.x, t),
                            y: lerp(prev.y, curr.y, t),
                            z: clippedZ,
                            invZ: lerp(prev.invZ, curr.invZ, t),
                            uOverZ: lerp(prev.uOverZ, curr.uOverZ, t),
                            vOverZ: lerp(prev.vOverZ, curr.vOverZ, t),
                            iOverZ: lerp(prev.iOverZ, curr.iOverZ, t),
                        });
                    }
                    out.push(curr);
                } else if (prevIn) {
                    const t = (NEAR - prev.z) / (curr.z - prev.z);
                    out.push({
                        x: lerp(prev.x, curr.x, t),
                        y: lerp(prev.y, curr.y, t),
                        z: clippedZ,
                        invZ: lerp(prev.invZ, curr.invZ, t),
                        uOverZ: lerp(prev.uOverZ, curr.uOverZ, t),
                        vOverZ: lerp(prev.vOverZ, curr.vOverZ, t),
                        iOverZ: lerp(prev.iOverZ, curr.iOverZ, t),
                    });
                }
            }
            return out;
        };

        const projectToScreen = (v: ClipVertex): RasterVertex | undefined => {
            const invZ = v.invZ;
            if (!Number.isFinite(invZ) || invZ <= 0) return undefined;
            const depth = 1.0 / invZ;
            if (!Number.isFinite(depth) || depth <= 0) return undefined;
            // Use integer projection matching OSRS exactly to prevent edge gaps
            const projX =
                ((centerX + (((v.x * zoom3d) / depth) | 0)) | 0) * screenScale + screenOffsetX;
            const projY =
                (((centerY + (((v.y * zoom3d) / depth) | 0) * yScaleFix) | 0 | 0) * screenScale +
                    screenOffsetY) |
                0;
            return {
                x: projX,
                y: projY,
                invZ,
                uOverZ: v.uOverZ,
                vOverZ: v.vOverZ,
                iOverZ: v.iOverZ,
            };
        };

        const fc = model.faceCount | 0;
        const facePredicate = this.faceVisibilityPredicate;
        // Pre-calculate all face depths for sorting
        const faceDepths = new Int32Array(fc);
        for (let f = 0; f < fc; f++) {
            const a = model.indices1[f] | 0;
            const b = model.indices2[f] | 0;
            const c = model.indices3[f] | 0;
            faceDepths[f] = vz[a] + vz[b] + vz[c];
        }

        // Bucket faces by render priority
        const priorities = model.faceRenderPriorities;
        const faceLists: number[][] = Array.from({ length: 12 }, () => []);
        for (let f = 0; f < fc; f++) {
            if (facePredicate && !facePredicate(model, f)) continue;

            // OSRS skips these faces entirely.
            if (model.faceColors3 && model.faceColors3[f] === -2) continue;

            const p = priorities ? priorities[f] & 0xff : 0;
            faceLists[p].push(f);
        }

        let facesTextured = 0;
        let facesFlat = 0;
        let facesClipped = 0;
        const overlayFlatFaces: Array<{
            faceIndex: number;
            c0: number;
            c1: number;
            c2: number;
            faceAlpha: number;
            depthBias: number;
        }> = [];
        const overlayDepthBias = 5.0;

        const renderFlatFace = (
            faceIndex: number,
            c0: number,
            c1: number,
            c2: number,
            faceAlpha: number,
            depthBias: number,
        ) => {
            const aIdx = model.indices1[faceIndex] | 0;
            const bIdx = model.indices2[faceIndex] | 0;
            const cIdx = model.indices3[faceIndex] | 0;

            const baseVertices: ClipVertex[] = [
                {
                    x: cxv[aIdx],
                    y: cyv[aIdx],
                    z: zc[aIdx],
                    invZ: zc[aIdx] > 0 ? 1.0 / zc[aIdx] : 0,
                    uOverZ: 0,
                    vOverZ: 0,
                    iOverZ: 0,
                },
                {
                    x: cxv[bIdx],
                    y: cyv[bIdx],
                    z: zc[bIdx],
                    invZ: zc[bIdx] > 0 ? 1.0 / zc[bIdx] : 0,
                    uOverZ: 0,
                    vOverZ: 0,
                    iOverZ: 0,
                },
                {
                    x: cxv[cIdx],
                    y: cyv[cIdx],
                    z: zc[cIdx],
                    invZ: zc[cIdx] > 0 ? 1.0 / zc[cIdx] : 0,
                    uOverZ: 0,
                    vOverZ: 0,
                    iOverZ: 0,
                },
            ];

            const clipped = clipAgainstNear(baseVertices, 50.0);
            if (clipped.length < 3) {
                facesClipped++;
                return;
            }

            facesFlat++;
            for (let t = 1; t < clipped.length - 1; t++) {
                const vA = clipped[0];
                const vB = clipped[t];
                const vC = clipped[t + 1];
                const s0 = projectToScreen(vA);
                const s1 = projectToScreen(vB);
                const s2 = projectToScreen(vC);
                if (!s0 || !s1 || !s2) continue;
                const orient2 = (s1.x - s0.x) * (s2.y - s0.y) - (s1.y - s0.y) * (s2.x - s0.x);
                // Use small epsilon to avoid culling nearly-degenerate triangles on curved surfaces
                if (orient2 >= -0.01) continue;

                drawFlatTri(s0, s1, s2, c0, c1, c2, faceAlpha, depthBias);
            }
        };

        // Draw faces, iterating through priorities to respect transparency
        for (let p = 0; p < 12; p++) {
            const list = faceLists[p];
            if (list.length === 0) continue;

            // Sort this priority group by depth, back-to-front
            list.sort((fA, fB) => faceDepths[fB] - faceDepths[fA]);

            for (const f of list) {
                const a = model.indices1[f] | 0;
                const b = model.indices2[f] | 0;
                const c = model.indices3[f] | 0;
                const faceTexId = model.faceTextures ? model.faceTextures[f] : -1;
                const faceAlphaArr = model.faceAlphas;
                const faceAlpha = faceAlphaArr ? 0xff - (faceAlphaArr[f] & 0xff) : 0xff;
                if (faceTexId !== -1) {
                    texturedCandidateCount++;
                }

                const isPriorityOverlay = p > 0;
                const depthBias = p > 0 ? overlayDepthBias * p : 0;
                const uvsArr = (model as any).uvs as number[] | undefined;

                if (faceTexId !== -1 && uvsArr) {
                    const uvs = uvsArr;
                    const uvIndex = f * 6;
                    const u0 = uvs ? uvs[uvIndex] : 0;
                    const v0 = uvs ? uvs[uvIndex + 1] : 0;
                    const u1 = uvs ? uvs[uvIndex + 2] : 0;
                    const v1 = uvs ? uvs[uvIndex + 3] : 0;
                    const u2 = uvs ? uvs[uvIndex + 4] : 0;
                    const v2 = uvs ? uvs[uvIndex + 5] : 0;

                    if (!uvs) {
                        continue;
                    }
                    let i0 = model.faceColors1 ? model.faceColors1[f] : 126;
                    let i1 = model.faceColors2 ? model.faceColors2[f] : 126;
                    let i2v = model.faceColors3 ? model.faceColors3[f] : 126;
                    if (model.faceColors3 && model.faceColors3[f] === -1) {
                        i1 = i0;
                        i2v = i0;
                    } else if (i2v < 0) {
                        i2v = i1 > 0 ? i1 : i0;
                    }
                    const tex = this.getTexture(faceTexId);

                    const zA = zc[a];
                    const zB = zc[b];
                    const zC = zc[c];
                    const invZA = zA > 0 ? 1.0 / zA : 0;
                    const invZB = zB > 0 ? 1.0 / zB : 0;
                    const invZC = zC > 0 ? 1.0 / zC : 0;
                    const poly: ClipVertex[] = [
                        {
                            x: cxv[a],
                            y: cyv[a],
                            z: zA,
                            invZ: invZA,
                            uOverZ: u0 * invZA,
                            vOverZ: v0 * invZA,
                            iOverZ: i0 * invZA,
                        },
                        {
                            x: cxv[b],
                            y: cyv[b],
                            z: zB,
                            invZ: invZB,
                            uOverZ: u1 * invZB,
                            vOverZ: v1 * invZB,
                            iOverZ: i1 * invZB,
                        },
                        {
                            x: cxv[c],
                            y: cyv[c],
                            z: zC,
                            invZ: invZC,
                            uOverZ: u2 * invZC,
                            vOverZ: v2 * invZC,
                            iOverZ: i2v * invZC,
                        },
                    ];
                    const clipped = clipAgainstNear(poly, 50.0);
                    if (clipped.length >= 3) {
                        facesTextured++;
                        for (let t = 1; t < clipped.length - 1; t++) {
                            const vA = clipped[0];
                            const vB = clipped[t];
                            const vC = clipped[t + 1];
                            const s0 = projectToScreen(vA);
                            const s1 = projectToScreen(vB);
                            const s2 = projectToScreen(vC);
                            if (!s0 || !s1 || !s2) continue;
                            const orient2 =
                                (s1.x - s0.x) * (s2.y - s0.y) - (s1.y - s0.y) * (s2.x - s0.x);
                            if (orient2 >= 0) continue;

                            drawTexturedTri(s0, s1, s2, tex.pixels, tex.size, faceAlpha, depthBias);
                        }
                    } else {
                        facesClipped++;
                    }
                } else {
                    // Flat shaded face with near-plane clipping similar to textured path
                    let i0c = model.faceColors1
                        ? model.faceColors1[f]
                        : (model as any).faceColors?.[f];
                    let i1c = model.faceColors2
                        ? model.faceColors2[f]
                        : (model as any).faceColors?.[f];
                    let i2c = model.faceColors3
                        ? model.faceColors3[f]
                        : (model as any).faceColors?.[f];
                    if (model.faceColors3 && model.faceColors3[f] === -1) {
                        i1c = i0c;
                        i2c = i0c;
                    } else if ((i2c | 0) < 0) {
                        i2c = i1c;
                    }
                    const c0 = HSL_RGB_MAP[(i0c & 0xffff) | 0] | 0;
                    const c1 = HSL_RGB_MAP[(i1c & 0xffff) | 0] | 0;
                    const c2 = HSL_RGB_MAP[(i2c & 0xffff) | 0] | 0;

                    // OSRS skips faceColors3 == -2 completely.
                    if (model.faceColors3 && model.faceColors3[f] === -2) {
                        continue;
                    }

                    if (isPriorityOverlay) {
                        overlayFlatFaces.push({
                            faceIndex: f,
                            c0,
                            c1,
                            c2,
                            faceAlpha,
                            depthBias,
                        });
                        continue;
                    }
                    renderFlatFace(f, c0, c1, c2, faceAlpha, depthBias);
                }
            }
        }

        if (overlayFlatFaces.length) {
            overlayFlatFaces.sort((a, b) => faceDepths[b.faceIndex] - faceDepths[a.faceIndex]);
            for (const overlay of overlayFlatFaces) {
                renderFlatFace(
                    overlay.faceIndex,
                    overlay.c0,
                    overlay.c1,
                    overlay.c2,
                    overlay.faceAlpha,
                    overlay.depthBias,
                );
            }
        }

        return buf;
    }
}
