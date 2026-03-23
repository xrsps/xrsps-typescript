import { vec3 } from "gl-matrix";

import {
    type BankServerUpdate,
    getClientCycle,
    getCurrentTick,
    getServerTickPhaseNow,
    isServerConnected,
    sendFaceTile,
    sendGroundItemAction,
    sendIfTriggerOpLocal,
    sendInventoryMove,
    sendInventoryUse,
    sendInventoryUseOn,
    sendNpcInteract,
    sendPlayerDesignConfirm,
    sendVarpTransmit,
    sendWidgetAction,
    sendWidgetClose,
    sendWidgetDrag,
    setClientCycleProvider,
    subscribeAnim,
    subscribeBank,
    subscribeChatMessages,
    subscribeCollectionLog,
    subscribeCombat,
    subscribeDisconnect,
    subscribeGroundItems,
    subscribeHandshake,
    subscribeHitsplats,
    subscribeInventory,
    subscribeNotifications,
    subscribeNpcInfo,
    subscribePlayJingle,
    subscribePlaySong,
    subscribePlayerSync,
    subscribeReconnectFailed,
    subscribeRunEnergy,
    subscribeServerPath,
    subscribeShop,
    subscribeSkills,
    subscribeSound,
    subscribeSpellResults,
    subscribeSpot,
    subscribeTick,
    subscribeWelcome,
    subscribeWidgetEvents,
} from "../network/ServerConnection";
import type {
    CollectionLogServerPayload,
    HitsplatServerPayload,
    InventoryServerUpdate,
    NpcInfoPayload,
    ShopWindowState,
    SpellResultPayload,
    SpotAnimationPayload,
    WidgetActionClientPayload,
} from "../network/ServerConnection";
import {
    sendEmote as netSendEmote,
    sendBankCustomQuantity,
    sendLogin,
    sendLogout,
    sendResumeNameDialog,
    sendResumeStringDialog,
    subscribeLogoutResponse,
    suppressReconnection,
} from "../network/ServerConnection";
import { registerAnimDebugProvider, subscribeProjectiles } from "../network/ServerConnection";
import { ClientPacketId, createPacket, queuePacket } from "../network/packet";
import { MenuTargetType, type OsrsMenuEntry } from "../rs/MenuEntry";
import { SoundEffectLoader } from "../rs/audio/SoundEffectLoader";
import { CacheSystem } from "../rs/cache/CacheSystem";
import { IndexType } from "../rs/cache/IndexType";
import { CacheLoaderFactory, getCacheLoaderFactory } from "../rs/cache/loader/CacheLoaderFactory";
import { getPlayerTypeInfo } from "../rs/chat/PlayerType";
import { BasTypeLoader } from "../rs/config/bastype/BasTypeLoader";
import { DbRepository } from "../rs/config/db/DbRepository";
import { IdkTypeLoader } from "../rs/config/idktype/IdkTypeLoader";
import { LocTypeLoader } from "../rs/config/loctype/LocTypeLoader";
import { NpcTypeLoader } from "../rs/config/npctype/NpcTypeLoader";
import { ObjModelLoader } from "../rs/config/objtype/ObjModelLoader";
import { ObjTypeLoader } from "../rs/config/objtype/ObjTypeLoader";
import { EquipToDisplaySlot, EquipmentSlot } from "../rs/config/player/Equipment";
import { PlayerAppearance } from "../rs/config/player/PlayerAppearance";
import { PLAYER_BODY_RECOLOR_TO_1 } from "../rs/config/player/PlayerDesignColors";
import type { SeqSoundEffect, SeqType } from "../rs/config/seqtype/SeqType";
import { SeqTypeLoader } from "../rs/config/seqtype/SeqTypeLoader";
import { SpotAnimTypeLoader } from "../rs/config/spotanimtype/SpotAnimTypeLoader";
import { VarManager } from "../rs/config/vartype/VarManager";
import { chatHistory } from "../rs/cs2/ChatHistory";
import { Cs2Vm, ScriptArgMagic, type ScriptEvent, createScriptEvent } from "../rs/cs2/Cs2Vm";
import { type Script as Cs2Script, parseScriptFromBytes } from "../rs/cs2/Script";
import { BitmapFont } from "../rs/font/BitmapFont";
import { encodeInteractionIndex } from "../rs/interaction/InteractionIndex";
import { Inventory, InventorySlotInput } from "../rs/inventory/Inventory";
import type { InventorySlot } from "../rs/inventory/Inventory";
import { MapFileIndex, getMapIndexFromTile, getMapSquareId } from "../rs/map/MapFileIndex";
import { SeqFrameLoader } from "../rs/model/seq/SeqFrameLoader";
import type { SkeletalSeqLoader } from "../rs/model/skeletal/SkeletalSeqLoader";
import {
    PRAYER_NAME_SET,
    PRAYER_NAME_TO_VARBIT,
    PrayerName,
    PrayerVarbits,
    prayerSetToBitmask,
} from "../rs/prayer/prayers";
import { SkillId } from "../rs/skill/skills";
import { SpriteLoader } from "../rs/sprite/SpriteLoader";
import { TextureLoader } from "../rs/texture/TextureLoader";
import { faceAngleRs } from "../rs/utils/rotation";
import { directionToDelta } from "../shared/Direction";
import {
    CacheItemSearchIndex,
    type CacheItemSearchEntry,
} from "../shared/items/CacheItemSearchIndex";
import type { ProjectileLaunch } from "../shared/projectiles/ProjectileLaunch";
import { buildSelectedSpellPayload } from "../shared/spells/selectedSpellPayload";
import {
    INTERFACE_ACHIEVEMENT_DIARY_ID,
    INTERFACE_QUEST_LIST_ID,
    SIDE_JOURNAL_GROUP_ID,
} from "../shared/ui/sideJournal";
import {
    ITEM_SPAWNER_MODAL_COMPONENT_HELPER,
    ITEM_SPAWNER_MODAL_COMPONENT_QUERY,
    ITEM_SPAWNER_MODAL_COMPONENT_RESULTS_SCROLLBAR,
    ITEM_SPAWNER_MODAL_COMPONENT_RESULTS_VIEW,
    ITEM_SPAWNER_MODAL_COMPONENT_SEARCH_BACKGROUND,
    ITEM_SPAWNER_MODAL_COMPONENT_SLOT_BACKGROUND_START,
    ITEM_SPAWNER_MODAL_COMPONENT_SLOT_ICON_START,
    ITEM_SPAWNER_MODAL_COMPONENT_SUMMARY,
    ITEM_SPAWNER_MODAL_GROUP_ID,
    ITEM_SPAWNER_MODAL_RESULT_SLOT_COUNT,
    ITEM_SPAWNER_MODAL_SLOT_COLUMNS,
} from "../shared/ui/widgets";
import { markWidgetInteractionDirty } from "../ui/widgets/WidgetInteraction";
import {
    TRANSMIT_VARPS,
    VARBIT_COMBATLEVEL_TRANSMIT,
    VARBIT_LEAGUE_AREA_SELECTION_0,
    VARBIT_LEAGUE_AREA_SELECTION_1,
    VARBIT_LEAGUE_AREA_SELECTION_2,
    VARBIT_LEAGUE_AREA_SELECTION_3,
    VARBIT_LEAGUE_AREA_SELECTION_4,
    VARBIT_LEAGUE_AREA_SELECTION_5,
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
    VARBIT_LEAGUE_TUTORIAL_COMPLETED,
    VARBIT_LEAGUE_TYPE,
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
} from "../shared/vars";
import { ClickRegistry } from "../ui/gl/click-registry";
import { cleanupInterfaceClickTargets } from "../ui/gl/widgets-gl";
import { setNpcExamineIdResolver, setSpellSelectionClearHandler } from "../ui/menu/MenuAction";
import {
    type DefaultChoiceState,
    type SimpleMenuEntry,
    chooseDefaultMenuEntry,
    getShiftClickActionIndex,
} from "../ui/menu/MenuEngine";
import { MenuState } from "../ui/menu/MenuState";
import {
    getDragDepth,
    isDropTarget,
    isWidgetUseTarget,
    shouldTransmitAction,
} from "../ui/widgets/WidgetFlags";
import { WidgetManager } from "../ui/widgets/WidgetManager";
import { WidgetSessionManager } from "../ui/widgets/WidgetSessionManager";
import { layoutWidgets } from "../ui/widgets/layout/WidgetLayout";
import {
    collectWidgetsAtPointAcrossRoots,
    collectWidgetsWithKeyHandlers,
    deriveMenuEntriesForWidget,
    findBlockingWidgetInHits,
    findDropTarget,
    getVisibleWidgetSurfaceReason,
    getWidgetTargetLabel,
    getWidgetTargetLabelForMenu,
    isPauseButtonWidget as isPauseButtonWidgetUtil,
    sanitizeText,
} from "../ui/widgets/menu/utils";
import { isMobileMode, isTouchDevice } from "../util/DeviceUtil";
import { clamp } from "../util/MathUtil";
import {
    getBrowserVarcsStorageKey,
    loadBrowserVarcs,
    saveBrowserVarcs,
} from "./BrowserVarcsPersistence";
import { CacheList, LoadedCache } from "./Caches";
import { Camera, CameraView, ProjectionType } from "./Camera";
import {
    ClientState,
    DEFAULT_SCREEN_HEIGHT,
    DEFAULT_SCREEN_WIDTH,
    MOUSE_CROSS_YELLOW,
} from "./ClientState";
import { GameRenderer } from "./GameRenderer";
import { OsrsRendererType, createRenderer } from "./GameRenderers";
import { ClickMode, InputManager } from "./InputManager";
import { MapManager } from "./MapManager";
import { PlayerAnimController } from "./PlayerAnimController";
import {
    type TransmitCycles,
    getTransmitCycles,
    isTransmitProcessingNeeded,
    markChatTransmit,
    markInvTransmit,
    markMiscTransmit,
    markStatTransmit,
    markVarTransmit,
    markWidgetsLoaded,
    resetTransmitCycles,
    resetTransmitDirtyFlags,
} from "./TransmitCycles";
import { MusicSystem } from "./audio/MusicSystem";
import { type SequenceSoundContext, SoundEffectSystem } from "./audio/SoundEffectSystem";
import {
    ClientGroundItemStack,
    GroundItemOverlayEntry,
    GroundItemStore,
} from "./data/ground/GroundItemStore";
import { ObjSpawn } from "./data/obj/ObjSpawn";
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
import { createBrowserGroundItemsPluginPersistence } from "./plugins/grounditems/BrowserGroundItemsPluginPersistence";
import { GroundItemsPlugin } from "./plugins/grounditems/GroundItemsPlugin";
import { createBrowserInteractHighlightPluginPersistence } from "./plugins/interacthighlight/BrowserInteractHighlightPluginPersistence";
import { InteractHighlightPlugin } from "./plugins/interacthighlight/InteractHighlightPlugin";
import { createBrowserNotesPluginPersistence } from "./plugins/notes/BrowserNotesPluginPersistence";
import { NotesPlugin } from "./plugins/notes/NotesPlugin";
import { createBrowserTileMarkersPluginPersistence } from "./plugins/tilemarkers/BrowserTileMarkersPluginPersistence";
import { TileMarkersPlugin } from "./plugins/tilemarkers/TileMarkersPlugin";
import { ResolveTilePlaneFn, clampPlane } from "./roof/RoofVisibility";
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
import { WebGLMapSquare } from "./webgl/WebGLMapSquare";
import type { NpcInstance } from "./webgl/npc/NpcRenderTemplate";
import { RenderDataWorkerPool } from "./worker/RenderDataWorkerPool";

/** Spell info for setSelectedSpell (uses ClientState as single source of truth) */
interface SelectedSpellInfo {
    spellId: number;
    spellName: string;
    spellLevel?: number;
    runes?: Array<{ itemId: number; quantity: number; name?: string }>;
    /** Widget that initiated targeting mode (for onTargetEnter/Leave events) */
    sourceWidget?: any;
}

const CHATBOX_MODAL_TARGET_UID = (162 << 16) | 567;
const CHATBOX_DIALOG_GROUP_IDS = new Set([231, 217, 193, 11]);

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

const MAP_IMAGE_BASE_PATH = "/map-images";
const VARBIT_ACCOUNT_TYPE = 1777;
const VARBIT_POPOUT_OPEN = 13090;
const VARBIT_POPOUT_PANEL_DESKTOP_DISABLED = 13982;
const ACCOUNT_TYPE_MAIN = 0;

// League areas/tutorial cache constants (group 512, scripts 8478/8484).
const LEAGUE_AREAS_GROUP_ID = 512;
const LEAGUE_AREAS_KARAMJA_REGION_ID = 2;
const LEAGUE_AREAS_CHILD_KARAMJA_SHIELD = 46;
const LEAGUE_AREAS_CHILD_CANCEL_BUTTON = 60;
const LEAGUE_AREAS_CHILD_CONFIRM_BUTTON = 61;
const LEAGUE_AREAS_CHILD_SELECT_BUTTON = 82;
const LEAGUE_AREAS_CHILD_SELECT_BACK = 83;

const SCRIPT_UI_HIGHLIGHT = 8478;
const SCRIPT_UI_HIGHLIGHT_CLEAR = 8484;
const UI_HIGHLIGHT_KIND_LEAGUE_TUTORIAL = 10;
const UI_HIGHLIGHT_STYLE_DEFAULT = 7034;
const UI_HIGHLIGHT_ID_KARAMJA_SHIELD = 2;
const UI_HIGHLIGHT_ID_UNLOCK_BUTTON = 3;
const ITEM_SPAWNER_SCROLLBAR_INIT_SCRIPT_ID = 31;
const ITEM_SPAWNER_SCROLLBAR_RESIZE_SCRIPT_ID = 72;
const ITEM_SPAWNER_SLOT_PITCH_Y = 44;
const ITEM_SPAWNER_SLOT_BACKGROUND_BASE_RAW_Y = 0;
const ITEM_SPAWNER_SLOT_ICON_BASE_RAW_Y = 2;
const ITEM_SPAWNER_SCROLLBAR_GRAPHICS = [
    "scrollbar_dragger_v2,3",
    "scrollbar_dragger_v2,0",
    "scrollbar_dragger_v2,1",
    "scrollbar_dragger_v2,2",
    "scrollbar_v2,0",
    "scrollbar_v2,1",
] as const;

// Use shared OSRS rotation scale

export class OsrsClient {
    private static readonly SCRIPT_CACHE_CAPACITY = 128;
    private static readonly CLIENT_TICK_MS = 20;
    // Maximum amount of client-tick backlog (in ms) we will attempt to simulate.
    // This avoids multi-second/minute "catch-up" after sleep/throttling while still allowing
    // the client tick loop to keep NPC/player step queues drained during normal background
    // timer clamping (commonly ~1000ms intervals).
    private static readonly MAX_CLIENT_TICK_BACKLOG_MS = 2000;
    // Keep a conservative upper bound per slice to avoid long main-thread stalls if the tab is
    // throttled/suspended and then resumes with a large tick debt.
    // OSRS parity/perf: cap catch-up to avoid huge tick bursts after background-tab timer throttling.
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
    private readonly cs2ScriptCache: Map<number, Cs2Script> = new Map();

    private readonly resolvePlayerPlane: ResolveTilePlaneFn = (_tileX, _tileY, plane) =>
        clampPlane(plane);

    // Cache (optional until initCache is called)
    loadedCache?: LoadedCache;
    cacheSystem!: CacheSystem;
    loaderFactory!: CacheLoaderFactory;
    widgetManager!: WidgetManager;
    widgetSessionManager!: WidgetSessionManager;

    textureLoader!: TextureLoader;
    seqTypeLoader!: SeqTypeLoader;
    seqFrameLoader!: SeqFrameLoader;
    skeletalSeqLoader?: SkeletalSeqLoader;
    spotAnimTypeLoader!: SpotAnimTypeLoader;

    locTypeLoader!: LocTypeLoader;
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

    basTypeLoader!: BasTypeLoader;
    idkTypeLoader!: IdkTypeLoader;

    varManager!: VarManager;
    private varcsStorageKey?: string;
    private varcsUnwrittenChanges: boolean = false;
    private varcsLastWriteTimeMs: number = 0;
    private readonly handleVarcsPageLifecycleFlush = (): void => {
        this.writeVarcs();
    };

    // OSRS PARITY: Transmit cycles for engine-level event gating
    // See TransmitCycles.ts for documentation on how OSRS gates transmit handlers
    // IMPORTANT: Use getTransmitCycles() to get the global singleton, not createTransmitCycles()!
    // This ensures CLIENTCLOCK opcode and OsrsClient use the same cycleCntr.
    transmitCycles: TransmitCycles = getTransmitCycles();

    // Local player name (from server handshake)
    localPlayerName: string = "";
    private localChatNameIcons: number[] = [];
    private localChatNamePrefix: string = "";
    private modIconsWidthLoaded: boolean = false;
    private modIconWidthById: Map<number, number> = new Map();
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
     * OSRS uses an integer range of 2..8 (default 4).
     */
    minimapZoom: number = 4;
    /**
     * Runtime flag controlled by CS2 (SETSHOWMOUSEOVERTEXT) to toggle mouseover text display.
     * Default true per OSRS reference (Client.java:1574).
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

    // Callbacks for React UI components
    onOpenWorldMap?: () => void;
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

    dragSourceWidget: any = null;

    // OSRS parity: track hover state per-widget (Widget.field3722).
    // Multiple widgets (parents + children) can be hovered at once and must receive onMouseRepeat.
    private hoveredWidgetUids: Set<number> = new Set();
    private hoveredWidgetsByUid: Map<number, any> = new Map();

    // Track clicked widget for onClick/onClickRepeat/onRelease events
    private clickedWidget: any = null;
    // OSRS parity: parent widget used as drag clamp/coordinate space (Client.clickedWidgetParent)
    private clickedWidgetParent: any = null;
    private clickedWidgetX: number = 0; // Mouse position relative to clicked widget
    private clickedWidgetY: number = 0;
    // Track if game loop already fired CS2 handlers for current click (prevents double-invocation)
    private clickedWidgetHandled: boolean = false;

    // OSRS drag fidelity state
    private widgetDragDuration: number = 0;
    private isDraggingWidget: boolean = false;
    private dragClickX: number = 0; // Absolute screen X of original click
    private dragClickY: number = 0; // Absolute screen Y of original click
    private draggedOnWidget: any = null; // Widget under cursor that can receive drag (OSRS: Client.draggedOnWidget)
    private if1ScrollbarDragging: boolean = false;
    private if1AlternativeScrollbarWidth: number = 0;

    // PERF: Cache drag hit test - only recompute when mouse moves
    private _lastDragHitX: number = -1;
    private _lastDragHitY: number = -1;

    // PERF: Cache hover hit test - only recompute when mouse moves
    private _lastHoverHitX: number = -1;
    private _lastHoverHitY: number = -1;
    private _cachedHoverHits: any[] | null = null;
    // OSRS parity: hover listeners are dispatched once per client cycle (Client.field830 loop).
    private _lastHoverListenerCycle: number = -1;

    // OSRS parity: Deferred widget action for draggable items
    // Action is queued on mousedown and fired on mouseup if no drag occurred
    private deferredWidgetAction: any = null;

    // OSRS parity: Pending widget action for input dialogs (Withdraw-X, Deposit-X, etc.)
    // When a CS2 script opens an input dialog, the widget action is deferred until dialog completion
    private pendingInputDialogAction: {
        payload: any;
        option: string;
    } | null = null;
    private itemSpawnerSearchFocused: boolean = false;
    private itemSpawnerSearchQuery: string = "";
    private itemSpawnerSearchIndex?: CacheItemSearchIndex;
    private itemSpawnerSearchResults: CacheItemSearchEntry[] = [];
    private itemSpawnerSearchResultsVersion: number = 0;
    private itemSpawnerRenderedResultsVersion: number = -1;
    private itemSpawnerVisibleStartRow: number = -1;

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
    private npcInstanceMap: Map<string, NpcInstance> = new Map();
    private npcInstanceMapsPendingReload: Set<number> = new Set();
    private npcInstanceFlushScheduled: boolean = false;
    private npcInstanceFlushFallbackTimer?: ReturnType<typeof setTimeout>;
    private npcInstanceFlushFallbackAttempt: number = 0;

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
    combatStyleSlot: number = 0;
    combatSpellId: number = -1;
    activePrayers: Set<PrayerName> = new Set();
    quickPrayers: Set<PrayerName> = new Set();
    quickPrayersEnabled: boolean = false;

    // Track last server-provided local appearance to avoid redundant rebuilds
    private _lastLocalAppearanceKey?: string;
    // PlayerDesign (679) is client-side; keep a local editable appearance even before a world player exists.
    private playerDesignAppearance?: PlayerAppearance;

    inventory: Inventory = new Inventory();
    equipment: Inventory = new Inventory(14); // Equipment has 14 slots
    /** Bank container inventory (ID 95) - indexed 0..1409 for CS2 bankmain_build */
    bankInventory: Inventory = new Inventory(1410);
    /** Collection log inventory (ID 620) - stores obtained items for CS2 inv_total queries */
    collectionInventory: Inventory = new Inventory(2048);
    /** Shop stock inventory (ID 516) - stores shop items for CS2 inv queries */
    shopInventory: Inventory = new Inventory(40);
    private inventorySeededFromServer: boolean = false;

    // Track last layout dimensions to avoid re-running layout every frame
    private _lastLayoutWidth: number = 0;
    private _lastLayoutHeight: number = 0;
    private _lastLayoutRootInterface: number = -1;

    // Cap how many object URLs we retain in-memory to prevent growth over time.
    // World map tiles can add up quickly; keep a practical upper bound.
    static readonly MAX_MAP_URLS = 512;
    static readonly MAX_MINIMAP_URLS = 128;
    static readonly MAX_PENDING_MAP_IMAGE_LOADS = 64;
    static readonly MAX_MAP_URLS_MOBILE = 128;
    static readonly MAX_MINIMAP_URLS_MOBILE = 64;
    static readonly MAX_PENDING_MAP_IMAGE_LOADS_MOBILE = 16;

    mapImageUrls: Map<number, string> = new Map();
    minimapImageUrls: Map<number, string> = new Map();
    private mapImageAccess: Map<number, number> = new Map();
    private minimapImageAccess: Map<number, number> = new Map();
    loadingMapImageIds: Set<number> = new Set();
    private failedMapImageIds: Set<number> = new Set();

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
    // Roof removal toggle: when true, enable OSRS-style roof removal logic.
    removeRoofsAll: boolean = true;
    // When true, force roofs hidden everywhere (toggleroof equivalent).
    roofsAlwaysHidden: boolean = false;
    // Removed custom pitch intensity to mirror vanilla OSRS camera distance mapping.

    private unsubscribeWidgetEvents?: () => void;
    private unsubscribeHitsplats?: () => void;
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
    private unsubscribeChatMessages?: () => void;
    private unsubscribeSkills?: () => void;
    private unsubscribeRunEnergy?: () => void;
    private unsubscribeNotifications?: () => void;
    // Skills data from server - maps skill ID to {currentLevel, baseLevel, xp}
    private skillsMap: Map<number, { currentLevel: number; baseLevel: number; xp: number }> =
        new Map();
    autoRetaliateEnabled: boolean = true;
    private playerSyncManager!: PlayerSyncManager;
    private npcUpdateDecoder: NpcUpdateDecoder = new NpcUpdateDecoder();
    private pendingHitsplats: HitsplatServerPayload[] = [];
    private pendingPlayerHealthBars: Array<{ serverId: number; bar: any }> = [];
    private pendingNpcHealthBars: Array<{ serverId: number; bar: any }> = [];

    private flushPendingHitsplats(): void {
        if (!this.renderer || this.pendingHitsplats.length === 0) return;
        const pending = this.pendingHitsplats.splice(0, this.pendingHitsplats.length);
        for (const event of pending) {
            try {
                this.renderer.registerHitsplat(event);
            } catch (err) {
                console.warn("[OsrsClient] registerHitsplat failed", err);
            }
        }
    }

    private flushPendingPlayerHealthBars(): void {
        if (!this.renderer || this.pendingPlayerHealthBars.length === 0) return;
        const pending = this.pendingPlayerHealthBars.splice(0, this.pendingPlayerHealthBars.length);
        for (const entry of pending) {
            try {
                (this.renderer as any).registerPlayerHealthBarUpdate?.(entry);
            } catch (err) {
                console.warn("[OsrsClient] registerPlayerHealthBarUpdate failed", err);
            }
        }
    }

    private flushPendingNpcHealthBars(): void {
        if (!this.renderer || this.pendingNpcHealthBars.length === 0) return;
        const pending = this.pendingNpcHealthBars.splice(0, this.pendingNpcHealthBars.length);
        for (const entry of pending) {
            try {
                (this.renderer as any).registerNpcHealthBarUpdate?.(entry);
            } catch (err) {
                console.warn("[OsrsClient] registerNpcHealthBarUpdate failed", err);
            }
        }
    }

    private ensureModIconWidthsLoaded(): void {
        if (this.modIconsWidthLoaded) return;
        this.modIconsWidthLoaded = true;
        this.modIconWidthById.clear();
        try {
            const spriteIndex = this.cacheSystem?.getIndex?.(IndexType.DAT2.sprites);
            if (!spriteIndex) return;
            const archiveId = (spriteIndex as any).getArchiveId?.("mod_icons");
            if (typeof archiveId !== "number" || archiveId < 0) return;
            const sprites = SpriteLoader.loadIntoIndexedSprites(spriteIndex, archiveId);
            if (!sprites || sprites.length === 0) return;
            for (let i = 0; i < sprites.length; i++) {
                const sprite = sprites[i];
                if (!sprite) continue;
                const width = Math.max(0, (sprite.width ?? sprite.subWidth ?? 0) | 0);
                this.modIconWidthById.set(i, width);
            }
        } catch {}
    }

    private getModIconWidth(iconId: number): number {
        const id = iconId | 0;
        if (id < 0) return 0;
        if (!this.modIconsWidthLoaded) {
            this.ensureModIconWidthsLoaded();
        }
        return this.modIconWidthById.get(id) ?? 0;
    }

    private measureTextWidthOsrsMarkup(text: string, font: BitmapFont | undefined): number {
        if (!text) return 0;

        let width = 0;
        let chunk = "";
        const flushChunk = () => {
            if (chunk.length === 0) return;
            width += font ? font.measure(chunk) : chunk.length * 6;
            chunk = "";
        };

        for (let i = 0; i < text.length; ) {
            const ch = text.charAt(i);
            if (ch === "<") {
                const end = text.indexOf(">", i + 1);
                if (end !== -1) {
                    flushChunk();
                    const tag = text.slice(i + 1, end).toLowerCase();
                    if (tag === "lt") {
                        width += font ? font.measure("<") : 6;
                    } else if (tag === "gt") {
                        width += font ? font.measure(">") : 6;
                    } else if (tag.startsWith("img=")) {
                        const iconId = Number.parseInt(tag.slice(4), 10);
                        if (Number.isFinite(iconId) && iconId >= 0) {
                            width += this.getModIconWidth(iconId | 0);
                        }
                    }
                    i = end + 1;
                    continue;
                }
            }

            chunk += text.charCodeAt(i) === 160 ? " " : ch;
            i++;
        }

        flushChunk();
        return Math.max(0, Math.ceil(width));
    }

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

    private cacheClientScript(scriptId: number, script: Cs2Script): void {
        if (this.cs2ScriptCache.has(scriptId)) {
            this.cs2ScriptCache.delete(scriptId);
        }
        this.cs2ScriptCache.set(scriptId, script);

        if (this.cs2ScriptCache.size > OsrsClient.SCRIPT_CACHE_CAPACITY) {
            const oldestKey = this.cs2ScriptCache.keys().next().value as number | undefined;
            if (oldestKey !== undefined) {
                this.cs2ScriptCache.delete(oldestKey);
            }
        }
    }

    private loadClientScript(scriptId: number): Cs2Script | null {
        const cached = this.cs2ScriptCache.get(scriptId);
        if (cached) {
            this.cs2ScriptCache.delete(scriptId);
            this.cs2ScriptCache.set(scriptId, cached);
            return cached;
        }

        try {
            const scriptIdx = this.cacheSystem.getIndex(IndexType.DAT2.clientScript);
            const arch = scriptIdx.getArchive(scriptId);
            const file = arch?.getFile(0);
            if (!file?.data) {
                return null;
            }

            const script = parseScriptFromBytes(scriptId, file.data);
            this.cacheClientScript(scriptId, script);
            return script;
        } catch (e) {
            console.warn(`[Cs2Vm] Failed to load script ${scriptId}`, e);
            return null;
        }
    }

    constructor(
        readonly workerPool: RenderDataWorkerPool,
        readonly cacheList: CacheList,
        readonly objSpawns: ObjSpawn[],
        readonly mapImageCache: Cache,
        rendererType: OsrsRendererType,
        cache?: LoadedCache,
    ) {
        setSpellSelectionClearHandler(() => this.clearSelectedSpell());
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
                if (this.npcInstanceMapsPendingReload.has(mapId | 0)) {
                    this.scheduleNpcInstanceFlush();
                }
            };
            mapManager.onCurrentMapChanged = (_mapX, _mapY, _mapRadius) => {
                this.applyMobileMapCacheBudget(_mapRadius | 0);
                if (this.npcInstanceMapsPendingReload.size > 0) {
                    this.scheduleNpcInstanceFlush();
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
        if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
            window.addEventListener("pagehide", this.handleVarcsPageLifecycleFlush);
            window.addEventListener("beforeunload", this.handleVarcsPageLifecycleFlush);
        }

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
    private initCacheDependent(): void {
        this.widgetManager.osrsClient = this;
        // CS2 VM context with canvas/viewport state
        const self = this;
        // Create inventories map for CS2 VM
        const inventoriesMap = new Map<number, Inventory>();
        inventoriesMap.set(93, this.inventory); // Backpack
        inventoriesMap.set(94, this.equipment); // Equipment
        inventoriesMap.set(95, this.bankInventory); // Bank
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
            paramTypeLoader: this.loaderFactory.getParamTypeLoader(),
            enumTypeLoader: this.loaderFactory.getEnumTypeLoader(),
            structTypeLoader: this.loaderFactory.getStructTypeLoader(),
            npcTypeLoader: this.npcTypeLoader,
            locTypeLoader: this.locTypeLoader,
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
                return self.loadClientScript(id);
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
                if (widget) this.isDraggingWidget = true;
                // Initialize drag state for programmatic drag (cc_dragpickup)
                if (widget) {
                    // Set clickedWidget to the dragged widget so drag handling works
                    this.clickedWidget = widget;
                    this.clickedWidgetParent = this.resolveClickedWidgetParent(widget);
                    // Use the pickup offset as the click offset within the widget.
                    // cc_dragpickup provides offsets in logical (widget) coordinates, but
                    // clickedWidgetX/Y are subtracted from pixel-space mouse coordinates,
                    // so scale them to pixel space.
                    const [pickupScaleX, pickupScaleY] = this.getUiRenderScale();
                    this.clickedWidgetX = ((widget as any)._dragPickupOffsetX ?? 0) * pickupScaleX;
                    this.clickedWidgetY = ((widget as any)._dragPickupOffsetY ?? 0) * pickupScaleY;

                    // Determine the drag render area for coordinate calculations
                    // Priority: explicit dragRenderArea > parent widget > widget itself
                    const renderArea = this.clickedWidgetParent ?? widget;

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
                    (this as any)._dragRenderAreaAbsX = renderAreaAbsX;
                    (this as any)._dragRenderAreaAbsY = renderAreaAbsY;
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
                return this.measureTextWidthOsrsMarkup(text, font);
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
                const measure = (s: string) => this.measureTextWidthOsrsMarkup(s, font);

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
            // OSRS parity: Skills.method6928([trackId], outDelay, outDur, inDelay, inDur)
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
            // OSRS parity: jingles interrupt music, then music resumes
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
                return self.deviceOptions.get(optionId) ?? 0;
            },
            setDeviceOption: (optionId: number, value: number) => {
                self.deviceOptions.set(optionId, value);
                // Handle specific device options
                switch (optionId) {
                    case 19: // Master volume (enhanced client, 0-100 from enum_981)
                        // Master volume acts as a multiplier for all audio
                        // When master is 0, all audio should be muted
                        const masterVol = Math.max(0, Math.min(1, value / 100));
                        self.masterVolume = masterVol;
                        // Apply master volume to all audio systems
                        self.applyMasterVolume();
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
                // OSRS parity: Only send if not already waiting for response
                if (self.widgetManager?.meslayerContinueWidget !== null) {
                    return;
                }
                const pkt = createPacket(ClientPacketId.RESUME_PAUSEBUTTON);
                pkt.packetBuffer.writeShortAddLE(childIndex); // childIndex
                pkt.packetBuffer.writeInt(widgetUid); // widgetId
                queuePacket(pkt);
                // OSRS parity: Set meslayerContinueWidget to show "Please wait..."
                let w = self.widgetManager?.getWidgetByUid(widgetUid);
                if (
                    w &&
                    childIndex >= 0 &&
                    Array.isArray((w as any).children) &&
                    (w as any).children[childIndex]
                ) {
                    w = (w as any).children[childIndex] as any;
                }
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

                    // OSRS parity: notification_display must be mounted into the toplevel "notifications"
                    // component (e.g., toplevel_osrs_stretch:notifications) before running scripts.
                    self.ensureNotificationDisplayMounted();

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

        // Wire up the deferred callbacks - triggers queued var changes after script execution
        this.cs2Vm.onVarpChange = (varpId) => {
            // OSRS PARITY: Mark var cycle with specific varp ID - handlers fire during processWidgetTransmits()
            markVarTransmit(varpId);
        };
        // OSRS parity: Varc changes do not directly drive onMiscTransmit (field592).
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
                const script = this.loadClientScript(scriptId);
                if (script) {
                    /*console.log(
                        `[runWidgetScript] Script ${scriptId} loaded`,
                    );*/
                    this.cs2Vm.activeWidget = widget;
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
                } else {
                    console.warn(`[runWidgetScript] Script ${scriptId} not found in cache`);
                }
            } catch (err) {
                console.error(`[Cs2Vm] Script ${scriptId} crashed:`, err);
            }
        };

        // IMPORTANT (OSRS parity): Cache-loaded listener arrays are in the form [scriptId, ...args].
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
                else this.pendingHitsplats.push(payload as any);
            },
            onHealthBar: (payload) => {
                try {
                    if (this.renderer) {
                        (this.renderer as any).registerPlayerHealthBarUpdate?.(payload);
                    } else {
                        this.pendingPlayerHealthBars.push(payload as any);
                    }
                } catch (err) {
                    console.warn("[OsrsClient] registerPlayerHealthBarUpdate failed", err);
                }
            },
            onPublicChat: ({ serverId, text, playerType, modIcon, autoChat }) => {
                try {
                    const ecsIndex = this.playerEcs.getIndexForServerId(serverId | 0);
                    const fromName =
                        ecsIndex === undefined ? "" : this.playerEcs.getName(ecsIndex) ?? "";
                    const icon =
                        typeof modIcon === "number" && modIcon >= 0 ? `<img=${modIcon | 0}>` : "";
                    const sender = `${icon}${fromName}`;
                    const typeInfo = getPlayerTypeInfo(playerType ?? 0);
                    const privileged = typeInfo?.isPrivileged === true;
                    const isAuto = autoChat === true;
                    const messageType = privileged ? (isAuto ? 91 : 1) : isAuto ? 90 : 2;
                    // OSRS parity: public chat (player sync block) populates chat history so
                    // `onChatTransmit` listeners (chatbox scripts) behave like the reference client.
                    chatHistory.addMessage(messageType, text, sender, "");
                    // OSRS PARITY: Mark chat cycle instead of directly triggering handlers.
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
                    // OSRS parity: Trigger initial onVarTransmit for root interface widgets
                    this.triggerInitialVarTransmitForGroup(payload.groupId);
                    // Mark widgets loaded for transmit processing optimization
                    markWidgetsLoaded();

                    // OSRS parity: notification_display (660) is mounted into the toplevel
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
                // Use _serverVarpSync to prevent echoing transmit varps back to the server.
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
                // OSRS parity: Execute preScripts BEFORE mounting the interface.
                // This ensures scripts like 2379 (chatbox_resetbackground) run before
                // the dialog interface mounts, setting up chatbox dimensions correctly.
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
                    // PERF: Clear CS2 handler caches when opening modals
                    // openSubInterface internally closes any existing interface, but we need to
                    // clear caches here since that internal close doesn't trigger our handler
                    this.cs2Vm.clearHandlerCaches();
                    // PERF/Parity: Ensure transmit processing runs for newly-mounted interfaces.
                    // Our client skips transmit traversal unless an event occurred or widgets were loaded.
                    // Without this, interfaces like Skills (320) won't run onStatTransmit until a later
                    // skill update arrives (e.g., earning XP), causing stale/blank UI on first open.
                    markWidgetsLoaded();
                    // Run postScripts AFTER the interface is fully loaded (widgets indexed).
                    // This ensures scripts like highlight overlays can find the target widgets.
                    // OSRS PARITY: Modal is not yet "active" for IF_GETTOP at this point,
                    // so highlight scripts can find ui_highlights via toplevel_getcomponents.
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
                    // OSRS parity: Trigger initial onVarTransmit after postScripts, because some
                    // interfaces (for example buff_bar via script 5929) create dynamic children and
                    // install transmit handlers during post-script execution.
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
                        this.clearItemSpawnerSearchState();
                        this.setItemSpawnerSearchFocus(true);
                        this.refreshItemSpawnerSearchResults(true);
                    }
                }
            } else if (payload?.action === "close_sub") {
                const targetUid = Number(payload.targetUid) | 0;
                console.log(`[OsrsClient] Server closing sub-interface at widget ${targetUid}`);
                const closingParent = this.widgetManager?.getSubInterface(targetUid);
                if (this.widgetManager) {
                    this.widgetManager.closeSubInterface(targetUid);
                    // PERF: Clear CS2 handler caches when closing modals
                    // This prevents memory leaks from stale cached widget references
                    this.cs2Vm.clearHandlerCaches();
                    // OSRS parity: Server "close interface" clears meslayerContinueWidget.
                    // Reference: Client.java serverPacket handler (field3313)
                    if (this.widgetManager.meslayerContinueWidget) {
                        this.widgetManager.invalidateWidgetRender(
                            this.widgetManager.meslayerContinueWidget,
                        );
                        this.widgetManager.meslayerContinueWidget = null;
                    }
                }
                if (targetUid === CHATBOX_MODAL_TARGET_UID) {
                    const closingGroupId =
                        typeof closingParent?.group === "number" ? closingParent.group | 0 : -1;
                    if (
                        typeof closingGroupId === "number" &&
                        CHATBOX_DIALOG_GROUP_IDS.has(closingGroupId | 0)
                    ) {
                        this.updateChatboxVisibility();
                    }
                }
                const closingParentGroupId =
                    typeof closingParent?.group === "number" ? closingParent.group | 0 : -1;
                if (closingParentGroupId === ITEM_SPAWNER_MODAL_GROUP_ID) {
                    this.clearItemSpawnerSearchState();
                }
            } else if (payload?.action === "set_text") {
                const uid = Number(payload.uid) | 0;
                const text = typeof payload.text === "string" ? payload.text : String(payload.text);
                const w = this.widgetManager?.getWidgetByUid(uid);
                if (w) {
                    if (uid === this.getItemSpawnerQueryWidgetUid()) {
                        this.itemSpawnerSearchQuery = this.escapeItemSpawnerSearchText(text);
                        this.syncItemSpawnerSearchWidgets();
                        this.refreshItemSpawnerSearchResults(true);
                    } else {
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

                    // OSRS parity: hiding does not affect layout, showing can (we skip layout while hidden).
                    if (hidden) {
                        this.widgetManager.invalidateWidgetRender(w, "server-set-hidden");
                    } else {
                        this.widgetManager.invalidateWidget(w, "server-set-hidden");
                        // OSRS parity: When a previously hidden interface becomes visible,
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
                        // OSRS parity: For stackable items (coins, etc.), get the correct model
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
            } else if (payload?.action === "set_flags") {
                // OSRS parity: Set widget flags override (enables/disables click permissions)
                const uid = Number(payload.uid) | 0;
                const flags = Number(payload.flags) | 0;
                const w = this.widgetManager?.getWidgetByUid(uid);
                if (w && this.widgetManager) {
                    this.widgetManager.setWidgetFlagsOverride(w, flags);
                }
            } else if (payload?.action === "set_flags_range") {
                // OSRS parity: IF_SETEVENTS packet - sets flags for a range of child indices.
                // Reference: player.setInterfaceEvents(interfaceId, component, from, to, setting)
                // In OSRS, this stores flags in Client.widgetFlags with keys:
                //   key = (uid << 32) | childIndex for each childIndex in [from, to]
                // Dynamic children (CC_CREATE) have id=parentUid and childIndex from the script.
                // When getWidgetFlags is called on a dynamic child, it looks up (child.id << 32) | child.childIndex.
                const uid = Number(payload.uid) | 0;
                // OSRS parity: -1 may arrive as 65535 (0xFFFF) due to unsigned transmission.
                // Static widgets use childIndex=-1, so normalize 65535 back to -1.
                let fromSlot = Number(payload.fromSlot) | 0;
                let toSlot = Number(payload.toSlot) | 0;
                if (fromSlot === 65535) fromSlot = -1;
                if (toSlot === 65535) toSlot = -1;
                const flags = Number(payload.flags) | 0;
                const groupId = (uid >> 16) & 0xffff;
                const childId = uid & 0xffff;
                console.log(
                    `[OsrsClient] set_flags_range: uid=${uid} (group=${groupId}, child=${childId}), fromSlot=${fromSlot}, toSlot=${toSlot}, flags=${flags} (transmitOp1=${
                        (flags & 2) !== 0
                    })`,
                );
                if (this.widgetManager) {
                    // Set flags for each childIndex in the range [fromSlot, toSlot]
                    // The uid becomes the 'id' component of the key (matches dynamic child's id field)
                    for (let childIndex = fromSlot; childIndex <= toSlot; childIndex++) {
                        this.widgetManager.setWidgetFlagsByKey(uid, childIndex, flags);
                    }
                }
            } else if (payload?.action === "run_script") {
                // OSRS parity: RUNCLIENTSCRIPT packet - run a CS2 script with arguments
                const scriptId = Number(payload.scriptId) | 0;
                const args = payload.args;
                if (scriptId > 0 && this.cs2Vm && Array.isArray(args)) {
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
                            this.cs2Vm.run(script, intArgs, stringArgs);
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
        this.unsubscribeHitsplats = subscribeHitsplats((event) => {
            try {
                // Log each hitsplat so developers can trace combat events easily.
                console.log(
                    `[hitsplat] ${event.targetType} ${event.targetId} damage=${
                        event.damage
                    } serverTick=${event.tick} clientTick=${getCurrentTick()}`,
                    event,
                );
            } catch {}
            if (this.renderer) this.renderer.registerHitsplat(event);
            else this.pendingHitsplats.push(event);
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
                    // OSRS parity: spot animation delay is in client cycles (Client.cycle units).
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
                    volume?: number;
                }) => {
                    try {
                        if (!this.soundEffectSystem) return;
                        const hasPosition = payload.x !== undefined && payload.y !== undefined;
                        // SOUND_AREA: radius in tiles -> scene units (128 per tile)
                        const radiusScene =
                            payload.radius !== undefined && payload.radius > 0
                                ? (payload.radius | 0) * 128
                                : undefined;
                        this.soundEffectSystem.playSoundEffect(payload.soundId, {
                            loops: payload.loops,
                            delayMs: payload.delay,
                            position: hasPosition
                                ? {
                                      x: ((payload.x! | 0) * 128 + 64) | 0,
                                      y: ((payload.y! | 0) * 128 + 64) | 0,
                                      z: (((payload.level ?? 0) | 0) * 128) | 0,
                                  }
                                : undefined,
                            radius: radiusScene,
                            volume: payload.volume,
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
                // Note: "Now Playing" text is updated via IF_SETTEXT from server (OSRS parity)
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
                chatHistory.addMessage(msg.messageType, msg.text, msg.from ?? "", msg.prefix ?? "");
                // Note: chatCycle is now marked by onMessageAdded callback below
            });
            // Set up callback to mark chat cycle when ANY message is added (including from CS2 MES opcode)
            chatHistory.onMessageAdded = () => {
                // OSRS PARITY: Mark chat cycle - handlers fire during processWidgetTransmits()
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
                // OSRS PARITY: Mark chat cycle (uses markChatTransmit for proper timing)
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
                    // OSRS PARITY: Mark each changed stat ID for trigger checking
                    markStatTransmit(entry.id);
                }

                // OSRS parity: "Depends on combat levels" comparisons use the local player's combat level.
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
                // OSRS parity: Set varcint for CS2 scripts (account_summary_update_combatlevel uses this)
                this.varManager?.setVarcInt(VARC_COMBAT_LEVEL, clampedCombat);
                // OSRS parity: Set varbit for combat styles tab (combat_interface_setup uses this)
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
                // OSRS PARITY: Set varbit 25 (stamina_active) for CS2 orb scripts
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
                // OSRS PARITY: Mark misc cycle to update run orb display
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
                    const pending = state?.getAllPendingSteps?.() ?? [];
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
            subscribeWelcome(({ tickMs }) => {
                try {
                    this.playerAnimController.reset();
                } catch {}
                try {
                    this.playerMovementSync.setServerTickMs(tickMs | 0);
                } catch {}
            });
            // Handle websocket disconnection - show "Connection lost" message while reconnecting
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
            });
            // Return to login screen when reconnection attempts are exhausted
            subscribeReconnectFailed(() => {
                try {
                    // OSRS parity: failed connect shows timeout on login screen.
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
            });
            // Promote buffered steps on server tick to keep clients in sync
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
            });
            // Capture server-assigned ID as soon as handshake arrives
            subscribeHandshake(({ id, name, appearance, chatIcons, chatPrefix }) => {
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
                                const pa = this.buildPlayerAppearanceFromPayload(appearance, true);
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
            });

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
            // appearance block (OSRS parity). This handler is kept for backward compatibility
            // and for setting initial default animations before player is fully spawned.
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
            });
            subscribeInventory((update) => {
                try {
                    this.handleInventoryServerUpdate(update);
                } catch (err) {
                    console.warn("inventory update dispatch failed", err);
                }
            });
            subscribeBank((update) => {
                try {
                    this.handleBankServerUpdate(update);
                } catch (err) {
                    console.warn("bank update dispatch failed", err);
                }
            });
            subscribeCollectionLog((update) => {
                try {
                    this.handleCollectionLogServerUpdate(update);
                } catch (err) {
                    console.warn("collection log update dispatch failed", err);
                }
            });
            subscribeShop((state) => {
                try {
                    this.handleShopServerUpdate(state);
                } catch (err) {
                    console.warn("shop update dispatch failed", err);
                }
            });
            this.unsubscribeGroundItems = subscribeGroundItems((payload) => {
                try {
                    this.groundItems.update(payload);
                    (this.renderer as any)?.updateGroundItemMeshes?.(
                        this.groundItems.getAllStacks(),
                    );
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

        // OSRS parity: Do NOT predict movement on click. The reference client only sets
        // destinationX/Y for the minimap marker and sends the packet. Movement prediction
        // happens when the server sends back movement updates with running mode (class231.field2459).
        // See: class31.java menu actions - they only set Client.destinationX/Y and send packet.

        // Mirror OSRS client: send MOVE_GAMECLICK (ClientPacket.field3179) via binary packet writer.
        // Server computes path; packet contains world coords + ctrl modifier (run invert).
        if (isServerConnected()) {
            const node = createPacket(ClientPacketId.MOVE_GAMECLICK);
            node.packetBuffer.writeShortAddLE(worldY);
            node.packetBuffer.writeByteNeg(ctrlHeld ? 1 : 0);
            node.packetBuffer.writeShortAddLE(worldX);
            // Reference client writes a final shortAdd param; it's unused for ground clicks.
            node.packetBuffer.writeShortAdd(0);
            queuePacket(node);
        }
    }

    private markVarcsChanged(): void {
        if (!this.varcsStorageKey || !this.varManager) {
            return;
        }
        this.varcsUnwrittenChanges = true;
    }

    private writeVarcs(): void {
        if (!this.varcsUnwrittenChanges || !this.varcsStorageKey || !this.varManager) {
            return;
        }
        saveBrowserVarcs(this.varcsStorageKey, this.varManager.snapshotPersistentVarcs());
        this.varcsUnwrittenChanges = false;
        this.varcsLastWriteTimeMs = Date.now();
    }

    private tryWriteVarcs(): void {
        if (!this.varcsUnwrittenChanges) {
            return;
        }
        const now = Date.now();
        if (this.varcsLastWriteTimeMs < now - 60000) {
            this.writeVarcs();
        }
    }

    /**
     * OSRS parity: Check if a widget UID belongs to an inventory container (type 2)
     * Used to determine if child items should be treated as draggable
     */
    private isInventoryContainer(parentUid: number): boolean {
        const parent = this.widgetManager?.getWidgetByUid(parentUid);
        if (!parent) return false;
        // Type 2 = inventory grid, type 5 with items = item container
        return parent.type === 2 || (parent.itemId !== undefined && parent.itemId >= 0);
    }

    private getDragParentDepth(w: any): number {
        const flags = this.widgetManager?.getWidgetFlags?.(w) ?? w?.flags ?? 0;
        return getDragDepth(flags);
    }

    /**
     * OSRS parity: Resolve clickedWidgetParent via flag-based parent climbing.
     * Reference: class482.method8733 + ReflectionCheck.method736(getWidgetFlags(w)).
     */
    private resolveDragParentByFlags(w: any): any | null {
        const depth = this.getDragParentDepth(w);
        if (depth === 0) return null;
        let cur: any = w;
        for (let i = 0; i < depth; i++) {
            const parentUid = cur?.parentUid;
            if (typeof parentUid !== "number" || parentUid === -1) return null;
            cur = this.widgetManager?.getWidgetByUid(parentUid);
            if (!cur) return null;
        }
        return cur;
    }

    /**
     * OSRS parity: clickedWidgetParent selection used for clamping and script coords.
     * Reference: class220.clickWidget(): method8733(widget) ?? widget.parent
     * In our client, `dragRenderArea` is the equivalent of Java `Widget.parent` (CC_SETDRAGGABLE).
     *
     * IMPORTANT: Only return a drag parent if explicitly set via:
     * 1. Flag bits 17-19 (from cc_setdraggable with parent depth)
     * 2. dragRenderArea (from cc_setdraggable with explicit render area)
     *
     * Do NOT fall back to parentUid - that causes incorrect clamping for widgets like
     * bank items that should be draggable anywhere on screen.
     */
    private resolveClickedWidgetParent(w: any): any | null {
        if (!w) return null;
        // Check flag-based parent depth first (set by cc_setdraggable)
        const byFlags = this.resolveDragParentByFlags(w);
        if (byFlags) return byFlags;
        // Check explicit drag render area (set by cc_setdraggable)
        if (w.dragRenderArea) return w.dragRenderArea;
        // OSRS parity: Do NOT fall back to parentUid for drag clamping
        // Widgets without explicit drag parent (like bank items) should drag freely
        return null;
    }

    /**
     * Get the UI render scale that maps logical widget coordinates to canvas pixel coordinates.
     * Returns [scaleX, scaleY]. At scale 1 (no UI scaling), both are 1.
     */
    private getUiRenderScale(): [number, number] {
        const canvas = this.inputManager?.element as HTMLCanvasElement | undefined;
        const layoutW = this.widgetManager?.canvasWidth || 0;
        const layoutH = this.widgetManager?.canvasHeight || 0;
        const bufW = canvas?.width || 0;
        const bufH = canvas?.height || 0;
        const sx = layoutW > 0 && bufW > 0 ? bufW / layoutW : 1;
        const sy = layoutH > 0 && bufH > 0 ? bufH / layoutH : 1;
        return [sx, sy];
    }

    /**
     * OSRS parity: Check if a widget is draggable.
     * Reference: class482.method8733 - drag is controlled by flag bits 17-19 set via cc_setdraggable.
     * A widget is only draggable if:
     * 1. cc_setdraggable was called (sets isDraggable flag)
     * 2. OR it has an onDrag handler
     * 3. OR it's an inventory item with a dragRenderArea set
     */
    private isWidgetDraggable(w: any): boolean {
        // OSRS parity: primary gate is flags bits 17-19 (parent depth) OR explicit drag parent set by CC_SETDRAGGABLE.
        if (this.getDragParentDepth(w) !== 0) return true;
        if (w.dragRenderArea) return true;
        if (w.isDraggable) return true;

        // Has drag handlers set via cc_setondrag
        if (w.eventHandlers?.onDrag || w.onDrag) return true;

        return false;
    }

    private getOrInitPlayerDesignAppearance(): PlayerAppearance | undefined {
        if (this.playerDesignAppearance) return this.playerDesignAppearance;
        if (!this.idkTypeLoader) return undefined;

        try {
            const idx = this.playerEcs.getIndexForServerId(this.controlledPlayerServerId);
            const ap = idx !== undefined ? this.playerEcs.getAppearance(idx) : undefined;
            if (ap) {
                this.playerDesignAppearance = new PlayerAppearance(
                    (ap.gender as any) ?? 0,
                    Array.from(ap.colors ?? []),
                    Array.from(ap.kits ?? []),
                    Array.from(ap.equip ?? []),
                    { ...(ap.headIcons ?? { prayer: -1 }) },
                );
                return this.playerDesignAppearance;
            }
        } catch {}

        this.playerDesignAppearance = PlayerAppearance.defaultMale(this.idkTypeLoader);
        return this.playerDesignAppearance;
    }

    private syncPlayerDesignAppearanceToUi(pa: PlayerAppearance): void {
        // Expose gender to CS2 (A/B button state uses player_design_bodytype varbit).
        try {
            this.varManager?.setVarbit?.(14021, ((pa.gender ?? 0) | 0) === 1 ? 1 : 0);
        } catch {}

        // Keep the model widget fed even if the local ECS player isn't spawned yet.
        try {
            const w = this.widgetManager?.findWidget?.(679, 73);
            if (w) {
                (w as any).playerAppearance = {
                    gender: (pa.gender ?? 0) | 0,
                    colors: Array.from(pa.colors ?? [])
                        .slice(0, 5)
                        .map((n) => Number(n) | 0),
                    kits: Array.from(pa.kits ?? [])
                        .slice(0, 7)
                        .map((n) => Number(n) | 0),
                    equip: new Array(14).fill(-1),
                };
                this.widgetManager.invalidateWidgetRender(w, "player-design");
            }
        } catch {}
    }

    private handlePlayerDesignWidgetAction(childId: number): boolean {
        // PlayerDesign (Interface group 679) is a client-side appearance editor.
        // Cache widgets in this group are mostly empty containers; clicks should mutate the local
        // player appearance immediately and let CS2 redraw visuals (e.g. body type A/B via varbit).
        const id = childId | 0;

        // Component IDs from cache (group 679)
        const COMP_HEAD_LEFT = 15;
        const COMP_HEAD_RIGHT = 16;
        const COMP_JAW_LEFT = 19;
        const COMP_JAW_RIGHT = 20;
        const COMP_TORSO_LEFT = 23;
        const COMP_TORSO_RIGHT = 24;
        const COMP_ARMS_LEFT = 27;
        const COMP_ARMS_RIGHT = 28;
        const COMP_HANDS_LEFT = 31;
        const COMP_HANDS_RIGHT = 32;
        const COMP_LEGS_LEFT = 35;
        const COMP_LEGS_RIGHT = 36;
        const COMP_FEET_LEFT = 39;
        const COMP_FEET_RIGHT = 40;
        const COMP_HAIR_LEFT = 46;
        const COMP_HAIR_RIGHT = 47;
        const COMP_TORSO_COL_LEFT = 50;
        const COMP_TORSO_COL_RIGHT = 51;
        const COMP_LEGS_COL_LEFT = 54;
        const COMP_LEGS_COL_RIGHT = 55;
        const COMP_FEET_COL_LEFT = 58;
        const COMP_FEET_COL_RIGHT = 59;
        const COMP_SKIN_LEFT = 62;
        const COMP_SKIN_RIGHT = 63;
        const COMP_BODYTYPE_A = 68;
        const COMP_BODYTYPE_B = 69;
        const COMP_CONFIRM = 74;

        const VARBIT_PLAYER_DESIGN_BODYTYPE = 14021;

        if (!this.idkTypeLoader) return true;
        const pa = this.getOrInitPlayerDesignAppearance();
        if (!pa) return true;

        const gender = ((pa.gender ?? 0) | 0) === 1 ? 1 : 0;
        const kits = Array.isArray(pa.kits) ? pa.kits : (pa.kits = new Array(7).fill(-1));
        const colors = Array.isArray(pa.colors) ? pa.colors : (pa.colors = [0, 0, 0, 0, 0]);
        if (kits.length < 7) kits.length = 7;
        if (colors.length < 5) colors.length = 5;
        for (let i = 0; i < 7; i++) kits[i] = (kits[i] ?? -1) | 0;
        for (let i = 0; i < 5; i++) colors[i] = (colors[i] ?? 0) | 0;

        const expectedIdkBodyPartId = (g: number, partIndex: number): number =>
            ((partIndex | 0) + (((g | 0) === 1 ? 7 : 0) | 0)) | 0;

        const cycleKit = (partIndex: number, dir: -1 | 1): boolean => {
            const loader: any = this.idkTypeLoader as any;
            const count = (loader?.getCount?.() ?? 0) | 0;
            if (count <= 0 || typeof loader?.load !== "function") return false;

            const want = expectedIdkBodyPartId(pa.gender | 0, partIndex | 0) | 0;
            const currentKitId = (kits[partIndex] ?? -1) | 0;
            let idkId = currentKitId;
            if (idkId < 0 || idkId >= count) {
                idkId = dir === 1 ? count - 1 : 0;
            }

            for (let i = 0; i < count; i++) {
                idkId = (idkId + (dir === 1 ? 1 : -1) + count) % count;
                try {
                    const kit: any = loader.load(idkId);
                    if (!kit || kit.nonSelectable) continue;
                    const rawPart = kit.bodyPartId ?? kit.bodyPartyId;
                    const bodyPartId = typeof rawPart === "number" ? rawPart | 0 : -1;
                    if (bodyPartId !== want) continue;
                    kits[partIndex] = idkId | 0;
                    return true;
                } catch {
                    continue;
                }
            }
            return false;
        };

        const cycleColor = (colorIndex: number, dir: -1 | 1): boolean => {
            const idx = Math.max(0, Math.min(4, colorIndex | 0)) | 0;
            const palette = PLAYER_BODY_RECOLOR_TO_1[idx] ?? [];
            const len = (palette.length | 0) >>> 0;
            if (len <= 0) return false;
            let v = (colors[idx] ?? 0) | 0;
            for (let i = 0; i < len; i++) {
                v = (v + (dir === 1 ? 1 : -1) + len) % len;
                // OSRS parity: restrict skin palette (index 4) to < 8
                if (idx !== 4 || v < 8) break;
            }
            colors[idx] = v | 0;
            return true;
        };

        const setGender = (g: 0 | 1): boolean => {
            const newGender = g | 0;
            const was = ((pa.gender ?? 0) | 0) === 1 ? 1 : 0;
            if (((pa.gender ?? 0) | 0) !== newGender) {
                pa.gender = newGender as any;
                const defaults =
                    newGender === 1
                        ? PlayerAppearance.defaultFemale(this.idkTypeLoader)
                        : PlayerAppearance.defaultMale(this.idkTypeLoader);
                const defKits = Array.isArray(defaults.kits)
                    ? defaults.kits
                    : new Array(7).fill(-1);
                pa.kits = defKits.slice(0, 7).map((n) => Number(n) | 0);
            }
            // Mirror gender into player_design_bodytype for CS2 UI (script3755) and other scripts.
            this.varManager?.setVarbit?.(VARBIT_PLAYER_DESIGN_BODYTYPE, newGender);
            return was !== newGender;
        };

        const confirm = (): boolean => {
            try {
                // Server receives only the final selection; it will validate + persist + close the interface.
                const payload = {
                    gender: ((pa.gender ?? 0) | 0) === 1 ? 1 : 0,
                    colors: Array.from(pa.colors ?? [])
                        .slice(0, 5)
                        .map((n) => Number(n) | 0),
                    kits: Array.from(pa.kits ?? [])
                        .slice(0, 7)
                        .map((n) => Number(n) | 0),
                };
                sendPlayerDesignConfirm(payload);
            } catch {}
            // Ensure UI remains consistent even if server response is delayed.
            this.syncPlayerDesignAppearanceToUi(pa);
            return true;
        };

        let changed = false;
        switch (id) {
            case COMP_HEAD_LEFT:
                changed = cycleKit(0, -1);
                break;
            case COMP_HEAD_RIGHT:
                changed = cycleKit(0, 1);
                break;
            case COMP_JAW_LEFT:
                changed = cycleKit(1, -1);
                break;
            case COMP_JAW_RIGHT:
                changed = cycleKit(1, 1);
                break;
            case COMP_TORSO_LEFT:
                changed = cycleKit(2, -1);
                break;
            case COMP_TORSO_RIGHT:
                changed = cycleKit(2, 1);
                break;
            case COMP_ARMS_LEFT:
                changed = cycleKit(3, -1);
                break;
            case COMP_ARMS_RIGHT:
                changed = cycleKit(3, 1);
                break;
            case COMP_HANDS_LEFT:
                changed = cycleKit(4, -1);
                break;
            case COMP_HANDS_RIGHT:
                changed = cycleKit(4, 1);
                break;
            case COMP_LEGS_LEFT:
                changed = cycleKit(5, -1);
                break;
            case COMP_LEGS_RIGHT:
                changed = cycleKit(5, 1);
                break;
            case COMP_FEET_LEFT:
                changed = cycleKit(6, -1);
                break;
            case COMP_FEET_RIGHT:
                changed = cycleKit(6, 1);
                break;
            case COMP_HAIR_LEFT:
                changed = cycleColor(0, -1);
                break;
            case COMP_HAIR_RIGHT:
                changed = cycleColor(0, 1);
                break;
            case COMP_TORSO_COL_LEFT:
                changed = cycleColor(1, -1);
                break;
            case COMP_TORSO_COL_RIGHT:
                changed = cycleColor(1, 1);
                break;
            case COMP_LEGS_COL_LEFT:
                changed = cycleColor(2, -1);
                break;
            case COMP_LEGS_COL_RIGHT:
                changed = cycleColor(2, 1);
                break;
            case COMP_FEET_COL_LEFT:
                changed = cycleColor(3, -1);
                break;
            case COMP_FEET_COL_RIGHT:
                changed = cycleColor(3, 1);
                break;
            case COMP_SKIN_LEFT:
                changed = cycleColor(4, -1);
                break;
            case COMP_SKIN_RIGHT:
                changed = cycleColor(4, 1);
                break;
            case COMP_BODYTYPE_A:
                changed = setGender(0);
                break;
            case COMP_BODYTYPE_B:
                changed = setGender(1);
                break;
            case COMP_CONFIRM:
                return confirm();
            default:
                this.syncPlayerDesignAppearanceToUi(pa);
                return true;
        }

        // Always suppress server widget ops for this interface (client-only).
        if (!changed) {
            this.syncPlayerDesignAppearanceToUi(pa);
            return true;
        }

        // Commit appearance change for local preview and keep CS2 vars/sprites in sync.
        this.playerDesignAppearance = pa;
        const localIdx = this.playerEcs.getIndexForServerId(this.controlledPlayerServerId);
        if (localIdx !== undefined) {
            this.playerEcs.setAppearance(localIdx, pa);
            try {
                this.playerEcs.ensureBaseForIndex(localIdx, {
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
            } catch {}
        }

        // Keep the bodytype varbit in sync with current gender for CS2 state (A/B buttons).
        if ((pa.gender | 0) !== gender) {
            this.varManager?.setVarbit?.(
                VARBIT_PLAYER_DESIGN_BODYTYPE,
                (pa.gender | 0) === 1 ? 1 : 0,
            );
        }
        this.syncPlayerDesignAppearanceToUi(pa);

        return true;
    }

    handleWidgetAction(event: {
        widget?: any;
        option?: string;
        target?: string;
        source?: "menu" | "primary";
        cursorX?: number;
        cursorY?: number;
        slot?: number;
        itemId?: number;
    }): void {
        // OSRS parity: for dynamic children (CC_CREATE), the click packet identifies the parent widget
        // plus a childIndex ("slot"). Our menu/hit-test layers sometimes surface the parent widget with
        // `slot` set to the dynamic child index. For CS2, we must execute onOp/onClick on the DYNAMIC
        // child widget itself (where cc_setonop listeners are attached), not on the parent container.
        const resolveDynamicChildForAction = (widget: any, slot: unknown): any => {
            if (!widget || typeof slot !== "number") return widget;
            const idx = slot | 0;
            if (idx < 0) return widget;
            let host = widget as any;
            let children = host?.children;
            // Some input layers pass a shallow widget snapshot without the dynamic `children` array.
            // Prefer the canonical widget instance from the widget manager when available.
            if (!Array.isArray(children) && typeof host?.uid === "number") {
                const canonical = this.widgetManager?.getWidgetByUid?.((host.uid as number) | 0);
                if (canonical) {
                    host = canonical as any;
                    children = (canonical as any)?.children;
                }
            }
            if (!Array.isArray(children)) return widget;
            const child = children[idx];
            if (!child) return widget;
            // Only switch to a CC_CREATE dynamic child (fileId === -1) at the matching childIndex.
            if ((child.fileId | 0) !== -1) return widget;
            if (typeof child.childIndex === "number" && (child.childIndex | 0) !== idx) {
                return widget;
            }
            const childParentUid =
                typeof child.parentUid === "number" ? (child.parentUid as number) | 0 : undefined;
            const widgetUid =
                typeof widget.uid === "number" ? (widget.uid as number) | 0 : undefined;
            const widgetId = typeof widget.id === "number" ? (widget.id as number) | 0 : undefined;
            if (
                childParentUid !== undefined &&
                widgetUid !== undefined &&
                childParentUid !== widgetUid &&
                (widgetId === undefined || childParentUid !== widgetId)
            ) {
                return widget;
            }
            return child;
        };

        const w = resolveDynamicChildForAction(event.widget, event.slot);
        if (w !== event.widget) {
            event = { ...event, widget: w, slot: (w.childIndex ?? event.slot) as any };
        }
        const groupId = w?.groupId ?? w?.uid >>> 16;
        const childId =
            w?.fileId != null && w?.fileId >= 0
                ? w.fileId
                : typeof w?.childIndex === "number"
                ? w.childIndex
                : w?.uid & 0xffff;
        const isItemSpawnerSearchClick =
            (groupId | 0) === ITEM_SPAWNER_MODAL_GROUP_ID &&
            this.isItemSpawnerSearchComponent(childId | 0);

        if (this.itemSpawnerSearchFocused && !isItemSpawnerSearchClick) {
            this.setItemSpawnerSearchFocus(false);
        }
        if (isItemSpawnerSearchClick) {
            this.setItemSpawnerSearchFocus(true);
            return;
        }

        // PlayerDesign (679): handle locally (OSRS parity: appearance changes are client-side).
        // The interface widgets themselves are largely CS2-driven containers; server should only
        // receive the final selection, not each arrow click.
        if ((groupId | 0) === 679) {
            if (this.handlePlayerDesignWidgetAction(childId | 0)) {
                return;
            }
        }

        if (w) {
            const uid = typeof w.uid === "number" ? w.uid | 0 : undefined;
            const logGroupId = uid !== undefined ? (uid >>> 16) & 0xffff : (groupId as number);
            const logChildId = uid !== undefined ? uid & 0xffff : (childId as number);
            console.log("[widget-click]", {
                uid,
                groupId: logGroupId,
                childId: logChildId,
                fileId: typeof w.fileId === "number" ? w.fileId | 0 : undefined,
                childIndex: typeof w.childIndex === "number" ? w.childIndex | 0 : undefined,
                option: event.option,
                target: event.target,
                source: event.source,
                cursorX: event.cursorX,
                cursorY: event.cursorY,
                slot: typeof event.slot === "number" ? event.slot | 0 : undefined,
                itemId: typeof event.itemId === "number" ? event.itemId | 0 : undefined,
                type: typeof w.type === "number" ? w.type | 0 : undefined,
                contentType: typeof w.contentType === "number" ? w.contentType | 0 : undefined,
            });
        }

        // OSRS parity: For draggable widgets (like inventory items), defer action until mouse released
        // This prevents "Use" from triggering on mousedown when the user might be trying to drag
        if (event.source === "primary" && event.widget && this.isWidgetDraggable(event.widget)) {
            // Check if mouse button is currently held
            const isMouseDown = this.inputManager?.isDragging?.() === true;
            if (isMouseDown) {
                // Queue this action to fire when mouse is released
                this.deferredWidgetAction = event;
                return;
            }
        }

        // Handle minimap orbs directly on client side for instant feedback
        if (event.widget) {
            const widgetGroupId = event.widget.groupId ?? event.widget.uid >>> 16;
            const childId = event.widget.fileId ?? event.widget.uid & 0xffff;

            // OSRS parity: Settings cog buttons in side tabs switch to the Settings tab (index 11)
            // Widget 399:11 = Quest list settings cog
            // Widget 629:* with option "Settings" = Side journal settings cogs
            // Widget 116:32 = "All Settings" button (opens settings modal - handled separately)
            if (
                event.option === "Settings" &&
                (groupId === INTERFACE_QUEST_LIST_ID ||
                    groupId === SIDE_JOURNAL_GROUP_ID ||
                    groupId === INTERFACE_ACHIEVEMENT_DIARY_ID)
            ) {
                // Invoke CS2 script 914 (toplevel_sidebutton_op) to switch to Settings tab (index 11)
                // Args: event_op=1, enum_id=1130 (resizable mode), tab_index=11 (settings)
                const rootInterfaceId = this.widgetManager?.rootInterface ?? 161;
                // Map root interface to enum ID:
                // 161 = toplevel_osrs_stretch -> enum_1130
                // 165 = toplevel_display (fullscreen) -> enum_1132
                // 548 = toplevel -> enum_1129
                // 164 = toplevel_pre_eoc -> enum_1131
                let displayEnumId = 1130; // Default to resizable
                if (rootInterfaceId === 165) displayEnumId = 1132;
                else if (rootInterfaceId === 548) displayEnumId = 1129;
                else if (rootInterfaceId === 164) displayEnumId = 1131;

                if (this.cs2Vm) {
                    const script = (this.cs2Vm as any).context?.loadScript?.(914);
                    if (script) {
                        // toplevel_sidebutton_op(event_op, enum, tab_index)
                        (this.cs2Vm as any).run(script, [1, displayEnumId, 11], []);
                        console.log(
                            `[OsrsClient] Settings cog clicked - invoked script 914 to switch to Settings tab (enum=${displayEnumId})`,
                        );
                    } else {
                        // Fallback: just set varcint171 directly
                        this.varManager.setVarcInt(171, 11);
                        console.log(
                            `[OsrsClient] Settings cog clicked (group=${groupId}, child=${childId}), set varcint171=11 (fallback)`,
                        );
                    }
                } else {
                    this.varManager.setVarcInt(171, 11);
                    console.log(
                        `[OsrsClient] Settings cog clicked - no VM, set varcint171=11 directly`,
                    );
                }
                // Don't return - let the action continue to send to server and run CS2 handlers
            }

            // Handle spell-on-widget (e.g., High Alchemy on inventory item)
            // OSRS parity: route this through the low-level IF_BUTTONT packet.
            if (ClientState.isSpellSelected) {
                // Prevent casting on the same click that entered targeting mode
                // Require at least 50ms to have passed since entering spell targeting
                const timeSinceTargeting = Date.now() - ClientState.spellTargetEnteredFrame;
                if (timeSinceTargeting < 50) {
                    console.log(
                        `[OsrsClient] Ignoring spell-on-item in same click as targeting entry (${timeSinceTargeting}ms)`,
                    );
                    return;
                }

                const targetItemId = event.itemId ?? event.widget.itemId ?? -1;
                const targetSlot = event.slot ?? event.widget.childIndex ?? childId;
                const targetWidgetUid = event.widget.uid;

                // Check if this is an inventory item widget (has itemId or is in inventory group 149)
                const isInventoryItem = targetItemId >= 0 || groupId === 149;

                // Check if clicking on the same item that's currently selected (item-on-itself)
                // In OSRS, this cancels the selection rather than trying to use item on itself
                if (ClientState.isItemSelected === 1 && isInventoryItem) {
                    const isSameItem =
                        targetSlot === ClientState.selectedItemSlot &&
                        targetItemId === ClientState.selectedItemId;
                    if (isSameItem) {
                        console.log(
                            `[OsrsClient] Item clicked on itself - cancelling selection (slot=${targetSlot}, itemId=${targetItemId})`,
                        );
                        this.clearSelectedSpell();
                        ClientState.isItemSelected = 0;
                        ClientState.selectedItemWidget = 0;
                        ClientState.selectedItemSlot = 0;
                        ClientState.selectedItemId = -1;
                        return;
                    }
                }

                // OSRS parity: Check if this widget is a valid target for the selected spell/item
                // If targeting a non-item widget, check WIDGET_USE_TARGET (bit 21) validation
                // Reference: WorldMapSprite.java:104 - (flags >> 21 & 1) != 0
                if (!isInventoryItem) {
                    const targetFlags =
                        this.widgetManager?.getWidgetFlags?.(event.widget) ??
                        event.widget?.flags ??
                        0;
                    const targetHasWidgetUseTarget = isWidgetUseTarget(targetFlags);
                    // selectedSpellTargetMask is the 6-bit mask: bit 5 (0x20) = USE_WIDGET
                    const spellCanTargetWidgets =
                        (ClientState.selectedSpellTargetMask & 0x20) !== 0;

                    if (spellCanTargetWidgets && !targetHasWidgetUseTarget) {
                        // Spell can target widgets, but this widget doesn't have WIDGET_USE_TARGET
                        console.log(
                            `[OsrsClient] Widget targeting rejected: target widget lacks WIDGET_USE_TARGET flag (targetFlags=0x${targetFlags.toString(
                                16,
                            )}, spellTargetMask=0x${ClientState.selectedSpellTargetMask.toString(
                                16,
                            )})`,
                        );
                        // Clear selection and ignore this click
                        this.clearSelectedSpell();
                        return;
                    }
                }

                if (isInventoryItem) {
                    // Check if this is item-on-item (isItemSelected === 1) or spell-on-item
                    if (ClientState.isItemSelected === 1) {
                        // This is item-on-item (e.g., using knife on logs)
                        console.log(
                            `[OsrsClient] Item-on-item: "${ClientState.selectedSpellName}" (slot=${ClientState.selectedItemSlot}, itemId=${ClientState.selectedItemId}) -> item=${targetItemId}, slot=${targetSlot}`,
                        );

                        sendInventoryUseOn({
                            slot: ClientState.selectedItemSlot,
                            itemId: ClientState.selectedItemId,
                            target: {
                                kind: "inv",
                                slot: targetSlot,
                                itemId: targetItemId,
                            },
                        });

                        // Clear selection after use
                        this.clearSelectedSpell();
                        ClientState.clearItemSelection();
                        return;
                    } else {
                        // This is spell-on-item (e.g., High Alchemy on item)
                        const selection = buildSelectedSpellPayload(
                            ClientState.selectedSpellWidget,
                            ClientState.selectedSpellChildIndex,
                            ClientState.selectedSpellItemId,
                        );
                        if (!selection) {
                            this.clearSelectedSpell();
                            return;
                        }

                        console.log(
                            `[OsrsClient] Spell-on-item: spell="${ClientState.selectedSpellName}" (group=${selection.spellbookGroupId}, child=${selection.widgetChildId}) -> item=${targetItemId}, slot=${targetSlot}`,
                        );

                        if (isServerConnected()) {
                            queuePacket(
                                createSelectedSpellOnWidgetPacket(
                                    targetWidgetUid,
                                    targetSlot,
                                    targetItemId,
                                    selection,
                                ),
                            );
                        }

                        // Clear spell selection after use
                        this.clearSelectedSpell();
                        return;
                    }
                }
            }

            // Handle item "Use" action - enter item targeting mode
            // When user clicks "Use" on an inventory item, the item should get selected
            // and show a white outline until another target is selected
            const optionLower = (event.option || "").toLowerCase();
            const targetItemId = event.itemId ?? event.widget.itemId ?? -1;
            const isInventoryItem = targetItemId >= 0 || groupId === 149;

            if (isInventoryItem && optionLower === "use") {
                const targetSlot = event.slot ?? event.widget.childIndex ?? childId;
                const containerUid = event.widget.parentUid ?? event.widget.uid;

                // Enter item targeting mode
                ClientState.isItemSelected = 1;
                ClientState.selectedItemWidget = containerUid;
                ClientState.selectedItemSlot = targetSlot;
                ClientState.selectedItemId = targetItemId;

                // Also set spell selection state for targeting cursor display
                ClientState.isSpellSelected = true;
                ClientState.selectedSpellWidget = containerUid;
                ClientState.selectedSpellChildIndex = targetSlot;
                ClientState.selectedSpellItemId = targetItemId;
                ClientState.selectedSpellActionName = "Use";
                ClientState.selectedSpellName = event.target || event.widget.name || "";
                ClientState.spellTargetEnteredFrame = Date.now();
                // OSRS parity: Items can target NPCs, objects, ground items, players, and widgets
                // Set targetMask with all target types enabled (bits 11-16)
                ClientState.selectedSpellTargetMask = 0x3f; // All 6 target type bits

                console.log(
                    `[OsrsClient] Entered item targeting mode: containerUid=${containerUid}, slot=${targetSlot}, itemId=${targetItemId}, name="${
                        ClientState.selectedSpellName
                    }", targetMask=0x${ClientState.selectedSpellTargetMask.toString(16)}`,
                );

                // Don't proceed with normal action dispatch - we're in targeting mode now
                return;
            }

            // Handle inventory item actions that should go via inventory_use message
            // These need special routing to handleInventoryUseMessage on the server
            const inventoryItemActions = [
                "drop",
                "eat",
                "drink",
                "wear",
                "wield",
                "equip",
                "bury",
                "light",
                "read",
                "open",
                "empty",
                "destroy",
                "rub",
                "commune",
                "fill",
                "craft",
                "check",
            ];
            if (isInventoryItem && inventoryItemActions.includes(optionLower)) {
                const targetSlot = event.slot ?? event.widget.childIndex ?? childId;
                const quantity = event.widget.itemQuantity ?? 1;
                console.log(
                    `[OsrsClient] Inventory action: ${event.option} on slot=${targetSlot}, itemId=${targetItemId}`,
                );
                sendInventoryUse(targetSlot, targetItemId, quantity, event.option);
                return;
            }

            // Handle spell/item targeting mode - if widget has targetVerb, enter targeting mode
            // This matches OSRS behavior where clicking a spell with buttonType=2 enters targeting
            // Also handle spellbook (group 218) widgets as a fallback since CS2 scripts may not set targetVerb
            let targetVerb = event.widget.targetVerb || event.widget.spellActionName;
            const isSpellbookWidget = groupId === 218 && childId > 0;

            // OSRS parity: Only enter targeting mode if targetMask > 0 (spell needs a target)
            // Teleport spells have targetMask === 0 and should cast immediately
            const targetMask = this.getWidgetTargetMask(event.widget);
            const needsTarget = targetMask > 0;

            // No-target spells (teleports) send IF_BUTTON1 directly.
            // OSRS parity: spellbook op1 routes through widget button packets.
            if (
                isSpellbookWidget &&
                !needsTarget &&
                targetVerb &&
                (event.widget.name || event.widget.opBase || event.widget.spriteId >= 0)
            ) {
                sendWidgetAction({
                    widgetId: ((groupId & 0xffff) << 16) | (childId & 0xffff),
                    groupId: groupId | 0,
                    childId: childId | 0,
                    option: "Cast",
                    target: event.target || event.widget.name || event.widget.opBase || "",
                    opId: 1,
                });
                return;
            }

            // Deob parity: Widget_getSpellActionName can be null, and client stores literal "null".
            if (!targetVerb && isSpellbookWidget && needsTarget) {
                targetVerb = "null";
            }

            if (
                targetVerb &&
                typeof targetVerb === "string" &&
                targetVerb.length > 0 &&
                needsTarget
            ) {
                // Get the import for ClientState
                const { ClientState } = require("./ClientState");

                // OSRS parity: Clicking the currently selected spell deselects it.
                if (
                    ClientState.isSpellSelected &&
                    ClientState.selectedSpellWidget === event.widget.uid
                ) {
                    console.log(
                        `[OsrsClient] Spell widget re-clicked while active, clearing selection: widget=${event.widget.uid}`,
                    );
                    this.clearSelectedSpell();
                    return;
                }

                // Enter targeting mode
                ClientState.clearItemSelection();
                try {
                    this.inventory?.setSelectedSlot?.(null);
                } catch {}
                ClientState.isSpellSelected = true;
                ClientState.selectedSpellWidget = event.widget.uid;
                ClientState.selectedSpellChildIndex = childId;
                ClientState.selectedSpellItemId = event.itemId ?? -1;
                ClientState.selectedSpellActionName = targetVerb;
                // OSRS uses widget.dataText for spell name display (e.g., "Wind Strike")
                // Also check opBase which CS2 sets for spells (contains colored spell name)
                ClientState.selectedSpellName =
                    event.widget.opBase ||
                    event.widget.dataText ||
                    event.widget.name ||
                    event.target ||
                    "";
                // Track when spell targeting was entered to prevent casting on same click
                ClientState.spellTargetEnteredFrame = Date.now();
                // OSRS parity: Store the spell's target mask (what entity types it can target)
                // This is stored in bits 11-16 of the current widget flags.
                ClientState.selectedSpellTargetMask = targetMask;

                console.log(
                    `[OsrsClient] Entered spell targeting mode: widget=${
                        event.widget.uid
                    }, verb="${targetVerb}", name="${
                        ClientState.selectedSpellName
                    }", group=${groupId}, child=${childId}, targetMask=0x${ClientState.selectedSpellTargetMask.toString(
                        16,
                    )}`,
                );

                // Fire onTargetEnter on the source widget (OSRS parity - use widget child ID, not hardcoded spell ID)
                this.setSelectedSpell(
                    {
                        spellId: childId, // Widget child ID is the spell identifier
                        spellName: ClientState.selectedSpellName,
                        spellLevel: 1,
                    },
                    event.widget,
                );

                // Don't proceed with normal action dispatch - we're in targeting mode now
                return;
            }
        }

        // OSRS parity: Handle pause button widgets
        // When a widget with buttonText "Continue" or text containing "click here to continue"
        // is clicked, send RESUME_PAUSEBUTTON packet.
        // This handles dialog continue buttons like:
        // - Level up interface (233:3)
        // - NPC dialog continue buttons
        // - Quest dialog continue buttons
        // NOTE: Flag bit 0 (IF_OP1) just means "clickable" - it does NOT indicate pause button.
        // Dialog options (219) have IF_OP1 set but should send widget_action, not pause button.
        if (event.widget) {
            // Check for IF1 buttonText "Continue" (set by WidgetLoader for buttonType 6)
            const buttonText = String(event.widget.buttonText || "")
                .replace(/<[^>]+>/g, "")
                .toLowerCase();
            const isContinueButtonText = buttonText === "continue";
            // Check widget text for "click here to continue" (for IF3 widgets like level up 233:3)
            const widgetText = String(event.widget.text || "")
                .replace(/<[^>]+>/g, "")
                .toLowerCase();
            const hasClickToContinue =
                widgetText.includes("click") && widgetText.includes("continue");

            const isPauseButtonWidget = isContinueButtonText || hasClickToContinue;

            if (isPauseButtonWidget) {
                // OSRS parity: Only send if not already waiting for response
                if (this.widgetManager?.meslayerContinueWidget === null) {
                    const widgetUid =
                        (typeof (event.widget as any).id === "number"
                            ? (event.widget as any).id
                            : event.widget.uid ?? 0) | 0;
                    const childIndex =
                        (typeof event.widget.childIndex === "number" &&
                        (event.widget.childIndex | 0) >= 0
                            ? event.widget.childIndex | 0
                            : typeof event.widget.fileId === "number" && event.widget.fileId >= 0
                            ? event.widget.fileId | 0
                            : widgetUid & 0xffff) | 0;
                    const pkt = createPacket(ClientPacketId.RESUME_PAUSEBUTTON);
                    pkt.packetBuffer.writeShortAddLE(childIndex);
                    pkt.packetBuffer.writeInt(widgetUid);
                    queuePacket(pkt);
                    // OSRS parity: Set meslayerContinueWidget to show "Please wait..."
                    if (this.widgetManager) {
                        this.widgetManager.meslayerContinueWidget = event.widget;
                        this.widgetManager.invalidateWidgetRender(event.widget);
                    }
                    console.log(
                        `[OsrsClient] Pause button clicked: widget=${widgetUid}, childIndex=${childIndex}, buttonText=${isContinueButtonText}, textMatch=${hasClickToContinue}`,
                    );
                }
                return; // Pause button widgets don't process other actions
            }
        }

        // CS2 Event Hooks
        // OSRS parity: Skip CS2 handler invocation for primary clicks if game loop already handled it
        // This prevents double-invocation when:
        // 1. Game loop fires onClick/onOp on mousedown (non-draggable widgets)
        // 2. UI registry fires handleWidgetAction on mouseup
        const skipCs2Handlers =
            event.source === "primary" &&
            this.clickedWidgetHandled &&
            event.widget?.uid === this.clickedWidget?.uid;
        const meslayerBeforeAction = this.widgetManager?.meslayerContinueWidget ?? null;

        if (event.widget && !skipCs2Handlers) {
            let handled = false;

            // Determine the op index (1-based) for onOp handlers
            const opIndex = this.inferWidgetOpId(event.widget, event.option) ?? 1;
            const widgetGroupId = event.widget.groupId ?? event.widget.uid >>> 16;

            // OSRS parity: CS2 event coords are relative to the widget ("event_mousex/y").
            // The GL UI dispatches absolute canvas coords; the main loop uses relative coords.
            // Prefer already-relative coords when they fit inside the widget bounds; otherwise
            // convert absolute coords using the widget's cached absolute position from rendering.
            let relMouseX = event.cursorX ?? 0;
            let relMouseY = event.cursorY ?? 0;
            try {
                const wAny: any = event.widget as any;
                const wW = (wAny?.width ?? 0) | 0;
                const wH = (wAny?.height ?? 0) | 0;
                const looksRelative =
                    relMouseX >= 0 && relMouseY >= 0 && relMouseX <= wW && relMouseY <= wH;
                if (
                    !looksRelative &&
                    typeof wAny?._absX === "number" &&
                    typeof wAny?._absY === "number"
                ) {
                    relMouseX = (event.cursorX ?? 0) - (wAny._absX | 0);
                    relMouseY = (event.cursorY ?? 0) - (wAny._absY | 0);
                }
            } catch {}

            // Create event context for magic number substitution
            const eventContext: Partial<ScriptEvent> = {
                mouseX: relMouseX,
                mouseY: relMouseY,
                opIndex,
                targetName: event.target ?? "",
            };

            // First, try new CS2 eventHandlers map from VM
            if (event.widget.eventHandlers) {
                const eventType = event.source === "menu" ? "onOp" : "onClick";
                handled = this.cs2Vm.invokeEventHandler(
                    event.widget,
                    eventType as any,
                    eventContext,
                );

                // If onClick didn't work, try onOp as fallback for primary clicks
                // Many widgets only define onOp even for left-click actions
                if (!handled && event.source === "primary" && event.widget.eventHandlers.onOp) {
                    handled = this.cs2Vm.invokeEventHandler(
                        event.widget,
                        "onOp" as any,
                        eventContext,
                    );
                }
            }

            // Fall back to old-style array-based handlers if not handled
            if (!handled) {
                let handler: any[] | undefined;
                if (event.source === "menu" && event.widget.onOp) {
                    handler = event.widget.onOp;
                } else if (event.widget.onClick) {
                    handler = event.widget.onClick;
                } else if (event.source === "primary" && event.widget.onOp) {
                    // Fallback: try onOp for primary clicks if no onClick
                    handler = event.widget.onOp;
                }

                if (handler) {
                    this.executeScriptListener(event.widget, handler, eventContext);
                }
            }
        }

        // If CS2 handler invoked cc_resume_pausebutton/if_resume_pausebutton, do not also send a
        // generic IF_BUTTON packet for the same click.
        const resumePauseTriggeredByHandler =
            meslayerBeforeAction === null &&
            (this.widgetManager?.meslayerContinueWidget ?? null) !== null;
        if (resumePauseTriggeredByHandler) {
            return;
        }

        // OSRS parity: widget onOp visuals happen client-side before packet handling.
        // Keep the league tutorial area highlights in sync on the same click frame.
        if (event.widget) {
            this.applyLeagueAreaTutorialHighlightPrediction(event.widget);
        }

        // OSRS parity: Withdraw-X and Deposit-X need to prompt for quantity
        const optionLower = event.option?.toLowerCase() ?? "";
        const isQuantityDialog = optionLower === "withdraw-x" || optionLower === "deposit-x";
        const widgetGroupId = event.widget?.groupId ?? event.widget?.uid >>> 16;
        const isBankInterface = widgetGroupId === 12 || widgetGroupId === 15;

        if (isQuantityDialog && isBankInterface) {
            // Store pending action for when input dialog completes
            const payload = this.buildWidgetActionPayload(event);
            if (payload) {
                this.pendingInputDialogAction = {
                    payload,
                    option: optionLower,
                };
                // Invoke chatbox_open_input script (2251) to open the chatbox input dialog
                const scriptEvent = createScriptEvent({
                    args: [2251], // Script ID for chatbox_open_input
                    widget: event.widget,
                });
                console.log(`[handleWidgetAction] Invoking chatbox_open_input for ${optionLower}`);
                const result = this.cs2Vm.runScriptEvent(scriptEvent);
                console.log(`[handleWidgetAction] Script execution result: ${result}`);

                // Manually enable key input capture (opcode 3138 sets field798=0 which allows all widgets to receive input)
                this.cs2Vm.inputDialogType = 0;
                this.cs2Vm.inputDialogString = "";
                this.varManager.setVarcString(335, "");
                console.log(
                    `[handleWidgetAction] inputDialogType set to: ${this.cs2Vm.inputDialogType}`,
                );
            }
            return;
        }

        try {
            const payload = this.buildWidgetActionPayload(event);
            if (!payload) return;

            // OSRS parity: Only transmit action to server if the transmit flag is set for this action
            // Reference: class59.java:733 - (flags >> (actionIndex + 1) & 1) != 0
            // If the transmit flag is not set, the action is client-side only (CS2 handlers)
            const widget = event.widget;
            if (widget) {
                const transmitFlagWidget = this.resolveTransmitFlagWidget(widget, payload);
                const flags =
                    this.widgetManager?.getWidgetFlags?.(transmitFlagWidget) ??
                    transmitFlagWidget?.flags ??
                    0;
                // opId is 1-indexed (1 = first action), actionIndex is 0-indexed
                // targetVerb returns opId=0, which corresponds to actionIndex=-1 (not in transmit range)
                const opId = payload.opId ?? 0;
                const actionIndex = opId > 0 ? opId - 1 : -1;

                // For actions 0-9 (opId 1-10), check the transmit flag
                // If actionIndex is -1 (targetVerb) or > 9, we don't check transmit flags
                if (actionIndex >= 0 && actionIndex <= 9) {
                    if (!shouldTransmitAction(flags, actionIndex)) {
                        // Action should not be transmitted - CS2 handler already ran above
                        const wId = (widget as any).id ?? widget.uid;
                        const wChildIndex = (widget as any).childIndex ?? -1;
                        const wGroupId = (wId >> 16) & 0xffff;
                        const wChildId = wId & 0xffff;
                        console.log(
                            `[OsrsClient] Widget action ${event.option} (op${opId}) not transmitted - transmit flag not set. ` +
                                `Widget: uid=${widget.uid}, id=${wId} (group=${wGroupId}, child=${wChildId}), childIndex=${wChildIndex}, flags=${flags}`,
                        );
                        return;
                    }
                }
            }

            sendWidgetAction(payload);
        } catch (err) {
            console.warn("[OsrsClient] widget action dispatch failed", err);
        }
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
        const widget = this.widgetManager.getWidgetByUid(widgetUid | 0) ?? null;
        this.cs2Vm.activeWidget = widget;
        try {
            console.log(`[${phase}_script] Running script ${scriptId} on widget ${widgetUid}`);
            this.cs2Vm.run(script, this.substituteWidgetScriptMagicArgs(intArgs, widget), strArgs);
        } finally {
            this.cs2Vm.activeWidget = prevActiveWidget;
        }
    }

    private getItemSpawnerWidgetUid(componentId: number): number {
        return ((ITEM_SPAWNER_MODAL_GROUP_ID & 0xffff) << 16) | (componentId & 0xffff);
    }

    private getItemSpawnerQueryWidgetUid(): number {
        return this.getItemSpawnerWidgetUid(ITEM_SPAWNER_MODAL_COMPONENT_QUERY);
    }

    private getItemSpawnerSearchBackgroundWidgetUid(): number {
        return this.getItemSpawnerWidgetUid(ITEM_SPAWNER_MODAL_COMPONENT_SEARCH_BACKGROUND);
    }

    private getItemSpawnerHelperWidgetUid(): number {
        return this.getItemSpawnerWidgetUid(ITEM_SPAWNER_MODAL_COMPONENT_HELPER);
    }

    private getItemSpawnerSummaryWidgetUid(): number {
        return this.getItemSpawnerWidgetUid(ITEM_SPAWNER_MODAL_COMPONENT_SUMMARY);
    }

    private getItemSpawnerResultsViewWidgetUid(): number {
        return this.getItemSpawnerWidgetUid(ITEM_SPAWNER_MODAL_COMPONENT_RESULTS_VIEW);
    }

    private getItemSpawnerResultsScrollbarWidgetUid(): number {
        return this.getItemSpawnerWidgetUid(ITEM_SPAWNER_MODAL_COMPONENT_RESULTS_SCROLLBAR);
    }

    private getItemSpawnerSlotBackgroundWidgetUid(slotIndex: number): number {
        return this.getItemSpawnerWidgetUid(ITEM_SPAWNER_MODAL_COMPONENT_SLOT_BACKGROUND_START + slotIndex);
    }

    private getItemSpawnerSlotIconWidgetUid(slotIndex: number): number {
        return this.getItemSpawnerWidgetUid(ITEM_SPAWNER_MODAL_COMPONENT_SLOT_ICON_START + slotIndex);
    }

    private isItemSpawnerModalMounted(): boolean {
        return (
            (this.widgetManager?.getInterfaceParentContainerUid(ITEM_SPAWNER_MODAL_GROUP_ID) ??
                undefined) !== undefined
        );
    }

    private isItemSpawnerSearchComponent(componentId: number): boolean {
        const normalized = componentId | 0;
        return (
            normalized === ITEM_SPAWNER_MODAL_COMPONENT_QUERY ||
            normalized === ITEM_SPAWNER_MODAL_COMPONENT_SEARCH_BACKGROUND
        );
    }

    private escapeItemSpawnerSearchText(value: string): string {
        return String(value ?? "").replace(/[<>]/g, "");
    }

    private getItemSpawnerSearchIndex(): CacheItemSearchIndex | undefined {
        if (!this.objTypeLoader) {
            return undefined;
        }
        if (!this.itemSpawnerSearchIndex) {
            this.itemSpawnerSearchIndex = new CacheItemSearchIndex(this.objTypeLoader);
        }
        return this.itemSpawnerSearchIndex;
    }

    private setItemSpawnerWidgetText(widgetUid: number, text: string): void {
        if (!this.widgetManager) {
            return;
        }
        const widget = this.widgetManager.getWidgetByUid(widgetUid);
        if (!widget || widget.text === text) {
            return;
        }
        widget.text = text;
        markWidgetInteractionDirty(widget);
        this.widgetManager.invalidateWidgetRender(widget);
    }

    private resolveItemSpawnerScrollbarGraphicId(token: string): number {
        let spriteIndex: any;
        try {
            spriteIndex = this.cacheSystem?.getIndex?.(IndexType.DAT2.sprites);
        } catch {
            spriteIndex = undefined;
        }
        if (!spriteIndex) {
            return -1;
        }

        const rawToken = String(token ?? "").trim();
        if (rawToken.length === 0) {
            return -1;
        }

        const directArchiveId = (spriteIndex as any).getArchiveId?.(rawToken);
        if (typeof directArchiveId === "number" && directArchiveId >= 0) {
            return directArchiveId | 0;
        }

        let archiveToken = rawToken;
        let frameIndex = 0;
        const commaIndex = rawToken.lastIndexOf(",");
        if (commaIndex >= 0 && commaIndex < rawToken.length - 1) {
            const candidateFrame = Number.parseInt(rawToken.slice(commaIndex + 1), 10);
            if (Number.isFinite(candidateFrame) && candidateFrame >= 0) {
                archiveToken = rawToken.slice(0, commaIndex);
                frameIndex = candidateFrame | 0;
            }
        }

        const archiveId = (spriteIndex as any).getArchiveId?.(archiveToken);
        if (!(typeof archiveId === "number") || archiveId < 0) {
            return -1;
        }

        return ((archiveId & 0xffff) << 16) | (frameIndex & 0xffff);
    }

    private formatItemSpawnerSearchText(): string {
        const query = this.escapeItemSpawnerSearchText(this.itemSpawnerSearchQuery);
        if (query.length === 0) {
            return this.itemSpawnerSearchFocused
                ? "<col=ffcf70>|</col>"
                : "<col=8f7f66>Search items...</col>";
        }
        return this.itemSpawnerSearchFocused
            ? `<col=e8ded0>${query}</col><col=ffcf70>|</col>`
            : `<col=e8ded0>${query}</col>`;
    }

    private syncItemSpawnerSearchWidgets(): void {
        if (!this.widgetManager) {
            return;
        }

        const queryWidget = this.widgetManager.getWidgetByUid(this.getItemSpawnerQueryWidgetUid());
        if (queryWidget) {
            queryWidget.text = this.formatItemSpawnerSearchText();
            markWidgetInteractionDirty(queryWidget);
            this.widgetManager.invalidateWidgetRender(queryWidget);
        }

        const backgroundWidget = this.widgetManager.getWidgetByUid(
            this.getItemSpawnerSearchBackgroundWidgetUid(),
        ) as any;
        if (backgroundWidget) {
            backgroundWidget.color = this.itemSpawnerSearchFocused ? 0x3a3125 : 0x2b241b;
            backgroundWidget.mouseOverColor = this.itemSpawnerSearchFocused ? 0x3a3125 : 0x342b20;
            markWidgetInteractionDirty(backgroundWidget);
            this.widgetManager.invalidateWidgetRender(backgroundWidget);
        }
    }

    private initializeItemSpawnerScrollView(): void {
        if (!this.widgetManager || !this.isItemSpawnerModalMounted()) {
            return;
        }

        const resultsView = this.widgetManager.getWidgetByUid(this.getItemSpawnerResultsViewWidgetUid()) as any;
        const scrollbar = this.widgetManager.getWidgetByUid(
            this.getItemSpawnerResultsScrollbarWidgetUid(),
        ) as any;
        if (!resultsView || !scrollbar) {
            return;
        }

        scrollbar.scrollBarTargetUid = resultsView.uid | 0;
        scrollbar.scrollBarAxis = "y";

        const hasScrollbarChildren =
            Array.isArray(scrollbar.children) && scrollbar.children.length >= 6;
        if (!hasScrollbarChildren) {
            const graphicIds = ITEM_SPAWNER_SCROLLBAR_GRAPHICS.map((token) =>
                this.resolveItemSpawnerScrollbarGraphicId(token),
            );
            if (graphicIds.some((id) => id < 0)) {
                return;
            }
            this.runWidgetScopedClientScript(
                scrollbar.uid | 0,
                ITEM_SPAWNER_SCROLLBAR_INIT_SCRIPT_ID,
                [scrollbar.uid | 0, resultsView.uid | 0, ...graphicIds],
                "run_script",
            );
        }

        this.widgetManager.invalidateWidget(scrollbar, "item-spawner-scrollbar-init");
    }

    private refreshItemSpawnerScrollbar(): void {
        if (!this.widgetManager || !this.isItemSpawnerModalMounted()) {
            return;
        }

        const resultsView = this.widgetManager.getWidgetByUid(this.getItemSpawnerResultsViewWidgetUid()) as any;
        const scrollbar = this.widgetManager.getWidgetByUid(
            this.getItemSpawnerResultsScrollbarWidgetUid(),
        ) as any;
        if (!resultsView || !scrollbar) {
            return;
        }

        this.initializeItemSpawnerScrollView();
        this.runWidgetScopedClientScript(
            scrollbar.uid | 0,
            ITEM_SPAWNER_SCROLLBAR_RESIZE_SCRIPT_ID,
            [scrollbar.uid | 0, resultsView.uid | 0, (resultsView.scrollY ?? 0) | 0],
            "run_script",
        );
        this.widgetManager.invalidateWidget(scrollbar, "item-spawner-scrollbar-resize");
    }

    private refreshItemSpawnerVisibleSlots(force: boolean = false): void {
        if (!this.widgetManager || !this.isItemSpawnerModalMounted()) {
            return;
        }

        const resultsView = this.widgetManager.getWidgetByUid(this.getItemSpawnerResultsViewWidgetUid()) as any;
        if (!resultsView) {
            return;
        }

        const scrollY = Math.max(0, (resultsView.scrollY ?? 0) | 0);
        const startRow = Math.max(0, Math.floor(scrollY / ITEM_SPAWNER_SLOT_PITCH_Y));
        if (
            !force &&
            startRow === this.itemSpawnerVisibleStartRow &&
            this.itemSpawnerRenderedResultsVersion === this.itemSpawnerSearchResultsVersion
        ) {
            return;
        }

        this.itemSpawnerVisibleStartRow = startRow;
        this.itemSpawnerRenderedResultsVersion = this.itemSpawnerSearchResultsVersion;

        for (let slotIndex = 0; slotIndex < ITEM_SPAWNER_MODAL_RESULT_SLOT_COUNT; slotIndex++) {
            const poolRow = Math.floor(slotIndex / ITEM_SPAWNER_MODAL_SLOT_COLUMNS);
            const column = slotIndex % ITEM_SPAWNER_MODAL_SLOT_COLUMNS;
            const resultRow = startRow + poolRow;
            const resultIndex = resultRow * ITEM_SPAWNER_MODAL_SLOT_COLUMNS + column;
            const result = this.itemSpawnerSearchResults[resultIndex];
            const backgroundWidget = this.widgetManager.getWidgetByUid(
                this.getItemSpawnerSlotBackgroundWidgetUid(slotIndex),
            ) as any;
            const iconWidget = this.widgetManager.getWidgetByUid(
                this.getItemSpawnerSlotIconWidgetUid(slotIndex),
            ) as any;
            if (!backgroundWidget || !iconWidget) {
                continue;
            }

            const backgroundRawY =
                ITEM_SPAWNER_SLOT_BACKGROUND_BASE_RAW_Y + resultRow * ITEM_SPAWNER_SLOT_PITCH_Y;
            const iconRawY = ITEM_SPAWNER_SLOT_ICON_BASE_RAW_Y + resultRow * ITEM_SPAWNER_SLOT_PITCH_Y;

            backgroundWidget.rawY = backgroundRawY;
            backgroundWidget.y = backgroundRawY;
            iconWidget.rawY = iconRawY;
            iconWidget.y = iconRawY;

            const hidden = !result;
            backgroundWidget.hidden = hidden;
            backgroundWidget.isHidden = hidden;
            iconWidget.hidden = hidden;
            iconWidget.isHidden = hidden;

            if (result) {
                const resultName = this.escapeItemSpawnerSearchText(result.name);
                iconWidget.itemId = result.itemId | 0;
                iconWidget.itemQuantity = 1;
                iconWidget.itemAmount = 1;
                iconWidget.text = `<col=ffcf70>${resultName}</col> <col=c5b79b>(id ${result.itemId})</col>`;
            } else {
                iconWidget.itemId = -1;
                iconWidget.itemQuantity = 0;
                iconWidget.itemAmount = 0;
                iconWidget.text = "";
            }

            markWidgetInteractionDirty(backgroundWidget);
            markWidgetInteractionDirty(iconWidget);
            this.widgetManager.invalidateWidgetRender(backgroundWidget);
            this.widgetManager.invalidateWidgetRender(iconWidget);
        }

        this.widgetManager.invalidateScroll(resultsView);
    }

    private refreshItemSpawnerSearchResults(resetScroll: boolean = false): void {
        if (!this.widgetManager || !this.isItemSpawnerModalMounted()) {
            return;
        }

        const resultsView = this.widgetManager.getWidgetByUid(this.getItemSpawnerResultsViewWidgetUid()) as any;
        if (!resultsView) {
            return;
        }

        const query = this.escapeItemSpawnerSearchText(this.itemSpawnerSearchQuery);
        const nextResults = query.length > 0 ? this.getItemSpawnerSearchIndex()?.search(query) ?? [] : [];
        this.itemSpawnerSearchResults = nextResults;
        this.itemSpawnerSearchResultsVersion++;

        const totalRows = Math.max(
            1,
            Math.ceil(nextResults.length / Math.max(1, ITEM_SPAWNER_MODAL_SLOT_COLUMNS)),
        );
        const viewHeight = Math.max(0, (resultsView.height ?? 0) | 0);
        const scrollHeight = Math.max(viewHeight, totalRows * ITEM_SPAWNER_SLOT_PITCH_Y);
        resultsView.scrollWidth = Math.max(0, (resultsView.width ?? 0) | 0);
        resultsView.scrollHeight = scrollHeight;

        const maxScrollY = Math.max(0, scrollHeight - viewHeight);
        const currentScrollY = (resultsView.scrollY ?? 0) | 0;
        resultsView.scrollY = resetScroll ? 0 : Math.min(Math.max(0, currentScrollY), maxScrollY);

        this.setItemSpawnerWidgetText(
            this.getItemSpawnerHelperWidgetUid(),
            "<col=c5b79b>Type to search cache items.</col>",
        );
        this.setItemSpawnerWidgetText(
            this.getItemSpawnerSummaryWidgetUid(),
            query.length === 0
                ? "<col=c5b79b>Start typing to filter cache item names.</col>"
                : nextResults.length > 0
                ? `Matches: <col=40ff40>${nextResults.length}</col>`
                : "<col=ff981f>No matches found in cache.</col>",
        );

        this.itemSpawnerVisibleStartRow = -1;
        this.itemSpawnerRenderedResultsVersion = -1;
        this.refreshItemSpawnerVisibleSlots(true);
        this.refreshItemSpawnerScrollbar();
        this.widgetManager.invalidateWidget(resultsView, "item-spawner-results");
    }

    private tickItemSpawnerSearchUi(): void {
        if (!this.isItemSpawnerModalMounted()) {
            return;
        }
        this.initializeItemSpawnerScrollView();
        this.refreshItemSpawnerVisibleSlots();
    }

    private setItemSpawnerSearchFocus(focused: boolean): void {
        this.itemSpawnerSearchFocused = !!focused && this.isItemSpawnerModalMounted();
        this.syncItemSpawnerSearchWidgets();
    }

    private clearItemSpawnerSearchState(): void {
        this.itemSpawnerSearchFocused = false;
        this.itemSpawnerSearchQuery = "";
        this.itemSpawnerSearchResults = [];
        this.itemSpawnerSearchResultsVersion = 0;
        this.itemSpawnerRenderedResultsVersion = -1;
        this.itemSpawnerVisibleStartRow = -1;
    }

    private handleItemSpawnerSearchKeyEvents(
        keyEvents: Array<{ keyTyped: number; keyPressed: number }>,
    ): boolean {
        if (!this.itemSpawnerSearchFocused) {
            return false;
        }
        if (!this.isItemSpawnerModalMounted()) {
            this.clearItemSpawnerSearchState();
            return false;
        }

        const OSRS_KEY_ENTER = 84;
        const OSRS_KEY_BACKSPACE = 85;
        const OSRS_KEY_ESCAPE = 13;
        let query = this.itemSpawnerSearchQuery;
        let changed = false;

        for (const keyEvent of keyEvents) {
            if ((keyEvent.keyTyped | 0) === OSRS_KEY_ESCAPE) {
                this.setItemSpawnerSearchFocus(false);
                continue;
            }
            if ((keyEvent.keyTyped | 0) === OSRS_KEY_ENTER) {
                continue;
            }
            if ((keyEvent.keyTyped | 0) === OSRS_KEY_BACKSPACE) {
                if (query.length > 0) {
                    query = query.slice(0, -1);
                    changed = true;
                }
                continue;
            }
            if ((keyEvent.keyPressed | 0) <= 0 || query.length >= 60) {
                continue;
            }

            const char = String.fromCharCode(keyEvent.keyPressed | 0);
            if (!/^[ -~]$/.test(char)) {
                continue;
            }
            query += char;
            changed = true;
        }

        if (changed) {
            this.itemSpawnerSearchQuery = query;
            this.syncItemSpawnerSearchWidgets();
            this.refreshItemSpawnerSearchResults(true);
        }

        return true;
    }

    private isLeagueKaramjaUnlockedLocally(): boolean {
        if (!this.varManager) return false;
        const varbits = [
            VARBIT_LEAGUE_AREA_SELECTION_0,
            VARBIT_LEAGUE_AREA_SELECTION_1,
            VARBIT_LEAGUE_AREA_SELECTION_2,
            VARBIT_LEAGUE_AREA_SELECTION_3,
            VARBIT_LEAGUE_AREA_SELECTION_4,
            VARBIT_LEAGUE_AREA_SELECTION_5,
        ];
        for (const varbitId of varbits) {
            const value = (this.varManager.getVarbit(varbitId) ?? 0) | 0;
            if (value === LEAGUE_AREAS_KARAMJA_REGION_ID) {
                return true;
            }
        }
        return false;
    }

    private applyLeagueAreaTutorialHighlightPrediction(widget: any): void {
        if (!widget || !this.varManager || !this.cs2Vm) return;
        const groupId = (widget.groupId ?? widget.uid >>> 16) | 0;
        if ((groupId & 0xffff) !== LEAGUE_AREAS_GROUP_ID) return;

        const childIdRaw =
            typeof widget.fileId === "number" && (widget.fileId | 0) >= 0
                ? widget.fileId | 0
                : (widget.uid | 0) & 0xffff;
        const childId = childIdRaw & 0xffff;
        if (
            childId !== LEAGUE_AREAS_CHILD_SELECT_BUTTON &&
            childId !== LEAGUE_AREAS_CHILD_SELECT_BACK &&
            childId !== LEAGUE_AREAS_CHILD_CANCEL_BUTTON
        ) {
            return;
        }

        const tutorialStep = (this.varManager.getVarbit(VARBIT_LEAGUE_TUTORIAL_COMPLETED) ?? 0) | 0;
        if (tutorialStep !== 7) return;
        if (this.isLeagueKaramjaUnlockedLocally()) return;

        const uidForAreasChild = (componentId: number) =>
            ((LEAGUE_AREAS_GROUP_ID & 0xffff) << 16) | (componentId & 0xffff);

        const clearHighlight = (highlightId: number) => {
            this.runClientScriptWithInts(SCRIPT_UI_HIGHLIGHT_CLEAR, [
                UI_HIGHLIGHT_KIND_LEAGUE_TUTORIAL,
                highlightId | 0,
            ]);
        };

        const addHighlight = (highlightId: number, targetUid: number) => {
            this.runClientScriptWithInts(SCRIPT_UI_HIGHLIGHT, [
                UI_HIGHLIGHT_KIND_LEAGUE_TUTORIAL,
                highlightId | 0,
                targetUid | 0,
                -1,
                UI_HIGHLIGHT_STYLE_DEFAULT,
                0,
            ]);
        };

        if (childId === LEAGUE_AREAS_CHILD_SELECT_BUTTON) {
            clearHighlight(UI_HIGHLIGHT_ID_KARAMJA_SHIELD);
            addHighlight(
                UI_HIGHLIGHT_ID_UNLOCK_BUTTON,
                uidForAreasChild(LEAGUE_AREAS_CHILD_CONFIRM_BUTTON),
            );
            return;
        }

        if (childId === LEAGUE_AREAS_CHILD_CANCEL_BUTTON) {
            clearHighlight(UI_HIGHLIGHT_ID_KARAMJA_SHIELD);
            addHighlight(
                UI_HIGHLIGHT_ID_UNLOCK_BUTTON,
                uidForAreasChild(LEAGUE_AREAS_CHILD_SELECT_BUTTON),
            );
            return;
        }

        if (childId === LEAGUE_AREAS_CHILD_SELECT_BACK) {
            clearHighlight(UI_HIGHLIGHT_ID_UNLOCK_BUTTON);
            addHighlight(
                UI_HIGHLIGHT_ID_KARAMJA_SHIELD,
                uidForAreasChild(LEAGUE_AREAS_CHILD_KARAMJA_SHIELD),
            );
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

                // OSRS parity: layoutWidgets needs to traverse static children via parentUid filtering
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
    }

    /**
     * Process onTimer event handlers for all widgets
     * Queues timer events to low-priority queue (processed after other events)
     * OSRS parity: traverses both static children (via parentUid) and dynamic children
     */
    private processWidgetTimers(): void {
        if (this.widgetManager.rootInterface === -1) return;
        const allRoots = this.widgetManager.getAllGroupRoots(this.widgetManager.rootInterface);
        if (!allRoots || allRoots.length === 0) return;

        const visited = new Set<number>();
        const stack: any[] = [];
        for (const r of allRoots) if (r) stack.push(r);

        // OSRS PARITY: Also process timers for InterfaceParent-mounted sub-interfaces.
        // In the official client these are traversed via the InterfaceParent draw/update path.
        for (const [containerUid, parent] of this.widgetManager.interfaceParents) {
            if (!parent) continue;
            // Skip if the container (or any of its ancestors) is hidden.
            if (this.widgetManager.isEffectivelyHidden(containerUid)) continue;
            if ((parent.group | 0) === (this.widgetManager.rootInterface | 0)) continue;
            const subRoots = this.widgetManager.getAllGroupRoots(parent.group);
            for (const r of subRoots) if (r) stack.push(r);
        }

        while (stack.length > 0) {
            const node = stack.pop();
            if (!node || typeof node !== "object") continue;
            const uid = (node.uid ?? 0) | 0;
            if (uid === 0 || visited.has(uid)) continue;
            visited.add(uid);
            if (node.hidden) continue;

            // Check for onTimer handler (from CS2 IF_SETONTIMER/CC_SETONTIMER)
            if (node.eventHandlers?.onTimer) {
                // Prefer the OSRS-style Object[] args array (kept in sync by Cs2Vm.setEventHandler*)
                // to preserve exact signature ordering (ints/strings can interleave).
                if (Array.isArray(node.onTimer) && node.onTimer.length > 0) {
                    const event = createScriptEvent({
                        widget: node,
                        args: node.onTimer,
                    });
                    this.queueScriptEvent(event, 1); // 1 = low priority (timer)
                } else {
                    // Fallback to structured handler data (ints then strings).
                    const handler = node.eventHandlers.onTimer;
                    if (handler && handler.scriptId > 0) {
                        const handlerObjectArgs =
                            handler.objectArgs ??
                            (handler.stringArgs ? [...handler.stringArgs] : []);
                        const event = createScriptEvent({
                            widget: node,
                            args: [handler.scriptId, ...handler.intArgs, ...handlerObjectArgs],
                        });
                        this.queueScriptEvent(event, 1); // 1 = low priority (timer)
                    }
                }
            }
            // Also check legacy array-style onTimer
            else if (Array.isArray(node.onTimer) && node.onTimer.length > 0) {
                const event = createScriptEvent({
                    widget: node,
                    args: node.onTimer,
                });
                this.queueScriptEvent(event, 1); // 1 = low priority (timer)
            }

            // OSRS parity: traverse static children (via parentUid filtering)
            const staticChildren = this.widgetManager.getStaticChildrenByParentUid(uid);
            for (let i = staticChildren.length - 1; i >= 0; i--) {
                stack.push(staticChildren[i]);
            }

            // Traverse dynamic children (from CC_CREATE)
            if (Array.isArray(node.children)) {
                for (let i = node.children.length - 1; i >= 0; i--) {
                    stack.push(node.children[i]);
                }
            }
        }
    }

    /**
     * OSRS PARITY: Process transmit handlers at the engine level.
     *
     * Instead of calling triggerChatTransmit/triggerMiscTransmit directly when events occur,
     * OSRS gates transmit handlers during widget tree updates by comparing global "event cycles"
     * to per-widget timestamps.
     *
     * Reference: WorldMapRegion.java ~line 1806 (updateRootInterface)
     *
     * For each widget:
     * 1. If chatCycle > widget.lastTransmitCycle && widget.onChatTransmit exists → queue event
     * 2. If statCycle > widget.lastTransmitCycle && widget.onStatTransmit exists → queue event
     * 3. (repeat for all transmit types)
     * 4. Set widget.lastTransmitCycle = cycleCntr
     *
     * OSRS PARITY: All transmit handlers are QUEUED, not executed immediately.
     * This ensures cycleCntr++ happens before scripts run.
     */
    private processWidgetTransmits(): void {
        if (this.widgetManager.rootInterface === -1) return;

        // Performance optimization: skip traversal if no events and no new widgets
        if (!isTransmitProcessingNeeded()) {
            return;
        }

        const cycles = this.transmitCycles;
        // OSRS PARITY: All transmit types with triggers (var, inv, stat) now use counter-based
        // tracking. No snapshots needed - counters are monotonically increasing and never cleared.
        const allRoots = this.widgetManager.getAllGroupRoots(this.widgetManager.rootInterface);
        if (!allRoots || allRoots.length === 0) {
            resetTransmitDirtyFlags();
            return;
        }

        const visited = new Set<number>();
        const stack: any[] = [];
        for (const r of allRoots) if (r) stack.push(r);

        // OSRS PARITY: Also traverse InterfaceParent-mounted sub-interfaces so their transmit
        // handlers (var/inv/stat/chat/etc.) fire while the interface is open.
        for (const [containerUid, parent] of this.widgetManager.interfaceParents) {
            if (!parent) continue;
            if (this.widgetManager.isEffectivelyHidden(containerUid)) continue;
            if ((parent.group | 0) === (this.widgetManager.rootInterface | 0)) continue;
            const subRoots = this.widgetManager.getAllGroupRoots(parent.group);
            for (const r of subRoots) if (r) stack.push(r);
        }

        // Helper to queue a transmit event
        const queueTransmit = (node: any, handler: any, cacheHandler: any[]) => {
            // OSRS parity: Prefer the OSRS-style args array (Object[]) to preserve exact
            // signature ordering (ints/strings can interleave).
            if (Array.isArray(cacheHandler) && cacheHandler.length > 0) {
                const event = createScriptEvent({
                    args: cacheHandler,
                    widget: node,
                });
                this.queueScriptEvent(event, 0);
            } else if (handler) {
                // Fallback: structured handler data (ints then strings). This may differ from OSRS
                // if the signature interleaves types, but should only occur if args array is missing.
                const handlerObjectArgs =
                    handler.objectArgs ?? (handler.stringArgs ? [...handler.stringArgs] : []);
                const event = createScriptEvent({
                    args: [handler.scriptId, ...handler.intArgs, ...handlerObjectArgs],
                    widget: node,
                });
                this.queueScriptEvent(event, 0);
            }
        };

        // Helper to check if transmit should fire
        // OSRS PARITY: Fire if (eventCycle > lastCycle) OR (newly loaded widget AND event pending)
        const shouldFire = (eventCycle: number, lastCycle: number): boolean => {
            return eventCycle > -1 && (lastCycle === -1 || eventCycle > lastCycle);
        };

        while (stack.length > 0) {
            const node = stack.pop();
            if (!node || typeof node !== "object") continue;
            const uid = (node.uid ?? 0) | 0;
            if (uid === 0 || visited.has(uid)) continue;
            visited.add(uid);

            // Skip hidden widgets
            if (node.hidden || node.isHidden) continue;

            // Get widget's last processed cycle (default -1 for never processed)
            const lastCycle = node.lastTransmitCycle ?? -1;

            // onChatTransmit - fires for any chat message
            if (
                (node.onChatTransmit || node.eventHandlers?.onChatTransmit) &&
                shouldFire(cycles.chatCycle, lastCycle)
            ) {
                queueTransmit(node, node.eventHandlers?.onChatTransmit, node.onChatTransmit);
            }

            // onStatTransmit - check statTransmitTriggers if defined
            // OSRS PARITY: Use counter-based approach instead of cycle-based
            // - changedStatCount is monotonically increasing (never cleared)
            // - Widget tracks lastChangedStatCount - the count when handler last fired
            // - Fire if changedStatCount > lastChangedStatCount
            // - If triggers defined AND diff <= 32, scan circular buffer for matching triggers
            // - If no triggers OR diff > 32, fire unconditionally
            if (node.onStatTransmit || node.eventHandlers?.onStatTransmit) {
                const lastStatCount = node.lastChangedStatCount ?? 0;
                const currentStatCount = cycles.changedStatCount;

                if (currentStatCount > lastStatCount) {
                    let shouldFireStat = false;
                    const triggers = node.statTransmitTriggers;

                    if (triggers && triggers.length > 0 && currentStatCount - lastStatCount <= 32) {
                        // Scan circular buffer for matching triggers
                        scanStatLoop: for (let i = lastStatCount; i < currentStatCount; i++) {
                            const changedStatId = cycles.changedStatsBuffer[i & 31];
                            for (const triggerId of triggers) {
                                if (changedStatId === triggerId) {
                                    shouldFireStat = true;
                                    break scanStatLoop;
                                }
                            }
                        }
                    } else {
                        // No triggers OR > 32 changes since last fire - fire unconditionally
                        shouldFireStat = true;
                    }

                    if (shouldFireStat) {
                        queueTransmit(
                            node,
                            node.eventHandlers?.onStatTransmit,
                            node.onStatTransmit,
                        );
                    }

                    // Always update lastChangedStatCount, even if we didn't fire
                    node.lastChangedStatCount = currentStatCount;
                }
            }

            // onVarTransmit - check varTransmitTriggers if defined
            // OSRS PARITY: Use counter-based approach instead of cycle-based
            // Reference: WorldMapRegion.java lines 1728-1752
            // - changedVarpCount is monotonically increasing (never cleared)
            // - Widget tracks lastChangedVarpCount (field3842) - the count when handler last fired
            // - Fire if changedVarpCount > lastChangedVarpCount
            // - If triggers defined AND diff <= 32, scan circular buffer for matching triggers
            // - If no triggers OR diff > 32, fire unconditionally
            if (node.onVarTransmit || node.eventHandlers?.onVarTransmit) {
                const lastVarpCount = node.lastChangedVarpCount ?? 0;
                const currentVarpCount = cycles.changedVarpCount;

                if (currentVarpCount > lastVarpCount) {
                    let shouldFireVar = false;
                    const triggers = node.varTransmitTriggers;

                    if (triggers && triggers.length > 0 && currentVarpCount - lastVarpCount <= 32) {
                        // Scan circular buffer for matching triggers
                        scanLoop: for (let i = lastVarpCount; i < currentVarpCount; i++) {
                            const changedVarpId = cycles.changedVarps[i & 31];
                            for (const triggerId of triggers) {
                                if (changedVarpId === triggerId) {
                                    shouldFireVar = true;
                                    break scanLoop;
                                }
                            }
                        }
                    } else {
                        // No triggers OR > 32 changes since last fire - fire unconditionally
                        shouldFireVar = true;
                    }

                    if (shouldFireVar) {
                        queueTransmit(node, node.eventHandlers?.onVarTransmit, node.onVarTransmit);
                    }

                    // Always update lastChangedVarpCount, even if we didn't fire
                    // This prevents re-checking old changes on next tick
                    node.lastChangedVarpCount = currentVarpCount;
                }
            }

            // onInvTransmit - check invTransmitTriggers if defined
            // OSRS PARITY: Use counter-based approach instead of cycle-based
            // - changedInvCount is monotonically increasing (never cleared)
            // - Widget tracks lastChangedInvCount - the count when handler last fired
            // - Fire if changedInvCount > lastChangedInvCount
            // - If triggers defined AND diff <= 32, scan circular buffer for matching triggers
            // - If no triggers OR diff > 32, fire unconditionally
            if (node.onInvTransmit || node.eventHandlers?.onInvTransmit) {
                const lastInvCount = node.lastChangedInvCount ?? 0;
                const currentInvCount = cycles.changedInvCount;

                if (currentInvCount > lastInvCount) {
                    let shouldFireInv = false;
                    const triggers = node.invTransmitTriggers;

                    if (triggers && triggers.length > 0 && currentInvCount - lastInvCount <= 32) {
                        // Scan circular buffer for matching triggers
                        scanInvLoop: for (let i = lastInvCount; i < currentInvCount; i++) {
                            const changedInvId = cycles.changedInvsBuffer[i & 31];
                            for (const triggerId of triggers) {
                                if (changedInvId === triggerId) {
                                    shouldFireInv = true;
                                    break scanInvLoop;
                                }
                            }
                        }
                    } else {
                        // No triggers OR > 32 changes since last fire - fire unconditionally
                        shouldFireInv = true;
                    }

                    if (shouldFireInv) {
                        queueTransmit(node, node.eventHandlers?.onInvTransmit, node.onInvTransmit);
                    }

                    // Always update lastChangedInvCount, even if we didn't fire
                    node.lastChangedInvCount = currentInvCount;
                }
            }

            // onMiscTransmit (varc changes, run energy, etc.) - no trigger array, fires for any misc change
            if (
                (node.onMiscTransmit || node.eventHandlers?.onMiscTransmit) &&
                shouldFire(cycles.miscCycle, lastCycle)
            ) {
                queueTransmit(node, node.eventHandlers?.onMiscTransmit, node.onMiscTransmit);
            }

            // onStockTransmit - fires when Grand Exchange offers update (no trigger array)
            if (
                (node.onStockTransmit || node.eventHandlers?.onStockTransmit) &&
                shouldFire(cycles.stockCycle, lastCycle)
            ) {
                queueTransmit(node, node.eventHandlers?.onStockTransmit, node.onStockTransmit);
            }

            // onFriendTransmit - no trigger array
            if (
                (node.onFriendTransmit || node.eventHandlers?.onFriendTransmit) &&
                shouldFire(cycles.friendCycle, lastCycle)
            ) {
                queueTransmit(node, node.eventHandlers?.onFriendTransmit, node.onFriendTransmit);
            }

            // onClanTransmit - no trigger array
            if (
                (node.onClanTransmit || node.eventHandlers?.onClanTransmit) &&
                shouldFire(cycles.clanCycle, lastCycle)
            ) {
                queueTransmit(node, node.eventHandlers?.onClanTransmit, node.onClanTransmit);
            }

            // onClanSettingsTransmit - no trigger array
            if (
                (node.onClanSettingsTransmit || node.eventHandlers?.onClanSettingsTransmit) &&
                shouldFire(cycles.clanSettingsCycle, lastCycle)
            ) {
                queueTransmit(
                    node,
                    node.eventHandlers?.onClanSettingsTransmit,
                    node.onClanSettingsTransmit,
                );
            }

            // onClanChannelTransmit - no trigger array
            if (
                (node.onClanChannelTransmit || node.eventHandlers?.onClanChannelTransmit) &&
                shouldFire(cycles.clanChannelCycle, lastCycle)
            ) {
                queueTransmit(
                    node,
                    node.eventHandlers?.onClanChannelTransmit,
                    node.onClanChannelTransmit,
                );
            }

            // Update widget's last processed cycle
            // OSRS: widget.field3836 = Client.cycleCntr
            node.lastTransmitCycle = cycles.cycleCntr;

            // Traverse static children
            const staticChildren = this.widgetManager.getStaticChildrenByParentUid(uid);
            for (let i = staticChildren.length - 1; i >= 0; i--) {
                stack.push(staticChildren[i]);
            }

            // Traverse dynamic children
            if (Array.isArray(node.children)) {
                for (let i = node.children.length - 1; i >= 0; i--) {
                    stack.push(node.children[i]);
                }
            }
        }

        // Reset dirty flags after processing
        resetTransmitDirtyFlags();
    }

    /**
     * Apply master volume multiplier to all audio systems.
     * Called when master volume changes (deviceoption 19).
     * The actual volume = individual volume * master volume.
     */
    private applyMasterVolume(): void {
        const master = this.masterVolume;
        if (this.musicSystem) {
            this.musicSystem.setVolume(this._musicVolume * master);
        }
        if (this.soundEffectSystem) {
            this.soundEffectSystem.setVolume(this._sfxVolume * master);
            this.soundEffectSystem.setAmbientVolume(this._ambientVolume * master);
        }
    }

    private applyAudioVarpChange(varpId: number, value: number): void {
        const percent = clamp(value | 0, 0, 100);
        const curved = Math.round((percent * percent) / 100);

        if (varpId === VARP_MUSIC_VOLUME) {
            const scaled = Math.round((curved * 255) / 100);
            this._musicVolume = Math.max(0, Math.min(1, scaled / 255));
            if (this.musicSystem) {
                this.musicSystem.setVolume(this._musicVolume * this.masterVolume);
            }
            return;
        }

        if (varpId === VARP_SOUND_EFFECTS_VOLUME) {
            const scaled = Math.round((curved * 127) / 100);
            this._sfxVolume = Math.max(0, Math.min(1, scaled / 127));
            if (this.soundEffectSystem) {
                this.soundEffectSystem.setVolume(this._sfxVolume * this.masterVolume);
            }
            return;
        }

        if (varpId === VARP_AREA_SOUNDS_VOLUME) {
            const scaled = Math.round((curved * 127) / 100);
            this._ambientVolume = Math.max(0, Math.min(1, scaled / 127));
            if (this.soundEffectSystem) {
                this.soundEffectSystem.setAmbientVolume(this._ambientVolume * this.masterVolume);
            }
            return;
        }

        if (varpId === VARP_MASTER_VOLUME) {
            this.masterVolume = Math.max(0, Math.min(1, curved / 100));
            this.applyMasterVolume();
        }
    }

    /**
     * Trigger initial onVarTransmit handlers for widgets in a group.
     * OSRS parity: When a widget with varTransmitTriggers loads, its onVarTransmit
     * handler should fire immediately with current varp values, not wait for changes.
     * This ensures prayer buttons show correct state when the prayer tab first opens.
     */
    triggerInitialVarTransmitForGroup(groupId: number): void {
        const instance = this.widgetManager.getGroup(groupId);
        if (!instance) return;

        const currentVarpCount = this.transmitCycles.changedVarpCount | 0;

        const allRoots = this.widgetManager.getAllGroupRoots(groupId);
        const stack: any[] = [...allRoots];
        while (stack.length > 0) {
            const node = stack.pop();
            if (!node || typeof node !== "object") continue;

            // Check if widget has varTransmitTriggers (listens for varp changes)
            const triggers = node.varTransmitTriggers as number[] | undefined;
            if (triggers && triggers.length > 0) {
                // Fire onVarTransmit handler once for initial state
                if (node.eventHandlers?.onVarTransmit) {
                    this.cs2Vm.invokeEventHandler(node, "onVarTransmit");
                } else if (Array.isArray(node.onVarTransmit) && node.onVarTransmit.length > 0) {
                    this.executeScriptListener(node, node.onVarTransmit);
                }
                // Keep counter-based var transmit dedupe in sync with the current global count.
                // Without this, the same handler is re-queued on the next tick from stale history.
                node.lastChangedVarpCount = currentVarpCount;
            }

            // Traverse static children
            const staticChildren = this.widgetManager.getStaticChildrenByParentUid(node.uid);
            for (let i = staticChildren.length - 1; i >= 0; i--) {
                stack.push(staticChildren[i]);
            }

            // Traverse dynamic children
            if (Array.isArray(node.children)) {
                for (let i = node.children.length - 1; i >= 0; i--) {
                    stack.push(node.children[i]);
                }
            }
        }
    }

    /**
     * Trigger onInvTransmit handlers for widgets in a group.
     *
     * This is used for server-authored inventory containers like the bank (95),
     * where the backing container can update after interface onLoad has already
     * installed transmit handlers. Forcing the group's inventory transmit once
     * keeps large scripted interfaces in sync with the latest container state.
     */
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
     * OSRS parity: Ensure notification_display (interface 660) is mounted into the toplevel
     * notifications container for the current root interface.
     *
     * This container is used by CS2 scripts like notification_positioning (3351) and
     * notification_display_init (3343) which assume a 178x100 host area.
     */
    private ensureNotificationDisplayMounted(rootGroupId?: number): void {
        if (!this.widgetManager) return;

        const root = (rootGroupId ?? this.widgetManager.rootInterface) | 0;
        if (root === -1) return;

        const targetUid = this.findNotificationsContainerUid(root);
        if (targetUid === null) return;

        const mounted = this.widgetManager.getSubInterface(targetUid);
        if (mounted && (mounted.group | 0) === 660) {
            return;
        }

        this.widgetManager.openSubInterface(targetUid, 660, 1);
        this.triggerInitialVarTransmitForGroup(660);

        // OSRS parity: toplevel_init calls notification_init(notificationsComponent) which
        // installs notification_positioning timers when a layer is present. Since we mount
        // on-demand, run the proc here so positioning/anchoring matches OSRS.
        try {
            const NOTIFICATION_INIT = 3349;
            const init = this.cs2Vm?.context?.loadScript?.(NOTIFICATION_INIT);
            if (init) {
                this.cs2Vm.run(init, [targetUid], []);
            }
        } catch (e) {
            // Non-fatal: 3343 will still position the notification container.
        }
    }

    /**
     * Find the toplevel notifications container widget UID for a root interface.
     * Expected properties (cache/script): type=0, rawWidth=178, rawHeight=100, rawX=0, rawY=10.
     */
    private findNotificationsContainerUid(rootGroupId: number): number | null {
        if (!this.widgetManager) return null;
        const instance = this.widgetManager.getGroup(rootGroupId);
        if (!instance) return null;

        // Fast path: known IDs for common root interfaces (R235 cache).
        // - 161:13 toplevel_osrs_stretch:notifications
        // - 164:13 toplevel_resizable_classic:notifications
        // - 548:44 toplevel_fixed:notifications
        // - 601:17 toplevel_mobile:notifications
        if (rootGroupId === 161 || rootGroupId === 164) {
            const uid = (rootGroupId << 16) | 13;
            if (this.widgetManager.getWidgetByUid(uid)) return uid;
        } else if (rootGroupId === 548) {
            const uid = (rootGroupId << 16) | 44;
            if (this.widgetManager.getWidgetByUid(uid)) return uid;
        } else if (rootGroupId === 601) {
            const uid = (rootGroupId << 16) | 17;
            if (this.widgetManager.getWidgetByUid(uid)) return uid;
        }

        // Fallback: scan the group for a widget that matches the notification host dimensions.
        // This avoids hard dependency on file IDs while still matching OSRS assumptions.
        for (const w of instance.widgetsByUid.values()) {
            if (!w || ((w.type ?? 0) | 0) !== 0) continue;
            if (((w.rawWidth ?? 0) | 0) !== 178) continue;
            if (((w.rawHeight ?? 0) | 0) !== 100) continue;
            if (((w.rawX ?? 0) | 0) !== 0) continue;
            if (((w.rawY ?? 0) | 0) !== 10) continue;
            if (((w.xPositionMode ?? 0) | 0) !== 1) continue;
            const yMode = (w.yPositionMode ?? 0) | 0;
            if (yMode !== 0 && yMode !== 2) continue;
            return (w.uid ?? 0) | 0;
        }

        return null;
    }

    private getWorldClickBlockingWidgetAtPoint(px: number, py: number): any | null {
        if (this.clickedWidget !== null) {
            return this.clickedWidget;
        }

        if (this.widgetManager.rootInterface === -1) {
            return null;
        }

        const allRoots = this.widgetManager.getAllGroupRoots(this.widgetManager.rootInterface);
        if (allRoots.length === 0) {
            return null;
        }

        const visibleMap = new Map<number, boolean>();
        const getStaticChildren = (uid: number) =>
            this.widgetManager.getStaticChildrenByParentUid(uid);
        const getInterfaceParentRoots = (containerUid: number): any[] => {
            const group = this.widgetManager.interfaceParents.get(containerUid)?.group;
            return typeof group === "number" ? this.widgetManager.getAllGroupRoots(group) : [];
        };
        const isInputCaptureWidget = (uid: number): boolean => {
            const parent = this.widgetManager.interfaceParents.get(uid);
            return !!parent && (parent.type | 0) === 0;
        };

        const hits = collectWidgetsAtPointAcrossRoots(
            allRoots,
            px,
            py,
            visibleMap,
            getStaticChildren,
            getInterfaceParentRoots,
            isInputCaptureWidget,
        );
        return findBlockingWidgetInHits(hits, {
            isInputCaptureWidget,
            getWidgetFlags: (widget) => this.widgetManager?.getWidgetFlags(widget) ?? 0,
            getWidgetByUid: (uid) => this.widgetManager?.getWidgetByUid(uid),
        });
    }

    /**
     * Check if a point is over UI that should consume a world click.
     * Used by WebGLOsrsRenderer for widgets with actual click-capture traits.
     *
     * @param px - X coordinate in screen pixels
     * @param py - Y coordinate in screen pixels
     * @returns true if the UI at this point should consume the click
     */
    isPointOverWidget(px: number, py: number): boolean {
        return this.getWorldClickBlockingWidgetAtPoint(px, py) !== null;
    }

    handleUiInput() {
        const input = this.inputManager;
        const mx = input.mouseX;
        const my = input.mouseY;

        // Get ALL roots in the same stacking order as rendering.
        // Base roots (rootInterface) first, then session-managed roots (bank/dialogs/etc.).
        const allRoots: any[] = [];
        const baseRoots = this.widgetManager.getAllGroupRoots(this.widgetManager.rootInterface);
        allRoots.push(...baseRoots);
        if (allRoots.length === 0) return;

        // Input picking treats widgets as visible unless explicitly hidden.
        const visibleMap = new Map<number, boolean>();

        // OSRS PARITY: While a widget is clicked/held, it is invalidated every frame so it can be
        // rendered semi-transparent (and to support drag visuals).
        // Reference: Client.method1282() -> FaceNormal.invalidateWidget(clickedWidget)
        if (this.clickedWidget) {
            this.widgetManager.invalidateWidgetRender(this.clickedWidget);
        }

        // OSRS parity: callback for static children lookup
        const getStaticChildren = (uid: number) =>
            this.widgetManager.getStaticChildrenByParentUid(uid);

        // OSRS parity: callback for InterfaceParent lookup (scrollbar widgets shouldn't scroll)
        const getInterfaceParentRoots = (containerUid: number): any[] => {
            const group = this.widgetManager.interfaceParents.get(containerUid)?.group;
            return typeof group === "number" ? this.widgetManager.getAllGroupRoots(group) : [];
        };
        const isInputCaptureWidget = (uid: number): boolean => {
            const parent = this.widgetManager.interfaceParents.get(uid);
            return !!parent && (parent.type | 0) === 0;
        };

        // OSRS parity: widget flags accessor with runtime overrides applied.
        const getWidgetFlags = (w: any): number => this.widgetManager.getWidgetFlags(w);

        // OSRS parity: Primary click should use the same default entry selection rules as the menu.
        const getPrimaryWidgetAction = (
            w: any,
        ): { option: string; target: string; slot?: number; itemId?: number } => {
            const uid = typeof w?.uid === "number" ? w.uid | 0 : 0;
            const ids = this.resolveWidgetIdentifiers(w);
            const resolvedWidgetId = (ids?.widgetId ?? uid) | 0;
            const resolvedGroupId =
                (ids?.groupId ??
                    (typeof w?.groupId === "number" ? w.groupId | 0 : (uid >>> 16) | 0)) | 0;
            // For dynamic children (fileId === -1), widgetId refers to the PARENT widget id.
            const resolvedFileId = resolvedWidgetId & 0xffff;

            // Prefer deriving options from the parent widget for dynamic children only when the parent
            // holds the ops (e.g., equipped item icons inside equipment slot components).
            // OSRS parity: For dynamic children (fileId=-1), check if parent has menu ops.
            // Reference: HealthBarUpdate.method2496 - menu options show if transmit flag OR onOp handler.
            // Must check actions, targetVerb, AND onOp handler (not just actions/targetVerb).
            const menuWidget = (() => {
                const isDynamic = (w?.fileId | 0) === -1;
                const parentUid = (w as any)?.parentUid;
                if (isDynamic && typeof parentUid === "number" && parentUid !== -1) {
                    const parent = this.widgetManager?.getWidgetByUid?.(parentUid);
                    if (parent) {
                        const parentHasOps =
                            (Array.isArray((parent as any).actions) &&
                                (parent as any).actions.some((a: any) => !!sanitizeText(a))) ||
                            !!sanitizeText((parent as any).targetVerb) ||
                            (this.getWidgetTargetMask(parent) > 0 &&
                                !!sanitizeText((parent as any).spellActionName)) ||
                            !!((parent as any).onOp || (parent as any).eventHandlers?.onOp);
                        const selfHasOps =
                            (Array.isArray((w as any).actions) &&
                                (w as any).actions.some((a: any) => !!sanitizeText(a))) ||
                            !!sanitizeText((w as any).targetVerb) ||
                            (this.getWidgetTargetMask(w) > 0 &&
                                !!sanitizeText((w as any).spellActionName)) ||
                            !!((w as any).onOp || (w as any).eventHandlers?.onOp);
                        if (parentHasOps && !selfHasOps) return parent;
                    }
                }
                return w;
            })();

            let entryOption: string | undefined;
            let entryTarget: string | undefined;
            const getWidgetByUidLocal = (uid: number) => this.widgetManager?.getWidgetByUid(uid);
            try {
                const derived = deriveMenuEntriesForWidget(
                    menuWidget,
                    false,
                    getWidgetFlags,
                    getWidgetByUidLocal,
                ) as any[];

                // Fallback: pick the first actionable entry from the derived list (matches hover label).
                const fallback = Array.isArray(derived)
                    ? derived.find((e) => {
                          const lower = String(e?.option || "").toLowerCase();
                          return (
                              lower &&
                              lower !== "cancel" &&
                              lower !== "examine" &&
                              lower !== "inspect" &&
                              lower !== "walk here"
                          );
                      })
                    : undefined;
                if (fallback?.option) {
                    entryOption = String(fallback.option);
                    entryTarget = fallback.target;
                }

                // Widget menu entries are already in OSRS display order (top-to-bottom).
                // normalizeMenuEntries expects OSRS insertion order and would reverse widget ops
                // (e.g., minimap orbs), breaking primary click selection.
                const normalized = derived as any[];
                const isShiftHeld = input.isShiftDown();
                const hasSelection =
                    ClientState.isSpellSelected || ClientState.isItemSelected === 1;
                // OSRS parity: shift-click uses the item's configured shiftClickIndex (opcode 42) when enabled.
                // Inventory shift-click drop only applies to the inventory interface (group 149).
                let shiftClickActionIndex: number | undefined;
                if (
                    isShiftHeld &&
                    this.settings.shiftClickEnabled &&
                    (resolvedGroupId | 0) === 149 &&
                    typeof w?.itemId === "number" &&
                    (w.itemId | 0) > 0
                ) {
                    try {
                        const obj = this.objTypeLoader?.load?.(w.itemId | 0);
                        const idx = getShiftClickActionIndex(obj);
                        if (idx >= 0) shiftClickActionIndex = idx;
                    } catch {}
                }
                const state: DefaultChoiceState = {
                    hasSelectedSpell: ClientState.isSpellSelected,
                    hasSelectedItem: ClientState.isItemSelected === 1,
                    isShiftHeld,
                    shiftClickActionIndex,
                };
                const chosen = chooseDefaultMenuEntry(normalized, state);
                const lower = String(chosen?.option || "").toLowerCase();
                const isNonAction =
                    lower === "cancel" ||
                    lower === "examine" ||
                    lower === "inspect" ||
                    lower === "walk here";
                if (chosen && !isNonAction) {
                    entryOption = String(chosen.option);
                    entryTarget = chosen.target;
                }

                // OSRS parity: Shift-click drop overrides the inventory item's primary option only when
                // no spell/item selection is active.
                if (
                    isShiftHeld &&
                    this.settings.shiftClickEnabled &&
                    !hasSelection &&
                    (resolvedGroupId | 0) === 149
                ) {
                    const dropEntry = Array.isArray(normalized)
                        ? (normalized as any[]).find((e) => {
                              const l = String(e?.option || "").toLowerCase();
                              return l === "drop" || l === "destroy" || l === "release";
                          })
                        : undefined;
                    if (dropEntry?.option) {
                        entryOption = String(dropEntry.option);
                        entryTarget = dropEntry.target;
                    }
                }
            } catch {}
            const fallbackActionFromWidgetActions = (): string | undefined => {
                const actions: Array<string | null | undefined> = Array.isArray(w?.actions)
                    ? w.actions
                    : [];
                for (const a of actions) {
                    const p = sanitizeText(a);
                    if (p) return p;
                }
                return undefined;
            };
            const option =
                sanitizeText(entryOption) ??
                fallbackActionFromWidgetActions() ??
                sanitizeText(w?.targetVerb) ??
                (this.getWidgetTargetMask(w) > 0 ? sanitizeText(w?.spellActionName) : undefined) ??
                "Ok";
            const target =
                (sanitizeText(entryTarget) ? String(entryTarget).trim() : undefined) ??
                getWidgetTargetLabelForMenu(menuWidget) ??
                "";
            const slot = typeof w?.childIndex === "number" ? w.childIndex | 0 : undefined;
            const itemId = typeof w?.itemId === "number" && w.itemId > 0 ? w.itemId | 0 : undefined;
            return { option, target, slot, itemId };
        };

        // Helper to collect widgets from all roots
        const collectFromAllRoots = (px: number, py: number): any[] => {
            return collectWidgetsAtPointAcrossRoots(
                allRoots,
                px,
                py,
                visibleMap,
                getStaticChildren,
                getInterfaceParentRoots,
                isInputCaptureWidget,
            );
        };

        // MouseOver/MouseLeave handling
        // PERF: Cache hit test results - only recompute when mouse moves
        let hits: any[];
        if (mx === this._lastHoverHitX && my === this._lastHoverHitY && this._cachedHoverHits) {
            hits = this._cachedHoverHits;
        } else {
            hits = collectFromAllRoots(mx, my);
            this._lastHoverHitX = mx;
            this._lastHoverHitY = my;
            this._cachedHoverHits = hits;
        }

        const hoverCycle = this.transmitCycles.cycleCntr | 0;
        // OSRS parity: class536 (widget event traversal) runs once per client cycle.
        // Avoid dispatching hover listeners multiple times when render FPS exceeds 50Hz.
        if (this._lastHoverListenerCycle !== hoverCycle) {
            this._lastHoverListenerCycle = hoverCycle;

            // OSRS parity: hover state is tracked per-widget (Widget.field4564 / field3722).
            // Multiple widgets (parents + children) can be hovered at once and receive onMouseRepeat.
            const nextHoveredUids = new Set<number>();
            const nextHoveredWidgetsByUid = new Map<number, any>();
            const hasHoverHandlers = (w: any): boolean => {
                // OSRS parity: mouse listener dispatch in class536 is in the IF3 event branch.
                if (!w || w.isIf3 === false) return false;
                // If the cache/runtime explicitly marked this widget as "no listeners", skip.
                if (w.field4517 === false) return false;
                return !!(
                    w.eventHandlers?.onMouseOver ||
                    w.eventHandlers?.onMouseLeave ||
                    w.eventHandlers?.onMouseRepeat ||
                    (Array.isArray(w.onMouseOver) && w.onMouseOver.length > 0) ||
                    (Array.isArray(w.onMouseLeave) && w.onMouseLeave.length > 0) ||
                    (Array.isArray(w.onMouseRepeat) && w.onMouseRepeat.length > 0)
                );
            };
            for (let i = 0; i < hits.length; i++) {
                const w = hits[i];
                if (!hasHoverHandlers(w)) continue;
                const uid = (w.uid ?? 0) | 0;
                if (uid === 0) continue;
                nextHoveredUids.add(uid);
                nextHoveredWidgetsByUid.set(uid, w);
            }

            // Create mouse event context - relative to widget's absolute screen position
            // Uses _absX/_absY set by collectWidgetsAtPoint, falls back to relative x/y.
            const createMouseEventContext = (widget: any): Partial<ScriptEvent> => {
                const widgetX = widget._absX ?? widget.x ?? 0;
                const widgetY = widget._absY ?? widget.y ?? 0;
                return {
                    mouseX: mx - widgetX,
                    mouseY: my - widgetY,
                };
            };

            // Fire mouseLeave for widgets that were hovered last cycle but aren't now.
            for (const uid of this.hoveredWidgetUids) {
                if (nextHoveredUids.has(uid)) continue;
                const old = this.hoveredWidgetsByUid.get(uid);
                if (!old) continue;
                const eventCtx = createMouseEventContext(old);
                if (old.eventHandlers?.onMouseLeave) {
                    this.cs2Vm.invokeEventHandler(old, "onMouseLeave", eventCtx);
                } else if (Array.isArray(old.onMouseLeave) && old.onMouseLeave.length > 0) {
                    this.executeScriptListener(old, old.onMouseLeave, eventCtx);
                }
            }

            // Fire mouseOver for newly hovered widgets (in draw order: parent before child).
            for (let i = 0; i < hits.length; i++) {
                const w = hits[i];
                if (!hasHoverHandlers(w)) continue;
                const uid = (w.uid ?? 0) | 0;
                if (uid === 0) continue;
                if (!nextHoveredUids.has(uid) || this.hoveredWidgetUids.has(uid)) continue;
                const eventCtx = createMouseEventContext(w);
                if (w.eventHandlers?.onMouseOver) {
                    this.cs2Vm.invokeEventHandler(w, "onMouseOver", eventCtx);
                } else if (Array.isArray(w.onMouseOver) && w.onMouseOver.length > 0) {
                    this.executeScriptListener(w, w.onMouseOver, eventCtx);
                }
            }

            // OSRS parity: onMouseRepeat fires once per client cycle while hovered.
            for (let i = 0; i < hits.length; i++) {
                const w = hits[i];
                if (!hasHoverHandlers(w)) continue;
                const uid = (w.uid ?? 0) | 0;
                if (uid === 0) continue;
                if (!nextHoveredUids.has(uid)) continue;
                const eventCtx = createMouseEventContext(w);
                if (w.eventHandlers?.onMouseRepeat) {
                    this.cs2Vm.invokeEventHandler(w, "onMouseRepeat", eventCtx);
                } else if (Array.isArray(w.onMouseRepeat) && w.onMouseRepeat.length > 0) {
                    this.executeScriptListener(w, w.onMouseRepeat, eventCtx);
                }
            }

            this.hoveredWidgetUids = nextHoveredUids;
            this.hoveredWidgetsByUid = nextHoveredWidgetsByUid;
        }

        // OSRS parity: IF1 scrollbar interaction (Skills.nv).
        // Handles arrows, track dragging, and wheel over content+scrollbar region.
        if (!this.isDraggingWidget) {
            this.if1AlternativeScrollbarWidth = this.if1ScrollbarDragging ? 32 : 0;
            this.if1ScrollbarDragging = false;

            const isLeftHeld = input.clickMode2 === ClickMode.LEFT;
            const if1WheelDelta = input.wheelDeltaY;
            if (isLeftHeld || if1WheelDelta !== 0) {
                const SCROLLBAR_WIDTH = 16;
                const ARROW_HEIGHT = 16;
                let handledWheel = false;

                const handleIf1Scrollbars = (
                    widget: any,
                    parentAbsX: number,
                    parentAbsY: number,
                ): boolean => {
                    if (!widget) return false;
                    const uid = (widget.uid ?? 0) | 0;
                    if (uid !== 0 && this.widgetManager.isEffectivelyHidden(uid)) return false;
                    if (widget.hidden || widget.hide) return false;

                    const absX = (parentAbsX + (widget.x ?? 0)) | 0;
                    const absY = (parentAbsY + (widget.y ?? 0)) | 0;

                    const widgetType = ((widget.type ?? 0) | 0) as number;
                    const widgetWidth = (widget.width ?? 0) | 0;
                    const widgetHeight = (widget.height ?? 0) | 0;
                    const scrollHeight = (widget.scrollHeight ?? 0) | 0;
                    const isIf1Scrollable =
                        widgetType === 0 && widget.isIf3 === false && scrollHeight > widgetHeight;

                    if (isIf1Scrollable) {
                        const scrollbarX = absX + widgetWidth;
                        const maxScrollY = Math.max(0, scrollHeight - widgetHeight);
                        const clampScrollY = (value: number): number =>
                            Math.min(Math.max(0, value | 0), maxScrollY);

                        if (isLeftHeld) {
                            if (
                                mx >= scrollbarX &&
                                mx < scrollbarX + SCROLLBAR_WIDTH &&
                                my >= absY &&
                                my < absY + ARROW_HEIGHT
                            ) {
                                widget.scrollY = clampScrollY((widget.scrollY ?? 0) - 4);
                                this.widgetManager.invalidateScroll(widget);
                                return true;
                            }
                            if (
                                mx >= scrollbarX &&
                                mx < scrollbarX + SCROLLBAR_WIDTH &&
                                my >= absY + widgetHeight - ARROW_HEIGHT &&
                                my < absY + widgetHeight
                            ) {
                                widget.scrollY = clampScrollY((widget.scrollY ?? 0) + 4);
                                this.widgetManager.invalidateScroll(widget);
                                return true;
                            }
                            if (
                                mx >= scrollbarX - this.if1AlternativeScrollbarWidth &&
                                mx <
                                    scrollbarX +
                                        SCROLLBAR_WIDTH +
                                        this.if1AlternativeScrollbarWidth &&
                                my >= absY + ARROW_HEIGHT &&
                                my < absY + widgetHeight - ARROW_HEIGHT
                            ) {
                                let thumbHeight = Math.floor(
                                    (widgetHeight * (widgetHeight - 32)) / scrollHeight,
                                );
                                if (thumbHeight < 8) thumbHeight = 8;
                                const clickPosY = my - absY - ARROW_HEIGHT - (thumbHeight >> 1);
                                const trackHeight = widgetHeight - 32 - thumbHeight;
                                widget.scrollY = clampScrollY(
                                    trackHeight > 0
                                        ? Math.floor(
                                              (clickPosY * (scrollHeight - widgetHeight)) /
                                                  trackHeight,
                                          )
                                        : 0,
                                );
                                this.widgetManager.invalidateScroll(widget);
                                this.if1ScrollbarDragging = true;
                                return true;
                            }
                        }

                        if (
                            !handledWheel &&
                            if1WheelDelta !== 0 &&
                            mx >= scrollbarX - widgetWidth &&
                            my >= absY &&
                            mx < scrollbarX + SCROLLBAR_WIDTH &&
                            my <= absY + widgetHeight
                        ) {
                            widget.scrollY = clampScrollY(
                                (widget.scrollY ?? 0) + if1WheelDelta * 45,
                            );
                            this.widgetManager.invalidateScroll(widget);
                            handledWheel = true;
                        }
                    }

                    const childBaseX = absX - ((widget.scrollX ?? 0) | 0);
                    const childBaseY = absY - ((widget.scrollY ?? 0) | 0);

                    if (widget.uid !== undefined) {
                        const staticChildren = getStaticChildren(widget.uid);
                        for (let i = staticChildren.length - 1; i >= 0; i--) {
                            if (handleIf1Scrollbars(staticChildren[i], childBaseX, childBaseY)) {
                                return true;
                            }
                        }
                    }
                    if (Array.isArray(widget.children)) {
                        for (let i = widget.children.length - 1; i >= 0; i--) {
                            const child = widget.children[i];
                            if (handleIf1Scrollbars(child, childBaseX, childBaseY)) return true;
                        }
                    }
                    return false;
                };

                for (let i = allRoots.length - 1; i >= 0; i--) {
                    if (handleIf1Scrollbars(allRoots[i], 0, 0)) break;
                }
                if (handledWheel) {
                    input.wheelDeltaY = 0;
                }
            }
        }

        // OSRS parity: Handle scroll wheel events on widgets with onScroll handlers
        // (IF1 default wheel scrolling is handled by the IF1 scrollbar path above).
        const wheelDelta = input.wheelDeltaY;
        if (wheelDelta !== 0 && hits.length > 0 && !this.isDraggingWidget) {
            let consumedWheel = false;
            let blockedByVisibleWidget = false;

            for (let i = hits.length - 1; i >= 0; i--) {
                const w = hits[i];

                // Skip effectively hidden widgets
                const wUid = (w.uid ?? 0) | 0;
                if (this.widgetManager.isEffectivelyHidden(wUid)) continue;

                // OSRS parity: noScrollThrough blocks scroll from reaching widgets behind
                if (w.noScrollThrough && w.isIf3 !== false) {
                    break;
                }

                // Camera zoom blocking is based on actual visible widget surfaces.
                // Listener-only widgets (for example buff_bar transmit children) must not block.
                if (!blockedByVisibleWidget && getVisibleWidgetSurfaceReason(w)) {
                    blockedByVisibleWidget = true;
                }

                const hasScrollHandler =
                    w.eventHandlers?.onScroll ||
                    (Array.isArray(w.onScroll) && w.onScroll.length > 0);
                if (!hasScrollHandler) continue;

                const wheelStep = wheelDelta > 0 ? 1 : -1;
                const scrollCtx: Partial<ScriptEvent> = {
                    mouseX: mx - (w._absX ?? w.x ?? 0),
                    mouseY: wheelStep,
                };

                if (w.eventHandlers?.onScroll) {
                    this.cs2Vm.invokeEventHandler(w, "onScroll", scrollCtx);
                } else if (Array.isArray(w.onScroll) && w.onScroll.length > 0) {
                    this.executeScriptListener(w, w.onScroll, scrollCtx);
                }

                consumedWheel = true;
                break;
            }

            // Block camera zoom if scroll was consumed or the pointer is over a zoom-blocking widget.
            if (consumedWheel || blockedByVisibleWidget) {
                input.wheelDeltaY = 0;
            }
        }

        // Click/Hold/Release handling (widget-level, not menu-level)
        // IMPORTANT: Skip widget click handling when the right-click menu is open.
        // The menu is not a widget, so clicks would pass through to widgets behind it.
        // Menu clicks are handled by ClickRegistry in processWidgetUiInput.
        // Check both world menu (this.menuOpen) and widget menu (ui.menu?.open)
        const uiMenu = (this.renderer?.canvas as any)?.__ui?.menu;
        if (this.menuOpen || uiMenu?.open) {
            return;
        }

        // Skip input processing for one frame after menu closes to prevent
        // the menu-selecting click from being processed as a widget click
        if (this.menuJustClosed) {
            this.menuJustClosed = false;
            return;
        }

        const isNewClick = input.leftClickX !== -1 && input.leftClickY !== -1;
        const isHolding = input.isDragging(); // Left button held

        if (isNewClick) {
            // New click - reset drag state
            this.widgetDragDuration = 0;
            this.isDraggingWidget = false;
            this.dragClickX = input.leftClickX;
            this.dragClickY = input.leftClickY;
            this.clickedWidgetParent = null;
            this.draggedOnWidget = null;
            // PERF: Reset drag hit cache
            this._lastDragHitX = -1;
            this._lastDragHitY = -1;
            // PERF: Invalidate hover cache - click may change widget visibility
            this._cachedHoverHits = null;

            if (!this.clickedWidget) {
                // Find widget with click handlers
                const clickHits = collectFromAllRoots(input.leftClickX, input.leftClickY);
                for (let i = clickHits.length - 1; i >= 0; i--) {
                    const w = clickHits[i];
                    const hasItem = typeof (w as any).itemId === "number" && (w as any).itemId > 0;
                    // OSRS PARITY: Check for actual handlers, not just empty arrays
                    // Empty arrays are truthy but shouldn't count as having handlers
                    const hasActions = Array.isArray(w.actions) && w.actions.length > 0;
                    const getWidgetByUid = (uid: number) => this.widgetManager?.getWidgetByUid(uid);
                    const isPauseButtonWidget = isPauseButtonWidgetUtil(
                        w,
                        getWidgetFlags,
                        getWidgetByUid,
                    );
                    // OSRS parity: widgets can be clickable purely via IF_SETEVENTS transmit flags
                    // (bits 1-10 for op1..op10), even if they have no actions[] or scripts attached.
                    // This is required for interfaces like PlayerDesign (679) where button widgets
                    // are often empty containers with only transmit flags set.
                    const flags = getWidgetFlags(w) | 0;
                    const hasTransmitOps = (flags & 0x7fe) !== 0;
                    // OSRS parity: spell widgets are actionable when target mask is non-zero
                    // and spellActionName exists (Widget_getSpellActionName).
                    const targetMask = (flags >>> 11) & 0x3f;
                    const hasSpellAction =
                        targetMask > 0 &&
                        !!sanitizeText((w as any).spellActionName ?? (w as any).targetVerb);
                    const isDynamicWidget = ((w as any).fileId | 0) === -1;
                    const hasHandlers = !!(
                        w.eventHandlers?.onClick ||
                        w.eventHandlers?.onClickRepeat ||
                        w.eventHandlers?.onHold ||
                        w.eventHandlers?.onRelease ||
                        w.eventHandlers?.onOp ||
                        w.onClick ||
                        w.onClickRepeat ||
                        w.onHold ||
                        w.onRelease ||
                        w.onOp ||
                        hasActions ||
                        hasItem ||
                        // OSRS: any widget can be a drag source if it has drag listener or implicit drag
                        w.eventHandlers?.onDrag ||
                        w.onDrag ||
                        w.isDraggable ||
                        isPauseButtonWidget ||
                        // OSRS parity: IF_SETEVENTS transmit bits can make otherwise-empty STATIC widgets
                        // clickable (e.g., server-authoritative tab controls). For dynamic children,
                        // transmit-only hit targets can incorrectly steal clicks from scripted row widgets.
                        (!isDynamicWidget && hasTransmitOps) ||
                        hasSpellAction
                    );
                    if (hasHandlers) {
                        this.clickedWidget = w;
                        this.clickedWidgetParent = this.resolveClickedWidgetParent(w);
                        // Use absolute position (from hit detection) for event_mousey calculation
                        this.clickedWidgetX = input.leftClickX - (w._absX ?? w.x ?? 0);
                        this.clickedWidgetY = input.leftClickY - (w._absY ?? w.y ?? 0);
                        // OSRS parity: Mark the clicked widget dirty immediately so the held-click
                        // translucency is visible on the same frame.
                        this.widgetManager.invalidateWidgetRender(w);

                        // Check for spell targeting BEFORE CS2 handlers run
                        // Spellbook widgets (group 218) with targetMask should enter targeting mode
                        const clickGroupId = (w.groupId ?? w.uid >>> 16) | 0;
                        const clickChildId = (w.fileId ?? w.uid & 0xffff) | 0;
                        const isSpellbookWidget = clickGroupId === 218 && clickChildId > 0;

                        if (isSpellbookWidget) {
                            // Get targetVerb from widget or use "Cast" as fallback for spell widgets
                            let targetVerb = w.targetVerb || w.spellActionName;

                            // OSRS parity: Only enter targeting mode if targetMask > 0 (spell needs a target)
                            // Teleport spells have targetMask === 0 and should cast immediately.
                            const targetMask = this.getWidgetTargetMask(w);
                            const needsTarget = targetMask > 0;

                            if (
                                !needsTarget &&
                                targetVerb &&
                                (w.name || w.opBase || w.spriteId >= 0)
                            ) {
                                // No-target spell (e.g., teleport) - send directly to server
                                console.log(
                                    `[OsrsClient] No-target spell clicked: widget=${w.uid}, name="${
                                        w.name || w.opBase
                                    }", group=${clickGroupId}, child=${clickChildId}`,
                                );

                                // Send widget action to server for teleport handling
                                sendWidgetAction({
                                    widgetId: w.uid,
                                    groupId: clickGroupId,
                                    childId: clickChildId,
                                    option: "Cast",
                                    target: w.name || w.opBase || "",
                                    opId: 1,
                                });
                                break;
                            }

                            if (!targetVerb && needsTarget) {
                                targetVerb = "null";
                            }

                            if (targetVerb && needsTarget) {
                                // OSRS parity: Clicking the currently selected spell deselects it.
                                if (
                                    ClientState.isSpellSelected &&
                                    ClientState.selectedSpellWidget === w.uid
                                ) {
                                    console.log(
                                        `[OsrsClient] Spell widget re-clicked while active, clearing selection: widget=${w.uid}`,
                                    );
                                    this.clearSelectedSpell();
                                    break;
                                }

                                // Enter spell targeting mode (for combat spells that need a target)
                                ClientState.clearItemSelection();
                                try {
                                    this.inventory?.setSelectedSlot?.(null);
                                } catch {}
                                ClientState.isSpellSelected = true;
                                ClientState.selectedSpellWidget = w.uid;
                                ClientState.selectedSpellChildIndex = clickChildId;
                                ClientState.selectedSpellItemId = -1;
                                ClientState.selectedSpellActionName = targetVerb;
                                ClientState.selectedSpellName =
                                    w.opBase || w.dataText || w.name || "";
                                // Track when spell targeting was entered to prevent casting on same click
                                ClientState.spellTargetEnteredFrame = Date.now();
                                // OSRS parity: Store the spell's target mask
                                ClientState.selectedSpellTargetMask = targetMask;

                                const clickGroupId = (w.uid >> 16) & 0xffff;
                                console.log(
                                    `[OsrsClient] Spell targeting mode entered: widget=${
                                        w.uid
                                    }, verb="${targetVerb}", name="${
                                        ClientState.selectedSpellName
                                    }", group=${clickGroupId}, child=${clickChildId}, targetMask=0x${ClientState.selectedSpellTargetMask.toString(
                                        16,
                                    )}`,
                                );

                                // Fire onTargetEnter on the source widget (OSRS parity - use widget child ID, not hardcoded spell ID)
                                this.setSelectedSpell(
                                    {
                                        spellId: clickChildId, // Widget child ID is the spell identifier
                                        spellName: ClientState.selectedSpellName,
                                        spellLevel: 1,
                                    },
                                    w,
                                );

                                // IMPORTANT: Stop processing this click after entering spell targeting mode
                                // Don't continue to onClick/onOp handlers which may switch tabs and trigger other actions
                                break;
                            }
                        }

                        // OSRS parity: Pause button widgets send RESUME_PAUSEBUTTON and do not go through
                        // generic widget action dispatch.
                        // Reference: WorldMapSprite.java line 128-129 - menu shows "Continue" with empty target
                        if (isPauseButtonWidget) {
                            // OSRS parity: Only send if not already waiting for response
                            if (!this.widgetManager?.meslayerContinueWidget) {
                                const widgetUid =
                                    (typeof (w as any).id === "number"
                                        ? (w as any).id
                                        : w.uid ?? 0) | 0;
                                const childIndex =
                                    (typeof w.childIndex === "number" && (w.childIndex | 0) >= 0
                                        ? w.childIndex | 0
                                        : typeof w.fileId === "number" && w.fileId >= 0
                                        ? w.fileId | 0
                                        : widgetUid & 0xffff) | 0;
                                // Send RESUME_PAUSEBUTTON packet to server
                                const pkt = createPacket(ClientPacketId.RESUME_PAUSEBUTTON);
                                pkt.packetBuffer.writeShortAddLE(childIndex);
                                pkt.packetBuffer.writeInt(widgetUid);
                                queuePacket(pkt);
                                // Set meslayerContinueWidget to show "Please wait..."
                                if (this.widgetManager) {
                                    this.widgetManager.meslayerContinueWidget = w;
                                    this.widgetManager.invalidateWidgetRender(w);
                                }
                            }
                            this.clickedWidgetHandled = true;
                            break;
                        }

                        // OSRS parity: For draggable widgets, DON'T fire onClick on mousedown
                        // Wait until mouseup to determine if it was a click or a drag
                        // Reference: Client.java drag handling - onClick only fires on release if not dragging
                        if (this.isWidgetDraggable(w)) {
                            // Don't fire onClick yet - wait for mouseup to see if it's a drag
                            // The onClick will be fired in the release handler if no drag occurred
                            break;
                        }

                        // OSRS parity: resolve the primary menu action before any onClick/onOp handlers run.
                        // Handlers can mutate widget ops (e.g., Mute -> Unmute), but the transmitted action
                        // should reflect what was clicked pre-mutation.
                        const primaryAction = getPrimaryWidgetAction(w);

                        // World map orb - opens React modal instead of CS2 widget
                        // Check if primary option is "Floating World Map", "Fullscreen World Map", or "Open World Map" (mobile)
                        const optionLower = (primaryAction.option || "").toLowerCase();
                        if (
                            (optionLower.includes("floating") &&
                                optionLower.includes("world map")) ||
                            (optionLower.includes("fullscreen") &&
                                optionLower.includes("world map")) ||
                            (optionLower.includes("open") && optionLower.includes("world map"))
                        ) {
                            if (this.onOpenWorldMap) {
                                this.onOpenWorldMap();
                            }
                            break; // World map is client-side React modal
                        }

                        // If the GL widgets layer is active, defer primary click handling to it.
                        // OSRS parity: Primary left-click handling is driven by the game loop
                        // (clickedWidget + menuAction semantics), not by the GL widget click registry.

                        // Non-draggable widgets: Fire onClick immediately on press
                        const meslayerBeforePrimaryClick =
                            this.widgetManager?.meslayerContinueWidget ?? null;
                        const clickCtx: Partial<ScriptEvent> = {
                            mouseX: this.clickedWidgetX,
                            mouseY: this.clickedWidgetY,
                            opIndex: 1,
                        };
                        let handled = false;
                        let invokedAnyHandler = false;

                        // Try onClick first
                        if (w.eventHandlers?.onClick) {
                            invokedAnyHandler = true;
                            handled = this.cs2Vm.invokeEventHandler(w, "onClick", clickCtx);
                        }

                        // Fall back to onOp if onClick didn't handle it (tabs use onOp)
                        if (!handled && w.eventHandlers?.onOp) {
                            invokedAnyHandler = true;
                            handled = this.cs2Vm.invokeEventHandler(w, "onOp", clickCtx);
                        }

                        // Try legacy handlers
                        if (!handled && w.onClick) {
                            invokedAnyHandler = true;
                            this.executeScriptListener(w, w.onClick, clickCtx);
                            handled = true;
                        }

                        if (!handled && w.onOp) {
                            invokedAnyHandler = true;
                            this.executeScriptListener(w, w.onOp, clickCtx);
                            handled = true;
                        }

                        // CS2 handlers can mutate widgets (hide/text/position/etc). Ensure a repaint.
                        // This matches the behavior we already do for server-driven run_script events.
                        if (invokedAnyHandler && this.widgetManager) {
                            this.widgetManager.invalidateAll();
                        }

                        // If click handlers resumed a pause button, skip generic IF_BUTTON send.
                        const resumePauseTriggeredByHandler =
                            meslayerBeforePrimaryClick === null &&
                            (this.widgetManager?.meslayerContinueWidget ?? null) !== null;
                        if (resumePauseTriggeredByHandler) {
                            this.clickedWidgetHandled = true;
                            break;
                        }

                        // Mark that we already fired CS2 handlers for this widget click
                        // This prevents handleWidgetAction from firing them again on mouseup
                        if (handled) {
                            this.clickedWidgetHandled = true;
                        }

                        // OSRS parity: keep league tutorial area highlight transitions client-side on click.
                        this.applyLeagueAreaTutorialHighlightPrediction(w);

                        // OSRS parity: Only transmit widget ops to the server when the transmit flag is set
                        // for the action (IF_SETEVENTS / Client.widgetFlags).
                        // Avoid double-send when the GL widget system already dispatches onWidgetAction.
                        const { option, target, slot, itemId } = primaryAction;
                        try {
                            const payload = this.buildWidgetActionPayload({
                                widget: w,
                                option,
                                target,
                                source: "primary",
                                cursorX: this.clickedWidgetX,
                                cursorY: this.clickedWidgetY,
                                slot,
                                itemId,
                            });
                            if (payload) {
                                // PlayerDesign (679): handle locally and do not transmit arrow/button ops.
                                // Confirm sends the OSRS appearance packet separately.
                                const groupId = (payload.widgetId >>> 16) & 0xffff;
                                const childId = payload.widgetId & 0xffff;
                                if ((groupId | 0) === 679) {
                                    if (this.handlePlayerDesignWidgetAction(childId | 0)) {
                                        break;
                                    }
                                }

                                const transmitFlagWidget = this.resolveTransmitFlagWidget(
                                    w,
                                    payload,
                                );
                                const flags =
                                    this.widgetManager?.getWidgetFlags?.(transmitFlagWidget) ??
                                    transmitFlagWidget?.flags ??
                                    0;
                                const opId = payload.opId ?? 0;
                                const actionIndex = opId > 0 ? opId - 1 : -1;
                                if (
                                    actionIndex >= 0 &&
                                    actionIndex <= 9 &&
                                    !shouldTransmitAction(flags, actionIndex)
                                ) {
                                    break;
                                }
                                sendWidgetAction(payload);
                            }
                        } catch (err) {
                            console.warn("[OsrsClient] widget action send failed", err);
                        }
                        break;
                    }
                }
            }
        }

        // Modal click-through prevention is handled in the world interaction layer
        // (WebGLOsrsRenderer.checkInteractions). Do not mutate clickMode3 here, since
        // the GL UI click system (Choose Option, dialog click targets) relies on it.

        // Drag handling - OSRS style
        // Reference: Client.java lines 6304-6307 - drag only initiates for widgets with drag capability
        if (this.clickedWidget && isHolding && this.isWidgetDraggable(this.clickedWidget)) {
            this.widgetDragDuration++;

            // Check for drag initiation if not yet dragging
            if (!this.isDraggingWidget) {
                const dx = mx - this.dragClickX;
                const dy = my - this.dragClickY;
                const dist = Math.max(Math.abs(dx), Math.abs(dy));
                const zone = this.clickedWidget.dragZoneSize ?? 0;
                const threshold = this.clickedWidget.dragThreshold ?? 0;

                if (this.widgetDragDuration > threshold && dist > zone) {
                    this.isDraggingWidget = true;
                    this.dragSourceWidget = this.clickedWidget;

                    // Initialize offsets if needed (matches old logic)
                    if ((this.clickedWidget as any)._dragPickupOffsetX === undefined) {
                        (this.clickedWidget as any)._dragPickupOffsetX =
                            this.dragClickX - (this.clickedWidget._absX ?? 0);
                    }
                    if ((this.clickedWidget as any)._dragPickupOffsetY === undefined) {
                        (this.clickedWidget as any)._dragPickupOffsetY =
                            this.dragClickY - (this.clickedWidget._absY ?? 0);
                    }

                    // OSRS parity: clickedWidgetParent defines clamp/coordinate space.
                    // Ensure it's resolved before we cache absolute coordinates for drag math.
                    if (!this.clickedWidgetParent) {
                        this.clickedWidgetParent = this.resolveClickedWidgetParent(
                            this.clickedWidget,
                        );
                    }
                    const renderArea = this.clickedWidgetParent ?? this.clickedWidget;
                    // Cache absolute position of clickedWidgetParent for coord calculations (field688/field689)
                    let renderAreaAbsX: number;
                    let renderAreaAbsY: number;
                    if (renderArea._absX !== undefined && renderArea._absY !== undefined) {
                        renderAreaAbsX = renderArea._absX;
                        renderAreaAbsY = renderArea._absY;
                    } else if (
                        this.clickedWidget._absX !== undefined &&
                        this.clickedWidget._absY !== undefined
                    ) {
                        // Derive parent's absolute position from the child's absolute position
                        renderAreaAbsX = this.clickedWidget._absX - (this.clickedWidget.x ?? 0);
                        renderAreaAbsY = this.clickedWidget._absY - (this.clickedWidget.y ?? 0);
                    } else {
                        renderAreaAbsX = renderArea.x ?? 0;
                        renderAreaAbsY = renderArea.y ?? 0;
                    }
                    (this as any)._dragRenderAreaAbsX = renderAreaAbsX;
                    (this as any)._dragRenderAreaAbsY = renderAreaAbsY;
                }
            }

            // Execute onDrag if dragging is active
            if (this.isDraggingWidget) {
                const w = this.clickedWidget;

                // OSRS parity: clickedWidgetParent defines clamp/coordinate space.
                // If null, widget can be dragged freely without clamping (like bank items).
                if (!this.clickedWidgetParent) {
                    this.clickedWidgetParent = this.resolveClickedWidgetParent(w);
                }
                const renderArea = this.clickedWidgetParent;
                const hasExplicitDragParent = renderArea !== null;

                const widgetWidth = w.width ?? 0;
                const widgetHeight = w.height ?? 0;

                // UI render scale: maps logical widget coordinates to canvas pixel coordinates.
                // All absolute positions (_absX/_absY, mouse coords) are in pixel space,
                // but widget dimensions (width/height) and CS2 script coordinates are in
                // logical space. We need the scale to convert between them.
                const [renderScaleX, renderScaleY] = this.getUiRenderScale();

                // Calculate target absolute position (Mouse - Offset)
                let targetAbsX = mx - this.clickedWidgetX;
                let targetAbsY = my - this.clickedWidgetY;

                // Only clamp to parent bounds if there's an explicit drag parent
                // Widgets without explicit drag parent (like bank items) can drag freely
                let parentAbsX = 0;
                let parentAbsY = 0;
                let parentScrollX = 0;
                let parentScrollY = 0;

                if (hasExplicitDragParent) {
                    parentAbsX = renderArea._absX ?? (this as any)._dragRenderAreaAbsX ?? 0;
                    parentAbsY = renderArea._absY ?? (this as any)._dragRenderAreaAbsY ?? 0;
                    const parentWidth = renderArea.width ?? 0;
                    const parentHeight = renderArea.height ?? 0;
                    parentScrollX = renderArea.scrollX ?? 0;
                    parentScrollY = renderArea.scrollY ?? 0;

                    // Clamp to parent bounds (only when explicit drag parent is set)
                    // parentAbsX/Y are in pixel space; widget dimensions are logical so
                    // scale them to pixel space for consistent clamping.
                    const widgetPixelW = widgetWidth * renderScaleX;
                    const widgetPixelH = widgetHeight * renderScaleY;
                    const parentPixelW = parentWidth * renderScaleX;
                    const parentPixelH = parentHeight * renderScaleY;
                    if (targetAbsX < parentAbsX) targetAbsX = parentAbsX;
                    if (targetAbsX + widgetPixelW > parentAbsX + parentPixelW)
                        targetAbsX = parentAbsX + parentPixelW - widgetPixelW;

                    if (targetAbsY < parentAbsY) targetAbsY = parentAbsY;
                    if (targetAbsY + widgetPixelH > parentAbsY + parentPixelH)
                        targetAbsY = parentAbsY + parentPixelH - widgetPixelH;
                }

                // Calculate visual position relative to the widget's ACTUAL RENDER PARENT
                // The drag render area (used for clamping and script coords) may be different
                // from the widget's parent (e.g., scrollbar dragger clamps to track but renders
                // as a child of the scrollbar container).
                //
                // Reference: UserComparator5.java lines 106-128
                // OSRS uses the clamped absolute position directly for rendering (var12=var15, var13=var16).
                // Our renderer does: finalPos = parentOffset + visualPos
                // So we need visualPos relative to the actual parent, not the drag render area.
                let actualParent =
                    w.parentUid !== undefined && w.parentUid !== -1
                        ? this.widgetManager.getWidgetByUid(w.parentUid)
                        : null;

                // Get the actual parent's absolute position (or fallback to drag render area)
                const actualParentAbsX = actualParent?._absX ?? parentAbsX;
                const actualParentAbsY = actualParent?._absY ?? parentAbsY;

                // Visual position is relative to actual parent (for renderer)
                const visualPosX = targetAbsX - actualParentAbsX;
                const visualPosY = targetAbsY - actualParentAbsY;

                // Script coordinates for CS2 event_mousex/event_mousey
                // Reference: Client.java lines 6309-6310:
                //   int var6 = var1 - field688 + clickedWidgetParent.scrollX;
                //   int var7 = var2 - field689 + clickedWidgetParent.scrollY;
                // where var1/var2 are the clamped absolute positions, field688/689 are the
                // drag render area's absolute position.
                // This gives the position within the drag render area plus its scroll offset.
                //
                // OSRS parity: For widgets without explicit drag parent (like bank items),
                // use the actual parent's position for script coordinates. The script
                // (e.g., bankmain_dragscroll) subtracts if_gety(container) which returns
                // position relative to parent, so event_mousey must also be relative to
                // the same coordinate space.
                //
                // The pixel-space difference is divided by renderScale to convert to logical
                // widget coordinates, which is what CS2 scripts expect. Scroll offsets are
                // already in logical space.
                const scriptParentAbsX = hasExplicitDragParent ? parentAbsX : actualParentAbsX;
                const scriptParentAbsY = hasExplicitDragParent ? parentAbsY : actualParentAbsY;
                const scriptParentScrollX = hasExplicitDragParent
                    ? parentScrollX
                    : actualParent?.scrollX ?? 0;
                const scriptParentScrollY = hasExplicitDragParent
                    ? parentScrollY
                    : actualParent?.scrollY ?? 0;
                const scriptX = ((targetAbsX - scriptParentAbsX) / renderScaleX + scriptParentScrollX) | 0;
                const scriptY = ((targetAbsY - scriptParentAbsY) / renderScaleY + scriptParentScrollY) | 0;

                // Store visual position for renderer to use
                // The widget's actual .x/.y stays unchanged until dragComplete
                // Visual position is parent-relative (no scroll) so renderer can do: ox + visualX
                //
                // Note: In Java client, dragRenderBehaviour (isScrollBar) only affects whether
                // the widget is rendered semi-transparent. All dragged widgets follow the cursor.
                // dragRenderBehaviour values:
                //   0 = hide during drag (but we still want to track position)
                //   1 = follow cursor (scrollbar style, opaque)
                //   other = follow cursor with transparency (inventory item style)
                //
                // We always set the visual position - the renderer decides visibility/transparency
                // Also store absolute position for deferred rendering (avoids scroll offset issues)
                (w as any)._dragAbsX = targetAbsX;
                (w as any)._dragAbsY = targetAbsY;

                // Store visual position in LOGICAL (widget-layout) coordinates so it uses
                // the same coordinate space as CS2 script positions (event_mousey, cc_setposition).
                //
                // OSRS PARITY: When the drag parent differs from the actual parent (e.g.,
                // scrollbar dragger clamped to track but parented to container), scriptY and
                // the naive logicalVisualY are truncated independently from different reference
                // points. At fractional pixel offsets this causes ±1 logical pixel misalignment
                // between the dragged widget and script-positioned siblings (cap sprites).
                // Fix: derive logicalVisualY from scriptY + the drag parent's logical offset
                // from the actual parent, sharing one truncation point.
                let logicalVisualX: number;
                let logicalVisualY: number;
                if (hasExplicitDragParent && actualParent && renderArea !== actualParent) {
                    const scriptParentLogicalY = (renderArea as any)?._absLogicalY ?? 0;
                    const actualParentLogicalY = (actualParent as any)?._absLogicalY ?? 0;
                    const scriptParentLogicalX = (renderArea as any)?._absLogicalX ?? 0;
                    const actualParentLogicalX = (actualParent as any)?._absLogicalX ?? 0;
                    logicalVisualX = scriptX - scriptParentScrollX + (scriptParentLogicalX - actualParentLogicalX);
                    logicalVisualY = scriptY - scriptParentScrollY + (scriptParentLogicalY - actualParentLogicalY);
                } else {
                    logicalVisualX = (visualPosX / renderScaleX) | 0;
                    logicalVisualY = (visualPosY / renderScaleY) | 0;
                }

                // PERF: Only invalidate render if position actually changed
                const prevVisualX = (w as any)._dragVisualX;
                const prevVisualY = (w as any)._dragVisualY;
                const positionChanged = prevVisualX !== logicalVisualX || prevVisualY !== logicalVisualY;

                (w as any)._dragVisualX = logicalVisualX;
                (w as any)._dragVisualY = logicalVisualY;
                (w as any)._isDragActive = true;

                // OSRS parity: dragged widget is invalidated every tick during drag (FaceNormal.invalidateWidget).
                // Our overlay renderer uses dirty-region tracking, so force a redraw while the cursor moves.
                // PERF: Only invalidate when position has actually changed
                if (positionChanged) {
                    try {
                        this.widgetManager?.invalidateWidgetRender?.(w);
                    } catch {}
                }

                // OSRS parity: Track draggedOnWidget - the widget under the cursor that can receive drops
                // Reference: WorldMapRegion.java line 1609-1610
                // This is updated every frame while dragging, checking widgets under mouse
                //
                // PERF: Only recalculate when mouse has actually moved
                if (mx !== this._lastDragHitX || my !== this._lastDragHitY) {
                    this._lastDragHitX = mx;
                    this._lastDragHitY = my;

                    // PERF: Use optimized findDropTarget instead of collecting all hits
                    const getFlags = (widget: any) =>
                        (this.widgetManager?.getWidgetFlags?.(widget) ?? widget?.flags ?? 0) | 0;
                    this.draggedOnWidget = findDropTarget(
                        allRoots,
                        mx,
                        my,
                        visibleMap,
                        getStaticChildren,
                        getFlags,
                        w.uid,
                        getInterfaceParentRoots,
                    );
                }

                const dragCtx: Partial<ScriptEvent> = {
                    mouseX: scriptX,
                    mouseY: scriptY,
                };

                if (w.eventHandlers?.onDrag) {
                    this.cs2Vm.invokeEventHandler(w, "onDrag", dragCtx);
                } else if (w.onDrag) {
                    this.executeScriptListener(w, w.onDrag, dragCtx);
                }

            }

        }

        // Fire onClickRepeat / onHold for ANY held widget, not just draggable ones.
        // OSRS parity: onHold fires every tick while the widget is held (e.g., scrollbar arrows).
        // Reference: Client.java - onHoldListener is processed independently of drag state.
        // OSRS parity: hold events are suppressed while a widget drag is active.
        // Reference: InterfaceUpdateHandler.java line 465 — draggedWidget != null suppresses var46/var47.
        if (this.clickedWidget && isHolding && !this.isDraggingWidget) {
            const holdCtx: Partial<ScriptEvent> = {
                mouseX: mx - (this.clickedWidget._absX ?? this.clickedWidget.x ?? 0),
                mouseY: my - (this.clickedWidget._absY ?? this.clickedWidget.y ?? 0),
            };

            // OSRS parity: onClickRepeat requires isClicked (set by onClick on the previous frame).
            // On the first frame of a click, onClick fires and sets isClicked — onClickRepeat
            // only starts firing from the next frame onward. Using !isNewClick as the guard
            // achieves the same one-frame delay.
            if (!isNewClick) {
                if (this.clickedWidget.eventHandlers?.onClickRepeat) {
                    this.cs2Vm.invokeEventHandler(this.clickedWidget, "onClickRepeat", holdCtx);
                } else if (this.clickedWidget.onClickRepeat) {
                    this.executeScriptListener(
                        this.clickedWidget,
                        this.clickedWidget.onClickRepeat,
                        holdCtx,
                    );
                }
            }

            if (this.clickedWidget.eventHandlers?.onHold) {
                this.cs2Vm.invokeEventHandler(this.clickedWidget, "onHold", holdCtx);
            } else if (this.clickedWidget.onHold) {
                this.executeScriptListener(this.clickedWidget, this.clickedWidget.onHold, holdCtx);
            }
        }

        // Release
        if (this.clickedWidget && !isHolding) {
            // Drag complete
            if (this.isDraggingWidget) {
                const w = this.clickedWidget;
                // Use draggedOnWidget tracked during drag (OSRS parity)
                const dragTarget = this.draggedOnWidget;
                // Ensure clickedWidgetParent is resolved for final clamp/coords.
                if (!this.clickedWidgetParent) {
                    this.clickedWidgetParent = this.resolveClickedWidgetParent(w);
                }
                const renderArea = this.clickedWidgetParent;
                const hasExplicitDragParent = renderArea !== null;

                const widgetWidth = w.width ?? 0;
                const widgetHeight = w.height ?? 0;
                const [renderScaleX, renderScaleY] = this.getUiRenderScale();

                let targetAbsX = mx - this.clickedWidgetX;
                let targetAbsY = my - this.clickedWidgetY;

                // Only clamp to parent bounds if there's an explicit drag parent
                let parentAbsX = 0;
                let parentAbsY = 0;
                let parentScrollX = 0;
                let parentScrollY = 0;

                if (hasExplicitDragParent) {
                    parentAbsX = renderArea._absX ?? (this as any)._dragRenderAreaAbsX ?? 0;
                    parentAbsY = renderArea._absY ?? (this as any)._dragRenderAreaAbsY ?? 0;
                    const parentWidth = renderArea.width ?? 0;
                    const parentHeight = renderArea.height ?? 0;
                    parentScrollX = renderArea.scrollX ?? 0;
                    parentScrollY = renderArea.scrollY ?? 0;

                    // Scale logical dimensions to pixel space for consistent clamping
                    const widgetPixelW = widgetWidth * renderScaleX;
                    const widgetPixelH = widgetHeight * renderScaleY;
                    const parentPixelW = parentWidth * renderScaleX;
                    const parentPixelH = parentHeight * renderScaleY;
                    if (targetAbsX < parentAbsX) targetAbsX = parentAbsX;
                    if (targetAbsX + widgetPixelW > parentAbsX + parentPixelW)
                        targetAbsX = parentAbsX + parentPixelW - widgetPixelW;
                    if (targetAbsY < parentAbsY) targetAbsY = parentAbsY;
                    if (targetAbsY + widgetPixelH > parentAbsY + parentPixelH)
                        targetAbsY = parentAbsY + parentPixelH - widgetPixelH;
                }

                // Convert pixel-space difference to logical coordinates for CS2 scripts
                const scriptX = ((targetAbsX - parentAbsX) / renderScaleX + parentScrollX) | 0;
                const scriptY = ((targetAbsY - parentAbsY) / renderScaleY + parentScrollY) | 0;

                const dragCompleteCtx: Partial<ScriptEvent> = {
                    mouseX: scriptX,
                    mouseY: scriptY,
                    dragTarget,
                };

                if (w.eventHandlers?.onDragComplete) {
                    this.cs2Vm.invokeEventHandler(w, "onDragComplete", dragCompleteCtx);
                } else if (w.onDragComplete) {
                    this.executeScriptListener(w, w.onDragComplete, dragCompleteCtx);
                }

                // Handle inventory slot drag-drop
                // Check if source is an inventory slot (group 149)
                const sourceGroupId = (w.uid >>> 16) & 0xffff;
                const sourceSlot = (w as any).childIndex ?? -1;

                if (sourceGroupId === 149 && sourceSlot >= 0) {
                    // Prefer OSRS-style targeting via draggedOnWidget (destination slot widget).
                    const targetSlotFromWidget = (dragTarget as any)?.childIndex;
                    const targetGroupId = dragTarget ? (dragTarget.uid >>> 16) & 0xffff : -1;
                    if (
                        typeof targetSlotFromWidget === "number" &&
                        targetGroupId === 149 &&
                        targetSlotFromWidget >= 0 &&
                        targetSlotFromWidget < 28
                    ) {
                        const targetSlot = targetSlotFromWidget | 0;
                        if (targetSlot !== sourceSlot) {
                            this.handleInventorySlotMove(sourceSlot, targetSlot);
                        }
                    } else {
                        // Fallback: derive slot from mouse position (legacy behaviour, less accurate).
                        const invContainer = this.widgetManager.getWidgetByUid(9764864); // 149 << 16
                        const firstSlot = invContainer?.children?.[0];
                        if (
                            invContainer &&
                            firstSlot &&
                            invContainer._absX !== undefined &&
                            invContainer._absY !== undefined
                        ) {
                            const gridOriginX = invContainer._absX + (firstSlot.x || 0);
                            const gridOriginY = invContainer._absY + (firstSlot.y || 0);
                            const relX = mx - gridOriginX;
                            const relY = my - gridOriginY;
                            const slotWidth = 42; // 36px slot + 6px gap
                            const slotHeight = 36; // 32px slot + 4px gap
                            const cols = 4;
                            const rows = 7;

                            const col = Math.floor(relX / slotWidth);
                            const row = Math.floor(relY / slotHeight);

                            if (col >= 0 && col < cols && row >= 0 && row < rows) {
                                const targetSlot = row * cols + col;
                                if (
                                    targetSlot !== sourceSlot &&
                                    targetSlot >= 0 &&
                                    targetSlot < 28
                                ) {
                                    this.handleInventorySlotMove(sourceSlot, targetSlot);
                                }
                            }
                        }
                    }
                } else if (dragTarget != null) {
                    // Non-inventory drag-drop - send IF_BUTTOND packet
                    // OSRS parity: For dynamically created children (fileId === -1),
                    // send the PARENT container's UID, not the child's own UID.
                    // The childIndex is the slot within the container.
                    const sourceIsDynamic = (w as any).fileId === -1;
                    const targetIsDynamic = (dragTarget as any).fileId === -1;

                    const sourceWidgetId = sourceIsDynamic ? (w as any).parentUid ?? w.uid : w.uid;
                    const targetWidgetId = targetIsDynamic
                        ? (dragTarget as any).parentUid ?? dragTarget.uid
                        : dragTarget.uid;

                    const targetSlot = (dragTarget as any).childIndex ?? -1;
                    const sourceItemId = (w as any).itemId ?? -1;
                    const targetItemId = (dragTarget as any).itemId ?? -1;

                    // Send IF_BUTTOND packet for widget drag operations (bank, etc.)
                    sendWidgetDrag(
                        sourceWidgetId,
                        sourceSlot,
                        sourceItemId,
                        targetWidgetId,
                        targetSlot,
                        targetItemId,
                    );
                }

                // Clear deferred action - drag completed so we don't want the "Use" action
                this.deferredWidgetAction = null;

                this.dragSourceWidget = null; // Clear legacy tracker
                this.isDraggingWidget = false;
                this.draggedOnWidget = null;
                this.clickedWidgetParent = null;
                delete (this as any)._dragRenderAreaAbsX;
                delete (this as any)._dragRenderAreaAbsY;
                if ((w as any)._dragPickupOffsetX !== undefined)
                    delete (w as any)._dragPickupOffsetX;
                if ((w as any)._dragPickupOffsetY !== undefined)
                    delete (w as any)._dragPickupOffsetY;
                // Clear drag visual state
                delete (w as any)._dragVisualX;
                delete (w as any)._dragVisualY;
                delete (w as any)._dragAbsX;
                delete (w as any)._dragAbsY;
                delete (w as any)._isDragActive;
            } else {
                // Mouse button released without dragging - fire onClick (for draggable widgets) and onRelease
                const releaseCtx: Partial<ScriptEvent> = {
                    mouseX: mx - (this.clickedWidget._absX ?? this.clickedWidget.x ?? 0),
                    mouseY: my - (this.clickedWidget._absY ?? this.clickedWidget.y ?? 0),
                    opIndex: 1,
                };

                // OSRS parity: For draggable widgets, onClick fires on release (not mousedown)
                // Check if this was a draggable widget that we deferred onClick for
                if (this.isWidgetDraggable(this.clickedWidget)) {
                    const { option, target, slot, itemId } = getPrimaryWidgetAction(
                        this.clickedWidget,
                    );
                    this.handleWidgetAction({
                        widget: this.clickedWidget,
                        option,
                        target,
                        source: "primary",
                        cursorX: releaseCtx.mouseX,
                        cursorY: releaseCtx.mouseY,
                        slot,
                        itemId,
                    });
                }

                // Fire onRelease
                if (this.clickedWidget.eventHandlers?.onRelease) {
                    this.cs2Vm.invokeEventHandler(this.clickedWidget, "onRelease", releaseCtx);
                } else if (this.clickedWidget.onRelease) {
                    this.executeScriptListener(
                        this.clickedWidget,
                        this.clickedWidget.onRelease,
                        releaseCtx,
                    );
                }
            }

            this.clickedWidget = null;
            this.clickedWidgetParent = null;
            this.clickedWidgetHandled = false;
            this.widgetDragDuration = 0;

            // OSRS parity: Process deferred widget action on mouse release (if no drag occurred)
            if (this.deferredWidgetAction && !this.isDraggingWidget) {
                const deferredEvent = this.deferredWidgetAction;
                this.deferredWidgetAction = null;
                // Re-call handleWidgetAction - mouse is now released so it will process
                this.handleWidgetAction(deferredEvent);
            } else {
                // Clear deferred action if drag occurred
                this.deferredWidgetAction = null;
            }
        }
        // OSRS dispatches key events to all widgets with onKey handlers, not just mouse-hovered ones
        if (input.keyEvents.length > 0) {
            // OSRS parity: When inputDialogType > 0, keyboard input is captured for the dialog
            // Type 0 = no dialog, Type 1 = default, Type 2 = interface-scoped, Type 3 = widget-scoped
            const dialogActive = this.cs2Vm.inputDialogType > 0;
            const itemSpawnerSearchHandled =
                !dialogActive && this.handleItemSpawnerSearchKeyEvents(input.keyEvents);

            // Process keyboard input for active dialog before widget handlers
            if (dialogActive) {
                for (const keyEvent of input.keyEvents) {
                    // OSRS internal key codes: 84 = Enter, 85 = Backspace, 13 = Escape
                    const OSRS_KEY_ENTER = 84;
                    const OSRS_KEY_BACKSPACE = 85;
                    const OSRS_KEY_ESCAPE = 13;

                    if (keyEvent.keyTyped === OSRS_KEY_BACKSPACE) {
                        // Backspace - remove last character
                        if (this.cs2Vm.inputDialogString.length > 0) {
                            this.cs2Vm.inputDialogString = this.cs2Vm.inputDialogString.slice(
                                0,
                                -1,
                            );
                            // Update VarC string 335 (chatbox input) for CS2 scripts to read
                            this.varManager.setVarcString(335, this.cs2Vm.inputDialogString);
                            // Update display
                            chatHistory.addMessage(
                                "game",
                                `Enter amount: ${this.cs2Vm.inputDialogString}_`,
                            );
                        }
                    } else if (keyEvent.keyTyped === OSRS_KEY_ESCAPE) {
                        // Escape - cancel dialog
                        this.cs2Vm.inputDialogType = 0;
                        this.cs2Vm.inputDialogWidgetId = -1;
                        this.cs2Vm.inputDialogString = "";
                        this.varManager.setVarcString(335, "");
                        // Clear any pending widget action since user cancelled
                        if (this.pendingInputDialogAction) {
                            chatHistory.addMessage("game", "Input cancelled.");
                            console.log("[InputDialog] Cancelled, clearing pending action");
                            this.pendingInputDialogAction = null;
                        }
                    } else if (keyEvent.keyTyped === OSRS_KEY_ENTER) {
                        // Enter - submit dialog
                        if (
                            this.cs2Vm.inputDialogString.length > 0 &&
                            this.cs2Vm.onInputDialogComplete
                        ) {
                            const value = parseInt(this.cs2Vm.inputDialogString, 10) || 0;
                            console.log(`[InputDialog] Submitting value: ${value}`);
                            this.cs2Vm.onInputDialogComplete("count", value);
                        } else if (this.pendingInputDialogAction) {
                            // No input but pending action - cancel
                            chatHistory.addMessage("game", "No amount entered.");
                            this.pendingInputDialogAction = null;
                        }
                        // Clear dialog state
                        this.cs2Vm.inputDialogType = 0;
                        this.cs2Vm.inputDialogWidgetId = -1;
                        this.cs2Vm.inputDialogString = "";
                        this.varManager.setVarcString(335, "");
                    } else if (keyEvent.keyPressed > 0) {
                        // Regular character input - only accept digits for quantity dialogs
                        const char = String.fromCharCode(keyEvent.keyPressed);
                        // For bank quantity dialogs, only accept digits
                        if (this.pendingInputDialogAction && !/^\d$/.test(char)) {
                            continue; // Skip non-digit characters
                        }
                        // Limit input length (OSRS limits vary by dialog type, 12 for counts, 80 for names)
                        const maxLen = this.cs2Vm.inputDialogType === 3 ? 80 : 12;
                        if (this.cs2Vm.inputDialogString.length < maxLen) {
                            this.cs2Vm.inputDialogString += char;
                            // Update VarC string 335 for CS2 scripts to read
                            this.varManager.setVarcString(335, this.cs2Vm.inputDialogString);
                            // Update display
                            chatHistory.addMessage(
                                "game",
                                `Enter amount: ${this.cs2Vm.inputDialogString}_`,
                            );
                        }
                    }
                }
            }

            if (itemSpawnerSearchHandled) {
                return;
            }

            // Collect ALL widgets with onKey handlers from all roots.
            // Note: some widget trees can reference the same widget via multiple traversal paths
            // (e.g., legacy IF1 `children` plus parentUid-indexed children), so de-duplicate by uid.
            const keyWidgetsByUid = new Map<number, any>();
            for (const root of allRoots) {
                const keyWidgets = collectWidgetsWithKeyHandlers(
                    root,
                    visibleMap,
                    getStaticChildren,
                );
                for (const w of keyWidgets) {
                    const uid = (w?.uid ?? 0) | 0;
                    if (uid !== 0) keyWidgetsByUid.set(uid, w);
                }
            }
            // OSRS PARITY: Also dispatch keys to InterfaceParent-mounted sub-interfaces
            // (e.g., chatbox input handlers). Mounted interfaces are separate widget trees.
            for (const [containerUid, parent] of this.widgetManager.interfaceParents) {
                if (!parent) continue;
                // Skip if the container (or any ancestor) is hidden.
                if (this.widgetManager.isEffectivelyHidden(containerUid)) continue;
                // Root interface is already covered by allRoots.
                if ((parent.group | 0) === (this.widgetManager.rootInterface | 0)) continue;

                const subRoots = this.widgetManager.getAllGroupRoots(parent.group);
                for (const root of subRoots) {
                    const keyWidgets = collectWidgetsWithKeyHandlers(
                        root,
                        visibleMap,
                        getStaticChildren,
                    );
                    for (const w of keyWidgets) {
                        const uid = (w?.uid ?? 0) | 0;
                        if (uid !== 0) keyWidgetsByUid.set(uid, w);
                    }
                }
            }

            // Process all key events for all widgets with onKey handlers
            for (const keyEvent of input.keyEvents) {
                for (const w of keyWidgetsByUid.values()) {
                    const keyCtx: Partial<ScriptEvent> = {
                        mouseX: mx - (w._absX ?? w.x ?? 0),
                        mouseY: my - (w._absY ?? w.y ?? 0),
                        keyTyped: keyEvent.keyTyped,
                        keyPressed: keyEvent.keyPressed,
                    };
                    if (w.eventHandlers?.onKey) {
                        this.cs2Vm.invokeEventHandler(w, "onKey", keyCtx);
                    } else if (w.onKey) {
                        this.executeScriptListener(w, w.onKey, keyCtx);
                    }
                }
            }
        }
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
        // Process in priority order: scriptEvents2 (timer/low), scriptEvents3 (release/medium), scriptEvents (normal)
        // OSRS processes them in this order within the main loop

        // PERF: Use for-loop + length reset instead of shift() which is O(n) per call
        // Process normal priority events first
        let events = this.scriptEvents;
        for (let i = 0, len = events.length; i < len; i++) {
            const event = events[i];
            // Check if widget is still valid before running
            if (event.widget && this.isWidgetValid(event.widget)) {
                this.cs2Vm.runScriptEvent(event);
            }
        }
        this.scriptEvents = [];

        // Process medium priority events (onRelease, onMouseLeave)
        events = this.scriptEvents3;
        for (let i = 0, len = events.length; i < len; i++) {
            const event = events[i];
            if (event.widget && this.isWidgetValid(event.widget)) {
                this.cs2Vm.runScriptEvent(event);
            }
        }
        this.scriptEvents3 = [];

        // Process low priority events (onTimer) last
        events = this.scriptEvents2;
        for (let i = 0, len = events.length; i < len; i++) {
            const event = events[i];
            if (event.widget && this.isWidgetValid(event.widget)) {
                this.cs2Vm.runScriptEvent(event);
            }
        }
        this.scriptEvents2 = [];
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

    /**
     * OSRS parity: target mask comes from bits 11-16 of current widget flags
     * (cache flags overridden by IF_SETEVENTS when present).
     */
    private getWidgetTargetMask(widget: any): number {
        if (!widget) return 0;
        const flags =
            this.widgetManager?.getWidgetFlags?.(widget) ??
            (typeof widget.flags === "number" ? widget.flags | 0 : 0);
        return (flags >>> 11) & 0x3f;
    }

    /**
     * Resolve the widget key used for transmit-flag checks (IF_SETEVENTS).
     * Dynamic widget actions are keyed by (parentId, childIndex), so when an event surfaces
     * the static parent we must map to the dynamic child slot before checking flags.
     */
    private resolveTransmitFlagWidget(eventWidget: any, payload: WidgetActionClientPayload): any {
        const slot = typeof payload.slot === "number" ? payload.slot | 0 : -1;
        if (slot < 0) return eventWidget;

        const eventIsExactDynamicChild =
            (eventWidget?.fileId | 0) === -1 &&
            typeof eventWidget?.childIndex === "number" &&
            (eventWidget.childIndex | 0) === slot;
        if (eventIsExactDynamicChild) return eventWidget;

        const parentId = payload.widgetId | 0;
        const parent = this.widgetManager?.getWidgetByUid?.(parentId);
        if (parent && Array.isArray((parent as any).children)) {
            const child = (parent as any).children[slot];
            if (
                child &&
                (child.fileId | 0) === -1 &&
                typeof child.childIndex === "number" &&
                (child.childIndex | 0) === slot
            ) {
                return child;
            }
        }

        // Fallback synthetic key: allows getWidgetFlags override lookup by (id, childIndex).
        return { id: parentId, childIndex: slot, flags: 0 };
    }

    private buildWidgetActionPayload(event: {
        widget?: any;
        option?: string;
        target?: string;
        source?: "menu" | "primary";
        cursorX?: number;
        cursorY?: number;
        slot?: number;
        itemId?: number;
    }): WidgetActionClientPayload | undefined {
        const widget = event.widget;
        if (!widget) return undefined;
        const ids = this.resolveWidgetIdentifiers(widget);
        if (!ids) return undefined;
        const option = sanitizeText(event.option) ?? event.option?.trim() ?? "";
        const target = sanitizeText(event.target) ?? event.target?.trim() ?? "";
        const payload: WidgetActionClientPayload = {
            widgetId: ids.widgetId,
            groupId: ids.groupId,
            childId: ids.childId,
        };
        if (option.length) payload.option = option;
        if (target.length) payload.target = target;
        const opId = this.inferWidgetOpId(widget, option.length ? option : undefined);
        if (typeof opId === "number") payload.opId = opId;
        if (typeof event.cursorX === "number") payload.cursorX = event.cursorX;
        if (typeof event.cursorY === "number") payload.cursorY = event.cursorY;
        // Slot is only meaningful for inventory actions (item slot) and dynamic widgets (CC_CREATE childIndex).
        // For static widgets, omit slot so the wire packet uses 65535 ("no slot").
        const explicitSlot = typeof event.slot === "number" ? event.slot | 0 : undefined;
        const dynamicSlot =
            (widget.fileId | 0) === -1 && typeof widget.childIndex === "number"
                ? widget.childIndex | 0
                : undefined;
        let slot =
            explicitSlot !== undefined && explicitSlot >= 0
                ? explicitSlot
                : dynamicSlot !== undefined && dynamicSlot >= 0
                ? dynamicSlot
                : undefined;
        const recoverSlotByOptionTarget = (parent: any): number | undefined => {
            if (!parent || !Array.isArray(parent.children) || option.length === 0) return undefined;
            const optionLower = option.toLowerCase();
            const targetLower = target.length > 0 ? target.toLowerCase() : undefined;
            for (const child of parent.children as any[]) {
                if (!child || (child.fileId | 0) !== -1) continue;
                if (typeof child.childIndex !== "number" || (child.childIndex | 0) < 0) continue;

                const childActions: Array<string | null | undefined> = Array.isArray(child.actions)
                    ? child.actions
                    : [];
                const childHasOption = childActions.some((action) => {
                    const sanitized = sanitizeText(action)?.toLowerCase();
                    return !!sanitized && sanitized === optionLower;
                });
                if (!childHasOption) continue;

                if (targetLower) {
                    const childTarget = getWidgetTargetLabel(child).toLowerCase();
                    if (!childTarget || childTarget !== targetLower) continue;
                }
                return child.childIndex | 0;
            }
            return undefined;
        };

        const recoverSlotByPosition = (parent: any, sourceWidget: any): number | undefined => {
            if (
                !parent ||
                !Array.isArray(parent.children) ||
                typeof event.cursorX !== "number" ||
                typeof event.cursorY !== "number"
            ) {
                return undefined;
            }

            let localX = event.cursorX | 0;
            let localY = event.cursorY | 0;

            const sourceAbsX =
                typeof sourceWidget?._absX === "number"
                    ? (sourceWidget._absX as number) | 0
                    : undefined;
            const sourceAbsY =
                typeof sourceWidget?._absY === "number"
                    ? (sourceWidget._absY as number) | 0
                    : undefined;
            const parentAbsX =
                typeof parent?._absX === "number" ? (parent._absX as number) | 0 : undefined;
            const parentAbsY =
                typeof parent?._absY === "number" ? (parent._absY as number) | 0 : undefined;

            if (
                parent !== sourceWidget &&
                sourceAbsX !== undefined &&
                sourceAbsY !== undefined &&
                parentAbsX !== undefined &&
                parentAbsY !== undefined
            ) {
                // Convert source-widget local coords -> absolute -> parent local coords.
                localX = localX + sourceAbsX - parentAbsX;
                localY = localY + sourceAbsY - parentAbsY;
            } else {
                const parentW =
                    typeof parent.width === "number" ? Math.max(0, parent.width | 0) : 0;
                const parentH =
                    typeof parent.height === "number" ? Math.max(0, parent.height | 0) : 0;
                const looksRelative =
                    localX >= 0 &&
                    localY >= 0 &&
                    (parentW <= 0 || localX < parentW) &&
                    (parentH <= 0 || localY < parentH);
                if (!looksRelative && parentAbsX !== undefined && parentAbsY !== undefined) {
                    localX -= parentAbsX;
                    localY -= parentAbsY;
                }
            }

            const scrollX = typeof parent.scrollX === "number" ? parent.scrollX | 0 : 0;
            const scrollY = typeof parent.scrollY === "number" ? parent.scrollY | 0 : 0;

            for (let i = parent.children.length - 1; i >= 0; i--) {
                const child = parent.children[i];
                if (!child || (child.fileId | 0) !== -1) continue;
                if (typeof child.childIndex !== "number" || (child.childIndex | 0) < 0) continue;
                if (child.hidden || child.hide) continue;

                const childX = (typeof child.x === "number" ? child.x | 0 : 0) - scrollX;
                const childY = (typeof child.y === "number" ? child.y | 0 : 0) - scrollY;
                const childW = Math.max(1, typeof child.width === "number" ? child.width | 0 : 0);
                const childH = Math.max(1, typeof child.height === "number" ? child.height | 0 : 0);
                if (
                    localX < childX ||
                    localY < childY ||
                    localX >= childX + childW ||
                    localY >= childY + childH
                ) {
                    continue;
                }

                const childFlags =
                    this.widgetManager?.getWidgetFlags?.(child) ??
                    (typeof child.flags === "number" ? child.flags | 0 : 0);
                const hasTransmitOps = (childFlags & 0x7fe) !== 0;
                const childActions: Array<string | null | undefined> = Array.isArray(child.actions)
                    ? child.actions
                    : [];
                const hasAction = childActions.some((action) => !!sanitizeText(action));
                const hasOpHandler = !!(child.onOp || child.eventHandlers?.onOp);
                if (!hasTransmitOps && !hasAction && !hasOpHandler) continue;

                return child.childIndex | 0;
            }
            return undefined;
        };

        const candidateParents: any[] = [];
        if ((widget.fileId | 0) !== -1) {
            candidateParents.push(widget);
            const canonicalParent = this.widgetManager?.getWidgetByUid?.(ids.widgetId | 0);
            if (canonicalParent && canonicalParent !== widget) {
                candidateParents.push(canonicalParent);
            }
        }

        for (const parent of candidateParents) {
            if (slot === undefined) slot = recoverSlotByOptionTarget(parent);
            if (slot === undefined) slot = recoverSlotByPosition(parent, widget);
            if (typeof slot === "number" && slot >= 0) break;
        }

        if (typeof slot === "number" && slot >= 0) payload.slot = slot;
        if (typeof event.itemId === "number") payload.itemId = event.itemId;
        if (event.source) payload.isPrimary = event.source === "primary";
        return payload;
    }

    private resolveWidgetIdentifiers(
        widget: any,
    ): { widgetId: number; groupId: number; childId: number } | undefined {
        if (!widget) return undefined;
        // Dynamic widgets created via CC_CREATE / CC_COPY:
        // OSRS identifies these via (parent widget id, childIndex). They do NOT have a stable
        // cache fileId, and any runtime uid we assign is an implementation detail.
        if ((widget.fileId | 0) === -1) {
            // Some input layers may pass a shallow widget snapshot that omits `id` but keeps `parentUid`.
            // OSRS packets use the PARENT widget id for dynamic children; the dynamic child's own id/uid
            // is not transmitted (only childIndex is carried in the packet slot).
            const parentId =
                typeof widget.parentUid === "number"
                    ? widget.parentUid | 0
                    : typeof widget.id === "number"
                    ? widget.id | 0
                    : undefined;
            if (parentId === undefined) {
                // Fall through to UID-derived identifiers (best-effort)
            } else {
                const widgetId = parentId | 0;
                const groupId = (widgetId >>> 16) | 0;
                const childId = widgetId & 0xffff;
                return { widgetId, groupId, childId };
            }
        }
        const hasUid = typeof widget.uid === "number";
        const groupId =
            typeof widget.groupId === "number"
                ? widget.groupId | 0
                : hasUid
                ? (widget.uid >>> 16) | 0
                : undefined;
        if (groupId === undefined) return undefined;
        // fileId of -1 means "not set", so only use it if it's >= 0
        const childId =
            typeof widget.fileId === "number" && widget.fileId >= 0
                ? widget.fileId | 0
                : hasUid
                ? widget.uid & 0xffff
                : 0;
        const widgetId = ((groupId & 0xffff) << 16) | (childId & 0xffff);
        return { widgetId, groupId, childId };
    }

    private inferWidgetOpId(widget: any, option?: string): number | undefined {
        const normalized = sanitizeText(option)?.toLowerCase();
        if (!normalized) return undefined;
        const verb = sanitizeText(widget?.targetVerb)?.toLowerCase();
        if (verb && normalized === verb) return 0;
        const actions: Array<string | null | undefined> = Array.isArray(widget?.actions)
            ? widget.actions
            : [];
        for (let i = 0; i < actions.length; i++) {
            const act = sanitizeText(actions[i])?.toLowerCase();
            if (act && act === normalized) {
                // Align with OSRS numbering where OP1 corresponds to the first entry
                return i + 1;
            }
        }
        return undefined;
    }

    updateChatboxVisibility(): void {
        // Server now controls chatbox visibility via set_hidden widget events.
        const hidden = false;
        try {
            const canvas: any = (this.renderer as any)?.canvas;
            const ui = canvas?.__ui;
            if (ui?.chatbox) {
                ui.chatbox.contentVisible = !hidden;
            }
        } catch {}
    }

    setRunMode(on: boolean, force: boolean = false): void {
        const normalized = !!on;
        const currentVarp = this.varManager?.getVarp(VARP_OPTION_RUN) ?? 0;
        const currentRunOn = currentVarp !== 0;
        if (!force && normalized === currentRunOn) return;

        // Set varp - this triggers onVarpChange which:
        // 1. Syncs this.runMode
        // 2. Sends varp_transmit to server (since varp 173 is in TRANSMIT_VARPS)
        this.varManager?.setVarp(VARP_OPTION_RUN, normalized ? 1 : 0);

        // Update ECS running state
        try {
            const idx = this.playerEcs.getIndexForServerId(this.controlledPlayerServerId);
            if (idx !== undefined) {
                this.playerEcs.setRunning(idx, normalized);
            }
        } catch {}
    }

    getSpecialEnergy(): number {
        return this.specialEnergyPercent;
    }

    isSpecialAttackEnabled(): boolean {
        return this.specialAttackEnabled;
    }

    setSpecialAttackEnabled(on: boolean, opts: { fromServer?: boolean } = {}): void {
        const normalized = !!on;
        this.specialAttackEnabled = normalized;
        // CS2 reads %sa_attack (varp 301) for special attack toggle state
        this.varManager?.setVarp(301, normalized ? 1 : 0);
        if (opts.fromServer) return;
    }

    toggleSpecialAttack(): void {
        this.setSpecialAttackEnabled(!this.specialAttackEnabled);
    }

    updateSpecialEnergy(percent: number): void {
        this.specialEnergyPercent = Math.max(0, Math.min(100, Math.floor(percent)));
        // CS2 reads %sa_energy (varp 300) which stores 0-1000 (divides by 10 for percentage display)
        this.varManager?.setVarp(300, this.specialEnergyPercent * 10);
    }

    setAutoRetaliate(on: boolean, fromServer: boolean = false): void {
        const normalized = !!on;
        if (!fromServer && normalized === this.autoRetaliateEnabled) return;
        this.autoRetaliateEnabled = normalized;
    }

    setCombatStyleSlot(
        style: number,
        opts: { fromServer?: boolean; category?: number } = {},
    ): void {
        const normalized = Math.max(0, style | 0);
        const category = opts.category ?? this.combatWeaponCategory;
        this.combatStyleSlot = normalized;
        // CRITICAL: Update varp 43 so CS2 scripts know the selected combat style
        // This affects which button is highlighted in the combat options interface
        if (this.varManager) {
            this.varManager.setVarp(VARP_ATTACK_STYLE, normalized);
        }
        if (opts.fromServer) return;
    }

    setActivePrayers(
        prayers: Iterable<string | PrayerName>,
        opts: { fromServer?: boolean } = {},
    ): void {
        const normalized = Array.from(prayers ?? [])
            .map((p) => String(p) as PrayerName)
            .filter((name): name is PrayerName => PRAYER_NAME_SET.has(name));
        const unique = Array.from(new Set(normalized));
        const prev = this.activePrayers;
        const changed = unique.length !== prev.size || unique.some((entry) => !prev.has(entry));
        if (changed || opts.fromServer) {
            this.activePrayers = new Set(unique);
            // Sync prayer varbits for CS2 scripts
            this.syncPrayerVarbits();
        }
        if (opts.fromServer || !changed) return;
    }

    /** Sync prayer state to varbits for CS2 scripts (prayer_op, prayer_redraw, etc.) */
    private syncPrayerVarbits(): void {
        if (!this.varManager) return;

        // Set individual prayer varbits (4104-4129, 5464-5466)
        // Each prayer has its own 1-bit varbit that shares an underlying varp
        // CS2 scripts read %prayer_allactive which is the raw varp containing all bits
        for (const [prayerName, varbitId] of Object.entries(PRAYER_NAME_TO_VARBIT)) {
            const isActive = this.activePrayers.has(prayerName as PrayerName) ? 1 : 0;
            this.varManager.setVarbit(varbitId, isActive);
        }
    }

    /** Sync quick prayer state to varbits for CS2 scripts */
    private syncQuickPrayerVarbits(): void {
        if (!this.varManager) return;

        // Sync quick-prayer selected bitmask for setup UI scripts.
        // quickprayer_selected uses the same bit positions as prayer_allactive.
        this.varManager.setVarbit(
            PrayerVarbits.QUICKPRAYER_SELECTED,
            prayerSetToBitmask(this.quickPrayers),
        );

        // Set QUICKPRAYER_ACTIVE flag (varbit 4103) - whether quick prayers are enabled
        this.varManager.setVarbit(
            PrayerVarbits.QUICKPRAYER_ACTIVE,
            this.quickPrayersEnabled ? 1 : 0,
        );
    }

    setQuickPrayers(
        prayers: Iterable<string | PrayerName>,
        opts: { fromServer?: boolean } = {},
    ): void {
        const normalized = Array.from(prayers ?? [])
            .map((p) => String(p) as PrayerName)
            .filter((name): name is PrayerName => PRAYER_NAME_SET.has(name));
        const unique = Array.from(new Set(normalized));
        const prev = this.quickPrayers;
        const changed = unique.length !== prev.size || unique.some((entry) => !prev.has(entry));
        if (changed || opts.fromServer) {
            this.quickPrayers = new Set(unique);
            // Sync quick prayer varbits for CS2 scripts
            this.syncQuickPrayerVarbits();
        }
        if (opts.fromServer || !changed) return;
    }

    setQuickPrayersEnabled(enabled: boolean, opts: { fromServer?: boolean } = {}): void {
        const normalized = !!enabled;
        if (this.quickPrayersEnabled === normalized && !opts.fromServer) return;
        this.quickPrayersEnabled = normalized;
        // Sync quick prayer varbits for CS2 scripts
        this.syncQuickPrayerVarbits();
    }

    setCombatSpell(spellId: number | null, opts: { fromServer?: boolean } = {}): void {
        const normalized =
            spellId != null && Number.isFinite(spellId) && (spellId | 0) > 0 ? spellId | 0 : -1;
        this.combatSpellId = normalized;
        if (opts.fromServer) return;
    }

    attackNpc(options: {
        npcServerId?: number;
        npcTypeId?: number;
        mapX?: number;
        mapY?: number;
        tile?: { tileX: number; tileY: number };
    }): void {
        const tile = options.tile ?? this.menuTile ?? this.hoveredTile;

        try {
            // Prefer npcServerId if provided (new path), otherwise fall back to npcTypeId lookup
            let serverId: number | undefined;
            if (typeof options.npcServerId === "number" && options.npcServerId > 0) {
                serverId = options.npcServerId | 0;
            } else if (typeof options.npcTypeId === "number" && options.npcTypeId >= 0) {
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
                sendNpcInteract(serverId, "Attack");
                return;
            }
        } catch (err) {
            console.warn?.("[OsrsClient] failed to send npc attack", err);
        }

        if (tile) {
            try {
                this.playerInteractionSystem.beginFaceTile(tile.tileX | 0, tile.tileY | 0);
            } catch {}
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

        const appearance = data?.appearance;
        if (appearance && typeof appearance === "object") {
            // Sync equipment inventory only for local player
            const isLocalPlayer = serverId === this.controlledPlayerServerId;
            const pa = this.buildPlayerAppearanceFromPayload(appearance, isLocalPlayer);
            this.playerEcs.setAppearance(ecsIndex, pa);
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
                // OSRS parity: expose local gender to CS2 via player_design_bodytype varbit.
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

        // OSRS parity: apply animation set from appearance block (like Player.read() in reference)
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
        // OSRS PARITY: Mark inv cycle for equipment (94) - handlers fire during processWidgetTransmits()
        markInvTransmit(94);
    }

    setSelectedSpell(spell: SelectedSpellInfo | null, sourceWidget?: any): void {
        // DEBUG: Log setSelectedSpell call
        console.log(
            `[setSelectedSpell] Called with spell=${spell?.spellName}, sourceWidget=${sourceWidget?.uid}`,
        );

        // Fire onTargetLeave on previous source widget if we're switching targets
        if (ClientState.selectedSpellSourceWidget) {
            this.fireOnTargetLeave(ClientState.selectedSpellSourceWidget);
            try {
                this.widgetManager.invalidateWidgetRender(
                    ClientState.selectedSpellSourceWidget,
                    "spell-target-leave",
                );
            } catch {}
        }

        if (spell) {
            // Set all spell selection state in ClientState (single source of truth)
            ClientState.isSpellSelected = true;
            ClientState.selectedSpellId = spell.spellId | 0;
            ClientState.selectedSpellName = spell.spellName;
            ClientState.selectedSpellLevel = spell.spellLevel ?? 0;
            ClientState.selectedSpellRunes =
                spell.runes?.map((r) => ({
                    itemId: r.itemId | 0,
                    quantity: r.quantity | 0,
                    name: r.name,
                })) ?? [];
            ClientState.selectedSpellSourceWidget = sourceWidget ?? spell.sourceWidget ?? null;
            // OSRS parity: Set target mask from current widget flags (if not already set)
            // This determines what entity types the spell can target.
            if (ClientState.selectedSpellTargetMask === 0 && sourceWidget) {
                ClientState.selectedSpellTargetMask = this.getWidgetTargetMask(sourceWidget);
            }
        } else {
            ClientState.clearSpellSelection();
        }

        // Fire onTargetEnter on the new source widget
        console.log(
            `[setSelectedSpell] After set: isSpellSelected=${ClientState.isSpellSelected}, sourceWidget=${ClientState.selectedSpellSourceWidget?.uid}`,
        );
        if (ClientState.selectedSpellSourceWidget) {
            this.fireOnTargetEnter(ClientState.selectedSpellSourceWidget);
            try {
                this.widgetManager.invalidateWidgetRender(
                    ClientState.selectedSpellSourceWidget,
                    "spell-target-enter",
                );
            } catch {}
        } else {
            console.log(`[setSelectedSpell] No sourceWidget to fire onTargetEnter`);
        }
    }

    clearSelectedSpell(): void {
        const sourceWidget = ClientState.selectedSpellSourceWidget;
        // Fire onTargetLeave on the source widget before clearing
        if (sourceWidget) {
            this.fireOnTargetLeave(sourceWidget);
        }
        ClientState.clearSpellSelection();
        if (sourceWidget) {
            try {
                this.widgetManager.invalidateWidgetRender(sourceWidget, "spell-target-leave");
            } catch {}
        }
    }

    /**
     * Fire onTargetEnter event on a widget when entering targeting mode
     */
    private fireOnTargetEnter(widget: any): void {
        if (!widget) return;

        // DEBUG: Log onTargetEnter info
        console.log(
            `[onTargetEnter] Widget uid=${widget.uid}, hasEventHandlers=${!!widget.eventHandlers
                ?.onTargetEnter}, hasOnTargetEnter=${
                Array.isArray(widget.onTargetEnter) && widget.onTargetEnter.length > 0
            }`,
        );

        // Check for runtime-set handler first
        if (widget.eventHandlers?.onTargetEnter) {
            console.log(`[onTargetEnter] Invoking eventHandlers.onTargetEnter`);
            this.cs2Vm.invokeEventHandler(widget, "onTargetEnter");
        } else if (Array.isArray(widget.onTargetEnter) && widget.onTargetEnter.length > 0) {
            console.log(`[onTargetEnter] Executing script listener`, widget.onTargetEnter);
            this.executeScriptListener(widget, widget.onTargetEnter);
        } else {
            console.log(`[onTargetEnter] No handler found for widget`);
        }
    }

    /**
     * Fire onTargetLeave event on a widget when leaving targeting mode
     */
    private fireOnTargetLeave(widget: any): void {
        if (!widget) return;

        // Check for runtime-set handler first
        if (widget.eventHandlers?.onTargetLeave) {
            this.cs2Vm.invokeEventHandler(widget, "onTargetLeave");
        } else if (Array.isArray(widget.onTargetLeave) && widget.onTargetLeave.length > 0) {
            this.executeScriptListener(widget, widget.onTargetLeave);
        }
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
            // Deob parity: clicking a spell target updates destination marker and mouse cross
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

        // OSRS parity: any completed menu action while a spell is selected clears spell targeting,
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
        // OSRS parity: world "Use" state is tracked in ClientState, not inventory UI selection.
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

        if (tile && dispatched) {
            try {
                this.playerInteractionSystem.beginFaceTile(tile.tileX | 0, tile.tileY | 0);
            } catch {}
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
                              Math.min(0.999, Number.isFinite(serverTiming.phase) ? serverTiming.phase : 0),
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
                sendNpcInteract(serverId, option);
                return;
            }
        } catch (err) {
            console.warn?.("[OsrsClient] failed to send npc interact", err);
        }

        if (!isServerConnected() && tile) {
            try {
                this.playerInteractionSystem.beginFaceTile(tile.tileX | 0, tile.tileY | 0);
            } catch {}
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

        this.workerPool.loadCachedMapImages().then((mapImageUrls) => {
            const now = performance.now();
            mapImageUrls.forEach((value, key) => {
                this.mapImageUrls.set(key, value);
                this.mapImageAccess.set(key, now);
            });
            // Avoid starting with too many blob URLs retained
            this.pruneUrlMapLRU(
                this.mapImageUrls,
                this.mapImageAccess,
                this.getMapImageUrlLimit(false),
            );
        });
    }

    // ========== Login Screen Methods ==========

    /**
     * Update the game state and handle transitions.
     * Matches reference client updateGameState() with cleanup/setup logic.
     *
     * Uses the centralized GameStateMachine for atomic transitions.
     */
    updateGameState(newState: GameState): void {
        const oldState = this.gameState;
        if (oldState === newState) return;

        if (shouldFadeOutLoginMusicForTransition(oldState, newState)) {
            this.cancelPendingLoginMusicStart();
            try {
                // OSRS parity: leaving the login/title flow clears title music via clearSongs(0, 100).
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
            this.loginState.networkState = 0;
            // Reset loading tracker on return to login
            this.loadingTracker.reset();
            // Full reset when returning to login screen (clears chat, vars, transmit cycles)
            this.resetWorld(true);
            // Flush buffered keystrokes so in-game typing does not leak into login fields
            try { this.inputManager.flushInput(); } catch {}
        }

        if (newState === GameState.CONNECTING) {
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
                    if (this.loginState.username.trim().length === 0) {
                        this.loginState.setResponse(
                            "",
                            "Please enter your username/email address.",
                            "",
                            "",
                        );
                    } else {
                        this.loginState.setResponse("", "Please enter your password.", "", "");
                    }
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

            // Set credentials and trigger login
            this.loginState.username = username;
            this.loginState.password = password;
            this.loginState.loginIndex = LoginIndex.LOGIN_FORM;
            this.loginState.savePersistedLoginState();
            this.updateGameState(GameState.CONNECTING);
            sendLogin(username.trim(), password);
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

        // OSRS parity: First show "Loading - please wait." (gameState 25)
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
            // OSRS parity: Client.cycleCntr advances once per 20ms client tick.
            this.transmitCycles.cycleCntr++;

            // OSRS parity: midi manager tasks advance on the 20ms client tick.
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

            // OSRS parity: Widget transmit handlers and timers are processed on the client tick,
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
                this.tickItemSpawnerSearchUi();
            } catch {}
            try {
                this.tryWriteVarcs();
            } catch {}
            // OSRS parity: type-6 widget model animations are advanced using Client.graphicsCycle
            // during drawWidgets(); keep them on the 20ms tick so frame timing is correct.
            try {
                this.widgetManager.tickModelAnimations(1, this.seqTypeLoader);
            } catch {}
        }
    }

    initCache(cache: LoadedCache): void {
        // Transition from DOWNLOADING to LOADING state
        if (this.gameState === GameState.DOWNLOADING) {
            this.updateGameState(GameState.LOADING);
        }

        this.loadedCache = cache;
        this.cs2ScriptCache.clear();

        // Create CacheSystem - may have no indices yet if using deferred loading
        // Indices will be added incrementally during runPhasedLoading
        this.cacheSystem = CacheSystem.fromFiles(cache.type, cache.files);

        // Initialize worker pool early - it needs cache files but not indices
        this.workerPool.initCache(cache, this.objSpawns, []);

        this.clearNpcInstancesLocal();
        this.clearMapImageUrls();

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
            this.spotAnimTypeLoader = this.loaderFactory.getSpotAnimTypeLoader();
            this.locTypeLoader = this.loaderFactory.getLocTypeLoader();
            this.objTypeLoader = this.loaderFactory.getObjTypeLoader();
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
            this.applyNpcInstanceNameOverrides();
            this.writeVarcs();
            this.varcsUnwrittenChanges = false;
            this.varcsLastWriteTimeMs = 0;
            this.varManager = new VarManager(
                this.loaderFactory.getVarBitTypeLoader(),
                this.loaderFactory.getVarcIntTypeLoader(),
            );
            this.varcsStorageKey = getBrowserVarcsStorageKey(cache.info);
            this.varManager.restorePersistentVarcs(loadBrowserVarcs(this.varcsStorageKey));
            this.accountTypeVarbitAvailable = undefined;

            this.varManager.setVarp(300, 1000); // Special attack energy
            this.syncPrayerVarbits();

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
            };
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

            if (this.renderer?.canvas) {
                const canvas = this.renderer.canvas;
                const clientW = canvas.clientWidth || canvas.offsetWidth;
                const clientH = canvas.clientHeight || canvas.offsetHeight;
                let layoutW = clientW;
                let layoutH = clientH;
                if (layoutW <= 0 || layoutH <= 0) {
                    const rect = canvas.getBoundingClientRect();
                    layoutW = rect.width;
                    layoutH = rect.height;
                }
                if (
                    !Number.isFinite(layoutW) ||
                    layoutW <= 0 ||
                    !Number.isFinite(layoutH) ||
                    layoutH <= 0
                ) {
                    const bufferW = (canvas.width || DEFAULT_SCREEN_WIDTH) | 0;
                    const bufferH = (canvas.height || DEFAULT_SCREEN_HEIGHT) | 0;
                    layoutW = bufferW;
                    layoutH = bufferH;
                }
                this.widgetManager.resize(
                    Math.max(1, Math.round(layoutW)),
                    Math.max(1, Math.round(layoutH)),
                );
            }

            this.startClientTickLoop();
            this.renderer.initCache();
            this.flushPendingHitsplats();
            this.flushPendingPlayerHealthBars();
            this.flushPendingNpcHealthBars();
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
                this.inventory.setSlot(
                    idx,
                    slot.itemId | 0,
                    typeof slot.quantity === "number" ? slot.quantity | 0 : 0,
                );
            }
        }

        try {
            console.log("[inventory] snapshot post-update", this.inventory.getSlots());
        } catch {}

        // OSRS PARITY: Mark inv cycle with specific inventory ID - handlers fire during processWidgetTransmits()
        // Inventory ID 93 is the player inventory in OSRS
        markInvTransmit(93);
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

        // OSRS PARITY: Mark inv cycle for bank (95) - handlers fire during processWidgetTransmits()
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

        // OSRS PARITY: Mark inv cycle for collection_transmit (620) - handlers fire during processWidgetTransmits()
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

        // OSRS PARITY: Mark inv cycle for shop (516) - handlers fire during processWidgetTransmits()
        markInvTransmit(516);
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

    private applyDisplayDefaults(): void {
        this.renderDistance = clampRenderDistance(this.renderDistance);
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
        const next = Number.isFinite(limit) ? Math.max(0, limit | 0) : 0;
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
            : this.lastNpcDecodeBase;  // use last known base regardless of localId
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
            // OSRS parity (class136.method4170 -> RSNPC.method3656):
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

            // Keep the instance map entry up to date for geometry streaming.
            this.upsertNpcInstanceFromBinary(
                serverId,
                spawn.typeId | 0,
                worldTileX,
                worldTileY,
                spawn.level | 0,
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
        this.npcEcs.setTargetRot(ecsId, spawn.rot | 0);
        this.npcEcs.setRotation(ecsId, spawn.rot | 0);
        this.npcEcs.setOccTile(ecsId, localTileX, localTileY, spawn.level | 0);

        // OSRS parity: Actor world coords include size-based center offset (size * 64).
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
                    // OSRS parity: Add a hold buffer (1 server tick = 30 cycles)
                    // so seqTicksLeft outlasts the animation frames. This prevents
                    // NPCs from flashing back to idle between their death animation
                    // ending and the server despawn arriving.
                    // NOTE: The canonical OSRS fix is a very long hold frame (65535
                    // cycles) on the last frame of every death animation in the cache.
                    // This client-side buffer is a workaround until cache animations
                    // include proper hold frames.
                    const ticks = this.estimateSeqDurationTicks(seqId) + 30;
                    this.npcEcs.handleServerSequence(ecsId, seqId, ticks, block.seq.delay | 0);
                    this.npcEcs.setFrameIndex(ecsId, 0);
                    this.npcEcs.setAnimTick(ecsId, 0);
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
                else this.pendingHitsplats.push(payload);
            }
        }

        if (Array.isArray(block.healthBars)) {
            for (const bar of block.healthBars) {
                const entry = { serverId, bar };
                if (this.renderer) {
                    (this.renderer as any).registerNpcHealthBarUpdate?.(entry);
                } else {
                    this.pendingNpcHealthBars.push(entry);
                }
            }
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
                // OSRS parity: spot animation delay is in client cycles (Client.cycle units).
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
    ): void {
        const sid = serverId | 0;
        const key = `sid:${sid}`;
        const mapX = getMapIndexFromTile(worldTileX | 0);
        const mapY = getMapIndexFromTile(worldTileY | 0);
        const mapId = getMapSquareId(mapX, mapY);

        const prev = this.npcInstanceMap.get(key);
        if (prev) {
            const prevMapX = getMapIndexFromTile(prev.x | 0);
            const prevMapY = getMapIndexFromTile(prev.y | 0);
            const prevMapId = getMapSquareId(prevMapX, prevMapY);
            if (prevMapId !== mapId) {
                this.npcInstanceMapsPendingReload.add(prevMapId);
                this.npcInstanceMapsPendingReload.add(mapId);
            }
            prev.typeId = typeId | 0;
            prev.x = worldTileX | 0;
            prev.y = worldTileY | 0;
            prev.level = level | 0;
            prev.serverId = sid;
        } else {
            this.npcInstanceMap.set(key, {
                serverId: sid,
                typeId: typeId | 0,
                x: worldTileX | 0,
                y: worldTileY | 0,
                level: level | 0,
            });
            this.npcInstanceMapsPendingReload.add(mapId);
        }
        this.scheduleNpcInstanceFlush();
    }

    private despawnNpcBinary(serverId: number): void {
        const sid = serverId | 0;
        if (sid <= 0) return;
        const instanceKey = `sid:${sid}`;
        const existingInstance = this.npcInstanceMap.get(instanceKey);
        // Keep OSRS-style global NPC index array in sync for menuAction packet gates.
        ClientState.npcs[sid] = null;
        try {
            (this.renderer as any)?.clearNpcHealthBars?.(sid);
        } catch {}
        const ecsId = this.npcEcs.getEcsIdForServer(sid);
        if (ecsId !== undefined) {
            this.npcEcs.destroyNpc(ecsId);
        }
        this.npcInstanceMap.delete(instanceKey);
        if (existingInstance) {
            const mapX = getMapIndexFromTile(existingInstance.x | 0);
            const mapY = getMapIndexFromTile(existingInstance.y | 0);
            const mapId = getMapSquareId(mapX, mapY);
            this.npcInstanceMapsPendingReload.add(mapId);
            this.scheduleNpcInstanceFlush();
        }
    }

    private estimateSeqDurationTicks(seqId: number): number {
        const seqType = this.seqTypeLoader?.load?.(seqId);
        if (!seqType) return 0;
        try {
            if (seqType.isSkeletalSeq?.()) {
                return seqType.getSkeletalDuration?.() | 0;
            }
            const frameCount = Math.max(1, seqType.frameIds?.length ?? 1);
            let total = 0;
            for (let i = 0; i < frameCount; i++) {
                const len = seqType.getFrameLength?.(this.seqFrameLoader, i) ?? 1;
                total += len | 0;
            }
            return total > 0 ? total : frameCount;
        } catch {
            return 0;
        }
    }

    notifyRendererReady(): void {
        if (this.npcInstanceMapsPendingReload.size > 0) {
            this.scheduleNpcInstanceFlush();
        }
    }

    private scheduleNpcInstanceFlush(): void {
        if (this.npcInstanceFlushScheduled) return;
        this.npcInstanceFlushScheduled = true;
        Promise.resolve().then(() => {
            this.npcInstanceFlushScheduled = false;
            this.flushNpcInstances().catch((err) => {
                console.warn("[OsrsClient] failed to flush NPC instances", err);
            });
        });
    }

    private scheduleNpcInstanceFlushFallback(): void {
        if (this.npcInstanceFlushFallbackTimer) return;
        if (this.npcInstanceMapsPendingReload.size === 0) {
            this.npcInstanceFlushFallbackAttempt = 0;
            return;
        }
        const attempt = this.npcInstanceFlushFallbackAttempt | 0;
        if (attempt >= 8) return;
        const delayMs = Math.min(2000, 50 * (1 << attempt));
        this.npcInstanceFlushFallbackAttempt = (attempt + 1) | 0;
        this.npcInstanceFlushFallbackTimer = setTimeout(() => {
            this.npcInstanceFlushFallbackTimer = undefined;
            this.scheduleNpcInstanceFlush();
        }, delayMs);
    }

    private resetNpcInstanceFlushFallback(): void {
        this.npcInstanceFlushFallbackAttempt = 0;
        if (!this.npcInstanceFlushFallbackTimer) return;
        try {
            clearTimeout(this.npcInstanceFlushFallbackTimer);
        } catch {}
        this.npcInstanceFlushFallbackTimer = undefined;
    }

    private async flushNpcInstances(): Promise<void> {
        const instances = Array.from(this.npcInstanceMap.values());
        await this.workerPool.setNpcInstances(instances);

        this.applyNpcInstanceNameOverrides();

        if (this.npcInstanceMapsPendingReload.size === 0) {
            this.resetNpcInstanceFlushFallback();
            return;
        }

        const renderer: any = this.renderer;
        const rendererReady =
            !!renderer &&
            !!renderer.app &&
            !!renderer.npcProgram &&
            !!renderer.textureArray &&
            !!renderer.textureMaterials &&
            !!renderer.sceneUniformBuffer;
        const mapManager = renderer?.mapManager as MapManager<any> | undefined;
        const mapManagerReady =
            !!mapManager && (mapManager.currentMapX | 0) >= 0 && (mapManager.currentMapY | 0) >= 0;

        if (!rendererReady || !mapManagerReady) {
            // Defer until the renderer + map manager have a stable current map. This is normally
            // driven by event hooks (renderer-ready + map-loaded); keep a bounded fallback retry
            // in case those events are missed during startup on some platforms.
            this.scheduleNpcInstanceFlushFallback();
            return;
        }

        // We have the prerequisites; clear any pending fallback retry.
        this.resetNpcInstanceFlushFallback();

        const pending = Array.from(this.npcInstanceMapsPendingReload);
        const remaining = new Set<number>();

        const geometryPromises: Array<Promise<{ mapId: number; ok: boolean }>> = [];

        for (const mapId of pending) {
            const mapX = (mapId >> 8) & 0xff;
            const mapY = mapId & 0xff;

            // Skip maps that are not in the current streaming grid.
            if (!mapManager.isMapInCurrentGrid(mapX, mapY)) {
                remaining.add(mapId);
                continue;
            }

            const map = mapManager.getMap(mapX, mapY);
            if (!map) {
                mapManager.loadMap(mapX, mapY);
                remaining.add(mapId);
                continue;
            }

            geometryPromises.push(
                (async () => {
                    try {
                        const npcGeometry = await this.workerPool.queueNpcGeometry(
                            mapX,
                            mapY,
                            renderer.maxLevel ?? 3,
                            Array.from(renderer.loadedTextureIds ?? []),
                        );
                        if (!npcGeometry) return { mapId, ok: false };
                        renderer.updateTextureArray?.(npcGeometry.loadedTextures);
                        (map as any).refreshNpcGeometry?.(
                            renderer.app,
                            renderer.npcProgram,
                            renderer.textureArray,
                            renderer.textureMaterials,
                            renderer.sceneUniformBuffer,
                            this.seqTypeLoader,
                            this.seqFrameLoader,
                            this.npcTypeLoader,
                            this.basTypeLoader,
                            npcGeometry,
                        );
                        return { mapId, ok: true };
                    } catch (err) {
                        console.warn(
                            "[OsrsClient] failed to refresh NPC geometry",
                            mapX,
                            mapY,
                            err,
                        );
                        return { mapId, ok: false };
                    }
                })(),
            );
        }

        const results = await Promise.all(geometryPromises);
        for (const res of results) {
            if (!res.ok) remaining.add(res.mapId | 0);
        }

        this.npcInstanceMapsPendingReload = remaining;
    }

    private clearNpcInstancesLocal(): void {
        this.npcInstanceMap.clear();
        this.npcInstanceMapsPendingReload.clear();
        this.npcInstanceFlushScheduled = false;
        this.resetNpcInstanceFlushFallback();
    }

    private applyNpcInstanceNameOverrides(): void {
        if (!this.npcTypeLoader) return;
        try {
            for (const instance of this.npcInstanceMap.values()) {
                if (!instance.name) continue;
                try {
                    const npcType = this.npcTypeLoader.load(instance.typeId);
                    npcType.name = instance.name;
                } catch (err) {
                    console.warn("Failed to apply NPC name override", instance.typeId, err);
                }
            }
        } catch (err) {
            console.warn("Failed to apply NPC instance name overrides", err);
        }
    }

    handleInventorySlotMove(fromSlot: number, toSlot: number): void {
        const src = Math.max(0, Math.min(Inventory.SLOT_COUNT - 1, fromSlot | 0));
        const dst = Math.max(0, Math.min(Inventory.SLOT_COUNT - 1, toSlot | 0));
        if (src === dst) return;
        // Read entries BEFORE swap
        const sourceEntry = this.inventory.getSlot(src);
        const destEntry = this.inventory.getSlot(dst);
        if (!sourceEntry || sourceEntry.itemId <= 0) return;

        // Save values before swap for widget update
        const srcItemId = sourceEntry.itemId;
        const srcQuantity = sourceEntry.quantity;
        const dstItemId = destEntry?.itemId ?? -1;
        const dstQuantity = destEntry?.quantity ?? 0;

        try {
            console.log("[inventory] move slot", {
                from: src,
                to: dst,
                srcItem: srcItemId,
                dstItem: dstItemId,
            });
        } catch {}

        // Swap in model and send to server
        this.inventory.swapSlots(src, dst);
        sendInventoryMove(src, dst);

        // OSRS PARITY: Mark inv cycle for inventory (93) - handlers fire during processWidgetTransmits()
        markInvTransmit(93);
        try {
            this.widgetManager.invalidateAll();
        } catch {}
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
        this.flushPendingHitsplats();
        this.flushPendingPlayerHealthBars();
        this.flushPendingNpcHealthBars();
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

    private getMapImageBasePath(): string {
        const cacheName = this.loadedCache?.info?.name;
        return cacheName ? `${MAP_IMAGE_BASE_PATH}/${cacheName}` : MAP_IMAGE_BASE_PATH;
    }

    private getCachedMapImageUrl(mapX: number, mapY: number): string {
        return `${this.getMapImageBasePath()}/${mapX}_${mapY}.png`;
    }

    private getMapImageUrlLimit(minimap: boolean): number {
        if (isTouchDevice) {
            return minimap ? OsrsClient.MAX_MINIMAP_URLS_MOBILE : OsrsClient.MAX_MAP_URLS_MOBILE;
        }
        return minimap ? OsrsClient.MAX_MINIMAP_URLS : OsrsClient.MAX_MAP_URLS;
    }

    private getPendingMapImageLimit(): number {
        return isTouchDevice
            ? OsrsClient.MAX_PENDING_MAP_IMAGE_LOADS_MOBILE
            : OsrsClient.MAX_PENDING_MAP_IMAGE_LOADS;
    }

    async queueLoadMapImage(mapX: number, mapY: number) {
        // Only use pre-generated /map-images tiles.
        const mapId = getMapSquareId(mapX, mapY);
        if (
            this.mapImageUrls.has(mapId) ||
            this.loadingMapImageIds.has(mapId) ||
            this.failedMapImageIds.has(mapId)
        ) {
            return;
        }
        if (this.loadingMapImageIds.size >= this.getPendingMapImageLimit()) {
            return;
        }
        this.loadingMapImageIds.add(mapId);
        const cachedUrl = this.getCachedMapImageUrl(mapX, mapY);
        try {
            const response = await fetch(cachedUrl, { method: "HEAD" });
            const contentType = response.headers.get("Content-Type")?.toLowerCase();
            if (response.ok && contentType && contentType.startsWith("image/")) {
                this.setMapImageUrl(mapX, mapY, cachedUrl, false, false);
                this.loadingMapImageIds.delete(mapId);
                return;
            }
        } catch (err) {
            console.log("[OsrsClient] cached map image check failed", err);
        }
        this.failedMapImageIds.add(mapId);
        this.loadingMapImageIds.delete(mapId);
    }

    getMapImageUrl(mapX: number, mapY: number, minimap: boolean): string | undefined {
        if (mapX < 0 || mapY < 0 || mapX >= MapManager.MAX_MAP_X || mapY >= MapManager.MAX_MAP_Y) {
            return undefined;
        }
        const urls = minimap ? this.minimapImageUrls : this.mapImageUrls;
        // Only queue lightweight map image loading, not full geometry
        this.queueLoadMapImage(mapX, mapY);
        const mapId = getMapSquareId(mapX, mapY);
        const url = urls.get(mapId);
        if (url) {
            const access = minimap ? this.minimapImageAccess : this.mapImageAccess;
            access.set(mapId, performance.now());
        }
        return url;
    }

    setMapImageUrl(
        mapX: number,
        mapY: number,
        url: string,
        minimap: boolean,
        cache: boolean = true,
    ): void {
        const mapId = getMapSquareId(mapX, mapY);
        const urls = minimap ? this.minimapImageUrls : this.mapImageUrls;
        const access = minimap ? this.minimapImageAccess : this.mapImageAccess;
        const old = urls.get(mapId);
        if (old) {
            URL.revokeObjectURL(old);
            urls.delete(mapId);
            access.delete(mapId);
        }
        if (cache) {
            fetch(url)
                .then((resp) => {
                    const contentType = resp.headers.get("Content-Type")?.toLowerCase();
                    if (!resp.ok || !contentType || !contentType.startsWith("image/")) {
                        return;
                    }
                    const cacheName = this.loadedCache?.info?.name;
                    if (!cacheName) return;
                    const request = new Request(this.getCachedMapImageUrl(mapX, mapY), {
                        headers: {
                            "RS-Cache-Name": cacheName,
                        },
                    });
                    return this.mapImageCache.put(request, resp);
                })
                .catch((err) => {
                    console.log("[OsrsClient] map image cache fetch failed", err);
                });
        }
        urls.set(mapId, url);
        access.set(mapId, performance.now());
        // Enforce memory cap for object URLs
        if (minimap) {
            this.pruneUrlMapLRU(
                this.minimapImageUrls,
                this.minimapImageAccess,
                this.getMapImageUrlLimit(true),
            );
        } else {
            this.pruneUrlMapLRU(
                this.mapImageUrls,
                this.mapImageAccess,
                this.getMapImageUrlLimit(false),
            );
        }
    }

    clearMapImageUrls(): void {
        for (const url of this.mapImageUrls.values()) {
            URL.revokeObjectURL(url);
        }
        for (const url of this.minimapImageUrls.values()) {
            URL.revokeObjectURL(url);
        }
        this.mapImageUrls.clear();
        this.minimapImageUrls.clear();
        this.mapImageAccess.clear();
        this.minimapImageAccess.clear();
        this.loadingMapImageIds.clear();
        this.failedMapImageIds.clear();
    }

    private pruneUrlMapLRU(
        urls: Map<number, string>,
        access: Map<number, number>,
        limit: number,
    ): void {
        if (urls.size <= limit) return;
        const now = performance.now();
        // Build list sorted by last access (oldest first)
        const ids = Array.from(urls.keys());
        ids.sort((a, b) => (access.get(a) ?? -Infinity) - (access.get(b) ?? -Infinity));
        const toRemove = ids.slice(0, urls.size - limit);
        for (const id of toRemove) {
            const u = urls.get(id);
            if (u) URL.revokeObjectURL(u);
            urls.delete(id);
            access.delete(id);
        }
    }

    /**
     * Reset all world/game state - used on disconnect/logout to prevent memory leaks.
     * Clears all players, NPCs, widgets, ground items, and other game entities.
     * @param fullReset If true, also clears chat history, vars, and transmit cycles (for full logout to login screen)
     */
    resetWorld(fullReset: boolean = false): void {
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
        this.clearNpcInstancesLocal();

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
        try {
            this.renderer?.mapManager?.clearMaps?.();
        } catch (err) {
            console.warn("[OsrsClient] MapManager clearMaps error:", err);
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
        this.cancelPendingLoginMusicStart();
        this.writeVarcs();
        if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
            window.removeEventListener("pagehide", this.handleVarcsPageLifecycleFlush);
            window.removeEventListener("beforeunload", this.handleVarcsPageLifecycleFlush);
        }

        // Reset world state first (full reset on dispose)
        this.resetWorld(true);
        try {
            this.varManager?.clear?.();
        } catch {}
        this.varcsStorageKey = undefined;
        this.varcsUnwrittenChanges = false;
        this.varcsLastWriteTimeMs = 0;

        // Dispose audio systems (stops playback, closes AudioContext, removes listeners)
        if (this.musicSystem) {
            this.musicSystem.dispose();
            this.musicSystem = undefined;
        }
        if (this.soundEffectSystem) {
            this.soundEffectSystem.dispose();
            this.soundEffectSystem = undefined;
        }

        // Revoke any cached map image URLs
        for (const url of this.mapImageUrls.values()) {
            URL.revokeObjectURL(url);
        }
        this.mapImageUrls.clear();
        this.mapImageAccess.clear();

        for (const url of this.minimapImageUrls.values()) {
            URL.revokeObjectURL(url);
        }
        this.minimapImageUrls.clear();
        this.minimapImageAccess.clear();

        console.log("[OsrsClient] Disposed");
    }
}
