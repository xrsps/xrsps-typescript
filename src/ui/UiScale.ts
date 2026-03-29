const STORAGE_KEY = "osrs.uiScale";

const MAX_SCALE = 5;

/**
 * How far the raw scale ratio must drop below the current integer scale before
 * the scale decreases. 0.7 means scale=2 holds until the raw ratio is < 1.3
 * (window < ~994px wide), preventing jarring jumps near the boundary.
 * Scale always increases freely (no upward hysteresis).
 */
const SCALE_DOWN_HYSTERESIS = 0.7;

/**
 * Visual boost factor applied when auto-scale is 1. The WebGL buffer is rendered at
 * (1/SCALE_1_BOOST) of the CSS box size; the browser's compositor stretches it back up,
 * giving a ~10% larger appearance without fractional WebGL rendering (which would
 * pixelate pixel-art content).
 *
 * Activates when cssW ≥ 842 (= 765 × 1.1) and cssH ≥ 554 (= 503 × 1.1).
 */
export const SCALE_1_BOOST = 1.1;

/**
 * Layout trim factor applied at integer scale ≥ 2. The layout divisor becomes
 * (intScale × (1/SCALE_HIGH_TRIM)), so each OSRS pixel maps to slightly fewer
 * CSS pixels — reducing UI size at scale=2+. The WebGL buffer stays full size;
 * only the layout coordinate space is adjusted.
 * At scale=2 on 1899×1437: layoutW ≈ 1117px instead of 950px, renderScaleX ≈ 1.7.
 */
export const SCALE_HIGH_TRIM = 0.90;

let manualOverride: number | null = null;
let overrideLoaded = false;
let _lastAutoScale: number = 0;

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
 * Always returns an integer (1, 2, 3…). The visual "boost" for scale=1
 * viewports is handled at the CSS level via computeDesktopCssZoom, not here,
 * so WebGL rendering always operates at an integer scale (crisp pixel art).
 *
 * Hard constraint: scale is capped so the resulting layout is never
 * smaller than 765×503 (OSRS minimum). This uses Math.floor so that
 * e.g. floor(2560/765)=3 but floor(1437/503)=2 → cap=2 at 2560×1437,
 * giving layout 1280×718 with no widget overlap.
 *
 * Stateful hysteresis prevents scale drops on small window resizes: the
 * scale only decreases when the raw ratio drops SCALE_DOWN_HYSTERESIS (0.7)
 * below the current integer scale — but never beyond what the layout cap allows.
 */
export function computeAutoScale(cssW: number, cssH: number): number {
    const OSRS_BASE_W = 765;
    const OSRS_BASE_H = 503;

    // Soft cap: allow layout to be up to CAP_TOLERANCE pixels below the OSRS minimum
    // before forcing a scale drop. This prevents a single-pixel viewport change (e.g.
    // resizing the browser DevTools panel) from flipping between scale=1 and scale=2
    // at the exact 1530px boundary. Layout at scale=2 with 1529px viewport is 764px —
    // visually identical to the 765px minimum, so the tolerance is imperceptible.
    const CAP_TOLERANCE_W = 15;
    const CAP_TOLERANCE_H = 10;
    const maxAllowed = Math.max(
        1,
        Math.min(
            Math.floor(cssW / (OSRS_BASE_W - CAP_TOLERANCE_W)),
            Math.floor(cssH / (OSRS_BASE_H - CAP_TOLERANCE_H)),
            MAX_SCALE,
        ),
    );

    const rawScale = Math.min(cssW / OSRS_BASE_W, cssH / OSRS_BASE_H);
    // Round toward preferred scale, but never exceed the layout-minimum cap.
    const natural = Math.max(1, Math.min(maxAllowed, Math.round(rawScale)));

    if (_lastAutoScale <= 0) {
        _lastAutoScale = natural;
        return natural;
    }

    if (natural < _lastAutoScale) {
        // Hysteresis: hold the previous scale as long as the layout cap still allows it
        // and rawScale hasn't dropped far enough to warrant a change.
        const held = Math.min(_lastAutoScale, maxAllowed);
        if (held > natural && rawScale >= held - SCALE_DOWN_HYSTERESIS) {
            return held;
        }
    }

    _lastAutoScale = natural;
    return natural;
}

/**
 * Compute the visual boost factor for the desktop game canvas at integer scale=1.
 * Returns SCALE_1_BOOST (1.1) when the viewport is large enough that the boosted
 * layout still meets the OSRS minimum (cssW ≥ 842, cssH ≥ 554). Returns 1 otherwise.
 *
 * The caller applies the boost by passing (1/cssZoom) as the canvas resolution scale,
 * so the WebGL buffer is rendered at the smaller pre-boost size and the browser's
 * compositor stretches it to fill the full CSS box — no CSS property mutations needed.
 */
export function computeDesktopCssZoom(cssW: number, cssH: number, intScale: number): number {
    const OSRS_BASE_W = 765;
    const OSRS_BASE_H = 503;
    if (
        intScale === 1 &&
        cssW / SCALE_1_BOOST >= OSRS_BASE_W &&
        cssH / SCALE_1_BOOST >= OSRS_BASE_H
    ) {
        return SCALE_1_BOOST; // > 1: buffer reduction path (browser upscales)
    }
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
        _lastAutoScale = 0; // Reset so auto-scale re-seeds from the current viewport.
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
