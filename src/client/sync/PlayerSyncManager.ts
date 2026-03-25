import { playerTypeIdToModIcon } from "../../rs/chat/PlayerType";
import {
    NO_INTERACTION,
    decodeInteractionIndex,
    isValidInteractionIndex,
} from "../../rs/interaction/InteractionIndex";
import { faceAngleRs } from "../../rs/utils/rotation";
import { ClientState } from "../ClientState";
import { PlayerAnimController } from "../PlayerAnimController";
import type { NpcEcs } from "../ecs/NpcEcs";
import { PlayerEcs } from "../ecs/PlayerEcs";
import type { MovementUpdate } from "../movement/MovementSyncTypes";
import { PlayerMovementSync } from "../movement/PlayerMovementSync";
import type { ResolveTilePlaneFn } from "../roof/RoofVisibility";
import { decodeAppearanceBinary } from "./AppearanceDecoder";
import { frameToActions } from "./PlayerSyncActions";
import type {
    ForcedMovementUpdate,
    HealthBarUpdate,
    PlayerSpotAnimationEvent,
    PlayerSyncFrame,
    SpotAnimationUpdate,
} from "./PlayerSyncTypes";

const OVERHEAD_CHAT_LINGER_TICKS = 150;

// OSRS pattern palette (class554.field5330) used by extended public chat colours (13..20).
const CHAT_PATTERN_PALETTE_RGB = new Int32Array([
    16777215, 14942979, 16747520, 16772352, 32806, 2375822, 7547266, 16720268, 11884176, 5261772,
    10724259, 13970688, 15693351, 16577588, 494960, 2208255, 10178454, 16756679, 13722276, 8105443,
    16751190, 2543274, 7591918, 10246609, 10021057, 11894492, 2894892, 9699842, 6371605, 13680896,
    4882723, 14504, 8388736, 14025328, 10682978, 4004472,
]);

function decodeChatPattern(extra: Uint8Array | undefined): Int32Array | undefined {
    if (!extra || extra.length === 0 || extra.length > 8) return undefined;
    const out = new Int32Array(extra.length);
    for (let i = 0; i < extra.length; i++) {
        const idx = extra[i] & 0xff;
        if (idx < 0 || idx >= CHAT_PATTERN_PALETTE_RGB.length) return undefined;
        out[i] = CHAT_PATTERN_PALETTE_RGB[idx] & 0xffffff;
    }
    return out;
}

type PlayerHitsplatEvent = {
    targetType: "player";
    targetId: number;
    damage: number;
    style?: number;
    type2?: number;
    damage2?: number;
    delayCycles?: number;
    tick?: number;
};

type PlayerHealthBarEvent = {
    serverId: number;
    bar: HealthBarUpdate;
};

function defaultSub(tile: number): number {
    return (tile << 7) + 64;
}

/**
 * Coordinates player sync frames with ECS state, tracking movement, animation, and
 * update blocks emitted by {@code Player.appendPlayerUpdateBlock} in the reference
 * server while driving interpolation similar to {@code Client.method99}.
 */
export class PlayerSyncManager {
    private readonly playerEcs: PlayerEcs;
    private readonly movementSync: PlayerMovementSync;
    private readonly animController?: PlayerAnimController;

    private hasProcessedFrame = false;
    private readonly npcEcs?: NpcEcs;
    private readonly onSpotAnimation?: (event: PlayerSpotAnimationEvent) => void;
    private readonly onHitsplat: (event: PlayerHitsplatEvent) => void;
    private readonly onHealthBar?: (event: PlayerHealthBarEvent) => void;
    private readonly onPublicChat?: (event: {
        serverId: number;
        text: string;
        color?: number;
        effect?: number;
        playerType?: number;
        modIcon?: number;
        autoChat?: boolean;
    }) => void;
    private readonly resolveTilePlane?: ResolveTilePlaneFn;
    private readonly onInteractionIndex?: (
        serverId: number,
        interactionIndex: number | undefined,
    ) => void;
    private readonly onAppearanceUpdate?: (serverId: number, data: unknown) => void;
    private lastServerTick = 0;
    private readonly spawnQueueDiagnostics = { preserved: 0, cleared: 0 };
    private readonly debugLogging =
        typeof process !== "undefined" ? process.env?.NODE_ENV !== "production" : false;

    constructor(opts: {
        ecs: PlayerEcs;
        movementSync: PlayerMovementSync;
        animController?: PlayerAnimController;
        npcEcs?: NpcEcs;
        onSpotAnimation?: (event: PlayerSpotAnimationEvent) => void;
        onHitsplat?: (event: PlayerHitsplatEvent) => void;
        onHealthBar?: (event: PlayerHealthBarEvent) => void;
        onPublicChat?: (event: {
            serverId: number;
            text: string;
            color?: number;
            effect?: number;
            playerType?: number;
            modIcon?: number;
            autoChat?: boolean;
        }) => void;
        resolveTilePlane?: ResolveTilePlaneFn;
        onInteractionIndex?: (serverId: number, interactionIndex: number | undefined) => void;
        onAppearanceUpdate?: (serverId: number, data: unknown) => void;
    }) {
        this.playerEcs = opts.ecs;
        this.movementSync = opts.movementSync;
        this.animController = opts.animController;
        this.npcEcs = opts.npcEcs;
        this.onSpotAnimation = opts.onSpotAnimation;
        this.onHitsplat = opts.onHitsplat ? opts.onHitsplat : () => {};
        this.onHealthBar = opts.onHealthBar;
        this.onPublicChat = opts.onPublicChat;
        this.resolveTilePlane = opts.resolveTilePlane;
        this.onInteractionIndex = opts.onInteractionIndex;
        this.onAppearanceUpdate = opts.onAppearanceUpdate;
    }

    handleFrame(frame: PlayerSyncFrame): void {
        const frameTick = frame.loopCycle | 0;
        if (frameTick > this.lastServerTick) {
            this.lastServerTick = frameTick;
        }
        const actions = frameToActions(frame);
        const movementContext = new Map<number, MovementUpdate>();

        // Remove despawned players first to avoid applying updates to stale ECS indices.
        for (const removal of actions.removals) {
            // Keep OSRS-style global player index array in sync for menuAction packet gates.
            ClientState.players[removal.serverId | 0] = null;
            const ecsIndex = this.playerEcs.getIndexForServerId(removal.serverId);
            if (ecsIndex === undefined) continue;
            this.animController?.release(removal.serverId);
            this.movementSync.unregister(removal.serverId);
            this.playerEcs.deallocatePlayer(removal.serverId);
        }

        // Ensure spawns are registered before movement updates are applied.
        for (const spawn of actions.spawns) {
            const effectiveLevel = this.resolveTilePlane
                ? this.resolveTilePlane(spawn.tile.x, spawn.tile.y, spawn.tile.level)
                : spawn.tile.level;
            const ecsIndex = this.ensurePlayer(spawn.serverId, {
                tileX: spawn.tile.x,
                tileY: spawn.tile.y,
                level: effectiveLevel,
                subX: spawn.subX,
                subY: spawn.subY,
            });
            this.playerEcs.teleport(ecsIndex, spawn.tile.x, spawn.tile.y, effectiveLevel);
            this.playerEcs.setLevel(ecsIndex, effectiveLevel);
            this.playerEcs.setRunning(ecsIndex, false);

            const state = this.movementSync.getState(spawn.serverId);
            if (state) {
                state.setTile(
                    { x: spawn.tile.x, y: spawn.tile.y },
                    spawn.subX,
                    spawn.subY,
                    effectiveLevel,
                );
                if (!spawn.preserveQueue) {
                    state.clearPendingSteps();
                    state.setLastSteps([]);
                    this.spawnQueueDiagnostics.cleared++;
                    if (this.debugLogging) {
                        try {
                            console.log(
                                `[player-sync] cleared walking queue for spawn ${spawn.serverId}`,
                            );
                        } catch {}
                    }
                } else {
                    this.spawnQueueDiagnostics.preserved++;
                    if (this.debugLogging) {
                        try {
                            console.log(
                                `[player-sync] preserved walking queue for spawn ${spawn.serverId}`,
                            );
                        } catch {}
                    }
                }
            }
        }

        // Process movement updates (walk/run/teleport/orientation) that apply immediately.
        for (const movement of actions.movementsPre) {
            const ecsIndex = this.ensurePlayer(movement.serverId, {
                subX: movement.subX,
                subY: movement.subY,
                level: movement.level,
                running: movement.running,
            });
            const subX =
                typeof movement.subX === "number"
                    ? movement.subX
                    : defaultSub((this.playerEcs.getX(ecsIndex) | 0) >> 7);
            const subY =
                typeof movement.subY === "number"
                    ? movement.subY
                    : defaultSub((this.playerEcs.getY(ecsIndex) | 0) >> 7);
            const tileX = subX >> 7;
            const tileY = subY >> 7;
            const basePlane =
                movement.level !== undefined
                    ? movement.level | 0
                    : this.playerEcs.getLevel(ecsIndex) | 0;
            const effectiveLevel = this.resolveTilePlane
                ? this.resolveTilePlane(tileX, tileY, basePlane)
                : basePlane;
            movement.subX = subX;
            movement.subY = subY;
            movement.ecsIndex = ecsIndex;
            movement.level = effectiveLevel;
            const result = this.movementSync.receiveUpdate(movement);
            if (movement.running !== undefined) {
                this.playerEcs.setRunning(ecsIndex, !!movement.running);
            }
            this.playerEcs.setLevel(ecsIndex, effectiveLevel);
            // Avoid forcing targetRot to the frame's final orientation when
            // this update includes step directions. We already enqueue each
            // step with its own rotation, and PlayerEcs applies it exactly at
            // segment start. Forcing targetRot here would make the player face
            // the last step’s direction mid-segment (e.g., face east while
            // still moving south).
            if (movement.orientation !== undefined) {
                const hasStepDirections =
                    Array.isArray(movement.directions) && movement.directions.length > 0;
                if (!hasStepDirections) {
                    this.playerEcs.setTargetRot(ecsIndex, movement.orientation | 0);
                }
            } else if (movement.rotation !== undefined && movement.snap) {
                this.playerEcs.setRotationImmediate(ecsIndex, movement.rotation | 0);
            }
            if (result.teleported) {
                this.playerEcs.teleport(
                    ecsIndex,
                    tileX,
                    tileY,
                    typeof movement.level === "number" ? movement.level : 0,
                );
                if (movement.serverId === ClientState.localPlayerIndex) {
                    ClientState.destinationX = 0;
                    ClientState.destinationY = 0;
                    ClientState.destinationWorldX = 0;
                    ClientState.destinationWorldY = 0;
                }
            }
            movementContext.set(movement.serverId, movement);
        }

        // Animations (one-shot sequences or movement blends).
        // frameTick is already declared at the start of handleFrame
        actions.animations.forEach((anim, serverId) => {
            if (!anim) return;
            const ecsIndex = this.playerEcs.getIndexForServerId(serverId);
            if (ecsIndex === undefined) return;

            const seqId = typeof anim.seqId === "number" ? anim.seqId | 0 : -1;
            const delay = Math.max(0, anim.delay | 0);

            this.applyAnimation(serverId, {
                seqId,
                delay,
            });
        });

        actions.forcedMovements.forEach((forced, serverId) => {
            if (!forced) return;
            const movement = movementContext.get(serverId);
            this.scheduleForcedMovement(serverId, forced, movement);
        });

        actions.appearances.forEach((appearance, serverId) => {
            this.applyAppearanceUpdate(serverId, appearance);
        });

        actions.spotAnimations.forEach((spot, serverId) => {
            this.emitSpotAnimation(serverId, spot);
        });

        actions.faceEntities.forEach((face, serverId) => {
            this.applyFaceEntity(serverId, face);
        });

        actions.faceDirs.forEach((dir, serverId) => {
            this.applyFaceDir(serverId, dir);
        });

        actions.chats.forEach((chat, serverId) => {
            if (!chat || typeof chat.text !== "string" || chat.text.length === 0) return;
            const existing = this.playerEcs.getIndexForServerId(serverId);
            const ecsIndex = existing !== undefined ? existing : this.ensurePlayer(serverId);
            if (ecsIndex === undefined) return;
            const modIcon = playerTypeIdToModIcon(chat.playerType);
            const pattern = decodeChatPattern(chat.extra);
            const color = typeof chat.color === "number" ? chat.color : 0;
            const effect = typeof chat.effect === "number" ? chat.effect : 0;
            this.playerEcs.setOverheadChat(ecsIndex, {
                text: chat.text,
                color,
                effect,
                modIcon: -1,
                pattern,
                duration: OVERHEAD_CHAT_LINGER_TICKS,
            });
            try {
                this.onPublicChat?.({
                    serverId: serverId | 0,
                    text: chat.text,
                    color,
                    effect,
                    playerType: chat.playerType,
                    modIcon,
                    autoChat: chat.autoChat,
                });
            } catch {}
        });

        actions.forcedChats.forEach((forced, serverId) => {
            if (typeof forced !== "string" || forced.length === 0) return;
            const existing = this.playerEcs.getIndexForServerId(serverId);
            const ecsIndex = existing !== undefined ? existing : this.ensurePlayer(serverId);
            if (ecsIndex === undefined) return;
            this.playerEcs.setOverheadChat(ecsIndex, {
                text: forced,
                color: 0,
                effect: 0,
                modIcon: -1,
                duration: OVERHEAD_CHAT_LINGER_TICKS,
            });
        });

        const onHitsplat = this.onHitsplat;
        if (onHitsplat) {
            actions.hitsplats.forEach((list, serverId) => {
                const hits = Array.isArray(list) ? list : [];
                if (hits.length === 0) return;
                const tick = frame.loopCycle | 0;
                for (const entry of hits) {
                    if (!entry) continue;
                    onHitsplat({
                        targetType: "player",
                        targetId: serverId | 0,
                        damage: entry.damage | 0,
                        style: entry.type | 0,
                        type2: typeof entry.type2 === "number" ? entry.type2 | 0 : undefined,
                        damage2: typeof entry.damage2 === "number" ? entry.damage2 | 0 : undefined,
                        delayCycles:
                            typeof entry.delayCycles === "number"
                                ? entry.delayCycles | 0
                                : undefined,
                        tick,
                    });
                }
            });
        }

        actions.healthBars.forEach((bars, serverId) => {
            const list = Array.isArray(bars) ? bars : [];
            if (list.length === 0) return;
            for (const bar of list) {
                try {
                    this.onHealthBar?.({ serverId: serverId | 0, bar });
                } catch {}
            }
        });

        // Actor HSL color override (poison/freeze/venom tints)
        actions.colorOverrides.forEach((override, serverId) => {
            const ecsIndex = this.playerEcs.getIndexForServerId(serverId);
            if (ecsIndex === undefined) return;
            this.playerEcs.setColorOverride(
                ecsIndex,
                override.field1234 | 0, // hue
                override.field1193 | 0, // sat
                override.field1204 | 0, // lum
                override.field1237 | 0, // amount
                override.field1180 | 0, // startCycle
                override.field1233 | 0, // endCycle
            );
        });

        // OSRS parity: apply deferred movement after update blocks are decoded.
        // (SoundSystem.method877 final `if (field1124) ... method2429/resetPath`).
        for (const movement of actions.movementsPost) {
            const ecsIndex = this.ensurePlayer(movement.serverId, {
                subX: movement.subX,
                subY: movement.subY,
                level: movement.level,
                running: movement.running,
            });
            const subX =
                typeof movement.subX === "number"
                    ? movement.subX
                    : defaultSub((this.playerEcs.getX(ecsIndex) | 0) >> 7);
            const subY =
                typeof movement.subY === "number"
                    ? movement.subY
                    : defaultSub((this.playerEcs.getY(ecsIndex) | 0) >> 7);
            const tileX = subX >> 7;
            const tileY = subY >> 7;
            const basePlane =
                movement.level !== undefined
                    ? movement.level | 0
                    : this.playerEcs.getLevel(ecsIndex) | 0;
            const effectiveLevel = this.resolveTilePlane
                ? this.resolveTilePlane(tileX, tileY, basePlane)
                : basePlane;
            movement.subX = subX;
            movement.subY = subY;
            movement.ecsIndex = ecsIndex;
            movement.level = effectiveLevel;
            const result = this.movementSync.receiveUpdate(movement);
            if (movement.running !== undefined) {
                this.playerEcs.setRunning(ecsIndex, !!movement.running);
            }
            this.playerEcs.setLevel(ecsIndex, effectiveLevel);
            if (movement.orientation !== undefined) {
                const hasStepDirections =
                    Array.isArray(movement.directions) && movement.directions.length > 0;
                if (!hasStepDirections) {
                    this.playerEcs.setTargetRot(ecsIndex, movement.orientation | 0);
                }
            } else if (movement.rotation !== undefined && movement.snap) {
                this.playerEcs.setRotationImmediate(ecsIndex, movement.rotation | 0);
            }
            if (result.teleported) {
                this.playerEcs.teleport(
                    ecsIndex,
                    tileX,
                    tileY,
                    typeof movement.level === "number" ? movement.level : 0,
                );
                if (movement.serverId === ClientState.localPlayerIndex) {
                    ClientState.destinationX = 0;
                    ClientState.destinationY = 0;
                    ClientState.destinationWorldX = 0;
                    ClientState.destinationWorldY = 0;
                }
            }
        }

        this.hasProcessedFrame = true;
    }

    public advanceServerTick(tick: number): void {
        const nextTick = tick | 0;
        if (nextTick < this.lastServerTick) {
            return;
        }
        if (nextTick > this.lastServerTick) {
            this.lastServerTick = nextTick;
        }
    }

    hasSeenFrame(): boolean {
        return this.hasProcessedFrame;
    }

    getSpawnQueueDiagnostics(): { preserved: number; cleared: number } {
        return { ...this.spawnQueueDiagnostics };
    }

    private ensurePlayer(
        serverId: number,
        opts: {
            tileX?: number;
            tileY?: number;
            level?: number;
            subX?: number;
            subY?: number;
            running?: boolean;
        } = {},
    ): number {
        let ecsIndex = this.playerEcs.getIndexForServerId(serverId);
        const sid = serverId | 0;
        if (ecsIndex === undefined) {
            ecsIndex = this.playerEcs.allocatePlayer(serverId);
            const fallbackTileX = typeof opts.tileX === "number" ? opts.tileX : 0;
            const fallbackTileY = typeof opts.tileY === "number" ? opts.tileY : 0;
            const subX = typeof opts.subX === "number" ? opts.subX : defaultSub(fallbackTileX);
            const subY = typeof opts.subY === "number" ? opts.subY : defaultSub(fallbackTileY);
            const tileX = typeof opts.tileX === "number" ? opts.tileX : subX >> 7;
            const tileY = typeof opts.tileY === "number" ? opts.tileY : subY >> 7;
            const baseLevel = typeof opts.level === "number" ? opts.level : 0;
            const level = this.resolveTilePlane
                ? this.resolveTilePlane(tileX, tileY, baseLevel)
                : baseLevel;
            this.playerEcs.teleport(ecsIndex, tileX, tileY, level);
            this.playerEcs.setRunning(ecsIndex, !!opts.running);
            if (!this.movementSync.getState(serverId)) {
                this.movementSync.registerEntity({
                    serverId,
                    ecsIndex,
                    tile: { x: tileX, y: tileY },
                    level,
                    subX,
                    subY,
                });
            }
        }
        // Keep OSRS-style global player index array in sync for menuAction packet gates.
        if (sid >= 0) {
            ClientState.players[sid] = { index: sid };
        }
        return ecsIndex;
    }

    private applyAnimation(
        serverId: number,
        context: {
            seqId: number;
            delay: number;
        },
    ): void {
        const ecsIndex = this.playerEcs.getIndexForServerId(serverId);
        if (ecsIndex === undefined) return;

        // OSRS parity: `performPlayerAnimation` logic lives in the controller; it writes ECS state.
        this.animController?.handleServerSequence(serverId, context.seqId, {
            delay: context.delay | 0,
        });
    }

    private scheduleForcedMovement(
        serverId: number,
        update: ForcedMovementUpdate,
        movement?: MovementUpdate,
    ): void {
        const ecsIndex = this.playerEcs.getIndexForServerId(serverId);
        if (ecsIndex === undefined) return;

        const hasAbs =
            typeof update.startTileX === "number" &&
            typeof update.startTileY === "number" &&
            typeof update.endTileX === "number" &&
            typeof update.endTileY === "number";
        const base = hasAbs ? undefined : this.resolveBaseTile(serverId, movement);
        if (!hasAbs && !base) return;

        const startTileX = hasAbs
            ? update.startTileX! | 0
            : (base!.tileX + (update.startDeltaX | 0)) | 0;
        const startTileY = hasAbs
            ? update.startTileY! | 0
            : (base!.tileY + (update.startDeltaY | 0)) | 0;
        const endTileX = hasAbs ? update.endTileX! | 0 : (base!.tileX + (update.endDeltaX | 0)) | 0;
        const endTileY = hasAbs ? update.endTileY! | 0 : (base!.tileY + (update.endDeltaY | 0)) | 0;

        const startSubX = (startTileX << 7) + 64;
        const startSubY = (startTileY << 7) + 64;
        const endSubX = (endTileX << 7) + 64;
        const endSubY = (endTileY << 7) + 64;

        const startCycle = Number.isFinite(update.startCycle)
            ? update.startCycle | 0
            : this.playerEcs.getClientCycle();
        // OSRS parity: the server provides absolute start/end cycles; do not clamp.
        const endCycle = Number.isFinite(update.endCycle) ? update.endCycle | 0 : startCycle;

        // OSRS parity: forced-move orientation comes from `field1173` (readUnsignedShortAddLE),
        // which is already in RS rotation units (0..2047), not a 0..7 direction code.
        const orientation =
            typeof update.direction === "number" && Number.isFinite(update.direction)
                ? (update.direction | 0) & 2047
                : faceAngleRs(startSubX, startSubY, endSubX, endSubY) & 2047;

        this.playerEcs.startForcedMovement(
            ecsIndex,
            startCycle,
            endCycle,
            startSubX,
            startSubY,
            endSubX,
            endSubY,
            orientation,
        );
        // OSRS parity: forced movement resets pathLength and field1215; clear any queued movement.
        try {
            this.playerEcs.clearServerQueue(ecsIndex);
        } catch {}
        try {
            this.playerEcs.setForcedMovementSteps(ecsIndex, 0);
        } catch {}
        this.playerEcs.setRunning(ecsIndex, false);

        const state = this.movementSync.getState(serverId);
        if (state) {
            state.clearPendingSteps();
            state.setTile(
                { x: endTileX | 0, y: endTileY | 0 },
                endSubX | 0,
                endSubY | 0,
                this.playerEcs.getLevel(ecsIndex) | 0,
            );
            state.lastOrientation = orientation;
        }
    }

    private emitSpotAnimation(serverId: number, updates?: SpotAnimationUpdate[] | undefined): void {
        const list = Array.isArray(updates) ? updates : [];
        if (list.length === 0) return;
        if (!this.onSpotAnimation) return;
        const ecsIndex = this.playerEcs.getIndexForServerId(serverId);
        if (ecsIndex === undefined) return;
        for (const update of list) {
            if (!update) continue;
            const spotId = update.id | 0;
            const event: PlayerSpotAnimationEvent = {
                serverId,
                ecsIndex,
                slot: typeof update.slot === "number" ? (update.slot | 0) & 0xff : undefined,
                spotId,
                height: update.height | 0,
                startCycle: update.delay | 0,
            };
            this.onSpotAnimation(event);
        }
    }

    private applyAppearanceUpdate(
        serverId: number,
        appearance?: { payload: Uint8Array } | undefined,
    ): void {
        if (!appearance || !(appearance.payload instanceof Uint8Array)) return;
        if (!this.onAppearanceUpdate) return;
        if (appearance.payload.length === 0) return;
        try {
            // OSRS parity: decode binary appearance block (like Player.read() in reference)
            const decoded = decodeAppearanceBinary(appearance.payload);
            if (!decoded) return;

            // Convert to the format expected by onAppearanceUpdate
            const data = {
                name: decoded.name,
                combatLevel: decoded.combatLevel,
                actions: decoded.actions,
                appearance: {
                    gender: decoded.gender,
                    colors: decoded.colors,
                    kits: decoded.kits,
                    equip: decoded.equipment,
                    equipQty: (() => {
                        const equipQty = new Array<number>(14).fill(0);
                        equipQty[10] = Math.max(0, decoded.ammoQuantity | 0);
                        return equipQty;
                    })(),
                    headIcons: {
                        prayer: decoded.headIconPrayer,
                        skull: decoded.headIconPk >= 0 ? decoded.headIconPk : undefined,
                    },
                },
                anim: {
                    idle: decoded.anim.idle,
                    turnLeft: decoded.anim.turnLeft,
                    turnRight: decoded.anim.turnRight,
                    walk: decoded.anim.walk,
                    walkBack: decoded.anim.walkBack,
                    walkLeft: decoded.anim.walkLeft,
                    walkRight: decoded.anim.walkRight,
                    run: decoded.anim.run,
                },
            };
            this.onAppearanceUpdate(serverId, data);
        } catch {
            // ignore malformed payloads
        }
    }

    private applyFaceEntity(serverId: number, face: number | undefined): void {
        this.setInteractionTarget(serverId, face);
    }

    public applyInteractionIndex(serverId: number, interactionIndex: number | undefined): void {
        this.setInteractionTarget(serverId, interactionIndex);
    }

    private applyFaceDir(serverId: number, dir: number | undefined): void {
        if (typeof dir !== "number" || !Number.isFinite(dir)) return;
        const ecsIndex = this.playerEcs.getIndexForServerId(serverId);
        if (ecsIndex === undefined) return;
        const orientation = (dir | 0) & 2047;
        const state = this.movementSync.getState(serverId);
        let isMoving = false;
        try {
            const t = this.playerEcs.getServerStepT(ecsIndex);
            const hasPending = state ? state.hasPendingSteps() : false;
            isMoving = Number(t) < 0.999 || !!hasPending;
        } catch {}

        // Reference: SoundSystem.method740 (player update) assigns Actor.field1208 immediately when idle.
        if (!isMoving) {
            this.playerEcs.setTargetRot(ecsIndex, orientation);
            if (state) state.lastOrientation = orientation;
        } else {
            this.playerEcs.setFaceDir(ecsIndex, orientation);
        }
    }

    private resolveBaseTile(
        serverId: number,
        movement?: MovementUpdate,
    ): { tileX: number; tileY: number } | undefined {
        if (movement && typeof movement.subX === "number" && typeof movement.subY === "number") {
            return {
                tileX: (movement.subX >> 7) | 0,
                tileY: (movement.subY >> 7) | 0,
            };
        }
        const state = this.movementSync.getState(serverId);
        if (state) {
            return { tileX: state.tileX, tileY: state.tileY };
        }
        const ecsIndex = this.playerEcs.getIndexForServerId(serverId);
        if (ecsIndex !== undefined) {
            return {
                tileX: (this.playerEcs.getX(ecsIndex) | 0) >> 7,
                tileY: (this.playerEcs.getY(ecsIndex) | 0) >> 7,
            };
        }
        return undefined;
    }

    private computeOrientation(
        selfX: number,
        selfY: number,
        targetX: number,
        targetY: number,
    ): number | undefined {
        if ((selfX | 0) === (targetX | 0) && (selfY | 0) === (targetY | 0)) return undefined;
        return faceAngleRs(selfX | 0, selfY | 0, targetX | 0, targetY | 0);
    }

    private setInteractionTarget(serverId: number, interactionIndex: number | undefined): void {
        const ecsIndex = this.playerEcs.getIndexForServerId(serverId);
        if (ecsIndex === undefined) return;

        const normalized =
            typeof interactionIndex === "number" &&
            interactionIndex >= 0 &&
            isValidInteractionIndex(interactionIndex)
                ? interactionIndex | 0
                : NO_INTERACTION;

        if (normalized === NO_INTERACTION) {
            this.playerEcs.setInteractionIndex(ecsIndex, undefined);
            this.onInteractionIndex?.(serverId, undefined);
            return;
        }

        this.playerEcs.setInteractionIndex(ecsIndex, normalized);
        this.onInteractionIndex?.(serverId, normalized);

        const decoded = decodeInteractionIndex(normalized);
        if (!decoded) return;

        const selfX = this.playerEcs.getX(ecsIndex) | 0;
        const selfY = this.playerEcs.getY(ecsIndex) | 0;

        let targetX: number | undefined;
        let targetY: number | undefined;

        if (decoded.type === "npc") {
            if (!this.npcEcs) return;
            const npcIndex = this.npcEcs.getEcsIdForServer(decoded.id | 0);
            if (npcIndex === undefined) return;
            const mapId = this.npcEcs.getMapId(npcIndex) | 0;
            const mapX = (mapId >> 8) & 0xff;
            const mapY = mapId & 0xff;
            const localX = this.npcEcs.getX(npcIndex) | 0;
            const localY = this.npcEcs.getY(npcIndex) | 0;
            targetX = (mapX << 13) + localX;
            targetY = (mapY << 13) + localY;
        } else {
            const targetEcs = this.playerEcs.getIndexForServerId(decoded.id | 0);
            if (targetEcs === undefined) return;
            targetX = this.playerEcs.getX(targetEcs) | 0;
            targetY = this.playerEcs.getY(targetEcs) | 0;
        }

        if (targetX === undefined || targetY === undefined) return;

        const orientation = this.computeOrientation(selfX, selfY, targetX, targetY);
        if (orientation === undefined) return;
        const state = this.movementSync.getState(serverId);
        // OSRS: targetIndex-facing is applied even while moving (PendingSpawn.method2449 runs every cycle).
        this.playerEcs.setTargetRot(ecsIndex, orientation);
        if (state) state.lastOrientation = orientation;
    }

    private collectMovementSeqs(ecsIndex: number): number[] {
        const seqs: number[] = [];
        const append = (key: Parameters<PlayerEcs["getAnimSeq"]>[1]) => {
            const seq = this.playerEcs.getAnimSeq(ecsIndex, key);
            if (typeof seq === "number" && seq >= 0) seqs.push(seq);
        };
        append("walk");
        append("walkBack");
        append("walkLeft");
        append("walkRight");
        append("run");
        append("runBack");
        append("runLeft");
        append("runRight");
        return Array.from(new Set(seqs));
    }
}
