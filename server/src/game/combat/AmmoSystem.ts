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
import { EquipmentSlot } from "../../../../src/rs/config/player/Equipment";

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
const DARK_BOW = 11235;
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

// Ballistae
const LIGHT_BALLISTA = 19478;
const HEAVY_BALLISTA = 19481;

// Thrown weapons (don't need ammo)
const BRONZE_KNIFE = 864;
const IRON_KNIFE = 863;
const STEEL_KNIFE = 865;
const BLACK_KNIFE = 869;
const MITHRIL_KNIFE = 866;
const ADAMANT_KNIFE = 867;
const RUNE_KNIFE = 868;
const DRAGON_KNIFE = 22804;

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
const IRON_JAVELIN = 826;
const STEEL_JAVELIN = 827;
const MITHRIL_JAVELIN = 828;
const ADAMANT_JAVELIN = 829;
const RUNE_JAVELIN = 830;
const AMETHYST_JAVELIN = 21318;
const DRAGON_JAVELIN = 19484;

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
    DARK_BOW,
    TWISTED_BOW,
    CRAW_BOW,
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

const BALLISTA_WEAPONS = new Set([LIGHT_BALLISTA, HEAVY_BALLISTA]);

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
    TOXIC_BLOWPIPE, // Uses internal scales + darts
    // Knives
    BRONZE_KNIFE,
    IRON_KNIFE,
    STEEL_KNIFE,
    BLACK_KNIFE,
    MITHRIL_KNIFE,
    ADAMANT_KNIFE,
    RUNE_KNIFE,
    DRAGON_KNIFE,
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
    // Dark bow and twisted bow can use all arrows including dragon
    [
        DARK_BOW,
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
    [KARIL_CROSSBOW, ALL_BOLTS], // Actually uses bolt racks, simplified here
]);

// Javelins for ballistae
const ALL_JAVELINS = [
    BRONZE_JAVELIN,
    IRON_JAVELIN,
    STEEL_JAVELIN,
    MITHRIL_JAVELIN,
    ADAMANT_JAVELIN,
    RUNE_JAVELIN,
    AMETHYST_JAVELIN,
    DRAGON_JAVELIN,
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
// Ammo System Functions
// =============================================================================

/**
 * Get the ammo type required by a weapon.
 */
export function getAmmoType(weaponId: number): AmmoType {
    if (NO_AMMO_WEAPONS.has(weaponId)) return "none";
    if (BOW_WEAPONS.has(weaponId)) return "arrow";
    if (CROSSBOW_WEAPONS.has(weaponId)) return "bolt";
    if (BALLISTA_WEAPONS.has(weaponId)) return "javelin";
    return "none";
}

/**
 * Check if ammo is compatible with weapon.
 */
export function isAmmoCompatible(weaponId: number, ammoId: number): boolean {
    // No ammo weapons don't need ammo
    if (NO_AMMO_WEAPONS.has(weaponId)) return true;

    // Bows + arrows
    if (BOW_WEAPONS.has(weaponId)) {
        const validArrows = BOW_ARROW_REQUIREMENTS.get(weaponId);
        if (validArrows) {
            return validArrows.includes(ammoId);
        }
        // Default: allow broad arrows and below
        return [BRONZE_ARROW, IRON_ARROW, STEEL_ARROW, MITHRIL_ARROW, BROAD_ARROWS].includes(
            ammoId,
        );
    }

    // Crossbows + bolts
    if (CROSSBOW_WEAPONS.has(weaponId)) {
        const validBolts = CROSSBOW_BOLT_REQUIREMENTS.get(weaponId);
        if (validBolts) {
            return validBolts.includes(ammoId);
        }
        return ALL_BOLTS.includes(ammoId);
    }

    // Ballistae + javelins
    if (BALLISTA_WEAPONS.has(weaponId)) {
        return ALL_JAVELINS.includes(ammoId);
    }

    return false;
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
    const quantity = weaponId === DARK_BOW ? 2 : 1;
    const actualQuantity = Math.min(quantity, ammoQuantity);

    // Check for Ava's device
    const hasAvas = AVAS_DEVICES.has(capeSlot);
    const hasAssembler =
        capeSlot === AVAS_ASSEMBLER || capeSlot === MASORI_ASSEMBLER || capeSlot === MAX_CAPE;
    const hasAccumulator = capeSlot === AVAS_ACCUMULATOR;

    // OSRS ammo mechanics:
    // - Without Ava's: 80% chance to drop on ground, 20% chance to break
    // - With Accumulator: 72% retrieved, 20% drop, 8% break
    // - With Assembler: 80% retrieved, 0% drop, 20% break
    // - Ranging cape acts like assembler

    const roll = random();

    if (hasAssembler) {
        // Assembler: 80% retrieved, 20% break
        if (roll < 0.8) {
            // Retrieved - no consumption
            return {
                consumed: false,
                ammoId,
                quantityUsed: 0,
                dropped: false,
                broke: false,
            };
        } else {
            // Broke
            return {
                consumed: true,
                ammoId,
                quantityUsed: actualQuantity,
                dropped: false,
                broke: true,
            };
        }
    } else if (hasAccumulator) {
        // Accumulator: 72% retrieved, 20% drop, 8% break
        if (roll < 0.72) {
            return {
                consumed: false,
                ammoId,
                quantityUsed: 0,
                dropped: false,
                broke: false,
            };
        } else if (roll < 0.92) {
            return {
                consumed: true,
                ammoId,
                quantityUsed: actualQuantity,
                dropped: true,
                dropTileX: attackerX,
                dropTileY: attackerY,
                broke: false,
            };
        } else {
            return {
                consumed: true,
                ammoId,
                quantityUsed: actualQuantity,
                dropped: false,
                broke: true,
            };
        }
    } else if (hasAvas) {
        // Attractor (worse than accumulator)
        if (roll < 0.6) {
            return {
                consumed: false,
                ammoId,
                quantityUsed: 0,
                dropped: false,
                broke: false,
            };
        } else if (roll < 0.9) {
            return {
                consumed: true,
                ammoId,
                quantityUsed: actualQuantity,
                dropped: true,
                dropTileX: attackerX,
                dropTileY: attackerY,
                broke: false,
            };
        } else {
            return {
                consumed: true,
                ammoId,
                quantityUsed: actualQuantity,
                dropped: false,
                broke: true,
            };
        }
    } else {
        // No Ava's device
        if (roll < 0.8) {
            return {
                consumed: true,
                ammoId,
                quantityUsed: actualQuantity,
                dropped: true,
                dropTileX: attackerX,
                dropTileY: attackerY,
                broke: false,
            };
        } else {
            return {
                consumed: true,
                ammoId,
                quantityUsed: actualQuantity,
                dropped: false,
                broke: true,
            };
        }
    }
}

/**
 * Get enchanted bolt effect for a bolt ID.
 */
export function getEnchantedBoltEffect(boltId: number): EnchantedBoltEffect | undefined {
    return ENCHANTED_BOLT_EFFECTS.get(boltId);
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

/**
 * Get all valid ammo IDs for a weapon.
 */
export function getValidAmmo(weaponId: number): number[] {
    if (NO_AMMO_WEAPONS.has(weaponId)) return [];

    if (BOW_WEAPONS.has(weaponId)) {
        return BOW_ARROW_REQUIREMENTS.get(weaponId) ?? [];
    }

    if (CROSSBOW_WEAPONS.has(weaponId)) {
        return CROSSBOW_BOLT_REQUIREMENTS.get(weaponId) ?? ALL_BOLTS;
    }

    if (BALLISTA_WEAPONS.has(weaponId)) {
        return ALL_JAVELINS;
    }

    return [];
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
