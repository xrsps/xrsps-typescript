import JavaRandom from "java-random";
import { performance } from "perf_hooks";
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
import { InterfaceManager as ExtractedInterfaceManager, type LevelUpPopup } from "../game/services/InterfaceManager";
import { CollectionLogService } from "../game/services/CollectionLogService";
import { SoundService } from "../game/services/SoundService";
import { MovementService } from "../game/services/MovementService";
import { PlayerCombatService } from "../game/services/PlayerCombatService";
import { buildScriptServices, type ScriptServiceAdapterDeps } from "../game/services/ScriptServiceAdapter";
import { buildGamemodeServices } from "../game/services/GamemodeServiceAdapter";
import { LoginHandshakeService } from "./LoginHandshakeService";
import { SpellCastingService } from "../game/services/SpellCastingService";
import { TickPhaseService } from "../game/services/TickPhaseService";
import { VarpSyncService } from "../game/services/VarpSyncService";
import { CombatEffectService } from "../game/services/CombatEffectService";
import { ProjectileTimingService } from "../game/services/ProjectileTimingService";
import { LevelUpDisplayService } from "../game/services/LevelUpDisplayService";
import { EquipmentStatsUiService } from "../game/services/EquipmentStatsUiService";
import { InventoryMessageService } from "../game/services/InventoryMessageService";
import { ActionDispatchService } from "../game/services/ActionDispatchService";
import { AuthenticationService } from "./AuthenticationService";
import { PlayerNetworkLayer } from "./PlayerNetworkLayer";

import { ConfigType } from "../../../src/rs/cache/ConfigType";
import { IndexType } from "../../../src/rs/cache/IndexType";
import { getCacheLoaderFactory } from "../../../src/rs/cache/loader/CacheLoaderFactory";
import { Huffman, tryLoadOsrsHuffman } from "../../../src/rs/chat/Huffman";
import type { BasType } from "../../../src/rs/config/bastype/BasType";
import type { BasTypeLoader } from "../../../src/rs/config/bastype/BasTypeLoader";
import { DbRepository } from "../../../src/rs/config/db/DbRepository";
import type { EnumTypeLoader } from "../../../src/rs/config/enumtype/EnumTypeLoader";
import { ArchiveHealthBarDefinitionLoader } from "../../../src/rs/config/healthbar/HealthBarDefinitionLoader";
import type { IdkType } from "../../../src/rs/config/idktype/IdkType";
import type { IdkTypeLoader } from "../../../src/rs/config/idktype/IdkTypeLoader";
import type { NpcTypeLoader } from "../../../src/rs/config/npctype/NpcTypeLoader";
import type { ObjType } from "../../../src/rs/config/objtype/ObjType";
import type { ObjTypeLoader } from "../../../src/rs/config/objtype/ObjTypeLoader";
import {
    EquipmentSlot
} from "../../../src/rs/config/player/Equipment";
import { PlayerAppearance as CachePlayerAppearance } from "../../../src/rs/config/player/PlayerAppearance";
import {
    DEFAULT_WEAPON_CATEGORY,
    resolveWeaponCategoryFromObj,
} from "../../../src/rs/config/player/WeaponCategory";
import type { SeqTypeLoader } from "../../../src/rs/config/seqtype/SeqTypeLoader";
import { PRAYER_DEFINITIONS, type PrayerName } from "../../../src/rs/prayer/prayers";
import { SkillId } from "../../../src/rs/skill/skills";
import {
    MODIFIER_FLAG_CTRL,
    MODIFIER_FLAG_CTRL_SHIFT,
} from "../../../src/shared/input/modifierFlags";
import type { ProjectileLaunch } from "../../../src/shared/projectiles/ProjectileLaunch";
import { ACCOUNT_SUMMARY_GROUP_ID } from "../../../src/shared/ui/accountSummary";
import { MUSIC_GROUP_ID } from "../../../src/shared/ui/music";
import {
    VARP_FOLLOWER_INDEX,
} from "../../../src/shared/vars";
import {
    AttackStyle,
    type WeaponDataEntry,
    getAttackStyle,
    getHitSoundForStyle,
    getMissSound,
    getRangedImpactSound,
    weaponDataEntries,
} from "../../data/weapons";
import { MusicCatalogService } from "../audio/MusicCatalogService";
import { MusicRegionService } from "../audio/MusicRegionService";
import { MusicUnlockService } from "../audio/MusicUnlockService";
import { NpcSoundLookup, type NpcSoundType } from "../audio/NpcSoundLookup";
import { getItemDefinition } from "../data/items";
import { populateLocEffectsFromLoader } from "../data/locEffects";
import {
    ActionEffect,
    ActionExecutionResult,
    ActionScheduler,
    CombatActionHandler,
    type CombatActionServices,
    EffectDispatcher,
    type EffectDispatcherServices,
    InventoryActionHandler,
    type InventoryActionServices,
    ScheduledAction,
    SpellActionHandler,
    type SpellActionServices,
    WidgetDialogHandler,
    type WidgetDialogServices,
} from "../game/actions";
import type {
    CombatAttackActionData,
    CombatAutocastActionData,
    CombatCompanionHitActionData,
    CombatNpcRetaliateActionData,
    CombatPlayerHitActionData,
    EmotePlayActionData,
    InventoryConsumeActionData,
    InventoryConsumeScriptActionData,
    InventoryEquipActionData,
    InventoryMoveActionData,
    InventoryUnequipActionData,
    InventoryUseOnActionData,
    MovementTeleportActionData,
} from "../game/actions/actionPayloads";
import {
    COLLECTION_LOG_GROUP_ID,
    COLLECTION_OVERVIEW_GROUP_ID,
    type CollectionLogServices,
    buildCollectionOverviewOpenState,
    loadCollectionLogItems,
    populateCollectionLogCategories,
    syncCollectionDisplayVarps,
    trackCollectionLogItem,
} from "../game/collectionlog";
import { PlayerCombatManager, createPlayerCombatManager } from "../game/combat";
import { calculateAmmoConsumption } from "../game/combat/AmmoSystem";
import { AttackType, normalizeAttackType } from "../game/combat/AttackType";
import { applyAutocastState, clearAutocastState } from "../game/combat/AutocastState";
import {
    hasDirectMeleePath,
    hasDirectMeleeReach,
    isWithinAttackRange,
} from "../game/combat/CombatAction";
import { CombatCategoryData } from "../game/combat/CombatCategoryData";
import { combatEffectApplicator } from "../game/combat/CombatEffectApplicator";
import {
    resolvePlayerAttackReach,
    resolvePlayerAttackType,
} from "../game/combat/CombatRules";
import { getMeleeAttackSequenceForCategory } from "../game/combat/CombatStyleSequences";
import {
    type AttackType as CombatXpAttackType,
    type StyleMode,
    calculateCombatXp,
} from "../game/combat/CombatXp";
import type { DamageType } from "../game/combat/DamageTracker";
import {
    HITMARK_BLOCK,
    HITMARK_DAMAGE,
    HITMARK_HEAL,
    HITMARK_REGEN,
} from "../game/combat/HitEffects";
import {
    isInWilderness,
    multiCombatSystem,
} from "../game/combat/MultiCombatZones";
import {
    ROCK_KNOCKER_SOUND_ID,
    applyFishstabberFishingBoost,
    applyLumberUpWoodcuttingBoost,
    applyRockKnockerMiningBoost,
    getFishstabberSpecialSequence,
    getLumberUpSpecialSequence,
    getRockKnockerSpecialSequence,
    markInstantUtilitySpecialHandledAtTick,
    wasInstantUtilitySpecialHandledAtTick,
} from "../game/combat/RockKnockerSpecial";
import { getSpecialAttack } from "../game/combat/SpecialAttackRegistry";
import { getSpellBaseXp } from "../game/combat/SpellXpData";
import { getCategoryForWeaponInterface } from "../game/combat/WeaponInterfaces";
import { PlayerDeathService, type PlayerDeathServices } from "../game/death";
import {
    consumeEquippedAmmoApply,
    ensureEquipArrayOn,
    ensureEquipQtyArrayOn,
    equipItemApply,
    getSkillcapeSeqId,
    getSkillcapeSpotId,
    inferEquipSlot,
    pickEquipSound,
    unequipItemApply,
} from "../game/equipment";
import { FollowerCombatManager } from "../game/followers/FollowerCombatManager";
import { FollowerManager } from "../game/followers/FollowerManager";
import { NO_INTERACTION } from "../game/interactionIndex";
import { GroundItemManager } from "../game/items/GroundItemManager";
import {
    type OwnedItemLocation,
    findOwnedItemLocation as findOwnedItemLocationInSnapshot,
} from "../game/items/playerItemOwnership";
import { CustomItemRegistry } from "../../../src/custom/items/CustomItemRegistry";
import type { GamemodeBridge, GamemodeDefinition, GamemodeUiController } from "../game/gamemodes/GamemodeDefinition";
import { getGamemodeDataDir } from "../game/gamemodes/GamemodeRegistry";
import { LockState } from "../game/model/LockState";
import { ACTIVE_COMBAT_TIMER, STUN_TIMER } from "../game/model/timer/Timers";
import { NpcState, type NpcUpdateDelta } from "../game/npc";
import { NpcManager, type NpcStatusEvent, type PendingNpcDrop } from "../game/npcManager";
import {
    type BankEntry,
    DEFAULT_BANK_CAPACITY,
    INVENTORY_SLOT_COUNT,
    type InventoryAddResult,
    type InventoryEntry,
    type PlayerAppearance as PlayerAppearanceState,
    PlayerManager,
    PlayerState,
    SkillSyncUpdate,
} from "../game/player";
import { PrayerSystem } from "../game/prayer/PrayerSystem";
import { ScriptRegistry } from "../game/scripts/ScriptRegistry";
import { ScriptRuntime } from "../game/scripts/ScriptRuntime";
import { bootstrapScripts } from "../game/scripts/bootstrap";
import type {
    ScriptDialogOptionRequest,
    ScriptDialogRequest,
    ScriptInventoryAddResult,
} from "../game/scripts/types";
import type { Vec2 } from "../game/systems/ResourceNodeTracker";
import { PlayerPersistence } from "../game/state/PlayerPersistence";
import { buildPlayerSaveKey } from "../game/state/PlayerSessionKeys";
import {
    BroadcastScheduler,
    type ChatMessageSnapshot,
    type ForcedChatBroadcast,
    type ForcedMovementBroadcast,
    type HitsplatBroadcast,
    type PendingSpotAnimation,
    type PlayerAnimSet,
} from "../game/systems/BroadcastScheduler";
import { EquipmentHandler, type EquipmentHandlerServices } from "../game/systems/EquipmentHandler";
import {
    GatheringSystemManager,
    type GatheringSystemServices,
} from "../game/systems/GatheringSystemManager";
import { MovementSystem } from "../game/systems/MovementSystem";
import { ProjectileSystem, type ProjectileSystemServices } from "../game/systems/ProjectileSystem";
import { ScriptScheduler } from "../game/systems/ScriptScheduler";
import { StatusEffectSystem } from "../game/systems/StatusEffectSystem";
import { CombatEngine, type NpcCombatProfile } from "../game/systems/combat/CombatEngine";
import {
    TickPhaseOrchestrator,
    type TickPhaseOrchestratorServices,
    type TickPhaseProvider,
} from "../game/tick/TickPhaseOrchestrator";
import { GameTicker, TickEvent } from "../game/ticker";
import { TradeManager } from "../game/trade/TradeManager";
import { PathService } from "../pathfinding/PathService";
import { MapCollisionService } from "../world/MapCollisionService";
import { RectAdjacentRouteStrategy } from "../pathfinding/legacy/pathfinder/RouteStrategy";
import { logger } from "../utils/logger";
import { InterfaceService } from "../widgets/InterfaceService";
import type { WidgetAction, WidgetEntry } from "../widgets/WidgetManager";
import {
    type CollectionLogOpenData,
    registerCollectionLogInterfaceHooks,
} from "../widgets/hooks/CollectionLogInterfaceHooks";
import { registerDialogInterfaceHooks } from "../widgets/hooks/DialogInterfaceHooks";
import { type CacheEnv, initCacheEnv } from "../world/CacheEnv";
import { buildRebuildNormalPayload, buildRebuildRegionPayload, buildRebuildWorldEntityPayload } from "../world/InstanceManager";
import { SailingInstanceManager } from "../game/sailing/SailingInstanceManager";
import {
    SAILING_WORLD_ENTITY_INDEX,
    SAILING_WORLD_ENTITY_CONFIG_ID,
    SAILING_WORLD_ENTITY_SIZE_X,
    SAILING_WORLD_ENTITY_SIZE_Z,
} from "../game/sailing/SailingInstance";
import { WorldEntityInfoEncoder } from "./encoding/WorldEntityInfoEncoder";
import { CollisionOverlayStore } from "../world/CollisionOverlayStore";
import { DoorCollisionService } from "../world/DoorCollisionService";
import { DoorDefinitionLoader } from "../world/DoorDefinitionLoader";
import { DoorRuntimeTileMappingStore } from "../world/DoorRuntimeTileMappingStore";
import { DoorStateManager } from "../world/DoorStateManager";
import { DynamicLocStateStore } from "../world/DynamicLocStateStore";
import { LocTileLookupService } from "../world/LocTileLookupService";
import { locCanResolveToId } from "../world/LocTransforms";
import { BitWriter } from "./BitWriter";
import {
    type BroadcastContext,
    SkillBroadcaster,
    VarBroadcaster,
    ChatBroadcaster,
    InventoryBroadcaster,
    WidgetBroadcaster,
    CombatBroadcaster,
    MiscBroadcaster,
    ActorSyncBroadcaster,
} from "./broadcast";
import { type MessageHandlerServices } from "./MessageHandlers";
import { registerAllHandlers, type BinaryHandlerExtServices } from "./handlers";
import * as ServiceWiring from "./ServiceWiring";
import { MessageRouter, type MessageRouterServices, type RoutedMessage } from "./MessageRouter";
import { buildTeleportNpcUpdateDelta, upsertNpcUpdateDelta } from "./NpcExternalSync";
import { NpcSyncSession } from "./NpcSyncSession";
import { PlayerSyncSession } from "./PlayerSyncSession";
import { AccountSummaryTracker } from "./accountSummary";
import { buildAnimSetFromBas, ensureCorePlayerAnimSet } from "./anim/playerAnim";
import {
    NpcPacketEncoder,
    type NpcPacketEncoderServices,
    PlayerPacketEncoder,
    type PlayerPacketEncoderServices,
    type PlayerTickFrameData,
} from "./encoding";
import { encodeAppearanceBinary } from "./encoding/AppearanceEncoder";
import {
    type AppearanceSnapshotEntry,
    Cs2ModalManager,
    type Cs2ModalManagerServices,
    GroundItemHandler,
    type GroundItemHandlerServices,
    type NpcPacketBuffer,
    NpcSyncManager,
    type NpcSyncManagerServices,
    type NpcTickFrame,
    PlayerAppearanceManager,
    type PlayerAppearanceServices,
    SoundManager,
    type SoundManagerServices,
} from "./managers";
import {
    GroundItemActionPayload,
    GroundItemsServerPayload,
    type Appearance as HandshakeAppearance,
    SmithingServerPayload,
    SpellCastLocPayload,
    SpellCastModifiers,
    SpellCastNpcPayload,
    SpellCastObjPayload,
    SpellCastPlayerPayload,
    SpellResultPayload,
    TradeServerPayload,
    WidgetActionRequest,
    encodeMessage,
} from "./messages";
import type { ClientToServer } from "./messages";
import type { AppearanceSetPacket, DecodedPacket } from "./packet";
import { isBinaryData, isNewProtocolPacket, parsePacketsAsMessages, toUint8Array } from "./packet";
import { decodeClientPacket } from "./packet/ClientBinaryDecoder";
import { REPORT_GAME_TIME_GROUP_ID, ReportGameTimeTracker } from "./reportGameTime";

const DEFAULT_AUTOSAVE_SECONDS = 120; // Tuned via docs/autosave-sizing.md (Nov 2025)

export const EQUIP_SLOT_COUNT = 14;
const NPC_STREAM_RADIUS_TILES = 15;
// Use a small hysteresis so NPCs don't rapidly despawn/respawn at the edge
// Enter the stream at 15 tiles, exit once beyond 17 tiles
const NPC_STREAM_EXIT_RADIUS_TILES = NPC_STREAM_RADIUS_TILES + 2;
const SOUND_BROADCAST_RADIUS_TILES = NPC_STREAM_EXIT_RADIUS_TILES;

// Server-side NPC simulation radius (tiles) around each player.
// Only NPCs within this window are "ticked" each game tick to keep tick time bounded.
// Keep this >= stream exit radius to avoid visible NPCs becoming "frozen".
const NPC_SIM_RADIUS_TILES = NPC_STREAM_EXIT_RADIUS_TILES + 12;

// Optional: enable verbose NPC streaming diagnostics by setting DEBUG_NPC_STREAM=1
const DEBUG_NPC_STREAM =
    (process?.env?.DEBUG_NPC_STREAM ?? "").toString().toLowerCase() === "1" ||
    (process?.env?.DEBUG_NPC_STREAM ?? "").toString().toLowerCase() === "true";
// ADMIN_CROWN_ICON and ADMIN_USERNAMES moved to AuthenticationService
import { ADMIN_CROWN_ICON } from "./AuthenticationService";
// DAT2 ObjType param for weapon attack speed (ticks per attack).
// Verified via cache anchors: whip=4, godsword=6, dragon dagger=4.
const WEAPON_SPEED_PARAM = 14;
const DEFAULT_ATTACK_SPEED = 4;
const DEFAULT_ATTACK_SEQ = 422;
const DEFAULT_BLOCK_SEQ = 424;
// RSMod default NPC death animation (human_death)
const DEFAULT_NPC_DEATH_SEQ = 836;
// OSRS synth id for human_death (used as a fixed fallback when not defined per-NPC)
const DEFAULT_NPC_DEATH_SOUND = 512;
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

// OSRS parity: melee hits resolve 1 tick after the swing animation starts.
const MELEE_HIT_DELAY_TICKS = 1;
export const COMBAT_SOUND_DELAY_MS = 50; // Small delay to ensure hitsplat renders before sound plays
const DEFAULT_HIT_SOUND = 1979; // Generic blade hit sound


const RANGED_WEAPON_CATEGORY_IDS = new Set([3, 5, 6, 7, 8, 19]);
const DEFAULT_MISS_SOUND = 2564; // Generic block/miss sound
// Unarmed (no weapon equipped): style-specific hit sounds.
const UNARMED_KICK_SOUND = 2565; // unarmed_kick
const UNARMED_PUNCH_SOUND = 2566; // unarmed_punch
const NPC_ATTACK_SOUND = 2549; // Generic NPC attack sound
export const PLAYER_TAKE_DAMAGE_SOUND = 510;
export const PLAYER_ZERO_DAMAGE_SOUND = 511;
const DEFAULT_MAGIC_SPLASH_SOUND = 227;
const ITEM_DROP_SOUND = 2739;

/**
 * OSRS parity: Message types that close interruptible interfaces (modals, dialogs).
 * Centralized here to avoid scattered closeInterruptibleInterfaces calls.
 */
const INTERFACE_CLOSING_ACTIONS = new Set([
    "walk",
    "teleport",
    "player_attack",
    "npc_attack",
    "npc_interact",
    "loc_interact",
    "ground_item_action",
    "inventory_use_on",
    "spell_cast_npc",
    "spell_cast_player",
    "spell_cast_loc",
    "interact", // follow/trade
]);

const PRAYER_DEACTIVATE_SOUND = 2663;

// Build prayer sound lookup from definitions
const PRAYER_ACTIVATE_SOUNDS: Map<PrayerName, number> = new Map(
    PRAYER_DEFINITIONS.filter((p) => p.soundId != null).map((p) => [p.id, p.soundId!]),
);

// OSRS: Items are private for 60 seconds (100 ticks) before becoming visible to others
const GROUND_ITEM_PRIVATE_TICKS = 100;
// OSRS: Items despawn after 3 minutes total (300 ticks = 180 seconds)
// Note: Some items like untradeable drops may have different timers
const GROUND_ITEM_DESPAWN_TICKS = 300;
const DEBUG_LOG_ITEM_ID = 1511; // Normal logs
const DEBUG_LOG_TILE = Object.freeze({ x: 3167, y: 3472, level: 0 });
const DEBUG_LOG_STACK_QTY = 28;

const TILE_UNIT = 128;

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

const TELEPORT_ACTION_GROUP = "movement.teleport";

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

type PendingWalkCommand = {
    to: { x: number; y: number };
    run: boolean;
    enqueuedTick: number;
};

type TeleportActionRequest = {
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

interface PlayerWidgetOpenLedger {
    byTargetUid: Map<number, number>;
    targetUidsByGroup: Map<number, Set<number>>;
    directGroups: Set<number>;
}

type SpellTargetKind = "npc" | "player" | "loc" | "obj";

type SpellCastTargetRequest =
    | { type: "npc"; npcId: number }
    | { type: "player"; playerId: number }
    | { type: "loc"; locId: number; tile: { x: number; y: number; plane?: number } }
    | { type: "obj"; objId: number; tile: { x: number; y: number; plane?: number } };

interface SpellCastRequest {
    spellId: number;
    modifiers?: SpellCastModifiers;
    target: SpellCastTargetRequest;
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

const PLAYER_ANIM_KEYS: Array<keyof PlayerAnimSet> = [
    "idle",
    "walk",
    "walkBack",
    "walkLeft",
    "walkRight",
    "run",
    "runBack",
    "runLeft",
    "runRight",
    "turnLeft",
    "turnRight",
];

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
    private wss: WebSocketServer;
    private options: WSServerOptions;
    private players?: PlayerManager;
    private npcManager?: NpcManager;
    private objTypeLoader?: ObjTypeLoader;
    private idkTypeLoader?: IdkTypeLoader;
    private basTypeLoader?: BasTypeLoader;
    private locTypeLoader?: any;
    private enumTypeLoader?: EnumTypeLoader;
    private structTypeLoader?: any;
    private readonly gamemode: GamemodeDefinition;
    private gamemodeUi: GamemodeUiController | undefined;
    private cacheEnv?: CacheEnv;
    private huffman?: Huffman;
    private healthBarDefLoader?: ArchiveHealthBarDefinitionLoader;
    private specialAttackCostUnitsByWeapon?: Map<number, number>;
    private specialAttackDescriptionByWeapon?: Map<number, string>;
    private specialAttackDefaultDescription?: string;
    private actionScheduler: ActionScheduler;
    private defaultPlayerAnim: PlayerAnimSet = {
        idle: 808,
        walk: 819,
        run: 824,
        turnLeft: 823,
        turnRight: 823,
    };
    private defaultPlayerAnimMale?: PlayerAnimSet;
    private defaultPlayerAnimFemale?: PlayerAnimSet;
    private weaponAnimOverrides = new Map<number, Record<string, number>>();
    private weaponData = new Map<number, WeaponDataEntry>();
    // weaponWarningsLogged moved to PlayerCombatService
    private doorManager?: DoorStateManager;
    private readonly statusEffects = new StatusEffectSystem();
    private readonly prayerSystem = new PrayerSystem();
    private readonly scriptScheduler = new ScriptScheduler();
    private readonly scriptRegistry = new ScriptRegistry();
    private readonly scriptRuntime: ScriptRuntime;
    private readonly playerPersistence: PlayerPersistence;
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
    private readonly gameContext!: GameContext;
    private readonly dataLoaderService!: DataLoaderService;
    private readonly authService!: AuthenticationService;
    private readonly networkLayer!: PlayerNetworkLayer;

    // Extracted services (Phase 2)
    private readonly variableService!: VariableService;
    private readonly messagingService!: MessagingService;
    private readonly skillService!: SkillService;

    // Extracted services (Phase 3)
    private readonly inventoryService!: InventoryService;
    private readonly equipmentService!: EquipmentService;
    private readonly appearanceService!: AppearanceService;

    // Extracted services (Phase 4)
    private readonly combatDataService!: CombatDataService;

    // Extracted services (Phase 5)
    private readonly locationService!: LocationService;
    private readonly interfaceManager!: ExtractedInterfaceManager;

    // Extracted services (Phase 6)
    private readonly collectionLogService!: CollectionLogService;
    private readonly soundService!: SoundService;
    private readonly movementService!: MovementService;
    private readonly playerCombatService!: PlayerCombatService;

    // Extracted services (Phase 7)
    private readonly varpSyncService!: VarpSyncService;
    private readonly spellCastingService!: SpellCastingService;
    private loginHandshakeService!: LoginHandshakeService;
    private tickPhaseService!: TickPhaseService;

    // Extracted services (Phase 8)
    private readonly combatEffectService!: CombatEffectService;
    private readonly projectileTimingService!: ProjectileTimingService;
    private readonly levelUpDisplayService!: LevelUpDisplayService;
    private readonly equipmentStatsUiService!: EquipmentStatsUiService;
    private readonly inventoryMessageService!: InventoryMessageService;
    private readonly actionDispatchService!: ActionDispatchService;

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
    private pendingDebugRequests: Map<number, WebSocket> = new Map();
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
    private npcSyncSessions = new Map<WebSocket, NpcSyncSession>();
    private enableBinaryNpcSync = true;
    private activeFrame?: TickFrame;
    private seqTypeLoader?: SeqTypeLoader;
    private npcTypeLoader?: NpcTypeLoader;
    private npcCombatDefs?: Record<
        string,
        {
            attack?: number;
            block?: number;
            death?: number;
            deathSound?: number;
        }
    >;
    private npcCombatDefaults?: {
        attack: number;
        block: number;
        death: number;
        deathSound: number;
    };
    private npcCombatStats?: Record<string, any>;
    private combatCategoryData?: CombatCategoryData;
    private dbRepository?: DbRepository;
    private npcSoundLookup?: NpcSoundLookup;
    private musicCatalogService?: MusicCatalogService;
    private musicRegionService?: MusicRegionService;
    private musicUnlockService?: MusicUnlockService;
    private readonly autosaveIntervalTicks: number;
    private nextAutosaveTick: number;
    private autosaveRunning = false;
    private groundItems: GroundItemManager;
    private playerGroundSerial = new Map<number, number>();
    private playerGroundChunk = new Map<number, number>();
    private readonly playerDynamicLocSceneKeys = new Map<number, string>();
    private readonly dynamicLocState = new DynamicLocStateStore();
    private npcPacketEncoder!: NpcPacketEncoder;
    private playerPacketEncoder!: PlayerPacketEncoder;
    private combatActionHandler!: CombatActionHandler;
    private spellActionHandler!: SpellActionHandler;
    private inventoryActionHandler!: InventoryActionHandler;
    private effectDispatcher!: EffectDispatcher;
    private widgetDialogHandler!: WidgetDialogHandler;
    private cs2ModalManager!: Cs2ModalManager;
    private npcSyncManager!: NpcSyncManager;
    private playerAppearanceManager!: PlayerAppearanceManager;
    private soundManager!: SoundManager;
    private groundItemHandler!: GroundItemHandler;
    private playerDeathService!: PlayerDeathService;
    private readonly accountSummary: AccountSummaryTracker;
    private readonly reportGameTime: ReportGameTimeTracker;

    // Broadcast domain handlers
    private readonly skillBroadcaster = new SkillBroadcaster();
    private readonly varBroadcaster = new VarBroadcaster();
    private readonly chatBroadcaster = new ChatBroadcaster();
    private readonly inventoryBroadcaster: InventoryBroadcaster;
    private readonly widgetBroadcaster: WidgetBroadcaster;
    private readonly combatBroadcaster: CombatBroadcaster;
    private readonly miscBroadcaster: MiscBroadcaster;
    private readonly actorSyncBroadcaster = new ActorSyncBroadcaster();

    // Login rate limiting moved to AuthenticationService

    // Server maintenance mode flag
    private maintenanceMode = false;

    constructor(opts: WSServerOptions) {
        this.options = opts;
        this.gamemode = opts.gamemode;
        this.playerPersistence = new PlayerPersistence({
            dataDir: getGamemodeDataDir(this.gamemode.id),
        });
        this.accountSummary = new AccountSummaryTracker({
            queueWidgetEvent: (playerId, action) => this.queueWidgetEvent(playerId, action),
            isWidgetGroupOpenInLedger: (playerId, groupId) =>
                this.isWidgetGroupOpenInLedger(playerId, groupId),
        });
        this.reportGameTime = new ReportGameTimeTracker({
            queueWidgetEvent: (playerId, action) => this.queueWidgetEvent(playerId, action),
            isWidgetGroupOpenInLedger: (playerId, groupId) =>
                this.isWidgetGroupOpenInLedger(playerId, groupId),
        });
        this.inventoryBroadcaster = new InventoryBroadcaster({
            getPlayerById: (id) => this.players?.getById(id),
            getInventory: (player) => this.getInventory(player),
        });
        this.widgetBroadcaster = new WidgetBroadcaster({
            syncPostWidgetOpenState: (playerId, action) =>
                this.syncPostWidgetOpenState(playerId, action),
        });
        this.combatBroadcaster = new CombatBroadcaster({
            enableBinaryNpcSync: this.enableBinaryNpcSync,
            forEachPlayer: (fn) => this.players?.forEach(fn),
            withDirectSendBypass: (ctx, fn) => this.withDirectSendBypass(ctx, fn),
        });
        this.miscBroadcaster = new MiscBroadcaster({
            gamemodeSnapshotEncoders: this.gamemodeSnapshotEncoders,
            forEachPlayer: (fn) => this.players?.forEach(fn),
        });
        this.actionScheduler = new ActionScheduler((player, action, tick) =>
            this.actionDispatchService.dispatch(player, action, tick),
        );
        this.actionScheduler.setPriorityProvider((p) => p.getPidPriority());
        // OSRS parity: Pause skill actions while modal (level-up dialog) is open
        this.actionScheduler.setModalChecker((playerId) => this.hasModalOpen(playerId));
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
        this.nextAutosaveTick =
            this.autosaveIntervalTicks > 0 ? this.autosaveIntervalTicks : Number.MAX_SAFE_INTEGER;
        if (this.autosaveIntervalTicks > 0) {
            const seconds = ((this.autosaveIntervalTicks * this.options.tickMs) / 1000).toFixed(1);
            logger.info(
                `[autosave] enabled interval=${this.autosaveIntervalTicks} ticks (~${seconds}s)`,
            );
        } else {
            logger.info("[autosave] disabled (interval <= 0)");
        }
        // --- Phase 1: Initialize extracted services ---
        const env = opts.cacheEnv ?? initCacheEnv("caches");
        this.cacheEnv = env;

        this.dataLoaderService = new DataLoaderService(env);
        this.networkLayer = new PlayerNetworkLayer();
        // AuthService created below after we know players is set up
        // GameContext created below after all Phase 1 services are ready

        let cacheFactory: any = undefined;
        try {
            cacheFactory = getCacheLoaderFactory(env.info as any, env.cacheSystem as any);
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
                    this.healthBarDefLoader = new ArchiveHealthBarDefinitionLoader(
                        env.info as any,
                        archive,
                    );
                }
            } catch (err) { logger.warn("[cache] healthbar loader init failed", err); }
        } catch (e) {
            logger.warn("Failed to initialize cache environment", e);
        }

        let locTypeLoader: any = undefined;
        let npcTypeLoader: any = undefined;
        if (cacheFactory) {
            try {
                locTypeLoader = cacheFactory.getLocTypeLoader();
                try {
                    const count = populateLocEffectsFromLoader(locTypeLoader);
                    logger.info(`[locEffects] auto-registered ${count} loc sound effect(s)`);
                } catch (err) {
                    logger.warn("[locEffects] failed to auto-register from loc loader", err);
                }
            } catch (err) { logger.warn("[cache] loc type loader init failed", err); }
            try {
                npcTypeLoader = cacheFactory.getNpcTypeLoader?.();
                this.npcTypeLoader = npcTypeLoader;
            } catch (err) { logger.warn("[cache] npc type loader init failed", err); }
            try {
                this.seqTypeLoader = cacheFactory.getSeqTypeLoader?.();
            } catch (err) { logger.warn("[cache] seq type loader init failed", err); }
        }
        let collisionOverlays: CollisionOverlayStore | undefined;
        if (locTypeLoader) {
            this.locTypeLoader = locTypeLoader;

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
        this.npcManager = opts.npcManager;
        if (this.npcManager) {
            this.sailingInstanceManager = new SailingInstanceManager({
                teleportToInstance: (player, x, y, level, templateChunks, extraLocs) =>
                    this.teleportToInstance(player, x, y, level, templateChunks, extraLocs),
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
        this.spawnDebugGroundItemStack();
        const scriptAdapterDeps: ScriptServiceAdapterDeps = {
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
                enqueueSpotAnimation: (anim) => this.enqueueSpotAnimation(anim),
                enqueueForcedMovement: (data) => this.enqueueForcedMovement(data),
                enqueueSoundBroadcast: (soundId, x, y, level) => this.enqueueSoundBroadcast(soundId, x, y, level),
                queueCombatSnapshot: (...args: any[]) => (this as any).queueCombatSnapshot(...args),
                queueWidgetEvent: (pid, evt) => this.queueWidgetEvent(pid, evt),
                queueSmithingInterfaceMessage: (pid, p) => this.queueSmithingInterfaceMessage(pid, p),
                queueExternalNpcTeleportSync: (npc) => this.queueExternalNpcTeleportSync(npc),
                teleportToWorldEntity: (...args: any[]) => (this as any).teleportToWorldEntity(...args),
                sendWorldEntity: (...args: any[]) => (this as any).sendWorldEntity(...args),
                completeLogout: (sock, player, reason) => this.completeLogout(sock, player, reason),
                closeInterruptibleInterfaces: (player) => this.closeInterruptibleInterfaces(player),
                activeFrame: () => this.activeFrame,
        };
        this.scriptRuntime = new ScriptRuntime({
            registry: this.scriptRegistry,
            scheduler: this.scriptScheduler,
            logger,
            services: buildScriptServices(scriptAdapterDeps),
        });
        logger.info(
            "[scripts] loaded",
            JSON.stringify({ modules: [] }),
        );
        bootstrapScripts(this.scriptRuntime, this.gamemode);
        if (opts.pathService) {
            this.players = new PlayerManager(
                opts.pathService,
                locTypeLoader,
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
                            this.getNpcCombatSequences(companion.typeId).attack;
                        if (attackSeq !== undefined && attackSeq >= 0) {
                            this.combatEffectService.broadcastNpcSequence(companion, attackSeq);
                        }
                        if (combat.attackSoundId !== undefined && combat.attackSoundId > 0) {
                            this.queueBroadcastSound(
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
                this.emitLocChange(oldId, newId, tile, level, opts);
            });
            this.tradeManager = new TradeManager({
                getPlayerById: (id) => this.players?.getById(id),
                queueTradeMessage: (playerId, payload) => this.queueTradeMessage(playerId, payload),
                queueInventorySnapshot: (player) => {
                    const sock = this.players?.getSocketByPlayerId(player.id);
                    if (sock) this.sendInventorySnapshot(sock, player);
                },
                sendGameMessage: (player: PlayerState, text: string) => this.sendGameMessageToPlayer(player, text),
                openTradeWidget: (player) => player.widgets.open(335, { modal: true }),
                closeTradeWidget: (player) => player.widgets.close(335),
                getInventory: (player) => this.getInventory(player),
                setInventorySlot: (player, slot, itemId, quantity) =>
                    this.setInventorySlot(player, slot, itemId, quantity),
                addItemToInventory: (player, itemId, qty) =>
                    this.addItemToInventory(player, itemId, qty),
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
                this.sendGameMessageToPlayer(player, text);
            });
            // OSRS parity: Wire up skill action interruption callback
            this.players.setInterruptSkillActionsCallback((playerId) => {
                this.interruptPlayerSkillActions(playerId);
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
            // Initialize NpcPacketEncoder
            this.npcPacketEncoder = ServiceWiring.createNpcPacketEncoder(this);
            // Initialize PlayerPacketEncoder
            this.playerPacketEncoder = ServiceWiring.createPlayerPacketEncoder(this);
            // Initialize CombatActionHandler
            this.combatActionHandler = ServiceWiring.createCombatActionHandler(this);
            // Initialize SpellActionHandler
            this.spellActionHandler = ServiceWiring.createSpellActionHandler(this);
            // Initialize InventoryActionHandler
            this.inventoryActionHandler = ServiceWiring.createInventoryActionHandler(this);
            // Initialize EffectDispatcher
            this.effectDispatcher = ServiceWiring.createEffectDispatcher(this);
            // Initialize WidgetDialogHandler
            this.widgetDialogHandler = ServiceWiring.createWidgetDialogHandler(this);
            // Initialize CS2 modal manager
            this.cs2ModalManager = ServiceWiring.createCs2ModalManager(this);
            // Initialize NpcSyncManager
            this.npcSyncManager = ServiceWiring.createNpcSyncManager(this);
            // Initialize PlayerAppearanceManager
            this.playerAppearanceManager = ServiceWiring.createPlayerAppearanceManager(this);
            // Initialize SoundManager
            this.soundManager = ServiceWiring.createSoundManager(this);
            // soundManager → soundService wired in deferred block below
            // Initialize GroundItemHandler
            this.groundItemHandler = ServiceWiring.createGroundItemHandler(this);
            // Initialize PlayerDeathService
            this.playerDeathService = ServiceWiring.createPlayerDeathService(this);
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
                this.applyAppearanceSnapshotsToViews(frame as TickFrame),
            );
            this.actorSyncBroadcaster.setSyncCallback((sock, player, frame, ctx) =>
                this.buildAndSendActorSync(sock, player, frame as TickFrame, ctx),
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
        // --- Phase 1: Finish service wiring ---
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
            enqueueLevelUpPopup: (player, popup) => this.enqueueLevelUpPopup(player, popup as any),
        });
        logger.info("[services] Phase 2 services initialized (Variable, Messaging, Skill)");

        // --- Phase 3: Initialize inventory service ---
        this.inventoryService = new InventoryService({
            getActiveFrame: () => this.activeFrame,
            getSocketByPlayerId: (id) => this.players?.getSocketByPlayerId(id),
            broadcastScheduler: this.broadcastScheduler,
            networkLayer: this.networkLayer,
            getEquipArray: (player) => this.ensureEquipArray(player),
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
            enqueueSpotAnimation: (anim) => this.enqueueSpotAnimation(anim),
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
            broadcast: (msg, ctx) => this.broadcast(msg, ctx),
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
            queueNotification: (pid, p) => this.queueNotification(pid, p),
            queueChatMessage: (req) => this.messagingService.queueChatMessage(req),
        });
        this.soundService = new SoundService({
            networkLayer: this.networkLayer,
            soundManager: undefined as any, // Set after soundManager is created
            musicCatalogService: undefined, // Set after musicCatalogService is created
            getSocketByPlayerId: (id) => this.players?.getSocketByPlayerId(id),
            getCurrentTick: () => this.options.ticker.currentTick(),
            enqueueSpotAnimation: (anim) => this.enqueueSpotAnimation(anim),
            broadcastSound: (payload, ctx) => this.broadcastSound(payload, ctx),
        });
        this.movementService = new MovementService({
            getActiveFrame: () => this.activeFrame,
            getSocketByPlayerId: (id) => this.players?.getSocketByPlayerId(id),
            networkLayer: this.networkLayer,
            broadcastScheduler: this.broadcastScheduler,
            actionScheduler: this.actionScheduler,
            getCurrentTick: () => this.options.ticker.currentTick(),
            getTickMs: () => this.options.tickMs,
            getInventory: (p) => this.getInventory(p),
            ensureEquipArray: (p) => this.ensureEquipArray(p),
            queueWidgetEvent: (pid, evt) => this.queueWidgetEvent(pid, evt),
            queueVarbit: (pid, vid, val) => this.variableService.queueVarbit(pid, vid, val),
            queueChatMessage: (msg) => this.messagingService.queueChatMessage(msg),
            spawnLocForPlayer: (p, id, tile, lvl, shape, rot) => this.spawnLocForPlayer(p, id, tile, lvl, shape, rot),
            closeInterruptibleInterfaces: (p) => this.closeInterruptibleInterfaces(p),
            sailingInstanceManager: undefined as any,
            worldEntityInfoEncoder: this.worldEntityInfoEncoder,
            interfaceService: undefined as any,
            cacheEnv: this.cacheEnv,
            players: undefined as any,
        });
        this.playerCombatService = new PlayerCombatService({
            dataLoaders: this.dataLoaderService,
            weaponData: this.appearanceService.getWeaponData(),
            ensureEquipArray: (p) => this.ensureEquipArray(p),
        });
        this.spellCastingService = new SpellCastingService({
            getPlayerBySocket: (ws) => this.players?.get(ws),
            getSocketByPlayerId: (id) => this.players?.getSocketByPlayerId(id),
            getInventory: (p) => this.getInventory(p),
            setInventorySlot: (p, slot, itemId, qty) => this.setInventorySlot(p, slot, itemId, qty),
            addItemToInventory: (p, itemId, qty) => this.addItemToInventory(p, itemId, qty),
            sendInventorySnapshot: (ws, p) => this.sendInventorySnapshot(ws, p),
            queueChatMessage: (msg) => this.messagingService.queueChatMessage(msg),
            queueSpellResult: (pid, payload) => this.queueSpellResult(pid, payload),
            awardSkillXp: (p, skillId, xp) => this.awardSkillXp(p, skillId, xp),
            enqueueSpotAnimation: (event) => this.enqueueSpotAnimation(event),
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
        // Wire deferred deps on the ScriptServiceAdapter deps object.
        // The adapter closures lazily read from this object, so mutations here
        // take effect before any script handler runs.
        scriptAdapterDeps.movementService = this.movementService;
        scriptAdapterDeps.widgetDialogHandler = this.widgetDialogHandler;
        scriptAdapterDeps.gatheringSystem = this.gatheringSystem;
        scriptAdapterDeps.cs2ModalManager = this.cs2ModalManager;
        scriptAdapterDeps.followerManager = this.followerManager;
        scriptAdapterDeps.followerCombatManager = this.followerCombatManager;
        scriptAdapterDeps.inventoryActionHandler = this.inventoryActionHandler;
        scriptAdapterDeps.effectDispatcher = this.effectDispatcher;
        logger.info("[services] All services initialized");

        this.loadWeaponData();
        if (this.cacheEnv) {
            try {
                this.dbRepository = new DbRepository(this.cacheEnv.cacheSystem as any);
                this.combatCategoryData = new CombatCategoryData(this.dbRepository);
                this.equipmentService.setDeferredDeps({ combatCategoryData: this.combatCategoryData });
                this.npcSoundLookup = new NpcSoundLookup(this.dbRepository);
                this.npcSoundLookup.initialize();
                this.combatDataService.setDeferredDeps({ npcSoundLookup: this.npcSoundLookup });
                this.musicCatalogService = new MusicCatalogService(this.dbRepository);
                scriptAdapterDeps.musicCatalogService = this.musicCatalogService;
                this.soundService.setDeferredDeps({ musicCatalogService: this.musicCatalogService });
                this.musicRegionService = new MusicRegionService();
                this.musicUnlockService = new MusicUnlockService(this.musicCatalogService);
                this.varpSyncService.setDeferredDeps({ musicUnlockService: this.musicUnlockService });
            } catch (err) {
                logger.warn("[combat] failed to load combat category data", err);
            }
        }
        if (cacheFactory) {
            try {
                this.objTypeLoader = cacheFactory.getObjTypeLoader();
            } catch (err) { logger.warn("[cache] obj type loader init failed", err); }
            try {
                this.idkTypeLoader = cacheFactory.getIdkTypeLoader();
            } catch (err) { logger.warn("[cache] idk type loader init failed", err); }
            // Store cache loaders for systems that still use enum/struct lookups
            let enumTypeLoader: any;
            let structTypeLoader: any;
            try {
                enumTypeLoader = cacheFactory.getEnumTypeLoader?.();
            } catch (err) { logger.warn("[cache] enum type loader init failed", err); }
            try {
                structTypeLoader = cacheFactory.getStructTypeLoader?.();
            } catch (err) { logger.warn("[cache] struct type loader init failed", err); }
            this.enumTypeLoader = enumTypeLoader;
            this.structTypeLoader = structTypeLoader;

            // Collection log tracking/category mapping is server-authoritative from JSON.
            loadCollectionLogItems();
            if (enumTypeLoader) {
                this.loadSpecialAttackCacheData(enumTypeLoader);
            }

            // Initialize the active gamemode
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
                        this.queueNotification(playerId, notification),
                    queueWidgetEvent: (playerId, event) =>
                        this.queueWidgetEvent(playerId, event),
                    queueClientScript: (playerId, scriptId, ...args) =>
                        this.queueClientScript(playerId, scriptId, ...args),
                    sendGameMessage: (player, text) =>
                        this.sendGameMessageToPlayer(player, text),
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
                    refreshCombatWeaponCategory: (p) => this.refreshCombatWeaponCategory(p),
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

            // Let gamemode contribute additional ScriptServices methods (banking, etc.)
            if (this.gamemode.contributeScriptServices) {
                this.gamemode.contributeScriptServices(this.scriptRuntime.getServices());
            }

            // Wire fallback dispatcher so gamemode-registered message handlers
            // (via registerClientMessageHandler) are checked for unhandled message types.
            this.messageRouter.setFallbackDispatcher((type, ws, player, payload) => {
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
                this.gamemodeUi = this.gamemode.createUiController({
                    queueWidgetEvent: (playerId, action) =>
                        this.queueWidgetEvent(playerId, action),
                    queueVarp: (playerId, varpId, value) =>
                        this.variableService.queueVarp(playerId, varpId, value),
                    queueVarbit: (playerId, varbitId, value) =>
                        this.variableService.queueVarbit(playerId, varbitId, value),
                    isWidgetGroupOpenInLedger: (playerId, groupId) =>
                        this.isWidgetGroupOpenInLedger(playerId, groupId),
                });
                logger.info(`Boot: gamemode UI controller created`);
            }

        }

        // Derive default player sequences from BAS (player base animations), not an NPC
        try {
            const basTypeLoader = cacheFactory?.getBasTypeLoader();
            this.basTypeLoader = basTypeLoader;
            if (basTypeLoader) {
                this.defaultPlayerAnimMale =
                    this.loadAnimSetFromBas(() => basTypeLoader.load(0)) ||
                    this.defaultPlayerAnimMale;
                this.defaultPlayerAnimFemale =
                    this.loadAnimSetFromBas(() => basTypeLoader.load(1)) ||
                    this.defaultPlayerAnimFemale;

                const bcount = basTypeLoader.getCount?.() ?? 0;
                let best: PlayerAnimSet | undefined;
                for (let id = 0; id < bcount; id++) {
                    const anim = this.loadAnimSetFromBas(() => basTypeLoader.load(id));
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

        // Spawn a single headless/fake player at server startup
        try {
            const bot1 = this.players?.addBot(3168, 3475, 0);
            const bot2 = this.players?.addBot(3173, 3475, 0);

            const setupCasterBot = (p: any, target: any) => {
                if (!p) return;
                p.setItemDefResolver((id: number) => getItemDefinition(id));
                this.refreshAppearanceKits(p);
                applyAutocastState(p, 3273, 1, false); // Wind Strike
                p.botInteraction = { kind: "playerCombat", playerId: target.id };
                // Give runes for Wind Strike (Air + Mind)
                p.addItem(556, 10000, { assureFullInsertion: true }); // Air rune
                p.addItem(558, 10000, { assureFullInsertion: true }); // Mind rune
            };

            const setupPassiveBot = (p: any) => {
                if (!p) return;
                p.setItemDefResolver((id: number) => getItemDefinition(id));
                this.refreshAppearanceKits(p);
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

        this.loginHandshakeService = new LoginHandshakeService(this as any);
        this.tickPhaseService = new TickPhaseService(this as any);
        this.wss.on("connection", (ws) => this.onConnection(ws));

        // Broadcast ticks to all connected clients
        opts.ticker.on("tick", (data) => this.handleTick(data));
    }

    // ========== Delegating methods to extracted services (Phase 1) ==========

    private withDirectSendBypass<T>(context: string, fn: () => T): T {
        return this.networkLayer.withDirectSendBypass(context, fn);
    }

    // ========== Login Validation Helpers (delegated to AuthenticationService) ==========

    private checkLoginRateLimit(ip: string): boolean {
        return this.authService.checkLoginRateLimit(ip);
    }

    private isPlayerAlreadyLoggedIn(username: string): boolean {
        return this.authService.isPlayerAlreadyLoggedIn(username);
    }

    private isWorldFull(): boolean {
        return this.authService.isWorldFull();
    }

    private completeLogout(ws: WebSocket, player?: PlayerState, source?: string): void {
        const normalizedSource = source?.trim().slice(0, 64) ?? "";
        const sourceSuffix =
            normalizedSource.length > 0 && normalizedSource !== "logout"
                ? ` source=${normalizedSource}`
                : "";

        if (player) {
            logger.info(`[logout] Player ${player.id} logout approved${sourceSuffix}`);

            try {
                const response = encodeMessage({
                    type: "logout_response",
                    payload: { success: true },
                });
                ws.send(response);
            } catch (err) { logger.warn("[logout] send logout response failed", err); }

            try {
                const saveKey = player.__saveKey ?? this.getPlayerSaveKey(player.name, player.id);
                this.playerPersistence.saveSnapshot(saveKey, player);
                logger.info(`[logout] Saved player state for key: ${saveKey}${sourceSuffix}`);
            } catch (err) {
                logger.warn(`[logout] Failed to save player state${sourceSuffix}:`, err);
            }
        }

        try {
            // Intentional logouts must use the canonical close reason so the client
            // suppresses reconnect-based session resumption.
            ws.close(1000, "logout");
        } catch (err) { logger.warn("[logout] ws close failed", err); }
    }

    // ========== Network Layer (delegated to PlayerNetworkLayer) ==========


    private flushMessageBatch(sock: WebSocket): void {
        this.networkLayer.flushMessageBatch(sock);
    }

    private flushAllMessageBatches(): void {
        this.networkLayer.flushAllMessageBatches();
    }

    private sendAdminResponse(ws: WebSocket, message: string | Uint8Array, context: string): void {
        this.networkLayer.sendAdminResponse(ws, message, context);
    }

    private queueDirectSend(
        sock: WebSocket | undefined,
        message: string | Uint8Array,
        context: string,
    ): void {
        if (!sock || sock.readyState !== WebSocket.OPEN) return;
        // Best-effort debug/telemetry: keep the latest message per socket to avoid unbounded growth.
        if (this.pendingDirectSends.size > 512) {
            this.pendingDirectSends.clear();
        }
        this.pendingDirectSends.set(sock, { message, context });
    }

    private queueBroadcastSound(
        payload: {
            soundId: number;
            x: number;
            y: number;
            level: number;
            loops?: number;
            delay?: number;
            radius?: number;
            volume?: number;
        },
        context = "sound",
        radiusTiles = SOUND_BROADCAST_RADIUS_TILES,
    ): void {
        if (!payload || !(payload.soundId > 0) || !this.players) return;
        const msgPayload: {
            soundId: number;
            x: number;
            y: number;
            level: number;
            loops?: number;
            delay?: number;
            radius?: number;
            volume?: number;
        } = { ...payload };
        if (payload.radius !== undefined && payload.radius > 0) {
            msgPayload.radius = Math.min(15, Math.max(0, payload.radius));
        }
        if (payload.volume !== undefined && payload.volume < 255) {
            msgPayload.volume = Math.min(255, Math.max(0, payload.volume));
        }
        const message = encodeMessage({
            type: "sound",
            payload: msgPayload,
        });
        const broadcastRadius = Math.max(0, radiusTiles);
        this.players.forEach((sock, player) => {
            if (!sock || sock.readyState !== WebSocket.OPEN) return;
            if (player.level !== payload.level) return;
            const dx = Math.abs(player.tileX - payload.x);
            const dy = Math.abs(player.tileY - payload.y);
            if (Math.max(dx, dy) > broadcastRadius) return;
            this.queueDirectSend(sock, message, context);
        });
    }

    private flushDirectSendWarnings(stage: string): void {
        this.networkLayer.flushDirectSendWarnings(stage);
    }

    private async handleTick(data: TickEvent): Promise<void> {
        if (this.tickOrchestrator) {
            await this.tickOrchestrator.processTick(data.tick, data.time);
        }
    }

    private maybeRunAutosave(frame: TickFrame): void {
        if (this.autosaveIntervalTicks <= 0) return;
        if (this.autosaveRunning) return;
        if (frame.tick < this.nextAutosaveTick) return;
        this.nextAutosaveTick = frame.tick + this.autosaveIntervalTicks;
        this.autosaveRunning = true;
        setImmediate(() => {
            this.runAutosave(frame.tick)
                .catch((err) => {
                    logger.warn(`[autosave] tick=${frame.tick} failed`, err);
                })
                .finally(() => {
                    this.autosaveRunning = false;
                });
        });
    }

    private async runAutosave(triggerTick: number): Promise<void> {
        if (!this.players) return;
        const entries: Array<{ key: string; player: PlayerState }> = [];
        this.players.forEach((ws, player) => {
            const key = player.__saveKey ?? this.getPlayerSaveKey(player.name, player.id);
            if (key && key.length > 0) {
                entries.push({ key, player });
            }
        });
        if (entries.length === 0) return;
        const started = performance.now();
        try {
            this.playerPersistence.savePlayers(entries);
        } catch (err) {
            logger.warn(`[autosave] bulk save failed tick=${triggerTick}`, err);
        }
        const elapsed = performance.now() - started;
        logger.info(
            `[autosave] tick=${triggerTick} saved ${entries.length} player(s) in ${elapsed.toFixed(
                1,
            )}ms`,
        );
    }

    private async runTickStage(
        name: string,
        fn: () => void | Promise<void>,
        frame: TickFrame,
    ): Promise<boolean> {
        try {
            await fn();
            return true;
        } catch (err) {
            this.restorePendingFrame(frame);
            logger.error(`[tick] stage ${name} failed (tick=${frame.tick})`, err);
            return false;
        }
    }

    private async yieldToEventLoop(stage: string): Promise<void> {
        await new Promise<void>((resolve) => {
            setImmediate(resolve);
        });
        this.flushDirectSendWarnings(stage);
    }

    private restorePendingFrame(frame: TickFrame): void {
        // Restore NPC state (still on WSServer)
        if (frame.npcUpdates.length > 0) {
            for (const update of frame.npcUpdates) {
                upsertNpcUpdateDelta(this.pendingNpcUpdates, update);
            }
        }
        if (frame.npcPackets.size > 0) {
            for (const [playerId, packet] of frame.npcPackets.entries()) {
                const existing = this.pendingNpcPackets.get(playerId);
                if (existing) {
                    existing.snapshots.push(...packet.snapshots);
                    existing.updates.push(...packet.updates);
                    existing.despawns.push(...packet.despawns);
                } else {
                    this.pendingNpcPackets.set(playerId, packet);
                }
            }
        }
        const projectilePackets = frame.projectilePackets ?? new Map();
        if (projectilePackets.size > 0 && this.projectileSystem) {
            this.projectileSystem.restorePackets(projectilePackets);
        }
        // Restore all BroadcastScheduler-managed queues
        if (frame.widgetEvents.length > 0) {
            this.broadcastScheduler.restoreWidgetEvents(frame.widgetEvents);
        }
        if (frame.notifications.length > 0) {
            this.broadcastScheduler.restoreNotifications(frame.notifications);
        }
        if (frame.keyedMessages.size > 0) {
            this.broadcastScheduler.restoreAllKeyedMessages(frame.keyedMessages);
        }
        if (frame.locChanges.length > 0) {
            this.broadcastScheduler.restoreLocChanges(frame.locChanges);
        }
        if (frame.chatMessages.length > 0) {
            this.broadcastScheduler.restoreChatMessages(frame.chatMessages);
        }
        if (frame.inventorySnapshots.length > 0) {
            this.broadcastScheduler.restoreInventorySnapshots(frame.inventorySnapshots);
        }
        if (frame.gamemodeSnapshots.size > 0) {
            this.broadcastScheduler.restoreGamemodeSnapshots(frame.gamemodeSnapshots);
        }
        if (frame.varps && frame.varps.length > 0) {
            this.broadcastScheduler.restoreVarps(frame.varps);
        }
        if (frame.varbits && frame.varbits.length > 0) {
            this.broadcastScheduler.restoreVarbits(frame.varbits);
        }
        if (frame.appearanceSnapshots.length > 0) {
            this.broadcastScheduler.restoreAppearanceSnapshots(frame.appearanceSnapshots);
        }
        if (frame.skillSnapshots.length > 0) {
            this.broadcastScheduler.restoreSkillSnapshots(frame.skillSnapshots);
        }
        if (frame.combatSnapshots.length > 0) {
            this.broadcastScheduler.restoreCombatSnapshots(frame.combatSnapshots);
        }
        if (frame.runEnergySnapshots.length > 0) {
            this.broadcastScheduler.restoreRunEnergySnapshots(frame.runEnergySnapshots);
        }
        if (frame.animSnapshots.length > 0) {
            this.broadcastScheduler.restoreAnimSnapshots(frame.animSnapshots);
        }
        if (frame.spellResults.length > 0) {
            this.broadcastScheduler.restoreSpellResults(frame.spellResults);
        }
        if (frame.hitsplats.length > 0) {
            this.broadcastScheduler.restoreHitsplats(frame.hitsplats);
        }
        if (frame.forcedChats.length > 0) {
            this.broadcastScheduler.restoreForcedChats(frame.forcedChats);
        }
        if (frame.forcedMovements.length > 0) {
            this.broadcastScheduler.restoreForcedMovements(frame.forcedMovements);
        }
        if (frame.spotAnimations.length > 0) {
            this.broadcastScheduler.restoreSpotAnimations(frame.spotAnimations);
        }
    }

    private broadcastTick(frame: TickFrame): void {
        const msg = encodeMessage({
            type: "tick",
            payload: { tick: frame.tick, time: frame.time },
        });
        this.withDirectSendBypass("tick_broadcast", () => this.broadcast(msg, "tick"));
    }

    private emitLocChange(
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
        this.locationService.emitLocChange(oldId, newId, tile, level, opts);
    }

    private sendLocChangeToPlayer(
        player: PlayerState,
        oldId: number,
        newId: number,
        tile: { x: number; y: number },
        level: number,
    ): void {
        this.locationService.sendLocChangeToPlayer(player, oldId, newId, tile, level);
    }

    private spawnLocForPlayer(
        player: PlayerState,
        locId: number,
        tile: { x: number; y: number },
        level: number,
        shape: number,
        rotation: number,
    ): void {
        this.locationService.spawnLocForPlayer(player, locId, tile, level, shape, rotation);
    }

    private getGroundChunkKey(player: PlayerState): number {
        const mapX = player.tileX >> 6;
        const mapY = player.tileY >> 6;
        return (mapX << 16) | (mapY & 0xffff);
    }

    private resolveSceneBaseCoordinate(currentBase: number, playerTile: number): number {
        const centeredBase = Math.max(0, (playerTile - 48) & ~7);
        if (currentBase < 0) {
            return centeredBase;
        }
        const local = playerTile - currentBase;
        if (local < 16 || local >= 88) {
            return centeredBase;
        }
        return currentBase;
    }

    private getDynamicLocSceneKey(
        ws: WebSocket | undefined,
        player: PlayerState,
    ): { key: string; baseX: number; baseY: number } {
        const session = ws ? this.playerSyncSessions.get(ws) : undefined;
        const baseX = this.resolveSceneBaseCoordinate(session?.baseTileX ?? -1, player.tileX);
        const baseY = this.resolveSceneBaseCoordinate(session?.baseTileY ?? -1, player.tileY);
        return {
            key: `${player.level}:${baseX}:${baseY}`,
            baseX,
            baseY,
        };
    }

    private maybeReplayDynamicLocState(
        ws: WebSocket,
        player: PlayerState,
        force: boolean = false,
    ): void {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            return;
        }

        const playerId = player.id;
        if (!(playerId >= 0)) {
            return;
        }

        const scene = this.getDynamicLocSceneKey(ws, player);
        const lastSceneKey = this.playerDynamicLocSceneKeys.get(playerId);
        if (!force && lastSceneKey === scene.key) {
            return;
        }

        const visibleStates = this.dynamicLocState.queryScene(
            scene.baseX,
            scene.baseY,
            player.level,
        );
        this.withDirectSendBypass("loc_change_replay", () => {
            for (const state of visibleStates) {
                this.networkLayer.sendWithGuard(
                    ws,
                    encodeMessage({
                        type: "loc_change",
                        payload: {
                            oldId: state.oldId,
                            newId: state.newId,
                            tile: { x: state.oldTile.x, y: state.oldTile.y },
                            level: state.level,
                            oldTile: { x: state.oldTile.x, y: state.oldTile.y },
                            newTile: { x: state.newTile.x, y: state.newTile.y },
                            oldRotation: state.oldRotation,
                            newRotation: state.newRotation,
                        },
                    }),
                    "loc_change_replay",
                );
            }
        });

        this.playerDynamicLocSceneKeys.set(playerId, scene.key);
    }

    private maybeSendGroundItemSnapshot(ws: WebSocket, player: PlayerState): void {
        this.groundItemHandler.maybeSendGroundItemSnapshot(ws, player);
    }

    private spawnDebugGroundItemStack(): void {
        if (!this.groundItems) return;
        try {
            const nowTick = this.options.ticker.currentTick();
            const tile = DEBUG_LOG_TILE;
            const stack = this.groundItems.spawn(
                DEBUG_LOG_ITEM_ID,
                DEBUG_LOG_STACK_QTY,
                tile,
                nowTick,
                { durationTicks: 0, privateTicks: 0 },
            );
            if (stack) {
                logger.info(
                    `[ground] spawned debug log stack item=%d qty=%d tile=(%d,%d,%d)`,
                    stack.itemId,
                    stack.quantity,
                    tile.x,
                    tile.y,
                    tile.level,
                );
            }
        } catch (err) {
            logger.warn("[ground] failed to spawn debug log stack", err);
        }
    }

    private createTickFrame(data: TickEvent): TickFrame {
        const npcUpdates = this.pendingNpcUpdates;
        const npcPackets = new Map(this.pendingNpcPackets);
        const projectilePackets = this.projectileSystem?.drainPendingPackets() ?? new Map();
        this.pendingNpcPackets = new Map();
        this.pendingNpcUpdates = [];
        // Drain all queues from BroadcastScheduler
        const widgetEvents = this.broadcastScheduler.drainWidgetEvents();
        const notifications = this.broadcastScheduler.drainNotifications();
        const keyedMessages = this.broadcastScheduler.drainAllKeyedMessages();
        const locChanges = this.broadcastScheduler.drainLocChanges();
        const chatMessages = this.broadcastScheduler.drainChatMessages();
        const inventorySnapshots = this.broadcastScheduler.drainInventorySnapshots();
        const gamemodeSnapshots = this.broadcastScheduler.drainGamemodeSnapshots();
        const appearanceSnapshots = this.broadcastScheduler.drainAppearanceSnapshots();
        const skillSnapshots = this.broadcastScheduler.drainSkillSnapshots();
        const combatSnapshots = this.broadcastScheduler.drainCombatSnapshots();
        const runEnergySnapshots = this.broadcastScheduler.drainRunEnergySnapshots();
        const animSnapshots = this.broadcastScheduler.drainAnimSnapshots();
        const spellResults = this.broadcastScheduler.drainSpellResults();
        const hitsplats = this.broadcastScheduler.drainHitsplats();
        const forcedChats = this.broadcastScheduler.drainForcedChats();
        const forcedMovements = this.broadcastScheduler.drainForcedMovements();
        const spotAnimations = this.broadcastScheduler.drainSpotAnimations();
        const varps = this.broadcastScheduler.drainVarps();
        const varbits = this.broadcastScheduler.drainVarbits();
        const clientScripts = this.broadcastScheduler.drainClientScripts();
        return {
            tick: data.tick,
            time: data.time,
            npcUpdates,
            npcEffectEvents: [],
            playerSteps: new Map<number, StepRecord[]>(),
            hitsplats,
            forcedChats,
            forcedMovements,
            pendingSequences: new Map<
                number,
                { seqId: number; delay: number; startTick: number }
            >(),
            actionEffects: [],
            interactionIndices: new Map<number, number>(),
            pendingFaceDirs: new Map<number, number>(),
            playerViews: new Map<number, PlayerViewSnapshot>(),
            npcViews: new Map<number, NpcViewSnapshot>(),
            widgetEvents,
            notifications,
            keyedMessages,
            locChanges,
            chatMessages,
            inventorySnapshots,
            gamemodeSnapshots,
            appearanceSnapshots,
            skillSnapshots,
            combatSnapshots,
            runEnergySnapshots,
            animSnapshots,
            npcPackets,
            projectilePackets,
            spotAnimations,
            spellResults,
            varps,
            varbits,
            clientScripts,
            colorOverrides: new Map(),
            npcColorOverrides: new Map(),
        };
    }

    private runPreMovementPhase(frame: TickFrame): void {
        this.tickPhaseService.runPreMovementPhase(frame);
    }

    private scheduleNpcAggressionAttack(
        npcId: number,
        targetPlayerId: number,
        currentTick: number,
    ): void {
        this.tickPhaseService.scheduleNpcAggressionAttack(npcId, targetPlayerId, currentTick);
    }

    private flushPendingWalkCommands(currentTick: number, stage: "pre" | "movement" = "pre"): void {
        this.tickPhaseService.flushPendingWalkCommands(currentTick, stage);
    }

    private runMovementPhase(frame: TickFrame): void {
        this.tickPhaseService.runMovementPhase(frame);
    }

    private runCombatPhase(frame: TickFrame): void {
        this.tickPhaseService.runCombatPhase(frame);
    }

    private refreshInteractionFacing(frame: TickFrame): void {
        this.tickPhaseService.refreshInteractionFacing(frame);
    }

    private processGamemodeTickCallbacks(frame: TickFrame): void {
        this.tickPhaseService.processGamemodeTickCallbacks(frame);
    }

    private runMusicPhase(frame: TickFrame): void {
        this.tickPhaseService.runMusicPhase(frame);
    }

    private syncMusicUnlockVarps(player: PlayerState, trackId: number): void {
        this.varpSyncService.syncMusicUnlockVarps(player, trackId);
    }

    private getCombatTargetPlayerVarpValue(player: PlayerState): number {
        return this.varpSyncService.getCombatTargetPlayerVarpValue(player);
    }

    private syncCombatTargetPlayerVarp(player: PlayerState): void {
        this.varpSyncService.syncCombatTargetPlayerVarp(player);
    }

    private runScriptPhase(frame: TickFrame): void {
        this.tickPhaseService.runScriptPhase(frame);
    }

    private runDeathPhase(frame: TickFrame): void {
        this.tickPhaseService.runDeathPhase(frame);
    }

    private runPostScriptPhase(frame: TickFrame): void {
        this.tickPhaseService.runPostScriptPhase(frame);
    }

    private runPostEffectsPhase(frame: TickFrame): void {
        this.tickPhaseService.runPostEffectsPhase(frame);
    }

    private runOrphanedPlayersPhase(frame: TickFrame): void {
        this.tickPhaseService.runOrphanedPlayersPhase(frame);
    }

    private checkAndSendSnapshots(player: PlayerState, sock?: WebSocket): void {
        this.tickPhaseService.checkAndSendSnapshots(player, sock);
    }

    private runBroadcastPhase(frame: TickFrame): void {
        this.tickPhaseService.runBroadcastPhase(frame);
    }

    private buildBroadcastContext(): BroadcastContext {
        return this.tickPhaseService.buildBroadcastContext();
    }

    private applyAppearanceSnapshotsToViews(frame: TickFrame): void {
        this.tickPhaseService.applyAppearanceSnapshotsToViews(frame);
    }

    private buildAndSendActorSync(
        sock: WebSocket,
        player: PlayerState,
        frame: TickFrame,
        ctx: BroadcastContext,
    ): void {
        this.tickPhaseService.buildAndSendActorSync(sock, player, frame, ctx);
    }

    private flushPerPlayerDirtyState(frame: TickFrame): void {
        this.tickPhaseService.flushPerPlayerDirtyState(frame);
    }

    private flushAnimSnapshots(frame: TickFrame, ctx: BroadcastContext): void {
        this.tickPhaseService.flushAnimSnapshots(frame, ctx);
    }

    getScriptScheduler(): ScriptScheduler {
        return this.scriptScheduler;
    }

    private getOrCreateWidgetLedger(playerId: number): PlayerWidgetOpenLedger {
        return this.interfaceManager.getOrCreateWidgetLedger(playerId);
    }

    private noteWidgetEventForLedger(playerId: number, action: WidgetAction): void {
        this.interfaceManager.noteWidgetEventForLedger(playerId, action);
    }

    private isWidgetGroupOpenInLedger(playerId: number, groupId: number): boolean {
        return this.interfaceManager.isWidgetGroupOpenInLedger(playerId, groupId);
    }

    private clearUiTrackingForPlayer(playerId: number): void {
        this.interfaceManager.clearUiTrackingForPlayer(playerId);
        this.accountSummary.clearPlayer(playerId);
        this.gamemode.onPlayerDisconnect?.(playerId);
        this.reportGameTime.clearPlayer(playerId);
    }

    private getGamemodeBridge(): GamemodeBridge {
        return {
            getPlayer: (playerId) => this.players?.getById(playerId),
            queueVarp: (playerId, varpId, value) => this.variableService.queueVarp(playerId, varpId, value),
            queueVarbit: (playerId, varbitId, value) => this.variableService.queueVarbit(playerId, varbitId, value),
            queueNotification: (playerId, notification) => this.queueNotification(playerId, notification),
            queueWidgetEvent: (playerId, event) => this.queueWidgetEvent(playerId, event),
            queueClientScript: (playerId, scriptId, ...args) => this.queueClientScript(playerId, scriptId, ...args),
            sendGameMessage: (player, text) => this.messagingService.queueChatMessage({
                messageType: "game",
                text,
                targetPlayerIds: [player.id],
            }),
        };
    }

    private queueActivateQuestSideTab(playerId: number): void {
        this.gamemodeUi?.activateQuestTab(playerId);
    }

    private syncPostWidgetOpenState(playerId: number, action: WidgetAction): void {
        const groupId =
            "groupId" in action && typeof action.groupId === "number" ? action.groupId : 0;
        if (groupId !== MUSIC_GROUP_ID) {
            return;
        }

        if (action.action !== "open_sub" && action.action !== "open") {
            return;
        }

        const player = this.players?.getById(playerId);
        if (!player) {
            return;
        }

        this.soundManager.syncMusicInterfaceForPlayer(player);
    }

    private normalizeSideJournalState(
        player: PlayerState,
        incomingStateVarp?: number,
    ): { tab: number; stateVarp: number } {
        return this.gamemodeUi?.normalizeSideJournalState(player, incomingStateVarp)
            ?? { tab: 0, stateVarp: incomingStateVarp ?? 0 };
    }

    private queueSideJournalGamemodeUi(player: PlayerState): void {
        this.gamemodeUi?.applySideJournalUi(player);
    }

    private queueNotification(playerId: number, payload: any): void {
        this.messagingService.queueNotification(playerId, payload);
    }

    private queueWidgetEvent(playerId: number, action: WidgetAction): void {
        const event = { playerId: playerId, action };
        this.noteWidgetEventForLedger(event.playerId, action);
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
                this.queueEquipmentStatsWidgetTexts(player);
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


    private queueSmithingInterfaceMessage(playerId: number, payload: SmithingServerPayload): void {
        this.broadcastScheduler.queueKeyedMessage("smithing", playerId, payload);
    }

    private queueTradeMessage(playerId: number, payload: TradeServerPayload): void {
        this.broadcastScheduler.queueKeyedMessage("trade", playerId, payload);
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

    /**
     * Queue a client script to be executed on the client (rsmod parity).
     * This is the OSRS-parity way to trigger CS2 scripts from the server.
     */
    private queueClientScript(
        playerId: number,
        scriptId: number,
        ...args: (number | string)[]
    ): void {
        logger.info?.(
            `[clientScript] queue player=${playerId} script=${scriptId} args=${JSON.stringify(
                args,
            )}`,
        );
        this.broadcastScheduler.queueClientScript(playerId, scriptId, args);
    }

    private sendGameMessageToPlayer(player: PlayerState, text: string): void {
        this.messagingService.sendGameMessageToPlayer(player, text);
    }


    private enqueueForcedChat(event: ForcedChatBroadcast): void {
        this.messagingService.enqueueForcedChat(event);
    }

    private enqueueForcedMovement(event: ForcedMovementBroadcast): void {
        if (this.activeFrame) {
            this.activeFrame.forcedMovements.push(event);
        } else {
            this.broadcastScheduler.queueForcedMovement(event);
        }
    }

    private enqueueSpotAnimation(event: PendingSpotAnimation): void {
        if (this.activeFrame) {
            this.activeFrame.spotAnimations.push(event);
        } else {
            this.broadcastScheduler.queueSpotAnimation(event);
        }
    }

    private enqueueSoundBroadcast(soundId: number, x: number, y: number, level: number): void {
        // Always use broadcast during tick execution to avoid "direct-send" warnings
        // The activeFrame check is sufficient to determine if we're inside a tick cycle
        this.withDirectSendBypass("broadcast", () =>
            this.broadcastSound({ soundId, x, y, level }, "sound"),
        );
    }


    private sendSound(
        player: PlayerState,
        soundId: number,
        opts?: { delay?: number; loops?: number },
    ): void {
        this.soundService.sendSound(player, soundId, opts);
    }

    /**
     * Send a loot notification popup to a player when they pick up an item.
     * Matches OSRS's notification_display (interface 660) behavior.
     */
    private sendLootNotification(player: PlayerState, itemId: number, quantity: number): void {
        this.messagingService.sendLootNotification(player, itemId, quantity);
    }

    /**
     * OSRS parity: Send a jingle (short music fanfare) to a player.
     * Jingles interrupt current music, then music resumes after jingle ends.
     * Used for level-ups, quest completions, achievement unlocks, etc.
     *
     * @param player - Target player
     * @param jingleId - Jingle track ID from musicJingles index (index 11)
     * @param delay - Unused jingle delay field from the OSRS packet (default 0)
     */
    private sendJingle(player: PlayerState, jingleId: number, delay: number = 0): void {
        this.soundService.sendJingle(player, jingleId, delay);
    }

    private broadcastSound(
        payload: {
            soundId: number;
            x?: number;
            y?: number;
            level?: number;
            loops?: number;
            delay?: number;
            /** SOUND_AREA: radius in tiles (0-15) for client-side distance falloff */
            radius?: number;
            /** SOUND_AREA: volume (0-255, default 255) */
            volume?: number;
        },
        context = "sound",
        radiusTiles = SOUND_BROADCAST_RADIUS_TILES,
    ): void {
        if (!payload || !(payload.soundId > 0)) return;
        const hasPosition =
            payload.x !== undefined &&
            payload.y !== undefined &&
            Number.isFinite(payload.x) &&
            Number.isFinite(payload.y);
        const level =
            payload.level !== undefined && Number.isFinite(payload.level)
                ? payload.level
                : undefined;
        // Build the message payload, including SOUND_AREA fields if present
        const msgPayload: {
            soundId: number;
            x?: number;
            y?: number;
            level?: number;
            loops?: number;
            delay?: number;
            radius?: number;
            volume?: number;
        } = { ...payload };
        if (level !== undefined) msgPayload.level = level;
        if (payload.radius !== undefined && payload.radius > 0) {
            msgPayload.radius = Math.min(15, Math.max(0, payload.radius));
        }
        if (payload.volume !== undefined && payload.volume < 255) {
            msgPayload.volume = Math.min(255, Math.max(0, payload.volume));
        }
        const msg = encodeMessage({
            type: "sound",
            payload: msgPayload,
        });
        if (!hasPosition || !this.players) {
            this.broadcast(msg, context);
            return;
        }
        const px = payload.x as number;
        const py = payload.y as number;
        const broadcastRadius = Math.max(0, radiusTiles);
        this.players.forEach((sock, p) => {
            if (!sock || sock.readyState !== WebSocket.OPEN) return;
            if (level !== undefined && p.level !== level) return;
            const dx = Math.abs(p.tileX - px);
            const dy = Math.abs(p.tileY - py);
            if (Math.max(dx, dy) > broadcastRadius) return;
            this.networkLayer.sendWithGuard(sock, msg, context);
        });
    }

    private playLocSound(opts: {
        soundId: number;
        tile?: { x: number; y: number };
        level?: number;
        loops?: number;
        delayMs?: number;
        radius?: number;
        volume?: number;
    }): void {
        this.soundService.playLocSound(opts);
    }

    /**
     * SOUND_AREA: Play a sound at a specific location with radius and volume.
     * This is the OSRS-parity method for area sounds that have distance-based falloff.
     * @param opts.soundId - The sound effect ID
     * @param opts.tile - The tile position {x, y}
     * @param opts.level - The plane/level (0-3)
     * @param opts.radius - Radius in tiles (0-15) for distance falloff on client
     * @param opts.volume - Volume (0-255, default 255)
     * @param opts.delay - Delay in ticks before playing
     */
    private playAreaSound(opts: {
        soundId: number;
        tile: { x: number; y: number };
        level?: number;
        radius?: number;
        volume?: number;
        delay?: number;
    }): void {
        this.soundService.playAreaSound(opts);
    }

    private getMusicTrackIdByName(trackName: string): number {
        return this.soundService.getMusicTrackIdByName(trackName);
    }

    private enqueueSpellFailureChat(
        player: PlayerState,
        spellId: number,
        reason: string | undefined,
    ): void {
        this.spellCastingService.enqueueSpellFailureChat(player, spellId, reason);
    }

    private queueAppearanceSnapshot(
        player: PlayerState,
        overrides?: Partial<{
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
        }>,
    ): void {
        this.playerAppearanceManager.queueAppearanceSnapshot(player, overrides);
    }

    private requestTeleportAction(
        player: PlayerState,
        request: TeleportActionRequest,
    ): { ok: boolean; reason?: string } {
        return this.movementService.requestTeleportAction(player, request);
    }

    private tryReleaseTeleportDelayLock(player: PlayerState, expected: LockState): void {
        this.movementService.tryReleaseTeleportDelayLock(player, expected);
    }

    /**
     * Teleport a player to a new location with proper OSRS parity.
     * Clears actions, updates playerViews, and syncs appearance.
     */
    private teleportPlayer(
        player: PlayerState,
        x: number,
        y: number,
        level: number,
        _forceRebuild: boolean = false,
    ): void {
        this.movementService.teleportPlayer(player, x, y, level, _forceRebuild);
    }

    private teleportToInstance(
        player: PlayerState,
        x: number,
        y: number,
        level: number,
        templateChunks: number[][][],
        extraLocs?: Array<{ id: number; x: number; y: number; level: number; shape: number; rotation: number }>,
    ): void {
        this.movementService.teleportToInstance(player, x, y, level, templateChunks, extraLocs);
    }

    sendRebuildNormal(player: PlayerState): void {
        const ws = this.players?.getSocketByPlayerId(player.id);
        if (!ws) return;

        const regionX = player.tileX >> 3;
        const regionY = player.tileY >> 3;
        const payload = buildRebuildNormalPayload(
            regionX,
            regionY,
            this.cacheEnv!,
        );
        const packet = encodeMessage({ type: "rebuild_normal", payload } as any);
        this.withDirectSendBypass("rebuild_normal", () =>
            this.networkLayer.sendWithGuard(ws, packet, "rebuild_normal"),
        );
    }

    sendWorldEntity(
        player: PlayerState,
        entityIndex: number,
        configId: number,
        sizeX: number,
        sizeZ: number,
        templateChunks: number[][][],
        buildAreas: import("../../../src/shared/worldentity/WorldEntityTypes").WorldEntityBuildArea[],
        extraLocs?: Array<{ id: number; x: number; y: number; level: number; shape: number; rotation: number }>,
        extraNpcs?: Array<{ id: number; x: number; y: number; level: number }>,
        drawMode: number = 0,
    ): void {
        const ws = this.players?.getSocketByPlayerId(player.id);
        if (!ws) return;

        const regionX = 480; // source region chunk X
        const regionY = 800; // source region chunk Y

        const payload = buildRebuildWorldEntityPayload(
            entityIndex, configId, sizeX, sizeZ,
            regionX, regionY, regionX, regionY,
            templateChunks, buildAreas, this.cacheEnv!, false,
        );
        (payload as any).extraNpcs = extraNpcs ?? [];
        // Pass basePlane so the client knows which plane deck content lives on
        (payload as any).basePlane = 1;
        const packet = encodeMessage({ type: "rebuild_worldentity", payload } as any);
        this.withDirectSendBypass("rebuild_worldentity", () =>
            this.networkLayer.sendWithGuard(ws, packet, "rebuild_worldentity"),
        );

        // Register in per-tick world entity tracker with initial position (fine units)
        const entityFineX = (regionX * 8 + sizeX * 4) * 128;
        const entityFineZ = (regionY * 8 + sizeZ * 4) * 128;
        this.worldEntityInfoEncoder.addEntity(player.id, {
            entityIndex, sizeX, sizeZ, configId, drawMode,
            position: { x: entityFineX, y: 0, z: entityFineZ, orientation: 0 },
        });

        if (extraLocs) {
            for (const loc of extraLocs) {
                this.spawnLocForPlayer(player, loc.id, { x: loc.x, y: loc.y }, loc.level, loc.shape, loc.rotation);
            }
        }
    }

    teleportToWorldEntity(
        player: PlayerState,
        x: number,
        y: number,
        level: number,
        entityIndex: number,
        configId: number,
        sizeX: number,
        sizeZ: number,
        templateChunks: number[][][],
        buildAreas: import("../../../src/shared/worldentity/WorldEntityTypes").WorldEntityBuildArea[],
        extraLocs?: Array<{ id: number; x: number; y: number; level: number; shape: number; rotation: number }>,
        drawMode: number = 0,
    ): void {
        logger.info(`[teleportToWorldEntity] Player ${player.id} -> (${x}, ${y}, ${level}) entity=${entityIndex}`);
        const ws = this.players?.getSocketByPlayerId(player.id);
        if (!ws) {
            logger.warn(`[teleportToWorldEntity] No websocket for player ${player.id}`);
            return;
        }

        const regionX = x >> 3;
        const regionY = y >> 3;
        const zoneX = regionX;
        const zoneZ = regionY;

        const payload = buildRebuildWorldEntityPayload(
            entityIndex,
            configId,
            sizeX,
            sizeZ,
            zoneX,
            zoneZ,
            regionX,
            regionY,
            templateChunks,
            buildAreas,
            this.cacheEnv!,
            false,
        );
        const packet = encodeMessage({ type: "rebuild_worldentity", payload } as any);
        logger.info(`[teleportToWorldEntity] Sending REBUILD_WORLDENTITY packet (${packet.length} bytes, ${payload.mapRegions.length} regions)`);
        this.withDirectSendBypass("rebuild_worldentity", () =>
            this.networkLayer.sendWithGuard(ws, packet, "rebuild_worldentity"),
        );

        // Register in per-tick world entity tracker with initial position (fine units)
        const entityFineX = (regionX * 8 + sizeX * 4) * 128;
        const entityFineZ = (regionY * 8 + sizeZ * 4) * 128;
        this.worldEntityInfoEncoder.addEntity(player.id, {
            entityIndex, sizeX, sizeZ, configId, drawMode,
            position: { x: entityFineX, y: 0, z: entityFineZ, orientation: 0 },
        });

        this.teleportPlayer(player, x, y, level);

        if (extraLocs) {
            for (const loc of extraLocs) {
                this.spawnLocForPlayer(player, loc.id, { x: loc.x, y: loc.y }, loc.level, loc.shape, loc.rotation);
            }
        }
    }

    private queueInventorySnapshot(playerId: number): void {
        this.inventoryService.queueInventorySnapshot(playerId);
    }

    private queueSkillSnapshot(playerId: number, update: SkillSyncUpdate): void {
        this.skillService.queueSkillSnapshot(playerId, update);
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
            !!player.autoRetaliate,
            player.combatStyleSlot,
            Array.from(player.activePrayers ?? []),
            player.combatSpellId > 0 ? player.combatSpellId : undefined,
        );
    }


    private queueRunEnergySnapshot(player: PlayerState | undefined): void {
        this.movementService.queueRunEnergySnapshot(player);
    }

    private sendRunEnergyState(sock: WebSocket, player: PlayerState): void {
        this.movementService.sendRunEnergyState(sock, player);
    }


    private isAdminPlayer(player: PlayerState | undefined): boolean {
        return this.authService.isAdminPlayer(player);
    }


    private getAppearanceDisplayName(player: PlayerState | undefined): string {
        return this.appearanceService.getAppearanceDisplayName(player);
    }

    private getPublicChatPlayerType(player: PlayerState): number {
        return this.authService.getPublicChatPlayerType(player);
    }

    private syncAccountTypeVarbit(sock: WebSocket, player: PlayerState): void {
        this.varpSyncService.syncAccountTypeVarbit(sock, player);
    }

    private sendSavedAutocastTransmitVarbits(sock: WebSocket, player: PlayerState): void {
        this.varpSyncService.sendSavedAutocastTransmitVarbits(sock, player);
    }

    private sendSavedTransmitVarps(sock: WebSocket, player: PlayerState): void {
        this.varpSyncService.sendSavedTransmitVarps(sock, player);
    }

    private queueAnimSnapshot(playerId: number, anim: PlayerAnimSet | undefined): void {
        this.appearanceService.queueAnimSnapshot(playerId, anim);
    }

    private queueSpellResult(playerId: number, payload: SpellResultPayload): void {
        if (this.activeFrame) {
            this.activeFrame.spellResults.push({ playerId: playerId, payload });
            return;
        }
        this.broadcastScheduler.queueSpellResult(playerId, payload);
    }
    /**
     * Send collection-log display varps on login/reconnect so summary/account UIs have the same
     * state they would get after opening the collection log itself.
     */
    private sendCollectionLogDisplayVarps(sock: WebSocket, player: PlayerState): void {
        const displayVarps = syncCollectionDisplayVarps(player);
        for (const [varpIdRaw, valueRaw] of Object.entries(displayVarps)) {
            this.withDirectSendBypass("varp", () =>
                this.networkLayer.sendWithGuard(
                    sock,
                    encodeMessage({
                        type: "varp",
                        payload: {
                            varpId: Number(varpIdRaw),
                            value: valueRaw | 0,
                        },
                    }),
                    "varp",
                ),
            );
        }
    }

    private getInventory(p: PlayerState): InventoryEntry[] {
        return this.inventoryService.getInventory(p);
    }

    private setInventorySlot(
        p: PlayerState,
        slotIndex: number,
        itemId: number,
        quantity: number,
    ): void {
        this.inventoryService.setInventorySlot(p, slotIndex, itemId, quantity);
    }

    /**
     * Build the generic server services bag for gamemodes to consume.
     * Any gamemode feature (banking, shops, etc.) uses these to interact with core server systems.
     */

    /**
     * Create the NpcPacketEncoder with all required services.
     */

    /**
     * Create the PlayerPacketEncoder with all required services.
     */

    /**
     * Encode text to CP1252 bytes.
     */
    private encodeCp1252(text: string): Uint8Array {
        const out: number[] = [];
        const map: Record<number, number> = {
            0x20ac: 0x80,
            0x201a: 0x82,
            0x0192: 0x83,
            0x201e: 0x84,
            0x2026: 0x85,
            0x2020: 0x86,
            0x2021: 0x87,
            0x02c6: 0x88,
            0x2030: 0x89,
            0x0160: 0x8a,
            0x2039: 0x8b,
            0x0152: 0x8c,
            0x017d: 0x8e,
            0x2018: 0x91,
            0x2019: 0x92,
            0x201c: 0x93,
            0x201d: 0x94,
            0x2022: 0x95,
            0x2013: 0x96,
            0x2014: 0x97,
            0x02dc: 0x98,
            0x2122: 0x99,
            0x0161: 0x9a,
            0x203a: 0x9b,
            0x0153: 0x9c,
            0x017e: 0x9e,
            0x0178: 0x9f,
        };
        for (let i = 0; i < text.length; i++) {
            const codePoint = text.codePointAt(i) ?? 0;
            if (codePoint > 0xffff) i++;
            if ((codePoint >= 0 && codePoint <= 0x7f) || (codePoint >= 0xa0 && codePoint <= 0xff)) {
                out.push(codePoint & 0xff);
                continue;
            }
            const mapped = map[codePoint];
            out.push(mapped !== undefined ? mapped : 0x3f);
        }
        return Uint8Array.from(out);
    }

    /**
     * Create the CombatActionHandler with all required services.
     */

    /**
     * Create the SpellActionHandler with all required services.
     */

    /**
     * Create the InventoryActionHandler with all required services.
     */

    /**
     * Create the EffectDispatcher with all required services.
     */

    /**
     * Create the WidgetDialogHandler with all required services.
     */


    /**
     * Create the NpcSyncManager with all required services.
     */


    /**
     * Create the ProjectileSystem with all required services.
     */

    /**
     * Create the GatheringSystemManager with all required services.
     */

    /**
     * Create the EquipmentHandler with all required services.
     */

    /**
     * Build the ScriptServices object for the ScriptRuntime.
     * Extracted from the constructor to reduce constructor size and make
     * the services wiring independently modifiable.
     */

    private createMessageRouter(): MessageRouter {
        const services: MessageRouterServices = {
            getPlayer: (ws) => this.players?.get(ws),
            sendWithGuard: (ws, message, context) => this.networkLayer.sendWithGuard(ws, message, context),
            sendAdminResponse: (ws, message, context) =>
                this.sendAdminResponse(ws, message, context),
            withDirectSendBypass: (context, fn) => this.withDirectSendBypass(context, fn),
            queueChatMessage: (msg) => this.messagingService.queueChatMessage(msg),
            closeInterruptibleInterfaces: (player) => this.closeInterruptibleInterfaces(player),
            encodeMessage: encodeMessage,
        };

        const router = new MessageRouter(services);

        // Register message handlers
        ServiceWiring.registerMessageHandlers(this, router);

        return router;
    }


    private sanitizeHandshakeAppearance(raw: HandshakeAppearance): PlayerAppearanceState {
        const colors = raw.colors?.slice(0, 10);
        const kits = raw.kits?.slice(0, 12);
        return {
            gender: raw.gender === 1 ? 1 : 0,
            colors,
            kits,
            equip: new Array<number>(EQUIP_SLOT_COUNT).fill(-1),
            equipQty: new Array<number>(EQUIP_SLOT_COUNT).fill(0),
            headIcons: { prayer: -1 },
        };
    }

    private getOrCreateAppearance(player: PlayerState): PlayerAppearanceState {
        return this.appearanceService.getOrCreateAppearance(player);
    }


    private createDefaultAppearance(): PlayerAppearanceState {
        return this.appearanceService.createDefaultAppearance();
    }

    private setPendingLoginName(ws: WebSocket, name: string): void {
        this.loginHandshakeService.setPendingLoginName(ws, name);
    }

    private consumePendingLoginName(ws: WebSocket): string | undefined {
        return this.loginHandshakeService.consumePendingLoginName(ws);
    }

    private getSocketRemoteAddress(ws: WebSocket): string | undefined {
        const transport = Reflect.get(ws, "_socket") as { remoteAddress?: string } | undefined;
        const remoteAddress = transport?.remoteAddress;
        return remoteAddress && remoteAddress.length > 0 ? remoteAddress : undefined;
    }


    private queueEquipmentStatsWidgetTexts(player: PlayerState): void {
        this.equipmentStatsUiService.queueEquipmentStatsWidgetTexts(player);
    }


    private computeRunEnergyRegenUnits(
        agilityLevel: number,
        opts: { resting: boolean; gracefulPieces?: number },
    ): number {
        return this.movementService.computeRunEnergyRegenUnits(agilityLevel, opts);
    }


    private updateRunEnergy(
        player: PlayerState,
        activity: { ran: boolean; moved: boolean; runSteps: number },
        currentTick: number,
    ): void {
        this.movementService.updateRunEnergy(player, activity, currentTick);
    }

    private deriveAttackTypeFromStyle(
        style: number | undefined,
        attacker?: PlayerState,
    ): AttackType {
        return this.playerCombatService.deriveAttackTypeFromStyle(style, attacker);
    }

    private ensureEquipArray(p: PlayerState): number[] {
        return this.equipmentService.ensureEquipArray(p);
    }


    private getPlayerSaveKey(name: string | undefined, id: number): string {
        return buildPlayerSaveKey(name, id);
    }

    private getEquippedItemIds(p: PlayerState): number[] {
        return this.equipmentService.getEquippedItemIds(p);
    }

    private refreshAppearanceKits(p: PlayerState): void {
        this.appearanceService.refreshAppearanceKits(p);
    }

    private loadAnimSetFromBas(loader: () => BasType | undefined): PlayerAnimSet | undefined {
        return this.appearanceService.loadAnimSetFromBas(loader);
    }


    private guessBasIdForAppearance(
        appearance: { gender?: number } | undefined,
    ): number | undefined {
        return this.appearanceService.guessBasIdForAppearance(appearance);
    }

    private resolveAnimForAppearance(appearance: { gender?: number } | undefined): PlayerAnimSet {
        const gender = appearance?.gender === 1 ? 1 : 0;
        const genderFallback =
            gender === 1
                ? this.defaultPlayerAnimFemale ?? this.defaultPlayerAnim
                : this.defaultPlayerAnimMale ?? this.defaultPlayerAnim;

        const basId = this.guessBasIdForAppearance(appearance);
        if (basId !== undefined) {
            const fromBas = this.loadAnimSetFromBas(() => this.basTypeLoader!.load(basId));
            if (fromBas) return ensureCorePlayerAnimSet(fromBas, genderFallback);
        }
        return ensureCorePlayerAnimSet(genderFallback, this.defaultPlayerAnim);
    }


    private loadWeaponData(): void {
        this.appearanceService.loadWeaponData();
        this.weaponData = this.appearanceService.getWeaponData();
        this.weaponAnimOverrides = this.appearanceService.getWeaponAnimOverrides();
    }

    private loadSpecialAttackCacheData(enumTypeLoader: EnumTypeLoader): void {
        this.combatDataService.loadSpecialAttackCacheData(enumTypeLoader);
    }

    private getWeaponSpecialCostPercent(weaponItemId: number): number | undefined {
        return this.combatDataService.getWeaponSpecialCostPercent(weaponItemId);
    }


    private applyWeaponAnimOverrides(
        p: PlayerState,
        animTarget: Record<string, number | undefined>,
    ): void {
        this.appearanceService.applyWeaponAnimOverrides(p, animTarget);
    }

    private refreshCombatWeaponCategory(p: PlayerState): {
        categoryChanged: boolean;
        weaponItemChanged: boolean;
    } {
        return this.equipmentService.refreshCombatWeaponCategory(p);
    }

    private resetAutocast(p: PlayerState): void {
        this.equipmentService.resetAutocast(p);
    }

    private buildAnimPayload(p: PlayerState): PlayerAnimSet | undefined {
        return this.appearanceService.buildAnimPayload(p);
    }

    private applyInteractionIndex<T extends Record<string, unknown>>(
        payload: T,
        interactionIndex?: number,
    ): T {
        if (interactionIndex !== undefined && interactionIndex >= 0) {
            (payload as any).interactingIndex = interactionIndex;
        } else {
            (payload as any).interactingIndex = undefined;
        }
        return payload;
    }

    private attachInteractionPayload<T extends Record<string, unknown>>(
        player: PlayerState,
        payload: T,
        interactionIndex?: number,
    ): T {
        try {
            const resolvedIndex = interactionIndex ?? player.getInteractionIndex();
            return this.applyInteractionIndex(payload, resolvedIndex);
        } catch {
            return this.applyInteractionIndex(payload, interactionIndex);
        }
    }

    private sendAnimUpdate(ws: WebSocket, p: PlayerState): void {
        this.appearanceService.sendAnimUpdate(p);
    }

    private getDefaultBodyKits(gender: number): number[] {
        return this.appearanceService.getDefaultBodyKits(gender);
    }

    private getObjType(itemId: number): ObjType | undefined {
        return this.dataLoaderService.getObjType(itemId);
    }

    private queuePlayerGameMessage(player: PlayerState, text: string | undefined): void {
        this.messagingService.queuePlayerGameMessage(player, text);
    }

    private resolveEquipSlot(itemId: number): number | undefined {
        return this.equipmentService.resolveEquipSlot(itemId);
    }

    // Item-specific actions (e.g., Prayer burying) are implemented via the scripts runtime.

    /**
     * @deprecated Use player.addItem() directly instead (RSMod parity).
     * This method is kept for backward compatibility with existing service callbacks.
     */
    private addItemToInventory(
        p: PlayerState,
        itemId: number,
        quantity: number,
    ): InventoryAddResult {
        return this.inventoryService.addItemToInventory(p, itemId, quantity);
    }


    private sendInventorySnapshot(ws: WebSocket, p: PlayerState): void {
        this.inventoryService.sendInventorySnapshot(ws, p);
    }

    private sendInventorySnapshotImmediate(ws: WebSocket, p: PlayerState): void {
        this.inventoryService.sendInventorySnapshotImmediate(ws, p);
    }

    private sendInventorySnapshotImmediate(ws: WebSocket, p: PlayerState): void {
        this.inventoryService.sendInventorySnapshotImmediate(ws, p);
    }

    /**
     * Send the collection log inventory (620) snapshot to a player.
     * Converts the player's collectionObtained map to slot format.
     */


    private sendSkillsSnapshotImmediate(
        ws: WebSocket,
        player: PlayerState,
        update?: SkillSyncUpdate,
    ): void {
        this.skillService.sendSkillsSnapshotImmediate(ws, player, update);
    }
    private sendSkillsMessage(ws: WebSocket, player: PlayerState, update?: SkillSyncUpdate): void {
        const sync = update ?? player.takeSkillSync();
        if (!sync) return;
        this.skillService.queueSkillSnapshot(player.id, sync);
    }

    private sendCombatState(ws: WebSocket, player: PlayerState): void {
        this.queueCombatSnapshot(
            player.id,
            player.combatWeaponCategory,
            player.combatWeaponItemId,
            !!player.autoRetaliate,
            player.combatStyleSlot,
            Array.from(player.activePrayers ?? []),
            player.combatSpellId > 0 ? player.combatSpellId : undefined,
        );
    }


    private equipItem(
        p: PlayerState,
        slotIndex: number,
        itemId: number,
        equipSlot: number,
        opts?: { playSound?: boolean },
    ): { ok: boolean; reason?: string; categoryChanged: boolean; weaponItemChanged: boolean } {
        return this.equipmentService.equipItem(p, slotIndex, itemId, equipSlot, opts);
    }

    private consumeItem(p: PlayerState, slotIndex: number): boolean {
        return this.inventoryService.consumeItem(p, slotIndex);
    }


    private findOwnedItemLocation(
        player: PlayerState,
        itemId: number,
    ): OwnedItemLocation | undefined {
        return this.inventoryService.findOwnedItemLocation(player, itemId);
    }

    private countInventoryItem(player: PlayerState, itemId: number): number {
        return this.inventoryService.countInventoryItem(player, itemId);
    }

    private awardSkillXp(player: PlayerState, skillId: SkillId, xp: number): void {
        this.skillService.awardSkillXp(player, skillId, xp);
    }

    private handleSpellCastOnItem(
        ws: WebSocket,
        payload: {
            spellbookGroupId?: number;
            widgetChildId?: number;
            selectedSpellWidgetId?: number;
            selectedSpellChildIndex?: number;
            selectedSpellItemId?: number;
            spellId?: number;
            slot: number;
            itemId: number;
            widgetId?: number;
        },
    ): void {
        this.spellCastingService.handleSpellCastOnItem(ws, payload);
    }

    private sendSpellFailure(player: PlayerState, spellId: number, reason: string): void {
        this.spellCastingService.sendSpellFailure(player, spellId, reason);
    }

    private enqueueLevelUpPopup(player: PlayerState, popup: LevelUpPopup): void {
        this.interfaceManager.enqueueLevelUpPopup(player, popup);
    }

    /**
     * OSRS parity: Level-up popups do not hard-block gameplay; the chatbox modal should be
     * dismissed when the player initiates another action (walk, attack, etc.).
     */
    private dismissLevelUpPopupQueue(playerIdRaw: number): boolean {
        return this.interfaceManager.dismissLevelUpPopupQueue(playerIdRaw);
    }

    /**
     * OSRS parity: Close all interfaces that should be interrupted by damage or movement.
     * Called when:
     * - Player takes combat damage (NPC or PvP hits)
     * - Player initiates movement (walk click)
     * - Player starts a new interaction (NPC click, attack, etc.)
     * - Player teleports
     *
     * NOTE: Passive damage (poison, venom, disease) does NOT close interfaces.
     * Those effects are processed in PlayerState.processPoison/processVenom/processDisease
     * and intentionally bypass this method to match OSRS behavior.
     */
    private closeInterruptibleInterfaces(player: PlayerState): void {
        const playerId = player.id;

        // 1. Close tracked modal interfaces through the canonical widget runtime.
        const closedEntries = player.widgets.closeModalInterfaces();

        // 2. Run interface close hooks for tracked lifecycle entries.
        if (this.interfaceService && closedEntries.length > 0) {
            this.interfaceService.triggerCloseHooksForEntries(player, closedEntries);
        }

        // 3. Clear level-up popup queue
        this.dismissLevelUpPopupQueue(playerId);

        // 4. Close all open dialogs (NPC dialog, options, etc.)
        this.widgetDialogHandler.closeAllPlayerDialogs(player);
        this.cs2ModalManager.clearPlayerState(player);
    }

    /**
     * OSRS parity: Check if player has a modal dialog open (level-up, etc.)
     * that should pause skill action execution.
     */
    hasModalOpen(playerId: number): boolean {
        return this.interfaceManager.hasModalOpen(playerId);
    }

    /**
     * OSRS parity: Interrupt/cancel all queued skill actions for a player.
     * Called when player walks, starts a new interaction, teleports, etc.
     */
    private interruptPlayerSkillActions(playerId: number): void {
        this.interfaceManager.interruptPlayerSkillActions(playerId);
    }

    private advanceLevelUpPopupQueue(player: PlayerState): void {
        this.interfaceManager.advanceLevelUpPopupQueue(player);
    }


    private handleLoginMessage(ws: WebSocket, payload: any): void {
        this.loginHandshakeService.handleLoginMessage(ws, payload);
    }


    private handleHandshakeMessage(ws: WebSocket, payload: any): void {
        this.loginHandshakeService.handleHandshakeMessage(ws, payload);
    }


    private onConnection(ws: WebSocket) {
        this.loginHandshakeService.onConnection(ws);
    }


    private ensurePlayerSyncSession(ws: WebSocket): PlayerSyncSession {
        let session = this.playerSyncSessions.get(ws);
        if (!session) {
            session = new PlayerSyncSession();
            this.playerSyncSessions.set(ws, session);
        }
        return session;
    }

    private getOrCreateNpcSyncSession(ws: WebSocket): NpcSyncSession {
        let session = this.npcSyncSessions.get(ws);
        if (!session) {
            session = new NpcSyncSession();
            this.npcSyncSessions.set(ws, session);
        }
        return session;
    }

    private serializeAppearancePayload(
        view: import("./encoding/types").PlayerViewSnapshot,
    ): Uint8Array {
        // Use binary encoding matching Player.read()
        // This includes equipment, kits, colors, animation sequences, etc.
        const player = this.players?.getById(view.id);
        return encodeAppearanceBinary(view, {
            combatLevel: player?.combatLevel ?? 3,
            skillLevel: player?.skillTotal ?? 32,
            isHidden: false,
            actions: ["", "", ""],
        });
    }


    private broadcastToNearby(
        x: number,
        y: number,
        level: number,
        radius: number,
        message: string | Uint8Array,
        context = "broadcast_nearby",
    ): void {
        if (!this.players) return;
        const broadcastRadius = Math.max(0, radius);
        this.players.forEach((sock, player) => {
            if (!sock || sock.readyState !== WebSocket.OPEN) return;
            if (player.level !== level) return;
            const dx = Math.abs(player.tileX - x);
            const dy = Math.abs(player.tileY - y);
            if (Math.max(dx, dy) > broadcastRadius) return;
            this.networkLayer.sendWithGuard(sock, message, context);
        });
    }

    private pickAttackSequence(player: PlayerState): number {
        return this.playerCombatService.pickAttackSequence(player);
    }


    private pickSpellSound(spellId: number, stage: "cast" | "impact" | "splash"): number | undefined {
        return this.playerCombatService.pickSpellSound(spellId, stage);
    }

    private pickHitDelay(player: PlayerState): number {
        return this.playerCombatService.pickHitDelay(player);
    }

    private resolveBaseAttackSpeed(player: PlayerState): number {
        return this.playerCombatService.resolveBaseAttackSpeed(player);
    }

    private pickAttackSpeed(player: PlayerState): number {
        return this.playerCombatService.pickAttackSpeed(player);
    }

    private getPlayerAttackReach(player: PlayerState): number {
        return this.playerCombatService.getPlayerAttackReach(player);
    }


    pickNpcAttackSpeed(npc: NpcState, _player?: PlayerState): number {
        return this.combatEffectService.pickNpcAttackSpeed(npc, _player);
    }

    pickNpcHitDelay(npc: NpcState, _player: PlayerState, _attackSpeed: number): number {
        return this.combatEffectService.pickNpcHitDelay(npc, _player, _attackSpeed);
    }

    private getNpcCombatSequences(typeId: number): {
        block?: number;
        attack?: number;
        death?: number;
    } {
        return this.combatDataService.getNpcCombatSequences(typeId);
    }


    private getNpcDeathSoundId(typeId: number): number | undefined {
        return this.combatDataService.getNpcDeathSoundId({ typeId } as any);
    }

    private getNpcAttackSoundId(typeId: number): number {
        return this.combatDataService.getNpcAttackSoundId({ typeId } as any);
    }

    private getNpcHitSoundId(typeId: number): number | undefined {
        return this.combatDataService.getNpcHitSoundId({ typeId } as any);
    }

    private getNpcDefendSoundId(typeId: number): number | undefined {
        return this.combatDataService.getNpcDefendSoundId({ typeId } as any);
    }

    private queueExternalNpcTeleportSync(npc: NpcState): void {
        const delta = buildTeleportNpcUpdateDelta(npc);
        if (this.activeFrame) {
            upsertNpcUpdateDelta(this.activeFrame.npcUpdates, delta);
            return;
        }
        upsertNpcUpdateDelta(this.pendingNpcUpdates, delta);
    }

    /**
     * Process binary packet converted to ClientToServer message format
     */

    private broadcast(msg: string | Uint8Array, context = "broadcast") {
        for (const client of this.wss.clients) {
            this.networkLayer.sendWithGuard(client, msg, context);
        }
    }
}
