/**
 * Player Packet Encoder
 *
 * Encodes OSRS-style binary player sync packets.
 * Extracted from wsServer.ts buildPlayerSyncPacket method.
 *
 * Reference: `class388.updatePlayers` + `class467.method2621`
 */
import { faceAngleRs } from "../../../../src/rs/utils/rotation";
import {
    MovementDirection,
    deltaToRunDirection,
    directionToDelta,
} from "../../../../src/shared/Direction";
import {
    resolveHitsplatTypeForObserver,
    type HitsplatSourceType,
} from "../../game/combat/OsrsHitsplatIds";
import type { PlayerAppearance, PlayerState } from "../../game/player";
import { BitWriter } from "../BitWriter";
import { PlayerSyncSession } from "../PlayerSyncSession";
import { encodeCp1252Bytes } from "./Cp1252";
import {
    CHUNK_DIRECTION_DELTAS,
    MAX_ADD_PER_CYCLE,
    PLAYER_MASKS,
    PLAYER_VIEW_DISTANCE_TILES,
} from "./constants";
import type {
    ChatMessageData,
    ForcedMovementBlock,
    HealthBarBlock,
    HitsplatBlock,
    PlayerAnimSet,
    PlayerSyncResult,
    PlayerUpdateInfo,
    PlayerViewSnapshot,
    SpotAnimBlock,
    StepRecord,
} from "./types";

/**
 * Movement info for a player.
 */
export interface MovementInfo {
    mode: "idle" | "walk" | "run" | "teleport";
    directions: number[];
    traversals?: number[];
    targetSubX?: number;
    targetSubY?: number;
    level?: number;
    localOffsetX?: number;
    localOffsetY?: number;
    teleportType?: "relative" | "absolute";
    absoluteTileX?: number;
    absoluteTileY?: number;
}

/**
 * Extended tick frame data for player encoding.
 */
export interface PlayerTickFrameData {
    tick: number;
    /** Server tick length in milliseconds (OSRS = 600). */
    tickMs: number;
    playerViews: Map<number, PlayerViewSnapshot>;
    playerSteps: Map<number, StepRecord[]>;
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
    forcedChats: Array<{
        targetId: number;
        text: string;
    }>;
    forcedMovements: Array<{
        targetId: number;
        startDeltaX: number;
        startDeltaY: number;
        endDeltaX: number;
        endDeltaY: number;
        startCycle: number;
        endCycle: number;
        direction: number;
    }>;
    spotAnimations: Array<{
        playerId?: number;
        spotId: number;
        slot?: number;
        height?: number;
        delay?: number;
    }>;
    chatMessages: Array<{
        messageType: string;
        playerId?: number;
        text?: string;
        playerType?: number;
        colorId?: number;
        effectId?: number;
        autoChat?: boolean;
        pattern?: number[];
    }>;
    pendingSequences: Map<number, { seqId: number; delay: number; startTick: number }>;
    interactionIndices: Map<number, number>;
    colorOverrides: Map<
        number,
        {
            hue: number;
            sat: number;
            lum: number;
            amount: number;
            durationTicks: number;
        }
    >;
}

/**
 * Services interface for player packet encoding.
 */
export interface PlayerPacketEncoderServices {
    /** Get a player by ID */
    getPlayer(id: number): PlayerState | undefined;
    /** Get all live players (players + bots) */
    getLivePlayers(): Map<number, PlayerState>;
    /** Build animation payload for a player */
    buildAnimPayload(player: PlayerState): PlayerAnimSet | undefined;
    /** Serialize appearance block for a player view */
    serializeAppearancePayload(view: PlayerViewSnapshot): Uint8Array;
    /** Resolve healthbar width by definition ID */
    resolveHealthBarWidth(defId: number): number;
    /** Encode text with Huffman compression */
    encodeHuffmanChat(text: string): Uint8Array;
}

/**
 * Player Packet Encoder class.
 */
const appearanceHashBuffer = new Int32Array(1);

function foldAppearanceHash(hash: number, value: number): number {
    appearanceHashBuffer[0] = Math.imul(hash, 31) + value;
    return appearanceHashBuffer[0];
}

export class PlayerPacketEncoder {
    constructor(private services: PlayerPacketEncoderServices) {}

    /**
     * Build the player sync packet for a given player.
     */
    buildPlayerSyncPacket(
        session: PlayerSyncSession,
        player: PlayerState,
        frame: PlayerTickFrameData,
    ): PlayerSyncResult {
        const writer = new BitWriter();
        const tickMs = Math.max(1, frame.tickMs);
        const cyclesPerTick = Math.max(1, Math.round(tickMs / 20));
        const localIndex = player.id;
        // OSRS parity: keep scene base stable and only rebase near the scene edge.
        const baseTileX = this.resolveSceneBaseCoordinate(session.baseTileX, player.tileX);
        const baseTileY = this.resolveSceneBaseCoordinate(session.baseTileY, player.tileY);
        session.baseTileX = baseTileX;
        session.baseTileY = baseTileY;

        const views = frame.playerViews;
        const stepsById = frame.playerSteps;
        const interactionIndices = frame.interactionIndices;
        const liveById = this.services.getLivePlayers();

        // Refresh view appearances from live player data
        for (const [id, view] of views) {
            const livePlayer = liveById.get(id);
            if (livePlayer) {
                view.appearance = livePlayer.appearance;
                if (!view.name || view.name.length === 0) {
                    view.name = livePlayer.name;
                }
                view.anim = this.services.buildAnimPayload(livePlayer);
            }
        }

        const pendingUpdates = new Map<number, PlayerUpdateInfo>();
        const pendingUpdateWriteOrder: number[] = [];

        const ensurePending = (id: number): PlayerUpdateInfo => {
            let entry = pendingUpdates.get(id);
            if (!entry) {
                entry = { mask: 0 };
                pendingUpdates.set(id, entry);
            }
            return entry;
        };

        const markMask = (id: number, mask: number): PlayerUpdateInfo => {
            const entry = ensurePending(id);
            entry.mask |= mask;
            return entry;
        };

        // Process one-shot sequence updates
        for (const [playerId, seqData] of frame.pendingSequences) {
            const entry = markMask(playerId, PLAYER_MASKS.ANIMATION);
            entry.anim = seqData;
        }

        // Process face direction updates
        if (player.pendingFaceTile) {
            const entry = markMask(player.id, PLAYER_MASKS.FACE_DIR);
            const ft = player.pendingFaceTile;
            const targetX = (ft.x << 7) + 64;
            const targetY = (ft.y << 7) + 64;
            entry.faceDir = faceAngleRs(player.x, player.y, targetX, targetY) & 2047;
            player.pendingFaceTile = undefined;
        }

        // Forced movement update blocks
        for (const evt of frame.forcedMovements) {
            const pid = evt.targetId;
            if (pid < 0) continue;
            const entry = markMask(pid, PLAYER_MASKS.FORCE_MOVEMENT);
            entry.forcedMovement = {
                startDeltaX: evt.startDeltaX,
                startDeltaY: evt.startDeltaY,
                endDeltaX: evt.endDeltaX,
                endDeltaY: evt.endDeltaY,
                startCycle: evt.startCycle,
                endCycle: evt.endCycle,
                direction: evt.direction,
            };
        }

        // Forced chat update blocks
        for (const evt of frame.forcedChats) {
            const pid = evt.targetId;
            if (pid < 0) continue;
            const text = (evt.text ?? "").toString();
            if (text.length === 0) continue;
            const entry = markMask(pid, PLAYER_MASKS.FORCED_CHAT);
            entry.forcedChat = text;
        }

        // Spot animations
        for (const evt of frame.spotAnimations) {
            const pid = evt.playerId;
            if (pid === undefined || pid < 0) continue;
            const spotId = evt.spotId;
            if (spotId < -1) continue;
            const slot = evt.slot !== undefined ? evt.slot & 0xff : 0;
            const height = evt.height ?? 0;
            // OSRS parity: spot animation delays in update blocks are in client cycles (20ms units),
            // but server events supply delays in server ticks.
            const delayServerTicks = evt.delay !== undefined ? Math.max(0, evt.delay) : 0;
            const delayCycles = Math.min(
                0xffff,
                Math.max(0, Math.round(delayServerTicks * cyclesPerTick)),
            );
            const entry = markMask(pid, PLAYER_MASKS.SPOT_ANIM);
            if (!entry.spotAnims) entry.spotAnims = [];
            entry.spotAnims.push({ slot, id: spotId, height, delayCycles: delayCycles });
        }

        // Hitsplats
        for (const evt of frame.hitsplats) {
            if (evt.targetType !== "player") continue;
            const pid = evt.targetId;
            if (pid < 0) continue;
            const type = this.clampHitsplatTypeId(
                resolveHitsplatTypeForObserver(
                    evt.style,
                    player.id,
                    evt.targetType,
                    evt.targetId,
                    evt.sourcePlayerId,
                    evt.sourceType,
                ),
            );
            const damage = this.clampUShortSmart(evt.damage);
            const evtTick = evt.tick ?? frame.tick;
            const extraDelayTicks = evt.delayTicks !== undefined ? Math.max(0, evt.delayTicks) : 0;
            // OSRS update blocks use client-cycle delays (Client.cycle units), not server ticks.
            const delayServerTicks = Math.max(0, evtTick - frame.tick) + extraDelayTicks;
            const delayCycles = Math.max(0, Math.round(delayServerTicks * cyclesPerTick));
            const type2Raw = evt.type2 ?? -1;
            const damage2Raw = evt.damage2 ?? -1;
            const hasSecondary = type2Raw >= 0 && damage2Raw >= 0;
            const entry = markMask(pid, PLAYER_MASKS.HIT);
            if (!entry.hitsplats) entry.hitsplats = [];
            const type2 = hasSecondary
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
                : undefined;
            entry.hitsplats.push({
                type,
                damage,
                type2,
                damage2: hasSecondary ? this.clampUShortSmart(damage2Raw) : undefined,
                delayCycles: delayCycles,
            });
        }

        // Actor HSL color overrides (poison/freeze/venom tints)
        for (const [pid, co] of frame.colorOverrides) {
            if (pid < 0 || co.amount <= 0) continue;
            const entry = markMask(pid, PLAYER_MASKS.FIELD512);
            entry.field512 = {
                field1180: frame.tick, // startCycle = current tick
                field1233: frame.tick + co.durationTicks, // endCycle
                field1234: co.hue,
                field1193: co.sat,
                field1204: co.lum,
                field1237: co.amount,
            };
        }

        // Public chat messages
        for (const msg of frame.chatMessages) {
            if (msg.messageType !== "public") continue;
            const pid = msg.playerId ?? -1;
            if (pid < 0) continue;
            const text = (msg.text ?? "").toString();
            if (text.length === 0) continue;
            const colorId = msg.colorId !== undefined ? msg.colorId & 0xff : 0;
            const effectId = msg.effectId !== undefined ? msg.effectId & 0xff : 0;
            const packedColor = (((colorId & 0xff) << 8) | (effectId & 0xff)) & 0xffff;
            const expectedExtraLen = colorId >= 13 && colorId <= 20 ? colorId - 12 : 0;
            const entry = markMask(
                pid,
                expectedExtraLen > 0 ? PLAYER_MASKS.EXT_PUBLIC_CHAT : PLAYER_MASKS.PUBLIC_CHAT,
            );
            const playerType =
                msg.playerType !== undefined && msg.playerType >= 0 ? msg.playerType & 0xff : 0;
            entry.chat = {
                packedColor,
                playerType,
                autoChat: msg.autoChat === true,
                payload: this.services.encodeHuffmanChat(text),
                extra:
                    expectedExtraLen > 0 && Array.isArray(msg.pattern)
                        ? Uint8Array.from(msg.pattern.map((v) => v & 0xff))
                        : undefined,
            };
        }

        // Initialize session index lists if needed
        if (session.playersIndices.length === 0 && session.emptyIndices.length === 0) {
            session.targets.fill(-1);
            for (let i = 1; i < 2048; i++) {
                if (i === localIndex) session.playersIndices.push(i);
                else session.emptyIndices.push(i);
            }
        }

        // Build view-based player list
        const localTileX = player.tileX;
        const localTileY = player.tileY;
        const localLevel = player.level & 0x3;
        const viewById = new Map<number, PlayerViewSnapshot>();
        for (const view of views.values()) {
            const id = view.id;
            if (id < 0 || id >= 2048) continue;
            const tileX = view.x >> 7;
            const tileY = view.y >> 7;
            const level = view.level & 0x3;
            if (level !== localLevel) continue;
            const dx = Math.abs(tileX - localTileX);
            const dy = Math.abs(tileY - localTileY);
            const dist = dx > dy ? dx : dy;
            if (dist > PLAYER_VIEW_DISTANCE_TILES && id !== localIndex) continue;
            viewById.set(id, view);
        }

        // Ensure local player always has a view entry
        if (!viewById.has(localIndex)) {
            viewById.set(localIndex, {
                id: localIndex,
                x: player.x,
                y: player.y,
                level: player.level & 0x3,
                rot: player.rot,
                orientation: player.orientation,
                running: !!player.running,
                moved: false,
                turned: false,
                snap: false,
            });
        }

        // Force snap on first sync frame
        if (!session.lastKnownTiles.has(localIndex)) {
            const localView = viewById.get(localIndex);
            if (localView && !localView.snap) {
                viewById.set(localIndex, { ...localView, snap: true });
            }
        }

        // Build active player set
        const activeNow = new Set<number>();
        activeNow.add(localIndex);
        const MAX_LOCAL_PLAYERS = 255;
        const previousPlayers = session.playersIndices.slice();
        for (const id of previousPlayers) {
            if (activeNow.size >= MAX_LOCAL_PLAYERS) break;
            if (id === localIndex) continue;
            if (viewById.has(id)) activeNow.add(id);
        }
        const inViewSorted = Array.from(viewById.keys()).sort((a, b) => a - b);
        let addedThisCycle = 0;
        for (const id of inViewSorted) {
            if (activeNow.size >= MAX_LOCAL_PLAYERS) break;
            if (activeNow.has(id)) continue;
            if (addedThisCycle >= MAX_ADD_PER_CYCLE) break;
            activeNow.add(id);
            addedThisCycle++;
        }

        const previousSet = new Set(previousPlayers);
        const spawnSet = new Set<number>();
        for (const id of activeNow) {
            if (!previousSet.has(id)) spawnSet.add(id);
        }

        // Process health bars
        this.processHealthBars(
            session,
            frame,
            activeNow,
            spawnSet,
            liveById,
            pendingUpdates,
            markMask,
        );

        // Precompute movement snapshots
        const movementById = new Map<number, MovementInfo>();
        for (const id of activeNow) {
            const view = viewById.get(id);
            const steps = stepsById.get(id);
            movementById.set(id, this.resolveMovementInfo(steps, view, baseTileX, baseTileY));
        }

        // Emit interaction + movementType + appearance blocks
        for (const id of activeNow) {
            const interaction = interactionIndices.get(id) ?? -1;
            this.computeInteractionDelta(session, id, interaction, markMask);

            const view = viewById.get(id);
            if (view && (spawnSet.has(id) || this.shouldWriteAppearance(session, id, view))) {
                const entry = markMask(id, PLAYER_MASKS.APPEARANCE);
                entry.appearance = this.services.serializeAppearancePayload(view);
            }

            const movement = movementById.get(id);
            const desiredMovementType = (() => {
                const list = movement?.traversals ?? (view as any)?.traversals;
                if (Array.isArray(list) && list.length > 0) {
                    const last = list[list.length - 1];
                    if (Number.isFinite(last)) {
                        const t = last as number;
                        if (t >= 0 && t <= 2) return t;
                    }
                }
                if (view?.running) return 2;
                return undefined;
            })();
            if (desiredMovementType !== undefined) {
                const prev = session.lastMovementType.get(id);
                if (prev === undefined) {
                    session.lastMovementType.set(id, desiredMovementType);
                    if (desiredMovementType !== 1) {
                        const entry = markMask(id, PLAYER_MASKS.MOVEMENT_TYPE);
                        entry.movementType = desiredMovementType;
                    }
                } else if (prev !== desiredMovementType) {
                    session.lastMovementType.set(id, desiredMovementType);
                    const entry = markMask(id, PLAYER_MASKS.MOVEMENT_TYPE);
                    entry.movementType = desiredMovementType;
                }
            }
        }

        // Helper functions for encoding
        const shouldUpdatePlayer = (id: number): boolean => {
            const view = viewById.get(id);
            if (!view) return true;
            const movement = movementById.get(id);
            const mask = pendingUpdates.get(id)?.mask ?? 0;
            return mask !== 0 || (movement?.mode ?? "idle") !== "idle" || !!view.snap;
        };

        const writeSkipCount = (count: number): void => {
            const c = Math.max(0, Math.min(2047, count));
            if (c === 0) {
                writer.writeBits(2, 0);
            } else if (c < 32) {
                writer.writeBits(2, 1);
                writer.writeBits(5, c & 0x1f);
            } else if (c < 256) {
                writer.writeBits(2, 2);
                writer.writeBits(8, c & 0xff);
            } else {
                writer.writeBits(2, 3);
                writer.writeBits(11, c & 0x7ff);
            }
        };

        const writePlayerUpdate = (id: number): void => {
            const view = viewById.get(id);
            const mask = pendingUpdates.get(id)?.mask ?? 0;
            const needsUpdate = !!view && mask !== 0;
            if (needsUpdate) pendingUpdateWriteOrder.push(id);

            writer.writeBits(1, needsUpdate ? 1 : 0);

            if (!view) {
                // Remove player
                writer.writeBits(2, 0);
                this.writeExternalUpdateOnRemoval(writer, session, id, liveById);
                session.lastInteractionIndex.delete(id);
                session.lastAppearanceHash.delete(id);
                session.lastMovementType.delete(id);
                session.orientations[id] = session.orientations[id];
                session.targets[id] = session.targets[id];
                return;
            }

            const movement = movementById.get(id);
            if (!movement || movement.mode === "idle") {
                writer.writeBits(2, 0);
                return;
            }
            if (movement.mode === "walk") {
                writer.writeBits(2, 1);
                writer.writeBits(3, (movement.directions[0] ?? 0) & 7);
                return;
            }
            if (movement.mode === "run") {
                const dir1 =
                    movement.directions[0] ??
                    movement.directions[movement.directions.length - 1] ??
                    0;
                const dir2 = movement.directions[1] ?? dir1;
                const d1 = directionToDelta((dir1 & 7) as MovementDirection);
                const d2 = directionToDelta((dir2 & 7) as MovementDirection);
                const dx = (d1.dx ?? 0) + (d2.dx ?? 0);
                const dy = (d1.dy ?? 0) + (d2.dy ?? 0);
                const code = deltaToRunDirection(dx, dy);
                if (code >= 0) {
                    writer.writeBits(2, 2);
                    writer.writeBits(4, code & 0xf);
                    return;
                }
                writer.writeBits(2, 1);
                writer.writeBits(3, dir1 & 7);
                return;
            }

            // Teleport
            const toTileX = view.x >> 7;
            const toTileY = view.y >> 7;
            const toPlane = view.level & 0x3;
            let from = session.lastKnownTiles.get(id);
            if (!from && id === localIndex) {
                // Client initializes local player state at level 0, so the delta
                // must be computed from level 0 — not toPlane — on the first frame.
                from = { x: 0, y: 0, level: 0 };
            }
            if (!from) from = { x: toTileX, y: toTileY, level: toPlane };
            const planeDelta = (toPlane - from.level) & 0x3;
            const dx = toTileX - from.x;
            const dy = toTileY - from.y;

            writer.writeBits(2, 3);
            if (dx >= -16 && dx <= 15 && dy >= -16 && dy <= 15) {
                const packed12 = ((planeDelta & 0x3) << 10) | ((dx & 0x1f) << 5) | (dy & 0x1f);
                writer.writeBits(1, 0);
                writer.writeBits(12, packed12 & 0xfff);
            } else {
                const packed30 =
                    ((planeDelta & 0x3) << 28) |
                    (((dx & 0x3fff) >>> 0) << 14) |
                    ((dy & 0x3fff) >>> 0);
                writer.writeBits(1, 1);
                writer.writeBits(30, packed30 >>> 0);
            }
        };

        const shouldUpdateExternal = (id: number): boolean => {
            if (spawnSet.has(id)) return true;
            const live = liveById.get(id);
            if (!live) return false;
            const plane = live.level & 0x3;
            const regionX = (live.tileX >>> 13) & 0xff;
            const regionY = (live.tileY >>> 13) & 0xff;
            const desiredPacked = (plane << 28) | (regionX << 14) | regionY;
            return session.regions[id] !== desiredPacked;
        };

        const writeExternalUpdate = (id: number): boolean => {
            const view = viewById.get(id);
            if (!view) {
                const live = liveById.get(id);
                if (!live) {
                    writer.writeBits(2, 1);
                    writer.writeBits(2, 0);
                    return false;
                }

                const plane = live.level & 0x3;
                const regionX = (live.tileX >>> 13) & 0xff;
                const regionY = (live.tileY >>> 13) & 0xff;
                const desiredPacked = (plane << 28) | (regionX << 14) | regionY;
                const currentPacked = session.regions[id];
                const curPlane = (currentPacked >>> 28) & 0x3;
                const curRegionX = (currentPacked >>> 14) & 0xff;
                const curRegionY = currentPacked & 0xff;
                const planeDelta = (plane - curPlane) & 0x3;
                const dx = (regionX - curRegionX) & 0xff;
                const dy = (regionY - curRegionY) & 0xff;

                this.writeExternalRegionUpdate(writer, planeDelta, dx, dy);
                session.regions[id] = desiredPacked;
                return false;
            }

            const tileX = view.x >> 7;
            const tileY = view.y >> 7;
            const plane = view.level & 0x3;
            const regionX = (tileX >>> 13) & 0xff;
            const regionY = (tileY >>> 13) & 0xff;
            const desiredPacked = (plane << 28) | (regionX << 14) | regionY;
            const currentPacked = session.regions[id];

            writer.writeBits(2, 0);
            const needsCorrection = currentPacked !== desiredPacked;
            writer.writeBits(1, needsCorrection ? 1 : 0);
            if (needsCorrection) {
                const curPlane = (currentPacked >>> 28) & 0x3;
                const curRegionX = (currentPacked >>> 14) & 0xff;
                const curRegionY = currentPacked & 0xff;
                const planeDelta = (plane - curPlane) & 0x3;
                const dx = (regionX - curRegionX) & 0xff;
                const dy = (regionY - curRegionY) & 0xff;
                const packed18 = ((planeDelta & 0x3) << 16) | ((dx & 0xff) << 8) | (dy & 0xff);
                writer.writeBits(2, 3);
                writer.writeBits(18, packed18 & 0x3ffff);
                session.regions[id] = desiredPacked;
            }

            const coordX = tileX & 0x1fff;
            const coordY = tileY & 0x1fff;
            writer.writeBits(13, coordX);
            writer.writeBits(13, coordY);
            writer.writeBits(1, 1);
            pendingUpdateWriteOrder.push(id);
            return true;
        };

        const writePlayerListPass = (wantBit0: 0 | 1): void => {
            let skip = 0;
            for (let i = 0; i < session.playersIndices.length; i++) {
                const id = session.playersIndices[i];
                if (((session.field1355[id] & 1) as 0 | 1) !== wantBit0) continue;
                if (skip > 0) {
                    skip--;
                    session.field1355[id] = (session.field1355[id] | 2) & 0xff;
                    continue;
                }
                if (!shouldUpdatePlayer(id)) {
                    let run = 0;
                    for (let j = i + 1; j < session.playersIndices.length && run < 2047; j++) {
                        const next = session.playersIndices[j];
                        if (((session.field1355[next] & 1) as 0 | 1) !== wantBit0) continue;
                        if (shouldUpdatePlayer(next)) break;
                        run++;
                    }
                    writer.writeBits(1, 0);
                    writeSkipCount(run);
                    session.field1355[id] = (session.field1355[id] | 2) & 0xff;
                    skip = run;
                    continue;
                }
                writer.writeBits(1, 1);
                writePlayerUpdate(id);
            }
            if (skip !== 0) {
                throw new Error(`player sync: players pass skip=${skip}`);
            }
        };

        const writeEmptyListPass = (wantBit0: 0 | 1): void => {
            let skip = 0;
            for (let i = 0; i < session.emptyIndices.length; i++) {
                const id = session.emptyIndices[i];
                if (((session.field1355[id] & 1) as 0 | 1) !== wantBit0) continue;
                if (skip > 0) {
                    skip--;
                    session.field1355[id] = (session.field1355[id] | 2) & 0xff;
                    continue;
                }
                if (!shouldUpdateExternal(id)) {
                    let run = 0;
                    for (let j = i + 1; j < session.emptyIndices.length && run < 2047; j++) {
                        const next = session.emptyIndices[j];
                        if (((session.field1355[next] & 1) as 0 | 1) !== wantBit0) continue;
                        if (shouldUpdateExternal(next)) break;
                        run++;
                    }
                    writer.writeBits(1, 0);
                    writeSkipCount(run);
                    session.field1355[id] = (session.field1355[id] | 2) & 0xff;
                    skip = run;
                    continue;
                }
                writer.writeBits(1, 1);
                const spawned = writeExternalUpdate(id);
                if (spawned) {
                    session.field1355[id] = (session.field1355[id] | 2) & 0xff;
                }
            }
            if (skip !== 0) {
                throw new Error(`player sync: empty pass skip=${skip}`);
            }
        };

        // 4-pass updatePlayers loop
        writePlayerListPass(0);
        writer.alignToByte();
        writePlayerListPass(1);
        writer.alignToByte();
        writeEmptyListPass(1);
        writer.alignToByte();
        writeEmptyListPass(0);

        // Advance session flags + rebuild index lists
        for (let i = 1; i < 2048; i++) {
            session.field1355[i] = (session.field1355[i] >>> 1) & 0xff;
        }
        session.playersIndices.length = 0;
        session.emptyIndices.length = 0;
        for (let i = 1; i < 2048; i++) {
            if (activeNow.has(i)) session.playersIndices.push(i);
            else session.emptyIndices.push(i);
        }
        session.playersIndices.sort((a, b) => a - b);
        session.emptyIndices.sort((a, b) => a - b);

        // Keep per-recipient healthbar history bounded
        for (const id of session.lastHealthBarScaled.keys()) {
            if (!activeNow.has(id)) session.lastHealthBarScaled.delete(id);
        }

        // Update last-known tiles from authoritative views
        for (const view of viewById.values()) {
            session.lastKnownTiles.set(view.id, {
                x: view.x >> 7,
                y: view.y >> 7,
                level: view.level & 0x3,
            });
        }

        writer.alignToByte();

        // Write update blocks
        this.writeUpdateBlocks(
            writer,
            pendingUpdateWriteOrder,
            pendingUpdates,
            frame.tick,
            cyclesPerTick,
        );

        pendingUpdates.clear();

        const bytes = writer.toUint8Array();

        return {
            bytes,
            activeIndices: session.playersIndices.slice(),
            baseTileX,
            baseTileY,
        };
    }

    /**
     * Write external update when removing a player from local list.
     */
    private writeExternalUpdateOnRemoval(
        writer: BitWriter,
        session: PlayerSyncSession,
        id: number,
        liveById: Map<number, PlayerState>,
    ): void {
        let hasExternalUpdate = 0;
        const last = session.lastKnownTiles.get(id);
        if (last) {
            const plane = last.level & 0x3;
            const regionX = (last.x >>> 13) & 0xff;
            const regionY = (last.y >>> 13) & 0xff;
            session.regions[id] = (plane << 28) | (regionX << 14) | regionY;
        }

        const live = liveById.get(id);
        if (live) {
            const desiredPlane = live.level & 0x3;
            const desiredRegionX = (live.tileX >>> 13) & 0xff;
            const desiredRegionY = (live.tileY >>> 13) & 0xff;
            const desiredPacked = (desiredPlane << 28) | (desiredRegionX << 14) | desiredRegionY;
            const currentPacked = session.regions[id];
            if (desiredPacked !== currentPacked) {
                hasExternalUpdate = 1;
                const curPlane = (currentPacked >>> 28) & 0x3;
                const curX = (currentPacked >>> 14) & 0xff;
                const curY = currentPacked & 0xff;
                const planeDelta = (desiredPlane - curPlane) & 0x3;
                const dx = (desiredRegionX - curX) & 0xff;
                const dy = (desiredRegionY - curY) & 0xff;

                writer.writeBits(1, 1);
                this.writeExternalRegionUpdate(writer, planeDelta, dx, dy);
                session.regions[id] = desiredPacked;
            }
        }

        if (!hasExternalUpdate) {
            writer.writeBits(1, 0);
        }
    }

    /**
     * Write external region update (plane/dx/dy).
     */
    private writeExternalRegionUpdate(
        writer: BitWriter,
        planeDelta: number,
        dx: number,
        dy: number,
    ): void {
        if (dx === 0 && dy === 0) {
            writer.writeBits(2, 1);
            writer.writeBits(2, planeDelta & 0x3);
        } else {
            const sdx = dx > 127 ? dx - 256 : dx;
            const sdy = dy > 127 ? dy - 256 : dy;
            let dirIndex = -1;
            if (sdx >= -1 && sdx <= 1 && sdy >= -1 && sdy <= 1 && (sdx !== 0 || sdy !== 0)) {
                for (let i = 0; i < CHUNK_DIRECTION_DELTAS.length; i++) {
                    const d = CHUNK_DIRECTION_DELTAS[i];
                    if (d && d.dx === sdx && d.dy === sdy) {
                        dirIndex = i;
                        break;
                    }
                }
            }
            if (dirIndex >= 0) {
                const packed5 = ((planeDelta & 0x3) << 3) | (dirIndex & 0x7);
                writer.writeBits(2, 2);
                writer.writeBits(5, packed5 & 0x1f);
            } else {
                const packed18 = ((planeDelta & 0x3) << 16) | ((dx & 0xff) << 8) | (dy & 0xff);
                writer.writeBits(2, 3);
                writer.writeBits(18, packed18 & 0x3ffff);
            }
        }
    }

    /**
     * Process health bars for active players.
     */
    private processHealthBars(
        session: PlayerSyncSession,
        frame: PlayerTickFrameData,
        activeNow: Set<number>,
        spawnSet: Set<number>,
        liveById: Map<number, PlayerState>,
        pendingUpdates: Map<number, PlayerUpdateInfo>,
        markMask: (id: number, mask: number) => PlayerUpdateInfo,
    ): void {
        for (const id of activeNow) {
            const actor = liveById.get(id);
            if (!actor) continue;
            const hbDefId = Math.max(0, actor.getHealthBarDefinitionId());
            const hbWidth = this.services.resolveHealthBarWidth(hbDefId);
            const maxHp = Math.max(1, actor.getHitpointsMax());
            const curHp = Math.max(0, actor.getHitpointsCurrent());

            // OSRS Parity: Don't skip when HP is 0 - we need to send health bar update showing 0%
            // before death animation plays. The health bar should animate to empty.
            let scaled = Math.max(
                0,
                Math.min(hbWidth, Math.floor((curHp * hbWidth) / Math.max(1, maxHp))),
            );
            // Ensure minimum of 1 if alive (prevents showing empty bar when still alive)
            if (curHp > 0 && scaled <= 0) scaled = 1;

            const pending = pendingUpdates.get(id);
            const hasHits = !!pending?.hitsplats && pending.hitsplats.length > 0;

            let prevMap = session.lastHealthBarScaled.get(id);
            if (!prevMap) {
                prevMap = new Map<number, number>();
                session.lastHealthBarScaled.set(id, prevMap);
            }

            // Remove old bars if def id changed
            if (prevMap.size > 0) {
                for (const prevDefId of prevMap.keys()) {
                    if (prevDefId === hbDefId) continue;
                    const entry = markMask(id, PLAYER_MASKS.HIT);
                    if (!entry.healthBars) entry.healthBars = [];
                    entry.healthBars.push({
                        id: prevDefId,
                        cycleOffset: 32767,
                        delayCycles: 0,
                        health: 0,
                        health2: 0,
                        removed: true,
                    });
                    prevMap.delete(prevDefId);
                }
            }

            const prev = prevMap.get(hbDefId);
            if (prev === undefined) {
                prevMap.set(hbDefId, scaled);
                if (!hasHits && (!spawnSet.has(id) || scaled >= hbWidth)) continue;
                const entry = markMask(id, PLAYER_MASKS.HIT);
                if (!entry.healthBars) entry.healthBars = [];
                entry.healthBars.push({
                    id: hbDefId,
                    cycleOffset: 0,
                    delayCycles: 0,
                    health: scaled,
                    health2: scaled,
                });
                continue;
            }

            if (prev === scaled) {
                if (!hasHits) continue;
                const entry = markMask(id, PLAYER_MASKS.HIT);
                if (!entry.healthBars) entry.healthBars = [];
                entry.healthBars.push({
                    id: hbDefId,
                    cycleOffset: 0,
                    delayCycles: 0,
                    health: scaled,
                    health2: scaled,
                });
                continue;
            }

            prevMap.set(hbDefId, scaled);
            const entry = markMask(id, PLAYER_MASKS.HIT);
            if (!entry.healthBars) entry.healthBars = [];
            entry.healthBars.push({
                id: hbDefId,
                cycleOffset: 0,
                delayCycles: 0,
                // OSRS parity: most HP updates are sent as immediate snaps (cycleOffset=0),
                // meaning `health2` is omitted on the wire and treated as `health`.
                health: scaled,
                health2: scaled,
            });
        }
    }

    /**
     * Write all update blocks.
     */
    private writeUpdateBlocks(
        writer: BitWriter,
        pendingUpdateWriteOrder: number[],
        pendingUpdates: Map<number, PlayerUpdateInfo>,
        tick: number,
        cyclesPerTick: number,
    ): void {
        for (const id of pendingUpdateWriteOrder) {
            const info = pendingUpdates.get(id);
            const rawMask = info?.mask ?? 0;
            const hasThird = (rawMask & 0xffff0000) !== 0;
            const hasSecond = hasThird || (rawMask & 0xff00) !== 0;
            const encodedMask = hasThird ? rawMask | 0x4000 : rawMask;
            const firstByte = ((encodedMask & 0xff) | (hasSecond ? 0x80 : 0)) & 0xff;
            writer.writeByte(firstByte);
            if (hasSecond) {
                writer.writeByte((encodedMask >> 8) & 0xff);
            }
            if (hasThird) {
                writer.writeByte((encodedMask >> 16) & 0xff);
            }

            if (rawMask & PLAYER_MASKS.FORCED_CHAT) {
                this.writeStringCp1252NullTerminated(writer, info?.forcedChat ?? "");
            }
            if (rawMask & PLAYER_MASKS.FACE_DIR) {
                const dir = info?.faceDir ?? 0;
                writer.writeShortLE(dir & 2047);
            }
            if (rawMask & PLAYER_MASKS.FACE_ENTITY) {
                const face = info?.face ?? -1;
                const packedFace = face >= 0 ? face & 0xffffff : 0xffffff;
                writer.writeShortBE(packedFace & 0xffff);
                writer.writeByte((packedFace >> 16) & 0xff);
            }
            if (rawMask & PLAYER_MASKS.PUBLIC_CHAT) {
                this.writePublicChat(writer, info?.chat);
            }
            if (rawMask & PLAYER_MASKS.ANIMATION) {
                const anim = info?.anim;
                const seqId = anim?.seqId ?? -1;
                this.writeShortLEA(writer, seqId >= 0 ? seqId & 0xffff : 0xffff);
                writer.writeByte((anim?.delay ?? 0) & 0xff);
            }
            if (rawMask & PLAYER_MASKS.EXT_PUBLIC_CHAT) {
                this.writeExtPublicChat(writer, info?.chat);
            }
            if (rawMask & PLAYER_MASKS.HIT) {
                this.writeHitBlock(writer, info?.hitsplats, info?.healthBars);
            }
            if (rawMask & PLAYER_MASKS.MOVEMENT_TYPE) {
                writer.writeByteC((info?.movementType ?? 0) & 0xff);
            }
            if (rawMask & PLAYER_MASKS.APPEARANCE) {
                const bytes = info?.appearance ?? new Uint8Array();
                const len = Math.min(255, bytes.length);
                writer.writeByteC(len);
                if (len > 0) writer.writeBytes(bytes.subarray(0, len));
            }
            if (rawMask & PLAYER_MASKS.ACTIONS) {
                const actions = info?.actions ?? ["", "", ""];
                this.writeStringCp1252NullTerminated(writer, (actions[0] ?? "").toString());
                this.writeStringCp1252NullTerminated(writer, (actions[1] ?? "").toString());
                this.writeStringCp1252NullTerminated(writer, (actions[2] ?? "").toString());
            }
            if (rawMask & PLAYER_MASKS.FORCE_MOVEMENT) {
                this.writeForcedMovement(writer, info?.forcedMovement, tick, cyclesPerTick);
            }
            if (rawMask & PLAYER_MASKS.MOVEMENT_FLAG) {
                this.writeByteS(writer, (info?.movementFlag ?? 0) & 0xff);
            }
            if (rawMask & PLAYER_MASKS.SPOT_ANIM) {
                this.writeSpotAnims(writer, info?.spotAnims);
            }
            if (rawMask & PLAYER_MASKS.FIELD512) {
                this.writeField512(writer, info?.field512, tick, cyclesPerTick);
            }
            pendingUpdates.delete(id);
        }
    }

    // Helper methods for encoding

    private writePublicChat(writer: BitWriter, chat?: ChatMessageData): void {
        const packed = chat?.packedColor ?? 0;
        const playerType = chat?.playerType ?? 0;
        const autoChat = chat?.autoChat ?? false;
        const payload = chat?.payload ?? new Uint8Array();
        const len = Math.min(255, payload.length);
        writer.writeShortLE(packed & 0xffff);
        this.writeByteS(writer, playerType & 0xff);
        this.writeByteS(writer, autoChat ? 1 : 0);
        writer.writeByteC(len & 0xff);
        if (len > 0) writer.writeBytes(payload.subarray(0, len));
    }

    private writeExtPublicChat(writer: BitWriter, chat?: ChatMessageData): void {
        const packed = chat?.packedColor ?? 0;
        const playerType = chat?.playerType ?? 0;
        const autoChat = chat?.autoChat ?? false;
        const extra = chat?.extra ?? new Uint8Array();
        const payload = chat?.payload ?? new Uint8Array();
        const len = Math.min(255, payload.length);
        const colorId = (packed >>> 8) & 0xff;
        const expectedExtraLen = colorId >= 13 && colorId <= 20 ? colorId - 12 : 0;

        writer.writeShortLE(packed & 0xffff);
        writer.writeByteC(playerType & 0xff);
        this.writeByteS(writer, autoChat ? 1 : 0);
        writer.writeByteC(len & 0xff);
        if (len > 0) writer.writeBytes(payload.subarray(0, len));
        if (expectedExtraLen > 0) {
            for (let i = 0; i < expectedExtraLen; i++) {
                const value = extra.length === expectedExtraLen ? (extra[i] ?? 0) & 0xff : 0;
                this.writeByteA(writer, value);
            }
        }
    }

    private writeHitBlock(
        writer: BitWriter,
        hitsplats?: HitsplatBlock[],
        healthBars?: HealthBarBlock[],
    ): void {
        const hits = Array.isArray(hitsplats) ? hitsplats : [];
        const count = Math.min(255, hits.length);
        writer.writeByteC(count & 0xff);
        for (let i = 0; i < count; i++) {
            const hit = hits[i];
            const t1 = hit?.type ?? 0;
            const v1 = this.clampUShortSmart(hit?.damage ?? 0);
            const t2 = hit?.type2 ?? -1;
            const d2Raw = hit?.damage2 ?? -1;
            const hasSecondary = t2 >= 0 && d2Raw >= 0;
            if (hasSecondary) {
                this.writeUShortSmart(writer, 32767);
                this.writeUShortSmart(writer, this.clampHitsplatTypeId(t1));
                this.writeUShortSmart(writer, v1);
                this.writeUShortSmart(writer, this.clampHitsplatTypeId(t2));
                this.writeUShortSmart(writer, this.clampUShortSmart(d2Raw));
            } else if (t1 >= 0) {
                this.writeUShortSmart(writer, this.clampHitsplatTypeId(t1));
                this.writeUShortSmart(writer, v1);
            } else {
                this.writeUShortSmart(writer, 32766);
            }
            this.writeUShortSmart(writer, this.clampUShortSmart(hit?.delayCycles ?? 0));
        }

        const bars = Array.isArray(healthBars) ? healthBars : [];
        const hbCount = Math.min(255, bars.length);
        this.writeByteS(writer, hbCount & 0xff);
        for (let i = 0; i < hbCount; i++) {
            const hb = bars[i];
            const id = this.clampUShortSmart(hb?.id ?? 0);
            const cycleOffset =
                hb?.removed === true ? 32767 : this.clampUShortSmart(hb?.cycleOffset ?? 0);
            this.writeUShortSmart(writer, id);
            this.writeUShortSmart(writer, cycleOffset);
            if (cycleOffset !== 32767) {
                this.writeUShortSmart(writer, this.clampUShortSmart(hb?.delayCycles ?? 0));
                this.writeByteS(writer, (hb?.health ?? 0) & 0xff);
                if (cycleOffset > 0) {
                    writer.writeByteC((hb?.health2 ?? hb?.health ?? 0) & 0xff);
                }
            }
        }
    }

    private writeForcedMovement(
        writer: BitWriter,
        fm?: ForcedMovementBlock,
        tick?: number,
        cyclesPerTick?: number,
    ): void {
        const startDX = fm ? fm.startDeltaX : 0;
        const startDY = fm ? fm.startDeltaY : 0;
        const endDX = fm ? fm.endDeltaX : 0;
        const endDY = fm ? fm.endDeltaY : 0;
        const cpt = Math.max(1, cyclesPerTick ?? 30);
        const currentTick = tick ?? 0;
        const startOffTicks = fm ? Math.max(0, fm.startCycle - currentTick) : 0;
        const endOffTicks = fm ? Math.max(0, fm.endCycle - currentTick) : 0;
        const startOff = Math.max(0, Math.round(startOffTicks * cpt)) & 0xffff;
        const endOff = Math.max(0, Math.round(endOffTicks * cpt)) & 0xffff;
        const dir = fm ? fm.direction & 2047 : 0;
        this.writeByteS(writer, startDX);
        writer.writeByte(startDY & 0xff);
        writer.writeByte(endDX & 0xff);
        this.writeByteA(writer, endDY);
        this.writeShortBEA(writer, startOff & 0xffff);
        writer.writeShortBE(endOff & 0xffff);
        this.writeShortLEA(writer, dir & 0xffff);
    }

    private writeSpotAnims(writer: BitWriter, spotAnims?: SpotAnimBlock[]): void {
        const list = Array.isArray(spotAnims) ? spotAnims : [];
        const count = Math.min(255, list.length);
        this.writeByteA(writer, count & 0xff);
        for (let i = 0; i < count; i++) {
            const spot = list[i];
            const slot = spot?.slot ?? 0;
            const sid = spot?.id ?? -1;
            const height = spot?.height ?? 0;
            const delayCycles = spot?.delayCycles ?? 0;
            writer.writeByte(slot & 0xff);
            writer.writeShortBE(sid >= 0 ? sid & 0xffff : 0xffff);
            const packed = ((height & 0xffff) << 16) | (delayCycles & 0xffff);
            writer.writeIntME(packed >>> 0);
        }
    }

    private writeField512(
        writer: BitWriter,
        entry?: PlayerUpdateInfo["field512"],
        tick?: number,
        cyclesPerTick?: number,
    ): void {
        const cpt = Math.max(1, cyclesPerTick ?? 30);
        const frameTick = tick ?? 0;
        const t1 = entry?.field1180 ?? frameTick;
        const t2 = entry?.field1233 ?? frameTick;
        const off1 = Math.max(0, Math.round(Math.max(0, t1 - frameTick) * cpt)) & 0xffff;
        const off2 = Math.max(0, Math.round(Math.max(0, t2 - frameTick) * cpt)) & 0xffff;
        writer.writeShortLE(off1);
        writer.writeShortLE(off2);
        this.writeByteS(writer, (entry?.field1234 ?? 0) & 0xff);
        writer.writeByte((entry?.field1193 ?? 0) & 0xff);
        this.writeByteA(writer, (entry?.field1204 ?? 0) & 0xff);
        writer.writeByteC((entry?.field1237 ?? 0) & 0xff);
    }

    // Byte transform helpers

    private writeByteA(writer: BitWriter, value: number): void {
        writer.writeByte((value + 128) & 0xff);
    }

    private writeByteS(writer: BitWriter, value: number): void {
        writer.writeByte((128 - value) & 0xff);
    }

    private writeShortLEA(writer: BitWriter, value: number): void {
        const v = value & 0xffff;
        writer.writeByte(((v & 0xff) + 128) & 0xff);
        writer.writeByte((v >> 8) & 0xff);
    }

    private writeShortBEA(writer: BitWriter, value: number): void {
        const v = value & 0xffff;
        writer.writeByte((v >> 8) & 0xff);
        writer.writeByte(((v & 0xff) + 128) & 0xff);
    }

    private writeUShortSmart(writer: BitWriter, value: number): void {
        const v = value;
        if (v >= 0 && v < 128) {
            writer.writeByte(v & 0xff);
            return;
        }
        if (v >= 0 && v < 32768) {
            writer.writeShortBE((v + 32768) & 0xffff);
            return;
        }
        throw new Error(`writeUShortSmart out of range: ${v}`);
    }

    private writeStringCp1252NullTerminated(writer: BitWriter, text: string): void {
        const bytes = encodeCp1252Bytes(text ?? "");
        writer.writeBytes(bytes);
        writer.writeByte(0);
    }

    private resolveSceneBaseCoordinate(currentBase: number, playerTile: number): number {
        const centeredBase = Math.max(0, (playerTile - 48) & ~7);
        const base = currentBase;
        if (base < 0) {
            return centeredBase;
        }
        const local = playerTile - base;
        if (local < 16 || local >= 88) {
            return centeredBase;
        }
        return base;
    }

    // Movement resolution

    private resolveMovementInfo(
        steps: StepRecord[] | undefined,
        view: PlayerViewSnapshot | undefined,
        baseTileX: number,
        baseTileY: number,
    ): MovementInfo {
        const directions: number[] = [];
        const traversals: number[] = [];
        if (Array.isArray(steps)) {
            for (const step of steps) {
                if (step.direction === undefined) continue;
                directions.push(step.direction & 7);
                const rawTraversal =
                    step.traversal !== undefined ? step.traversal & 3 : step.running ? 2 : 1;
                traversals.push(rawTraversal);
            }
        }
        const finalStep =
            Array.isArray(steps) && steps.length > 0 ? steps[steps.length - 1] : undefined;
        const targetSubX = finalStep ? finalStep.x : view ? view.x : (baseTileX << 7) + 64;
        const targetSubY = finalStep ? finalStep.y : view ? view.y : (baseTileY << 7) + 64;
        const targetTileX = targetSubX >> 7;
        const targetTileY = targetSubY >> 7;
        const level = finalStep ? finalStep.level : view ? view.level : 0;
        const localOffsetX = (targetTileX - baseTileX + 128) & 0x7f & 0x7f;
        const localOffsetY = (targetTileY - baseTileY + 128) & 0x7f & 0x7f;
        const deltaX = targetTileX - baseTileX;
        const deltaY = targetTileY - baseTileY;
        const needsAbsoluteTeleport =
            view?.snap && (deltaX < -64 || deltaX > 63 || deltaY < -64 || deltaY > 63);

        if (view?.snap) {
            return {
                mode: "teleport",
                directions: directions.slice(0, 2),
                traversals: traversals.slice(0, 2),
                targetSubX,
                targetSubY,
                level,
                localOffsetX,
                localOffsetY,
                teleportType: needsAbsoluteTeleport ? "absolute" : "relative",
                absoluteTileX: targetTileX,
                absoluteTileY: targetTileY,
            };
        }

        if (directions.length >= 2) {
            return {
                mode: "run",
                directions: directions.slice(0, 2),
                traversals: traversals.slice(0, 2),
                targetSubX,
                targetSubY,
                level,
                localOffsetX,
                localOffsetY,
            };
        }

        if (directions.length === 1) {
            return {
                mode: "walk",
                directions: directions.slice(0, 1),
                traversals: traversals.slice(0, 1),
                targetSubX,
                targetSubY,
                level,
                localOffsetX,
                localOffsetY,
            };
        }

        return {
            mode: "idle",
            directions: [],
            traversals: [],
            targetSubX,
            targetSubY,
            level,
            localOffsetX,
            localOffsetY,
        };
    }

    // Interaction delta computation

    private computeInteractionDelta(
        session: PlayerSyncSession,
        id: number,
        nextIndex: number,
        markMask: (id: number, mask: number) => PlayerUpdateInfo,
    ): boolean {
        const normalized = nextIndex >= 0 ? nextIndex : -1;
        const last = session.lastInteractionIndex.get(id);
        if (normalized < 0) {
            if (last === undefined) return false;
            session.lastInteractionIndex.delete(id);
            const entry = markMask(id, PLAYER_MASKS.FACE_ENTITY);
            entry.face = -1;
            return true;
        }
        if (last === normalized) {
            return false;
        }
        session.lastInteractionIndex.set(id, normalized);
        const entry = markMask(id, PLAYER_MASKS.FACE_ENTITY);
        entry.face = normalized;
        return true;
    }

    // Appearance check

    private computeAppearanceHash(
        appearance: PlayerAppearance | undefined,
        name: string | undefined,
    ): number {
        let hash = 0;
        if (appearance) {
            hash = appearance.gender;
            hash = foldAppearanceHash(hash, appearance.headIcons?.prayer ?? -1);
            hash = foldAppearanceHash(hash, appearance.headIcons?.skull ?? -1);
            if (appearance.kits) {
                for (let i = 0; i < appearance.kits.length; i++) {
                    hash = foldAppearanceHash(hash, appearance.kits[i]);
                }
            }
            if (appearance.equip) {
                for (let i = 0; i < appearance.equip.length; i++) {
                    hash = foldAppearanceHash(hash, appearance.equip[i]);
                }
            }
            if (appearance.equipQty) {
                for (let i = 0; i < appearance.equipQty.length; i++) {
                    hash = foldAppearanceHash(hash, appearance.equipQty[i]);
                }
            }
            if (appearance.colors) {
                for (let i = 0; i < appearance.colors.length; i++) {
                    hash = foldAppearanceHash(hash, appearance.colors[i]);
                }
            }
        }
        if (name) {
            for (let i = 0; i < name.length; i++) {
                hash = hash * 31 + name.charCodeAt(i);
            }
        }
        return hash >>> 0;
    }

    private shouldWriteAppearance(
        session: PlayerSyncSession,
        id: number,
        view: PlayerViewSnapshot,
    ): boolean {
        const hash = this.computeAppearanceHash(view.appearance, view.name);
        const last = session.lastAppearanceHash.get(id);
        if (hash === last) return false;
        session.lastAppearanceHash.set(id, hash);
        return true;
    }

    // Value clamping helpers

    private clampUShortSmart(value: number): number {
        if (!Number.isFinite(value)) return 0;
        return Math.max(0, Math.min(32767, value));
    }

    private clampHitsplatTypeId(value: number): number {
        const v = this.clampUShortSmart(value);
        return v >= 32766 ? 0 : v;
    }
}
