import type { PrayerName } from "../../../../src/rs/prayer/prayers";
import type { PathService } from "../../pathfinding/PathService";
import type { InterfaceService } from "../../widgets/InterfaceService";
import type { WidgetAction } from "../../widgets/WidgetManager";
import { type DoorStateManager } from "../../world/DoorStateManager";
import { type ActionEffect, type ActionEnqueueResult, type ActionExecutionResult, type ActionKind, type ActionRequest } from "../actions";
import type { OwnedItemLocation } from "../items/playerItemOwnership";
import { type NpcSpawnConfig, type NpcState } from "../npc";
import { type PlayerState } from "../player";
import type { FishingSpotDefinition } from "../skills/fishing";
import type { MiningRockDefinition } from "../skills/mining";
import type { WoodcuttingTreeDefinition } from "../skills/woodcutting";

export interface ScriptExecutionContext {
    tick: number;
    services: ScriptServices;
}

export interface ScriptInventoryEntry {
    slot: number;
    itemId: number;
    quantity: number;
}

export interface ScriptInventoryAddResult {
    slot: number;
    added: number;
}

export type ScriptActionRequestFn = <K extends ActionKind>(
    player: PlayerState,
    request: ActionRequest<K>,
    currentTick: number,
) => ActionEnqueueResult;

export interface NpcInteractionEvent extends ScriptExecutionContext {
    player: PlayerState;
    npc: NpcState;
    option?: string;
}

export interface LocInteractionEvent extends ScriptExecutionContext {
    player: PlayerState;
    locId: number;
    tile: { x: number; y: number };
    level: number;
    action?: string;
}

export type NpcInteractionHandler = (event: NpcInteractionEvent) => void | Promise<void>;
export type LocInteractionHandler = (event: LocInteractionEvent) => void | Promise<void>;
export interface ItemOnItemEvent extends ScriptExecutionContext {
    player: PlayerState;
    source: { slot: number; itemId: number };
    target: { slot: number; itemId: number };
    option?: string;
}

export type ItemOnItemHandler = (event: ItemOnItemEvent) => void | Promise<void>;

export interface ItemOnLocEvent extends ScriptExecutionContext {
    player: PlayerState;
    source: { slot: number; itemId: number };
    target: { locId: number; tile: { x: number; y: number }; level: number };
    option?: string;
}

export type ItemOnLocHandler = (event: ItemOnLocEvent) => void | Promise<void>;

export interface EquipmentActionEvent extends ScriptExecutionContext {
    player: PlayerState;
    slot: number;
    itemId: number;
    option: string;
    rawOption?: string;
}

export type EquipmentActionHandler = (event: EquipmentActionEvent) => void | Promise<void>;

export interface WidgetActionEvent extends ScriptExecutionContext {
    player: PlayerState;
    widgetId: number;
    groupId: number;
    childId: number;
    option?: string;
    target?: string;
    opId?: number;
    slot?: number;
    itemId?: number;
    isPrimary?: boolean;
    cursorX?: number;
    cursorY?: number;
}

export type WidgetActionHandler = (event: WidgetActionEvent) => void | Promise<void>;

export interface RegionEvent extends ScriptExecutionContext {
    player: PlayerState;
    regionId: number;
    type: "enter" | "leave";
}

export type RegionEventHandler = (event: RegionEvent) => void | Promise<void>;

export interface TickScriptEvent extends ScriptExecutionContext {}

export type TickHandler = (event: TickScriptEvent) => void | Promise<void>;

export interface CommandEvent extends ScriptExecutionContext {
    player: PlayerState;
    command: string;
    args: string[];
}

export type CommandHandler = (event: CommandEvent) => string | void | Promise<string | void>;

export interface ClientMessageEvent extends ScriptExecutionContext {
    player: PlayerState;
    messageType: string;
    payload: Record<string, unknown>;
}

export type ClientMessageHandler = (event: ClientMessageEvent) => void | Promise<void>;

export interface ScriptActionHandlerContext {
    player: PlayerState;
    data: unknown;
    tick: number;
    services: ScriptServices;
}

export type ScriptActionHandler = (
    ctx: ScriptActionHandlerContext,
) => ActionExecutionResult;

export interface ScriptModule {
    id: string;
    register(registry: IScriptRegistry, services: ScriptServices): void;
}

export interface ScriptDialogOptionRequest {
    id: string;
    title?: string;
    options: string[];
    modal?: boolean;
    disabledOptions?: boolean[];
    onSelect: (choiceIndex: number) => void;
    onClose?: () => void;
}

export type ScriptDialogKind = "npc" | "player" | "sprite" | "double_sprite";

export interface ScriptDialogBaseRequest {
    id: string;
    lines: string[];
    modal?: boolean;
    clickToContinue?: boolean;
    closeOnContinue?: boolean;
    onClose?: () => void;
}

export interface ScriptNpcDialogRequest extends ScriptDialogBaseRequest {
    kind: "npc";
    npcId?: number;
    npcName?: string;
    animationId?: number;
    onContinue?: () => void;
}

export interface ScriptPlayerDialogRequest extends ScriptDialogBaseRequest {
    kind: "player";
    playerName?: string;
    animationId?: number;
    onContinue?: () => void;
}

export interface ScriptSpriteDialogRequest extends ScriptDialogBaseRequest {
    kind: "sprite";
    itemId: number;
    itemQuantity?: number;
    title?: string;
    onContinue?: () => void;
}

export interface ScriptDoubleSpriteDialogRequest extends ScriptDialogBaseRequest {
    kind: "double_sprite";
    leftItemId: number;
    rightItemId: number;
    leftItemQuantity?: number;
    rightItemQuantity?: number;
    title?: string;
    onContinue?: () => void;
}

export type ScriptDialogRequest =
    | ScriptNpcDialogRequest
    | ScriptPlayerDialogRequest
    | ScriptSpriteDialogRequest
    | ScriptDoubleSpriteDialogRequest;

// Narrow interface to avoid circular imports in consumers.
export interface IScriptRegistry {
    registerNpcInteraction(
        npcId: number,
        handler: NpcInteractionHandler,
        option?: string,
    ): ScriptRegistrationResult;
    registerNpcScript(params: {
        npcId: number;
        option?: string;
        handler: NpcInteractionHandler;
    }): ScriptRegistrationResult;
    registerLocInteraction(
        locId: number,
        handler: LocInteractionHandler,
        action?: string,
    ): ScriptRegistrationResult;
    registerLocScript(params: {
        locId: number;
        action?: string;
        handler: LocInteractionHandler;
    }): ScriptRegistrationResult;
    registerLocAction(action: string, handler: LocInteractionHandler): ScriptRegistrationResult;
    registerItemOnItem(
        sourceItemId: number,
        targetItemId: number,
        handler: ItemOnItemHandler,
        option?: string,
    ): ScriptRegistrationResult;
    registerItemOnLoc(
        sourceItemId: number,
        locId: number,
        handler: ItemOnLocHandler,
        option?: string,
    ): ScriptRegistrationResult;
    registerItemAction(
        itemId: number,
        handler: ItemOnItemHandler,
        option?: string,
    ): ScriptRegistrationResult;
    registerEquipmentAction(
        itemId: number,
        handler: EquipmentActionHandler,
        option?: string,
    ): ScriptRegistrationResult;
    registerEquipmentOption(
        option: string,
        handler: EquipmentActionHandler,
    ): ScriptRegistrationResult;
    registerWidgetAction(params: {
        widgetId?: number;
        opId?: number;
        option?: string;
        handler: WidgetActionHandler;
    }): ScriptRegistrationResult;
    /**
     * RSMod-style button registration by (interfaceId, componentId) hash.
     * This is the preferred method for registering widget button handlers.
     */
    onButton(
        interfaceId: number,
        component: number,
        handler: WidgetActionHandler,
    ): ScriptRegistrationResult;
    registerNpcAction(option: string, handler: NpcInteractionHandler): ScriptRegistrationResult;
    registerRegionHandler(regionId: number, handler: RegionEventHandler): ScriptRegistrationResult;
    registerTickHandler(handler: TickHandler): ScriptRegistrationResult;
    registerCommand(name: string, handler: CommandHandler): ScriptRegistrationResult;
    findCommand(name: string): CommandHandler | undefined;
    findNpcInteraction(npcId: number, option?: string): NpcInteractionHandler | undefined;
    /** Lookup only npc-specific handlers (instance or type), skipping generic action fallbacks. */
    findNpcInteractionDirect(npcId: number, option?: string): NpcInteractionHandler | undefined;
    /** Lookup a generic npc action handler (e.g., talk-to) */
    findNpcAction(option?: string): NpcInteractionHandler | undefined;
    findLocInteraction(locId: number, action?: string): LocInteractionHandler | undefined;
    findItemOnItem(
        sourceItemId: number,
        targetItemId: number,
        option?: string,
    ): ItemOnItemHandler | undefined;
    findItemOnLoc(
        sourceItemId: number,
        locId: number,
        option?: string,
    ): ItemOnLocHandler | undefined;
    findEquipmentAction(itemId: number, option?: string): EquipmentActionHandler | undefined;
    findWidgetAction(
        widgetId: number,
        opId?: number,
        option?: string,
    ): WidgetActionHandler | undefined;
    /**
     * RSMod-style button lookup by (interfaceId, componentId) hash.
     */
    findButton(interfaceId: number, component: number): WidgetActionHandler | undefined;
    findNpcAction(option?: string): NpcInteractionHandler | undefined;
    registerClientMessageHandler(
        messageType: string,
        handler: ClientMessageHandler,
    ): ScriptRegistrationResult;
    findClientMessageHandler(messageType: string): ClientMessageHandler | undefined;
    registerActionHandler(
        kind: string,
        handler: ScriptActionHandler,
    ): ScriptRegistrationResult;
    findActionHandler(kind: string): ScriptActionHandler | undefined;
}

export interface ScriptRegistrationResult {
    unregister(): void;
}

export interface ScriptServices {
    /** Optional cache enum loader (DAT2 only). @deprecated Use getEnumTypeLoader() */
    enumTypeLoader?: any;
    /** Optional cache struct loader (DAT2 only). @deprecated Use getStructTypeLoader() */
    structTypeLoader?: any;
    /** Getter for cache enum loader (DAT2 only) - use this instead of enumTypeLoader. */
    getEnumTypeLoader?: () => any;
    /** Getter for cache struct loader (DAT2 only) - use this instead of structTypeLoader. */
    getStructTypeLoader?: () => any;
    /** Getter for IdentityKit (idk) loader (DAT2 configs). */
    getIdkTypeLoader?: () => any;
    /** Optional cache DB repository (DAT2 configs) for region_data, music, etc. */
    getDbRepository?: () => any;
    doorManager?: DoorStateManager;
    emitLocChange?: (
        oldId: number,
        newId: number,
        tile: { x: number; y: number },
        level: number,
        opts?: {
            oldTile?: { x: number; y: number };
            newTile?: { x: number; y: number };
            oldRotation?: number;
            newRotation?: number;
        },
    ) => void;
    /**
     * Send a loc_change to a single player only (no global broadcast, no server state mutation).
     * Used for per-player multiloc visual updates driven by varbits.
     */
    sendLocChangeToPlayer?: (
        player: PlayerState,
        oldId: number,
        newId: number,
        tile: { x: number; y: number },
        level: number,
    ) => void;
    logger?: {
        info: (...args: unknown[]) => void;
        warn: (...args: unknown[]) => void;
        error: (...args: unknown[]) => void;
        debug: (...args: unknown[]) => void;
    };
    hotReloadEnabled?: boolean;
    // Host helpers exposed by the runtime.
    getObjType?: (id: number) => any;
    getLocDefinition?: (locId: number) => any;
    consumeItem: (player: PlayerState, slotIndex: number) => boolean;
    getInventoryItems: (player: PlayerState) => ScriptInventoryEntry[];
    addSkillXp?: (player: PlayerState, skillId: number, xp: number) => void;
    playPlayerSeq?: (player: PlayerState, seqId: number, delay?: number) => void;
    /** Plays a sequence animation on a player and sends an immediate pos update to the client */
    playPlayerSeqImmediate?: (player: PlayerState, seqId: number) => void;
    /** Get the equipped item ID at the given equipment slot */
    getEquippedItem?: (player: PlayerState, slot: number) => number;
    /** Broadcast a spot animation (graphic) on a player to all clients */
    broadcastPlayerSpot?: (
        player: PlayerState,
        spotId: number,
        height?: number,
        delay?: number,
        slot?: number,
    ) => void;
    playLocGraphic?: (opts: {
        spotId: number;
        tile: { x: number; y: number };
        level?: number;
        height?: number;
        delayTicks?: number;
    }) => void;
    playLocSound?: (opts: {
        soundId: number;
        tile?: { x: number; y: number };
        level?: number;
        loops?: number;
        delayMs?: number;
    }) => void;
    /**
     * SOUND_AREA: Play a sound at a specific location with radius and volume.
     * This is the OSRS-parity method for area sounds with distance-based falloff.
     * @param opts.soundId - The sound effect ID
     * @param opts.tile - The tile position {x, y}
     * @param opts.level - The plane/level (0-3)
     * @param opts.radius - Radius in tiles (0-15) for client-side distance falloff
     * @param opts.volume - Volume (0-255, default 255)
     * @param opts.delay - Delay in ticks before playing
     */
    playAreaSound?: (opts: {
        soundId: number;
        tile: { x: number; y: number };
        level?: number;
        radius?: number;
        volume?: number;
        delay?: number;
    }) => void;
    playSong?: (player: PlayerState, trackId: number, trackName?: string) => void;
    skipMusicTrack?: (player: PlayerState) => boolean;
    getMusicTrackId?: (trackName: string) => number;
    getMusicTrackBySlot?: (
        slot: number,
    ) => { rowId: number; trackId: number; trackName: string } | undefined;
    /** Play a sound effect for a specific player. */
    sendSound?: (
        player: PlayerState,
        soundId: number,
        opts?: { loops?: number; delayMs?: number },
    ) => void;
    /** Refresh a player's appearance kits and derived animation set. */
    refreshAppearanceKits?: (player: PlayerState) => void;
    /** Queue an appearance snapshot update to be sent in the next tick broadcast. */
    queueAppearanceSnapshot?: (player: PlayerState) => void;
    /** Persist the player's current snapshot immediately (best-effort). */
    savePlayerSnapshot?: (player: PlayerState) => void;
    sendGameMessage: (player: PlayerState, text: string) => void;
    getCurrentTick?: () => number;
    getPathService?: () => PathService | undefined;
    snapshotInventory: (player: PlayerState) => void;
    // Immediate send variants (bypass broadcast tick)
    snapshotInventoryImmediate: (player: PlayerState) => void;
    addItemToInventory: (
        player: PlayerState,
        itemId: number,
        qty: number,
    ) => ScriptInventoryAddResult;
    setInventorySlot: (player: PlayerState, slotIndex: number, itemId: number, qty: number) => void;
    openBank: (player: PlayerState, opts?: { mode?: "bank" | "collect" }) => void;
    depositInventoryToBank: (player: PlayerState) => boolean;
    depositEquipmentToBank: (player: PlayerState) => boolean;
    depositInventoryItemToBank?: (
        player: PlayerState,
        slotIndex: number,
        quantity: number,
        opts?: { itemIdHint?: number; tab?: number },
    ) => { ok: boolean; message?: string };
    withdrawFromBankSlot: (
        player: PlayerState,
        slotIndex: number,
        quantity: number,
        opts?: { noted?: boolean },
    ) => { ok: boolean; message?: string };
    /**
     * Get the bank entry at a client slot index.
     * OSRS PARITY: Client sees items reorganized by tab (tabs 1-9 first, then tab 0).
     * This translates the client's visual slot to the server's storage location.
     */
    getBankEntryAtClientSlot: (
        player: PlayerState,
        clientSlot: number,
    ) => { itemId: number; quantity: number; tab?: number } | undefined;
    /** Shared duplicate-protection check across inventory, equipment, and bank. */
    findOwnedItemLocation?: (player: PlayerState, itemId: number) => OwnedItemLocation | undefined;
    openShop?: (player: PlayerState, opts?: { npcTypeId?: number; shopId?: string }) => void;
    closeShop?: (player: PlayerState) => void;
    buyFromShop?: (player: PlayerState, params: { slotIndex: number; quantity?: number }) => void;
    sellToShop?: (
        player: PlayerState,
        params: { inventorySlot: number; itemId: number; quantity?: number },
    ) => void;
    setShopBuyMode?: (player: PlayerState, mode: number) => void;
    setShopSellMode?: (player: PlayerState, mode: number) => void;
    getShopSlotValue?: (
        player: PlayerState,
        slotIndex: number,
    ) => { itemId: number; itemName: string; buyPrice: number; sellPrice: number } | undefined;
    getInventoryItemSellValue?: (
        player: PlayerState,
        itemId: number,
    ) => { itemId: number; itemName: string; sellPrice: number } | undefined;
    applyPrayers?: (
        player: PlayerState,
        prayers: PrayerName[],
    ) => { changed: boolean; errors: Array<{ message: string }>; activePrayers: string[] };
    setCombatSpell?: (player: PlayerState, spellId: number | null) => void;
    queueCombatState?: (player: PlayerState) => void;
    requestAction: ScriptActionRequestFn;
    openDialog?: (player: PlayerState, request: ScriptDialogRequest) => void;
    openDialogOptions?: (player: PlayerState, options: ScriptDialogOptionRequest) => void;
    closeDialog?: (player: PlayerState, dialogId?: string) => void;
    /** OSRS parity: Close all interruptible interfaces (modals, dialogs, level-ups) */
    closeInterruptibleInterfaces?: (player: PlayerState) => void;
    queueForcedMovement?: (
        player: PlayerState,
        params: {
            startTile: { x: number; y: number };
            endTile: { x: number; y: number };
            startTick?: number;
            endTick: number;
            direction?: number;
        },
    ) => void;
    getWoodcuttingTree?: (locId: number) => WoodcuttingTreeDefinition | undefined;
    getMiningRock?: (locId: number) => MiningRockDefinition | undefined;
    getFishingSpot?: (npcTypeId: number) => FishingSpotDefinition | undefined;
    openSmeltingInterface?: (player: PlayerState) => void;
    smeltBars?: (player: PlayerState, params: { recipeId: string; count: number }) => void;
    openSmithingInterface?: (player: PlayerState) => void;
    smithItems?: (player: PlayerState, params: { recipeId: string; count: number }) => void;
    queueBankSnapshot: (player: PlayerState) => void;
    /**
     * Send bank tab size varbits to the client.
     * Calculates sizes from actual bank entries and sends varbits for tabs 1-9.
     * This is needed when bank operations change tab contents (deposit/withdraw/release placeholders).
     */
    sendBankTabVarbits: (player: PlayerState) => void;
    /**
     * Open a sub-interface into a container widget (IF_OPENSUB)
     * @param player The player to open the interface for
     * @param targetUid The widget UID to mount into (parentGroupId << 16 | childId)
     * @param groupId The interface group to open
     * @param type Interface parent type (0 = modal, 1 = click-through overlay, 3 = tab/sidemodal replacement)
     * @param opts Optional varps/varbits to set before opening
     */
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
    /**
     * Close a sub-interface mounted at a container widget (IF_CLOSESUB)
     * @param player The player to close the interface for
     * @param targetUid The widget UID where the interface is mounted
     * @param groupId Optional interface group ID for unregistering from widget manager
     */
    closeSubInterface?: (player: PlayerState, targetUid: number, groupId?: number) => void;
    /**
     * Close the currently open modal interface via InterfaceService.
     * This properly triggers onClose hooks and updates modal tracking.
     * @param player The player to close the modal for
     */
    closeModal?: (player: PlayerState) => void;
    /**
     * Teleport a player to a new location with proper OSRS parity.
     * Clears actions, updates playerViews, and syncs appearance.
     * @param player The player to teleport
     * @param x Target tile X coordinate
     * @param y Target tile Y coordinate
     * @param level Target level/plane (0-3)
     * @param forceRebuild Legacy flag retained for script compatibility.
     */
    teleportPlayer?: (
        player: PlayerState,
        x: number,
        y: number,
        level: number,
        forceRebuild?: boolean,
    ) => void;
    /**
     * Teleport a player into a dynamic instance (REBUILD_REGION).
     * Sends the instance template chunks + XTEA keys before the teleport.
     * @param player The player to teleport
     * @param x Target tile X coordinate
     * @param y Target tile Y coordinate
     * @param level Target level/plane (0-3)
     * @param templateChunks 4×13×13 packed template chunk grid (-1 = empty)
     */
    /**
     * Spawn a loc at a world tile (LOC_ADD_CHANGE).
     * Sends the loc to all nearby players. Does not persist across server restarts.
     */
    spawnLoc?: (
        locId: number,
        tile: { x: number; y: number },
        level: number,
        shape: number,
        rotation: number,
    ) => void;
    /**
     * Spawn a loc for a specific player only (LOC_ADD_CHANGE).
     */
    spawnLocForPlayer?: (
        player: PlayerState,
        locId: number,
        tile: { x: number; y: number },
        level: number,
        shape: number,
        rotation: number,
    ) => void;
    teleportToInstance?: (
        player: PlayerState,
        x: number,
        y: number,
        level: number,
        templateChunks: number[][][],
        extraLocs?: Array<{ id: number; x: number; y: number; level: number; shape: number; rotation: number }>,
    ) => void;
    teleportToWorldEntity?: (
        player: PlayerState,
        x: number,
        y: number,
        level: number,
        entityIndex: number,
        configId: number,
        sizeX: number,
        sizeZ: number,
        templateChunks: number[][][],
        buildAreas: import("../../../../src/shared/worldentity/WorldEntityTypes").WorldEntityBuildArea[],
        extraLocs?: Array<{ id: number; x: number; y: number; level: number; shape: number; rotation: number }>,
    ) => void;
    sendWorldEntity?: (
        player: PlayerState,
        entityIndex: number,
        configId: number,
        sizeX: number,
        sizeZ: number,
        templateChunks: number[][][],
        buildAreas: import("../../../../src/shared/worldentity/WorldEntityTypes").WorldEntityBuildArea[],
        extraLocs?: Array<{ id: number; x: number; y: number; level: number; shape: number; rotation: number }>,
        extraNpcs?: Array<{ id: number; x: number; y: number; level: number }>,
        drawMode?: number,
    ) => void;
    /**
     * Schedule a teleport through the server action scheduler.
     * This is the canonical path for delayed teleports (spell casts, admin map teleports),
     * and includes anti-spam gating.
     */
    requestTeleportAction?: (
        player: PlayerState,
        request: {
            x: number;
            y: number;
            level: number;
            delayTicks?: number;
            cooldownTicks?: number;
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
            requireCanTeleport?: boolean;
            rejectIfPending?: boolean;
            replacePending?: boolean;
        },
    ) => { ok: boolean; reason?: string };
    /**
     * Send a varp (variable player) update to the client
     * @param player The player to send the update to
     * @param varpId The varp ID
     * @param value The new value
     */
    sendVarp?: (player: PlayerState, varpId: number, value: number) => void;
    /**
     * Send a varbit update to the client
     * @param player The player to send the update to
     * @param varbitId The varbit ID
     * @param value The new value
     */
    sendVarbit?: (player: PlayerState, varbitId: number, value: number) => void;
    /**
     * Queue a varp update to be sent to the client
     * @param playerId The player ID
     * @param varpId The varp ID
     * @param value The new value
     */
    queueVarp?: (playerId: number, varpId: number, value: number) => void;
    /**
     * Queue a varbit update to be sent to the client
     * @param playerId The player ID
     * @param varbitId The varbit ID
     * @param value The new value
     */
    queueVarbit?: (playerId: number, varbitId: number, value: number) => void;
    /**
     * Queue a widget event (run_script, open_sub, etc.)
     * @param playerId The player ID
     * @param event The widget event to queue
     */
    queueWidgetEvent?: (playerId: number, event: WidgetAction) => void;
    /**
     * Queue a custom notification payload to be sent to the client.
     * Used for server-driven toast notifications (gamemode tasks, etc.).
     */
    queueNotification?: (playerId: number, payload: any) => void;
    /**
     * Send the collection log inventory (620) snapshot to the client.
     * @param player The player to send the collection log to
     */
    sendCollectionLogSnapshot?: (player: PlayerState) => void;
    /**
     * Open the collection log interface (621) in mainmodal.
     * Sends the collection_transmit inventory and required varps first.
     * @param player The player to open the collection log for
     */
    openCollectionLog?: (player: PlayerState) => void;
    /**
     * Open the collection overview interface (908) in mainmodal.
     * @param player The player to open the collection overview for
     */
    openCollectionOverview?: (player: PlayerState) => void;
    /**
     * Populate collection log categories for a specific tab.
     * Creates widgets server-side since client scripts don't iterate over category enums.
     * @param player The player to populate categories for
     * @param tabIndex The tab index (0=Bosses, 1=Raids, 2=Clues, 3=Minigames, 4=Other)
     */
    populateCollectionLogCategories?: (player: PlayerState, tabIndex: number) => void;
    /**
     * Unequip an item from the given equipment slot and move it to inventory.
     * @param player The player to unequip from
     * @param slot The equipment slot to unequip
     * @returns true if unequip was successful, false otherwise
     */
    unequipItem?: (player: PlayerState, slot: number) => boolean;
    /**
     * Queue a client script to be executed on the client (rsmod parity).
     * This is the OSRS-parity way to trigger CS2 scripts from the server.
     * @param playerId The player ID to run the script for
     * @param scriptId The CS2 script ID to run
     * @param args Optional arguments to pass to the script
     */
    queueClientScript?: (playerId: number, scriptId: number, ...args: (number | string)[]) => void;
    /** Close the player's session (logout / disconnect). */
    logoutPlayer?: (player: PlayerState, reason?: string) => void;
    /** Access InterfaceService for server-managed modal interfaces (shops, banks, etc.). */
    getInterfaceService?: () => InterfaceService | undefined;
    /**
     * Open the remaining tab interfaces when the gamemode tutorial completes.
     * During the tutorial, only the Quest tab is shown. When the tutorial finishes,
     * this method opens all the other tabs (Combat, Skills, Inventory, etc.).
     * @param player The player to open tabs for
     */
    openRemainingTabs?: (player: PlayerState) => void;
    summonFollowerFromItem?: (
        player: PlayerState,
        itemId: number,
        npcTypeId: number,
    ) => { ok: true; npcId: number } | { ok: false; reason: string };
    pickupFollower?: (
        player: PlayerState,
        npcId: number,
    ) => { ok: true; itemId: number; npcTypeId: number } | { ok: false; reason: string };
    metamorphFollower?: (
        player: PlayerState,
        npcId: number,
    ) => { ok: true; npcId: number; npcTypeId: number } | { ok: false; reason: string };
    callFollower?: (
        player: PlayerState,
    ) => { ok: true; npcId: number } | { ok: false; reason: string };
    despawnFollowerForPlayer?: (playerId: number, clearPersistentState?: boolean) => boolean;
    spawnNpc?: (config: NpcSpawnConfig) => NpcState | undefined;
    removeNpc?: (npcId: number) => boolean;
    initSailingInstance?: (player: PlayerState) => void;
    disposeSailingInstance?: (player: PlayerState) => void;
    removeWorldEntity?: (playerId: number, entityIndex: number) => void;
    queueWorldEntityPosition?: (playerId: number, entityIndex: number, position: { x: number; y: number; z: number; orientation: number }) => void;
    setWorldEntityPosition?: (playerId: number, entityIndex: number, position: { x: number; y: number; z: number; orientation: number }) => void;
    queueWorldEntityMask?: (playerId: number, entityIndex: number, mask: { animationId?: number; sequenceFrame?: number; actionMask?: number }) => void;
    buildSailingDockedCollision?: () => void;
    gamemodeServices?: Record<string, unknown>;
    // --- Action handler services ---
    getNpc?: (id: number) => NpcState | undefined;
    getSkill?: (player: PlayerState, skillId: number) => { baseLevel: number; boost: number; xp?: number };
    isPlayerStunned?: (player: PlayerState) => boolean;
    isPlayerInCombat?: (player: PlayerState) => boolean;
    hasInventorySlot?: (player: PlayerState) => boolean;
    applyPlayerHitsplat?: (
        player: PlayerState,
        style: number,
        damage: number,
        tick: number,
    ) => { amount: number; style: number; hpCurrent: number; hpMax: number };
    stunPlayer?: (player: PlayerState, ticks: number) => void;
    queueNpcForcedChat?: (npc: NpcState, text: string) => void;
    queueNpcSeq?: (npc: NpcState, seqId: number) => void;
    faceNpcToPlayer?: (npc: NpcState, player: PlayerState) => void;
    clearPlayerFaceTarget?: (player: PlayerState) => void;
    scheduleAction?: (
        playerId: number,
        request: ActionRequest,
        tick: number,
    ) => { ok: boolean; reason?: string };
    getEquipArray?: (player: PlayerState) => number[];
    // --- Gathering / production skill services ---
    isAdjacentToLoc?: (player: PlayerState, locId: number, tile: { x: number; y: number }, level: number) => boolean;
    isAdjacentToNpc?: (player: PlayerState, npc: NpcState) => boolean;
    faceGatheringTarget?: (player: PlayerState, tile: { x: number; y: number }) => void;
    collectCarriedItemIds?: (player: PlayerState) => number[];
    addItemToBank?: (player: PlayerState, itemId: number, quantity: number) => boolean;
    findInventorySlotWithItem?: (player: PlayerState, itemId: number) => number | undefined;
    canStoreItem?: (player: PlayerState, itemId: number) => boolean;
    playerHasItem?: (player: PlayerState, itemId: number) => boolean;
    enqueueSoundBroadcast?: (soundId: number, x: number, y: number, level: number) => void;
    stopPlayerAnimation?: (player: PlayerState) => void;
    stopGatheringInteraction?: (player: PlayerState) => void;
    // --- Woodcutting depletion ---
    isWoodcuttingDepleted?: (key: string) => boolean;
    markWoodcuttingDepleted?: (info: {
        key: string; locId: number; stumpId: number;
        tile: { x: number; y: number }; level: number; treeId: string;
        respawnTicks?: { min: number; max: number };
    }, tick: number) => void;
    // --- Mining depletion ---
    isMiningDepleted?: (key: string) => boolean;
    markMiningDepleted?: (info: {
        key: string; locId: number; depletedLocId?: number;
        tile: { x: number; y: number }; level: number; rockId: string;
        respawnTicks?: { min: number; max: number };
    }, tick: number) => void;
    // --- Flax depletion ---
    isFlaxDepleted?: (tile: { x: number; y: number }, level: number) => boolean;
    markFlaxDepleted?: (info: {
        tile: { x: number; y: number }; level: number; locId: number; respawnTicks: number;
    }, tick: number) => void;
    // --- Firemaking ---
    isTileLit?: (tile: { x: number; y: number }, level: number) => boolean;
    isFiremakingTileBlocked?: (tile: { x: number; y: number }, level: number) => boolean;
    lightFire?: (params: {
        tile: { x: number; y: number }; level: number; logItemId: number;
        currentTick: number; burnTicks: { min: number; max: number };
        fireObjectId: number; previousLocId: number; ownerId: number;
    }) => { fireObjectId: number };
    playerHasTinderbox?: (player: PlayerState) => boolean;
    consumeFiremakingLog?: (player: PlayerState, logId: number, slotIndex?: number) => number | undefined;
    walkPlayerAwayFromFire?: (player: PlayerState, fireTile: { x: number; y: number }) => void;
    // --- Recipe lookups (for echo perk auto-cook) ---
    getCookingRecipeByRawItemId?: (itemId: number) => { cookedItemId: number; xp: number } | undefined;
    // --- Inventory restore ---
    restoreInventoryItems?: (player: PlayerState, itemId: number, removed: Map<number, number>) => void;
}
