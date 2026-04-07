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
        // Gamemode-contributed (flat, contributed dynamically via contributeScriptServices)
        gathering: deps.gatheringSystem,
        isAdjacentToLoc: (player, locId, tile, level) => deps.locationService.isAdjacentToLoc(player, locId, tile, level),
        isAdjacentToNpc: (player, npc) => deps.locationService.isAdjacentToNpc(player, npc),
        faceGatheringTarget: (player, tile) => deps.locationService.faceGatheringTarget(player, tile),
        stopGatheringInteraction: (player) => {
            try { player.clearInteraction(); } catch {}
            try { player.stopAnimation(); } catch {}
            try { player.clearPath(); } catch {}
            try { player.clearWalkDestination(); } catch {}
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

        // Grouped facades - constructed directly from deps
        messaging: {
            sendGameMessage: (player, text) => deps.messagingService.sendGameMessageToPlayer(player, text),
            queueNotification: (playerId, payload) => deps.messagingService.queueNotification(playerId, payload),
        },
        variables: {
            sendVarp: (player, varpId, value) => deps.variableService.queueVarp(player.id, varpId, value),
            sendVarbit: (player, varbitId, value) => deps.variableService.queueVarbit(player.id, varbitId, value),
            queueVarp: (playerId, varpId, value) => deps.variableService.queueVarp(playerId, varpId, value),
            queueVarbit: (playerId, varbitId, value) => deps.variableService.queueVarbit(playerId, varbitId, value),
        },
        skills: {
            addSkillXp: (player, skillId, xp) => {
                try { deps.skillService.awardSkillXp(player, skillId as SkillId, Number.isFinite(xp) ? xp : 0); } catch (err) { logger.warn("Failed to award skill XP", err); }
            },
            getSkill: (player, skillId) => {
                const skill = player.skillSystem.getSkill(skillId);
                return { baseLevel: skill.baseLevel, boost: skill.boost, xp: skill.xp };
            },
        },
        data: {
            getDbRepository: () => deps.dataLoaders.getDbRepository(),
            getEnumTypeLoader: () => deps.dataLoaders.getEnumTypeLoader(),
            getStructTypeLoader: () => deps.dataLoaders.getStructTypeLoader(),
            getIdkTypeLoader: () => deps.dataLoaders.getIdkTypeLoader(),
            getObjType: (id) => deps.dataLoaders.getObjType(id),
            getLocDefinition: (id) => deps.dataLoaders.getLocDefinition(id),
            getLocTypeLoader: () => deps.dataLoaders.getLocTypeLoader(),
            getNpcTypeLoader: () => deps.dataLoaders.getNpcTypeLoader(),
            getItemDefinition: (itemId) => getItemDefinition(itemId),
            loadItemDefinitions: () => loadItemDefinitions(),
        },
        system: {
            logger: logger as any,
            getCurrentTick: () => deps.getCurrentTick(),
            eventBus: deps.eventBus,
        },
        inventory: {
            consumeItem: (player, slotIndex) => deps.inventoryService.consumeItem(player, slotIndex),
            getInventoryItems: (player) =>
                deps.inventoryService.getInventory(player).map((entry, idx) => ({
                    slot: idx, itemId: entry ? entry.itemId : -1, quantity: entry ? entry.quantity : 0,
                })),
            addItemToInventory: (player, itemId, qty) => deps.inventoryService.addItemToInventory(player, itemId, qty),
            setInventorySlot: (player, slotIndex, itemId, qty) => deps.inventoryService.setInventorySlot(player, slotIndex, itemId, qty),
            snapshotInventory: snapshotInventoryFn,
            snapshotInventoryImmediate: snapshotInventoryFn,
            findOwnedItemLocation: (player, itemId) => deps.inventoryService.findOwnedItemLocation(player, itemId),
            collectCarriedItemIds: (player) => deps.inventoryService.collectCarriedItemIds(player),
            findInventorySlotWithItem: (player, itemId) => deps.inventoryService.findInventorySlotWithItem(player, itemId),
            canStoreItem: (player, itemId) => deps.inventoryService.canStoreItem(player, itemId),
            playerHasItem: (player, itemId) => deps.inventoryService.playerHasItem(player, itemId),
            hasInventorySlot: (player) => player.items.getFreeSlotCount() > 0,
        },
        equipment: {
            getEquippedItem: (player, slot) => {
                try { return deps.equipmentService.ensureEquipArray(player)[slot] ?? -1; }
                catch { return -1; }
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
                } catch { return false; }
            },
        },
        animation: {
            playPlayerSeq: (player, seqId, delay = 0) => { try { player.queueOneShotSeq(seqId, delay); } catch {} },
            playPlayerSeqImmediate: (player, seqId) => { try { player.queueOneShotSeq(seqId, 0); } catch {} },
            broadcastPlayerSpot: (player, spotId, height = 0, delay = 0, slotArg?) => {
                try {
                    const slot = slotArg !== undefined && Number.isFinite(slotArg) ? slotArg & 0xff : undefined;
                    deps.enqueueSpotAnimation({ tick: deps.getCurrentTick(), playerId: player.id, spotId, height, delay, slot });
                } catch {}
            },
            playLocGraphic: (opts) => deps.soundService.playLocGraphic(opts),
            stopPlayerAnimation: (player) => { try { player.stopAnimation(); } catch {} },
            getEmoteSeq: (index) => getEmoteSeq(index),
            getSkillcapeSeqId: (capeItemId) => getSkillcapeSeqId(capeItemId),
            getSkillcapeSpotId: (capeItemId) => getSkillcapeSpotId(capeItemId),
        },
        sound: {
            playLocSound: (opts) => deps.soundService.playLocSound(opts),
            playAreaSound: (opts) => deps.soundService.playAreaSound(opts),
            playSong: (player, trackId) => deps.soundService.sendSound(player, trackId),
            skipMusicTrack: () => false,
            getMusicTrackId: (trackName) => deps.soundService.getMusicTrackIdByName(trackName),
            getMusicTrackBySlot: (slot) => deps.musicCatalogService?.getBaseListTrackBySlot(slot),
            sendSound: (player, soundId, opts) => deps.soundService.sendSound(player, soundId, opts),
            enqueueSoundBroadcast: (soundId, x, y, level) => deps.enqueueSoundBroadcast(soundId, x, y, level),
        },
        appearance: {
            refreshAppearanceKits: (player) => deps.appearanceService.refreshAppearanceKits(player),
            queueAppearanceSnapshot: (player) => deps.appearanceService.queueAppearanceSnapshot(player),
            savePlayerSnapshot: (player) => {
                try {
                    const key = player.__saveKey;
                    if (key && key.length > 0) deps.playerPersistence.saveSnapshot(key, player);
                } catch {}
            },
            logoutPlayer: (player, reason) => {
                try {
                    const sock = deps.getPlayers()?.getSocketByPlayerId?.(player.id);
                    if (sock) deps.completeLogout(sock, player, reason);
                } catch {}
            },
        },
        dialog: {
            openDialog: (player, request) => deps.widgetDialogHandler.openDialog(player, request),
            openDialogOptions: (player, options) => deps.widgetDialogHandler.openDialogOptions(player, options),
            closeDialog: (player, dialogId) => deps.widgetDialogHandler.closeDialog(player, dialogId),
            closeInterruptibleInterfaces: (player) => deps.closeInterruptibleInterfaces(player),
            openSubInterface: (player, targetUid, groupId, type = 0, opts) => {
                if (type === 0 || type === 1) {
                    player.widgets.open(groupId, {
                        targetUid, type,
                        modal: opts?.modal !== false,
                        varps: opts?.varps, varbits: opts?.varbits,
                        preScripts: opts?.preScripts, postScripts: opts?.postScripts,
                        hiddenUids: opts?.hiddenUids,
                    });
                    return;
                }
                deps.queueWidgetEvent(player.id, {
                    action: "open_sub", targetUid, groupId, type,
                    varps: opts?.varps, varbits: opts?.varbits,
                    preScripts: opts?.preScripts, postScripts: opts?.postScripts,
                    hiddenUids: opts?.hiddenUids,
                });
            },
            closeSubInterface: (player, targetUid, groupId) => {
                if (groupId !== undefined) player.widgets.closeByTargetUid(targetUid, { groupId });
                else player.widgets.closeByTargetUid(targetUid);
            },
            closeModal: (player) => deps.interfaceService?.closeModal(player),
            getInterfaceService: () => deps.interfaceService,
            openRemainingTabs: (player) => {
                const { getRemainingTabInterfaces } = require("../../widgets/WidgetManager");
                const displayMode = player.displayMode ?? 1;
                for (const intf of getRemainingTabInterfaces(displayMode)) {
                    player.widgets?.open(intf.groupId, {
                        targetUid: intf.targetUid, type: intf.type,
                        modal: false, postScripts: intf.postScripts,
                    });
                }
            },
            queueClientScript: (playerId, scriptId, ...args) =>
                deps.variableService.queueVarp(playerId, 0, 0), // placeholder
            queueWidgetEvent: (playerId, event) => deps.queueWidgetEvent(playerId, event),
        },
        movement: {
            teleportPlayer: (player, x, y, level, forceRebuild) =>
                deps.movementService.teleportPlayer(player, x, y, level, forceRebuild),
            teleportToInstance: (player, x, y, level, templateChunks, extraLocs) =>
                deps.movementService.teleportToInstance(player, x, y, level, templateChunks, extraLocs),
            requestTeleportAction: (player, request) =>
                deps.movementService.requestTeleportAction(player, request),
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
                    startDeltaX: params.startTile.x - player.tileX, startDeltaY: params.startTile.y - player.tileY,
                    endDeltaX: params.endTile.x - player.tileX, endDeltaY: params.endTile.y - player.tileY,
                    startCycle: normalizedStartTick, endCycle: normalizedEndTick,
                    direction: params.direction ?? faceAngleRs(startX, startY, endX, endY),
                });
            },
            getPathService: () => deps.getPathService(),
        },
        location: {
            doorManager: deps.doorManager,
            resolveLocTransformId: (player, locDef) => resolveLocTransformId(player as any, locDef as any),
            emitLocChange: (oldId, newId, tile, level, opts) => deps.locationService.emitLocChange(oldId, newId, tile, level, opts),
            sendLocChangeToPlayer: (player, oldId, newId, tile, level) => deps.locationService.sendLocChangeToPlayer(player, oldId, newId, tile, level),
            spawnLocForPlayer: (player, locId, tile, level, shape, rotation) => deps.locationService.spawnLocForPlayer(player, locId, tile, level, shape, rotation),
            triggerLocEffect: () => false, // replaced below with self-referencing version
        },
        combat: {
            requestAction: (player, request, currentTick) => {
                try {
                    const groups = Array.isArray(request?.groups) ? request.groups : [];
                    if (groups.includes("skill.woodcut")) deps.actionScheduler.clearActionsInGroup(player.id, "skill.woodcut");
                } catch {}
                return deps.actionScheduler.requestAction(
                    player.id, request,
                    Number.isFinite(currentTick) ? (currentTick as number) : deps.getCurrentTick(),
                );
            },
            applyPrayers: (player, prayers) => deps.prayerSystem.applySelection(player, prayers),
            setCombatSpell: undefined,
            queueCombatState: (player) => deps.queueCombatSnapshot(
                player.id,
                player.combat?.weaponCategory ?? 0,
                player.combat?.weaponItemId ?? -1,
                player.combat?.autoRetaliate ?? true,
                player.combat?.styleSlot,
                undefined,
                player.combat?.spellId !== undefined && player.combat.spellId >= 0 ? player.combat.spellId : undefined,
            ),
            getNpc: (id) => deps.npcManager?.getById(id) ?? undefined,
            isPlayerStunned: (player) => player.timers.has(STUN_TIMER),
            isPlayerInCombat: (player) => player.isBeingAttacked(),
            applyPlayerHitsplat: (player, style, damage, tick) => deps.combatEffectApplicator.applyPlayerHitsplat(player, style, damage, tick),
            stunPlayer: (player, ticks) => { player.timers.set(STUN_TIMER, ticks); },
            scheduleAction: (playerId, request, tick) => deps.actionScheduler.requestAction(playerId, request, tick),
            clearPlayerFaceTarget: (player) => { try { player.clearInteraction(); } catch {} },
            getDropEligibility: (npc) => deps.damageTracker.getDropEligibility(npc),
            clearNpcDamageRecords: (npc) => deps.damageTracker.clearNpc(npc),
            getLastAttacker: (actor, currentTick) => deps.multiCombatSystem.getLastAttacker(actor, currentTick),
            isMultiCombat: (x, y, plane) => deps.multiCombatSystem.isMultiCombat(x, y, plane),
            applyAutocastState: (player, spellId, autocastIndex, isDefensive, callbacks) =>
                applyAutocastState(player, spellId, autocastIndex, isDefensive, callbacks),
            clearAutocastState: (player, callbacks) => clearAutocastState(player, callbacks),
            validateRunes: (runeCosts, inventory, equippedItems) =>
                RuneValidator.validateAndCalculate(runeCosts, inventory, equippedItems),
        },
        npc: {
            spawnNpc: (config) => deps.npcManager?.spawnTransientNpc(config),
            removeNpc: (npcId) => deps.npcManager?.removeNpc(npcId) ?? false,
            queueNpcForcedChat: (npc, text) => { npc.pendingSay = text; },
            queueNpcSeq: (npc, seqId) => { npc.queueOneShotSeq(seqId); },
            faceNpcToPlayer: (npc, player) => { npc.faceTile(player.tileX, player.tileY); },
        },
        collectionLog: {
            sendCollectionLogSnapshot: (player) => deps.collectionLogService.sendCollectionLogSnapshot(player),
            openCollectionLog: (player) => deps.collectionLogService.openCollectionLog(player),
            openCollectionOverview: (player) => deps.collectionLogService.openCollectionOverview(player),
            populateCollectionLogCategories: (player, tabIndex) => deps.collectionLogService.populateCollectionLogCategories(player, tabIndex),
        },
        viewport: {
            getMainmodalUid: (displayMode) => getMainmodalUid(displayMode),
            getSidemodalUid: (displayMode) => getSidemodalUid(displayMode),
            getPrayerTabUid: (displayMode) => getPrayerTabUid(displayMode),
            getViewportTrackerFrontUid: (displayMode) => getViewportTrackerFrontUid(displayMode),
            getDefaultInterfaces: (displayMode) => getDefaultInterfaces(displayMode),
        },
    } as ScriptServices;

    // triggerLocEffect needs a reference to `services` itself for recursive loc effect chains
    services.location.triggerLocEffect = (locId, tile, level) =>
        triggerLocEffect(services, locId, tile, level);

    return services;
}
