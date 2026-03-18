/**
 * Clip bounds in canvas space (top-left origin, +Y down).
 * Used for OSRS-parity widget culling before rendering.
 */
export interface ClipRect {
    x0: number; // left
    y0: number; // top
    x1: number; // right (exclusive)
    y1: number; // bottom (exclusive)
}

/**
 * Check if a widget rect is completely outside the clip bounds.
 * If true, the widget should be skipped (culled) entirely.
 */
export function isFullyCulled(clip: ClipRect, x: number, y: number, w: number, h: number): boolean {
    // Widget bounds
    const wx1 = x + w;
    const wy1 = y + h;
    // No overlap means fully culled
    return x >= clip.x1 || wx1 <= clip.x0 || y >= clip.y1 || wy1 <= clip.y0;
}

/**
 * OSRS PARITY: Calculate widget clip bounds for Type 9 (Line) widgets.
 * Lines can have negative dimensions (drawn from right-to-left or bottom-to-top).
 * Reference: UserComparator5.java lines 142-162
 *
 * @param parentClip The parent's clip bounds
 * @param x Widget X position
 * @param y Widget Y position
 * @param w Widget width (can be negative for lines)
 * @param h Widget height (can be negative for lines)
 * @returns The calculated clip bounds for the widget
 */
export function calculateType9Clip(
    parentClip: ClipRect,
    x: number,
    y: number,
    w: number,
    h: number,
): ClipRect {
    // For Type 9 lines, OSRS calculates bounds differently to handle negative dimensions
    // Reference: UserComparator5.java lines 143-162
    let x0 = x;
    let y0 = y;
    let x1 = x + w;
    let y1 = y + h;

    // If end < start, swap them (line drawn in reverse direction)
    if (x1 < x0) {
        x0 = x1;
        x1 = x;
    }
    if (y1 < y0) {
        y0 = y1;
        y1 = y;
    }

    // OSRS adds 1 to the end bounds for lines (inclusive end)
    x1++;
    y1++;

    // Intersect with parent clip
    return {
        x0: Math.max(parentClip.x0, x0),
        y0: Math.max(parentClip.y0, y0),
        x1: Math.min(parentClip.x1, x1),
        y1: Math.min(parentClip.y1, y1),
    };
}

/**
 * PERF: In-place version of calculateType9Clip that writes to an existing object.
 * Use this in hot paths to avoid per-widget allocations.
 */
export function calculateType9ClipInPlace(
    parentClip: ClipRect,
    x: number,
    y: number,
    w: number,
    h: number,
    out: ClipRect,
): void {
    let x0 = x;
    let y0 = y;
    let x1 = x + w;
    let y1 = y + h;

    if (x1 < x0) {
        x0 = x1;
        x1 = x;
    }
    if (y1 < y0) {
        y0 = y1;
        y1 = y;
    }

    x1++;
    y1++;

    out.x0 = Math.max(parentClip.x0, x0);
    out.y0 = Math.max(parentClip.y0, y0);
    out.x1 = Math.min(parentClip.x1, x1);
    out.y1 = Math.min(parentClip.y1, y1);
}

/**
 * OSRS PARITY: Calculate widget clip bounds for standard widgets (non-Type 9).
 * Reference: UserComparator5.java lines 163-169
 *
 * @param parentClip The parent's clip bounds
 * @param x Widget X position
 * @param y Widget Y position
 * @param w Widget width
 * @param h Widget height
 * @returns The calculated clip bounds for the widget
 */
export function calculateStandardClip(
    parentClip: ClipRect,
    x: number,
    y: number,
    w: number,
    h: number,
): ClipRect {
    // Standard clip calculation: intersection of widget bounds with parent clip
    // Reference: UserComparator5.java lines 164-169
    // var15 = var12 > var2 ? var12 : var2;  (max of widget.x and parent.x0)
    // var16 = var13 > var3 ? var13 : var3;  (max of widget.y and parent.y0)
    // var17 = var19 < var4 ? var19 : var4;  (min of widget.x+w and parent.x1)
    // var18 = var20 < var5 ? var20 : var5;  (min of widget.y+h and parent.y1)
    return {
        x0: Math.max(parentClip.x0, x),
        y0: Math.max(parentClip.y0, y),
        x1: Math.min(parentClip.x1, x + w),
        y1: Math.min(parentClip.y1, y + h),
    };
}

/**
 * PERF: In-place version of calculateStandardClip that writes to an existing object.
 * Use this in hot paths to avoid per-widget allocations.
 */
export function calculateStandardClipInPlace(
    parentClip: ClipRect,
    x: number,
    y: number,
    w: number,
    h: number,
    out: ClipRect,
): void {
    out.x0 = Math.max(parentClip.x0, x);
    out.y0 = Math.max(parentClip.y0, y);
    out.x1 = Math.min(parentClip.x1, x + w);
    out.y1 = Math.min(parentClip.y1, y + h);
}

/**
 * Intersect two clip rects, returning the overlapping region.
 * This is used when recursing into children - the child's clip is the intersection
 * of parent clip and child's own bounds (for scroll containers).
 */
export function intersectClip(a: ClipRect, b: ClipRect): ClipRect {
    return {
        x0: Math.max(a.x0, b.x0),
        y0: Math.max(a.y0, b.y0),
        x1: Math.min(a.x1, b.x1),
        y1: Math.min(a.y1, b.y1),
    };
}

/**
 * Check if clip rect has positive area (is valid for rendering).
 */
export function isClipValid(clip: ClipRect): boolean {
    return clip.x1 > clip.x0 && clip.y1 > clip.y0;
}

export class ScissorStack {
    private gl: WebGL2RenderingContext;
    private viewportW: number;
    private viewportH: number;
    private beforeScissorChange?: () => void;
    // Stack stores GL scissor coords [x, y, w, h] in GL space (bottom-left origin)
    // PERF: Pre-allocated array, use stackTop to track depth instead of push/pop
    private stack: Array<[number, number, number, number]>;
    private stackTop: number = 0;
    // Also track canvas-space clip rects for culling checks
    // PERF: Pre-allocated array of reusable ClipRect objects
    private clipStack: ClipRect[];
    private clipStackTop: number = 0;
    // PERF: Initial capacity for stacks (resize if needed)
    private static readonly INITIAL_CAPACITY = 32;

    constructor(
        gl: WebGL2RenderingContext,
        viewportW: number,
        viewportH: number,
        beforeScissorChange?: () => void,
    ) {
        this.gl = gl;
        this.viewportW = viewportW | 0;
        this.viewportH = viewportH | 0;
        this.beforeScissorChange = beforeScissorChange;
        // Pre-allocate stack arrays
        this.stack = new Array(ScissorStack.INITIAL_CAPACITY);
        for (let i = 0; i < ScissorStack.INITIAL_CAPACITY; i++) {
            this.stack[i] = [0, 0, 0, 0];
        }
        this.clipStack = new Array(ScissorStack.INITIAL_CAPACITY);
        for (let i = 0; i < ScissorStack.INITIAL_CAPACITY; i++) {
            this.clipStack[i] = { x0: 0, y0: 0, x1: 0, y1: 0 };
        }
    }

    /**
     * PERF: Reinitialize for a new frame without allocating new arrays.
     * Call this instead of creating a new ScissorStack each frame.
     */
    reinit(
        gl: WebGL2RenderingContext,
        viewportW: number,
        viewportH: number,
        beforeScissorChange?: () => void,
    ): void {
        this.gl = gl;
        this.viewportW = viewportW | 0;
        this.viewportH = viewportH | 0;
        this.beforeScissorChange = beforeScissorChange;
        this.stackTop = 0;
        this.clipStackTop = 0;
    }

    private ensureCapacity(): void {
        if (this.stackTop >= this.stack.length) {
            const newCap = this.stack.length * 2;
            for (let i = this.stack.length; i < newCap; i++) {
                this.stack.push([0, 0, 0, 0]);
                this.clipStack.push({ x0: 0, y0: 0, x1: 0, y1: 0 });
            }
        }
    }

    /**
     * Get current clip bounds in canvas space for culling.
     * PERF: Returns reference to internal object - do not modify!
     */
    getCurrentClip(): ClipRect {
        if (this.clipStackTop > 0) {
            return this.clipStack[this.clipStackTop - 1];
        }
        // Return a temporary object for the full viewport case
        // This is unavoidable but only happens when stack is empty
        return { x0: 0, y0: 0, x1: this.viewportW, y1: this.viewportH };
    }

    /**
     * Push a clip rect in canvas space (top-left origin, +Y down).
     * The new clip is intersected with the current clip.
     */
    pushCanvasRect(x: number, y: number, w: number, h: number) {
        this.ensureCapacity();

        // Get previous clip bounds
        let prevX0: number, prevY0: number, prevX1: number, prevY1: number;
        if (this.clipStackTop > 0) {
            const prev = this.clipStack[this.clipStackTop - 1];
            prevX0 = prev.x0;
            prevY0 = prev.y0;
            prevX1 = prev.x1;
            prevY1 = prev.y1;
        } else {
            prevX0 = 0;
            prevY0 = 0;
            prevX1 = this.viewportW;
            prevY1 = this.viewportH;
        }

        // Canvas-space bounds of the new rect, intersected with previous
        const newX0 = Math.floor(x);
        const newY0 = Math.floor(y);
        const newX1 = Math.floor(x + w);
        const newY1 = Math.floor(y + h);

        // PERF: Update existing object in-place instead of creating new one
        const clipped = this.clipStack[this.clipStackTop];
        clipped.x0 = Math.max(prevX0, newX0);
        clipped.y0 = Math.max(prevY0, newY0);
        clipped.x1 = Math.min(prevX1, newX1);
        clipped.y1 = Math.min(prevY1, newY1);
        this.clipStackTop++;

        // Convert to GL scissor coords (bottom-left origin, +Y up)
        const glX = Math.max(0, clipped.x0);
        const glY = Math.max(0, this.viewportH - clipped.y1);
        const glW = Math.max(0, clipped.x1 - clipped.x0);
        const glH = Math.max(0, clipped.y1 - clipped.y0);

        // PERF: Update existing tuple in-place
        const entry = this.stack[this.stackTop];
        entry[0] = glX;
        entry[1] = glY;
        entry[2] = glW;
        entry[3] = glH;
        this.stackTop++;
        this.beforeScissorChange?.();
        this.gl.scissor(glX, glY, glW, glH);
    }

    pop() {
        if (this.stackTop > 0) this.stackTop--;
        if (this.clipStackTop > 0) this.clipStackTop--;
        if (this.stackTop > 0) {
            const entry = this.stack[this.stackTop - 1];
            this.beforeScissorChange?.();
            this.gl.scissor(entry[0], entry[1], entry[2], entry[3]);
        } else {
            this.beforeScissorChange?.();
            this.gl.scissor(0, 0, this.viewportW, this.viewportH);
        }
    }

    /**
     * OSRS PARITY: Expand (tighten) the current clip bounds.
     * Reference: Rasterizer2D.Rasterizer2D_expandClip in Java client.
     *
     * In OSRS, expandClip modifies clip globals in-place and setClip is used to restore.
     * Our implementation uses a stack for easier state management - push the expanded
     * clip, then pop() to restore. This achieves identical behavior.
     *
     * Used for sprite tiling where we need to temporarily constrain drawing to a
     * widget's bounds. Reference: UserComparator5.java lines 391-407.
     *
     * Call pop() when done to restore the previous clip.
     *
     * @param x0 Left bound (canvas space)
     * @param y0 Top bound (canvas space)
     * @param x1 Right bound (canvas space, exclusive)
     * @param y1 Bottom bound (canvas space, exclusive)
     */
    expandClip(x0: number, y0: number, x1: number, y1: number) {
        this.ensureCapacity();

        // Get previous clip bounds
        let prevX0: number, prevY0: number, prevX1: number, prevY1: number;
        if (this.clipStackTop > 0) {
            const prev = this.clipStack[this.clipStackTop - 1];
            prevX0 = prev.x0;
            prevY0 = prev.y0;
            prevX1 = prev.x1;
            prevY1 = prev.y1;
        } else {
            prevX0 = 0;
            prevY0 = 0;
            prevX1 = this.viewportW;
            prevY1 = this.viewportH;
        }

        // PERF: Update existing object in-place instead of creating new one
        const expandedClip = this.clipStack[this.clipStackTop];
        expandedClip.x0 = Math.max(prevX0, Math.floor(x0));
        expandedClip.y0 = Math.max(prevY0, Math.floor(y0));
        expandedClip.x1 = Math.min(prevX1, Math.floor(x1));
        expandedClip.y1 = Math.min(prevY1, Math.floor(y1));
        this.clipStackTop++;

        // Convert to GL scissor coords (bottom-left origin, +Y up)
        const glX = Math.max(0, expandedClip.x0);
        const glY = Math.max(0, this.viewportH - expandedClip.y1);
        const glW = Math.max(0, expandedClip.x1 - expandedClip.x0);
        const glH = Math.max(0, expandedClip.y1 - expandedClip.y0);

        // PERF: Update existing tuple in-place
        const entry = this.stack[this.stackTop];
        entry[0] = glX;
        entry[1] = glY;
        entry[2] = glW;
        entry[3] = glH;
        this.stackTop++;
        this.beforeScissorChange?.();
        this.gl.scissor(glX, glY, glW, glH);
    }

    /**
     * Reset the scissor stack (call at start of frame).
     * PERF: Just resets indices, doesn't deallocate arrays.
     */
    reset() {
        this.stackTop = 0;
        this.clipStackTop = 0;
        this.beforeScissorChange?.();
        this.gl.scissor(0, 0, this.viewportW, this.viewportH);
    }
}
