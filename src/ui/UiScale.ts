const STORAGE_KEY = "osrs.uiScale";

const MAX_SCALE = 5;

let manualOverride: number | null = null;
let overrideLoaded = false;

function loadOverride(): number | null {
    if (typeof localStorage === "undefined") return null;
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw === null) return null;
        const parsed = Number(raw);
        if (!Number.isFinite(parsed) || parsed < 1 || parsed > MAX_SCALE) return null;
        return parsed;
    } catch {
        return null;
    }
}

function ensureOverrideLoaded(): void {
    if (overrideLoaded) return;
    overrideLoaded = true;
    manualOverride = loadOverride();
}

/**
 * Compute the automatic UI scale.  OSRS resizable mode does not scale widgets —
 * they stay at their native pixel sizes and the viewport grows.  Auto-scale
 * therefore defaults to 1.  Users can still override via setUiScale() for
 * accessibility.
 */
export function computeAutoScale(_cssW: number, _cssH: number): number {
    return 1;
}

/**
 * Get the effective UI scale. If the user has set a manual override it takes
 * precedence; otherwise the scale is computed automatically from the viewport.
 */
export function getUiScale(cssW?: number, cssH?: number): number {
    ensureOverrideLoaded();
    if (manualOverride !== null) return manualOverride;
    if (cssW != null && cssH != null) return computeAutoScale(cssW, cssH);
    return 1;
}

/** Set a manual UI scale override and persist it. Pass `null` to clear and revert to auto. */
export function setUiScale(scale: number | null): void {
    overrideLoaded = true;
    if (scale === null) {
        manualOverride = null;
        if (typeof localStorage !== "undefined") {
            try { localStorage.removeItem(STORAGE_KEY); } catch {}
        }
        return;
    }
    const clamped = Math.max(1, Math.min(MAX_SCALE, scale));
    manualOverride = clamped;
    if (typeof localStorage !== "undefined") {
        try { localStorage.setItem(STORAGE_KEY, String(clamped)); } catch {}
    }
}
