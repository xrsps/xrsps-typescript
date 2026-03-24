import { PlayerAppearance } from "../../rs/config/player/PlayerAppearance";
import type { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import { NO_INTERACTION, decodeInteractionIndex } from "../../rs/interaction/InteractionIndex";
import { faceAngleRs } from "../../rs/utils/rotation";

export type PlayerAnimKey =
    | "idle"
    | "walk"
    | "walkBack"
    | "walkLeft"
    | "walkRight"
    | "run"
    | "runBack"
    | "runLeft"
    | "runRight"
    | "crawl"
    | "crawlBack"
    | "crawlLeft"
    | "crawlRight"
    | "turnLeft"
    | "turnRight";

type PlayerAnimSet = Partial<Record<PlayerAnimKey, number | undefined>>;

export class PlayerEcs {
    private capacity = 0;
    private count = 0;
    private clientCycle = 0; // Game cycle counter (increments each client tick)

    private static readonly DEFAULT_SERVER_TICK_MS = 600;
    private static readonly MIN_SPEED_SCALE = 0.25;
    private static readonly MAX_SPEED_SCALE = 4.0;

    private serverTickMs: number = PlayerEcs.DEFAULT_SERVER_TICK_MS;
    // Visual speed multipliers (do not affect server cadence)
    private walkSpeedMultiplier: number = 1.0;
    private runSpeedMultiplier: number = 1.0;
    private clientTickDurationMs: number = 20;
    private speedScale: number = 1;

    // Server ID mapping
    private serverIdToIndex: Map<number, number> = new Map();
    private indexToServerId: Map<number, number> = new Map();
    private freeIndices: number[] = [];

    private x!: Int32Array; // sub-tile
    private y!: Int32Array; // sub-tile
    private prevX!: Int32Array; // previous sub-tile (for interpolation)
    private prevY!: Int32Array; // previous sub-tile (for interpolation)
    private level!: Uint8Array;
    private rotation!: Uint16Array; // 0..2047
    private targetRot!: Uint16Array; // desired orientation from path step
    private stall!: Uint8Array; // consecutive ticks without movement toward target
    private rotationCounter!: Uint8Array; // field1239: consecutive ticks rotating (for turn anim delay)
    private movementDelayCounter!: Uint8Array; // field1245: accumulated movement delay from blocking sequences

    // Movement targets and speeds
    private targetX!: Int32Array; // sub-tile
    private targetY!: Int32Array; // sub-tile
    private running!: Uint8Array; // 0/1
    private walkSpeed!: Uint8Array; // sub-tile units per client tick (default 4)
    private runSpeed!: Uint8Array; // sub-tile units per client tick (default 8)
    private rotationSpeed!: Uint16Array; // max yaw speed per tick (default 32)
    private rotationAccel!: Uint8Array; // yaw acceleration per tick (default 8)
    private rotationVel!: Uint16Array; // current yaw speed (integrates toward max)

    // PendingSpawn.method2449 (face tile / face direction). Cleared by Actor.method2460()
    // when (pathLength==0 || field1245>0) is processed.
    private faceSubX!: Int32Array; // local fine x (>=0) or -1
    private faceSubY!: Int32Array; // local fine y (>=0) or -1
    private faceDir!: Int16Array; // 0..2047 or -1
    private faceInstant!: Uint8Array; // 1 => snap rotation to orientation
    // Animation timing (tick accumulator for potential parity)
    private animTick!: Uint16Array;

    // Dynamic animation state per player
    private animSeqId!: Int32Array; // Current animation sequence ID (for single-sequence mode)
    private animActionSeqId!: Int32Array; // Action sequence ID (upper body for blending)
    private animMovementSeqId!: Int32Array; // Movement sequence ID (lower body for blending)
    // Action sequence frame state (mirrors Actor.sequenceFrame/sequenceFrameCycle).
    // Stored here so movement/forced-movement logic can consult it without depending on the renderer/controller.
    private animSeqFrame!: Int32Array;
    private animSeqFrameCycle!: Int32Array;
    private animFrameCount!: Uint16Array; // Total frames in current animation
    private animIsSkeletal!: Uint8Array; // 0/1 whether using skeletal animation
    private animBaseCenterX!: Int32Array; // Stable XZ pivot for model
    private animBaseCenterZ!: Int32Array;
    private animPhaseBias!: Float32Array; // Phase bias for foot planting (0..1)
    private animDistTraveled!: Float32Array; // Total distance traveled in sub-tile units for phase calc
    private animSeqDelay!: Uint8Array; // sequenceDelay: Ticks before action sequence starts
    private animLoopCounter!: Uint8Array; // field1220: Loop counter for action sequences

    private animIdleSeq!: Int32Array;
    private animWalkSeq!: Int32Array;
    private animWalkBackSeq!: Int32Array;
    private animWalkLeftSeq!: Int32Array;
    private animWalkRightSeq!: Int32Array;
    private animRunSeq!: Int32Array;
    private animRunBackSeq!: Int32Array;
    private animRunLeftSeq!: Int32Array;
    private animRunRightSeq!: Int32Array;
    private animCrawlSeq!: Int32Array; // field1188 (crawl forward, speed <= 2)
    private animCrawlBackSeq!: Int32Array; // field1178 (crawl backward)
    private animCrawlLeftSeq!: Int32Array; // field1190 (crawl left)
    private animCrawlRightSeq!: Int32Array; // field1191 (crawl right)
    private animTurnLeftSeq!: Int32Array;
    private animTurnRightSeq!: Int32Array;
    private defaultAnimSet: PlayerAnimSet = {};

    // Movement debug telemetry (toggleable)
    private movementDebugEnabled = false;
    private movementDebugSink?: (row: any) => void;
    private telemetrySampleSource: "clientTick" | "rendererFrame" | "serverTick" = "clientTick";
    private telemetryClockProvider?: () => { tick: number; phase: number };

    // Tile dwell tracking for telemetry
    private dwellTileX!: Int16Array;
    private dwellTileY!: Int16Array;
    private dwellTicks!: Uint32Array; // ticks since (re)entering current tile center

    // Player metadata
    private names: (string | undefined)[] = [];
    private nameToIndex: Map<string, number> = new Map();
    private appearances: (PlayerAppearance | undefined)[] = [];
    private combatLevels!: Uint8Array; // 0..126
    private teams!: Uint8Array; // 0 = none

    // Model cache for dynamic animation (stored as any to avoid circular deps)
    private baseModels: (any | undefined)[] = [];
    private modelIndicesCount!: Int32Array;
    private modelIndicesCountAlpha!: Int32Array;

    // Occupancy (committed tile for collision/interaction)
    private occTileX!: Uint8Array; // 0..63
    private occTileY!: Uint8Array; // 0..63
    private occPlane!: Uint8Array; // 0..3, 255 = uninitialized
    private occMapX!: Uint8Array; // 0..99 (map square x)
    private occMapY!: Uint8Array; // 0..199 (map square y)

    // Movement frame/cycle synchronization (OSRS behavior)
    // NOTE: OSRS `Actor.pathLength` is derived from the path buffers; we compute this
    // dynamically from the active segment + queued steps to match live behavior.
    private forcedMovementCounter!: Uint8Array; // Forces speed to 8 when >0 (anInt1503 in original)
    private forcedMovementSteps!: Uint8Array; // field1215: remaining pathLength at time sequence started (decremented as steps complete)

    // OSRS Forced Movement System (teleports, knockback)
    // Reference: player-animation.md lines 999-1048
    private forcedMoveStartCycle!: Uint32Array; // spotAnimation: START cycle for forced movement
    private forcedMoveEndCycle!: Uint32Array; // field1228: END cycle for forced movement
    private forcedMoveStartX!: Int32Array; // field1223: Start X offset (fine units)
    private forcedMoveStartY!: Int32Array; // field1225: Start Y offset (fine units)
    private forcedMoveEndX!: Int32Array; // field1224: End X offset (fine units)
    private forcedMoveEndY!: Int32Array; // field1226: End Y offset (fine units)
    private forcedMoveTargetRot!: Uint16Array; // field1173: Target orientation after movement

    // Server dictates movement; client interpolates between server steps
    private serverInterpEnabled: boolean = true;
    private srvLastX!: Int32Array;
    private srvLastY!: Int32Array;
    private srvNextX!: Int32Array;
    private srvNextY!: Int32Array;
    private srvT!: Float32Array; // 0..1
    private srvStepPerClientTick: number = 1 / 30;
    private srvSegFactor!: Float32Array; // per-segment speed factor (1=walk, 2=run)
    private srvPendingValid!: Uint8Array;
    private srvPendingX!: Int32Array;
    private srvPendingY!: Int32Array;
    private srvPendingFactor!: Float32Array;
    private srvOverrun!: Float32Array; // extra local progress beyond t=1.0 while waiting next segment
    private movingHold!: Uint8Array; // frames to hold moving=true across step boundary
    private srvArrivedHeld!: Uint8Array; // mark that we applied post-arrival hold for this step
    private stepParity!: Uint8Array; // toggles each server step for gait parity
    private srvSnapDX!: Int16Array; // residual x offset to ease in after snapping
    private srvSnapDY!: Int16Array; // residual y offset to ease in after snapping
    private srvSnapTicks!: Uint8Array; // ticks left to smooth the snap residual

    // Buffered interpolation queue (per-player ring buffer)
    static readonly MAX_INTERP_QUEUE = 8;
    private srvQueueX!: Int32Array;
    private srvQueueY!: Int32Array;
    private srvQueueFactor!: Float32Array;
    private srvQueueRot!: Int32Array; // Rotation (0..2047) for each queued position
    private srvQueueHead!: Uint8Array;
    private srvQueueTail!: Uint8Array;
    private srvQueueLen!: Uint8Array;
    // Whether we are in a continuous movement chain (immediate segment start optimization)
    private srvChainActive!: Uint8Array;

    // Interaction state per player (server-sourced)
    private interactionIndex!: Int32Array; // -1 when none

    // Shared base-model cache keyed by appearance hash so multiple players with
    // the same appearance reuse the same model/pivot without rebuilding it.
    private appearanceBaseCache: Map<
        string,
        { baseModel: any; baseCenterX: number; baseCenterZ: number; defaultHeightTiles: number }
    > = new Map();

    // Overhead chat state
    private overheadText: (string | undefined)[] = [];
    private overheadColorId!: Uint8Array;
    private overheadEffect!: Uint8Array;
    private overheadPattern?: (Int32Array | undefined)[];
    private overheadCycle!: Uint16Array;
    private overheadDuration!: Uint16Array;
    private overheadModIcon!: Int16Array;

    // Head icons (prayer/pk overhead)
    // Reference: Player.java lines 26-33 in deobfuscated client
    private headIconPrayer!: Int8Array; // -1 = none, 0 = Protect from Melee, 1 = Missiles, 2 = Magic, etc.
    private headIconPk!: Int8Array; // -1 = none, skull types

    // Color override (damage/poison/freeze tints)
    private colorOverrideHue!: Uint8Array; // field1234: Override hue (0-127)
    private colorOverrideSat!: Uint8Array; // field1193: Override saturation (0-127)
    private colorOverrideLum!: Uint8Array; // field1204: Override luminance (0-127)
    private colorOverrideAmount!: Uint8Array; // field1237: Override amount (0-255, 0=none, 255=full)
    private colorOverrideStartCycle!: Int32Array; // field1180: Start cycle
    private colorOverrideEndCycle!: Int32Array; // field1233: End cycle

    private seqTypeLoader?: SeqTypeLoader;

    constructor(initialCapacity: number = 16) {
        this.ensureCapacity(initialCapacity);
    }

    setSeqTypeLoader(loader?: SeqTypeLoader): void {
        this.seqTypeLoader = loader;
    }

    // Server ID management
    getIndexForServerId(serverId: number): number | undefined {
        return this.serverIdToIndex.get(serverId);
    }

    getServerIdForIndex(index: number): number | undefined {
        return this.indexToServerId.get(index);
    }

    /**
     * Returns all active player server IDs.
     */
    getAllServerIds(): IterableIterator<number> {
        return this.serverIdToIndex.keys();
    }

    /**
     * Returns all active player ECS indices.
     */
    getAllActiveIndices(): IterableIterator<number> {
        return this.serverIdToIndex.values();
    }

    /**
     * Reassigns the mapping of a player from one serverId to another, preserving the same ECS slot.
     * If the oldId is not found, this is a no-op and returns the index for newId if it exists.
     */
    reassignServerId(oldId: number, newId: number): number | undefined {
        if (oldId === newId) return this.serverIdToIndex.get(oldId);
        const idx = this.serverIdToIndex.get(oldId);
        if (idx === undefined) return this.serverIdToIndex.get(newId);
        // If newId is already mapped, keep it and do not clobber; return existing
        const existingNew = this.serverIdToIndex.get(newId);
        if (existingNew !== undefined) return existingNew;
        this.serverIdToIndex.delete(oldId);
        this.serverIdToIndex.set(newId, idx);
        this.indexToServerId.set(idx, newId);
        return idx;
    }

    allocatePlayer(serverId: number): number {
        // Check if already allocated
        const existing = this.serverIdToIndex.get(serverId);
        if (existing !== undefined) return existing;

        // Get next available index
        let index: number;
        if (this.freeIndices.length > 0) {
            index = this.freeIndices.pop()!;
        } else {
            index = this.count;
            this.count++;
            this.ensureCapacity(this.count);
        }

        // Set up mappings
        this.serverIdToIndex.set(serverId, index);
        this.indexToServerId.set(index, serverId);

        // Initialize player state
        this.x[index] = 0;
        this.y[index] = 0;
        this.prevX[index] = 0;
        this.prevY[index] = 0;
        this.level[index] = 0;
        this.rotation[index] = 0;
        this.targetRot[index] = 0;
        this.faceSubX[index] = -1;
        this.faceSubY[index] = -1;
        this.faceDir[index] = -1;
        this.faceInstant[index] = 0;
        this.walkSpeed[index] = 4;
        this.runSpeed[index] = 8;
        this.rotationSpeed[index] = 32;
        this.rotationAccel[index] = 8;

        // Initialize animation state
        this.animSeqId[index] = -1;
        this.animSeqFrame[index] = 0;
        this.animSeqFrameCycle[index] = 0;
        this.animFrameCount[index] = 1;
        this.animIsSkeletal[index] = 0;
        this.animBaseCenterX[index] = 0;
        this.animBaseCenterZ[index] = 0;
        this.animPhaseBias[index] = 0.0;
        this.animDistTraveled[index] = 0.0;

        // Initialize metadata
        this.removeNameMapping(index);
        this.names[index] = undefined;
        this.appearances[index] = undefined;
        this.combatLevels[index] = 0;
        this.teams[index] = 0;

        // Initialize model cache
        this.baseModels[index] = undefined;
        this.modelIndicesCount[index] = 0;
        this.modelIndicesCountAlpha[index] = 0;

        // Initialize interpolation queue
        this.srvQueueHead[index] = 0;
        this.srvQueueTail[index] = 0;
        this.srvQueueLen[index] = 0;
        this.srvChainActive[index] = 0;
        this.srvSnapDX[index] = 0;
        this.srvSnapDY[index] = 0;
        this.srvSnapTicks[index] = 0;

        // Clear forced movement state
        this.clearForcedMovement(index);

        this.setAnimSet(index, undefined, { mergeWithDefault: true });

        this.clearOverheadChat(index);

        // Init dwell tracking to current tile so dwellTicks starts at 0
        const tx = (this.x[index] >> 7) | 0;
        const ty = (this.y[index] >> 7) | 0;
        this.dwellTileX[index] = tx;
        this.dwellTileY[index] = ty;
        this.dwellTicks[index] = 0;

        return index;
    }

    deallocatePlayer(serverId: number): void {
        const index = this.serverIdToIndex.get(serverId);
        if (index === undefined) return;

        this.serverIdToIndex.delete(serverId);
        this.indexToServerId.delete(index);
        this.freeIndices.push(index);

        // Clear occupancy
        if (this.occPlane) this.occPlane[index] = 255;

        // Clear metadata
        this.removeNameMapping(index);
        this.names[index] = undefined;
        this.appearances[index] = undefined;
        this.combatLevels[index] = 0;
        this.teams[index] = 0;

        // Clear model cache
        this.baseModels[index] = undefined;
        this.modelIndicesCount[index] = 0;
        this.modelIndicesCountAlpha[index] = 0;

        if (this.interactionIndex) this.interactionIndex[index] = NO_INTERACTION;

        this.clearOverheadChat(index);
    }

    /**
     * Reset all player state - used on disconnect/logout to prevent memory leaks.
     * Clears all players, mappings, and caches.
     */
    reset(): void {
        // Deallocate all players by server ID
        const serverIds = Array.from(this.serverIdToIndex.keys());
        for (const serverId of serverIds) {
            this.deallocatePlayer(serverId);
        }

        // Clear all mappings
        this.serverIdToIndex.clear();
        this.indexToServerId.clear();
        this.nameToIndex.clear();
        this.freeIndices.length = 0;

        // Reset count (keeps capacity/arrays allocated for reuse)
        this.count = 0;

        // Clear all metadata arrays
        for (let i = 0; i < this.capacity; i++) {
            this.names[i] = undefined;
            this.appearances[i] = undefined;
            this.baseModels[i] = undefined;
            if (this.combatLevels) this.combatLevels[i] = 0;
            if (this.teams) this.teams[i] = 0;
        }

        // Clear appearance cache
        this.cleanupAppearanceCache();

        // Reset client cycle
        this.clientCycle = 0;

        console.log("[PlayerEcs] Reset complete - all players cleared");
    }

    private ensureCapacity(min: number) {
        if (this.capacity >= min) return;
        const oldCap = this.capacity | 0;
        const newCap = Math.max(min, Math.max(16, this.capacity * 2));
        const grow = <T extends ArrayBufferView>(arr: T | undefined, ctor: any): T => {
            const next: T = new ctor(newCap);
            if (arr) (next as any).set(arr as any, 0);
            return next;
        };
        this.x = grow(this.x, Int32Array);
        this.y = grow(this.y, Int32Array);
        this.prevX = grow(this.prevX, Int32Array);
        this.prevY = grow(this.prevY, Int32Array);
        this.level = grow(this.level, Uint8Array);
        this.rotation = grow(this.rotation, Uint16Array);
        this.targetRot = grow(this.targetRot, Uint16Array);
        this.stall = grow(this.stall, Uint8Array);
        this.rotationCounter = grow(this.rotationCounter, Uint8Array);
        this.movementDelayCounter = grow(this.movementDelayCounter, Uint8Array);
        this.targetX = grow(this.targetX, Int32Array);
        this.targetY = grow(this.targetY, Int32Array);
        this.running = grow(this.running, Uint8Array);
        this.walkSpeed = grow(this.walkSpeed, Uint8Array);
        this.runSpeed = grow(this.runSpeed, Uint8Array);
        this.rotationSpeed = grow(this.rotationSpeed, Uint16Array);
        this.rotationAccel = grow(this.rotationAccel, Uint8Array);
        this.rotationVel = grow(this.rotationVel, Uint16Array);
        this.faceSubX = grow(this.faceSubX, Int32Array);
        this.faceSubY = grow(this.faceSubY, Int32Array);
        this.faceDir = grow(this.faceDir, Int16Array);
        this.faceInstant = grow(this.faceInstant, Uint8Array);
        this.animTick = grow(this.animTick, Uint16Array);
        this.animSeqId = grow(this.animSeqId, Int32Array);
        this.animActionSeqId = grow(this.animActionSeqId, Int32Array);
        this.animMovementSeqId = grow(this.animMovementSeqId, Int32Array);
        this.animSeqFrame = grow(this.animSeqFrame, Int32Array);
        this.animSeqFrameCycle = grow(this.animSeqFrameCycle, Int32Array);
        this.animFrameCount = grow(this.animFrameCount, Uint16Array);
        this.animIsSkeletal = grow(this.animIsSkeletal, Uint8Array);
        this.animBaseCenterX = grow(this.animBaseCenterX, Int32Array);
        this.animBaseCenterZ = grow(this.animBaseCenterZ, Int32Array);
        this.animPhaseBias = grow(this.animPhaseBias, Float32Array);
        this.animDistTraveled = grow(this.animDistTraveled, Float32Array);
        this.animSeqDelay = grow(this.animSeqDelay, Uint8Array);
        this.animLoopCounter = grow(this.animLoopCounter, Uint8Array);
        this.animIdleSeq = grow(this.animIdleSeq, Int32Array);
        this.animWalkSeq = grow(this.animWalkSeq, Int32Array);
        this.animWalkBackSeq = grow(this.animWalkBackSeq, Int32Array);
        this.animWalkLeftSeq = grow(this.animWalkLeftSeq, Int32Array);
        this.animWalkRightSeq = grow(this.animWalkRightSeq, Int32Array);
        this.animRunSeq = grow(this.animRunSeq, Int32Array);
        this.animRunBackSeq = grow(this.animRunBackSeq, Int32Array);
        this.animRunLeftSeq = grow(this.animRunLeftSeq, Int32Array);
        this.animRunRightSeq = grow(this.animRunRightSeq, Int32Array);
        this.animCrawlSeq = grow(this.animCrawlSeq, Int32Array);
        this.animCrawlBackSeq = grow(this.animCrawlBackSeq, Int32Array);
        this.animCrawlLeftSeq = grow(this.animCrawlLeftSeq, Int32Array);
        this.animCrawlRightSeq = grow(this.animCrawlRightSeq, Int32Array);
        this.animTurnLeftSeq = grow(this.animTurnLeftSeq, Int32Array);
        this.animTurnRightSeq = grow(this.animTurnRightSeq, Int32Array);
        this.dwellTileX = grow(this.dwellTileX, Int16Array);
        this.dwellTileY = grow(this.dwellTileY, Int16Array);
        this.dwellTicks = grow(this.dwellTicks, Uint32Array);
        this.modelIndicesCount = grow(this.modelIndicesCount, Int32Array);
        this.modelIndicesCountAlpha = grow(this.modelIndicesCountAlpha, Int32Array);
        this.srvLastX = grow(this.srvLastX, Int32Array);
        this.srvLastY = grow(this.srvLastY, Int32Array);
        this.srvNextX = grow(this.srvNextX, Int32Array);
        this.srvNextY = grow(this.srvNextY, Int32Array);
        this.srvT = grow(this.srvT, Float32Array);
        this.srvSegFactor = grow(this.srvSegFactor, Float32Array);
        this.srvPendingValid = grow(this.srvPendingValid, Uint8Array);
        this.srvPendingX = grow(this.srvPendingX, Int32Array);
        this.srvPendingY = grow(this.srvPendingY, Int32Array);
        this.srvPendingFactor = grow(this.srvPendingFactor, Float32Array);
        this.srvOverrun = grow(this.srvOverrun, Float32Array);
        this.movingHold = grow(this.movingHold, Uint8Array);
        this.srvArrivedHeld = grow(this.srvArrivedHeld, Uint8Array);
        this.stepParity = grow(this.stepParity, Uint8Array);
        this.srvSnapDX = grow(this.srvSnapDX, Int16Array);
        this.srvSnapDY = grow(this.srvSnapDY, Int16Array);
        this.srvSnapTicks = grow(this.srvSnapTicks, Uint8Array);
        this.forcedMovementCounter = grow(this.forcedMovementCounter, Uint8Array);
        this.forcedMovementSteps = grow(this.forcedMovementSteps, Uint8Array);
        this.forcedMoveStartCycle = grow(this.forcedMoveStartCycle, Uint32Array);
        this.forcedMoveEndCycle = grow(this.forcedMoveEndCycle, Uint32Array);
        this.forcedMoveStartX = grow(this.forcedMoveStartX, Int32Array);
        this.forcedMoveStartY = grow(this.forcedMoveStartY, Int32Array);
        this.forcedMoveEndX = grow(this.forcedMoveEndX, Int32Array);
        this.forcedMoveEndY = grow(this.forcedMoveEndY, Int32Array);
        this.forcedMoveTargetRot = grow(this.forcedMoveTargetRot, Uint16Array);
        // Buffered interpolation queues
        const qcap = PlayerEcs.MAX_INTERP_QUEUE;
        const growQueue = <T extends ArrayBufferView>(arr: T | undefined, ctor: any): T => {
            const next: T = new ctor(newCap * qcap);
            if (arr) {
                for (let i = 0; i < oldCap; i++) {
                    const srcOff = i * qcap;
                    const dstOff = i * qcap;
                    (next as any).set((arr as any).subarray(srcOff, srcOff + qcap), dstOff);
                }
            }
            return next;
        };
        this.srvQueueX = growQueue(this.srvQueueX, Int32Array);
        this.srvQueueY = growQueue(this.srvQueueY, Int32Array);
        this.srvQueueFactor = growQueue(this.srvQueueFactor, Float32Array);
        this.srvQueueRot = growQueue(this.srvQueueRot, Int32Array);
        this.srvQueueHead = grow(this.srvQueueHead, Uint8Array);
        this.srvQueueTail = grow(this.srvQueueTail, Uint8Array);
        this.srvQueueLen = grow(this.srvQueueLen, Uint8Array);
        this.srvChainActive = grow(this.srvChainActive, Uint8Array);
        this.combatLevels = grow(this.combatLevels, Uint8Array);
        this.teams = grow(this.teams, Uint8Array);
        this.overheadColorId = grow(this.overheadColorId, Uint8Array);
        this.overheadEffect = grow(this.overheadEffect, Uint8Array);
        this.overheadCycle = grow(this.overheadCycle, Uint16Array);
        this.overheadDuration = grow(this.overheadDuration, Uint16Array);
        this.overheadModIcon = grow(this.overheadModIcon, Int16Array);
        this.headIconPrayer = grow(this.headIconPrayer, Int8Array);
        this.headIconPk = grow(this.headIconPk, Int8Array);
        this.colorOverrideHue = grow(this.colorOverrideHue, Uint8Array);
        this.colorOverrideSat = grow(this.colorOverrideSat, Uint8Array);
        this.colorOverrideLum = grow(this.colorOverrideLum, Uint8Array);
        this.colorOverrideAmount = grow(this.colorOverrideAmount, Uint8Array);
        this.colorOverrideStartCycle = grow(this.colorOverrideStartCycle, Int32Array);
        this.colorOverrideEndCycle = grow(this.colorOverrideEndCycle, Int32Array);
        // Server interpolation buffers
        // Interaction indices
        this.interactionIndex = grow(this.interactionIndex, Int32Array);
        const prevOccPlane = this.occPlane;
        this.occTileX = grow(this.occTileX, Uint8Array);
        this.occTileY = grow(this.occTileY, Uint8Array);
        this.occPlane = grow(this.occPlane, Uint8Array);
        this.occMapX = grow(this.occMapX, Uint8Array);
        this.occMapY = grow(this.occMapY, Uint8Array);
        // initialize new slots as 255 (uninitialized)
        if (prevOccPlane !== this.occPlane) {
            for (let i = this.capacity; i < newCap; i++) this.occPlane[i] = 255;
        }
        // Initialize new interaction entries
        for (let i = this.capacity; i < newCap; i++) {
            if (this.interactionIndex) this.interactionIndex[i] = NO_INTERACTION;
        }
        const initAnimArray = (arr: Int32Array | undefined) => {
            if (!arr) return;
            for (let i = oldCap; i < newCap; i++) arr[i] = -1;
        };
        initAnimArray(this.animIdleSeq);
        initAnimArray(this.animWalkSeq);
        initAnimArray(this.animWalkBackSeq);
        initAnimArray(this.animWalkLeftSeq);
        initAnimArray(this.animWalkRightSeq);
        initAnimArray(this.animRunSeq);
        initAnimArray(this.animRunBackSeq);
        initAnimArray(this.animRunLeftSeq);
        initAnimArray(this.animRunRightSeq);
        initAnimArray(this.animCrawlSeq);
        initAnimArray(this.animCrawlBackSeq);
        initAnimArray(this.animCrawlLeftSeq);
        initAnimArray(this.animCrawlRightSeq);
        initAnimArray(this.animTurnLeftSeq);
        initAnimArray(this.animTurnRightSeq);
        this.capacity = newCap;

        for (let i = oldCap; i < newCap; i++) {
            this.faceSubX[i] = -1;
            this.faceSubY[i] = -1;
            this.faceDir[i] = -1;
            this.faceInstant[i] = 0;
            this.overheadColorId[i] = 0;
            this.overheadEffect[i] = 0;
            this.overheadCycle[i] = 0;
            this.overheadDuration[i] = 0;
            this.overheadModIcon[i] = -1;
            this.overheadText[i] = undefined;
            this.headIconPrayer[i] = -1;
            this.headIconPk[i] = -1;
        }
    }

    size(): number {
        return this.count;
    }

    getX(i: number): number {
        return this.x[i] | 0;
    }
    getY(i: number): number {
        return this.y[i] | 0;
    }
    getPrevX(i: number): number {
        return this.prevX[i] | 0;
    }
    getPrevY(i: number): number {
        return this.prevY[i] | 0;
    }
    getLevel(i: number): number {
        return this.level[i] | 0;
    }
    setLevel(i: number, lvl: number): void {
        const v = (lvl | 0) & 3;
        this.level[i] = v;
        // Keep occupancy plane coherent for debugging/devoverlay queries
        if (this.occPlane) this.occPlane[i] = v & 255;
    }
    getRotation(i: number): number {
        return this.rotation[i] | 0;
    }
    getTargetRotation(i: number): number {
        return this.targetRot[i] | 0;
    }

    // Rotation counter (field1239): tracks consecutive ticks rotating for turn animation delay
    getRotationCounter(i: number): number {
        return this.rotationCounter[i] | 0;
    }
    incrementRotationCounter(i: number): void {
        this.rotationCounter[i] = Math.min(255, (this.rotationCounter[i] ?? 0) + 1);
    }
    resetRotationCounter(i: number): void {
        this.rotationCounter[i] = 0;
    }

    // Movement delay counter (field1245): accumulated delay from blocking sequences
    getMovementDelayCounter(i: number): number {
        return this.movementDelayCounter[i] | 0;
    }
    incrementMovementDelay(i: number): void {
        this.movementDelayCounter[i] = Math.min(255, (this.movementDelayCounter[i] ?? 0) + 1);
    }
    decrementMovementDelay(i: number): void {
        if (this.movementDelayCounter[i] > 0) {
            this.movementDelayCounter[i]--;
        }
    }
    resetMovementDelay(i: number): void {
        this.movementDelayCounter[i] = 0;
    }

    // Animation sequence delay (sequenceDelay): ticks before action sequence starts
    getAnimSeqDelay(i: number): number {
        return (this.animSeqDelay?.[i] ?? 0) | 0;
    }
    setAnimSeqDelay(i: number, delay: number): void {
        if (this.animSeqDelay) this.animSeqDelay[i] = Math.max(0, delay | 0) & 0xff;
    }
    decrementAnimSeqDelay(i: number): void {
        if (this.animSeqDelay && this.animSeqDelay[i] > 0) {
            this.animSeqDelay[i]--;
        }
    }

    // Animation loop counter (field1220): tracks loops for action sequences
    getAnimLoopCounter(i: number): number {
        return (this.animLoopCounter?.[i] ?? 0) | 0;
    }
    setAnimLoopCounter(i: number, count: number): void {
        if (this.animLoopCounter) this.animLoopCounter[i] = Math.max(0, count | 0) & 0xff;
    }
    incrementAnimLoopCounter(i: number): void {
        if (this.animLoopCounter) {
            this.animLoopCounter[i] = Math.min(255, (this.animLoopCounter[i] ?? 0) + 1);
        }
    }
    resetAnimLoopCounter(i: number): void {
        if (this.animLoopCounter) this.animLoopCounter[i] = 0;
    }

    // Forced movement steps (field1215): remaining forced movement steps
    getForcedMovementSteps(i: number): number {
        return (this.forcedMovementSteps?.[i] ?? 0) | 0;
    }
    setForcedMovementSteps(i: number, steps: number): void {
        if (this.forcedMovementSteps) this.forcedMovementSteps[i] = Math.max(0, steps | 0) & 0xff;
    }
    decrementForcedMovementSteps(i: number): void {
        if (this.forcedMovementSteps && this.forcedMovementSteps[i] > 0) {
            this.forcedMovementSteps[i]--;
        }
    }

    // OSRS Forced Movement System - Accessor methods
    // Reference: player-animation.md lines 999-1048
    startForcedMovement(
        i: number,
        startCycle: number,
        endCycle: number,
        startX: number,
        startY: number,
        endX: number,
        endY: number,
        targetRot: number,
    ): void {
        this.forcedMoveStartCycle[i] = startCycle >>> 0;
        this.forcedMoveEndCycle[i] = endCycle >>> 0;
        this.forcedMoveStartX[i] = startX | 0;
        this.forcedMoveStartY[i] = startY | 0;
        this.forcedMoveEndX[i] = endX | 0;
        this.forcedMoveEndY[i] = endY | 0;
        this.forcedMoveTargetRot[i] = (targetRot & 2047) | 0;
    }

    isForcedMovementActive(i: number, currentCycle: number): boolean {
        const endCycle = this.forcedMoveEndCycle?.[i] ?? 0;
        return endCycle > 0 && currentCycle <= endCycle;
    }

    getForcedMoveStartCycle(i: number): number {
        return (this.forcedMoveStartCycle?.[i] ?? 0) >>> 0;
    }

    getForcedMoveEndCycle(i: number): number {
        return (this.forcedMoveEndCycle?.[i] ?? 0) >>> 0;
    }

    clearForcedMovement(i: number): void {
        if (this.forcedMoveStartCycle) this.forcedMoveStartCycle[i] = 0;
        if (this.forcedMoveEndCycle) this.forcedMoveEndCycle[i] = 0;
        if (this.forcedMoveStartX) this.forcedMoveStartX[i] = 0;
        if (this.forcedMoveStartY) this.forcedMoveStartY[i] = 0;
        if (this.forcedMoveEndX) this.forcedMoveEndX[i] = 0;
        if (this.forcedMoveEndY) this.forcedMoveEndY[i] = 0;
        if (this.forcedMoveTargetRot) this.forcedMoveTargetRot[i] = 0;
    }

    // Color override (damage/poison/freeze tints)
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
            this.colorOverrideStartCycle[i] = startCycle | 0;
        if (this.colorOverrideEndCycle) this.colorOverrideEndCycle[i] = endCycle | 0;
    }
    clearColorOverride(i: number): void {
        if (this.colorOverrideAmount) this.colorOverrideAmount[i] = 0;
    }

    /**
     * Apply color override from ECS to a model object, checking cycle timing.
     * Reference: player-animation.md lines 1158-1166
     *
     * @param i Player ECS index
     * @param model Model to apply override to
     * @param currentCycle Current game cycle for timing check
     */
    applyColorOverrideToModel(i: number, model: any, currentCycle: number): void {
        const override = this.getColorOverride(i);

        // Check if override is active and within timing window
        if (
            override.amount !== 0 &&
            currentCycle >= override.startCycle &&
            currentCycle < override.endCycle
        ) {
            model.overrideHue = override.hue;
            model.overrideSaturation = override.sat;
            model.overrideLuminance = override.lum;
            model.overrideAmount = override.amount;
        } else {
            // Clear override if not active
            model.overrideAmount = 0;
        }
    }

    getAnimTick(i: number): number {
        return this.animTick[i] | 0;
    }

    // Animation state accessors
    getAnimSeqId(i: number): number {
        return this.animSeqId[i] | 0;
    }
    setAnimSeqId(i: number, seqId: number): void {
        const next = seqId | 0;
        this.animSeqId[i] = next;
        // Keep the action-channel mirror in sync; rendering uses action+movement layering.
        if (this.animActionSeqId) this.animActionSeqId[i] = next;
        // OSRS parity: when assigning an action sequence, snapshot current pathLength into field1215.
        // Reference: Client.java (NPC sequence update sets field1215 = pathLength).
        if (next >= 0) {
            const idleSeq = this.animIdleSeq[i] | 0;
            const walkSeq = this.animWalkSeq[i] | 0;
            const walkBackSeq = this.animWalkBackSeq[i] | 0;
            const walkLeftSeq = this.animWalkLeftSeq[i] | 0;
            const walkRightSeq = this.animWalkRightSeq[i] | 0;
            const runSeq = this.animRunSeq[i] | 0;
            const runBackSeq = this.animRunBackSeq[i] | 0;
            const runLeftSeq = this.animRunLeftSeq[i] | 0;
            const runRightSeq = this.animRunRightSeq[i] | 0;
            const crawlSeq = this.animCrawlSeq[i] | 0;
            const crawlBackSeq = this.animCrawlBackSeq[i] | 0;
            const crawlLeftSeq = this.animCrawlLeftSeq[i] | 0;
            const crawlRightSeq = this.animCrawlRightSeq[i] | 0;
            const isMovementSeq =
                next === idleSeq ||
                next === walkSeq ||
                next === walkBackSeq ||
                next === walkLeftSeq ||
                next === walkRightSeq ||
                next === runSeq ||
                next === runBackSeq ||
                next === runLeftSeq ||
                next === runRightSeq ||
                next === crawlSeq ||
                next === crawlBackSeq ||
                next === crawlLeftSeq ||
                next === crawlRightSeq;
            if (!isMovementSeq) {
                // OSRS parity: Reset animTick when a new action sequence starts.
                // This ensures animations always start from frame 0, preventing
                // "partial playback" where animations appear to start mid-way.
                this.animTick[i] = 0;

                let pathLength = 0;
                try {
                    const tVal = (this.srvT?.[i] as number) ?? 1.0;
                    if (tVal < 1.0) pathLength++;
                } catch {}
                try {
                    pathLength += this._queueLen(i) | 0;
                } catch {}
                this.forcedMovementSteps[i] = Math.max(0, Math.min(255, pathLength | 0)) & 0xff;
            }
        } else {
            // Clearing the sequence clears the "sequence started moving" counter.
            this.forcedMovementSteps[i] = 0;
            if (this.animSeqDelay) this.animSeqDelay[i] = 0;
            if (this.animActionSeqId) this.animActionSeqId[i] = -1;
            // Reset animTick when clearing to ensure next animation starts from frame 0
            this.animTick[i] = 0;
            this.animSeqFrame[i] = 0;
            this.animSeqFrameCycle[i] = 0;
        }
    }

    // Action sequence frame state (mirrors Actor.sequenceFrame/sequenceFrameCycle)
    getAnimSeqFrame(i: number): number {
        return this.animSeqFrame[i] | 0;
    }
    setAnimSeqFrame(i: number, frame: number): void {
        this.animSeqFrame[i] = frame | 0;
    }
    getAnimSeqFrameCycle(i: number): number {
        return this.animSeqFrameCycle[i] | 0;
    }
    setAnimSeqFrameCycle(i: number, cycle: number): void {
        this.animSeqFrameCycle[i] = cycle | 0;
    }

    // Dual-sequence tracking for animation blending
    getAnimActionSeqId(i: number): number {
        return this.animActionSeqId[i] | 0;
    }
    setAnimActionSeqId(i: number, seqId: number): void {
        const next = seqId | 0;
        this.animActionSeqId[i] = next;
        // Keep legacy `animSeqId` (action `sequence`) in sync for movement blocking/parity logic.
        this.animSeqId[i] = next;
    }

    getAnimMovementSeqId(i: number): number {
        return this.animMovementSeqId[i] | 0;
    }
    setAnimMovementSeqId(i: number, seqId: number): void {
        this.animMovementSeqId[i] = seqId | 0;
    }

    /**
     * Check if two sequences can be blended based on their skeleton masks.
     * Returns true if masks are non-overlapping (compatible for blending).
     *
     * OSRS blending rules:
     * - If either sequence has no masks (undefined/null), it affects ALL bones → cannot blend
     * - If masks are defined but don't overlap, sequences can blend
     *
     * Example: Combat attack [0,1,2] + Walk [3,4] = compatible, can blend
     *          Combat attack [0,1,2] + Idle (no mask) = incompatible, cannot blend
     */
    canBlendSequences(
        actionMasks: number[] | undefined,
        movementMasks: number[] | undefined,
    ): boolean {
        // If either sequence has no masks, it affects all bones → cannot blend
        if (!actionMasks || actionMasks.length === 0) return false;
        if (!movementMasks || movementMasks.length === 0) return false;

        // Optimized for small arrays (common case: masks have 2-5 elements)
        // Avoid Set creation overhead for tiny arrays
        const actionLen = actionMasks.length;
        const movementLen = movementMasks.length;

        if (actionLen <= 4 && movementLen <= 4) {
            // Fast path: nested loop for small arrays (faster than Set for n <= 4)
            for (let i = 0; i < actionLen; i++) {
                const actionMask = actionMasks[i];
                for (let j = 0; j < movementLen; j++) {
                    if (actionMask === movementMasks[j]) {
                        return false; // Overlap found
                    }
                }
            }
            return true;
        }

        // Slow path: use Set for larger arrays
        const actionSet = new Set(actionMasks);
        for (const maskGroup of movementMasks) {
            if (actionSet.has(maskGroup)) {
                return false; // Overlap found, cannot blend
            }
        }

        return true; // No overlap, can blend
    }

    // Increment forced movement counter (used when animations delay movement)
    // When >0, speeds up to 8 pixels to catch up after animation-induced delays
    incrementForcedMovement(i: number): void {
        this.forcedMovementCounter[i] = Math.min(255, (this.forcedMovementCounter[i] ?? 0) + 1);
    }

    getAnimFrameCount(i: number): number {
        return this.animFrameCount[i] | 0;
    }
    setAnimFrameCount(i: number, count: number): void {
        this.animFrameCount[i] = Math.max(1, count | 0);
    }

    isAnimSkeletal(i: number): boolean {
        return this.animIsSkeletal[i] === 1;
    }
    setAnimSkeletal(i: number, skeletal: boolean): void {
        this.animIsSkeletal[i] = skeletal ? 1 : 0;
    }

    getAnimBasePivot(i: number): { x: number; z: number } {
        return {
            x: this.animBaseCenterX[i] | 0,
            z: this.animBaseCenterZ[i] | 0,
        };
    }
    setAnimBasePivot(i: number, x: number, z: number): void {
        this.animBaseCenterX[i] = x | 0;
        this.animBaseCenterZ[i] = z | 0;
    }

    getAnimPhaseBias(i: number): number {
        return this.animPhaseBias[i] || 0.0;
    }
    setAnimPhaseBias(i: number, bias: number): void {
        this.animPhaseBias[i] = Math.max(0, Math.min(1, bias));
    }

    setOverheadChat(
        index: number,
        opts: {
            text: string;
            color?: number;
            effect?: number;
            modIcon?: number;
            duration?: number;
            pattern?: Int32Array | undefined;
        },
    ): void {
        this.overheadText[index] = opts.text;
        const colorId = Math.max(0, Math.min(255, opts.color ?? 0)) | 0;
        const effectId = Math.max(0, Math.min(255, opts.effect ?? 0)) | 0;
        const duration = Math.max(1, Math.min(65535, opts.duration ?? 150)) | 0;
        const modIcon = opts.modIcon != null ? opts.modIcon | 0 : -1;
        this.overheadColorId[index] = colorId;
        this.overheadEffect[index] = effectId;
        this.overheadDuration[index] = duration;
        this.overheadCycle[index] = duration;
        this.overheadModIcon[index] = modIcon;
        (this.overheadPattern ?? (this.overheadPattern = []))[index] = opts.pattern;
    }

    clearOverheadChat(index: number): void {
        this.overheadText[index] = undefined;
        if (this.overheadColorId) this.overheadColorId[index] = 0;
        if (this.overheadEffect) this.overheadEffect[index] = 0;
        if (this.overheadDuration) this.overheadDuration[index] = 0;
        if (this.overheadCycle) this.overheadCycle[index] = 0;
        if (this.overheadModIcon) this.overheadModIcon[index] = -1;
        if (this.overheadPattern) this.overheadPattern[index] = undefined;
    }

    getOverheadChat(index: number):
        | {
              text: string;
              color: number;
              effect: number;
              modIcon: number;
              remaining: number;
              duration: number;
              pattern?: Int32Array;
          }
        | undefined {
        const text = this.overheadText[index];
        if (!text || text.length === 0) return undefined;
        const remaining = this.overheadCycle?.[index] ?? 0;
        if (remaining <= 0) return undefined;
        const duration = this.overheadDuration?.[index] ?? remaining;
        return {
            text,
            color: this.overheadColorId?.[index] ?? 0,
            effect: this.overheadEffect?.[index] ?? 0,
            modIcon: this.overheadModIcon?.[index] ?? -1,
            remaining,
            duration: duration > 0 ? duration : remaining,
            pattern: this.overheadPattern?.[index],
        };
    }

    // Head icon (prayer/pk overhead) getters and setters
    // Reference: Player.java lines 26-33, 171-172, 202-203
    getHeadIconPrayer(index: number): number {
        // First check appearance headIcons (synced from server appearance updates)
        const appearance = this.appearances[index];
        if (appearance?.headIcons?.prayer !== undefined) {
            return appearance.headIcons.prayer | 0;
        }
        // Fallback to legacy array
        return (this.headIconPrayer?.[index] ?? -1) | 0;
    }

    setHeadIconPrayer(index: number, iconId: number): void {
        if (this.headIconPrayer) this.headIconPrayer[index] = (iconId | 0) & 0x7f;
    }

    getHeadIconPk(index: number): number {
        return (this.headIconPk?.[index] ?? -1) | 0;
    }

    setHeadIconPk(index: number, iconId: number): void {
        if (this.headIconPk) this.headIconPk[index] = (iconId | 0) & 0x7f;
    }

    /**
     * Get animation phase based on distance traveled (0..1 cycles per tile)
     * This creates smooth foot-planting that matches actual movement speed
     */
    getAnimPhaseFromDistance(i: number): number {
        const dist = this.animDistTraveled?.[i] || 0;
        // OSRS uses consistent cycle lengths for walk/run
        // Walking: 1 cycle per tile (128 units)
        // Running: 1 cycle per tile (128 units) with faster playback
        // The speed difference is handled by animation frame rate, not cycle length
        const cycleLength = 128;
        return (dist / cycleLength) % 1.0;
    }

    /**
     * Update distance traveled for animation phase calculation
     * Improved to handle diagonal movement correctly
     */
    private updateAnimDistance(i: number, deltaX: number, deltaY: number): void {
        // Use euclidean distance for accurate diagonal foot planting
        const euclidDelta = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        this.animDistTraveled[i] = ((this.animDistTraveled[i] || 0) + euclidDelta) % 256; // Wrap at 2 tiles for tight sync
    }

    private resetAnimSet(i: number): void {
        if (i < 0 || i >= this.capacity) return;
        this.animIdleSeq[i] = -1;
        this.animWalkSeq[i] = -1;
        this.animWalkBackSeq[i] = -1;
        this.animWalkLeftSeq[i] = -1;
        this.animWalkRightSeq[i] = -1;
        this.animRunSeq[i] = -1;
        this.animRunBackSeq[i] = -1;
        this.animRunLeftSeq[i] = -1;
        this.animRunRightSeq[i] = -1;
        this.animCrawlSeq[i] = -1;
        this.animCrawlBackSeq[i] = -1;
        this.animCrawlLeftSeq[i] = -1;
        this.animCrawlRightSeq[i] = -1;
        this.animTurnLeftSeq[i] = -1;
        this.animTurnRightSeq[i] = -1;
    }

    private applyAnimSetValues(i: number, set?: PlayerAnimSet): void {
        if (!set) return;
        const assign = (arr: Int32Array, val: number | undefined) => {
            if (typeof val === "number" && val >= 0) arr[i] = val | 0;
        };
        assign(this.animIdleSeq, set.idle);
        assign(this.animWalkSeq, set.walk);
        assign(this.animWalkBackSeq, set.walkBack);
        assign(this.animWalkLeftSeq, set.walkLeft);
        assign(this.animWalkRightSeq, set.walkRight);
        assign(this.animRunSeq, set.run);
        assign(this.animRunBackSeq, set.runBack);
        assign(this.animRunLeftSeq, set.runLeft);
        assign(this.animRunRightSeq, set.runRight);
        assign(this.animCrawlSeq, set.crawl);
        assign(this.animCrawlBackSeq, set.crawlBack);
        assign(this.animCrawlLeftSeq, set.crawlLeft);
        assign(this.animCrawlRightSeq, set.crawlRight);
        assign(this.animTurnLeftSeq, set.turnLeft);
        assign(this.animTurnRightSeq, set.turnRight);
    }

    setAnimSet(i: number, set?: PlayerAnimSet, opts: { mergeWithDefault?: boolean } = {}): void {
        if (!(i >= 0 && i < this.capacity)) return;
        this.resetAnimSet(i);
        if (opts.mergeWithDefault !== false) this.applyAnimSetValues(i, this.defaultAnimSet);
        this.applyAnimSetValues(i, set);
        // Ensure movementSequence starts at idle immediately (OSRS resets this every cycle).
        try {
            const idle = this.animIdleSeq[i] | 0;
            if (idle >= 0) this.animMovementSeqId[i] = idle | 0;
        } catch {}
    }

    setDefaultAnimSet(set: PlayerAnimSet): void {
        this.defaultAnimSet = { ...set };
        for (let i = 0; i < this.count; i++)
            this.setAnimSet(i, undefined, { mergeWithDefault: true });
    }

    getAnimSeq(i: number, key: PlayerAnimKey): number {
        if (!(i >= 0 && i < this.capacity)) return -1;
        switch (key) {
            case "idle":
                return this.animIdleSeq[i] | 0;
            case "walk":
                return this.animWalkSeq[i] | 0;
            case "walkBack":
                return this.animWalkBackSeq[i] | 0;
            case "walkLeft":
                return this.animWalkLeftSeq[i] | 0;
            case "walkRight":
                return this.animWalkRightSeq[i] | 0;
            case "run":
                return this.animRunSeq[i] | 0;
            case "runBack":
                return this.animRunBackSeq[i] | 0;
            case "runLeft":
                return this.animRunLeftSeq[i] | 0;
            case "runRight":
                return this.animRunRightSeq[i] | 0;
            case "crawl":
                return this.animCrawlSeq[i] | 0;
            case "crawlBack":
                return this.animCrawlBackSeq[i] | 0;
            case "crawlLeft":
                return this.animCrawlLeftSeq[i] | 0;
            case "crawlRight":
                return this.animCrawlRightSeq[i] | 0;
            case "turnLeft":
                return this.animTurnLeftSeq[i] | 0;
            case "turnRight":
                return this.animTurnRightSeq[i] | 0;
            default:
                return -1;
        }
    }

    // Player metadata accessors
    getName(i: number): string | undefined {
        return this.names[i];
    }
    setName(i: number, name: string | undefined): void {
        this.removeNameMapping(i);
        this.names[i] = name;
        if (name) this.nameToIndex.set(name.toLowerCase(), i);
    }

    findIndexByName(name: string | undefined | null): number | undefined {
        if (!name) return undefined;
        return this.nameToIndex.get(String(name).toLowerCase());
    }

    getAppearance(i: number): PlayerAppearance | undefined {
        return this.appearances[i];
    }
    setAppearance(i: number, appearance: PlayerAppearance | undefined): void {
        this.appearances[i] = appearance;
    }
    getCombatLevel(i: number): number {
        if (!(i >= 0 && i < this.capacity)) return 0;
        return this.combatLevels[i] | 0;
    }
    setCombatLevel(i: number, level: number): void {
        if (!(i >= 0 && i < this.capacity)) return;
        const normalized = Number.isFinite(level) ? level | 0 : 0;
        this.combatLevels[i] = normalized < 0 ? 0 : normalized > 126 ? 126 : normalized;
    }
    getTeam(i: number): number {
        if (!(i >= 0 && i < this.capacity)) return 0;
        return this.teams[i] | 0;
    }
    setTeam(i: number, team: number): void {
        if (!(i >= 0 && i < this.capacity)) return;
        const normalized = Number.isFinite(team) ? team | 0 : 0;
        this.teams[i] = normalized > 0 ? normalized & 0xff : 0;
    }
    getDefaultHeightTiles(i: number): number | undefined {
        const appearance = this.appearances[i];
        if (!appearance) return undefined;
        const key = this.getAppearanceCacheKey(appearance);
        return this.appearanceBaseCache.get(key)?.defaultHeightTiles;
    }

    private removeNameMapping(index: number): void {
        const current = this.names[index];
        if (!current) return;
        this.nameToIndex.delete(current.toLowerCase());
    }

    // Model cache accessors
    getBaseModel(i: number): any {
        return this.baseModels[i];
    }
    setBaseModel(i: number, model: any): void {
        this.baseModels[i] = model;
    }

    /**
     * Ensure a base model is available for this exact appearance. Builds and caches it
     * using the provided loaders, returns geometry and pivot info. The cache key is the
     * appearance hash so it is independent of player index.
     */
    ensureBaseForAppearance(
        app: PlayerAppearance,
        deps: {
            idkTypeLoader: any;
            objTypeLoader: any;
            modelLoader: any;
            textureLoader: any;
            npcTypeLoader: any;
            seqTypeLoader: any;
            seqFrameLoader: any;
            skeletalSeqLoader?: any;
            varManager?: any;
            basTypeLoader?: any;
        },
    ):
        | { baseModel: any; baseCenterX: number; baseCenterZ: number; defaultHeightTiles: number }
        | undefined {
        try {
            const key = this.getAppearanceCacheKey(app);
            const existing = this.appearanceBaseCache.get(key);
            if (existing) return existing;

            // Lazy-require to avoid heavy static deps and circular refs in the client
            const PlayerModelLoader =
                require("../../rs/config/player/PlayerModelLoader").PlayerModelLoader;
            const pml = new PlayerModelLoader(
                deps.idkTypeLoader,
                deps.objTypeLoader,
                deps.modelLoader,
                deps.textureLoader,
            );
            const base = pml.buildStaticModelFromEquipment(app, app.equip);
            if (!base) return undefined;

            // Align baseline and pivot to humanoid reference (NPC "man") for consistency
            try {
                const NpcModelLoader =
                    require("../../rs/config/npctype/NpcModelLoader").NpcModelLoader;
                const nml = new NpcModelLoader(
                    deps.npcTypeLoader,
                    deps.modelLoader,
                    deps.textureLoader,
                    deps.seqTypeLoader,
                    deps.seqFrameLoader,
                    deps.skeletalSeqLoader,
                    deps.varManager,
                );
                let manId = -1;
                const ncount = deps.npcTypeLoader.getCount();
                for (let id = 0; id < ncount; id++) {
                    const t: any = deps.npcTypeLoader.load(id);
                    if (t && typeof t.name === "string" && t.name.toLowerCase() === "man") {
                        manId = id;
                        break;
                    }
                }
                if (manId !== -1) {
                    const manType = deps.npcTypeLoader.load(manId);
                    const manModel = nml.getModel(manType, -1, -1);
                    if (manModel) {
                        try {
                            manModel.calculateBoundsCylinder();
                            base.calculateBoundsCylinder();
                            const dY = (manModel as any).bottomY - (base as any).bottomY;
                            if (dY !== 0) base.translate(0, dY, 0);
                        } catch {}
                        try {
                            manModel.calculateBounds();
                            base.calculateBounds();
                            const dX = ((manModel as any).xMid | 0) - ((base as any).xMid | 0);
                            const dZ = ((manModel as any).zMid | 0) - ((base as any).zMid | 0);
                            if ((dX | dZ) !== 0) base.translate(dX, 0, dZ);
                        } catch {}
                    }
                }
            } catch {}

            let defaultHeightTiles = 1.0;
            try {
                base.calculateBoundsCylinder();
                defaultHeightTiles = Math.max(0.5, ((base.height | 0) as number) / 128);
            } catch {}
            let cx = 0,
                cz = 0;
            try {
                base.calculateBounds();
                cx = (base as any).xMid | 0;
                cz = (base as any).zMid | 0;
            } catch {}

            const rec = { baseModel: base, baseCenterX: cx, baseCenterZ: cz, defaultHeightTiles };
            this.appearanceBaseCache.set(key, rec);
            return rec;
        } catch {
            return undefined;
        }
    }

    cleanupAppearanceCache(cacheKey?: string): void {
        if (cacheKey) this.appearanceBaseCache.delete(cacheKey);
        else this.appearanceBaseCache.clear();
    }

    private getAppearanceCacheKey(app: PlayerAppearance): string {
        const equipKey =
            app.getEquipKey?.() ??
            (Array.isArray(app.equip) ? app.equip.slice(0, 14).join(",") : "");
        return app.getCacheKey?.() ?? `${app.getHash?.().toString() ?? "0"}|${equipKey}`;
    }

    /**
     * Ensure base model is built for player index i based on its stored appearance.
     * Also stores the base model and pivot into ECS arrays for fast access.
     */
    ensureBaseForIndex(
        i: number,
        deps: {
            idkTypeLoader: any;
            objTypeLoader: any;
            modelLoader: any;
            textureLoader: any;
            npcTypeLoader: any;
            seqTypeLoader: any;
            seqFrameLoader: any;
            skeletalSeqLoader?: any;
            varManager?: any;
            basTypeLoader?: any;
        },
    ):
        | { baseModel: any; baseCenterX: number; baseCenterZ: number; defaultHeightTiles: number }
        | undefined {
        try {
            const app = this.getAppearance(i);
            if (!app) return undefined;
            const rec = this.ensureBaseForAppearance(app, deps);
            if (!rec) return undefined;
            this.setBaseModel(i, rec.baseModel);
            this.setAnimBasePivot(i, rec.baseCenterX | 0, rec.baseCenterZ | 0);
            // Hook player yaw params from BAS when available
            try {
                const bas = deps.basTypeLoader?.load?.(0);
                const rawSpeed = bas?.yawMaxSpeed;
                const rawAccel = bas?.yawAcceleration;
                const maxSpeed = Math.max(32, typeof rawSpeed === "number" ? rawSpeed | 0 : 0);
                const accel = Math.max(4, typeof rawAccel === "number" ? rawAccel | 0 : 0);
                this.setRotationParams(i, maxSpeed, accel);
            } catch {}
            return rec;
        } catch {
            return undefined;
        }
    }

    getModelIndicesCount(i: number): number {
        return this.modelIndicesCount[i] | 0;
    }
    setModelIndicesCount(i: number, count: number): void {
        this.modelIndicesCount[i] = count | 0;
    }

    getModelIndicesCountAlpha(i: number): number {
        return this.modelIndicesCountAlpha[i] | 0;
    }
    setModelIndicesCountAlpha(i: number, count: number): void {
        this.modelIndicesCountAlpha[i] = count | 0;
    }

    getStepParity(i: number): number {
        return this.stepParity?.[i] ? 1 : 0;
    }
    getTargetX(i: number): number {
        return this.targetX[i] | 0;
    }
    getTargetY(i: number): number {
        return this.targetY[i] | 0;
    }
    resetAnim(i: number): void {
        this.animTick[i] = 0;
    }
    setTargetXY(i: number, x: number, y: number): void {
        this.targetX[i] = x | 0;
        this.targetY[i] = y | 0;
    }
    // Movement/rotation config and state
    setTargetTile(i: number, tileX: number, tileY: number, running: boolean): void {
        this.targetX[i] = ((tileX | 0) << 7) + 64;
        this.targetY[i] = ((tileY | 0) << 7) + 64;
        this.running[i] = running ? 1 : 0;
        // Update desired orientation based on tile delta from current tile to new target tile
        const currTileX = (this.x[i] >> 7) | 0;
        const currTileY = (this.y[i] >> 7) | 0;
        let or = this.targetRot[i] | 0;
        if (currTileX < tileX) {
            if (currTileY < tileY) or = 1280;
            else if (currTileY > tileY) or = 1792;
            else or = 1536;
        } else if (currTileX > tileX) {
            if (currTileY < tileY) or = 768;
            else if (currTileY > tileY) or = 256;
            else or = 512;
        } else if (currTileY < tileY) or = 1024;
        else if (currTileY > tileY) or = 0;
        this.targetRot[i] = or & 2047;
    }
    isMoving(i: number): boolean {
        const t = (this.srvT?.[i] as number) ?? 1.0;
        if (t < 0.999) return true; // mid-segment
        // Check if we have queued steps (OSRS behavior - no artificial delay)
        let qlen = 0;
        try {
            qlen = this._queueLen(i) | 0;
            if (qlen > 0) return true;
        } catch {}
        // If we're only settling a tiny residual snap and there are no queued steps,
        // treat as idle immediately to avoid lingering walk/run for an extra tick.
        try {
            const snapping = ((this.srvSnapTicks?.[i] | 0) as number) > 0;
            if (snapping && qlen > 0) return true; // still chaining → keep moving
        } catch {}
        return false;
    }
    isRunning(i: number): boolean {
        return this.running[i] === 1;
    }
    // Visual run flag: prefer strong signals from current server segment over client intent.
    // When server-authoritative, we derive run from segment tile span or segment speed factor.
    // Otherwise, fall back to the running flag.
    isRunVisual(i: number): boolean {
        if (!this.serverInterpEnabled) return this.isRunning(i);
        try {
            const span = this.getServerSegTileSpan(i) | 0; // 1 or 2
            if (span >= 2) return true; // collapsed 2-tile segment => running
        } catch {}
        try {
            const f = (this.srvSegFactor?.[i] as number) || 1.0;
            if (f > 1.01) return true; // server indicated faster segment
        } catch {}
        // Fallback to client-provided running flag (obeys run toggle)
        return this.isRunning(i);
    }
    setSpeeds(i: number, walk: number, run: number): void {
        this.walkSpeed[i] = Math.max(1, walk | 0);
        this.runSpeed[i] = Math.max(this.walkSpeed[i], run | 0);
    }
    setWalkSpeedMultiplier(scale: number): void {
        const s = Number.isFinite(scale) ? (scale as number) : 1.0;
        this.walkSpeedMultiplier = Math.max(0.05, Math.min(8.0, s));
    }
    getWalkSpeedMultiplier(): number {
        return this.walkSpeedMultiplier;
    }
    setRunSpeedMultiplier(scale: number): void {
        const s = Number.isFinite(scale) ? (scale as number) : 1.0;
        this.runSpeedMultiplier = Math.max(0.05, Math.min(8.0, s));
    }
    getRunSpeedMultiplier(): number {
        return this.runSpeedMultiplier;
    }
    setRunning(i: number, running: boolean): void {
        this.running[i] = running ? 1 : 0;
    }
    getRotationSpeed(i: number): number {
        return this.rotationSpeed[i] | 0;
    }
    setRotationSpeed(i: number, rs: number): void {
        this.rotationSpeed[i] = (rs | 0) & 2047;
    }
    setRotationParams(i: number, maxSpeed: number, accel: number): void {
        this.rotationSpeed[i] = (maxSpeed | 0) & 2047;
        this.rotationAccel[i] = Math.max(1, accel | 0);
        this.rotationVel[i] = 0;
    }
    setRotationImmediate(i: number, rot: number): void {
        this.rotation[i] = (rot | 0) & 2047;
        this.rotationVel[i] = 0;
    }
    setTargetRot(i: number, rot: number): void {
        this.targetRot[i] = (rot | 0) & 2047;
    }

    setFaceTileSub(i: number, subX: number, subY: number): void {
        if (!(i >= 0 && i < this.capacity)) return;
        this.faceSubX[i] = subX | 0;
        this.faceSubY[i] = subY | 0;
    }

    setFaceDir(i: number, orientation: number, instant: boolean = false): void {
        if (!(i >= 0 && i < this.capacity)) return;
        this.faceDir[i] = (orientation | 0) & 2047;
        this.faceInstant[i] = instant ? 1 : 0;
    }

    private clearFaceOverrides(i: number): void {
        this.faceInstant[i] = 0;
        this.faceDir[i] = -1;
        this.faceSubX[i] = -1;
        this.faceSubY[i] = -1;
    }
    // Configure interpolation rate from server tick duration (ms). Client tick defaults to ~20 ms.
    setServerTickMs(ms: number): void {
        const perTick = Math.max(1, ms | 0);
        this.serverTickMs = perTick;
        const base = PlayerEcs.DEFAULT_SERVER_TICK_MS;
        const scale =
            base > 0
                ? Math.max(
                      PlayerEcs.MIN_SPEED_SCALE,
                      Math.min(PlayerEcs.MAX_SPEED_SCALE, base / perTick),
                  )
                : 1;
        this.speedScale = scale;
        this.updateServerStepPerClientTick();
    }

    setClientTickDurationMs(ms: number): void {
        this.clientTickDurationMs = Math.max(1, ms | 0);
        this.updateServerStepPerClientTick();
    }

    private updateServerStepPerClientTick(): void {
        const perTick = Math.max(1, this.serverTickMs | 0);
        const clientMs = Math.max(1, this.clientTickDurationMs | 0);
        // Advance interpolation from 0..1 over (serverTickMs / clientTickMs) client ticks
        this.srvStepPerClientTick = clientMs / perTick;
    }

    clearServerQueue(i: number): void {
        if (!this.serverInterpEnabled) return;
        if (!this.srvQueueLen || i < 0 || i >= this.capacity) return;
        this.srvQueueLen[i] = 0;
        this.srvQueueHead[i] = 0;
        this.srvQueueTail[i] = 0;
        if (this.srvT) this.srvT[i] = 1.0;
        if (this.srvOverrun) this.srvOverrun[i] = 0.0;
        if (this.srvChainActive) this.srvChainActive[i] = 0;
        if (this.movingHold) this.movingHold[i] = 0;
        if (this.srvSnapDX) this.srvSnapDX[i] = 0;
        if (this.srvSnapDY) this.srvSnapDY[i] = 0;
        if (this.srvSnapTicks) this.srvSnapTicks[i] = 0;
        if (this.srvPendingValid) this.srvPendingValid[i] = 0;
        const currX = this.x[i] | 0;
        const currY = this.y[i] | 0;
        if (this.srvLastX) this.srvLastX[i] = currX;
        if (this.srvLastY) this.srvLastY[i] = currY;
        if (this.srvNextX) this.srvNextX[i] = currX;
        if (this.srvNextY) this.srvNextY[i] = currY;
        if (this.targetX) this.targetX[i] = currX;
        if (this.targetY) this.targetY[i] = currY;
    }

    private _queuePush(i: number, x: number, y: number, factor: number, rotation?: number): void {
        const cap = PlayerEcs.MAX_INTERP_QUEUE;
        const off = i * cap;
        let head = this.srvQueueHead[i] | 0;
        let tail = this.srvQueueTail[i] | 0;
        let len = this.srvQueueLen[i] | 0;
        // If full, drop the oldest (advance head)
        if (len >= cap) {
            head = (head + 1) % cap;
            len = cap - 1;
        }
        this.srvQueueX[off + tail] = x | 0;
        this.srvQueueY[off + tail] = y | 0;
        this.srvQueueFactor[off + tail] = Math.max(0.5, factor || 1.0);
        this.srvQueueRot[off + tail] = typeof rotation === "number" ? rotation & 2047 : -1;
        tail = (tail + 1) % cap;
        len++;
        this.srvQueueHead[i] = head & 0xff;
        this.srvQueueTail[i] = tail & 0xff;
        this.srvQueueLen[i] = len & 0xff;
    }
    private _queueLen(i: number): number {
        return this.srvQueueLen[i] | 0;
    }
    private _queuePop(
        i: number,
    ): { x: number; y: number; factor: number; rotation?: number } | undefined {
        const cap = PlayerEcs.MAX_INTERP_QUEUE;
        const off = i * cap;
        let head = this.srvQueueHead[i] | 0;
        let len = this.srvQueueLen[i] | 0;
        if (len <= 0) return undefined;
        const x = this.srvQueueX[off + head] | 0;
        const y = this.srvQueueY[off + head] | 0;
        const factor = (this.srvQueueFactor[off + head] as number) || 1.0;
        const rot = this.srvQueueRot[off + head] | 0;
        const rotation = rot >= 0 ? rot & 2047 : undefined;
        head = (head + 1) % cap;
        len--;
        this.srvQueueHead[i] = head & 0xff;
        this.srvQueueLen[i] = len & 0xff;
        return { x, y, factor, rotation };
    }

    // Try to start a new interpolation segment if queued steps are available
    private _tryStartNextSegment(i: number): boolean {
        const qlen = this._queueLen(i);
        if (qlen === 0) {
            return false;
        }
        const next = this._queuePop(i);
        if (!next) return false;
        // Promote: last becomes previous next if available, else current position
        const hasNext = Number.isFinite(this.srvT?.[i] as any);
        let lastX: number;
        let lastY: number;
        if (hasNext) {
            lastX = this.srvNextX[i] | 0 || this.x[i] | 0;
            lastY = this.srvNextY[i] | 0 || this.y[i] | 0;
        } else {
            lastX = this.x[i] | 0;
            lastY = this.y[i] | 0;
        }

        // Trust server pathfinding - use segment as-is
        this.srvLastX[i] = lastX;
        this.srvLastY[i] = lastY;
        this.srvNextX[i] = next.x | 0;
        this.srvNextY[i] = next.y | 0;
        this.srvSegFactor[i] = Math.max(0.5, next.factor || 1.0);
        this.srvT[i] = 0.0;
        this.srvOverrun[i] = 0.0;
        this.movingHold[i] = 2;
        this.stepParity[i] ^= 1;
        this.srvSnapDX[i] = 0;
        this.srvSnapDY[i] = 0;
        this.srvSnapTicks[i] = 0;
        // Keep non-interp fallbacks coherent
        this.targetX[i] = next.x | 0;
        this.targetY[i] = next.y | 0;
        this.srvChainActive[i] = 1;

        return true;
    }

    private isActionSequenceBlockingMovement(i: number, pathLengthLike: number): boolean {
        if (!(pathLengthLike > 0)) return false;
        const currentSeq = this.animSeqId[i] | 0;
        if (currentSeq < 0) return false;
        const seqDelay = (this.animSeqDelay?.[i] ?? 0) | 0;
        if (seqDelay !== 0) return false;

        const seqType: any = this.seqTypeLoader?.load?.(currentSeq);
        if (!seqType) return false;

        const movingSnapshot = (this.forcedMovementSteps?.[i] ?? 0) | 0; // field1215
        const precedenceAnimating = (seqType.precedenceAnimating ?? -1) | 0;
        const priority = (seqType.priority ?? -1) | 0;
        return (
            (movingSnapshot > 0 && precedenceAnimating === 0) ||
            (movingSnapshot <= 0 && priority === 0)
        );
    }

    // Promote exactly one queued server step per tick for each player when not mid-segment.
    // OSRS behavior: process movement immediately when queued steps are available.
    onServerTick(): void {
        // No-op: interpolation segments are promoted in `updateClient()` so client-cycle logic
        // (including sequence-based movement blocking) is applied consistently.
    }
    updateClient(ticks: number = 1): void {
        for (let t = 0; t < ticks; t++) {
            // Increment game cycle counter (matches OSRS Client.cycle)
            this.clientCycle++;

            // Overhead chat duration matches official client: decrement each client tick
            if (this.overheadCycle) {
                for (const idx of this.indexToServerId.keys()) {
                    const i = idx | 0;
                    const remaining = this.overheadCycle[i] | 0;
                    if (remaining <= 0) continue;
                    const next = remaining - 1;
                    this.overheadCycle[i] = next;
                    if (next <= 0) this.clearOverheadChat(i);
                }
            }

            for (let i = 0; i < this.count; i++) {
                // OSRS parity: movementSequence resets to idleSequence each client cycle before
                // `GraphicsObject.method2141` / `PendingSpawn.method2449` selects walk/run/turn.
                try {
                    const idle = this.animIdleSeq[i] | 0;
                    if (idle >= 0) this.animMovementSeqId[i] = idle | 0;
                } catch {}
                // OSRS parity: `sequenceDelay` is decremented by the action-sequence controller
                // after sequence stepping (see `PlayerAnimController.tick`).

                // OSRS Forced Movement Interpolation (teleports, knockback)
                // Reference: player-animation.md lines 1024-1041
                // This BYPASSES normal pathfinding and directly sets position via interpolation
                // matching `ParamComposition.updateActorSequence` (forced-move branch).
                let forcedHandled = false;
                if (this.isForcedMovementActive(i, this.clientCycle)) {
                    const startCycle = this.forcedMoveStartCycle[i] >>> 0; // spotAnimation
                    const endCycle = this.forcedMoveEndCycle[i] >>> 0; // field1228
                    const currentCycle = this.clientCycle >>> 0;

                    if (currentCycle <= endCycle) {
                        forcedHandled = true;

                        const startX = this.forcedMoveStartX[i] | 0;
                        const startY = this.forcedMoveStartY[i] | 0;
                        const endX = this.forcedMoveEndX[i] | 0;
                        const endY = this.forcedMoveEndY[i] | 0;

                        // OSRS parity: forced movement resets movement delay counter (field1245).
                        this.movementDelayCounter[i] = 0;

                        // OSRS parity: forced movement sets `orientation = field1173`.
                        const targetRot = this.forcedMoveTargetRot[i] | 0;
                        this.targetRot[i] = targetRot & 2047;

                        if (startCycle >= currentCycle) {
                            // Stage 1: ease from current position to start tile by `startCycle`.
                            const denom = Math.max(1, (startCycle - currentCycle) | 0);
                            const cx = this.x[i] | 0;
                            const cy = this.y[i] | 0;
                            const dx = (startX - cx) | 0;
                            const dy = (startY - cy) | 0;
                            this.x[i] = (cx + Math.trunc(dx / denom)) | 0;
                            this.y[i] = (cy + Math.trunc(dy / denom)) | 0;
                        } else {
                            // Stage 2: interpolate from start→end over (endCycle-startCycle).
                            let shouldUpdate =
                                currentCycle === endCycle ||
                                (this.animSeqId[i] | 0) === -1 ||
                                ((this.animSeqDelay?.[i] ?? 0) | 0) !== 0;

                            if (!shouldUpdate) {
                                try {
                                    const seqId = this.animSeqId[i] | 0;
                                    const seqType: any = this.seqTypeLoader?.load?.(seqId);
                                    if (seqType && !seqType.isSkeletalSeq?.()) {
                                        const frame = this.animSeqFrame[i] | 0;
                                        const cycle = this.animSeqFrameCycle[i] | 0;
                                        const len = (seqType.frameLengths?.[frame] ?? 0) | 0;
                                        // Reference: `sequenceFrameCycle + 1 > frameLengths[sequenceFrame]`.
                                        shouldUpdate = ((cycle + 1) | 0) > len;
                                    } else {
                                        // Cached sequences (or missing) update every tick.
                                        shouldUpdate = true;
                                    }
                                } catch {
                                    shouldUpdate = true;
                                }
                            }

                            if (shouldUpdate) {
                                const total = (endCycle - startCycle) | 0;
                                const elapsed = (currentCycle - startCycle) | 0;
                                if (total > 0) {
                                    // OSRS: x = (elapsed * endX + startX * (total - elapsed)) / total
                                    this.x[i] = Math.trunc(
                                        (elapsed * endX + startX * (total - elapsed)) / total,
                                    );
                                    this.y[i] = Math.trunc(
                                        (elapsed * endY + startY * (total - elapsed)) / total,
                                    );
                                }
                            }

                            // Stage 2 snaps `rotation = orientation`.
                            this.rotation[i] = targetRot & 2047;
                        }
                    } else {
                        // Forced movement expired.
                        this.clearForcedMovement(i);
                    }
                }

                // Normal movement processing (only if NOT in forced movement)
                if (!forcedHandled && this.serverInterpEnabled) {
                    const snapTicks = this.srvSnapTicks?.[i] | 0;
                    if (snapTicks > 0) {
                        let dx = this.srvSnapDX[i] | 0;
                        let dy = this.srvSnapDY[i] | 0;
                        const ticksLeft = snapTicks;
                        const stepX =
                            dx === 0
                                ? 0
                                : Math.sign(dx) *
                                  Math.max(
                                      1,
                                      Math.floor((Math.abs(dx) + ticksLeft - 1) / ticksLeft),
                                  );
                        const stepY =
                            dy === 0
                                ? 0
                                : Math.sign(dy) *
                                  Math.max(
                                      1,
                                      Math.floor((Math.abs(dy) + ticksLeft - 1) / ticksLeft),
                                  );
                        this.x[i] = ((this.x[i] | 0) + stepX) | 0;
                        this.y[i] = ((this.y[i] | 0) + stepY) | 0;
                        dx -= stepX;
                        dy -= stepY;
                        this.srvSnapDX[i] = dx | 0;
                        this.srvSnapDY[i] = dy | 0;
                        const nextTicks = ticksLeft - 1;
                        this.srvSnapTicks[i] =
                            nextTicks > 0 && (dx !== 0 || dy !== 0) ? nextTicks : 0;
                        if (this.srvSnapTicks[i] === 0) {
                            this.srvSnapDX[i] = 0;
                            this.srvSnapDY[i] = 0;
                        }
                    }
                }
                // Promote the next queued segment at the start of the client cycle so rotation updates
                // can follow `GraphicsObject.method2141` (movement-facing) unless blocked by an action seq.
                try {
                    const tVal = (this.srvT?.[i] as number) ?? 1.0;
                    if (!(tVal < 1.0)) {
                        const queued = this._queueLen(i) | 0;
                        if (queued > 0) {
                            this._tryStartNextSegment(i);
                        }
                    }
                } catch {}
                // GraphicsObject.method2141: when there is no remaining path, field1245 resets to 0.
                // Keep this in sync with our derived "pathLength" (active segment + queued steps).
                try {
                    const pathLengthLike =
                        (((this.srvT?.[i] as number) ?? 1.0) < 1.0 ? 1 : 0) +
                        (this._queueLen(i) | 0);
                    if (pathLengthLike === 0) this.movementDelayCounter[i] = 0;
                } catch {}
                const cx = this.x[i] | 0;
                const cy = this.y[i] | 0;
                // store prev for interpolation
                this.prevX[i] = cx;
                this.prevY[i] = cy;
                // move towards target
                if (this.serverInterpEnabled) {
                    // Final-stop guard: if fully arrived with no queued steps or snap,
                    // drop any residual moving hold so idle can engage immediately.
                    try {
                        const tVal = (this.srvT?.[i] as number) ?? 1.0;
                        const qlen = this._queueLen(i) | 0;
                        const snapping = ((this.srvSnapTicks?.[i] | 0) as number) > 0;
                        if (!(tVal < 1.0) && qlen === 0 && !snapping) {
                            this.movingHold[i] = 0;
                        }
                    } catch {}
                    // If still no active segment and not enough buffered steps, hold position
                    try {
                        const tVal = (this.srvT?.[i] as number) ?? 1.0;
                        const queued = this._queueLen(i) | 0;
                        if (!(tVal < 1.0) && queued === 0) {
                            // accumulate overrun for animation phase continuity
                            this.srvOverrun[i] = Math.min(
                                4.0,
                                this.srvOverrun[i] + this.srvStepPerClientTick,
                            );
                            // OSRS parity: when pathLength==0, field1245 resets to 0.
                            // Reference: GraphicsObject.method2141 (lines 160-163).
                            this.movementDelayCounter[i] = 0;
                            // If there are no pending steps, drop the moving hold immediately so
                            // idle can engage as soon as we land on the final tile.
                            if (queued === 0) this.movingHold[i] = 0;
                            else if ((this.movingHold[i] | 0) > 0) this.movingHold[i]--;
                        }
                    } catch {}

                    const segT = (this.srvT?.[i] as number) ?? 1.0;
                    const hasSegment = segT < 1.0;
                    if (hasSegment) {
                        // Per-cycle movement stepping (OSRS `GraphicsObject.method2141`)
                        if (this.srvOverrun) {
                            // Decay overrun slower to smooth out jitter
                            this.srvOverrun[i] = Math.max(0, (this.srvOverrun[i] as number) - 0.1);
                        }
                        const segFactor = Math.max(0.5, (this.srvSegFactor?.[i] as number) || 1.0);
                        const nx = this.srvNextX[i] | 0;
                        const ny = this.srvNextY[i] | 0;

                        // OSRS parity: action sequences can block movement (GraphicsObject.method2141 early return).
                        let movementBlockedThisTick = false;
                        try {
                            const pathLengthLike =
                                (segT < 1.0 ? 1 : 0) + ((this._queueLen(i) | 0) as number);
                            movementBlockedThisTick = this.isActionSequenceBlockingMovement(
                                i,
                                pathLengthLike,
                            );
                        } catch {}
                        if (movementBlockedThisTick) {
                            this.incrementMovementDelay(i);
                        } else {
                            // Strict OSRS parity: speed and movementSequence selection follow
                            // GraphicsObject.method2141 (Java client).
                            //
                            // - movement orientation is derived from current->destination
                            // - turning penalty applies only when not interacting
                            // - pathLength thresholds use total remaining steps (including current)
                            // - traversal flags (class231) shift speed after base selection

                            const currX0 = this.x[i] | 0;
                            const currY0 = this.y[i] | 0;

                            // If the actor is more than 2 tiles away from the destination, the client
                            // snaps instantly to the target step (GraphicsObject.method2141 "else" branch)
                            // and does NOT switch movementSequence away from idleSequence.
                            const deltaX0 = (nx | 0) - (currX0 | 0);
                            const deltaY0 = (ny | 0) - (currY0 | 0);
                            const within256 =
                                deltaX0 <= 256 &&
                                deltaX0 >= -256 &&
                                deltaY0 <= 256 &&
                                deltaY0 >= -256;
                            if (!within256) {
                                // Snap instantly and avoid gliding by aligning prev as well.
                                this.prevX[i] = nx | 0;
                                this.prevY[i] = ny | 0;
                                this.x[i] = nx | 0;
                                this.y[i] = ny | 0;
                            }

                            let movementOrientation = 0;
                            // OSRS: orientation is updated only when the destination differs.
                            // When already at the destination, leave orientation unchanged (we fall back to targetRot).
                            if (currX0 === (nx | 0) && currY0 === (ny | 0)) {
                                movementOrientation = (this.targetRot[i] | 0) & 2047;
                            } else if (currX0 < nx) {
                                if (currY0 < ny) movementOrientation = 1280;
                                else if (currY0 > ny) movementOrientation = 1792;
                                else movementOrientation = 1536;
                            } else if (currX0 > nx) {
                                if (currY0 < ny) movementOrientation = 768;
                                else if (currY0 > ny) movementOrientation = 256;
                                else movementOrientation = 512;
                            } else if (currY0 < ny) movementOrientation = 1024;
                            else if (currY0 > ny) movementOrientation = 0;
                            movementOrientation &= 2047;

                            const rot = (this.rotation[i] | 0) & 2047;
                            const isInteracting = this.getInteractionIndex(i) !== NO_INTERACTION;
                            // OSRS: `method2141` writes `orientation` from movement when within256; later
                            // `method2449` may override it to face `targetIndex` (interactions).
                            if (
                                within256 &&
                                !isInteracting &&
                                ((currX0 | 0) !== (nx | 0) || (currY0 | 0) !== (ny | 0))
                            ) {
                                this.targetRot[i] = movementOrientation & 2047;
                            }

                            // Axis-wise stepping to match GraphicsObject.java: increment X and Y independently.
                            let cx2 = this.x[i] | 0;
                            let cy2 = this.y[i] | 0;
                            if (within256) {
                                // movementSequence base selection (walk/back/left/right) only when within 2 tiles.
                                let yaw = (movementOrientation - rot) & 2047;
                                if (yaw > 1024) yaw -= 2048;
                                const walkSeq = this.animWalkSeq[i] | 0;
                                const walkBackSeq = this.animWalkBackSeq[i] | 0;
                                const walkLeftSeq = this.animWalkLeftSeq[i] | 0;
                                const walkRightSeq = this.animWalkRightSeq[i] | 0;
                                const runSeq = this.animRunSeq[i] | 0;
                                const runBackSeq = this.animRunBackSeq[i] | 0;
                                const runLeftSeq = this.animRunLeftSeq[i] | 0;
                                const runRightSeq = this.animRunRightSeq[i] | 0;
                                const crawlSeq = this.animCrawlSeq[i] | 0;
                                const crawlBackSeq = this.animCrawlBackSeq[i] | 0;
                                const crawlLeftSeq = this.animCrawlLeftSeq[i] | 0;
                                const crawlRightSeq = this.animCrawlRightSeq[i] | 0;

                                let movementSeq = walkBackSeq;
                                // Exact boundary parity with `GraphicsObject.method2141`:
                                // - right strafe when 256 <= yaw < 768
                                // - left  strafe when -768 <= yaw <= -256
                                // (yaw==768 falls back to walkBack)
                                if (yaw >= -256 && yaw <= 256) movementSeq = walkSeq;
                                else if (yaw >= 256 && yaw < 768) movementSeq = walkRightSeq;
                                else if (yaw >= -768 && yaw <= -256) movementSeq = walkLeftSeq;
                                if (movementSeq === -1) movementSeq = walkSeq;

                                // pathLength: total remaining steps (including current), derived from the queue.
                                // Allows dynamic speed scaling per OSRS GraphicsObject.method2141 thresholds.
                                const pathLength =
                                    ((this.srvT?.[i] as number) ?? 1.0) < 1.0
                                        ? 1 + (this._queueLen(i) | 0)
                                        : this._queueLen(i) | 0;

                                // Base speed (var8)
                                let var8 = 4;
                                const turnPenalty =
                                    rot !== movementOrientation &&
                                    !isInteracting &&
                                    ((this.rotationSpeed[i] | 0) as number) !== 0;
                                if (turnPenalty) var8 = 2;
                                if (pathLength > 2) var8 = 6;
                                if (pathLength > 3) var8 = 8;
                                if ((this.movementDelayCounter[i] | 0) > 0 && pathLength > 1) {
                                    var8 = 8;
                                    this.decrementMovementDelay(i);
                                }

                                // Apply traversal (class231): 2 doubles, 0 halves (post base selection).
                                const traversal = segFactor >= 1.5 ? 2 : segFactor <= 0.5 ? 0 : 1;
                                if (traversal === 2) var8 = var8 << 1;
                                else if (traversal === 0) var8 = var8 >> 1;

                                // Upgrade/downgrade movementSequence based on var8 thresholds
                                if (var8 >= 8) {
                                    if (movementSeq === walkSeq && runSeq !== -1)
                                        movementSeq = runSeq;
                                    else if (movementSeq === walkBackSeq && runBackSeq !== -1)
                                        movementSeq = runBackSeq;
                                    else if (movementSeq === walkLeftSeq && runLeftSeq !== -1)
                                        movementSeq = runLeftSeq;
                                    else if (movementSeq === walkRightSeq && runRightSeq !== -1)
                                        movementSeq = runRightSeq;
                                } else if (var8 <= 2) {
                                    if (movementSeq === walkSeq && crawlSeq !== -1)
                                        movementSeq = crawlSeq;
                                    else if (movementSeq === walkBackSeq && crawlBackSeq !== -1)
                                        movementSeq = crawlBackSeq;
                                    else if (movementSeq === walkLeftSeq && crawlLeftSeq !== -1)
                                        movementSeq = crawlLeftSeq;
                                    else if (movementSeq === walkRightSeq && crawlRightSeq !== -1)
                                        movementSeq = crawlRightSeq;
                                }

                                // movementSequence is separate from the action `sequence` and can change
                                // even while an action animation is playing.
                                if (movementSeq >= 0) this.animMovementSeqId[i] = movementSeq | 0;

                                // GraphicsObject.method2141 uses fixed per-cycle steps (var8).
                                const pixelStep = Math.max(1, var8 | 0);

                                if (cx2 !== (nx | 0) || cy2 !== (ny | 0)) {
                                    if (cx2 < nx) cx2 = Math.min(nx, cx2 + (pixelStep | 0));
                                    else if (cx2 > nx) cx2 = Math.max(nx, cx2 - (pixelStep | 0));
                                    if (cy2 < ny) cy2 = Math.min(ny, cy2 + (pixelStep | 0));
                                    else if (cy2 > ny) cy2 = Math.max(ny, cy2 - (pixelStep | 0));
                                }
                            }

                            // Update animation distance based on actual movement
                            const movedX = cx2 - (this.prevX[i] | 0);
                            const movedY = cy2 - (this.prevY[i] | 0);
                            // Only update anim distance if we actually moved (avoid drift during idle)
                            if (movedX !== 0 || movedY !== 0) {
                                this.updateAnimDistance(i, movedX, movedY);
                            }

                            this.x[i] = cx2 | 0;
                            this.y[i] = cy2 | 0;

                            const reached =
                                (this.x[i] | 0) === (nx | 0) && (this.y[i] | 0) === (ny | 0);
                            // Keep `srvT` as a simple in-flight flag (0..1) to avoid floating point hysteresis.
                            // Consumers only use `t < 1` vs `t >= 1`.
                            this.srvT[i] = reached ? 1.0 : 0.0;

                            // Update phase bias for smooth foot planting
                            this.animPhaseBias[i] = this.getAnimPhaseFromDistance(i);
                            // Handle post-arrival. Avoid freezing the animation by accumulating overrun when
                            // no pending next segment has arrived yet.
                            if (reached) {
                                // OSRS parity: decrement field1215 when a path step completes (GraphicsObject.method2141 end-of-step).
                                if ((this.forcedMovementSteps?.[i] ?? 0) > 0) {
                                    this.forcedMovementSteps[i] =
                                        ((this.forcedMovementSteps[i] | 0) - 1) & 0xff;
                                }
                                const remainX = (nx | 0) - (this.x[i] | 0);
                                const remainY = (ny | 0) - (this.y[i] | 0);
                                if (remainX !== 0 || remainY !== 0) {
                                    this.srvSnapDX[i] =
                                        Math.max(-32768, Math.min(32767, remainX)) | 0;
                                    this.srvSnapDY[i] =
                                        Math.max(-32768, Math.min(32767, remainY)) | 0;
                                    const settle = Math.max(
                                        1,
                                        Math.min(
                                            8,
                                            Math.ceil(
                                                Math.max(Math.abs(remainX), Math.abs(remainY)) / 8,
                                            ),
                                        ),
                                    );
                                    this.srvSnapTicks[i] = settle;
                                } else {
                                    this.srvSnapDX[i] = 0;
                                    this.srvSnapDY[i] = 0;
                                    this.srvSnapTicks[i] = 0;
                                    // Defensive clamp: ensure exact arrival on tile center when no residual remains.
                                    // This prevents rare off-center rounding from lingering exactly one frame.
                                    if (
                                        (this.x[i] | 0) !== (nx | 0) ||
                                        (this.y[i] | 0) !== (ny | 0)
                                    ) {
                                        this.x[i] = nx | 0;
                                        this.y[i] = ny | 0;
                                    }
                                }
                                // Promote next step immediately during chaining to avoid per-tile pauses
                                let startedNextSegment = false;
                                try {
                                    const qlen = this._queueLen(i) | 0;
                                    if (qlen > 0 && (this.srvChainActive?.[i] | 0) === 1) {
                                        startedNextSegment = this._tryStartNextSegment(i);
                                    }
                                } catch {}
                                if (!startedNextSegment && (this.srvPendingValid?.[i] | 0) === 1) {
                                    // Backward-compat: pending slot support (non-buffered path)
                                    this.srvLastX[i] = this.srvNextX[i] | 0;
                                    this.srvLastY[i] = this.srvNextY[i] | 0;
                                    this.srvNextX[i] = this.srvPendingX[i] | 0;
                                    this.srvNextY[i] = this.srvPendingY[i] | 0;
                                    this.srvSegFactor[i] = Math.max(
                                        0.5,
                                        (this.srvPendingFactor?.[i] as number) || 1.0,
                                    );
                                    this.srvPendingValid[i] = 0;
                                    this.srvT[i] = 0.0;
                                    this.srvOverrun[i] = 0.0;
                                    this.stepParity[i] ^= 1;
                                } else if (!startedNextSegment) {
                                    // If no further steps are queued, clear the moving hold immediately
                                    // so we can transition to idle on arrival without extra frames.
                                    const qlenNow = this._queueLen(i) | 0;
                                    if (qlenNow === 0) this.movingHold[i] = 0;
                                    else if ((this.movingHold[i] | 0) > 0) this.movingHold[i]--;
                                    // Mark chain as inactive when no queued steps
                                    if (qlenNow === 0) this.srvChainActive[i] = 0;
                                }
                            }
                        } // end movementBlockedThisTick else
                    } // end hasSegment
                }

                // PendingSpawn.method2449: apply face tile/direction, update rotation,
                // and optionally swap movementSequence to turn-left/right.
                try {
                    const pathLengthLike =
                        (((this.srvT?.[i] as number) ?? 1.0) < 1.0 ? 1 : 0) +
                        (this._queueLen(i) | 0);

                    // When idle or movement-delayed, apply face tile/direction once and clear.
                    // Reference: Actor.method2460 (called by PendingSpawn.method2449).
                    if (pathLengthLike === 0 || (this.movementDelayCounter[i] | 0) > 0) {
                        let faceOrientation = -1;
                        const fsx = this.faceSubX[i] | 0;
                        const fsy = this.faceSubY[i] | 0;
                        if (fsx >= 0 && fsy >= 0) {
                            const selfX = this.x[i] | 0;
                            const selfY = this.y[i] | 0;
                            if (selfX !== fsx || selfY !== fsy) {
                                faceOrientation = faceAngleRs(selfX, selfY, fsx, fsy) & 2047;
                            }
                        } else {
                            const dir = this.faceDir[i] | 0;
                            if (dir >= 0) faceOrientation = dir & 2047;
                        }

                        if (faceOrientation !== -1) {
                            this.targetRot[i] = faceOrientation & 2047;
                            if ((this.faceInstant[i] | 0) === 1) {
                                this.rotation[i] = faceOrientation & 2047;
                            }
                        }
                        this.clearFaceOverrides(i);
                    }

                    const orientation = (this.targetRot[i] | 0) & 2047;
                    const rot0 = (this.rotation[i] | 0) & 2047;
                    const diff = (orientation - rot0) & 2047; // var7
                    if (diff !== 0) {
                        this.incrementRotationCounter(i);
                        const dir = diff > 1024 ? -1 : 1; // var4
                        const turnStep = (this.rotationSpeed[i] | 0) & 2047; // field1240

                        let rot = rot0;
                        if (turnStep !== 0) {
                            rot = (rot + dir * turnStep + 2048) & 2047;
                        }

                        let stillTurning = true; // var12
                        if (turnStep !== 0 && (diff < turnStep || diff > 2048 - turnStep)) {
                            rot = orientation;
                            stillTurning = false;
                        }

                        this.rotation[i] = rot & 2047;
                        this.rotationVel[i] = turnStep & 0xffff;

                        if (
                            turnStep > 0 &&
                            (this.animIdleSeq[i] | 0) === (this.animMovementSeqId[i] | 0) &&
                            ((this.rotationCounter[i] | 0) > 25 || stillTurning)
                        ) {
                            const turnLeft = this.animTurnLeftSeq[i] | 0;
                            const turnRight = this.animTurnRightSeq[i] | 0;
                            let seq = -1;
                            if (dir === -1 && turnLeft !== -1) seq = turnLeft;
                            else if (dir === 1 && turnRight !== -1) seq = turnRight;
                            else seq = this.animWalkSeq[i] | 0;
                            if (seq >= 0) this.animMovementSeqId[i] = seq | 0;
                        }
                    } else {
                        this.resetRotationCounter(i);
                        if ((this.rotationVel[i] | 0) !== 0) this.rotationVel[i] = 0;
                    }
                } catch {}
                // advance animation accumulator (for parity/debug)
                this.animTick[i] = ((this.animTick[i] | 0) + 1) & 0xffff;

                // Update dwell ticks (for telemetry)
                try {
                    const cx = this.x[i] | 0;
                    const cy = this.y[i] | 0;
                    const txc = (cx >> 7) | 0;
                    const tyc = (cy >> 7) | 0;
                    const centered = (cx & 127) === 64 && (cy & 127) === 64;
                    if (centered) {
                        if ((this.dwellTileX[i] | 0) !== txc || (this.dwellTileY[i] | 0) !== tyc) {
                            this.dwellTileX[i] = txc;
                            this.dwellTileY[i] = tyc;
                            this.dwellTicks[i] = 0;
                        } else {
                            this.dwellTicks[i] = Math.min(0xffffffff, (this.dwellTicks[i] | 0) + 1);
                        }
                    } else {
                        this.dwellTicks[i] = Math.min(0xffffffff, (this.dwellTicks[i] | 0) + 1);
                    }
                } catch {}

                // Emit movement debug telemetry if enabled
                if (this.movementDebugEnabled) {
                    this._emitMovementDebug(i);
                }
            }
        }
    }

    setServerAuthoritative(enabled: boolean): void {
        // No-op: movement is always server-authoritative
    }

    // Called when a server position arrives: enqueue it for interpolation
    setServerPos(i: number, x: number, y: number, factor: number = 1, rotation?: number): void {
        this._queuePush(i, x | 0, y | 0, factor, rotation);
        // Segment promotion is handled in `updateClient` so movement blocking can suppress
        // target-rotation updates exactly like `GraphicsObject.method2141` early returns.
    }

    // Toggle movement debug telemetry. When enabled, a JSON row is emitted per entity per client tick.
    enableMovementDebug(enabled: boolean, sink?: (row: any) => void): void {
        this.movementDebugEnabled = !!enabled;
        this.movementDebugSink = typeof sink === "function" ? sink : undefined;
    }

    // Optional: provide real-time server clock so telemetry rows include tick/phase
    setTelemetryServerClockProvider(provider?: () => { tick: number; phase: number }): void {
        this.telemetryClockProvider = provider;
    }

    // Optional: tag telemetry rows with a source identifier for downstream analysis
    setTelemetrySampleSource(source: "clientTick" | "rendererFrame" | "serverTick"): void {
        this.telemetrySampleSource = source;
    }

    private _dirFromDelta(dx: number, dy: number): number | undefined {
        const sx = dx > 0 ? 1 : dx < 0 ? -1 : 0;
        const sy = dy > 0 ? 1 : dy < 0 ? -1 : 0;
        // Mapping: 0=SW,1=S,2=SE,3=W,4=E,5=NW,6=N,7=NE
        // OSRS coordinate system: North = +Y, South = -Y
        if (sx === -1 && sy === -1) return 0; // SW: dx=-1, dy=-1 (south = -Y)
        if (sx === 0 && sy === -1) return 1; // S: dx=0, dy=-1
        if (sx === 1 && sy === -1) return 2; // SE: dx=+1, dy=-1
        if (sx === -1 && sy === 0) return 3; // W: dx=-1, dy=0
        if (sx === 1 && sy === 0) return 4; // E: dx=+1, dy=0
        if (sx === -1 && sy === 1) return 5; // NW: dx=-1, dy=+1 (north = +Y)
        if (sx === 0 && sy === 1) return 6; // N: dx=0, dy=+1
        if (sx === 1 && sy === 1) return 7; // NE: dx=+1, dy=+1
        return undefined;
    }

    private _queuePeek(i: number): { x: number; y: number } | undefined {
        try {
            const cap = this.capacity | 0;
            if (i < 0 || i >= cap) return undefined;
            const off = (i | 0) * 32;
            let head = (this.srvQueueHead[i] | 0) & 0xff;
            const len = (this.srvQueueLen[i] | 0) & 0xff;
            if (len <= 0) return undefined;
            const x = this.srvQueueX[off + head] | 0;
            const y = this.srvQueueY[off + head] | 0;
            return { x, y };
        } catch {
            return undefined;
        }
    }

    private _emitMovementDebug(i: number): void {
        try {
            const x = this.x[i] | 0;
            const y = this.y[i] | 0;
            const tileX = (x >> 7) | 0;
            const tileY = (y >> 7) | 0;
            const worldX = x / 128.0;
            const worldY = y / 128.0;
            const rot = (this.rotation[i] | 0) & 2047;
            const targ = (this.targetRot[i] | 0) & 2047;
            const t = this.getServerStepT(i);
            const segTiles = this.getServerSegTileSpan(i) | 0;
            const over = this.getServerOverrun(i);
            const running = this.isRunning(i);
            const runVisual = this.isRunVisual(i);
            const moving = this.isMoving(i);
            const rotationDeg = rot * (360 / 2048);
            const lastX = (this.srvLastX?.[i] | 0) as number;
            const lastY = (this.srvLastY?.[i] | 0) as number;
            const nextX = (this.srvNextX?.[i] | 0) as number;
            const nextY = (this.srvNextY?.[i] | 0) as number;
            const dx = nextX - lastX;
            const dy = nextY - lastY;
            const moveDir = this._dirFromDelta(dx, dy);
            let turnDir: "left" | "right" | "none" = "none";
            let dYaw = ((targ - rot + 1024) & 2047) - 1024;
            if (dYaw > 0) turnDir = "right";
            else if (dYaw < 0) turnDir = "left";
            const turnTicks = (this.rotationCounter?.[i] | 0) as number;
            const dwellMs = (this.dwellTicks?.[i] | 0) * (this.clientTickDurationMs | 0);
            const qPeek = this._queuePeek(i);
            const destTileX = qPeek ? (qPeek.x >> 7) | 0 : undefined;
            const destTileY = qPeek ? (qPeek.y >> 7) | 0 : undefined;
            const cheb =
                destTileX !== undefined && destTileY !== undefined
                    ? Math.max(Math.abs((destTileX | 0) - tileX), Math.abs((destTileY | 0) - tileY))
                    : undefined;
            const pathQueueLength = (this._queueLen(i) | 0) as number;

            // Interaction snapshot (matches RuneLite dump shape loosely)
            let interactingType: string = "none";
            let interactingIndex: number = -1;
            let interactingNpcId: number = -1;
            let interactingName: string = "";
            try {
                const rawIdx = this.getInteractionIndex?.(i) ?? -1;
                if ((rawIdx | 0) >= 0) {
                    const info = decodeInteractionIndex(rawIdx | 0);
                    if (info) {
                        interactingType = info.type;
                        interactingIndex = info.id | 0;
                        if (info.type === "npc") interactingNpcId = info.id | 0;
                        if (info.type === "player") {
                            const targetEcs = this.getIndexForServerId?.(info.id | 0);
                            if (targetEcs !== undefined)
                                interactingName = this.getName(targetEcs) || "";
                        }
                    }
                }
            } catch {}

            // Current animation identifiers (best-effort)
            const poseSeq = this.getAnimSeqId?.(i) ?? -1;
            const actionSeq = this.getAnimActionSeqId?.(i) ?? -1;
            let movementSeq = this.getAnimMovementSeqId?.(i) ?? -1;
            if (movementSeq < 0) movementSeq = poseSeq | 0;
            const animationSeq = actionSeq >= 0 ? actionSeq | 0 : -1;
            // Frame indices are not tracked precisely yet; expose placeholders for diffing
            const poseFrame = -1;
            const movementFrame = -1;
            const msBetweenPoseFrameIncrements = -1.0;
            const msSincePoseFrameChange = -1.0;
            const msBetweenMovementFrameIncrements = -1.0;
            const msSinceMovementFrameChange = -1.0;

            const clock = this.telemetryClockProvider ? this.telemetryClockProvider() : undefined;
            const row: any = {
                id: this.indexToServerId.get(i),
                epochMs: Date.now(),
                renderTimeMs: (this.clientCycle | 0) * (this.clientTickDurationMs | 0),
                frame: this.clientCycle | 0,
                serverTick: clock && Number.isFinite(clock.tick) ? clock.tick | 0 : undefined,
                serverPhase: clock && Number.isFinite(clock.phase) ? (clock.phase as number) : t,
                worldX,
                worldY,
                subX: x,
                subY: y,
                tileX,
                tileY,
                plane: (this.level?.[i] | 0) as number,
                rotation: rot,
                targetRotation: targ,
                rotationDeg,
                orientation: targ,
                isMoving: moving,
                isRunning: running,
                isRunVisual: runVisual,
                stepT: t,
                segTiles,
                overrun: over,
                moveDir,
                direction: moveDir,
                turnTicks,
                turnDir,
                tileDwellMs: dwellMs,
                destTileX,
                destTileY,
                destDistCheb: cheb,
                pathLenHint: -1,
                pathQueueLength,
                // Interaction snapshot
                interactingType,
                interactingName,
                interactingIndex,
                interactingNpcId,
                // Animation snapshot
                animation: animationSeq,
                movementSeq,
                pose: poseSeq | 0,
                movementFrame,
                poseFrame,
                msBetweenPoseFrameIncrements,
                msSincePoseFrameChange,
                msBetweenMovementFrameIncrements,
                msSinceMovementFrameChange,
                // Spot animation (not tracked at ECS level)
                graphic: -1,
                sampleSource: this.telemetrySampleSource,
            };

            if (this.movementDebugSink) {
                this.movementDebugSink(row);
            } else if (typeof console !== "undefined") {
                // Default sink: console
                try {
                    console.log("mvdbg", row);
                } catch {}
            }
        } catch {
            // ignore telemetry errors
        }
    }
    // Expose current interpolation progress for player i (0..1). Returns 1 when disabled.
    getServerStepT(i: number): number {
        if (!this.serverInterpEnabled) return 1.0;
        const t = this.srvT?.[i];
        if (t == null || Number.isNaN(t)) return 1.0;
        return Math.max(0, Math.min(1, t as number));
    }

    // Extra local progress while waiting for the next server step.
    // Measured in step units (1.0 ~ one tile step). 0 when a next step is active.
    getServerOverrun(i: number): number {
        if (!this.serverInterpEnabled) return 0.0;
        const v = this.srvOverrun?.[i];
        if (v == null || Number.isNaN(v)) return 0.0;
        return Math.max(0, Math.min(4.0, v as number));
    }

    // Rough tile span of the current server interpolation segment for player i.
    // Returns 1 for single-tile segments and 2 for double-tile (run-collapsed) segments.
    // Computed using Chebyshev distance in sub-tile units to be robust for diagonals.
    getServerPathLengthLike(i: number): number {
        if (!(i >= 0 && i < this.capacity)) return 0;
        if (!this.serverInterpEnabled) return 0;
        const hasActiveSegment = ((this.srvT?.[i] as number) ?? 1.0) < 1.0 ? 1 : 0;
        return (hasActiveSegment + (this._queueLen(i) | 0)) | 0;
    }

    getServerSegTileSpan(i: number): number {
        if (!this.serverInterpEnabled) return 1;
        const lx = (this.srvLastX?.[i] | 0) as number;
        const ly = (this.srvLastY?.[i] | 0) as number;
        const nx = (this.srvNextX?.[i] | 0) as number;
        const ny = (this.srvNextY?.[i] | 0) as number;
        const dx = Math.abs(nx - lx);
        const dy = Math.abs(ny - ly);
        const cheb = Math.max(dx, dy);
        // Number of tile steps spanned by this segment (rounded to nearest 1 or 2)
        let steps = Math.max(1, Math.min(2, Math.round(cheb / 128)));
        // Some servers collapse double-step runs but keep endpoints within one-tile chebyshev
        // (e.g., diagonal compression). Treat explicit run-speed factors as a 2-tile span so
        // gait phase advances by half a cycle like the live client.
        try {
            if (steps === 1 && ((this.srvSegFactor?.[i] as number) || 1) > 1.01) steps = 2;
        } catch {}
        return steps | 0;
    }

    getClientCycle(): number {
        return this.clientCycle | 0;
    }

    // Occupancy state accessors
    getOccTileX(i: number): number {
        return this.occTileX[i] | 0;
    }
    getOccTileY(i: number): number {
        return this.occTileY[i] | 0;
    }
    getOccPlane(i: number): number {
        return this.occPlane[i] | 0;
    }
    getOccMapX(i: number): number {
        return this.occMapX[i] | 0;
    }
    getOccMapY(i: number): number {
        return this.occMapY[i] | 0;
    }
    setOccTile(i: number, x: number, y: number, plane: number): void {
        this.occTileX[i] = (x | 0) & 63;
        this.occTileY[i] = (y | 0) & 63;
        this.occPlane[i] = (plane | 0) & 255;
    }
    setOccTileWithMap(
        i: number,
        mapX: number,
        mapY: number,
        x: number,
        y: number,
        plane: number,
    ): void {
        this.setOccTile(i, x, y, plane);
        this.occMapX[i] = (mapX | 0) & 255;
        this.occMapY[i] = (mapY | 0) & 255;
    }

    // Instantly move the player to a destination tile (teleport).
    // Updates current, previous, and target positions, clears path, and refreshes occupancy.
    teleport(i: number, tileX: number, tileY: number, plane?: number): void {
        const sx = ((tileX | 0) << 7) + 64;
        const sy = ((tileY | 0) << 7) + 64;
        this.prevX[i] = sx;
        this.prevY[i] = sy;
        this.x[i] = sx;
        this.y[i] = sy;
        this.targetX[i] = sx;
        this.targetY[i] = sy;
        this.running[i] = 0;
        this.rotationVel[i] = 0;
        // Reset animation distance to prevent phase drift after teleport
        if (this.animDistTraveled) this.animDistTraveled[i] = 0.0;
        if (this.animPhaseBias) this.animPhaseBias[i] = 0.0;
        // Reset server interpolation state so local snap is not overridden by in-flight segments
        if (this.srvLastX && this.srvNextX && this.srvT && this.srvOverrun) {
            this.srvLastX[i] = sx;
            this.srvLastY[i] = sy;
            this.srvNextX[i] = sx;
            this.srvNextY[i] = sy;
            this.srvT[i] = 1.0;
            this.srvOverrun[i] = 0.0;
            if (this.srvPendingValid) this.srvPendingValid[i] = 0;
            if (this.movingHold) this.movingHold[i] = 0;
        }
        // Update occupancy immediately
        const mapX = (tileX | 0) >> 6;
        const mapY = (tileY | 0) >> 6;
        const localX = (tileX | 0) & 63;
        const localY = (tileY | 0) & 63;
        this.setOccTileWithMap(i, mapX, mapY, localX, localY, (plane ?? this.level[i]) | 0);
    }

    // Interaction API
    setInteractionIndex(i: number, index: number | undefined): void {
        if (!this.interactionIndex) return;
        const prev = this.interactionIndex[i] | 0;
        const next = typeof index === "number" && index >= 0 ? index | 0 : NO_INTERACTION;
        if (prev !== next) {
            try {
                const serverId = this.getServerIdForIndex(i);
                console.log("[client] interaction index update", {
                    serverId,
                    index: i,
                    prev,
                    next,
                });
            } catch {}
        }
        this.interactionIndex[i] = next;
    }
    getInteractionIndex(i: number): number {
        return this.interactionIndex ? this.interactionIndex[i] | 0 : NO_INTERACTION;
    }
    getInteractingId(i: number): number | undefined {
        const decoded = decodeInteractionIndex(this.getInteractionIndex(i));
        return decoded?.id;
    }
}
