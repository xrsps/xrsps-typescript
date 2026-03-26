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
 * Compute the automatic UI scale from CSS viewport dimensions.
 * Scales up when the viewport is large enough that widgets would be physically
 * tiny (common on high-res displays at low OS scaling).  Each scale level
 * ensures the resulting layout stays at or above a minimum comfortable size.
 */
export function computeAutoScale(cssW: number, cssH: number): number {
    const MIN_LAYOUT_W = 1024;
    const MIN_LAYOUT_H = 576;

    let scale = 1;
    while (
        cssW / (scale + 1) >= MIN_LAYOUT_W &&
        cssH / (scale + 1) >= MIN_LAYOUT_H
    ) {
        scale++;
    }
    return Math.min(scale, MAX_SCALE);
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
