import type { PrayerName } from "../../../../src/rs/prayer/prayers";
import type { PathService } from "../../pathfinding/PathService";
import type { InterfaceService } from "../../widgets/InterfaceService";
import type { WidgetAction } from "../../widgets/WidgetManager";
import type { DoorStateManager } from "../../world/DoorStateManager";
import type { DoorToggleResult, GateDef, GatePair, GateOpenStyle, DoorPartnerResult } from "../../world/DoorDefinitions";
import type { ActionRequest } from "../actions";
import type { Actor } from "../actor";
import type { DropEligibility } from "../combat/DamageTracker";
import type { ItemDefinition } from "../../data/items";
import type { GameEventBus } from "../events/GameEventBus";
import type { OwnedItemLocation } from "../items/playerItemOwnership";
import type { NpcSpawnConfig, NpcState } from "../npc";
import type { PlayerState } from "../player";
import type { GatheringSystemManager } from "../systems/GatheringSystemManager";
import type {
    ScriptActionRequestFn,
    ScriptDialogOptionRequest,
    ScriptDialogRequest,
    ScriptInventoryAddResult,
    ScriptInventoryEntry,
} from "./types";

export type { DoorToggleResult, GateDef, GatePair, GateOpenStyle, DoorPartnerResult };

// ============================================================================
// Messaging
// ============================================================================

export interface MessagingFacade {
    sendGameMessage(player: PlayerState, text: string): void;
    queueNotification(playerId: number, payload: Record<string, unknown>): void;
}

// ============================================================================
// Variables
// ============================================================================

export interface VariableFacade {
    sendVarp(player: PlayerState, varpId: number, value: number): void;
    sendVarbit(player: PlayerState, varbitId: number, value: number): void;
    queueVarp(playerId: number, varpId: number, value: number): void;
    queueVarbit(playerId: number, varbitId: number, value: number): void;
}

// ============================================================================
// Skill & XP
// ============================================================================

export interface SkillFacade {
    addSkillXp(player: PlayerState, skillId: number, xp: number): void;
    getSkill(player: PlayerState, skillId: number): { baseLevel: number; boost: number; xp?: number };
}

// ============================================================================
// Collection Log
// ============================================================================

export {
    COLLECTION_LOG_GROUP_ID,
    COLLECTION_OVERVIEW_GROUP_ID,
    SCRIPT_COLLECTION_TAB_CHANGE,
    VARBIT_COLLECTION_LAST_CATEGORY,
    VARBIT_COLLECTION_LAST_TAB,
    VARP_COLLECTION_CATEGORY_COUNT,
    VARP_COLLECTION_CATEGORY_COUNT2,
    VARP_COLLECTION_CATEGORY_COUNT3,
    buildTabChangeArgs,
} from "../collectionlog";

// ============================================================================
// Followers
// ============================================================================

export interface FollowerItemDefinition {
    itemId: number;
    npcTypeId: number;
    variants?: readonly { npcTypeId: number }[];
}

export interface FollowerServiceFacade {
    summonFollowerFromItem: (player: PlayerState, itemId: number, npcTypeId: number) => { ok: true; npcId: number } | { ok: false; reason: string };
    pickupFollower: (player: PlayerState, npcId: number) => { ok: true; itemId: number; npcTypeId: number } | { ok: false; reason: string };
    metamorphFollower: (player: PlayerState, npcId: number) => { ok: true; npcId: number; npcTypeId: number } | { ok: false; reason: string };
    callFollower: (player: PlayerState) => { ok: true; npcId: number } | { ok: false; reason: string };
    despawnFollowerForPlayer: (playerId: number, clearPersistentState?: boolean) => boolean;
    getItemDefinitions: () => readonly FollowerItemDefinition[];
    getDefinitionByItemId: (itemId: number) => FollowerItemDefinition | undefined;
    getDefinitionByNpcTypeId: (npcTypeId: number) => FollowerItemDefinition | undefined;
}

export interface FollowerServices {
    followers?: FollowerServiceFacade;
}

// ============================================================================
// Banking (gamemode-contributed)
// ============================================================================

export interface BankingServices {
    openBank?: (player: PlayerState, opts?: { mode?: "bank" | "collect" }) => void;
    depositInventoryToBank?: (player: PlayerState, tab?: number) => boolean;
    depositEquipmentToBank?: (player: PlayerState, tab?: number) => boolean;
    depositInventoryItemToBank?: (player: PlayerState, slotIndex: number, quantity: number, opts?: { itemIdHint?: number; tab?: number }) => { ok: boolean; message?: string };
    withdrawFromBankSlot?: (player: PlayerState, slotIndex: number, quantity: number, opts?: { noted?: boolean }) => { ok: boolean; message?: string };
    getBankEntryAtClientSlot?: (player: PlayerState, clientSlot: number) => { itemId: number; quantity: number; tab?: number } | undefined;
    queueBankSnapshot?: (player: PlayerState) => void;
    sendBankTabVarbits?: (player: PlayerState) => void;
    addItemToBank?: (player: PlayerState, itemId: number, quantity: number) => boolean;
}

// ============================================================================
// Shopping (gamemode-contributed)
// ============================================================================

export interface ShoppingServices {
    openShop?: (player: PlayerState, opts?: { npcTypeId?: number; shopId?: string }) => void;
    closeShop?: (player: PlayerState) => void;
    buyFromShop?: (player: PlayerState, params: { slotIndex: number; quantity?: number }) => void;
    sellToShop?: (player: PlayerState, params: { inventorySlot: number; itemId: number; quantity?: number }) => void;
    setShopBuyMode?: (player: PlayerState, mode: number) => void;
    setShopSellMode?: (player: PlayerState, mode: number) => void;
    getShopSlotValue?: (player: PlayerState, slotIndex: number) => { itemId: number; itemName: string; buyPrice: number; sellPrice: number } | undefined;
    getInventoryItemSellValue?: (player: PlayerState, itemId: number) => { itemId: number; itemName: string; sellPrice: number } | undefined;
}

// ============================================================================
// Gathering
// ============================================================================

export interface GatheringServices {
    gathering?: GatheringSystemManager;
    getWoodcuttingTree?: (locId: number) => Record<string, unknown> | undefined;
    getMiningRock?: (locId: number) => Record<string, unknown> | undefined;
    getFishingSpot?: (npcTypeId: number) => Record<string, unknown> | undefined;
    isAdjacentToLoc?: (player: PlayerState, locId: number, tile: { x: number; y: number }, level: number) => boolean;
    isAdjacentToNpc?: (player: PlayerState, npc: NpcState) => boolean;
    faceGatheringTarget?: (player: PlayerState, tile: { x: number; y: number }) => void;
    stopGatheringInteraction?: (player: PlayerState) => void;
    isFiremakingTileBlocked?: (tile: { x: number; y: number }, level: number) => boolean;
    lightFire?: (params: {
        tile: { x: number; y: number }; level: number; logItemId: number;
        currentTick: number; burnTicks: { min: number; max: number };
        fireObjectId: number; previousLocId: number; ownerId: number;
    }) => { fireObjectId: number };
    playerHasTinderbox?: (player: PlayerState) => boolean;
    consumeFiremakingLog?: (player: PlayerState, logId: number, slotIndex?: number) => number | undefined;
    walkPlayerAwayFromFire?: (player: PlayerState, fireTile: { x: number; y: number }) => void;
}

export interface CookingServices {
    getCookingRecipeByRawItemId?: (itemId: number) => { cookedItemId: number; xp: number } | undefined;
}

// ============================================================================
// Production
// ============================================================================

export interface ProductionServiceFacade {
    takeInventoryItems: (player: PlayerState, inputs: Array<{ itemId: number; quantity: number }>) => { ok: boolean; removed: Map<number, { itemId: number; quantity: number }> };
    restoreInventoryRemovals: (player: PlayerState, removed: Map<number, { itemId: number; quantity: number }>) => void;
    restoreInventoryItems: (player: PlayerState, itemId: number, removed: Map<number, number>) => void;
    queueSmithingMessage?: (playerId: number, payload: Record<string, unknown>) => void;
    openSmithingModal?: (player: PlayerState, groupId: number, varbits?: Record<number, number>) => void;
    closeSmithingModal?: (player: PlayerState) => void;
    isSmithingModalOpen?: (player: PlayerState, groupId: number) => boolean;
    openSmithingBarModal?: (player: PlayerState) => void;
    getBarTypeByItemId?: (itemId: number) => number | undefined;
    openForgeInterface?: (player: PlayerState) => void;
    openSmeltingInterface?: (player: PlayerState) => void;
    smeltBars?: (player: PlayerState, params: { recipeId: string; count: number }) => void;
    openSmithingInterface?: (player: PlayerState) => void;
    smithItems?: (player: PlayerState, params: { recipeId: string; count: number }) => void;
    updateSmithingInterface?: (player: PlayerState) => void;
    updateSmeltingInterface?: (player: PlayerState) => void;
}

export interface ProductionServices {
    production?: ProductionServiceFacade;
    onItemCraft?: (playerId: number, itemId: number, count: number) => void;
}

// ============================================================================
// Sailing & World Entities
// ============================================================================

export interface SailingServiceFacade {
    teleportToWorldEntity: (
        player: PlayerState, x: number, y: number, level: number,
        entityIndex: number, configId: number, sizeX: number, sizeZ: number,
        templateChunks: number[][][],
        buildAreas: import("../../../../src/shared/worldentity/WorldEntityTypes").WorldEntityBuildArea[],
        extraLocs?: Array<{ id: number; x: number; y: number; level: number; shape: number; rotation: number }>,
    ) => void;
    sendWorldEntity: (
        player: PlayerState, entityIndex: number, configId: number, sizeX: number, sizeZ: number,
        templateChunks: number[][][],
        buildAreas: import("../../../../src/shared/worldentity/WorldEntityTypes").WorldEntityBuildArea[],
        extraLocs?: Array<{ id: number; x: number; y: number; level: number; shape: number; rotation: number }>,
        extraNpcs?: Array<{ id: number; x: number; y: number; level: number }>,
        drawMode?: number,
    ) => void;
    removeWorldEntity: (playerId: number, entityIndex: number) => void;
    queueWorldEntityPosition: (playerId: number, entityIndex: number, position: { x: number; y: number; z: number; orientation: number }) => void;
    setWorldEntityPosition: (playerId: number, entityIndex: number, position: { x: number; y: number; z: number; orientation: number }) => void;
    queueWorldEntityMask: (playerId: number, entityIndex: number, mask: { animationId?: number; sequenceFrame?: number; actionMask?: number }) => void;
    initSailingInstance: (player: PlayerState) => void;
    disposeSailingInstance: (player: PlayerState) => void;
    buildSailingDockedCollision: () => void;
}

export interface SailingServices {
    sailing?: SailingServiceFacade;
}

// ============================================================================
// Viewport
// ============================================================================

export { DisplayMode } from "../../widgets/viewport";
export type { InterfaceMount } from "../../widgets/viewport";
export { BaseComponentUids } from "../../widgets/viewport/ViewportEnumService";

import type { InterfaceMount } from "../../widgets/viewport";

export type { WidgetAction } from "../../widgets/WidgetManager";

// ============================================================================
// Smithing message types (re-exported for gamemode consumption)
// ============================================================================

export type { SmithingOptionMessage, SmithingServerPayload } from "../../network/messages";

// ============================================================================
// Combat type re-exports (for gamemode consumption without reaching into impl)
// ============================================================================

export type { DropEligibility, NpcLootConfig, LootDistribution, DamageType } from "../combat/DamageTracker";
export { damageTracker } from "../combat/DamageTracker";
export { multiCombatSystem } from "../combat/MultiCombatZones";
export { getItemDefinition, loadItemDefinitions } from "../../data/items";
export type { ItemDefinition, ItemBonuses, ItemRequirements, EquipmentType, WeaponInterface } from "../../data/items";

// Emote and equipment helpers for gamemode consumption
export { getEmoteSeq } from "../emotes";
export { getSkillcapeSeqId, getSkillcapeSpotId } from "../equipment";

// Autocast state helpers for gamemode consumption
export { applyAutocastState, clearAutocastState } from "../combat/AutocastState";

// Sailing configuration constants for gamemode consumption
export {
    buildSailingOverlayTemplates,
    SAILING_DOCKED_NPC_SPAWNS,
    SAILING_DOCKED_PLAYER_LEVEL,
    SAILING_DOCKED_PLAYER_X,
    SAILING_DOCKED_PLAYER_Y,
    SAILING_INTRO_BOAT_LOCS,
    SAILING_INTRO_BUILD_AREAS,
    SAILING_WORLD_ENTITY_CONFIG_ID,
    SAILING_WORLD_ENTITY_INDEX,
    SAILING_WORLD_ENTITY_SIZE_X,
    SAILING_WORLD_ENTITY_SIZE_Z,
    PORT_SARIM_RETURN_LEVEL,
    PORT_SARIM_RETURN_X,
    PORT_SARIM_RETURN_Y,
} from "../sailing/SailingInstance";

// Account summary helpers for gamemode consumption
export { getAccountSummaryTimeMinutes } from "../accountSummaryTime";

// Teleport spell data for gamemode consumption
export { getTeleportByWidgetId } from "../../data/teleportDestinations";
export type { TeleportSpellData } from "../../data/teleportDestinations";

// Spell widget lookup for gamemode consumption
export { getSpellWidgetId } from "../../data/spellWidgetLoader";

// Queue task types for gamemode consumption
export { WaitCondition } from "../model/queue/QueueTask";

// Timer keys for gamemode consumption
export { HOME_TELEPORT_TIMER } from "../model/timer/Timers";

// Rune validation types for gamemode consumption
export { RuneValidator } from "../spells/RuneValidator";
export type { InventoryItem as RuneInventoryItem, RuneValidationResult } from "../spells/RuneValidator";

// Skill action payload types for gamemode consumption
export type { SkillBoltEnchantActionData } from "../actions/skillActionPayloads";

// ============================================================================
// Grouped Facades (remaining domains)
// ============================================================================

export interface DataLoaderFacade {
    getDbRepository(): { getRows(tableId: number, ...args: unknown[]): unknown[] } | undefined;
    getEnumTypeLoader(): { load(id: number): unknown } | undefined;
    getStructTypeLoader(): { load(id: number): unknown } | undefined;
    getIdkTypeLoader(): { load(id: number): unknown } | undefined;
    getObjType(id: number): Record<string, unknown> | undefined;
    getLocDefinition(locId: number): Record<string, unknown> | undefined;
    getLocTypeLoader(): { load(id: number): unknown } | undefined;
    getNpcTypeLoader(): { load(id: number): unknown } | undefined;
    getItemDefinition(itemId: number): ItemDefinition | undefined;
    loadItemDefinitions(): ItemDefinition[];
}

export interface SystemFacade {
    logger: {
        info: (...args: unknown[]) => void;
        warn: (...args: unknown[]) => void;
        error: (...args: unknown[]) => void;
        debug: (...args: unknown[]) => void;
    };
    getCurrentTick(): number;
    eventBus?: GameEventBus;
    gamemodeServices?: Record<string, unknown>;
}

export interface InventoryFacade {
    consumeItem(player: PlayerState, slotIndex: number): boolean;
    getInventoryItems(player: PlayerState): ScriptInventoryEntry[];
    addItemToInventory(player: PlayerState, itemId: number, qty: number): ScriptInventoryAddResult;
    setInventorySlot(player: PlayerState, slotIndex: number, itemId: number, qty: number): void;
    snapshotInventory(player: PlayerState): void;
    snapshotInventoryImmediate(player: PlayerState): void;
    findOwnedItemLocation(player: PlayerState, itemId: number): OwnedItemLocation | undefined;
    collectCarriedItemIds(player: PlayerState): number[];
    findInventorySlotWithItem(player: PlayerState, itemId: number): number | undefined;
    canStoreItem(player: PlayerState, itemId: number): boolean;
    playerHasItem(player: PlayerState, itemId: number): boolean;
    hasInventorySlot(player: PlayerState): boolean;
}

export interface EquipmentFacade {
    getEquippedItem(player: PlayerState, slot: number): number;
    getEquipArray(player: PlayerState): number[];
    unequipItem(player: PlayerState, slot: number): boolean;
}

export interface AnimationFacade {
    playPlayerSeq(player: PlayerState, seqId: number, delay?: number): void;
    playPlayerSeqImmediate(player: PlayerState, seqId: number): void;
    broadcastPlayerSpot(player: PlayerState, spotId: number, height?: number, delay?: number, slot?: number): void;
    playLocGraphic(opts: { spotId: number; tile: { x: number; y: number }; level?: number; height?: number; delayTicks?: number }): void;
    stopPlayerAnimation(player: PlayerState): void;
    getEmoteSeq(index: number): number | undefined;
    getSkillcapeSeqId(capeItemId: number | undefined): number | undefined;
    getSkillcapeSpotId(capeItemId: number | undefined): number | undefined;
}

export interface SoundFacade {
    playLocSound(opts: { soundId: number; tile?: { x: number; y: number }; level?: number; loops?: number; delayMs?: number }): void;
    playAreaSound(opts: { soundId: number; tile: { x: number; y: number }; level?: number; radius?: number; volume?: number; delay?: number }): void;
    playSong(player: PlayerState, trackId: number, trackName?: string): void;
    skipMusicTrack(player: PlayerState): boolean;
    getMusicTrackId(trackName: string): number;
    getMusicTrackBySlot(slot: number): { rowId: number; trackId: number; trackName: string } | undefined;
    sendSound(player: PlayerState, soundId: number, opts?: { loops?: number; delayMs?: number }): void;
    enqueueSoundBroadcast(soundId: number, x: number, y: number, level: number): void;
}

export interface AppearanceFacade {
    refreshAppearanceKits(player: PlayerState): void;
    queueAppearanceSnapshot(player: PlayerState): void;
    savePlayerSnapshot(player: PlayerState): void;
    logoutPlayer(player: PlayerState, reason?: string): void;
}

export interface DialogFacade {
    openDialog(player: PlayerState, request: ScriptDialogRequest): void;
    openDialogOptions(player: PlayerState, options: ScriptDialogOptionRequest): void;
    closeDialog(player: PlayerState, dialogId?: string): void;
    closeInterruptibleInterfaces(player: PlayerState): void;
    openSubInterface(
        player: PlayerState,
        targetUid: number,
        groupId: number,
        type?: number,
        opts?: {
            varps?: Record<number, number>;
            varbits?: Record<number, number>;
            preScripts?: Array<{ scriptId: number; args: (number | string)[] }>;
            postScripts?: Array<{ scriptId: number; args: (number | string)[] }>;
            hiddenUids?: number[];
            modal?: boolean;
        },
    ): void;
    closeSubInterface(player: PlayerState, targetUid: number, groupId?: number): void;
    closeModal(player: PlayerState): void;
    getInterfaceService(): InterfaceService | undefined;
    openRemainingTabs(player: PlayerState): void;
    queueClientScript(playerId: number, scriptId: number, ...args: (number | string)[]): void;
    queueWidgetEvent(playerId: number, event: WidgetAction): void;
}

export interface MovementFacade {
    teleportPlayer(player: PlayerState, x: number, y: number, level: number, forceRebuild?: boolean): void;
    teleportToInstance(
        player: PlayerState, x: number, y: number, level: number,
        templateChunks: number[][][],
        extraLocs?: Array<{ id: number; x: number; y: number; level: number; shape: number; rotation: number }>,
    ): void;
    requestTeleportAction(
        player: PlayerState,
        request: {
            x: number; y: number; level: number;
            delayTicks?: number; cooldownTicks?: number; forceRebuild?: boolean;
            resetAnimation?: boolean; endSpotAnim?: number; endSpotHeight?: number; endSpotDelay?: number;
            arriveSoundId?: number; arriveSoundRadius?: number; arriveSoundVolume?: number;
            arriveMessage?: string; arriveSeqId?: number; arriveFaceTileX?: number; arriveFaceTileY?: number;
            preserveAnimation?: boolean; requireCanTeleport?: boolean; rejectIfPending?: boolean; replacePending?: boolean;
        },
    ): { ok: boolean; reason?: string };
    queueForcedMovement(
        player: PlayerState,
        params: { startTile: { x: number; y: number }; endTile: { x: number; y: number }; startTick?: number; endTick: number; direction?: number },
    ): void;
    getPathService(): PathService | undefined;
}

export interface LocationFacade {
    doorManager?: DoorStateManager;
    resolveLocTransformId(player: PlayerState, locDef: Record<string, unknown> | undefined): number | undefined;
    emitLocChange(
        oldId: number, newId: number, tile: { x: number; y: number }, level: number,
        opts?: { oldTile?: { x: number; y: number }; newTile?: { x: number; y: number }; oldRotation?: number; newRotation?: number },
    ): void;
    sendLocChangeToPlayer(player: PlayerState, oldId: number, newId: number, tile: { x: number; y: number }, level: number): void;
    spawnLoc?(locId: number, tile: { x: number; y: number }, level: number, shape: number, rotation: number): void;
    spawnLocForPlayer(player: PlayerState, locId: number, tile: { x: number; y: number }, level: number, shape: number, rotation: number): void;
    triggerLocEffect(locId: number, tile: { x: number; y: number }, level: number): boolean;
}

export interface CombatFacade {
    applyPrayers(player: PlayerState, prayers: PrayerName[]): { changed: boolean; errors: Array<{ message: string }>; activePrayers: string[] };
    setCombatSpell?(player: PlayerState, spellId: number | null): void;
    queueCombatState(player: PlayerState): void;
    requestAction: ScriptActionRequestFn;
    getNpc(id: number): NpcState | undefined;
    isPlayerStunned(player: PlayerState): boolean;
    isPlayerInCombat(player: PlayerState): boolean;
    applyPlayerHitsplat(player: PlayerState, style: number, damage: number, tick: number): { amount: number; style: number; hpCurrent: number; hpMax: number };
    stunPlayer(player: PlayerState, ticks: number): void;
    scheduleAction(playerId: number, request: ActionRequest, tick: number): { ok: boolean; reason?: string };
    clearPlayerFaceTarget(player: PlayerState): void;
    getDropEligibility(npc: NpcState): DropEligibility;
    clearNpcDamageRecords(npc: NpcState): void;
    getLastAttacker(actor: Actor, currentTick: number): Actor | null;
    isMultiCombat(x: number, y: number, plane: number): boolean;
    applyAutocastState(player: PlayerState, spellId: number, autocastIndex: number, isDefensive: boolean, callbacks?: { sendVarbit?: (player: PlayerState, varbitId: number, value: number) => void; queueCombatState?: (player: PlayerState) => void }): void;
    clearAutocastState(player: PlayerState, callbacks?: { sendVarbit?: (player: PlayerState, varbitId: number, value: number) => void; queueCombatState?: (player: PlayerState) => void }): void;
    validateRunes(
        runeCosts: Array<{ runeId: number; quantity: number }>,
        inventory: Array<{ itemId: number; quantity: number }>,
        equippedItems: number[],
    ): { canCast: boolean; missingRunes?: Array<{ runeId: number; need: number; have: number }>; runesConsumed?: Array<{ runeId: number; quantity: number }> };
}

export interface NpcFacade {
    spawnNpc(config: NpcSpawnConfig): NpcState | undefined;
    removeNpc(npcId: number): boolean;
    queueNpcForcedChat(npc: NpcState, text: string): void;
    queueNpcSeq(npc: NpcState, seqId: number): void;
    faceNpcToPlayer(npc: NpcState, player: PlayerState): void;
}

export interface CollectionLogFacade {
    sendCollectionLogSnapshot(player: PlayerState): void;
    openCollectionLog(player: PlayerState): void;
    openCollectionOverview(player: PlayerState): void;
    populateCollectionLogCategories(player: PlayerState, tabIndex: number): void;
}

export interface ViewportFacade {
    getMainmodalUid(displayMode: number): number;
    getSidemodalUid(displayMode: number): number;
    getPrayerTabUid(displayMode: number): number;
    getViewportTrackerFrontUid(displayMode: number): number;
    getDefaultInterfaces(displayMode: number): InterfaceMount[];
}
