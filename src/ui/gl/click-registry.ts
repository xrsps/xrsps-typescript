export type Rect = { x: number; y: number; w: number; h: number };

export type ClickTarget = {
    id: string;
    rect: Rect;
    priority?: number; // higher wins on overlap; default 0; tie -> later registered wins
    // When true, the target survives beginFrame() clearing so it stays active
    // across renders until explicitly unregistered.
    persist?: boolean;
    // Optional widget UID for OSRS-style visibility filtering during hit testing.
    // When set, the registry can check if the widget is hidden and skip it.
    widgetUid?: number;
    // Optional hover label metadata (consumed by CS2 minimenu snapshot logic).
    hoverText?: string;
    // Optional primary action metadata for minimenu option/target resolution.
    primaryOption?: { option: string; target?: string };
    // Optional full minimenu size for this hover target (OSRS menuOptionsCount parity).
    // Includes "Cancel" when applicable.
    menuOptionsCount?: number;
    onDown?: (x?: number, y?: number, targetId?: string) => void;
    onUp?: (x?: number, y?: number, targetId?: string) => void;
    // Optional click handler. Receives the pointer position in canvas pixels
    // (same coordinate space as the GL renderer canvas), and optionally the target id.
    onClick?: (x?: number, y?: number, targetId?: string) => void;
    onHoverChange?: (hover: boolean) => void;
};

function inRect(p: { x: number; y: number }, r: Rect) {
    return p.x >= r.x && p.y >= r.y && p.x < r.x + r.w && p.y < r.y + r.h;
}

export class ClickRegistry {
    private targets: ClickTarget[] = [];
    private targetIndexById: Map<string, number> = new Map();
    private registrationOrderById: Map<string, number> = new Map();
    private nextRegistrationOrder: number = 1;
    private hoverId: string | null = null;
    private activeId: string | null = null;
    // Store the active target itself, not just the id, so it survives beginFrame() clearing
    private activeTarget: ClickTarget | null = null;
    // OSRS-style visibility checker: returns true if widget is hidden (should be skipped)
    private widgetHiddenChecker: ((uid: number) => boolean) | null = null;

    /**
     * Set the widget visibility checker for OSRS-style hit testing.
     * The checker should return true if the widget is hidden (should be skipped during pick).
     * This matches OSRS behavior where visibility is checked at query time, not cached.
     */
    setWidgetHiddenChecker(checker: ((uid: number) => boolean) | null): void {
        this.widgetHiddenChecker = checker;
    }

    beginFrame() {
        // Preserve any persistent targets (e.g., dialog click-to-continue) while
        // clearing transient ones that get re-registered each frame.
        if (this.targets.length) {
            this.targets = this.targets.filter((t) => t.persist);
        } else {
            this.targets = [];
        }
        this.rebuildIndexes();
        // keep hover/active across frames when still valid
    }

    register(target: ClickTarget) {
        // Replace-by-id to avoid unbounded growth when callers re-register targets every frame.
        // Track "latest registered" via a monotonic order counter instead of physically moving
        // array entries, which avoids O(n) churn during large widget redraws.
        const existingIdx = this.targetIndexById.get(target.id);
        if (existingIdx !== undefined) {
            this.targets[existingIdx] = target;
        } else {
            this.targetIndexById.set(target.id, this.targets.length);
            this.targets.push(target);
        }
        this.registrationOrderById.set(target.id, this.nextRegistrationOrder++);
    }

    unregister(id: string) {
        const idx = this.targetIndexById.get(id);
        if (idx !== undefined) {
            const lastIdx = this.targets.length - 1;
            if (idx !== lastIdx) {
                const last = this.targets[lastIdx];
                this.targets[idx] = last;
                this.targetIndexById.set(last.id, idx);
            }
            this.targets.pop();
            this.targetIndexById.delete(id);
        }
        this.registrationOrderById.delete(id);
        if (this.hoverId === id) this.hoverId = null;
        if (this.activeId === id) this.activeId = null;
    }

    /**
     * Unregister all widget click targets belonging to a specific interface group.
     * Widget target ids follow the format "widget:{uid}" where uid = (groupId << 16) | childId.
     */
    unregisterWidgetGroup(groupId: number): number {
        const toRemove: string[] = [];
        for (const target of this.targets) {
            if (!target.id.startsWith("widget:")) continue;
            const uid = parseInt(target.id.substring(7), 10);
            if (isNaN(uid)) continue;
            if (((uid >>> 16) & 0xffff) === groupId) {
                toRemove.push(target.id);
            }
        }
        for (const id of toRemove) {
            this.unregister(id);
        }
        return toRemove.length;
    }

    onPointerMove(x: number, y: number): boolean {
        const hit = this.pick(x, y);
        const id = hit?.id || null;
        if (id !== this.hoverId) {
            // notify previous
            const prev = this.hoverId ? this.getTargetById(this.hoverId) : undefined;
            if (prev?.onHoverChange) prev.onHoverChange(false);
            const next = id ? this.getTargetById(id) : undefined;
            if (next?.onHoverChange) next.onHoverChange(true);
            this.hoverId = id;
            return true;
        }
        return false;
    }

    onPointerDown(x: number, y: number): boolean {
        const hit = this.pick(x, y);
        if (!hit) {
            return false;
        }
        this.activeId = hit.id;
        // Store the target itself so it survives beginFrame() clearing the targets array
        this.activeTarget = hit;
        try {
            hit.onDown?.(x, y, hit.id);
        } catch {}
        return true;
    }

    onPointerUp(x: number, y: number): boolean {
        // Use the stored active target (survives beginFrame clearing), fall back to pick
        let target: ClickTarget | undefined = this.activeTarget ?? undefined;
        // If activeTarget was cleared somehow, try to find by id as fallback
        if (!target && this.activeId) {
            target = this.getTargetById(this.activeId);
        }
        const hadActive = !!this.activeTarget;
        this.activeId = null;
        this.activeTarget = null;
        if (!target) {
            target = this.pick(x, y);
        }
        if (!target) {
            return false;
        }
        try {
            target.onUp?.(x, y, target.id);
        } catch {}
        if (inRect({ x, y }, target.rect)) {
            try {
                // Pass pointer position and target id to onClick so consumers can synthesize
                // precise mouse events or use the coordinates directly.
                // PERF: Passing targetId allows dispatcher pattern without closures per target.
                target.onClick?.(x, y, target.id);
            } catch {}
            return true;
        }
        return false;
    }

    isPressed(id: string): boolean {
        return this.activeId === id;
    }

    /**
     * Cancel any active click interaction (prevents onClick from firing on release).
     * Use this when a click has been consumed by a handler (e.g., menu option selected).
     */
    cancelActiveClick(): void {
        this.activeId = null;
        this.activeTarget = null;
    }

    isHover(id: string): boolean {
        return this.hoverId === id;
    }

    // Expose the currently hovered target (if any) for UI overlays
    // OSRS-style: Also checks visibility in case widget became hidden after hover was set
    getHoverTarget(): ClickTarget | undefined {
        const id = this.hoverId;
        if (!id) return undefined;
        const target = this.getTargetById(id);
        if (!target) return undefined;
        // Check visibility at query time (OSRS-style)
        if (target.widgetUid !== undefined && this.widgetHiddenChecker?.(target.widgetUid)) {
            return undefined;
        }
        return target;
    }

    // PERF: Expose the currently active (clicked) target for dispatcher pattern
    getActiveTarget(): ClickTarget | null {
        return this.activeTarget;
    }

    getDebugRects(): Rect[] {
        return this.targets.map((t) => t.rect);
    }

    private pick(x: number, y: number): ClickTarget | undefined {
        let best: ClickTarget | undefined;
        let bestP = -Infinity;
        for (let i = 0; i < this.targets.length; i++) {
            const t = this.targets[i];
            if (!inRect({ x, y }, t.rect)) continue;
            // OSRS-style: Check widget visibility at query time, not cached.
            // Skip hidden widgets even if their click target is registered.
            if (t.widgetUid !== undefined && this.widgetHiddenChecker?.(t.widgetUid)) {
                continue;
            }
            const order = this.registrationOrderById.get(t.id) ?? 0;
            const p = (t.priority ?? 0) * 1e6 + order; // later registered wins on tie
            if (p > bestP) {
                bestP = p;
                best = t;
            }
        }
        return best;
    }

    private getTargetById(id: string): ClickTarget | undefined {
        const idx = this.targetIndexById.get(id);
        return idx === undefined ? undefined : this.targets[idx];
    }

    private rebuildIndexes(): void {
        this.targetIndexById.clear();
        for (let i = 0; i < this.targets.length; i++) {
            this.targetIndexById.set(this.targets[i].id, i);
        }
    }
}
