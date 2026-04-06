import { logger } from "../../utils/logger";
import { faceAngleRs } from "../../../../src/rs/utils/rotation";
import type { SkillId } from "../../../../src/rs/skill/skills";
import type { PrayerName } from "../../../../src/rs/prayer/prayers";
import { STUN_TIMER } from "../model/timer/Timers";
import type { ScriptServices, ScriptDialogRequest, ScriptDialogOptionRequest } from "../scripts/types";
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
    getPathService: () => any;
    doorManager: any;
    npcManager: any;
    interfaceService: any;
    widgetDialogHandler: any;
    prayerSystem: any;
    gatheringSystem: any;
    cs2ModalManager: any;
    followerManager: any;
    followerCombatManager: any;
    sailingInstanceManager: any;
    worldEntityInfoEncoder: any;
    playerPersistence: any;
    musicCatalogService: any;
    inventoryActionHandler: any;
    effectDispatcher: any;
    combatEffectApplicator: any;
    getPlayers: () => any;
    enqueueSpotAnimation: (anim: any) => void;
    enqueueForcedMovement: (data: any) => void;
    enqueueSoundBroadcast: (soundId: number, x: number, y: number, level: number) => void;
    queueCombatSnapshot: (...args: any[]) => void;
    queueWidgetEvent: (playerId: number, event: any) => void;
    queueSmithingInterfaceMessage: (playerId: number, payload: any) => void;
    queueExternalNpcTeleportSync: (npc: any) => void;
    teleportToWorldEntity: (...args: any[]) => void;
    sendWorldEntity: (...args: any[]) => void;
    completeLogout: (sock: any, player: any, reason?: string) => void;
    closeInterruptibleInterfaces: (player: PlayerState) => void;
    activeFrame: () => any;
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

    return {
        // --- DataLoaderServices ---
        getDbRepository: () => deps.dataLoaders.getDbRepository(),
        getEnumTypeLoader: () => deps.dataLoaders.getEnumTypeLoader(),
        getStructTypeLoader: () => deps.dataLoaders.getStructTypeLoader(),
        getIdkTypeLoader: () => deps.dataLoaders.getIdkTypeLoader(),
        getObjType: (id) => deps.dataLoaders.getObjType(id),
        getLocTypeLoader: () => deps.dataLoaders.getLocTypeLoader(),
        getNpcTypeLoader: () => deps.dataLoaders.getNpcTypeLoader(),
        getLocDefinition: (id) => deps.dataLoaders.getLocDefinition(id),

        // --- LocationServices ---
        doorManager: deps.doorManager,
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
        hasInventorySlot: (player) => player.getFreeSlotCount() > 0,
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
            const skill = player.getSkill(skillId);
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
        openDialog: (player, request) => deps.widgetDialogHandler.openDialog(player, request as any),
        openDialogOptions: (player, options) => deps.widgetDialogHandler.openDialogOptions(player, options as any),
        closeDialog: (player, dialogId) => deps.widgetDialogHandler.closeDialog(player, dialogId),
        closeInterruptibleInterfaces: (player) => deps.closeInterruptibleInterfaces(player),
        getInterfaceService: () => deps.interfaceService,
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

        // --- NpcServices ---
        spawnNpc: (config) => deps.npcManager?.spawnTransientNpc(config),
        removeNpc: (npcId) => deps.npcManager?.removeNpc(npcId) ?? false,
        queueNpcForcedChat: (npc, text) => { npc.pendingSay = text; },
        queueNpcSeq: (npc, seqId) => { npc.queueOneShotSeq(seqId); },
        faceNpcToPlayer: (npc, player) => { npc.faceTile(player.tileX, player.tileY); },

        // --- GatheringServices ---
        gathering: deps.gatheringSystem,
        isAdjacentToLoc: (player, locId, tile, level) =>
            deps.locationService.isAdjacentToTile(player, tile),
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
}
