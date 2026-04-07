/**
 * NPC Packet Encoder
 *
 * Encodes OSRS-style binary NPC sync packets.
 * Extracted from wsServer.ts for better modularity.
 *
 * NPC sync packet encoder.
 */
import { logger } from "../../utils/logger";
import type { ServerServices } from "../../game/ServerServices";
import {
    resolveHitsplatTypeForObserver,
    type HitsplatSourceType,
} from "../../game/combat/OsrsHitsplatIds";
import { encodeCp1252Bytes } from "./Cp1252";
import type { NpcState, NpcUpdateDelta } from "../../game/npc";
import type { PlayerState } from "../../game/player";
import { BitWriter } from "../BitWriter";
import { NpcSyncSession } from "../NpcSyncSession";
import {
    HITSPLAT_SENTINEL_NO_TYPE,
    HITSPLAT_SENTINEL_SECONDARY,
    MAX_LOCAL_NPCS,
    NO_TARGET_INDEX,
    NPC_MASKS,
    NPC_VIEW_DISTANCE_TILES,
    ROTATION_TO_INDEX,
    USHORT_SMART_MAX,
} from "./constants";
import type {
    HealthBarBlock,
    HitsplatBlock,
    NpcEncodingServices,
    NpcSyncResult,
    NpcUpdateInfo,
    SpotAnimBlock,
} from "./types";

/**
 * Extended tick frame data for NPC encoding.
 */
export interface NpcTickFrameData {
    tick: number;
    /** Server tick length in milliseconds (OSRS = 600). */
    tickMs: number;
    npcUpdates: NpcUpdateDelta[];
    hitsplats: Array<{
        targetId: number;
        targetType: "player" | "npc";
        style?: number;
        damage: number;
        type2?: number;
        damage2?: number;
        sourceType?: HitsplatSourceType;
        sourcePlayerId?: number;
        tick?: number;
        delayTicks?: number;
    }>;
    npcEffectEvents: Array<{
        npcId: number;
        hitsplat?: { style?: number; amount: number };
    }>;
    spotAnimations: Array<{
        npcId?: number;
        spotId: number;
        slot?: number;
        height?: number;
        delay?: number;
    }>;
    colorOverrides: Map<
        number,
        { hue: number; sat: number; lum: number; amount: number; durationTicks: number }
    >;
}

/**
 * Services interface for NPC packet encoding.
 */
/**
 * NPC Packet Encoder class.
 */
export class NpcPacketEncoder {
    constructor(private svc: ServerServices) {}

    private getNpcById(id: number): NpcState | undefined {
        return this.svc.npcManager?.getById(id);
    }

    private getNearbyNpcs(x: number, y: number, level: number, radius: number): NpcState[] {
        return this.svc.npcManager?.getNearby(x, y, level, radius) ?? [];
    }

    private resolveHealthBarWidth(defId: number): number {
        try {
            const def = this.svc.healthBarDefLoader?.load?.(defId);
            return Math.max(1, Math.min(255, def?.width ?? 30));
        } catch (err) {
            logger.warn("Failed to resolve NPC health bar width", err);
            return 30;
        }
    }

    /**
     * Build a binary NPC sync packet for a player.
     */
    buildNpcSyncPacket(
        player: PlayerState,
        frame: NpcTickFrameData,
        session: NpcSyncSession,
    ): NpcSyncResult {
        const writer = new BitWriter();
        const loopCycle = frame.tick;
        const tickMs = Math.max(1, frame.tickMs);
        const cyclesPerTick = Math.max(1, Math.round(tickMs / 20));
        const localTileX = player.tileX;
        const localTileY = player.tileY;
        const level = player.level;

        // Get nearby NPCs
        const desiredNpcs = this.getNearbyNpcs(
            localTileX,
            localTileY,
            level,
            NPC_VIEW_DISTANCE_TILES,
        );
        desiredNpcs.sort((a, b) => a.id - b.id);

        const desiredIds: number[] = [];
        const desiredSet = new Set<number>();
        for (let i = 0; i < desiredNpcs.length && desiredIds.length < MAX_LOCAL_NPCS; i++) {
            const id = desiredNpcs[i].id;
            desiredIds.push(id);
            desiredSet.add(id);
        }

        // Keep PlayerState.visibleNpcIds in sync
        player.visibleNpcIds.clear();
        for (const id of desiredIds) player.visibleNpcIds.add(id);

        // Build updates map
        const updatesById = new Map<number, NpcUpdateDelta>();
        for (const upd of frame.npcUpdates) {
            if (!upd) continue;
            updatesById.set(upd.id, upd);
        }

        // Process hitsplats
        const { hits: hitsByNpc } = this.processHitsplats(
            player,
            frame,
            desiredSet,
            loopCycle,
            cyclesPerTick,
        );

        // Process spot animations
        const spotsByNpc = this.processSpotAnimations(frame, desiredSet, cyclesPerTick);

        // Color overrides from frame (already collected per-tick to avoid consume-once bug)
        const colorOverridesByNpc = frame.colorOverrides;

        // Ensure NPC bar map exists
        const ensureNpcBarMap = (npcId: number): Map<number, number> => {
            let map = player.lastNpcHealthBarScaled.get(npcId);
            if (!map) {
                map = new Map<number, number>();
                player.lastNpcHealthBarScaled.set(npcId, map);
            }
            return map;
        };

        // Update info computation
        const infos = new Map<number, NpcUpdateInfo>();

        const computeUpdateInfo = (npcId: number, npc: NpcState): NpcUpdateInfo => {
            const id = npcId;
            const existing = infos.get(id);
            if (existing) return existing;

            const info: NpcUpdateInfo = { mask: 0 };

            // FACE_ENTITY (0x8)
            let targetIndex = NO_TARGET_INDEX;
            try {
                const idx = npc.getInteractionIndex();
                targetIndex = idx >= 0 ? idx & 0xffffff : NO_TARGET_INDEX;
            } catch {
                targetIndex = NO_TARGET_INDEX;
            }
            const prevTarget = session.lastTargetIndex.get(id);
            if (prevTarget === undefined || prevTarget !== targetIndex) {
                info.mask |= NPC_MASKS.FACE_ENTITY;
                info.targetIndex = targetIndex;
                session.lastTargetIndex.set(id, targetIndex);
            }

            // SEQUENCE (0x10)
            const upd = updatesById.get(id);
            if (upd?.seq !== undefined) {
                info.mask |= NPC_MASKS.SEQUENCE;
                info.seq = { id: upd.seq, delay: 0 };
            }

            // SPOT_ANIM (0x20000)
            const spots = spotsByNpc.get(id);
            if (spots && spots.length > 0) {
                info.mask |= NPC_MASKS.SPOT_ANIM;
                info.spotAnims = spots.slice();
            }

            // COLOR_OVERRIDE (0x100) — read from frame, not NPC state, so all observers get it
            const frameOverride = colorOverridesByNpc.get(id);
            if (frameOverride && frameOverride.amount > 0) {
                info.mask |= NPC_MASKS.COLOR_OVERRIDE;
                info.colorOverride = {
                    startCycleOffset: 0,
                    endCycleOffset: frameOverride.durationTicks * cyclesPerTick,
                    hue: frameOverride.hue,
                    sat: frameOverride.sat,
                    lum: frameOverride.lum,
                    amount: frameOverride.amount,
                };
            }

            // SAY (0x40)
            if (npc.pendingSay) {
                info.mask |= NPC_MASKS.SAY;
                info.say = npc.pendingSay;
                npc.pendingSay = undefined;
            }

            // HIT_MASK (0x20)
            const hits = hitsByNpc.get(id);
            const hasHits = !!hits && hits.length > 0;
            const healthBars: HealthBarBlock[] = [];

            try {
                const hbDefId = Math.max(0, npc.getHealthBarDefinitionId());
                const hbWidth = this.resolveHealthBarWidth(hbDefId);
                const maxHp = Math.max(1, npc.getMaxHitpoints());
                const curHp = Math.max(0, npc.getHitpoints());

                let scaled = Math.max(0, Math.min(255, Math.floor((curHp * hbWidth) / maxHp)));
                if (curHp > 0 && scaled <= 0) scaled = 1;
                const map = ensureNpcBarMap(id);

                // Remove bars if definition id changed
                for (const knownDefId of Array.from(map.keys())) {
                    if (knownDefId === hbDefId) continue;
                    map.delete(knownDefId);
                    healthBars.push({
                        id: knownDefId,
                        cycleOffset: 32767,
                        delayCycles: 0,
                        health: 0,
                        health2: 0,
                        removed: true,
                    });
                }

                const prev = map.get(hbDefId);
                if (prev === undefined) {
                    map.set(hbDefId, scaled);
                    if (scaled < hbWidth || hasHits) {
                        healthBars.push({
                            id: hbDefId,
                            cycleOffset: 0,
                            delayCycles: 0,
                            health: scaled,
                            health2: scaled,
                        });
                    }
                } else if (prev !== scaled) {
                    map.set(hbDefId, scaled);
                    healthBars.push({
                        id: hbDefId,
                        cycleOffset: 0,
                        delayCycles: 0,
                        // most HP updates are sent as immediate snaps (cycleOffset=0),
                        // meaning `health2` is omitted on the wire and treated as `health`.
                        health: scaled,
                        health2: scaled,
                    });
                } else if (hasHits) {
                    healthBars.push({
                        id: hbDefId,
                        cycleOffset: 0,
                        delayCycles: 0,
                        health: scaled,
                        health2: scaled,
                    });
                }
            } catch (err) { logger.warn("[npc-encoder] failed to encode health bar", err); }

            if (hasHits || healthBars.length > 0) {
                info.mask |= NPC_MASKS.HIT;
                if (hasHits) info.hitsplats = hits!.slice();
                if (healthBars.length > 0) info.healthBars = healthBars;
            }

            infos.set(id, info);
            return info;
        };

        // Write previous count
        const prevCount = Math.min(MAX_LOCAL_NPCS, session.npcIndices.length);
        writer.writeBits(8, prevCount & 0xff);

        const nextIndices: number[] = [];
        const pendingUpdateOrder: number[] = [];
        const readdAsTeleport = new Set<number>();

        // Process existing NPCs
        for (let i = 0; i < prevCount; i++) {
            const npcId = session.npcIndices[i];
            const npc = this.getNpcById(npcId);
            if (!npc || !desiredSet.has(npcId)) {
                writer.writeBits(1, 1);
                writer.writeBits(2, 3);
                // Per-recipient caches must be cleared when an NPC leaves the local list.
                // ids are reused and actors are re-instantiated client-side.
                session.lastTargetIndex.delete(npcId);
                player.lastNpcHealthBarScaled.delete(npcId);
                continue;
            }

            const upd = updatesById.get(npcId);
            if (upd?.snap) {
                writer.writeBits(1, 1);
                writer.writeBits(2, 3);
                readdAsTeleport.add(npcId);
                // Snap removes+re-adds the NPC this tick; treat as a true removal for caches.
                session.lastTargetIndex.delete(npcId);
                player.lastNpcHealthBarScaled.delete(npcId);
                continue;
            }

            const info = computeUpdateInfo(npcId, npc);
            const needsUpdate = info.mask !== 0;

            const dirs = Array.isArray(upd?.directions) ? (upd!.directions as number[]) : [];
            const trav = Array.isArray(upd?.traversals) ? (upd!.traversals as number[]) : [];

            if (dirs.length === 0) {
                if (!needsUpdate) {
                    writer.writeBits(1, 0);
                } else {
                    writer.writeBits(1, 1);
                    writer.writeBits(2, 0);
                    pendingUpdateOrder.push(npcId);
                }
                nextIndices.push(npcId);
                continue;
            }

            // Movement update
            writer.writeBits(1, 1);

            if (dirs.length === 1) {
                const netDir = dirs[0] & 7;
                const traversal = (trav[0] ?? 1) & 3;
                if (traversal === 0) {
                    writer.writeBits(2, 2);
                    writer.writeBits(1, 0);
                    writer.writeBits(3, netDir);
                    writer.writeBits(1, needsUpdate ? 1 : 0);
                } else {
                    writer.writeBits(2, 1);
                    writer.writeBits(3, netDir);
                    writer.writeBits(1, needsUpdate ? 1 : 0);
                }
            } else {
                const d0 = dirs[0] & 7;
                const d1 = dirs[1] & 7;
                const t0 = (trav[0] ?? 2) & 3;
                const t1 = (trav[1] ?? 2) & 3;
                writer.writeBits(2, 2);
                if (t0 === 2 && t1 === 2) {
                    writer.writeBits(1, 1);
                    writer.writeBits(3, d0);
                    writer.writeBits(3, d1);
                } else {
                    writer.writeBits(1, 0);
                    writer.writeBits(3, d0);
                }
                writer.writeBits(1, needsUpdate ? 1 : 0);
            }

            if (needsUpdate) {
                pendingUpdateOrder.push(npcId);
            }
            nextIndices.push(npcId);
        }

        // Add new NPCs
        const nextSet = new Set<number>(nextIndices);
        const addCandidates: number[] = [];
        for (const id of desiredIds) {
            if (!nextSet.has(id)) addCandidates.push(id);
        }

        // Determine if large encoding is needed
        const needsLarge = (() => {
            for (const id of addCandidates) {
                const npc = this.getNpcById(id);
                if (!npc) continue;
                const dx = npc.tileX - localTileX;
                const dy = npc.tileY - localTileY;
                if (dx < -16 || dx > 15 || dy < -16 || dy > 15) return true;
            }
            return false;
        })();

        const encodeSigned = (value: number, bits: number): number => {
            const v = value;
            const mask = (1 << bits) - 1;
            return (v < 0 ? v + (1 << bits) : v) & mask;
        };

        const maxToAdd = Math.max(0, MAX_LOCAL_NPCS - nextIndices.length);
        let added = 0;
        for (let i = 0; i < addCandidates.length && added < maxToAdd; i++) {
            const npcId = addCandidates[i];
            const npc = this.getNpcById(npcId);
            if (!npc) continue;
            if (!desiredSet.has(npcId)) continue;

            // New local NPC: reset per-recipient caches for this id to avoid stale state
            // (important because NPC ids are reused for respawns).
            session.lastTargetIndex.delete(npcId);
            player.lastNpcHealthBarScaled.delete(npcId);

            const info = computeUpdateInfo(npcId, npc);
            const needsUpdate = info.mask !== 0;
            const teleport = readdAsTeleport.has(npcId);

            const dx = npc.tileX - localTileX;
            const dy = npc.tileY - localTileY;

            writer.writeBits(16, npcId & 0xffff);
            writer.writeBits(1, needsUpdate ? 1 : 0);
            const wvId = npc.worldViewId | 0;
            if (wvId >= 0) {
                writer.writeBits(1, 1);
                writer.writeBits(32, wvId & 0xffff);
            } else {
                writer.writeBits(1, 0);
            }
            writer.writeBits(1, teleport ? 1 : 0);

            if (needsLarge) {
                writer.writeBits(8, encodeSigned(dy, 8));
                writer.writeBits(8, encodeSigned(dx, 8));
            } else {
                writer.writeBits(5, encodeSigned(dy, 5));
                writer.writeBits(5, encodeSigned(dx, 5));
            }

            const rotIdx = ROTATION_TO_INDEX.get(npc.rot & 2047) ?? 0;
            writer.writeBits(3, rotIdx & 7);
            writer.writeBits(14, npc.typeId & 0x3fff);

            if (needsUpdate) {
                pendingUpdateOrder.push(npcId);
            }

            nextIndices.push(npcId);
            nextSet.add(npcId);
            added++;
        }

        // Sentinel terminator
        writer.writeBits(16, 0xffff);

        // Update session
        session.npcIndices = nextIndices.slice(0, MAX_LOCAL_NPCS);
        for (const id of Array.from(session.lastTargetIndex.keys())) {
            if (!nextSet.has(id)) {
                session.lastTargetIndex.delete(id);
            }
        }

        // Keep per-recipient NPC healthbar history bounded.
        // NPC ids are reused for respawns, so stale baselines can otherwise
        // cause a full-health respawn to briefly show a "healing" health bar update.
        for (const id of Array.from(player.lastNpcHealthBarScaled.keys())) {
            if (!nextSet.has(id)) player.lastNpcHealthBarScaled.delete(id);
        }

        writer.alignToByte();

        // Write update blocks
        this.writeUpdateBlocks(writer, pendingUpdateOrder, infos);

        writer.alignToByte();
        return { packet: writer.toUint8Array(), large: needsLarge };
    }

    /**
     * Process hitsplats from frame data.
     */
    private processHitsplats(
        player: PlayerState,
        frame: NpcTickFrameData,
        desiredSet: Set<number>,
        loopCycle: number,
        cyclesPerTick: number,
    ): {
        hits: Map<number, HitsplatBlock[]>;
    } {
        const hitsByNpc = new Map<number, HitsplatBlock[]>();

        for (const evt of frame.hitsplats) {
            if (!evt || evt.targetType !== "npc") continue;
            const npcId = evt.targetId;
            if (!desiredSet.has(npcId)) continue;
            const evtTick = evt.tick ?? loopCycle;
            const extraDelayTicks = evt.delayTicks !== undefined ? Math.max(0, evt.delayTicks) : 0;
            // OSRS update blocks use client-cycle delays (Client.cycle units), not server ticks.
            const delayServerTicks = Math.max(0, evtTick - loopCycle) + extraDelayTicks;
            const delayCycles = Math.max(0, Math.round(delayServerTicks * cyclesPerTick));
            const type2Raw = evt.type2 ?? -1;
            const damage2Raw = evt.damage2 ?? -1;
            const hasSecondary = type2Raw >= 0 && damage2Raw >= 0;
            const entry = hitsByNpc.get(npcId) ?? [];
            entry.push({
                type: this.clampHitsplatTypeId(
                    resolveHitsplatTypeForObserver(
                        evt.style,
                        player.id,
                        evt.targetType,
                        evt.targetId,
                        evt.sourcePlayerId,
                        evt.sourceType,
                    ),
                ),
                damage: Math.max(0, evt.damage),
                type2: hasSecondary
                    ? this.clampHitsplatTypeId(
                          resolveHitsplatTypeForObserver(
                              type2Raw,
                              player.id,
                              evt.targetType,
                              evt.targetId,
                              evt.sourcePlayerId,
                              evt.sourceType,
                          ),
                      )
                    : undefined,
                damage2: hasSecondary ? this.clampUShortSmart(damage2Raw) : undefined,
                delayCycles,
            });
            hitsByNpc.set(npcId, entry);
        }

        // NPC status-effect hitsplats
        for (const evt of frame.npcEffectEvents) {
            const npcId = evt?.npcId;
            if (!desiredSet.has(npcId)) continue;
            const hit = evt?.hitsplat;
            if (!hit) continue;
            const damage = Math.max(0, hit.amount);
            const entry = hitsByNpc.get(npcId) ?? [];
            entry.push({
                type: this.clampHitsplatTypeId(hit.style ?? 0),
                damage,
                delayCycles: 0,
            });
            hitsByNpc.set(npcId, entry);
        }

        return { hits: hitsByNpc };
    }

    /**
     * Process spot animations from frame data.
     */
    private processSpotAnimations(
        frame: NpcTickFrameData,
        desiredSet: Set<number>,
        cyclesPerTick: number,
    ): Map<number, SpotAnimBlock[]> {
        const spotsByNpc = new Map<number, SpotAnimBlock[]>();

        for (const evt of frame.spotAnimations) {
            const npcId = evt.npcId;
            if (npcId === undefined) continue;
            if (!desiredSet.has(npcId)) continue;
            const list = spotsByNpc.get(npcId) ?? [];
            const slot = evt.slot !== undefined ? evt.slot & 0xff : 0;
            const spotId = evt.spotId;
            if (spotId < -1) continue;
            // spot animation delays in update blocks are in client cycles (20ms units),
            // but server events supply delays in server ticks.
            const delayServerTicks = evt.delay !== undefined ? Math.max(0, evt.delay) : 0;
            const delayCycles = Math.min(
                0xffff,
                Math.max(0, Math.round(delayServerTicks * cyclesPerTick)),
            );
            list.push({
                slot,
                id: spotId,
                height: evt.height ?? 0,
                delayCycles: delayCycles,
            });
            spotsByNpc.set(npcId, list);
        }

        return spotsByNpc;
    }

    /**
     * Write update blocks for NPCs.
     */
    private writeUpdateBlocks(
        writer: BitWriter,
        pendingUpdateOrder: number[],
        infos: Map<number, NpcUpdateInfo>,
    ): void {
        for (const npcId of pendingUpdateOrder) {
            const npc = this.getNpcById(npcId);
            if (!npc) continue;
            const info = infos.get(npcId);
            if (!info) continue;
            const rawMask = info.mask;
            if (rawMask === 0) continue;

            // Write mask bytes
            const hasThird = (rawMask & 0xffff0000) !== 0;
            const hasSecond = hasThird || (rawMask & 0xff00) !== 0;
            const encodedMask = hasThird ? rawMask | 0x4000 : rawMask;
            const firstByte = ((encodedMask & 0xff) | (hasSecond ? 0x80 : 0)) & 0xff;
            writer.writeByte(firstByte);
            if (hasSecond) writer.writeByte((encodedMask >> 8) & 0xff);
            if (hasThird) writer.writeByte((encodedMask >> 16) & 0xff);

            // FACE_ENTITY (0x8)
            if (rawMask & NPC_MASKS.FACE_ENTITY) {
                const packed = info.targetIndex ?? NO_TARGET_INDEX;
                this.writeShortAddLE(writer, packed & 0xffff);
                this.writeByteAdd(writer, (packed >> 16) & 0xff);
            }

            // HIT_MASK (0x20)
            if (rawMask & NPC_MASKS.HIT) {
                const hits = info.hitsplats ?? [];
                const hitCount = Math.min(255, hits.length);
                this.writeByteSub(writer, hitCount & 0xff);
                for (let i = 0; i < hitCount; i++) {
                    const hit = hits[i];
                    const type = hit?.type ?? -1;
                    const damage = this.clampUShortSmart(hit?.damage ?? 0);
                    const type2Raw = hit?.type2 ?? -1;
                    const damage2Raw = hit?.damage2 ?? -1;
                    const hasSecondary = type2Raw >= 0 && damage2Raw >= 0;
                    if (type < 0) {
                        this.writeUShortSmart(writer, HITSPLAT_SENTINEL_NO_TYPE);
                    } else if (hasSecondary) {
                        this.writeUShortSmart(writer, HITSPLAT_SENTINEL_SECONDARY);
                        this.writeUShortSmart(writer, type);
                        this.writeUShortSmart(writer, damage);
                        this.writeUShortSmart(writer, this.clampHitsplatTypeId(type2Raw));
                        this.writeUShortSmart(writer, this.clampUShortSmart(damage2Raw));
                    } else {
                        this.writeUShortSmart(writer, type);
                        this.writeUShortSmart(writer, damage);
                    }
                    this.writeUShortSmart(writer, this.clampUShortSmart(hit?.delayCycles ?? 0));
                }

                const bars = info.healthBars ?? [];
                const barCount = Math.min(255, bars.length);
                this.writeByteSub(writer, barCount & 0xff);
                for (let i = 0; i < barCount; i++) {
                    const hb = bars[i];
                    this.writeUShortSmart(writer, this.clampUShortSmart(hb?.id ?? 0));
                    const cycleOffset = hb?.removed
                        ? 32767
                        : this.clampUShortSmart(hb?.cycleOffset ?? 0);
                    this.writeUShortSmart(writer, cycleOffset);
                    if (cycleOffset !== 32767) {
                        this.writeUShortSmart(writer, this.clampUShortSmart(hb?.delayCycles ?? 0));
                        writer.writeByteC((hb?.health ?? 0) & 0xff);
                        if (cycleOffset > 0) {
                            writer.writeByteC((hb?.health2 ?? hb?.health ?? 0) & 0xff);
                        }
                    }
                }
            }

            // SAY (0x40) — NPC forced overhead chat
            if (rawMask & NPC_MASKS.SAY) {
                const text = info.say ?? "";
                const bytes = encodeCp1252Bytes(text);
                writer.writeBytes(bytes);
                writer.writeByte(0);
            }

            // COLOR_OVERRIDE (0x100)
            if (rawMask & NPC_MASKS.COLOR_OVERRIDE) {
                const co = info.colorOverride;
                this.writeShortAdd(writer, co?.startCycleOffset ?? 0);
                this.writeShortAdd(writer, co?.endCycleOffset ?? 0);
                writer.writeByteC((co?.hue ?? -1) & 0xff); // readByteNeg
                this.writeByteSub(writer, (co?.sat ?? -1) & 0xff); // readByteSub
                writer.writeByteC((co?.lum ?? -1) & 0xff); // readByteNeg
                this.writeByteSub(writer, (co?.amount ?? 0) & 0xff); // readUnsignedByteSub cast to byte
            }

            // SPOTANIM (0x20000)
            if (rawMask & NPC_MASKS.SPOT_ANIM) {
                const spots = info.spotAnims ?? [];
                const count = Math.min(255, spots.length);
                writer.writeByte(count & 0xff);
                for (let i = 0; i < count; i++) {
                    const spot = spots[i];
                    const slot = (spot?.slot ?? 0) & 0xff;
                    const sid = spot?.id ?? -1;
                    const height = spot?.height ?? 0;
                    const delayCycles = spot?.delayCycles ?? 0;
                    this.writeByteAdd(writer, slot);
                    writer.writeShortLE(sid >= 0 ? sid & 0xffff : 0xffff);
                    const packed = ((height & 0xffff) << 16) | (delayCycles & 0xffff);
                    writer.writeIntME(packed >>> 0);
                }
            }

            // SEQUENCE (0x10)
            if (rawMask & NPC_MASKS.SEQUENCE) {
                const seq = info.seq;
                const seqId = seq?.id ?? -1;
                writer.writeShortBE(seqId >= 0 ? seqId & 0xffff : 0xffff);
                writer.writeByte((seq?.delay ?? 0) & 0xff);
            }
        }
    }

    // Helper methods for byte transforms

    private clampUShortSmart(value: number): number {
        const v = value;
        if (v < 0) return 0;
        if (v > USHORT_SMART_MAX) return USHORT_SMART_MAX;
        return v;
    }

    private clampHitsplatTypeId(value: number): number {
        const v = this.clampUShortSmart(value);
        return v >= HITSPLAT_SENTINEL_NO_TYPE ? 0 : v;
    }

    private writeUShortSmart(writer: BitWriter, value: number): void {
        const v = this.clampUShortSmart(value);
        if (v < 128) {
            writer.writeByte(v & 0xff);
        } else {
            writer.writeShortBE((v + 32768) & 0xffff);
        }
    }

    private writeByteSub(writer: BitWriter, value: number): void {
        writer.writeByte((128 - (value & 0xff)) & 0xff);
    }

    private writeByteAdd(writer: BitWriter, value: number): void {
        writer.writeByte(((value & 0xff) + 128) & 0xff);
    }

    private writeShortAddLE(writer: BitWriter, value: number): void {
        const v = value & 0xffff;
        writer.writeByte(((v & 0xff) + 128) & 0xff);
        writer.writeByte((v >> 8) & 0xff);
    }

    /** OSRS readUnsignedShortAdd: big-endian with low byte +128. */
    private writeShortAdd(writer: BitWriter, value: number): void {
        const v = value & 0xffff;
        writer.writeByte((v >> 8) & 0xff);
        writer.writeByte(((v & 0xff) + 128) & 0xff);
    }
}
