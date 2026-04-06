import { isDropTarget, isPauseButton, shouldShowMenuOption } from "../WidgetFlags";

export type SimpleMenuEntry = { option: string; target?: string };

const ITEM_MENU_TARGET_RGB = 16748608; // OSRS item target orange (<col=ff9040>)

function colorStartTag(rgb: number): string {
    return `<col=${(rgb >>> 0).toString(16)}>`;
}

// Basic OSRS-style sanitization for widget strings
export function sanitizeText(s?: string | null): string | undefined {
    if (!s) return undefined;
    const t = String(s)
        .replace(/<[^>]+>/g, "")
        .trim();
    if (!t || t === "*" || t.toLowerCase() === "null") return undefined;
    return t;
}

function sanitizeTextPreserveMarkup(s?: string | null): string | undefined {
    if (!s) return undefined;
    const raw = String(s).trim();
    if (!raw) return undefined;
    return sanitizeText(raw) ? raw : undefined;
}

function getWidgetTransparency(w: any): number {
    return ((w?.transparency ?? w?.opacity ?? 0) | 0) & 0xff;
}

function hasVisibleSpriteContent(w: any): boolean {
    if ((getWidgetTransparency(w) | 0) >= 255) return false;
    if (typeof w?.spriteId === "number" && (w.spriteId | 0) >= 0) return true;
    if (typeof w?.spriteId2 === "number" && (w.spriteId2 | 0) >= 0) return true;
    return typeof w?.itemId === "number" && (w.itemId | 0) >= 0;
}

function hasVisibleModelContent(w: any): boolean {
    return !!(
        (typeof w?.modelId === "number" && (w.modelId | 0) >= 0) ||
        (typeof w?.itemId === "number" && (w.itemId | 0) >= 0) ||
        w?.isPlayerChathead ||
        w?.isNpcChathead ||
        ((w?.contentType ?? 0) | 0) === 328 ||
        ((w?.modelType ?? 0) | 0) === 7 ||
        w?.isPlayerModel
    );
}

function hasVisibleInventoryContent(w: any): boolean {
    if (typeof w?.itemId === "number" && (w.itemId | 0) >= 0) return true;
    if (!Array.isArray(w?.itemIds)) return false;
    return w.itemIds.some((itemId: unknown) => typeof itemId === "number" && (itemId | 0) > 0);
}

// Camera zoom blocking should follow visible widget surfaces, not listener-only widgets.
// This keeps empty runtime children such as buff_bar:buff_listeners from swallowing wheel input.
export function getVisibleWidgetSurfaceReason(w: any): string | undefined {
    if (!w) return undefined;

    const type = ((w?.type ?? 0) | 0) as number;
    const isContainer = type === 0 || type === 11;
    const hasText =
        !!sanitizeText(w?.text) || !!sanitizeText(w?.text2) || !!sanitizeText(w?.dataText);

    if (isContainer) {
        if (w?.noClickThrough) return "visible_container_widget:noClickThrough";
        if ((getWidgetTransparency(w) | 0) < 255 && w?.filled) {
            return "visible_container_widget:filled";
        }
        if (hasVisibleSpriteContent(w)) return "visible_container_widget:sprite";
        return undefined;
    }

    switch (type) {
        case 2:
            return hasVisibleInventoryContent(w)
                ? "visible_non_container_widget:inventory"
                : undefined;
        case 3:
            return (getWidgetTransparency(w) | 0) < 255
                ? "visible_non_container_widget:rectangle"
                : undefined;
        case 4:
        case 8:
            return hasText ? "visible_non_container_widget:text" : undefined;
        case 5:
            return hasVisibleSpriteContent(w) ? "visible_non_container_widget:sprite" : undefined;
        case 6:
            return hasVisibleModelContent(w) ? "visible_non_container_widget:model" : undefined;
        case 9:
            return ((w?.rawWidth ?? w?.width ?? 0) | 0) !== 0 ||
                ((w?.rawHeight ?? w?.height ?? 0) | 0) !== 0
                ? "visible_non_container_widget:line"
                : undefined;
        default:
            if (hasText) return `visible_non_container_widget:type${type}_text`;
            if (hasVisibleSpriteContent(w)) {
                return `visible_non_container_widget:type${type}_sprite`;
            }
            if (hasVisibleModelContent(w)) return `visible_non_container_widget:type${type}_model`;
            if (hasVisibleInventoryContent(w)) {
                return `visible_non_container_widget:type${type}_inventory`;
            }
            return undefined;
    }
}

// Best-effort plain-text target label for a widget: prefer opBase, then dataText, name, text.
export function getWidgetTargetLabel(w: any): string {
    if (w && (w as any).__dummyRoot) return ""; // never surface synthetic root ids
    // Check opBase first - CS2 scripts set this for spells via if_setopbase.
    const opBase = sanitizeText(w?.opBase);
    if (opBase) return opBase;
    const dataText = sanitizeText(w?.dataText);
    if (dataText) return dataText;
    const name = sanitizeText(w?.name);
    if (name) return name;
    const text = sanitizeText(w?.text);
    if (text) return text;
    // Avoid exposing raw ids like "Widget 0:0" in the Choose Option overlay
    // when a widget has no meaningful label. Return empty to omit the right-side target.
    return "";
}

// OSRS widget menus render dataText/opBase with markup intact.
// Preserve tags for menu rendering, but keep getWidgetTargetLabel() for plain-text comparisons.
export function getWidgetTargetLabelForMenu(w: any): string {
    if (w && (w as any).__dummyRoot) return "";
    const opBase = sanitizeTextPreserveMarkup(w?.opBase);
    if (opBase) return opBase;
    const dataText = sanitizeTextPreserveMarkup(w?.dataText);
    if (dataText) return dataText;
    const name = sanitizeTextPreserveMarkup(w?.name);
    if (name) return name;
    const text = sanitizeTextPreserveMarkup(w?.text);
    if (text) return text;
    return "";
}

// spell selection verb comes from Widget.spellActionName.
// Runtime code may mirror this into targetVerb, but spellActionName is the canonical source.
function getWidgetTargetVerb(w: any, targetMask: number): string | undefined {
    const targetVerb = sanitizeText(w?.targetVerb);
    if (targetVerb) return targetVerb;
    if ((targetMask | 0) <= 0) return undefined;
    return sanitizeText(w?.spellActionName);
}

// "pause button" widgets (e.g., "Click here to continue") are clickable even when they have
// no explicit actions/handlers in the widget definition. In the official client these send RESUME_PAUSEBUTTON.
//
// Only checks flags, no text-based fallback
// Note: In OSRS, IF_SETEVENTS sets flags directly on each childIndex via Client.widgetFlags.
// Dynamic children look up their own flags using key (id << 32) | childIndex.
export function isPauseButtonWidget(
    w: any,
    getWidgetFlags?: (w: any) => number,
    _getWidgetByUid?: (uid: number) => any, // kept for API compatibility
): boolean {
    if (!w) return false;
    // Look up flags for this widget directly.
    // For static widgets: key = (uid << 32) | 0
    // For dynamic widgets: key = (parentUid << 32) | childIndex
    const flags =
        typeof getWidgetFlags === "function" ? getWidgetFlags(w) | 0 : (w?.flags ?? 0) | 0;
    return isPauseButton(flags);
}

// Derive menu entries from widget actions[] and targetVerb.
// If onlyBasic is true, only return Cancel (used when custom entries are provided)
// Menu options are only shown if:
// 1. The transmit flag for that action is set (bits 1-10), OR
// 2. The widget has an onOp handler
export function deriveMenuEntriesForWidget(
    w: any,
    onlyBasic?: boolean,
    getWidgetFlags?: (w: any) => number,
    getWidgetByUid?: (uid: number) => any,
): SimpleMenuEntry[] {
    const entries: SimpleMenuEntry[] = [];
    if (onlyBasic) {
        entries.push({ option: "Cancel" });
        return entries;
    }
    const target = getWidgetTargetLabelForMenu(w);
    const plainTarget = getWidgetTargetLabel(w);
    const actions: any[] = Array.isArray(w?.actions) ? (w.actions as any[]) : [];

    // Get widget flags for transmit checks
    const flags =
        typeof getWidgetFlags === "function" ? getWidgetFlags(w) | 0 : (w?.flags ?? 0) | 0;
    const targetMask = (flags >>> 11) & 0x3f;
    const verb = getWidgetTargetVerb(w, targetMask);

    // Check if widget has onOp handler (either new or old style)
    const hasOnOpHandler = !!(w?.onOp || w?.eventHandlers?.onOp);

    // inventory/container item menus treat targetVerb ("Use") as its own entry,
    // not as a placeholder that fills empty action slots. Filling null action slots causes
    // "Use" to appear above the primary item action (e.g., Staff of air: Use, Wield, ...),
    // which is incorrect (should be Wield, Use, ...).
    const hasItem = typeof w?.itemId === "number" && w.itemId > 0;
    const itemTarget =
        hasItem && plainTarget
            ? `${colorStartTag(ITEM_MENU_TARGET_RGB)}${plainTarget}`
            : plainTarget;

    if (hasItem) {
        const ops: Array<{ text: string; index: number }> = [];
        for (let i = 0; i < actions.length; i++) {
            const p = sanitizeText(actions[i]);
            // Only include action if transmit flag is set OR widget has onOp handler
            // Action flag and onOp check
            if (p && shouldShowMenuOption(flags, i, hasOnOpHandler)) {
                ops.push({ text: p, index: i });
            }
        }

        if (verb) {
            const verbLower = verb.toLowerCase();
            const alreadyHasVerb = ops.some((o) => String(o.text).toLowerCase() === verbLower);
            if (!alreadyHasVerb) {
                // Insert after the first non-drop action when present, otherwise at the top.
                const firstNonDropIdx = ops.findIndex((o) => {
                    const lower = String(o.text).toLowerCase();
                    return lower !== "drop" && lower !== "examine" && lower !== "cancel";
                });
                const insertAt = firstNonDropIdx >= 0 ? firstNonDropIdx + 1 : 0;
                ops.splice(insertAt, 0, { text: verb, index: -1 }); // -1 = targetVerb, not an action index
            }
        }

        for (const op of ops) entries.push({ option: op.text, target: itemTarget });
    } else if (actions.length) {
        const ops: string[] = [];
        for (let i = 0; i < actions.length; i++) {
            const p = sanitizeText(actions[i]);
            // Only include action if transmit flag is set OR widget has onOp handler
            if (shouldShowMenuOption(flags, i, hasOnOpHandler)) {
                if (p) ops.push(p);
                else if (verb) ops.push(verb);
            }
        }
        // spell action (buttonType=2 / spellActionName) is an explicit menu entry,
        // not just a placeholder for empty op slots.
        if (ops.length === 0 && verb) {
            ops.push(verb);
        }
        for (const option of ops) entries.push({ option, target });
    } else {
        if (verb) entries.push({ option: verb, target });
    }
    // widget menus use configured ops (actions + flags + handlers).
    // Do not synthesize fallback Examine options for item widgets here.
    // Pause button widgets (flags & 1) show "Continue" with empty target
    
    // This is added after ops are checked, only if no other actionable entries exist
    const hasActionableEntry = entries.some(
        (e) =>
            e.option && e.option.toLowerCase() !== "cancel" && e.option.toLowerCase() !== "examine",
    );
    if (!hasActionableEntry && isPauseButtonWidget(w, getWidgetFlags, getWidgetByUid)) {
        entries.unshift({ option: "Continue", target: "" });
    }
    entries.push({ option: "Cancel" });
    return entries;
}

// Clip bounds for hit testing - matches rendering scissor logic
interface HitClip {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
}

type RootRenderTransform = {
    scaleX: number;
    scaleY: number;
    offsetX: number;
    offsetY: number;
};

function getRootRenderTransform(root: any): RootRenderTransform {
    const scaleXRaw = Number(
        (root as any)?.__widgetRenderScaleX ?? (root as any)?.__widgetRenderScale ?? 1.0,
    );
    const scaleYRaw = Number(
        (root as any)?.__widgetRenderScaleY ?? (root as any)?.__widgetRenderScale ?? 1.0,
    );
    const scaleX = Number.isFinite(scaleXRaw) && scaleXRaw > 0 ? scaleXRaw : 1.0;
    const scaleY = Number.isFinite(scaleYRaw) && scaleYRaw > 0 ? scaleYRaw : 1.0;
    const offsetXRaw = Number((root as any)?.__widgetRenderOffsetX ?? 0);
    const offsetYRaw = Number((root as any)?.__widgetRenderOffsetY ?? 0);
    const offsetX = Number.isFinite(offsetXRaw) ? Math.floor(offsetXRaw) : 0;
    const offsetY = Number.isFinite(offsetYRaw) ? Math.floor(offsetYRaw) : 0;
    return { scaleX, scaleY, offsetX, offsetY };
}

function toLogicalPoint(
    px: number,
    py: number,
    transform: RootRenderTransform,
): { x: number; y: number } {
    return {
        x: Math.floor((px - transform.offsetX) / transform.scaleX),
        y: Math.floor((py - transform.offsetY) / transform.scaleY),
    };
}

function applyScreenTransformToWidgetAbs(w: any, transform: RootRenderTransform): void {
    if (!w) return;
    if (typeof w._absX === "number") {
        const logicalAbsX = w._absX | 0;
        (w as any)._absLogicalX = logicalAbsX;
        w._absX = Math.round(logicalAbsX * transform.scaleX + transform.offsetX);
    }
    if (typeof w._absY === "number") {
        const logicalAbsY = w._absY | 0;
        (w as any)._absLogicalY = logicalAbsY;
        w._absY = Math.round(logicalAbsY * transform.scaleY + transform.offsetY);
    }
}

/**
 * PERF: Find topmost drop target at a point with early exit.
 * Much faster than collectWidgetsAtPoint when we only need one result.
 *
 * @param roots Array of root widgets to search
 * @param px X coordinate
 * @param py Y coordinate
 * @param visible Visibility map
 * @param getStaticChildren Static children lookup
 * @param getWidgetFlags Function to get widget flags (for drop capability check)
 * @param excludeUid Widget UID to exclude (the dragged widget)
 * @returns The topmost widget that can receive drops, or null
 */
export function findDropTarget(
    roots: any[],
    px: number,
    py: number,
    visible: Map<number, boolean>,
    getStaticChildren: (uid: number) => any[],
    getWidgetFlags: (w: any) => number,
    excludeUid: number,
    getInterfaceParentRoots?: (containerUid: number) => any[],
): any | null {
    let queryX = px;
    let queryY = py;
    const inRect = (x: number, y: number, w: number, h: number) =>
        queryX >= x && queryY >= y && queryX < x + w && queryY < y + h;

    // Intersect widget bounds with clip to get new clip bounds
    const intersectClip = (
        clip: { x0: number; y0: number; x1: number; y1: number },
        x: number,
        y: number,
        w: number,
        h: number,
    ) => ({
        x0: Math.max(clip.x0, x),
        y0: Math.max(clip.y0, y),
        x1: Math.min(clip.x1, x + w),
        y1: Math.min(clip.y1, y + h),
    });

    const inClip = (clip: { x0: number; y0: number; x1: number; y1: number }) =>
        queryX >= clip.x0 && queryX < clip.x1 && queryY >= clip.y0 && queryY < clip.y1;

    // Returns the topmost drop target found in this subtree, or null
    const visit = (
        w: any,
        ox: number,
        oy: number,
        clip: { x0: number; y0: number; x1: number; y1: number },
    ): any | null => {
        if (!w) return null;
        const uid = (w.uid ?? 0) | 0;

        // Skip the dragged widget
        if (uid === excludeUid) return null;

        const selfVisible = visible.get(uid) !== false && !w.hidden;
        if (!selfVisible) return null;

        // Use visual position for dragged widgets
        const isDragActive = !!(w as any)._isDragActive;
        const visualX = isDragActive ? (w as any)._dragVisualX ?? w.x : w.x;
        const visualY = isDragActive ? (w as any)._dragVisualY ?? w.y : w.y;
        const x = ox + ((visualX as number) | 0);
        const y = oy + ((visualY as number) | 0);
        const width = Math.max(1, (w.width as number) | 0 || 0);
        const height = Math.max(1, (w.height as number) | 0 || 0);

        const t = ((w.type as number) ?? 0) | 0;
        const isContainer = t === 0 || t === 11;
        const childClip = isContainer ? intersectClip(clip, x, y, width, height) : clip;

        // Check if we should traverse children
        const gate = isContainer ? inRect(x, y, width, height) && inClip(clip) : true;

        // Track best result from children (topmost = last in traversal order)
        let result: any | null = null;

        if (gate) {
            const cx = x - ((w.scrollX as number) || 0);
            const cy = y - ((w.scrollY as number) || 0);

            // Visit static children
            const staticChildren = getStaticChildren(uid);
            for (const c of staticChildren) {
                const found = visit(c, cx, cy, childClip);
                if (found) result = found; // Later = topmost
            }

            // Visit dynamic children
            if (Array.isArray(w.children)) {
                for (const c of w.children) {
                    const found = visit(c, cx, cy, childClip);
                    if (found) result = found;
                }
            }

            // Visit InterfaceParent (mounted) interface roots LAST (topmost)
            // and WITHOUT applying container scroll offsets.
            if (t === 0 && typeof getInterfaceParentRoots === "function") {
                const mountRoots = getInterfaceParentRoots(uid);
                if (Array.isArray(mountRoots) && mountRoots.length > 0) {
                    for (const mr of mountRoots) {
                        const found = visit(mr, x, y, childClip);
                        if (found) result = found;
                    }
                }
            }
        }

        // If a child was a valid drop target, return it (it's topmost)
        if (result) return result;

        // Check if THIS widget is a valid drop target
        if (inRect(x, y, width, height) && inClip(clip)) {
            const flags = getWidgetFlags(w) | 0;
            const canReceiveDrop = isDropTarget(flags);
            // Multiple mechanisms make a widget a valid drop target:
            // 1. Bit 20 of flags set (explicit drop capability)
            // 2. onTargetEnter/onTargetLeave/onDragComplete handlers (receives drag events)
            // 3. isDraggable widgets (can both drag and receive drops from similar widgets)
            // 4. onOp/actions (interactive widget - server validates if drop is valid)
            const hasTargetHandler = !!(
                w.onTargetEnter ||
                w.onTargetLeave ||
                w.onDragComplete ||
                w.eventHandlers?.onTargetEnter ||
                w.eventHandlers?.onTargetLeave ||
                w.eventHandlers?.onDragComplete
            );
            // Draggable widgets can receive drops from other draggable widgets
            const isDraggable = !!(w.isDraggable || w.onDrag || w.eventHandlers?.onDrag);
            // Widgets with onOp/actions can be drop targets - server validates the drop
            const hasInteraction = !!(
                w.onOp ||
                w.eventHandlers?.onOp ||
                (Array.isArray(w.actions) && w.actions.length > 0)
            );
            if (canReceiveDrop || hasTargetHandler || isDraggable || hasInteraction) {
                w._absX = x;
                w._absY = y;
                return w;
            }
        }

        return null;
    };

    const fullClip = { x0: -Infinity, y0: -Infinity, x1: Infinity, y1: Infinity };

    // Search roots in order, last root's result wins (topmost)
    let result: any | null = null;
    for (const root of roots) {
        const transform = getRootRenderTransform(root);
        const logicalPoint = toLogicalPoint(px, py, transform);
        queryX = logicalPoint.x;
        queryY = logicalPoint.y;
        const found = visit(root, 0, 0, fullClip);
        if (found) {
            applyScreenTransformToWidgetAbs(found, transform);
            result = found;
        }
    }
    return result;
}

// Collect widgets under a point, returning from bottom to top (last is topmost)
// Also stores _absX and _absY on each hit widget for event coordinate calculation
// getStaticChildren callback for parentUid filtering
// noClickThrough flag blocks widgets behind from receiving click events
// getInterfaceParentRoots callback for traversing InterfaceParent mounted sub-interfaces
// Widget menu entry builder
export function collectWidgetsAtPoint(
    root: any,
    px: number,
    py: number,
    visible: Map<number, boolean>,
    getStaticChildren?: (uid: number) => any[],
    getInterfaceParentRoots?: (containerUid: number) => any[],
    isInputCaptureWidget?: (uid: number, widget?: any) => boolean,
): any[] {
    const hits: any[] = [];
    // Index where noClickThrough was encountered - widgets before this index are blocked
    let noClickThroughIndex = -1;
    const inRect = (x: number, y: number, w: number, h: number) =>
        px >= x && py >= y && px < x + w && py < y + h;

    // Check if point is within clip bounds
    const inClip = (clip: HitClip) =>
        px >= clip.x0 && px < clip.x1 && py >= clip.y0 && py < clip.y1;

    // Intersect widget bounds with clip to get new clip bounds
    const intersectClip = (clip: HitClip, x: number, y: number, w: number, h: number): HitClip => ({
        x0: Math.max(clip.x0, x),
        y0: Math.max(clip.y0, y),
        x1: Math.min(clip.x1, x + w),
        y1: Math.min(clip.y1, y + h),
    });

    const visit = (w: any, ox: number, oy: number, clip: HitClip) => {
        if (!w) return;
        const uid = (w.uid ?? 0) | 0;
        // OSRS-style: Check 'hidden' property (set by if_sethide/cc_sethide CS2 opcodes)
        const selfVisible = visible.get(uid) !== false && !w.hidden;
        if (!selfVisible) return;
        // Match rendering: widgets being dragged use their visual position for hit testing.
        const isDragActive = !!(w as any)._isDragActive;
        const visualX = isDragActive ? (w as any)._dragVisualX ?? w.x : w.x;
        const visualY = isDragActive ? (w as any)._dragVisualY ?? w.y : w.y;
        const x = ox + ((visualX as number) | 0);
        const y = oy + ((visualY as number) | 0);
        const width = Math.max(1, (w.width as number) | 0 || 0);
        const height = Math.max(1, (w.height as number) | 0 || 0);

        // Calculate clip for this widget's children
        // Type 0/11 containers always clip their children to their bounds.
        const t = ((w.type as number) ?? 0) | 0;
        const isContainer = t === 0 || t === 11;
        const childClip = isContainer ? intersectClip(clip, x, y, width, height) : clip;

        // Record hit BEFORE traversing children so children end up later in `hits`
        // and win when callers scan from the end (top-most).
        // This matches rendering order where a widget is drawn before its children.
        if (inRect(x, y, width, height) && inClip(clip)) {
            // Store absolute position for event coordinate calculation
            w._absX = x;
            w._absY = y;
            hits.push(w);
            // Check noClickThrough flag
            
            // When noClickThrough is true on an IF3 widget, widgets behind it are blocked.
            // In OSRS, this clears pending script events for all widgets processed earlier.
            // We track the index so we can filter them out after traversal.
            if (
                (w.noClickThrough && w.isIf3 !== false) ||
                !!isInputCaptureWidget?.((w.uid ?? 0) | 0, w)
            ) {
                // Mark where the blocking started - all widgets before this point are blocked
                noClickThroughIndex = hits.length - 1;
            }
        }

        // Traverse children after recording self so top-most child wins (children are later in `hits`).
        // Gate by container bounds.
        // Content containers (with children but scrollHeight=0) are transparent
        // to hit testing - their children should be tested even if the container itself
        // is outside the visible area (due to scroll offset adjusting its position).
        // Only scroll containers (scrollHeight > 0) should gate their children.
        const canTraverseChildren = isContainer
            ? inRect(x, y, width, height) && inClip(clip)
            : true;
        if (canTraverseChildren) {
            const cx = x - ((w.scrollX as number) || 0);
            const cy = y - ((w.scrollY as number) || 0);

            // traverse static children (via parentUid filtering)
            if (getStaticChildren) {
                const staticChildren = getStaticChildren(uid);
                for (const c of staticChildren) visit(c, cx, cy, childClip);
            }
            // Traverse dynamic children (from CC_CREATE)
            if (Array.isArray(w.children) && w.children.length) {
                for (const c of w.children) {
                    if (!c) continue; // Skip null entries (sparse array from CC_CREATECHILD padding)
                    visit(c, cx, cy, childClip); // Scrolled position
                }
            }

            // Traverse InterfaceParent (mounted) interface roots LAST and
            // WITHOUT applying container scroll offsets.
            if (t === 0 && typeof getInterfaceParentRoots === "function") {
                const mountRoots = getInterfaceParentRoots(uid);
                if (Array.isArray(mountRoots) && mountRoots.length > 0) {
                    for (const mr of mountRoots) visit(mr, x, y, childClip);
                }
            }
        }
    };

    // Start with full screen clip bounds
    const fullClip: HitClip = { x0: -Infinity, y0: -Infinity, x1: Infinity, y1: Infinity };
    visit(root, 0, 0, fullClip);

    // If a noClickThrough widget was hit, remove widgets behind it
    // Keep only the noClickThrough widget and widgets after it (children rendered on top)
    if (noClickThroughIndex >= 0) {
        return hits.slice(noClickThroughIndex);
    }
    return hits;
}

// Collect widgets across multiple roots in render order (bottom -> top).
// Applies noClickThrough globally so overlays in one root can block widgets in others.
export function collectWidgetsAtPointAcrossRoots(
    roots: any[],
    px: number,
    py: number,
    visible: Map<number, boolean>,
    getStaticChildren?: (uid: number) => any[],
    getInterfaceParentRoots?: (containerUid: number) => any[],
    isInputCaptureWidget?: (uid: number, widget?: any) => boolean,
): any[] {
    const allHits: any[] = [];
    let noClickThroughIndex = -1;

    for (const root of roots) {
        const transform = getRootRenderTransform(root);
        const logicalPoint = toLogicalPoint(px, py, transform);
        const hits = collectWidgetsAtPoint(
            root,
            logicalPoint.x,
            logicalPoint.y,
            visible,
            getStaticChildren,
            getInterfaceParentRoots,
            isInputCaptureWidget,
        );
        for (const w of hits) {
            applyScreenTransformToWidgetAbs(w, transform);
            allHits.push(w);
            if (
                (w?.noClickThrough && w?.isIf3 !== false) ||
                !!isInputCaptureWidget?.((w?.uid ?? 0) | 0, w)
            ) {
                noClickThroughIndex = allHits.length - 1;
            }
        }
    }

    if (noClickThroughIndex >= 0) {
        return allHits.slice(noClickThroughIndex);
    }
    return allHits;
}

// Find the top-most widget in a hit stack that should block world interactions behind it.
// `hits` must be ordered bottom -> top, matching collectWidgetsAtPointAcrossRoots().
export function findBlockingWidgetInHits(
    hits: any[],
    options?: {
        isInputCaptureWidget?: (uid: number, widget?: any) => boolean;
        getWidgetFlags?: (widget: any) => number;
        getWidgetByUid?: (uid: number) => any;
    },
): any | null {
    const isInputCaptureWidget = options?.isInputCaptureWidget;
    const getWidgetFlags = options?.getWidgetFlags ?? ((widget: any) => (widget?.flags ?? 0) | 0);
    const getWidgetByUid = options?.getWidgetByUid;

    for (let i = hits.length - 1; i >= 0; i--) {
        const w = hits[i];
        if (!w) continue;
        const uid = (w.uid ?? 0) | 0;

        if (w.noClickThrough) return w;
        if (isInputCaptureWidget?.(uid, w)) return w;

        const flags = getWidgetFlags(w) | 0;
        const targetMask = (flags >>> 11) & 0x3f;
        const hasActions =
            Array.isArray(w?.actions) &&
            w.actions.some((action: unknown) => !!sanitizeText(action as string | null));
        const hasHandlers = !!(
            w?.eventHandlers?.onClick ||
            w?.eventHandlers?.onOp ||
            w?.eventHandlers?.onHold ||
            w?.eventHandlers?.onRelease ||
            w?.eventHandlers?.onDrag ||
            w?.onClick ||
            w?.onOp ||
            w?.onHold ||
            w?.onRelease ||
            w?.onDrag
        );
        const hasOriginalHandlers = !!(
            w?.__hasOriginalOnClick ||
            w?.__hasOriginalOnOp ||
            w?.__hasOriginalOnHold ||
            w?.__hasOriginalOnRelease
        );
        const hasTransmitOps = (flags & 0x7fe) !== 0;
        const hasSpellAction =
            targetMask > 0 && !!sanitizeText(w?.spellActionName ?? w?.targetVerb);
        const hasItem = typeof w?.itemId === "number" && (w.itemId | 0) > 0;
        const isPauseWidget = isPauseButtonWidget(w, getWidgetFlags, getWidgetByUid);
        const isDraggable = !!(w?.isDraggable || w?.eventHandlers?.onDrag || w?.onDrag);
        const buttonType = (w?.buttonType ?? 0) | 0;

        if (
            hasActions ||
            hasHandlers ||
            hasOriginalHandlers ||
            hasTransmitOps ||
            hasSpellAction ||
            hasItem ||
            isPauseWidget ||
            isDraggable ||
            buttonType > 0
        ) {
            return w;
        }
    }
    return null;
}

// Check if a widget at a point should block scroll events from reaching widgets behind it
// Tooltip menu entry builder
// Used to implement noScrollThrough behavior - when a widget with this flag is under the cursor,
// onScroll events should not propagate to parent/sibling widgets.
export function shouldBlockScrollThrough(
    root: any,
    px: number,
    py: number,
    visible: Map<number, boolean>,
    getStaticChildren?: (uid: number) => any[],
): boolean {
    const inRect = (x: number, y: number, w: number, h: number) =>
        px >= x && py >= y && px < x + w && py < y + h;

    // Check if point is within clip bounds
    const inClip = (clip: HitClip) =>
        px >= clip.x0 && px < clip.x1 && py >= clip.y0 && py < clip.y1;

    // Intersect widget bounds with clip to get new clip bounds
    const intersectClip = (clip: HitClip, x: number, y: number, w: number, h: number): HitClip => ({
        x0: Math.max(clip.x0, x),
        y0: Math.max(clip.y0, y),
        x1: Math.min(clip.x1, x + w),
        y1: Math.min(clip.y1, y + h),
    });

    const visit = (w: any, ox: number, oy: number, clip: HitClip): boolean => {
        if (!w) return false;
        const uid = (w.uid ?? 0) | 0;
        const selfVisible = visible.get(uid) !== false && !w.hidden;
        if (!selfVisible) return false;
        const x = ox + ((w.x as number) | 0);
        const y = oy + ((w.y as number) | 0);
        const width = Math.max(1, (w.width as number) | 0 || 0);
        const height = Math.max(1, (w.height as number) | 0 || 0);

        // Calculate clip for children - only scroll containers push new clip bounds
        const hasOwnScrollArea = ((w.scrollHeight as number) || 0) > 0;
        const childClip = hasOwnScrollArea ? intersectClip(clip, x, y, width, height) : clip;

        // Check children first (top-most widgets first)
        const gate = w.type === 0 ? inRect(x, y, width, height) : true;
        if (gate) {
            const cx = x - ((w.scrollX as number) || 0);
            const cy = y - ((w.scrollY as number) || 0);
            if (getStaticChildren) {
                const staticChildren = getStaticChildren(uid);
                for (const c of staticChildren) {
                    if (visit(c, cx, cy, childClip)) return true;
                }
            }
            if (Array.isArray(w.children) && w.children.length) {
                for (const c of w.children) {
                    if (visit(c, cx, cy, childClip)) return true;
                }
            }
        }
        // Check if this widget has noScrollThrough and is under the cursor (and within clip)
        if (inRect(x, y, width, height) && inClip(clip) && w.noScrollThrough && w.isIf3 !== false) {
            return true;
        }
        return false;
    };

    const fullClip: HitClip = { x0: -Infinity, y0: -Infinity, x1: Infinity, y1: Infinity };
    return visit(root, 0, 0, fullClip);
}

// Collect ALL visible widgets with onKey handlers from a tree
// OSRS dispatches key events to all widgets with onKey handlers, not just mouse-hovered ones
// Also stores _absX and _absY on each widget for event coordinate calculation
// getStaticChildren callback for parentUid filtering
export function collectWidgetsWithKeyHandlers(
    root: any,
    visible: Map<number, boolean>,
    getStaticChildren?: (uid: number) => any[],
): any[] {
    const hits: any[] = [];
    const visit = (w: any, ox: number, oy: number) => {
        if (!w) return;
        const uid = (w.uid ?? 0) | 0;
        const selfVisible = visible.get(uid) !== false && !w.hidden;
        if (!selfVisible) return;
        const x = ox + ((w.x as number) | 0);
        const y = oy + ((w.y as number) | 0);
        // Check for onKey handler
        if (w.eventHandlers?.onKey || w.onKey) {
            // Store absolute position for event coordinate calculation
            w._absX = x;
            w._absY = y;
            hits.push(w);
        }
        const cx = x - ((w.scrollX as number) || 0);
        const cy = y - ((w.scrollY as number) || 0);
        // traverse static children (via parentUid filtering)
        if (getStaticChildren) {
            const staticChildren = getStaticChildren(uid);
            for (const c of staticChildren) visit(c, cx, cy);
        }
        // Traverse dynamic children (from CC_CREATE)
        if (Array.isArray(w.children) && w.children.length) {
            for (const c of w.children) visit(c, cx, cy);
        }
    };
    visit(root, 0, 0);
    return hits;
}
