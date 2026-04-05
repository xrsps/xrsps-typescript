import type { PrayerName } from "../../../../src/rs/prayer/prayers";
import type { PathService } from "../../pathfinding/PathService";
import type { InterfaceService } from "../../widgets/InterfaceService";
import type { WidgetAction } from "../../widgets/WidgetManager";
import type { DoorStateManager } from "../../world/DoorStateManager";
import type { ActionRequest } from "../actions";
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

// ============================================================================
// Data Loaders
// ============================================================================

export interface DataLoaderServices {
    /** @deprecated Use getEnumTypeLoader() */
    enumTypeLoader?: any;
    /** @deprecated Use getStructTypeLoader() */
    structTypeLoader?: any;
    getEnumTypeLoader?: () => any;
    getStructTypeLoader?: () => any;
    getIdkTypeLoader?: () => any;
    getDbRepository?: () => any;
    getObjType?: (id: number) => any;
    getLocDefinition?: (locId: number) => any;
    getLocTypeLoader?: () => any;
    getNpcTypeLoader?: () => any;
}

// ============================================================================
// System Utilities
// ============================================================================

export interface SystemServices {
    logger?: {
        info: (...args: unknown[]) => void;
        warn: (...args: unknown[]) => void;
        error: (...args: unknown[]) => void;
        debug: (...args: unknown[]) => void;
    };
    hotReloadEnabled?: boolean;
    getCurrentTick?: () => number;
    gamemodeServices?: Record<string, unknown>;
}

// ============================================================================
// Messaging
// ============================================================================

export interface MessagingServices {
    sendGameMessage: (player: PlayerState, text: string) => void;
    queueNotification?: (playerId: number, payload: any) => void;
}

// ============================================================================
// Variables
// ============================================================================

export interface VariableServices {
    sendVarp?: (player: PlayerState, varpId: number, value: number) => void;
    sendVarbit?: (player: PlayerState, varbitId: number, value: number) => void;
    queueVarp?: (playerId: number, varpId: number, value: number) => void;
    queueVarbit?: (playerId: number, varbitId: number, value: number) => void;
}

// ============================================================================
// Inventory
// ============================================================================

export interface InventoryServices {
    consumeItem: (player: PlayerState, slotIndex: number) => boolean;
    getInventoryItems: (player: PlayerState) => ScriptInventoryEntry[];
    addItemToInventory: (player: PlayerState, itemId: number, qty: number) => ScriptInventoryAddResult;
    setInventorySlot: (player: PlayerState, slotIndex: number, itemId: number, qty: number) => void;
    snapshotInventory: (player: PlayerState) => void;
    snapshotInventoryImmediate: (player: PlayerState) => void;
    findOwnedItemLocation?: (player: PlayerState, itemId: number) => OwnedItemLocation | undefined;
    collectCarriedItemIds?: (player: PlayerState) => number[];
    findInventorySlotWithItem?: (player: PlayerState, itemId: number) => number | undefined;
    canStoreItem?: (player: PlayerState, itemId: number) => boolean;
    playerHasItem?: (player: PlayerState, itemId: number) => boolean;
    hasInventorySlot?: (player: PlayerState) => boolean;
}

// ============================================================================
// Equipment
// ============================================================================

export interface EquipmentServices {
    getEquippedItem?: (player: PlayerState, slot: number) => number;
    getEquipArray?: (player: PlayerState) => number[];
    unequipItem?: (player: PlayerState, slot: number) => boolean;
}

// ============================================================================
// Animation & Sound
// ============================================================================

export interface AnimationServices {
    playPlayerSeq?: (player: PlayerState, seqId: number, delay?: number) => void;
    playPlayerSeqImmediate?: (player: PlayerState, seqId: number) => void;
    broadcastPlayerSpot?: (player: PlayerState, spotId: number, height?: number, delay?: number, slot?: number) => void;
    playLocGraphic?: (opts: { spotId: number; tile: { x: number; y: number }; level?: number; height?: number; delayTicks?: number }) => void;
    playLocSound?: (opts: { soundId: number; tile?: { x: number; y: number }; level?: number; loops?: number; delayMs?: number }) => void;
    playAreaSound?: (opts: { soundId: number; tile: { x: number; y: number }; level?: number; radius?: number; volume?: number; delay?: number }) => void;
    playSong?: (player: PlayerState, trackId: number, trackName?: string) => void;
    skipMusicTrack?: (player: PlayerState) => boolean;
    getMusicTrackId?: (trackName: string) => number;
    getMusicTrackBySlot?: (slot: number) => { rowId: number; trackId: number; trackName: string } | undefined;
    sendSound?: (player: PlayerState, soundId: number, opts?: { loops?: number; delayMs?: number }) => void;
    enqueueSoundBroadcast?: (soundId: number, x: number, y: number, level: number) => void;
    stopPlayerAnimation?: (player: PlayerState) => void;
}

// ============================================================================
// Appearance
// ============================================================================

export interface AppearanceServices {
    refreshAppearanceKits?: (player: PlayerState) => void;
    queueAppearanceSnapshot?: (player: PlayerState) => void;
    savePlayerSnapshot?: (player: PlayerState) => void;
    logoutPlayer?: (player: PlayerState, reason?: string) => void;
}

// ============================================================================
// Dialog & Interface
// ============================================================================

export interface DialogServices {
    openDialog?: (player: PlayerState, request: ScriptDialogRequest) => void;
    openDialogOptions?: (player: PlayerState, options: ScriptDialogOptionRequest) => void;
    closeDialog?: (player: PlayerState, dialogId?: string) => void;
    closeInterruptibleInterfaces?: (player: PlayerState) => void;
    openSubInterface?: (
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
    ) => void;
    closeSubInterface?: (player: PlayerState, targetUid: number, groupId?: number) => void;
    closeModal?: (player: PlayerState) => void;
    getInterfaceService?: () => InterfaceService | undefined;
    openRemainingTabs?: (player: PlayerState) => void;
    queueClientScript?: (playerId: number, scriptId: number, ...args: (number | string)[]) => void;
    queueWidgetEvent?: (playerId: number, event: WidgetAction) => void;
}

// ============================================================================
// Movement & Teleportation
// ============================================================================

export interface MovementServices {
    teleportPlayer?: (player: PlayerState, x: number, y: number, level: number, forceRebuild?: boolean) => void;
    teleportToInstance?: (
        player: PlayerState, x: number, y: number, level: number,
        templateChunks: number[][][],
        extraLocs?: Array<{ id: number; x: number; y: number; level: number; shape: number; rotation: number }>,
    ) => void;
    requestTeleportAction?: (
        player: PlayerState,
        request: {
            x: number; y: number; level: number;
            delayTicks?: number; cooldownTicks?: number; forceRebuild?: boolean;
            resetAnimation?: boolean; endSpotAnim?: number; endSpotHeight?: number; endSpotDelay?: number;
            arriveSoundId?: number; arriveSoundRadius?: number; arriveSoundVolume?: number;
            arriveMessage?: string; arriveSeqId?: number; arriveFaceTileX?: number; arriveFaceTileY?: number;
            preserveAnimation?: boolean; requireCanTeleport?: boolean; rejectIfPending?: boolean; replacePending?: boolean;
        },
    ) => { ok: boolean; reason?: string };
    queueForcedMovement?: (
        player: PlayerState,
        params: { startTile: { x: number; y: number }; endTile: { x: number; y: number }; startTick?: number; endTick: number; direction?: number },
    ) => void;
    getPathService?: () => PathService | undefined;
}

// ============================================================================
// Location
// ============================================================================

export interface LocationServices {
    doorManager?: DoorStateManager;
    emitLocChange?: (
        oldId: number, newId: number, tile: { x: number; y: number }, level: number,
        opts?: { oldTile?: { x: number; y: number }; newTile?: { x: number; y: number }; oldRotation?: number; newRotation?: number },
    ) => void;
    sendLocChangeToPlayer?: (player: PlayerState, oldId: number, newId: number, tile: { x: number; y: number }, level: number) => void;
    spawnLoc?: (locId: number, tile: { x: number; y: number }, level: number, shape: number, rotation: number) => void;
    spawnLocForPlayer?: (player: PlayerState, locId: number, tile: { x: number; y: number }, level: number, shape: number, rotation: number) => void;
}

// ============================================================================
// Combat
// ============================================================================

export interface CombatServices {
    applyPrayers?: (player: PlayerState, prayers: PrayerName[]) => { changed: boolean; errors: Array<{ message: string }>; activePrayers: string[] };
    setCombatSpell?: (player: PlayerState, spellId: number | null) => void;
    queueCombatState?: (player: PlayerState) => void;
    requestAction: ScriptActionRequestFn;
    getNpc?: (id: number) => NpcState | undefined;
    isPlayerStunned?: (player: PlayerState) => boolean;
    isPlayerInCombat?: (player: PlayerState) => boolean;
    applyPlayerHitsplat?: (player: PlayerState, style: number, damage: number, tick: number) => { amount: number; style: number; hpCurrent: number; hpMax: number };
    stunPlayer?: (player: PlayerState, ticks: number) => void;
    scheduleAction?: (playerId: number, request: ActionRequest, tick: number) => { ok: boolean; reason?: string };
    clearPlayerFaceTarget?: (player: PlayerState) => void;
}

// ============================================================================
// NPC
// ============================================================================

export interface NpcServices {
    spawnNpc?: (config: NpcSpawnConfig) => NpcState | undefined;
    removeNpc?: (npcId: number) => boolean;
    queueNpcForcedChat?: (npc: NpcState, text: string) => void;
    queueNpcSeq?: (npc: NpcState, seqId: number) => void;
    faceNpcToPlayer?: (npc: NpcState, player: PlayerState) => void;
}

// ============================================================================
// Skill & XP
// ============================================================================

export interface SkillServices {
    addSkillXp?: (player: PlayerState, skillId: number, xp: number) => void;
    getSkill?: (player: PlayerState, skillId: number) => { baseLevel: number; boost: number; xp?: number };
}

// ============================================================================
// Collection Log
// ============================================================================

export interface CollectionLogServices {
    sendCollectionLogSnapshot?: (player: PlayerState) => void;
    openCollectionLog?: (player: PlayerState) => void;
    openCollectionOverview?: (player: PlayerState) => void;
    populateCollectionLogCategories?: (player: PlayerState, tabIndex: number) => void;
}

// ============================================================================
// Followers
// ============================================================================

export interface FollowerServiceFacade {
    summonFollowerFromItem: (player: PlayerState, itemId: number, npcTypeId: number) => { ok: true; npcId: number } | { ok: false; reason: string };
    pickupFollower: (player: PlayerState, npcId: number) => { ok: true; itemId: number; npcTypeId: number } | { ok: false; reason: string };
    metamorphFollower: (player: PlayerState, npcId: number) => { ok: true; npcId: number; npcTypeId: number } | { ok: false; reason: string };
    callFollower: (player: PlayerState) => { ok: true; npcId: number } | { ok: false; reason: string };
    despawnFollowerForPlayer: (playerId: number, clearPersistentState?: boolean) => boolean;
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
    getWoodcuttingTree?: (locId: number) => any;
    getMiningRock?: (locId: number) => any;
    getFishingSpot?: (npcTypeId: number) => any;
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
    queueSmithingMessage?: (playerId: number, payload: any) => void;
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
