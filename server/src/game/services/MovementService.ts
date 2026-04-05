import type { WebSocket } from "ws";

import { SkillId } from "../../../../src/rs/skill/skills";
import { encodeMessage } from "../../network/messages";
import type { PlayerNetworkLayer } from "../../network/PlayerNetworkLayer";
import type { BroadcastScheduler } from "../systems/BroadcastScheduler";
import { getItemDefinition } from "../../data/items";
import { RUN_ENERGY_MAX } from "../actor";
import type { ActionScheduler } from "../actions";
import type { MovementTeleportActionData } from "../actions/actionPayloads";
import { LockState } from "../model/LockState";
import type { PlayerState } from "../player";
import type { TickFrame } from "../tick/TickPhaseOrchestrator";
import { logger } from "../../utils/logger";

const TELEPORT_ACTION_GROUP = "movement.teleport";
const SAILING_WORLD_ENTITY_INDEX = 0;

export interface MovementServiceDeps {
    getActiveFrame: () => TickFrame | undefined;
    getSocketByPlayerId: (id: number) => WebSocket | undefined;
    networkLayer: PlayerNetworkLayer;
    broadcastScheduler: BroadcastScheduler;
    actionScheduler: ActionScheduler;
    getCurrentTick: () => number;
    getTickMs: () => number;
    getInventory: (player: PlayerState) => any[];
    ensureEquipArray: (player: PlayerState) => number[];
    queueWidgetEvent: (playerId: number, event: any) => void;
    queueVarbit: (playerId: number, varbitId: number, value: number) => void;
    queueChatMessage: (msg: any) => void;
    spawnLocForPlayer: (player: PlayerState, locId: number, tile: any, level: number, shape: number, rotation: number) => void;
    closeInterruptibleInterfaces: (player: PlayerState) => void;
    sailingInstanceManager: any;
    worldEntityInfoEncoder: any;
    interfaceService: any;
    cacheEnv: any;
    players: any;
}

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
    private pendingWalkCommands = new Map<WebSocket, any>();

    constructor(private readonly deps: MovementServiceDeps) {}

    getPendingWalkCommands(): Map<WebSocket, any> {
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
            this.deps.worldEntityInfoEncoder.isEntityActive(player.id, SAILING_WORLD_ENTITY_INDEX)
        ) {
            this.deps.sailingInstanceManager?.disposeInstance(player);
            this.deps.worldEntityInfoEncoder.removeEntity(player.id, SAILING_WORLD_ENTITY_INDEX);
            this.deps.actionScheduler.clearActionsInGroup(player.id, "sailing.boarding");

            for (const groupId of [937, 345]) {
                const closed = player.widgets.close(groupId);
                if (this.deps.interfaceService && closed.length > 0) {
                    this.deps.interfaceService.triggerCloseHooksForEntries(player, closed);
                }
            }

            this.deps.queueWidgetEvent(player.id, {
                action: "open_sub",
                targetUid: (161 << 16) | 76,
                groupId: 593,
                type: 1,
            });

            const sailingVarbits = [19136, 19137, 19122, 19104, 19151, 19153, 19176, 19175, 19118];
            for (const id of sailingVarbits) {
                player.setVarbitValue(id, 0);
                this.deps.queueVarbit(player.id, id, 0);
            }
        }

        try {
            this.deps.actionScheduler.clearActionsInGroup(player.id, "skill.woodcut");
            this.deps.actionScheduler.clearActionsInGroup(player.id, "inventory");
            player.clearInteraction();
            player.stopAnimation();
            player.clearWalkDestination();
        } catch {}

        player.teleport(x, y, level);

        const worldX = (x << 7) + 64;
        const worldY = (y << 7) + 64;

        const frame = this.deps.getActiveFrame();
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
        const ws = this.deps.getSocketByPlayerId(player.id);
        if (!ws) {
            logger.warn(`[teleportToInstance] No websocket for player ${player.id}`);
            return;
        }

        const regionX = x >> 3;
        const regionY = y >> 3;

        const { buildRebuildRegionPayload } = require("../../network/encoding/RebuildRegionEncoder");
        const payload = buildRebuildRegionPayload(regionX, regionY, templateChunks, this.deps.cacheEnv, false);
        const packet = encodeMessage({ type: "rebuild_region", payload } as any);
        this.deps.networkLayer.withDirectSendBypass("rebuild_region", () =>
            this.deps.networkLayer.sendWithGuard(ws, packet, "rebuild_region"),
        );

        this.teleportPlayer(player, x, y, level);

        if (extraLocs) {
            for (const loc of extraLocs) {
                this.deps.spawnLocForPlayer(player, loc.id, { x: loc.x, y: loc.y }, loc.level, loc.shape, loc.rotation);
            }
        }
    }

    requestTeleportAction(
        player: PlayerState,
        request: any,
    ): { ok: boolean; reason?: string } {
        const playerId = player.id;

        const replacePending = request.replacePending === true;
        if (replacePending) {
            this.deps.actionScheduler.clearActionsInGroup(playerId, TELEPORT_ACTION_GROUP);
            this.tryReleaseTeleportDelayLock(player, LockState.DELAY_ACTIONS);
        }

        const rejectIfPending = request.rejectIfPending !== false;
        if (rejectIfPending && this.deps.actionScheduler.hasPendingActionInGroup(playerId, TELEPORT_ACTION_GROUP)) {
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
        if (request.arriveMessage?.length > 0) data.arriveMessage = request.arriveMessage;
        if (request.arriveSeqId !== undefined) data.arriveSeqId = request.arriveSeqId;
        if (request.arriveFaceTileX !== undefined) data.arriveFaceTileX = request.arriveFaceTileX;
        if (request.arriveFaceTileY !== undefined) data.arriveFaceTileY = request.arriveFaceTileY;
        if (request.preserveAnimation) data.preserveAnimation = true;

        const result = this.deps.actionScheduler.requestAction(
            playerId,
            { kind: "movement.teleport", data, delayTicks, cooldownTicks, groups: [TELEPORT_ACTION_GROUP] },
            this.deps.getCurrentTick(),
        );
        if (!result.ok) {
            this.tryReleaseTeleportDelayLock(player, LockState.DELAY_ACTIONS);
            return { ok: false, reason: result.reason || "queue_rejected" };
        }
        return { ok: true };
    }

    tryReleaseTeleportDelayLock(player: PlayerState, expected: LockState): void {
        if (player.lock !== expected) return;
        if (this.deps.actionScheduler.hasPendingActionInGroup(player.id, TELEPORT_ACTION_GROUP)) return;
        player.lock = LockState.NONE;
    }

    // --- Run Energy ---

    getPlayerAgilityLevel(player: PlayerState): number {
        const agility = player.getSkill(SkillId.Agility);
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
        const inv = this.deps.getInventory(player);
        for (const entry of inv) {
            total += addWeight(entry.itemId, entry.quantity);
        }
        const equip = this.deps.ensureEquipArray(player);
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
        const equip = this.deps.ensureEquipArray(player);
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
        player.tickStaminaEffect(currentTick);
        if (player.syncInfiniteRunEnergy()) return;
        const agilityLevel = this.getPlayerAgilityLevel(player);
        if (activity.ran) {
            const weight = this.computePlayerWeightKg(player);
            const baseDrain = this.computeRunEnergyDrainUnits(weight, agilityLevel);
            const multiplier = player.getRunEnergyDrainMultiplier(currentTick);
            const stepCount = Math.max(1, activity.runSteps);
            const drain = Math.max(0, baseDrain * stepCount * multiplier);
            const nextUnits = player.adjustRunEnergyUnits(-drain);
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
            if (regen > 0 && player.getRunEnergyUnits() < RUN_ENERGY_MAX) {
                player.adjustRunEnergyUnits(regen);
            }
        }
    }

    buildRunEnergyPayload(player: PlayerState | undefined): any | undefined {
        if (!player) return undefined;
        player.syncInfiniteRunEnergy();
        const currentTick = this.deps.getCurrentTick();
        const staminaEffectTicks = player.getStaminaEffectRemainingTicks?.(currentTick) ?? 0;
        const staminaMultiplier = player.getRunEnergyDrainMultiplier?.(currentTick) ?? 1;
        const staminaActive = staminaEffectTicks > 0;
        const weight = this.computePlayerWeightKg(player);
        const units = player.getRunEnergyUnits();
        const percent = Math.max(0, Math.min(100, Math.round((units / RUN_ENERGY_MAX) * 100)));
        const payload: any = {
            percent,
            units: Math.max(0, Math.min(RUN_ENERGY_MAX, units)),
            running: player.wantsToRun(),
            weight,
        };
        if (staminaActive) {
            payload.staminaTicks = staminaEffectTicks;
            payload.staminaMultiplier = staminaMultiplier;
            payload.staminaTickMs = this.deps.getTickMs();
        }
        return payload;
    }

    queueRunEnergySnapshot(player: PlayerState | undefined): void {
        const payload = this.buildRunEnergyPayload(player);
        if (!payload || !player) return;
        const frame = this.deps.getActiveFrame();
        if (frame) {
            frame.runEnergySnapshots.push({ playerId: player.id, ...payload });
            player.markRunEnergySynced?.();
            return;
        }
        this.deps.broadcastScheduler.queueRunEnergySnapshot({ playerId: player.id, ...payload });
        player.markRunEnergySynced?.();
    }

    sendRunEnergyState(sock: WebSocket, player: PlayerState): void {
        const payload = this.buildRunEnergyPayload(player);
        if (!payload) return;
        this.deps.networkLayer.withDirectSendBypass("run_energy", () =>
            this.deps.networkLayer.sendWithGuard(sock, encodeMessage({ type: "run_energy", payload }), "run_energy"),
        );
        player.markRunEnergySynced?.();
    }

    // --- Walk Commands ---

    flushPendingWalkCommands(currentTick: number, stage: "pre" | "movement" = "pre"): void {
        if (!this.deps.players || this.pendingWalkCommands.size === 0) return;
        for (const [sock, command] of Array.from(this.pendingWalkCommands.entries())) {
            const handled = this.routeOrRejectWalkCommand(sock, command, currentTick, stage);
            if (handled) this.pendingWalkCommands.delete(sock);
        }
    }

    routeOrRejectWalkCommand(sock: WebSocket, command: any, currentTick: number, context: string): boolean {
        const player = this.deps.players?.get(sock);
        if (!player) return true;
        if (!player.canMove()) {
            if (player.lock === LockState.FULL) {
                this.deps.queueChatMessage({
                    messageType: "game",
                    text: "You can't do that right now.",
                    targetPlayerIds: [player.id],
                });
            }
            return true;
        }
        this.deps.closeInterruptibleInterfaces(player);
        try {
            player.clearInteraction();
            player.stopAnimation();
        } catch {}
        const result = this.deps.players.routePlayer(sock, player, command.destX, command.destY, command.running);
        return true;
    }
}
