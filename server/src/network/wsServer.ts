import { WebSocket, WebSocketServer } from "ws";
import { config } from "../config";
import { GameContext } from "../game/GameContext";
import { DataLoaderService } from "../game/services/DataLoaderService";
import { VariableService } from "../game/services/VariableService";
import { MessagingService } from "../game/services/MessagingService";
import { SkillService } from "../game/services/SkillService";
import { InventoryService } from "../game/services/InventoryService";
import { EquipmentService } from "../game/services/EquipmentService";
import { AppearanceService } from "../game/services/AppearanceService";
import { CombatDataService } from "../game/services/CombatDataService";
import { LocationService } from "../game/services/LocationService";
import { InterfaceManager as ExtractedInterfaceManager } from "../game/services/InterfaceManager";
import { CollectionLogService } from "../game/services/CollectionLogService";
import { WorldEntityService } from "../game/services/WorldEntityService";
import { SoundService } from "../game/services/SoundService";
import { MovementService } from "../game/services/MovementService";
import { PlayerCombatService } from "../game/services/PlayerCombatService";
import { buildScriptServices, type ScriptServiceAdapterDeps } from "../game/services/ScriptServiceAdapter";
import { buildGamemodeServices } from "../game/services/GamemodeServiceAdapter";
import { LoginHandshakeService } from "./LoginHandshakeService";
import { BroadcastService } from "./BroadcastService";
import { SpellCastingService } from "../game/services/SpellCastingService";
import { TickPhaseService } from "../game/services/TickPhaseService";
import { TickFrameService } from "../game/services/TickFrameService";
import { VarpSyncService } from "../game/services/VarpSyncService";
import { CombatEffectService } from "../game/services/CombatEffectService";
import { EquipmentStatsUiService } from "../game/services/EquipmentStatsUiService";
import { ActionDispatchService } from "../game/services/ActionDispatchService";
import { InventoryMessageService } from "../game/services/InventoryMessageService";
import { AuthenticationService } from "./AuthenticationService";
import { PlayerNetworkLayer } from "./PlayerNetworkLayer";

import { ConfigType } from "../../../src/rs/cache/ConfigType";
import { IndexType } from "../../../src/rs/cache/IndexType";
import { getCacheLoaderFactory, type CacheLoaderFactory } from "../../../src/rs/cache/loader/CacheLoaderFactory";
import { Huffman, tryLoadOsrsHuffman } from "../../../src/rs/chat/Huffman";
import { DbRepository } from "../../../src/rs/config/db/DbRepository";
import { ArchiveHealthBarDefinitionLoader } from "../../../src/rs/config/healthbar/HealthBarDefinitionLoader";
import type { NpcTypeLoader } from "../../../src/rs/config/npctype/NpcTypeLoader";
import type { ObjTypeLoader } from "../../../src/rs/config/objtype/ObjTypeLoader";
import { ACCOUNT_SUMMARY_GROUP_ID } from "../../../src/shared/ui/accountSummary";
import {
    VARP_FOLLOWER_INDEX,
} from "../../../src/shared/vars";
import { MusicCatalogService } from "../audio/MusicCatalogService";
import { MusicUnlockService } from "../audio/MusicUnlockService";
import { NpcSoundLookup } from "../audio/NpcSoundLookup";
import { getItemDefinition } from "../data/items";
import { populateLocEffectsFromLoader } from "../data/locEffects";
import {
    ActionScheduler,
    CombatActionHandler,
    EffectDispatcher,
    InventoryActionHandler,
    SpellActionHandler,
    WidgetDialogHandler,
} from "../game/actions";

import {
    loadCollectionLogItems,
} from "../game/collectionlog";
import {
    PlayerCombatManager,
    createPlayerCombatManager,
    combatEffectApplicator,
    HITMARK_DAMAGE,
    multiCombatSystem,
    damageTracker,
} from "../game/combat";
import { applyAutocastState, clearAutocastState } from "../game/combat/AutocastState";
import { CombatCategoryData } from "../game/combat/CombatCategoryData";
import { FollowerCombatManager } from "../game/followers/FollowerCombatManager";
import { FollowerManager } from "../game/followers/FollowerManager";
import { GroundItemManager } from "../game/items/GroundItemManager";
import type { GamemodeDefinition, GamemodeUiController } from "../game/gamemodes/GamemodeDefinition";
import { getGamemodeDataDir } from "../game/gamemodes/GamemodeRegistry";
import { NpcState, type NpcUpdateDelta } from "../game/npc";
import { NpcManager } from "../game/npcManager";
import {
    PlayerManager,
    PlayerState,
} from "../game/player";
import { PrayerSystem } from "../game/prayer/PrayerSystem";
import { ScriptRegistry, ScriptRuntime, bootstrapScripts } from "../game/scripts";
import {
    AgentPlayerFactory,
    BotSdkActionRouter,
    BotSdkServer,
} from "./botsdk";
import { JsonAccountStore, type AccountStore } from "../game/state/AccountStore";
import { PlayerPersistence } from "../game/state/PlayerPersistence";
import {
    BroadcastScheduler,
    EquipmentHandler,
    GatheringSystemManager,
    ScriptScheduler,
    StatusEffectSystem,
    ProjectileSystem,
    MovementSystem,
    type PlayerAnimSet,
} from "../game/systems";
import {
    TickPhaseOrchestrator,
} from "../game/tick";
import { PlayerDeathService } from "../game/death/PlayerDeathService";
import { GameEventBus } from "../game/events/GameEventBus";
import type { ServerServices } from "../game/ServerServices";
import { GameTicker } from "../game/ticker";
import { TradeManager } from "../game/trade/TradeManager";
import { PathService } from "../pathfinding/PathService";
import { MapCollisionService } from "../world/MapCollisionService";
import { logger } from "../utils/logger";
import { InterfaceService } from "../widgets/InterfaceService";
import type { WidgetAction } from "../widgets/WidgetManager";
import {
    registerCollectionLogInterfaceHooks,
} from "../widgets/hooks/CollectionLogInterfaceHooks";
import { registerDialogInterfaceHooks } from "../widgets/hooks/DialogInterfaceHooks";
import { type CacheEnv, initCacheEnv } from "../world/CacheEnv";
import { SailingInstanceManager } from "../game/sailing/SailingInstanceManager";
import { WorldEntityInfoEncoder } from "./encoding/WorldEntityInfoEncoder";
import { CollisionOverlayStore } from "../world/CollisionOverlayStore";
import { DoorCollisionService } from "../world/DoorCollisionService";
import { DoorDefinitionLoader } from "../world/DoorDefinitionLoader";
import { DoorRuntimeTileMappingStore } from "../world/DoorRuntimeTileMappingStore";
import { DoorStateManager } from "../world/DoorStateManager";
import { DynamicLocStateStore } from "../world/DynamicLocStateStore";
import { LocTileLookupService } from "../world/LocTileLookupService";
import { locCanResolveToId } from "../world/LocTransforms";
import {
    ChatBroadcaster,
    ActorSyncBroadcaster,
    SkillBroadcaster,
    VarBroadcaster,
    InventoryBroadcaster,
    WidgetBroadcaster,
    CombatBroadcaster,
    MiscBroadcaster,
} from "./broadcast";
import * as ServiceWiring from "./ServiceWiring";
import type { LocTypeLoader } from "../../../src/rs/config/loctype/LocTypeLoader";


import { MessageRouter, type MessageRouterServices } from "./MessageRouter";
import { buildTeleportNpcUpdateDelta, upsertNpcUpdateDelta } from "./NpcExternalSync";
import { PlayerSyncSession } from "./PlayerSyncSession";
import { NpcSyncSession } from "./NpcSyncSession";
import { AccountSummaryTracker } from "./accountSummary";
import {
    Cs2ModalManager,
    GroundItemHandler,
    NpcSyncManager,
    PlayerAppearanceManager,
    SoundManager,
} from "./managers";
import { NpcPacketEncoder, PlayerPacketEncoder } from "./encoding";
import {
    encodeMessage,
} from "./messages";
import { encodeAppearanceBinary } from "./encoding/AppearanceEncoder";
import { REPORT_GAME_TIME_GROUP_ID, ReportGameTimeTracker } from "./reportGameTime";
import type {
    NpcViewSnapshot,
    NpcUpdatePayload,
    TickFrame,
} from "./wsServerTypes";
import {
    DEFAULT_AUTOSAVE_SECONDS,
    GROUND_ITEM_PRIVATE_TICKS,
    GROUND_ITEM_DESPAWN_TICKS,
    DEBUG_LOG_ITEM_ID,
    DEBUG_LOG_TILE,
    DEBUG_LOG_STACK_QTY,
} from "./wsServerTypes";
import { testRandFloat, TEST_HIT_FORCE } from "../game/testing/TestRng";



export interface WSServerOptions {
    host: string;
    port: number;
    tickMs: number;
    ticker: GameTicker;
    pathService?: PathService;
    mapService?: MapCollisionService;
    npcManager?: NpcManager;
    cacheEnv?: CacheEnv;
    serverName?: string;
    maxPlayers?: number;
    gamemode: GamemodeDefinition;
}

export class WSServer {
    private wss!: WebSocketServer;
    private options: WSServerOptions;
    private players?: PlayerManager;
    private npcManager?: NpcManager;
    private objTypeLoader?: ObjTypeLoader;
    private locTypeLoader?: LocTypeLoader;
    private readonly gamemode: GamemodeDefinition;
    private cacheEnv?: CacheEnv;
    private huffman?: Huffman;
    private actionScheduler!: ActionScheduler;
    private defaultPlayerAnim: PlayerAnimSet = {
        idle: 808,
        walk: 819,
        run: 824,
        turnLeft: 823,
        turnRight: 823,
    };
    private defaultPlayerAnimMale?: PlayerAnimSet;
    private defaultPlayerAnimFemale?: PlayerAnimSet;
    private doorManager?: DoorStateManager;
    readonly eventBus = new GameEventBus();
    private readonly statusEffects = new StatusEffectSystem();
    private readonly prayerSystem = new PrayerSystem();
    private readonly scriptScheduler = new ScriptScheduler();
    private readonly scriptRegistry = new ScriptRegistry();
    private scriptRuntime!: ScriptRuntime;
    private playerPersistence!: PlayerPersistence;
    private accountStore!: AccountStore;
    private botSdkServer!: BotSdkServer;
    private agentPlayerFactory!: AgentPlayerFactory;
    private botSdkActionRouter!: BotSdkActionRouter;
    private movementSystem?: MovementSystem;
    private followerManager?: FollowerManager;
    private followerCombatManager?: FollowerCombatManager;
    private playerCombatManager?: PlayerCombatManager;
    private tradeManager?: TradeManager;
    private interfaceService?: InterfaceService;
    private sailingInstanceManager?: SailingInstanceManager;
    private worldEntityInfoEncoder = new WorldEntityInfoEncoder();
    private gatheringSystem!: GatheringSystemManager;
    private equipmentHandler!: EquipmentHandler;
    private tickOrchestrator!: TickPhaseOrchestrator;
    private broadcastScheduler = new BroadcastScheduler();
    private messageRouter!: MessageRouter;

    // Extracted services (Phase 1)
    private gameContext!: GameContext;
    private dataLoaderService!: DataLoaderService;
    private authService!: AuthenticationService;
    private networkLayer!: PlayerNetworkLayer;

    // Extracted services (Phase 2)
    private variableService!: VariableService;
    private messagingService!: MessagingService;
    private skillService!: SkillService;

    // Extracted services (Phase 3)
    private inventoryService!: InventoryService;
    private equipmentService!: EquipmentService;
    private appearanceService!: AppearanceService;

    // Extracted services (Phase 4)
    private combatDataService!: CombatDataService;

    // Extracted services (Phase 5)
    private locationService!: LocationService;
    private interfaceManager!: ExtractedInterfaceManager;

    // Extracted services (Phase 6)
    private collectionLogService!: CollectionLogService;
    private worldEntityService!: WorldEntityService;
    private soundService!: SoundService;
    private movementService!: MovementService;

    // Extracted services (Phase 7)
    private varpSyncService!: VarpSyncService;
    private loginHandshakeService!: LoginHandshakeService;
    private tickPhaseService!: TickPhaseService;

    // Extracted services (Broadcast + TickFrame)
    private broadcastService!: BroadcastService;
    private tickFrameService!: TickFrameService;

    // Extracted services (Phase 8)
    private combatEffectService!: CombatEffectService;
    private equipmentStatsUiService!: EquipmentStatsUiService;
    private actionDispatchService!: ActionDispatchService;

    private gamemodeTickCallbacks: Array<(tick: number) => void> = [];
    private gamemodeSnapshotEncoders = new Map<string, {
        encode: (playerId: number, payload: unknown) => { message: string | Uint8Array; context: string } | undefined;
        onSent?: (playerId: number, payload: unknown) => void;
    }>();
    // NPC-specific pending state (not yet consolidated into BroadcastScheduler due to complex types)
    private pendingNpcPackets: Map<
        number,
        { snapshots: NpcViewSnapshot[]; updates: NpcUpdatePayload[]; despawns: number[] }
    > = new Map();
    private pendingNpcUpdates: NpcUpdateDelta[] = [];
    private projectileSystem!: ProjectileSystem;
    // pendingWalkCommands moved to MovementService
    private pendingDirectSends = new Map<
        WebSocket,
        { message: string | Uint8Array; context: string }
    >();
    // isBroadcastPhase, messageBatches, enableMessageBatching, directSendBypassDepth,
    // directSendWarningContexts moved to PlayerNetworkLayer
    // widgetOpenLedgerByPlayer moved to InterfaceManager
    private playerSyncSessions = new Map<WebSocket, PlayerSyncSession>();
    private npcSyncSessions = new Map<WebSocket, NpcSyncSession>();
    private activeFrame?: TickFrame;
    private npcTypeLoader?: NpcTypeLoader;
    private combatCategoryData?: CombatCategoryData;
    private dbRepository?: DbRepository;
    private npcSoundLookup?: NpcSoundLookup;
    private musicCatalogService?: MusicCatalogService;
    private musicUnlockService?: MusicUnlockService;
    private autosaveIntervalTicks!: number;
    private groundItems!: GroundItemManager;
    private readonly playerDynamicLocSceneKeys = new Map<number, string>();
    private readonly dynamicLocState = new DynamicLocStateStore();
    private inventoryActionHandler!: InventoryActionHandler;
    private effectDispatcher!: EffectDispatcher;
    private widgetDialogHandler!: WidgetDialogHandler;
    private cs2ModalManager!: Cs2ModalManager;
    private playerAppearanceManager!: PlayerAppearanceManager;
    private soundManager!: SoundManager;
    private groundItemHandler!: GroundItemHandler;
    playerDeathService?: PlayerDeathService;
    private accountSummary!: AccountSummaryTracker;
    private reportGameTime!: ReportGameTimeTracker;
    private scriptAdapterDeps!: ScriptServiceAdapterDeps;
    private cacheFactory: CacheLoaderFactory | undefined;
    private gamemodeUi!: GamemodeUiController;
    private npcPacketEncoder?: NpcPacketEncoder;
    private playerPacketEncoder?: PlayerPacketEncoder;
    private npcSyncManager?: NpcSyncManager;
    private playerCombatService?: PlayerCombatService;
    private spellCastingService?: SpellCastingService;
    private spellActionHandler?: SpellActionHandler;
    private combatActionHandler?: CombatActionHandler;
    private playerGroundSerial = new Map<number, number>();
    private playerGroundChunk = new Map<number, number>();
    private inventoryMessageService?: InventoryMessageService;
    private maintenanceMode = false;
    private enableBinaryNpcSync = true;

    /** Shared service context — populated incrementally, safe because services only read at tick time */
    readonly svc = {} as ServerServices;

    // Broadcast domain handlers
    private readonly chatBroadcaster = new ChatBroadcaster();
    private readonly actorSyncBroadcaster = new ActorSyncBroadcaster();
    private readonly skillBroadcaster = new SkillBroadcaster();
    private readonly varBroadcaster = new VarBroadcaster();
    private inventoryBroadcaster!: InventoryBroadcaster;
    private widgetBroadcaster!: WidgetBroadcaster;
    private combatBroadcaster!: CombatBroadcaster;
    private miscBroadcaster!: MiscBroadcaster;

    constructor(opts: WSServerOptions) {
        this.options = opts;
        this.gamemode = opts.gamemode;
        this.initBroadcasters();
        this.initWebSocketServer(opts);
        this.initAutosave();
        this.initCacheEnvironment(opts);
        this.initDoorSystem(opts);
        this.initGameSystems(opts);
        this.initServiceWiring(opts);
        this.initDeferredDeps(opts);
        this.broadcastService = new BroadcastService(this.svc);
        this.tickFrameService = new TickFrameService(this.svc, this.autosaveIntervalTicks);
        this.loginHandshakeService = new LoginHandshakeService(this.svc);
        this.tickPhaseService = new TickPhaseService(this.svc);
        this.initBotSdk(opts);
        this.populateServiceContext();
        this.messageRouter = this.createMessageRouter();
        this.initGamemode(opts);
        this.initPlayerAnimations();
        this.initTestBots();
        this.wss.on("connection", (ws) => this.loginHandshakeService.onConnection(ws));
        opts.ticker.on("tick", (data) => this.tickFrameService.handleTick(data));

        // Bring up the bot-SDK endpoint last so all dependencies exist.
        this.botSdkServer.start();
    }

    /**
     * Build the bot-SDK endpoint infrastructure — factory, action router,
     * and server. All three are no-ops until `botSdkServer.start()` is
     * called; this method just wires the pieces together without opening
     * a socket or touching the tick loop.
     */
    private initBotSdk(opts: WSServerOptions): void {
        this.agentPlayerFactory = new AgentPlayerFactory({
            players: () => this.players,
            gamemode: this.gamemode,
            accountStore: this.accountStore,
            playerPersistence: this.playerPersistence,
        });
        this.botSdkActionRouter = new BotSdkActionRouter({
            players: () => this.players,
            getCurrentTick: () => opts.ticker.currentTick(),
            services: () => this.svc,
        });
        this.botSdkServer = new BotSdkServer(
            {
                host: config.botSdkHost,
                port: config.botSdkPort,
                token: config.botSdkToken,
                serverName: config.serverName,
                perceptionEveryNTicks: config.botSdkPerceptionEveryNTicks,
            },
            {
                factory: this.agentPlayerFactory,
                router: this.botSdkActionRouter,
                playerPersistence: this.playerPersistence,
                hookTicker: (cb) => {
                    opts.ticker.on("tick", (data) => cb(data.tick));
                },
            },
        );
    }

    /**
     * Populate the shared ServerServices context from all initialized services.
     * Called once at the end of the constructor, after all services are created.
     * Uses Object.defineProperty for mutable fields so svc stays in sync.
     */
    private populateServiceContext(): void {
        const s = this.svc as unknown as Record<string, unknown>;

        // Config & infrastructure
        s.ticker = this.options.ticker;
        s.tickMs = this.options.tickMs;
        s.gamemode = this.gamemode;
        s.pathService = this.options.pathService;
        s.mapService = this.options.mapService;
        s.eventBus = this.eventBus;

        // Mutable fields — use defineProperty so svc.xxx always reflects this.xxx
        const self = this;
        // activeFrame needs both get and set (TickPhaseOrchestrator writes to it)
        Object.defineProperty(this.svc, "activeFrame", {
            get: () => self.activeFrame,
            set: (v) => { self.activeFrame = v; },
            enumerable: true,
            configurable: true,
        });
        const mutableProps: Array<[string, () => unknown]> = [
            ["cacheEnv", () => self.cacheEnv],
            ["players", () => self.players],
            ["npcManager", () => self.npcManager],
            ["npcTypeLoader", () => self.npcTypeLoader],
            ["locTypeLoader", () => self.locTypeLoader],
            ["objTypeLoader", () => self.objTypeLoader],
            ["huffman", () => self.huffman],
            ["dbRepository", () => self.dbRepository],
            ["combatCategoryData", () => self.combatCategoryData],
            ["npcSoundLookup", () => self.npcSoundLookup],
            ["musicCatalogService", () => self.musicCatalogService],
            ["musicUnlockService", () => self.musicUnlockService],
            ["playerCombatManager", () => self.playerCombatManager],
            ["playerCombatService", () => self.playerCombatService],
            ["spellCastingService", () => self.spellCastingService],
            ["movementSystem", () => self.movementSystem],
            ["tradeManager", () => self.tradeManager],
            ["followerManager", () => self.followerManager],
            ["followerCombatManager", () => self.followerCombatManager],
            ["interfaceService", () => self.interfaceService],
            ["sailingInstanceManager", () => self.sailingInstanceManager],
            ["doorManager", () => self.doorManager],
            ["projectileSystem", () => self.projectileSystem],
            ["combatActionHandler", () => self.combatActionHandler],
            ["spellActionHandler", () => self.spellActionHandler],
            ["inventoryActionHandler", () => self.inventoryActionHandler],
            ["effectDispatcher", () => self.effectDispatcher],
            ["widgetDialogHandler", () => self.widgetDialogHandler],
            ["playerDeathService", () => self.playerDeathService],
            ["playerAppearanceManager", () => self.playerAppearanceManager],
            ["soundManager", () => self.soundManager],
            ["groundItemHandler", () => self.groundItemHandler],
            ["cs2ModalManager", () => self.cs2ModalManager],
            ["npcSyncManager", () => self.npcSyncManager],
            ["playerPacketEncoder", () => self.playerPacketEncoder],
            ["npcPacketEncoder", () => self.npcPacketEncoder],
            ["gamemodeUi", () => self.gamemodeUi],
            ["messageRouter", () => self.messageRouter],
            ["tickOrchestrator", () => self.tickOrchestrator],
            ["maintenanceMode", () => self.maintenanceMode],
        ];
        for (const [key, getter] of mutableProps) {
            Object.defineProperty(this.svc, key, { get: getter, enumerable: true, configurable: true });
        }

        // Required services (always present by this point)
        s.playerPersistence = this.playerPersistence;
        s.accountStore = this.accountStore;
        s.botSdkServer = this.botSdkServer;
        s.dataLoaderService = this.dataLoaderService;
        s.networkLayer = this.networkLayer;
        s.authService = this.authService;
        s.variableService = this.variableService;
        s.messagingService = this.messagingService;
        s.skillService = this.skillService;
        s.inventoryService = this.inventoryService;
        s.equipmentService = this.equipmentService;
        s.appearanceService = this.appearanceService;
        s.combatDataService = this.combatDataService;
        s.locationService = this.locationService;
        s.interfaceManager = this.interfaceManager;
        s.collectionLogService = this.collectionLogService;
        s.worldEntityService = this.worldEntityService;
        s.soundService = this.soundService;
        s.movementService = this.movementService;
        s.combatEffectService = this.combatEffectService;
        s.varpSyncService = this.varpSyncService;
        s.equipmentStatsUiService = this.equipmentStatsUiService;
        s.tickPhaseService = this.tickPhaseService;
        s.tickFrameService = this.tickFrameService;
        s.actionDispatchService = this.actionDispatchService;
        s.inventoryMessageService = this.inventoryMessageService;
        s.broadcastService = this.broadcastService;
        s.loginHandshakeService = this.loginHandshakeService;
        s.accountSummary = this.accountSummary;
        s.reportGameTime = this.reportGameTime;

        // Singletons
        s.actionScheduler = this.actionScheduler;
        s.broadcastScheduler = this.broadcastScheduler;
        s.scriptRuntime = this.scriptRuntime;
        s.scriptRegistry = this.scriptRegistry;
        s.scriptScheduler = this.scriptScheduler;
        s.statusEffects = this.statusEffects;
        s.prayerSystem = this.prayerSystem;
        s.groundItems = this.groundItems;
        s.gatheringSystem = this.gatheringSystem;
        s.equipmentHandler = this.equipmentHandler;
        s.worldEntityInfoEncoder = this.worldEntityInfoEncoder;

        // Broadcasters
        s.chatBroadcaster = this.chatBroadcaster;
        s.actorSyncBroadcaster = this.actorSyncBroadcaster;
        s.skillBroadcaster = this.skillBroadcaster;
        s.varBroadcaster = this.varBroadcaster;
        s.inventoryBroadcaster = this.inventoryBroadcaster;
        s.widgetBroadcaster = this.widgetBroadcaster;
        s.combatBroadcaster = this.combatBroadcaster;
        s.miscBroadcaster = this.miscBroadcaster;

        // Animation defaults
        s.defaultPlayerAnim = this.defaultPlayerAnim;
        s.defaultPlayerAnimMale = this.defaultPlayerAnimMale;
        s.defaultPlayerAnimFemale = this.defaultPlayerAnimFemale;

        // State collections
        s.dynamicLocState = this.dynamicLocState;
        s.playerSyncSessions = this.playerSyncSessions;
        s.npcSyncSessions = this.npcSyncSessions;
        s.playerDynamicLocSceneKeys = this.playerDynamicLocSceneKeys;
        s.pendingNpcPackets = this.pendingNpcPackets;
        s.playerGroundSerial = this.playerGroundSerial;
        s.playerGroundChunk = this.playerGroundChunk;
        s.pendingDirectSends = this.pendingDirectSends;
        s.wssClients = this.wss.clients;
        Object.defineProperty(this.svc, "pendingNpcUpdates", {
            get: () => self.pendingNpcUpdates,
            set: (v: any) => { self.pendingNpcUpdates = v; },
            enumerable: true,
            configurable: true,
        });
        s.gamemodeTickCallbacks = this.gamemodeTickCallbacks;
        Object.defineProperty(this.svc, "enableBinaryNpcSync", {
            get: () => self.enableBinaryNpcSync,
            set: (v: boolean) => { self.enableBinaryNpcSync = v; },
            enumerable: true,
            configurable: true,
        });

        // Debug
        s.pendingDebugRequests = new Map<number, import("ws").WebSocket>();

        // Coordination methods
        this.svc.queueWidgetEvent = (pid: number, action) => this.queueWidgetEvent(pid, action);
        this.svc.queueCombatState = (p) => this.queueCombatState(p);
    }

    private initBroadcasters(): void {
        this.playerPersistence = new PlayerPersistence({
            dataDir: getGamemodeDataDir(this.gamemode.id),
        });
        this.accountStore = new JsonAccountStore({
            filePath: config.accountsFilePath,
            minPasswordLength: config.minPasswordLength,
        });
        this.accountSummary = new AccountSummaryTracker(this.svc);
        this.reportGameTime = new ReportGameTimeTracker(this.svc);
        this.actionScheduler = new ActionScheduler((player, action, tick) =>
            this.actionDispatchService.dispatch(player, action, tick),
        );
        this.actionScheduler.setPriorityProvider((p) => p.getPidPriority());
        this.actionScheduler.setModalChecker((playerId) => this.hasModalOpen(playerId));

        this.inventoryBroadcaster = new InventoryBroadcaster({
            getPlayerById: (id) => this.players?.getById(id),
            getInventory: (player) => this.inventoryService.getInventory(player),
        });
        this.widgetBroadcaster = new WidgetBroadcaster({
            syncPostWidgetOpenState: () => {},
        });
        this.combatBroadcaster = new CombatBroadcaster({
            forEachPlayer: (fn) => this.players?.forEach(fn),
            withDirectSendBypass: (ctx, fn) => this.networkLayer.withDirectSendBypass(ctx, fn),
        });
        this.miscBroadcaster = new MiscBroadcaster({
            gamemodeSnapshotEncoders: this.gamemodeSnapshotEncoders,
            forEachPlayer: (fn) => this.players?.forEach(fn),
        });
    }
    private initWebSocketServer(opts: WSServerOptions): void {
        const allowedOrigins = config.allowedOrigins ?? [];
        const hasOriginAllowlist = allowedOrigins.length > 0;

        this.wss = new WebSocketServer({
            host: opts.host,
            port: opts.port,
            perMessageDeflate: {
                zlibDeflateOptions: { level: 6 },
                zlibInflateOptions: { chunkSize: 10 * 1024 },
                threshold: 128, // Only compress messages larger than 128 bytes
                concurrencyLimit: 10,
            },
            // If an origin allowlist is configured, reject the WS upgrade before
            // it completes. Empty allowlist = allow everything (dev/LAN default).
            verifyClient: hasOriginAllowlist
                ? (info, cb) => {
                      const origin = (info.origin ?? "").trim();
                      if (!origin) {
                          logger.warn(`[ws] rejecting connection: missing Origin header (allowlist active)`);
                          cb(false, 403, "Forbidden");
                          return;
                      }
                      if (!allowedOrigins.includes(origin)) {
                          logger.warn(`[ws] rejecting connection: Origin "${origin}" not in allowlist`);
                          cb(false, 403, "Forbidden");
                          return;
                      }
                      cb(true);
                  }
                : undefined,
        });

        if (hasOriginAllowlist) {
            logger.info(`[ws] Origin allowlist active: ${allowedOrigins.join(", ")}`);
        } else {
            logger.info(`[ws] Origin allowlist disabled — all origins accepted`);
        }
        this.wss.on("listening", () => {
            logger.info(`WS listening on ws://${opts.host}:${opts.port}`);

            const httpServer = (this.wss as unknown as { _server?: import("http").Server })._server;
            if (httpServer) {
                httpServer.removeAllListeners("request");
                httpServer.on("request", (req: import("http").IncomingMessage, res: import("http").ServerResponse) => {
                    if (req.url === "/status") {
                        const count = this.players?.getRealPlayerCount() ?? 0;
                        res.writeHead(200, {
                            "Content-Type": "application/json",
                            "Access-Control-Allow-Origin": "*",
                        });
                        res.end(JSON.stringify({
                            serverName: opts.serverName ?? config.serverName,
                            playerCount: count,
                            maxPlayers: opts.maxPlayers ?? config.maxPlayers,
                        }));
                    } else {
                        res.writeHead(426);
                        res.end();
                    }
                });
            }
        });
    }

    private initAutosave(): void {
        const autosaveEnvRaw = process.env.PLAYER_AUTOSAVE_TICKS;
        const autosaveEnv = autosaveEnvRaw?.trim()
            ? parseInt(autosaveEnvRaw.trim(), 10)
            : undefined;
        const defaultAutosaveTicks = Math.max(
            0,
            Math.round((DEFAULT_AUTOSAVE_SECONDS * 1000) / Math.max(1, this.options.tickMs)),
        );
        this.autosaveIntervalTicks =
            autosaveEnv !== undefined && Number.isFinite(autosaveEnv) && autosaveEnv > 0
                ? Math.max(1, autosaveEnv)
                : defaultAutosaveTicks;
        if (this.autosaveIntervalTicks > 0) {
            const seconds = ((this.autosaveIntervalTicks * this.options.tickMs) / 1000).toFixed(1);
            logger.info(
                `[autosave] enabled interval=${this.autosaveIntervalTicks} ticks (~${seconds}s)`,
            );
        } else {
            logger.info("[autosave] disabled (interval <= 0)");
        }
    }

    private initCacheEnvironment(opts: WSServerOptions): void {
        const env = opts.cacheEnv ?? initCacheEnv("caches");
        this.cacheEnv = env;

        this.dataLoaderService = new DataLoaderService(env);
        this.networkLayer = new PlayerNetworkLayer();
        // AuthService created below after we know players is set up
        // GameContext created below after all Phase 1 services are ready

        this.cacheFactory = undefined;
        try {
            this.cacheFactory = getCacheLoaderFactory(env.info, env.cacheSystem);
            this.huffman = tryLoadOsrsHuffman(env.cacheSystem);
            if (!this.huffman) {
                logger.warn(
                    "[chat] failed to load OSRS Huffman table (idx10); public chat may be garbled",
                );
            }
            try {
                const configIndex = env.cacheSystem.getIndex(IndexType.DAT2.configs);
                if (configIndex.archiveExists(ConfigType.OSRS.healthBar)) {
                    const archive = configIndex.getArchive(ConfigType.OSRS.healthBar);
                    new ArchiveHealthBarDefinitionLoader(
                        env.info,
                        archive,
                    );
                }
            } catch (err) { logger.warn("[cache] healthbar loader init failed", err); }
        } catch (e) {
            logger.warn("Failed to initialize cache environment", e);
        }

        if (this.cacheFactory) {
            try {
                this.locTypeLoader = this.cacheFactory.getLocTypeLoader();
                try {
                    const count = populateLocEffectsFromLoader(this.locTypeLoader);
                    logger.info(`[locEffects] auto-registered ${count} loc sound effect(s)`);
                } catch (err) {
                    logger.warn("[locEffects] failed to auto-register from loc loader", err);
                }
            } catch (err) { logger.warn("[cache] loc type loader init failed", err); }
            try {
                this.npcTypeLoader = this.cacheFactory.getNpcTypeLoader?.();
            } catch (err) { logger.warn("[cache] npc type loader init failed", err); }
        }
    }

    private initDoorSystem(opts: WSServerOptions): void {
        let collisionOverlays: CollisionOverlayStore | undefined;
        const locTypeLoader = this.locTypeLoader;
        if (locTypeLoader) {

            // Wire up door collision system for pathfinding parity
            collisionOverlays = new CollisionOverlayStore();
            const doorDefLoader = new DoorDefinitionLoader();
            const runtimeTileMappings = new DoorRuntimeTileMappingStore();
            const locTileLookup = this.cacheEnv
                ? new LocTileLookupService(this.cacheEnv)
                : undefined;
            const resolveDoorLocLookup = locTileLookup
                ? (x: number, y: number, level: number, idHint?: number) => {
                      const tileX = Math.trunc(x);
                      const tileY = Math.trunc(y);
                      const tileLevel = Math.trunc(level);
                      const hintedId =
                          idHint !== undefined && Number.isFinite(idHint)
                              ? Math.trunc(idHint)
                              : undefined;

                      const exact = locTileLookup.getLocAt(tileLevel, tileX, tileY, hintedId);
                      if (exact || hintedId === undefined) {
                          return exact;
                      }

                      const placements = locTileLookup.getLocsAtTile(tileLevel, tileX, tileY);
                      for (const placement of placements) {
                          try {
                              const definition = locTypeLoader.load?.(placement.id);
                              if (locCanResolveToId(definition, hintedId)) {
                                  return placement;
                              }
                          } catch (err) { logger.warn("[loc] loc definition lookup failed", err); }
                      }

                      return undefined;
                  }
                : undefined;
            const doorCollisionService = new DoorCollisionService(collisionOverlays);
            this.doorManager = new DoorStateManager(
                locTypeLoader,
                doorDefLoader,
                doorCollisionService,
                opts.pathService
                    ? (x, y, level) => opts.pathService?.getCollisionFlagAt(x, y, level)
                    : undefined,
                runtimeTileMappings,
                resolveDoorLocLookup,
            );
            // Connect collision overlays to pathfinding so doors affect routes
            if (opts.pathService) {
                opts.pathService.setCollisionOverlays(collisionOverlays);
                logger.info("[doors] collision overlays connected to pathfinding");
            }
            // doorManager → locationService wired in deferred block below

            // Loc/npc map building is now handled by extrascripts during register()
        }
    }

    private initGameSystems(opts: WSServerOptions): void {
        this.npcManager = opts.npcManager;
        if (this.npcManager) {
            this.sailingInstanceManager = new SailingInstanceManager(this.svc);
        }
        // Initialize InterfaceService for modular modal interface management
        this.interfaceService = new InterfaceService(this.svc);
        // Deferred wiring: these services are created later, wire after init
        // (moved to after service creation block below)

        // Register interface lifecycle hooks
        registerDialogInterfaceHooks(this.interfaceService);
        registerCollectionLogInterfaceHooks(this.interfaceService);

        this.groundItems = new GroundItemManager(this.svc, {
            defaultDurationTicks: GROUND_ITEM_DESPAWN_TICKS,
            defaultPrivateTicks: GROUND_ITEM_PRIVATE_TICKS,
        });
        try {
            const nowTick = this.options.ticker.currentTick();
            const stack = this.groundItems.spawn(
                DEBUG_LOG_ITEM_ID,
                DEBUG_LOG_STACK_QTY,
                DEBUG_LOG_TILE,
                nowTick,
                { durationTicks: 0, privateTicks: 0 },
            );
            if (stack) {
                logger.info(
                    `[ground] spawned debug log stack item=%d qty=%d tile=(%d,%d,%d)`,
                    stack.itemId,
                    stack.quantity,
                    DEBUG_LOG_TILE.x,
                    DEBUG_LOG_TILE.y,
                    DEBUG_LOG_TILE.level,
                );
            }
        } catch (err) {
            logger.warn("[ground] failed to spawn debug log stack", err);
        }
        this.scriptAdapterDeps = {
                dataLoaders: this.dataLoaderService,
                variableService: this.variableService,
                messagingService: this.messagingService,
                skillService: this.skillService,
                inventoryService: this.inventoryService,
                equipmentService: this.equipmentService,
                appearanceService: this.appearanceService,
                locationService: this.locationService,
                movementService: undefined!, // Deferred: wired after creation
                collectionLogService: this.collectionLogService,
                soundService: this.soundService,
                actionScheduler: this.actionScheduler,
                getCurrentTick: () => this.options.ticker.currentTick(),
                getPathService: () => this.options.pathService!,
                doorManager: this.doorManager!,
                npcManager: this.npcManager!,
                interfaceService: this.interfaceService,
                widgetDialogHandler: undefined!, // Deferred: wired after creation
                prayerSystem: this.prayerSystem,
                gatheringSystem: undefined!, // Deferred: wired after creation
                cs2ModalManager: undefined!, // Deferred: wired after creation
                followerManager: undefined, // Deferred: wired after creation
                followerCombatManager: undefined, // Deferred: wired after creation
                sailingInstanceManager: this.sailingInstanceManager!,
                worldEntityInfoEncoder: this.worldEntityInfoEncoder,
                playerPersistence: this.playerPersistence,
                musicCatalogService: undefined, // Deferred: wired after creation
                inventoryActionHandler: undefined!, // Deferred: wired after creation
                effectDispatcher: undefined!, // Deferred: wired after creation
                combatEffectApplicator: combatEffectApplicator,
                damageTracker: damageTracker,
                multiCombatSystem: multiCombatSystem,
                getPlayers: () => this.players,
                enqueueSpotAnimation: (anim) => this.broadcastService.enqueueSpotAnimation(anim),
                enqueueForcedMovement: (data) => this.broadcastService.enqueueForcedMovement(data),
                enqueueSoundBroadcast: (soundId, x, y, level) => this.broadcastService.enqueueSoundBroadcast(soundId, x, y, level),
                syncMusicInterface: (player) => this.soundManager?.syncMusicInterfaceForPlayer(player),
                queueCombatSnapshot: (...args: Parameters<typeof this.queueCombatSnapshot>) => this.queueCombatSnapshot(...args),
                queueWidgetEvent: (pid, evt) => this.queueWidgetEvent(pid, evt),
                queueSmithingInterfaceMessage: (pid, p) => this.broadcastService.queueSmithingInterfaceMessage(pid, p as any),
                queueExternalNpcTeleportSync: (npc) => this.queueExternalNpcTeleportSync(npc),
                teleportToWorldEntity: (...args: Parameters<WorldEntityService["teleportToWorldEntity"]>) => this.worldEntityService.teleportToWorldEntity(...args),
                sendWorldEntity: (...args: Parameters<WorldEntityService["sendWorldEntity"]>) => this.worldEntityService.sendWorldEntity(...args),
                completeLogout: (sock, player, reason) => this.loginHandshakeService.completeLogout(sock, player, reason),
                closeInterruptibleInterfaces: (player) => this.interfaceManager.closeInterruptibleInterfaces(player),
                activeFrame: () => this.activeFrame,
                gamemode: this.gamemode,
                eventBus: this.eventBus,
        };
        this.scriptRuntime = new ScriptRuntime({
            registry: this.scriptRegistry,
            scheduler: this.scriptScheduler,
            logger,
            services: buildScriptServices(this.scriptAdapterDeps),
        });
        logger.info(
            "[scripts] loaded",
            JSON.stringify({ modules: [] }),
        );
        bootstrapScripts(this.scriptRuntime, this.gamemode);
        if (opts.pathService) {
            this.players = new PlayerManager(
                this.gamemode,
                opts.pathService,
                this.locTypeLoader,
                this.doorManager,
                this.scriptRuntime,
            );
            if (this.npcManager) {
                this.followerManager = new FollowerManager(
                    this.npcManager,
                    this.players,
                    opts.pathService,
                    (playerId, followerNpcId) => {
                        this.variableService.queueVarp(
                            playerId,
                            VARP_FOLLOWER_INDEX,
                            followerNpcId === undefined ? 65535 : followerNpcId | 0,
                        );
                    },
                    () => this.options.ticker.currentTick(),
                );
                this.followerCombatManager = new FollowerCombatManager(
                    this.followerManager,
                    this.npcManager,
                    this.players,
                    opts.pathService,
                    ({ owner, companion, target, currentTick, combat }) => {
                        const attackSeq =
                            combat.attackAnimationId ??
                            this.combatDataService.getNpcCombatSequences(companion.typeId).attack;
                        if (attackSeq !== undefined && attackSeq >= 0) {
                            this.combatEffectService.broadcastNpcSequence(companion, attackSeq);
                        }
                        if (combat.attackSoundId !== undefined && combat.attackSoundId > 0) {
                            this.broadcastService.queueBroadcastSound(
                                {
                                    soundId: combat.attackSoundId,
                                    x: companion.tileX,
                                    y: companion.tileY,
                                    level: companion.level,
                                },
                                "follower_attack_sound",
                            );
                        }

                        const maxHit = Math.max(0, combat.maxHit | 0);
                        const damage = maxHit > 0 ? Math.floor(Math.random() * (maxHit + 1)) : 0;
                        const result = this.actionScheduler.requestAction(
                            owner.id,
                            {
                                kind: "combat.companionHit",
                                data: {
                                    companionNpcId: companion.id,
                                    targetNpcId: target.id,
                                    damage,
                                    maxHit,
                                    style: HITMARK_DAMAGE,
                                    attackType: combat.attackType ?? "melee",
                                },
                                groups: ["combat.companion"],
                                cooldownTicks: 0,
                                delayTicks: Math.max(1, combat.hitDelay ?? 1),
                            },
                            currentTick,
                        );
                        return !!result.ok;
                    },
                );
            }
            this.movementSystem = new MovementSystem(
                this.players,
                this.options.pathService,
                this.npcManager,
            );
            // Set up loc change callback to broadcast to all clients
            this.players.setLocChangeCallback((oldId, newId, tile, level, opts) => {
                this.locationService.emitLocChange(oldId, newId, tile, level, opts);
            });
            this.tradeManager = new TradeManager(this.svc);
            this.players.setTradeHandshakeCallback((me, target, tick) => {
                this.tradeManager?.requestTrade(me, target, tick);
            });
            this.players.setGroundItemInteractionCallback((player, interaction) => {
                if (
                    interaction.option === "take" ||
                    interaction.option === "pick-up" ||
                    interaction.option === "pickup"
                ) {
                    this.groundItemHandler.attemptTakeGroundItem(
                        player,
                        {
                            x: interaction.tileX,
                            y: interaction.tileY,
                            level: interaction.tileLevel,
                        },
                        interaction.itemId,
                        interaction.stackId,
                    );
                    // The attemptTakeGroundItem handles inventory updates.
                    // Ground item visual updates will be handled by the broadcast phase.
                    // Do NOT call maybeSendGroundItemSnapshot here as it is not safe during pre_movement.
                }
            });
            this.players.setGameMessageCallback((player, text) => {
                this.messagingService.sendGameMessageToPlayer(player, text);
            });
            // Wire up skill action interruption callback
            this.players.setInterruptSkillActionsCallback((playerId) => {
                this.interfaceManager.interruptPlayerSkillActions(playerId);
            });
        }
        if (this.npcManager) {
            try {
                this.npcManager.setStatusEffectSystem(this.statusEffects);
            } catch (err) { logger.warn("[npc] status effect system init failed", err); }
        }
        if (this.players) {
            this.playerCombatManager = createPlayerCombatManager({
                scheduler: this.actionScheduler,
                players: this.players,
            });
            this.movementSystem?.setPlayerCombatManager(this.playerCombatManager);
            // Wire up callback to stop player auto-attack when player walks
            this.players.setStopAutoAttackCallback((playerId) => {
                this.playerCombatManager?.stopAutoAttack(playerId);
            });
            // Validate single/multi-combat rules before starting NPC attack interactions.
            this.players.setNpcCombatPermissionCallback((attacker, npc, currentTick) =>
                multiCombatSystem.canAttack(attacker, npc, currentTick),
            );
        }
    }

    private initServiceWiring(_opts: WSServerOptions): void {
        if (this.players) {
            this.npcPacketEncoder = new NpcPacketEncoder(this.svc);
            this.playerPacketEncoder = new PlayerPacketEncoder(this.svc);
            this.combatActionHandler = new CombatActionHandler(this.svc);
            this.spellActionHandler = new SpellActionHandler(this.svc);
            this.inventoryActionHandler = new InventoryActionHandler(this.svc);
            // Initialize EffectDispatcher
            this.effectDispatcher = new EffectDispatcher(this.svc);
            // Initialize WidgetDialogHandler
            this.widgetDialogHandler = new WidgetDialogHandler(this.svc);
            this.cs2ModalManager = new Cs2ModalManager(this.svc);
            this.npcSyncManager = new NpcSyncManager(this.svc);
            this.playerAppearanceManager = new PlayerAppearanceManager(this.svc);
            this.soundManager = new SoundManager(this.svc);
            this.groundItemHandler = new GroundItemHandler(this.svc);
            this.playerDeathService = new PlayerDeathService(this.svc);
            // Initialize ProjectileSystem
            this.projectileSystem = new ProjectileSystem(this.svc);
            // Initialize GatheringSystemManager
            this.gatheringSystem = new GatheringSystemManager(this.svc);
            // Initialize EquipmentHandler
            this.equipmentHandler = new EquipmentHandler(this.svc);
            this.combatEffectService = new CombatEffectService(this.svc);
            // Phase 3 deferred deps wired in consolidated block below
            // Initialize TickPhaseOrchestrator
            this.tickOrchestrator = new TickPhaseOrchestrator(this.svc);
            // Wire up broadcast domain callbacks that require players
            this.chatBroadcaster.setForEachPlayer((fn) => this.players?.forEach(fn));
            this.actorSyncBroadcaster.setForEachPlayer((fn) => this.players?.forEach(fn));
            this.actorSyncBroadcaster.setApplyAppearanceSnapshots((frame) =>
                this.tickPhaseService.applyAppearanceSnapshotsToViews(frame as TickFrame),
            );
            this.actorSyncBroadcaster.setSyncCallback((sock, player, frame, ctx) =>
                this.tickPhaseService.buildAndSendActorSync(sock, player, frame as TickFrame, ctx),
            );
        }
        if (this.npcManager) {
            this.npcManager.setLifecycleHooks({
                onRemove: (_npcId) => {},
                onReset: (_npcId) => {},
            });
            // RSMod parity: Wire up ground item spawner for delayed NPC death drops
            this.npcManager.setGroundItemSpawner((itemId, qty, tile, tick, opts, worldViewId) => {
                this.groundItems.spawn(itemId, qty, tile, tick, opts, worldViewId ?? -1);
            });
        }

        this.actionDispatchService = new ActionDispatchService(this.svc);
    }

    private initDeferredDeps(opts: WSServerOptions): void {
        this.authService = new AuthenticationService(
            {
                hasConnectedPlayer: (u) => this.players?.hasConnectedPlayer(u) ?? false,
                getTotalPlayerCount: () => this.players?.getTotalPlayerCount() ?? 0,
            },
            this.gamemode,
        );
        this.gameContext = new GameContext({
            ticker: opts.ticker,
            gamemode: this.gamemode,
            npcManager: this.npcManager,
            pathService: opts.pathService,
            mapService: opts.mapService,
            cacheEnv: this.cacheEnv,
            dataLoaders: this.dataLoaderService,
            auth: this.authService,
            network: this.networkLayer,
        });
        if (this.players) {
            this.gameContext.setPlayers(this.players);
            // movementService.players wired in deferred block below
        }
        logger.info("[services] Phase 1 services initialized (GameContext, DataLoaders, Auth, Network)");

        // --- Phase 2: Initialize core game services ---
        this.variableService = new VariableService(this.svc);
        this.messagingService = new MessagingService(this.svc);
        this.skillService = new SkillService(this.svc);
        logger.info("[services] Phase 2 services initialized (Variable, Messaging, Skill)");

        // --- Phase 3: Initialize inventory service ---
        this.inventoryService = new InventoryService(this.svc);
        this.appearanceService = new AppearanceService(this.svc);
        this.equipmentService = new EquipmentService(this.svc);
        logger.info("[services] Phase 3 services initialized (Inventory, Equipment, Appearance)");

        // --- Phase 4: Initialize combat data service ---
        this.combatDataService = new CombatDataService(this.svc);
        logger.info("[services] Phase 4 combat data service initialized");

        this.equipmentStatsUiService = new EquipmentStatsUiService(this.svc);

        // --- Phase 5: Initialize location service ---
        this.locationService = new LocationService(this.svc);
        this.interfaceManager = new ExtractedInterfaceManager(this.svc);
        logger.info("[services] Phase 5 services initialized (Location, InterfaceManager)");

        // --- Phase 6: Initialize sound and collection log services ---
        this.collectionLogService = new CollectionLogService(this.svc);
        this.worldEntityService = new WorldEntityService(this.svc);
        this.soundService = new SoundService(this.svc);
        this.movementService = new MovementService(this.svc);
        this.playerCombatService = new PlayerCombatService(this.svc);
        this.spellCastingService = new SpellCastingService(this.svc);
        this.varpSyncService = new VarpSyncService(this.svc);
        // --- Deferred wiring: cross-references between services created above ---


        // Wire deferred deps on the ScriptServiceAdapter deps object.
        // The adapter closures lazily read from this object, so mutations here
        // take effect before any script handler runs.
        this.scriptAdapterDeps.variableService = this.variableService;
        this.scriptAdapterDeps.messagingService = this.messagingService;
        this.scriptAdapterDeps.skillService = this.skillService;
        this.scriptAdapterDeps.inventoryService = this.inventoryService;
        this.scriptAdapterDeps.equipmentService = this.equipmentService;
        this.scriptAdapterDeps.appearanceService = this.appearanceService;
        this.scriptAdapterDeps.locationService = this.locationService;
        this.scriptAdapterDeps.collectionLogService = this.collectionLogService;
        this.scriptAdapterDeps.soundService = this.soundService;
        this.scriptAdapterDeps.movementService = this.movementService;
        this.scriptAdapterDeps.widgetDialogHandler = this.widgetDialogHandler;
        this.scriptAdapterDeps.gatheringSystem = this.gatheringSystem;
        this.scriptAdapterDeps.cs2ModalManager = this.cs2ModalManager;
        this.scriptAdapterDeps.followerManager = this.followerManager;
        this.scriptAdapterDeps.followerCombatManager = this.followerCombatManager;
        this.scriptAdapterDeps.inventoryActionHandler = this.inventoryActionHandler;
        this.scriptAdapterDeps.effectDispatcher = this.effectDispatcher;

        this.inventoryMessageService = new InventoryMessageService({
            getPlayer: (ws) => this.players?.get(ws),
            getInventory: (p) => this.inventoryService.getInventory(p),
            setInventorySlot: (p, slot, itemId, qty) => this.inventoryService.setInventorySlot(p, slot, itemId, qty),
            ensureEquipArray: (p) => this.equipmentService.ensureEquipArray(p),
            resolveEquipSlot: (itemId) => this.equipmentService.resolveEquipSlot(itemId),
            getObjType: (itemId) => this.dataLoaderService.getObjType(itemId) as any,
            requestAction: (playerId, request, tick) => this.actionScheduler.requestAction(playerId, request, tick),
            queueItemAction: (request) => this.scriptRuntime.queueItemAction(request),
            closeInterruptibleInterfaces: (p) => this.interfaceManager.closeInterruptibleInterfaces(p),
            openDialog: (p, req) => this.widgetDialogHandler!.openDialog(p, req),
            openDialogOptions: (p, req) => this.widgetDialogHandler!.openDialogOptions(p, req),
            spawnGroundItem: (itemId, qty, tile, tick, opts, worldViewId) =>
                this.groundItems.spawn(itemId, qty, tile, tick, opts, worldViewId ?? -1),
            withDirectSendBypass: (ctx, fn) => this.networkLayer.withDirectSendBypass(ctx, fn),
            sendSound: (p, soundId) => this.soundService.sendSound(p, soundId),
            checkAndSendSnapshots: (p) => {
                const sock = this.players?.getSocketByPlayerId(p.id);
                if (sock) this.tickPhaseService.checkAndSendSnapshots(p, sock);
            },
            queueChatMessage: (msg) => this.messagingService.queueChatMessage(msg),
            getPendingWalkCommands: () => this.movementService.getPendingWalkCommands() as Map<import("ws").WebSocket, Record<string, unknown>>,
            handleGroundItemActionDelegate: (ws, payload) => this.groundItemHandler?.handleGroundItemAction(ws, payload),
            getCurrentTick: () => this.options.ticker.currentTick(),
        });

        logger.info("[services] All services initialized");
        if (this.cacheEnv) {
            try {
                this.dbRepository = new DbRepository(this.cacheEnv.cacheSystem);
                this.combatCategoryData = new CombatCategoryData(this.dbRepository);
                this.npcSoundLookup = new NpcSoundLookup(this.dbRepository);
                this.npcSoundLookup.initialize();
                this.musicCatalogService = new MusicCatalogService(this.dbRepository);
                this.scriptAdapterDeps.musicCatalogService = this.musicCatalogService;

                this.musicUnlockService = new MusicUnlockService(this.musicCatalogService);
            } catch (err) {
                logger.warn("[combat] failed to load combat category data", err);
            }
        }
        if (this.cacheFactory) {
            try {
                this.objTypeLoader = this.cacheFactory.getObjTypeLoader();
            } catch (err) { logger.warn("[cache] obj type loader init failed", err); }
            let enumTypeLoader: import("../../../src/rs/config/enumtype/EnumTypeLoader").EnumTypeLoader | undefined;
            try {
                enumTypeLoader = this.cacheFactory.getEnumTypeLoader?.();
            } catch (err) { logger.warn("[cache] enum type loader init failed", err); }

            // Collection log tracking/category mapping is server-authoritative from JSON.
            loadCollectionLogItems();
            if (enumTypeLoader) {
                this.combatDataService.loadSpecialAttackCacheData(enumTypeLoader);
            }
        }
    }

    private initGamemode(_opts: WSServerOptions): void {
        if (this.cacheFactory) {
            this.gamemode.initialize({
                npcTypeLoader: this.npcTypeLoader,
                objTypeLoader: this.objTypeLoader,
                bridge: {
                    getPlayer: (playerId) => this.players?.getById(playerId),
                    queueVarp: (playerId, varpId, value) =>
                        this.variableService.queueVarp(playerId, varpId, value),
                    queueVarbit: (playerId, varbitId, value) =>
                        this.variableService.queueVarbit(playerId, varbitId, value),
                    queueNotification: (playerId, notification) =>
                        this.messagingService.queueNotification(playerId, notification as Record<string, unknown>),
                    queueWidgetEvent: (playerId, event) =>
                        this.queueWidgetEvent(playerId, event as WidgetAction),
                    queueClientScript: (playerId, scriptId, ...args) =>
                        this.broadcastService.queueClientScript(playerId, scriptId, ...args),
                    sendGameMessage: (player, text) =>
                        this.messagingService.sendGameMessageToPlayer(player, text),
                },
                serverServices: buildGamemodeServices({
                    dataLoaders: this.dataLoaderService,
                    variableService: this.variableService,
                    messagingService: this.messagingService,
                    inventoryService: this.inventoryService,
                    equipmentService: this.equipmentService,
                    appearanceService: this.appearanceService,
                    getCurrentTick: () => this.options.ticker.currentTick(),
                    getPlayerById: (id) => this.players?.getById(id),
                    getSocketByPlayerId: (id) => this.players?.getSocketByPlayerId(id),
                    refreshCombatWeaponCategory: (p) => this.equipmentService.refreshCombatWeaponCategory(p),
                    queueCombatSnapshot: (...args: Parameters<typeof this.queueCombatSnapshot>) => this.queueCombatSnapshot(...args),
                    queueWidgetEvent: (pid, evt) => this.queueWidgetEvent(pid, evt as any),
                    queueGamemodeSnapshot: (k, pid, p) => this.queueGamemodeSnapshot(k, pid, p),
                    registerSnapshotEncoder: (k, e, o) => this.registerSnapshotEncoder(k, e, o),
                    gamemodeTickCallbacks: this.gamemodeTickCallbacks,
                    interfaceService: this.interfaceService,
                    eventBus: this.eventBus,
                }),
            });
            logger.info(`Boot: gamemode "${this.gamemode.id}" initialized`);

            this.appearanceService.loadWeaponData();

            // Let gamemode contribute additional ScriptServices methods (banking, etc.)
            if (this.gamemode.contributeScriptServices) {
                this.gamemode.contributeScriptServices(this.scriptRuntime.getServices());
            }

            // Wire fallback dispatcher so gamemode-registered message handlers
            // (via registerClientMessageHandler) are checked for unhandled message types.
            this.messageRouter.setFallbackDispatcher((type, _ws, player, payload) => {
                const handler = this.scriptRegistry.findClientMessageHandler(type);
                if (!handler || !player) return false;
                handler({
                    player,
                    messageType: type,
                    payload: (payload ?? {}) as Record<string, unknown>,
                    tick: this.options.ticker.currentTick(),
                    services: this.scriptRuntime.getServices(),
                });
                return true;
            });

            this.gamemodeUi = this.gamemode.createUiController!({
                queueWidgetEvent: (playerId, action) =>
                    this.queueWidgetEvent(playerId, action),
                queueVarp: (playerId, varpId, value) =>
                    this.variableService.queueVarp(playerId, varpId, value),
                queueVarbit: (playerId, varbitId, value) =>
                    this.variableService.queueVarbit(playerId, varbitId, value),
                isWidgetGroupOpenInLedger: (playerId, groupId) =>
                    this.interfaceManager.isWidgetGroupOpenInLedger(playerId, groupId),
            });
            logger.info(`Boot: gamemode UI controller created`);

        }
    }

    private initPlayerAnimations(): void {
        try {
            const basTypeLoader = this.cacheFactory?.getBasTypeLoader();
            if (basTypeLoader) {
                this.defaultPlayerAnimMale =
                    this.appearanceService.loadAnimSetFromBas(() => basTypeLoader.load(0)) ||
                    this.defaultPlayerAnimMale;
                this.defaultPlayerAnimFemale =
                    this.appearanceService.loadAnimSetFromBas(() => basTypeLoader.load(1)) ||
                    this.defaultPlayerAnimFemale;

                const bcount = basTypeLoader.getCount?.() ?? 0;
                let best: PlayerAnimSet | undefined;
                for (let id = 0; id < bcount; id++) {
                    const anim = this.appearanceService.loadAnimSetFromBas(() => basTypeLoader.load(id));
                    if (!anim) continue;
                    if (!best) best = anim;
                    const prefers =
                        (anim.idle ?? -1) === 808 ||
                        (anim.walk ?? -1) === 819 ||
                        (anim.run ?? -1) === 824;
                    if (prefers) {
                        best = anim;
                        break;
                    }
                }
                if (best) this.defaultPlayerAnim = best;
            }
        } catch (e) {
            // Leave defaults; fall back to hard-coded values later
        }

        if (!this.defaultPlayerAnimMale) this.defaultPlayerAnimMale = this.defaultPlayerAnim;
        if (!this.defaultPlayerAnimFemale) this.defaultPlayerAnimFemale = this.defaultPlayerAnim;
    }

    private initTestBots(): void {
        try {
            const bot1 = this.players?.addBot(3168, 3475, 0);
            const bot2 = this.players?.addBot(3173, 3475, 0);

            const setupCasterBot = (p: PlayerState, target: PlayerState) => {
                if (!p) return;
                p.items.setItemDefResolver((id: number) => getItemDefinition(id));
                this.appearanceService.refreshAppearanceKits(p);
                applyAutocastState(p, 3273, 1, false); // Wind Strike
                (p as any).botInteraction = { kind: "playerCombat", playerId: target.id };
                // Give runes for Wind Strike (Air + Mind)
                p.items.addItem(556, 10000, { assureFullInsertion: true }); // Air rune
                p.items.addItem(558, 10000, { assureFullInsertion: true }); // Mind rune
            };

            const setupPassiveBot = (p: PlayerState) => {
                if (!p) return;
                p.items.setItemDefResolver((id: number) => getItemDefinition(id));
                this.appearanceService.refreshAppearanceKits(p);
                clearAutocastState(p);
                (p as any).botInteraction = undefined;
            };

            if (bot1 && bot2) {
                // Only bot1 casts at bot2 for now; bot2 stays stationary/passive.
                setupCasterBot(bot1, bot2);
                setupPassiveBot(bot2);
                this.actionScheduler.registerPlayer(bot1);
                this.actionScheduler.registerPlayer(bot2);
            }
        } catch (err) { logger.warn("[bot] test bot spawn failed", err); }
    }

    private serializeAppearancePayload(
        view: import("./encoding/types").PlayerViewSnapshot,
    ): Uint8Array {
        const player = this.players?.getById(view.id);
        return encodeAppearanceBinary(view, {
            combatLevel: player?.skillSystem.combatLevel ?? 3,
            skillLevel: player?.skillSystem.skillTotal ?? 32,
            isHidden: false,
            actions: ["", "", ""],
        });
    }

    private withDirectSendBypass<T>(context: string, fn: () => T): T {
        return this.networkLayer.withDirectSendBypass(context, fn);
    }

    sendWithGuard(ws: WebSocket | undefined, msg: string | Uint8Array, context: string): void {
        this.networkLayer.sendWithGuard(ws, msg, context);
    }

    getScriptScheduler(): ScriptScheduler {
        return this.scriptScheduler;
    }

    private normalizeSideJournalState(
        player: PlayerState,
        incomingStateVarp?: number,
    ): { tab: number; stateVarp: number } {
        return this.gamemodeUi.normalizeSideJournalState(player, incomingStateVarp);
    }

    private queueSideJournalGamemodeUi(player: PlayerState): void {
        this.gamemodeUi.applySideJournalUi(player);
    }

    private queueActivateQuestSideTab(playerId: number): void {
        this.gamemodeUi.activateQuestTab(playerId);
    }

    private queueWidgetEvent(playerId: number, action: WidgetAction): void {
        const event = { playerId: playerId, action };
        this.interfaceManager.noteWidgetEventForLedger(event.playerId, action);
        // Tick-phase parity: if called during active game logic phases, include in the
        // current frame so it broadcasts this tick (avoids 1-tick UI highlight lag).
        // During broadcast phase itself, queue for next tick to avoid mutating the
        // frame while it is being iterated for sends.
        let queuedInCurrentFrame = false;
        if (this.activeFrame && !this.networkLayer.getIsBroadcastPhase()) {
            this.activeFrame.widgetEvents.push(event);
            queuedInCurrentFrame = true;
        }
        if (!queuedInCurrentFrame) {
            this.broadcastScheduler.queueWidgetEvent(event);
        }

        // Equipment stats (84) value fields are cache-empty text widgets.
        // Populate them server-side immediately after opening the interface.
        if (action.action === "open_sub" && (action.groupId ?? 0) === 84) {
            const player = this.players?.getById(event.playerId);
            if (player) {
                this.equipmentStatsUiService.queueEquipmentStatsWidgetTexts(player);
            }
        }
        if (action.action === "open_sub" && (action.groupId ?? 0) === ACCOUNT_SUMMARY_GROUP_ID) {
            const player = this.players?.getById(event.playerId);
            if (player) {
                this.accountSummary.syncPlayer(player, Date.now(), true);
            }
        }
        if (action.action === "open_sub") {
            const player = this.players?.getById(event.playerId);
            if (player) {
                this.gamemode.onWidgetOpen?.(player, action.groupId ?? 0);
            }
        }
        if (action.action === "open_sub" && (action.groupId ?? 0) === REPORT_GAME_TIME_GROUP_ID) {
            const player = this.players?.getById(event.playerId);
            if (player) {
                this.reportGameTime.syncPlayer(player, Date.now(), true);
            }
        }
    }


    /**
     * Queue a gamemode snapshot for tick-phase delivery.
     * Snapshots are keyed by type (e.g. "bank") and upserted per player.
     */
    private queueGamemodeSnapshot(key: string, playerId: number, payload: unknown): void {
        const event = { playerId, payload };

        const upsert = (queue: Array<{ playerId: number; payload: unknown }>) => {
            const idx = queue.findIndex((entry) => entry.playerId === event.playerId);
            if (idx >= 0) {
                queue[idx] = event;
            } else {
                queue.push(event);
            }
        };

        if (this.activeFrame && !this.networkLayer.getIsBroadcastPhase()) {
            const frameQueue = this.activeFrame.gamemodeSnapshots.get(key) ?? [];
            upsert(frameQueue);
            this.activeFrame.gamemodeSnapshots.set(key, frameQueue);
            return;
        }

        this.broadcastScheduler.queueGamemodeSnapshot(key, playerId, payload);
    }

    private registerSnapshotEncoder(
        key: string,
        encoder: (playerId: number, payload: unknown) => { message: string | Uint8Array; context: string } | undefined,
        onSent?: (playerId: number, payload: unknown) => void,
    ): void {
        this.gamemodeSnapshotEncoders.set(key, { encode: encoder, onSent });
    }

    private queueCombatSnapshot(
        playerId: number,
        weaponCategory: number,
        weaponItemId: number,
        autoRetaliate: boolean,
        activeStyle?: number,
        activePrayers?: string[],
        activeSpellId?: number,
    ): void {
        let specialEnergy: number | undefined;
        let specialActivated: boolean | undefined;
        let quickPrayers: string[] | undefined;
        let quickPrayersEnabled: boolean | undefined;
        const player = this.players?.getById(playerId);
        if (player) {
            try {
                specialEnergy = player.specEnergy.getPercent();
                specialActivated = player.specEnergy.isActivated();
                player.specEnergy.markSynced();
                const quickSet = player.prayer.getQuickPrayers();
                if (quickSet.size > 0) {
                    quickPrayers = Array.from(quickSet);
                } else if (quickSet.size === 0) {
                    quickPrayers = [];
                }
                quickPrayersEnabled = player.prayer.areQuickPrayersEnabled();
            } catch (err) { logger.warn("[combat] player state snapshot failed", err); }
        }
        const snapshot = {
            playerId: playerId,
            weaponCategory,
            weaponItemId,
            autoRetaliate,
            activeStyle,
            activePrayers,
            activeSpellId,
            specialEnergy,
            specialActivated,
            quickPrayers,
            quickPrayersEnabled,
        };
        if (this.activeFrame) {
            this.activeFrame.combatSnapshots.push(snapshot);
            return;
        }
        this.broadcastScheduler.queueCombatSnapshot(snapshot);
    }

    private queueCombatState(player: PlayerState): void {
        this.queueCombatSnapshot(
            player.id,
            player.combat.weaponCategory,
            player.combat.weaponItemId,
            player.combat.autoRetaliate,
            player.combat.styleSlot,
            Array.from(player.prayer.activePrayers ?? []),
            player.combat.spellId > 0 ? player.combat.spellId : undefined,
        );
    }
    private createMessageRouter(): MessageRouter {
        const services: MessageRouterServices = {
            getPlayer: (ws) => this.players?.get(ws),
            sendWithGuard: (ws, message, context) => this.networkLayer.sendWithGuard(ws, message, context),
            sendAdminResponse: (ws, message, context) =>
                this.networkLayer.sendAdminResponse(ws, message, context),
            withDirectSendBypass: (context, fn) => this.withDirectSendBypass(context, fn),
            queueChatMessage: (msg) => this.messagingService.queueChatMessage(msg),
            broadcastOperatorCommand: (source, text, fromId, fromName) =>
                this.botSdkServer?.broadcastOperatorCommand(source, text, fromId, fromName) ?? 0,
            closeInterruptibleInterfaces: (player) => this.interfaceManager.closeInterruptibleInterfaces(player),
            encodeMessage: encodeMessage,
        };

        const router = new MessageRouter(services);

        // Register message handlers
        ServiceWiring.registerMessageHandlers(this.svc, router);

        return router;
    }
    /**
     * Check if player has a modal dialog open that should pause skill action execution.
     */
    hasModalOpen(playerId: number): boolean {
        const player = this.players?.getById(playerId);
        return player?.widgets?.hasModalOpen?.() ?? false;
    }

    get tickMs(): number {
        return this.options.tickMs;
    }

    get pathService(): PathService | undefined {
        return this.options.pathService;
    }


    private queueExternalNpcTeleportSync(npc: NpcState): void {
        const delta = buildTeleportNpcUpdateDelta(npc);
        if (this.activeFrame) {
            upsertNpcUpdateDelta(this.activeFrame.npcUpdates, delta);
            return;
        }
        upsertNpcUpdateDelta(this.pendingNpcUpdates, delta);
    }

}
