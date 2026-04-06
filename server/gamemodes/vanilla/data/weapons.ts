import fs from "fs";
import path from "path";

import { type ItemDefinition, type WeaponInterface, loadItemDefinitions } from "../../../src/data/items";
import type { WeaponDataProvider } from "../../../src/game/combat/WeaponDataProvider";
// ====================================================================================
// POWERED STAFF SPELL DATA (Re-export from spells.ts for convenience)
// ====================================================================================
import {
    type PoweredStaffSpellData,
    calculatePoweredStaffBaseDamage,
    getPoweredStaffSpellData,
    hasPoweredStaffSpellData,
} from "../../../src/data/spells";

// ATTACK TYPE - Determines which defence bonus is used

export const AttackType = {
    STAB: "stab",
    SLASH: "slash",
    CRUSH: "crush",
    RANGED: "ranged",
    MAGIC: "magic",
} as const;
export type AttackTypeValue = "stab" | "slash" | "crush" | "ranged" | "magic";

// ====================================================================================
// XP MODE - Determines which skill receives combat XP
// ====================================================================================
export const XpMode = {
    ATTACK: "attack",
    STRENGTH: "strength",
    DEFENCE: "defence",
    SHARED: "shared", // Attack + Strength + Defence
    RANGED: "ranged",
    RANGED_DEFENCE: "ranged_defence", // Longrange
    MAGIC: "magic",
    MAGIC_DEFENCE: "magic_defence", // Defensive casting
} as const;
export type XpModeValue =
    | "attack"
    | "strength"
    | "defence"
    | "shared"
    | "ranged"
    | "ranged_defence"
    | "magic"
    | "magic_defence";

// ====================================================================================
// ATTACK STYLE - Determines invisible bonuses
// ====================================================================================
export const AttackStyle = {
    ACCURATE: "accurate", // +3 effective attack level
    AGGRESSIVE: "aggressive", // +3 effective strength level
    CONTROLLED: "controlled", // +1 to attack, strength, defence
    DEFENSIVE: "defensive", // +3 effective defence level
    RAPID: "rapid", // -1 attack speed (ranged)
    LONGRANGE: "longrange", // +2 attack range (ranged)
} as const;
export type AttackStyleValue =
    | "accurate"
    | "aggressive"
    | "controlled"
    | "defensive"
    | "rapid"
    | "longrange";

// ====================================================================================
// COMBAT STYLE DATA - Per-style attack type, XP mode, and style
// ====================================================================================
export type CombatStyleData = {
    name: string; // Display name (e.g., "Chop", "Hack", "Smash")
    attackType: AttackTypeValue;
    xpMode: XpModeValue;
    attackStyle: AttackStyleValue;
};

export type WeaponDataEntry = {
    itemId: number;
    name?: string;
    equipmentType?: string;
    combatCategory?: number;
    animOverrides?: Record<string, number>;
    /** @deprecated Use attackSequences instead */
    attackSequence?: number;
    /**
     * Attack animations per combat style index.
     * Style indices correspond to the combat interface:
     * - Style 0: Usually Accurate (e.g., Chop, Stab, Accurate)
     * - Style 1: Usually Aggressive (e.g., Hack, Slash, Rapid)
     * - Style 2: Usually Controlled/Strength (e.g., Smash, Lunge, Longrange)
     * - Style 3: Usually Defensive (e.g., Block)
     */
    attackSequences?: {
        0?: number;
        1?: number;
        2?: number;
        3?: number;
    };
    /**
     * Combat style data per style index.
     * Defines attack type, XP mode, and style bonuses for each option.
     */
    combatStyles?: {
        0?: CombatStyleData;
        1?: CombatStyleData;
        2?: CombatStyleData;
        3?: CombatStyleData;
    };
    /** Special attack animation ID (if weapon has a special attack) */
    specialAttackAnim?: number;
    /** Special attack energy cost (0-100) */
    specialAttackCost?: number;
    attackSpeed?: number;
    hitDelay?: number;
    /** @deprecated Use hitSounds instead for per-attack-type sounds */
    hitSound?: number;
    /**
     * Hit sounds per attack type (stab/slash/crush/ranged).
     * Server selects appropriate sound based on current combat style's attack type.
     */
    hitSounds?: {
        stab?: number;
        slash?: number;
        crush?: number;
        ranged?: number;
    };
    missSound?: number;
};

// ====================================================================================
// COMBAT CATEGORIES (DB Table 78)
// These map to the combat style interface shown when a weapon is equipped
// ====================================================================================
export const CombatCategory = {
    UNARMED: 0,
    AXE: 1, // Axes, Battleaxes, Greataxes (Chop/Hack/Smash/Block)
    HAMMER: 2, // Warhammers, Mauls
    BOW: 3, // Shortbows, Longbows
    SCIMITAR: 9, // Slash swords: scimitars, shortswords, longswords
    CROSSBOW: 5, // Crossbows
    SALAMANDER: 6, // Salamanders (hybrid)
    CHINCHOMPA: 7, // Chinchompas
    GUN: 8, // Aim and Fire / Kick
    TWO_HANDED_SWORD: 10, // 2H Swords, Godswords (Chop/Slash/Smash/Block)
    PICKAXE: 11, // Pickaxes
    HALBERD: 12, // Halberds
    STAFF: 13, // Legacy alias for row 13
    POLESTAFF: 13, // Banners / polestaves
    SCYTHE: 14, // Scythes
    SPEAR: 15, // Spears, Hastas
    MACE: 16, // Maces
    DAGGER: 17, // Stab sword (daggers, stab swords, rapiers)
    MAGIC_STAFF: 18, // Staves with autocast
    THROWN: 19, // Darts, Knives, Throwing axes, Javelins
    WHIP: 20, // Whips
    STAFF_HALBERD: 21, // Scythe-like staves
    CLAW: 4, // Claws
    POWERED_STAFF: 24, // Tridents, Powered staves (all magic styles)
    BLUDGEON: 27, // Abyssal Bludgeon - per WeaponInterfaces.ts
    BULWARK: 28, // Dinh's Bulwark - per WeaponInterfaces.ts
    PARTISAN: 30, // Keris partisan row
    TUMEKEN: 24, // Tumeken's Shadow (uses same powered staff UI as Trident)
} as const;

// ====================================================================================
// ANIMATION OVERRIDES
// Shared animation sets for weapon types
// ====================================================================================

const unarmedAnimOverrides = {
    idle: 808,
    walk: 819,
    run: 824,
    block: 424,
};

const daggerAnimOverrides = {
    // Daggers use the default player stance from cache.
    idle: 808,
    walk: 819,
    run: 824,
    // Cache item defs for bronze/dragon dagger use human_sword_def_0 here, not human_ddagger_block_0.
    block: 388,
};

// Swords/Scimitars/Longswords use same stance as unarmed (verified from cache: rune scimitar, dragon scimitar, dragon longsword)
const swordAnimOverrides = {
    idle: 808, // standAnim from cache
    walk: 819, // walkAnim from cache
    run: 824, // runAnim from cache
    block: 388, // human_sword_def_0
};

const scimitarAnimOverrides = {
    idle: 808, // standAnim from cache
    walk: 819, // walkAnim from cache
    run: 824, // runAnim from cache
    block: 388, // human_sword_def_0
};

const longswordAnimOverrides = {
    idle: 808, // standAnim from cache
    walk: 819, // walkAnim from cache
    run: 824, // runAnim from cache
    block: 388, // human_sword_def_0
};

const maceAnimOverrides = {
    idle: 808,
    walk: 819,
    run: 824,
    block: 403,
};

const warhammerAnimOverrides = {
    idle: 808,
    walk: 819,
    run: 824,
    block: 403,
};

// Granite maul has unique stance (verified from cache: granite maul 4153)
const graniteMaulAnimOverrides = {
    idle: 1662, // standAnim from cache
    walk: 1663, // walkAnim from cache
    run: 1664, // runAnim from cache
    block: 1666, // blockAnim from cache
};

const axeAnimOverrides = {
    idle: 808,
    walk: 819,
    run: 824,
    block: 397,
};

const battleaxeAnimOverrides = {
    idle: 808,
    walk: 819,
    run: 824,
    block: 397,
};

const twoHandedSwordAnimOverrides = {
    idle: 2561,
    walk: 2064,
    walkBack: 2064,
    walkLeft: 2064,
    walkRight: 2064,
    run: 2563,
    runBack: 2563,
    runLeft: 2563,
    runRight: 2563,
    turnLeft: 2561,
    turnRight: 2561,
    block: 410,
};

const godswordAnimOverrides = {
    idle: 7053,
    walk: 7052,
    walkBack: 7052,
    walkLeft: 7052,
    walkRight: 7052,
    run: 7043,
    runBack: 7043,
    runLeft: 7043,
    runRight: 7043,
    turnLeft: 7044,
    turnRight: 7044,
    attack: 7045,
    block: 7056,
};

// Spears have unique stance (verified from cache: rune spear 1247)
const spearAnimOverrides = {
    idle: 813, // standAnim from cache
    walk: 1146, // walkAnim from cache
    run: 1210, // runAnim from cache
    block: 430, // human_spear_block_0
};

// Halberds have unique stance (verified from cache: rune halberd 3202)
const halberdAnimOverrides = {
    idle: 809, // standAnim from cache
    walk: 1146, // walkAnim from cache
    run: 1210, // runAnim from cache
    block: 430, // human_spear_block_0
};

// Whip has unique walk/run but standard idle (verified from cache: abyssal whip 4151)
const whipAnimOverrides = {
    idle: 808, // standAnim from cache
    walk: 1660, // slayer_abyssal_whip_walk_0
    run: 1661, // slayer_abyssal_whip_run_0
    block: 1659, // slayer_abyssal_whip_defend_0
};

// Claws use standard stance with unique block (verified from cache: dragon claws 13652)
const clawAnimOverrides = {
    idle: 808, // standAnim from cache
    walk: 819, // walkAnim from cache
    run: 824, // runAnim from cache
    block: 424, // blockAnim from cache
};

// Staves have unique stance (verified from cache: staff of air 1381)
const staffAnimOverrides = {
    idle: 813, // standAnim from cache
    walk: 1146, // walkAnim from cache
    run: 1210, // runAnim from cache
    block: 424, // blockAnim from cache
};

const magicStaffAnimOverrides = {
    idle: 813, // standAnim from cache
    walk: 1146, // walkAnim from cache
    run: 1210, // runAnim from cache
    block: 424, // blockAnim from cache
};

const bowAnimOverrides = {
    idle: 808,
    walk: 819,
    run: 824,
    block: 424,
};

// Crossbows have unique idle but standard walk/run (verified from cache: rune crossbow 9185)
const crossbowAnimOverrides = {
    idle: 4591, // standAnim from cache
    walk: 819, // walkAnim from cache
    run: 824, // runAnim from cache
    block: 424, // blockAnim from cache
};

const thrownAnimOverrides = {
    idle: 808,
    walk: 819,
    run: 824,
    block: 424,
};

// Scythe of vitur uses standard stance (verified from cache: scythe of vitur 22325)
// Note: 8057 is scythe_of_vitur_ready_0, 8056 is scythe_of_vitur_attack_0
const scytheAnimOverrides = {
    idle: 808, // standAnim from cache (standard stance)
    walk: 819, // walkAnim from cache
    run: 824, // runAnim from cache
    block: 424, // blockAnim from cache
};

// Abyssal bludgeon has unique stance
const bludgeonAnimOverrides = {
    idle: 1652, // abyssal_bludgeon_ready
    walk: 3293, // abyssal_bludgeon_walk
    run: 2847, // abyssal_bludgeon_run
    block: 425, // blockAnim from cache
};

// Dinh's bulwark uses standard stance (verified from cache: dinh's bulwark 21015)
const bulwarkAnimOverrides = {
    idle: 808, // standAnim from cache
    walk: 819, // walkAnim from cache
    run: 824, // runAnim from cache
    block: 424, // blockAnim from cache
};

const tumekensShadowAnimOverrides = {
    idle: 1713,
    run: 1707,
    walk: 1703,
    walkLeft: 1705,
    walkRight: 1705,
    block: 1709,
};

// Rapiers have unique idle and block (verified from cache: ghrazi rapier 22324)
const rapierAnimOverrides = {
    idle: 809, // standAnim from cache
    walk: 819, // walkAnim from cache
    run: 824, // runAnim from cache
    block: 4177, // blockAnim from cache
};

// Elder maul has unique stance (verified from cache: elder maul 21003)
const elderMaulAnimOverrides = {
    idle: 7518, // standAnim from cache
    walk: 7520, // walkAnim from cache
    run: 7519, // runAnim from cache
    block: 7517, // blockAnim from cache
};

// Dragon claws use standard stance with unique block (verified from cache: dragon claws 13652)
const dragonClawsAnimOverrides = {
    idle: 808, // standAnim from cache
    walk: 819, // walkAnim from cache
    run: 824, // runAnim from cache
    block: 424, // blockAnim from cache
};

const ballistaAnimOverrides = {
    idle: 7220,
    walk: 7223,
    run: 7221,
    block: 7219,
};

// ====================================================================================
// ATTACK SEQUENCES PER STYLE
// Maps combat style index to attack animation ID
// Style 0 = Accurate, Style 1 = Aggressive, Style 2 = Controlled/Strength, Style 3 = Defensive
// ====================================================================================

// Unarmed: Punch (422), Kick (423), Block uses same as punch
const unarmedAttackSeqs = { 0: 422, 1: 423, 2: 422, 3: 422 };

// Category 17 is the shared stab-sword style set used by daggers, stab swords, and rapiers.
// Style 0 = stab, Style 1 = lunge, Style 2 = slash, Style 3 = defensive stab
const stabSwordAttackSeqs = { 0: 386, 1: 392, 2: 390, 3: 386 };

// Plain daggers use the standard stab/slash table; slot 1 shares the stab animation.
const regularDaggerAttackSeqs = { 0: 386, 1: 386, 2: 390, 3: 386 };

// Dragon dagger keeps its distinct normal lunge/hack table on the DRAGON_DAGGER interface.
// These are regular attacks, not the dragon dagger special attack sequence.
const dragonDaggerAttackSeqs = { 0: 376, 1: 376, 2: 377, 3: 376 };

// Abyssal dagger has unique stance and attack animations
const abyssalDaggerAnimOverrides = {
    idle: 3296, // abyssal_dagger_idle
    walk: 819, // generic walk
    run: 824, // generic run
    block: 3295, // abyssal_dagger_block
};

// Abyssal dagger: Lunge (3297), Hack (3294) - Style 0,1,3 = lunge, Style 2 = hack
const abyssalDaggerAttackSeqs = { 0: 3297, 1: 3297, 2: 3294, 3: 3297 };

// Swords (short): Stab (386), Slash (390) - Style 0,1 = slash, Style 2 = stab, Style 3 = slash
const swordAttackSeqs = { 0: 390, 1: 390, 2: 386, 3: 390 };

// Scimitars: Slash (390), Stab (386) - mostly slash, style 2 = stab
const scimitarAttackSeqs = { 0: 390, 1: 390, 2: 386, 3: 390 };

// Longswords: Slash (390), Stab (386) - Style 0,1 = slash, Style 2 = stab, Style 3 = slash
const longswordAttackSeqs = { 0: 390, 1: 390, 2: 386, 3: 390 };

// Maces: Pound (401), Spike (400) - Style 0,1,3 = pound, Style 2 = spike (stab)
const maceAttackSeqs = { 0: 401, 1: 401, 2: 400, 3: 401 };

// Warhammers: Pound (401) - all crush attacks
const warhammerAttackSeqs = { 0: 401, 1: 401, 2: 401, 3: 401 };

// Battleaxes/Axes: Chop (395), Hack (395), Smash (401) - Style 0,1 = slash (395), Style 2 = crush (401)
const axeAttackSeqs = { 0: 395, 1: 395, 2: 401, 3: 395 };

// 2H Swords: Chop (406), Slash (407), Smash (406)
const twoHandedSwordAttackSeqs = { 0: 406, 1: 407, 2: 406, 3: 407 };

// Godswords: Chop (7046), Slash (7045), Smash (7054), Block uses Slash (7045)
const godswordAttackSeqs = { 0: 7046, 1: 7045, 2: 7054, 3: 7045 };

// Spears: Stab (428), Swipe (440), Lunge (429) - Style 0 = stab, Style 1 = slash, Style 2 = stab, Style 3 = stab
const spearAttackSeqs = { 0: 428, 1: 440, 2: 429, 3: 428 };

// Halberds: Jab (428), Swipe (440), Fend (429) - Style 0 = stab, Style 1 = slash, Style 2 = stab
const halberdAttackSeqs = { 0: 428, 1: 440, 2: 429, 3: 428 };

// Pickaxes: Spike (400), Smash (401) - Style 0,1 = stab (400), Style 2 = crush (401)
const pickaxeAttackSeqs = { 0: 400, 1: 400, 2: 401, 3: 400 };

// Claws: claw_attack_0 (1675) from seq-names.json
const clawAttackSeqs = { 0: 1675, 1: 1675, 2: 1675, 3: 1675 };

// Dragon Claws: d_claws_punch_0 (1067) for regular attacks, special uses 7514
const dragonClawsAttackSeqs = { 0: 1067, 1: 1067, 2: 1067, 3: 1067 };

// Whips: Flick (1658), Lash (1658), Deflect (1658) - same animation
const whipAttackSeqs = { 0: 1658, 1: 1658, 2: 1658, 3: 1658 };

// Staves: Bash/Pound (419) - all styles use same animation
const staffAttackSeqs = { 0: 419, 1: 419, 2: 419, 3: 419 };

// Magic Staves with autocast: Bash (419) for melee, spell cast for magic
const magicStaffAttackSeqs = { 0: 419, 1: 419, 2: 419, 3: 419 };

// Bows: Draw and fire (426)
const bowAttackSeqs = { 0: 426, 1: 426, 2: 426, 3: 426 };

// Crossbows: Fire and reload (4230)
const crossbowAttackSeqs = { 0: 4230, 1: 4230, 2: 4230, 3: 4230 };

// Thrown weapons: Throw (929)
const thrownAttackSeqs = { 0: 929, 1: 929, 2: 929, 3: 929 };

// Chinchompas: Throw (7618)
const chinchompaAttackSeqs = { 0: 7618, 1: 7618, 2: 7618, 3: 7618 };

// Scythes: Reap (8056), Chop (8056), Jab (8056)
const scytheAttackSeqs = { 0: 8056, 1: 8056, 2: 8056, 3: 8056 };

// Abyssal bludgeon: Crush (3298) - all aggressive
const bludgeonAttackSeqs = { 0: 3298, 1: 3298, 2: 3298, 3: 3298 };

// Bulwark: Pummel (7511) - only one attack option
const bulwarkAttackSeqs = { 0: 7511, 1: 7511, 2: 7511, 3: 7511 };

// Elder Maul: Pound (7516)
const elderMaulAttackSeqs = { 0: 7516, 1: 7516, 2: 7516, 3: 7516 };

// Viggora's chainmace: Crush (245), Stab (246) - Style 0,1,3 = crush, Style 2 = stab
const viggoraChainmaceAttackSeqs = { 0: 245, 1: 245, 2: 246, 3: 245 };

const viggoraChainmaceAnimOverrides = {
    idle: 244, // wild_cave_chainmace_ready
    walk: 247, // wild_cave_chainmace_walk
    run: 248, // wild_cave_chainmace_run
    block: 7200, // wild_cave_chainmace_defend
};

// Dragon spear: Stab (381), Slash (380), Lunge (382) - Style 0,3 = stab, Style 1 = slash, Style 2 = lunge
const dragonSpearAttackSeqs = { 0: 381, 1: 380, 2: 382, 3: 381 };

// Zamorakian spear/hasta: Stab (1711), Slash (1712), Lunge (1710) - Style 0,3 = stab, Style 1 = slash, Style 2 = lunge
const zamorakianSpearAttackSeqs = { 0: 1711, 1: 1712, 2: 1710, 3: 1711 };

const zamorakianSpearAnimOverrides = {
    idle: 1713, // human_zamorakspear_ready
    walk: 1703, // human_zamorakspear_walk_f
    run: 1707, // human_zamorakspear_run
    block: 1709, // human_zamorakspear_block
};

// Ghrazi rapier: Stab (8145), Lunge (8145)
const rapierAttackSeqs = { 0: 8145, 1: 8145, 2: 8145, 3: 8145 };

// Saradomin sword: Slash (7045), Smash (7045), Stab (7045)
const saradominSwordAttackSeqs = { 0: 7045, 1: 7045, 2: 7045, 3: 7045 };

// Blade of saeldor uses standard stance (verified from cache: blade of saeldor 23995)
const saeldorAnimOverrides = {
    idle: 808, // standAnim from cache
    walk: 819, // walkAnim from cache
    run: 824, // runAnim from cache
    block: 424, // blockAnim from cache
};

// Blade of saeldor: Slash (390), Stab (386)
const saeldorAttackSeqs = { 0: 390, 1: 390, 2: 386, 3: 390 };

// Osmumten's fang uses standard stance (verified from cache: osmumten's fang 26219)
const fangAnimOverrides = {
    idle: 808, // standAnim from cache
    walk: 819, // walkAnim from cache
    run: 824, // runAnim from cache
    block: 424, // blockAnim from cache
};

// Osmumten's fang: Stab (9471), Lunge (9471)
const fangAttackSeqs = { 0: 9471, 1: 9471, 2: 9471, 3: 9471 };

// Inquisitor's mace uses standard stance (verified from cache: inquisitor's mace 24417)
const inquisitorMaceAnimOverrides = {
    idle: 808, // standAnim from cache
    walk: 819, // walkAnim from cache
    run: 824, // runAnim from cache
    block: 424, // blockAnim from cache (different from regular maces)
};

// Inquisitor's mace: Pound (4503)
const inquisitorMaceAttackSeqs = { 0: 4503, 1: 4503, 2: 4503, 3: 4503 };

// Ballistas: Fire (7555)
const ballistaAttackSeqs = { 0: 7555, 1: 7555, 2: 7555, 3: 7555 };

// Blowpipe: Fire (5061)
const blowpipeAttackSeqs = { 0: 5061, 1: 5061, 2: 5061, 3: 5061 };

// Trident/Powered staff: Cast (1167)
const tridentAttackSeqs = { 0: 1167, 1: 1167, 2: 1167, 3: 1167 };

// Tumeken's shadow: Cast (9493)
const tumekenAttackSeqs = { 0: 9493, 1: 9493, 2: 9493, 3: 9493 };

// Salamanders: Scorch (5247), Flare (5247), Blaze (5247)
const salamanderAttackSeqs = { 0: 5247, 1: 5247, 2: 5247, 3: 5247 };

// Granite maul: Pound (1665)
const graniteMaulAttackSeqs = { 0: 1665, 1: 1665, 2: 1665, 3: 1665 };

// Verac's flail has unique stance (verified from cache: verac's flail 4755)
const veracFlailAnimOverrides = {
    idle: 2061, // standAnim from cache
    walk: 1830, // walkAnim from cache
    run: 824, // runAnim from cache
    block: 2063, // blockAnim from cache
};

// Verac's flail: Pound (2062)
const veracFlailAttackSeqs = { 0: 2062, 1: 2062, 2: 2062, 3: 2062 };

// Dharok's greataxe has unique stance (verified from cache: dharok's greataxe 4718)
const dharokAxeAnimOverrides = {
    idle: 2065, // barrow_dharok_ready
    walk: 2064, // barrow_dharok_walk
    run: 11466, // barrow_dharok_run
    block: 1666, // blockAnim from cache
};

// Dharok's greataxe: Slash (2066), Crush (2067) - Style 0,1,3 = slash, Style 2 = crush
const dharokAxeAttackSeqs = { 0: 2066, 1: 2066, 2: 2067, 3: 2066 };

// Torag's hammers use standard stance with different block (verified from cache: torag's hammers 4747)
const toragHammersAnimOverrides = {
    idle: 808, // standAnim from cache
    walk: 819, // walkAnim from cache
    run: 824, // runAnim from cache
    block: 424, // blockAnim from cache (different from warhammerAnimOverrides)
};

// Torag's hammers: Pound (2068)
const toragHammersAttackSeqs = { 0: 2068, 1: 2068, 2: 2068, 3: 2068 };

// Guthan's warspear has unique stance
const guthanSpearAnimOverrides = {
    idle: 2061, // barrow_guthan_ready
    walk: 2060, // barrow_guthan_walk
    run: 824, // generic run (no specific guthan run)
    block: 2063, // barrow_guthan_defend
};

// Guthan's warspear: Stab (2080), Swipe (2081), Lunge (2082)
const guthanSpearAttackSeqs = { 0: 2080, 1: 2081, 2: 2082, 3: 2080 };

// Karil's crossbow has unique stance
const karilCrossbowAnimOverrides = {
    idle: 2074, // barrows_repeating_crossbow_ready
    walk: 2076, // barrows_repeating_crossbow_walk
    run: 2077, // barrows_repeating_crossbow_run
    block: 424, // generic block
};

// Karil's crossbow: Fire (2075)
const karilCrossbowAttackSeqs = { 0: 2075, 1: 2075, 2: 2075, 3: 2075 };

// Ahrim's staff: Bash (2078)
const ahrimStaffAttackSeqs = { 0: 2078, 1: 2078, 2: 2078, 3: 2078 };

// Crystal bow: Fire (426)
const crystalBowAttackSeqs = { 0: 426, 1: 426, 2: 426, 3: 426 };

// Twisted bow: Fire (426)
const twistedBowAttackSeqs = { 0: 426, 1: 426, 2: 426, 3: 426 };

// Bow of faerdhinen: Fire (426)
const bowOfFaerdhinenAttackSeqs = { 0: 426, 1: 426, 2: 426, 3: 426 };

// Dragon warhammer: Pound (1378)
const dragonWarhammerAttackSeqs = { 0: 1378, 1: 1378, 2: 1378, 3: 1378 };

// ====================================================================================
// COMBAT STYLES PER WEAPON CATEGORY
// Defines attack type, XP mode, and style for each combat option
// ====================================================================================

// Unarmed: Punch, Kick, Block
const unarmedCombatStyles = {
    0: {
        name: "Punch",
        attackType: AttackType.CRUSH,
        xpMode: XpMode.ATTACK,
        attackStyle: AttackStyle.ACCURATE,
    },
    1: {
        name: "Kick",
        attackType: AttackType.CRUSH,
        xpMode: XpMode.STRENGTH,
        attackStyle: AttackStyle.AGGRESSIVE,
    },
    2: {
        name: "Block",
        attackType: AttackType.CRUSH,
        xpMode: XpMode.DEFENCE,
        attackStyle: AttackStyle.DEFENSIVE,
    },
} as const;

// Daggers: Stab, Lunge, Slash, Block
const daggerCombatStyles = {
    0: {
        name: "Stab",
        attackType: AttackType.STAB,
        xpMode: XpMode.ATTACK,
        attackStyle: AttackStyle.ACCURATE,
    },
    1: {
        name: "Lunge",
        attackType: AttackType.STAB,
        xpMode: XpMode.STRENGTH,
        attackStyle: AttackStyle.AGGRESSIVE,
    },
    2: {
        name: "Slash",
        attackType: AttackType.SLASH,
        xpMode: XpMode.STRENGTH,
        attackStyle: AttackStyle.AGGRESSIVE,
    },
    3: {
        name: "Block",
        attackType: AttackType.STAB,
        xpMode: XpMode.DEFENCE,
        attackStyle: AttackStyle.DEFENSIVE,
    },
} as const;

// Scimitars/Swords/Longswords: Chop, Slash, Lunge, Block
const scimitarCombatStyles = {
    0: {
        name: "Chop",
        attackType: AttackType.SLASH,
        xpMode: XpMode.ATTACK,
        attackStyle: AttackStyle.ACCURATE,
    },
    1: {
        name: "Slash",
        attackType: AttackType.SLASH,
        xpMode: XpMode.STRENGTH,
        attackStyle: AttackStyle.AGGRESSIVE,
    },
    2: {
        name: "Lunge",
        attackType: AttackType.STAB,
        xpMode: XpMode.SHARED,
        attackStyle: AttackStyle.CONTROLLED,
    },
    3: {
        name: "Block",
        attackType: AttackType.SLASH,
        xpMode: XpMode.DEFENCE,
        attackStyle: AttackStyle.DEFENSIVE,
    },
} as const;

// Maces: Pound, Pummel, Spike, Block
const maceCombatStyles = {
    0: {
        name: "Pound",
        attackType: AttackType.CRUSH,
        xpMode: XpMode.ATTACK,
        attackStyle: AttackStyle.ACCURATE,
    },
    1: {
        name: "Pummel",
        attackType: AttackType.CRUSH,
        xpMode: XpMode.STRENGTH,
        attackStyle: AttackStyle.AGGRESSIVE,
    },
    2: {
        name: "Spike",
        attackType: AttackType.STAB,
        xpMode: XpMode.SHARED,
        attackStyle: AttackStyle.CONTROLLED,
    },
    3: {
        name: "Block",
        attackType: AttackType.CRUSH,
        xpMode: XpMode.DEFENCE,
        attackStyle: AttackStyle.DEFENSIVE,
    },
} as const;

// Warhammers/Mauls: Pound, Pummel, Block
const hammerCombatStyles = {
    0: {
        name: "Pound",
        attackType: AttackType.CRUSH,
        xpMode: XpMode.ATTACK,
        attackStyle: AttackStyle.ACCURATE,
    },
    1: {
        name: "Pummel",
        attackType: AttackType.CRUSH,
        xpMode: XpMode.STRENGTH,
        attackStyle: AttackStyle.AGGRESSIVE,
    },
    2: {
        name: "Block",
        attackType: AttackType.CRUSH,
        xpMode: XpMode.DEFENCE,
        attackStyle: AttackStyle.DEFENSIVE,
    },
} as const;

// Battleaxes/Axes: Chop, Hack, Smash, Block
const axeCombatStyles = {
    0: {
        name: "Chop",
        attackType: AttackType.SLASH,
        xpMode: XpMode.ATTACK,
        attackStyle: AttackStyle.ACCURATE,
    },
    1: {
        name: "Hack",
        attackType: AttackType.SLASH,
        xpMode: XpMode.STRENGTH,
        attackStyle: AttackStyle.AGGRESSIVE,
    },
    2: {
        name: "Smash",
        attackType: AttackType.CRUSH,
        xpMode: XpMode.STRENGTH,
        attackStyle: AttackStyle.AGGRESSIVE,
    },
    3: {
        name: "Block",
        attackType: AttackType.SLASH,
        xpMode: XpMode.DEFENCE,
        attackStyle: AttackStyle.DEFENSIVE,
    },
} as const;

// 2H Swords/Godswords: Chop, Slash, Smash, Block
const twoHandedSwordCombatStyles = {
    0: {
        name: "Chop",
        attackType: AttackType.SLASH,
        xpMode: XpMode.ATTACK,
        attackStyle: AttackStyle.ACCURATE,
    },
    1: {
        name: "Slash",
        attackType: AttackType.SLASH,
        xpMode: XpMode.STRENGTH,
        attackStyle: AttackStyle.AGGRESSIVE,
    },
    2: {
        name: "Smash",
        attackType: AttackType.CRUSH,
        xpMode: XpMode.STRENGTH,
        attackStyle: AttackStyle.AGGRESSIVE,
    },
    3: {
        name: "Block",
        attackType: AttackType.SLASH,
        xpMode: XpMode.DEFENCE,
        attackStyle: AttackStyle.DEFENSIVE,
    },
} as const;

// Spears: Lunge, Swipe, Pound, Block
const spearCombatStyles = {
    0: {
        name: "Lunge",
        attackType: AttackType.STAB,
        xpMode: XpMode.SHARED,
        attackStyle: AttackStyle.CONTROLLED,
    },
    1: {
        name: "Swipe",
        attackType: AttackType.SLASH,
        xpMode: XpMode.SHARED,
        attackStyle: AttackStyle.CONTROLLED,
    },
    2: {
        name: "Pound",
        attackType: AttackType.CRUSH,
        xpMode: XpMode.SHARED,
        attackStyle: AttackStyle.CONTROLLED,
    },
    3: {
        name: "Block",
        attackType: AttackType.STAB,
        xpMode: XpMode.DEFENCE,
        attackStyle: AttackStyle.DEFENSIVE,
    },
} as const;

// Halberds: Jab, Swipe, Fend
const halberdCombatStyles = {
    0: {
        name: "Jab",
        attackType: AttackType.STAB,
        xpMode: XpMode.SHARED,
        attackStyle: AttackStyle.CONTROLLED,
    },
    1: {
        name: "Swipe",
        attackType: AttackType.SLASH,
        xpMode: XpMode.STRENGTH,
        attackStyle: AttackStyle.AGGRESSIVE,
    },
    2: {
        name: "Fend",
        attackType: AttackType.STAB,
        xpMode: XpMode.DEFENCE,
        attackStyle: AttackStyle.DEFENSIVE,
    },
} as const;

// Pickaxes: Spike, Impale, Smash, Block
const pickaxeCombatStyles = {
    0: {
        name: "Spike",
        attackType: AttackType.STAB,
        xpMode: XpMode.ATTACK,
        attackStyle: AttackStyle.ACCURATE,
    },
    1: {
        name: "Impale",
        attackType: AttackType.STAB,
        xpMode: XpMode.STRENGTH,
        attackStyle: AttackStyle.AGGRESSIVE,
    },
    2: {
        name: "Smash",
        attackType: AttackType.CRUSH,
        xpMode: XpMode.STRENGTH,
        attackStyle: AttackStyle.AGGRESSIVE,
    },
    3: {
        name: "Block",
        attackType: AttackType.STAB,
        xpMode: XpMode.DEFENCE,
        attackStyle: AttackStyle.DEFENSIVE,
    },
} as const;

// Claws: Chop, Slash, Lunge, Block
const clawCombatStyles = {
    0: {
        name: "Chop",
        attackType: AttackType.SLASH,
        xpMode: XpMode.ATTACK,
        attackStyle: AttackStyle.ACCURATE,
    },
    1: {
        name: "Slash",
        attackType: AttackType.SLASH,
        xpMode: XpMode.STRENGTH,
        attackStyle: AttackStyle.AGGRESSIVE,
    },
    2: {
        name: "Lunge",
        attackType: AttackType.STAB,
        xpMode: XpMode.SHARED,
        attackStyle: AttackStyle.CONTROLLED,
    },
    3: {
        name: "Block",
        attackType: AttackType.SLASH,
        xpMode: XpMode.DEFENCE,
        attackStyle: AttackStyle.DEFENSIVE,
    },
} as const;

// Whips: Flick, Lash, Deflect
const whipCombatStyles = {
    0: {
        name: "Flick",
        attackType: AttackType.SLASH,
        xpMode: XpMode.ATTACK,
        attackStyle: AttackStyle.ACCURATE,
    },
    1: {
        name: "Lash",
        attackType: AttackType.SLASH,
        xpMode: XpMode.SHARED,
        attackStyle: AttackStyle.CONTROLLED,
    },
    2: {
        name: "Deflect",
        attackType: AttackType.SLASH,
        xpMode: XpMode.DEFENCE,
        attackStyle: AttackStyle.DEFENSIVE,
    },
} as const;

// Staves (melee): Bash, Pound, Focus
const staffCombatStyles = {
    0: {
        name: "Bash",
        attackType: AttackType.CRUSH,
        xpMode: XpMode.ATTACK,
        attackStyle: AttackStyle.ACCURATE,
    },
    1: {
        name: "Pound",
        attackType: AttackType.CRUSH,
        xpMode: XpMode.STRENGTH,
        attackStyle: AttackStyle.AGGRESSIVE,
    },
    2: {
        name: "Focus",
        attackType: AttackType.CRUSH,
        xpMode: XpMode.DEFENCE,
        attackStyle: AttackStyle.DEFENSIVE,
    },
} as const;

// Bows: Accurate, Rapid, Longrange
const bowCombatStyles = {
    0: {
        name: "Accurate",
        attackType: AttackType.RANGED,
        xpMode: XpMode.RANGED,
        attackStyle: AttackStyle.ACCURATE,
    },
    1: {
        name: "Rapid",
        attackType: AttackType.RANGED,
        xpMode: XpMode.RANGED,
        attackStyle: AttackStyle.RAPID,
    },
    2: {
        name: "Longrange",
        attackType: AttackType.RANGED,
        xpMode: XpMode.RANGED_DEFENCE,
        attackStyle: AttackStyle.LONGRANGE,
    },
} as const;

// Crossbows: Accurate, Rapid, Longrange
const crossbowCombatStyles = {
    0: {
        name: "Accurate",
        attackType: AttackType.RANGED,
        xpMode: XpMode.RANGED,
        attackStyle: AttackStyle.ACCURATE,
    },
    1: {
        name: "Rapid",
        attackType: AttackType.RANGED,
        xpMode: XpMode.RANGED,
        attackStyle: AttackStyle.RAPID,
    },
    2: {
        name: "Longrange",
        attackType: AttackType.RANGED,
        xpMode: XpMode.RANGED_DEFENCE,
        attackStyle: AttackStyle.LONGRANGE,
    },
} as const;

// Thrown: Accurate, Rapid, Longrange
const thrownCombatStyles = {
    0: {
        name: "Accurate",
        attackType: AttackType.RANGED,
        xpMode: XpMode.RANGED,
        attackStyle: AttackStyle.ACCURATE,
    },
    1: {
        name: "Rapid",
        attackType: AttackType.RANGED,
        xpMode: XpMode.RANGED,
        attackStyle: AttackStyle.RAPID,
    },
    2: {
        name: "Longrange",
        attackType: AttackType.RANGED,
        xpMode: XpMode.RANGED_DEFENCE,
        attackStyle: AttackStyle.LONGRANGE,
    },
} as const;

// Dark bow: Accurate, Longrange (NO rapid style - )
const darkBowCombatStyles = {
    0: {
        name: "Accurate",
        attackType: AttackType.RANGED,
        xpMode: XpMode.RANGED,
        attackStyle: AttackStyle.ACCURATE,
    },
    1: {
        name: "Longrange",
        attackType: AttackType.RANGED,
        xpMode: XpMode.RANGED_DEFENCE,
        attackStyle: AttackStyle.LONGRANGE,
    },
} as const;

// Heavy ballista: Accurate, Longrange (NO rapid style - )
const heavyBallistaCombatStyles = {
    0: {
        name: "Accurate",
        attackType: AttackType.RANGED,
        xpMode: XpMode.RANGED,
        attackStyle: AttackStyle.ACCURATE,
    },
    1: {
        name: "Longrange",
        attackType: AttackType.RANGED,
        xpMode: XpMode.RANGED_DEFENCE,
        attackStyle: AttackStyle.LONGRANGE,
    },
} as const;

// Chinchompas: Short fuse, Medium fuse, Long fuse
const chinchompaCombatStyles = {
    0: {
        name: "Short fuse",
        attackType: AttackType.RANGED,
        xpMode: XpMode.RANGED,
        attackStyle: AttackStyle.ACCURATE,
    },
    1: {
        name: "Medium fuse",
        attackType: AttackType.RANGED,
        xpMode: XpMode.RANGED,
        attackStyle: AttackStyle.RAPID,
    },
    2: {
        name: "Long fuse",
        attackType: AttackType.RANGED,
        xpMode: XpMode.RANGED_DEFENCE,
        attackStyle: AttackStyle.LONGRANGE,
    },
} as const;

// Salamanders: Scorch (slash/str), Flare (ranged), Blaze (magic)
const salamanderCombatStyles = {
    0: {
        name: "Scorch",
        attackType: AttackType.SLASH,
        xpMode: XpMode.STRENGTH,
        attackStyle: AttackStyle.AGGRESSIVE,
    },
    1: {
        name: "Flare",
        attackType: AttackType.RANGED,
        xpMode: XpMode.RANGED,
        attackStyle: AttackStyle.ACCURATE,
    },
    2: {
        name: "Blaze",
        attackType: AttackType.MAGIC,
        xpMode: XpMode.MAGIC,
        attackStyle: AttackStyle.ACCURATE,
    },
} as const;

// Scythes: Reap, Chop, Jab, Block
const scytheCombatStyles = {
    0: {
        name: "Reap",
        attackType: AttackType.SLASH,
        xpMode: XpMode.ATTACK,
        attackStyle: AttackStyle.ACCURATE,
    },
    1: {
        name: "Chop",
        attackType: AttackType.SLASH,
        xpMode: XpMode.STRENGTH,
        attackStyle: AttackStyle.AGGRESSIVE,
    },
    2: {
        name: "Jab",
        attackType: AttackType.CRUSH,
        xpMode: XpMode.STRENGTH,
        attackStyle: AttackStyle.AGGRESSIVE,
    },
    3: {
        name: "Block",
        attackType: AttackType.SLASH,
        xpMode: XpMode.DEFENCE,
        attackStyle: AttackStyle.DEFENSIVE,
    },
} as const;

// Bludgeon: All aggressive crush
const bludgeonCombatStyles = {
    0: {
        name: "Pound",
        attackType: AttackType.CRUSH,
        xpMode: XpMode.STRENGTH,
        attackStyle: AttackStyle.AGGRESSIVE,
    },
    1: {
        name: "Pummel",
        attackType: AttackType.CRUSH,
        xpMode: XpMode.STRENGTH,
        attackStyle: AttackStyle.AGGRESSIVE,
    },
    2: {
        name: "Smash",
        attackType: AttackType.CRUSH,
        xpMode: XpMode.STRENGTH,
        attackStyle: AttackStyle.AGGRESSIVE,
    },
} as const;

// Bulwark: Pummel, Block (Block is not an attack)
const bulwarkCombatStyles = {
    0: {
        name: "Pummel",
        attackType: AttackType.CRUSH,
        xpMode: XpMode.ATTACK,
        attackStyle: AttackStyle.ACCURATE,
    },
    1: {
        name: "Block",
        attackType: AttackType.CRUSH,
        xpMode: XpMode.DEFENCE,
        attackStyle: AttackStyle.DEFENSIVE,
    },
} as const;

// Powered staves (Trident, etc.): Accurate, Accurate, Longrange
const poweredStaffCombatStyles = {
    0: {
        name: "Accurate",
        attackType: AttackType.MAGIC,
        xpMode: XpMode.MAGIC,
        attackStyle: AttackStyle.ACCURATE,
    },
    1: {
        name: "Accurate",
        attackType: AttackType.MAGIC,
        xpMode: XpMode.MAGIC,
        attackStyle: AttackStyle.ACCURATE,
    },
    2: {
        name: "Longrange",
        attackType: AttackType.MAGIC,
        xpMode: XpMode.MAGIC_DEFENCE,
        attackStyle: AttackStyle.LONGRANGE,
    },
} as const;

// ====================================================================================
// SPECIAL ATTACK DATA
// Animation IDs and energy costs for weapons with special attacks
// ====================================================================================

const specialAttacks = {
    // Daggers
    DRAGON_DAGGER: { anim: 1062, cost: 25 }, // Puncture
    ABYSSAL_DAGGER: { anim: 3300, cost: 50 }, // Abyssal Puncture

    // Swords
    DRAGON_LONGSWORD: { anim: 1058, cost: 25 }, // Cleave
    DRAGON_SWORD: { anim: 7515, cost: 40 }, // Wild Stab

    // Scimitars
    DRAGON_SCIMITAR: { anim: 1872, cost: 55 }, // Sever

    // Maces
    DRAGON_MACE: { anim: 1060, cost: 25 }, // Shatter
    ANCIENT_MACE: { anim: 6147, cost: 100 }, // Favour of the War God

    // Warhammers
    DRAGON_WARHAMMER: { anim: 1378, cost: 50 }, // Smash
    STATIUS_WARHAMMER: { anim: 1378, cost: 35 }, // Smash

    // Battleaxes
    DRAGON_BATTLEAXE: { anim: 1056, cost: 100 }, // Rampage

    // 2H Swords
    DRAGON_2H: { anim: 3157, cost: 60 }, // Powerstab
    SARADOMIN_SWORD: { anim: 1132, cost: 100 }, // Saradomin's Lightning

    // Godswords
    ARMADYL_GODSWORD: { anim: 7644, cost: 50 }, // The Judgement
    BANDOS_GODSWORD: { anim: 7642, cost: 50 }, // Warstrike
    SARADOMIN_GODSWORD: { anim: 7640, cost: 50 }, // Healing Blade
    ZAMORAK_GODSWORD: { anim: 7638, cost: 50 }, // Ice Cleave
    ANCIENT_GODSWORD: { anim: 9171, cost: 50 }, // Blood Sacrifice

    // Spears
    DRAGON_SPEAR: { anim: 1064, cost: 25 }, // Shove
    ZAMORAKIAN_SPEAR: { anim: 1064, cost: 25 }, // Shove

    // Halberds
    DRAGON_HALBERD: { anim: 1203, cost: 30 }, // Sweep
    CRYSTAL_HALBERD: { anim: 1203, cost: 30 }, // Sweep

    // Claws
    DRAGON_CLAWS: { anim: 7514, cost: 50 }, // Slice and Dice

    // Whips
    ABYSSAL_WHIP: { anim: 1658, cost: 50 }, // Energy Drain
    ABYSSAL_TENTACLE: { anim: 1658, cost: 50 }, // Energy Drain

    // Mauls
    GRANITE_MAUL: { anim: 1667, cost: 50 }, // Quick Smash (60% without ornate handle)
    ELDER_MAUL: { anim: 7516, cost: 50 }, // Greater Smash

    // Special melee
    GHRAZI_RAPIER: { anim: 8145, cost: 0 }, // No special attack (placeholder)
    INQUISITORS_MACE: { anim: 4503, cost: 0 }, // No special attack
    BLADE_OF_SAELDOR: { anim: 390, cost: 0 }, // No special attack
    OSMUMTENS_FANG: { anim: 9471, cost: 0 }, // No special attack
    SCYTHE_OF_VITUR: { anim: 8056, cost: 0 }, // No special attack
    DINHS_BULWARK: { anim: 7511, cost: 50 }, // Shield Bash
    ABYSSAL_BLUDGEON: { anim: 3298, cost: 50 }, // Penance

    // Bows
    MAGIC_SHORTBOW: { anim: 1074, cost: 55 }, // Snapshot (50% with imbue)
    MAGIC_LONGBOW: { anim: 426, cost: 35 }, // Powershot
    DARK_BOW: { anim: 426, cost: 55 }, // Descent of Darkness
    TWISTED_BOW: { anim: 426, cost: 0 }, // No special attack

    // Crossbows
    DRAGON_CROSSBOW: { anim: 4230, cost: 60 }, // Annihilate
    ARMADYL_CROSSBOW: { anim: 4230, cost: 40 }, // Armadyl Eye
    ZARYTE_CROSSBOW: { anim: 9168, cost: 75 }, // Zaryte Bolts

    // Ballistas
    LIGHT_BALLISTA: { anim: 7555, cost: 65 }, // Concentrated Shot
    HEAVY_BALLISTA: { anim: 7555, cost: 65 }, // Concentrated Shot

    // Thrown
    TOXIC_BLOWPIPE: { anim: 5061, cost: 50 }, // Toxic Siphon
    DRAGON_THROWNAXE: { anim: 929, cost: 25 }, // Ricochet
    DRAGON_KNIFE: { anim: 929, cost: 25 }, // Vicious Strike

    // Barrows
    DHAROKS_GREATAXE: { anim: 2067, cost: 0 }, // Wretched Strength (passive)
    TORAGS_HAMMERS: { anim: 2068, cost: 0 }, // Corruption (passive)
    GUTHANS_WARSPEAR: { anim: 2080, cost: 0 }, // Infestation (passive)
    VERACS_FLAIL: { anim: 2062, cost: 0 }, // Defiler (passive)
    KARILS_CROSSBOW: { anim: 2075, cost: 0 }, // Tainted Shot (passive)
    AHRIMS_STAFF: { anim: 2078, cost: 0 }, // Blighted Aura (passive)
} as const;

// ====================================================================================
// COMBAT HIT SOUNDS
// Per-attack-type sounds (stab/slash/crush) for each weapon category
// Sound IDs from synth-names.json
// ====================================================================================

/** Generic miss sound for all weapons */
export const MISS_SOUND = 2521;

/** Unarmed/punch sounds */
const unarmedHitSounds = { crush: 2513 }; // boxing_glove

/** Dagger/short sword hit sounds (hacksword) */
const daggerHitSounds = { stab: 2501, slash: 2500, crush: 2499 };

/** Sword/scimitar/longsword hit sounds (hacksword) */
const swordHitSounds = { stab: 2501, slash: 2500, crush: 2499 };

/** Mace hit sounds */
const maceHitSounds = { stab: 2509, crush: 2508 };

/** Warhammer/maul hit sounds */
const warhammerHitSounds = { crush: 2567 };

/** Battleaxe hit sounds */
const battleaxeHitSounds = { slash: 2498, crush: 2497 };

/** 2H sword hit sounds */
const twoHandedSwordHitSounds = { stab: 2504, slash: 2503, crush: 2502 };

/** Godsword hit sounds */
const godswordHitSounds = { stab: 3881, slash: 3847, crush: 3846 };

/** Spear hit sounds (uses stabsword) */
const spearHitSounds = { stab: 2549, slash: 2548, crush: 2547 };

/** Halberd hit sounds (uses stabsword) */
const halberdHitSounds = { stab: 2549, slash: 2548 };

/** Staff hit sounds */
const staffHitSounds = { stab: 2562, crush: 2556 };

/** Whip hit sounds */
const whipHitSounds = { slash: 2720 };

/** Claw hit sounds (uses hacksword for generic claws) */
const clawHitSounds = { stab: 2501, slash: 2500 };

/** Dragon claws hit sounds (dragonclaws_normal) */
const dragonClawsHitSounds = { stab: 4139, slash: 4139 };

/** Pickaxe hit sounds (uses hacksword) */
const pickaxeHitSounds = { stab: 2501, crush: 2499 };

/** Scythe hit sounds */
const scytheHitSounds = { stab: 2525, slash: 2524 };

/** Keris hit sounds */
const kerisHitSounds = { stab: 2507, slash: 2506, crush: 2505 };

/** Dharok's greataxe hit sounds */
const dharokHitSounds = { slash: 1321, crush: 1316 };

/** Torag's hammers hit sounds */
const toragHitSounds = { crush: 1332 };

/** Verac's flail hit sounds */
const veracHitSounds = { stab: 1337, slash: 1336, crush: 1335 };

/** Karil's crossbow hit sounds (uses default ranged) */
const karilHitSounds = { crush: 1323 }; // flail_crush for melee component

/** TzHaar weapons */
const tzhaarHitSounds = { crush: 2520 }; // tzhaar_ket_om_crush

/** Powered staves (Trident, Sang staff, Tumeken's shadow) - magic attack */
const poweredStaffHitSounds = { crush: 2540 }; // sever sound for magic attacks

// ====================================================================================
// RANGED WEAPON SOUNDS
// OSRS uses specific sounds for different bow/crossbow/thrown weapon types
// ====================================================================================

// --- BOW SOUNDS ---
/** Shortbow attack sound (arrow release) */
const shortbowHitSounds = { ranged: 2702 }; // shortbow

/** Longbow attack sound */
const longbowHitSounds = { ranged: 2700 }; // longbow

/** Crystal bow attack sound */
const crystalBowHitSounds = { ranged: 1351 }; // crystal_bow

/** Dark bow attack sound (normal attack - always fires 2 arrows) */
const darkBowHitSounds = { ranged: 3732 }; // darkbow_doublefire_new

/** Dark bow special attack sounds */
export const DARK_BOW_SOUNDS = {
    doubleFire: 3732, // darkbow_doublefire_new (normal attack, 2 arrows)
    dragonAttack: 3733, // darkbow_dragon_attack (dragon arrows spec)
    shadowAttack: 3736, // darkbow_shadow_attack (regular arrows spec)
    impact: 3735, // darkbow_impact (hit sound)
    shadowImpact: 3737, // darkbow_shadow_impact (regular arrows hit)
    equip: 3738, // equip_darkbow (equip sound)
};

/** Ogre bow / Comp ogre bow attack sound */
const ogreBowHitSounds = { ranged: 1452 }; // ogre_bow

/** Craw's bow / Webweaver bow (wilderness bows) */
const wildernessBowHitSounds = { ranged: 2702 }; // uses shortbow sound

/** 3rd age bow attack sound */
const thirdAgeBowHitSounds = { ranged: 2700 }; // longbow

/** Venator bow attack sound */
const venatorBowHitSounds = { ranged: 2702 }; // shortbow

/** Twisted bow attack sound (unique) */
const twistedBowHitSounds = { ranged: 2700 }; // longbow

// --- CROSSBOW SOUNDS ---
/** Standard crossbow attack sound */
const crossbowHitSounds = { ranged: 2695 }; // crossbow

/** Diamond bolt special sound */
export const CROSSBOW_BOLT_SOUNDS = {
    standard: 2695, // crossbow (bolt fire)
    diamond: 2913, // crossbow_diamond (enchanted bolt proc)
    grappling: 2928, // crossbow_grappling
    grappleSplash: 2929, // crossbow_grapple_splash
};

/** Karil's crossbow attack sound */
const karilCrossbowHitSounds = { ranged: 2695 }; // crossbow (same as standard)

/** Dorgeshuun crossbow attack sound */
const dorgeshuunCrossbowHitSounds = { ranged: 2695 }; // crossbow

/** Zaryte crossbow uses standard crossbow sound */
const zaryteCrossbowHitSounds = { ranged: 2695 }; // crossbow

// --- THROWN WEAPON SOUNDS ---
/** Dart attack sound */
const dartHitSounds = { ranged: 2696 }; // dart

/** Throwing knife attack sound */
const knifeHitSounds = { ranged: 2707 }; // throwingknife

/** Throwing axe attack sound */
const thrownaxeHitSounds = { ranged: 2708 }; // thrown

/** Javelin attack sound */
const javelinHitSounds = { ranged: 2699 }; // javelin

/** Generic thrown weapon sound (legacy compatibility) */
const thrownHitSounds = { ranged: 2696 }; // dart (fallback)

// --- SPECIAL RANGED SOUNDS ---
/** Blowpipe attack sound */
const blowpipeHitSounds = { ranged: 5765 }; // blowpipe dart

/** Ballista attack sound */
const ballistaHitSounds = { ranged: 2699 }; // javelin (ballistas fire javelins)

/** Chinchompa sounds */
const chinchompaHitSounds = { ranged: 359 }; // chinchompa_attack
export const CHINCHOMPA_SOUNDS = {
    attack: 359, // chinchompa_attack (throw)
    explode: 360, // chinchompa_explode (impact explosion)
    hit: 361, // chinchompa_hit (damage dealt)
    trapped: 362, // chinchompa_trapped (catching)
};

// --- ARROW/BOLT IMPACT SOUNDS ---
/** Arrow impact sounds (for hit confirmation) */
export const ARROW_IMPACT_SOUNDS = {
    standard: 2693, // arrowlaunch2 (can double as impact)
    launch: 2692, // arrow_launch
    slayer: 2703, // slayer_arrow
};

/** Magic dart sounds */
export const MAGIC_DART_SOUNDS = {
    fire: 1718, // magic_dart_fire
    hit: 174, // magic_dart_hit
};

// ====================================================================================
// WEAPON DATA ENTRIES
// Organized by combat category for easier maintenance
// ====================================================================================

export const weaponDataEntries: WeaponDataEntry[] = [
    // ==================================================================================
    // DAGGERS / STAB SWORD (Combat Category 17)
    // Attack Speed: 4 ticks
    // Styles: Stab (0), Stab (1), Slash (2), Stab (3)
    // ==================================================================================
    {
        itemId: 1205,
        name: "Bronze dagger",
        equipmentType: "dagger",
        combatCategory: CombatCategory.DAGGER,
        animOverrides: daggerAnimOverrides,
        attackSequences: regularDaggerAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: daggerHitSounds,
    },
    {
        itemId: 1203,
        name: "Iron dagger",
        equipmentType: "dagger",
        combatCategory: CombatCategory.DAGGER,
        animOverrides: daggerAnimOverrides,
        attackSequences: regularDaggerAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: daggerHitSounds,
    },
    {
        itemId: 1207,
        name: "Steel dagger",
        equipmentType: "dagger",
        combatCategory: CombatCategory.DAGGER,
        animOverrides: daggerAnimOverrides,
        attackSequences: regularDaggerAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: daggerHitSounds,
    },
    {
        itemId: 1217,
        name: "Black dagger",
        equipmentType: "dagger",
        combatCategory: CombatCategory.DAGGER,
        animOverrides: daggerAnimOverrides,
        attackSequences: regularDaggerAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: daggerHitSounds,
    },
    {
        itemId: 1209,
        name: "Mithril dagger",
        equipmentType: "dagger",
        combatCategory: CombatCategory.DAGGER,
        animOverrides: daggerAnimOverrides,
        attackSequences: regularDaggerAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: daggerHitSounds,
    },
    {
        itemId: 1211,
        name: "Adamant dagger",
        equipmentType: "dagger",
        combatCategory: CombatCategory.DAGGER,
        animOverrides: daggerAnimOverrides,
        attackSequences: regularDaggerAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: daggerHitSounds,
    },
    {
        itemId: 1213,
        name: "Rune dagger",
        equipmentType: "dagger",
        combatCategory: CombatCategory.DAGGER,
        animOverrides: daggerAnimOverrides,
        attackSequences: regularDaggerAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: daggerHitSounds,
    },
    // Poisoned regular daggers only override attack sequences here.
    {
        itemId: 1219,
        name: "Iron dagger(p)",
        equipmentType: "dagger",
        combatCategory: CombatCategory.DAGGER,
        attackSequences: regularDaggerAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: daggerHitSounds,
    },
    {
        itemId: 1221,
        name: "Bronze dagger(p)",
        equipmentType: "dagger",
        combatCategory: CombatCategory.DAGGER,
        attackSequences: regularDaggerAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: daggerHitSounds,
    },
    {
        itemId: 1223,
        name: "Steel dagger(p)",
        equipmentType: "dagger",
        combatCategory: CombatCategory.DAGGER,
        attackSequences: regularDaggerAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: daggerHitSounds,
    },
    {
        itemId: 1225,
        name: "Mithril dagger(p)",
        equipmentType: "dagger",
        combatCategory: CombatCategory.DAGGER,
        attackSequences: regularDaggerAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: daggerHitSounds,
    },
    {
        itemId: 1227,
        name: "Adamant dagger(p)",
        equipmentType: "dagger",
        combatCategory: CombatCategory.DAGGER,
        attackSequences: regularDaggerAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: daggerHitSounds,
    },
    {
        itemId: 1229,
        name: "Rune dagger(p)",
        equipmentType: "dagger",
        combatCategory: CombatCategory.DAGGER,
        attackSequences: regularDaggerAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: daggerHitSounds,
    },
    {
        itemId: 1233,
        name: "Black dagger(p)",
        equipmentType: "dagger",
        combatCategory: CombatCategory.DAGGER,
        attackSequences: regularDaggerAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: daggerHitSounds,
    },
    {
        itemId: 5668,
        name: "Iron dagger(p+)",
        equipmentType: "dagger",
        combatCategory: CombatCategory.DAGGER,
        attackSequences: regularDaggerAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: daggerHitSounds,
    },
    {
        itemId: 5670,
        name: "Bronze dagger(p+)",
        equipmentType: "dagger",
        combatCategory: CombatCategory.DAGGER,
        attackSequences: regularDaggerAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: daggerHitSounds,
    },
    {
        itemId: 5672,
        name: "Steel dagger(p+)",
        equipmentType: "dagger",
        combatCategory: CombatCategory.DAGGER,
        attackSequences: regularDaggerAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: daggerHitSounds,
    },
    {
        itemId: 5674,
        name: "Mithril dagger(p+)",
        equipmentType: "dagger",
        combatCategory: CombatCategory.DAGGER,
        attackSequences: regularDaggerAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: daggerHitSounds,
    },
    {
        itemId: 5676,
        name: "Adamant dagger(p+)",
        equipmentType: "dagger",
        combatCategory: CombatCategory.DAGGER,
        attackSequences: regularDaggerAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: daggerHitSounds,
    },
    {
        itemId: 5678,
        name: "Rune dagger(p+)",
        equipmentType: "dagger",
        combatCategory: CombatCategory.DAGGER,
        attackSequences: regularDaggerAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: daggerHitSounds,
    },
    {
        itemId: 5682,
        name: "Black dagger(p+)",
        equipmentType: "dagger",
        combatCategory: CombatCategory.DAGGER,
        attackSequences: regularDaggerAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: daggerHitSounds,
    },
    {
        itemId: 5686,
        name: "Iron dagger(p++)",
        equipmentType: "dagger",
        combatCategory: CombatCategory.DAGGER,
        attackSequences: regularDaggerAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: daggerHitSounds,
    },
    {
        itemId: 5688,
        name: "Bronze dagger(p++)",
        equipmentType: "dagger",
        combatCategory: CombatCategory.DAGGER,
        attackSequences: regularDaggerAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: daggerHitSounds,
    },
    {
        itemId: 5690,
        name: "Steel dagger(p++)",
        equipmentType: "dagger",
        combatCategory: CombatCategory.DAGGER,
        attackSequences: regularDaggerAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: daggerHitSounds,
    },
    {
        itemId: 5692,
        name: "Mithril dagger(p++)",
        equipmentType: "dagger",
        combatCategory: CombatCategory.DAGGER,
        attackSequences: regularDaggerAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: daggerHitSounds,
    },
    {
        itemId: 5694,
        name: "Adamant dagger(p++)",
        equipmentType: "dagger",
        combatCategory: CombatCategory.DAGGER,
        attackSequences: regularDaggerAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: daggerHitSounds,
    },
    {
        itemId: 5696,
        name: "Rune dagger(p++)",
        equipmentType: "dagger",
        combatCategory: CombatCategory.DAGGER,
        attackSequences: regularDaggerAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: daggerHitSounds,
    },
    {
        itemId: 5700,
        name: "Black dagger(p++)",
        equipmentType: "dagger",
        combatCategory: CombatCategory.DAGGER,
        attackSequences: regularDaggerAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: daggerHitSounds,
    },
    {
        itemId: 1215,
        name: "Dragon dagger",
        equipmentType: "dagger",
        combatCategory: CombatCategory.DAGGER,
        animOverrides: daggerAnimOverrides,
        attackSequences: dragonDaggerAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: daggerHitSounds,
    },
    {
        itemId: 1231,
        name: "Dragon dagger(p)",
        equipmentType: "dagger",
        combatCategory: CombatCategory.DAGGER,
        animOverrides: daggerAnimOverrides,
        attackSequences: dragonDaggerAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: daggerHitSounds,
    },
    {
        itemId: 5680,
        name: "Dragon dagger(p+)",
        equipmentType: "dagger",
        combatCategory: CombatCategory.DAGGER,
        animOverrides: daggerAnimOverrides,
        attackSequences: dragonDaggerAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: daggerHitSounds,
    },
    {
        itemId: 5698,
        name: "Dragon dagger(p++)",
        equipmentType: "dagger",
        combatCategory: CombatCategory.DAGGER,
        animOverrides: daggerAnimOverrides,
        attackSequences: dragonDaggerAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: daggerHitSounds,
    },
    {
        itemId: 20407,
        name: "Dragon dagger",
        equipmentType: "dagger",
        combatCategory: CombatCategory.DAGGER,
        animOverrides: daggerAnimOverrides,
        attackSequences: dragonDaggerAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: daggerHitSounds,
    },
    {
        itemId: 13265,
        name: "Abyssal dagger",
        equipmentType: "dagger",
        combatCategory: CombatCategory.DAGGER,
        animOverrides: abyssalDaggerAnimOverrides,
        attackSequences: abyssalDaggerAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: daggerHitSounds,
    },
    {
        itemId: 13267,
        name: "Abyssal dagger (p+)",
        equipmentType: "dagger",
        combatCategory: CombatCategory.DAGGER,
        animOverrides: abyssalDaggerAnimOverrides,
        attackSequences: abyssalDaggerAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: daggerHitSounds,
    },
    {
        itemId: 13269,
        name: "Abyssal dagger (p++)",
        equipmentType: "dagger",
        combatCategory: CombatCategory.DAGGER,
        animOverrides: abyssalDaggerAnimOverrides,
        attackSequences: abyssalDaggerAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: daggerHitSounds,
    },

    // ==================================================================================
    // SWORDS (Combat Category 9) - Short Swords
    // Attack Speed: 4 ticks
    // Styles: Slash (0), Slash (1), Stab (2), Slash (3)
    // ==================================================================================
    {
        itemId: 1277,
        name: "Bronze sword",
        equipmentType: "sword",
        combatCategory: CombatCategory.SCIMITAR,
        animOverrides: swordAnimOverrides,
        attackSequences: swordAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: swordHitSounds,
    },
    {
        itemId: 1279,
        name: "Iron sword",
        equipmentType: "sword",
        combatCategory: CombatCategory.SCIMITAR,
        animOverrides: swordAnimOverrides,
        attackSequences: swordAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: swordHitSounds,
    },
    {
        itemId: 1281,
        name: "Steel sword",
        equipmentType: "sword",
        combatCategory: CombatCategory.SCIMITAR,
        animOverrides: swordAnimOverrides,
        attackSequences: swordAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: swordHitSounds,
    },
    {
        itemId: 1283,
        name: "Black sword",
        equipmentType: "sword",
        combatCategory: CombatCategory.SCIMITAR,
        animOverrides: swordAnimOverrides,
        attackSequences: swordAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: swordHitSounds,
    },
    {
        itemId: 1285,
        name: "Mithril sword",
        equipmentType: "sword",
        combatCategory: CombatCategory.SCIMITAR,
        animOverrides: swordAnimOverrides,
        attackSequences: swordAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: swordHitSounds,
    },
    {
        itemId: 1287,
        name: "Adamant sword",
        equipmentType: "sword",
        combatCategory: CombatCategory.SCIMITAR,
        animOverrides: swordAnimOverrides,
        attackSequences: swordAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: swordHitSounds,
    },
    {
        itemId: 1289,
        name: "Rune sword",
        equipmentType: "sword",
        combatCategory: CombatCategory.SCIMITAR,
        animOverrides: swordAnimOverrides,
        attackSequences: swordAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: swordHitSounds,
    },

    // ==================================================================================
    // LONGSWORDS (Combat Category 9)
    // Attack Speed: 5 ticks
    // Styles: Slash (0), Slash (1), Stab (2), Slash (3)
    // ==================================================================================
    {
        itemId: 1291,
        name: "Bronze longsword",
        equipmentType: "longsword",
        combatCategory: CombatCategory.SCIMITAR,
        animOverrides: longswordAnimOverrides,
        attackSequences: longswordAttackSeqs,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: swordHitSounds,
    },
    {
        itemId: 1293,
        name: "Iron longsword",
        equipmentType: "longsword",
        combatCategory: CombatCategory.SCIMITAR,
        animOverrides: longswordAnimOverrides,
        attackSequences: longswordAttackSeqs,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: swordHitSounds,
    },
    {
        itemId: 1295,
        name: "Steel longsword",
        equipmentType: "longsword",
        combatCategory: CombatCategory.SCIMITAR,
        animOverrides: longswordAnimOverrides,
        attackSequences: longswordAttackSeqs,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: swordHitSounds,
    },
    {
        itemId: 1297,
        name: "Black longsword",
        equipmentType: "longsword",
        combatCategory: CombatCategory.SCIMITAR,
        animOverrides: longswordAnimOverrides,
        attackSequences: longswordAttackSeqs,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: swordHitSounds,
    },
    {
        itemId: 1299,
        name: "Mithril longsword",
        equipmentType: "longsword",
        combatCategory: CombatCategory.SCIMITAR,
        animOverrides: longswordAnimOverrides,
        attackSequences: longswordAttackSeqs,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: swordHitSounds,
    },
    {
        itemId: 1301,
        name: "Adamant longsword",
        equipmentType: "longsword",
        combatCategory: CombatCategory.SCIMITAR,
        animOverrides: longswordAnimOverrides,
        attackSequences: longswordAttackSeqs,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: swordHitSounds,
    },
    {
        itemId: 1303,
        name: "Rune longsword",
        equipmentType: "longsword",
        combatCategory: CombatCategory.SCIMITAR,
        animOverrides: longswordAnimOverrides,
        attackSequences: longswordAttackSeqs,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: swordHitSounds,
    },
    {
        itemId: 1305,
        name: "Dragon longsword",
        equipmentType: "longsword",
        combatCategory: CombatCategory.SCIMITAR,
        animOverrides: longswordAnimOverrides,
        attackSequences: longswordAttackSeqs,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: swordHitSounds,
    },

    // ==================================================================================
    // SCIMITARS (Combat Category 9)
    // Attack Speed: 4 ticks
    // Styles: Slash (0), Slash (1), Stab (2), Slash (3)
    // ==================================================================================
    {
        itemId: 1321,
        name: "Bronze scimitar",
        equipmentType: "scimitar",
        combatCategory: CombatCategory.SCIMITAR,
        animOverrides: scimitarAnimOverrides,
        attackSequences: scimitarAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: swordHitSounds,
    },
    {
        itemId: 1323,
        name: "Iron scimitar",
        equipmentType: "scimitar",
        combatCategory: CombatCategory.SCIMITAR,
        animOverrides: scimitarAnimOverrides,
        attackSequences: scimitarAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: swordHitSounds,
    },
    {
        itemId: 1325,
        name: "Steel scimitar",
        equipmentType: "scimitar",
        combatCategory: CombatCategory.SCIMITAR,
        animOverrides: scimitarAnimOverrides,
        attackSequences: scimitarAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: swordHitSounds,
    },
    {
        itemId: 1327,
        name: "Black scimitar",
        equipmentType: "scimitar",
        combatCategory: CombatCategory.SCIMITAR,
        animOverrides: scimitarAnimOverrides,
        attackSequences: scimitarAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: swordHitSounds,
    },
    {
        itemId: 1329,
        name: "Mithril scimitar",
        equipmentType: "scimitar",
        combatCategory: CombatCategory.SCIMITAR,
        animOverrides: scimitarAnimOverrides,
        attackSequences: scimitarAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: swordHitSounds,
    },
    {
        itemId: 1331,
        name: "Adamant scimitar",
        equipmentType: "scimitar",
        combatCategory: CombatCategory.SCIMITAR,
        animOverrides: scimitarAnimOverrides,
        attackSequences: scimitarAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: swordHitSounds,
    },
    {
        itemId: 1333,
        name: "Rune scimitar",
        equipmentType: "scimitar",
        combatCategory: CombatCategory.SCIMITAR,
        animOverrides: scimitarAnimOverrides,
        attackSequences: scimitarAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: swordHitSounds,
    },
    {
        itemId: 4587,
        name: "Dragon scimitar",
        equipmentType: "scimitar",
        combatCategory: CombatCategory.SCIMITAR,
        animOverrides: scimitarAnimOverrides,
        attackSequences: scimitarAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: swordHitSounds,
    },
    {
        itemId: 20000,
        name: "Dragon scimitar (or)",
        equipmentType: "scimitar",
        combatCategory: CombatCategory.SCIMITAR,
        animOverrides: scimitarAnimOverrides,
        attackSequences: scimitarAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: swordHitSounds,
    },
    {
        itemId: 11037,
        name: "Brine sabre",
        equipmentType: "scimitar",
        combatCategory: CombatCategory.SCIMITAR,
        animOverrides: scimitarAnimOverrides,
        attackSequences: scimitarAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: swordHitSounds,
    },

    // ==================================================================================
    // MACES (Combat Category 16)
    // Attack Speed: 4 ticks
    // Styles: Pound (0), Pound (1), Spike (2), Pound (3)
    // ==================================================================================
    {
        itemId: 1422,
        name: "Bronze mace",
        equipmentType: "mace",
        combatCategory: CombatCategory.MACE,
        animOverrides: maceAnimOverrides,
        attackSequences: maceAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: maceHitSounds,
    },
    {
        itemId: 1420,
        name: "Iron mace",
        equipmentType: "mace",
        combatCategory: CombatCategory.MACE,
        animOverrides: maceAnimOverrides,
        attackSequences: maceAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: maceHitSounds,
    },
    {
        itemId: 1424,
        name: "Steel mace",
        equipmentType: "mace",
        combatCategory: CombatCategory.MACE,
        animOverrides: maceAnimOverrides,
        attackSequences: maceAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: maceHitSounds,
    },
    {
        itemId: 1426,
        name: "Black mace",
        equipmentType: "mace",
        combatCategory: CombatCategory.MACE,
        animOverrides: maceAnimOverrides,
        attackSequences: maceAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: maceHitSounds,
    },
    {
        itemId: 1428,
        name: "Mithril mace",
        equipmentType: "mace",
        combatCategory: CombatCategory.MACE,
        animOverrides: maceAnimOverrides,
        attackSequences: maceAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: maceHitSounds,
    },
    {
        itemId: 1430,
        name: "Adamant mace",
        equipmentType: "mace",
        combatCategory: CombatCategory.MACE,
        animOverrides: maceAnimOverrides,
        attackSequences: maceAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: maceHitSounds,
    },
    {
        itemId: 1432,
        name: "Rune mace",
        equipmentType: "mace",
        combatCategory: CombatCategory.MACE,
        animOverrides: maceAnimOverrides,
        attackSequences: maceAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: maceHitSounds,
    },
    {
        itemId: 1434,
        name: "Dragon mace",
        equipmentType: "mace",
        combatCategory: CombatCategory.MACE,
        animOverrides: maceAnimOverrides,
        attackSequences: maceAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: maceHitSounds,
    },
    {
        itemId: 11061,
        name: "Ancient mace",
        equipmentType: "mace",
        combatCategory: CombatCategory.MACE,
        animOverrides: maceAnimOverrides,
        attackSequences: maceAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: maceHitSounds,
    },

    // ==================================================================================
    // WARHAMMERS (Combat Category 2)
    // Attack Speed: 6 ticks
    // Styles: Pound (0), Pound (1), Pound (2), Pound (3)
    // ==================================================================================
    {
        itemId: 1337,
        name: "Bronze warhammer",
        equipmentType: "warhammer",
        combatCategory: CombatCategory.HAMMER,
        animOverrides: warhammerAnimOverrides,
        attackSequences: warhammerAttackSeqs,
        attackSpeed: 6,
        hitDelay: 1,
        hitSounds: warhammerHitSounds,
    },
    {
        itemId: 1335,
        name: "Iron warhammer",
        equipmentType: "warhammer",
        combatCategory: CombatCategory.HAMMER,
        animOverrides: warhammerAnimOverrides,
        attackSequences: warhammerAttackSeqs,
        attackSpeed: 6,
        hitDelay: 1,
        hitSounds: warhammerHitSounds,
    },
    {
        itemId: 1339,
        name: "Steel warhammer",
        equipmentType: "warhammer",
        combatCategory: CombatCategory.HAMMER,
        animOverrides: warhammerAnimOverrides,
        attackSequences: warhammerAttackSeqs,
        attackSpeed: 6,
        hitDelay: 1,
        hitSounds: warhammerHitSounds,
    },
    {
        itemId: 1341,
        name: "Black warhammer",
        equipmentType: "warhammer",
        combatCategory: CombatCategory.HAMMER,
        animOverrides: warhammerAnimOverrides,
        attackSequences: warhammerAttackSeqs,
        attackSpeed: 6,
        hitDelay: 1,
        hitSounds: warhammerHitSounds,
    },
    {
        itemId: 1343,
        name: "Mithril warhammer",
        equipmentType: "warhammer",
        combatCategory: CombatCategory.HAMMER,
        animOverrides: warhammerAnimOverrides,
        attackSequences: warhammerAttackSeqs,
        attackSpeed: 6,
        hitDelay: 1,
        hitSounds: warhammerHitSounds,
    },
    {
        itemId: 1345,
        name: "Adamant warhammer",
        equipmentType: "warhammer",
        combatCategory: CombatCategory.HAMMER,
        animOverrides: warhammerAnimOverrides,
        attackSequences: warhammerAttackSeqs,
        attackSpeed: 6,
        hitDelay: 1,
        hitSounds: warhammerHitSounds,
    },
    {
        itemId: 1347,
        name: "Rune warhammer",
        equipmentType: "warhammer",
        combatCategory: CombatCategory.HAMMER,
        animOverrides: warhammerAnimOverrides,
        attackSequences: warhammerAttackSeqs,
        attackSpeed: 6,
        hitDelay: 1,
        hitSounds: warhammerHitSounds,
    },
    {
        itemId: 13576,
        name: "Dragon warhammer",
        equipmentType: "warhammer",
        combatCategory: CombatCategory.HAMMER,
        animOverrides: warhammerAnimOverrides,
        attackSequences: dragonWarhammerAttackSeqs,
        attackSpeed: 6,
        hitDelay: 1,
        hitSounds: warhammerHitSounds,
    },
    {
        itemId: 22622,
        name: "Statius's warhammer",
        equipmentType: "warhammer",
        combatCategory: CombatCategory.HAMMER,
        animOverrides: warhammerAnimOverrides,
        attackSequences: warhammerAttackSeqs,
        attackSpeed: 6,
        hitDelay: 1,
        hitSounds: warhammerHitSounds,
    },

    // ==================================================================================
    // BATTLEAXES (Combat Category 1)
    // Attack Speed: 6 ticks
    // Styles: Chop (0), Hack (1), Smash (2), Block (3)
    // ==================================================================================
    {
        itemId: 1375,
        name: "Bronze battleaxe",
        equipmentType: "battleaxe",
        combatCategory: CombatCategory.AXE,
        animOverrides: battleaxeAnimOverrides,
        attackSequences: axeAttackSeqs,
        attackSpeed: 6,
        hitDelay: 1,
        hitSounds: battleaxeHitSounds,
    },
    {
        itemId: 1363,
        name: "Iron battleaxe",
        equipmentType: "battleaxe",
        combatCategory: CombatCategory.AXE,
        animOverrides: battleaxeAnimOverrides,
        attackSequences: axeAttackSeqs,
        attackSpeed: 6,
        hitDelay: 1,
        hitSounds: battleaxeHitSounds,
    },
    {
        itemId: 1365,
        name: "Steel battleaxe",
        equipmentType: "battleaxe",
        combatCategory: CombatCategory.AXE,
        animOverrides: battleaxeAnimOverrides,
        attackSequences: axeAttackSeqs,
        attackSpeed: 6,
        hitDelay: 1,
        hitSounds: battleaxeHitSounds,
    },
    {
        itemId: 1367,
        name: "Black battleaxe",
        equipmentType: "battleaxe",
        combatCategory: CombatCategory.AXE,
        animOverrides: battleaxeAnimOverrides,
        attackSequences: axeAttackSeqs,
        attackSpeed: 6,
        hitDelay: 1,
        hitSounds: battleaxeHitSounds,
    },
    {
        itemId: 1369,
        name: "Mithril battleaxe",
        equipmentType: "battleaxe",
        combatCategory: CombatCategory.AXE,
        animOverrides: battleaxeAnimOverrides,
        attackSequences: axeAttackSeqs,
        attackSpeed: 6,
        hitDelay: 1,
        hitSounds: battleaxeHitSounds,
    },
    {
        itemId: 1371,
        name: "Adamant battleaxe",
        equipmentType: "battleaxe",
        combatCategory: CombatCategory.AXE,
        animOverrides: battleaxeAnimOverrides,
        attackSequences: axeAttackSeqs,
        attackSpeed: 6,
        hitDelay: 1,
        hitSounds: battleaxeHitSounds,
    },
    {
        itemId: 1373,
        name: "Rune battleaxe",
        equipmentType: "battleaxe",
        combatCategory: CombatCategory.AXE,
        animOverrides: battleaxeAnimOverrides,
        attackSequences: axeAttackSeqs,
        attackSpeed: 6,
        hitDelay: 1,
        hitSounds: battleaxeHitSounds,
    },
    {
        itemId: 1377,
        name: "Dragon battleaxe",
        equipmentType: "battleaxe",
        combatCategory: CombatCategory.AXE,
        animOverrides: battleaxeAnimOverrides,
        attackSequences: axeAttackSeqs,
        attackSpeed: 6,
        hitDelay: 1,
        hitSounds: battleaxeHitSounds,
    },

    // ==================================================================================
    // AXES (Combat Category 1) - Woodcutting axes as weapons
    // Attack Speed: 5 ticks
    // ==================================================================================
    {
        itemId: 1351,
        name: "Bronze axe",
        equipmentType: "axe",
        combatCategory: CombatCategory.AXE,
        animOverrides: axeAnimOverrides,
        attackSequences: axeAttackSeqs,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: battleaxeHitSounds,
    },
    {
        itemId: 1349,
        name: "Iron axe",
        equipmentType: "axe",
        combatCategory: CombatCategory.AXE,
        animOverrides: axeAnimOverrides,
        attackSequences: axeAttackSeqs,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: battleaxeHitSounds,
    },
    {
        itemId: 1353,
        name: "Steel axe",
        equipmentType: "axe",
        combatCategory: CombatCategory.AXE,
        animOverrides: axeAnimOverrides,
        attackSequences: axeAttackSeqs,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: battleaxeHitSounds,
    },
    {
        itemId: 1361,
        name: "Black axe",
        equipmentType: "axe",
        combatCategory: CombatCategory.AXE,
        animOverrides: axeAnimOverrides,
        attackSequences: axeAttackSeqs,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: battleaxeHitSounds,
    },
    {
        itemId: 1355,
        name: "Mithril axe",
        equipmentType: "axe",
        combatCategory: CombatCategory.AXE,
        animOverrides: axeAnimOverrides,
        attackSequences: axeAttackSeqs,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: battleaxeHitSounds,
    },
    {
        itemId: 1357,
        name: "Adamant axe",
        equipmentType: "axe",
        combatCategory: CombatCategory.AXE,
        animOverrides: axeAnimOverrides,
        attackSequences: axeAttackSeqs,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: battleaxeHitSounds,
    },
    {
        itemId: 1359,
        name: "Rune axe",
        equipmentType: "axe",
        combatCategory: CombatCategory.AXE,
        animOverrides: axeAnimOverrides,
        attackSequences: axeAttackSeqs,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: battleaxeHitSounds,
    },
    {
        itemId: 6739,
        name: "Dragon axe",
        equipmentType: "axe",
        combatCategory: CombatCategory.AXE,
        animOverrides: axeAnimOverrides,
        attackSequences: axeAttackSeqs,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: battleaxeHitSounds,
    },
    {
        itemId: 13241,
        name: "Infernal axe",
        equipmentType: "axe",
        combatCategory: CombatCategory.AXE,
        animOverrides: axeAnimOverrides,
        attackSequences: axeAttackSeqs,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: battleaxeHitSounds,
    },
    {
        itemId: 23673,
        name: "Crystal axe",
        equipmentType: "axe",
        combatCategory: CombatCategory.AXE,
        animOverrides: axeAnimOverrides,
        attackSequences: axeAttackSeqs,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: battleaxeHitSounds,
    },
    {
        itemId: 25110,
        name: "Echo axe",
        equipmentType: "axe",
        combatCategory: CombatCategory.AXE,
        animOverrides: axeAnimOverrides,
        attackSequences: axeAttackSeqs,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: battleaxeHitSounds,
    },

    // ==================================================================================
    // TWO-HANDED SWORDS (Combat Category 9)
    // Attack Speed: 7 ticks
    // Attack anims: 406 (chop), 407 (slash), 408 (lunge), 409 (spin)
    // ==================================================================================
    {
        itemId: 1307,
        name: "Bronze 2h sword",
        equipmentType: "two_handed_sword",
        combatCategory: CombatCategory.TWO_HANDED_SWORD,
        animOverrides: twoHandedSwordAnimOverrides,
        attackSequences: twoHandedSwordAttackSeqs,
        attackSpeed: 7,
        hitDelay: 1,
        hitSounds: twoHandedSwordHitSounds,
    },
    {
        itemId: 1309,
        name: "Iron 2h sword",
        equipmentType: "two_handed_sword",
        combatCategory: CombatCategory.TWO_HANDED_SWORD,
        animOverrides: twoHandedSwordAnimOverrides,
        attackSequences: twoHandedSwordAttackSeqs,
        attackSpeed: 7,
        hitDelay: 1,
        hitSounds: twoHandedSwordHitSounds,
    },
    {
        itemId: 1311,
        name: "Steel 2h sword",
        equipmentType: "two_handed_sword",
        combatCategory: CombatCategory.TWO_HANDED_SWORD,
        animOverrides: twoHandedSwordAnimOverrides,
        attackSequences: twoHandedSwordAttackSeqs,
        attackSpeed: 7,
        hitDelay: 1,
        hitSounds: twoHandedSwordHitSounds,
    },
    {
        itemId: 1313,
        name: "Black 2h sword",
        equipmentType: "two_handed_sword",
        combatCategory: CombatCategory.TWO_HANDED_SWORD,
        animOverrides: twoHandedSwordAnimOverrides,
        attackSequences: twoHandedSwordAttackSeqs,
        attackSpeed: 7,
        hitDelay: 1,
        hitSounds: twoHandedSwordHitSounds,
    },
    {
        itemId: 1315,
        name: "Mithril 2h sword",
        equipmentType: "two_handed_sword",
        combatCategory: CombatCategory.TWO_HANDED_SWORD,
        animOverrides: twoHandedSwordAnimOverrides,
        attackSequences: twoHandedSwordAttackSeqs,
        attackSpeed: 7,
        hitDelay: 1,
        hitSounds: twoHandedSwordHitSounds,
    },
    {
        itemId: 1317,
        name: "Adamant 2h sword",
        equipmentType: "two_handed_sword",
        combatCategory: CombatCategory.TWO_HANDED_SWORD,
        animOverrides: twoHandedSwordAnimOverrides,
        attackSequences: twoHandedSwordAttackSeqs,
        attackSpeed: 7,
        hitDelay: 1,
        hitSounds: twoHandedSwordHitSounds,
    },
    {
        itemId: 1319,
        name: "Rune 2h sword",
        equipmentType: "two_handed_sword",
        combatCategory: CombatCategory.TWO_HANDED_SWORD,
        animOverrides: twoHandedSwordAnimOverrides,
        attackSequences: twoHandedSwordAttackSeqs,
        attackSpeed: 7,
        hitDelay: 1,
        hitSounds: twoHandedSwordHitSounds,
    },
    {
        itemId: 7158,
        name: "Dragon 2h sword",
        equipmentType: "two_handed_sword",
        combatCategory: CombatCategory.TWO_HANDED_SWORD,
        animOverrides: twoHandedSwordAnimOverrides,
        attackSequences: twoHandedSwordAttackSeqs,
        attackSpeed: 7,
        hitDelay: 1,
        hitSounds: twoHandedSwordHitSounds,
    },

    // ==================================================================================
    // GODSWORDS (Combat Category 10 - TWO_HANDED_SWORD: Chop/Slash/Smash/Block)
    // Attack Speed: 6 ticks
    // Animations: Chop (7046), Slash (7045), Smash (7054)
    // ==================================================================================
    {
        itemId: 11802,
        name: "Armadyl godsword",
        equipmentType: "godsword",
        combatCategory: CombatCategory.TWO_HANDED_SWORD,
        animOverrides: godswordAnimOverrides,
        attackSequences: godswordAttackSeqs,
        attackSpeed: 6,
        hitDelay: 1,
        hitSounds: godswordHitSounds,
    },
    {
        itemId: 20593,
        name: "Armadyl godsword",
        equipmentType: "godsword",
        combatCategory: CombatCategory.TWO_HANDED_SWORD,
        animOverrides: godswordAnimOverrides,
        attackSequences: godswordAttackSeqs,
        attackSpeed: 6,
        hitDelay: 1,
        hitSounds: godswordHitSounds,
    },
    {
        itemId: 20368,
        name: "Armadyl godsword (or)",
        equipmentType: "godsword",
        combatCategory: CombatCategory.TWO_HANDED_SWORD,
        animOverrides: godswordAnimOverrides,
        attackSequences: godswordAttackSeqs,
        attackSpeed: 6,
        hitDelay: 1,
        hitSounds: godswordHitSounds,
    },
    {
        itemId: 11804,
        name: "Bandos godsword",
        equipmentType: "godsword",
        combatCategory: CombatCategory.TWO_HANDED_SWORD,
        animOverrides: godswordAnimOverrides,
        attackSequences: godswordAttackSeqs,
        attackSpeed: 6,
        hitDelay: 1,
        hitSounds: godswordHitSounds,
    },
    {
        itemId: 20782,
        name: "Bandos godsword",
        equipmentType: "godsword",
        combatCategory: CombatCategory.TWO_HANDED_SWORD,
        animOverrides: godswordAnimOverrides,
        attackSequences: godswordAttackSeqs,
        attackSpeed: 6,
        hitDelay: 1,
        hitSounds: godswordHitSounds,
    },
    {
        itemId: 21060,
        name: "Bandos godsword",
        equipmentType: "godsword",
        combatCategory: CombatCategory.TWO_HANDED_SWORD,
        animOverrides: godswordAnimOverrides,
        attackSequences: godswordAttackSeqs,
        attackSpeed: 6,
        hitDelay: 1,
        hitSounds: godswordHitSounds,
    },
    {
        itemId: 20370,
        name: "Bandos godsword (or)",
        equipmentType: "godsword",
        combatCategory: CombatCategory.TWO_HANDED_SWORD,
        animOverrides: godswordAnimOverrides,
        attackSequences: godswordAttackSeqs,
        attackSpeed: 6,
        hitDelay: 1,
        hitSounds: godswordHitSounds,
    },
    {
        itemId: 11806,
        name: "Saradomin godsword",
        equipmentType: "godsword",
        combatCategory: CombatCategory.TWO_HANDED_SWORD,
        animOverrides: godswordAnimOverrides,
        attackSequences: godswordAttackSeqs,
        attackSpeed: 6,
        hitDelay: 1,
        hitSounds: godswordHitSounds,
    },
    {
        itemId: 20372,
        name: "Saradomin godsword (or)",
        equipmentType: "godsword",
        combatCategory: CombatCategory.TWO_HANDED_SWORD,
        animOverrides: godswordAnimOverrides,
        attackSequences: godswordAttackSeqs,
        attackSpeed: 6,
        hitDelay: 1,
        hitSounds: godswordHitSounds,
    },
    {
        itemId: 11808,
        name: "Zamorak godsword",
        equipmentType: "godsword",
        combatCategory: CombatCategory.TWO_HANDED_SWORD,
        animOverrides: godswordAnimOverrides,
        attackSequences: godswordAttackSeqs,
        attackSpeed: 6,
        hitDelay: 1,
        hitSounds: godswordHitSounds,
    },
    {
        itemId: 20374,
        name: "Zamorak godsword (or)",
        equipmentType: "godsword",
        combatCategory: CombatCategory.TWO_HANDED_SWORD,
        animOverrides: godswordAnimOverrides,
        attackSequences: godswordAttackSeqs,
        attackSpeed: 6,
        hitDelay: 1,
        hitSounds: godswordHitSounds,
    },
    {
        itemId: 26233,
        name: "Ancient godsword",
        equipmentType: "godsword",
        combatCategory: CombatCategory.TWO_HANDED_SWORD,
        animOverrides: godswordAnimOverrides,
        attackSequences: godswordAttackSeqs,
        attackSpeed: 6,
        hitDelay: 1,
        hitSounds: godswordHitSounds,
    },

    // ==================================================================================
    // SPEARS (Combat Category 15)
    // Attack Speed: 5 ticks
    // Styles: Stab (0), Swipe (1), Lunge (2), Stab (3)
    // ==================================================================================
    {
        itemId: 1237,
        name: "Bronze spear",
        equipmentType: "spear",
        combatCategory: CombatCategory.SPEAR,
        animOverrides: spearAnimOverrides,
        attackSequences: spearAttackSeqs,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: spearHitSounds,
    },
    {
        itemId: 1239,
        name: "Iron spear",
        equipmentType: "spear",
        combatCategory: CombatCategory.SPEAR,
        animOverrides: spearAnimOverrides,
        attackSequences: spearAttackSeqs,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: spearHitSounds,
    },
    {
        itemId: 1241,
        name: "Steel spear",
        equipmentType: "spear",
        combatCategory: CombatCategory.SPEAR,
        animOverrides: spearAnimOverrides,
        attackSequences: spearAttackSeqs,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: spearHitSounds,
    },
    {
        itemId: 1243,
        name: "Mithril spear",
        equipmentType: "spear",
        combatCategory: CombatCategory.SPEAR,
        animOverrides: spearAnimOverrides,
        attackSequences: spearAttackSeqs,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: spearHitSounds,
    },
    {
        itemId: 1245,
        name: "Adamant spear",
        equipmentType: "spear",
        combatCategory: CombatCategory.SPEAR,
        animOverrides: spearAnimOverrides,
        attackSequences: spearAttackSeqs,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: spearHitSounds,
    },
    {
        itemId: 1247,
        name: "Rune spear",
        equipmentType: "spear",
        combatCategory: CombatCategory.SPEAR,
        animOverrides: spearAnimOverrides,
        attackSequences: spearAttackSeqs,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: spearHitSounds,
    },
    {
        itemId: 1249,
        name: "Dragon spear",
        equipmentType: "spear",
        combatCategory: CombatCategory.SPEAR,
        animOverrides: spearAnimOverrides,
        attackSequences: dragonSpearAttackSeqs,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: spearHitSounds,
    },
    {
        itemId: 11824,
        name: "Zamorakian spear",
        equipmentType: "spear",
        combatCategory: CombatCategory.SPEAR,
        animOverrides: zamorakianSpearAnimOverrides,
        attackSequences: zamorakianSpearAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: spearHitSounds,
    },
    {
        itemId: 11889,
        name: "Zamorakian hasta",
        equipmentType: "hasta",
        combatCategory: CombatCategory.SPEAR,
        animOverrides: zamorakianSpearAnimOverrides,
        attackSequences: zamorakianSpearAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: spearHitSounds,
    },

    // ==================================================================================
    // HASTAS (Combat Category 15)
    // Attack Speed: 4 ticks
    // ==================================================================================
    {
        itemId: 11367,
        name: "Bronze hasta",
        equipmentType: "hasta",
        combatCategory: CombatCategory.SPEAR,
        animOverrides: spearAnimOverrides,
        attackSequences: spearAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: spearHitSounds,
    },
    {
        itemId: 11369,
        name: "Iron hasta",
        equipmentType: "hasta",
        combatCategory: CombatCategory.SPEAR,
        animOverrides: spearAnimOverrides,
        attackSequences: spearAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: spearHitSounds,
    },
    {
        itemId: 11371,
        name: "Steel hasta",
        equipmentType: "hasta",
        combatCategory: CombatCategory.SPEAR,
        animOverrides: spearAnimOverrides,
        attackSequences: spearAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: spearHitSounds,
    },
    {
        itemId: 11373,
        name: "Mithril hasta",
        equipmentType: "hasta",
        combatCategory: CombatCategory.SPEAR,
        animOverrides: spearAnimOverrides,
        attackSequences: spearAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: spearHitSounds,
    },
    {
        itemId: 11375,
        name: "Adamant hasta",
        equipmentType: "hasta",
        combatCategory: CombatCategory.SPEAR,
        animOverrides: spearAnimOverrides,
        attackSequences: spearAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: spearHitSounds,
    },
    {
        itemId: 11377,
        name: "Rune hasta",
        equipmentType: "hasta",
        combatCategory: CombatCategory.SPEAR,
        animOverrides: spearAnimOverrides,
        attackSequences: spearAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: spearHitSounds,
    },

    // ==================================================================================
    // HALBERDS (Combat Category 12)
    // Attack Speed: 7 ticks
    // Attack anims: 428 (stab), 440 (swipe)
    // ==================================================================================
    {
        itemId: 3190,
        name: "Bronze halberd",
        equipmentType: "halberd",
        combatCategory: CombatCategory.HALBERD,
        animOverrides: halberdAnimOverrides,
        attackSequences: halberdAttackSeqs,
        attackSpeed: 7,
        hitDelay: 1,
        hitSounds: spearHitSounds,
    },
    {
        itemId: 3192,
        name: "Iron halberd",
        equipmentType: "halberd",
        combatCategory: CombatCategory.HALBERD,
        animOverrides: halberdAnimOverrides,
        attackSequences: halberdAttackSeqs,
        attackSpeed: 7,
        hitDelay: 1,
        hitSounds: spearHitSounds,
    },
    {
        itemId: 3194,
        name: "Steel halberd",
        equipmentType: "halberd",
        combatCategory: CombatCategory.HALBERD,
        animOverrides: halberdAnimOverrides,
        attackSequences: halberdAttackSeqs,
        attackSpeed: 7,
        hitDelay: 1,
        hitSounds: spearHitSounds,
    },
    {
        itemId: 3196,
        name: "Black halberd",
        equipmentType: "halberd",
        combatCategory: CombatCategory.HALBERD,
        animOverrides: halberdAnimOverrides,
        attackSequences: halberdAttackSeqs,
        attackSpeed: 7,
        hitDelay: 1,
        hitSounds: spearHitSounds,
    },
    {
        itemId: 3198,
        name: "Mithril halberd",
        equipmentType: "halberd",
        combatCategory: CombatCategory.HALBERD,
        animOverrides: halberdAnimOverrides,
        attackSequences: halberdAttackSeqs,
        attackSpeed: 7,
        hitDelay: 1,
        hitSounds: spearHitSounds,
    },
    {
        itemId: 3200,
        name: "Adamant halberd",
        equipmentType: "halberd",
        combatCategory: CombatCategory.HALBERD,
        animOverrides: halberdAnimOverrides,
        attackSequences: halberdAttackSeqs,
        attackSpeed: 7,
        hitDelay: 1,
        hitSounds: spearHitSounds,
    },
    {
        itemId: 3202,
        name: "Rune halberd",
        equipmentType: "halberd",
        combatCategory: CombatCategory.HALBERD,
        animOverrides: halberdAnimOverrides,
        attackSequences: halberdAttackSeqs,
        attackSpeed: 7,
        hitDelay: 1,
        hitSounds: spearHitSounds,
    },
    {
        itemId: 3204,
        name: "Dragon halberd",
        equipmentType: "halberd",
        combatCategory: CombatCategory.HALBERD,
        animOverrides: halberdAnimOverrides,
        attackSequences: halberdAttackSeqs,
        attackSpeed: 7,
        hitDelay: 1,
        hitSounds: spearHitSounds,
    },
    {
        itemId: 13081,
        name: "Crystal halberd",
        equipmentType: "halberd",
        combatCategory: CombatCategory.HALBERD,
        animOverrides: halberdAnimOverrides,
        attackSequences: halberdAttackSeqs,
        attackSpeed: 7,
        hitDelay: 1,
        hitSounds: spearHitSounds,
    },

    // ==================================================================================
    // CLAWS (Combat Category 4)
    // Attack Speed: 4 ticks
    // Attack anim: 393 (slash)
    // ==================================================================================
    {
        itemId: 3095,
        name: "Bronze claws",
        equipmentType: "claw",
        combatCategory: CombatCategory.CLAW,
        animOverrides: clawAnimOverrides,
        attackSequences: clawAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: clawHitSounds,
    },
    {
        itemId: 3096,
        name: "Iron claws",
        equipmentType: "claw",
        combatCategory: CombatCategory.CLAW,
        animOverrides: clawAnimOverrides,
        attackSequences: clawAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: clawHitSounds,
    },
    {
        itemId: 3097,
        name: "Steel claws",
        equipmentType: "claw",
        combatCategory: CombatCategory.CLAW,
        animOverrides: clawAnimOverrides,
        attackSequences: clawAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: clawHitSounds,
    },
    {
        itemId: 3098,
        name: "Black claws",
        equipmentType: "claw",
        combatCategory: CombatCategory.CLAW,
        animOverrides: clawAnimOverrides,
        attackSequences: clawAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: clawHitSounds,
    },
    {
        itemId: 3099,
        name: "Mithril claws",
        equipmentType: "claw",
        combatCategory: CombatCategory.CLAW,
        animOverrides: clawAnimOverrides,
        attackSequences: clawAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: clawHitSounds,
    },
    {
        itemId: 3100,
        name: "Adamant claws",
        equipmentType: "claw",
        combatCategory: CombatCategory.CLAW,
        animOverrides: clawAnimOverrides,
        attackSequences: clawAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: clawHitSounds,
    },
    {
        itemId: 3101,
        name: "Rune claws",
        equipmentType: "claw",
        combatCategory: CombatCategory.CLAW,
        animOverrides: clawAnimOverrides,
        attackSequences: clawAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: clawHitSounds,
    },
    {
        itemId: 13652,
        name: "Dragon claws",
        equipmentType: "claw",
        combatCategory: CombatCategory.CLAW,
        animOverrides: dragonClawsAnimOverrides,
        attackSequences: dragonClawsAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: dragonClawsHitSounds,
    },
    {
        itemId: 20784,
        name: "Dragon claws",
        equipmentType: "claw",
        combatCategory: CombatCategory.CLAW,
        animOverrides: dragonClawsAnimOverrides,
        attackSequences: dragonClawsAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: dragonClawsHitSounds,
    },

    // ==================================================================================
    // WHIPS (Combat Category 20)
    // Attack Speed: 4 ticks
    // Attack anim: 1658
    // ==================================================================================
    {
        itemId: 4151,
        name: "Abyssal whip",
        equipmentType: "whip",
        combatCategory: CombatCategory.WHIP,
        animOverrides: whipAnimOverrides,
        attackSequence: 1658,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: whipHitSounds,
    },
    {
        itemId: 4178,
        name: "Abyssal whip",
        equipmentType: "whip",
        combatCategory: CombatCategory.WHIP,
        animOverrides: whipAnimOverrides,
        attackSequence: 1658,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: whipHitSounds,
    },
    {
        itemId: 12773,
        name: "Volcanic abyssal whip",
        equipmentType: "whip",
        combatCategory: CombatCategory.WHIP,
        animOverrides: whipAnimOverrides,
        attackSequence: 1658,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: whipHitSounds,
    },
    {
        itemId: 12774,
        name: "Frozen abyssal whip",
        equipmentType: "whip",
        combatCategory: CombatCategory.WHIP,
        animOverrides: whipAnimOverrides,
        attackSequence: 1658,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: whipHitSounds,
    },
    {
        itemId: 12006,
        name: "Abyssal tentacle",
        equipmentType: "whip",
        combatCategory: CombatCategory.WHIP,
        animOverrides: whipAnimOverrides,
        attackSequence: 1658,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: whipHitSounds,
    },

    // ==================================================================================
    // SPECIAL MELEE WEAPONS
    // ==================================================================================
    // Granite maul - uses unique animations (verified from cache)
    {
        itemId: 4153,
        name: "Granite maul",
        equipmentType: "maul",
        combatCategory: CombatCategory.HAMMER,
        animOverrides: graniteMaulAnimOverrides,
        attackSequences: graniteMaulAttackSeqs,
        attackSpeed: 7,
        hitDelay: 1,
        hitSounds: warhammerHitSounds,
    },
    {
        itemId: 12848,
        name: "Granite maul",
        equipmentType: "maul",
        combatCategory: CombatCategory.HAMMER,
        animOverrides: graniteMaulAnimOverrides,
        attackSequences: graniteMaulAttackSeqs,
        attackSpeed: 7,
        hitDelay: 1,
        hitSounds: warhammerHitSounds,
    },
    {
        itemId: 24225,
        name: "Granite maul (or)",
        equipmentType: "maul",
        combatCategory: CombatCategory.HAMMER,
        animOverrides: graniteMaulAnimOverrides,
        attackSequences: graniteMaulAttackSeqs,
        attackSpeed: 7,
        hitDelay: 1,
        hitSounds: warhammerHitSounds,
    },

    // Elder maul
    {
        itemId: 21003,
        name: "Elder maul",
        equipmentType: "maul",
        combatCategory: CombatCategory.HAMMER,
        animOverrides: elderMaulAnimOverrides,
        attackSequences: elderMaulAttackSeqs,
        attackSpeed: 6,
        hitDelay: 1,
        hitSounds: warhammerHitSounds,
    },

    // Saradomin sword - uses godsword stance (verified from cache: saradomin sword 11838)
    {
        itemId: 11838,
        name: "Saradomin sword",
        equipmentType: "two_handed_sword",
        combatCategory: CombatCategory.TWO_HANDED_SWORD,
        animOverrides: godswordAnimOverrides,
        attackSequences: saradominSwordAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: twoHandedSwordHitSounds,
    },
    // Saradomin's blessed sword - uses godsword stance (verified from cache: 12809)
    {
        itemId: 12809,
        name: "Saradomin's blessed sword",
        equipmentType: "two_handed_sword",
        combatCategory: CombatCategory.TWO_HANDED_SWORD,
        animOverrides: godswordAnimOverrides,
        attackSequences: saradominSwordAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: twoHandedSwordHitSounds,
    },

    // Ghrazi rapier
    {
        itemId: 22324,
        name: "Ghrazi rapier",
        equipmentType: "rapier",
        combatCategory: CombatCategory.DAGGER, // Category 17: Stab/Lunge/Slash/Block
        animOverrides: rapierAnimOverrides,
        attackSequences: rapierAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: daggerHitSounds,
    },

    // Abyssal bludgeon
    {
        itemId: 13263,
        name: "Abyssal bludgeon",
        equipmentType: "bludgeon",
        combatCategory: CombatCategory.BLUDGEON,
        animOverrides: bludgeonAnimOverrides,
        attackSequence: 7054,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: warhammerHitSounds,
    },

    // Dinh's bulwark
    {
        itemId: 21015,
        name: "Dinh's bulwark",
        equipmentType: "bulwark",
        combatCategory: CombatCategory.BULWARK,
        animOverrides: bulwarkAnimOverrides,
        attackSequence: 7511,
        attackSpeed: 7,
        hitDelay: 1,
        hitSounds: warhammerHitSounds,
    },

    // Verac's flail - uses unique animations (verified from cache)
    {
        itemId: 4755,
        name: "Verac's flail",
        equipmentType: "flail",
        combatCategory: CombatCategory.MACE,
        animOverrides: veracFlailAnimOverrides,
        attackSequences: veracFlailAttackSeqs,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: warhammerHitSounds,
    },
    {
        itemId: 4982,
        name: "Verac's flail 100",
        equipmentType: "flail",
        combatCategory: CombatCategory.MACE,
        animOverrides: veracFlailAnimOverrides,
        attackSequences: veracFlailAttackSeqs,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: warhammerHitSounds,
    },

    // Viggora's chainmace
    {
        itemId: 22545,
        name: "Viggora's chainmace",
        equipmentType: "mace",
        combatCategory: CombatCategory.MACE,
        animOverrides: viggoraChainmaceAnimOverrides,
        attackSequences: viggoraChainmaceAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: warhammerHitSounds,
    },

    // Inquisitor's mace - uses unique block animation (verified from cache: 24417)
    {
        itemId: 24417,
        name: "Inquisitor's mace",
        equipmentType: "mace",
        combatCategory: CombatCategory.MACE,
        animOverrides: inquisitorMaceAnimOverrides,
        attackSequences: inquisitorMaceAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: warhammerHitSounds,
    },

    // Blade of saeldor - NOTE: item IDs 25731/25733 might be incorrect (those are sanguinesti staff)
    // Real blade of saeldor is 23995, 23997 (charged)
    {
        itemId: 25731,
        name: "Blade of saeldor",
        equipmentType: "sword",
        combatCategory: CombatCategory.SCIMITAR,
        animOverrides: saeldorAnimOverrides,
        attackSequences: saeldorAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: swordHitSounds,
    },
    {
        itemId: 25733,
        name: "Blade of saeldor (c)",
        equipmentType: "sword",
        combatCategory: CombatCategory.SCIMITAR,
        animOverrides: saeldorAnimOverrides,
        attackSequences: saeldorAttackSeqs,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: swordHitSounds,
    },

    // Osmumten's fang - uses standard stance (verified from cache: 26219)
    {
        itemId: 26219,
        name: "Osmumten's fang",
        equipmentType: "rapier",
        combatCategory: CombatCategory.DAGGER, // Category 17: Stab/Lunge/Slash/Block
        animOverrides: fangAnimOverrides,
        attackSequences: fangAttackSeqs,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: swordHitSounds,
    },

    // Scythe of vitur
    {
        itemId: 22325,
        name: "Scythe of vitur",
        equipmentType: "scythe",
        combatCategory: CombatCategory.SCYTHE,
        animOverrides: scytheAnimOverrides,
        attackSequence: 8056,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: warhammerHitSounds,
    },
    {
        itemId: 22486,
        name: "Scythe of vitur (uncharged)",
        equipmentType: "scythe",
        combatCategory: CombatCategory.SCYTHE,
        animOverrides: scytheAnimOverrides,
        attackSequence: 8056,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: warhammerHitSounds,
    },

    // ==================================================================================
    // PICKAXES (Combat Category 11)
    // Attack Speed: 5 ticks
    // ==================================================================================
    {
        itemId: 1265,
        name: "Bronze pickaxe",
        equipmentType: "pickaxe",
        combatCategory: CombatCategory.PICKAXE,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: battleaxeHitSounds,
    },
    {
        itemId: 1267,
        name: "Iron pickaxe",
        equipmentType: "pickaxe",
        combatCategory: CombatCategory.PICKAXE,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: battleaxeHitSounds,
    },
    {
        itemId: 1269,
        name: "Steel pickaxe",
        equipmentType: "pickaxe",
        combatCategory: CombatCategory.PICKAXE,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: battleaxeHitSounds,
    },
    {
        itemId: 1273,
        name: "Mithril pickaxe",
        equipmentType: "pickaxe",
        combatCategory: CombatCategory.PICKAXE,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: battleaxeHitSounds,
    },
    {
        itemId: 1271,
        name: "Adamant pickaxe",
        equipmentType: "pickaxe",
        combatCategory: CombatCategory.PICKAXE,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: battleaxeHitSounds,
    },
    {
        itemId: 1275,
        name: "Rune pickaxe",
        equipmentType: "pickaxe",
        combatCategory: CombatCategory.PICKAXE,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: battleaxeHitSounds,
    },
    {
        itemId: 11920,
        name: "Dragon pickaxe",
        equipmentType: "pickaxe",
        combatCategory: CombatCategory.PICKAXE,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: battleaxeHitSounds,
    },
    {
        itemId: 13243,
        name: "Infernal pickaxe",
        equipmentType: "pickaxe",
        combatCategory: CombatCategory.PICKAXE,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: battleaxeHitSounds,
    },
    {
        itemId: 23680,
        name: "Crystal pickaxe",
        equipmentType: "pickaxe",
        combatCategory: CombatCategory.PICKAXE,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: battleaxeHitSounds,
    },

    // ==================================================================================
    // SHORTBOWS (Combat Category 3)
    // Attack Speed: 4 ticks (3 on rapid)
    // Attack anim: 426
    // ==================================================================================
    {
        itemId: 841,
        name: "Shortbow",
        equipmentType: "shortbow",
        combatCategory: CombatCategory.BOW,
        animOverrides: bowAnimOverrides,
        attackSequence: 426,
        attackSpeed: 4,
        hitDelay: 2,
        hitSounds: shortbowHitSounds,
    },
    {
        itemId: 843,
        name: "Oak shortbow",
        equipmentType: "shortbow",
        combatCategory: CombatCategory.BOW,
        animOverrides: bowAnimOverrides,
        attackSequence: 426,
        attackSpeed: 4,
        hitDelay: 2,
        hitSounds: shortbowHitSounds,
    },
    {
        itemId: 849,
        name: "Willow shortbow",
        equipmentType: "shortbow",
        combatCategory: CombatCategory.BOW,
        animOverrides: bowAnimOverrides,
        attackSequence: 426,
        attackSpeed: 4,
        hitDelay: 2,
        hitSounds: shortbowHitSounds,
    },
    {
        itemId: 853,
        name: "Maple shortbow",
        equipmentType: "shortbow",
        combatCategory: CombatCategory.BOW,
        animOverrides: bowAnimOverrides,
        attackSequence: 426,
        attackSpeed: 4,
        hitDelay: 2,
        hitSounds: shortbowHitSounds,
    },
    {
        itemId: 857,
        name: "Yew shortbow",
        equipmentType: "shortbow",
        combatCategory: CombatCategory.BOW,
        animOverrides: bowAnimOverrides,
        attackSequence: 426,
        attackSpeed: 4,
        hitDelay: 2,
        hitSounds: shortbowHitSounds,
    },
    {
        itemId: 861,
        name: "Magic shortbow",
        equipmentType: "shortbow",
        combatCategory: CombatCategory.BOW,
        animOverrides: bowAnimOverrides,
        attackSequence: 426,
        attackSpeed: 4,
        hitDelay: 2,
        hitSounds: shortbowHitSounds,
    },
    {
        itemId: 12788,
        name: "Magic shortbow (i)",
        equipmentType: "shortbow",
        combatCategory: CombatCategory.BOW,
        animOverrides: bowAnimOverrides,
        attackSequence: 426,
        attackSpeed: 4,
        hitDelay: 2,
        hitSounds: shortbowHitSounds,
    },

    // ==================================================================================
    // LONGBOWS (Combat Category 3)
    // Attack Speed: 6 ticks (5 on rapid)
    // Attack anim: 426
    // ==================================================================================
    {
        itemId: 839,
        name: "Longbow",
        equipmentType: "longbow",
        combatCategory: CombatCategory.BOW,
        animOverrides: bowAnimOverrides,
        attackSequence: 426,
        attackSpeed: 6,
        hitDelay: 2,
        hitSounds: longbowHitSounds,
    },
    {
        itemId: 845,
        name: "Oak longbow",
        equipmentType: "longbow",
        combatCategory: CombatCategory.BOW,
        animOverrides: bowAnimOverrides,
        attackSequence: 426,
        attackSpeed: 6,
        hitDelay: 2,
        hitSounds: longbowHitSounds,
    },
    {
        itemId: 847,
        name: "Willow longbow",
        equipmentType: "longbow",
        combatCategory: CombatCategory.BOW,
        animOverrides: bowAnimOverrides,
        attackSequence: 426,
        attackSpeed: 6,
        hitDelay: 2,
        hitSounds: longbowHitSounds,
    },
    {
        itemId: 851,
        name: "Maple longbow",
        equipmentType: "longbow",
        combatCategory: CombatCategory.BOW,
        animOverrides: bowAnimOverrides,
        attackSequence: 426,
        attackSpeed: 6,
        hitDelay: 2,
        hitSounds: longbowHitSounds,
    },
    {
        itemId: 855,
        name: "Yew longbow",
        equipmentType: "longbow",
        combatCategory: CombatCategory.BOW,
        animOverrides: bowAnimOverrides,
        attackSequence: 426,
        attackSpeed: 6,
        hitDelay: 2,
        hitSounds: longbowHitSounds,
    },
    {
        itemId: 859,
        name: "Magic longbow",
        equipmentType: "longbow",
        combatCategory: CombatCategory.BOW,
        animOverrides: bowAnimOverrides,
        attackSequence: 426,
        attackSpeed: 6,
        hitDelay: 2,
        hitSounds: longbowHitSounds,
    },

    // ==================================================================================
    // COMPOSITE BOWS (Combat Category 3)
    // Attack Speed: 5 ticks (4 on rapid)
    // ==================================================================================
    {
        itemId: 4827,
        name: "Ogre bow",
        equipmentType: "comp_bow",
        combatCategory: CombatCategory.BOW,
        animOverrides: bowAnimOverrides,
        attackSequence: 426,
        attackSpeed: 8,
        hitDelay: 2,
        hitSounds: ogreBowHitSounds,
    },
    {
        itemId: 4827,
        name: "Comp ogre bow",
        equipmentType: "comp_bow",
        combatCategory: CombatCategory.BOW,
        animOverrides: bowAnimOverrides,
        attackSequence: 426,
        attackSpeed: 8,
        hitDelay: 2,
        hitSounds: ogreBowHitSounds,
    },
    {
        itemId: 6724,
        name: "Seercull",
        equipmentType: "comp_bow",
        combatCategory: CombatCategory.BOW,
        animOverrides: bowAnimOverrides,
        attackSequence: 426,
        attackSpeed: 5,
        hitDelay: 2,
        hitSounds: shortbowHitSounds,
    },
    {
        itemId: 11235,
        name: "Dark bow",
        equipmentType: "dark_bow",
        combatCategory: CombatCategory.BOW,
        animOverrides: bowAnimOverrides,
        attackSequence: 426,
        attackSpeed: 9,
        hitDelay: 3,
        hitSounds: darkBowHitSounds,
        combatStyles: darkBowCombatStyles,
    },

    // ==================================================================================
    // CRYSTAL BOW (Combat Category 3)
    // Attack Speed: 5 ticks (4 on rapid)
    // ==================================================================================
    {
        itemId: 4212,
        name: "Crystal bow",
        equipmentType: "crystal_bow",
        combatCategory: CombatCategory.BOW,
        animOverrides: bowAnimOverrides,
        attackSequence: 426,
        attackSpeed: 5,
        hitDelay: 2,
        hitSounds: crystalBowHitSounds,
    },
    {
        itemId: 4214,
        name: "Crystal bow (full)",
        equipmentType: "crystal_bow",
        combatCategory: CombatCategory.BOW,
        animOverrides: bowAnimOverrides,
        attackSequence: 426,
        attackSpeed: 5,
        hitDelay: 2,
        hitSounds: crystalBowHitSounds,
    },
    {
        itemId: 4215,
        name: "Crystal bow 9/10",
        equipmentType: "crystal_bow",
        combatCategory: CombatCategory.BOW,
        animOverrides: bowAnimOverrides,
        attackSequence: 426,
        attackSpeed: 5,
        hitDelay: 2,
        hitSounds: crystalBowHitSounds,
    },
    {
        itemId: 4216,
        name: "Crystal bow 8/10",
        equipmentType: "crystal_bow",
        combatCategory: CombatCategory.BOW,
        animOverrides: bowAnimOverrides,
        attackSequence: 426,
        attackSpeed: 5,
        hitDelay: 2,
        hitSounds: crystalBowHitSounds,
    },
    {
        itemId: 4217,
        name: "Crystal bow 7/10",
        equipmentType: "crystal_bow",
        combatCategory: CombatCategory.BOW,
        animOverrides: bowAnimOverrides,
        attackSequence: 426,
        attackSpeed: 5,
        hitDelay: 2,
        hitSounds: crystalBowHitSounds,
    },
    {
        itemId: 4218,
        name: "Crystal bow 6/10",
        equipmentType: "crystal_bow",
        combatCategory: CombatCategory.BOW,
        animOverrides: bowAnimOverrides,
        attackSequence: 426,
        attackSpeed: 5,
        hitDelay: 2,
        hitSounds: crystalBowHitSounds,
    },
    {
        itemId: 4219,
        name: "Crystal bow 5/10",
        equipmentType: "crystal_bow",
        combatCategory: CombatCategory.BOW,
        animOverrides: bowAnimOverrides,
        attackSequence: 426,
        attackSpeed: 5,
        hitDelay: 2,
        hitSounds: crystalBowHitSounds,
    },
    {
        itemId: 4220,
        name: "Crystal bow 4/10",
        equipmentType: "crystal_bow",
        combatCategory: CombatCategory.BOW,
        animOverrides: bowAnimOverrides,
        attackSequence: 426,
        attackSpeed: 5,
        hitDelay: 2,
        hitSounds: crystalBowHitSounds,
    },
    {
        itemId: 4221,
        name: "Crystal bow 3/10",
        equipmentType: "crystal_bow",
        combatCategory: CombatCategory.BOW,
        animOverrides: bowAnimOverrides,
        attackSequence: 426,
        attackSpeed: 5,
        hitDelay: 2,
        hitSounds: crystalBowHitSounds,
    },
    {
        itemId: 4222,
        name: "Crystal bow 2/10",
        equipmentType: "crystal_bow",
        combatCategory: CombatCategory.BOW,
        animOverrides: bowAnimOverrides,
        attackSequence: 426,
        attackSpeed: 5,
        hitDelay: 2,
        hitSounds: crystalBowHitSounds,
    },
    {
        itemId: 4223,
        name: "Crystal bow 1/10",
        equipmentType: "crystal_bow",
        combatCategory: CombatCategory.BOW,
        animOverrides: bowAnimOverrides,
        attackSequence: 426,
        attackSpeed: 5,
        hitDelay: 2,
        hitSounds: crystalBowHitSounds,
    },

    // Bow of faerdhinen
    {
        itemId: 25862,
        name: "Bow of faerdhinen",
        equipmentType: "crystal_bow",
        combatCategory: CombatCategory.BOW,
        animOverrides: bowAnimOverrides,
        attackSequence: 426,
        attackSpeed: 5,
        hitDelay: 2,
        hitSounds: crystalBowHitSounds,
    },
    {
        itemId: 25865,
        name: "Bow of faerdhinen (c)",
        equipmentType: "crystal_bow",
        combatCategory: CombatCategory.BOW,
        animOverrides: bowAnimOverrides,
        attackSequence: 426,
        attackSpeed: 5,
        hitDelay: 2,
        hitSounds: crystalBowHitSounds,
    },

    // Twisted bow
    {
        itemId: 20997,
        name: "Twisted bow",
        equipmentType: "longbow",
        combatCategory: CombatCategory.BOW,
        animOverrides: bowAnimOverrides,
        attackSequence: 426,
        attackSpeed: 5,
        hitDelay: 2,
        hitSounds: longbowHitSounds,
    },

    // ==================================================================================
    // CROSSBOWS (Combat Category 5)
    // Attack Speed: 6 ticks (5 on rapid)
    // Attack anim: 4230 (standard), 7552 (dragon)
    // ==================================================================================
    {
        itemId: 837,
        name: "Crossbow",
        equipmentType: "crossbow",
        combatCategory: CombatCategory.CROSSBOW,
        animOverrides: crossbowAnimOverrides,
        attackSequence: 4230,
        attackSpeed: 6,
        hitDelay: 2,
        hitSounds: crossbowHitSounds,
    },
    {
        itemId: 9174,
        name: "Bronze crossbow",
        equipmentType: "crossbow",
        combatCategory: CombatCategory.CROSSBOW,
        animOverrides: crossbowAnimOverrides,
        attackSequence: 4230,
        attackSpeed: 6,
        hitDelay: 2,
        hitSounds: crossbowHitSounds,
    },
    {
        itemId: 9176,
        name: "Blurite crossbow",
        equipmentType: "crossbow",
        combatCategory: CombatCategory.CROSSBOW,
        animOverrides: crossbowAnimOverrides,
        attackSequence: 4230,
        attackSpeed: 6,
        hitDelay: 2,
        hitSounds: crossbowHitSounds,
    },
    {
        itemId: 9177,
        name: "Iron crossbow",
        equipmentType: "crossbow",
        combatCategory: CombatCategory.CROSSBOW,
        animOverrides: crossbowAnimOverrides,
        attackSequence: 4230,
        attackSpeed: 6,
        hitDelay: 2,
        hitSounds: crossbowHitSounds,
    },
    {
        itemId: 9179,
        name: "Steel crossbow",
        equipmentType: "crossbow",
        combatCategory: CombatCategory.CROSSBOW,
        animOverrides: crossbowAnimOverrides,
        attackSequence: 4230,
        attackSpeed: 6,
        hitDelay: 2,
        hitSounds: crossbowHitSounds,
    },
    {
        itemId: 9181,
        name: "Mithril crossbow",
        equipmentType: "crossbow",
        combatCategory: CombatCategory.CROSSBOW,
        animOverrides: crossbowAnimOverrides,
        attackSequence: 4230,
        attackSpeed: 6,
        hitDelay: 2,
        hitSounds: crossbowHitSounds,
    },
    {
        itemId: 9183,
        name: "Adamant crossbow",
        equipmentType: "crossbow",
        combatCategory: CombatCategory.CROSSBOW,
        animOverrides: crossbowAnimOverrides,
        attackSequence: 4230,
        attackSpeed: 6,
        hitDelay: 2,
        hitSounds: crossbowHitSounds,
    },
    {
        itemId: 9185,
        name: "Rune crossbow",
        equipmentType: "crossbow",
        combatCategory: CombatCategory.CROSSBOW,
        animOverrides: crossbowAnimOverrides,
        attackSequence: 4230,
        attackSpeed: 6,
        hitDelay: 2,
        hitSounds: crossbowHitSounds,
    },
    {
        itemId: 21902,
        name: "Dragon crossbow",
        equipmentType: "crossbow",
        combatCategory: CombatCategory.CROSSBOW,
        animOverrides: crossbowAnimOverrides,
        attackSequence: 7552,
        attackSpeed: 6,
        hitDelay: 2,
        hitSounds: crossbowHitSounds,
    },
    {
        itemId: 11785,
        name: "Armadyl crossbow",
        equipmentType: "crossbow",
        combatCategory: CombatCategory.CROSSBOW,
        animOverrides: crossbowAnimOverrides,
        attackSequence: 4230,
        attackSpeed: 6,
        hitDelay: 2,
        hitSounds: crossbowHitSounds,
    },
    {
        itemId: 26374,
        name: "Zaryte crossbow",
        equipmentType: "crossbow",
        combatCategory: CombatCategory.CROSSBOW,
        animOverrides: crossbowAnimOverrides,
        attackSequence: 4230,
        attackSpeed: 5,
        hitDelay: 2,
        hitSounds: crossbowHitSounds,
    },

    // Karil's crossbow - Unique animations: ready (2074), fire (2075), walk (2076), run (2077)
    {
        itemId: 4734,
        name: "Karil's crossbow",
        equipmentType: "crossbow",
        combatCategory: CombatCategory.CROSSBOW,
        animOverrides: karilCrossbowAnimOverrides,
        attackSequences: karilCrossbowAttackSeqs,
        attackSpeed: 4,
        hitDelay: 2,
        hitSounds: crossbowHitSounds,
    },
    {
        itemId: 4934,
        name: "Karil's crossbow 100",
        equipmentType: "crossbow",
        combatCategory: CombatCategory.CROSSBOW,
        animOverrides: karilCrossbowAnimOverrides,
        attackSequences: karilCrossbowAttackSeqs,
        attackSpeed: 4,
        hitDelay: 2,
        hitSounds: crossbowHitSounds,
    },

    // Dorgeshuun crossbow
    {
        itemId: 8880,
        name: "Dorgeshuun crossbow",
        equipmentType: "crossbow",
        combatCategory: CombatCategory.CROSSBOW,
        animOverrides: crossbowAnimOverrides,
        attackSequence: 4230,
        attackSpeed: 6,
        hitDelay: 2,
        hitSounds: crossbowHitSounds,
    },

    // Hunter's crossbow
    {
        itemId: 10156,
        name: "Hunters' crossbow",
        equipmentType: "crossbow",
        combatCategory: CombatCategory.CROSSBOW,
        animOverrides: crossbowAnimOverrides,
        attackSequence: 4230,
        attackSpeed: 6,
        hitDelay: 2,
        hitSounds: crossbowHitSounds,
    },

    // ==================================================================================
    // BALLISTAS (Combat Category - uses BOW interface)
    // Light ballista: Attack Speed 7 ticks (6 on rapid)
    // Heavy ballista: Attack Speed 8 ticks (NO rapid - only Accurate/Longrange)
    // ==================================================================================
    {
        itemId: 19478,
        name: "Light ballista",
        equipmentType: "ballista",
        combatCategory: CombatCategory.BOW,
        animOverrides: ballistaAnimOverrides,
        attackSequence: 7218,
        attackSpeed: 7,
        hitDelay: 3,
        hitSounds: ballistaHitSounds,
    },
    {
        itemId: 19481,
        name: "Heavy ballista",
        equipmentType: "ballista",
        combatCategory: CombatCategory.BOW,
        animOverrides: ballistaAnimOverrides,
        attackSequence: 7218,
        attackSpeed: 8,
        hitDelay: 3,
        hitSounds: ballistaHitSounds,
        combatStyles: heavyBallistaCombatStyles,
    },

    // ==================================================================================
    // THROWN WEAPONS (Combat Category 19)
    // ==================================================================================
    // Darts - Attack Speed: 3 ticks (2 on rapid)
    {
        itemId: 806,
        name: "Bronze dart",
        equipmentType: "dart",
        combatCategory: CombatCategory.THROWN,
        animOverrides: thrownAnimOverrides,
        attackSequence: 7554,
        attackSpeed: 3,
        hitDelay: 2,
        hitSounds: dartHitSounds,
    },
    {
        itemId: 807,
        name: "Iron dart",
        equipmentType: "dart",
        combatCategory: CombatCategory.THROWN,
        animOverrides: thrownAnimOverrides,
        attackSequence: 7554,
        attackSpeed: 3,
        hitDelay: 2,
        hitSounds: dartHitSounds,
    },
    {
        itemId: 808,
        name: "Steel dart",
        equipmentType: "dart",
        combatCategory: CombatCategory.THROWN,
        animOverrides: thrownAnimOverrides,
        attackSequence: 7554,
        attackSpeed: 3,
        hitDelay: 2,
        hitSounds: dartHitSounds,
    },
    {
        itemId: 3093,
        name: "Black dart",
        equipmentType: "dart",
        combatCategory: CombatCategory.THROWN,
        animOverrides: thrownAnimOverrides,
        attackSequence: 7554,
        attackSpeed: 3,
        hitDelay: 2,
        hitSounds: dartHitSounds,
    },
    {
        itemId: 809,
        name: "Mithril dart",
        equipmentType: "dart",
        combatCategory: CombatCategory.THROWN,
        animOverrides: thrownAnimOverrides,
        attackSequence: 7554,
        attackSpeed: 3,
        hitDelay: 2,
        hitSounds: dartHitSounds,
    },
    {
        itemId: 810,
        name: "Adamant dart",
        equipmentType: "dart",
        combatCategory: CombatCategory.THROWN,
        animOverrides: thrownAnimOverrides,
        attackSequence: 7554,
        attackSpeed: 3,
        hitDelay: 2,
        hitSounds: dartHitSounds,
    },
    {
        itemId: 811,
        name: "Rune dart",
        equipmentType: "dart",
        combatCategory: CombatCategory.THROWN,
        animOverrides: thrownAnimOverrides,
        attackSequence: 7554,
        attackSpeed: 3,
        hitDelay: 2,
        hitSounds: dartHitSounds,
    },
    {
        itemId: 11230,
        name: "Dragon dart",
        equipmentType: "dart",
        combatCategory: CombatCategory.THROWN,
        animOverrides: thrownAnimOverrides,
        attackSequence: 7554,
        attackSpeed: 3,
        hitDelay: 2,
        hitSounds: dartHitSounds,
    },
    {
        itemId: 25849,
        name: "Amethyst dart",
        equipmentType: "dart",
        combatCategory: CombatCategory.THROWN,
        animOverrides: thrownAnimOverrides,
        attackSequence: 7554,
        attackSpeed: 3,
        hitDelay: 2,
        hitSounds: dartHitSounds,
    },

    // Knives - Attack Speed: 3 ticks (2 on rapid) - 
    {
        itemId: 864,
        name: "Bronze knife",
        equipmentType: "knife",
        combatCategory: CombatCategory.THROWN,
        animOverrides: thrownAnimOverrides,
        attackSequence: 929,
        attackSpeed: 3,
        hitDelay: 2,
        hitSounds: knifeHitSounds,
    },
    {
        itemId: 863,
        name: "Iron knife",
        equipmentType: "knife",
        combatCategory: CombatCategory.THROWN,
        animOverrides: thrownAnimOverrides,
        attackSequence: 929,
        attackSpeed: 3,
        hitDelay: 2,
        hitSounds: knifeHitSounds,
    },
    {
        itemId: 865,
        name: "Steel knife",
        equipmentType: "knife",
        combatCategory: CombatCategory.THROWN,
        animOverrides: thrownAnimOverrides,
        attackSequence: 929,
        attackSpeed: 3,
        hitDelay: 2,
        hitSounds: knifeHitSounds,
    },
    {
        itemId: 869,
        name: "Black knife",
        equipmentType: "knife",
        combatCategory: CombatCategory.THROWN,
        animOverrides: thrownAnimOverrides,
        attackSequence: 929,
        attackSpeed: 3,
        hitDelay: 2,
        hitSounds: knifeHitSounds,
    },
    {
        itemId: 866,
        name: "Mithril knife",
        equipmentType: "knife",
        combatCategory: CombatCategory.THROWN,
        animOverrides: thrownAnimOverrides,
        attackSequence: 929,
        attackSpeed: 3,
        hitDelay: 2,
        hitSounds: knifeHitSounds,
    },
    {
        itemId: 867,
        name: "Adamant knife",
        equipmentType: "knife",
        combatCategory: CombatCategory.THROWN,
        animOverrides: thrownAnimOverrides,
        attackSequence: 929,
        attackSpeed: 3,
        hitDelay: 2,
        hitSounds: knifeHitSounds,
    },
    {
        itemId: 868,
        name: "Rune knife",
        equipmentType: "knife",
        combatCategory: CombatCategory.THROWN,
        animOverrides: thrownAnimOverrides,
        attackSequence: 929,
        attackSpeed: 3,
        hitDelay: 2,
        hitSounds: knifeHitSounds,
    },
    {
        itemId: 22804,
        name: "Dragon knife",
        equipmentType: "knife",
        combatCategory: CombatCategory.THROWN,
        animOverrides: thrownAnimOverrides,
        attackSequence: 929,
        attackSpeed: 3,
        hitDelay: 2,
        hitSounds: knifeHitSounds,
    },

    // Throwing axes - Attack Speed: 5 ticks (4 on rapid)
    {
        itemId: 800,
        name: "Bronze thrownaxe",
        equipmentType: "thrownaxe",
        combatCategory: CombatCategory.THROWN,
        animOverrides: thrownAnimOverrides,
        attackSequence: 929,
        attackSpeed: 5,
        hitDelay: 2,
        hitSounds: thrownaxeHitSounds,
    },
    {
        itemId: 801,
        name: "Iron thrownaxe",
        equipmentType: "thrownaxe",
        combatCategory: CombatCategory.THROWN,
        animOverrides: thrownAnimOverrides,
        attackSequence: 929,
        attackSpeed: 5,
        hitDelay: 2,
        hitSounds: thrownaxeHitSounds,
    },
    {
        itemId: 802,
        name: "Steel thrownaxe",
        equipmentType: "thrownaxe",
        combatCategory: CombatCategory.THROWN,
        animOverrides: thrownAnimOverrides,
        attackSequence: 929,
        attackSpeed: 5,
        hitDelay: 2,
        hitSounds: thrownaxeHitSounds,
    },
    {
        itemId: 803,
        name: "Mithril thrownaxe",
        equipmentType: "thrownaxe",
        combatCategory: CombatCategory.THROWN,
        animOverrides: thrownAnimOverrides,
        attackSequence: 929,
        attackSpeed: 5,
        hitDelay: 2,
        hitSounds: thrownaxeHitSounds,
    },
    {
        itemId: 804,
        name: "Adamant thrownaxe",
        equipmentType: "thrownaxe",
        combatCategory: CombatCategory.THROWN,
        animOverrides: thrownAnimOverrides,
        attackSequence: 929,
        attackSpeed: 5,
        hitDelay: 2,
        hitSounds: thrownaxeHitSounds,
    },
    {
        itemId: 805,
        name: "Rune thrownaxe",
        equipmentType: "thrownaxe",
        combatCategory: CombatCategory.THROWN,
        animOverrides: thrownAnimOverrides,
        attackSequence: 929,
        attackSpeed: 5,
        hitDelay: 2,
        hitSounds: thrownaxeHitSounds,
    },
    {
        itemId: 20849,
        name: "Dragon thrownaxe",
        equipmentType: "thrownaxe",
        combatCategory: CombatCategory.THROWN,
        animOverrides: thrownAnimOverrides,
        attackSequence: 929,
        attackSpeed: 5,
        hitDelay: 2,
        hitSounds: thrownaxeHitSounds,
    },

    // Javelins - Attack Speed: 6 ticks (5 on rapid)
    {
        itemId: 825,
        name: "Bronze javelin",
        equipmentType: "javelin",
        combatCategory: CombatCategory.THROWN,
        animOverrides: thrownAnimOverrides,
        attackSequence: 929,
        attackSpeed: 6,
        hitDelay: 2,
        hitSounds: javelinHitSounds,
    },
    {
        itemId: 826,
        name: "Iron javelin",
        equipmentType: "javelin",
        combatCategory: CombatCategory.THROWN,
        animOverrides: thrownAnimOverrides,
        attackSequence: 929,
        attackSpeed: 6,
        hitDelay: 2,
        hitSounds: javelinHitSounds,
    },
    {
        itemId: 827,
        name: "Steel javelin",
        equipmentType: "javelin",
        combatCategory: CombatCategory.THROWN,
        animOverrides: thrownAnimOverrides,
        attackSequence: 929,
        attackSpeed: 6,
        hitDelay: 2,
        hitSounds: javelinHitSounds,
    },
    {
        itemId: 828,
        name: "Mithril javelin",
        equipmentType: "javelin",
        combatCategory: CombatCategory.THROWN,
        animOverrides: thrownAnimOverrides,
        attackSequence: 929,
        attackSpeed: 6,
        hitDelay: 2,
        hitSounds: javelinHitSounds,
    },
    {
        itemId: 829,
        name: "Adamant javelin",
        equipmentType: "javelin",
        combatCategory: CombatCategory.THROWN,
        animOverrides: thrownAnimOverrides,
        attackSequence: 929,
        attackSpeed: 6,
        hitDelay: 2,
        hitSounds: javelinHitSounds,
    },
    {
        itemId: 830,
        name: "Rune javelin",
        equipmentType: "javelin",
        combatCategory: CombatCategory.THROWN,
        animOverrides: thrownAnimOverrides,
        attackSequence: 929,
        attackSpeed: 6,
        hitDelay: 2,
        hitSounds: javelinHitSounds,
    },
    {
        itemId: 19484,
        name: "Dragon javelin",
        equipmentType: "javelin",
        combatCategory: CombatCategory.THROWN,
        animOverrides: thrownAnimOverrides,
        attackSequence: 929,
        attackSpeed: 6,
        hitDelay: 2,
        hitSounds: javelinHitSounds,
    },
    {
        itemId: 25855,
        name: "Amethyst javelin",
        equipmentType: "javelin",
        combatCategory: CombatCategory.THROWN,
        animOverrides: thrownAnimOverrides,
        attackSequence: 929,
        attackSpeed: 6,
        hitDelay: 2,
        hitSounds: javelinHitSounds,
    },

    // Toxic blowpipe - Attack Speed: 3 ticks (2 on rapid in PvM, 3/2 in PvP)
    {
        itemId: 12926,
        name: "Toxic blowpipe",
        equipmentType: "blowpipe",
        combatCategory: CombatCategory.THROWN,
        animOverrides: thrownAnimOverrides,
        attackSequence: 5061,
        attackSpeed: 3,
        hitDelay: 2,
        hitSounds: blowpipeHitSounds,
    },
    {
        itemId: 12924,
        name: "Toxic blowpipe (empty)",
        equipmentType: "blowpipe",
        combatCategory: CombatCategory.THROWN,
        animOverrides: thrownAnimOverrides,
        attackSequence: 5061,
        attackSpeed: 3,
        hitDelay: 2,
        hitSounds: blowpipeHitSounds,
    },

    // ==================================================================================
    // CHINCHOMPAS (Combat Category 7)
    // Attack Speed: 4 ticks (3 on rapid)
    // ==================================================================================
    {
        itemId: 10033,
        name: "Chinchompa",
        equipmentType: "chinchompa",
        combatCategory: CombatCategory.CHINCHOMPA,
        animOverrides: thrownAnimOverrides,
        attackSequence: 7618,
        attackSpeed: 4,
        hitDelay: 2,
        hitSounds: chinchompaHitSounds,
    },
    {
        itemId: 10034,
        name: "Red chinchompa",
        equipmentType: "chinchompa",
        combatCategory: CombatCategory.CHINCHOMPA,
        animOverrides: thrownAnimOverrides,
        attackSequence: 7618,
        attackSpeed: 4,
        hitDelay: 2,
        hitSounds: chinchompaHitSounds,
    },
    {
        itemId: 11959,
        name: "Black chinchompa",
        equipmentType: "chinchompa",
        combatCategory: CombatCategory.CHINCHOMPA,
        animOverrides: thrownAnimOverrides,
        attackSequence: 7618,
        attackSpeed: 4,
        hitDelay: 2,
        hitSounds: chinchompaHitSounds,
    },

    // ==================================================================================
    // STAVES (Combat Category 13 - no autocast)
    // Attack Speed: 5 ticks
    // Attack anims: 412 (bash), 413 (pound), 414 (focus)
    // ==================================================================================
    {
        itemId: 1379,
        name: "Staff",
        equipmentType: "staff",
        combatCategory: CombatCategory.STAFF,
        animOverrides: staffAnimOverrides,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: staffHitSounds,
    },
    {
        itemId: 1381,
        name: "Staff of air",
        equipmentType: "staff",
        combatCategory: CombatCategory.MAGIC_STAFF,
        animOverrides: magicStaffAnimOverrides,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: staffHitSounds,
    },
    {
        itemId: 1383,
        name: "Staff of water",
        equipmentType: "staff",
        combatCategory: CombatCategory.MAGIC_STAFF,
        animOverrides: magicStaffAnimOverrides,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: staffHitSounds,
    },
    {
        itemId: 1385,
        name: "Staff of earth",
        equipmentType: "staff",
        combatCategory: CombatCategory.MAGIC_STAFF,
        animOverrides: magicStaffAnimOverrides,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: staffHitSounds,
    },
    {
        itemId: 1387,
        name: "Staff of fire",
        equipmentType: "staff",
        combatCategory: CombatCategory.MAGIC_STAFF,
        animOverrides: magicStaffAnimOverrides,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: staffHitSounds,
    },

    // Magic staff
    {
        itemId: 1389,
        name: "Magic staff",
        equipmentType: "staff",
        combatCategory: CombatCategory.MAGIC_STAFF,
        animOverrides: magicStaffAnimOverrides,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: staffHitSounds,
    },

    // ==================================================================================
    // BATTLESTAVES (Combat Category 18 - with autocast)
    // Attack Speed: 5 ticks
    // ==================================================================================
    {
        itemId: 1397,
        name: "Air battlestaff",
        equipmentType: "battlestaff",
        combatCategory: CombatCategory.MAGIC_STAFF,
        animOverrides: magicStaffAnimOverrides,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: staffHitSounds,
    },
    {
        itemId: 1399,
        name: "Water battlestaff",
        equipmentType: "battlestaff",
        combatCategory: CombatCategory.MAGIC_STAFF,
        animOverrides: magicStaffAnimOverrides,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: staffHitSounds,
    },
    {
        itemId: 1401,
        name: "Earth battlestaff",
        equipmentType: "battlestaff",
        combatCategory: CombatCategory.MAGIC_STAFF,
        animOverrides: magicStaffAnimOverrides,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: staffHitSounds,
    },
    {
        itemId: 1403,
        name: "Fire battlestaff",
        equipmentType: "battlestaff",
        combatCategory: CombatCategory.MAGIC_STAFF,
        animOverrides: magicStaffAnimOverrides,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: staffHitSounds,
    },
    {
        itemId: 1391,
        name: "Battlestaff",
        equipmentType: "battlestaff",
        combatCategory: CombatCategory.MAGIC_STAFF,
        animOverrides: magicStaffAnimOverrides,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: staffHitSounds,
    },
    {
        itemId: 6562,
        name: "Mud battlestaff",
        equipmentType: "battlestaff",
        combatCategory: CombatCategory.MAGIC_STAFF,
        animOverrides: magicStaffAnimOverrides,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: staffHitSounds,
    },
    {
        itemId: 11787,
        name: "Steam battlestaff",
        equipmentType: "battlestaff",
        combatCategory: CombatCategory.MAGIC_STAFF,
        animOverrides: magicStaffAnimOverrides,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: staffHitSounds,
    },
    {
        itemId: 11789,
        name: "Lava battlestaff",
        equipmentType: "battlestaff",
        combatCategory: CombatCategory.MAGIC_STAFF,
        animOverrides: magicStaffAnimOverrides,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: staffHitSounds,
    },
    {
        itemId: 21198,
        name: "Smoke battlestaff",
        equipmentType: "battlestaff",
        combatCategory: CombatCategory.MAGIC_STAFF,
        animOverrides: magicStaffAnimOverrides,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: staffHitSounds,
    },
    {
        itemId: 21200,
        name: "Mist battlestaff",
        equipmentType: "battlestaff",
        combatCategory: CombatCategory.MAGIC_STAFF,
        animOverrides: magicStaffAnimOverrides,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: staffHitSounds,
    },
    {
        itemId: 21202,
        name: "Dust battlestaff",
        equipmentType: "battlestaff",
        combatCategory: CombatCategory.MAGIC_STAFF,
        animOverrides: magicStaffAnimOverrides,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: staffHitSounds,
    },

    // ==================================================================================
    // MYSTIC STAVES (Combat Category 18)
    // Attack Speed: 5 ticks
    // ==================================================================================
    {
        itemId: 1405,
        name: "Mystic air staff",
        equipmentType: "mystic_staff",
        combatCategory: CombatCategory.MAGIC_STAFF,
        animOverrides: magicStaffAnimOverrides,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: staffHitSounds,
    },
    {
        itemId: 1407,
        name: "Mystic water staff",
        equipmentType: "mystic_staff",
        combatCategory: CombatCategory.MAGIC_STAFF,
        animOverrides: magicStaffAnimOverrides,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: staffHitSounds,
    },
    {
        itemId: 1409,
        name: "Mystic earth staff",
        equipmentType: "mystic_staff",
        combatCategory: CombatCategory.MAGIC_STAFF,
        animOverrides: magicStaffAnimOverrides,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: staffHitSounds,
    },
    {
        itemId: 1411,
        name: "Mystic fire staff",
        equipmentType: "mystic_staff",
        combatCategory: CombatCategory.MAGIC_STAFF,
        animOverrides: magicStaffAnimOverrides,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: staffHitSounds,
    },
    {
        itemId: 6563,
        name: "Mystic mud staff",
        equipmentType: "mystic_staff",
        combatCategory: CombatCategory.MAGIC_STAFF,
        animOverrides: magicStaffAnimOverrides,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: staffHitSounds,
    },
    {
        itemId: 11789,
        name: "Mystic lava staff",
        equipmentType: "mystic_staff",
        combatCategory: CombatCategory.MAGIC_STAFF,
        animOverrides: magicStaffAnimOverrides,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: staffHitSounds,
    },
    {
        itemId: 11998,
        name: "Mystic steam staff",
        equipmentType: "mystic_staff",
        combatCategory: CombatCategory.MAGIC_STAFF,
        animOverrides: magicStaffAnimOverrides,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: staffHitSounds,
    },
    {
        itemId: 12000,
        name: "Mystic smoke staff",
        equipmentType: "mystic_staff",
        combatCategory: CombatCategory.MAGIC_STAFF,
        animOverrides: magicStaffAnimOverrides,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: staffHitSounds,
    },

    // ==================================================================================
    // SPECIAL STAVES
    // ==================================================================================
    // Staff of the dead family
    {
        itemId: 11791,
        name: "Staff of the dead",
        equipmentType: "staff",
        combatCategory: CombatCategory.MAGIC_STAFF,
        animOverrides: magicStaffAnimOverrides,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: staffHitSounds,
    },
    {
        itemId: 12904,
        name: "Toxic staff of the dead",
        equipmentType: "staff",
        combatCategory: CombatCategory.MAGIC_STAFF,
        animOverrides: magicStaffAnimOverrides,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: staffHitSounds,
    },
    {
        itemId: 22296,
        name: "Staff of light",
        equipmentType: "staff",
        combatCategory: CombatCategory.MAGIC_STAFF,
        animOverrides: magicStaffAnimOverrides,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: staffHitSounds,
    },
    {
        itemId: 22323,
        name: "Sanguinesti staff",
        equipmentType: "powered_staff",
        combatCategory: CombatCategory.POWERED_STAFF,
        animOverrides: magicStaffAnimOverrides,
        attackSequences: tridentAttackSeqs,
        attackSpeed: 4,
        hitDelay: 2,
        hitSounds: poweredStaffHitSounds,
    },
    {
        itemId: 25739,
        name: "Holy sanguinesti staff",
        equipmentType: "powered_staff",
        combatCategory: CombatCategory.POWERED_STAFF,
        animOverrides: magicStaffAnimOverrides,
        attackSequences: tridentAttackSeqs,
        attackSpeed: 4,
        hitDelay: 2,
        hitSounds: poweredStaffHitSounds,
    },

    // Ancient staff
    {
        itemId: 4675,
        name: "Ancient staff",
        equipmentType: "staff",
        combatCategory: CombatCategory.MAGIC_STAFF,
        animOverrides: magicStaffAnimOverrides,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: staffHitSounds,
    },
    {
        itemId: 21006,
        name: "Kodai wand",
        equipmentType: "wand",
        combatCategory: CombatCategory.MAGIC_STAFF,
        animOverrides: magicStaffAnimOverrides,
        attackSpeed: 4,
        hitDelay: 2,
        hitSounds: staffHitSounds,
    },

    // Slayer's staff
    {
        itemId: 4170,
        name: "Slayer's staff",
        equipmentType: "staff",
        combatCategory: CombatCategory.MAGIC_STAFF,
        animOverrides: magicStaffAnimOverrides,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: staffHitSounds,
    },
    {
        itemId: 21255,
        name: "Slayer's staff (e)",
        equipmentType: "staff",
        combatCategory: CombatCategory.MAGIC_STAFF,
        animOverrides: magicStaffAnimOverrides,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: staffHitSounds,
    },

    // Iban's staff
    {
        itemId: 1409,
        name: "Iban's staff",
        equipmentType: "staff",
        combatCategory: CombatCategory.MAGIC_STAFF,
        animOverrides: magicStaffAnimOverrides,
        attackSpeed: 5,
        hitDelay: 2,
        hitSounds: staffHitSounds,
    },
    {
        itemId: 12658,
        name: "Iban's staff (u)",
        equipmentType: "staff",
        combatCategory: CombatCategory.MAGIC_STAFF,
        animOverrides: magicStaffAnimOverrides,
        attackSpeed: 5,
        hitDelay: 2,
        hitSounds: staffHitSounds,
    },

    // Dramen/Lunar staff
    {
        itemId: 772,
        name: "Dramen staff",
        equipmentType: "staff",
        combatCategory: CombatCategory.STAFF,
        animOverrides: staffAnimOverrides,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: staffHitSounds,
    },
    {
        itemId: 9084,
        name: "Lunar staff",
        equipmentType: "staff",
        combatCategory: CombatCategory.MAGIC_STAFF,
        animOverrides: magicStaffAnimOverrides,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: staffHitSounds,
    },

    // Nightmare staff
    {
        itemId: 24422,
        name: "Nightmare staff",
        equipmentType: "staff",
        combatCategory: CombatCategory.MAGIC_STAFF,
        animOverrides: magicStaffAnimOverrides,
        attackSpeed: 5,
        hitDelay: 2,
        hitSounds: staffHitSounds,
    },
    {
        itemId: 24424,
        name: "Eldritch nightmare staff",
        equipmentType: "staff",
        combatCategory: CombatCategory.MAGIC_STAFF,
        animOverrides: magicStaffAnimOverrides,
        attackSpeed: 5,
        hitDelay: 2,
        hitSounds: staffHitSounds,
    },
    {
        itemId: 24425,
        name: "Harmonised nightmare staff",
        equipmentType: "staff",
        combatCategory: CombatCategory.MAGIC_STAFF,
        animOverrides: magicStaffAnimOverrides,
        attackSpeed: 4,
        hitDelay: 2,
        hitSounds: staffHitSounds,
    },
    {
        itemId: 24423,
        name: "Volatile nightmare staff",
        equipmentType: "staff",
        combatCategory: CombatCategory.MAGIC_STAFF,
        animOverrides: magicStaffAnimOverrides,
        attackSpeed: 5,
        hitDelay: 2,
        hitSounds: staffHitSounds,
    },

    // Staff of Armadyl
    {
        itemId: 84,
        name: "Staff of armadyl",
        equipmentType: "staff",
        combatCategory: CombatCategory.MAGIC_STAFF,
        animOverrides: magicStaffAnimOverrides,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: staffHitSounds,
    },

    // ==================================================================================
    // TRIDENTS / POWERED STAVES (Combat Category 23)
    // Attack Speed: 4 ticks (default for powered staves)
    // ==================================================================================
    {
        itemId: 11905,
        name: "Trident of the seas (full)",
        equipmentType: "trident",
        combatCategory: CombatCategory.POWERED_STAFF,
        animOverrides: magicStaffAnimOverrides,
        attackSequences: tridentAttackSeqs,
        attackSpeed: 4,
        hitDelay: 2,
        hitSounds: poweredStaffHitSounds,
    },
    {
        itemId: 11907,
        name: "Trident of the seas",
        equipmentType: "trident",
        combatCategory: CombatCategory.POWERED_STAFF,
        animOverrides: magicStaffAnimOverrides,
        attackSequences: tridentAttackSeqs,
        attackSpeed: 4,
        hitDelay: 2,
        hitSounds: poweredStaffHitSounds,
    },
    {
        itemId: 11908,
        name: "Uncharged trident",
        equipmentType: "trident",
        combatCategory: CombatCategory.POWERED_STAFF,
        animOverrides: magicStaffAnimOverrides,
        attackSequences: tridentAttackSeqs,
        attackSpeed: 4,
        hitDelay: 2,
        hitSounds: poweredStaffHitSounds,
    },
    {
        itemId: 22288,
        name: "Trident of the seas (e)",
        equipmentType: "trident",
        combatCategory: CombatCategory.POWERED_STAFF,
        animOverrides: magicStaffAnimOverrides,
        attackSequences: tridentAttackSeqs,
        attackSpeed: 4,
        hitDelay: 2,
        hitSounds: poweredStaffHitSounds,
    },
    {
        itemId: 12899,
        name: "Trident of the swamp",
        equipmentType: "trident",
        combatCategory: CombatCategory.POWERED_STAFF,
        animOverrides: magicStaffAnimOverrides,
        attackSequences: tridentAttackSeqs,
        attackSpeed: 4,
        hitDelay: 2,
        hitSounds: poweredStaffHitSounds,
    },
    {
        itemId: 12900,
        name: "Uncharged toxic trident",
        equipmentType: "trident",
        combatCategory: CombatCategory.POWERED_STAFF,
        animOverrides: magicStaffAnimOverrides,
        attackSequences: tridentAttackSeqs,
        attackSpeed: 4,
        hitDelay: 2,
        hitSounds: poweredStaffHitSounds,
    },
    {
        itemId: 22292,
        name: "Trident of the swamp (e)",
        equipmentType: "trident",
        combatCategory: CombatCategory.POWERED_STAFF,
        animOverrides: magicStaffAnimOverrides,
        attackSequences: tridentAttackSeqs,
        attackSpeed: 4,
        hitDelay: 2,
        hitSounds: poweredStaffHitSounds,
    },

    // ==================================================================================
    // TUMEKEN'S SHADOW (Combat Category 31)
    // Attack Speed: 5 ticks
    // ==================================================================================
    {
        itemId: 27275,
        name: "Tumeken's shadow",
        equipmentType: "powered_staff",
        combatCategory: CombatCategory.TUMEKEN,
        animOverrides: tumekensShadowAnimOverrides,
        attackSequences: tumekenAttackSeqs,
        attackSpeed: 5,
        hitDelay: 2,
        hitSounds: poweredStaffHitSounds,
    },
    {
        itemId: 27277,
        name: "Tumeken's shadow (uncharged)",
        equipmentType: "powered_staff",
        combatCategory: CombatCategory.TUMEKEN,
        animOverrides: tumekensShadowAnimOverrides,
        attackSequences: tumekenAttackSeqs,
        attackSpeed: 5,
        hitDelay: 2,
        hitSounds: poweredStaffHitSounds,
    },

    // ==================================================================================
    // WANDS (Combat Category 18)
    // Attack Speed: 4 ticks
    // ==================================================================================
    {
        itemId: 6908,
        name: "Beginner wand",
        equipmentType: "wand",
        combatCategory: CombatCategory.MAGIC_STAFF,
        animOverrides: magicStaffAnimOverrides,
        attackSpeed: 4,
        hitDelay: 2,
        hitSounds: staffHitSounds,
    },
    {
        itemId: 6910,
        name: "Apprentice wand",
        equipmentType: "wand",
        combatCategory: CombatCategory.MAGIC_STAFF,
        animOverrides: magicStaffAnimOverrides,
        attackSpeed: 4,
        hitDelay: 2,
        hitSounds: staffHitSounds,
    },
    {
        itemId: 6912,
        name: "Teacher wand",
        equipmentType: "wand",
        combatCategory: CombatCategory.MAGIC_STAFF,
        animOverrides: magicStaffAnimOverrides,
        attackSpeed: 4,
        hitDelay: 2,
        hitSounds: staffHitSounds,
    },
    {
        itemId: 6914,
        name: "Master wand",
        equipmentType: "wand",
        combatCategory: CombatCategory.MAGIC_STAFF,
        animOverrides: magicStaffAnimOverrides,
        attackSpeed: 4,
        hitDelay: 2,
        hitSounds: staffHitSounds,
    },
    {
        itemId: 12422,
        name: "3rd age wand",
        equipmentType: "wand",
        combatCategory: CombatCategory.MAGIC_STAFF,
        animOverrides: magicStaffAnimOverrides,
        attackSpeed: 4,
        hitDelay: 2,
        hitSounds: staffHitSounds,
    },

    // ==================================================================================
    // AHRIM'S STAFF (Combat Category 18)
    // Attack Speed: 5 ticks
    // ==================================================================================
    // Ahrim's staff - Unique animation: 2078
    {
        itemId: 4710,
        name: "Ahrim's staff",
        equipmentType: "staff",
        combatCategory: CombatCategory.MAGIC_STAFF,
        animOverrides: magicStaffAnimOverrides,
        attackSequences: ahrimStaffAttackSeqs,
        attackSpeed: 5,
        hitDelay: 2,
        hitSounds: staffHitSounds,
    },
    {
        itemId: 4862,
        name: "Ahrim's staff 100",
        equipmentType: "staff",
        combatCategory: CombatCategory.MAGIC_STAFF,
        animOverrides: magicStaffAnimOverrides,
        attackSequences: ahrimStaffAttackSeqs,
        attackSpeed: 5,
        hitDelay: 2,
        hitSounds: staffHitSounds,
    },
    {
        itemId: 4863,
        name: "Ahrim's staff 75",
        equipmentType: "staff",
        combatCategory: CombatCategory.MAGIC_STAFF,
        animOverrides: magicStaffAnimOverrides,
        attackSequences: ahrimStaffAttackSeqs,
        attackSpeed: 5,
        hitDelay: 2,
        hitSounds: staffHitSounds,
    },
    {
        itemId: 4864,
        name: "Ahrim's staff 50",
        equipmentType: "staff",
        combatCategory: CombatCategory.MAGIC_STAFF,
        animOverrides: magicStaffAnimOverrides,
        attackSequences: ahrimStaffAttackSeqs,
        attackSpeed: 5,
        hitDelay: 2,
        hitSounds: staffHitSounds,
    },
    {
        itemId: 4865,
        name: "Ahrim's staff 25",
        equipmentType: "staff",
        combatCategory: CombatCategory.MAGIC_STAFF,
        animOverrides: magicStaffAnimOverrides,
        attackSequences: ahrimStaffAttackSeqs,
        attackSpeed: 5,
        hitDelay: 2,
        hitSounds: staffHitSounds,
    },

    // ==================================================================================
    // SALAMANDERS (Combat Category 6)
    // Attack Speed: 5 ticks
    // ==================================================================================
    {
        itemId: 10145,
        name: "Swamp lizard",
        equipmentType: "salamander",
        combatCategory: CombatCategory.SALAMANDER,
        animOverrides: staffAnimOverrides,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: spearHitSounds,
    },
    {
        itemId: 10147,
        name: "Orange salamander",
        equipmentType: "salamander",
        combatCategory: CombatCategory.SALAMANDER,
        animOverrides: staffAnimOverrides,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: spearHitSounds,
    },
    {
        itemId: 10149,
        name: "Red salamander",
        equipmentType: "salamander",
        combatCategory: CombatCategory.SALAMANDER,
        animOverrides: staffAnimOverrides,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: spearHitSounds,
    },
    {
        itemId: 10146,
        name: "Black salamander",
        equipmentType: "salamander",
        combatCategory: CombatCategory.SALAMANDER,
        animOverrides: staffAnimOverrides,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: spearHitSounds,
    },

    // ==================================================================================
    // DHAROK'S GREATAXE (Combat Category 1)
    // Attack Speed: 7 ticks
    // Unique animation: 2067
    // ==================================================================================
    {
        itemId: 4718,
        name: "Dharok's greataxe",
        equipmentType: "greataxe",
        combatCategory: CombatCategory.AXE,
        animOverrides: dharokAxeAnimOverrides,
        attackSequences: dharokAxeAttackSeqs,
        attackSpeed: 7,
        hitDelay: 1,
        hitSounds: battleaxeHitSounds,
    },
    {
        itemId: 4886,
        name: "Dharok's greataxe 100",
        equipmentType: "greataxe",
        combatCategory: CombatCategory.AXE,
        animOverrides: dharokAxeAnimOverrides,
        attackSequences: dharokAxeAttackSeqs,
        attackSpeed: 7,
        hitDelay: 1,
        hitSounds: battleaxeHitSounds,
    },
    {
        itemId: 4887,
        name: "Dharok's greataxe 75",
        equipmentType: "greataxe",
        combatCategory: CombatCategory.AXE,
        animOverrides: dharokAxeAnimOverrides,
        attackSequences: dharokAxeAttackSeqs,
        attackSpeed: 7,
        hitDelay: 1,
        hitSounds: battleaxeHitSounds,
    },
    {
        itemId: 4888,
        name: "Dharok's greataxe 50",
        equipmentType: "greataxe",
        combatCategory: CombatCategory.AXE,
        animOverrides: dharokAxeAnimOverrides,
        attackSequences: dharokAxeAttackSeqs,
        attackSpeed: 7,
        hitDelay: 1,
        hitSounds: battleaxeHitSounds,
    },
    {
        itemId: 4889,
        name: "Dharok's greataxe 25",
        equipmentType: "greataxe",
        combatCategory: CombatCategory.AXE,
        animOverrides: dharokAxeAnimOverrides,
        attackSequences: dharokAxeAttackSeqs,
        attackSpeed: 7,
        hitDelay: 1,
        hitSounds: battleaxeHitSounds,
    },

    // ==================================================================================
    // TORAG'S HAMMERS (Combat Category 2)
    // Attack Speed: 5 ticks
    // Unique animation: 2068
    // ==================================================================================
    {
        itemId: 4747,
        name: "Torag's hammers",
        equipmentType: "hammers",
        combatCategory: CombatCategory.HAMMER,
        animOverrides: toragHammersAnimOverrides,
        attackSequences: toragHammersAttackSeqs,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: warhammerHitSounds,
    },
    {
        itemId: 4958,
        name: "Torag's hammers 100",
        equipmentType: "hammers",
        combatCategory: CombatCategory.HAMMER,
        animOverrides: toragHammersAnimOverrides,
        attackSequences: toragHammersAttackSeqs,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: warhammerHitSounds,
    },
    {
        itemId: 4959,
        name: "Torag's hammers 75",
        equipmentType: "hammers",
        combatCategory: CombatCategory.HAMMER,
        animOverrides: toragHammersAnimOverrides,
        attackSequences: toragHammersAttackSeqs,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: warhammerHitSounds,
    },
    {
        itemId: 4960,
        name: "Torag's hammers 50",
        equipmentType: "hammers",
        combatCategory: CombatCategory.HAMMER,
        animOverrides: toragHammersAnimOverrides,
        attackSequences: toragHammersAttackSeqs,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: warhammerHitSounds,
    },
    {
        itemId: 4961,
        name: "Torag's hammers 25",
        equipmentType: "hammers",
        combatCategory: CombatCategory.HAMMER,
        animOverrides: toragHammersAnimOverrides,
        attackSequences: toragHammersAttackSeqs,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: warhammerHitSounds,
    },

    // ==================================================================================
    // GUTHAN'S WARSPEAR (Combat Category 15)
    // Attack Speed: 5 ticks
    // Unique animations: Stab (2080), Swipe (2081), Lunge (2082)
    // ==================================================================================
    {
        itemId: 4726,
        name: "Guthan's warspear",
        equipmentType: "spear",
        combatCategory: CombatCategory.SPEAR,
        animOverrides: guthanSpearAnimOverrides,
        attackSequences: guthanSpearAttackSeqs,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: spearHitSounds,
    },
    {
        itemId: 4910,
        name: "Guthan's warspear 100",
        equipmentType: "spear",
        combatCategory: CombatCategory.SPEAR,
        animOverrides: guthanSpearAnimOverrides,
        attackSequences: guthanSpearAttackSeqs,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: spearHitSounds,
    },
    {
        itemId: 4911,
        name: "Guthan's warspear 75",
        equipmentType: "spear",
        combatCategory: CombatCategory.SPEAR,
        animOverrides: guthanSpearAnimOverrides,
        attackSequences: guthanSpearAttackSeqs,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: spearHitSounds,
    },
    {
        itemId: 4912,
        name: "Guthan's warspear 50",
        equipmentType: "spear",
        combatCategory: CombatCategory.SPEAR,
        animOverrides: guthanSpearAnimOverrides,
        attackSequences: guthanSpearAttackSeqs,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: spearHitSounds,
    },
    {
        itemId: 4913,
        name: "Guthan's warspear 25",
        equipmentType: "spear",
        combatCategory: CombatCategory.SPEAR,
        animOverrides: guthanSpearAnimOverrides,
        attackSequences: guthanSpearAttackSeqs,
        attackSpeed: 5,
        hitDelay: 1,
        hitSounds: spearHitSounds,
    },
];

const COMBAT_WEAPON_LIST_PATH = path.resolve(__dirname, "../../../../docs/combat-weapons-list.md");

const COMBAT_LIST_HEADERS = new Set([
    "Two-handed sword",
    "Axe",
    "Banner",
    "Blunt",
    "Bludgeon",
    "Bulwark",
    "Claw",
    "Egg",
    "Partisan",
    "Pickaxe",
    "Polearm",
    "Polestaff",
    "Scythe",
    "Slash sword",
    "Spear",
    "Spiked",
    "Stab sword",
    "Unarmed",
    "Whip",
    "Blaster",
    "Bow",
    "Chinchompa",
    "Crossbow",
    "Gun",
    "Thrown",
    "Bladed staff",
    "Powered Staff",
    "Staff",
    "Salamander",
    "Multi-style",
]);

const COMBAT_LIST_CATEGORY_TO_ROW_ID: Record<string, number> = {
    "Two-handed sword": CombatCategory.TWO_HANDED_SWORD,
    Axe: CombatCategory.AXE,
    Banner: CombatCategory.POLESTAFF,
    Blunt: CombatCategory.HAMMER,
    Bludgeon: CombatCategory.BLUDGEON,
    Bulwark: CombatCategory.BULWARK,
    Claw: CombatCategory.CLAW,
    Egg: CombatCategory.HAMMER,
    Partisan: CombatCategory.PARTISAN,
    Pickaxe: CombatCategory.PICKAXE,
    Polearm: CombatCategory.HALBERD,
    Polestaff: CombatCategory.POLESTAFF,
    Scythe: CombatCategory.SCYTHE,
    "Slash sword": CombatCategory.SCIMITAR,
    Spear: CombatCategory.SPEAR,
    Spiked: CombatCategory.MACE,
    "Stab sword": CombatCategory.DAGGER,
    Unarmed: CombatCategory.UNARMED,
    Whip: CombatCategory.WHIP,
    Blaster: CombatCategory.GUN,
    Bow: CombatCategory.BOW,
    Chinchompa: CombatCategory.CHINCHOMPA,
    Crossbow: CombatCategory.CROSSBOW,
    Gun: CombatCategory.GUN,
    Thrown: CombatCategory.THROWN,
    "Bladed staff": CombatCategory.STAFF_HALBERD,
    "Powered Staff": CombatCategory.POWERED_STAFF,
    Staff: CombatCategory.MAGIC_STAFF,
    Salamander: CombatCategory.SALAMANDER,
    "Multi-style": 31,
};

const generatedBluntCombatStyles = {
    0: {
        name: "Pound",
        attackType: AttackType.CRUSH,
        xpMode: XpMode.ATTACK,
        attackStyle: AttackStyle.ACCURATE,
    },
    1: {
        name: "Pummel",
        attackType: AttackType.CRUSH,
        xpMode: XpMode.STRENGTH,
        attackStyle: AttackStyle.AGGRESSIVE,
    },
    3: {
        name: "Block",
        attackType: AttackType.CRUSH,
        xpMode: XpMode.DEFENCE,
        attackStyle: AttackStyle.DEFENSIVE,
    },
} as const;

const generatedPolestaffCombatStyles = {
    0: {
        name: "Bash",
        attackType: AttackType.CRUSH,
        xpMode: XpMode.ATTACK,
        attackStyle: AttackStyle.ACCURATE,
    },
    1: {
        name: "Pound",
        attackType: AttackType.CRUSH,
        xpMode: XpMode.STRENGTH,
        attackStyle: AttackStyle.AGGRESSIVE,
    },
    3: {
        name: "Block",
        attackType: AttackType.CRUSH,
        xpMode: XpMode.DEFENCE,
        attackStyle: AttackStyle.DEFENSIVE,
    },
} as const;

const generatedPartisanCombatStyles = {
    0: {
        name: "Stab",
        attackType: AttackType.STAB,
        xpMode: XpMode.ATTACK,
        attackStyle: AttackStyle.ACCURATE,
    },
    1: {
        name: "Lunge",
        attackType: AttackType.STAB,
        xpMode: XpMode.STRENGTH,
        attackStyle: AttackStyle.AGGRESSIVE,
    },
    2: {
        name: "Pound",
        attackType: AttackType.CRUSH,
        xpMode: XpMode.STRENGTH,
        attackStyle: AttackStyle.AGGRESSIVE,
    },
    3: {
        name: "Block",
        attackType: AttackType.STAB,
        xpMode: XpMode.DEFENCE,
        attackStyle: AttackStyle.DEFENSIVE,
    },
} as const;

const generatedBladedStaffCombatStyles = {
    0: {
        name: "Jab",
        attackType: AttackType.STAB,
        xpMode: XpMode.ATTACK,
        attackStyle: AttackStyle.ACCURATE,
    },
    1: {
        name: "Swipe",
        attackType: AttackType.SLASH,
        xpMode: XpMode.STRENGTH,
        attackStyle: AttackStyle.AGGRESSIVE,
    },
    3: {
        name: "Fend",
        attackType: AttackType.CRUSH,
        xpMode: XpMode.DEFENCE,
        attackStyle: AttackStyle.DEFENSIVE,
    },
} as const;

const generatedGunCombatStyles = {
    0: {
        name: "Aim and Fire",
        attackType: AttackType.RANGED,
        xpMode: XpMode.RANGED,
        attackStyle: AttackStyle.ACCURATE,
    },
    1: {
        name: "Kick",
        attackType: AttackType.CRUSH,
        xpMode: XpMode.STRENGTH,
        attackStyle: AttackStyle.AGGRESSIVE,
    },
} as const;

const generatedPartisanAttackSeqs = { 0: 386, 1: 392, 2: 401, 3: 386 } as const;
const generatedGunAttackSeqs = { 0: 426, 1: 423, 2: 426, 3: 423 } as const;

function normalizeCombatWeaponName(name: string | undefined): string {
    return (name ?? "")
        .toLowerCase()
        .replace(/\u2019/g, "'")
        .replace(
            /\((last man standing|deadman mode|deadman|bh|or|cr|e|i|t|attuned|basic|perfected|the gauntlet|trailblazer reloaded|trailblazer|a|u)\)/g,
            "",
        )
        .replace(/\((p\+\+|p\+|p|kp)\)/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

function parseCombatWeaponsList(markdown: string): Map<string, string> {
    const lines = markdown.split(/\r?\n/).map((line) => line.trim());
    const listed = new Map<string, string>();
    let currentHeader: string | undefined;

    for (const line of lines) {
        if (!line) continue;

        if (COMBAT_LIST_HEADERS.has(line)) {
            currentHeader = line;
            continue;
        }

        if (!currentHeader) continue;
        if (
            line === "Melee weapons" ||
            line === "Ranged weapons" ||
            line === "Magic weapons" ||
            line === "Other" ||
            line.startsWith("Combat style") ||
            line.startsWith("Consisting") ||
            line.startsWith("Bows with ") ||
            line.startsWith("Crossbows with ") ||
            line.startsWith("Multi-style is exactly like") ||
            line.startsWith("The style used when the player has no weapon equipped.") ||
            line.startsWith("Bludgeon is a subset of blunt")
        ) {
            continue;
        }

        if (
            /^(Chop|Slash|Smash|Block|Hack|Punch|Kick|Pound|Pummel|Accurate|Rapid|Longrange|Scorch|Flare|Blaze|Jab|Swipe|Fend|Reap|Lunge|Spike|Impale|Stab|Flick|Lash|Deflect|Short fuse|Medium fuse|Long fuse|Aim and Fire|Melee|Ranged|Magic|Spell|Focus|Bash)\b/.test(
                line,
            )
        ) {
            continue;
        }

        listed.set(line, currentHeader);
    }

    return listed;
}

function buildItemAnimOverrides(def: ItemDefinition): Record<string, number> | undefined {
    const anims: Record<string, number> = {};
    if (def.standAnim > 0) anims.idle = def.standAnim;
    if (def.walkAnim > 0) anims.walk = def.walkAnim;
    if (def.runAnim > 0) anims.run = def.runAnim;
    if (def.blockAnim > 0) anims.block = def.blockAnim;
    return Object.keys(anims).length > 0 ? anims : undefined;
}

function getGeneratedCombatStylesForHeader(
    header: string,
): Record<number, CombatStyleData> | undefined {
    switch (header) {
        case "Blunt":
            return generatedBluntCombatStyles as Record<number, CombatStyleData>;
        case "Banner":
        case "Polestaff":
            return generatedPolestaffCombatStyles as Record<number, CombatStyleData>;
        case "Partisan":
            return generatedPartisanCombatStyles as Record<number, CombatStyleData>;
        case "Bladed staff":
            return generatedBladedStaffCombatStyles as Record<number, CombatStyleData>;
        case "Gun":
            return generatedGunCombatStyles as Record<number, CombatStyleData>;
        default:
            return undefined;
    }
}

function getGeneratedAttackSequencesForHeader(
    header: string,
): { 0: number; 1: number; 2: number; 3: number } | undefined {
    switch (header) {
        case "Blunt":
            return warhammerAttackSeqs;
        case "Banner":
        case "Polestaff":
            return staffAttackSeqs;
        case "Partisan":
            return generatedPartisanAttackSeqs;
        case "Bladed staff":
            return staffAttackSeqs;
        case "Gun":
            return generatedGunAttackSeqs;
        default:
            return undefined;
    }
}

function getGeneratedHitSoundsForHeader(header: string): WeaponDataEntry["hitSounds"] | undefined {
    switch (header) {
        case "Blunt":
            return warhammerHitSounds;
        case "Banner":
        case "Polestaff":
        case "Bladed staff":
            return staffHitSounds;
        case "Partisan":
            return kerisHitSounds;
        case "Gun":
            return { ranged: 2693, crush: unarmedHitSounds.crush };
        default:
            return undefined;
    }
}

function inferEquipmentType(
    item: ItemDefinition,
    source: WeaponDataEntry | undefined,
    header: string,
): string {
    if (source?.equipmentType) return source.equipmentType;

    switch (item.weaponInterface) {
        case "BATTLEAXE":
        case "GREATAXE":
            return "axe";
        case "WARHAMMER":
        case "GRANITE_MAUL":
        case "MAUL":
        case "ELDER_MAUL":
            return "warhammer";
        case "CLAWS":
            return "claw";
        case "CROSSBOW":
        case "BALLISTA":
        case "KARILS_CROSSBOW":
            return "crossbow";
        case "SHORTBOW":
        case "LONGBOW":
        case "DARK_BOW":
            return "bow";
        case "SCIMITAR":
            return "scimitar";
        case "LONGSWORD":
            return "longsword";
        case "SWORD":
            return "sword";
        case "DAGGER":
        case "DRAGON_DAGGER":
        case "ABYSSAL_DAGGER":
        case "GHRAZI_RAPIER":
            return "dagger";
        case "PICKAXE":
            return "pickaxe";
        case "HALBERD":
            return "halberd";
        case "SPEAR":
            return "spear";
        case "MACE":
        case "VERACS_FLAIL":
            return "mace";
        case "STAFF":
        case "ANCIENT_STAFF":
            return "staff";
        case "WHIP":
            return "whip";
        case "DART":
            return "dart";
        case "KNIFE":
            return "knife";
        case "JAVELIN":
            return "javelin";
        case "THROWNAXE":
            return "thrownaxe";
        case "BLOWPIPE":
            return "blowpipe";
        case "TWO_HANDED_SWORD":
        case "GODSWORD":
            return "2h";
        case "SCYTHE":
            return "scythe";
        case "BULWARK":
            return "bulwark";
        case "UNARMED":
            return "unarmed";
        default:
            break;
    }

    switch (header) {
        case "Unarmed":
            return "unarmed";
        case "Bow":
            return "bow";
        case "Crossbow":
            return "crossbow";
        case "Thrown":
            return "thrown";
        case "Powered Staff":
        case "Staff":
        case "Banner":
        case "Polestaff":
        case "Bladed staff":
            return "staff";
        case "Claw":
            return "claw";
        case "Whip":
            return "whip";
        case "Bulwark":
            return "bulwark";
        default:
            return header.toLowerCase();
    }
}

function resolveDerivedAttackSpeed(
    item: ItemDefinition,
    header: string,
    source: WeaponDataEntry | undefined,
): number {
    if (source?.attackSpeed !== undefined) return source.attackSpeed;

    switch (item.weaponInterface) {
        case "BATTLEAXE":
            return 6;
        case "GREATAXE":
            return 7;
        case "WARHAMMER":
            return 6;
        case "GRANITE_MAUL":
        case "ELDER_MAUL":
            return 6;
        case "MAUL":
            return 7;
        case "SHORTBOW":
            return 4;
        case "LONGBOW":
            return 6;
        case "DARK_BOW":
            return 9;
        case "CROSSBOW":
        case "KARILS_CROSSBOW":
            return 6;
        case "BALLISTA":
            return 7;
        case "SCIMITAR":
        case "SWORD":
        case "DAGGER":
        case "DRAGON_DAGGER":
        case "ABYSSAL_DAGGER":
        case "GHRAZI_RAPIER":
        case "CLAWS":
        case "WHIP":
        case "MACE":
        case "VERACS_FLAIL":
        case "PICKAXE":
            return 4;
        case "LONGSWORD":
        case "SPEAR":
        case "STAFF":
        case "ANCIENT_STAFF":
            return 5;
        case "HALBERD":
            return 7;
        case "SCYTHE":
            return 5;
        case "TWO_HANDED_SWORD":
            return 7;
        case "GODSWORD":
            return 6;
        case "BULWARK":
            return 7;
        case "DART":
            return 3;
        case "KNIFE":
            return 4;
        case "JAVELIN":
        case "THROWNAXE":
            return 6;
        case "BLOWPIPE":
            return 2;
        case "UNARMED":
            return 4;
        default:
            break;
    }

    switch (header) {
        case "Unarmed":
            return 4;
        case "Blunt":
        case "Partisan":
        case "Spiked":
        case "Stab sword":
        case "Slash sword":
        case "Claw":
        case "Whip":
        case "Chinchompa":
        case "Thrown":
            return 4;
        case "Axe":
        case "Pickaxe":
        case "Banner":
        case "Polestaff":
        case "Scythe":
        case "Staff":
        case "Powered Staff":
            return 5;
        case "Crossbow":
        case "Two-handed sword":
        case "Polearm":
        case "Bulwark":
            return 6;
        case "Bow":
            return 4;
        case "Salamander":
        case "Gun":
            return 5;
        default:
            return 4;
    }
}

function resolveDerivedHitDelay(
    header: string,
    category: number,
    source: WeaponDataEntry | undefined,
): number {
    if (source?.hitDelay !== undefined) return source.hitDelay;
    if (
        category === CombatCategory.BOW ||
        category === CombatCategory.CROSSBOW ||
        category === CombatCategory.THROWN ||
        category === CombatCategory.CHINCHOMPA ||
        category === CombatCategory.POWERED_STAFF ||
        header === "Staff" ||
        header === "Powered Staff" ||
        header === "Gun"
    ) {
        return 2;
    }
    return 1;
}

function appendGeneratedCombatWeaponEntries(): void {
    let markdown: string;
    try {
        markdown = fs.readFileSync(COMBAT_WEAPON_LIST_PATH, "utf8");
    } catch {
        return;
    }

    const listedItems = parseCombatWeaponsList(markdown);
    const itemDefs = loadItemDefinitions().filter((item) => !item.noted);
    const exactItemsByName = new Map<string, ItemDefinition[]>();
    const normalizedItemsByName = new Map<string, ItemDefinition[]>();
    const explicitIds = new Set(weaponDataEntries.map((entry) => entry.itemId));
    const explicitByExactName = new Map<string, WeaponDataEntry>();
    const explicitByNormalizedName = new Map<string, WeaponDataEntry>();
    const explicitByInterface = new Map<WeaponInterface, WeaponDataEntry>();
    const explicitByCategory = new Map<number, WeaponDataEntry>();
    const defById = new Map(itemDefs.map((def) => [def.id, def]));

    for (const def of itemDefs) {
        const exactBucket = exactItemsByName.get(def.name) ?? [];
        exactBucket.push(def);
        exactItemsByName.set(def.name, exactBucket);

        const normalizedBucket =
            normalizedItemsByName.get(normalizeCombatWeaponName(def.name)) ?? [];
        normalizedBucket.push(def);
        normalizedItemsByName.set(normalizeCombatWeaponName(def.name), normalizedBucket);
    }

    for (const entry of weaponDataEntries) {
        if (entry.name) {
            explicitByExactName.set(entry.name, entry);
            explicitByNormalizedName.set(normalizeCombatWeaponName(entry.name), entry);
        }
        if (entry.combatCategory !== undefined && !explicitByCategory.has(entry.combatCategory)) {
            explicitByCategory.set(entry.combatCategory, entry);
        }
        const def = defById.get(entry.itemId);
        if (def?.weaponInterface && !explicitByInterface.has(def.weaponInterface)) {
            explicitByInterface.set(def.weaponInterface, entry);
        }
    }

    for (const [listedName, header] of listedItems.entries()) {
        const matches =
            exactItemsByName.get(listedName) ??
            normalizedItemsByName.get(normalizeCombatWeaponName(listedName)) ??
            [];
        const item = matches.slice().sort((a, b) => {
            const ifaceA = a.weaponInterface ? 0 : 1;
            const ifaceB = b.weaponInterface ? 0 : 1;
            if (ifaceA !== ifaceB) return ifaceA - ifaceB;
            return a.id - b.id;
        })[0];
        if (!item || explicitIds.has(item.id)) continue;

        const category = COMBAT_LIST_CATEGORY_TO_ROW_ID[header];
        if (category === undefined) continue;

        const sourceByName =
            explicitByExactName.get(item.name) ??
            explicitByNormalizedName.get(normalizeCombatWeaponName(item.name));
        const sourceByInterface =
            item.weaponInterface !== undefined
                ? explicitByInterface.get(item.weaponInterface)
                : undefined;
        const source = sourceByName ?? sourceByInterface ?? explicitByCategory.get(category);
        const normalizedItemName = normalizeCombatWeaponName(item.name);
        const normalizedSourceName = normalizeCombatWeaponName(source?.name);
        const sameFamily = !!source && normalizedItemName === normalizedSourceName;
        const animOverrides = buildItemAnimOverrides(item) ?? source?.animOverrides;

        const derived: WeaponDataEntry = {
            itemId: item.id,
            name: item.name,
            equipmentType: inferEquipmentType(item, source, header),
            combatCategory: category,
            animOverrides,
            attackSpeed: resolveDerivedAttackSpeed(item, header, source),
            hitDelay: resolveDerivedHitDelay(header, category, source),
        };

        if (sameFamily && source) {
            if (source.attackSequences) derived.attackSequences = source.attackSequences;
            if (source.combatStyles) derived.combatStyles = source.combatStyles;
            if (source.specialAttackAnim !== undefined) {
                derived.specialAttackAnim = source.specialAttackAnim;
            }
            if (source.specialAttackCost !== undefined) {
                derived.specialAttackCost = source.specialAttackCost;
            }
            if (source.hitSounds) derived.hitSounds = source.hitSounds;
            if (source.missSound !== undefined) derived.missSound = source.missSound;
        } else {
            const generatedCombatStyles = getGeneratedCombatStylesForHeader(header);
            if (generatedCombatStyles) derived.combatStyles = generatedCombatStyles;

            const generatedAttackSequences = getGeneratedAttackSequencesForHeader(header);
            if (generatedAttackSequences) derived.attackSequences = generatedAttackSequences;

            const generatedHitSounds = getGeneratedHitSoundsForHeader(header);
            if (generatedHitSounds) derived.hitSounds = generatedHitSounds;
        }

        weaponDataEntries.push(derived);
        explicitIds.add(item.id);
    }
}

appendGeneratedCombatWeaponEntries();

// ====================================================================================
// HELPER FUNCTIONS
// ====================================================================================

/**
 * Lookup weapon data by item ID.
 * Returns undefined if not found.
 */
export function getWeaponData(itemId: number): WeaponDataEntry | undefined {
    return weaponDataEntries.find((entry) => entry.itemId === itemId);
}

/**
 * Get weapon data with a fallback for unknown weapons.
 * Returns default melee weapon stats if not found.
 */
export function getWeaponDataOrDefault(itemId: number): WeaponDataEntry {
    const found = getWeaponData(itemId);
    if (found) return found;

    // Default for unknown weapons - treat as unarmed/punch
    return {
        itemId,
        name: "Unknown weapon",
        equipmentType: "unknown",
        combatCategory: CombatCategory.UNARMED,
        attackSpeed: 4,
        hitDelay: 1,
        hitSounds: unarmedHitSounds,
    };
}

/**
 * Get attack speed for a weapon, with optional rapid style adjustment.
 * Ranged weapons get -1 attack speed on rapid style.
 */
export function getAttackSpeed(itemId: number, isRapidStyle: boolean = false): number {
    const weapon = getWeaponDataOrDefault(itemId);
    let speed = weapon.attackSpeed ?? 4;

    // Rapid style reduces attack speed by 1 for ranged weapons
    if (isRapidStyle && weapon.combatCategory !== undefined) {
        const rangedCategories: number[] = [
            CombatCategory.BOW,
            CombatCategory.CROSSBOW,
            CombatCategory.THROWN,
            CombatCategory.CHINCHOMPA,
        ];
        if (rangedCategories.includes(weapon.combatCategory)) {
            speed = Math.max(1, speed - 1);
        }
    }

    return speed;
}

/**
 * Check if a weapon is a ranged weapon.
 */
export function isRangedWeapon(itemId: number): boolean {
    const weapon = getWeaponData(itemId);
    if (!weapon?.combatCategory) return false;

    const rangedCategories: number[] = [
        CombatCategory.BOW,
        CombatCategory.CROSSBOW,
        CombatCategory.THROWN,
        CombatCategory.CHINCHOMPA,
    ];
    return rangedCategories.includes(weapon.combatCategory);
}

/**
 * Check if a weapon is a magic weapon.
 */
export function isMagicWeapon(itemId: number): boolean {
    const weapon = getWeaponData(itemId);
    if (!weapon?.combatCategory) return false;

    const magicCategories: number[] = [
        CombatCategory.STAFF,
        CombatCategory.MAGIC_STAFF,
        CombatCategory.POWERED_STAFF,
        CombatCategory.TUMEKEN,
        CombatCategory.SALAMANDER, // Can be used for magic
    ];
    return magicCategories.includes(weapon.combatCategory);
}

/**
 * Check if a weapon is a powered staff (built-in spell).
 */
export function isPoweredStaff(itemId: number): boolean {
    const weapon = getWeaponData(itemId);
    if (!weapon?.combatCategory) return false;

    return (
        weapon.combatCategory === CombatCategory.POWERED_STAFF ||
        weapon.combatCategory === CombatCategory.TUMEKEN
    );
}

/**
 * Check if a weapon is a melee weapon.
 */
export function isMeleeWeapon(itemId: number): boolean {
    return !isRangedWeapon(itemId) && !isMagicWeapon(itemId);
}

/**
 * Get weapon hit delay in ticks.
 */
export function getHitDelay(itemId: number): number {
    const weapon = getWeaponDataOrDefault(itemId);
    return weapon.hitDelay ?? 1;
}

/**
 * Get default attack sequences for a combat category.
 * Used as fallback when weapon doesn't have explicit attackSequences.
 */
export function getDefaultAttackSequences(combatCategory: number): {
    0: number;
    1: number;
    2: number;
    3: number;
} {
    switch (combatCategory) {
        case CombatCategory.UNARMED:
            return unarmedAttackSeqs;
        case CombatCategory.DAGGER:
            return stabSwordAttackSeqs;
        case CombatCategory.SCIMITAR:
            return scimitarAttackSeqs;
        case CombatCategory.MACE:
            return maceAttackSeqs;
        case CombatCategory.HAMMER:
            return warhammerAttackSeqs;
        case CombatCategory.AXE:
            return axeAttackSeqs;
        case CombatCategory.TWO_HANDED_SWORD:
            return twoHandedSwordAttackSeqs;
        case CombatCategory.SPEAR:
            return spearAttackSeqs;
        case CombatCategory.HALBERD:
            return halberdAttackSeqs;
        case CombatCategory.PARTISAN:
            return generatedPartisanAttackSeqs;
        case CombatCategory.PICKAXE:
            return pickaxeAttackSeqs;
        case CombatCategory.CLAW:
            return clawAttackSeqs;
        case CombatCategory.WHIP:
            return whipAttackSeqs;
        case CombatCategory.STAFF:
            return staffAttackSeqs;
        case CombatCategory.MAGIC_STAFF:
            return magicStaffAttackSeqs;
        case CombatCategory.BOW:
            return bowAttackSeqs;
        case CombatCategory.CROSSBOW:
            return crossbowAttackSeqs;
        case CombatCategory.THROWN:
            return thrownAttackSeqs;
        case CombatCategory.CHINCHOMPA:
            return chinchompaAttackSeqs;
        case CombatCategory.SCYTHE:
            return scytheAttackSeqs;
        case CombatCategory.BLUDGEON:
            return bludgeonAttackSeqs;
        case CombatCategory.BULWARK:
            return bulwarkAttackSeqs;
        case CombatCategory.POWERED_STAFF:
            return tridentAttackSeqs;
        case CombatCategory.TUMEKEN:
            return tumekenAttackSeqs;
        case CombatCategory.SALAMANDER:
            return salamanderAttackSeqs;
        default:
            return unarmedAttackSeqs;
    }
}

/**
 * Get attack animation for a weapon based on combat style index.
 * Style indices: 0 = Accurate, 1 = Aggressive, 2 = Controlled, 3 = Defensive
 */
export function getAttackAnimation(itemId: number, styleIndex: number = 0): number {
    const weapon = getWeaponData(itemId);

    // Check for explicit attackSequences on the weapon
    if (weapon?.attackSequences) {
        const anim = weapon.attackSequences[styleIndex as 0 | 1 | 2 | 3];
        if (anim !== undefined) return anim;
    }

    // Check for legacy single attackSequence
    if (weapon?.attackSequence) {
        return weapon.attackSequence;
    }

    // Fall back to category defaults
    const category = weapon?.combatCategory ?? CombatCategory.UNARMED;
    const defaultSeqs = getDefaultAttackSequences(category);
    return defaultSeqs[styleIndex as 0 | 1 | 2 | 3] ?? defaultSeqs[0];
}

/**
 * Get all attack sequences for a weapon (style 0, 1, 2, 3).
 */
export function getAttackSequences(itemId: number): { 0: number; 1: number; 2: number; 3: number } {
    const weapon = getWeaponData(itemId);

    // Check for explicit attackSequences
    if (weapon?.attackSequences) {
        return weapon.attackSequences as { 0: number; 1: number; 2: number; 3: number };
    }

    // Check for legacy single attackSequence (use same for all styles)
    if (weapon?.attackSequence) {
        const seq = weapon.attackSequence;
        return { 0: seq, 1: seq, 2: seq, 3: seq };
    }

    // Fall back to category defaults
    const category = weapon?.combatCategory ?? CombatCategory.UNARMED;
    return getDefaultAttackSequences(category);
}

/**
 * Build a map of item ID to weapon data for fast lookups.
 */
export const weaponDataMap: Map<number, WeaponDataEntry> = new Map(
    weaponDataEntries.map((entry) => [entry.itemId, entry]),
);

// ====================================================================================
// COMBAT STYLE HELPER FUNCTIONS
// ====================================================================================

/**
 * Get default combat styles for a combat category.
 */
export function getDefaultCombatStyles(combatCategory: number): Record<number, CombatStyleData> {
    switch (combatCategory) {
        case CombatCategory.UNARMED:
            return unarmedCombatStyles;
        case CombatCategory.DAGGER:
            return daggerCombatStyles;
        case CombatCategory.SCIMITAR:
            return scimitarCombatStyles;
        case CombatCategory.MACE:
            return maceCombatStyles;
        case CombatCategory.HAMMER:
            return hammerCombatStyles;
        case CombatCategory.AXE:
            return axeCombatStyles;
        case CombatCategory.TWO_HANDED_SWORD:
            return twoHandedSwordCombatStyles;
        case CombatCategory.SPEAR:
            return spearCombatStyles;
        case CombatCategory.HALBERD:
            return halberdCombatStyles;
        case CombatCategory.PARTISAN:
            return generatedPartisanCombatStyles;
        case CombatCategory.PICKAXE:
            return pickaxeCombatStyles;
        case CombatCategory.CLAW:
            return clawCombatStyles;
        case CombatCategory.WHIP:
            return whipCombatStyles;
        case CombatCategory.STAFF:
        case CombatCategory.MAGIC_STAFF:
            return staffCombatStyles;
        case CombatCategory.BOW:
            return bowCombatStyles;
        case CombatCategory.CROSSBOW:
            return crossbowCombatStyles;
        case CombatCategory.THROWN:
            return thrownCombatStyles;
        case CombatCategory.CHINCHOMPA:
            return chinchompaCombatStyles;
        case CombatCategory.SALAMANDER:
            return salamanderCombatStyles;
        case CombatCategory.SCYTHE:
            return scytheCombatStyles;
        case CombatCategory.BLUDGEON:
            return bludgeonCombatStyles;
        case CombatCategory.BULWARK:
            return bulwarkCombatStyles;
        case CombatCategory.POWERED_STAFF:
        case CombatCategory.TUMEKEN:
            return poweredStaffCombatStyles;
        default:
            return unarmedCombatStyles;
    }
}

/**
 * Get combat style data for a weapon at a specific style index.
 * Style indices: 0 = Usually Accurate, 1 = Usually Aggressive, 2 = Usually Controlled, 3 = Usually Defensive
 */
export function getCombatStyle(itemId: number, styleIndex: number = 0): CombatStyleData {
    const weapon = getWeaponData(itemId);

    // Check for explicit combatStyles on the weapon
    if (weapon?.combatStyles) {
        const style = weapon.combatStyles[styleIndex as 0 | 1 | 2 | 3];
        if (style) return style;
    }

    // Fall back to category defaults
    const category = weapon?.combatCategory ?? CombatCategory.UNARMED;
    const defaultStyles = getDefaultCombatStyles(category);
    if (defaultStyles[styleIndex]) {
        return defaultStyles[styleIndex];
    }
    // If requested slot doesn't exist, clamp to highest available slot.
    // This ensures out-of-bounds slots (e.g., slot 3 for 3-style weapons like whips)
    // fall back to the last valid slot (often defensive) rather than slot 0 (accurate).
    const maxSlot = Math.max(...Object.keys(defaultStyles).map(Number));
    return defaultStyles[Math.min(styleIndex, maxSlot)] ?? defaultStyles[0];
}

/**
 * Get all combat styles for a weapon (style 0, 1, 2, 3).
 */
export function getCombatStyles(itemId: number): Record<number, CombatStyleData> {
    const weapon = getWeaponData(itemId);

    // Check for explicit combatStyles
    if (weapon?.combatStyles) {
        return weapon.combatStyles as Record<number, CombatStyleData>;
    }

    // Fall back to category defaults
    const category = weapon?.combatCategory ?? CombatCategory.UNARMED;
    return getDefaultCombatStyles(category);
}

/**
 * Get attack type for a weapon at a specific style index.
 */
export function getAttackType(itemId: number, styleIndex: number = 0): AttackTypeValue {
    return getCombatStyle(itemId, styleIndex).attackType;
}

/**
 * Get XP mode for a weapon at a specific style index.
 */
export function getXpMode(itemId: number, styleIndex: number = 0): XpModeValue {
    return getCombatStyle(itemId, styleIndex).xpMode;
}

/**
 * Get attack style (for invisible bonuses) for a weapon at a specific style index.
 */
export function getAttackStyle(itemId: number, styleIndex: number = 0): AttackStyleValue {
    return getCombatStyle(itemId, styleIndex).attackStyle;
}

/**
 * Get invisible bonus from attack style.
 * Returns: { attack: number, strength: number, defence: number, ranged: number, magic: number }
 */
export function getStyleBonus(attackStyle: AttackStyleValue): {
    attack: number;
    strength: number;
    defence: number;
    ranged: number;
    magic: number;
} {
    switch (attackStyle) {
        case AttackStyle.ACCURATE:
            return { attack: 3, strength: 0, defence: 0, ranged: 3, magic: 3 };
        case AttackStyle.AGGRESSIVE:
            return { attack: 0, strength: 3, defence: 0, ranged: 0, magic: 0 };
        case AttackStyle.CONTROLLED:
            return { attack: 1, strength: 1, defence: 1, ranged: 0, magic: 0 };
        case AttackStyle.DEFENSIVE:
            return { attack: 0, strength: 0, defence: 3, ranged: 0, magic: 0 };
        case AttackStyle.RAPID:
            return { attack: 0, strength: 0, defence: 0, ranged: 0, magic: 0 }; // Speed bonus instead
        case AttackStyle.LONGRANGE:
            return { attack: 0, strength: 0, defence: 1, ranged: 0, magic: 0 }; // +1 def, +2 range
        default:
            return { attack: 0, strength: 0, defence: 0, ranged: 0, magic: 0 };
    }
}

/**
 * Get special attack data for a weapon.
 * Returns undefined if weapon has no special attack.
 */
export function getSpecialAttack(itemId: number): { anim: number; cost: number } | undefined {
    const weapon = getWeaponData(itemId);

    // Check for explicit special attack data on weapon
    if (weapon?.specialAttackAnim !== undefined && weapon?.specialAttackCost !== undefined) {
        // Skip weapons with cost 0 (they don't have special attacks)
        if (weapon.specialAttackCost === 0) return undefined;
        return { anim: weapon.specialAttackAnim, cost: weapon.specialAttackCost };
    }

    return undefined;
}

/**
 * Check if a weapon has a special attack.
 */
export function hasSpecialAttack(itemId: number): boolean {
    const weapon = getWeaponData(itemId);
    return weapon?.specialAttackCost !== undefined && weapon.specialAttackCost > 0;
}

/**
 * Get number of combat styles available for a weapon category.
 * Most melee weapons have 4, ranged have 3, some special weapons have 2-3.
 */
export function getNumCombatStyles(itemId: number): number {
    const weapon = getWeaponData(itemId);
    const category = weapon?.combatCategory ?? CombatCategory.UNARMED;

    switch (category) {
        case CombatCategory.UNARMED:
        case CombatCategory.WHIP:
        case CombatCategory.STAFF:
        case CombatCategory.MAGIC_STAFF:
        case CombatCategory.HALBERD:
        case CombatCategory.BOW:
        case CombatCategory.CROSSBOW:
        case CombatCategory.THROWN:
        case CombatCategory.CHINCHOMPA:
        case CombatCategory.SALAMANDER:
        case CombatCategory.BLUDGEON:
        case CombatCategory.POWERED_STAFF:
        case CombatCategory.TUMEKEN:
            return 3;
        case CombatCategory.BULWARK:
            return 2;
        default:
            return 4;
    }
}

// ====================================================================================
// HIT SOUND HELPER FUNCTIONS
// ====================================================================================

/**
 * Get default hit sounds for a combat category.
 */
export function getDefaultHitSounds(combatCategory: number): {
    stab?: number;
    slash?: number;
    crush?: number;
    ranged?: number;
} {
    switch (combatCategory) {
        case CombatCategory.UNARMED:
            return unarmedHitSounds;
        case CombatCategory.DAGGER:
            return daggerHitSounds;
        case CombatCategory.SCIMITAR:
            return swordHitSounds;
        case CombatCategory.MACE:
            return maceHitSounds;
        case CombatCategory.HAMMER:
            return warhammerHitSounds;
        case CombatCategory.AXE:
            return battleaxeHitSounds;
        case CombatCategory.TWO_HANDED_SWORD:
            return twoHandedSwordHitSounds;
        case CombatCategory.SPEAR:
            return spearHitSounds;
        case CombatCategory.HALBERD:
            return halberdHitSounds;
        case CombatCategory.PARTISAN:
            return kerisHitSounds;
        case CombatCategory.PICKAXE:
            return pickaxeHitSounds;
        case CombatCategory.CLAW:
            return clawHitSounds;
        case CombatCategory.WHIP:
            return whipHitSounds;
        case CombatCategory.STAFF:
        case CombatCategory.MAGIC_STAFF:
            return staffHitSounds;
        case CombatCategory.SCYTHE:
            return scytheHitSounds;
        case CombatCategory.BLUDGEON:
            return warhammerHitSounds;
        case CombatCategory.POWERED_STAFF:
        case CombatCategory.TUMEKEN:
            return poweredStaffHitSounds;
        // Ranged weapon categories
        case CombatCategory.BOW:
            return shortbowHitSounds; // Default to shortbow sound
        case CombatCategory.CROSSBOW:
            return crossbowHitSounds;
        case CombatCategory.THROWN:
        case CombatCategory.CHINCHOMPA:
            return thrownHitSounds;
        case CombatCategory.SALAMANDER:
            return shortbowHitSounds; // Salamander uses similar sound
        default:
            return unarmedHitSounds;
    }
}

/**
 * Get hit sound for a weapon based on attack type.
 * @param itemId - The weapon item ID
 * @param attackType - The attack type ('stab', 'slash', 'crush', 'ranged', 'magic')
 * @returns Sound ID to play, or undefined if no sound
 */
export function getHitSound(
    itemId: number,
    attackType: "stab" | "slash" | "crush" | "ranged" | "magic",
): number | undefined {
    const weapon = getWeaponData(itemId);

    // Get hit sounds from weapon or category defaults
    const hitSounds =
        weapon?.hitSounds ?? getDefaultHitSounds(weapon?.combatCategory ?? CombatCategory.UNARMED);

    // Map attack type to sound
    switch (attackType) {
        case "stab":
            return hitSounds.stab ?? hitSounds.slash ?? hitSounds.crush;
        case "slash":
            return hitSounds.slash ?? hitSounds.stab ?? hitSounds.crush;
        case "crush":
            return hitSounds.crush ?? hitSounds.slash ?? hitSounds.stab;
        case "ranged":
            // ranged weapons have dedicated attack sounds
            return hitSounds.ranged ?? hitSounds.crush ?? hitSounds.stab ?? hitSounds.slash;
        case "magic":
            // For magic, use crush as fallback (powered staves use crush)
            return hitSounds.crush ?? hitSounds.stab ?? hitSounds.slash;
        default:
            return hitSounds.slash ?? hitSounds.stab ?? hitSounds.crush;
    }
}

/**
 * Get hit sound for a weapon at a specific combat style index.
 * Uses the combat style's attack type to determine the sound.
 * @param itemId - The weapon item ID
 * @param styleIndex - The combat style index (0-3)
 * @returns Sound ID to play, or undefined if no sound
 */
export function getHitSoundForStyle(itemId: number, styleIndex: number = 0): number | undefined {
    const combatStyle = getCombatStyle(itemId, styleIndex);
    return getHitSound(itemId, combatStyle.attackType);
}

/**
 * Get miss sound for any weapon.
 * All weapons use the same miss sound.
 */
export function getMissSound(): number {
    return MISS_SOUND;
}

// ====================================================================================

// ====================================================================================

export {
    getPoweredStaffSpellData,
    hasPoweredStaffSpellData,
    calculatePoweredStaffBaseDamage,
    type PoweredStaffSpellData,
};

/**
 * Get powered staff cast sound ID.
 * @param weaponId - The weapon item ID
 * @returns Cast sound ID or undefined if not a powered staff
 */
export function getPoweredStaffCastSound(weaponId: number): number | undefined {
    const data = getPoweredStaffSpellData(weaponId);
    return data?.castSoundId;
}

/**
 * Get powered staff impact sound ID.
 * @param weaponId - The weapon item ID
 * @returns Impact sound ID or undefined if not a powered staff
 */
export function getPoweredStaffImpactSound(weaponId: number): number | undefined {
    const data = getPoweredStaffSpellData(weaponId);
    return data?.impactSoundId;
}

/**
 * Get powered staff cast spot animation (GFX) ID.
 * @param weaponId - The weapon item ID
 * @returns Cast GFX ID or undefined if not a powered staff
 */
export function getPoweredStaffCastGfx(weaponId: number): number | undefined {
    const data = getPoweredStaffSpellData(weaponId);
    return data?.castSpotAnim;
}

/**
 * Get powered staff impact spot animation (GFX) ID.
 * @param weaponId - The weapon item ID
 * @returns Impact GFX ID or undefined if not a powered staff
 */
export function getPoweredStaffImpactGfx(weaponId: number): number | undefined {
    const data = getPoweredStaffSpellData(weaponId);
    return data?.impactSpotAnim;
}

/**
 * Get powered staff splash spot animation (GFX) ID.
 * @param weaponId - The weapon item ID
 * @returns Splash GFX ID or undefined if not a powered staff
 */
export function getPoweredStaffSplashGfx(weaponId: number): number | undefined {
    const data = getPoweredStaffSpellData(weaponId);
    return data?.splashSpotAnim ?? 85; // Default splash GFX
}

/**
 * Get powered staff projectile ID.
 * @param weaponId - The weapon item ID
 * @returns Projectile ID or undefined if not a powered staff
 */
export function getPoweredStaffProjectileId(weaponId: number): number | undefined {
    const data = getPoweredStaffSpellData(weaponId);
    return data?.projectileId;
}

// ====================================================================================
// RANGED IMPACT SOUNDS
// Sound played when a ranged projectile hits the target
// ====================================================================================

/** Default arrow impact sound */
const DEFAULT_ARROW_IMPACT = 2693; // arrowlaunch2 (doubles as impact)

/** Ranged weapon impact sounds by equipment type */
const rangedImpactSoundMap: Record<string, number> = {
    // Bows - arrow hit sound
    shortbow: DEFAULT_ARROW_IMPACT,
    longbow: DEFAULT_ARROW_IMPACT,
    crystal_bow: 1352, // crystal_bow2 (impact variant)
    dark_bow: 3735, // darkbow_impact
    comp_bow: 1452, // ogre_bow (ogre/comp ogre bow)
    wilderness_bow: DEFAULT_ARROW_IMPACT, // Craw's bow, Webweaver
    third_age_bow: DEFAULT_ARROW_IMPACT, // 3rd age bow
    venator_bow: DEFAULT_ARROW_IMPACT, // Venator bow
    // Crossbows - bolt hit sound
    crossbow: DEFAULT_ARROW_IMPACT,
    // Thrown weapons
    dart: 2696, // dart (same as fire)
    knife: 2707, // throwingknife
    thrownaxe: 2708, // thrown
    javelin: 2699, // javelin
    // Special ranged
    chinchompa: 360, // chinchompa_explode
    blowpipe: 5765, // blowpipe dart
    ballista: 2699, // javelin (ballistas fire javelins)
};

/**
 * Get ranged projectile impact sound for a weapon.
 * This is played when the projectile reaches the target.
 * @param weaponId - The weapon item ID
 * @returns Impact sound ID or undefined if not a ranged weapon
 */
export function getRangedImpactSound(weaponId: number): number | undefined {
    if (weaponId <= 0) return undefined;

    const data = getWeaponData(weaponId);
    if (!data) return undefined;

    // Check if this is a ranged weapon category
    const category = data.combatCategory;
    if (
        category !== CombatCategory.BOW &&
        category !== CombatCategory.CROSSBOW &&
        category !== CombatCategory.THROWN &&
        category !== CombatCategory.CHINCHOMPA
    ) {
        return undefined;
    }

    // Look up by equipment type
    const equipType = data.equipmentType;
    if (equipType && rangedImpactSoundMap[equipType] !== undefined) {
        return rangedImpactSoundMap[equipType];
    }

    // Fall back to default arrow impact for bows/crossbows
    if (category === CombatCategory.BOW || category === CombatCategory.CROSSBOW) {
        return DEFAULT_ARROW_IMPACT;
    }

    // Fall back to dart sound for thrown
    if (category === CombatCategory.THROWN) {
        return 2696; // dart
    }

    // Fall back to chinchompa explode
    if (category === CombatCategory.CHINCHOMPA) {
        return 360; // chinchompa_explode
    }

    return undefined;
}

export function createWeaponDataProvider(): WeaponDataProvider {
    return {
        getWeaponData,
        getWeaponDataOrDefault,
        getAttackSpeed,
        isRangedWeapon,
        isMagicWeapon,
        isPoweredStaff,
        isMeleeWeapon,
        getHitDelay,
        getDefaultAttackSequences,
        getAttackAnimation,
        getAttackSequences,
        getDefaultCombatStyles,
        getCombatStyle,
        getCombatStyles,
        getAttackType,
        getXpMode,
        getAttackStyle,
        getStyleBonus,
        getSpecialAttack,
        hasSpecialAttack,
        getNumCombatStyles,
        getDefaultHitSounds,
        getHitSound,
        getHitSoundForStyle,
        getMissSound,
        getPoweredStaffCastSound,
        getPoweredStaffImpactSound,
        getPoweredStaffCastGfx,
        getPoweredStaffImpactGfx,
        getPoweredStaffSplashGfx,
        getPoweredStaffProjectileId,
        getRangedImpactSound,
        getAllEntries: () => weaponDataEntries,
        getEntryMap: () => weaponDataMap,
        MISS_SOUND,
        CombatCategory,
    };
}
