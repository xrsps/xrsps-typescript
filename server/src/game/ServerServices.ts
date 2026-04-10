/**
 * Shared service context passed to all services.
 *
 * Every service receives a reference to this object and accesses
 * dependencies directly (e.g. `this.services.equipmentService.ensureEquipArray(p)`).
 *
 * Fields are optional (`?`) when populated after initial construction
 * or conditionally created. Services that always exist from startup are required.
 *
 * No service reads from this object at construction time — only at call time
 * (during tick processing), so populating fields incrementally with
 * `{} as ServerServices` is safe.
 */

// ── Cache / shared types ────────────────────────────────────────────────────
import type { Huffman } from "../../../src/rs/chat/Huffman";
import type { DbRepository } from "../../../src/rs/config/db/DbRepository";
import type { LocTypeLoader } from "../../../src/rs/config/loctype/LocTypeLoader";
import type { NpcTypeLoader } from "../../../src/rs/config/npctype/NpcTypeLoader";
import type { ObjTypeLoader } from "../../../src/rs/config/objtype/ObjTypeLoader";
import type { BasType } from "../../../src/rs/config/bastype/BasType";
import type { IdkType } from "../../../src/rs/config/idktype/IdkType";

// ── Audio ───────────────────────────────────────────────────────────────────
import type { MusicCatalogService } from "../audio/MusicCatalogService";
import type { MusicRegionService } from "../audio/MusicRegionService";
import type { MusicUnlockService } from "../audio/MusicUnlockService";
import type { NpcSoundLookup } from "../audio/NpcSoundLookup";

// ── Game – actions ──────────────────────────────────────────────────────────
import type { ActionScheduler } from "./actions/ActionScheduler";
import type { CombatActionHandler } from "./actions/handlers/CombatActionHandler";
import type { EffectDispatcher } from "./actions/handlers/EffectDispatcher";
import type { InventoryActionHandler } from "./actions/handlers/InventoryActionHandler";
import type { SpellActionHandler } from "./actions/handlers/SpellActionHandler";
import type { WidgetDialogHandler } from "./actions/handlers/WidgetDialogHandler";

// ── Game – combat ───────────────────────────────────────────────────────────
import type { PlayerCombatManager } from "./combat";
import type { CombatCategoryData } from "./combat/CombatCategoryData";

// ── Game – death ────────────────────────────────────────────────────────────
import type { PlayerDeathService } from "./death/PlayerDeathService";

// ── Game – events ───────────────────────────────────────────────────────────
import type { GameEventBus } from "./events/GameEventBus";

// ── Game – followers ────────────────────────────────────────────────────────
import type { FollowerCombatManager } from "./followers/FollowerCombatManager";
import type { FollowerManager } from "./followers/FollowerManager";

// ── Game – gamemodes ────────────────────────────────────────────────────────
import type { GamemodeDefinition, GamemodeUiController } from "./gamemodes/GamemodeDefinition";

// ── Game – items ────────────────────────────────────────────────────────────
import type { GroundItemManager } from "./items/GroundItemManager";

// ── Game – core ─────────────────────────────────────────────────────────────
import type { NpcManager } from "./npcManager";
import type { PlayerManager, PlayerState } from "./player";
import type { PrayerSystem } from "./prayer/PrayerSystem";
import type { SailingInstanceManager } from "./sailing/SailingInstanceManager";
import type { ScriptRegistry, ScriptRuntime } from "./scripts";

// ── Game – services ─────────────────────────────────────────────────────────
import type { ActionDispatchService } from "./services/ActionDispatchService";
import type { AppearanceService } from "./services/AppearanceService";
import type { CombatDataService } from "./services/CombatDataService";
import type { CombatEffectService } from "./services/CombatEffectService";
import type { CollectionLogService } from "./services/CollectionLogService";
import type { DataLoaderService } from "./services/DataLoaderService";
import type { EquipmentService } from "./services/EquipmentService";
import type { EquipmentStatsUiService } from "./services/EquipmentStatsUiService";
import type { InterfaceManager } from "./services/InterfaceManager";
import type { InventoryMessageService } from "./services/InventoryMessageService";
import type { InventoryService } from "./services/InventoryService";
import type { LocationService } from "./services/LocationService";
import type { MessagingService } from "./services/MessagingService";
import type { MovementService } from "./services/MovementService";
import type { PlayerCombatService } from "./services/PlayerCombatService";
import type { ProjectileTimingService } from "./services/ProjectileTimingService";
import type { SkillService } from "./services/SkillService";
import type { SoundService } from "./services/SoundService";
import type { SpellCastingService } from "./services/SpellCastingService";
import type { TickFrameService } from "./services/TickFrameService";
import type { TickPhaseService } from "./services/TickPhaseService";
import type { VariableService } from "./services/VariableService";
import type { VarpSyncService } from "./services/VarpSyncService";
import type { WorldEntityService } from "./services/WorldEntityService";

// ── Game – state ────────────────────────────────────────────────────────────
import type { AccountStore } from "./state/AccountStore";
import type { PersistenceProvider } from "./state/PersistenceProvider";

// ── Game – systems ──────────────────────────────────────────────────────────
import type {
    BroadcastScheduler,
    EquipmentHandler,
    GatheringSystemManager,
    MovementSystem,
    PlayerAnimSet,
    ProjectileSystem,
    ScriptScheduler,
    StatusEffectSystem,
} from "./systems";

// ── Game – tick ─────────────────────────────────────────────────────────────
import type { GameTicker } from "./ticker";
import type { TickPhaseOrchestrator, TickFrame } from "./tick";

// ── Game – trade ────────────────────────────────────────────────────────────
import type { TradeManager } from "./trade/TradeManager";

// ── Network ─────────────────────────────────────────────────────────────────
import type { AccountSummaryTracker } from "../network/accountSummary";
import type { AuthenticationService } from "../network/AuthenticationService";
import type { BroadcastService } from "../network/BroadcastService";
import type {
    ChatBroadcaster,
    ActorSyncBroadcaster,
    SkillBroadcaster,
    VarBroadcaster,
    InventoryBroadcaster,
    WidgetBroadcaster,
    CombatBroadcaster,
    MiscBroadcaster,
} from "../network/broadcast";
import type { NpcPacketEncoder, PlayerPacketEncoder } from "../network/encoding";
import type { WorldEntityInfoEncoder } from "../network/encoding/WorldEntityInfoEncoder";
import type { LoginHandshakeService } from "../network/LoginHandshakeService";
import type {
    Cs2ModalManager,
    GroundItemHandler,
    NpcSyncManager,
    PlayerAppearanceManager,
    SoundManager,
} from "../network/managers";
import type { MessageRouter } from "../network/MessageRouter";
import type { PlayerNetworkLayer } from "../network/PlayerNetworkLayer";
import type { ReportGameTimeTracker } from "../network/reportGameTime";

// ── Pathfinding ─────────────────────────────────────────────────────────────
import type { PathService } from "../pathfinding/PathService";

// ── Widgets ─────────────────────────────────────────────────────────────────
import type { InterfaceService } from "../widgets/InterfaceService";
import type { WidgetAction } from "../widgets/WidgetManager";

// ── World ───────────────────────────────────────────────────────────────────
import type { CacheEnv } from "../world/CacheEnv";
import type { DoorStateManager } from "../world/DoorStateManager";
import type { DynamicLocStateStore } from "../world/DynamicLocStateStore";
import type { MapCollisionService } from "../world/MapCollisionService";

// ── Network types ───────────────────────────────────────────────────────────
import type { WebSocket } from "ws";
import type { NpcSyncSession } from "../network/NpcSyncSession";
import type { PlayerSyncSession } from "../network/PlayerSyncSession";

// ─────────────────────────────────────────────────────────────────────────────

export interface ServerServices {
    // ── Config & infrastructure ──────────────────────────────────────────
    readonly ticker: GameTicker;
    readonly tickMs: number;
    readonly gamemode: GamemodeDefinition;
    gamemodeUi: GamemodeUiController;
    readonly pathService?: PathService;
    readonly mapService?: MapCollisionService;
    readonly eventBus: GameEventBus;
    activeFrame?: TickFrame;
    maintenanceMode?: boolean;

    // ── Cache / data loaders ─────────────────────────────────────────────
    cacheEnv: CacheEnv;
    npcTypeLoader?: NpcTypeLoader;
    locTypeLoader?: LocTypeLoader;
    objTypeLoader?: ObjTypeLoader;
    huffman?: Huffman;
    dbRepository?: DbRepository;
    healthBarDefLoader?: { load(defId: number): { width?: number } | undefined };
    basTypeLoader?: { load(id: number): BasType | undefined };
    idkTypeLoader?: { load(id: number): IdkType | undefined };

    // ── Core state managers ──────────────────────────────────────────────
    players?: PlayerManager;
    npcManager?: NpcManager;
    readonly playerPersistence: PersistenceProvider;
    readonly accountStore: AccountStore;
    /**
     * Bot-SDK WebSocket server. Optional because the endpoint is
     * disabled unless `BOT_SDK_TOKEN` is set — in which case the
     * field is still populated but `start()` is a no-op. Code that
     * uses this should tolerate a missing `broadcastOperatorCommand`
     * gracefully (e.g. the chat `::steer` handler).
     */
    botSdkServer?: import("../network/botsdk").BotSdkServer;

    // ── Game services ────────────────────────────────────────────────────
    readonly dataLoaderService: DataLoaderService;
    readonly variableService: VariableService;
    readonly messagingService: MessagingService;
    readonly skillService: SkillService;
    readonly inventoryService: InventoryService;
    readonly equipmentService: EquipmentService;
    readonly appearanceService: AppearanceService;
    readonly combatDataService: CombatDataService;
    readonly locationService: LocationService;
    readonly interfaceManager: InterfaceManager;
    readonly collectionLogService: CollectionLogService;
    readonly worldEntityService: WorldEntityService;
    readonly soundService: SoundService;
    readonly movementService: MovementService;
    playerCombatService?: PlayerCombatService;
    readonly combatEffectService: CombatEffectService;
    readonly varpSyncService: VarpSyncService;
    readonly equipmentStatsUiService: EquipmentStatsUiService;
    readonly tickPhaseService: TickPhaseService;
    readonly tickFrameService: TickFrameService;
    readonly actionDispatchService: ActionDispatchService;
    spellCastingService?: SpellCastingService;
    projectileTimingService?: ProjectileTimingService;
    inventoryMessageService?: InventoryMessageService;

    // ── Combat data ──────────────────────────────────────────────────────
    combatCategoryData?: CombatCategoryData;
    playerCombatManager?: PlayerCombatManager;

    // ── Audio ────────────────────────────────────────────────────────────
    npcSoundLookup?: NpcSoundLookup;
    musicCatalogService?: MusicCatalogService;
    musicUnlockService?: MusicUnlockService;
    musicRegionService?: MusicRegionService;

    // ── Systems ──────────────────────────────────────────────────────────
    readonly actionScheduler: ActionScheduler;
    readonly broadcastScheduler: BroadcastScheduler;
    readonly scriptRuntime: ScriptRuntime;
    readonly scriptRegistry: ScriptRegistry;
    readonly scriptScheduler: ScriptScheduler;
    readonly statusEffects: StatusEffectSystem;
    readonly prayerSystem: PrayerSystem;
    readonly groundItems: GroundItemManager;
    readonly gatheringSystem: GatheringSystemManager;
    readonly equipmentHandler: EquipmentHandler;
    projectileSystem?: ProjectileSystem;
    movementSystem?: MovementSystem;
    tradeManager?: TradeManager;
    followerManager?: FollowerManager;
    followerCombatManager?: FollowerCombatManager;
    interfaceService?: InterfaceService;
    sailingInstanceManager?: SailingInstanceManager;
    doorManager?: DoorStateManager;
    tickOrchestrator?: TickPhaseOrchestrator;

    // ── Action handlers ──────────────────────────────────────────────────
    combatActionHandler?: CombatActionHandler;
    spellActionHandler?: SpellActionHandler;
    inventoryActionHandler?: InventoryActionHandler;
    effectDispatcher?: EffectDispatcher;
    widgetDialogHandler?: WidgetDialogHandler;
    playerDeathService?: PlayerDeathService;

    // ── Network layer ────────────────────────────────────────────────────
    readonly networkLayer: PlayerNetworkLayer;
    readonly authService: AuthenticationService;
    readonly broadcastService: BroadcastService;
    readonly loginHandshakeService: LoginHandshakeService;
    messageRouter?: MessageRouter;

    // ── Broadcasters ─────────────────────────────────────────────────────
    readonly chatBroadcaster: ChatBroadcaster;
    readonly actorSyncBroadcaster: ActorSyncBroadcaster;
    readonly skillBroadcaster: SkillBroadcaster;
    readonly varBroadcaster: VarBroadcaster;
    readonly inventoryBroadcaster: InventoryBroadcaster;
    readonly widgetBroadcaster: WidgetBroadcaster;
    readonly combatBroadcaster: CombatBroadcaster;
    readonly miscBroadcaster: MiscBroadcaster;

    // ── Encoders ─────────────────────────────────────────────────────────
    readonly worldEntityInfoEncoder: WorldEntityInfoEncoder;
    playerPacketEncoder?: PlayerPacketEncoder;
    npcPacketEncoder?: NpcPacketEncoder;

    // ── Network managers ─────────────────────────────────────────────────
    playerAppearanceManager?: PlayerAppearanceManager;
    soundManager?: SoundManager;
    groundItemHandler?: GroundItemHandler;
    cs2ModalManager?: Cs2ModalManager;
    npcSyncManager?: NpcSyncManager;

    // ── Trackers ─────────────────────────────────────────────────────────
    readonly accountSummary: AccountSummaryTracker;
    readonly reportGameTime: ReportGameTimeTracker;

    // ── Animation defaults ───────────────────────────────────────────────
    defaultPlayerAnim: PlayerAnimSet;
    defaultPlayerAnimMale?: PlayerAnimSet;
    defaultPlayerAnimFemale?: PlayerAnimSet;

    // ── State collections (owned by wsServer, exposed for service access) ─
    readonly dynamicLocState: DynamicLocStateStore;
    readonly playerSyncSessions: Map<WebSocket, PlayerSyncSession>;
    readonly npcSyncSessions: Map<WebSocket, NpcSyncSession>;
    readonly playerDynamicLocSceneKeys: Map<number, string>;
    readonly pendingNpcPackets: Map<
        number,
        { snapshots: import("../network/managers/NpcSyncManager").NpcViewSnapshot[]; updates: import("../network/managers/NpcSyncManager").NpcUpdatePayload[]; despawns: number[] }
    >;
    readonly playerGroundSerial: Map<number, number>;
    readonly playerGroundChunk: Map<number, number>;
    readonly pendingDirectSends: Map<WebSocket, { message: string | Uint8Array; context: string }>;
    pendingDebugRequests?: Map<number, WebSocket>;
    readonly wssClients: Set<WebSocket>;
    pendingNpcUpdates: import("./npc").NpcUpdateDelta[];
    readonly gamemodeTickCallbacks: Array<(tick: number) => void>;
    enableBinaryNpcSync: boolean;

    // ── Coordination methods ─────────────────────────────────────────────
    queueWidgetEvent(playerId: number, action: WidgetAction): void;
    queueCombatState(player: PlayerState): void;
}
