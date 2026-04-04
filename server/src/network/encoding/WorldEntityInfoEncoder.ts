import { encodeMessage } from "../messages";

/**
 * Per-tick world entity lifecycle encoder.
 *
 * Matches OSRS WorldEntityUpdateParser — the server tracks which world
 * entities each player can see.  Each tick, a compact packet is sent:
 *
 *   byte   oldCount       — how many previous-tick entities get an update byte
 *   for each 0..oldCount-1:
 *     byte  updateType    — 0=despawn, 1=no change, 2=queuePosition, 3=setPosition
 *     if updateType 2 or 3:
 *       position delta (typed-value encoded)
 *     mask update byte (bit 0 = animation, bit 1 = action mask)
 *   while bytes remain:
 *     new entity spawn descriptors (with initial position + mask)
 */

export interface WorldEntitySpawnInfo {
    entityIndex: number;
    sizeX: number;
    sizeZ: number;
    configId: number;
    drawMode: number;
    position?: WorldEntityPosition;
}

export interface WorldEntityPosition {
    x: number;
    y: number;
    z: number;
    orientation: number;
}

export interface WorldEntityMaskUpdate {
    animationId?: number;
    sequenceFrame?: number;
    actionMask?: number;
}

/** Pending per-entity update for the current tick. */
interface EntityTickUpdate {
    /** 2 = queuePosition (smooth), 3 = setPosition (teleport). */
    type: 2 | 3;
    position: WorldEntityPosition;
}

/** Serialised update for a single old entity sent to the binary encoder. */
export interface OldEntityUpdate {
    updateType: number;
    positionDelta?: WorldEntityPosition;
    mask?: WorldEntityMaskUpdate;
}

/** Serialised new spawn with resolved position and optional mask. */
export interface NewEntitySpawn extends WorldEntitySpawnInfo {
    position: WorldEntityPosition;
    mask?: WorldEntityMaskUpdate;
}

interface PlayerEntityState {
    /** Entity IDs the client had after last WORLDENTITY_INFO was sent. */
    previousIds: number[];
    /** Entity spawn info keyed by entityIndex for new spawn encoding. */
    spawnInfo: Map<number, WorldEntitySpawnInfo>;
    /** Entity IDs that should be active NOW. */
    currentIds: Set<number>;
    /** Pending position updates for entities this tick. */
    pendingUpdates: Map<number, EntityTickUpdate>;
    /** Pending mask updates for entities this tick. */
    pendingMasks: Map<number, WorldEntityMaskUpdate>;
    /** Last-known position per entity (for delta encoding). */
    lastPositions: Map<number, WorldEntityPosition>;
    /** Whether anything changed since last encode (avoids sending no-op packets). */
    dirty: boolean;
}

export class WorldEntityInfoEncoder {
    private readonly states = new Map<number, PlayerEntityState>();

    private getOrCreate(playerId: number): PlayerEntityState {
        let s = this.states.get(playerId);
        if (!s) {
            s = {
                previousIds: [],
                spawnInfo: new Map(),
                currentIds: new Set(),
                pendingUpdates: new Map(),
                pendingMasks: new Map(),
                lastPositions: new Map(),
                dirty: false,
            };
            this.states.set(playerId, s);
        }
        return s;
    }

    /** Register a world entity as active for a player. */
    addEntity(playerId: number, info: WorldEntitySpawnInfo): void {
        const s = this.getOrCreate(playerId);
        s.currentIds.add(info.entityIndex);
        s.spawnInfo.set(info.entityIndex, info);
        if (info.position) {
            s.lastPositions.set(info.entityIndex, { ...info.position });
        }
        s.dirty = true;
    }

    /** Queue a smooth position update (updateType 2) for an entity. */
    queuePosition(playerId: number, entityIndex: number, position: WorldEntityPosition): void {
        const s = this.getOrCreate(playerId);
        if (!s.currentIds.has(entityIndex)) return;
        s.pendingUpdates.set(entityIndex, { type: 2, position: { ...position } });
        s.dirty = true;
    }

    /** Set position instantly (updateType 3) for an entity. */
    setPosition(playerId: number, entityIndex: number, position: WorldEntityPosition): void {
        const s = this.getOrCreate(playerId);
        if (!s.currentIds.has(entityIndex)) return;
        s.pendingUpdates.set(entityIndex, { type: 3, position: { ...position } });
        s.dirty = true;
    }

    /** Queue a mask update (animation and/or action mask) for an entity. */
    queueMaskUpdate(playerId: number, entityIndex: number, mask: WorldEntityMaskUpdate): void {
        const s = this.getOrCreate(playerId);
        if (!s.currentIds.has(entityIndex)) return;
        const existing = s.pendingMasks.get(entityIndex);
        if (existing) {
            if (mask.animationId !== undefined) existing.animationId = mask.animationId;
            if (mask.sequenceFrame !== undefined) existing.sequenceFrame = mask.sequenceFrame;
            if (mask.actionMask !== undefined) existing.actionMask = mask.actionMask;
        } else {
            s.pendingMasks.set(entityIndex, { ...mask });
        }
        s.dirty = true;
    }

    /** Mark a world entity for removal. */
    removeEntity(playerId: number, entityIndex: number): void {
        const s = this.getOrCreate(playerId);
        if (s.currentIds.delete(entityIndex)) {
            s.dirty = true;
        }
        s.spawnInfo.delete(entityIndex);
        s.pendingUpdates.delete(entityIndex);
        s.pendingMasks.delete(entityIndex);
        s.lastPositions.delete(entityIndex);
    }

    /** Clean up all state for a disconnected player. */
    removePlayer(playerId: number): void {
        this.states.delete(playerId);
    }

    /** Whether a world entity is currently tracked as active for this player. */
    isEntityActive(playerId: number, entityIndex: number): boolean {
        const s = this.states.get(playerId);
        return s?.currentIds.has(entityIndex) === true;
    }

    /** Whether this player needs a WORLDENTITY_INFO packet this tick. */
    needsUpdate(playerId: number): boolean {
        const s = this.states.get(playerId);
        return s?.dirty === true;
    }

    /**
     * Encode the WORLDENTITY_INFO packet for this player.
     * Returns the encoded binary packet, or null if nothing changed.
     */
    encode(playerId: number): Uint8Array | null {
        const s = this.states.get(playerId);
        if (!s || !s.dirty) return null;

        const prev = s.previousIds;
        const current = s.currentIds;

        // Phase 1: Determine how many old entities survive (truncation from end)
        let oldCount = prev.length;
        while (oldCount > 0 && !current.has(prev[oldCount - 1])) {
            oldCount--;
        }

        // Phase 2: Build update entries for surviving old entities
        const oldUpdates: OldEntityUpdate[] = [];
        const survivingIds: number[] = [];
        for (let i = 0; i < oldCount; i++) {
            const entityId = prev[i];
            if (!current.has(entityId)) {
                oldUpdates.push({ updateType: 0 });
                continue;
            }

            survivingIds.push(entityId);

            const pending = s.pendingUpdates.get(entityId);
            const pendingMask = s.pendingMasks.get(entityId);

            if (pending) {
                const lastPos = s.lastPositions.get(entityId);
                const dx = pending.position.x - (lastPos?.x ?? 0);
                const dy = pending.position.y - (lastPos?.y ?? 0);
                const dz = pending.position.z - (lastPos?.z ?? 0);
                const dOrientation = pending.position.orientation - (lastPos?.orientation ?? 0);
                oldUpdates.push({
                    updateType: pending.type,
                    positionDelta: { x: dx, y: dy, z: dz, orientation: dOrientation },
                    mask: pendingMask,
                });
                s.lastPositions.set(entityId, { ...pending.position });
            } else if (pendingMask) {
                oldUpdates.push({ updateType: 1, mask: pendingMask });
            } else {
                oldUpdates.push({ updateType: 1 });
            }
        }

        // Phase 3: Find new spawns (in current but not in prev)
        const prevSet = new Set(prev);
        const newSpawns: NewEntitySpawn[] = [];
        for (const id of current) {
            if (!prevSet.has(id)) {
                const info = s.spawnInfo.get(id);
                if (info) {
                    const pos = info.position ?? { x: 0, y: 0, z: 0, orientation: 0 };
                    const mask = s.pendingMasks.get(id);
                    newSpawns.push({ ...info, position: pos, mask });
                    s.lastPositions.set(id, { ...pos });
                }
            }
        }

        // Phase 4: Encode
        const packet = encodeMessage({
            type: "worldentity_info",
            payload: { oldCount, oldUpdates, newSpawns },
        } as any);

        // Phase 5: Update previous list = surviving + new
        s.previousIds = [...survivingIds, ...newSpawns.map((sp) => sp.entityIndex)];
        s.pendingUpdates.clear();
        s.pendingMasks.clear();
        s.dirty = false;

        return packet;
    }
}
