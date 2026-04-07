import { logger } from "../../utils/logger";
import { faceAngleRs } from "../../../../src/rs/utils/rotation";
import type { SkillId } from "../../../../src/rs/skill/skills";
import type { PrayerName } from "../../../../src/rs/prayer/prayers";
import { STUN_TIMER } from "../model/timer/Timers";
import { resolveLocTransformId } from "../../world/LocTransforms";
import { triggerLocEffect } from "../scripts/utils/locEffects";
import { RuneValidator } from "../spells/RuneValidator";
import {
    FOLLOWER_ITEM_DEFINITIONS,
    getFollowerDefinitionByItemId,
    getFollowerDefinitionByNpcTypeId,
} from "../followers/followerDefinitions";
import type { ScriptServices, ScriptDialogRequest, ScriptDialogOptionRequest } from "../scripts/types";
import { getMainmodalUid, getSidemodalUid, getPrayerTabUid, getViewportTrackerFrontUid } from "../../widgets/viewport";
import { getDefaultInterfaces } from "../../widgets/WidgetManager";
import type { DataLoaderService } from "./DataLoaderService";
import type { VariableService } from "./VariableService";
import type { MessagingService } from "./MessagingService";
import type { SkillService } from "./SkillService";
import type { InventoryService } from "./InventoryService";
import type { EquipmentService } from "./EquipmentService";
import type { AppearanceService } from "./AppearanceService";
import type { LocationService } from "./LocationService";
import type { MovementService } from "./MovementService";
import type { CollectionLogService } from "./CollectionLogService";
import type { SoundService } from "./SoundService";
import type { PlayerState } from "../player";
import type { NpcState } from "../npc";
import type { ActionScheduler } from "../actions";
import type { PathService } from "../../pathfinding/PathService";
import type { DoorStateManager } from "../../world/DoorStateManager";
import type { NpcManager } from "../npcManager";
import type { InterfaceService } from "../../widgets/InterfaceService";
import type { WidgetDialogHandler } from "../actions/handlers/WidgetDialogHandler";
import type { PrayerSystem } from "../prayer/PrayerSystem";
import type { GatheringSystemManager } from "../systems/GatheringSystemManager";
import type { Cs2ModalManager } from "../../network/managers/Cs2ModalManager";
import type { FollowerManager } from "../followers/FollowerManager";
import type { FollowerCombatManager } from "../followers/FollowerCombatManager";
import type { SailingInstanceManager } from "../sailing/SailingInstanceManager";
import type { WorldEntityInfoEncoder } from "../../network/encoding/WorldEntityInfoEncoder";
import type { PersistenceProvider } from "../state/PersistenceProvider";
import type { MusicCatalogService } from "../../audio/MusicCatalogService";
import type { InventoryActionHandler } from "../actions/handlers/InventoryActionHandler";
import type { EffectDispatcher } from "../actions/handlers/EffectDispatcher";
import type { CombatEffectApplicator } from "../combat/CombatEffectApplicator";
import type { DamageTracker } from "../combat/DamageTracker";
import type { MultiCombatSystem } from "../combat/MultiCombatZones";
import { applyAutocastState, clearAutocastState } from "../combat/AutocastState";
import { getEmoteSeq } from "../emotes";
import { getSkillcapeSeqId, getSkillcapeSpotId } from "../equipment";
import { getItemDefinition, loadItemDefinitions } from "../../data/items";
import type { PlayerManager } from "../PlayerManager";
import type { PendingSpotAnimation, ForcedMovementBroadcast } from "../systems/BroadcastScheduler";
import type { TickFrame } from "../tick/TickPhaseOrchestrator";
import type { WidgetAction } from "../../widgets/WidgetManager";
import type { GameEventBus } from "../events/GameEventBus";
import type { WebSocket } from "ws";

/**
 * Dependencies injected from WSServer that are not yet in extracted services.
 * These will shrink as more systems are extracted.
 */
export interface ScriptServiceAdapterDeps {
    dataLoaders: DataLoaderService;
    variableService: VariableService;
    messagingService: MessagingService;
    skillService: SkillService;
    inventoryService: InventoryService;
    equipmentService: EquipmentService;
    appearanceService: AppearanceService;
    locationService: LocationService;
    movementService: MovementService;
    collectionLogService: CollectionLogService;
    soundService: SoundService;
    actionScheduler: ActionScheduler;
    // Not-yet-extracted deps (still on WSServer)
    getCurrentTick: () => number;
    getPathService: () => PathService;
    doorManager: DoorStateManager;
    npcManager: NpcManager;
    interfaceService: InterfaceService;
    widgetDialogHandler: WidgetDialogHandler;
    prayerSystem: PrayerSystem;
    gatheringSystem: GatheringSystemManager;
    cs2ModalManager: Cs2ModalManager;
    followerManager: FollowerManager;
    followerCombatManager: FollowerCombatManager;
    sailingInstanceManager: SailingInstanceManager;
    worldEntityInfoEncoder: WorldEntityInfoEncoder;
    playerPersistence: PersistenceProvider;
    musicCatalogService: MusicCatalogService | undefined;
    inventoryActionHandler: InventoryActionHandler;
    effectDispatcher: EffectDispatcher;
    combatEffectApplicator: CombatEffectApplicator;
    damageTracker: DamageTracker;
    multiCombatSystem: MultiCombatSystem;
    getPlayers: () => PlayerManager | undefined;
    enqueueSpotAnimation: (anim: PendingSpotAnimation) => void;
    enqueueForcedMovement: (data: ForcedMovementBroadcast) => void;
    enqueueSoundBroadcast: (soundId: number, x: number, y: number, level: number) => void;
    queueCombatSnapshot: (playerId: number, weaponCategory: number, weaponItemId: number, autoRetaliate: boolean, activeStyle?: number, activePrayers?: string[], activeSpellId?: number) => void;
    queueWidgetEvent: (playerId: number, event: WidgetAction) => void;
    queueSmithingInterfaceMessage: (playerId: number, payload: Record<string, unknown>) => void;
    queueExternalNpcTeleportSync: (npc: NpcState) => void;
    teleportToWorldEntity: (player: PlayerState, x: number, y: number, level: number, entityIndex: number, configId: number, sizeX: number, sizeZ: number, templateChunks: number[][][], buildAreas: import("../../../../src/shared/worldentity/WorldEntityTypes").WorldEntityBuildArea[], extraLocs?: Array<{ id: number; x: number; y: number; level: number; shape: number; rotation: number }>) => void;
    sendWorldEntity: (player: PlayerState, entityIndex: number, configId: number, sizeX: number, sizeZ: number, templateChunks: number[][][], buildAreas: import("../../../../src/shared/worldentity/WorldEntityTypes").WorldEntityBuildArea[], extraLocs?: Array<{ id: number; x: number; y: number; level: number; shape: number; rotation: number }>, extraNpcs?: Array<{ id: number; x: number; y: number; level: number }>, drawMode?: number) => void;
    completeLogout: (sock: WebSocket, player: PlayerState, reason?: string) => void;
    closeInterruptibleInterfaces: (player: PlayerState) => void;
    activeFrame: () => TickFrame | undefined;
    gamemode?: { onItemCraft?: (playerId: number, itemId: number, count: number) => void };
    eventBus?: GameEventBus;
}

/**
 * Adapts the extracted service classes into the ScriptServices interface
 * consumed by scripts and gamemodes. Replaces the 559-line buildScriptServiceObject
 * anonymous object from WSServer.
 */
export function buildScriptServices(deps: ScriptServiceAdapterDeps): ScriptServices {
    const snapshotInventoryFn = (player: PlayerState): void => {
        deps.inventoryService.snapshotInventory(player);
    };

    const services: ScriptServices = {
        // --- DataLoaderServices ---
        getDbRepository: () => deps.dataLoaders.getDbRepository(),
        getEnumTypeLoader: () => deps.dataLoaders.getEnumTypeLoader(),
        getStructTypeLoader: () => deps.dataLoaders.getStructTypeLoader(),
        getIdkTypeLoader: () => deps.dataLoaders.getIdkTypeLoader(),
        getObjType: (id) => deps.dataLoaders.getObjType(id),
        getLocTypeLoader: () => deps.dataLoaders.getLocTypeLoader(),
        getNpcTypeLoader: () => deps.dataLoaders.getNpcTypeLoader(),
        getLocDefinition: (id) => deps.dataLoaders.getLocDefinition(id),
        getItemDefinition: (itemId) => getItemDefinition(itemId),
        loadItemDefinitions: () => loadItemDefinitions(),

        // --- LocationServices ---
        doorManager: deps.doorManager,
        resolveLocTransformId: (player, locDef) => resolveLocTransformId(player as any, locDef as any),
        emitLocChange: (oldId, newId, tile, level, opts) =>
            deps.locationService.emitLocChange(oldId, newId, tile, level, opts),
        sendLocChangeToPlayer: (player, oldId, newId, tile, level) =>
            deps.locationService.sendLocChangeToPlayer(player, oldId, newId, tile, level),
        spawnLocForPlayer: (player, locId, tile, level, shape, rotation) =>
            deps.locationService.spawnLocForPlayer(player, locId, tile, level, shape, rotation),

        // --- InventoryServices ---
        consumeItem: (player, slotIndex) => deps.inventoryService.consumeItem(player, slotIndex),
        getInventoryItems: (player) =>
            deps.inventoryService.getInventory(player).map((entry, idx) => ({
                slot: idx,
                itemId: entry ? entry.itemId : -1,
                quantity: entry ? entry.quantity : 0,
            })),
        setInventorySlot: (player, slotIndex, itemId, qty) =>
            deps.inventoryService.setInventorySlot(player, slotIndex, itemId, qty),
        addItemToInventory: (player, itemId, qty) =>
            deps.inventoryService.addItemToInventory(player, itemId, qty),
        snapshotInventory: snapshotInventoryFn,
        snapshotInventoryImmediate: snapshotInventoryFn,
        findOwnedItemLocation: (player, itemId) =>
            deps.inventoryService.findOwnedItemLocation(player, itemId),
        findInventorySlotWithItem: (player, itemId) =>
            deps.inventoryService.findInventorySlotWithItem(player, itemId),
        canStoreItem: (player, itemId) => deps.inventoryService.canStoreItem(player, itemId),
        playerHasItem: (player, itemId) => deps.inventoryService.playerHasItem(player, itemId),
        hasInventorySlot: (player) => player.items.getFreeSlotCount() > 0,
        collectCarriedItemIds: (player) => deps.inventoryService.collectCarriedItemIds(player),

        // --- EquipmentServices ---
        getEquippedItem: (player, slot) => {
            try {
                const equip = deps.equipmentService.ensureEquipArray(player);
                return equip[slot] ?? -1;
            } catch (err) { logger.warn("Failed to get equipped item", err); return -1; }
        },
        getEquipArray: (player) => deps.equipmentService.ensureEquipArray(player),
        unequipItem: (player, slot) => {
            try {
                const slotIndex = Math.max(0, Math.min(13, slot));
                const equip = deps.equipmentService.ensureEquipArray(player);
                if (!(equip[slotIndex] > 0)) return false;
                const result = deps.inventoryActionHandler.executeInventoryUnequipAction(player, { slot: slotIndex, playSound: true });
                if (result.ok && result.effects) deps.effectDispatcher.dispatchActionEffects(result.effects);
                return result.ok;
            } catch (err) { logger.warn("Failed to unequip item", err); return false; }
        },

        // --- SkillServices ---
        addSkillXp: (player, skillId, xp) => {
            try { deps.skillService.awardSkillXp(player, skillId as SkillId, Number.isFinite(xp) ? xp : 0); } catch (err) { logger.warn("Failed to award skill XP", err); }
        },
        getSkill: (player, skillId) => {
            const skill = player.skillSystem.getSkill(skillId);
            return { baseLevel: skill.baseLevel, boost: skill.boost, xp: skill.xp };
        },

        // --- MessagingServices ---
        sendGameMessage: (player, text) => deps.messagingService.sendGameMessageToPlayer(player, text),
        queueNotification: (playerId, payload) => deps.messagingService.queueNotification(playerId, payload),

        // --- VariableServices ---
        sendVarp: (player, varpId, value) => deps.variableService.queueVarp(player.id, varpId, value),
        sendVarbit: (player, varbitId, value) => deps.variableService.queueVarbit(player.id, varbitId, value),
        queueVarp: (playerId, varpId, value) => deps.variableService.queueVarp(playerId, varpId, value),
        queueVarbit: (playerId, varbitId, value) => deps.variableService.queueVarbit(playerId, varbitId, value),

        // --- AnimationServices ---
        playPlayerSeq: (player, seqId, delay = 0) => { try { player.queueOneShotSeq(seqId, delay); } catch (err) { logger.warn("Failed to play player sequence", err); } },
        playPlayerSeqImmediate: (player, seqId) => { try { player.queueOneShotSeq(seqId, 0); } catch (err) { logger.warn("Failed to play immediate player sequence", err); } },
        broadcastPlayerSpot: (player, spotId, height = 0, delay = 0, slotArg?) => {
            try {
                const slot = slotArg !== undefined && Number.isFinite(slotArg) ? slotArg & 0xff : undefined;
                deps.enqueueSpotAnimation({ tick: deps.getCurrentTick(), playerId: player.id, spotId, height, delay, slot });
            } catch (err) { logger.warn("Failed to broadcast player spot animation", err); }
        },
        playLocGraphic: (opts) => deps.soundService.playLocGraphic(opts),
        playLocSound: (opts) => deps.soundService.playLocSound(opts),
        playAreaSound: (opts) => deps.soundService.playAreaSound(opts),
        playSong: (player, trackId, trackName) => deps.soundService.sendSound(player, trackId),
        skipMusicTrack: (player) => false,
        getMusicTrackId: (trackName) => deps.soundService.getMusicTrackIdByName(trackName),
        getMusicTrackBySlot: (slot) => deps.musicCatalogService?.getBaseListTrackBySlot(slot),
        sendSound: (player, soundId, opts) => deps.soundService.sendSound(player, soundId, opts),
        enqueueSoundBroadcast: (soundId, x, y, level) => deps.enqueueSoundBroadcast(soundId, x, y, level),
        stopPlayerAnimation: (player) => { try { player.stopAnimation(); } catch (err) { logger.warn("Failed to stop player animation", err); } },
        getEmoteSeq: (index) => getEmoteSeq(index),
        getSkillcapeSeqId: (capeItemId) => getSkillcapeSeqId(capeItemId),
        getSkillcapeSpotId: (capeItemId) => getSkillcapeSpotId(capeItemId),

        // --- AppearanceServices ---
        refreshAppearanceKits: (player) => deps.appearanceService.refreshAppearanceKits(player),
        queueAppearanceSnapshot: (player) => deps.appearanceService.queueAppearanceSnapshot(player),
        savePlayerSnapshot: (player) => {
            try {
                const key = player.__saveKey;
                if (key && key.length > 0) deps.playerPersistence.saveSnapshot(key, player);
            } catch (err) { logger.warn("Failed to save player snapshot", err); }
        },
        logoutPlayer: (player, reason) => {
            try {
                const sock = deps.getPlayers()?.getSocketByPlayerId?.(player.id);
                if (sock) deps.completeLogout(sock, player, reason);
            } catch (err) { logger.warn("Failed to logout player", err); }
        },

        // --- DialogServices ---
        openDialog: (player, request) => deps.widgetDialogHandler.openDialog(player, request),
        openDialogOptions: (player, options) => deps.widgetDialogHandler.openDialogOptions(player, options),
        closeDialog: (player, dialogId) => deps.widgetDialogHandler.closeDialog(player, dialogId),
        closeInterruptibleInterfaces: (player) => deps.closeInterruptibleInterfaces(player),
        getInterfaceService: () => deps.interfaceService,
        openSubInterface: (player, targetUid, groupId, type = 0, opts) => {
            if (type === 0 || type === 1) {
                player.widgets.open(groupId, {
                    targetUid,
                    type,
                    modal: opts?.modal !== false,
                    varps: opts?.varps,
                    varbits: opts?.varbits,
                    preScripts: opts?.preScripts,
                    postScripts: opts?.postScripts,
                    hiddenUids: opts?.hiddenUids,
                });
                return;
            }
            deps.queueWidgetEvent(player.id, {
                action: "open_sub",
                targetUid,
                groupId,
                type,
                varps: opts?.varps,
                varbits: opts?.varbits,
                preScripts: opts?.preScripts,
                postScripts: opts?.postScripts,
                hiddenUids: opts?.hiddenUids,
            });
        },
        closeSubInterface: (player, targetUid, groupId) => {
            if (groupId !== undefined) {
                player.widgets.closeByTargetUid(targetUid, { groupId });
            } else {
                player.widgets.closeByTargetUid(targetUid);
            }
        },
        queueWidgetEvent: (playerId, event) => deps.queueWidgetEvent(playerId, event),
        queueClientScript: (playerId, scriptId, ...args) =>
            deps.variableService.queueVarp(playerId, 0, 0), // placeholder - use interfaceManager

        // --- MovementServices ---
        teleportPlayer: (player, x, y, level, forceRebuild) =>
            deps.movementService.teleportPlayer(player, x, y, level, forceRebuild),
        teleportToInstance: (player, x, y, level, templateChunks, extraLocs) =>
            deps.movementService.teleportToInstance(player, x, y, level, templateChunks, extraLocs),
        requestTeleportAction: (player, request) =>
            deps.movementService.requestTeleportAction(player, request),
        getPathService: () => deps.getPathService(),
        queueForcedMovement: (player, params) => {
            const currentTick = deps.getCurrentTick();
            const frame = deps.activeFrame();
            const deliveryTick = frame ? frame.tick : currentTick + 1;
            const requestedStartTick = params.startTick ?? deliveryTick;
            const durationTicks = Math.max(0, params.endTick - requestedStartTick);
            const normalizedStartTick = Math.max(deliveryTick, requestedStartTick);
            const normalizedEndTick = normalizedStartTick + durationTicks;
            const startX = (params.startTile.x << 7) + 64;
            const startY = (params.startTile.y << 7) + 64;
            const endX = (params.endTile.x << 7) + 64;
            const endY = (params.endTile.y << 7) + 64;
            deps.enqueueForcedMovement({
                targetId: player.id,
                startDeltaX: params.startTile.x - player.tileX,
                startDeltaY: params.startTile.y - player.tileY,
                endDeltaX: params.endTile.x - player.tileX,
                endDeltaY: params.endTile.y - player.tileY,
                startCycle: normalizedStartTick,
                endCycle: normalizedEndTick,
                direction: params.direction ?? faceAngleRs(startX, startY, endX, endY),
            });
        },

        // --- SystemServices ---
        getCurrentTick: () => deps.getCurrentTick(),
        eventBus: deps.eventBus,

        // --- CollectionLogServices ---
        sendCollectionLogSnapshot: (player) => deps.collectionLogService.sendCollectionLogSnapshot(player as PlayerState),
        openCollectionLog: (player) => deps.collectionLogService.openCollectionLog(player as PlayerState),
        openCollectionOverview: (player) => deps.collectionLogService.openCollectionOverview(player as PlayerState),
        populateCollectionLogCategories: (player, tabIndex) =>
            deps.collectionLogService.populateCollectionLogCategories(player as PlayerState, tabIndex),

        // --- CombatServices ---
        requestAction: (player, request, currentTick) => {
            try {
                const groups = Array.isArray(request?.groups) ? request.groups : [];
                if (groups.includes("skill.woodcut")) {
                    deps.actionScheduler.clearActionsInGroup(player.id, "skill.woodcut");
                }
            } catch (err) { logger.warn("Failed to clear action group before request", err); }
            return deps.actionScheduler.requestAction(
                player.id, request,
                Number.isFinite(currentTick) ? (currentTick as number) : deps.getCurrentTick(),
            );
        },
        getNpc: (id) => deps.npcManager?.getById(id) ?? undefined,
        isPlayerStunned: (player) => player.timers.has(STUN_TIMER),
        isPlayerInCombat: (player) => player.isBeingAttacked(),
        applyPlayerHitsplat: (player, style, damage, tick) =>
            deps.combatEffectApplicator.applyPlayerHitsplat(player, style, damage, tick),
        stunPlayer: (player, ticks) => { player.timers.set(STUN_TIMER, ticks); },
        clearPlayerFaceTarget: (player) => { try { player.clearInteraction(); } catch (err) { logger.warn("Failed to clear player face target", err); } },
        scheduleAction: (playerId, request, tick) =>
            deps.actionScheduler.requestAction(playerId, request, tick),
        getDropEligibility: (npc) => deps.damageTracker.getDropEligibility(npc),
        clearNpcDamageRecords: (npc) => deps.damageTracker.clearNpc(npc),
        getLastAttacker: (actor, currentTick) => deps.multiCombatSystem.getLastAttacker(actor, currentTick),
        isMultiCombat: (x, y, plane) => deps.multiCombatSystem.isMultiCombat(x, y, plane),
        applyAutocastState: (player, spellId, autocastIndex, isDefensive, callbacks) =>
            applyAutocastState(player, spellId, autocastIndex, isDefensive, callbacks),
        clearAutocastState: (player, callbacks) =>
            clearAutocastState(player, callbacks),
        validateRunes: (runeCosts, inventory, equippedItems) =>
            RuneValidator.validateAndCalculate(runeCosts, inventory, equippedItems),

        // --- NpcServices ---
        spawnNpc: (config) => deps.npcManager?.spawnTransientNpc(config),
        removeNpc: (npcId) => deps.npcManager?.removeNpc(npcId) ?? false,
        queueNpcForcedChat: (npc, text) => { npc.pendingSay = text; },
        queueNpcSeq: (npc, seqId) => { npc.queueOneShotSeq(seqId); },
        faceNpcToPlayer: (npc, player) => { npc.faceTile(player.tileX, player.tileY); },

        // --- GatheringServices ---
        gathering: deps.gatheringSystem,
        isAdjacentToLoc: (player, locId, tile, level) =>
            deps.locationService.isAdjacentToLoc(player, locId, tile, level),
        isAdjacentToNpc: (player, npc) => deps.locationService.isAdjacentToNpc(player, npc),
        faceGatheringTarget: (player, tile) => deps.locationService.faceGatheringTarget(player, tile),
        stopGatheringInteraction: (player) => {
            try { player.clearInteraction(); } catch (err) { logger.warn("Failed to clear interaction during gathering stop", err); }
            try { player.stopAnimation(); } catch (err) { logger.warn("Failed to stop animation during gathering stop", err); }
            try { player.clearPath(); } catch (err) { logger.warn("Failed to clear path during gathering stop", err); }
            try { player.clearWalkDestination(); } catch (err) { logger.warn("Failed to clear walk destination during gathering stop", err); }
        },
        getWoodcuttingTree: undefined,
        getMiningRock: undefined,
        getFishingSpot: undefined,
        isFiremakingTileBlocked: undefined,
        lightFire: undefined,
        playerHasTinderbox: undefined,
        consumeFiremakingLog: undefined,
        walkPlayerAwayFromFire: undefined,
        getCookingRecipeByRawItemId: undefined,

        // --- ProductionServices ---
        onItemCraft: (playerId, itemId, count) => {
            deps.gamemode?.onItemCraft?.(playerId, itemId, count);
            deps.eventBus?.emit("item:craft", { playerId, itemId, count });
        },
        production: {
            takeInventoryItems: (player, inputs) => deps.inventoryService.takeInventoryItems(player, inputs),
            restoreInventoryRemovals: (player, removed) => deps.inventoryService.restoreInventoryRemovals(player, removed),
            restoreInventoryItems: (player, itemId, removed) => deps.inventoryService.restoreInventoryItems(player, itemId, removed),
            queueSmithingMessage: (playerId, payload) => deps.queueSmithingInterfaceMessage(playerId, payload),
            openSmithingModal: (player, groupId, varbits) =>
                deps.interfaceService?.openModal(player, groupId, undefined, varbits ? { varbits } : undefined),
            closeSmithingModal: (player) => deps.interfaceService?.closeModal(player),
            isSmithingModalOpen: (player, groupId) => deps.interfaceService?.isModalOpen(player, groupId) ?? false,
            openSmithingBarModal: (player) => deps.cs2ModalManager.openSmithingBarModal(player),
            getBarTypeByItemId: (_itemId) => undefined,
        },

        // --- FollowerServices ---
        followers: {
            summonFollowerFromItem: (player, itemId, npcTypeId) => {
                const result = deps.followerManager?.summonFollowerFromItem(player, itemId, npcTypeId) ?? { ok: false as const, reason: "spawn_failed" };
                if (result.ok) deps.followerCombatManager?.resetPlayer(player.id);
                return result;
            },
            pickupFollower: (player, npcId) => {
                const result = deps.followerManager?.pickupFollower(player, npcId) ?? { ok: false as const, reason: "missing" };
                if (result.ok) deps.followerCombatManager?.resetPlayer(player.id);
                return result;
            },
            metamorphFollower: (player, npcId) => {
                const result = deps.followerManager?.metamorphFollower(player, npcId) ?? { ok: false as const, reason: "missing" };
                if (result.ok) deps.followerCombatManager?.resetPlayer(player.id);
                return result;
            },
            callFollower: (player) => {
                const result = deps.followerManager?.callFollower(player) ?? { ok: false as const, reason: "missing" };
                if (result.ok) {
                    deps.followerCombatManager?.resetPlayer(player.id);
                    const npc = deps.npcManager?.getById(result.npcId);
                    if (npc) deps.queueExternalNpcTeleportSync(npc);
                }
                return result;
            },
            despawnFollowerForPlayer: (playerId, clearPersistentState) => {
                deps.followerCombatManager?.resetPlayer(playerId);
                return deps.followerManager?.despawnFollowerForPlayer(playerId, clearPersistentState) ?? false;
            },
            getItemDefinitions: () => FOLLOWER_ITEM_DEFINITIONS,
            getDefinitionByItemId: (itemId) => getFollowerDefinitionByItemId(itemId),
            getDefinitionByNpcTypeId: (npcTypeId) => getFollowerDefinitionByNpcTypeId(npcTypeId),
        },

        // --- SailingServices ---
        sailing: {
            initSailingInstance: (player) => deps.sailingInstanceManager?.initInstance(player),
            disposeSailingInstance: (player) => deps.sailingInstanceManager?.disposeInstance(player),
            teleportToWorldEntity: (player, x, y, level, entityIndex, configId, sizeX, sizeZ, templateChunks, buildAreas, extraLocs) =>
                deps.teleportToWorldEntity(player, x, y, level, entityIndex, configId, sizeX, sizeZ, templateChunks, buildAreas, extraLocs),
            sendWorldEntity: (player, entityIndex, configId, sizeX, sizeZ, templateChunks, buildAreas, extraLocs, extraNpcs, drawMode) =>
                deps.sendWorldEntity(player, entityIndex, configId, sizeX, sizeZ, templateChunks, buildAreas, extraLocs, extraNpcs, drawMode),
            removeWorldEntity: (playerId, entityIndex) => deps.worldEntityInfoEncoder.removeEntity(playerId, entityIndex),
            queueWorldEntityPosition: (playerId, entityIndex, position) => deps.worldEntityInfoEncoder.queuePosition(playerId, entityIndex, position),
            setWorldEntityPosition: (playerId, entityIndex, position) => deps.worldEntityInfoEncoder.setPosition(playerId, entityIndex, position),
            queueWorldEntityMask: (playerId, entityIndex, mask) => deps.worldEntityInfoEncoder.queueMaskUpdate(playerId, entityIndex, mask),
            buildSailingDockedCollision: () => deps.sailingInstanceManager?.buildDockedCollision(),
        },

        // --- ViewportServices ---
        getMainmodalUid: (displayMode) => getMainmodalUid(displayMode),
        getSidemodalUid: (displayMode) => getSidemodalUid(displayMode),
        getPrayerTabUid: (displayMode) => getPrayerTabUid(displayMode),
        getViewportTrackerFrontUid: (displayMode) => getViewportTrackerFrontUid(displayMode),
        getDefaultInterfaces: (displayMode) => getDefaultInterfaces(displayMode),

        // --- Remaining tabs ---
        openRemainingTabs: (player) => {
            const { getRemainingTabInterfaces } = require("../../widgets/WidgetManager");
            const displayMode = player.displayMode ?? 1;
            const remainingInterfaces = getRemainingTabInterfaces(displayMode);
            for (const intf of remainingInterfaces) {
                player.widgets?.open(intf.groupId, {
                    targetUid: intf.targetUid, type: intf.type,
                    modal: false, postScripts: intf.postScripts,
                });
            }
        },
    } as ScriptServices;

    services.triggerLocEffect = (locId, tile, level) =>
        triggerLocEffect(services, locId, tile, level);

    // Grouped service facades
    services.messaging = {
        sendGameMessage: services.sendGameMessage,
        queueNotification: (playerId, payload) => deps.messagingService.queueNotification(playerId, payload),
    };
    services.variables = {
        sendVarp: (player, varpId, value) => deps.variableService.queueVarp(player.id, varpId, value),
        sendVarbit: (player, varbitId, value) => deps.variableService.queueVarbit(player.id, varbitId, value),
        queueVarp: (playerId, varpId, value) => deps.variableService.queueVarp(playerId, varpId, value),
        queueVarbit: (playerId, varbitId, value) => deps.variableService.queueVarbit(playerId, varbitId, value),
    };
    services.skills = {
        addSkillXp: services.addSkillXp!,
        getSkill: services.getSkill!,
    };
    services.data = {
        getDbRepository: services.getDbRepository!,
        getEnumTypeLoader: services.getEnumTypeLoader!,
        getStructTypeLoader: services.getStructTypeLoader!,
        getIdkTypeLoader: services.getIdkTypeLoader!,
        getObjType: services.getObjType!,
        getLocDefinition: services.getLocDefinition!,
        getLocTypeLoader: services.getLocTypeLoader!,
        getNpcTypeLoader: services.getNpcTypeLoader!,
        getItemDefinition: services.getItemDefinition!,
        loadItemDefinitions: services.loadItemDefinitions!,
    };
    services.system = {
        logger: logger as any,
        getCurrentTick: services.getCurrentTick!,
        eventBus: services.eventBus,
        gamemodeServices: services.gamemodeServices,
    };
    services.inventory = {
        consumeItem: services.consumeItem,
        getInventoryItems: services.getInventoryItems,
        addItemToInventory: services.addItemToInventory,
        setInventorySlot: services.setInventorySlot,
        snapshotInventory: services.snapshotInventory,
        snapshotInventoryImmediate: services.snapshotInventoryImmediate,
        findOwnedItemLocation: services.findOwnedItemLocation!,
        collectCarriedItemIds: services.collectCarriedItemIds!,
        findInventorySlotWithItem: services.findInventorySlotWithItem!,
        canStoreItem: services.canStoreItem!,
        playerHasItem: services.playerHasItem!,
        hasInventorySlot: services.hasInventorySlot!,
    };
    services.equipment = {
        getEquippedItem: services.getEquippedItem!,
        getEquipArray: services.getEquipArray!,
        unequipItem: services.unequipItem!,
    };
    services.animation = {
        playPlayerSeq: services.playPlayerSeq!,
        playPlayerSeqImmediate: services.playPlayerSeqImmediate!,
        broadcastPlayerSpot: services.broadcastPlayerSpot!,
        playLocGraphic: services.playLocGraphic!,
        stopPlayerAnimation: services.stopPlayerAnimation!,
        getEmoteSeq: services.getEmoteSeq!,
        getSkillcapeSeqId: services.getSkillcapeSeqId!,
        getSkillcapeSpotId: services.getSkillcapeSpotId!,
    };
    services.sound = {
        playLocSound: services.playLocSound!,
        playAreaSound: services.playAreaSound!,
        playSong: services.playSong!,
        skipMusicTrack: services.skipMusicTrack!,
        getMusicTrackId: services.getMusicTrackId!,
        getMusicTrackBySlot: services.getMusicTrackBySlot!,
        sendSound: services.sendSound!,
        enqueueSoundBroadcast: services.enqueueSoundBroadcast!,
    };
    services.appearance = {
        refreshAppearanceKits: services.refreshAppearanceKits!,
        queueAppearanceSnapshot: services.queueAppearanceSnapshot!,
        savePlayerSnapshot: services.savePlayerSnapshot!,
        logoutPlayer: services.logoutPlayer!,
    };
    services.dialog = {
        openDialog: services.openDialog!,
        openDialogOptions: services.openDialogOptions!,
        closeDialog: services.closeDialog!,
        closeInterruptibleInterfaces: services.closeInterruptibleInterfaces!,
        openSubInterface: services.openSubInterface!,
        closeSubInterface: services.closeSubInterface!,
        closeModal: (player) => deps.interfaceService?.closeModal(player),
        getInterfaceService: services.getInterfaceService!,
        openRemainingTabs: services.openRemainingTabs!,
        queueClientScript: services.queueClientScript!,
        queueWidgetEvent: services.queueWidgetEvent!,
    };
    services.movement = {
        teleportPlayer: services.teleportPlayer!,
        teleportToInstance: services.teleportToInstance!,
        requestTeleportAction: services.requestTeleportAction!,
        queueForcedMovement: services.queueForcedMovement!,
        getPathService: services.getPathService!,
    };
    services.location = {
        doorManager: services.doorManager,
        resolveLocTransformId: services.resolveLocTransformId!,
        emitLocChange: services.emitLocChange!,
        sendLocChangeToPlayer: services.sendLocChangeToPlayer!,
        spawnLocForPlayer: services.spawnLocForPlayer!,
        triggerLocEffect: services.triggerLocEffect!,
    };
    services.combat = {
        applyPrayers: services.applyPrayers!,
        setCombatSpell: services.setCombatSpell,
        queueCombatState: services.queueCombatState!,
        requestAction: services.requestAction,
        getNpc: services.getNpc!,
        isPlayerStunned: services.isPlayerStunned!,
        isPlayerInCombat: services.isPlayerInCombat!,
        applyPlayerHitsplat: services.applyPlayerHitsplat!,
        stunPlayer: services.stunPlayer!,
        scheduleAction: services.scheduleAction!,
        clearPlayerFaceTarget: services.clearPlayerFaceTarget!,
        getDropEligibility: services.getDropEligibility!,
        clearNpcDamageRecords: services.clearNpcDamageRecords!,
        getLastAttacker: services.getLastAttacker!,
        isMultiCombat: services.isMultiCombat!,
        applyAutocastState: services.applyAutocastState!,
        clearAutocastState: services.clearAutocastState!,
        validateRunes: services.validateRunes!,
    };
    services.npc = {
        spawnNpc: services.spawnNpc!,
        removeNpc: services.removeNpc!,
        queueNpcForcedChat: services.queueNpcForcedChat!,
        queueNpcSeq: services.queueNpcSeq!,
        faceNpcToPlayer: services.faceNpcToPlayer!,
    };
    services.collectionLog = {
        sendCollectionLogSnapshot: services.sendCollectionLogSnapshot!,
        openCollectionLog: services.openCollectionLog!,
        openCollectionOverview: services.openCollectionOverview!,
        populateCollectionLogCategories: services.populateCollectionLogCategories!,
    };
    services.viewport = {
        getMainmodalUid: services.getMainmodalUid!,
        getSidemodalUid: services.getSidemodalUid!,
        getPrayerTabUid: services.getPrayerTabUid!,
        getViewportTrackerFrontUid: services.getViewportTrackerFrontUid!,
        getDefaultInterfaces: services.getDefaultInterfaces!,
    };

    return services;
}
