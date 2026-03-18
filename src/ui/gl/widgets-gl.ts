import { ClientState } from "../../client/ClientState";
import type { InputManager } from "../../client/InputManager";
import { profiler } from "../../client/webgl/PerformanceProfiler";
import { CacheIndex } from "../../rs/cache/CacheIndex";
import { CacheSystem } from "../../rs/cache/CacheSystem";
import { BitmapFont } from "../../rs/font/BitmapFont";
import { menuAction } from "../menu/MenuAction";
import { MenuOpcode, MenuState } from "../menu/MenuState";
import type { WidgetManager } from "../widgets/WidgetManager";
import type { WidgetNode } from "../widgets/WidgetNode";
import {
    drawRichTextGL as UI_drawRichTextGL,
    drawTextGL as UI_drawTextGL,
    drawWrappedTextGL as UI_drawWrappedTextGL,
} from "../widgets/components/TextRenderer";
import { runCs1 } from "../widgets/cs1/runCs1";
import {
    collectWidgetsAtPointAcrossRoots as UI_collectWidgetsAtPointAcrossRoots,
    deriveMenuEntriesForWidget as UI_deriveMenuEntriesForWidget,
} from "../widgets/menu/utils";
import { MinimapRenderer } from "./MinimapRenderer";
import { drawChooseOptionMenu } from "./choose-option";
import { GLRenderer } from "./renderer";
import {
    ClipRect,
    ScissorStack,
    calculateStandardClip,
    calculateType9Clip,
    isClipValid,
} from "./scissor";
import { TextureCache } from "./texture-cache";
import { ensureInput } from "./ui-input";

// Debug flag: draw purple outlines around clickable areas
const DEBUG_CLICK_AREAS = false;

// PERF: Widget rendering profiling
let _widgetRenderCount = 0;
let _lastWidgetCountLog = 0;
let _accumulatedWidgetCount = 0;
let _accumulatedFrames = 0;
let _lastWidgetBreakdownLog = 0;
let _accumulatedWidgetRenderMs = 0;
let _accumulatedWidgetClickMs = 0;
let _accumulatedWidgetMinimapMs = 0;
let _accumulatedWidgetSpriteMs = 0;
let _accumulatedWidgetModelMs = 0;
let _accumulatedWidgetTextMs = 0;
let _accumulatedWidgetOtherMs = 0;
let _accumulatedWidgetRectMs = 0;
let _accumulatedWidgetLineMs = 0;
let _accumulatedWidgetContainerMs = 0;
let _accumulatedWidgetClickProbeMs = 0;
let _accumulatedWidgetClickDeriveMs = 0;
let _accumulatedWidgetClickRegisterMs = 0;
let _accumulatedWidgetPasses = 0;
let _accumulatedWidgetDrawCalls = 0;
let _accumulatedWidgetTextureDrawCalls = 0;
let _accumulatedWidgetSolidDrawCalls = 0;
let _accumulatedWidgetGradientDrawCalls = 0;
let _accumulatedWidgetMaskedDrawCalls = 0;
let _accumulatedTextWidgets = 0;
let _accumulatedSpriteWidgets = 0;
let _accumulatedModelWidgets = 0;
let _accumulatedMinimapWidgets = 0;
let _accumulatedInteractiveWidgets = 0;
let _accumulatedMenuDeriveWidgets = 0;
let _accumulatedMenuEntries = 0;
let _accumulatedModelCacheHits = 0;
let _accumulatedModelCacheMisses = 0;

// PERF: Cached no-op function to avoid closure allocation in ensureInput calls
const NOOP = () => {};

// PERF: Cached cancel selection handler to avoid closure allocation per widget
const CANCEL_SELECTION_HANDLER = () => {
    ClientState.clearSpellSelection();
    ClientState.clearItemSelection();
};

type WidgetMenuDeriveCacheEntry = {
    revision: number;
    flagsVersion: number;
    flags: number;
    itemId: number;
    targetVerb: string;
    spellActionName: string;
    opBase: string;
    dataText: string;
    name: string;
    text: string;
    actionsKey: string;
    hasOnOpArray: boolean;
    hasOnOpHandler: boolean;
    entries: Array<{ option: string; target?: string }>;
};

type WidgetInteractionSnapshot = {
    revision: number;
    flagsVersion: number;
    hasCs2Click: boolean;
    hasActions: boolean;
    hasActionSlots: boolean;
    hasTargetVerbCandidate: boolean;
    hasOriginalHandlers: boolean;
    isInventoryItem: boolean;
    hasButtonTypeInteraction: boolean;
    isPauseButtonWidget: boolean;
    buttonType: number;
    shouldDeriveEntries: boolean;
};

const widgetMenuDeriveCache = new Map<number, WidgetMenuDeriveCacheEntry>();
const WIDGET_MENU_DERIVE_CACHE_MAX = 8192;

function getWidgetActionsKey(w: any): string {
    const actions = Array.isArray(w?.actions) ? (w.actions as any[]) : undefined;
    if (!actions || actions.length === 0) return "";
    let out = "";
    for (let i = 0; i < actions.length; i++) {
        if (i > 0) out += "\u0001";
        const a = actions[i];
        out += typeof a === "string" ? a : a == null ? "" : String(a);
    }
    return out;
}

function getWidgetOnOpHandlerPresence(w: any): { hasOnOpArray: boolean; hasOnOpHandler: boolean } {
    const hasOnOpArray = Array.isArray(w?.onOp) && w.onOp.length > 0;
    const eh = w?.eventHandlers as any;
    let hasOnOpHandler = false;
    if (eh instanceof Map) {
        const mapped = eh.get("onOp");
        hasOnOpHandler = Array.isArray(mapped) ? mapped.length > 0 : !!mapped;
    } else if (eh && typeof eh === "object") {
        const mapped = eh.onOp;
        hasOnOpHandler = Array.isArray(mapped) ? mapped.length > 0 : !!mapped;
    }
    return { hasOnOpArray, hasOnOpHandler };
}

function getWidgetInteractionSnapshot(
    w: any,
    getWidgetFlags: (w: any) => number,
    flagsVersion: number,
): WidgetInteractionSnapshot {
    const revision = (((w?.__interactionRevision ?? 0) as number) | 0) as number;
    const cached = w?.__interactionSnapshot as WidgetInteractionSnapshot | undefined;
    if (cached && cached.revision === revision && cached.flagsVersion === (flagsVersion | 0)) {
        return cached;
    }

    const eh = w?.eventHandlers as any;
    const hasEventHandlerContainer = !!eh;
    const hasLegacyHandlerArrays =
        !!w?.onClick ||
        !!w?.onOp ||
        !!w?.onHold ||
        !!w?.onRelease ||
        !!w?.onMouseOver ||
        !!w?.onMouseLeave;

    let hasCs2Click = false;
    if (w?.hasListener || hasEventHandlerContainer || hasLegacyHandlerArrays) {
        hasCs2Click =
            !!(
                (eh instanceof Map
                    ? eh.get("onClick") ||
                      eh.get("onOp") ||
                      eh.get("onHold") ||
                      eh.get("onRelease") ||
                      eh.get("onMouseOver") ||
                      eh.get("onMouseLeave")
                    : eh?.onClick ||
                      eh?.onOp ||
                      eh?.onHold ||
                      eh?.onRelease ||
                      eh?.onMouseOver ||
                      eh?.onMouseLeave) ||
                (Array.isArray(w?.onClick) && w.onClick.length > 0) ||
                (Array.isArray(w?.onOp) && w.onOp.length > 0) ||
                (Array.isArray(w?.onHold) && w.onHold.length > 0) ||
                (Array.isArray(w?.onRelease) && w.onRelease.length > 0) ||
                (Array.isArray(w?.onMouseOver) && w.onMouseOver.length > 0) ||
                (Array.isArray(w?.onMouseLeave) && w.onMouseLeave.length > 0)
            );
    }

    const widgetActions = Array.isArray(w?.actions) ? (w.actions as any[]) : undefined;
    const hasActions = !!widgetActions?.some((a: any) => a && a !== "");
    const hasActionSlots = !!widgetActions?.length;
    const hasTargetVerbCandidate =
        !!w?.targetVerb || !!w?.spellActionName || !!w?.buttonText;
    const buttonType = (w?.buttonType ?? 0) | 0;
    const hasButtonTypeInteraction = buttonType > 0;
    const hasOriginalHandlers =
        !!w?.__hasOriginalOnClick ||
        !!w?.__hasOriginalOnOp ||
        !!w?.__hasOriginalOnHold ||
        !!w?.__hasOriginalOnRelease;

    const widgetItemId = w?.itemId;
    const widgetGroupId = ((w?.groupId ?? (w?.uid >>> 16)) ?? 0) | 0;
    const isInventoryItem = widgetGroupId === 149 && widgetItemId != null && widgetItemId >= 0;

    let isPauseButtonWidget = false;
    if (
        !hasCs2Click &&
        !hasActions &&
        !hasOriginalHandlers &&
        !isInventoryItem &&
        !hasTargetVerbCandidate &&
        !hasButtonTypeInteraction
    ) {
        if ((getWidgetFlags(w) & 1) !== 0) {
            isPauseButtonWidget = true;
        } else {
            const rawButtonText = w?.buttonText;
            if (typeof rawButtonText === "string" && rawButtonText.length > 0) {
                isPauseButtonWidget = rawButtonText.toLowerCase() === "continue";
            }
            if (!isPauseButtonWidget) {
                const rawWidgetText = w?.text;
                if (
                    typeof rawWidgetText === "string" &&
                    rawWidgetText.length >= 8 &&
                    rawWidgetText.toLowerCase().includes("continue")
                ) {
                    const lowerText = rawWidgetText.toLowerCase();
                    isPauseButtonWidget =
                        lowerText.includes("click") && lowerText.includes("continue");
                }
            }
        }
    }
    if (!isPauseButtonWidget && buttonType === 6) {
        isPauseButtonWidget = true;
    }

    const snapshot: WidgetInteractionSnapshot = {
        revision,
        flagsVersion: flagsVersion | 0,
        hasCs2Click,
        hasActions,
        hasActionSlots,
        hasTargetVerbCandidate,
        hasOriginalHandlers,
        isInventoryItem,
        hasButtonTypeInteraction,
        isPauseButtonWidget,
        buttonType,
        shouldDeriveEntries:
            hasActionSlots || hasTargetVerbCandidate || isInventoryItem || isPauseButtonWidget,
    };
    (w as any).__interactionSnapshot = snapshot;
    return snapshot;
}

function deriveMenuEntriesForWidgetCached(
    w: any,
    getWidgetFlags?: (w: any) => number,
): Array<{ option: string; target?: string }> {
    const uid = typeof w?.uid === "number" ? w.uid | 0 : 0;
    if (uid === 0) {
        return UI_deriveMenuEntriesForWidget(w as any, false, getWidgetFlags) || [];
    }

    const flags = (getWidgetFlags ? getWidgetFlags(w) : ((w?.flags ?? 0) as number)) | 0;
    const revision = (((w?.__interactionRevision ?? 0) as number) | 0) as number;
    const flagsVersion =
        typeof w?.__widgetFlagsVersion === "number" ? (w.__widgetFlagsVersion as number) | 0 : 0;
    const itemId = (typeof w?.itemId === "number" ? w.itemId : -1) | 0;
    const targetVerb = String(w?.targetVerb ?? "");
    const spellActionName = String(w?.spellActionName ?? "");
    const opBase = String(w?.opBase ?? "");
    const dataText = String(w?.dataText ?? "");
    const name = String(w?.name ?? "");
    const text = String(w?.text ?? "");
    const actionsKey = getWidgetActionsKey(w);
    const { hasOnOpArray, hasOnOpHandler } = getWidgetOnOpHandlerPresence(w);

    const cached = widgetMenuDeriveCache.get(uid);
    if (
        cached &&
        cached.revision === revision &&
        cached.flagsVersion === flagsVersion &&
        cached.flags === flags &&
        cached.itemId === itemId &&
        cached.targetVerb === targetVerb &&
        cached.spellActionName === spellActionName &&
        cached.opBase === opBase &&
        cached.dataText === dataText &&
        cached.name === name &&
        cached.text === text &&
        cached.actionsKey === actionsKey &&
        cached.hasOnOpArray === hasOnOpArray &&
        cached.hasOnOpHandler === hasOnOpHandler
    ) {
        return cached.entries;
    }

    const entries = UI_deriveMenuEntriesForWidget(w as any, false, getWidgetFlags) || [];
    const next: WidgetMenuDeriveCacheEntry = {
        revision,
        flagsVersion,
        flags,
        itemId,
        targetVerb,
        spellActionName,
        opBase,
        dataText,
        name,
        text,
        actionsKey,
        hasOnOpArray,
        hasOnOpHandler,
        entries,
    };
    if (widgetMenuDeriveCache.size >= WIDGET_MENU_DERIVE_CACHE_MAX) {
        const firstKey = widgetMenuDeriveCache.keys().next().value;
        if (firstKey !== undefined) widgetMenuDeriveCache.delete(firstKey);
    }
    widgetMenuDeriveCache.set(uid, next);
    return entries;
}

// PERF: Click metadata stored per-widget to avoid closure allocation per widget per frame
type WidgetClickMeta = {
    widget: Widget;
    option: string;
    target?: string;
    hasDropAction: boolean;
    itemId?: number;
    slot?: number;
};

// PERF: Cached click target structure to avoid object allocation per widget per frame
type CachedClickTarget = {
    id: string;
    rect: { x: number; y: number; w: number; h: number };
    priority: number;
    hoverText?: string;
    primaryOption?: { option: string; target?: string };
    /**
     * OSRS parity: number of minimenu options for this hover target (including Cancel).
     * Used by CS2 minimenu_* opcodes via ClientOps snapshot logic.
     */
    menuOptionsCount?: number;
    widgetUid?: number; // For OSRS-style visibility filtering during hit testing
    onDown?: (x?: number, y?: number, targetId?: string) => void;
    onClick?: (x?: number, y?: number, targetId?: string) => void;
    persist?: boolean; // If true, survives beginFrame() clearing
};

// Re-export WidgetNode for consumers that import from this module
export type { WidgetNode };

type Widget = WidgetNode;
const EMPTY_WIDGETS: Widget[] = [];

/**
 * OSRS PARITY: Draw a single-pixel line using Bresenham's algorithm
 * Reference: Rasterizer2D.Rasterizer2D_drawLine
 */
function drawLine(
    glr: GLRenderer,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: [number, number, number, number],
): void {
    x1 = x1 | 0;
    y1 = y1 | 0;
    x2 = x2 | 0;
    y2 = y2 | 0;

    const dx = Math.abs(x2 - x1);
    const dy = Math.abs(y2 - y1);
    const sx = x1 < x2 ? 1 : -1;
    const sy = y1 < y2 ? 1 : -1;
    let err = dx - dy;

    let x = x1;
    let y = y1;

    while (true) {
        glr.drawRect(x, y, 1, 1, color);
        if (x === x2 && y === y2) break;

        const e2 = err * 2;
        if (e2 > -dy) {
            err -= dy;
            x += sx;
        }
        if (e2 < dx) {
            err += dx;
            y += sy;
        }
    }
}

/**
 * OSRS PARITY: Draw a thick line
 * Reference: WorldMapSection0.method4978 - draws thick lines using perpendicular expansion
 */
function drawThickLine(
    glr: GLRenderer,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    width: number,
    color: [number, number, number, number],
): void {
    x1 = x1 | 0;
    y1 = y1 | 0;
    x2 = x2 | 0;
    y2 = y2 | 0;
    width = Math.max(1, width | 0);

    // For thick lines, draw multiple parallel lines
    // Calculate perpendicular offset
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);

    if (len < 0.001) {
        // Point - just draw a square
        glr.drawRect(x1 - (width >> 1), y1 - (width >> 1), width, width, color);
        return;
    }

    // Unit perpendicular vector
    const px = -dy / len;
    const py = dx / len;

    // Draw lines offset perpendicular to the main line
    const halfWidth = width / 2;
    for (let i = -halfWidth; i <= halfWidth; i++) {
        const ox = Math.round(px * i);
        const oy = Math.round(py * i);
        drawLine(glr, x1 + ox, y1 + oy, x2 + ox, y2 + oy, color);
    }
}

// OSRS scrollbar colors (from client.scrollbar*Color fields)
const SCROLLBAR_TRACK_COLOR = 0x23201b;
const SCROLLBAR_THUMB_COLOR = 0x4d4233;
const SCROLLBAR_TOP_COLOR = 0x766654;
const SCROLLBAR_BOTTOM_COLOR = 0x332d25;

function scaleLogicalPixels(scale: number, logicalPixels: number): number {
    const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
    return Math.max(1, Math.round(logicalPixels * safeScale));
}

/**
 * OSRS PARITY: Draw IF1 scrollbar
 * Reference: UserComparator9.drawScrollBar()
 * Draws a 16px wide scrollbar with up/down arrows and a draggable thumb
 * @param x X position (right edge of container)
 * @param y Y position (top of container)
 * @param scrollY Current scroll position
 * @param height Container height (visible area)
 * @param scrollHeight Total scrollable content height
 * @param tc Texture cache for sprites
 * @param opts Render options
 */
function drawScrollBar(
    glr: GLRenderer,
    x: number,
    y: number,
    scrollY: number,
    height: number,
    scrollHeight: number,
    tc: TextureCache,
    opts: GLRenderOpts,
    scaleX: number = 1,
    scaleY: number = 1,
): void {
    x = x | 0;
    y = y | 0;
    height = height | 0;
    scrollHeight = scrollHeight | 0;
    scrollY = scrollY | 0;

    // Scrollbar dimensions
    const SCROLLBAR_WIDTH = scaleLogicalPixels(scaleX, 16);
    const ARROW_HEIGHT = scaleLogicalPixels(scaleY, 16);
    const EDGE_WIDTH = Math.min(SCROLLBAR_WIDTH, scaleLogicalPixels(scaleX, 1));
    const EDGE_HEIGHT = Math.min(Math.max(1, height), scaleLogicalPixels(scaleY, 1));

    const scrollbarSpriteArchiveId = opts.widgetManager?.scrollbarSpriteArchiveId ?? -1;
    const upArrow =
        scrollbarSpriteArchiveId >= 0
            ? tc.getSpriteByArchiveFrame(scrollbarSpriteArchiveId, 0)
            : undefined;
    const downArrow =
        scrollbarSpriteArchiveId >= 0
            ? tc.getSpriteByArchiveFrame(scrollbarSpriteArchiveId, 1)
            : undefined;

    // Draw up arrow
    if (upArrow) {
        glr.drawTexture(upArrow, x, y, SCROLLBAR_WIDTH, ARROW_HEIGHT, 1, 1);
    }

    // Draw down arrow
    if (downArrow) {
        glr.drawTexture(
            downArrow,
            x,
            y + height - ARROW_HEIGHT,
            SCROLLBAR_WIDTH,
            ARROW_HEIGHT,
            1,
            1,
        );
    }

    // Draw track (area between arrows)
    const trackHeight = height - ARROW_HEIGHT * 2;
    if (trackHeight > 0) {
        const tr = ((SCROLLBAR_TRACK_COLOR >>> 16) & 0xff) / 255;
        const tg = ((SCROLLBAR_TRACK_COLOR >>> 8) & 0xff) / 255;
        const tb = (SCROLLBAR_TRACK_COLOR & 0xff) / 255;
        glr.drawRect(x, y + ARROW_HEIGHT, SCROLLBAR_WIDTH, trackHeight, [tr, tg, tb, 1]);
    }

    // Calculate thumb size and position
    // Reference: UserComparator9.drawScrollBar lines 569-574
    // var5 = height * (height - 32) / scrollHeight (thumb height)
    // var6 = (height - 32 - var5) * scrollY / (scrollHeight - height) (thumb position)
    const availableTrack = trackHeight;
    let thumbHeight = Math.floor((height * availableTrack) / scrollHeight);
    const minThumbHeight = scaleLogicalPixels(scaleY, 8);
    if (thumbHeight < minThumbHeight) thumbHeight = minThumbHeight;

    const maxScrollY = scrollHeight - height;
    const thumbY =
        maxScrollY > 0 ? Math.floor(((availableTrack - thumbHeight) * scrollY) / maxScrollY) : 0;

    // Draw thumb
    if (thumbHeight > 0 && thumbHeight < trackHeight) {
        const tr = ((SCROLLBAR_THUMB_COLOR >>> 16) & 0xff) / 255;
        const tg = ((SCROLLBAR_THUMB_COLOR >>> 8) & 0xff) / 255;
        const tb = (SCROLLBAR_THUMB_COLOR & 0xff) / 255;
        const thumbTop = y + ARROW_HEIGHT + thumbY;
        glr.drawRect(x, thumbTop, SCROLLBAR_WIDTH, thumbHeight, [tr, tg, tb, 1]);

        // Draw thumb highlight (left and top edges)
        const hr = ((SCROLLBAR_TOP_COLOR >>> 16) & 0xff) / 255;
        const hg = ((SCROLLBAR_TOP_COLOR >>> 8) & 0xff) / 255;
        const hb = (SCROLLBAR_TOP_COLOR & 0xff) / 255;
        const leftEdgeW = Math.min(SCROLLBAR_WIDTH, EDGE_WIDTH);
        const leftInsetW = Math.min(Math.max(0, SCROLLBAR_WIDTH - leftEdgeW), EDGE_WIDTH);
        const topEdgeH = Math.min(thumbHeight, EDGE_HEIGHT);
        const topInsetH = Math.min(Math.max(0, thumbHeight - topEdgeH), EDGE_HEIGHT);
        if (leftEdgeW > 0) {
            glr.drawRect(x, thumbTop, leftEdgeW, thumbHeight, [hr, hg, hb, 1]);
        }
        if (leftInsetW > 0) {
            glr.drawRect(x + leftEdgeW, thumbTop, leftInsetW, thumbHeight, [hr, hg, hb, 1]);
        }
        if (topEdgeH > 0) {
            glr.drawRect(x, thumbTop, SCROLLBAR_WIDTH, topEdgeH, [hr, hg, hb, 1]);
        }
        if (topInsetH > 0) {
            glr.drawRect(x, thumbTop + topEdgeH, SCROLLBAR_WIDTH, topInsetH, [hr, hg, hb, 1]);
        }

        // Draw thumb shadow (right and bottom edges)
        const sr = ((SCROLLBAR_BOTTOM_COLOR >>> 16) & 0xff) / 255;
        const sg = ((SCROLLBAR_BOTTOM_COLOR >>> 8) & 0xff) / 255;
        const sb = (SCROLLBAR_BOTTOM_COLOR & 0xff) / 255;
        const rightEdgeW = Math.min(SCROLLBAR_WIDTH, EDGE_WIDTH);
        const rightInsetW = Math.min(Math.max(0, SCROLLBAR_WIDTH - rightEdgeW), EDGE_WIDTH);
        const bottomEdgeH = Math.min(thumbHeight, EDGE_HEIGHT);
        const bottomInsetH = Math.min(Math.max(0, thumbHeight - bottomEdgeH), EDGE_HEIGHT);
        if (rightEdgeW > 0) {
            glr.drawRect(x + SCROLLBAR_WIDTH - rightEdgeW, thumbTop, rightEdgeW, thumbHeight, [
                sr,
                sg,
                sb,
                1,
            ]);
        }
        if (rightInsetW > 0 && thumbHeight > topEdgeH) {
            glr.drawRect(
                x + SCROLLBAR_WIDTH - rightEdgeW - rightInsetW,
                thumbTop + topEdgeH,
                rightInsetW,
                thumbHeight - topEdgeH,
                [sr, sg, sb, 1],
            );
        }
        if (bottomEdgeH > 0) {
            glr.drawRect(x, thumbTop + thumbHeight - bottomEdgeH, SCROLLBAR_WIDTH, bottomEdgeH, [
                sr,
                sg,
                sb,
                1,
            ]);
        }
        if (bottomInsetH > 0 && SCROLLBAR_WIDTH > leftEdgeW) {
            glr.drawRect(
                x + leftEdgeW,
                thumbTop + thumbHeight - bottomEdgeH - bottomInsetH,
                SCROLLBAR_WIDTH - leftEdgeW,
                bottomInsetH,
                [sr, sg, sb, 1],
            );
        }
    }
}

// Item icons come from injected 3D renderer via opts.itemIconCanvas only.

export type GLRenderOpts = {
    spriteIndex: CacheIndex;
    fontLoader: (id: number) => BitmapFont | undefined;
    visible: Map<number, boolean>;
    debug: boolean;
    // When provided, always render debug devoverlay for this node and its descendants
    selectedUid?: number;
    hostW: number;
    hostH: number;
    // Optional: DOM canvas to attach input listeners to
    hostCanvas?: HTMLCanvasElement;
    rewardEnums?: { ids?: number[]; names?: string[] };
    itemIconCanvas?: (
        itemId: number,
        qty?: number,
        outline?: number,
        shadow?: number,
        quantityMode?: number,
    ) => HTMLCanvasElement | undefined;
    objLoader?: any;
    // Optional root render offset in canvas space (for game-area centering)
    rootOffsetX?: number;
    rootOffsetY?: number;
    // Optional root render scale (for matching login-style UI surface scaling)
    rootScale?: number;
    rootScaleX?: number;
    rootScaleY?: number;
    // Optional root-level clip rectangle in canvas space.
    // Used by WidgetsOverlay to redraw only dirty UI regions.
    rootClip?: ClipRect;
    // Optional game context (game client, player ECS, etc.)
    game?: any;
    // Access to cache for plugin-driven child loading
    getCacheSystem?: () => CacheSystem;
    widgetManager?: WidgetManager;
    // Optional: request a full repaint from the host overlay when any widget input mutates state.
    requestRepaintAll?: () => void;
    steelFrame?: {
        edges?: { top?: any; bottom?: any; left?: any; right?: any };
        corners?: { tl?: any; tr?: any; bl?: any; br?: any };
        close?: { url: string; w: number; h: number };
        divider?: { url: string; w: number; h: number };
        background?: { url: string };
    };
    scrollbarArrows?: { upUrl: string; downUrl: string };
    scrollbarDragger?: { url: string; w: number; h: number };
    // Generic model renderer for IF3 type-6 widgets
    renderModelCanvas?: (
        modelId: number,
        params: {
            xan2d?: number;
            yan2d?: number;
            zan2d?: number;
            zoom2d?: number;
            zoom3d?: number;
            offsetX2d?: number;
            offsetY2d?: number;
            orthographic?: boolean;
            widget?: any;
            sequenceId?: number;
            sequenceFrame?: number;
            depthTest?: boolean;
            // Lighting parameters
            ambient?: number;
            contrast?: number;
            lightX?: number;
            lightY?: number;
            lightZ?: number;
        },
        width: number,
        height: number,
    ) => { canvas: HTMLCanvasElement; offsetX: number; offsetY: number } | undefined;
    openGroup?: (groupId: number | string) => void;
    // Skip legacy GL hover/tooltip text. CS2 tooltip widgets remain rendered normally.
    skipTooltip?: boolean;
};

// Texture cache lives in a dedicated module now

export function renderWidgetTreeGL(glr: GLRenderer, root: Widget, opts: GLRenderOpts) {
    // PERF: Reset widget count for this render pass
    _widgetRenderCount = 0;
    const profileWidgetRender = profiler.enabled && profiler.verbose;
    const renderStartMs = profileWidgetRender ? performance.now() : 0;
    const drawCountersStart = profileWidgetRender ? glr.getPerfCounters() : null;
    let clickRegistrationMs = 0;
    let clickProbeMs = 0;
    let clickDeriveMs = 0;
    let clickRegisterMs = 0;
    let minimapMs = 0;
    let spriteMs = 0;
    let modelMs = 0;
    let textMs = 0;
    let rectMs = 0;
    let lineMs = 0;
    let containerMs = 0;
    let textWidgets = 0;
    let spriteWidgets = 0;
    let modelWidgets = 0;
    let minimapWidgets = 0;
    let interactiveWidgets = 0;
    let menuDeriveWidgets = 0;
    let menuEntriesTotal = 0;
    let modelCacheHits = 0;
    let modelCacheMisses = 0;

    // Use the actual GL drawable size for scissor computations so CSS layout and clipping stay aligned.
    const hostH = glr.height;

    // Layout runs in logical widget coordinates. The caller provides rootScaleX/rootScaleY
    // to project logical coords into buffer coordinates for drawing/hit registration.

    // PERF: Cache boundsByUid Map on canvas to avoid allocation each frame
    // Objects in the map are reused - we update in-place instead of creating new objects
    const canvasAny = glr.canvas as any;
    let boundsByUid: Map<number, { x: number; y: number; width: number; height: number }> =
        canvasAny.__boundsByUid;
    if (!boundsByUid) {
        boundsByUid = new Map();
        canvasAny.__boundsByUid = boundsByUid;
    }
    // Note: We don't clear the map - objects are reused via in-place updates
    // PERF: Cache TextureCache on canvas to avoid allocation each frame
    let tc: TextureCache = canvasAny.__textureCache;
    if (!tc) {
        tc = new TextureCache(glr, opts.spriteIndex, opts.itemIconCanvas);
        canvasAny.__textureCache = tc;
    }
    const widgetManager = opts.widgetManager;
    const widgetFlagsVersion = widgetManager?.getWidgetFlagsVersion?.() ?? 0;
    const widgetFlagsFrameCache = new Map<number, number>();
    const getCachedWidgetFlags = (w: any): number => {
        if (!widgetManager || !w) return ((w?.flags ?? 0) as number) | 0;
        const uid = typeof w.uid === "number" ? (w.uid | 0) : undefined;
        if (uid === undefined) {
            const flags = widgetManager.getWidgetFlags(w) | 0;
            w.__widgetFlagsVersion = widgetFlagsVersion | 0;
            return flags;
        }
        const cached = widgetFlagsFrameCache.get(uid);
        if (cached !== undefined) return cached;
        const flags = widgetManager.getWidgetFlags(w) | 0;
        widgetFlagsFrameCache.set(uid, flags);
        w.__widgetFlagsVersion = widgetFlagsVersion | 0;
        return flags;
    };
    const rootOffsetX = Number.isFinite(opts.rootOffsetX as number) ? Number(opts.rootOffsetX) : 0;
    const rootOffsetY = Number.isFinite(opts.rootOffsetY as number) ? Number(opts.rootOffsetY) : 0;
    const rootScaleXRaw = Number(opts.rootScaleX ?? opts.rootScale ?? 1.0);
    const rootScaleYRaw = Number(opts.rootScaleY ?? opts.rootScale ?? 1.0);
    const rootScaleX = Number.isFinite(rootScaleXRaw) && rootScaleXRaw > 0 ? rootScaleXRaw : 1.0;
    const rootScaleY = Number.isFinite(rootScaleYRaw) && rootScaleYRaw > 0 ? rootScaleYRaw : 1.0;

    // OSRS PARITY: The widget currently being clicked (Client.clickedWidget) is drawn semi-transparent.
    // Reference: UserComparator5.drawInterface: if (var10 == Client.clickedWidget && !var10.isScrollBar) { var14 = 128; }
    // Note: `clickedWidget` is a private TS field on OsrsClient but exists at runtime; read via `any`.
    const osrsClient = (opts.game as any)?.osrsClient as any;
    const clickedWidgetUid: number | null =
        typeof osrsClient?.clickedWidget?.uid === "number"
            ? ((osrsClient.clickedWidget.uid | 0) as number)
            : null;

    // PERF: Validate all dirty layouts in one pass before rendering
    // This avoids per-widget ensureLayout calls during tree traversal
    if (widgetManager) {
        widgetManager.validateAllLayouts();
    }
    const gl = glr.gl;
    gl.enable(gl.SCISSOR_TEST);

    // Optional root-level clip used for dirty-region redraws.
    const clipOpt = opts.rootClip;
    const clipX0 = Math.max(0, Math.min(glr.width, clipOpt?.x0 ?? 0));
    const clipY0 = Math.max(0, Math.min(glr.height, clipOpt?.y0 ?? 0));
    const clipX1 = Math.max(clipX0, Math.min(glr.width, clipOpt?.x1 ?? glr.width));
    const clipY1 = Math.max(clipY0, Math.min(glr.height, clipOpt?.y1 ?? glr.height));
    const clipW = Math.max(0, clipX1 - clipX0);
    const clipH = Math.max(0, clipY1 - clipY0);
    if (clipW <= 0 || clipH <= 0) {
        return;
    }
    // Use clip as initial scissor so draw calls outside dirty region are dropped by GL.
    gl.scissor(clipX0, hostH - clipY1, clipW, clipH);

    // UI state for interactions (per-canvas)
    const canvas = glr.canvas as HTMLCanvasElement & { __ui?: any };
    // Ensure GL canvas and host canvas share the same __ui object so world-menu + widget-menu interop works.
    try {
        const hc = (opts as any).hostCanvas as any;
        if (hc) {
            const hui = (hc.__ui = hc.__ui || canvas.__ui || {});
            canvas.__ui = hui;
        }
    } catch {}
    if (!canvas.__ui) canvas.__ui = {};
    const ui = canvas.__ui as {
        raf?: number | null;
        lastClick?: { x: number; y: number; consumer?: string };
        clickLogged?: boolean;
        onWidgetAction?: (ev: {
            widget: any;
            option: string;
            target?: string;
            source?: string;
            cursorX?: number;
            cursorY?: number;
            slot?: number;
            itemId?: number;
        }) => void;
        g4?: {
            barRect?: { x: number; y: number; w: number; h: number };
            trackRect?: { x: number; y: number; w: number; h: number };
            knobRect?: { x: number; y: number; w: number; h: number };
            contentRect?: { x: number; y: number; w: number; h: number };
            maxScroll?: number;
            container?: Widget;
        };
        // Aggregated roots for this draw pass (WidgetsOverlay renders multiple roots per frame).
        __widgetRoots?: any[];
        __widgetsGlPassActive?: boolean;
    };
    if (!ui.g4) ui.g4 = {};

    // Ensure per-canvas scroll registry and reset for this frame
    // Centralized input + registry
    // PERF: Use NOOP instead of inline closure - ensureInput ignores the callback anyway
    const input = ensureInput(glr, NOOP, (opts as any).hostCanvas);
    const clicks: any = input.getClicks();
    // Expose clicks registry to canvas for choose-option.ts hover detection
    (glr.canvas as any).__clicks = clicks;

    // OSRS-style: Set up visibility checker for hit testing.
    // This allows persisted click targets to be filtered at query time based on widget visibility,
    // matching OSRS behavior where the widget tree is traversed and hidden widgets are skipped.
    // Uses isEffectivelyHidden to check the full parent chain (hidden container = hidden children).
    if (widgetManager && typeof clicks.setWidgetHiddenChecker === "function") {
        clicks.setWidgetHiddenChecker((uid: number) => {
            return widgetManager.isEffectivelyHidden(uid);
        });
    }

    // Track roots in render order so the menu handler can pick the topmost root at the cursor.
    // WidgetsOverlay resets this once per frame before rendering all roots.
    // Keep root list unique so partial redraw passes don't accumulate duplicates.
    const widgetRoots = (ui.__widgetRoots = ui.__widgetRoots || []);
    if (!widgetRoots.includes(root as any)) {
        widgetRoots.push(root as any);
    }

    // Get InputManager from game client if available
    const inputManager = (opts.game as any)?.osrsClient?.inputManager;

    // Store inputManager on canvas so we can process input AFTER widgets are registered
    // (processInput is deferred to end of render so click targets exist)
    (glr.canvas as any).__pendingInputManager = inputManager;
    if (!inputManager) {
        // Log once if InputManager is not available
        const canvas = glr.canvas as any;
        if (!canvas.__warnedNoInputManager) {
            console.warn(
                "[widgets-gl] No InputManager found! opts.game=",
                opts.game,
                "osrsClient=",
                (opts.game as any)?.osrsClient,
            );
            canvas.__warnedNoInputManager = true;
        }
    }

    // Mirror pointer position into __ui for legacy consumers (e.g., Choose Option hover/cancel)
    try {
        const cAny: any = glr.canvas as any;
        const uii = (cAny.__ui = cAny.__ui || {});
        if (inputManager) {
            uii.mouseX = inputManager.mouseX;
            uii.mouseY = inputManager.mouseY;
        }
    } catch {}
    // Mirror UI state from host canvas so overlays can read entries set by the map renderer
    // (Handled above by sharing the same __ui object between canvases.)
    // Provide UIInput a handler to open a pinned Choose Option menu on right-click.
    // Priority: if a widget under the pointer has options, show widget entries; otherwise let the map supply world entries.
    try {
        // Expose the OsrsClient on the canvas so overlay helpers (e.g., Choose Option) can
        // close the underlying world menu state, preventing re-open loops.
        const osrsClientRef = (opts.game as any)?.osrsClient ?? null;
        (glr.canvas as any).__osrsClient = osrsClientRef;
        (glr as any).osrsClient = osrsClientRef;
        input.setMenuHandler((x: number, y: number) => {
            const canvas = glr.canvas as HTMLCanvasElement & { __ui?: any };
            const ui = (canvas.__ui = canvas.__ui || {});
            // OSRS parity: callback for static children lookup
            const getStaticChildren = osrsClientRef?.widgetManager
                ? (uid: number) => osrsClientRef.widgetManager.getStaticChildrenByParentUid(uid)
                : undefined;
            // OSRS parity: callback for InterfaceParent traversal (mounted sub-interfaces).
            // Mounted interfaces are separate widget trees rendered at the container's (x,y)
            // and clipped to the container bounds. They do NOT scroll with the container.
            const getInterfaceParentRoots = osrsClientRef?.widgetManager
                ? (containerUid: number) => {
                      const wm = osrsClientRef.widgetManager;
                      const group = wm.interfaceParents.get(containerUid)?.group;
                      return typeof group === "number" ? wm.getAllGroupRoots(group) : [];
                  }
                : undefined;
            const isInputCaptureWidget = osrsClientRef?.widgetManager
                ? (uid: number) => {
                      const wm = osrsClientRef.widgetManager;
                      const parent = wm.interfaceParents.get(uid);
                      return !!parent && (parent.type | 0) === 0;
                  }
                : undefined;
            const getByUid =
                osrsClientRef?.widgetManager &&
                typeof osrsClientRef.widgetManager.getWidgetByUid === "function"
                    ? (uid: number) => osrsClientRef.widgetManager.getWidgetByUid(uid)
                    : undefined;
            // OSRS parity: callback for widget flags lookup with IF_SETEVENTS overrides applied.
            // Reference: class405.getWidgetFlags uses (childIndex + (id << 32)) as key to Client.widgetFlags.
            // Without this callback, menu option visibility checks would only use base flags from cache,
            // missing runtime flag overrides from IF_SETEVENTS (e.g., equipment Remove action transmit flags).
            const getWidgetFlags =
                osrsClientRef?.widgetManager &&
                typeof osrsClientRef.widgetManager.getWidgetFlags === "function"
                    ? (w: any) => getCachedWidgetFlags(w)
                    : undefined;

            // Prefer the hovered click target (registered during render) as the menu anchor.
            // This avoids mismatches when interfaces are layered / mounted (InterfaceParents) and ensures
            // the menu targets exactly what the user right-clicked visually.
            try {
                const hover = clicks?.getHoverTarget?.();
                const hid: string | undefined = hover?.id;
                if (hid && hid.startsWith("widget:")) {
                    const uidNum = Number.parseInt(hid.slice("widget:".length), 10);
                    if (!Number.isNaN(uidNum) && getByUid) {
                        const w = getByUid(uidNum);
                        if (w && !(w as any).__dummyRoot) {
                            let candEntries: any[] = [];
                            let hasCustom = false;
                            try {
                                const fn = (ui as any).getWidgetMenuEntries;
                                if (typeof fn === "function") {
                                    candEntries = fn(w, x | 0, y | 0) || [];
                                    hasCustom = candEntries.length > 0;
                                }
                            } catch {}
                            try {
                                const base =
                                    UI_deriveMenuEntriesForWidget(
                                        w,
                                        hasCustom,
                                        getWidgetFlags,
                                        getByUid,
                                    ) || [];
                                // Widget menu entries are already in OSRS display order (top-to-bottom).
                                // Do not apply normalizeMenuEntries here; it expects OSRS insertion order and
                                // would reverse widget ops (e.g., minimap orbs).
                                candEntries = ([] as any[]).concat(candEntries, base);
                            } catch {}
                            const real = Array.isArray(candEntries)
                                ? candEntries.some((e: any) => {
                                      const lower = String(e?.option ?? "")
                                          .trim()
                                          .toLowerCase();
                                      return (
                                          !!lower &&
                                          lower !== "cancel" &&
                                          lower !== "examine" &&
                                          lower !== "inspect"
                                      );
                                  })
                                : false;
                            if (real) {
                                ui.mouseX = x | 0;
                                ui.mouseY = y | 0;
                                const { widgetEntriesToSimple } = require("../menu/MenuBridge");
                                const menuState = new MenuState();
                                const mapped = widgetEntriesToSimple(candEntries, {
                                    ui,
                                    chosenWidget: w,
                                    scheduleRender,
                                    menuState,
                                });
                                ui.menu = {
                                    open: true,
                                    follow: false,
                                    x: x | 0,
                                    y: y | 0,
                                    entries: mapped,
                                    targetWidget: w,
                                    source: "widgets",
                                    menuState,
                                } as any;
                                try {
                                    (ui as any).closeWorldMenu?.();
                                } catch {}
                                return;
                            }
                        }
                    }
                }
            } catch {}

            // Collect widgets at the click across ALL roots rendered this pass.
            // Root order matters: later roots are visually on top (WidgetsOverlay draw order).
            const roots = Array.isArray((ui as any).__widgetRoots)
                ? (ui as any).__widgetRoots
                : [root];
            const hits = UI_collectWidgetsAtPointAcrossRoots(
                roots as any[],
                x | 0,
                y | 0,
                opts.visible,
                getStaticChildren,
                getInterfaceParentRoots,
                isInputCaptureWidget,
            ).filter((h: any) => !h.__dummyRoot);
            let chosen: any | undefined;
            let entries: any[] = [];

            // Pick the most actionable widget by scanning from topmost back down
            for (let i = hits.length - 1; i >= 0; i--) {
                const candidate = hits[i];
                try {
                    const b = boundsByUid.get((candidate?.uid ?? -1) | 0);
                    if (b) {
                        candidate._absX = b.x | 0;
                        candidate._absY = b.y | 0;
                    }
                } catch {}
                // Try custom entries first
                let candEntries: any[] = [];
                let hasCustom = false;
                try {
                    const fn = (ui as any).getWidgetMenuEntries;
                    if (typeof fn === "function") {
                        candEntries = fn(candidate, x | 0, y | 0) || [];
                        hasCustom = candEntries.length > 0;
                    }
                } catch {}
                // Always merge in base entries derived from widget actions/verb
                // If custom entries exist, only add Cancel from base (not Examine)
                try {
                    const base =
                        UI_deriveMenuEntriesForWidget(
                            candidate,
                            hasCustom,
                            getWidgetFlags,
                            getByUid,
                        ) || [];
                    // Widget menu entries are already in OSRS display order (top-to-bottom).
                    // Do not apply normalizeMenuEntries here; it expects OSRS insertion order and
                    // would reverse widget ops (e.g., minimap orbs).
                    candEntries = ([] as any[]).concat(candEntries, base);
                } catch {}

                // Add spell-target entry if spell is selected and this is an inventory item
                if (ClientState.isSpellSelected) {
                    const itemId = candidate.itemId ?? -1;
                    const candidateGroupId = candidate.groupId ?? candidate.uid >>> 16;
                    const isInventoryItem = itemId >= 0 || candidateGroupId === 149;

                    if (isInventoryItem) {
                        // Get item name for target label
                        let itemName = candidate.name || candidate.text || "";
                        if (!itemName && itemId >= 0) {
                            // Try to get item name from definition
                            try {
                                const objLoader = (opts.game as any)?.osrsClient?.objLoader;
                                const itemDef = objLoader?.load?.(itemId);
                                itemName = itemDef?.name || `Item ${itemId}`;
                            } catch {
                                itemName = `Item ${itemId}`;
                            }
                        }

                        const itemTarget = itemName ? `<col=ff9040>${itemName}` : "";
                        // OSRS parity: spell-on-item entry uses selectedSpellActionName as the option
                        // and "selectedSpellName -> <col=ff9040>item" as target text.
                        const spellAction = ClientState.selectedSpellActionName || "Cast";
                        const spellName = ClientState.selectedSpellName || "";
                        const spellTarget =
                            spellName && itemTarget
                                ? `${spellName} -> ${itemTarget}`
                                : itemTarget || spellName;
                        const spellEntry = {
                            option: spellAction,
                            target: spellTarget,
                            widgetAction: {
                                slot: candidate.childIndex ?? candidate.uid & 0xffff,
                                itemId: itemId,
                            },
                        };

                        const explicitExamine = Array.isArray(candEntries)
                            ? candEntries.find(
                                  (e: any) =>
                                      String(e?.option ?? "")
                                          .trim()
                                          .toLowerCase() === "examine",
                              )
                            : undefined;

                        // Insert spell entry at the beginning (before Use, Drop, etc.)
                        candEntries = [
                            spellEntry,
                            ...candEntries.filter((e: any) => {
                                const lower = String(e?.option ?? "")
                                    .trim()
                                    .toLowerCase();
                                return lower !== "cancel" && lower !== "examine";
                            }),
                        ];
                        // Preserve explicit Examine if present on the base menu.
                        if (explicitExamine) {
                            candEntries.push({
                                option:
                                    typeof explicitExamine.option === "string"
                                        ? explicitExamine.option
                                        : "Examine",
                                target:
                                    typeof explicitExamine.target === "string"
                                        ? explicitExamine.target
                                        : itemTarget,
                            });
                        }
                        candEntries.push({ option: "Cancel" });
                    }
                }

                const real = Array.isArray(candEntries)
                    ? candEntries.some((e: any) => {
                          const lower = String(e?.option ?? "")
                              .trim()
                              .toLowerCase();
                          return (
                              !!lower &&
                              lower !== "cancel" &&
                              lower !== "examine" &&
                              lower !== "inspect"
                          );
                      })
                    : false;
                if (real) {
                    chosen = candidate;
                    entries = candEntries;
                    break;
                }
            }
            if (chosen && entries.length) {
                ui.mouseX = x | 0;
                ui.mouseY = y | 0;
                // Map entries using the shared bridge and central hooks
                const { widgetEntriesToSimple } = require("../menu/MenuBridge");
                const menuState = new MenuState();
                const mapped = widgetEntriesToSimple(entries, {
                    ui,
                    chosenWidget: chosen,
                    scheduleRender,
                    menuState,
                });
                ui.menu = {
                    open: true,
                    follow: false,
                    x: x | 0,
                    y: y | 0,
                    entries: mapped,
                    targetWidget: chosen,
                    source: "widgets",
                    menuState,
                } as any;
                try {
                    // Ensure any world menu state is closed so interaction sampling isn't locked
                    (ui as any).closeWorldMenu?.();
                } catch {}
                return;
            }
            // Otherwise, let the map renderer own pinned menu population (world options).
            // It will write to __ui.menu later in the frame.
        });
    } catch {}

    const scheduleRender = () => {
        if (ui.raf) return;
        ui.raf = requestAnimationFrame(() => {
            ui.raf = null;
            // When the host can repaint all roots (multi-modal), defer to it to avoid
            // clearing other layers. Otherwise, fall back to legacy single-root repaint.
            if (typeof opts.requestRepaintAll === "function") {
                try {
                    opts.requestRepaintAll();
                    return;
                } catch {}
            }
            glr.clear();
            renderWidgetTreeGL(glr, root, opts);
        });
    };

    // Back-compat hook: some overlays expect `requestRender`.
    const requestRender = scheduleRender;

    // PERF: Cache ScissorStack on canvas instead of creating new one each frame
    let sc: ScissorStack = canvasAny.__scissorStack;
    if (!sc) {
        sc = new ScissorStack(gl, glr.width, hostH, () => glr.flush());
        canvasAny.__scissorStack = sc;
    } else {
        sc.reinit(gl, glr.width, hostH, () => glr.flush());
    }

    // Helpers
    function findWidgetLocal(w: Widget, gid: number, fid: number): Widget | undefined {
        if (w.groupId === gid && w.fileId === fid) return w;
        // Check static children (via parentUid filtering - OSRS parity)
        const staticChildren = widgetManager?.getStaticChildrenByParentUid(w.uid) ?? [];
        for (const c of staticChildren) {
            if (c != null) {
                const r = findWidgetLocal(c, gid, fid);
                if (r) return r;
            }
        }
        // Check dynamic children
        if (w.children) {
            for (const c of w.children) {
                if (c != null) {
                    const r = findWidgetLocal(c, gid, fid);
                    if (r) return r;
                }
            }
        }
        return undefined;
    }

    function findWidgetByGroupFile(w: Widget, gid: number, fid: number): Widget | undefined {
        const viaManager = widgetManager?.findWidget(gid, fid);
        if (viaManager) return viaManager as Widget;
        return findWidgetLocal(w, gid, fid);
    }

    const g4ScrollContainer = root.groupId === 4 ? findWidgetByGroupFile(root, 4, 5) : undefined;

    function resolveIf1MousedOverWidgetUid(): number | null {
        if (osrsClient?.menuOpen || osrsClient?.dragSourceWidget) {
            return null;
        }

        const hoverTarget =
            typeof clicks?.getHoverTarget === "function" ? clicks.getHoverTarget() : null;
        const hoverId = typeof hoverTarget?.id === "string" ? hoverTarget.id : "";
        if (!hoverId.startsWith("widget:")) {
            return null;
        }

        const hoveredUid = Number.parseInt(hoverId.slice("widget:".length), 10);
        if (!Number.isFinite(hoveredUid)) {
            return null;
        }

        const hoveredWidget =
            widgetManager?.getWidgetByUid(hoveredUid) ??
            findWidgetByGroupFile(root, (hoveredUid >>> 16) & 0xffff, hoveredUid & 0xffff);
        if (!hoveredWidget || hoveredWidget.isIf3 !== false) {
            return null;
        }

        const mouseOverRedirect = (hoveredWidget.mouseOverRedirect ?? -1) | 0;
        const mouseOverColor = (hoveredWidget.mouseOverColor ?? 0) | 0;
        if (mouseOverRedirect < 0 && mouseOverColor === 0) {
            return null;
        }

        if (mouseOverRedirect >= 0) {
            const redirectWidget =
                widgetManager?.findWidget(hoveredWidget.groupId, mouseOverRedirect) ??
                findWidgetByGroupFile(root, hoveredWidget.groupId, mouseOverRedirect);
            return redirectWidget ? (redirectWidget.uid as number) | 0 : null;
        }

        return hoveredUid | 0;
    }

    const mousedOverIf1WidgetUid = resolveIf1MousedOverWidgetUid();

    // Generic steelborder renderer (title/close/divider options)
    // Prefer shared Frame9Slice helpers via plugins/components; no local wrappers here

    function drawWrappedTextGL(
        text: string,
        x: number,
        y: number,
        w: number,
        h: number,
        fontId: number,
        color: number,
        lineHeight = 12,
        shadow = true,
        yAlign: 0 | 1 | 2 = 1,
        xAlign: 0 | 1 | 2 = 1,
    ) {
        const inlineImageResolver = (imgId: number) => {
            const icon = tc.getSpriteCanvas("mod_icons", imgId | 0);
            if (!icon) return undefined;
            return { canvas: icon, width: icon.width, height: icon.height };
        };
        UI_drawWrappedTextGL(
            glr,
            opts.fontLoader,
            text,
            x,
            y,
            w,
            h,
            fontId,
            color,
            lineHeight,
            shadow,
            yAlign,
            xAlign,
            inlineImageResolver,
            rootScaleX,
            rootScaleY,
        );
    }

    function drawTextGL(
        text: string,
        x: number,
        y: number,
        w: number,
        h: number,
        fontId: number,
        color: number,
        xAlign = 0,
        yAlign = 0,
        shadow = false,
        alpha = 1,
    ) {
        const inlineImageResolver = (imgId: number) => {
            const icon = tc.getSpriteCanvas("mod_icons", imgId | 0);
            if (!icon) return undefined;
            return { canvas: icon, width: icon.width, height: icon.height };
        };
        UI_drawTextGL(
            glr,
            opts.fontLoader,
            text,
            x,
            y,
            w,
            h,
            fontId,
            color,
            xAlign,
            yAlign,
            shadow,
            alpha,
            inlineImageResolver,
            rootScaleX,
            rootScaleY,
        );
    }

    // Local wrap helper removed; prefer TextRenderer helpers if needed elsewhere

    function drawRichTextGL(
        text: string,
        x: number,
        y: number,
        w: number,
        h: number,
        fontId: number,
        defaultColor: number,
        xAlign = 0,
        yAlign = 0,
        shadow = false,
        highlightRegex?: RegExp,
        highlightColor?: number,
    ) {
        UI_drawRichTextGL(
            glr,
            opts.fontLoader,
            text,
            x,
            y,
            w,
            h,
            fontId,
            defaultColor,
            xAlign,
            yAlign,
            shadow,
            highlightRegex,
            highlightColor,
            rootScaleX,
            rootScaleY,
        );
    }

    // PERF: Cache debugRects array on canvas instead of creating new one each frame
    let debugRects: { x: number; y: number; w: number; h: number }[] = canvasAny.__debugRects;
    if (!debugRects) {
        debugRects = [];
        canvasAny.__debugRects = debugRects;
    } else {
        debugRects.length = 0; // Clear without reallocating
    }

    // OSRS parity: dragged widgets are rendered last (on top of other UI elements).
    // PERF: Cache deferredDragged array on canvas instead of creating new one each frame
    type DeferredDraggedEntry = {
        w: Widget;
        ox: number;
        oy: number;
        parentVisible: boolean;
        inSelected: boolean;
        clip: ClipRect;
    };
    let deferredDragged: DeferredDraggedEntry[] = canvasAny.__deferredDragged;
    if (!deferredDragged) {
        deferredDragged = [];
        canvasAny.__deferredDragged = deferredDragged;
    } else {
        deferredDragged.length = 0; // Clear without reallocating
    }

    // Initial clip bounds = full canvas
    // PERF: Cache fullClip object on canvas instead of creating new one each frame
    let fullClip: ClipRect = canvasAny.__fullClip;
    if (!fullClip) {
        fullClip = { x0: clipX0, y0: clipY0, x1: clipX1, y1: clipY1 };
        canvasAny.__fullClip = fullClip;
    } else {
        fullClip.x0 = clipX0;
        fullClip.y0 = clipY0;
        fullClip.x1 = clipX1;
        fullClip.y1 = clipY1;
    }

    // PERF: Cached click metadata map to avoid closure allocation per widget
    // Stored on canvas, objects are reused and updated in-place (not cleared)
    let clickMetaMap: Map<number, WidgetClickMeta> = canvasAny.__clickMetaMap;
    if (!clickMetaMap) {
        clickMetaMap = new Map();
        canvasAny.__clickMetaMap = clickMetaMap;
    }
    // Note: We don't clear clickMetaMap - objects are reused across frames

    // PERF: Cached click target objects to avoid allocation per widget per frame
    // These are reused and updated in-place
    let clickTargetCache: Map<number, CachedClickTarget> = canvasAny.__clickTargetCache;
    if (!clickTargetCache) {
        clickTargetCache = new Map();
        canvasAny.__clickTargetCache = clickTargetCache;
    }

    // PERF: Single click dispatcher function that looks up metadata by widget uid
    // Created once per render call (not per widget), captures ui/inputManager
    const widgetClickDispatcher = (clickX?: number, clickY?: number, targetId?: string) => {
        // Extract widget uid from the click target id (format: "widget:${uid}")
        if (!targetId) return;
        const uidStr = targetId.replace("widget:", "");
        const uid = parseInt(uidStr, 10);
        if (isNaN(uid)) return;

        const meta = clickMetaMap.get(uid);
        if (!meta) return;

        const hook = ui.onWidgetAction;
        if (typeof hook !== "function") {
            console.warn("[widgets-gl] No onWidgetAction hook set!");
            return;
        }

        try {
            // Check shift state at click time for shift-click drop
            const isShiftHeld = inputManager?.shiftDown === true;
            let actionOption = meta.option;

            // OSRS shift-click drop: if shift held and item has Drop action, use Drop
            if (isShiftHeld && meta.hasDropAction) {
                actionOption = "Drop";
            }

            hook({
                widget: meta.widget,
                option: actionOption,
                target: meta.target,
                source: "primary",
                cursorX: clickX,
                cursorY: clickY,
                slot: meta.slot,
                itemId: meta.itemId,
            });
        } catch (err) {
            console.warn("[widgets-gl] onClick dispatch failed", err);
        }
    };

    function getWidgetEventHandler(
        w: Widget | null | undefined,
        eventType: "onClick" | "onScroll" | "onHold" | "onDrag" | "onDragComplete",
    ): { intArgs?: number[] } | null {
        const handlers = (w as any)?.eventHandlers;
        if (handlers instanceof Map) {
            const handler = handlers.get(eventType);
            return handler && typeof handler === "object" ? handler : null;
        }
        if (handlers && typeof handlers === "object") {
            const handler = handlers[eventType];
            return handler && typeof handler === "object" ? handler : null;
        }
        return null;
    }

    function getScrollbarTargetUidFromHandler(
        parentUid: number,
        handler: { intArgs?: number[] } | null,
    ): number | null {
        const intArgs = handler?.intArgs;
        if (!Array.isArray(intArgs) || intArgs.length < 2) {
            return null;
        }
        const sourceUid = intArgs[0];
        const targetUid = intArgs[1];
        if (!Number.isFinite(sourceUid) || !Number.isFinite(targetUid)) {
            return null;
        }
        if ((sourceUid | 0) !== (parentUid | 0)) {
            return null;
        }
        const normalizedTargetUid = targetUid | 0;
        if (normalizedTargetUid <= 0 || normalizedTargetUid === (parentUid | 0)) {
            return null;
        }
        return normalizedTargetUid;
    }

    function inferScrollbarAxis(
        w: Widget,
        startArrow: Widget | null | undefined,
        endArrow: Widget | null | undefined,
    ): "x" | "y" | null {
        const explicitAxis = (w as any).scrollBarAxis;
        if (explicitAxis === "x" || explicitAxis === "y") {
            return explicitAxis;
        }

        const arrowWidth = Math.max(startArrow?.width ?? 0, endArrow?.width ?? 0);
        const arrowHeight = Math.max(startArrow?.height ?? 0, endArrow?.height ?? 0);
        if (arrowWidth > 0 || arrowHeight > 0) {
            if (arrowHeight === 16 && arrowWidth !== 16) {
                return "y";
            }
            if (arrowWidth === 16 && arrowHeight !== 16) {
                return "x";
            }
            if (arrowWidth > arrowHeight) {
                return "y";
            }
            if (arrowHeight > arrowWidth) {
                return "x";
            }
        }

        const width = w.width ?? 0;
        const height = w.height ?? 0;
        if (height > width) {
            return "y";
        }
        if (width > height) {
            return "x";
        }
        return null;
    }

    // CS2 scrollbar procs wire the parent scrollbar component and scroll target into
    // the child handlers they create, so recover the linkage from that child pattern.
    function resolveScrollbarLink(w: Widget): {
        targetUid: number;
        axis: "x" | "y";
    } | null {
        const anyW = w as any;
        if (typeof anyW.scrollBarTargetUid === "number") {
            return {
                targetUid: anyW.scrollBarTargetUid | 0,
                axis: (anyW.scrollBarAxis as "x" | "y" | undefined) ?? "y",
            };
        }

        const children = Array.isArray(w.children) ? w.children : null;
        if (!children || children.length < 6) {
            return null;
        }

        const track = children[0] as Widget | null | undefined;
        const dragger = children[1] as Widget | null | undefined;
        const startArrow = children[4] as Widget | null | undefined;
        const endArrow = children[5] as Widget | null | undefined;
        if (!track || !dragger || !startArrow || !endArrow) {
            return null;
        }

        const candidateTargets = [
            getScrollbarTargetUidFromHandler(w.uid, getWidgetEventHandler(track, "onClick")),
            getScrollbarTargetUidFromHandler(w.uid, getWidgetEventHandler(track, "onScroll")),
            getScrollbarTargetUidFromHandler(w.uid, getWidgetEventHandler(dragger, "onDrag")),
            getScrollbarTargetUidFromHandler(
                w.uid,
                getWidgetEventHandler(dragger, "onDragComplete"),
            ),
            getScrollbarTargetUidFromHandler(w.uid, getWidgetEventHandler(startArrow, "onHold")),
            getScrollbarTargetUidFromHandler(w.uid, getWidgetEventHandler(endArrow, "onHold")),
        ];

        let targetUid: number | null = null;
        let bestCount = 0;
        const counts = new Map<number, number>();
        for (const candidate of candidateTargets) {
            if (candidate === null) {
                continue;
            }
            const count = (counts.get(candidate) ?? 0) + 1;
            counts.set(candidate, count);
            if (count > bestCount) {
                bestCount = count;
                targetUid = candidate;
            }
        }
        if (targetUid === null || bestCount < 2) {
            return null;
        }

        const axis = inferScrollbarAxis(w, startArrow, endArrow);
        if (!axis) {
            return null;
        }

        return { targetUid, axis };
    }

    /**
     * OSRS PARITY: Check if widget is hidden.
     * Reference: class59.isComponentHidden - just returns var0.isHidden
     *
     * Note: Parent visibility propagates naturally through the recursive rendering -
     * if a parent is hidden, drawNode returns early and children are never visited.
     * This matches OSRS behavior where isComponentHidden doesn't recurse.
     */
    function isComponentHidden(w: Widget): boolean {
        // OSRS PARITY: Only check this widget's visibility, not parents
        // Reference: class59.java line 828: return var0.isHidden
        if (opts.visible.get(w.uid) === false) return true;
        if (w.hidden) return true;

        // OSRS PARITY: Auto-hide CS2 scrollbars when their linked scroll target
        // has no scrollable range (maxScroll <= 0).
        const scrollbarLink = widgetManager ? resolveScrollbarLink(w) : null;
        if (scrollbarLink && widgetManager) {
            const target = widgetManager.getWidgetByUid(scrollbarLink.targetUid);
            if (target) {
                widgetManager.ensureLayout(target);
                const maxScroll =
                    scrollbarLink.axis === "x"
                        ? Math.max(0, (target.scrollWidth ?? 0) - (target.width ?? 0))
                        : Math.max(0, (target.scrollHeight ?? 0) - (target.height ?? 0));
                if (maxScroll <= 0) return true;
            }
        }

        return false;
    }

    function drawNode(
        w: Widget,
        ox: number,
        oy: number,
        parentVisible: boolean,
        inSelected: boolean,
        clip: ClipRect = fullClip,
        deferDragged: boolean = true,
    ) {
        // OSRS PARITY: contentType-driven widget mutations applied during draw.
        // Reference: class326.method6261 (called from UserComparator5.drawInterface when contentType > 0).
        try {
            const ct = ((w.contentType ?? 0) | 0) as number;
            if (ct === 324 || ct === 325) {
                // OSRS parity: gender toggle sprites depend on Client.playerAppearance.gender.
                // Reference: class326.method6261 for contentType 324/325.
                // PlayerDesign can be shown before a world player exists; use the CS2 varbit mirror.
                // varbit 14021 (player_design_bodytype) is set to gender (0/1) by the client.
                let gender = 0;
                try {
                    gender =
                        (osrsClient?.varManager?.getVarbit?.(14021) ??
                            (() => {
                                const idx = osrsClient?.playerEcs?.getIndexForServerId?.(
                                    osrsClient?.controlledPlayerServerId,
                                );
                                const ap =
                                    idx !== undefined
                                        ? osrsClient?.playerEcs?.getAppearance?.(idx)
                                        : null;
                                return typeof ap?.gender === "number" ? ap.gender | 0 : 0;
                            })()) & 1;
                } catch {
                    gender = 0;
                }

                // Cache the original sprite IDs once (like Client.field736/field787).
                const anyClient = osrsClient as any;
                if (anyClient) {
                    if (
                        !Number.isFinite(anyClient.__pdSpriteA) ||
                        !Number.isFinite(anyClient.__pdSpriteB)
                    ) {
                        anyClient.__pdSpriteA =
                            typeof w.spriteId === "number" ? w.spriteId | 0 : -1;
                        anyClient.__pdSpriteB =
                            typeof w.spriteId2 === "number" ? w.spriteId2 | 0 : -1;
                    }
                    const spriteA = (anyClient.__pdSpriteA as number) | 0;
                    const spriteB = (anyClient.__pdSpriteB as number) | 0;
                    if (spriteA >= 0 && spriteB >= 0) {
                        if (ct === 324) {
                            w.spriteId = gender === 1 ? spriteA : spriteB;
                        } else {
                            w.spriteId = gender === 1 ? spriteB : spriteA;
                        }
                    }
                }
            }
            if (ct === 327 || ct === 328) {
                // Reference: class326.method6261
                const cycleCntr = ((osrsClient?.transmitCycles?.cycleCntr ?? 0) | 0) as number;
                const angleX = 150;
                const angleY = ((Math.sin(cycleCntr / 40.0) * 256.0) | 0) & 2047;
                const angleZ = 0;
                (w as any).modelAngleX = angleX;
                (w as any).modelAngleY = angleY;
                (w as any).modelAngleZ = angleZ;
                (w as any).rotationX = angleX;
                (w as any).rotationY = angleY;
                (w as any).rotationZ = angleZ;
                // modelType=5, modelId=0 (playerAppearance) for 327; modelId=1 (localPlayer) for 328
                (w as any).modelType = 5;
                (w as any).modelId = ct === 327 ? 0 : 1;
            }
        } catch {}

        // OSRS PARITY: Determine if this is an IF3 widget
        // Default to IF3 (modern) if not specified
        const isIf3 = w.isIf3 !== false;

        // OSRS PARITY: Check widget visibility
        // Reference: UserComparator5.java line 88: if (!var10.isIf3 || !class59.isComponentHidden(var10))
        // IF1 widgets: Always enter the render block (visibility checked later for containers)
        // IF3 widgets: Skip if hidden
        if (isIf3 && isComponentHidden(w)) {
            return;
        }

        // Parent visible tracking for rendering context
        const selfVisible = opts.visible.get(w.uid) !== false && !w.hidden;
        const eff = parentVisible && selfVisible;

        if (!eff) {
            return;
        }

        // PERF: Count widgets being rendered
        _widgetRenderCount++;

        // OSRS PARITY: Ensure layout is valid before reading computed dimensions
        // CS2 scripts (like quest tab) may have modified rawWidth/rawHeight via CC_SETSIZE,
        // invalidating the widget. This JIT validation ensures width/height are up-to-date.
        // Check for falsy (false or undefined) since initial state may be undefined
        if (widgetManager && !w.isLayoutValid) {
            widgetManager.ensureLayout(w);
        }

        // Compute widget position and size in buffer coordinates
        // For widgets being dragged with dragRenderBehaviour=1, use visual position
        const isDragActive = !!(w as any)._isDragActive;
        const isClickedWidget =
            clickedWidgetUid !== null && ((w.uid as number) | 0) === clickedWidgetUid;
        const rawVisualX = isDragActive ? (w as any)._dragVisualX ?? w.x : w.x;
        const rawVisualY = isDragActive ? (w as any)._dragVisualY ?? w.y : w.y;
        const visualX = isDragActive
            ? Math.round((Number(rawVisualX) || 0) / rootScaleX)
            : rawVisualX | 0;
        const visualY = isDragActive
            ? Math.round((Number(rawVisualY) || 0) / rootScaleY)
            : rawVisualY | 0;
        const logicalX = ox + visualX;
        const logicalY = oy + visualY;
        const logicalWidth = Math.max(1, w.width | 0);
        const logicalHeight = Math.max(1, w.height | 0);
        // Use consistent rounded edges to avoid 1px overlap/gap jitter at fractional scales.
        const x = Math.round(logicalX * rootScaleX + rootOffsetX);
        const y = Math.round(logicalY * rootScaleY + rootOffsetY);
        const x1 = Math.round((logicalX + logicalWidth) * rootScaleX + rootOffsetX);
        const y1 = Math.round((logicalY + logicalHeight) * rootScaleY + rootOffsetY);
        const width = Math.max(1, x1 - x);
        const height = Math.max(1, y1 - y);
        const isContainer = w.type === 0 || w.type === 11;
        const staticChildren = isContainer
            ? (widgetManager?.getStaticChildrenByParentUid(w.uid) ?? EMPTY_WIDGETS)
            : EMPTY_WIDGETS;
        const hasStaticChildren = staticChildren.length > 0;
        const hasChildren = !!(w.children && w.children.length);

        // OSRS PARITY: Calculate widget clip bounds based on widget type
        // Reference: UserComparator5.drawInterface lines 142-170
        // Type 9 (Line) widgets have special clip calculation for negative dimensions
        let widgetClip: ClipRect;
        if (w.type === 9) {
            // Type 9 lines can have negative dimensions
            widgetClip = calculateType9Clip(clip, x, y, width, height);
        } else {
            widgetClip = calculateStandardClip(clip, x, y, width, height);
        }

        // OSRS PARITY: Early cull check based on clip validity
        // Reference: UserComparator5.drawInterface line 172: if (!var10.isIf3 || var15 < var17 && var16 < var18)
        // IF3 widgets: only render if clip has positive area (var15 < var17 && var16 < var18)
        // IF1 widgets: always render (legacy behavior, even with invalid clip - clipping handled by scissor)
        //
        // IMPORTANT: Containers (type 0/11) with children should NOT be early-culled, because
        // their children may extend beyond the container's own bounds (e.g., scroll content).
        // The children themselves will be individually culled based on their own bounds.
        //
        // IMPORTANT: Actively dragged widgets should NOT be culled - they need to be deferred
        // for rendering on top, even when dragged outside their parent's clip bounds.
        const isContainerWithChildren = isContainer && (hasChildren || hasStaticChildren);
        if (isIf3 && !isClipValid(widgetClip) && !isContainerWithChildren && !isDragActive) {
            return; // IF3 widget is completely outside visible area and has no children
        }
        // Note: IF1 widgets are NOT culled here - they rely on scissor clipping only.

        // Record canvas-space bounds for this node
        // OSRS PARITY: Store absolute position on widget for drag operations
        // Reference: WorldMapRegion.java lines 1613-1616 where field688/field689 are set
        // during widget tree traversal when the widget is the clickedWidgetParent
        try {
            const uidNum = (w.uid as number) | 0;
            // PERF: Reuse existing bounds object if present, otherwise create new one
            let bounds = boundsByUid.get(uidNum);
            if (bounds) {
                bounds.x = x;
                bounds.y = y;
                bounds.width = width;
                bounds.height = height;
            } else {
                boundsByUid.set(uidNum, { x, y, width, height });
            }
            // Store absolute position on widget for drag coordinate calculations
            w._absX = x;
            w._absY = y;
            (w as any)._absLogicalX = logicalX;
            (w as any)._absLogicalY = logicalY;
        } catch {}

        // OSRS parity: draw dragged widget last so it appears above everything else.
        // Preserve clip/offset so it still respects the same scissor bounds.
        // IMPORTANT: Scrollbar widgets (dragRenderBehaviour=1) should NOT be deferred.
        // They must render inline to maintain proper z-order with sibling sprites
        // (the top/bottom cap decorations are positioned relative to the dragger).
        // Only inventory-style widgets (dragRenderBehaviour >= 2) need deferral.
        const dragBehaviour = (w as any).dragRenderBehaviour ?? 2;
        if (deferDragged && isDragActive && dragBehaviour !== 1) {
            deferredDragged.push({ w, ox, oy, parentVisible, inSelected, clip });
            return;
        }
        // Check if this widget is the selected item (for "Use" outline)
        // In OSRS, selected items get a white pixel-perfect outline
        let isSelectedHere = false;
        if (ClientState.isItemSelected === 1) {
            // Primary check: exact UID match (for static widgets)
            if (w.uid === ClientState.selectedItemWidget) {
                isSelectedHere = true;
            }
            // Secondary check: for dynamic children created by CC_CREATE
            // Dynamic children have parentUid storing the container widget's UID,
            // and childIndex storing their slot position within the container.
            // selectedItemWidget = container widget UID, selectedItemSlot = slot index
            else if (
                (w as any).parentUid === ClientState.selectedItemWidget &&
                (w as any).childIndex === ClientState.selectedItemSlot
            ) {
                isSelectedHere = true;
            }
            // Tertiary check: match on group + slot for inventory containers
            // Widget UID is (groupId << 16) | childId format
            else {
                const widgetGroup = (w.uid >>> 16) & 0xffff;
                const selectedGroup = (ClientState.selectedItemWidget >>> 16) & 0xffff;
                const widgetChildIndex = (w as any).childIndex ?? w.uid & 0xffff;
                if (
                    widgetGroup === selectedGroup &&
                    widgetChildIndex === ClientState.selectedItemSlot
                ) {
                    isSelectedHere = true;
                }
            }
        }

        // Default click target registration based on widget actions/verb OR CS2 event handlers
        const clickRegistrationStartMs = profileWidgetRender ? performance.now() : 0;
        try {
            const clickProbeStartMs = profileWidgetRender ? performance.now() : 0;
            const interaction = getWidgetInteractionSnapshot(
                w as any,
                getCachedWidgetFlags,
                widgetFlagsVersion,
            );
            const widgetActions = Array.isArray(w.actions) ? (w.actions as any[]) : undefined;
            const widgetItemId = (w as any).itemId;
            if (profileWidgetRender) {
                clickProbeMs += performance.now() - clickProbeStartMs;
            }
            if (interaction.shouldDeriveEntries) {
                menuDeriveWidgets++;
            }

            // OSRS parity: Use widgetManager.getWidgetFlags for IF_SETEVENTS override lookup.
            // Without this, equipment slots won't show "Remove" if flags are only set via IF_SETEVENTS.
            const getWidgetFlagsLocal = widgetManager ? getCachedWidgetFlags : undefined;
            const clickDeriveStartMs = profileWidgetRender ? performance.now() : 0;
            const entries = interaction.shouldDeriveEntries
                ? deriveMenuEntriesForWidgetCached(w as any, getWidgetFlagsLocal)
                : [];
            if (profileWidgetRender) {
                clickDeriveMs += performance.now() - clickDeriveStartMs;
            }
            menuEntriesTotal += entries.length | 0;
            const primary = entries.find((e) => {
                const lower = String(e?.option ?? "")
                    .trim()
                    .toLowerCase();
                return !!lower && lower !== "cancel" && lower !== "examine";
            });

            if (
                primary ||
                interaction.hasCs2Click ||
                interaction.hasActions ||
                interaction.hasOriginalHandlers ||
                interaction.isInventoryItem ||
                interaction.isPauseButtonWidget ||
                interaction.hasButtonTypeInteraction
            ) {
                const clickRegisterStartMs = profileWidgetRender ? performance.now() : 0;
                interactiveWidgets++;
                let primaryOptionText = primary?.option ?? "";
                let primaryTarget = primary?.target;

                // For inventory items, use the widget's actions array to find the primary action
                // The CS2 scripts set actions on inventory widgets from the item definition
                // We need to find the first non-empty, non-Drop, non-Examine action
                if (interaction.isInventoryItem && widgetActions) {
                    const itemWidgetActions = widgetActions as (string | null | undefined)[];
                    const hasNonUseAction = widgetActions.some((action) => {
                        if (!action || typeof action !== "string") return false;
                        const lower = action.trim().toLowerCase();
                        if (!lower) return false;
                        return (
                            lower !== "use" &&
                            lower !== "drop" &&
                            lower !== "examine" &&
                            lower !== "cancel"
                        );
                    });
                    for (let i = 0; i < itemWidgetActions.length; i++) {
                        const action = itemWidgetActions[i];
                        if (!action || typeof action !== "string") continue;
                        const trimmed = action.trim();
                        if (!trimmed) continue;
                        const lower = trimmed.toLowerCase();
                        if (lower === "drop" || lower === "examine" || lower === "cancel") continue;
                        if (hasNonUseAction && lower === "use") continue;
                        primaryOptionText = trimmed;
                        break;
                    }
                }

                // OSRS parity: Pause button widgets show "Continue" with empty target
                // Reference: WorldMapSprite.java line 128-129
                if (interaction.isPauseButtonWidget && !primaryOptionText) {
                    primaryOptionText = "Continue";
                    primaryTarget = undefined;
                }

                // Check if widget has a Drop action (for shift-click drop)
                const hasDropAction =
                    interaction.isInventoryItem &&
                    !!widgetActions &&
                    widgetActions.some(
                        (a: any) => a && typeof a === "string" && a.trim().toLowerCase() === "drop",
                    );

                // PERF: Update cached metadata object in-place instead of creating new
                const slot =
                    typeof (w as any).childIndex === "number"
                        ? (w as any).childIndex | 0
                        : undefined;
                const itemId = typeof widgetItemId === "number" ? widgetItemId | 0 : undefined;

                let meta = clickMetaMap.get(w.uid);
                if (!meta) {
                    meta = {
                        widget: w,
                        option: primaryOptionText,
                        target: primaryTarget,
                        hasDropAction,
                        itemId,
                        slot,
                    };
                    clickMetaMap.set(w.uid, meta);
                } else {
                    meta.widget = w;
                    meta.option = primaryOptionText;
                    meta.target = primaryTarget;
                    meta.hasDropAction = hasDropAction;
                    meta.itemId = itemId;
                    meta.slot = slot;
                }

                // PERF: Get or create cached click target, update in-place
                // OSRS-style: persist=true for performance, visibility checked at query time via widgetUid
                let target = clickTargetCache.get(w.uid);
                if (!target) {
                    const newTarget: CachedClickTarget = {
                        id: `widget:${w.uid}`,
                        rect: { x, y, w: width, h: height },
                        priority: 100,
                        hoverText: primaryOptionText,
                        primaryOption:
                            primaryOptionText || primaryTarget
                                ? { option: primaryOptionText, target: primaryTarget }
                                : undefined,
                        menuOptionsCount: entries.length | 0,
                        persist: true, // OSRS-style: persist for perf, visibility checked at query time
                        widgetUid: w.uid, // For OSRS-style visibility filtering during hit testing
                    };
                    clickTargetCache.set(w.uid, newTarget);
                    target = newTarget;
                } else {
                    // Update rect in-place
                    target.rect.x = x;
                    target.rect.y = y;
                    target.rect.w = width;
                    target.rect.h = height;
                    target.hoverText = primaryOptionText;
                    // OSRS parity: left-click primary actions are handled by OsrsClient.handleUiInput,
                    // not by the GL click registry. Ensure any previously-set handlers are cleared.
                    target.onDown = undefined;
                    target.onClick = undefined;
                    // Update primaryOption in-place if it exists, create if needed
                    if (primaryOptionText || primaryTarget) {
                        if (!target.primaryOption) {
                            target.primaryOption = {
                                option: primaryOptionText,
                                target: primaryTarget,
                            };
                        } else {
                            target.primaryOption.option = primaryOptionText;
                            target.primaryOption.target = primaryTarget;
                        }
                    } else {
                        target.primaryOption = undefined;
                    }
                    target.menuOptionsCount = entries.length | 0;
                }

                clicks.register(target);

                // Debug: draw purple outline for clickable areas
                if (DEBUG_CLICK_AREAS) {
                    const purple = [0.8, 0.2, 0.8, 1.0] as [number, number, number, number];
                    // Top edge
                    glr.drawRect(x, y, width, 1, purple);
                    // Bottom edge
                    glr.drawRect(x, y + height - 1, width, 1, purple);
                    // Left edge
                    glr.drawRect(x, y, 1, height, purple);
                    // Right edge
                    glr.drawRect(x + width - 1, y, 1, height, purple);
                }
                if (profileWidgetRender) {
                    clickRegisterMs += performance.now() - clickRegisterStartMs;
                }
            } else if (ClientState.isSpellSelected || ClientState.isItemSelected === 1) {
                const clickRegisterStartMs = profileWidgetRender ? performance.now() : 0;
                // Widget has no options, but there's an active spell/item selection.
                // Register a click target so clicking this widget cancels the selection.
                // This matches OSRS behavior where clicking on widgets without valid
                // targeting options cancels spell/item selection.
                // PERF: Reuse cached click target object, update in-place
                // OSRS-style: persist=true for performance, visibility checked at query time via widgetUid
                let target = clickTargetCache.get(w.uid);
                if (!target) {
                    const newTarget: CachedClickTarget = {
                        id: `widget:${w.uid}`,
                        rect: { x, y, w: width, h: height },
                        priority: 50,
                        hoverText: undefined,
                        primaryOption: undefined,
                        onClick: CANCEL_SELECTION_HANDLER,
                        persist: true, // OSRS-style: persist for perf, visibility checked at query time
                        widgetUid: w.uid, // For OSRS-style visibility filtering during hit testing
                    };
                    clickTargetCache.set(w.uid, newTarget);
                    target = newTarget;
                } else {
                    target.rect.x = x;
                    target.rect.y = y;
                    target.rect.w = width;
                    target.rect.h = height;
                    target.priority = 50;
                    target.hoverText = undefined;
                    target.primaryOption = undefined;
                    target.onClick = CANCEL_SELECTION_HANDLER;
                }
                clicks.register(target);
                if (profileWidgetRender) {
                    clickRegisterMs += performance.now() - clickRegisterStartMs;
                }
            }
        } catch {}
        if (profileWidgetRender) {
            clickRegistrationMs += performance.now() - clickRegistrationStartMs;
        }

        // OSRS PARITY: Auto-scroll clamping for IF1 containers only
        // Reference: UserComparator5.java lines 231-238
        // IF3 widgets handle scroll bounds via CS2 scripts, IF1 clamps automatically
        if (w.type === 0 && !isIf3) {
            const scrollH = w.scrollHeight ?? 0;
            const prevScrollY = w.scrollY ?? 0;
            if ((w.scrollY || 0) > scrollH - w.height) {
                w.scrollY = scrollH - w.height;
            }
            if ((w.scrollY || 0) < 0) {
                w.scrollY = 0;
            }
        }

        // OSRS PARITY: IF1 type 0 containers draw scrollbar when scrollHeight > height
        // Reference: UserComparator5.java lines 267-269
        // Scrollbar is drawn on the right edge of the container
        if (w.type === 0 && !isIf3 && (w.scrollHeight ?? 0) > logicalHeight) {
            drawScrollBar(
                glr,
                x + width, // scrollbar is drawn at the right edge (x + width)
                y,
                Math.round((w.scrollY ?? 0) * rootScaleY),
                height,
                Math.max(1, Math.round((w.scrollHeight ?? 0) * rootScaleY)),
                tc,
                opts,
                rootScaleX,
                rootScaleY,
            );
        }

        // Check if this widget is being hovered (for hover state rendering)
        const widgetUid = (w.uid as number) | 0;
        const widgetHoverId = `widget:${w.uid}`;
        const isWidgetHovered = isIf3
            ? clicks?.isHover?.(widgetHoverId) ?? false
            : mousedOverIf1WidgetUid === widgetUid;

        // OSRS PARITY: Special handling for compass widget (contentType 1339)
        // Reference: UserComparator5.java - compass is rendered before type-based logic
        // class520.method9265 draws WallDecoration.compass with camera yaw rotation and circular mask
        const contentType = (w as any).contentType ?? 0;
        if (contentType === 1339) {
            const compassSpriteId = opts.widgetManager?.compassSpriteId ?? -1;
            if (compassSpriteId >= 0) {
                const compassTex = tc.getSpriteById(compassSpriteId);
                if (compassTex) {
                    // Get rotation from spriteAngle (set by updateCompassAngle based on camera yaw)
                    // spriteAngle is in 16-bit format (0-65536 = 360 degrees)
                    const spriteAngle = w.spriteAngle ?? 0;

                    // OSRS PARITY: The widget's primary sprite defines the circular mask.
                    // Reference: Widget.ac(..., false) uses spriteId.
                    const maskSpriteId = w.spriteId ?? -1;
                    const maskTex = maskSpriteId >= 0 ? tc.getSpriteById(maskSpriteId) : null;

                    if (maskTex) {
                        // Draw compass with circular mask
                        glr.drawTextureRotatedMasked(
                            compassTex,
                            maskTex,
                            x,
                            y,
                            width,
                            height,
                            spriteAngle,
                            65536,
                        );
                    } else {
                        // Fallback: draw without mask
                        glr.drawTextureRotated(
                            compassTex,
                            x,
                            y,
                            width,
                            height,
                            spriteAngle,
                            65536,
                            0,
                            [0, 0, 0],
                            1,
                        );
                    }
                }
            }
            // Skip normal type-based rendering for compass (OSRS uses continue)
            // But still need to traverse children, so don't return here
        }

        // OSRS PARITY: Special handling for minimap widget (contentType 1338)
        // Reference: SecureUrlRequester.java drawMinimap() - uses localPlayer position, NOT camera
        // WebGL-based rendering for better mobile performance
        if (contentType === 1338) {
            const minimapStartMs = profileWidgetRender ? performance.now() : 0;
            minimapWidgets++;
            glr.flush();
            const osrsClient = (opts.game as any)?.osrsClient;
            if (osrsClient && osrsClient.camera) {
                const localPlayerId = osrsClient.controlledPlayerServerId | 0;
                const playerState = osrsClient.playerMovementSync?.getState?.(localPlayerId);

                // Get or create MinimapRenderer instance (cached on canvas)
                const canvasAny = glr.canvas as any;
                let minimapRenderer: MinimapRenderer = canvasAny.__minimapRenderer;
                if (!minimapRenderer) {
                    minimapRenderer = new MinimapRenderer(glr.gl, glr.proj);
                    canvasAny.__minimapRenderer = minimapRenderer;
                }
                minimapRenderer.updateProj(glr.proj);

                if (playerState) {
                    // Get interpolated player position from ECS
                    const playerEcs = osrsClient.playerEcs;
                    const playerIdx = playerEcs?.getIndexForServerId?.(localPlayerId);

                    let playerFineX: number;
                    let playerFineY: number;

                    if (playerIdx !== undefined && playerIdx >= 0) {
                        playerFineX = playerEcs.getX(playerIdx) | 0;
                        playerFineY = playerEcs.getY(playerIdx) | 0;
                    } else {
                        const rawSubX = (playerState.subX ?? 64) | 0;
                        const rawSubY = (playerState.subY ?? 64) | 0;
                        const subX = rawSubX & 127;
                        const subY = rawSubY & 127;
                        playerFineX = ((playerState.tileX | 0) << 7) + subX;
                        playerFineY = ((playerState.tileY | 0) << 7) + subY;
                    }

                    const playerTileX = playerFineX >> 7;
                    const playerTileY = playerFineY >> 7;
                    const subX = playerFineX & 127;
                    const subY = playerFineY & 127;
                    const worldX = playerTileX + (subX - 64) / 128;
                    const worldY = playerTileY + (subY - 64) / 128;

                    const cameraYaw = osrsClient.camera.yaw ?? 0;
                    const minimapZoom = osrsClient.minimapZoom ?? 4;
                    const zoomScale = minimapZoom / 4.0;

                    const cameraMapX = playerTileX >> 6;
                    const cameraMapY = playerTileY >> 6;
                    const localTileX = playerTileX & 63;
                    const localTileY = playerTileY & 63;
                    const subTileX = worldX - playerTileX;
                    const subTileY = worldY - playerTileY;

                    // Minimap center and radius
                    const centerX = x + width / 2;
                    const centerY = y + height / 2;
                    const radius = Math.min(width, height) / 2;

                    // Begin WebGL minimap rendering
                    minimapRenderer.begin(centerX, centerY, radius, cameraYaw, zoomScale);

                    // Get the base path for map images
                    const cacheName = osrsClient.loadedCache?.info?.name;
                    const mapImageBasePath = cacheName ? `/map-images/${cacheName}` : "/map-images";

                    // Draw 3x3 grid of map tiles
                    // Each tile is 64 tiles = 256 minimap pixels at 4px/tile
                    const TILE_SIZE = 256;
                    const playerOffsetX = (localTileX + subTileX) * 4;
                    const playerOffsetY = (localTileY + subTileY) * 4;

                    for (let mx = 0; mx < 3; mx++) {
                        for (let my = 0; my < 3; my++) {
                            const mapX = cameraMapX - 1 + mx;
                            const mapY = cameraMapY - 1 + my;
                            const url = `${mapImageBasePath}/${mapX}_${mapY}.png`;

                            // Get or trigger load of map tile texture
                            const tileTex = tc.getTextureFromUrl(url);
                            if (!tileTex) continue;

                            // Position relative to player (in minimap pixels)
                            // mx=0 is west, mx=2 is east; my=0 is south, my=2 is north
                            // Formula derived from original: tileY = 512 - my*256 + offsetY - ROTATION_CENTER
                            const relX = (mx - 1) * TILE_SIZE - playerOffsetX;
                            const relY = -my * TILE_SIZE + playerOffsetY;

                            minimapRenderer.drawTile(tileTex, relX, relY, TILE_SIZE);
                        }
                    }

                    // Get dot sprites as WebGL textures (using name token lookup)
                    const itemDotTex = tc.getByNameToken("mapdots,0");
                    const npcDotTex = tc.getByNameToken("mapdots,1");
                    const playerDotTex = tc.getByNameToken("mapdots,2");

                    // Fallback: create simple colored textures if sprites not found
                    const getOrCreateDotTex = (key: string, color: [number, number, number]) => {
                        let tex = glr.getTexture(key);
                        if (!tex) {
                            const canvas = document.createElement("canvas");
                            canvas.width = 4;
                            canvas.height = 5;
                            const ctx = canvas.getContext("2d")!;
                            ctx.fillStyle = `rgb(${color[0] * 255},${color[1] * 255},${
                                color[2] * 255
                            })`;
                            ctx.fillRect(0, 0, 4, 5);
                            tex = glr.createTextureFromCanvas(key, canvas);
                        }
                        return tex;
                    };

                    const itemDot = itemDotTex ?? getOrCreateDotTex("__dot_item", [1, 0, 0]);
                    const npcDot = npcDotTex ?? getOrCreateDotTex("__dot_npc", [1, 1, 0]);
                    const playerDot = playerDotTex ?? getOrCreateDotTex("__dot_player", [1, 1, 1]);

                    // Draw other players as white dots
                    const otherPlayerEcs = osrsClient.playerEcs;
                    if (otherPlayerEcs?.getAllServerIds && playerDot) {
                        for (const otherId of otherPlayerEcs.getAllServerIds()) {
                            if (otherId === localPlayerId) continue;

                            const ecsIdx = otherPlayerEcs.getIndexForServerId?.(otherId);
                            if (ecsIdx === undefined || ecsIdx < 0) continue;

                            const fineX = otherPlayerEcs.getX(ecsIdx) | 0;
                            const fineY = otherPlayerEcs.getY(ecsIdx) | 0;
                            const otherWorldX = fineX / 128;
                            const otherWorldY = fineY / 128;

                            const relX = (otherWorldX - worldX) * 4;
                            const relY = (worldY - otherWorldY) * 4;

                            minimapRenderer.queueDot(playerDot, relX, relY);
                        }
                    }

                    // Draw NPCs as yellow dots
                    const npcEcs = osrsClient.npcEcs;
                    if (npcEcs?.getAllActiveIds && npcDot) {
                        for (const ecsIdx of npcEcs.getAllActiveIds()) {
                            if (!npcEcs.isActive?.(ecsIdx)) continue;

                            const mapId = npcEcs.getMapId(ecsIdx) | 0;
                            const mapSquareX = mapId >> 8;
                            const mapSquareY = mapId & 0xff;

                            const fineX = npcEcs.getX(ecsIdx) | 0;
                            const fineY = npcEcs.getY(ecsIdx) | 0;
                            const npcWorldX = mapSquareX * 64 + fineX / 128;
                            const npcWorldY = mapSquareY * 64 + fineY / 128;

                            const relX = (npcWorldX - worldX) * 4;
                            const relY = (worldY - npcWorldY) * 4;

                            minimapRenderer.queueDot(npcDot, relX, relY);
                        }
                    }

                    // Draw ground items as red dots
                    const groundItems = osrsClient.groundItems;
                    if (groundItems && itemDot) {
                        const allStacks = groundItems.getAllStacks?.() ?? [];
                        for (const stack of allStacks) {
                            if (!stack || !stack.tile) continue;
                            const itemTileX = stack.tile.x | 0;
                            const itemTileY = stack.tile.y | 0;

                            const relX = (itemTileX - playerTileX) * 4;
                            const relY = (playerTileY - itemTileY) * 4;

                            minimapRenderer.queueDot(itemDot, relX, relY);
                        }
                    }

                    // Draw minimap icons (bank, quest, transport icons)
                    // Icons stay upright (don't rotate with map)
                    const renderer = osrsClient.renderer;
                    if (renderer?.getMinimapIcons) {
                        // PERF: Cache icon textures to avoid string concat + lookup per frame
                        // null = looked up but not found, undefined = not yet looked up
                        const iconTexCache: Map<
                            number,
                            ReturnType<typeof tc.getByNameToken> | null
                        > = (canvasAny.__iconTexCache ??= new Map());

                        // Check all visible map squares (3x3 grid around player)
                        for (let mx = -1; mx <= 1; mx++) {
                            for (let my = -1; my <= 1; my++) {
                                const iconMapX = cameraMapX + mx;
                                const iconMapY = cameraMapY + my;
                                const icons = renderer.getMinimapIcons(iconMapX, iconMapY);
                                if (!icons) continue;

                                for (let i = 0; i < icons.length; i++) {
                                    const icon = icons[i];
                                    const spriteId = icon.spriteId;

                                    // Get cached texture or load it by sprite ID
                                    let iconTex = iconTexCache.get(spriteId);
                                    if (iconTex === undefined) {
                                        iconTex = tc.getBySpriteId(spriteId);
                                        iconTexCache.set(spriteId, iconTex ?? null);
                                    }
                                    if (!iconTex) continue;

                                    // Calculate world position of icon
                                    const iconWorldX = iconMapX * 64 + icon.localX;
                                    const iconWorldY = iconMapY * 64 + icon.localY;

                                    // Calculate relative position (in minimap pixels)
                                    const relX = (iconWorldX - worldX) * 4;
                                    const relY = (worldY - iconWorldY) * 4;

                                    // Transform to screen position (applies rotation)
                                    // then draw as overlay (stays upright)
                                    const iconScreen = minimapRenderer.relativeToScreen(relX, relY);
                                    minimapRenderer.drawOverlay(
                                        iconTex,
                                        iconScreen.x,
                                        iconScreen.y,
                                    );
                                }
                            }
                        }
                    }

                    // Flush all queued dots (batched by texture)
                    minimapRenderer.flushDots();

                    // Draw player marker at center (white square)
                    minimapRenderer.drawSolidRect(centerX, centerY, 4, 4, [1, 1, 1, 1]);

                    // Draw destination flag (unrotated overlay)
                    let destWorldX = ClientState.destinationWorldX;
                    let destWorldY = ClientState.destinationWorldY;

                    // Clear destination when player reaches it
                    if (
                        (destWorldX !== 0 || destWorldY !== 0) &&
                        playerTileX === destWorldX &&
                        playerTileY === destWorldY
                    ) {
                        ClientState.destinationX = 0;
                        ClientState.destinationY = 0;
                        ClientState.destinationWorldX = 0;
                        ClientState.destinationWorldY = 0;
                        destWorldX = 0;
                        destWorldY = 0;
                    }

                    if (destWorldX !== 0 || destWorldY !== 0) {
                        const relTileX = destWorldX - worldX;
                        const relTileY = worldY - destWorldY;
                        const relPixelX = relTileX * 4;
                        const relPixelY = relTileY * 4;

                        // Transform relative position to screen (applying rotation + zoom)
                        const flagScreen = minimapRenderer.relativeToScreen(relPixelX, relPixelY);

                        // Get flag texture
                        const flagTex = tc.getByNameToken("mapmarker,0");
                        if (flagTex) {
                            minimapRenderer.drawOverlay(flagTex, flagScreen.x, flagScreen.y);
                        } else {
                            // Fallback: draw simple flag
                            minimapRenderer.drawSolidRect(
                                flagScreen.x,
                                flagScreen.y - 5,
                                2,
                                10,
                                [1, 0, 0, 1],
                            );
                            minimapRenderer.drawSolidRect(
                                flagScreen.x + 4,
                                flagScreen.y - 3,
                                6,
                                4,
                                [1, 1, 0, 1],
                            );
                        }
                    }

                    // OSRS PARITY: Register click handler for minimap click-to-walk
                    // Reference: Clicking on minimap sends MOVE_GAMECLICK to walk to that tile
                    // Capture values needed for click handler closure (use worldX/Y for sub-tile precision)
                    const capturedWorldX = worldX;
                    const capturedWorldY = worldY;
                    const capturedCameraYaw = cameraYaw;
                    const capturedZoomScale = zoomScale;
                    const capturedMinimapCenterX = centerX;
                    const capturedMinimapCenterY = centerY;

                    clicks.register({
                        id: `minimap:click-to-walk`,
                        rect: { x, y, w: width, h: height },
                        // OSRS parity: minimap click-to-walk should not steal clicks from widgets
                        // rendered on top of the minimap (orbs, buttons). Keep below widget targets.
                        priority: 90,
                        persist: false,
                        onClick: (clickX?: number, clickY?: number) => {
                            if (clickX === undefined || clickY === undefined) return;

                            // Calculate click offset from minimap center (in screen pixels)
                            const offsetX = clickX - capturedMinimapCenterX;
                            const offsetY = clickY - capturedMinimapCenterY;

                            // Inverse of the flag position calculation:
                            // Flag uses θ = -cameraYaw / 326.11
                            // Inverse rotation matrix: [cos(θ), sin(θ); -sin(θ), cos(θ)]
                            const theta = -capturedCameraYaw / 326.11;
                            const cos = Math.cos(theta);
                            const sin = Math.sin(theta);

                            // Inverse rotation to get world-relative pixel offset
                            const relPixelX = offsetX * cos + offsetY * sin;
                            const relPixelY = -offsetX * sin + offsetY * cos;

                            // Convert from pixels to tiles (4 pixels per tile, scaled by zoom)
                            const relTileX = relPixelX / (4 * capturedZoomScale);
                            const relTileY = relPixelY / (4 * capturedZoomScale);

                            // Calculate target world tile
                            // Flag uses: relTileY = worldY - destWorldY, so destWorldY = worldY - relTileY
                            const targetTileX = Math.round(capturedWorldX + relTileX);
                            const targetTileY = Math.round(capturedWorldY - relTileY);

                            // Convert to local coordinates for menuAction
                            const localX = (targetTileX - (ClientState.baseX | 0)) | 0;
                            const localY = (targetTileY - (ClientState.baseY | 0)) | 0;

                            // Send walk command via menuAction
                            menuAction(
                                localX,
                                localY,
                                MenuOpcode.WalkHere,
                                0, // identifier
                                -1, // itemId
                                "Walk here",
                                "",
                                clickX | 0,
                                clickY | 0,
                            );
                        },
                    });
                } // end if (playerState)
            }
            // Skip normal type-based rendering for minimap
            if (profileWidgetRender) {
                minimapMs += performance.now() - minimapStartMs;
            }
        }

        if (w.type === 3) {
            const rectStartMs = profileWidgetRender ? performance.now() : 0;
            // OSRS PARITY: Type 3 rectangle rendering
            // Reference: UserComparator5.java lines 272-304
            // For IF1 widgets, runCs1() determines which color set to use
            // For IF3 widgets, there's no CS1 - just use base color/color2

            // Determine effective color based on CS1 comparison (IF1 only) or base
            // runCs1 returns true when condition is met -> use color2/mouseOverColor2
            // runCs1 returns false -> use color/mouseOverColor
            let cs1Result = false;
            if (!isIf3 && w.cs1Comparisons && w.cs1ComparisonValues && w.cs1Instructions) {
                cs1Result = runCs1(w, widgetManager);
            }

            let effectiveColor: number;
            if (cs1Result) {
                // CS1 condition met: use color2 (alternate state)
                effectiveColor = w.color2 ?? w.textColor ?? w.color ?? 0xffffff;
                if (isWidgetHovered && w.mouseOverColor2) {
                    effectiveColor = w.mouseOverColor2;
                }
            } else {
                // Normal state: use color
                effectiveColor = w.textColor ?? w.color ?? 0xffffff;
                if (isWidgetHovered && w.mouseOverColor) {
                    effectiveColor = w.mouseOverColor;
                }
            }

            // OSRS transparency: 0 = fully opaque, 255 = fully transparent
            // Scripts set w.transparency via cc_settrans; cache sets w.opacity (same semantics)
            const trans = w.transparency ?? w.opacity ?? 0;

            // OSRS PARITY: Skip rendering fully transparent rectangles
            if (trans >= 255) {
                // Widget is fully transparent, skip drawing
            } else if (w.filled) {
                // OSRS fillMode: 0=SOLID, 1=GRADIENT_VERTICAL, 2=GRADIENT_ALPHA
                const fillMode = w.fillMode ?? 0;
                switch (fillMode) {
                    case 1: {
                        // GRADIENT_VERTICAL: color at top, color2 at bottom
                        const colorTop = w.color ?? w.textColor ?? 0xffffff;
                        const colorBot = w.color2 ?? colorTop;
                        const rT = ((colorTop >>> 16) & 0xff) / 255;
                        const gT = ((colorTop >>> 8) & 0xff) / 255;
                        const bT = (colorTop & 0xff) / 255;
                        const rB = ((colorBot >>> 16) & 0xff) / 255;
                        const gB = ((colorBot >>> 8) & 0xff) / 255;
                        const bB = (colorBot & 0xff) / 255;
                        const a = (255 - trans) / 255;
                        glr.drawRectGradientVertical(
                            x,
                            y,
                            width,
                            height,
                            [rT, gT, bT, a],
                            [rB, gB, bB, a],
                        );
                        break;
                    }
                    case 2: {
                        // GRADIENT_ALPHA: gradient color AND alpha
                        // Reference: Rasterizer2D_fillRectangleGradientAlpha
                        const colorTop = w.color ?? w.textColor ?? 0xffffff;
                        const colorBot = w.color2 ?? colorTop;
                        const alphaTop = 255 - (trans & 255);
                        const alphaBot = 255 - ((w.transparencyBot ?? trans) & 255);
                        glr.drawRectGradientAlpha(
                            x,
                            y,
                            width,
                            height,
                            colorTop,
                            colorBot,
                            alphaTop,
                            alphaBot,
                        );
                        break;
                    }
                    default: {
                        // SOLID fill (fillMode=0 or unset)
                        const a = (255 - trans) / 255;
                        const r = ((effectiveColor >>> 16) & 0xff) / 255;
                        const g = ((effectiveColor >>> 8) & 0xff) / 255;
                        const b = (effectiveColor & 0xff) / 255;
                        if (trans === 0) {
                            glr.drawRect(x, y, width, height, [r, g, b, 1]);
                        } else {
                            glr.drawRect(x, y, width, height, [r, g, b, a]);
                        }
                        break;
                    }
                }
            } else {
                // Rectangle outline (1px border)
                const a = (255 - trans) / 255;
                const r = ((effectiveColor >>> 16) & 0xff) / 255;
                const g = ((effectiveColor >>> 8) & 0xff) / 255;
                const b = (effectiveColor & 0xff) / 255;
                const strokeW = Math.min(width, scaleLogicalPixels(rootScaleX, 1));
                const strokeH = Math.min(height, scaleLogicalPixels(rootScaleY, 1));
                if (trans === 0) {
                    glr.drawRect(x, y, width, strokeH, [r, g, b, 1]);
                    glr.drawRect(x, y + height - strokeH, width, strokeH, [r, g, b, 1]);
                    glr.drawRect(x, y, strokeW, height, [r, g, b, 1]);
                    glr.drawRect(x + width - strokeW, y, strokeW, height, [r, g, b, 1]);
                } else {
                    glr.drawRect(x, y, width, strokeH, [r, g, b, a]);
                    glr.drawRect(x, y + height - strokeH, width, strokeH, [r, g, b, a]);
                    glr.drawRect(x, y, strokeW, height, [r, g, b, a]);
                    glr.drawRect(x + width - strokeW, y, strokeW, height, [r, g, b, a]);
                }
            }
            if (profileWidgetRender) {
                rectMs += performance.now() - rectStartMs;
            }
        } else if (w.type === 5 && contentType !== 1339 && contentType !== 1338) {
            const spriteStartMs = profileWidgetRender ? performance.now() : 0;
            spriteWidgets++;
            // Type 5 = Sprite widget (skip if compass/minimap - already rendered above)
            const isIf3 = w.isIf3 !== false;
            let cs1Result = false;
            if (!isIf3 && w.cs1Comparisons && w.cs1ComparisonValues && w.cs1Instructions) {
                cs1Result = runCs1(w, widgetManager);
            }

            const effectiveSpriteId = isIf3
                ? typeof w.spriteId === "number" && w.spriteId >= 0
                    ? w.spriteId | 0
                    : -1
                : cs1Result
                ? typeof w.spriteId2 === "number" && w.spriteId2 >= 0
                    ? w.spriteId2 | 0
                    : -1
                : typeof w.spriteId === "number" && w.spriteId >= 0
                ? w.spriteId | 0
                : -1;

            // Check borderType for sprite outline (set via CS2 CC_SETOUTLINE/IF_SETOUTLINE)
            // borderType >= 2 = white pixel-perfect outline around sprite
            const borderType = (w as any).borderType ?? 0;
            const spriteShadow = ((w as any).graphicShadow ?? (w as any).shadowColor ?? 0) | 0;

            // Flip flags: check both property names (flippedH/flippedV from cache, horizontalFlip/verticalFlip from scripts)
            const hFlip = !!(w.horizontalFlip || (w as any).flippedH);
            const vFlip = !!(w.verticalFlip || (w as any).flippedV);

            // OSRS transparency: 0 = fully opaque, 255 = fully transparent
            // Scripts set w.transparency via cc_settrans; cache sets w.opacity (same semantics)
            // OSRS PARITY: Clicked/dragged widget is semi-transparent (var14 = 128), except scrollbars.
            // Reference: UserComparator5.drawInterface: if (!var10.isScrollBar) { var14 = 128; }
            let trans = w.transparency ?? w.opacity ?? 0;
            if ((isDragActive || isClickedWidget) && !w.isScrollBar) {
                trans = 128;
            }
            const alpha = (255 - trans) / 255;
            const itemId = typeof w.itemId === "number" ? (w.itemId as number) | 0 : -1;
            const renderItemSprite = isIf3 && itemId >= 0;

            if (!renderItemSprite && effectiveSpriteId >= 0) {
                const tex = tc.getWidgetSpriteById(effectiveSpriteId, {
                    borderType,
                    shadowColor: spriteShadow,
                    flipH: hFlip,
                    flipV: vFlip,
                });
                if (tex) {
                    if (w.spriteTiling && tex.w > 0 && tex.h > 0) {
                        // OSRS PARITY: Tile the sprite to fill the widget area
                        // Reference: UserComparator5.java lines 391-407
                        // Uses Rasterizer2D_expandClip to constrain drawing to widget bounds,
                        // then draws full sprites, letting the scissor handle edge clipping.
                        const sprLogicalW = Math.max(1, tex.w | 0);
                        const sprLogicalH = Math.max(1, tex.h | 0);

                        // Push expanded clip to constrain tiling to widget bounds
                        sc.expandClip(x, y, x + width, y + height);

                        // Tile in logical widget space, then project tile edges into buffer space.
                        const tilesX = Math.ceil(logicalWidth / sprLogicalW);
                        const tilesY = Math.ceil(logicalHeight / sprLogicalH);

                        for (let tileY = 0; tileY < tilesY; tileY++) {
                            for (let tileX = 0; tileX < tilesX; tileX++) {
                                const tileLogicalX = logicalX + tileX * sprLogicalW;
                                const tileLogicalY = logicalY + tileY * sprLogicalH;
                                const tx = Math.round(tileLogicalX * rootScaleX + rootOffsetX);
                                const ty = Math.round(tileLogicalY * rootScaleY + rootOffsetY);
                                const tx1 = Math.round(
                                    (tileLogicalX + sprLogicalW) * rootScaleX + rootOffsetX,
                                );
                                const ty1 = Math.round(
                                    (tileLogicalY + sprLogicalH) * rootScaleY + rootOffsetY,
                                );
                                const drawW = Math.max(1, tx1 - tx);
                                const drawH = Math.max(1, ty1 - ty);
                                // Draw full sprite - scissor will clip edges
                                glr.drawTexture(
                                    tex,
                                    tx,
                                    ty,
                                    drawW,
                                    drawH,
                                    1,
                                    1,
                                    0,
                                    [0, 0, 0],
                                    false,
                                    false,
                                    alpha,
                                );
                            }
                        }

                        // Restore previous clip
                        sc.pop();
                    } else {
                        const nativeSpriteDraw = !isIf3;
                        const drawX = x;
                        const drawY = y;
                        const drawW = nativeSpriteDraw
                            ? Math.max(
                                  1,
                                  Math.round(
                                      (logicalX + Math.max(1, tex.w | 0)) * rootScaleX +
                                          rootOffsetX,
                                  ) - drawX,
                              )
                            : width;
                        const drawH = nativeSpriteDraw
                            ? Math.max(
                                  1,
                                  Math.round(
                                      (logicalY + Math.max(1, tex.h | 0)) * rootScaleY +
                                          rootOffsetY,
                                  ) - drawY,
                              )
                            : height;
                        const spriteAngle = nativeSpriteDraw ? 0 : w.spriteAngle ?? 0;

                        if (spriteAngle !== 0) {
                            // Draw rotated sprite - uses 16-bit angle scale (0-65536 = 360 degrees)
                            glr.drawTextureRotated(
                                tex,
                                drawX,
                                drawY,
                                drawW,
                                drawH,
                                spriteAngle,
                                65536, // widget spriteAngle uses 16-bit scale
                                0,
                                [0, 0, 0],
                                alpha,
                            );
                        } else {
                            glr.drawTexture(
                                tex,
                                drawX,
                                drawY,
                                drawW,
                                drawH,
                                1,
                                1,
                                0,
                                [0, 0, 0],
                                false,
                                false,
                                alpha,
                            );
                        }
                    }
                }
            }

            // IF3 type-5 widgets switch to an item sprite when CC_SETOBJECT/IF_SETOBJECT is active.
            if (renderItemSprite) {
                const qty = (w.itemQuantity ?? 1) | 0;
                const qtyMode = (w.itemQuantityMode ?? 2) | 0;
                // OSRS parity: selected items render with outline=2 (white).
                const itemOutline =
                    (isSelectedHere ? Math.max(2, borderType | 0) : borderType | 0) | 0;
                const itemTex = tc.getItemIconById(itemId, qty, itemOutline, spriteShadow, qtyMode);
                if (itemTex) {
                    glr.drawTexture(
                        itemTex,
                        x,
                        y,
                        width,
                        height,
                        1,
                        1,
                        0,
                        [0, 0, 0],
                        false,
                        false,
                        alpha,
                    );
                }
            }
            if (profileWidgetRender) {
                spriteMs += performance.now() - spriteStartMs;
            }
        } else if (
            w.type === 6 &&
            ((typeof w.modelId === "number" && w.modelId >= 0) ||
                (typeof w.itemId === "number" && w.itemId >= 0) ||
                (w as any).isPlayerChathead ||
                (w as any).isNpcChathead ||
                ((w.contentType ?? 0) | 0) === 328 ||
                ((w.modelType ?? 0) | 0) === 7 ||
                (w as any).isPlayerModel) &&
            typeof opts.renderModelCanvas === "function"
        ) {
            const modelStartMs = profileWidgetRender ? performance.now() : 0;
            modelWidgets++;
            // OSRS parity: IF1 widgets use CS1 to choose model/sequence secondary fields.
            const cs1Result = runCs1(w, widgetManager);
            const modelId = ((cs1Result ? w.modelId2 : w.modelId) ?? -1) | 0;
            let rx = (w.rotationX ?? 0) | 0; // 0..2047
            let ry = (w.rotationY ?? 0) | 0; // 0..2047
            let rz = (w.rotationZ ?? 0) | 0; // 0..2047
            const rawSeqId = (cs1Result ? w.sequenceId2 : w.sequenceId) ?? -1;
            const sequenceId =
                typeof rawSeqId === "number" && rawSeqId >= 0 ? rawSeqId | 0 : undefined;
            // Replicate client zoom normalization
            let zoom = Math.max(1, (w.modelZoom ?? 0) | 0 || 2000);
            let offX = (w.modelOffsetX ?? 0) | 0;
            let offY = (w.modelOffsetY ?? 0) | 0;
            const ortho = !!w.modelOrthog;

            // No client-side bob if no sequence; rely on server/script-provided sequence/animationId.

            // If this widget is currently set to display an item, override angles/offsets/zoom
            // from the item definition, like the client does in Client.java.
            try {
                const itemId = w.itemId;
                const qty = (w.itemQuantity ?? 0) | 0 || 1;
                if (typeof itemId === "number" && itemId >= 0 && (opts as any).objLoader?.load) {
                    let it = (opts as any).objLoader.load(itemId);
                    if (it && typeof it.getCountObj === "function") it = it.getCountObj(qty);
                    if (it) {
                        rx = (it.xan2d | 0) as number;
                        ry = (it.yan2d | 0) as number;
                        rz = (it.zan2d | 0) as number;
                        offX = (it.offsetX2d | 0) as number;
                        offY = (it.offsetY2d | 0) as number;
                        zoom = Math.max(1, (it.zoom2d | 0) as number);
                    }
                }
            } catch {}

            // Apply normalization only when the widget is displaying an item (OSRS behavior)
            try {
                const itemId = w.itemId;
                if (typeof itemId === "number" && itemId >= 0) {
                    const zUnitsX = (w as any).modelZoomWidthUnits | 0 || 0;
                    // OSRS parity: only width-based units are used; fallback is rawWidth
                    if (zUnitsX > 0) zoom = Math.max(1, Math.floor((zoom * 32) / zUnitsX));
                    else if ((w.rawWidth ?? 0) > 0)
                        zoom = Math.max(1, Math.floor((zoom * 32) / (w.rawWidth ?? 1)));
                }
            } catch {}
            // PERF: Build cache key FIRST and check if we have cached render result
            // Only cache static models (no animation)
            const isAnimated = sequenceId !== undefined && sequenceId >= 0;
            const appearanceKey = (() => {
                // OSRS parity: modelType=7 widgets render a PlayerComposition clone; cache must vary by appearance.
                try {
                    const isPlayerModel =
                        ((w.contentType ?? 0) | 0) === 328 ||
                        ((w.modelType ?? 0) | 0) === 7 ||
                        (w as any).isPlayerModel === true;
                    const isPlayerChathead = (w as any).isPlayerChathead === true;
                    if (!isPlayerModel && !isPlayerChathead) return null;

                    const osrsClient = (opts.game as any)?.osrsClient;
                    const playerEcs = osrsClient?.playerEcs;
                    const localServerId = osrsClient?.controlledPlayerServerId;
                    const idx =
                        playerEcs && typeof playerEcs.getIndexForServerId === "function"
                            ? playerEcs.getIndexForServerId(localServerId)
                            : undefined;
                    const localAppearance =
                        idx !== undefined ? playerEcs?.getAppearance?.(idx) : undefined;

                    // OSRS parity: contentType=328 is the local-player model. Prefer ECS appearance
                    // so server-driven appearance changes reflect even if widget has stale snapshot.
                    let app: any;
                    if (((w.contentType ?? 0) | 0) === 328) {
                        app = localAppearance || (w as any).playerAppearance;
                    } else {
                        app = (w as any).playerAppearance || localAppearance;
                    }
                    if (!app) return null;

                    const gender = (app.gender ?? 0) | 0;
                    const colors = Array.isArray(app.colors) ? app.colors.slice(0, 5) : [];
                    const kits = Array.isArray(app.kits) ? app.kits.slice(0, 7) : [];
                    let equip = Array.isArray(app.equip) ? app.equip.slice(0, 14) : [];
                    const keepEquipment =
                        typeof (w as any).playerModelKeepEquipment === "boolean"
                            ? ((w as any).playerModelKeepEquipment as boolean)
                            : true;
                    if (isPlayerModel && !keepEquipment) {
                        equip = new Array(14).fill(-1);
                    }

                    return `${gender}|c:${colors.join(",")}|k:${kits.join(",")}|e:${equip.join(
                        ",",
                    )}`;
                } catch {
                    return null;
                }
            })();
            const cacheSuffix = appearanceKey ? `:pa:${appearanceKey}` : "";
            const isPlayerDesignPreview =
                (((w.contentType ?? 0) | 0) === 327 || ((w.contentType ?? 0) | 0) === 328) &&
                (((w.modelType ?? 0) | 0) === 5 || ((w.modelType ?? 0) | 0) === 7);
            const isPlayerModel =
                ((w.contentType ?? 0) | 0) === 328 ||
                ((w.modelType ?? 0) | 0) === 7 ||
                (w as any).isPlayerModel === true;
            const cacheKey =
                isAnimated || isPlayerDesignPreview || (isPlayerModel && !appearanceKey)
                    ? null // Animated models can't be cached (frame changes)
                    : `wm:${modelId}:${rx}:${ry}:${rz}:${zoom}:${offX}:${offY}:o${
                          ortho ? 1 : 0
                      }:${width}:${height}${cacheSuffix}`;

            // PERF: Cache model render results (texture + offsets) on the canvas
            const canvasAny2 = glr.canvas as any;
            let modelCache: Map<
                string,
                { tex: any; offsetX: number; offsetY: number; w: number; h: number }
            > = canvasAny2.__modelRenderCache;
            if (!modelCache) {
                modelCache = new Map();
                canvasAny2.__modelRenderCache = modelCache;
            }

            // Check cache before expensive rendering
            const cached = cacheKey ? modelCache.get(cacheKey) : null;

            if (cached) {
                modelCacheHits++;
                // PERF: Use cached texture + offsets, skip CPU model rendering entirely
                const stretch = !!(w as any).stretchModel;
                if (stretch) {
                    glr.drawTexture(cached.tex, x, y, width, height, 1, 1);
                } else {
                    const drawX = x + ((width / 2) | 0) - cached.offsetX;
                    const drawY = y + ((height / 2) | 0) - cached.offsetY;
                    glr.drawTexture(cached.tex, drawX, drawY, cached.w, cached.h, 1, 1);
                }
            } else {
                modelCacheMisses++;
                // No cache hit - do expensive CPU model rendering
                const res = opts.renderModelCanvas(
                    modelId,
                    {
                        xan2d: rx,
                        yan2d: ry,
                        zan2d: rz,
                        zoom2d: zoom,
                        offsetX2d: offX,
                        ambient: w.modelAmbient,
                        contrast: w.modelContrast,
                        lightX: w.modelLightX,
                        lightY: w.modelLightY,
                        lightZ: w.modelLightZ,
                        offsetY2d: offY,
                        orthographic: ortho,
                        widget: w,
                        sequenceId,
                        sequenceFrame: (w.modelFrame ?? 0) | 0,
                        depthTest: true,
                    },
                    width,
                    height,
                );
                if (res) {
                    const can = res.canvas;
                    // Animated/dynamic model widgets must update a stable GPU texture each frame.
                    // Using a varying cache key here would leak textures and prevent animation updates.
                    const texKey = cacheKey ? cacheKey : `wm:dyn:${w.uid}`;
                    const tex = cacheKey
                        ? glr.createTextureFromCanvas(texKey, can)
                        : glr.updateTextureFromCanvas(texKey, can);

                    // Cache the result for static models
                    if (cacheKey) {
                        modelCache.set(cacheKey, {
                            tex,
                            offsetX: res.offsetX | 0,
                            offsetY: res.offsetY | 0,
                            w: can.width,
                            h: can.height,
                        });
                    }

                    const stretch = !!(w as any).stretchModel;
                    if (stretch) {
                        glr.drawTexture(tex, x, y, width, height, 1, 1);
                    } else {
                        const drawW = can.width;
                        const drawH = can.height;
                        const drawX = x + ((width / 2) | 0) - (res.offsetX | 0);
                        const drawY = y + ((height / 2) | 0) - (res.offsetY | 0);
                        glr.drawTexture(tex, drawX, drawY, drawW, drawH, 1, 1);
                    }
                }
            }
            if (profileWidgetRender) {
                modelMs += performance.now() - modelStartMs;
            }
        } else if (w.type === 9) {
            const lineStartMs = profileWidgetRender ? performance.now() : 0;
            // OSRS PARITY: Type 9 = Line widget
            // Reference: UserComparator5.java lines 547-564
            // Lines are defined by start point (x, y) and end point (x+width, y+height)
            // lineDirection (field3735): determines diagonal direction
            //   true = line from (x, y+height) to (x+width, y) (bottom-left to top-right)
            //   false = line from (x, y) to (x+width, y+height) (top-left to bottom-right)
            // lineWid: thickness of the line (1 = single pixel, >1 uses thick line drawing)
            const lineColor = w.textColor ?? w.color ?? 0x000000;
            const lineWid = (w as any).lineWidth ?? 1;
            const scaledLineWid = Math.max(
                1,
                Math.round(lineWid * Math.max(rootScaleX, rootScaleY)),
            );
            const lineDir = !!(w as any).lineDirection;
            const r = ((lineColor >>> 16) & 0xff) / 255;
            const g = ((lineColor >>> 8) & 0xff) / 255;
            const b = (lineColor & 0xff) / 255;
            const a = 1; // Lines are fully opaque

            // Calculate line endpoints based on lineDirection (field3735)
            let x1: number, y1: number, x2: number, y2: number;
            if (lineDir) {
                // field3735 = true: bottom-left to top-right diagonal
                x1 = x;
                y1 = y + height;
                x2 = x + width;
                y2 = y;
            } else {
                // field3735 = false: top-left to bottom-right diagonal
                x1 = x;
                y1 = y;
                x2 = x + width;
                y2 = y + height;
            }

            // Draw line using Bresenham's algorithm or thick line algorithm
            if (scaledLineWid === 1) {
                // Single pixel line - use Bresenham's algorithm
                drawLine(glr, x1, y1, x2, y2, [r, g, b, a]);
            } else {
                // Thick line - draw multiple parallel lines
                drawThickLine(glr, x1, y1, x2, y2, scaledLineWid, [r, g, b, a]);
            }
            if (profileWidgetRender) {
                lineMs += performance.now() - lineStartMs;
            }
        } else if (w.type === 4 || w.type === 8) {
            const textStartMs = profileWidgetRender ? performance.now() : 0;
            textWidgets++;
            // OSRS PARITY: Type 4 text widget rendering
            // Reference: UserComparator5.java lines 305-328
            // For IF1 widgets, runCs1() determines which text/color to use
            // For IF3 widgets, there's no CS1 - just use text/textColor

            let cs1Result = false;
            if (!isIf3 && w.cs1Comparisons && w.cs1ComparisonValues && w.cs1Instructions) {
                cs1Result = runCs1(w, widgetManager);
            }

            // Determine effective text and color based on CS1 result
            let effectiveText: string;
            let effectiveColor: number;

            if (cs1Result) {
                // CS1 condition met: use color2 and text2 (if text2 has content)
                effectiveColor = w.color2 ?? w.textColor ?? 0xffffff;
                if (isWidgetHovered && w.mouseOverColor2) {
                    effectiveColor = w.mouseOverColor2;
                }
                // Use text2 if it exists and has content
                effectiveText =
                    w.text2 && String(w.text2).length > 0 ? String(w.text2) : String(w.text || "");
            } else {
                // Normal state: use color and text
                effectiveColor = w.textColor ?? 0xffffff;
                if (isWidgetHovered && w.mouseOverColor) {
                    effectiveColor = w.mouseOverColor;
                }
                effectiveText = String(w.text || "");
            }

            // For IF3, use hover behavior (text2/mouseOverColor on hover)
            if (isIf3 && isWidgetHovered) {
                if (w.text2) effectiveText = String(w.text2);
                if (typeof w.mouseOverColor === "number") effectiveColor = w.mouseOverColor;
            }

            // OSRS parity: Show "Please wait..." for the continue button being processed
            // Reference: UserComparator5.java line 341-343
            if (widgetManager?.meslayerContinueWidget === w) {
                effectiveText = "Please wait...";
            }

            if (effectiveText.length) {
                const normalized = effectiveText.replace(/<br\s*\/?\s*>/gi, "\n");
                // OSRS type-4 widgets use drawLines(), but short widgets disable automatic
                // word wrapping and only honor explicit line breaks.
                // When textLineHeight == 0, OSRS uses font.ascent as the line height.
                const resolvedFont = opts.fontLoader(w.fontId ?? -1);
                const lineH =
                    (w.lineHeight as number) | 0 ||
                    ((resolvedFont as any)?.lineHeight as number) ||
                    ((resolvedFont as any)?.ascent as number) ||
                    12;
                drawWrappedTextGL(
                    normalized,
                    x,
                    y,
                    width,
                    height,
                    w.fontId ?? -1,
                    effectiveColor,
                    lineH,
                    !!(w.textShadowed || w.textShadow),
                    (w.yTextAlignment ?? 0) as 0 | 1 | 2,
                    (w.xTextAlignment ?? 0) as 0 | 1 | 2,
                );
            }
            if (profileWidgetRender) {
                textMs += performance.now() - textStartMs;
            }
        } else if (w.type === 2) {
            // OSRS parity: no placeholder slot grid rendering for type-2 inventory widgets.
            // Visible cells/items are rendered by real widget content and scripts.
        }

        // Collect debug devoverlay bounds
        if (opts.debug) debugRects.push({ x, y, w: width, h: height });

        // OSRS PARITY: Only type 0 and 11 are containers that can have children
        // Reference: UserComparator5.java lines 226-264
        // - Type 0 (layer): renders static children (via parentUid) AND dynamic children (w.children)
        // - Type 11 (layer): renders ONLY dynamic children (w.children)
        // Non-container types do NOT render children even if they somehow have them
        // OSRS PARITY: Only containers can have children - skip children processing for non-containers
        if (!isContainer) {
            return; // Non-containers have finished rendering their content above
        }

        // OSRS PARITY: InterfaceParent (mounted sub-interface) is rendered as an additional
        // child interface layer for type 0 containers.
        const interfaceParentGroup =
            w.type === 0 && widgetManager
                ? widgetManager.interfaceParents.get(w.uid)?.group
                : undefined;
        const hasInterfaceParent = interfaceParentGroup !== undefined;

        const hasAnyChildren = hasStaticChildren || hasChildren || hasInterfaceParent;

        // OSRS PARITY: IF1 container hidden checks
        // Reference: UserComparator5.java line 227 (type 0) and line 254 (type 11)
        // For IF1 containers, skip children rendering if hidden
        // (IF3 containers already returned early at line 542)
        if (
            !isIf3 &&
            w.type === 0 &&
            isComponentHidden(w) &&
            widgetUid !== mousedOverIf1WidgetUid
        ) {
            // Skip rendering children for hidden IF1 type 0 containers
            return;
        }
        if (w.type === 11 && isComponentHidden(w) && widgetUid !== mousedOverIf1WidgetUid) {
            // Skip rendering children for hidden type 11 containers (IF1 only reaches here)
            return;
        }

        // Note: Scroll clamping for IF1 type 0 containers is already done at line 1195
        // No need to duplicate here

        if (hasAnyChildren) {
            const containerStartMs = profileWidgetRender ? performance.now() : 0;
            // OSRS PARITY: Calculate child clip bounds
            // Reference: UserComparator5.drawInterface lines 163-169
            // For containers, children are clipped to the intersection of:
            // 1. Parent's clip bounds (var2-var5)
            // 2. This container's visible bounds (var15-var18)
            //
            // OSRS PARITY: ALL type 0/11 containers clip their children, not just scrollable ones
            // Reference: UserComparator5.java line 241 - drawInterface passes intersection bounds
            // Reference: UserComparator5.java line 251 - Rasterizer2D_setClip restores parent clip after

            // OSRS PARITY: For IF3 widgets, only render children if clip is valid.
            // For IF1 widgets, always render children (scissor handles clipping).
            // Reference: UserComparator5.java line 172
            //
            // OSRS PARITY: For IF3 containers, only render children if the container's
            // intersection clip has positive area (var15 < var17 && var16 < var18).
            // Reference: UserComparator5.java line 172
            // IF1 containers are always traversed and rely on scissor clipping.
            const shouldRenderChildren = !isIf3 || isClipValid(widgetClip);

            if (shouldRenderChildren) {
                // OSRS PARITY: Type 0/11 containers ALWAYS clip their children to the
                // intersection bounds (var15-var18) by calling drawInterface with those bounds.
                // Reference: UserComparator5.java line 241 (type 0), line 258 (type 11).
                //
                // OSRS clips strictly at container bounds - any visual overflow (item icons,
                // selection outlines) that extends beyond the container will be clipped.
                // This is intentional OSRS behavior. CS2 scripts control item margins.
                const childClip = widgetClip;

                const containerClipW = Math.max(0, childClip.x1 - childClip.x0);
                const containerClipH = Math.max(0, childClip.y1 - childClip.y0);

                sc.pushCanvasRect(childClip.x0, childClip.y0, containerClipW, containerClipH);

                // Child offset: widget position minus scroll offset
                const cx = logicalX - (w.scrollX || 0);
                const cy = logicalY - (w.scrollY || 0);

                // OSRS PARITY: Type 0 renders BOTH static and dynamic children
                // Type 11 renders ONLY dynamic children (w.children)
                // Reference: UserComparator5.java lines 241-244 vs 258-259
                if (w.type === 0 && hasStaticChildren) {
                    for (const child of staticChildren) {
                        if (child != null) {
                            drawNode(child, cx, cy, eff, isSelectedHere, childClip);
                        }
                    }
                }
                // Render dynamic children (from CC_CREATE scripts) - both type 0 and 11
                if (hasChildren) {
                    for (const child of w.children!) {
                        if (child != null) {
                            // Normal children use scrolled offset (cx, cy)
                            drawNode(child, cx, cy, eff, isSelectedHere, childClip);
                        }
                    }
                }

                // OSRS PARITY: Render InterfaceParent (mounted) interface roots LAST, on top of
                // the container's own children.
                if (interfaceParentGroup !== undefined && widgetManager) {
                    const roots = widgetManager.getAllGroupRoots(interfaceParentGroup);
                    for (const root of roots) {
                        if (root != null) {
                            drawNode(
                                root as any,
                                logicalX,
                                logicalY,
                                eff,
                                isSelectedHere,
                                childClip,
                            );
                        }
                    }
                }

                // OSRS PARITY: Restore scissor after drawing children
                // Reference: UserComparator5.java line 251 - Rasterizer2D_setClip(var2, var3, var4, var5)
                sc.pop();
            }
            if (profileWidgetRender) {
                containerMs += performance.now() - containerStartMs;
            }
        }
    }

    // Maintain the root clip as the baseline scissor so container pop() calls
    // do not reset clipping back to the full viewport during partial redraws.
    sc.pushCanvasRect(
        fullClip.x0,
        fullClip.y0,
        fullClip.x1 - fullClip.x0,
        fullClip.y1 - fullClip.y0,
    );
    drawNode(root, 0, 0, true, false);

    // Render deferred dragged widgets on top.
    // OSRS PARITY: Only inventory-style widgets (dragRenderBehaviour >= 2) are deferred.
    // Scrollbar widgets (dragRenderBehaviour=1) render inline to maintain z-order with siblings.
    for (const d of deferredDragged) {
        // Inventory item: full screen clip so it can be dragged anywhere
        // Use absolute coordinates (_dragAbsX/_dragAbsY) if available for reliable positioning
        const hasAbsCoords =
            typeof (d.w as any)._dragAbsX === "number" &&
            typeof (d.w as any)._dragAbsY === "number";

        sc.pushCanvasRect(0, 0, glr.width, glr.height);

        if (hasAbsCoords) {
            // Use absolute position directly - most reliable for free-dragging widgets
            // Temporarily set visual position to absolute coords and use ox=0
            const origVisualX = (d.w as any)._dragVisualX;
            const origVisualY = (d.w as any)._dragVisualY;
            (d.w as any)._dragVisualX = ((d.w as any)._dragAbsX ?? 0) - rootOffsetX;
            (d.w as any)._dragVisualY = ((d.w as any)._dragAbsY ?? 0) - rootOffsetY;
            drawNode(d.w, 0, 0, d.parentVisible, d.inSelected, fullClip, false);
            // Restore original values for other code that might use them
            (d.w as any)._dragVisualX = origVisualX;
            (d.w as any)._dragVisualY = origVisualY;
        } else {
            // Fallback: try to use parent's _absX for offset correction
            let useOx = d.ox;
            let useOy = d.oy;
            const parentUid = (d.w as any).parentUid;
            if (typeof parentUid === "number" && parentUid !== -1 && widgetManager) {
                const parent = widgetManager.getWidgetByUid(parentUid);
                if (parent && typeof (parent as any)._absLogicalX === "number") {
                    useOx = (parent as any)._absLogicalX;
                    useOy = (parent as any)._absLogicalY ?? d.oy;
                } else if (parent && typeof parent._absX === "number") {
                    // Backward-compatible fallback when logical abs coords are unavailable.
                    useOx = Math.round((parent._absX - rootOffsetX) / rootScaleX);
                    useOy = Math.round(((parent._absY ?? d.oy) - rootOffsetY) / rootScaleY);
                }
            }
            drawNode(d.w, useOx, useOy, d.parentVisible, d.inSelected, fullClip, false);
        }

        sc.pop();
    }
    sc.pop();
    glr.flush();
    gl.disable(gl.SCISSOR_TEST);
    // Final debug devoverlay pass, drawn on top of all content
    if (opts.debug && debugRects.length) {
        const col: [number, number, number, number] = [1, 0.58, 0, 1];
        for (const r of debugRects) {
            glr.drawRect(r.x, r.y, r.w, 1, col);
            glr.drawRect(r.x, r.y + r.h - 1, r.w, 1, col);
            glr.drawRect(r.x, r.y, 1, r.h, col);
            glr.drawRect(r.x + r.w - 1, r.y, 1, r.h, col);
        }
        // Highlight interactive rects (purple) when debug is on
        const purple: [number, number, number, number] = [0.63, 0.2, 0.88, 1];
        const drawOutline = (rc?: { x: number; y: number; w: number; h: number }) => {
            if (!rc) return;
            glr.drawRect(rc.x, rc.y, rc.w, 1, purple);
            glr.drawRect(rc.x, rc.y + rc.h - 1, rc.w, 1, purple);
            glr.drawRect(rc.x, rc.y, 1, rc.h, purple);
            glr.drawRect(rc.x + rc.w - 1, rc.y, 1, rc.h, purple);
        };
        try {
            // Click registry rects
            const clicks = (glr.canvas as any).__clicks;
            const rects = clicks?.getDebugRects?.() || [];
            for (const rc of rects) drawOutline(rc);
        } catch {}
        // Temple Trekking outlines left as-is for now
    }

    // GL-based context menu (Choose Option) devoverlay via component
    try {
        drawChooseOptionMenu(glr, {
            fontLoader: opts.fontLoader,
            requestRender: requestRender,
            onExamine: (w) => {
                try {
                    (glr.canvas as any).__ui?.setDetails?.(w);
                } catch {}
            },
            menuState: (opts.game?.osrsClient as any)?.menuState,
        });
    } catch {}
    glr.flush();

    // NOTE: Input is processed once per frame by WidgetsOverlay after ALL roots are rendered,
    // so clicks/hover can hit targets from any root (bank, dialogs, etc.).

    // PERF: Log widget count and branch timing every second (only when profiler enabled)
    if (profileWidgetRender) {
        const renderTotalMs = performance.now() - renderStartMs;
        const measuredMs = clickRegistrationMs + minimapMs + spriteMs + modelMs + textMs;
        const otherMs = Math.max(0, renderTotalMs - measuredMs);
        const drawCountersEnd = glr.getPerfCounters();
        const drawCallsDelta = drawCountersEnd.drawCalls - (drawCountersStart?.drawCalls ?? 0);
        const textureDrawCallsDelta =
            drawCountersEnd.textureDrawCalls - (drawCountersStart?.textureDrawCalls ?? 0);
        const solidDrawCallsDelta =
            drawCountersEnd.solidDrawCalls - (drawCountersStart?.solidDrawCalls ?? 0);
        const gradientDrawCallsDelta =
            drawCountersEnd.gradientDrawCalls - (drawCountersStart?.gradientDrawCalls ?? 0);
        const maskedDrawCallsDelta =
            drawCountersEnd.maskedDrawCalls - (drawCountersStart?.maskedDrawCalls ?? 0);

        _accumulatedWidgetCount += _widgetRenderCount;
        _accumulatedFrames++;
        _accumulatedWidgetRenderMs += renderTotalMs;
        _accumulatedWidgetClickMs += clickRegistrationMs;
        _accumulatedWidgetMinimapMs += minimapMs;
        _accumulatedWidgetSpriteMs += spriteMs;
        _accumulatedWidgetModelMs += modelMs;
        _accumulatedWidgetTextMs += textMs;
        _accumulatedWidgetOtherMs += otherMs;
        _accumulatedWidgetRectMs += rectMs;
        _accumulatedWidgetLineMs += lineMs;
        _accumulatedWidgetContainerMs += containerMs;
        _accumulatedWidgetClickProbeMs += clickProbeMs;
        _accumulatedWidgetClickDeriveMs += clickDeriveMs;
        _accumulatedWidgetClickRegisterMs += clickRegisterMs;
        _accumulatedWidgetPasses++;
        _accumulatedWidgetDrawCalls += drawCallsDelta;
        _accumulatedWidgetTextureDrawCalls += textureDrawCallsDelta;
        _accumulatedWidgetSolidDrawCalls += solidDrawCallsDelta;
        _accumulatedWidgetGradientDrawCalls += gradientDrawCallsDelta;
        _accumulatedWidgetMaskedDrawCalls += maskedDrawCallsDelta;
        _accumulatedTextWidgets += textWidgets;
        _accumulatedSpriteWidgets += spriteWidgets;
        _accumulatedModelWidgets += modelWidgets;
        _accumulatedMinimapWidgets += minimapWidgets;
        _accumulatedInteractiveWidgets += interactiveWidgets;
        _accumulatedMenuDeriveWidgets += menuDeriveWidgets;
        _accumulatedMenuEntries += menuEntriesTotal;
        _accumulatedModelCacheHits += modelCacheHits;
        _accumulatedModelCacheMisses += modelCacheMisses;

        const now = performance.now();
        if (now - _lastWidgetBreakdownLog > 1000) {
            if (_accumulatedWidgetPasses > 0 && _accumulatedWidgetRenderMs > 0.1) {
                const total = _accumulatedWidgetRenderMs;
                const otherAccounted =
                    _accumulatedWidgetRectMs + _accumulatedWidgetLineMs + _accumulatedWidgetContainerMs;
                const otherMiscMs = Math.max(0, _accumulatedWidgetOtherMs - otherAccounted);
                const clickAccounted =
                    _accumulatedWidgetClickProbeMs +
                    _accumulatedWidgetClickDeriveMs +
                    _accumulatedWidgetClickRegisterMs;
                const clickMiscMs = Math.max(0, _accumulatedWidgetClickMs - clickAccounted);
                const avgPerPass = (value: number) =>
                    (_accumulatedWidgetPasses > 0 ? value / _accumulatedWidgetPasses : 0).toFixed(1);
                const pct = (value: number) => ((value / total) * 100).toFixed(0);
                console.log(
                    `[PERF] Widget render branches (${
                        _accumulatedWidgetPasses
                    } passes, ${total.toFixed(1)}ms): ` +
                        `other=${_accumulatedWidgetOtherMs.toFixed(1)}ms (${pct(
                            _accumulatedWidgetOtherMs,
                        )}%), ` +
                        `text=${_accumulatedWidgetTextMs.toFixed(1)}ms (${pct(
                            _accumulatedWidgetTextMs,
                        )}%), ` +
                        `sprite=${_accumulatedWidgetSpriteMs.toFixed(1)}ms (${pct(
                            _accumulatedWidgetSpriteMs,
                        )}%), ` +
                        `minimap=${_accumulatedWidgetMinimapMs.toFixed(1)}ms (${pct(
                            _accumulatedWidgetMinimapMs,
                        )}%), ` +
                        `model=${_accumulatedWidgetModelMs.toFixed(1)}ms (${pct(
                            _accumulatedWidgetModelMs,
                        )}%), ` +
                        `click=${_accumulatedWidgetClickMs.toFixed(1)}ms (${pct(
                            _accumulatedWidgetClickMs,
                        )}%) | ` +
                        `draws=${_accumulatedWidgetDrawCalls} ` +
                        `(tex ${_accumulatedWidgetTextureDrawCalls}, solid ${_accumulatedWidgetSolidDrawCalls}, ` +
                        `grad ${_accumulatedWidgetGradientDrawCalls}, masked ${_accumulatedWidgetMaskedDrawCalls}) | ` +
                        `other: rect ${_accumulatedWidgetRectMs.toFixed(1)}, line ${_accumulatedWidgetLineMs.toFixed(
                            1,
                        )}, container ${_accumulatedWidgetContainerMs.toFixed(
                            1,
                        )}, misc ${otherMiscMs.toFixed(1)} | ` +
                        `click: probe ${_accumulatedWidgetClickProbeMs.toFixed(
                            1,
                        )}, derive ${_accumulatedWidgetClickDeriveMs.toFixed(
                            1,
                        )}, register ${_accumulatedWidgetClickRegisterMs.toFixed(
                            1,
                        )}, misc ${clickMiscMs.toFixed(1)} | ` +
                        `avg/pass: widgets ${avgPerPass(_accumulatedWidgetCount)}, text ${avgPerPass(
                            _accumulatedTextWidgets,
                        )}, sprite ${avgPerPass(_accumulatedSpriteWidgets)}, model ${avgPerPass(
                            _accumulatedModelWidgets,
                        )}, minimap ${avgPerPass(_accumulatedMinimapWidgets)}, interactive ${avgPerPass(
                            _accumulatedInteractiveWidgets,
                        )}, menuDerive ${avgPerPass(_accumulatedMenuDeriveWidgets)}, menuEntries ${avgPerPass(
                            _accumulatedMenuEntries,
                        )}, modelCache hit/miss ${_accumulatedModelCacheHits}/${
                            _accumulatedModelCacheMisses
                        }`,
                );
            }
            _accumulatedWidgetRenderMs = 0;
            _accumulatedWidgetClickMs = 0;
            _accumulatedWidgetMinimapMs = 0;
            _accumulatedWidgetSpriteMs = 0;
            _accumulatedWidgetModelMs = 0;
            _accumulatedWidgetTextMs = 0;
            _accumulatedWidgetOtherMs = 0;
            _accumulatedWidgetRectMs = 0;
            _accumulatedWidgetLineMs = 0;
            _accumulatedWidgetContainerMs = 0;
            _accumulatedWidgetClickProbeMs = 0;
            _accumulatedWidgetClickDeriveMs = 0;
            _accumulatedWidgetClickRegisterMs = 0;
            _accumulatedWidgetPasses = 0;
            _accumulatedWidgetDrawCalls = 0;
            _accumulatedWidgetTextureDrawCalls = 0;
            _accumulatedWidgetSolidDrawCalls = 0;
            _accumulatedWidgetGradientDrawCalls = 0;
            _accumulatedWidgetMaskedDrawCalls = 0;
            _accumulatedTextWidgets = 0;
            _accumulatedSpriteWidgets = 0;
            _accumulatedModelWidgets = 0;
            _accumulatedMinimapWidgets = 0;
            _accumulatedInteractiveWidgets = 0;
            _accumulatedMenuDeriveWidgets = 0;
            _accumulatedMenuEntries = 0;
            _accumulatedModelCacheHits = 0;
            _accumulatedModelCacheMisses = 0;
            _lastWidgetBreakdownLog = now;
        }
        if (now - _lastWidgetCountLog > 1000) {
            if (_accumulatedFrames > 0) {
                const avgWidgets = (_accumulatedWidgetCount / _accumulatedFrames) | 0;
                console.log(
                    `[PERF] Widget render: ${avgWidgets} widgets/frame avg (${_accumulatedFrames} frames, ${_accumulatedWidgetCount} total)`,
                );
            }
            _accumulatedWidgetCount = 0;
            _accumulatedFrames = 0;
            _lastWidgetCountLog = now;
        }
    }
}

/**
 * WidgetsOverlay renders multiple widget roots into one cached texture.
 * Input must be framed once per draw-pass, not per root, otherwise only the last root gets click targets.
 */
export function beginWidgetUiFrame(glr: GLRenderer): void {
    try {
        const input = ensureInput(glr, () => {}, undefined);
        input.beginFrame();
    } catch {}
}

export function processWidgetUiInput(
    glr: GLRenderer,
    inputManager: InputManager | undefined,
): void {
    if (!inputManager) return;
    try {
        const input = ensureInput(glr, () => {}, undefined);
        const targetCount = input.getClicks().getDebugRects().length;
        if (targetCount > 0) {
            input.processInput(inputManager);
        }
    } catch (e) {
        console.error("[widgets-gl] processWidgetUiInput error:", e);
    }
}

export function detachGLUI(glr: GLRenderer) {
    const canvas = glr.canvas as any;
    try {
        if (typeof canvas.__detachUI === "function") canvas.__detachUI();
        if (canvas.__input) {
            try {
                canvas.__input.detach();
            } catch {}
            canvas.__input = undefined;
        }
        if (canvas.__scrolls) canvas.__scrolls = undefined;
        if (canvas.__clicks) canvas.__clicks = undefined;
    } catch {}
}

/**
 * Clean up click targets and metadata for a closed interface group.
 * Call this when an interface closes to prevent stale click targets from persisting.
 */
export function cleanupInterfaceClickTargets(canvas: HTMLCanvasElement, groupId: number): void {
    const canvasAny = canvas as any;

    // Clean clickTargetCache (cached CachedClickTarget objects)
    const clickTargetCache: Map<number, CachedClickTarget> | undefined =
        canvasAny.__clickTargetCache;
    if (clickTargetCache) {
        for (const uid of [...clickTargetCache.keys()]) {
            if (((uid >>> 16) & 0xffff) === groupId) {
                clickTargetCache.delete(uid);
            }
        }
    }

    // Clean clickMetaMap (widget click metadata)
    const clickMetaMap: Map<number, WidgetClickMeta> | undefined = canvasAny.__clickMetaMap;
    if (clickMetaMap) {
        for (const uid of [...clickMetaMap.keys()]) {
            if (((uid >>> 16) & 0xffff) === groupId) {
                clickMetaMap.delete(uid);
            }
        }
    }

    // Clean from ClickRegistry via unregisterWidgetGroup
    // Access clicks via __input.getClicks() first (UIInputBridge), then fallback to __clicks
    const clicks =
        (canvasAny.__input as any)?.getClicks?.() ||
        (canvasAny.__inputBridge as any)?.getClicks?.() ||
        canvasAny.__clicks;
    if (clicks?.unregisterWidgetGroup) {
        clicks.unregisterWidgetGroup(groupId);
    }
}
