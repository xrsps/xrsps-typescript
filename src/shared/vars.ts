/**
 * Shared varp/varbit constants between client and server.
 *
 * OSRS uses varps (player variables) for persistent settings and state.
 * Some varps are "transmit" varps that sync between client and server.
 */

// ========== VARPS (Player Variables) ==========

/** Run mode toggle (0 = walk, 1 = run) */
export const VARP_OPTION_RUN = 173;

/** Special attack enabled (0 = off, 1 = on) */
export const VARP_SPECIAL_ATTACK = 301;

/** Special attack energy (0-1000, displayed as 0-100%) */
export const VARP_SPECIAL_ENERGY = 300;

/**
 * Auto-retaliate setting (varp 172 = "option_nodef").
 * OSRS parity: 0 = auto-retaliate ON (player WILL defend), 1 = OFF (player WON'T defend).
 * The CS2 script checks %option_nodef=0 to display "Auto Retaliate (On)".
 */
export const VARP_AUTO_RETALIATE = 172;

/** Attack style slot (0-3) */
export const VARP_ATTACK_STYLE = 43;

/**
 * Last home teleport timestamp (in client ticks since login).
 * Used by CS2 to enforce 30-minute cooldown. Server initializes to large negative
 * value so spell appears available immediately on login.
 */
export const VARP_LAST_HOME_TELEPORT = 892;

/**
 * Last minigame teleport timestamp (in minutes since Unix epoch).
 * Used by CS2 to enforce the 20-minute minigame teleport cooldown. Server initializes
 * to a large negative value so the spell appears available immediately on login.
 */
export const VARP_LAST_MINIGAME_TELEPORT = 888;

/** Brightness setting (1-4) */
export const VARP_BRIGHTNESS = 166;

/** Music volume (0-100) */
export const VARP_MUSIC_VOLUME = 168;

/**
 * Music play mode (0 = Area, 1 = Shuffle, 2 = Single).
 * Controls whether music follows the current region or the music tab's manual modes.
 */
export const VARP_MUSICPLAY = 18;

/**
 * Currently selected/playing music track DB row.
 * CS2 music scripts read this row id to rebuild the "Now Playing" text and highlight the list row.
 */
export const VARP_MUSIC_CURRENT_TRACK = 3883;

/** Sound effects volume (0-100) */
export const VARP_SOUND_EFFECTS_VOLUME = 169;

/** Area sounds volume (0-100) */
export const VARP_AREA_SOUNDS_VOLUME = 872;

/** Master volume (0-100) - enhanced client feature, controls overall volume multiplier */
export const VARP_MASTER_VOLUME = 3796;

/**
 * Player 'Attack' options (dropdown setting 55).
 * 0 = Depends on combat levels, 1 = Always right-click, 2 = Left-click where available, 3 = Hidden.
 */
export const VARP_OPTION_ATTACK_PRIORITY_PLAYER = 1107;

/**
 * NPC 'Attack' options (dropdown setting 56).
 * 0 = Depends on combat levels, 1 = Always right-click, 2 = Left-click where available, 3 = Hidden.
 */
export const VARP_OPTION_ATTACK_PRIORITY_NPC = 1306;

/**
 * Active follower NPC server index.
 * Cache-verified from local rev 236 varp definitions: varp 447 has client option type 17.
 * OSRS uses this to gate follower menus to the player's current active follower only.
 */
export const VARP_FOLLOWER_INDEX = 447;

/**
 * Active combat-target player server index.
 * Cache-verified from local rev 236 varp definitions: varp 1075 has client option type 19.
 * OSRS uses this to drive `combatTargetPlayerIndex` through the varp update path.
 */
export const VARP_COMBAT_TARGET_PLAYER_INDEX = 1075;

// ========== VARBITS (Bit-packed variables) ==========

/** HAM Hideout trapdoor multiloc control (varbit 235). Session-only; resets on logout. */
export const VARBIT_HAM_TRAPDOOR = 235;

/** Side journal tab selection (quest list, achievement diary, etc.) */
export const VARBIT_SIDE_JOURNAL_TAB = 8168;

/** Player account type (0=main, 1=ironman, 2=ultimate, 3=hardcore, 4=group, 5=hardcore group). */
export const VARBIT_ACCOUNT_TYPE = 1777;

/**
 * Flashing side tab indicator.
 * 0 = none, otherwise (tabIndex + 1). Used by toplevel_sidebuttons_enable (%flashside - 1).
 * RuneLite: VarbitID.FLASHSIDE
 */
export const VARBIT_FLASHSIDE = 3756;

/**
 * Side journal tab backing varp for VARBIT_SIDE_JOURNAL_TAB.
 * Cache (OSRS rev 235): varbit 8168 -> baseVar 1141, bits 4..6.
 */
export const VARP_SIDE_JOURNAL_STATE = 1141;

/** Quick prayers enabled (0 = off, 1 = on) */
export const VARBIT_QUICK_PRAYERS = 4103;

/** Prayer tab filter: hide lower-tier prayers when higher-tier equivalents are available */
export const VARBIT_PRAYER_FILTER_BLOCK_LOW_TIER = 6574;

/** Prayer tab filter: show lower-tier prayers alongside combined/multi-skill tiers */
export const VARBIT_PRAYER_FILTER_ALLOW_COMBINED_TIER = 6575;

/** Prayer tab filter: hide Rapid Healing prayers */
export const VARBIT_PRAYER_FILTER_BLOCK_HEALING = 6576;

/** Prayer tab filter: hide prayers that require higher Prayer level */
export const VARBIT_PRAYER_FILTER_BLOCK_LACK_LEVEL = 6577;

/** Prayer tab filter: hide prayers that are locked by requirements */
export const VARBIT_PRAYER_FILTER_BLOCK_LOCKED = 6578;

/** Stamina potion effect active (0 = off, 1 = on) - used by run orb CS2 scripts */
export const VARBIT_STAMINA_ACTIVE = 25;

/** Combat level - used by combat_interface_setup CS2 script (combat styles tab) */
export const VARBIT_COMBATLEVEL_TRANSMIT = 13027;

/** Wilderness indicator - 1 when player is in the wilderness, 0 otherwise */
export const VARBIT_IN_WILDERNESS = 5963;

/** Multi-combat zone indicator - 1 when player is in a multi-combat zone, 0 otherwise */
export const VARBIT_MULTICOMBAT_AREA = 4605;

/** PvP spec orb - 1 when in PvP area (affects spec orb visibility), 0 otherwise */
export const VARBIT_PVP_SPEC_ORB = 8121;

/** Last Man Standing / Battle Royale in-game - 1 when in LMS match, 0 otherwise */
export const VARBIT_IN_LMS = 5314;

/** Inside raid instance - 1 when in a raid, 0 otherwise */
export const VARBIT_IN_RAID = 5432;

/** Raid state/progression - 0 = not started, >0 = raid progress */
export const VARBIT_RAID_STATE = 5425;

/** Deadman mode wilderness state - 1 when in deadman wilderness, 0 otherwise */
export const VARBIT_DEADMAN_IN_WILDERNESS = 5954;

/** Deadman protection timer remaining */
export const VARBIT_DEADMAN_PROTECTION_LEFT = 4965;

/** Tournament/Deadman multi-combat indicator */
export const VARBIT_TD_MULTIWAY_INDICATOR = 10960;

/**
 * XP drops toggle shown on the minimap orb (widget 160:6).
 * 0 = XP drops hidden ("Show"), 1 = XP drops visible ("Hide").
 */
export const VARBIT_XPDROPS_ENABLED = 4702;

/**
 * XP drops packed options varp.
 * Backing varp for position/size/duration/colour/grouping/counter/progress/speed varbits.
 */
export const VARP_XPDROPS_OPTIONS = 1227;

/**
 * XP drops setup UI state varp.
 * Backing varp for setup selection varbits (xpdrops_setup_skill/xpdrops_setup_type).
 */
export const VARP_XPDROPS_SETUP_STATE = 638;

/** XP drops tracker varp range (start/end values for per-skill and total trackers). */
export const XPDROPS_TRACKER_RANGE_START = 1228;
export const XPDROPS_TRACKER_RANGE_END = 1275;

/**
 * XP drops varps that must transmit from client to server for setup/tracker persistence.
 * 4964/4965 are sailing placeholders present in the cache/script namespace.
 */
export const XPDROPS_TRANSMIT_VARPS: readonly number[] = [
    VARP_XPDROPS_SETUP_STATE,
    VARP_XPDROPS_OPTIONS,
    ...Array.from(
        { length: XPDROPS_TRACKER_RANGE_END - XPDROPS_TRACKER_RANGE_START + 1 },
        (_, index) => XPDROPS_TRACKER_RANGE_START + index,
    ),
    4964, // xpdrops_sailing_start
    4965, // xpdrops_sailing_end
];

// ========== LEAGUE MODE VARBITS ==========

/**
 * League type varbit - determines which league is active.
 * Values: 1 = Twisted, 2 = Trailblazer, 3 = Shattered Relics, 4 = Trailblazer Reloaded, 5 = Raging Echoes
 */
export const VARBIT_LEAGUE_TYPE = 10032;

/**
 * League tutorial completed state.
 * Must be >= 3 for the league tab to appear in the side journal.
 */
export const VARBIT_LEAGUE_TUTORIAL_COMPLETED = 10037;

/** League area unlock varbits (10662-10667) - controls which areas are available */
export const VARBIT_LEAGUE_AREA_SELECTION_0 = 10662;
export const VARBIT_LEAGUE_AREA_SELECTION_1 = 10663;
export const VARBIT_LEAGUE_AREA_SELECTION_2 = 10664;
export const VARBIT_LEAGUE_AREA_SELECTION_3 = 10665;
export const VARBIT_LEAGUE_AREA_SELECTION_4 = 10666;
export const VARBIT_LEAGUE_AREA_SELECTION_5 = 10667;

/** League area last viewed (11693) - controls which area's details are shown */
export const VARBIT_LEAGUE_AREA_LAST_VIEWED = 11693;

/** Total league tasks completed - used for area unlock calculation */
export const VARBIT_LEAGUE_TOTAL_TASKS_COMPLETED = 10046;

/** League relic selection slots (8 total) */
export const VARBIT_LEAGUE_RELIC_1 = 10049;
export const VARBIT_LEAGUE_RELIC_2 = 10050;
export const VARBIT_LEAGUE_RELIC_3 = 10051;
export const VARBIT_LEAGUE_RELIC_4 = 10052;
export const VARBIT_LEAGUE_RELIC_5 = 10053;
export const VARBIT_LEAGUE_RELIC_6 = 11696;
export const VARBIT_LEAGUE_RELIC_7 = 17301;
export const VARBIT_LEAGUE_RELIC_8 = 17302;

/** League combat mastery levels */
export const VARBIT_LEAGUE_MELEE_MASTERY = 11580;
export const VARBIT_LEAGUE_RANGED_MASTERY = 11581;
export const VARBIT_LEAGUE_MAGIC_MASTERY = 11582;

/** League combat mastery points */
export const VARBIT_LEAGUE_MASTERY_POINTS_TO_SPEND = 11583;
export const VARBIT_LEAGUE_MASTERY_POINTS_EARNED = 11584;

// ========== LEAGUE MODE VARPS ==========

/** Core league state/type - non-zero enables league mode */
export const VARP_LEAGUE_GENERAL = 2606;

/** League relics data - triggers onVarTransmit for relic interface updates */
export const VARP_LEAGUE_RELICS = 2632;

/** Secondary league state */
export const VARP_LEAGUE_GENERAL_2 = 2805;

/** League points (currency) */
export const VARP_LEAGUE_POINTS_CURRENCY = 2613;

/** League points completed */
export const VARP_LEAGUE_POINTS_COMPLETED = 2614;

/** League points claimed */
export const VARP_LEAGUE_POINTS_CLAIMED = 2615;

/** Twisted League points */
export const VARP_LEAGUE_TWISTED_POINTS = 2771;

/** Trailblazer League points */
export const VARP_LEAGUE_TRAILBLAZER_POINTS = 2772;

/** Trailblazer Reloaded League points */
export const VARP_LEAGUE_TRAILBLAZER_RELOADED_POINTS = 4032;

/** Raging Echoes (League 5) points */
export const VARP_LEAGUE_5_POINTS = 4556;

/**
 * Map flags cached - contains world type flags.
 * Bit 29 clear + bit 30 set = league world.
 */
export const VARP_MAP_FLAGS_CACHED = 3717;

/** League world flag value for map_flags_cached (bit 30 set, bit 29 clear) */
export const MAP_FLAGS_LEAGUE_WORLD = 1 << 30;

/**
 * Feature flags cached varp (4920) — testbit() checked by CS2 proc feature_flag.
 * Bit 0 = unknown feature, bit 1 = leagues, bit 3 = bingo/orbs
 */
export const VARP_FEATURE_FLAGS_CACHED = 4920;

/** Feature flag bit 1: leagues (required for league_combat_mastery_active, etc.) */
export const FEATURE_FLAG_LEAGUES = 1 << 1;

// ========== TRANSMIT VARPS ==========
// Varps that should sync from client to server when changed

/**
 * Set of varp IDs that should be transmitted to the server when changed.
 * In OSRS, this is determined by the varp's transmit flag in the cache.
 */
export const TRANSMIT_VARPS: ReadonlySet<number> = new Set([
    VARP_OPTION_RUN, // Run toggle
    VARP_ATTACK_STYLE, // Combat attack style
    VARP_AUTO_RETALIATE, // Auto-retaliate toggle
    VARP_SPECIAL_ATTACK, // Special attack toggle
    VARP_SIDE_JOURNAL_STATE, // Side journal tab selection (drives IF_OPENSUB swap for 629:43)
    ...XPDROPS_TRANSMIT_VARPS, // XP drops setup/tracker persistence
    // Sound/music settings - transmit so server can persist them
    VARP_MUSIC_VOLUME, // Music volume (0-100)
    VARP_SOUND_EFFECTS_VOLUME, // Sound effects volume (0-100)
    VARP_AREA_SOUNDS_VOLUME, // Area sounds volume (0-100)
    VARP_MASTER_VOLUME, // Master volume (0-100)
    VARP_MUSICPLAY, // Music play mode (0=Area, 1=Shuffle, 2=Single)
    // Attack option settings - transmit so server can persist them
    VARP_OPTION_ATTACK_PRIORITY_PLAYER, // Player attack options (0-4)
    VARP_OPTION_ATTACK_PRIORITY_NPC, // NPC attack options (0-3)
]);

// ========== VARC (Client variables - not persisted) ==========

/** Player's combat level - used by account_summary_update_combatlevel CS2 script */
export const VARC_COMBAT_LEVEL = 52;

/** Active tab index in the side panel */
export const VARC_ACTIVE_TAB = 171;

// ========== SPELL UNLOCK VARPS ==========

/** Legend's Quest progress - required for Charge spell */
export const VARP_LEGENDS_QUEST = 139;

/** Underground Pass progress - required for Iban Blast */
export const VARP_UNDERGROUND_PASS = 161;

/** Mage Arena progress - required for god spells (Claws of Guthix, etc.) */
export const VARP_MAGE_ARENA = 267;

/** Desert Treasure progress - required for Ancient Magicks spellbook */
export const VARP_DESERT_TREASURE = 440;

/** Lunar Diplomacy progress - required for Lunar spellbook */
export const VARP_LUNAR_DIPLOMACY = 823;

// ========== SPELL UNLOCK VARBITS ==========

/** Arceuus house favor (0-1000 = 0-100%) */
export const VARBIT_ARCEUUS_FAVOR = 4896;

/** Arceuus spellbook unlocked flag */
export const VARBIT_ARCEUUS_SPELLBOOK_UNLOCKED = 9631;

/** Underground Pass - read Iban's book (unlocks Iban Blast) */
export const VARBIT_IBAN_BOOK_READ = 9133;

/** Mage Arena 2 progress */
export const VARBIT_MAGE_ARENA_2_PROGRESS = 6067;

/** Character summary account-age/time-played reveal toggle */
export const VARBIT_ACCOUNT_SUMMARY_DISPLAY_PLAYTIME = 12933;

/** Client of Kourend quest progress (0-9, 9 = complete) - unlocks Kourend Castle Teleport */
export const VARBIT_CLIENT_OF_KOUREND = 5619;

// ========== ROOF SETTINGS ==========

/**
 * Hide roofs toggle varbit.
 * 0 = show roofs normally, 1 = hide all roofs.
 * Controlled by settings modal toggle.
 */
export const VARBIT_ROOF_REMOVAL = 12378; // OSRS hide roofs varbit

// ========== TELEPORT SPELL UNLOCK VARPS ==========

/** Eadgar's Ruse quest progress - required for Trollheim Teleport */
export const VARP_EADGAR_QUEST = 335;

/** Watchtower quest progress - required for Watchtower Teleport */
export const VARP_WATCHTOWER = 212;

/** Biohazard quest progress - required for Ardougne Teleport */
export const VARP_BIOHAZARD = 68;

/** Plague City quest progress - prerequisite for Biohazard */
export const VARP_PLAGUE_CITY = 165;

// ========== SKILL GUIDE VARBITS ==========

/** Which skill guide is displayed (1-24 mapping to skills in this cache, including Sailing) */
export const VARBIT_SKILL_GUIDE_SKILL = 4371;

/** Sub-section within the skill guide (category tabs) */
export const VARBIT_SKILL_GUIDE_SUBSECTION = 4372;

// ========== AUTOCAST VARBITS ==========

/**
 * Is autocast enabled (0 = off, 1 = on).
 * Set when player selects a spell from autocast popup or spellbook autocast option.
 */
export const VARBIT_AUTOCAST_SET = 275;

/**
 * Which spell is set to autocast (1-58 spell index from enum_1986).
 * 0 = no spell selected.
 * Maps to spell IDs via AUTOCAST_INDEX_TO_SPELL_ID in spells.ts.
 */
export const VARBIT_AUTOCAST_SPELL = 276;

/**
 * Is defensive autocast mode enabled (0 = normal autocast, 1 = defensive autocast).
 * Defensive autocast gives Defence XP instead of Magic XP.
 */
export const VARBIT_AUTOCAST_DEFMODE = 2668;

// ========== AUTOCAST VARPS ==========

/**
 * Spellpos selector for autocast_setup CS2 script (235/2098).
 * For most staves this is -1. Special weapons use their item ID here
 * to select weapon-specific spell lists (e.g., Iban's staff, Ancient staff).
 */
export const VARP_AUTOCAST_SPELLPOS = 664;

// ========== SPELLBOOK ==========

/**
 * Active spellbook (0 = standard, 1 = ancient, 2 = lunar, 3 = arceuus).
 * Drives CS2 script 2610 (`MAGIC_SPELLBOOK_REDRAW`) to show the correct spellbook tab.
 */
export const VARBIT_ACTIVE_SPELLBOOK = 4070;

// ========== MUSIC UNLOCK VARBITS/VARPS ==========

/**
 * Music unlock message toggle varbit.
 * 0 = don't show unlock messages, 1 = show messages (default ON).
 * Controlled by widget 116:127 "Toggle unlock message" checkbox.
 */
export const VARBIT_MUSIC_UNLOCK_TEXT_TOGGLE = 10078;

/**
 * Music unlock tracking varps (musicmulti_1 through musicmulti_27).
 * Each varp is a 32-bit bitfield storing unlock status for up to 32 tracks.
 * Total capacity: 27 * 32 = 864 tracks.
 */
export const MUSIC_UNLOCK_VARPS = [
    20,
    21,
    22,
    23,
    24,
    25, // musicmulti_1-6
    298,
    311,
    346,
    414,
    464,
    598,
    662,
    721,
    906,
    1009,
    1338,
    1681,
    2065,
    2237,
    2950,
    3418,
    3575,
    4066,
    4411,
    4944,
    4945,
] as const;
