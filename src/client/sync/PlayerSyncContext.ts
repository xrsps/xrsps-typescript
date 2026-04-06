import type { PlayerTile } from "./PlayerSyncTypes";

export interface PlayerSyncState {
    index: number;
    active: boolean;
    tileX: number;
    tileY: number;
    level: number;
    running: boolean;
    orientation: number;
    rotation: number;
    hasKnownPosition: boolean;
    /**
     * Per-player traversal / movement type.
     * Movement type values: -1, 0, 1, 2 (default is 1 = walk).
     */
    movementType: number;

    /**
     * Deferred movement application when update blocks are present.
     */
    pendingMove?: {
        tileX: number;
        tileY: number;
        directions: number[];
        /** True when the movement stream encoded a 2-tile displacement. */
        movedTwoTiles: boolean;
        /** True when the movement stream encoded a teleport-style displacement (moveType=3). */
        teleported?: boolean;
        /** When teleported, whether the move should snap immediately. */
        snap?: boolean;
    };

    /**
     * Cached orientation for when player is removed from view.

     */
    cachedOrientation?: number;

    /**
     * Target index for interactions.
     */
    targetIndex?: number;

    /**
     * Packed region data: (plane << 28) | (chunkX << 14) | chunkY
     * Reference: player-movement.md (updateExternalPlayer:378-384, readPlayerUpdate:142)
     *
     * Format:
     * - Bits 0-13: chunkY (region Y / 8)
     * - Bits 14-27: chunkX (region X / 8)
     * - Bits 28-31: plane (0-3)
     */
    regionPacked?: number;
}

export class PlayerSyncContext {
    readonly maxPlayers: number;
    readonly states: PlayerSyncState[];
    /**
     * Per-index bitset used to drive the 4-pass update loop and skip-count compression.
     */
    readonly flags: Uint8Array;

    /**
     * Active and empty player index lists, rebuilt after every decode pass.
     */
    readonly playersIndices: number[] = [];
    readonly emptyIndices: number[] = [];

    // Legacy list used by older decoder sections. Kept for now to avoid touching unrelated code.
    readonly activeIndices: number[] = [];
    readonly pendingUpdateIndices: number[] = [];
    readonly pendingRemovalIndices: number[] = [];
    localIndex: number = -1;
    baseX: number = 0;
    baseY: number = 0;

    constructor(maxPlayers = 2048) {
        this.maxPlayers = maxPlayers;
        this.flags = new Uint8Array(maxPlayers);
        this.states = Array.from({ length: maxPlayers }, (_, index) => ({
            index,
            active: false,
            tileX: 0,
            tileY: 0,
            level: 0,
            running: false,
            orientation: 0,
            rotation: 0,
            hasKnownPosition: false,
            movementType: 1,
        }));
    }

    setBase(baseX: number, baseY: number): void {
        this.baseX = baseX | 0;
        this.baseY = baseY | 0;
    }

    setLocalIndex(index: number): void {
        this.localIndex = index | 0;
        this.ensureInitialIndexLists();
    }

    beginCycle(): void {
        this.pendingUpdateIndices.length = 0;
        this.pendingRemovalIndices.length = 0;
    }

    stateFor(index: number): PlayerSyncState {
        const clamped = index & (this.maxPlayers - 1);
        return this.states[clamped];
    }

    isActive(index: number): boolean {
        return this.stateFor(index).active;
    }

    activate(index: number, tile: PlayerTile, running = false): PlayerSyncState {
        const state = this.stateFor(index);
        if (!state.active) {
            state.active = true;
            this.activeIndices.push(index);
        }
        state.tileX = tile.x | 0;
        state.tileY = tile.y | 0;
        state.level = tile.level | 0;
        state.running = !!running;
        state.hasKnownPosition = true;
        return state;
    }

    deactivate(index: number): void {
        const state = this.stateFor(index);
        if (!state.active) return;
        state.active = false;
        state.running = false;
        this.pendingRemovalIndices.push(index);
    }

    /** Remove inactive entries from {@link activeIndices}. */
    compactActiveList(): void {
        let write = 0;
        for (let read = 0; read < this.activeIndices.length; read++) {
            const idx = this.activeIndices[read];
            if (idx !== undefined && this.states[idx]?.active) {
                this.activeIndices[write++] = idx;
            }
        }
        this.activeIndices.length = write;
    }

    markForUpdate(index: number): void {
        if (!this.states[index].active) return;
        if (!this.pendingUpdateIndices.includes(index)) {
            this.pendingUpdateIndices.push(index);
        }
    }

    toLocalTile(state: PlayerSyncState): PlayerTile {
        return {
            x: state.tileX,
            y: state.tileY,
            level: state.level,
        };
    }

    /**
     * Packs region data into a 30-bit integer.
     * Reference: player-movement.md (updateExternalPlayer:378-384, readPlayerUpdate:142)
     *
     * @param plane Player plane (0-3)
     * @param chunkX Region chunk X (tileX / 8)
     * @param chunkY Region chunk Y (tileY / 8)
     * @returns Packed region: (plane << 28) | (chunkX << 14) | chunkY
     */
    packRegion(plane: number, chunkX: number, chunkY: number): number {
        const p = (plane | 0) & 0x3; // 2 bits
        const cx = (chunkX | 0) & 0xff; // 8 bits
        const cy = (chunkY | 0) & 0xff; // 8 bits
        return (p << 28) | (cx << 14) | cy;
    }

    /**
     * Unpacks region data from a 30-bit integer.
     * Reference: player-movement.md (updateExternalPlayer:378-384)
     *
     * @param packed Packed region data
     * @returns Object with plane, chunkX, chunkY
     */
    unpackRegion(packed: number): { plane: number; chunkX: number; chunkY: number } {
        const plane = (packed >> 28) & 0x3;
        const chunkX = (packed >> 14) & 0xff;
        const chunkY = packed & 0xff;
        return { plane, chunkX, chunkY };
    }

    /**
     * Updates the cached orientation for a player when removed from view.

     *
     * @param index Player index
     * @param orientation Orientation to cache
     */
    cacheOrientation(index: number, orientation: number): void {
        const state = this.stateFor(index);
        state.cachedOrientation = orientation & 2047;
    }

    /**
     * Gets the cached orientation for a player, or current if no cache.

     *
     * @param index Player index
     * @returns Cached or current orientation
     */
    getCachedOrientation(index: number): number {
        const state = this.stateFor(index);
        return state.cachedOrientation !== undefined ? state.cachedOrientation : state.orientation;
    }

    ensureInitialIndexLists(): void {
        if (this.playersIndices.length > 0 || this.emptyIndices.length > 0) return;
        const local = this.localIndex | 0;
        if (local >= 0 && local < this.maxPlayers) {
            const s = this.stateFor(local);
            s.active = true;
        }
        // player indices use slots 1..2047 (slot 0 is unused).
        for (let i = 1; i < this.maxPlayers; i++) {
            if (i === local) this.playersIndices.push(i);
            else this.emptyIndices.push(i);
        }
    }

    /**
     * Shift flags and rebuild the indices lists based
     * on whether a player object exists at each slot (here: {@link PlayerSyncState.active}).
     */
    endUpdatePlayersCycle(): void {
        // slots 1..2047 are used for players; slot 0 remains unused.
        for (let i = 1; i < this.maxPlayers; i++) {
            this.flags[i] = (this.flags[i] >>> 1) & 0xff;
        }
        this.playersIndices.length = 0;
        this.emptyIndices.length = 0;
        this.activeIndices.length = 0;
        for (let i = 1; i < this.maxPlayers; i++) {
            if (this.states[i]?.active) {
                this.playersIndices.push(i);
                this.activeIndices.push(i);
            } else {
                this.emptyIndices.push(i);
            }
        }
    }
}
