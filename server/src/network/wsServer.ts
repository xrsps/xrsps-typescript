import JavaRandom from "java-random";
import { performance } from "perf_hooks";
import { WebSocket, WebSocketServer } from "ws";
import { config } from "../config";

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
import { MAX_REAL_LEVEL, SkillId, getSkillName } from "../../../src/rs/skill/skills";
import { faceAngleRs } from "../../../src/rs/utils/rotation";
import {
    MODIFIER_FLAG_CTRL,
    MODIFIER_FLAG_CTRL_SHIFT,
} from "../../../src/shared/input/modifierFlags";
import type { ProjectileLaunch } from "../../../src/shared/projectiles/ProjectileLaunch";
import { PLAYER_CHEST_OFFSET_UNITS } from "../../../src/shared/projectiles/projectileHeights";
import { resolveSelectedSpellPayload } from "../../../src/shared/spells/selectedSpellPayload";
import { ACCOUNT_SUMMARY_GROUP_ID } from "../../../src/shared/ui/accountSummary";
import { MUSIC_GROUP_ID } from "../../../src/shared/ui/music";
import {
    SIDE_JOURNAL_CONTENT_GROUP_BY_TAB,
    SIDE_JOURNAL_GROUP_ID,
    SIDE_JOURNAL_TAB_CONTAINER_UID,
    decodeSideJournalTabFromStateVarp,
} from "../../../src/shared/ui/sideJournal";
import {
    MUSIC_UNLOCK_VARPS,
    VARBIT_ACCOUNT_TYPE,
    VARBIT_ARCEUUS_FAVOR,
    VARBIT_ARCEUUS_SPELLBOOK_UNLOCKED,
    VARBIT_AUTOCAST_DEFMODE,
    VARBIT_AUTOCAST_SET,
    VARBIT_AUTOCAST_SPELL,
    VARBIT_CLIENT_OF_KOUREND,
    VARBIT_IBAN_BOOK_READ,
    VARBIT_IN_LMS,
    VARBIT_IN_RAID,
    VARBIT_IN_WILDERNESS,
    VARBIT_MAGE_ARENA_2_PROGRESS,
    VARBIT_MULTICOMBAT_AREA,
    VARBIT_MUSIC_UNLOCK_TEXT_TOGGLE,
    VARBIT_PVP_SPEC_ORB,
    VARBIT_RAID_STATE,
    VARBIT_SIDE_JOURNAL_TAB,
    VARBIT_XPDROPS_ENABLED,
    VARP_AREA_SOUNDS_VOLUME,
    VARP_ATTACK_STYLE,
    VARP_AUTO_RETALIATE,
    VARP_BIOHAZARD,
    VARP_COMBAT_TARGET_PLAYER_INDEX,
    VARP_DESERT_TREASURE,
    VARP_EADGAR_QUEST,
    VARP_FOLLOWER_INDEX,
    VARP_LAST_HOME_TELEPORT,
    VARP_LAST_MINIGAME_TELEPORT,
    VARP_LEGENDS_QUEST,
    VARP_LUNAR_DIPLOMACY,
    VARP_MAGE_ARENA,
    VARP_MAP_FLAGS_CACHED,
    VARP_MASTER_VOLUME,
    VARP_MUSICPLAY,
    VARP_MUSIC_CURRENT_TRACK,
    VARP_MUSIC_VOLUME,
    VARP_OPTION_ATTACK_PRIORITY_NPC,
    VARP_OPTION_ATTACK_PRIORITY_PLAYER,
    VARP_OPTION_RUN,
    VARP_PLAGUE_CITY,
    VARP_SIDE_JOURNAL_STATE,
    VARP_SOUND_EFFECTS_VOLUME,
    VARP_SPECIAL_ATTACK,
    VARP_UNDERGROUND_PASS,
    VARP_WATCHTOWER,
    XPDROPS_TRANSMIT_VARPS,
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
import { getProjectileParams } from "../data/projectileParams";
import type { ProjectileParams } from "../data/projectileParams";
import {
    type SpellDataEntry,
    canWeaponAutocastSpell,
    getAutocastCompatibilityMessage,
    getSpellData,
    getSpellDataByWidget,
} from "../data/spells";
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
import { DEBUG_PLAYER_IDS, RUN_ENERGY_MAX } from "../game/actor";
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
    resolveNpcAttackRange as resolveNpcAttackRangeRule,
    resolveNpcAttackType as resolveNpcAttackTypeRule,
    resolvePlayerAttackReach,
    resolvePlayerAttackType,
} from "../game/combat/CombatRules";
import { getMeleeAttackSequenceForCategory } from "../game/combat/CombatStyleSequences";
import {
    type AttackType as CombatXpAttackType,
    type StyleMode,
    calculateCombatXp,
} from "../game/combat/CombatXp";
import type { DamageType, DropEligibility } from "../game/combat/DamageTracker";
import {
    HITMARK_BLOCK,
    HITMARK_DAMAGE,
    HITMARK_HEAL,
    HITMARK_REGEN,
} from "../game/combat/HitEffects";
import {
    getWildernessLevel,
    isInLMS,
    isInPvPArea,
    isInRaid,
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
import { DropRollService } from "../game/drops/DropRollService";
import { NpcDropRegistry } from "../game/drops/NpcDropRegistry";
import { getEmoteSeq } from "../game/emotes";
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
import {
    resolveLocExamineText,
    resolveNpcExamineText,
    resolveObjExamineText,
} from "../game/interactions/ExamineText";
import { deriveInteractionIndex } from "../game/interactions/InteractionViewBuilder";
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
import { createLootPickupNotification } from "../game/notifications/LootPickupNotification";
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
import {
    FiremakingTracker,
    TINDERBOX_ITEM_IDS,
} from "../game/skills/firemaking";
import {
    buildFishingSpotMap,
    getFishingSpotById,
} from "../game/skills/fishing";
import type {
    FishingSpotDefinition,
    FishingToolDefinition,
} from "../game/skills/fishing";
import { FlaxPatchTracker } from "../game/skills/flaxPatchTracker";
import {
    MiningNodeTracker,
    buildMiningLocMap,
    buildMiningTileKey,
    getMiningRockById,
} from "../game/skills/mining";
import type {
    MiningLocMapping,
    MiningRockDefinition,
    PickaxeDefinition,
} from "../game/skills/mining";
import {
    WoodcuttingNodeTracker,
    buildWoodcuttingLocMap,
    buildWoodcuttingTileKey,
    getWoodcuttingTreeById,
} from "../game/skills/woodcutting";
import type {
    HatchetDefinition,
    Vec2,
    WoodcuttingTreeDefinition,
} from "../game/skills/woodcutting";
import { SpellCastContext, SpellCaster } from "../game/spells/SpellCaster";
import { PlayerPersistence } from "../game/state/PlayerPersistence";
import { buildPlayerSaveKey, normalizePlayerAccountName } from "../game/state/PlayerSessionKeys";
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
import { CollisionFlag } from "../pathfinding/legacy/pathfinder/flag/CollisionFlag";
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
import { loadVisibleLocTypeForPlayer, locCanResolveToId } from "../world/LocTransforms";
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
import {
    type MessageHandlerServices,
    registerMessageHandlers as registerExtractedHandlers,
} from "./MessageHandlers";
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
    LEVELUP_COMBAT_COMPONENT,
    LEVELUP_CONTINUE_COMPONENT,
    LEVELUP_INTERFACE_ID,
    LEVELUP_SKILL_COMPONENT_BY_SKILL,
    LEVELUP_TEXT1_COMPONENT,
    LEVELUP_TEXT2_COMPONENT,
} from "./levelUpDisplay";
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

const EQUIP_SLOT_COUNT = 14;
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
const ADMIN_CROWN_ICON = 1; // Jagex moderator crown icon id.
const ADMIN_USERNAMES_ENV = (
    process?.env?.ADMIN_USERNAMES ??
    process?.env?.ADMIN_PLAYERS ??
    process?.env?.ADMIN_NAMES ??
    "lol,bot"
).toString();
const ADMIN_USERNAMES = new Set(
    ADMIN_USERNAMES_ENV.split(",")
        .map((value) => value.trim().toLowerCase())
        .filter((value) => value.length > 0),
);
// DAT2 ObjType param for weapon attack speed (ticks per attack).
// Verified via cache anchors: whip=4, godsword=6, dragon dagger=4.
const WEAPON_SPEED_PARAM = 14;
const DEFAULT_ATTACK_SPEED = 4;
const EQUIPMENT_STATS_GROUP_ID = 84;
const EQUIPMENT_STATS_ATTACK_CHILD_BY_INDEX = [24, 25, 26, 27, 28] as const;
const EQUIPMENT_STATS_DEFENCE_CHILD_BY_INDEX = [30, 31, 32, 33, 34] as const;
const EQUIPMENT_STATS_OTHER_CHILD_BY_INDEX = [36, 37, 38, 39] as const;
const EQUIPMENT_STATS_TARGET_UNDEAD_CHILD = 41;
const EQUIPMENT_STATS_TARGET_SLAYER_CHILD = 42;
const EQUIPMENT_STATS_WEAPON_SPEED_BASE_CHILD = 53;
const EQUIPMENT_STATS_WEAPON_SPEED_ACTUAL_CHILD = 54;
const EQUIPMENT_STATS_BONUS_COUNT = 14;
const EQUIPMENT_STATS_SALVE_MELEE_PERCENT = ((7 / 6 - 1) * 100) as number;
const EQUIPMENT_STATS_SALVE_IMBUED_PERCENT = EQUIPMENT_STATS_SALVE_MELEE_PERCENT;
const EQUIPMENT_STATS_SALVE_ENCHANTED_PERCENT = 20;
const EQUIPMENT_STATS_SLAYER_MELEE_PERCENT = ((7 / 6 - 1) * 100) as number;
const EQUIPMENT_STATS_SLAYER_IMBUED_PERCENT = 15;
const ITEM_ID_SALVE_AMULET = 4081;
const ITEM_ID_SALVE_AMULET_E = 10588;
const ITEM_ID_SALVE_AMULET_I = 12017;
const ITEM_ID_SALVE_AMULET_EI = 12018;
const SLAYER_HELM_IDS = new Set<number>([
    8901, // Black mask
    11864, // Slayer helmet
    19639, // Black slayer helmet
    19643, // Green slayer helmet
    19647, // Red slayer helmet
    21264, // Purple slayer helmet
    21888, // Turquoise slayer helmet
    23073, // Hydra slayer helmet
    24370, // Twisted slayer helmet
    25898, // Tztok slayer helmet
    25904, // Vampyric slayer helmet
    25910, // Tzkal slayer helmet
]);
const IMBUED_SLAYER_HELM_IDS = new Set<number>([
    11774, // Black mask (i)
    11865, // Slayer helmet (i)
    19641, // Black slayer helmet (i)
    19645, // Green slayer helmet (i)
    19649, // Red slayer helmet (i)
    21266, // Purple slayer helmet (i)
    21890, // Turquoise slayer helmet (i)
    23075, // Hydra slayer helmet (i)
    24444, // Twisted slayer helmet (i)
    25900, // Tztok slayer helmet (i)
    25906, // Vampyric slayer helmet (i)
    25912, // Tzkal slayer helmet (i)
]);
const DEFAULT_ATTACK_SEQ = 422;
const DEFAULT_BLOCK_SEQ = 424;
// RSMod default NPC death animation (human_death)
const DEFAULT_NPC_DEATH_SEQ = 836;
// OSRS synth id for human_death (used as a fixed fallback when not defined per-NPC)
const DEFAULT_NPC_DEATH_SOUND = 512;
const MAGIC_CAST_SEQ = 711; // Standard magic casting animation (human_caststrike)
const MAGIC_CAST_STAFF_SEQ = 1162; // Magic casting with staff (human_caststrike_staff)
const SPELL_CAST_SEQUENCE_OVERRIDES: Record<number, number> = {
    3274: 1163, // Confuse
    3278: 1164, // Weaken
    3282: 1165, // Curse
    3325: 1168, // Enfeeble
    3326: 1169, // Stun
    3293: 724, // Crumble Undead
    9075: 725, // Superheat Item
    9110: 712, // Low Alchemy
    9111: 713, // High Alchemy
    9100: 723, // Telekinetic Grab
    9076: 726, // Charge Air Orb
    9077: 726, // Charge Earth Orb
    9078: 726, // Charge Fire Orb
    9079: 726, // Charge Water Orb
    9001: 722, // Bones to Bananas
};

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
const COMBAT_SOUND_DELAY_MS = 50; // Small delay to ensure hitsplat renders before sound plays
const DEFAULT_HIT_SOUND = 1979; // Generic blade hit sound

// Shop/Bank group IDs imported from interface hooks
const SMITHING_GROUP_ID = 312;
const SMITHING_BAR_TYPE_VARBIT_ID = 3216;

const RANGED_WEAPON_CATEGORY_IDS = new Set([3, 5, 6, 7, 8, 19]);
const MAGIC_WEAPON_CATEGORY_IDS = new Set([18, 24, 29, 31]);
const PROTECTION_PRAYER_MAP: Record<AttackType, PrayerName> = {
    melee: "protect_from_melee",
    ranged: "protect_from_missiles",
    magic: "protect_from_magic",
};
// OSRS: Protection prayers block 100% damage from most NPCs
// Note: Bosses and some special attacks may partially ignore protection prayers
const NPC_PROTECTION_REDUCTION = 1.0;
// OSRS: Protection prayers reduce PvP damage by 40%
const PVP_PROTECTION_REDUCTION = 0.4;
const DEFAULT_MISS_SOUND = 2564; // Generic block/miss sound
// Unarmed (no weapon equipped): style-specific hit sounds.
const UNARMED_KICK_SOUND = 2565; // unarmed_kick
const UNARMED_PUNCH_SOUND = 2566; // unarmed_punch
const NPC_ATTACK_SOUND = 2549; // Generic NPC attack sound
const PLAYER_TAKE_DAMAGE_SOUND = 510;
const PLAYER_ZERO_DAMAGE_SOUND = 511;
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
const TEST_HIT_FORCE = TEST_HIT_FORCE_RAW ? parseFloat(TEST_HIT_FORCE_RAW) : undefined;
const testRng: JavaRandom | null =
    TEST_RNG_SEED !== undefined && Number.isFinite(TEST_RNG_SEED)
        ? new JavaRandom(TEST_RNG_SEED)
        : null;
function testRandFloat(): number {
    if (TEST_HIT_FORCE !== undefined && TEST_HIT_FORCE >= 0) return 0; // will be overridden by force damage
    if (testRng?.nextFloat) {
        try {
            return testRng.nextFloat();
        } catch {}
    }
    return Math.random();
}

const CONSUME_VERBS = ["eat", "drink", "quaff", "sip", "imbibe", "swig", "consume", "devour", "activate"];
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
    smithingMessages: Array<{ playerId: number; payload: SmithingServerPayload }>;
    tradeMessages: Array<{ playerId: number; payload: TradeServerPayload }>;
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

// Level-up UI/effects (OSRS parity)
// Interface 233 (LEVELUP_DISPLAY) is opened into the chatbox interface (162).
// References:
// - Runelite: InterfaceID.LEVELUP_DISPLAY = 233
// - RSMod: CHATBOX_CHILD = 561 (doesn't exist in our cache)
// - RuneLite: MES_LAYER (38) = 0x00a2_0026
const CHATBOX_GROUP_ID = 162;
const CHATBOX_CHILD_ID = 567; // CHATMODAL - where dialogs mount in this cache revision
const VARBIT_CHATMODAL_UNCLAMP = 10670;
const CHATBOX_RESET_SCRIPT_ID = 2379;
const OBJECTBOX_INTERFACE_ID = 193;
const HUNTER_LEVELUP_ICON_ITEM_ID = 9951;
// Runelite: SpotanimID.LEVELUP_ANIM = 199
const LEVELUP_SPOT_ID = 199;
const LEVELUP_99_SPOT_ID = 1388;

// OSRS parity: Level-up jingle IDs from musicJingles index (index 11)
// These are the short fanfares that play on level-up
// Standard level-up jingle (fallback for levels 2-98)
const LEVELUP_JINGLE_ID = 29;
// Level 99 jingle (special fanfare for max level)
const LEVELUP_99_JINGLE_ID = 30;
// Combat level-up jingle
const LEVELUP_COMBAT_JINGLE_ID = 54;
// OSRS parity: the jingle packet carries an unused 3-byte delay field.
const LEVELUP_JINGLE_DELAY = 0;
// Level-up firework sound effect (plays with spotanim)
// Reference: osrs-synths.json ID 2396 = "firework"
const LEVELUP_FIREWORK_SOUND = 2396;

// OSRS parity: Skill-specific level-up jingles (from osrs-jingles.json)
// Each skill has its own unique jingle fanfare
const LEVELUP_JINGLE_BY_SKILL: Partial<Record<number, number>> = {
    [SkillId.Agility]: 31,
    [SkillId.Attack]: 32,
    [SkillId.Construction]: 33,
    [SkillId.Cooking]: 34,
    [SkillId.Crafting]: 35,
    [SkillId.Defence]: 36,
    [SkillId.Farming]: 37,
    [SkillId.Firemaking]: 38,
    [SkillId.Fishing]: 39,
    [SkillId.Fletching]: 40,
    [SkillId.Herblore]: 41,
    [SkillId.Hitpoints]: 42,
    [SkillId.Hunter]: 43,
    [SkillId.Magic]: 44,
    [SkillId.Mining]: 45,
    [SkillId.Prayer]: 46,
    [SkillId.Ranged]: 47,
    [SkillId.Runecraft]: 48,
    [SkillId.Slayer]: 49,
    [SkillId.Smithing]: 50,
    [SkillId.Strength]: 51,
    [SkillId.Thieving]: 52,
    [SkillId.Woodcutting]: 53,
    // Sailing uses default jingle (29) - no unique jingle exists
};

type LevelUpPopup =
    | { kind: "skill"; skillId: number; newLevel: number; levelIncrement: number }
    | { kind: "combat"; newLevel: number; levelIncrement: number };

function pickSpecialAttackVisualOverride(
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
    private readonly defaultBodyKitCache = new Map<number, number[]>();
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
    private weaponWarningsLogged = new Set<number>(); // Track weapons we've already warned about
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
    private woodcuttingLocMap: Map<number, string> = new Map();
    private miningLocMap: Map<number, MiningLocMapping> = new Map();
    private fishingSpotMap: Map<number, string> = new Map();
    private gatheringSystem!: GatheringSystemManager;
    private equipmentHandler!: EquipmentHandler;
    private tickOrchestrator!: TickPhaseOrchestrator;
    private broadcastScheduler = new BroadcastScheduler();
    private messageRouter!: MessageRouter;

    // Backward-compatible getters for gathering trackers
    private get woodcuttingTracker() {
        return this.gatheringSystem?.woodcuttingTracker;
    }
    private get miningTracker() {
        return this.gatheringSystem?.miningTracker;
    }
    private get firemakingTracker() {
        return this.gatheringSystem?.firemakingTracker;
    }
    private get flaxTracker() {
        return this.gatheringSystem?.flaxTracker;
    }

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
    private readonly pendingLoginNames = new WeakMap<WebSocket, string>();
    private projectileSystem!: ProjectileSystem;
    private pendingWalkCommands = new Map<WebSocket, PendingWalkCommand>();
    private pendingDirectSends = new Map<
        WebSocket,
        { message: string | Uint8Array; context: string }
    >();
    private isBroadcastPhase = false;
    private readonly widgetOpenLedgerByPlayer = new Map<number, PlayerWidgetOpenLedger>();
    /** Message batch queue per WebSocket for batching during broadcast phase */
    private messageBatches = new Map<WebSocket, Uint8Array[]>();
    /** Enable message batching during broadcast phase */
    private enableMessageBatching = true;
    private directSendBypassDepth = 0;
    private levelUpPopupQueue = new Map<number, LevelUpPopup[]>();
    private directSendWarningContexts = new Set<string>();
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
    private npcDropRegistry?: NpcDropRegistry;
    private npcDropRollService?: DropRollService;
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

    // Login rate limiting
    private loginAttempts = new Map<string, { count: number; resetTime: number }>();
    private readonly MAX_LOGIN_ATTEMPTS = 5;
    private readonly LOGIN_ATTEMPT_WINDOW_MS = 60000; // 1 minute

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
            this.performScheduledAction(player, action, tick),
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
        let cacheFactory: any = undefined;
        try {
            const env = opts.cacheEnv ?? initCacheEnv("caches");
            this.cacheEnv = env;
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
            } catch {}
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
            } catch {}
            try {
                npcTypeLoader = cacheFactory.getNpcTypeLoader?.();
                this.npcTypeLoader = npcTypeLoader;
            } catch {}
            try {
                this.seqTypeLoader = cacheFactory.getSeqTypeLoader?.();
            } catch {}
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
                          } catch {}
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

            try {
                const woodcutting = buildWoodcuttingLocMap(locTypeLoader);
                this.woodcuttingLocMap = woodcutting.map;
                logger.info(
                    `[woodcutting] mapped ${this.woodcuttingLocMap.size} loc id(s) to tree types`,
                );
            } catch (err) {
                logger.warn("[woodcutting] failed to build loc map", err);
            }
            try {
                const mining = buildMiningLocMap(locTypeLoader);
                this.miningLocMap = mining.map;
                logger.info(`[mining] mapped ${this.miningLocMap.size} loc id(s) to rock types`);
            } catch (err) {
                logger.warn("[mining] failed to build loc map", err);
            }
        }
        if (npcTypeLoader) {
            try {
                const fishing = buildFishingSpotMap(npcTypeLoader);
                this.fishingSpotMap = fishing.map;
                logger.info(
                    `[fishing] mapped ${this.fishingSpotMap.size} npc type(s) to fishing spots`,
                );
            } catch (err) {
                logger.warn("[fishing] failed to build npc fishing map", err);
            }
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

        // Register interface lifecycle hooks
        registerDialogInterfaceHooks(this.interfaceService);
        registerCollectionLogInterfaceHooks(this.interfaceService);

        this.groundItems = new GroundItemManager({
            defaultDurationTicks: GROUND_ITEM_DESPAWN_TICKS,
            defaultPrivateTicks: GROUND_ITEM_PRIVATE_TICKS,
        });
        this.spawnDebugGroundItemStack();
        this.scriptRuntime = new ScriptRuntime({
            registry: this.scriptRegistry,
            scheduler: this.scriptScheduler,
            logger,
            services: this.buildScriptServiceObject(locTypeLoader, combatEffectApplicator),
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
                        this.queueVarp(
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
                            this.broadcastNpcSequence(companion, attackSeq);
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
                    this.attemptTakeGroundItem(
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
            } catch {}
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
            this.npcPacketEncoder = this.createNpcPacketEncoder();
            // Initialize PlayerPacketEncoder
            this.playerPacketEncoder = this.createPlayerPacketEncoder();
            // Initialize CombatActionHandler
            this.combatActionHandler = this.createCombatActionHandler();
            // Initialize SpellActionHandler
            this.spellActionHandler = this.createSpellActionHandler();
            // Initialize InventoryActionHandler
            this.inventoryActionHandler = this.createInventoryActionHandler();
            // Initialize EffectDispatcher
            this.effectDispatcher = this.createEffectDispatcher();
            // Initialize WidgetDialogHandler
            this.widgetDialogHandler = this.createWidgetDialogHandler();
            // Initialize CS2 modal manager
            this.cs2ModalManager = this.createCs2ModalManager();
            // Initialize NpcSyncManager
            this.npcSyncManager = this.createNpcSyncManager();
            // Initialize PlayerAppearanceManager
            this.playerAppearanceManager = this.createPlayerAppearanceManager();
            // Initialize SoundManager
            this.soundManager = this.createSoundManager();
            // Initialize GroundItemHandler
            this.groundItemHandler = this.createGroundItemHandler();
            // Initialize PlayerDeathService
            this.playerDeathService = this.createPlayerDeathService();
            // Initialize ProjectileSystem
            this.projectileSystem = this.createProjectileSystem();
            // Initialize GatheringSystemManager
            this.gatheringSystem = this.createGatheringSystem();
            // Initialize EquipmentHandler
            this.equipmentHandler = this.createEquipmentHandler();
            // SmithingSystem is now managed by the vanilla-skills/production extrascript
            // Initialize TickPhaseOrchestrator
            this.tickOrchestrator = this.createTickOrchestrator();
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
        this.loadWeaponData();
        if (this.cacheEnv) {
            try {
                this.dbRepository = new DbRepository(this.cacheEnv.cacheSystem as any);
                this.combatCategoryData = new CombatCategoryData(this.dbRepository);
                this.npcSoundLookup = new NpcSoundLookup(this.dbRepository);
                this.npcSoundLookup.initialize();
                this.musicCatalogService = new MusicCatalogService(this.dbRepository);
                this.musicRegionService = new MusicRegionService();
                this.musicUnlockService = new MusicUnlockService(this.musicCatalogService);
            } catch (err) {
                logger.warn("[combat] failed to load combat category data", err);
            }
        }
        if (cacheFactory) {
            try {
                this.objTypeLoader = cacheFactory.getObjTypeLoader();
            } catch {}
            try {
                this.idkTypeLoader = cacheFactory.getIdkTypeLoader();
            } catch {}
            // Store cache loaders for systems that still use enum/struct lookups
            let enumTypeLoader: any;
            let structTypeLoader: any;
            try {
                enumTypeLoader = cacheFactory.getEnumTypeLoader?.();
            } catch {}
            try {
                structTypeLoader = cacheFactory.getStructTypeLoader?.();
            } catch {
                // StructTypeLoader may not be available
            }
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
                        this.queueVarp(playerId, varpId, value),
                    queueVarbit: (playerId, varbitId, value) =>
                        this.queueVarbit(playerId, varbitId, value),
                    queueNotification: (playerId, notification) =>
                        this.queueNotification(playerId, notification),
                    queueWidgetEvent: (playerId, event) =>
                        this.queueWidgetEvent(playerId, event),
                    queueClientScript: (playerId, scriptId, ...args) =>
                        this.queueClientScript(playerId, scriptId, ...args),
                    sendGameMessage: (player, text) =>
                        this.sendGameMessageToPlayer(player, text),
                },
                serverServices: this.buildGamemodeServerServices(),
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
                        this.queueVarp(playerId, varpId, value),
                    queueVarbit: (playerId, varbitId, value) =>
                        this.queueVarbit(playerId, varbitId, value),
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
        } catch {}

        this.wss.on("connection", (ws) => this.onConnection(ws));

        // Broadcast ticks to all connected clients
        opts.ticker.on("tick", (data) => this.handleTick(data));
    }

    private withDirectSendBypass<T>(context: string, fn: () => T): T {
        this.directSendBypassDepth++;
        try {
            return fn();
        } finally {
            this.directSendBypassDepth = Math.max(0, this.directSendBypassDepth - 1);
        }
    }

    // ========== Login Validation Helpers ==========

    /**
     * Check if an IP address has exceeded the login attempt rate limit.
     * Returns true if rate limited (should block login).
     */
    private checkLoginRateLimit(ip: string): boolean {
        const now = Date.now();
        const entry = this.loginAttempts.get(ip);

        if (!entry || now >= entry.resetTime) {
            // First attempt or window expired - reset counter
            this.loginAttempts.set(ip, { count: 1, resetTime: now + this.LOGIN_ATTEMPT_WINDOW_MS });
            return false;
        }

        // Increment counter
        entry.count++;

        // Check if exceeded
        if (entry.count > this.MAX_LOGIN_ATTEMPTS) {
            return true;
        }

        return false;
    }

    /**
     * Check if a player with the given username already has an active session.
     */
    private isPlayerAlreadyLoggedIn(username: string): boolean {
        if (!this.players) return false;
        return this.players.hasConnectedPlayer(username);
    }

    /**
     * Check if the world is at capacity.
     */
    private isWorldFull(): boolean {
        if (!this.players) return false;
        // MAX_SYNC_PLAYER_ID = 2047 is the theoretical max
        return this.players.getTotalPlayerCount() >= 2047;
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
            } catch {}

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
        } catch {}
    }

    private assertDirectSendAllowed(context: string): void {
        if (this.isBroadcastPhase || this.directSendBypassDepth > 0) return;
        if (this.directSendWarningContexts.has(context)) return;
        this.directSendWarningContexts.add(context);
        logger.warn(`[direct-send] ${context} invoked outside broadcast phase`);
    }

    private sendWithGuard(
        sock: WebSocket | undefined,
        message: string | Uint8Array,
        context: string,
    ): void {
        if (!sock || sock.readyState !== WebSocket.OPEN) return;
        this.assertDirectSendAllowed(context);

        // During broadcast phase, batch binary messages for a single send at the end
        if (this.enableMessageBatching && this.isBroadcastPhase && message instanceof Uint8Array) {
            let batch = this.messageBatches.get(sock);
            if (!batch) {
                batch = [];
                this.messageBatches.set(sock, batch);
            }
            batch.push(message);
            return;
        }

        try {
            sock.send(message);
        } catch (err) {
            logger.warn(`[direct-send] send failed (${context})`, err);
        }
    }

    /**
     * Flush all batched messages for a WebSocket as a single concatenated binary packet
     */
    private flushMessageBatch(sock: WebSocket): void {
        const batch = this.messageBatches.get(sock);
        if (!batch || batch.length === 0) return;

        this.messageBatches.delete(sock);

        if (sock.readyState !== WebSocket.OPEN) return;

        try {
            if (batch.length === 1) {
                // Single message, no need to concatenate
                sock.send(batch[0]);
            } else {
                // Concatenate all messages into a single buffer
                const totalLength = batch.reduce((sum, msg) => sum + msg.length, 0);
                const combined = new Uint8Array(totalLength);
                let offset = 0;
                for (const msg of batch) {
                    combined.set(msg, offset);
                    offset += msg.length;
                }
                sock.send(combined);
            }
        } catch (err) {
            logger.warn(`[batch-send] flush failed`, err);
        }
    }

    /**
     * Flush all pending message batches for all sockets
     */
    private flushAllMessageBatches(): void {
        for (const sock of this.messageBatches.keys()) {
            this.flushMessageBatch(sock);
        }
        this.messageBatches.clear();
    }

    private sendAdminResponse(ws: WebSocket, message: string | Uint8Array, context: string): void {
        this.withDirectSendBypass(context, () => this.sendWithGuard(ws, message, context));
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
        if (this.directSendWarningContexts.size === 0) return;
        const contexts = Array.from(this.directSendWarningContexts);
        this.directSendWarningContexts.clear();
        const summary = `[direct-send] contexts outside broadcast phase during ${stage}: ${contexts.join(
            ", ",
        )}`;
        const strictEnv = process.env.DIRECT_SEND_GUARD_STRICT;
        const shouldThrow =
            strictEnv === "1" ||
            (strictEnv !== "0" && (process.env.NODE_ENV ?? "development") !== "production");
        if (shouldThrow) {
            throw new Error(summary);
        }
        logger.error(summary);
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
        if (frame.smithingMessages.length > 0) {
            this.broadcastScheduler.restoreSmithingMessages(frame.smithingMessages);
        }
        if (frame.tradeMessages.length > 0) {
            this.broadcastScheduler.restoreTradeMessages(frame.tradeMessages);
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
        const oldTile = opts?.oldTile ?? tile;
        const newTile = opts?.newTile ?? tile;
        const payload: LocChangePayload = {
            oldId: oldId,
            newId: newId,
            tile: { x: tile.x, y: tile.y }, // backward compat
            level: level,
            oldTile: { x: oldTile.x, y: oldTile.y },
            newTile: { x: newTile.x, y: newTile.y },
            oldRotation: opts?.oldRotation,
            newRotation: opts?.newRotation,
            newShape: opts?.newShape,
        };
        try {
            this.doorManager?.observeLocChange({
                oldId: payload.oldId,
                newId: payload.newId,
                level: payload.level,
                oldTile: payload.oldTile,
                newTile: payload.newTile,
            });
        } catch (err) {
            logger.warn("[Door] Failed to observe loc change for runtime mapping capture", err);
        }
        try {
            this.dynamicLocState.observeLocChange({
                oldId: payload.oldId,
                newId: payload.newId,
                level: payload.level,
                oldTile: payload.oldTile,
                newTile: payload.newTile,
                oldRotation: payload.oldRotation,
                newRotation: payload.newRotation,
            });
        } catch (err) {
            logger.warn("[loc] Failed to update dynamic loc state store", err);
        }
        // Keep loc-change delivery tick-aligned like other frame events:
        // queue into the active frame during logic phases; during broadcast or outside
        // the tick frame, stage for next tick instead of mutating an in-flight frame.
        if (this.activeFrame && !this.isBroadcastPhase) {
            this.activeFrame.locChanges.push(payload);
            return;
        }
        if (this.activeFrame) {
            this.broadcastScheduler.queueLocChange(payload);
            return;
        }

        const msg = encodeMessage({
            type: "loc_change",
            payload,
        });
        this.withDirectSendBypass("loc_change", () => this.broadcast(msg, "loc_change"));
    }

    /**
     * Send a loc_change to a single player only.
     * Does NOT update doorManager/dynamicLocState — used for per-player multiloc
     * visual refreshes driven by varbits.
     */
    private sendLocChangeToPlayer(
        player: PlayerState,
        oldId: number,
        newId: number,
        tile: { x: number; y: number },
        level: number,
    ): void {
        const payload: LocChangePayload = {
            oldId,
            newId,
            tile: { x: tile.x, y: tile.y },
            level,
            oldTile: { x: tile.x, y: tile.y },
            newTile: { x: tile.x, y: tile.y },
        };
        const ws = this.players?.getSocketByPlayerId(player.id);
        if (!ws) return;
        const msg = encodeMessage({ type: "loc_change", payload });
        this.withDirectSendBypass("loc_change_player", () =>
            this.sendWithGuard(ws, msg, "loc_change"),
        );
    }

    private spawnLocForPlayer(
        player: PlayerState,
        locId: number,
        tile: { x: number; y: number },
        level: number,
        shape: number,
        rotation: number,
    ): void {
        const ws = this.players?.getSocketByPlayerId(player.id);
        if (!ws) return;
        const msg = encodeMessage({
            type: "loc_add_change",
            payload: { locId, tile, level, shape, rotation },
        } as any);
        this.withDirectSendBypass("loc_add_change", () =>
            this.sendWithGuard(ws, msg, "loc_add_change"),
        );
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
                this.sendWithGuard(
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
        const smithingMessages = this.broadcastScheduler.drainSmithingMessages();
        const tradeMessages = this.broadcastScheduler.drainTradeMessages();
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
            smithingMessages,
            tradeMessages,
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
        if (this.npcManager) {
            try {
                const playerLookup = (id: number) => this.players?.getById(id) as any;
                const activeNpcIds = new Set<number>();
                if (this.players) {
                    this.players.forEach((_client, player) => {
                        // Only simulate NPCs near active players.
                        this.npcManager?.collectNearbyIds(
                            player.tileX,
                            player.tileY,
                            player.level,
                            NPC_SIM_RADIUS_TILES,
                            activeNpcIds,
                        );
                    });
                }
                this.followerManager?.addActiveNpcIds(activeNpcIds);
                this.followerManager?.tick(frame.tick);
                this.followerCombatManager?.tick(frame.tick);

                // OSRS NPC Aggression: Update player aggression states each tick
                // This handles the 10-minute tolerance timer and position tracking
                if (this.players) {
                    this.players.forEach((_client, player) => {
                        // Check if player is in wilderness (NPCs never become tolerant)
                        const inWilderness = isInWilderness(player.tileX, player.tileY);
                        player.updateAggressionState(frame.tick, inWilderness);
                    });
                }

                // OSRS NPC Aggression: Provide nearby player data for aggression checks
                const getNearbyPlayers = (
                    tileX: number,
                    tileY: number,
                    level: number,
                    radius: number,
                ) => {
                    const nearbyPlayers: Array<{
                        id: number;
                        x: number;
                        y: number;
                        level: number;
                        combatLevel: number;
                        inCombat: boolean;
                        aggressionState: {
                            entryTick: number;
                            aggressionExpired: boolean;
                            tile1: { x: number; y: number };
                            tile2: { x: number; y: number };
                        };
                    }> = [];
                    if (this.players) {
                        this.players.forEach((_client, player) => {
                            // Check if player is on the same plane
                            if (player.level !== level) return;
                            // Check if player is within radius (Chebyshev distance)
                            const dx = Math.abs(player.tileX - tileX);
                            const dy = Math.abs(player.tileY - tileY);
                            const distance = Math.max(dx, dy);
                            if (distance > radius) return;
                            nearbyPlayers.push({
                                id: player.id,
                                x: player.tileX,
                                y: player.tileY,
                                level: player.level,
                                combatLevel: player.combatLevel,
                                // OSRS single-combat: player is "in combat" if attacking OR being attacked
                                inCombat: player.isAttacking() || player.isBeingAttacked(),
                                aggressionState: player.getAggressionState(frame.tick),
                            });
                        });
                    }
                    return nearbyPlayers;
                };

                const npcTickResult = this.npcManager.tick(
                    frame.tick,
                    playerLookup,
                    activeNpcIds,
                    getNearbyPlayers,
                );
                frame.npcEffectEvents = npcTickResult.statusEvents;

                // Process NPC aggression events - schedule attacks on target players
                for (const aggroEvent of npcTickResult.aggressionEvents) {
                    this.scheduleNpcAggressionAttack(
                        aggroEvent.npcId,
                        aggroEvent.targetPlayerId,
                        frame.tick,
                    );
                }

                const emittedNpcUpdates = this.npcManager.consumeUpdates();
                if (frame.npcUpdates.length === 0) {
                    frame.npcUpdates = emittedNpcUpdates;
                } else if (emittedNpcUpdates.length > 0) {
                    const mergedByNpcId = new Map<number, NpcUpdateDelta>();
                    for (const update of emittedNpcUpdates) {
                        mergedByNpcId.set(update.id, { ...update });
                    }
                    for (const pending of frame.npcUpdates) {
                        const existing = mergedByNpcId.get(pending.id);
                        if (!existing) {
                            mergedByNpcId.set(pending.id, { ...pending });
                            continue;
                        }
                        mergedByNpcId.set(pending.id, {
                            ...existing,
                            ...pending,
                            directions:
                                pending.directions !== undefined
                                    ? pending.directions
                                    : existing.directions,
                            traversals:
                                pending.traversals !== undefined
                                    ? pending.traversals
                                    : existing.traversals,
                        });
                    }
                    frame.npcUpdates = Array.from(mergedByNpcId.values());
                }
                // Collect NPC color overrides (consumed once, shared across all observers)
                this.npcManager.forEach((npc) => {
                    if (npc.consumeColorOverrideDirty()) {
                        const co = npc.getColorOverride();
                        if (co && co.amount > 0) {
                            frame.npcColorOverrides.set(npc.id, co);
                        }
                    }
                });

                if (this.players) {
                    this.players.forEach((_client, player) => {
                        this.npcSyncManager.updateNpcViewForPlayer(player);
                    });
                }
            } catch (err) {
                logger.warn("[NpcManager] tick error", err);
            }
        }
        if (!this.players) return;
        this.flushPendingWalkCommands(frame.tick, "pre");
        this.movementSystem?.runPreMovement(frame.tick);
    }

    /**
     * Schedule an NPC aggression attack on a player.
     * This is similar to retaliation but initiated by the NPC targeting a player.
     */
    private scheduleNpcAggressionAttack(
        npcId: number,
        targetPlayerId: number,
        currentTick: number,
    ): void {
        const player = this.players?.getById(targetPlayerId);
        if (!player) return;

        const npc = this.npcManager?.getById(npcId);
        if (!npc || npc.isDead?.(currentTick)) return;

        // Schedule the NPC attack using the retaliate action mechanism
        // The handler will compute damage, animations, etc.
        const result = this.actionScheduler.requestAction(
            player.id,
            {
                kind: "combat.npcRetaliate",
                data: {
                    npcId: npc.id,
                    phase: "swing",
                    // Let the handler compute damage/style
                    isAggression: true, // Flag to indicate this is aggression, not retaliation
                },
                groups: ["combat.npcAggro"],
                cooldownTicks: 0,
                delayTicks: 0,
            },
            currentTick,
        );

        if (!result.ok) {
            logger.debug?.(
                `[aggression] failed to schedule NPC attack (npc=${npcId}, player=${targetPlayerId}): ${result.reason}`,
            );
        }
    }

    private flushPendingWalkCommands(currentTick: number, stage: "pre" | "movement" = "pre"): void {
        if (!this.players || this.pendingWalkCommands.size === 0) return;
        for (const [sock, command] of Array.from(this.pendingWalkCommands.entries())) {
            const handled = this.routeOrRejectWalkCommand(sock, command, currentTick, stage);
            if (handled) {
                this.pendingWalkCommands.delete(sock);
            }
        }
    }

    private routeOrRejectWalkCommand(
        sock: WebSocket,
        command: PendingWalkCommand,
        currentTick: number,
        context: "pre" | "movement" | "immediate",
    ): boolean {
        if (!this.players) return false;
        const player = this.players.get(sock);
        const isDebug = player && DEBUG_PLAYER_IDS.has(player.id);

        // Check if player can move before doing anything
        if (player && !player.canMove()) {
            return false;
        }

        // OSRS parity: Moving dismisses all interruptible interfaces (modals, dialogs, level-ups).
        if (player) {
            this.closeInterruptibleInterfaces(player);
        }

        // RSMod parity: Walking resets all interactions (combat, NPC talk, follow, etc.)
        // This is equivalent to RSMod's ClickMapHandler calling client.resetInteractions()
        if (player) {
            player.interruptQueues();
            player.resetInteractions();
        }
        // Also clear the interaction system's internal state map
        this.players.clearAllInteractions(sock);

        const res = this.players.routePlayer(sock, command.to, command.run, currentTick);
        if (!res?.ok) {
            const wait = currentTick - command.enqueuedTick;
            const delayInfo = Number.isFinite(wait) ? ` (delay=${wait}t)` : "";
            if (isDebug) {
                logger.info(
                    `[movement] walk rejected (${context}): ${
                        res?.message || "no path"
                    }${delayInfo}`,
                );
            }
            if (res?.message === "movement_locked") {
                this.queueChatMessage({
                    messageType: "game",
                    text: "A magical force stops you from moving.",
                    targetPlayerIds: [this.players?.get(sock)?.id ?? 0].filter((id) => id > 0),
                });
            }
        } else {
            const wait = currentTick - command.enqueuedTick;
            if (isDebug) {
                if (wait > 0) {
                    logger.info(`[movement] walk accepted (${context}) delay=${wait}t`);
                } else if (context === "immediate") {
                    logger.info("[movement] walk accepted (immediate)");
                }
            }
            if (player && res.destinationCorrection) {
                const corrected = res.destinationCorrection;
                this.withDirectSendBypass("destination_correction", () =>
                    this.sendWithGuard(
                        sock,
                        encodeMessage({
                            type: "destination",
                            payload: {
                                worldX: corrected.x,
                                worldY: corrected.y,
                            },
                        }),
                        "destination_correction",
                    ),
                );
            }
            // Debug: send the server-computed path segment to the client so it can be compared
            // against the client-side movement queue in the browser console.
            if (isDebug && player) {
                try {
                    const dest = player.getWalkDestination();
                    const steps = player.getPathQueue() as { x: number; y: number }[];
                    const message = dest
                        ? `walk segment dest=(${dest.x},${dest.y}) run=${!!dest.run}`
                        : "walk segment";
                    this.queueDirectSend(
                        sock,
                        encodeMessage({
                            type: "path",
                            payload: {
                                id: -1000 - player.id,
                                ok: true,
                                waypoints: Array.isArray(steps)
                                    ? steps.map((t) => ({ x: t.x, y: t.y }))
                                    : [],
                                message,
                            },
                        }),
                        "walk_path_debug",
                    );
                } catch {}
            }
        }
        return true;
    }

    private runMovementPhase(frame: TickFrame): void {
        if (!this.players) return;
        const players = this.players!;
        const npcs = this.npcManager;
        this.flushPendingWalkCommands(frame.tick, "movement");
        const playerLookup = (id: number) => players.getById(id);
        const npcLookup = (npcId: number) => npcs?.getById(npcId);
        const entries: Array<{ sock: any; player: PlayerState }> = [];
        players.forEach((sock, player) => entries.push({ sock, player }));

        // OSRS parity: Players must be processed in PID order (ascending)
        // Reference: docs/tick-cycle-order.md
        entries.sort((a, b) => a.player.getPidPriority() - b.player.getPidPriority());

        // Pass A: update state and enqueue/refresh paths for this tick (but do not consume steps yet).
        // OSRS parity: Player tick order is Queue → Timers → Area queue → Movement → Combat
        // Reference: docs/game-engine.md lines 31-42
        for (const { sock, player } of entries) {
            players.applyInteractionFacing(sock, player, npcLookup, frame.tick);

            // 1. Process queued actions FIRST (before timers)
            // Ensure any deferred movement is part of the path before reservations are computed.
            player.processDeferredMovement();
            player.processTimersAndQueue();

            try {
                const hadPath = player.hasPath();
                const walkUpdate = players.continueWalkToDestination(player, frame.tick);
                if (walkUpdate?.destinationCorrection) {
                    const corrected = walkUpdate.destinationCorrection;
                    this.withDirectSendBypass("destination_correction_repath", () =>
                        this.sendWithGuard(
                            sock,
                            encodeMessage({
                                type: "destination",
                                payload: {
                                    worldX: corrected.x,
                                    worldY: corrected.y,
                                },
                            }),
                            "destination_correction_repath",
                        ),
                    );
                }
                // Debug: if a new segment was enqueued (long-distance walking), send it to the client.
                if (!hadPath && player.hasPath() && DEBUG_PLAYER_IDS.has(player.id)) {
                    try {
                        const dest = player.getWalkDestination();
                        const steps = player.getPathQueue() as {
                            x: number;
                            y: number;
                        }[];
                        const message = dest
                            ? `walk segment (repath) dest=(${dest.x},${dest.y}) run=${!!dest.run}`
                            : "walk segment (repath)";
                        this.queueDirectSend(
                            sock,
                            encodeMessage({
                                type: "path",
                                payload: {
                                    id: -2000 - player.id,
                                    ok: true,
                                    waypoints: Array.isArray(steps)
                                        ? steps.map((t) => ({ x: t.x, y: t.y }))
                                        : [],
                                    message,
                                },
                            }),
                            "walk_path_debug_repath",
                        );
                    } catch {}
                }
            } catch {}

            // 2. Process timers AFTER queue (OSRS parity: Queue → Timers)
            const statusHits = this.statusEffects.processPlayer(player, frame.tick);
            if (statusHits && statusHits.length > 0) {
                for (const event of statusHits) {
                    if (!(event.amount > 0)) continue;
                    frame.hitsplats.push({
                        targetType: "player",
                        targetId: player.id,
                        damage: event.amount,
                        style: event.style,
                        sourceType: "status",
                        hpCurrent: event.hpCurrent,
                        hpMax: event.hpMax,
                    });
                }
            }
            const prayerTick = this.prayerSystem.processPlayer(player);
            if (prayerTick?.prayerDepleted) {
                this.handlePrayerDepleted(player);
            }
        }

        // Bots also participate in move reservations; apply deferred movement before peeking queues.
        players.forEachBot((bot) => bot.processDeferredMovement());

        // Resolve 1-2 sub-step reservations after all paths are finalized for this tick.
        players.resolveMoveReservations();

        // Pass B: consume steps and build snapshots.
        for (const { sock, player } of entries) {
            player.setMovementTick(frame.tick);
            const moved = player.tickStep();
            const steps = player.drainStepPositions() as StepRecord[] | undefined;

            // FIX: Removed pendingImmediateSteps handling (part of desync fix)
            // All movement now goes through normal tick broadcast only
            if (steps && steps.length > 0) {
                frame.playerSteps.set(player.id, steps);
            }
            const summary = this.summarizeSteps(player, steps);
            const interactionState = players.getInteractionState(sock);
            const interactionIndex = deriveInteractionIndex({
                player,
                interaction: interactionState,
                playerLookup,
                npcLookup,
            });
            frame.interactionIndices.set(player.id, interactionIndex);

            // Collect pending color override
            if (player.consumeColorOverrideDirty()) {
                const co = player.getColorOverride();
                if (co && co.amount > 0) {
                    frame.colorOverrides.set(player.id, co);
                }
            }

            this.updateRunEnergy(
                player,
                { ran: summary.ran, moved, runSteps: summary.runSteps },
                frame.tick,
            );

            if (player.hasRunEnergyUpdate()) {
                this.queueRunEnergySnapshot(player);
            }

            // OSRS parity: Send wilderness level updates via CS2 script 388 (pvp_icons_wildernesslevel)
            // This displays the "Level: X Wilderness" overlay when in the wilderness
            // Note: player.x/y are in sub-tile units (128 per tile), convert to tile coordinates
            const tileX = player.x / 128;
            const tileY = player.y / 128;
            const currentWildyLevel = getWildernessLevel(tileX, tileY);
            const previousWildyLevel = player._lastWildernessLevel ?? 0;

            if (currentWildyLevel !== previousWildyLevel) {
                player._lastWildernessLevel = currentWildyLevel;

                // PVP interface (90) container: toplevel_osrs_stretch:pvp_icons = (161 << 16) | 3
                const PVP_INTERFACE_ID = 90;
                const PVP_ICONS_CONTAINER_UID = (161 << 16) | 3;
                // pvp_icons:wildernesslevel component = (90 << 16) | 50 = 5898290
                const WILDERNESS_LEVEL_WIDGET_UID = (90 << 16) | 50;

                if (currentWildyLevel > 0 && previousWildyLevel === 0) {
                    // Entering wilderness - open pvp interface into container
                    // The interface's onLoad script (865, pvp_icons_layout_init) handles
                    // visibility of deadman/skull elements via pvp_icons_layout proc (386)
                    this.queueWidgetEvent(player.id, {
                        action: "open_sub",
                        targetUid: PVP_ICONS_CONTAINER_UID,
                        groupId: PVP_INTERFACE_ID,
                        type: 1, // overlay type
                    });
                    // Set varbit 5963 (in_wilderness) to 1
                    this.queueVarbit(player.id, VARBIT_IN_WILDERNESS, 1);
                } else if (currentWildyLevel === 0 && previousWildyLevel > 0) {
                    // Leaving wilderness - close pvp interface
                    this.queueWidgetEvent(player.id, {
                        action: "close_sub",
                        targetUid: PVP_ICONS_CONTAINER_UID,
                    });
                    // Set varbit 5963 (in_wilderness) to 0
                    this.queueVarbit(player.id, VARBIT_IN_WILDERNESS, 0);
                }

                // OSRS parity: Run script 388 to update wilderness level display
                // Script takes component UID and internally calls ~wilderness_level for the level
                if (currentWildyLevel > 0) {
                    this.queueClientScript(player.id, 388, WILDERNESS_LEVEL_WIDGET_UID);
                }
            }

            // OSRS parity: Track multi-combat zone changes and update varbit 4605
            const currentInMulti = multiCombatSystem.isMultiCombat(tileX, tileY, player.level);
            const previousInMulti = player._lastInMultiCombat ?? false;

            if (currentInMulti !== previousInMulti) {
                player._lastInMultiCombat = currentInMulti;
                // Set varbit 4605 (multicombat_area) - controls crossed swords icon visibility
                this.queueVarbit(player.id, VARBIT_MULTICOMBAT_AREA, currentInMulti ? 1 : 0);
            }

            // OSRS parity: Track PvP area state and update varbit 8121 (pvp_spec_orb)
            const currentInPvP = isInPvPArea(tileX, tileY, player.level);
            const previousInPvP = player._lastInPvPArea ?? false;

            if (currentInPvP !== previousInPvP) {
                player._lastInPvPArea = currentInPvP;
                // Set varbit 8121 (pvp_spec_orb) - affects spec orb visibility in PvP
                this.queueVarbit(player.id, VARBIT_PVP_SPEC_ORB, currentInPvP ? 1 : 0);
            }

            // OSRS parity: Track raid zone state and update varbit 5432 (in_raid)
            const currentInRaid = isInRaid(tileX, tileY, player.level);
            const previousInRaid = player._lastInRaid ?? false;

            if (currentInRaid !== previousInRaid) {
                player._lastInRaid = currentInRaid;
                // Set varbit 5432 (in_raid) - indicates player is in a raid instance
                this.queueVarbit(player.id, VARBIT_IN_RAID, currentInRaid ? 1 : 0);
                // Reset raid state when leaving raid
                if (!currentInRaid) {
                    this.queueVarbit(player.id, VARBIT_RAID_STATE, 0);
                }
            }

            // OSRS parity: Track LMS state and update varbit 5314 (in_lms)
            const currentInLMS = isInLMS(tileX, tileY, player.level);
            const previousInLMS = player._lastInLMS ?? false;

            if (currentInLMS !== previousInLMS) {
                player._lastInLMS = currentInLMS;
                // Set varbit 5314 (in_lms) - indicates player is in Last Man Standing
                this.queueVarbit(player.id, VARBIT_IN_LMS, currentInLMS ? 1 : 0);
            }

            player.tickSkillRestoration(frame.tick);
            let specialUpdated = player.tickSpecialEnergy(frame.tick);
            if (!specialUpdated && player.hasSpecialEnergyUpdate?.()) {
                specialUpdated = true;
            }

            if (specialUpdated) {
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
            const snap = player.wasTeleported() ?? false;
            const turned = player.didTurn() ?? false;
            const shouldSendMovement =
                summary.directions.length > 0 || snap || turned || player.shouldSendPos();
            if (shouldSendMovement) {
                player.markSent();
            }
            frame.playerViews.set(player.id, {
                id: player.id,
                x: summary.subX,
                y: summary.subY,
                level: summary.level,
                rot: summary.finalRot,
                orientation: summary.finalOrientation,
                running: summary.ran,
                name: this.getAppearanceDisplayName(player),
                appearance: player.appearance,
                interactionIndex: interactionIndex >= 0 ? interactionIndex : undefined,
                seq: summary.finalSeq,
                moved: moved || snap,
                turned,
                snap,
                directions: summary.directions.length > 0 ? summary.directions : undefined,
                traversals: summary.traversals.length > 0 ? summary.traversals : undefined,
                anim: this.buildAnimPayload(player),
                shouldSendPos: shouldSendMovement,
                worldViewId: player.worldViewId >= 0 ? player.worldViewId : undefined,
            });
            // OSRS parity: teleport flag is consumed by a single update and then cleared.
            if (snap) {
                try {
                    player.clearTeleportFlag();
                } catch {}
            }
            const skillUpdate = player.takeSkillSync();
            if (skillUpdate) {
                this.sendSkillsMessage(sock, player, skillUpdate);
            }
        }
        try {
            this.players.tickBots(frame.tick);
        } catch {}
        this.players.forEachBot((bot) => {
            const botSteps = bot.drainStepPositions() as StepRecord[] | undefined;
            if (botSteps && botSteps.length > 0) {
                frame.playerSteps.set(bot.id, botSteps);
            }
            const summary = this.summarizeSteps(bot, botSteps);
            const snap = bot.wasTeleported() ?? false;
            const moved = bot.didMove() ?? false;
            const turned = bot.didTurn() ?? false;
            try {
                this.updateRunEnergy(
                    bot,
                    { ran: summary.ran, moved, runSteps: summary.runSteps },
                    frame.tick,
                );
            } catch {}
            frame.playerViews.set(bot.id, {
                id: bot.id,
                x: summary.subX,
                y: summary.subY,
                level: summary.level,
                rot: summary.finalRot,
                orientation: summary.finalOrientation,
                running: summary.ran,
                name: this.getAppearanceDisplayName(bot),
                appearance: bot.appearance,
                seq: summary.finalSeq,
                moved: moved || snap,
                turned,
                snap,
                directions: summary.directions.length > 0 ? summary.directions : undefined,
                traversals: summary.traversals.length > 0 ? summary.traversals : undefined,
                anim: this.buildAnimPayload(bot),
                shouldSendPos: false,
            });
            if (snap) {
                try {
                    bot.clearTeleportFlag();
                } catch {}
            }
        });
        try {
            this.movementSystem?.runPostMovement(frame.tick);
        } catch {}
    }

    private runCombatPhase(frame: TickFrame): void {
        if (!this.players || !this.playerCombatManager) return;
        const combatResult = this.playerCombatManager.processTick({
            tick: frame.tick,
            npcLookup: (npcId) => this.npcManager?.getById(npcId),
            pathService: this.options.pathService,
            pickAttackSpeed: (player) => this.pickAttackSpeed(player),
            pickNpcHitDelay: (npc, player, attackSpeed) =>
                this.pickNpcHitDelay(npc, player, attackSpeed),
            getWeaponSpecialCostPercent: (weaponItemId) =>
                this.getWeaponSpecialCostPercent(weaponItemId),
            getAttackReach: (player) => this.getPlayerAttackReach(player),
            queueSpotAnimation: (event) => {
                this.enqueueSpotAnimation(event);
            },
            onMagicAttack: ({ player, npc, plan, tick }) =>
                this.spellActionHandler.handleAutocastMagicAttack({ player, npc, plan, tick }),
            logger,
        });
        for (const ended of combatResult.endedEngagements) {
            try {
                this.players?.finishNpcCombatByPlayerId(ended.playerId);
            } catch {}
        }
        frame.actionEffects = combatResult.effects;
        this.refreshInteractionFacing(frame);
        this.processGamemodeTickCallbacks(frame);
    }

    private refreshInteractionFacing(frame: TickFrame): void {
        if (!this.players) return;
        const players = this.players!;
        const playerLookup = (id: number) => players.getById(id);
        const npcLookup = (npcId: number) => this.npcManager?.getById(npcId);

        const updateView = (player: PlayerState, interactionIndex: number | undefined) => {
            frame.interactionIndices.set(player.id, interactionIndex ?? -1);
            const view = frame.playerViews.get(player.id);
            if (view) {
                const previousOrientation = view.orientation;
                const updatedOrientation = player.getOrientation() & 2047;
                view.orientation = updatedOrientation;
                view.interactionIndex =
                    interactionIndex !== undefined && interactionIndex >= 0
                        ? interactionIndex
                        : undefined;
                if (previousOrientation !== updatedOrientation) {
                    player.markSent();
                }
            }
        };

        const collectFaceTile = (player: PlayerState) => {
            if (player.pendingFaceTile) {
                const ft = player.pendingFaceTile;
                const targetX = (ft.x << 7) + 64;
                const targetY = (ft.y << 7) + 64;
                const dir = faceAngleRs(player.x, player.y, targetX, targetY) & 2047;
                frame.pendingFaceDirs.set(player.id, dir);
                player.pendingFaceTile = undefined;
            }
        };

        players.forEach((sock, player) => {
            try {
                players.applyInteractionFacing(sock, player, npcLookup);
            } catch {}
            collectFaceTile(player);
            const interactionState = players.getInteractionState(sock);
            const interactionIndex = deriveInteractionIndex({
                player,
                interaction: interactionState,
                playerLookup,
                npcLookup,
            });
            updateView(player, interactionIndex);
        });

        players.forEachBot((bot) => {
            const interactionState = (bot as any).botInteraction;
            collectFaceTile(bot);
            const interactionIndex = deriveInteractionIndex({
                player: bot,
                interaction: interactionState,
                playerLookup,
                npcLookup,
            });
            updateView(bot, interactionIndex);
        });
    }

    private processGamemodeTickCallbacks(frame: TickFrame): void {
        for (const callback of this.gamemodeTickCallbacks) {
            try {
                callback(frame.tick);
            } catch (err) {
                logger.warn("[gamemode-tick] Tick callback error", err);
            }
        }
    }

    /**
     * Check for region changes, unlock music tracks, and play area music if in Area mode.
     * OSRS parity: When player enters a new region and music mode is "Area" (varp 18 = 0),
     * the region's music track is played automatically. Additionally, entering a region
     * with music unlocks that track if not already unlocked.
     */
    private runMusicPhase(frame: TickFrame): void {
        this.soundManager.runMusicPhase(frame);
    }

    /**
     * Sync the music unlock varp to the client after unlocking a track.
     */
    private syncMusicUnlockVarps(player: PlayerState, trackId: number): void {
        this.soundManager.syncMusicUnlockVarps(player, trackId);
    }

    private getCombatTargetPlayerVarpValue(player: PlayerState): number {
        const target = player.getCombatTarget();
        if (!target || !target.isPlayer) {
            return -1;
        }
        return target.id & 0x7ff;
    }

    private syncCombatTargetPlayerVarp(player: PlayerState): void {
        const nextValue = this.getCombatTargetPlayerVarpValue(player);
        if ((player.getVarpValue(VARP_COMBAT_TARGET_PLAYER_INDEX) | 0) === (nextValue | 0)) {
            return;
        }

        player.setVarpValue(VARP_COMBAT_TARGET_PLAYER_INDEX, nextValue);
        this.queueVarp(player.id, VARP_COMBAT_TARGET_PLAYER_INDEX, nextValue);
    }

    private runScriptPhase(frame: TickFrame): void {
        this.scriptRuntime.queueTick(frame.tick);
        this.scriptScheduler.process(frame.tick);
    }

    private runDeathPhase(frame: TickFrame): void {
        // Process pending player deaths (tick down death animations, complete deaths)
        if (this.playerDeathService) {
            this.playerDeathService.tick();
        }
    }

    private runPostScriptPhase(frame: TickFrame): void {
        // Late input window to allow same-tick toggles (e.g., prayer flicking) before next tick drain.
        this.scriptScheduler.process(frame.tick);
    }

    private runPostEffectsPhase(frame: TickFrame): void {
        // Process all gathering skill respawns via the unified system
        if (this.gatheringSystem) {
            this.gatheringSystem.processTick(frame.tick);
        }
        this.groundItems.tick(frame.tick);
        if (frame.actionEffects.length > 0) {
            this.effectDispatcher.dispatchActionEffects(frame.actionEffects, frame);
        }
        if (this.players) {
            const nowMs = Date.now();
            this.players.forEach((_, player) => {
                this.accountSummary.syncPlayer(player, nowMs);
                this.gamemode.onPlayerTick?.(player, nowMs);
                this.reportGameTime.syncPlayer(player, nowMs);
                const seqData = player.popPendingSeq() as
                    | { seqId: number; delay: number }
                    | undefined;
                if (seqData && seqData.seqId >= -1) {
                    frame.pendingSequences.set(player.id, {
                        seqId: seqData.seqId,
                        delay: Math.max(0, seqData.delay),
                        startTick: frame.tick,
                    });
                    const view = frame.playerViews.get(player.id);
                    if (view) {
                        // Ensure the owning client receives the animation update even without movement.
                        view.shouldSendPos = true;
                    }
                }
                this.syncCombatTargetPlayerVarp(player);
                player.attackDelay = this.pickAttackSpeed(player);
            });
            this.players.forEachBot((bot) => {
                const seqData = bot.popPendingSeq() as { seqId: number; delay: number } | undefined;
                if (seqData && seqData.seqId >= 0) {
                    frame.pendingSequences.set(bot.id, {
                        seqId: seqData.seqId,
                        delay: Math.max(0, seqData.delay),
                        startTick: frame.tick,
                    });
                    const view = frame.playerViews.get(bot.id);
                    if (view) {
                        view.shouldSendPos = true;
                    }
                }
            });
        }
        this.tradeManager?.tick(frame.tick);
    }


    /**
     * Process orphaned players - players who disconnected while in combat.
     * Removes them when combat ends or max timeout is exceeded.
     */
    private runOrphanedPlayersPhase(frame: TickFrame): void {
        if (!this.players) return;

        this.players.processOrphanedPlayers(frame.tick, (player, saveKey) => {
            // Save player state when orphan expires
            try {
                this.playerPersistence.saveSnapshot(saveKey, player);
                logger.info(`[orphan] Saved and removed expired orphan: ${saveKey}`);
            } catch (err) {
                logger.warn(`[orphan] Failed to save expired orphan ${saveKey}:`, err);
            }
            this.followerCombatManager?.resetPlayer(player.id);
            this.followerManager?.despawnFollowerForPlayer(player.id, false);
            // Unregister from action scheduler
            this.actionScheduler.unregisterPlayer(player.id);
        });
    }

    private checkAndSendSnapshots(player: PlayerState, sock?: WebSocket): void {
        if (this.activeFrame) {
            // We are inside a tick logic phase. To avoid "direct-send" errors and ensure
            // OSRS-like consistency (updates at end of tick), we rely on dirty flags
            // which will be picked up by runBroadcastPhase at the end of the tick.
            return;
        }

        // We are handling an event outside of the tick loop (e.g. direct network message).
        // Send updates immediately for better responsiveness.
        const ws = sock ?? this.players?.getSocketByPlayerId(player.id);
        if (!ws || ws.readyState !== WebSocket.OPEN) return;

        if (player.hasInventoryUpdate()) {
            const snapshot = player.takeInventorySnapshot();
            if (snapshot) {
                // Send immediately instead of queueing
                this.sendInventorySnapshotImmediate(ws, player);
            }
        }
        if (player.hasAppearanceUpdate()) {
            // Don't call takeAppearanceSnapshot or send immediately.
            // Let the dirty flag remain so the normal tick-based player sync
            // handles it properly with the binary protocol.
        }
        if (player.hasCombatStateUpdate()) {
            player.takeCombatStateSnapshot();
            this.sendCombatState(ws, player);
        }
    }

    private sendInventorySnapshotImmediate(ws: WebSocket, p: PlayerState): void {
        const inv = this.getInventory(p);
        const slots = inv.map((entry, idx) => ({
            slot: idx,
            itemId: entry.itemId,
            quantity: entry.quantity,
        }));
        this.withDirectSendBypass("inventory_snapshot_immediate", () =>
            this.sendWithGuard(
                ws,
                encodeMessage({
                    type: "inventory",
                    payload: { kind: "snapshot", slots },
                } as any),
                "inventory_snapshot_immediate",
            ),
        );
    }

    private runBroadcastPhase(frame: TickFrame): void {
        // Final late-input drain: process widget/script actions that arrived after post-script
        // but before broadcast. This minimizes perceived UI latency for click-driven highlights.
        this.scriptScheduler.process(frame.tick);
        this.isBroadcastPhase = true;
        try {
            const ctx = this.buildBroadcastContext();
            // Flush any pending direct sends queued outside the broadcast phase
            if (this.pendingDirectSends.size > 0) {
                const entries = Array.from(this.pendingDirectSends.entries());
                this.pendingDirectSends.clear();
                for (const [ws, entry] of entries) {
                    try {
                        this.sendWithGuard(ws, entry.message, entry.context);
                    } catch {}
                }
            }
            // OSRS parity ordering - each broadcaster handles one domain:
            // 1. Loc changes (early, before any actor state)
            this.miscBroadcaster.flushLocChanges(frame, ctx);
            // 2. Skills (before combat visuals so XP drops fire first)
            this.skillBroadcaster.flush(frame, ctx);
            // 3. Combat: hitsplats, NPC effects, spot anims, combat snapshots
            this.combatBroadcaster.flush(frame, ctx);
            // 4. Actor sync: player sync + NPC sync + WorldEntity info
            this.actorSyncBroadcaster.flush(frame, ctx);
            // 5. Widget close events (before varps to prevent re-render flicker)
            this.widgetBroadcaster.flushCloseEvents(frame, ctx);
            // 6. Varps/varbits (before open widget events so scripts have correct state)
            this.varBroadcaster.flush(frame, ctx);
            // 7. Widget open/non-close events (after varps)
            this.widgetBroadcaster.flushOpenEvents(frame, ctx);
            // 8. Notifications, client scripts, smithing, trade, gamemode, run energy, spells, projectiles
            this.miscBroadcaster.flushPostWidgetEvents(frame, ctx);
            // 9. Chat messages
            this.chatBroadcaster.flush(frame, ctx);
            // 10. Inventory snapshots
            this.inventoryBroadcaster.flush(frame, ctx);
            // 11. Per-player dirty state flush (inventory, appearance, combat)
            this.flushPerPlayerDirtyState(frame);
            // 12. Animation snapshots (AFTER per-player loop so equipment change anims are included)
            this.flushAnimSnapshots(frame, ctx);
        } finally {
            // Flush all batched messages before ending broadcast phase
            this.flushAllMessageBatches();
            this.isBroadcastPhase = false;
            this.flushDirectSendWarnings("broadcast");
        }
    }

    private buildBroadcastContext(): BroadcastContext {
        const tickMs = Math.max(1, this.options.tickMs);
        return {
            sendWithGuard: (sock, msg, context) => this.sendWithGuard(sock, msg, context),
            broadcast: (msg, context) => this.broadcast(msg, context),
            getSocketByPlayerId: (id) => this.players?.getSocketByPlayerId(id),
            cyclesPerTick: Math.max(1, Math.round(tickMs / 20)),
        };
    }

    private applyAppearanceSnapshotsToViews(frame: TickFrame): void {
        if (!frame.appearanceSnapshots || frame.appearanceSnapshots.length === 0) return;
        for (const snapshot of frame.appearanceSnapshots) {
            const view = frame.playerViews.get(snapshot.playerId);
            if (view) {
                if (snapshot.payload.appearance) {
                    view.appearance = snapshot.payload.appearance;
                }
                if (snapshot.payload.snap) {
                    view.x = snapshot.payload.x;
                    view.y = snapshot.payload.y;
                    view.level = snapshot.payload.level;
                    view.snap = true;
                    view.moved = true;
                }
                if (snapshot.payload.anim) {
                    view.anim = snapshot.payload.anim;
                }
                if (snapshot.payload.worldViewId !== undefined) {
                    view.worldViewId = snapshot.payload.worldViewId;
                }
            }
        }
    }

    private buildAndSendActorSync(
        sock: WebSocket,
        player: PlayerState,
        frame: TickFrame,
        ctx: BroadcastContext,
    ): void {
        const session = this.ensurePlayerSyncSession(sock);
        const playerFrame: PlayerTickFrameData = {
            tick: frame.tick,
            tickMs: this.options.tickMs,
            playerViews: frame.playerViews,
            playerSteps: frame.playerSteps,
            hitsplats: frame.hitsplats,
            forcedChats: frame.forcedChats,
            forcedMovements: frame.forcedMovements,
            spotAnimations: frame.spotAnimations,
            chatMessages: frame.chatMessages,
            pendingSequences: frame.pendingSequences,
            interactionIndices: frame.interactionIndices,
            pendingFaceDirs: frame.pendingFaceDirs,
            colorOverrides: frame.colorOverrides,
        };
        const packet = this.playerPacketEncoder.buildPlayerSyncPacket(
            session,
            player,
            playerFrame,
        );
        session.activeIndices = packet.activeIndices;
        ctx.sendWithGuard(
            sock,
            encodeMessage({
                type: "player_sync",
                payload: {
                    baseX: packet.baseTileX,
                    baseY: packet.baseTileY,
                    localIndex: player.id,
                    loopCycle: frame.tick,
                    packet: Array.from(packet.bytes),
                },
            }),
            "player_sync",
        );

        if (this.enableBinaryNpcSync && this.npcManager) {
            try {
                const npcSession = this.getOrCreateNpcSyncSession(sock);
                const npcFrame = {
                    tick: frame.tick,
                    tickMs: this.options.tickMs,
                    npcUpdates: frame.npcUpdates,
                    hitsplats: frame.hitsplats,
                    npcEffectEvents: frame.npcEffectEvents,
                    spotAnimations: frame.spotAnimations,
                    colorOverrides: frame.npcColorOverrides,
                };
                const built = this.npcPacketEncoder.buildNpcSyncPacket(
                    player,
                    npcFrame,
                    npcSession,
                );
                if (built.packet.length > 0) {
                    ctx.sendWithGuard(
                        sock,
                        encodeMessage({
                            type: "npc_info",
                            payload: {
                                loopCycle: frame.tick,
                                large: built.large,
                                packet: Array.from(built.packet),
                            },
                        } as any),
                        "npc_info",
                    );
                }
            } catch (err) {
                logger.warn("[npc_info] encode failed", err);
            }
        }
        if (this.worldEntityInfoEncoder.needsUpdate(player.id)) {
            const wePacket = this.worldEntityInfoEncoder.encode(player.id);
            if (wePacket) {
                ctx.sendWithGuard(sock, wePacket, "worldentity_info");
            }
        }
    }

    private flushPerPlayerDirtyState(frame: TickFrame): void {
        if (!this.players) return;
        this.players.forEach((_, player) => {
            player.clearTeleportFlag();
        });
        this.players.forEachBot((bot) => {
            bot.clearTeleportFlag();
        });
        this.players.forEach((sock, player) => {
            this.maybeReplayDynamicLocState(sock, player);
        });
        this.players.forEach((sock, player) => {
            this.maybeSendGroundItemSnapshot(sock, player);
        });
        this.players.forEach((sock, player) => {
            if (player.hasInventoryUpdate()) {
                const snapshot = player.takeInventorySnapshot();
                if (snapshot) {
                    const inv = this.getInventory(player);
                    const slots = inv.map((entry, idx) => ({
                        slot: idx,
                        itemId: entry.itemId,
                        quantity: entry.quantity,
                    }));
                    this.sendWithGuard(
                        sock,
                        encodeMessage({
                            type: "inventory",
                            payload: { kind: "snapshot", slots },
                        } as any),
                        "inventory_snapshot",
                    );
                }
            }
            const appearanceDirty = player.hasAppearanceUpdate();
            if (appearanceDirty) {
                player.takeAppearanceSnapshot();
                this.queueAppearanceSnapshot(player);
                this.queueAnimSnapshot(player.id, this.buildAnimPayload(player));
            }
            const hasCombatUpdate = player.hasCombatStateUpdate();
            if (hasCombatUpdate) {
                player.takeCombatStateSnapshot();
                let specialEnergy: number | undefined;
                let specialActivated: boolean | undefined;
                let quickPrayers: string[] | undefined;
                let quickPrayersEnabled: boolean | undefined;
                try {
                    specialEnergy = player.getSpecialEnergyPercent();
                    specialActivated = player.isSpecialActivated();
                    player.markSpecialEnergySynced();
                    const quickSet = player.getQuickPrayers();
                    quickPrayers = Array.from(quickSet);
                    quickPrayersEnabled = player.areQuickPrayersEnabled();
                } catch {}
                this.sendWithGuard(
                    sock,
                    encodeMessage({
                        type: "combat",
                        payload: {
                            weaponCategory: player.combatWeaponCategory,
                            weaponItemId: player.combatWeaponItemId,
                            autoRetaliate: !!player.autoRetaliate,
                            activeStyle: player.combatStyleSlot,
                            activePrayers: Array.from(player.activePrayers ?? []),
                            activeSpellId:
                                player.combatSpellId > 0 ? player.combatSpellId : undefined,
                            specialEnergy,
                            specialActivated,
                            quickPrayers,
                            quickPrayersEnabled,
                        },
                    }),
                    "combat_state_dirty",
                );
            }
            if (
                (appearanceDirty || hasCombatUpdate) &&
                this.isWidgetGroupOpenInLedger(player.id, EQUIPMENT_STATS_GROUP_ID)
            ) {
                this.queueEquipmentStatsWidgetTexts(player);
            }
        });
    }

    private flushAnimSnapshots(frame: TickFrame, ctx: BroadcastContext): void {
        if (!frame.animSnapshots || frame.animSnapshots.length === 0) return;
        for (const snapshot of frame.animSnapshots) {
            const sock = ctx.getSocketByPlayerId(snapshot.playerId);
            ctx.sendWithGuard(
                sock,
                encodeMessage({ type: "anim", payload: snapshot.anim }),
                "anim_snapshot",
            );
        }
    }

    getScriptScheduler(): ScriptScheduler {
        return this.scriptScheduler;
    }

    private getOrCreateWidgetLedger(playerId: number): PlayerWidgetOpenLedger {
        const pid = playerId;
        let ledger = this.widgetOpenLedgerByPlayer.get(pid);
        if (!ledger) {
            ledger = {
                byTargetUid: new Map<number, number>(),
                targetUidsByGroup: new Map<number, Set<number>>(),
                directGroups: new Set<number>(),
            };
            this.widgetOpenLedgerByPlayer.set(pid, ledger);
        }
        return ledger;
    }

    private addOpenTargetToLedger(
        ledger: PlayerWidgetOpenLedger,
        targetUid: number,
        groupId: number,
    ) {
        const prevGroupId = ledger.byTargetUid.get(targetUid);
        if (prevGroupId !== undefined) {
            const prevSet = ledger.targetUidsByGroup.get(prevGroupId);
            prevSet?.delete(targetUid);
            if (prevSet && prevSet.size === 0) {
                ledger.targetUidsByGroup.delete(prevGroupId);
            }
        }
        ledger.byTargetUid.set(targetUid, groupId);
        let groupTargets = ledger.targetUidsByGroup.get(groupId);
        if (!groupTargets) {
            groupTargets = new Set<number>();
            ledger.targetUidsByGroup.set(groupId, groupTargets);
        }
        groupTargets.add(targetUid);
    }

    private removeOpenTargetFromLedger(ledger: PlayerWidgetOpenLedger, targetUid: number): void {
        const prevGroupId = ledger.byTargetUid.get(targetUid);
        if (prevGroupId === undefined) return;
        ledger.byTargetUid.delete(targetUid);
        const prevSet = ledger.targetUidsByGroup.get(prevGroupId);
        prevSet?.delete(targetUid);
        if (prevSet && prevSet.size === 0) {
            ledger.targetUidsByGroup.delete(prevGroupId);
        }
    }

    private removeOpenGroupFromLedger(ledger: PlayerWidgetOpenLedger, groupId: number): void {
        ledger.directGroups.delete(groupId);
        const targets = ledger.targetUidsByGroup.get(groupId);
        if (targets) {
            for (const targetUid of targets) {
                ledger.byTargetUid.delete(targetUid);
            }
            ledger.targetUidsByGroup.delete(groupId);
        }
    }

    private noteWidgetEventForLedger(playerId: number, action: WidgetAction): void {
        const ledger = this.getOrCreateWidgetLedger(playerId);
        switch (action.action) {
            case "open_sub":
                this.addOpenTargetToLedger(
                    ledger,
                    action.targetUid as number,
                    action.groupId as number,
                );
                break;
            case "close_sub":
                this.removeOpenTargetFromLedger(ledger, action.targetUid as number);
                break;
            case "open":
                ledger.directGroups.add(action.groupId);
                break;
            case "close":
                this.removeOpenGroupFromLedger(ledger, action.groupId);
                break;
            case "set_root":
                ledger.byTargetUid.clear();
                ledger.targetUidsByGroup.clear();
                ledger.directGroups.clear();
                break;
            default:
                break;
        }
    }

    private isWidgetGroupOpenInLedger(playerId: number, groupId: number): boolean {
        const ledger = this.widgetOpenLedgerByPlayer.get(playerId);
        if (!ledger) return false;
        if (ledger.directGroups.has(groupId)) return true;
        const targetSet = ledger.targetUidsByGroup.get(groupId);
        return !!targetSet && targetSet.size > 0;
    }

    private clearUiTrackingForPlayer(playerId: number): void {
        const pid = playerId;
        this.widgetOpenLedgerByPlayer.delete(pid);
        this.accountSummary.clearPlayer(pid);
        this.gamemode.onPlayerDisconnect?.(pid);
        this.reportGameTime.clearPlayer(pid);
    }

    private getGamemodeBridge(): GamemodeBridge {
        return {
            getPlayer: (playerId) => this.players?.getById(playerId),
            queueVarp: (playerId, varpId, value) => this.queueVarp(playerId, varpId, value),
            queueVarbit: (playerId, varbitId, value) => this.queueVarbit(playerId, varbitId, value),
            queueNotification: (playerId, notification) => this.queueNotification(playerId, notification),
            queueWidgetEvent: (playerId, event) => this.queueWidgetEvent(playerId, event),
            queueClientScript: (playerId, scriptId, ...args) => this.queueClientScript(playerId, scriptId, ...args),
            sendGameMessage: (player, text) => this.queueChatMessage({
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
        this.broadcastScheduler.queueNotification(playerId, payload);
    }

    private queueWidgetEvent(playerId: number, action: WidgetAction): void {
        const event = { playerId: playerId, action };
        this.noteWidgetEventForLedger(event.playerId, action);
        // Tick-phase parity: if called during active game logic phases, include in the
        // current frame so it broadcasts this tick (avoids 1-tick UI highlight lag).
        // During broadcast phase itself, queue for next tick to avoid mutating the
        // frame while it is being iterated for sends.
        let queuedInCurrentFrame = false;
        if (this.activeFrame && !this.isBroadcastPhase) {
            this.activeFrame.widgetEvents.push(event);
            queuedInCurrentFrame = true;
        }
        if (!queuedInCurrentFrame) {
            this.broadcastScheduler.queueWidgetEvent(event);
        }

        // Equipment stats (84) value fields are cache-empty text widgets.
        // Populate them server-side immediately after opening the interface.
        if (action.action === "open_sub" && (action.groupId ?? 0) === EQUIPMENT_STATS_GROUP_ID) {
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
        this.broadcastScheduler.queueSmithingMessage(playerId, payload);
    }

    private queueTradeMessage(playerId: number, payload: TradeServerPayload): void {
        this.broadcastScheduler.queueTradeMessage(playerId, payload);
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

        if (this.activeFrame && !this.isBroadcastPhase) {
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
        this.queueChatMessage({
            messageType: "game",
            text,
            targetPlayerIds: [player.id],
        });
    }

    private queueChatMessage(message: {
        messageType: string;
        playerId?: number;
        from?: string;
        prefix?: string;
        text: string;
        playerType?: number;
        colorId?: number;
        effectId?: number;
        pattern?: number[];
        autoChat?: boolean;
        targetPlayerIds?: number[];
    }): void {
        const normalized: ChatMessageSnapshot = {
            ...message,
            messageType:
                message.messageType === "public" ||
                message.messageType === "server" ||
                message.messageType === "private"
                    ? message.messageType
                    : "game",
        };
        // If we're in an active tick frame, push to the frame's chatMessages
        // so the message is delivered this tick. Otherwise queue for next tick.
        if (this.activeFrame) {
            this.activeFrame.chatMessages.push(normalized);
        } else {
            this.broadcastScheduler.queueChatMessage(normalized);
        }
    }

    private enqueueForcedChat(event: ForcedChatBroadcast): void {
        if (this.activeFrame) {
            this.activeFrame.forcedChats.push(event);
        } else {
            this.broadcastScheduler.queueForcedChat(event);
        }
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

    private playLocGraphic(opts: {
        spotId: number;
        tile: { x: number; y: number };
        level?: number;
        height?: number;
        delayTicks?: number;
    }): void {
        if (!opts || !(opts.spotId > 0)) return;
        const tileX = opts.tile.x;
        const tileY = opts.tile.y;
        const level = opts.level ?? 0;
        const delay = opts.delayTicks !== undefined ? Math.max(0, opts.delayTicks) : 0;
        const height = opts.height;
        const tick = this.options.ticker.currentTick();
        this.enqueueSpotAnimation({
            tick: tick,
            spotId: opts.spotId,
            delay,
            height,
            tile: { x: tileX, y: tileY, level },
        });
    }





    private sendSound(
        player: PlayerState,
        soundId: number,
        opts?: { delay?: number; loops?: number },
    ): void {
        this.soundManager.sendSound(player, soundId, opts);
    }

    /**
     * Send a loot notification popup to a player when they pick up an item.
     * Matches OSRS's notification_display (interface 660) behavior.
     */
    private sendLootNotification(player: PlayerState, itemId: number, quantity: number): void {
        // Get item name from cache
        const objType = this.objTypeLoader?.load(itemId);
        const itemName = objType?.name ?? `Item ${itemId}`;
        this.queueNotification(player.id, createLootPickupNotification(itemId, itemName, quantity));
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
        const sock = this.players?.getSocketByPlayerId(player.id);
        if (!sock || jingleId < 0) return;
        this.withDirectSendBypass("jingle", () =>
            this.sendWithGuard(
                sock,
                encodeMessage({
                    type: "play_jingle",
                    payload: {
                        jingleId: jingleId,
                        delay: Math.max(0, Math.min(0xffffff, delay)),
                    },
                }),
                "jingle",
            ),
        );
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
            this.sendWithGuard(sock, msg, context);
        });
    }

    private playLocSound(opts: {
        soundId: number;
        tile?: { x: number; y: number };
        level?: number;
        loops?: number;
        delayMs?: number;
        /** SOUND_AREA: radius in tiles (0-15) for client-side distance falloff */
        radius?: number;
        /** SOUND_AREA: volume (0-255, default 255) */
        volume?: number;
    }): void {
        if (!opts || !(opts.soundId > 0)) return;
        const payload: {
            soundId: number;
            x?: number;
            y?: number;
            level?: number;
            loops?: number;
            delay?: number;
            radius?: number;
            volume?: number;
        } = {
            soundId: opts.soundId,
        };
        if (opts.tile) {
            payload.x = opts.tile.x;
            payload.y = opts.tile.y;
        }
        if (opts.level !== undefined) {
            payload.level = opts.level;
        }
        if (opts.loops !== undefined) {
            payload.loops = Math.max(0, opts.loops);
        }
        if (opts.delayMs !== undefined) {
            payload.delay = Math.max(0, opts.delayMs);
        }
        // SOUND_AREA fields
        if (opts.radius !== undefined && opts.radius > 0) {
            payload.radius = Math.min(15, Math.max(0, opts.radius));
        }
        if (opts.volume !== undefined && opts.volume < 255) {
            payload.volume = Math.min(255, Math.max(0, opts.volume));
        }
        this.withDirectSendBypass("script_loc_sound", () =>
            this.broadcastSound(payload, "script_loc_sound"),
        );
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
        if (!opts || !(opts.soundId > 0)) return;
        const payload: {
            soundId: number;
            x: number;
            y: number;
            level?: number;
            radius?: number;
            volume?: number;
            delay?: number;
        } = {
            soundId: opts.soundId,
            x: opts.tile.x,
            y: opts.tile.y,
        };
        if (opts.level !== undefined) {
            payload.level = opts.level;
        }
        // SOUND_AREA: radius is 0-15 tiles
        if (opts.radius !== undefined && opts.radius > 0) {
            payload.radius = Math.min(15, Math.max(0, opts.radius));
        }
        // SOUND_AREA: volume is 0-255
        if (opts.volume !== undefined && opts.volume < 255) {
            payload.volume = Math.min(255, Math.max(0, opts.volume));
        }
        if (opts.delay !== undefined && opts.delay > 0) {
            // Convert tick delay to ms (600ms per tick)
            payload.delay = opts.delay * 600;
        }
        this.withDirectSendBypass("area_sound", () => this.broadcastSound(payload, "area_sound"));
    }

    private getMusicTrackIdByName(trackName: string): number {
        return this.musicCatalogService?.getTrackByName(trackName)?.trackId ?? -1;
    }

    private handlePrayerDepleted(player: PlayerState, opts: { message?: string } = {}): void {
        const message =
            opts.message ?? "You have run out of Prayer points, you need to recharge at an altar.";
        this.queueChatMessage({
            messageType: "game",
            text: message,
            targetPlayerIds: [player.id],
        });
        player.resetPrayerDrainAccumulator();
        const hadPrayers = (player.getActivePrayers()?.size ?? 0) > 0;
        if (hadPrayers) {
            player.clearActivePrayers();
            this.queueCombatSnapshot(
                player.id,
                player.combatWeaponCategory,
                player.combatWeaponItemId,
                !!player.autoRetaliate,
                player.combatStyleSlot,
                Array.from(player.getActivePrayers() ?? []),
                player.combatSpellId > 0 ? player.combatSpellId : undefined,
            );
        }
    }

    private tryActivateRedemption(player: PlayerState): boolean {
        if (!player.hasPrayerActive("redemption")) return false;
        const currentHp = player.getHitpointsCurrent();
        if (!(currentHp > 0)) return false;
        const maxHp = player.getHitpointsMax();
        const threshold = Math.max(1, Math.floor(maxHp / 10));
        if (currentHp > threshold) return false;
        const prayerSkill = player.getSkill(SkillId.Prayer);
        const currentPrayer = Math.max(0, prayerSkill.baseLevel + prayerSkill.boost);
        if (currentPrayer <= 0) return false;
        const healAmount = Math.max(1, Math.floor(prayerSkill.baseLevel * 0.25));
        if (!(healAmount > 0)) return false;
        player.setSkillBoost(SkillId.Prayer, 0);
        this.handlePrayerDepleted(player);
        player.applyHitpointsHeal(healAmount);
        return true;
    }

    private applySmite(attacker: PlayerState, target: PlayerState, damage: number): void {
        if (!(damage > 0)) return;
        if (!attacker.hasPrayerActive("smite")) return;
        const drain = Math.max(0, Math.floor(damage / 4));
        if (!(drain > 0)) return;
        target.adjustSkillBoost(SkillId.Prayer, -drain);
        if (target.getPrayerLevel() <= 0) {
            target.setSkillBoost(SkillId.Prayer, 0);
            this.handlePrayerDepleted(target);
        }
    }

    /**
     * Activates Retribution prayer effect when player dies.
     * Deals damage equal to 25% of base prayer level (max 25) to all adjacent enemies.
     * OSRS parity: Retribution damages all adjacent players/NPCs within 1 tile.
     */
    private tryActivateRetribution(player: PlayerState, tick: number): void {
        if (!player.hasPrayerActive("retribution")) return;
        const prayerSkill = player.getSkill(SkillId.Prayer);
        const baseDamage = Math.min(25, Math.max(1, Math.floor(prayerSkill.baseLevel * 0.25)));
        if (!(baseDamage > 0)) return;

        const playerX = player.tileX;
        const playerY = player.tileY;
        const playerLevel = player.level;

        // Damage nearby NPCs
        if (this.npcManager) {
            const nearbyNpcs = this.npcManager.getNearby(playerX, playerY, playerLevel, 1);
            for (const npc of nearbyNpcs) {
                const result = this.applyPlayerDamageToNpc(
                    player,
                    npc,
                    baseDamage,
                    HITMARK_DAMAGE,
                    tick,
                    "other",
                    baseDamage,
                );
                if (!result) continue;
                if (this.activeFrame) {
                    this.activeFrame.hitsplats.push({
                        targetType: "npc",
                        targetId: npc.id,
                        damage: result.amount,
                        style: result.style,
                        sourceType: "player",
                        sourcePlayerId: player.id,
                        hpCurrent: result.hpCurrent,
                        hpMax: result.hpMax,
                    });
                }
            }
        }

        // Damage nearby players (PvP)
        if (this.players) {
            this.players.forEach((sock) => {
                const target = this.players?.get(sock);
                if (!target) return;
                if (target.id === player.id) return;
                if (target.level !== playerLevel) return;
                const dx = Math.abs(target.tileX - playerX);
                const dy = Math.abs(target.tileY - playerY);
                if (dx > 1 || dy > 1) return;
                const result = target.applyHitpointsDamage(baseDamage);
                if (this.activeFrame) {
                    this.activeFrame.hitsplats.push({
                        targetType: "player",
                        targetId: target.id,
                        damage: baseDamage,
                        style: HITMARK_DAMAGE,
                        sourceType: "player",
                        sourcePlayerId: player.id,
                        hpCurrent: result.current,
                        hpMax: result.max,
                    });
                }
            });
        }

        // Play retribution spot animation (death animation effect)
        this.enqueueSpotAnimation({
            tick,
            playerId: player.id,
            spotId: 437, // Retribution graphic
            delay: 0,
        });
    }

    private enqueueSpellFailureChat(
        player: PlayerState,
        spellId: number,
        reason: string | undefined,
    ): void {
        let text: string | undefined;
        const sd = getSpellData(spellId);
        switch (reason) {
            case "level_requirement": {
                const req = sd?.levelRequired ?? 1;
                text = `You need a Magic level of ${req} to cast this spell.`;
                break;
            }
            case "out_of_runes":
                text = "You do not have enough runes to cast this spell.";
                break;
            case "out_of_range":
                text = "You need to be closer to use that spell.";
                break;
            case "invalid_target":
                text = "You can't cast that on that target.";
                break;
            case "immune_target":
                text =
                    spellId === 3293
                        ? "This spell only affects undead."
                        : "The spell has no effect.";
                break;
            case "already_active":
                text = "That target is already affected by this spell.";
                break;
            case "line_of_sight":
                text = "You don't have a clear line of sight to that target.";
                break;
            case "restricted_zone":
                text = "A magical force stops you from casting that here.";
                break;
            case "cooldown":
                text = "You can't cast that yet.";
                break;
            // Teleport/teleblock family
            case "teleblocked":
                text = "You can't teleport while teleblocked.";
                break;
            case "teleport_blocked_area":
                text = "A magical force stops you from teleporting.";
                break;
            // Weapon/autocast constraints
            case "not_autocastable_with_weapon":
                text = "You can't autocast that spell with this weapon.";
                break;
            // Utility spell specifics (will be raised by future handlers)
            case "alch_invalid_item":
                text = "You cannot alchemise this item.";
                break;
            case "superheat_invalid_item":
                text = "You can't superheat that.";
                break;
            case "telegrab_invalid":
                text = "You can't reach that.";
                break;
            case "charge_orb_wrong_obelisk":
                text = "You can only charge this orb at the Obelisk of the correct element.";
                break;
            case "charge_orb_missing_orb":
                text = "You need an unpowered orb to cast this spell.";
                break;
            case "invalid_spell":
            default:
                // Prefer a gentle generic for unsupported utility spells on wrong targets
                text = sd?.category === "utility" ? "Nothing interesting happens." : undefined;
        }
        if (text) {
            this.queueChatMessage({ messageType: "game", text });
        }
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
        const playerId = player.id;

        const replacePending = request.replacePending === true;
        if (replacePending) {
            this.actionScheduler.clearActionsInGroup(playerId, TELEPORT_ACTION_GROUP);
            this.tryReleaseTeleportDelayLock(player, LockState.DELAY_ACTIONS);
        }

        const rejectIfPending = request.rejectIfPending !== false;
        if (
            rejectIfPending &&
            this.actionScheduler.hasPendingActionInGroup(playerId, TELEPORT_ACTION_GROUP)
        ) {
            return { ok: false, reason: "cooldown" };
        }

        const requireCanTeleport = request.requireCanTeleport !== false;
        if (requireCanTeleport && !player.canTeleport()) {
            return { ok: false, reason: "cannot_teleport" };
        }

        const delayTicks = request.delayTicks !== undefined ? Math.max(0, request.delayTicks) : 0;
        const cooldownTicks =
            request.cooldownTicks !== undefined ? Math.max(0, request.cooldownTicks) : 0;
        if (delayTicks > 0 && player.lock === LockState.NONE) {
            player.lock = LockState.DELAY_ACTIONS;
        }

        const data: MovementTeleportActionData = {
            x: request.x,
            y: request.y,
            level: request.level,
            forceRebuild: request.forceRebuild === true,
            resetAnimation: request.resetAnimation === true,
        };
        if (delayTicks > 0) {
            data.unlockLockState = LockState.DELAY_ACTIONS;
        }
        if (request.endSpotAnim !== undefined) data.endSpotAnim = request.endSpotAnim;
        if (request.endSpotHeight !== undefined) data.endSpotHeight = request.endSpotHeight;
        if (request.endSpotDelay !== undefined) data.endSpotDelay = request.endSpotDelay;
        if (request.arriveSoundId !== undefined) data.arriveSoundId = request.arriveSoundId;
        if (request.arriveSoundRadius !== undefined)
            data.arriveSoundRadius = request.arriveSoundRadius;
        if (request.arriveSoundVolume !== undefined)
            data.arriveSoundVolume = request.arriveSoundVolume;
        if (request.arriveMessage && request.arriveMessage.length > 0) {
            data.arriveMessage = request.arriveMessage;
        }
        if (request.arriveSeqId !== undefined) data.arriveSeqId = request.arriveSeqId;
        if (request.arriveFaceTileX !== undefined) data.arriveFaceTileX = request.arriveFaceTileX;
        if (request.arriveFaceTileY !== undefined) data.arriveFaceTileY = request.arriveFaceTileY;
        if (request.preserveAnimation) data.preserveAnimation = true;

        const result = this.actionScheduler.requestAction(
            playerId,
            {
                kind: "movement.teleport",
                data,
                delayTicks,
                cooldownTicks,
                groups: [TELEPORT_ACTION_GROUP],
            },
            this.options.ticker.currentTick(),
        );
        if (!result.ok) {
            this.tryReleaseTeleportDelayLock(player, LockState.DELAY_ACTIONS);
            return { ok: false, reason: result.reason || "queue_rejected" };
        }
        return { ok: true };
    }

    private tryReleaseTeleportDelayLock(player: PlayerState, expected: LockState): void {
        if (player.lock !== expected) return;
        if (this.actionScheduler.hasPendingActionInGroup(player.id, TELEPORT_ACTION_GROUP)) {
            return;
        }
        player.lock = LockState.NONE;
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
        // If player is leaving sailing mode, dispose instance, remove world
        // entity, close sailing interfaces, restore combat tab, reset varbits.
        if (
            player.worldViewId === SAILING_WORLD_ENTITY_INDEX &&
            this.worldEntityInfoEncoder.isEntityActive(player.id, SAILING_WORLD_ENTITY_INDEX)
        ) {
            this.sailingInstanceManager?.disposeInstance(player);
            this.worldEntityInfoEncoder.removeEntity(player.id, SAILING_WORLD_ENTITY_INDEX);
            this.actionScheduler.clearActionsInGroup(player.id, "sailing.boarding");

            // Close sailing interfaces via widget tracker
            for (const groupId of [937, 345]) {
                const closed = player.widgets.close(groupId);
                if (this.interfaceService && closed.length > 0) {
                    this.interfaceService.triggerCloseHooksForEntries(player, closed);
                }
            }

            // Restore combat tab via queueWidgetEvent (not tracked as modal)
            this.queueWidgetEvent(player.id, {
                action: "open_sub",
                targetUid: (161 << 16) | 76, // TAB_COMBAT
                groupId: 593,
                type: 1,
            });

            // Reset sailing varbits
            const sailingVarbits = [
                19136, 19137, 19122, 19104, 19151, 19153, 19176, 19175, 19118,
            ];
            for (const id of sailingVarbits) {
                player.setVarbitValue(id, 0);
                this.queueVarbit(player.id, id, 0);
            }
        }

        // Clear any ongoing actions and walk destination
        try {
            this.actionScheduler.clearActionsInGroup(player.id, "skill.woodcut");
            this.actionScheduler.clearActionsInGroup(player.id, "inventory");
            player.clearInteraction();
            player.stopAnimation();
            player.clearWalkDestination();
        } catch {}

        // Teleport and update
        player.teleport(x, y, level);

        // Convert to world coordinates
        const worldX = (x << 7) + 64;
        const worldY = (y << 7) + 64;

        // Update playerViews entry if we're in an active tick frame
        // This is critical for death teleport which happens AFTER playerViews is initially set
        if (this.activeFrame) {
            const view = this.activeFrame.playerViews.get(player.id);
            if (view) {
                view.x = worldX;
                view.y = worldY;
                view.level = level;
                view.snap = true;
                view.moved = true;
                view.directions = undefined;
                view.traversals = undefined;
                view.appearance = player.appearance;
            }
            // Clear any movement steps that were consumed before the teleport fired.
            // The teleport supersedes all movement for this tick.
            this.activeFrame.playerSteps.delete(player.id);
        }

        // The view is already patched in-place above. Do NOT queue an appearance
        // snapshot with snap/position here — it would be drained into the NEXT
        // tick's frame (createTickFrame runs before combat) and overwrite the
        // fresh movement-phase view with stale teleport coordinates.
    }

    private teleportToInstance(
        player: PlayerState,
        x: number,
        y: number,
        level: number,
        templateChunks: number[][][],
        extraLocs?: Array<{ id: number; x: number; y: number; level: number; shape: number; rotation: number }>,
    ): void {
        logger.info(`[teleportToInstance] Player ${player.id} -> (${x}, ${y}, ${level})`);
        const ws = this.players?.getSocketByPlayerId(player.id);
        if (!ws) {
            logger.warn(`[teleportToInstance] No websocket for player ${player.id}`);
            return;
        }

        // Compute regionX/Y (chunk coordinates) from the target tile
        const regionX = x >> 3;
        const regionY = y >> 3;

        // Build and send the REBUILD_REGION packet before the teleport
        const payload = buildRebuildRegionPayload(
            regionX,
            regionY,
            templateChunks,
            this.cacheEnv!,
            false,
        );
        const packet = encodeMessage({ type: "rebuild_region", payload } as any);
        logger.info(`[teleportToInstance] Sending REBUILD_REGION packet (${packet.length} bytes, ${payload.mapRegions.length} regions)`);
        this.withDirectSendBypass("rebuild_region", () =>
            this.sendWithGuard(ws, packet, "rebuild_region"),
        );

        // Now do the actual teleport (sets position, patches playerViews, etc.)
        this.teleportPlayer(player, x, y, level);

        // Send extra locs via LOC_ADD_CHANGE after the teleport
        if (extraLocs) {
            for (const loc of extraLocs) {
                this.spawnLocForPlayer(player, loc.id, { x: loc.x, y: loc.y }, loc.level, loc.shape, loc.rotation);
            }
        }
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
            this.sendWithGuard(ws, packet, "rebuild_normal"),
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
            this.sendWithGuard(ws, packet, "rebuild_worldentity"),
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
            this.sendWithGuard(ws, packet, "rebuild_worldentity"),
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

    private executeMovementTeleportAction(
        player: PlayerState,
        data: MovementTeleportActionData,
        tick: number,
    ): ActionExecutionResult {
        const unlockLockState = data.unlockLockState;

        const releaseDelayLock = () => {
            if (!unlockLockState) return;
            this.tryReleaseTeleportDelayLock(player, unlockLockState);
        };

        const x = data.x;
        const y = data.y;
        const level = data.level;
        try {
            this.teleportPlayer(player, x, y, level, data.forceRebuild);

            // OSRS parity: teleportPlayer() unconditionally queues a stop
            // animation (-1).  When preserveAnimation is set (e.g. climbing),
            // the animation was already sent on a previous tick and should
            // continue playing at the new position — clear the -1 so no
            // animation update block is sent on the teleport tick.
            if (data.preserveAnimation) {
                player.clearPendingSeqs();
            }

            if (data.resetAnimation) {
                try {
                    player.stopAnimation();
                } catch {}
            }

            if (data.endSpotAnim !== undefined && data.endSpotAnim > 0) {
                this.enqueueSpotAnimation({
                    tick,
                    playerId: player.id,
                    spotId: data.endSpotAnim,
                    height: data.endSpotHeight ?? 0,
                    delay: data.endSpotDelay ?? 0,
                });
            }

            if (data.arriveSoundId !== undefined && data.arriveSoundId > 0) {
                this.playAreaSound({
                    soundId: data.arriveSoundId,
                    tile: { x, y },
                    level,
                    radius:
                        data.arriveSoundRadius !== undefined
                            ? Math.max(0, data.arriveSoundRadius)
                            : 5,
                    volume:
                        data.arriveSoundVolume !== undefined
                            ? Math.max(0, data.arriveSoundVolume)
                            : 255,
                });
            }

            if (data.arriveMessage) {
                this.queueChatMessage({
                    messageType: "game",
                    text: data.arriveMessage,
                    targetPlayerIds: [player.id],
                });
            }

            if (data.arriveFaceTileX !== undefined && data.arriveFaceTileY !== undefined) {
                player.faceTile(data.arriveFaceTileX, data.arriveFaceTileY);
            }

            if (data.arriveSeqId !== undefined && data.arriveSeqId >= 0) {
                // teleportPlayer() queues a stop animation (-1). Clear it so
                // the arrive animation lands in the same player_info frame.
                player.clearPendingSeqs();
                player.queueOneShotSeq(data.arriveSeqId, 0);
            }

            return { ok: true };
        } finally {
            releaseDelayLock();
        }
    }

    private executeEmotePlayAction(
        player: PlayerState,
        data: EmotePlayActionData,
    ): ActionExecutionResult {
        const seqId =
            data.seqId ?? (data.emoteId !== undefined ? getEmoteSeq(data.emoteId) : undefined);
        if (seqId === undefined || seqId < 0) {
            return { ok: false, reason: "invalid_emote" };
        }
        const delayTicks = data.delayTicks !== undefined ? Math.max(0, data.delayTicks) : 0;
        player.queueOneShotSeq(seqId, delayTicks);
        return { ok: true, cooldownTicks: 0, groups: ["emote"] };
    }

    private queueInventorySnapshot(playerId: number): void {
        if (this.activeFrame) {
            // If a tick is currently processing, include this snapshot in the current broadcast
            if (this.activeFrame.inventorySnapshots.some((s) => s.playerId === playerId)) return;
            this.activeFrame.inventorySnapshots.push({ playerId: playerId });
            return;
        }
        this.broadcastScheduler.queueInventorySnapshot({ playerId });
    }

    private queueSkillSnapshot(playerId: number, update: SkillSyncUpdate): void {
        if (this.activeFrame) {
            this.activeFrame.skillSnapshots.push({ playerId: playerId, update });
            return;
        }
        this.broadcastScheduler.queueSkillSnapshot(playerId, update);
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
            } catch {}
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

    private buildRunEnergyPayload(player: PlayerState | undefined):
        | {
              percent: number;
              units: number;
              running: boolean;
              weight: number;
              staminaTicks?: number;
              staminaMultiplier?: number;
              staminaTickMs?: number;
          }
        | undefined {
        if (!player) return undefined;
        try {
            player.syncInfiniteRunEnergy();
            const tick = this.options.ticker.currentTick();
            let staminaTicks = Math.max(0, player.getStaminaEffectRemainingTicks(tick));
            let staminaMultiplier: number | undefined;
            if (staminaTicks > 0) {
                staminaMultiplier = player.getRunEnergyDrainMultiplier(tick);
                staminaTicks = Math.max(0, player.getStaminaEffectRemainingTicks(tick));
            }
            const hasStamina = staminaTicks > 0 && staminaMultiplier !== undefined;
            // Compute player weight in kg (can be negative with weight-reducing items)
            const weight = this.computePlayerWeightKg(player);
            return {
                percent: Math.max(0, Math.min(100, player.getRunEnergyPercent())),
                units: Math.max(0, Math.min(RUN_ENERGY_MAX, player.getRunEnergyUnits())),
                running: player.wantsToRun(),
                weight,
                staminaTicks: hasStamina ? staminaTicks : undefined,
                staminaMultiplier: hasStamina ? staminaMultiplier : undefined,
                staminaTickMs: hasStamina ? Math.max(1, this.options.tickMs) : undefined,
            };
        } catch {
            return undefined;
        }
    }

    private queueRunEnergySnapshot(player: PlayerState | undefined): void {
        const payload = this.buildRunEnergyPayload(player);
        if (!payload || !player) return;
        if (this.activeFrame) {
            this.activeFrame.runEnergySnapshots.push({
                playerId: player.id,
                ...payload,
            });
            player.markRunEnergySynced?.();
            return;
        }
        this.broadcastScheduler.queueRunEnergySnapshot({
            playerId: player.id,
            ...payload,
        });
        player.markRunEnergySynced?.();
    }

    private sendRunEnergyState(sock: WebSocket, player: PlayerState): void {
        const payload = this.buildRunEnergyPayload(player);
        if (!payload) return;
        this.withDirectSendBypass("run_energy", () =>
            this.sendWithGuard(sock, encodeMessage({ type: "run_energy", payload }), "run_energy"),
        );
        player.markRunEnergySynced?.();
    }

    private normalizeAccountType(value: number): number {
        const normalized = Number.isFinite(value) ? Math.floor(value) : 0;
        return normalized >= 0 && normalized <= 5 ? normalized : 0;
    }

    private normalizePlayerNameForAuth(name: string | undefined): string {
        return (name ?? "").trim().toLowerCase();
    }

    private isAdminPlayer(player: PlayerState | undefined): boolean {
        if (!player) return false;
        const normalizedName = this.normalizePlayerNameForAuth(player.name);
        if (normalizedName.length === 0) return false;
        return ADMIN_USERNAMES.has(normalizedName);
    }






    private getNpcDropRollService(): DropRollService | undefined {
        if (!this.npcDropRollService && this.npcTypeLoader) {
            this.npcDropRegistry = new NpcDropRegistry(this.npcTypeLoader);
            this.npcDropRollService = new DropRollService(this.npcDropRegistry);
        }
        return this.npcDropRollService;
    }

    private rollNpcDrops(
        npc: NpcState,
        eligibility: DropEligibility | undefined,
    ): PendingNpcDrop[] {
        const service = this.getNpcDropRollService();
        if (!service) return [];
        const recipients: Array<{
            ownerId?: number;
            player?: PlayerState;
            dropRateMultiplier: number;
        }> = [];
        const seen = new Set<number>();
        for (const looter of eligibility?.eligibleLooters ?? []) {
            const playerId = looter.id;
            if (seen.has(playerId)) continue;
            seen.add(playerId);
            recipients.push({
                ownerId: playerId,
                player: looter,
                dropRateMultiplier: this.gamemode.getDropRateMultiplier(looter),
            });
        }
        if (
            recipients.length === 0 &&
            eligibility?.primaryLooter &&
            !seen.has(eligibility.primaryLooter.id)
        ) {
            recipients.push({
                ownerId: eligibility.primaryLooter.id,
                player: eligibility.primaryLooter,
                dropRateMultiplier: this.gamemode.getDropRateMultiplier(
                    eligibility.primaryLooter,
                ),
            });
        }
        if (recipients.length === 0) {
            recipients.push({
                ownerId: undefined,
                player: undefined,
                dropRateMultiplier: 1,
            });
        }
        let npcName = "";
        try {
            npcName = this.npcTypeLoader?.load(npc.typeId)?.name ?? "";
        } catch {}
        return service.roll({
            npcTypeId: npc.typeId,
            npcName,
            tile: { x: npc.tileX, y: npc.tileY, level: npc.level },
            isWilderness: isInWilderness(npc.tileX, npc.tileY),
            recipients,
            worldViewId: npc.worldViewId,
            transformItemId: (npcTypeId, itemId, recipient) =>
                this.gamemode.transformDropItemId(npcTypeId, itemId, recipient.player),
        });
    }

    private getAppearanceDisplayName(player: PlayerState | undefined): string {
        const baseName = player?.name ?? "";
        return this.gamemode.getDisplayName(
            player as PlayerState,
            baseName,
            this.isAdminPlayer(player),
        );
    }

    private getPublicChatPlayerType(player: PlayerState): number {
        return this.gamemode.getChatPlayerType(player, this.isAdminPlayer(player));
    }

    private syncAccountTypeVarbit(sock: WebSocket, player: PlayerState): void {
        const raw = player.getVarbitValue(VARBIT_ACCOUNT_TYPE);
        const accountType = this.normalizeAccountType(raw);
        if (accountType !== raw) {
            player.setVarbitValue(VARBIT_ACCOUNT_TYPE, accountType);
        }
        this.withDirectSendBypass("varbit", () =>
            this.sendWithGuard(
                sock,
                encodeMessage({
                    type: "varbit",
                    payload: {
                        varbitId: VARBIT_ACCOUNT_TYPE,
                        value: accountType,
                    },
                }),
                "varbit",
            ),
        );
    }

    private sendSavedAutocastTransmitVarbits(sock: WebSocket, player: PlayerState): void {
        // Reference CS2 autocast_init/autocast_setup rebuilds the combat-tab autocast UI from
        // var-transmits, so these must be replayed on login even when the value is 0.
        const autocastVarbits = [
            VARBIT_AUTOCAST_SET,
            VARBIT_AUTOCAST_SPELL,
            VARBIT_AUTOCAST_DEFMODE,
        ] as const;
        for (const varbitId of autocastVarbits) {
            const value = player.getVarbitValue(varbitId);
            this.withDirectSendBypass("varbit", () =>
                this.sendWithGuard(
                    sock,
                    encodeMessage({
                        type: "varbit",
                        payload: { varbitId, value },
                    }),
                    "varbit",
                ),
            );
        }
    }

    /**
     * Send saved transmit varps to the client on login/reconnect.
     * This restores persisted varp state (combat toggles, XP drops setup, audio, attack options).
     */
    private sendSavedTransmitVarps(sock: WebSocket, player: PlayerState): void {
        // Send each transmit varp that has a non-zero value
        const transmitVarpIds = [
            VARP_OPTION_RUN,
            VARP_ATTACK_STYLE,
            VARP_AUTO_RETALIATE,
            VARP_SPECIAL_ATTACK,
        ];
        for (const varpId of transmitVarpIds) {
            let value = player.getVarpValue(varpId);

            // OSRS parity: varp 172 is "option_nodef" where 0 = retaliate ON, 1 = retaliate OFF
            // Derive varp value from the boolean state rather than persisted varp (for migration)
            if (varpId === VARP_AUTO_RETALIATE) {
                value = player.autoRetaliate ? 0 : 1;
                player.setVarpValue(VARP_AUTO_RETALIATE, value);
            }

            // For run mode, derive value from actual runToggle state (not persisted varp which may be stale)
            if (varpId === VARP_OPTION_RUN) {
                value = player.wantsToRun() ? 1 : 0;
            }

            // Always send run mode and auto-retaliate (since 0 is valid for "on" state)
            if (varpId === VARP_OPTION_RUN || varpId === VARP_AUTO_RETALIATE || value !== 0) {
                this.withDirectSendBypass("varp", () =>
                    this.sendWithGuard(
                        sock,
                        encodeMessage({
                            type: "varp",
                            payload: { varpId, value },
                        }),
                        "varp",
                    ),
                );
            }
        }

        // XP drops setup/tracker varps are client-authored via CS2 scripts and transmitted to server.
        // Replay non-zero values on login so setup UI and tracker behavior match persisted state.
        for (const varpId of XPDROPS_TRANSMIT_VARPS) {
            const value = player.getVarpValue(varpId);
            if (value === 0) continue;
            this.withDirectSendBypass("varp", () =>
                this.sendWithGuard(
                    sock,
                    encodeMessage({
                        type: "varp",
                        payload: { varpId, value },
                    }),
                    "varp",
                ),
            );
        }

        // Send sound/music volume varps - these control audio settings in CS2 scripts
        // Initialize sound volume defaults for new players (unmuted with reasonable volume)
        const DEFAULT_SOUND_VOLUME = 75; // 70% volume as default
        const volumeVarps = [
            VARP_MUSIC_VOLUME,
            VARP_SOUND_EFFECTS_VOLUME,
            VARP_AREA_SOUNDS_VOLUME,
            VARP_MASTER_VOLUME,
        ];
        for (const varpId of volumeVarps) {
            if (!player.hasVarpValue(varpId)) {
                player.setVarpValue(varpId, DEFAULT_SOUND_VOLUME);
            }
        }

        // Always send these even if 0 (muted) since the client defaults may differ
        if (
            !player.hasVarpValue(VARP_MUSIC_CURRENT_TRACK) ||
            player.getVarpValue(VARP_MUSIC_CURRENT_TRACK) === 0
        ) {
            player.setVarpValue(VARP_MUSIC_CURRENT_TRACK, -1);
        }
        const soundVarps = [
            VARP_MUSIC_VOLUME, // Music volume (0-100)
            VARP_SOUND_EFFECTS_VOLUME, // Sound effects volume (0-100)
            VARP_AREA_SOUNDS_VOLUME, // Area sounds volume (0-100)
            VARP_MASTER_VOLUME, // Master volume (0-100) - enhanced client
            VARP_MUSICPLAY, // Music play mode (0=Area, 1=Shuffle, 2=Single)
            VARP_MUSIC_CURRENT_TRACK, // Current music DB row (default -1)
        ];
        for (const varpId of soundVarps) {
            const value = player.getVarpValue(varpId);
            this.withDirectSendBypass("varp", () =>
                this.sendWithGuard(
                    sock,
                    encodeMessage({
                        type: "varp",
                        payload: { varpId, value },
                    }),
                    "varp",
                ),
            );
        }

        // Send attack option varps - these control NPC/player attack menu priorities
        const attackOptionVarps = [
            VARP_OPTION_ATTACK_PRIORITY_PLAYER, // Player attack options (0-4)
            VARP_OPTION_ATTACK_PRIORITY_NPC, // NPC attack options (0-3)
        ];
        for (const varpId of attackOptionVarps) {
            const value = player.getVarpValue(varpId);
            this.withDirectSendBypass("varp", () =>
                this.sendWithGuard(
                    sock,
                    encodeMessage({
                        type: "varp",
                        payload: { varpId, value },
                    }),
                    "varp",
                ),
            );
        }

        const combatTargetPlayerIndex = this.getCombatTargetPlayerVarpValue(player);
        player.setVarpValue(VARP_COMBAT_TARGET_PLAYER_INDEX, combatTargetPlayerIndex);
        this.withDirectSendBypass("varp", () =>
            this.sendWithGuard(
                sock,
                encodeMessage({
                    type: "varp",
                    payload: {
                        varpId: VARP_COMBAT_TARGET_PLAYER_INDEX,
                        value: combatTargetPlayerIndex,
                    },
                }),
                "varp",
            ),
        );

        // Send home teleport varp with large negative value to bypass 30-minute cooldown.
        // The CS2 check is: clientclock - varp(892) >= 90000. With varp = -100000,
        // this becomes clientclock + 100000 >= 90000, which is always true.
        this.withDirectSendBypass("varp", () =>
            this.sendWithGuard(
                sock,
                encodeMessage({
                    type: "varp",
                    payload: { varpId: VARP_LAST_HOME_TELEPORT, value: -100000 },
                }),
                "varp",
            ),
        );

        // Send minigame teleport varp with large negative value to bypass the 20-minute cooldown.
        // The CS2 check is: date_minutes - varp(888) >= 20. With varp = -100000,
        // this becomes date_minutes + 100000 >= 20, which is always true.
        this.withDirectSendBypass("varp", () =>
            this.sendWithGuard(
                sock,
                encodeMessage({
                    type: "varp",
                    payload: { varpId: VARP_LAST_MINIGAME_TELEPORT, value: -100000 },
                }),
                "varp",
            ),
        );

        // Send spell unlock varps - set quest completion values to unlock all spells
        // These varps control spell availability in the spellbook CS2 scripts
        const spellUnlockVarps: Array<{ varpId: number; value: number }> = [
            // Legend's Quest complete (value 180 = quest finished) - unlocks Charge spell
            { varpId: VARP_LEGENDS_QUEST, value: 180 },
            // Underground Pass complete (value 110 = quest finished) - unlocks Iban Blast
            { varpId: VARP_UNDERGROUND_PASS, value: 110 },
            // Mage Arena complete (value 8 = all god spells unlocked) - unlocks Claws of Guthix, Flames of Zamorak, Saradomin Strike
            { varpId: VARP_MAGE_ARENA, value: 8 },
            // Desert Treasure complete (value 15 = quest finished) - unlocks Ancient Magicks spellbook
            { varpId: VARP_DESERT_TREASURE, value: 15 },
            // Lunar Diplomacy complete (value 190 = quest finished) - unlocks Lunar spellbook
            { varpId: VARP_LUNAR_DIPLOMACY, value: 190 },
            // Eadgar's Ruse complete - unlocks Trollheim Teleport
            { varpId: VARP_EADGAR_QUEST, value: 110 },
            // Watchtower quest complete - unlocks Watchtower Teleport
            { varpId: VARP_WATCHTOWER, value: 13 },
            // Plague City complete - prerequisite for Ardougne Teleport
            { varpId: VARP_PLAGUE_CITY, value: 29 },
            // Biohazard complete - unlocks Ardougne Teleport
            { varpId: VARP_BIOHAZARD, value: 16 },
        ];

        for (const { varpId, value } of spellUnlockVarps) {
            this.withDirectSendBypass("varp", () =>
                this.sendWithGuard(
                    sock,
                    encodeMessage({
                        type: "varp",
                        payload: { varpId, value },
                    }),
                    "varp",
                ),
            );
        }

        // Send spell unlock varbits for additional spell requirements
        const spellUnlockVarbits: Array<{ varbitId: number; value: number }> = [
            // Arceuus favor at 100% (1000 = 100%) - required for Arceuus spells
            { varbitId: VARBIT_ARCEUUS_FAVOR, value: 1000 },
            // Arceuus spellbook unlocked flag
            { varbitId: VARBIT_ARCEUUS_SPELLBOOK_UNLOCKED, value: 1 },
            // Iban's book read (Underground Pass) - required for Iban Blast
            { varbitId: VARBIT_IBAN_BOOK_READ, value: 1 },
            // Mage Arena 2 complete (value 6 = fully complete) - unlocks enhanced god spells
            { varbitId: VARBIT_MAGE_ARENA_2_PROGRESS, value: 6 },
            // Client of Kourend quest complete (value 9) - unlocks Kourend Castle Teleport
            { varbitId: VARBIT_CLIENT_OF_KOUREND, value: 9 },
        ];

        for (const { varbitId, value } of spellUnlockVarbits) {
            this.withDirectSendBypass("varbit", () =>
                this.sendWithGuard(
                    sock,
                    encodeMessage({
                        type: "varbit",
                        payload: { varbitId, value },
                    }),
                    "varbit",
                ),
            );
        }

        // Send music unlock varps (musicmulti_1 through musicmulti_27)
        // These control which tracks appear as unlocked (green) vs locked (red) in the music list
        for (const varpId of MUSIC_UNLOCK_VARPS) {
            const value = player.getVarpValue(varpId);
            if (value !== 0) {
                this.withDirectSendBypass("varp", () =>
                    this.sendWithGuard(
                        sock,
                        encodeMessage({
                            type: "varp",
                            payload: { varpId, value },
                        }),
                        "varp",
                    ),
                );
            }
        }

        // Send music unlock message toggle varbit (default ON = 1)
        // Initialize to 1 if not set, then send current value
        if (this.musicUnlockService) {
            this.musicUnlockService.initializeDefaults(player);
        }
        const musicUnlockMsgValue = player.getVarbitValue(VARBIT_MUSIC_UNLOCK_TEXT_TOGGLE);
        this.withDirectSendBypass("varbit", () =>
            this.sendWithGuard(
                sock,
                encodeMessage({
                    type: "varbit",
                    payload: {
                        varbitId: VARBIT_MUSIC_UNLOCK_TEXT_TOGGLE,
                        value: musicUnlockMsgValue,
                    },
                }),
                "varbit",
            ),
        );

        // Send XP drops enabled state (varbit 4702) so minimap orb and XP tracker stay in sync.
        const xpDropsEnabledValue = player.getVarbitValue(VARBIT_XPDROPS_ENABLED);
        this.withDirectSendBypass("varbit", () =>
            this.sendWithGuard(
                sock,
                encodeMessage({
                    type: "varbit",
                    payload: {
                        varbitId: VARBIT_XPDROPS_ENABLED,
                        value: xpDropsEnabledValue,
                    },
                }),
                "varbit",
            ),
        );
    }

    private queueAnimSnapshot(playerId: number, anim: PlayerAnimSet | undefined): void {
        if (!anim) return;
        if (this.activeFrame) {
            this.activeFrame.animSnapshots.push({ playerId: playerId, anim });
            return;
        }
        this.broadcastScheduler.queueAnimSnapshot(playerId, anim);
    }

    private queueSpellResult(playerId: number, payload: SpellResultPayload): void {
        if (this.activeFrame) {
            this.activeFrame.spellResults.push({ playerId: playerId, payload });
            return;
        }
        this.broadcastScheduler.queueSpellResult(playerId, payload);
    }
    private estimateProjectileTiming(opts: {
        player: PlayerState;
        targetX?: number;
        targetY?: number;
        projectileDefaults?: ProjectileParams;
        spellData?: SpellDataEntry;
        pathService?: PathService;
    }):
        | { startDelay: number; travelTime: number; hitDelay: number; lineOfSight?: boolean }
        | undefined {
        // OSRS semantics: use cache-authoritative projectile delays when present.
        const tickMs = Math.max(1, this.options.tickMs);
        const framesPerTick = Math.max(1, Math.round(tickMs / 20));
        const projectileId = opts.spellData?.projectileId ?? -1;

        // Start delay (ticks): OSRS parity – prefer cache-authoritative delayFrames when available.
        // Priority: explicit spell value > explicit defaults > cache delayFrames > animation heuristic
        let startDelay = 0;
        let usedCacheDelay = false;
        if (opts.spellData?.projectileStartDelay !== undefined) {
            startDelay = Math.max(0, opts.spellData.projectileStartDelay);
            usedCacheDelay = true;
        } else if (opts.projectileDefaults?.startDelay !== undefined) {
            startDelay = Math.max(0, opts.projectileDefaults.startDelay);
            usedCacheDelay = true;
        } else if (
            opts.projectileDefaults?.delayFrames !== undefined &&
            opts.projectileDefaults.delayFrames > 0
        ) {
            // OSRS parity: delayFrames from cache is authoritative for projectile spawn timing
            startDelay = Math.max(0, opts.projectileDefaults.delayFrames / framesPerTick);
            usedCacheDelay = true;
        }

        // Travel time (ticks): explicit spell/default values first, otherwise derived from projectile model.
        let travelTime: number | undefined;
        let rayTiles: number | undefined;
        let lineOfSight: boolean | undefined;
        if (opts.spellData?.projectileTravelTime !== undefined) {
            travelTime = Math.max(1, opts.spellData.projectileTravelTime);
        } else if (opts.projectileDefaults?.travelTime !== undefined) {
            travelTime = Math.max(1, opts.projectileDefaults.travelTime);
        } else if (opts.targetX !== undefined && opts.targetY !== undefined) {
            const px = opts.player.tileX;
            const py = opts.player.tileY;
            const tx = opts.targetX;
            const ty = opts.targetY;
            const tiles = Math.max(Math.abs(px - tx), Math.abs(py - ty)); // Chebyshev
            let effective = tiles;
            if (opts.pathService) {
                const ray = opts.pathService.projectileRaycast(
                    { x: px, y: py, plane: opts.player.level },
                    { x: tx, y: ty },
                );
                lineOfSight = ray.clear;
                rayTiles = Math.max(0, ray.tiles);
                if (ray.clear) {
                    effective = Math.max(1, ray.tiles);
                }
            }
            const travelFrames = this.estimateProjectileTravelFramesForParams(
                projectileId,
                opts.projectileDefaults,
                effective,
                rayTiles,
                framesPerTick,
            );
            if (travelFrames !== undefined && Number.isFinite(travelFrames)) {
                travelTime = Math.max(1, travelFrames / framesPerTick);
            }
        }

        if (travelTime === undefined || !Number.isFinite(travelTime)) return undefined;

        // Add optional per-spell release offset (ticks) on top of base delay.
        if (opts.spellData?.projectileReleaseDelayTicks !== undefined) {
            startDelay += Math.max(0, opts.spellData.projectileReleaseDelayTicks);
        } else if (!usedCacheDelay) {
            // Only use animation heuristic if we don't have cache-authoritative delay.
            // This avoids overriding delayFrames with a potentially inaccurate heuristic.
            try {
                let castSeq = -1;
                if (opts.spellData) {
                    if (opts.spellData.castAnimId !== undefined) {
                        castSeq = opts.spellData.castAnimId;
                    } else if (opts.spellData.id > 0) {
                        const isAutocast =
                            !!opts.player.autocastEnabled &&
                            (opts.player.combatSpellId ?? -1) === opts.spellData.id;
                        castSeq = this.pickSpellCastSequence(
                            opts.player,
                            opts.spellData.id,
                            isAutocast,
                        );
                    }
                } else {
                    castSeq = this.pickAttackSequence(opts.player);
                }
                const extra = this.estimateReleaseOffsetFromSeq(castSeq, framesPerTick);
                if (extra !== undefined && extra > 0) {
                    startDelay += extra;
                }
            } catch {}
        }

        const hitDelay = startDelay + travelTime;
        return { startDelay, travelTime, hitDelay, lineOfSight };
    }

    private estimateReleaseOffsetFromSeq(seqId: number, framesPerTick: number): number | undefined {
        if (!(seqId >= 0)) return undefined;
        const loader: any = this.seqTypeLoader;
        if (!loader?.load) return undefined;
        try {
            const seq = loader.load(seqId);
            if (!seq) return undefined;
            // Heuristic: if the sequence has frameSounds, assume the first sound marks release.
            const sounds = seq.frameSounds as Map<number, any[]> | undefined;
            let frameIndex: number | undefined;
            if (sounds) {
                let best: number | undefined;
                sounds.forEach((_v: any, k: number) => {
                    if (best === undefined || k < best) best = k;
                });
                frameIndex = best;
            }
            if (frameIndex === undefined) return undefined;
            // Sum frameLengths up to and including that frame
            let frames = 0;
            for (let i = 0; i <= Math.min(frameIndex, (seq.frameLengths?.length ?? 0) - 1); i++) {
                const fl = seq.frameLengths[i] ?? 1;
                frames += fl > 0 ? fl : 1;
            }
            const ticks = frames / Math.max(1, framesPerTick);
            return Math.max(0, ticks);
        } catch {
            return undefined;
        }
    }

    /**
     * Send collection-log display varps on login/reconnect so summary/account UIs have the same
     * state they would get after opening the collection log itself.
     */
    private sendCollectionLogDisplayVarps(sock: WebSocket, player: PlayerState): void {
        const displayVarps = syncCollectionDisplayVarps(player);
        for (const [varpIdRaw, valueRaw] of Object.entries(displayVarps)) {
            this.withDirectSendBypass("varp", () =>
                this.sendWithGuard(
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

    private estimateProjectileTravelFramesForParams(
        projectileId: number,
        defaults: ProjectileParams | undefined,
        distanceTiles: number,
        rayTiles: number | undefined,
        framesPerTick: number,
    ): number | undefined {
        const tiles = Math.max(1, Math.round(distanceTiles));
        // Prefer cache/param-provided travel frames or ticks-per-tile when present.
        const travelFramesExplicit = defaults?.travelFrames;
        if (
            Number.isFinite(travelFramesExplicit as number) &&
            (travelFramesExplicit as number) > 0
        ) {
            return Math.max(1, Math.round(travelFramesExplicit as number));
        }
        const ticksPerTile = defaults?.ticksPerTile;
        if (Number.isFinite(ticksPerTile as number) && (ticksPerTile as number) > 0) {
            return Math.max(1, Math.round(tiles * (ticksPerTile as number) * framesPerTick));
        }
        const byModel = this.estimateFramesFromLifeModel(
            defaults?.lifeModel,
            tiles,
            rayTiles,
            framesPerTick,
        );
        if (byModel !== undefined) {
            return byModel;
        }
        // No heuristic fallback here; if cache doesn't define travel we must not invent timing.
        return undefined;
    }

    private estimateFramesFromLifeModel(
        model: ProjectileParams["lifeModel"],
        distanceTiles: number,
        rayTiles?: number,
        framesPerTick?: number,
    ): number | undefined {
        if (!model) return undefined;
        const tiles = Math.max(1, Math.round(distanceTiles));
        const fpt = Math.max(1, Math.round(framesPerTick ?? 30));
        switch (model) {
            case "linear5":
                return tiles * 5;
            case "linear5-clamped10":
                return Math.max(10, tiles * 5);
            case "javelin":
                return tiles * 3 + 2;
            case "magic": {
                // OSRS parity: Magic projectile travel must sync with hit delay formula.
                // Hit delay for magic is: 1 + floor((1 + distance) / 3) + 1 (for NPC target)
                // With startDelay=1, travelTime should be: 1 + floor((1 + distance) / 3)
                // This ensures projectile arrives exactly when the hit is applied.
                const pathTiles = Math.max(1, Math.round(rayTiles ?? distanceTiles));
                const travelTicks = 1 + Math.floor((1 + pathTiles) / 3);
                return travelTicks * fpt;
            }
            default:
                return undefined;
        }
    }

    private getPlayerProjectileHeightOffset(_player: PlayerState): number {
        return PLAYER_CHEST_OFFSET_UNITS;
    }

    private getProjectileHeightSampler():
        | ((worldX: number, worldY: number, plane: number) => number | undefined)
        | undefined {
        const pathService = this.options.pathService;
        if (!pathService?.sampleHeight) {
            return undefined;
        }
        return (worldX: number, worldY: number, plane: number): number | undefined => {
            const sample = pathService.sampleHeight(worldX, worldY, plane);
            if (!Number.isFinite(sample as number)) {
                // Fallback to 0 if height data is missing to ensure consistent projectile offsets
                // instead of letting the client default to "feet" (0 offset).
                return 0;
            }
            return sample as number;
        };
    }

    private getNpcProjectileHeightOffset(npc: NpcState): number {
        try {
            const npcType = this.npcManager?.getNpcType(npc);
            let heightScale = Math.max(64, npcType?.heightScale ?? 128);
            // Projectile targets should land around the torso, not the head.
            // Many NPCs keep heightScale=128 even when visually short, so 0.9 tiles overshoots.
            // Use a lower torso factor with a small floor.
            let heightOffsetTiles = Math.max(0.6, (heightScale / 128) * 0.75);
            const size = Math.max(1, npc.size);
            heightOffsetTiles += (size - 1) * 0.5;
            return Math.round(heightOffsetTiles * TILE_UNIT);
        } catch {
            return PLAYER_CHEST_OFFSET_UNITS;
        }
    }

    private getTargetHeightOffset(
        targetNpc: NpcState | undefined,
        targetPlayer: PlayerState | undefined,
        fallback: number,
    ): number {
        if (targetPlayer) return this.getPlayerProjectileHeightOffset(targetPlayer);
        if (targetNpc) return this.getNpcProjectileHeightOffset(targetNpc);
        return fallback;
    }

    private computeProjectileEndHeight(opts: {
        projectileDefaults?: ProjectileParams;
        spellData?: SpellDataEntry;
        targetNpc?: NpcState;
        targetPlayer?: PlayerState;
    }): number | undefined {
        // OSRS parity: end height comes from cache/archetype or explicit spell field only.
        const explicit = opts.spellData?.projectileEndHeight ?? opts.projectileDefaults?.endHeight;
        return explicit !== undefined ? explicit : undefined;
    }

    private buildPlayerRangedProjectileLaunch(opts: {
        player: PlayerState;
        npc: NpcState;
        projectile: {
            projectileId?: number;
            startHeight?: number;
            endHeight?: number;
            slope?: number;
            steepness?: number;
            startDelay?: number;
            sourceHeightOffset?: number;
        };
        timing?: { startDelay: number; travelTime: number };
    }): ProjectileLaunch | undefined {
        if (!this.projectileSystem) return undefined;
        return this.projectileSystem.buildRangedProjectileLaunch(opts);
    }

    private queueProjectileForViewers(launch: ProjectileLaunch): void {
        if (!this.projectileSystem) return;
        // Sync the active frame container with the projectile system
        if (this.activeFrame && this.activeFrame.tick === this.options.ticker.currentTick()) {
            this.activeFrame.projectilePackets ??= new Map();
            this.projectileSystem.setActiveFramePackets(this.activeFrame.projectilePackets);
        }
        this.projectileSystem.queueProjectileForViewers(launch);
    }

    private getInventory(p: PlayerState): InventoryEntry[] {
        return p.getInventoryEntries();
    }

    private setInventorySlot(
        p: PlayerState,
        slotIndex: number,
        itemId: number,
        quantity: number,
    ): void {
        p.setInventorySlot(slotIndex, itemId, quantity);
    }

    /**
     * Build the generic server services bag for gamemodes to consume.
     * Any gamemode feature (banking, shops, etc.) uses these to interact with core server systems.
     */
    private buildGamemodeServerServices(): import("../game/gamemodes/GamemodeDefinition").GamemodeServerServices {
        return {
            getPlayer: (playerId) => this.players?.getById(playerId),
            getInventory: (player) => this.getInventory(player),
            getEquipArray: (player) => this.ensureEquipArray(player),
            getEquipQtyArray: (player) => this.ensureEquipQtyArray(player),
            addItemToInventory: (player, itemId, qty) =>
                this.addItemToInventory(player, itemId, qty),
            sendInventorySnapshot: (playerId) => {
                const sock = this.players?.getSocketByPlayerId(playerId);
                const player = this.players?.getById(playerId);
                if (sock && player) this.sendInventorySnapshot(sock, player);
            },
            refreshAppearance: (player) => this.refreshAppearanceKits(player),
            refreshCombatWeapon: (player) => this.refreshCombatWeaponCategory(player),
            sendAppearanceUpdate: (playerId) => {
                const sock = this.players?.getSocketByPlayerId(playerId);
                const player = this.players?.getById(playerId);
                if (sock && player) this.sendAppearanceUpdate(sock, player);
            },
            queueCombatSnapshot: (
                playerId,
                category,
                weaponItemId,
                autoRetaliate,
                styleSlot,
                activePrayers,
                combatSpellId,
            ) => {
                this.queueCombatSnapshot(
                    playerId,
                    category,
                    weaponItemId,
                    autoRetaliate,
                    styleSlot,
                    activePrayers,
                    combatSpellId,
                );
            },
            queueChatMessage: (opts) => this.queueChatMessage(opts),
            queueVarbit: (playerId, varbitId, value) => this.queueVarbit(playerId, varbitId, value),
            queueWidgetEvent: (playerId, event) => this.queueWidgetEvent(playerId, event as any),
            queueGamemodeSnapshot: (key, playerId, payload) =>
                this.queueGamemodeSnapshot(key, playerId, payload),
            registerSnapshotEncoder: (key, encoder, onSent) =>
                this.registerSnapshotEncoder(key, encoder, onSent),
            getObjType: (itemId) => this.getObjType(itemId),
            getInterfaceService: () => this.interfaceService,
            getCurrentTick: () => this.options.ticker.currentTick(),
            registerTickCallback: (callback) => this.gamemodeTickCallbacks.push(callback),
            isInSailingInstanceRegion: (player) =>
                this.sailingInstanceManager?.isInSailingInstanceRegion(player) ?? false,
            initSailingInstance: (player) =>
                this.sailingInstanceManager?.initInstance(player),
            logger: logger,
        };
    }

    /**
     * Create the NpcPacketEncoder with all required services.
     */
    private createNpcPacketEncoder(): NpcPacketEncoder {
        const services: NpcPacketEncoderServices = {
            getNpcById: (id) => this.npcManager?.getById(id),
            getNearbyNpcs: (x, y, level, radius) =>
                this.npcManager?.getNearby(x, y, level, radius) ?? [],
            resolveHealthBarWidth: (defId) => {
                try {
                    const def = this.healthBarDefLoader?.load?.(defId);
                    return Math.max(1, Math.min(255, def?.width ?? 30));
                } catch {
                    return 30;
                }
            },
        };
        return new NpcPacketEncoder(services);
    }

    /**
     * Create the PlayerPacketEncoder with all required services.
     */
    private createPlayerPacketEncoder(): PlayerPacketEncoder {
        const huffman = this.huffman;
        const services: PlayerPacketEncoderServices = {
            getPlayer: (id) => {
                const p = this.players?.getById(id);
                return p ?? undefined;
            },
            getLivePlayers: () => {
                const liveById = new Map<number, PlayerState>();
                if (this.players) {
                    this.players.forEach((_, p) => {
                        liveById.set(p.id, p);
                    });
                    this.players.forEachBot((p) => {
                        liveById.set(p.id, p);
                    });
                }
                return liveById;
            },
            buildAnimPayload: (player) => this.buildAnimPayload(player),
            serializeAppearancePayload: (view) => this.serializeAppearancePayload(view),
            resolveHealthBarWidth: (defId) => {
                try {
                    const def = this.healthBarDefLoader?.load?.(defId);
                    return Math.max(1, Math.min(255, def?.width ?? 30));
                } catch {
                    return 30;
                }
            },
            encodeHuffmanChat: (text) => {
                const raw = this.encodeCp1252(text);
                if (!huffman) {
                    return raw;
                }
                const maxCompressed = raw.length * 4 + 8;
                const buf = new Uint8Array(maxCompressed);
                let off = 0;
                // smartByteShort encoding
                const len = raw.length;
                if (len >= 0 && len < 128) {
                    buf[off++] = len & 0xff;
                } else if (len >= 0 && len < 32768) {
                    const vv = (len + 32768) & 0xffff;
                    buf[off++] = (vv >> 8) & 0xff;
                    buf[off++] = vv & 0xff;
                }
                const written = huffman.compress(raw, 0, raw.length, buf, off);
                return buf.subarray(0, off + written);
            },
        };
        return new PlayerPacketEncoder(services);
    }

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
    private createCombatActionHandler(): CombatActionHandler {
        const services: CombatActionServices = {
            // --- Core Entity Access ---
            getPlayer: (id) => this.players?.getById(id) ?? undefined,
            getNpc: (id) => this.npcManager?.getById(id) ?? undefined,
            getCurrentTick: () => this.options.ticker.currentTick(),
            getPathService: () => this.options.pathService,

            // --- Equipment/Appearance ---
            getEquipArray: (player) => this.ensureEquipArray(player),
            getEquipQtyArray: (player) =>
                ensureEquipQtyArrayOn(player.appearance, EQUIP_SLOT_COUNT),
            markEquipmentDirty: (player) => player.markEquipmentDirty(),
            markAppearanceDirty: (player) => player.markAppearanceDirty(),

            // --- Combat Utilities ---
            pickAttackSequence: (player) => this.pickAttackSequence(player),
            pickAttackSpeed: (player) => this.pickAttackSpeed(player),
            pickHitDelay: (player) => this.pickHitDelay(player),
            getPlayerAttackReach: (player) => this.getPlayerAttackReach(player),
            pickNpcFaceTile: (player, npc) => this.pickNpcFaceTile(player, npc),
            pickCombatSound: (player, isHit) => this.pickCombatSound(player, isHit),
            getRangedImpactSound: (player) => this.getRangedImpactSound(player),
            deriveAttackTypeFromStyle: (style, player) =>
                this.deriveAttackTypeFromStyle(style, player),
            pickBlockSequence: (player) =>
                this.playerCombatManager?.pickBlockSequence(player, this.weaponAnimOverrides) ?? -1,

            // --- NPC Combat ---
            getNpcCombatSequences: (typeId) => this.getNpcCombatSequences(typeId),
            getNpcHitSoundId: (typeId) => this.getNpcHitSoundId(typeId),
            getNpcDefendSoundId: (typeId) => this.getNpcDefendSoundId(typeId),
            getNpcDeathSoundId: (typeId) => this.getNpcDeathSoundId(typeId),
            getNpcAttackSoundId: (typeId) => this.getNpcAttackSoundId(typeId),
            resolveNpcAttackType: (npc, hint) => this.resolveNpcAttackType(npc, hint),
            resolveNpcAttackRange: (npc, attackType) => this.resolveNpcAttackRange(npc, attackType),
            broadcastNpcSequence: (npc, seqId) => this.broadcastNpcSequence(npc, seqId),
            estimateNpcDespawnDelayTicksFromSeq: (seqId) =>
                this.estimateNpcDespawnDelayTicksFromSeq(seqId),

            // --- Projectile ---
            estimateProjectileTiming: (params) => this.estimateProjectileTiming(params as any),
            buildPlayerRangedProjectileLaunch: (params) =>
                this.buildPlayerRangedProjectileLaunch(params),

            // --- Spell/Magic ---
            processSpellCastRequest: (player, request) =>
                this.spellActionHandler.processSpellCastRequest(
                    player,
                    request as any,
                    this.options.ticker.currentTick(),
                ),
            queueSpellResult: (playerId, result) => this.queueSpellResult(playerId, result),
            pickSpellSound: (spellId, stage) => this.pickSpellSound(spellId, stage),
            resetAutocast: (player) => this.resetAutocast(player),

            // --- Effect Dispatching ---
            broadcastSound: (request, tag) => this.broadcastSound(request, tag),
            withDirectSendBypass: (tag, fn) => this.withDirectSendBypass(tag, fn),
            enqueueSpotAnimation: (request) => this.enqueueSpotAnimation(request),
            queueChatMessage: (request) => this.queueChatMessage(request),
            queueCombatState: (player) => this.queueCombatState(player),
            queueSkillSnapshot: (playerId, sync) =>
                this.queueSkillSnapshot(playerId, sync as SkillSyncUpdate),
            dispatchActionEffects: (effects) =>
                this.effectDispatcher.dispatchActionEffects(effects),
            broadcast: (data, tag) => this.broadcast(data, tag),
            encodeMessage: (msg) => encodeMessage(msg as any),

            // --- Action Scheduling ---
            scheduleAction: (playerId, request, tick) =>
                this.actionScheduler.requestAction(playerId, request, tick),
            cancelActions: (playerId, predicate) =>
                this.actionScheduler.cancelActions(playerId, predicate),

            // --- Player Interaction State ---
            getPlayerSocket: (playerId) => this.players?.getSocketByPlayerId(playerId),
            getInteractionState: (socket) =>
                socket ? this.players?.getInteractionState(socket) : undefined,
            startNpcAttack: (socket, npc, tick, attackSpeed) =>
                this.players?.startNpcAttack(socket, npc, tick, attackSpeed) ?? {
                    ok: false,
                },
            stopPlayerCombat: (socket) => this.players?.stopPlayerCombat(socket),
            startPlayerCombat: (socket, targetId) =>
                this.players?.startPlayerCombat(socket, targetId),
            clearInteractionsWithNpc: (npcId) => this.players?.clearInteractionsWithNpc(npcId),
            sendSkillsMessage: (socket, player) => {
                if (socket instanceof WebSocket) {
                    this.sendSkillsMessage(socket, player);
                }
            },

            // --- Combat System ---
            startNpcCombat: (player, npc, tick, attackSpeed) =>
                this.playerCombatManager?.startCombat(player, npc, tick, attackSpeed),
            resumeAutoAttack: (playerId) => this.playerCombatManager?.resumeAutoAttack(playerId),
            confirmHitLanded: (playerId, tick, npc, damage, attackType, player) =>
                this.playerCombatManager?.confirmHitLanded(
                    playerId,
                    npc,
                    tick,
                    damage,
                    attackType,
                    player,
                ),
            extendAggroHold: (playerId, minimumTicks) =>
                this.playerCombatManager?.extendAggroHold(playerId, minimumTicks),
            rollRetaliateDamage: (npc, player) =>
                this.playerCombatManager?.rollRetaliateDamage(npc, player) ?? 0,
            getDropEligibility: (npc) => this.playerCombatManager?.getDropEligibility?.(npc),
            rollNpcDrops: (npc, eligibility) => this.rollNpcDrops(npc, eligibility),
            cleanupNpc: (npc) => this.playerCombatManager?.cleanupNpc?.(npc),

            // --- Ground Items ---
            spawnGroundItem: (itemId, quantity, location, tick, options) =>
                this.groundItems.spawn(itemId, quantity, location, tick, options),

            // --- NPC Manager ---
            queueNpcDeath: (npcId, despawnTick, respawnTick, drops) =>
                this.npcManager?.queueDeath?.(npcId, despawnTick, respawnTick, drops) ?? false,

            // --- Prayer/Combat Effects ---
            applyProtectionPrayers: (target, damage, attackType, sourceType) =>
                this.applyProtectionPrayers(target, damage, attackType, sourceType),
            applySmite: (attacker, target, damage) => this.applySmite(attacker, target, damage),
            tryActivateRedemption: (player) => this.tryActivateRedemption(player),
            closeInterruptibleInterfaces: (player) => this.closeInterruptibleInterfaces(player),
            applyMultiTargetSpellDamage: (params) => this.applyMultiTargetSpellDamage(params),

            // --- XP Awards ---
            awardCombatXp: (player, damage, hitData, effects) =>
                this.awardCombatXp(player, damage, hitData, effects),
            getSkillXpMultiplier: (player) => this.gamemode.getSkillXpMultiplier(player),

            // --- Special Attacks ---
            getSpecialAttack: (weaponId) => getSpecialAttack(weaponId),
            pickSpecialAttackVisualOverride: (weaponId) =>
                pickSpecialAttackVisualOverride(weaponId),

            // --- Ammo Consumption ---
            consumeEquippedAmmoApply: (params) => consumeEquippedAmmoApply(params),
            calculateAmmoConsumption: (
                weaponId,
                ammoId,
                ammoQty,
                capeId,
                targetX,
                targetY,
                randFn,
            ) =>
                calculateAmmoConsumption(
                    weaponId,
                    ammoId,
                    ammoQty,
                    capeId,
                    targetX,
                    targetY,
                    randFn,
                ),

            // --- Magic Autocast ---
            canWeaponAutocastSpell: (weaponId, spellId) =>
                canWeaponAutocastSpell(weaponId, spellId),
            getAutocastCompatibilityMessage: (reason) =>
                getAutocastCompatibilityMessage(reason as any),

            // --- Spell Caster ---
            validateSpellCast: (context) => SpellCaster.validate(context),
            executeSpellCast: (context, validation) => SpellCaster.execute(context, validation),

            // --- Spell Data ---
            getSpellData: (spellId) => getSpellData(spellId),
            getSpellBaseXp: (spellId) => getSpellBaseXp(spellId),
            getProjectileParams: (projectileId) =>
                projectileId !== undefined ? getProjectileParams(projectileId) : undefined,

            // --- Hitsplat Applicator ---
            applyNpcHitsplat: (npc, style, damage, tick, maxHit) =>
                combatEffectApplicator.applyNpcHitsplat(npc, style, damage, tick, maxHit),
            applyPlayerHitsplat: (player, style, damage, tick, maxHit) =>
                combatEffectApplicator.applyPlayerHitsplat(player, style, damage, tick, maxHit),

            // --- Wilderness Check ---
            isInWilderness: (x, y) => isInWilderness(x, y),

            // --- Range Checks ---
            isWithinAttackRange: (attacker, target, range) =>
                isWithinAttackRange(attacker, target, range),
            hasDirectMeleeReach: (attacker, target, pathService) =>
                hasDirectMeleeReach(attacker, target, pathService),
            hasDirectMeleePath: (attacker, target, pathService) =>
                hasDirectMeleePath(attacker, target, pathService),

            // --- Helpers ---
            normalizeAttackType: (value) => normalizeAttackType(value),
            isActiveFrame: () => !!this.activeFrame,
            log: (level, message) => {
                try {
                    if (level === "warn") logger.warn(message);
                    else if (level === "error") logger.error(message);
                    else logger.info(message);
                } catch {}
            },

            // --- NPC Info ---
            getNpcName: (typeId) => {
                try {
                    return this.npcTypeLoader?.load(typeId)?.name;
                } catch {
                    return undefined;
                }
            },

            // --- Gamemode Events ---
            onNpcKill: (playerId, npcId) => {
                this.gamemode.onNpcKill(playerId, npcId);
            },
        };
        return new CombatActionHandler(services);
    }

    /**
     * Create the SpellActionHandler with all required services.
     */
    private createSpellActionHandler(): SpellActionHandler {
        const services: SpellActionServices = {
            // --- Core ---
            getCurrentTick: () => this.options.ticker.currentTick(),
            getDeliveryTick: () =>
                this.activeFrame ? this.activeFrame.tick : this.options.ticker.currentTick() + 1,
            getTickMs: () => this.options.tickMs,
            getFramesPerTick: () => Math.max(1, Math.round(this.options.tickMs / 20)),

            // --- Entity Access ---
            getNpc: (id) => this.npcManager?.getById(id) ?? undefined,
            getPlayer: (id) => this.players?.getById(id) ?? undefined,
            getPlayerSocket: (playerId) => this.players?.getSocketByPlayerId(playerId),
            getNpcType: (npc) => this.npcManager?.getNpcType(npc),

            // --- Spell Data ---
            getSpellData: (spellId) => getSpellData(spellId),
            getSpellDataByWidget: (groupId, childId) => getSpellDataByWidget(groupId, childId),
            getProjectileParams: (projectileId) =>
                projectileId !== undefined ? getProjectileParams(projectileId) : undefined,
            canWeaponAutocastSpell: (weaponId, spellId) =>
                canWeaponAutocastSpell(weaponId, spellId),
            getSpellBaseXp: (spellId) => getSpellBaseXp(spellId),

            // --- Spell Validation/Execution ---
            validateSpellCast: (context) => SpellCaster.validate(context),
            executeSpellCast: (context, validation) => SpellCaster.execute(context, validation),

            // --- Projectile ---
            computeProjectileEndHeight: (opts) => this.computeProjectileEndHeight(opts),
            estimateProjectileTiming: (opts) => this.estimateProjectileTiming(opts),
            buildAndQueueSpellProjectileLaunch: (opts) => {
                if (!this.projectileSystem) return;
                const launch = this.projectileSystem.buildSpellProjectileLaunch({
                    player: opts.player,
                    targetNpc: opts.targetNpc,
                    targetPlayer: opts.targetPlayer,
                    targetTile: opts.targetTile,
                    spellData: opts.spellData,
                    projectileDefaults: opts.projectileDefaults,
                    endHeight: opts.endHeight,
                    timing: opts.timing,
                    impactDelayTicks: opts.impactDelayTicks,
                });
                if (launch) {
                    this.queueProjectileForViewers(launch);
                }
            },

            // --- Effects ---
            queueSpellResult: (playerId, payload) => this.queueSpellResult(playerId, payload),
            enqueueSpotAnimation: (request) => this.enqueueSpotAnimation(request),
            enqueueSpellFailureChat: (player, spellId, reason) =>
                this.enqueueSpellFailureChat(player, spellId, reason),
            pickSpellSound: (spellId, stage) => this.pickSpellSound(spellId, stage),
            broadcastSound: (request, tag) => this.broadcastSound(request, tag),
            withDirectSendBypass: (tag, fn) => this.withDirectSendBypass(tag, fn),
            resetAutocast: (player) => this.resetAutocast(player),

            // --- Combat State ---
            queueCombatSnapshot: (
                playerId,
                weaponCategory,
                weaponItemId,
                autoRetaliate,
                styleSlot,
                activePrayers,
                specialPercent,
            ) =>
                this.queueCombatSnapshot(
                    playerId,
                    weaponCategory,
                    weaponItemId,
                    autoRetaliate,
                    styleSlot,
                    activePrayers,
                    specialPercent,
                ),
            pickAttackSequence: (player) => this.pickAttackSequence(player),
            pickSpellCastSequence: (player, spellId, isAutocast) =>
                this.pickSpellCastSequence(player, spellId, isAutocast),
            pickAttackSpeed: (player) => this.pickAttackSpeed(player),
            clearAllInteractions: (socket) => this.players?.clearAllInteractions(socket),
            clearActionsInGroup: (playerId, group) =>
                this.actionScheduler.clearActionsInGroup(playerId, group),
            startNpcCombat: (player, npc, tick, attackSpeed) => {
                this.playerCombatManager?.startCombat(player, npc, tick, attackSpeed);
            },
            stopAutoAttack: (playerId) => this.playerCombatManager?.stopAutoAttack(playerId),

            // --- Inventory ---
            sendInventorySnapshot: (socket, player) => this.sendInventorySnapshot(socket, player),

            // --- Action Scheduling ---
            scheduleAction: (playerId, request, tick) =>
                this.actionScheduler.requestAction(playerId, request, tick),

            // --- XP ---
            awardSkillXp: (player, skillId, xp) => this.awardSkillXp(player, skillId, xp),

            // --- PvP Combat ---
            planPlayerVsPlayerMagic: (attacker, target) => {
                try {
                    const engine = new CombatEngine();
                    const res = engine.planPlayerVsPlayerMagic(attacker, target);
                    return {
                        hitLanded: !!res.hitLanded,
                        maxHit: res.maxHit,
                        damage: res.damage,
                    };
                } catch {
                    return { hitLanded: false, maxHit: 0, damage: 0 };
                }
            },
            planPlayerVsNpcMagic: (attacker, target, spellId) => {
                try {
                    const engine = new CombatEngine();
                    const magicCaster = Object.create(attacker) as PlayerState;
                    (magicCaster as any).combatSpellId = spellId;
                    (magicCaster as any).autocastEnabled = false;
                    (magicCaster as any).autocastMode = null;
                    (magicCaster as any).getCurrentAttackType = () => "magic";
                    const res = engine.planPlayerAttack({
                        player: magicCaster,
                        npc: target,
                        attackSpeed: this.pickAttackSpeed(attacker),
                    });
                    return {
                        hitLanded: !!res.hitLanded,
                        maxHit: res.maxHit,
                        damage: res.damage,
                    };
                } catch {
                    return { hitLanded: false, maxHit: 0, damage: 0 };
                }
            },

            // --- Helpers ---
            faceAngleRs: (x1, y1, x2, y2) => faceAngleRs(x1, y1, x2, y2),
            testRandFloat: () => testRandFloat(),
            getTestHitForce: () => TEST_HIT_FORCE,

            // --- Logging ---
            log: (level, message, data) => {
                try {
                    if (level === "warn") logger.warn(message, data);
                    else if (level === "error") logger.error(message, data);
                    else logger.info(message, data);
                } catch {}
            },
        };
        return new SpellActionHandler(services);
    }

    /**
     * Create the InventoryActionHandler with all required services.
     */
    private createInventoryActionHandler(): InventoryActionHandler {
        const services: InventoryActionServices = {
            // --- Core ---
            getCurrentTick: () => this.options.ticker.currentTick(),

            // --- Entity Access ---
            getNpc: (id) => this.npcManager?.getById(id) ?? undefined,
            getPlayer: (id) => this.players?.getById(id) ?? undefined,

            // --- Inventory Operations ---
            getInventory: (player) => this.getInventory(player),
            addItemToInventory: (player, itemId, quantity) =>
                this.addItemToInventory(player, itemId, quantity),
            consumeItem: (player, slot) => this.consumeItem(player, slot),
            countInventoryItem: (player, itemId) => this.countInventoryItem(player, itemId),
            markInventoryDirty: (player) => player.markInventoryDirty(),

            // --- Equipment ---
            resolveEquipSlot: (itemId) => this.resolveEquipSlot(itemId),
            equipItem: (player, slotIndex, itemId, equipSlot, options) =>
                this.equipItem(player, slotIndex, itemId, equipSlot, options),
            unequipItem: (player, equipSlot) => {
                // OSRS parity: Unequipping closes interruptible interfaces (modals, dialogs)
                this.closeInterruptibleInterfaces(player);

                const appearance = this.getOrCreateAppearance(player);
                return unequipItemApply({
                    appearance,
                    equipSlot,
                    addItemToInventory: (id, qty) => this.addItemToInventory(player, id, qty),
                    slotCount: EQUIP_SLOT_COUNT,
                });
            },
            ensureEquipArray: (player) => this.ensureEquipArray(player),
            refreshCombatWeaponCategory: (player) => this.refreshCombatWeaponCategory(player),
            refreshAppearanceKits: (player) => this.refreshAppearanceKits(player),
            resetAutocast: (player) => this.resetAutocast(player),
            pickEquipSound: (slot, itemName) => pickEquipSound(slot, itemName),

            // --- Object Types ---
            getObjType: (itemId) => this.getObjType(itemId),
            isConsumable: (obj, option) => this.isConsumable(obj as any, option),
            isRangeLoc: (locId) => this.isRangeLoc(locId),

            // --- Pathfinding ---
            createRectAdjacentStrategy: (x, y, sizeX, sizeY) =>
                new RectAdjacentRouteStrategy(x, y, sizeX, sizeY),
            findPathSteps: (from, to, size, strategy) => {
                const pathService = this.options.pathService;
                if (!pathService) return { ok: false };
                const res = pathService.findPathSteps(
                    {
                        from,
                        to,
                        size,
                    },
                    {
                        maxSteps: 128,
                        routeStrategy: strategy as any,
                    },
                );
                return { ok: res.ok, steps: res.steps, end: res.end };
            },

            // --- Action Scheduling ---
            scheduleAction: (playerId, request, tick) =>
                this.actionScheduler.requestAction(playerId, request, tick),

            // --- Effects ---
            queueChatMessage: (request) => this.queueChatMessage(request),
            buildSkillFailure: (player, message, reason) =>
                this.buildSkillFailure(player, message, reason),
            playLocSound: (request) => this.playLocSound(request),

            // --- Cooking (late-bound by production extrascript) ---
            getCookingRecipeByRawItemId: undefined,
            getFireNode: (tile, level) => this.firemakingTracker.getFireNode(tile, level),
            isSmithingLoc: (locId) => {
                const normalizedLocId = locId;
                for (let opNum = 1; opNum <= 5; opNum++) {
                    const action = this.resolveLocActionByOpNum(normalizedLocId, opNum);
                    if (action === "smith") {
                        return true;
                    }
                }
                return false;
            },
            getSmithingBarTypeByItem: (itemId) => {
                return this.scriptRuntime.getServices().production?.getBarTypeByItemId?.(itemId);
            },
            setSmithingBarType: (player, barType) => {
                player.setVarbitValue(SMITHING_BAR_TYPE_VARBIT_ID, barType);
            },

            // --- Script Runtime ---
            queueLocInteraction: (request) => this.scriptRuntime.queueLocInteraction(request),
            queueItemOnLoc: (request) => this.scriptRuntime.queueItemOnLoc(request),
            queueItemOnItem: (request) => this.scriptRuntime.queueItemOnItem(request),

            // --- Scripted Consume ---
            executeScriptedConsume: (player, itemId, slotIndex, option, tick) => {
                const handler = this.scriptRegistry.findItemAction(itemId, option);
                if (handler) {
                    handler({
                        player,
                        source: { slot: slotIndex, itemId },
                        target: { slot: -1, itemId: -1 },
                        option,
                        tick: tick ?? 0,
                        services: this.scriptRuntime.getServices(),
                    });
                    return { handled: true };
                }
                return { handled: false };
            },

            // --- Logging ---
            log: (level, message, data) => {
                try {
                    if (level === "warn") logger.warn(message, data);
                    else if (level === "error") logger.error(message, data);
                    else logger.info(message, data);
                } catch {}
            },
        };
        return new InventoryActionHandler(services);
    }

    /**
     * Create the EffectDispatcher with all required services.
     */
    private createEffectDispatcher(): EffectDispatcher {
        const services: EffectDispatcherServices = {
            // --- Entity Access ---
            getPlayer: (id) => this.players?.getById(id) ?? undefined,
            getPlayerSocket: (playerId) => this.players?.getSocketByPlayerId(playerId),
            isSocketOpen: (socket) => socket?.readyState === WebSocket.OPEN,

            // --- Effect Queueing ---
            enqueueForcedChat: (event) => this.enqueueForcedChat(event),
            enqueueForcedMovement: (event) => this.enqueueForcedMovement(event),
            enqueueLevelUpPopup: (player, popup) => this.enqueueLevelUpPopup(player, popup),
            queueHitsplat: (hitsplat, frame) => {
                if (frame) {
                    frame.hitsplats.push(hitsplat);
                } else {
                    this.broadcastScheduler.queueHitsplat(hitsplat);
                }
            },

            // --- Snapshots ---
            checkAndSendSnapshots: (player, socket) => this.checkAndSendSnapshots(player, socket),

            // --- Chat ---
            queueChatMessage: (request) => this.queueChatMessage(request as any),

            // --- Sound ---
            sendSound: (player, soundId, options) => this.sendSound(player, soundId, options),

            // --- Projectile ---
            queueProjectileForViewers: (projectile) => this.queueProjectileForViewers(projectile),

            // --- Frame Access ---
            getActiveFrame: () => this.activeFrame,

            // --- Constants ---
            getPlayerTakeDamageSound: () => PLAYER_TAKE_DAMAGE_SOUND,
            getPlayerZeroDamageSound: () => PLAYER_ZERO_DAMAGE_SOUND,
            getCombatSoundDelayMs: () => COMBAT_SOUND_DELAY_MS,

            // --- Logging ---
            log: (level, message) => {
                if (level === "error") logger.error(message);
                else if (level === "warn") logger.warn(message);
                else logger.info(message);
            },
        };
        return new EffectDispatcher(services);
    }

    /**
     * Create the WidgetDialogHandler with all required services.
     */
    private createWidgetDialogHandler(): WidgetDialogHandler {
        const services: WidgetDialogServices = {
            // --- Entity Access ---
            getPlayer: (id) => this.players?.getById(id) ?? undefined,
            getPlayerFromSocket: (ws) => this.players?.get(ws) ?? undefined,

            // --- Tick ---
            getCurrentTick: () => this.options.ticker.currentTick(),

            // --- Widget Events ---
            queueWidgetEvent: (playerId, action) => this.queueWidgetEvent(playerId, action as any),
            queueClientScript: (playerId, scriptId, ...args) =>
                this.queueClientScript(playerId, scriptId, ...args),
            queueVarbit: (playerId, varbitId, value) => this.queueVarbit(playerId, varbitId, value),

            // --- Script Runtime ---
            queueWidgetAction: (request) => this.scriptRuntime.queueWidgetAction(request),

            // --- Shop/Smithing/Bank ---
            closeShopInterface: (player, options) => this.scriptRuntime.getServices().closeShop?.(player),
            closeBank: (player) => this.interfaceService?.closeModal(player),
            queueSmithingInterfaceMessage: (playerId, payload) =>
                this.queueSmithingInterfaceMessage(playerId, payload as any),

            // --- Constants ---
            getShopGroupId: () => 300,
            getBankGroupId: () => 12,
            getSmithingGroupId: () => SMITHING_GROUP_ID,

            // --- Logging ---
            log: (level, message, error) => {
                if (level === "error") logger.error(message, error);
                else if (level === "warn") logger.warn(message, error);
                else if (level === "debug") logger.debug(message);
                else logger.info(message);
            },
        };
        // Pass InterfaceService for unified chatbox modal management
        return new WidgetDialogHandler(services, this.interfaceService!);
    }

    private createCs2ModalManager(): Cs2ModalManager {
        const services: Cs2ModalManagerServices = {
            openModal: (player, interfaceId, data) =>
                this.interfaceService?.openModal(player, interfaceId, data),
            closeModal: (player) => this.interfaceService?.closeModal(player),
            getCurrentModal: (player) => this.interfaceService?.getCurrentModal(player),
            queueWidgetEvent: (playerId, event) => this.queueWidgetEvent(playerId, event as any),
            queueGameMessage: (playerId, text) =>
                this.queueChatMessage({
                    messageType: "game",
                    text: String(text ?? ""),
                    targetPlayerIds: [playerId],
                }),
            setSmithingBarType: (player, barType) =>
                player.setVarbitValue(SMITHING_BAR_TYPE_VARBIT_ID, barType),
            openSmithingForgeInterface: (player) => {
                this.scriptRuntime.getServices().production?.openForgeInterface?.(player);
            },
        };
        return new Cs2ModalManager(services);
    }

    /**
     * Create the NpcSyncManager with all required services.
     */
    private createNpcSyncManager(): NpcSyncManager {
        const services: NpcSyncManagerServices = {
            // --- NPC Access ---
            getNpcManager: () => this.npcManager,

            // --- Health Bar Definitions ---
            getHealthBarDefLoader: () => this.healthBarDefLoader,

            // --- Packet Buffer Access ---
            getPendingNpcPackets: () => this.pendingNpcPackets,

            // --- Logging ---
            log: (level, message) => {
                if (level === "error") logger.error(message);
                else if (level === "warn") logger.warn(message);
                else if (level === "debug") logger.debug(message);
                else logger.info(message);
            },
        };
        return new NpcSyncManager(services);
    }

    private createPlayerAppearanceManager(): PlayerAppearanceManager {
        const services: PlayerAppearanceServices = {
            getPendingAppearanceSnapshots: () => this.broadcastScheduler.getPendingAppearanceSnapshots(),
            getObjTypeLoader: () => this.objTypeLoader,
            getBasTypeLoader: () => this.basTypeLoader,
            getIdkTypeLoader: () => this.idkTypeLoader,
            getDefaultBodyKits: (gender) => this.getDefaultBodyKits(gender),
            ensureEquipArray: (player) => this.ensureEquipArray(player),
            getObjType: (id) => this.getObjType(id),
            buildAnimPayload: (player) => this.buildAnimPayload(player),
            getDefaultPlayerAnimMale: () => this.defaultPlayerAnimMale,
            getDefaultPlayerAnimFemale: () => this.defaultPlayerAnimFemale,
            getDefaultPlayerAnim: () => this.defaultPlayerAnim,
            getWeaponAnimOverrides: () => this.weaponAnimOverrides,
            applyWeaponAnimOverrides: (player, animTarget) =>
                this.applyWeaponAnimOverrides(player, animTarget),
            log: (level, message) => {
                if (level === "error") logger.error(message);
                else if (level === "warn") logger.warn(message);
                else if (level === "debug") logger.debug(message);
                else logger.info(message);
            },
        };
        return new PlayerAppearanceManager(services);
    }

    private createSoundManager(): SoundManager {
        const services: SoundManagerServices = {
            getPlayers: () => this.players,
            getNpcSoundLookup: () => this.npcSoundLookup,
            getMusicRegionService: () => this.musicRegionService,
            getMusicCatalogService: () => this.musicCatalogService,
            getMusicUnlockService: () => this.musicUnlockService,
            getNpcTypeLoader: () => this.npcTypeLoader,
            getDbRepository: () => this.dbRepository,
            getWeaponData: () => this.weaponData,
            ensureEquipArray: (player) => this.ensureEquipArray(player),
            getCurrentTick: () => this.options.ticker.currentTick(),
            random: () => Math.random(),
            getVarpMusicPlay: () => VARP_MUSICPLAY,
            getVarpMusicCurrentTrack: () => VARP_MUSIC_CURRENT_TRACK,
            sendWithGuard: (sock, message, context) => this.sendWithGuard(sock, message, context),
            encodeMessage: (msg) => encodeMessage(msg as any),
            queueChatMessage: (request) => this.queueChatMessage(request),
            queueClientScript: (playerId, scriptId, ...args) =>
                this.queueClientScript(playerId, scriptId, ...args),
            queueVarp: (playerId, varpId, value) => this.queueVarp(playerId, varpId, value),
            broadcastToNearby: (x, y, level, radius, message, context) =>
                this.broadcastToNearby(x, y, level, radius, message, context),
            withDirectSendBypass: (context, fn) => this.withDirectSendBypass(context, fn),
            getNpcCombatDefs: () => this.npcCombatDefs,
            getNpcCombatDefaults: () =>
                this.npcCombatDefaults ?? {
                    deathSound: 512,
                },
            loadNpcCombatDefs: () => this.loadNpcCombatDefs(),
            log: (level, message) => {
                if (level === "error") logger.error(message);
                else if (level === "warn") logger.warn(message);
                else if (level === "debug") logger.debug(message);
                else logger.info(message);
            },
        };
        return new SoundManager(services);
    }

    private createGroundItemHandler(): GroundItemHandler {
        const players = this.players;
        if (!players) {
            throw new Error("Player manager unavailable for ground item handler");
        }
        const services: GroundItemHandlerServices = {
            getGroundItems: () => this.groundItems,
            getPlayers: () => players,
            getCurrentTick: () => this.options.ticker.currentTick(),
            getPlayerGroundSerial: () => this.playerGroundSerial,
            getPlayerGroundChunk: () => this.playerGroundChunk,
            getGroundChunkKey: (player) => this.getGroundChunkKey(player),
            addItemToInventory: (player, itemId, quantity) =>
                this.addItemToInventory(player, itemId, quantity),
            getItemDefinition: (itemId) => this.getObjType(itemId) ?? getItemDefinition(itemId),
            isInWilderness: (x, y) => isInWilderness(x, y),
            sendPickupSound: (player) => this.sendSound(player, 2582),
            sendLootNotification: (player, itemId, quantity) =>
                this.sendLootNotification(player, itemId, quantity),
            trackCollectionLogItem: (player, itemId) =>
                this.doTrackCollectionLogItem(player, itemId),
            queueChatMessage: (request) => this.queueChatMessage(request),
            sendWithGuard: (sock, message, context) => this.sendWithGuard(sock, message, context),
            encodeMessage: (msg) => encodeMessage(msg as any),
            withDirectSendBypass: (context, fn) => this.withDirectSendBypass(context, fn),
            log: (level, message) => {
                if (level === "error") logger.error(message);
                else if (level === "warn") logger.warn(message);
                else if (level === "debug") logger.debug(message);
                else logger.info(message);
            },
        };
        return new GroundItemHandler(services);
    }

    private createPlayerDeathService(): PlayerDeathService {
        const services: PlayerDeathServices = {
            groundItemManager: this.groundItems,
            getCurrentTick: () => this.options.ticker.currentTick(),
            isInWilderness: (x, y) => isInWilderness(x, y),
            getWildernessLevel: (x, y) => getWildernessLevel(x, y),
            getItemDefinition: (itemId) => getItemDefinition(itemId),
            sendMessage: (player, message) => {
                // Queue chat message - will be processed during broadcast phase
                this.queueChatMessage({
                    messageType: "game",
                    text: message,
                    targetPlayerIds: [player.id],
                });
            },
            teleportPlayer: (player, x, y, level, forceRebuild = false) =>
                this.teleportPlayer(player, x, y, level, forceRebuild),
            playAnimation: (player, animId) => {
                try {
                    player.queueOneShotSeq(animId, 0);
                } catch {}
            },
            clearAnimation: (player) => {
                try {
                    player.queueOneShotSeq(-1, 0);
                } catch {}
            },
            refreshAppearance: (player) => {
                this.refreshAppearanceKits(player);
                player.markAppearanceDirty();
                this.queueAppearanceSnapshot(player);
                // Note: queueAnimSnapshot is no longer needed here since the appearance block
                // now includes the animation set
            },
            sendInventoryUpdate: (player) => {
                const sock = this.players?.getSocketByPlayerId(player.id);
                if (sock) {
                    this.sendInventorySnapshot(sock, player);
                }
            },
            playJingle: (player, jingleId) => {
                this.soundManager?.sendJingle(player, jingleId);
            },
            pathService: this.options.pathService,
            log: (level, message) => {
                if (level === "error") logger.error(`[death] ${message}`);
                else if (level === "warn") logger.warn(`[death] ${message}`);
                else logger.info(`[death] ${message}`);
            },
            clearCombat: (player) => {
                const sock = this.players?.getSocketByPlayerId(player.id);
                if (sock) {
                    try { this.players?.clearAllInteractions(sock); } catch {}
                }
            },
            clearNpcTargetsForPlayer: (playerId) => {
                const nowTick = this.options.ticker.currentTick();
                this.npcManager?.forEach((npc) => {
                    try {
                        if (npc.getCombatTargetPlayerId() === playerId) {
                            npc.disengageCombat();
                            // Delay next aggression check by 10 ticks (6s) so the NPC
                            // does not immediately re-aggro the respawned player
                            npc.scheduleNextAggressionCheck(nowTick, 10);
                        }
                    } catch {}
                });
            },
        };
        return new PlayerDeathService({ services });
    }

    /**
     * Create the ProjectileSystem with all required services.
     */
    private createProjectileSystem(): ProjectileSystem {
        const services: ProjectileSystemServices = {
            getCurrentTick: () => this.options.ticker.currentTick(),
            getTickMs: () => this.options.tickMs,
            getActiveFrameTick: () => this.activeFrame?.tick,
            forEachPlayer: (callback) => {
                if (!this.players) return;
                this.players.forEach((_sock, player) => callback(player));
            },
            log: (level, message) => {
                if (level === "error") logger.error(message);
                else if (level === "warn") logger.warn(message);
                else logger.info(message);
            },
        };
        return new ProjectileSystem(services);
    }

    /**
     * Create the GatheringSystemManager with all required services.
     */
    private createGatheringSystem(): GatheringSystemManager {
        const services: GatheringSystemServices = {
            emitLocChange: (oldId, newId, tile, level, opts) =>
                this.emitLocChange(oldId, newId, tile, level, opts),
            spawnGroundItem: (itemId, quantity, tile, currentTick, opts) =>
                this.groundItems.spawn(itemId, quantity, tile, currentTick, opts),
        };
        return new GatheringSystemManager(services);
    }

    /**
     * Create the EquipmentHandler with all required services.
     */
    private createEquipmentHandler(): EquipmentHandler {
        const services: EquipmentHandlerServices = {
            getInventory: (player) => this.getInventory(player),
            getObjType: (itemId) => this.getObjType(itemId),
            addItemToInventory: (player, itemId, quantity) =>
                this.addItemToInventory(player, itemId, quantity),
            closeInterruptibleInterfaces: (player) => this.closeInterruptibleInterfaces(player),
            refreshCombatWeaponCategory: (player) => this.refreshCombatWeaponCategory(player),
            refreshAppearanceKits: (player) => this.refreshAppearanceKits(player),
            resetAutocast: (player) => this.resetAutocast(player),
            playLocSound: (opts) => this.playLocSound(opts),
        };
        return new EquipmentHandler(services);
    }

    /**
     * Build the ScriptServices object for the ScriptRuntime.
     * Extracted from the constructor to reduce constructor size and make
     * the services wiring independently modifiable.
     */
    private buildScriptServiceObject(
        locTypeLoader: any,
        combatEffectApplicator: any,
    ): import("../game/scripts/types").ScriptServices {
        const snapshotInventoryFn = (player: PlayerState): void => {
            try {
                const sock = this.players?.getSocketByPlayerId(player.id);
                if (sock) this.sendInventorySnapshot(sock, player);
            } catch {}
        };
        return {
                getDbRepository: () => this.dbRepository,
                // Use functions to defer loading - cache loaders are initialized later
                getEnumTypeLoader: () => this.enumTypeLoader,
                getStructTypeLoader: () => this.structTypeLoader,
                getIdkTypeLoader: () => this.idkTypeLoader,
                doorManager: this.doorManager,
                emitLocChange: (oldId, newId, tile, level, opts) =>
                    this.emitLocChange(oldId, newId, tile, level, opts),
                sendLocChangeToPlayer: (player, oldId, newId, tile, level) =>
                    this.sendLocChangeToPlayer(player, oldId, newId, tile, level),
                spawnLocForPlayer: (player, locId, tile, level, shape, rotation) =>
                    this.spawnLocForPlayer(player, locId, tile, level, shape, rotation),
                getObjType: (id) => this.getObjType(id),
                getLocDefinition: (id) => {
                    try {
                        return locTypeLoader?.load?.(id);
                    } catch {
                        return undefined;
                    }
                },
                consumeItem: (player, slotIndex) => this.consumeItem(player, slotIndex),
                getInventoryItems: (player) =>
                    this.getInventory(player).map((entry, idx) => ({
                        slot: idx,
                        itemId: entry ? entry.itemId : -1,
                        quantity: entry ? entry.quantity : 0,
                    })),
                addSkillXp: (player, skillId, xp) => {
                    try {
                        this.awardSkillXp(player, skillId as SkillId, Number.isFinite(xp) ? xp : 0);
                    } catch {}
                },
                playPlayerSeq: (player, seqId, delay = 0) => {
                    try {
                        player.queueOneShotSeq(seqId, delay);
                    } catch {}
                },
                playPlayerSeqImmediate: (player, seqId) => {
                    try {
                        // OSRS parity: sequences are delivered via player update blocks.
                        player.queueOneShotSeq(seqId, 0);
                    } catch {}
                },
                getEquippedItem: (player, slot) => {
                    try {
                        const equip = this.ensureEquipArray(player);
                        return equip[slot] ?? -1;
                    } catch {
                        return -1;
                    }
                },
                unequipItem: (player, slot) => {
                    try {
                        const slotIndex = Math.max(0, Math.min(EQUIP_SLOT_COUNT - 1, slot));
                        const equip = this.ensureEquipArray(player);
                        const itemId = equip[slotIndex];
                        if (!(itemId > 0)) return false;

                        const result = this.inventoryActionHandler.executeInventoryUnequipAction(
                            player,
                            {
                                slot: slotIndex,
                                playSound: true,
                            },
                        );
                        if (result.ok && result.effects) {
                            this.effectDispatcher.dispatchActionEffects(result.effects);
                        }
                        return result.ok;
                    } catch {
                        return false;
                    }
                },
                broadcastPlayerSpot: (player, spotId, height = 0, delay = 0, slotArg?: number) => {
                    try {
                        // OSRS parity: encode actor spot anim via the player update block.
                        // Stage into the tick-frame so it is emitted alongside other state.
                        const tick = this.options.ticker.currentTick();
                        const slot =
                            slotArg !== undefined && Number.isFinite(slotArg)
                                ? slotArg & 0xff
                                : undefined;
                        this.enqueueSpotAnimation({
                            tick,
                            playerId: player.id,
                            spotId: spotId,
                            height: height,
                            delay: delay,
                            slot,
                        });
                    } catch {}
                },
                playLocGraphic: (opts) => this.playLocGraphic(opts),
                playLocSound: (opts) => this.playLocSound(opts),
                playAreaSound: (opts) => this.playAreaSound(opts),
                playSong: (player, trackId, trackName) =>
                    this.soundManager.playSongForPlayer(player, trackId, trackName),
                skipMusicTrack: (player) => this.soundManager.skipTrackForPlayer(player),
                getMusicTrackId: (trackName) => this.getMusicTrackIdByName(trackName),
                getMusicTrackBySlot: (slot) =>
                    this.musicCatalogService?.getBaseListTrackBySlot(slot),
                sendGameMessage: (player: PlayerState, text: string) => this.sendGameMessageToPlayer(player, text),
                getCurrentTick: () => this.options.ticker.currentTick(),
                getPathService: () => this.options.pathService,
                snapshotInventory: snapshotInventoryFn,
                snapshotInventoryImmediate: snapshotInventoryFn,
                setInventorySlot: (player, slotIndex, itemId, qty) =>
                    this.setInventorySlot(player, slotIndex, itemId, qty),
                addItemToInventory: (player, itemId, qty) =>
                    this.addItemToInventory(player, itemId, qty),
                spawnNpc: (config) => this.npcManager?.spawnTransientNpc(config),
                removeNpc: (npcId) => this.npcManager?.removeNpc(npcId) ?? false,
                openDialog: (player, request) =>
                    this.widgetDialogHandler.openDialog(player, request as any),
                openDialogOptions: (player, options) =>
                    this.widgetDialogHandler.openDialogOptions(player, options as any),
                closeDialog: (player, dialogId) =>
                    this.widgetDialogHandler.closeDialog(player, dialogId),
                closeInterruptibleInterfaces: (player) => this.closeInterruptibleInterfaces(player),
                queueForcedMovement: (player, params) => {
                    const currentTick = this.options.ticker.currentTick();
                    const deliveryTick = this.activeFrame ? this.activeFrame.tick : currentTick + 1;
                    const requestedStartTick = params.startTick ?? deliveryTick;
                    const requestedEndTick = params.endTick;
                    const durationTicks = Math.max(0, requestedEndTick - requestedStartTick);
                    // Dialog/widget callbacks can fire several ticks after the original interaction.
                    // Exact-move timing must be rebased to the frame that will actually deliver it,
                    // while preserving the requested duration.
                    const normalizedStartTick = Math.max(deliveryTick, requestedStartTick);
                    const normalizedEndTick = normalizedStartTick + durationTicks;
                    const startTile = params.startTile;
                    const endTile = params.endTile;
                    const startX = (startTile.x << 7) + 64;
                    const startY = (startTile.y << 7) + 64;
                    const endX = (endTile.x << 7) + 64;
                    const endY = (endTile.y << 7) + 64;
                    this.enqueueForcedMovement({
                        targetId: player.id,
                        startDeltaX: startTile.x - player.tileX,
                        startDeltaY: startTile.y - player.tileY,
                        endDeltaX: endTile.x - player.tileX,
                        endDeltaY: endTile.y - player.tileY,
                        startCycle: normalizedStartTick,
                        endCycle: normalizedEndTick,
                        direction: params.direction ?? faceAngleRs(startX, startY, endX, endY),
                    });
                },
                requestAction: (player, request, currentTick) =>
                    (() => {
                        try {
                            const groups = Array.isArray(request?.groups) ? request.groups : [];
                            // Starting a new woodcutting action should replace any in-progress chop loop.
                            if (groups.includes("skill.woodcut")) {
                                this.actionScheduler.clearActionsInGroup(
                                    player.id,
                                    "skill.woodcut",
                                );
                            }
                        } catch {}
                        return this.actionScheduler.requestAction(
                            player.id,
                            request,
                            Number.isFinite(currentTick)
                                ? (currentTick as number)
                                : this.options.ticker.currentTick(),
                        );
                    })(),
                findOwnedItemLocation: (player, itemId) =>
                    this.findOwnedItemLocation(player, itemId),
                getWoodcuttingTree: (locId) => this.getWoodcuttingTreeDefinition(locId),
                getMiningRock: (locId) => this.getMiningRockDefinition(locId),
                getFishingSpot: (npcTypeId) => this.getFishingSpotDefinition(npcTypeId),
                applyPrayers: (player, prayers) => {
                    // Capture previous prayers before applying changes
                    const previousPrayers = new Set(player.getActivePrayers());
                    const result = this.prayerSystem.applySelection(player, prayers);
                    if (result.errors.length) {
                        for (const err of result.errors) {
                            this.queueChatMessage({
                                messageType: "game",
                                text: err.message,
                                targetPlayerIds: [player.id],
                            });
                        }
                    }
                    if (result.changed || result.errors.length) {
                        this.queueCombatSnapshot(
                            player.id,
                            player.combatWeaponCategory,
                            player.combatWeaponItemId,
                            !!player.autoRetaliate,
                            player.combatStyleSlot,
                            result.activePrayers,
                            player.combatSpellId > 0 ? player.combatSpellId : undefined,
                        );
                        // Queue appearance update to sync headIcons for overhead prayer display
                        this.queueAppearanceSnapshot(player);
                    }
                    // Play prayer sounds for activation/deactivation
                    if (result.changed) {
                        const currentPrayers = new Set(result.activePrayers);
                        // Find newly activated prayers and play their sounds
                        for (const prayer of currentPrayers) {
                            if (!previousPrayers.has(prayer)) {
                                const soundId = PRAYER_ACTIVATE_SOUNDS.get(prayer);
                                if (soundId != null) {
                                    this.sendSound(player, soundId);
                                }
                            }
                        }
                        // If any prayers were deactivated, play deactivation sound once
                        for (const prayer of previousPrayers) {
                            if (!currentPrayers.has(prayer)) {
                                this.sendSound(player, PRAYER_DEACTIVATE_SOUND);
                                break; // Only play once even if multiple deactivated
                            }
                        }
                    }
                    return result;
                },
                setCombatSpell: (player, spellId) => {
                    player.setCombatSpell(spellId ?? null);
                    this.queueCombatSnapshot(
                        player.id,
                        player.combatWeaponCategory,
                        player.combatWeaponItemId,
                        !!player.autoRetaliate,
                        player.combatStyleSlot,
                        Array.from(player.activePrayers ?? []),
                        player.combatSpellId > 0 ? player.combatSpellId : undefined,
                    );
                },
                queueCombatState: (player) =>
                    this.queueCombatSnapshot(
                        player.id,
                        player.combatWeaponCategory,
                        player.combatWeaponItemId,
                        !!player.autoRetaliate,
                        player.combatStyleSlot,
                        Array.from(player.activePrayers ?? []),
                        player.combatSpellId > 0 ? player.combatSpellId : undefined,
                    ),
                openSubInterface: (player, targetUid, groupId, type = 0, opts) => {
                    const t = type;
                    const varps =
                        opts?.varps && Object.keys(opts.varps).length > 0 ? opts.varps : undefined;
                    const varbits =
                        opts?.varbits && Object.keys(opts.varbits).length > 0
                            ? opts.varbits
                            : undefined;
                    const preScripts =
                        Array.isArray(opts?.preScripts) && opts.preScripts.length > 0
                            ? opts.preScripts
                            : undefined;
                    const postScripts =
                        Array.isArray(opts?.postScripts) && opts.postScripts.length > 0
                            ? opts.postScripts
                            : undefined;
                    const explicitHiddenUids =
                        Array.isArray((opts as any)?.hiddenUids) &&
                        (opts as any).hiddenUids.length > 0
                            ? ((opts as any).hiddenUids as number[]).map((uid) => uid)
                            : undefined;
                    const hiddenUids = explicitHiddenUids;

                    // Track sub-interfaces via PlayerWidgetManager so they can be closed
                    // on IF_CLOSE / walk / damage / etc.
                    // Type 0 (modal) and type 1 (overlay on floater) are both closeable.
                    // IMPORTANT: avoid double-sending packets (PlayerWidgetManager.open will dispatch open_sub).
                    if (t === 0 || t === 1) {
                        player.widgets.open(groupId, {
                            targetUid: targetUid,
                            type: t,
                            modal: opts?.modal !== false,
                            varps,
                            varbits,
                            hiddenUids,
                            preScripts,
                            postScripts,
                        });
                        return;
                    }

                    // Other types (e.g. 3 = tab replacement) are sent directly.
                    const action: any = {
                        action: "open_sub",
                        targetUid: targetUid,
                        groupId: groupId,
                        type: t,
                    };
                    if (varps) action.varps = varps;
                    if (varbits) action.varbits = varbits;
                    if (hiddenUids) action.hiddenUids = hiddenUids;
                    if (preScripts) action.preScripts = preScripts;
                    if (postScripts) action.postScripts = postScripts;
                    this.queueWidgetEvent(player.id, action);
                },
                closeSubInterface: (player, targetUid, groupId) => {
                    const closedEntries =
                        groupId !== undefined
                            ? player.widgets.close(groupId)
                            : player.widgets.closeByTargetUid(targetUid);
                    if (closedEntries.length === 0) {
                        this.queueWidgetEvent(player.id, {
                            action: "close_sub",
                            targetUid: targetUid,
                        });
                    }
                    if (this.interfaceService && closedEntries.length > 0) {
                        this.interfaceService.triggerCloseHooksForEntries(player, closedEntries);
                    }
                },
                closeModal: (player) => {
                    // Close via InterfaceService to properly trigger hooks and update tracking
                    this.interfaceService?.closeModal(player);
                },
                teleportPlayer: (player, x, y, level, forceRebuild = false) =>
                    this.teleportPlayer(player, x, y, level, forceRebuild),
                teleportToInstance: (player, x, y, level, templateChunks, extraLocs) =>
                    this.teleportToInstance(player, x, y, level, templateChunks, extraLocs),
                requestTeleportAction: (player, request) =>
                    this.requestTeleportAction(player, request),
                sendVarp: (player, varpId, value) => {
                    // Queue during tick execution to avoid "direct-send" errors.
                    this.queueVarp(player.id, varpId, value);
                },
                sendVarbit: (player, varbitId, value) => {
                    // Queue during tick execution to avoid "direct-send" errors.
                    this.queueVarbit(player.id, varbitId, value);
                },
                sendCollectionLogSnapshot: (player) => {
                    this.sendCollectionLogSnapshot(player);
                },
                openCollectionLog: (player) => {
                    this.doOpenCollectionLog(player);
                },
                openCollectionOverview: (player) => {
                    this.doOpenCollectionOverview(player);
                },
                populateCollectionLogCategories: (player, tabIndex) => {
                    this.doPopulateCollectionLogCategories(player, tabIndex);
                },
                queueVarp: (playerId, varpId, value) => {
                    this.queueVarp(playerId, varpId, value);
                },
                queueVarbit: (playerId, varbitId, value) => {
                    this.queueVarbit(playerId, varbitId, value);
                },
                queueWidgetEvent: (playerId, event) => {
                    this.queueWidgetEvent(playerId, event);
                },
                queueNotification: (playerId, payload) => {
                    this.queueNotification(playerId, payload);
                },
                queueClientScript: (playerId, scriptId, ...args) => {
                    this.queueClientScript(playerId, scriptId, ...args);
                },
                getInterfaceService: () => this.interfaceService,
                sendSound: (player, soundId, opts) => {
                    this.sendSound(player, soundId, opts);
                },
                refreshAppearanceKits: (player) => {
                    this.refreshAppearanceKits(player);
                },
                queueAppearanceSnapshot: (player) => {
                    this.queueAppearanceSnapshot(player);
                },
                savePlayerSnapshot: (player) => {
                    try {
                        const key = player.__saveKey;
                        if (key && key.length > 0) {
                            this.playerPersistence.saveSnapshot(key, player);
                        }
                    } catch {}
                },
                logoutPlayer: (player, reason) => {
                    try {
                        const sock = this.players?.getSocketByPlayerId?.(player.id);
                        if (sock) this.completeLogout(sock, player, reason);
                    } catch {}
                },
                openRemainingTabs: (player) => {
                    // Open the remaining tab interfaces when the gamemode tutorial completes
                    // During tutorial, only Quest tab was shown. Now open all other tabs.
                    const { getRemainingTabInterfaces } = require("../widgets/WidgetManager");
                    const displayMode = player.displayMode ?? 1; // Default to RESIZABLE_NORMAL
                    const remainingInterfaces = getRemainingTabInterfaces(displayMode);

                    for (const intf of remainingInterfaces) {
                        player.widgets?.open(intf.groupId, {
                            targetUid: intf.targetUid,
                            type: intf.type,
                            modal: false,
                            postScripts: intf.postScripts,
                        });
                    }
                },
                // --- Action handler services ---
                getNpc: (id) => this.npcManager?.getById(id) ?? undefined,
                getSkill: (player, skillId) => {
                    const skill = player.getSkill(skillId);
                    return { baseLevel: skill.baseLevel, boost: skill.boost, xp: skill.xp };
                },
                isPlayerStunned: (player) => player.timers.has(STUN_TIMER),
                isPlayerInCombat: (player) => player.isBeingAttacked(),
                hasInventorySlot: (player) => player.getFreeSlotCount() > 0,
                applyPlayerHitsplat: (player, style, damage, tick) =>
                    combatEffectApplicator.applyPlayerHitsplat(player, style, damage, tick),
                stunPlayer: (player, ticks) => {
                    player.timers.set(STUN_TIMER, ticks);
                },
                queueNpcForcedChat: (npc, text) => {
                    npc.pendingSay = text;
                },
                queueNpcSeq: (npc, seqId) => {
                    npc.queueOneShotSeq(seqId);
                },
                faceNpcToPlayer: (npc, player) => {
                    npc.faceTile(player.tileX, player.tileY);
                },
                clearPlayerFaceTarget: (player) => {
                    try { player.clearInteraction(); } catch {}
                },
                scheduleAction: (playerId, request, tick) =>
                    this.actionScheduler.requestAction(playerId, request, tick),
                getEquipArray: (player) => this.ensureEquipArray(player),
                // --- Gathering / production skill services ---
                isAdjacentToLoc: (player, locId, tile, level) =>
                    this.isAdjacentToLoc(player, locId, tile, level),
                isAdjacentToNpc: (player, npc) => this.isAdjacentToNpc(player, npc),
                faceGatheringTarget: (player, tile) => this.faceGatheringTarget(player, tile),
                collectCarriedItemIds: (player) => this.collectCarriedItemIds(player),
                findInventorySlotWithItem: (player, itemId) =>
                    this.findInventorySlotWithItem(player, itemId),
                canStoreItem: (player, itemId) => this.canStoreItem(player, itemId),
                playerHasItem: (player, itemId) => this.playerHasItem(player, itemId),
                enqueueSoundBroadcast: (soundId, x, y, level) =>
                    this.enqueueSoundBroadcast(soundId, x, y, level),
                stopPlayerAnimation: (player) => {
                    try { player.stopAnimation(); } catch {}
                },
                stopGatheringInteraction: (player) => {
                    try { player.clearInteraction(); } catch {}
                    try { player.stopAnimation(); } catch {}
                    try { player.clearPath(); } catch {}
                    try { player.clearWalkDestination(); } catch {}
                },
                gathering: this.gatheringSystem,
                isFiremakingTileBlocked: (tile, level) => this.isFiremakingTileBlocked(tile, level),
                lightFire: (params) =>
                    this.firemakingTracker.light({ ...params, burnTicks: params.burnTicks }),
                playerHasTinderbox: (player) => this.playerHasTinderbox(player),
                consumeFiremakingLog: (player, logId, slotIndex) =>
                    this.consumeFiremakingLog(player, logId, slotIndex),
                walkPlayerAwayFromFire: (player, fireTile) => {
                    const westTile = { x: fireTile.x - 1, y: fireTile.y };
                    const canStep = this.options.pathService?.canNpcStep(
                        { x: player.tileX, y: player.tileY, plane: player.level },
                        westTile,
                    ) ?? true;
                    if (canStep && (westTile.x !== player.tileX || westTile.y !== player.tileY)) {
                        player.setPath([westTile], false);
                    }
                },
                getCookingRecipeByRawItemId: undefined,
                production: {
                    takeInventoryItems: (player, inputs) =>
                        this.takeInventoryItems(player, inputs),
                    restoreInventoryRemovals: (player, removed) =>
                        this.restoreInventoryRemovals(player, removed),
                    restoreInventoryItems: (player, itemId, removed) =>
                        this.restoreInventoryItems(player, itemId, removed),
                    queueSmithingMessage: (playerId, payload) =>
                        this.queueSmithingInterfaceMessage(playerId, payload),
                    openSmithingModal: (player, groupId, varbits) =>
                        this.interfaceService?.openModal(player, groupId, undefined, varbits ? { varbits } : undefined),
                    closeSmithingModal: (player) =>
                        this.interfaceService?.closeModal(player),
                    isSmithingModalOpen: (player, groupId) =>
                        this.interfaceService?.isModalOpen(player, groupId) ?? false,
                    openSmithingBarModal: (player) =>
                        this.cs2ModalManager.openSmithingBarModal(player),
                    getBarTypeByItemId: (_itemId) => undefined,
                },
                followers: {
                    summonFollowerFromItem: (player, itemId, npcTypeId) => {
                        const result = this.followerManager?.summonFollowerFromItem(
                            player,
                            itemId,
                            npcTypeId,
                        ) ?? {
                            ok: false as const,
                            reason: "spawn_failed",
                        };
                        if (result.ok) {
                            this.followerCombatManager?.resetPlayer(player.id);
                        }
                        return result;
                    },
                    pickupFollower: (player, npcId) => {
                        const result = this.followerManager?.pickupFollower(player, npcId) ?? {
                            ok: false as const,
                            reason: "missing",
                        };
                        if (result.ok) {
                            this.followerCombatManager?.resetPlayer(player.id);
                        }
                        return result;
                    },
                    metamorphFollower: (player, npcId) => {
                        const result = this.followerManager?.metamorphFollower(player, npcId) ?? {
                            ok: false as const,
                            reason: "missing",
                        };
                        if (result.ok) {
                            this.followerCombatManager?.resetPlayer(player.id);
                        }
                        return result;
                    },
                    callFollower: (player) => {
                        const result = this.followerManager?.callFollower(player) ?? {
                            ok: false as const,
                            reason: "missing",
                        };
                        if (result.ok) {
                            this.followerCombatManager?.resetPlayer(player.id);
                            const npc = this.npcManager?.getById(result.npcId);
                            if (npc) {
                                this.queueExternalNpcTeleportSync(npc);
                            }
                        }
                        return result;
                    },
                    despawnFollowerForPlayer: (playerId, clearPersistentState) => {
                        this.followerCombatManager?.resetPlayer(playerId);
                        return (
                            this.followerManager?.despawnFollowerForPlayer(
                                playerId,
                                clearPersistentState,
                            ) ?? false
                        );
                    },
                },
                sailing: {
                    initSailingInstance: (player) => this.sailingInstanceManager?.initInstance(player),
                    disposeSailingInstance: (player) => this.sailingInstanceManager?.disposeInstance(player),
                    teleportToWorldEntity: (player, x, y, level, entityIndex, configId, sizeX, sizeZ, templateChunks, buildAreas, extraLocs) =>
                        this.teleportToWorldEntity(player, x, y, level, entityIndex, configId, sizeX, sizeZ, templateChunks, buildAreas, extraLocs),
                    sendWorldEntity: (player, entityIndex, configId, sizeX, sizeZ, templateChunks, buildAreas, extraLocs, extraNpcs, drawMode) =>
                        this.sendWorldEntity(player, entityIndex, configId, sizeX, sizeZ, templateChunks, buildAreas, extraLocs, extraNpcs, drawMode),
                    removeWorldEntity: (playerId, entityIndex) => this.worldEntityInfoEncoder.removeEntity(playerId, entityIndex),
                    queueWorldEntityPosition: (playerId, entityIndex, position) => this.worldEntityInfoEncoder.queuePosition(playerId, entityIndex, position),
                    setWorldEntityPosition: (playerId, entityIndex, position) => this.worldEntityInfoEncoder.setPosition(playerId, entityIndex, position),
                    queueWorldEntityMask: (playerId, entityIndex, mask) => this.worldEntityInfoEncoder.queueMaskUpdate(playerId, entityIndex, mask),
                    buildSailingDockedCollision: () => this.sailingInstanceManager?.buildDockedCollision(),
                },
        };
    }

    /**
     * Create the TickPhaseOrchestrator with all required services.
     */
    private createTickOrchestrator(): TickPhaseOrchestrator {
        const services: TickPhaseOrchestratorServices = {
            getTickMs: () => this.options.tickMs,
            createTickFrame: (tick, time) => this.createTickFrame({ tick, time }) as any,
            setActiveFrame: (frame) => {
                this.activeFrame = frame as TickFrame | undefined;
            },
            restorePendingFrame: (frame) => this.restorePendingFrame(frame as TickFrame),
            yieldToEventLoop: (stage) => this.yieldToEventLoop(stage),
            maybeRunAutosave: (frame) => this.maybeRunAutosave(frame as TickFrame),
        };
        const phaseProvider: TickPhaseProvider = {
            broadcastTick: (frame) => this.broadcastTick(frame as TickFrame),
            runPreMovementPhase: (frame) => this.runPreMovementPhase(frame as TickFrame),
            runMovementPhase: (frame) => this.runMovementPhase(frame as TickFrame),
            runMusicPhase: (frame) => this.runMusicPhase(frame as TickFrame),
            runScriptPhase: (frame) => this.runScriptPhase(frame as TickFrame),
            runCombatPhase: (frame) => this.runCombatPhase(frame as TickFrame),
            runDeathPhase: (frame) => this.runDeathPhase(frame as TickFrame),
            runPostScriptPhase: (frame) => this.runPostScriptPhase(frame as TickFrame),
            runPostEffectsPhase: (frame) => this.runPostEffectsPhase(frame as TickFrame),
            runOrphanedPlayersPhase: (frame) => this.runOrphanedPlayersPhase(frame as TickFrame),
            runBroadcastPhase: (frame) => this.runBroadcastPhase(frame as TickFrame),
        };
        return new TickPhaseOrchestrator(services, phaseProvider);
    }

    private createMessageRouter(): MessageRouter {
        const services: MessageRouterServices = {
            getPlayer: (ws) => this.players?.get(ws),
            sendWithGuard: (ws, message, context) => this.sendWithGuard(ws, message, context),
            sendAdminResponse: (ws, message, context) =>
                this.sendAdminResponse(ws, message, context),
            withDirectSendBypass: (context, fn) => this.withDirectSendBypass(context, fn),
            queueChatMessage: (msg) => this.queueChatMessage(msg),
            closeInterruptibleInterfaces: (player) => this.closeInterruptibleInterfaces(player),
            encodeMessage: encodeMessage,
        };

        const router = new MessageRouter(services);

        // Register message handlers
        this.registerMessageHandlers(router);

        return router;
    }

    private registerMessageHandlers(router: MessageRouter): void {
        // Register extracted handlers from MessageHandlers.ts
        const extendedServices: MessageHandlerServices = {
            // Player management
            getPlayer: (ws) => this.players?.get(ws),
            getPlayerById: (id) => this.players?.getById(id),
            startFollowing: (ws, targetId, mode, modifierFlags) =>
                this.players?.startFollowing(ws, targetId, mode, modifierFlags),
            startLocInteract: (ws, opts, currentTick) =>
                this.players?.startLocInteract?.(ws, opts, currentTick),
            clearAllInteractions: (ws) => this.players?.clearAllInteractions(ws),
            startPlayerCombat: (ws, targetId) => this.players?.startPlayerCombat(ws, targetId),

            // Trade
            handleTradeAction: (player, payload, tick) => {
                this.tradeManager?.handleAction(player, payload, tick);
            },

            // Movement
            setPendingWalkCommand: (ws, command) => this.pendingWalkCommands.set(ws, command),
            clearPendingWalkCommand: (ws) => this.pendingWalkCommands.delete(ws),
            clearActionsInGroup: (playerId, group) =>
                this.actionScheduler.clearActionsInGroup(playerId, group),
            canUseAdminTeleport: (player) => this.isAdminPlayer(player),
            teleportPlayer: (player, x, y, level, forceRebuild = false) =>
                this.teleportPlayer(player, x, y, level, forceRebuild),
            teleportToInstance: (player, x, y, level, templateChunks, extraLocs) =>
                this.teleportToInstance(player, x, y, level, templateChunks, extraLocs),
            teleportToWorldEntity: (player, x, y, level, entityIndex, configId, sizeX, sizeZ, templateChunks, buildAreas, extraLocs) =>
                this.teleportToWorldEntity(player, x, y, level, entityIndex, configId, sizeX, sizeZ, templateChunks, buildAreas, extraLocs),
            sendWorldEntity: (player, entityIndex, configId, sizeX, sizeZ, templateChunks, buildAreas, extraLocs, extraNpcs, drawMode) =>
                this.sendWorldEntity(player, entityIndex, configId, sizeX, sizeZ, templateChunks, buildAreas, extraLocs, extraNpcs, drawMode),
            spawnLocForPlayer: (player, locId, tile, level, shape, rotation) =>
                this.spawnLocForPlayer(player, locId, tile, level, shape, rotation),
            spawnNpc: (config: any) => this.npcManager?.spawnTransientNpc(config),
            initSailingInstance: (player) => this.sailingInstanceManager?.initInstance(player),
            disposeSailingInstance: (player) => this.sailingInstanceManager?.disposeInstance(player),
            removeWorldEntity: (playerId, entityIndex) => this.worldEntityInfoEncoder.removeEntity(playerId, entityIndex),
            queueWorldEntityPosition: (playerId, entityIndex, position) => this.worldEntityInfoEncoder.queuePosition(playerId, entityIndex, position),
            setWorldEntityPosition: (playerId, entityIndex, position) => this.worldEntityInfoEncoder.setPosition(playerId, entityIndex, position),
            queueWorldEntityMask: (playerId, entityIndex, mask) => this.worldEntityInfoEncoder.queueMaskUpdate(playerId, entityIndex, mask),
            buildSailingDockedCollision: () => this.sailingInstanceManager?.buildDockedCollision(),
            applySailingDeckCollision: () => this.sailingInstanceManager?.buildDockedCollision(),
            clearSailingDeckCollision: () => this.sailingInstanceManager?.clearDockedCollision(),
            requestTeleportAction: (player, request) => this.requestTeleportAction(player, request),

            // Combat/NPC
            getNpcById: (npcId) => this.npcManager?.getById(npcId),
            startNpcAttack: (ws, npc, tick, attackSpeed, modifierFlags) =>
                this.players!.startNpcAttack(ws, npc, tick, attackSpeed, modifierFlags),
            startNpcInteraction: (ws, npc, option, modifierFlags) =>
                this.players?.startNpcInteraction(ws, npc, option, modifierFlags),
            pickAttackSpeed: (player) => this.pickAttackSpeed(player),
            startCombat: (player, npc, tick, attackSpeed) =>
                this.playerCombatManager?.startCombat(player, npc, tick, attackSpeed),
            hasNpcOption: (npc, option) => this.npcManager?.hasNpcOption(npc, option) ?? false,
            resolveNpcOption: (npc, opNum) => this.resolveNpcOptionByOpNum(npc, opNum),
            resolveLocAction: (player, locId, opNum) =>
                this.resolveLocActionByOpNum(locId, opNum, player),
            routePlayer: (ws, to, run, tick) => this.players?.routePlayer(ws, to, run, tick),
            findPath: (opts) =>
                this.options.pathService?.findPath(opts) ?? {
                    ok: false,
                    message: "path service unavailable",
                },
            edgeHasWallBetween: (x1, y1, x2, y2, level) =>
                this.options.pathService?.edgeHasWallBetween(x1, y1, x2, y2, level) ?? false,

            // Spells
            handleSpellCast: (ws, player, payload, targetType, tick) => {
                if (
                    targetType !== "npc" &&
                    targetType !== "player" &&
                    targetType !== "loc" &&
                    targetType !== "obj"
                ) {
                    return;
                }
                this.spellActionHandler.handleSpellCastMessage(
                    ws,
                    player,
                    payload,
                    targetType,
                    tick,
                );
            },
            handleSpellCastOnItem: (ws, payload) => this.handleSpellCastOnItem(ws, payload),

            // Widget/Interface
            handleIfButtonD: () => {},
            handleWidgetAction: (player, payload) => {},
            handleWidgetCloseState: (player, groupId) => {
                this.cs2ModalManager.handleWidgetCloseState(player, groupId);
                this.widgetDialogHandler.handleWidgetCloseState(player, groupId);
            },
            openModal: (player, interfaceId, data) =>
                this.interfaceService?.openModal(player, interfaceId, data),
            openIndexedMenu: (player, request) =>
                this.cs2ModalManager.openIndexedMenu(player, request),
            openSubInterface: (player, targetUid, groupId, type = 0, opts) => {
                if (type === 0 || type === 1) {
                    player.widgets.open(groupId, {
                        targetUid,
                        type,
                        modal: opts?.modal !== false,
                    });
                    return;
                }
                this.queueWidgetEvent(player.id, {
                    action: "open_sub",
                    targetUid,
                    groupId,
                    type,
                });
            },
            openDialog: (player, request) =>
                this.widgetDialogHandler.openDialog(player, request as any),
            queueWidgetEvent: (playerId, event) => this.queueWidgetEvent(playerId, event as any),
            queueClientScript: (playerId, scriptId, ...args) =>
                this.queueClientScript(playerId, scriptId, ...args),
            queueVarp: (playerId, varpId, value) => this.queueVarp(playerId, varpId, value),
            queueVarbit: (playerId, varbitId, value) => this.queueVarbit(playerId, varbitId, value),
            queueNotification: (playerId, notification) =>
                this.queueNotification(playerId, notification),
            sendGameMessage: (player, text) => {
                this.queueChatMessage({
                    messageType: "game",
                    text,
                    targetPlayerIds: [player.id],
                });
            },
            sendSound: (player, soundId, opts) => this.sendSound(player, soundId, opts),
            sendVarp: (player, varpId, value) => this.queueVarp(player.id, varpId, value),
            sendVarbit: (player, varbitId, value) => this.queueVarbit(player.id, varbitId, value),
            trackCollectionLogItem: (player, itemId) =>
                this.doTrackCollectionLogItem(player, itemId),
            sendRunEnergyState: (ws, player) => this.sendRunEnergyState(ws, player),
            getWeaponSpecialCostPercent: (weaponId) => this.getWeaponSpecialCostPercent(weaponId),
            queueCombatState: (player) => this.queueCombatState(player),
            ensureEquipArray: (player) => this.ensureEquipArray(player),
            gamemodeServices: this.gamemode.getGamemodeServices?.() ?? {},

            // Chat
            queueChatMessage: (msg) => this.queueChatMessage(msg),
            getPublicChatPlayerType: (player) => this.getPublicChatPlayerType(player),
            enqueueLevelUpPopup: (player, data) => this.enqueueLevelUpPopup(player, data),
            findScriptCommand: (name) => this.scriptRegistry.findCommand(name),
            getCurrentTick: () => this.options.ticker.currentTick(),

            // Debug
            broadcast: (message, context) => this.broadcast(message, context),
            sendWithGuard: (ws, message, context) => this.sendWithGuard(ws, message, context),
            sendAdminResponse: (ws, message, context) =>
                this.sendAdminResponse(ws, message, context),
            withDirectSendBypass: (context, fn) => this.withDirectSendBypass(context, fn),
            encodeMessage: encodeMessage,
            setPendingDebugRequest: (requestId, ws) => this.pendingDebugRequests.set(requestId, ws),
            getPendingDebugRequest: (requestId) => this.pendingDebugRequests.get(requestId),

            // Tick
            currentTick: () => this.options.ticker.currentTick(),

            // Constants/Config
            getEquipmentSlotWeapon: () => EquipmentSlot.WEAPON,
            getVarpConstants: () => ({
                VARP_SIDE_JOURNAL_STATE,
                VARP_OPTION_RUN,
                VARP_SPECIAL_ATTACK,
                VARP_ATTACK_STYLE,
                VARP_AUTO_RETALIATE,
                VARP_MAP_FLAGS_CACHED,
            }),
            getVarbitConstants: () => ({
                VARBIT_SIDE_JOURNAL_TAB,
            }),
            getSideJournalConstants: () => ({
                SIDE_JOURNAL_CONTENT_GROUP_BY_TAB: Object.values(
                    SIDE_JOURNAL_CONTENT_GROUP_BY_TAB,
                ),
                SIDE_JOURNAL_TAB_CONTAINER_UID,
            }),
        };
        registerExtractedHandlers(router, extendedServices);

        // Simple handlers
        router.register("hello", (ctx) => {
            logger.info(`Hello from ${ctx.payload.client} ${ctx.payload.version ?? ""}`.trim());
        });

        router.register("inventory_use", (ctx) => {
            this.handleInventoryUseMessage(ctx.ws, ctx.payload);
        });

        router.register("inventory_use_on", (ctx) => {
            this.handleInventoryUseOnMessage(ctx.ws, ctx.payload);
        });

        router.register("inventory_move", (ctx) => {
            this.handleInventoryMoveMessage(ctx.ws, ctx.payload);
        });

        router.register("ground_item_action", (ctx) => {
            this.handleGroundItemAction(ctx.ws, ctx.payload);
        });

        router.register("interact_stop", (ctx) => {
            try {
                // RSMod parity: Use player.resetInteractions() to clear all interactions
                if (ctx.player) {
                    ctx.player.resetInteractions();
                }
                // Also clear the interaction system's internal state map
                this.players?.clearAllInteractions(ctx.ws);
            } catch {}
        });


        // More handlers will be added incrementally...
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
        return player.appearance ?? (player.appearance = this.createDefaultAppearance());
    }

    private getIdkBodyPartId(kit: IdkType): number {
        const extendedKit = kit as IdkType & { bodyPartId?: number };
        return extendedKit.bodyPartId ?? kit.bodyPartyId;
    }

    private createDefaultAppearance(): PlayerAppearanceState {
        return {
            gender: 0,
            colors: undefined,
            kits: undefined,
            equip: new Array<number>(EQUIP_SLOT_COUNT).fill(-1),
            equipQty: new Array<number>(EQUIP_SLOT_COUNT).fill(0),
            headIcons: { prayer: -1 },
        };
    }

    private setPendingLoginName(ws: WebSocket, name: string): void {
        this.pendingLoginNames.set(ws, name);
    }

    private consumePendingLoginName(ws: WebSocket): string | undefined {
        const name = this.pendingLoginNames.get(ws);
        this.pendingLoginNames.delete(ws);
        return name;
    }

    private getSocketRemoteAddress(ws: WebSocket): string | undefined {
        const transport = Reflect.get(ws, "_socket") as { remoteAddress?: string } | undefined;
        const remoteAddress = transport?.remoteAddress;
        return remoteAddress && remoteAddress.length > 0 ? remoteAddress : undefined;
    }

    private getPlayerAgilityLevel(player: PlayerState): number {
        const skill = player.getSkill(SkillId.Agility);
        const base = skill.baseLevel;
        const boost = skill.boost;
        return Math.max(1, Math.min(base + boost, 120));
    }

    private equipmentStatsUid(childId: number): number {
        return ((EQUIPMENT_STATS_GROUP_ID & 0xffff) << 16) | (childId & 0xffff);
    }

    private queueEquipmentStatsWidgetText(playerId: number, childId: number, text: string): void {
        this.queueWidgetEvent(playerId, {
            action: "set_text",
            uid: this.equipmentStatsUid(childId),
            text,
        });
    }

    private formatEquipmentSignedInt(value: number): string {
        const safe = Number.isFinite(value) ? Math.trunc(value) : 0;
        return safe >= 0 ? `+${safe}` : String(safe);
    }

    private formatEquipmentSignedPercent(value: number): string {
        const safe = Number.isFinite(value) ? value : 0;
        const sign = safe >= 0 ? "+" : "";
        return `${sign}${safe.toFixed(1)}%`;
    }

    private formatEquipmentSignedIntPercent(value: number): string {
        return `${this.formatEquipmentSignedInt(value)}%`;
    }

    private formatEquipmentAttackSpeedSeconds(ticks: number): string {
        const safeTicks = Math.max(1, Number.isFinite(ticks) ? ticks : DEFAULT_ATTACK_SPEED);
        return `${(safeTicks * 0.6).toFixed(1)}s`;
    }

    private computeEquipmentStatBonuses(player: PlayerState): number[] {
        const totals = new Array<number>(EQUIPMENT_STATS_BONUS_COUNT).fill(0);
        const equip = this.ensureEquipArray(player);
        for (const rawItemId of equip) {
            const itemId = rawItemId;
            if (!(itemId > 0)) continue;
            const def = getItemDefinition(itemId);
            const itemBonuses = def?.bonuses;
            if (!itemBonuses) continue;
            for (let i = 0; i < EQUIPMENT_STATS_BONUS_COUNT; i++) {
                const bonus = itemBonuses[i] ?? 0;
                if (!Number.isFinite(bonus)) continue;
                totals[i] = (totals[i] ?? 0) + bonus;
            }
        }
        return totals;
    }

    private computeEquipmentTargetSpecificBonusPercentages(player: PlayerState): {
        undeadPercent: number;
        slayerPercent: number;
    } {
        const equip = this.ensureEquipArray(player);
        const amuletId = equip[EquipmentSlot.AMULET];
        const headId = equip[EquipmentSlot.HEAD];
        const attackType = resolvePlayerAttackType({
            combatWeaponCategory: player.combatWeaponCategory,
            combatStyleSlot: player.combatStyleSlot,
            combatSpellId: player.combatSpellId,
            autocastEnabled: player.autocastEnabled,
        });

        let undeadPercent = 0;
        if (attackType === "melee") {
            if (amuletId === ITEM_ID_SALVE_AMULET || amuletId === ITEM_ID_SALVE_AMULET_I) {
                undeadPercent = EQUIPMENT_STATS_SALVE_MELEE_PERCENT;
            } else if (
                amuletId === ITEM_ID_SALVE_AMULET_E ||
                amuletId === ITEM_ID_SALVE_AMULET_EI
            ) {
                undeadPercent = EQUIPMENT_STATS_SALVE_ENCHANTED_PERCENT;
            }
        } else if (attackType === "ranged" || attackType === "magic") {
            if (amuletId === ITEM_ID_SALVE_AMULET_I) {
                undeadPercent = EQUIPMENT_STATS_SALVE_IMBUED_PERCENT;
            } else if (amuletId === ITEM_ID_SALVE_AMULET_EI) {
                undeadPercent = EQUIPMENT_STATS_SALVE_ENCHANTED_PERCENT;
            }
        }

        let slayerPercent = 0;
        const task = player.getSlayerTaskInfo();
        const onSlayerTask = !!task.onTask;
        const hasSlayerHelm = SLAYER_HELM_IDS.has(headId) || IMBUED_SLAYER_HELM_IDS.has(headId);
        const hasImbuedSlayerHelm = IMBUED_SLAYER_HELM_IDS.has(headId);
        if (onSlayerTask && hasSlayerHelm) {
            if (attackType === "melee") {
                slayerPercent = EQUIPMENT_STATS_SLAYER_MELEE_PERCENT;
            } else if ((attackType === "ranged" || attackType === "magic") && hasImbuedSlayerHelm) {
                slayerPercent = EQUIPMENT_STATS_SLAYER_IMBUED_PERCENT;
            }
        }

        // OSRS parity: Undead and Slayer multipliers do not stack.
        if (undeadPercent > 0 && slayerPercent > 0) {
            slayerPercent = 0;
        }

        return { undeadPercent, slayerPercent };
    }

    private queueEquipmentStatsWidgetTexts(player: PlayerState): void {
        const playerId = player.id;
        const bonuses = this.computeEquipmentStatBonuses(player);
        const attackLabels = ["Stab", "Slash", "Crush", "Magic", "Ranged"] as const;
        const defenceLabels = ["Stab", "Slash", "Crush", "Magic", "Ranged"] as const;
        const otherLabels = [
            "Melee strength",
            "Ranged strength",
            "Magic damage",
            "Prayer",
        ] as const;

        for (let i = 0; i < EQUIPMENT_STATS_ATTACK_CHILD_BY_INDEX.length; i++) {
            this.queueEquipmentStatsWidgetText(
                playerId,
                EQUIPMENT_STATS_ATTACK_CHILD_BY_INDEX[i],
                `${attackLabels[i]}: ${this.formatEquipmentSignedInt(bonuses[i] ?? 0)}`,
            );
        }
        for (let i = 0; i < EQUIPMENT_STATS_DEFENCE_CHILD_BY_INDEX.length; i++) {
            this.queueEquipmentStatsWidgetText(
                playerId,
                EQUIPMENT_STATS_DEFENCE_CHILD_BY_INDEX[i],
                `${defenceLabels[i]}: ${this.formatEquipmentSignedInt(bonuses[i + 5] ?? 0)}`,
            );
        }
        this.queueEquipmentStatsWidgetText(
            playerId,
            EQUIPMENT_STATS_OTHER_CHILD_BY_INDEX[0],
            `${otherLabels[0]}: ${this.formatEquipmentSignedInt(bonuses[10] ?? 0)}`,
        );
        this.queueEquipmentStatsWidgetText(
            playerId,
            EQUIPMENT_STATS_OTHER_CHILD_BY_INDEX[1],
            `${otherLabels[1]}: ${this.formatEquipmentSignedInt(bonuses[11] ?? 0)}`,
        );
        this.queueEquipmentStatsWidgetText(
            playerId,
            EQUIPMENT_STATS_OTHER_CHILD_BY_INDEX[2],
            `${otherLabels[2]}: ${this.formatEquipmentSignedIntPercent(bonuses[12] ?? 0)}`,
        );
        this.queueEquipmentStatsWidgetText(
            playerId,
            EQUIPMENT_STATS_OTHER_CHILD_BY_INDEX[3],
            `${otherLabels[3]}: ${this.formatEquipmentSignedInt(bonuses[13] ?? 0)}`,
        );

        const targetSpecific = this.computeEquipmentTargetSpecificBonusPercentages(player);
        this.queueEquipmentStatsWidgetText(
            playerId,
            EQUIPMENT_STATS_TARGET_UNDEAD_CHILD,
            `Undead: ${this.formatEquipmentSignedPercent(targetSpecific.undeadPercent)}`,
        );
        this.queueEquipmentStatsWidgetText(
            playerId,
            EQUIPMENT_STATS_TARGET_SLAYER_CHILD,
            `Slayer task: ${this.formatEquipmentSignedPercent(targetSpecific.slayerPercent)}`,
        );

        const baseAttackSpeed = this.resolveBaseAttackSpeed(player);
        const actualAttackSpeed = this.pickAttackSpeed(player);
        this.queueEquipmentStatsWidgetText(
            playerId,
            EQUIPMENT_STATS_WEAPON_SPEED_BASE_CHILD,
            `Base: ${this.formatEquipmentAttackSpeedSeconds(baseAttackSpeed)}`,
        );
        this.queueEquipmentStatsWidgetText(
            playerId,
            EQUIPMENT_STATS_WEAPON_SPEED_ACTUAL_CHILD,
            `Current: ${this.formatEquipmentAttackSpeedSeconds(actualAttackSpeed)}`,
        );
    }

    private computePlayerWeightKg(player: PlayerState): number {
        const addWeight = (itemId: number, qty: number): number => {
            if (!(itemId > 0) || !(qty > 0)) return 0;
            const def = getItemDefinition(itemId);
            const weight = def?.weight ?? 0;
            if (!Number.isFinite(weight)) return 0;
            return weight * qty;
        };
        let total = 0;
        const inv = this.getInventory(player);
        for (const entry of inv) {
            total += addWeight(entry.itemId, entry.quantity);
        }
        const equip = this.ensureEquipArray(player);
        for (const itemId of equip) {
            total += addWeight(itemId, 1);
        }
        return total;
    }

    /**
     * OSRS Run Energy Drain Formula (docs/run-energy.md)
     * drain = 67 + floor(67 × clamp(weight, 0, 64) / 64)
     * Weight is capped at 64kg for calculation purposes.
     *
     * OSRS parity: Agility does NOT affect drain rate, only recovery rate.
     * Reference: docs/run-energy.md, OSRS Wiki
     */
    private computeRunEnergyDrainUnits(weightKg: number, _agilityLevel: number): number {
        // Cap weight at 64kg as per OSRS formula
        const cappedWeight = Math.min(64, Math.max(0, weightKg));
        // OSRS formula: 67 + floor(67 × weight / 64)
        // At 0kg: 67, at 64kg: 134
        const drain = 67 + Math.floor((67 * cappedWeight) / 64);
        return drain;
    }

    /**
     * OSRS Run Energy Recovery Formula (docs/run-energy.md)
     * recovery = floor(agility / 6) + 8 units per tick
     * Graceful bonus: ×1.3 when wearing full set (6 pieces)
     *
     * OSRS parity: Base is 8 (not 15), divisor is 6 (not 10)
     * At level 1: 8, at level 99: 24
     * Reference: docs/run-energy.md, OSRS Wiki
     */
    private computeRunEnergyRegenUnits(
        agilityLevel: number,
        opts: { resting: boolean; gracefulPieces?: number },
    ): number {
        const agility = Math.max(1, Math.min(agilityLevel, 99));
        // OSRS formula: floor(agility / 6) + 8
        const baseRegen = Math.floor(agility / 6) + 8;
        // Graceful bonus: ×1.3 when wearing full set (6 pieces)
        const hasFullGraceful = (opts.gracefulPieces ?? 0) >= 6;
        const gracefulMultiplier = hasFullGraceful ? 1.3 : 1.0;
        return Math.floor(baseRegen * gracefulMultiplier);
    }

    /**
     * Graceful item IDs - all variants (regular, recolored, etc.)
     * Full set (6 pieces) provides ×1.3 run energy recovery multiplier
     */
    private static readonly GRACEFUL_HOODS = new Set([
        11850, 11852, 13579, 13580, 13581, 13582, 13583, 13584, 13585, 13586, 21061, 24743, 25069,
    ]);
    private static readonly GRACEFUL_TOPS = new Set([
        11854, 11856, 13591, 13592, 13593, 13594, 13595, 13596, 13597, 13598, 21067, 24749, 25075,
    ]);
    private static readonly GRACEFUL_LEGS = new Set([
        11858, 11860, 13603, 13604, 13605, 13606, 13607, 13608, 13609, 13610, 21073, 24755, 25081,
    ]);
    private static readonly GRACEFUL_GLOVES = new Set([
        11862, 11864, 13615, 13616, 13617, 13618, 13619, 13620, 13621, 13622, 21079, 24761, 25087,
    ]);
    private static readonly GRACEFUL_BOOTS = new Set([
        11866, 11868, 13627, 13628, 13629, 13630, 13631, 13632, 13633, 13634, 21085, 24767, 25093,
    ]);
    private static readonly GRACEFUL_CAPES = new Set([
        11870, 11872, 13639, 13640, 13641, 13642, 13643, 13644, 13645, 13646, 21091, 24773, 25099,
    ]);

    /**
     * Count how many graceful pieces the player has equipped (0-6)
     */
    private countGracefulPieces(player: PlayerState): number {
        const equip = this.ensureEquipArray(player);
        let count = 0;
        for (const itemId of equip) {
            if (itemId <= 0) continue;
            if (WSServer.GRACEFUL_HOODS.has(itemId)) count++;
            else if (WSServer.GRACEFUL_TOPS.has(itemId)) count++;
            else if (WSServer.GRACEFUL_LEGS.has(itemId)) count++;
            else if (WSServer.GRACEFUL_GLOVES.has(itemId)) count++;
            else if (WSServer.GRACEFUL_BOOTS.has(itemId)) count++;
            else if (WSServer.GRACEFUL_CAPES.has(itemId)) count++;
        }
        return Math.min(6, count);
    }

    private updateRunEnergy(
        player: PlayerState,
        activity: { ran: boolean; moved: boolean; runSteps: number },
        currentTick: number,
    ): void {
        player.tickStaminaEffect(currentTick);
        if (player.syncInfiniteRunEnergy()) {
            return;
        }
        const agilityLevel = this.getPlayerAgilityLevel(player);
        if (activity.ran) {
            const weight = this.computePlayerWeightKg(player);
            const baseDrain = this.computeRunEnergyDrainUnits(weight, agilityLevel);
            const multiplier = player.getRunEnergyDrainMultiplier(currentTick);
            const stepCount = Math.max(1, activity.runSteps);
            const drain = Math.max(0, baseDrain * stepCount * multiplier);
            const nextUnits = player.adjustRunEnergyUnits(-drain);
            if (nextUnits <= 0) {
                // OSRS: once you hit 0 energy, you stop running immediately.
                // If the player had run toggled on, the toggle also flips off.
                player.running = false;
                if (player.runToggle) {
                    player.setRunToggle(false);
                }
            }
        } else {
            const gracefulPieces = this.countGracefulPieces(player);
            const regen = this.computeRunEnergyRegenUnits(agilityLevel, {
                resting: !activity.moved,
                gracefulPieces,
            });
            if (regen > 0 && player.getRunEnergyUnits() < RUN_ENERGY_MAX) {
                player.adjustRunEnergyUnits(regen);
            }
        }
    }

    private deriveAttackTypeFromStyle(
        style: number | undefined,
        attacker?: PlayerState,
    ): AttackType {
        const stored = attacker?.getCurrentAttackType?.();
        if (stored) return stored;
        if (style === 3 || (attacker?.combatSpellId ?? -1) > 0) {
            return "magic";
        }
        const category = attacker?.combatWeaponCategory ?? -1;
        if (MAGIC_WEAPON_CATEGORY_IDS.has(category)) return "magic";
        if (RANGED_WEAPON_CATEGORY_IDS.has(category)) return "ranged";
        return "melee";
    }

    private applyProtectionPrayers(
        target: PlayerState,
        damage: number,
        attackType: AttackType,
        source: "npc" | "player",
    ): number {
        if (!(damage > 0)) return 0;
        const prayer = PROTECTION_PRAYER_MAP[attackType];
        if (!prayer || !target.hasPrayerActive(prayer)) return damage;
        const reduction = source === "npc" ? NPC_PROTECTION_REDUCTION : PVP_PROTECTION_REDUCTION;
        const remaining = Math.floor(damage * (1 - reduction));
        return Math.max(0, remaining);
    }

    private applyMultiTargetSpellDamage(opts: {
        player: PlayerState;
        primary: NpcState;
        spell: SpellDataEntry;
        baseDamage: number;
        style: number;
        hitsplatTick: number;
        currentTick: number;
        effects: ActionEffect[];
    }): void {
        if (
            !this.npcManager ||
            !opts.spell.maxTargets ||
            opts.spell.maxTargets <= 1 ||
            !(opts.baseDamage > 0)
        ) {
            return;
        }
        const extras = this.npcManager
            .getNearby(opts.primary.tileX, opts.primary.tileY, opts.primary.level, 1)
            .filter((npc) => npc.id !== opts.primary.id);
        if (extras.length === 0) return;
        let remaining = Math.max(0, opts.spell.maxTargets - 1);
        const splashDamage = Math.max(1, Math.floor(opts.baseDamage / 2));
        if (!(splashDamage > 0)) return;
        for (const extra of extras) {
            if (remaining <= 0) break;
            const result = this.applyPlayerDamageToNpc(
                opts.player,
                extra,
                splashDamage,
                opts.style,
                opts.currentTick,
                "magic",
            );
            if (!result) continue;
            remaining--;
            const hpFields =
                result.amount > 0 ? { hpCurrent: result.hpCurrent, hpMax: result.hpMax } : {};
            opts.effects.push({
                type: "hitsplat",
                playerId: opts.player.id,
                targetType: "npc",
                targetId: extra.id,
                damage: result.amount,
                style: result.style,
                sourceType: "player",
                sourcePlayerId: opts.player.id,
                tick: opts.hitsplatTick,
                ...hpFields,
            });
            if (opts.spell.freezeDuration && result.amount > 0) {
                extra.applyFreeze(opts.spell.freezeDuration, opts.currentTick);
            }
            const spotId =
                result.amount > 0
                    ? opts.spell.impactSpotAnim ?? opts.spell.splashSpotAnim
                    : opts.spell.splashSpotAnim ?? opts.spell.impactSpotAnim;
            if (spotId !== undefined && spotId >= 0) {
                this.enqueueSpotAnimation({
                    tick: opts.hitsplatTick,
                    npcId: extra.id,
                    spotId: spotId,
                    delay: 0,
                    height: 100,
                });
            }
        }
    }

    private applyPlayerDamageToNpc(
        player: PlayerState,
        npc: NpcState,
        damage: number,
        style: number,
        tick: number,
        damageType: DamageType,
        maxHit?: number,
    ): { amount: number; style: number; hpCurrent: number; hpMax: number } | undefined {
        if (npc.isPlayerFollower?.() === true) return undefined;
        if (npc.getHitpoints() <= 0 || npc.isDead(tick)) return undefined;

        const result = combatEffectApplicator.applyNpcHitsplat(npc, style, damage, tick, maxHit);
        if (result.amount > 0) {
            this.playerCombatManager?.recordDamage(player, npc, result.amount, damageType, tick);
        }
        if (result.hpCurrent <= 0) {
            this.handleNpcDeathOutsidePrimaryCombat(player, npc, tick);
        }
        return result;
    }

    private handleNpcDeathOutsidePrimaryCombat(
        player: PlayerState,
        npc: NpcState,
        tick: number,
    ): void {
        if (npc.isPlayerFollower?.() === true || npc.isDead(tick)) {
            return;
        }

        logger.info(`[combat] NPC ${npc.id} (type ${npc.typeId}) died`);
        npc.clearInteractionTarget();

        const eligibility = this.playerCombatManager?.getDropEligibility?.(npc);
        const inWilderness = isInWilderness(npc.tileX, npc.tileY);
        const pendingDrops = this.rollNpcDrops(npc, eligibility).map((drop) => ({
            ...drop,
            isWilderness: inWilderness,
        }));

        const deathSeq = this.getNpcCombatSequences(npc.typeId)?.death;
        if (deathSeq !== undefined && deathSeq >= 0) {
            npc.queueOneShotSeq(deathSeq);
            this.broadcastNpcSequence(npc, deathSeq);
            npc.popPendingSeq();
        }

        const deathSoundId = this.getNpcDeathSoundId(npc.typeId);
        if (deathSoundId !== undefined && deathSoundId > 0) {
            this.withDirectSendBypass("combat_npc_death_sound", () =>
                this.broadcastSound(
                    {
                        soundId: deathSoundId,
                        x: npc.tileX,
                        y: npc.tileY,
                        level: npc.level,
                        delay: COMBAT_SOUND_DELAY_MS,
                    },
                    "combat_npc_death_sound",
                ),
            );
        }

        this.players?.clearInteractionsWithNpc(npc.id);

        const affectedPlayerIds = new Set<number>([player.id]);
        const npcTargetPlayerId = npc.getCombatTargetPlayerId();
        if (npcTargetPlayerId !== undefined && npcTargetPlayerId >= 0) {
            affectedPlayerIds.add(npcTargetPlayerId);
        }
        for (const affectedPlayerId of affectedPlayerIds) {
            this.actionScheduler.cancelActions(affectedPlayerId, (action) => {
                const actionNpcId =
                    action.kind === "combat.attack" ||
                    action.kind === "combat.playerHit" ||
                    action.kind === "combat.npcRetaliate"
                        ? (
                              action.data as
                                  | CombatAttackActionData
                                  | CombatPlayerHitActionData
                                  | CombatNpcRetaliateActionData
                          ).npcId
                        : undefined;
                return (
                    actionNpcId === npc.id &&
                    (action.groups.includes("combat.attack") ||
                        action.groups.includes("combat.retaliate") ||
                        action.groups.includes("combat.hit"))
                );
            });
        }

        const RESPAWN_DELAY_TICKS = 17;
        const deathDelayTicks = this.estimateNpcDespawnDelayTicksFromSeq(deathSeq);
        const despawnTick = tick + Math.max(1, deathDelayTicks);
        const respawnTick = Math.max(tick + RESPAWN_DELAY_TICKS, despawnTick + 1);
        try {
            npc.markDeadUntil(despawnTick, tick);
        } catch {}
        const queued =
            this.npcManager?.queueDeath?.(npc.id, despawnTick, respawnTick, pendingDrops) ?? false;
        if (!queued) {
            logger.warn(
                `[combat] Failed to queue NPC respawn (npc=${npc.id}, respawnTick=${respawnTick})`,
            );
        }

        this.playerCombatManager?.cleanupNpc?.(npc);

        const killerId = eligibility?.primaryLooter?.id ?? player.id;
        this.gamemode.onNpcKill(killerId, npc.typeId);
    }

    private ensureEquipArray(p: PlayerState): number[] {
        if (this.equipmentHandler) {
            return this.equipmentHandler.ensureEquipArray(p);
        }
        // Fallback for early initialization
        const appearance = this.getOrCreateAppearance(p);
        ensureEquipQtyArrayOn(appearance, EQUIP_SLOT_COUNT);
        return ensureEquipArrayOn(appearance, EQUIP_SLOT_COUNT);
    }

    private ensureEquipQtyArray(p: PlayerState): number[] {
        if (this.equipmentHandler) {
            return this.equipmentHandler.ensureEquipQtyArray(p);
        }
        // Fallback for early initialization
        const appearance = this.getOrCreateAppearance(p);
        return ensureEquipQtyArrayOn(appearance, EQUIP_SLOT_COUNT);
    }

    private getPlayerSaveKey(name: string | undefined, id: number): string {
        return buildPlayerSaveKey(name, id);
    }

    private getEquippedItemIds(p: PlayerState): number[] {
        const equip = this.ensureEquipArray(p);
        return equip.filter((itemId) => itemId > 0);
    }

    private refreshAppearanceKits(p: PlayerState): void {
        this.playerAppearanceManager.refreshAppearanceKits(p);
    }

    private loadAnimSetFromBas(loader: () => BasType | undefined): PlayerAnimSet | undefined {
        try {
            const bas = loader?.();
            return buildAnimSetFromBas(bas);
        } catch {
            return undefined;
        }
    }

    private animSetFromBas(bas: BasType | undefined): PlayerAnimSet | undefined {
        return buildAnimSetFromBas(bas);
    }

    private guessBasIdForAppearance(
        appearance: { gender?: number } | undefined,
    ): number | undefined {
        if (!this.basTypeLoader) return undefined;
        const gender = appearance?.gender === 1 ? 1 : 0;
        if (gender === 1) return 1;
        return 0;
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

    private assignPlayerAnimFromAppearance(p: PlayerState): PlayerAnimSet | undefined {
        const appearance = p.appearance;
        const resolved = this.resolveAnimForAppearance(appearance);
        const animTarget = p.anim;
        for (const key of PLAYER_ANIM_KEYS) {
            const value = resolved[key];
            if (value !== undefined) animTarget[key] = value;
        }
        this.applyWeaponAnimOverrides(p, animTarget);
        return resolved;
    }

    private loadWeaponData(): void {
        const dataMap = new Map<number, WeaponDataEntry>();
        const animOverrides = new Map<number, Record<string, number>>();
        for (const entry of weaponDataEntries) {
            const itemId = entry.itemId;
            dataMap.set(itemId, entry);

            if (entry.animOverrides) {
                animOverrides.set(itemId, { ...entry.animOverrides });
            }
        }

        this.weaponData = dataMap;
        this.weaponAnimOverrides = animOverrides;

        if (this.weaponData.size > 0) {
            logger.info(
                `[WSServer] loaded ${this.weaponData.size} weapon data entries from data module`,
            );
        }
        if (this.weaponAnimOverrides.size > 0) {
            logger.info(
                `[WSServer] loaded ${this.weaponAnimOverrides.size} weapon animation override entries from data module`,
            );
        }
    }

    private loadSpecialAttackCacheData(enumTypeLoader: EnumTypeLoader): void {
        try {
            const costEnum = enumTypeLoader.load(906);
            const costMap = new Map<number, number>();
            for (let i = 0; i < costEnum.keys.length; i++) {
                const key = costEnum.keys[i];
                const val = costEnum.intValues[i];
                costMap.set(key, val);
            }
            this.specialAttackCostUnitsByWeapon = costMap;
        } catch (err) {
            logger.warn("[cache] failed to load special attack cost enum (906)", err);
        }

        try {
            const descEnum = enumTypeLoader.load(1739);
            const descMap = new Map<number, string>();
            for (let i = 0; i < descEnum.keys.length; i++) {
                const key = descEnum.keys[i];
                const val = descEnum.stringValues[i] ?? "";
                if (val) descMap.set(key, val);
            }
            this.specialAttackDescriptionByWeapon = descMap;
            this.specialAttackDefaultDescription = descEnum.defaultString || undefined;
        } catch (err) {
            logger.warn("[cache] failed to load special attack description enum (1739)", err);
        }
    }

    private getWeaponSpecialCostPercent(weaponItemId: number): number | undefined {
        const units = this.specialAttackCostUnitsByWeapon?.get(weaponItemId);
        if (units === undefined || units <= 0) return undefined;
        // Enum 906 stores cost in varp300 units (0-1000). Convert to percent (0-100).
        return Math.max(1, Math.min(100, Math.ceil(units / 10)));
    }

    private getWeaponSpecialDescription(weaponItemId: number): string | undefined {
        const direct = this.specialAttackDescriptionByWeapon?.get(weaponItemId);
        if (direct) return direct;
        return this.specialAttackDefaultDescription;
    }

    private applyWeaponAnimOverrides(
        p: PlayerState,
        animTarget: Record<string, number | undefined>,
    ): void {
        const equip = Array.isArray(p.appearance?.equip) ? p.appearance.equip : undefined;
        const itemId = Array.isArray(equip) ? equip[EquipmentSlot.WEAPON] ?? -1 : -1;

        const overrides = this.weaponAnimOverrides.get(itemId);
        if (!overrides) return;

        for (const [key, value] of Object.entries(overrides)) {
            animTarget[key] = value;
        }
    }

    private refreshCombatWeaponCategory(p: PlayerState): {
        categoryChanged: boolean;
        weaponItemChanged: boolean;
    } {
        const equip = this.ensureEquipArray(p);
        const weaponId = equip[EquipmentSlot.WEAPON];
        const normalizedWeaponId = weaponId > 0 ? weaponId : -1;
        const previousWeaponId = p.combatWeaponItemId ?? -1;

        const dataEntry = this.weaponData.get(normalizedWeaponId);
        const obj = normalizedWeaponId > 0 ? this.getObjType(normalizedWeaponId) : undefined;
        const def = normalizedWeaponId > 0 ? getItemDefinition(normalizedWeaponId) : undefined;
        let derived: number | undefined = getCategoryForWeaponInterface(def?.weaponInterface);
        if (dataEntry?.combatCategory !== undefined) {
            derived = dataEntry.combatCategory;
        }
        if (derived === undefined) {
            const inferred = resolveWeaponCategoryFromObj(obj, {
                defaultCategory: DEFAULT_WEAPON_CATEGORY,
            });
            if (inferred !== undefined) derived = inferred;
        }
        const normalizedCategory = derived ?? DEFAULT_WEAPON_CATEGORY;
        const previousCategory = p.combatWeaponCategory;

        const categoryChanged = previousCategory !== normalizedCategory;
        const weaponItemChanged = previousWeaponId !== normalizedWeaponId;

        p.combatWeaponCategory = normalizedCategory;
        p.combatWeaponItemId = normalizedWeaponId;
        // OSRS parity: weapon attack range (ObjType param 13). Applies to melee too (e.g. halberds).
        try {
            let baseRange = 0;
            if (normalizedWeaponId > 0) {
                const rawRange = obj?.params?.get(13) as number | undefined;
                if (rawRange !== undefined && rawRange > 0) {
                    baseRange = Math.max(1, rawRange);
                }
            }
            p.combatWeaponRange = baseRange;
        } catch {
            p.combatWeaponRange = 0;
        }
        if (categoryChanged) {
            const currentSlot = Math.max(0, Math.min(p.combatStyleSlot ?? 0, 3));
            p.setCombatStyle(currentSlot, normalizedCategory);
        } else if (p.combatStyleCategory !== normalizedCategory) {
            p.combatStyleCategory = normalizedCategory;
        }

        if (this.combatCategoryData) {
            p.setCombatCategoryAttackTypes(
                this.combatCategoryData.getAttackTypes(normalizedCategory),
            );
            p.setCombatCategoryMeleeBonusIndices(
                this.combatCategoryData.getMeleeBonusIndices(normalizedCategory),
            );
        } else {
            p.setCombatCategoryAttackTypes(undefined);
            p.setCombatCategoryMeleeBonusIndices(undefined);
        }

        return { categoryChanged, weaponItemChanged };
    }

    /**
     * Reset autocast state when weapon changes (OSRS parity).
     * Clears varbits 275/276/2668 and player autocast state.
     */
    private resetAutocast(p: PlayerState): void {
        clearAutocastState(p, {
            sendVarbit: (player, varbitId, value) => this.queueVarbit(player.id, varbitId, value),
            queueCombatState: (player) => this.queueCombatState(player),
        });

        logger.info(`[autocast] Reset autocast for player=${p.id} due to weapon change`);
    }

    private buildAnimPayload(p: PlayerState): PlayerAnimSet | undefined {
        // Apply weapon animation overrides based on current equipment before building payload
        this.assignPlayerAnimFromAppearance(p);

        const source = p.anim;
        if (!source || Object.keys(source).length === 0) return undefined;
        const payload: PlayerAnimSet = {};
        let has = false;
        for (const key of PLAYER_ANIM_KEYS) {
            const v = source[key];
            if (v !== undefined && v >= 0) {
                payload[key] = v;
                has = true;
            }
        }
        return has ? payload : undefined;
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

    private summarizeSteps(
        actor: PlayerState,
        steps:
            | Array<{
                  x: number;
                  y: number;
                  level: number;
                  rot: number;
                  running: boolean;
                  traversal?: number;
                  orientation?: number;
                  direction?: number;
                  seq?: number;
              }>
            | undefined,
    ): {
        directions: number[];
        traversals: number[];
        ran: boolean;
        runSteps: number;
        finalRot: number;
        finalOrientation: number;
        finalSeq?: number;
        level: number;
        subX: number;
        subY: number;
    } {
        const directions: number[] = [];
        const traversals: number[] = [];
        if (Array.isArray(steps)) {
            for (const step of steps) {
                const dir = step.direction !== undefined ? step.direction & 7 : undefined;
                if (dir === undefined) {
                    continue;
                }
                directions.push(dir);
                const traversal = step.traversal ?? (step.running ? 2 : 1);
                traversals.push(traversal >= 0 ? traversal : 1);
            }
        }
        const ran = Array.isArray(steps) && steps.some((s) => !!s.running);
        const runSteps = Array.isArray(steps) ? steps.filter((s) => !!s.running).length : 0;
        const lastStep =
            Array.isArray(steps) && steps.length > 0 ? steps[steps.length - 1] : undefined;
        const finalRot = lastStep ? lastStep.rot : actor.rot;
        const finalOrientation =
            lastStep?.orientation !== undefined
                ? lastStep.orientation & 2047
                : actor.getOrientation() & 2047;
        const finalSeq = lastStep?.seq;
        const level = lastStep ? lastStep.level : actor.level;
        const subX = lastStep ? lastStep.x : actor.x;
        const subY = lastStep ? lastStep.y : actor.y;
        return {
            directions,
            traversals,
            ran,
            runSteps,
            finalRot,
            finalOrientation,
            finalSeq,
            level,
            subX,
            subY,
        };
    }

    private sendAnimUpdate(ws: WebSocket, p: PlayerState): void {
        const payload = this.buildAnimPayload(p);
        if (!payload) return;
        this.queueAnimSnapshot(p.id, payload);
    }

    private getDefaultBodyKits(gender: number): number[] {
        const key = gender ?? 0;
        const cached = this.defaultBodyKitCache.get(key);
        if (cached) return cached.slice();

        const loader = this.idkTypeLoader;
        const defaults = new Array<number>(7).fill(-1);
        const count = loader?.getCount() ?? 0;
        const expectedPart = (part: number) => part + (key === 1 ? 7 : 0);
        for (let id = 0; id < count; id++) {
            try {
                const kit = loader?.load(id);
                if (!kit || kit.nonSelectable) continue;
                const part = this.getIdkBodyPartId(kit);
                if (part >= 0 && part < 14) {
                    const base = key === 1 ? part - 7 : part;
                    if (base >= 0 && base < defaults.length) {
                        if (part === expectedPart(base) && defaults[base] === -1) {
                            defaults[base] = id;
                        }
                    }
                }
            } catch {}
        }

        if (loader && (defaults[0] === -1 || defaults[1] === -1)) {
            try {
                const fallback =
                    gender === 1
                        ? CachePlayerAppearance.defaultFemale(loader)
                        : CachePlayerAppearance.defaultMale(loader);
                if (fallback) {
                    if (defaults[0] === -1 && fallback.kits[0] !== undefined) {
                        defaults[0] = fallback.kits[0] ?? -1;
                    }
                    if (defaults[1] === -1 && fallback.kits[1] !== undefined) {
                        defaults[1] = fallback.kits[1] ?? -1;
                    }
                }
            } catch {}
        }

        if (defaults[0] <= 0) {
            for (let id = 1; id < count; id++) {
                try {
                    const kit = loader?.load(id);
                    if (!kit) continue;
                    if (this.getIdkBodyPartId(kit) === expectedPart(0)) {
                        defaults[0] = id;
                        break;
                    }
                } catch {}
            }
        }
        if (defaults[1] === -1) {
            for (let id = 0; id < count; id++) {
                try {
                    const kit = loader?.load(id);
                    if (!kit) continue;
                    if (this.getIdkBodyPartId(kit) === expectedPart(1)) {
                        defaults[1] = id;
                        break;
                    }
                } catch {}
            }
        }

        this.defaultBodyKitCache.set(key, defaults.slice());
        return defaults;
    }

    private getObjType(itemId: number): ObjType | undefined {
        try {
            return this.objTypeLoader?.load?.(itemId);
        } catch {
            return undefined;
        }
    }

    private queuePlayerGameMessage(player: PlayerState, text: string | undefined): void {
        const trimmed = typeof text === "string" ? text.trim() : "";
        if (trimmed.length === 0) {
            return;
        }

        this.queueChatMessage({
            messageType: "game",
            text: trimmed,
            targetPlayerIds: [player.id],
        });
    }

    private handleExaminePacket(ws: WebSocket, packet: DecodedPacket): boolean {
        const player = this.players?.get(ws);
        if (!player) {
            return false;
        }

        switch (packet.type) {
            case "examine_loc": {
                this.queuePlayerGameMessage(
                    player,
                    resolveLocExamineText(this.locTypeLoader, player, packet.locId),
                );
                return true;
            }

            case "examine_npc": {
                this.queuePlayerGameMessage(
                    player,
                    resolveNpcExamineText(this.npcTypeLoader, packet.npcId),
                );
                return true;
            }

            case "examine_obj": {
                const visible = this.groundItems
                    .queryArea(
                        packet.worldX,
                        packet.worldY,
                        player.level,
                        0,
                        this.options.ticker.currentTick(),
                        player.id,
                        player.worldViewId,
                    )
                    .some((stack) => stack.itemId === packet.itemId);
                if (!visible) {
                    return true;
                }

                this.queuePlayerGameMessage(
                    player,
                    resolveObjExamineText(this.objTypeLoader, packet.itemId),
                );
                return true;
            }

            default:
                return false;
        }
    }

    private resolveNpcOptionByOpNum(npc: any, opNum: number): string | undefined {
        const idx = opNum - 1;
        if (idx < 0 || idx > 4) return undefined;
        try {
            const type = this.npcManager?.getNpcType?.(npc);
            const raw = Array.isArray(type?.actions) ? type.actions[idx] : undefined;
            if (!raw) return undefined;
            const normalized = raw.trim();
            return normalized.length > 0 ? normalized : undefined;
        } catch {
            return undefined;
        }
    }

    private resolveLocActionByOpNum(
        locId: number,
        opNum: number,
        player?: PlayerState,
    ): string | undefined {
        const idx = opNum - 1;
        if (idx < 0 || idx > 4) return undefined;
        if (!(locId > 0)) return undefined;
        try {
            const visible = player
                ? loadVisibleLocTypeForPlayer(this.locTypeLoader, player, locId)
                : undefined;
            const def = visible?.type ?? this.locTypeLoader?.load?.(locId);
            const raw = Array.isArray(def?.actions) ? def.actions[idx] : undefined;
            if (!raw) return undefined;
            const normalized = raw.trim();
            return normalized.length > 0 ? normalized : undefined;
        } catch {
            return undefined;
        }
    }

    private resolveGroundItemOptionByOpNum(itemId: number, opNum: number): string | undefined {
        const idx = opNum - 1;
        if (idx < 0 || idx > 4) return undefined;
        if (!(itemId > 0)) return undefined;
        try {
            const obj = this.getObjType(itemId);
            const raw = Array.isArray(obj?.groundActions) ? obj.groundActions[idx] : undefined;
            if (!raw) return undefined;
            const normalized = raw.trim();
            return normalized.length > 0 ? normalized : undefined;
        } catch {
            return undefined;
        }
    }

    private resolveEquipSlot(itemId: number): number | undefined {
        return inferEquipSlot(itemId, (id) => this.getObjType(id));
    }

    private isConsumable(
        obj:
            | ObjType
            | {
                  inventoryActions?: Array<string | null | undefined>;
              }
            | undefined,
        optionLower: string,
    ): boolean {
        if (optionLower && CONSUME_VERBS.includes(optionLower)) return true;
        const actions = Array.isArray(obj?.inventoryActions) ? obj.inventoryActions : [];
        for (const act of actions) {
            if (act && CONSUME_VERBS.includes(act.toLowerCase())) {
                return true;
            }
        }
        return false;
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
        // Delegate to RSMod-style player method
        const result = p.addItem(itemId, quantity, { assureFullInsertion: true });
        if (result.completed === 0 || result.slots.length === 0) {
            return { slot: -1, added: 0 };
        }
        return { slot: result.slots[0].slot, added: result.completed };
    }

    private performScheduledAction(
        player: PlayerState,
        action: ScheduledAction,
        tick: number,
    ): ActionExecutionResult {
        switch (action.kind) {
            case "inventory.use_on":
                return this.inventoryActionHandler.executeInventoryUseOnAction(
                    player,
                    action.data as InventoryUseOnActionData,
                    tick,
                );
            case "inventory.equip":
                return this.inventoryActionHandler.executeInventoryEquipAction(
                    player,
                    action.data as InventoryEquipActionData,
                );
            case "inventory.consume":
                return this.inventoryActionHandler.executeInventoryConsumeAction(
                    player,
                    action.data as InventoryConsumeActionData,
                );
            case "inventory.consume_script":
                return this.inventoryActionHandler.executeScriptedConsumeAction(
                    player,
                    action.data as InventoryConsumeScriptActionData,
                    tick,
                );
            case "inventory.move":
                return this.inventoryActionHandler.executeInventoryMoveAction(
                    player,
                    action.data as InventoryMoveActionData,
                );
            case "inventory.unequip":
                return this.inventoryActionHandler.executeInventoryUnequipAction(
                    player,
                    action.data as InventoryUnequipActionData,
                );
            case "combat.attack":
                return this.combatActionHandler.executeCombatAttackAction(
                    player,
                    action.data as CombatAttackActionData,
                    tick,
                );
            case "combat.autocast":
                return this.combatActionHandler.executeCombatAutocastAction(
                    player,
                    action.data as CombatAutocastActionData,
                    tick,
                );
            case "combat.playerHit":
                return this.combatActionHandler.executeCombatPlayerHitAction(
                    player,
                    action.data as CombatPlayerHitActionData,
                    tick,
                );
            case "combat.npcRetaliate":
                return this.combatActionHandler.executeCombatNpcRetaliateAction(
                    player,
                    action.data as CombatNpcRetaliateActionData,
                    tick,
                );
            case "combat.companionHit":
                return this.combatActionHandler.executeCombatCompanionHitAction(
                    player,
                    action.data as CombatCompanionHitActionData,
                    tick,
                );
            case "movement.teleport":
                return this.executeMovementTeleportAction(
                    player,
                    action.data as MovementTeleportActionData,
                    tick,
                );
            case "emote.play":
                return this.executeEmotePlayAction(player, action.data as EmotePlayActionData);
            case "npc.trade": {
                const tradeData = action.data as { npcTypeId?: number; shopId?: string };
                this.scriptRuntime.getServices().openShop?.(player, tradeData);
                return { ok: true, effects: [] };
            }
            default: {
                const scriptHandler = this.scriptRegistry.findActionHandler(action.kind);
                if (scriptHandler) {
                    return scriptHandler({
                        player,
                        data: action.data,
                        tick,
                        services: this.scriptRuntime.getServices(),
                    });
                }
                return {
                    ok: false,
                    reason: `unknown_action:${action.kind}`,
                    effects: [
                        {
                            type: "log",
                            playerId: player.id,
                            level: "warn",
                            message: `Unhandled action kind ${action.kind}`,
                        },
                    ],
                };
            }
        }
    }

    private collectCarriedItemIds(player: PlayerState): number[] {
        const ids: number[] = [];
        const equip = this.ensureEquipArray(player);
        for (const itemId of equip) {
            if (itemId > 0) ids.push(itemId);
        }
        const inv = this.getInventory(player);
        for (const entry of inv) {
            if (entry.itemId > 0 && entry.quantity > 0) ids.push(entry.itemId);
        }
        return ids;
    }

    private sendInventorySnapshot(ws: WebSocket, p: PlayerState): void {
        const inv = this.getInventory(p);
        const slots = inv.map((entry, idx) => ({
            slot: idx,
            itemId: entry.itemId,
            quantity: entry.quantity,
        }));
        this.broadcastScheduler.queueInventorySnapshot({ playerId: p.id, slots });
    }

    /**
     * Send the collection log inventory (620) snapshot to a player.
     * Converts the player's collectionObtained map to slot format.
     */
    private sendCollectionLogSnapshot(player: PlayerState): void {
        const ws = this.players?.getSocketByPlayerId(player.id);
        if (!ws) return;

        const items = player.getCollectionObtainedItems();
        const slots = items.map((item, idx) => ({
            slot: idx,
            itemId: item.itemId,
            quantity: item.quantity,
        }));

        this.withDirectSendBypass("collection_log_snapshot", () =>
            this.sendWithGuard(
                ws,
                encodeMessage({
                    type: "collection_log",
                    payload: { kind: "snapshot", slots },
                } as any),
                "collection_log_snapshot",
            ),
        );
    }

    /**
     * Get collection log services for delegating to collectionlog.ts functions.
     */
    private getCollectionLogServices(): CollectionLogServices {
        const { getMainmodalUid } = require("../widgets/viewport");
        return {
            queueVarp: (playerId, varpId, value) => this.queueVarp(playerId, varpId, value),
            queueVarbit: (playerId, varbitId, value) => this.queueVarbit(playerId, varbitId, value),
            queueWidgetEvent: (playerId, event) =>
                this.queueWidgetEvent(playerId, event as any),
            queueNotification: (playerId, payload) => this.queueNotification(playerId, payload),
            queueChatMessage: (request) => this.queueChatMessage(request),
            sendCollectionLogSnapshot: (player) =>
                this.sendCollectionLogSnapshot(player as PlayerState),
            getMainmodalUid,
            logger,
        };
    }

    /**
     * Open the collection log interface (621) in mainmodal container.
     * Uses InterfaceService.openModal - hooks handle all initialization.
     */
    private doOpenCollectionLog(player: PlayerState): void {
        // Build the services data for the onOpen hook
        const hookData: CollectionLogOpenData = {
            sendCollectionLogSnapshot: (p) => this.sendCollectionLogSnapshot(p),
            queueVarp: (playerId, varpId, value) => this.queueVarp(playerId, varpId, value),
            queueVarbit: (playerId, varbitId, value) => this.queueVarbit(playerId, varbitId, value),
            queueWidgetEvent: (playerId, event) =>
                this.queueWidgetEvent(playerId, event as any),
            logger,
        };
        // Open modal - the registered onOpen hook handles all initialization
        this.interfaceService?.openModal(player, COLLECTION_LOG_GROUP_ID, hookData);
    }

    /**
     * Open the collection overview interface (908) in mainmodal.
     */
    private doOpenCollectionOverview(player: PlayerState): void {
        const openState = buildCollectionOverviewOpenState(player);

        this.interfaceService?.openModal(player, COLLECTION_OVERVIEW_GROUP_ID, undefined, {
            varps: openState.varps,
            varbits: openState.varbits,
        });
    }

    /**
     * Populate collection log category list by calling CS2 script 2731.
     * Delegates to collectionlog.ts populateCollectionLogCategories function.
     */
    private doPopulateCollectionLogCategories(player: PlayerState, tabIndex: number): void {
        populateCollectionLogCategories(player, tabIndex, this.getCollectionLogServices());
    }

    /**
     * Track an item for the collection log if it's a trackable item.
     * Delegates to collectionlog.ts trackCollectionLogItem function.
     */
    private doTrackCollectionLogItem(player: PlayerState, itemId: number): void {
        trackCollectionLogItem(player, itemId, this.getCollectionLogServices());
    }

    /**
     * Queue a varp update to be sent to the client.
     */
    private queueVarp(playerId: number, varpId: number, value: number): void {
        const event = {
            playerId: playerId,
            varpId: varpId,
            value: value,
        };

        if (this.activeFrame) {
            this.activeFrame.varps ??= [];
            this.activeFrame.varps.push(event);
            return;
        }

        const ws = this.players?.getSocketByPlayerId(event.playerId);
        if (ws) {
            this.withDirectSendBypass("varp", () =>
                this.sendWithGuard(
                    ws,
                    encodeMessage({
                        type: "varp",
                        payload: { varpId: event.varpId, value: event.value },
                    }),
                    "varp",
                ),
            );
            return;
        }

        this.broadcastScheduler.queueVarp(event.playerId, event.varpId, event.value);
    }

    /**
     * Queue a varbit update to be sent to the client.
     */
    private queueVarbit(playerId: number, varbitId: number, value: number): void {
        const event = {
            playerId: playerId,
            varbitId: varbitId,
            value: value,
        };

        if (this.activeFrame) {
            this.activeFrame.varbits ??= [];
            this.activeFrame.varbits.push(event);
            return;
        }

        const ws = this.players?.getSocketByPlayerId(event.playerId);
        if (ws) {
            this.withDirectSendBypass("varbit", () =>
                this.sendWithGuard(
                    ws,
                    encodeMessage({
                        type: "varbit",
                        payload: { varbitId: event.varbitId, value: event.value },
                    }),
                    "varbit",
                ),
            );
            return;
        }

        this.broadcastScheduler.queueVarbit(event.playerId, event.varbitId, event.value);
    }

    private sendSkillsSnapshotImmediate(
        ws: WebSocket,
        player: PlayerState,
        update?: SkillSyncUpdate,
    ): void {
        const sync = update ?? player.takeSkillSync();
        if (!sync) return;
        const payload = {
            kind: sync.snapshot ? ("snapshot" as const) : ("delta" as const),
            skills: sync.skills,
            totalLevel: sync.totalLevel,
            combatLevel: sync.combatLevel,
        };
        this.withDirectSendBypass("skills_snapshot_immediate", () =>
            this.sendWithGuard(
                ws,
                encodeMessage({ type: "skills", payload } as any),
                "skills_snapshot_immediate",
            ),
        );
    }
    private sendSkillsMessage(ws: WebSocket, player: PlayerState, update?: SkillSyncUpdate): void {
        const sync = update ?? player.takeSkillSync();
        if (!sync) return;
        this.queueSkillSnapshot(player.id, sync);
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

    private sendAppearanceUpdate(ws: WebSocket, p: PlayerState): void {
        this.queueAppearanceSnapshot(p);
    }

    private equipItem(
        p: PlayerState,
        slotIndex: number,
        itemId: number,
        equipSlot: number,
        opts?: { playSound?: boolean },
    ): { ok: boolean; reason?: string; categoryChanged: boolean; weaponItemChanged: boolean } {
        if (!this.equipmentHandler) {
            return {
                ok: false,
                reason: "equipment_handler_missing",
                categoryChanged: false,
                weaponItemChanged: false,
            };
        }

        const result = this.equipmentHandler.equipItem(p, slotIndex, itemId, equipSlot, opts);

        return result;
    }

    private consumeItem(p: PlayerState, slotIndex: number): boolean {
        const inv = this.getInventory(p);
        const slotEntry = inv[slotIndex];
        if (!slotEntry || slotEntry.itemId <= 0 || slotEntry.quantity <= 0) return false;
        slotEntry.quantity = Math.max(0, slotEntry.quantity - 1);
        if (slotEntry.quantity <= 0) {
            slotEntry.itemId = -1;
            slotEntry.quantity = 0;
        }
        return true;
    }

    private consumeFiremakingLog(
        player: PlayerState,
        logItemId: number,
        preferredSlot?: number,
    ): number | undefined {
        const inv = this.getInventory(player);
        if (
            preferredSlot !== undefined &&
            preferredSlot >= 0 &&
            preferredSlot < inv.length &&
            inv[preferredSlot] &&
            inv[preferredSlot]!.itemId === logItemId &&
            inv[preferredSlot]!.quantity > 0
        ) {
            if (this.consumeItem(player, preferredSlot)) {
                player.markInventoryDirty();
                return preferredSlot;
            }
        }
        const fallback = this.findInventorySlotWithItem(player, logItemId);
        if (fallback !== undefined && this.consumeItem(player, fallback)) {
            player.markInventoryDirty();
            return fallback;
        }
        return undefined;
    }

    private findInventorySlotWithItem(player: PlayerState, itemId: number): number | undefined {
        if (!(itemId > 0)) return undefined;
        const inv = this.getInventory(player);
        for (let i = 0; i < inv.length; i++) {
            const entry = inv[i];
            if (!entry || entry.quantity <= 0) continue;
            if (entry.itemId === itemId) {
                return i;
            }
        }
        return undefined;
    }

    private playerHasItem(player: PlayerState, itemId: number): boolean {
        return this.findInventorySlotWithItem(player, itemId) !== undefined;
    }

    private findOwnedItemLocation(
        player: PlayerState,
        itemId: number,
    ): OwnedItemLocation | undefined {
        try {
            return findOwnedItemLocationInSnapshot(itemId, {
                inventory: this.getInventory(player),
                equipment: this.ensureEquipArray(player),
                bank: player.getBankEntries(),
            });
        } catch {
            return undefined;
        }
    }

    private countInventoryItem(player: PlayerState, itemId: number): number {
        const inv = this.getInventory(player);
        let total = 0;
        for (const entry of inv) {
            if (!entry || entry.quantity <= 0) continue;
            if (entry.itemId === itemId) {
                total += entry.quantity;
            }
        }
        return total;
    }

    private playerHasTinderbox(player: PlayerState): boolean {
        for (const id of TINDERBOX_ITEM_IDS) {
            if (this.playerHasItem(player, id)) {
                return true;
            }
        }
        return false;
    }


    private restoreInventoryItems(
        player: PlayerState,
        itemId: number,
        removed: Map<number, number>,
    ): void {
        if (removed.size === 0) return;
        const inv = this.getInventory(player);
        for (const [slot, qty] of removed.entries()) {
            if (!(slot >= 0 && slot < inv.length)) continue;
            const current = inv[slot];
            const existingQty = current && current.itemId === itemId ? current.quantity : 0;
            this.setInventorySlot(player, slot, itemId, existingQty + qty);
        }
    }

    private awardSkillXp(player: PlayerState, skillId: SkillId, xp: number): void {
        if (!(xp > 0)) return;
        try {
            const multiplier = this.gamemode.getSkillXpMultiplier(player);
            const skill = player.getSkill(skillId);
            const prev = skill.xp;
            const oldLevel = skill.baseLevel;
            const oldCombatLevel = player.combatLevel;
            const baseDelta = Number.isFinite(xp) ? xp : 0;
            const delta = baseDelta * multiplier;
            if (!(delta > 0)) return;
            player.setSkillXp(skillId, prev + delta);
            const newLevel = player.getSkill(skillId).baseLevel;
            if (newLevel > oldLevel) {
                this.enqueueLevelUpPopup(player, {
                    kind: "skill",
                    skillId: skillId,
                    newLevel,
                    levelIncrement: Math.max(1, newLevel - oldLevel),
                });
            }
            const newCombatLevel = player.combatLevel;
            if (newCombatLevel > oldCombatLevel) {
                this.enqueueLevelUpPopup(player, {
                    kind: "combat",
                    newLevel: newCombatLevel,
                    levelIncrement: Math.max(1, newCombatLevel - oldCombatLevel),
                });
            }
            const update = player.takeSkillSync();
            if (update) {
                this.queueSkillSnapshot(player.id, update);
            }
        } catch {}
    }

    /**
     * Handle spell cast on inventory item (e.g., High Alchemy, Low Alchemy, Superheat)
     * OSRS parity: Uses widget references (spellbook group + widget child ID) to identify spells
     */
    private handleSpellCastOnItem(
        ws: WebSocket,
        payload: {
            spellbookGroupId?: number;
            widgetChildId?: number;
            selectedSpellWidgetId?: number;
            selectedSpellChildIndex?: number;
            selectedSpellItemId?: number;
            spellId?: number; // Legacy fallback
            slot: number;
            itemId: number;
            widgetId?: number;
        },
    ): void {
        const player = this.players?.get(ws);
        if (!player) return;

        const slot = payload.slot;
        const targetItemId = payload.itemId;

        // OSRS parity: Look up spell by widget reference instead of hardcoded spell ID
        let spellData: SpellDataEntry | undefined;
        let spellId: number;
        const resolvedSelection = resolveSelectedSpellPayload(payload);

        if (
            resolvedSelection.spellbookGroupId !== undefined &&
            resolvedSelection.widgetChildId !== undefined
        ) {
            // New OSRS-parity path: look up by widget reference
            spellData = getSpellDataByWidget(
                resolvedSelection.spellbookGroupId,
                resolvedSelection.widgetChildId,
            );
            spellId = spellData?.id ?? -1;
        } else if (payload.spellId !== undefined) {
            // Legacy fallback: look up by spell ID
            spellId = payload.spellId;
            spellData = getSpellData(spellId);
        } else {
            this.sendSpellFailure(player, -1, "invalid_spell");
            return;
        }

        if (!spellData) {
            this.sendSpellFailure(player, spellId, "invalid_spell");
            return;
        }

        // Check magic level
        const magicSkill = player.getSkill(SkillId.Magic);
        const magicLevel = Math.max(1, magicSkill.baseLevel + magicSkill.boost);
        if (spellData.levelRequired && magicLevel < spellData.levelRequired) {
            this.queueChatMessage({
                messageType: "game",
                playerId: player.id,
                text: `You need a Magic level of ${spellData.levelRequired} to cast this spell.`,
            });
            this.sendSpellFailure(player, spellId, "level_requirement");
            return;
        }

        // Get inventory and validate target item
        const inventory = this.getInventory(player);
        const invSlot = inventory[slot];
        if (!invSlot || invSlot.itemId !== targetItemId || invSlot.quantity <= 0) {
            this.sendSpellFailure(player, spellId, "invalid_target");
            return;
        }

        // Validate runes
        if (spellData.runeCosts && spellData.runeCosts.length > 0) {
            const validation = SpellCaster.validate({
                player,
                spellId,
            });
            if (!validation.success) {
                this.queueChatMessage({
                    messageType: "game",
                    playerId: player.id,
                    text: "You don't have the required runes.",
                });
                this.sendSpellFailure(player, spellId, "out_of_runes");
                return;
            }
        }

        // Handle High Level Alchemy (id: 9111) and Low Level Alchemy (id: 9110)
        const HIGH_ALCH_ID = 9111;
        const LOW_ALCH_ID = 9110;
        const COINS_ID = 995;

        if (spellId === HIGH_ALCH_ID || spellId === LOW_ALCH_ID) {
            const itemDef = getItemDefinition(targetItemId);
            if (!itemDef) {
                this.queueChatMessage({
                    messageType: "game",
                    playerId: player.id,
                    text: "You cannot alchemise this item.",
                });
                this.sendSpellFailure(player, spellId, "alch_invalid_item");
                return;
            }

            // Get alch value
            const alchValue = spellId === HIGH_ALCH_ID ? itemDef.highAlch : itemDef.lowAlch;
            if (alchValue <= 0) {
                this.queueChatMessage({
                    messageType: "game",
                    playerId: player.id,
                    text: "You cannot alchemise this item.",
                });
                this.sendSpellFailure(player, spellId, "alch_invalid_item");
                return;
            }

            // Cannot alch coins
            if (targetItemId === COINS_ID) {
                this.queueChatMessage({
                    messageType: "game",
                    playerId: player.id,
                    text: "You cannot alchemise coins.",
                });
                this.sendSpellFailure(player, spellId, "alch_invalid_item");
                return;
            }

            // Consume runes
            if (spellData.runeCosts) {
                const outcome = SpellCaster.execute(
                    { player, spellId },
                    { success: true, spellData },
                );
                if (!outcome.success) {
                    this.sendSpellFailure(player, spellId, "out_of_runes");
                    return;
                }
            }

            // Remove item from inventory (just 1, even if stacked)
            if (invSlot.quantity > 1) {
                this.setInventorySlot(player, slot, targetItemId, invSlot.quantity - 1);
            } else {
                this.setInventorySlot(player, slot, 0, 0);
            }

            // Add coins to inventory
            this.addItemToInventory(player, COINS_ID, alchValue);

            // Award XP (High Alch = 65 XP, Low Alch = 31 XP)
            const xpAward = spellId === HIGH_ALCH_ID ? 65 : 31;
            this.awardSkillXp(player, SkillId.Magic, xpAward);

            // Play animation and spot animation
            const animId = spellId === HIGH_ALCH_ID ? 713 : 712; // High alch anim / Low alch anim
            player.queueOneShotSeq(animId);
            const tick = this.activeFrame?.tick ?? this.options.ticker.currentTick();
            this.enqueueSpotAnimation({
                tick: tick,
                playerId: player.id,
                spotId: spellData.castSpotAnim ?? 113,
                delay: 0,
                height: 100,
            });

            // Sync inventory
            const sock = this.players?.getSocketByPlayerId(player.id);
            if (sock) this.sendInventorySnapshot(sock, player);

            // Send success result
            this.queueSpellResult(player.id, {
                casterId: player.id,
                spellId: spellId,
                outcome: "success",
                targetType: "item",
            });

            logger.info(
                `[magic] Player ${player.id} cast ${spellData.name} on item ${targetItemId} for ${alchValue} coins`,
            );
            return;
        }

        // For other spells on items (like Superheat), add handling here
        this.queueChatMessage({
            messageType: "game",
            playerId: player.id,
            text: "Nothing interesting happens.",
        });
        this.sendSpellFailure(player, spellId, "invalid_target");
    }

    private sendSpellFailure(player: PlayerState, spellId: number, reason: string): void {
        this.queueSpellResult(player.id, {
            casterId: player.id,
            spellId: spellId,
            outcome: "failure",
            reason: reason as any,
            targetType: "item",
        });
    }

    private buildSkillMessageEffect(player: PlayerState, message: string): ActionEffect {
        return {
            type: "message",
            playerId: player.id,
            message,
        };
    }

    private enqueueLevelUpPopup(player: PlayerState, popup: LevelUpPopup): void {
        const playerId = player.id;
        let queue = this.levelUpPopupQueue.get(playerId);
        if (!queue) {
            queue = [];
            this.levelUpPopupQueue.set(playerId, queue);
        }
        queue.push(popup);

        // OSRS parity: Send level-up chat message
        if (popup.kind === "skill") {
            const skillName = getSkillName(popup.skillId);
            const levelUpMessage =
                popup.newLevel === MAX_REAL_LEVEL
                    ? `Congratulations, you've reached the highest possible ${skillName} level of 99.`
                    : `Congratulations, you've just advanced your ${skillName} level. You are now level ${popup.newLevel}.`;
            this.queueChatMessage({
                messageType: "game",
                playerId,
                text: levelUpMessage,
                targetPlayerIds: [playerId],
            });
        }

        if (queue.length === 1) {
            const shown = this.showLevelUpPopup(player, popup);
            if (!shown) {
                queue.shift();
                if (queue.length < 1) {
                    this.levelUpPopupQueue.delete(playerId);
                }
            }
        }
    }

    private closeChatboxModalOverlay(playerIdRaw: number): void {
        const playerId = playerIdRaw;
        const chatboxTargetUid = (CHATBOX_GROUP_ID << 16) | CHATBOX_CHILD_ID;

        // Close the sub-interface mounted on chatbox
        this.queueWidgetEvent(playerId, { action: "close_sub", targetUid: chatboxTargetUid });

        // Reset chatbox modal sizing for subsequent chatbox content.
        this.queueWidgetEvent(playerId, {
            action: "set_varbit",
            varbitId: VARBIT_CHATMODAL_UNCLAMP,
            value: 0,
        });

        // Re-hide MES_LAYER container
        this.queueWidgetEvent(playerId, {
            action: "set_hidden",
            uid: chatboxTargetUid,
            hidden: true,
        });
    }

    private openLevelUpChatboxOverlay(playerIdRaw: number, groupId: number): void {
        const playerId = playerIdRaw;
        const chatboxTargetUid = (CHATBOX_GROUP_ID << 16) | CHATBOX_CHILD_ID;

        // Match the standard chatbox modal setup used by dialogs in this cache revision.
        this.queueWidgetEvent(playerId, {
            action: "set_hidden",
            uid: chatboxTargetUid,
            hidden: false,
        });

        this.queueWidgetEvent(playerId, {
            action: "open_sub",
            targetUid: chatboxTargetUid,
            groupId,
            type: 0,
            varbits: {
                [VARBIT_CHATMODAL_UNCLAMP]: 1,
            },
            // Rev 236 parity: do not hide 162:55 here; CHATMODAL is nested under it.
            preScripts: [{ scriptId: CHATBOX_RESET_SCRIPT_ID, args: [] }],
        });
    }

    /**
     * OSRS parity: Level-up popups do not hard-block gameplay; the chatbox modal should be
     * dismissed when the player initiates another action (walk, attack, etc.).
     */
    private dismissLevelUpPopupQueue(playerIdRaw: number): boolean {
        const playerId = playerIdRaw;
        const queue = this.levelUpPopupQueue.get(playerId);
        if (!queue || queue.length === 0) return false;
        this.levelUpPopupQueue.delete(playerId);
        this.closeChatboxModalOverlay(playerId);
        return true;
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
        const queue = this.levelUpPopupQueue.get(playerId);
        return queue !== undefined && queue.length > 0;
    }

    /**
     * OSRS parity: Interrupt/cancel all queued skill actions for a player.
     * Called when player walks, starts a new interaction, teleports, etc.
     */
    private interruptPlayerSkillActions(playerId: number): void {
        this.actionScheduler.cancelInterruptibleActions(playerId);
    }

    private showLevelUpPopup(player: PlayerState, popup: LevelUpPopup): boolean {
        if (popup.kind === "skill") {
            return this.dispatchLevelUpEffect(
                player,
                popup.skillId,
                popup.newLevel,
                popup.levelIncrement,
            );
        }
        return this.dispatchCombatLevelUpEffect(player, popup.newLevel, popup.levelIncrement);
    }

    private advanceLevelUpPopupQueue(player: PlayerState): void {
        const playerId = player.id;
        const queue = this.levelUpPopupQueue.get(playerId);
        if (!queue || queue.length === 0) return;

        queue.shift();

        while (queue.length > 0) {
            if (this.showLevelUpPopup(player, queue[0])) {
                return;
            }
            queue.shift();
        }

        this.levelUpPopupQueue.delete(playerId);
        this.closeChatboxModalOverlay(playerId);
    }

    private dispatchCombatLevelUpEffect(
        player: PlayerState,
        newCombatLevelRaw: number,
        levelIncrementRaw: number,
    ): boolean {
        const playerId = player.id;
        const newLevel = Math.max(1, newCombatLevelRaw);
        const levelIncrement = Math.max(1, levelIncrementRaw);

        const noun = "combat";
        const firstChar = noun[0] ?? "";
        const vowel =
            firstChar === "a" ||
            firstChar === "e" ||
            firstChar === "i" ||
            firstChar === "o" ||
            firstChar === "u";
        const levelFormat = levelIncrement === 1 ? (vowel ? "an" : "a") : String(levelIncrement);
        const pluralSuffix = levelIncrement === 1 ? "" : "s";

        this.openLevelUpChatboxOverlay(playerId, LEVELUP_INTERFACE_ID);

        // Enable clicking on continue button (component 3) - OSRS parity
        this.queueWidgetEvent(playerId, {
            action: "set_flags",
            uid: (LEVELUP_INTERFACE_ID << 16) | LEVELUP_CONTINUE_COMPONENT,
            flags: 1, // Click enabled (pause button)
        });

        // Hide all skill containers and show the combat-level container.
        for (const componentId of Object.values(LEVELUP_SKILL_COMPONENT_BY_SKILL)) {
            const comp = componentId;
            if (typeof comp !== "number") continue;
            this.queueWidgetEvent(playerId, {
                action: "set_hidden",
                uid: (LEVELUP_INTERFACE_ID << 16) | (comp & 0xffff),
                hidden: true,
            });
        }
        this.queueWidgetEvent(playerId, {
            action: "set_hidden",
            uid: (LEVELUP_INTERFACE_ID << 16) | LEVELUP_COMBAT_COMPONENT,
            hidden: false,
        });

        // Set chatbox texts.
        this.queueWidgetEvent(playerId, {
            action: "set_text",
            uid: (LEVELUP_INTERFACE_ID << 16) | LEVELUP_TEXT1_COMPONENT,
            text: `<col=000080>Congratulations, you just advanced ${levelFormat} ${noun} level${pluralSuffix}.`,
        });
        this.queueWidgetEvent(playerId, {
            action: "set_text",
            uid: (LEVELUP_INTERFACE_ID << 16) | LEVELUP_TEXT2_COMPONENT,
            text: `Your ${noun} level is now ${newLevel}.`,
        });
        this.queueWidgetEvent(playerId, {
            action: "set_text",
            uid: (LEVELUP_INTERFACE_ID << 16) | LEVELUP_CONTINUE_COMPONENT,
            text: "Click here to continue",
        });

        // Broadcast the celebratory gfx to nearby players.

        const tick = this.options.ticker.currentTick();
        this.enqueueSpotAnimation({
            tick,
            playerId,
            spotId: LEVELUP_SPOT_ID,
            delay: 0,
            height: 120,
        });

        // OSRS parity: Play combat level-up jingle
        this.sendJingle(player, LEVELUP_COMBAT_JINGLE_ID, LEVELUP_JINGLE_DELAY);

        // OSRS parity: Play firework sound effect with spotanim
        this.sendSound(player, LEVELUP_FIREWORK_SOUND);

        return true;
    }

    private dispatchHunterLevelUpEffect(
        player: PlayerState,
        newLevelRaw: number,
        levelIncrementRaw: number,
    ): boolean {
        const playerId = player.id;
        const newLevel = Math.max(1, newLevelRaw);
        const levelIncrement = Math.max(1, levelIncrementRaw);

        const noun = "Hunter";
        const levelFormat = levelIncrement === 1 ? "a" : String(levelIncrement);
        const pluralSuffix = levelIncrement === 1 ? "" : "s";

        this.openLevelUpChatboxOverlay(playerId, OBJECTBOX_INTERFACE_ID);

        this.queueWidgetEvent(playerId, {
            action: "set_item",
            uid: (OBJECTBOX_INTERFACE_ID << 16) | 1,
            itemId: HUNTER_LEVELUP_ICON_ITEM_ID,
        });
        this.queueWidgetEvent(playerId, {
            action: "set_text",
            uid: (OBJECTBOX_INTERFACE_ID << 16) | 2,
            text:
                `<col=000080>Congratulations, you've just advanced ${levelFormat} ${noun} level${pluralSuffix}.` +
                `<col=000000><br><br>Your ${noun} level is now ${newLevel}.`,
        });

        const spotId = newLevel === MAX_REAL_LEVEL ? LEVELUP_99_SPOT_ID : LEVELUP_SPOT_ID;
        const tick = this.options.ticker.currentTick();
        this.enqueueSpotAnimation({
            tick,
            playerId,
            spotId,
            delay: 0,
            height: 120,
        });

        // OSRS parity: Play skill-specific level-up jingle (different fanfare for level 99)
        const hunterJingle = LEVELUP_JINGLE_BY_SKILL[SkillId.Hunter] ?? LEVELUP_JINGLE_ID;
        const jingleId = newLevel === MAX_REAL_LEVEL ? LEVELUP_99_JINGLE_ID : hunterJingle;
        this.sendJingle(player, jingleId, LEVELUP_JINGLE_DELAY);

        // OSRS parity: Play firework sound effect with spotanim
        this.sendSound(player, LEVELUP_FIREWORK_SOUND);

        return true;
    }

    private dispatchLevelUpEffect(
        player: PlayerState,
        skillIdRaw: number,
        newLevelRaw: number,
        levelIncrementRaw: number,
    ): boolean {
        const playerId = player.id;
        const skillId = skillIdRaw;
        const newLevel = Math.max(1, newLevelRaw);
        const levelIncrement = Math.max(1, levelIncrementRaw);

        if (skillId === (SkillId.Hunter as number)) {
            return this.dispatchHunterLevelUpEffect(player, newLevel, levelIncrement);
        }

        const targetComponentId = LEVELUP_SKILL_COMPONENT_BY_SKILL[skillId];
        if (targetComponentId === undefined) {
            return false;
        }

        const skillName = getSkillName(skillId as SkillId);
        const firstChar = (skillName[0] ?? "").toLowerCase();
        const vowel =
            firstChar === "a" ||
            firstChar === "e" ||
            firstChar === "i" ||
            firstChar === "o" ||
            firstChar === "u";
        const levelFormat = levelIncrement === 1 ? (vowel ? "an" : "a") : String(levelIncrement);
        const pluralSuffix = levelIncrement === 1 ? "" : "s";

        this.openLevelUpChatboxOverlay(playerId, LEVELUP_INTERFACE_ID);

        // Enable clicking on continue button (component 3) - OSRS parity
        this.queueWidgetEvent(playerId, {
            action: "set_flags",
            uid: (LEVELUP_INTERFACE_ID << 16) | LEVELUP_CONTINUE_COMPONENT,
            flags: 1, // Click enabled (pause button)
        });

        // Show only the matching skill container component (and always hide Combat).
        for (const componentId of Object.values(LEVELUP_SKILL_COMPONENT_BY_SKILL)) {
            const comp = componentId;
            if (typeof comp !== "number") continue;
            this.queueWidgetEvent(playerId, {
                action: "set_hidden",
                uid: (LEVELUP_INTERFACE_ID << 16) | (comp & 0xffff),
                hidden: comp !== targetComponentId,
            });
        }
        this.queueWidgetEvent(playerId, {
            action: "set_hidden",
            uid: (LEVELUP_INTERFACE_ID << 16) | LEVELUP_COMBAT_COMPONENT,
            hidden: true,
        });

        // Set chatbox texts.
        this.queueWidgetEvent(playerId, {
            action: "set_text",
            uid: (LEVELUP_INTERFACE_ID << 16) | LEVELUP_TEXT1_COMPONENT,
            text: `<col=000080>Congratulations, you just advanced ${levelFormat} ${skillName} level${pluralSuffix}.`,
        });
        this.queueWidgetEvent(playerId, {
            action: "set_text",
            uid: (LEVELUP_INTERFACE_ID << 16) | LEVELUP_TEXT2_COMPONENT,
            text: `Your ${skillName} level is now ${newLevel}.`,
        });
        this.queueWidgetEvent(playerId, {
            action: "set_text",
            uid: (LEVELUP_INTERFACE_ID << 16) | LEVELUP_CONTINUE_COMPONENT,
            text: "Click here to continue",
        });

        // Broadcast the celebratory gfx to nearby players.

        const spotId = newLevel === MAX_REAL_LEVEL ? LEVELUP_99_SPOT_ID : LEVELUP_SPOT_ID;
        const tick = this.options.ticker.currentTick();
        this.enqueueSpotAnimation({
            tick,
            playerId,
            spotId,
            delay: 0,
            height: 120,
        });

        // OSRS parity: Play skill-specific level-up jingle (different fanfare for level 99)
        const skillJingle = LEVELUP_JINGLE_BY_SKILL[skillId] ?? LEVELUP_JINGLE_ID;
        const jingleId = newLevel === MAX_REAL_LEVEL ? LEVELUP_99_JINGLE_ID : skillJingle;
        this.sendJingle(player, jingleId, LEVELUP_JINGLE_DELAY);

        // OSRS parity: Play firework sound effect with spotanim
        this.sendSound(player, LEVELUP_FIREWORK_SOUND);

        return true;
    }

    private buildSkillFailure(
        player: PlayerState,
        message: string,
        reason: string,
    ): ActionExecutionResult {
        return {
            ok: false,
            reason,
            effects: [this.buildSkillMessageEffect(player, message)],
        };
    }


    private isRangeLoc(locId: number): boolean {
        if (!(locId > 0) || !this.locTypeLoader) return false;
        try {
            const def = this.locTypeLoader.load(locId);
            if (!def) return false;
            const name = def.name.toLowerCase();
            const supportItems = def.supportItems ?? 0;
            if (name.includes("fire")) return false;
            if (
                name.includes("range") ||
                name.includes("stove") ||
                name.includes("cook") ||
                name.includes("kitchen")
            ) {
                return true;
            }
            return supportItems > 0;
        } catch {
            return false;
        }
    }

    private getWoodcuttingTreeDefinition(locId: number) {
        if (!(locId > 0)) return undefined;
        const treeId = this.woodcuttingLocMap.get(locId);
        if (!treeId) return undefined;
        return getWoodcuttingTreeById(treeId);
    }

    private getMiningRockDefinition(locId: number): MiningRockDefinition | undefined {
        if (!(locId > 0)) return undefined;
        const mapping = this.miningLocMap.get(locId);
        if (!mapping) return undefined;
        const rock = getMiningRockById(mapping.rockId);
        if (!rock) return undefined;
        const depletedLocId = mapping.depletedLocId;
        if (
            typeof depletedLocId === "number" &&
            depletedLocId > 0 &&
            rock.depletedLocId !== depletedLocId
        ) {
            return { ...rock, depletedLocId };
        }
        return rock;
    }

    private getFishingSpotDefinition(npcTypeId: number): FishingSpotDefinition | undefined {
        if (!(npcTypeId > 0)) return undefined;
        const spotId = this.fishingSpotMap.get(npcTypeId);
        if (!spotId) return undefined;
        return getFishingSpotById(spotId);
    }

    private handleInventoryUseMessage(
        ws: WebSocket,
        payload: { slot: number; itemId: number; quantity?: number; option?: string; op?: number } | undefined,
    ): void {
        if (!payload) return;
        const p = this.players?.get(ws);
        if (!p) return;
        const slotIndex = Math.max(0, Math.min(INVENTORY_SLOT_COUNT - 1, payload.slot));
        const inv = this.getInventory(p);
        const slotEntry = inv[slotIndex];
        let optionLower = payload.option?.toLowerCase() ?? "";
        const obj = this.getObjType(payload.itemId);
        const itemDef = getItemDefinition(payload.itemId);
        const equipSlot = this.resolveEquipSlot(payload.itemId);

        // Resolve option from cache inventoryActions when client sends op number but no text
        if (!optionLower && obj?.inventoryActions && typeof payload.op === "number") {
            const opIndex = (payload.op | 0) - 1;
            if (opIndex >= 0 && opIndex < obj.inventoryActions.length) {
                const resolved = obj.inventoryActions[opIndex];
                if (resolved) optionLower = resolved.toLowerCase();
            }
        }

        const nowTick = this.options.ticker.currentTick();
        // First, allow scripts to handle item actions (e.g., bury bones, herblore steps)
        if (optionLower) {
            try {
                const handled = this.scriptRuntime.queueItemAction({
                    tick: nowTick,
                    player: p,
                    itemId: payload.itemId,
                    slot: slotIndex,
                    option: optionLower,
                });
                if (handled) return; // Script claimed the action
            } catch {}
        }

        const hasItemInInventory =
            !!slotEntry && slotEntry.quantity > 0 && slotEntry.itemId === payload.itemId;

        if (optionLower === "drop") {
            if (!hasItemInInventory) return;
            // OSRS parity: Dropping items closes interruptible interfaces
            this.closeInterruptibleInterfaces(p);
            if (itemDef && !itemDef.dropable) {
                this.queueChatMessage({
                    messageType: "game",
                    text: "You can't drop that.",
                    targetPlayerIds: [p.id],
                });
                return;
            }

            const doDrop = () => {
                const currentInv = this.getInventory(p);
                const currentSlot = currentInv[slotIndex];
                if (
                    !currentSlot ||
                    currentSlot.quantity <= 0 ||
                    currentSlot.itemId !== payload.itemId
                ) {
                    return;
                }
                const destroyedQty = currentSlot.quantity;
                this.setInventorySlot(p, slotIndex, -1, 0);
                const dropTile = { x: p.tileX, y: p.tileY, level: p.level };
                // OSRS: Items in wilderness are immediately visible to all players
                const inWilderness = isInWilderness(dropTile.x, dropTile.y);
                this.groundItems.spawn(
                    payload.itemId,
                    destroyedQty,
                    dropTile,
                    this.options.ticker.currentTick(),
                    { ownerId: p.id, privateTicks: inWilderness ? 0 : undefined },
                    p.worldViewId,
                );
                this.withDirectSendBypass("drop_sound", () => this.sendSound(p, ITEM_DROP_SOUND));
                this.checkAndSendSnapshots(p);
                try {
                    logger.debug(
                        `[inventory] dropped item player=%d slot=%d item=%d qty=%d tile=(%d,%d,%d)`,
                        p.id,
                        slotIndex,
                        payload.itemId,
                        destroyedQty,
                        dropTile.x,
                        dropTile.y,
                        dropTile.level,
                    );
                } catch {}
            };

            // OSRS parity: Total value = per-item value * quantity (for stackable items like coins)
            // Special case: Coins (995) have value=0 in item definitions, but each coin is worth 1 GP
            const COINS_ITEM_ID = 995;
            const perItemValue =
                payload.itemId === COINS_ITEM_ID
                    ? 1
                    : itemDef
                    ? itemDef.dropValue || itemDef.value
                    : 0;
            const totalValue = perItemValue * slotEntry.quantity;
            if (totalValue >= 30000) {
                // OSRS parity: Show sprite dialog with item first, then options dialog
                // See CS2 flow: interface 193 (sprite dialog) → interface 219 (options dialog)
                this.widgetDialogHandler.openDialog(p, {
                    kind: "sprite",
                    id: "confirm_drop_warning",
                    itemId: payload.itemId,
                    itemQuantity: slotEntry.quantity,
                    lines: [
                        "The item you are trying to put down is considered",
                        "<col=7f0000>valuable</col>. Are you absolutely sure you want to do that?",
                    ],
                    clickToContinue: true,
                    closeOnContinue: false,
                    onContinue: () => {
                        // After clicking continue, show the Yes/No options dialog
                        this.widgetDialogHandler.openDialogOptions(p, {
                            id: "confirm_drop",
                            title: `Drop ${itemDef?.name ?? "item"}?`,
                            options: ["Yes", "No"],
                            onSelect: (choice) => {
                                if (choice === 0) doDrop();
                            },
                        });
                    },
                });
            } else {
                doDrop();
            }
            return;
        }

        if (equipSlot !== undefined) {
            const equip = this.ensureEquipArray(p);
            const hasItemEquipped = equip[equipSlot] === payload.itemId;
            if (!hasItemInInventory && !hasItemEquipped) return;

            // OSRS parity: Queue equip action to be processed during tick cycle
            // Equipment changes happen in "Process queued actions" phase, tick-aligned but instant (delayTicks: 0)
            const res = this.actionScheduler.requestAction(
                p.id,
                {
                    kind: "inventory.equip",
                    data: {
                        slotIndex,
                        itemId: payload.itemId,
                        option: payload.option,
                        equipSlot,
                    },
                    delayTicks: 0,
                    groups: ["inventory"],
                    cooldownTicks: 0, // No cooldown on equipping
                },
                nowTick,
            );
            if (!res.ok) {
                logger.info(
                    `[action] equip request rejected player=${p.id} reason=${
                        res.reason ?? "unknown"
                    }`,
                );
            }
        } else if (this.isConsumable(obj, optionLower)) {
            if (!hasItemInInventory) return;
            const res = this.actionScheduler.requestAction(
                p.id,
                {
                    kind: "inventory.consume",
                    data: { slotIndex, itemId: payload.itemId, option: payload.option },
                    delayTicks: 0, // Consume happens immediately
                    groups: ["inventory"],
                    cooldownTicks: 3, // 3-tick cooldown between eating/drinking (OSRS standard)
                },
                nowTick,
            );
            if (!res.ok) {
                logger.info(
                    `[action] consume request rejected player=${p.id} reason=${
                        res.reason ?? "unknown"
                    }`,
                );
            }
        }
    }

    private handleInventoryMoveMessage(
        ws: WebSocket,
        payload: { from: number; to: number } | undefined,
    ): void {
        if (!payload) return;
        const p = this.players?.get(ws);
        if (!p) return;
        const from = Math.max(0, Math.min(INVENTORY_SLOT_COUNT - 1, payload.from));
        const to = Math.max(0, Math.min(INVENTORY_SLOT_COUNT - 1, payload.to));
        if (from === to) return;
        const inv = this.getInventory(p);
        const src = inv[from];
        if (!src || src.itemId <= 0 || src.quantity <= 0) return;

        const nowTick = this.options.ticker.currentTick();

        // OSRS parity: Queue move action to be processed during tick cycle
        // Ensures consistency with other inventory operations (equip/unequip)
        const res = this.actionScheduler.requestAction(
            p.id,
            {
                kind: "inventory.move",
                data: { from, to },
                delayTicks: 0,
                groups: ["inventory"],
                cooldownTicks: 0, // No cooldown on moving items
            },
            nowTick,
        );
        if (!res.ok) {
            logger.info(
                `[action] inventory move rejected player=${p.id} reason=${res.reason ?? "unknown"}`,
            );
        }
    }

    private handleGroundItemAction(
        ws: WebSocket,
        payload: GroundItemActionPayload | undefined,
    ): void {
        // Interface closing handled centrally by INTERFACE_CLOSING_ACTIONS check
        // Ground item interaction supersedes any pending walk command from earlier clicks.
        this.pendingWalkCommands.delete(ws);
        this.groundItemHandler.handleGroundItemAction(ws, payload);
    }

    private attemptTakeGroundItem(
        player: PlayerState,
        tile: { x: number; y: number; level: number },
        itemId: number,
        stackId: number,
        requestedQuantity?: number,
    ): void {
        this.groundItemHandler.attemptTakeGroundItem(
            player,
            tile,
            itemId,
            stackId,
            requestedQuantity,
        );
    }

    private performEquipmentAction(
        player: PlayerState,
        action: { slot: number; itemId: number; optionLabel: string },
    ): boolean {
        const optionLower = action.optionLabel.toLowerCase();
        let handled = false;
        let deferredFallback: (() => boolean) | undefined;
        switch (optionLower) {
            case "operate":
                handled = this.tryHandleOperateAction(player, action.slot, action.itemId);
                break;
            case "check":
                deferredFallback = () =>
                    this.tryHandleCheckAction(player, action.slot, action.itemId);
                break;
            default:
                break;
        }
        if (!handled) {
            handled = this.tryDispatchEquipmentActionScript(player, action, optionLower);
        }
        if (!handled && deferredFallback) {
            handled = deferredFallback();
        }
        return handled;
    }

    private tryHandleOperateAction(player: PlayerState, slot: number, itemId: number): boolean {
        if (this.tryHandleSkillcapeOperate(player, slot, itemId)) {
            return true;
        }
        return false;
    }

    private tryHandleCheckAction(player: PlayerState, slot: number, itemId: number): boolean {
        // Default generic feedback; real charge details should be provided by scripts.
        const obj = this.getObjType(itemId);
        const name = obj?.name && obj.name.length > 0 ? obj.name : "item";
        const examine = obj?.examine && obj.examine.length > 0 ? obj.examine : "It looks ordinary.";
        this.queueChatMessage({
            messageType: "game",
            text: `You check the ${name.toLowerCase()}. ${examine}`,
            targetPlayerIds: [player.id],
        });
        return true;
    }

    private tryHandleSkillcapeOperate(
        player: PlayerState,
        slot: number,
        capeItemId: number,
    ): boolean {
        if (slot !== EquipmentSlot.CAPE) return false;
        const seqId = getSkillcapeSeqId(capeItemId);
        const rawSpotId = getSkillcapeSpotId(capeItemId);
        if (seqId === undefined && rawSpotId === undefined) return false;
        const spotIdResolved = rawSpotId !== undefined && rawSpotId >= 0 ? rawSpotId : 833;
        if (seqId !== undefined && seqId >= 0) {
            try {
                player.queueOneShotSeq(seqId);
            } catch (err) {
                logger.warn(
                    `[equipment] failed to queue skillcape sequence player=${player.id} seq=${seqId}`,
                    err,
                );
            }
        }
        if (spotIdResolved >= 0) {
            const tick = this.options.ticker.currentTick();
            this.enqueueSpotAnimation({
                tick,
                playerId: player.id,
                spotId: spotIdResolved,
                delay: 0,
                height: 120,
            });
        }
        const obj = this.getObjType(capeItemId);
        const capeName = obj?.name && obj.name.length > 0 ? obj.name : "cape";
        this.queueChatMessage({
            messageType: "game",
            text: `You operate the ${capeName}.`,
            targetPlayerIds: [player.id],
        });
        logger.info(
            `[equipment] player=${player.id} operated skillcape item=${capeItemId} seq=${
                seqId ?? -1
            } spot=${spotIdResolved}`,
        );
        return true;
    }

    private tryDispatchEquipmentActionScript(
        player: PlayerState,
        action: { slot: number; itemId: number; optionLabel: string },
        optionLower: string,
    ): boolean {
        try {
            const tick = this.options.ticker.currentTick();
            return this.scriptRuntime.queueEquipmentAction({
                tick,
                player,
                slot: action.slot,
                itemId: action.itemId,
                option: optionLower,
                rawOption: action.optionLabel,
            });
        } catch (err) {
            logger.warn("[equipment] failed to dispatch equipment action to scripts", err);
            return false;
        }
    }

    private onConnection(ws: WebSocket) {
        logger.info("Client connected");
        this.playerSyncSessions.set(ws, new PlayerSyncSession());
        // Send welcome
        this.withDirectSendBypass("welcome_packet", () =>
            this.sendWithGuard(
                ws,
                encodeMessage({
                    type: "welcome",
                    payload: { tickMs: this.options.tickMs, serverTime: Date.now() },
                }),
                "welcome_packet",
            ),
        );
        // Defer player spawn until after handshake

        ws.on("message", (raw) => {
            // For new binary protocol messages that need legacy handlers (login, handshake)
            let binaryParsed: RoutedMessage | null = null;

            // Handle binary packets
            if (isBinaryData(raw)) {
                // Check if this is from the new JSON-replacement protocol (opcodes >= 180)
                if (isNewProtocolPacket(raw as Buffer | ArrayBuffer)) {
                    const decoded = decodeClientPacket(toUint8Array(raw));
                    if (decoded) {
                        // Route through MessageRouter (same as JSON path)
                        if (this.messageRouter.dispatch(ws, decoded)) {
                            return;
                        }
                        // Fall through to legacy handlers for messages like 'login', 'handshake'
                        binaryParsed = decoded;
                    } else {
                        return;
                    }
                } else {
                    // Handle OSRS-style binary packets (opcodes 1-103)
                    const data = toUint8Array(raw);
                    const packets = parsePacketsAsMessages(data);
                    for (const { msg, packet } of packets) {
                        if (packet.type === "appearance_set") {
                            const p = this.players?.get(ws);
                            if (!p) continue;
                            const ap = packet as AppearanceSetPacket;

                            const appearance = this.getOrCreateAppearance(p);
                            appearance.gender = ap.gender === 1 ? 1 : 0;
                            appearance.kits = new Array<number>(7).fill(-1);
                            appearance.colors = new Array<number>(5).fill(0);
                            for (let i = 0; i < 7 && i < ap.kits.length; i++) {
                                appearance.kits[i] = ap.kits[i];
                            }
                            for (let i = 0; i < 5 && i < ap.colors.length; i++) {
                                appearance.colors[i] = ap.colors[i];
                            }

                            // Validate / fill defaults against cache (drops invalid kits for the chosen gender).
                            this.refreshAppearanceKits(p);
                            p.markAppearanceDirty();
                            this.queueAppearanceSnapshot(p);

                            // Advance onboarding (required design complete).
                            p.accountStage = 1;
                            try {
                                const key = p.__saveKey;
                                if (key && key.length > 0) {
                                    this.playerPersistence.saveSnapshot(key, p);
                                }
                            } catch {}

                            // Close PlayerDesign (sub-interface in mainmodal).
                            try {
                                p.widgets.close(679);
                            } catch {}

                            // Apply post-design logic and teleport to spawn.
                            try {
                                this.gamemode.onPostDesignComplete?.(p);
                                const spawn = this.gamemode.getSpawnLocation(p);
                                this.teleportPlayer(p, spawn.x, spawn.y, spawn.level);
                                const name = p.name;
                                const appearanceSnapshot = p.appearance;
                                this.queueAppearanceSnapshot(p, {
                                    x: (spawn.x << 7) + 64,
                                    y: (spawn.y << 7) + 64,
                                    level: spawn.level,
                                    rot: p.rot,
                                    orientation: p.getOrientation() & 2047,
                                    running: false,
                                    appearance: appearanceSnapshot,
                                    name,
                                    moved: true,
                                    turned: false,
                                    snap: true,
                                });
                            } catch {}

                            // Gamemode post-design UI (e.g. tutorial overlay)
                            if (this.gamemode.isTutorialActive(p)) {
                                this.gamemodeUi?.queueTutorialOverlay(p, { queueFlashsideVarbitOnStep3: true });
                            } else {
                                // No tutorial — open all tabs and advance to full account stage.
                                p.accountStage = 2;
                                const displayMode = p.displayMode ?? 1;
                                const { getDefaultInterfaces: getDefIntf } = require("../widgets/WidgetManager");
                                const allInterfaces = getDefIntf(displayMode);
                                for (const intf of allInterfaces) {
                                    this.queueWidgetEvent(p.id, {
                                        action: "open_sub",
                                        targetUid: intf.targetUid,
                                        groupId: intf.groupId,
                                        type: intf.type,
                                        ...(Array.isArray(intf.postScripts) && intf.postScripts.length > 0
                                            ? { postScripts: intf.postScripts }
                                            : {}),
                                    });
                                }
                            }
                            continue;
                        }

                        if (!msg && this.handleExaminePacket(ws, packet)) {
                            continue;
                        }

                        // msg is already converted by parsePacketsAsMessages().
                        // Route through MessageRouter first so OSRS packet-path actions
                        // (npc/loc/spell/etc.) share the same canonical handlers.
                        if (msg) {
                            if (this.messageRouter.dispatch(ws, msg)) {
                                continue;
                            }
                            this.processBinaryMessage(ws, msg);
                        }
                    }
                    return;
                }
                // New protocol message needs legacy handler - don't return, fall through
            }

            // JSON protocol removed - only binary is supported
            if (!binaryParsed) {
                console.warn("[ws] Received non-binary message, ignoring");
                return;
            }
            const parsed = binaryParsed;

            // Try to dispatch via MessageRouter first (handles INTERFACE_CLOSING_ACTIONS internally)
            // Note: This path is only for new protocol messages that need legacy handlers
            if (this.messageRouter.dispatch(ws, parsed)) {
                return; // Handler found and executed
            }

            // Fall through to legacy handlers for messages not yet migrated to MessageRouter
            if (parsed.type === "login") {
                // Handle login request with proper validation
                const { username, password, revision } = parsed.payload;
                const normalizedUsername = (username || "").trim().toLowerCase();

                // Helper to send login error response
                const sendLoginError = (errorCode: number, error: string) => {
                    this.withDirectSendBypass("login_response", () =>
                        this.sendWithGuard(
                            ws,
                            encodeMessage({
                                type: "login_response",
                                payload: { success: false, errorCode, error },
                            }),
                            "login_response",
                        ),
                    );
                    logger.info(`Login failed (code ${errorCode}): ${username} - ${error}`);
                };

                // Get client IP for rate limiting (fallback to ws identifier)
                const clientIp = this.getSocketRemoteAddress(ws) ?? "ws-unknown";
                logger.info(`Login attempt from: ${username} (${clientIp})`);

                // 0. Check client revision matches server
                const serverRevision = this.cacheEnv?.info?.revision ?? 0;
                if (serverRevision > 0 && revision !== serverRevision) {
                    sendLoginError(6, "Please close the client and reload to update.");
                    return;
                }

                // 1. Check rate limiting first
                if (this.checkLoginRateLimit(clientIp)) {
                    sendLoginError(9, "Login limit exceeded. Please wait a minute.");
                    return;
                }

                // 2. Check maintenance mode
                if (this.maintenanceMode) {
                    sendLoginError(14, "The server is being updated. Please wait.");
                    return;
                }

                // 3. Check world capacity
                if (this.isWorldFull()) {
                    sendLoginError(2, "This world is full. Please use a different world.");
                    return;
                }

                // 4. Validate username is not empty
                if (!normalizedUsername || normalizedUsername.length === 0) {
                    sendLoginError(3, "Invalid username or password.");
                    return;
                }

                // 5. Check if already logged in
                if (this.isPlayerAlreadyLoggedIn(normalizedUsername)) {
                    sendLoginError(
                        5,
                        "Your account is already logged in. Try again in 60 seconds.",
                    );
                    return;
                }

                // All checks passed - login successful
                const displayName = (username ?? "").slice(0, 12);
                this.setPendingLoginName(ws, displayName);
                this.withDirectSendBypass("login_response", () =>
                    this.sendWithGuard(
                        ws,
                        encodeMessage({
                            type: "login_response",
                            payload: {
                                success: true,
                                displayName,
                            },
                        }),
                        "login_response",
                    ),
                );
                logger.info(`Login successful: ${username}`);
            } else if (parsed.type === "handshake") {
                // Accept handshake and assign player id, then spawn
                try {
                    // Get player name first to check for orphaned session
                    const pendingLoginName = this.consumePendingLoginName(ws);
                    const name = pendingLoginName || parsed.payload.name?.slice(0, 12) || undefined;

                    // Check for orphaned player (disconnected while in combat)
                    // We need to compute a preliminary save key based on name
                    const preliminarySaveKey = normalizePlayerAccountName(name);
                    let p: import("../game/player").PlayerState | undefined;
                    let isReconnect = false;

                    if (preliminarySaveKey && this.players?.hasOrphanedPlayer(preliminarySaveKey)) {
                        // Reconnect to orphaned player
                        p = this.players.reconnectOrphanedPlayer(ws, preliminarySaveKey);
                        if (p) {
                            isReconnect = true;
                            logger.info(
                                `[handshake] Player ${name} reconnected to orphaned session (id=${p.id})`,
                            );
                        }
                    }

                    if (!p) {
                        // No orphaned session - create new player
                        const spawn = this.gamemode.getSpawnLocation(undefined as any);
                        const spawnX = spawn.x,
                            spawnY = spawn.y,
                            level = spawn.level;
                        p = this.players?.add(ws, spawnX, spawnY, level);
                    }

                    if (!p) {
                        try {
                            ws.close(1013, "server_full");
                        } catch {}
                        return;
                    }
                    {
                        p.widgets.setDispatcher((action) => {
                            if (action.action === "close") {
                                this.widgetDialogHandler.handleWidgetCloseState(p!, action.groupId);
                            }
                            this.queueWidgetEvent(p!.id, action);
                        });

                        if (!isReconnect) {
                            // Only register with action scheduler for new players
                            // Orphaned players were never unregistered
                            this.actionScheduler.registerPlayer(p);
                        }

                        // RSMod parity: Set item definition resolver for inventory operations
                        p.setItemDefResolver((id) => getItemDefinition(id));

                        // Wire up death callback (tick-based death sequence)
                        p.onDeath = () => {
                            if (this.playerDeathService) {
                                this.playerDeathService.startPlayerDeath(p!);
                            }
                        };

                        const appearance =
                            parsed.payload.appearance !== undefined
                                ? this.sanitizeHandshakeAppearance(parsed.payload.appearance)
                                : this.createDefaultAppearance();

                        if (!isReconnect) {
                            // Only set name/appearance for new players
                            p.name = name ?? "";
                            p.appearance = appearance;
                            this.ensureEquipArray(p);
                            this.refreshAppearanceKits(p);
                            this.refreshCombatWeaponCategory(p);
                            p.attackDelay = this.pickAttackSpeed(p);
                            const saveKey = this.getPlayerSaveKey(name, p.id);
                            p.__saveKey = saveKey;
                            try {
                                this.playerPersistence.applyToPlayer(p, saveKey);
                            } catch (err) {
                                logger.warn("[player] failed to apply persistent vars", err);
                            }
                            // New accounts (no persistence key yet) must complete the player design flow.
                            // Existing saves default to post-design stage unless persisted otherwise.
                            try {
                                if (!this.playerPersistence.hasKey(saveKey)) {
                                    p.accountStage = 0;
                                } else if (!Number.isFinite(p.accountStage)) {
                                    p.accountStage = 1;
                                }
                            } catch {
                                if (!Number.isFinite(p.accountStage)) p.accountStage = 1;
                            }
                            // Let the gamemode resolve account stage (e.g. tutorial completion).
                            try {
                                this.gamemode.resolveAccountStage?.(p);
                            } catch {}
                            // Force run mode on login (default to enabled)
                            p.setRunToggle(true);
                            try {
                                this.refreshAppearanceKits(p);
                                this.refreshCombatWeaponCategory(p);
                            } catch (err) {
                                logger.warn(
                                    "[player] failed to refresh appearance after persist",
                                    err,
                                );
                            }
                        } else {
                            // Reconnecting - just refresh appearance in case client needs it
                            logger.info(
                                `[handshake] Resuming player ${name} at (${p.tileX}, ${p.tileY})`,
                            );
                        }

                        try {
                            this.followerManager?.restoreFollowerForPlayer(p);
                        } catch (err) {
                            logger.warn("[follower] failed to restore player follower", err);
                        }

                        // Unlock all achievement diaries
                        // Structure: [varbitId, value] pairs
                        const DIARY_VARBITS: Array<[number, number]> = [
                            // === STARTED FLAGS (1 = started) ===
                            [3576, 1], // Karamja (atjun_started)
                            [4448, 1], // Ardougne
                            [4449, 1], // Falador
                            [4450, 1], // Fremennik
                            [4451, 1], // Kandarin
                            [4452, 1], // Desert
                            [4453, 1], // Lumbridge
                            [4454, 1], // Morytania
                            [4455, 1], // Varrock
                            [4456, 1], // Western
                            [4457, 1], // Wilderness
                            [7924, 1], // Kourend

                            // === COMPLETION FLAGS (1 = complete) ===
                            // Ardougne
                            [4458, 1],
                            [4459, 1],
                            [4460, 1],
                            [4461, 1],
                            // Desert
                            [4483, 1],
                            [4484, 1],
                            [4485, 1],
                            [4486, 1],
                            // Falador
                            [4462, 1],
                            [4463, 1],
                            [4464, 1],
                            [4465, 1],
                            // Fremennik
                            [4491, 1],
                            [4492, 1],
                            [4493, 1],
                            [4494, 1],
                            // Kandarin
                            [4475, 1],
                            [4476, 1],
                            [4477, 1],
                            [4478, 1],
                            // Karamja (atjun)
                            // OSRS CS2 parity: these "done" varbits use value 2 when complete.
                            [3578, 2],
                            [3599, 2],
                            [3611, 2],
                            [4566, 1],
                            // Kourend
                            [7925, 1],
                            [7926, 1],
                            [7927, 1],
                            [7928, 1],
                            // Lumbridge
                            [4495, 1],
                            [4496, 1],
                            [4497, 1],
                            [4498, 1],
                            // Morytania
                            [4487, 1],
                            [4488, 1],
                            [4489, 1],
                            [4490, 1],
                            // Varrock
                            [4479, 1],
                            [4480, 1],
                            [4481, 1],
                            [4482, 1],
                            // Western
                            [4471, 1],
                            [4472, 1],
                            [4473, 1],
                            [4474, 1],
                            // Wilderness
                            [4466, 1],
                            [4467, 1],
                            [4468, 1],
                            [4469, 1],

                            // === TASK COUNTS (set to max required for each tier) ===
                            // Karamja: easy=10, med=19, hard=10, elite=5
                            [2423, 10],
                            [6288, 19],
                            [6289, 10],
                            [6290, 5],
                            // Ardougne: easy=10, med=12, hard=12, elite=8
                            [6291, 10],
                            [6292, 12],
                            [6293, 12],
                            [6294, 8],
                            // Desert: easy=11, med=12, hard=10, elite=6
                            [6295, 11],
                            [6296, 12],
                            [6297, 10],
                            [6298, 6],
                            // Falador: easy=11, med=14, hard=11, elite=6
                            [6299, 11],
                            [6300, 14],
                            [6301, 11],
                            [6302, 6],
                            // Fremennik: easy=10, med=9, hard=9, elite=6
                            [6303, 10],
                            [6304, 9],
                            [6305, 9],
                            [6306, 6],
                            // Kandarin: easy=11, med=14, hard=11, elite=7
                            [6307, 11],
                            [6308, 14],
                            [6309, 11],
                            [6310, 7],
                            // Lumbridge: easy=12, med=12, hard=11, elite=6
                            [6311, 12],
                            [6312, 12],
                            [6313, 11],
                            [6314, 6],
                            // Morytania: easy=11, med=11, hard=10, elite=6
                            [6315, 11],
                            [6316, 11],
                            [6317, 10],
                            [6318, 6],
                            // Varrock: easy=14, med=13, hard=10, elite=5
                            [6319, 14],
                            [6320, 13],
                            [6321, 10],
                            [6322, 5],
                            // Wilderness: easy=12, med=11, hard=10, elite=7
                            [6323, 12],
                            [6324, 11],
                            [6325, 10],
                            [6326, 7],
                            // Western: easy=11, med=13, hard=13, elite=7
                            [6327, 11],
                            [6328, 13],
                            [6329, 13],
                            [6330, 7],
                            // Kourend: easy=12, med=13, hard=10, elite=8
                            [7933, 12],
                            [7934, 13],
                            [7935, 10],
                            [7936, 8],

                            // === REWARD FLAGS (1 = claimed) ===
                            // Karamja: easy=3577, med=3598, hard=3610, elite=4567
                            [3577, 1],
                            [3598, 1],
                            [3610, 1],
                            [4567, 1],
                            // Ardougne: easy=4499, med=4500, hard=4501, elite=4502
                            [4499, 1],
                            [4500, 1],
                            [4501, 1],
                            [4502, 1],
                            // Falador: easy=4503, med=4504, hard=4505, elite=4506
                            [4503, 1],
                            [4504, 1],
                            [4505, 1],
                            [4506, 1],
                            // Wilderness: easy=4507, med=4508, hard=4509, elite=4510
                            [4507, 1],
                            [4508, 1],
                            [4509, 1],
                            [4510, 1],
                            // Western: easy=4511, med=4512, hard=4513, elite=4514
                            [4511, 1],
                            [4512, 1],
                            [4513, 1],
                            [4514, 1],
                            // Kandarin: easy=4515, med=4516, hard=4517, elite=4518
                            [4515, 1],
                            [4516, 1],
                            [4517, 1],
                            [4518, 1],
                            // Varrock: easy=4519, med=4520, hard=4521, elite=4522
                            [4519, 1],
                            [4520, 1],
                            [4521, 1],
                            [4522, 1],
                            // Desert: easy=4523, med=4524, hard=4525, elite=4526
                            [4523, 1],
                            [4524, 1],
                            [4525, 1],
                            [4526, 1],
                            // Morytania: easy=4527, med=4528, hard=4529, elite=4530
                            [4527, 1],
                            [4528, 1],
                            [4529, 1],
                            [4530, 1],
                            // Fremennik: easy=4531, med=4532, hard=4533, elite=4534
                            [4531, 1],
                            [4532, 1],
                            [4533, 1],
                            [4534, 1],
                            // Lumbridge: easy=4535, med=4536, hard=4537, elite=4538
                            [4535, 1],
                            [4536, 1],
                            [4537, 1],
                            [4538, 1],
                            // Kourend: easy=7929, med=7930, hard=7931, elite=7932
                            [7929, 1],
                            [7930, 1],
                            [7931, 1],
                            [7932, 1],
                        ];
                        for (const [varbitId, value] of DIARY_VARBITS) {
                            p.setVarbitValue(varbitId, value);
                        }

                        const handshakeAppearance = p.appearance;
                        const handshakeName = this.getAppearanceDisplayName(p) || name;
                        const handshakeChatIcons = this.isAdminPlayer(p)
                            ? [ADMIN_CROWN_ICON]
                            : undefined;
                        // Confirm handshake to client with assigned id and appearance
                        this.withDirectSendBypass("handshake_ack", () =>
                            this.sendWithGuard(
                                ws,
                                encodeMessage({
                                    type: "handshake",
                                    payload: {
                                        id: p.id,
                                        name: handshakeName,
                                        appearance: handshakeAppearance,
                                        chatIcons: handshakeChatIcons,
                                    } as any,
                                }),
                                "handshake_ack",
                            ),
                        );
                        this.sendAnimUpdate(ws, p);
                        this.sendInventorySnapshotImmediate(ws, p);
                        // OSRS parity: ensure login sends a full skill snapshot (packet 134 burst).
                        // Without this, reconnect paths can end up sending only deltas (or nothing),
                        // leading to briefly incorrect levels until the next XP/HP change.
                        p.requestFullSkillSync();
                        this.sendSkillsSnapshotImmediate(ws, p);
                        this.sendCombatState(ws, p);
                        this.sendRunEnergyState(ws, p);
                        // Send saved transmit varps to restore client state
                        this.sendSavedTransmitVarps(ws, p);
                        this.sendCollectionLogDisplayVarps(ws, p);
                        this.sendSavedAutocastTransmitVarbits(ws, p);
                        // Account type (varbit 1777) drives ownership filtering for ground items.
                        this.syncAccountTypeVarbit(ws, p);
                        const sideJournalState = this.normalizeSideJournalState(p);
                        // Send side-journal tab state immediately so varp/varbit selection state
                        // is synchronized before side_journal scripts execute.
                        this.withDirectSendBypass("varp", () =>
                            this.sendWithGuard(
                                ws,
                                encodeMessage({
                                    type: "varp",
                                    payload: {
                                        varpId: VARP_SIDE_JOURNAL_STATE,
                                        value: sideJournalState.stateVarp,
                                    },
                                }),
                                "varp",
                            ),
                        );
                        this.withDirectSendBypass("varbit", () =>
                            this.sendWithGuard(
                                ws,
                                encodeMessage({
                                    type: "varbit",
                                    payload: {
                                        varbitId: VARBIT_SIDE_JOURNAL_TAB,
                                        value: sideJournalState.tab,
                                    },
                                }),
                                "varbit",
                            ),
                        );

                        // Send diary varbits to client
                        for (const [varbitId, value] of DIARY_VARBITS) {
                            this.withDirectSendBypass("varbit", () =>
                                this.sendWithGuard(
                                    ws,
                                    encodeMessage({
                                        type: "varbit",
                                        payload: { varbitId, value },
                                    }),
                                    "varbit",
                                ),
                            );
                        }

                        // Send gamemode content data (tasks, masteries, etc.) before any varps
                        const contentDataPacket = this.gamemode.getContentDataPacket?.();
                        if (contentDataPacket) {
                            this.withDirectSendBypass("gamemode_data", () =>
                                this.sendWithGuard(ws, contentDataPacket, "gamemode_data"),
                            );
                        }

                        // Gamemode handshake: send gamemode-specific varps/varbits
                        this.gamemode.onPlayerHandshake(p, {
                            sendVarp: (varpId, value) =>
                                this.withDirectSendBypass("varp", () =>
                                    this.sendWithGuard(ws, encodeMessage({
                                        type: "varp",
                                        payload: { varpId, value },
                                    }), "varp"),
                                ),
                            sendVarbit: (varbitId, value) =>
                                this.withDirectSendBypass("varbit", () =>
                                    this.sendWithGuard(ws, encodeMessage({
                                        type: "varbit",
                                        payload: { varbitId, value },
                                    }), "varbit"),
                                ),
                            queueVarp: (playerId, varpId, value) =>
                                this.queueVarp(playerId, varpId, value),
                            queueVarbit: (playerId, varbitId, value) =>
                                this.queueVarbit(playerId, varbitId, value),
                            queueNotification: (playerId, notification) =>
                                this.queueNotification(playerId, notification),
                        });

                        const clientType = parsed.payload.clientType;
                        const isMobileClient = clientType === 1;

                        // Seed standalone root bootstrap scripts before the root interface mounts.
                        // Reference cache:
                        // - clientscript 626 -> camera zoom clamp varcs for toplevel_resize
                        // - clientscript 5487 -> enhanced highlight/clientop channel bootstrap
                        // - proc 7581 -> enhanced NPC tagging client-op bootstrap
                        // These arrive as RUN_CLIENT_SCRIPT before root setup, not from later
                        // widget events or sub-interface post-scripts.
                        {
                            const {
                                getDefaultInterfaces,
                                getRootInterfaceId,
                                DisplayMode,
                            } = require("../widgets/WidgetManager");
                            const { getViewportRootInitScripts } = require("../widgets/viewport");
                            const displayMode = isMobileClient
                                ? DisplayMode.MOBILE
                                : DisplayMode.RESIZABLE_NORMAL;
                            const rootInterfaceGroupId = getRootInterfaceId(displayMode);
                            for (const script of getViewportRootInitScripts()) {
                                this.withDirectSendBypass("runClientScript", () =>
                                    this.sendWithGuard(
                                        ws,
                                        encodeMessage({
                                            type: "runClientScript",
                                            payload: {
                                                scriptId: script.scriptId,
                                                args: script.args,
                                            },
                                        }),
                                        "runClientScript",
                                    ),
                                );
                            }
                            this.queueWidgetEvent(p.id, {
                                action: "set_root",
                                groupId: rootInterfaceGroupId,
                            });

                            // Send IF_OPENSUB packets to populate all the tabs.
                            // These trigger onSubChange events that re-run sidebuttons_enable.
                            // Store the display mode on the player for later use (e.g., when opening interfaces)
                            p.displayMode = displayMode;

                            // Check which tabs to show based on account stage and tutorial progress:
                            // - accountStage 0 (char creation): NO tabs
                            // - accountStage 1, step 0 (welcome screen): NO tabs (Quest tab opens on "Get Started")
                            // - accountStage 1, step >= 1 (in tutorial): Quest tab only
                            // - accountStage 2 (tutorial complete): all tabs
                            const accountStage = p.accountStage;
                            const tutorialActive = this.gamemode.isTutorialActive(p);
                            const tutorialMode = accountStage >= 1 && tutorialActive;
                            const charCreationMode = accountStage === 0;
                            // Hide ALL tabs until the player starts the tutorial
                            const preStartMode = charCreationMode || (this.gamemode.isTutorialPreStart?.(p) ?? false);

                            const interfaces = getDefaultInterfaces(displayMode, {
                                tutorialMode: tutorialMode || charCreationMode,
                            });
                            // During char creation or welcome screen, don't open even the Quest tab
                            const filteredInterfaces = preStartMode
                                ? interfaces.filter((i: { groupId: number }) => i.groupId !== 629)
                                : interfaces;
                            const xpDropsEnabled = p.getVarbitValue(VARBIT_XPDROPS_ENABLED) === 1;
                            for (const intf of filteredInterfaces) {
                                // For quest tab (group 629 - side_journal), send quest progress varps/varbits
                                // These varps control quest visibility and list height
                                const questVarps: Record<number, number> = {};
                                const questVarbits: Record<number, number> = {};
                                if (intf.groupId === SIDE_JOURNAL_GROUP_ID) {
                                    // Quest progress varps would come from player save data in a real implementation.
                                    // We no longer blindly set varps 0-499 to 1, as this overwrites many
                                    // non-quest varps (e.g., varp 83 = PRAYER0, and others affecting prayerbook state).

                                    // Include gamemode-specific varps/varbits in the open_sub payload
                                    // so they're applied synchronously BEFORE the interface's CS2 scripts run.
                                    const gamemodeSideJournalBootstrap =
                                        this.gamemodeUi?.getSideJournalBootstrapState(p)
                                        ?? { varps: {}, varbits: {} };
                                    Object.assign(questVarps, gamemodeSideJournalBootstrap.varps);
                                    Object.assign(questVarbits, gamemodeSideJournalBootstrap.varbits);

                                    // Quest count varbits - these control the "Completed: X/Y" and "Quest Points: X/Y" display
                                    // Varbit 6347 = QUESTS_COMPLETED_COUNT - number of completed quests
                                    // Varbit 11877 = QUESTS_TOTAL_COUNT - total number of quests available
                                    // Varbit 1782 = QP_MAX - maximum quest points available
                                    // In a real implementation, these would be calculated from player save data.
                                    // For now, set reasonable defaults so the UI displays properly.
                                    questVarbits[6347] = 0; // quests_completed_count (0 completed)
                                    questVarbits[11877] = 158; // quests_total_count (158 total quests in OSRS)
                                    questVarbits[1782] = 300; // qp_max (300 max quest points)

                                    // Varp 101 = QP (current quest points)
                                    // Varp 904 = QP_TOTAL (triggers UI update for quest points display)
                                    questVarps[101] = 0; // qp (0 current quest points)
                                    questVarps[904] = 300; // qp_total (triggers questlist_qp script)
                                }
                                // Merge interface-defined varbits with quest varbits
                                const mergedVarbits = {
                                    ...(intf.varbits ?? {}),
                                    ...questVarbits,
                                };
                                const mergedVarps = {
                                    ...(intf.varps ?? {}),
                                    ...questVarps,
                                };
                                // XP counter visibility must be applied after mount on login.
                                // If sent early as a standalone set_hidden, the target widget may not exist yet.
                                const hideXpCounterOnOpen = intf.groupId === 122 && !xpDropsEnabled;
                                this.queueWidgetEvent(p.id, {
                                    action: "open_sub",
                                    targetUid: intf.targetUid,
                                    groupId: intf.groupId,
                                    type: intf.type,
                                    ...(Array.isArray(intf.postScripts) &&
                                    intf.postScripts.length > 0
                                        ? { postScripts: intf.postScripts }
                                        : {}),
                                    ...(hideXpCounterOnOpen
                                        ? { hiddenUids: [intf.targetUid] }
                                        : {}),
                                    ...(Object.keys(mergedVarps).length > 0
                                        ? { varps: mergedVarps }
                                        : {}),
                                    ...(Object.keys(mergedVarbits).length > 0
                                        ? { varbits: mergedVarbits }
                                        : {}),
                                });

                                // Side journal (quest tab) content is mounted onto 629:43.
                                if (intf.groupId === SIDE_JOURNAL_GROUP_ID) {
                                    this.queueSideJournalGamemodeUi(p);
                                }
                            }
                            if (tutorialMode && !preStartMode) {
                                // Run once after all IF_OPENSUB mounts so toplevel state is ready.
                                this.queueActivateQuestSideTab(p.id);
                            }
                            // Gamemode tutorial overlay (shown while tutorial is active).
                            //
                            // Project behavior: do not show the overlay over PlayerDesign (accountStage=0).
                            if (p.accountStage >= 1 && this.gamemode.isTutorialActive(p)) {
                                this.gamemodeUi?.queueTutorialOverlay(p);
                            }

                            // ============================================================
                            // OSRS Parity: IF_SETEVENTS for inventory widget slots
                            // ============================================================
                            // The server must send IF_SETEVENTS to enable item operations.
                            // Without this, clicking "Drop" shows the menu but never
                            // transmits the packet to the server.
                            //
                            // Flags breakdown (1181694 = 0x120BFE):
                            //   Bits 1-7:  1111111 - transmit ops 1-7 (Use, Wield, Drop, etc.)
                            //   Bit 9:     1       - transmit op 9
                            //   Bit 11:    1       - can target ground items
                            //   Bits 17-19: 001    - drag depth 1 (for inventory swapping)
                            //   Bit 20:    1       - drop target (can receive dragged items)
                            //
                            // Reference: RSMod Bank.kt line 136, player.setInterfaceEvents
                            const INVENTORY_GROUP_ID = 149;
                            const INVENTORY_CONTAINER_COMPONENT = 0;
                            const INVENTORY_SLOT_COUNT = 28;
                            const INVENTORY_FLAGS = 1181694; // Enables ops 1-7, 9 + drag/drop

                            this.queueWidgetEvent(p.id, {
                                action: "set_flags_range",
                                uid: (INVENTORY_GROUP_ID << 16) | INVENTORY_CONTAINER_COMPONENT,
                                fromSlot: 0,
                                toSlot: INVENTORY_SLOT_COUNT - 1,
                                flags: INVENTORY_FLAGS,
                            });
                            // ============================================================
                            // OSRS Parity: IF_SETEVENTS for prayer filter dynamic rows
                            // ============================================================
                            // Prayer filters menu rows are dynamic children of 541:42 created via CC_CREATE.
                            // Rows use OP1 ("Change"), so send transmit-op1 for slots 0..4.
                            const PRAYER_GROUP_ID = 541;
                            const PRAYER_FILTER_COMPONENT = 42;
                            const PRAYER_FILTER_SLOT_START = 0;
                            const PRAYER_FILTER_SLOT_END = 4;
                            const PRAYER_FILTER_FLAGS = 1 << 1; // transmit op1

                            this.queueWidgetEvent(p.id, {
                                action: "set_flags_range",
                                uid: (PRAYER_GROUP_ID << 16) | PRAYER_FILTER_COMPONENT,
                                fromSlot: PRAYER_FILTER_SLOT_START,
                                toSlot: PRAYER_FILTER_SLOT_END,
                                flags: PRAYER_FILTER_FLAGS,
                            });
                            // ============================================================
                            // OSRS Parity: IF_SETEVENTS for equipment widget slots
                            // ============================================================
                            // Equipment slots (387:15-25) need transmit flags for Remove action.
                            // These are STATIC widgets (loaded from cache) with childIndex=-1.
                            // OSRS client: class405.getWidgetFlags uses (childIndex + (id << 32)) as key.
                            // Static widgets have childIndex=-1 (from Widget.java constructor).
                            // To set flags on a static widget, use fromSlot=-1, toSlot=-1.
                            //
                            // Flags: 62 = 0b111110 (transmit ops 1-5 for Remove, etc.)
                            const EQUIPMENT_GROUP_ID = 387;
                            const EQUIPMENT_SLOT_START = 15;
                            const EQUIPMENT_SLOT_END = 25;
                            const EQUIPMENT_FLAGS = 62; // Ops 1-5 transmit

                            for (
                                let comp = EQUIPMENT_SLOT_START;
                                comp <= EQUIPMENT_SLOT_END;
                                comp++
                            ) {
                                this.queueWidgetEvent(p.id, {
                                    action: "set_flags_range",
                                    uid: (EQUIPMENT_GROUP_ID << 16) | comp,
                                    fromSlot: -1,
                                    toSlot: -1, // Static widget (childIndex=-1) - NOT dynamic children
                                    flags: EQUIPMENT_FLAGS,
                                });
                            }

                            // ============================================================
                            // OSRS Parity: IF_SETEVENTS for quest list dynamic children
                            // ============================================================
                            // Quest list (399:7) dynamic children need transmit flags for
                            // ops 1-6 (View info, Read journal, Show on map, Wiki guide,
                            // Wiki quick guide, Pin journal).
                            // Without this, clicking a quest entry doesn't send a packet.
                            const QUEST_LIST_GROUP_ID = 399;
                            const QUEST_LIST_COMPONENT = 7;
                            const QUEST_LIST_MAX_SLOT = 199; // generous upper bound for all quests
                            const QUEST_LIST_FLAGS = 0x7e; // ops 1-6 transmit (bits 1-6)

                            this.queueWidgetEvent(p.id, {
                                action: "set_flags_range",
                                uid: (QUEST_LIST_GROUP_ID << 16) | QUEST_LIST_COMPONENT,
                                fromSlot: 0,
                                toSlot: QUEST_LIST_MAX_SLOT,
                                flags: QUEST_LIST_FLAGS,
                            });
                        }

                        // Onboarding: open PlayerDesign (679) in mainmodal so the player can choose
                        // gender/body kits. accountStage=0 means the design is required.
                        if (p.accountStage === 0) {
                            try {
                                const { getMainmodalUid } = require("../widgets/WidgetManager");
                                const targetUid = getMainmodalUid(p.displayMode);
                                p.widgets.open(679, { targetUid, type: 0 });
                            } catch {}
                        }

                        // Gamemode tutorial spawn: while tutorial is active, force the player
                        // into the tutorial area regardless of saved location.
                        try {
                            if (p.accountStage >= 1 && this.gamemode.isTutorialActive(p)) {
                                const spawn = this.gamemode.getSpawnLocation(p);
                                p.teleport(spawn.x, spawn.y, spawn.level);
                            }
                        } catch {}

                        // Let the gamemode restore any feature-specific state (sailing, etc.)
                        this.gamemode.onPlayerRestore?.(p);

                        const startTileX = p.tileX;
                        const startTileY = p.tileY;
                        const startLevel = p.level;
                        logger.info(
                            `Handshake ok id=${p.id} spawn=(${startTileX},${startTileY},L${startLevel})`,
                        );
                        // Now send initial spawn position (after handshake)
                        // OSRS parity: Always send the server-authoritative appearance state (post-persistence,
                        // post refreshAppearanceKits), not the raw handshake payload.
                        const appearanceSnapshot = p.appearance;
                        this.queueAppearanceSnapshot(p, {
                            x: (startTileX << 7) + 64,
                            y: (startTileY << 7) + 64,
                            level: startLevel,
                            rot: p.rot,
                            orientation: p.getOrientation() & 2047,
                            running: false,
                            appearance: appearanceSnapshot,
                            name,
                            moved: true,
                            turned: false,
                            snap: true,
                        });
                        p.markSent();

                        // Send welcome message
                        this.queueChatMessage({
                            messageType: "server",
                            text: "Welcome to Old School Runescape!",
                            targetPlayerIds: [p.id],
                        });

                        if (this.npcManager && p) {
                            const player = p;
                            try {
                                const nearby = this.npcManager.getNearby(
                                    startTileX,
                                    startTileY,
                                    startLevel,
                                    NPC_STREAM_RADIUS_TILES,
                                );
                                player.visibleNpcIds.clear();
                                if (DEBUG_NPC_STREAM) {
                                    logger.debug(
                                        `[npcs] initial snapshot -> player=${player.id} count=${nearby.length}`,
                                    );
                                }
                                for (const npc of nearby) {
                                    const snap = this.npcSyncManager.serializeNpcSnapshot(npc);
                                    player.visibleNpcIds.add(snap.id);
                                    this.npcSyncManager.queueNpcSnapshot(player.id, snap);
                                }
                            } catch (err) {
                                logger.warn("[NpcManager] snapshot send failed", err);
                            }
                        }

                        this.maybeReplayDynamicLocState(ws, p, true);
                    }
                } catch {}
            } else if (parsed.type === "logout") {
                // Handle logout request - check if player can logout first
                try {
                    const player = this.players?.get(ws);
                    if (player) {
                        // Check if player can logout (not in combat, etc.)
                        if (!player.canLogout()) {
                            const activeCombatTicks = player.timers.getOrDefault(
                                ACTIVE_COMBAT_TIMER,
                                0,
                            );
                            const logoutReason =
                                LockState.NONE !== player.lock ? "locked" : "combat";
                            const logoutMessage =
                                logoutReason === "locked"
                                    ? "You can't log out right now."
                                    : "You can't log out until 10 seconds after the end of combat.";
                            // Send denial - player cannot logout
                            logger.info(
                                `[logout] Player ${player.id} cannot logout reason=${logoutReason} lock=${player.lock} activeCombatTicks=${activeCombatTicks}`,
                            );
                            try {
                                const response = encodeMessage({
                                    type: "logout_response",
                                    payload: {
                                        success: false,
                                        reason: logoutMessage,
                                    },
                                });
                                ws.send(response);
                            } catch {}
                            return;
                        }

                        this.completeLogout(ws, player);
                    }
                    if (!player) this.completeLogout(ws);
                } catch (err) {
                    logger.warn("[logout] Error during logout:", err);
                    try {
                        ws.close(1000, "logout");
                    } catch {}
                }
            } else if (parsed.type === "if_close") {
                const player = this.players?.get(ws);
                if (player) {
                    // OSRS parity: IF_CLOSE should close active interruptible interfaces
                    // and run modal onClose hooks (bank/shop side panel restore, etc.).
                    this.closeInterruptibleInterfaces(player);
                }
            } else if (parsed.type === "widget") {
                try {
                    const p = this.players?.get(ws);
                    if (!p) return;
                    const { groupId, action, modal } = parsed.payload;
                    if (action === "open") {
                        logger.info(`[widget-open] player=${p.id} group=${groupId} modal=${modal}`);
                        this.noteWidgetEventForLedger(p.id, {
                            action: "open",
                            groupId: groupId,
                            modal,
                        });
                        p.widgets.open(groupId, { modal });
                        if (groupId === SIDE_JOURNAL_GROUP_ID) {
                            const sideJournalState = this.normalizeSideJournalState(p);
                            // Ensure icon/optext/tab var state is corrected before side-journal scripts re-run.
                            this.withDirectSendBypass("varp", () =>
                                this.sendWithGuard(
                                    ws,
                                    encodeMessage({
                                        type: "varp",
                                        payload: {
                                            varpId: VARP_SIDE_JOURNAL_STATE,
                                            value: sideJournalState.stateVarp,
                                        },
                                    }),
                                    "varp",
                                ),
                            );
                            this.withDirectSendBypass("varbit", () =>
                                this.sendWithGuard(
                                    ws,
                                    encodeMessage({
                                        type: "varbit",
                                        payload: {
                                            varbitId: VARBIT_SIDE_JOURNAL_TAB,
                                            value: sideJournalState.tab,
                                        },
                                    }),
                                    "varbit",
                                ),
                            );
                            this.queueSideJournalGamemodeUi(p);
                        }
                        if (groupId === MUSIC_GROUP_ID) {
                            this.soundManager.syncMusicInterfaceForPlayer(p);
                        }
                    } else if (action === "close") {
                        const closedGroupId = groupId;
                        logger.info(`[widget-close] player=${p.id} group=${closedGroupId}`);
                        this.noteWidgetEventForLedger(p.id, {
                            action: "close",
                            groupId: closedGroupId,
                        });
                        // Ensure cleanup happens even if server thought it was already closed
                        this.cs2ModalManager.handleWidgetCloseState(p, closedGroupId);
                        this.widgetDialogHandler.handleWidgetCloseState(p, closedGroupId);
                        let closedEntries: WidgetEntry[] = [];
                        let handledByInterfaceService = false;
                        if (this.interfaceService?.isChatboxModalOpen(p, closedGroupId)) {
                            handledByInterfaceService = true;
                            this.interfaceService.closeChatboxModal(p);
                        } else if (this.interfaceService?.isModalOpen(p, closedGroupId)) {
                            handledByInterfaceService = true;
                            this.interfaceService.closeModal(p);
                        } else if (
                            this.interfaceService?.getCurrentSidemodal(p) === closedGroupId
                        ) {
                            handledByInterfaceService = true;
                            this.interfaceService.closeSidemodal(p);
                        } else {
                            closedEntries = p.widgets.close(closedGroupId);
                        }
                        if (this.interfaceService && closedEntries.length > 0) {
                            this.interfaceService.triggerCloseHooksForEntries(p, closedEntries);
                        } else if (this.interfaceService && !handledByInterfaceService) {
                            this.interfaceService.triggerCloseHooksForExternalClose(
                                p,
                                closedGroupId,
                            );
                        }

                        this.gamemodeUi?.handleWidgetClose(p, closedGroupId);
                    }
                } catch {}
            } else if (parsed.type === "varp_transmit") {
                // Generic varp transmit handler - stores varp and handles special cases
                try {
                    const p = this.players?.get(ws);
                    if (p) {
                        const payload = (parsed as any).payload;
                        const varpId = payload?.varpId as number;
                        const value = payload?.value as number;
                        const previousVarpValue = p.getVarpValue(varpId);

                        // Store varp value on player (persisted)
                        p.setVarpValue(varpId, value);
                        const nextVarpValue = p.getVarpValue(varpId);

                        // Handle special varp logic
                        // Side journal (quest tab) selection: varbit 8168 is packed into varp 1141 (bits 4..6).
                        // OSRS parity: server sends IF_OPENSUB to swap the mounted content interface under 629:43.
                        if (varpId === VARP_SIDE_JOURNAL_STATE) {
                            const { tab: sideJournalTab, stateVarp: normalizedSideJournalVarp } =
                                this.normalizeSideJournalState(p, value);
                            if (normalizedSideJournalVarp !== value) {
                                this.withDirectSendBypass("varp", () =>
                                    this.sendWithGuard(
                                        ws,
                                        encodeMessage({
                                            type: "varp",
                                            payload: {
                                                varpId: VARP_SIDE_JOURNAL_STATE,
                                                value: normalizedSideJournalVarp,
                                            },
                                        }),
                                        "varp",
                                    ),
                                );
                            }
                            const previousSideJournalTab =
                                decodeSideJournalTabFromStateVarp(previousVarpValue);
                            const sideJournalSelectionChanged =
                                previousSideJournalTab !== sideJournalTab;
                            if (sideJournalSelectionChanged) {
                                // Mount the selected content interface into side_journal container (629:43).
                                // Tabs: 0=Summary, 1=Quests, 2=Diary, 3=Adventure Log, 4=Leagues
                                this.queueSideJournalGamemodeUi(p);
                            }

                            // Delegate gamemode-specific varp handling (task completion, tutorial progression)
                            this.gamemode.onVarpTransmit?.(p, varpId, value, previousVarpValue);
                            if (sideJournalSelectionChanged) {
                                this.gamemodeUi?.applySideJournalUi(p);
                            }
                        }
                        if (varpId === VARP_MUSICPLAY) {
                            this.soundManager.handleMusicModeChange(
                                p,
                                previousVarpValue,
                                nextVarpValue,
                            );
                        }
                        if (varpId === VARP_MUSIC_VOLUME) {
                            this.soundManager.handleMusicVolumeChange(
                                p,
                                previousVarpValue,
                                nextVarpValue,
                            );
                        }
                        if (varpId === VARP_OPTION_RUN) {
                            const on = value !== 0;
                            (p as any).setRunToggle?.(on);
                            this.sendRunEnergyState(ws, p);
                        } else if (varpId === VARP_SPECIAL_ATTACK) {
                            // Special attack toggle
                            const desired = value !== 0;
                            const normalizedVarpValue = desired ? 1 : 0;
                            const equip = this.ensureEquipArray(p);
                            const weaponId = equip[EquipmentSlot.WEAPON];
                            const weaponCost =
                                weaponId > 0
                                    ? this.getWeaponSpecialCostPercent(weaponId)
                                    : undefined;
                            const rockKnockerSeqId = desired
                                ? getRockKnockerSpecialSequence(weaponId)
                                : undefined;
                            const fishstabberSeqId = desired
                                ? getFishstabberSpecialSequence(weaponId)
                                : undefined;
                            const lumberUpSeqId = desired
                                ? getLumberUpSpecialSequence(weaponId)
                                : undefined;
                            if (
                                desired &&
                                (rockKnockerSeqId !== undefined ||
                                    fishstabberSeqId !== undefined ||
                                    lumberUpSeqId !== undefined)
                            ) {
                                const seqId = (rockKnockerSeqId ??
                                    fishstabberSeqId ??
                                    lumberUpSeqId) as number;
                                const currentTick = this.options.ticker.currentTick();
                                if (wasInstantUtilitySpecialHandledAtTick(p as any, currentTick)) {
                                    p.setVarpValue(VARP_SPECIAL_ATTACK, 0);
                                    p.setSpecialActivated(false);
                                    this.queueCombatState(p);
                                    this.withDirectSendBypass("varp", () =>
                                        this.sendWithGuard(
                                            ws,
                                            encodeMessage({
                                                type: "varp",
                                                payload: { varpId: VARP_SPECIAL_ATTACK, value: 0 },
                                            }),
                                            "varp",
                                        ),
                                    );
                                } else if (weaponCost === undefined) {
                                    markInstantUtilitySpecialHandledAtTick(p as any, currentTick);
                                    p.setVarpValue(VARP_SPECIAL_ATTACK, 0);
                                    p.setSpecialActivated(false);
                                    this.queueCombatState(p);
                                    this.withDirectSendBypass("varp", () =>
                                        this.sendWithGuard(
                                            ws,
                                            encodeMessage({
                                                type: "varp",
                                                payload: { varpId: VARP_SPECIAL_ATTACK, value: 0 },
                                            }),
                                            "varp",
                                        ),
                                    );
                                } else if (
                                    p.getSpecialEnergyUnits() < weaponCost ||
                                    !p.consumeSpecialEnergy(weaponCost)
                                ) {
                                    markInstantUtilitySpecialHandledAtTick(p as any, currentTick);
                                    p.setVarpValue(VARP_SPECIAL_ATTACK, 0);
                                    p.setSpecialActivated(false);
                                    this.queueCombatState(p);
                                    this.queueChatMessage({
                                        messageType: "game",
                                        text: "You do not have enough special attack energy.",
                                        targetPlayerIds: [p.id],
                                    });
                                    this.withDirectSendBypass("varp", () =>
                                        this.sendWithGuard(
                                            ws,
                                            encodeMessage({
                                                type: "varp",
                                                payload: { varpId: VARP_SPECIAL_ATTACK, value: 0 },
                                            }),
                                            "varp",
                                        ),
                                    );
                                } else {
                                    markInstantUtilitySpecialHandledAtTick(p as any, currentTick);
                                    if (rockKnockerSeqId !== undefined) {
                                        applyRockKnockerMiningBoost(p);
                                    } else if (fishstabberSeqId !== undefined) {
                                        applyFishstabberFishingBoost(p);
                                    } else {
                                        applyLumberUpWoodcuttingBoost(p);
                                    }
                                    p.setSpecialActivated(false);
                                    p.setVarpValue(VARP_SPECIAL_ATTACK, 0);
                                    p.queueOneShotSeq(seqId, 0);
                                    if (rockKnockerSeqId !== undefined) {
                                        this.sendSound(p, ROCK_KNOCKER_SOUND_ID);
                                    }
                                    this.queueCombatState(p);
                                    this.withDirectSendBypass("varp", () =>
                                        this.sendWithGuard(
                                            ws,
                                            encodeMessage({
                                                type: "varp",
                                                payload: { varpId: VARP_SPECIAL_ATTACK, value: 0 },
                                            }),
                                            "varp",
                                        ),
                                    );
                                    logger.info(
                                        `[combat] instant utility special activated: ` +
                                            `player=${p.id} weapon=${weaponId} kind=${
                                                rockKnockerSeqId !== undefined
                                                    ? "rock_knocker"
                                                    : fishstabberSeqId !== undefined
                                                    ? "fishstabber"
                                                    : "lumber_up"
                                            } seq=${seqId}`,
                                    );
                                }
                            } else if (desired && weaponCost === undefined) {
                                // Weapon has no special attack - revert.
                                p.setVarpValue(VARP_SPECIAL_ATTACK, 0);
                                p.setSpecialActivated(false);
                                this.queueCombatState(p);
                                this.withDirectSendBypass("varp", () =>
                                    this.sendWithGuard(
                                        ws,
                                        encodeMessage({
                                            type: "varp",
                                            payload: { varpId: VARP_SPECIAL_ATTACK, value: 0 },
                                        }),
                                        "varp",
                                    ),
                                );
                            } else if (
                                desired &&
                                typeof weaponCost === "number" &&
                                p.getSpecialEnergyUnits() < weaponCost
                            ) {
                                // Not enough energy - revert client varp + ensure server state stays off.
                                p.setVarpValue(VARP_SPECIAL_ATTACK, 0);
                                p.setSpecialActivated(false);
                                this.queueCombatState(p);
                                this.queueChatMessage({
                                    messageType: "game",
                                    text: "You do not have enough special attack energy.",
                                    targetPlayerIds: [p.id],
                                });
                                this.withDirectSendBypass("varp", () =>
                                    this.sendWithGuard(
                                        ws,
                                        encodeMessage({
                                            type: "varp",
                                            payload: { varpId: VARP_SPECIAL_ATTACK, value: 0 },
                                        }),
                                        "varp",
                                    ),
                                );
                            } else {
                                p.setSpecialActivated(desired);
                                p.setVarpValue(VARP_SPECIAL_ATTACK, normalizedVarpValue);
                                if (normalizedVarpValue !== value) {
                                    this.withDirectSendBypass("varp", () =>
                                        this.sendWithGuard(
                                            ws,
                                            encodeMessage({
                                                type: "varp",
                                                payload: {
                                                    varpId: VARP_SPECIAL_ATTACK,
                                                    value: normalizedVarpValue,
                                                },
                                            }),
                                            "varp",
                                        ),
                                    );
                                }
                                this.queueCombatState(p);
                            }
                        } else if (varpId === VARP_ATTACK_STYLE) {
                            // Attack style change (0-3)
                            const requested = Math.max(0, Math.min(3, value));
                            p.setCombatStyle(requested, p.combatWeaponCategory);
                            const normalized = p.combatStyleSlot;
                            p.setVarpValue(VARP_ATTACK_STYLE, normalized);
                            // Send varp back to client to confirm the style change
                            // The CS2 combat interface reads this varp to highlight the active button
                            this.withDirectSendBypass("varp", () =>
                                this.sendWithGuard(
                                    ws,
                                    encodeMessage({
                                        type: "varp",
                                        payload: {
                                            varpId: VARP_ATTACK_STYLE,
                                            value: normalized,
                                        },
                                    }),
                                    "varp",
                                ),
                            );
                            this.queueCombatState(p);
                            logger.info(
                                `[combat] attack style change: player=${p.id} slot=${normalized}`,
                            );
                        } else if (varpId === VARP_AUTO_RETALIATE) {
                            // Auto-retaliate toggle
                            // OSRS parity: varp 172 is "option_nodef" where 0 = ON, 1 = OFF
                            // The CS2 checks %option_nodef=0 to display "(On)"
                            const on = value === 0;
                            p.setAutoRetaliate(on);
                            const normalized = on ? 0 : 1;
                            if (normalized !== value) {
                                p.setVarpValue(VARP_AUTO_RETALIATE, normalized);
                                this.withDirectSendBypass("varp", () =>
                                    this.sendWithGuard(
                                        ws,
                                        encodeMessage({
                                            type: "varp",
                                            payload: {
                                                varpId: VARP_AUTO_RETALIATE,
                                                value: normalized,
                                            },
                                        }),
                                        "varp",
                                    ),
                                );
                            }
                            this.queueCombatState(p);
                        }
                    }
                    // NOTE: spell_cast_*, debug, chat handlers moved to MessageHandlers.ts
                } catch {}
            } else {
                this.processBinaryMessage(ws, parsed);
            }
        });

        ws.on("close", () => {
            try {
                this.pendingWalkCommands.delete(ws);
                const player = this.players?.get(ws);
                const id = player?.id;
                if (player) {
                    if (id !== undefined) {
                        this.groundItemHandler?.clearPlayerState(id);
                        this.playerDynamicLocSceneKeys.delete(id);
                    }
                    // Clean up all interruptible interfaces (level-up popups, dialogs, modals)
                    this.dismissLevelUpPopupQueue(player.id);
                    this.clearUiTrackingForPlayer(player.id);
                    this.tradeManager?.handlePlayerLogout(
                        player,
                        "The other player has declined the trade.",
                    );
                    if (id !== undefined) {
                        this.widgetDialogHandler.cleanupPlayerDialogState(id);
                    }
                    this.scriptRuntime.getServices().closeShop?.(player);
                    // Clean up InterfaceService state (handles any open modals)
                    this.interfaceService?.onPlayerDisconnect(player);
                    // Close any open widgets before cleanup
                    try {
                        const closedWidgets = player.widgets.closeAll({ silent: true });
                        if (closedWidgets.length > 0) {
                            logger.info(
                                `[disconnect] Closed ${
                                    closedWidgets.length
                                } widgets for player ${id}: ${closedWidgets
                                    .map((entry) => entry.groupId)
                                    .join(", ")}`,
                            );
                        }
                    } catch (err) {
                        logger.warn(`[disconnect] Failed to close widgets for player ${id}:`, err);
                    }
                    player.widgets.setDispatcher(undefined);

                    // Dispose instance NPCs before saving
                    this.sailingInstanceManager?.disposeInstance(player);
                    this.worldEntityInfoEncoder.removePlayer(player.id);

                    // Get save key for persistence and orphan tracking
                    const saveKey =
                        player.__saveKey ?? this.getPlayerSaveKey(player.name, player.id);

                    // Check if player should be orphaned (in combat) instead of removed
                    const currentTick = this.options.ticker.currentTick();
                    const wasOrphaned = this.players?.orphanPlayer(ws, saveKey, currentTick);

                    if (wasOrphaned) {
                        // Player is in combat - keep them in world, don't save yet
                        // They'll be saved when orphan expires
                        logger.info(
                            `[disconnect] Player ${id} orphaned (in combat) - staying in world`,
                        );
                        // Don't unregister from action scheduler - they're still in game
                    } else {
                        // Safe to logout - save and remove normally
                        try {
                            this.playerPersistence.saveSnapshot(saveKey, player);
                        } catch (err) {
                            logger.warn("[persist] failed to save player state", err);
                        }
                        this.followerCombatManager?.resetPlayer(player.id);
                        this.followerManager?.despawnFollowerForPlayer(player.id, false);
                        this.players?.remove(ws);
                        if (id != null) this.actionScheduler.unregisterPlayer(id);
                        if (id != null) logger.info(`Client disconnected id=${id}`);
                        else logger.info("Client disconnected");
                    }
                } else {
                    // No player found - just clean up
                    this.players?.remove(ws);
                    logger.info("Client disconnected (no player)");
                }
            } catch {
                logger.info("Client disconnected");
            }
            this.playerSyncSessions.delete(ws);
            this.npcSyncSessions.delete(ws);
        });
        ws.on("error", (err) => logger.warn("Client error:", err));
    }

    private handleInventoryUseOnMessage(
        ws: WebSocket,
        payload:
            | {
                  slot: number;
                  itemId: number;
                  modifierFlags?: number;
                  target:
                      | {
                            kind: "npc";
                            id?: number;
                            tile?: { x: number; y: number };
                            plane?: number;
                        }
                      | { kind: "loc"; id: number; tile?: { x: number; y: number }; plane?: number }
                      | { kind: "obj"; id: number; tile?: { x: number; y: number }; plane?: number }
                      | {
                            kind: "player";
                            id?: number;
                            tile?: { x: number; y: number };
                            plane?: number;
                        }
                      | { kind: "inv"; slot: number; itemId: number };
              }
            | undefined,
    ): void {
        if (!payload) return;
        const p = this.players?.get(ws);
        if (!p) return;
        // Interface closing handled centrally by INTERFACE_CLOSING_ACTIONS check

        try {
            const slotIndex = Math.max(0, Math.min(INVENTORY_SLOT_COUNT - 1, payload.slot));
            const inv = this.getInventory(p);
            const slot = inv[slotIndex];
            if (!slot || slot.itemId <= 0 || slot.itemId !== payload.itemId) {
                // If targeting another inventory slot, mirror client UX with a benign chat message
                const tgt: any = payload.target as any;
                if (tgt && tgt.kind === "inv") {
                    try {
                        this.queueChatMessage({
                            messageType: "game",
                            text: "Nothing interesting happens.",
                            targetPlayerIds: [p.id],
                        });
                    } catch {}
                }
                return;
            }
        } catch {}
        // Schedule server-authoritative walk-to + interaction resolution (Elvarg-style WalkToTask).
        try {
            this.actionScheduler.requestAction(
                p.id,
                {
                    kind: "inventory.use_on",
                    data: {
                        slot: payload.slot,
                        itemId: payload.itemId,
                        modifierFlags: payload.modifierFlags ?? 0,
                        target: payload.target,
                    },
                    groups: ["inventory"],
                    delayTicks: 0,
                },
                this.options.ticker.currentTick(),
            );
        } catch (err) {
            logger.warn("[inventory] failed to enqueue use_on", err);
        }
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

    private takeInventoryItems(
        player: PlayerState,
        requirements: Array<{ itemId: number; quantity: number }>,
    ): { ok: boolean; removed: Map<number, { itemId: number; quantity: number }> } {
        const removed = new Map<number, { itemId: number; quantity: number }>();
        for (const req of requirements) {
            const needed = Math.max(1, req.quantity);
            for (let i = 0; i < needed; i++) {
                const slot = this.findInventorySlotWithItem(player, req.itemId);
                if (slot === undefined || !this.consumeItem(player, slot)) {
                    this.restoreInventoryRemovals(player, removed);
                    return { ok: false, removed: new Map() };
                }
                const existing = removed.get(slot);
                if (existing) existing.quantity += 1;
                else removed.set(slot, { itemId: req.itemId, quantity: 1 });
            }
        }
        return { ok: true, removed };
    }

    private restoreInventoryRemovals(
        player: PlayerState,
        removed: Map<number, { itemId: number; quantity: number }>,
    ): void {
        if (!removed.size) return;
        const inv = this.getInventory(player);
        for (const [slot, info] of removed.entries()) {
            if (!(slot >= 0 && slot < inv.length)) {
                this.addItemToInventory(player, info.itemId, info.quantity);
                continue;
            }
            const entry = inv[slot];
            if (!entry || entry.itemId <= 0 || entry.quantity <= 0) {
                this.setInventorySlot(player, slot, info.itemId, info.quantity);
            } else if (entry.itemId === info.itemId) {
                this.setInventorySlot(player, slot, info.itemId, entry.quantity + info.quantity);
            } else {
                this.addItemToInventory(player, info.itemId, info.quantity);
            }
        }
    }

    private hasInventorySlot(player: PlayerState): boolean {
        const inv = this.getInventory(player);
        return inv.some((entry) => entry.itemId <= 0 || entry.quantity <= 0);
    }

    private canStoreItem(player: PlayerState, itemId: number): boolean {
        const def = getItemDefinition(itemId);
        const stackable = !!def?.stackable;
        if (!stackable) {
            return this.hasInventorySlot(player);
        }
        const slot = this.findInventorySlotWithItem(player, itemId);
        if (slot !== undefined) {
            return true;
        }
        return this.hasInventorySlot(player);
    }

    private isAdjacentToTile(player: PlayerState, tile: { x: number; y: number }, radius = 1): boolean {
        const dx = Math.abs(player.tileX - tile.x);
        const dy = Math.abs(player.tileY - tile.y);
        return dx <= radius && dy <= radius;
    }

    private isAdjacentToLoc(
        player: PlayerState,
        locId: number,
        tile: { x: number; y: number },
        level: number,
    ): boolean {
        if (!(locId > 0)) {
            return this.isAdjacentToTile(player, tile);
        }
        const rect = this.getLocAdjacencyRect(locId, tile, level);
        if (!rect) {
            return this.isAdjacentToTile(player, tile);
        }
        const minX = rect.tile.x;
        const minY = rect.tile.y;
        const maxX = minX + Math.max(1, rect.sizeX) - 1;
        const maxY = minY + Math.max(1, rect.sizeY) - 1;
        const px = player.tileX;
        const py = player.tileY;
        const clampedX = Math.max(minX, Math.min(px, maxX));
        const clampedY = Math.max(minY, Math.min(py, maxY));
        return Math.abs(px - clampedX) <= 1 && Math.abs(py - clampedY) <= 1;
    }

    private getLocAdjacencyRect(
        locId: number,
        tile: { x: number; y: number },
        level: number,
    ): { tile: { x: number; y: number }; sizeX: number; sizeY: number } | undefined {
        const size = this.getLocSize(locId);
        if (!size) return undefined;
        const rect = this.deriveLocCollisionRectForTile(tile, size.sizeX, size.sizeY, level);
        if (rect) return rect;
        return {
            tile: { x: tile.x, y: tile.y },
            sizeX: Math.max(1, size.sizeX),
            sizeY: Math.max(1, size.sizeY),
        };
    }

    private getLocSize(locId: number): { sizeX: number; sizeY: number } | undefined {
        const loader = this.locTypeLoader;
        if (!loader?.load) return undefined;
        try {
            const loc = loader.load(locId);
            if (!loc) return undefined;
            const sizeX = Math.max(1, loc.sizeX);
            const sizeY = Math.max(1, loc.sizeY);
            return { sizeX, sizeY };
        } catch {
            return undefined;
        }
    }

    private deriveLocCollisionRectForTile(
        tile: { x: number; y: number },
        sizeX: number,
        sizeY: number,
        level: number,
    ): { tile: { x: number; y: number }; sizeX: number; sizeY: number } | undefined {
        const pathService = this.options.pathService;
        if (!pathService?.getCollisionFlagAt) {
            return undefined;
        }
        const mask = CollisionFlag.OBJECT | CollisionFlag.OBJECT_ROUTE_BLOCKER;
        let minX = Number.POSITIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        let found = false;
        for (let dx = 0; dx < Math.max(1, sizeX); dx++) {
            for (let dy = 0; dy < Math.max(1, sizeY); dy++) {
                const wx = tile.x + dx;
                const wy = tile.y + dy;
                const flag = pathService.getCollisionFlagAt(wx, wy, level);
                if (flag === undefined) continue;
                if ((flag & mask) === 0) continue;
                found = true;
                if (wx < minX) minX = wx;
                if (wy < minY) minY = wy;
                if (wx > maxX) maxX = wx;
                if (wy > maxY) maxY = wy;
            }
        }
        if (!found) {
            return undefined;
        }
        return {
            tile: { x: minX, y: minY },
            sizeX: Math.max(1, maxX - minX + 1),
            sizeY: Math.max(1, maxY - minY + 1),
        };
    }

    private faceGatheringTarget(player: PlayerState, tile: { x: number; y: number }): void {
        const targetX = tile.x * TILE_UNIT + TILE_UNIT / 2;
        const targetY = tile.y * TILE_UNIT + TILE_UNIT / 2;
        try {
            player.setForcedOrientation(faceAngleRs(player.x, player.y, targetX, targetY));
        } catch {}
    }

    private isFiremakingTileBlocked(tile: { x: number; y: number }, level: number): boolean {
        const pathService = this.options.pathService;
        if (!pathService) return false;
        const flag = pathService.getCollisionFlagAt(tile.x, tile.y, level);
        if (flag === undefined || flag < 0) return false;
        const blockingMask =
            CollisionFlag.OBJECT | CollisionFlag.FLOOR_BLOCKED | CollisionFlag.OBJECT_ROUTE_BLOCKER;
        return (flag & blockingMask) !== 0;
    }

    private isAdjacentToNpc(player: PlayerState, npc: NpcState): boolean {
        const size = Math.max(1, npc.size);
        const minX = npc.tileX;
        const minY = npc.tileY;
        const maxX = minX + size - 1;
        const maxY = minY + size - 1;
        const px = player.tileX;
        const py = player.tileY;
        const clampedX = Math.max(minX, Math.min(px, maxX));
        const clampedY = Math.max(minY, Math.min(py, maxY));
        const distance = Math.max(Math.abs(px - clampedX), Math.abs(py - clampedY));
        return distance === 1;
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
            this.sendWithGuard(sock, message, context);
        });
    }

    private pickNpcFaceTile(player: PlayerState, npc: NpcState): { x: number; y: number } {
        const size = Math.max(1, npc.size);
        let bestX = npc.tileX;
        let bestY = npc.tileY;
        let bestDist = Number.POSITIVE_INFINITY;
        for (let dx = 0; dx < size; dx++) {
            for (let dy = 0; dy < size; dy++) {
                const tx = npc.tileX + dx;
                const ty = npc.tileY + dy;
                const dist =
                    (tx - player.tileX) * (tx - player.tileX) +
                    (ty - player.tileY) * (ty - player.tileY);
                if (dist < bestDist) {
                    bestDist = dist;
                    bestX = tx;
                    bestY = ty;
                }
            }
        }
        return { x: bestX, y: bestY };
    }

    private pickSpellCastSequence(
        player: PlayerState,
        spellId: number,
        isAutocast: boolean,
    ): number {
        const normalizedSpellId = spellId;
        const category = player.combatWeaponCategory ?? 0;
        const hasMagicWeapon = MAGIC_WEAPON_CATEGORY_IDS.has(category);

        if (hasMagicWeapon) {
            const mapped = SPELL_CAST_SEQUENCE_OVERRIDES[normalizedSpellId];
            if (mapped !== undefined && mapped >= 0) {
                return mapped;
            }
            return MAGIC_CAST_STAFF_SEQ;
        }

        // Preserve existing fallback behavior for impossible autocast states.
        if (isAutocast) {
            return this.pickAttackSequence(player);
        }
        return MAGIC_CAST_SEQ;
    }

    private pickAttackSequence(player: PlayerState): number {
        try {
            // Check if player is casting a spell - use appropriate magic casting animation
            // OSRS parity: Only use spell animation if autocast is enabled AND player has magic weapon
            const spellId = player.combatSpellId;
            const autocastEnabled = !!player.autocastEnabled;
            if (spellId > 0 && autocastEnabled) {
                // Use weapon category to determine if player has a magic weapon equipped
                // Magic weapon categories (18, 24, 29, 31) use staff-style casting
                const category = player.combatWeaponCategory ?? 0;
                const hasMagicWeapon = MAGIC_WEAPON_CATEGORY_IDS.has(category);

                // OSRS parity: Autocast only works with a magic weapon equipped.
                // Without a magic weapon, fall through to melee/ranged animation logic.
                if (hasMagicWeapon) {
                    const mapped = SPELL_CAST_SEQUENCE_OVERRIDES[spellId];
                    if (mapped) {
                        logger.info(
                            `[combat] Using per-spell cast sequence (${mapped}) for spell ${spellId}`,
                        );
                        return mapped;
                    }

                    // Default staff magic casting animation
                    return MAGIC_CAST_STAFF_SEQ;
                }
                // No magic weapon - fall through to melee/ranged animation
            }

            const weaponCategory = player.combatWeaponCategory ?? 0;

            const equip = this.ensureEquipArray(player);
            const weaponId = equip[EquipmentSlot.WEAPON];

            if (weaponId > 0) {
                const dataEntry = this.weaponData.get(weaponId);
                if (!dataEntry) {
                    // Only log warning once per weapon to avoid spam
                    if (!this.weaponWarningsLogged.has(weaponId)) {
                        this.weaponWarningsLogged.add(weaponId);
                        logger.warn(
                            `[combat] No weapon data found for weapon ID ${weaponId} (player ${player.id}), falling back to category/style mapping`,
                        );
                    }
                    // Fall through to category/style mapping (if available).
                } else {
                    const styleSlot = player.combatStyleSlot ?? 0;

                    // Check per-style attack sequences first (e.g., godswords have different anims per style)
                    const attackSequences = dataEntry?.attackSequences;
                    if (attackSequences) {
                        const styleAnim = attackSequences[styleSlot as 0 | 1 | 2 | 3];
                        if (styleAnim !== undefined && styleAnim >= 0) {
                            return styleAnim;
                        }
                    }

                    // Fallback to generic attack animation override
                    const overrideAttack = dataEntry?.animOverrides?.attack;
                    if (overrideAttack !== undefined && overrideAttack >= 0) {
                        return overrideAttack;
                    }

                    // Fallback to legacy single attackSequence
                    const attackSequence = dataEntry?.attackSequence;
                    if (attackSequence !== undefined && attackSequence >= 0) {
                        return attackSequence;
                    }
                    if (!this.weaponWarningsLogged.has(weaponId)) {
                        this.weaponWarningsLogged.add(weaponId);
                        logger.warn(
                            `[combat] Weapon ID ${weaponId} has no valid attack sequence, falling back to category/style mapping`,
                        );
                    }
                }
            }

            const styleSlot = player.combatStyleSlot ?? 0;
            const mapped = getMeleeAttackSequenceForCategory(weaponCategory, styleSlot);
            if (mapped !== undefined && mapped > 0) {
                return mapped;
            }
        } catch (err) {
            const equip = player.appearance?.equip;
            const weaponId = Array.isArray(equip) ? equip[EquipmentSlot.WEAPON] : 0;
            if (!this.weaponWarningsLogged.has(weaponId)) {
                this.weaponWarningsLogged.add(weaponId);
                logger.warn(
                    `[combat] pickAttackSequence failed for player ${player.id} with weapon ${weaponId}:`,
                    err,
                );
            }
        }
        // Fallback: unarmed punch animation.
        return DEFAULT_ATTACK_SEQ;
    }

    private pickCombatSound(player: PlayerState, isHit: boolean): number {
        try {
            // OSRS parity: Spell-specific sounds only when autocast is enabled AND magic weapon equipped
            const spellId = player.combatSpellId ?? -1;
            const autocastEnabled = !!player.autocastEnabled;
            const category = player.combatWeaponCategory ?? 0;
            const hasMagicWeapon = MAGIC_WEAPON_CATEGORY_IDS.has(category);
            if (spellId > 0 && autocastEnabled && hasMagicWeapon) {
                const stage: "impact" | "splash" = isHit ? "impact" : "splash";
                const spellSound = this.pickSpellSound(spellId, stage);
                if (spellSound !== undefined) return spellSound;
            }
            // Miss sound is universal for all weapons
            if (!isHit) {
                return getMissSound();
            }
            // Get hit sound based on weapon and combat style
            const equip = this.ensureEquipArray(player);
            const weaponId = equip[EquipmentSlot.WEAPON];
            const styleSlot = player.combatStyleSlot ?? 0;
            if (weaponId > 0) {
                const hitSound = getHitSoundForStyle(weaponId, styleSlot);
                if (hitSound !== undefined) return hitSound;
            } else {
                // OSRS parity: unarmed punch vs kick uses different sounds by style slot.
                return styleSlot === 1 ? UNARMED_KICK_SOUND : UNARMED_PUNCH_SOUND;
            }
        } catch {}
        // Default sounds for unarmed/unknown weapons
        return isHit ? DEFAULT_HIT_SOUND : DEFAULT_MISS_SOUND;
    }

    /**
     * Get the ranged projectile impact sound for the player's equipped weapon.
     * This is played at the target location when a ranged projectile hits.
     * @param player - The player whose weapon to check
     * @returns Impact sound ID or undefined if not a ranged weapon
     */
    private getRangedImpactSound(player: PlayerState): number | undefined {
        try {
            const equip = this.ensureEquipArray(player);
            const weaponId = equip[EquipmentSlot.WEAPON];
            if (weaponId > 0) {
                return getRangedImpactSound(weaponId);
            }
        } catch {}
        return undefined;
    }

    private pickSpellSound(
        spellId: number,
        stage: "cast" | "impact" | "splash",
    ): number | undefined {
        const castMap: Record<number, number> = {
            // Wind family
            3273: 220, // Wind Strike cast
            3281: 218, // Wind Bolt cast
            3294: 216, // Wind Blast cast
            3313: 222, // Wind Wave cast
            21876: 4028, // Wind Surge cast
            // Water family
            3275: 211, // Water Strike cast
            3285: 209, // Water Bolt cast
            3297: 207, // Water Blast cast
            3315: 213, // Water Wave cast
            21877: 4030, // Water Surge cast
            // Earth family
            3277: 132, // Earth Strike cast
            3288: 130, // Earth Bolt cast
            3302: 128, // Earth Blast cast
            3319: 134, // Earth Wave cast
            21878: 4025, // Earth Surge cast
            // Fire family
            3279: 160, // Fire Strike cast
            3291: 157, // Fire Bolt cast
            3307: 155, // Fire Blast cast
            3321: 162, // Fire Wave cast
            21879: 4032, // Fire Surge cast
            // Debuffs
            3274: 119, // Confuse cast
            3278: 3011, // Weaken cast
            3282: 127, // Curse cast
            3324: 3009, // Vulnerability cast
            3325: 148, // Enfeeble cast
            3326: 3004, // Stun cast
            // Binding
            3283: 101, // Bind cast
            3300: 3003, // Snare cast
            3322: 151, // Entangle cast
            // Utility
            3293: 122, // Crumble Undead cast
            9075: 190, // Superheat cast
            9110: 98, // Low Alch cast
            9111: 97, // High Alch cast
            9100: 3006, // Telegrab cast
            9076: 116, // Charge Air Orb
            9077: 115, // Charge Earth Orb
            9078: 117, // Charge Fire Orb
            9079: 118, // Charge Water Orb
            9001: 114, // Bones to Bananas
        };
        const impactMap: Record<number, number> = {
            // Wind family
            3273: 221, // Wind Strike hit
            3281: 219, // Wind Bolt hit
            3294: 217, // Wind Blast hit
            3313: 223, // Wind Wave hit
            21876: 4027, // Wind Surge hit
            // Water family
            3275: 212, // Water Strike hit
            3285: 210, // Water Bolt hit
            3297: 208, // Water Blast hit
            3315: 214, // Water Wave hit
            21877: 4029, // Water Surge hit
            // Earth family
            3277: 133, // Earth Strike hit
            3288: 131, // Earth Bolt hit
            3302: 129, // Earth Blast hit
            3319: 135, // Earth Wave hit
            21878: 4026, // Earth Surge hit
            // Fire family
            3279: 161, // Fire Strike hit
            3291: 158, // Fire Bolt hit
            3307: 156, // Fire Blast hit
            3321: 163, // Fire Wave hit
            21879: 4031, // Fire Surge hit
            // Debuffs
            3274: 121, // Confuse hit
            3278: 3010, // Weaken hit
            3282: 126, // Curse hit
            3324: 3008, // Vulnerability impact
            3325: 150, // Enfeeble hit
            3326: 3005, // Stun impact
            // Binding
            3283: 99, // Bind impact
            3300: 3002, // Snare impact
            3322: 153, // Entangle hit
            // Utility impacts (where applicable)
            3293: 124, // Crumble Undead hit
            9100: 3007, // Telegrab hit
        };
        if (stage === "cast") {
            return castMap[spellId];
        }
        if (stage === "impact") {
            return impactMap[spellId];
        }
        if (stage === "splash") {
            return DEFAULT_MAGIC_SPLASH_SOUND;
        }
        return undefined;
    }

    private pickHitDelay(player: PlayerState): number {
        try {
            const equip = this.ensureEquipArray(player);
            const weaponId = equip[EquipmentSlot.WEAPON];
            if (weaponId > 0) {
                const dataEntry = this.weaponData.get(weaponId);
                if (dataEntry?.hitDelay !== undefined && dataEntry.hitDelay > 0) {
                    return dataEntry.hitDelay;
                }
            }
        } catch {}
        // Default hit delay for unarmed/unknown weapons (melee default)
        return MELEE_HIT_DELAY_TICKS;
    }

    private resolveBaseAttackSpeed(player: PlayerState): number {
        try {
            const equip = this.ensureEquipArray(player);
            const weaponId = equip[EquipmentSlot.WEAPON];

            if (weaponId > 0) {
                const dataEntry = this.weaponData.get(weaponId);
                const overrideSpeed = dataEntry?.attackSpeed;
                if (overrideSpeed !== undefined && overrideSpeed > 0) {
                    return overrideSpeed;
                }
                const obj = this.getObjType(weaponId);
                if (!obj) {
                    if (!this.weaponWarningsLogged.has(weaponId)) {
                        this.weaponWarningsLogged.add(weaponId);
                        logger.warn(
                            `[combat] Object type not found for weapon ID ${weaponId} (player ${player.id}), using default attack speed`,
                        );
                    }
                    return DEFAULT_ATTACK_SPEED;
                }
                const rawSpeed = obj.params?.get(WEAPON_SPEED_PARAM) as number | undefined;
                if (rawSpeed !== undefined && rawSpeed > 0) {
                    return rawSpeed;
                }
                if (!dataEntry || overrideSpeed === undefined) {
                    if (!this.weaponWarningsLogged.has(weaponId)) {
                        this.weaponWarningsLogged.add(weaponId);
                        logger.warn(
                            `[combat] Weapon ID ${weaponId} has no valid attack speed data, using default`,
                        );
                    }
                }
            }
        } catch (err) {
            const equip = player.appearance?.equip;
            const weaponId = Array.isArray(equip) ? equip[EquipmentSlot.WEAPON] : 0;
            if (!this.weaponWarningsLogged.has(weaponId)) {
                this.weaponWarningsLogged.add(weaponId);
                logger.warn(
                    `[combat] pickAttackSpeed failed for player ${player.id} with weapon ${weaponId}:`,
                    err,
                );
            }
        }
        return DEFAULT_ATTACK_SPEED;
    }

    private pickAttackSpeed(player: PlayerState): number {
        const equip = this.ensureEquipArray(player);
        const weaponId = equip[EquipmentSlot.WEAPON];
        const baseSpeed = this.resolveBaseAttackSpeed(player);

        // OSRS: Rapid style reduces attack speed by 1 tick for ranged weapons
        // Must check actual attack style, not just slot - Dark bow/Heavy ballista don't have rapid
        const weaponCategory = player.combatWeaponCategory ?? 0;
        const styleSlot = player.combatStyleSlot ?? 0;
        if (RANGED_WEAPON_CATEGORY_IDS.has(weaponCategory)) {
            const actualStyle = getAttackStyle(weaponId, styleSlot);
            if (actualStyle === AttackStyle.RAPID) {
                // Rapid style: -1 tick attack speed (minimum 1)
                return Math.max(1, baseSpeed - 1);
            }
        }

        return baseSpeed;
    }

    /**
     * Award combat XP to a player based on damage dealt.
     * OSRS XP formulas:
     * - Hitpoints: damage * 1.33 (always)
     * - Primary skill: damage * 4 (varies by attack style)
     * - Magic: damage * 2 + spell base XP
     *
     * @param player - Player to award XP to
     * @param damage - Damage dealt (must be > 0)
     * @param hitData - Hit data containing attackType, attackStyleMode, spellId
     * @param effects - Action effects array to push skill updates to
     */
    private awardCombatXp(
        player: PlayerState,
        damage: number,
        hitData: any,
        effects: ActionEffect[],
    ): void {
        if (!(damage > 0)) return;

        // Extract attack type and style mode from hit data
        const attackType = hitData?.attackType as CombatXpAttackType | undefined;
        const styleMode = hitData?.attackStyleMode as StyleMode | string | undefined;
        const spellId = hitData?.spellId as number | undefined;
        const spellBaseXpAtCast = !!hitData?.spellBaseXpAtCast;

        // Default to melee accurate if not specified
        const resolvedAttackType: CombatXpAttackType = attackType ?? "melee";
        const resolvedStyleMode: StyleMode | string = styleMode ?? "accurate";

        // Get spell base XP for magic attacks
        const spellBaseXp =
            resolvedAttackType === "magic" &&
            !spellBaseXpAtCast &&
            spellId !== undefined &&
            spellId > 0
                ? getSpellBaseXp(spellId)
                : 0;

        // Calculate XP awards using OSRS formulas
        const awards = calculateCombatXp(
            damage,
            resolvedAttackType,
            resolvedStyleMode,
            spellBaseXp,
        );

        // Apply XP to each skill - setSkillXp handles level computation and marking dirty
        let xpChanged = false;
        const oldCombatLevel = player.combatLevel;
        const multiplier = this.gamemode.getSkillXpMultiplier(player);
        for (const award of awards) {
            const skill = player.getSkill(award.skillId);
            const currentXp = skill?.xp ?? 0;
            // OSRS max XP is 200,000,000
            const MAX_XP = 200_000_000;
            const scaledXp = award.xp * multiplier;
            const newXp = Math.min(MAX_XP, currentXp + scaledXp);

            if (newXp > currentXp) {
                const oldLevel = skill.baseLevel;
                player.setSkillXp(award.skillId, newXp);
                const newLevel = player.getSkill(award.skillId).baseLevel;
                xpChanged = true;

                // Emit level up effect if leveled
                if (newLevel > oldLevel) {
                    effects.push({
                        type: "levelUp",
                        playerId: player.id,
                        skillId: award.skillId,
                        newLevel,
                        levelIncrement: Math.max(1, newLevel - oldLevel),
                    });
                }
            }
        }

        const newCombatLevel = player.combatLevel;
        if (newCombatLevel > oldCombatLevel) {
            effects.push({
                type: "combatLevelUp",
                playerId: player.id,
                newLevel: newCombatLevel,
                levelIncrement: Math.max(1, newCombatLevel - oldCombatLevel),
            });
        }

        // Sync skill updates to player - takeSkillSync will get all dirty skills
        if (xpChanged) {
            const sync = player.takeSkillSync();
            if (sync) {
                this.queueSkillSnapshot(player.id, sync);
            }
        }
    }

    private getPlayerAttackReach(player: PlayerState): number {
        let baseRange: number | undefined;
        try {
            const equip = this.ensureEquipArray(player);
            const weaponId = equip[EquipmentSlot.WEAPON];
            if (weaponId > 0) {
                const obj = this.getObjType(weaponId);
                const rawRange = obj?.params?.get(13) as number | undefined;
                if (rawRange !== undefined && rawRange > 0) {
                    baseRange = rawRange;
                }
            }
        } catch {}

        return resolvePlayerAttackReach(player, { baseRange });
    }

    private resolveNpcAttackType(npc: NpcState, explicit?: AttackType): AttackType {
        return resolveNpcAttackTypeRule(npc, explicit);
    }

    private resolveNpcAttackRange(npc: NpcState, attackType: AttackType): number {
        return resolveNpcAttackRangeRule(npc, attackType);
    }

    private getDistanceToNpcBounds(player: PlayerState, npc: NpcState): number {
        const px = player.tileX;
        const py = player.tileY;
        const minX = npc.tileX;
        const minY = npc.tileY;
        const size = Math.max(1, npc.size);
        const maxX = minX + size - 1;
        const maxY = minY + size - 1;
        const clampedX = Math.max(minX, Math.min(px, maxX));
        const clampedY = Math.max(minY, Math.min(py, maxY));
        return Math.max(Math.abs(clampedX - px), Math.abs(clampedY - py));
    }

    /**
     * Compute hit delay for NPC attacking player.
     *
     * OSRS hit delay formulas (docs/tick-cycle-order.md):
     * - Melee: 1 tick
     * - Ranged: 1 + floor((3 + distance) / 6)
     * - Magic: 1 + floor((1 + distance) / 3)
     *
     * Note: Delay here is from NPC swing to hit application in server ticks.
     */
    private computeNpcHitDelay(
        npc: NpcState,
        player: PlayerState,
        attackType: AttackType,
        _attackSpeed: number,
    ): number {
        const distance = this.getDistanceToNpcBounds(player, npc);
        switch (attackType) {
            case "magic":
                // OSRS: 1 + floor((1 + distance) / 3)
                return Math.max(1, 1 + Math.floor((1 + distance) / 3));
            case "ranged":
                // OSRS: 1 + floor((3 + distance) / 6)
                return Math.max(1, 1 + Math.floor((3 + distance) / 6));
            case "melee":
            default:
                // OSRS: Melee retaliation hit resolves 1 tick after swing.
                return 1;
        }
    }

    private pickNpcAttackSpeed(npc: NpcState, _player?: PlayerState): number {
        const paramSpeed = this.getNpcParamValue(npc, 14);
        if (paramSpeed !== undefined && paramSpeed > 0) {
            return Math.max(1, paramSpeed);
        }
        return 4;
    }

    private pickNpcHitDelay(npc: NpcState, _player: PlayerState, _attackSpeed: number): number {
        const paramHitDelay = this.getNpcParamValue(npc, 286);
        if (paramHitDelay !== undefined && paramHitDelay > 0) {
            return Math.max(1, paramHitDelay);
        }
        const attackType = this.resolveNpcAttackType(npc);
        return this.computeNpcHitDelay(npc, _player, attackType, _attackSpeed);
    }

    private getNpcParamValue(npc: NpcState, key: number): number | undefined {
        try {
            const type = this.npcManager?.getNpcType(npc);
            return type?.params?.get(key) as number | undefined;
        } catch {}
        return undefined;
    }

    private resolveNpcCombatProfile(npc: NpcState): NpcCombatProfile {
        // NPCs now own their combat profile (loaded at spawn time)
        return npc.combat;
    }

    private loadNpcCombatDefs(): void {
        if (this.npcCombatDefs) return;
        try {
            const fs = require("fs");
            const path = require("path");
            const filePath = path.resolve(__dirname, "../../data/npc-combat-defs.json");
            const json = fs.readFileSync(filePath, "utf8");
            const data = JSON.parse(json) as {
                defaults?: {
                    humanoid?: {
                        attack?: number;
                        block?: number;
                        death?: number;
                        deathSound?: number;
                    };
                };
                npcs?: Record<
                    string,
                    {
                        anims?: { attack?: number; block?: number; death?: number };
                        sounds?: { death?: number };
                        deathSound?: number;
                    }
                >;
                refs?: { npcs?: Array<[number, number, number, number?]> };
            };

            const defaultsRaw = data?.defaults?.humanoid;
            this.npcCombatDefaults = {
                attack: defaultsRaw?.attack ?? DEFAULT_ATTACK_SEQ,
                block: defaultsRaw?.block ?? DEFAULT_BLOCK_SEQ,
                death: defaultsRaw?.death ?? DEFAULT_NPC_DEATH_SEQ,
                deathSound: defaultsRaw?.deathSound ?? DEFAULT_NPC_DEATH_SOUND,
            };

            const defs: Record<
                string,
                {
                    attack?: number;
                    block?: number;
                    death?: number;
                    deathSound?: number;
                }
            > = {};
            if (data.npcs) {
                for (const [id, def] of Object.entries(data.npcs)) {
                    const anims = def.anims;
                    const attack = anims?.attack;
                    const block = anims?.block;
                    const death = anims?.death;
                    const deathSound = def.sounds?.death ?? def.deathSound;
                    defs[id] = { attack, block, death, deathSound };
                }
            }

            // Optional: additional NPC attack/block/death sequences derived from references.
            // Stored in the same file to avoid maintaining multiple sources of truth.
            const refsRows = data.refs?.npcs ?? [];
            for (const row of refsRows) {
                const [npcId, attack, block, death] = row;
                if (!(npcId > 0) || !(attack >= 0) || !(block >= 0)) continue;
                const idKey = String(npcId);
                // Manual entries win.
                if (defs[idKey]) continue;
                defs[idKey] = {
                    attack,
                    block,
                    death: death !== undefined && death >= 0 ? death : undefined,
                };
            }
            this.npcCombatDefs = defs;
            logger.info(
                `[combat] loaded ${Object.keys(this.npcCombatDefs).length} NPC combat definitions`,
            );
        } catch (err) {
            logger.warn("[combat] failed to load npc-combat-defs.json", err);
            this.npcCombatDefs = {};
            this.npcCombatDefaults = {
                attack: DEFAULT_ATTACK_SEQ,
                block: DEFAULT_BLOCK_SEQ,
                death: DEFAULT_NPC_DEATH_SEQ,
                deathSound: DEFAULT_NPC_DEATH_SOUND,
            };
        }
    }

    private loadNpcCombatStats(): void {
        if (this.npcCombatStats) return;
        try {
            const fs = require("fs");
            const path = require("path");
            const filePath = path.resolve(__dirname, "../../data/npc-combat-stats.json");
            const json = fs.readFileSync(filePath, "utf8");
            const data = JSON.parse(json);
            this.npcCombatStats = data?.npcs ?? {};
            logger.info(
                    `[combat] loaded ${Object.keys(this.npcCombatStats ?? {}).length} NPC combat stats`,
            );
        } catch (err) {
            logger.warn("[combat] failed to load npc-combat-stats.json", err);
            this.npcCombatStats = {};
        }
    }

    private getNpcCombatSequences(typeId: number): {
        block?: number;
        attack?: number;
        death?: number;
    } {
        // Load NPC combat definitions from JSON (server-side only, like OSRS)
        this.loadNpcCombatDefs();
        const defaults = this.npcCombatDefaults ?? {
            attack: DEFAULT_ATTACK_SEQ,
            block: DEFAULT_BLOCK_SEQ,
            death: DEFAULT_NPC_DEATH_SEQ,
            deathSound: DEFAULT_NPC_DEATH_SOUND,
        };

        // Look up by NPC type ID first
        const def = this.npcCombatDefs?.[String(typeId)];
        if (def) {
            return {
                attack: def.attack ?? defaults.attack,
                block: def.block ?? defaults.block,
                death: def.death ?? defaults.death,
            };
        }

        // Default to humanoid animations for NPCs not in the definitions
        return { attack: defaults.attack, block: defaults.block, death: defaults.death };
    }

    /**
     * Get an NPC sound from Table 88 based on the NPC type and sound type.
     * Returns undefined if no matching sound is found.
     */
    private getNpcSoundFromTable88(typeId: number, soundType: NpcSoundType): number | undefined {
        if (!this.npcSoundLookup || !this.npcTypeLoader) return undefined;
        try {
            const npcType = this.npcTypeLoader.load(typeId);
            if (!npcType) return undefined;
            const soundId = this.npcSoundLookup.getSoundForNpc(npcType, soundType);
            return soundId;
        } catch {
            return undefined;
        }
    }

    private getNpcDeathSoundId(typeId: number): number | undefined {
        // First try table 88 lookup for OSRS-accurate sounds
        const table88Sound = this.getNpcSoundFromTable88(typeId, "death");
        if (table88Sound !== undefined && table88Sound > 0) {
            return table88Sound;
        }

        // Fall back to JSON definitions
        this.loadNpcCombatDefs();
        const defaults = this.npcCombatDefaults ?? {
            attack: DEFAULT_ATTACK_SEQ,
            block: DEFAULT_BLOCK_SEQ,
            death: DEFAULT_NPC_DEATH_SEQ,
            deathSound: DEFAULT_NPC_DEATH_SOUND,
        };
        const def = this.npcCombatDefs?.[String(typeId)];
        const soundId = def?.deathSound ?? defaults.deathSound;
        return soundId > 0 ? soundId : undefined;
    }

    /**
     * Get NPC attack sound from Table 88, falling back to generic sound.
     */
    private getNpcAttackSoundId(typeId: number): number {
        const table88Sound = this.getNpcSoundFromTable88(typeId, "attack");
        if (table88Sound !== undefined && table88Sound > 0) {
            return table88Sound;
        }
        return NPC_ATTACK_SOUND;
    }

    /**
     * Get NPC hit sound from Table 88, falling back to generic sound.
     */
    private getNpcHitSoundId(typeId: number): number | undefined {
        const table88Sound = this.getNpcSoundFromTable88(typeId, "hit");
        if (table88Sound !== undefined && table88Sound > 0) {
            return table88Sound;
        }
        return undefined;
    }

    /**
     * Get NPC defend/block sound from Table 88.
     */
    private getNpcDefendSoundId(typeId: number): number | undefined {
        const table88Sound = this.getNpcSoundFromTable88(typeId, "defend");
        if (table88Sound !== undefined && table88Sound > 0) {
            return table88Sound;
        }
        return undefined;
    }

    private estimateNpcDespawnDelayTicksFromSeq(seqId: number | undefined): number {
        if (seqId === undefined || seqId < 0) return 1;
        const loader = this.seqTypeLoader;
        if (!loader) return 1;
        try {
            const seq = loader.load(seqId);
            if (!seq) return 1;
            if (seq.isSkeletalSeq()) {
                const dur = Math.max(1, seq.getSkeletalDuration?.() ?? 1);
                // Skeletal durations are already in frames; treat as client cycles.
                return Math.max(1, Math.ceil(dur / 30));
            }
            const lengths = seq.frameLengths;
            if (!lengths || lengths.length === 0) return 1;
            let cycles = 0;
            for (let i = 0; i < lengths.length; i++) {
                let fl = lengths[i];
                if (fl <= 0) fl = 1;
                // OSRS parity: some death sequences have an extremely long final frame to "hold" the
                // corpse pose. That final-frame length is not treated as part of the death delay.
                // (RSMod mirrors this with a 200-cycle threshold; 200 cycles = 4s at 20ms/cycle.)
                if (i === lengths.length - 1 && fl >= 200) continue;
                cycles += fl;
            }
            return Math.max(1, Math.ceil(cycles / 30));
        } catch {
            return 1;
        }
    }

    private broadcastNpcSequence(npc: NpcState, seqId: number | undefined): void {
        if (seqId === undefined || seqId < 0) return;
        // NPC sequences are encoded via the binary NPC update packet (mask 0x10).
        const frame = this.activeFrame;
        if (!frame) return;
        const id = npc.id;
        // Merge into an existing delta if this NPC already produced movement/turn updates this tick.
        const existing = frame.npcUpdates.find((d) => d?.id === id);
        if (existing?.seq !== undefined && existing.seq >= 0) {
            // OSRS parity: If two animations are broadcast on the same tick,
            // keep the one with higher forcedPriority (attack > hurt).
            const existingPriority = this.getSeqForcedPriority(existing.seq);
            const newPriority = this.getSeqForcedPriority(seqId);
            if (newPriority >= existingPriority) {
                existing.seq = seqId;
            }
            // else: keep existing higher-priority animation
        } else if (existing) {
            existing.seq = seqId;
        } else {
            frame.npcUpdates.push({ id, seq: seqId });
        }
    }

    private queueExternalNpcTeleportSync(npc: NpcState): void {
        const delta = buildTeleportNpcUpdateDelta(npc);
        if (this.activeFrame) {
            upsertNpcUpdateDelta(this.activeFrame.npcUpdates, delta);
            return;
        }
        upsertNpcUpdateDelta(this.pendingNpcUpdates, delta);
    }

    private getSeqForcedPriority(seqId: number): number {
        return this.seqTypeLoader?.load?.(seqId)?.forcedPriority ?? 5;
    }

    /**
     * Process binary packet converted to ClientToServer message format
     */
    private processBinaryMessage(ws: WebSocket, parsed: RoutedMessage): void {
        // Binary packets are converted to the same message format as JSON
        // so we can reuse existing handlers. Log for debugging.
        logger.debug?.(`[binary] Processing message type=${parsed.type}`);

        // OSRS parity: Centralized interface closing for actions that dismiss modals/dialogs
        if (INTERFACE_CLOSING_ACTIONS.has(parsed.type)) {
            const player = this.players?.get(ws);
            if (player) {
                // Don't close interfaces for walk if player can't move (e.g., during tutorial)
                if (parsed.type === "walk" && !player.canMove()) {
                    // Skip interface closing - movement will be blocked
                } else {
                    this.closeInterruptibleInterfaces(player);
                }
            }
        }

        // Route to existing handlers based on message type
        switch (parsed.type) {
            case "walk": {
                const to = parsed.payload.to;
                const modifierFlags = parsed.payload.modifierFlags ?? 0;
                const player = this.players?.get(ws);
                if (player) {
                    let effectiveRun = player.runToggle;
                    if ((modifierFlags & MODIFIER_FLAG_CTRL) !== 0) {
                        effectiveRun = !effectiveRun;
                    }
                    if (modifierFlags === MODIFIER_FLAG_CTRL_SHIFT) {
                        effectiveRun = true;
                    }
                    const nowTick = this.options.ticker.currentTick();
                    const command: PendingWalkCommand = {
                        to: { x: to.x, y: to.y },
                        run: effectiveRun,
                        enqueuedTick: nowTick,
                    };
                    this.pendingWalkCommands.set(ws, command);
                }
                break;
            }

            case "npc_attack": {
                const { npcId } = parsed.payload;
                if (!this.players || !this.npcManager) return;
                const player = this.players.get(ws);
                const npc = this.npcManager.getById(npcId);
                if (player && npc) {
                    logger.info?.(`[binary] npc_attack player=${player.id} npc=${npcId}`);
                    const tick = this.options.ticker.currentTick();
                    const attackSpeed = this.pickAttackSpeed(player);
                    const res = this.players.startNpcAttack(ws, npc, tick, attackSpeed);
                    if (!res.ok) {
                        if (res.chatMessage) {
                            this.queueChatMessage({
                                messageType: "game",
                                text: res.chatMessage,
                                targetPlayerIds: [player.id],
                            });
                        }
                    } else {
                        player.setInteraction("npc", npc.id);
                        this.playerCombatManager?.startCombat(player, npc, tick, attackSpeed);
                    }
                }
                break;
            }

            case "npc_interact": {
                const { npcId, option } = parsed.payload;
                if (!this.players || !this.npcManager) return;
                const player = this.players.get(ws);
                const npc = this.npcManager.getById(npcId);
                if (player && npc) {
                    logger.info?.(
                        `[binary] npc_interact player=${player.id} npc=${npcId} opt=${option}`,
                    );
                    if (!this.messageRouter.dispatch(ws, parsed)) {
                        logger.warn(
                            `[binary] npc_interact not handled by MessageRouter player=${player.id} npc=${npcId}`,
                        );
                    }
                }
                break;
            }

            case "loc_interact": {
                const { id, tile, action } = parsed.payload;
                const player = this.players?.get(ws);
                if (player) {
                    logger.info?.(
                        `[binary] loc_interact player=${player.id} loc=${id} tile=(${tile?.x},${tile?.y}) action=${action}`,
                    );
                    if (!this.messageRouter.dispatch(ws, parsed)) {
                        logger.warn(
                            `[binary] loc_interact not handled by MessageRouter player=${player.id} loc=${id}`,
                        );
                    }
                }
                break;
            }

            case "ground_item_action": {
                const payload: GroundItemActionPayload = { ...parsed.payload };
                const player = this.players?.get(ws);
                if (player) {
                    if (!payload.option || payload.option.length === 0) {
                        const opNum = payload.opNum;
                        if (opNum !== undefined && opNum > 0) {
                            const resolved = this.resolveGroundItemOptionByOpNum(
                                payload.itemId,
                                opNum,
                            );
                            if (resolved) payload.option = resolved;
                        }
                    }
                    logger.info?.(
                        `[binary] ground_item_action player=${player.id} item=${
                            payload.itemId
                        } tile=(${payload.tile?.x},${payload.tile?.y}) option=${
                            payload.option ?? "?"
                        } opNum=${payload.opNum ?? "?"}`,
                    );
                    // Delegate to the real handler that takes ws
                    this.handleGroundItemAction(ws, payload);
                }
                break;
            }

            case "interact": {
                const { mode, targetId } = parsed.payload;
                const player = this.players?.get(ws);
                if (player) {
                    logger.info?.(
                        `[binary] interact player=${player.id} mode=${mode} target=${targetId}`,
                    );
                    if (mode === "trade" || mode === "follow") {
                        this.players?.startFollowing(ws, targetId, mode);
                    }
                }
                break;
            }

            case "widget_action": {
                // OSRS parity: Binary IF_BUTTON packets arrive here via BinaryBridge
                // BinaryBridge sends: { widgetId, groupId, childId, slot, itemId, buttonNum }
                //
                // For dynamic children (CC_CREATE):
                //   - widgetId = (interfaceId << 16) | parentComponentId
                //   - slot = dynamic child index (this is the "childId" for script handlers)
                // For static children:
                //   - widgetId = (interfaceId << 16) | componentId
                //   - slot = inventory slot or -1
                const payload = parsed.payload;
                console.log(`[DEBUG widget_action] RECEIVED widgetId=${payload.widgetId} group=${(payload.widgetId >>> 16) & 0xffff} child=${payload.widgetId & 0xffff} buttonNum=${payload.buttonNum} slot=${payload.slot} itemId=${payload.itemId}`);
                const player = this.players?.get(ws);
                if (player) {
                    const groupId = payload.groupId ?? (payload.widgetId >> 16) & 0xffff;
                    const componentId = payload.widgetId & 0xffff;
                    const opId = payload.buttonNum ?? 1;
                    // For dynamic children, slot IS the childId (dynamic child index)
                    // For static widgets, slot is -1/65535 and childId should be componentId
                    const slotVal = payload.slot;
                    // slot=-1 (or 65535 unsigned) means "no slot", use component as childId
                    // slot>=0 means it's a valid child index or inventory slot
                    const hasValidSlot = slotVal !== undefined && slotVal >= 0 && slotVal !== 65535;
                    const childId = hasValidSlot ? slotVal : componentId;

                    // Check script registry button handlers first (extrascript modals)
                    const buttonHandler = this.scriptRegistry.findButton(groupId, componentId);
                    if (buttonHandler) {
                        const tick = this.options.ticker.currentTick();
                        buttonHandler({
                            tick,
                            services: this.scriptRuntime.getServices(),
                            player,
                            widgetId: payload.widgetId,
                            groupId,
                            childId,
                            option: payload.option,
                            opId,
                            slot: slotVal,
                            itemId: payload.itemId,
                        });
                        break;
                    }

                    if (
                        this.cs2ModalManager.handleWidgetAction(
                            player,
                            groupId,
                            componentId,
                            payload.option,
                            payload.itemId,
                        )
                    ) {
                        break;
                    }

                    // Handle dialog options (interface 219)
                    if (groupId === 219) {
                        this.widgetDialogHandler.handleDialogOptionClick(ws, player.id, childId);
                    } else {
                        // OSRS parity: inventory item actions resolve the option from
                        // the item's cache definition and route through the item action
                        // system before falling back to generic widget handlers.
                        if (
                            payload.itemId !== undefined &&
                            payload.itemId > 0 &&
                            hasValidSlot &&
                            opId >= 1
                        ) {
                            // Check custom item registry first for overridden actions
                            let actions: (string | null | undefined)[] | undefined;
                            const customItem = CustomItemRegistry.get(payload.itemId);
                            if (customItem?.definition?.objType?.inventoryActions) {
                                actions = customItem.definition.objType.inventoryActions;
                            }
                            if (!actions) {
                                const obj = this.getObjType(payload.itemId);
                                actions = obj?.inventoryActions;
                            }
                            if (actions) {
                                const resolved = actions[opId - 1];
                                if (resolved) {
                                    const option = resolved.toLowerCase();
                                    const tick = this.options.ticker.currentTick();
                                    const handled = this.scriptRuntime.queueItemAction({
                                        tick,
                                        player,
                                        itemId: payload.itemId,
                                        slot: slotVal ?? 0,
                                        option,
                                    });
                                    if (handled) break;
                                }
                            }
                            // Fallback: try script registry with no specific option
                            {
                                const tick = this.options.ticker.currentTick();
                                const handled = this.scriptRuntime.queueItemAction({
                                    tick,
                                    player,
                                    itemId: payload.itemId,
                                    slot: slotVal ?? 0,
                                });
                                if (handled) break;
                            }
                        }

                        // Route through standard widget action handler with opId
                        this.widgetDialogHandler.handleWidgetActionMessage(ws, {
                            ...payload,
                            opId,
                            childId,
                        });
                    }
                }
                break;
            }

            case "item_spawner_search": {
                const player = this.players?.get(ws);
                if (player) {
                    const msgHandler = this.scriptRegistry.findClientMessageHandler("item_spawner_search");
                    if (msgHandler) {
                        const tick = this.options.ticker.currentTick();
                        msgHandler({
                            tick,
                            services: this.scriptRuntime.getServices(),
                            player,
                            messageType: "item_spawner_search",
                            payload: parsed.payload ?? {},
                        });
                    }
                }
                break;
            }

            case "if_close": {
                const player = this.players?.get(ws);
                if (player) {
                    // Keep close behavior consistent across both packet->message paths.
                    this.closeInterruptibleInterfaces(player);
                }
                break;
            }

            case "if_triggeroplocal": {
                const player = this.players?.get(ws);
                if (player) {
                    const { widgetUid, childIndex, itemId, opcodeParam } = parsed.payload;

                    // Best-effort parity bridge:
                    // when the forwarded op param is a canonical widget op (1-10),
                    // route it through the existing widget action pipeline.
                    if (opcodeParam >= 1 && opcodeParam <= 10) {
                        const groupId = (widgetUid >>> 16) & 0xffff;
                        const componentId = widgetUid & 0xffff;
                        const hasChild = childIndex >= 0;
                        const childId = hasChild ? childIndex : componentId;
                        this.widgetDialogHandler.handleWidgetActionMessage(ws, {
                            widgetId: widgetUid,
                            groupId,
                            childId,
                            opId: opcodeParam,
                            slot: hasChild ? childIndex : undefined,
                            itemId,
                        });
                    }
                }
                break;
            }

            case "inventory_use_on": {
                const { slot, itemId, target } = parsed.payload;
                const player = this.players?.get(ws);
                if (player) {
                    logger.info?.(
                        `[binary] inventory_use_on player=${player.id} slot=${slot} item=${itemId} target=${target.kind}`,
                    );
                    this.handleInventoryUseOnMessage(ws, parsed.payload);
                }
                break;
            }

            case "resume_pausebutton": {
                const player = this.players?.get(ws);
                if (player) {
                    const { widgetId, childIndex } = parsed.payload;
                    const widgetGroup = (widgetId >> 16) & 0xffff;

                    // Check for level up popup first
                    const q = this.levelUpPopupQueue.get(player.id);
                    if (q && q.length > 0 && widgetGroup === LEVELUP_INTERFACE_ID) {
                        const expectedWidgetId =
                            (LEVELUP_INTERFACE_ID << 16) | LEVELUP_CONTINUE_COMPONENT;
                        const current = q[0];
                        const expectsLevelupDisplay =
                            current.kind === "combat" ||
                            (current.kind === "skill" && current.skillId !== SkillId.Hunter);

                        if (!expectsLevelupDisplay || widgetId === expectedWidgetId) {
                            this.advanceLevelUpPopupQueue(player);
                        }
                    } else if (widgetGroup === 270) {
                        // Chatbox production/select UI (e.g. crossbow bolt enchantments).
                        // RESUME_PAUSEBUTTON carries:
                        // - widgetId: selected product component UID (270:15..32)
                        // - childIndex: selected quantity
                        // Route through widget_action so script modules can handle it uniformly.
                        this.widgetDialogHandler.handleWidgetActionMessage(ws, {
                            widgetId,
                            groupId: widgetGroup,
                            childId: widgetId & 0xffff,
                            opId: 1,
                            slot: childIndex,
                        });
                    } else if (
                        this.cs2ModalManager.handleResumePauseButton(player, widgetId, childIndex)
                    ) {
                        break;
                    } else {
                        this.widgetDialogHandler.handleResumePauseButton(
                            ws,
                            player.id,
                            widgetId,
                            childIndex,
                        );
                    }
                }
                break;
            }

            case "if_buttond": {
                this.messageRouter.dispatch(ws, parsed);
                break;
            }

            default:
                logger.debug?.(`[binary] Unhandled message type: ${parsed.type}`);
        }
    }

    private broadcast(msg: string | Uint8Array, context = "broadcast") {
        for (const client of this.wss.clients) {
            this.sendWithGuard(client, msg, context);
        }
    }
}
