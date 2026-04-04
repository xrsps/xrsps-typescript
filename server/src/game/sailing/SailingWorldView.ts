import type { CollisionMap } from "../../../../src/rs/scene/CollisionMap";

/**
 * Server-side WorldView collision container.
 * Holds collision maps built from template chunks for per-WorldView pathfinding.
 */
export class SailingWorldView {
    readonly id: number;
    readonly baseX: number;
    readonly baseY: number;
    readonly sizeX: number;
    readonly sizeY: number;
    readonly collisionMaps: CollisionMap[];
    /** The source plane that holds the deck collision (e.g., 1 for boat deck). */
    readonly basePlane: number;

    constructor(
        id: number,
        baseX: number,
        baseY: number,
        sizeX: number,
        sizeY: number,
        collisionMaps: CollisionMap[],
        basePlane: number = 0,
    ) {
        this.id = id;
        this.baseX = baseX;
        this.baseY = baseY;
        this.sizeX = sizeX;
        this.sizeY = sizeY;
        this.collisionMaps = collisionMaps;
        this.basePlane = basePlane;
    }

    containsWorldTile(wx: number, wy: number): boolean {
        const lx = wx - this.baseX;
        const ly = wy - this.baseY;
        return lx >= 0 && lx < this.sizeX && ly >= 0 && ly < this.sizeY;
    }

    getCollisionFlag(plane: number, worldX: number, worldY: number): number {
        // Remap query plane to the source plane that holds the deck collision.
        // The player is at overworld plane 0 but the boat deck is at source basePlane (1).
        const p = Math.max(0, Math.min(3, plane + this.basePlane));
        const lx = worldX - this.baseX;
        const ly = worldY - this.baseY;
        if (lx < 0 || lx >= this.sizeX || ly < 0 || ly >= this.sizeY) {
            return 0xffffff;
        }
        const cm = this.collisionMaps[p];
        if (!cm || !cm.isWithinBounds(lx, ly)) return 0xffffff;
        return cm.getFlag(lx, ly);
    }
}
