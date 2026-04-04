import { normalizePublicChatTextOsrs } from "../../rs/chat/ChatText";
import { MovementDirection, directionToDelta, runDirectionToDelta, runDirectionToWalkDirections } from "../../shared/Direction";
import { BitStream } from "./BitStream";
import { getPlayerSyncHuffman } from "./HuffmanProvider";
import { PlayerSyncContext, type PlayerSyncState } from "./PlayerSyncContext";
import {
    type AnimationUpdate,
    type ChatUpdate,
    type ForcedMovementUpdate,
    type HealthBarUpdate,
    type HitsplatUpdate,
    MovementMode,
    type PlayerMovementEvent,
    type PlayerSpawnEvent,
    type PlayerSyncFrame,
    type PlayerUpdateBlock,
    PlayerUpdateMask,
    type SpotAnimationUpdate,
} from "./PlayerSyncTypes";

const SCENE_SIZE = 104;

function toSignedByte(value: number): number {
    return value > 127 ? value - 256 : value;
}

function toSignedShort(value: number): number {
    return value > 32767 ? value - 65536 : value;
}

function toSubCoord(tile: number): number {
    return (tile << 7) + 64;
}

function clampTraversal(value: number | undefined): number | undefined {
    if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
    const v = value | 0;
    if (v < -1 || v > 2) return undefined;
    return v;
}

function resolveTraversalDefault(state: PlayerSyncState): number {
    const raw = clampTraversal(state.movementType);
    return raw === undefined || raw < 0 ? 1 : raw | 0;
}

export interface PlayerUpdateDecodeOptions {
    /** Packet payload size in bytes. Required to mirror the reference bitstream guard. */
    packetSize: number;
    /** Current server tick used for translating delay counters (loopCycle in the reference client). */
    loopCycle: number;
    /** Current client cycle (20 ms) when the packet is decoded (mirrors Client.cycle). */
    clientCycle?: number;
}

/**
 * Player synchronisation decoder mirroring the legacy Java client routines:
 *
 * - {@code Client.method117}: local-player step/teleport stream
 * - {@code Client.method134}: active player list deltas
 * - {@code Client.method91}: new player spawns within the viewport
 *
 * The resulting events line up with the bit-stream emitted by
 * {@code PlayerHandler.updatePlayer} / {@code Player.appendPlayerUpdateBlock}
 * in the reference zaros-server.
 */
export class PlayerUpdateDecoder {
    constructor(private readonly maxPlayers: number = 2048) {}

    /**
     * Returns true when a tile coordinate is outside the current 104x104 scene window.
     * Mirrors the reference client guard so invalid deltas do not corrupt path queues.
     */
    private isOutsideScene(context: PlayerSyncContext, tileX: number, tileY: number): boolean {
        const localX = (tileX | 0) - (context.baseX | 0);
        const localY = (tileY | 0) - (context.baseY | 0);
        return localX < 0 || localX >= SCENE_SIZE || localY < 0 || localY >= SCENE_SIZE;
    }

    decode(
        buffer: ArrayBuffer | Uint8Array,
        context: PlayerSyncContext,
        options: PlayerUpdateDecodeOptions,
    ): PlayerSyncFrame {
        const stream = new BitStream(buffer);
        const movements: PlayerMovementEvent[] = [];
        const spawns: PlayerSpawnEvent[] = [];
        const updateBlocks = new Map<number, PlayerUpdateBlock>();

        context.beginCycle();
        context.ensureInitialIndexLists();

        stream.initBitAccess();
        this.readUpdatePlayers(stream, context, movements, spawns);
        stream.finishBitAccess();
        // OSRS parity: shift `field1355` and rebuild Players_indices/emptyIndices.
        context.endUpdatePlayersCycle();

        const clientCycle = Number.isFinite(options.clientCycle)
            ? (options.clientCycle as number)
            : options.loopCycle;
        this.readUpdateBlocks(
            stream,
            context,
            updateBlocks,
            movements,
            options.loopCycle,
            clientCycle,
        );
        // OSRS parity: packet must be fully consumed (class388.updatePlayers final length check).
        const expected = options.packetSize | 0 || stream.length;
        if ((stream.bytePosition | 0) !== (expected | 0)) {
            throw new RangeError(
                `player sync: packet offset=${stream.bytePosition | 0} expected=${expected | 0}`,
            );
        }

        const removals = context.pendingRemovalIndices.map((index) => ({ index }));

        return {
            baseX: context.baseX,
            baseY: context.baseY,
            localIndex: context.localIndex | 0,
            loopCycle: options.loopCycle | 0,
            clientCycle,
            movements,
            spawns,
            removals,
            updateBlocks,
        };
    }

    private readSkipCount(stream: BitStream): number {
        const kind = stream.readBits(2) & 0x3;
        if (kind === 0) return 0;
        if (kind === 1) return stream.readBits(5) & 0x1f;
        if (kind === 2) return stream.readBits(8) & 0xff;
        return stream.readBits(11) & 0x7ff;
    }

    private readUpdatePlayers(
        stream: BitStream,
        context: PlayerSyncContext,
        movements: PlayerMovementEvent[],
        spawns: PlayerSpawnEvent[],
    ): void {
        const flags = context.flags;
        const players = context.playersIndices.slice();
        const empty = context.emptyIndices.slice();
        let skip = 0;

        const processPlayers = (wantBit0: 0 | 1): void => {
            for (let i = 0; i < players.length; i++) {
                const index = players[i] | 0;
                if (((flags[index] & 1) as 0 | 1) !== wantBit0) continue;
                if (skip > 0) {
                    skip--;
                    flags[index] = (flags[index] | 2) & 0xff;
                    continue;
                }
                const hasUpdate = stream.readBits(1);
                if (hasUpdate === 0) {
                    skip = this.readSkipCount(stream);
                    flags[index] = (flags[index] | 2) & 0xff;
                } else {
                    try {
                        this.readPlayerUpdate(stream, context, index, movements, spawns);
                    } catch (err) {
                        const message = (err as any)?.message?.toString?.() ?? String(err);
                        throw new RangeError(
                            `player sync: readPlayerUpdate pass=players wantBit0=${wantBit0} index=${index} skip=${skip} (${message})`,
                        );
                    }
                }
            }
            // OSRS parity: skip counter must end at 0 (class388.updatePlayers).
            if (skip !== 0) {
                throw new RangeError(`player sync: players pass skip=${skip}`);
            }
            skip = 0;
        };

        const processEmpty = (wantBit0: 0 | 1): void => {
            for (let i = 0; i < empty.length; i++) {
                const index = empty[i] | 0;
                if (((flags[index] & 1) as 0 | 1) !== wantBit0) continue;
                if (skip > 0) {
                    skip--;
                    flags[index] = (flags[index] | 2) & 0xff;
                    continue;
                }
                const hasUpdate = stream.readBits(1);
                if (hasUpdate === 0) {
                    skip = this.readSkipCount(stream);
                    flags[index] = (flags[index] | 2) & 0xff;
                } else {
                    let spawned = false;
                    try {
                        spawned = this.readExternalPlayerUpdate(stream, context, index, spawns);
                    } catch (err) {
                        const message = (err as any)?.message?.toString?.() ?? String(err);
                        throw new RangeError(
                            `player sync: readExternalPlayerUpdate pass=empty wantBit0=${wantBit0} index=${index} skip=${skip} (${message})`,
                        );
                    }
                    // OSRS parity: only set bit2 when updateExternalPlayer returned true (spawned).
                    if (spawned) flags[index] = (flags[index] | 2) & 0xff;
                }
            }
            // OSRS parity: skip counter must end at 0 (class388.updatePlayers).
            if (skip !== 0) {
                throw new RangeError(`player sync: empty pass skip=${skip}`);
            }
            skip = 0;
        };

        // Mirrors `class388.updatePlayers` 4-pass structure.
        processPlayers(0);
        stream.finishBitAccess();
        stream.initBitAccess();

        processPlayers(1);
        stream.finishBitAccess();
        stream.initBitAccess();

        processEmpty(1);
        stream.finishBitAccess();
        stream.initBitAccess();

        processEmpty(0);
    }

    private readPlayerUpdate(
        stream: BitStream,
        context: PlayerSyncContext,
        index: number,
        movements: PlayerMovementEvent[],
        spawns: PlayerSpawnEvent[],
    ): void {
        const needsUpdate = stream.readBits(1) === 1;
        if (needsUpdate) context.markForUpdate(index);

        const moveType = stream.readBits(2) & 0x3;
        const state = context.stateFor(index);
        if (!state.active) {
            // Edge case: server referenced a slot that the client considered inactive.
            state.active = true;
        }
        const isLocal = (context.localIndex | 0) === (index | 0);
        const localOutOfBounds =
            isLocal &&
            ((state.tileX | 0) - (context.baseX | 0) < 12 ||
                (state.tileX | 0) - (context.baseX | 0) >= 92 ||
                (state.tileY | 0) - (context.baseY | 0) < 12 ||
                (state.tileY | 0) - (context.baseY | 0) >= 92);

        if (moveType === 0) {
            if (needsUpdate) {
                state.pendingMove = undefined;
                return;
            }
            if (isLocal) {
                // Local player cannot be removed.
                return;
            }

            // Active player removal: store external region/orientation/target for later respawn.
            const plane = (state.level | 0) & 0x3;
            const regionX = (state.tileX >>> 13) & 0xff;
            const regionY = (state.tileY >>> 13) & 0xff;
            state.regionPacked = (plane << 28) | (regionX << 14) | regionY;
            state.cachedOrientation = state.orientation & 2047;
            state.targetIndex = typeof state.targetIndex === "number" ? state.targetIndex | 0 : -1;

            context.deactivate(index);

            const hasExternalUpdate = stream.readBits(1) === 1;
            if (hasExternalUpdate) {
                this.readExternalPlayerUpdate(stream, context, index, spawns);
            }
            return;
        }

        if (moveType === 1) {
            const dir = stream.readBits(3) & 0x7;
            const delta = directionToDelta((dir & 0x7) as MovementDirection);
            if (!delta) return;
            const targetX = (state.tileX + (delta.dx | 0)) | 0;
            const targetY = (state.tileY + (delta.dy | 0)) | 0;
            if (needsUpdate && !localOutOfBounds) {
                state.pendingMove = {
                    tileX: targetX,
                    tileY: targetY,
                    directions: [(dir & 0x7) | 0],
                    movedTwoTiles: false,
                };
            } else {
                // OSRS parity: movementType (-1/0/1/2) mirrors class231.rsOrdinal(), but -1 means
                // "use default" (field2458 = 1) and must not leak into per-step traversal.
                const rawTraversal = clampTraversal(state.movementType);
                const traversal =
                    rawTraversal === undefined || (rawTraversal | 0) < 0 ? 1 : rawTraversal | 0;
                const running = traversal === 2;
                this.applyStep(context, state, dir, running, traversal, index, movements);
            }
            return;
        }

        if (moveType === 2) {
            const code = stream.readBits(4) & 0xf;
            const delta = runDirectionToDelta(code);
            if (!delta) return;
            const targetX = (state.tileX + (delta.dx | 0)) | 0;
            const targetY = (state.tileY + (delta.dy | 0)) | 0;
            // Decode the combined run code into 2 walk directions so the
            // movement sync receives explicit per-step data.  This avoids
            // client-side route reconstruction which fails inside WorldViews
            // (client collision doesn't have WorldView blocking).
            const walkDirs = runDirectionToWalkDirections(code);
            const dirs: number[] = walkDirs
                ? [walkDirs[0] & 7, walkDirs[1] & 7]
                : [];
            const traversal = resolveTraversalDefault(state);
            if (needsUpdate && !localOutOfBounds) {
                state.pendingMove = {
                    tileX: targetX,
                    tileY: targetY,
                    directions: dirs,
                    movedTwoTiles: true,
                };
            } else {
                this.applyMultiStepDelta(
                    context,
                    state,
                    targetX,
                    targetY,
                    dirs,
                    traversal,
                    index,
                    movements,
                );
            }
            return;
        }

        // moveType === 3: teleport / plane+large displacement.
        const absolute = stream.readBits(1) === 1;
        let targetX = state.tileX | 0;
        let targetY = state.tileY | 0;
        let targetPlane = state.level | 0;
        if (!absolute) {
            const packed = stream.readBits(12) & 0xfff;
            const planeDelta = (packed >>> 10) & 0x3;
            let dx = (packed >>> 5) & 0x1f;
            if (dx > 15) dx -= 32;
            let dy = packed & 0x1f;
            if (dy > 15) dy -= 32;
            targetX = (targetX + (dx | 0)) | 0;
            targetY = (targetY + (dy | 0)) | 0;
            targetPlane = ((targetPlane + planeDelta) | 0) & 0x3;
        } else {
            const packed = stream.readBits(30) >>> 0;
            const planeDelta = (packed >>> 28) & 0x3;
            const dx = (packed >>> 14) & 0x3fff;
            const dy = packed & 0x3fff;
            targetX = ((targetX + dx) & 0x3fff) | 0;
            targetY = ((targetY + dy) & 0x3fff) | 0;
            targetPlane = ((targetPlane + planeDelta) | 0) & 0x3;
        }

        state.level = targetPlane;

        if (needsUpdate && !localOutOfBounds) {
            state.pendingMove = {
                tileX: targetX,
                tileY: targetY,
                directions: [],
                movedTwoTiles: false,
                teleported: true,
                snap: true,
            };
        } else {
            state.tileX = targetX;
            state.tileY = targetY;
            state.running = false;
            state.hasKnownPosition = true;
            movements.push({
                index,
                mode: "teleport",
                tile: { x: targetX, y: targetY, level: targetPlane },
                subX: toSubCoord(targetX),
                subY: toSubCoord(targetY),
                snap: true,
            });
        }
    }

    private readExternalPlayerUpdate(
        stream: BitStream,
        context: PlayerSyncContext,
        index: number,
        spawns: PlayerSpawnEvent[],
    ): boolean {
        const type = stream.readBits(2) & 0x3;
        const state = context.stateFor(index);
        const packed0 = state.regionPacked ?? 0;
        const plane0 = (packed0 >>> 28) & 0x3;
        const regionX0 = (packed0 >>> 14) & 0xff;
        const regionY0 = packed0 & 0xff;

        if (type === 0) {
            const recurse = stream.readBits(1) === 1;
            if (recurse) {
                this.readExternalPlayerUpdate(stream, context, index, spawns);
            }
            const packed = state.regionPacked ?? 0;
            const plane = (packed >>> 28) & 0x3;
            const regionX = (packed >>> 14) & 0xff;
            const regionY = packed & 0xff;
            const coordX = stream.readBits(13) & 0x1fff;
            const coordY = stream.readBits(13) & 0x1fff;
            const hasWorldView = stream.readBits(1) === 1;
            let worldViewId = -1;
            if (hasWorldView) {
                worldViewId = stream.readBits(16) & 0xffff;
                if (worldViewId === 0) worldViewId = -1;
            }
            const needsUpdate = stream.readBits(1) === 1;

            const worldX = (regionX << 13) | coordX | 0;
            const worldY = (regionY << 13) | coordY | 0;

            if (!state.active) {
                state.active = true;
            }
            state.tileX = worldX;
            state.tileY = worldY;
            state.level = plane;
            state.running = false;
            state.hasKnownPosition = true;
            state.pendingMove = undefined;
            if (typeof state.cachedOrientation === "number") {
                state.orientation = state.cachedOrientation & 2047;
            }

            if (needsUpdate) context.markForUpdate(index);

            spawns.push({
                index,
                tile: { x: worldX, y: worldY, level: plane },
                preserveQueue: false,
                needsAppearance: true,
                worldViewId,
            });
            return true;
        }

        if (type === 1) {
            const planeDelta = stream.readBits(2) & 0x3;
            const plane = ((plane0 + planeDelta) | 0) & 0x3;
            state.regionPacked = (plane << 28) | (packed0 & 0x0fffffff);
            return false;
        }

        if (type === 2) {
            const packed = stream.readBits(5) & 0x1f;
            const planeDelta = (packed >>> 3) & 0x3;
            const dir = packed & 0x7;
            let regionX = regionX0;
            let regionY = regionY0;
            if (dir === 0) {
                regionX = (regionX - 1) & 0xff;
                regionY = (regionY - 1) & 0xff;
            } else if (dir === 1) {
                regionY = (regionY - 1) & 0xff;
            } else if (dir === 2) {
                regionX = (regionX + 1) & 0xff;
                regionY = (regionY - 1) & 0xff;
            } else if (dir === 3) {
                regionX = (regionX - 1) & 0xff;
            } else if (dir === 4) {
                regionX = (regionX + 1) & 0xff;
            } else if (dir === 5) {
                regionX = (regionX - 1) & 0xff;
                regionY = (regionY + 1) & 0xff;
            } else if (dir === 6) {
                regionY = (regionY + 1) & 0xff;
            } else if (dir === 7) {
                regionX = (regionX + 1) & 0xff;
                regionY = (regionY + 1) & 0xff;
            }
            const plane = ((plane0 + planeDelta) | 0) & 0x3;
            state.regionPacked = (plane << 28) | (regionX << 14) | regionY;
            return false;
        }

        // type === 3
        const packed = stream.readBits(18) & 0x3ffff;
        const planeDelta = (packed >>> 16) & 0x3;
        const dx = (packed >>> 8) & 0xff;
        const dy = packed & 0xff;
        const plane = ((plane0 + planeDelta) | 0) & 0x3;
        const regionX = (regionX0 + dx) & 0xff;
        const regionY = (regionY0 + dy) & 0xff;
        state.regionPacked = (plane << 28) | (regionX << 14) | regionY;
        return false;
    }

    private readUpdateBlocks(
        stream: BitStream,
        context: PlayerSyncContext,
        blocks: Map<number, PlayerUpdateBlock>,
        movements: PlayerMovementEvent[],
        loopCycle: number,
        clientCycle: number,
    ): void {
        for (const index of context.pendingUpdateIndices) {
            const state = context.stateFor(index);
            if (!state.active) continue;
            const startOffset = stream.bytePosition | 0;
            try {
                let mask = stream.readUnsignedByte();
                if ((mask & 0x80) !== 0) {
                    mask |= stream.readUnsignedByte() << 8;
                }
                if ((mask & 0x4000) !== 0) {
                    mask |= stream.readUnsignedByte() << 16;
                }
                const update: PlayerUpdateBlock = {};
                if ((mask & PlayerUpdateMask.ForcedChat) !== 0) {
                    update.forcedChat = stream.readStringCp1252NullTerminated();
                }
                if ((mask & PlayerUpdateMask.FaceDirection) !== 0) {
                    // Player update: face direction (Actor.field1208).
                    update.faceDir = (stream.readUnsignedShortLE() | 0) & 2047;
                }

                if ((mask & PlayerUpdateMask.FaceEntity) !== 0) {
                    const low = stream.readUnsignedShortBE();
                    const high = stream.readUnsignedByte();
                    const packed = ((high << 16) | low) >>> 0;
                    update.faceEntity = packed === 0xffffff ? -1 : packed;
                    state.targetIndex = update.faceEntity;
                }
                if ((mask & PlayerUpdateMask.PublicChat) !== 0) {
                    const chat = this.readChat(stream);
                    if (chat) update.chat = chat;
                }
                if ((mask & PlayerUpdateMask.Animation) !== 0) {
                    const anim = this.readAnimation(stream);
                    if (anim) update.animation = anim;
                }
                if ((mask & PlayerUpdateMask.ExtendedPublicChat) !== 0) {
                    const chat = this.readExtendedChat(stream);
                    if (chat) update.chat = chat;
                }
                if ((mask & PlayerUpdateMask.Hitsplats) !== 0) {
                    const { hits, healthBars } = this.readHitsplats(stream, loopCycle, clientCycle);
                    if (hits.length > 0) {
                        update.hitsplats = hits;
                        update.primaryHit = hits[0];
                        update.secondaryHit = hits[1];
                        update.tertiaryHit = hits[2];
                        update.quaternaryHit = hits[3];
                    }
                    if (healthBars.length > 0) {
                        update.healthBars = healthBars;
                    }
                }
                if ((mask & PlayerUpdateMask.MovementType) !== 0) {
                    // readByteNeg (class231 enum ordinal in the reference client).
                    update.movementType = toSignedByte(stream.readUnsignedByteC()) | 0;
                    const normalized = clampTraversal(update.movementType);
                    if (normalized !== undefined) {
                        state.movementType = normalized;
                    }
                }
                if ((mask & PlayerUpdateMask.Appearance) !== 0) {
                    const length = stream.readUnsignedByteC();
                    const bytes = stream.readBytes(length);
                    update.appearance = { payload: bytes }; // downstream reuses Player.updatePlayer
                }
                if ((mask & PlayerUpdateMask.Actions) !== 0) {
                    update.actions = this.readActions(stream);
                }
                if ((mask & PlayerUpdateMask.ForceMovement) !== 0) {
                    const fm = this.readForcedMovement(stream, clientCycle);
                    const baseX = state.pendingMove ? state.pendingMove.tileX : state.tileX;
                    const baseY = state.pendingMove ? state.pendingMove.tileY : state.tileY;
                    fm.startTileX = (baseX + (fm.startDeltaX | 0)) | 0;
                    fm.startTileY = (baseY + (fm.startDeltaY | 0)) | 0;
                    fm.endTileX = (baseX + (fm.endDeltaX | 0)) | 0;
                    fm.endTileY = (baseY + (fm.endDeltaY | 0)) | 0;
                    update.forcedMovement = fm;

                    // OSRS parity: PlayerSlot.applyExactMove(...) immediately calls setPathStart(endX, endY),
                    // and PlayerUpdateManager clears the pending-movement flag for that player.
                    state.tileX = fm.endTileX | 0;
                    state.tileY = fm.endTileY | 0;
                    state.running = false;
                    state.hasKnownPosition = true;
                    state.pendingMove = undefined;
                }
                if ((mask & PlayerUpdateMask.MovementFlag) !== 0) {
                    // readByteSub
                    update.movementFlag = toSignedByte(stream.readUnsignedByteS()) | 0;
                }
                if ((mask & PlayerUpdateMask.SpotAnimation) !== 0) {
                    const spots = this.readSpotAnimations(stream, clientCycle);
                    if (spots.length > 0) {
                        update.spotAnimations = spots;
                        // Back-compat: surface slot0 as `spotAnimation`.
                        const slot0 = spots.find((s) => ((s.slot ?? 0) | 0) === 0);
                        if (slot0) update.spotAnimation = slot0;
                    }
                }
                if ((mask & PlayerUpdateMask.Field512) !== 0) {
                    update.field512 = this.readField512(stream, clientCycle);
                }

                blocks.set(index, update);

                // OSRS parity: apply deferred movement after update blocks are decoded.
                if (state.pendingMove) {
                    const pending = state.pendingMove;
                    state.pendingMove = undefined;

                    const override =
                        typeof update.movementFlag === "number" ? update.movementFlag | 0 : -1;
                    if (override === 127) {
                        state.tileX = pending.tileX | 0;
                        state.tileY = pending.tileY | 0;
                        state.running = false;
                        state.hasKnownPosition = true;
                        movements.push({
                            index,
                            mode: "teleport",
                            tile: { x: state.tileX, y: state.tileY, level: state.level },
                            subX: toSubCoord(state.tileX),
                            subY: toSubCoord(state.tileY),
                            snap: true,
                            applyAfterBlocks: true,
                        });
                        continue;
                    }

                    if (pending.teleported) {
                        state.tileX = pending.tileX | 0;
                        state.tileY = pending.tileY | 0;
                        state.running = false;
                        state.hasKnownPosition = true;
                        movements.push({
                            index,
                            mode: "teleport",
                            tile: { x: state.tileX, y: state.tileY, level: state.level },
                            subX: toSubCoord(state.tileX),
                            subY: toSubCoord(state.tileY),
                            snap: pending.snap ?? true,
                            applyAfterBlocks: true,
                        });
                        continue;
                    }

                    let traversal =
                        override !== -1
                            ? clampTraversal(override)
                            : clampTraversal(state.movementType);
                    if (traversal === undefined || traversal < 0) traversal = 1;
                    const running = traversal === 2;

                    state.tileX = pending.tileX | 0;
                    state.tileY = pending.tileY | 0;
                    state.running = running;
                    state.hasKnownPosition = true;

                    const dirs = Array.isArray(pending.directions) ? pending.directions : [];
                    const traversalValue = traversal | 0;
                    const traversals =
                        dirs.length > 0
                            ? Array.from({ length: dirs.length }, () => traversalValue)
                            : [traversalValue];
                    movements.push({
                        index,
                        mode: running ? "run" : "walk",
                        tile: { x: state.tileX, y: state.tileY, level: state.level },
                        running,
                        directions: dirs.length > 0 ? dirs : undefined,
                        traversals,
                        subX: toSubCoord(state.tileX),
                        subY: toSubCoord(state.tileY),
                        applyAfterBlocks: true,
                    });
                }
            } catch (err) {
                const message = (err as any)?.message?.toString?.() ?? String(err);
                throw new RangeError(
                    `player sync: updateBlocks index=${
                        index | 0
                    } offset=${startOffset} (${message})`,
                );
            }
        }
    }

    private applyStep(
        context: PlayerSyncContext,
        state: PlayerSyncState,
        networkDir: number,
        running: boolean,
        traversal: number,
        index: number,
        movements: PlayerMovementEvent[],
    ): void {
        const delta = directionToDelta((networkDir & 0x7) as MovementDirection);
        if (!delta) return;
        state.tileX += delta.dx;
        state.tileY += delta.dy;
        if (this.isOutsideScene(context, state.tileX, state.tileY)) {
            // OSRS parity: out-of-scene step updates do not delete the player; they reset the path
            // to the new coordinate (Player.resetPath), which is effectively a snap.
            state.running = false;
            state.hasKnownPosition = true;
            movements.push({
                index,
                mode: "teleport",
                tile: { x: state.tileX, y: state.tileY, level: state.level },
                subX: toSubCoord(state.tileX),
                subY: toSubCoord(state.tileY),
                snap: true,
            });
            return;
        }
        state.running = running;
        state.hasKnownPosition = true;
        movements.push({
            index,
            mode: running ? "run" : "walk",
            tile: { x: state.tileX, y: state.tileY, level: state.level },
            delta: { dx: delta.dx, dy: delta.dy },
            running,
            directions: [networkDir & 7],
            traversals: [traversal | 0],
            subX: toSubCoord(state.tileX),
            subY: toSubCoord(state.tileY),
        });
    }

    private applyMultiStepDelta(
        context: PlayerSyncContext,
        state: PlayerSyncState,
        targetX: number,
        targetY: number,
        directions: number[],
        traversal: number,
        index: number,
        movements: PlayerMovementEvent[],
    ): void {
        state.tileX = targetX | 0;
        state.tileY = targetY | 0;
        if (this.isOutsideScene(context, state.tileX, state.tileY)) {
            // OSRS parity: out-of-scene movement updates reset path rather than removing the player.
            state.running = false;
            state.hasKnownPosition = true;
            movements.push({
                index,
                mode: "teleport",
                tile: { x: state.tileX, y: state.tileY, level: state.level },
                subX: toSubCoord(state.tileX),
                subY: toSubCoord(state.tileY),
                snap: true,
            });
            return;
        }
        const run = traversal === 2;
        state.running = run;
        state.hasKnownPosition = true;
        const dirs = Array.isArray(directions) ? directions.map((d) => d & 7) : [];
        const traversalValue = traversal | 0;
        const traversalList =
            dirs.length > 0
                ? Array.from({ length: dirs.length }, () => traversalValue)
                : [traversalValue];
        movements.push({
            index,
            mode: run ? "run" : "walk",
            tile: { x: state.tileX, y: state.tileY, level: state.level },
            running: run,
            directions: dirs.length > 0 ? dirs : undefined,
            traversals: traversalList,
            subX: toSubCoord(state.tileX),
            subY: toSubCoord(state.tileY),
        });
    }

    private readForcedMovement(stream: BitStream, cycleBase: number): ForcedMovementUpdate {
        const startDX = toSignedByte(stream.readUnsignedByteS()); // readByteSub
        const startDY = stream.readByte() | 0; // readByte
        const endDX = stream.readByte() | 0; // readByte
        const endDY = toSignedByte(stream.readUnsignedByteA()); // readByteAdd
        const startCycle = (cycleBase + (stream.readUnsignedShortBEA() | 0)) | 0; // readUnsignedShortAdd
        const endCycle = (cycleBase + (stream.readUnsignedShortBE() | 0)) | 0; // readUnsignedShort
        const direction = stream.readUnsignedShortLEA() | 0; // readUnsignedShortAddLE
        return {
            startDeltaX: startDX,
            startDeltaY: startDY,
            endDeltaX: endDX,
            endDeltaY: endDY,
            startCycle,
            endCycle,
            direction,
        };
    }

    private readSpotAnimations(stream: BitStream, cycleBase: number): SpotAnimationUpdate[] {
        const count = stream.readUnsignedByteA() | 0; // readUnsignedByteAdd
        const list: SpotAnimationUpdate[] = [];
        for (let i = 0; i < count; i++) {
            const slot = stream.readUnsignedByte() | 0;
            const id = stream.readUnsignedShortBE() | 0;
            const packed = stream.readUnsignedIntIME() >>> 0;
            const height = (packed >>> 16) & 0xffff;
            const delay = (packed & 0xffff) + (cycleBase | 0);
            const spotId = id === 65535 ? -1 : id;
            // OSRS parity: id -1 removes the spot animation in that slot.
            list.push({ slot: slot & 0xff, id: spotId, height, delay });
        }
        return list;
    }

    private readAnimation(stream: BitStream): AnimationUpdate | undefined {
        let seq = stream.readUnsignedShortLEA();
        if (seq === 65535) seq = -1;
        const delay = stream.readUnsignedByte();
        return { seqId: seq, delay };
    }

    private readActions(stream: BitStream): [string, string, string] {
        const a = stream.readStringCp1252NullTerminated();
        const b = stream.readStringCp1252NullTerminated();
        const c = stream.readStringCp1252NullTerminated();
        return [a, b, c];
    }

    private readField512(
        stream: BitStream,
        cycleBase: number,
    ): {
        field1180: number;
        field1233: number;
        field1234: number;
        field1193: number;
        field1204: number;
        field1237: number;
    } {
        const field1180 = (cycleBase + (stream.readUnsignedShortLE() | 0)) | 0;
        const field1233 = (cycleBase + (stream.readUnsignedShortLE() | 0)) | 0;
        const field1234 = toSignedByte(stream.readUnsignedByteS()); // readByteSub
        const field1193 = stream.readByte() | 0;
        const field1204 = toSignedByte(stream.readUnsignedByteA()); // readByteAdd
        const field1237 = toSignedByte(stream.readUnsignedByteC()); // readUnsignedByteNeg cast to byte
        return { field1180, field1233, field1234, field1193, field1204, field1237 };
    }

    private readChat(stream: BitStream): ChatUpdate | undefined {
        const packedColor = stream.readUnsignedShortLE();
        const playerType = stream.readUnsignedByteS(); // readUnsignedByteSub
        const autoChat = (stream.readUnsignedByteS() | 0) === 1; // readUnsignedByteSub
        const length = stream.readUnsignedByteC(); // readUnsignedByteNeg
        const payload = stream.readBytes(length);
        if (payload.length === 0) return undefined;
        const text = normalizePublicChatTextOsrs(this.decodeHuffmanChat(payload));
        return {
            color: packedColor >>> 8,
            effect: packedColor & 0xff,
            playerType,
            autoChat,
            text,
        };
    }

    private readExtendedChat(stream: BitStream): ChatUpdate | undefined {
        const packedColor = stream.readUnsignedShortLE();
        const playerType = stream.readUnsignedByteC(); // readUnsignedByteNeg
        const autoChat = (stream.readUnsignedByteS() | 0) === 1; // readUnsignedByteSub
        const length = stream.readUnsignedByteC(); // readUnsignedByteNeg
        const colorId = packedColor >>> 8;
        const extraLen = colorId >= 13 && colorId <= 20 ? colorId - 12 : 0;
        const payload = stream.readBytes(length);
        if (payload.length === 0) return undefined;
        let extra: Uint8Array | undefined = undefined;
        if (extraLen > 0) {
            extra = new Uint8Array(extraLen);
            for (let i = 0; i < extraLen; i++) {
                extra[i] = stream.readUnsignedByteA(); // readByteAdd
            }
        }
        return {
            color: colorId,
            effect: packedColor & 0xff,
            playerType,
            autoChat,
            text: normalizePublicChatTextOsrs(this.decodeHuffmanChat(payload)),
            extra,
        };
    }

    private decodeHuffmanChat(payload: Uint8Array): string {
        const huffman = getPlayerSyncHuffman();
        if (huffman) {
            try {
                const inner = new BitStream(payload);
                const textLen = Math.min(32767, inner.readUShortSmart() | 0);
                const out = new Uint8Array(textLen);
                huffman.decompress(payload, inner.bytePosition, out, 0, textLen);
                return new TextDecoder("windows-1252", { fatal: false }).decode(out);
            } catch {
                // Fall through.
            }
        }
        return new TextDecoder("windows-1252", { fatal: false }).decode(payload);
    }

    private readHitsplats(
        stream: BitStream,
        loopCycle: number,
        clientCycle: number,
    ): { hits: HitsplatUpdate[]; healthBars: HealthBarUpdate[] } {
        const hits: HitsplatUpdate[] = [];
        const count = stream.readUnsignedByteC() | 0; // readUnsignedByteNeg
        for (let i = 0; i < count; i++) {
            let type = -1;
            let damage = -1;
            let type2 = -1;
            let damage2 = -1;
            const first = stream.readUShortSmart() | 0;
            if (first === 32767) {
                type = stream.readUShortSmart() | 0;
                damage = stream.readUShortSmart() | 0;
                type2 = stream.readUShortSmart() | 0;
                damage2 = stream.readUShortSmart() | 0;
            } else if (first !== 32766) {
                type = first;
                damage = stream.readUShortSmart() | 0;
                type2 = -1;
                damage2 = -1;
            }
            const delay = stream.readUShortSmart() | 0;
            // OSRS parity: even sentinel 32766 (type=-1) still calls Actor.addHitSplat.
            // This affects slot rotation timing via hitSplatCount even when nothing is rendered.
            hits.push({
                type,
                damage,
                type2,
                damage2,
                delayCycles: delay | 0,
            });
        }
        const healthBars: HealthBarUpdate[] = [];
        const healthCount = stream.readUnsignedByteS() | 0; // readUnsignedByteSub
        for (let i = 0; i < healthCount; i++) {
            const id = stream.readUShortSmart() | 0;
            const value = stream.readUShortSmart() | 0;
            if (value !== 32767) {
                // OSRS: this delay is already in client cycles (Client.cycle units).
                const delayCycles = stream.readUShortSmart() | 0;
                const health = stream.readUnsignedByteS() | 0; // readUnsignedByteSub
                const health2 = value > 0 ? stream.readUnsignedByteC() | 0 : health; // readUnsignedByteNeg
                healthBars.push({
                    id,
                    cycle: ((clientCycle | 0) + delayCycles) | 0,
                    health,
                    health2,
                    cycleOffset: value,
                });
            } else {
                healthBars.push({
                    id,
                    cycle: clientCycle | 0,
                    health: 0,
                    health2: 0,
                    cycleOffset: 0,
                    removed: true,
                });
            }
        }
        return { hits, healthBars };
    }
}
