/**
 * NPC Sync Manager.
 *
 * Handles all NPC synchronization and streaming for players:
 * - NPC viewport management (enter/exit radius hysteresis)
 * - Health bar state tracking and synchronization
 * - NPC packet serialization and queuing
 * - Per-player NPC visible set management
 *
 * Uses dependency injection via services interface to avoid tight coupling.
 */
import { logger } from "../../utils/logger";
import { NO_INTERACTION } from "../../game/interactionIndex";
import type { ServerServices } from "../../game/ServerServices";
import type { NpcState, NpcUpdateDelta } from "../../game/npc";
import type { PlayerState } from "../../game/player";

// ============================================================================
// Types
// ============================================================================

/** Health bar update payload for NPC streaming. */
export interface HealthBarUpdatePayload {
    id: number;
    /** Absolute server loopCycle when this update becomes active (Client.cycle in OSRS). */
    cycle: number;
    /** Start value (0..width in the referenced HealthBarDefinition). */
    health: number;
    /** Target value (0..width in the referenced HealthBarDefinition). */
    health2: number;
    /** Interpolation duration in cycles (0 means immediate). */
    cycleOffset: number;
    /** True when the server requested removal (value=32767 sentinel). */
    removed?: boolean;
}

/** NPC view snapshot for initial spawn. */
export interface NpcViewSnapshot {
    id: number;
    typeId: number;
    x: number;
    y: number;
    level: number;
    rot: number;
    orientation: number;
    size: number;
    spawnX: number;
    spawnY: number;
    spawnLevel: number;
    name?: string;
    interactingIndex?: number;
    snap?: boolean;
    healthBars?: HealthBarUpdatePayload[];
}

/** NPC update payload for delta updates. */
export interface NpcUpdatePayload {
    id: number;
    x?: number;
    y?: number;
    level?: number;
    rot?: number;
    orientation?: number;
    moved?: boolean;
    turned?: boolean;
    seq?: number;
    snap?: boolean;
    typeId?: number;
    size?: number;
    spawnX?: number;
    spawnY?: number;
    spawnLevel?: number;
    interactingIndex?: number;
    healthBars?: HealthBarUpdatePayload[];
}

/** NPC packet buffer for a player. */
export interface NpcPacketBuffer {
    snapshots: NpcViewSnapshot[];
    updates: NpcUpdatePayload[];
    despawns: number[];
}

/** Tick frame with NPC updates. */
export interface NpcTickFrame {
    tick: number;
    npcUpdates: NpcUpdateDelta[];
    npcViews: Map<number, NpcViewSnapshot>;
}

// ============================================================================
// Constants
// ============================================================================

const NPC_STREAM_RADIUS_TILES = 15;
const NPC_STREAM_ENTER_RADIUS_TILES = NPC_STREAM_RADIUS_TILES;
const NPC_STREAM_EXIT_RADIUS_TILES = NPC_STREAM_RADIUS_TILES + 2;

// Optional: enable verbose NPC streaming diagnostics by setting DEBUG_NPC_STREAM=1
const DEBUG_NPC_STREAM =
    (process?.env?.DEBUG_NPC_STREAM ?? "").toString().toLowerCase() === "1" ||
    (process?.env?.DEBUG_NPC_STREAM ?? "").toString().toLowerCase() === "true";

// ============================================================================
// Services Interface
// ============================================================================


// ============================================================================
// NpcSyncManager
// ============================================================================

/**
 * Handles NPC synchronization and streaming for players.
 */
export class NpcSyncManager {
    constructor(private readonly svc: ServerServices) {}

    // ========================================================================
    // Public Methods
    // ========================================================================

    /**
     * Get or create NPC packet buffer for a player.
     */
    getOrCreateNpcPacketBuffer(
        container: Map<number, NpcPacketBuffer>,
        playerId: number,
    ): NpcPacketBuffer {
        let buffer = container.get(playerId);
        if (!buffer) {
            buffer = { snapshots: [], updates: [], despawns: [] };
            container.set(playerId, buffer);
        }
        return buffer;
    }

    /**
     * Queue an NPC snapshot for a player.
     */
    queueNpcSnapshot(playerId: number, snapshot: NpcViewSnapshot): void {
        const buffer = this.getOrCreateNpcPacketBuffer(
            this.svc.pendingNpcPackets,
            playerId,
        );
        buffer.snapshots.push(snapshot);
    }

    /**
     * Queue an NPC update for a player.
     */
    queueNpcUpdate(playerId: number, update: NpcUpdatePayload): void {
        const buffer = this.getOrCreateNpcPacketBuffer(
            this.svc.pendingNpcPackets,
            playerId,
        );
        buffer.updates.push(update);
    }

    /**
     * Queue an NPC despawn for a player.
     */
    queueNpcDespawn(playerId: number, npcId: number): void {
        const buffer = this.getOrCreateNpcPacketBuffer(
            this.svc.pendingNpcPackets,
            playerId,
        );
        buffer.despawns.push(npcId);
    }

    /**
     * Update NPC view for a player (viewport NPC list).
     * Uses a 15-tile radius (same as player sync).
     */
    updateNpcViewForPlayer(player: PlayerState): void {
        const npcManager = this.svc.npcManager;
        if (!npcManager) return;

        const NPC_VIEW_DISTANCE_TILES = 15;
        const nearby = npcManager.getNearby(
            player.tileX,
            player.tileY,
            player.level,
            NPC_VIEW_DISTANCE_TILES,
        );
        nearby.sort((a, b) => a.id - b.id);
        player.visibleNpcIds.clear();
        for (let i = 0; i < nearby.length && player.visibleNpcIds.size < 255; i++) {
            player.visibleNpcIds.add(nearby[i].id);
        }
    }

    /**
     * Push NPC updates for a player during tick processing.
     * Handles spawns, updates, despawns, and health bar synchronization.
     */
    pushNpcUpdatesForPlayer(player: PlayerState, frame: NpcTickFrame): void {
        const npcManager = this.svc.npcManager;
        if (!npcManager) return;

        const updates = frame.npcUpdates;
        const npcViews = frame.npcViews;
        const packetBuffer = this.getOrCreateNpcPacketBuffer(
            this.svc.pendingNpcPackets,
            player.id,
        );
        const serverCycle = frame.tick;

        // Health bars: drive from authoritative NPC hitpoints state
        const hbWidthByDefId = new Map<number, number>();
        const resolveHbWidth = (defId: number): number => {
            const key = defId;
            const cached = hbWidthByDefId.get(key);
            if (cached !== undefined) return cached;
            let width = 30;
            try {
                const loader = this.svc.healthBarDefLoader;
                const def = loader?.load?.(key);
                width = Math.max(1, Math.min(255, def?.width ?? 30));
            } catch {
                width = 30;
            }
            hbWidthByDefId.set(key, width);
            return width;
        };

        const ensureNpcBarMap = (npcId: number): Map<number, number> => {
            let map = player.lastNpcHealthBarScaled.get(npcId);
            if (!map) {
                map = new Map<number, number>();
                player.lastNpcHealthBarScaled.set(npcId, map);
            }
            return map;
        };

        const spawnedNow = new Set<number>();
        const updatedThisCycle = new Set<number>();

        // Hysteresis: tighter radius for entering, looser for remaining visible
        const nearbyEnter = npcManager.getNearby(
            player.tileX,
            player.tileY,
            player.level,
            NPC_STREAM_ENTER_RADIUS_TILES,
        );

        const nearbyEnterIds = new Set<number>();
        for (const npc of nearbyEnter) {
            nearbyEnterIds.add(npc.id);
        }

        const nearbyExit = npcManager.getNearby(
            player.tileX,
            player.tileY,
            player.level,
            NPC_STREAM_EXIT_RADIUS_TILES,
        );
        const nearbyExitIds = new Set<number>();
        for (const npc of nearbyExit) {
            nearbyExitIds.add(npc.id);
        }

        if (DEBUG_NPC_STREAM) {
            logger.info(
                `[npcs] stream window -> player=${player.id} pos=(${player.tileX},${player.tileY},L${player.level}) enter=${nearbyEnterIds.size} exit=${nearbyExitIds.size}`,
            );
        }

        // Process spawns
        const snapshots: NpcViewSnapshot[] = [];
        for (const npc of nearbyEnter) {
            if (!player.visibleNpcIds.has(npc.id)) {
                if (DEBUG_NPC_STREAM) {
                    logger.info(
                        `[npcs] spawn -> player=${player.id} npc=${npc.id} type=${npc.typeId} pos=(${npc.tileX},${npc.tileY},L${npc.level})`,
                    );
                }
                const snap = this.serializeNpcSnapshot(npc);
                spawnedNow.add(snap.id);

                // Add health bar to snapshot if damaged
                try {
                    const hbDefId = Math.max(0, npc.getHealthBarDefinitionId());
                    const hbWidth = resolveHbWidth(hbDefId);
                    const maxHp = Math.max(1, npc.getMaxHitpoints());
                    const curHp = Math.max(0, npc.getHitpoints());
                    const scaled = Math.max(
                        0,
                        Math.min(hbWidth, Math.floor((curHp * hbWidth) / maxHp)),
                    );
                    const prevMap = ensureNpcBarMap(snap.id);
                    prevMap.clear();
                    prevMap.set(hbDefId, scaled);
                    if (scaled < hbWidth) {
                        snap.healthBars = [
                            {
                                id: hbDefId,
                                cycle: serverCycle,
                                health: scaled,
                                health2: scaled,
                                cycleOffset: 0,
                            },
                        ];
                    }
                } catch (err) { logger.warn("[npc-sync] failed to build initial health bar", err); }

                snapshots.push(snap);
                npcViews.set(npc.id, {
                    id: snap.id,
                    typeId: snap.typeId,
                    x: snap.x,
                    y: snap.y,
                    level: snap.level,
                    rot: snap.rot,
                    orientation: snap.orientation,
                    size: snap.size,
                    spawnX: snap.spawnX,
                    spawnY: snap.spawnY,
                    spawnLevel: snap.spawnLevel,
                    name: snap.name,
                    interactingIndex: snap.interactingIndex,
                    snap: true,
                });
                packetBuffer.snapshots.push(snap);
            }
        }

        // Process updates
        if (updates.length > 0) {
            for (const update of updates) {
                const id = update.id;
                if (!nearbyEnterIds.has(id)) continue;
                const npc = npcManager.getById(id);
                const serialized = this.serializeNpcUpdate(update, npc);

                // Update health bar state
                if (npc) {
                    try {
                        const hbDefId = Math.max(0, npc.getHealthBarDefinitionId());
                        const hbWidth = resolveHbWidth(hbDefId);
                        const maxHp = Math.max(1, npc.getMaxHitpoints());
                        const curHp = Math.max(0, npc.getHitpoints());
                        const scaled = Math.max(
                            0,
                            Math.min(hbWidth, Math.floor((curHp * hbWidth) / maxHp)),
                        );
                        const prevMap = ensureNpcBarMap(id);

                        // If the server switches healthbar def ids, remove any previously sent bars
                        if (prevMap.size > 0) {
                            for (const prevDefId of prevMap.keys()) {
                                if (prevDefId === hbDefId) continue;
                                if (!serialized.healthBars) serialized.healthBars = [];
                                serialized.healthBars.push({
                                    id: prevDefId,
                                    cycle: serverCycle,
                                    health: 0,
                                    health2: 0,
                                    cycleOffset: 32767,
                                    removed: true,
                                });
                                prevMap.delete(prevDefId);
                            }
                        }

                        const prev = prevMap.get(hbDefId);
                        if (prev === undefined) {
                            prevMap.set(hbDefId, scaled);
                            if (!spawnedNow.has(id) && scaled < hbWidth) {
                                if (!serialized.healthBars) serialized.healthBars = [];
                                serialized.healthBars.push({
                                    id: hbDefId,
                                    cycle: serverCycle,
                                    health: scaled,
                                    health2: scaled,
                                    cycleOffset: 0,
                                });
                            }
                        } else if (prev !== scaled) {
                            prevMap.set(hbDefId, scaled);
                            if (!serialized.healthBars) serialized.healthBars = [];
                            serialized.healthBars.push({
                                id: hbDefId,
                                cycle: serverCycle,
                                health: scaled,
                                health2: scaled,
                                cycleOffset: 0,
                            });
                        }
                    } catch (err) { logger.warn("[npc-sync] failed to update health bar", err); }
                }

                npcViews.set(id, {
                    id: serialized.id,
                    typeId: serialized.typeId ?? npc?.typeId ?? serialized.id,
                    x: serialized.x ?? npc?.x ?? 0,
                    y: serialized.y ?? npc?.y ?? 0,
                    level: serialized.level ?? npc?.level ?? 0,
                    rot: serialized.rot ?? npc?.rot ?? 0,
                    orientation: serialized.orientation ?? npc?.getOrientation?.() ?? 0,
                    size: serialized.size ?? npc?.size ?? 1,
                    spawnX: serialized.spawnX ?? npc?.spawnX ?? 0,
                    spawnY: serialized.spawnY ?? npc?.spawnY ?? 0,
                    spawnLevel: serialized.spawnLevel ?? npc?.spawnLevel ?? 0,
                    name: npc?.name,
                    interactingIndex: serialized.interactingIndex,
                    snap: false,
                });

                packetBuffer.updates.push({
                    id: serialized.id,
                    x: serialized.x,
                    y: serialized.y,
                    level: serialized.level,
                    rot: serialized.rot,
                    orientation: serialized.orientation,
                    moved: serialized.moved,
                    turned: serialized.turned,
                    seq: serialized.seq,
                    snap: serialized.snap,
                    typeId: serialized.typeId,
                    size: serialized.size,
                    spawnX: serialized.spawnX,
                    spawnY: serialized.spawnY,
                    spawnLevel: serialized.spawnLevel,
                    interactingIndex: serialized.interactingIndex,
                    healthBars: serialized.healthBars,
                });
                updatedThisCycle.add(id);
            }
        }

        // Process despawns
        const despawns: number[] = [];
        for (const id of player.visibleNpcIds) {
            // Only despawn if the NPC is outside the wider exit radius
            if (!nearbyExitIds.has(id)) {
                despawns.push(id);
            }
        }

        if (despawns.length > 0) {
            for (const id of despawns) {
                const npc = npcManager.getById(id);
                const typeId = npc?.typeId;
                const pos = npc ? `${npc.tileX},${npc.tileY},L${npc.level}` : "unknown";
                if (DEBUG_NPC_STREAM) {
                    logger.info(
                        `[npcs] despawn -> player=${player.id} npc=${id} type=${
                            typeId ?? "unknown"
                        } pos=${pos}`,
                    );
                }
                player.visibleNpcIds.delete(id);
                npcViews.delete(id);
                player.lastNpcHealthBarScaled.delete(id);
                packetBuffer.despawns.push(id);
            }
        }

        // Add spawned NPCs to visible set
        for (const snap of snapshots) {
            player.visibleNpcIds.add(snap.id);
        }

        // Emit healthbar-only updates for NPCs whose HP changed without an NPC update delta
        for (const id of player.visibleNpcIds) {
            const npcId = id;
            if (spawnedNow.has(npcId) || updatedThisCycle.has(npcId)) continue;
            const npc = npcManager.getById(npcId);
            if (!npc) {
                player.lastNpcHealthBarScaled.delete(npcId);
                continue;
            }

            let maxHp: number;
            let curHp: number;
            let hbDefId: number;
            let hbWidth: number;
            try {
                hbDefId = Math.max(0, npc.getHealthBarDefinitionId());
                hbWidth = resolveHbWidth(hbDefId);
                maxHp = Math.max(1, npc.getMaxHitpoints());
                curHp = Math.max(0, npc.getHitpoints());
            } catch {
                continue;
            }

            const scaled = Math.max(0, Math.min(hbWidth, Math.floor((curHp * hbWidth) / maxHp)));
            const prevMap = ensureNpcBarMap(npcId);

            // If the server switches healthbar def ids, remove any previously sent bars
            if (prevMap.size > 0) {
                for (const prevDefId of prevMap.keys()) {
                    if (prevDefId === hbDefId) continue;
                    packetBuffer.updates.push({
                        id: npcId,
                        healthBars: [
                            {
                                id: prevDefId,
                                cycle: serverCycle,
                                health: 0,
                                health2: 0,
                                cycleOffset: 32767,
                                removed: true,
                            },
                        ],
                    });
                    prevMap.delete(prevDefId);
                }
            }

            const prev = prevMap.get(hbDefId);
            if (prev === undefined) {
                prevMap.set(hbDefId, scaled);
                if (scaled >= hbWidth) continue;
                packetBuffer.updates.push({
                    id: npcId,
                    healthBars: [
                        {
                            id: hbDefId,
                            cycle: serverCycle,
                            health: scaled,
                            health2: scaled,
                            cycleOffset: 0,
                        },
                    ],
                });
                continue;
            }

            if (prev === scaled) continue;
            prevMap.set(hbDefId, scaled);
            packetBuffer.updates.push({
                id: npcId,
                healthBars: [
                    {
                        id: hbDefId,
                        cycle: serverCycle,
                        health: scaled,
                        health2: scaled,
                        cycleOffset: 0,
                    },
                ],
            });
        }
    }

    /**
     * Serialize an NPC state to a snapshot.
     */
    serializeNpcSnapshot(npc: NpcState): NpcViewSnapshot {
        const index = npc.getInteractionIndex();
        return {
            id: npc.id,
            typeId: npc.typeId,
            x: npc.x,
            y: npc.y,
            level: npc.level,
            rot: npc.rot,
            orientation: npc.getOrientation() & 2047,
            size: npc.size,
            name: npc.name,
            spawnX: npc.spawnX,
            spawnY: npc.spawnY,
            spawnLevel: npc.spawnLevel,
            interactingIndex: index >= 0 ? index : undefined,
        };
    }

    /**
     * Serialize an NPC update delta.
     */
    serializeNpcUpdate(
        delta: NpcUpdateDelta,
        npc?: NpcState | undefined,
    ): NpcUpdatePayload & { healthBars?: HealthBarUpdatePayload[] } {
        const index = npc ? npc.getInteractionIndex() : NO_INTERACTION;
        return {
            id: delta.id,
            x: delta.x,
            y: delta.y,
            level: delta.level,
            rot: delta.rot,
            orientation:
                (delta.orientation ?? (npc ? npc.getOrientation() : delta.rot ?? 0)) & 2047,
            moved: !!delta.moved,
            turned: !!delta.turned,
            seq: delta.seq,
            snap: !!delta.snap,
            typeId: delta.typeId,
            size: delta.size,
            spawnX: delta.spawnX,
            spawnY: delta.spawnY,
            spawnLevel: delta.spawnLevel,
            interactingIndex: index >= 0 ? index : undefined,
        };
    }
}
