export abstract class RouteStrategy {
    // Used by A* Heuristic to determine "Distance Remaining"
    approxDestX: number = 0;
    approxDestY: number = 0;

    // Dimensions of the target area (usually for rendering or debug)
    destSizeX: number = 1;
    destSizeY: number = 1;

    abstract hasArrived(tileX: number, tileY: number, level: number): boolean;
}

export class ExactRouteStrategy extends RouteStrategy {
    hasArrived(tileX: number, tileY: number, level: number): boolean {
        return tileX === this.approxDestX && tileY === this.approxDestY;
    }
}

// Client parity: ApproximateRouteStrategy is the default "walk to tile" strategy and only
// checks for exact tile arrival.
export class ApproximateRouteStrategy extends RouteStrategy {
    constructor(destX: number, destY: number) {
        super();
        this.approxDestX = destX;
        this.approxDestY = destY;
        this.destSizeX = 1;
        this.destSizeY = 1;
    }

    hasArrived(tileX: number, tileY: number, _level: number): boolean {
        return tileX === this.approxDestX && tileY === this.approxDestY;
    }
}

// Simple rectangle containment (used for "stand on" interactions like floor decorations).
export class RectRouteStrategy extends RouteStrategy {
    private readonly minX: number;
    private readonly minY: number;
    private readonly maxX: number;
    private readonly maxY: number;

    constructor(rectX: number, rectY: number, sizeX: number, sizeY: number) {
        super();
        this.minX = rectX;
        this.minY = rectY;
        this.destSizeX = Math.max(1, sizeX);
        this.destSizeY = Math.max(1, sizeY);
        this.maxX = this.minX + this.destSizeX - 1;
        this.maxY = this.minY + this.destSizeY - 1;

        // Client parity: approxDestX/Y represent the SOUTH-WEST corner (used for alternative route search).
        this.approxDestX = this.minX;
        this.approxDestY = this.minY;
    }

    hasArrived(tileX: number, tileY: number, _level: number): boolean {
        return tileX >= this.minX && tileX <= this.maxX && tileY >= this.minY && tileY <= this.maxY;
    }
}

/** Type for collision flag getter function used by wall-aware route strategies. */
export type CollisionFlagGetter = (x: number, y: number, plane: number) => number | undefined;
export type ProjectileRaycastGetter = (
    from: { x: number; y: number; plane: number },
    to: { x: number; y: number },
) => { clear: boolean; tiles: number };

export type CardinalBlockedSides = {
    north?: boolean;
    east?: boolean;
    south?: boolean;
    west?: boolean;
};

// Collision flags needed for wall checks (duplicated here to avoid circular imports)
const WALL_NORTH = 0x2;
const WALL_SOUTH = 0x20;
const WALL_EAST = 0x8;
const WALL_WEST = 0x80;

// Matches OSRS Interaction logic.
// OSRS does NOT allow diagonal interactions with objects.
// You must be cardinally adjacent (N/S/E/W) to interact.
// OSRS parity: Also checks that no wall blocks the interaction edge.
export class RectAdjacentRouteStrategy extends RouteStrategy {
    private collisionGetter?: CollisionFlagGetter;
    private plane: number = 0;

    constructor(
        private rectX: number,
        private rectY: number,
        private sizeX: number,
        private sizeY: number,
        private allowOverlap: boolean = false,
        private allowLargeDiagonal: boolean = false,
    ) {
        super();
        // Client parity: approxDestX/Y represent the SOUTH-WEST corner.
        this.approxDestX = rectX;
        this.approxDestY = rectY;
        this.destSizeX = Math.max(1, sizeX);
        this.destSizeY = Math.max(1, sizeY);
    }

    /**
     * OSRS parity: Set a collision flag getter to enable wall checking.
     * When set, hasArrived() will also verify no wall blocks the interaction edge.
     */
    setCollisionGetter(getter: CollisionFlagGetter, plane: number): void {
        this.collisionGetter = getter;
        this.plane = plane;
    }

    hasArrived(tileX: number, tileY: number, _level: number): boolean {
        const minX = this.rectX;
        const minY = this.rectY;
        const maxX = minX + this.destSizeX - 1;
        const maxY = minY + this.destSizeY - 1;

        // OSRS: You cannot interact with an object if you are standing inside it
        if (tileX >= minX && tileX <= maxX && tileY >= minY && tileY <= maxY) {
            return this.allowOverlap;
        }

        const clampedX = Math.max(minX, Math.min(tileX, maxX));
        const clampedY = Math.max(minY, Math.min(tileY, maxY));

        const dx = Math.abs(tileX - clampedX);
        const dy = Math.abs(tileY - clampedY);

        // Must be exactly 1 tile away (Chebyshev)
        if (Math.max(dx, dy) !== 1) return false;

        // OSRS: You cannot interact with ANY object from a diagonal position.
        // Must be cardinally adjacent (N/S/E/W), not diagonally adjacent.
        // A diagonal is present if both dx and dy are > 0.
        const isDiagonal = dx > 0 && dy > 0;
        if (isDiagonal && !this.allowLargeDiagonal) return false;

        // OSRS parity: Check that no wall blocks the interaction edge
        if (this.collisionGetter) {
            if (this.isWallBlocked(tileX, tileY, minX, minY, maxX, maxY)) {
                return false;
            }
        }

        return true;
    }

    /**
     * Check if a wall blocks the edge between the player tile and the target rectangle.
     */
    private isWallBlocked(
        tileX: number,
        tileY: number,
        minX: number,
        minY: number,
        maxX: number,
        maxY: number,
    ): boolean {
        if (!this.collisionGetter) return false;

        const plane = this.plane;
        const playerFlag = this.collisionGetter(tileX, tileY, plane) ?? 0;

        // Player is west of target
        if (tileX === minX - 1 && tileY >= minY && tileY <= maxY) {
            const targetFlag = this.collisionGetter(minX, tileY, plane) ?? 0;
            return (playerFlag & WALL_EAST) !== 0 || (targetFlag & WALL_WEST) !== 0;
        }

        // Player is east of target
        if (tileX === maxX + 1 && tileY >= minY && tileY <= maxY) {
            const targetFlag = this.collisionGetter(maxX, tileY, plane) ?? 0;
            return (playerFlag & WALL_WEST) !== 0 || (targetFlag & WALL_EAST) !== 0;
        }

        // Player is south of target
        if (tileY === minY - 1 && tileX >= minX && tileX <= maxX) {
            const targetFlag = this.collisionGetter(tileX, minY, plane) ?? 0;
            return (playerFlag & WALL_NORTH) !== 0 || (targetFlag & WALL_SOUTH) !== 0;
        }

        // Player is north of target
        if (tileY === maxY + 1 && tileX >= minX && tileX <= maxX) {
            const targetFlag = this.collisionGetter(tileX, maxY, plane) ?? 0;
            return (playerFlag & WALL_SOUTH) !== 0 || (targetFlag & WALL_NORTH) !== 0;
        }

        return false;
    }
}

// For walls, doors, or specific directional interactions.
// OSRS parity: Also checks that no wall blocks the interaction edge.
export class CardinalAdjacentRouteStrategy extends RouteStrategy {
    private readonly rectX: number;
    private readonly rectY: number;
    private readonly sizeX: number;
    private readonly sizeY: number;
    private readonly allowOverlap: boolean;
    private readonly blockNorth: boolean;
    private readonly blockEast: boolean;
    private readonly blockSouth: boolean;
    private readonly blockWest: boolean;
    private collisionGetter?: CollisionFlagGetter;
    private plane: number = 0;

    constructor(
        rectX: number,
        rectY: number,
        sizeX: number,
        sizeY: number,
        allowOverlap: boolean = false,
        blockedSides?: CardinalBlockedSides,
    ) {
        super();
        this.rectX = rectX;
        this.rectY = rectY;
        this.sizeX = Math.max(1, sizeX);
        this.sizeY = Math.max(1, sizeY);
        this.allowOverlap = !!allowOverlap;
        this.blockNorth = !!blockedSides?.north;
        this.blockEast = !!blockedSides?.east;
        this.blockSouth = !!blockedSides?.south;
        this.blockWest = !!blockedSides?.west;

        // Client parity: SOUTH-WEST corner for alternative route search.
        this.approxDestX = this.rectX;
        this.approxDestY = this.rectY;
        this.destSizeX = this.sizeX;
        this.destSizeY = this.sizeY;
    }

    /**
     * OSRS parity: Set a collision flag getter to enable wall checking.
     */
    setCollisionGetter(getter: CollisionFlagGetter, plane: number): void {
        this.collisionGetter = getter;
        this.plane = plane;
    }

    hasArrived(tileX: number, tileY: number, _level: number): boolean {
        const minX = this.rectX;
        const minY = this.rectY;
        const maxX = this.rectX + this.sizeX - 1;
        const maxY = this.rectY + this.sizeY - 1;

        if (tileX >= minX && tileX <= maxX && tileY >= minY && tileY <= maxY) {
            return this.allowOverlap;
        }

        const onNorth = tileY === maxY + 1 && tileX >= minX && tileX <= maxX;
        const onSouth = tileY === minY - 1 && tileX >= minX && tileX <= maxX;
        const onWest = tileX === minX - 1 && tileY >= minY && tileY <= maxY;
        const onEast = tileX === maxX + 1 && tileY >= minY && tileY <= maxY;

        if (!(onNorth || onSouth || onWest || onEast)) {
            return false;
        }
        if ((onNorth && this.blockNorth) || (onEast && this.blockEast)) {
            return false;
        }
        if ((onSouth && this.blockSouth) || (onWest && this.blockWest)) {
            return false;
        }

        // OSRS parity: Check that no wall blocks the interaction edge
        if (this.collisionGetter) {
            if (this.isWallBlocked(tileX, tileY, minX, minY, maxX, maxY)) {
                return false;
            }
        }

        return true;
    }

    /**
     * Check if a wall blocks the edge between the player tile and the target rectangle.
     */
    private isWallBlocked(
        tileX: number,
        tileY: number,
        minX: number,
        minY: number,
        maxX: number,
        maxY: number,
    ): boolean {
        if (!this.collisionGetter) return false;

        const plane = this.plane;
        const playerFlag = this.collisionGetter(tileX, tileY, plane) ?? 0;

        // Player is west of target
        if (tileX === minX - 1 && tileY >= minY && tileY <= maxY) {
            const targetFlag = this.collisionGetter(minX, tileY, plane) ?? 0;
            return (playerFlag & WALL_EAST) !== 0 || (targetFlag & WALL_WEST) !== 0;
        }

        // Player is east of target
        if (tileX === maxX + 1 && tileY >= minY && tileY <= maxY) {
            const targetFlag = this.collisionGetter(maxX, tileY, plane) ?? 0;
            return (playerFlag & WALL_WEST) !== 0 || (targetFlag & WALL_EAST) !== 0;
        }

        // Player is south of target
        if (tileY === minY - 1 && tileX >= minX && tileX <= maxX) {
            const targetFlag = this.collisionGetter(tileX, minY, plane) ?? 0;
            return (playerFlag & WALL_NORTH) !== 0 || (targetFlag & WALL_SOUTH) !== 0;
        }

        // Player is north of target
        if (tileY === maxY + 1 && tileX >= minX && tileX <= maxX) {
            const targetFlag = this.collisionGetter(tileX, maxY, plane) ?? 0;
            return (playerFlag & WALL_SOUTH) !== 0 || (targetFlag & WALL_NORTH) !== 0;
        }

        return false;
    }
}

// Range checks (Mage/Range/Halberds).
export class RectWithinRangeRouteStrategy extends RouteStrategy {
    private readonly range: number;
    private readonly rectX: number;
    private readonly rectY: number;
    private readonly sizeX: number;
    private readonly sizeY: number;

    constructor(rectX: number, rectY: number, sizeX: number, sizeY: number, range: number) {
        super();
        this.rectX = rectX;
        this.rectY = rectY;
        this.sizeX = Math.max(1, sizeX);
        this.sizeY = Math.max(1, sizeY);
        this.range = Math.max(1, range);

        // Client parity: SOUTH-WEST corner and original target size (used for alternative route search).
        this.approxDestX = this.rectX;
        this.approxDestY = this.rectY;
        this.destSizeX = this.sizeX;
        this.destSizeY = this.sizeY;
    }

    hasArrived(tileX: number, tileY: number, _level: number): boolean {
        const minX = this.rectX;
        const minY = this.rectY;
        const maxX = this.rectX + this.sizeX - 1;
        const maxY = this.rectY + this.sizeY - 1;

        // OSRS logic: Usually you cannot attack if you are standing underneath the NPC.
        // You must move at least 1 tile out.
        if (tileX >= minX && tileX <= maxX && tileY >= minY && tileY <= maxY) {
            return false;
        }

        const clampedX = Math.max(minX, Math.min(tileX, maxX));
        const clampedY = Math.max(minY, Math.min(tileY, maxY));

        const dx = Math.abs(tileX - clampedX);
        const dy = Math.abs(tileY - clampedY);

        // OSRS pathfinding uses Chebyshev for range checks (square radius)
        return Math.max(dx, dy) <= this.range;
    }
}

export class RectWithinRangeLineOfSightRouteStrategy extends RouteStrategy {
    private readonly range: number;
    private readonly rectX: number;
    private readonly rectY: number;
    private readonly sizeX: number;
    private readonly sizeY: number;
    private projectileRaycast?: ProjectileRaycastGetter;

    constructor(rectX: number, rectY: number, sizeX: number, sizeY: number, range: number) {
        super();
        this.rectX = rectX;
        this.rectY = rectY;
        this.sizeX = Math.max(1, sizeX);
        this.sizeY = Math.max(1, sizeY);
        this.range = Math.max(1, range);

        this.approxDestX = this.rectX;
        this.approxDestY = this.rectY;
        this.destSizeX = this.sizeX;
        this.destSizeY = this.sizeY;
    }

    setProjectileRaycast(getter: ProjectileRaycastGetter): void {
        this.projectileRaycast = getter;
    }

    hasArrived(tileX: number, tileY: number, level: number): boolean {
        const minX = this.rectX;
        const minY = this.rectY;
        const maxX = this.rectX + this.sizeX - 1;
        const maxY = this.rectY + this.sizeY - 1;

        if (tileX >= minX && tileX <= maxX && tileY >= minY && tileY <= maxY) {
            return false;
        }

        const clampedX = Math.max(minX, Math.min(tileX, maxX));
        const clampedY = Math.max(minY, Math.min(tileY, maxY));
        const dx = Math.abs(tileX - clampedX);
        const dy = Math.abs(tileY - clampedY);
        if (Math.max(dx, dy) > this.range) {
            return false;
        }

        if (!this.projectileRaycast) {
            return false;
        }

        const from = { x: tileX, y: tileY, plane: level };
        for (let x = minX; x <= maxX; x++) {
            for (let y = minY; y <= maxY; y++) {
                if (this.projectileRaycast(from, { x, y }).clear) {
                    return true;
                }
            }
        }

        return false;
    }
}
