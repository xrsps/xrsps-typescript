import type { CacheSystem } from "../../rs/cache/CacheSystem";
import type { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import { WidgetLoader } from "./WidgetLoader";
import type { WidgetNode } from "./WidgetNode";
import { runCs1 } from "./cs1/runCs1";
import { layoutSingleWidget, layoutWidgets } from "./layout/WidgetLayout";

export type { WidgetNode };

export interface WidgetGroupInstance {
    groupId: number;
    root: WidgetNode;
    widgetsByUid: Map<number, WidgetNode>;
    widgetsByFileId: Map<number, WidgetNode>;
}

/** ContentType constants from OSRS client */
export const ContentType = {
    VIEWPORT: 1337, // 3D game viewport
    MINIMAP: 1338, // Minimap area
    COMPASS: 1339, // Compass (rotates with camera yaw)
    WORLDMAP: 1400, // World map
} as const;

/**
 * OSRS PARITY: Tracks a mounted sub-interface
 * Reference: InterfaceParent.java
 */
export interface InterfaceParent {
    group: number; // The interface group ID that's mounted
    // OSRS interface parent type:
    // - 0: modal (mainmodal)
    // - 1: click-through overlay
    // - 3: tab/sidemodal replacement (closed by IF_CLOSE)
    type: number;
    isModal?: boolean; // field1053 in Java - true if this interface captures all input
}

export class WidgetManager {
    private loader: WidgetLoader;
    private groups: Map<number, WidgetGroupInstance> = new Map();
    private widgetByUid: Map<number, WidgetNode> = new Map();
    private widgetUidsByGroup: Map<number, Set<number>> = new Map();
    /**
     * Dynamic UID allocator per group for CC_CREATE/CC_COPY.
     * Must not collide with cache-defined widget ids (usually low child ids).
     */
    private dynamicUidNextByGroup: Map<number, number> = new Map();

    /**
     * OSRS parity: widget flags overrides (Client.widgetFlags).
     * Key: (widget.id << 32) | (widget.childIndex & 0xffffffff)
     * Reference: class405.getWidgetFlags in the Java client.
     */
    private widgetFlagsOverrides: Map<bigint, number> = new Map();
    private widgetFlagsVersion: number = 1;

    /**
     * PERF: Index of parentUid -> static children. Built once during loadGroup.
     * This eliminates O(n) iteration in getStaticChildrenByParentUid.
     */
    private staticChildrenByParent: Map<number, WidgetNode[]> = new Map();

    /**
     * PERF: Cache of groupId -> root widgets (parentUid === -1).
     * Eliminates O(n) iteration in getAllGroupRoots.
     */
    private rootsByGroup: Map<number, WidgetNode[]> = new Map();

    /**
     * OSRS parity: Tracks which groups have been loaded (matches Skills.field3912 in Java client)
     * This prevents re-loading already loaded groups and allows explicit unloading
     */
    private loadedGroups: boolean[] = [];

    /** The widget with contentType 1337 - where 3D scene renders */
    viewportWidget: WidgetNode | null = null;

    /** The widget with contentType 1338 - minimap area */
    minimapWidget: WidgetNode | null = null;

    /** The widget with contentType 1339 - compass (rotates with camera yaw) */
    compassWidget: WidgetNode | null = null;

    /**
     * OSRS PARITY: Sprite ID for the compass graphic from GraphicsDefaults.
     * Reference: WallDecoration.compass loaded from GraphicsDefaults.field4779
     * Set this from GraphicsDefaults.compass when initializing the cache.
     */
    compassSpriteId: number = -1;

    /**
     * OSRS PARITY: Sprite archive ID for IF1 scrollbar arrows from GraphicsDefaults.
     * Reference: GraphicsDefaults.scrollBarSpritesId -> WorldMapArchiveLoader.scrollBarSprites[0/1].
     */
    scrollbarSpriteArchiveId: number = -1;

    /**
     * OSRS parity: The widget currently waiting for server response after clicking "Continue".
     * Reference: Client.meslayerContinueWidget in Java client.
     * When set, the widget's text is rendered as "Please wait..." instead of its actual text.
     */
    meslayerContinueWidget: WidgetNode | null = null;

    /** Current root/top-level interface ID (e.g., 548=fixed, 161=resizable, 601=mobile) */
    rootInterface: number = -1;

    /** Maps widget UID -> mounted interface info */
    interfaceParents: Map<number, InterfaceParent> = new Map();
    /** PERF: Reverse lookup - maps interface group ID -> container UID for O(1) visibility checks */
    private groupToContainerUid: Map<number, number> = new Map();

    onLoadListener?: (scriptId: number, sourceWidget: WidgetNode) => void;
    /** Invoker for runtime-set onLoad handlers (set via IF_SETONLOAD/CC_SETONLOAD) */
    onLoadInvoker?: (sourceWidget: WidgetNode) => void;
    /** Callback fired when an interface closes - used to clean up click targets */
    onInterfaceClose?: (groupId: number) => void;
    onResizeListener?: (scriptId: number, sourceWidget: WidgetNode) => void;
    /** Invoker for runtime-set onResize handlers (set via IF_SETONRESIZE) */
    onResizeInvoker?: (sourceWidget: WidgetNode) => void;
    onSubChangeListener?: (scriptId: number, sourceWidget: WidgetNode) => void;
    /** Invoker for runtime-set onSubChange handlers (set via IF_SETONSUBCHANGE) */
    onSubChangeInvoker?: (sourceWidget: WidgetNode) => void;

    /** Current canvas dimensions for resizing root widgets */
    canvasWidth: number = 0;
    canvasHeight: number = 0;

    /** Reference to the main client */
    osrsClient: any = null;

    // ========== OSRS PARITY: Root Widget Dirty Tracking ==========
    // Reference: Client.java validRootWidgets[], rootWidgetXs/Ys/Widths/Heights[]
    // This enables partial redraws - only re-render regions that changed

    /** Number of active root widget regions this frame */
    rootWidgetCount: number = 0;

    /** X positions of root widget regions (up to 100) */
    rootWidgetXs: Int32Array = new Int32Array(100);

    /** Y positions of root widget regions */
    rootWidgetYs: Int32Array = new Int32Array(100);

    /** Widths of root widget regions */
    rootWidgetWidths: Int32Array = new Int32Array(100);

    /** Heights of root widget regions */
    rootWidgetHeights: Int32Array = new Int32Array(100);

    /** Dirty flags - true if root region needs redraw THIS frame */
    private validRootWidgets: Uint8Array = new Uint8Array(100);

    /** Needs present - region was drawn, awaiting blit to screen */
    private needsPresent: Uint8Array = new Uint8Array(100);

    /** Global dirty flag - when true, everything needs redraw */
    private globalDirty: boolean = true;

    // ========== PERF: Dirty Set for O(1) dirty checking ==========
    /** Set of dirty root indices - O(1) check instead of O(100) scan */
    private dirtyRoots: Set<number> = new Set();

    // ========== PERF: Batch invalidation during script execution ==========
    /** When > 0, defer cascading invalidations until batch ends */
    private batchDepth: number = 0;
    /** Widgets that need invalidation when batch ends */
    private pendingInvalidations: Set<WidgetNode> = new Set();

    // ========== PERF: Frame-local layout validation ==========
    /** Widgets with invalid layout that need validation this frame */
    private dirtyLayoutWidgets: Set<WidgetNode> = new Set();
    /** True after validateAllLayouts() has run this frame */
    private frameLayoutsValidated: boolean = false;

    constructor(cacheSystem: CacheSystem, loader?: WidgetLoader) {
        this.loader = loader ?? new WidgetLoader(cacheSystem);
    }

    /**
     * Resolve the owning root index for any widget by walking up the parent chain.
     * Most widgets are not roots, so `rootIndex` is typically undefined.
     */
    private resolveRootIndex(w: WidgetNode): number | undefined {
        const direct = w.rootIndex;
        if (typeof direct === "number" && direct >= 0 && direct < 100) return direct;

        let current: WidgetNode | undefined = w;
        let hops = 0;
        while (current && typeof current.parentUid === "number" && current.parentUid !== -1) {
            const parent = this.widgetByUid.get(current.parentUid);
            if (!parent) break;
            const ri = parent.rootIndex;
            if (typeof ri === "number" && ri >= 0 && ri < 100) return ri;
            current = parent;
            if (++hops > 50) break; // Safety: avoid pathological cycles
        }

        // OSRS PARITY: InterfaceParent-mounted interfaces are separate widget trees, so widgets
        // inside a mounted group won't have a parent chain leading to a registered root.
        // In that case, resolve the container widget and invalidate its root region instead.
        const groupId =
            typeof (w as any).groupId === "number" ? (w as any).groupId | 0 : (w.uid ?? 0) >>> 16;
        const containerUid = this.groupToContainerUid.get(groupId);
        if (typeof containerUid === "number") {
            const container = this.widgetByUid.get(containerUid);
            if (container) {
                return this.resolveRootIndex(container);
            }
        }

        return undefined;
    }

    // ========== Dirty Tracking Methods ==========

    /**
     * OSRS PARITY: Called at start of each frame to reset dirty tracking.
     * Reference: Client.java draw() method before drawWidgets()
     */
    beginFrame(): void {
        const prevRootCount = this.rootWidgetCount | 0;
        // Copy validRootWidgets to needsPresent (what was dirty becomes "needs present")
        for (let i = 0; i < prevRootCount; i++) {
            this.needsPresent[i] = this.validRootWidgets[i];
            this.validRootWidgets[i] = 0;
        }
        // Also clear any dirty flags beyond rootWidgetCount (could be set by operations before registration)
        for (let i = prevRootCount; i < 100; i++) {
            this.validRootWidgets[i] = 0;
            this.needsPresent[i] = 0;
        }
        // Reset root count for this frame
        this.rootWidgetCount = 0;

        // PERF: Clear dirty set for new frame, then repopulate from needsPresent.
        // Note: We must retain dirty state across frames (needsPresent) for the renderer's O(1) dirty check.
        this.dirtyRoots.clear();
        for (let i = 0; i < 100; i++) {
            if (this.needsPresent[i] === 1) this.dirtyRoots.add(i);
        }

        // If global dirty, mark everything as needing redraw
        if (this.globalDirty) {
            for (let i = 0; i < 100; i++) {
                this.validRootWidgets[i] = 1;
                this.dirtyRoots.add(i); // PERF: Also add to set
                this.needsPresent[i] = 1;
            }
            this.globalDirty = false;
        }

        // PERF: Reset frame-local layout validation state
        this.frameLayoutsValidated = false;
        this.dirtyLayoutWidgets.clear();

        // NOTE: Viewport (3D scene) is rendered separately by WebGL renderer, not by widget overlay.
        // We do NOT mark it dirty here - only actual 2D UI changes should trigger widget redraws.
    }

    /**
     * OSRS PARITY: Register a root widget region and assign it an index.
     * Called during widget tree traversal for each root widget.
     * @returns The assigned root index
     */
    registerRootWidget(w: WidgetNode, x: number, y: number, width: number, height: number): number {
        if (this.rootWidgetCount >= 100) {
            return -1; // Max roots exceeded
        }
        const idx = this.rootWidgetCount++;
        w.rootIndex = idx;
        this.rootWidgetXs[idx] = x | 0;
        this.rootWidgetYs[idx] = y | 0;
        this.rootWidgetWidths[idx] = width | 0;
        this.rootWidgetHeights[idx] = height | 0;
        return idx;
    }

    // PERF: Track invalidation sources for debugging
    private _invalidateCount = 0;
    private _lastInvalidateLog = 0;
    private _invalidateSources: Map<string, number> = new Map();

    /**
     * OSRS PARITY: Mark a widget's root region as needing redraw.
     * Reference: FaceNormal.invalidateWidget() in OSRS client
     */
    invalidateWidgetRender(w: WidgetNode | null | undefined, source?: string): void {
        if (!w) return;

        // PERF: Count invalidations by source
        this._invalidateCount++;
        if (source) {
            this._invalidateSources.set(source, (this._invalidateSources.get(source) ?? 0) + 1);
        }
        const now = performance.now();
        if (now - this._lastInvalidateLog > 2000) {
            this._invalidateCount = 0;
            this._invalidateSources.clear();
            this._lastInvalidateLog = now;
        }

        const idx = this.resolveRootIndex(w);
        if (typeof idx === "number") {
            this.validRootWidgets[idx] = 1;
            this.dirtyRoots.add(idx); // PERF: O(1) dirty tracking
            return;
        }
        // OSRS parity: FaceNormal.invalidateWidget only marks a root when the widget
        // resolves to a tracked root index. Unresolved widgets are ignored here.
    }

    /**
     * OSRS PARITY: Advance type-6 widget model animations (modelFrame/modelFrameCycle).
     * Reference: PlayerCompositionColorTextureOverride.drawModelComponents.
     *
     * This must run on the 20ms client tick (Client.cycle), not the render frame.
     */
    tickModelAnimations(graphicsCycle: number, seqTypeLoader: SeqTypeLoader): void {
        const delta = Math.max(0, graphicsCycle | 0);
        if (delta === 0) return;

        // Iterate all loaded widgets; OSRS only processes those in the active interface tree
        // during drawWidgets(), but maintaining state for offscreen widgets is harmless.
        for (const w of this.widgetByUid.values()) {
            if (!w || ((w.type ?? 0) | 0) !== 6) continue;
            const seqId0 = (w.sequenceId ?? -1) | 0;
            const seqId2 = (w.sequenceId2 ?? -1) | 0;
            if (seqId0 === -1 && seqId2 === -1) continue;

            const cs1Active = runCs1(w, this);
            const seqId = (cs1Active ? seqId2 : seqId0) | 0;
            if (seqId === -1) continue;

            const seqType = seqTypeLoader.load(seqId);
            if (!seqType) continue;

            if (seqType.isSkeletalSeq?.()) {
                const duration = seqType.getSkeletalDuration?.() | 0;
                if (!(duration > 0)) continue;
                const next = ((w.modelFrame ?? 0) | 0) + delta;
                w.modelFrame = next | 0;
                if ((w.modelFrame | 0) >= duration) {
                    w.modelFrame = ((w.modelFrame | 0) - (seqType.frameStep | 0)) | 0;
                    if ((w.modelFrame | 0) < 0 || (w.modelFrame | 0) >= duration) {
                        w.modelFrame = 0;
                    }
                }
                this.invalidateWidgetRender(w, "widget-model-cached");
                continue;
            }

            const frameLengths = seqType.frameLengths;
            const frameIds = seqType.frameIds;
            if (!Array.isArray(frameLengths) || !Array.isArray(frameIds) || frameIds.length === 0) {
                continue;
            }

            let frame = (w.modelFrame ?? 0) | 0;
            let cycle = ((w.modelFrameCycle ?? 0) | 0) + delta;

            // OSRS parity: advance while (cycle > frameLengths[frame]), subtracting the *current*
            // frame length then incrementing frame. Invalidate once per advancement.
            while (cycle > ((frameLengths[frame] ?? 0) | 0)) {
                cycle = (cycle - ((frameLengths[frame] ?? 0) | 0)) | 0;
                frame = (frame + 1) | 0;
                if (frame >= (frameIds.length | 0)) {
                    frame = (frame - (seqType.frameStep | 0)) | 0;
                    if (frame < 0 || frame >= (frameIds.length | 0)) {
                        frame = 0;
                    }
                }
                this.invalidateWidgetRender(w, "widget-model-frame");
            }

            w.modelFrame = frame | 0;
            w.modelFrameCycle = cycle | 0;
        }
    }

    /**
     * Mark all widget regions as dirty (full repaint).
     * Called on resize, interface changes, etc.
     */
    invalidateAll(): void {
        this.globalDirty = true;
    }

    /**
     * PERF: Invalidate render for scroll changes WITHOUT layout invalidation.
     * Scroll only affects screen position of children, not their layout dimensions.
     * This avoids expensive layout cascade when scrolling.
     */
    invalidateScroll(w: WidgetNode): void {
        // Only need render invalidation - children's layout is still valid
        this.invalidateWidgetRender(w, "scroll");
    }

    /**
     * Check if a specific root index needs redraw.
     */
    isRootDirty(rootIndex: number): boolean {
        if (rootIndex < 0 || rootIndex >= 100) return false;
        return this.validRootWidgets[rootIndex] === 1 || this.needsPresent[rootIndex] === 1;
    }

    /** Debug: count how many times dirty check returns true/false */
    private _dirtyCheckStats = { dirty: 0, clean: 0, lastLog: 0 };

    /**
     * Check if ANY root widget region needs redraw.
     * Used by WidgetsOverlay to decide if re-rendering is needed.
     * PERF: Now O(1) via dirty set instead of O(100) array scan.
     */
    isAnyRootDirty(): boolean {
        // Global dirty always means we need to redraw
        if (this.globalDirty) {
            this._dirtyCheckStats.dirty++;
            this._logDirtyStats("globalDirty");
            return true;
        }

        // PERF: O(1) check via dirty set
        if (this.dirtyRoots.size > 0) {
            this._dirtyCheckStats.dirty++;
            this._logDirtyStats(`roots(${this.dirtyRoots.size})`);
            return true;
        }

        this._dirtyCheckStats.clean++;
        this._logDirtyStats(null);
        return false;
    }

    private _logDirtyStats(reason: string | null): void {
        const now = performance.now();
        if (now - this._dirtyCheckStats.lastLog > 2000) {
            this._dirtyCheckStats.lastLog = now;
            this._dirtyCheckStats.dirty = 0;
            this._dirtyCheckStats.clean = 0;
        }
    }

    /**
     * Update canvas dimensions used for root widget sizing
     * @param width New width
     * @param height New height
     */
    resize(width: number, height: number): void {
        const changed = this.canvasWidth !== width || this.canvasHeight !== height;
        this.canvasWidth = width;
        this.canvasHeight = height;
        if (changed) {
            console.log(`[WidgetManager] Screen size: ${width}x${height}`);
            // Invalidate all widgets so they get re-laid out with new dimensions
            for (const group of this.groups.values()) {
                if (group.root) {
                    this.invalidateWidget(group.root, "resize");
                }
            }
            // Also mark all render regions as dirty
            this.invalidateAll();
        }
    }

    /**
     * PARITY: O(1) invalidation called by setters (CC_SETSIZE, CC_SETPOSITION, etc.)
     * Marks this widget and all its children as needing layout recalculation.
     * This implements the "Invalidate Down" part of the lazy layout pattern.
     *
     * PERF: When batching is active, defers cascading invalidation until batch ends.
     */
    invalidateWidget(w: WidgetNode, source?: string): void {
        if (!w) return;
        // OSRS parity: layout mutations must always trigger a redraw, even if the widget
        // is already marked dirty. This matters for timer-driven animations (e.g. XP drops)
        // where multiple CC_SETPOSITION calls can happen while layout remains invalid.
        if (w.isLayoutValid === false) {
            this.dirtyLayoutWidgets.add(w);
            this.invalidateWidgetRender(w, source ?? "layout-already-dirty");
            return; // Already dirty, don't re-cascade
        }

        // PERF: If batching, defer the cascading invalidation
        if (this.batchDepth > 0) {
            this.pendingInvalidations.add(w);
            return;
        }

        this.invalidateWidgetDirect(w, source);
    }

    /**
     * PERF: Direct invalidation without batch check (used internally and after batch ends)
     */
    private invalidateWidgetDirect(w: WidgetNode, source?: string): void {
        if (!w) return;
        // If already dirty, still ensure the owning root region is marked for redraw.
        if (w.isLayoutValid === false) {
            this.invalidateWidgetRender(w, source ?? "layout-already-dirty");
            return;
        }

        w.isLayoutValid = false;

        // PERF: Track for frame-local validation pass
        this.dirtyLayoutWidgets.add(w);

        // Also mark render as dirty (layout change means we need to redraw)
        this.invalidateWidgetRender(w, source ?? "layout-cascade");

        // Cascade down: If I change size, my children (who rely on my size) are now invalid
        // This includes BOTH dynamic children (from CC_CREATE) and static children (from cache)
        if (w.children) {
            for (const child of w.children) {
                if (child) this.invalidateWidgetDirect(child, "layout-child");
            }
        }

        // PARITY FIX: Also invalidate static children (from cache with parentUid pointing here)
        // These children have position/size modes that depend on parent dimensions.
        // Without this, widgets like bottom-aligned decorations (yPositionMode=2) won't
        // recalculate their position when the parent's size changes via if_setsize.
        if (w.uid !== undefined) {
            const staticChildren = this.staticChildrenByParent.get(w.uid);
            if (staticChildren) {
                for (const child of staticChildren) {
                    if (child) this.invalidateWidgetDirect(child, "layout-static-child");
                }
            }

            // OSRS parity: when a type-0 container changes layout, any mounted InterfaceParent
            // group on that container must be revalidated against the new host size/position.
            // Reference: RestClientThreadFactory.revalidateWidgetScroll() resizing mounted groups.
            const mounted = this.interfaceParents.get(w.uid);
            if (mounted) {
                const mountedRoots = this.getAllGroupRoots(mounted.group | 0);
                for (const root of mountedRoots) {
                    if (root) this.invalidateWidgetDirect(root, "layout-mounted-root");
                }
            }
        }
    }

    // ========== PERF: Batch Invalidation API ==========

    /**
     * Begin a batch of widget operations. Invalidations are deferred until endBatch().
     * Use this around script execution to avoid cascading invalidations during the script.
     * Batches can be nested - only the outermost endBatch() triggers the invalidations.
     */
    beginBatch(): void {
        this.batchDepth++;
    }

    /**
     * End a batch of widget operations. If this is the outermost batch, process
     * all pending invalidations in a single pass.
     */
    endBatch(): void {
        if (this.batchDepth <= 0) return;
        this.batchDepth--;

        // Only process when outermost batch ends
        if (this.batchDepth === 0 && this.pendingInvalidations.size > 0) {
            // Process all pending invalidations
            const pending = Array.from(this.pendingInvalidations);
            this.pendingInvalidations.clear();

            for (const w of pending) {
                this.invalidateWidgetDirect(w, "batch");
            }
        }
    }

    /**
     * PARITY: JIT layout operation called by getters (CC_GETWIDTH, CC_GETX, etc.)
     * Ensures the widget's layout is valid before returning computed values.
     * This implements the "Validate Up" part of the lazy layout pattern.
     *
     * PERF: If frame layouts have been pre-validated, this is a simple flag check.
     *
     * @param w The widget to ensure layout for
     */
    ensureLayout(w: WidgetNode): void {
        if (!w) return;

        // OSRS PARITY: During CS2 execution we batch invalidations for performance, but scripts
        // frequently read widget dimensions immediately after mutating layout (if_setsize,
        // if_setposition, etc.). In the Java client these setters call alignWidget and, for
        // containers, revalidateWidgetScroll in the same tick.
        //
        // If we early-return solely based on isLayoutValid during batching, scripts will read
        // stale computed width/height/x/y and compute incorrect values (e.g., dropdown
        // scrollbar dragger sizes).
        //
        // To preserve correctness, treat a widget as needing validation when either it OR any
        // ancestor is pending invalidation in the current batch.
        if (w.isLayoutValid === true) {
            if (this.batchDepth <= 0 || this.pendingInvalidations.size === 0) {
                return; // Already valid and not in a batch
            }

            let needsRevalidate = this.pendingInvalidations.has(w);
            if (!needsRevalidate) {
                let cur: WidgetNode | undefined = w;
                let hops = 0;
                while (cur && typeof cur.parentUid === "number" && cur.parentUid !== -1) {
                    const parent = this.getWidgetByUid(cur.parentUid);
                    if (!parent) break;
                    if (this.pendingInvalidations.has(parent)) {
                        needsRevalidate = true;
                        break;
                    }
                    cur = parent;
                    if (++hops > 50) break; // Safety: avoid pathological cycles
                }
            }

            if (!needsRevalidate) {
                return; // Still valid in this batch
            }
        }

        // 1. Validate Parent First (Recursive Upward)
        // We cannot calculate our position until our parent's position is known.
        let parentW = this.canvasWidth || 0;
        let parentH = this.canvasHeight || 0;

        if (w.parentUid !== undefined && w.parentUid !== -1) {
            const parent = this.getWidgetByUid(w.parentUid);
            if (parent) {
                this.ensureLayout(parent);
                // OSRS PARITY: When a parent has a scroll area, child alignment uses
                // parent.scrollWidth/scrollHeight if non-zero, else parent.width/height.
                // See RestClientThreadFactory.revalidateWidgetScroll().
                const pw = parent.width || 0;
                const ph = parent.height || 0;
                const sw = parent.scrollWidth || 0;
                const sh = parent.scrollHeight || 0;
                parentW = sw !== 0 ? sw : pw;
                parentH = sh !== 0 ? sh : ph;
            }
        } else {
            // OSRS PARITY: Mounted interfaces (InterfaceParent) keep their own widget trees
            // (roots stay parentUid=-1), but are laid out relative to the mount container's
            // scroll area (scrollWidth/scrollHeight or width/height).
            //
            // Reference: RestClientThreadFactory.revalidateWidgetScroll() calls resizeInterface
            // on the mounted group with parentId=-1 and parent size = container size.
            const containerUid = this.groupToContainerUid.get(w.groupId);
            if (typeof containerUid === "number") {
                const container = this.getWidgetByUid(containerUid);
                if (container) {
                    this.ensureLayout(container);
                    const pw = container.width || 0;
                    const ph = container.height || 0;
                    const sw = container.scrollWidth || 0;
                    const sh = container.scrollHeight || 0;
                    parentW = sw !== 0 ? sw : pw;
                    parentH = sh !== 0 ? sh : ph;
                }
            }
        }

        // 2. Solve THIS widget using single-widget layout
        layoutSingleWidget(w, parentW, parentH);

        w.isLayoutValid = true;

        // PERF: Remove from dirty set once validated
        this.dirtyLayoutWidgets.delete(w);
    }

    // ========== PERF: Frame-local Layout Validation ==========

    /**
     * PERF: Validate all dirty layouts in a single pass before rendering.
     * Call this once at the start of the render frame to avoid per-widget
     * ensureLayout calls during tree traversal.
     *
     * This validates widgets in parent-first order to ensure parents are
     * validated before their children.
     */
    validateAllLayouts(): void {
        if (this.frameLayoutsValidated) return; // Already done this frame
        if (this.dirtyLayoutWidgets.size === 0) {
            this.frameLayoutsValidated = true;
            return;
        }

        // Sort by tree depth (parents first) to minimize re-validation
        // We use parentUid === -1 as roots (depth 0), then depth increases
        const widgets = Array.from(this.dirtyLayoutWidgets);

        // Quick depth calculation - just count parent chain length
        const getDepth = (w: WidgetNode): number => {
            let depth = 0;
            let current = w;
            while (current.parentUid !== undefined && current.parentUid !== -1) {
                const parent = this.widgetByUid.get(current.parentUid);
                if (!parent) break;
                current = parent;
                depth++;
                if (depth > 50) break; // Safety limit
            }
            return depth;
        };

        // Sort by depth (shallow first)
        widgets.sort((a, b) => getDepth(a) - getDepth(b));

        // Validate in order
        for (const w of widgets) {
            if (!w.isLayoutValid) {
                this.ensureLayout(w);
            }
        }

        this.dirtyLayoutWidgets.clear();
        this.frameLayoutsValidated = true;
    }

    /**
     * PERF: Check if a widget should skip layout validation based on visibility.
     * Hidden widgets and their children don't need layout computed until shown.
     *
     * @param w The widget to check
     * @returns true if layout should be skipped (widget is hidden)
     */
    shouldSkipLayout(w: WidgetNode): boolean {
        // Hidden widgets don't need layout
        if (w.isHidden) return true;

        // Check parent visibility (hidden parent = hidden children)
        if (w.parentUid !== undefined && w.parentUid !== -1) {
            const parent = this.widgetByUid.get(w.parentUid);
            if (parent && parent.isHidden) return true;
        }

        return false;
    }

    /**
     * Check if a widget is effectively hidden (itself, any ancestor, or mount container is hidden).
     * OSRS-style: Walks the full parent chain AND checks interface mount containers.
     * Use this for hit testing to match OSRS behavior where hidden containers
     * make all their children non-interactive.
     *
     * @param uid The widget UID to check
     * @returns true if the widget or any ancestor is hidden
     */
    isEffectivelyHidden(uid: number): boolean {
        const widget = this.widgetByUid.get(uid);
        const groupId = (uid >>> 16) & 0xffff;
        const childId = uid & 0xffff;

        if (!widget) {
            return true; // Widget not found = treat as hidden
        }

        // Check the widget itself - use 'hidden' property which is set by CS2 if_sethide/cc_sethide
        if (widget.hidden) {
            return true;
        }

        // Walk up the parent chain within this interface
        let parentUid = widget.parentUid;
        while (parentUid !== undefined && parentUid !== -1) {
            const parent = this.widgetByUid.get(parentUid);
            if (!parent) break;
            if (parent.hidden) {
                return true;
            }
            parentUid = parent.parentUid;
        }

        // OSRS-style: Also check if this interface is mounted in a hidden container.
        // Tab interfaces (like 593) are mounted into containers (like 161:76) that may be hidden.
        // PERF: O(1) lookup via reverse map instead of iterating interfaceParents
        const containerUid = this.groupToContainerUid.get(groupId);
        if (containerUid !== undefined) {
            // Found where this interface is mounted - check if container is hidden
            // Recursively check the container (it may also be in a mounted interface)
            if (this.isEffectivelyHidden(containerUid)) {
                return true;
            }
        }

        return false;
    }

    /**
     * PERF: Conditional ensureLayout that respects visibility culling.
     * Use this during render traversal to skip hidden widgets.
     */
    ensureLayoutIfVisible(w: WidgetNode): boolean {
        if (!w) return false;
        if (w.isLayoutValid === true) return true; // Already valid
        if (this.shouldSkipLayout(w)) return false; // Hidden, skip

        this.ensureLayout(w);
        return true;
    }

    getAvailableGroups(): number[] {
        try {
            return this.loader.getAvailableGroups();
        } catch {
            return [];
        }
    }

    getGroup(groupId: number): WidgetGroupInstance | undefined {
        const existing = this.groups.get(groupId);
        if (existing) {
            return existing;
        }
        return this.loadGroup(groupId);
    }

    getGroupRoot(groupId: number): WidgetNode | undefined {
        return this.getGroup(groupId)?.root;
    }

    /**
     * Get ALL root widgets (parentUid === -1) for a group.
     * OSRS desktop interfaces can have multiple independent widget trees.
     * Each root is positioned independently relative to the screen.
     */
    getAllGroupRoots(groupId: number): WidgetNode[] {
        // PERF: Use cached roots instead of O(n) iteration
        const cached = this.rootsByGroup.get(groupId);
        if (cached) return cached;

        const instance = this.getGroup(groupId);
        if (!instance) return [];

        const roots: WidgetNode[] = [];
        for (const w of instance.widgetsByUid.values()) {
            if (w.parentUid === -1) {
                roots.push(w);
            }
        }

        // Sort by fileId to ensure consistent ordering (fileId 0 first)
        roots.sort((a, b) => (a.fileId ?? 0) - (b.fileId ?? 0));

        // Cache for future calls
        this.rootsByGroup.set(groupId, roots);
        return roots;
    }

    findWidget(groupId: number, fileId: number): WidgetNode | undefined {
        return this.getGroup(groupId)?.widgetsByFileId.get(fileId);
    }

    getWidgetByUid(uid: number): WidgetNode | undefined {
        return this.widgetByUid.get(uid);
    }

    /**
     * Allocate a unique runtime UID for a dynamically created widget.
     * OSRS does not require dynamic widgets to have a globally unique integer id,
     * but our renderer/input layers key off `uid`, so collisions break hover/click.
     *
     * We allocate per-group UIDs in the dynamic child-id range (0x8000..0xffff) to avoid
     * collisions with cache-defined widget UIDs (which typically occupy low child ids).
     */
    allocateDynamicUid(groupId: number): number {
        const g = (groupId | 0) & 0xffff;
        // Start dynamic ids in the upper half of the child-id space to avoid collisions
        // with cache-defined child ids (0..~10000).
        let next: number = this.dynamicUidNextByGroup.get(g) ?? 0x8000;

        // Find a free uid (defensive; should be free in practice).
        // Bound the scan to 0x8000 values before wrapping.
        for (let i = 0; i < 0x8000; i++) {
            const childId: number = next & 0xffff;
            const uid: number = (g << 16) | childId;
            next = (childId + 1) & 0xffff;
            if (next < 0x8000) next = 0x8000; // Keep in dynamic range
            if (!this.widgetByUid.has(uid)) {
                this.dynamicUidNextByGroup.set(g, next);
                return uid;
            }
        }

        // If somehow exhausted, fall back to a global scan.
        for (let childId = 0x8000; childId <= 0xffff; childId++) {
            const uid = (g << 16) | childId;
            if (!this.widgetByUid.has(uid)) return uid;
        }
        // Last resort: reuse (should never happen).
        return (g << 16) | 0xffff;
    }

    /**
     * Register a dynamically created widget (via CC_CREATE) so it can be found by UID
     */
    registerWidget(widget: WidgetNode): void {
        if (widget && typeof widget.uid === "number") {
            this.widgetByUid.set(widget.uid, widget);
        }
    }

    /**
     * Unregister a widget (via CC_DELETE) so it's no longer found by UID
     */
    unregisterWidget(uid: number): void {
        this.widgetByUid.delete(uid);
    }

    /**
     * Unregister all child widgets recursively (for CC_DELETEALL)
     */
    unregisterWidgetTree(widget: WidgetNode): void {
        if (!widget) return;
        if (typeof widget.uid === "number") {
            this.widgetByUid.delete(widget.uid);
        }
        if (Array.isArray(widget.children)) {
            for (const child of widget.children) {
                if (child) this.unregisterWidgetTree(child);
            }
        }
    }

    /**
     * Get all static children of a widget by filtering all widgets in the group by parentUid.
     * This matches OSRS rendering which iterates Widget[] and filters by parentId.
     * Does NOT include dynamically created children (those are in widget.children array).
     * PERF: Now O(1) via index instead of O(n) iteration.
     */
    getStaticChildrenByParentUid(parentUid: number): WidgetNode[] {
        // Use pre-built index for O(1) lookup
        return this.staticChildrenByParent.get(parentUid) || [];
    }

    /**
     * Get all widgets in a group as a flat array.
     * This is used by the renderer to iterate all widgets similar to OSRS updateInterface.
     */
    getWidgetsForGroup(groupId: number): WidgetNode[] {
        const group = this.groups.get(groupId);
        if (!group) return [];
        return Array.from(group.widgetsByUid.values());
    }

    setGroupRoot(
        groupId: number,
        groupData: { root: WidgetNode; widgets: Map<number, WidgetNode> },
    ): WidgetGroupInstance {
        this.clearGroupIndex(groupId);
        const instance = this.buildIndex(groupId, groupData.root, groupData.widgets);
        this.groups.set(groupId, instance);
        return instance;
    }

    refreshGroup(groupId: number): WidgetGroupInstance | undefined {
        // Refreshing from existing root is tricky if we need the full map again.
        // Ideally, we re-load from loader which hits the cache.
        return this.loadGroup(groupId);
    }

    /**
     * OSRS parity: Clear ALL widget data. This is a full reset, NOT called during normal gameplay.
     * In OSRS, widgets persist until explicitly unloaded via method6346.
     * Only use this for complete client reset (e.g., logout, reconnect).
     */
    clear(): void {
        // Clear all widget group data
        this.groups.clear();
        this.widgetByUid.clear();
        this.widgetUidsByGroup.clear();
        this.staticChildrenByParent.clear();
        this.rootsByGroup.clear();
        this.loadedGroups = [];
        this.loader.clearCache();

        // Clear dynamic UID allocators
        this.dynamicUidNextByGroup.clear();

        // Clear widget flags overrides
        this.widgetFlagsOverrides.clear();
        this.widgetFlagsVersion++;

        // Clear sub-interface tracking state
        this.interfaceParents.clear();
        this.groupToContainerUid.clear();

        // Clear special widget references
        this.viewportWidget = null;
        this.minimapWidget = null;
        this.compassWidget = null;
        this.meslayerContinueWidget = null;

        // Reset root interface
        this.rootInterface = -1;

        // Reset root widget tracking arrays
        this.rootWidgetCount = 0;
        this.rootWidgetXs.fill(0);
        this.rootWidgetYs.fill(0);
        this.rootWidgetWidths.fill(0);
        this.rootWidgetHeights.fill(0);
        this.validRootWidgets.fill(0);
        this.needsPresent.fill(0);
        this.globalDirty = true;

        // Reset dirty tracking
        this.dirtyRoots.clear();
        this.batchDepth = 0;
        this.pendingInvalidations.clear();
        this.dirtyLayoutWidgets.clear();
        this.frameLayoutsValidated = false;

        // Reset debug/perf stats
        this._invalidateCount = 0;
        this._lastInvalidateLog = 0;
        this._invalidateSources.clear();
        this._dirtyCheckStats = { dirty: 0, clean: 0, lastLog: 0 };
    }

    /**
     * OSRS parity: Matches method6349() in WidgetDefinition.java
     * Clears resource caches (sprites, models, fonts) but NOT widget definitions.
     * This is safe to call without affecting loaded widgets.
     */
    clearResourceCaches(): void {
        // The WidgetLoader handles sprite/model caching if implemented
        // For now, this is a no-op but maintains API parity with OSRS
    }

    /**
     * OSRS parity: Matches loadInterface(int var1) in WidgetDefinition.java
     * Only loads if not already loaded (checks loadedGroups array like Skills.field3912)
     */
    loadGroup(groupId: number): WidgetGroupInstance | undefined {
        // OSRS parity: Check if already loaded (like Skills.field3912[var1] check)
        if (this.loadedGroups[groupId]) {
            return this.groups.get(groupId);
        }

        try {
            const data = this.loader.loadWidgetGroup(groupId);
            if (!data) {
                return undefined;
            }
            const instance = this.setGroupRoot(groupId, data);

            // Mark as loaded (like Skills.field3912[var1] = true)
            this.loadedGroups[groupId] = true;

            return instance;
        } catch {
            return undefined;
        }
    }

    /**
     * OSRS parity: Matches method6346(int var1) in WidgetDefinition.java
     * Explicitly unloads a widget group from memory, allowing it to be reloaded later
     */
    unloadGroup(groupId: number): void {
        if (groupId === -1) return;

        // OSRS parity: Only unload if actually loaded
        if (!this.loadedGroups[groupId]) return;

        // Clear the group from our maps
        this.clearGroupIndex(groupId);
        this.groups.delete(groupId);
        this.clearWidgetFlagsOverridesForGroup(groupId);

        // OSRS parity: Clear meslayerContinueWidget if it belongs to this group
        if (this.meslayerContinueWidget) {
            const continueWidgetGroup = (this.meslayerContinueWidget.uid ?? 0) >> 16;
            if (continueWidgetGroup === groupId) {
                this.meslayerContinueWidget = null;
            }
        }

        // Mark as unloaded (like Skills.field3912[var1] = false)
        this.loadedGroups[groupId] = false;
    }

    private makeWidgetFlagsKey(id: number, childIndex: number): bigint {
        // Coerce to unsigned 32-bit segments to match Java long packing semantics.
        const hi = BigInt((id | 0) >>> 0);
        const lo = BigInt((childIndex | 0) >>> 0);
        return (hi << 32n) | lo;
    }

    /**
     * OSRS parity: Return widget flags with runtime overrides applied.
     * Reference: class405.getWidgetFlags.
     *
     * Key calculation:
     * - Static widgets (from cache): id=uid, childIndex=-1 (from Widget constructor)
     * - Dynamic children (CC_CREATE): id=parentUid, childIndex=slot index (>= 0)
     *
     * This distinction is critical: IF_SETEVENTS sends flags for childIndex >= 0,
     * so static widgets (childIndex=-1) correctly fall back to cache flags,
     * while dynamic children get the server-specified flags.
     */
    getWidgetFlags(w: WidgetNode | null | undefined): number {
        if (!w) return 0;
        const id = ((w as any).id ?? w.uid) | 0;
        // OSRS parity: Static widgets have childIndex=-1 (from Widget.java constructor).
        // Only dynamic children (CC_CREATE) have childIndex >= 0 from the script.
        // Reference: Widget.java line 674: this.childIndex = -1;
        const childIndex =
            typeof (w as any).childIndex === "number" ? (w as any).childIndex | 0 : -1;
        const key = this.makeWidgetFlagsKey(id, childIndex);
        return (this.widgetFlagsOverrides.get(key) ?? w.flags ?? 0) | 0;
    }

    getWidgetFlagsVersion(): number {
        return this.widgetFlagsVersion | 0;
    }

    /**
     * OSRS parity: Set a widget flags override (Client.widgetFlags.put).
     * This does not mutate `w.flags` (base flags from cache).
     */
    setWidgetFlagsOverride(w: WidgetNode, flags: number): void {
        if (!w) return;
        const id = ((w as any).id ?? w.uid) | 0;
        // OSRS parity: Static widgets have childIndex=-1 (from Widget.java constructor).
        // Only dynamic children (CC_CREATE) have childIndex >= 0.
        const childIndex =
            typeof (w as any).childIndex === "number" ? (w as any).childIndex | 0 : -1;
        const key = this.makeWidgetFlagsKey(id, childIndex);
        this.widgetFlagsOverrides.set(key, flags | 0);
        this.widgetFlagsVersion++;
    }

    /**
     * OSRS parity: Set widget flags directly by (id, childIndex) key.
     * Used by IF_SETEVENTS packet which sets flags for a range of child indices
     * without needing the actual widget objects to exist yet.
     * Reference: IF_SETEVENTS stores flags in Client.widgetFlags with key (id << 32) | childIndex
     */
    setWidgetFlagsByKey(id: number, childIndex: number, flags: number): void {
        const key = this.makeWidgetFlagsKey(id | 0, childIndex | 0);
        this.widgetFlagsOverrides.set(key, flags | 0);
        this.widgetFlagsVersion++;
    }

    /**
     * OSRS parity: Check if a widget has server-set transmit flags (from IF_SETEVENTS).
     *
     * This returns flags ONLY from widgetFlagsOverrides (set by the server via IF_SETEVENTS),
     * NOT from the base cache flags. This is used to determine whether an action should be
     * transmitted to the server.
     *
     * Rationale: In OSRS, widgets from the cache may have base flags, but transmit flags
     * (bits 1-10) are typically set at runtime by the server via IF_SETEVENTS to enable
     * server communication. Client-side only interfaces (like skill guide) don't receive
     * IF_SETEVENTS, so their actions should NOT be sent to the server even if the cache
     * has transmit-like bits set.
     *
     * Reference: class405.getWidgetFlags returns override ?? cache, but for transmission
     * we only care about explicitly server-set overrides.
     */
    getServerSetFlags(w: WidgetNode | null | undefined): number | undefined {
        if (!w) return undefined;
        const id = ((w as any).id ?? w.uid) | 0;
        const childIndex =
            typeof (w as any).childIndex === "number" ? (w as any).childIndex | 0 : -1;
        const key = this.makeWidgetFlagsKey(id, childIndex);
        return this.widgetFlagsOverrides.get(key);
    }

    /**
     * OSRS parity: Remove all widget flag overrides for a given interface group.
     * Reference: class47.method911 (checks key >> 48 == groupId).
     */
    clearWidgetFlagsOverridesForGroup(groupId: number): void {
        const g = BigInt((groupId | 0) & 0xffff);
        const toDelete: bigint[] = [];
        for (const key of this.widgetFlagsOverrides.keys()) {
            const keyGroup = (key >> 48n) & 0xffffn;
            if (keyGroup === g) toDelete.push(key);
        }
        for (const key of toDelete) this.widgetFlagsOverrides.delete(key);
        if (toDelete.length > 0) this.widgetFlagsVersion++;
    }

    /**
     * Check if a group is currently loaded
     * OSRS parity: Matches checking Skills.field3912[groupId]
     */
    isGroupLoaded(groupId: number): boolean {
        return this.loadedGroups[groupId] === true;
    }

    private buildIndex(
        groupId: number,
        root: WidgetNode,
        allWidgets: Map<number, WidgetNode>,
    ): WidgetGroupInstance {
        const widgetsByUid = new Map<number, WidgetNode>();
        const widgetsByFileId = new Map<number, WidgetNode>();
        const uids = new Set<number>();

        // Index ALL widgets returned by the loader (including orphans)
        for (const node of allWidgets.values()) {
            if (!node || typeof node !== "object") {
                continue;
            }
            const uid = typeof node.uid === "number" ? node.uid | 0 : undefined;
            if (typeof uid === "number") {
                widgetsByUid.set(uid, node);
                this.widgetByUid.set(uid, node);
                uids.add(uid);
            }
            const nodeGroupId = typeof node.groupId === "number" ? node.groupId | 0 : groupId;
            if (nodeGroupId === (groupId | 0) && typeof node.fileId === "number") {
                widgetsByFileId.set(node.fileId | 0, node);
            }

            // Track special widgets by contentType (like OSRS client does in alignWidgetSize)
            const contentType = typeof node.contentType === "number" ? node.contentType : 0;
            if (contentType === ContentType.VIEWPORT) {
                console.log(
                    `[WidgetManager] Found Viewport Widget: ${node.uid} (Group ${groupId})`,
                );
                this.viewportWidget = node;
            } else if (contentType === ContentType.MINIMAP) {
                this.minimapWidget = node;
            } else if (contentType === ContentType.COMPASS) {
                this.compassWidget = node;
            }

            // PERF: Build parentUid -> children index
            const parentUid = node.parentUid;
            if (typeof parentUid === "number" && parentUid !== -1) {
                let siblings = this.staticChildrenByParent.get(parentUid);
                if (!siblings) {
                    siblings = [];
                    this.staticChildrenByParent.set(parentUid, siblings);
                }
                siblings.push(node);
            }
        }

        // OSRS PARITY: Sort static children by fileId for correct layering
        // In OSRS, updateInterface iterates Widget[] by index (which IS the fileId).
        // Lower fileId = rendered first = background, Higher fileId = rendered later = foreground.
        // Reference: WorldMapRegion.java updateInterface() line 1352-1355
        for (const siblings of this.staticChildrenByParent.values()) {
            siblings.sort((a, b) => (a.fileId ?? 0) - (b.fileId ?? 0));
        }

        this.widgetUidsByGroup.set(groupId, uids);
        return { groupId, root, widgetsByUid, widgetsByFileId };
    }

    private clearGroupIndex(groupId: number) {
        const tracked = this.widgetUidsByGroup.get(groupId);
        if (!tracked) {
            return;
        }
        for (const uid of tracked) {
            // PERF: Also clean up from staticChildrenByParent index
            const widget = this.widgetByUid.get(uid);
            if (widget && typeof widget.parentUid === "number" && widget.parentUid !== -1) {
                const siblings = this.staticChildrenByParent.get(widget.parentUid);
                if (siblings) {
                    const idx = siblings.indexOf(widget);
                    if (idx >= 0) siblings.splice(idx, 1);
                    if (siblings.length === 0) {
                        this.staticChildrenByParent.delete(widget.parentUid);
                    }
                }
            }
            this.widgetByUid.delete(uid);
        }
        this.widgetUidsByGroup.delete(groupId);
        // PERF: Clear roots cache for this group
        this.rootsByGroup.delete(groupId);
    }

    /**
     * Set the root/top-level interface (like OSRS IF_OPENTOPLEVEL packet)
     * This loads the interface and triggers onLoad scripts.
     * OSRS parity: Does NOT clear widget caches - loaded groups persist in memory
     */
    setRootInterface(groupId: number): WidgetGroupInstance | undefined {
        // OSRS parity: Do NOT clear all caches here. Widgets stay loaded in memory.
        // Only clear special widget references and interface parents for the new root.

        // Clear special widget references (will be re-discovered when loading)
        this.viewportWidget = null;
        this.minimapWidget = null;
        this.compassWidget = null;

        // Clear mounted sub-interfaces (they belong to the old root)
        this.interfaceParents.clear();
        this.groupToContainerUid.clear();
        // OSRS parity: Clear runtime widget flags overrides on major interface changes.
        // Reference: Client.java reinitializes widgetFlags when interface parents are refreshed.
        this.widgetFlagsOverrides.clear();
        this.widgetFlagsVersion++;

        // Mark all widgets dirty - major interface change requires full redraw
        this.invalidateAll();

        this.rootInterface = groupId;

        const instance = this.getGroup(groupId);
        if (!instance) {
            return undefined;
        }

        // Layout ALL root widgets (those with parentUid=-1) to canvas dimensions
        // OSRS interfaces can have multiple independent root widget trees
        if (this.canvasWidth > 0 && this.canvasHeight > 0) {
            const allRoots = this.getAllGroupRoots(groupId);
            // Pass static children callback for OSRS parity
            const getStaticChildren = (uid: number) => this.getStaticChildrenByParentUid(uid);

            // First pass: initial layout before onLoad scripts run
            for (const root of allRoots) {
                layoutWidgets(root, this.canvasWidth, this.canvasHeight, getStaticChildren);
            }

            // Trigger onLoad for ALL root widgets
            // onLoad scripts (like toplevel_init) may modify widget positions/sizes
            // via if_setposition, if_setsize, etc.
            for (const root of allRoots) {
                this.triggerOnLoad(root);
            }

            // Second pass: re-layout after onLoad scripts have modified raw values
            // This ensures CS2-set positions (like hud_container_front being moved to top-left)
            // are applied to the computed x/y/width/height values
            for (const root of allRoots) {
                layoutWidgets(root, this.canvasWidth, this.canvasHeight, getStaticChildren);
            }
        }

        return instance;
    }

    /**
     * Mount a sub-interface into a widget (like OSRS IF_OPENSUB packet)
     * Matches real OSRS client behavior - mounts directly to the target UID from server
     * @param targetUid The widget UID to mount into
     * @param groupId The interface group to mount
     * @param type interface parent type (0=modal, 1=overlay, 3=tab/sidemodal replacement)
     */
    openSubInterface(targetUid: number, groupId: number, type: number = 0): void {
        const targetWidget = this.getWidgetByUid(targetUid);
        if (!targetWidget) {
            console.warn(
                `[WidgetManager] openSubInterface: target widget ${targetUid} (${targetUid >> 16}:${
                    targetUid & 0xffff
                }) not found`,
            );
            return;
        }

        // OSRS parity: Opening an interface clears meslayerContinueWidget.
        // Reference: class155.openInterface()
        if (this.meslayerContinueWidget) {
            this.invalidateWidgetRender(this.meslayerContinueWidget, "meslayer-clear");
            this.meslayerContinueWidget = null;
        }

        // Close any existing interface mounted here
        this.closeSubInterface(targetUid);

        // Load the interface
        const instance = this.getGroup(groupId);
        if (!instance) {
            return;
        }

        // Track the mounting
        this.interfaceParents.set(targetUid, { group: groupId, type });
        // PERF: Maintain reverse lookup for O(1) visibility checks
        this.groupToContainerUid.set(groupId, targetUid);

        // Mark widgets dirty - sub-interface change requires redraw
        this.invalidateAll();

        // PARITY FIX: Some interfaces (like 387 equipment tab) have multiple root widgets
        // (parentUid === -1) that need to be mounted together. For example, 387 has:
        // - File 0: main container
        // - Files 2, 4, 6, 8: icon sprites at bottom (Price Checker, Equipment Stats, etc.)
        // Mount ALL root widgets, not just the primary root.
        const allRoots = this.getAllGroupRoots(groupId);

        // PARITY FIX: Ensure target widget's layout is valid BEFORE using its dimensions.
        // Sub-interfaces are often mounted before the first render, when the target widget
        // hasn't been laid out yet. Without this, we'd use 0/undefined dimensions or fall
        // back to canvas size, causing items to be positioned incorrectly (e.g., 30px offset).
        this.ensureLayout(targetWidget);

        // Layout dimensions to use for the sub-interface
        // OSRS PARITY: Use the container's scroll area when present, otherwise its visible size.
        // Reference: RestClientThreadFactory.revalidateWidgetScroll() uses scrollWidth/scrollHeight
        // (falling back to width/height) as the host size when resizing the mounted group.
        const targetHostW =
            (targetWidget.scrollWidth && targetWidget.scrollWidth > 0
                ? targetWidget.scrollWidth
                : targetWidget.width) || 0;
        const targetHostH =
            (targetWidget.scrollHeight && targetWidget.scrollHeight > 0
                ? targetWidget.scrollHeight
                : targetWidget.height) || 0;
        const layoutWidth = targetHostW > 0 ? targetHostW : this.canvasWidth || 0;
        const layoutHeight = targetHostH > 0 ? targetHostH : this.canvasHeight || 0;

        // Pass static children callback for OSRS parity
        const getStaticChildren = (uid: number) => this.getStaticChildrenByParentUid(uid);

        for (const root of allRoots) {
            // OSRS PARITY: Preserve cache-defined rawX/rawY positions for mounted interfaces.
            // Position modes are preserved so interfaces can self-center within containers.
            // E.g., level up dialog (233) has xPosMode=1, yPosMode=1 with rawPos=(0,0) for centering.
            // Dialog options (219) has rawPos=(20,12) with absolute mode for proper offset.
            //
            // The parent container (e.g., CHATMODAL 162:567) is resized via varbit 10670
            // (chatmodal_unclamp) and script 113 to accommodate dialogs properly.

            // First pass: initial layout before onLoad scripts run
            if (layoutWidth > 0 && layoutHeight > 0) {
                layoutWidgets(root, layoutWidth, layoutHeight, getStaticChildren);
            }
        }

        // Trigger onLoad scripts for ALL mounted roots
        // onLoad scripts may modify widget positions/sizes via if_setposition, if_setsize, etc.
        for (const root of allRoots) {
            this.triggerOnLoad(root);
        }

        // Second pass: re-layout after onLoad scripts have modified raw values
        // This ensures CS2-set positions are applied to the computed x/y/width/height values
        for (const root of allRoots) {
            if (layoutWidth > 0 && layoutHeight > 0) {
                layoutWidgets(root, layoutWidth, layoutHeight, getStaticChildren);
            }
        }

        // OSRS PARITY: Many modal interfaces do their initial draw via onResize handlers that
        // are installed during onLoad (e.g., league_areas_draw_interface, league_tasks_draw_list).
        // Root-interface resize is triggered by OsrsClient.updateWidgets() when the root changes or
        // the canvas resizes, but opening a sub-interface does not change either, so we must invoke
        // resize handlers here to ensure first paint happens immediately.
        for (const root of allRoots) {
            this.triggerOnResize(root);
        }

        // Third pass: re-layout after onResize scripts may have updated raw values / created children.
        for (const root of allRoots) {
            if (layoutWidth > 0 && layoutHeight > 0) {
                layoutWidgets(root, layoutWidth, layoutHeight, getStaticChildren);
            }
        }

        // Trigger onSubChange on the ROOT interface (e.g., 161)
        // This is critical for OSRS - when sub-interfaces are mounted, the root interface's
        // onSubChange handler runs, which calls toplevel_sidebuttons_enable to show/hide tab icons
        this.triggerOnSubChange();
    }

    /**
     * Close a sub-interface mounted at a widget
     */
    closeSubInterface(targetUid: number): void {
        const parent = this.interfaceParents.get(targetUid);
        if (!parent) return;

        this.interfaceParents.delete(targetUid);
        // PERF: Maintain reverse lookup for O(1) visibility checks
        this.groupToContainerUid.delete(parent.group);
        // OSRS parity: Clear any widget flag overrides for the closed interface group.
        this.clearWidgetFlagsOverridesForGroup(parent.group);

        // Mark widgets dirty - sub-interface change requires redraw
        this.invalidateAll();

        // OSRS parity: Clear meslayerContinueWidget if it belongs to the closed interface
        // Reference: class155.java:277-279, class47.java:104-106
        if (this.meslayerContinueWidget) {
            const continueWidgetGroup = (this.meslayerContinueWidget.uid ?? 0) >> 16;
            if (continueWidgetGroup === parent.group) {
                this.meslayerContinueWidget = null;
            }
        }

        // Trigger onSubChange on the root interface
        this.triggerOnSubChange();

        // Notify listeners to clean up click targets for this interface
        this.onInterfaceClose?.(parent.group);
    }

    /**
     * Get the interface mounted at a widget, if any
     */
    getSubInterface(targetUid: number): InterfaceParent | undefined {
        return this.interfaceParents.get(targetUid);
    }

    /**
     * Get the container widget UID that a group is mounted into (InterfaceParent reverse lookup).
     * Returns undefined when the group isn't currently mounted.
     */
    getInterfaceParentContainerUid(groupId: number): number | undefined {
        return this.groupToContainerUid.get(groupId | 0);
    }

    /**
     * Trigger onSubChange handlers on all loaded interfaces.
     * Called when sub-interfaces are opened or closed.
     * In OSRS, this triggers handlers like toplevel_subchange (161) and chat_onsubchange (162).
     * The chatbox handler (162:0) calls script 113 which resizes CHATMODAL when dialogs are mounted.
     */
    triggerOnSubChange(): void {
        if (!this.onSubChangeInvoker && !this.onSubChangeListener) return;

        // OSRS PARITY: Trigger onSubChange on the full widget tree for every loaded interface.
        // Reference: VertexNormal.runComponentCloseListeners(var0, 1) walks all descendants,
        // not just roots. This is important for:
        // - Root interface (161): toplevel_subchange - shows/hides tab icons
        // - Chatbox (162): chat_onsubchange -> script 113 - resizes CHATMODAL for dialogs
        for (const [groupId] of this.groups) {
            const roots = this.getAllGroupRoots(groupId);
            if (!roots.length) continue;

            const stack: WidgetNode[] = [...roots];
            while (stack.length > 0) {
                const node = stack.pop();
                if (!node || typeof node !== "object") continue;
                if (!this.isValidSubChangeListenerNode(node)) continue;

                if (node?.eventHandlers?.onSubChange && this.onSubChangeInvoker) {
                    try {
                        this.onSubChangeInvoker(node);
                    } catch (e) {
                        console.warn(
                            `[WidgetManager] Error in onSubChange handler for ${groupId}:`,
                            e,
                        );
                    }
                } else if (
                    Array.isArray(node?.onSubChange) &&
                    node.onSubChange.length > 0 &&
                    this.onSubChangeListener
                ) {
                    try {
                        const scriptId = node.onSubChange[0];
                        if (typeof scriptId === "number" && scriptId > 0) {
                            this.onSubChangeListener(scriptId, node);
                        }
                    } catch (e) {
                        console.warn(
                            `[WidgetManager] Error in cache onSubChange handler for ${groupId}:`,
                            e,
                        );
                    }
                }

                const staticChildren = this.getStaticChildrenByParentUid(node.uid);
                for (let i = staticChildren.length - 1; i >= 0; i--) {
                    stack.push(staticChildren[i]);
                }

                if (Array.isArray(node.children)) {
                    for (let i = node.children.length - 1; i >= 0; i--) {
                        const child = node.children[i];
                        if (child) stack.push(child);
                    }
                }
            }
        }
    }

    private isValidSubChangeListenerNode(widget: WidgetNode): boolean {
        const childIndex =
            typeof (widget as any).childIndex === "number" ? (widget as any).childIndex | 0 : -1;
        if (childIndex < 0) {
            return true;
        }

        const parentUid =
            typeof (widget as any).id === "number"
                ? ((widget as any).id as number) | 0
                : typeof widget.parentUid === "number"
                ? widget.parentUid | 0
                : -1;
        if (parentUid < 0) {
            return false;
        }

        const parent = this.getWidgetByUid(parentUid);
        if (!parent || !Array.isArray(parent.children)) {
            return false;
        }

        return childIndex < parent.children.length && parent.children[childIndex] === widget;
    }

    /**
     * Trigger onLoad scripts for a widget tree.
     * Call this after manually mounting a widget group to initialize CS2 event handlers.
     * OSRS parity: traverses both static children (via parentUid) and dynamic children (via children array)
     */
    triggerOnLoad(root: WidgetNode): void {
        // Need at least one of the listeners/invokers
        if (!this.onLoadListener && !this.onLoadInvoker) return;

        let scriptCount = 0;
        const stack: WidgetNode[] = [root];
        while (stack.length > 0) {
            const node = stack.pop();
            if (!node || typeof node !== "object") continue;

            // First check runtime handler (set via IF_SETONLOAD / CC_SETONLOAD)
            const runtimeHandler = node.eventHandlers?.onLoad;
            if (runtimeHandler && this.onLoadInvoker) {
                scriptCount++;
                this.onLoadInvoker(node);
            }
            // Then check cache-loaded onLoad array (this is critical for setting up tab handlers!)
            else if (Array.isArray(node.onLoad) && node.onLoad.length > 0 && this.onLoadListener) {
                const scriptId = node.onLoad[0];
                if (typeof scriptId === "number" && scriptId > 0) {
                    scriptCount++;
                    this.onLoadListener(scriptId, node);
                }
            }

            // OSRS parity: traverse static children (via parentUid filtering)
            const staticChildren = this.getStaticChildrenByParentUid(node.uid);
            for (let i = staticChildren.length - 1; i >= 0; i--) {
                stack.push(staticChildren[i]);
            }

            // Traverse dynamic children (from CC_CREATE)
            if (Array.isArray(node.children)) {
                for (let i = node.children.length - 1; i >= 0; i--) {
                    const c = node.children[i];
                    if (c) stack.push(c);
                }
            }
        }
    }

    /**
     * Trigger onResize scripts for all loaded widgets
     * Called when the canvas/viewport size changes
     */
    triggerResize(): void {
        // Need at least one of the listeners/invokers
        if (!this.onResizeListener && !this.onResizeInvoker) {
            return;
        }

        // Trigger resize for all widgets in the root interface
        if (this.rootInterface === -1) {
            return;
        }

        const instance = this.groups.get(this.rootInterface);
        if (!instance) {
            return;
        }

        // Helper to invoke resize on a single widget
        const invokeResize = (node: WidgetNode) => this.invokeResize(node);

        // Handle multiple root widgets in the root interface
        // OSRS parity: traverse both static children (via parentUid) and dynamic children
        const allRootRoots = this.getAllGroupRoots(this.rootInterface);
        const stack: WidgetNode[] = [...allRootRoots];
        while (stack.length > 0) {
            const node = stack.pop();
            if (!node || typeof node !== "object") continue;

            invokeResize(node);

            // OSRS parity: traverse static children (via parentUid filtering)
            const staticChildren = this.getStaticChildrenByParentUid(node.uid);
            for (let i = staticChildren.length - 1; i >= 0; i--) {
                stack.push(staticChildren[i]);
            }

            // Traverse dynamic children (from CC_CREATE)
            if (Array.isArray(node.children)) {
                for (let i = node.children.length - 1; i >= 0; i--) {
                    const c = node.children[i];
                    if (c) stack.push(c);
                }
            }
        }

        // Also trigger for mounted sub-interfaces (which may have multiple roots)
        for (const [_uid, parent] of this.interfaceParents) {
            const allSubRoots = this.getAllGroupRoots(parent.group);
            const subStack: WidgetNode[] = [...allSubRoots];
            while (subStack.length > 0) {
                const node = subStack.pop();
                if (!node || typeof node !== "object") continue;

                invokeResize(node);

                // OSRS parity: traverse static children (via parentUid filtering)
                const staticChildren = this.getStaticChildrenByParentUid(node.uid);
                for (let i = staticChildren.length - 1; i >= 0; i--) {
                    subStack.push(staticChildren[i]);
                }

                // Traverse dynamic children (from CC_CREATE)
                if (Array.isArray(node.children)) {
                    for (let i = node.children.length - 1; i >= 0; i--) {
                        const c = node.children[i];
                        if (c) subStack.push(c);
                    }
                }
            }
        }
    }

    /**
     * Trigger onResize scripts for a widget tree.
     * This is used when mounting sub-interfaces so that interfaces which draw on resize
     * (set via IF_SETONRESIZE during onLoad) render immediately.
     */
    triggerOnResize(root: WidgetNode): void {
        if (!this.onResizeListener && !this.onResizeInvoker) return;
        const stack: WidgetNode[] = [root];
        while (stack.length > 0) {
            const node = stack.pop();
            if (!node || typeof node !== "object") continue;

            this.invokeResize(node);

            // Traverse static children (via parentUid filtering)
            const staticChildren = this.getStaticChildrenByParentUid(node.uid);
            for (let i = staticChildren.length - 1; i >= 0; i--) {
                stack.push(staticChildren[i]);
            }

            // Traverse dynamic children (from CC_CREATE)
            if (Array.isArray(node.children)) {
                for (let i = node.children.length - 1; i >= 0; i--) {
                    const c = node.children[i];
                    if (c) stack.push(c);
                }
            }
        }
    }

    private invokeResize(node: WidgetNode): void {
        // First check runtime handler (set via IF_SETONRESIZE / CC_SETONRESIZE)
        const runtimeHandler = node.eventHandlers?.onResize;
        if (runtimeHandler && runtimeHandler.scriptId > 0) {
            if (this.onResizeInvoker) {
                this.onResizeInvoker(node);
            }
            return; // Runtime handler takes precedence
        }

        // Fall back to cache-based handler
        if (Array.isArray(node.onResize) && node.onResize.length > 0) {
            const scriptId = node.onResize[0];
            if (typeof scriptId === "number" && this.onResizeListener) {
                this.onResizeListener(scriptId, node);
            }
        }
    }

    /**
     * OSRS PARITY: Update the compass widget's spriteAngle based on camera yaw.
     * Reference: class520.java method9265() draws compass with Client.camAngleY.
     * In OSRS, the compass is drawn natively using the camera yaw directly.
     * Here we update the widget's spriteAngle property before rendering.
     *
     * @param cameraYaw Camera yaw in OSRS units (0-2048 = 360 degrees)
     */
    updateCompassAngle(cameraYaw: number): void {
        if (!this.compassWidget) return;

        // Convert camera yaw (0-2048) to widget spriteAngle (0-65536)
        // Both represent 360 degrees, so multiply by 32
        // Negate rotation: when facing north (yaw=1024), N should be at top (angle=0)
        const spriteAngle = ((-cameraYaw | 0) * 32) & 0xffff;

        // Only update if changed to avoid unnecessary invalidation
        const currentAngle = this.compassWidget.spriteAngle ?? 0;
        if (currentAngle !== spriteAngle) {
            this.compassWidget.spriteAngle = spriteAngle;
            // Mark compass widget as dirty for redraw
            this.invalidateWidgetRender(this.compassWidget, "compass");
        }
    }
}
