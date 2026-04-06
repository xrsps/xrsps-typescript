import JavaRandom from "java-random";
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
import { LevelUpDisplayService } from "../game/services/LevelUpDisplayService";
import { EquipmentStatsUiService } from "../game/services/EquipmentStatsUiService";
import { ActionDispatchService } from "../game/services/ActionDispatchService";
import { AuthenticationService } from "./AuthenticationService";
import { PlayerNetworkLayer } from "./PlayerNetworkLayer";

import { ConfigType } from "../../../src/rs/cache/ConfigType";
import { IndexType } from "../../../src/rs/cache/IndexType";
import { getCacheLoaderFactory } from "../../../src/rs/cache/loader/CacheLoaderFactory";
import { Huffman, tryLoadOsrsHuffman } from "../../../src/rs/chat/Huffman";
import { DbRepository } from "../../../src/rs/config/db/DbRepository";
import { ArchiveHealthBarDefinitionLoader } from "../../../src/rs/config/healthbar/HealthBarDefinitionLoader";
import type { NpcTypeLoader } from "../../../src/rs/config/npctype/NpcTypeLoader";
import type { ObjTypeLoader } from "../../../src/rs/config/objtype/ObjTypeLoader";
import type { ProjectileLaunch } from "../../../src/shared/projectiles/ProjectileLaunch";
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
    ActionEffect,
    ActionScheduler,
    EffectDispatcher,
    InventoryActionHandler,
    WidgetDialogHandler,
} from "../game/actions";

import {
    loadCollectionLogItems,
} from "../game/collectionlog";
import { PlayerCombatManager, createPlayerCombatManager } from "../game/combat";
import { applyAutocastState, clearAutocastState } from "../game/combat/AutocastState";
import { CombatCategoryData } from "../game/combat/CombatCategoryData";
import { combatEffectApplicator } from "../game/combat/CombatEffectApplicator";
import {
    HITMARK_DAMAGE,
} from "../game/combat/HitEffects";
import {
    multiCombatSystem,
} from "../game/combat/MultiCombatZones";
import { FollowerCombatManager } from "../game/followers/FollowerCombatManager";
import { FollowerManager } from "../game/followers/FollowerManager";
import { GroundItemManager } from "../game/items/GroundItemManager";
import type { GamemodeDefinition } from "../game/gamemodes/GamemodeDefinition";
import { getGamemodeDataDir } from "../game/gamemodes/GamemodeRegistry";
import { NpcState, type NpcUpdateDelta } from "../game/npc";
import { NpcManager, type NpcStatusEvent } from "../game/npcManager";
import {
    type PlayerAppearance as PlayerAppearanceState,
    PlayerManager,
    PlayerState,
    SkillSyncUpdate,
} from "../game/player";
import { PrayerSystem } from "../game/prayer/PrayerSystem";
import { ScriptRegistry } from "../game/scripts";
import { ScriptRuntime } from "../game/scripts";
import { bootstrapScripts } from "../game/scripts/bootstrap";
import { PlayerPersistence } from "../game/state/PlayerPersistence";
import {
    BroadcastScheduler,
    type ChatMessageSnapshot,
    type ForcedChatBroadcast,
    type ForcedMovementBroadcast,
    type HitsplatBroadcast,
    type PendingSpotAnimation,
    type PlayerAnimSet,
} from "../game/systems/BroadcastScheduler";
import { EquipmentHandler } from "../game/systems/EquipmentHandler";
import {
    GatheringSystemManager,
} from "../game/systems/GatheringSystemManager";
import { MovementSystem } from "../game/systems/MovementSystem";
import { ProjectileSystem } from "../game/systems/ProjectileSystem";
import { ScriptScheduler } from "../game/systems/ScriptScheduler";
import { StatusEffectSystem } from "../game/systems";
import {
    TickPhaseOrchestrator,
} from "../game/tick";
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
} from "./broadcast";
import * as ServiceWiring from "./ServiceWiring";
import { MessageRouter, type MessageRouterServices } from "./MessageRouter";
import { buildTeleportNpcUpdateDelta, upsertNpcUpdateDelta } from "./NpcExternalSync";
import { PlayerSyncSession } from "./PlayerSyncSession";
import { AccountSummaryTracker } from "./accountSummary";
import {
    Cs2ModalManager,
    GroundItemHandler,
    PlayerAppearanceManager,
    SoundManager,
} from "./managers";
import {
    SpellResultPayload,
    encodeMessage,
} from "./messages";
import { REPORT_GAME_TIME_GROUP_ID, ReportGameTimeTracker } from "./reportGameTime";

const DEFAULT_AUTOSAVE_SECONDS = 120; // Tuned via docs/autosave-sizing.md (Nov 2025)

export const EQUIP_SLOT_COUNT = 14;
// Special attack visual overrides (RuneLite gameval anchors)
const SPEC_ANIM_DRAGON_DAGGER = 1062; // AnimationID.PUNCTURE
const SPEC_SPOT_DRAGON_DAGGER = 252; // SpotanimID.SP_ATTACK_PUNCTURE_SPOTANIM
const SPEC_ANIM_DRAGON_SCIMITAR = 1872; // AnimationID.SP_ATTACK_DRAGON_SCIMITAR
const SPEC_SPOT_DRAGON_SCIMITAR_TRAIL = 347; // SpotanimID.SP_ATTACK_DRAGON_SCIMITAR_TRAIL_SPOTANIM
const SPEC_ANIM_GODSWORD = 7004; // AnimationID.GODWARS_GODSWORD_ZAMORAK_PLAYER (shared)
const SPEC_SPOT_GODSWORD_ZAMORAK = 1205; // SpotanimID.GODWARS_GODSWORD_ZAMORAK_SPOT
const SPEC_SPOT_GODSWORD_ARMADYL = 1206; // SpotanimID.GODWARS_GODSWORD_ARMADYL_SPOT
const SPEC_SPOT_GODSWORD_SARADOMIN = 1207; // SpotanimID.GODWARS_GODSWORD_SARADOMIN_SPOT
const SPEC_SPOT_GODSWORD_BANDOS = 1208; // SpotanimID.GODWARS_GODSWORD_BANDOS_SPOT

export const COMBAT_SOUND_DELAY_MS = 50; // Small delay to ensure hitsplat renders before sound plays
export const PLAYER_TAKE_DAMAGE_SOUND = 510;
export const PLAYER_ZERO_DAMAGE_SOUND = 511;


// OSRS: Items are private for 60 seconds (100 ticks) before becoming visible to others
const GROUND_ITEM_PRIVATE_TICKS = 100;
// OSRS: Items despawn after 3 minutes total (300 ticks = 180 seconds)
// Note: Some items like untradeable drops may have different timers
const GROUND_ITEM_DESPAWN_TICKS = 300;
const DEBUG_LOG_ITEM_ID = 1511; // Normal logs
const DEBUG_LOG_TILE = Object.freeze({ x: 3167, y: 3472, level: 0 });
const DEBUG_LOG_STACK_QTY = 28;

// Binary player sync uses OSRS-style update masks:
// - bit 0x80 in the first byte indicates a second mask byte follows
// - bit 0x4000 (bit 14) indicates a third mask byte follows

// Test-only deterministic RNG (optional)
const TEST_RNG_SEED_RAW = process.env.TEST_RNG_SEED?.trim() ?? "";
const TEST_RNG_SEED = TEST_RNG_SEED_RAW ? parseFloat(TEST_RNG_SEED_RAW) : undefined;
const TEST_HIT_FORCE_RAW = process.env.TEST_HIT_FORCE?.trim() ?? "";
export const TEST_HIT_FORCE = TEST_HIT_FORCE_RAW ? parseFloat(TEST_HIT_FORCE_RAW) : undefined;
const testRng: JavaRandom | null =
    TEST_RNG_SEED !== undefined && Number.isFinite(TEST_RNG_SEED)
        ? new JavaRandom(TEST_RNG_SEED)
        : null;
export function testRandFloat(): number {
    if (TEST_HIT_FORCE !== undefined && TEST_HIT_FORCE >= 0) return 0; // will be overridden by force damage
    if (testRng?.nextFloat) {
        try {
            return testRng.nextFloat();
        } catch (err) { logger.warn("[testRng] nextFloat failed", err); }
    }
    return Math.random();
}

type StepRecord = {
    x: number;
    y: number;
    level: number;
    rot: number;
    running: boolean;
    traversal?: number;
    seq?: number;
    orientation?: number;
    direction?: number;
};


interface PlayerViewSnapshot {
    id: number;
    x: number;
    y: number;
    level: number;
    rot: number;
    orientation: number;
    running: boolean;
    name?: string;
    appearance?: any;
    interactionIndex?: number;
    seq?: number;
    moved: boolean;
    turned: boolean;
    snap: boolean;
    directions?: number[];
    traversals?: number[];
    anim?: PlayerAnimSet;
    shouldSendPos: boolean;
    worldViewId?: number;
}

type HealthBarUpdatePayload = {
    id: number;
    /** Absolute server loopCycle when this update becomes active (Client.cycle in OSRS). */
    cycle: number;
    /** Start value (0..width in the referenced HealthBarDefinition). */
    health: number;
    /** Target value (0..width in the referenced HealthBarDefinition). */
    health2: number;
    /** Interpolation duration in cycles (0 means immediate). */
    cycleOffset: number;
    /** True when the server requested removal (value=32767 sentinel). */
    removed?: boolean;
};

interface NpcViewSnapshot {
    id: number;
    typeId: number;
    x: number;
    y: number;
    level: number;
    rot: number;
    orientation: number;
    size: number;
    spawnX: number;
    spawnY: number;
    spawnLevel: number;
    name?: string;
    interactingIndex?: number;
    snap?: boolean;
    healthBars?: HealthBarUpdatePayload[];
}

interface NpcUpdatePayload {
    id: number;
    x?: number;
    y?: number;
    level?: number;
    rot?: number;
    orientation?: number;
    moved?: boolean;
    turned?: boolean;
    seq?: number;
    snap?: boolean;
    typeId?: number;
    size?: number;
    spawnX?: number;
    spawnY?: number;
    spawnLevel?: number;
    interactingIndex?: number;
    healthBars?: HealthBarUpdatePayload[];
}

interface WidgetEvent {
    playerId: number;
    action: WidgetAction;
}

type LocChangePayload = {
    oldId: number;
    newId: number;
    tile: { x: number; y: number };
    level: number;
    oldTile: { x: number; y: number };
    newTile: { x: number; y: number };
    oldRotation?: number;
    newRotation?: number;
    newShape?: number;
};

interface TickFrame {
    tick: number;
    time: number;
    npcUpdates: NpcUpdateDelta[];
    npcEffectEvents: NpcStatusEvent[];
    playerSteps: Map<number, StepRecord[]>;
    hitsplats: HitsplatBroadcast[];
    forcedChats: ForcedChatBroadcast[];
    forcedMovements: ForcedMovementBroadcast[];
    pendingSequences: Map<number, { seqId: number; delay: number; startTick: number }>;
    actionEffects: ActionEffect[];
    interactionIndices: Map<number, number>;
    pendingFaceDirs: Map<number, number>;
    playerViews: Map<number, PlayerViewSnapshot>;
    npcViews: Map<number, NpcViewSnapshot>;
    widgetEvents: WidgetEvent[];
    notifications: Array<{ playerId: number; payload: any }>;
    keyedMessages: Map<string, Array<{ playerId: number; payload: any }>>;
    locChanges: LocChangePayload[];
    chatMessages: ChatMessageSnapshot[];
    inventorySnapshots: Array<{
        playerId: number;
        slots?: Array<{ slot: number; itemId: number; quantity: number }>;
    }>;
    gamemodeSnapshots: Map<string, Array<{ playerId: number; payload: unknown }>>;
    appearanceSnapshots: Array<{
        playerId: number;
        payload: {
            x: number;
            y: number;
            level: number;
            rot: number;
            orientation: number;
            running: boolean;
            appearance: PlayerAppearanceState | undefined;
            name?: string;
            anim?: PlayerAnimSet;
            moved: boolean;
            turned: boolean;
            snap: boolean;
            directions?: number[];
            worldViewId?: number;
        };
    }>;
    skillSnapshots: Array<{ playerId: number; update: SkillSyncUpdate }>;
    combatSnapshots: Array<{
        playerId: number;
        weaponCategory: number;
        weaponItemId: number;
        autoRetaliate: boolean;
        activeStyle?: number;
        activePrayers?: string[];
        activeSpellId?: number;
        specialEnergy?: number;
        specialActivated?: boolean;
        quickPrayers?: string[];
        quickPrayersEnabled?: boolean;
    }>;
    runEnergySnapshots: Array<{
        playerId: number;
        percent: number;
        units: number;
        running: boolean;
    }>;
    animSnapshots: Array<{ playerId: number; anim: PlayerAnimSet }>;
    npcPackets: Map<
        number,
        { snapshots: NpcViewSnapshot[]; updates: NpcUpdatePayload[]; despawns: number[] }
    >;
    spotAnimations: PendingSpotAnimation[];
    spellResults: Array<{ playerId: number; payload: SpellResultPayload }>;
    projectilePackets?: Map<number, ProjectileLaunch[]>;
    varps?: Array<{ playerId: number; varpId: number; value: number }>;
    varbits?: Array<{ playerId: number; varbitId: number; value: number }>;
    clientScripts?: Array<{ playerId: number; scriptId: number; args: (number | string)[] }>;
    colorOverrides: Map<
        number,
        { hue: number; sat: number; lum: number; amount: number; durationTicks: number }
    >;
    npcColorOverrides: Map<
        number,
        { hue: number; sat: number; lum: number; amount: number; durationTicks: number }
    >;
}

export function pickSpecialAttackVisualOverride(
    weaponItemId: number,
): { seqId?: number; spotId?: number; spotHeight?: number } | undefined {
    if (!(weaponItemId > 0)) return undefined;
    const def = getItemDefinition(weaponItemId);
    const name = (def?.name ?? "").toString().toLowerCase();

    if (name.includes("dragon dagger")) {
        return { seqId: SPEC_ANIM_DRAGON_DAGGER, spotId: SPEC_SPOT_DRAGON_DAGGER };
    }

    if (name.includes("dragon scimitar")) {
        return {
            seqId: SPEC_ANIM_DRAGON_SCIMITAR,
            spotId: SPEC_SPOT_DRAGON_SCIMITAR_TRAIL,
        };
    }

    if (name.includes("godsword")) {
        if (name.includes("zamorak godsword")) {
            return { seqId: SPEC_ANIM_GODSWORD, spotId: SPEC_SPOT_GODSWORD_ZAMORAK };
        }
        if (name.includes("armadyl godsword")) {
            return { seqId: SPEC_ANIM_GODSWORD, spotId: SPEC_SPOT_GODSWORD_ARMADYL };
        }
        if (name.includes("saradomin godsword")) {
            return { seqId: SPEC_ANIM_GODSWORD, spotId: SPEC_SPOT_GODSWORD_SARADOMIN };
        }
        if (name.includes("bandos godsword")) {
            return { seqId: SPEC_ANIM_GODSWORD, spotId: SPEC_SPOT_GODSWORD_BANDOS };
        }
    }

    return undefined;
}

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
    private locTypeLoader?: any;
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
    private readonly statusEffects = new StatusEffectSystem();
    private readonly prayerSystem = new PrayerSystem();
    private readonly scriptScheduler = new ScriptScheduler();
    private readonly scriptRegistry = new ScriptRegistry();
    private scriptRuntime!: ScriptRuntime;
    private playerPersistence!: PlayerPersistence;
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
    private levelUpDisplayService!: LevelUpDisplayService;
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
    // widgetOpenLedgerByPlayer, levelUpPopupQueue moved to InterfaceManager
    private playerSyncSessions = new Map<WebSocket, PlayerSyncSession>();
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
    private accountSummary!: AccountSummaryTracker;
    private reportGameTime!: ReportGameTimeTracker;
    private scriptAdapterDeps!: ScriptServiceAdapterDeps;
    private cacheFactory: any;

    // Broadcast domain handlers
    private readonly chatBroadcaster = new ChatBroadcaster();
    private readonly actorSyncBroadcaster = new ActorSyncBroadcaster();

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
        this.initGamemode(opts);
        this.initPlayerAnimations();
        this.initTestBots();
        this.broadcastService = new BroadcastService({
            getNetworkLayer: () => this.networkLayer,
            getBroadcastScheduler: () => this.broadcastScheduler,
            getPlayers: () => this.players,
            getActiveFrame: () => this.activeFrame,
            getWssClients: () => this.wss.clients,
            getPendingDirectSends: () => this.pendingDirectSends,
        });
        this.tickFrameService = new TickFrameService(
            {
                getBroadcastScheduler: () => this.broadcastScheduler,
                getPendingNpcUpdates: () => this.pendingNpcUpdates,
                setPendingNpcUpdates: (u) => { this.pendingNpcUpdates = u; },
                getPendingNpcPackets: () => this.pendingNpcPackets,
                setPendingNpcPackets: (p) => { this.pendingNpcPackets = p; },
                getProjectileSystem: () => this.projectileSystem,
                getTickOrchestrator: () => this.tickOrchestrator,
                getNetworkLayer: () => this.networkLayer,
                getPlayerPersistence: () => this.playerPersistence,
                getPlayers: () => this.players,
                getTickMs: () => this.options.tickMs,
                currentTick: () => this.options.ticker.currentTick(),
                upsertNpcUpdateDelta,
            },
            this.autosaveIntervalTicks,
        );
        this.loginHandshakeService = new LoginHandshakeService(this as any);
        this.tickPhaseService = new TickPhaseService(this as any);
        this.wss.on("connection", (ws) => this.loginHandshakeService.onConnection(ws));
        opts.ticker.on("tick", (data) => this.tickFrameService.handleTick(data));
    }

    private initBroadcasters(): void {
        this.playerPersistence = new PlayerPersistence({
            dataDir: getGamemodeDataDir(this.gamemode.id),
        });
        this.accountSummary = new AccountSummaryTracker({
            queueWidgetEvent: (playerId, action) => this.queueWidgetEvent(playerId, action),
            isWidgetGroupOpenInLedger: (playerId, groupId) =>
                this.interfaceManager.isWidgetGroupOpenInLedger(playerId, groupId),
        });
        this.reportGameTime = new ReportGameTimeTracker({
            queueWidgetEvent: (playerId, action) => this.queueWidgetEvent(playerId, action),
            isWidgetGroupOpenInLedger: (playerId, groupId) =>
                this.interfaceManager.isWidgetGroupOpenInLedger(playerId, groupId),
        });
        this.actionScheduler = new ActionScheduler((player, action, tick) =>
            this.actionDispatchService.dispatch(player, action, tick),
        );
        this.actionScheduler.setPriorityProvider((p) => p.getPidPriority());
        this.actionScheduler.setModalChecker((playerId) => this.hasModalOpen(playerId));
    }
    private initWebSocketServer(opts: WSServerOptions): void {
        this.wss = new WebSocketServer({
            host: opts.host,
            port: opts.port,
            perMessageDeflate: {
                zlibDeflateOptions: { level: 6 },
                zlibInflateOptions: { chunkSize: 10 * 1024 },
                threshold: 128, // Only compress messages larger than 128 bytes
                concurrencyLimit: 10,
            },
        });
        this.wss.on("listening", () => {
            logger.info(`WS listening on ws://${opts.host}:${opts.port}`);

            const httpServer = (this.wss as any)._server;
            if (httpServer) {
                httpServer.removeAllListeners("request");
                httpServer.on("request", (req: any, res: any) => {
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
            this.cacheFactory = getCacheLoaderFactory(env.info as any, env.cacheSystem as any);
            this.huffman = tryLoadOsrsHuffman(env.cacheSystem as any);
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
                        env.info as any,
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
            this.sailingInstanceManager = new SailingInstanceManager({
                teleportToInstance: (player, x, y, level, templateChunks, extraLocs) =>
                    this.movementService.teleportToInstance(player, x, y, level, templateChunks, extraLocs),
                spawnNpc: (config) => this.npcManager!.spawnTransientNpc(config)!,
                removeNpc: (npcId) => this.npcManager!.removeNpc(npcId),
                pathService: opts.pathService,
                mapCollision: opts.mapService,
            });
        }
        // Initialize InterfaceService for modular modal interface management
        this.interfaceService = new InterfaceService({
            queueWidgetEvent: (playerId, event) => this.queueWidgetEvent(playerId, event as any),
        });
        // Deferred wiring: these services are created later, wire after init
        // (moved to after service creation block below)

        // Register interface lifecycle hooks
        registerDialogInterfaceHooks(this.interfaceService);
        registerCollectionLogInterfaceHooks(this.interfaceService);

        this.groundItems = new GroundItemManager({
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
                movementService: undefined as any, // Deferred: wired after creation
                collectionLogService: this.collectionLogService,
                soundService: this.soundService,
                actionScheduler: this.actionScheduler,
                getCurrentTick: () => this.options.ticker.currentTick(),
                getPathService: () => this.options.pathService,
                doorManager: this.doorManager,
                npcManager: this.npcManager,
                interfaceService: this.interfaceService,
                widgetDialogHandler: undefined as any, // Deferred: wired after creation
                prayerSystem: this.prayerSystem,
                gatheringSystem: undefined as any, // Deferred: wired after creation
                cs2ModalManager: undefined as any, // Deferred: wired after creation
                followerManager: undefined as any, // Deferred: wired after creation
                followerCombatManager: undefined as any, // Deferred: wired after creation
                sailingInstanceManager: this.sailingInstanceManager,
                worldEntityInfoEncoder: this.worldEntityInfoEncoder,
                playerPersistence: this.playerPersistence,
                musicCatalogService: undefined, // Deferred: wired after creation
                inventoryActionHandler: undefined as any, // Deferred: wired after creation
                effectDispatcher: undefined as any, // Deferred: wired after creation
                combatEffectApplicator: combatEffectApplicator,
                getPlayers: () => this.players,
                enqueueSpotAnimation: (anim) => this.broadcastService.enqueueSpotAnimation(anim),
                enqueueForcedMovement: (data) => this.broadcastService.enqueueForcedMovement(data),
                enqueueSoundBroadcast: (soundId, x, y, level) => this.broadcastService.enqueueSoundBroadcast(soundId, x, y, level),
                queueCombatSnapshot: (...args: any[]) => (this as any).queueCombatSnapshot(...args),
                queueWidgetEvent: (pid, evt) => this.queueWidgetEvent(pid, evt),
                queueSmithingInterfaceMessage: (pid, p) => this.broadcastService.queueSmithingInterfaceMessage(pid, p),
                queueExternalNpcTeleportSync: (npc) => this.queueExternalNpcTeleportSync(npc),
                teleportToWorldEntity: (...args: any[]) => (this.worldEntityService as any).teleportToWorldEntity(...args),
                sendWorldEntity: (...args: any[]) => (this.worldEntityService as any).sendWorldEntity(...args),
                completeLogout: (sock, player, reason) => this.loginHandshakeService.completeLogout(sock, player, reason),
                closeInterruptibleInterfaces: (player) => this.interfaceManager.closeInterruptibleInterfaces(player),
                activeFrame: () => this.activeFrame,
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
            this.tradeManager = new TradeManager({
                getPlayerById: (id) => this.players?.getById(id),
                queueTradeMessage: (playerId, payload) => this.broadcastService.queueTradeMessage(playerId, payload),
                queueInventorySnapshot: (player) => {
                    const sock = this.players?.getSocketByPlayerId(player.id);
                    if (sock) this.inventoryService.sendInventorySnapshot(sock, player);
                },
                sendGameMessage: (player: PlayerState, text: string) => this.messagingService.sendGameMessageToPlayer(player, text),
                openTradeWidget: (player) => player.widgets.open(335, { modal: true }),
                closeTradeWidget: (player) => player.widgets.close(335),
                getInventory: (player) => this.inventoryService.getInventory(player),
                setInventorySlot: (player, slot, itemId, quantity) =>
                    this.inventoryService.setInventorySlot(player, slot, itemId, quantity),
                addItemToInventory: (player, itemId, qty) =>
                    this.inventoryService.addItemToInventory(player, itemId, qty),
                getItemDefinition: (itemId) => getItemDefinition(itemId),
            });
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
            ServiceWiring.createNpcPacketEncoder(this);
            ServiceWiring.createPlayerPacketEncoder(this);
            ServiceWiring.createCombatActionHandler(this);
            ServiceWiring.createSpellActionHandler(this);
            // Initialize InventoryActionHandler
            this.inventoryActionHandler = ServiceWiring.createInventoryActionHandler(this);
            // Initialize EffectDispatcher
            this.effectDispatcher = ServiceWiring.createEffectDispatcher(this);
            // Initialize WidgetDialogHandler
            this.widgetDialogHandler = ServiceWiring.createWidgetDialogHandler(this);
            // Initialize CS2 modal manager
            this.cs2ModalManager = ServiceWiring.createCs2ModalManager(this);
            ServiceWiring.createNpcSyncManager(this);
            // Initialize PlayerAppearanceManager
            this.playerAppearanceManager = ServiceWiring.createPlayerAppearanceManager(this);
            // Initialize SoundManager
            this.soundManager = ServiceWiring.createSoundManager(this);
            // soundManager → soundService wired in deferred block below
            // Initialize GroundItemHandler
            this.groundItemHandler = ServiceWiring.createGroundItemHandler(this);
            ServiceWiring.createPlayerDeathService(this);
            // Initialize ProjectileSystem
            this.projectileSystem = ServiceWiring.createProjectileSystem(this);
            // Initialize GatheringSystemManager
            this.gatheringSystem = ServiceWiring.createGatheringSystem(this);
            // Initialize EquipmentHandler
            this.equipmentHandler = ServiceWiring.createEquipmentHandler(this);
            // Phase 3 deferred deps wired in consolidated block below
            // Initialize TickPhaseOrchestrator
            this.tickOrchestrator = ServiceWiring.createTickOrchestrator(this);
            // Initialize MessageRouter
            this.messageRouter = this.createMessageRouter();
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
        this.variableService = new VariableService({
            getActiveFrame: () => this.activeFrame,
            getSocketByPlayerId: (id) => this.players?.getSocketByPlayerId(id),
            broadcastScheduler: this.broadcastScheduler,
            networkLayer: this.networkLayer,
        });
        this.messagingService = new MessagingService({
            getActiveFrame: () => this.activeFrame,
            broadcastScheduler: this.broadcastScheduler,
            dataLoaders: this.dataLoaderService,
        });
        this.skillService = new SkillService({
            getActiveFrame: () => this.activeFrame,
            broadcastScheduler: this.broadcastScheduler,
            networkLayer: this.networkLayer,
            gamemode: this.gamemode,
            enqueueLevelUpPopup: (player, popup) => this.interfaceManager.enqueueLevelUpPopup(player, popup as any),
        });
        logger.info("[services] Phase 2 services initialized (Variable, Messaging, Skill)");

        // --- Phase 3: Initialize inventory service ---
        this.inventoryService = new InventoryService({
            getActiveFrame: () => this.activeFrame,
            getSocketByPlayerId: (id) => this.players?.getSocketByPlayerId(id),
            broadcastScheduler: this.broadcastScheduler,
            networkLayer: this.networkLayer,
            getEquipArray: (player) => this.equipmentService.ensureEquipArray(player),
        });
        this.appearanceService = new AppearanceService({
            dataLoaders: this.dataLoaderService,
            gamemode: this.gamemode,
            playerAppearanceManager: undefined as any, // Set after playerAppearanceManager is created
            broadcastScheduler: this.broadcastScheduler,
            getActiveFrame: () => this.activeFrame,
            isAdminPlayer: (p) => this.authService.isAdminPlayer(p),
        });
        this.equipmentService = new EquipmentService({
            dataLoaders: this.dataLoaderService,
            equipmentHandler: undefined as any, // Set after equipmentHandler is created
            weaponData: this.appearanceService.getWeaponData(),
            combatCategoryData: undefined, // Set after combatCategoryData is created
            queueVarbit: (pid, vid, val) => this.variableService.queueVarbit(pid, vid, val),
            queueCombatState: (p) => this.queueCombatState(p),
            queueChatMessage: (msg) => this.messagingService.queueChatMessage(msg),
            enqueueSpotAnimation: (anim) => this.broadcastService.enqueueSpotAnimation(anim),
            scriptRuntime: undefined as any, // Set after scriptRuntime is created
            getCurrentTick: () => this.options.ticker.currentTick(),
            getOrCreateAppearance: (p) => this.appearanceService.getOrCreateAppearance(p),
        });
        logger.info("[services] Phase 3 services initialized (Inventory, Equipment, Appearance)");

        // --- Phase 4: Initialize combat data service ---
        this.combatDataService = new CombatDataService({
            dataLoaders: this.dataLoaderService,
            npcManager: this.npcManager,
            npcSoundLookup: undefined, // Set after npcSoundLookup is created
        });
        logger.info("[services] Phase 4 combat data service initialized");

        // --- Phase 5: Initialize location service ---
        this.locationService = new LocationService({
            getActiveFrame: () => this.activeFrame,
            getIsBroadcastPhase: () => this.networkLayer.getIsBroadcastPhase(),
            getSocketByPlayerId: (id) => this.players?.getSocketByPlayerId(id),
            broadcastScheduler: this.broadcastScheduler,
            networkLayer: this.networkLayer,
            doorManager: undefined, // Set after doorManager is created
            dynamicLocState: this.dynamicLocState,
            dataLoaders: this.dataLoaderService,
            broadcast: (msg, ctx) => this.broadcastService.broadcast(msg, ctx),
            playerSyncSessions: this.playerSyncSessions,
            playerDynamicLocSceneKeys: this.playerDynamicLocSceneKeys,
            withDirectSendBypass: (ctx, fn) => this.networkLayer.withDirectSendBypass(ctx, fn),
        });
        this.interfaceManager = new ExtractedInterfaceManager({
            getActiveFrame: () => this.activeFrame,
            getIsBroadcastPhase: () => this.networkLayer.getIsBroadcastPhase(),
            broadcastScheduler: this.broadcastScheduler,
            actionScheduler: this.actionScheduler,
            queueChatMessage: (msg) => this.messagingService.queueChatMessage(msg),
            showLevelUpPopup: (player, popup) => this.levelUpDisplayService.showLevelUpPopup(player, popup as any),
            closeChatboxModalOverlay: (pid) => this.levelUpDisplayService.closeChatboxModalOverlay(pid),
            getPlayerById: (id) => this.players?.getById(id),
            interfaceService: this.interfaceService,
            widgetDialogHandler: this.widgetDialogHandler,
            cs2ModalManager: this.cs2ModalManager,
            accountSummary: this.accountSummary,
            gamemode: this.gamemode,
            reportGameTime: this.reportGameTime,
        });
        logger.info("[services] Phase 5 services initialized (Location, InterfaceManager)");

        // --- Phase 6: Initialize sound and collection log services ---
        this.collectionLogService = new CollectionLogService({
            getSocketByPlayerId: (id) => this.players?.getSocketByPlayerId(id),
            networkLayer: this.networkLayer,
            interfaceService: undefined as any, // Set after interfaceService is created
            queueVarp: (pid, vid, val) => this.variableService.queueVarp(pid, vid, val),
            queueVarbit: (pid, vid, val) => this.variableService.queueVarbit(pid, vid, val),
            queueWidgetEvent: (pid, evt) => this.queueWidgetEvent(pid, evt),
            queueNotification: (pid, p) => this.messagingService.queueNotification(pid, p),
            queueChatMessage: (req) => this.messagingService.queueChatMessage(req),
        });
        this.worldEntityService = new WorldEntityService({
            getSocketByPlayerId: (id) => this.players?.getSocketByPlayerId(id),
            networkLayer: this.networkLayer,
            worldEntityInfoEncoder: this.worldEntityInfoEncoder,
            locationService: this.locationService,
            movementService: undefined as any, // Set after movementService is created
            cacheEnv: this.cacheEnv,
        });
        this.soundService = new SoundService({
            networkLayer: this.networkLayer,
            soundManager: undefined as any, // Set after soundManager is created
            musicCatalogService: undefined, // Set after musicCatalogService is created
            getSocketByPlayerId: (id) => this.players?.getSocketByPlayerId(id),
            getCurrentTick: () => this.options.ticker.currentTick(),
            enqueueSpotAnimation: (anim) => this.broadcastService.enqueueSpotAnimation(anim),
            broadcastSound: (payload, ctx) => this.broadcastService.broadcastSound(payload, ctx),
        });
        this.movementService = new MovementService({
            getActiveFrame: () => this.activeFrame,
            getSocketByPlayerId: (id) => this.players?.getSocketByPlayerId(id),
            networkLayer: this.networkLayer,
            broadcastScheduler: this.broadcastScheduler,
            actionScheduler: this.actionScheduler,
            getCurrentTick: () => this.options.ticker.currentTick(),
            getTickMs: () => this.options.tickMs,
            getInventory: (p) => this.inventoryService.getInventory(p),
            ensureEquipArray: (p) => this.equipmentService.ensureEquipArray(p),
            queueWidgetEvent: (pid, evt) => this.queueWidgetEvent(pid, evt),
            queueVarbit: (pid, vid, val) => this.variableService.queueVarbit(pid, vid, val),
            queueChatMessage: (msg) => this.messagingService.queueChatMessage(msg),
            spawnLocForPlayer: (p, id, tile, lvl, shape, rot) => this.locationService.spawnLocForPlayer(p, id, tile, lvl, shape, rot),
            closeInterruptibleInterfaces: (p) => this.interfaceManager.closeInterruptibleInterfaces(p),
            enqueueSpotAnimation: (event) => this.broadcastService.enqueueSpotAnimation(event),
            playAreaSound: (opts) => this.soundService.playAreaSound(opts),
            sailingInstanceManager: undefined as any,
            worldEntityInfoEncoder: this.worldEntityInfoEncoder,
            interfaceService: undefined as any,
            cacheEnv: this.cacheEnv,
            players: undefined as any,
        });
        new PlayerCombatService({
            dataLoaders: this.dataLoaderService,
            weaponData: this.appearanceService.getWeaponData(),
            ensureEquipArray: (p) => this.equipmentService.ensureEquipArray(p),
        });
        new SpellCastingService({
            getPlayerBySocket: (ws) => this.players?.get(ws),
            getSocketByPlayerId: (id) => this.players?.getSocketByPlayerId(id),
            getInventory: (p) => this.inventoryService.getInventory(p),
            setInventorySlot: (p, slot, itemId, qty) => this.inventoryService.setInventorySlot(p, slot, itemId, qty),
            addItemToInventory: (p, itemId, qty) => this.inventoryService.addItemToInventory(p, itemId, qty),
            sendInventorySnapshot: (ws, p) => this.inventoryService.sendInventorySnapshot(ws, p),
            queueChatMessage: (msg) => this.messagingService.queueChatMessage(msg),
            queueSpellResult: (pid, payload) => this.broadcastService.queueSpellResult(pid, payload),
            awardSkillXp: (p, skillId, xp) => this.skillService.awardSkillXp(p, skillId, xp),
            enqueueSpotAnimation: (event) => this.broadcastService.enqueueSpotAnimation(event),
            getCurrentTick: () => this.options.ticker.currentTick(),
            getActiveFrameTick: () => this.activeFrame?.tick,
        });
        this.varpSyncService = new VarpSyncService({
            withDirectSendBypass: (ctx, fn) => this.withDirectSendBypass(ctx, fn),
            sendWithGuard: (ws, msg, ctx) => this.networkLayer.sendWithGuard(ws, msg, ctx),
            authService: this.authService,
            soundManager: this.soundManager ?? (undefined as any),
            queueVarp: (pid, vid, val) => this.variableService.queueVarp(pid, vid, val),
            musicUnlockService: undefined, // Set after musicUnlockService is created
        });
        // --- Deferred wiring: cross-references between services created above ---
        // Uses typed setDeferredDeps() instead of (service as any).deps mutations.
        this.locationService.setDeferredDeps({ doorManager: this.doorManager });
        this.soundService.setDeferredDeps({ soundManager: this.soundManager });
        this.varpSyncService.setDeferredDeps({ soundManager: this.soundManager });
        this.equipmentService.setDeferredDeps({
            equipmentHandler: this.equipmentHandler,
            scriptRuntime: this.scriptRuntime,
        });
        this.appearanceService.setDeferredDeps({ playerAppearanceManager: this.playerAppearanceManager });
        this.movementService.setDeferredDeps({
            players: this.players,
            interfaceService: this.interfaceService,
            sailingInstanceManager: this.sailingInstanceManager,
        });
        this.collectionLogService.setDeferredDeps({ interfaceService: this.interfaceService });
        this.worldEntityService.setDeferredDeps({ movementService: this.movementService });
        // Wire deferred deps on the ScriptServiceAdapter deps object.
        // The adapter closures lazily read from this object, so mutations here
        // take effect before any script handler runs.
        this.scriptAdapterDeps.movementService = this.movementService;
        this.scriptAdapterDeps.widgetDialogHandler = this.widgetDialogHandler;
        this.scriptAdapterDeps.gatheringSystem = this.gatheringSystem;
        this.scriptAdapterDeps.cs2ModalManager = this.cs2ModalManager;
        this.scriptAdapterDeps.followerManager = this.followerManager;
        this.scriptAdapterDeps.followerCombatManager = this.followerCombatManager;
        this.scriptAdapterDeps.inventoryActionHandler = this.inventoryActionHandler;
        this.scriptAdapterDeps.effectDispatcher = this.effectDispatcher;
        logger.info("[services] All services initialized");
        if (this.cacheEnv) {
            try {
                this.dbRepository = new DbRepository(this.cacheEnv.cacheSystem as any);
                this.combatCategoryData = new CombatCategoryData(this.dbRepository);
                this.equipmentService.setDeferredDeps({ combatCategoryData: this.combatCategoryData });
                this.npcSoundLookup = new NpcSoundLookup(this.dbRepository);
                this.npcSoundLookup.initialize();
                this.combatDataService.setDeferredDeps({ npcSoundLookup: this.npcSoundLookup });
                this.musicCatalogService = new MusicCatalogService(this.dbRepository);
                this.scriptAdapterDeps.musicCatalogService = this.musicCatalogService;
                this.soundService.setDeferredDeps({ musicCatalogService: this.musicCatalogService });
                this.musicUnlockService = new MusicUnlockService(this.musicCatalogService);
                this.varpSyncService.setDeferredDeps({ musicUnlockService: this.musicUnlockService });
            } catch (err) {
                logger.warn("[combat] failed to load combat category data", err);
            }
        }
        if (this.cacheFactory) {
            try {
                this.objTypeLoader = this.cacheFactory.getObjTypeLoader();
            } catch (err) { logger.warn("[cache] obj type loader init failed", err); }
            let enumTypeLoader: any;
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
                        this.messagingService.queueNotification(playerId, notification),
                    queueWidgetEvent: (playerId, event) =>
                        this.queueWidgetEvent(playerId, event),
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
                    queueCombatSnapshot: (...args: any[]) => (this as any).queueCombatSnapshot(...args),
                    queueWidgetEvent: (pid, evt) => this.queueWidgetEvent(pid, evt),
                    queueGamemodeSnapshot: (k, pid, p) => this.queueGamemodeSnapshot(k, pid, p),
                    registerSnapshotEncoder: (k, e, o) => this.registerSnapshotEncoder(k, e, o),
                    gamemodeTickCallbacks: this.gamemodeTickCallbacks,
                    interfaceService: this.interfaceService,
                    sailingInstanceManager: this.sailingInstanceManager,
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

            if (this.gamemode.createUiController) {
                this.gamemode.createUiController({
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

            const setupCasterBot = (p: any, target: any) => {
                if (!p) return;
                p.setItemDefResolver((id: number) => getItemDefinition(id));
                this.appearanceService.refreshAppearanceKits(p);
                applyAutocastState(p, 3273, 1, false); // Wind Strike
                p.botInteraction = { kind: "playerCombat", playerId: target.id };
                // Give runes for Wind Strike (Air + Mind)
                p.addItem(556, 10000, { assureFullInsertion: true }); // Air rune
                p.addItem(558, 10000, { assureFullInsertion: true }); // Mind rune
            };

            const setupPassiveBot = (p: any) => {
                if (!p) return;
                p.setItemDefResolver((id: number) => getItemDefinition(id));
                this.appearanceService.refreshAppearanceKits(p);
                clearAutocastState(p);
                p.botInteraction = undefined;
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

    private withDirectSendBypass<T>(context: string, fn: () => T): T {
        return this.networkLayer.withDirectSendBypass(context, fn);
    }

    getScriptScheduler(): ScriptScheduler {
        return this.scriptScheduler;
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
                specialEnergy = player.getSpecialEnergyPercent();
                specialActivated = player.isSpecialActivated();
                player.markSpecialEnergySynced();
                const quickSet = player.getQuickPrayers();
                if (quickSet.size > 0) {
                    quickPrayers = Array.from(quickSet);
                } else if (quickSet.size === 0) {
                    quickPrayers = [];
                }
                quickPrayersEnabled = player.areQuickPrayersEnabled();
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
            player.combatWeaponCategory,
            player.combatWeaponItemId,
            player.autoRetaliate,
            player.combatStyleSlot,
            Array.from(player.activePrayers ?? []),
            player.combatSpellId > 0 ? player.combatSpellId : undefined,
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
            closeInterruptibleInterfaces: (player) => this.interfaceManager.closeInterruptibleInterfaces(player),
            encodeMessage: encodeMessage,
        };

        const router = new MessageRouter(services);

        // Register message handlers
        ServiceWiring.registerMessageHandlers(this, router);

        return router;
    }
    /**
     * Check if player has a modal dialog open (level-up, etc.)
     * that should pause skill action execution.
     */
    hasModalOpen(playerId: number): boolean {
        return this.interfaceManager.hasModalOpen(playerId);
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
