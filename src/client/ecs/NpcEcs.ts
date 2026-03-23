// Minimal specialized ECS for NPCs using a dense id space and typed arrays.
// Focused on providing fast, GC-light storage for per-frame render data.
import type { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import { NO_INTERACTION, decodeInteractionIndex } from "../../rs/interaction/InteractionIndex";
import { getMapSquareId } from "../../rs/map/MapFileIndex";

type NumericTypedArray =
    | Int8Array
    | Uint8Array
    | Uint8ClampedArray
    | Int16Array
    | Uint16Array
    | Int32Array
    | Uint32Array
    | Float32Array
    | Float64Array;

type NumericTypedArrayCtor<T extends NumericTypedArray> = {
    new (len: number): T;
};

// Internal capacity growth helper
function grow<T extends NumericTypedArray>(arr: T, newCapacity: number): T {
    const ctor = arr.constructor as NumericTypedArrayCtor<T>;
    const grown = new ctor(newCapacity);
    grown.set(arr, 0);
    return grown;
}

export class NpcEcs {
    private capacity: number;
    private freeList: number[] = [];
    private nextId: number = 1; // 0 = invalid
    private seqTypeLoader?: SeqTypeLoader;

    // Presence
    private active: Uint8Array;

    // Spatial/render
    private x: Int16Array; // sub-tile (0..8191)
    private y: Int16Array; // sub-tile (0..8191)
    private level: Uint8Array; // 0..3
    private rotation: Uint16Array; // 0..2047
    private npcTypeId: Int32Array; // interact id/type key
    private size: Uint8Array; // 1..N
    private clipped: Uint8Array; // 1 when npcType.isClipped
    private mapId: Uint16Array; // getMapSquareId(mapX,mapY)
    private serverId: Int32Array;
    private hasServerState: Uint8Array;
    private serverSubX: Int32Array;
    private serverSubY: Int32Array;
    private serverTileX: Int16Array;
    private serverTileY: Int16Array;
    private serverPlane: Uint8Array;
    private interactionIndex: Int32Array; // -1 when none

    // Animation state (per-frame)
    private frameIndex: Uint16Array; // action sequence frame
    private seqId: Int32Array; // current action/sequence override (-1 = none)
    private seqTicksLeft: Int16Array; // frames remaining for current seq (client ticks)
    private seqTicksTotal: Int16Array; // total frames when armed (for reset/logging)
    private seqDelay: Uint8Array; // Actor.sequenceDelay
    private seqPathLength: Uint8Array; // Actor.sequencePathLength snapshot
    private useWalkAnim: Uint8Array; // 0=idle, 1=walk
    private movementFrameIndex: Uint16Array;
    private movementSeqId: Int32Array;
    private movementAnimTick: Uint16Array;
    private movementLoopCount: Uint16Array;
    // Client-side interpolation targets and timing
    private targetX: Int16Array;
    private targetY: Int16Array;
    private targetRot: Uint16Array; // desired orientation (0..2047)
    private baseSpeed: Uint8Array; // sub-tile units per client tick
    private animTick: Uint16Array; // accumulator for frame stepping
    private loopCount: Uint16Array; // loop counter for current animation (OSRS field1196/field1220)
    private stepQueueX: Int16Array;
    private stepQueueY: Int16Array;
    private stepQueueSpeed: Uint8Array;
    private stepQueueHead: Uint8Array;
    private stepQueueTail: Uint8Array;
    private stepQueueLen: Uint8Array;
    private stepActive: Uint8Array;
    private currentStepSpeed: Uint8Array;
    private currentStepRot: Uint16Array; // 0xffff = unset
    private movementDelayCounter: Uint8Array; // Actor.dq-style movement hold counter

    // Color override (damage/poison/freeze tints) — mirrors Actor.colorOverride in OSRS
    private colorOverrideHue!: Uint8Array; // Override hue (0-127, -1 encoded as 127 = no override)
    private colorOverrideSat!: Uint8Array; // Override saturation (0-127)
    private colorOverrideLum!: Uint8Array; // Override luminance (0-127)
    private colorOverrideAmount!: Uint8Array; // Override amount (0-255, 0=none, 255=full)
    private colorOverrideStartCycle!: Uint16Array; // Start cycle
    private colorOverrideEndCycle!: Uint16Array; // End cycle

    // Spawn/meta
    private spawnTileX: Uint8Array; // 0..63
    private spawnTileY: Uint8Array; // 0..63
    private rotSpeed: Uint16Array; // degrees per step in RS units (0..2047 per full circle)
    // Occupancy (committed tile)
    private occTileX: Uint8Array; // 0..63
    private occTileY: Uint8Array; // 0..63
    private occPlane: Uint8Array; // 0..3

    // OSRS parity: actor path buffers are length 10 with pathLength capped to 9.
    static readonly MAX_SERVER_PATH = 10;
    static readonly MAX_PENDING_PATH = 9;
    private serverPathX: Int8Array; // packed as [id*MAX + i]
    private serverPathY: Int8Array;
    private serverPathLen: Uint8Array;

    // Fast query by map id
    private perMap: Map<number, number[]> = new Map();
    private serverIdLookup: Map<number, number> = new Map();

    constructor(
        initialCapacity: number = 1024,
        private readonly onServerUnmapped?: (serverId: number) => void,
    ) {
        this.capacity = initialCapacity | 0;
        this.active = new Uint8Array(this.capacity);
        this.x = new Int16Array(this.capacity);
        this.y = new Int16Array(this.capacity);
        this.level = new Uint8Array(this.capacity);
        this.rotation = new Uint16Array(this.capacity);
        this.npcTypeId = new Int32Array(this.capacity);
        this.size = new Uint8Array(this.capacity);
        this.clipped = new Uint8Array(this.capacity);
        this.mapId = new Uint16Array(this.capacity);
        this.serverId = new Int32Array(this.capacity);
        this.hasServerState = new Uint8Array(this.capacity);
        this.serverSubX = new Int32Array(this.capacity);
        this.serverSubY = new Int32Array(this.capacity);
        this.serverTileX = new Int16Array(this.capacity);
        this.serverTileY = new Int16Array(this.capacity);
        this.serverPlane = new Uint8Array(this.capacity);
        this.interactionIndex = new Int32Array(this.capacity);
        this.interactionIndex.fill(NO_INTERACTION);
        this.frameIndex = new Uint16Array(this.capacity);
        this.seqId = new Int32Array(this.capacity);
        this.seqTicksLeft = new Int16Array(this.capacity);
        this.seqTicksTotal = new Int16Array(this.capacity);
        this.seqDelay = new Uint8Array(this.capacity);
        this.seqPathLength = new Uint8Array(this.capacity);
        this.useWalkAnim = new Uint8Array(this.capacity);
        this.movementFrameIndex = new Uint16Array(this.capacity);
        this.movementSeqId = new Int32Array(this.capacity);
        this.movementSeqId.fill(-1);
        this.movementAnimTick = new Uint16Array(this.capacity);
        this.movementLoopCount = new Uint16Array(this.capacity);
        this.spawnTileX = new Uint8Array(this.capacity);
        this.spawnTileY = new Uint8Array(this.capacity);
        this.rotSpeed = new Uint16Array(this.capacity);
        this.serverPathX = new Int8Array(this.capacity * NpcEcs.MAX_SERVER_PATH);
        this.serverPathY = new Int8Array(this.capacity * NpcEcs.MAX_SERVER_PATH);
        this.serverPathLen = new Uint8Array(this.capacity);
        this.occTileX = new Uint8Array(this.capacity);
        this.occTileY = new Uint8Array(this.capacity);
        this.occPlane = new Uint8Array(this.capacity);
        this.targetX = new Int16Array(this.capacity);
        this.targetY = new Int16Array(this.capacity);
        this.targetRot = new Uint16Array(this.capacity);
        this.baseSpeed = new Uint8Array(this.capacity);
        this.animTick = new Uint16Array(this.capacity);
        this.loopCount = new Uint16Array(this.capacity);
        this.stepQueueX = new Int16Array(this.capacity * NpcEcs.MAX_SERVER_PATH);
        this.stepQueueY = new Int16Array(this.capacity * NpcEcs.MAX_SERVER_PATH);
        this.stepQueueSpeed = new Uint8Array(this.capacity * NpcEcs.MAX_SERVER_PATH);
        this.stepQueueHead = new Uint8Array(this.capacity);
        this.stepQueueTail = new Uint8Array(this.capacity);
        this.stepQueueLen = new Uint8Array(this.capacity);
        this.stepActive = new Uint8Array(this.capacity);
        this.currentStepSpeed = new Uint8Array(this.capacity);
        this.currentStepRot = new Uint16Array(this.capacity);
        this.currentStepRot.fill(0xffff);
        this.movementDelayCounter = new Uint8Array(this.capacity);
        this.colorOverrideHue = new Uint8Array(this.capacity);
        this.colorOverrideSat = new Uint8Array(this.capacity);
        this.colorOverrideLum = new Uint8Array(this.capacity);
        this.colorOverrideAmount = new Uint8Array(this.capacity);
        this.colorOverrideStartCycle = new Uint16Array(this.capacity);
        this.colorOverrideEndCycle = new Uint16Array(this.capacity);
    }

    private ensureCapacity(id: number): void {
        if (id < this.capacity) return;
        let newCap = this.capacity;
        while (newCap <= id) newCap = Math.max(newCap * 2, 16);
        this.active = grow(this.active, newCap);
        this.x = grow(this.x, newCap);
        this.y = grow(this.y, newCap);
        this.level = grow(this.level, newCap);
        this.rotation = grow(this.rotation, newCap);
        this.npcTypeId = grow(this.npcTypeId, newCap);
        this.size = grow(this.size, newCap);
        this.clipped = grow(this.clipped, newCap);
        this.mapId = grow(this.mapId, newCap);
        this.serverId = grow(this.serverId, newCap);
        this.hasServerState = grow(this.hasServerState, newCap);
        this.serverSubX = grow(this.serverSubX, newCap);
        this.serverSubY = grow(this.serverSubY, newCap);
        this.serverTileX = grow(this.serverTileX, newCap);
        this.serverTileY = grow(this.serverTileY, newCap);
        this.serverPlane = grow(this.serverPlane, newCap);
        const newInteractionIndex = grow(this.interactionIndex, newCap);
        newInteractionIndex.fill(NO_INTERACTION, this.capacity, newCap);
        this.interactionIndex = newInteractionIndex;
        this.frameIndex = grow(this.frameIndex, newCap);
        this.seqId = grow(this.seqId, newCap);
        this.seqTicksLeft = grow(this.seqTicksLeft, newCap);
        this.seqTicksTotal = grow(this.seqTicksTotal, newCap);
        this.seqDelay = grow(this.seqDelay, newCap);
        this.seqPathLength = grow(this.seqPathLength, newCap);
        this.useWalkAnim = grow(this.useWalkAnim, newCap);
        this.movementFrameIndex = grow(this.movementFrameIndex, newCap);
        const newMovementSeqId = grow(this.movementSeqId, newCap);
        newMovementSeqId.fill(-1, this.capacity, newCap);
        this.movementSeqId = newMovementSeqId;
        this.movementAnimTick = grow(this.movementAnimTick, newCap);
        this.movementLoopCount = grow(this.movementLoopCount, newCap);
        this.spawnTileX = grow(this.spawnTileX, newCap);
        this.spawnTileY = grow(this.spawnTileY, newCap);
        this.rotSpeed = grow(this.rotSpeed, newCap);
        // grow server path buffers (manual copy into new large arrays)
        const newPathX = new Int8Array(newCap * NpcEcs.MAX_SERVER_PATH);
        const newPathY = new Int8Array(newCap * NpcEcs.MAX_SERVER_PATH);
        for (let i = 0; i < this.capacity; i++) {
            const srcOff = i * NpcEcs.MAX_SERVER_PATH;
            const dstOff = i * NpcEcs.MAX_SERVER_PATH;
            newPathX.set(
                this.serverPathX.subarray(srcOff, srcOff + NpcEcs.MAX_SERVER_PATH),
                dstOff,
            );
            newPathY.set(
                this.serverPathY.subarray(srcOff, srcOff + NpcEcs.MAX_SERVER_PATH),
                dstOff,
            );
        }
        this.serverPathX = newPathX;
        this.serverPathY = newPathY;
        this.serverPathLen = grow(this.serverPathLen, newCap);
        this.targetX = grow(this.targetX, newCap);
        this.targetY = grow(this.targetY, newCap);
        this.targetRot = grow(this.targetRot, newCap);
        this.baseSpeed = grow(this.baseSpeed, newCap);
        this.animTick = grow(this.animTick, newCap);
        this.loopCount = grow(this.loopCount, newCap);
        const newStepQueueX = new Int16Array(newCap * NpcEcs.MAX_SERVER_PATH);
        const newStepQueueY = new Int16Array(newCap * NpcEcs.MAX_SERVER_PATH);
        const newStepQueueSpeed = new Uint8Array(newCap * NpcEcs.MAX_SERVER_PATH);
        for (let i = 0; i < this.capacity; i++) {
            const srcOff = i * NpcEcs.MAX_SERVER_PATH;
            const dstOff = i * NpcEcs.MAX_SERVER_PATH;
            newStepQueueX.set(
                this.stepQueueX.subarray(srcOff, srcOff + NpcEcs.MAX_SERVER_PATH),
                dstOff,
            );
            newStepQueueY.set(
                this.stepQueueY.subarray(srcOff, srcOff + NpcEcs.MAX_SERVER_PATH),
                dstOff,
            );
            newStepQueueSpeed.set(
                this.stepQueueSpeed.subarray(srcOff, srcOff + NpcEcs.MAX_SERVER_PATH),
                dstOff,
            );
        }
        this.stepQueueX = newStepQueueX;
        this.stepQueueY = newStepQueueY;
        this.stepQueueSpeed = newStepQueueSpeed;
        this.stepQueueHead = grow(this.stepQueueHead, newCap);
        this.stepQueueTail = grow(this.stepQueueTail, newCap);
        this.stepQueueLen = grow(this.stepQueueLen, newCap);
        this.stepActive = grow(this.stepActive, newCap);
        this.currentStepSpeed = grow(this.currentStepSpeed, newCap);
        const newStepRot = grow(this.currentStepRot, newCap);
        newStepRot.fill(0xffff, this.capacity, newCap);
        this.currentStepRot = newStepRot;
        this.movementDelayCounter = grow(this.movementDelayCounter, newCap);
        this.colorOverrideHue = grow(this.colorOverrideHue, newCap);
        this.colorOverrideSat = grow(this.colorOverrideSat, newCap);
        this.colorOverrideLum = grow(this.colorOverrideLum, newCap);
        this.colorOverrideAmount = grow(this.colorOverrideAmount, newCap);
        this.colorOverrideStartCycle = grow(this.colorOverrideStartCycle, newCap);
        this.colorOverrideEndCycle = grow(this.colorOverrideEndCycle, newCap);
        this.occTileX = grow(this.occTileX, newCap);
        this.occTileY = grow(this.occTileY, newCap);
        this.occPlane = grow(this.occPlane, newCap);
        this.capacity = newCap;
    }

    private allocId(): number {
        const id = this.freeList.length > 0 ? (this.freeList.pop() as number) : this.nextId++;
        this.ensureCapacity(id);
        return id;
    }

    createNpc(
        mapX: number,
        mapY: number,
        npcTypeId: number,
        size: number,
        x: number,
        y: number,
        level: number,
        rotation: number,
        spawnTileX: number,
        spawnTileY: number,
        rotationSpeed?: number,
        isClipped?: boolean,
    ): number {
        const id = this.allocId();
        const mid = getMapSquareId(mapX, mapY);
        this.active[id] = 1;
        this.mapId[id] = mid;
        this.npcTypeId[id] = npcTypeId | 0;
        this.size[id] = size | 0;
        this.x[id] = x | 0;
        this.y[id] = y | 0;
        this.level[id] = level | 0;
        this.rotation[id] = rotation | 0;
        this.spawnTileX[id] = (spawnTileX | 0) & 63;
        this.spawnTileY[id] = (spawnTileY | 0) & 63;
        this.rotSpeed[id] = ((typeof rotationSpeed === "number" ? rotationSpeed : 64) | 0) & 0xffff;
        this.clipped[id] = isClipped === false ? 0 : 1;
        this.serverId[id] = 0;
        this.hasServerState[id] = 0;
        this.interactionIndex[id] = NO_INTERACTION;
        this.serverPathLen[id] = 0;
        this.targetX[id] = x | 0;
        this.targetY[id] = y | 0;
        this.targetRot[id] = rotation | 0;
        this.baseSpeed[id] = 4; // default walk speed (pixels per client tick)
        this.animTick[id] = 0;
        this.loopCount[id] = 0;
        this.seqId[id] = -1;
        this.seqTicksLeft[id] = 0;
        this.seqTicksTotal[id] = 0;
        this.seqDelay[id] = 0;
        this.seqPathLength[id] = 0;
        this.movementFrameIndex[id] = 0;
        this.movementSeqId[id] = -1;
        this.movementAnimTick[id] = 0;
        this.movementLoopCount[id] = 0;
        this.occTileX[id] = (spawnTileX | 0) & 63;
        this.occTileY[id] = (spawnTileY | 0) & 63;
        this.occPlane[id] = level & 3;
        this.stepQueueHead[id] = 0;
        this.stepQueueTail[id] = 0;
        this.stepQueueLen[id] = 0;
        this.stepActive[id] = 0;
        this.currentStepSpeed[id] = 0;
        this.currentStepRot[id] = 0xffff;
        this.movementDelayCounter[id] = 0;

        let list = this.perMap.get(mid);
        if (!list) {
            list = [];
            this.perMap.set(mid, list);
        }
        list.push(id);
        return id;
    }

    destroyNpc(id: number): void {
        if (!id || !this.active[id]) return;
        const mid = this.mapId[id];
        const list = this.perMap.get(mid);
        if (list) {
            const idx = list.indexOf(id);
            if (idx !== -1) list.splice(idx, 1);
            if (list.length === 0) this.perMap.delete(mid);
        }
        this.active[id] = 0;
        this.freeList.push(id);
        const sid = this.serverId[id] | 0;
        if (sid > 0) {
            this.serverIdLookup.delete(sid);
            this.onServerUnmapped?.(sid);
        }
        this.serverId[id] = 0;
        this.hasServerState[id] = 0;
        this.interactionIndex[id] = NO_INTERACTION;
        this.clipped[id] = 0;
    }

    destroyNpcsForMap(mapX: number, mapY: number): void {
        const mid = getMapSquareId(mapX, mapY);
        const list = this.perMap.get(mid);
        if (!list) return;
        for (const id of list) {
            this.active[id] = 0;
            this.freeList.push(id);
            this.interactionIndex[id] = NO_INTERACTION;
            const sid = this.serverId[id] | 0;
            if (sid > 0) {
                this.serverIdLookup.delete(sid);
                this.onServerUnmapped?.(sid);
            }
            this.serverId[id] = 0;
            this.hasServerState[id] = 0;
        }
        this.perMap.delete(mid);
    }

    /**
     * Reset all NPC state - used on disconnect/logout to prevent memory leaks.
     * Clears all NPCs, mappings, and caches.
     */
    reset(): void {
        // Destroy all NPCs by iterating active ones
        for (let id = 1; id < this.active.length; id++) {
            if (this.active[id]) {
                this.destroyNpc(id);
            }
        }

        // Clear all mappings
        this.perMap.clear();
        this.serverIdLookup.clear();
        this.freeList.length = 0;

        // Reset free list to include all slots (except 0)
        for (let i = this.active.length - 1; i >= 1; i--) {
            this.freeList.push(i);
        }

        console.log("[NpcEcs] Reset complete - all NPCs cleared");
    }

    queryByMap(mapX: number, mapY: number): readonly number[] {
        const mid = getMapSquareId(mapX, mapY);
        const ids = this.perMap.get(mid);
        return ids ? ids : [];
    }

    setSeqTypeLoader(loader?: SeqTypeLoader): void {
        this.seqTypeLoader = loader;
    }

    /**
     * Query NPCs at a specific world tile position.
     * Returns ECS IDs of NPCs whose center is on the given tile.
     */
    queryByTile(worldTileX: number, worldTileY: number): number[] {
        const mapX = (worldTileX >> 6) | 0; // worldTileX / 64
        const mapY = (worldTileY >> 6) | 0; // worldTileY / 64
        const localTileX = worldTileX & 63;
        const localTileY = worldTileY & 63;
        const result: number[] = [];

        const npcIds = this.queryByMap(mapX, mapY);
        for (const id of npcIds) {
            if (!this.active[id]) continue;
            // NPC x,y are signed sub-tile coordinates (128 units per tile).
            // Use arithmetic shifts so map-boundary rebases with negative locals stay correct.
            const npcTileX = this.x[id] >> 7;
            const npcTileY = this.y[id] >> 7;
            if (npcTileX === localTileX && npcTileY === localTileY) {
                result.push(id);
            }
        }
        return result;
    }

    // Sync transform from legacy Npc instances into ECS for a given map.
    syncFromNpcs(
        mapX: number,
        mapY: number,
        npcs: ReadonlyArray<any>,
        npcEntityIds: ReadonlyArray<number>,
    ): void {
        const len = Math.min(npcs.length, npcEntityIds.length);
        for (let i = 0; i < len; i++) {
            const id = npcEntityIds[i] | 0;
            if (!id) continue;
            const n: any = npcs[i];
            if (!n) continue;
            // x,y are local sub-tile coordinates within the map square
            this.x[id] = (n.x | 0) as number;
            this.y[id] = (n.y | 0) as number;
            this.level[id] = (n.level | 0) as number;
            this.rotation[id] = (n.rotation | 0) as number;
            // npc type might be swapped at runtime; keep it in sync
            const typeId = n.npcType?.id;
            if (typeof typeId === "number") this.npcTypeId[id] = typeId | 0;
            // animation state from legacy controller
            const frame: number = (n.movementFrame as number) | 0;
            if (frame >= 0) this.movementFrameIndex[id] = frame & 0xffff;
            const isWalk: boolean = (n.movementSeqId | 0) === (n.walkSeqId | 0);
            this.useWalkAnim[id] = isWalk ? 1 : 0;
        }
    }

    // Accessors for renderer
    getX(id: number): number {
        return this.x[id] | 0;
    }
    getY(id: number): number {
        return this.y[id] | 0;
    }
    getLevel(id: number): number {
        return this.level[id] | 0;
    }
    getRotation(id: number): number {
        return this.rotation[id] | 0;
    }
    getNpcTypeId(id: number): number {
        return this.npcTypeId[id] | 0;
    }
    getMapId(id: number): number {
        return this.mapId[id] | 0;
    }
    getMapX(id: number): number {
        return ((this.mapId[id] | 0) >> 8) & 0xff;
    }
    getMapY(id: number): number {
        return (this.mapId[id] | 0) & 0xff;
    }
    getWorldX(id: number): number {
        return (((this.getMapX(id) | 0) << 13) + (this.x[id] | 0)) | 0;
    }
    getWorldY(id: number): number {
        return (((this.getMapY(id) | 0) << 13) + (this.y[id] | 0)) | 0;
    }
    getLocalXForMap(id: number, mapX: number): number {
        return (this.getWorldX(id) - ((mapX | 0) << 13)) | 0;
    }
    getLocalYForMap(id: number, mapY: number): number {
        return (this.getWorldY(id) - ((mapY | 0) << 13)) | 0;
    }
    getServerId(id: number): number {
        return this.serverId[id] | 0;
    }
    isLinked(id: number): boolean {
        return (this.serverId[id] | 0) > 0;
    }
    isActive(id: number): boolean {
        return this.active[id] === 1;
    }
    getFrameIndex(id: number): number {
        return this.frameIndex[id] | 0;
    }
    getMovementFrameIndex(id: number): number {
        return this.movementFrameIndex[id] | 0;
    }
    isWalking(id: number): boolean {
        return this.useWalkAnim[id] === 1;
    }
    getSpawnTileX(id: number): number {
        return this.spawnTileX[id] | 0;
    }
    getSpawnTileY(id: number): number {
        return this.spawnTileY[id] | 0;
    }
    getRotationSpeed(id: number): number {
        return this.rotSpeed[id] | 0;
    }
    getSize(id: number): number {
        return this.size[id] | 0;
    }
    getServerPathLen(id: number): number {
        return this.serverPathLen[id] | 0;
    }
    getServerPathStep(id: number, idx: number): { x: number; y: number } {
        const off = id * NpcEcs.MAX_SERVER_PATH + (idx | 0);
        return { x: this.serverPathX[off] | 0, y: this.serverPathY[off] | 0 };
    }
    setServerState(
        id: number,
        state: {
            subX: number;
            subY: number;
            tileX: number;
            tileY: number;
            plane: number;
        },
    ): void {
        this.serverSubX[id] = state.subX | 0;
        this.serverSubY[id] = state.subY | 0;
        this.serverTileX[id] = state.tileX | 0;
        this.serverTileY[id] = state.tileY | 0;
        this.serverPlane[id] = (state.plane | 0) & 3;
        this.hasServerState[id] = 1;
    }
    clearServerState(id: number): void {
        this.hasServerState[id] = 0;
    }
    getServerState(
        id: number,
    ): { subX: number; subY: number; tileX: number; tileY: number; plane: number } | undefined {
        if (this.hasServerState[id] !== 1) return undefined;
        return {
            subX: this.serverSubX[id] | 0,
            subY: this.serverSubY[id] | 0,
            tileX: this.serverTileX[id] | 0,
            tileY: this.serverTileY[id] | 0,
            plane: this.serverPlane[id] | 0,
        };
    }
    setServerPath(id: number, coords: { x: number; y: number }[], length: number): void {
        const len = Math.min(length | 0, NpcEcs.MAX_SERVER_PATH);
        const off = id * NpcEcs.MAX_SERVER_PATH;
        for (let i = 0; i < len; i++) {
            this.serverPathX[off + i] = coords[i].x | 0;
            this.serverPathY[off + i] = coords[i].y | 0;
        }
        this.serverPathLen[id] = len;
    }
    clearServerPath(id: number): void {
        this.serverPathLen[id] = 0;
    }
    popServerPath(id: number): { x: number; y: number } | undefined {
        const len = this.serverPathLen[id] | 0;
        if (len <= 0) return undefined;
        const off = id * NpcEcs.MAX_SERVER_PATH;
        const nx = this.serverPathX[off + len - 1] | 0;
        const ny = this.serverPathY[off + len - 1] | 0;
        this.serverPathLen[id] = (len - 1) & 0xff;
        return { x: nx, y: ny };
    }
    clearStepQueue(id: number): void {
        this.stepQueueHead[id] = 0;
        this.stepQueueTail[id] = 0;
        this.stepQueueLen[id] = 0;
        this.stepActive[id] = 0;
        this.currentStepSpeed[id] = 0;
        this.currentStepRot[id] = 0xffff;
        this.movementDelayCounter[id] = 0;
    }
    enqueueStep(id: number, x: number, y: number, speed: number): void {
        this.cancelSequenceOnMove(id);

        const cap = NpcEcs.MAX_PENDING_PATH;
        const off = id * NpcEcs.MAX_SERVER_PATH;
        let head = this.stepQueueHead[id] | 0;
        let tail = this.stepQueueTail[id] | 0;
        let len = this.stepQueueLen[id] | 0;
        if (len >= cap) {
            head = (head + 1) % cap;
            len = cap - 1;
        }
        this.stepQueueX[off + tail] = x | 0;
        this.stepQueueY[off + tail] = y | 0;
        this.stepQueueSpeed[off + tail] = Math.max(1, speed | 0);
        tail = (tail + 1) % cap;
        len++;
        this.stepQueueHead[id] = head & 0xff;
        this.stepQueueTail[id] = tail & 0xff;
        this.stepQueueLen[id] = len & 0xff;
        if (!this.stepActive[id]) {
            this.ensureActiveStep(id);
        }
    }
    private dequeueStep(id: number): { x: number; y: number; speed: number } | undefined {
        const len = this.stepQueueLen[id] | 0;
        if (len <= 0) return undefined;
        const cap = NpcEcs.MAX_PENDING_PATH;
        const off = id * NpcEcs.MAX_SERVER_PATH;
        let head = this.stepQueueHead[id] | 0;
        const x = this.stepQueueX[off + head] | 0;
        const y = this.stepQueueY[off + head] | 0;
        const speed = Math.max(1, this.stepQueueSpeed[off + head] | 0);
        head = (head + 1) % cap;
        this.stepQueueHead[id] = head & 0xff;
        this.stepQueueLen[id] = ((len - 1) & 0xff) | 0;
        return { x, y, speed };
    }
    ensureActiveStep(id: number): boolean {
        if (this.stepActive[id]) return true;
        const next = this.dequeueStep(id);
        if (!next) return false;
        this.targetX[id] = next.x | 0;
        this.targetY[id] = next.y | 0;
        this.currentStepSpeed[id] = Math.max(1, next.speed | 0);
        const dx = (this.targetX[id] | 0) - (this.x[id] | 0);
        const dy = (this.targetY[id] | 0) - (this.y[id] | 0);
        const stepRot = this.computeStepOrientation(dx, dy);
        this.currentStepRot[id] = stepRot === undefined ? 0xffff : stepRot & 2047;
        this.stepActive[id] = 1;
        return true;
    }
    completeActiveStep(id: number): void {
        this.stepActive[id] = 0;
        this.currentStepSpeed[id] = 0;
        this.consumeSequencePathStep(id);
        if (!this.ensureActiveStep(id)) {
            // No more steps; snap target to current location
            this.targetX[id] = this.x[id] | 0;
            this.targetY[id] = this.y[id] | 0;
        }
    }
    hasPendingSteps(id: number): boolean {
        return (this.stepQueueLen[id] | 0) > 0;
    }
    isStepActive(id: number): boolean {
        return this.stepActive[id] === 1;
    }
    /** Returns true if NPC should use walk animation (actively stepping toward a target) */
    shouldUseWalkAnim(id: number): boolean {
        return this.useWalkAnim[id] === 1;
    }
    getCurrentStepSpeed(id: number): number {
        const s = this.currentStepSpeed[id] | 0;
        return s > 0 ? s : this.baseSpeed[id] | 0;
    }
    getCurrentStepRot(id: number): number | undefined {
        const rot = this.currentStepRot[id] | 0;
        return rot === 0xffff ? undefined : rot & 2047;
    }
    isAtTarget(id: number, epsilon: number = 1): boolean {
        const dx = (this.targetX[id] | 0) - (this.x[id] | 0);
        const dy = (this.targetY[id] | 0) - (this.y[id] | 0);
        return dx * dx + dy * dy <= epsilon * epsilon;
    }

    /**
     * Advances NPC movement by a number of client cycles (20ms each).
     * This is part of the core game loop (not rendering) so NPC step queues do not overflow
     * when rendering is throttled (e.g., alt-tab / background tabs).
     */
    updateClient(ticks: number = 1): void {
        const total = Math.max(0, ticks | 0);
        if (total === 0) return;
        for (let t = 0; t < total; t++) {
            for (const idRaw of this.serverIdLookup.values()) {
                const id = idRaw | 0;
                if (!this.isActive(id)) continue;
                if (!this.isStepActive(id) && !this.ensureActiveStep(id)) {
                    this.useWalkAnim[id] = 0;
                    this.movementDelayCounter[id] = 0;
                    this.advanceSequence(id);
                    continue;
                }

                const pathLengthLike = this.getPathLengthLike(id);
                if (this.isActionSequenceBlockingMovement(id, pathLengthLike)) {
                    const held = this.movementDelayCounter[id] | 0;
                    this.movementDelayCounter[id] = Math.min(255, held + 1) & 0xff;
                    this.useWalkAnim[id] = 0;
                    this.advanceSequence(id);
                    continue;
                }

                const cx = this.getX(id) | 0;
                const cy = this.getY(id) | 0;
                const tx = this.getTargetX(id) | 0;
                const ty = this.getTargetY(id) | 0;
                const dx = (tx - cx) | 0;
                const dy = (ty - cy) | 0;

                // OSRS parity: one current path target is processed per client cycle.
                if (cx === tx && cy === ty) {
                    this.completeActiveStep(id);
                } else if (dx > 256 || dx < -256 || dy > 256 || dy < -256) {
                    // OSRS parity: snap to target tile center when >2 tiles away on either axis.
                    this.setXY(id, tx, ty);
                    this.completeActiveStep(id);
                } else {
                    // OSRS parity: base movement speed from remaining path length thresholds.
                    const rawStepSpeed = Math.max(1, this.getCurrentStepSpeed(id) | 0);
                    const pendingPathLength = pathLengthLike;
                    let speed = 4;
                    const stepRot = this.getCurrentStepRot(id);
                    const turningIntoStep =
                        stepRot !== undefined &&
                        ((stepRot | 0) !== (this.rotation[id] | 0)) &&
                        (this.interactionIndex[id] | 0) === NO_INTERACTION &&
                        (this.rotSpeed[id] | 0) !== 0;
                    const isClippedNpc = this.clipped[id] === 1;

                    if (isClippedNpc) {
                        // Deob parity: clipped NPCs slow to walk speed 2 while turning into a
                        // path step without an interaction target, which is especially visible
                        // when retreating back toward spawn.
                        if (turningIntoStep) {
                            speed = 2;
                        }
                        if (pendingPathLength > 2) speed = 6;
                        if (pendingPathLength > 3) speed = 8;
                        if ((this.movementDelayCounter[id] | 0) > 0 && pendingPathLength > 1) {
                            speed = 8;
                            this.movementDelayCounter[id] =
                                Math.max(0, (this.movementDelayCounter[id] | 0) - 1) & 0xff;
                        }
                    } else {
                        if (pendingPathLength > 1) speed = 6;
                        if (pendingPathLength > 2) speed = 8;
                        if ((this.movementDelayCounter[id] | 0) > 0 && pendingPathLength > 1) {
                            speed = 8;
                            this.movementDelayCounter[id] =
                                Math.max(0, (this.movementDelayCounter[id] | 0) - 1) & 0xff;
                        }
                    }
                    if (rawStepSpeed >= 8) speed <<= 1; // run traversal
                    else if (rawStepSpeed <= 2) speed >>= 1; // crawl traversal
                    speed = Math.max(1, speed | 0);

                    // OSRS parity: axis-wise stepping (both axes can move in one cycle).
                    let newX = cx;
                    let newY = cy;
                    if (cx < tx) newX = Math.min(tx, cx + speed);
                    else if (cx > tx) newX = Math.max(tx, cx - speed);
                    if (cy < ty) newY = Math.min(ty, cy + speed);
                    else if (cy > ty) newY = Math.max(ty, cy - speed);

                    this.setXY(id, newX | 0, newY | 0);
                    if ((newX | 0) === (tx | 0) && (newY | 0) === (ty | 0)) {
                        this.completeActiveStep(id);
                    }
                }

                this.useWalkAnim[id] = this.stepActive[id] === 1 ? 1 : 0;
                this.advanceSequence(id);
            }
        }
    }

    private computeStepOrientation(dx: number, dy: number): number | undefined {
        const sx = Math.sign(dx | 0);
        const sy = Math.sign(dy | 0);
        if (sx === 0 && sy === 0) return undefined;
        if (sx > 0) {
            if (sy > 0) return 1280; // NE
            if (sy < 0) return 1792; // SE
            return 1536; // E
        }
        if (sx < 0) {
            if (sy > 0) return 768; // NW
            if (sy < 0) return 256; // SW
            return 512; // W
        }
        if (sy > 0) return 1024; // N
        return 0; // S
    }
    setXY(id: number, x: number, y: number): void {
        this.x[id] = x | 0;
        this.y[id] = y | 0;
        // Keep occupancy telemetry aligned with movement updates.
        this.occTileX[id] = ((x | 0) >> 7) & 63;
        this.occTileY[id] = ((y | 0) >> 7) & 63;
        this.occPlane[id] = this.level[id] & 3;
    }
    setLevel(id: number, level: number): void {
        this.level[id] = (level | 0) & 3;
        this.occPlane[id] = this.level[id] & 3;
    }
    setRotation(id: number, rot: number): void {
        this.rotation[id] = (rot | 0) & 2047;
    }
    setWalking(id: number, walking: boolean): void {
        this.useWalkAnim[id] = walking ? 1 : 0;
    }
    setFrameIndex(id: number, idx: number): void {
        this.frameIndex[id] = (idx | 0) & 0xffff;
    }
    setMovementFrameIndex(id: number, idx: number): void {
        this.movementFrameIndex[id] = (idx | 0) & 0xffff;
    }
    handleServerSequence(id: number, seqId: number, ticks: number, delay: number = 0): void {
        const nextSeq = seqId | 0;
        const nextDelay = Math.max(0, delay | 0) & 0xff;
        const currentSeq = this.seqId[id] | 0;

        if (currentSeq === nextSeq && nextSeq !== -1) {
            const restartMode = this.getSeqRestartMode(nextSeq);
            if (restartMode === 1) {
                this.seqTicksTotal[id] = Math.max(0, ticks | 0);
                this.seqTicksLeft[id] = Math.max(0, ticks | 0);
                this.seqDelay[id] = nextDelay;
                this.animTick[id] = 0;
                this.frameIndex[id] = 0;
                this.loopCount[id] = 0;
            } else if (restartMode === 2) {
                this.loopCount[id] = 0;
            }
            return;
        }

        if (nextSeq === -1) {
            this.clearSeq(id);
            return;
        }

        if (
            currentSeq === -1 ||
            this.getSeqForcedPriority(nextSeq) >= this.getSeqForcedPriority(currentSeq)
        ) {
            this.seqId[id] = nextSeq;
            this.seqTicksTotal[id] = Math.max(0, ticks | 0);
            this.seqTicksLeft[id] = Math.max(0, ticks | 0);
            this.seqDelay[id] = nextDelay;
            this.seqPathLength[id] = Math.min(255, this.getPathLengthLike(id)) & 0xff;
            this.animTick[id] = 0;
            this.frameIndex[id] = 0;
            this.loopCount[id] = 0;
        }
    }
    setSeq(id: number, seqId: number, ticks: number, delay: number = 0): void {
        this.handleServerSequence(id, seqId, ticks, delay);
    }
    clearSeq(id: number): void {
        this.seqId[id] = -1;
        this.seqTicksLeft[id] = 0;
        this.seqTicksTotal[id] = 0;
        this.seqDelay[id] = 0;
        this.seqPathLength[id] = 0;
        // Reset animTick and frameIndex so next animation starts from frame 0
        this.animTick[id] = 0;
        this.frameIndex[id] = 0;
        this.loopCount[id] = 0;
    }
    setTargetXY(id: number, x: number, y: number): void {
        this.targetX[id] = x | 0;
        this.targetY[id] = y | 0;
    }
    setTargetRot(id: number, rot: number): void {
        this.targetRot[id] = (rot | 0) & 2047;
    }
    getTargetX(id: number): number {
        return this.targetX[id] | 0;
    }
    getTargetY(id: number): number {
        return this.targetY[id] | 0;
    }
    getTargetRot(id: number): number {
        return this.targetRot[id] | 0;
    }
    setInteractionIndex(id: number, index: number | undefined): void {
        this.interactionIndex[id] =
            typeof index === "number" && index >= 0 ? index | 0 : NO_INTERACTION;
    }
    clearInteraction(id: number): void {
        this.interactionIndex[id] = NO_INTERACTION;
    }
    getInteractionIndex(id: number): number {
        return this.interactionIndex[id] | 0;
    }
    getInteractingId(id: number): number | undefined {
        const decoded = decodeInteractionIndex(this.getInteractionIndex(id));
        return decoded?.id;
    }
    getInteractingType(id: number): "player" | "npc" | undefined {
        const decoded = decodeInteractionIndex(this.getInteractionIndex(id));
        return decoded?.type;
    }
    getBaseSpeed(id: number): number {
        return this.baseSpeed[id] | 0;
    }
    getAnimTick(id: number): number {
        return this.animTick[id] | 0;
    }
    getMovementAnimTick(id: number): number {
        return this.movementAnimTick[id] | 0;
    }
    setAnimTick(id: number, v: number): void {
        this.animTick[id] = (v | 0) & 0xffff;
    }
    setMovementAnimTick(id: number, v: number): void {
        this.movementAnimTick[id] = (v | 0) & 0xffff;
    }
    getLoopCount(id: number): number {
        return this.loopCount[id] | 0;
    }
    getMovementLoopCount(id: number): number {
        return this.movementLoopCount[id] | 0;
    }
    setLoopCount(id: number, v: number): void {
        this.loopCount[id] = (v | 0) & 0xffff;
    }
    setMovementLoopCount(id: number, v: number): void {
        this.movementLoopCount[id] = (v | 0) & 0xffff;
    }
    getSeqId(id: number): number {
        return this.seqId[id] | 0;
    }
    getMovementSeqId(id: number): number {
        return this.movementSeqId[id] | 0;
    }
    setMovementSeqId(id: number, seqId: number): void {
        this.movementSeqId[id] = seqId | 0;
    }
    getSeqTicksLeft(id: number): number {
        return this.seqTicksLeft[id] | 0;
    }
    setSeqTicksLeft(id: number, ticks: number): void {
        this.seqTicksLeft[id] = Math.max(0, ticks | 0);
    }
    getSeqTicksTotal(id: number): number {
        return this.seqTicksTotal[id] | 0;
    }
    getSeqDelay(id: number): number {
        return this.seqDelay[id] | 0;
    }
    setSeqDelay(id: number, delay: number): void {
        this.seqDelay[id] = Math.max(0, delay | 0) & 0xff;
    }
    getSeqPathLength(id: number): number {
        return this.seqPathLength[id] | 0;
    }
    getMovementDelayCounter(id: number): number {
        return this.movementDelayCounter[id] | 0;
    }
    // Occupancy
    getOccTileX(id: number): number {
        return this.occTileX[id] | 0;
    }
    getOccTileY(id: number): number {
        return this.occTileY[id] | 0;
    }
    getOccPlane(id: number): number {
        return this.occPlane[id] | 0;
    }
    setOccTile(id: number, x: number, y: number, plane: number): void {
        this.occTileX[id] = (x | 0) & 63;
        this.occTileY[id] = (y | 0) & 63;
        this.occPlane[id] = (plane | 0) & 3;
    }

    getEcsIdForServer(serverId: number): number | undefined {
        return this.serverIdLookup.get(serverId | 0);
    }

    /**
     * Iterates over all active NPC ECS IDs (all NPCs, not just server-linked).
     * Uses a generator to avoid array allocation - mobile friendly.
     */
    *getAllActiveIds(): Generator<number, void, unknown> {
        for (const ids of this.perMap.values()) {
            for (let i = 0; i < ids.length; i++) {
                const id = ids[i];
                if (this.active[id]) {
                    yield id;
                }
            }
        }
    }

    setServerMapping(id: number, serverId: number): void {
        const sid = serverId | 0;
        const prev = this.serverId[id] | 0;

        // Avoid churn: remapping the same ECS id to the same server id must be a no-op.
        // WebGL map-square refreshes can call this repeatedly every frame.
        if ((prev | 0) === (sid | 0)) return;

        if (prev > 0) {
            this.serverIdLookup.delete(prev);
            this.onServerUnmapped?.(prev);
            this.hasServerState[id] = 0;
        }

        if (sid > 0) {
            const existing = this.serverIdLookup.get(sid);
            if (existing !== undefined && (existing | 0) !== (id | 0)) {
                // Transfer mapping ownership without treating this server id as "unmapped".
                this.serverId[existing | 0] = 0;
                this.hasServerState[existing | 0] = 0;
            }
            this.serverIdLookup.set(sid, id | 0);
        }
        this.serverId[id] = sid;
    }

    /**
     * Updates the owning map square for this NPC (used when streaming NPCs by world position).
     * Does not change coordinates; callers must ensure x/y are in the new map's local space.
     */
    setMapSquare(id: number, mapX: number, mapY: number): void {
        if (!id || !this.active[id]) return;
        const nextMid = getMapSquareId(mapX | 0, mapY | 0) | 0;
        const prevMid = this.mapId[id] | 0;
        if ((prevMid | 0) === (nextMid | 0)) return;

        const prevList = this.perMap.get(prevMid);
        if (prevList) {
            const idx = prevList.indexOf(id);
            if (idx !== -1) prevList.splice(idx, 1);
            if (prevList.length === 0) this.perMap.delete(prevMid);
        }

        let nextList = this.perMap.get(nextMid);
        if (!nextList) {
            nextList = [];
            this.perMap.set(nextMid, nextList);
        }
        if (nextList.indexOf(id) === -1) nextList.push(id);
        this.mapId[id] = nextMid & 0xffff;
    }

    /**
     * Move an NPC to a new owning map square while preserving world-space position.
     *
     * NPC fine coordinates are stored map-local; when the owning map changes we must rebase
     * current/target/queued local coordinates so world-space placement is unchanged.
     */
    rebaseToMapSquare(id: number, mapX: number, mapY: number): void {
        if (!id || !this.active[id]) return;

        const prevMid = this.mapId[id] | 0;
        const prevMapX = (prevMid >> 8) & 0xff;
        const prevMapY = prevMid & 0xff;
        const nextMapX = mapX | 0;
        const nextMapY = mapY | 0;
        if (prevMapX === nextMapX && prevMapY === nextMapY) return;

        const prevBaseX = (prevMapX << 13) | 0;
        const prevBaseY = (prevMapY << 13) | 0;
        const nextBaseX = (nextMapX << 13) | 0;
        const nextBaseY = (nextMapY << 13) | 0;
        const deltaX = (prevBaseX - nextBaseX) | 0;
        const deltaY = (prevBaseY - nextBaseY) | 0;

        this.x[id] = (this.x[id] + deltaX) | 0;
        this.y[id] = (this.y[id] + deltaY) | 0;
        this.targetX[id] = (this.targetX[id] + deltaX) | 0;
        this.targetY[id] = (this.targetY[id] + deltaY) | 0;

        const off = id * NpcEcs.MAX_SERVER_PATH;
        for (let i = 0; i < NpcEcs.MAX_SERVER_PATH; i++) {
            this.stepQueueX[off + i] = (this.stepQueueX[off + i] + deltaX) | 0;
            this.stepQueueY[off + i] = (this.stepQueueY[off + i] + deltaY) | 0;
        }

        // Maintain world-space occupancy tile after rebasing local coordinates.
        const worldX = (nextBaseX + (this.x[id] | 0)) | 0;
        const worldY = (nextBaseY + (this.y[id] | 0)) | 0;
        this.occTileX[id] = (worldX >> 7) & 63;
        this.occTileY[id] = (worldY >> 7) & 63;
        this.occPlane[id] = this.level[id] & 3;

        this.setMapSquare(id, nextMapX, nextMapY);
    }

    findBySpawn(
        mapX: number,
        mapY: number,
        spawnTileX: number,
        spawnTileY: number,
        level: number,
        typeId: number,
    ): number | undefined {
        const mid = getMapSquareId(mapX, mapY);
        const ids = this.perMap.get(mid);
        if (!ids) return undefined;
        const stx = spawnTileX & 63;
        const sty = spawnTileY & 63;
        const lvl = level | 0;
        const tid = typeId | 0;
        for (const id of ids) {
            if (!this.active[id]) continue;
            if ((this.spawnTileX[id] | 0) !== stx) continue;
            if ((this.spawnTileY[id] | 0) !== sty) continue;
            if ((this.level[id] | 0) !== lvl) continue;
            if ((this.npcTypeId[id] | 0) !== tid) continue;
            return id;
        }
        return undefined;
    }

    getPathLengthLike(id: number): number {
        return ((this.stepActive[id] ? 1 : 0) + (this.stepQueueLen[id] | 0)) | 0;
    }

    private getSeqType(id: number): any | undefined {
        const seqId = this.seqId[id] | 0;
        if (seqId < 0) return undefined;
        return this.seqTypeLoader?.load?.(seqId);
    }

    private isActionSequenceBlockingMovement(id: number, pathLengthLike: number): boolean {
        if (!(pathLengthLike > 0)) return false;
        const seqId = this.seqId[id] | 0;
        if (seqId < 0) return false;
        if ((this.seqDelay[id] | 0) !== 0) return false;

        const seqType: any = this.getSeqType(id);
        if (!seqType) return false;

        const movingSnapshot = this.seqPathLength[id] | 0;
        const precedenceAnimating = (seqType.precedenceAnimating ?? -1) | 0;
        const priority = (seqType.priority ?? -1) | 0;
        return (
            (movingSnapshot > 0 && precedenceAnimating === 0) ||
            (movingSnapshot <= 0 && priority === 0)
        );
    }

    private cancelSequenceOnMove(id: number): void {
        const seqType: any = this.getSeqType(id);
        if (!seqType) return;
        const priority = (seqType.priority ?? -1) | 0;
        if (priority === 1) {
            this.clearSeq(id);
        }
    }

    private consumeSequencePathStep(id: number): void {
        const remaining = this.seqPathLength[id] | 0;
        if (remaining > 0) {
            this.seqPathLength[id] = (remaining - 1) & 0xff;
        }
    }

    private advanceSequence(id: number): void {
        if ((this.seqId[id] | 0) < 0) return;
        const delay = this.seqDelay[id] | 0;
        const seqType: any = this.getSeqType(id);
        if (delay > 1) {
            this.seqDelay[id] = (delay - 1) & 0xff;
            return;
        }
        if (delay === 1) {
            const precedenceAnimating = (seqType?.precedenceAnimating ?? -1) | 0;
            if (precedenceAnimating === 1 && (this.seqPathLength[id] | 0) > 0) {
                this.seqDelay[id] = 1;
                return;
            }
            this.seqDelay[id] = 0;
            return;
        }
    }

    private getSeqRestartMode(seqId: number): number {
        const seqType: any = this.seqTypeLoader?.load?.(seqId | 0);
        return (seqType?.replyMode ?? 2) | 0;
    }

    private getSeqForcedPriority(seqId: number): number {
        const seqType: any = this.seqTypeLoader?.load?.(seqId | 0);
        return Math.max(0, (seqType?.forcedPriority ?? 5) | 0);
    }

    // ── Color override (Actor HSL tint) ──────────────────────────────────
    getColorOverride(i: number): {
        hue: number;
        sat: number;
        lum: number;
        amount: number;
        startCycle: number;
        endCycle: number;
    } {
        return {
            hue: (this.colorOverrideHue?.[i] ?? 0) | 0,
            sat: (this.colorOverrideSat?.[i] ?? 0) | 0,
            lum: (this.colorOverrideLum?.[i] ?? 0) | 0,
            amount: (this.colorOverrideAmount?.[i] ?? 0) | 0,
            startCycle: (this.colorOverrideStartCycle?.[i] ?? 0) | 0,
            endCycle: (this.colorOverrideEndCycle?.[i] ?? 0) | 0,
        };
    }

    setColorOverride(
        i: number,
        hue: number,
        sat: number,
        lum: number,
        amount: number,
        startCycle: number,
        endCycle: number,
    ): void {
        if (this.colorOverrideHue) this.colorOverrideHue[i] = (hue | 0) & 0x7f;
        if (this.colorOverrideSat) this.colorOverrideSat[i] = (sat | 0) & 0x7f;
        if (this.colorOverrideLum) this.colorOverrideLum[i] = (lum | 0) & 0x7f;
        if (this.colorOverrideAmount) this.colorOverrideAmount[i] = (amount | 0) & 0xff;
        if (this.colorOverrideStartCycle)
            this.colorOverrideStartCycle[i] = (startCycle | 0) & 0xffff;
        if (this.colorOverrideEndCycle) this.colorOverrideEndCycle[i] = (endCycle | 0) & 0xffff;
    }

    clearColorOverride(i: number): void {
        if (this.colorOverrideAmount) this.colorOverrideAmount[i] = 0;
    }
}
