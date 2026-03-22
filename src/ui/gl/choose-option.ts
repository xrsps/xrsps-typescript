import { ClickMode } from "../../client/InputManager";
import { BitmapFont } from "../../rs/font/BitmapFont";
import { FONT_BOLD_12 } from "../fonts";
import type { MenuClickContext } from "../menu/MenuEngine";
import { MenuState } from "../menu/MenuState";
import { getUiScale } from "../UiScale";
import { drawTextGL as UI_drawTextGL } from "../widgets/components/TextRenderer";
import { GLRenderer } from "./renderer";

type FontLoader = (id: number) => BitmapFont | undefined;

export type ChooseOptionMenuEntry = {
    option: string;
    target?: string;
};

export type ChooseOptionMenuLike = {
    open?: boolean;
    x: number;
    y: number;
    entries: ChooseOptionMenuEntry[];
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

// Click target priorities (menu must consume clicks over widgets)
const MENU_BG_PRIORITY = 999;
const MENU_OPTION_PRIORITY_BASE = 1000;
const FONT_TITLE = FONT_BOLD_12;
const FONT_OPT = FONT_BOLD_12;

function stripTagsForMeasure(s: string): string {
    if (!s) return "";
    return String(s).replace(/<[^>]*>/g, "");
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

export function getChooseOptionMenuRect(
    fontLoader: FontLoader,
    menu: ChooseOptionMenuLike | undefined,
    hostW: number,
    hostH: number,
    uiScale: number = 1,
): { x: number; y: number; w: number; h: number } | undefined {
    if (!(menu && menu.open && Array.isArray(menu.entries) && menu.entries.length > 0)) {
        return undefined;
    }

    const s = uiScale > 0 ? uiScale : 1;

    let contentW = measureMenuText(fontLoader, "Choose Option", FONT_TITLE);
    for (const e of menu.entries) {
        const option = e.option || "";
        const target = e.target || "";
        const full = target.length ? `${option} ${target}` : option;
        const w = measureMenuText(fontLoader, full, FONT_OPT);
        if (w > contentW) contentW = w;
    }

    const boxW = (sp(contentW, s) + sp(MENU_WIDTH_PADDING_PX, s)) | 0;
    const boxH = ((menu.entries.length * sp(MENU_ROW_HEIGHT_PX, s) + sp(MENU_HEIGHT_BASE_PX, s)) | 0) as number;

    let left = ((menu.x | 0) - ((boxW / 2) | 0)) | 0;
    if (left + boxW > (hostW | 0)) left = (hostW | 0) - boxW;
    if (left < 0) left = 0;
    let top = menu.y | 0;
    if (top + boxH > (hostH | 0)) top = (hostH | 0) - boxH;
    if (top < 0) top = 0;

    return { x: left, y: top, w: boxW, h: boxH };
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
              entries: Array<{
                  option: string;
                  target?: string;
                  // Click handler may receive pointer coords in canvas pixels
                  onClick?: (x?: number, y?: number, ctx?: MenuClickContext) => void;
                  menuStateIndex?: number;
              }>;
              targetWidget?: any;
              // When true, this is a non-interactive, always-follow cursor overlay
              // and should not auto-cancel or register click targets.
              follow?: boolean;
              menuState?: MenuState;
              onEntryInvoke?: (entry: {
                  option: string;
                  target?: string;
                  onClick?: (x?: number, y?: number, ctx?: MenuClickContext) => void;
                  menuStateIndex?: number;
              }) => void;
          }
        | undefined;
    // Cleanup any previously registered menu click targets when the menu is closed.
    // We register menu targets as persistent so they are available for input processing even
    // when the menu is drawn after input; therefore we must explicitly unregister on close.
    const prevCount = (ui.__menuTargetCount | 0) as number;
    const unregisterMenuTargets = (count: number) => {
        if (count > 0 && clicks?.unregister) {
            try {
                clicks.unregister("__menu_bg");
            } catch {}
            for (let i = 0; i < count; i++) {
                try {
                    clicks.unregister(`__menu_opt_${i}`);
                } catch {}
            }
        }
        ui.__menuTargetCount = 0;
    };
    if (!(menu && menu.open && Array.isArray(menu.entries) && menu.entries.length > 0)) {
        unregisterMenuTargets(prevCount);
        return;
    }

    const globalClient: any =
        (canvas as any).__osrsClient ||
        (ui as any).__osrsClient ||
        (typeof globalThis !== "undefined" ? (globalThis as any).__osrsClient : undefined);

    // Helper that aggressively closes any open menu (world or widget) and asks for a redraw.
    const closeAllMenus = () => {
        // Idempotency guard: avoid double-closing (MenuState.invoke may call ctx.closeMenu in finally).
        const hadUiMenu = !!ui.menu;
        const hadWorldMenu = !!globalClient?.menuOpen;
        if (!hadUiMenu && !hadWorldMenu) {
            unregisterMenuTargets(ui.__menuTargetCount | 0);
            return;
        }
        try {
            if (ui.menu) ui.menu.open = false;
            ui.menu = undefined;
        } catch {}
        // Cancel any active click in the registry to prevent onClick from firing on release
        try {
            clicks?.cancelActiveClick?.();
            // Also consume the click in UIInputBridge to reset held-state tracking
            (canvas as any).__inputBridge?.consumeClick?.();
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
        unregisterMenuTargets(ui.__menuTargetCount | 0);
        opts.requestRender();
    };

    // Colors (OSRS parity: Client.drawLoggedIn menu colors)
    // Reference: Client.java drawLoggedIn() - menu fill color 6116423 (0x5D5447),
    // title bg black, hover yellow, default white, option shadow black.
    const COL_MENU_BG: [number, number, number, number] = [0x5d / 255, 0x54 / 255, 0x47 / 255, 1];
    const COL_BLACK: [number, number, number, number] = [0, 0, 0, 1];
    const COL_TITLE_TEXT = 0x5d5447;
    const COL_TEXT_DEFAULT = 0xffffff;
    const COL_TEXT_HOVER = 0xffff00;

    const cssW = canvas?.clientWidth || canvas?.offsetWidth || 0;
    const cssH = canvas?.clientHeight || canvas?.offsetHeight || 0;
    const s = getUiScale(cssW, cssH);
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
        unregisterMenuTargets(prevCount);
        return;
    }
    const left = menuRect.x | 0;
    const top = menuRect.y | 0;
    const boxW = menuRect.w | 0;
    const boxH = menuRect.h | 0;

    // OSRS parity: menu() auto-closes when the mouse moves outside the menu rect with a MENU_CLOSE_MARGIN_PX margin.
    // Reference: Client.menu() lines 6086-6101.
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

        // Close menu when moving off it (no selection click this frame).
        if (lastButton !== ClickMode.LEFT) {
            const closeMargin = sp(MENU_CLOSE_MARGIN_PX, s);
            if (
                mx < ((left - closeMargin) | 0) ||
                mx > ((left + boxW + closeMargin) | 0) ||
                my < ((top - closeMargin) | 0) ||
                my > ((top + boxH + closeMargin) | 0)
            ) {
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
                try {
                    if (typeof (menu as any)?.closeWorldMenu === "function")
                        (menu as any).closeWorldMenu();
                    else if (typeof (ui as any)?.closeWorldMenu === "function")
                        (ui as any).closeWorldMenu();
                    else if (typeof globalClient?.closeMenu === "function")
                        globalClient.closeMenu();
                } catch {}
                unregisterMenuTargets(ui.__menuTargetCount | 0);
                opts.requestRender();
                return;
            }
        }

        // Select/close on mousedown (OSRS: lastPressedX/Y).
        if (lastButton === ClickMode.LEFT) {
            const pressPoint = scaleInputPoint(
                canvas,
                (inputManager.saveClickX | 0) as number,
                (inputManager.saveClickY | 0) as number,
            );
            const pressX = pressPoint.x | 0;
            const pressY = pressPoint.y | 0;
            const sRowH = sp(MENU_ROW_HEIGHT_PX, s);
            const sFirstRowBase = sp(MENU_FIRST_ROW_BASELINE_OFFSET_PX, s);
            const sHitTop = sp(MENU_ROW_HIT_TOP_OFFSET_PX, s);
            const sHitBot = sp(MENU_ROW_HIT_BOTTOM_OFFSET_PX, s);
            let pickedIndex = -1;
            for (let i = 0; i < menu.entries.length; i++) {
                const baselineY =
                    (top + sFirstRowBase + i * sRowH) | 0;
                if (
                    pressX > left &&
                    pressX < left + boxW &&
                    pressY > baselineY - sHitTop &&
                    pressY < baselineY + sHitBot
                ) {
                    pickedIndex = i;
                }
            }

            if (pickedIndex !== -1) {
                const e = menu.entries[pickedIndex];
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
                // Click anywhere closes menu (OSRS parity), no action.
                closeAllMenus();
            }

            return;
        }
    }

    // Keep menu target count in sync for cleanup if the menu closes.
    ui.__menuTargetCount = menu.entries.length;

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
    glr.drawRect(left, top, boxW, boxH, COL_MENU_BG);
    // Title background (black) at (x+1, y+1, w-2, 16)
    glr.drawRect(
        left + sInset,
        top + sInset,
        boxW - sInset * 2,
        sTitleBgH,
        COL_BLACK,
    );
    // Options area outline (black) at (x+1, y+18, w-2, h-19)
    const optX0 = left + sInset;
    const optY0 = top + sOutlineY;
    const optW = boxW - sInset * 2;
    const optH = boxH - sOutlineHSub;
    glr.drawRect(optX0, optY0, optW, sStroke, COL_BLACK);
    glr.drawRect(optX0, optY0 + optH - sStroke, optW, sStroke, COL_BLACK);
    glr.drawRect(optX0, optY0, sStroke, optH, COL_BLACK);
    glr.drawRect(optX0 + optW - sStroke, optY0, sStroke, optH, COL_BLACK);

    // Title text baseline at (x+3, y+14)
    {
        const titleFont = opts.fontLoader(FONT_TITLE);
        const maxAscent = (titleFont?.maxAscent ?? titleFont?.ascent ?? 0) | 0;
        const h = titleFont ? (titleFont.maxAscent + titleFont.maxDescent) | 0 : 16;
        UI_drawTextGL(
            glr,
            opts.fontLoader,
            "Choose Option",
            left + sTitleTextX,
            (top + sTitleTextBase - Math.round(maxAscent * s)) | 0,
            Math.max(1, boxW - sTextWPad),
            Math.max(1, Math.round(h * s)),
            FONT_TITLE,
            COL_TITLE_TEXT,
            0,
            0,
            false,
            1,
            undefined,
            s,
            s,
        );
    }

    // Click background to close when clicking outside options (useful on touch)
    // Disabled in follow mode to avoid hijacking clicks during hover-only display
    if (!menu.follow) {
        clicks?.register?.({
            id: "__menu_bg",
            rect: { x: 0, y: 0, w: glr.width, h: glr.height },
            // OSRS parity: menu consumes clicks outside options (prevents pass-through).
            // Keep below menu option rows but above any widget targets.
            priority: MENU_BG_PRIORITY,
            persist: true,
            onDown: () => {
                closeAllMenus();
            },
        });
    }

    // Entries (OSRS parity: Client.drawLoggedIn menu entry layout)
    const optFont = opts.fontLoader(FONT_OPT);
    const optMaxAscent = (optFont?.maxAscent ?? optFont?.ascent ?? 0) | 0;
    const optH1 = optFont ? (optFont.maxAscent + optFont.maxDescent) | 0 : 16;

    for (let i = 0; i < menu.entries.length; i++) {
        const e = menu.entries[i];
        const option = e.option || "";
        const target = e.target || "";
        const fullText = target.length ? `${option} ${target}` : option;

        // OSRS: baseline at menuY + MENU_FIRST_ROW_BASELINE_OFFSET_PX + (i * MENU_ROW_HEIGHT_PX) (top-to-bottom).
        const baselineY = (top + sFirstRowBase + i * sRowHeight) | 0;
        const textY = (baselineY - Math.round(optMaxAscent * s)) | 0;

        // Hover/click region in OSRS uses strict comparisons; emulate with a 1px inset.
        const rowRect = {
            x: (left + sHitInset) | 0,
            y: (baselineY - sHitTop + sHitInset) | 0,
            w: Math.max(1, boxW - sHitInset),
            h: sRowHeight,
        };
        const id = `__menu_opt_${i}`;

        // In follow mode, make the menu non-interactive: no click targets registered.
        if (!menu.follow) {
            const hoverLabel = String(fullText)
                .replace(/<[^>]*>/g, "")
                .trim();
            clicks?.register?.({
                id,
                rect: rowRect,
                // Must be higher than __menu_bg so option rows consume hover/clicks.
                priority: MENU_OPTION_PRIORITY_BASE + i,
                persist: true,
                hoverText: hoverLabel.length ? hoverLabel : undefined,
            });
        }

        const hover =
            ui.mouseX > left &&
            ui.mouseX < left + boxW &&
            ui.mouseY > baselineY - sHitTop &&
            ui.mouseY < baselineY + sHitBot;

        UI_drawTextGL(
            glr,
            opts.fontLoader,
            fullText,
            left + sTextX,
            textY,
            Math.max(1, boxW - sTextWPad),
            Math.max(1, Math.round(optH1 * s)),
            FONT_OPT,
            hover ? COL_TEXT_HOVER : COL_TEXT_DEFAULT,
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
