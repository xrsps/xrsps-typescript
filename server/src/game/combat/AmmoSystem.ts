/**
 * Ammunition System
 *
 * OSRS-accurate ammunition handling:
 * - Bow/crossbow + ammo compatibility
 * - Ammo consumption on attack
 * - Ammo drop/break mechanics
 * - Ava's devices (accumulator, assembler)
 * - Enchanted bolt effects
 *
 * Reference: RSMod RangedCombatStrategy, OSRS Wiki
 */
import { EquipmentSlot } from "../../../../client/rs/config/player/Equipment";
import { getProviderRegistry } from "../providers/ProviderRegistry";
import type { AmmoDataProvider } from "./AmmoDataProvider";

// =============================================================================
// Item ID Constants
// =============================================================================

// Bows
const SHORTBOW = 841;
const LONGBOW = 839;
const OAK_SHORTBOW = 843;
const OAK_LONGBOW = 845;
const WILLOW_SHORTBOW = 849;
const WILLOW_LONGBOW = 847;
const MAPLE_SHORTBOW = 853;
const MAPLE_LONGBOW = 851;
const YEW_SHORTBOW = 857;
const YEW_LONGBOW = 855;
const MAGIC_SHORTBOW = 861;
const MAGIC_SHORTBOW_I = 12788;
const MAGIC_LONGBOW = 859;
const MAGIC_COMP_BOW = 10284;
const DARK_BOW = 11235;
const DARK_BOW_GREEN = 12765;
const DARK_BOW_BLUE = 12766;
const DARK_BOW_YELLOW = 12767;
const DARK_BOW_WHITE = 12768;
const TWISTED_BOW = 20997;
// Crystal bow variants (4212=new, 4214=full, 4215-4223=degraded 9/10 to 1/10)
const CRYSTAL_BOW_NEW = 4212;
const CRYSTAL_BOW_FULL = 4214;
const CRYSTAL_BOW_9 = 4215;
const CRYSTAL_BOW_8 = 4216;
const CRYSTAL_BOW_7 = 4217;
const CRYSTAL_BOW_6 = 4218;
const CRYSTAL_BOW_5 = 4219;
const CRYSTAL_BOW_4 = 4220;
const CRYSTAL_BOW_3 = 4221;
const CRYSTAL_BOW_2 = 4222;
const CRYSTAL_BOW_1 = 4223;
// Newer crystal bow variants
const CRYSTAL_BOW_23983 = 23983;
const CRYSTAL_BOW_24123 = 24123;
const BOW_OF_FAERDHINEN = 25862;
const CRAW_BOW = 22550;
const WEBWEAVER_BOW = 27655;

// Crossbows
const BRONZE_CROSSBOW = 9174;
const IRON_CROSSBOW = 9177;
const STEEL_CROSSBOW = 9179;
const MITHRIL_CROSSBOW = 9181;
const ADAMANT_CROSSBOW = 9183;
const RUNE_CROSSBOW = 9185;
const DRAGON_CROSSBOW = 21902;
const ARMADYL_CROSSBOW = 11785;
const ZARYTE_CROSSBOW = 26374;
const DRAGON_HUNTER_CROSSBOW = 21012;
const KARIL_CROSSBOW = 4734;
const BOLT_RACKS = 4740;

// Ballistae
const LIGHT_BALLISTA = 19478;
const LIGHT_BALLISTA_LMS = 27188;
const HEAVY_BALLISTA = 19481;
const HEAVY_BALLISTA_LMS = 23630;
const HEAVY_BALLISTA_OR = 26712;

// Thrown weapons (don't need ammo)
const BRONZE_KNIFE = 864;
const IRON_KNIFE = 863;
const STEEL_KNIFE = 865;
const BLACK_KNIFE = 869;
const MITHRIL_KNIFE = 866;
const ADAMANT_KNIFE = 867;
const RUNE_KNIFE = 868;
const DRAGON_KNIFE = 22804;
const DRAGON_KNIFE_P = 22806;
const DRAGON_KNIFE_P_PLUS = 22808;
const DRAGON_KNIFE_P_PLUS_PLUS = 22810;

const BRONZE_DART = 806;
const IRON_DART = 807;
const STEEL_DART = 808;
const BLACK_DART = 3093;
const MITHRIL_DART = 809;
const ADAMANT_DART = 810;
const RUNE_DART = 811;
const DRAGON_DART = 11230;

const BRONZE_THROWNAXE = 800;
const IRON_THROWNAXE = 801;
const STEEL_THROWNAXE = 802;
const MITHRIL_THROWNAXE = 803;
const ADAMANT_THROWNAXE = 804;
const RUNE_THROWNAXE = 805;
const DRAGON_THROWNAXE = 20849;

const TOKTZ_XIL_UL = 6522; // Obsidian throwing rings

// Blowpipe
const TOXIC_BLOWPIPE = 12926;
const ROSEWOOD_BLOWPIPE = 31586;

// Chinchompas
const GREY_CHINCHOMPA = 10033;
const RED_CHINCHOMPA = 10034;
const BLACK_CHINCHOMPA = 11959;

// Ava's Devices
const AVAS_ATTRACTOR = 10498;
const AVAS_ACCUMULATOR = 10499;
const AVAS_ASSEMBLER = 22109;
const MASORI_ASSEMBLER = 27374; // Max version
const RANGING_CAPE = 9756;
const RANGING_CAPE_T = 9757;
const MAX_CAPE = 13342; // With ranging cape perk

// Arrows
const BRONZE_ARROW = 882;
const IRON_ARROW = 884;
const STEEL_ARROW = 886;
const MITHRIL_ARROW = 888;
const ADAMANT_ARROW = 890;
const RUNE_ARROW = 892;
const AMETHYST_ARROW = 21326;
const DRAGON_ARROW = 11212;
const DRAGON_ARROW_P = 11227;
const DRAGON_ARROW_P_PLUS = 11228;
const DRAGON_ARROW_P_PLUS_PLUS = 11229;
const BROAD_ARROWS = 4160;

// Bolts
const BRONZE_BOLTS = 877;
const IRON_BOLTS = 9140;
const STEEL_BOLTS = 9141;
const MITHRIL_BOLTS = 9142;
const ADAMANT_BOLTS = 9143;
const RUNITE_BOLTS = 9144;
const DRAGON_BOLTS = 21905;
const BROAD_BOLTS = 11875;

// Enchanted bolts
const OPAL_BOLTS_E = 9236;
const JADE_BOLTS_E = 9237;
const PEARL_BOLTS_E = 9238;
const TOPAZ_BOLTS_E = 9239;
const SAPPHIRE_BOLTS_E = 9240;
const EMERALD_BOLTS_E = 9241;
const RUBY_BOLTS_E = 9242;
const DIAMOND_BOLTS_E = 9243;
const DRAGONSTONE_BOLTS_E = 9244;
const ONYX_BOLTS_E = 9245;

const RUBY_DRAGON_BOLTS_E = 21944;
const DIAMOND_DRAGON_BOLTS_E = 21946;
const DRAGONSTONE_DRAGON_BOLTS_E = 21948;
const ONYX_DRAGON_BOLTS_E = 21950;

// Javelins
const BRONZE_JAVELIN = 825;
const BRONZE_JAVELIN_P = 831;
const BRONZE_JAVELIN_P_PLUS = 5642;
const BRONZE_JAVELIN_P_PLUS_PLUS = 5648;
const IRON_JAVELIN = 826;
const IRON_JAVELIN_P = 832;
const IRON_JAVELIN_P_PLUS = 5643;
const IRON_JAVELIN_P_PLUS_PLUS = 5649;
const STEEL_JAVELIN = 827;
const STEEL_JAVELIN_P = 833;
const STEEL_JAVELIN_P_PLUS = 5644;
const STEEL_JAVELIN_P_PLUS_PLUS = 5650;
const MITHRIL_JAVELIN = 828;
const MITHRIL_JAVELIN_P = 834;
const MITHRIL_JAVELIN_P_PLUS = 5645;
const MITHRIL_JAVELIN_P_PLUS_PLUS = 5651;
const ADAMANT_JAVELIN = 829;
const ADAMANT_JAVELIN_P = 835;
const ADAMANT_JAVELIN_P_PLUS = 5646;
const ADAMANT_JAVELIN_P_PLUS_PLUS = 5652;
const RUNE_JAVELIN = 830;
const RUNE_JAVELIN_P = 836;
const RUNE_JAVELIN_P_PLUS = 5647;
const RUNE_JAVELIN_P_PLUS_PLUS = 5653;
const AMETHYST_JAVELIN = 21318;
const AMETHYST_JAVELIN_P = 21320;
const AMETHYST_JAVELIN_P_PLUS = 21322;
const AMETHYST_JAVELIN_P_PLUS_PLUS = 21324;
const DRAGON_JAVELIN = 19484;
const DRAGON_JAVELIN_P = 19486;
const DRAGON_JAVELIN_P_PLUS = 19488;
const DRAGON_JAVELIN_P_PLUS_PLUS = 19490;
const DRAGON_JAVELIN_LMS = 23648;

// =============================================================================
// Types
// =============================================================================

export const AmmoType = {
    Arrow: "arrow",
    Bolt: "bolt",
    Javelin: "javelin",
    Thrown: "thrown",
    Chinchompa: "chinchompa",
    None: "none",
} as const;
export type AmmoType = (typeof AmmoType)[keyof typeof AmmoType];

export interface ArrowVisual {
    launchGraphicId: number;
    projectileId: number;
}

export const ARROW_LAUNCH_DELAY_TICKS = 40 / 30;
export const ARROW_TRAVEL_TIME_TICKS = 17 / 30;

// Elvarg's ammunition visuals, plus the matching modern-cache amethyst pair.
const ARROW_VISUALS = new Map<number, ArrowVisual>([
    [BRONZE_ARROW, { launchGraphicId: 19, projectileId: 10 }],
    [IRON_ARROW, { launchGraphicId: 18, projectileId: 9 }],
    [STEEL_ARROW, { launchGraphicId: 20, projectileId: 11 }],
    [MITHRIL_ARROW, { launchGraphicId: 21, projectileId: 12 }],
    [ADAMANT_ARROW, { launchGraphicId: 22, projectileId: 13 }],
    [RUNE_ARROW, { launchGraphicId: 24, projectileId: 15 }],
    [BROAD_ARROWS, { launchGraphicId: 20, projectileId: 11 }],
    [AMETHYST_ARROW, { launchGraphicId: 1385, projectileId: 1384 }],
    [DRAGON_ARROW, { launchGraphicId: 1111, projectileId: 1120 }],
    [DRAGON_ARROW_P, { launchGraphicId: 1111, projectileId: 1120 }],
    [DRAGON_ARROW_P_PLUS, { launchGraphicId: 1111, projectileId: 1120 }],
    [DRAGON_ARROW_P_PLUS_PLUS, { launchGraphicId: 1111, projectileId: 1120 }],
]);

export function getArrowVisual(ammoId: number): ArrowVisual | undefined {
    return ARROW_VISUALS.get(Math.trunc(ammoId));
}

export const BoltEffectType = {
    DamageBoost: "damage_boost",
    HpDrain: "hp_drain",
    DefenseDrain: "defense_drain",
    Lightning: "lightning",
    Poison: "poison",
    Heal: "heal",
    LifeLeech: "life_leech",
    MagicDrain: "magic_drain",
} as const;
export type BoltEffectType = (typeof BoltEffectType)[keyof typeof BoltEffectType];

export const AvasDeviceType = {
    Assembler: "assembler",
    Accumulator: "accumulator",
    Attractor: "attractor",
} as const;
export type AvasDeviceType = (typeof AvasDeviceType)[keyof typeof AvasDeviceType];

export interface AmmoRequirement {
    ammoType: AmmoType;
    minLevel: number;
    validAmmoIds: number[];
}

export interface AmmoConsumptionResult {
    consumed: boolean;
    ammoId: number;
    quantityUsed: number;
    dropped: boolean;
    /** Number of consumed projectiles that should appear on the ground. */
    dropQuantity?: number;
    dropTileX?: number;
    dropTileY?: number;
    broke: boolean;
    error?: string;
}

export interface EnchantedBoltEffect {
    name: string;
    /** Activation chance as decimal (0.0 - 1.0) */
    activationChance: number;
    /** Whether Kandarin hard diary doubles activation chance */
    kandarinBoost: boolean;
    effectType: BoltEffectType;
    /** Damage multiplier or flat bonus */
    damageMultiplier?: number;
    flatDamageBonus?: number;
    /** Life leech percentage */
    leechPercent?: number;
    /** Self damage percentage for ruby bolts */
    selfDamagePercent?: number;
    /** Graphic ID on hit */
    graphicId?: number;
}

// =============================================================================
// Weapon Classifications
// =============================================================================

const BOW_WEAPONS = new Set([
    SHORTBOW,
    LONGBOW,
    OAK_SHORTBOW,
    OAK_LONGBOW,
    WILLOW_SHORTBOW,
    WILLOW_LONGBOW,
    MAPLE_SHORTBOW,
    MAPLE_LONGBOW,
    YEW_SHORTBOW,
    YEW_LONGBOW,
    MAGIC_SHORTBOW,
    MAGIC_SHORTBOW_I,
    MAGIC_LONGBOW,
    MAGIC_COMP_BOW,
    DARK_BOW,
    DARK_BOW_GREEN,
    DARK_BOW_BLUE,
    DARK_BOW_YELLOW,
    DARK_BOW_WHITE,
    TWISTED_BOW,
    CRAW_BOW,
    WEBWEAVER_BOW,
]);

const CROSSBOW_WEAPONS = new Set([
    BRONZE_CROSSBOW,
    IRON_CROSSBOW,
    STEEL_CROSSBOW,
    MITHRIL_CROSSBOW,
    ADAMANT_CROSSBOW,
    RUNE_CROSSBOW,
    DRAGON_CROSSBOW,
    ARMADYL_CROSSBOW,
    ZARYTE_CROSSBOW,
    DRAGON_HUNTER_CROSSBOW,
    KARIL_CROSSBOW,
]);

const BALLISTA_WEAPONS = new Set([
    LIGHT_BALLISTA,
    LIGHT_BALLISTA_LMS,
    HEAVY_BALLISTA,
    HEAVY_BALLISTA_LMS,
    HEAVY_BALLISTA_OR,
]);

const NO_AMMO_WEAPONS = new Set([
    // Crystal bows (all variants)
    CRYSTAL_BOW_NEW,
    CRYSTAL_BOW_FULL,
    CRYSTAL_BOW_9,
    CRYSTAL_BOW_8,
    CRYSTAL_BOW_7,
    CRYSTAL_BOW_6,
    CRYSTAL_BOW_5,
    CRYSTAL_BOW_4,
    CRYSTAL_BOW_3,
    CRYSTAL_BOW_2,
    CRYSTAL_BOW_1,
    CRYSTAL_BOW_23983,
    CRYSTAL_BOW_24123,
    BOW_OF_FAERDHINEN,
    WEBWEAVER_BOW, // Generates its own arrows and consumes revenant ether.
    TOXIC_BLOWPIPE, // Uses internal scales + darts
    ROSEWOOD_BLOWPIPE, // Does not use the ammunition slot
    // Knives
    BRONZE_KNIFE,
    IRON_KNIFE,
    STEEL_KNIFE,
    BLACK_KNIFE,
    MITHRIL_KNIFE,
    ADAMANT_KNIFE,
    RUNE_KNIFE,
    DRAGON_KNIFE,
    DRAGON_KNIFE_P,
    DRAGON_KNIFE_P_PLUS,
    DRAGON_KNIFE_P_PLUS_PLUS,
    // Darts
    BRONZE_DART,
    IRON_DART,
    STEEL_DART,
    BLACK_DART,
    MITHRIL_DART,
    ADAMANT_DART,
    RUNE_DART,
    DRAGON_DART,
    // Thrownaxes
    BRONZE_THROWNAXE,
    IRON_THROWNAXE,
    STEEL_THROWNAXE,
    MITHRIL_THROWNAXE,
    ADAMANT_THROWNAXE,
    RUNE_THROWNAXE,
    DRAGON_THROWNAXE,
    // Other thrown
    TOKTZ_XIL_UL,
    // Chinchompas
    GREY_CHINCHOMPA,
    RED_CHINCHOMPA,
    BLACK_CHINCHOMPA,
]);

const AVAS_DEVICES = new Set([
    AVAS_ATTRACTOR,
    AVAS_ACCUMULATOR,
    AVAS_ASSEMBLER,
    MASORI_ASSEMBLER,
    RANGING_CAPE,
    RANGING_CAPE_T,
    MAX_CAPE,
]);

// =============================================================================
// Arrow Compatibility by Bow
// =============================================================================

const BOW_ARROW_REQUIREMENTS: Map<number, number[]> = new Map([
    // Shortbows/Longbows can use arrows up to their tier
    [SHORTBOW, [BRONZE_ARROW, IRON_ARROW]],
    [LONGBOW, [BRONZE_ARROW, IRON_ARROW]],
    [OAK_SHORTBOW, [BRONZE_ARROW, IRON_ARROW, STEEL_ARROW]],
    [OAK_LONGBOW, [BRONZE_ARROW, IRON_ARROW, STEEL_ARROW]],
    [WILLOW_SHORTBOW, [BRONZE_ARROW, IRON_ARROW, STEEL_ARROW, MITHRIL_ARROW]],
    [WILLOW_LONGBOW, [BRONZE_ARROW, IRON_ARROW, STEEL_ARROW, MITHRIL_ARROW]],
    [MAPLE_SHORTBOW, [BRONZE_ARROW, IRON_ARROW, STEEL_ARROW, MITHRIL_ARROW, ADAMANT_ARROW]],
    [MAPLE_LONGBOW, [BRONZE_ARROW, IRON_ARROW, STEEL_ARROW, MITHRIL_ARROW, ADAMANT_ARROW]],
    [
        YEW_SHORTBOW,
        [BRONZE_ARROW, IRON_ARROW, STEEL_ARROW, MITHRIL_ARROW, ADAMANT_ARROW, RUNE_ARROW],
    ],
    [
        YEW_LONGBOW,
        [BRONZE_ARROW, IRON_ARROW, STEEL_ARROW, MITHRIL_ARROW, ADAMANT_ARROW, RUNE_ARROW],
    ],
    [
        MAGIC_SHORTBOW,
        [
            BRONZE_ARROW,
            IRON_ARROW,
            STEEL_ARROW,
            MITHRIL_ARROW,
            ADAMANT_ARROW,
            RUNE_ARROW,
            AMETHYST_ARROW,
        ],
    ],
    [
        MAGIC_SHORTBOW_I,
        [
            BRONZE_ARROW,
            IRON_ARROW,
            STEEL_ARROW,
            MITHRIL_ARROW,
            ADAMANT_ARROW,
            RUNE_ARROW,
            AMETHYST_ARROW,
        ],
    ],
    [
        MAGIC_LONGBOW,
        [
            BRONZE_ARROW,
            IRON_ARROW,
            STEEL_ARROW,
            MITHRIL_ARROW,
            ADAMANT_ARROW,
            RUNE_ARROW,
            AMETHYST_ARROW,
        ],
    ],
    [
        MAGIC_COMP_BOW,
        [
            BRONZE_ARROW,
            IRON_ARROW,
            STEEL_ARROW,
            MITHRIL_ARROW,
            ADAMANT_ARROW,
            RUNE_ARROW,
            AMETHYST_ARROW,
        ],
    ],
    // Dark bow and twisted bow can use all arrows including dragon.
    ...[DARK_BOW, DARK_BOW_GREEN, DARK_BOW_BLUE, DARK_BOW_YELLOW, DARK_BOW_WHITE].map(
        (weaponId): [number, number[]] => [
            weaponId,
            [
                BRONZE_ARROW,
                IRON_ARROW,
                STEEL_ARROW,
                MITHRIL_ARROW,
                ADAMANT_ARROW,
                RUNE_ARROW,
                AMETHYST_ARROW,
                DRAGON_ARROW,
                DRAGON_ARROW_P,
                DRAGON_ARROW_P_PLUS,
                DRAGON_ARROW_P_PLUS_PLUS,
            ],
        ],
    ),
    [
        TWISTED_BOW,
        [
            BRONZE_ARROW,
            IRON_ARROW,
            STEEL_ARROW,
            MITHRIL_ARROW,
            ADAMANT_ARROW,
            RUNE_ARROW,
            AMETHYST_ARROW,
            DRAGON_ARROW,
        ],
    ],
    [
        CRAW_BOW,
        [
            BRONZE_ARROW,
            IRON_ARROW,
            STEEL_ARROW,
            MITHRIL_ARROW,
            ADAMANT_ARROW,
            RUNE_ARROW,
            AMETHYST_ARROW,
            DRAGON_ARROW,
        ],
    ],
]);

// All standard bolts (unenchanted + enchanted variants)
const ALL_BOLTS = [
    BRONZE_BOLTS,
    IRON_BOLTS,
    STEEL_BOLTS,
    MITHRIL_BOLTS,
    ADAMANT_BOLTS,
    RUNITE_BOLTS,
    DRAGON_BOLTS,
    BROAD_BOLTS,
    OPAL_BOLTS_E,
    JADE_BOLTS_E,
    PEARL_BOLTS_E,
    TOPAZ_BOLTS_E,
    SAPPHIRE_BOLTS_E,
    EMERALD_BOLTS_E,
    RUBY_BOLTS_E,
    DIAMOND_BOLTS_E,
    DRAGONSTONE_BOLTS_E,
    ONYX_BOLTS_E,
    RUBY_DRAGON_BOLTS_E,
    DIAMOND_DRAGON_BOLTS_E,
    DRAGONSTONE_DRAGON_BOLTS_E,
    ONYX_DRAGON_BOLTS_E,
];

const KARIL_AMMO = [BOLT_RACKS];

const CROSSBOW_BOLT_REQUIREMENTS: Map<number, number[]> = new Map([
    [BRONZE_CROSSBOW, [BRONZE_BOLTS]],
    [IRON_CROSSBOW, [BRONZE_BOLTS, IRON_BOLTS]],
    [STEEL_CROSSBOW, [BRONZE_BOLTS, IRON_BOLTS, STEEL_BOLTS]],
    [MITHRIL_CROSSBOW, [BRONZE_BOLTS, IRON_BOLTS, STEEL_BOLTS, MITHRIL_BOLTS]],
    [ADAMANT_CROSSBOW, [BRONZE_BOLTS, IRON_BOLTS, STEEL_BOLTS, MITHRIL_BOLTS, ADAMANT_BOLTS]],
    // Rune+ can use all bolts
    [RUNE_CROSSBOW, ALL_BOLTS],
    [DRAGON_CROSSBOW, ALL_BOLTS],
    [ARMADYL_CROSSBOW, ALL_BOLTS],
    [ZARYTE_CROSSBOW, ALL_BOLTS],
    [DRAGON_HUNTER_CROSSBOW, ALL_BOLTS],
    [KARIL_CROSSBOW, KARIL_AMMO],
]);

// Javelins for ballistae
const ALL_JAVELINS = [
    BRONZE_JAVELIN,
    BRONZE_JAVELIN_P,
    BRONZE_JAVELIN_P_PLUS,
    BRONZE_JAVELIN_P_PLUS_PLUS,
    IRON_JAVELIN,
    IRON_JAVELIN_P,
    IRON_JAVELIN_P_PLUS,
    IRON_JAVELIN_P_PLUS_PLUS,
    STEEL_JAVELIN,
    STEEL_JAVELIN_P,
    STEEL_JAVELIN_P_PLUS,
    STEEL_JAVELIN_P_PLUS_PLUS,
    MITHRIL_JAVELIN,
    MITHRIL_JAVELIN_P,
    MITHRIL_JAVELIN_P_PLUS,
    MITHRIL_JAVELIN_P_PLUS_PLUS,
    ADAMANT_JAVELIN,
    ADAMANT_JAVELIN_P,
    ADAMANT_JAVELIN_P_PLUS,
    ADAMANT_JAVELIN_P_PLUS_PLUS,
    RUNE_JAVELIN,
    RUNE_JAVELIN_P,
    RUNE_JAVELIN_P_PLUS,
    RUNE_JAVELIN_P_PLUS_PLUS,
    AMETHYST_JAVELIN,
    AMETHYST_JAVELIN_P,
    AMETHYST_JAVELIN_P_PLUS,
    AMETHYST_JAVELIN_P_PLUS_PLUS,
    DRAGON_JAVELIN,
    DRAGON_JAVELIN_P,
    DRAGON_JAVELIN_P_PLUS,
    DRAGON_JAVELIN_P_PLUS_PLUS,
    DRAGON_JAVELIN_LMS,
];

// =============================================================================
// Enchanted Bolt Effects
// =============================================================================

const ENCHANTED_BOLT_EFFECTS: Map<number, EnchantedBoltEffect> = new Map([
    // Opal bolts (e) - Lucky Lightning: Extra 10% of visible ranged level
    [
        OPAL_BOLTS_E,
        {
            name: "Lucky Lightning",
            activationChance: 0.05,
            kandarinBoost: true,
            effectType: "lightning",
            flatDamageBonus: 0, // Actually based on ranged level
            graphicId: 749,
        },
    ],

    // Jade bolts (e) - Earth's Fury: Chance to knock down (PvP stun)
    [
        JADE_BOLTS_E,
        {
            name: "Earth's Fury",
            activationChance: 0.06,
            kandarinBoost: true,
            effectType: "damage_boost",
            graphicId: 755,
        },
    ],

    // Pearl bolts (e) - Sea Curse: Extra damage vs fire creatures
    [
        PEARL_BOLTS_E,
        {
            name: "Sea Curse",
            activationChance: 0.06,
            kandarinBoost: true,
            effectType: "damage_boost",
            damageMultiplier: 1.0, // 1/15 ranged level vs fiery
            graphicId: 750,
        },
    ],

    // Topaz bolts (e) - Down to Earth: Drains magic (PvP only)
    [
        TOPAZ_BOLTS_E,
        {
            name: "Down to Earth",
            activationChance: 0.04,
            kandarinBoost: true,
            effectType: "magic_drain",
            graphicId: 757,
        },
    ],

    // Sapphire bolts (e) - Clear Mind: Drains prayer, restores yours
    [
        SAPPHIRE_BOLTS_E,
        {
            name: "Clear Mind",
            activationChance: 0.05,
            kandarinBoost: true,
            effectType: "heal", // Prayer transfer
            graphicId: 751,
        },
    ],

    // Emerald bolts (e) - Magical Poison: Inflicts poison
    [
        EMERALD_BOLTS_E,
        {
            name: "Magical Poison",
            activationChance: 0.55, // 55% base
            kandarinBoost: true,
            effectType: "poison",
            graphicId: 752,
        },
    ],

    // Ruby bolts (e) - Blood Forfeit: 20% of target's HP, costs 10% of yours
    [
        RUBY_BOLTS_E,
        {
            name: "Blood Forfeit",
            activationChance: 0.06,
            kandarinBoost: true,
            effectType: "hp_drain",
            damageMultiplier: 0.2, // 20% of target HP
            selfDamagePercent: 0.1, // Costs 10% of your HP
            graphicId: 754,
        },
    ],
    [
        RUBY_DRAGON_BOLTS_E,
        {
            name: "Blood Forfeit",
            activationChance: 0.06,
            kandarinBoost: true,
            effectType: "hp_drain",
            damageMultiplier: 0.22, // Dragon bolts: 22%
            selfDamagePercent: 0.1,
            graphicId: 754,
        },
    ],

    // Diamond bolts (e) - Armor Piercing: Ignore defence
    [
        DIAMOND_BOLTS_E,
        {
            name: "Armor Piercing",
            activationChance: 0.1,
            kandarinBoost: true,
            effectType: "defense_drain",
            damageMultiplier: 1.15, // +15% damage, ignores defence
            graphicId: 758,
        },
    ],
    [
        DIAMOND_DRAGON_BOLTS_E,
        {
            name: "Armor Piercing",
            activationChance: 0.1,
            kandarinBoost: true,
            effectType: "defense_drain",
            damageMultiplier: 1.2, // Dragon: +20%
            graphicId: 758,
        },
    ],

    // Dragonstone bolts (e) - Dragon's Breath: Magic damage
    [
        DRAGONSTONE_BOLTS_E,
        {
            name: "Dragon's Breath",
            activationChance: 0.06,
            kandarinBoost: true,
            effectType: "damage_boost",
            damageMultiplier: 1.0, // Varies based on antifire
            graphicId: 756,
        },
    ],
    [
        DRAGONSTONE_DRAGON_BOLTS_E,
        {
            name: "Dragon's Breath",
            activationChance: 0.06,
            kandarinBoost: true,
            effectType: "damage_boost",
            damageMultiplier: 1.0,
            graphicId: 756,
        },
    ],

    // Onyx bolts (e) - Life Leech: Heals 25% of damage dealt
    [
        ONYX_BOLTS_E,
        {
            name: "Life Leech",
            activationChance: 0.11,
            kandarinBoost: true,
            effectType: "life_leech",
            damageMultiplier: 1.2, // +20% damage
            leechPercent: 0.25, // Heal 25% of damage
            graphicId: 753,
        },
    ],
    [
        ONYX_DRAGON_BOLTS_E,
        {
            name: "Life Leech",
            activationChance: 0.11,
            kandarinBoost: true,
            effectType: "life_leech",
            damageMultiplier: 1.25, // Dragon: +25%
            leechPercent: 0.25,
            graphicId: 753,
        },
    ],
]);

// =============================================================================
// Provider Registration
// =============================================================================

export function registerAmmoDataProvider(provider: AmmoDataProvider): void {
    getProviderRegistry().ammoData = provider;
}

export function getAmmoDataProvider(): AmmoDataProvider | undefined {
    return getProviderRegistry().ammoData;
}

/**
 * Default OSRS ammo data provider built from the hardcoded data above.
 * Gamemodes that need standard OSRS ammo compatibility should register this.
 */
export function createDefaultAmmoDataProvider(): AmmoDataProvider {
    return {
        getAmmoType: defaultGetAmmoType,
        isAmmoCompatible: defaultIsAmmoCompatible,
        getValidAmmo: defaultGetValidAmmo,
        isNoAmmoWeapon: (weaponId) => NO_AMMO_WEAPONS.has(weaponId),
        isDarkBow: isDarkBowWeaponId,
        getAvasDeviceType: (capeSlotItemId) => {
            if (
                capeSlotItemId === AVAS_ASSEMBLER ||
                capeSlotItemId === MASORI_ASSEMBLER ||
                capeSlotItemId === MAX_CAPE ||
                capeSlotItemId === RANGING_CAPE ||
                capeSlotItemId === RANGING_CAPE_T
            )
                return "assembler";
            if (capeSlotItemId === AVAS_ACCUMULATOR) return "accumulator";
            if (capeSlotItemId === AVAS_ATTRACTOR) return "attractor";
            return null;
        },
        isAvasDevice: (capeSlotItemId) => AVAS_DEVICES.has(capeSlotItemId),
        getEnchantedBoltEffect: (boltId) => ENCHANTED_BOLT_EFFECTS.get(boltId),
    };
}

// =============================================================================
// Ammo System Functions (delegate to provider if registered, else use defaults)
// =============================================================================

function defaultGetAmmoType(weaponId: number): AmmoType {
    if (NO_AMMO_WEAPONS.has(weaponId)) return "none";
    if (BOW_WEAPONS.has(weaponId)) return "arrow";
    if (CROSSBOW_WEAPONS.has(weaponId)) return "bolt";
    if (BALLISTA_WEAPONS.has(weaponId)) return "javelin";
    return "none";
}

/**
 * Get the ammo type required by a weapon.
 */
export function getAmmoType(weaponId: number): AmmoType {
    const provider = getProviderRegistry().ammoData;
    return provider ? provider.getAmmoType(weaponId) : defaultGetAmmoType(weaponId);
}

function isDarkBowWeaponId(weaponId: number): boolean {
    return (
        weaponId === DARK_BOW ||
        weaponId === DARK_BOW_GREEN ||
        weaponId === DARK_BOW_BLUE ||
        weaponId === DARK_BOW_YELLOW ||
        weaponId === DARK_BOW_WHITE
    );
}

/** Returns true for the tradeable Dark bow and each paint variant. */
export function isDarkBowWeapon(weaponId: number): boolean {
    const provider = getProviderRegistry().ammoData;
    return provider ? provider.isDarkBow(weaponId) : isDarkBowWeaponId(weaponId);
}

function defaultIsAmmoCompatible(weaponId: number, ammoId: number): boolean {
    if (NO_AMMO_WEAPONS.has(weaponId)) return true;
    if (BOW_WEAPONS.has(weaponId)) {
        const validArrows = BOW_ARROW_REQUIREMENTS.get(weaponId);
        if (validArrows) return validArrows.includes(ammoId);
        return [BRONZE_ARROW, IRON_ARROW, STEEL_ARROW, MITHRIL_ARROW, BROAD_ARROWS].includes(
            ammoId,
        );
    }
    if (CROSSBOW_WEAPONS.has(weaponId)) {
        const validBolts = CROSSBOW_BOLT_REQUIREMENTS.get(weaponId);
        if (validBolts) return validBolts.includes(ammoId);
        return ALL_BOLTS.includes(ammoId);
    }
    if (BALLISTA_WEAPONS.has(weaponId)) return ALL_JAVELINS.includes(ammoId);
    return false;
}

/**
 * Check if ammo is compatible with weapon.
 */
export function isAmmoCompatible(weaponId: number, ammoId: number): boolean {
    const provider = getProviderRegistry().ammoData;
    return provider
        ? provider.isAmmoCompatible(weaponId, ammoId)
        : defaultIsAmmoCompatible(weaponId, ammoId);
}

/**
 * Calculate ammo consumption for an attack.
 * Returns whether ammo was consumed, dropped, or broke.
 */
export function calculateAmmoConsumption(
    weaponId: number,
    ammoId: number,
    ammoQuantity: number,
    capeSlot: number,
    attackerX: number,
    attackerY: number,
    random: () => number,
): AmmoConsumptionResult {
    // No ammo weapons don't consume
    if (NO_AMMO_WEAPONS.has(weaponId)) {
        return {
            consumed: false,
            ammoId,
            quantityUsed: 0,
            dropped: false,
            broke: false,
        };
    }

    // Check ammo quantity
    if (ammoQuantity <= 0) {
        return {
            consumed: false,
            ammoId,
            quantityUsed: 0,
            dropped: false,
            broke: false,
            error: "Out of ammunition",
        };
    }

    // Check compatibility
    if (!isAmmoCompatible(weaponId, ammoId)) {
        return {
            consumed: false,
            ammoId,
            quantityUsed: 0,
            dropped: false,
            broke: false,
            error: "Incompatible ammunition",
        };
    }

    // Dark bow shoots 2 arrows
    const quantity = isDarkBowWeapon(weaponId) ? 2 : 1;
    const actualQuantity = Math.min(quantity, ammoQuantity);

    // Bolt racks are consumed when fired and cannot be recovered by Ava's
    // devices or spawned on the ground like ordinary ammunition.
    if (weaponId === KARIL_CROSSBOW && ammoId === BOLT_RACKS) {
        return {
            consumed: true,
            ammoId,
            quantityUsed: actualQuantity,
            dropped: false,
            broke: true,
        };
    }

    // Each Dark bow arrow receives its own recovery roll, matching two calls
    // to the ordinary ranged-ammunition pipeline rather than sharing one roll.
    let quantityUsed = 0;
    let dropQuantity = 0;
    let broke = false;
    for (let index = 0; index < actualQuantity; index++) {
        const result = rollSingleAmmoConsumption(ammoId, capeSlot, attackerX, attackerY, random);
        quantityUsed += result.quantityUsed;
        dropQuantity += result.dropQuantity ?? (result.dropped ? result.quantityUsed : 0);
        broke ||= result.broke;
    }
    return {
        consumed: quantityUsed > 0,
        ammoId,
        quantityUsed,
        dropped: dropQuantity > 0,
        dropQuantity,
        dropTileX: dropQuantity > 0 ? attackerX : undefined,
        dropTileY: dropQuantity > 0 ? attackerY : undefined,
        broke,
    };
}

function rollSingleAmmoConsumption(
    ammoId: number,
    capeSlot: number,
    attackerX: number,
    attackerY: number,
    random: () => number,
): AmmoConsumptionResult {
    const hasAvas = AVAS_DEVICES.has(capeSlot);
    const hasAssembler =
        capeSlot === AVAS_ASSEMBLER ||
        capeSlot === MASORI_ASSEMBLER ||
        capeSlot === RANGING_CAPE ||
        capeSlot === RANGING_CAPE_T ||
        capeSlot === MAX_CAPE;
    const hasAccumulator = capeSlot === AVAS_ACCUMULATOR;
    const roll = random();

    if (hasAssembler && roll < 0.8) {
        return { consumed: false, ammoId, quantityUsed: 0, dropped: false, broke: false };
    }
    if (hasAccumulator && roll < 0.72) {
        return { consumed: false, ammoId, quantityUsed: 0, dropped: false, broke: false };
    }
    if (hasAvas && !hasAccumulator && !hasAssembler && roll < 0.6) {
        return { consumed: false, ammoId, quantityUsed: 0, dropped: false, broke: false };
    }

    const dropped =
        (!hasAvas && roll < 0.8) ||
        (hasAccumulator && roll >= 0.72 && roll < 0.92) ||
        (hasAvas && !hasAccumulator && !hasAssembler && roll >= 0.6 && roll < 0.9);
    return {
        consumed: true,
        ammoId,
        quantityUsed: 1,
        dropped,
        dropQuantity: dropped ? 1 : 0,
        dropTileX: dropped ? attackerX : undefined,
        dropTileY: dropped ? attackerY : undefined,
        broke: !dropped,
    };
}

/**
 * Get enchanted bolt effect for a bolt ID.
 */
export function getEnchantedBoltEffect(boltId: number): EnchantedBoltEffect | undefined {
    const provider = getProviderRegistry().ammoData;
    return provider ? provider.getEnchantedBoltEffect(boltId) : ENCHANTED_BOLT_EFFECTS.get(boltId);
}

/**
 * Check if bolt effect activates.
 */
export function doesBoltEffectActivate(
    boltId: number,
    hasKandarinDiary: boolean,
    random: () => number,
): boolean {
    const effect = ENCHANTED_BOLT_EFFECTS.get(boltId);
    if (!effect) return false;

    let chance = effect.activationChance;
    if (effect.kandarinBoost && hasKandarinDiary) {
        chance *= 1.1; // 10% boost
    }

    return random() < chance;
}

function defaultGetValidAmmo(weaponId: number): number[] {
    if (NO_AMMO_WEAPONS.has(weaponId)) return [];
    if (BOW_WEAPONS.has(weaponId)) return BOW_ARROW_REQUIREMENTS.get(weaponId) ?? [];
    if (CROSSBOW_WEAPONS.has(weaponId))
        return CROSSBOW_BOLT_REQUIREMENTS.get(weaponId) ?? ALL_BOLTS;
    if (BALLISTA_WEAPONS.has(weaponId)) return ALL_JAVELINS;
    return [];
}

/**
 * Get all valid ammo IDs for a weapon.
 */
export function getValidAmmo(weaponId: number): number[] {
    const provider = getProviderRegistry().ammoData;
    return provider ? provider.getValidAmmo(weaponId) : defaultGetValidAmmo(weaponId);
}

// =============================================================================
// AmmoSystem Class (convenience wrapper for index.ts exports)
// =============================================================================

/**
 * Ammo system class providing object-oriented interface to ammo functions.
 */
export class AmmoSystem {
    getAmmoType(weaponId: number): AmmoType {
        return getAmmoType(weaponId);
    }

    isAmmoCompatible(weaponId: number, ammoId: number): boolean {
        return isAmmoCompatible(weaponId, ammoId);
    }

    calculateAmmoConsumption(
        weaponId: number,
        ammoId: number,
        ammoQuantity: number,
        capeSlot: number,
        attackerX: number,
        attackerY: number,
        random: () => number,
    ): AmmoConsumptionResult {
        return calculateAmmoConsumption(
            weaponId,
            ammoId,
            ammoQuantity,
            capeSlot,
            attackerX,
            attackerY,
            random,
        );
    }

    getEnchantedBoltEffect(boltId: number): EnchantedBoltEffect | undefined {
        return getEnchantedBoltEffect(boltId);
    }

    doesBoltEffectActivate(
        boltId: number,
        hasKandarinDiary: boolean,
        random: () => number,
    ): boolean {
        return doesBoltEffectActivate(boltId, hasKandarinDiary, random);
    }

    getValidAmmo(weaponId: number): number[] {
        return getValidAmmo(weaponId);
    }

    /**
     * Check if ammo should be consumed based on Ava's device.
     */
    shouldConsumeAmmo(
        ammoId: number,
        hasAvasDevice: boolean,
        avasType: AvasDeviceType | null,
        random: () => number,
    ): boolean {
        if (!hasAvasDevice || !avasType) {
            // Without Ava's: 80% drop, 20% break = always consumed
            return true;
        }

        const roll = random();
        switch (avasType) {
            case AvasDeviceType.Assembler:
                // 80% retrieved, 20% break
                return roll >= 0.8;
            case AvasDeviceType.Accumulator:
                // 72% retrieved, 28% consumed
                return roll >= 0.72;
            case AvasDeviceType.Attractor:
                // 60% retrieved, 40% consumed
                return roll >= 0.6;
            default:
                return true;
        }
    }
}
