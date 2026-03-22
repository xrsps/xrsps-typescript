const STORAGE_KEY = "osrs.uiScale";

/**
 * OSRS fixed-mode base resolution. Used as the reference for auto-scaling:
 * the UI scales up by integer multiples so that widgets appear proportionally
 * the same size as they would at 765×503.
 */
const BASE_W = 765;
const BASE_H = 503;

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
 * Compute the automatic UI scale from the CSS viewport dimensions.
 * Uses integer floor so that sprites and bitmap fonts stay pixel-perfect.
 */
export function computeAutoScale(cssW: number, cssH: number): number {
    if (cssW <= 0 || cssH <= 0) return 1;
    return Math.max(1, Math.min(MAX_SCALE, Math.floor(Math.min(cssW / BASE_W, cssH / BASE_H))));
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
