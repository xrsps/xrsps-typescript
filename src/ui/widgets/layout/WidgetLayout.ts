// Canonical IF1/IF3 widget layout routines shared between explorer and client.
// Minimally typed to avoid coupling with a specific VM; any object with these
// fields will work.

export type WidgetLike = {
    // raw (decoded) values
    rawX?: number;
    rawY?: number;
    rawWidth?: number;
    rawHeight?: number;
    // computed layout relative to parent (after alignment)
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    // IF3 alignment modes
    widthMode?: number;
    heightMode?: number;
    xPositionMode?: number;
    yPositionMode?: number;
    // structure
    // children can be null (not just undefined)
    children?: (WidgetLike | null)[] | null;
    // type info
    isIf3?: boolean;
    type?: number;
    // IF1 inventory grid specifics
    gridColumns?: number;
    gridRows?: number;
    gridXPitch?: number;
    gridYPitch?: number;
    // container scroll offsets (not used here, but present on nodes)
    scrollX?: number;
    scrollY?: number;
    // scrollable content dimensions (used for child layout, OSRS revalidateWidgetScroll parity)
    scrollWidth?: number;
    scrollHeight?: number;
};

export function alignSize(w: WidgetLike, parentW: number, parentH: number) {
    // width
    if (((w.widthMode ?? 0) | 0) === 0) {
        w.width = (w.rawWidth as number) | 0;
    } else if (((w.widthMode ?? 0) | 0) === 1) {
        // setsize_minus -> parent - raw
        w.width = (parentW | 0) - ((w.rawWidth as number) | 0);
    } else if (((w.widthMode ?? 0) | 0) === 2) {
        w.width = (((w.rawWidth as number) | 0) * (parentW | 0)) >> 14;
    } else if (((w.widthMode ?? 0) | 0) === 4) {
        // Aspect: derive width from current height
        const aw = Math.max(1, (w.rawWidth as number) | 0 || 1);
        const ah = Math.max(1, (w.rawHeight as number) | 0 || 1);
        const h = Math.max(1, (w.height as number) | 0 || 1);
        w.width = Math.max(1, Math.floor((aw * h) / ah));
    } else {
        w.width = (w.rawWidth as number) | 0;
    }
    // height
    if (((w.heightMode ?? 0) | 0) === 0) {
        w.height = (w.rawHeight as number) | 0;
    } else if (((w.heightMode ?? 0) | 0) === 1) {
        // setsize_minus -> parent - raw
        w.height = (parentH | 0) - ((w.rawHeight as number) | 0);
    } else if (((w.heightMode ?? 0) | 0) === 2) {
        w.height = (((w.rawHeight as number) | 0) * (parentH | 0)) >> 14;
    } else if (((w.heightMode ?? 0) | 0) === 4) {
        // Aspect: derive height from current width
        const aw = Math.max(1, (w.rawWidth as number) | 0 || 1);
        const ah = Math.max(1, (w.rawHeight as number) | 0 || 1);
        const wd = Math.max(1, (w.width as number) | 0 || 1);
        w.height = Math.max(1, Math.floor((wd * ah) / aw));
    } else {
        w.height = (w.rawHeight as number) | 0;
    }
}

export function alignPosition(w: WidgetLike, parentW: number, parentH: number) {
    // PARITY: Preserve the widget's original position modes from cache.
    // Interfaces like level up dialog (233) use xPosMode=1, yPosMode=1 to center
    // themselves within their container (e.g., chatbox MES_LAYER).
    const effectiveXMode = (w.xPositionMode ?? 0) | 0;
    const effectiveYMode = (w.yPositionMode ?? 0) | 0;

    // x
    if (effectiveXMode === 0) {
        w.x = (w.rawX as number) | 0;
    } else if (effectiveXMode === 1) {
        w.x = ((parentW - ((w.width as number) | 0)) >> 1) + ((w.rawX as number) | 0);
    } else if (effectiveXMode === 2) {
        w.x = (parentW - ((w.width as number) | 0 || 0) - ((w.rawX as number) | 0)) | 0;
    } else if (effectiveXMode === 3) {
        w.x = (((w.rawX as number) | 0) * (parentW | 0)) >> 14;
    } else if (effectiveXMode === 4) {
        w.x =
            ((parentW - ((w.width as number) | 0 || 0)) >> 1) +
            ((((w.rawX as number) | 0) * (parentW | 0)) >> 14);
    } else {
        // 5
        w.x =
            (parentW -
                ((w.width as number) | 0 || 0) -
                ((((w.rawX as number) | 0) * (parentW | 0)) >> 14)) |
            0;
    }
    // y
    if (effectiveYMode === 0) {
        w.y = (w.rawY as number) | 0;
    } else if (effectiveYMode === 1) {
        w.y = (((parentH - ((w.height as number) | 0 || 0)) >> 1) + ((w.rawY as number) | 0)) | 0;
    } else if (effectiveYMode === 2) {
        w.y = (parentH - ((w.height as number) | 0 || 0) - ((w.rawY as number) | 0)) | 0;
    } else if (effectiveYMode === 3) {
        w.y = (((w.rawY as number) | 0) * (parentH | 0)) >> 14;
    } else if (effectiveYMode === 4) {
        w.y =
            ((parentH - ((w.height as number) | 0 || 0)) >> 1) +
            ((((w.rawY as number) | 0) * (parentH | 0)) >> 14);
    } else {
        w.y =
            (parentH -
                ((w.height as number) | 0 || 0) -
                ((((w.rawY as number) | 0) * (parentH | 0)) >> 14)) |
            0;
    }
}

/**
 * PARITY: Perform layout on a SINGLE widget without recursing into children.
 * Used by ensureLayout() for JIT (lazy) layout validation.
 * Calculates size and position based on raw values and parent dimensions.
 */
export function layoutSingleWidget(w: WidgetLike, parentW: number, parentH: number): void {
    if (w == null) return;
    alignSize(w, parentW, parentH);
    // IF1 inventory grid: rawWidth/rawHeight are slot counts; override physical size
    if (!(w.isIf3 as boolean) && ((w.type ?? 0) | 0) === 2) {
        const cols = ((w.gridColumns as number) ?? (w.rawWidth as number) | 0) | 0;
        const rows = ((w.gridRows as number) ?? (w.rawHeight as number) | 0) | 0;
        const sw = 32 | 0;
        const sh = 32 | 0;
        const px =
            ((w.gridXPitch as number) && (w.gridXPitch as number) > 0
                ? (w.gridXPitch as number)
                : sw) | 0;
        const py =
            ((w.gridYPitch as number) && (w.gridYPitch as number) > 0
                ? (w.gridYPitch as number)
                : sh) | 0;
        w.width = Math.max(1, cols * px);
        w.height = Math.max(1, rows * py);
    }
    alignPosition(w, parentW, parentH);
}

/**
 * Align the full tree given a host size, with IF1 special-case for inventory grids.
 * @param root The root widget to layout
 * @param hostW Host/parent width
 * @param hostH Host/parent height
 * @param getStaticChildren Optional callback to get static children by parentUid (for )
 */
export function layoutWidgets(
    root: WidgetLike,
    hostW: number,
    hostH: number,
    getStaticChildren?: (parentUid: number) => WidgetLike[],
) {
    if (root == null) return;
    function visit(w: WidgetLike, pw: number, ph: number) {
        if (w == null) return;
        layoutSingleWidget(w, pw, ph);
        // Mark as valid after layout
        (w as any).isLayoutValid = true;

        const baseChildW = (w.width as number) | 0;
        const baseChildH = (w.height as number) | 0;
        // Children of scroll containers are aligned relative to the scroll area,
        // not just the visible viewport.
        const sw = ((w.scrollWidth as number) ?? 0) | 0;
        const sh = ((w.scrollHeight as number) ?? 0) | 0;
        const childW = sw !== 0 ? sw : baseChildW;
        const childH = sh !== 0 ? sh : baseChildH;

        // Layout static children (from parentUid filtering - )
        if (getStaticChildren && typeof (w as any).uid === "number") {
            const staticChildren = getStaticChildren((w as any).uid);
            for (const c of staticChildren) {
                if (c != null) visit(c, childW, childH);
            }
        }

        // Layout dynamic children (from CC_CREATE)
        if (Array.isArray(w.children)) {
            for (const c of w.children) {
                if (c != null) visit(c, childW, childH);
            }
        }
    }
    visit(root, hostW | 0, hostH | 0);
}
