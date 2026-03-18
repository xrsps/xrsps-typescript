import { clamp } from "../../util/MathUtil";

export const MOBILE_ADAPTIVE_RENDER_DISTANCE_BUSY = 10;
export const MOBILE_ADAPTIVE_RENDER_DISTANCE_HEAVY = 8;

type EffectiveRenderDistanceOptions = {
    baseRenderDistance: number;
    currentEffectiveRenderDistance: number;
    isTouchDevice: boolean;
    mobilePressure: number;
    triangles: number;
    batches: number;
};

type FogRangeOptions = {
    renderDistance: number;
    autoFogDepth: boolean;
    autoFogDepthFactor: number;
    manualFogDepth: number;
};

export function resolveNextEffectiveRenderDistanceTiles(
    options: EffectiveRenderDistanceOptions,
): number {
    const base = clamp(options.baseRenderDistance | 0, 25, 90);
    if (!options.isTouchDevice) {
        return base;
    }

    let target = base;

    if (options.mobilePressure >= 1 || options.triangles >= 1_000_000 || options.batches >= 900) {
        target = Math.min(target, MOBILE_ADAPTIVE_RENDER_DISTANCE_BUSY);
    }
    if (options.mobilePressure >= 2 || options.triangles >= 1_350_000 || options.batches >= 1200) {
        target = Math.min(target, MOBILE_ADAPTIVE_RENDER_DISTANCE_HEAVY);
    }

    const floor = Math.max(4, Math.min(8, base));
    target = Math.max(floor, Math.min(base, target));

    const seededCurrent =
        (options.currentEffectiveRenderDistance | 0) > 0
            ? options.currentEffectiveRenderDistance | 0
            : base;
    const current = Math.max(floor, Math.min(base, seededCurrent));
    if (target < current) {
        return Math.max(target, current - 1);
    }
    if (target > current) {
        return Math.min(target, current + 1);
    }
    return current;
}

export function resolveFogRange(options: FogRangeOptions): { fogEnd: number; fogDepth: number } {
    const fogEnd = options.renderDistance;
    const fogDepth = options.autoFogDepth
        ? Math.max(0, fogEnd * options.autoFogDepthFactor)
        : options.manualFogDepth;
    return { fogEnd, fogDepth };
}
