/**
 * Structural interface for the server object passed to ServiceWiring factory functions.
 *
 * WSServer passes `this` into each factory.  TypeScript's `private` keyword
 * prevents direct field access at the type level, but JavaScript has no such
 * restriction at runtime.  This interface describes the *shape* ServiceWiring
 * actually uses, letting us remove `@ts-nocheck` without touching WSServer's
 * internal visibility modifiers.
 *
 * Properties that may not be initialised yet (cache loaders, optional
 * subsystems) are marked optional (`?:`).
 */

import type { WebSocket } from "ws";

import type { Huffman } from "../../../src/rs/chat/Huffman";
import type { LocTypeLoader } from "../../../src/rs/config/loctype/LocTypeLoader";
import type { NpcTypeLoader } from "../../../src/rs/config/npctype/NpcTypeLoader";
import type { ObjTypeLoader } from "../../../src/rs/config/objtype/ObjTypeLoader";
import type { BasType } from "../../../src/rs/config/bastype/BasType";
import type { IdkType } from "../../../src/rs/config/idktype/IdkType";

import type { NpcSoundLookup } from "../audio/NpcSoundLookup";
import type { MusicCatalogService } from "../audio/MusicCatalogService";
import type { MusicUnlockService } from "../audio/MusicUnlockService";

import type { ActionScheduler } from "../game/actions/ActionScheduler";
import type { EffectDispatcher } from "../game/actions/handlers/EffectDispatcher";
import type { InventoryActionHandler } from "../game/actions/handlers/InventoryActionHandler";
import type { SpellActionHandler } from "../game/actions/handlers/SpellActionHandler";
import type { WidgetDialogHandler } from "../game/actions/handlers/WidgetDialogHandler";
import type { PlayerCombatManager } from "../game/combat";
import type { CombatCategoryData } from "../game/combat/CombatCategoryData";
import type { FollowerCombatManager } from "../game/followers/FollowerCombatManager";
import type { FollowerManager } from "../game/followers/FollowerManager";
import type { GamemodeDefinition, GamemodeUiController } from "../game/gamemodes/GamemodeDefinition";
import type { GroundItemManager } from "../game/items/GroundItemManager";
import type { NpcState } from "../game/npc";
import type { NpcManager } from "../game/npcManager";
import type { PlayerManager, PlayerState } from "../game/player";
import type { PrayerSystem } from "../game/prayer/PrayerSystem";
import type { ScriptRegistry } from "../game/scripts";
import type { ScriptRuntime } from "../game/scripts";
import type { PersistenceProvider } from "../game/state/PersistenceProvider";
import type { PlayerAnimSet, BroadcastScheduler } from "../game/systems";
import type { EquipmentHandler } from "../game/systems";
import type {
    GatheringSystemManager,
    ScriptScheduler,
    StatusEffectSystem,
    ProjectileSystem,
    MovementSystem,
} from "../game/systems";
import type { GameTicker } from "../game/ticker";
import type { TradeManager } from "../game/trade/TradeManager";

import type { DataLoaderService } from "../game/services/DataLoaderService";
import type { VariableService } from "../game/services/VariableService";
import type { MessagingService } from "../game/services/MessagingService";
import type { SkillService } from "../game/services/SkillService";
import type { InventoryService } from "../game/services/InventoryService";
import type { EquipmentService } from "../game/services/EquipmentService";
import type { AppearanceService } from "../game/services/AppearanceService";
import type { CombatDataService } from "../game/services/CombatDataService";
import type { LocationService } from "../game/services/LocationService";
import type { InterfaceManager as ExtractedInterfaceManager } from "../game/services/InterfaceManager";
import type { CollectionLogService } from "../game/services/CollectionLogService";
import type { WorldEntityService } from "../game/services/WorldEntityService";
import type { SoundService } from "../game/services/SoundService";
import type { MovementService } from "../game/services/MovementService";
import type { PlayerCombatService } from "../game/services/PlayerCombatService";
import type { SpellCastingService } from "../game/services/SpellCastingService";
import type { TickPhaseService } from "../game/services/TickPhaseService";
import type { CombatEffectService } from "../game/services/CombatEffectService";
import type { ProjectileTimingService } from "../game/services/ProjectileTimingService";
import type { InventoryMessageService } from "../game/services/InventoryMessageService";

import type { PathService } from "../pathfinding/PathService";
import type { MapCollisionService } from "../world/MapCollisionService";
import type { CacheEnv } from "../world/CacheEnv";
import type { DoorStateManager } from "../world/DoorStateManager";
import type { InterfaceService } from "../widgets/InterfaceService";
import type { WidgetAction } from "../widgets/WidgetManager";

import type { AuthenticationService } from "./AuthenticationService";
import type { BroadcastService } from "./BroadcastService";
import type { LoginHandshakeService } from "./LoginHandshakeService";
import type { PlayerNetworkLayer } from "./PlayerNetworkLayer";
import type { PlayerSyncSession } from "./PlayerSyncSession";
import type { SailingInstanceManager } from "../game/sailing/SailingInstanceManager";
import type { WorldEntityInfoEncoder } from "./encoding/WorldEntityInfoEncoder";
import type {
    Cs2ModalManager,
    GroundItemHandler,
    PlayerAppearanceManager,
    SoundManager,
    NpcSyncManager,
} from "./managers";
import type { TickFrame, NpcViewSnapshot, NpcUpdatePayload, PlayerViewSnapshot } from "./wsServerTypes";
import type { MusicRegionService } from "../audio/MusicRegionService";
import type { DbRepository } from "../../../src/rs/config/db/DbRepository";

// ---------------------------------------------------------------------------
// WSServerContext — the shape ServiceWiring reads from the server parameter
// ---------------------------------------------------------------------------

export interface WSServerContext {
    // ── Core infrastructure ───────────────────────────────────────────────
    readonly options: {
        ticker: GameTicker;
        tickMs: number;
        pathService?: PathService;
        mapService?: MapCollisionService;
    };
    players?: PlayerManager;
    npcManager?: NpcManager;
    readonly gamemode: GamemodeDefinition;
    cacheEnv?: CacheEnv;
    activeFrame?: TickFrame;

    // ── Extracted services ────────────────────────────────────────────────
    readonly dataLoaderService: DataLoaderService;
    readonly networkLayer: PlayerNetworkLayer;
    readonly authService: AuthenticationService;
    readonly variableService: VariableService;
    readonly messagingService: MessagingService;
    readonly skillService: SkillService;
    readonly inventoryService: InventoryService;
    readonly equipmentService: EquipmentService;
    readonly appearanceService: AppearanceService;
    readonly combatDataService: CombatDataService;
    readonly locationService: LocationService;
    readonly interfaceManager: ExtractedInterfaceManager;
    readonly collectionLogService: CollectionLogService;
    readonly worldEntityService: WorldEntityService;
    readonly soundService: SoundService;
    readonly movementService: MovementService;
    readonly combatEffectService: CombatEffectService;
    readonly tickPhaseService: TickPhaseService;
    readonly broadcastService: BroadcastService;
    readonly loginHandshakeService: LoginHandshakeService;

    // ── Systems / managers ────────────────────────────────────────────────
    readonly actionScheduler: ActionScheduler;
    readonly broadcastScheduler: BroadcastScheduler;
    playerCombatManager?: PlayerCombatManager;
    playerCombatService?: PlayerCombatService;
    tradeManager?: TradeManager;
    followerManager?: FollowerManager;
    followerCombatManager?: FollowerCombatManager;
    movementSystem?: MovementSystem;
    readonly groundItems: GroundItemManager;
    readonly gatheringSystem: GatheringSystemManager;
    projectileSystem?: ProjectileSystem;
    readonly equipmentHandler: EquipmentHandler;
    sailingInstanceManager?: SailingInstanceManager;
    readonly scriptRuntime: ScriptRuntime;
    readonly scriptRegistry: ScriptRegistry;
    readonly scriptScheduler: ScriptScheduler;
    readonly statusEffects: StatusEffectSystem;
    readonly prayerSystem: PrayerSystem;
    interfaceService?: InterfaceService;
    readonly worldEntityInfoEncoder: WorldEntityInfoEncoder;

    // ── Network managers ──────────────────────────────────────────────────
    cs2ModalManager?: Cs2ModalManager;
    widgetDialogHandler?: WidgetDialogHandler;
    playerAppearanceManager?: PlayerAppearanceManager;
    soundManager?: SoundManager;
    groundItemHandler?: GroundItemHandler;
    inventoryActionHandler?: InventoryActionHandler;
    effectDispatcher?: EffectDispatcher;
    spellActionHandler?: SpellActionHandler;
    spellCastingService?: SpellCastingService;
    projectileTimingService?: ProjectileTimingService;
    inventoryMessageService?: InventoryMessageService;

    // ── Data loaders / cache artefacts ────────────────────────────────────
    npcTypeLoader?: NpcTypeLoader;
    locTypeLoader?: LocTypeLoader;
    objTypeLoader?: ObjTypeLoader;
    huffman?: Huffman;
    combatCategoryData?: CombatCategoryData;
    npcSoundLookup?: NpcSoundLookup;
    dbRepository?: DbRepository;
    healthBarDefLoader?: { load(defId: number): { width?: number } | undefined };
    basTypeLoader?: { load(id: number): BasType | undefined };
    idkTypeLoader?: { load(id: number): IdkType | undefined };
    musicRegionService?: MusicRegionService;
    musicCatalogService?: MusicCatalogService;
    musicUnlockService?: MusicUnlockService;

    // ── Animation defaults ────────────────────────────────────────────────
    defaultPlayerAnim: PlayerAnimSet;
    defaultPlayerAnimMale?: PlayerAnimSet;
    defaultPlayerAnimFemale?: PlayerAnimSet;

    // ── State collections ─────────────────────────────────────────────────
    doorManager?: DoorStateManager;
    readonly playerPersistence: PersistenceProvider;
    readonly pendingNpcPackets: Map<
        number,
        { snapshots: NpcViewSnapshot[]; updates: NpcUpdatePayload[]; despawns: number[] }
    >;
    readonly playerSyncSessions: Map<WebSocket, PlayerSyncSession>;
    readonly gamemodeTickCallbacks: Array<(tick: number) => void>;
    readonly gamemodeSnapshotEncoders: Map<
        string,
        {
            encode: (playerId: number, payload: unknown) => { message: string | Uint8Array; context: string } | undefined;
            onSent?: (playerId: number, payload: unknown) => void;
        }
    >;
    autosaveIntervalTicks: number;

    // ── Ground item handler state ─────────────────────────────────────────
    playerGroundSerial?: Map<number, number>;
    playerGroundChunk?: Map<number, number>;

    // ── NPC combat data ───────────────────────────────────────────────────
    npcCombatDefs?: Record<string, { deathSound?: number }>;
    npcCombatDefaults?: { deathSound?: number };

    // ── Gamemode UI ───────────────────────────────────────────────────────
    gamemodeUi?: GamemodeUiController;

    // ── Debug ─────────────────────────────────────────────────────────────
    pendingDebugRequests?: Map<number, WebSocket>;
    maintenanceMode?: boolean;

    // ── NPC Sync ──────────────────────────────────────────────────────────
    npcSyncManager?: NpcSyncManager;

    // ── Player death ──────────────────────────────────────────────────────
    playerDeathService?: { startPlayerDeath(player: PlayerState): void };

    // ── Methods on server (private on WSServer, accessed structurally) ────
    queueWidgetEvent(playerId: number, action: WidgetAction): void;
    queueCombatState(player: PlayerState): void;
    queueCombatSnapshot(
        playerId: number,
        weaponCategory: number,
        weaponItemId: number,
        autoRetaliate: boolean,
        activeStyle?: number,
        activePrayers?: string[],
        activeSpellId?: number,
    ): void;
    queueExternalNpcTeleportSync(npc: NpcState): void;
    hasModalOpen(playerId: number): boolean;
    normalizeSideJournalState(player: PlayerState, value?: number): { stateVarp: number; tab: number };
    queueSideJournalGamemodeUi(player: PlayerState): void;
    serializeAppearancePayload(view: PlayerViewSnapshot): Uint8Array;
    createTickFrame(opts: { tick: number; time: number }): TickFrame;
    restorePendingFrame(frame: TickFrame): void;
    yieldToEventLoop(stage: string): Promise<void>;
    maybeRunAutosave(frame: TickFrame): void;
    broadcastTick(frame: TickFrame): void;
}
