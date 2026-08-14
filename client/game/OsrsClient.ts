import { vec3 } from "gl-matrix";

import { directionToDelta } from "../common/Direction";
import { ChatMessageType } from "../common/chat/ChatMessageType";
import type { ProjectileLaunch } from "../common/projectiles/ProjectileLaunch";
import { buildSelectedSpellPayload } from "../common/spells/selectedSpellPayload";
import type { QuestListWidgetGroup } from "../common/ui/questList";
import {
    INTERFACE_ACHIEVEMENT_DIARY_ID,
    INTERFACE_QUEST_LIST_ID,
    SIDE_JOURNAL_GROUP_ID,
} from "../common/ui/sideJournal";
import { ITEM_SPAWNER_MODAL_GROUP_ID } from "../common/ui/widgets";
import { isMobileMode, isTouchDevice } from "../common/utils/DeviceUtil";
import { clamp } from "../common/utils/MathUtil";
import {
    TRANSMIT_VARPS,
    VARBIT_COMBATLEVEL_TRANSMIT,
    VARBIT_LEAGUE_MAGIC_MASTERY,
    VARBIT_LEAGUE_MELEE_MASTERY,
    VARBIT_LEAGUE_RANGED_MASTERY,
    VARBIT_LEAGUE_RELIC_1,
    VARBIT_LEAGUE_RELIC_2,
    VARBIT_LEAGUE_RELIC_3,
    VARBIT_LEAGUE_RELIC_4,
    VARBIT_LEAGUE_RELIC_5,
    VARBIT_LEAGUE_RELIC_6,
    VARBIT_LEAGUE_RELIC_7,
    VARBIT_LEAGUE_RELIC_8,
    VARBIT_ROOF_REMOVAL,
    VARBIT_STAMINA_ACTIVE,
    VARC_COMBAT_LEVEL,
    VARP_AREA_SOUNDS_VOLUME,
    VARP_ATTACK_STYLE,
    VARP_MAP_FLAGS_CACHED,
    VARP_MASTER_VOLUME,
    VARP_MUSIC_VOLUME,
    VARP_OPTION_ATTACK_PRIORITY_NPC,
    VARP_OPTION_ATTACK_PRIORITY_PLAYER,
    VARP_OPTION_RUN,
    VARP_SOUND_EFFECTS_VOLUME,
} from "../common/vars";
import {
    getDefaultServerAddress,
    getDefaultServerName,
    getDefaultServerSecure,
    getDefaultWsUrl,
} from "../config/clientEnv";
import {
    type BankServerUpdate,
    getClientCycle,
    getCurrentTick,
    getServerTickPhaseNow,
    isServerConnected,
    sendFaceTile,
    sendFriendsChatAction,
    sendGroundItemAction,
    sendIfTriggerOpLocal,
    sendInventoryMove,
    sendInventoryUse,
    sendInventoryUseOn,
    sendNpcOption,
    sendPlayerOption,
    sendVarpTransmit,
    sendWidgetAction,
    sendWidgetClose,
    setClientCycleProvider,
    subscribeAnim,
    subscribeBank,
    subscribeChatMessages,
    subscribeCollectionLog,
    subscribeCombat,
    subscribeDisconnect,
    subscribeGroundItems,
    subscribeFriendsChat,
    subscribeHandshake,
    subscribeInventory,
    subscribeNotifications,
    subscribeNpcInfo,
    subscribePlayJingle,
    subscribePlaySong,
    subscribePlayerSync,
    subscribeRebuildNormal,
    subscribeRebuildRegion,
    subscribeRebuildWorldEntity,
    subscribeReconnectFailed,
    subscribeRunEnergy,
    subscribeServerPath,
    subscribeShop,
    subscribeSkills,
    subscribeSound,
    subscribeSpellResults,
    subscribeSpot,
    subscribeTick,
    subscribeTrade,
    subscribeWelcome,
    subscribeWidgetEvents,
    subscribeWorldEntityInfo,
} from "../network/ServerConnection";
import type { WorldEntityInfoPayload } from "../network/ServerConnection";
import type {
    CollectionLogServerPayload,
    HitsplatServerPayload,
    InventoryServerUpdate,
    NpcInfoPayload,
    ShopWindowState,
    SpellResultPayload,
    SpotAnimationPayload,
    TradeWindowState,
    WidgetActionClientPayload,
} from "../network/ServerConnection";
import {
    sendEmote as netSendEmote,
    sendBankCustomQuantity,
    sendLogin,
    sendLogout,
    sendResumeNameDialog,
    sendResumeStringDialog,
    sendTradeAccept,
    sendTradeConfirmAccept,
    sendTradeConfirmDecline,
    sendTradeDecline,
    sendTradeOffer,
    sendTradeRemove,
    subscribeLogoutResponse,
    suppressReconnection,
} from "../network/ServerConnection";
import {
    getLastUrl,
    registerAnimDebugProvider,
    setServerUrl,
    subscribeProjectiles,
} from "../network/ServerConnection";
import { ClientPacketId, createPacket, queuePacket } from "../network/packet";
import { WebGLMapSquare } from "../render/WebGLMapSquare";
import type { MinimapIcon } from "../render/loader/SdMapData";
import type { NpcInstance } from "../render/npc/NpcRenderTemplate";
import { MenuTargetType, type OsrsMenuEntry } from "../rs/MenuEntry";
import { SoundEffectLoader } from "../rs/audio/SoundEffectLoader";
import { CacheSystem } from "../rs/cache/CacheSystem";
import { ConfigType } from "../rs/cache/ConfigType";
import { IndexType } from "../rs/cache/IndexType";
import { CacheLoaderFactory, getCacheLoaderFactory } from "../rs/cache/loader/CacheLoaderFactory";
import { getPlayerTypeInfo } from "../rs/chat/PlayerType";
import { BasTypeLoader } from "../rs/config/bastype/BasTypeLoader";
import { DbRepository } from "../rs/config/db/DbRepository";
import { IdkTypeLoader } from "../rs/config/idktype/IdkTypeLoader";
import { LocTypeLoader } from "../rs/config/loctype/LocTypeLoader";
import {
    ArchiveMapElementTypeLoader,
    type MapElementTypeLoader,
} from "../rs/config/meltype/MapElementTypeLoader";
import { NpcTypeLoader } from "../rs/config/npctype/NpcTypeLoader";
import { ObjModelLoader } from "../rs/config/objtype/ObjModelLoader";
import { ObjTypeLoader } from "../rs/config/objtype/ObjTypeLoader";
import { EquipToDisplaySlot, EquipmentSlot } from "../rs/config/player/Equipment";
import { PlayerAppearance } from "../rs/config/player/PlayerAppearance";
import type { SeqSoundEffect, SeqType } from "../rs/config/seqtype/SeqType";
import { SeqTypeLoader } from "../rs/config/seqtype/SeqTypeLoader";
import { SpotAnimTypeLoader } from "../rs/config/spotanimtype/SpotAnimTypeLoader";
import { VarManager } from "../rs/config/vartype/VarManager";
import { chatHistory } from "../rs/cs2/ChatHistory";
import { Cs2Vm, ScriptArgMagic, type ScriptEvent, createScriptEvent } from "../rs/cs2/Cs2Vm";
import { Opcodes as Cs2Opcodes } from "../rs/cs2/Opcodes";
import { BitmapFont } from "../rs/font/BitmapFont";
import { encodeInteractionIndex } from "../rs/interaction/InteractionIndex";
import { Inventory, InventorySlotInput } from "../rs/inventory/Inventory";
import type { InventorySlot } from "../rs/inventory/Inventory";
import {
    MapFileIndex,
    getMapIndexFromTile,
    getMapPlaneId,
    getMapSquareId,
} from "../rs/map/MapFileIndex";
import { WorldMapState } from "../rs/map/WorldMapArea";
import { SeqFrameLoader } from "../rs/model/seq/SeqFrameLoader";
import type { SkeletalSeqLoader } from "../rs/model/skeletal/SkeletalSeqLoader";
import { SkillId } from "../rs/skill/skills";
import { TextureLoader } from "../rs/texture/TextureLoader";
import { faceAngleRs } from "../rs/utils/rotation";
import { getOsrsInterfaceScalingPercent, setOsrsInterfaceScalingPercent } from "../ui/UiScale";
import {
    setNpcExamineIdResolver,
    setSpellSelectionClearHandler,
    setSpellSelectionResolver,
} from "../ui/menu/MenuAction";
import { type SimpleMenuEntry } from "../ui/menu/MenuEngine";
import { MenuOpcode, MenuState } from "../ui/menu/MenuState";
import { isDropTarget, isWidgetUseTarget } from "../widgets/WidgetFlags";
import { markWidgetInteractionDirty } from "../widgets/WidgetInteraction";
import { WidgetManager } from "../widgets/WidgetManager";
import { WidgetSessionManager } from "../widgets/WidgetSessionManager";
import { applyQuestListWidgetGroups } from "../widgets/custom/questList";
import { cleanupInterfaceClickTargets } from "../widgets/gl/widgets-gl";
import { layoutWidgets } from "../widgets/layout/WidgetLayout";
import { sanitizeText } from "../widgets/menu/utils";
import { Js5RangeClient } from "../rs/cache/js5/Js5RangeClient";
import { PresenceBitset } from "../rs/cache/js5/PresenceBitset";
import { SparseMemoryStore } from "../rs/cache/store/SparseMemoryStore";
import { CacheList, LoadedCache, getSparsePersistence } from "./Caches";
import { Camera, CameraView, ProjectionType } from "./Camera";
import {
    ClientState,
    DEFAULT_SCREEN_HEIGHT,
    DEFAULT_SCREEN_WIDTH,
    MOUSE_CROSS_YELLOW,
} from "./ClientState";
import { GameRenderer } from "./GameRenderer";
import { OsrsRendererType, createRenderer } from "./GameRenderers";
import { InputManager } from "./InputManager";
import { MapManager } from "./MapManager";
import { PlayerAnimController } from "./PlayerAnimController";
import {
    type TransmitCycles,
    getTransmitCycles,
    isTransmitProcessingNeeded,
    markChatTransmit,
    markClanTransmit,
    markFriendTransmit,
    markInvTransmit,
    markMiscTransmit,
    markStatTransmit,
    markVarTransmit,
    markWidgetsLoaded,
    resetTransmitCycles,
    resetTransmitDirtyFlags,
} from "./TransmitCycles";
import { AudioVarpController } from "./audio/AudioVarpController";
import { MusicSystem } from "./audio/MusicSystem";
import { type SequenceSoundContext, SoundEffectSystem } from "./audio/SoundEffectSystem";
import { ChatTextMetrics } from "./chat/ChatTextMetrics";
import { EnterToTypeChat } from "./chat/EnterToTypeChat";
import { MobileChatKeyboard } from "./chat/MobileChatKeyboard";
import { CombatOptionsController } from "./combat/CombatOptionsController";
import { HitsplatFlushController } from "./combat/HitsplatFlushController";
import { ClientScriptLoader } from "./cs2/ClientScriptLoader";
import {
    ClientGroundItemStack,
    GroundItemOverlayEntry,
    GroundItemStore,
} from "./data/ground/GroundItemStore";
import { NpcEcs } from "./ecs/NpcEcs";
import { PlayerEcs } from "./ecs/PlayerEcs";
import { TileHighlightManager } from "./highlights/TileHighlightManager";
import { PlayerInteractionSystem } from "./interactions/PlayerInteractionSystem";
import { IProjectileManager } from "./interfaces/IProjectileManager";
import {
    GameState,
    type LoginAction,
    LoginErrorCode,
    LoginIndex,
    LoginRenderer,
    LoginState,
    isLoginMusicState,
    shouldFadeOutLoginMusicForTransition,
    shouldStartScheduledLoginMusic,
} from "./login";
import { NpcMovementSync } from "./movement/NpcMovementSync";
import { PlayerMovementSync } from "./movement/PlayerMovementSync";
import { NpcInstanceFlushController } from "./npc/NpcInstanceFlushController";
import { createBrowserGroundItemsPluginPersistence } from "./plugins/grounditems/BrowserGroundItemsPluginPersistence";
import { GroundItemsPlugin } from "./plugins/grounditems/GroundItemsPlugin";
import { createBrowserInteractHighlightPluginPersistence } from "./plugins/interacthighlight/BrowserInteractHighlightPluginPersistence";
import { InteractHighlightPlugin } from "./plugins/interacthighlight/InteractHighlightPlugin";
import { createBrowserNotesPluginPersistence } from "./plugins/notes/BrowserNotesPluginPersistence";
import { NotesPlugin } from "./plugins/notes/NotesPlugin";
import { createBrowserRememberLoginPluginPersistence } from "./plugins/rememberlogin/BrowserRememberLoginPluginPersistence";
import { RememberLoginPlugin } from "./plugins/rememberlogin/RememberLoginPlugin";
import { createBrowserTileMarkersPluginPersistence } from "./plugins/tilemarkers/BrowserTileMarkersPluginPersistence";
import { TileMarkersPlugin } from "./plugins/tilemarkers/TileMarkersPlugin";
import { ResolveTilePlaneFn } from "./scene/PlaneResolver";
import {
    createSelectedSpellOnGroundItemPacket,
    createSelectedSpellOnLocPacket,
    createSelectedSpellOnNpcPacket,
    createSelectedSpellOnPlayerPacket,
    createSelectedSpellOnWidgetPacket,
} from "./selectedSpellPackets";
import { createBrowserSidebarPersistence } from "./sidebar/BrowserSidebarPersistence";
import { SidebarStore } from "./sidebar/SidebarStore";
import {
    type ClientSidebarEntryData,
    type SidebarPluginVisibilityOptions,
    registerDefaultClientSidebarEntries,
} from "./sidebar/entries";
import {
    GameStateMachine,
    LoadingRequirement,
    LoadingTracker,
    type StateTransition,
} from "./state";
import { initPlayerSyncHuffman } from "./sync/HuffmanProvider";
import { NpcUpdateDecoder } from "./sync/NpcUpdateDecoder";
import { PlayerSyncManager } from "./sync/PlayerSyncManager";
import type { PlayerSpotAnimationEvent } from "./sync/PlayerSyncTypes";
import { resolveTradeActionQuantity } from "./trade/TradeActionQuantity";
import { clampPlane } from "./utils/PlaneUtil";
import { VarcPersistence } from "./vars/VarcPersistence";
import { NotificationDisplay } from "./widgets/NotificationDisplay";
import { PlayerDesignController } from "./widgets/PlayerDesignController";
import { SpellSelectionController } from "./widgets/SpellSelectionController";
import {
    type SelectedSpellInfo,
    type SpellSelectionState,
    WidgetActionRouter,
} from "./widgets/WidgetActionRouter";
import { WidgetInputController } from "./widgets/WidgetInputController";
import { WidgetInteractionController } from "./widgets/WidgetInteractionController";
import { WidgetTransmitProcessor } from "./widgets/WidgetTransmitProcessor";
import { ItemSpawnerUi } from "./widgets/itemSpawner";
import { resolveWidgetIdentifiers } from "./widgets/widgetActionPayload";
import { RenderDataWorkerPool } from "./worker/RenderDataWorkerPool";
import { WorldMapController, type WorldMapRenderedIcon } from "./worldMap/WorldMapController";
import { WorldViewManager } from "./worldview/WorldViewManager";

const DEVICE_OPTION_INTERFACE_SCALING = 27;

// OSRS draw distance is constrained in Scene.setDrawDistanceRaw(25..90).
const MIN_RENDER_DISTANCE = 25;
const MAX_RENDER_DISTANCE = 90;
const DEFAULT_RENDER_DISTANCE = MIN_RENDER_DISTANCE;
const DEFAULT_FPS_LIMIT = 240;
const MOBILE_MAX_RESIDENT_MAPS = 48;
const MAP_SQUARE_SIZE_TILES = 64;
const MAP_SQUARE_CENTER_TO_EDGE_TILES = 32;
const MAX_DEFAULT_MAP_RADIUS = 7;

function deriveMapRadiusFromRenderDistance(renderDistanceTiles: number): number {
    const d = Math.max(0, renderDistanceTiles | 0);
    const r = Math.ceil((d + MAP_SQUARE_CENTER_TO_EDGE_TILES) / MAP_SQUARE_SIZE_TILES);
    return Math.max(0, Math.min(MAX_DEFAULT_MAP_RADIUS, r | 0));
}

function deriveLodDistanceFromRenderDistance(renderDistanceTiles: number): number {
    // Tile-based threshold: keep nearby tiles in full detail.
    return Math.max(0, (renderDistanceTiles | 0) - 2);
}

function clampRenderDistance(value: number): number {
    return clamp(value | 0, MIN_RENDER_DISTANCE, MAX_RENDER_DISTANCE);
}

// Fallback non-scene-base map streaming defaults (used before first authoritative scene base).
// 0 = 1 map, 1 = 3x3, 2 = 5x5.
const DEFAULT_MAP_RADIUS = deriveMapRadiusFromRenderDistance(DEFAULT_RENDER_DISTANCE);
const DEFAULT_LOD_DISTANCE = deriveLodDistanceFromRenderDistance(DEFAULT_RENDER_DISTANCE);

const VARBIT_ACCOUNT_TYPE = 1777;
const VARBIT_POPOUT_OPEN = 13090;
const VARBIT_POPOUT_PANEL_DESKTOP_DISABLED = 13982;
const ACCOUNT_TYPE_MAIN = 0;
const SCRIPT_HIGHLIGHT_SCREEN_COMPONENT = 2463;
const SCRIPT_HIGHLIGHT_TEXTBOX_DEFAULT = 2465;

// Use shared OSRS rotation scale

export class OsrsClient {
    private static readonly CLIENT_TICK_MS = 20;
    // Maximum amount of client-tick backlog (in ms) we will attempt to simulate.
    // This avoids multi-second/minute "catch-up" after sleep/throttling while still allowing
    // the client tick loop to keep NPC/player step queues drained during normal background
    // timer clamping (commonly ~1000ms intervals).
    private static readonly MAX_CLIENT_TICK_BACKLOG_MS = 2000;
    // Keep a conservative upper bound per slice to avoid long main-thread stalls if the tab is
    // throttled/suspended and then resumes with a large tick debt.
    // /perf: cap catch-up to avoid huge tick bursts after background-tab timer throttling.
    // The official client never tries to "fast forward" thousands of 20ms cycles in one go.
    private static readonly MAX_CLIENT_TICKS_PER_SLICE = 50;

    private syncSidebarPlugins(force = false): void {
        const visibility: Required<SidebarPluginVisibilityOptions> = {
            groundItemsEnabled: this.groundItemsPlugin.getConfig().enabled,
            interactHighlightEnabled: this.interactHighlightPlugin.getConfig().enabled,
            notesEnabled: this.notesPlugin.getConfig().enabled,
            tileMarkersEnabled: this.tileMarkersPlugin.getConfig().enabled,
        };

        if (
            !force &&
            this.sidebarPluginVisibility.groundItemsEnabled === visibility.groundItemsEnabled &&
            this.sidebarPluginVisibility.interactHighlightEnabled ===
                visibility.interactHighlightEnabled &&
            this.sidebarPluginVisibility.notesEnabled === visibility.notesEnabled &&
            this.sidebarPluginVisibility.tileMarkersEnabled === visibility.tileMarkersEnabled
        ) {
            return;
        }

        this.sidebarPluginVisibility = visibility;
        registerDefaultClientSidebarEntries(this.sidebar, visibility);
    }

    inputManager: InputManager = new InputManager();
    camera: Camera = new Camera(3242, -26, 3202, 245, 1862);

    renderer: GameRenderer;

    cs2Vm!: Cs2Vm;
    fontCache: Map<number, BitmapFont> = new Map();

    private readonly resolvePlayerPlane: ResolveTilePlaneFn = (_tileX, _tileY, plane) =>
        clampPlane(plane);

    // Cache (optional until initCache is called)
    loadedCache?: LoadedCache;
    cacheSystem!: CacheSystem;
    /** On-demand cache group fetcher; set when the cache was loaded sparsely. */
    js5?: Js5RangeClient;
    private js5SweepTimer?: ReturnType<typeof setInterval>;
    loaderFactory!: CacheLoaderFactory;
    widgetManager!: WidgetManager;
    widgetSessionManager!: WidgetSessionManager;

    textureLoader!: TextureLoader;
    seqTypeLoader!: SeqTypeLoader;
    seqFrameLoader!: SeqFrameLoader;
    skeletalSeqLoader?: SkeletalSeqLoader;
    worldEntityTypeLoader?: import("../rs/config/worldentitytype/WorldEntityTypeLoader").WorldEntityTypeLoader;
    readonly worldViewManager: WorldViewManager = new WorldViewManager();
    spotAnimTypeLoader!: SpotAnimTypeLoader;

    locTypeLoader!: LocTypeLoader;
    mapElementTypeLoader?: MapElementTypeLoader;
    objTypeLoader!: ObjTypeLoader;
    objModelLoader!: ObjModelLoader;
    npcTypeLoader!: NpcTypeLoader;
    soundEffectLoader?: SoundEffectLoader;
    soundEffectSystem?: SoundEffectSystem;
    musicSystem?: MusicSystem;

    // Master volume multiplier (0-1, from deviceoption 19)
    // Individual volumes are multiplied by this value
    masterVolume: number = 1;
    // Track individual volume levels (0-1) before master multiplier
    // Default values match enum_981 lookups for varp default of 100 (full volume)
    private _musicVolume: number = 1.0; // enum_981(100) = 100
    private _sfxVolume: number = 1.0; // enum_981(100) = 100
    private _ambientVolume: number = 1.0; // enum_981(100) = 100

    // Client/Game/Device options storage (for clientoption/gameoption/deviceoption CS2 opcodes)
    // These store engine-level settings like audio volume, brightness, etc.
    clientOptions: Map<number, number> = new Map();
    gameOptions: Map<number, number> = new Map();
    deviceOptions: Map<number, number> = new Map();

    // Client-side gameplay/UI preferences that affect input semantics.
    // Exposed for UI semantics (e.g., Shift-click Drop, tap-to-drop, left-click menu).
    settings: {
        shiftClickEnabled: boolean;
        leftClickOpensMenu: boolean;
        tapToDrop: boolean;
    } = {
        shiftClickEnabled: true,
        leftClickOpensMenu: false,
        tapToDrop: false,
    };
    minimenuBlockModes: number[] = [];
    minimenuOrderEdit: boolean = false;
    minimenuScrollEnabled: boolean = false;

    basTypeLoader!: BasTypeLoader;
    idkTypeLoader!: IdkTypeLoader;

    varManager!: VarManager;
    private readonly varcPersistence: VarcPersistence;

    // Transmit cycles for engine-level event gating
    // See TransmitCycles.ts for documentation on how OSRS gates transmit handlers
    // IMPORTANT: Use getTransmitCycles() to get the global singleton, not createTransmitCycles()!
    // This ensures CLIENTCLOCK opcode and OsrsClient use the same cycleCntr.
    transmitCycles: TransmitCycles = getTransmitCycles();

    // Local player name (from server handshake)
    localPlayerName: string = "";
    localPlayerIsAdmin: boolean = false;
    private localChatNameIcons: number[] = [];
    private localChatNamePrefix: string = "";
    private readonly tradeRequestTargetsByName = new Map<string, number>();
    private accountTypeVarbitAvailable?: boolean;

    // ========== Game State ==========
    /** Centralized game state machine */
    readonly stateMachine: GameStateMachine = new GameStateMachine();

    /** Loading requirement tracker for login transitions */
    readonly loadingTracker: LoadingTracker = new LoadingTracker();

    /** Renderer-agnostic sidebar state/registry. */
    readonly sidebar: SidebarStore<ClientSidebarEntryData>;
    readonly groundItemsPlugin: GroundItemsPlugin;
    readonly interactHighlightPlugin: InteractHighlightPlugin;
    readonly notesPlugin: NotesPlugin;
    readonly rememberLoginPlugin: RememberLoginPlugin;
    readonly tileMarkersPlugin: TileMarkersPlugin;
    readonly tileHighlightManager: TileHighlightManager = new TileHighlightManager();
    private sidebarPluginVisibility: Required<SidebarPluginVisibilityOptions> = {
        groundItemsEnabled: true,
        interactHighlightEnabled: true,
        notesEnabled: true,
        tileMarkersEnabled: true,
    };

    /** Current game state (getter for backwards compatibility) */
    get gameState(): GameState {
        return this.stateMachine.getState();
    }

    // ========== Login System (Instance-based) ==========
    /** Login screen state */
    loginState: LoginState = new LoginState();
    /** Login screen renderer */
    loginRenderer: LoginRenderer = new LoginRenderer();

    mapFileIndex!: MapFileIndex;

    // Model loader for building runtime models (used by player pipeline)
    modelLoader!: import("../rs/model/ModelLoader").ModelLoader;

    isNewTextureAnim: boolean = false;

    // Settings

    // Scene draw distance (OSRS preference range 25..90), consumed as tile budget in this renderer.
    renderDistance: number = DEFAULT_RENDER_DISTANCE;
    // Map square radius around player to keep loaded (0 = 1 map, 1 = 3x3 grid, 2 = 5x5 grid)
    mapRadius: number = DEFAULT_MAP_RADIUS;
    // OSRS top-level map loader expanded loading level (0..5), 8-tile steps.
    expandedMapLoading: number = 0;
    // Tile distance threshold for switching to LOD geometry.
    lodDistance: number = DEFAULT_LOD_DISTANCE;

    targetFps: number = DEFAULT_FPS_LIMIT;
    mobileEffectiveResolutionScale: number = 1;

    tooltips: boolean = !isTouchDevice;
    /**
     * Minimap zoom value (CS2 `minimap_getzoom` / `minimap_setzoom`).
     * OSRS stores the value in the 2..8 range and wheel input moves it by 0.25.
     */
    minimapZoom: number = 4;
    minimapZoomEnabled: boolean = false;
    minimapIconZoomLimit: number = 2;
    /**
     * Runtime flag controlled by CS2 (SETSHOWMOUSEOVERTEXT) to toggle mouseover text display.
     * Default true.
     */
    showMouseOverText: boolean = true;

    /**
     * Mouse camera enabled/disabled (set by MOUSECAM opcode).
     * When false, disables mouse-based camera rotation.
     */
    mouseCamEnabled: boolean = true;

    /**
     * Render local player model in the 3D scene (set by RENDERSELF opcode).
     * Default true per OSRS reference.
     */
    renderSelf: boolean = true;

    /**
     * Mobile feedback ripple effect enabled (set by SETFEEDBACKSPRITE).
     * When true, shows ripple/circle effect on click instead of cross.
     */
    feedbackShowRipple: boolean = false;

    /**
     * Mobile feedback popup text enabled (set by SETFEEDBACKSHOWPOPUPTEXT).
     * When true, shows popup text on action feedback (mobile only).
     */
    feedbackShowPopupText: boolean = false;

    // Track last server-aligned cast spot start tick per player to sync projectile release
    private lastCastSpotStartCycleByPlayer: Map<number, number> = new Map();
    // Track last active spot animation id per player for telemetry parity
    private lastSpotGraphicByPlayer: Map<number, number> = new Map();
    debugId: boolean = true;

    // State

    menuOpen: boolean = false;
    menuOpenedFrame: number = 0;
    menuJustClosed: boolean = false; // Set when menu closes, cleared after one frame to skip input
    menuX: number = -1;
    menuY: number = -1;
    menuTile?: { tileX: number; tileY: number; plane?: number };
    menuEntries: OsrsMenuEntry[] = [];
    // When a right-click (pinned) Choose Option menu is opened, capture the entries
    // at that moment so the list remains stable even if targets move while open.
    menuPinnedEntries?: OsrsMenuEntry[];
    // Track a version counter so cached GL menu entries can detect context changes.
    menuPinnedEntriesVersion: number = 0;
    // Cached GL-friendly entries built when the menu is pinned; reused across frames.
    menuFrozenSimpleEntries?: SimpleMenuEntry[];
    menuFrozenSimpleEntriesVersion: number = 0;
    menuActiveSimpleEntries: SimpleMenuEntry[] = [];
    menuState: MenuState = new MenuState();

    debugText?: string;

    // Hovered tile state (for devoverlay label)
    hoveredTile?: { tileX: number; tileY: number; plane?: number };
    hoveredTileScreen?: { x: number; y: number };

    runMode: boolean = true; // Start as run mode to match orb's visual state because run is enabled by default on first login.
    private runEnergyPercent: number = 100; // Run energy 0-100, synced from server
    private runEnergyUnits: number = 10000; // Run energy 0-10000, used by CS2 RUNENERGY opcode
    private playerWeight: number = 0; // Player weight in kg, used by CS2 RUNWEIGHT_VISIBLE opcode
    private specialEnergyPercent: number = 100;
    private specialAttackEnabled: boolean = false;
    /** Flag to prevent varp changes from server sync being sent back to server */
    private _serverVarpSync: boolean = false;

    // Feature toggles
    hoverOverlayEnabled: boolean = false;

    // DevTools: show object id labels per tile
    showObjectTileIds: boolean = false;
    // DevTools: walkable collision devoverlay
    showCollisionOverlay: boolean = false;
    collisionOverlayRadius: number = 12;
    collisionOverlayMode: "tiles" | "edges" | "both" = "tiles";
    // DevTools: show server path waypoints overlay
    showServerPathOverlay: boolean = true;
    private serverPathWaypoints?: { x: number; y: number }[];

    getServerPathWaypoints(): { x: number; y: number }[] | undefined {
        return this.serverPathWaypoints ? this.serverPathWaypoints.slice() : undefined;
    }

    /**
     * Removes waypoints from the front of the path that the player has already walked.
     * Called each tick to keep the debug overlay in sync with player position.
     * Handles running (2 tiles/tick) by finding the player's position in the path
     * and removing all waypoints up to and including it.
     */
    private pruneWalkedWaypoints(): void {
        if (!this.serverPathWaypoints || this.serverPathWaypoints.length === 0) return;
        const serverId = this.controlledPlayerServerId | 0;
        if (!(serverId >= 0)) return;
        const state = this.playerMovementSync?.getState?.(serverId);
        if (!state) return;
        const px = state.tileX | 0;
        const py = state.tileY | 0;
        // Find the furthest waypoint the player has reached (handles running/skipping tiles)
        let removeUpTo = -1;
        for (let i = 0; i < this.serverPathWaypoints.length; i++) {
            const wp = this.serverPathWaypoints[i];
            if ((wp.x | 0) === px && (wp.y | 0) === py) {
                removeUpTo = i;
            }
        }
        // Remove all waypoints up to and including the one the player is on
        if (removeUpTo >= 0) {
            this.serverPathWaypoints.splice(0, removeUpTo + 1);
        }
        // Clear the array reference if empty so overlay knows path is done
        if (this.serverPathWaypoints.length === 0) {
            this.serverPathWaypoints = undefined;
        }
    }

    // Custom world labels rendered as UI overlays (e.g., named markers)
    customLabels: { x: number; y: number; text: string }[] = [];
    customLabelScreens: { x: number; y: number; text: string }[] = [];

    groundItems: GroundItemStore = new GroundItemStore();
    private groundItemOverlayCache?:
        | {
              key: string;
              entries: GroundItemOverlayEntry[];
          }
        | undefined;

    // Pending widget action for input dialogs (Withdraw-X, Deposit-X, etc.)
    // When a CS2 script opens an input dialog, the widget action is deferred until dialog completion
    private pendingInputDialogAction: {
        payload: any;
        option: string;
    } | null = null;
    /** Trade Offer-X/Remove-X action awaiting a native chatbox count dialog. */
    private pendingTradeQuantityAction: {
        action: "offer" | "remove";
        slot: number;
        itemId: number;
        maximum: number;
    } | null = null;

    /** Render-facing state for the native-looking Offer-X/Remove-X chat overlay. */
    isTradeQuantityInputActive(): boolean {
        return this.pendingTradeQuantityAction !== null && this.cs2Vm.inputDialogType > 0;
    }
    // RuneLite-style press-enter-to-type (desktop) + mobile soft-keyboard bridge.
    private enterToTypeChat!: EnterToTypeChat;
    private mobileChatKeyboard!: MobileChatKeyboard;
    private playerDesign!: PlayerDesignController;
    private itemSpawnerUi!: ItemSpawnerUi;
    private combatOptions!: CombatOptionsController;
    private worldMap!: WorldMapController;
    private widgetInteraction!: WidgetInteractionController;
    private widgetInputController!: WidgetInputController;
    private spellSelectionController!: SpellSelectionController;
    private widgetActionRouter!: WidgetActionRouter;
    private widgetTransmitProcessor!: WidgetTransmitProcessor;
    private audioVarp!: AudioVarpController;
    private notificationDisplay!: NotificationDisplay;

    get dragSourceWidget(): any {
        return this.widgetInteraction?.dragSourceWidget ?? null;
    }

    set dragSourceWidget(value: any) {
        if (this.widgetInteraction) {
            this.widgetInteraction.dragSourceWidget = value;
        }
    }

    // Script event queues (like OSRS's 3-tier priority system)
    private scriptEvents: ScriptEvent[] = []; // Normal priority
    private scriptEvents2: ScriptEvent[] = []; // Low priority (onTimer)
    private scriptEvents3: ScriptEvent[] = []; // Medium priority (onRelease, onMouseLeave)

    // Client tick loop (20ms cycles). This must continue even when rendering is throttled
    // (e.g., alt-tab / background) so movement queues do not overflow and desync.
    private clientTickLoopRunning: boolean = false;
    private clientTickTimer?: ReturnType<typeof setTimeout>;
    private clientTickLastNowMs: number = 0;
    private clientTickAccumulatedMs: number = 0;
    private loginMusicStartTimer?: ReturnType<typeof setTimeout>;

    // Appearance is server-driven; no client defaults.

    // ECS stores
    npcEcs: NpcEcs = new NpcEcs();
    playerEcs: PlayerEcs = new PlayerEcs();
    playerAnimController!: PlayerAnimController;
    npcMovementSync!: NpcMovementSync;
    playerMovementSync!: PlayerMovementSync;
    private lastNpcDecodeBase?: { tileX: number; tileY: number; level: number };
    private lastPlayerSyncLocalIndex: number = -1;
    // Client-side interaction controller (facing, follow/trade state)
    playerInteractionSystem: PlayerInteractionSystem = new PlayerInteractionSystem(this);
    // Movement is always server-authoritative (OSRS-like)
    // Server-assigned ID of the player we control
    controlledPlayerServerId: number = -1;
    /** Per-tick active world entity IDs — maintained by WORLDENTITY_INFO packets. */
    private activeWorldEntityIds: number[] = [];

    // Server-provided animation sequences for the controlled player (idle/walk/run/crawl + optional directional/turn)
    serverPlayerSeqs?: {
        idle?: number;
        walk?: number;
        walkBack?: number;
        walkLeft?: number;
        walkRight?: number;
        turnLeft?: number;
        turnRight?: number;
        run?: number;
        runBack?: number;
        runLeft?: number;
        runRight?: number;
        crawl?: number;
        crawlBack?: number;
        crawlLeft?: number;
        crawlRight?: number;
    };

    combatWeaponCategory: number = 0;
    combatWeaponItemId: number = -1;

    // Track last server-provided local appearance to avoid redundant rebuilds
    private _lastLocalAppearanceKey?: string;

    inventory: Inventory = new Inventory();
    equipment: Inventory = new Inventory(14); // Equipment has 14 slots
    /** Bank container inventory (ID 95) - indexed 0..1409 for CS2 bankmain_build */
    bankInventory: Inventory = new Inventory(1410);
    /** Collection log inventory (ID 620) - stores obtained items for CS2 inv_total queries */
    collectionInventory: Inventory = new Inventory(2048);
    /** Shop stock inventory (ID 516) - stores shop items for CS2 inv queries */
    shopInventory: Inventory = new Inventory(40);
    /** Your offered trade items (inventory ID 90 in the cache scripts). */
    tradeOfferInventory: Inventory = new Inventory(28);
    /** The other player's offered items use OSRS's inventory-other offset. */
    tradeOtherOfferInventory: Inventory = new Inventory(28);
    private tradeState?: TradeWindowState;
    private inventorySeededFromServer: boolean = false;
    private readonly pendingInventoryMovePredictions: Array<{
        before: string;
        after: string;
    }> = [];

    // Track last layout dimensions to avoid re-running layout every frame
    private _lastLayoutWidth: number = 0;
    private _lastLayoutHeight: number = 0;
    private _lastLayoutRootInterface: number = -1;

    // Cap how many object URLs we retain in-memory to prevent growth over time.
    // Cap how many generated minimap object URLs we retain in-memory to prevent growth over time.
    static readonly MAX_MINIMAP_URLS = 128;
    static readonly MAX_MINIMAP_URLS_MOBILE = 64;
    minimapImageUrls: Map<number, string> = new Map();
    private minimapImageAccess: Map<number, number> = new Map();

    cameraSpeed: number = 1;

    // Camera behavior
    // When true, disables free-cam and keeps camera focused on Player[0]
    followPlayerCamera: boolean = true;
    // OSRS-style zoom shape parameters (match vanilla defaults)
    // Used to convert pitch into camera distance with viewport scaling
    zoomHeight: number = 256;
    zoomWidth: number = 320;
    // OSRS `camFollowHeight` (world units): height offset from tile height for camera focal Y.
    // Set via CAM_SETFOLLOWHEIGHT/CAM_GETFOLLOWHEIGHT opcodes.
    camFollowHeight: number = 50;
    // Hide-roofs toggle: when true, every plane above the player's plane is hidden.
    // When false, roofs are only removed while the player/camera is inside a building.
    roofsHidden: boolean = true;

    setRoofsHidden(roofsHidden: boolean): void {
        if (this.roofsHidden === roofsHidden) {
            return;
        }
        this.roofsHidden = roofsHidden;
        console.log(`[OsrsClient] Roofs hidden: ${roofsHidden}`);

        if (this.renderer) {
            this.renderer.invalidateRoofState();
            this.widgetManager?.invalidateAll();
        }
    }

    private unsubscribeWidgetEvents?: () => void;
    private unsubscribeNpcInfo?: () => void;
    private unsubscribeCombat?: () => void;
    private unsubscribePlayerSync?: () => void;
    private unsubscribeSpot?: () => void;
    private unsubscribeSound?: () => void;
    private unsubscribePlaySong?: () => void;
    private unsubscribePlayJingle?: () => void;
    private unsubscribeSpellResults?: () => void;
    private unsubscribePathDebug?: () => void;
    private unsubscribeGroundItems?: () => void;
    private groundItemMeshesPending = false;
    private unsubscribeChatMessages?: () => void;
    private unsubscribeFriendsChat?: () => void;
    private unsubscribeSkills?: () => void;
    private unsubscribeRunEnergy?: () => void;
    private unsubscribeNotifications?: () => void;
    private readonly serverSubscriptions: Array<() => void> = [];

    private trackServerSubscription(unsubscribe: () => void): void {
        this.serverSubscriptions.push(unsubscribe);
    }

    private refreshGroundItemMeshes(): void {
        this.groundItemMeshesPending =
            (this.renderer as any)?.updateGroundItemMeshes?.(this.groundItems.getAllStacks()) === true;
    }
    // Skills data from server - maps skill ID to {currentLevel, baseLevel, xp}
    private skillsMap: Map<number, { currentLevel: number; baseLevel: number; xp: number }> =
        new Map();
    private playerSyncManager!: PlayerSyncManager;
    private npcUpdateDecoder: NpcUpdateDecoder = new NpcUpdateDecoder();
    private readonly hitsplatFlush: HitsplatFlushController;
    private readonly clientScripts: ClientScriptLoader;
    private readonly chatTextMetrics: ChatTextMetrics;
    private readonly npcInstances: NpcInstanceFlushController;

    private resolveChatPlayerNameForScript(_scriptId: number): string {
        let baseName = this.localPlayerName ?? "";
        const handshakeName = baseName;
        try {
            const serverId = this.controlledPlayerServerId | 0;
            if (serverId >= 0) {
                const ecsIndex = this.playerEcs.getIndexForServerId(serverId);
                if (ecsIndex !== undefined) {
                    const ecsName = this.playerEcs.getName(ecsIndex);
                    if (typeof ecsName === "string" && ecsName.length > 0) {
                        const handshakeHasIconPrefix = /^<img=\d+>/i.test(handshakeName);
                        const ecsHasIconPrefix = /^<img=\d+>/i.test(ecsName);
                        // Preserve handshake crowns when ECS sync carries a plain display name.
                        baseName =
                            handshakeHasIconPrefix && !ecsHasIconPrefix ? handshakeName : ecsName;
                    }
                }
            }
        } catch {}
        const iconPrefix = this.localChatNameIcons
            .filter((icon) => Number.isFinite(icon) && (icon | 0) >= 0)
            .map((icon) => `<img=${icon | 0}>`)
            .join("");
        const textPrefix = this.localChatNamePrefix || "";
        if (iconPrefix.length === 0 && textPrefix.length === 0) {
            return baseName;
        }
        // Deduplicate leading icon tags when base name already carries crowns from appearance sync.
        const strippedBase = String(baseName).replace(/^(?:<img=\d+>)+/gi, "");
        return `${iconPrefix}${textPrefix}${strippedBase}`;
    }

    constructor(
        readonly workerPool: RenderDataWorkerPool,
        readonly cacheList: CacheList,
        rendererType: OsrsRendererType,
        cache?: LoadedCache,
    ) {
        this.varcPersistence = new VarcPersistence({
            getVarManager: () => this.varManager,
        });
        this.hitsplatFlush = new HitsplatFlushController({
            getRenderer: () => this.renderer,
        });
        this.clientScripts = new ClientScriptLoader({
            getCacheSystem: () => this.cacheSystem,
        });
        this.chatTextMetrics = new ChatTextMetrics({
            getCacheSystem: () => this.cacheSystem,
        });
        this.npcInstances = new NpcInstanceFlushController({
            getRenderer: () => this.renderer,
            workerPool: this.workerPool,
            getSeqTypeLoader: () => this.seqTypeLoader,
            getSeqFrameLoader: () => this.seqFrameLoader,
            getNpcTypeLoader: () => this.npcTypeLoader,
            getBasTypeLoader: () => this.basTypeLoader,
        });
        this.varcPersistence.bindPageLifecycle();
        setSpellSelectionClearHandler(() => this.clearSelectedSpell());
        setSpellSelectionResolver((selection) =>
            this.resolveSpellSelectionFromWidget(
                undefined,
                selection.widgetId,
                selection.childIndex,
                selection.itemId,
            ),
        );
        setNpcExamineIdResolver((serverId) => this.resolveNpcExamineTypeId(serverId));
        const globalState = globalThis as typeof globalThis & {
            DEBUG_PROJECTILES?: boolean;
            DEBUG_PROJECTILES_VERBOSE?: boolean;
            DEBUG_PROJECTILES_TRAJ?: boolean;
            osrsRenderer?: GameRenderer;
            osrsClient?: OsrsClient;
        };
        // Always enable projectile debug flags unless explicitly disabled by user.
        try {
            if (globalState.DEBUG_PROJECTILES === undefined) globalState.DEBUG_PROJECTILES = true;
            if (globalState.DEBUG_PROJECTILES_VERBOSE === undefined) {
                globalState.DEBUG_PROJECTILES_VERBOSE = true;
            }
            if (globalState.DEBUG_PROJECTILES_TRAJ === undefined) {
                globalState.DEBUG_PROJECTILES_TRAJ = true;
            }
        } catch {}
        this.renderer = createRenderer(rendererType, this);
        try {
            const mapManager = this.renderer.mapManager;
            mapManager.onMapAdded = (mapX, mapY) => {
                const mapId = getMapSquareId(mapX | 0, mapY | 0);
                // Always re-mark for NPC refresh when a map is (re)loaded.
                // A door/loc reload can replace the map after a previous NPC
                // flush already linked entities, leaving newly created cache
                // NPCs unlinked and invisible.
                this.npcInstances.markMapPendingReload(mapId | 0);
                this.npcInstances.scheduleFlush();
            };
            mapManager.onCurrentMapChanged = (_mapX, _mapY, _mapRadius) => {
                this.applyMobileMapCacheBudget(_mapRadius | 0);
                if (this.npcInstances.mapsPendingReload.size > 0) {
                    this.npcInstances.scheduleFlush();
                }
            };
        } catch (error) {
            console.log("[OsrsClient] Failed to bind map manager callbacks", { error });
        }
        // Expose renderer globally for diagnostics
        try {
            globalState.osrsRenderer = this.renderer;
            globalState.osrsClient = this;
        } catch {}
        try {
            setClientCycleProvider(() => this.playerEcs.getClientCycle());
        } catch {}
        try {
            registerAnimDebugProvider(() => {
                const id = this.controlledPlayerServerId | 0;
                try {
                    const seq = this.playerAnimController.getSequenceState(id);
                    const idx = this.playerEcs.getIndexForServerId(id);
                    let currentSeq: number | undefined;
                    if (idx !== undefined) currentSeq = this.playerEcs.getAnimSeqId(idx);
                    return { controlledId: id, seq: seq ? { ...seq } : undefined, currentSeq };
                } catch {
                    return { controlledId: id };
                }
            });
        } catch {}
        this.applyDisplayDefaults();
        this.sidebar = new SidebarStore<ClientSidebarEntryData>({
            defaultOpen: false,
            persistence: createBrowserSidebarPersistence("osrs.sidebar.v1"),
        });
        this.groundItemsPlugin = new GroundItemsPlugin(
            createBrowserGroundItemsPluginPersistence("osrs.plugin.ground_items.v1"),
        );
        this.interactHighlightPlugin = new InteractHighlightPlugin(
            createBrowserInteractHighlightPluginPersistence("osrs.plugin.interact_highlight.v1"),
        );
        this.notesPlugin = new NotesPlugin(
            createBrowserNotesPluginPersistence("osrs.plugin.notes.v1", "osrs.sidebar.notes"),
        );
        this.rememberLoginPlugin = new RememberLoginPlugin(
            createBrowserRememberLoginPluginPersistence("osrs.plugin.remember_login.v1"),
        );
        this.tileMarkersPlugin = new TileMarkersPlugin(
            createBrowserTileMarkersPluginPersistence("osrs.plugin.tile_markers.v1"),
        );
        this.syncSidebarPlugins(true);
        this.groundItemsPlugin.subscribe(() => {
            this.syncSidebarPlugins();
        });
        this.interactHighlightPlugin.subscribe(() => {
            this.syncSidebarPlugins();
        });
        this.notesPlugin.subscribe(() => {
            this.syncSidebarPlugins();
        });
        this.tileMarkersPlugin.subscribe(() => {
            this.syncSidebarPlugins();
        });
        // If cache is provided, initialize immediately
        // Otherwise, OsrsClient stays in DOWNLOADING state until initCache() is called
        if (cache) {
            this.initCache(cache);
        }
    }

    private resolveNpcExamineTypeId(serverId: number): number | undefined {
        const normalizedServerId = serverId | 0;
        if (normalizedServerId < 0) {
            return undefined;
        }
        const ecsId = this.npcEcs.getEcsIdForServer(normalizedServerId);
        if (ecsId === undefined) {
            return undefined;
        }
        const baseTypeId = this.npcEcs.getNpcTypeId(ecsId) | 0;
        if (baseTypeId < 0) {
            return undefined;
        }
        let npcType = this.npcTypeLoader.load(baseTypeId);
        if (!npcType) {
            return undefined;
        }
        if (npcType.transforms) {
            const transformed = npcType.transform(this.varManager, this.npcTypeLoader);
            if (transformed) {
                npcType = transformed;
            }
        }
        return npcType.id | 0;
    }

    /**
     * Set download progress for cache download phase.
     * Updates loginState which is reflected in the login overlay.
     */
    setDownloadProgress(current: number, total: number, label?: string): void {
        this.loginState.downloadCurrent = current;
        this.loginState.downloadTotal = total;
        if (label !== undefined) {
            this.loginState.downloadLabel = label;
        }
    }

    /**
     * Initialize cache-dependent components.
     * Called after initCache() completes.
     */

    private initChatControllers(): void {
        this.enterToTypeChat = new EnterToTypeChat({
            cs2Vm: this.cs2Vm,
            varManager: this.varManager,
            widgetManager: this.widgetManager,
            isLoggedIn: () => this.isLoggedIn(),
            isItemSpawnerSearchFocused: () => this.itemSpawnerUi.isSearchFocused(),
        });
        this.mobileChatKeyboard = new MobileChatKeyboard({
            inputManager: this.inputManager,
            varManager: this.varManager,
        });
    }

    private initCombatOptionsController(): void {
        this.combatOptions = new CombatOptionsController({
            getVarManager: () => this.varManager,
            playerEcs: this.playerEcs,
            getControlledPlayerServerId: () => this.controlledPlayerServerId,
            getCombatWeaponCategory: () => this.combatWeaponCategory,
        });
    }

    private initWorldMapController(): void {
        this.worldMap = new WorldMapController({
            getCacheSystem: () => this.cacheSystem,
            getLoaderFactory: () => this.loaderFactory,
            getLocTypeLoader: () => this.locTypeLoader,
            getMapElementTypeLoader: () => this.mapElementTypeLoader,
            getTextureLoader: () => this.textureLoader,
            getVarManager: () => this.varManager,
            getWidgetManager: () => this.widgetManager,
            getCs2Vm: () => this.cs2Vm,
            getRenderer: () => this.renderer,
            getMinimapImageKey: (mapX, mapY, level) => this.getMinimapImageKey(mapX, mapY, level),
            loadClientScriptIfExists: (scriptId) => this.clientScripts.loadIfExists(scriptId),
            clearHostRenderCaches: () => {
                const host = this as any;
                delete host.__worldMapVisibleTileCache;
                host.__worldMapElementCache?.clear?.();
                host.__worldMapLabelMetricsCache?.clear?.();
            },
        });
    }

    private initPlayerDesignController(): void {
        this.playerDesign = new PlayerDesignController({
            getIdkTypeLoader: () => this.idkTypeLoader,
            getObjTypeLoader: () => this.objTypeLoader,
            getModelLoader: () => this.modelLoader,
            getTextureLoader: () => this.textureLoader,
            getSeqTypeLoader: () => this.seqTypeLoader,
            getSeqFrameLoader: () => this.seqFrameLoader,
            getBasTypeLoader: () => this.basTypeLoader,
            getSkeletalSeqLoader: () => this.loaderFactory?.getSkeletalSeqLoader?.(),
            varManager: this.varManager,
            widgetManager: this.widgetManager,
            playerEcs: this.playerEcs,
            getControlledPlayerServerId: () => this.controlledPlayerServerId,
        });
    }

    private initItemSpawnerUi(): void {
        this.itemSpawnerUi = new ItemSpawnerUi({
            widgetManager: this.widgetManager,
            getObjTypeLoader: () => this.objTypeLoader,
            getCacheSystem: () => this.cacheSystem,
            runWidgetScopedClientScript: (widgetUid, scriptId, args, phase) =>
                this.runWidgetScopedClientScript(widgetUid, scriptId, args, phase),
        });
    }

    private initWidgetInteractionController(): void {
        this.widgetInteraction = new WidgetInteractionController({
            getWidgetManager: () => this.widgetManager,
            getInputManager: () => this.inputManager,
            getRendererCanvas: () => this.renderer?.canvas,
            getTradeRequestTargetsByName: () => this.tradeRequestTargetsByName,
        });
    }

    private initSpellSelectionController(): void {
        this.spellSelectionController = new SpellSelectionController({
            getWidgetManager: () => this.widgetManager,
            getObjTypeLoader: () => this.objTypeLoader,
            getCs2Vm: () => this.cs2Vm,
            executeScriptListener: (widget, listener, eventContext) =>
                this.executeScriptListener(widget, listener, eventContext),
        });
    }

    private initWidgetInputController(): void {
        this.widgetInputController = new WidgetInputController({
            getInputManager: () => this.inputManager,
            getWidgetManager: () => this.widgetManager,
            getWidgetInteraction: () => this.widgetInteraction,
            getTransmitCycles: () => this.transmitCycles,
            getRenderer: () => this.renderer,
            getCs2Vm: () => this.cs2Vm,
            getVarManager: () => this.varManager,
            getWorldMap: () => this.worldMap,
            getItemSpawnerUi: () => this.itemSpawnerUi,
            getEnterToTypeChat: () => this.enterToTypeChat,
            getPlayerDesign: () => this.playerDesign,
            getObjTypeLoader: () => this.objTypeLoader,
            getInventory: () => this.inventory,
            getSettings: () => this.settings,
            getMinimapZoomEnabled: () => this.minimapZoomEnabled,
            getMenuOpen: () => this.menuOpen,
            getMenuJustClosed: () => this.menuJustClosed,
            setMenuJustClosed: (value) => {
                this.menuJustClosed = value;
            },
            applyMinimapWheelZoom: (deltaY) => this.applyMinimapWheelZoom(deltaY),
            executeScriptListener: (widget, listener, eventContext) =>
                this.executeScriptListener(widget, listener, eventContext),
            handleWidgetAction: (event) => this.handleWidgetAction(event),
            handleTradeWidgetAction: (widget, event, groupId, childId) =>
                this.handleTradeWidgetAction(widget, event, groupId, childId),
            handleInventorySlotMove: (
                from,
                to,
                localPredictionApplied,
                previousSnapshotSignature,
            ) =>
                this.handleInventorySlotMove(
                    from,
                    to,
                    localPredictionApplied,
                    previousSnapshotSignature,
                ),
            buildWidgetActionPayload: (event) =>
                this.widgetActionRouter.buildWidgetActionPayload(event) ?? null,
            resolveTransmitFlagWidget: (eventWidget, payload) =>
                this.widgetActionRouter.resolveTransmitFlagWidget(eventWidget, payload),
            getSpellSelection: () => this.spellSelectionController,
            getPendingInputDialogAction: () => this.pendingInputDialogAction,
            setPendingInputDialogAction: (action) => {
                this.pendingInputDialogAction = action;
            },
            getPendingTradeQuantityAction: () => this.pendingTradeQuantityAction,
            setPendingTradeQuantityAction: (action) => {
                this.pendingTradeQuantityAction = action;
            },
        });
    }

    private initWidgetActionRouter(): void {
        this.widgetActionRouter = new WidgetActionRouter({
            getWidgetManager: () => this.widgetManager,
            getCs2Vm: () => this.cs2Vm,
            getVarManager: () => this.varManager,
            getInventory: () => this.inventory,
            getInputManager: () => this.inputManager,
            getWidgetInteraction: () => this.widgetInteraction,
            getItemSpawnerUi: () => this.itemSpawnerUi,
            getPlayerDesign: () => this.playerDesign,
            getTradeState: () => this.tradeState,
            getTradeOfferInventory: () => this.tradeOfferInventory,
            clearSelectedSpell: () => this.spellSelectionController.clearSelectedSpell(),
            setSelectedSpell: (spell, sourceWidget) =>
                this.spellSelectionController.setSelectedSpell(spell, sourceWidget),
            normalizeSelectedSpellState: () =>
                this.spellSelectionController.normalizeSelectedSpellState(),
            resolveSpellSelectionFromWidget: (widget, widgetUid, childId, itemId) =>
                this.spellSelectionController.resolveSpellSelectionFromWidget(
                    widget,
                    widgetUid,
                    childId,
                    itemId,
                ),
            getWidgetTargetMask: (widget) =>
                this.spellSelectionController.getWidgetTargetMask(widget),
            executeScriptListener: (widget, listener, eventContext) =>
                this.executeScriptListener(widget, listener, eventContext),
            getPendingInputDialogAction: () => this.pendingInputDialogAction,
            setPendingInputDialogAction: (action) => {
                this.pendingInputDialogAction = action;
            },
            setPendingTradeQuantityAction: (action) => {
                this.pendingTradeQuantityAction = action;
            },
            examineWidgetItem: (widget) => this.examineWidgetItem(widget),
        });
    }

    private initWidgetTransmitProcessor(): void {
        this.widgetTransmitProcessor = new WidgetTransmitProcessor({
            getWidgetManager: () => this.widgetManager,
            getTransmitCycles: () => this.transmitCycles,
            getCs2Vm: () => this.cs2Vm,
            queueScriptEvent: (event, priority) =>
                this.queueScriptEvent(event, (priority ?? 0) as 0 | 1 | 2),
            executeScriptListener: (widget, listener) =>
                this.executeScriptListener(widget, listener),
        });
    }

    private initAudioVarpController(): void {
        this.audioVarp = new AudioVarpController({
            getMusicSystem: () => this.musicSystem,
            getSoundEffectSystem: () => this.soundEffectSystem,
            getRenderer: () => this.renderer,
            getMasterVolume: () => this.masterVolume,
            setMasterVolume: (value) => {
                this.masterVolume = value;
            },
            getMusicVolume: () => this._musicVolume,
            setMusicVolume: (value) => {
                this._musicVolume = value;
            },
            getSfxVolume: () => this._sfxVolume,
            setSfxVolume: (value) => {
                this._sfxVolume = value;
            },
            getAmbientVolume: () => this._ambientVolume,
            setAmbientVolume: (value) => {
                this._ambientVolume = value;
            },
        });
    }

    private initNotificationDisplay(): void {
        this.notificationDisplay = new NotificationDisplay({
            getWidgetManager: () => this.widgetManager,
            getCs2Vm: () => this.cs2Vm,
            triggerInitialVarTransmitForGroup: (groupId) =>
                this.widgetTransmitProcessor.triggerInitialVarTransmitForGroup(groupId),
        });
    }

    private initCacheDependent(): void {
        this.widgetManager.osrsClient = this;
        // CS2 VM context with canvas/viewport state
        const self = this;
        // Create inventories map for CS2 VM
        const inventoriesMap = new Map<number, Inventory>();
        inventoriesMap.set(93, this.inventory); // Backpack
        inventoriesMap.set(94, this.equipment); // Equipment
        inventoriesMap.set(95, this.bankInventory); // Bank
        inventoriesMap.set(90, this.tradeOfferInventory); // Your trade offer
        inventoriesMap.set(90 + 32768, this.tradeOtherOfferInventory); // Other trade offer
        inventoriesMap.set(516, this.shopInventory); // Shop stock
        inventoriesMap.set(620, this.collectionInventory); // collection_transmit

        this.cs2Vm = new Cs2Vm({
            widgetManager: this.widgetManager,
            varManager: this.varManager,
            objTypeLoader: this.objTypeLoader,
            inventories: inventoriesMap,
            // Initialize empty social lists (will be populated by server)
            friendList: [],
            ignoreList: [],
            clanMembers: [],
            clanName: "",
            clanOwner: "",
            clanRank: 0,
            friendsChatMinKick: 0,
            sendFriendsChatAction,
            paramTypeLoader: this.loaderFactory.getParamTypeLoader(),
            enumTypeLoader: this.loaderFactory.getEnumTypeLoader(),
            structTypeLoader: this.loaderFactory.getStructTypeLoader(),
            npcTypeLoader: this.npcTypeLoader,
            locTypeLoader: this.locTypeLoader,
            mapElementTypeLoader: this.mapElementTypeLoader,
            dbRepository: new DbRepository(this.cacheSystem),
            // Stat functions - read from skillsMap populated by server
            getStatLevel: (skillId: number) => {
                const skill = self.skillsMap.get(skillId);
                return skill?.currentLevel ?? 1;
            },
            getStatBase: (skillId: number) => {
                const skill = self.skillsMap.get(skillId);
                return skill?.baseLevel ?? 1;
            },
            getStatXp: (skillId: number) => {
                const skill = self.skillsMap.get(skillId);
                return skill?.xp ?? 0;
            },
            getStatBoosted: (skillId: number) => {
                // Boosted level = current level (which may be boosted/drained)
                const skill = self.skillsMap.get(skillId);
                return skill?.currentLevel ?? skill?.baseLevel ?? 1;
            },
            getPlayerGender: () => {
                // Get local player's gender from appearance (0 = male, 1 = female)
                const idx = self.playerEcs.getIndexForServerId(self.controlledPlayerServerId);
                if (idx === undefined || idx < 0) return 0;
                return self.playerEcs.getAppearance(idx)?.gender ?? 0;
            },
            getMinimapZoom: () => {
                return self.minimapZoom;
            },
            setMinimapZoom: (zoom: number) => {
                if (!self.minimapZoomEnabled) return;
                self.minimapZoom = Math.max(2, Math.min(8, zoom));
            },
            setMinimapZoomable: (enabled: boolean) => {
                self.minimapZoomEnabled = enabled;
                self.minimapZoom = 4;
            },
            setMinimapIconZoomLimit: (limit: number) => {
                self.minimapIconZoomLimit = limit | 0;
            },
            worldMapState: this.worldMap.worldMapState,
            getRunEnergy: () => {
                // Return 0-10000 units as expected by CS2 opcodes
                return self.runEnergyUnits;
            },
            getIdleTimerRemainingMs: () => {
                return self.inputManager.getIdleLogoutRemainingMs();
            },
            requestLogout: () => {
                self.performLogout();
            },
            sendIfClose: () => {
                const pkt = createPacket(ClientPacketId.IF_CLOSE);
                queuePacket(pkt);
            },
            getWeight: () => {
                // Return player weight in kg for RUNWEIGHT_VISIBLE opcode
                return self.playerWeight;
            },
            // Player position getters for COORD opcode
            getPlayerPlane: () => {
                return ClientState.plane;
            },
            getBaseX: () => {
                return ClientState.baseX;
            },
            getBaseY: () => {
                return ClientState.baseY;
            },
            getPlayerLocalX: () => {
                // Get local player's fine X position and convert to tile coordinate
                const idx = self.playerEcs.getIndexForServerId(self.controlledPlayerServerId);
                if (idx === undefined || idx < 0) return 0;
                return (self.playerEcs.getX(idx) >> 7) | 0;
            },
            getPlayerLocalY: () => {
                // Get local player's fine Y position and convert to tile coordinate
                const idx = self.playerEcs.getIndexForServerId(self.controlledPlayerServerId);
                if (idx === undefined || idx < 0) return 0;
                return (self.playerEcs.getY(idx) >> 7) | 0;
            },
            loadScript: (id: number) => {
                return self.clientScripts.load(id);
            },
            clientRevision: 235,
            // Canvas dimensions as defined by the renderer's current UI layout space.
            get canvasWidth() {
                return self.widgetManager?.canvasWidth || DEFAULT_SCREEN_WIDTH;
            },
            get canvasHeight() {
                return self.widgetManager?.canvasHeight || DEFAULT_SCREEN_HEIGHT;
            },
            windowMode: 2, // Resizable mode
            viewportZoom: 256,
            viewportFov: 256,
            getViewportZoomRange: () => {
                return self.camera.getViewportZoomRange();
            },
            setViewportZoomRange: (min: number, max: number) => {
                self.camera.setViewportZoomRange(min, max);
            },
            getViewportFovValues: () => {
                return self.camera.getViewportFovValues();
            },
            setViewportFovValues: (low: number, high: number) => {
                self.camera.setViewportFovValues(low, high);
            },
            setWindowMode: (mode) => {
                this.cs2Vm.context.windowMode = mode;
            },
            setViewportClampFov: (fovClampMin, fovClampMax, zoomClampMin, zoomClampMax) => {
                this.camera.setClampFov(fovClampMin, fovClampMax, zoomClampMin, zoomClampMax);
            },
            setDragSource: (widget) => {
                this.dragSourceWidget = widget;
                if (widget) this.widgetInteraction.isDraggingWidget = true;
                // Initialize drag state for programmatic drag (cc_dragpickup)
                if (widget) {
                    // Set clickedWidget to the dragged widget so drag handling works
                    this.widgetInteraction.clickedWidget = widget;
                    this.widgetInteraction.clickedWidgetParent =
                        this.widgetInteraction.resolveClickedWidgetParent(widget);
                    // Use the pickup offset as the click offset within the widget.
                    // cc_dragpickup provides offsets in logical (widget) coordinates, but
                    // clickedWidgetX/Y are subtracted from pixel-space mouse coordinates,
                    // so scale them to pixel space.
                    const [pickupScaleX, pickupScaleY] = this.widgetInteraction.getUiRenderScale();
                    this.widgetInteraction.clickedWidgetX =
                        ((widget as any)._dragPickupOffsetX ?? 0) * pickupScaleX;
                    this.widgetInteraction.clickedWidgetY =
                        ((widget as any)._dragPickupOffsetY ?? 0) * pickupScaleY;

                    // Determine the drag render area for coordinate calculations
                    // Priority: explicit dragRenderArea > parent widget > widget itself
                    const renderArea = this.widgetInteraction.clickedWidgetParent ?? widget;

                    // Calculate absolute position of drag render area
                    let renderAreaAbsX: number;
                    let renderAreaAbsY: number;
                    if (renderArea._absX !== undefined && renderArea._absY !== undefined) {
                        // Use the render area's computed absolute position
                        renderAreaAbsX = renderArea._absX;
                        renderAreaAbsY = renderArea._absY;
                    } else if (widget._absX !== undefined && widget._absY !== undefined) {
                        // Derive parent's position from dragger's absolute position
                        renderAreaAbsX = widget._absX - (widget.x ?? 0);
                        renderAreaAbsY = widget._absY - (widget.y ?? 0);
                    } else {
                        // Fallback to relative positions
                        renderAreaAbsX = renderArea.x ?? 0;
                        renderAreaAbsY = renderArea.y ?? 0;
                    }
                    this.widgetInteraction.dragRenderAreaAbsX = renderAreaAbsX;
                    this.widgetInteraction.dragRenderAreaAbsY = renderAreaAbsY;
                }
            },
            getTextWidth: (text: string, fontId: number) => {
                if (!this.fontCache.has(fontId)) {
                    const font = BitmapFont.tryLoad(this.cacheSystem, fontId);
                    if (font) {
                        this.fontCache.set(fontId, font);
                    }
                }
                const font = this.fontCache.get(fontId);
                return this.chatTextMetrics.measureTextWidthOsrsMarkup(text, font);
            },
            getTextHeight: (fontId: number) => {
                // Return full visual line height (maxAscent + maxDescent)
                // This is what PARAHEIGHT needs for calculating total text height
                if (!this.fontCache.has(fontId)) {
                    const font = BitmapFont.tryLoad(this.cacheSystem, fontId);
                    if (font) {
                        this.fontCache.set(fontId, font);
                    }
                }
                const font = this.fontCache.get(fontId);
                if (font) {
                    // Full visual height of the font
                    return font.maxAscent + font.maxDescent || font.ascent || 12;
                }
                return 12;
            },
            splitTextLines: (text: string, fontId: number, maxWidth: number) => {
                // Load font if needed
                if (!this.fontCache.has(fontId)) {
                    const font = BitmapFont.tryLoad(this.cacheSystem, fontId);
                    if (font) {
                        this.fontCache.set(fontId, font);
                    }
                }
                const font = this.fontCache.get(fontId);
                const measure = (s: string) =>
                    this.chatTextMetrics.measureTextWidthOsrsMarkup(s, font);

                // Handle <br> tags and newlines first
                const normalized = text.replace(/<br\s*\/?>/gi, "\n");
                const paragraphs = normalized.split(/\n/);
                const lines: string[] = [];

                const effectiveWidth = maxWidth;

                for (const para of paragraphs) {
                    if (!para.trim()) {
                        lines.push("");
                        continue;
                    }
                    const words = para.split(/\s+/);
                    let currentLine = "";

                    for (const word of words) {
                        if (!word) continue;
                        const testLine = currentLine ? `${currentLine} ${word}` : word;
                        if (measure(testLine) <= effectiveWidth || !currentLine) {
                            currentLine = testLine;
                        } else {
                            lines.push(currentLine);
                            currentLine = word;
                        }
                    }
                    if (currentLine) {
                        lines.push(currentLine);
                    }
                }

                return lines.length > 0 ? lines : [""];
            },
            // Local player name - accessed dynamically as it arrives via handshake after cs2Vm creation
            get localPlayerName() {
                return self.localPlayerName;
            },
            resolveChatPlayerName: (scriptId: number) =>
                self.resolveChatPlayerNameForScript(scriptId | 0),
            sendPlayerOption: (playerName: string, option: number) => {
                const normalizedName = playerName.trim().toLowerCase();
                const tradeTarget = self.tradeRequestTargetsByName.get(normalizedName);
                if (tradeTarget !== undefined) {
                    // Type-101's chat action is always Trade, even if the
                    // cache script passes a menu-specific action value.
                    sendPlayerOption(tradeTarget, 2);
                    return;
                }
                const index = self.playerEcs.findIndexByName(playerName);
                const serverId =
                    index === undefined ? undefined : self.playerEcs.getServerIdForIndex(index);
                if (serverId !== undefined && option >= 1 && option <= 8) {
                    sendPlayerOption(serverId, option);
                }
            },
            openMobileTab: (interfaceId: number) => {
                console.log(`[Cs2Vm] CLIENT_SET_SIDE_PANEL interfaceId=${interfaceId}`);
                // Map interface ID to mobile tab index (0-13)
                // Based on standard OSRS mobile layout order
                const map: Record<number, number> = {
                    593: 0, // Combat Options
                    320: 1, // Skills (Stats)
                    [SIDE_JOURNAL_GROUP_ID]: 2, // Quest List
                    149: 3, // Inventory
                    85: 4, // Worn Equipment
                    541: 5, // Prayer
                    218: 6, // Magic
                    // 7: Clan Chat?
                    259: 8, // Friends List
                    432: 9, // Ignore List
                    239: 10, // Settings
                    429: 11, // Emotes
                    261: 12, // Music Player
                    182: 13, // Logout
                };
                const idx = map[interfaceId];

                if (idx !== undefined) {
                    try {
                        const canvas = self.renderer?.canvas as any;
                        if (canvas) {
                            const ui = (canvas.__ui = canvas.__ui || {});
                            ui.mobile = ui.mobile || {};
                            ui.mobile.activeIndex = idx;
                        }
                    } catch (e) {
                        console.warn("[Cs2Vm] Failed to open mobile tab", e);
                    }
                }
            },
            // Input manager for keyboard state queries (KEYHELD, KEYPRESSED)
            inputManager: {
                isKeyHeld: (osrsKeyCode: number) => self.inputManager.isKeyHeld(osrsKeyCode),
                wasKeyPressed: (osrsKeyCode: number) =>
                    self.inputManager.wasKeyPressed(osrsKeyCode),
            },
            // Audio playback for CS2 SOUND_SONG opcode
            // Music fade params: trackId, outDelay, outDur, inDelay, inDur
            playSong: (
                songId: number,
                fadeOutDelay: number,
                fadeOutDuration: number,
                fadeInDelay: number,
                fadeInDuration: number,
            ) => {
                if (self.musicSystem && songId >= 0) {
                    self.musicSystem.playSong(
                        songId,
                        fadeOutDelay,
                        fadeOutDuration,
                        fadeInDelay,
                        fadeInDuration,
                    );
                }
            },
            // Audio playback for CS2 SOUND_JINGLE opcode
            // jingles interrupt music, then music resumes
            playJingle: (jingleId: number, delay: number) => {
                if (self.musicSystem && jingleId >= 0) {
                    self.musicSystem.playJingle(jingleId, delay);
                }
            },
            // Extended music control (opcodes 3220-3222)
            // MUSIC_STOP (3220): Stop/fade current music
            stopMusic: (fadeOutDelay: number, fadeOutDuration: number) => {
                if (self.musicSystem) {
                    self.musicSystem.stopMusic(fadeOutDelay, fadeOutDuration);
                }
            },
            // MUSIC_DUAL (3221): Preload two tracks for crossfade
            playDualTracks: (
                track1: number,
                track2: number,
                fadeOutDelay: number,
                fadeOutDuration: number,
                fadeInDelay: number,
                fadeInDuration: number,
            ) => {
                if (self.musicSystem) {
                    self.musicSystem.playDualTracks(
                        track1,
                        track2,
                        fadeOutDelay,
                        fadeOutDuration,
                        fadeInDelay,
                        fadeInDuration,
                    );
                }
            },
            // MUSIC_CROSSFADE (3222): Crossfade between the two loaded tracks
            crossfadeTracks: (
                fadeOutDelay: number,
                fadeOutDuration: number,
                fadeInDelay: number,
                fadeInDuration: number,
            ) => {
                if (self.musicSystem) {
                    self.musicSystem.crossfadeTracks(
                        fadeOutDelay,
                        fadeOutDuration,
                        fadeInDelay,
                        fadeInDuration,
                    );
                }
            },
            // Sound effect playback for CS2 SOUND_SYNTH opcode
            playSoundEffect: (soundId: number, delay: number, loops: number) => {
                if (self.soundEffectSystem && soundId >= 0) {
                    self.soundEffectSystem.playSoundEffect(soundId, {
                        loops,
                        delayMs: delay * 20, // CS2 delay is in client ticks (50ms), convert to ms
                    });
                }
            },
            // === Direct Volume Control (setvolumemusic, setvolumesounds, setvolumeareasounds) ===
            // These take volume 0-127 directly
            setMusicVolume: (volume: number) => {
                self.gameOptions.set(0, volume); // Store for getMusicVolume
                if (self.musicSystem) {
                    const vol = Math.max(0, Math.min(1, volume / 127));
                    self.musicSystem.setVolume(vol);
                }
            },
            getMusicVolume: (): number => {
                return self.gameOptions.get(0) ?? 0;
            },
            setSoundVolume: (volume: number) => {
                self.gameOptions.set(1, volume);
                if (self.soundEffectSystem) {
                    const vol = Math.max(0, Math.min(1, volume / 127));
                    self.soundEffectSystem.setVolume(vol);
                }
            },
            getSoundVolume: (): number => {
                return self.gameOptions.get(1) ?? 0;
            },
            setAreaSoundVolume: (volume: number) => {
                self.gameOptions.set(2, volume);
                if (self.soundEffectSystem) {
                    const vol = Math.max(0, Math.min(1, volume / 127));
                    self.soundEffectSystem.setAmbientVolume(vol);
                }
            },
            getAreaSoundVolume: (): number => {
                return self.gameOptions.get(2) ?? 0;
            },
            // === Client option get/set ===
            getClientOption: (optionId: number): number => {
                return self.clientOptions.get(optionId) ?? 0;
            },
            setClientOption: (optionId: number, value: number) => {
                console.log(`[clientoption_set] optionId=${optionId}, value=${value}`);
                self.clientOptions.set(optionId, value);
            },
            configureTileHighlight: (
                slot: number,
                colorRgb: number | undefined,
                thickness: number,
                alphaPercent: number,
                flags: number,
            ) => {
                self.tileHighlightManager.configure(slot, colorRgb, thickness, alphaPercent, flags);
            },
            setTileHighlight: (coordPacked: number, slot: number, group: number) => {
                self.tileHighlightManager.set(coordPacked, slot, group);
            },
            removeTileHighlight: (coordPacked: number, slot: number, group: number) => {
                self.tileHighlightManager.remove(coordPacked, slot, group);
            },
            clearTileHighlights: (slot: number) => {
                self.tileHighlightManager.clear(slot);
            },
            hasTileHighlight: (coordPacked: number, slot: number, group: number) => {
                return self.tileHighlightManager.has(coordPacked, slot, group);
            },
            // === Game option get/set - controls audio volume and other settings ===
            // Audio option IDs are defined by CS2 constants in this revision:
            // ^gameoption_midi_volume = 7 (music)
            // ^gameoption_wave_volume = 8 (sound effects)
            // ^gameoption_ambient_volume = 9 (area sounds)
            // Values passed are enum_981 outputs (0-100 non-linear curve).
            getGameOption: (optionId: number): number => {
                return self.gameOptions.get(optionId) ?? 0;
            },
            setGameOption: (optionId: number, value: number) => {
                self.gameOptions.set(optionId, value);

                // Modern OSRS: CS2 scripts call gameoption_set with values from enum_981 lookup
                // enum_981 maps percentage (0-100 varp) → 0-100 output (non-linear curve)
                // Java client then scales: music=value*255/100, sfx/area=value*127/100
                // Individual volumes are stored and multiplied by masterVolume
                //
                // Helper to apply volume change
                const applyMusicVolume = (val: number) => {
                    // Java: var6 = Math.round((float)(var5 * 255) / 100.0F)
                    const scaled = Math.round((val * 255) / 100);
                    const musicVol = Math.max(0, Math.min(1, scaled / 255));
                    self._musicVolume = musicVol;
                    if (self.musicSystem) {
                        self.musicSystem.setVolume(musicVol * self.masterVolume);
                    }
                };
                const applySfxVolume = (val: number) => {
                    const scaled = Math.round((val * 127) / 100);
                    const sfxVol = Math.max(0, Math.min(1, scaled / 127));
                    self._sfxVolume = sfxVol;
                    if (self.soundEffectSystem) {
                        self.soundEffectSystem.setVolume(sfxVol * self.masterVolume);
                    }
                };
                const applyAmbientVolume = (val: number) => {
                    const scaled = Math.round((val * 127) / 100);
                    const ambientVol = Math.max(0, Math.min(1, scaled / 127));
                    self._ambientVolume = ambientVol;
                    if (self.soundEffectSystem) {
                        self.soundEffectSystem.setAmbientVolume(ambientVol * self.masterVolume);
                    }
                };

                switch (optionId) {
                    case 7: // Music volume (^gameoption_midi_volume)
                        applyMusicVolume(value);
                        break;
                    case 8: // Sound effects volume (^gameoption_wave_volume)
                        applySfxVolume(value);
                        break;
                    case 9: // Area sounds volume (^gameoption_ambient_volume)
                        applyAmbientVolume(value);
                        break;
                }
            },
            // === Device option get/set - controls brightness, fps limit, master volume, etc. ===
            // Option ID 19 = master_volume (enhanced client)
            getDeviceOption: (optionId: number): number => {
                if (optionId === DEVICE_OPTION_INTERFACE_SCALING) {
                    return getOsrsInterfaceScalingPercent();
                }
                return self.deviceOptions.get(optionId) ?? 0;
            },
            setDeviceOption: (optionId: number, value: number) => {
                const storedValue = value;
                self.deviceOptions.set(optionId, storedValue);
                // Handle specific device options
                switch (optionId) {
                    case 19: // Master volume (enhanced client, 0-100 from enum_981)
                        // Master volume acts as a multiplier for all audio
                        // When master is 0, all audio should be muted
                        const masterVol = Math.max(0, Math.min(1, storedValue / 100));
                        self.masterVolume = masterVol;
                        self.audioVarp.applyMasterVolume();
                        break;
                    case DEVICE_OPTION_INTERFACE_SCALING:
                        self.audioVarp.applyInterfaceScalingPercentDeviceOption(storedValue);
                        break;
                }
            },
            // Callback when a sub-interface is opened via IF_OPENSUB
            // This triggers initial onVarTransmit handlers for the interface
            onSubInterfaceOpened: (groupId: number) => {
                self.triggerInitialVarTransmitForGroup(groupId);
                markWidgetsLoaded();
            },
            // Callback for cc_resume_pausebutton / if_resume_pausebutton
            // Sends RESUME_PAUSEBUTTON packet to server for dialog continuation
            sendResumePauseButton: (widgetUid: number, childIndex: number) => {
                let w = self.widgetManager?.getWidgetByUid(widgetUid);
                if (
                    w &&
                    childIndex >= 0 &&
                    Array.isArray((w as any).children) &&
                    (w as any).children[childIndex]
                ) {
                    w = (w as any).children[childIndex] as any;
                }
                if (self.widgetManager && !self.widgetManager.canSendResumePauseButton(w ?? null)) {
                    return;
                }

                const pkt = createPacket(ClientPacketId.RESUME_PAUSEBUTTON);
                pkt.packetBuffer.writeShortAddLE(childIndex); // childIndex
                pkt.packetBuffer.writeInt(widgetUid); // widgetId
                queuePacket(pkt);
                // Set meslayerContinueWidget to show "Please wait..."
                if (w && self.widgetManager) {
                    self.widgetManager.meslayerContinueWidget = w;
                    self.widgetManager.invalidateWidgetRender(w);
                }
            },
            onIfTriggerOpLocal: (
                widgetUid: number,
                childIndex: number,
                itemId: number,
                opcodeParam: number,
                args: any[],
            ) => {
                sendIfTriggerOpLocal(widgetUid, childIndex, itemId, opcodeParam, args);
            },
            // Callback for notification display (NOTIFICATIONS_SENDLOCAL opcode)
            // Invokes script 3343 (notification_display_init) with title, body, and color
            onNotificationDisplay: (title: string, body: string, color: number) => {
                const NOTIFICATION_DISPLAY_INIT = 3343;
                try {
                    // Debug: log notifications as they are displayed (helps verify server/task events)
                    try {
                        const t = String(title ?? "");
                        const b = String(body ?? "")
                            .replace(/<br\s*\/?>/gi, "\n")
                            .replace(/\r/g, "");
                        const preview = b.length > 200 ? `${b.slice(0, 200)}…` : b;
                        console.log(
                            `[Notification] display title=\"${t}\" color=0x${(color >>> 0).toString(
                                16,
                            )} body=\"${preview}\"`,
                        );
                    } catch {}

                    // notification_display must be mounted into the toplevel "notifications"
                    // component (e.g., toplevel_osrs_stretch:notifications) before running scripts.
                    self.notificationDisplay.ensureNotificationDisplayMounted();

                    const script = self.cs2Vm?.context?.loadScript?.(NOTIFICATION_DISPLAY_INIT);
                    if (script) {
                        // Script signature: (string title, string body, int colour)
                        self.cs2Vm.run(script, [color], [title, body]);
                    }
                } catch (err) {
                    console.error(`[Notification] display failed:`, err);
                }
            },
        });

        this.initItemSpawnerUi();
        this.initWidgetInteractionController();
        this.initSpellSelectionController();
        this.initAudioVarpController();
        this.initChatControllers();
        this.initPlayerDesignController();
        this.initWidgetActionRouter();
        this.initWidgetInputController();
        this.initWidgetTransmitProcessor();
        this.initNotificationDisplay();
        this.cs2Vm.context.showMobileKeyboard = (hint, keyboardType) => {
            this.mobileChatKeyboard.show(hint, keyboardType);
        };
        this.cs2Vm.context.hideMobileKeyboard = () => this.mobileChatKeyboard.hide();

        // Wire up the deferred callbacks - triggers queued var changes after script execution
        this.cs2Vm.onVarpChange = (varpId) => {
            // Mark var cycle with specific varp ID - handlers fire during processWidgetTransmits()
            markVarTransmit(varpId);
        };
        // Varc changes do not directly drive onMiscTransmit.
        // Misc transmit is driven by engine state updates (run energy, weight, reboot, etc.).
        this.cs2Vm.onVarcChange = null;
        // Wire up input dialog completion callback - sends dialog result to server
        this.cs2Vm.onInputDialogComplete = (type, value) => {
            console.log(`[InputDialog] Complete: type=${type}, value=${value}`);
            if (type === "count") {
                const raw = typeof value === "number" ? value : parseInt(String(value), 10) || 0;
                const amount = Number.isFinite(raw)
                    ? Math.max(-2147483648, Math.min(2147483647, raw | 0))
                    : 0;
                const tradeQuantity = this.pendingTradeQuantityAction;
                if (tradeQuantity) {
                    this.pendingTradeQuantityAction = null;
                    const quantity = Math.min(tradeQuantity.maximum, Math.max(1, amount));
                    if (tradeQuantity.action === "offer") {
                        sendTradeOffer(tradeQuantity.slot, tradeQuantity.itemId, quantity);
                    } else {
                        sendTradeRemove(tradeQuantity.slot, quantity);
                    }
                    return;
                }
                sendBankCustomQuantity(amount);

                // If there's a pending widget action (e.g., Withdraw-X), send it now
                if (this.pendingInputDialogAction) {
                    const { payload, option } = this.pendingInputDialogAction;
                    this.pendingInputDialogAction = null;
                    console.log(
                        `[InputDialog] Sending deferred ${option} action with quantity ${amount}`,
                    );
                    try {
                        sendWidgetAction(payload);
                    } catch (err) {
                        console.warn("[InputDialog] Deferred widget action failed", err);
                    }
                }
            } else if (type === "name") {
                const text = String(value ?? "");
                sendResumeNameDialog(text);
                console.log(`[InputDialog] Name dialog submitted: "${text}"`);
            } else if (type === "string") {
                const text = String(value ?? "");
                sendResumeStringDialog(text);
                console.log(`[InputDialog] String dialog submitted: "${text}"`);
            }
        };

        // Helper to substitute magic args with actual values for widget scripts
        const substituteMagicArgs = (intArgs: number[], widget: any): number[] => {
            return intArgs.map((value) => {
                switch (value) {
                    case ScriptArgMagic.WIDGET_ID:
                        return widget?.uid ?? -1;
                    case ScriptArgMagic.MOUSE_X:
                    case ScriptArgMagic.MOUSE_Y:
                        return 0;
                    case ScriptArgMagic.OP_INDEX:
                        return 1;
                    case ScriptArgMagic.WIDGET_CHILD_INDEX:
                        return -1;
                    case ScriptArgMagic.DRAG_TARGET_ID:
                        return -1;
                    case ScriptArgMagic.DRAG_TARGET_CHILD_INDEX:
                        return -1;
                    default:
                        return value;
                }
            });
        };

        // Helper to run widget scripts
        const runWidgetScript = (scriptId: number, widget: any, triggerArgs: any[]) => {
            /*console.log(
                `[runWidgetScript] scriptId=${scriptId} widget=${widget.groupId}:${widget.fileId} uid=${widget.uid}`,
            );*/
            try {
                const script = this.clientScripts.load(scriptId);
                if (script) {
                    /*console.log(
                        `[runWidgetScript] Script ${scriptId} loaded`,
                    );*/
                    const prevActiveWidget = this.cs2Vm.activeWidget;
                    const prevDotWidget = this.cs2Vm.dotWidget;
                    const prevComponentId = this.cs2Vm.eventContext.componentId;
                    const prevComponentIndex = this.cs2Vm.eventContext.componentIndex;
                    this.cs2Vm.activeWidget = widget;
                    this.cs2Vm.dotWidget = widget;
                    this.cs2Vm.eventContext.componentId =
                        widget?.fileId === -1 && typeof widget?.parentUid === "number"
                            ? widget.parentUid
                            : (widget?.uid ?? -1);
                    this.cs2Vm.eventContext.componentIndex = widget?.childIndex ?? -1;
                    try {
                        const rawIntArgs: number[] = [];
                        const stringArgs: string[] = [];
                        for (let i = 1; i < triggerArgs.length; i++) {
                            const arg = triggerArgs[i];
                            if (typeof arg === "number") {
                                rawIntArgs.push(arg);
                            } else if (typeof arg === "string") {
                                stringArgs.push(arg);
                            }
                        }
                        // Substitute magic args (like WIDGET_ID) with actual values
                        const intArgs = substituteMagicArgs(rawIntArgs, widget);
                        // Log tab-related scripts
                        if (
                            scriptId === 901 ||
                            scriptId === 915 ||
                            scriptId === 916 ||
                            scriptId === 903 ||
                            scriptId === 908 ||
                            scriptId === 250 // music_init
                        ) {
                            console.log(
                                `[runWidgetScript] TAB SCRIPT ${scriptId} widget=${widget.groupId}:${widget.fileId} intArgs=`,
                                intArgs,
                            );
                        }
                        // Debug music_init
                        if (scriptId === 250) {
                            console.log(
                                `[MUSIC] dbRepository:`,
                                !!(this.cs2Vm as any).context?.dbRepository,
                            );
                        }
                        this.cs2Vm.run(script, intArgs, stringArgs);
                        if (scriptId === 250) {
                            console.log(
                                `[MUSIC] After run, dbRowQuery.length:`,
                                (this.cs2Vm as any).dbRowQuery?.length,
                            );
                        }
                    } finally {
                        this.cs2Vm.activeWidget = prevActiveWidget;
                        this.cs2Vm.dotWidget = prevDotWidget;
                        this.cs2Vm.eventContext.componentId = prevComponentId;
                        this.cs2Vm.eventContext.componentIndex = prevComponentIndex;
                    }
                } else {
                    console.warn(`[runWidgetScript] Script ${scriptId} not found in cache`);
                }
            } catch (err) {
                console.error(`[Cs2Vm] Script ${scriptId} crashed:`, err);
            }
        };

        // IMPORTANT (): Cache-loaded listener arrays are in the form [scriptId, ...args].
        // These must be executed via runScriptEvent/executeScriptListener so the VM can split args
        // correctly and substitute magic values. Do NOT pass the scriptId as a normal int arg.
        this.widgetManager.onLoadListener = (_scriptId, widget) => {
            if (Array.isArray(widget?.onLoad)) this.executeScriptListener(widget, widget.onLoad);
        };

        this.widgetManager.onResizeListener = (_scriptId, widget) => {
            if (Array.isArray(widget?.onResize))
                this.executeScriptListener(widget, widget.onResize);
        };

        // Invoker for runtime-set onResize handlers (set via IF_SETONRESIZE / CC_SETONRESIZE)
        this.widgetManager.onResizeInvoker = (widget) => {
            this.cs2Vm.invokeEventHandler(widget, "onResize");
        };

        // Invoker for runtime-set onLoad handlers (set via IF_SETONLOAD / CC_SETONLOAD)
        this.widgetManager.onLoadInvoker = (widget) => {
            this.cs2Vm.invokeEventHandler(widget, "onLoad");
        };

        // Invoker for runtime-set onSubChange handlers (set via IF_SETONSUBCHANGE / CC_SETONSUBCHANGE)
        // Critical for OSRS tab icons: when sub-interfaces are mounted, toplevel_subchange runs
        // which calls toplevel_sidebuttons_enable to show/hide tab icons based on if_hassub
        this.widgetManager.onSubChangeInvoker = (widget) => {
            this.cs2Vm.invokeEventHandler(widget, "onSubChange");
        };

        // Cache-loaded onSubChange handler arrays (Object[] in Java).
        // Critical for tab visibility/highlight logic (toplevel_subchange is cache-defined).
        this.widgetManager.onSubChangeListener = (_scriptId, widget) => {
            if (Array.isArray(widget?.onSubChange))
                this.executeScriptListener(widget, widget.onSubChange);
        };

        // Clean up click targets when interfaces close to prevent stale/ghost click regions
        this.widgetManager.onInterfaceClose = (groupId) => {
            // The click registry is on the WidgetsOverlay's GL canvas, not the main game canvas
            const glCanvas = (this.renderer as any)?.getWidgetsGLCanvas?.();
            if (glCanvas) {
                cleanupInterfaceClickTargets(glCanvas, groupId);
            }
        };

        this.playerAnimController = new PlayerAnimController(
            this.playerEcs,
            this.seqTypeLoader,
            this.seqFrameLoader,
        );
        // PlayerEcs needs SeqType metadata for OSRS-parity movement blocking (sequenceDelay/priority checks).
        this.playerEcs.setSeqTypeLoader?.(this.seqTypeLoader);
        this.npcEcs.setSeqTypeLoader?.(this.seqTypeLoader);
        this.playerMovementSync = new PlayerMovementSync(
            this.playerEcs,
            this.playerAnimController,
            this.resolvePlayerPlane,
            this.npcEcs,
            this.seqTypeLoader,
            (plane: number, x: number, y: number) => this.renderer.getCollisionFlagAt(plane, x, y),
        );
        this.playerSyncManager = new PlayerSyncManager({
            ecs: this.playerEcs,
            movementSync: this.playerMovementSync,
            animController: this.playerAnimController,
            npcEcs: this.npcEcs,
            onSpotAnimation: (event) => {
                try {
                    // Keep cast-spot timing parity when player spot animations come from
                    // binary player sync update blocks instead of standalone `spot` messages.
                    try {
                        const sid = event.serverId | 0;
                        const spotId = event.spotId | 0;
                        if (spotId >= 0) {
                            this.lastCastSpotStartCycleByPlayer.set(sid, event.startCycle | 0);
                            this.lastSpotGraphicByPlayer.set(sid, spotId);
                        } else {
                            this.lastCastSpotStartCycleByPlayer.delete(sid);
                            this.lastSpotGraphicByPlayer.delete(sid);
                        }
                    } catch {}
                    this.renderer?.registerSpotAnimation(event);
                } catch (err) {
                    console.warn("[OsrsClient] registerSpotAnimation failed", err);
                }
            },
            onHitsplat: (payload) => {
                try {
                    console.log(
                        `[hitsplat] ${payload.targetType} ${payload.targetId} damage=${
                            payload.damage
                        } serverTick=${payload.tick} clientTick=${getCurrentTick()}`,
                        payload,
                    );
                } catch {}
                if (this.renderer) this.renderer.registerHitsplat(payload as any);
                else this.hitsplatFlush.queueHitsplat(payload as any);
            },
            onHealthBar: (payload) => {
                try {
                    if (this.renderer) {
                        (this.renderer as any).registerPlayerHealthBarUpdate?.(payload);
                    } else {
                        this.hitsplatFlush.queuePlayerHealthBar(payload as any);
                    }
                } catch (err) {
                    console.warn("[OsrsClient] registerPlayerHealthBarUpdate failed", err);
                }
            },
            onPublicChat: ({ serverId, text, playerType, modIcon, autoChat }) => {
                try {
                    const ecsIndex = this.playerEcs.getIndexForServerId(serverId | 0);
                    const fromName =
                        ecsIndex === undefined ? "" : (this.playerEcs.getName(ecsIndex) ?? "");
                    const icon =
                        typeof modIcon === "number" && modIcon >= 0 ? `<img=${modIcon | 0}>` : "";
                    const sender = `${icon}${fromName}`;
                    const typeInfo = getPlayerTypeInfo(playerType ?? 0);
                    const privileged = typeInfo?.isPrivileged === true;
                    const isAuto = autoChat === true;
                    const messageType = privileged ? (isAuto ? 91 : 1) : isAuto ? 90 : 2;
                    // public chat (player sync block) populates chat history so
                    // `onChatTransmit` listeners (chatbox scripts) behave correctly.
                    chatHistory.addMessage(messageType, text, sender, "");
                    // Mark chat cycle instead of directly triggering handlers.
                    // Use markChatTransmit() which handles timing when async events arrive
                    // after processWidgetTransmits has already run this tick.
                    markChatTransmit();
                } catch {}
            },
            resolveTilePlane: this.resolvePlayerPlane,
            onInteractionIndex: (serverId, interactionIndex) => {
                if ((serverId | 0) === (this.controlledPlayerServerId | 0)) {
                    this.playerInteractionSystem.syncServerInteraction(interactionIndex);
                }
            },
            onAppearanceUpdate: (serverId, data) => {
                try {
                    this.applyBitstreamAppearance(serverId, data);
                } catch (err) {
                    console.warn("[OsrsClient] appearance update failed", err);
                }
            },
            onWorldViewAssignment: (ecsIndex, worldViewId) => {
                if (worldViewId >= 0) {
                    this.worldViewManager.addPlayerToWorldView(worldViewId, ecsIndex);
                }
            },
        });
        this.npcMovementSync = new NpcMovementSync(this.npcEcs);
        this.widgetSessionManager = new WidgetSessionManager();
        this.unsubscribeWidgetEvents = subscribeWidgetEvents((payload) => {
            if (payload.action !== "set_text" && (payload as any).uid !== 10616865) {
                console.log("[OsrsClient] widget event", payload);
            }
            if (payload?.action === "close") {
                console.log("[OsrsClient] Server closing widget", payload.groupId);
                if ((payload.groupId | 0) === 12) {
                    const cfg: any = (globalThis as any).__cs2Trace;
                    if (cfg && cfg.enabled === true) {
                        cfg.enabled = false;
                        console.log("[CS2] trace disabled (bank close)");
                    }
                }
                this.widgetSessionManager.forceClose(payload.groupId);
            } else if (payload?.action === "open") {
                const hadEntry = this.widgetSessionManager.isOpen(payload.groupId);
                const acknowledged = this.widgetSessionManager.acknowledgeOpen(payload.groupId, {
                    modal: payload.modal,
                    triggerOpen: false,
                });
                if (!hadEntry && !acknowledged) {
                    // Server-initiated open with no existing session entry
                    // Create a session entry to handle server-opened widgets (like bank)
                    console.log(
                        "[OsrsClient] creating session for server-initiated widget open",
                        payload.groupId,
                    );
                    this.widgetSessionManager.open(payload.groupId, {
                        modal: payload.modal ?? false,
                        close: (reason) => {
                            console.log(
                                "[OsrsClient] closing server-initiated widget",
                                payload.groupId,
                                reason,
                            );
                            // Notify server when user closes the widget
                            if (reason === "user") {
                                sendWidgetClose(payload.groupId);
                            }
                        },
                    });
                }
            } else if (payload?.action === "set_root") {
                console.log("[OsrsClient] Server setting root interface", payload.groupId);
                if (this.widgetManager) {
                    // Set varc 170 (display mode) based on the root interface
                    // Enum 185 maps: 0->1137 (161 widgets), 1->1101, 2->1067, 3->1175, 4->1293
                    // For interface 161/165, use mode 0 since Enum 1137 has interface 161 tab widgets
                    if (this.varManager) {
                        let displayMode = 0;
                        if (payload.groupId === 161 || payload.groupId === 165) {
                            displayMode = 0; // 161 = resizable, 165 = fullscreen - both use Enum 1137
                        } else if (payload.groupId === 548) {
                            displayMode = 0; // Fixed mode also uses Enum 1137
                        } else if (payload.groupId === 164) {
                            displayMode = 1; // Resizable classic
                        } else if (payload.groupId === 601) {
                            displayMode = 3; // Mobile
                        }
                        this.varManager.setVarcInt(170, displayMode);
                        console.log(`[OsrsClient] Set varc 170 (display mode) = ${displayMode}`);
                        // Initialize varc 171 (selected tab index) to 3 (inventory) if not already set
                        // This matches toplevel_init behavior: if (%varcint171 <= 0) { %varcint171 = 3; }
                        const currentTab = this.varManager.getVarcInt(171);
                        if (currentTab === undefined || currentTab <= 0) {
                            this.varManager.setVarcInt(171, 3);
                            console.log(`[OsrsClient] Set varc 171 (selected tab) = 3 (inventory)`);
                        }
                        if (payload.groupId !== 601) {
                            // The custom desktop sidebar lives outside the canvas, so disable the
                            // cache popout panel reservation that would otherwise shrink gameframe.
                            this.varManager.setVarbit(VARBIT_POPOUT_PANEL_DESKTOP_DISABLED, 1);
                            this.varManager.setVarbit(VARBIT_POPOUT_OPEN, 0);
                        }
                    }
                    this.widgetManager.setRootInterface(payload.groupId);
                    // PERF: Clear CS2 handler caches when switching root interfaces
                    // This prevents memory leaks from stale cached widget references
                    this.cs2Vm.clearHandlerCaches();
                    // Trigger initial onVarTransmit for root interface widgets
                    this.triggerInitialVarTransmitForGroup(payload.groupId);
                    // Mark widgets loaded for transmit processing optimization
                    markWidgetsLoaded();

                    // notification_display (660) is mounted into the toplevel
                    // "notifications" component (toplevel_*:notifications), and its visibility
                    // is controlled by CS2 scripts (3343-3348), not by hiding the root widget.
                    // IMPORTANT: Do not mount immediately. The cache default state of 660 contains
                    // placeholder widgets, and OSRS does not show them. We mount on-demand when a
                    // notification is actually displayed (onNotificationDisplay).
                }
            } else if (payload?.action === "open_sub") {
                console.log(
                    `[OsrsClient] Server opening sub-interface: group ${
                        payload.groupId
                    } into widget ${payload.targetUid} (0x${(payload.targetUid | 0).toString(16)})`,
                );
                // Apply varps/varbits BEFORE opening the interface so scripts can read them.
                if (this.varManager) {
                    this._serverVarpSync = true;
                    try {
                        if (payload.varps) {
                            for (const [id, value] of Object.entries(payload.varps)) {
                                console.log(`[OsrsClient] Setting varp ${id} = ${value}`);
                                this.varManager.setVarp(Number(id), Number(value));
                            }
                        }
                        if (payload.varbits) {
                            for (const [id, value] of Object.entries(payload.varbits)) {
                                console.log(`[OsrsClient] Setting varbit ${id} = ${value}`);
                                this.varManager.setVarbit(Number(id), Number(value));
                            }
                        }
                    } finally {
                        this._serverVarpSync = false;
                    }
                }

                // Execute preScripts BEFORE mounting the interface.
                if (Array.isArray(payload.preScripts) && this.cs2Vm) {
                    for (const ps of payload.preScripts) {
                        const scriptId = ps?.scriptId | 0;
                        const args = ps?.args || [];
                        this.runWidgetScopedClientScript(payload.targetUid, scriptId, args, "pre");
                    }
                }
                if (this.widgetManager) {
                    this.widgetManager.openSubInterface(
                        payload.targetUid,
                        payload.groupId,
                        payload.type,
                    );
                    this.cs2Vm.clearHandlerCaches();
                    markWidgetsLoaded();
                    if (Array.isArray(payload.postScripts) && this.cs2Vm) {
                        for (const ps of payload.postScripts) {
                            const scriptId = ps?.scriptId | 0;
                            const args = ps?.args || [];
                            this.runWidgetScopedClientScript(
                                payload.targetUid,
                                scriptId,
                                args,
                                "post",
                            );
                        }
                    }
                    this.triggerInitialVarTransmitForGroup(payload.groupId);
                    if (Array.isArray(payload.hiddenUids)) {
                        for (const rawUid of payload.hiddenUids) {
                            const uid = Number(rawUid) | 0;
                            const w = this.widgetManager.getWidgetByUid(uid);
                            if (!w) continue;
                            if (w.hidden === true && w.isHidden === true) continue;
                            w.isHidden = true;
                            w.hidden = true;
                            this.widgetManager.invalidateWidgetRender(w);
                        }
                    }
                    if ((payload.groupId | 0) === ITEM_SPAWNER_MODAL_GROUP_ID) {
                        this.itemSpawnerUi.onInterfaceOpened();
                    }
                }
            } else if (payload?.action === "close_sub") {
                const targetUid = Number(payload.targetUid) | 0;
                console.log(
                    `[OsrsClient] Server closing sub-interface at widget ${targetUid} (ESC or close button)`,
                );

                const closingParent = this.widgetManager?.getSubInterface(targetUid);
                const closingGroupId = closingParent?.group ?? -1;

                console.log(`[OsrsClient] Closing group ID: ${closingGroupId}`);

                if (this.widgetManager) {
                    this.widgetManager.closeSubInterface(targetUid);
                    this.cs2Vm.clearHandlerCaches();
                    if (this.widgetManager.meslayerContinueWidget) {
                        this.widgetManager.invalidateWidgetRender(
                            this.widgetManager.meslayerContinueWidget,
                        );
                        this.widgetManager.meslayerContinueWidget = null;
                    }
                }

                if (closingGroupId === ITEM_SPAWNER_MODAL_GROUP_ID) {
                    this.itemSpawnerUi.onInterfaceClosed();
                }
            } else if (payload?.action === "set_text") {
                const uid = Number(payload.uid) | 0;
                const text = typeof payload.text === "string" ? payload.text : String(payload.text);
                const w = this.widgetManager?.getWidgetByUid(uid);
                if (w) {
                    if (!this.itemSpawnerUi.handleSetText(uid, text)) {
                        w.text = text;
                        markWidgetInteractionDirty(w);
                        this.widgetManager.invalidateWidgetRender(w);
                    }
                }
            } else if (payload?.action === "set_hidden") {
                const uid = Number(payload.uid) | 0;
                const hidden = !!payload.hidden;
                const w = this.widgetManager?.getWidgetByUid(uid);
                if (w && this.widgetManager && (w.hidden !== hidden || w.isHidden !== hidden)) {
                    w.isHidden = hidden;
                    w.hidden = hidden;

                    // hiding does not affect layout, showing can (we skip layout while hidden).
                    if (hidden) {
                        this.widgetManager.invalidateWidgetRender(w, "server-set-hidden");
                    } else {
                        this.widgetManager.invalidateWidget(w, "server-set-hidden");
                        // When a previously hidden interface becomes visible,
                        // pending transmit handlers (var/inv/stat) must be processed even if no new
                        // events occurred this tick.
                        markWidgetsLoaded();
                    }
                }
            } else if (payload?.action === "set_item") {
                const uid = Number(payload.uid) | 0;
                const itemId = Number(payload.itemId) | 0;
                const quantityRaw = payload.quantity;
                const quantity =
                    typeof quantityRaw === "number" && Number.isFinite(quantityRaw)
                        ? Math.max(1, quantityRaw | 0)
                        : 1;

                const w = this.widgetManager?.getWidgetByUid(uid);
                if (w) {
                    const existingType = Number((w as any).type) | 0;
                    const normalizedItemId = itemId >= 0 ? itemId : -1;
                    const normalizedQuantity = normalizedItemId >= 0 ? quantity : 0;

                    if (existingType === 5) {
                        (w as any).itemId = normalizedItemId;
                        (w as any).itemQuantity = normalizedQuantity;
                        if (typeof (w as any).itemQuantityMode !== "number") {
                            (w as any).itemQuantityMode = 2;
                        }
                        markWidgetInteractionDirty(w);
                        this.widgetManager.invalidateWidgetRender(w);
                    } else if (normalizedItemId < 0) {
                        (w as any).itemId = -1;
                        (w as any).itemQuantity = 0;
                        (w as any).modelId = -1;
                        markWidgetInteractionDirty(w);
                        this.widgetManager.invalidateWidgetRender(w);
                    } else {
                        let obj = this.objTypeLoader?.load?.(normalizedItemId);
                        // For stackable items (coins, etc.), get the correct model
                        // based on quantity using countObj/countCo arrays.
                        // The server sends the amountOrZoom value which determines the model.
                        if (
                            obj &&
                            typeof (obj as any).getCountObj === "function" &&
                            this.objTypeLoader
                        ) {
                            obj = (obj as any).getCountObj(this.objTypeLoader, quantity);
                        }
                        const modelId =
                            typeof (obj as any)?.model === "number" && (obj as any).model >= 0
                                ? ((obj as any).model as number) | 0
                                : Math.max(0, normalizedItemId | 0);
                        (w as any).type = 6;
                        (w as any).modelId = modelId;
                        (w as any).itemId = normalizedItemId;
                        (w as any).itemQuantity = quantity;
                        (w as any).modelOrthog = true;
                        markWidgetInteractionDirty(w);
                        this.widgetManager.invalidateWidgetRender(w);
                    }
                }
            } else if (payload?.action === "set_npc_head") {
                const uid = Number(payload.uid) | 0;
                const npcId = Number(payload.npcId) | 0;
                const w = this.widgetManager?.getWidgetByUid(uid);
                if (w) {
                    (w as any).type = 6;
                    (w as any).modelType = 2;
                    (w as any).modelId = npcId;
                    (w as any).isNpcChathead = npcId >= 0;
                    (w as any).npcTypeId = npcId >= 0 ? npcId : undefined;
                    (w as any).isPlayerChathead = false;
                    (w as any).playerAppearance = undefined;
                    this.widgetManager.invalidateWidgetRender(w);
                }
            } else if (payload?.action === "set_animation") {
                const uid = Number(payload.uid) | 0;
                const animationId = Number(payload.animationId) | 0;
                const w = this.widgetManager?.getWidgetByUid(uid);
                if (w) {
                    (w as any).animationId = animationId;
                    (w as any).sequenceId = animationId;
                    this.widgetManager.invalidateWidgetRender(w);
                }
            } else if (payload?.action === "set_player_head") {
                const uid = Number(payload.uid) | 0;
                const w = this.widgetManager?.getWidgetByUid(uid);
                if (w) {
                    const idx = this.playerEcs.getIndexForServerId(this.controlledPlayerServerId);
                    const appearance =
                        idx !== undefined ? this.playerEcs.getAppearance(idx) : undefined;
                    (w as any).type = 6;
                    (w as any).modelType = 3;
                    (w as any).modelId = -1;
                    (w as any).isNpcChathead = false;
                    (w as any).npcTypeId = undefined;
                    (w as any).isPlayerChathead = true;
                    (w as any).playerAppearance = appearance
                        ? {
                              gender: appearance.gender,
                              colors: Array.from(appearance.colors ?? []),
                              kits: Array.from(appearance.kits ?? []),
                              equip: Array.from(appearance.equip ?? []),
                          }
                        : undefined;
                    this.widgetManager.invalidateWidgetRender(w);
                }
            } else if (payload?.action === "set_quest_list") {
                if (this.widgetManager && Array.isArray(payload.groups)) {
                    applyQuestListWidgetGroups(
                        this.widgetManager,
                        payload.groups as QuestListWidgetGroup[],
                    );
                    markWidgetsLoaded();
                }
            } else if (payload?.action === "set_flags") {
                // Set widget flags override (enables/disables click permissions)
                const uid = Number(payload.uid) | 0;
                const flags = Number(payload.flags) | 0;
                const w = this.widgetManager?.getWidgetByUid(uid);
                if (w && this.widgetManager) {
                    this.widgetManager.setWidgetFlagsOverride(w, flags);
                    markWidgetInteractionDirty(w);
                    this.widgetManager.invalidateWidgetRender(w, "flags");
                }
            } else if (payload?.action === "set_flags_range") {
                // IF_SETEVENTS packet - sets flags for a range of child indices.
                // Stores flags with keys:
                //   key = (uid << 32) | childIndex for each childIndex in [from, to]
                // Dynamic children (CC_CREATE) have id=parentUid and childIndex from the script.
                // When getWidgetFlags is called on a dynamic child, it looks up (child.id << 32) | child.childIndex.
                const uid = Number(payload.uid) | 0;
                // -1 may arrive as 65535 (0xFFFF) due to unsigned transmission.
                // Static widgets use childIndex=-1, so normalize 65535 back to -1.
                let fromSlot = Number(payload.fromSlot) | 0;
                let toSlot = Number(payload.toSlot) | 0;
                if (fromSlot === 65535) fromSlot = -1;
                if (toSlot === 65535) toSlot = -1;
                const flags = Number(payload.flags) | 0;
                if (this.widgetManager) {
                    const parent = this.widgetManager.getWidgetByUid(uid);
                    const children = Array.isArray((parent as any)?.children)
                        ? ((parent as any).children as any[])
                        : [];
                    // Set flags for each childIndex in the range [fromSlot, toSlot]
                    // The uid becomes the 'id' component of the key (matches dynamic child's id field)
                    for (let childIndex = fromSlot; childIndex <= toSlot; childIndex++) {
                        this.widgetManager.setWidgetFlagsByKey(uid, childIndex, flags);
                        const child = childIndex >= 0 ? children[childIndex] : parent;
                        if (child) {
                            markWidgetInteractionDirty(child);
                            this.widgetManager.invalidateWidgetRender(child, "flags-range");
                        }
                    }
                    if (parent) {
                        markWidgetInteractionDirty(parent);
                        this.widgetManager.invalidateWidgetRender(parent, "flags-range");
                    }
                }
            } else if (payload?.action === "run_script") {
                // RUNCLIENTSCRIPT packet - run a CS2 script with arguments
                const scriptId = Number(payload.scriptId) | 0;
                const args = payload.args;
                if (scriptId > 0 && this.cs2Vm && Array.isArray(args)) {
                    if (
                        (scriptId === SCRIPT_HIGHLIGHT_SCREEN_COMPONENT ||
                            scriptId === SCRIPT_HIGHLIGHT_TEXTBOX_DEFAULT) &&
                        this.widgetManager?.meslayerContinueWidget
                    ) {
                        this.widgetManager.invalidateWidgetRender(
                            this.widgetManager.meslayerContinueWidget,
                            "tutorial-highlight-resume",
                        );
                        this.widgetManager.meslayerContinueWidget = null;
                    }
                    console.log(`[OsrsClient] run_script: scriptId=${scriptId}, args=`, args);
                    // Apply varps/varbits BEFORE running the script so it can read them
                    if (this.varManager) {
                        this._serverVarpSync = true;
                        try {
                            if (payload.varps) {
                                for (const [id, value] of Object.entries(payload.varps)) {
                                    console.log(
                                        `[OsrsClient] run_script: Setting varp ${id} = ${value}`,
                                    );
                                    this.varManager.setVarp(Number(id), Number(value));
                                }
                            }
                            if (payload.varbits) {
                                for (const [id, value] of Object.entries(payload.varbits)) {
                                    console.log(
                                        `[OsrsClient] run_script: Setting varbit ${id} = ${value}`,
                                    );
                                    this.varManager.setVarbit(Number(id), Number(value));
                                }
                            }
                        } finally {
                            this._serverVarpSync = false;
                        }
                    }
                    const script = this.cs2Vm.context.loadScript(scriptId);
                    if (script) {
                        // Separate int and string args
                        const intArgs: number[] = [];
                        const stringArgs: string[] = [];
                        for (const arg of args) {
                            if (typeof arg === "number") {
                                intArgs.push(arg | 0);
                            } else if (typeof arg === "string") {
                                stringArgs.push(arg);
                            }
                        }

                        try {
                            // Optional CS2 trace: only if already enabled by the user.
                            const traceCfg: any = (globalThis as any).__cs2Trace;
                            const shouldTrace = !!traceCfg?.enabled;
                            let prevTraceEnabled: boolean | undefined;
                            let prevTraceScripts: any;
                            let prevTraceLines: any;
                            let prevTraceMaxLines: any;
                            if (shouldTrace) {
                                prevTraceEnabled = traceCfg.enabled;
                                prevTraceScripts = traceCfg.scripts;
                                prevTraceLines = traceCfg.lines;
                                prevTraceMaxLines = traceCfg.maxLines;
                                traceCfg.scripts = traceCfg.scripts ?? null;
                                traceCfg.lines = 0;
                                traceCfg.maxLines = traceCfg.maxLines ?? 2000;
                                (globalThis as any).__cs2Trace = traceCfg;
                            }
                            // RUNCLIENTSCRIPT has no event component context. Do not inherit
                            // active/dot widgets left by previous UI event scripts; mounted
                            // interface coordinate helpers depend on the current script group.
                            this.cs2Vm.activeWidget = null;
                            this.cs2Vm.dotWidget = null;
                            try {
                                this.cs2Vm.run(script, intArgs, stringArgs);
                            } finally {
                                this.cs2Vm.activeWidget = null;
                                this.cs2Vm.dotWidget = null;
                            }
                            if (shouldTrace && traceCfg) {
                                traceCfg.enabled = prevTraceEnabled;
                                traceCfg.scripts = prevTraceScripts;
                                traceCfg.lines = prevTraceLines;
                                traceCfg.maxLines = prevTraceMaxLines;
                                (globalThis as any).__cs2Trace = traceCfg;
                            }
                            // CRITICAL: Invalidate widgets after script runs so changes are rendered.
                            // CS2 scripts modify widget properties (text, hidden, position, etc.)
                            // but without invalidation the render system won't repaint.
                            if (this.widgetManager) {
                                this.widgetManager.invalidateAll();
                            }
                        } catch (err) {
                            console.error(
                                `[OsrsClient] run_script error for script ${scriptId}:`,
                                err,
                            );
                        }
                    } else {
                        console.warn(`[OsrsClient] run_script: script ${scriptId} not found`);
                    }
                }
            } else if ((payload as any)?.action === "set_varbits") {
                // Server-initiated varbit sync without running a script
                // Used when server needs to update varbits but client handles UI via onVartransmit
                if (this.varManager && (payload as any).varbits) {
                    console.log("[OsrsClient] set_varbits: Syncing varbits from server");
                    this._serverVarpSync = true;
                    try {
                        for (const [id, value] of Object.entries((payload as any).varbits)) {
                            console.log(
                                `[OsrsClient] set_varbits: Setting varbit ${id} = ${value}`,
                            );
                            this.varManager.setVarbit(Number(id), Number(value));
                        }
                    } finally {
                        this._serverVarpSync = false;
                    }
                }
            }
        });
        this.unsubscribeNpcInfo = subscribeNpcInfo((payload: NpcInfoPayload) => {
            try {
                this.applyNpcInfo(payload);
            } catch (err) {
                console.warn("[OsrsClient] npc_info error", err);
            }
        });
        // Subscribe to server-side GFX (spot) messages and forward to renderer
        try {
            const unsubSpot = subscribeSpot((payload: SpotAnimationPayload) => {
                try {
                    // spot animation delay is in client cycles (Client.cycle units).
                    const delayCycles = Math.max(0, payload.delay ?? 0);
                    const startCycle = getClientCycle() + delayCycles;

                    if (typeof payload.playerId === "number") {
                        const sid = payload.playerId | 0;
                        const ecsIndex = this.playerEcs.getIndexForServerId(sid);
                        if (ecsIndex === undefined) return;
                        // Record cast spot start tick for this player (used to sync projectile release)
                        try {
                            this.lastCastSpotStartCycleByPlayer.set(sid, startCycle | 0);
                            // Track last active spot anim id for telemetry
                            this.lastSpotGraphicByPlayer.set(sid, payload.spotId | 0);
                        } catch {}
                        this.renderer?.registerSpotAnimation({
                            serverId: sid,
                            ecsIndex,
                            spotId: payload.spotId | 0,
                            height: (payload.height ?? 0) | 0,
                            startCycle,
                        });
                    } else if (typeof payload.npcId === "number") {
                        const npcServerId = payload.npcId | 0;
                        (this.renderer as any)?.registerNpcSpotAnimation?.({
                            npcServerId,
                            spotId: payload.spotId | 0,
                            height: (payload.height ?? 0) | 0,
                            startCycle,
                        });
                    } else if (payload.tile) {
                        (this.renderer as any)?.registerWorldSpotAnimation?.({
                            spotId: payload.spotId | 0,
                            tile: payload.tile,
                            height: (payload.height ?? 0) | 0,
                            startCycle,
                        });
                    }
                } catch {}
            });
            this.unsubscribeSpot = unsubSpot;
        } catch {}
        // Subscribe to server-side sound messages and play them
        try {
            const unsubSound = subscribeSound(
                (payload: {
                    soundId: number;
                    x?: number;
                    y?: number;
                    level?: number;
                    loops?: number;
                    delay?: number;
                    radius?: number;
                    attenuation?: number;
                }) => {
                    try {
                        if (!this.soundEffectSystem) return;
                        const hasPosition = payload.x !== undefined && payload.y !== undefined;
                        // Wire loops: n = play n times; skip if zero
                        const wireLoops = payload.loops !== undefined ? payload.loops | 0 : 1;
                        if (wireLoops <= 0) return;
                        // Radius in tiles -> scene units (128 per tile)
                        const radiusScene =
                            payload.radius !== undefined && payload.radius > 0
                                ? (payload.radius | 0) * 128
                                : undefined;
                        this.soundEffectSystem.playSoundEffect(payload.soundId, {
                            loops: wireLoops - 1,
                            delayMs: payload.delay !== undefined ? payload.delay * 20 : undefined,
                            position: hasPosition
                                ? {
                                      x: ((payload.x! | 0) * 128 + 64) | 0,
                                      y: ((payload.y! | 0) * 128 + 64) | 0,
                                      z: (((payload.level ?? 0) | 0) * 128) | 0,
                                  }
                                : undefined,
                            radius: radiusScene,
                            attenuation: payload.attenuation,
                        });
                    } catch (err) {
                        console.warn("[OsrsClient] sound playback failed", err);
                    }
                },
            );
            this.unsubscribeSound = unsubSound;
        } catch {}
        // Subscribe to server-side play_song messages for music track playback
        try {
            this.unsubscribePlaySong = subscribePlaySong((payload) => {
                if (this.musicSystem && payload.trackId >= 0) {
                    const fadeOutDelay = payload.fadeOutDelay ?? 0;
                    const fadeOutDuration = payload.fadeOutDuration ?? 100;
                    const fadeInDelay = payload.fadeInDelay ?? 100;
                    const fadeInDuration = payload.fadeInDuration ?? 0;
                    this.musicSystem.playSong(
                        payload.trackId,
                        fadeOutDelay,
                        fadeOutDuration,
                        fadeInDelay,
                        fadeInDuration,
                    );
                }
                // Note: "Now Playing" text is updated via IF_SETTEXT from server ()
            });
        } catch {}
        // Subscribe to server-side play_jingle messages for jingle playback (level-ups, quests, etc.)
        try {
            this.unsubscribePlayJingle = subscribePlayJingle((payload) => {
                if (this.musicSystem && payload.jingleId >= 0) {
                    this.musicSystem.playJingle(payload.jingleId, payload.delay ?? 0);
                }
            });
        } catch {}
        // Subscribe to chat messages to add to history and mark chatCycle for transmit
        try {
            this.unsubscribeChatMessages = subscribeChatMessages((msg) => {
                // Add message to chat history for CS2 scripts to query
                const isTradeRequest = msg.chatType === ChatMessageType.TRADE_REQUEST;
                if (isTradeRequest && msg.from && msg.playerId !== undefined) {
                    this.tradeRequestTargetsByName.set(
                        msg.from.trim().toLowerCase(),
                        msg.playerId | 0,
                    );
                }
                const text = isTradeRequest && msg.from ? `${msg.from} ${msg.text}` : msg.text;
                chatHistory.addMessage(
                    msg.chatType ?? msg.messageType,
                    text,
                    msg.from ?? "",
                    msg.prefix ?? "",
                );
                // Note: chatCycle is now marked by onMessageAdded callback below
            });
            // Set up callback to mark chat cycle when ANY message is added (including from CS2 MES opcode)
            chatHistory.onMessageAdded = () => {
                // Mark chat cycle - handlers fire during processWidgetTransmits()
                // Use markChatTransmit() which handles the timing correctly when
                // async events arrive after processWidgetTransmits has already run
                markChatTransmit();
            };
            // Expose chat history for debugging
            (window as any).__chatHistory = chatHistory;
            // Expose test function for debugging chat
            (window as any).__testChat = (text: string = "Hello world!") => {
                console.log("[Chat Test] Adding public chat message...");
                const uid = chatHistory.addMessage("public", text, "TestPlayer", "");
                console.log("[Chat Test] Added with uid:", uid);
                console.log("[Chat Test] Public chat length:", chatHistory.getLength(2));
                console.log("[Chat Test] Latest message:", chatHistory.getFullByTypeAndLine(2, 0));
                // Mark chat cycle (uses markChatTransmit for proper timing)
                markChatTransmit();
                console.log("[Chat Test] Marked chatCycle for transmit");
            };
            // Expose test function for debugging notification_display (interface 660)
            (window as any).__testNotification = (
                title: string = "Test",
                message: string = "<col=ffffff>Hello</col>",
                color: number = 0xff981f,
            ) => {
                this.cs2Vm?.context?.onNotificationDisplay?.(title, message, color | 0);
            };
        } catch {}
        try {
            this.unsubscribeFriendsChat = subscribeFriendsChat((snapshot) => {
                const channel = snapshot.channel;
                this.cs2Vm.context.friendList = snapshot.friends.map((friend) => ({ ...friend }));
                this.cs2Vm.context.ignoreList = snapshot.ignores.map((ignored) => ({ ...ignored }));
                this.cs2Vm.context.clanMembers =
                    channel?.members.map((member) => ({ ...member })) ?? [];
                this.cs2Vm.context.clanName = channel?.name ?? "";
                this.cs2Vm.context.clanOwner = channel?.owner ?? "";
                this.cs2Vm.context.clanRank = channel?.localRank ?? 0;
                this.cs2Vm.context.friendsChatMinKick = channel?.minKickRank ?? 0;
                markFriendTransmit();
                markClanTransmit();
            });
        } catch {}
        // Subscribe to loot notifications and display via CS2 notification system
        try {
            this.unsubscribeNotifications = subscribeNotifications((event) => {
                // Debug: log receipt of server notification events
                try {
                    const title = (event as any).title ? String((event as any).title) : "";
                    const msg = String(event.message ?? "")
                        .replace(/<br\s*\/?>/gi, "\n")
                        .replace(/\r/g, "");
                    const preview = msg.length > 200 ? `${msg.slice(0, 200)}…` : msg;
                    console.log(
                        `[Notification] recv kind=${event.kind}${
                            title ? ` title=\"${title}\"` : ""
                        } message=\"${preview}\"`,
                    );
                } catch {}

                const defaultTitles: Partial<Record<typeof event.kind, string>> = {
                    loot: "Loot",
                    league_task: "League Task Completed",
                    collection_log: "Collection log",
                    achievement: "Achievement",
                    level_up: "Level up",
                    quest: "Quest",
                    warning: "Warning",
                    info: "Info",
                };
                const title = event.title || defaultTitles[event.kind] || "";
                const body = event.message;
                const color = 0xff981f;
                this.cs2Vm?.context?.onNotificationDisplay?.(title, body, color);
            });
        } catch {}
        // Subscribe to skills updates to populate skillsMap for CS2 stat functions
        try {
            this.unsubscribeSkills = subscribeSkills((update) => {
                for (const entry of update.skills) {
                    this.skillsMap.set(entry.id, {
                        currentLevel: entry.currentLevel ?? entry.baseLevel ?? 1,
                        baseLevel: entry.baseLevel ?? 1,
                        xp: entry.xp ?? 0,
                    });
                    // Mark each changed stat ID for trigger checking
                    markStatTransmit(entry.id);
                }

                // "Depends on combat levels" comparisons use the local player's combat level.
                // Compute it from base skill levels (Combat level formula).
                const getBase = (skillId: SkillId): number =>
                    this.skillsMap.get(skillId)?.baseLevel ?? 1;
                const attack = getBase(SkillId.Attack);
                const strength = getBase(SkillId.Strength);
                const defence = getBase(SkillId.Defence);
                const hitpoints = getBase(SkillId.Hitpoints);
                const prayer = getBase(SkillId.Prayer);
                const ranged = getBase(SkillId.Ranged);
                const magic = getBase(SkillId.Magic);

                const base = 0.25 * (defence + hitpoints + Math.floor(prayer / 2));
                const melee = 0.325 * (attack + strength);
                const range = 0.325 * Math.floor(ranged * 1.5);
                const mage = 0.325 * Math.floor(magic * 1.5);
                const combatLevel = Math.floor(base + Math.max(melee, range, mage));
                const clampedCombat = clamp(combatLevel, 3, 126);
                ClientState.localPlayerCombatLevel = clampedCombat;
                // Set varcint for CS2 scripts (account_summary_update_combatlevel uses this)
                this.varManager?.setVarcInt(VARC_COMBAT_LEVEL, clampedCombat);
                // Set varbit for combat styles tab (combat_interface_setup uses this)
                this.varManager?.setVarbit(VARBIT_COMBATLEVEL_TRANSMIT, clampedCombat);
            });
        } catch {}
        // Subscribe to run energy updates to sync varp 173 (option_run) and run energy percent
        // This enables the CS2 scripts to update the run orb visual correctly
        try {
            this.unsubscribeRunEnergy = subscribeRunEnergy((state) => {
                // Update run energy and weight values for CS2 opcodes
                this.runEnergyPercent = state.percent;
                this.runEnergyUnits = state.units;
                this.playerWeight = state.weight;
                // Sync run mode from server - update varp 173 (OPTION_RUN)
                const serverRunning = state.running;
                if (this.runMode !== serverRunning) {
                    this.runMode = serverRunning;
                }
                // Set varp to match server state - this triggers CS2 if_setonvartransmit handlers
                // Use _serverVarpSync flag to prevent sending this change back to the server
                const currentVarpValue = this.varManager?.getVarp(VARP_OPTION_RUN) ?? 0;
                const newVarpValue = serverRunning ? 1 : 0;
                if (currentVarpValue !== newVarpValue) {
                    this._serverVarpSync = true;
                    try {
                        this.varManager?.setVarp(VARP_OPTION_RUN, newVarpValue);
                    } finally {
                        this._serverVarpSync = false;
                    }
                }
                // Set varbit 25 (stamina_active) for CS2 orb scripts
                // This allows orbs_update_runmode to show the correct run icon when stamina is active
                const staminaActive = state.stamina && state.stamina.ticks > 0 ? 1 : 0;
                const currentStamina = this.varManager?.getVarbit(VARBIT_STAMINA_ACTIVE) ?? 0;
                if (currentStamina !== staminaActive) {
                    this._serverVarpSync = true;
                    try {
                        this.varManager?.setVarbit(VARBIT_STAMINA_ACTIVE, staminaActive);
                    } finally {
                        this._serverVarpSync = false;
                    }
                }
                // Mark misc cycle to update run orb display
                // The orbs_update_runenergy script uses if_setonmisctransmit to refresh when energy changes
                markMiscTransmit();
            });
        } catch {}
        try {
            if (typeof window !== "undefined") {
                (window as any).__osrsClient = this;
            }
        } catch {}
        this.playerEcs.enableMovementDebug(false);

        // Provide real server clock to ECS telemetry so rows carry serverTick/serverPhase
        try {
            this.playerEcs.setTelemetrySampleSource?.("clientTick");
            this.playerEcs.setTelemetryServerClockProvider?.(() => {
                try {
                    const p = getServerTickPhaseNow();
                    return {
                        tick: getCurrentTick() | 0,
                        phase: Math.max(0, Math.min(1, p?.phase ?? 0)),
                    };
                } catch {
                    return { tick: getCurrentTick() | 0, phase: 0 };
                }
            });
        } catch {}

        // Subscribe to server path debug events
        try {
            this.unsubscribePathDebug = subscribeServerPath((wpts) => {
                this.serverPathWaypoints = Array.isArray(wpts)
                    ? wpts.map((w) => ({ x: w.x | 0, y: w.y | 0 }))
                    : undefined;
                // Debug: compare server-sent segment path vs client movement queue.
                try {
                    const enabled = (globalThis as any).__pathDebug === true;
                    if (!enabled) return;
                    const sid = this.controlledPlayerServerId | 0;
                    const state = this.playerMovementSync.getState(sid);
                    const pending: any[] = [];
                    const last = state?.getLastSteps?.() ?? [];
                    console.log("[path-debug] serverPath", this.serverPathWaypoints);
                    console.log(
                        "[path-debug] clientState",
                        state
                            ? {
                                  tile: {
                                      x: state.tileX | 0,
                                      y: state.tileY | 0,
                                      level: state.level | 0,
                                  },
                                  pending: pending.map((s: any) => ({
                                      x: s.tile?.x | 0,
                                      y: s.tile?.y | 0,
                                      run: !!s.run,
                                      traversal:
                                          typeof s.traversal === "number"
                                              ? s.traversal | 0
                                              : undefined,
                                  })),
                                  last: last.map((s: any) => ({
                                      x: s.tile?.x | 0,
                                      y: s.tile?.y | 0,
                                      run: !!s.run,
                                      traversal:
                                          typeof s.traversal === "number"
                                              ? s.traversal | 0
                                              : undefined,
                                  })),
                              }
                            : { missing: true },
                    );
                } catch {}
            });
        } catch {}

        // Server-authoritative movement: follow server sync updates (server is source of truth)
        try {
            this.playerEcs.setServerAuthoritative?.(true);
            // Align interpolation to server tick length for consistent speed
            this.trackServerSubscription(
                subscribeWelcome(({ tickMs }) => {
                    try {
                        this.playerAnimController.reset();
                    } catch {}
                    try {
                        this.playerMovementSync.setServerTickMs(tickMs | 0);
                    } catch {}
                }),
            );
            // Handle websocket disconnection - show "Connection lost" message while reconnecting
            this.trackServerSubscription(
                subscribeDisconnect(({ willReconnect }) => {
                    try {
                        if (willReconnect) {
                            // Show "Connection lost - attempting to reestablish" message
                            this.updateGameState(GameState.CONNECTION_LOST);
                        } else {
                            // Intentional disconnect or first disconnect - go to login
                            this.updateGameState(GameState.LOGIN_SCREEN);
                        }
                    } catch {}
                }),
            );
            // Return to login screen when reconnection attempts are exhausted
            this.trackServerSubscription(
                subscribeReconnectFailed(() => {
                    try {
                        // failed connect shows timeout on login screen.
                        if (this.gameState === GameState.CONNECTING) {
                            this.loginState.loginIndex = LoginIndex.TRY_AGAIN;
                            this.loginState.setResponse(
                                "",
                                "Connection timed out.",
                                "Please try using a different world.",
                                "",
                            );
                            this.updateGameState(GameState.LOGIN_SCREEN);
                            return;
                        }

                        // In-game reconnect failure returns to clean login screen.
                        this.loginState.reset();
                        this.updateGameState(GameState.LOGIN_SCREEN);
                    } catch {}
                }),
            );
            // Promote buffered steps on server tick to keep clients in sync
            this.trackServerSubscription(
                subscribeTick((tick) => {
                    try {
                        this.playerSyncManager.advanceServerTick(tick | 0);
                    } catch (err) {
                        console.warn("[OsrsClient] player sync tick failed", err);
                    }
                    try {
                        (this.playerEcs as any).onServerTick?.();
                    } catch {}
                    // Prune walked waypoints from path debug overlay
                    try {
                        this.pruneWalkedWaypoints();
                    } catch {}
                    if (this.groundItemMeshesPending || this.groundItems.getAllStacks().length > 0) {
                        this.refreshGroundItemMeshes();
                    }
                }),
            );
            // Capture server-assigned ID as soon as handshake arrives
            this.trackServerSubscription(
                subscribeHandshake(({ id, name, appearance, chatIcons, chatPrefix, isAdmin }) => {
                    try {
                        // Store the local player name for CS2 scripts (CHAT_PLAYERNAME)
                        if (name) {
                            this.localPlayerName = name;
                            // Set varbit 8119 (has_displayname_transmitter) to 1 so chat scripts know we have a name
                            this.varManager.setVarbit(8119, 1);
                        }
                        this.localChatNameIcons = Array.isArray(chatIcons)
                            ? chatIcons
                                  .map((icon) => Number(icon))
                                  .filter((icon) => Number.isFinite(icon) && icon >= 0)
                                  .map((icon) => icon | 0)
                            : [];
                        this.localChatNamePrefix = typeof chatPrefix === "string" ? chatPrefix : "";
                        this.localPlayerIsAdmin =
                            typeof isAdmin === "boolean"
                                ? isAdmin
                                : this.localChatNameIcons.includes(1);
                        if (this.controlledPlayerServerId === -1) {
                            this.controlledPlayerServerId = id | 0;
                        } else if (this.controlledPlayerServerId !== (id | 0)) {
                            try {
                                this.playerAnimController.release(this.controlledPlayerServerId);
                            } catch {}
                            // Rebind existing controlled-player mapping to the assigned id
                            this.playerEcs.reassignServerId(this.controlledPlayerServerId, id | 0);
                            this.controlledPlayerServerId = id | 0;
                        }
                        // If an ECS slot already exists, apply any handshake-provided name/appearance
                        let ecsIndex = this.playerEcs.getIndexForServerId(
                            this.controlledPlayerServerId,
                        );
                        // If none exists yet (handshake arrived before first sync), allocate now so
                        // we can apply appearance immediately; position will snap on first `player_sync`.
                        if (ecsIndex === undefined) {
                            ecsIndex = this.playerEcs.allocatePlayer(this.controlledPlayerServerId);
                        }
                        if (ecsIndex !== undefined) {
                            if (name) this.playerEcs.setName(ecsIndex, name);
                            if (appearance) {
                                try {
                                    // Sync equipment inventory for local player
                                    const pa = this.buildPlayerAppearanceFromPayload(
                                        appearance,
                                        true,
                                    );
                                    if (pa) {
                                        this.playerEcs.setAppearance(ecsIndex, pa);
                                        // Prebuild base model in ECS so renderer doesn't construct models
                                        this.playerEcs.ensureBaseForIndex(ecsIndex, {
                                            idkTypeLoader: this.idkTypeLoader,
                                            objTypeLoader: this.objTypeLoader,
                                            modelLoader: this.modelLoader,
                                            textureLoader: this.textureLoader,
                                            npcTypeLoader: this.npcTypeLoader,
                                            seqTypeLoader: this.seqTypeLoader,
                                            seqFrameLoader: this.seqFrameLoader,
                                            skeletalSeqLoader:
                                                this.loaderFactory?.getSkeletalSeqLoader?.(),
                                            varManager: this.varManager,
                                            basTypeLoader: this.basTypeLoader,
                                        });
                                    }
                                } catch {}
                            }
                        }

                        // Mark handshake as complete for the loading tracker
                        // This allows the LOADING_GAME -> LOGGED_IN transition
                        this.loadingTracker.markComplete(LoadingRequirement.HANDSHAKE_COMPLETE);
                    } catch {}
                }),
            );

            this.trackServerSubscription(
                subscribeRebuildRegion((payload) => {
                    try {
                        console.log(
                            `[OsrsClient] REBUILD_REGION received: regionX=${payload.regionX} regionY=${payload.regionY} regions=${payload.mapRegions.length}`,
                        );
                        ClientState.inInstance = true;
                        ClientState.instanceTemplateChunks = payload.templateChunks;
                        if (this.renderer && "loadInstanceScene" in this.renderer) {
                            (this.renderer as any).loadInstanceScene(
                                payload.templateChunks,
                                payload.regionX,
                                payload.regionY,
                            );
                        }
                    } catch (err) {
                        console.warn("[OsrsClient] rebuild_region error", err);
                    }
                }),
            );

            this.trackServerSubscription(
                subscribeRebuildNormal((payload) => {
                    try {
                        console.log(
                            `[OsrsClient] REBUILD_NORMAL received: regionX=${payload.regionX} regionY=${payload.regionY} regions=${payload.mapRegions.length}`,
                        );
                        ClientState.inInstance = false;
                        ClientState.instanceTemplateChunks = null;
                        if (this.renderer && "clearInstance" in this.renderer) {
                            (this.renderer as any).clearInstance();
                        }
                    } catch (err) {
                        console.warn("[OsrsClient] rebuild_normal error", err);
                    }
                }),
            );

            this.trackServerSubscription(
                subscribeRebuildWorldEntity((payload) => {
                    try {
                        console.log(
                            `[OsrsClient] REBUILD_WORLDENTITY received: entity=${payload.entityIndex} config=${payload.configId} size=${payload.sizeX}x${payload.sizeZ} regionX=${payload.regionX} regionY=${payload.regionY} regions=${payload.mapRegions.length}`,
                        );
                        // World entity scene anchor: entityCoord + sizeChunks * 4 (tile precision).
                        // entityCoord=3050, sizeChunks=8, fineBase=8*64=512fine=4tiles → anchor=3054.
                        const entityWorldX = 3054;
                        const entityWorldY = 3193;

                        // Collect extra locs from addedLocs that fall in source region
                        const extraLocs: Array<{
                            id: number;
                            x: number;
                            y: number;
                            level: number;
                            shape: number;
                            rotation: number;
                        }> = [];

                        if (this.renderer && "loadWorldEntityScene" in this.renderer) {
                            const weNpcs = (payload as any).extraNpcs;
                            const basePlane = (payload as any).basePlane ?? 0;
                            (this.renderer as any).loadWorldEntityScene(
                                payload.entityIndex,
                                payload.templateChunks,
                                payload.regionX,
                                payload.regionY,
                                entityWorldX,
                                entityWorldY,
                                payload.sizeX,
                                payload.sizeZ,
                                extraLocs,
                                payload.configId,
                                weNpcs,
                                basePlane,
                            );
                            // Schedule a single deferred rebuild to pick up LOC_ADD_CHANGE
                            // packets that arrive after the initial scene build
                            (this.renderer as any).scheduleWorldEntityLocRebuild(
                                payload.entityIndex,
                            );
                        }

                        // Set local player's worldViewId to this entity
                        if (this.controlledPlayerServerId >= 0) {
                            const localEcsIdx = this.playerEcs.getIndexForServerId(
                                this.controlledPlayerServerId,
                            );
                            if (localEcsIdx !== undefined) {
                                this.playerEcs.setWorldViewId(localEcsIdx, payload.entityIndex);
                                this.worldViewManager.addPlayerToWorldView(
                                    payload.entityIndex,
                                    localEcsIdx,
                                );
                            }
                        }
                    } catch (err) {
                        console.warn("[OsrsClient] rebuild_worldentity error", err);
                    }
                }),
            );

            this.trackServerSubscription(
                subscribeWorldEntityInfo((payload) => {
                    this.handleWorldEntityInfo(payload);
                }),
            );

            this.unsubscribePlayerSync = subscribePlayerSync((frame) => {
                try {
                    this.lastPlayerSyncLocalIndex = Number.isFinite(frame.localIndex)
                        ? frame.localIndex | 0
                        : this.lastPlayerSyncLocalIndex;
                    this.playerSyncManager.handleFrame(frame);
                } catch (err) {
                    console.warn("[OsrsClient] player_sync frame error", err);
                }
            });
            // Receive server-provided animation sequences (idle/walk/run)
            // NOTE: This is now a fallback - animations are primarily sent per-player in the
            // appearance block (). This handler is kept for backward compatibility
            // and for setting initial default animations before player is fully spawned.
            this.trackServerSubscription(
                subscribeAnim((anim) => {
                    try {
                        this.serverPlayerSeqs = { ...anim };
                        // Apply to local player's ECS entry specifically, not as a global default
                        const localIndex = this.playerEcs.getIndexForServerId(
                            this.controlledPlayerServerId,
                        );
                        if (localIndex !== undefined) {
                            this.playerEcs.setAnimSet(localIndex, anim);
                        } else {
                            // Fallback: if local player not yet spawned, set as default
                            this.playerEcs.setDefaultAnimSet(anim);
                        }
                    } catch {}
                }),
            );
            this.trackServerSubscription(
                subscribeInventory((update) => {
                    try {
                        this.handleInventoryServerUpdate(update);
                    } catch (err) {
                        console.warn("inventory update dispatch failed", err);
                    }
                }),
            );
            this.trackServerSubscription(
                subscribeBank((update) => {
                    try {
                        this.handleBankServerUpdate(update);
                    } catch (err) {
                        console.warn("bank update dispatch failed", err);
                    }
                }),
            );
            this.trackServerSubscription(
                subscribeCollectionLog((update) => {
                    try {
                        this.handleCollectionLogServerUpdate(update);
                    } catch (err) {
                        console.warn("collection log update dispatch failed", err);
                    }
                }),
            );
            this.trackServerSubscription(
                subscribeShop((state) => {
                    try {
                        this.handleShopServerUpdate(state);
                    } catch (err) {
                        console.warn("shop update dispatch failed", err);
                    }
                }),
            );
            this.trackServerSubscription(
                subscribeTrade((state) => {
                    try {
                        this.handleTradeServerUpdate(state);
                    } catch (err) {
                        console.warn("trade update dispatch failed", err);
                    }
                }),
            );
            this.unsubscribeGroundItems = subscribeGroundItems((payload) => {
                try {
                    this.groundItems.update(payload);
                    this.refreshGroundItemMeshes();
                } catch (err) {
                    console.warn("ground item update failed", err);
                }
            });
            this.unsubscribeCombat = subscribeCombat((state) => {
                this.combatWeaponCategory =
                    typeof state?.weaponCategory === "number" ? state.weaponCategory | 0 : 0;
                // CRITICAL: Set varbit 357 (equipped_weapon_type) so CS2 scripts know the weapon category
                // Combat interface scripts (7593, 7603, etc.) read this varbit to position buttons
                this.varManager.setVarbit(357, this.combatWeaponCategory);
                if (typeof state?.weaponItemId === "number") {
                    this.combatWeaponItemId = state.weaponItemId | 0;
                }
                if (typeof state?.autoRetaliate === "boolean") {
                    this.setAutoRetaliate(state.autoRetaliate, true);
                }
                if (typeof state?.activeStyle === "number") {
                    this.setCombatStyleSlot(state.activeStyle | 0, {
                        fromServer: true,
                        category: this.combatWeaponCategory,
                    });
                }
                // CRITICAL: Force mark varp 43 (com_mode) transmit even if value didn't change.
                // The combat interface's onVarTransmit triggers on com_mode, NOT combat_weapon_category.
                // When weapon changes but style stays 0, varp 43 won't change, so we force the transmit.
                markVarTransmit(43);
                if (Array.isArray(state?.activePrayers)) {
                    this.setActivePrayers(state.activePrayers, { fromServer: true });
                }
                if (Array.isArray(state?.quickPrayers)) {
                    this.setQuickPrayers(state.quickPrayers, { fromServer: true });
                } else if (state && Object.prototype.hasOwnProperty.call(state, "quickPrayers")) {
                    this.setQuickPrayers([], { fromServer: true });
                }
                if (typeof state?.quickPrayersEnabled === "boolean") {
                    this.setQuickPrayersEnabled(state.quickPrayersEnabled, { fromServer: true });
                } else if (
                    state &&
                    Object.prototype.hasOwnProperty.call(state, "quickPrayersEnabled")
                ) {
                    this.setQuickPrayersEnabled(false, { fromServer: true });
                }
                if (typeof state?.activeSpellId === "number") {
                    this.setCombatSpell(state.activeSpellId | 0, { fromServer: true });
                } else if (state && Object.prototype.hasOwnProperty.call(state, "activeSpellId")) {
                    this.setCombatSpell(null, { fromServer: true });
                }
                if (typeof state?.specialEnergy === "number") {
                    this.updateSpecialEnergy(state.specialEnergy);
                }
                if (typeof state?.specialActivated === "boolean") {
                    this.setSpecialAttackEnabled(state.specialActivated, { fromServer: true });
                }
            });
            this.unsubscribeSpellResults = subscribeSpellResults((payload) => {
                try {
                    this.handleSpellResult(payload);
                } catch (err) {
                    console.warn("[OsrsClient] spell_result dispatch failed", err);
                }
            });
        } catch {}
        try {
            const unsubProj = subscribeProjectiles((p: ProjectileLaunch) => {
                try {
                    this.onServerProjectile(p);
                } catch (err) {
                    console.warn("[OsrsClient] projectile dispatch failed", err);
                }
            });
            const prev = this.unsubscribeSpellResults;
            this.unsubscribeSpellResults = () => {
                try {
                    unsubProj?.();
                } catch {}
                try {
                    prev?.();
                } catch {}
            };
        } catch {}
    }

    // Client-side local route prediction (server remains authoritative).
    async routePlayerTo(tileX: number, tileY: number, running: boolean): Promise<void> {
        const worldX = tileX | 0;
        const worldY = tileY | 0;
        const run = !!running;

        // In OSRS, Ctrl inverts the run toggle. Our callers frequently pass the desired `run` state;
        // derive the ctrlHeld bit relative to the current run toggle to preserve that behavior.
        // => ctrlHeld = run XOR runMode.
        const ctrlHeld = run !== !!this.runMode;

        // Keep client destination marker parity (destinationX/Y are local coords relative to scene base).
        try {
            const localX = (worldX - (ClientState.baseX | 0)) | 0;
            const localY = (worldY - (ClientState.baseY | 0)) | 0;
            ClientState.setDestination(localX, localY);
        } catch {}

        // OSRS visual feedback: show the mouse cross immediately on click.
        try {
            const mx = this.inputManager?.mouseX ?? -1;
            const my = this.inputManager?.mouseY ?? -1;
            if (mx >= 0 && my >= 0) {
                ClientState.setMouseCross(mx | 0, my | 0, MOUSE_CROSS_YELLOW);
            }
        } catch {}

        // Do NOT predict movement on click. The client only sets destinationX/Y for the
        // minimap marker and sends the packet. Movement prediction happens when the server
        // sends back movement updates with running mode.

        // Send MOVE_GAMECLICK via binary packet writer.
        // Server computes path; packet contains world coords + ctrl modifier (run invert).
        if (isServerConnected()) {
            const node = createPacket(ClientPacketId.MOVE_GAMECLICK);
            node.packetBuffer.writeShortAddLE(worldY);
            node.packetBuffer.writeByteNeg(ctrlHeld ? 1 : 0);
            node.packetBuffer.writeShortAddLE(worldX);
            // Final shortAdd param; unused for ground clicks.
            node.packetBuffer.writeShortAdd(0);
            queuePacket(node);
        }
    }

    private markVarcsChanged(): void {
        this.varcPersistence.markVarcsChanged();
    }

    private writeVarcs(): void {
        this.varcPersistence.writeVarcs();
    }

    private tryWriteVarcs(): void {
        this.varcPersistence.tryWriteVarcs();
    }

    get worldMapState(): WorldMapState {
        return this.worldMap.worldMapState;
    }

    private setWorldMapState(state: WorldMapState): void {
        this.worldMap.setWorldMapState(state);
    }

    setRenderedWorldMapIcons(icons: WorldMapRenderedIcon[]): void {
        this.worldMap.setRenderedWorldMapIcons(icons);
    }

    getWorldMapMenuEntriesAt(screenX: number, screenY: number): SimpleMenuEntry[] {
        return this.worldMap.getWorldMapMenuEntriesAt(screenX, screenY);
    }

    handleWidgetAction(event: Parameters<WidgetActionRouter["handleWidgetAction"]>[0]): void {
        this.widgetActionRouter.handleWidgetAction(event);
    }

    private runClientScriptWithInts(scriptId: number, args: number[]): void {
        if (!this.cs2Vm) return;
        const script = this.cs2Vm.context?.loadScript?.(scriptId | 0);
        if (!script) return;
        this.cs2Vm.run(script, args, []);
    }

    private substituteWidgetScriptMagicArgs(intArgs: number[], widget: any): number[] {
        return intArgs.map((value) => {
            switch (value) {
                case ScriptArgMagic.WIDGET_ID:
                    return widget?.uid ?? -1;
                case ScriptArgMagic.MOUSE_X:
                case ScriptArgMagic.MOUSE_Y:
                    return 0;
                case ScriptArgMagic.OP_INDEX:
                    return 1;
                case ScriptArgMagic.WIDGET_CHILD_INDEX:
                    return -1;
                case ScriptArgMagic.DRAG_TARGET_ID:
                    return -1;
                case ScriptArgMagic.DRAG_TARGET_CHILD_INDEX:
                    return -1;
                default:
                    return value;
            }
        });
    }

    private runWidgetScopedClientScript(
        widgetUid: number,
        scriptId: number,
        args: (number | string)[],
        phase: "pre" | "post" | "run_script",
    ): void {
        if (!this.cs2Vm || !this.widgetManager) return;
        const script = this.cs2Vm.context?.loadScript?.(scriptId | 0);
        if (!script) return;

        const intArgs: number[] = [];
        const strArgs: string[] = [];
        for (const arg of args ?? []) {
            if (typeof arg === "number") intArgs.push(arg | 0);
            else if (typeof arg === "string") strArgs.push(arg);
        }

        const prevActiveWidget = this.cs2Vm.activeWidget;
        const prevDotWidget = this.cs2Vm.dotWidget;
        const prevComponentId = this.cs2Vm.eventContext.componentId;
        const prevComponentIndex = this.cs2Vm.eventContext.componentIndex;
        const widget = this.widgetManager.getWidgetByUid(widgetUid | 0) ?? null;
        this.cs2Vm.activeWidget = widget;
        this.cs2Vm.dotWidget = widget;
        this.cs2Vm.eventContext.componentId =
            widget?.fileId === -1 && typeof widget?.parentUid === "number"
                ? widget.parentUid
                : (widget?.uid ?? -1);
        this.cs2Vm.eventContext.componentIndex = widget?.childIndex ?? -1;
        try {
            console.log(`[${phase}_script] Running script ${scriptId} on widget ${widgetUid}`);
            this.cs2Vm.run(script, this.substituteWidgetScriptMagicArgs(intArgs, widget), strArgs);
        } finally {
            this.cs2Vm.activeWidget = prevActiveWidget;
            this.cs2Vm.dotWidget = prevDotWidget;
            this.cs2Vm.eventContext.componentId = prevComponentId;
            this.cs2Vm.eventContext.componentIndex = prevComponentIndex;
        }
    }

    updateWidgets() {
        const widgetManager = this.widgetManager;
        if (!widgetManager) {
            return;
        }

        const rootInterface = widgetManager.rootInterface;
        if (rootInterface !== -1 && this.renderer && this.renderer.canvas) {
            // Use dimensions from widgetManager (set by renderer on resize)
            const width = widgetManager.canvasWidth;
            const height = widgetManager.canvasHeight;
            // Only run layout when canvas size or root interface changes (not every frame)
            // This prevents CS2-set positions/sizes from being overwritten
            const needsLayout =
                width !== this._lastLayoutWidth ||
                height !== this._lastLayoutHeight ||
                rootInterface !== this._lastLayoutRootInterface;
            if (needsLayout) {
                this._lastLayoutWidth = width;
                this._lastLayoutHeight = height;
                this._lastLayoutRootInterface = rootInterface;

                // Get ALL root widgets (group 161 has multiple independent roots)
                const allRoots = this.widgetManager.getAllGroupRoots(rootInterface);

                // layoutWidgets needs to traverse static children via parentUid filtering
                const getStaticChildren = (uid: number) =>
                    widgetManager.getStaticChildrenByParentUid(uid);

                // First pass: compute initial layout from raw values for ALL roots
                for (const root of allRoots) {
                    if (root) layoutWidgets(root, width, height, getStaticChildren);
                }

                // Trigger CS2 resize scripts which may set new raw values
                widgetManager.triggerResize();

                // Second pass: re-compute layout with CS2-updated raw values for ALL roots
                for (const root of allRoots) {
                    if (root) layoutWidgets(root, width, height, getStaticChildren);
                }
            }
        }

        // Keep the "Press Enter to Chat" placeholder on the chat input line while
        // chat typing is locked (re-applied whenever chat_promptinput rewrites it).
        this.enterToTypeChat?.applyLockPlaceholder();
    }

    /**
     * Process onTimer event handlers for all widgets
     * Queues timer events to low-priority queue (processed after other events)
     * traverses both static children (via parentUid) and dynamic children
     */
    private processWidgetTimers(): void {
        this.widgetTransmitProcessor.processWidgetTimers();
    }

    private processWidgetTransmits(): void {
        this.widgetTransmitProcessor.processWidgetTransmits();
    }

    private applyMasterVolume(): void {
        this.audioVarp.applyMasterVolume();
    }

    private applyInterfaceScalingPercentDeviceOption(value: number): void {
        this.audioVarp.applyInterfaceScalingPercentDeviceOption(value);
    }

    private applyAudioVarpChange(varpId: number, value: number): void {
        this.audioVarp.applyAudioVarpChange(varpId, value);
    }

    triggerInitialVarTransmitForGroup(groupId: number): void {
        this.widgetTransmitProcessor.triggerInitialVarTransmitForGroup(groupId);
    }

    triggerInvTransmitForGroup(groupId: number): void {
        const instance = this.widgetManager.getGroup(groupId);
        if (!instance) return;

        const currentInvCount = this.transmitCycles.changedInvCount | 0;

        const allRoots = this.widgetManager.getAllGroupRoots(groupId);
        const stack: any[] = [...allRoots];
        while (stack.length > 0) {
            const node = stack.pop();
            if (!node || typeof node !== "object") continue;

            const triggers = node.invTransmitTriggers as number[] | undefined;
            if (triggers && triggers.length > 0) {
                if (node.eventHandlers?.onInvTransmit) {
                    this.cs2Vm.invokeEventHandler(node, "onInvTransmit");
                } else if (Array.isArray(node.onInvTransmit) && node.onInvTransmit.length > 0) {
                    this.executeScriptListener(node, node.onInvTransmit);
                }
                node.lastChangedInvCount = currentInvCount;
            }

            const staticChildren = this.widgetManager.getStaticChildrenByParentUid(node.uid);
            for (let i = staticChildren.length - 1; i >= 0; i--) {
                stack.push(staticChildren[i]);
            }

            if (Array.isArray(node.children)) {
                for (let i = node.children.length - 1; i >= 0; i--) {
                    stack.push(node.children[i]);
                }
            }
        }
    }

    /**
     * Ensure notification_display (interface 660) is mounted into the toplevel
     * notifications container for the current root interface.
     *
     * This container is used by CS2 scripts like notification_positioning (3351) and
     * notification_display_init (3343) which assume a 178x100 host area.
     */
    isPointOverWidget(px: number, py: number): boolean {
        return this.widgetInteraction.isPointOverWidget(px, py);
    }

    private applyMinimapWheelZoom(deltaY: number): void {
        const wheelStep = deltaY > 0 ? 1 : -1;
        this.minimapZoom = Math.max(2, Math.min(8, this.minimapZoom + -wheelStep * 0.25));
    }

    isWasdCameraActive(): boolean {
        return this.enterToTypeChat.isWasdCameraActive(this.cs2Vm.inputDialogType | 0);
    }

    handleUiInput() {
        this.widgetInputController.handleUiInput();
    }

    /**
     * Execute a script listener with event context for magic number substitution
     * @param widget The widget this event targets
     * @param listener The listener array [scriptId, ...args]
     * @param eventContext Optional event context for magic number substitution
     */
    executeScriptListener(widget: any, listener: any[], eventContext?: Partial<ScriptEvent>) {
        if (!listener || listener.length === 0) return;

        // Create full ScriptEvent with the listener args
        const event = createScriptEvent({
            args: listener,
            widget,
            ...eventContext,
        });

        // Use the VM's runScriptEvent which handles magic number substitution
        this.cs2Vm.runScriptEvent(event);
    }

    /**
     * Queue a script event for execution
     * @param event The script event to queue
     * @param priority 0 = normal, 1 = low (onTimer), 2 = medium (onRelease/onMouseLeave)
     */
    queueScriptEvent(event: ScriptEvent, priority: 0 | 1 | 2 = 0) {
        switch (priority) {
            case 1:
                this.scriptEvents2.push(event);
                break;
            case 2:
                this.scriptEvents3.push(event);
                break;
            default:
                this.scriptEvents.push(event);
                break;
        }
    }

    /**
     * Process all queued script events in priority order
     * Called once per game tick/frame
     */
    processScriptEvents() {
        // OSRS drains timerScriptEvents first, then deferredScriptEvents, then scriptEvents.
        // Screenhighlight depends on this ordering: its timer pass keeps the target cutout
        // and textbox in sync before later queued widget scripts run.
        let events = this.scriptEvents2;
        for (let i = 0, len = events.length; i < len; i++) {
            const event = events[i];
            const timerArgsSnapshot = (event as any).timerArgsSnapshot;
            if (
                timerArgsSnapshot &&
                event.widget &&
                (event.widget as any).onTimer !== timerArgsSnapshot
            ) {
                continue;
            }
            if (event.widget && this.isWidgetValid(event.widget)) {
                this.cs2Vm.runScriptEvent(event);
            }
        }
        this.scriptEvents2 = [];

        // Process medium priority events (onRelease, onMouseLeave).
        events = this.scriptEvents3;
        for (let i = 0, len = events.length; i < len; i++) {
            const event = events[i];
            if (event.widget && this.isWidgetValid(event.widget)) {
                this.cs2Vm.runScriptEvent(event);
            }
        }
        this.scriptEvents3 = [];

        // Process normal priority events last.
        events = this.scriptEvents;
        for (let i = 0, len = events.length; i < len; i++) {
            const event = events[i];
            if (event.widget && this.isWidgetValid(event.widget)) {
                this.cs2Vm.runScriptEvent(event);
            }
        }
        this.scriptEvents = [];
    }

    /**
     * Check if a widget is still valid (exists in the widget tree and not hidden)
     */
    private isWidgetValid(widget: any): boolean {
        if (!widget) return false;
        // Widget is invalid if it's been removed or hidden
        // In OSRS this checks if the widget still exists in the parent's children array
        // For now, just check if it's not hidden
        return !widget.hidden;
    }

    clearSelectedSpell(): void {
        this.spellSelectionController.clearSelectedSpell();
    }

    setSelectedSpell(spell: SelectedSpellInfo | null, sourceWidget?: any): void {
        this.spellSelectionController.setSelectedSpell(spell, sourceWidget);
    }

    resolveSpellSelectionFromWidget(
        widget: any | undefined,
        fallbackWidgetId: number,
        fallbackChildIndex: number,
        fallbackItemId: number,
    ): SpellSelectionState {
        return this.spellSelectionController.resolveSpellSelectionFromWidget(
            widget,
            fallbackWidgetId,
            fallbackChildIndex,
            fallbackItemId,
        );
    }

    private normalizeSelectedSpellState(): void {
        this.spellSelectionController.normalizeSelectedSpellState();
    }

    private getWidgetTargetMask(widget: any): number {
        return this.spellSelectionController.getWidgetTargetMask(widget);
    }

    setRunMode(on: boolean, force: boolean = false): void {
        this.combatOptions.setRunMode(on, force);
    }

    getSpecialEnergy(): number {
        return this.combatOptions.getSpecialEnergy();
    }

    isSpecialAttackEnabled(): boolean {
        return this.combatOptions.isSpecialAttackEnabled();
    }

    setSpecialAttackEnabled(on: boolean, opts: { fromServer?: boolean } = {}): void {
        this.combatOptions.setSpecialAttackEnabled(on, opts);
    }

    toggleSpecialAttack(): void {
        this.combatOptions.toggleSpecialAttack();
    }

    updateSpecialEnergy(percent: number): void {
        this.combatOptions.updateSpecialEnergy(percent);
    }

    setAutoRetaliate(on: boolean, fromServer: boolean = false): void {
        this.combatOptions.setAutoRetaliate(on, fromServer);
    }

    setCombatStyleSlot(
        style: number,
        opts: { fromServer?: boolean; category?: number } = {},
    ): void {
        this.combatOptions.setCombatStyleSlot(style, opts);
    }

    setActivePrayers(prayers: Iterable<string>, opts: { fromServer?: boolean } = {}): void {
        this.combatOptions.setActivePrayers(prayers, opts);
    }

    setQuickPrayers(prayers: Iterable<string>, opts: { fromServer?: boolean } = {}): void {
        this.combatOptions.setQuickPrayers(prayers, opts);
    }

    setQuickPrayersEnabled(enabled: boolean, opts: { fromServer?: boolean } = {}): void {
        this.combatOptions.setQuickPrayersEnabled(enabled, opts);
    }

    setCombatSpell(spellId: number | null, opts: { fromServer?: boolean } = {}): void {
        this.combatOptions.setCombatSpell(spellId, opts);
    }

    private resolveNpcActionOpNum(
        npcTypeId: number | undefined,
        option: string | undefined,
        actionIndex?: number,
        opNum?: number,
    ): number | undefined {
        if (typeof opNum === "number" && Number.isFinite(opNum)) {
            const explicitOp = opNum | 0;
            if (explicitOp >= 1 && explicitOp <= 5) return explicitOp;
        }

        if (typeof actionIndex === "number" && Number.isFinite(actionIndex)) {
            const explicitIndex = actionIndex | 0;
            if (explicitIndex >= 0 && explicitIndex <= 4) return explicitIndex + 1;
        }

        const normalizedOption = sanitizeText(option)?.toLowerCase();
        if (!normalizedOption || npcTypeId === undefined || npcTypeId < 0 || !this.npcTypeLoader) {
            return undefined;
        }

        try {
            const base = this.npcTypeLoader.load(npcTypeId | 0);
            const npcType = base?.transforms
                ? base.transform(this.varManager, this.npcTypeLoader)
                : base;
            const actions = npcType?.actions ?? [];
            for (let i = 0; i < 5; i++) {
                if (sanitizeText(actions[i])?.toLowerCase() === normalizedOption) {
                    return i + 1;
                }
            }
        } catch {}
        return undefined;
    }

    attackNpc(options: {
        npcServerId?: number;
        npcTypeId?: number;
        actionIndex?: number;
        modifierFlags?: number;
        mapX?: number;
        mapY?: number;
        tile?: { tileX: number; tileY: number };
    }): void {
        const tile = options.tile ?? this.menuTile ?? this.hoveredTile;

        try {
            // Prefer npcServerId if provided (new path), otherwise fall back to npcTypeId lookup
            let serverId: number | undefined;
            let npcTypeId: number | undefined;
            if (typeof options.npcServerId === "number" && options.npcServerId > 0) {
                serverId = options.npcServerId | 0;
                const ecsId = this.npcEcs.getEcsIdForServer(serverId);
                if (ecsId !== undefined) {
                    npcTypeId = this.npcEcs.getNpcTypeId(ecsId) | 0;
                }
            } else if (typeof options.npcTypeId === "number" && options.npcTypeId >= 0) {
                npcTypeId = options.npcTypeId | 0;
                serverId = this.findNpcServerId(options.npcTypeId | 0, {
                    mapX: options.mapX,
                    mapY: options.mapY,
                    tile,
                });
            }
            if (serverId !== undefined) {
                if (tile && isServerConnected()) {
                    try {
                        sendFaceTile({ x: tile.tileX | 0, y: tile.tileY | 0 });
                    } catch {}
                }
                try {
                    const localIdx = this.playerEcs.getIndexForServerId(
                        this.controlledPlayerServerId,
                    );
                    if (localIdx != null) {
                        this.playerEcs.setInteractionIndex?.(
                            localIdx,
                            encodeInteractionIndex("npc", serverId | 0),
                        );
                    }
                } catch {}
                try {
                    this.playerInteractionSystem.beginCombat(serverId, {
                        tile: tile ? { x: tile.tileX | 0, y: tile.tileY | 0 } : undefined,
                    });
                } catch {}
                const opNum = this.resolveNpcActionOpNum(npcTypeId, "Attack", options.actionIndex);
                if (opNum === undefined) return;
                sendNpcOption(serverId, opNum, options.modifierFlags ?? 0);
                return;
            }
        } catch (err) {
            console.warn?.("[OsrsClient] failed to send npc attack", err);
        }
    }

    private applyBitstreamAppearance(serverId: number, data: any): void {
        const ecsIndex = this.playerEcs.getIndexForServerId(serverId);
        if (ecsIndex === undefined) return;

        if (data && typeof data.name === "string" && data.name.length > 0) {
            this.playerEcs.setName(ecsIndex, data.name);
        }

        if (typeof data?.combatLevel === "number" && Number.isFinite(data.combatLevel)) {
            const combatLevel = data.combatLevel | 0;
            this.playerEcs.setCombatLevel(ecsIndex, combatLevel);
            if ((serverId | 0) === (this.controlledPlayerServerId | 0)) {
                ClientState.localPlayerCombatLevel = this.playerEcs.getCombatLevel(ecsIndex) | 0;
            }
        }

        this.playerEcs.setIsHidden(ecsIndex, data?.isHidden === true);

        const appearance = data?.appearance;
        if (appearance && typeof appearance === "object") {
            // Sync equipment inventory only for local player
            const isLocalPlayer = serverId === this.controlledPlayerServerId;
            const pa = this.buildPlayerAppearanceFromPayload(appearance, isLocalPlayer);
            this.playerEcs.setAppearance(ecsIndex, pa);
            // Keep the dedicated icon array in lockstep with the decoded
            // appearance for remote players as well as the local player.
            this.playerEcs.setHeadIconPrayer(ecsIndex, pa.headIcons.prayer ?? -1);
            let team = 0;
            try {
                const equip = Array.isArray(pa?.equip) ? pa.equip : [];
                for (let i = 0; i < equip.length; i++) {
                    const itemId = Number(equip[i]) | 0;
                    if (itemId < 0) continue;
                    const objType = this.objTypeLoader.load(itemId | 0);
                    const itemTeam = (objType?.team ?? 0) | 0;
                    if (itemTeam !== 0) {
                        team = itemTeam;
                    }
                }
            } catch {}
            this.playerEcs.setTeam(ecsIndex, team);
            if (isLocalPlayer) {
                // expose local gender to CS2 via player_design_bodytype varbit.
                // This varbit is read by scripts like proc 3755 (PlayerDesign A/B button state).
                try {
                    this.varManager?.setVarbit?.(14021, ((pa.gender ?? 0) | 0) === 1 ? 1 : 0);
                } catch {}
                try {
                    const key = pa.getCacheKey?.();
                    if (key && key !== this._lastLocalAppearanceKey) {
                        this._lastLocalAppearanceKey = key;
                        const w = this.widgetManager.findWidget(679, 73);
                        if (
                            w &&
                            ((((w as any).contentType ?? 0) | 0) === 328 ||
                                (((w as any).modelType ?? 0) | 0) === 7 ||
                                (w as any).isPlayerModel)
                        ) {
                            const keepEquipment =
                                typeof (w as any).playerModelKeepEquipment === "boolean"
                                    ? ((w as any).playerModelKeepEquipment as boolean)
                                    : true;
                            (w as any).playerAppearance = {
                                gender: pa.gender,
                                colors: Array.from(pa.colors ?? []),
                                kits: Array.from(pa.kits ?? []),
                                equip: keepEquipment
                                    ? Array.from(pa.equip ?? [])
                                    : new Array(14).fill(-1),
                            };
                            this.widgetManager.invalidateWidgetRender(w, "local-appearance");
                        }
                    }
                } catch {}
            }
            try {
                this.playerEcs.ensureBaseForIndex(ecsIndex, {
                    idkTypeLoader: this.idkTypeLoader,
                    objTypeLoader: this.objTypeLoader,
                    modelLoader: this.modelLoader,
                    textureLoader: this.textureLoader,
                    npcTypeLoader: undefined,
                    seqTypeLoader: this.seqTypeLoader,
                    seqFrameLoader: this.seqFrameLoader,
                    skeletalSeqLoader: this.loaderFactory.getSkeletalSeqLoader?.(),
                    varManager: this.varManager,
                    basTypeLoader: this.basTypeLoader,
                });
            } catch (err) {
                console.warn("[OsrsClient] ensureBaseForIndex failed", err);
            }
        }

        // apply animation set from appearance block (like Player.read() in reference)
        // This ensures per-player animations are set when appearance changes (e.g., equipment change, death)
        const anim = data?.anim;
        if (anim && typeof anim === "object") {
            this.playerEcs.setAnimSet(ecsIndex, anim);
        }
    }

    private buildPlayerAppearanceFromPayload(
        payload: any,
        syncEquipment: boolean = false,
    ): PlayerAppearance {
        const gender = typeof payload?.gender === "number" ? payload.gender | 0 : 0;
        const colors = Array.isArray(payload?.colors)
            ? payload.colors
                  .slice(0, 5)
                  .map((n: number) => (Number.isFinite(n) ? (n | 0) & 0xff : 0))
            : [0, 0, 0, 0, 0];
        const kits = Array.isArray(payload?.kits)
            ? payload.kits.slice(0, 7).map((n: number) => (Number.isFinite(n) ? n | 0 : -1))
            : new Array(7).fill(-1);
        const equip = Array.isArray(payload?.equip)
            ? payload.equip.slice(0, 14).map((n: number) => (Number.isFinite(n) ? n | 0 : -1))
            : new Array(14).fill(-1);
        const equipQty = Array.isArray(payload?.equipQty)
            ? payload.equipQty
                  .slice(0, 14)
                  .map((n: number) => (Number.isFinite(n) ? Math.max(0, n | 0) : 0))
            : new Array(14).fill(0);
        const rawHeadIcons =
            typeof payload?.headIcons === "object" && payload.headIcons !== null
                ? payload.headIcons
                : {};
        const headIcons: { prayer?: number; skull?: number } = {
            prayer: Number.isFinite(rawHeadIcons.prayer) ? (rawHeadIcons.prayer as number) | 0 : -1,
        };
        if (Number.isFinite(rawHeadIcons.skull)) {
            headIcons.skull = (rawHeadIcons.skull as number) | 0;
        }
        // Sync equipment inventory for CS2 scripts if this is for the local player
        if (syncEquipment) {
            this.syncEquipmentInventory(equip, equipQty);
        }
        return new PlayerAppearance(gender, colors, kits, equip, headIcons);
    }

    /** Sync the equipment inventory from appearance equip array for CS2 INV_GETOBJ(94, slot) */
    private syncEquipmentInventory(equip: number[], equipQty?: number[]): void {
        const slots: InventorySlotInput[] = [];
        // Map from EquipmentSlot indices (server equip array) to EquipmentDisplaySlot indices (CS2 scripts)
        // e.g., equip[7] (GLOVES) -> display slot 9, equip[8] (BOOTS) -> display slot 10
        for (let equipSlot = 0; equipSlot < equip.length && equipSlot < 12; equipSlot++) {
            const itemId = equip[equipSlot] | 0;
            if (itemId > 0) {
                const displaySlot = EquipToDisplaySlot[equipSlot];
                if (displaySlot !== undefined) {
                    const qtyRaw = equipQty?.[equipSlot] ?? 0;
                    const quantity =
                        equipSlot === EquipmentSlot.AMMO ? Math.max(1, Number(qtyRaw) | 0) : 1;
                    slots.push({ slot: displaySlot, itemId, quantity });
                }
            }
        }
        this.equipment.setSnapshot(slots);
        // Mark inv cycle for equipment (94) - handlers fire during processWidgetTransmits()
        markInvTransmit(94);
    }

    private handleSpellResult(payload: SpellResultPayload): void {
        const casterId = payload?.casterId | 0;
        const controlledId = this.controlledPlayerServerId | 0;
        const isSelfCast = casterId === controlledId;
        const isAutocast = !!payload?.modifiers?.isAutocast;

        // no-op: UI/logic below handles outcomes; noisy logging removed

        if (payload.outcome === "failure") {
            if (isSelfCast && !isAutocast) this.clearSelectedSpell();
            const reason = payload.reason || "unknown";
            if (reason === "out_of_runes") {
                console.warn("[Spell] Not enough runes to cast spell", payload.spellId);
            } else if (reason === "level_requirement") {
                console.warn("[Spell] Magic level too low for spell", payload.spellId);
            } else {
                console.warn(`[spell] Cast failed (${reason})`, payload);
            }
        } else if (payload.outcome === "success") {
            if (isSelfCast && !isAutocast) this.clearSelectedSpell();

            // OSRS-style: rely on server 'spot' messages for cast windup; avoid local duplicate here.

            // Projectiles now arrive via dedicated packets; no legacy spawn here.
        }
    }

    private onServerProjectile(launch: ProjectileLaunch): void {
        const projectileManager = this.renderer.getProjectileManager();
        if (!projectileManager) return;
        projectileManager.launch(launch);

        if ((globalThis as any)?.DEBUG_PROJECTILES) {
            try {
                console.log("[ProjectileLaunch]", launch);
            } catch {}
        }
    }

    castSpellFromMenu(
        entry: OsrsMenuEntry,
        context: {
            tile?: { tileX: number; tileY: number; plane?: number };
            mapX?: number;
            mapY?: number;
            npcServerId?: number;
            playerServerId?: number;
        } = {},
    ): void {
        console.log("[castSpellFromMenu] Entry:", {
            targetType: entry.targetType,
            isSpellSelected: ClientState.isSpellSelected,
            selectedSpellWidget: ClientState.selectedSpellWidget,
            context,
        });
        if (!ClientState.isSpellSelected || ClientState.selectedSpellWidget <= 0) {
            console.log("[castSpellFromMenu] Early return - spell not selected");
            return;
        }
        this.normalizeSelectedSpellState();
        const selection = buildSelectedSpellPayload(
            ClientState.selectedSpellWidget,
            ClientState.selectedSpellChildIndex,
            ClientState.selectedSpellItemId,
        );
        if (!selection) {
            this.clearSelectedSpell();
            this.closeMenu();
            return;
        }
        const tile = context.tile ?? this.menuTile ?? this.hoveredTile;
        const ctrlHeld = ClientState.isCtrlPressed();

        let dispatched = false;
        switch (entry.targetType) {
            case MenuTargetType.NPC: {
                const serverId =
                    typeof context.npcServerId === "number" && (context.npcServerId | 0) > 0
                        ? context.npcServerId | 0
                        : this.findNpcServerId(entry.targetId | 0, {
                              mapX: context.mapX,
                              mapY: context.mapY,
                              tile,
                          });
                if (serverId !== undefined) {
                    if (isServerConnected()) {
                        queuePacket(createSelectedSpellOnNpcPacket(serverId, selection, ctrlHeld));
                    }
                    dispatched = true;
                }
                break;
            }
            case MenuTargetType.PLAYER: {
                const targetServerId = context.playerServerId;
                console.log(
                    "[spell] Player target - playerServerId:",
                    targetServerId,
                    "context:",
                    context,
                );
                if (typeof targetServerId === "number") {
                    if (isServerConnected()) {
                        queuePacket(
                            createSelectedSpellOnPlayerPacket(targetServerId, selection, ctrlHeld),
                        );
                    } else {
                        console.log("[spell] Server not connected, not sending");
                    }
                    dispatched = true;
                } else {
                    console.log("[spell] playerServerId is not a number, not sending");
                }
                break;
            }
            case MenuTargetType.LOC: {
                if (tile) {
                    if (isServerConnected()) {
                        queuePacket(
                            createSelectedSpellOnLocPacket(
                                entry.targetId | 0,
                                tile.tileX | 0,
                                tile.tileY | 0,
                                selection,
                                ctrlHeld,
                            ),
                        );
                    }
                    dispatched = true;
                }
                break;
            }
            case MenuTargetType.OBJ: {
                if (tile) {
                    if (isServerConnected()) {
                        queuePacket(
                            createSelectedSpellOnGroundItemPacket(
                                entry.targetId | 0,
                                tile.tileX | 0,
                                tile.tileY | 0,
                                selection,
                                ctrlHeld,
                            ),
                        );
                    }
                    dispatched = true;
                }
                break;
            }
            default:
                break;
        }

        if (dispatched) {
            // Clicking a spell target updates destination marker and mouse cross
            // on click, while actual movement/rotation remains server-authoritative.
            try {
                const mapXRaw = Number(context.mapX);
                const mapYRaw = Number(context.mapY);
                const tileXRaw = Number(tile?.tileX);
                const tileYRaw = Number(tile?.tileY);
                let localX: number | undefined;
                let localY: number | undefined;
                if (Number.isFinite(mapXRaw) && Number.isFinite(mapYRaw)) {
                    localX = mapXRaw | 0;
                    localY = mapYRaw | 0;
                } else if (Number.isFinite(tileXRaw) && Number.isFinite(tileYRaw)) {
                    const tx = tileXRaw | 0;
                    const ty = tileYRaw | 0;
                    if (tx >= 0 && tx <= 103 && ty >= 0 && ty <= 103) {
                        localX = tx;
                        localY = ty;
                    } else {
                        localX = (tx - (ClientState.baseX | 0)) | 0;
                        localY = (ty - (ClientState.baseY | 0)) | 0;
                    }
                }
                if (
                    localX !== undefined &&
                    localY !== undefined &&
                    localX >= 0 &&
                    localX <= 103 &&
                    localY >= 0 &&
                    localY <= 103
                ) {
                    ClientState.setDestination(localX, localY);
                }
            } catch {}
            try {
                const mx = this.inputManager?.mouseX ?? -1;
                const my = this.inputManager?.mouseY ?? -1;
                if (mx >= 0 && my >= 0) {
                    ClientState.setMouseCross(mx | 0, my | 0, MOUSE_CROSS_YELLOW);
                }
            } catch {}
        }
        if (!dispatched) {
            console.log("[castSpellFromMenu] Spell cast target resolution failed; no packet sent");
        }

        // any completed menu action while a spell is selected clears spell targeting,
        // even when target resolution fails client-side.
        this.clearSelectedSpell();
        this.closeMenu();
    }

    useSelectedItemOnFromMenu(
        entry: OsrsMenuEntry,
        context: {
            tile?: { tileX: number; tileY: number; plane?: number };
            mapX?: number;
            mapY?: number;
            npcServerId?: number;
            playerServerId?: number;
        } = {},
    ): void {
        // world "Use" state is tracked in ClientState, not inventory UI selection.
        let selectedSlot: number | null = null;
        let selectedItemId = -1;
        if (ClientState.isItemSelected === 1 && (ClientState.selectedItemId | 0) > 0) {
            selectedSlot = ClientState.selectedItemSlot | 0;
            selectedItemId = ClientState.selectedItemId | 0;
        } else {
            // Fallback for tap/mobile inventory selection path.
            const fallbackSlot = this.inventory?.getSelectedSlot?.() ?? null;
            if (fallbackSlot !== null) {
                const fallbackEntry = this.inventory.getSlot(fallbackSlot);
                if (fallbackEntry && fallbackEntry.itemId > 0) {
                    selectedSlot = fallbackSlot | 0;
                    selectedItemId = fallbackEntry.itemId | 0;
                }
            }
        }
        if (selectedSlot === null || selectedItemId <= 0) return;

        const tile = context.tile ?? this.menuTile ?? this.hoveredTile;
        const plane = (() => {
            if (tile && typeof tile.plane === "number") return tile.plane | 0;
            const idx = this.playerEcs.getIndexForServerId(this.controlledPlayerServerId);
            if (typeof idx === "number") return this.playerEcs.getLevel(idx) | 0;
            return 0;
        })();

        let dispatched = false;
        switch (entry.targetType) {
            case MenuTargetType.NPC: {
                const serverId =
                    typeof context.npcServerId === "number" && (context.npcServerId | 0) > 0
                        ? context.npcServerId | 0
                        : this.findNpcServerId(entry.targetId | 0, {
                              mapX: context.mapX,
                              mapY: context.mapY,
                              tile,
                          });
                if (isServerConnected()) {
                    sendInventoryUseOn({
                        slot: selectedSlot,
                        itemId: selectedItemId | 0,
                        target: {
                            kind: "npc",
                            id: typeof serverId === "number" ? serverId | 0 : undefined,
                            tile: tile ? { x: tile.tileX | 0, y: tile.tileY | 0 } : undefined,
                            plane: plane | 0,
                        },
                    });
                }
                dispatched = true;
                break;
            }
            case MenuTargetType.PLAYER: {
                const sid = context.playerServerId;
                if (isServerConnected()) {
                    sendInventoryUseOn({
                        slot: selectedSlot,
                        itemId: selectedItemId | 0,
                        target: {
                            kind: "player",
                            id: typeof sid === "number" ? sid | 0 : undefined,
                            tile: tile ? { x: tile.tileX | 0, y: tile.tileY | 0 } : undefined,
                            plane: plane | 0,
                        },
                    });
                }
                dispatched = true;
                break;
            }
            case MenuTargetType.LOC: {
                if (isServerConnected() && typeof entry.targetId === "number") {
                    sendInventoryUseOn({
                        slot: selectedSlot,
                        itemId: selectedItemId | 0,
                        target: {
                            kind: "loc",
                            id: entry.targetId | 0,
                            tile: tile ? { x: tile.tileX | 0, y: tile.tileY | 0 } : undefined,
                            plane: plane | 0,
                        },
                    });
                }
                dispatched = true;
                break;
            }
            case MenuTargetType.OBJ: {
                if (isServerConnected() && typeof entry.targetId === "number") {
                    sendInventoryUseOn({
                        slot: selectedSlot,
                        itemId: selectedItemId | 0,
                        target: {
                            kind: "obj",
                            id: entry.targetId | 0,
                            tile: tile ? { x: tile.tileX | 0, y: tile.tileY | 0 } : undefined,
                            plane: plane | 0,
                        },
                    });
                }
                dispatched = true;
                break;
            }
            default:
                break;
        }

        // Mirror spell-cast flow: once an item-on-target is dispatched, clear selection and close the menu
        if (dispatched) {
            try {
                this.inventory?.setSelectedSlot?.(null);
            } catch {}
            ClientState.clearItemSelection();
            this.clearSelectedSpell();
            this.closeMenu();
        }
    }

    useSelectedItemOnInventory(targetSlot: number): void {
        const selected = this.inventory?.getSelectedSlot?.() ?? null;
        if (selected === null) return;
        const src = this.inventory.getSlot(selected);
        const dst = this.inventory.getSlot(targetSlot | 0);
        if (!src || src.itemId <= 0 || !dst || dst.itemId <= 0) return;
        if (isServerConnected()) {
            sendInventoryUseOn({
                slot: selected,
                itemId: src.itemId | 0,
                target: { kind: "inv", slot: targetSlot | 0, itemId: dst.itemId | 0 },
            });
        } else {
            // Offline fallback: mirror OSRS behavior with a chat message
            try {
                const canvas = this.renderer?.canvas as HTMLCanvasElement | undefined;
                if (canvas) {
                    const ui: any = ((canvas as any).__ui = (canvas as any).__ui || {});
                    const msg = { type: "game", text: "Nothing interesting happens." } as any;
                    if (typeof ui.chatboxAdd === "function") ui.chatboxAdd(msg);
                    else {
                        ui.__pendingChat = Array.isArray(ui.__pendingChat) ? ui.__pendingChat : [];
                        ui.__pendingChat.push(msg);
                    }
                }
            } catch {}
        }
        // Clear selection immediately like OSRS (client-only)
        this.inventory?.setSelectedSlot?.(null);
        this.closeMenu();
    }

    getGroundItemsAt(tileX: number, tileY: number, level: number): ClientGroundItemStack[] {
        return this.groundItems.getStacksAt(tileX | 0, tileY | 0, level | 0);
    }

    private getLocalAccountType(): number {
        if (!this.varManager) return ACCOUNT_TYPE_MAIN;
        if (this.accountTypeVarbitAvailable === undefined) {
            const varbitDef = this.varManager.varbitLoader.load(VARBIT_ACCOUNT_TYPE);
            this.accountTypeVarbitAvailable =
                !!varbitDef &&
                Number.isFinite(varbitDef.baseVar) &&
                Number.isFinite(varbitDef.startBit) &&
                Number.isFinite(varbitDef.endBit);
        }
        if (!this.accountTypeVarbitAvailable) {
            return ACCOUNT_TYPE_MAIN;
        }
        const value = this.varManager.getVarbit(VARBIT_ACCOUNT_TYPE);
        if (!Number.isFinite(value)) return ACCOUNT_TYPE_MAIN;
        return Math.max(0, value | 0);
    }

    getGroundItemOverlayEntries(
        tileX: number,
        tileY: number,
        level: number,
        opts?: { radius?: number; maxEntries?: number },
    ): GroundItemOverlayEntry[] {
        const plugin = this.groundItemsPlugin;
        const config = plugin.getConfig();
        if (!config.enabled) {
            return [];
        }

        const radius = Math.max(1, opts?.radius ?? 12);
        const maxEntries = Math.max(1, opts?.maxEntries ?? 40);
        const serverTiming = getServerTickPhaseNow();
        const accountType = this.getLocalAccountType();
        const timerBucket =
            config.despawnTimerMode === "seconds"
                ? Math.max(
                      0,
                      Math.floor(
                          (Math.max(
                              0,
                              Math.min(
                                  0.999,
                                  Number.isFinite(serverTiming.phase) ? serverTiming.phase : 0,
                              ),
                          ) *
                              Math.max(1, serverTiming.tickMs | 0)) /
                              100,
                      ),
                  )
                : 0;
        const cacheKey = [
            tileX | 0,
            tileY | 0,
            level | 0,
            radius | 0,
            maxEntries | 0,
            accountType | 0,
            serverTiming.tick | 0,
            timerBucket | 0,
            this.groundItems.getVersion() | 0,
            plugin.getVersion() | 0,
        ].join("|");
        const cachedOverlay = this.groundItemOverlayCache;
        if (cachedOverlay?.key === cacheKey) {
            return cachedOverlay.entries;
        }

        const stacks = this.groundItems.getStacksInRadius(tileX | 0, tileY | 0, level | 0, {
            radius,
            // Pull a bounded candidate set, then apply plugin filtering down to maxEntries.
            maxEntries: Math.max(maxEntries * 4, 128),
        });
        const centerX = tileX | 0;
        const centerY = tileY | 0;

        type OverlayCandidate = {
            stack: (typeof stacks)[number];
            label: string;
            color: number;
            timerLabel?: string;
            timerColor?: number;
            value: number;
            distance: number;
        };
        const groups = new Map<
            string,
            {
                tileX: number;
                tileY: number;
                level: number;
                distance: number;
                candidates: OverlayCandidate[];
            }
        >();

        for (const stack of stacks) {
            const evaluated = plugin.evaluateStack(stack, {
                includeTimerLabel: true,
                timing: {
                    currentTick: serverTiming.tick | 0,
                    tickPhase: serverTiming.phase,
                    tickMs: serverTiming.tickMs | 0,
                },
                accountType,
            });
            if (!evaluated.highlighted) {
                if (evaluated.hidden) {
                    continue;
                }
                if (config.showHighlightedOnly) {
                    continue;
                }
            }

            const stackTileX = stack.tile.x | 0;
            const stackTileY = stack.tile.y | 0;
            const stackLevel = stack.tile.level | 0;
            const distance = Math.max(
                Math.abs(stackTileX - centerX),
                Math.abs(stackTileY - centerY),
            );
            const key = `${stackLevel}|${stackTileX}|${stackTileY}`;
            let group = groups.get(key);
            if (!group) {
                group = {
                    tileX: stackTileX,
                    tileY: stackTileY,
                    level: stackLevel,
                    distance,
                    candidates: [],
                };
                groups.set(key, group);
            }
            group.candidates.push({
                stack,
                label: evaluated.baseLabel,
                color: evaluated.color,
                timerLabel: evaluated.timerLabel,
                timerColor: evaluated.timerColor,
                value: plugin.getValueForStack(stack),
                distance,
            });
        }

        if (groups.size === 0) {
            this.groundItemOverlayCache = { key: cacheKey, entries: [] };
            return [];
        }

        const sortedGroups = [...groups.values()].sort((a, b) => {
            if (a.distance !== b.distance) return a.distance - b.distance;
            if (a.tileY !== b.tileY) return a.tileY - b.tileY;
            return a.tileX - b.tileX;
        });
        const entries: GroundItemOverlayEntry[] = [];
        for (const group of sortedGroups) {
            group.candidates.sort((a, b) => {
                if (a.value !== b.value) return b.value - a.value;
                if (a.stack.quantity !== b.stack.quantity)
                    return b.stack.quantity - a.stack.quantity;
                return a.stack.itemId - b.stack.itemId;
            });
            for (let line = 0; line < group.candidates.length; line++) {
                const candidate = group.candidates[line];
                entries.push({
                    tileX: group.tileX,
                    tileY: group.tileY,
                    level: group.level,
                    label: candidate.label,
                    color: candidate.color,
                    timerLabel: candidate.timerLabel,
                    timerColor: candidate.timerColor,
                    line,
                });
                if (entries.length >= maxEntries) {
                    this.groundItemOverlayCache = { key: cacheKey, entries };
                    return entries;
                }
            }
        }

        this.groundItemOverlayCache = { key: cacheKey, entries };
        return entries;
    }

    takeGroundItem(stack: ClientGroundItemStack, quantity?: number): void {
        if (!isServerConnected()) return;
        sendGroundItemAction({
            stackId: stack.id | 0,
            itemId: stack.itemId | 0,
            tile: { ...stack.tile },
            quantity: quantity ?? stack.quantity,
            option: "take",
        });
        this.closeMenu();
    }

    examineGroundItem(stack: ClientGroundItemStack): void {
        if (isServerConnected()) {
            sendGroundItemAction({
                stackId: stack.id | 0,
                itemId: stack.itemId | 0,
                tile: { ...stack.tile },
                option: "examine",
            });
        }
        this.closeMenu();
    }

    interactNpc(options: {
        npcServerId?: number;
        npcTypeId?: number;
        option: string;
        actionIndex?: number;
        opNum?: number;
        modifierFlags?: number;
        mapX?: number;
        mapY?: number;
        tile?: { tileX: number; tileY: number };
    }): void {
        const { option } = options;

        const tile = options.tile ?? this.menuTile ?? this.hoveredTile;

        try {
            // Prefer npcServerId if provided (new path), otherwise fall back to npcTypeId lookup
            let serverId: number | undefined;
            let npcTypeId: number | undefined;
            if (typeof options.npcServerId === "number" && options.npcServerId > 0) {
                serverId = options.npcServerId | 0;
                // Look up npcTypeId from ECS for fallback dialogue
                const ecsId = this.npcEcs.getEcsIdForServer(serverId);
                if (ecsId !== undefined) {
                    npcTypeId = this.npcEcs.getNpcTypeId(ecsId) | 0;
                }
            } else if (typeof options.npcTypeId === "number" && options.npcTypeId >= 0) {
                npcTypeId = options.npcTypeId | 0;
                serverId = this.findNpcServerId(npcTypeId, {
                    mapX: options.mapX,
                    mapY: options.mapY,
                    tile,
                });
            }

            const connected = isServerConnected();

            if (serverId !== undefined && connected) {
                if (tile) {
                    try {
                        sendFaceTile({ x: tile.tileX | 0, y: tile.tileY | 0 });
                    } catch {}
                }
                const opNum = this.resolveNpcActionOpNum(
                    npcTypeId,
                    option,
                    options.actionIndex,
                    options.opNum,
                );
                if (opNum === undefined) return;
                sendNpcOption(serverId, opNum, options.modifierFlags ?? 0);
                return;
            }
        } catch (err) {
            console.warn?.("[OsrsClient] failed to send npc interact", err);
        }

        if (!isServerConnected() && tile) {
            try {
                this.routePlayerTo(tile.tileX | 0, tile.tileY | 0, !!this.runMode);
            } catch {}
        }
    }

    // URL/search params are not supported

    init(): void {
        // Initialize default controlled player if not set by server
        if (this.controlledPlayerServerId === -1) {
            this.controlledPlayerServerId = 0; // Default server ID
            this.playerEcs.allocatePlayer(this.controlledPlayerServerId);
            try {
                const idx = this.playerEcs.getIndexForServerId(this.controlledPlayerServerId);
                if (idx !== undefined) {
                    // Default local run mode on for smoother testing
                    (this.playerEcs as any).running[idx] = 1;
                }
            } catch {}
        }
    }

    // ========== Login Screen Methods ==========

    setRememberLoginEnabled(enabled: boolean): void {
        this.rememberLoginPlugin.setEnabled(
            enabled,
            this.loginState.username,
            this.loginState.password,
        );
    }

    /**
     * Update the game state and handle transitions.
     * Handles game state transitions with cleanup/setup logic.
     *
     * Uses the centralized GameStateMachine for atomic transitions.
     */
    updateGameState(newState: GameState): void {
        const oldState = this.gameState;
        if (oldState === newState) return;

        if (shouldFadeOutLoginMusicForTransition(oldState, newState)) {
            this.cancelPendingLoginMusicStart();
            try {
                // leaving the login/title flow clears title music via clearSongs(0, 100).
                this.musicSystem?.stopMusic(0, 100);
            } catch {}
        }

        // Cleanup old state
        if (oldState === GameState.LOGGED_IN && newState !== GameState.LOADING_GAME) {
            // Reset world state when leaving logged-in state (partial - keep chat/vars for reconnect)
            // Exception: LOADING_GAME transitions keep world intact
            this.resetWorld(false);
        }

        // Setup new state
        if (newState === GameState.LOGIN_SCREEN) {
            this.rememberLoginPlugin.restore(this.loginState);
            // Chat starts locked ("Press Enter to Chat") on the next login.
            this.enterToTypeChat?.reset();
            this.loginState.networkState = 0;
            // Reset loading tracker on return to login
            this.loadingTracker.reset();
            // Full reset when returning to login screen (clears chat, vars, transmit cycles)
            this.resetWorld(true);
            // Flush buffered keystrokes so in-game typing does not leak into login fields
            try {
                this.inputManager.flushInput();
            } catch {}
            // Apply persisted server URL so sendLogin connects to the right place
            setServerUrl(
                `${this.loginState.serverSecure ? "wss" : "ws"}://${this.loginState.serverAddress}`,
            );
        }

        if (newState === GameState.CONNECTING) {
            this.rememberLoginPlugin.remember(
                this.loginState.username,
                this.loginState.password,
            );
            this.loginState.setResponse("", "Connecting to server...", "", "");

            // Set up loading requirements BEFORE server responds
            // This prevents race condition where handshake arrives before onLoginSuccess
            this.loadingTracker.setRequirements([
                LoadingRequirement.HANDSHAKE_COMPLETE,
                LoadingRequirement.MAP_DATA_LOADED,
            ]);
        }

        // Do the state machine transition FIRST
        // This ensures this.gameState returns the new state when callbacks fire
        this.stateMachine.transition(newState, true);

        if (newState === GameState.LOGIN_SCREEN && !this.loginState.titleMusicDisabled) {
            this.scheduleLoginMusicStart(100);
        }

        // AFTER transition: set up callbacks that depend on the new state
        if (newState === GameState.LOADING_GAME) {
            // Set callback for when all requirements are met
            // Use a minimum display time so the loading message is visible
            const minDisplayTime = 500; // ms - minimum time to show "Loading please wait"
            const enteredAt = performance.now();

            this.loadingTracker.setOnComplete(() => {
                const elapsed = performance.now() - enteredAt;
                const remaining = Math.max(0, minDisplayTime - elapsed);

                // Delay transition to ensure loading message is visible
                setTimeout(() => {
                    if (this.gameState === GameState.LOADING_GAME) {
                        this.updateGameState(GameState.LOGGED_IN);
                    }
                }, remaining);
            });
        }
    }

    private cancelPendingLoginMusicStart(): void {
        if (this.loginMusicStartTimer) {
            clearTimeout(this.loginMusicStartTimer);
            this.loginMusicStartTimer = undefined;
        }
    }

    private scheduleLoginMusicStart(delayMs: number): void {
        this.cancelPendingLoginMusicStart();
        this.loginMusicStartTimer = setTimeout(
            () => {
                this.loginMusicStartTimer = undefined;
                if (
                    !this.musicSystem ||
                    !shouldStartScheduledLoginMusic(
                        this.gameState,
                        this.loginState.titleMusicDisabled,
                        this.musicSystem.playingJingle,
                    )
                ) {
                    return;
                }
                this.musicSystem.playLoginMusic().catch(() => {});
            },
            Math.max(0, delayMs | 0),
        );
    }

    /**
     * Handle login error from server.
     * Maps error codes to loginIndex values.
     * Matches OSRS HealthBar.getLoginError() messages.
     */
    handleLoginError(errorCode: number): void {
        console.log(`[OsrsClient] handleLoginError(${errorCode})`);
        switch (errorCode) {
            case LoginErrorCode.INVALID_CREDENTIALS:
                this.loginState.loginIndex = LoginIndex.INVALID_CREDENTIALS;
                this.loginState.setResponse("", "Incorrect username or password.", "", "");
                break;

            case LoginErrorCode.ALREADY_LOGGED_IN:
                this.loginState.loginIndex = LoginIndex.TRY_AGAIN;
                this.loginState.setResponse(
                    "",
                    "Your account is already logged in.",
                    "Please try again in 60 seconds.",
                    "",
                );
                break;

            case LoginErrorCode.CLIENT_OUTDATED:
                this.loginState.loginIndex = LoginIndex.TRY_AGAIN;
                this.loginState.setResponse(
                    "",
                    "RuneScape has been updated!",
                    "Please reload this page.",
                    "",
                );
                break;

            case LoginErrorCode.WORLD_FULL:
                this.loginState.loginIndex = LoginIndex.TRY_AGAIN;
                this.loginState.setResponse(
                    "",
                    "This world is full.",
                    "Please use a different world.",
                    "",
                );
                break;

            case LoginErrorCode.LOGIN_SERVER_BUSY:
                this.loginState.loginIndex = LoginIndex.TRY_AGAIN;
                this.loginState.setResponse("", "Unable to connect.", "Login server offline.", "");
                break;

            case LoginErrorCode.TOO_MANY_ATTEMPTS:
                this.loginState.loginIndex = LoginIndex.TRY_AGAIN;
                this.loginState.setResponse(
                    "",
                    "Login limit exceeded.",
                    "Too many connections from your address.",
                    "",
                );
                break;

            case LoginErrorCode.MEMBERS_WORLD:
                this.loginState.loginIndex = LoginIndex.TRY_AGAIN;
                this.loginState.setResponse(
                    "",
                    "You need a members account to login to this world.",
                    "Please subscribe, or use a different world.",
                    "",
                );
                break;

            case LoginErrorCode.LOGIN_FAILED:
                this.loginState.loginIndex = LoginIndex.TRY_AGAIN;
                this.loginState.setResponse(
                    "",
                    "Could not complete login.",
                    "Please try using a different world.",
                    "",
                );
                break;

            case LoginErrorCode.SERVER_UPDATE_PROGRESS:
                this.loginState.loginIndex = LoginIndex.TRY_AGAIN;
                this.loginState.setResponse(
                    "",
                    "The server is being updated.",
                    "Please wait 1 minute and try again.",
                    "",
                );
                break;

            case LoginErrorCode.NO_REPLY:
                this.loginState.loginIndex = LoginIndex.TRY_AGAIN;
                this.loginState.setResponse(
                    "",
                    "No reply from loginserver.",
                    "Please wait 1 minute and try again.",
                    "",
                );
                break;

            case LoginErrorCode.UNEXPECTED_RESPONSE:
                this.loginState.loginIndex = LoginIndex.TRY_AGAIN;
                this.loginState.setResponse(
                    "",
                    "Unexpected loginserver response.",
                    "Please try using a different world.",
                    "",
                );
                break;

            case LoginErrorCode.ADDRESS_BLOCKED:
                this.loginState.loginIndex = LoginIndex.TRY_AGAIN;
                this.loginState.setResponse(
                    "",
                    "This computer's address has been blocked",
                    "as it was used to break our rules.",
                    "",
                );
                break;

            case LoginErrorCode.SERVICE_UNAVAILABLE:
                this.loginState.loginIndex = LoginIndex.TRY_AGAIN;
                this.loginState.setResponse("", "Service unavailable.", "", "");
                break;

            case LoginErrorCode.AUTHENTICATOR_REQUIRED:
                this.loginState.loginIndex = LoginIndex.AUTHENTICATOR;
                this.loginState.setResponse(
                    "",
                    "Enter the 6-digit code generated by your",
                    "authenticator app.",
                    "",
                );
                break;

            case LoginErrorCode.AUTHENTICATOR_WRONG:
                this.loginState.loginIndex = LoginIndex.AUTHENTICATOR;
                this.loginState.setResponse(
                    "",
                    "The code you entered was incorrect.",
                    "Please try again.",
                    "",
                );
                break;

            case LoginErrorCode.ACCOUNT_DISABLED:
                this.loginState.loginIndex = LoginIndex.BANNED;
                this.loginState.banType = 0;
                break;

            case LoginErrorCode.ACCOUNT_LOCKED:
                this.loginState.loginIndex = LoginIndex.BANNED;
                this.loginState.banType = 1;
                break;

            case LoginErrorCode.DOB_REQUIRED:
                this.loginState.loginIndex = LoginIndex.DATE_OF_BIRTH;
                this.loginState.setResponse(
                    "",
                    "Please enter your date of birth (DD/MM/YYYY)",
                    "",
                    "",
                );
                break;

            case LoginErrorCode.USE_LAUNCHER:
            case LoginErrorCode.GENERAL_ERROR:
                this.loginState.loginIndex = LoginIndex.TRY_AGAIN;
                this.loginState.setResponse("", "Failed to login.", "Please try again.", "");
                break;

            default:
                this.loginState.loginIndex = LoginIndex.TRY_AGAIN;
                this.loginState.setResponse(
                    "",
                    "Unexpected server response.",
                    "Please try using a different world.",
                    "",
                );
                break;
        }

        this.updateGameState(GameState.LOGIN_SCREEN);
    }

    /**
     * Check if we're on the login screen (not logged in).
     * Includes LOADING state since we show the loading bar on the title screen.
     */
    isOnLoginScreen(): boolean {
        return (
            this.gameState === GameState.LOADING ||
            this.gameState === GameState.LOGIN_SCREEN ||
            this.gameState === GameState.CONNECTING ||
            this.gameState === GameState.SPECIAL_LOGIN
        );
    }

    /**
     * Check if we're logged in and playing.
     * LOADING_GAME (25) counts as logged in - the game world renders with loading message overlay.
     */
    isLoggedIn(): boolean {
        return (
            this.gameState === GameState.LOADING_GAME ||
            this.gameState === GameState.LOGGED_IN ||
            this.gameState === GameState.RECONNECTING ||
            this.gameState === GameState.PLEASE_WAIT
        );
    }

    /**
     * Handle login screen keyboard input.
     * Returns true if the input was handled by the login screen.
     */
    handleLoginKeyInput(key: string, char: string): boolean {
        if (!this.isOnLoginScreen()) return false;

        const handled = this.loginRenderer.handleKeyInput(this.loginState, key, char);
        if (handled && this.loginState.loginIndex === LoginIndex.LOGIN_FORM) {
            this.loginState.savePersistedLoginState();
        }
        return handled;
    }

    /**
     * Handle login screen mouse click.
     * Returns the action to perform or undefined.
     */
    handleLoginMouseClick(
        x: number,
        y: number,
        button: number,
    ): "new_user" | "existing_user" | "login" | "cancel" | "connect" | undefined {
        if (!this.isOnLoginScreen()) return undefined;

        const action = this.loginRenderer.handleMouseClick(
            this.loginState,
            x,
            y,
            button,
            this.gameState,
        );

        if (!action) return undefined;

        return this.processLoginAction(action);
    }

    /**
     * Process a login action from the renderer.
     * Handles state changes and returns action string.
     */
    private processLoginAction(
        action: LoginAction,
    ): "new_user" | "existing_user" | "login" | "cancel" | "connect" | undefined {
        switch (action.type) {
            case "new_user":
                console.log("[Login] New user clicked - would open registration");
                this.loginState.virtualKeyboardVisible = false;
                return "new_user";

            case "existing_user":
                this.rememberLoginPlugin.restore(this.loginState);
                this.loginState.promptCredentials();
                if (isMobileMode) {
                    this.loginState.onMobile = true;
                    this.loginState.currentLoginField = this.loginState.username.length > 0 ? 1 : 0;
                    this.loginState.virtualKeyboardVisible = !this.loginState.canAttemptLogin();
                } else {
                    this.loginState.virtualKeyboardVisible = false;
                }
                return "existing_user";

            case "login":
                // Prevent double-clicking login while already connecting
                if (this.gameState === GameState.CONNECTING) {
                    return undefined;
                }
                // Validate credentials
                if (!this.loginState.canAttemptLogin()) {
                    this.loginState.showCredentialValidationError();
                    return undefined;
                }
                // Start connecting
                this.loginState.virtualKeyboardVisible = false;
                this.loginState.savePersistedLoginState();
                this.updateGameState(GameState.CONNECTING);
                return "connect";

            case "cancel":
                this.loginState.loginIndex = LoginIndex.WELCOME;
                this.loginState.password = "";
                this.loginState.virtualKeyboardVisible = false;
                return "cancel";

            case "try_again":
                this.loginState.promptCredentials(true);
                this.loginState.virtualKeyboardVisible = false;
                return undefined;

            case "forgot_password":
                this.loginState.loginIndex = LoginIndex.FORGOT_PASSWORD;
                this.loginState.setResponse(
                    "",
                    "Enter your email to recover your password.",
                    "",
                    "",
                );
                this.loginState.virtualKeyboardVisible = false;
                return undefined;

            case "back":
                this.loginState.loginIndex = LoginIndex.WELCOME;
                this.loginState.virtualKeyboardVisible = false;
                return undefined;

            case "continue":
                // Prevent double-clicking while already connecting
                if (this.gameState === GameState.CONNECTING) {
                    return undefined;
                }
                // Context-dependent continue
                if (this.loginState.loginIndex === LoginIndex.AUTHENTICATOR) {
                    this.loginState.virtualKeyboardVisible = false;
                    this.updateGameState(GameState.CONNECTING);
                    return "connect";
                }
                return undefined;

            case "toggle_remember":
                this.loginState.rememberUsername = !this.loginState.rememberUsername;
                this.loginState.savePersistedLoginState();
                return undefined;

            case "toggle_hide_username":
                this.loginState.isUsernameHidden = !this.loginState.isUsernameHidden;
                this.loginState.savePersistedLoginState();
                return undefined;

            case "toggle_trust":
                this.loginState.trustComputer = !this.loginState.trustComputer;
                return undefined;

            case "toggle_music":
                this.loginState.titleMusicDisabled = !this.loginState.titleMusicDisabled;
                this.loginState.saveTitleMusicSetting(); // Persist to localStorage
                if (this.musicSystem) {
                    if (this.loginState.titleMusicDisabled) {
                        this.cancelPendingLoginMusicStart();
                        this.musicSystem.stopMusic(0, 0);
                    } else {
                        this.musicSystem.setVolume(this._musicVolume * this.masterVolume);
                        if (isLoginMusicState(this.gameState) && !this.musicSystem.playingJingle) {
                            this.scheduleLoginMusicStart(0);
                        }
                    }
                }
                return undefined;

            case "open_server_list":
                this.loginState.serverListOpen = true;
                this.loginState.virtualKeyboardVisible = false;
                this.loginRenderer
                    .fetchServerList()
                    .then(() => this.loginRenderer.refreshServerList());
                return undefined;

            case "close_server_list":
                this.loginState.serverListOpen = false;
                this.loginState.hoveredServerIndex = -1;
                return undefined;

            case "refresh_server_list":
                this.loginRenderer.refreshServerList();
                return undefined;

            case "select_server": {
                const server = this.loginRenderer.serverList[action.index];
                if (server) {
                    this.loginState.serverAddress = server.address;
                    this.loginState.serverName = server.name;
                    this.loginState.serverSecure = server.secure;
                    this.loginState.serverListOpen = false;
                    this.loginState.hoveredServerIndex = -1;
                    setServerUrl(`${server.secure ? "wss" : "ws"}://${server.address}`);
                    this.loginState.saveLastServer();
                }
                return undefined;
            }

            case "open_world_select":
                this.loginState.worldSelectOpen = true;
                this.loginState.virtualKeyboardVisible = false;
                return undefined;

            case "close_world_select":
                this.loginState.worldSelectOpen = false;
                this.loginState.virtualKeyboardVisible = false;
                return undefined;

            case "select_world":
                this.loginState.worldId = action.worldId;
                this.loginState.worldSelectOpen = false;
                this.loginState.virtualKeyboardVisible = false;
                return undefined;

            case "world_page_left":
                if (this.loginState.worldSelectPage > 0) {
                    this.loginState.worldSelectPage--;
                }
                return undefined;

            case "world_page_right":
                if (this.loginState.worldSelectPage < this.loginState.worldSelectPagesCount - 1) {
                    this.loginState.worldSelectPage++;
                }
                return undefined;

            case "world_sort":
                // Toggle sort direction if same column, otherwise switch column
                if (this.loginRenderer.worldSortOption === action.column) {
                    this.loginRenderer.worldSortDirection =
                        this.loginRenderer.worldSortDirection === 0 ? 1 : 0;
                } else {
                    this.loginRenderer.worldSortOption = action.column;
                    this.loginRenderer.worldSortDirection = 0;
                }
                return undefined;

            case "field_click":
                this.loginState.currentLoginField = action.field;
                if (isMobileMode) {
                    this.loginState.onMobile = true;
                    this.loginState.virtualKeyboardVisible = true;
                }
                return undefined;

            default:
                return undefined;
        }
    }

    /**
     * Attempt auto-login if credentials were provided via URL params (?username=X&password=Y).
     * Called after loading completes.
     */
    private tryAutoLogin(): void {
        try {
            const params = new URLSearchParams(window.location.search);
            const username = params.get("username");
            const password = params.get("password");
            if (!username || !password) return;

            // Clear URL params to prevent re-login on refresh
            const url = new URL(window.location.href);
            url.searchParams.delete("username");
            url.searchParams.delete("password");
            window.history.replaceState({}, "", url.toString());

            // Keep URL-param auto-login on the active environment's default server.
            const serverAddress = getDefaultServerAddress();
            setServerUrl(getDefaultWsUrl());
            this.loginState.serverAddress = serverAddress;
            this.loginState.serverName = getDefaultServerName();
            this.loginState.serverSecure = getDefaultServerSecure();

            // Set credentials and trigger login
            this.loginState.username = username;
            this.loginState.password = password;
            this.loginState.loginIndex = LoginIndex.LOGIN_FORM;
            if (!this.loginState.canAttemptLogin()) {
                this.loginState.showCredentialValidationError();
                return;
            }
            this.loginState.savePersistedLoginState();
            this.updateGameState(GameState.CONNECTING);
            sendLogin(username.trim(), password, this.loadedCache?.info?.revision ?? 0);
        } catch {}
    }

    /**
     * Called when login is successful.
     * Transitions through LOADING_GAME state (shows "Loading - please wait.")
     * before entering LOGGED_IN state.
     *
     * Loading requirements are set up when entering CONNECTING state to prevent
     * race conditions where handshake arrives before this method is called.
     */
    onLoginSuccess(): void {
        this.loginState.savePersistedLoginState();

        // Restore uncapped desktop pacing if CS2 previously applied a mobile FPS cap.
        this.applyDisplayDefaults();

        // First show "Loading - please wait." (gameState 25)
        // The game world renders in the background while this message is shown
        this.updateGameState(GameState.LOADING_GAME);

        // Note: Requirements and onComplete callback are set up in updateGameState(CONNECTING)
        // The transition to LOGGED_IN will happen automatically when all requirements are met
    }

    /**
     * Called when login fails.
     */
    onLoginFailed(reason: string): void {
        this.loginState.setResponse("", reason, "", "");
        this.loginState.loginIndex = LoginIndex.INVALID_CREDENTIALS;
        this.updateGameState(GameState.LOGIN_SCREEN);
    }

    /**
     * Perform logout - called by CS2 LOGOUT opcode.
     * Sends logout request to server and waits for consent before completing.
     */
    performLogout(): void {
        console.log("[OsrsClient] Requesting logout from server...");

        // Subscribe to logout response (one-shot)
        const unsubscribe = subscribeLogoutResponse((response) => {
            unsubscribe();

            if (response.success) {
                console.log("[OsrsClient] Server approved logout, completing...");

                // Suppress reconnection after intentional logout
                suppressReconnection();

                // Clear widgets
                this.widgetManager?.clear();

                // Reset login state
                this.loginState.reset();
                this.loginState.loginIndex = LoginIndex.WELCOME;

                // Reset login screen animation state for fresh start
                this.loginRenderer.resetAnimationState();

                // Transition to login screen
                this.updateGameState(GameState.LOGIN_SCREEN);

                console.log("[OsrsClient] Logout complete - returned to login screen");
            } else {
                // Server denied logout (e.g., in combat)
                const reason = response.reason || "You can't log out right now.";
                console.log(`[OsrsClient] Logout denied: ${reason}`);

                // Show denial message to player via game message (type 0)
                chatHistory.addMessage("game", reason);
            }
        });

        // Send logout request to server
        sendLogout();
    }

    /**
     * Tick the login screen animation.
     */
    tickLogin(): void {
        this.loginRenderer.tick();
    }

    startClientTickLoop(): void {
        if (this.clientTickLoopRunning) return;
        this.clientTickLoopRunning = true;
        const perf = (globalThis as any)?.performance;
        const nowMs =
            perf && typeof perf.now === "function" ? (perf.now.call(perf) as number) : Date.now();
        this.clientTickLastNowMs = nowMs;
        this.clientTickAccumulatedMs = 0;

        // Force one immediate tick to increment clientCycle before any widgets load.
        // This ensures rebuildchatbox's dedup check (varcint1112 vs clientclock) won't
        // false-match when chatbox_init and markChatTransmit happen within 20ms.
        this.runClientTicks(1);

        const step = () => {
            if (!this.clientTickLoopRunning) return;
            const perf = (globalThis as any)?.performance;
            const now =
                perf && typeof perf.now === "function"
                    ? (perf.now.call(perf) as number)
                    : Date.now();
            const elapsed = Math.max(0, now - (this.clientTickLastNowMs || now));
            this.clientTickLastNowMs = now;
            // Accumulate elapsed time but clamp to a bounded backlog. This keeps client-cycle
            // simulation progressing during background timer clamping (prevents long movement
            // catch-up), while avoiding huge bursts after long suspends/sleep.
            this.clientTickAccumulatedMs = Math.min(
                OsrsClient.MAX_CLIENT_TICK_BACKLOG_MS,
                this.clientTickAccumulatedMs + elapsed,
            );

            const ticksAvailable =
                Math.floor(this.clientTickAccumulatedMs / OsrsClient.CLIENT_TICK_MS) | 0;
            const ticksToRun = Math.max(
                0,
                Math.min(ticksAvailable, OsrsClient.MAX_CLIENT_TICKS_PER_SLICE),
            );
            if (ticksToRun > 0) {
                // Consume only the portion we're going to run this slice. Any remaining backlog
                // is handled gradually by the cap above (prevents long catch-up hitches).
                this.clientTickAccumulatedMs = Math.max(
                    0,
                    this.clientTickAccumulatedMs - ticksToRun * OsrsClient.CLIENT_TICK_MS,
                );
                this.runClientTicks(ticksToRun);
            }

            // Use a small delay so we approximate 20ms cadence without busy looping. Browsers
            // will throttle timers in the background; elapsed-based catch-up handles that.
            this.clientTickTimer = setTimeout(step, 5);
        };

        this.clientTickTimer = setTimeout(step, 0);
    }

    stopClientTickLoop(): void {
        this.clientTickLoopRunning = false;
        try {
            if (this.clientTickTimer) clearTimeout(this.clientTickTimer);
        } catch {}
        this.clientTickTimer = undefined;
        this.clientTickLastNowMs = 0;
        this.clientTickAccumulatedMs = 0;

        // Cleanup notification subscription
        try {
            this.unsubscribeNotifications?.();
        } catch {}
    }

    private runClientTicks(ticks: number): void {
        if (!(ticks > 0)) return;
        for (let t = 0; t < (ticks | 0); t++) {
            // Client.cycleCntr advances once per 20ms client tick.
            this.transmitCycles.cycleCntr++;

            // midi manager tasks advance on the 20ms client tick.
            try {
                this.musicSystem?.tick?.(1);
            } catch {}

            // Keep per-cycle ordering consistent with the legacy client loop.
            try {
                this.playerMovementSync?.updateInteractionRotations?.();
            } catch {}
            try {
                this.playerEcs.updateClient(1);
            } catch {}
            try {
                this.playerAnimController?.tick?.(1);
            } catch {}
            try {
                this.npcEcs.updateClient(1);
            } catch {}
            try {
                this.worldMap.applyPendingWorldMapDrag();
                if (this.worldMap.cycle()) {
                    this.widgetManager?.invalidateAll?.();
                }
            } catch {}

            // Widget transmit handlers and timers are processed on the client tick,
            // not on the render frame. These queue CS2 events which are then processed below.
            try {
                this.processWidgetTransmits();
                this.transmitCycles.lastTransmitProcessCycle = this.transmitCycles.cycleCntr | 0;
            } catch {}
            try {
                this.processWidgetTimers();
            } catch {}
            try {
                this.processScriptEvents();
            } catch (err) {
                console.warn("Script event processing failed", err);
            }
            try {
                this.itemSpawnerUi.tick();
            } catch {}
            try {
                this.tryWriteVarcs();
            } catch {}
            // type-6 widget model animations are advanced using Client.graphicsCycle
            // during drawWidgets(); keep them on the 20ms tick so frame timing is correct.
            try {
                this.widgetManager.tickModelAnimations(1, this.seqTypeLoader);
            } catch {}
        }
    }

    getMinimapImageUrl(mapX: number, mapY: number, level: number = 0): string | undefined {
        if (mapX < 0 || mapY < 0 || mapX >= MapManager.MAX_MAP_X || mapY >= MapManager.MAX_MAP_Y) {
            return undefined;
        }
        const mapId = this.getMinimapImageKey(mapX, mapY, level);
        const url = this.minimapImageUrls.get(mapId);
        if (url) {
            this.minimapImageAccess.set(mapId, performance.now());
        }
        return url;
    }

    setMinimapImageUrl(mapX: number, mapY: number, url: string, level: number = 0): void {
        const mapId = this.getMinimapImageKey(mapX, mapY, level);
        const old = this.minimapImageUrls.get(mapId);
        if (old) {
            this.releaseMinimapImageUrl(old);
            this.minimapImageUrls.delete(mapId);
            this.minimapImageAccess.delete(mapId);
        }
        this.minimapImageUrls.set(mapId, url);
        this.minimapImageAccess.set(mapId, performance.now());
        this.pruneMinimapImageUrls();
    }

    clearMinimapImageUrls(): void {
        for (const url of this.minimapImageUrls.values()) {
            this.releaseMinimapImageUrl(url);
        }
        this.minimapImageUrls.clear();
        this.minimapImageAccess.clear();
    }

    private releaseMinimapImageUrl(url: string): void {
        const textureCache = (this.renderer?.canvas as any)?.__textureCache;
        if (textureCache && typeof textureCache.evictUrl === "function") {
            try {
                textureCache.evictUrl(url);
            } catch {}
        }
        URL.revokeObjectURL(url);
    }

    private pruneMinimapImageUrls(): void {
        const limit = this.getMinimapImageUrlLimit();
        if (this.minimapImageUrls.size <= limit) return;
        const ids = Array.from(this.minimapImageUrls.keys());
        ids.sort(
            (a, b) =>
                (this.minimapImageAccess.get(a) ?? -Infinity) -
                (this.minimapImageAccess.get(b) ?? -Infinity),
        );
        const toRemove = ids.slice(0, this.minimapImageUrls.size - limit);
        for (const id of toRemove) {
            const url = this.minimapImageUrls.get(id);
            if (url) {
                this.releaseMinimapImageUrl(url);
            }
            this.minimapImageUrls.delete(id);
            this.minimapImageAccess.delete(id);
        }
    }

    initCache(cache: LoadedCache): void {
        // Transition from DOWNLOADING to LOADING state
        if (this.gameState === GameState.DOWNLOADING) {
            this.updateGameState(GameState.LOADING);
        }

        this.loadedCache = cache;
        this.clientScripts.clear();

        const presence = cache.sparse ? new PresenceBitset(cache.sparse.presenceBits) : undefined;
        this.cacheSystem = CacheSystem.fromFiles(cache.type, cache.files, [], presence);

        // On-demand group fetching over HTTP Range requests (js5-style):
        // reads of not-yet-downloaded groups queue a fetch and retry later.
        this.js5 = undefined;
        if (this.js5SweepTimer !== undefined) {
            clearInterval(this.js5SweepTimer);
            this.js5SweepTimer = undefined;
        }
        if (cache.sparse && presence) {
            const store = this.cacheSystem.getStore();
            if (store instanceof SparseMemoryStore) {
                const js5 = new Js5RangeClient(cache.sparse.dat2Url, store);
                const persistence = getSparsePersistence(cache);
                if (persistence) {
                    js5.onFetched((byteOffset, bytes) =>
                        persistence.queue(byteOffset, bytes.byteLength),
                    );
                    // Worker fetches land in the shared buffer without
                    // notifying us; sweep to persist them too.
                    this.js5SweepTimer = setInterval(() => persistence.sweep(presence), 5000);
                }
                js5.onRangeUnsupported = () => {
                    console.error(
                        "[js5] Server stopped honoring Range requests; assets can no longer stream in",
                    );
                };
                this.js5 = js5;
            }
        }

        // Initialize worker pool early - it needs cache files but not indices
        this.workerPool.initCache(cache, []);

        this.initWorldMapController();
        this.npcInstances.clearLocal();
        this.clearMinimapImageUrls();
        this.clearWorldMapImages();
        this.setWorldMapState(WorldMapState.empty());

        // ========== Load Login/Title Screen Assets ==========
        // Authentic phased loading with incremental index loading
        // Each phase loads required idx files then processes them
        // The transition to LOGIN_SCREEN happens when runPhasedLoading completes.
        this.runPhasedLoading(cache);
    }

    /**
     * Authentic phased loading - progress updates based on actual operations completing.
     * Each phase: set progress, force render, wait for next frame.
     */
    private async runPhasedLoading(cache: LoadedCache): Promise<void> {
        const showPhase = async (percent: number, text: string) => {
            this.loginState.loadingPercent = percent;
            this.loginState.loadingText = text;
            try {
                this.renderer?.forceImmediateRender();
            } catch {}
            await new Promise<void>((r) => setTimeout(r, 1));
        };

        try {
            // Phase 1: Loading title background (network fetch)
            await showPhase(5, "Loading title...");
            try {
                await this.loginRenderer.loadTitleBackground();
            } catch (e) {
                console.warn("[OsrsClient] Title background load failed:", e);
            }

            // Phase 2: Loading logo (network fetch)
            await showPhase(15, "Loading logo...");
            try {
                await this.loginRenderer.loadLogoImage();
            } catch {
                // Fallback to cache sprite if PNG fails
            }

            // Phase 3: Loading sprites (cache parse)
            await showPhase(25, "Loading sprites...");
            const spritesLoaded = this.loginRenderer.loadTitleSprites(this.cacheSystem);
            if (!spritesLoaded) {
                console.warn("[OsrsClient] Title sprites failed to load");
            }

            // Phase 4: Loading fonts (cache parse)
            await showPhase(35, "Loading fonts...");
            const fontsLoaded = this.loginRenderer.loadFonts(this.cacheSystem);
            if (!fontsLoaded) {
                console.warn("[OsrsClient] Fonts failed to load");
            }

            // Phase 5: Loading config (creating type loaders)
            await showPhase(45, "Loading config...");
            // Initialize Huffman and loaders (indices already loaded)
            initPlayerSyncHuffman(this.cacheSystem);
            this.loaderFactory = getCacheLoaderFactory(cache.info, this.cacheSystem);

            this.textureLoader = this.loaderFactory.getTextureLoader();
            this.modelLoader = this.loaderFactory.getModelLoader();
            this.seqTypeLoader = this.loaderFactory.getSeqTypeLoader();
            this.seqFrameLoader = this.loaderFactory.getSeqFrameLoader();
            this.skeletalSeqLoader = this.loaderFactory.getSkeletalSeqLoader?.();
            this.worldEntityTypeLoader = this.loaderFactory.getWorldEntityTypeLoader?.();
            this.spotAnimTypeLoader = this.loaderFactory.getSpotAnimTypeLoader();
            this.locTypeLoader = this.loaderFactory.getLocTypeLoader();
            this.objTypeLoader = this.loaderFactory.getObjTypeLoader();
            try {
                const configIndex = this.cacheSystem.getIndex(IndexType.DAT2.configs);
                const mapFunctionsArchiveId =
                    cache.info.game === "oldschool"
                        ? ConfigType.OSRS.mapFunctions
                        : ConfigType.RS2.mapFunctions;
                if (configIndex.archiveExists(mapFunctionsArchiveId)) {
                    this.mapElementTypeLoader = new ArchiveMapElementTypeLoader(
                        cache.info,
                        configIndex.getArchive(mapFunctionsArchiveId),
                    );
                } else {
                    this.mapElementTypeLoader = undefined;
                }
            } catch (error) {
                this.mapElementTypeLoader = undefined;
                console.log("[OsrsClient] Failed to load map element types", { error });
            }
            this.objModelLoader = new ObjModelLoader(
                this.objTypeLoader,
                this.modelLoader,
                this.textureLoader,
            );
            this.groundItems.setMetadataResolver((itemId) => {
                try {
                    const obj = this.objTypeLoader?.load?.(itemId | 0);
                    const name =
                        typeof obj?.name === "string" && obj.name.length > 0 ? obj.name : undefined;
                    const gePrice = Math.max(0, obj?.price ?? 0);
                    const haPrice = Math.max(0, Math.floor(gePrice * 0.6));
                    return {
                        name: name ?? `Item ${itemId | 0}`,
                        gePrice,
                        haPrice,
                        tradeable: obj?.isTradable === true,
                    };
                } catch {
                    return {
                        name: `Item ${itemId | 0}`,
                        gePrice: 0,
                        haPrice: 0,
                        tradeable: false,
                    };
                }
            });
            this.npcTypeLoader = this.loaderFactory.getNpcTypeLoader();
            this.basTypeLoader = this.loaderFactory.getBasTypeLoader();
            this.idkTypeLoader = this.loaderFactory.getIdkTypeLoader();

            // Phase 6: Loading sounds (audio systems)
            await showPhase(55, "Loading sounds...");
            this.soundEffectLoader = new SoundEffectLoader(cache.info, this.cacheSystem);
            this.soundEffectSystem = this.soundEffectLoader.available()
                ? new SoundEffectSystem(this.soundEffectLoader)
                : undefined;
            this.musicSystem = new MusicSystem(this.cacheSystem);

            this._musicVolume = 1.0;
            this._sfxVolume = 1.0;
            this._ambientVolume = 1.0;
            this.masterVolume = 1.0;
            if (this.musicSystem) {
                const musicVol = this.loginState.titleMusicDisabled
                    ? 0
                    : this._musicVolume * this.masterVolume;
                this.musicSystem.setVolume(musicVol);
            }
            if (this.soundEffectSystem) {
                this.soundEffectSystem.setVolume(this._sfxVolume * this.masterVolume);
                this.soundEffectSystem.setAmbientVolume(this._ambientVolume * this.masterVolume);
            }

            // Phase 7: Loading variables
            await showPhase(65, "Loading variables...");
            this.inventory.clear();
            this.inventorySeededFromServer = false;
            this.npcInstances.applyNameOverrides();
            this.writeVarcs();
            this.varcPersistence.resetWriteTracking();
            this.varManager = new VarManager(
                this.loaderFactory.getVarBitTypeLoader(),
                this.loaderFactory.getVarcIntTypeLoader(),
            );
            this.varcPersistence.initStorageKey(cache.info);
            this.varcPersistence.restoreFromBrowser();
            this.accountTypeVarbitAvailable = undefined;

            this.initCombatOptionsController();
            this.combatOptions.initVarDefaults();

            this.varManager.onVarpChange = (varpId, _oldValue, newValue) => {
                if (this.cs2Vm?.isRunning()) {
                    this.cs2Vm.queueVarpChange(varpId);
                } else {
                    markVarTransmit(varpId);
                }
                this.applyAudioVarpChange(varpId, newValue);
                if (!this._serverVarpSync && TRANSMIT_VARPS.has(varpId) && isServerConnected()) {
                    try {
                        sendVarpTransmit(varpId, newValue);
                    } catch {}
                }
                if (varpId === VARP_OPTION_RUN) {
                    const runOn = newValue !== 0;
                    if (this.runMode !== runOn) this.runMode = runOn;
                }
                if (varpId === VARP_OPTION_ATTACK_PRIORITY_PLAYER) {
                    ClientState.playerAttackOption = clamp(newValue | 0, 0, 4);
                } else if (varpId === VARP_OPTION_ATTACK_PRIORITY_NPC) {
                    ClientState.npcAttackOption = clamp(newValue | 0, 0, 3);
                }
                // Varbit changes arrive through their underlying varp, so re-read the
                // roof varbit on every varp update.
                try {
                    const varbitValue = this.varManager.getVarbit(VARBIT_ROOF_REMOVAL);
                    if (varbitValue !== undefined) {
                        this.setRoofsHidden(varbitValue === 1);
                    }
                } catch {}
            };
            // Initialize roof state from current varbit
            try {
                const initialRoofVarbit = this.varManager.getVarbit(VARBIT_ROOF_REMOVAL);
                if (initialRoofVarbit !== undefined) {
                    this.setRoofsHidden(initialRoofVarbit === 1);
                }
            } catch (err) {
                console.warn("[OsrsClient] Failed to init roof state", err);
            }
            ClientState.playerAttackOption = clamp(
                (this.varManager.getVarp(VARP_OPTION_ATTACK_PRIORITY_PLAYER) ?? 0) | 0,
                0,
                4,
            );
            ClientState.npcAttackOption = clamp(
                (this.varManager.getVarp(VARP_OPTION_ATTACK_PRIORITY_NPC) ?? 0) | 0,
                0,
                3,
            );
            this.varManager.onVarcIntChange = (varcId) => {
                if (this.varManager.isPersistentVarc(varcId)) {
                    this.markVarcsChanged();
                }
                if (this.cs2Vm?.isRunning()) {
                    this.cs2Vm.queueVarcChange(varcId);
                }
            };
            this.varManager.onVarcStringChange = (varcId) => {
                if (this.varManager.isPersistentVarc(varcId)) {
                    this.markVarcsChanged();
                }
                if (this.cs2Vm?.isRunning()) {
                    this.cs2Vm.queueVarcChange(varcId);
                }
            };

            // Phase 8: Loading maps
            await showPhase(75, "Loading maps...");
            const mapFileLoader = this.loaderFactory.getMapFileLoader();
            this.mapFileIndex = mapFileLoader.mapFileIndex;
            this.isNewTextureAnim = cache.info.game === "runescape" && cache.info.revision >= 681;
            this.setWorldMapState(WorldMapState.load(this.cacheSystem));
            this.worldMap.initArchiveRenderer();

            // Phase 9: Preparing interface
            await showPhase(90, "Preparing interface...");
            this.widgetManager = new WidgetManager(this.cacheSystem);
            try {
                const { GraphicsDefaults } = require("../rs/config/defaults/GraphicsDefaults");
                const graphicsDefaults = GraphicsDefaults.load(cache.info, this.cacheSystem);
                if (graphicsDefaults?.compass >= 0) {
                    this.widgetManager.compassSpriteId = graphicsDefaults.compass;
                }
                if (graphicsDefaults?.scrollBars >= 0) {
                    this.widgetManager.scrollbarSpriteArchiveId = graphicsDefaults.scrollBars;
                }
            } catch (e) {
                console.warn("[OsrsClient] Failed to load GraphicsDefaults:", e);
            }

            this.startClientTickLoop();
            this.renderer.initCache();
            this.hitsplatFlush.flushAll();
            this.initCacheDependent();

            // Phase 10: Loading overlays (hitsplat/health bar sprites and fonts)
            await showPhase(95, "Loading overlays...");
            this.renderer.initOverlays();

            // Complete - transition to login screen
            this.loginState.loadingText = "";
            this.updateGameState(GameState.LOGIN_SCREEN);
            this.loginState.loginIndex = LoginIndex.WELCOME;

            // Auto-login if credentials provided via URL params
            this.tryAutoLogin();
        } catch (err) {
            console.error("[OsrsClient] Phased loading failed:", err);
            this.loginState.loadingPercent = 100;
            this.loginState.loadingText = "";
            this.updateGameState(GameState.LOGIN_SCREEN);
            this.loginState.loginIndex = LoginIndex.WELCOME;
        }
    }

    handleSeqFrameSounds(seqType: SeqType, frame: number, context?: SequenceSoundContext): void {
        let effects: SeqSoundEffect[] | undefined = seqType.frameSounds?.get(frame);

        // Fallback: convert legacy soundEffects array (index = frame) to modern format
        // Older cache revisions store sounds as a packed array where index = frame number
        if (
            (!effects || effects.length === 0) &&
            seqType.soundEffects &&
            frame < seqType.soundEffects.length
        ) {
            const packed = seqType.soundEffects[frame];
            if (packed > 0) {
                // Legacy format: id = bits 8-23, loops = bits 4-6, location = bits 0-3
                const id = packed >> 8;
                const loops = (packed >> 4) & 7;
                const location = packed & 15;
                if (id > 0) {
                    effects = [{ id, loops, location }];
                }
            }
        }

        if (!effects || effects.length === 0) {
            return;
        }

        const ctx: SequenceSoundContext = {
            ...context,
            debugSeqId: (seqType as any)?.id ?? undefined,
            debugFrame: frame | 0,
        };
        this.soundEffectSystem?.handleSeqFrameSounds(effects, ctx);
    }

    private handleInventoryServerUpdate(update: InventoryServerUpdate): void {
        if (!update) return;
        this.inventorySeededFromServer = true;

        try {
            console.log("[inventory] server update", update);
        } catch {}

        if (update.kind === "snapshot") {
            const slots = Array.isArray(update.slots)
                ? update.slots.map((slot) => ({
                      slot: Math.max(0, Math.min(Inventory.SLOT_COUNT - 1, slot.slot | 0)),
                      itemId: slot.itemId | 0,
                      quantity: typeof slot.quantity === "number" ? slot.quantity | 0 : 0,
                  }))
                : [];

            // Inventory dragging is predicted locally. A server snapshot that matches
            // any queued prediction is an acknowledgement, not a new UI state. Keep
            // the newest local prediction on screen when several moves are in flight,
            // and avoid rerunning inv-transmit scripts for an identical echo.
            if (this.pendingInventoryMovePredictions.length > 0) {
                const incomingSignature = this.inventory.snapshotSignature(slots);
                const acknowledgedIndex = this.pendingInventoryMovePredictions.findIndex(
                    (prediction) => prediction.after === incomingSignature,
                );
                if (acknowledgedIndex >= 0) {
                    this.pendingInventoryMovePredictions.splice(0, acknowledgedIndex + 1);
                    return;
                }

                // A snapshot queued before the move packet can arrive after the local
                // prediction. Recognize that pre-move state and leave the prediction
                // visible while the server processes the already-sent move.
                if (
                    this.pendingInventoryMovePredictions.some(
                        (prediction) => prediction.before === incomingSignature,
                    )
                ) {
                    return;
                }

                if (this.inventory.matchesSnapshot(slots)) {
                    this.pendingInventoryMovePredictions.length = 0;
                    return;
                }

                // The server disagrees with every prediction. Drop the prediction
                // history and apply this authoritative correction normally.
                this.pendingInventoryMovePredictions.length = 0;
            }

            // Selection is client-only: preserve current selection iff item still exists
            const prevSel = this.inventory.getSelectedSlot();
            const keepSel =
                prevSel != null &&
                prevSel >= 0 &&
                prevSel < slots.length &&
                (slots[prevSel]?.itemId ?? -1) > 0
                    ? prevSel
                    : null;
            this.inventory.setSnapshot(slots, { selectedSlot: keepSel });
        } else if (update.kind === "slot") {
            const slot = update.slot;
            if (slot) {
                const idx = Math.max(0, Math.min(Inventory.SLOT_COUNT - 1, slot.slot | 0));
                const itemId = slot.itemId | 0;
                const quantity = typeof slot.quantity === "number" ? slot.quantity | 0 : 0;
                if (
                    this.pendingInventoryMovePredictions.length > 0 &&
                    this.inventory.matchesSlot(idx, itemId, quantity)
                ) {
                    return;
                }
                if (this.pendingInventoryMovePredictions.length > 0) {
                    this.pendingInventoryMovePredictions.length = 0;
                }
                this.inventory.setSlot(idx, itemId, quantity);
            }
        }

        try {
            console.log("[inventory] snapshot post-update", this.inventory.getSlots());
        } catch {}

        // Mark inv cycle with specific inventory ID - handlers fire during processWidgetTransmits()
        // Inventory ID 93 is the player inventory in OSRS
        markInvTransmit(93);
        this.rebuildTradeInventoryWidget();
    }

    /**
     * Handle bank container updates from server.
     * Populates bank inventory (ID 95) so CS2 inv_getobj(bank, slot)/inv_getnum(bank, slot) work.
     *
     * Note: Bank CS2 scripts index slots 0..1409 (bankmain_build uses constant 1410).
     */
    private handleBankServerUpdate(update: BankServerUpdate): void {
        if (!update) return;

        try {
            console.log("[bank] server update", update.kind);
        } catch {}

        if (update.kind === "snapshot") {
            const slots = Array.isArray(update.slots)
                ? update.slots.map((slot: any) => ({
                      slot: Math.max(0, Math.min(1409, slot.slot | 0)),
                      itemId: slot.itemId | 0,
                      quantity: typeof slot.quantity === "number" ? slot.quantity | 0 : 0,
                  }))
                : [];
            this.bankInventory.setSnapshot(slots, { selectedSlot: null });

            try {
                if ((globalThis as any).__debugBank === true) {
                    const sample = slots.filter((s) => (s.itemId | 0) > 0).slice(0, 10);
                    console.log("[bank] snapshot applied", { slots: slots.length, sample });
                }
            } catch {}
        } else if (update.kind === "slot") {
            const slot = update.slot;
            if (slot) {
                const idx = Math.max(0, Math.min(1409, slot.slot | 0));
                this.bankInventory.setSlot(
                    idx,
                    slot.itemId | 0,
                    typeof slot.quantity === "number" ? slot.quantity | 0 : 0,
                );
            }
        }

        // Mark inv cycle for bank (95) - handlers fire during processWidgetTransmits()
        markInvTransmit(95);

        // Bank main item rendering is driven by onInvTransmit(bank) on group 12.
        // Trigger it immediately after applying the snapshot/slot update so the
        // main bank list rebuilds from the latest container state in the same turn.
        if (
            this.widgetManager.rootInterface === 12 ||
            this.widgetManager.getInterfaceParentContainerUid(12) !== undefined
        ) {
            this.triggerInvTransmitForGroup(12);
        }
    }

    /**
     * Handle collection log inventory updates from server.
     * Populates collection_transmit inventory (ID 620) so CS2 inv_total() queries work.
     */
    private handleCollectionLogServerUpdate(update: CollectionLogServerPayload): void {
        if (!update || update.kind !== "snapshot") return;

        try {
            console.log("[collection_log] server update", update.slots?.length ?? 0, "items");
        } catch {}

        // Clear existing items and populate with snapshot
        this.collectionInventory.clear();

        if (Array.isArray(update.slots)) {
            for (const slot of update.slots) {
                const idx = Math.max(0, Math.min(2047, slot.slot | 0));
                this.collectionInventory.setSlot(
                    idx,
                    slot.itemId | 0,
                    typeof slot.quantity === "number" ? slot.quantity | 0 : 1,
                );
            }
        }

        // Mark inv cycle for collection_transmit (620) - handlers fire during processWidgetTransmits()
        markInvTransmit(620);
    }

    private handleShopServerUpdate(state: ShopWindowState): void {
        if (!state) return;

        // Clear shop inventory when closed
        if (!state.open) {
            this.shopInventory.clear();
            return;
        }

        try {
            console.log("[shop] server update", state.stock?.length ?? 0, "items");
        } catch {}

        // Clear existing items and populate with shop stock
        this.shopInventory.clear();

        if (Array.isArray(state.stock)) {
            for (const entry of state.stock) {
                const slot = Math.max(0, Math.min(39, entry.slot | 0));
                const itemId = entry.itemId | 0;
                const quantity = typeof entry.quantity === "number" ? entry.quantity | 0 : 1;
                if (itemId > 0) {
                    this.shopInventory.setSlot(slot, itemId, quantity);
                }
            }
        }

        // Mark inv cycle for shop (516) - handlers fire during processWidgetTransmits()
        markInvTransmit(516);
    }

    /**
     * Populate the cache trade containers so the native trade widget's CS2
     * scripts render the server-authoritative offers.
     */
    private handleTradeServerUpdate(state: TradeWindowState): void {
        this.tradeState = state;

        const toSlots = (offers: NonNullable<TradeWindowState["self"]>["offers"] | undefined) =>
            (offers ?? []).map((entry) => ({
                slot: Math.max(0, Math.min(Inventory.SLOT_COUNT - 1, entry.slot | 0)),
                itemId: entry.itemId | 0,
                quantity: Math.max(0, entry.quantity | 0),
            }));

        if (state.open) {
            this.tradeOfferInventory.setSnapshot(toSlots(state.self?.offers), {
                selectedSlot: null,
            });
            this.tradeOtherOfferInventory.setSnapshot(toSlots(state.other?.offers), {
                selectedSlot: null,
            });
        } else {
            this.tradeOfferInventory.clear();
            this.tradeOtherOfferInventory.clear();
        }

        // The cache trade scripts use inventory 90 and INVOTHER operations
        // (90 + 32768) for the counterparty.
        markInvTransmit(90);
        markInvTransmit(90 + 32768);
        for (const groupId of [334, 335, 336]) {
            if (
                this.widgetManager &&
                (this.widgetManager.rootInterface === groupId ||
                    this.widgetManager.getInterfaceParentContainerUid(groupId) !== undefined)
            ) {
                this.triggerInvTransmitForGroup(groupId);
            }
        }
    }

    private rebuildTradeInventoryWidget(): void {
        if (
            !this.tradeState?.open ||
            this.tradeState.stage !== "offer" ||
            !this.cs2Vm ||
            !this.widgetManager ||
            this.widgetManager.getInterfaceParentContainerUid(336) === undefined
        ) {
            return;
        }

        const script = this.cs2Vm.context.loadScript(3619);
        if (!script) return;
        const previousActiveWidget = this.cs2Vm.activeWidget;
        const previousDotWidget = this.cs2Vm.dotWidget;
        this.cs2Vm.activeWidget = null;
        this.cs2Vm.dotWidget = null;
        try {
            this.cs2Vm.run(script, [336 << 16, this.inventory.capacity], []);
        } catch (err) {
            console.warn("[trade] failed to rebuild trade inventory", err);
        } finally {
            this.cs2Vm.activeWidget = previousActiveWidget;
            this.cs2Vm.dotWidget = previousDotWidget;
        }
    }

    /** Display an item's cache-defined Examine text in game chat. */
    examineWidgetItem(widget: { itemId?: number } | null | undefined): boolean {
        const itemId = widget?.itemId ?? -1;
        if (!(itemId > 0)) return false;
        try {
            const examine = this.objTypeLoader?.load?.(itemId)?.examine;
            if (typeof examine !== "string" || examine.length === 0 || examine === "null") {
                return false;
            }
            chatHistory.addMessage("game", examine);
            return true;
        } catch {
            return false;
        }
    }

    /** Route the native trade widget's actions into the dedicated trade protocol. */
    private handleTradeWidgetAction(
        widget: any,
        event: { option?: string; slot?: number; itemId?: number },
        groupId: number,
        childId: number,
    ): boolean {
        return this.widgetActionRouter.handleTradeWidgetAction(widget, event, groupId, childId);
    }

    private findNpcServerId(
        npcTypeId: number,
        opts: {
            mapX?: number;
            mapY?: number;
            tile?: { tileX: number; tileY: number };
        },
    ): number | undefined {
        const targetTile = opts.tile;
        let bestId: number | undefined;
        let bestDist = Number.POSITIVE_INFINITY;

        // Helper to compute distance and update best match
        const consider = (serverId: number, ecsId: number) => {
            if (!this.npcEcs.isActive(ecsId)) return;
            if ((this.npcEcs.getNpcTypeId(ecsId) | 0) !== (npcTypeId | 0)) return;

            let dist = 0;
            if (targetTile) {
                // Get NPC world position from ECS
                const mapId = this.npcEcs.getMapId(ecsId) | 0;
                const mapX = (mapId >> 8) & 0xff;
                const mapY = mapId & 0xff;
                const worldX = ((mapX << 13) + (this.npcEcs.getX(ecsId) | 0)) | 0;
                const worldY = ((mapY << 13) + (this.npcEcs.getY(ecsId) | 0)) | 0;
                // Target is the clicked tile center in world coords
                const targetX = ((targetTile.tileX | 0) << 7) + 64;
                const targetY = ((targetTile.tileY | 0) << 7) + 64;
                const dx = worldX - targetX;
                const dy = worldY - targetY;
                dist = dx * dx + dy * dy;
            }

            if (bestId === undefined || dist < bestDist) {
                bestId = serverId | 0;
                bestDist = dist;
            }
        };

        // Search all active linked NPCs directly from ECS mapping.
        for (const ecsId of this.npcEcs.getAllActiveIds()) {
            if (!this.npcEcs.isLinked(ecsId | 0)) continue;
            const serverId = this.npcEcs.getServerId(ecsId | 0);
            if (serverId <= 0) continue;
            consider(serverId | 0, ecsId | 0);
        }

        if (bestId !== undefined) {
            return bestId;
        }

        // Fallback: if mapX/mapY are provided, also check that specific region
        const filterMapX =
            typeof opts.mapX === "number" && Number.isFinite(opts.mapX) ? opts.mapX | 0 : undefined;
        const filterMapY =
            typeof opts.mapY === "number" && Number.isFinite(opts.mapY) ? opts.mapY | 0 : undefined;

        if (filterMapX !== undefined && filterMapY !== undefined) {
            const ids = this.npcEcs.queryByMap(filterMapX, filterMapY);
            for (const ecsId of ids) {
                if (!this.npcEcs.isLinked(ecsId | 0)) continue;
                const serverId = this.npcEcs.getServerId(ecsId | 0);
                if (serverId <= 0) continue;
                consider(serverId | 0, ecsId | 0);
                if (bestId !== undefined) break;
            }
        }

        return bestId;
    }
    // ===== Emotes =====
    sendEmote(index: number, loop: boolean = false): void {
        try {
            netSendEmote(Math.max(0, index | 0), !!loop);
        } catch {}
    }

    onLocChange(
        oldId: number,
        newId: number,
        tile: { x: number; y: number },
        level: number,
        opts?: {
            oldTile?: { x: number; y: number };
            newTile?: { x: number; y: number };
            oldRotation?: number;
            newRotation?: number;
            newShape?: number;
        },
    ): void {
        // Handle loc change (e.g., door open/close)
        try {
            console.log(
                `[OsrsClient] Loc change: ${oldId} -> ${newId} at (${tile.x}, ${tile.y}, ${level})`,
            );
            // Notify renderer to update the loc
            if (this.renderer && typeof (this.renderer as any).onLocChange === "function") {
                (this.renderer as any).onLocChange(oldId, newId, tile, level, opts);
            }
        } catch (err) {
            console.warn("onLocChange error", err);
        }
    }

    refreshGamemodeWorldLocs(): void {
        try {
            if (
                this.renderer &&
                typeof (this.renderer as any).refreshGamemodeWorldLocs === "function"
            ) {
                (this.renderer as any).refreshGamemodeWorldLocs();
            }
        } catch (err) {
            console.warn("refreshGamemodeWorldLocs error", err);
        }
    }

    onLocAddChange(
        locId: number,
        tile: { x: number; y: number },
        level: number,
        shape: number,
        rotation: number,
    ): void {
        try {
            console.log(
                `[OsrsClient] Loc add: ${locId} at (${tile.x}, ${tile.y}, ${level}) shape=${shape} rot=${rotation}`,
            );
            if (this.renderer && typeof (this.renderer as any).onLocAddChange === "function") {
                (this.renderer as any).onLocAddChange(locId, tile, level, shape, rotation);
            }
        } catch (err) {
            console.warn("onLocAddChange error", err);
        }
    }

    onLocDel(tile: { x: number; y: number }, level: number, shape: number, rotation: number): void {
        try {
            console.log(
                `[OsrsClient] Loc del at (${tile.x}, ${tile.y}, ${level}) shape=${shape} rot=${rotation}`,
            );
            if (this.renderer && typeof (this.renderer as any).onLocDel === "function") {
                (this.renderer as any).onLocDel(tile, level, shape, rotation);
            }
        } catch (err) {
            console.warn("onLocDel error", err);
        }
    }

    onLocAnim(
        locId: number,
        tile: { x: number; y: number },
        level: number,
        shape: number,
        rotation: number,
        animId: number,
    ): void {
        try {
            if (this.renderer && typeof (this.renderer as any).onLocAnim === "function") {
                (this.renderer as any).onLocAnim(locId, tile, level, shape, rotation, animId);
            }
        } catch (err) {
            console.warn("onLocAnim error", err);
        }
    }

    private applyDisplayDefaults(): void {
        this.renderDistance = clampRenderDistance(this.renderDistance);
        // CS2 mobile_setfps can leave targetFps stuck at ~20; desktop must not keep that.
        if (!isMobileMode && this.targetFps > 0 && this.targetFps < 60) {
            this.targetFps = DEFAULT_FPS_LIMIT;
        }
        try {
            if (this.renderer) {
                this.renderer.fpsLimit = this.targetFps;
            }
        } catch (error) {
            console.log("[OsrsClient] Failed to apply FPS limit", { error });
        }
        this.applyMobileMapCacheBudget();
        // Apply movement speed preference (halve movement speed as requested)
        try {
            // Keep walk at OSRS pace; slightly slow down run only
            this.playerEcs.setWalkSpeedMultiplier?.(1.0);
            this.playerEcs.setRunSpeedMultiplier?.(0.85);
        } catch (error) {
            console.log("[OsrsClient] Failed to apply movement speed multipliers", { error });
        }
    }

    setTargetFps(limit: number): void {
        let next = Number.isFinite(limit) ? Math.max(0, limit | 0) : 0;
        // Ignore CS2/mobile battery caps on desktop (values like 20 pin the limiter).
        if (!isMobileMode && next > 0 && next < 60) {
            next = DEFAULT_FPS_LIMIT;
        }
        this.targetFps = next;
        try {
            if (this.renderer) {
                this.renderer.fpsLimit = next;
            }
        } catch (error) {
            console.log("[OsrsClient] Failed to set FPS limit", { error, next });
        }
    }

    private applyMobileMapCacheBudget(mapRadiusOverride?: number): void {
        if (!isTouchDevice) return;
        const mapRadius = Math.max(0, (mapRadiusOverride ?? this.mapRadius) | 0);
        const activeGridSize = (mapRadius * 2 + 1) ** 2;
        // Keep one extra ring warm for short camera/player oscillations.
        const warmRadius = mapRadius + 1;
        const warmGridSize = (warmRadius * 2 + 1) ** 2;
        const mapBudget = Math.max(
            activeGridSize,
            Math.min(MOBILE_MAX_RESIDENT_MAPS, warmGridSize),
        );
        try {
            this.renderer.mapManager.setMaxResidentMaps(mapBudget);
        } catch (error) {
            console.log("[OsrsClient] Failed to apply map cache budget", { error, mapBudget });
        }
    }

    private applyNpcInfo(payload: NpcInfoPayload): void {
        if (!payload || !payload.packet) return;
        const controlledId = this.controlledPlayerServerId | 0;
        const fallbackLocalId = this.lastPlayerSyncLocalIndex | 0;
        const localId = controlledId >= 0 ? controlledId : fallbackLocalId;
        let localState = this.playerMovementSync.getState(localId);
        if (!localState && localId >= 0 && this.playerSyncManager.hasSeenFrame()) {
            const localEcs = this.playerEcs.getIndexForServerId(localId);
            if (localEcs !== undefined) {
                const subX = this.playerEcs.getX(localEcs) | 0;
                const subY = this.playerEcs.getY(localEcs) | 0;
                const level = this.playerEcs.getLevel(localEcs) | 0;
                try {
                    this.playerMovementSync.registerEntity({
                        serverId: localId,
                        ecsIndex: localEcs | 0,
                        tile: { x: (subX >> 7) | 0, y: (subY >> 7) | 0 },
                        level,
                        subX,
                        subY,
                    });
                    localState = this.playerMovementSync.getState(localId);
                } catch {}
            }
        }

        const decodeBase = localState
            ? { tileX: localState.tileX, tileY: localState.tileY, level: localState.level }
            : this.lastNpcDecodeBase; // use last known base regardless of localId
        if (!decodeBase) return;
        this.lastNpcDecodeBase = {
            tileX: decodeBase.tileX | 0,
            tileY: decodeBase.tileY | 0,
            level: decodeBase.level | 0,
        };

        const decoded = this.npcUpdateDecoder.decode(payload.packet, {
            large: payload.large === true,
            loopCycle: payload.loopCycle | 0,
            clientCycle: getClientCycle() | 0,
            localTileX: decodeBase.tileX | 0,
            localTileY: decodeBase.tileY | 0,
            level: decodeBase.level | 0,
        });

        for (const npcId of decoded.removals) {
            this.despawnNpcBinary(npcId | 0);
        }

        for (const spawn of decoded.spawns) {
            this.spawnNpcBinary(spawn, payload.loopCycle | 0);
        }

        for (const move of decoded.movements) {
            this.applyNpcMovementBinary(move, payload.loopCycle | 0);
        }

        for (const [npcId, block] of decoded.updateBlocks) {
            this.applyNpcBlocksBinary(npcId | 0, block, payload.loopCycle | 0);
        }
    }

    private getNpcInstanceRenderMapId(
        instance: Pick<NpcInstance, "worldViewId" | "x" | "y">,
    ): number {
        const worldViewId = instance.worldViewId;
        if (typeof worldViewId === "number" && worldViewId >= 0) {
            const overlayMapX = 200 + (worldViewId | 0);
            const overlayMapY = 200 + (worldViewId | 0);
            return getMapSquareId(overlayMapX, overlayMapY);
        }
        const mapX = getMapIndexFromTile(instance.x | 0);
        const mapY = getMapIndexFromTile(instance.y | 0);
        return getMapSquareId(mapX, mapY);
    }

    private spawnNpcBinary(
        spawn: import("./sync/NpcUpdateDecoder").NpcSpawn,
        loopCycle: number,
    ): void {
        const serverId = spawn.npcId | 0;
        if (serverId <= 0) return;
        // Keep OSRS-style global NPC index array in sync for menuAction packet gates.
        ClientState.npcs[serverId] = { index: serverId };

        const worldTileX = spawn.tileX | 0;
        const worldTileY = spawn.tileY | 0;
        const mapX = getMapIndexFromTile(worldTileX);
        const mapY = getMapIndexFromTile(worldTileY);
        const localTileX = worldTileX & 63;
        const localTileY = worldTileY & 63;
        const mapBaseX = (mapX << 13) | 0;
        const mapBaseY = (mapY << 13) | 0;

        const existingEcs = this.npcEcs.getEcsIdForServer(serverId);
        if (existingEcs !== undefined) {
            // existing NPC ids in the add stream still apply a movement update.
            // Near-range non-teleport updates queue a walk target; far/teleport updates reset path.
            const existingMapId = this.npcEcs.getMapId(existingEcs) | 0;
            const existingMapX = (existingMapId >> 8) & 0xff;
            const existingMapY = existingMapId & 0xff;
            if (existingMapX !== (mapX | 0) || existingMapY !== (mapY | 0)) {
                this.npcEcs.rebaseToMapSquare(existingEcs, mapX, mapY);
            }

            const size = Math.max(1, this.npcEcs.getSize(existingEcs) | 0);
            const worldSubX = (worldTileX << 7) + (size << 6);
            const worldSubY = (worldTileY << 7) + (size << 6);
            const localX = (worldSubX - mapBaseX) | 0;
            const localY = (worldSubY - mapBaseY) | 0;

            const state = this.npcEcs.getServerState(existingEcs);
            let snap = !!spawn.teleport;
            let queueAbsoluteWalk = false;
            if (!snap && state) {
                const dx = (worldTileX - (state.tileX | 0)) | 0;
                const dy = (worldTileY - (state.tileY | 0)) | 0;
                if (Math.abs(dx) <= 8 && Math.abs(dy) <= 8) {
                    queueAbsoluteWalk = true;
                } else {
                    snap = true;
                }
            } else if (!snap) {
                // Missing movement state: fallback to resetPath semantics.
                snap = true;
            }

            this.npcMovementSync.applyNpcUpdate(
                {
                    serverId,
                    ecsIndex: existingEcs,
                    subX: worldSubX,
                    subY: worldSubY,
                    level: spawn.level | 0,
                    moved: true,
                    running: false,
                    snap,
                    localX,
                    localY,
                    mapBaseX,
                    mapBaseY,
                    queueAbsoluteWalk,
                },
                { forceImmediateRotation: !!spawn.teleport },
            );
            this.npcEcs.setLevel(existingEcs, spawn.level | 0);
            this.npcEcs.setOccTile(existingEcs, localTileX, localTileY, spawn.level | 0);
            if ((spawn as any).worldViewId !== undefined && (spawn as any).worldViewId >= 0) {
                this.npcEcs.setWorldViewId(existingEcs, (spawn as any).worldViewId);
                this.worldViewManager.addNpcToWorldView((spawn as any).worldViewId, existingEcs);
            }

            // Keep the instance map entry up to date for geometry streaming.
            this.upsertNpcInstanceFromBinary(
                serverId,
                spawn.typeId | 0,
                worldTileX,
                worldTileY,
                spawn.level | 0,
                (spawn as any).worldViewId,
            );
            return;
        }

        if (!this.npcTypeLoader) return;

        let npcType: any;
        try {
            npcType = this.npcTypeLoader.load(spawn.typeId | 0);
        } catch {
            return;
        }
        const size = Math.max(1, npcType?.size | 0);
        const rotSpeed = Math.max(1, npcType?.rotationSpeed | 0);
        const localX = (localTileX * 128 + size * 64) | 0;
        const localY = (localTileY * 128 + size * 64) | 0;

        const ecsId = this.npcEcs.createNpc(
            mapX,
            mapY,
            spawn.typeId | 0,
            size,
            localX,
            localY,
            spawn.level | 0,
            spawn.rot | 0,
            localTileX,
            localTileY,
            rotSpeed,
        );
        this.npcEcs.setServerMapping(ecsId, serverId);
        if ((spawn as any).worldViewId !== undefined && (spawn as any).worldViewId >= 0) {
            this.npcEcs.setWorldViewId(ecsId, (spawn as any).worldViewId);
            this.worldViewManager.addNpcToWorldView((spawn as any).worldViewId, ecsId);
        }
        this.npcEcs.setTargetRot(ecsId, spawn.rot | 0);
        this.npcEcs.setRotation(ecsId, spawn.rot | 0);
        this.npcEcs.setOccTile(ecsId, localTileX, localTileY, spawn.level | 0);

        // Actor world coords include size-based center offset (size * 64).
        // For NPCs >1x1, `(tile << 7) + 64` is wrong and will desync client-side path tracking.
        const worldSubX = (worldTileX << 7) + (size << 6);
        const worldSubY = (worldTileY << 7) + (size << 6);
        this.npcMovementSync.applyNpcUpdate(
            {
                serverId,
                ecsIndex: ecsId,
                subX: worldSubX,
                subY: worldSubY,
                level: spawn.level | 0,
                rotation: (spawn.rot | 0) & 2047,
                moved: true,
                snap: true,
                localX,
                localY,
                mapBaseX,
                mapBaseY,
            },
            { forceImmediateRotation: true },
        );

        // Drive map-square NPC geometry from the streamed instances list.
        this.upsertNpcInstanceFromBinary(
            serverId,
            spawn.typeId | 0,
            worldTileX,
            worldTileY,
            spawn.level | 0,
            (spawn as any).worldViewId,
        );
    }

    private applyNpcMovementBinary(
        move: import("./sync/NpcUpdateDecoder").NpcMovement,
        _loopCycle: number,
    ): void {
        const serverId = move.npcId | 0;
        if (serverId <= 0) return;
        const ecsId = this.npcEcs.getEcsIdForServer(serverId);
        if (ecsId === undefined) return;
        const mapId = this.npcEcs.getMapId(ecsId) | 0;
        const mapX = (mapId >> 8) & 0xff;
        const mapY = mapId & 0xff;
        const mapBaseX = (mapX << 13) | 0;
        const mapBaseY = (mapY << 13) | 0;
        const localX = this.npcEcs.getTargetX(ecsId) | 0;
        const localY = this.npcEcs.getTargetY(ecsId) | 0;
        const running = move.traversals?.some?.((t) => (t | 0) === 2) ?? false;

        this.npcMovementSync.applyNpcUpdate(
            {
                serverId,
                ecsIndex: ecsId,
                level: this.npcEcs.getLevel(ecsId) | 0,
                moved: true,
                running,
                directions: move.directions,
                traversals: move.traversals,
                localX,
                localY,
                mapBaseX,
                mapBaseY,
            } as any,
            {},
        );

        // Keep NPC instance map squares in sync when an NPC crosses a 64x64 map-square boundary.
        // The renderer batches NPCs per map-square and samples height from that map's heightmap texture;
        // if we don't migrate instances, NPCs can appear position/height desynced near boundaries.
        try {
            const st = this.npcEcs.getServerState(ecsId);
            if (st) {
                const nextMapX = getMapIndexFromTile(st.tileX | 0);
                const nextMapY = getMapIndexFromTile(st.tileY | 0);
                const nextMapId = getMapSquareId(nextMapX, nextMapY) | 0;
                if ((nextMapId | 0) !== (mapId | 0)) {
                    // Keep ECS map ownership in sync with movement state so map-bucketed systems
                    // (raycast/menu/projectiles/overlays) continue to see this NPC after crossing.
                    this.npcEcs.rebaseToMapSquare(ecsId, nextMapX, nextMapY);
                    const typeId = this.npcEcs.getNpcTypeId(ecsId) | 0;
                    if (typeId > 0) {
                        this.upsertNpcInstanceFromBinary(
                            serverId,
                            typeId,
                            st.tileX | 0,
                            st.tileY | 0,
                            st.plane | 0,
                            this.npcEcs.getWorldViewId(ecsId) | 0,
                        );
                    }
                }
            }
        } catch {}
    }

    private applyNpcBlocksBinary(
        npcId: number,
        block: import("./sync/NpcUpdateDecoder").NpcUpdateBlock,
        loopCycle: number,
    ): void {
        const serverId = npcId | 0;
        if (serverId <= 0) return;
        const ecsId = this.npcEcs.getEcsIdForServer(serverId);

        if (ecsId !== undefined) {
            if (typeof block.faceEntity === "number") {
                this.npcEcs.setInteractionIndex(ecsId, block.faceEntity | 0);
            }
            if (block.seq) {
                const seqId = block.seq.id | 0;
                if (seqId >= 0) {
                    this.npcEcs.handleServerSequence(ecsId, seqId, block.seq.delay | 0);
                } else {
                    this.npcEcs.clearSeq(ecsId);
                }
            }
        }

        if (Array.isArray(block.hitsplats)) {
            for (const hit of block.hitsplats) {
                const payload: any = {
                    targetType: "npc",
                    targetId: serverId,
                    damage: hit.damage | 0,
                    style: hit.type | 0,
                    type2: typeof hit.type2 === "number" ? hit.type2 | 0 : undefined,
                    damage2: typeof hit.damage2 === "number" ? hit.damage2 | 0 : undefined,
                    delayCycles: typeof hit.delayCycles === "number" ? hit.delayCycles | 0 : 0,
                    tick: loopCycle | 0,
                };
                if (this.renderer) this.renderer.registerHitsplat(payload);
                else this.hitsplatFlush.queueHitsplat(payload);
            }
        }

        if (Array.isArray(block.healthBars)) {
            for (const bar of block.healthBars) {
                const entry = { serverId, bar };
                if (this.renderer) {
                    (this.renderer as any).registerNpcHealthBarUpdate?.(entry);
                } else {
                    this.hitsplatFlush.queueNpcHealthBar(entry);
                }
            }
        }

        if (block.say && ecsId !== undefined) {
            this.npcEcs.setOverheadText(ecsId, block.say, 100);
        }

        if (block.colorOverride && ecsId !== undefined) {
            const co = block.colorOverride;
            this.npcEcs.setColorOverride(
                ecsId,
                co.hue | 0,
                co.sat | 0,
                co.lum | 0,
                co.amount | 0,
                co.startCycle | 0,
                co.endCycle | 0,
            );
        }

        if (Array.isArray(block.spotAnims)) {
            for (const spot of block.spotAnims) {
                // spot animation delay is in client cycles (Client.cycle units).
                const delayCycles = Math.max(0, spot.delayCycles | 0);
                const startCycle = getClientCycle() + delayCycles;
                (this.renderer as any)?.registerNpcSpotAnimation?.({
                    npcServerId: serverId,
                    spotId: spot.id | 0,
                    height: spot.height | 0,
                    startCycle,
                    slot: spot.slot | 0,
                });
            }
        }
    }

    private upsertNpcInstanceFromBinary(
        serverId: number,
        typeId: number,
        worldTileX: number,
        worldTileY: number,
        level: number,
        worldViewId?: number,
    ): void {
        const sid = serverId | 0;
        const key = `sid:${sid}`;
        const prev = this.npcInstances.instanceMap.get(key);
        const nextWorldViewId =
            typeof worldViewId === "number"
                ? worldViewId >= 0
                    ? worldViewId | 0
                    : undefined
                : prev?.worldViewId;
        const nextInstance: NpcInstance = {
            serverId: sid,
            typeId: typeId | 0,
            x: worldTileX | 0,
            y: worldTileY | 0,
            level: level | 0,
            ...(nextWorldViewId !== undefined ? { worldViewId: nextWorldViewId } : {}),
        };
        const mapId = this.getNpcInstanceRenderMapId(nextInstance);

        if (prev) {
            const prevMapId = this.getNpcInstanceRenderMapId(prev);
            const appearanceChanged =
                (prev.typeId | 0) !== (nextInstance.typeId | 0) ||
                (prev.level | 0) !== (nextInstance.level | 0) ||
                (prev.worldViewId ?? -1) !== (nextInstance.worldViewId ?? -1);
            if (prevMapId !== mapId) {
                this.npcInstances.markMapPendingReload(prevMapId);
                this.npcInstances.markMapPendingReload(mapId);
            } else if (appearanceChanged) {
                // Position is sampled from ECS every frame, but type/plane and
                // world-view changes alter the baked graphical state.
                this.npcInstances.markMapPendingReload(mapId);
            }
            prev.typeId = nextInstance.typeId;
            prev.x = nextInstance.x;
            prev.y = nextInstance.y;
            prev.level = nextInstance.level;
            prev.serverId = sid;
            prev.worldViewId = nextInstance.worldViewId;
        } else {
            this.npcInstances.instanceMap.set(key, nextInstance);
            this.npcInstances.markMapPendingReload(mapId);
        }
        this.npcInstances.scheduleFlush();
    }

    private despawnNpcBinary(serverId: number): void {
        const sid = serverId | 0;
        if (sid <= 0) return;
        const instanceKey = `sid:${sid}`;
        const existingInstance = this.npcInstances.instanceMap.get(instanceKey);
        // Keep OSRS-style global NPC index array in sync for menuAction packet gates.
        ClientState.npcs[sid] = null;
        try {
            (this.renderer as any)?.clearNpcHealthBars?.(sid);
        } catch {}
        const ecsId = this.npcEcs.getEcsIdForServer(sid);
        if (ecsId !== undefined) {
            this.npcEcs.destroyNpc(ecsId);
        }
        this.npcInstances.instanceMap.delete(instanceKey);
        if (existingInstance) {
            const mapId = this.getNpcInstanceRenderMapId(existingInstance);
            this.npcInstances.markMapPendingReload(mapId);
            this.npcInstances.scheduleFlush();
        }
    }

    notifyRendererReady(): void {
        this.npcInstances.notifyRendererReady();
    }

    handleInventorySlotMove(
        fromSlot: number,
        toSlot: number,
        localPredictionApplied: boolean = false,
        previousSnapshotSignature?: string,
    ): void {
        const src = Math.max(0, Math.min(Inventory.SLOT_COUNT - 1, fromSlot | 0));
        const dst = Math.max(0, Math.min(Inventory.SLOT_COUNT - 1, toSlot | 0));
        if (src === dst) return;

        let before = previousSnapshotSignature;
        if (!localPredictionApplied) {
            const sourceEntry = this.inventory.getSlot(src);
            if (!sourceEntry || sourceEntry.itemId <= 0) return;
            before = this.inventory.snapshotSignature();
            this.inventory.swapSlots(src, dst);
        }

        const predictedSource = this.inventory.getSlot(src);
        const predictedDestination = this.inventory.getSlot(dst);

        try {
            console.log("[inventory] move slot", {
                from: src,
                to: dst,
                predictedSourceItem: predictedSource?.itemId ?? -1,
                predictedDestinationItem: predictedDestination?.itemId ?? -1,
            });
        } catch {}

        // Publish the already-mutated model into the actual WebGL widget state before
        // onDragComplete or clearDragWidgetVisualState can render another frame.
        this.publishInventorySlotPrediction(src, dst);
        const after = this.inventory.snapshotSignature();
        this.pendingInventoryMovePredictions.push({
            before: before ?? after,
            after,
        });
        sendInventoryMove(src, dst);

        // Dispatch through the inventory UI's CS2 state bridge. This client renders its
        // inventory through WidgetNode/WebGL rather than a React inventory component.
        markInvTransmit(93);
    }

    private publishInventorySlotPrediction(...slotIndexes: number[]): void {
        const slots = new Set(
            slotIndexes
                .map((slot) => slot | 0)
                .filter((slot) => slot >= 0 && slot < Inventory.SLOT_COUNT),
        );
        if (slots.size === 0) return;

        const updatedWidgets = new Set<any>();
        const updateWidget = (widget: any, slot: number): void => {
            if (!widget || updatedWidgets.has(widget)) return;
            if (((widget.groupId ?? -1) | 0) !== 149) return;
            if (((widget.childIndex ?? -1) | 0) !== slot) return;
            if (((widget.type ?? -1) | 0) !== 5) return;

            const entry = this.inventory.getSlot(slot);
            const itemId = entry && entry.itemId > 0 ? entry.itemId | 0 : -1;
            const quantity = itemId > 0 ? Math.max(0, entry?.quantity ?? 0) | 0 : 0;
            widget.itemId = itemId;
            widget.itemQuantity = quantity;
            widget.itemAmount = quantity;
            markWidgetInteractionDirty(widget);
            this.widgetManager.invalidateWidgetRender(widget, "inventory-move-prediction");
            updatedWidgets.add(widget);
        };

        for (const parent of this.widgetManager.getWidgetsForGroup(149)) {
            if (!Array.isArray(parent.children)) continue;
            for (const slot of slots) {
                updateWidget(parent.children[slot], slot);
            }
        }
    }

    handleInventorySlotTap(slotIndex: number): void {
        const slot = slotIndex | 0;
        const selected = this.inventory.getSelectedSlot();
        const entry = this.inventory.getSlot(slot);
        if (!entry || entry.itemId <= 0) {
            if (selected !== null) {
                this.inventory.setSelectedSlot(null);
            }
            try {
                console.log("[inventory] tap empty slot", slotIndex);
            } catch {}
            return;
        }
        const primaryAction = this.getPrimaryInventoryAction(entry.itemId);
        const lower = primaryAction?.toLowerCase() ?? "";
        const requiresUseSelection = lower === "use" || lower === "null" || lower === "";

        if (requiresUseSelection) {
            if (selected === null || selected !== slot) {
                this.inventory.setSelectedSlot(slot);
                try {
                    console.log("[inventory] select slot", { slot, item: entry });
                } catch {}
            } else {
                this.useInventoryItem(slot, entry);
            }
            return;
        }

        this.useInventoryItem(slot, entry, lower);
    }

    useInventoryItem(slotIndex: number, entry?: InventorySlot, actionHint?: string): void {
        const slot = slotIndex | 0;
        const data = entry ?? this.inventory.getSlot(slot);
        if (!data || data.itemId <= 0) return;

        try {
            console.log("[inventory] use item", { slot, item: data, actionHint });
        } catch {}

        const quantity = data.quantity > 0 ? data.quantity : 1;
        sendInventoryUse(slot, data.itemId, quantity, actionHint);
        this.inventory.setSelectedSlot(null);
    }

    private getPrimaryInventoryAction(itemId: number): string | undefined {
        if (!(itemId > 0)) return undefined;
        try {
            const obj = this.objTypeLoader?.load?.(itemId);
            const actions: Array<string | null | undefined> = Array.isArray(obj?.inventoryActions)
                ? obj.inventoryActions
                : [];
            for (const act of actions) {
                if (typeof act === "string" && act.trim().length > 0) return act.trim();
            }
        } catch (err) {
            console.warn("[inventory] failed to resolve primary action", itemId, err);
        }
        return undefined;
    }

    setRenderer(renderer: GameRenderer): void {
        this.renderer = renderer;
        this.applyDisplayDefaults();
        this.renderer.initCache();
        this.hitsplatFlush.flushAll();
        this.resetMenu();
    }

    /**
     * Sets the camera position to a new arbitrary position
     * @param newView Any of the items you want to move: Position, pitch, yaw
     */
    setCamera(newView: Partial<CameraView>): void {
        if (newView.position) {
            vec3.copy(this.camera.pos, newView.position);
        }
        if (newView.pitch !== undefined) {
            // Clamp to [−512, 0] RS units (≈ [−90°, 0°])
            this.camera.pitch = clamp(newView.pitch, -512, 0);
        }
        if (newView.yaw !== undefined) {
            this.camera.yaw = newView.yaw;
        }
        if (newView.orthoZoom !== undefined) {
            this.camera.orthoZoom = newView.orthoZoom;
        }
        this.camera.updated = true;
    }

    // URL/search params are not supported

    closeMenu = () => {
        this.menuOpen = false;
        this.menuX = -1;
        this.menuY = -1;
        this.menuPinnedEntries = undefined;
        this.menuPinnedEntriesVersion++;
        this.menuFrozenSimpleEntries = undefined;
        this.menuFrozenSimpleEntriesVersion = 0;
        this.menuActiveSimpleEntries = [];
        this.menuState.reset();
        this.renderer.canvas.focus();
        this.widgetManager?.invalidateAll?.();
    };

    resetMenu = () => {
        this.closeMenu();
        this.menuOpenedFrame = 0;
    };

    updateVars(): void {
        this.workerPool.setVars(this.varManager.values);
    }

    private getMinimapImageKey(mapX: number, mapY: number, level: number = 0): number {
        return getMapPlaneId(mapX | 0, mapY | 0, level | 0);
    }

    private getMinimapImageUrlLimit(): number {
        return isTouchDevice ? OsrsClient.MAX_MINIMAP_URLS_MOBILE : OsrsClient.MAX_MINIMAP_URLS;
    }

    getWorldMapImageTile(
        mapX: number,
        mapY: number,
        level: number = 0,
        accessPriority: number = 0,
    ): { key: string; pixels?: Uint8Array; width: number; height: number } | undefined {
        return this.worldMap.getWorldMapImageTile(mapX, mapY, level, accessPriority);
    }

    getWorldMapImageSource(
        mapX: number,
        mapY: number,
        level: number = 0,
        accessPriority: number = 0,
    ): { key: string; pixels?: Uint8Array; width: number; height: number } | undefined {
        return this.worldMap.getWorldMapImageSource(mapX, mapY, level, accessPriority);
    }

    markWorldMapImageTextureUploaded(key: string): void {
        this.worldMap.markWorldMapImageTextureUploaded(key);
    }

    getWorldMapIcons(mapX: number, mapY: number, level: number = 0): MinimapIcon[] | undefined {
        return this.worldMap.getWorldMapIcons(mapX, mapY, level);
    }

    retainWorldMapImageTiles(
        tiles: Array<{
            mapX: number;
            mapY: number;
            level?: number;
            sourceTile?: { mapX: number; mapY: number; level?: number };
        }>,
    ): void {
        this.worldMap.retainWorldMapImageTiles(tiles);
    }

    clearWorldMapImages(): void {
        this.worldMap.clearWorldMapImages();
    }

    /**
     * Process a WORLDENTITY_INFO packet — per-tick world entity lifecycle update.
     *
     * Matches OSRS WorldEntityUpdateParser:
     *  1. Truncation: entities beyond oldCount in the previous active list are despawned.
     *  2. Per-entity update: 0=despawn, 1=no change, 2=queuePosition, 3=setPosition.
     *  3. Mask updates (animation, action mask) applied per entity.
     *  4. New spawns appended (scene data already loaded via REBUILD_WORLDENTITY).
     */
    private handleWorldEntityInfo(payload: WorldEntityInfoPayload): void {
        const prev = this.activeWorldEntityIds;
        const { oldCount, oldUpdates, newSpawns } = payload;

        // Phase 1: Truncation — despawn entities beyond oldCount
        for (let i = oldCount; i < prev.length; i++) {
            this.despawnWorldEntity(prev[i]);
        }

        // Phase 2: Process updates for surviving old entities
        const next: number[] = [];
        for (let i = 0; i < oldCount; i++) {
            const entityId = prev[i];
            const upd = oldUpdates[i];
            if (upd.updateType === 0) {
                this.despawnWorldEntity(entityId);
                continue;
            }

            next.push(entityId);

            const entity = this.worldViewManager.getWorldEntity(entityId);
            if (entity && upd.updateType >= 2 && upd.positionDelta) {
                const target =
                    entity.pendingPathStepCount === 0
                        ? entity.position
                        : entity.pathSteps[0].position;
                const newPos = {
                    x: target.x + upd.positionDelta.x,
                    y: target.y + upd.positionDelta.y,
                    z: target.z + upd.positionDelta.z,
                    orientation: (target.orientation + upd.positionDelta.orientation) & 2047,
                };
                if (upd.updateType === 2) {
                    entity.queuePosition(newPos);
                } else {
                    entity.setPosition(newPos);
                }
            }

            if (entity && upd.mask) {
                this.applyWorldEntityMask(entityId, entity, upd.mask);
            }
        }

        // Phase 3: Register new spawns (scene data already loaded via REBUILD_WORLDENTITY)
        for (const spawn of newSpawns) {
            next.push(spawn.entityIndex);

            const entity = this.worldViewManager.getWorldEntity(spawn.entityIndex);
            if (entity) {
                entity.drawMode = spawn.drawMode;
                if (spawn.position) {
                    entity.queuePosition(spawn.position);
                }
                if (spawn.mask) {
                    this.applyWorldEntityMask(spawn.entityIndex, entity, spawn.mask);
                }
            }
        }

        this.activeWorldEntityIds = next;
    }

    private applyWorldEntityMask(
        entityIndex: number,
        entity: import("./worldview/WorldEntity").WorldEntity,
        mask: import("../network/ServerConnection").WorldEntityMaskPayload,
    ): void {
        if (mask.actionMask !== undefined) {
            entity.actionMask = mask.actionMask;
        }
        if (mask.animationId !== undefined) {
            const animId = mask.animationId === 0xffff ? -1 : mask.animationId;
            entity.sequenceAnimationId = animId;
            entity.sequenceFrame = mask.sequenceFrame ?? 0;

            const animator = (this.renderer as any)?.worldEntityAnimator;
            if (animator && typeof animator.setSequenceAnimation === "function") {
                animator.setSequenceAnimation(
                    entityIndex,
                    animId,
                    entity.configId,
                    getClientCycle(),
                );
            }
        }
    }

    private despawnWorldEntity(entityIndex: number): void {
        console.log(`[OsrsClient] Despawning world entity ${entityIndex}`);
        if (this.renderer && "clearWorldEntity" in this.renderer) {
            (this.renderer as any).clearWorldEntity(entityIndex);
        }
        if (this.controlledPlayerServerId >= 0) {
            const localEcsIdx = this.playerEcs.getIndexForServerId(this.controlledPlayerServerId);
            if (localEcsIdx !== undefined) {
                this.playerEcs.setWorldViewId(localEcsIdx, -1);
                this.worldViewManager.removePlayerFromWorldView(entityIndex, localEcsIdx);
            }
        }
    }

    /**
     * Reset all world/game state - used on disconnect/logout to prevent memory leaks.
     * Clears all players, NPCs, widgets, ground items, and other game entities.
     * @param fullReset If true, also clears chat history, vars, and transmit cycles (for full logout to login screen)
     */
    resetWorld(fullReset: boolean = false): void {
        this.mobileChatKeyboard?.hide();
        console.log(`[OsrsClient] Resetting world state (fullReset=${fullReset})...`);

        // Clear all players
        try {
            this.playerEcs?.reset?.();
        } catch (err) {
            console.warn("[OsrsClient] PlayerEcs reset error:", err);
        }

        // Clear all NPCs
        try {
            this.npcEcs?.reset?.();
        } catch (err) {
            console.warn("[OsrsClient] NpcEcs reset error:", err);
        }
        try {
            this.npcUpdateDecoder?.reset?.();
        } catch (err) {
            console.warn("[OsrsClient] NpcUpdateDecoder reset error:", err);
        }
        this.lastNpcDecodeBase = undefined;
        this.npcInstances.clearLocal();

        // Clear widgets
        try {
            this.widgetManager?.clear?.();
        } catch (err) {
            console.warn("[OsrsClient] WidgetManager clear error:", err);
        }

        // Clear ground items
        try {
            this.groundItems?.clear?.();
        } catch (err) {
            console.warn("[OsrsClient] GroundItemStore clear error:", err);
        }

        // Clear animation controller state
        try {
            this.playerAnimController?.reset?.();
        } catch (err) {
            console.warn("[OsrsClient] PlayerAnimController reset error:", err);
        }

        // Clear map data
        this.activeWorldEntityIds = [];
        try {
            (this.renderer as any)?.clearAllWorldEntities?.();
        } catch (err) {
            console.warn("[OsrsClient] Renderer clearAllWorldEntities error:", err);
        }

        try {
            this.renderer?.clearMaps();
        } catch (err) {
            console.warn("[OsrsClient] Renderer clearMaps error:", err);
        }

        // Clear projectiles
        try {
            (this.renderer as any)?.projectileManager?.clear?.();
        } catch (err) {
            console.warn("[OsrsClient] ProjectileManager clear error:", err);
        }

        // Clear GFX/spot animations
        try {
            (this.renderer as any)?.gfxManager?.clear?.();
        } catch (err) {
            console.warn("[OsrsClient] GfxManager clear error:", err);
        }

        // Reset controlled player ID
        this.controlledPlayerServerId = -1;
        this.lastPlayerSyncLocalIndex = -1;
        this.localPlayerIsAdmin = false;

        // Clear menus
        try {
            this.menuState?.reset?.();
        } catch {}

        // Clear ClientState (selected spell/item, base coords, etc.)
        try {
            ClientState.reset();
        } catch (err) {
            console.warn("[OsrsClient] ClientState reset error:", err);
        }

        // Stop all audio playback (but don't dispose - will reuse for login music)
        try {
            this.musicSystem?.stop?.();
        } catch (err) {
            console.warn("[OsrsClient] MusicSystem stop error:", err);
        }

        // Stop all ambient sounds
        try {
            this.soundEffectSystem?.stopAllAmbientSounds?.();
        } catch (err) {
            console.warn("[OsrsClient] SoundEffectSystem stopAllAmbientSounds error:", err);
        }

        // Clear renderer caches to prevent memory leaks
        try {
            this.renderer?.clearSessionCaches?.();
        } catch (err) {
            console.warn("[OsrsClient] Renderer clearSessionCaches error:", err);
        }

        // Full reset only - clear persistent session state when going back to login screen
        if (fullReset) {
            // Clear chat history to prevent memory leak across sessions
            try {
                chatHistory.clear();
            } catch (err) {
                console.warn("[OsrsClient] ChatHistory clear error:", err);
            }

            // Clear transient varcs while keeping persistent client preferences loaded.
            // Camera zoom bounds are reseeded by the login root bootstrap script.
            try {
                this.varManager?.clearTransientVarcs?.();
            } catch (err) {
                console.warn("[OsrsClient] VarManager clear error:", err);
            }

            // Reset transmit cycles (var/stat/inv change tracking)
            try {
                resetTransmitCycles();
                // Update instance reference to point to the new global singleton
                this.transmitCycles = getTransmitCycles();
            } catch (err) {
                console.warn("[OsrsClient] resetTransmitCycles error:", err);
            }
        }

        console.log("[OsrsClient] World state reset complete");
    }

    /**
     * Dispose of all resources held by the client.
     * Call this on HMR/fast refresh to prevent audio leaks.
     */
    dispose(): void {
        console.log("[OsrsClient] Disposing...");
        const subscriptions = [
            ...this.serverSubscriptions.splice(0),
            this.unsubscribeWidgetEvents,
            this.unsubscribeNpcInfo,
            this.unsubscribeCombat,
            this.unsubscribePlayerSync,
            this.unsubscribeSpot,
            this.unsubscribeSound,
            this.unsubscribePlaySong,
            this.unsubscribePlayJingle,
            this.unsubscribeSpellResults,
            this.unsubscribePathDebug,
            this.unsubscribeGroundItems,
            this.unsubscribeChatMessages,
            this.unsubscribeFriendsChat,
            this.unsubscribeSkills,
            this.unsubscribeRunEnergy,
            this.unsubscribeNotifications,
        ];
        for (const unsubscribe of subscriptions) {
            try {
                unsubscribe?.();
            } catch {}
        }
        this.cancelPendingLoginMusicStart();
        this.varcPersistence.dispose();
        if (this.js5SweepTimer !== undefined) {
            clearInterval(this.js5SweepTimer);
            this.js5SweepTimer = undefined;
        }
        // Persist fetches from the last sweep window before tearing down.
        if (this.js5 && this.loadedCache) {
            const persistence = getSparsePersistence(this.loadedCache);
            if (persistence) {
                persistence.sweep(this.js5.store.presence);
                persistence.flush();
            }
        }
        this.js5 = undefined;

        // Reset world state first (full reset on dispose)
        this.resetWorld(true);
        try {
            this.varManager?.clear?.();
        } catch {}

        // Dispose audio systems (stops playback, closes AudioContext, removes listeners)
        if (this.musicSystem) {
            this.musicSystem.dispose();
            this.musicSystem = undefined;
        }
        if (this.soundEffectSystem) {
            this.soundEffectSystem.dispose();
            this.soundEffectSystem = undefined;
        }

        this.clearMinimapImageUrls();
        this.clearWorldMapImages();

        console.log("[OsrsClient] Disposed");
    }
}
