import {
    DrawCall,
    App as PicoApp,
    PicoGL,
    Program,
    Texture,
    VertexArray,
    VertexBuffer,
} from "picogl";

import { profiler } from "../../client/webgl/PerformanceProfiler";
import { CacheIndex } from "../../rs/cache/CacheIndex";
import { CacheSystem } from "../../rs/cache/CacheSystem";
import { BitmapFont } from "../../rs/font/BitmapFont";
import { GLRenderer } from "../gl/renderer";
import { getChooseOptionMenuRect } from "../gl/choose-option";
import {
    GLRenderOpts,
    beginWidgetUiFrame,
    processWidgetUiInput,
    renderWidgetTreeGL,
} from "../gl/widgets-gl";
import type { WidgetManager } from "../widgets/WidgetManager";
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
    private offscreenCanvas?: HTMLCanvasElement;
    private widgetEntries: WidgetRenderEntry[] = [];
    private visible: Map<number, boolean> = new Map();
    private drawCall?: DrawCall;
    private vertexArray?: VertexArray;
    private positions?: VertexBuffer;
    private uvs?: VertexBuffer;

    // PERF: Cached texture to avoid create/delete every frame
    private cachedTexture?: Texture;
    private cachedTextureWidth: number = 0;
    private cachedTextureHeight: number = 0;

    // PERF: Cached tint array to avoid allocation every frame
    private readonly whiteTint = new Float32Array([1, 1, 1, 1]);

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

    // Scratch canvas used for dirty-region texture uploads.
    private uploadScratchCanvas?: HTMLCanvasElement;
    private uploadScratchCtx?: CanvasRenderingContext2D | null;
    private lastMenuVisualSignature: string = "";
    private lastMenuVisualRect?: DirtyRect;

    // PERF: Timing breakdown for profiling
    private accumulatedRenderTime: number = 0;
    private accumulatedUploadTime: number = 0;
    private accumulatedFrames: number = 0;
    private lastBreakdownLogTime: number = 0;

    // Public property to enable/disable the overlay
    public enabled: boolean = true;

    constructor(
        private program: Program,
        private ctx: WidgetsContext,
    ) {}

    /**
     * Get the GL canvas where the click registry is stored.
     * Used for cleaning up click targets when interfaces close.
     */
    getGLCanvas(): HTMLCanvasElement | undefined {
        return this.glRenderer?.canvas as HTMLCanvasElement | undefined;
    }

    dispose(): void {
        // Clean up resources
        if (this.cachedTexture) {
            try {
                this.cachedTexture.delete();
            } catch {}
            this.cachedTexture = undefined;
        }
        this.glRenderer = undefined;
        this.offscreenCanvas = undefined;
        this.uploadScratchCanvas = undefined;
        this.uploadScratchCtx = undefined;
    }

    init(args: OverlayInitArgs): void {
        this.app = args.app;

        // Create offscreen canvas for widget rendering
        this.offscreenCanvas = document.createElement("canvas");
        this.offscreenCanvas.width = this.app.width;
        this.offscreenCanvas.height = this.app.height;

        // Initialize GL renderer for widgets
        try {
            this.glRenderer = new GLRenderer(this.offscreenCanvas);
            this.glRenderer.resize(this.app.width, this.app.height);
        } catch (e) {
            console.error("Failed to initialize GLRenderer for widgets:", e);
        }

        // Create a simple fullscreen quad shader if the provided one doesn't work
        const vsSource = `#version 300 es
            layout(location=0) in vec2 a_position;
            layout(location=1) in vec2 a_texCoord;
            out vec2 v_uv;
            void main() {
                gl_Position = vec4(a_position, 0.0, 1.0);
                v_uv = a_texCoord;
            }`;

        const fsSource = `#version 300 es
            precision mediump float;
            in vec2 v_uv;
            uniform sampler2D u_sprite;
            uniform vec4 u_tint;
            out vec4 fragColor;
            void main() {
                vec4 c = texture(u_sprite, v_uv);
                if (c.a < 0.01) discard;
                fragColor = vec4(c.rgb * u_tint.rgb, c.a * u_tint.a);
            }`;

        // Try to create our own simple shader
        try {
            const simpleProgram = this.app.createProgram(vsSource, fsSource);
            if (simpleProgram) {
                this.program = simpleProgram;
            }
        } catch (e) {
            console.warn("Failed to create simple widget shader, using provided program");
        }

        // Setup fullscreen quad in NDC coordinates
        const positions = new Float32Array([
            -1,
            -1, // bottom-left
            -1,
            1, // top-left
            1,
            1, // top-right
            -1,
            -1, // bottom-left
            1,
            1, // top-right
            1,
            -1, // bottom-right
        ]);

        const uvs = new Float32Array([
            0,
            1, // bottom-left UV
            0,
            0, // top-left UV
            1,
            0, // top-right UV
            0,
            1, // bottom-left UV
            1,
            0, // top-right UV
            1,
            1, // bottom-right UV
        ]);

        this.positions = this.app.createVertexBuffer(PicoGL.FLOAT, 2, positions);
        this.uvs = this.app.createVertexBuffer(PicoGL.FLOAT, 2, uvs);

        this.vertexArray = this.app
            .createVertexArray()
            .vertexAttributeBuffer(0, this.positions)
            .vertexAttributeBuffer(1, this.uvs);

        this.drawCall = this.app.createDrawCall(this.program, this.vertexArray);
    }

    update(args: OverlayUpdateArgs): void {
        if (!this.glRenderer || !this.offscreenCanvas) {
            console.warn("WidgetsOverlay: No GL renderer or canvas");
            return;
        }

        // Update canvas size if needed
        if (
            this.offscreenCanvas.width !== this.app.width ||
            this.offscreenCanvas.height !== this.app.height
        ) {
            this.offscreenCanvas.width = this.app.width;
            this.offscreenCanvas.height = this.app.height;
            this.glRenderer.resize(this.app.width, this.app.height);
            console.log(`WidgetsOverlay: Resized to ${this.app.width}x${this.app.height}`);
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
            signature += root && typeof root.uid === "number" ? root.uid : root?.groupId ?? "";
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
        baseRenderOpts.hostW = this.app.width;
        baseRenderOpts.hostH = this.app.height;
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
                    ? (root as any).__widgetRenderOffsetX | 0
                    : 0,
            rootOffsetY:
                typeof (root as any).__widgetRenderOffsetY === "number"
                    ? (root as any).__widgetRenderOffsetY | 0
                    : 0,
            rootScale:
                typeof (root as any).__widgetRenderScale === "number"
                    ? Number((root as any).__widgetRenderScale)
                    : 1.0,
            rootScaleX:
                typeof (root as any).__widgetRenderScaleX === "number"
                    ? Number((root as any).__widgetRenderScaleX)
                    : undefined,
            rootScaleY:
                typeof (root as any).__widgetRenderScaleY === "number"
                    ? Number((root as any).__widgetRenderScaleY)
                    : undefined,
            skipTooltip: true,
        };
        return { root, renderOpts };
    }

    private clampRectToCanvas(x: number, y: number, w: number, h: number): DirtyRect | undefined {
        const x0 = Math.max(0, x | 0);
        const y0 = Math.max(0, y | 0);
        const x1 = Math.min(this.app.width, (x | 0) + Math.max(0, w | 0));
        const y1 = Math.min(this.app.height, (y | 0) + Math.max(0, h | 0));
        if (x1 <= x0 || y1 <= y0) return undefined;
        return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }

    private getRootRect(widgetManager: WidgetManager, root: any): DirtyRect | undefined {
        const rootIndex = root && typeof root.rootIndex === "number" ? root.rootIndex | 0 : -1;
        if (rootIndex < 0 || rootIndex >= widgetManager.rootWidgetCount) return undefined;
        return this.clampRectToCanvas(
            widgetManager.rootWidgetXs[rootIndex] | 0,
            widgetManager.rootWidgetYs[rootIndex] | 0,
            widgetManager.rootWidgetWidths[rootIndex] | 0,
            widgetManager.rootWidgetHeights[rootIndex] | 0,
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
        gl.enable(gl.SCISSOR_TEST);
        gl.scissor(rect.x, this.app.height - (rect.y + rect.h), rect.w, rect.h);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.scissor(0, 0, this.app.width, this.app.height);
    }

    private ensureCachedTexture(needsNewTexture: boolean): void {
        if (!this.offscreenCanvas) return;
        if (!needsNewTexture) return;
        if (this.cachedTexture) {
            try {
                this.cachedTexture.delete();
            } catch {}
        }
        this.cachedTexture = this.app.createTexture2D(this.offscreenCanvas as any, {
            flipY: false,
            minFilter: PicoGL.NEAREST,
            magFilter: PicoGL.NEAREST,
            wrapS: PicoGL.CLAMP_TO_EDGE,
            wrapT: PicoGL.CLAMP_TO_EDGE,
        });
        this.cachedTextureWidth = this.app.width;
        this.cachedTextureHeight = this.app.height;
    }

    private uploadTextureFull(): void {
        if (!this.cachedTexture || !this.offscreenCanvas) return;
        const gl = this.app.gl;
        gl.bindTexture(gl.TEXTURE_2D, (this.cachedTexture as any).texture);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.offscreenCanvas);
    }

    private uploadTextureRects(rects: DirtyRect[]): void {
        if (!this.cachedTexture || !this.offscreenCanvas || rects.length === 0) return;
        const gl = this.app.gl;
        gl.bindTexture(gl.TEXTURE_2D, (this.cachedTexture as any).texture);

        for (const rect of rects) {
            if (
                rect.w === this.app.width &&
                rect.h === this.app.height &&
                rect.x === 0 &&
                rect.y === 0
            ) {
                gl.texSubImage2D(
                    gl.TEXTURE_2D,
                    0,
                    0,
                    0,
                    gl.RGBA,
                    gl.UNSIGNED_BYTE,
                    this.offscreenCanvas,
                );
                continue;
            }
            if (!this.uploadScratchCanvas) {
                this.uploadScratchCanvas = document.createElement("canvas");
                this.uploadScratchCtx = this.uploadScratchCanvas.getContext("2d", {
                    alpha: true,
                    desynchronized: true,
                });
            }
            const scratch = this.uploadScratchCanvas;
            if (!scratch || !this.uploadScratchCtx) {
                gl.texSubImage2D(
                    gl.TEXTURE_2D,
                    0,
                    0,
                    0,
                    gl.RGBA,
                    gl.UNSIGNED_BYTE,
                    this.offscreenCanvas,
                );
                return;
            }
            if (scratch.width !== rect.w || scratch.height !== rect.h) {
                scratch.width = rect.w;
                scratch.height = rect.h;
            }
            this.uploadScratchCtx.clearRect(0, 0, rect.w, rect.h);
            this.uploadScratchCtx.drawImage(
                this.offscreenCanvas,
                rect.x,
                rect.y,
                rect.w,
                rect.h,
                0,
                0,
                rect.w,
                rect.h,
            );
            gl.texSubImage2D(gl.TEXTURE_2D, 0, rect.x, rect.y, gl.RGBA, gl.UNSIGNED_BYTE, scratch);
        }
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
        const rect = getChooseOptionMenuRect(fontLoader, menu, this.app.width, this.app.height);
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
        const signature =
            `open:${menu.follow ? 1 : 0}:${menu.x | 0}:${menu.y | 0}:${mx}:${my}:${clickMode3}:${saveClickX}:${saveClickY}:${entriesSig}`;
        return { signature, rect };
    }

    draw(phase: RenderPhase): void {
        // Only draw in PostPresent phase
        if (phase !== RenderPhase.PostPresent) {
            return;
        }

        if (!this.enabled) {
            return;
        }
        if (!this.drawCall) {
            return;
        }

        if (!this.glRenderer || !this.offscreenCanvas) {
            return;
        }

        if (this.widgetEntries.length === 0) {
            return;
        }

        try {
            // Share a single UI state bag between host canvas (world) and offscreen widget canvas (widgets/menu).
            // This keeps Choose Option + shared UI callbacks/state consistent across both passes.
            const hostCanvasAny = this.app.gl.canvas as any;
            const offscreenAny = this.offscreenCanvas as any;
            const sharedUi = (hostCanvasAny.__ui = hostCanvasAny.__ui || offscreenAny.__ui || {});
            offscreenAny.__ui = sharedUi;

            // PERF: Check if we need to invalidate the cached texture due to resize
            const needsNewTexture =
                !this.cachedTexture ||
                this.cachedTextureWidth !== this.app.width ||
                this.cachedTextureHeight !== this.app.height;

            // Check dirty state from widget manager
            const widgetManager = this.ctx.getWidgetManager?.();
            let anyDirty = true; // Default to dirty if no manager

            if (widgetManager) {
                // OSRS PARITY: Update compass angle from camera yaw before rendering
                // Reference: class520.java draws compass with Client.camAngleY
                const gameCtx = this.ctx.getGameContext?.();
                const cameraYaw = gameCtx?.osrsClient?.camera?.yaw ?? 0;
                widgetManager.updateCompassAngle(cameraYaw);

                // Check if any root widget region needs redraw
                anyDirty = widgetManager.isAnyRootDirty();
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

            // Force a full redraw only for root set changes or texture recreation.
            // Open menus now redraw via dirty menu rects instead of forcing a full widget pass.
            const forceFullRedraw = this.rootSetChanged || needsNewTexture;
            const shouldRedraw = anyDirty || forceFullRedraw || menuVisualDirty;

            // PERF: Track timing breakdown within WidgetsOverlay
            let renderTime = 0;
            let uploadTime = 0;

            if (shouldRedraw) {
                let renderFull = forceFullRedraw || !widgetManager;
                let dirtyRects: DirtyRect[] = [];

                if (!renderFull && widgetManager) {
                    for (const entry of this.widgetEntries) {
                        const root = entry.root;
                        const rootIndex =
                            typeof root?.rootIndex === "number" ? root.rootIndex | 0 : -1;
                        if (rootIndex < 0 || !widgetManager.isRootDirty(rootIndex)) continue;
                        const rootRect = this.getRootRect(widgetManager, root);
                        if (rootRect) dirtyRects.push(rootRect);
                    }
                    if (dirtyRects.length === 0) {
                        dirtyRects = [];
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

                const t1 = performance.now();
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
                }
                renderTime = performance.now() - t1;

                const t2 = performance.now();
                this.ensureCachedTexture(needsNewTexture);
                if (this.cachedTexture) {
                    if (renderFull) {
                        this.uploadTextureFull();
                    } else {
                        this.uploadTextureRects(dirtyRects);
                    }
                }
                uploadTime = performance.now() - t2;

                // PERF: Log timing breakdown every second
                this.accumulatedRenderTime += renderTime;
                this.accumulatedUploadTime += uploadTime;
                this.accumulatedFrames++;

                this.lastMenuVisualSignature = menuVisualState.signature;
                this.lastMenuVisualRect = menuVisualState.rect;
            }

            // Log breakdown every second (outside shouldRedraw so we always log)
            const logNow = performance.now();
            const logElapsed = logNow - this.lastBreakdownLogTime;
            if (logElapsed > 1000) {
                const total = this.accumulatedRenderTime + this.accumulatedUploadTime;
                if (profiler.enabled && profiler.verbose && total > 0.1) {
                    const renderPct = ((this.accumulatedRenderTime / total) * 100).toFixed(0);
                    const uploadPct = ((this.accumulatedUploadTime / total) * 100).toFixed(0);
                    console.log(
                        `[PERF] WidgetsOverlay breakdown (${
                            this.accumulatedFrames
                        } frames, ${total.toFixed(1)}ms): ` +
                            `render=${this.accumulatedRenderTime.toFixed(1)}ms (${renderPct}%), ` +
                            `upload=${this.accumulatedUploadTime.toFixed(1)}ms (${uploadPct}%)`,
                    );
                }
                this.accumulatedRenderTime = 0;
                this.accumulatedUploadTime = 0;
                this.accumulatedFrames = 0;
                this.lastBreakdownLogTime = logNow;
            }

            // Draw cached texture (always, even if not dirty - it has valid content)
            if (!this.cachedTexture) {
                return;
            }

            // Process input against the current click target registry.
            // Targets are rebuilt on full redraws and persisted across partial/clean frames.
            processWidgetUiInput(this.glRenderer, inputManager);

            // PERF: Cache viewport dimensions instead of querying GL state (causes GPU stall)
            // We know we're rendering to the main canvas at full size
            const viewportW = this.app.width;
            const viewportH = this.app.height;

            // Draw to the default (screen) framebuffer
            this.app.defaultDrawFramebuffer();
            // Set viewport to full screen
            this.app.viewport(0, 0, viewportW, viewportH);

            // Enable blending for transparency
            this.app.enable(PicoGL.BLEND);
            this.app.blendFunc(PicoGL.SRC_ALPHA, PicoGL.ONE_MINUS_SRC_ALPHA);

            // Disable depth testing for UI overlay
            this.app.disable(PicoGL.DEPTH_TEST);
            // Disable face culling for screen-space quad
            this.app.disable(PicoGL.CULL_FACE);

            // Draw the fullscreen quad with the cached widget texture
            this.drawCall
                .texture("u_sprite", this.cachedTexture)
                .uniform("u_tint", this.whiteTint)
                .primitive(PicoGL.TRIANGLES)
                .draw();

            // PERF: No viewport restore needed - we set it to full screen which is the expected state

            // PERF: Do NOT delete texture - keep it cached for next frame

            // IMPORTANT: Clear dirty flags AFTER draw, so next frame starts clean.
            // Dirty flags set during the NEXT frame's tick will be visible to NEXT frame's draw.
            widgetManager?.beginFrame();
        } catch (e) {
            console.error("Error rendering widgets:", e);
        }
    }

    setWidgetVisibility(uid: number, visible: boolean): void {
        this.visible.set(uid, visible);
    }

    clearVisibility(): void {
        this.visible.clear();
    }
}
