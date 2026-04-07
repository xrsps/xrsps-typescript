import { SkillId } from "../../../../src/rs/skill/skills";
import { encodeMessage } from "../../network/messages";
import { getItemDefinition } from "../../data/items";
import { RUN_ENERGY_MAX } from "../actor";
import type { EmotePlayActionData, MovementTeleportActionData } from "../actions/actionPayloads";
import { getEmoteSeq } from "../emotes";
import { LockState } from "../model/LockState";
import type { PlayerState } from "../player";
import type { ServerServices } from "../ServerServices";
import { logger } from "../../utils/logger";

export interface RunEnergyPayload {
    percent: number;
    units: number;
    running: boolean;
    weight: number;
    staminaTicks?: number;
    staminaMultiplier?: number;
    staminaTickMs?: number;
}

export interface TeleportActionRequest {
    x: number;
    y: number;
    level: number;
    delayTicks?: number;
    cooldownTicks?: number;
    replacePending?: boolean;
    rejectIfPending?: boolean;
    requireCanTeleport?: boolean;
    forceRebuild?: boolean;
    resetAnimation?: boolean;
    endSpotAnim?: number;
    endSpotHeight?: number;
    endSpotDelay?: number;
    arriveSoundId?: number;
    arriveSoundRadius?: number;
    arriveSoundVolume?: number;
    arriveMessage?: string;
    arriveSeqId?: number;
    arriveFaceTileX?: number;
    arriveFaceTileY?: number;
    preserveAnimation?: boolean;
}

const TELEPORT_ACTION_GROUP = "movement.teleport";
const SAILING_WORLD_ENTITY_INDEX = 0;

// Graceful item ID sets for run energy calculation
const GRACEFUL_HOODS = new Set([11850, 13579, 13591, 13603, 13615, 13627, 13667, 21061, 24743, 25069]);
const GRACEFUL_TOPS = new Set([11854, 13583, 13595, 13607, 13619, 13631, 13671, 21067, 24749, 25075]);
const GRACEFUL_LEGS = new Set([11856, 13585, 13597, 13609, 13621, 13633, 13673, 21070, 24752, 25078]);
const GRACEFUL_GLOVES = new Set([11858, 13587, 13599, 13611, 13623, 13635, 13675, 21073, 24755, 25081]);
const GRACEFUL_BOOTS = new Set([11860, 13589, 13601, 13613, 13625, 13637, 13677, 21076, 24758, 25084]);
const GRACEFUL_CAPES = new Set([11852, 13581, 13593, 13605, 13617, 13629, 13669, 21064, 24746, 25072]);

/**
 * Manages player movement: teleportation, run energy, walk commands, weight calculation.
 * Extracted from WSServer.
 */
export class MovementService {
    private pendingWalkCommands = new Map<import("ws").WebSocket, { to: { x: number; y: number }; run: boolean }>();

    constructor(private readonly services: ServerServices) {}

    getPendingWalkCommands(): Map<import("ws").WebSocket, { to: { x: number; y: number }; run: boolean }> {
        return this.pendingWalkCommands;
    }

    // --- Teleportation ---

    teleportPlayer(
        player: PlayerState,
        x: number,
        y: number,
        level: number,
        _forceRebuild: boolean = false,
    ): void {
        if (
            player.worldViewId === SAILING_WORLD_ENTITY_INDEX &&
            this.services.worldEntityInfoEncoder.isEntityActive(player.id, SAILING_WORLD_ENTITY_INDEX)
        ) {
            this.services.sailingInstanceManager?.disposeInstance(player);
            this.services.worldEntityInfoEncoder.removeEntity(player.id, SAILING_WORLD_ENTITY_INDEX);
            this.services.actionScheduler.clearActionsInGroup(player.id, "sailing.boarding");

            for (const groupId of [937, 345]) {
                const closed = player.widgets.close(groupId);
                if (this.services.interfaceService && closed.length > 0) {
                    this.services.interfaceService.triggerCloseHooksForEntries(player, closed);
                }
            }

            this.services.queueWidgetEvent(player.id, {
                action: "open_sub",
                targetUid: (161 << 16) | 76,
                groupId: 593,
                type: 1,
            });

            const sailingVarbits = [19136, 19137, 19122, 19104, 19151, 19153, 19176, 19175, 19118];
            for (const id of sailingVarbits) {
                player.varps.setVarbitValue(id, 0);
                this.services.variableService.queueVarbit(player.id, id, 0);
            }
        }

        try {
            this.services.actionScheduler.clearActionsInGroup(player.id, "skill.woodcut");
            this.services.actionScheduler.clearActionsInGroup(player.id, "inventory");
            player.clearInteraction();
            player.stopAnimation();
            player.clearWalkDestination();
        } catch (err) { logger.warn("[movement] failed to clear interaction state", err); }

        player.teleport(x, y, level);

        const worldX = (x << 7) + 64;
        const worldY = (y << 7) + 64;

        const frame = this.services.activeFrame;
        if (frame) {
            const view = frame.playerViews.get(player.id);
            if (view) {
                view.x = worldX;
                view.y = worldY;
                view.level = level;
                view.snap = true;
                view.moved = true;
                view.directions = undefined;
                view.traversals = undefined;
                view.appearance = player.appearance;
            }
            frame.playerSteps.delete(player.id);
        }
    }

    teleportToInstance(
        player: PlayerState,
        x: number,
        y: number,
        level: number,
        templateChunks: number[][][],
        extraLocs?: Array<{ id: number; x: number; y: number; level: number; shape: number; rotation: number }>,
    ): void {
        logger.info(`[teleportToInstance] Player ${player.id} -> (${x}, ${y}, ${level})`);
        const ws = this.services.players?.getSocketByPlayerId(player.id);
        if (!ws) {
            logger.warn(`[teleportToInstance] No websocket for player ${player.id}`);
            return;
        }

        const regionX = x >> 3;
        const regionY = y >> 3;

        const { buildRebuildRegionPayload } = require("../../network/encoding/RebuildRegionEncoder");
        const payload = buildRebuildRegionPayload(regionX, regionY, templateChunks, this.services.cacheEnv, false);
        const packet = encodeMessage({ type: "rebuild_region", payload } as unknown as Parameters<typeof encodeMessage>[0]);
        this.services.networkLayer.withDirectSendBypass("rebuild_region", () =>
            this.services.networkLayer.sendWithGuard(ws, packet, "rebuild_region"),
        );

        this.teleportPlayer(player, x, y, level);

        if (extraLocs) {
            for (const loc of extraLocs) {
                this.services.locationService.spawnLocForPlayer(player, loc.id, { x: loc.x, y: loc.y }, loc.level, loc.shape, loc.rotation);
            }
        }
    }

    requestTeleportAction(
        player: PlayerState,
        request: TeleportActionRequest,
    ): { ok: boolean; reason?: string } {
        const playerId = player.id;

        const replacePending = request.replacePending === true;
        if (replacePending) {
            this.services.actionScheduler.clearActionsInGroup(playerId, TELEPORT_ACTION_GROUP);
            this.tryReleaseTeleportDelayLock(player, LockState.DELAY_ACTIONS);
        }

        const rejectIfPending = request.rejectIfPending !== false;
        if (rejectIfPending && this.services.actionScheduler.hasPendingActionInGroup(playerId, TELEPORT_ACTION_GROUP)) {
            return { ok: false, reason: "cooldown" };
        }

        const requireCanTeleport = request.requireCanTeleport !== false;
        if (requireCanTeleport && !player.canTeleport()) {
            return { ok: false, reason: "cannot_teleport" };
        }

        const delayTicks = request.delayTicks !== undefined ? Math.max(0, request.delayTicks) : 0;
        const cooldownTicks = request.cooldownTicks !== undefined ? Math.max(0, request.cooldownTicks) : 0;
        if (delayTicks > 0 && player.lock === LockState.NONE) {
            player.lock = LockState.DELAY_ACTIONS;
        }

        const data: MovementTeleportActionData = {
            x: request.x,
            y: request.y,
            level: request.level,
            forceRebuild: request.forceRebuild === true,
            resetAnimation: request.resetAnimation === true,
        };
        if (delayTicks > 0) data.unlockLockState = LockState.DELAY_ACTIONS;
        if (request.endSpotAnim !== undefined) data.endSpotAnim = request.endSpotAnim;
        if (request.endSpotHeight !== undefined) data.endSpotHeight = request.endSpotHeight;
        if (request.endSpotDelay !== undefined) data.endSpotDelay = request.endSpotDelay;
        if (request.arriveSoundId !== undefined) data.arriveSoundId = request.arriveSoundId;
        if (request.arriveSoundRadius !== undefined) data.arriveSoundRadius = request.arriveSoundRadius;
        if (request.arriveSoundVolume !== undefined) data.arriveSoundVolume = request.arriveSoundVolume;
        if (request.arriveMessage && request.arriveMessage.length > 0) data.arriveMessage = request.arriveMessage;
        if (request.arriveSeqId !== undefined) data.arriveSeqId = request.arriveSeqId;
        if (request.arriveFaceTileX !== undefined) data.arriveFaceTileX = request.arriveFaceTileX;
        if (request.arriveFaceTileY !== undefined) data.arriveFaceTileY = request.arriveFaceTileY;
        if (request.preserveAnimation) data.preserveAnimation = true;

        const result = this.services.actionScheduler.requestAction(
            playerId,
            { kind: "movement.teleport", data, delayTicks, cooldownTicks, groups: [TELEPORT_ACTION_GROUP] },
            this.services.ticker.currentTick(),
        );
        if (!result.ok) {
            this.tryReleaseTeleportDelayLock(player, LockState.DELAY_ACTIONS);
            return { ok: false, reason: result.reason || "queue_rejected" };
        }
        return { ok: true };
    }

    tryReleaseTeleportDelayLock(player: PlayerState, expected: LockState): void {
        if (player.lock !== expected) return;
        if (this.services.actionScheduler.hasPendingActionInGroup(player.id, TELEPORT_ACTION_GROUP)) return;
        player.lock = LockState.NONE;
    }

    // --- Run Energy ---

    getPlayerAgilityLevel(player: PlayerState): number {
        const agility = player.skillSystem.getSkill(SkillId.Agility);
        return Math.max(1, Math.min((agility.baseLevel ?? 1) + (agility.boost ?? 0), 120));
    }

    computePlayerWeightKg(player: PlayerState): number {
        const addWeight = (itemId: number, qty: number): number => {
            if (!(itemId > 0) || !(qty > 0)) return 0;
            const def = getItemDefinition(itemId);
            const weight = def?.weight ?? 0;
            if (!Number.isFinite(weight)) return 0;
            return weight * qty;
        };
        let total = 0;
        const inv = this.services.inventoryService.getInventory(player);
        for (const entry of inv) {
            total += addWeight(entry.itemId, entry.quantity);
        }
        const equip = this.services.equipmentService.ensureEquipArray(player);
        for (const itemId of equip) {
            total += addWeight(itemId, 1);
        }
        return total;
    }

    computeRunEnergyDrainUnits(weightKg: number, _agilityLevel: number): number {
        const cappedWeight = Math.min(64, Math.max(0, weightKg));
        return 67 + Math.floor((67 * cappedWeight) / 64);
    }

    computeRunEnergyRegenUnits(agilityLevel: number, opts: { resting: boolean; gracefulPieces?: number }): number {
        const clamped = Math.max(1, Math.min(99, agilityLevel));
        const base = Math.floor(clamped / 6) + 8;
        const gracefulPieces = opts.gracefulPieces ?? 0;
        if (gracefulPieces >= 6) {
            return Math.floor(base * 1.3);
        }
        return base;
    }

    countGracefulPieces(player: PlayerState): number {
        const equip = this.services.equipmentService.ensureEquipArray(player);
        let count = 0;
        for (const itemId of equip) {
            if (itemId <= 0) continue;
            if (GRACEFUL_HOODS.has(itemId)) count++;
            else if (GRACEFUL_TOPS.has(itemId)) count++;
            else if (GRACEFUL_LEGS.has(itemId)) count++;
            else if (GRACEFUL_GLOVES.has(itemId)) count++;
            else if (GRACEFUL_BOOTS.has(itemId)) count++;
            else if (GRACEFUL_CAPES.has(itemId)) count++;
        }
        return Math.min(6, count);
    }

    updateRunEnergy(
        player: PlayerState,
        activity: { ran: boolean; moved: boolean; runSteps: number },
        currentTick: number,
    ): void {
        player.energy.tickStaminaEffect(currentTick);
        if (player.energy.syncInfiniteRunEnergy()) return;
        const agilityLevel = this.getPlayerAgilityLevel(player);
        if (activity.ran) {
            const weight = this.computePlayerWeightKg(player);
            const baseDrain = this.computeRunEnergyDrainUnits(weight, agilityLevel);
            const multiplier = player.energy.getRunEnergyDrainMultiplier(currentTick);
            const stepCount = Math.max(1, activity.runSteps);
            const drain = Math.max(0, baseDrain * stepCount * multiplier);
            const nextUnits = player.energy.adjustRunEnergyUnits(-drain);
            if (nextUnits <= 0) {
                player.running = false;
                if (player.runToggle) player.setRunToggle(false);
            }
        } else {
            const gracefulPieces = this.countGracefulPieces(player);
            const regen = this.computeRunEnergyRegenUnits(agilityLevel, {
                resting: !activity.moved,
                gracefulPieces,
            });
            if (regen > 0 && player.energy.getRunEnergyUnits() < RUN_ENERGY_MAX) {
                player.energy.adjustRunEnergyUnits(regen);
            }
        }
    }

    buildRunEnergyPayload(player: PlayerState | undefined): RunEnergyPayload | undefined {
        if (!player) return undefined;
        player.energy.syncInfiniteRunEnergy();
        const currentTick = this.services.ticker.currentTick();
        const staminaEffectTicks = player.energy.getStaminaEffectRemainingTicks(currentTick) ?? 0;
        const staminaMultiplier = player.energy.getRunEnergyDrainMultiplier(currentTick) ?? 1;
        const staminaActive = staminaEffectTicks > 0;
        const weight = this.computePlayerWeightKg(player);
        const units = player.energy.getRunEnergyUnits();
        const percent = Math.max(0, Math.min(100, Math.round((units / RUN_ENERGY_MAX) * 100)));
        const payload: RunEnergyPayload = {
            percent,
            units: Math.max(0, Math.min(RUN_ENERGY_MAX, units)),
            running: player.energy.wantsToRun(),
            weight,
        };
        if (staminaActive) {
            payload.staminaTicks = staminaEffectTicks;
            payload.staminaMultiplier = staminaMultiplier;
            payload.staminaTickMs = this.services.tickMs;
        }
        return payload;
    }

    queueRunEnergySnapshot(player: PlayerState | undefined): void {
        const payload = this.buildRunEnergyPayload(player);
        if (!payload || !player) return;
        const frame = this.services.activeFrame;
        if (frame) {
            frame.runEnergySnapshots.push({ playerId: player.id, ...payload });
            player.energy.markRunEnergySynced();
            return;
        }
        this.services.broadcastScheduler.queueRunEnergySnapshot({ playerId: player.id, ...payload });
        player.energy.markRunEnergySynced();
    }

    sendRunEnergyState(sock: import("ws").WebSocket, player: PlayerState): void {
        const payload = this.buildRunEnergyPayload(player);
        if (!payload) return;
        this.services.networkLayer.withDirectSendBypass("run_energy", () =>
            this.services.networkLayer.sendWithGuard(sock, encodeMessage({ type: "run_energy", payload }), "run_energy"),
        );
        player.energy.markRunEnergySynced();
    }

    // --- Action Execution ---

    executeMovementTeleportAction(
        player: PlayerState,
        data: MovementTeleportActionData,
        tick: number,
    ): { ok: boolean; reason?: string; cooldownTicks?: number; groups?: string[] } {
        const unlockLockState = data.unlockLockState;

        const releaseDelayLock = () => {
            if (!unlockLockState) return;
            this.tryReleaseTeleportDelayLock(player, unlockLockState);
        };

        const x = data.x;
        const y = data.y;
        const level = data.level;
        try {
            this.teleportPlayer(player, x, y, level, data.forceRebuild);

            // teleportPlayer() unconditionally queues a stop
            // animation (-1).  When preserveAnimation is set (e.g. climbing),
            // the animation was already sent on a previous tick and should
            // continue playing at the new position — clear the -1 so no
            // animation update block is sent on the teleport tick.
            if (data.preserveAnimation) {
                player.clearPendingSeqs();
            }

            if (data.resetAnimation) {
                try {
                    player.stopAnimation();
                } catch (err) { logger.warn("[teleport] reset animation failed", err); }
            }

            if (data.endSpotAnim !== undefined && data.endSpotAnim > 0) {
                this.services.broadcastService.enqueueSpotAnimation({
                    tick,
                    playerId: player.id,
                    spotId: data.endSpotAnim,
                    height: data.endSpotHeight ?? 0,
                    delay: data.endSpotDelay ?? 0,
                });
            }

            if (data.arriveSoundId !== undefined && data.arriveSoundId > 0) {
                this.services.soundService.playAreaSound({
                    soundId: data.arriveSoundId,
                    tile: { x, y },
                    level,
                    radius:
                        data.arriveSoundRadius !== undefined
                            ? Math.max(0, data.arriveSoundRadius)
                            : 5,
                    volume:
                        data.arriveSoundVolume !== undefined
                            ? Math.max(0, data.arriveSoundVolume)
                            : 255,
                });
            }

            if (data.arriveMessage) {
                this.services.messagingService.queueChatMessage({
                    messageType: "game",
                    text: data.arriveMessage,
                    targetPlayerIds: [player.id],
                });
            }

            if (data.arriveFaceTileX !== undefined && data.arriveFaceTileY !== undefined) {
                player.faceTile(data.arriveFaceTileX, data.arriveFaceTileY);
            }

            if (data.arriveSeqId !== undefined && data.arriveSeqId >= 0) {
                // teleportPlayer() queues a stop animation (-1). Clear it so
                // the arrive animation lands in the same player_info frame.
                player.clearPendingSeqs();
                player.queueOneShotSeq(data.arriveSeqId, 0);
            }

            return { ok: true };
        } finally {
            releaseDelayLock();
        }
    }

    executeEmotePlayAction(
        player: PlayerState,
        data: EmotePlayActionData,
    ): { ok: boolean; reason?: string; cooldownTicks?: number; groups?: string[] } {
        const seqId =
            data.seqId ?? (data.emoteId !== undefined ? getEmoteSeq(data.emoteId) : undefined);
        if (seqId === undefined || seqId < 0) {
            return { ok: false, reason: "invalid_emote" };
        }
        const delayTicks = data.delayTicks !== undefined ? Math.max(0, data.delayTicks) : 0;
        player.queueOneShotSeq(seqId, delayTicks);
        return { ok: true, cooldownTicks: 0, groups: ["emote"] };
    }

    summarizeSteps(
        actor: PlayerState,
        steps:
            | Array<{
                  x: number;
                  y: number;
                  level: number;
                  rot: number;
                  running: boolean;
                  traversal?: number;
                  orientation?: number;
                  direction?: number;
                  seq?: number;
              }>
            | undefined,
    ): {
        directions: number[];
        traversals: number[];
        ran: boolean;
        runSteps: number;
        finalRot: number;
        finalOrientation: number;
        finalSeq?: number;
        level: number;
        subX: number;
        subY: number;
    } {
        const directions: number[] = [];
        const traversals: number[] = [];
        if (Array.isArray(steps)) {
            for (const step of steps) {
                const dir = step.direction !== undefined ? step.direction & 7 : undefined;
                if (dir === undefined) {
                    continue;
                }
                directions.push(dir);
                const traversal = step.traversal ?? (step.running ? 2 : 1);
                traversals.push(traversal >= 0 ? traversal : 1);
            }
        }
        const ran = Array.isArray(steps) && steps.some((s) => !!s.running);
        const runSteps = Array.isArray(steps) ? steps.filter((s) => !!s.running).length : 0;
        const lastStep =
            Array.isArray(steps) && steps.length > 0 ? steps[steps.length - 1] : undefined;
        const finalRot = lastStep ? lastStep.rot : actor.rot;
        const finalOrientation =
            lastStep?.orientation !== undefined
                ? lastStep.orientation & 2047
                : actor.getOrientation() & 2047;
        const finalSeq = lastStep?.seq;
        const level = lastStep ? lastStep.level : actor.level;
        const subX = lastStep ? lastStep.x : actor.x;
        const subY = lastStep ? lastStep.y : actor.y;
        return {
            directions,
            traversals,
            ran,
            runSteps,
            finalRot,
            finalOrientation,
            finalSeq,
            level,
            subX,
            subY,
        };
    }

    // --- Walk Commands ---

    flushPendingWalkCommands(currentTick: number, stage: "pre" | "movement" = "pre"): void {
        if (!this.services.players || this.pendingWalkCommands.size === 0) return;
        for (const [sock, command] of Array.from(this.pendingWalkCommands.entries())) {
            const handled = this.routeOrRejectWalkCommand(sock, command, currentTick, stage);
            if (handled) this.pendingWalkCommands.delete(sock);
        }
    }

    routeOrRejectWalkCommand(sock: import("ws").WebSocket, command: { to: { x: number; y: number }; run: boolean }, currentTick: number, context: string): boolean {
        const player = this.services.players?.get(sock);
        if (!player) return true;
        if (!player.canMove()) {
            if (player.lock === LockState.FULL) {
                this.services.messagingService.queueChatMessage({
                    messageType: "game",
                    text: "You can't do that right now.",
                    targetPlayerIds: [player.id],
                });
            }
            return true;
        }
        this.services.interfaceManager.closeInterruptibleInterfaces(player);
        try {
            player.clearInteraction();
            player.stopAnimation();
        } catch (err) { logger.warn("[movement] failed to clear interaction state", err); }
        const result = this.services.players?.routePlayer(sock, { x: command.to.x, y: command.to.y }, command.run);
        return true;
    }
}
