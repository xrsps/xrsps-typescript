import { App as PicoApp, Program } from "picogl";

import { CacheIndex } from "../../rs/cache/CacheIndex";
import { CacheSystem } from "../../rs/cache/CacheSystem";
import { BitmapFont } from "../../rs/font/BitmapFont";
import { isTouchDevice } from "../../common/utils/DeviceUtil";
import { getUiScale } from "../UiScale";
import { FONT_VERDANA_13 } from "../fonts";
import { getChooseOptionMenuRect } from "../../widgets/gl/choose-option";
import { GLRenderer } from "../../widgets/gl/renderer";
import {
    GLRenderOpts,
    beginWidgetUiFrame,
    detachGLUI,
    processWidgetUiInput,
    renderWidgetTreeGL,
} from "../../widgets/gl/widgets-gl";
import { drawTextGL } from "../../widgets/components/TextRenderer";
import type { WidgetManager } from "../../widgets/WidgetManager";
import { Overlay, OverlayInitArgs, OverlayUpdateArgs, RenderPhase } from "./Overlay";

export interface WidgetsContext {
    getCacheSystem: () => CacheSystem;
    getFontLoader?: () => (id: number) => BitmapFont | undefined;
    getWidgetRoot?: () => any; // Legacy single-root fallback
    getWidgetRoots?: () => any[]; // Optional layered roots (viewport + modals)
    getWidgetManager?: () => WidgetManager | undefined;
    getItemIconCanvas?: () => (
        itemId: number,
        qty?: number,
        outline?: number,
        shadow?: number,
        quantityMode?: number,
    ) => HTMLCanvasElement | undefined;
    getObjLoader?: () => any;
    // Optional game context for plugins (e.g., player ECS, map state)
    getGameContext?: () => any;
    getRenderModelCanvas?: () => (
        modelId: number,
        params: any,
        width: number,
        height: number,
    ) => { canvas: HTMLCanvasElement; offsetX: number; offsetY: number } | undefined;
}

type WidgetRenderEntry = {
    root: any;
    renderOpts: GLRenderOpts;
};

type DirtyRect = {
    x: number;
    y: number;
    w: number;
    h: number;
};

export class WidgetsOverlay implements Overlay {
    private app!: PicoApp;
    private glRenderer?: GLRenderer;
    private overlayCanvas?: HTMLCanvasElement;
    private renderCanvas?: HTMLCanvasElement;
    private overlayScaleX: number = 1;
    private overlayScaleY: number = 1;
    private widgetEntries: WidgetRenderEntry[] = [];
    private visible: Map<number, boolean> = new Map();
    private hasPresentedFrame: boolean = false;

    // PERF: Cached arrays and objects to avoid per-frame allocations
    private cachedRootSources: any[] = [];
    // PERF: Cached baseRenderOpts to avoid creating object with arrow functions every frame
    private cachedBaseRenderOpts: Omit<
        GLRenderOpts,
        "rootOffsetX" | "rootOffsetY" | "rootScale" | "rootScaleX" | "rootScaleY"
    > | null = null;
    // Tracks root-set changes so we can force one full redraw/input rebuild.
    private lastRootSignature: string = "";
    private rootSetChanged: boolean = true;

    private lastMenuVisualSignature: string = "";
    private lastMenuVisualRect?: DirtyRect;
    private lastTradeAmountOverlaySignature: string = "";

    // Public property to enable/disable the overlay
    public enabled: boolean = true;

    constructor(
        program: Program,
        private ctx: WidgetsContext,
    ) {
        void program;
    }

    /**
     * Get the GL canvas where the click registry is stored.
     * Used for cleaning up click targets when interfaces close.
     */
    getGLCanvas(): HTMLCanvasElement | undefined {
        return this.glRenderer?.canvas as HTMLCanvasElement | undefined;
    }

    dispose(): void {
        if (this.glRenderer) {
            try {
                detachGLUI(this.glRenderer);
            } catch {}
        }
        this.glRenderer = undefined;
        this.renderCanvas = undefined;
        if (this.overlayCanvas?.parentElement) {
            try {
                this.overlayCanvas.parentElement.removeChild(this.overlayCanvas);
            } catch {}
        }
        this.overlayCanvas = undefined;
        this.hasPresentedFrame = false;
        this.rootSetChanged = true;
        this.lastRootSignature = "";
        this.lastMenuVisualSignature = "";
        this.lastMenuVisualRect = undefined;
        this.lastTradeAmountOverlaySignature = "";
    }

    clearAndHide(): void {
        this.clearOverlayCanvas();
        if (this.overlayCanvas) {
            this.overlayCanvas.style.display = "none";
        }
    }

    init(args: OverlayInitArgs): void {
        this.dispose();
        this.app = args.app;

        // Render widgets into a real transparent overlay canvas stacked above the
        // scene canvas so we avoid re-uploading and re-compositing a full-screen
        // widget texture every frame.
        this.overlayCanvas = document.createElement("canvas");
        this.overlayCanvas.width = this.app.width;
        this.overlayCanvas.height = this.app.height;
        this.overlayCanvas.style.position = "absolute";
        this.overlayCanvas.style.inset = "0";
        this.overlayCanvas.style.width = "100%";
        this.overlayCanvas.style.height = "100%";
        this.overlayCanvas.style.pointerEvents = "none";
        this.overlayCanvas.style.background = "transparent";
        this.attachOverlayCanvas();

        // Initialize GL renderer for widgets
        try {
            this.renderCanvas = document.createElement("canvas");
            this.renderCanvas.width = this.overlayCanvas.width;
            this.renderCanvas.height = this.overlayCanvas.height;
            this.glRenderer = new GLRenderer(this.renderCanvas);
            const overlaySize = this.getOverlayRenderSize();
            this.glRenderer.resize(overlaySize.width, overlaySize.height);
        } catch (e) {
            console.error("Failed to initialize GLRenderer for widgets:", e);
        }
    }

    update(args: OverlayUpdateArgs): void {
        void args;
        if (!this.glRenderer || !this.overlayCanvas) {
            console.warn("WidgetsOverlay: No GL renderer or canvas");
            return;
        }

        this.attachOverlayCanvas();

        // Update canvas size if needed
        const overlaySize = this.getOverlayRenderSize();
        if (
            this.overlayCanvas.width !== overlaySize.width ||
            this.overlayCanvas.height !== overlaySize.height ||
            this.glRenderer.canvas.width !== overlaySize.width ||
            this.glRenderer.canvas.height !== overlaySize.height
        ) {
            this.overlayCanvas.width = overlaySize.width;
            this.overlayCanvas.height = overlaySize.height;
            this.glRenderer.resize(overlaySize.width, overlaySize.height);
            this.hasPresentedFrame = false;
            this.rootSetChanged = true;
            console.log(`WidgetsOverlay: Resized to ${overlaySize.width}x${overlaySize.height}`);
        }

        // PERF: Reuse cached array instead of allocating new one each frame
        const rootSources = this.cachedRootSources;
        rootSources.length = 0;
        if (typeof this.ctx.getWidgetRoots === "function") {
            const layered = this.ctx.getWidgetRoots();
            if (Array.isArray(layered)) {
                for (const root of layered) if (root) rootSources.push(root);
            }
        }
        if (!rootSources.length) {
            const single = this.ctx.getWidgetRoot?.();
            if (single) rootSources.push(single);
        }

        // PERF: Build signature without .map() to avoid intermediate array allocation
        let signature = "";
        for (let i = 0; i < rootSources.length; i++) {
            const root = rootSources[i];
            if (i > 0) signature += ",";
            signature += root && typeof root.uid === "number" ? root.uid : (root?.groupId ?? "");
        }
        if (signature !== this.lastRootSignature) {
            this.lastRootSignature = signature;
            this.rootSetChanged = true;
        }

        // PERF: Reuse cached baseRenderOpts, only update changing values
        const cacheSystem = this.ctx.getCacheSystem();
        let spriteIndex;
        try {
            spriteIndex = cacheSystem.getIndex(8); // Sprites index
        } catch (e) {
            console.warn("WidgetsOverlay: Could not get sprites index:", e);
        }
        const hostCanvas = this.app.gl.canvas as HTMLCanvasElement;

        // Create baseRenderOpts once, then update only changing fields
        if (!this.cachedBaseRenderOpts) {
            this.cachedBaseRenderOpts = {
                spriteIndex: spriteIndex as CacheIndex,
                fontLoader: this.ctx.getFontLoader?.() || (() => undefined),
                visible: this.visible,
                debug: false,
                hostW: this.app.width,
                hostH: this.app.height,
                hostCanvas: hostCanvas || undefined,
                itemIconCanvas: this.ctx.getItemIconCanvas?.(),
                objLoader: this.ctx.getObjLoader?.(),
                renderModelCanvas: this.ctx.getRenderModelCanvas?.(),
                game: this.ctx.getGameContext?.(),
                getCacheSystem: () => this.ctx.getCacheSystem(),
                widgetManager: this.ctx.getWidgetManager?.(),
                requestRepaintAll: () => {
                    // The overlay is redrawn every PostPresent; no extra action needed
                },
                openGroup: (groupId: number | string) => {
                    try {
                        let gid: number | undefined;
                        if (typeof groupId === "number") {
                            gid = groupId;
                        } else if (groupId === "skill_guide") {
                            gid = 214;
                        } else if (groupId === "equipment_stats") {
                            gid = 84;
                        }

                        if (gid !== undefined) {
                            const client = this.ctx.getGameContext?.()?.osrsClient;
                            if (client?.widgetSessionManager) {
                                client.widgetSessionManager.open(gid, { modal: true });
                            }
                        }
                    } catch (e) {
                        console.error("Failed to open group", groupId, e);
                    }
                },
            };
        }
        // Update only the fields that may change each frame
        const baseRenderOpts = this.cachedBaseRenderOpts;
        baseRenderOpts.spriteIndex = spriteIndex as CacheIndex;
        baseRenderOpts.hostW = overlaySize.width;
        baseRenderOpts.hostH = overlaySize.height;
        baseRenderOpts.hostCanvas = hostCanvas || undefined;
        baseRenderOpts.widgetManager = this.ctx.getWidgetManager?.();
        baseRenderOpts.game = this.ctx.getGameContext?.();

        // PERF: Reuse cached array instead of allocating new one each frame
        this.widgetEntries.length = 0;
        for (const source of rootSources) {
            const entry = this.prepareWidgetEntry(source, baseRenderOpts);
            if (entry) this.widgetEntries.push(entry);
        }
    }

    private prepareWidgetEntry(
        root: any,
        baseRenderOpts: Omit<
            GLRenderOpts,
            "rootOffsetX" | "rootOffsetY" | "rootScale" | "rootScaleX" | "rootScaleY"
        >,
    ): WidgetRenderEntry | undefined {
        if (!root) return undefined;
        // Layout is done by computeWidgetRoots() - don't re-layout here
        // Widgets position themselves via their xPositionMode/yPositionMode alignment.
        // No external centering needed - just render at computed positions.
        // Keep legacy GL hover/tooltip text disabled; CS2-generated tooltip widgets are canonical.
        const renderOpts: GLRenderOpts = {
            ...baseRenderOpts,
            rootOffsetX:
                typeof (root as any).__widgetRenderOffsetX === "number"
                    ? Math.round(Number((root as any).__widgetRenderOffsetX) * this.overlayScaleX)
                    : 0,
            rootOffsetY:
                typeof (root as any).__widgetRenderOffsetY === "number"
                    ? Math.round(Number((root as any).__widgetRenderOffsetY) * this.overlayScaleY)
                    : 0,
            rootScale:
                typeof (root as any).__widgetRenderScale === "number"
                    ? Number((root as any).__widgetRenderScale) * this.overlayScaleX
                    : 1.0,
            rootScaleX:
                typeof (root as any).__widgetRenderScaleX === "number"
                    ? Number((root as any).__widgetRenderScaleX) * this.overlayScaleX
                    : undefined,
            rootScaleY:
                typeof (root as any).__widgetRenderScaleY === "number"
                    ? Number((root as any).__widgetRenderScaleY) * this.overlayScaleY
                    : undefined,
            skipTooltip: true,
        };
        return { root, renderOpts };
    }

    private clampRectToCanvas(x: number, y: number, w: number, h: number): DirtyRect | undefined {
        const canvasW = this.glRenderer?.width ?? this.app.width;
        const canvasH = this.glRenderer?.height ?? this.app.height;
        const x0 = Math.max(0, x | 0);
        const y0 = Math.max(0, y | 0);
        const x1 = Math.min(canvasW, (x | 0) + Math.max(0, w | 0));
        const y1 = Math.min(canvasH, (y | 0) + Math.max(0, h | 0));
        if (x1 <= x0 || y1 <= y0) return undefined;
        return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }

    private getRootRect(widgetManager: WidgetManager, root: any): DirtyRect | undefined {
        const rootIndex = root && typeof root.rootIndex === "number" ? root.rootIndex | 0 : -1;
        if (rootIndex < 0 || rootIndex >= widgetManager.rootWidgetCount) return undefined;
        return this.clampRectToCanvas(
            Math.round((widgetManager.rootWidgetXs[rootIndex] | 0) * this.overlayScaleX),
            Math.round((widgetManager.rootWidgetYs[rootIndex] | 0) * this.overlayScaleY),
            Math.round((widgetManager.rootWidgetWidths[rootIndex] | 0) * this.overlayScaleX),
            Math.round((widgetManager.rootWidgetHeights[rootIndex] | 0) * this.overlayScaleY),
        );
    }

    private getWidgetDirtyRect(widget: any): DirtyRect | undefined {
        const x = Number(widget?._absX);
        const y = Number(widget?._absY);
        const w = Number(widget?._absWidth);
        const h = Number(widget?._absHeight);
        if (
            !Number.isFinite(x) ||
            !Number.isFinite(y) ||
            !Number.isFinite(w) ||
            !Number.isFinite(h)
        ) {
            return undefined;
        }
        return this.clampRectToCanvas(
            Math.floor(x) - 1,
            Math.floor(y) - 1,
            Math.ceil(w) + 2,
            Math.ceil(h) + 2,
        );
    }

    private rectsIntersect(a: DirtyRect, b: DirtyRect): boolean {
        return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    }

    private rectsOverlapOrTouch(a: DirtyRect, b: DirtyRect): boolean {
        return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
    }

    private mergeDirtyRects(rects: DirtyRect[]): DirtyRect[] {
        if (rects.length <= 1) return rects;
        const merged: DirtyRect[] = [];
        for (const rect of rects) {
            let current = rect;
            let changed = true;
            while (changed) {
                changed = false;
                for (let i = 0; i < merged.length; i++) {
                    const existing = merged[i];
                    if (!this.rectsOverlapOrTouch(current, existing)) continue;
                    const x0 = Math.min(current.x, existing.x);
                    const y0 = Math.min(current.y, existing.y);
                    const x1 = Math.max(current.x + current.w, existing.x + existing.w);
                    const y1 = Math.max(current.y + current.h, existing.y + existing.h);
                    current = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
                    merged.splice(i, 1);
                    changed = true;
                    break;
                }
            }
            merged.push(current);
        }
        return merged;
    }

    private clearOffscreenRect(rect: DirtyRect): void {
        if (!this.glRenderer) return;
        const gl = this.glRenderer.gl;
        const canvasW = this.glRenderer.width | 0;
        const canvasH = this.glRenderer.height | 0;
        gl.enable(gl.SCISSOR_TEST);
        gl.scissor(rect.x, canvasH - (rect.y + rect.h), rect.w, rect.h);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.scissor(0, 0, canvasW, canvasH);
    }

    private attachOverlayCanvas(): void {
        const overlayCanvas = this.overlayCanvas;
        if (!overlayCanvas) return;
        const hostCanvas = this.app?.gl?.canvas as HTMLCanvasElement | undefined;
        const parent = hostCanvas?.parentElement;
        if (!parent) return;
        overlayCanvas.style.display = "";
        if (overlayCanvas.parentElement === parent) return;
        if (overlayCanvas.parentElement) {
            try {
                overlayCanvas.parentElement.removeChild(overlayCanvas);
            } catch {}
        }
        parent.appendChild(overlayCanvas);
    }

    private getOverlayRenderSize(): { width: number; height: number } {
        const hostCanvas = this.app?.gl?.canvas as HTMLCanvasElement | undefined;
        const cssWidth =
            hostCanvas?.clientWidth ||
            hostCanvas?.offsetWidth ||
            hostCanvas?.getBoundingClientRect().width ||
            0;
        const cssHeight =
            hostCanvas?.clientHeight ||
            hostCanvas?.offsetHeight ||
            hostCanvas?.getBoundingClientRect().height ||
            0;
        const safeCssWidth = Math.max(1, Math.round(cssWidth || this.app.width || 1));
        const safeCssHeight = Math.max(1, Math.round(cssHeight || this.app.height || 1));
        const mainScaleX = Math.max(1, (this.app.width || 1) / safeCssWidth);
        const mainScaleY = Math.max(1, (this.app.height || 1) / safeCssHeight);
        const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
        // Desktop overlay matches the main buffer (device pixels) exactly; the
        // widget render scale is already integer-snapped in computeUiRenderMetrics,
        // so any extra overlay scaling here would re-introduce resampling blur.
        const targetUiScale = isTouchDevice ? Math.max(1, Math.min(dpr, 2)) : mainScaleX;
        this.overlayScaleX = Math.max(1, targetUiScale / mainScaleX);
        this.overlayScaleY = Math.max(1, targetUiScale / mainScaleY);
        const canvases = [this.overlayCanvas, this.renderCanvas];
        for (const canvas of canvases) {
            if (!canvas) continue;
            const canvasAny = canvas as any;
            canvasAny.__uiInputScaleX = this.overlayScaleX;
            canvasAny.__uiInputScaleY = this.overlayScaleY;
            // Propagate renderScaleX from the main canvas so choose-option and other
            // overlay renderers use the same scale source as overhead text/hitsplats.
            const hostRenderScale = (hostCanvas as any)?.__uiRenderScale;
            if (typeof hostRenderScale === "number" && hostRenderScale > 0) {
                canvasAny.__uiRenderScale = hostRenderScale;
            }
        }
        return {
            width: Math.max(1, Math.round(this.app.width * this.overlayScaleX)),
            height: Math.max(1, Math.round(this.app.height * this.overlayScaleY)),
        };
    }

    private clearOverlayCanvas(): void {
        this.glRenderer?.clear(0, 0, 0, 0);
        if (this.overlayCanvas) {
            const ctx = this.overlayCanvas.getContext("2d");
            ctx?.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
        }
        this.hasPresentedFrame = false;
    }

    private presentOverlayCanvas(full: boolean, rects: DirtyRect[]): void {
        if (!this.glRenderer || !this.overlayCanvas) return;
        const source = this.glRenderer.canvas;
        const ctx = this.overlayCanvas.getContext("2d");
        if (!ctx) return;
        this.glRenderer.gl.flush();
        ctx.imageSmoothingEnabled = false;
        if (full || !this.hasPresentedFrame) {
            ctx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
            ctx.drawImage(source, 0, 0);
            this.hasPresentedFrame = true;
            return;
        }
        for (const rect of rects) {
            const x = rect.x | 0;
            const y = rect.y | 0;
            const w = Math.max(0, rect.w | 0);
            const h = Math.max(0, rect.h | 0);
            if (w <= 0 || h <= 0) continue;
            ctx.clearRect(x, y, w, h);
            ctx.drawImage(source, x, y, w, h, x, y, w, h);
        }
    }

    private getMenuAnchorPoint(menu: any): { x: number; y: number } {
        if (menu?.source === "widgets") {
            return {
                x: (menu?.x ?? 0) | 0,
                y: (menu?.y ?? 0) | 0,
            };
        }
        return {
            x: Math.round(((menu?.x ?? 0) | 0) * this.overlayScaleX),
            y: Math.round(((menu?.y ?? 0) | 0) * this.overlayScaleY),
        };
    }

    private getMenuVisualState(
        sharedUi: any,
        inputManager?: {
            mouseX?: number;
            mouseY?: number;
            clickMode3?: number;
            saveClickX?: number;
            saveClickY?: number;
        },
    ): { signature: string; rect?: DirtyRect } {
        const menu = sharedUi?.menu;
        if (!(menu && menu.open && Array.isArray(menu.entries) && menu.entries.length > 0)) {
            return { signature: "closed" };
        }
        const fontLoader = this.ctx.getFontLoader?.() || (() => undefined);
        const hostW = this.glRenderer?.width || this.app.width;
        const hostH = this.glRenderer?.height || this.app.height;
        const hostCanvas = this.app?.gl?.canvas as HTMLCanvasElement | undefined;
        const cssW = hostCanvas?.clientWidth || hostCanvas?.offsetWidth || 0;
        const cssH = hostCanvas?.clientHeight || hostCanvas?.offsetHeight || 0;
        const anchor = this.getMenuAnchorPoint(menu);
        const rect = getChooseOptionMenuRect(
            fontLoader,
            {
                ...menu,
                x: anchor.x,
                y: anchor.y,
            },
            hostW,
            hostH,
            getUiScale(cssW, cssH),
        );
        const mx = (sharedUi?.mouseX ?? 0) | 0;
        const my = (sharedUi?.mouseY ?? 0) | 0;
        const clickMode3 = (inputManager?.clickMode3 ?? 0) | 0;
        const saveClickX = (inputManager?.saveClickX ?? -1) | 0;
        const saveClickY = (inputManager?.saveClickY ?? -1) | 0;
        let entriesSig = "";
        for (let i = 0; i < menu.entries.length; i++) {
            const entry = menu.entries[i];
            if (i > 0) entriesSig += "\u0001";
            entriesSig += `${entry?.option ?? ""}\u0002${entry?.target ?? ""}`;
        }
        const signature = `open:${menu.follow ? 1 : 0}:${menu.x | 0}:${
            menu.y | 0
        }:${mx}:${my}:${clickMode3}:${saveClickX}:${saveClickY}:${entriesSig}`;
        return { signature, rect };
    }

    draw(phase: RenderPhase): void {
        // Only draw in PostPresent phase
        if (phase !== RenderPhase.PostPresent) {
            return;
        }

        if (!this.enabled) {
            this.clearOverlayCanvas();
            return;
        }

        if (!this.glRenderer || !this.overlayCanvas) {
            return;
        }

        if (this.widgetEntries.length === 0) {
            const widgetManager = this.ctx.getWidgetManager?.();
            if (!this.hasPresentedFrame || (widgetManager?.rootInterface ?? -1) === -1) {
                this.clearOverlayCanvas();
            }
            return;
        }

        try {
            // Share a single UI state bag between host canvas (world) and offscreen widget canvas (widgets/menu).
            // This keeps Choose Option + shared UI callbacks/state consistent across both passes.
            const hostCanvasAny = this.app.gl.canvas as any;
            const overlayCanvasAny = this.overlayCanvas as any;
            const renderCanvasAny = this.glRenderer.canvas as any;
            const sharedUi = (hostCanvasAny.__ui =
                hostCanvasAny.__ui || overlayCanvasAny.__ui || renderCanvasAny.__ui || {});
            overlayCanvasAny.__ui = sharedUi;
            renderCanvasAny.__ui = sharedUi;

            // Check dirty state from widget manager
            const widgetManager = this.ctx.getWidgetManager?.();
            let anyDirty = true; // Default to dirty if no manager
            let preciseDirtyWidgets: any[] = [];

            if (widgetManager) {
                // Update compass angle from camera yaw before rendering
                const gameCtx = this.ctx.getGameContext?.();
                const cameraYaw = gameCtx?.osrsClient?.camera?.yaw ?? 0;
                widgetManager.updateCompassAngle(cameraYaw);

                // Check if any root widget region needs redraw
                anyDirty = widgetManager.isAnyRootDirty();
                const getPreciseDirtyWidgets = (widgetManager as any).getPreciseDirtyWidgets;
                if (typeof getPreciseDirtyWidgets === "function") {
                    preciseDirtyWidgets = getPreciseDirtyWidgets.call(widgetManager);
                }
            }

            // Also check if menu is open - Choose Option menu needs to render even if widgets aren't dirty
            const hostCanvas = this.app.gl.canvas as any;
            const ui = hostCanvas?.__ui;
            const inputManager = this.ctx.getGameContext?.()?.osrsClient?.inputManager;
            try {
                if (sharedUi && inputManager) {
                    sharedUi.mouseX = inputManager.mouseX | 0;
                    sharedUi.mouseY = inputManager.mouseY | 0;
                }
            } catch {}
            const menuOpen = !!ui?.menu?.open;
            const menuVisualState = this.getMenuVisualState(sharedUi, inputManager);
            const menuVisualDirty = menuVisualState.signature !== this.lastMenuVisualSignature;
            const tradeOverlaySignature = this.getTradeAmountOverlaySignature(widgetManager);
            const tradeOverlayDirty = tradeOverlaySignature !== this.lastTradeAmountOverlaySignature;

            // Force a full redraw only for root set changes.
            // The Choose Option menu is drawn as part of the shared widget overlay. When it is
            // open, partial dirty-rect redraws can visibly blink as hover/click state changes
            // every frame. Redraw the full overlay for the duration of the menu instead.
            const forceFullRedraw =
                !this.hasPresentedFrame || this.rootSetChanged || menuOpen || tradeOverlayDirty;
            const preciseDirtyCount = preciseDirtyWidgets.length | 0;
            const shouldRedraw =
                anyDirty || preciseDirtyCount > 0 || forceFullRedraw || menuVisualDirty;

            const consumedRootIndices: number[] = [];

            if (shouldRedraw) {
                let renderFull = forceFullRedraw || !widgetManager;
                let dirtyRects: DirtyRect[] = [];

                if (!renderFull && widgetManager) {
                    for (const entry of this.widgetEntries) {
                        const root = entry.root;
                        const rootIndex =
                            typeof root?.rootIndex === "number" ? root.rootIndex | 0 : -1;
                        if (rootIndex < 0 || !widgetManager.isRootDirty(rootIndex)) continue;
                        consumedRootIndices.push(rootIndex);
                        const rootRect = this.getRootRect(widgetManager, root);
                        if (rootRect) dirtyRects.push(rootRect);
                    }
                    if (dirtyRects.length === 0) {
                        dirtyRects = [];
                    }
                }
                if (!renderFull && preciseDirtyCount > 0) {
                    for (const widget of preciseDirtyWidgets) {
                        const rect = this.getWidgetDirtyRect(widget);
                        if (rect) dirtyRects.push(rect);
                    }
                }

                if (menuVisualDirty) {
                    if (this.lastMenuVisualRect) dirtyRects.push(this.lastMenuVisualRect);
                    if (menuVisualState.rect) dirtyRects.push(menuVisualState.rect);
                }
                if (!renderFull) {
                    if (dirtyRects.length === 0) {
                        renderFull = true;
                    } else {
                        dirtyRects = this.mergeDirtyRects(dirtyRects);
                    }
                }

                if (widgetManager) {
                    const managerAny = widgetManager as any;
                    if (renderFull && typeof managerAny.consumeAllRootDirty === "function") {
                        managerAny.consumeAllRootDirty();
                    } else if (typeof managerAny.consumeRootDirty === "function") {
                        for (const rootIndex of consumedRootIndices) {
                            managerAny.consumeRootDirty(rootIndex);
                        }
                    }
                }
                if (renderFull) {
                    // Full pass: reset transient input targets, rebuild root order, redraw all roots.
                    beginWidgetUiFrame(this.glRenderer);
                    this.glRenderer.clear(0, 0, 0, 0);
                    try {
                        const roots = (sharedUi as any).__widgetRoots;
                        if (roots) {
                            roots.length = 0;
                        } else {
                            (sharedUi as any).__widgetRoots = [];
                        }
                    } catch {}

                    for (const entry of this.widgetEntries) {
                        renderWidgetTreeGL(this.glRenderer, entry.root, entry.renderOpts);
                    }
                    this.drawTradeAmountOverlay(widgetManager);
                    this.rootSetChanged = false;
                } else if (widgetManager) {
                    // Partial pass: keep existing click targets and redraw only dirty root regions.
                    // Widget click targets are persistent; menu redraws add their previous/current
                    // bounds into dirtyRects so an open menu no longer forces a full widget pass.
                    for (const dirtyRect of dirtyRects) {
                        this.clearOffscreenRect(dirtyRect);
                        const rootClip = {
                            x0: dirtyRect.x,
                            y0: dirtyRect.y,
                            x1: dirtyRect.x + dirtyRect.w,
                            y1: dirtyRect.y + dirtyRect.h,
                        };

                        let renderedAnyRoot = false;
                        for (const entry of this.widgetEntries) {
                            const rootRect = this.getRootRect(widgetManager, entry.root);
                            if (!rootRect || !this.rectsIntersect(rootRect, dirtyRect)) continue;
                            renderedAnyRoot = true;
                            renderWidgetTreeGL(this.glRenderer, entry.root, {
                                ...entry.renderOpts,
                                rootClip,
                            });
                        }
                        if (!renderedAnyRoot && this.widgetEntries.length > 0) {
                            renderWidgetTreeGL(this.glRenderer, this.widgetEntries[0].root, {
                                ...this.widgetEntries[0].renderOpts,
                                rootClip,
                            });
                        }
                    }
                    this.drawTradeAmountOverlay(widgetManager);
                }
                this.presentOverlayCanvas(renderFull, dirtyRects);

                this.lastMenuVisualSignature = menuVisualState.signature;
                this.lastMenuVisualRect = menuVisualState.rect;
                this.lastTradeAmountOverlaySignature = tradeOverlaySignature;
            }

            // Process input against the current click target registry.
            // Targets are rebuilt on full redraws and persisted across partial/clean frames.
            processWidgetUiInput(this.glRenderer, inputManager);

            // IMPORTANT: Clear dirty flags AFTER draw, so next frame starts clean.
            // Dirty flags set during the NEXT frame's tick will be visible to NEXT frame's draw.
            widgetManager?.beginFrame();
        } catch (e) {
            console.error("Error rendering widgets:", e);
        }
    }

    private getTradeAmountOverlaySignature(widgetManager?: WidgetManager): string {
        const client = this.ctx.getGameContext?.()?.osrsClient;
        if (!client?.isTradeQuantityInputActive?.()) return "hidden";
        const value = String(client.cs2Vm?.inputDialogString ?? "");
        const roots = widgetManager?.getAllGroupRoots?.(162) ?? [];
        const bounds = roots
            .map((root: any) => `${root?._absX ?? root?.x ?? 0},${root?._absY ?? root?.y ?? 0}`)
            .join(";");
        return `visible:${value}:${bounds}`;
    }

    /** Draw over the chat history while preserving the underlying widget tree. */
    private drawTradeAmountOverlay(widgetManager?: WidgetManager): void {
        const client = this.ctx.getGameContext?.()?.osrsClient;
        if (!client?.isTradeQuantityInputActive?.() || !this.glRenderer || !widgetManager) return;

        const roots = widgetManager.getAllGroupRoots?.(162) ?? [];
        if (roots.length === 0) return;
        const left = Math.min(...roots.map((w: any) => w?._absX ?? w?.x ?? 0));
        const top = Math.min(...roots.map((w: any) => w?._absY ?? w?.y ?? 0));
        const right = Math.max(
            ...roots.map((w: any) => (w?._absX ?? w?.x ?? 0) + (w?.width ?? 0)),
        );
        const bottom = Math.max(
            ...roots.map((w: any) => (w?._absY ?? w?.y ?? 0) + (w?.height ?? 0)),
        );
        const width = Math.max(1, right - left);
        // Preserve the channel tabs along the bottom of the normal chatbox.
        const height = Math.max(72, bottom - top - 25);
        const x = left + 4;
        const y = top + 4;
        const innerWidth = Math.max(1, width - 8);
        const innerHeight = Math.max(1, height - 8);

        // Warm parchment tone approximates the native chatbox panel and masks
        // scrollback without changing the widget/layout tree beneath it.
        this.glRenderer.drawRect(x, y, innerWidth, innerHeight, [0.76, 0.71, 0.59, 1]);
        const fontLoader = this.ctx.getFontLoader?.() || (() => undefined);
        drawTextGL(
            this.glRenderer,
            fontLoader,
            "Enter amount:",
            x,
            y + Math.floor(innerHeight * 0.35),
            innerWidth,
            20,
            FONT_VERDANA_13,
            0x000000,
            1,
            1,
            false,
        );
        drawTextGL(
            this.glRenderer,
            fontLoader,
            `<col=0000ff>${String(client.cs2Vm?.inputDialogString ?? "")}*</col>`,
            x,
            y + Math.floor(innerHeight * 0.55),
            innerWidth,
            20,
            FONT_VERDANA_13,
            0x0000ff,
            1,
            1,
            false,
        );
        this.glRenderer.flush();
    }

    setWidgetVisibility(uid: number, visible: boolean): void {
        this.visible.set(uid, visible);
    }

    clearVisibility(): void {
        this.visible.clear();
    }
}
