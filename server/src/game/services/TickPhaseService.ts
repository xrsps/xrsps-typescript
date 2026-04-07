import { WebSocket } from "ws";

import { DEBUG_PLAYER_IDS } from "../actor";
import {
    getWildernessLevel,
    isInLMS,
    isInPvPArea,
    isInRaid,
    isInWilderness,
    multiCombatSystem,
} from "../combat/MultiCombatZones";
import { deriveInteractionIndex } from "../interactions/InteractionViewBuilder";
import type { NpcUpdateDelta } from "../npc";
import type { PlayerState } from "../player";
import type { TickFrame, TickPhaseProvider } from "../tick/TickPhaseOrchestrator";

import type { BroadcastContext } from "../../network/broadcast/BroadcastDomain";
import type { PlayerTickFrameData } from "../../network/encoding";
import { PlayerSyncSession } from "../../network/PlayerSyncSession";
import { NpcSyncSession } from "../../network/NpcSyncSession";

import { faceAngleRs } from "../../../../src/rs/utils/rotation";
import { encodeMessage } from "../../network/messages";
import {
    VARBIT_IN_LMS,
    VARBIT_IN_RAID,
    VARBIT_IN_WILDERNESS,
    VARBIT_MULTICOMBAT_AREA,
    VARBIT_PVP_SPEC_ORB,
    VARBIT_RAID_STATE,
} from "../../../../src/shared/vars";

import { logger } from "../../utils/logger";
import type { ServerServices } from "../ServerServices";

type StepRecord = {
    x: number;
    y: number;
    level: number;
    rot: number;
    running: boolean;
    traversal?: number;
    seq?: number;
    orientation?: number;
    direction?: number;
};

import { EQUIPMENT_STATS_GROUP_ID } from "./EquipmentStatsUiService";

/**
 * Summarized step data returned by summarizeSteps.
 */
interface StepSummary {
    subX: number;
    subY: number;
    level: number;
    finalRot: number;
    finalOrientation: number;
    ran: boolean;
    runSteps: number;
    finalSeq: number | undefined;
    directions: number[];
    traversals: number[];
}

/**
 * NPC simulation radius - must match wsServer constant.
 */
const NPC_STREAM_RADIUS_TILES = 15;
const NPC_STREAM_EXIT_RADIUS_TILES = NPC_STREAM_RADIUS_TILES + 2;
const NPC_SIM_RADIUS_TILES = NPC_STREAM_EXIT_RADIUS_TILES + 12;

/**
 * Extracts tick phase logic from wsServer into a standalone service.
 * Implements TickPhaseProvider so the TickPhaseOrchestrator can call each phase.
 */
export class TickPhaseService implements TickPhaseProvider {
    constructor(private readonly svc: ServerServices) {}

    broadcastTick(_frame: TickFrame): void {
        // broadcastTick is handled separately by the BroadcastScheduler in wsServer.
        // This method exists to satisfy the interface; the orchestrator wires it to
        // the scheduler's broadcastTick call directly.
    }

    runPreMovementPhase(frame: TickFrame): void {
        const { npcManager, players, followerManager, followerCombatManager, npcSyncManager } =
            this.svc;

        if (npcManager) {
            try {
                const playerLookup = (id: number) => players?.getById(id) as PlayerState | undefined;
                const activeNpcIds = new Set<number>();
                if (players) {
                    players.forEach((_client, player) => {
                        npcManager.collectNearbyIds(
                            player.tileX,
                            player.tileY,
                            player.level,
                            NPC_SIM_RADIUS_TILES,
                            activeNpcIds,
                        );
                    });
                }
                followerManager?.addActiveNpcIds(activeNpcIds);
                followerManager?.tick(frame.tick);
                followerCombatManager?.tick(frame.tick);

                if (players) {
                    players.forEach((_client, player) => {
                        const inWilderness = isInWilderness(player.tileX, player.tileY);
                        player.aggression.updateAggressionState(frame.tick, player.tileX, player.tileY, inWilderness);
                    });
                }

                const getNearbyPlayers = (
                    tileX: number,
                    tileY: number,
                    level: number,
                    radius: number,
                ) => {
                    const nearbyPlayers: Array<{
                        id: number;
                        x: number;
                        y: number;
                        level: number;
                        combatLevel: number;
                        inCombat: boolean;
                        aggressionState: {
                            entryTick: number;
                            aggressionExpired: boolean;
                            tile1: { x: number; y: number };
                            tile2: { x: number; y: number };
                        };
                    }> = [];
                    if (players) {
                        players.forEach((_client, player) => {
                            if (player.level !== level) return;
                            const dx = Math.abs(player.tileX - tileX);
                            const dy = Math.abs(player.tileY - tileY);
                            const distance = Math.max(dx, dy);
                            if (distance > radius) return;
                            nearbyPlayers.push({
                                id: player.id,
                                x: player.tileX,
                                y: player.tileY,
                                level: player.level,
                                combatLevel: player.skillSystem.combatLevel,
                                inCombat: player.combat.isAttacking() || player.isBeingAttacked(),
                                aggressionState: player.aggression.getAggressionState(frame.tick, player.tileX, player.tileY),
                            });
                        });
                    }
                    return nearbyPlayers;
                };

                const npcTickResult = npcManager.tick(
                    frame.tick,
                    playerLookup,
                    activeNpcIds,
                    getNearbyPlayers,
                );
                frame.npcEffectEvents = npcTickResult.statusEvents;

                for (const aggroEvent of npcTickResult.aggressionEvents) {
                    this.scheduleNpcAggressionAttack(
                        aggroEvent.npcId,
                        aggroEvent.targetPlayerId,
                        frame.tick,
                    );
                }

                const emittedNpcUpdates = npcManager.consumeUpdates();
                if (frame.npcUpdates.length === 0) {
                    frame.npcUpdates = emittedNpcUpdates;
                } else if (emittedNpcUpdates.length > 0) {
                    const mergedByNpcId = new Map<number, NpcUpdateDelta>();
                    for (const update of emittedNpcUpdates) {
                        mergedByNpcId.set(update.id, { ...update });
                    }
                    for (const pending of frame.npcUpdates) {
                        const existing = mergedByNpcId.get(pending.id);
                        if (!existing) {
                            mergedByNpcId.set(pending.id, { ...pending });
                            continue;
                        }
                        mergedByNpcId.set(pending.id, {
                            ...existing,
                            ...pending,
                            directions:
                                pending.directions !== undefined
                                    ? pending.directions
                                    : existing.directions,
                            traversals:
                                pending.traversals !== undefined
                                    ? pending.traversals
                                    : existing.traversals,
                        });
                    }
                    frame.npcUpdates = Array.from(mergedByNpcId.values());
                }

                npcManager.forEach((npc) => {
                    if (npc.consumeColorOverrideDirty()) {
                        const co = npc.getColorOverride();
                        if (co && co.amount > 0) {
                            frame.npcColorOverrides.set(npc.id, co);
                        }
                    }
                });

                if (players) {
                    players.forEach((_client, player) => {
                        npcSyncManager!.updateNpcViewForPlayer(player);
                    });
                }
            } catch (err) {
                logger.warn("[NpcManager] tick error", err);
            }
        }
        if (!players) return;
        this.flushPendingWalkCommands(frame.tick, "pre");
        this.svc.movementSystem?.runPreMovement(frame.tick);
    }

    runMovementPhase(frame: TickFrame): void {
        const { players, npcManager } = this.svc;
        if (!players) return;
        this.flushPendingWalkCommands(frame.tick, "movement");
        const playerLookup = (id: number) => players.getById(id);
        const npcLookup = (npcId: number) => npcManager?.getById(npcId);
        const entries: Array<{ sock: WebSocket; player: PlayerState }> = [];
        players.forEach((sock, player) => entries.push({ sock, player }));

        entries.sort((a, b) => a.player.getPidPriority() - b.player.getPidPriority());

        for (const { sock, player } of entries) {
            players.applyInteractionFacing(sock, player, npcLookup, frame.tick);

            player.processDeferredMovement();
            player.processTimersAndQueue();

            try {
                const hadPath = player.hasPath();
                const walkUpdate = players.continueWalkToDestination(player, frame.tick);
                if (walkUpdate?.destinationCorrection) {
                    const corrected = walkUpdate.destinationCorrection;
                    this.svc.networkLayer.withDirectSendBypass("destination_correction_repath", () =>
                        this.svc.networkLayer.sendWithGuard(
                            sock,
                            encodeMessage({
                                type: "destination",
                                payload: {
                                    worldX: corrected.x,
                                    worldY: corrected.y,
                                },
                            }),
                            "destination_correction_repath",
                        ),
                    );
                }
                if (!hadPath && player.hasPath() && DEBUG_PLAYER_IDS.has(player.id)) {
                    try {
                        const dest = player.getWalkDestination();
                        const steps = player.getPathQueue() as {
                            x: number;
                            y: number;
                        }[];
                        const message = dest
                            ? `walk segment (repath) dest=(${dest.x},${dest.y}) run=${!!dest.run}`
                            : "walk segment (repath)";
                        const debugMsg = encodeMessage({
                            type: "path",
                            payload: {
                                id: -2000 - player.id,
                                ok: true,
                                waypoints: Array.isArray(steps)
                                    ? steps.map((t) => ({ x: t.x, y: t.y }))
                                    : [],
                                message,
                            },
                        });
                        if (sock && (sock as WebSocket).readyState === WebSocket.OPEN) {
                            if (this.svc.pendingDirectSends.size > 512) {
                                this.svc.pendingDirectSends.clear();
                            }
                            this.svc.pendingDirectSends.set(sock, { message: debugMsg, context: "walk_path_debug_repath" });
                        }
                    } catch (err) { logger.warn("Failed to send walk path debug repath", err); }
                }
            } catch (err) { logger.warn("Failed to process player movement phase", err); }

            const statusHits = this.svc.statusEffects.processPlayer(player, frame.tick);
            if (statusHits && statusHits.length > 0) {
                for (const event of statusHits) {
                    if (!(event.amount > 0)) continue;
                    frame.hitsplats.push({
                        targetType: "player",
                        targetId: player.id,
                        damage: event.amount,
                        style: event.style,
                        sourceType: "status",
                        hpCurrent: event.hpCurrent,
                        hpMax: event.hpMax,
                    });
                }
            }
            const prayerTick = this.svc.prayerSystem.processPlayer(player);
            if (prayerTick?.prayerDepleted) {
                this.svc.combatEffectService.handlePrayerDepleted(player);
            }
        }

        players.forEachBot((bot) => bot.processDeferredMovement());
        players.resolveMoveReservations();

        for (const { sock, player } of entries) {
            player.setMovementTick(frame.tick);
            const moved = player.tickStep();
            const steps = player.drainStepPositions() as StepRecord[] | undefined;

            if (steps && steps.length > 0) {
                frame.playerSteps.set(player.id, steps);
            }
            const summary = this.svc.movementService.summarizeSteps(player, steps);
            const interactionState = players.getInteractionState(sock);
            const interactionIndex = deriveInteractionIndex({
                player,
                interaction: interactionState,
                playerLookup,
                npcLookup,
            });
            frame.interactionIndices.set(player.id, interactionIndex);

            if (player.consumeColorOverrideDirty()) {
                const co = player.getColorOverride();
                if (co && co.amount > 0) {
                    frame.colorOverrides.set(player.id, co);
                }
            }

            this.svc.movementService.updateRunEnergy(
                player,
                { ran: summary.ran, moved, runSteps: summary.runSteps },
                frame.tick,
            );

            if (player.energy.hasRunEnergyUpdate()) {
                this.svc.movementService.queueRunEnergySnapshot(player);
            }

            const tileX = player.x / 128;
            const tileY = player.y / 128;
            const currentWildyLevel = getWildernessLevel(tileX, tileY);
            const previousWildyLevel = player.combat.lastWildernessLevel ?? 0;

            if (currentWildyLevel !== previousWildyLevel) {
                player.combat.lastWildernessLevel = currentWildyLevel;

                const PVP_INTERFACE_ID = 90;
                const PVP_ICONS_CONTAINER_UID = (161 << 16) | 3;
                const WILDERNESS_LEVEL_WIDGET_UID = (90 << 16) | 50;

                if (currentWildyLevel > 0 && previousWildyLevel === 0) {
                    this.svc.queueWidgetEvent(player.id, {
                        action: "open_sub",
                        targetUid: PVP_ICONS_CONTAINER_UID,
                        groupId: PVP_INTERFACE_ID,
                        type: 1,
                    });
                    this.svc.variableService.queueVarbit(player.id, VARBIT_IN_WILDERNESS, 1);
                } else if (currentWildyLevel === 0 && previousWildyLevel > 0) {
                    this.svc.queueWidgetEvent(player.id, {
                        action: "close_sub",
                        targetUid: PVP_ICONS_CONTAINER_UID,
                    });
                    this.svc.variableService.queueVarbit(player.id, VARBIT_IN_WILDERNESS, 0);
                }

                if (currentWildyLevel > 0) {
                    this.svc.broadcastService.queueClientScript(player.id, 388, WILDERNESS_LEVEL_WIDGET_UID);
                }
            }

            const currentInMulti = multiCombatSystem.isMultiCombat(tileX, tileY, player.level);
            const previousInMulti = player.combat.lastInMultiCombat ?? false;

            if (currentInMulti !== previousInMulti) {
                player.combat.lastInMultiCombat = currentInMulti;
                this.svc.variableService.queueVarbit(player.id, VARBIT_MULTICOMBAT_AREA, currentInMulti ? 1 : 0);
            }

            const currentInPvP = isInPvPArea(tileX, tileY, player.level);
            const previousInPvP = player.combat.lastInPvPArea ?? false;

            if (currentInPvP !== previousInPvP) {
                player.combat.lastInPvPArea = currentInPvP;
                this.svc.variableService.queueVarbit(player.id, VARBIT_PVP_SPEC_ORB, currentInPvP ? 1 : 0);
            }

            const currentInRaid = isInRaid(tileX, tileY, player.level);
            const previousInRaid = player.combat.lastInRaid ?? false;

            if (currentInRaid !== previousInRaid) {
                player.combat.lastInRaid = currentInRaid;
                this.svc.variableService.queueVarbit(player.id, VARBIT_IN_RAID, currentInRaid ? 1 : 0);
                if (!currentInRaid) {
                    this.svc.variableService.queueVarbit(player.id, VARBIT_RAID_STATE, 0);
                }
            }

            const currentInLMS = isInLMS(tileX, tileY, player.level);
            const previousInLMS = player.combat.lastInLMS ?? false;

            if (currentInLMS !== previousInLMS) {
                player.combat.lastInLMS = currentInLMS;
                this.svc.variableService.queueVarbit(player.id, VARBIT_IN_LMS, currentInLMS ? 1 : 0);
            }

            player.skillSystem.tickSkillRestoration(frame.tick);
            let specialUpdated = player.specEnergy.tick(frame.tick);
            if (!specialUpdated && player.specEnergy.hasUpdate?.()) {
                specialUpdated = true;
            }

            if (specialUpdated) {
                this.svc.queueCombatState(player);
            }
            const snap = player.wasTeleported() ?? false;
            const turned = player.didTurn() ?? false;
            const shouldSendMovement =
                summary.directions.length > 0 || snap || turned || player.shouldSendPos();
            if (shouldSendMovement) {
                player.markSent();
            }
            frame.playerViews.set(player.id, {
                id: player.id,
                x: summary.subX,
                y: summary.subY,
                level: summary.level,
                rot: summary.finalRot,
                orientation: summary.finalOrientation,
                running: summary.ran,
                name: this.svc.appearanceService.getAppearanceDisplayName(player),
                appearance: player.appearance,
                interactionIndex: interactionIndex >= 0 ? interactionIndex : undefined,
                seq: summary.finalSeq,
                moved: moved || snap,
                turned,
                snap,
                directions: summary.directions.length > 0 ? summary.directions : undefined,
                traversals: summary.traversals.length > 0 ? summary.traversals : undefined,
                anim: this.svc.appearanceService.buildAnimPayload(player),
                shouldSendPos: shouldSendMovement,
                worldViewId: player.worldViewId >= 0 ? player.worldViewId : undefined,
            });
            if (snap) {
                try {
                    player.clearTeleportFlag();
                } catch (err) { logger.warn("Failed to clear player teleport flag", err); }
            }
            const skillUpdate = player.skillSystem.takeSkillSync();
            if (skillUpdate) {
                this.svc.skillService.queueSkillSnapshot(player.id, skillUpdate);
            }
        }
        try {
            players.tickBots(frame.tick);
        } catch (err) { logger.warn("Failed to tick bots", err); }
        players.forEachBot((bot) => {
            const botSteps = bot.drainStepPositions() as StepRecord[] | undefined;
            if (botSteps && botSteps.length > 0) {
                frame.playerSteps.set(bot.id, botSteps);
            }
            const summary = this.svc.movementService.summarizeSteps(bot, botSteps);
            const snap = bot.wasTeleported() ?? false;
            const moved = bot.didMove() ?? false;
            const turned = bot.didTurn() ?? false;
            try {
                this.svc.movementService.updateRunEnergy(
                    bot,
                    { ran: summary.ran, moved, runSteps: summary.runSteps },
                    frame.tick,
                );
            } catch (err) { logger.warn("Failed to update bot run energy", err); }
            frame.playerViews.set(bot.id, {
                id: bot.id,
                x: summary.subX,
                y: summary.subY,
                level: summary.level,
                rot: summary.finalRot,
                orientation: summary.finalOrientation,
                running: summary.ran,
                name: this.svc.appearanceService.getAppearanceDisplayName(bot),
                appearance: bot.appearance,
                seq: summary.finalSeq,
                moved: moved || snap,
                turned,
                snap,
                directions: summary.directions.length > 0 ? summary.directions : undefined,
                traversals: summary.traversals.length > 0 ? summary.traversals : undefined,
                anim: this.svc.appearanceService.buildAnimPayload(bot),
                shouldSendPos: false,
            });
            if (snap) {
                try {
                    bot.clearTeleportFlag();
                } catch (err) { logger.warn("Failed to clear bot teleport flag", err); }
            }
        });
        try {
            this.svc.movementSystem?.runPostMovement(frame.tick);
        } catch (err) { logger.warn("Failed to run post-movement phase", err); }
    }

    runCombatPhase(frame: TickFrame): void {
        const { players, playerCombatManager, npcManager } = this.svc;
        if (!players || !playerCombatManager) return;
        const combatResult = playerCombatManager.processTick({
            tick: frame.tick,
            npcLookup: (npcId) => npcManager?.getById(npcId),
            pathService: this.svc.pathService!,
            pickAttackSpeed: (player) => this.svc.playerCombatService!.pickAttackSpeed(player),
            pickNpcHitDelay: (npc, player, attackSpeed) =>
                this.svc.combatEffectService.pickNpcHitDelay(npc, player, attackSpeed),
            getWeaponSpecialCostPercent: (weaponItemId) =>
                this.svc.combatDataService.getWeaponSpecialCostPercent(weaponItemId),
            getAttackReach: (player) => this.svc.playerCombatService!.getPlayerAttackReach(player),
            queueSpotAnimation: (event) => {
                this.svc.broadcastService.enqueueSpotAnimation(event);
            },
            onMagicAttack: ({ player, npc, plan, tick }) =>
                this.svc.spellActionHandler!.handleAutocastMagicAttack({
                    player,
                    npc,
                    plan,
                    tick,
                }),
            logger,
        });
        for (const ended of combatResult.endedEngagements) {
            try {
                players.finishNpcCombatByPlayerId(ended.playerId);
            } catch (err) { logger.warn("Failed to finish NPC combat engagement", err); }
        }
        frame.actionEffects = combatResult.effects;
        this.refreshInteractionFacing(frame);
        this.processGamemodeTickCallbacks(frame);
    }

    runScriptPhase(frame: TickFrame): void {
        this.svc.scriptRuntime.queueTick(frame.tick);
        this.svc.scriptScheduler.process(frame.tick);
    }

    runDeathPhase(_frame: TickFrame): void {
        if (this.svc.playerDeathService) {
            this.svc.playerDeathService.tick();
        }
    }

    runPostScriptPhase(frame: TickFrame): void {
        this.svc.scriptScheduler.process(frame.tick);
    }

    runPostEffectsPhase(frame: TickFrame): void {
        if (this.svc.gatheringSystem) {
            this.svc.gatheringSystem.processTick(frame.tick);
        }
        this.svc.groundItems.tick(frame.tick);
        if (frame.actionEffects.length > 0) {
            this.svc.effectDispatcher!.dispatchActionEffects(frame.actionEffects, frame);
        }
        if (this.svc.players) {
            const nowMs = Date.now();
            this.svc.players.forEach((_, player) => {
                this.svc.accountSummary.syncPlayer(player, nowMs);
                this.svc.gamemode.onPlayerTick?.(player, nowMs);
                this.svc.reportGameTime.syncPlayer(player, nowMs);
                const seqData = player.popPendingSeq() as
                    | { seqId: number; delay: number }
                    | undefined;
                if (seqData && seqData.seqId >= -1) {
                    frame.pendingSequences.set(player.id, {
                        seqId: seqData.seqId,
                        delay: Math.max(0, seqData.delay),
                        startTick: frame.tick,
                    });
                    const view = frame.playerViews.get(player.id);
                    if (view) {
                        view.shouldSendPos = true;
                    }
                }
                this.svc.varpSyncService.syncCombatTargetPlayerVarp(player);
                player.combat.attackDelay = this.svc.playerCombatService!.pickAttackSpeed(player);
            });
            this.svc.players.forEachBot((bot) => {
                const seqData = bot.popPendingSeq() as { seqId: number; delay: number } | undefined;
                if (seqData && seqData.seqId >= 0) {
                    frame.pendingSequences.set(bot.id, {
                        seqId: seqData.seqId,
                        delay: Math.max(0, seqData.delay),
                        startTick: frame.tick,
                    });
                    const view = frame.playerViews.get(bot.id);
                    if (view) {
                        view.shouldSendPos = true;
                    }
                }
            });
        }
        this.svc.tradeManager?.tick(frame.tick);
    }

    runOrphanedPlayersPhase(frame: TickFrame): void {
        const { players } = this.svc;
        if (!players) return;

        players.processOrphanedPlayers(frame.tick, (player, saveKey) => {
            try {
                this.svc.playerPersistence.saveSnapshot(saveKey, player);
                logger.info(`[orphan] Saved and removed expired orphan: ${saveKey}`);
            } catch (err) {
                logger.warn(`[orphan] Failed to save expired orphan ${saveKey}:`, err);
            }
            this.svc.followerCombatManager?.resetPlayer(player.id);
            this.svc.followerManager?.despawnFollowerForPlayer(player.id, false);
            this.svc.actionScheduler.unregisterPlayer(player.id);
        });
    }

    runBroadcastPhase(frame: TickFrame): void {
        this.svc.scriptScheduler.process(frame.tick);
        this.svc.networkLayer.setBroadcastPhase(true);
        try {
            const ctx = this.buildBroadcastContext();
            if (this.svc.pendingDirectSends.size > 0) {
                const entries = Array.from(this.svc.pendingDirectSends.entries());
                this.svc.pendingDirectSends.clear();
                for (const [ws, entry] of entries) {
                    try {
                        this.svc.networkLayer.sendWithGuard(ws, entry.message, entry.context);
                    } catch (err) { logger.warn("Failed to flush pending direct send", err); }
                }
            }
            this.svc.miscBroadcaster.flushLocChanges(frame, ctx);
            this.svc.skillBroadcaster.flush(frame, ctx);
            this.svc.combatBroadcaster.flush(frame, ctx);
            this.svc.actorSyncBroadcaster.flush(frame, ctx);
            this.svc.widgetBroadcaster.flushCloseEvents(frame, ctx);
            this.svc.varBroadcaster.flush(frame, ctx);
            this.svc.widgetBroadcaster.flushOpenEvents(frame, ctx);
            this.svc.miscBroadcaster.flushPostWidgetEvents(frame, ctx);
            this.svc.chatBroadcaster.flush(frame, ctx);
            this.svc.inventoryBroadcaster.flush(frame, ctx);
            this.flushPerPlayerDirtyState(frame);
            this.flushAnimSnapshots(frame, ctx);
        } finally {
            this.svc.networkLayer.flushAllMessageBatches();
            this.svc.networkLayer.setBroadcastPhase(false);
            this.svc.networkLayer.flushDirectSendWarnings("broadcast");
        }
    }

    runMusicPhase(_frame: TickFrame): void {
        this.svc.soundManager!.runMusicPhase(_frame);
    }

    checkAndSendSnapshots(player: PlayerState, sock?: WebSocket): void {
        if (this.svc.activeFrame) {
            return;
        }

        const ws = sock ?? this.svc.players?.getSocketByPlayerId(player.id);
        if (!ws || ws.readyState !== 1 /* WebSocket.OPEN */) return;

        if (player.hasInventoryUpdate()) {
            const snapshot = player.takeInventorySnapshot();
            if (snapshot) {
                this.svc.inventoryService.sendInventorySnapshotImmediate(ws, player);
            }
        }
        if (player.hasAppearanceUpdate()) {
            // Let the dirty flag remain for tick-based player sync.
        }
        if (player.hasCombatStateUpdate()) {
            player.takeCombatStateSnapshot();
            this.svc.queueCombatState(player);
        }
    }

    // --- Private helpers ---

    private scheduleNpcAggressionAttack(
        npcId: number,
        targetPlayerId: number,
        currentTick: number,
    ): void {
        const player = this.svc.players?.getById(targetPlayerId);
        if (!player) return;

        const npc = this.svc.npcManager?.getById(npcId);
        if (!npc || npc.isDead?.(currentTick)) return;

        const result = this.svc.actionScheduler.requestAction(
            player.id,
            {
                kind: "combat.npcRetaliate",
                data: {
                    npcId: npc.id,
                    phase: "swing",
                    isAggression: true,
                },
                groups: ["combat.npcAggro"],
                cooldownTicks: 0,
                delayTicks: 0,
            },
            currentTick,
        );

        if (!result.ok) {
            logger.info(
                `[aggression] failed to schedule NPC attack (npc=${npcId}, player=${targetPlayerId}): ${result.reason}`,
            );
        }
    }

    private flushPendingWalkCommands(
        currentTick: number,
        stage: "pre" | "movement" = "pre",
    ): void {
        this.svc.movementService.flushPendingWalkCommands(currentTick, stage);
    }

    private refreshInteractionFacing(frame: TickFrame): void {
        const { players, npcManager } = this.svc;
        if (!players) return;
        const playerLookup = (id: number) => players.getById(id);
        const npcLookup = (npcId: number) => npcManager?.getById(npcId);

        const updateView = (player: PlayerState, interactionIndex: number | undefined) => {
            frame.interactionIndices.set(player.id, interactionIndex ?? -1);
            const view = frame.playerViews.get(player.id);
            if (view) {
                const previousOrientation = view.orientation;
                const updatedOrientation = player.getOrientation() & 2047;
                view.orientation = updatedOrientation;
                view.interactionIndex =
                    interactionIndex !== undefined && interactionIndex >= 0
                        ? interactionIndex
                        : undefined;
                if (previousOrientation !== updatedOrientation) {
                    player.markSent();
                }
            }
        };

        const collectFaceTile = (player: PlayerState) => {
            if (player.pendingFaceTile) {
                const ft = player.pendingFaceTile;
                const targetX = (ft.x << 7) + 64;
                const targetY = (ft.y << 7) + 64;
                const dir = faceAngleRs(player.x, player.y, targetX, targetY) & 2047;
                frame.pendingFaceDirs.set(player.id, dir);
                player.pendingFaceTile = undefined;
            }
        };

        players.forEach((sock, player) => {
            try {
                players.applyInteractionFacing(sock, player, npcLookup);
            } catch (err) { logger.warn("Failed to apply interaction facing", err); }
            collectFaceTile(player);
            const interactionState = players.getInteractionState(sock);
            const interactionIndex = deriveInteractionIndex({
                player,
                interaction: interactionState,
                playerLookup,
                npcLookup,
            });
            updateView(player, interactionIndex);
        });

        players.forEachBot((bot) => {
            const interactionState = (bot as PlayerState & { botInteraction?: unknown }).botInteraction;
            collectFaceTile(bot);
            const interactionIndex = deriveInteractionIndex({
                player: bot,
                interaction: interactionState,
                playerLookup,
                npcLookup,
            });
            updateView(bot, interactionIndex);
        });
    }

    private processGamemodeTickCallbacks(frame: TickFrame): void {
        for (const callback of this.svc.gamemodeTickCallbacks) {
            try {
                callback(frame.tick);
            } catch (err) {
                logger.warn("[gamemode-tick] Tick callback error", err);
            }
        }
    }

    private buildBroadcastContext(): BroadcastContext {
        const tickMs = Math.max(1, this.svc.tickMs);
        return {
            sendWithGuard: (sock, msg, context) => this.svc.networkLayer.sendWithGuard(sock, msg, context),
            broadcast: (msg, context) => this.svc.broadcastService.broadcast(msg, context),
            getSocketByPlayerId: (id) => this.svc.players?.getSocketByPlayerId(id),
            cyclesPerTick: Math.max(1, Math.round(tickMs / 20)),
        };
    }

    private flushPerPlayerDirtyState(frame: TickFrame): void {
        const { players } = this.svc;
        if (!players) return;
        players.forEach((_, player) => {
            player.clearTeleportFlag();
        });
        players.forEachBot((bot) => {
            bot.clearTeleportFlag();
        });
        players.forEach((sock, player) => {
            this.svc.locationService.maybeReplayDynamicLocState(sock, player, false);
        });
        players.forEach((sock, player) => {
            this.svc.groundItemHandler?.maybeSendGroundItemSnapshot(sock, player);
        });
        players.forEach((sock, player) => {
            if (player.hasInventoryUpdate()) {
                const snapshot = player.takeInventorySnapshot();
                if (snapshot) {
                    const inv = this.svc.inventoryService.getInventory(player);
                    const slots = inv.map((entry, idx) => ({
                        slot: idx,
                        itemId: entry.itemId,
                        quantity: entry.quantity,
                    }));
                    this.svc.networkLayer.sendWithGuard(
                        sock,
                        encodeMessage({
                            type: "inventory",
                            payload: { kind: "snapshot" as const, slots },
                        }),
                        "inventory_snapshot",
                    );
                }
            }
            const appearanceDirty = player.hasAppearanceUpdate();
            if (appearanceDirty) {
                player.takeAppearanceSnapshot();
                this.svc.playerAppearanceManager!.queueAppearanceSnapshot(player);
                this.svc.appearanceService.queueAnimSnapshot(player.id, this.svc.appearanceService.buildAnimPayload(player));
            }
            const hasCombatUpdate = player.hasCombatStateUpdate();
            if (hasCombatUpdate) {
                player.takeCombatStateSnapshot();
                let specialEnergy: number | undefined;
                let specialActivated: boolean | undefined;
                let quickPrayers: string[] | undefined;
                let quickPrayersEnabled: boolean | undefined;
                try {
                    specialEnergy = player.specEnergy.getPercent();
                    specialActivated = player.specEnergy.isActivated();
                    player.specEnergy.markSynced();
                    const quickSet = player.prayer.getQuickPrayers();
                    quickPrayers = Array.from(quickSet);
                    quickPrayersEnabled = player.prayer.areQuickPrayersEnabled();
                } catch (err) { logger.warn("Failed to read combat UI state", err); }
                this.svc.networkLayer.sendWithGuard(
                    sock,
                    encodeMessage({
                        type: "combat",
                        payload: {
                            weaponCategory: player.combat.weaponCategory,
                            weaponItemId: player.combat.weaponItemId,
                            autoRetaliate: !!player.combat.autoRetaliate,
                            activeStyle: player.combat.styleSlot,
                            activePrayers: Array.from(player.prayer.activePrayers ?? []),
                            activeSpellId:
                                player.combat.spellId > 0 ? player.combat.spellId : undefined,
                            specialEnergy,
                            specialActivated,
                            quickPrayers,
                            quickPrayersEnabled,
                        },
                    }),
                    "combat_state_dirty",
                );
            }
            if (
                (appearanceDirty || hasCombatUpdate) &&
                this.svc.interfaceManager.isWidgetGroupOpenInLedger(player.id, EQUIPMENT_STATS_GROUP_ID)
            ) {
                this.svc.equipmentStatsUiService.queueEquipmentStatsWidgetTexts(player);
            }
        });
    }

    private flushAnimSnapshots(frame: TickFrame, ctx: BroadcastContext): void {
        if (!frame.animSnapshots || frame.animSnapshots.length === 0) return;
        for (const snapshot of frame.animSnapshots) {
            const sock = ctx.getSocketByPlayerId(snapshot.playerId);
            ctx.sendWithGuard(
                sock,
                encodeMessage({ type: "anim", payload: snapshot.anim }),
                "anim_snapshot",
            );
        }
    }

    applyAppearanceSnapshotsToViews(frame: TickFrame): void {
        if (!frame.appearanceSnapshots || frame.appearanceSnapshots.length === 0) return;
        for (const snapshot of frame.appearanceSnapshots) {
            const view = frame.playerViews.get(snapshot.playerId);
            if (view) {
                if (snapshot.payload.appearance) {
                    view.appearance = snapshot.payload.appearance;
                }
                if (snapshot.payload.snap) {
                    view.x = snapshot.payload.x;
                    view.y = snapshot.payload.y;
                    view.level = snapshot.payload.level;
                    view.snap = true;
                    view.moved = true;
                }
                if (snapshot.payload.anim) {
                    view.anim = snapshot.payload.anim;
                }
                if (snapshot.payload.worldViewId !== undefined) {
                    view.worldViewId = snapshot.payload.worldViewId;
                }
            }
        }
    }

    buildAndSendActorSync(
        sock: WebSocket,
        player: PlayerState,
        frame: TickFrame,
        ctx: BroadcastContext,
    ): void {
        let session = this.svc.playerSyncSessions.get(sock);
        if (!session) {
            session = new PlayerSyncSession();
            this.svc.playerSyncSessions.set(sock, session);
        }
        const playerFrame: PlayerTickFrameData = {
            tick: frame.tick,
            tickMs: this.svc.tickMs,
            playerViews: frame.playerViews,
            playerSteps: frame.playerSteps,
            hitsplats: frame.hitsplats,
            forcedChats: frame.forcedChats,
            forcedMovements: frame.forcedMovements,
            spotAnimations: frame.spotAnimations,
            chatMessages: frame.chatMessages,
            pendingSequences: frame.pendingSequences,
            interactionIndices: frame.interactionIndices,
            pendingFaceDirs: frame.pendingFaceDirs,
            colorOverrides: frame.colorOverrides,
        };
        const packet = this.svc.playerPacketEncoder!.buildPlayerSyncPacket(
            session,
            player,
            playerFrame,
        );
        session.activeIndices = packet.activeIndices;
        ctx.sendWithGuard(
            sock,
            encodeMessage({
                type: "player_sync",
                payload: {
                    baseX: packet.baseTileX,
                    baseY: packet.baseTileY,
                    localIndex: player.id,
                    loopCycle: frame.tick,
                    packet: Array.from(packet.bytes),
                },
            }),
            "player_sync",
        );

        if (this.svc.enableBinaryNpcSync && this.svc.npcManager) {
            try {
                let npcSession = this.svc.npcSyncSessions.get(sock);
                if (!npcSession) {
                    npcSession = new NpcSyncSession();
                    this.svc.npcSyncSessions.set(sock, npcSession);
                }
                const npcFrame = {
                    tick: frame.tick,
                    tickMs: this.svc.tickMs,
                    npcUpdates: frame.npcUpdates,
                    hitsplats: frame.hitsplats,
                    npcEffectEvents: frame.npcEffectEvents,
                    spotAnimations: frame.spotAnimations,
                    colorOverrides: frame.npcColorOverrides,
                };
                const built = this.svc.npcPacketEncoder!.buildNpcSyncPacket(
                    player,
                    npcFrame,
                    npcSession,
                );
                if (built.packet.length > 0) {
                    ctx.sendWithGuard(
                        sock,
                        encodeMessage({
                            type: "npc_info",
                            payload: {
                                loopCycle: frame.tick,
                                large: built.large,
                                packet: Array.from(built.packet),
                            },
                        }),
                        "npc_info",
                    );
                }
            } catch (err) {
                logger.warn("[npc_info] encode failed", err);
            }
        }
        if (this.svc.worldEntityInfoEncoder.needsUpdate(player.id)) {
            const wePacket = this.svc.worldEntityInfoEncoder.encode(player.id);
            if (wePacket) {
                ctx.sendWithGuard(sock, wePacket, "worldentity_info");
            }
        }
    }
}
