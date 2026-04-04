/**
 * DestinationMarker - Tile destination flag
 *
 * Shows a yellow/red flag on the tile the player is walking to.
 * The flag has a small pulsing animation.
 */
import { ClientState } from "./ClientState";

/**
 * Flag sprite dimensions
 * In OSRS, this is loaded from sprite cache (sprite 508/509)
 */
const FLAG_WIDTH = 12;
const FLAG_HEIGHT = 16;
const FLAG_POLE_WIDTH = 2;

/**
 * Flag colors
 */
const FLAG_COLOR = "#FFFF00"; // Yellow flag
const FLAG_POLE_COLOR = "#8B4513"; // Brown pole

/**
 * Check if we should render the destination marker
 * Marker is shown when destinationX or destinationY are non-zero
 */
export function shouldRenderDestinationMarker(): boolean {
    return ClientState.destinationX !== 0 || ClientState.destinationY !== 0;
}

/**
 * Get the destination tile in local coordinates
 */
export function getDestinationLocal(): { x: number; y: number } {
    return {
        x: ClientState.destinationX,
        y: ClientState.destinationY,
    };
}

/**
 * Get the destination tile in world coordinates
 */
export function getDestinationWorld(): { x: number; y: number } {
    return {
        x: ClientState.localToWorldX(ClientState.destinationX),
        y: ClientState.localToWorldY(ClientState.destinationY),
    };
}

/**
 * Convert tile coordinates to screen position
 * This is a simplified version - actual calculation depends on camera
 *
 * @param tileX Local tile X coordinate
 * @param tileY Local tile Y coordinate
 * @param cameraInfo Optional camera/viewport info for proper projection
 */
export function tileToScreen(
    tileX: number,
    tileY: number,
    viewport?: { centerX: number; centerY: number; zoom: number },
): { x: number; y: number } | null {
    // This would need proper 3D projection in the actual client
    // For now, return a placeholder that integrates with existing renderer
    if (!viewport) {
        return null;
    }

    // Each tile is 128 units in OSRS
    const TILE_SIZE = 128;

    // Simple orthographic projection (real client uses perspective)
    const screenX = viewport.centerX + (tileX * TILE_SIZE - viewport.centerX) * viewport.zoom;
    const screenY = viewport.centerY + (tileY * TILE_SIZE - viewport.centerY) * viewport.zoom;

    return { x: screenX, y: screenY };
}

/**
 * Render the destination flag to a 2D canvas context
 *
 * @param ctx The 2D canvas context
 * @param screenX Screen X position (bottom center of flag)
 * @param screenY Screen Y position (bottom center of flag)
 * @param pulsePhase Animation phase (0-1) for pulsing effect
 */
export function renderDestinationFlag(
    ctx: CanvasRenderingContext2D,
    screenX: number,
    screenY: number,
    pulsePhase: number = 0,
): void {
    // Calculate pulse effect (subtle scaling)
    const pulseScale = 1 + Math.sin(pulsePhase * Math.PI * 2) * 0.1;

    const poleHeight = FLAG_HEIGHT * pulseScale;
    const flagWidth = FLAG_WIDTH * pulseScale;
    const flagHeight = FLAG_HEIGHT * 0.6 * pulseScale;

    ctx.save();

    // Draw pole (vertical line from bottom)
    ctx.fillStyle = FLAG_POLE_COLOR;
    ctx.fillRect(screenX - FLAG_POLE_WIDTH / 2, screenY - poleHeight, FLAG_POLE_WIDTH, poleHeight);

    // Draw flag (triangular pennant)
    ctx.fillStyle = FLAG_COLOR;
    ctx.beginPath();
    ctx.moveTo(screenX, screenY - poleHeight); // Top of pole
    ctx.lineTo(screenX + flagWidth, screenY - poleHeight + flagHeight / 2); // Right point
    ctx.lineTo(screenX, screenY - poleHeight + flagHeight); // Back to pole
    ctx.closePath();
    ctx.fill();

    // Add a slight border to the flag
    ctx.strokeStyle = "#DAA520"; // Darker yellow
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.restore();
}

/**
 * Clear the destination marker
 * Called when the player reaches the destination or clicks elsewhere
 */
export function clearDestinationMarker(): void {
    ClientState.destinationX = 0;
    ClientState.destinationY = 0;
    ClientState.destinationWorldX = 0;
    ClientState.destinationWorldY = 0;
}

/**
 * Set the destination marker to a new position
 *
 * @param localX Local tile X coordinate
 * @param localY Local tile Y coordinate
 */
export function setDestinationMarker(localX: number, localY: number): void {
    ClientState.setDestination(localX, localY);
}

/**
 * Get CSS properties for a DOM-based destination marker
 * Alternative to canvas rendering for React integration
 */
export function getDestinationMarkerStyle(screenX: number, screenY: number): React.CSSProperties {
    return {
        position: "absolute",
        left: screenX - FLAG_WIDTH / 2,
        top: screenY - FLAG_HEIGHT,
        width: FLAG_WIDTH,
        height: FLAG_HEIGHT,
        pointerEvents: "none",
    };
}

/**
 * DestinationMarkerState for React component usage
 */
export interface DestinationMarkerState {
    visible: boolean;
    localX: number;
    localY: number;
    worldX: number;
    worldY: number;
}

/**
 * Get current destination marker state
 */
export function getDestinationMarkerState(): DestinationMarkerState {
    const visible = shouldRenderDestinationMarker();
    const local = getDestinationLocal();
    const world = getDestinationWorld();

    return {
        visible,
        localX: local.x,
        localY: local.y,
        worldX: world.x,
        worldY: world.y,
    };
}
