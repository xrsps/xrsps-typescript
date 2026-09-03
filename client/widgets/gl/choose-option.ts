import { ClickMode } from "../../game/InputManager";
import { BitmapFont } from "../../rs/font/BitmapFont";
import { getClientCycle } from "../../network/ServerConnection";
import { getUiScale } from "../../ui/UiScale";
import { FONT_BOLD_12 } from "../../ui/fonts";
import type { MenuClickContext } from "../../ui/menu/MenuEngine";
import { MenuState } from "../../ui/menu/MenuState";
import { drawTextGL as UI_drawTextGL } from "../../widgets/components/TextRenderer";
import { GLRenderer } from "./renderer";

type FontLoader = (id: number) => BitmapFont | undefined;

export type ChooseOptionMenuEntry = {
    option: string;
    target?: string;
    subEntries?: ChooseOptionMenuEntry[];
};

export type ChooseOptionMenuLike = {
    open?: boolean;
    x: number;
    y: number;
    entries: ChooseOptionMenuEntry[];
};

type MenuEntryLike = {
    option: string;
    target?: string;
    onClick?: (x?: number, y?: number, ctx?: MenuClickContext) => void;
    menuStateIndex?: number;
    subEntries?: MenuEntryLike[];
};

type MenuRect = { x: number; y: number; w: number; h: number };

/**
 * Per-open runtime state for the Choose Option menu (scroll offsets and submenu
 * hover/open tracking). Stored on `ui.__menuRt`; recreated whenever a menu opens
 * at a new anchor. Rect fields are in scaled canvas pixels and refreshed each draw
 * so out-of-frame consumers (mouse wheel handling) can hit-test against them.
 */
export type ChooseOptionMenuRuntime = {
    key: string;
    menuScroll: number;
    menuScrollMax: number;
    submenuScroll: number;
    submenuScrollMax: number;
    openSubMenuIndex: number;
    pendingSubMenuIndex: number;
    subMenuOpenCycle: number;
    lastMouseX: number;
    lastMouseY: number;
    mainRect?: MenuRect;
    subRect?: MenuRect;
    /** Scaled hover/close margin in canvas pixels (MENU_CLOSE_MARGIN_PX * uiScale). */
    closeMargin: number;
};

// PERF: Module-level canvas for text measurement (avoid creating per frame)
let _measCanvas: HTMLCanvasElement | null = null;
let _measCtx: CanvasRenderingContext2D | null = null;
function getMeasureContext(): CanvasRenderingContext2D {
    if (!_measCanvas) {
        _measCanvas = document.createElement("canvas");
        _measCtx = _measCanvas.getContext("2d");
        if (_measCtx) _measCtx.font = "12px sans-serif";
    }
    return _measCtx!;
}

// PERF: String measurement cache
const _measureCache = new Map<string, number>();
const MEASURE_CACHE_MAX = 256;

// === OSRS "Choose Option" menu layout constants (Client.openMenu/menu/drawLoggedIn parity) ===
const MENU_WIDTH_PADDING_PX = 8; // menuWidth = max(text) + 8
const MENU_ROW_HEIGHT_PX = 15; // per-option row height
const MENU_HEIGHT_BASE_PX = 22; // menuHeight = (rows * 15) + 22

// Client.menu(): close menu when mouse leaves rect with +/- 10px margin.
const MENU_CLOSE_MARGIN_PX = 10;

// Header / outline offsets (Client.drawLoggedIn)
const MENU_TITLE_BG_INSET_PX = 1;
const MENU_TITLE_BG_HEIGHT_PX = 16;
const MENU_OPTIONS_OUTLINE_Y_OFFSET_PX = 18;
const MENU_OPTIONS_OUTLINE_HEIGHT_SUB_PX = 19;
const MENU_TITLE_TEXT_X_OFFSET_PX = 3;
const MENU_TITLE_TEXT_BASELINE_OFFSET_PX = 14;
const MENU_TEXT_X_OFFSET_PX = 3;
const MENU_TEXT_WIDTH_PADDING_PX = 6;

// Entry layout (Client.drawLoggedIn menu entry positions)
const MENU_FIRST_ROW_BASELINE_OFFSET_PX = 31;
const MENU_ROW_HIT_TOP_OFFSET_PX = 13;
const MENU_ROW_HIT_BOTTOM_OFFSET_PX = 3;
const MENU_HIT_TEST_INSET_PX = 1; // emulate strict comparisons via 1px inset

// Oversized menus scroll by rows: scrollMax = (menuHeight - canvasHeight + 14) / 15.
const MENU_SCROLL_HEIGHT_PAD_PX = 14;

// Submenu hover-open delays in client cycles (20ms): re-checked while another
// submenu is open. A stationary pointer waits longer than a moving one.
const SUBMENU_OPEN_DELAY_STATIONARY_CYCLES = 8;
const SUBMENU_OPEN_DELAY_MOVING_CYCLES = 2;

// Entries with a submenu render a trailing arrow; measured as " <gt>" (one '>' glyph).
const SUBMENU_ARROW_MEASURE_SUFFIX = " <gt>";
const SUBMENU_ARROW_DRAW_SUFFIX = " </col><gt>";

// Click target priorities (menu must consume clicks over widgets)
const MENU_BG_PRIORITY = 999;
const MENU_OPTION_PRIORITY_BASE = 1000;
const FONT_TITLE = FONT_BOLD_12;
const FONT_OPT = FONT_BOLD_12;

function stripTagsForMeasure(s: string): string {
    if (!s) return "";
    // <gt>/<lt> are glyph escapes, not formatting tags - they contribute width.
    return String(s)
        .replace(/<gt>/gi, ">")
        .replace(/<lt>/gi, "<")
        .replace(/<[^>]*>/g, "");
}

function measureMenuText(fontLoader: FontLoader, s: string, fontId: number): number {
    const cacheKey = `${fontId}:${s}`;
    const cached = _measureCache.get(cacheKey);
    if (cached !== undefined) return cached;

    const measCtx = getMeasureContext();
    const plain = stripTagsForMeasure(s);
    let result: number;
    try {
        const font = fontLoader(fontId);
        const m = (font as any)?.measure?.(plain);
        if (typeof m === "number") {
            result = (m | 0) as number;
        } else {
            result = Math.ceil(measCtx.measureText(plain).width) | 0;
        }
    } catch {
        result = Math.ceil(measCtx.measureText(plain).width) | 0;
    }

    if (_measureCache.size >= MEASURE_CACHE_MAX) {
        const firstKey = _measureCache.keys().next().value;
        if (firstKey !== undefined) _measureCache.delete(firstKey);
    }
    _measureCache.set(cacheKey, result);
    return result;
}

function getCanvasInputScale(canvas: HTMLCanvasElement): { x: number; y: number } {
    const canvasAny = canvas as any;
    const scaleXRaw = Number(canvasAny?.__uiInputScaleX ?? 1);
    const scaleYRaw = Number(canvasAny?.__uiInputScaleY ?? 1);
    return {
        x: Number.isFinite(scaleXRaw) && scaleXRaw > 0 ? scaleXRaw : 1,
        y: Number.isFinite(scaleYRaw) && scaleYRaw > 0 ? scaleYRaw : 1,
    };
}

function scaleInputPoint(
    canvas: HTMLCanvasElement,
    x: number,
    y: number,
): { x: number; y: number } {
    const scale = getCanvasInputScale(canvas);
    return {
        x: Math.round(x * scale.x),
        y: Math.round(y * scale.y),
    };
}

function getMenuAnchorPoint(
    canvas: HTMLCanvasElement,
    menu: ChooseOptionMenuLike | undefined,
): { x: number; y: number } {
    const source = (menu as any)?.source;
    if (source === "widgets") {
        return {
            x: (menu?.x ?? 0) | 0,
            y: (menu?.y ?? 0) | 0,
        };
    }
    return scaleInputPoint(canvas, (menu?.x ?? 0) | 0, (menu?.y ?? 0) | 0);
}

/** Scale a logical pixel constant by the UI scale factor, rounding to at least 1. */
function sp(logicalPx: number, scale: number): number {
    return Math.max(1, Math.round(logicalPx * scale));
}

function entryFullText(e: { option?: string; target?: string }): string {
    const option = e.option || "";
    const target = e.target || "";
    if (!target.length) return option;
    return option.length ? `${option} ${target}` : target;
}

function hasSubEntries(e: MenuEntryLike | ChooseOptionMenuEntry | undefined): boolean {
    return !!(e && Array.isArray((e as any).subEntries) && (e as any).subEntries.length > 0);
}

/**
 * Menu.computeDimensions: width fits the widest of the header text and all
 * entry rows (entries with a submenu include the trailing arrow); height is
 * rows * 15 + 22 (4px padding + 18px header).
 */
function computeMenuSize(
    fontLoader: FontLoader,
    headerText: string,
    entries: Array<{ option?: string; target?: string; subEntries?: unknown[] }>,
    uiScale: number,
): { w: number; h: number } {
    let contentW = measureMenuText(fontLoader, headerText, FONT_TITLE);
    for (const e of entries) {
        let full = entryFullText(e as any);
        if (hasSubEntries(e as any)) full += SUBMENU_ARROW_MEASURE_SUFFIX;
        const w = measureMenuText(fontLoader, full, FONT_OPT);
        if (w > contentW) contentW = w;
    }
    const w = (sp(contentW, uiScale) + sp(MENU_WIDTH_PADDING_PX, uiScale)) | 0;
    const h = (entries.length * sp(MENU_ROW_HEIGHT_PX, uiScale) +
        sp(MENU_HEIGHT_BASE_PX, uiScale)) | 0;
    return { w, h };
}

export function getChooseOptionMenuRect(
    fontLoader: FontLoader,
    menu: ChooseOptionMenuLike | undefined,
    hostW: number,
    hostH: number,
    uiScale: number = 1,
): MenuRect | undefined {
    if (!(menu && menu.open && Array.isArray(menu.entries) && menu.entries.length > 0)) {
        return undefined;
    }

    const s = uiScale > 0 ? uiScale : 1;
    const size = computeMenuSize(fontLoader, "Choose Option", menu.entries, s);

    let left = ((menu.x | 0) - ((size.w / 2) | 0)) | 0;
    if (left + size.w > (hostW | 0)) left = (hostW | 0) - size.w;
    if (left < 0) left = 0;
    let top = menu.y | 0;
    if (top + size.h > (hostH | 0)) top = (hostH | 0) - size.h;
    if (top < 0) top = 0;

    return { x: left, y: top, w: size.w, h: size.h };
}

/**
 * Menu.positionRelativeToInternal: the submenu opens to the right of its parent,
 * flips to the left edge when it would overflow the canvas, and is vertically
 * anchored to the parent entry's row slot (offset by the parent's scroll).
 */
function computeSubMenuRect(
    fontLoader: FontLoader,
    parentRect: MenuRect,
    parentEntry: MenuEntryLike,
    openIndex: number,
    menuScroll: number,
    hostW: number,
    hostH: number,
    uiScale: number,
): MenuRect {
    const subEntries = parentEntry.subEntries || [];
    const size = computeMenuSize(fontLoader, parentEntry.target || "", subEntries, uiScale);

    let x = parentRect.x + parentRect.w;
    if (x + size.w > (hostW | 0)) {
        x = parentRect.x - size.w;
    }
    if (x < 0) x = 0;

    let y = (openIndex - menuScroll) * sp(MENU_ROW_HEIGHT_PX, uiScale) + parentRect.y;
    if (y + size.h > (hostH | 0)) y = (hostH | 0) - size.h;
    if (y < 0) y = 0;

    return { x, y, w: size.w, h: size.h };
}

/** Client.openMenu: scrollMax = (menuHeight - canvasHeight + 14) / 15 when oversized. */
function computeMenuScrollMax(menuHeightPx: number, hostH: number, uiScale: number): number {
    if (menuHeightPx <= (hostH | 0)) return 0;
    return Math.floor(
        (menuHeightPx - (hostH | 0) + sp(MENU_SCROLL_HEIGHT_PAD_PX, uiScale)) /
            sp(MENU_ROW_HEIGHT_PX, uiScale),
    );
}

function isPointInRect(rect: MenuRect | undefined, x: number, y: number, margin: number): boolean {
    if (!rect) return false;
    return (
        x >= rect.x - margin &&
        x <= rect.x + rect.w + margin &&
        y >= rect.y - margin &&
        y <= rect.y + rect.h + margin
    );
}

/**
 * Menu.getEntryIndexAt: scroll-aware row hit test. Rows are scanned bottom-up so
 * the visible row wins where a scrolled-out row's band overlaps the header area.
 */
function getEntryIndexAt(
    rect: MenuRect,
    entryCount: number,
    scroll: number,
    mx: number,
    my: number,
    uiScale: number,
): number {
    const sRowH = sp(MENU_ROW_HEIGHT_PX, uiScale);
    const sFirstRowBase = sp(MENU_FIRST_ROW_BASELINE_OFFSET_PX, uiScale);
    const sHitTop = sp(MENU_ROW_HIT_TOP_OFFSET_PX, uiScale);
    const sHitBot = sp(MENU_ROW_HIT_BOTTOM_OFFSET_PX, uiScale);
    for (let i = entryCount - 1; i >= 0; i--) {
        const baselineY = rect.y + sFirstRowBase + (i - scroll) * sRowH;
        if (
            mx > rect.x &&
            mx < rect.x + rect.w &&
            my > baselineY - sHitTop &&
            my < baselineY + sHitBot
        ) {
            return i;
        }
    }
    return -1;
}

/** Menu.slope helper for the moving-toward-submenu test. */
function menuSlope(x0: number, y0: number, x1: number, y1: number): number {
    return (y0 - y1) / (x1 - x0);
}

/**
 * Menu.isMovingTowardSubMenu: the pointer is heading into the open submenu when
 * its trajectory (versus last frame) stays within the triangle spanned by the
 * pointer and the submenu's near edge.
 */
function isMovingTowardSubMenu(
    rt: ChooseOptionMenuRuntime,
    mainRect: MenuRect,
    mx: number,
    my: number,
): boolean {
    if (rt.openSubMenuIndex === -1) return false;
    const sub = rt.subRect;
    if (!sub) return false;
    if (sub.x > mainRect.x) {
        const edgeX = sub.x;
        const a = menuSlope(mx, my, edgeX, sub.y);
        const b = menuSlope(rt.lastMouseX, rt.lastMouseY, edgeX, sub.y);
        const c = menuSlope(mx, my, edgeX, sub.y + sub.h);
        const d = menuSlope(rt.lastMouseX, rt.lastMouseY, edgeX, sub.y + sub.h);
        return (a >= b && c < d) || (a > b && c <= d);
    }
    const edgeX = mainRect.x;
    const a = menuSlope(mx, my, edgeX, sub.y);
    const b = menuSlope(rt.lastMouseX, rt.lastMouseY, edgeX, sub.y);
    const c = menuSlope(mx, my, edgeX, sub.y + sub.h);
    const d = menuSlope(rt.lastMouseX, rt.lastMouseY, edgeX, sub.y + sub.h);
    return (a <= b && c > d) || (a < b && c >= d);
}

function closeSubMenu(rt: ChooseOptionMenuRuntime): void {
    rt.openSubMenuIndex = -1;
    rt.subRect = undefined;
}

function createMenuRuntime(key: string): ChooseOptionMenuRuntime {
    return {
        key,
        menuScroll: 0,
        menuScrollMax: 0,
        submenuScroll: 0,
        submenuScrollMax: 0,
        openSubMenuIndex: -1,
        pendingSubMenuIndex: -1,
        subMenuOpenCycle: -1,
        lastMouseX: -1,
        lastMouseY: -1,
        closeMargin: MENU_CLOSE_MARGIN_PX,
    };
}

/**
 * Menu.isMouseOverMenuInternal: tracks hover, opens/closes submenus with the
 * cycle delays and moving-toward-submenu deferral, and reports whether the
 * pointer is still over the menu (incl. the open submenu) within the margin.
 */
function updateMenuHover(
    rt: ChooseOptionMenuRuntime,
    entries: MenuEntryLike[],
    mainRect: MenuRect,
    mx: number,
    my: number,
    hostH: number,
    uiScale: number,
): boolean {
    const margin = rt.closeMargin;
    let over: boolean;
    if (
        rt.openSubMenuIndex !== -1 &&
        rt.subRect &&
        isPointInRect(rt.subRect, mx, my, margin)
    ) {
        over = true;
    } else if (isPointInRect(mainRect, mx, my, margin)) {
        const idx = getEntryIndexAt(mainRect, entries.length, rt.menuScroll, mx, my, uiScale);
        if (idx !== -1 && idx !== rt.openSubMenuIndex) {
            const now = getClientCycle();
            let pending = idx;
            let deadline = Math.max(now, rt.subMenuOpenCycle);
            if (rt.openSubMenuIndex !== -1) {
                if (isMovingTowardSubMenu(rt, mainRect, mx, my)) {
                    pending = -1;
                    deadline = Number.MAX_SAFE_INTEGER;
                } else if (rt.pendingSubMenuIndex === -1) {
                    deadline =
                        now +
                        (rt.lastMouseX === mx && rt.lastMouseY === my
                            ? SUBMENU_OPEN_DELAY_STATIONARY_CYCLES
                            : SUBMENU_OPEN_DELAY_MOVING_CYCLES);
                }
            }
            rt.pendingSubMenuIndex = pending;
            rt.subMenuOpenCycle = deadline;
            if (rt.subMenuOpenCycle <= now) {
                rt.pendingSubMenuIndex = -1;
                closeSubMenu(rt);
                const entry = entries[idx];
                if (hasSubEntries(entry)) {
                    rt.openSubMenuIndex = idx;
                    rt.submenuScroll = 0;
                    rt.submenuScrollMax = 0;
                    // Sub rect is recomputed by the draw pass; the scroll bound only
                    // needs the submenu height.
                    const subH =
                        (entry.subEntries!.length * sp(MENU_ROW_HEIGHT_PX, uiScale) +
                            sp(MENU_HEIGHT_BASE_PX, uiScale)) |
                        0;
                    rt.submenuScrollMax = computeMenuScrollMax(subH, hostH, uiScale);
                }
            }
        }
        over = true;
    } else {
        over = false;
    }
    rt.lastMouseX = mx;
    rt.lastMouseY = my;
    return over;
}

export function drawChooseOptionMenu(
    glr: GLRenderer,
    opts: {
        fontLoader: FontLoader;
        requestRender: () => void;
        onExamine?: (target?: any) => void;
        menuState?: MenuState;
    },
) {
    const canvas = glr.canvas as HTMLCanvasElement & { __ui?: any; __clicks?: any };
    const ui = (canvas.__ui = canvas.__ui || {});
    const clicks = canvas.__clicks;
    const menu = ui.menu as
        | {
              open?: boolean;
              x: number;
              y: number;
              entries: MenuEntryLike[];
              targetWidget?: any;
              // When true, this is a non-interactive, always-follow cursor overlay
              // and should not auto-cancel or register click targets.
              follow?: boolean;
              menuState?: MenuState;
              onEntryInvoke?: (entry: MenuEntryLike) => void;
          }
        | undefined;
    // Cleanup any previously registered menu click targets when the menu is closed.
    // We register menu targets as persistent so they are available for input processing even
    // when the menu is drawn after input; therefore we must explicitly unregister on close.
    const prevCount = (ui.__menuTargetCount | 0) as number;
    const prevSubCount = (ui.__menuSubTargetCount | 0) as number;
    const unregisterMenuTargets = (count: number, subCount: number) => {
        if ((count > 0 || subCount > 0) && clicks?.unregister) {
            try {
                clicks.unregister("__menu_bg");
            } catch {}
            for (let i = 0; i < count; i++) {
                try {
                    clicks.unregister(`__menu_opt_${i}`);
                } catch {}
            }
            for (let i = 0; i < subCount; i++) {
                try {
                    clicks.unregister(`__menu_sub_${i}`);
                } catch {}
            }
        }
        ui.__menuTargetCount = 0;
        ui.__menuSubTargetCount = 0;
    };
    if (!(menu && menu.open && Array.isArray(menu.entries) && menu.entries.length > 0)) {
        unregisterMenuTargets(prevCount, prevSubCount);
        ui.__menuRt = undefined;
        return;
    }

    const globalClient: any =
        (canvas as any).__osrsClient ||
        (ui as any).__osrsClient ||
        (typeof globalThis !== "undefined" ? (globalThis as any).__osrsClient : undefined);

    let menuCleanupDone = false;
    // Helper that aggressively closes any open menu (world or widget) and asks for a redraw.
    const closeAllMenus = () => {
        if (menuCleanupDone) return;
        menuCleanupDone = true;
        ui.__menuRt = undefined;
        try {
            clicks?.cancelActiveClick?.();
            (canvas as any).__inputBridge?.consumeClick?.();
        } catch {}
        try {
            if (ui.menu) ui.menu.open = false;
            ui.menu = undefined;
        } catch {}
        try {
            if (typeof (menu as any)?.closeWorldMenu === "function") (menu as any).closeWorldMenu();
            else if (typeof (ui as any)?.closeWorldMenu === "function")
                (ui as any).closeWorldMenu();
            else if (typeof globalClient?.closeMenu === "function") globalClient.closeMenu();
        } catch {}
        // Hard stop: if we have direct access to the client, clear menu tracking flags too.
        try {
            if (globalClient) {
                globalClient.menuOpen = false;
                globalClient.menuJustClosed = true; // Skip input processing for one frame
                globalClient.menuPinnedEntries = undefined;
                globalClient.menuPinnedEntriesVersion =
                    (globalClient.menuPinnedEntriesVersion | 0) + 1;
                globalClient.menuFrozenSimpleEntries = undefined;
                globalClient.menuFrozenSimpleEntriesVersion = 0;
                globalClient.menuActiveSimpleEntries = [];
                globalClient.menuState?.reset?.();
                // Consume the click so it doesn't pass through to the world behind the menu
                if (globalClient.inputManager) {
                    globalClient.inputManager.clickMode1 = 0; // ClickMode.NONE
                    globalClient.inputManager.clickMode2 = 0; // ClickMode.NONE - clear held state to prevent drag
                    globalClient.inputManager.clickMode3 = 0; // ClickMode.NONE
                    globalClient.inputManager.clickX = -1;
                    globalClient.inputManager.clickY = -1;
                    globalClient.inputManager.saveClickX = -1;
                    globalClient.inputManager.saveClickY = -1;
                }
                // Also clear any pending widget click state to prevent release handlers from firing
                globalClient.clickedWidget = null;
                globalClient.clickedWidgetParent = null;
                globalClient.clickedWidgetHandled = false;
                globalClient.deferredWidgetAction = null;
                // Clear drag state to prevent drag actions from continuing after menu closes
                globalClient.isDraggingWidget = false;
                globalClient.widgetDragDuration = 0;
                globalClient.dragClickX = 0;
                globalClient.dragClickY = 0;
            }
        } catch {}
        unregisterMenuTargets(ui.__menuTargetCount | 0, ui.__menuSubTargetCount | 0);
        opts.requestRender();
    };

    // Colors (menu fill color 0x5D5447,
    // title bg black, hover yellow, default white, option shadow black)
    const COL_MENU_BG: [number, number, number, number] = [0x5d / 255, 0x54 / 255, 0x47 / 255, 1];
    const COL_BLACK: [number, number, number, number] = [0, 0, 0, 1];
    const COL_TITLE_TEXT = 0x5d5447;
    const COL_TEXT_DEFAULT = 0xffffff;
    const COL_TEXT_HOVER = 0xffff00;

    const cssW = canvas?.clientWidth || canvas?.offsetWidth || 0;
    const cssH = canvas?.clientHeight || canvas?.offsetHeight || 0;
    // Use renderScaleX propagated from the main renderer (same source as overhead text/hitsplats).
    // Falls back to integer getUiScale if not yet set (e.g. first frame before onResize fires).
    const renderScale = (canvas as any)?.__uiRenderScale;
    const s =
        typeof renderScale === "number" && renderScale > 0 ? renderScale : getUiScale(cssW, cssH);
    const hostW = glr.width | 0;
    const hostH = glr.height | 0;
    const anchor = getMenuAnchorPoint(canvas, menu);
    const menuRect = getChooseOptionMenuRect(
        opts.fontLoader,
        {
            ...menu,
            x: anchor.x,
            y: anchor.y,
        },
        hostW,
        hostH,
        s,
    );
    if (!menuRect) {
        unregisterMenuTargets(prevCount, prevSubCount);
        ui.__menuRt = undefined;
        return;
    }
    const left = menuRect.x | 0;
    const top = menuRect.y | 0;
    const boxW = menuRect.w | 0;
    const boxH = menuRect.h | 0;

    // Per-open runtime state. World-menu population recreates the menu object every
    // frame at the same anchor, so the runtime is keyed by source+anchor instead of
    // object identity and survives until the menu closes or reopens elsewhere.
    const rtKey = `${(menu as any).source ?? "ui"}|${menu.x | 0}|${menu.y | 0}`;
    let rt = ui.__menuRt as ChooseOptionMenuRuntime | undefined;
    if (!rt || rt.key !== rtKey) {
        rt = createMenuRuntime(rtKey);
        rt.menuScrollMax = computeMenuScrollMax(boxH, hostH, s);
        ui.__menuRt = rt;
    }
    rt.closeMargin = sp(MENU_CLOSE_MARGIN_PX, s);
    rt.mainRect = menuRect;

    // Drop submenu state if the entry no longer has one (entries can be repopulated),
    // then refresh the submenu rect (Menu.positionRelativeTo runs on open and reopen).
    const refreshSubMenu = (): MenuEntryLike | undefined => {
        if (rt!.openSubMenuIndex !== -1 && !hasSubEntries(menu.entries[rt!.openSubMenuIndex])) {
            // Entries were repopulated without this submenu; also reset the hover
            // deadline so a deferred (moving-toward) state can't pin it forever.
            closeSubMenu(rt!);
            rt!.pendingSubMenuIndex = -1;
            rt!.subMenuOpenCycle = -1;
        }
        const entry =
            rt!.openSubMenuIndex !== -1 ? menu.entries[rt!.openSubMenuIndex] : undefined;
        if (entry) {
            rt!.subRect = computeSubMenuRect(
                opts.fontLoader,
                menuRect,
                entry,
                rt!.openSubMenuIndex,
                rt!.menuScroll,
                hostW,
                hostH,
                s,
            );
        }
        return entry;
    };
    let openSubEntry = refreshSubMenu();

    // menu auto-closes when the mouse moves outside the menu rect with a margin.
    // Also: selecting an option happens on mousedown (lastPressedX/Y), not mouseup.
    if (!menu.follow && globalClient?.inputManager) {
        const inputManager: any = globalClient.inputManager;
        const lastButton = (inputManager.clickMode3 | 0) as number;
        const mousePoint = scaleInputPoint(
            canvas,
            (inputManager.mouseX | 0) as number,
            (inputManager.mouseY | 0) as number,
        );
        const mx = mousePoint.x | 0;
        const my = mousePoint.y | 0;

        // Consume right-click while menu is open (OSRS: right-click does nothing when menu is open).
        if (lastButton === ClickMode.RIGHT) {
            try {
                inputManager.clickMode3 = ClickMode.NONE;
                inputManager.saveClickX = -1;
                inputManager.saveClickY = -1;
            } catch {}
        }

        // Hover tracking + submenu open/close; close menu when moving off it
        // (no selection click this frame).
        if (lastButton !== ClickMode.LEFT) {
            const over = updateMenuHover(rt, menu.entries, menuRect, mx, my, hostH, s);
            // Hover may have opened or switched the submenu this frame.
            openSubEntry = refreshSubMenu();
            if (!over) {
                // If a right-click happened this frame, also consume it so it doesn't open a new menu.
                if (lastButton === ClickMode.RIGHT) {
                    try {
                        inputManager.clickMode3 = ClickMode.NONE;
                        inputManager.saveClickX = -1;
                        inputManager.saveClickY = -1;
                    } catch {}
                }
                try {
                    if (ui.menu) ui.menu.open = false;
                    ui.menu = undefined;
                } catch {}
                ui.__menuRt = undefined;
                try {
                    if (typeof (menu as any)?.closeWorldMenu === "function")
                        (menu as any).closeWorldMenu();
                    else if (typeof (ui as any)?.closeWorldMenu === "function")
                        (ui as any).closeWorldMenu();
                    else if (typeof globalClient?.closeMenu === "function")
                        globalClient.closeMenu();
                } catch {}
                unregisterMenuTargets(ui.__menuTargetCount | 0, ui.__menuSubTargetCount | 0);
                opts.requestRender();
                return;
            }
        }

        // Select/close on mousedown (OSRS: lastPressedX/Y). The open submenu is
        // hit-tested before the parent menu (Menu.handleClickAtInternal).
        if (lastButton === ClickMode.LEFT) {
            const pressPoint = scaleInputPoint(
                canvas,
                (inputManager.saveClickX | 0) as number,
                (inputManager.saveClickY | 0) as number,
            );
            const pressX = pressPoint.x | 0;
            const pressY = pressPoint.y | 0;

            let picked: MenuEntryLike | undefined;
            if (openSubEntry && rt.subRect) {
                const subIdx = getEntryIndexAt(
                    rt.subRect,
                    openSubEntry.subEntries!.length,
                    rt.submenuScroll,
                    pressX,
                    pressY,
                    s,
                );
                if (subIdx !== -1) picked = openSubEntry.subEntries![subIdx];
            }
            if (!picked) {
                const mainIdx = getEntryIndexAt(
                    menuRect,
                    menu.entries.length,
                    rt.menuScroll,
                    pressX,
                    pressY,
                    s,
                );
                if (mainIdx !== -1) picked = menu.entries[mainIdx];
            }

            if (picked) {
                const e = picked;
                try {
                    menu.onEntryInvoke?.(e);
                } catch {}
                try {
                    const idx = e.menuStateIndex;
                    const state = menu.menuState ?? opts.menuState;
                    const ctx = {
                        source: "menu" as const,
                        closeMenu: closeAllMenus,
                    };
                    const isWalk = e.option === "Walk here";
                    if (isWalk && typeof e.onClick === "function") {
                        e.onClick(pressX, pressY, ctx);
                    } else if (typeof idx === "number" && state) {
                        state.invoke(idx, pressX, pressY, ctx);
                    } else if (typeof e.onClick === "function") {
                        e.onClick(pressX, pressY, ctx);
                    } else if (e.option === "Cancel") {
                        // no-op other than close
                    } else if (e.option === "Examine" || e.option === "Inspect") {
                        opts.onExamine?.(menu.targetWidget || null);
                    }
                } finally {
                    closeAllMenus();
                }
            } else {
                // Click anywhere closes menu (), no action.
                closeAllMenus();
            }

            return;
        }
    }

    // Keep menu target counts in sync and drop stale persistent targets when the
    // entry/sub-entry counts shrink (e.g. the submenu closed or switched).
    const subCount = openSubEntry ? openSubEntry.subEntries!.length : 0;
    if (clicks?.unregister) {
        for (let i = menu.entries.length; i < prevCount; i++) {
            try {
                clicks.unregister(`__menu_opt_${i}`);
            } catch {}
        }
        for (let i = subCount; i < prevSubCount; i++) {
            try {
                clicks.unregister(`__menu_sub_${i}`);
            } catch {}
        }
    }
    ui.__menuTargetCount = menu.entries.length;
    ui.__menuSubTargetCount = subCount;

    // Click background to close when clicking outside options (useful on touch)
    // Disabled in follow mode to avoid hijacking clicks during hover-only display
    if (!menu.follow) {
        clicks?.register?.({
            id: "__menu_bg",
            rect: { x: 0, y: 0, w: glr.width, h: glr.height },
            // menu consumes clicks outside options (prevents pass-through).
            // Keep below menu option rows but above any widget targets.
            priority: MENU_BG_PRIORITY,
            persist: true,
            onDown: () => {
                closeAllMenus();
            },
        });
    }

    const mouseX = (ui.mouseX | 0) as number;
    const mouseY = (ui.mouseY | 0) as number;

    drawMenuLevel(glr, opts, menu, {
        rect: menuRect,
        entries: menu.entries,
        headerText: "Choose Option",
        scroll: rt.menuScroll,
        targetIdPrefix: "__menu_opt_",
        targetPriority: MENU_OPTION_PRIORITY_BASE,
        uiScale: s,
        mouseX,
        mouseY,
        colors: { COL_MENU_BG, COL_BLACK, COL_TITLE_TEXT, COL_TEXT_DEFAULT, COL_TEXT_HOVER },
    });

    // The open submenu draws after (above) the parent, but only while its parent
    // row is on-screen (Client.drawOriginalMenu draws it inside the visible row).
    if (openSubEntry && rt.subRect && rt.openSubMenuIndex - rt.menuScroll >= 0) {
        drawMenuLevel(glr, opts, menu, {
            rect: rt.subRect,
            entries: openSubEntry.subEntries!,
            headerText: openSubEntry.target || "",
            scroll: rt.submenuScroll,
            targetIdPrefix: "__menu_sub_",
            targetPriority: MENU_OPTION_PRIORITY_BASE + menu.entries.length,
            uiScale: s,
            mouseX,
            mouseY,
            colors: { COL_MENU_BG, COL_BLACK, COL_TITLE_TEXT, COL_TEXT_DEFAULT, COL_TEXT_HOVER },
        });
    }
}

function drawMenuLevel(
    glr: GLRenderer,
    opts: {
        fontLoader: FontLoader;
        requestRender: () => void;
        onExamine?: (target?: any) => void;
        menuState?: MenuState;
    },
    menu: { follow?: boolean },
    level: {
        rect: MenuRect;
        entries: MenuEntryLike[];
        headerText: string;
        scroll: number;
        targetIdPrefix: string;
        targetPriority: number;
        uiScale: number;
        mouseX: number;
        mouseY: number;
        colors: {
            COL_MENU_BG: [number, number, number, number];
            COL_BLACK: [number, number, number, number];
            COL_TITLE_TEXT: number;
            COL_TEXT_DEFAULT: number;
            COL_TEXT_HOVER: number;
        };
    },
): void {
    const canvas = glr.canvas as HTMLCanvasElement & { __clicks?: any };
    const clicks = canvas.__clicks;
    const s = level.uiScale;
    const { rect, entries, scroll, colors } = level;
    const left = rect.x | 0;
    const top = rect.y | 0;
    const boxW = rect.w | 0;
    const boxH = rect.h | 0;

    // Scaled layout constants for drawing
    const sInset = sp(MENU_TITLE_BG_INSET_PX, s);
    const sTitleBgH = sp(MENU_TITLE_BG_HEIGHT_PX, s);
    const sOutlineY = sp(MENU_OPTIONS_OUTLINE_Y_OFFSET_PX, s);
    const sOutlineHSub = sp(MENU_OPTIONS_OUTLINE_HEIGHT_SUB_PX, s);
    const sTitleTextX = sp(MENU_TITLE_TEXT_X_OFFSET_PX, s);
    const sTitleTextBase = sp(MENU_TITLE_TEXT_BASELINE_OFFSET_PX, s);
    const sTextX = sp(MENU_TEXT_X_OFFSET_PX, s);
    const sTextWPad = sp(MENU_TEXT_WIDTH_PADDING_PX, s);
    const sRowHeight = sp(MENU_ROW_HEIGHT_PX, s);
    const sFirstRowBase = sp(MENU_FIRST_ROW_BASELINE_OFFSET_PX, s);
    const sHitTop = sp(MENU_ROW_HIT_TOP_OFFSET_PX, s);
    const sHitBot = sp(MENU_ROW_HIT_BOTTOM_OFFSET_PX, s);
    const sHitInset = sp(MENU_HIT_TEST_INSET_PX, s);
    const sStroke = sp(1, s);

    // Menu background fill (0x5D5447)
    glr.drawRect(left, top, boxW, boxH, colors.COL_MENU_BG);
    // Title background (black) at (x+1, y+1, w-2, 16)
    glr.drawRect(left + sInset, top + sInset, boxW - sInset * 2, sTitleBgH, colors.COL_BLACK);
    // Options area outline (black) at (x+1, y+18, w-2, h-19)
    const optX0 = left + sInset;
    const optY0 = top + sOutlineY;
    const optW = boxW - sInset * 2;
    const optH = boxH - sOutlineHSub;
    glr.drawRect(optX0, optY0, optW, sStroke, colors.COL_BLACK);
    glr.drawRect(optX0, optY0 + optH - sStroke, optW, sStroke, colors.COL_BLACK);
    glr.drawRect(optX0, optY0, sStroke, optH, colors.COL_BLACK);
    glr.drawRect(optX0 + optW - sStroke, optY0, sStroke, optH, colors.COL_BLACK);

    // Title text baseline at (x+3, y+14)
    {
        const titleFont = opts.fontLoader(FONT_TITLE);
        const maxAscent = (titleFont?.maxAscent ?? titleFont?.ascent ?? 0) | 0;
        const h = titleFont ? (titleFont.maxAscent + titleFont.maxDescent) | 0 : 16;
        UI_drawTextGL(
            glr,
            opts.fontLoader,
            level.headerText,
            left + sTitleTextX,
            (top + sTitleTextBase - Math.round(maxAscent * s)) | 0,
            Math.max(1, boxW - sTextWPad),
            Math.max(1, Math.round(h * s)),
            FONT_TITLE,
            colors.COL_TITLE_TEXT,
            0,
            0,
            false,
            1,
            undefined,
            s,
            s,
        );
    }

    // Entries (Client.drawLoggedIn menu entry layout); rows scrolled past the top
    // are culled, rows below the canvas clip naturally.
    const optFont = opts.fontLoader(FONT_OPT);
    const optMaxAscent = (optFont?.maxAscent ?? optFont?.ascent ?? 0) | 0;
    const optH1 = optFont ? (optFont.maxAscent + optFont.maxDescent) | 0 : 16;

    for (let i = 0; i < entries.length; i++) {
        const drawnRow = i - scroll;
        if (drawnRow < 0) continue;
        const e = entries[i];
        let fullText = entryFullText(e);
        if (hasSubEntries(e)) fullText += SUBMENU_ARROW_DRAW_SUFFIX;

        // OSRS: baseline at menuY + MENU_FIRST_ROW_BASELINE_OFFSET_PX + (row * MENU_ROW_HEIGHT_PX).
        const baselineY = (top + sFirstRowBase + drawnRow * sRowHeight) | 0;
        const textY = (baselineY - Math.round(optMaxAscent * s)) | 0;

        // Hover/click region in OSRS uses strict comparisons; emulate with a 1px inset.
        const rowRect = {
            x: (left + sHitInset) | 0,
            y: (baselineY - sHitTop + sHitInset) | 0,
            w: Math.max(1, boxW - sHitInset),
            h: sRowHeight,
        };
        const id = `${level.targetIdPrefix}${i}`;

        // In follow mode, make the menu non-interactive: no click targets registered.
        if (!menu.follow) {
            const hoverLabel = stripTagsForMeasure(fullText).trim();
            clicks?.register?.({
                id,
                rect: rowRect,
                // Must be higher than __menu_bg so option rows consume hover/clicks.
                priority: level.targetPriority + i,
                persist: true,
                hoverText: hoverLabel.length ? hoverLabel : undefined,
            });
        }

        const hover =
            level.mouseX > left &&
            level.mouseX < left + boxW &&
            level.mouseY > baselineY - sHitTop &&
            level.mouseY < baselineY + sHitBot;

        UI_drawTextGL(
            glr,
            opts.fontLoader,
            fullText,
            left + sTextX,
            textY,
            Math.max(1, boxW - sTextWPad),
            Math.max(1, Math.round(optH1 * s)),
            FONT_OPT,
            hover ? colors.COL_TEXT_HOVER : colors.COL_TEXT_DEFAULT,
            0,
            0,
            true,
            1,
            undefined,
            s,
            s,
        );
    }
}
