import type { WebSocket } from "ws";

import type { ActionScheduler } from "../actions";
import type { EffectDispatcher } from "../actions";
import { DEBUG_PLAYER_IDS } from "../actor";
import type { PlayerCombatManager } from "../combat";
import {
    getWildernessLevel,
    isInLMS,
    isInPvPArea,
    isInRaid,
    isInWilderness,
    multiCombatSystem,
} from "../combat/MultiCombatZones";
import type { PlayerDeathService } from "../death";
import type { FollowerCombatManager } from "../followers/FollowerCombatManager";
import type { FollowerManager } from "../followers/FollowerManager";
import { deriveInteractionIndex } from "../interactions/InteractionViewBuilder";
import type { GroundItemManager } from "../items/GroundItemManager";
import type { NpcState, NpcUpdateDelta } from "../npc";
import type { NpcManager } from "../npcManager";
import type { InventoryEntry, PlayerManager, PlayerState, SkillSyncUpdate } from "../player";
import type { PrayerSystemProvider } from "../prayer/PrayerSystemProvider";
import type { ScriptRuntime } from "../scripts/ScriptRuntime";
import type {
    BroadcastScheduler,
    PendingSpotAnimation,
    PlayerAnimSet,
} from "../systems/BroadcastScheduler";
import type { GatheringSystemManager } from "../systems/GatheringSystemManager";
import type { MovementSystem } from "../systems/MovementSystem";
import type { ScriptScheduler } from "../systems/ScriptScheduler";
import type { StatusEffectSystem } from "../systems/StatusEffectSystem";
import type { TickFrame, TickPhaseProvider } from "../tick/TickPhaseOrchestrator";
import type { TradeManager } from "../trade/TradeManager";
import type { GamemodeDefinition } from "../gamemodes/GamemodeDefinition";

import type { BroadcastContext } from "../../network/broadcast/BroadcastDomain";
import type { MovementService } from "./MovementService";
import type { InventoryService } from "./InventoryService";
import type { AppearanceService } from "./AppearanceService";
import type { PlayerCombatService } from "./PlayerCombatService";
import type { CombatDataService } from "./CombatDataService";
import type { CombatEffectService } from "./CombatEffectService";
import type { VariableService } from "./VariableService";
import type { VarpSyncService } from "./VarpSyncService";
import type { EquipmentStatsUiService } from "./EquipmentStatsUiService";
import type { InterfaceManager } from "./InterfaceManager";
import type { SoundManager } from "../../network/managers";
import type { NpcSyncManager } from "../../network/managers";
import type { PlayerAppearanceManager } from "../../network/managers/PlayerAppearanceManager";
import type { PlayerNetworkLayer } from "../../network/PlayerNetworkLayer";
import type { PlayerPacketEncoder, PlayerTickFrameData } from "../../network/encoding";
import type { NpcPacketEncoder } from "../../network/encoding";
import type { WorldEntityInfoEncoder } from "../../network/encoding/WorldEntityInfoEncoder";
import type { PlayerSyncSession } from "../../network/PlayerSyncSession";
import type { NpcSyncSession } from "../../network/NpcSyncSession";
import type { AccountSummaryTracker } from "../../network/accountSummary";
import type { ReportGameTimeTracker } from "../../network/reportGameTime";
import type { WidgetAction } from "../../widgets/WidgetManager";
import type { SpellActionHandler } from "../actions";
import type { PathService } from "../../pathfinding/PathService";

import { faceAngleRs } from "../../../../src/rs/utils/rotation";
import { encodeMessage } from "../../network/messages";
import {
    VARBIT_IN_LMS,
    VARBIT_IN_RAID,
    VARBIT_IN_WILDERNESS,
    VARBIT_MULTICOMBAT_AREA,
    VARBIT_PVP_SPEC_ORB,
    VARBIT_RAID_STATE,
    VARP_COMBAT_TARGET_PLAYER_INDEX,
} from "../../../../src/shared/vars";

import { logger } from "../../utils/logger";

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
 * Dependencies required by TickPhaseService.
 * Grouped by domain for readability.
 */
export interface TickPhaseServiceDeps {
    // --- Managers ---
    players: PlayerManager | undefined;
    npcManager: NpcManager | undefined;
    followerManager: FollowerManager | undefined;
    followerCombatManager: FollowerCombatManager | undefined;
    playerCombatManager: PlayerCombatManager | undefined;
    actionScheduler: ActionScheduler;

    // --- Services ---
    movementService: MovementService;
    movementSystem: MovementSystem | undefined;
    soundManager: SoundManager;
    scriptRuntime: ScriptRuntime;
    scriptScheduler: ScriptScheduler;
    statusEffects: StatusEffectSystem;
    prayerSystem: PrayerSystemProvider;
    playerDeathService: PlayerDeathService | undefined;
    gatheringSystem: GatheringSystemManager | undefined;
    groundItems: GroundItemManager;
    tradeManager: TradeManager | undefined;
    effectDispatcher: EffectDispatcher;
    inventoryService: InventoryService;
    accountSummary: AccountSummaryTracker;
    reportGameTime: ReportGameTimeTracker;
    gamemode: GamemodeDefinition;
    playerPersistence: { saveSnapshot(key: string, player: PlayerState): void };

    // --- Sync encoders ---
    npcSyncManager: NpcSyncManager;
    playerPacketEncoder: PlayerPacketEncoder;
    npcPacketEncoder: NpcPacketEncoder;
    worldEntityInfoEncoder: WorldEntityInfoEncoder;
    enableBinaryNpcSync: boolean;

    // --- Network ---
    networkLayer: PlayerNetworkLayer;
    pendingDirectSends: Map<WebSocket, { message: string | Uint8Array; context: string }>;
    sendWithGuard: (sock: WebSocket | undefined, msg: string | Uint8Array, context: string) => void;
    broadcast: (msg: string | Uint8Array, context?: string) => void;

    // --- Broadcasters ---
    skillBroadcaster: { flush(frame: TickFrame, ctx: BroadcastContext): void };
    varBroadcaster: { flush(frame: TickFrame, ctx: BroadcastContext): void };
    chatBroadcaster: { flush(frame: TickFrame, ctx: BroadcastContext): void };
    inventoryBroadcaster: { flush(frame: TickFrame, ctx: BroadcastContext): void };
    widgetBroadcaster: {
        flushCloseEvents(frame: TickFrame, ctx: BroadcastContext): void;
        flushOpenEvents(frame: TickFrame, ctx: BroadcastContext): void;
    };
    combatBroadcaster: { flush(frame: TickFrame, ctx: BroadcastContext): void };
    miscBroadcaster: {
        flushLocChanges(frame: TickFrame, ctx: BroadcastContext): void;
        flushPostWidgetEvents(frame: TickFrame, ctx: BroadcastContext): void;
    };
    actorSyncBroadcaster: { flush(frame: TickFrame, ctx: BroadcastContext): void };

    // --- Gamemode tick callbacks ---
    gamemodeTickCallbacks: Array<(tick: number) => void>;

    // --- Options ---
    tickMs: number;
    pathService: PathService;

    // --- Extracted services (accessed directly instead of via wsServer delegates) ---
    appearanceService: AppearanceService;
    playerCombatService: PlayerCombatService;
    combatDataService: CombatDataService;
    combatEffectService: CombatEffectService;
    variableService: VariableService;
    varpSyncService: VarpSyncService;
    equipmentStatsUiService: EquipmentStatsUiService;
    interfaceManager: InterfaceManager;
    playerAppearanceManager: PlayerAppearanceManager;

    // --- Remaining wsServer callbacks (have real logic beyond simple delegation) ---
    queueWidgetEvent: (playerId: number, action: WidgetAction) => void;
    queueClientScript: (playerId: number, scriptId: number, ...args: number[]) => void;
    queueCombatSnapshot: (
        playerId: number,
        weaponCategory: number,
        weaponItemId: number,
        autoRetaliate: boolean,
        activeStyle: number,
        activePrayers: string[],
        activeSpellId?: number,
    ) => void;
    queueDirectSend: (
        sock: WebSocket,
        msg: string | Uint8Array,
        context: string,
    ) => void;
    withDirectSendBypass: <T>(context: string, fn: () => T) => T;
    sendSkillsMessage: (ws: WebSocket, player: PlayerState, update?: SkillSyncUpdate) => void;
    sendCombatState: (ws: WebSocket, player: PlayerState) => void;
    enqueueSpotAnimation: (event: PendingSpotAnimation) => void;
    ensurePlayerSyncSession: (ws: WebSocket) => PlayerSyncSession;
    getOrCreateNpcSyncSession: (ws: WebSocket) => NpcSyncSession;
    maybeReplayDynamicLocState: (sock: WebSocket, player: PlayerState) => void;
    maybeSendGroundItemSnapshot: (sock: WebSocket, player: PlayerState) => void;

    /** The current active frame reference (mutable, set externally). */
    getActiveFrame: () => TickFrame | undefined;

    /** Magic attack handling for combat phase */
    spellActionHandler: SpellActionHandler;
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
    constructor(private readonly deps: TickPhaseServiceDeps) {}

    broadcastTick(_frame: TickFrame): void {
        // broadcastTick is handled separately by the BroadcastScheduler in wsServer.
        // This method exists to satisfy the interface; the orchestrator wires it to
        // the scheduler's broadcastTick call directly.
    }

    runPreMovementPhase(frame: TickFrame): void {
        const { npcManager, players, followerManager, followerCombatManager, npcSyncManager } =
            this.deps;

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
                        npcSyncManager.updateNpcViewForPlayer(player);
                    });
                }
            } catch (err) {
                logger.warn("[NpcManager] tick error", err);
            }
        }
        if (!players) return;
        this.flushPendingWalkCommands(frame.tick, "pre");
        this.deps.movementSystem?.runPreMovement(frame.tick);
    }

    runMovementPhase(frame: TickFrame): void {
        const { players, npcManager } = this.deps;
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
                    this.deps.withDirectSendBypass("destination_correction_repath", () =>
                        this.deps.sendWithGuard(
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
                        this.deps.queueDirectSend(
                            sock,
                            encodeMessage({
                                type: "path",
                                payload: {
                                    id: -2000 - player.id,
                                    ok: true,
                                    waypoints: Array.isArray(steps)
                                        ? steps.map((t) => ({ x: t.x, y: t.y }))
                                        : [],
                                    message,
                                },
                            }),
                            "walk_path_debug_repath",
                        );
                    } catch (err) { logger.warn("Failed to send walk path debug repath", err); }
                }
            } catch (err) { logger.warn("Failed to process player movement phase", err); }

            const statusHits = this.deps.statusEffects.processPlayer(player, frame.tick);
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
            const prayerTick = this.deps.prayerSystem.processPlayer(player);
            if (prayerTick?.prayerDepleted) {
                this.deps.combatEffectService.handlePrayerDepleted(player);
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
            const summary = this.deps.movementService.summarizeSteps(player, steps);
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

            this.deps.movementService.updateRunEnergy(
                player,
                { ran: summary.ran, moved, runSteps: summary.runSteps },
                frame.tick,
            );

            if (player.energy.hasRunEnergyUpdate()) {
                this.deps.movementService.queueRunEnergySnapshot(player);
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
                    this.deps.queueWidgetEvent(player.id, {
                        action: "open_sub",
                        targetUid: PVP_ICONS_CONTAINER_UID,
                        groupId: PVP_INTERFACE_ID,
                        type: 1,
                    });
                    this.deps.variableService.queueVarbit(player.id, VARBIT_IN_WILDERNESS, 1);
                } else if (currentWildyLevel === 0 && previousWildyLevel > 0) {
                    this.deps.queueWidgetEvent(player.id, {
                        action: "close_sub",
                        targetUid: PVP_ICONS_CONTAINER_UID,
                    });
                    this.deps.variableService.queueVarbit(player.id, VARBIT_IN_WILDERNESS, 0);
                }

                if (currentWildyLevel > 0) {
                    this.deps.queueClientScript(player.id, 388, WILDERNESS_LEVEL_WIDGET_UID);
                }
            }

            const currentInMulti = multiCombatSystem.isMultiCombat(tileX, tileY, player.level);
            const previousInMulti = player.combat.lastInMultiCombat ?? false;

            if (currentInMulti !== previousInMulti) {
                player.combat.lastInMultiCombat = currentInMulti;
                this.deps.variableService.queueVarbit(player.id, VARBIT_MULTICOMBAT_AREA, currentInMulti ? 1 : 0);
            }

            const currentInPvP = isInPvPArea(tileX, tileY, player.level);
            const previousInPvP = player.combat.lastInPvPArea ?? false;

            if (currentInPvP !== previousInPvP) {
                player.combat.lastInPvPArea = currentInPvP;
                this.deps.variableService.queueVarbit(player.id, VARBIT_PVP_SPEC_ORB, currentInPvP ? 1 : 0);
            }

            const currentInRaid = isInRaid(tileX, tileY, player.level);
            const previousInRaid = player.combat.lastInRaid ?? false;

            if (currentInRaid !== previousInRaid) {
                player.combat.lastInRaid = currentInRaid;
                this.deps.variableService.queueVarbit(player.id, VARBIT_IN_RAID, currentInRaid ? 1 : 0);
                if (!currentInRaid) {
                    this.deps.variableService.queueVarbit(player.id, VARBIT_RAID_STATE, 0);
                }
            }

            const currentInLMS = isInLMS(tileX, tileY, player.level);
            const previousInLMS = player.combat.lastInLMS ?? false;

            if (currentInLMS !== previousInLMS) {
                player.combat.lastInLMS = currentInLMS;
                this.deps.variableService.queueVarbit(player.id, VARBIT_IN_LMS, currentInLMS ? 1 : 0);
            }

            player.skillSystem.tickSkillRestoration(frame.tick);
            let specialUpdated = player.specEnergy.tick(frame.tick);
            if (!specialUpdated && player.specEnergy.hasUpdate?.()) {
                specialUpdated = true;
            }

            if (specialUpdated) {
                this.deps.queueCombatSnapshot(
                    player.id,
                    player.combat.weaponCategory,
                    player.combat.weaponItemId,
                    !!player.combat.autoRetaliate,
                    player.combat.styleSlot,
                    Array.from(player.prayer.activePrayers ?? []),
                    player.combat.spellId > 0 ? player.combat.spellId : undefined,
                );
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
                name: this.deps.appearanceService.getAppearanceDisplayName(player),
                appearance: player.appearance,
                interactionIndex: interactionIndex >= 0 ? interactionIndex : undefined,
                seq: summary.finalSeq,
                moved: moved || snap,
                turned,
                snap,
                directions: summary.directions.length > 0 ? summary.directions : undefined,
                traversals: summary.traversals.length > 0 ? summary.traversals : undefined,
                anim: this.deps.appearanceService.buildAnimPayload(player),
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
                this.deps.sendSkillsMessage(sock, player, skillUpdate);
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
            const summary = this.deps.movementService.summarizeSteps(bot, botSteps);
            const snap = bot.wasTeleported() ?? false;
            const moved = bot.didMove() ?? false;
            const turned = bot.didTurn() ?? false;
            try {
                this.deps.movementService.updateRunEnergy(
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
                name: this.deps.appearanceService.getAppearanceDisplayName(bot),
                appearance: bot.appearance,
                seq: summary.finalSeq,
                moved: moved || snap,
                turned,
                snap,
                directions: summary.directions.length > 0 ? summary.directions : undefined,
                traversals: summary.traversals.length > 0 ? summary.traversals : undefined,
                anim: this.deps.appearanceService.buildAnimPayload(bot),
                shouldSendPos: false,
            });
            if (snap) {
                try {
                    bot.clearTeleportFlag();
                } catch (err) { logger.warn("Failed to clear bot teleport flag", err); }
            }
        });
        try {
            this.deps.movementSystem?.runPostMovement(frame.tick);
        } catch (err) { logger.warn("Failed to run post-movement phase", err); }
    }

    runCombatPhase(frame: TickFrame): void {
        const { players, playerCombatManager, npcManager } = this.deps;
        if (!players || !playerCombatManager) return;
        const combatResult = playerCombatManager.processTick({
            tick: frame.tick,
            npcLookup: (npcId) => npcManager?.getById(npcId),
            pathService: this.deps.pathService,
            pickAttackSpeed: (player) => this.deps.playerCombatService.pickAttackSpeed(player),
            pickNpcHitDelay: (npc, player, attackSpeed) =>
                this.deps.combatEffectService.pickNpcHitDelay(npc, player, attackSpeed),
            getWeaponSpecialCostPercent: (weaponItemId) =>
                this.deps.combatDataService.getWeaponSpecialCostPercent(weaponItemId),
            getAttackReach: (player) => this.deps.playerCombatService.getPlayerAttackReach(player),
            queueSpotAnimation: (event) => {
                this.deps.enqueueSpotAnimation(event);
            },
            onMagicAttack: ({ player, npc, plan, tick }) =>
                this.deps.spellActionHandler.handleAutocastMagicAttack({
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
        this.deps.scriptRuntime.queueTick(frame.tick);
        this.deps.scriptScheduler.process(frame.tick);
    }

    runDeathPhase(_frame: TickFrame): void {
        if (this.deps.playerDeathService) {
            this.deps.playerDeathService.tick();
        }
    }

    runPostScriptPhase(frame: TickFrame): void {
        this.deps.scriptScheduler.process(frame.tick);
    }

    runPostEffectsPhase(frame: TickFrame): void {
        if (this.deps.gatheringSystem) {
            this.deps.gatheringSystem.processTick(frame.tick);
        }
        this.deps.groundItems.tick(frame.tick);
        if (frame.actionEffects.length > 0) {
            this.deps.effectDispatcher.dispatchActionEffects(frame.actionEffects, frame);
        }
        if (this.deps.players) {
            const nowMs = Date.now();
            this.deps.players.forEach((_, player) => {
                this.deps.accountSummary.syncPlayer(player, nowMs);
                this.deps.gamemode.onPlayerTick?.(player, nowMs);
                this.deps.reportGameTime.syncPlayer(player, nowMs);
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
                this.deps.varpSyncService.syncCombatTargetPlayerVarp(player);
                player.combat.attackDelay = this.deps.playerCombatService.pickAttackSpeed(player);
            });
            this.deps.players.forEachBot((bot) => {
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
        this.deps.tradeManager?.tick(frame.tick);
    }

    runOrphanedPlayersPhase(frame: TickFrame): void {
        const { players } = this.deps;
        if (!players) return;

        players.processOrphanedPlayers(frame.tick, (player, saveKey) => {
            try {
                this.deps.playerPersistence.saveSnapshot(saveKey, player);
                logger.info(`[orphan] Saved and removed expired orphan: ${saveKey}`);
            } catch (err) {
                logger.warn(`[orphan] Failed to save expired orphan ${saveKey}:`, err);
            }
            this.deps.followerCombatManager?.resetPlayer(player.id);
            this.deps.followerManager?.despawnFollowerForPlayer(player.id, false);
            this.deps.actionScheduler.unregisterPlayer(player.id);
        });
    }

    runBroadcastPhase(frame: TickFrame): void {
        this.deps.scriptScheduler.process(frame.tick);
        this.deps.networkLayer.setBroadcastPhase(true);
        try {
            const ctx = this.buildBroadcastContext();
            if (this.deps.pendingDirectSends.size > 0) {
                const entries = Array.from(this.deps.pendingDirectSends.entries());
                this.deps.pendingDirectSends.clear();
                for (const [ws, entry] of entries) {
                    try {
                        this.deps.sendWithGuard(ws, entry.message, entry.context);
                    } catch (err) { logger.warn("Failed to flush pending direct send", err); }
                }
            }
            this.deps.miscBroadcaster.flushLocChanges(frame, ctx);
            this.deps.skillBroadcaster.flush(frame, ctx);
            this.deps.combatBroadcaster.flush(frame, ctx);
            this.deps.actorSyncBroadcaster.flush(frame, ctx);
            this.deps.widgetBroadcaster.flushCloseEvents(frame, ctx);
            this.deps.varBroadcaster.flush(frame, ctx);
            this.deps.widgetBroadcaster.flushOpenEvents(frame, ctx);
            this.deps.miscBroadcaster.flushPostWidgetEvents(frame, ctx);
            this.deps.chatBroadcaster.flush(frame, ctx);
            this.deps.inventoryBroadcaster.flush(frame, ctx);
            this.flushPerPlayerDirtyState(frame);
            this.flushAnimSnapshots(frame, ctx);
        } finally {
            this.deps.networkLayer.flushAllMessageBatches();
            this.deps.networkLayer.setBroadcastPhase(false);
            this.deps.networkLayer.flushDirectSendWarnings("broadcast");
        }
    }

    runMusicPhase(_frame: TickFrame): void {
        this.deps.soundManager.runMusicPhase(_frame);
    }

    checkAndSendSnapshots(player: PlayerState, sock?: WebSocket): void {
        if (this.deps.getActiveFrame()) {
            return;
        }

        const ws = sock ?? this.deps.players?.getSocketByPlayerId(player.id);
        if (!ws || ws.readyState !== 1 /* WebSocket.OPEN */) return;

        if (player.hasInventoryUpdate()) {
            const snapshot = player.takeInventorySnapshot();
            if (snapshot) {
                this.deps.inventoryService.sendInventorySnapshotImmediate(ws, player);
            }
        }
        if (player.hasAppearanceUpdate()) {
            // Let the dirty flag remain for tick-based player sync.
        }
        if (player.hasCombatStateUpdate()) {
            player.takeCombatStateSnapshot();
            this.deps.sendCombatState(ws, player);
        }
    }

    // --- Private helpers ---

    private scheduleNpcAggressionAttack(
        npcId: number,
        targetPlayerId: number,
        currentTick: number,
    ): void {
        const player = this.deps.players?.getById(targetPlayerId);
        if (!player) return;

        const npc = this.deps.npcManager?.getById(npcId);
        if (!npc || npc.isDead?.(currentTick)) return;

        const result = this.deps.actionScheduler.requestAction(
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
        this.deps.movementService.flushPendingWalkCommands(currentTick, stage);
    }

    private refreshInteractionFacing(frame: TickFrame): void {
        const { players, npcManager } = this.deps;
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
        for (const callback of this.deps.gamemodeTickCallbacks) {
            try {
                callback(frame.tick);
            } catch (err) {
                logger.warn("[gamemode-tick] Tick callback error", err);
            }
        }
    }

    private buildBroadcastContext(): BroadcastContext {
        const tickMs = Math.max(1, this.deps.tickMs);
        return {
            sendWithGuard: (sock, msg, context) => this.deps.sendWithGuard(sock, msg, context),
            broadcast: (msg, context) => this.deps.broadcast(msg, context),
            getSocketByPlayerId: (id) => this.deps.players?.getSocketByPlayerId(id),
            cyclesPerTick: Math.max(1, Math.round(tickMs / 20)),
        };
    }

    private flushPerPlayerDirtyState(frame: TickFrame): void {
        const { players } = this.deps;
        if (!players) return;
        players.forEach((_, player) => {
            player.clearTeleportFlag();
        });
        players.forEachBot((bot) => {
            bot.clearTeleportFlag();
        });
        players.forEach((sock, player) => {
            this.deps.maybeReplayDynamicLocState(sock, player);
        });
        players.forEach((sock, player) => {
            this.deps.maybeSendGroundItemSnapshot(sock, player);
        });
        players.forEach((sock, player) => {
            if (player.hasInventoryUpdate()) {
                const snapshot = player.takeInventorySnapshot();
                if (snapshot) {
                    const inv = this.deps.inventoryService.getInventory(player);
                    const slots = inv.map((entry, idx) => ({
                        slot: idx,
                        itemId: entry.itemId,
                        quantity: entry.quantity,
                    }));
                    this.deps.sendWithGuard(
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
                this.deps.playerAppearanceManager.queueAppearanceSnapshot(player);
                this.deps.appearanceService.queueAnimSnapshot(player.id, this.deps.appearanceService.buildAnimPayload(player));
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
                this.deps.sendWithGuard(
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
                this.deps.interfaceManager.isWidgetGroupOpenInLedger(player.id, EQUIPMENT_STATS_GROUP_ID)
            ) {
                this.deps.equipmentStatsUiService.queueEquipmentStatsWidgetTexts(player);
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
        const session = this.deps.ensurePlayerSyncSession(sock);
        const playerFrame: PlayerTickFrameData = {
            tick: frame.tick,
            tickMs: this.deps.tickMs,
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
        const packet = this.deps.playerPacketEncoder.buildPlayerSyncPacket(
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

        if (this.deps.enableBinaryNpcSync && this.deps.npcManager) {
            try {
                const npcSession = this.deps.getOrCreateNpcSyncSession(sock);
                const npcFrame = {
                    tick: frame.tick,
                    tickMs: this.deps.tickMs,
                    npcUpdates: frame.npcUpdates,
                    hitsplats: frame.hitsplats,
                    npcEffectEvents: frame.npcEffectEvents,
                    spotAnimations: frame.spotAnimations,
                    colorOverrides: frame.npcColorOverrides,
                };
                const built = this.deps.npcPacketEncoder.buildNpcSyncPacket(
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
        if (this.deps.worldEntityInfoEncoder.needsUpdate(player.id)) {
            const wePacket = this.deps.worldEntityInfoEncoder.encode(player.id);
            if (wePacket) {
                ctx.sendWithGuard(sock, wePacket, "worldentity_info");
            }
        }
    }
}
