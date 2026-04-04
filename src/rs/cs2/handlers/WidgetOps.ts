/**
 * Widget operations: CC_* and IF_* setters, getters, and management
 */
import {
    getClientClock as getClientClockFromCycles,
    markWidgetsLoaded,
} from "../../../client/TransmitCycles";
import type { WidgetNode } from "../../../ui/widgets/WidgetManager";
import { markWidgetInteractionDirty } from "../../../ui/widgets/WidgetInteraction";
import { getViewportSize } from "../../../util/DeviceUtil";
import { Opcodes } from "../Opcodes";
import type { HandlerContext, HandlerMap } from "./HandlerTypes";

// PERF: Widget lookup cache - stores recently looked up widgets to avoid repeated Map lookups
// Cache is attached to the handler context so it's cleared between script executions
const WIDGET_CACHE_KEY = Symbol("__widgetLookupCache");
const WIDGET_CACHE_MAX_SIZE = 64;

interface WidgetLookupCache {
    map: Map<number, WidgetNode | null>;
    accessOrder: number[];
}

function getWidgetLookupCache(ctx: HandlerContext): WidgetLookupCache {
    let cache = (ctx as any)[WIDGET_CACHE_KEY] as WidgetLookupCache | undefined;
    if (!cache) {
        cache = { map: new Map(), accessOrder: [] };
        (ctx as any)[WIDGET_CACHE_KEY] = cache;
    }
    return cache;
}

function getCachedWidget(ctx: HandlerContext, uid: number): WidgetNode | null {
    // Skip caching for invalid UIDs
    if (uid <= 0) {
        return ctx.widgetManager.getWidgetByUid(uid) ?? null;
    }

    const cache = getWidgetLookupCache(ctx);

    // Check cache first
    if (cache.map.has(uid)) {
        return cache.map.get(uid) ?? null;
    }

    // Cache miss - look up and cache
    const widget = ctx.widgetManager.getWidgetByUid(uid) ?? null;

    // Evict oldest entry if cache is full
    if (cache.map.size >= WIDGET_CACHE_MAX_SIZE) {
        const oldestUid = cache.accessOrder.shift();
        if (oldestUid !== undefined) {
            cache.map.delete(oldestUid);
        }
    }

    cache.map.set(uid, widget);
    cache.accessOrder.push(uid);

    return widget;
}

// Helper to get widget by UID from stack
function getWidgetFromStack(ctx: HandlerContext): WidgetNode | null {
    const uid = ctx.intStack[--ctx.intStackSize];
    // PERF: Use cached lookup
    return getCachedWidget(ctx, uid);
}

/**
 * Get the target widget for CC_* operations based on intOp.
 * In OSRS, when intOp=1, the "dot" variant (.cc_*) is used, which operates on dotWidget.
 * When intOp=0, the regular variant (cc_*) is used, which operates on activeWidget.
 */
function getTargetWidget(ctx: HandlerContext, intOp: number): WidgetNode | null {
    return intOp === 1 ? ctx.dotWidget : ctx.activeWidget;
}

// references/runelite/.../InterfaceID.java: ToplevelOsm.GAMEFRAME
const MOBILE_TOPLEVEL_GAMEFRAME_UID = 0x02590014;

function getWidgetScriptHeight(ctx: HandlerContext, w: WidgetNode | null | undefined): number {
    const height = w?.height ?? 0;
    if (!w || height <= 0) {
        return height;
    }

    // OSRS mobile root (601) keeps layout in the gameplay canvas space, but the compact
    // mobile arrangement scripts branch on CSS-viewport-sized gameframe heights such as
    // `if_getheight(toplevel_osm:gameframe) < 503`.
    if (
        (ctx.widgetManager?.rootInterface ?? -1) !== 601 ||
        (w.uid | 0) !== MOBILE_TOPLEVEL_GAMEFRAME_UID
    ) {
        return height;
    }

    const viewport = getViewportSize();
    const viewportHeight = Number.isFinite(viewport.height) ? Math.max(0, viewport.height) : 0;
    const rawCanvasHeight = Number(ctx.canvasHeight);
    const canvasHeight = Number.isFinite(rawCanvasHeight) ? Math.max(0, rawCanvasHeight) : 0;
    if (viewportHeight <= 0 || canvasHeight <= 0) {
        return height;
    }

    return Math.max(1, Math.round((height * viewportHeight) / canvasHeight));
}

// Helper to get current clientclock (game ticks)
// OSRS PARITY: Use getClientClock() to match CLIENTCLOCK opcode
function getClientClock(): number {
    return getClientClockFromCycles() | 0;
}

/**
 * Set the target widget for CC_CREATE/CC_FIND operations based on intOp.
 */
function setTargetWidget(ctx: HandlerContext, intOp: number, w: WidgetNode | null): void {
    if (intOp === 1) {
        ctx.setDotWidget(w);
    } else {
        ctx.setActiveWidget(w);
    }
}

/**
 * Pop a CS2 value using the script-var-type id from int stack.
 * Deob parity: class34.method710 -> class180.method4601.
 */
function popValueByScriptVarType(ctx: HandlerContext, scriptVarTypeId: number): any {
    // -1 is used as a null sentinel in script calls that skip a secondary match.
    if ((scriptVarTypeId | 0) === -1) {
        return null;
    }
    // 0 = int
    if ((scriptVarTypeId | 0) === 0) {
        return ctx.popInt() | 0;
    }
    // 2 = string
    if ((scriptVarTypeId | 0) === 2) {
        return ctx.popString();
    }
    throw new Error("RuntimeException");
}

function getParamDefaultValue(ctx: HandlerContext, paramId: number): any {
    const paramType = ctx.paramTypeLoader?.load?.(paramId);
    if (paramType?.isString?.() === true) {
        return paramType.defaultString ?? "";
    }
    return (paramType?.defaultInt ?? 0) | 0;
}

function getWidgetParamValue(ctx: HandlerContext, widget: any, paramId: number): any {
    const raw = widget?.params instanceof Map ? widget.params.get(paramId) : undefined;
    return raw !== undefined ? raw : getParamDefaultValue(ctx, paramId);
}

function getWidgetByUidAndChild(
    ctx: HandlerContext,
    widgetUid: number,
    childIndex: number,
): WidgetNode | null {
    const groupId = (widgetUid >>> 16) & 0xffff;
    if (groupId !== 0) {
        ctx.widgetManager.getGroup(groupId);
    }
    const parent = ctx.widgetManager.getWidgetByUid(widgetUid);
    if (!parent) {
        return null;
    }
    if ((childIndex | 0) === -1) {
        return parent;
    }
    if (childIndex < -1) {
        return null;
    }

    // Dynamic children (CC_CREATE/CC_COPY path).
    if (parent.children && childIndex >= 0 && childIndex < parent.children.length) {
        const child = parent.children[childIndex] as WidgetNode | null;
        if (child) return child;
    }

    // Static IF1/IF3 child fallback: child id is group-local in the low 16 bits.
    const directUid = ((widgetUid >>> 16) << 16) | (childIndex & 0xffff);
    const direct = ctx.widgetManager.getWidgetByUid(directUid);
    if (direct && (direct.parentUid ?? -1) === parent.uid) {
        return direct;
    }

    // Fallback to parentUid index for cases where direct uid lookup is insufficient.
    const staticChildren = ctx.widgetManager.getStaticChildrenByParentUid(parent.uid);
    for (let i = 0; i < staticChildren.length; i++) {
        const child = staticChildren[i];
        if (((child.uid ?? 0) & 0xffff) === (childIndex & 0xffff)) {
            return child;
        }
    }

    return null;
}

// PERF: Pre-defined list of array properties that need cloning
// Avoids runtime iteration over property name strings
const WIDGET_ARRAY_PROPS = [
    "actions",
    "opCursors",
    "opKeys",
    "opKeyRates",
    "opKeyIgnoreHeld",
    "keyChars",
    "keyCodes",
    "keyRepeatRates",
    "keyTimers",
    "onLoad",
    "onResize",
    "onSubChange",
    "onClick",
    "onOp",
    "onHold",
    "onRelease",
    "onMouseOver",
    "onMouseLeave",
    "onMouseRepeat",
    "onClickRepeat",
    "onDrag",
    "onDragComplete",
    "onTargetEnter",
    "onTargetLeave",
    "onVarTransmit",
    "onInvTransmit",
    "onStatTransmit",
    "onMiscTransmit",
    "onChatTransmit",
    "onFriendTransmit",
    "onClanTransmit",
    "onClanSettingsTransmit",
    "onClanChannelTransmit",
    "onStockTransmit",
    "onInputSubmit",
    "onInputAbort",
    "onInputFocusChanged",
    "onInputUpdate",
    "onKey",
    "onScroll",
    "onTimer",
    "varTransmitTriggers",
    "invTransmitTriggers",
    "statTransmitTriggers",
] as const;

function cloneWidgetForCopy(src: any): any {
    // PERF: Shallow clone using spread operator
    const dst: any = { ...src };

    // PERF: Clone only arrays that actually exist on this widget
    // Most widgets only have a few of these, so checking existence is faster than always slicing
    for (let i = 0; i < WIDGET_ARRAY_PROPS.length; i++) {
        const k = WIDGET_ARRAY_PROPS[i];
        const val = src[k];
        if (Array.isArray(val)) {
            dst[k] = val.slice();
        }
    }

    // Clone event handlers object if present
    if (src.eventHandlers && typeof src.eventHandlers === "object") {
        dst.eventHandlers = { ...src.eventHandlers };
    }

    // OSRS parity: clone widget params map (don't share references between copies).
    if (src.params instanceof Map) {
        dst.params = new Map(src.params);
    }

    // Dynamic children should not be shared by default (OSRS copies base widget properties, not live refs).
    dst.children = null;
    return dst;
}

/**
 * PARITY: O(1) helper to invalidate widget layout.
 * Called by setters (CC_SETSIZE, CC_SETPOSITION, etc.) instead of eager layout.
 * The actual layout will happen lazily when a getter reads computed values.
 */
function invalidateWidgetLayout(ctx: HandlerContext, w: WidgetNode): void {
    ctx.widgetManager.invalidateWidget(w);
}

/**
 * PARITY: O(1) helper to invalidate widget render without affecting layout.
 * Called by setters that change visual appearance (CC_SETTEXT, CC_SETSPRITE, etc.)
 * but don't affect widget size/position.
 */
function invalidateWidgetRender(ctx: HandlerContext, w: WidgetNode): void {
    ctx.widgetManager.invalidateWidgetRender(w);
}

/**
 * PARITY: JIT helper to ensure widget layout is valid before reading computed values.
 * Called by getters (CC_GETWIDTH, CC_GETX, etc.) before returning values.
 */
function ensureWidgetLayout(ctx: HandlerContext, w: WidgetNode): void {
    ctx.widgetManager.ensureLayout(w);
}

/**
 * OSRS PARITY/PERF: CC_SETOBJECT derives itemQuantityMode from ItemComposition.isStackable.
 * Reference: MouseHandler.method721 (r215).
 *
 * Cache the computed mode per item id to avoid repeated loader lookups when large interfaces
 * (e.g., bank) rebuild many slots.
 */
const SET_OBJECT_QTY_MODE_CACHE_MAX_SIZE = 2048; // Limit cache size to prevent memory leak

function getSetObjectQuantityMode(ctx: HandlerContext, itemId: number): 1 | 2 {
    if (!(itemId >= 0)) return 2;
    const cache: Map<number, 1 | 2> = ((ctx as any).__setObjectQtyModeCache ??= new Map());
    const cached = cache.get(itemId);
    if (cached) return cached;
    let mode: 1 | 2 = 2;
    try {
        const obj = ctx.objTypeLoader?.load(itemId) as any;
        if ((obj?.stackability ?? 0) === 1) mode = 1;
    } catch {}

    // PERF: Limit cache size to prevent unbounded growth
    // When cache is full, clear it entirely (simple LRU alternative)
    if (cache.size >= SET_OBJECT_QTY_MODE_CACHE_MAX_SIZE) {
        cache.clear();
    }

    cache.set(itemId, mode);
    return mode;
}

function getCurrentWidgetGroupId(ctx: HandlerContext): number {
    // OSRS PARITY: Prefer the event source widget (event_com) as the script's "current"
    // interface context. This is the most reliable indicator of which interface group is
    // executing, even for timer/resize handlers where activeWidget may not be set.
    const eventCom = (ctx.eventContext?.componentId ?? -1) | 0;
    if (eventCom !== -1) return (eventCom >>> 16) & 0xffff;

    return (
        ctx.activeWidget?.groupId ??
        (ctx.cs2Vm?.activeWidget as any)?.groupId ??
        ctx.dotWidget?.groupId ??
        (ctx.cs2Vm?.dotWidget as any)?.groupId ??
        -1
    );
}

export function registerWidgetOps(handlers: HandlerMap): void {
    // === Find/Create/Delete ===
    // Reference: class28.java - 2 args read as array
    handlers.set(Opcodes.CC_FIND, (ctx, intOp) => {
        ctx.intStackSize -= 2;
        const uid = ctx.intStack[ctx.intStackSize];
        const childIndex = ctx.intStack[ctx.intStackSize + 1];

        const parent = ctx.widgetManager.getWidgetByUid(uid);
        let w: WidgetNode | null = null;
        if (parent && parent.children) {
            // Direct index lookup - this is how OSRS works
            // Static widgets from cache are at their array index
            // Dynamic widgets created via CC_CREATE also go at their specified index
            const direct = parent.children[childIndex];
            if (direct) {
                w = direct;
            }
        }

        // OSRS parity (class28): only update scriptActiveWidget/scriptDotWidget on success.
        // On miss, push 0 and keep the previous target widget unchanged.
        if (w) {
            setTargetWidget(ctx, intOp, w);
        }
        ctx.pushInt(w ? 1 : 0);
    });

    handlers.set(Opcodes.IF_FIND, (ctx, intOp) => {
        const uid = ctx.intStack[--ctx.intStackSize];
        const w = ctx.widgetManager.getWidgetByUid(uid);
        // OSRS parity (class28): do not clear target widget when lookup fails.
        if (w) {
            setTargetWidget(ctx, intOp, w);
        }
        ctx.pushInt(w ? 1 : 0);
    });

    // CC_CHILDREN_FIND: Starts iteration over dynamic children of activeWidget
    // Args: intOp (0=activeWidget, 1=dotWidget), startIndex from stack
    handlers.set(Opcodes.CC_CHILDREN_FIND, (ctx, intOp) => {
        const startIndex = ctx.intStack[--ctx.intStackSize];
        const w = getTargetWidget(ctx, intOp);

        // Collect dynamic child indices that exist
        const indices: number[] = [];
        if (w && w.children) {
            for (let i = 0; i < w.children.length; i++) {
                if (w.children[i] && i > startIndex) {
                    indices.push(i);
                }
            }
        }
        indices.sort((a, b) => a - b);

        ctx.childrenIterWidget = w;
        ctx.childrenIterIndices = indices;
        ctx.childrenIterIndex = 0;
    });

    // CC_CHILDREN_FINDNEXTID: Returns the next child index from iteration, or -1 if done
    handlers.set(Opcodes.CC_CHILDREN_FINDNEXTID, (ctx) => {
        if (ctx.childrenIterIndex < ctx.childrenIterIndices.length) {
            ctx.pushInt(ctx.childrenIterIndices[ctx.childrenIterIndex++]);
        } else {
            ctx.pushInt(-1);
        }
    });

    // IF_CHILDREN_FIND: Starts iteration over children of widget from stack
    // Args: widgetUid and startIndex from stack
    handlers.set(Opcodes.IF_CHILDREN_FIND, (ctx, intOp) => {
        const startIndex = ctx.intStack[--ctx.intStackSize];
        const uid = ctx.intStack[--ctx.intStackSize];
        const w = ctx.widgetManager.getWidgetByUid(uid);

        // Collect dynamic child indices that exist
        const indices: number[] = [];
        if (w && w.children) {
            for (let i = 0; i < w.children.length; i++) {
                if (w.children[i] && i > startIndex) {
                    indices.push(i);
                }
            }
        }
        indices.sort((a, b) => a - b);

        ctx.childrenIterWidget = w ?? null;
        ctx.childrenIterIndices = indices;
        ctx.childrenIterIndex = 0;
        setTargetWidget(ctx, intOp, w ?? null);
    });

    // IF_CHILDREN_FINDNEXTID: Same as CC variant - returns next child index or -1
    handlers.set(Opcodes.IF_CHILDREN_FINDNEXTID, (ctx) => {
        if (ctx.childrenIterIndex < ctx.childrenIterIndices.length) {
            ctx.pushInt(ctx.childrenIterIndices[ctx.childrenIterIndex++]);
        } else {
            ctx.pushInt(-1);
        }
    });

    // CC_FINDROOT: Traverses up to the parent widget, sets it as active widget.
    // Used by scripts like script8308/8309 to traverse up the widget hierarchy.
    // Reference: cc_findroot in cs2-scripts - returns true if parent found, false at root
    handlers.set(Opcodes.CC_FINDROOT, (ctx, intOp) => {
        const w = getTargetWidget(ctx, intOp);
        if (!w) {
            ctx.pushInt(0);
            return;
        }

        // Get the parent widget using parentUid
        const parent =
            w.parentUid !== undefined ? ctx.widgetManager.getWidgetByUid(w.parentUid) : null;

        if (parent) {
            // Set the parent as the new active widget
            setTargetWidget(ctx, intOp, parent);
            ctx.pushInt(1);
        } else {
            // Already at root or no parent
            ctx.pushInt(0);
        }
    });

    // CC_PARENTSUBID: Returns the PARENT widget's childIndex, but ONLY if the parent is DYNAMIC.
    // Used by scripts like script8217 to traverse up nested dynamic widget hierarchies.
    // Returns -1 when:
    //   - The active widget has no parent
    //   - The parent is a STATIC widget (fileId >= 0, loaded from cache)
    // This allows the while loop to terminate when we exit the dynamic widget nesting.
    handlers.set(Opcodes.CC_PARENTSUBID, (ctx, intOp) => {
        const w = getTargetWidget(ctx, intOp);
        if (w && w.parentUid !== undefined) {
            const parent = ctx.widgetManager.getWidgetByUid(w.parentUid);
            // Only return childIndex if parent is a DYNAMIC widget (fileId === -1)
            // Static widgets from cache have fileId >= 0 and we return -1 for them
            if (parent && (parent as any).fileId === -1) {
                ctx.pushInt((parent as any)?.childIndex ?? -1);
            } else {
                // Parent is static or root - return -1 to exit the traversal loop
                ctx.pushInt(-1);
            }
        } else {
            ctx.pushInt(-1);
        }
    });

    // CC_CREATE: Reference: class28.java lines 103-107
    // When intOp=1 (dot variant .cc_create), sets dotWidget instead of activeWidget
    //
    // PARITY: Argument count depends on client revision, NOT stack contents.
    // - Older revisions (< 200): 3 args [parentUid, type, childIndex]
    // - Modern revisions (>= 200): 4 args [parentUid, type, childIndex, isNested]
    handlers.set(Opcodes.CC_CREATE, (ctx, intOp) => {
        // PARITY: Argument count is deterministic based on revision
        const IS_MODERN = ctx.clientRevision >= 200;
        const argCount = IS_MODERN ? 4 : 3;

        if (ctx.intStackSize < argCount) {
            throw new Error("RuntimeException");
        }

        // Read deterministic arguments
        ctx.intStackSize -= argCount;
        let parentUid = ctx.intStack[ctx.intStackSize];
        const type = ctx.intStack[ctx.intStackSize + 1];
        const childIndex = ctx.intStack[ctx.intStackSize + 2];

        // Strictly consume the 4th argument if revision requires it
        // isNested is typically unused but must be consumed
        // let isNested = false;
        // if (IS_MODERN) {
        //     isNested = ctx.intStack[ctx.intStackSize + 3] === 1;
        // }

        // Extract groupId for validation and special handling
        let groupId = (parentUid >>> 16) & 0xffff;

        if (groupId === 0) {
            throw new Error("RuntimeException");
        }

        // Ensure the parent's group is loaded before looking up the widget
        // This is critical because getWidgetByUid only checks the cache - it doesn't load groups
        ctx.widgetManager.getGroup(groupId);

        const parent = ctx.widgetManager.getWidgetByUid(parentUid);
        if (!parent) {
            throw new Error("RuntimeException");
        }

        if (!parent.children) parent.children = [];
        if (childIndex > 0 && !parent.children[childIndex - 1]) {
            throw new Error("RuntimeException");
        }
        while (parent.children.length <= childIndex) parent.children.push(null);

        // IMPORTANT: Dynamic widgets must have a unique runtime UID in our client.
        // OSRS identifies dynamic components via (parent id, childIndex), but our input/rendering
        // layers use `uid` as a key. If we derive uid from only (groupId, childIndex),
        // different parents will collide (e.g., bank uses childIndex 0 in multiple containers).
        const newUid =
            typeof (ctx.widgetManager as any).allocateDynamicUid === "function"
                ? (ctx.widgetManager as any).allocateDynamicUid(groupId)
                : ((groupId & 0xffff) << 16) | ((0x8000 + (childIndex & 0x7fff)) & 0xffff);
        const child: any = {
            uid: newUid,
            // OSRS parity: Dynamic children created via CC_CREATE inherit the parent's `id` and
            // use `childIndex` to distinguish children (see class28.java).
            id: parentUid,
            parentUid: parentUid,
            groupId: parent.groupId,
            fileId: -1, // Dynamic child
            type: type,
            contentType: 0,
            childIndex: childIndex,
            isIf3: true,
            hidden: false,
            isHidden: false,
            children: null,
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            rawX: 0,
            rawY: 0,
            rawWidth: 0,
            rawHeight: 0,
            widthMode: 0,
            heightMode: 0,
            xPositionMode: 0,
            yPositionMode: 0,
            // Scroll properties (important for type 0 containers)
            scrollX: 0,
            scrollY: 0,
            scrollWidth: 0,
            scrollHeight: 0,
            itemId: -1,
            itemQuantity: 0,
            isDraggable: false,
            actions: [],
            // OSRS PARITY: Initialize runtime state fields
            rootIndex: -1,
            cycle: -1,
            modelFrame: 0,
            modelFrameCycle: 0,
            aspectWidth: 1,
            aspectHeight: 1,
            isLayoutValid: false,
            // OSRS PARITY: Type 3 (rectangle) defaults
            color: 0, // Default to black (not white 0xffffff)
            textColor: 0,
            filled: false,
            transparency: 0,
            // OSRS PARITY: Type 5 (sprite) defaults
            spriteId: -1,
            spriteId2: -1,
            // OSRS parity: params hash table (IterableNodeHashTable).
            params: new Map(),
        };
        // Place at the specified index - this matches OSRS behavior
        parent.children[childIndex] = child;
        ctx.widgetManager.invalidateDynamicChildrenCache(parent);
        ctx.widgetManager.registerWidget(child);
        setTargetWidget(ctx, intOp, child);
        // OSRS parity: Creating/removing children invalidates the parent for redraw.
        // Reference: FaceNormal.invalidateWidget(var6) in CC_CREATE.
        invalidateWidgetRender(ctx, parent);
    });

    // CC_COPY: Copy an existing dynamic child widget to a new index under the same parent.
    // Used heavily by bank tab building (bankmain_finishbuilding).
    // Expected stack (bottom->top): [parentUid, srcChildIndex, dstChildIndex]
    handlers.set(Opcodes.CC_COPY, (ctx, intOp) => {
        if (ctx.intStackSize < 3) {
            throw new Error("RuntimeException");
        }
        ctx.intStackSize -= 3;
        const parentUid = ctx.intStack[ctx.intStackSize];
        const srcIndex = ctx.intStack[ctx.intStackSize + 1];
        const dstIndex = ctx.intStack[ctx.intStackSize + 2];

        const groupId = (parentUid >>> 16) & 0xffff;
        if (groupId === 0) {
            throw new Error("RuntimeException");
        }

        // Ensure group loaded before lookup (parity with CC_CREATE guard).
        ctx.widgetManager.getGroup(groupId);
        const parent = ctx.widgetManager.getWidgetByUid(parentUid);
        if (!parent || !Array.isArray(parent.children)) {
            throw new Error("RuntimeException");
        }
        const src = parent.children[srcIndex];
        if (!src) {
            throw new Error("RuntimeException");
        }

        // Overwrite destination if present.
        const existing = parent.children[dstIndex];
        if (existing) {
            ctx.widgetManager.unregisterWidgetTree(existing);
            parent.children[dstIndex] = null;
        }
        while (parent.children.length <= dstIndex) parent.children.push(null);

        const newUid =
            typeof (ctx.widgetManager as any).allocateDynamicUid === "function"
                ? (ctx.widgetManager as any).allocateDynamicUid(groupId)
                : ((groupId & 0xffff) << 16) | ((0x8000 + (dstIndex & 0x7fff)) & 0xffff);

        const copy: any = cloneWidgetForCopy(src as any);
        copy.uid = newUid;
        // OSRS parity: dynamic copies are still dynamic children of the parent id.
        copy.id = parentUid;
        copy.parentUid = parentUid;
        copy.groupId = (parent as any).groupId ?? groupId;
        copy.fileId = -1;
        copy.childIndex = dstIndex | 0;
        copy.isIf3 = true;
        copy.hidden = false;
        copy.isHidden = false; // BUGFIX: Sync isHidden for render visibility
        copy.isLayoutValid = false;

        parent.children[dstIndex] = copy;
        ctx.widgetManager.invalidateDynamicChildrenCache(parent);
        ctx.widgetManager.registerWidget(copy);
        setTargetWidget(ctx, intOp, copy);
        // Parity: dynamic child list changed; mark parent dirty for redraw.
        invalidateWidgetRender(ctx, parent);
    });

    handlers.set(Opcodes.CC_DELETE, (ctx, intOp) => {
        const w = getTargetWidget(ctx, intOp);
        if (w && w.parentUid !== undefined) {
            const parent = ctx.widgetManager.getWidgetByUid(w.parentUid);
            if (parent && parent.children) {
                const idx = (w as any).childIndex;
                if (typeof idx === "number" && idx >= 0 && idx < parent.children.length) {
                    if (parent.children[idx] === w) parent.children[idx] = null;
                } else {
                    const found = parent.children.indexOf(w);
                    if (found >= 0) parent.children[found] = null;
                }
                ctx.widgetManager.invalidateDynamicChildrenCache(parent);
            }
            ctx.widgetManager.unregisterWidgetTree(w);
            setTargetWidget(ctx, intOp, null);
            if (parent) invalidateWidgetRender(ctx, parent);
        }
    });

    // CC_DELETEALL: Delete all dynamic children from a widget
    // OSRS reference (class28.java): widget.children = null
    // The children array is ONLY for dynamically created widgets via CC_CREATE
    handlers.set(Opcodes.CC_DELETEALL, (ctx) => {
        const uid = ctx.intStack[--ctx.intStackSize];
        const w = ctx.widgetManager.getWidgetByUid(uid);
        if (w) {
            // Unregister all dynamic children first
            if (w.children) {
                for (const child of w.children) {
                    if (child) {
                        ctx.widgetManager.unregisterWidgetTree(child);
                    }
                }
            }
            // OSRS parity: set children to null, don't preserve the array
            w.children = null;
            ctx.widgetManager.invalidateDynamicChildrenCache(w);
            // OSRS parity: invalidate parent widget for redraw.
            // Reference: FaceNormal.invalidateWidget(var3) in CC_DELETEALL.
            ctx.widgetManager.invalidateWidgetRender(w);
        }
    });

    // CC_CREATECHILD: Creates a dynamic child widget under the current target widget.
    // Used by systems like ui_highlights + tooltips.
    // Stack (bottom->top): [type, childIndex]
    handlers.set(Opcodes.CC_CREATECHILD, (ctx, intOp) => {
        if (ctx.intStackSize < 2) {
            throw new Error("RuntimeException");
        }
        const childIndex = ctx.intStack[--ctx.intStackSize] | 0;
        const type = ctx.intStack[--ctx.intStackSize] | 0;

        const parent = getTargetWidget(ctx, intOp);
        if (!parent) {
            throw new Error("RuntimeException");
        }

        const parentUid = (parent.uid ?? 0) | 0;
        const groupId = (parentUid >>> 16) & 0xffff;
        if (groupId === 0) {
            throw new Error("RuntimeException");
        }

        const newUid =
            typeof (ctx.widgetManager as any).allocateDynamicUid === "function"
                ? (ctx.widgetManager as any).allocateDynamicUid(groupId)
                : ((groupId & 0xffff) << 16) | ((0x8000 + (childIndex & 0x7fff)) & 0xffff);

        const child: any = {
            uid: newUid,
            // OSRS parity: dynamic children identify by (parent id, childIndex).
            id: parentUid,
            parentUid: parentUid,
            groupId: parent.groupId,
            fileId: -1,
            type: type,
            contentType: 0,
            childIndex: childIndex,
            isIf3: true,
            hidden: false,
            isHidden: false,
            children: null,
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            rawX: 0,
            rawY: 0,
            rawWidth: 0,
            rawHeight: 0,
            widthMode: 0,
            heightMode: 0,
            xPositionMode: 0,
            yPositionMode: 0,
            scrollX: 0,
            scrollY: 0,
            scrollWidth: 0,
            scrollHeight: 0,
            itemId: -1,
            itemQuantity: 0,
            isDraggable: false,
            actions: [],
            rootIndex: -1,
            cycle: -1,
            modelFrame: 0,
            modelFrameCycle: 0,
            aspectWidth: 1,
            aspectHeight: 1,
            isLayoutValid: false,
            color: 0,
            textColor: 0,
            filled: false,
            transparency: 0,
            spriteId: -1,
            spriteId2: -1,
            params: new Map(),
        };

        if (!parent.children) parent.children = [];
        while (parent.children.length <= childIndex) parent.children.push(null);
        parent.children[childIndex] = child;
        ctx.widgetManager.invalidateDynamicChildrenCache(parent);
        ctx.widgetManager.registerWidget(child);
        setTargetWidget(ctx, intOp, child);
        invalidateWidgetRender(ctx, parent);
    });

    // CC_CREATESIBLING: Creates a dynamic widget under the current widget's PARENT.
    // Used by scripts that create multiple widgets at the same level (first via cc_createchild,
    // then additional via cc_createsibling).
    // Stack (bottom->top): [type, childIndex]
    handlers.set(Opcodes.CC_CREATESIBLING, (ctx, intOp) => {
        if (ctx.intStackSize < 2) {
            throw new Error("RuntimeException");
        }
        const childIndex = ctx.intStack[--ctx.intStackSize] | 0;
        const type = ctx.intStack[--ctx.intStackSize] | 0;

        const current = getTargetWidget(ctx, intOp);
        const parentUid = (current?.parentUid ?? 0) | 0;
        if (!current || parentUid === 0) {
            throw new Error("RuntimeException");
        }

        const parent = ctx.widgetManager.getWidgetByUid(parentUid);
        if (!parent) {
            throw new Error("RuntimeException");
        }

        const groupId = (parentUid >>> 16) & 0xffff;
        if (groupId === 0) {
            throw new Error("RuntimeException");
        }

        const newUid =
            typeof (ctx.widgetManager as any).allocateDynamicUid === "function"
                ? (ctx.widgetManager as any).allocateDynamicUid(groupId)
                : ((groupId & 0xffff) << 16) | ((0x8000 + (childIndex & 0x7fff)) & 0xffff);

        const sibling: any = {
            uid: newUid,
            // OSRS parity: dynamic children identify by (parent id, childIndex).
            id: parentUid,
            parentUid: parentUid,
            groupId: parent.groupId,
            fileId: -1,
            type: type,
            contentType: 0,
            childIndex: childIndex,
            isIf3: true,
            hidden: false,
            isHidden: false,
            children: null,
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            rawX: 0,
            rawY: 0,
            rawWidth: 0,
            rawHeight: 0,
            widthMode: 0,
            heightMode: 0,
            xPositionMode: 0,
            yPositionMode: 0,
            scrollX: 0,
            scrollY: 0,
            scrollWidth: 0,
            scrollHeight: 0,
            itemId: -1,
            itemQuantity: 0,
            isDraggable: false,
            actions: [],
            rootIndex: -1,
            cycle: -1,
            modelFrame: 0,
            modelFrameCycle: 0,
            aspectWidth: 1,
            aspectHeight: 1,
            isLayoutValid: false,
            color: 0,
            textColor: 0,
            filled: false,
            transparency: 0,
            spriteId: -1,
            spriteId2: -1,
            params: new Map(),
        };

        if (!parent.children) parent.children = [];
        while (parent.children.length <= childIndex) parent.children.push(null);
        parent.children[childIndex] = sibling;
        ctx.widgetManager.invalidateDynamicChildrenCache(parent);
        ctx.widgetManager.registerWidget(sibling);
        setTargetWidget(ctx, intOp, sibling);
        invalidateWidgetRender(ctx, parent);
    });

    handlers.set(Opcodes.IF_FIND_CHILD, (ctx, intOp) => {
        // Deob parity (class147 opcode 210):
        // int stack layout (bottom->top):
        // [parentUid, param1Id, value1, param2Id, value2, value1Type, value2Type]
        //
        // value{1,2} are popped from the appropriate stack using value{1,2}Type.
        // param2Id of -1 disables the second param comparison.
        if (ctx.intStackSize < 5) {
            throw new Error("RuntimeException");
        }

        const value2Type = ctx.popInt() | 0;
        const value1Type = ctx.popInt() | 0;
        const value2 = popValueByScriptVarType(ctx, value2Type);
        const param2Id = ctx.popInt() | 0;
        const value1 = popValueByScriptVarType(ctx, value1Type);
        const param1Id = ctx.popInt() | 0;
        const parentUid = ctx.popInt() | 0;

        ctx.widgetManager.getGroup((parentUid >>> 16) & 0xffff);
        const parent = ctx.widgetManager.getWidgetByUid(parentUid);
        let found: WidgetNode | null = null;

        const matchChild = (child: WidgetNode | null): boolean => {
            if (!child) return false;
            if (param1Id >= 0 && getWidgetParamValue(ctx, child, param1Id) !== value1) {
                return false;
            }
            if (param2Id >= 0 && getWidgetParamValue(ctx, child, param2Id) !== value2) {
                return false;
            }
            found = child;
            return true;
        };

        if (parent) {
            // Dynamic children array (CC_CREATE/CC_COPY).
            if (parent.children) {
                for (let i = 0; i < parent.children.length; i++) {
                    if (matchChild(parent.children[i] as WidgetNode | null)) {
                        break;
                    }
                }
            }

            // Static children fallback (IF3 parents use parentUid linkage).
            if (!found) {
                const staticChildren = ctx.widgetManager.getStaticChildrenByParentUid(parent.uid);
                for (let i = 0; i < staticChildren.length; i++) {
                    const child = staticChildren[i];
                    if (matchChild(child)) {
                        break;
                    }
                }
            }
        }

        setTargetWidget(ctx, intOp, found);
        ctx.pushInt(found ? 1 : 0);
    });

    // CC_GETUID / IF_CHILDREN_FIND (opcode 211)
    // In modern OSRS, this opcode is IF_CHILDREN_FIND which initializes children iteration.
    // Stack: [uid, startIndex] -> initializes iteration over children of widget with given uid
    handlers.set(Opcodes.CC_GETUID, (ctx, intOp) => {
        // IF_CHILDREN_FIND: pop startIndex and uid, initialize children iteration
        const startIndex = ctx.intStack[--ctx.intStackSize];
        const uid = ctx.intStack[--ctx.intStackSize];
        const w = ctx.widgetManager.getWidgetByUid(uid);

        // Collect child indices > startIndex
        const indices: number[] = [];
        if (w && w.children) {
            for (let i = 0; i < w.children.length; i++) {
                if (w.children[i] && i > startIndex) {
                    indices.push(i);
                }
            }
        }
        indices.sort((a, b) => a - b);

        ctx.childrenIterWidget = w ?? null;
        ctx.childrenIterIndices = indices;
        ctx.childrenIterIndex = 0;
    });

    // CC_GETTYPE / IF_CHILDREN_FINDNEXTID (opcode 214)
    // In modern OSRS, this opcode is IF_CHILDREN_FINDNEXTID which returns the next child index.
    // Returns the next child index from iteration, or -1 if no more children.
    handlers.set(Opcodes.CC_GETTYPE, (ctx, intOp) => {
        if (ctx.childrenIterIndex < ctx.childrenIterIndices.length) {
            ctx.pushInt(ctx.childrenIterIndices[ctx.childrenIterIndex++]);
        } else {
            // No more children - return -1 and clear iteration state
            ctx.pushInt(-1);
            ctx.childrenIterIndices = [];
            ctx.childrenIterIndex = 0;
            ctx.childrenIterWidget = null;
        }
    });

    handlers.set(Opcodes.CC_GETID, (ctx, intOp) => {
        const w = getTargetWidget(ctx, intOp);
        if (!w) {
            throw new Error("RuntimeException");
        }
        // OSRS PARITY: CC_GETID returns Widget.childIndex (aka comsubid), NOT Widget.id.
        // Reference: class402.method7522 (ScriptOpcodes.CC_GETID).
        ctx.pushInt((w as any).childIndex ?? -1);
    });

    // === Position and Size ===
    // Reference: FadeInTask.java - 4 args read as array
    handlers.set(Opcodes.CC_SETPOSITION, (ctx, intOp) => {
        ctx.intStackSize -= 4;
        const x = ctx.intStack[ctx.intStackSize];
        const y = ctx.intStack[ctx.intStackSize + 1];
        const xMode = ctx.intStack[ctx.intStackSize + 2];
        const yMode = ctx.intStack[ctx.intStackSize + 3];
        const w = getTargetWidget(ctx, intOp);
        // PERF: Only invalidate if position actually changed
        if (
            w &&
            (w.rawX !== x || w.rawY !== y || w.xPositionMode !== xMode || w.yPositionMode !== yMode)
        ) {
            w.rawX = x;
            w.rawY = y;
            w.xPositionMode = xMode;
            w.yPositionMode = yMode;
            // For absolute positioning (mode 0), also update computed x/y immediately
            // This ensures the renderer sees the new position without waiting for layout
            if (xMode === 0) w.x = x;
            if (yMode === 0) w.y = y;
            // PARITY: Invalidate instead of eager layout
            invalidateWidgetLayout(ctx, w);
        }
    });

    handlers.set(Opcodes.IF_SETPOSITION, (ctx) => {
        // Reference: FadeInTask.java - uid is popped first, then 4 args are read as array
        // Stack (bottom to top): [x, y, xMode, yMode, uid]
        const uid = ctx.intStack[--ctx.intStackSize];
        ctx.intStackSize -= 4;
        const x = ctx.intStack[ctx.intStackSize];
        const y = ctx.intStack[ctx.intStackSize + 1];
        const xMode = ctx.intStack[ctx.intStackSize + 2];
        const yMode = ctx.intStack[ctx.intStackSize + 3];
        const w = ctx.widgetManager.getWidgetByUid(uid);
        // PERF: Only invalidate if position actually changed
        if (
            w &&
            (w.rawX !== x || w.rawY !== y || w.xPositionMode !== xMode || w.yPositionMode !== yMode)
        ) {
            w.rawX = x;
            w.rawY = y;
            w.xPositionMode = xMode;
            w.yPositionMode = yMode;
            // For absolute positioning (mode 0), also update computed x/y immediately
            // This ensures the renderer sees the new position without waiting for layout
            if (xMode === 0) w.x = x;
            if (yMode === 0) w.y = y;
            // PARITY: Invalidate instead of eager layout
            invalidateWidgetLayout(ctx, w);
        }
    });

    // Reference: FadeInTask.java - 4 args read as array
    handlers.set(Opcodes.CC_SETSIZE, (ctx, intOp) => {
        ctx.intStackSize -= 4;
        const width = ctx.intStack[ctx.intStackSize];
        const h = ctx.intStack[ctx.intStackSize + 1];
        const wMode = ctx.intStack[ctx.intStackSize + 2];
        const hMode = ctx.intStack[ctx.intStackSize + 3];
        const w = getTargetWidget(ctx, intOp);
        // PERF: Only invalidate if size actually changed
        if (
            w &&
            (w.rawWidth !== width ||
                w.rawHeight !== h ||
                w.widthMode !== wMode ||
                w.heightMode !== hMode)
        ) {
            w.rawWidth = width;
            w.rawHeight = h;
            w.widthMode = wMode;
            w.heightMode = hMode;
            // PARITY: Invalidate instead of eager layout
            invalidateWidgetLayout(ctx, w);
        }
    });

    handlers.set(Opcodes.IF_SETSIZE, (ctx) => {
        // Reference: FadeInTask.java - uid is popped first, then 4 args are read as array
        // Stack (bottom to top): [width, height, widthMode, heightMode, uid]
        const uid = ctx.intStack[--ctx.intStackSize];
        ctx.intStackSize -= 4;
        const width = ctx.intStack[ctx.intStackSize];
        const h = ctx.intStack[ctx.intStackSize + 1];
        const wMode = ctx.intStack[ctx.intStackSize + 2];
        const hMode = ctx.intStack[ctx.intStackSize + 3];
        const w = ctx.widgetManager.getWidgetByUid(uid);
        // PERF: Only invalidate if size actually changed
        if (
            w &&
            (w.rawWidth !== width ||
                w.rawHeight !== h ||
                w.widthMode !== wMode ||
                w.heightMode !== hMode)
        ) {
            w.rawWidth = width;
            w.rawHeight = h;
            w.widthMode = wMode;
            w.heightMode = hMode;
            // PARITY: Invalidate instead of eager layout
            invalidateWidgetLayout(ctx, w);
        }
    });

    // === Visibility ===
    handlers.set(Opcodes.CC_SETHIDE, (ctx, intOp) => {
        const hidden = ctx.intStack[--ctx.intStackSize] === 1;
        const w = getTargetWidget(ctx, intOp);

        if (w && (w.hidden !== hidden || w.isHidden !== hidden)) {
            w.hidden = hidden;
            w.isHidden = hidden; // BUGFIX: Sync isHidden for render visibility checks
            // PERF/PARITY: Hiding does not change layout dimensions, but showing a widget must
            // re-enable layout for itself + children (we skip layout while hidden).
            if (hidden) invalidateWidgetRender(ctx, w);
            else {
                invalidateWidgetLayout(ctx, w);
                // OSRS parity: Widgets that were hidden can have pending transmit handlers
                // (var/inv/stat) that need to run once they become visible again.
                markWidgetsLoaded();
            }
        }
    });

    handlers.set(Opcodes.IF_SETHIDE, (ctx) => {
        const w = getWidgetFromStack(ctx);
        const hidden = ctx.intStack[--ctx.intStackSize] === 1;

        if (w && (w.hidden !== hidden || w.isHidden !== hidden)) {
            w.hidden = hidden;
            w.isHidden = hidden; // BUGFIX: Sync isHidden for render visibility checks
            // PERF/PARITY: Hiding does not change layout dimensions, but showing a widget must
            // re-enable layout for itself + children (we skip layout while hidden).
            if (hidden) invalidateWidgetRender(ctx, w);
            else {
                invalidateWidgetLayout(ctx, w);
                // OSRS parity: Ensure pending transmit handlers can run after unhide.
                markWidgetsLoaded();
            }
        }
    });

    handlers.set(Opcodes.CC_GETHIDE, (ctx, intOp) => {
        const w = getTargetWidget(ctx, intOp);
        ctx.pushInt(w?.hidden ? 1 : 0);
    });

    handlers.set(Opcodes.IF_GETHIDE, (ctx) => {
        const w = getWidgetFromStack(ctx);
        ctx.pushInt(w?.hidden ? 1 : 0);
    });

    // === Position/Size Getters ===
    // PARITY: All getters call ensureLayout() for JIT layout validation
    // OSRS PARITY: CC_GETX/IF_GETX return Widget.x (computed position relative to parent),
    // not rawX. Scripts like [proc,script8459] accumulate if_getx/if_gety up the parent chain
    // to compute absolute screen position.
    handlers.set(Opcodes.CC_GETX, (ctx, intOp) => {
        const w = getTargetWidget(ctx, intOp);
        if (w) ensureWidgetLayout(ctx, w);
        // OSRS parity: cc_getx always returns the widget's layout-computed x position,
        // even during drag. The drag visual position is separate from the stored position.
        let x = w?.x ?? 0;
        // OSRS PARITY: When running scripts for a mounted (InterfaceParent) sub-interface,
        // the mount container acts as the local origin (0,0) for those scripts.
        //
        // Example: collection_init (2240) looks up the current toplevel mainmodal component via
        // toplevel_getcomponents and reads if_getx/if_gety/if_getwidth/if_getheight from inside
        // the collection log interface (621). Those coordinates are used as the local host bounds.
        //
        // Our engine represents mounted interfaces by attaching the mounted group's roots under
        // the container widget, so without this special-case the container's screen position would
        // leak into the sub-interface script's coordinate space.
        const currentGroupId = getCurrentWidgetGroupId(ctx);
        const mount = w ? ctx.widgetManager.interfaceParents.get(w.uid) : undefined;
        if (mount && (mount.group | 0) === (currentGroupId | 0)) {
            x = 0;
        }
        ctx.pushInt(x);
    });

    handlers.set(Opcodes.IF_GETX, (ctx) => {
        const w = getWidgetFromStack(ctx);
        if (w) ensureWidgetLayout(ctx, w);
        // OSRS parity: if_getx always returns the widget's layout-computed x position.
        let x = w?.x ?? 0;
        const currentGroupId = getCurrentWidgetGroupId(ctx);
        const mount = w ? ctx.widgetManager.interfaceParents.get(w.uid) : undefined;
        if (mount && (mount.group | 0) === (currentGroupId | 0)) {
            x = 0;
        }
        ctx.pushInt(x);
    });

    handlers.set(Opcodes.CC_GETY, (ctx, intOp) => {
        const w = getTargetWidget(ctx, intOp);
        if (w) ensureWidgetLayout(ctx, w);
        // OSRS parity: cc_gety always returns the widget's layout-computed y position,
        // even during drag. The drag visual position is separate from the widget's stored
        // position. CS2 scrollbar scripts use event_mousey (not cc_gety) to track drag.
        let y = w?.y ?? 0;
        const currentGroupId = getCurrentWidgetGroupId(ctx);
        const mount = w ? ctx.widgetManager.interfaceParents.get(w.uid) : undefined;
        if (mount && (mount.group | 0) === (currentGroupId | 0)) {
            y = 0;
        }
        ctx.pushInt(y);
    });

    handlers.set(Opcodes.IF_GETY, (ctx) => {
        const w = getWidgetFromStack(ctx);
        if (w) ensureWidgetLayout(ctx, w);
        // OSRS parity: if_gety always returns the widget's layout-computed y position.
        let y = w?.y ?? 0;
        const currentGroupId = getCurrentWidgetGroupId(ctx);
        const mount = w ? ctx.widgetManager.interfaceParents.get(w.uid) : undefined;
        if (mount && (mount.group | 0) === (currentGroupId | 0)) {
            y = 0;
        }
        ctx.pushInt(y);
    });

    handlers.set(Opcodes.CC_GETWIDTH, (ctx, intOp) => {
        const w = getTargetWidget(ctx, intOp);
        if (w) ensureWidgetLayout(ctx, w);
        ctx.pushInt(w?.width ?? 0);
    });

    handlers.set(Opcodes.IF_GETWIDTH, (ctx) => {
        const w = getWidgetFromStack(ctx);
        if (w) ensureWidgetLayout(ctx, w);
        ctx.pushInt(w?.width ?? 0);
    });

    handlers.set(Opcodes.CC_GETHEIGHT, (ctx, intOp) => {
        const w = getTargetWidget(ctx, intOp);
        if (w) ensureWidgetLayout(ctx, w);
        ctx.pushInt(getWidgetScriptHeight(ctx, w));
    });

    handlers.set(Opcodes.IF_GETHEIGHT, (ctx) => {
        const w = getWidgetFromStack(ctx);
        if (w) ensureWidgetLayout(ctx, w);
        ctx.pushInt(getWidgetScriptHeight(ctx, w));
    });

    handlers.set(Opcodes.CC_GETLAYER, (ctx, intOp) => {
        // OSRS PARITY (r215+): CC_GETLAYER only pushes the widget's parentId (parent widget UID).
        // It does NOT change the active/dot widget selection.
        // Reference: references/runescape-client/src/main/java/class367.java (ScriptOpcodes.CC_GETLAYER).
        const w = getTargetWidget(ctx, intOp);
        let parentUid = w?.parentUid ?? -1;
        if (w && typeof parentUid === "number" && parentUid !== -1) {
            // OSRS parity: mounted interface roots have parentId=-1 in their own widget arrays,
            // even though they are drawn within a mount container (InterfaceParent).
            //
            // Keep the internal parent link for layout/render, but hide it from scripts running
            // inside the mounted interface group so layout/centering logic matches OSRS.
            const currentGroupId = getCurrentWidgetGroupId(ctx);
            const mount = ctx.widgetManager.interfaceParents.get(parentUid);
            if (mount && (mount.group | 0) === (currentGroupId | 0)) {
                parentUid = -1;
            }
        } else if (w && (parentUid | 0) === -1) {
            // OSRS PARITY: Mounted interface roots have parentId=-1, but scripts executing
            // outside the mounted group (e.g., ui_highlights) need to be able to walk the
            // interface hierarchy to compute absolute coordinates. In that case, expose the
            // InterfaceParent container as the logical parent layer.
            const containerUid = ctx.widgetManager.getInterfaceParentContainerUid(w.groupId);
            if (typeof containerUid === "number") {
                const currentGroupId = getCurrentWidgetGroupId(ctx);
                if ((currentGroupId | 0) !== (w.groupId | 0)) {
                    parentUid = containerUid | 0;
                }
            }
        }
        ctx.pushInt(parentUid);
    });

    handlers.set(Opcodes.IF_GETLAYER, (ctx) => {
        const w = getWidgetFromStack(ctx);
        let parentUid = w?.parentUid ?? -1;
        if (w && typeof parentUid === "number" && parentUid !== -1) {
            const currentGroupId = getCurrentWidgetGroupId(ctx);
            const mount = ctx.widgetManager.interfaceParents.get(parentUid);
            if (mount && (mount.group | 0) === (currentGroupId | 0)) {
                parentUid = -1;
            }
        } else if (w && (parentUid | 0) === -1) {
            const containerUid = ctx.widgetManager.getInterfaceParentContainerUid(w.groupId);
            if (typeof containerUid === "number") {
                const currentGroupId = getCurrentWidgetGroupId(ctx);
                if ((currentGroupId | 0) !== (w.groupId | 0)) {
                    parentUid = containerUid | 0;
                }
            }
        }
        ctx.pushInt(parentUid);
    });

    // CC_GETPARENTLAYER: Returns the parent widget in the layout hierarchy.
    // Used by scripts like script8457/8458/8459 to compute absolute coordinates by walking parents.
    handlers.set(Opcodes.CC_GETPARENTLAYER, (ctx, intOp) => {
        const w = getTargetWidget(ctx, intOp);
        let parentUid = w?.parentUid ?? -1;
        if (w && typeof parentUid === "number" && parentUid !== -1) {
            const currentGroupId = getCurrentWidgetGroupId(ctx);
            const mount = ctx.widgetManager.interfaceParents.get(parentUid);
            if (mount && (mount.group | 0) === (currentGroupId | 0)) {
                parentUid = -1;
            }
        } else if (w && (parentUid | 0) === -1) {
            const containerUid = ctx.widgetManager.getInterfaceParentContainerUid(w.groupId);
            if (typeof containerUid === "number") {
                const currentGroupId = getCurrentWidgetGroupId(ctx);
                if ((currentGroupId | 0) !== (w.groupId | 0)) {
                    parentUid = containerUid | 0;
                }
            }
        }
        ctx.pushInt(parentUid);
    });

    // IF_GETPARENTLAYER: Returns the parent widget in the layout hierarchy.
    handlers.set(Opcodes.IF_GETPARENTLAYER, (ctx) => {
        const w = getWidgetFromStack(ctx);
        let parentUid = w?.parentUid ?? -1;
        if (w && typeof parentUid === "number" && parentUid !== -1) {
            // OSRS parity: mounted interface roots have parentId=-1 from the script's POV.
            // Only hide the mount container link for scripts executing inside that mounted group.
            const currentGroupId = getCurrentWidgetGroupId(ctx);
            const mount = ctx.widgetManager.interfaceParents.get(parentUid);
            if (mount && (mount.group | 0) === (currentGroupId | 0)) {
                parentUid = -1;
            }
        } else if (w && (parentUid | 0) === -1) {
            const containerUid = ctx.widgetManager.getInterfaceParentContainerUid(w.groupId);
            if (typeof containerUid === "number") {
                const currentGroupId = getCurrentWidgetGroupId(ctx);
                if ((currentGroupId | 0) !== (w.groupId | 0)) {
                    parentUid = containerUid | 0;
                }
            }
        }
        ctx.pushInt(parentUid);
    });

    // === Text ===
    handlers.set(Opcodes.CC_SETTEXT, (ctx, intOp) => {
        const text = ctx.stringStack[--ctx.stringStackSize];
        const w = getTargetWidget(ctx, intOp);
        if (w) {
            // PERF: Only invalidate if value actually changed
            if (w.text !== text) {
                w.text = text;
                markWidgetInteractionDirty(w);
                invalidateWidgetRender(ctx, w);
            }
        }
    });

    handlers.set(Opcodes.IF_SETTEXT, (ctx) => {
        // Pop order: widget first (top of intStack), then text (from stringStack)
        const w = getWidgetFromStack(ctx);
        const text = ctx.stringStack[--ctx.stringStackSize];
        if (w) {
            // PERF: Only invalidate if value actually changed
            if (w.text !== text) {
                w.text = text;
                markWidgetInteractionDirty(w);
                invalidateWidgetRender(ctx, w);
            }
        }
    });

    handlers.set(Opcodes.CC_GETTEXT, (ctx, intOp) => {
        const w = getTargetWidget(ctx, intOp);
        ctx.pushString(w?.text || "");
    });

    handlers.set(Opcodes.IF_GETTEXT, (ctx) => {
        const w = getWidgetFromStack(ctx);
        ctx.pushString(w?.text || "");
    });

    handlers.set(Opcodes.CC_SETTEXTFONT, (ctx, intOp) => {
        const fontId = ctx.intStack[--ctx.intStackSize];
        const w = getTargetWidget(ctx, intOp);
        if (w && w.fontId !== fontId) {
            w.fontId = fontId;
            invalidateWidgetRender(ctx, w);
        }
    });

    handlers.set(Opcodes.IF_SETTEXTFONT, (ctx) => {
        // Pop order: widget first (top), then fontId
        const w = getWidgetFromStack(ctx);
        const fontId = ctx.intStack[--ctx.intStackSize];
        if (w && w.fontId !== fontId) {
            w.fontId = fontId;
            invalidateWidgetRender(ctx, w);
        }
    });

    handlers.set(Opcodes.CC_SETTEXTALIGN, (ctx, intOp) => {
        // Reference: class131.java - 3 args read as array
        ctx.intStackSize -= 3;
        const xAlign = ctx.intStack[ctx.intStackSize];
        const yAlign = ctx.intStack[ctx.intStackSize + 1];
        const lineHeight = ctx.intStack[ctx.intStackSize + 2];
        const w = getTargetWidget(ctx, intOp);
        if (
            w &&
            (w.xTextAlignment !== xAlign ||
                w.yTextAlignment !== yAlign ||
                w.lineHeight !== lineHeight)
        ) {
            w.xTextAlignment = xAlign;
            w.yTextAlignment = yAlign;
            w.lineHeight = lineHeight;
            invalidateWidgetRender(ctx, w);
        }
    });

    handlers.set(Opcodes.IF_SETTEXTALIGN, (ctx) => {
        // Reference: class131.java - uid is popped first, then 3 args are read as array
        // Stack (bottom to top): [xAlign, yAlign, lineHeight, uid]
        const uid = ctx.intStack[--ctx.intStackSize];
        ctx.intStackSize -= 3;
        const xAlign = ctx.intStack[ctx.intStackSize];
        const yAlign = ctx.intStack[ctx.intStackSize + 1];
        const lineHeight = ctx.intStack[ctx.intStackSize + 2];
        const w = ctx.widgetManager.getWidgetByUid(uid);
        if (
            w &&
            (w.xTextAlignment !== xAlign ||
                w.yTextAlignment !== yAlign ||
                w.lineHeight !== lineHeight)
        ) {
            w.xTextAlignment = xAlign;
            w.yTextAlignment = yAlign;
            w.lineHeight = lineHeight;
            invalidateWidgetRender(ctx, w);
        }
    });

    handlers.set(Opcodes.CC_SETTEXTSHADOW, (ctx, intOp) => {
        const shadow = ctx.intStack[--ctx.intStackSize] === 1;
        const w = getTargetWidget(ctx, intOp);
        if (w && w.textShadow !== shadow) {
            w.textShadow = shadow;
            invalidateWidgetRender(ctx, w);
        }
    });

    handlers.set(Opcodes.IF_SETTEXTSHADOW, (ctx) => {
        // Pop order: widget first (top), then shadow
        const w = getWidgetFromStack(ctx);
        const shadow = ctx.intStack[--ctx.intStackSize] === 1;
        if (w && w.textShadow !== shadow) {
            w.textShadow = shadow;
            invalidateWidgetRender(ctx, w);
        }
    });

    // === Color ===
    handlers.set(Opcodes.CC_SETCOLOUR, (ctx, intOp) => {
        const color = ctx.intStack[--ctx.intStackSize];
        const w = getTargetWidget(ctx, intOp);
        if (w && w.color !== color) {
            // OSRS parity: Widget.color is used for both text and rectangle widgets.
            // We keep `textColor` for legacy naming but mirror into `color` too.
            w.textColor = color;
            w.color = color;
            invalidateWidgetRender(ctx, w);
        }
    });

    handlers.set(Opcodes.IF_SETCOLOUR, (ctx) => {
        // Pop order: widget first (top), then color
        const w = getWidgetFromStack(ctx);
        const color = ctx.intStack[--ctx.intStackSize];
        if (w && w.color !== color) {
            w.textColor = color;
            w.color = color;
            invalidateWidgetRender(ctx, w);
        }
    });

    handlers.set(Opcodes.CC_GETCOLOUR, (ctx, intOp) => {
        const w = getTargetWidget(ctx, intOp);
        ctx.pushInt((w?.color ?? w?.textColor ?? 0) | 0);
    });

    handlers.set(Opcodes.IF_GETCOLOUR, (ctx) => {
        const w = getWidgetFromStack(ctx);
        ctx.pushInt((w?.color ?? w?.textColor ?? 0) | 0);
    });

    handlers.set(Opcodes.CC_SETFILLCOLOUR, (ctx, intOp) => {
        const color = ctx.intStack[--ctx.intStackSize];
        const w = getTargetWidget(ctx, intOp);
        if (w) {
            // OSRS parity: CC_SETFILLCOLOUR sets Widget.color2 (secondary color).
            w.color2 = color;
            // Legacy alias (unused by renderer, but keep in sync just in case).
            (w as any).fillColor = color;
            invalidateWidgetRender(ctx, w);
        }
    });

    handlers.set(Opcodes.IF_SETFILLCOLOUR, (ctx) => {
        // Pop order: widget first (top), then color
        const w = getWidgetFromStack(ctx);
        const color = ctx.intStack[--ctx.intStackSize];
        if (w) {
            w.color2 = color;
            (w as any).fillColor = color;
            invalidateWidgetRender(ctx, w);
        }
    });

    handlers.set(Opcodes.CC_GETFILLCOLOUR, (ctx, intOp) => {
        const w = getTargetWidget(ctx, intOp);
        ctx.pushInt(((w?.color2 ?? (w as any)?.fillColor ?? 0) as number) | 0);
    });

    handlers.set(Opcodes.IF_GETFILLCOLOUR, (ctx) => {
        const w = getWidgetFromStack(ctx);
        ctx.pushInt(((w?.color2 ?? (w as any)?.fillColor ?? 0) as number) | 0);
    });

    // Opcode 1124 (unnamed in ScriptOpcodes): sets bottom transparency for gradient fills.
    handlers.set(Opcodes.CC_SETTRANSBOT, (ctx, intOp) => {
        const transBot = ctx.intStack[--ctx.intStackSize];
        const w = getTargetWidget(ctx, intOp);
        if (w) {
            w.transparencyBot = transBot;
            invalidateWidgetRender(ctx, w);
        }
    });

    // Opcode 1125 (unnamed in ScriptOpcodes): sets fill mode enum.
    handlers.set(Opcodes.CC_SETFILLMODE, (ctx, intOp) => {
        const mode = ctx.intStack[--ctx.intStackSize];
        const w = getTargetWidget(ctx, intOp);
        if (w) {
            // 0=SOLID, 1=GRADIENT_VERTICAL, 2=GRADIENT_ALPHA (OSRS FillMode)
            if (mode === 0 || mode === 1 || mode === 2) {
                w.fillMode = mode;
                invalidateWidgetRender(ctx, w);
            }
        }
    });

    // === Transparency ===
    handlers.set(Opcodes.CC_SETTRANS, (ctx, intOp) => {
        const trans = ctx.intStack[--ctx.intStackSize];
        const w = getTargetWidget(ctx, intOp);
        if (w) {
            if (w.transparency !== trans) {
                w.transparency = trans;
                // OSRS parity: repaint only (no layout invalidation).
                invalidateWidgetRender(ctx, w);
            }
        }
    });

    handlers.set(Opcodes.IF_SETTRANS, (ctx) => {
        // Pop order: widget first (top), then trans
        const w = getWidgetFromStack(ctx);
        const trans = ctx.intStack[--ctx.intStackSize];
        if (w) {
            if (w.transparency !== trans) {
                w.transparency = trans;
                invalidateWidgetRender(ctx, w);
            }
        }
    });

    handlers.set(Opcodes.CC_GETTRANS, (ctx, intOp) => {
        const w = getTargetWidget(ctx, intOp);
        ctx.pushInt(w?.transparency ?? 0);
    });

    handlers.set(Opcodes.IF_GETTRANS, (ctx) => {
        const w = getWidgetFromStack(ctx);
        ctx.pushInt(w?.transparency ?? 0);
    });

    // === Fill ===
    handlers.set(Opcodes.CC_SETFILL, (ctx, intOp) => {
        const filled = ctx.intStack[--ctx.intStackSize] === 1;
        const w = getTargetWidget(ctx, intOp);
        if (w) {
            w.filled = filled;
            invalidateWidgetRender(ctx, w);
        }
    });

    handlers.set(Opcodes.IF_SETFILL, (ctx) => {
        // Pop order: widget first (top), then filled
        const w = getWidgetFromStack(ctx);
        const filled = ctx.intStack[--ctx.intStackSize] === 1;
        if (w) {
            w.filled = filled;
            invalidateWidgetRender(ctx, w);
        }
    });

    // === Line ===
    handlers.set(Opcodes.CC_SETLINEWID, (ctx, intOp) => {
        const width = ctx.intStack[--ctx.intStackSize];
        const w = getTargetWidget(ctx, intOp);
        if (w) {
            w.lineWidth = width;
            invalidateWidgetRender(ctx, w);
        }
    });

    handlers.set(Opcodes.IF_SETLINEWID, (ctx) => {
        // Pop order: widget first (top), then width
        const w = getWidgetFromStack(ctx);
        const width = ctx.intStack[--ctx.intStackSize];
        if (w) {
            w.lineWidth = width;
            invalidateWidgetRender(ctx, w);
        }
    });

    handlers.set(Opcodes.CC_SETLINEDIRECTION, (ctx, intOp) => {
        const direction = ctx.intStack[--ctx.intStackSize] === 1;
        const w = getTargetWidget(ctx, intOp);
        if (w) {
            w.lineDirection = direction;
            invalidateWidgetRender(ctx, w);
        }
    });

    handlers.set(Opcodes.IF_SETLINEDIRECTION, (ctx) => {
        // Pop order: widget first (top), then direction
        const w = getWidgetFromStack(ctx);
        const direction = ctx.intStack[--ctx.intStackSize] === 1;
        if (w) {
            w.lineDirection = direction;
            invalidateWidgetRender(ctx, w);
        }
    });

    // === Outline ===
    handlers.set(Opcodes.CC_SETOUTLINE, (ctx, intOp) => {
        const outline = ctx.intStack[--ctx.intStackSize];
        const w = getTargetWidget(ctx, intOp);
        if (w) {
            w.borderType = outline;
            invalidateWidgetRender(ctx, w);
        }
    });

    handlers.set(Opcodes.IF_SETOUTLINE, (ctx) => {
        // Pop order: widget first (top), then outline
        const w = getWidgetFromStack(ctx);
        const outline = ctx.intStack[--ctx.intStackSize];
        if (w) {
            w.borderType = outline;
            invalidateWidgetRender(ctx, w);
        }
    });

    // === Graphics ===
    handlers.set(Opcodes.CC_SETGRAPHIC, (ctx, intOp) => {
        const id = ctx.intStack[--ctx.intStackSize];
        const w = getTargetWidget(ctx, intOp);
        // PERF: Only invalidate if value changed
        if (w && w.spriteId !== id) {
            // OSRS sets Widget.spriteId here.
            w.spriteId = id;
            invalidateWidgetRender(ctx, w);
        }
    });

    // Opcode 1122 (unnamed in ScriptOpcodes): sets Widget.spriteId2 (alternate sprite)
    handlers.set(Opcodes.CC_SETGRAPHIC2, (ctx, intOp) => {
        const id = ctx.intStack[--ctx.intStackSize];
        const w = getTargetWidget(ctx, intOp);
        if (w && w.spriteId2 !== id) {
            w.spriteId2 = id;
            invalidateWidgetRender(ctx, w);
        }
    });

    handlers.set(Opcodes.IF_SETGRAPHIC, (ctx) => {
        // lostcity reference: [spriteId (bottom), widget (top)]
        // Pop order: widget first (top), then spriteId (bottom)
        const w = getWidgetFromStack(ctx);
        const id = ctx.intStack[--ctx.intStackSize];
        // PERF: Only invalidate if value changed
        if (w && w.spriteId !== id) {
            // OSRS sets Widget.spriteId here.
            w.spriteId = id;
            invalidateWidgetRender(ctx, w);
        }
    });

    handlers.set(Opcodes.CC_SET2DANGLE, (ctx, intOp) => {
        const angle = ctx.intStack[--ctx.intStackSize];
        const w = getTargetWidget(ctx, intOp);
        if (w && w.spriteAngle !== angle) {
            w.spriteAngle = angle;
            invalidateWidgetRender(ctx, w);
        }
    });

    handlers.set(Opcodes.IF_SET2DANGLE, (ctx) => {
        // Pop order: widget first (top), then angle
        const w = getWidgetFromStack(ctx);
        const angle = ctx.intStack[--ctx.intStackSize];
        if (w && w.spriteAngle !== angle) {
            w.spriteAngle = angle;
            invalidateWidgetRender(ctx, w);
        }
    });

    handlers.set(Opcodes.CC_SETTILING, (ctx, intOp) => {
        const tiling = ctx.intStack[--ctx.intStackSize] === 1;
        const w = getTargetWidget(ctx, intOp);
        if (w && w.spriteTiling !== tiling) {
            w.spriteTiling = tiling;
            invalidateWidgetRender(ctx, w);
        }
    });

    handlers.set(Opcodes.IF_SETTILING, (ctx) => {
        // Pop order: widget first (top), then tiling
        const w = getWidgetFromStack(ctx);
        const tiling = ctx.intStack[--ctx.intStackSize] === 1;
        if (w && w.spriteTiling !== tiling) {
            w.spriteTiling = tiling;
            invalidateWidgetRender(ctx, w);
        }
    });

    handlers.set(Opcodes.CC_SETGRAPHICSHADOW, (ctx, intOp) => {
        const color = ctx.intStack[--ctx.intStackSize];
        const w = getTargetWidget(ctx, intOp);
        if (w && w.graphicShadow !== color) {
            w.graphicShadow = color;
            invalidateWidgetRender(ctx, w);
        }
    });

    handlers.set(Opcodes.IF_SETGRAPHICSHADOW, (ctx) => {
        // Pop order: widget first (top), then color
        const w = getWidgetFromStack(ctx);
        const color = ctx.intStack[--ctx.intStackSize];
        if (w && w.graphicShadow !== color) {
            w.graphicShadow = color;
            invalidateWidgetRender(ctx, w);
        }
    });

    handlers.set(Opcodes.CC_SETVFLIP, (ctx, intOp) => {
        const flip = ctx.intStack[--ctx.intStackSize] === 1;
        const w = getTargetWidget(ctx, intOp);
        if (w && w.verticalFlip !== flip) {
            w.verticalFlip = flip;
            invalidateWidgetRender(ctx, w);
        }
    });

    handlers.set(Opcodes.IF_SETVFLIP, (ctx) => {
        // Pop order: widget first (top), then flip
        const w = getWidgetFromStack(ctx);
        const flip = ctx.intStack[--ctx.intStackSize] === 1;
        if (w) {
            w.verticalFlip = flip;
            invalidateWidgetRender(ctx, w);
        }
    });

    handlers.set(Opcodes.CC_SETHFLIP, (ctx, intOp) => {
        const flip = ctx.intStack[--ctx.intStackSize] === 1;
        const w = getTargetWidget(ctx, intOp);
        if (w) {
            w.horizontalFlip = flip;
            invalidateWidgetRender(ctx, w);
        }
    });

    handlers.set(Opcodes.IF_SETHFLIP, (ctx) => {
        // Pop order: widget first (top), then flip
        const w = getWidgetFromStack(ctx);
        const flip = ctx.intStack[--ctx.intStackSize] === 1;
        if (w) {
            w.horizontalFlip = flip;
            invalidateWidgetRender(ctx, w);
        }
    });

    // === Model ===
    // Reference: class131.java - model ops call FaceNormal.invalidateWidget()
    handlers.set(Opcodes.CC_SETMODEL, (ctx, intOp) => {
        const modelId = ctx.intStack[--ctx.intStackSize];
        const w = getTargetWidget(ctx, intOp);
        if (w) {
            w.modelType = 1;
            w.modelId = modelId;
            // OSRS parity: invalidate on model change
            invalidateWidgetRender(ctx, w);
        }
    });

    handlers.set(Opcodes.IF_SETMODEL, (ctx) => {
        // Pop order: widget first (top), then modelId
        const w = getWidgetFromStack(ctx);
        const modelId = ctx.intStack[--ctx.intStackSize];
        if (w) {
            w.modelType = 1;
            w.modelId = modelId;
            // OSRS parity: invalidate on model change
            invalidateWidgetRender(ctx, w);
        }
    });

    handlers.set(Opcodes.CC_SETMODELANGLE, (ctx, intOp) => {
        // Reference: class131.java - 6 args read as array
        ctx.intStackSize -= 6;
        const offsetX = ctx.intStack[ctx.intStackSize];
        const offsetY = ctx.intStack[ctx.intStackSize + 1];
        const angleX = ctx.intStack[ctx.intStackSize + 2];
        const angleY = ctx.intStack[ctx.intStackSize + 3];
        const angleZ = ctx.intStack[ctx.intStackSize + 4];
        const zoom = ctx.intStack[ctx.intStackSize + 5];
        const w = getTargetWidget(ctx, intOp);
        if (w) {
            // OSRS parity: these are the IF3 model offsets + angles.
            w.modelOffsetX = offsetX;
            w.modelOffsetY = offsetY;
            // Keep both naming conventions in sync.
            w.modelAngleX = angleX;
            w.modelAngleY = angleY;
            w.modelAngleZ = angleZ;
            w.rotationX = angleX;
            w.rotationY = angleY;
            w.rotationZ = angleZ;
            w.modelZoom = zoom;
            // OSRS parity: invalidate on model angle change
            invalidateWidgetRender(ctx, w);
        }
    });

    handlers.set(Opcodes.IF_SETMODELANGLE, (ctx) => {
        // Reference: class131.java - uid is popped first, then 6 args are read as array
        // Stack (bottom to top): [offsetX, offsetY, angleX, angleY, angleZ, zoom, uid]
        const uid = ctx.intStack[--ctx.intStackSize];
        ctx.intStackSize -= 6;
        const offsetX = ctx.intStack[ctx.intStackSize];
        const offsetY = ctx.intStack[ctx.intStackSize + 1];
        const angleX = ctx.intStack[ctx.intStackSize + 2];
        const angleY = ctx.intStack[ctx.intStackSize + 3];
        const angleZ = ctx.intStack[ctx.intStackSize + 4];
        const zoom = ctx.intStack[ctx.intStackSize + 5];
        const w = ctx.widgetManager.getWidgetByUid(uid);
        if (w) {
            w.modelOffsetX = offsetX;
            w.modelOffsetY = offsetY;
            w.modelAngleX = angleX;
            w.modelAngleY = angleY;
            w.modelAngleZ = angleZ;
            w.rotationX = angleX;
            w.rotationY = angleY;
            w.rotationZ = angleZ;
            w.modelZoom = zoom;
            // OSRS parity: invalidate on model angle change
            invalidateWidgetRender(ctx, w);
        }
    });

    handlers.set(Opcodes.CC_SETMODELANIM, (ctx, intOp) => {
        const seq = ctx.intStack[--ctx.intStackSize];
        const w = getTargetWidget(ctx, intOp);
        if (w) {
            // OSRS parity: Only invalidate if sequence actually changed
            // Reference: class131.java lines 342-349 - checks var16 != var3.sequenceId
            if (seq !== w.sequenceId) {
                w.sequenceId = seq;
                w.modelFrame = 0;
                w.modelFrameCycle = 0;
                invalidateWidgetRender(ctx, w);
            }
        }
    });

    handlers.set(Opcodes.IF_SETMODELANIM, (ctx) => {
        // Pop order: widget first (top), then seq
        const w = getWidgetFromStack(ctx);
        const seq = ctx.intStack[--ctx.intStackSize];
        if (w) {
            // OSRS parity: Only invalidate if sequence actually changed
            if (seq !== w.sequenceId) {
                w.sequenceId = seq;
                w.modelFrame = 0;
                w.modelFrameCycle = 0;
                invalidateWidgetRender(ctx, w);
            }
        }
    });

    handlers.set(Opcodes.CC_SETMODELORTHOG, (ctx, intOp) => {
        const orthog = ctx.intStack[--ctx.intStackSize] === 1;
        const w = getTargetWidget(ctx, intOp);
        if (w) {
            w.modelOrthog = orthog;
            // OSRS parity: invalidate on orthog change
            invalidateWidgetRender(ctx, w);
        }
    });

    handlers.set(Opcodes.IF_SETMODELORTHOG, (ctx) => {
        // Pop order: widget first (top), then orthog
        const w = getWidgetFromStack(ctx);
        const orthog = ctx.intStack[--ctx.intStackSize] === 1;
        if (w) {
            w.modelOrthog = orthog;
            // OSRS parity: invalidate on orthog change
            invalidateWidgetRender(ctx, w);
        }
    });

    handlers.set(Opcodes.CC_SETMODELTRANSPARENT, (ctx, intOp) => {
        const transparent = ctx.intStack[--ctx.intStackSize] === 1;
        const w = getTargetWidget(ctx, intOp);
        if (w) w.modelTransparent = transparent;
    });

    handlers.set(Opcodes.IF_SETMODELTRANSPARENT, (ctx) => {
        // Pop order: widget first (top), then transparent
        const w = getWidgetFromStack(ctx);
        const transparent = ctx.intStack[--ctx.intStackSize] === 1;
        if (w) w.modelTransparent = transparent;
    });

    // === Model getters ===
    handlers.set(Opcodes.CC_GETMODELZOOM, (ctx, intOp) => {
        const w = getTargetWidget(ctx, intOp);
        ctx.pushInt(w?.modelZoom ?? 0);
    });

    handlers.set(Opcodes.IF_GETMODELZOOM, (ctx) => {
        const w = getWidgetFromStack(ctx);
        ctx.pushInt(w?.modelZoom ?? 0);
    });

    handlers.set(Opcodes.CC_GETMODELANGLE_X, (ctx, intOp) => {
        const w = getTargetWidget(ctx, intOp);
        ctx.pushInt((w?.rotationX ?? w?.modelAngleX ?? 0) | 0);
    });

    handlers.set(Opcodes.IF_GETMODELANGLE_X, (ctx) => {
        const w = getWidgetFromStack(ctx);
        ctx.pushInt((w?.rotationX ?? w?.modelAngleX ?? 0) | 0);
    });

    handlers.set(Opcodes.CC_GETMODELANGLE_Y, (ctx, intOp) => {
        const w = getTargetWidget(ctx, intOp);
        ctx.pushInt((w?.rotationY ?? w?.modelAngleY ?? 0) | 0);
    });

    handlers.set(Opcodes.IF_GETMODELANGLE_Y, (ctx) => {
        const w = getWidgetFromStack(ctx);
        ctx.pushInt((w?.rotationY ?? w?.modelAngleY ?? 0) | 0);
    });

    handlers.set(Opcodes.CC_GETMODELANGLE_Z, (ctx, intOp) => {
        const w = getTargetWidget(ctx, intOp);
        ctx.pushInt((w?.rotationZ ?? w?.modelAngleZ ?? 0) | 0);
    });

    handlers.set(Opcodes.IF_GETMODELANGLE_Z, (ctx) => {
        const w = getWidgetFromStack(ctx);
        ctx.pushInt((w?.rotationZ ?? w?.modelAngleZ ?? 0) | 0);
    });

    handlers.set(Opcodes.CC_GETMODELTRANSPARENT, (ctx, intOp) => {
        const w = getTargetWidget(ctx, intOp);
        ctx.pushInt(w?.modelTransparent ? 1 : 0);
    });

    handlers.set(Opcodes.IF_GETMODELTRANSPARENT, (ctx) => {
        const w = getWidgetFromStack(ctx);
        ctx.pushInt(w?.modelTransparent ? 1 : 0);
    });

    // === NPC/Player Heads ===
    // Reference: These follow the same pattern as CC_SETMODEL for invalidation
    handlers.set(Opcodes.CC_SETNPCHEAD, (ctx, intOp) => {
        const npcId = ctx.intStack[--ctx.intStackSize];
        const w = getTargetWidget(ctx, intOp);
        if (w) {
            w.modelType = 2;
            w.modelId = npcId;
            // OSRS parity: invalidate on model change
            invalidateWidgetRender(ctx, w);
        }
    });

    handlers.set(Opcodes.IF_SETNPCHEAD, (ctx) => {
        // Pop order: widget first (top), then npcId
        const w = getWidgetFromStack(ctx);
        const npcId = ctx.intStack[--ctx.intStackSize];
        if (w) {
            w.modelType = 2;
            w.modelId = npcId;
            // OSRS parity: invalidate on model change
            invalidateWidgetRender(ctx, w);
        }
    });

    handlers.set(Opcodes.CC_SETPLAYERHEAD_SELF, (ctx, intOp) => {
        const w = getTargetWidget(ctx, intOp);
        if (w) {
            w.modelType = 3;
            w.modelId = -1;
            // OSRS parity: invalidate on model change
            invalidateWidgetRender(ctx, w);
        }
    });

    handlers.set(Opcodes.IF_SETPLAYERHEAD_SELF, (ctx) => {
        const w = getWidgetFromStack(ctx);
        if (w) {
            w.modelType = 3;
            w.modelId = -1;
            // OSRS parity: invalidate on model change
            invalidateWidgetRender(ctx, w);
        }
    });

    // cc_setplayermodel_self(keepEquipment)
    // Reference: MouseHandler.method721 opcode 1207 -> NPC.method2717(widget, localPlayer.appearance, keepEquipment)
    handlers.set(Opcodes.CC_SETPLAYERMODEL_SELF, (ctx, intOp) => {
        const keepEquipment = ctx.intStack[--ctx.intStackSize] === 1;
        const w = getTargetWidget(ctx, intOp);
        if (!w) {
            throw new Error("RuntimeException");
        }

        w.modelType = 7;
        w.modelId = -1;
        (w as any).isPlayerModel = true;
        (w as any).playerModelKeepEquipment = keepEquipment;

        try {
            const osrsClient = (ctx.widgetManager as any).osrsClient;
            const playerEcs = osrsClient?.playerEcs;
            const localServerId = osrsClient?.controlledPlayerServerId;
            const idx =
                playerEcs && typeof playerEcs.getIndexForServerId === "function"
                    ? playerEcs.getIndexForServerId(localServerId)
                    : undefined;
            const appearance =
                (osrsClient as any)?.playerDesignAppearance ??
                (idx !== undefined ? playerEcs?.getAppearance?.(idx) : undefined);
            if (appearance) {
                const copy = {
                    gender: appearance.gender,
                    colors: Array.from(appearance.colors ?? []),
                    kits: Array.from(appearance.kits ?? []),
                    equip: Array.from(appearance.equip ?? []),
                };
                if (!keepEquipment) {
                    copy.equip = new Array(Math.max(14, copy.equip.length)).fill(-1);
                }
                (w as any).playerAppearance = copy;
            }
        } catch {}

        invalidateWidgetRender(ctx, w);
    });

    handlers.set(Opcodes.CC_SETMODEL_PLAYERCHATHEAD, (ctx, intOp) => {
        const modelId = ctx.intStack[--ctx.intStackSize];
        const w = getTargetWidget(ctx, intOp);
        if (!w) {
            throw new Error("RuntimeException");
        }
        w.modelType = 8;
        w.modelId = modelId;
        invalidateWidgetRender(ctx, w);
    });

    handlers.set(Opcodes.IF_SETMODEL_PLAYERCHATHEAD, (ctx) => {
        const w = getWidgetFromStack(ctx);
        const modelId = ctx.intStack[--ctx.intStackSize];
        if (!w) {
            throw new Error("RuntimeException");
        }
        w.modelType = 8;
        w.modelId = modelId;
        invalidateWidgetRender(ctx, w);
    });

    // === Scroll ===
    // cc_setscrollpos(scrollX, scrollY) - sets both scroll positions on target widget
    // Reference: class131.java - 2 args read as array
    handlers.set(Opcodes.CC_SETSCROLLPOS, (ctx, intOp) => {
        ctx.intStackSize -= 2;
        const scrollX = ctx.intStack[ctx.intStackSize];
        const scrollY = ctx.intStack[ctx.intStackSize + 1];
        const w = getTargetWidget(ctx, intOp);
        if (w) {
            // OSRS parity: scroll clamping uses the widget's current computed width/height.
            ensureWidgetLayout(ctx, w);
            const maxX = Math.max(0, (w.scrollWidth ?? 0) - (w.width ?? 0));
            const maxY = Math.max(0, (w.scrollHeight ?? 0) - (w.height ?? 0));
            w.scrollX = Math.min(Math.max(0, scrollX), maxX);
            w.scrollY = Math.min(Math.max(0, scrollY), maxY);
            // OSRS parity: invalidateWidget (render) only; scroll does not change layout dimensions.
            ctx.widgetManager.invalidateScroll(w);
        }
    });

    // if_setscrollpos(scrollX, scrollY, widget) - sets both scroll positions on specified widget
    // Reference: class131.java - uid is popped first, then 2 args are read as array
    handlers.set(Opcodes.IF_SETSCROLLPOS, (ctx) => {
        const uid = ctx.intStack[--ctx.intStackSize];
        ctx.intStackSize -= 2;
        const scrollX = ctx.intStack[ctx.intStackSize];
        const scrollY = ctx.intStack[ctx.intStackSize + 1];
        const w = ctx.widgetManager.getWidgetByUid(uid);
        if (w) {
            // OSRS parity: scroll clamping uses the widget's current computed width/height.
            ensureWidgetLayout(ctx, w);
            const maxX = Math.max(0, (w.scrollWidth ?? 0) - (w.width ?? 0));
            const maxY = Math.max(0, (w.scrollHeight ?? 0) - (w.height ?? 0));
            w.scrollX = Math.min(Math.max(0, scrollX), maxX);
            w.scrollY = Math.min(Math.max(0, scrollY), maxY);
            ctx.widgetManager.invalidateScroll(w);
        }
    });

    handlers.set(Opcodes.CC_SETSCROLLSIZE, (ctx, intOp) => {
        // Reference: class131.java - 2 args read as array
        ctx.intStackSize -= 2;
        const width = ctx.intStack[ctx.intStackSize];
        const height = ctx.intStack[ctx.intStackSize + 1];
        const w = getTargetWidget(ctx, intOp);
        if (w) {
            const sizeChanged = w.scrollWidth !== width || w.scrollHeight !== height;
            if (sizeChanged) {
                w.scrollWidth = width;
                w.scrollHeight = height;
            }
            // OSRS parity: revalidateWidgetScroll clamps scroll positions after scroll size changes.
            const prevScrollX = w.scrollX ?? 0;
            const prevScrollY = w.scrollY ?? 0;
            const maxX = Math.max(0, (w.scrollWidth ?? 0) - (w.width ?? 0));
            const maxY = Math.max(0, (w.scrollHeight ?? 0) - (w.height ?? 0));
            w.scrollX = Math.min(Math.max(0, prevScrollX), maxX);
            w.scrollY = Math.min(Math.max(0, prevScrollY), maxY);
            if (sizeChanged || w.scrollX !== prevScrollX || w.scrollY !== prevScrollY) {
                ctx.widgetManager.invalidateWidget(w);
            }
        }
    });

    handlers.set(Opcodes.IF_SETSCROLLSIZE, (ctx) => {
        // Reference: class131.java - uid is popped first, then 2 args are read as array
        // Stack (bottom to top): [width, height, uid]
        const uid = ctx.intStack[--ctx.intStackSize];
        ctx.intStackSize -= 2;
        const width = ctx.intStack[ctx.intStackSize];
        const height = ctx.intStack[ctx.intStackSize + 1];
        const w = ctx.widgetManager.getWidgetByUid(uid);
        if (w) {
            const sizeChanged = w.scrollWidth !== width || w.scrollHeight !== height;
            if (sizeChanged) {
                w.scrollWidth = width;
                w.scrollHeight = height;
            }
            // OSRS parity: revalidateWidgetScroll clamps scroll positions after scroll size changes.
            const prevScrollX = w.scrollX ?? 0;
            const prevScrollY = w.scrollY ?? 0;
            const maxX = Math.max(0, (w.scrollWidth ?? 0) - (w.width ?? 0));
            const maxY = Math.max(0, (w.scrollHeight ?? 0) - (w.height ?? 0));
            w.scrollX = Math.min(Math.max(0, prevScrollX), maxX);
            w.scrollY = Math.min(Math.max(0, prevScrollY), maxY);
            if (sizeChanged || w.scrollX !== prevScrollX || w.scrollY !== prevScrollY) {
                ctx.widgetManager.invalidateWidget(w);
            }
        }
    });

    handlers.set(Opcodes.CC_GETSCROLLX, (ctx, intOp) => {
        const w = getTargetWidget(ctx, intOp);
        ctx.pushInt(w?.scrollX ?? 0);
    });

    handlers.set(Opcodes.IF_GETSCROLLX, (ctx) => {
        const w = getWidgetFromStack(ctx);
        ctx.pushInt(w?.scrollX ?? 0);
    });

    handlers.set(Opcodes.CC_GETSCROLLY, (ctx, intOp) => {
        const w = getTargetWidget(ctx, intOp);
        ctx.pushInt(w?.scrollY ?? 0);
    });

    handlers.set(Opcodes.IF_GETSCROLLY, (ctx) => {
        const w = getWidgetFromStack(ctx);
        ctx.pushInt(w?.scrollY ?? 0);
    });

    handlers.set(Opcodes.CC_GETSCROLLWIDTH, (ctx, intOp) => {
        const w = getTargetWidget(ctx, intOp);
        ctx.pushInt(w?.scrollWidth ?? 0);
    });

    handlers.set(Opcodes.IF_GETSCROLLWIDTH, (ctx) => {
        const w = getWidgetFromStack(ctx);
        ctx.pushInt(w?.scrollWidth ?? 0);
    });

    handlers.set(Opcodes.CC_GETSCROLLHEIGHT, (ctx, intOp) => {
        const w = getTargetWidget(ctx, intOp);
        ctx.pushInt(w?.scrollHeight ?? 0);
    });

    handlers.set(Opcodes.IF_GETSCROLLHEIGHT, (ctx) => {
        const w = getWidgetFromStack(ctx);
        ctx.pushInt(w?.scrollHeight ?? 0);
    });

    // === Click-through ===
    handlers.set(Opcodes.CC_SETNOCLICKTHROUGH, (ctx, intOp) => {
        const noClickThrough = ctx.intStack[--ctx.intStackSize] === 1;
        const w = getTargetWidget(ctx, intOp);
        if (w) w.noClickThrough = noClickThrough;
    });

    handlers.set(Opcodes.IF_SETNOCLICKTHROUGH, (ctx) => {
        // Pop order: widget first (top), then noClickThrough
        const w = getWidgetFromStack(ctx);
        const noClickThrough = ctx.intStack[--ctx.intStackSize] === 1;
        if (w) w.noClickThrough = noClickThrough;
    });

    handlers.set(Opcodes.CC_SETNOSCROLLTHROUGH, (ctx, intOp) => {
        const noScrollThrough = ctx.intStack[--ctx.intStackSize] === 1;
        const w = getTargetWidget(ctx, intOp);
        if (w) w.noScrollThrough = noScrollThrough;
    });

    handlers.set(Opcodes.IF_SETNOSCROLLTHROUGH, (ctx) => {
        // Pop order: widget first (top), then noScrollThrough
        const w = getWidgetFromStack(ctx);
        const noScrollThrough = ctx.intStack[--ctx.intStackSize] === 1;
        if (w) w.noScrollThrough = noScrollThrough;
    });

    // === Pinch-to-zoom (mobile) ===
    handlers.set(Opcodes.CC_SETPINCH, (ctx, intOp) => {
        const pinchEnabled = ctx.intStack[--ctx.intStackSize] === 1;
        const w = getTargetWidget(ctx, intOp);
        if (w) w.pinchEnabled = pinchEnabled;
    });

    handlers.set(Opcodes.IF_SETPINCH, (ctx) => {
        // Pop order: widget first (top), then pinchEnabled
        const w = getWidgetFromStack(ctx);
        const pinchEnabled = ctx.intStack[--ctx.intStackSize] === 1;
        if (w) w.pinchEnabled = pinchEnabled;
    });

    // === Object/Item ===
    handlers.set(Opcodes.CC_SETOBJECT, (ctx, intOp) => {
        // Reference: MouseHandler.java - 2 args read as array
        ctx.intStackSize -= 2;
        const itemId = ctx.intStack[ctx.intStackSize];
        const amount = ctx.intStack[ctx.intStackSize + 1];
        const w = getTargetWidget(ctx, intOp);
        // PERF: Only invalidate if item or quantity changed
        if (w && (w.itemId !== itemId || w.itemQuantity !== amount)) {
            w.itemId = itemId;
            w.itemQuantity = amount;
            // OSRS PARITY: CC_SETOBJECT sets quantity mode based on stackability.
            // Reference: MouseHandler.method721 (r215): stackable items force mode=1.
            w.itemQuantityMode = getSetObjectQuantityMode(ctx, itemId);
            w.itemShowQuantity = undefined;
            markWidgetInteractionDirty(w);
            invalidateWidgetRender(ctx, w);
        }
    });

    handlers.set(Opcodes.IF_SETOBJECT, (ctx) => {
        // Reference: MouseHandler.java - uid is popped first, then 2 args read as array
        const uid = ctx.intStack[--ctx.intStackSize];
        ctx.intStackSize -= 2;
        const itemId = ctx.intStack[ctx.intStackSize];
        const amount = ctx.intStack[ctx.intStackSize + 1];
        const w = ctx.widgetManager.getWidgetByUid(uid);
        // PERF: Only invalidate if item or quantity changed
        if (w && (w.itemId !== itemId || w.itemQuantity !== amount)) {
            w.itemId = itemId;
            w.itemQuantity = amount;
            w.itemQuantityMode = getSetObjectQuantityMode(ctx, itemId);
            w.itemShowQuantity = undefined;
            markWidgetInteractionDirty(w);
            invalidateWidgetRender(ctx, w);
        }
    });

    handlers.set(Opcodes.CC_SETOBJECT_NONUM, (ctx, intOp) => {
        // Reference: MouseHandler.java - 2 args read as array
        ctx.intStackSize -= 2;
        const itemId = ctx.intStack[ctx.intStackSize];
        const amount = ctx.intStack[ctx.intStackSize + 1];
        const w = getTargetWidget(ctx, intOp);
        // PERF: Only invalidate if item or quantity changed
        if (w && (w.itemId !== itemId || w.itemQuantity !== amount)) {
            w.itemId = itemId;
            w.itemQuantity = amount;
            w.itemQuantityMode = 0;
            w.itemShowQuantity = false;
            markWidgetInteractionDirty(w);
            invalidateWidgetRender(ctx, w);
        }
    });

    handlers.set(Opcodes.IF_SETOBJECT_NONUM, (ctx) => {
        // Reference: MouseHandler.java - uid is popped first, then 2 args read as array
        const uid = ctx.intStack[--ctx.intStackSize];
        ctx.intStackSize -= 2;
        const itemId = ctx.intStack[ctx.intStackSize];
        const amount = ctx.intStack[ctx.intStackSize + 1];
        const w = ctx.widgetManager.getWidgetByUid(uid);
        // PERF: Only invalidate if item or quantity changed
        if (w && (w.itemId !== itemId || w.itemQuantity !== amount)) {
            w.itemId = itemId;
            w.itemQuantity = amount;
            w.itemQuantityMode = 0;
            w.itemShowQuantity = false;
            markWidgetInteractionDirty(w);
            invalidateWidgetRender(ctx, w);
        }
    });

    handlers.set(Opcodes.CC_SETOBJECT_ALWAYS_NUM, (ctx, intOp) => {
        // Reference: MouseHandler.java - 2 args read as array
        ctx.intStackSize -= 2;
        const itemId = ctx.intStack[ctx.intStackSize];
        const amount = ctx.intStack[ctx.intStackSize + 1];
        const w = getTargetWidget(ctx, intOp);
        // PERF: Only invalidate if item or quantity changed
        if (w && (w.itemId !== itemId || w.itemQuantity !== amount)) {
            w.itemId = itemId;
            w.itemQuantity = amount;
            w.itemQuantityMode = 1;
            w.itemShowQuantity = true;
            markWidgetInteractionDirty(w);
            invalidateWidgetRender(ctx, w);
        }
    });

    handlers.set(Opcodes.IF_SETOBJECT_ALWAYS_NUM, (ctx) => {
        // Reference: MouseHandler.java - uid is popped first, then 2 args read as array
        const uid = ctx.intStack[--ctx.intStackSize];
        ctx.intStackSize -= 2;
        const itemId = ctx.intStack[ctx.intStackSize];
        const amount = ctx.intStack[ctx.intStackSize + 1];
        const w = ctx.widgetManager.getWidgetByUid(uid);
        // PERF: Only invalidate if item or quantity changed
        if (w && (w.itemId !== itemId || w.itemQuantity !== amount)) {
            w.itemId = itemId;
            w.itemQuantity = amount;
            w.itemQuantityMode = 1;
            w.itemShowQuantity = true;
            markWidgetInteractionDirty(w);
            invalidateWidgetRender(ctx, w);
        }
    });

    handlers.set(Opcodes.CC_GETINVOBJECT, (ctx, intOp) => {
        const w = getTargetWidget(ctx, intOp);
        if (!w) {
            throw new Error("RuntimeException");
        }
        ctx.pushInt((w.itemId ?? -1) | 0);
    });

    handlers.set(Opcodes.IF_GETINVOBJECT, (ctx) => {
        const w = getWidgetFromStack(ctx);
        if (!w) {
            throw new Error("RuntimeException");
        }
        ctx.pushInt((w.itemId ?? -1) | 0);
    });

    handlers.set(Opcodes.CC_GETINVCOUNT, (ctx, intOp) => {
        const w = getTargetWidget(ctx, intOp);
        if (!w) {
            throw new Error("RuntimeException");
        }
        const itemId = (w.itemId ?? -1) | 0;
        ctx.pushInt(itemId === -1 ? 0 : (w.itemQuantity ?? 0) | 0);
    });

    handlers.set(Opcodes.IF_GETINVCOUNT, (ctx) => {
        const w = getWidgetFromStack(ctx);
        if (!w) {
            throw new Error("RuntimeException");
        }
        const itemId = (w.itemId ?? -1) | 0;
        ctx.pushInt(itemId === -1 ? 0 : (w.itemQuantity ?? 0) | 0);
    });

    // cc_param(paramId): get widget param (returns int or string based on ParamType).
    handlers.set(Opcodes.CC_PARAM, (ctx, intOp) => {
        const paramId = ctx.intStack[--ctx.intStackSize] | 0;
        const w: any = getTargetWidget(ctx, intOp);
        if (!w) {
            throw new Error("RuntimeException");
        }
        const paramType = ctx.paramTypeLoader?.load?.(paramId);
        const isString = paramType?.isString?.() === true;
        const raw = w.params instanceof Map ? w.params.get(paramId) : undefined;
        if (isString) {
            ctx.pushString(typeof raw === "string" ? raw : paramType?.defaultString ?? "");
        } else {
            ctx.pushInt(typeof raw === "number" ? raw | 0 : (paramType?.defaultInt ?? 0) | 0);
        }
    });

    // cc_setparam(paramId, value, scriptVarType): set widget param.
    // Deob parity (class11 opcode 1704): pop type, pop typed value, pop paramId.
    handlers.set(Opcodes.CC_SETPARAM, (ctx, intOp) => {
        const scriptVarTypeId = ctx.popInt() | 0;
        const value = popValueByScriptVarType(ctx, scriptVarTypeId);
        const paramId = ctx.popInt() | 0;
        const w: any = getTargetWidget(ctx, intOp);
        if (!w) {
            throw new Error("RuntimeException");
        }
        if (!(w.params instanceof Map)) w.params = new Map();
        w.params.set(paramId, value);
    });

    // === Operations/Actions ===
    handlers.set(Opcodes.CC_SETOP, (ctx, intOp) => {
        const text = ctx.stringStack[--ctx.stringStackSize];
        const index = ctx.intStack[--ctx.intStackSize];
        const w = getTargetWidget(ctx, intOp);
        if (w) {
            if (!w.actions) w.actions = [];
            if (index >= 1 && index <= 10) {
                w.actions[index - 1] = text;
                markWidgetInteractionDirty(w);
            }
        }
    });

    handlers.set(Opcodes.IF_SETOP, (ctx) => {
        // Pop order: widget first (top of intStack), then index, then text (from stringStack)
        const w = getWidgetFromStack(ctx);
        const index = ctx.intStack[--ctx.intStackSize];
        const text = ctx.stringStack[--ctx.stringStackSize];
        if (w) {
            if (!w.actions) w.actions = [];
            if (index >= 1 && index <= 10) {
                w.actions[index - 1] = text;
                markWidgetInteractionDirty(w);
            }
        }
    });

    handlers.set(Opcodes.CC_CLEAROPS, (ctx, intOp) => {
        const w = getTargetWidget(ctx, intOp);
        if (w) {
            w.actions = [];
            markWidgetInteractionDirty(w);
        }
    });

    handlers.set(Opcodes.IF_CLEAROPS, (ctx) => {
        const w = getWidgetFromStack(ctx);
        if (w) {
            w.actions = [];
            markWidgetInteractionDirty(w);
        }
    });

    // CC_SETSUBOP (4222): Sets a sub-operation text for nested menu actions
    // Modern format: 4 ints (childId, subIndex, objId, opIndex)
    // The childId is used for widget child targeting in multi-slot widgets
    handlers.set(Opcodes.CC_SETSUBOP, (ctx, intOp) => {
        // Modern caches use 4 ints - consume them all to keep stack balanced
        ctx.intStackSize -= 4;
        const childId = ctx.intStack[ctx.intStackSize];
        const subIndex = ctx.intStack[ctx.intStackSize + 1];
        const objId = ctx.intStack[ctx.intStackSize + 2];
        const opIndex = ctx.intStack[ctx.intStackSize + 3];
        const w = getTargetWidget(ctx, intOp);
        if (w && opIndex >= 1 && opIndex <= 10) {
            if (!w.subOps) {
                w.subOps = new Array(10).fill(null);
            }
            if (!w.subOps[opIndex - 1]) {
                w.subOps[opIndex - 1] = [];
            }
            // In modern format, text is empty - sub-ops are set differently
            w.subOps[opIndex - 1]![subIndex - 1] = "";
        }
    });

    // IF_SETSUBOP (2311): Sets a sub-operation text for nested menu actions (widget from stack)
    handlers.set(Opcodes.IF_SETSUBOP, (ctx) => {
        const uid = ctx.intStack[--ctx.intStackSize];
        const text = ctx.stringStack[--ctx.stringStackSize];
        ctx.intStackSize -= 2;
        const opIndex = ctx.intStack[ctx.intStackSize];
        const subIndex = ctx.intStack[ctx.intStackSize + 1];
        const w = ctx.widgetManager.getWidgetByUid(uid);
        if (w && opIndex >= 1 && opIndex <= 10) {
            if (!w.subOps) {
                w.subOps = new Array(10).fill(null);
            }
            if (!w.subOps[opIndex - 1]) {
                w.subOps[opIndex - 1] = [];
            }
            w.subOps[opIndex - 1]![subIndex - 1] = text;
        }
    });

    // === Target cursors (1308-1309, 2308-2309) ===
    handlers.set(Opcodes.CC_SETTARGETCURSORS, (ctx, intOp) => {
        // 2 args read as array: [targetCursor, targetCursor2]
        ctx.intStackSize -= 2;
        const targetCursor = ctx.intStack[ctx.intStackSize];
        const targetCursor2 = ctx.intStack[ctx.intStackSize + 1];
        const w = getTargetWidget(ctx, intOp);
        if (w) {
            w.targetCursor = targetCursor;
            w.targetCursor2 = targetCursor2;
        }
    });

    handlers.set(Opcodes.IF_SETTARGETCURSORS, (ctx) => {
        // uid is popped first, then 2 args read as array: [targetCursor, targetCursor2]
        const uid = ctx.intStack[--ctx.intStackSize];
        ctx.intStackSize -= 2;
        const targetCursor = ctx.intStack[ctx.intStackSize];
        const targetCursor2 = ctx.intStack[ctx.intStackSize + 1];
        const w = ctx.widgetManager.getWidgetByUid(uid);
        if (w) {
            w.targetCursor = targetCursor;
            w.targetCursor2 = targetCursor2;
        }
    });

    handlers.set(Opcodes.CC_SETOPCURSOR, (ctx, intOp) => {
        // 2 args read as array: [opIndex, cursor]
        ctx.intStackSize -= 2;
        const opIndex = ctx.intStack[ctx.intStackSize];
        const cursor = ctx.intStack[ctx.intStackSize + 1];
        const w = getTargetWidget(ctx, intOp);
        if (w) {
            if (!w.opCursors) {
                w.opCursors = new Array(10).fill(null);
            }
            if (opIndex >= 1 && opIndex <= 10) {
                w.opCursors[opIndex - 1] = cursor;
            }
        }
    });

    handlers.set(Opcodes.IF_SETOPCURSOR, (ctx) => {
        // uid is popped first, then 2 args read as array: [opIndex, cursor]
        const uid = ctx.intStack[--ctx.intStackSize];
        ctx.intStackSize -= 2;
        const opIndex = ctx.intStack[ctx.intStackSize];
        const cursor = ctx.intStack[ctx.intStackSize + 1];
        const w = ctx.widgetManager.getWidgetByUid(uid);
        if (w) {
            if (!w.opCursors) {
                w.opCursors = new Array(10).fill(null);
            }
            if (opIndex >= 1 && opIndex <= 10) {
                w.opCursors[opIndex - 1] = cursor;
            }
        }
    });

    // === Pause text (1310, 2310) ===
    handlers.set(Opcodes.CC_SETPAUSETEXT, (ctx, intOp) => {
        const text = ctx.stringStack[--ctx.stringStackSize];
        const w = getTargetWidget(ctx, intOp);
        if (w) {
            // Store pause text - used for dialogue "Click here to continue" etc.
            w.pauseText = text;
            markWidgetInteractionDirty(w);
        }
    });

    handlers.set(Opcodes.IF_SETPAUSETEXT, (ctx) => {
        // Pop order: widget first (top of intStack), then text (from stringStack)
        const w = getWidgetFromStack(ctx);
        const text = ctx.stringStack[--ctx.stringStackSize];
        if (w) {
            w.pauseText = text;
            markWidgetInteractionDirty(w);
        }
    });

    // === Revision-specific opcodes (1311-1314) ===
    // cc_setdragrenderbehaviour(behavior) - controls how widget is rendered during drag
    // 0 = hide during drag, 1 = render at drag position (follow cursor), 2 = render at original position
    // Note: This replaces placeholder CC_SET1311, actual opcode may vary by revision
    handlers.set(Opcodes.CC_SETDRAGRENDERBEHAVIOUR, (ctx, intOp) => {
        const behavior = ctx.intStack[--ctx.intStackSize];
        const w = getTargetWidget(ctx, intOp);
        if (w) {
            w.dragRenderBehaviour = behavior;
        }
    });

    handlers.set(Opcodes.CC_SET1312, (ctx, intOp) => {
        // cc_setoppriority - Takes 1 int (priority value, -1 to disable)
        const priority = ctx.intStack[--ctx.intStackSize];
        const w = getTargetWidget(ctx, intOp);
        if (w) {
            w.opPriority = priority;
        }
    });

    handlers.set(Opcodes.CC_SET1313, (ctx, intOp) => {
        // Takes 2 ints. Strong hypothesis: Model Ambient and Contrast.
        const contrast = ctx.intStack[--ctx.intStackSize];
        const ambient = ctx.intStack[--ctx.intStackSize];
        const w = getTargetWidget(ctx, intOp);
        if (w) {
            w.modelAmbient = ambient;
            w.modelContrast = contrast;
        }
    });

    handlers.set(Opcodes.CC_SET1314, (ctx, intOp) => {
        // Takes 1 int.
        const val = ctx.intStack[--ctx.intStackSize];
    });

    handlers.set(Opcodes.CC_GETOP, (ctx, intOp) => {
        const opIndex = ctx.intStack[--ctx.intStackSize];
        const w = getTargetWidget(ctx, intOp);
        const op = w?.actions?.[opIndex - 1] ?? "";
        ctx.pushString(op);
    });

    handlers.set(Opcodes.IF_GETOP, (ctx) => {
        // Pop order: widget first (top), then opIndex
        const w = getWidgetFromStack(ctx);
        const opIndex = ctx.intStack[--ctx.intStackSize];
        const op = w?.actions?.[opIndex - 1] ?? "";
        ctx.pushString(op);
    });

    handlers.set(Opcodes.CC_SETOPBASE, (ctx, intOp) => {
        const text = ctx.stringStack[--ctx.stringStackSize];
        const w = getTargetWidget(ctx, intOp);
        if (w) {
            w.opBase = text;
            markWidgetInteractionDirty(w);
        }
    });

    handlers.set(Opcodes.IF_SETOPBASE, (ctx) => {
        // Pop order: widget first (top of intStack), then text (from stringStack)
        const w = getWidgetFromStack(ctx);
        const text = ctx.stringStack[--ctx.stringStackSize];
        if (w) {
            w.opBase = text;
            markWidgetInteractionDirty(w);
        }
    });

    handlers.set(Opcodes.CC_GETOPBASE, (ctx, intOp) => {
        const w = getTargetWidget(ctx, intOp);
        ctx.pushString(w?.opBase ?? "");
    });

    handlers.set(Opcodes.IF_GETOPBASE, (ctx) => {
        const w = getWidgetFromStack(ctx);
        ctx.pushString(w?.opBase ?? "");
    });

    handlers.set(Opcodes.CC_SETTARGETVERB, (ctx, intOp) => {
        const verb = ctx.stringStack[--ctx.stringStackSize];
        const w = getTargetWidget(ctx, intOp);
        if (w) {
            w.targetVerb = verb;
            markWidgetInteractionDirty(w);
        }
    });

    handlers.set(Opcodes.IF_SETTARGETVERB, (ctx) => {
        // Pop order: widget first (top of intStack), then verb (from stringStack)
        const w = getWidgetFromStack(ctx);
        const verb = ctx.stringStack[--ctx.stringStackSize];
        if (w) {
            w.targetVerb = verb;
            markWidgetInteractionDirty(w);
        }
    });

    handlers.set(Opcodes.CC_GETTARGETMASK, (ctx, intOp) => {
        const w = getTargetWidget(ctx, intOp);
        const flags = ctx.widgetManager.getWidgetFlags(w as any);
        ctx.pushInt((flags >>> 11) & 0x3f);
    });

    handlers.set(Opcodes.IF_GETTARGETMASK, (ctx) => {
        const w = getWidgetFromStack(ctx);
        const flags = ctx.widgetManager.getWidgetFlags(w as any);
        ctx.pushInt((flags >>> 11) & 0x3f);
    });

    // === Keyboard shortcuts ===
    // Reference: GrandExchangeOfferOwnWorldComparator.java lines 324-355
    // Reference: class28.java Widget_setKey for hasKeyBindings flag handling
    // CC_SETOPKEY (var3=true): Pop 10 ints as array (5 key pairs), then opIndex
    handlers.set(Opcodes.CC_SETOPKEY, (ctx, intOp) => {
        ctx.intStackSize -= 10;
        // Read key pairs (up to 5 pairs, terminated by negative value)
        const keyChars: number[] = [];
        const keyCodes: number[] = [];
        for (let i = 0; i < 10 && ctx.intStack[ctx.intStackSize + i] >= 0; i += 2) {
            keyChars.push(ctx.intStack[ctx.intStackSize + i]);
            keyCodes.push(ctx.intStack[ctx.intStackSize + i + 1]);
        }
        const opIndex = ctx.intStack[--ctx.intStackSize] - 1;
        const w = getTargetWidget(ctx, intOp);
        if (w && opIndex >= 0 && opIndex <= 9) {
            if (!w.opKeys) w.opKeys = [];
            // Store all key pairs for this op
            if (keyChars.length > 0) {
                w.opKeys[opIndex] = {
                    keyChars,
                    keyCodes,
                    opIndex: opIndex + 1,
                };
                // OSRS PARITY: Set hasKeyBindings flag (field3776)
                w.hasKeyBindings = true;
            } else {
                w.opKeys[opIndex] = null;
                // Check if any key bindings remain
                w.hasKeyBindings = w.opKeys.some((k) => k !== null && k !== undefined);
            }
        }
    });

    // IF_SETOPKEY (var3=false): Pop uid first, then 2 ints (1 key pair), then opIndex
    handlers.set(Opcodes.IF_SETOPKEY, (ctx) => {
        const uid = ctx.intStack[--ctx.intStackSize];
        ctx.intStackSize -= 2;
        const keyChar = ctx.intStack[ctx.intStackSize];
        const keyCode = ctx.intStack[ctx.intStackSize + 1];
        const opIndex = ctx.intStack[--ctx.intStackSize] - 1;
        const w = ctx.widgetManager.getWidgetByUid(uid);
        if (w && opIndex >= 0 && opIndex <= 9) {
            if (!w.opKeys) w.opKeys = [];
            if (keyChar >= 0) {
                w.opKeys[opIndex] = {
                    keyChars: [keyChar],
                    keyCodes: [keyCode],
                    opIndex: opIndex + 1,
                };
                w.hasKeyBindings = true;
            } else {
                w.opKeys[opIndex] = null;
                w.hasKeyBindings = w.opKeys.some((k) => k !== null && k !== undefined);
            }
        }
    });

    // CC_SETOPTKEY: 2 args as array [keyChar, keyCode], opIndex = 10 (typed key)
    handlers.set(Opcodes.CC_SETOPTKEY, (ctx, intOp) => {
        ctx.intStackSize -= 2;
        const keyChar = ctx.intStack[ctx.intStackSize];
        const keyCode = ctx.intStack[ctx.intStackSize + 1];
        const opIndex = 10; // Typed key slot
        const w = getTargetWidget(ctx, intOp);
        if (w) {
            if (!w.opKeys) w.opKeys = [];
            if (keyChar >= 0) {
                w.opKeys[opIndex - 1] = {
                    keyChars: [keyChar],
                    keyCodes: [keyCode],
                    opIndex,
                };
                w.hasKeyBindings = true;
            } else {
                w.opKeys[opIndex - 1] = null;
                w.hasKeyBindings = w.opKeys.some((k) => k !== null && k !== undefined);
            }
        }
    });

    handlers.set(Opcodes.IF_SETOPTKEY, (ctx) => {
        // Reference: uid is popped first, then 2 args as array
        const uid = ctx.intStack[--ctx.intStackSize];
        ctx.intStackSize -= 2;
        const keyChar = ctx.intStack[ctx.intStackSize];
        const keyCode = ctx.intStack[ctx.intStackSize + 1];
        const opIndex = 10; // Typed key slot
        const w = ctx.widgetManager.getWidgetByUid(uid);
        if (w) {
            if (!w.opKeys) w.opKeys = [];
            if (keyChar >= 0) {
                w.opKeys[opIndex - 1] = {
                    keyChars: [keyChar],
                    keyCodes: [keyCode],
                    opIndex,
                };
                w.hasKeyBindings = true;
            } else {
                w.opKeys[opIndex - 1] = null;
                w.hasKeyBindings = w.opKeys.some((k) => k !== null && k !== undefined);
            }
        }
    });

    handlers.set(Opcodes.CC_SETOPKEYRATE, (ctx, intOp) => {
        // Reference: GrandExchangeOfferOwnWorldComparator.java - 3 args read as array
        ctx.intStackSize -= 3;
        const opIndex = ctx.intStack[ctx.intStackSize] - 1;
        const keyRate = ctx.intStack[ctx.intStackSize + 1];
        const tickRate = ctx.intStack[ctx.intStackSize + 2];
        const w = getTargetWidget(ctx, intOp);
        if (w && opIndex >= 0 && opIndex <= 9) {
            if (!w.opKeyRates) w.opKeyRates = [];
            w.opKeyRates[opIndex] = {
                rate: keyRate,
                enabled: tickRate !== 0,
                opIndex: opIndex + 1,
            };
        }
    });

    handlers.set(Opcodes.IF_SETOPKEYRATE, (ctx) => {
        // Reference: uid is popped first, then 3 args read as array
        const uid = ctx.intStack[--ctx.intStackSize];
        ctx.intStackSize -= 3;
        const opIndex = ctx.intStack[ctx.intStackSize] - 1;
        const keyRate = ctx.intStack[ctx.intStackSize + 1];
        const tickRate = ctx.intStack[ctx.intStackSize + 2];
        const w = ctx.widgetManager.getWidgetByUid(uid);
        if (w && opIndex >= 0 && opIndex <= 9) {
            if (!w.opKeyRates) w.opKeyRates = [];
            w.opKeyRates[opIndex] = {
                rate: keyRate,
                enabled: tickRate !== 0,
                opIndex: opIndex + 1,
            };
        }
    });

    // Reference: GrandExchangeOfferOwnWorldComparator.java - CC_SETOPTKEYRATE pops 2 ints sequentially
    // var5 = 10 (hardcoded opIndex for typed key)
    // var6 = pop keyRate, var7 = pop tickRate
    handlers.set(Opcodes.CC_SETOPTKEYRATE, (ctx, intOp) => {
        const opIndex = 10; // Hardcoded for typed key slot
        const keyRate = ctx.intStack[--ctx.intStackSize];
        const tickRate = ctx.intStack[--ctx.intStackSize];
        const w = getTargetWidget(ctx, intOp);
        if (w) {
            if (!w.opKeyRates) w.opKeyRates = [];
            w.opKeyRates[opIndex - 1] = { rate: keyRate, enabled: tickRate !== 0, opIndex };
        }
    });

    handlers.set(Opcodes.IF_SETOPTKEYRATE, (ctx) => {
        // Reference: uid first, then 2 sequential pops like CC variant
        const uid = ctx.intStack[--ctx.intStackSize];
        const opIndex = 10; // Hardcoded for typed key slot
        const keyRate = ctx.intStack[--ctx.intStackSize];
        const tickRate = ctx.intStack[--ctx.intStackSize];
        const w = ctx.widgetManager.getWidgetByUid(uid);
        if (w) {
            if (!w.opKeyRates) w.opKeyRates = [];
            w.opKeyRates[opIndex - 1] = { rate: keyRate, enabled: tickRate !== 0, opIndex };
        }
    });

    // Reference: GrandExchangeOfferOwnWorldComparator.java - CC_SETOPKEYIGNOREHELD pops only 1 arg (opIndex)
    // Sets ignore held = true (no enabled flag from stack)
    handlers.set(Opcodes.CC_SETOPKEYIGNOREHELD, (ctx, intOp) => {
        const opIndex = ctx.intStack[--ctx.intStackSize] - 1;
        const w = getTargetWidget(ctx, intOp);
        if (w && opIndex >= 0 && opIndex <= 9) {
            if (!w.opKeyIgnoreHeld) w.opKeyIgnoreHeld = [];
            w.opKeyIgnoreHeld[opIndex] = true;
        }
    });

    handlers.set(Opcodes.IF_SETOPKEYIGNOREHELD, (ctx) => {
        // Reference: uid first, then 1 arg (opIndex)
        const uid = ctx.intStack[--ctx.intStackSize];
        const opIndex = ctx.intStack[--ctx.intStackSize] - 1;
        const w = ctx.widgetManager.getWidgetByUid(uid);
        if (w && opIndex >= 0 && opIndex <= 9) {
            if (!w.opKeyIgnoreHeld) w.opKeyIgnoreHeld = [];
            w.opKeyIgnoreHeld[opIndex] = true;
        }
    });

    // Reference: GrandExchangeOfferOwnWorldComparator.java - CC_SETOPTKEYIGNOREHELD takes NO args
    // opIndex is hardcoded to 10 (typed key slot)
    handlers.set(Opcodes.CC_SETOPTKEYIGNOREHELD, (ctx, intOp) => {
        const opIndex = 10; // Hardcoded for typed key slot
        const w = getTargetWidget(ctx, intOp);
        if (w) {
            if (!w.opKeyIgnoreHeld) w.opKeyIgnoreHeld = [];
            w.opKeyIgnoreHeld[opIndex - 1] = true;
        }
    });

    handlers.set(Opcodes.IF_SETOPTKEYIGNOREHELD, (ctx) => {
        // Reference: only uid, opIndex is hardcoded to 10
        const uid = ctx.intStack[--ctx.intStackSize];
        const opIndex = 10; // Hardcoded for typed key slot
        const w = ctx.widgetManager.getWidgetByUid(uid);
        if (w) {
            if (!w.opKeyIgnoreHeld) w.opKeyIgnoreHeld = [];
            w.opKeyIgnoreHeld[opIndex - 1] = true;
        }
    });

    // === Drag ===
    // cc_setdraggable(parentComponent, childIndex) - sets widget as draggable with coordinate space
    // parentComponent = parent container widget UID
    // childIndex = index of child within parent to use as drag render area (e.g., 0 = track in scrollbar)
    // Reference: GrandExchangeOfferOwnWorldComparator.java - 2 args read as array [parentUid, childIndex]
    handlers.set(Opcodes.CC_SETDRAGGABLE, (ctx, intOp) => {
        ctx.intStackSize -= 2;
        const parentUid = ctx.intStack[ctx.intStackSize];
        const childIndex = ctx.intStack[ctx.intStackSize + 1];
        const w = getTargetWidget(ctx, intOp);
        if (w) {
            w.isDraggable = true;
            // Resolve drag render area: get child at childIndex within parent container
            const parentWidget = ctx.widgetManager?.getWidgetByUid(parentUid);
            if (
                parentWidget &&
                parentWidget.children &&
                childIndex >= 0 &&
                childIndex < parentWidget.children.length
            ) {
                const dragRenderArea = parentWidget.children[childIndex];
                if (dragRenderArea) {
                    w.dragRenderArea = dragRenderArea;
                }
            } else if (parentWidget) {
                // Fallback to parent if child index is invalid
                w.dragRenderArea = parentWidget;
            }
        }
    });

    // if_setdraggable(parentComponent, childIndex, widget) - IF variant
    // Reference: GrandExchangeOfferOwnWorldComparator.java - uid first, then 2 args as array [parentUid, childIndex]
    handlers.set(Opcodes.IF_SETDRAGGABLE, (ctx) => {
        const uid = ctx.intStack[--ctx.intStackSize];
        ctx.intStackSize -= 2;
        const parentUid = ctx.intStack[ctx.intStackSize];
        const childIndex = ctx.intStack[ctx.intStackSize + 1];
        const w = ctx.widgetManager.getWidgetByUid(uid);
        if (w) {
            w.isDraggable = true;
            // Resolve drag render area: get child at childIndex within parent container
            const parentWidget = ctx.widgetManager?.getWidgetByUid(parentUid);
            if (
                parentWidget &&
                parentWidget.children &&
                childIndex >= 0 &&
                childIndex < parentWidget.children.length
            ) {
                const dragRenderArea = parentWidget.children[childIndex];
                if (dragRenderArea) {
                    w.dragRenderArea = dragRenderArea;
                }
            } else if (parentWidget) {
                w.dragRenderArea = parentWidget;
            }
        }
    });

    // cc_setdraggablebehavior(behavior) - controls how widget is rendered during drag
    // Reference: GrandExchangeOfferOwnWorldComparator.java line 256
    // In OSRS, this sets widget.isScrollBar = (behavior == 1)
    // isScrollBar controls whether the widget gets transparency when clicked/dragged
    // (scrollbar widgets don't get dimmed, regular dragged items do)
    handlers.set(Opcodes.CC_SETDRAGGABLEBEHAVIOR, (ctx, intOp) => {
        const behavior = ctx.intStack[--ctx.intStackSize];
        const w = getTargetWidget(ctx, intOp);
        if (w) {
            w.dragRenderBehaviour = behavior;
            w.isScrollBar = behavior === 1;
        }
    });

    handlers.set(Opcodes.IF_SETDRAGGABLEBEHAVIOR, (ctx) => {
        // Pop order: widget first (top), then behavior
        const w = getWidgetFromStack(ctx);
        const behavior = ctx.intStack[--ctx.intStackSize];
        if (w) {
            w.dragRenderBehaviour = behavior;
            w.isScrollBar = behavior === 1;
        }
    });

    handlers.set(Opcodes.CC_SETDRAGDEADZONE, (ctx, intOp) => {
        const zone = ctx.intStack[--ctx.intStackSize];
        const w = getTargetWidget(ctx, intOp);
        if (w) {
            // OSRS: sets Widget.dragZoneSize (used by drag initiation).
            // Keep legacy aliases in sync.
            (w as any).dragZoneSize = zone;
            w.dragDeadZone = zone;
        }
    });

    handlers.set(Opcodes.IF_SETDRAGDEADZONE, (ctx) => {
        // Pop order: widget first (top), then zone
        const w = getWidgetFromStack(ctx);
        const zone = ctx.intStack[--ctx.intStackSize];
        if (w) {
            (w as any).dragZoneSize = zone;
            w.dragDeadZone = zone;
        }
    });

    handlers.set(Opcodes.CC_SETDRAGDEADTIME, (ctx, intOp) => {
        const time = ctx.intStack[--ctx.intStackSize];
        const w = getTargetWidget(ctx, intOp);
        if (w) {
            // OSRS: sets Widget.dragThreshold (used by drag initiation).
            // Keep legacy aliases in sync.
            (w as any).dragThreshold = time;
            w.dragDeadTime = time;
        }
    });

    handlers.set(Opcodes.IF_SETDRAGDEADTIME, (ctx) => {
        // Pop order: widget first (top), then time
        const w = getWidgetFromStack(ctx);
        const time = ctx.intStack[--ctx.intStackSize];
        if (w) {
            (w as any).dragThreshold = time;
            w.dragDeadTime = time;
        }
    });

    // cc_dragpickup(xOffset, yOffset) - programmatically start drag on active/dot widget
    // xOffset, yOffset = offset from widget origin where the "grab point" is
    // OSRS scrollbar_vertical_jump calls cc_dragpickup(0, height/2) to grab dragger at its center
    handlers.set(Opcodes.CC_DRAGPICKUP, (ctx, intOp) => {
        ctx.intStackSize -= 2;
        const xOffset = ctx.intStack[ctx.intStackSize];
        const yOffset = ctx.intStack[ctx.intStackSize + 1];
        const w = getTargetWidget(ctx, intOp);
        if (w) {
            (w as any)._dragPickupOffsetX = xOffset;
            (w as any)._dragPickupOffsetY = yOffset;
            ctx.setDragSource(w);
        }
    });

    // if_dragpickup(xOffset, yOffset, widget) - IF variant
    handlers.set(Opcodes.IF_DRAGPICKUP, (ctx) => {
        const uid = ctx.intStack[--ctx.intStackSize];
        ctx.intStackSize -= 2;
        const xOffset = ctx.intStack[ctx.intStackSize];
        const yOffset = ctx.intStack[ctx.intStackSize + 1];
        const w = ctx.widgetManager.getWidgetByUid(uid);
        if (w) {
            (w as any)._dragPickupOffsetX = xOffset;
            (w as any)._dragPickupOffsetY = yOffset;
            ctx.setDragSource(w);
        }
    });

    // === Misc widget ops ===
    handlers.set(Opcodes.CC_CALLONRESIZE, (ctx, intOp) => {
        const w = getTargetWidget(ctx, intOp);
        if (!w) {
            throw new Error("RuntimeException");
        }
        ctx.queueResize(w);
    });

    handlers.set(Opcodes.IF_CALLONRESIZE, (ctx) => {
        const uid = ctx.intStack[--ctx.intStackSize];
        const w = ctx.widgetManager.getWidgetByUid(uid);
        if (!w) {
            throw new Error("RuntimeException");
        }
        ctx.queueResize(w);
    });

    handlers.set(Opcodes.CC_TRIGGEROP, (ctx, intOp) => {
        const opIndex = ctx.intStack[--ctx.intStackSize];
        if (opIndex < 1 || opIndex > 10) {
            throw new Error("RuntimeException");
        }
        const w = getTargetWidget(ctx, intOp);
        if (!w) {
            throw new Error("RuntimeException");
        }
        ctx.queueTriggerOp(w, opIndex);
    });

    handlers.set(Opcodes.IF_TRIGGEROP, (ctx) => {
        const uid = ctx.intStack[--ctx.intStackSize];
        const opIndex = ctx.intStack[--ctx.intStackSize];
        if (opIndex < 1 || opIndex > 10) {
            throw new Error("RuntimeException");
        }
        const w = ctx.widgetManager.getWidgetByUid(uid);
        if (!w) {
            throw new Error("RuntimeException");
        }
        ctx.queueTriggerOp(w, opIndex);
    });

    handlers.set(Opcodes.IF_TRIGGEROPLOCAL, (ctx) => {
        ctx.forwardIfTriggerOpLocal();
    });

    handlers.set(Opcodes.CC_RESUME_PAUSEBUTTON, (ctx) => {
        // Resume paused button - signals that a dialog continue button was clicked.
        // OSRS parity: Uses activeWidget.id (parent UID), not activeWidget.uid.
        // Reference: class131.java -> resumePauseWidget(var3.id, var3.childIndex)
        const w = ctx.activeWidget;
        if (w && ctx.sendResumePauseButton) {
            const widgetUid = (typeof (w as any).id === "number" ? (w as any).id : w.uid ?? 0) | 0;
            // Child index: dynamic children use runtime childIndex; static widgets use -1/default.
            const childIndex = (typeof w.childIndex === "number" ? w.childIndex : -1) | 0;
            ctx.sendResumePauseButton(widgetUid, childIndex);
        }
    });

    handlers.set(Opcodes.IF_RESUME_PAUSEBUTTON, (ctx) => {
        // Resume paused button for a specific widget UID from the stack.
        // OSRS parity: Pops widget UID and sends RESUME_PAUSEBUTTON packet.
        const uid = ctx.intStack[--ctx.intStackSize];
        if (ctx.sendResumePauseButton) {
            ctx.sendResumePauseButton(uid, -1);
        }
    });

    handlers.set(Opcodes.IF_SETCLICKMASK, (ctx) => {
        // OSRS parity: sets a runtime widget flags override stored in Client.widgetFlags.
        // Reference: class405.getWidgetFlags (lookup) and server packets that populate widgetFlags ranges.
        const w = getWidgetFromStack(ctx);
        const mask = ctx.intStack[--ctx.intStackSize];
        if (w) {
            ctx.widgetManager.setWidgetFlagsOverride(w, mask);
            // Keep derived targetMask in sync (bits 11-16) for scripts/UI that read `w.targetMask`.
            w.targetMask = ((mask >>> 11) & 0x3f) | 0;
        }
    });

    handlers.set(Opcodes.IF_HASSUB, (ctx) => {
        const uid = ctx.intStack[--ctx.intStackSize];
        const subInfo = ctx.widgetManager.getSubInterface(uid);
        ctx.pushInt(subInfo !== undefined ? 1 : 0);
    });

    // if_param(paramId, widgetUid, childIndex): read widget/child param.
    // Deob parity (class180 opcode 2703): default value comes from ParamType, not script stack.
    handlers.set(Opcodes.IF_PARAM, (ctx) => {
        if (ctx.intStackSize < 3) {
            throw new Error("RuntimeException");
        }
        ctx.intStackSize -= 3;
        const paramId = ctx.intStack[ctx.intStackSize] | 0;
        const widgetUid = ctx.intStack[ctx.intStackSize + 1] | 0;
        const childIndex = ctx.intStack[ctx.intStackSize + 2] | 0;

        const target: any = getWidgetByUidAndChild(ctx, widgetUid, childIndex);
        if (!target) {
            throw new Error("RuntimeException");
        }

        const paramType = ctx.paramTypeLoader?.load?.(paramId);
        const isString = paramType?.isString?.() === true;
        const raw = target.params instanceof Map ? target.params.get(paramId) : undefined;
        if (isString) {
            ctx.pushString(typeof raw === "string" ? raw : paramType?.defaultString ?? "");
        } else {
            ctx.pushInt(typeof raw === "number" ? raw | 0 : (paramType?.defaultInt ?? 0) | 0);
        }
    });

    // if_setparam(paramId, value, widgetUid, childIndex, scriptVarType): set widget/child param.
    // Deob parity (class180 opcode 2704): pop value by script-var-type id.
    handlers.set(Opcodes.IF_SETPARAM, (ctx) => {
        if (ctx.intStackSize < 4) {
            throw new Error("RuntimeException");
        }
        ctx.intStackSize -= 3;
        const widgetUid = ctx.intStack[ctx.intStackSize] | 0;
        const childIndex = ctx.intStack[ctx.intStackSize + 1] | 0;
        const scriptVarTypeId = ctx.intStack[ctx.intStackSize + 2] | 0;
        const value = popValueByScriptVarType(ctx, scriptVarTypeId);
        const paramId = ctx.popInt() | 0;

        const target: any = getWidgetByUidAndChild(ctx, widgetUid, childIndex);
        if (!target) {
            throw new Error("RuntimeException");
        }
        if (!(target.params instanceof Map)) target.params = new Map();
        target.params.set(paramId, value);
    });

    handlers.set(Opcodes.IF_GETTOP, (ctx) => {
        // OSRS PARITY: IF_GETTOP always returns rootInterface (verified from decompiled client)
        ctx.pushInt(ctx.widgetManager.rootInterface);
    });

    // === Input Field Opcodes (type 16 = inputfield) ===
    // These opcodes configure input field widgets used in hiscores, search boxes, etc.

    handlers.set(Opcodes.CC_INPUT_SETSUBMITMODE, (ctx, intOp) => {
        // Sets submit mode for input field (0=no submit, 1=submit on enter)
        const mode = ctx.intStack[--ctx.intStackSize];
        const w = getTargetWidget(ctx, intOp);
        if (w) {
            (w as any).inputSubmitMode = mode;
        }
    });

    handlers.set(Opcodes.CC_INPUT_SETSELECTCOLOUR, (ctx, intOp) => {
        // Sets the text selection color for input field
        const color = ctx.intStack[--ctx.intStackSize];
        const w = getTargetWidget(ctx, intOp);
        if (w) {
            (w as any).inputSelectColour = color;
        }
    });

    handlers.set(Opcodes.CC_INPUT_SETACCEPTMODE, (ctx, intOp) => {
        const val = ctx.intStack[--ctx.intStackSize];
        const w = getTargetWidget(ctx, intOp);
        if (w) (w as any).inputAcceptMode = val;
    });

    handlers.set(Opcodes.CC_INPUT_SETWRAPMODE, (ctx, intOp) => {
        const val = ctx.intStack[--ctx.intStackSize];
        const w = getTargetWidget(ctx, intOp);
        if (w) (w as any).inputWrapMode = val;
    });

    handlers.set(Opcodes.CC_INPUT_SETLINEWRAPPINGWIDTH, (ctx, intOp) => {
        const val = ctx.intStack[--ctx.intStackSize];
        const w = getTargetWidget(ctx, intOp);
        if (w) (w as any).inputLineWrappingWidth = val;
    });

    handlers.set(Opcodes.CC_INPUT_SETSELECTBGCOLOUR, (ctx, intOp) => {
        const color = ctx.intStack[--ctx.intStackSize];
        const w = getTargetWidget(ctx, intOp);
        if (w) (w as any).inputSelectBgColour = color;
    });

    handlers.set(Opcodes.CC_INPUT_SETLINECOUNTLIMIT, (ctx, intOp) => {
        const limit = ctx.intStack[--ctx.intStackSize];
        const w = getTargetWidget(ctx, intOp);
        if (w) (w as any).inputLineCountLimit = limit;
    });

    handlers.set(Opcodes.CC_INPUT_SETCURSORCOLOUR, (ctx, intOp) => {
        const val = ctx.intStack[--ctx.intStackSize];
        const w = getTargetWidget(ctx, intOp);
        if (w) (w as any).inputCursorColour = val;
    });

    handlers.set(Opcodes.CC_INPUT_SETCURSORTRANS, (ctx, intOp) => {
        const val = ctx.intStack[--ctx.intStackSize];
        const w = getTargetWidget(ctx, intOp);
        if (w) (w as any).inputCursorTrans = val;
    });

    handlers.set(Opcodes.CC_INPUT_SETCURSORWIDTH, (ctx, intOp) => {
        const val = ctx.intStack[--ctx.intStackSize];
        const w = getTargetWidget(ctx, intOp);
        if (w) (w as any).inputCursorWidth = val;
    });

    handlers.set(Opcodes.CC_INPUT_SETCURSORHEIGHT, (ctx, intOp) => {
        const val = ctx.intStack[--ctx.intStackSize];
        const w = getTargetWidget(ctx, intOp);
        if (w) (w as any).inputCursorHeight = val;
    });

    handlers.set(Opcodes.CC_INPUT_SETCURSOROFFSET, (ctx, intOp) => {
        const val = ctx.intStack[--ctx.intStackSize];
        const w = getTargetWidget(ctx, intOp);
        if (w) (w as any).inputCursorOffset = val;
    });

    handlers.set(Opcodes.CC_INPUT_SETLINEWIDTHLIMIT, (ctx, intOp) => {
        const limit = ctx.intStack[--ctx.intStackSize];
        const w = getTargetWidget(ctx, intOp);
        if (w) (w as any).inputLineWidthLimit = limit;
    });

    handlers.set(Opcodes.CC_INPUT_SETCHARFILTER, (ctx, intOp) => {
        const val = ctx.intStack[--ctx.intStackSize];
        const w = getTargetWidget(ctx, intOp);
        if (w) (w as any).inputCharFilter = val;
    });

    handlers.set(Opcodes.IF_OPENSUB, (ctx) => {
        // 3 args read as array: [componentUid, interfaceId, type]
        ctx.intStackSize -= 3;
        const componentUid = ctx.intStack[ctx.intStackSize];
        const interfaceId = ctx.intStack[ctx.intStackSize + 1];
        const type = ctx.intStack[ctx.intStackSize + 2];

        console.log(
            `[IF_OPENSUB] Opening interface ${interfaceId} into component ${componentUid} (type=${type})`,
        );

        ctx.widgetManager.openSubInterface(componentUid, interfaceId, type);

        // PERF: Clear CS2 handler caches when opening sub-interfaces (e.g., tab switches)
        // openSubInterface internally closes any existing interface, so we need to clear
        // stale cached widget references from the closed interface
        ctx.cs2Vm?.clearHandlerCaches();

        // Trigger initial onVarTransmit handlers for the opened interface
        ctx.onSubInterfaceOpened?.(interfaceId);
    });
}
