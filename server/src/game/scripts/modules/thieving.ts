import type { SkillPickpocketActionData } from "../../actions/skillActionPayloads";
import { type NpcInteractionEvent, type ScriptModule } from "../types";

// ---------------------------------------------------------------------------
// Thieving System
//
// Data-driven thieving module. Currently supports NPC pickpocketing.
// Each pickpocket definition specifies level, XP, loot table, stun
// duration, and damage on failure. The module registers "pickpocket"
// NPC interactions that queue a skill.pickpocket action through the
// action scheduler.
// ---------------------------------------------------------------------------

// -- Rarity weights (higher = more common) --
const ALWAYS = 256;
const COMMON = 256;
const UNCOMMON = 32;
const RARE = 8;
const VERY_RARE = 1;

// -- Loot table entry --
interface PickpocketLoot {
    itemId: number;
    minAmount: number;
    maxAmount: number;
    weight: number;
}

function loot(itemId: number, amount: number | [number, number], weight: number): PickpocketLoot {
    const [minAmount, maxAmount] = Array.isArray(amount) ? amount : [amount, amount];
    return { itemId, minAmount, maxAmount, weight };
}

// -- Pickpocket NPC definition --
export interface PickpocketNpcDef {
    npcIds: number[];
    reqLevel: number;
    xp: number;
    lootTable: PickpocketLoot[];
    coinPouchId?: number;
    minDamage: number;
    maxDamage: number;
    stunTicks: number;
    displayName?: string;
}

// ---------------------------------------------------------------------------
// Item IDs
// ---------------------------------------------------------------------------
const Items = {
    COINS_995: 995,
    POTATO_SEED: 5318,
    ONION_SEED: 5319,
    CABBAGE_SEED: 5324,
    TOMATO_SEED: 5322,
    SWEETCORN_SEED: 5320,
    STRAWBERRY_SEED: 5323,
    WATERMELON_SEED: 5321,
    BARLEY_SEED: 5305,
    HAMMERSTONE_SEED: 5307,
    ASGARNIAN_SEED: 5308,
    JUTE_SEED: 5306,
    YANILLIAN_SEED: 5309,
    KRANDORIAN_SEED: 5310,
    WILDBLOOD_SEED: 5311,
    MARIGOLD_SEED: 5096,
    NASTURTIUM_SEED: 5098,
    ROSEMARY_SEED: 5097,
    WOAD_SEED: 5099,
    LIMPWURT_SEED: 5100,
    REDBERRY_SEED: 5101,
    CADAVABERRY_SEED: 5102,
    DWELLBERRY_SEED: 5103,
    JANGERBERRY_SEED: 5104,
    WHITEBERRY_SEED: 5105,
    POISON_IVY_SEED: 5106,
    GUAM_SEED: 5291,
    MARRENTILL_SEED: 5292,
    TARROMIN_SEED: 5293,
    HARRALANDER_SEED: 5294,
    RANARR_SEED: 5295,
    TOADFLAX_SEED: 5296,
    IRIT_SEED: 5297,
    AVANTOE_SEED: 5298,
    KWUARM_SEED: 5299,
    SNAPDRAGON_SEED: 5300,
    CADANTINE_SEED: 5301,
    LANTADYME_SEED: 5302,
    DWARF_WEED_SEED: 5303,
    TORSTOL_SEED: 5304,
    MUSHROOM_SPORE: 5282,
    BELLADONNA_SEED: 5281,
    CACTUS_SEED: 5280,
    AIR_RUNE: 556,
    LOCKPICK: 1523,
    JUG_OF_WINE: 1993,
    GOLD_BAR: 2357,
    IRON_DAGGERP: 1219,
    CHAOS_RUNE: 562,
    DEATH_RUNE: 560,
    BLOOD_RUNE: 565,
    GOLD_ORE: 444,
    FIRE_ORB: 569,
    DIAMOND: 1601,
    EARTH_RUNE: 557,
    SWAMP_TOAD: 2150,
    KING_WORM: 2162,
    BREAD: 2309,
    ANTIPOISON3: 175,
    TOKKUL: 6529,
    UNCUT_SAPPHIRE: 1623,
    UNCUT_EMERALD: 1621,
    UNCUT_RUBY: 1619,
    UNCUT_DIAMOND: 1617,
    BRONZE_ARROW: 882,
    BRONZE_AXE: 1351,
    BRONZE_PICKAXE: 1265,
    IRON_AXE: 1349,
    IRON_DAGGER: 1203,
    IRON_PICKAXE: 1267,
    BUTTONS: 688,
    FEATHER: 314,
    KNIFE: 946,
    LOGS: 1511,
    NEEDLE: 1733,
    RAW_ANCHOVIES: 321,
    RAW_CHICKEN: 2138,
    THREAD: 1734,
    TINDERBOX: 590,
    UNCUT_OPAL: 1625,
    LEATHER_BODY: 1129,
    HAM_BOOTS: 4310,
    HAM_CLOAK: 4306,
    HAM_GLOVES: 4308,
    HAM_HOOD: 4302,
    HAM_LOGO: 4312,
    HAM_SHIRT: 4298,
    STEEL_ARROW: 886,
    STEEL_AXE: 1353,
    STEEL_DAGGER: 1207,
    STEEL_PICKAXE: 1269,
    CLUE_SCROLL_EASY: 2677,
    COAL: 453,
    COWHIDE: 1739,
    DAMAGED_ARMOUR: 4509,
    GRIMY_GUAM_LEAF: 199,
    GRIMY_MARRENTILL: 201,
    GRIMY_TARROMIN: 203,
    IRON_ORE: 440,
    RUSTY_SWORD: 686,
    UNCUT_JADE: 1627,
    BAT_SHISH: 10964,
    COATED_FROGS_LEGS: 10962,
    FINGERS: 10960,
    FROGBURGER: 10966,
    FROGSPAWN_GUMBO: 10970,
    GREEN_GLOOP_SOUP: 10968,
    BULLSEYE_LANTERN: 4550,
    CAVE_GOBLIN_WIRE: 4550, // TODO: verify correct item ID
    OIL_LANTERN: 4539,
    UNLIT_TORCH: 596,
};

// ---------------------------------------------------------------------------
// NPC Definitions
// ---------------------------------------------------------------------------
const PICKPOCKET_NPCS: PickpocketNpcDef[] = [
    {
        npcIds: [
            // Man (r237 cache-verified)
            3014, 3106, 3107, 3108, 3109, 3110, 3261, 3264, 3265, 3298, 3652, 6815, 6818,
            6987, 6988, 6989, 11057, 11058, 14920,
            // Woman (r237 cache-verified)
            3015, 3111, 3112, 3113, 3268, 3299, 6990, 6991, 6992, 10728, 11053, 11054, 14921,
        ],
        reqLevel: 1,
        xp: 8,
        lootTable: [loot(Items.COINS_995, 3, ALWAYS)],
        coinPouchId: 22521,
        minDamage: 1,
        maxDamage: 1,
        stunTicks: 8,
    },
    {
        // Farmer (r237 cache-verified)
        npcIds: [3114, 3243, 3244, 11918, 11919, 11920, 11921, 13228, 13229, 13230, 13231,
            13232, 13233, 13234, 13235, 14751, 14752, 14753, 14754, 14773],
        reqLevel: 10,
        xp: 14.5,
        lootTable: [
            loot(Items.COINS_995, 9, COMMON),
            loot(Items.POTATO_SEED, 1, RARE),
        ],
        coinPouchId: 22522,
        minDamage: 1,
        maxDamage: 1,
        stunTicks: 8,
        displayName: "Farmer",
    },
    {
        // HAM Female
        npcIds: [2541],
        reqLevel: 15,
        xp: 18.5,
        lootTable: [
            loot(Items.BRONZE_ARROW, [1, 15], COMMON),
            loot(Items.BRONZE_AXE, 1, COMMON),
            loot(Items.BRONZE_PICKAXE, 1, COMMON),
            loot(Items.IRON_AXE, 1, COMMON),
            loot(Items.IRON_DAGGER, 1, COMMON),
            loot(Items.IRON_PICKAXE, 1, COMMON),
            loot(Items.BUTTONS, 1, COMMON),
            loot(Items.COINS_995, [1, 21], COMMON),
            loot(Items.FEATHER, [1, 7], COMMON),
            loot(Items.KNIFE, 1, COMMON),
            loot(Items.LOGS, 1, COMMON),
            loot(Items.NEEDLE, 1, COMMON),
            loot(Items.RAW_ANCHOVIES, [1, 3], COMMON),
            loot(Items.RAW_CHICKEN, 1, COMMON),
            loot(Items.THREAD, [2, 10], COMMON),
            loot(Items.TINDERBOX, 1, COMMON),
            loot(Items.UNCUT_OPAL, 1, COMMON),
            loot(Items.LEATHER_BODY, 1, UNCOMMON),
            loot(Items.HAM_BOOTS, 1, UNCOMMON),
            loot(Items.HAM_CLOAK, 1, UNCOMMON),
            loot(Items.HAM_GLOVES, 1, UNCOMMON),
            loot(Items.HAM_HOOD, 1, UNCOMMON),
            loot(Items.HAM_LOGO, 1, UNCOMMON),
            loot(Items.HAM_SHIRT, 1, UNCOMMON),
            loot(Items.STEEL_ARROW, [1, 13], UNCOMMON),
            loot(Items.STEEL_AXE, 1, UNCOMMON),
            loot(Items.STEEL_DAGGER, 1, UNCOMMON),
            loot(Items.STEEL_PICKAXE, 1, UNCOMMON),
            loot(Items.CLUE_SCROLL_EASY, 1, UNCOMMON),
            loot(Items.COAL, 1, UNCOMMON),
            loot(Items.COWHIDE, 1, UNCOMMON),
            loot(Items.DAMAGED_ARMOUR, 1, UNCOMMON),
            loot(Items.GRIMY_GUAM_LEAF, 1, UNCOMMON),
            loot(Items.GRIMY_MARRENTILL, 1, UNCOMMON),
            loot(Items.GRIMY_TARROMIN, 1, UNCOMMON),
            loot(Items.IRON_ORE, 1, UNCOMMON),
            loot(Items.RUSTY_SWORD, 1, UNCOMMON),
            loot(Items.UNCUT_JADE, 1, UNCOMMON),
        ],
        minDamage: 1,
        maxDamage: 3,
        stunTicks: 6,
    },
    {
        // HAM Male
        npcIds: [2540],
        reqLevel: 20,
        xp: 22.5,
        lootTable: [
            loot(Items.BRONZE_ARROW, [1, 15], COMMON),
            loot(Items.BRONZE_AXE, 1, COMMON),
            loot(Items.BRONZE_PICKAXE, 1, COMMON),
            loot(Items.IRON_AXE, 1, COMMON),
            loot(Items.IRON_DAGGER, 1, COMMON),
            loot(Items.IRON_PICKAXE, 1, COMMON),
            loot(Items.BUTTONS, 1, COMMON),
            loot(Items.COINS_995, [1, 21], COMMON),
            loot(Items.FEATHER, [1, 7], COMMON),
            loot(Items.KNIFE, 1, COMMON),
            loot(Items.LOGS, 1, COMMON),
            loot(Items.NEEDLE, 1, COMMON),
            loot(Items.RAW_ANCHOVIES, [1, 3], COMMON),
            loot(Items.RAW_CHICKEN, 1, COMMON),
            loot(Items.THREAD, [2, 10], COMMON),
            loot(Items.TINDERBOX, 1, COMMON),
            loot(Items.UNCUT_OPAL, 1, COMMON),
            loot(Items.LEATHER_BODY, 1, UNCOMMON),
            loot(Items.HAM_BOOTS, 1, UNCOMMON),
            loot(Items.HAM_CLOAK, 1, UNCOMMON),
            loot(Items.HAM_GLOVES, 1, UNCOMMON),
            loot(Items.HAM_HOOD, 1, UNCOMMON),
            loot(Items.HAM_LOGO, 1, UNCOMMON),
            loot(Items.HAM_SHIRT, 1, UNCOMMON),
            loot(Items.STEEL_ARROW, [1, 13], UNCOMMON),
            loot(Items.STEEL_AXE, 1, UNCOMMON),
            loot(Items.STEEL_DAGGER, 1, UNCOMMON),
            loot(Items.STEEL_PICKAXE, 1, UNCOMMON),
            loot(Items.CLUE_SCROLL_EASY, 1, UNCOMMON),
            loot(Items.COAL, 1, UNCOMMON),
            loot(Items.COWHIDE, 1, UNCOMMON),
            loot(Items.DAMAGED_ARMOUR, 1, UNCOMMON),
            loot(Items.GRIMY_GUAM_LEAF, 1, UNCOMMON),
            loot(Items.GRIMY_MARRENTILL, 1, UNCOMMON),
            loot(Items.GRIMY_TARROMIN, 1, UNCOMMON),
            loot(Items.IRON_ORE, 1, UNCOMMON),
            loot(Items.RUSTY_SWORD, 1, UNCOMMON),
            loot(Items.UNCUT_JADE, 1, UNCOMMON),
        ],
        minDamage: 1,
        maxDamage: 3,
        stunTicks: 6,
    },
    {
        // Al-Kharid Warrior (r237 cache-verified)
        npcIds: [3292],
        reqLevel: 25,
        xp: 26,
        lootTable: [loot(Items.COINS_995, 18, ALWAYS)],
        coinPouchId: 22523,
        minDamage: 2,
        maxDamage: 2,
        stunTicks: 8,
    },
    {
        // Rogue (r237 cache-verified)
        npcIds: [526],
        reqLevel: 32,
        xp: 35.5,
        lootTable: [
            loot(Items.COINS_995, [25, 120], COMMON),
            loot(Items.AIR_RUNE, 8, COMMON),
            loot(Items.LOCKPICK, 1, VERY_RARE),
            loot(Items.JUG_OF_WINE, 1, UNCOMMON),
            loot(Items.GOLD_BAR, 1, RARE),
            loot(Items.IRON_DAGGERP, 1, RARE),
        ],
        coinPouchId: 22524,
        minDamage: 2,
        maxDamage: 2,
        stunTicks: 8,
    },
    {
        // Cave Goblin
        npcIds: [
            2268, 2269, 2270, 2271, 2272, 2273, 2274, 2275, 2276, 2277, 2278, 2279, 2280, 2281,
            2282, 2283, 2284, 2285,
        ],
        reqLevel: 36,
        xp: 40,
        lootTable: [
            loot(Items.BAT_SHISH, 1, COMMON),
            loot(Items.COATED_FROGS_LEGS, 1, COMMON),
            loot(Items.FINGERS, 1, COMMON),
            loot(Items.FROGBURGER, 1, COMMON),
            loot(Items.FROGSPAWN_GUMBO, 1, COMMON),
            loot(Items.GREEN_GLOOP_SOUP, 1, COMMON),
            loot(Items.COINS_995, [11, 48], UNCOMMON),
            loot(Items.BULLSEYE_LANTERN, 1, UNCOMMON),
            loot(Items.IRON_ORE, [1, 4], UNCOMMON),
            loot(Items.OIL_LANTERN, 1, UNCOMMON),
            loot(Items.TINDERBOX, 1, COMMON),
            loot(Items.UNLIT_TORCH, 1, RARE),
        ],
        minDamage: 1,
        maxDamage: 1,
        stunTicks: 8,
    },
    {
        // Master Farmer (r237 cache-verified)
        npcIds: [5730, 5731, 5832, 11940, 11941, 13236, 13237, 13238, 13239, 13240, 13241,
            13242, 13243, 14755, 14756, 14757, 14758],
        reqLevel: 38,
        xp: 43,
        lootTable: [
            loot(Items.POTATO_SEED, [1, 4], COMMON),
            loot(Items.ONION_SEED, [1, 3], COMMON),
            loot(Items.CABBAGE_SEED, [1, 3], COMMON),
            loot(Items.TOMATO_SEED, [1, 2], COMMON),
            loot(Items.SWEETCORN_SEED, [1, 2], UNCOMMON),
            loot(Items.STRAWBERRY_SEED, 1, UNCOMMON),
            loot(Items.WATERMELON_SEED, 1, RARE),
            loot(Items.BARLEY_SEED, [1, 4], COMMON),
            loot(Items.HAMMERSTONE_SEED, [1, 3], COMMON),
            loot(Items.ASGARNIAN_SEED, [1, 2], COMMON),
            loot(Items.JUTE_SEED, [1, 3], COMMON),
            loot(Items.YANILLIAN_SEED, [1, 2], UNCOMMON),
            loot(Items.KRANDORIAN_SEED, 1, UNCOMMON),
            loot(Items.WILDBLOOD_SEED, 1, RARE),
            loot(Items.MARIGOLD_SEED, 1, COMMON),
            loot(Items.NASTURTIUM_SEED, 1, UNCOMMON),
            loot(Items.ROSEMARY_SEED, 1, UNCOMMON),
            loot(Items.WOAD_SEED, 1, UNCOMMON),
            loot(Items.LIMPWURT_SEED, 1, UNCOMMON),
            loot(Items.REDBERRY_SEED, 1, COMMON),
            loot(Items.CADAVABERRY_SEED, 1, UNCOMMON),
            loot(Items.DWELLBERRY_SEED, 1, UNCOMMON),
            loot(Items.JANGERBERRY_SEED, 1, RARE),
            loot(Items.WHITEBERRY_SEED, 1, RARE),
            loot(Items.POISON_IVY_SEED, 1, RARE),
            loot(Items.GUAM_SEED, 1, UNCOMMON),
            loot(Items.MARRENTILL_SEED, 1, UNCOMMON),
            loot(Items.TARROMIN_SEED, 1, RARE),
            loot(Items.HARRALANDER_SEED, 1, RARE),
            loot(Items.RANARR_SEED, 1, RARE),
            loot(Items.TOADFLAX_SEED, 1, RARE),
            loot(Items.IRIT_SEED, 1, RARE),
            loot(Items.AVANTOE_SEED, 1, RARE),
            loot(Items.KWUARM_SEED, 1, VERY_RARE),
            loot(Items.SNAPDRAGON_SEED, 1, VERY_RARE),
            loot(Items.CADANTINE_SEED, 1, VERY_RARE),
            loot(Items.LANTADYME_SEED, 1, VERY_RARE),
            loot(Items.DWARF_WEED_SEED, 1, VERY_RARE),
            loot(Items.TORSTOL_SEED, 1, VERY_RARE),
            loot(Items.MUSHROOM_SPORE, 1, RARE),
            loot(Items.BELLADONNA_SEED, 1, RARE),
            loot(Items.CACTUS_SEED, 1, VERY_RARE),
        ],
        minDamage: 3,
        maxDamage: 3,
        stunTicks: 8,
        displayName: "Master Farmer",
    },
    {
        // Guard (r237 cache-verified)
        npcIds: [397, 398, 399, 400, 1546, 1547, 1548, 1549, 1550, 3010, 3011, 3254, 3269,
            3270, 3271, 3272, 3273, 3274, 3283, 4522, 4523, 4524, 4525, 4526, 5418, 11092,
            11094, 11096, 11098, 11100, 11102, 11104, 11106, 11911, 11912, 11913, 11914,
            11915, 11916, 11917, 11922, 11923, 11924, 11937, 11938, 11939, 11942, 11943,
            11944, 11945, 11946, 11947, 13100, 13101, 13102, 13103, 13104, 13105, 13106,
            13107, 13108, 13109, 13986, 13987, 13988, 13989, 13990, 13991, 13992, 13993,
            13994, 13995, 14663, 14664, 14665, 14666, 14667, 14668, 14669, 14670, 14716,
            14717, 14718, 14719, 14720, 14721, 14722, 14723, 14887, 14888, 14889, 14890],
        reqLevel: 40,
        xp: 46.8,
        lootTable: [loot(Items.COINS_995, 30, ALWAYS)],
        coinPouchId: 22525,
        minDamage: 2,
        maxDamage: 2,
        stunTicks: 8,
    },
    {
        // Fremennik Citizens (r237 cache-verified)
        npcIds: [3937, 3938, 3939, 3940, 3941, 3943, 3944, 3945, 3946],
        reqLevel: 45,
        xp: 65,
        lootTable: [loot(Items.COINS_995, 40, ALWAYS)],
        coinPouchId: 22526,
        minDamage: 2,
        maxDamage: 2,
        stunTicks: 8,
        displayName: "Fremennik",
    },
    {
        // Bearded Pollnivian Bandit
        npcIds: [736, 737],
        reqLevel: 45,
        xp: 65,
        lootTable: [loot(Items.COINS_995, 40, ALWAYS)],
        coinPouchId: 22527,
        minDamage: 5,
        maxDamage: 5,
        stunTicks: 8,
    },
    {
        // Desert Bandit
        npcIds: [690, 695],
        reqLevel: 53,
        xp: 79.5,
        lootTable: [
            loot(Items.COINS_995, 30, COMMON),
            loot(Items.ANTIPOISON3, 1, COMMON),
            loot(Items.LOCKPICK, 1, COMMON),
        ],
        coinPouchId: 22528,
        minDamage: 3,
        maxDamage: 3,
        stunTicks: 8,
    },
    {
        // Knight of Ardougne (r237 cache-verified)
        npcIds: [3297, 3300, 8854, 11902, 11936],
        reqLevel: 55,
        xp: 84.3,
        lootTable: [loot(Items.COINS_995, 50, ALWAYS)],
        coinPouchId: 22529,
        minDamage: 3,
        maxDamage: 3,
        stunTicks: 8,
    },
    {
        // Pollnivian Bandit
        npcIds: [734, 735],
        reqLevel: 55,
        xp: 84.3,
        lootTable: [loot(Items.COINS_995, 50, ALWAYS)],
        coinPouchId: 22530,
        minDamage: 5,
        maxDamage: 5,
        stunTicks: 8,
    },
    {
        // Yanille Watchman (r237 cache-verified)
        npcIds: [5420],
        reqLevel: 65,
        xp: 137.5,
        lootTable: [
            loot(Items.COINS_995, 60, UNCOMMON),
            loot(Items.BREAD, 1, COMMON),
        ],
        coinPouchId: 22531,
        minDamage: 3,
        maxDamage: 3,
        stunTicks: 8,
    },
    {
        // Menaphite Thug
        npcIds: [3550],
        reqLevel: 65,
        xp: 137.5,
        lootTable: [loot(Items.COINS_995, 60, ALWAYS)],
        coinPouchId: 22532,
        minDamage: 5,
        maxDamage: 5,
        stunTicks: 8,
    },
    {
        // Paladin (r237 cache-verified)
        npcIds: [3293, 3294, 8853, 11901, 11930, 11931, 11932, 11933],
        reqLevel: 70,
        xp: 151.75,
        lootTable: [
            loot(Items.COINS_995, 80, UNCOMMON),
            loot(Items.CHAOS_RUNE, 2, COMMON),
        ],
        coinPouchId: 22533,
        minDamage: 3,
        maxDamage: 3,
        stunTicks: 8,
    },
    {
        // Gnome
        npcIds: [5130, 6077, 6078, 6079, 6086, 6087, 6094, 6095, 6096],
        reqLevel: 75,
        xp: 198.5,
        lootTable: [
            loot(Items.COINS_995, 300, COMMON),
            loot(Items.EARTH_RUNE, 1, COMMON),
            loot(Items.GOLD_ORE, 1, COMMON),
            loot(Items.FIRE_ORB, 1, COMMON),
            loot(Items.SWAMP_TOAD, 1, COMMON),
            loot(Items.KING_WORM, 1, COMMON),
        ],
        coinPouchId: 22534,
        minDamage: 1,
        maxDamage: 1,
        stunTicks: 8,
    },
    {
        // Hero (r237 cache-verified)
        npcIds: [3295, 11934, 11935],
        reqLevel: 80,
        xp: 275,
        lootTable: [
            loot(Items.COINS_995, [200, 300], COMMON),
            loot(Items.DEATH_RUNE, 2, UNCOMMON),
            loot(Items.BLOOD_RUNE, 1, UNCOMMON),
            loot(Items.GOLD_ORE, 1, UNCOMMON),
            loot(Items.JUG_OF_WINE, 1, UNCOMMON),
            loot(Items.FIRE_ORB, 1, UNCOMMON),
            loot(Items.DIAMOND, 1, UNCOMMON),
        ],
        coinPouchId: 22535,
        minDamage: 4,
        maxDamage: 4,
        stunTicks: 10,
    },
    {
        // TzHaar-Hur
        npcIds: [7682, 7683, 7684, 7685, 7686, 7687],
        reqLevel: 90,
        xp: 103.5,
        lootTable: [
            loot(Items.TOKKUL, [3, 14], COMMON),
            loot(Items.UNCUT_SAPPHIRE, 1, COMMON),
            loot(Items.UNCUT_EMERALD, 1, COMMON),
            loot(Items.UNCUT_RUBY, 1, COMMON),
            loot(Items.UNCUT_DIAMOND, 1, COMMON),
        ],
        coinPouchId: 22536,
        minDamage: 4,
        maxDamage: 4,
        stunTicks: 8,
    },
];

// Build a fast NPC ID → definition lookup.
const npcIdToPickpocketDef = new Map<number, PickpocketNpcDef>();
for (const def of PICKPOCKET_NPCS) {
    for (const id of def.npcIds) {
        npcIdToPickpocketDef.set(id, def);
    }
}

// -- Coin pouch definitions --
// Maps pouch item ID → [minCoins, maxCoins] per open.
const COIN_POUCH_VALUES: Record<number, [number, number]> = {
    22521: [3, 3],        // Man/Woman
    22522: [9, 9],        // Farmer
    22523: [18, 18],      // Al-Kharid Warrior
    22524: [25, 120],     // Rogue
    22525: [30, 30],      // Guard
    22526: [40, 40],      // Fremennik
    22527: [40, 40],      // Bearded Pollnivian Bandit
    22528: [30, 30],      // Desert Bandit
    22529: [50, 50],      // Knight of Ardougne
    22530: [50, 50],      // Pollnivian Bandit
    22531: [60, 60],      // Watchman
    22532: [60, 60],      // Menaphite Thug
    22533: [80, 80],      // Paladin
    22534: [300, 300],    // Gnome
    22535: [200, 300],    // Hero
    22536: [3, 14],       // TzHaar-Hur (tokkul, not coins — uses item 6529)
};

const COIN_POUCH_IDS = new Set(Object.keys(COIN_POUCH_VALUES).map(Number));
const TOKKUL_POUCH_ID = 22536;
const TOKKUL_ITEM_ID = 6529;
const MAX_COIN_POUCHES = 28;

export { npcIdToPickpocketDef, PICKPOCKET_NPCS };

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

export const thievingModule: ScriptModule = {
    id: "skills.thieving",
    register(registry, _services) {
        for (const def of PICKPOCKET_NPCS) {
            for (const npcId of def.npcIds) {
                registry.registerNpcInteraction(
                    npcId,
                    (event: NpcInteractionEvent) => {
                        const { player, npc, services, tick } = event;

                        const actionData: SkillPickpocketActionData = {
                            npcId: npc.id,
                            npcTypeId: npc.typeId,
                            reqLevel: def.reqLevel,
                            xp: def.xp,
                            lootTable: def.lootTable,
                            coinPouchId: def.coinPouchId,
                            minDamage: def.minDamage,
                            maxDamage: def.maxDamage,
                            stunTicks: def.stunTicks,
                            displayName: def.displayName,
                            phase: 0,
                        };

                        services.requestAction(
                            player,
                            {
                                kind: "skill.pickpocket",
                                data: actionData,
                                delayTicks: 0,
                                cooldownTicks: 0,
                                groups: ["skill.pickpocket"],
                            },
                            tick,
                        );
                    },
                    "pickpocket",
                );
            }
        }

        // Coin pouch: "Open" and "Open-all" item actions
        for (const pouchId of COIN_POUCH_IDS) {
            const openHandler = (event: import("../types").ItemOnItemEvent, openAll: boolean) => {
                const { player, source, services } = event;
                const slot = source.slot;
                const inv = services.getInventoryItems(player);
                const entry = inv[slot];
                if (!entry || entry.itemId !== pouchId) return;

                const count = openAll ? entry.quantity : 1;
                const range = COIN_POUCH_VALUES[pouchId];
                if (!range) return;

                const isTokkul = pouchId === TOKKUL_POUCH_ID;
                const currencyId = isTokkul ? TOKKUL_ITEM_ID : Items.COINS_995;

                let totalCurrency = 0;
                for (let i = 0; i < count; i++) {
                    const [min, max] = range;
                    totalCurrency += min === max
                        ? min
                        : min + Math.floor(Math.random() * (max - min + 1));
                }

                const remaining = entry.quantity - count;
                if (remaining > 0) {
                    services.setInventorySlot(player, slot, pouchId, remaining);
                } else {
                    services.setInventorySlot(player, slot, -1, 0);
                }

                services.addItemToInventory(player, currencyId, totalCurrency);
                services.snapshotInventory(player);
                services.sendGameMessage(
                    player,
                    isTokkul
                        ? `You open the coin pouch and receive ${totalCurrency} Tokkul.`
                        : `You open the coin pouch and receive ${totalCurrency} coins.`,
                );
            };

            registry.registerItemAction(pouchId, (event) => openHandler(event, true), "open-all");
            registry.registerItemAction(pouchId, (event) => openHandler(event, false), "open");
        }
    },
};
