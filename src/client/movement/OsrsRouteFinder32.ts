export type CollisionFlagAtFn = (plane: number, tileX: number, tileY: number) => number;

/**
 * OSRS parity: 32×32 local route finder used by the legacy client for short-range
 * path reconstruction (e.g. Player.method2429 -> GraphicsObject.method2132).
 *
 */
export class OsrsRouteFinder32 {
    static readonly GRID_SIZE = 32;
    static readonly GRID_HALF = OsrsRouteFinder32.GRID_SIZE >> 1;
    static readonly MAX_ROUTE_POINTS = 50;

    // Reference masks used by class232 for size=1 routing.
    private static readonly BLOCK_WEST = 19136776;
    private static readonly BLOCK_EAST = 19136896;
    private static readonly BLOCK_SOUTH = 19136770;
    private static readonly BLOCK_NORTH = 19136800;
    private static readonly BLOCK_SOUTH_WEST = 19136782;
    private static readonly BLOCK_SOUTH_EAST = 19136899;
    private static readonly BLOCK_NORTH_WEST = 19136824;
    private static readonly BLOCK_NORTH_EAST = 19136992;
    // Additional masks used by class232 for multi-tile (size>=2) routing.
    private static readonly BLOCK_WEST_EXTRA = 19136830;
    private static readonly BLOCK_SOUTH_EXTRA = 19136911;
    private static readonly BLOCK_EAST_EXTRA = 19136995;
    private static readonly BLOCK_NORTH_EXTRA = 19137016;

    private static readonly DIST_INIT = 99999999;

    private readonly dirs = new Int32Array(
        OsrsRouteFinder32.GRID_SIZE * OsrsRouteFinder32.GRID_SIZE,
    );
    private readonly dists = new Int32Array(
        OsrsRouteFinder32.GRID_SIZE * OsrsRouteFinder32.GRID_SIZE,
    );

    // Queue length matches reference (nextPow2((32*32)/4) = 256).
    private readonly qx = new Int32Array(256);
    private readonly qy = new Int32Array(256);
    private readonly qMask = 255;

    // Scratch used for backtracking + output. Mirrors Client.field802/field803 sizing (50).
    private readonly scratchX = new Int32Array(OsrsRouteFinder32.MAX_ROUTE_POINTS);
    private readonly scratchY = new Int32Array(OsrsRouteFinder32.MAX_ROUTE_POINTS);
    readonly outX = new Int32Array(OsrsRouteFinder32.MAX_ROUTE_POINTS);
    readonly outY = new Int32Array(OsrsRouteFinder32.MAX_ROUTE_POINTS);

    private reset(): void {
        this.dirs.fill(0);
        this.dists.fill(OsrsRouteFinder32.DIST_INIT);
    }

    private idx(localX: number, localY: number): number {
        return (localX | 0) + (localY | 0) * OsrsRouteFinder32.GRID_SIZE;
    }

    /**
     * Finds a route from (startX,startY) to (destX,destY) for a mover of `size` tiles.
     *
     * Returns the number of points written into {@link outX}/{@link outY}, ordered
     * from start→dest and matching class232.method4556 output.
     */
    findRoute(
        startX: number,
        startY: number,
        destX: number,
        destY: number,
        size: number,
        plane: number,
        getCollisionFlagAt: CollisionFlagAtFn,
        allowPartial: boolean,
        destSizeX: number = 1,
        destSizeY: number = 1,
    ): number {
        startX |= 0;
        startY |= 0;
        destX |= 0;
        destY |= 0;
        size = Math.max(1, size | 0);
        plane |= 0;
        destSizeX = Math.max(1, destSizeX | 0);
        destSizeY = Math.max(1, destSizeY | 0);

        this.reset();

        const gridW = OsrsRouteFinder32.GRID_SIZE;
        const gridH = OsrsRouteFinder32.GRID_SIZE;
        const originX = (startX - OsrsRouteFinder32.GRID_HALF) | 0;
        const originY = (startY - OsrsRouteFinder32.GRID_HALF) | 0;
        const startLocalX = OsrsRouteFinder32.GRID_HALF;
        const startLocalY = OsrsRouteFinder32.GRID_HALF;
        const startIndex = this.idx(startLocalX, startLocalY);

        this.dirs[startIndex] = 99;
        this.dists[startIndex] = 0;

        let head = 0;
        let tail = 0;
        this.qx[tail] = startX;
        this.qy[tail] = startY;
        tail = (tail + 1) & this.qMask;

        let found = false;
        let foundX = startX;
        let foundY = startY;

        while (head !== tail) {
            const x = this.qx[head] | 0;
            const y = this.qy[head] | 0;
            head = (head + 1) & this.qMask;

            const localX = (x - originX) | 0;
            const localY = (y - originY) | 0;

            if (x === destX && y === destY) {
                found = true;
                foundX = x;
                foundY = y;
                break;
            }

            const baseDist = (this.dists[this.idx(localX, localY)] + 1) | 0;

            if (size === 1) {
                // class232.method4563 (size=1)
                if (
                    localX > 0 &&
                    this.dirs[this.idx(localX - 1, localY)] === 0 &&
                    (getCollisionFlagAt(plane, (x - 1) | 0, y) & OsrsRouteFinder32.BLOCK_WEST) === 0
                ) {
                    this.qx[tail] = (x - 1) | 0;
                    this.qy[tail] = y;
                    tail = (tail + 1) & this.qMask;
                    this.dirs[this.idx(localX - 1, localY)] = 2;
                    this.dists[this.idx(localX - 1, localY)] = baseDist;
                }

                if (
                    localX < gridW - 1 &&
                    this.dirs[this.idx(localX + 1, localY)] === 0 &&
                    (getCollisionFlagAt(plane, (x + 1) | 0, y) & OsrsRouteFinder32.BLOCK_EAST) === 0
                ) {
                    this.qx[tail] = (x + 1) | 0;
                    this.qy[tail] = y;
                    tail = (tail + 1) & this.qMask;
                    this.dirs[this.idx(localX + 1, localY)] = 8;
                    this.dists[this.idx(localX + 1, localY)] = baseDist;
                }

                if (
                    localY > 0 &&
                    this.dirs[this.idx(localX, localY - 1)] === 0 &&
                    (getCollisionFlagAt(plane, x, (y - 1) | 0) & OsrsRouteFinder32.BLOCK_SOUTH) ===
                        0
                ) {
                    this.qx[tail] = x;
                    this.qy[tail] = (y - 1) | 0;
                    tail = (tail + 1) & this.qMask;
                    this.dirs[this.idx(localX, localY - 1)] = 1;
                    this.dists[this.idx(localX, localY - 1)] = baseDist;
                }

                if (
                    localY < gridH - 1 &&
                    this.dirs[this.idx(localX, localY + 1)] === 0 &&
                    (getCollisionFlagAt(plane, x, (y + 1) | 0) & OsrsRouteFinder32.BLOCK_NORTH) ===
                        0
                ) {
                    this.qx[tail] = x;
                    this.qy[tail] = (y + 1) | 0;
                    tail = (tail + 1) & this.qMask;
                    this.dirs[this.idx(localX, localY + 1)] = 4;
                    this.dists[this.idx(localX, localY + 1)] = baseDist;
                }

                if (
                    localX > 0 &&
                    localY > 0 &&
                    this.dirs[this.idx(localX - 1, localY - 1)] === 0 &&
                    (getCollisionFlagAt(plane, (x - 1) | 0, (y - 1) | 0) &
                        OsrsRouteFinder32.BLOCK_SOUTH_WEST) ===
                        0 &&
                    (getCollisionFlagAt(plane, (x - 1) | 0, y) & OsrsRouteFinder32.BLOCK_WEST) ===
                        0 &&
                    (getCollisionFlagAt(plane, x, (y - 1) | 0) & OsrsRouteFinder32.BLOCK_SOUTH) ===
                        0
                ) {
                    this.qx[tail] = (x - 1) | 0;
                    this.qy[tail] = (y - 1) | 0;
                    tail = (tail + 1) & this.qMask;
                    this.dirs[this.idx(localX - 1, localY - 1)] = 3;
                    this.dists[this.idx(localX - 1, localY - 1)] = baseDist;
                }

                if (
                    localX < gridW - 1 &&
                    localY > 0 &&
                    this.dirs[this.idx(localX + 1, localY - 1)] === 0 &&
                    (getCollisionFlagAt(plane, (x + 1) | 0, (y - 1) | 0) &
                        OsrsRouteFinder32.BLOCK_SOUTH_EAST) ===
                        0 &&
                    (getCollisionFlagAt(plane, (x + 1) | 0, y) & OsrsRouteFinder32.BLOCK_EAST) ===
                        0 &&
                    (getCollisionFlagAt(plane, x, (y - 1) | 0) & OsrsRouteFinder32.BLOCK_SOUTH) ===
                        0
                ) {
                    this.qx[tail] = (x + 1) | 0;
                    this.qy[tail] = (y - 1) | 0;
                    tail = (tail + 1) & this.qMask;
                    this.dirs[this.idx(localX + 1, localY - 1)] = 9;
                    this.dists[this.idx(localX + 1, localY - 1)] = baseDist;
                }

                if (
                    localX > 0 &&
                    localY < gridH - 1 &&
                    this.dirs[this.idx(localX - 1, localY + 1)] === 0 &&
                    (getCollisionFlagAt(plane, (x - 1) | 0, (y + 1) | 0) &
                        OsrsRouteFinder32.BLOCK_NORTH_WEST) ===
                        0 &&
                    (getCollisionFlagAt(plane, (x - 1) | 0, y) & OsrsRouteFinder32.BLOCK_WEST) ===
                        0 &&
                    (getCollisionFlagAt(plane, x, (y + 1) | 0) & OsrsRouteFinder32.BLOCK_NORTH) ===
                        0
                ) {
                    this.qx[tail] = (x - 1) | 0;
                    this.qy[tail] = (y + 1) | 0;
                    tail = (tail + 1) & this.qMask;
                    this.dirs[this.idx(localX - 1, localY + 1)] = 6;
                    this.dists[this.idx(localX - 1, localY + 1)] = baseDist;
                }

                if (
                    localX < gridW - 1 &&
                    localY < gridH - 1 &&
                    this.dirs[this.idx(localX + 1, localY + 1)] === 0 &&
                    (getCollisionFlagAt(plane, (x + 1) | 0, (y + 1) | 0) &
                        OsrsRouteFinder32.BLOCK_NORTH_EAST) ===
                        0 &&
                    (getCollisionFlagAt(plane, (x + 1) | 0, y) & OsrsRouteFinder32.BLOCK_EAST) ===
                        0 &&
                    (getCollisionFlagAt(plane, x, (y + 1) | 0) & OsrsRouteFinder32.BLOCK_NORTH) ===
                        0
                ) {
                    this.qx[tail] = (x + 1) | 0;
                    this.qy[tail] = (y + 1) | 0;
                    tail = (tail + 1) & this.qMask;
                    this.dirs[this.idx(localX + 1, localY + 1)] = 12;
                    this.dists[this.idx(localX + 1, localY + 1)] = baseDist;
                }
            } else if (size === 2) {
                // class232.method4559 (size=2)
                if (
                    localX > 0 &&
                    this.dirs[this.idx(localX - 1, localY)] === 0 &&
                    (getCollisionFlagAt(plane, (x - 1) | 0, y) &
                        OsrsRouteFinder32.BLOCK_SOUTH_WEST) ===
                        0 &&
                    (getCollisionFlagAt(plane, (x - 1) | 0, (y + 1) | 0) &
                        OsrsRouteFinder32.BLOCK_NORTH_WEST) ===
                        0
                ) {
                    this.qx[tail] = (x - 1) | 0;
                    this.qy[tail] = y;
                    tail = (tail + 1) & this.qMask;
                    this.dirs[this.idx(localX - 1, localY)] = 2;
                    this.dists[this.idx(localX - 1, localY)] = baseDist;
                }

                if (
                    localX < gridW - 2 &&
                    this.dirs[this.idx(localX + 1, localY)] === 0 &&
                    (getCollisionFlagAt(plane, (x + 2) | 0, y) &
                        OsrsRouteFinder32.BLOCK_SOUTH_EAST) ===
                        0 &&
                    (getCollisionFlagAt(plane, (x + 2) | 0, (y + 1) | 0) &
                        OsrsRouteFinder32.BLOCK_NORTH_EAST) ===
                        0
                ) {
                    this.qx[tail] = (x + 1) | 0;
                    this.qy[tail] = y;
                    tail = (tail + 1) & this.qMask;
                    this.dirs[this.idx(localX + 1, localY)] = 8;
                    this.dists[this.idx(localX + 1, localY)] = baseDist;
                }

                if (
                    localY > 0 &&
                    this.dirs[this.idx(localX, localY - 1)] === 0 &&
                    (getCollisionFlagAt(plane, x, (y - 1) | 0) &
                        OsrsRouteFinder32.BLOCK_SOUTH_WEST) ===
                        0 &&
                    (getCollisionFlagAt(plane, (x + 1) | 0, (y - 1) | 0) &
                        OsrsRouteFinder32.BLOCK_SOUTH_EAST) ===
                        0
                ) {
                    this.qx[tail] = x;
                    this.qy[tail] = (y - 1) | 0;
                    tail = (tail + 1) & this.qMask;
                    this.dirs[this.idx(localX, localY - 1)] = 1;
                    this.dists[this.idx(localX, localY - 1)] = baseDist;
                }

                if (
                    localY < gridH - 2 &&
                    this.dirs[this.idx(localX, localY + 1)] === 0 &&
                    (getCollisionFlagAt(plane, x, (y + 2) | 0) &
                        OsrsRouteFinder32.BLOCK_NORTH_WEST) ===
                        0 &&
                    (getCollisionFlagAt(plane, (x + 1) | 0, (y + 2) | 0) &
                        OsrsRouteFinder32.BLOCK_NORTH_EAST) ===
                        0
                ) {
                    this.qx[tail] = x;
                    this.qy[tail] = (y + 1) | 0;
                    tail = (tail + 1) & this.qMask;
                    this.dirs[this.idx(localX, localY + 1)] = 4;
                    this.dists[this.idx(localX, localY + 1)] = baseDist;
                }

                if (
                    localX > 0 &&
                    localY > 0 &&
                    this.dirs[this.idx(localX - 1, localY - 1)] === 0 &&
                    (getCollisionFlagAt(plane, (x - 1) | 0, y) &
                        OsrsRouteFinder32.BLOCK_WEST_EXTRA) ===
                        0 &&
                    (getCollisionFlagAt(plane, (x - 1) | 0, (y - 1) | 0) &
                        OsrsRouteFinder32.BLOCK_SOUTH_WEST) ===
                        0 &&
                    (getCollisionFlagAt(plane, x, (y - 1) | 0) &
                        OsrsRouteFinder32.BLOCK_SOUTH_EXTRA) ===
                        0
                ) {
                    this.qx[tail] = (x - 1) | 0;
                    this.qy[tail] = (y - 1) | 0;
                    tail = (tail + 1) & this.qMask;
                    this.dirs[this.idx(localX - 1, localY - 1)] = 3;
                    this.dists[this.idx(localX - 1, localY - 1)] = baseDist;
                }

                if (
                    localX < gridW - 2 &&
                    localY > 0 &&
                    this.dirs[this.idx(localX + 1, localY - 1)] === 0 &&
                    (getCollisionFlagAt(plane, (x + 1) | 0, (y - 1) | 0) &
                        OsrsRouteFinder32.BLOCK_SOUTH_EXTRA) ===
                        0 &&
                    (getCollisionFlagAt(plane, (x + 2) | 0, (y - 1) | 0) &
                        OsrsRouteFinder32.BLOCK_SOUTH_EAST) ===
                        0 &&
                    (getCollisionFlagAt(plane, (x + 2) | 0, y) &
                        OsrsRouteFinder32.BLOCK_EAST_EXTRA) ===
                        0
                ) {
                    this.qx[tail] = (x + 1) | 0;
                    this.qy[tail] = (y - 1) | 0;
                    tail = (tail + 1) & this.qMask;
                    this.dirs[this.idx(localX + 1, localY - 1)] = 9;
                    this.dists[this.idx(localX + 1, localY - 1)] = baseDist;
                }

                if (
                    localX > 0 &&
                    localY < gridH - 2 &&
                    this.dirs[this.idx(localX - 1, localY + 1)] === 0 &&
                    (getCollisionFlagAt(plane, (x - 1) | 0, (y + 1) | 0) &
                        OsrsRouteFinder32.BLOCK_WEST_EXTRA) ===
                        0 &&
                    (getCollisionFlagAt(plane, (x - 1) | 0, (y + 2) | 0) &
                        OsrsRouteFinder32.BLOCK_NORTH_WEST) ===
                        0 &&
                    (getCollisionFlagAt(plane, x, (y + 2) | 0) &
                        OsrsRouteFinder32.BLOCK_NORTH_EXTRA) ===
                        0
                ) {
                    this.qx[tail] = (x - 1) | 0;
                    this.qy[tail] = (y + 1) | 0;
                    tail = (tail + 1) & this.qMask;
                    this.dirs[this.idx(localX - 1, localY + 1)] = 6;
                    this.dists[this.idx(localX - 1, localY + 1)] = baseDist;
                }

                if (
                    localX < gridW - 2 &&
                    localY < gridH - 2 &&
                    this.dirs[this.idx(localX + 1, localY + 1)] === 0 &&
                    (getCollisionFlagAt(plane, (x + 1) | 0, (y + 2) | 0) &
                        OsrsRouteFinder32.BLOCK_NORTH_EXTRA) ===
                        0 &&
                    (getCollisionFlagAt(plane, (x + 2) | 0, (y + 2) | 0) &
                        OsrsRouteFinder32.BLOCK_NORTH_EAST) ===
                        0 &&
                    (getCollisionFlagAt(plane, (x + 2) | 0, (y + 1) | 0) &
                        OsrsRouteFinder32.BLOCK_EAST_EXTRA) ===
                        0
                ) {
                    this.qx[tail] = (x + 1) | 0;
                    this.qy[tail] = (y + 1) | 0;
                    tail = (tail + 1) & this.qMask;
                    this.dirs[this.idx(localX + 1, localY + 1)] = 12;
                    this.dists[this.idx(localX + 1, localY + 1)] = baseDist;
                }
            } else {
                // class232.method4560 (size>=3)
                if (
                    localX > 0 &&
                    this.dirs[this.idx(localX - 1, localY)] === 0 &&
                    (getCollisionFlagAt(plane, (x - 1) | 0, y) &
                        OsrsRouteFinder32.BLOCK_SOUTH_WEST) ===
                        0 &&
                    (getCollisionFlagAt(plane, (x - 1) | 0, (y + size - 1) | 0) &
                        OsrsRouteFinder32.BLOCK_NORTH_WEST) ===
                        0
                ) {
                    let clear = true;
                    for (let k = 1; k < size - 1; k++) {
                        if (
                            (getCollisionFlagAt(plane, (x - 1) | 0, (y + k) | 0) &
                                OsrsRouteFinder32.BLOCK_WEST_EXTRA) !==
                            0
                        ) {
                            clear = false;
                            break;
                        }
                    }
                    if (clear) {
                        this.qx[tail] = (x - 1) | 0;
                        this.qy[tail] = y;
                        tail = (tail + 1) & this.qMask;
                        this.dirs[this.idx(localX - 1, localY)] = 2;
                        this.dists[this.idx(localX - 1, localY)] = baseDist;
                    }
                }

                if (
                    localX < gridW - size &&
                    this.dirs[this.idx(localX + 1, localY)] === 0 &&
                    (getCollisionFlagAt(plane, (x + size) | 0, y) &
                        OsrsRouteFinder32.BLOCK_SOUTH_EAST) ===
                        0 &&
                    (getCollisionFlagAt(plane, (x + size) | 0, (y + size - 1) | 0) &
                        OsrsRouteFinder32.BLOCK_NORTH_EAST) ===
                        0
                ) {
                    let clear = true;
                    for (let k = 1; k < size - 1; k++) {
                        if (
                            (getCollisionFlagAt(plane, (x + size) | 0, (y + k) | 0) &
                                OsrsRouteFinder32.BLOCK_EAST_EXTRA) !==
                            0
                        ) {
                            clear = false;
                            break;
                        }
                    }
                    if (clear) {
                        this.qx[tail] = (x + 1) | 0;
                        this.qy[tail] = y;
                        tail = (tail + 1) & this.qMask;
                        this.dirs[this.idx(localX + 1, localY)] = 8;
                        this.dists[this.idx(localX + 1, localY)] = baseDist;
                    }
                }

                if (
                    localY > 0 &&
                    this.dirs[this.idx(localX, localY - 1)] === 0 &&
                    (getCollisionFlagAt(plane, x, (y - 1) | 0) &
                        OsrsRouteFinder32.BLOCK_SOUTH_WEST) ===
                        0 &&
                    (getCollisionFlagAt(plane, (x + size - 1) | 0, (y - 1) | 0) &
                        OsrsRouteFinder32.BLOCK_SOUTH_EAST) ===
                        0
                ) {
                    let clear = true;
                    for (let k = 1; k < size - 1; k++) {
                        if (
                            (getCollisionFlagAt(plane, (x + k) | 0, (y - 1) | 0) &
                                OsrsRouteFinder32.BLOCK_SOUTH_EXTRA) !==
                            0
                        ) {
                            clear = false;
                            break;
                        }
                    }
                    if (clear) {
                        this.qx[tail] = x;
                        this.qy[tail] = (y - 1) | 0;
                        tail = (tail + 1) & this.qMask;
                        this.dirs[this.idx(localX, localY - 1)] = 1;
                        this.dists[this.idx(localX, localY - 1)] = baseDist;
                    }
                }

                if (
                    localY < gridH - size &&
                    this.dirs[this.idx(localX, localY + 1)] === 0 &&
                    (getCollisionFlagAt(plane, x, (y + size) | 0) &
                        OsrsRouteFinder32.BLOCK_NORTH_WEST) ===
                        0 &&
                    (getCollisionFlagAt(plane, (x + size - 1) | 0, (y + size) | 0) &
                        OsrsRouteFinder32.BLOCK_NORTH_EAST) ===
                        0
                ) {
                    let clear = true;
                    for (let k = 1; k < size - 1; k++) {
                        if (
                            (getCollisionFlagAt(plane, (x + k) | 0, (y + size) | 0) &
                                OsrsRouteFinder32.BLOCK_NORTH_EXTRA) !==
                            0
                        ) {
                            clear = false;
                            break;
                        }
                    }
                    if (clear) {
                        this.qx[tail] = x;
                        this.qy[tail] = (y + 1) | 0;
                        tail = (tail + 1) & this.qMask;
                        this.dirs[this.idx(localX, localY + 1)] = 4;
                        this.dists[this.idx(localX, localY + 1)] = baseDist;
                    }
                }

                if (
                    localX > 0 &&
                    localY > 0 &&
                    this.dirs[this.idx(localX - 1, localY - 1)] === 0 &&
                    (getCollisionFlagAt(plane, (x - 1) | 0, (y - 1) | 0) &
                        OsrsRouteFinder32.BLOCK_SOUTH_WEST) ===
                        0
                ) {
                    let clear = true;
                    for (let k = 1; k < size; k++) {
                        if (
                            (getCollisionFlagAt(plane, (x - 1) | 0, (y - 1 + k) | 0) &
                                OsrsRouteFinder32.BLOCK_WEST_EXTRA) !==
                                0 ||
                            (getCollisionFlagAt(plane, (x - 1 + k) | 0, (y - 1) | 0) &
                                OsrsRouteFinder32.BLOCK_SOUTH_EXTRA) !==
                                0
                        ) {
                            clear = false;
                            break;
                        }
                    }
                    if (clear) {
                        this.qx[tail] = (x - 1) | 0;
                        this.qy[tail] = (y - 1) | 0;
                        tail = (tail + 1) & this.qMask;
                        this.dirs[this.idx(localX - 1, localY - 1)] = 3;
                        this.dists[this.idx(localX - 1, localY - 1)] = baseDist;
                    }
                }

                if (
                    localX < gridW - size &&
                    localY > 0 &&
                    this.dirs[this.idx(localX + 1, localY - 1)] === 0 &&
                    (getCollisionFlagAt(plane, (x + size) | 0, (y - 1) | 0) &
                        OsrsRouteFinder32.BLOCK_SOUTH_EAST) ===
                        0
                ) {
                    let clear = true;
                    for (let k = 1; k < size; k++) {
                        if (
                            (getCollisionFlagAt(plane, (x + size) | 0, (y - 1 + k) | 0) &
                                OsrsRouteFinder32.BLOCK_EAST_EXTRA) !==
                                0 ||
                            (getCollisionFlagAt(plane, (x + k) | 0, (y - 1) | 0) &
                                OsrsRouteFinder32.BLOCK_SOUTH_EXTRA) !==
                                0
                        ) {
                            clear = false;
                            break;
                        }
                    }
                    if (clear) {
                        this.qx[tail] = (x + 1) | 0;
                        this.qy[tail] = (y - 1) | 0;
                        tail = (tail + 1) & this.qMask;
                        this.dirs[this.idx(localX + 1, localY - 1)] = 9;
                        this.dists[this.idx(localX + 1, localY - 1)] = baseDist;
                    }
                }

                if (
                    localX > 0 &&
                    localY < gridH - size &&
                    this.dirs[this.idx(localX - 1, localY + 1)] === 0 &&
                    (getCollisionFlagAt(plane, (x - 1) | 0, (y + size) | 0) &
                        OsrsRouteFinder32.BLOCK_NORTH_WEST) ===
                        0
                ) {
                    let clear = true;
                    for (let k = 1; k < size; k++) {
                        if (
                            (getCollisionFlagAt(plane, (x - 1) | 0, (y + k) | 0) &
                                OsrsRouteFinder32.BLOCK_WEST_EXTRA) !==
                                0 ||
                            (getCollisionFlagAt(plane, (x - 1 + k) | 0, (y + size) | 0) &
                                OsrsRouteFinder32.BLOCK_NORTH_EXTRA) !==
                                0
                        ) {
                            clear = false;
                            break;
                        }
                    }
                    if (clear) {
                        this.qx[tail] = (x - 1) | 0;
                        this.qy[tail] = (y + 1) | 0;
                        tail = (tail + 1) & this.qMask;
                        this.dirs[this.idx(localX - 1, localY + 1)] = 6;
                        this.dists[this.idx(localX - 1, localY + 1)] = baseDist;
                    }
                }

                if (
                    localX < gridW - size &&
                    localY < gridH - size &&
                    this.dirs[this.idx(localX + 1, localY + 1)] === 0 &&
                    (getCollisionFlagAt(plane, (x + size) | 0, (y + size) | 0) &
                        OsrsRouteFinder32.BLOCK_NORTH_EAST) ===
                        0
                ) {
                    let clear = true;
                    for (let k = 1; k < size; k++) {
                        if (
                            (getCollisionFlagAt(plane, (x + k) | 0, (y + size) | 0) &
                                OsrsRouteFinder32.BLOCK_NORTH_EXTRA) !==
                                0 ||
                            (getCollisionFlagAt(plane, (x + size) | 0, (y + k) | 0) &
                                OsrsRouteFinder32.BLOCK_EAST_EXTRA) !==
                                0
                        ) {
                            clear = false;
                            break;
                        }
                    }
                    if (clear) {
                        this.qx[tail] = (x + 1) | 0;
                        this.qy[tail] = (y + 1) | 0;
                        tail = (tail + 1) & this.qMask;
                        this.dirs[this.idx(localX + 1, localY + 1)] = 12;
                        this.dists[this.idx(localX + 1, localY + 1)] = baseDist;
                    }
                }
            }

            foundX = x;
            foundY = y;
        }

        if (!found) {
            if (!allowPartial) return -1;
            let bestDist2 = 0x7fffffff;
            let bestRouteDist = 0x7fffffff;
            const search = 10;
            const approxX = destX;
            const approxY = destY;
            const approxSizeX = destSizeX;
            const approxSizeY = destSizeY;

            for (let xx = (approxX - search) | 0; xx <= ((approxX + search) | 0); xx++) {
                for (let yy = (approxY - search) | 0; yy <= ((approxY + search) | 0); yy++) {
                    const lx = (xx - originX) | 0;
                    const ly = (yy - originY) | 0;
                    if (lx < 0 || ly < 0 || lx >= gridW || ly >= gridH) continue;
                    const dist = this.dists[this.idx(lx, ly)] | 0;
                    if (dist >= 100) continue;

                    let dx = 0;
                    if (xx < approxX) dx = (approxX - xx) | 0;
                    else if (xx > ((approxX + approxSizeX - 1) | 0))
                        dx = (xx - (approxX + approxSizeX - 1)) | 0;

                    let dy = 0;
                    if (yy < approxY) dy = (approxY - yy) | 0;
                    else if (yy > ((approxY + approxSizeY - 1) | 0))
                        dy = (yy - (approxY + approxSizeY - 1)) | 0;

                    const dist2 = (dx * dx + dy * dy) | 0;
                    if (dist2 < bestDist2 || (dist2 === bestDist2 && dist < bestRouteDist)) {
                        bestDist2 = dist2;
                        bestRouteDist = dist;
                        foundX = xx;
                        foundY = yy;
                    }
                }
            }

            if (bestDist2 === 0x7fffffff) return -1;
        }

        // Reconstruct path in the same compressed format as class232.method4566.
        if (foundX === startX && foundY === startY) {
            this.outX[0] = foundX;
            this.outY[0] = foundY;
            return 0;
        }

        let count = 0;
        this.scratchX[count] = foundX;
        this.scratchY[count] = foundY;
        count++;

        let currX = foundX;
        let currY = foundY;
        let prevDir = this.dirs[this.idx((currX - originX) | 0, (currY - originY) | 0)] | 0;

        while (currX !== startX || currY !== startY) {
            const dir = this.dirs[this.idx((currX - originX) | 0, (currY - originY) | 0)] | 0;
            if (dir !== prevDir) {
                prevDir = dir;
                if (count < OsrsRouteFinder32.MAX_ROUTE_POINTS) {
                    this.scratchX[count] = currX;
                    this.scratchY[count] = currY;
                    count++;
                }
            }

            if ((dir & 2) !== 0) currX = (currX + 1) | 0;
            else if ((dir & 8) !== 0) currX = (currX - 1) | 0;

            if ((dir & 1) !== 0) currY = (currY + 1) | 0;
            else if ((dir & 4) !== 0) currY = (currY - 1) | 0;
        }

        let outCount = 0;
        while (count-- > 0 && outCount < OsrsRouteFinder32.MAX_ROUTE_POINTS) {
            this.outX[outCount] = this.scratchX[count] | 0;
            this.outY[outCount] = this.scratchY[count] | 0;
            outCount++;
        }
        return outCount;
    }

    findRouteSize1(
        startX: number,
        startY: number,
        destX: number,
        destY: number,
        plane: number,
        getCollisionFlagAt: CollisionFlagAtFn,
        allowPartial: boolean,
    ): number {
        return this.findRoute(
            startX,
            startY,
            destX,
            destY,
            1,
            plane,
            getCollisionFlagAt,
            allowPartial,
            1,
            1,
        );
    }
}
