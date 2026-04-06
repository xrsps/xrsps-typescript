import type { CacheIndex } from "../../rs/cache/CacheIndex";
import { IndexedSprite } from "../../rs/sprite/IndexedSprite";
import { SpriteLoader } from "../../rs/sprite/SpriteLoader";
import { SpritePixels } from "../../rs/sprite/SpritePixels";
import type { GLRenderer } from "./renderer";

function resolveSpriteAlpha(sprite: IndexedSprite): Uint8Array | undefined {
    let alpha = sprite.alpha;
    if (alpha) {
        let anyNonZero = false;
        for (let i = 0; i < alpha.length; i++) {
            if (alpha[i] !== 0) {
                anyNonZero = true;
                break;
            }
        }
        if (!anyNonZero) alpha = undefined;
    }
    return alpha;
}

function spriteToCanvas(sprite: IndexedSprite): HTMLCanvasElement {
    try {
        sprite.normalize();
    } catch {}
    const w = sprite.width || sprite.subWidth;
    const h = sprite.height || sprite.subHeight;
    const cw = Math.max(1, w);
    const ch = Math.max(1, h);
    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d", {
        willReadFrequently: true as any,
    }) as CanvasRenderingContext2D;
    const img = ctx.createImageData(cw, ch);
    const pal = sprite.palette;
    const px = sprite.pixels;
    const alpha = resolveSpriteAlpha(sprite);
    const sw = sprite.subWidth;
    const sh = sprite.subHeight;
    const ox = sprite.xOffset | 0;
    const oy = sprite.yOffset | 0;
    for (let y = 0; y < sh; y++) {
        for (let x = 0; x < sw; x++) {
            const si = x + y * sw;
            const idx = px[si] & 0xff;
            // Palette index 0 is always transparent (no color to render)
            if (idx === 0) continue;
            const dx = x + ox;
            const dy = y + oy;
            if (dx < 0 || dy < 0 || dx >= cw || dy >= ch) continue;
            const di = (dx + dy * cw) * 4;
            const rgb = pal[idx];
            img.data[di] = (rgb >> 16) & 0xff;
            img.data[di + 1] = (rgb >> 8) & 0xff;
            img.data[di + 2] = rgb & 0xff;
            // Use per-pixel alpha if present, otherwise fully opaque
            img.data[di + 3] = alpha ? alpha[si] : 255;
        }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
}

function createCanvasFromPixels(
    pixels: Uint8ClampedArray,
    width: number,
    height: number,
): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, width);
    canvas.height = Math.max(1, height);
    const ctx = canvas.getContext("2d", {
        willReadFrequently: true as any,
    }) as CanvasRenderingContext2D;
    const imageData = ctx.createImageData(canvas.width, canvas.height);
    imageData.data.set(pixels);
    ctx.putImageData(imageData, 0, 0);
    return canvas;
}

function indexedSpriteToSpritePixels(sprite: IndexedSprite): SpritePixels {
    const pixelCount = Math.max(0, (sprite.subWidth | 0) * (sprite.subHeight | 0));
    const pixels = new Int32Array(pixelCount);
    const palette = sprite.palette;
    const indexedPixels = sprite.pixels;
    const alpha = resolveSpriteAlpha(sprite);
    for (let i = 0; i < pixelCount; i++) {
        const paletteIndex = indexedPixels[i] & 0xff;
        if (paletteIndex === 0) continue;
        const a = alpha ? alpha[i] & 0xff : 0xff;
        if (a === 0) continue;
        pixels[i] = ((a & 0xff) << 24) | (palette[paletteIndex] & 0xffffff);
    }
    const result = new SpritePixels();
    result.pixels = pixels;
    result.subWidth = Math.max(1, sprite.subWidth | 0);
    result.subHeight = Math.max(1, sprite.subHeight | 0);
    result.xOffset = sprite.xOffset | 0;
    result.yOffset = sprite.yOffset | 0;
    result.width = Math.max(1, sprite.width | 0);
    result.height = Math.max(1, sprite.height | 0);
    return result;
}

function widgetSpriteToCanvas(
    sprite: IndexedSprite,
    flipH: boolean,
    flipV: boolean,
    borderType: number,
    shadowColor: number,
): HTMLCanvasElement {
    const transformed = indexedSpriteToSpritePixels(sprite);
    if (flipV) transformed.flipVertically();
    if (flipH) transformed.flipHorizontally();
    if ((borderType | 0) > 0) transformed.pad(borderType | 0);
    if ((borderType | 0) >= 1) transformed.outline(0x000001);
    if ((borderType | 0) >= 2) transformed.outline(0xffffff);
    if ((shadowColor | 0) !== 0) transformed.shadow(shadowColor | 0);

    const normalized = transformed.copyNormalized();
    const width = Math.max(1, normalized.subWidth | 0);
    const height = Math.max(1, normalized.subHeight | 0);
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < normalized.pixels.length; i++) {
        const pixel = normalized.pixels[i] | 0;
        if (pixel === 0) continue;
        const dstIndex = i * 4;
        data[dstIndex] = (pixel >>> 16) & 0xff;
        data[dstIndex + 1] = (pixel >>> 8) & 0xff;
        data[dstIndex + 2] = pixel & 0xff;
        const alpha = (pixel >>> 24) & 0xff;
        data[dstIndex + 3] = alpha !== 0 ? alpha : 0xff;
    }

    return createCanvasFromPixels(data, width, height);
}

export class TextureCache {
    private glr: GLRenderer;
    private spriteIndex: CacheIndex;
    private itemIconCanvas?: (
        itemId: number,
        qty?: number,
        outline?: number,
        shadow?: number,
        quantityMode?: number,
    ) => HTMLCanvasElement | undefined;

    constructor(
        glr: GLRenderer,
        spriteIndex: CacheIndex,
        itemIconCanvas?: (
            id: number,
            qty?: number,
            outline?: number,
            shadow?: number,
            quantityMode?: number,
        ) => HTMLCanvasElement | undefined,
    ) {
        this.glr = glr;
        this.spriteIndex = spriteIndex;
        this.itemIconCanvas = itemIconCanvas;
    }

    getCacheStats(): {
        glTextures: number;
        spriteCanvas: number;
        urlImages: number;
        urlPending: number;
    } {
        const spriteCanvasCache = (this as any).__spriteCanvasCache as
            | Map<string, HTMLCanvasElement>
            | undefined;
        return {
            glTextures: this.glr.textures.size,
            spriteCanvas: spriteCanvasCache?.size ?? 0,
            urlImages: this.loadedImages.size,
            urlPending: this.pendingUrlLoads.size,
        };
    }

    getSpriteById(id: number) {
        const key = `spr:${id}`;
        const cached = this.glr.getTexture(key);
        if (cached) return cached;
        try {
            const spr = SpriteLoader.loadIntoIndexedSprite(this.spriteIndex, id);
            if (!spr) return undefined;
            const can = spriteToCanvas(spr);
            return this.glr.createTextureFromCanvas(key, can);
        } catch {
            return undefined;
        }
    }

    getWidgetSpriteById(
        id: number,
        options?: {
            borderType?: number;
            shadowColor?: number;
            flipH?: boolean;
            flipV?: boolean;
        },
    ) {
        const borderType = options?.borderType ?? 0;
        const shadowColor = options?.shadowColor ?? 0;
        const flipH = options?.flipH === true;
        const flipV = options?.flipV === true;
        if (borderType === 0 && shadowColor === 0 && !flipH && !flipV) {
            return this.getSpriteById(id);
        }

        const key = `wspr:${id}:${borderType | 0}:${shadowColor | 0}:${flipH ? 1 : 0}:${
            flipV ? 1 : 0
        }`;
        const cached = this.glr.getTexture(key);
        if (cached) return cached;
        try {
            const sprite = SpriteLoader.loadIntoIndexedSprite(this.spriteIndex, id);
            if (!sprite) return undefined;
            const canvas = widgetSpriteToCanvas(
                sprite,
                flipH,
                flipV,
                borderType | 0,
                shadowColor | 0,
            );
            return this.glr.createTextureFromCanvas(key, canvas);
        } catch {
            return undefined;
        }
    }

    getSpriteByArchiveFrame(archiveId: number, frameIndex: number) {
        const archive = archiveId | 0;
        const frame = frameIndex | 0;
        const key = `sprf:${archive}:${frame}`;
        const cached = this.glr.getTexture(key);
        if (cached) return cached;
        try {
            const sprites = SpriteLoader.loadIntoIndexedSprites(this.spriteIndex, archive);
            const spr = sprites?.[frame];
            if (!spr) return undefined;
            const can = spriteToCanvas(spr);
            return this.glr.createTextureFromCanvas(key, can);
        } catch {
            return undefined;
        }
    }

    getByNameToken(token: string) {
        const key = `tok:${token}`;
        const cached = this.glr.getTexture(key);
        if (cached) return cached;
        try {
            let archiveId = (this.spriteIndex as any).getArchiveId?.(token);
            let frameIndex: number | null = null;

            if (typeof archiveId !== "number" || archiveId < 0) {
                const commaIdx = token.lastIndexOf(",");
                if (commaIdx > -1 && commaIdx < token.length - 1) {
                    const candidate = token.slice(commaIdx + 1);
                    if (/^\d+$/.test(candidate)) {
                        const archiveToken = token.slice(0, commaIdx);
                        const fallbackId = (this.spriteIndex as any).getArchiveId?.(archiveToken);
                        if (typeof fallbackId === "number" && fallbackId >= 0) {
                            archiveId = fallbackId;
                            frameIndex = Number(candidate);
                        }
                    }
                }
            }

            if (typeof archiveId !== "number" || archiveId < 0) return undefined;

            if (frameIndex != null) {
                const sprites = SpriteLoader.loadIntoIndexedSprites(this.spriteIndex, archiveId);
                const sprite = sprites?.[frameIndex] ?? sprites?.[0];
                if (!sprite) return undefined;
                return this.glr.createTextureFromCanvas(key, spriteToCanvas(sprite));
            }

            const spr = SpriteLoader.loadIntoIndexedSprite(this.spriteIndex, archiveId);
            if (!spr) return undefined;
            return this.glr.createTextureFromCanvas(key, spriteToCanvas(spr));
        } catch {
            return undefined;
        }
    }

    /**
     * Load a sprite by its archive/sprite ID (used for minimap icons).
     * @param spriteId The sprite archive ID
     */
    getBySpriteId(spriteId: number) {
        const key = `sprite:${spriteId}`;
        const cached = this.glr.getTexture(key);
        if (cached) return cached;
        try {
            const spr = SpriteLoader.loadIntoIndexedSprite(this.spriteIndex, spriteId);
            if (!spr) return undefined;
            return this.glr.createTextureFromCanvas(key, spriteToCanvas(spr));
        } catch {
            return undefined;
        }
    }

    public getItemIconById(
        itemId: number,
        quantity: number = 1,
        outline: number = 0,
        shadow: number = 0,
        quantityMode: number = 2,
    ) {
        // key matches UserComparator7.getItemSprite var6 packing.
        let mode = quantityMode | 0;
        const qty = quantity | 0;
        if (qty === -1) mode = 0;
        else if (mode === 2 && qty !== 1) mode = 1;

        const key = `item:${itemId | 0}:${qty}:${outline | 0}:${shadow | 0}:${mode}`;
        const cached = this.glr.getTexture(key);
        if (cached) return cached;
        try {
            if (this.itemIconCanvas) {
                const can = this.itemIconCanvas(itemId, qty, outline | 0, shadow | 0, mode);
                if (can) return this.glr.createTextureFromCanvas(key, can);
            }
        } catch {}
        try {
            const tokOrder = [
                `obj_icons,${itemId}`,
                `inv,${itemId}`,
                `obj,${itemId}`,
                `item,${itemId}`,
            ];
            for (const tok of tokOrder) {
                const t = this.getByNameToken(tok);
                if (t) return t;
            }
        } catch {}
        return undefined;
    }

    /**
     * MINIMAP: Get a sprite frame as an HTMLCanvasElement for canvas compositing.
     * Used by minimap to draw sprites like mapdots and mapmarker on the minimap canvas.
     * @param archiveName The sprite archive name (e.g., "mapdots", "mapmarker")
     * @param frameIndex The frame index within the sprite archive
     * @returns HTMLCanvasElement if loaded, undefined otherwise
     */
    getSpriteCanvas(archiveName: string, frameIndex: number = 0): HTMLCanvasElement | undefined {
        const key = `sprcan:${archiveName}:${frameIndex}`;
        // Check cache
        const cached = (this as any).__spriteCanvasCache?.get(key);
        if (cached) return cached;

        try {
            const archiveId = (this.spriteIndex as any).getArchiveId?.(archiveName);
            if (typeof archiveId !== "number" || archiveId < 0) return undefined;

            const sprites = SpriteLoader.loadIntoIndexedSprites(this.spriteIndex, archiveId);
            const sprite = sprites?.[frameIndex];
            if (!sprite) return undefined;

            const canvas = spriteToCanvas(sprite);

            // Cache the canvas
            if (!(this as any).__spriteCanvasCache) {
                (this as any).__spriteCanvasCache = new Map<string, HTMLCanvasElement>();
            }
            (this as any).__spriteCanvasCache.set(key, canvas);

            return canvas;
        } catch {
            return undefined;
        }
    }

    /**
     * MINIMAP: Pending URL texture loads to avoid duplicate requests.
     * Key: url, Value: Promise that resolves when loaded
     */
    private pendingUrlLoads: Map<string, Promise<void>> = new Map();

    /**
     * MINIMAP: Cache of loaded images by URL for canvas compositing.
     * Key: url, Value: HTMLImageElement
     */
    private loadedImages: Map<string, HTMLImageElement> = new Map();

    /**
     * MINIMAP: Load a texture from a URL (used for map image tiles).
     * Returns immediately if cached, otherwise starts async load.
     * @param url The URL to load the image from
     * @returns The cached texture if available, undefined if still loading
     */
    getTextureFromUrl(url: string) {
        const key = `url:${url}`;
        const cached = this.glr.getTexture(key);
        if (cached) return cached;

        // Don't start duplicate loads
        if (this.pendingUrlLoads.has(url)) return undefined;

        // Start async load
        const loadPromise = this.loadTextureFromUrl(url, key);
        this.pendingUrlLoads.set(url, loadPromise);
        loadPromise.finally(() => this.pendingUrlLoads.delete(url));

        return undefined;
    }

    /**
     * MINIMAP: Get the loaded HTMLImageElement for a URL.
     * Used by minimap renderer to composite tiles on canvas.
     * @param url The URL of the image
     * @returns The HTMLImageElement if loaded, undefined otherwise
     */
    getLoadedImage(url: string): HTMLImageElement | undefined {
        return this.loadedImages.get(url);
    }

    /**
     * MINIMAP: Async helper to load texture from URL.
     */
    private async loadTextureFromUrl(url: string, key: string): Promise<void> {
        try {
            const img = new Image();
            img.crossOrigin = "anonymous";

            await new Promise<void>((resolve, reject) => {
                img.onload = () => resolve();
                img.onerror = () => reject(new Error(`Failed to load: ${url}`));
                img.src = url;
            });

            // Store the image for canvas compositing
            this.loadedImages.set(url, img);

            // Create canvas from image for WebGL texture
            const canvas = document.createElement("canvas");
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext("2d");
            if (!ctx) return;
            ctx.drawImage(img, 0, 0);

            // Create texture
            this.glr.createTextureFromCanvas(key, canvas);
        } catch {
            // Silently fail - texture just won't be available
        }
    }
}
