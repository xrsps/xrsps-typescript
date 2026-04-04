import { COSINE, SINE } from "../../rs/MathConstants";
import { ObjModelLoader } from "../../rs/config/objtype/ObjModelLoader";
import type { ObjTypeLoader } from "../../rs/config/objtype/ObjTypeLoader";
import type { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import { Rasterizer2D } from "../../rs/graphics/Rasterizer2D";
import { Rasterizer3D } from "../../rs/graphics/Rasterizer3D";
import { Model } from "../../rs/model/Model";
import type { ModelLoader } from "../../rs/model/ModelLoader";
import type { SeqFrameLoader } from "../../rs/model/seq/SeqFrameLoader";
import type { SkeletalSeqLoader } from "../../rs/model/skeletal/SkeletalSeqLoader";
import type { TextureLoader } from "../../rs/texture/TextureLoader";
import { HSL_RGB_MAP } from "../../rs/util/ColorUtil";

export type Model2DParams = {
    xan2d?: number;
    yan2d?: number;
    zan2d?: number;
    zoom2d?: number;
    zoom3d?: number;
    offsetX2d?: number;
    offsetY2d?: number;
    orthographic?: boolean;
    // UI/item sprites in OSRS do not z-test; default to no depth testing
    depthTest?: boolean;
    // Optional animation sequence for widget model (matches OSRS widget type-6 behaviour)
    sequenceId?: number;
    /** Optional frame index for the widget model sequence (Widget.modelFrame). */
    sequenceFrame?: number;
    // Lighting parameters
    ambient?: number;
    contrast?: number;
    lightX?: number;
    lightY?: number;
    lightZ?: number;
};

/**
 * Software-only 3D model → 2D sprite renderer for UI widgets (IF3 type-6).
 * Standalone implementation matching the item icon software pipeline behaviour.
 */
export class Model2DRenderer {
    private objModel: ObjModelLoader;
    private modelLoader: ModelLoader;
    private textureLoader: TextureLoader;
    private seqTypeLoader?: SeqTypeLoader;
    private seqFrameLoader?: SeqFrameLoader;
    private skeletalSeqLoader?: SkeletalSeqLoader;
    private texCache = new Map<number, { size: number; pixels: Int32Array }>();
    debug?: boolean;
    logger?: typeof console.log;

    constructor(
        objLoader: ObjTypeLoader,
        modelLoader: ModelLoader,
        textureLoader: TextureLoader,
        seqTypeLoader?: SeqTypeLoader,
        seqFrameLoader?: SeqFrameLoader,
        skeletalSeqLoader?: SkeletalSeqLoader,
    ) {
        this.objModel = new ObjModelLoader(objLoader, modelLoader, textureLoader);
        this.modelLoader = modelLoader;
        this.textureLoader = textureLoader;
        this.seqTypeLoader = seqTypeLoader;
        this.seqFrameLoader = seqFrameLoader;
        this.skeletalSeqLoader = skeletalSeqLoader;
    }

    renderToCanvas(modelId: number, params: Model2DParams, width: number, height: number) {
        // Kept for backward-compat: render clipped to the provided width/height
        const md = this.modelLoader.getModel(modelId);
        if (!md) return undefined;

        const ambient = params.ambient ?? 64;
        const contrast = params.contrast ?? 768;
        const lx = params.lightX ?? -50;
        const ly = params.lightY ?? -10;
        const lz = params.lightZ ?? -50;

        const model = md.light(this.textureLoader, ambient, contrast, lx, ly, lz) as Model;
        const itFake = {
            id: modelId,
            xan2d: params.xan2d ?? 0,
            yan2d: params.yan2d ?? 0,
            zan2d: params.zan2d ?? 0,
            zoom2d: params.zoom2d ?? 2000,
            zoom3d: params.zoom3d,
            offsetX2d: params.offsetX2d ?? 0,
            offsetY2d: params.offsetY2d ?? 0,
        };
        const sw = Math.max(1, width | 0);
        const sh = Math.max(1, height | 0);
        const rgba: Uint8ClampedArray = this.renderModelSoftwareToPixels(
            model,
            itFake,
            sw,
            sh,
            !!params.orthographic,
            undefined,
            params.depthTest === true,
        );
        const can = document.createElement("canvas");
        can.width = sw;
        can.height = sh;
        const ctx = can.getContext("2d", {
            willReadFrequently: true as any,
        }) as CanvasRenderingContext2D | null;
        if (!ctx) return can;
        const img = ctx.createImageData(sw, sh);
        img.data.set(rgba);
        ctx.putImageData(img, 0, 0);
        return can;
    }

    renderToCanvasExtents(
        modelId: number,
        params: Model2DParams,
        _widgetWidth: number,
        _widgetHeight: number,
    ): { canvas: HTMLCanvasElement; offsetX: number; offsetY: number } | undefined {
        const md = this.modelLoader.getModel(modelId);
        if (!md) return undefined;

        const ambient = params.ambient ?? 64;
        const contrast = params.contrast ?? 768;
        const lx = params.lightX ?? -50;
        const ly = params.lightY ?? -10;
        const lz = params.lightZ ?? -50;

        let model = md.light(this.textureLoader, ambient, contrast, lx, ly, lz) as Model;
        model = this.applySequence(model, params.sequenceId, params.sequenceFrame);
        return this.renderModelExtents(model, params, modelId);
    }

    renderItemToCanvasExtents(
        itemId: number,
        quantity: number,
        params: Model2DParams,
        _widgetWidth: number,
        _widgetHeight: number,
    ): { canvas: HTMLCanvasElement; offsetX: number; offsetY: number } | undefined {
        const model = this.objModel.getModel(itemId | 0, quantity | 0);
        if (!model) return undefined;

        const animated = this.applySequence(model, params.sequenceId, params.sequenceFrame);
        return this.renderModelExtents(animated, params, itemId | 0);
    }

    renderModelInstanceToCanvasExtents(
        model: Model,
        params: Model2DParams,
        reuseCanvas?: HTMLCanvasElement,
    ): { canvas: HTMLCanvasElement; offsetX: number; offsetY: number } | undefined {
        model = this.applySequence(model, params.sequenceId, params.sequenceFrame);
        return this.renderModelExtents(model, params, (model as any)?.id, reuseCanvas);
    }

    /**
     * Render a prebuilt Model into a fixed widget-sized canvas.
     * This matches OSRS widget model drawing semantics (draw into widget bounds, anchored at widget center).
     */
    renderModelInstanceToCanvasWidget(
        model: Model,
        params: Model2DParams,
        widgetWidth: number,
        widgetHeight: number,
        reuseCanvas?: HTMLCanvasElement,
    ): { canvas: HTMLCanvasElement; offsetX: number; offsetY: number } | undefined {
        model = this.applySequence(model, params.sequenceId, params.sequenceFrame);

        const sw = Math.max(1, widgetWidth | 0);
        const sh = Math.max(1, widgetHeight | 0);
        const rgba: Uint8ClampedArray = this.renderModelSoftwareToPixels(
            model,
            {
                id: (model as any)?.id ?? 0,
                xan2d: params.xan2d ?? 0,
                yan2d: params.yan2d ?? 0,
                zan2d: params.zan2d ?? 0,
                zoom2d: params.zoom2d ?? 2000,
                zoom3d: params.zoom3d,
                offsetX2d: params.offsetX2d ?? 0,
                offsetY2d: params.offsetY2d ?? 0,
            },
            sw,
            sh,
            !!params.orthographic,
            undefined,
            params.depthTest === true,
        );

        const can = reuseCanvas ?? document.createElement("canvas");
        if (can.width !== sw) can.width = sw;
        if (can.height !== sh) can.height = sh;
        const ctx = can.getContext("2d", {
            willReadFrequently: true as any,
        }) as CanvasRenderingContext2D | null;
        if (!ctx) {
            return { canvas: can, offsetX: (sw / 2) | 0, offsetY: (sh / 2) | 0 };
        }
        const img = ctx.createImageData(sw, sh);
        img.data.set(rgba);
        ctx.putImageData(img, 0, 0);
        return { canvas: can, offsetX: (sw / 2) | 0, offsetY: (sh / 2) | 0 };
    }

    private applySequence(model: Model, sequenceId?: number, sequenceFrame?: number): Model {
        if (sequenceId == null || sequenceId < 0 || !this.seqTypeLoader) {
            return model;
        }

        const seq = this.seqTypeLoader.load(sequenceId);
        if (!seq) return model;

        const frameIdx = (sequenceFrame ?? 0) | 0;

        // Cached (skeletal) sequence: mirror SequenceDefinition.transformWidgetModel -> transformActorModel.
        if (seq.isSkeletalSeq?.()) {
            const skeletal = this.skeletalSeqLoader?.load(seq.skeletalId);
            if (!skeletal) return model;
            const duration = seq.getSkeletalDuration?.() | 0;
            const local = duration > 0 ? ((frameIdx % duration) + duration) % duration : 0;
            const animated = Model.copyAnimated(model, true, true);
            animated.animateSkeletal(skeletal, local | 0);
            return animated;
        }

        if (!this.seqFrameLoader || !Array.isArray(seq.frameIds) || seq.frameIds.length === 0) {
            return model;
        }

        const safeFrame = frameIdx >= 0 && frameIdx < seq.frameIds.length ? frameIdx : 0;
        const baseId = seq.frameIds[safeFrame] | 0;
        const baseFrame = this.seqFrameLoader.load(baseId);
        if (!baseFrame) return model;

        // Optional chat overlay frame (SequenceDefinition.chatFrameIds).
        let overlayFrame: any | undefined;
        if (Array.isArray(seq.chatFrameIds) && safeFrame < seq.chatFrameIds.length) {
            const overlayId = seq.chatFrameIds[safeFrame] | 0;
            const overlayLow = overlayId & 0xffff;
            if (overlayLow !== 0xffff) {
                overlayFrame = this.seqFrameLoader.load(overlayId);
            }
        }

        const shallowAlpha =
            !baseFrame.hasAlphaTransform && !(overlayFrame && overlayFrame.hasAlphaTransform);
        const shallowColors =
            !baseFrame.hasColorTransform && !(overlayFrame && overlayFrame.hasColorTransform);

        const animated = Model.copyAnimated(model, shallowAlpha, shallowColors);
        animated.animate(baseFrame, undefined, !!seq.op14);
        if (overlayFrame) {
            animated.animate(overlayFrame, undefined, !!seq.op14);
        }
        return animated;
    }

    private renderModelExtents(
        model: Model,
        params: Model2DParams,
        modelIdOverride?: number,
        reuseCanvas?: HTMLCanvasElement,
    ): { canvas: HTMLCanvasElement; offsetX: number; offsetY: number } | undefined {
        const it = {
            id: modelIdOverride ?? 0,
            xan2d: params.xan2d ?? 0,
            yan2d: params.yan2d ?? 0,
            zan2d: params.zan2d ?? 0,
            zoom2d: params.zoom2d ?? 2000,
            zoom3d: params.zoom3d,
            offsetX2d: params.offsetX2d ?? 0,
            offsetY2d: params.offsetY2d ?? 0,
        };

        // First pass: project vertices to 2D to determine tight bounds (no center or dx/dy applied)
        const NEAR = 50;
        const var1 = 0;
        const var2 = (it.yan2d | 0) & 2047;
        const var3 = (it.zan2d | 0) & 2047;
        const var4 = (it.xan2d | 0) & 2047;
        const var5 = it.offsetX2d | 0;
        const var6 = (((it.zoom2d | 0) * SINE[var4]) >> 16) + (it.offsetY2d | 0);
        const var7 = (((it.zoom2d | 0) * COSINE[var4]) >> 16) + (it.offsetY2d | 0);

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
        const zoom3d = Math.max(1, (it.zoom3d ?? 512) | 0);
        let minX = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        const orthographic = !!params.orthographic;
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
            // Predict projected 2D without a center/offset; skip behind near for perspective
            if (!orthographic) {
                if (vz0 <= NEAR) continue;
                const px = (vx * zoom3d) / vz0;
                const py = (t * zoom3d) / vz0;
                if (px < minX) minX = px;
                if (px > maxX) maxX = px;
                if (py < minY) minY = py;
                if (py > maxY) maxY = py;
            } else {
                // Orthographic: use zoom2d as scale factor (not var7 which can be ~0 at 90° pitch)
                // Higher zoom2d = larger on screen, so we divide by a fraction of it
                const orthoScale = Math.max(100, it.zoom2d | 0);
                const px = (vx * zoom3d) / orthoScale;
                const py = (t * zoom3d) / orthoScale;
                if (px < minX) minX = px;
                if (px > maxX) maxX = px;
                if (py < minY) minY = py;
                if (py > maxY) maxY = py;
            }
        }

        if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
            // No visible projection — return a tiny transparent canvas
            const canEmpty = document.createElement("canvas");
            canEmpty.width = 1;
            canEmpty.height = 1;
            return { canvas: canEmpty, offsetX: 0, offsetY: 0 };
        }

        // Compute tight integer bbox with a small safety border to avoid edge cutoffs.
        // Some NPC chatheads (e.g., hats/helms) sit right on the projected edge and get clipped
        // when rounding; give a few extra pixels of breathing room.
        const BORDER = 3;
        // Clamp max dimensions to prevent OOM when projection produces extreme values
        // (e.g., vertices very close to near plane causing huge screen coords)
        // Account for border in the max (2048 - 6 = 2042 for bbox, 2048 total)
        const MAX_BBOX = 1024; // UI models (chatheads, quest journal) can reach ~600px
        const rawBboxW = Math.ceil(maxX - minX);
        const rawBboxH = Math.ceil(maxY - minY);
        if (rawBboxW > MAX_BBOX || rawBboxH > MAX_BBOX) {
            console.warn(
                `[Model2DRenderer] Clamping extreme bbox ${rawBboxW}x${rawBboxH} to ${MAX_BBOX}`,
                { modelId: modelIdOverride, params, minX, maxX, minY, maxY },
            );
        }
        const bboxW = Math.min(MAX_BBOX, Math.max(1, rawBboxW));
        const bboxH = Math.min(MAX_BBOX, Math.max(1, rawBboxH));
        const sw = bboxW + BORDER * 2;
        const sh = bboxH + BORDER * 2;
        const dx = Math.floor(-minX) + BORDER;
        const dy = Math.floor(-minY) + BORDER;

        const rgba: Uint8ClampedArray = this.renderModelSoftwareToPixels(
            model,
            it,
            sw,
            sh,
            orthographic,
            { centerX: 0, centerY: 0, dx, dy },
            params.depthTest === true,
        );

        const can = reuseCanvas ?? document.createElement("canvas");
        if (can.width !== sw) can.width = sw;
        if (can.height !== sh) can.height = sh;
        const ctx = can.getContext("2d", {
            willReadFrequently: true as any,
        }) as CanvasRenderingContext2D | null;
        if (!ctx) return { canvas: can, offsetX: 0, offsetY: 0 };
        const img = ctx.createImageData(sw, sh);
        img.data.set(rgba);
        ctx.putImageData(img, 0, 0);
        return { canvas: can, offsetX: dx, offsetY: dy };
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
        it: {
            id: number;
            xan2d: number;
            yan2d: number;
            zan2d: number;
            zoom2d: number;
            zoom3d?: number;
            offsetX2d: number;
            offsetY2d: number;
        },
        sw: number,
        sh: number,
        orthographic: boolean = false,
        frame?: { centerX?: number; centerY?: number; dx?: number; dy?: number },
        depthTest: boolean = false,
    ): Uint8ClampedArray {
        // Sanity check: prevent OOM from extreme dimensions
        // Max 1030x1030 = ~4MB for Int32Array (matches MAX_BBOX=1024 + BORDER*2=6)
        const MAX_PIXELS = 1030 * 1030;
        if (sw * sh > MAX_PIXELS || sw <= 0 || sh <= 0) {
            console.warn(
                `[Model2DRenderer] Refusing to allocate ${sw}x${sh} (${
                    sw * sh
                } pixels) - returning empty`,
            );
            return new Uint8ClampedArray(4); // 1x1 transparent pixel
        }
        const buf = new Int32Array(sw * sh);
        const zbuf = new Float32Array(sw * sh);
        Rasterizer2D.setRaster(buf, sw, sh);
        Rasterizer2D.fillRectangle(0, 0, sw, sh, 0x00000000);
        Rasterizer3D.setClip();
        Rasterizer3D.rasterGouraudLowRes = false;
        const osrsExact = sw === 36 && sh === 32;
        const yScaleFix = 1.0;
        const centerX =
            typeof frame?.centerX === "number" ? frame.centerX | 0 : osrsExact ? 16 : (sw / 2) | 0;
        const centerY =
            typeof frame?.centerY === "number" ? frame.centerY | 0 : osrsExact ? 16 : (sh / 2) | 0;
        Rasterizer3D.setViewport(centerX, centerY);
        for (let i = 0; i < zbuf.length; i++) zbuf[i] = 1e30;

        model.calculateBoundsCylinder?.();

        const var1 = 0;
        const var2 = (it.yan2d | 0) & 2047;
        const var3 = (it.zan2d | 0) & 2047;
        const var4 = (it.xan2d | 0) & 2047;
        const var5 = it.offsetX2d | 0;
        const var6 = (((it.zoom2d | 0) * SINE[var4]) >> 16) + (it.offsetY2d | 0);
        const var7 = (((it.zoom2d | 0) * COSINE[var4]) >> 16) + (it.offsetY2d | 0);

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
        const sx = new Int32Array(vc);
        const sy = new Int32Array(vc);
        const vz = new Int32Array(vc);
        const zc = new Int32Array(vc);
        const cxv = new Int32Array(vc);
        const cyv = new Int32Array(vc);
        // OSRS parity: Rasterizer3D.get3dZoom() is global (Client.viewportZoom).
        // Use caller-provided zoom3d to match viewport scaling; fall back to legacy 512.
        const zoom3d = Math.max(1, (it.zoom3d ?? 512) | 0);

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
            if (!orthographic) {
                if (vz0 <= 50) {
                    sx[i] = 0;
                    sy[i] = 0;
                } else {
                    sx[i] = (centerX + (vx * zoom3d) / vz0) | 0;
                    sy[i] = (centerY + ((t * zoom3d) / vz0) * yScaleFix) | 0;
                }
            } else {
                // Orthographic: use zoom2d as scale factor (not var7 which can be ~0 at 90° pitch)
                const orthoScale = Math.max(100, it.zoom2d | 0);
                sx[i] = (centerX + (vx * zoom3d) / orthoScale) | 0;
                sy[i] = (centerY + ((t * zoom3d) / orthoScale) * yScaleFix) | 0;
            }
        }

        // Disable bounding-box auto-scaling: keep k=1.
        let k = 1.0;
        let dx = typeof frame?.dx === "number" ? frame.dx : 0.0;
        let dy = typeof frame?.dy === "number" ? frame.dy : 0.0;

        let triDrawn = 0;
        let triSkippedAlpha = 0;
        // Default to OSRS UI behaviour: no z-buffer unless explicitly enabled
        const disableZbuf = !depthTest;
        function drawTexturedTri(
            x0: number,
            y0: number,
            z0: number,
            u0: number,
            v0: number,
            i0: number,
            x1: number,
            y1: number,
            z1: number,
            u1: number,
            v1: number,
            i1: number,
            x2: number,
            y2: number,
            z2: number,
            u2: number,
            v2: number,
            i2: number,
            texPixels: Int32Array,
            texSize: number,
            faceAlpha: number,
            priority: number,
        ) {
            if (texSize <= 0 || texPixels.length === 0) return;
            const minX = Math.max(0, Math.min(sw - 1, Math.ceil(Math.min(x0, x1, x2))));
            const maxX = Math.max(0, Math.min(sw - 1, Math.ceil(Math.max(x0, x1, x2)) - 1));
            const minY = Math.max(0, Math.min(sh - 1, Math.ceil(Math.min(y0, y1, y2))));
            const maxY = Math.max(0, Math.min(sh - 1, Math.ceil(Math.max(y0, y1, y2)) - 1));
            if (minX > maxX || minY > maxY) return;
            const X0 = x0,
                Y0 = y0,
                X1 = x1,
                Y1 = y1,
                X2 = x2,
                Y2 = y2;
            const denom = (Y1 - Y2) * (X0 - X2) + (X2 - X1) * (Y0 - Y2);
            if (denom === 0) return;
            const invZ0 = z0 > 0 ? 1.0 / z0 : 0.0;
            const invZ1 = z1 > 0 ? 1.0 / z1 : 0.0;
            const invZ2 = z2 > 0 ? 1.0 / z2 : 0.0;
            const u0w = u0 * invZ0,
                v0w = v0 * invZ0;
            const u1w = u1 * invZ1,
                v1w = v1 * invZ1;
            const u2w = u2 * invZ2,
                v2w = v2 * invZ2;
            const i0w = i0 * invZ0,
                i1w = i1 * invZ1,
                i2w = i2 * invZ2;
            const centerBiasY = osrsExact ? -0.01 : 0.0;
            const zBias = 1e-4;
            for (let y = minY; y <= maxY; y++) {
                const py = y + 0.5 + centerBiasY;
                for (let x = minX; x <= maxX; x++) {
                    const px = x + 0.5;
                    let w0 = ((Y1 - Y2) * (px - X2) + (X2 - X1) * (py - Y2)) / denom;
                    let w1 = ((Y2 - Y0) * (px - X2) + (X0 - X2) * (py - Y2)) / denom;
                    let w2 = 1.0 - w0 - w1;
                    if (w0 < 0 || w1 < 0 || w2 < 0) continue;
                    const idx = y * sw + x;
                    const invW = w0 * invZ0 + w1 * invZ1 + w2 * invZ2;
                    if (invW <= 0) continue;
                    const z = 1.0 / invW;
                    // Matches npc.vert.glsl logic: layer * PRIORITY_LAYER_EPSILON
                    // Priority 7 gets an extra boost to ensure it sits on top of other high-prio layers.
                    const extraBias = priority === 7 ? 10 : 0;
                    const effZ = z - (priority * 2 + extraBias);
                    if (!disableZbuf && effZ > zbuf[idx]) continue;
                    const u = (w0 * u0w + w1 * u1w + w2 * u2w) / invW;
                    const v = (w0 * v0w + w1 * v1w + w2 * v2w) / invW;
                    let iInterp = (w0 * i0w + w1 * i1w + w2 * i2w) / invW;
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
                    // Binary texture alpha (palette 0 transparent, else opaque)
                    if (aT < 1) {
                        triSkippedAlpha++;
                        continue;
                    }
                    const R = (((src >> 16) & 255) * shade) | 0,
                        G = (((src >> 8) & 255) * shade) | 0,
                        B = ((src & 255) * shade) | 0;
                    const ai = Math.max(0, Math.min(255, faceAlpha & 255));
                    if (ai >= 255) {
                        // OSRS parity: sprite pixel 0 is treated as transparent; never write 0 for drawn pixels.
                        let outRgb = (R << 16) | (G << 8) | B;
                        if (outRgb === 0) outRgb = 1;
                        buf[idx] = outRgb;
                        if (!disableZbuf) zbuf[idx] = effZ - zBias;
                    } else if (ai > 0) {
                        const dst = buf[idx] >>> 0;
                        const dR = (dst >> 16) & 255,
                            dG = (dst >> 8) & 255,
                            dB = dst & 255;
                        const outR = ((R * ai + dR * (255 - ai)) / 255) | 0;
                        const outG = ((G * ai + dG * (255 - ai)) / 255) | 0;
                        const outB = ((B * ai + dB * (255 - ai)) / 255) | 0;
                        // OSRS parity: avoid writing 0 (transparent) for blended-but-visible pixels.
                        let outRgb = (outR << 16) | (outG << 8) | outB;
                        if (outRgb === 0) outRgb = 1;
                        buf[idx] = outRgb;
                        if (!disableZbuf) zbuf[idx] = effZ - zBias;
                    } else {
                        // ai == 0 means fully transparent face
                    }
                }
            }
            triDrawn++;
        }

        function drawFlatTri(
            x0: number,
            y0: number,
            z0: number,
            x1: number,
            y1: number,
            z1: number,
            x2: number,
            y2: number,
            z2: number,
            c0: number,
            c1: number,
            c2: number,
            faceAlpha: number,
            priority: number,
        ) {
            const minX = Math.max(0, Math.min(sw - 1, Math.ceil(Math.min(x0, x1, x2))));
            const maxX = Math.max(0, Math.min(sw - 1, Math.ceil(Math.max(x0, x1, x2)) - 1));
            const minY = Math.max(0, Math.min(sh - 1, Math.ceil(Math.min(y0, y1, y2))));
            const maxY = Math.max(0, Math.min(sh - 1, Math.ceil(Math.max(y0, y1, y2)) - 1));
            if (minX > maxX || minY > maxY) return;
            const X0 = x0,
                Y0 = y0,
                X1 = x1,
                Y1 = y1,
                X2 = x2,
                Y2 = y2;
            const denom = (Y1 - Y2) * (X0 - X2) + (X2 - X1) * (Y0 - Y2);
            if (denom === 0) return;
            const r0 = (c0 >> 16) & 255,
                g0 = (c0 >> 8) & 255,
                b0 = c0 & 255;
            const r1 = (c1 >> 16) & 255,
                g1 = (c1 >> 8) & 255,
                b1 = c1 & 255;
            const r2 = (c2 >> 16) & 255,
                g2 = (c2 >> 8) & 255,
                b2 = c2 & 255;
            const ai = Math.max(0, Math.min(255, faceAlpha & 255));
            const invZ0 = z0 > 0 ? 1.0 / z0 : 0.0;
            const invZ1 = z1 > 0 ? 1.0 / z1 : 0.0;
            const invZ2 = z2 > 0 ? 1.0 / z2 : 0.0;
            const centerBiasY = osrsExact ? -0.01 : 0.0;
            for (let y = minY; y <= maxY; y++) {
                const py = y + 0.5 + centerBiasY;
                for (let x = minX; x <= maxX; x++) {
                    const px = x + 0.5;
                    let w0 = ((Y1 - Y2) * (px - X2) + (X2 - X1) * (py - Y2)) / denom;
                    let w1 = ((Y2 - Y0) * (px - X2) + (X0 - X2) * (py - Y2)) / denom;
                    let w2 = 1.0 - w0 - w1;
                    if (w0 < 0 || w1 < 0 || w2 < 0) continue;
                    const idx = y * sw + x;
                    const invW = w0 * invZ0 + w1 * invZ1 + w2 * invZ2;
                    if (invW <= 0) continue;
                    const z = 1.0 / invW;
                    const extraBias = priority === 7 ? 10 : 0;
                    const effZ = z - (priority * 2 + extraBias);
                    if (!disableZbuf && effZ > zbuf[idx]) continue;
                    const R = (w0 * r0 + w1 * r1 + w2 * r2) | 0;
                    const G = (w0 * g0 + w1 * g1 + w2 * g2) | 0;
                    const B = (w0 * b0 + w1 * b1 + w2 * b2) | 0;
                    const dst = buf[idx] >>> 0;
                    const dR = (dst >> 16) & 255,
                        dG = (dst >> 8) & 255,
                        dB = dst & 255;
                    const aComb = ai;
                    const outR = ((R * aComb + dR * (255 - aComb)) / 255) | 0;
                    const outG = ((G * aComb + dG * (255 - aComb)) / 255) | 0;
                    const outB = ((B * aComb + dB * (255 - aComb)) / 255) | 0;
                    // OSRS parity: sprite pixel 0 is transparent; keep visible pixels non-zero.
                    let outRgb = (outR << 16) | (outG << 8) | outB;
                    if (aComb > 0 && outRgb === 0) outRgb = 1;
                    buf[idx] = outRgb;
                    if (!disableZbuf) zbuf[idx] = effZ;
                }
            }
            triDrawn++;
        }

        type V = { x: number; y: number; z: number; u: number; v: number; i: number };

        function clipAgainstNear(vertices: V[], NEAR: number): V[] {
            if (vertices.length === 0) return vertices;
            const out: V[] = [];
            for (let i = 0; i < vertices.length; i++) {
                const curr = vertices[i];
                const prev = vertices[(i + vertices.length - 1) % vertices.length];
                const currIn = curr.z > NEAR;
                const prevIn = prev.z > NEAR;
                if (currIn) {
                    if (!prevIn) {
                        const t = (NEAR - prev.z) / (curr.z - prev.z);
                        out.push({
                            x: prev.x + t * (curr.x - prev.x),
                            y: prev.y + t * (curr.y - prev.y),
                            z: NEAR + 1e-5,
                            u: prev.u + t * (curr.u - prev.u),
                            v: prev.v + t * (curr.v - prev.v),
                            i: prev.i + t * (curr.i - prev.i),
                        });
                    }
                    out.push(curr);
                } else if (prevIn) {
                    const t = (NEAR - prev.z) / (curr.z - prev.z);
                    out.push({
                        x: prev.x + t * (curr.x - prev.x),
                        y: prev.y + t * (curr.y - prev.y),
                        z: NEAR + 1e-5,
                        u: prev.u + t * (curr.u - prev.u),
                        v: prev.v + t * (curr.v - prev.v),
                        i: prev.i + t * (curr.i - prev.i),
                    });
                }
            }
            return out;
        }

        const fc = model.faceCount | 0;
        const faceDepths = new Int32Array(fc);
        for (let f = 0; f < fc; f++) {
            const a = model.indices1[f] | 0;
            const b = model.indices2[f] | 0;
            const c = model.indices3[f] | 0;
            faceDepths[f] = vz[a] + vz[b] + vz[c];
        }

        // Face ordering: depth bins + priority interleaving (10/11)
        const radius = (model.radius ?? 0) | 0;
        const diameter = Math.max(0, (model.diameter ?? 0) | 0);
        let maxBinObserved = 0;
        const tmpBins: Map<number, number[]> = new Map();
        for (let f = 0; f < fc; f++) {
            if (model.faceColors3 && model.faceColors3[f] === -2) continue;
            const avgDepth = (faceDepths[f] / 3) | 0;
            let bin = avgDepth + radius;
            if (diameter > 0) {
                if (bin < 0) bin = 0;
                if (bin >= diameter) bin = diameter - 1;
            }
            if (bin > maxBinObserved) maxBinObserved = bin;
            let list = tmpBins.get(bin);
            if (!list) {
                list = [];
                tmpBins.set(bin, list);
            }
            list.push(f);
        }
        const binsLen = diameter > 0 ? diameter : maxBinObserved + 1;
        const bins: number[][] = Array.from({ length: binsLen }, () => []);
        for (const [b, list] of tmpBins.entries()) if (b >= 0 && b < binsLen) bins[b] = list;
        const prioArr = model.faceRenderPriorities;
        const drawOrder: number[] = [];
        if (!prioArr) {
            for (let b = binsLen - 1; b >= 0; b--) {
                const faces = bins[b];
                if (!faces || faces.length === 0) continue;
                for (let i = 0; i < faces.length; i++) drawOrder.push(faces[i]);
            }
        } else {
            const prioFaces: number[][] = Array.from({ length: 12 }, () => []);
            const prioCounts = new Int32Array(12);
            const prioSumBins = new Int32Array(12);
            const prio10Depths: number[] = [];
            const prio11Depths: number[] = [];
            for (let b = binsLen - 1; b >= 0; b--) {
                const faces = bins[b];
                if (!faces || faces.length === 0) continue;
                for (let i = 0; i < faces.length; i++) {
                    const f = faces[i];
                    const p = prioArr[f] & 0xff;
                    prioFaces[p].push(f);
                    prioCounts[p]++;
                    if (p < 10) prioSumBins[p] += b;
                    else if (p === 10) prio10Depths.push(b);
                    else if (p === 11) prio11Depths.push(b);
                }
            }
            const avg12 =
                prioCounts[1] + prioCounts[2]
                    ? (prioSumBins[1] + prioSumBins[2]) / (prioCounts[1] + prioCounts[2])
                    : 0;
            const avg34 =
                prioCounts[3] + prioCounts[4]
                    ? (prioSumBins[3] + prioSumBins[4]) / (prioCounts[3] + prioCounts[4])
                    : 0;
            const avg68 =
                prioCounts[6] + prioCounts[8]
                    ? (prioSumBins[6] + prioSumBins[8]) / (prioCounts[6] + prioCounts[8])
                    : 0;
            let curFaces = prioFaces[10];
            let curDepths = prio10Depths;
            let curPtr = 0;
            let curLen = curFaces.length;
            const switchTo11 = () => {
                curFaces = prioFaces[11];
                curDepths = prio11Depths;
                curPtr = 0;
                curLen = curFaces.length;
            };
            const peekDepth = () => (curPtr < curLen ? curDepths[curPtr] : -1000);
            const pop10or11 = () => {
                if (curPtr < curLen) drawOrder.push(curFaces[curPtr++]);
                if (curPtr >= curLen && curFaces !== prioFaces[11]) switchTo11();
            };
            if (curLen === 0) switchTo11();
            for (let pr = 0; pr < 10; pr++) {
                if (pr === 0) {
                    while (peekDepth() > avg12) pop10or11();
                } else if (pr === 3) {
                    while (peekDepth() > avg34) pop10or11();
                } else if (pr === 5) {
                    while (peekDepth() > avg68) pop10or11();
                }

                const list = prioFaces[pr];
                if (list.length) {
                    for (let i = 0; i < list.length; i++) {
                        drawOrder.push(list[i]);
                    }
                }
            }

            while (peekDepth() !== -1000) pop10or11();
        }

        // Debug dump moved below draw loop to ensure counters are initialized

        // Draw using depth-ordered faces
        let facesTextured = 0;
        let facesFlat = 0;
        let facesClipped = 0;
        let facesDegenerate2D = 0;
        let facesZeroBBox = 0;
        let facesNearCulled = 0;
        for (const f of drawOrder) {
            if (model.faceColors3 && model.faceColors3[f] === -2) continue;
            const a = model.indices1[f] | 0;
            const b = model.indices2[f] | 0;
            const c = model.indices3[f] | 0;
            const x0 = sx[a] | 0,
                y0 = sy[a] | 0;
            const x1 = sx[b] | 0,
                y1 = sy[b] | 0;
            const x2 = sx[c] | 0,
                y2 = sy[c] | 0;
            const z0 = zc[a] | 0,
                z1 = zc[b] | 0,
                z2 = zc[c] | 0;
            // Basic 2D degeneracy checks (post-projection)
            // Basic 2D degeneracy checks (post-projection)
            const area2 = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0);
            if (area2 === 0) {
                facesDegenerate2D++;
                continue;
            }

            // OSRS-style backface cull.
            // In this screen-space convention, front-facing tris have negative signed area.
            if (z0 > 50 && z1 > 50 && z2 > 50 && area2 >= 0) {
                continue;
            }
            const bbMinX = Math.max(0, Math.min(sw - 1, Math.ceil(Math.min(x0, x1, x2))));
            const bbMaxX = Math.max(0, Math.min(sw - 1, Math.ceil(Math.max(x0, x1, x2)) - 1));
            const bbMinY = Math.max(0, Math.min(sh - 1, Math.ceil(Math.min(y0, y1, y2))));
            const bbMaxY = Math.max(0, Math.min(sh - 1, Math.ceil(Math.max(y0, y1, y2)) - 1));
            if (bbMinX > bbMaxX || bbMinY > bbMaxY) facesZeroBBox++;
            if (z0 <= 50 || z1 <= 50 || z2 <= 50) facesNearCulled++;
            const faceTexId = model.faceTextures ? model.faceTextures[f] : -1;
            const faceAlphaArr = model.faceAlphas;
            const faceAlpha = faceAlphaArr ? 0xff - (faceAlphaArr[f] & 0xff) : 0xff;
            // OSRS priority is 0-10+, but shader logic uses compressed 0-7 bands for depth bias.
            // Masking prevents excessive bias for high-priority faces (like 10+) which could pull back-faces through.
            const rawPriority = model.faceRenderPriorities
                ? model.faceRenderPriorities[f] & 0xff
                : 0;
            const priority = rawPriority & 0x7;
            if (faceTexId !== -1 && (model as any).uvs) {
                const uvs = (model as any).uvs as number[];
                const uvIndex = f * 6;
                const u0 = uvs[uvIndex + 0];
                const v0 = uvs[uvIndex + 1];
                const u1 = uvs[uvIndex + 2];
                const v1 = uvs[uvIndex + 3];
                const u2 = uvs[uvIndex + 4];
                const v2 = uvs[uvIndex + 5];
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
                const poly = [
                    { x: cxv[a], y: cyv[a], z: zc[a], u: u0, v: v0, i: i0 },
                    { x: cxv[b], y: cyv[b], z: zc[b], u: u1, v: v1, i: i1 },
                    { x: cxv[c], y: cyv[c], z: zc[c], u: u2, v: v2, i: i2v },
                ];
                const clipped = clipAgainstNear(poly, 50.0);
                if (clipped.length >= 3) {
                    facesTextured++;
                    for (let t = 1; t < clipped.length - 1; t++) {
                        const vA = clipped[0],
                            vB = clipped[t],
                            vC = clipped[t + 1];
                        let sx0: number,
                            sy0: number,
                            sx1: number,
                            sy1: number,
                            sx2: number,
                            sy2: number;
                        if (orthographic) {
                            // Orthographic: use zoom2d-based scale, not perspective division
                            const orthoScale = Math.max(100, it.zoom2d | 0);
                            sx0 = (centerX + ((vA.x * zoom3d) / orthoScale) * k + dx) | 0;
                            sy0 =
                                (centerY + (((vA.y * zoom3d) / orthoScale) * k + dy) * yScaleFix) |
                                0;
                            sx1 = (centerX + ((vB.x * zoom3d) / orthoScale) * k + dx) | 0;
                            sy1 =
                                (centerY + (((vB.y * zoom3d) / orthoScale) * k + dy) * yScaleFix) |
                                0;
                            sx2 = (centerX + ((vC.x * zoom3d) / orthoScale) * k + dx) | 0;
                            sy2 =
                                (centerY + (((vC.y * zoom3d) / orthoScale) * k + dy) * yScaleFix) |
                                0;
                        } else if (osrsExact) {
                            sx0 = centerX + (((vA.x * zoom3d) / vA.z) | 0);
                            sy0 = centerY + (((vA.y * zoom3d) / vA.z) | 0);
                            sx1 = centerX + (((vB.x * zoom3d) / vB.z) | 0);
                            sy1 = centerY + (((vB.y * zoom3d) / vB.z) | 0);
                            sx2 = centerX + (((vC.x * zoom3d) / vC.z) | 0);
                            sy2 = centerY + (((vC.y * zoom3d) / vC.z) | 0);
                        } else {
                            sx0 = (centerX + ((vA.x * zoom3d) / vA.z) * k + dx) | 0;
                            sy0 = (centerY + (((vA.y * zoom3d) / vA.z) * k + dy) * yScaleFix) | 0;
                            sx1 = (centerX + ((vB.x * zoom3d) / vB.z) * k + dx) | 0;
                            sy1 = (centerY + (((vB.y * zoom3d) / vB.z) * k + dy) * yScaleFix) | 0;
                            sx2 = (centerX + ((vC.x * zoom3d) / vC.z) * k + dx) | 0;
                            sy2 = (centerY + (((vC.y * zoom3d) / vC.z) * k + dy) * yScaleFix) | 0;
                        }
                        const orient2 =
                            (sx1 - sx0) * (sy2 - sy0) - (sy1 - sy0) * (sx2 - sx0);
                        if (orient2 >= 0) continue;

                        drawTexturedTri(
                            // They must be interleaved per-vertex (x, y, z, u, v, i) to match the function signature.
                            sx0,
                            sy0,
                            vA.z,
                            vA.u,
                            vA.v,
                            vA.i,
                            sx1,
                            sy1,
                            vB.z,
                            vB.u,
                            vB.v,
                            vB.i,
                            sx2,
                            sy2,
                            vC.z,
                            vC.u,
                            vC.v,
                            vC.i,
                            // END FIX
                            tex.pixels,
                            tex.size,
                            faceAlpha,
                            priority,
                        );
                    }
                } else {
                    facesClipped++;
                }
            } else {
                // Flat/gouraud
                let i0c = model.faceColors1 ? model.faceColors1[f] : 126;
                let i1c = model.faceColors2 ? model.faceColors2[f] : 126;
                let i2c = model.faceColors3 ? model.faceColors3[f] : 126;
                if (model.faceColors3 && model.faceColors3[f] === -1) {
                    i1c = i0c;
                    i2c = i0c;
                } else if ((i2c | 0) < 0) {
                    i2c = i1c;
                }
                const c0 = HSL_RGB_MAP[(i0c & 0xffff) | 0] | 0;
                const c1 = HSL_RGB_MAP[(i1c & 0xffff) | 0] | 0;
                const c2 = HSL_RGB_MAP[(i2c & 0xffff) | 0] | 0;
                const clipped = clipAgainstNear(
                    [
                        { x: cxv[a], y: cyv[a], z: zc[a], u: 0, v: 0, i: 0 },
                        { x: cxv[b], y: cyv[b], z: zc[b], u: 0, v: 0, i: 0 },
                        { x: cxv[c], y: cyv[c], z: zc[c], u: 0, v: 0, i: 0 },
                    ],
                    50.0,
                );
                if (clipped.length >= 3) {
                    facesFlat++;
                    for (let t = 1; t < clipped.length - 1; t++) {
                        const vA = clipped[0],
                            vB = clipped[t],
                            vC = clipped[t + 1];
                        let sx0: number,
                            sy0: number,
                            sx1: number,
                            sy1: number,
                            sx2: number,
                            sy2: number;
                        if (orthographic) {
                            // Orthographic: use zoom2d-based scale, not perspective division
                            const orthoScale = Math.max(100, it.zoom2d | 0);
                            sx0 = (centerX + ((vA.x * zoom3d) / orthoScale) * k + dx) | 0;
                            sy0 =
                                (centerY + (((vA.y * zoom3d) / orthoScale) * k + dy) * yScaleFix) |
                                0;
                            sx1 = (centerX + ((vB.x * zoom3d) / orthoScale) * k + dx) | 0;
                            sy1 =
                                (centerY + (((vB.y * zoom3d) / orthoScale) * k + dy) * yScaleFix) |
                                0;
                            sx2 = (centerX + ((vC.x * zoom3d) / orthoScale) * k + dx) | 0;
                            sy2 =
                                (centerY + (((vC.y * zoom3d) / orthoScale) * k + dy) * yScaleFix) |
                                0;
                        } else if (osrsExact) {
                            sx0 = centerX + (((vA.x * zoom3d) / vA.z) | 0);
                            sy0 = centerY + (((vA.y * zoom3d) / vA.z) | 0);
                            sx1 = centerX + (((vB.x * zoom3d) / vB.z) | 0);
                            sy1 = centerY + (((vB.y * zoom3d) / vB.z) | 0);
                            sx2 = centerX + (((vC.x * zoom3d) / vC.z) | 0);
                            sy2 = centerY + (((vC.y * zoom3d) / vC.z) | 0);
                        } else {
                            sx0 = (centerX + ((vA.x * zoom3d) / vA.z) * k + dx) | 0;
                            sy0 = (centerY + (((vA.y * zoom3d) / vA.z) * k + dy) * yScaleFix) | 0;
                            sx1 = (centerX + ((vB.x * zoom3d) / vB.z) * k + dx) | 0;
                            sy1 = (centerY + (((vB.y * zoom3d) / vB.z) * k + dy) * yScaleFix) | 0;
                            sx2 = (centerX + ((vC.x * zoom3d) / vC.z) * k + dx) | 0;
                            sy2 = (centerY + (((vC.y * zoom3d) / vC.z) * k + dy) * yScaleFix) | 0;
                        }
                        const orient2 =
                            (sx1 - sx0) * (sy2 - sy0) - (sy1 - sy0) * (sx2 - sx0);
                        if (orient2 >= 0) continue;

                        drawFlatTri(
                            sx0,
                            sy0,
                            vA.z,
                            sx1,
                            sy1,
                            vB.z,
                            sx2,
                            sy2,
                            vC.z,
                            c0,
                            c1,
                            c2,
                            faceAlpha,
                            priority,
                        );
                    }
                } else {
                    facesClipped++;
                }
            }
        }

        // Detailed dump for selected models to debug geometry/UVs/rasters
        if (it.id === 2737 || it.id === 4607) {
            try {
                try {
                    (model as any).calculateBounds?.();
                } catch {}
                const orderIndex = new Int32Array(fc);
                orderIndex.fill(-1);
                for (let i = 0; i < drawOrder.length; i++) orderIndex[drawOrder[i]] = i;
                const vertices = Array.from({ length: vc }, (_, i) => ({
                    index: i,
                    x: model.verticesX[i] | 0,
                    y: model.verticesY[i] | 0,
                    z: model.verticesZ[i] | 0,
                }));
                const projected = Array.from({ length: vc }, (_, i) => ({
                    index: i,
                    cx: cxv[i] | 0,
                    cy: cyv[i] | 0,
                    z: zc[i] | 0,
                    sx: sx[i] | 0,
                    sy: sy[i] | 0,
                    inFront: (zc[i] | 0) > 50,
                }));
                const uvsArr = (model as any).uvs as Float32Array | number[] | undefined;
                const faces = Array.from({ length: fc }, (_, f) => {
                    const a = model.indices1[f] | 0;
                    const b = model.indices2[f] | 0;
                    const c = model.indices3[f] | 0;
                    const texId = model.faceTextures ? model.faceTextures[f] | 0 : -1;
                    const uv = uvsArr
                        ? [
                              uvsArr[f * 6 + 0],
                              uvsArr[f * 6 + 1],
                              uvsArr[f * 6 + 2],
                              uvsArr[f * 6 + 3],
                              uvsArr[f * 6 + 4],
                              uvsArr[f * 6 + 5],
                          ]
                        : undefined;
                    const depth = faceDepths[f] | 0;
                    let binVal = depth / 3 + (model.radius ? model.radius | 0 : 0);
                    if (diameter > 0) {
                        if (binVal < 0) binVal = 0;
                        if (binVal >= diameter) binVal = diameter - 1;
                    }
                    const za = zc[a] | 0,
                        zb = zc[b] | 0,
                        zc0 = zc[c] | 0;
                    return {
                        face: f,
                        indices: [a, b, c],
                        colors: {
                            c1: model.faceColors1 ? model.faceColors1[f] | 0 : undefined,
                            c2: model.faceColors2 ? model.faceColors2[f] | 0 : undefined,
                            c3: model.faceColors3 ? model.faceColors3[f] | 0 : undefined,
                        },
                        alpha: model.faceAlphas ? model.faceAlphas[f] & 0xff : undefined,
                        priority:
                            model.faceRenderPriorities && model.faceRenderPriorities.length
                                ? model.faceRenderPriorities[f] & 0xff
                                : model.priority | 0,
                        textured: texId !== -1 && !!uv,
                        textureId: texId,
                        uv,
                        depth,
                        bin: binVal | 0,
                        order: orderIndex[f] | 0,
                        nearFlags: [za <= 50, zb <= 50, zc0 <= 50],
                    };
                });
                const dump = {
                    tag: "Model2D FULL DEBUG",
                    id: it.id,
                    size: { sw, sh },
                    viewport: { centerX, centerY, zoom3d, orthographic },
                    params: {
                        xan2d: it.xan2d,
                        yan2d: it.yan2d,
                        zan2d: it.zan2d,
                        zoom2d: it.zoom2d,
                        offsetX2d: it.offsetX2d,
                        offsetY2d: it.offsetY2d,
                        frame: { dx, dy },
                    },
                    bounds: {
                        bottomY: (model as any).bottomY ?? undefined,
                        xzRadius: (model as any).xzRadius ?? undefined,
                        radius: (model as any).radius ?? undefined,
                        diameter: (model as any).diameter ?? undefined,
                        minX: (model as any).minX ?? undefined,
                        maxX: (model as any).maxX ?? undefined,
                        minY: (model as any).minY ?? undefined,
                        maxY: (model as any).maxY ?? undefined,
                        minZ: (model as any).minZ ?? undefined,
                        maxZ: (model as any).maxZ ?? undefined,
                    },
                    counts: {
                        vertices: vc,
                        faces: fc,
                        degenerate2D: facesDegenerate2D,
                        zeroBBox: facesZeroBBox,
                        nearCulled: facesNearCulled,
                    },
                    arrays: {
                        vertices,
                        projected,
                        faces,
                        textureMapping: (model as any).textureMappingP
                            ? {
                                  P: Array.from((model as any).textureMappingP),
                                  M: Array.from((model as any).textureMappingM),
                                  N: Array.from((model as any).textureMappingN),
                                  coords: (model as any).textureCoords
                                      ? Array.from((model as any).textureCoords)
                                      : undefined,
                              }
                            : undefined,
                    },
                } as const;
                (this.logger || console.log).call(console, dump);
            } catch (e) {
                try {
                    (this.logger || console.warn).call(console, "Model2D debug dump failed", e);
                } catch {}
            }
        }

        const out = new Uint8ClampedArray(sw * sh * 4);
        let nonZero = 0;
        for (let i = 0, p = 0; i < buf.length; i++, p += 4) {
            const rgb = buf[i] | 0;
            out[p] = (rgb >> 16) & 255;
            out[p + 1] = (rgb >> 8) & 255;
            out[p + 2] = rgb & 255;
            const a = rgb === 0 ? 0 : 255;
            out[p + 3] = a;
            if (a) nonZero++;
        }
        if (this.debug) {
            const lines = [] as string[];
            lines.push(`[model2d sw] id=${it.id} size=${sw}x${sh}`);
            lines.push(
                `verts=${vc} faces=${fc} drawn=${triDrawn} textured=${facesTextured} flat=${facesFlat} clipped=${facesClipped}`,
            );
            const minSX = sx.reduce((a, b) => Math.min(a, b), 1e9) | 0;
            const maxSX = sx.reduce((a, b) => Math.max(a, b), -1e9) | 0;
            const minSY = sy.reduce((a, b) => Math.min(a, b), 1e9) | 0;
            const maxSY = sy.reduce((a, b) => Math.max(a, b), -1e9) | 0;
            lines.push(`screen sx=[${minSX}..${maxSX}] sy=[${minSY}..${maxSY}]`);
            lines.push(
                `coverage=${((nonZero / (sw * sh)) * 100).toFixed(
                    1,
                )}% alphaSkip=${triSkippedAlpha}`,
            );
            try {
                (this.logger || console.log).call(console, lines.join("\n"));
            } catch {}
        }
        return out;
    }
}
