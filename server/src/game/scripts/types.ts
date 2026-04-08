import { type ActionEffect, type ActionEnqueueResult, type ActionExecutionResult, type ActionKind, type ActionRequest } from "../actions";
import { type NpcSpawnConfig, type NpcState } from "../npc";
import { type PlayerState } from "../player";

export const ANY_ITEM_ID = -1;
export const ANY_LOC_ID = -1;

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

export interface ScriptDialogOptionRequest {
    id: string;
    title?: string;
    options: string[];
    modal?: boolean;
    disabledOptions?: boolean[];
    onSelect: (choiceIndex: number) => void;
    onClose?: () => void;
}

export const ScriptDialogKind = {
    Npc: "npc",
    Player: "player",
    Sprite: "sprite",
    DoubleSprite: "double_sprite",
} as const;
export type ScriptDialogKind = (typeof ScriptDialogKind)[keyof typeof ScriptDialogKind];

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

export { type BankingServices, type ShoppingServices, type GatheringServices, type WidgetCloseHandler, type WidgetOpenHandler, type ModalActionHandler } from "./serviceInterfaces";
export { DisplayMode, BaseComponentUids, type InterfaceMount, type SmithingOptionMessage, type SmithingServerPayload, type WidgetAction } from "./serviceInterfaces";
export { getMainmodalUid, getSidemodalUid, getPrayerTabUid, getViewportTrackerFrontUid } from "../../widgets/viewport";
export type { DoorToggleResult, GateDef, GatePair, GateOpenStyle, DoorPartnerResult } from "./serviceInterfaces";
export type { FollowerItemDefinition } from "./serviceInterfaces";

// Re-exports for gamemode consumption (avoid reaching into core impl files)
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
} from "./serviceInterfaces";
export { getAccountSummaryTimeMinutes } from "./serviceInterfaces";
export { getTeleportByWidgetId, getSpellWidgetId } from "./serviceInterfaces";
export type { TeleportSpellData } from "./serviceInterfaces";
export { WaitCondition } from "./serviceInterfaces";
export { HOME_TELEPORT_TIMER } from "./serviceInterfaces";
export { RuneValidator } from "./serviceInterfaces";
export type { RuneInventoryItem, RuneValidationResult, SkillBoltEnchantActionData } from "./serviceInterfaces";
export { getItemDefinition, loadItemDefinitions } from "./serviceInterfaces";
export type { ItemDefinition, WeaponInterface } from "./serviceInterfaces";
export { damageTracker, multiCombatSystem } from "./serviceInterfaces";
export type { DropEligibility, NpcLootConfig } from "./serviceInterfaces";
export { applyAutocastState, clearAutocastState } from "./serviceInterfaces";
export { getEmoteSeq, getSkillcapeSeqId, getSkillcapeSpotId } from "./serviceInterfaces";

import type { GatheringServices, MessagingFacade, VariableFacade, SkillFacade, DataLoaderFacade, SystemFacade, InventoryFacade, EquipmentFacade, AnimationFacade, SoundFacade, AppearanceFacade, DialogFacade, MovementFacade, LocationFacade, CombatFacade, NpcFacade, CollectionLogFacade, ViewportFacade, FollowerServiceFacade, ProductionServiceFacade, SailingServiceFacade, BankingServices, ShoppingServices, WidgetCloseHandler, WidgetOpenHandler, ModalActionHandler } from "./serviceInterfaces";

export interface ScriptServices extends GatheringServices {
    messaging: MessagingFacade;
    variables: VariableFacade;
    skills: SkillFacade;
    data: DataLoaderFacade;
    system: SystemFacade;
    inventory: InventoryFacade;
    equipment: EquipmentFacade;
    animation: AnimationFacade;
    sound: SoundFacade;
    appearance: AppearanceFacade;
    dialog: DialogFacade;
    movement: MovementFacade;
    location: LocationFacade;
    combat: CombatFacade;
    npc: NpcFacade;
    collectionLog: CollectionLogFacade;
    viewport: ViewportFacade;
    // Gamemode-contributed (optional, populated by contributeScriptServices)
    followers?: FollowerServiceFacade;
    production?: ProductionServiceFacade;
    sailing?: SailingServiceFacade;
    banking?: BankingServices;
    shopping?: ShoppingServices;
    widgetCloseHandlers?: Map<number, WidgetCloseHandler>;
    widgetOpenHandlers?: Map<number, WidgetOpenHandler>;
    modalActionHandlers?: Map<number, ModalActionHandler>;
}
