/**
 * MouseCross - Animated click feedback sprite
 *
 * Matches the reference client's mouse cross rendering.
 * Shows a red cross for attacks, yellow cross for walk/interact.
 * The cross animates from large to small over 100ms.
 */
import { ClientState, MOUSE_CROSS_NONE, MOUSE_CROSS_RED, MOUSE_CROSS_YELLOW } from "./ClientState";

/**
 * Cross sprite frame data
 * In OSRS, these are loaded from sprite cache.
 * We'll use simple cross rendering here.
 */
const CROSS_SIZE_START = 24;
const CROSS_SIZE_END = 8;
const CROSS_LINE_WIDTH = 2;

/**
 * Colors for the cross types
 */
const CROSS_COLORS: Record<number, string> = {
    [MOUSE_CROSS_RED]: "#FF0000",
    [MOUSE_CROSS_YELLOW]: "#FFFF00",
};

function resolveCrossColor(color: number): string | null {
    if (Object.prototype.hasOwnProperty.call(CROSS_COLORS, color)) {
        return CROSS_COLORS[color];
    }
    return null;
}

/**
 * Calculate cross size based on animation state
 * State goes from 0 to 100, cross shrinks as state increases
 */
function getCrossSize(state: number): number {
    const progress = Math.min(state / 100, 1);
    return CROSS_SIZE_START - (CROSS_SIZE_START - CROSS_SIZE_END) * progress;
}

/**
 * Calculate cross opacity based on animation state
 * Fades out as the animation progresses
 */
function getCrossOpacity(state: number): number {
    const progress = Math.min(state / 100, 1);
    return 1 - progress * 0.5;
}

/**
 * Render the mouse cross to a 2D canvas context
 * Call this every frame in the render loop
 *
 * @param ctx The 2D canvas context to render to
 */
export function renderMouseCross(ctx: CanvasRenderingContext2D): void {
    const color = ClientState.mouseCrossColor;

    // Don't render if no cross active
    if (color === MOUSE_CROSS_NONE) {
        return;
    }

    const x = ClientState.mouseCrossX;
    const y = ClientState.mouseCrossY;
    const state = ClientState.mouseCrossState;

    // Get animation properties
    const size = getCrossSize(state);
    const opacity = getCrossOpacity(state);
    const halfSize = size / 2;

    // Get color for this cross type
    const resolvedColor = resolveCrossColor(color);
    const colorHex = resolvedColor !== null ? resolvedColor : CROSS_COLORS[MOUSE_CROSS_YELLOW];

    // Set up rendering
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.strokeStyle = colorHex;
    ctx.lineWidth = CROSS_LINE_WIDTH;
    ctx.lineCap = "round";

    // Draw the X cross
    ctx.beginPath();
    // Top-left to bottom-right
    ctx.moveTo(x - halfSize, y - halfSize);
    ctx.lineTo(x + halfSize, y + halfSize);
    // Top-right to bottom-left
    ctx.moveTo(x + halfSize, y - halfSize);
    ctx.lineTo(x - halfSize, y + halfSize);
    ctx.stroke();

    // Optional: Draw a small circle in the center
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
}

/**
 * Render mouse cross as a React/DOM element (alternative approach)
 * Returns CSS properties for positioning an absolutely-positioned element
 */
export function getMouseCrossStyle(): React.CSSProperties | null {
    const color = ClientState.mouseCrossColor;

    if (color === MOUSE_CROSS_NONE) {
        return null;
    }

    const x = ClientState.mouseCrossX;
    const y = ClientState.mouseCrossY;
    const state = ClientState.mouseCrossState;
    const size = getCrossSize(state);
    const opacity = getCrossOpacity(state);

    return {
        position: "absolute",
        left: x - size / 2,
        top: y - size / 2,
        width: size,
        height: size,
        opacity,
        pointerEvents: "none",
    };
}

/**
 * Get the current cross color as a CSS color string
 */
export function getMouseCrossColor(): string | null {
    const color = ClientState.mouseCrossColor;
    if (color === MOUSE_CROSS_NONE) {
        return null;
    }
    return resolveCrossColor(color);
}

/**
 * Check if mouse cross should be rendered
 */
export function shouldRenderMouseCross(): boolean {
    return ClientState.mouseCrossColor !== MOUSE_CROSS_NONE;
}
