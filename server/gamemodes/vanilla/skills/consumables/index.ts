import { SKILL_IDS, SkillId } from "../../../../../src/rs/skill/skills";
import type { PlayerState } from "../../../../src/game/player";
import type { IScriptRegistry, ScriptServices } from "../../../../src/game/scripts/types";
import { type ConsumableProfile, scheduleConsumableAction } from "../../../../src/game/scripts/utils/consumables";

// ============================================================================
// Common constants
// ============================================================================

const VIAL_ITEM_ID = 229;
const TEA_CUP_ITEM_ID = 1980;
const PIE_DISH_ITEM_ID = 2313;
const EAT_SEQ = 829;
const DRINK_SEQ = 829;
const EAT_SOUND = 2393;
const DRINK_SOUND = 2401;
const DEFAULT_TICK_MS = (() => {
    const raw = process.env.TICK_MS;
    if (!raw) return 600;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 600;
})();

const secondsToTicks = (seconds?: number): number => {
    if (!seconds || !Number.isFinite(seconds)) return 0;
    return Math.max(1, Math.round((seconds * 1000) / Math.max(1, DEFAULT_TICK_MS)));
};

const formatDoseMessage = (dosesAfter: number): string => {
    if (dosesAfter <= 0) return "You have finished your potion.";
    return `You have ${dosesAfter} dose${dosesAfter === 1 ? "" : "s"} of potion left.`;
};

// ============================================================================
// Food definitions
// ============================================================================

type FoodDef = {
    itemId: number;
    heal: number;
    healResolver?: (player: PlayerState) => number;
    label?: string;
    option?: string;
    profile?: ConsumableProfile;
    nextItemId?: number;
    messages?: string[];
};

function computeAnglerfishHeal(player: PlayerState): number {
    const skill = player.getSkill(SkillId.Hitpoints);
    const base = Math.max(1, skill.baseLevel);
    let bonus = 2;
    if (base >= 25 && base <= 49) bonus = 4;
    else if (base >= 50 && base <= 74) bonus = 6;
    else if (base >= 75 && base <= 92) bonus = 8;
    else if (base >= 93) bonus = 13;
    return Math.floor(base / 10) + bonus;
}

const FOOD_DEFS: FoodDef[] = [
    { itemId: 315, heal: 3, label: "shrimp" },
    { itemId: 325, heal: 4, label: "sardine" },
    { itemId: 347, heal: 5, label: "herring" },
    { itemId: 355, heal: 6, label: "mackerel" },
    { itemId: 333, heal: 7, label: "trout" },
    { itemId: 329, heal: 9, label: "salmon" },
    { itemId: 361, heal: 10, label: "tuna" },
    { itemId: 379, heal: 12, label: "lobster" },
    { itemId: 365, heal: 13, label: "bass" },
    { itemId: 373, heal: 14, label: "swordfish" },
    { itemId: 7946, heal: 16, label: "monkfish" },
    { itemId: 3144, heal: 18, label: "karambwan", profile: "comboFood" },
    { itemId: 385, heal: 20, label: "shark" },
    { itemId: 391, heal: 21, label: "manta ray" },
    { itemId: 11936, heal: 22, label: "dark crab" },
    { itemId: 13441, heal: 0, healResolver: computeAnglerfishHeal, label: "anglerfish" },
    { itemId: 2140, heal: 4, label: "cooked chicken" },
    { itemId: 2142, heal: 4, label: "cooked meat" },
    { itemId: 2309, heal: 5, label: "bread" },
    { itemId: 2003, heal: 11, label: "stew", messages: ["It's a hearty bowl of stew."] },
    { itemId: 2011, heal: 19, label: "curry", messages: ["It's incredibly spicy!"] },
    { itemId: 2323, heal: 7, label: "apple pie", nextItemId: 2335 },
    { itemId: 2335, heal: 7, label: "half an apple pie", nextItemId: PIE_DISH_ITEM_ID },
    { itemId: 2325, heal: 5, label: "redberry pie", nextItemId: 2333 },
    { itemId: 2333, heal: 5, label: "half a redberry pie", nextItemId: PIE_DISH_ITEM_ID },
    { itemId: 2327, heal: 6, label: "meat pie", nextItemId: 2331 },
    { itemId: 2331, heal: 6, label: "half a meat pie", nextItemId: PIE_DISH_ITEM_ID },
    {
        itemId: 7178,
        heal: 6,
        label: "garden pie",
        nextItemId: 7180,
        messages: ["It tastes fresh and earthy."],
    },
    {
        itemId: 7180,
        heal: 6,
        label: "half a garden pie",
        nextItemId: PIE_DISH_ITEM_ID,
        messages: ["Only a little remains."],
    },
    { itemId: 1993, heal: 11, label: "jug of wine", messages: ["You feel slightly tipsy."] },
];

// ============================================================================
// Energy/Run potion definitions
// ============================================================================

const STAMINA_BASE_SECONDS = 120;
const readEnvPositiveInt = (key: string): number | undefined => {
    const raw = process.env[key];
    if (!raw) return undefined;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : undefined;
};
const configuredStaminaDurationTicks = readEnvPositiveInt("STAMINA_DURATION_TICKS");
const STAMINA_MIX_DURATION_TICKS =
    configuredStaminaDurationTicks !== undefined
        ? configuredStaminaDurationTicks
        : Math.max(1, Math.round((STAMINA_BASE_SECONDS * 1000) / Math.max(1, DEFAULT_TICK_MS)));
const STAMINA_MIX_MULTIPLIER = 0.3;

type SkillBoostEffect = {
    skillId: SkillId;
    delta?: number;
    targetLevel?: number;
    relativeToBase?: number;
};

type RunEnergyConsumableDef = {
    itemId: number;
    nextItemId?: number;
    dosesAfter?: number;
    boostPercent: number;
    label: string;
    option?: string;
    healAmount?: number;
    consumeMessage?: string;
    extraMessages?: string[];
    staminaMultiplier?: number;
    staminaDurationSeconds?: number;
    staminaDurationTicks?: number;
    curePoison?: boolean;
    cureDisease?: boolean;
    cureVenom?: boolean;
    skillBoosts?: SkillBoostEffect[];
};

const ENERGY_POTION_DEFS: RunEnergyConsumableDef[] = [
    { itemId: 3008, nextItemId: 3010, dosesAfter: 3, boostPercent: 10, label: "energy" },
    { itemId: 3010, nextItemId: 3012, dosesAfter: 2, boostPercent: 10, label: "energy" },
    { itemId: 3012, nextItemId: 3014, dosesAfter: 1, boostPercent: 10, label: "energy" },
    { itemId: 3014, nextItemId: VIAL_ITEM_ID, dosesAfter: 0, boostPercent: 10, label: "energy" },
];

const SUPER_ENERGY_POTION_DEFS: RunEnergyConsumableDef[] = [
    { itemId: 3016, nextItemId: 3018, dosesAfter: 3, boostPercent: 20, label: "super energy" },
    { itemId: 3018, nextItemId: 3020, dosesAfter: 2, boostPercent: 20, label: "super energy" },
    { itemId: 3020, nextItemId: 3022, dosesAfter: 1, boostPercent: 20, label: "super energy" },
    {
        itemId: 3022,
        nextItemId: VIAL_ITEM_ID,
        dosesAfter: 0,
        boostPercent: 20,
        label: "super energy",
    },
];

const ENERGY_MIX_DEFS: RunEnergyConsumableDef[] = [
    {
        itemId: 11453,
        nextItemId: 11455,
        dosesAfter: 1,
        boostPercent: 10,
        label: "energy mix",
        healAmount: 6,
        consumeMessage: "You drink some of your energy mix.",
    },
    {
        itemId: 11455,
        nextItemId: VIAL_ITEM_ID,
        dosesAfter: 0,
        boostPercent: 10,
        label: "energy mix",
        healAmount: 6,
        consumeMessage: "You drink some of your energy mix.",
    },
];

const SUPER_ENERGY_MIX_DEFS: RunEnergyConsumableDef[] = [
    {
        itemId: 11481,
        nextItemId: 11483,
        dosesAfter: 1,
        boostPercent: 20,
        label: "super energy mix",
        healAmount: 6,
        consumeMessage: "You drink some of your super energy mix.",
    },
    {
        itemId: 11483,
        nextItemId: VIAL_ITEM_ID,
        dosesAfter: 0,
        boostPercent: 20,
        label: "super energy mix",
        healAmount: 6,
        consumeMessage: "You drink some of your super energy mix.",
    },
];

const STRANGE_FRUIT_DEF: RunEnergyConsumableDef = {
    itemId: 464,
    boostPercent: 30,
    label: "strange fruit",
    option: "eat",
    healAmount: 2,
    consumeMessage: "You eat the strange fruit.",
    extraMessages: ["It tastes... unusual."],
};

const GUTHIX_REST_DURATION_SECONDS = 300;
const GUTHIX_REST_HEAL = 5;
const GUTHIX_REST_STAMINA_MULTIPLIER = 0.95;

const GUTHIX_REST_DEFS: RunEnergyConsumableDef[] = [
    { itemId: 4417, nextItemId: 4419, dosesAfter: 3 },
    { itemId: 4419, nextItemId: 4421, dosesAfter: 2 },
    { itemId: 4421, nextItemId: 4423, dosesAfter: 1 },
    { itemId: 4423, nextItemId: TEA_CUP_ITEM_ID, dosesAfter: 0 },
].map((entry) => ({
    ...entry,
    boostPercent: 5,
    label: "Guthix rest",
    consumeMessage: "You drink some of your Guthix rest.",
    staminaMultiplier: GUTHIX_REST_STAMINA_MULTIPLIER,
    staminaDurationSeconds: GUTHIX_REST_DURATION_SECONDS,
    healAmount: GUTHIX_REST_HEAL,
    curePoison: true,
    cureDisease: true,
}));

const SUMMER_PIE_DEFS: RunEnergyConsumableDef[] = [
    {
        itemId: 7218,
        nextItemId: 7220,
        boostPercent: 10,
        healAmount: 11,
        label: "summer pie",
        option: "eat",
        consumeMessage: "You eat half of the pie.",
        skillBoosts: [{ skillId: SkillId.Agility, relativeToBase: 5 }],
    },
    {
        itemId: 7220,
        nextItemId: PIE_DISH_ITEM_ID,
        boostPercent: 10,
        healAmount: 11,
        label: "summer pie",
        option: "eat",
        consumeMessage: "You eat the remaining half of the pie.",
        skillBoosts: [{ skillId: SkillId.Agility, relativeToBase: 5 }],
    },
];

const PURPLE_SWEETS_DEF: RunEnergyConsumableDef = {
    itemId: 4561,
    boostPercent: 10,
    label: "purple sweets",
    option: "eat",
    healAmount: 2,
    consumeMessage: "You eat the purple sweets.",
};

const WHITE_TREE_FRUIT_DEF: RunEnergyConsumableDef = {
    itemId: 6469,
    boostPercent: 8,
    label: "white tree fruit",
    option: "eat",
    healAmount: 3,
    consumeMessage: "You eat the white tree fruit.",
};

const PAPAYA_FRUIT_DEF: RunEnergyConsumableDef = {
    itemId: 5972,
    boostPercent: 5,
    label: "papaya fruit",
    option: "eat",
    healAmount: 8,
    consumeMessage: "You eat the papaya fruit.",
};

const MINT_CAKE_DEF: RunEnergyConsumableDef = {
    itemId: 9475,
    boostPercent: 100,
    label: "mint cake",
    option: "eat",
    consumeMessage: "You eat the mint cake.",
};

const GOUT_TUBER_DEF: RunEnergyConsumableDef = {
    itemId: 6311,
    boostPercent: 50,
    label: "gout tuber",
    option: "eat",
    healAmount: 12,
    consumeMessage: "You eat the gout tuber. Peculiar taste!",
};

const SQUIRKJUICE_DEFS: RunEnergyConsumableDef[] = [
    {
        itemId: 10851,
        boostPercent: 5,
        label: "winter sq'irkjuice",
        option: "drink",
        consumeMessage: "You drink the winter sq'irkjuice.",
    },
    {
        itemId: 10848,
        boostPercent: 10,
        label: "spring sq'irkjuice",
        option: "drink",
        consumeMessage: "You drink the spring sq'irkjuice.",
        skillBoosts: [{ skillId: SkillId.Thieving, delta: 1 }],
    },
    {
        itemId: 10850,
        boostPercent: 15,
        label: "autumn sq'irkjuice",
        option: "drink",
        consumeMessage: "You drink the autumn sq'irkjuice.",
        skillBoosts: [{ skillId: SkillId.Thieving, delta: 2 }],
    },
    {
        itemId: 10849,
        boostPercent: 20,
        label: "summer sq'irkjuice",
        option: "drink",
        consumeMessage: "You drink the summer sq'irkjuice.",
        skillBoosts: [{ skillId: SkillId.Thieving, delta: 3 }],
    },
];

const STAMINA_MIX_DEFS: RunEnergyConsumableDef[] = [
    {
        itemId: 12633,
        nextItemId: 12635,
        dosesAfter: 1,
        boostPercent: 20,
        label: "stamina mix",
        healAmount: 6,
        consumeMessage: "You drink some of your stamina mix.",
        staminaMultiplier: STAMINA_MIX_MULTIPLIER,
        staminaDurationTicks: STAMINA_MIX_DURATION_TICKS,
    },
    {
        itemId: 12635,
        nextItemId: VIAL_ITEM_ID,
        dosesAfter: 0,
        boostPercent: 20,
        label: "stamina mix",
        healAmount: 6,
        consumeMessage: "You drink some of your stamina mix.",
        staminaMultiplier: STAMINA_MIX_MULTIPLIER,
        staminaDurationTicks: STAMINA_MIX_DURATION_TICKS,
    },
];

const RUN_ENERGY_CONSUMABLE_DEFS: RunEnergyConsumableDef[] = [
    ...ENERGY_POTION_DEFS,
    ...SUPER_ENERGY_POTION_DEFS,
    ...ENERGY_MIX_DEFS,
    ...SUPER_ENERGY_MIX_DEFS,
    STRANGE_FRUIT_DEF,
    ...GUTHIX_REST_DEFS,
    ...SUMMER_PIE_DEFS,
    PURPLE_SWEETS_DEF,
    WHITE_TREE_FRUIT_DEF,
    PAPAYA_FRUIT_DEF,
    MINT_CAKE_DEF,
    GOUT_TUBER_DEF,
    ...SQUIRKJUICE_DEFS,
    ...STAMINA_MIX_DEFS,
];

// ============================================================================
// Stamina potion definitions
// ============================================================================

const STAMINA_RUN_ENERGY_BOOST = 20;
const STAMINA_EFFECT_MULTIPLIER = 0.3;
const STAMINA_EFFECT_SECONDS = 120;
const configuredStaminaEffectDurationTicks = readEnvPositiveInt("STAMINA_DURATION_TICKS");
const STAMINA_DURATION_TICKS =
    configuredStaminaEffectDurationTicks !== undefined
        ? configuredStaminaEffectDurationTicks
        : Math.max(1, Math.round((STAMINA_EFFECT_SECONDS * 1000) / Math.max(1, DEFAULT_TICK_MS)));

type StaminaPotionDef = { itemId: number; nextItemId: number; dosesAfter: number };

const STAMINA_POTIONS: StaminaPotionDef[] = [
    { itemId: 12625, nextItemId: 12627, dosesAfter: 3 },
    { itemId: 12627, nextItemId: 12629, dosesAfter: 2 },
    { itemId: 12629, nextItemId: 12631, dosesAfter: 1 },
    { itemId: 12631, nextItemId: VIAL_ITEM_ID, dosesAfter: 0 },
];

// ============================================================================
// Prayer restore definitions
// ============================================================================

type PrayerRestoreFormula = {
    base: number;
    percent: number;
};

type StatRestoreFormula = {
    base: number;
    percent: number;
    includeSkills?: SkillId[];
    excludeSkills?: SkillId[];
};

type PrayerConsumableDef = {
    itemId: number;
    nextItemId: number;
    dosesAfter: number;
    label: string;
    option?: string;
    consumeMessage?: string;
    extraMessages?: string[];
    prayerRestore: PrayerRestoreFormula;
    statRestore?: StatRestoreFormula;
    healAmount?: number;
    curePoison?: boolean;
    cureDisease?: boolean;
    cureVenom?: boolean;
};

const PRAYER_POTION_FORMULA: PrayerRestoreFormula = { base: 7, percent: 0.25 };
const SUPER_RESTORE_PRAYER_FORMULA: PrayerRestoreFormula = { base: 8, percent: 0.25 };
const SUPER_RESTORE_STAT_FORMULA: StatRestoreFormula = { base: 8, percent: 0.25 };

const PRAYER_POTION_DEFS: PrayerConsumableDef[] = [
    { itemId: 2434, nextItemId: 139, dosesAfter: 3 },
    { itemId: 139, nextItemId: 141, dosesAfter: 2 },
    { itemId: 141, nextItemId: 143, dosesAfter: 1 },
    { itemId: 143, nextItemId: VIAL_ITEM_ID, dosesAfter: 0 },
].map((entry) => ({
    ...entry,
    label: "prayer potion",
    prayerRestore: PRAYER_POTION_FORMULA,
}));

const PRAYER_MIX_DEFS: PrayerConsumableDef[] = [
    { itemId: 11465, nextItemId: 11467, dosesAfter: 1 },
    { itemId: 11467, nextItemId: VIAL_ITEM_ID, dosesAfter: 0 },
].map((entry) => ({
    ...entry,
    label: "prayer mix",
    consumeMessage: "You drink some of your prayer mix.",
    prayerRestore: PRAYER_POTION_FORMULA,
    healAmount: 6,
}));

const SUPER_RESTORE_DEFS: PrayerConsumableDef[] = [
    { itemId: 3024, nextItemId: 3026, dosesAfter: 3 },
    { itemId: 3026, nextItemId: 3028, dosesAfter: 2 },
    { itemId: 3028, nextItemId: 3030, dosesAfter: 1 },
    { itemId: 3030, nextItemId: VIAL_ITEM_ID, dosesAfter: 0 },
].map((entry) => ({
    ...entry,
    label: "super restore potion",
    prayerRestore: SUPER_RESTORE_PRAYER_FORMULA,
    statRestore: SUPER_RESTORE_STAT_FORMULA,
}));

const SUPER_RESTORE_MIX_DEFS: PrayerConsumableDef[] = [
    { itemId: 11493, nextItemId: 11495, dosesAfter: 1 },
    { itemId: 11495, nextItemId: VIAL_ITEM_ID, dosesAfter: 0 },
].map((entry) => ({
    ...entry,
    label: "super restore mix",
    consumeMessage: "You drink some of your super restore mix.",
    prayerRestore: SUPER_RESTORE_PRAYER_FORMULA,
    statRestore: SUPER_RESTORE_STAT_FORMULA,
    healAmount: 6,
}));

const BLIGHTED_SUPER_RESTORE_DEFS: PrayerConsumableDef[] = [
    { itemId: 24598, nextItemId: 24601, dosesAfter: 3 },
    { itemId: 24600, nextItemId: 24601, dosesAfter: 3 },
    { itemId: 24601, nextItemId: 24603, dosesAfter: 2 },
    { itemId: 24603, nextItemId: 24605, dosesAfter: 1 },
    { itemId: 24605, nextItemId: VIAL_ITEM_ID, dosesAfter: 0 },
].map((entry) => ({
    ...entry,
    label: "blighted super restore potion",
    consumeMessage: "You drink some of your blighted super restore potion.",
    prayerRestore: SUPER_RESTORE_PRAYER_FORMULA,
    statRestore: SUPER_RESTORE_STAT_FORMULA,
}));

const SANFEW_SERUM_DEFS: PrayerConsumableDef[] = [
    { itemId: 10925, nextItemId: 10927, dosesAfter: 3 },
    { itemId: 10927, nextItemId: 10929, dosesAfter: 2 },
    { itemId: 10929, nextItemId: 10931, dosesAfter: 1 },
    { itemId: 10931, nextItemId: VIAL_ITEM_ID, dosesAfter: 0 },
].map((entry) => ({
    ...entry,
    label: "Sanfew serum",
    consumeMessage: "You drink some of your Sanfew serum.",
    prayerRestore: SUPER_RESTORE_PRAYER_FORMULA,
    statRestore: SUPER_RESTORE_STAT_FORMULA,
    curePoison: true,
    cureDisease: true,
}));

const PRAYER_CONSUMABLE_DEFS: PrayerConsumableDef[] = [
    ...PRAYER_POTION_DEFS,
    ...PRAYER_MIX_DEFS,
    ...SUPER_RESTORE_DEFS,
    ...SUPER_RESTORE_MIX_DEFS,
    ...BLIGHTED_SUPER_RESTORE_DEFS,
    ...SANFEW_SERUM_DEFS,
];

// ============================================================================
// Combat potion definitions
// ============================================================================

type BoostFormula = {
    base: number;
    percent: number;
};

type SkillBoost = {
    skillId: SkillId;
    formula: BoostFormula;
};

type CombatPotionDef = {
    itemId: number;
    nextItemId: number;
    dosesAfter: number;
    label: string;
    boosts: SkillBoost[];
};

const REGULAR_COMBAT_FORMULA: BoostFormula = { base: 3, percent: 0.1 };
const SUPER_COMBAT_FORMULA: BoostFormula = { base: 5, percent: 0.15 };
const RANGING_MAGIC_FORMULA: BoostFormula = { base: 4, percent: 0.1 };

const ATTACK_POTION_DEFS: CombatPotionDef[] = [
    { itemId: 2428, nextItemId: 121, dosesAfter: 3 },
    { itemId: 121, nextItemId: 123, dosesAfter: 2 },
    { itemId: 123, nextItemId: 125, dosesAfter: 1 },
    { itemId: 125, nextItemId: VIAL_ITEM_ID, dosesAfter: 0 },
].map((entry) => ({
    ...entry,
    label: "Attack potion",
    boosts: [{ skillId: SkillId.Attack, formula: REGULAR_COMBAT_FORMULA }],
}));

const STRENGTH_POTION_DEFS: CombatPotionDef[] = [
    { itemId: 113, nextItemId: 115, dosesAfter: 3 },
    { itemId: 115, nextItemId: 117, dosesAfter: 2 },
    { itemId: 117, nextItemId: 119, dosesAfter: 1 },
    { itemId: 119, nextItemId: VIAL_ITEM_ID, dosesAfter: 0 },
].map((entry) => ({
    ...entry,
    label: "Strength potion",
    boosts: [{ skillId: SkillId.Strength, formula: REGULAR_COMBAT_FORMULA }],
}));

const DEFENCE_POTION_DEFS: CombatPotionDef[] = [
    { itemId: 2432, nextItemId: 133, dosesAfter: 3 },
    { itemId: 133, nextItemId: 135, dosesAfter: 2 },
    { itemId: 135, nextItemId: 137, dosesAfter: 1 },
    { itemId: 137, nextItemId: VIAL_ITEM_ID, dosesAfter: 0 },
].map((entry) => ({
    ...entry,
    label: "Defence potion",
    boosts: [{ skillId: SkillId.Defence, formula: REGULAR_COMBAT_FORMULA }],
}));

const SUPER_ATTACK_DEFS: CombatPotionDef[] = [
    { itemId: 2436, nextItemId: 145, dosesAfter: 3 },
    { itemId: 145, nextItemId: 147, dosesAfter: 2 },
    { itemId: 147, nextItemId: 149, dosesAfter: 1 },
    { itemId: 149, nextItemId: VIAL_ITEM_ID, dosesAfter: 0 },
].map((entry) => ({
    ...entry,
    label: "Super attack potion",
    boosts: [{ skillId: SkillId.Attack, formula: SUPER_COMBAT_FORMULA }],
}));

const SUPER_STRENGTH_DEFS: CombatPotionDef[] = [
    { itemId: 2440, nextItemId: 157, dosesAfter: 3 },
    { itemId: 157, nextItemId: 159, dosesAfter: 2 },
    { itemId: 159, nextItemId: 161, dosesAfter: 1 },
    { itemId: 161, nextItemId: VIAL_ITEM_ID, dosesAfter: 0 },
].map((entry) => ({
    ...entry,
    label: "Super strength potion",
    boosts: [{ skillId: SkillId.Strength, formula: SUPER_COMBAT_FORMULA }],
}));

const SUPER_DEFENCE_DEFS: CombatPotionDef[] = [
    { itemId: 2442, nextItemId: 163, dosesAfter: 3 },
    { itemId: 163, nextItemId: 165, dosesAfter: 2 },
    { itemId: 165, nextItemId: 167, dosesAfter: 1 },
    { itemId: 167, nextItemId: VIAL_ITEM_ID, dosesAfter: 0 },
].map((entry) => ({
    ...entry,
    label: "Super defence potion",
    boosts: [{ skillId: SkillId.Defence, formula: SUPER_COMBAT_FORMULA }],
}));

const SUPER_COMBAT_DEFS: CombatPotionDef[] = [
    { itemId: 12695, nextItemId: 12697, dosesAfter: 3 },
    { itemId: 12697, nextItemId: 12699, dosesAfter: 2 },
    { itemId: 12699, nextItemId: 12701, dosesAfter: 1 },
    { itemId: 12701, nextItemId: VIAL_ITEM_ID, dosesAfter: 0 },
].map((entry) => ({
    ...entry,
    label: "Super combat potion",
    boosts: [
        { skillId: SkillId.Attack, formula: SUPER_COMBAT_FORMULA },
        { skillId: SkillId.Strength, formula: SUPER_COMBAT_FORMULA },
        { skillId: SkillId.Defence, formula: SUPER_COMBAT_FORMULA },
    ],
}));

const RANGING_POTION_DEFS: CombatPotionDef[] = [
    { itemId: 2444, nextItemId: 169, dosesAfter: 3 },
    { itemId: 169, nextItemId: 171, dosesAfter: 2 },
    { itemId: 171, nextItemId: 173, dosesAfter: 1 },
    { itemId: 173, nextItemId: VIAL_ITEM_ID, dosesAfter: 0 },
].map((entry) => ({
    ...entry,
    label: "Ranging potion",
    boosts: [{ skillId: SkillId.Ranged, formula: RANGING_MAGIC_FORMULA }],
}));

const MAGIC_POTION_DEFS: CombatPotionDef[] = [
    { itemId: 3040, nextItemId: 3042, dosesAfter: 3 },
    { itemId: 3042, nextItemId: 3044, dosesAfter: 2 },
    { itemId: 3044, nextItemId: 3046, dosesAfter: 1 },
    { itemId: 3046, nextItemId: VIAL_ITEM_ID, dosesAfter: 0 },
].map((entry) => ({
    ...entry,
    label: "Magic potion",
    boosts: [{ skillId: SkillId.Magic, formula: RANGING_MAGIC_FORMULA }],
}));

const COMBAT_POTION_DEFS: CombatPotionDef[] = [
    { itemId: 9739, nextItemId: 9741, dosesAfter: 3 },
    { itemId: 9741, nextItemId: 9743, dosesAfter: 2 },
    { itemId: 9743, nextItemId: 9745, dosesAfter: 1 },
    { itemId: 9745, nextItemId: VIAL_ITEM_ID, dosesAfter: 0 },
].map((entry) => ({
    ...entry,
    label: "Combat potion",
    boosts: [
        { skillId: SkillId.Attack, formula: REGULAR_COMBAT_FORMULA },
        { skillId: SkillId.Strength, formula: REGULAR_COMBAT_FORMULA },
    ],
}));

const ALL_COMBAT_POTION_DEFS: CombatPotionDef[] = [
    ...ATTACK_POTION_DEFS,
    ...STRENGTH_POTION_DEFS,
    ...DEFENCE_POTION_DEFS,
    ...SUPER_ATTACK_DEFS,
    ...SUPER_STRENGTH_DEFS,
    ...SUPER_DEFENCE_DEFS,
    ...SUPER_COMBAT_DEFS,
    ...RANGING_POTION_DEFS,
    ...MAGIC_POTION_DEFS,
    ...COMBAT_POTION_DEFS,
];

// ============================================================================
// Helper functions
// ============================================================================

const formatItemName = (
    services: ScriptServices,
    itemId: number,
    fallback?: string,
): string => {
    const raw = services.getObjType?.(itemId);
    const name = raw?.name ?? fallback ?? "food";
    return name.toLowerCase();
};

const resolveHeal = (def: FoodDef, player: PlayerState): number => {
    if (def.healResolver) {
        return Math.max(0, Math.floor(def.healResolver(player)));
    }
    return Math.max(0, Math.floor(def.heal));
};

const formatDrinkMessage = (label: string): string => `You drink some of your ${label} potion.`;

const applyPrayerRestore = (player: PlayerState, formula: PrayerRestoreFormula): void => {
    if (!formula) return;
    const skill = player.getSkill(SkillId.Prayer);
    const baseLevel = Math.max(1, skill.baseLevel);
    const current = Math.max(0, skill.baseLevel + skill.boost);
    const missing = Math.max(0, baseLevel - current);
    if (missing <= 0) return;
    const restore = Math.max(0, Math.floor(formula.base + baseLevel * formula.percent));
    const applied = Math.min(missing, restore);
    if (applied > 0) {
        player.adjustSkillBoost(SkillId.Prayer, applied);
    }
};

const applyStatRestores = (player: PlayerState, formula?: StatRestoreFormula): void => {
    if (!formula) return;
    const skills: readonly SkillId[] = formula.includeSkills ?? SKILL_IDS;
    const excluded = new Set<SkillId>(formula.excludeSkills ?? []);
    for (const skillId of skills) {
        if (skillId === SkillId.Prayer || skillId === SkillId.Hitpoints) continue;
        if (excluded.has(skillId)) continue;
        const skill = player.getSkill(skillId);
        const baseLevel = Math.max(1, skill.baseLevel);
        const current = Math.max(0, skill.baseLevel + skill.boost);
        if (current >= baseLevel) continue;
        const restoreAmount = Math.max(0, Math.floor(formula.base + baseLevel * formula.percent));
        const applied = Math.min(baseLevel - current, restoreAmount);
        if (applied > 0) {
            player.adjustSkillBoost(skillId, applied);
        }
    }
};

const applyStatBoost = (player: PlayerState, skillId: SkillId, formula: BoostFormula): void => {
    const skill = player.getSkill(skillId);
    const baseLevel = Math.max(1, skill.baseLevel);
    const currentBoost = skill.boost;
    const boostAmount = Math.floor(formula.base + baseLevel * formula.percent);
    const maxBoost = boostAmount;
    if (currentBoost < maxBoost) {
        const newBoost = maxBoost;
        const adjustment = newBoost - currentBoost;
        if (adjustment > 0) {
            player.adjustSkillBoost(skillId, adjustment);
        }
    }
};

// ============================================================================
// Combined consumables module
// ============================================================================

export function register(registry: IScriptRegistry, services: ScriptServices): void {
    const setInventorySlot = services.setInventorySlot;

    for (const def of FOOD_DEFS) {
        const option = def.option ?? "eat";
        registry.registerItemAction(
            def.itemId,
            ({ player, source, tick }) => {
                const slot = source.slot;
                const ok = scheduleConsumableAction({
                    player,
                    slotIndex: slot,
                    itemId: def.itemId,
                    option,
                    tick,
                    services,
                    profile: def.profile ?? "food",
                    loggerTag: "food",
                    onExecute: () => {
                        const healAmount = resolveHeal(def, player);
                        if (healAmount > 0) {
                            player.applyHitpointsHeal(healAmount);
                        }
                        if (def.nextItemId !== undefined) {
                            setInventorySlot(player, slot, def.nextItemId, 1);
                        }
                        services.playPlayerSeq?.(player, EAT_SEQ);
                        services.playAreaSound?.({
                            soundId: EAT_SOUND,
                            tile: { x: player.tileX, y: player.tileY },
                            level: player.level,
                            radius: 1,
                            volume: 255,
                        });
                        const itemName = formatItemName(services, def.itemId, def.label);
                        services.sendGameMessage(player, `You eat the ${itemName}.`);
                        if (healAmount > 0) {
                            services.sendGameMessage(player, "It heals some health.");
                        }
                        if (def.messages) {
                            for (const msg of def.messages) {
                                services.sendGameMessage(player, msg);
                            }
                        }
                    },
                });
                if (!ok) {
                    console.log(`[script:food] consume rejected item=${def.itemId}`);
                }
            },
            option,
        );
    }

    for (const def of RUN_ENERGY_CONSUMABLE_DEFS) {
        const option = def.option ?? "drink";
        registry.registerItemAction(
            def.itemId,
            ({ player, source, tick }) => {
                const slot = source.slot;
                const ok = scheduleConsumableAction({
                    player,
                    slotIndex: slot,
                    itemId: def.itemId,
                    option,
                    tick,
                    services,
                    profile: option === "eat" ? "food" : "potion",
                    loggerTag: "energy-consumables",
                    onExecute: ({ tick: actionTick }) => {
                        if (def.nextItemId !== undefined) {
                            setInventorySlot(player, slot, def.nextItemId, 1);
                        }
                        player.adjustRunEnergyPercent(def.boostPercent);
                        if (def.healAmount && def.healAmount > 0) {
                            player.applyHitpointsHeal(def.healAmount);
                        }
                        if (option !== "eat") {
                            services.playPlayerSeq?.(player, DRINK_SEQ);
                            services.playAreaSound?.({
                                soundId: DRINK_SOUND,
                                tile: { x: player.tileX, y: player.tileY },
                                level: player.level,
                                radius: 1,
                                volume: 255,
                            });
                        } else {
                            services.playAreaSound?.({
                                soundId: EAT_SOUND,
                                tile: { x: player.tileX, y: player.tileY },
                                level: player.level,
                                radius: 1,
                                volume: 255,
                            });
                        }
                        if (def.curePoison) player.curePoison();
                        if (def.cureDisease) player.cureDisease();
                        if (def.cureVenom) player.cureVenom();
                        if (def.skillBoosts) {
                            for (const boost of def.skillBoosts) {
                                if (boost.relativeToBase !== undefined) {
                                    const baseLevel = player.getSkill(boost.skillId).baseLevel;
                                    player.setSkillBoost(
                                        boost.skillId,
                                        baseLevel + boost.relativeToBase,
                                    );
                                } else if (boost.targetLevel !== undefined) {
                                    player.setSkillBoost(boost.skillId, boost.targetLevel);
                                } else if (boost.delta !== undefined) {
                                    player.adjustSkillBoost(boost.skillId, boost.delta);
                                }
                            }
                        }
                        if (def.staminaMultiplier !== undefined) {
                            const durationTicks =
                                def.staminaDurationTicks ??
                                secondsToTicks(def.staminaDurationSeconds);
                            if (durationTicks > 0) {
                                player.applyStaminaEffect(
                                    actionTick,
                                    durationTicks,
                                    def.staminaMultiplier,
                                );
                            }
                        }
                        const messages: string[] = [];
                        const consumeMessage =
                            def.consumeMessage ??
                            formatDrinkMessage(def.label ?? "energy").replace(/\s+/, " ");
                        if (consumeMessage) messages.push(consumeMessage);
                        if (def.dosesAfter !== undefined) {
                            messages.push(formatDoseMessage(def.dosesAfter));
                        }
                        if (def.extraMessages) {
                            messages.push(...def.extraMessages);
                        }
                        for (const text of messages) services.sendGameMessage(player, text);
                    },
                });
                if (!ok) {
                    console.log(`[script:energy] consume rejected item=${def.itemId}`);
                }
            },
            option,
        );
    }

    for (const def of STAMINA_POTIONS) {
        registry.registerItemAction(
            def.itemId,
            ({ player, source, tick }) => {
                const slot = source.slot;
                const ok = scheduleConsumableAction({
                    player,
                    slotIndex: slot,
                    itemId: def.itemId,
                    option: "drink",
                    tick,
                    services,
                    profile: "potion",
                    loggerTag: "stamina",
                    onExecute: ({ tick: actionTick }) => {
                        setInventorySlot(player, slot, def.nextItemId, 1);
                        player.adjustRunEnergyPercent(STAMINA_RUN_ENERGY_BOOST);
                        player.applyStaminaEffect(
                            actionTick,
                            STAMINA_DURATION_TICKS,
                            STAMINA_EFFECT_MULTIPLIER,
                        );
                        services.playPlayerSeq?.(player, DRINK_SEQ);
                        services.playAreaSound?.({
                            soundId: DRINK_SOUND,
                            tile: { x: player.tileX, y: player.tileY },
                            level: player.level,
                            radius: 1,
                            volume: 255,
                        });
                        services.sendGameMessage(
                            player,
                            "You drink some of your stamina potion.",
                        );
                        services.sendGameMessage(player, formatDoseMessage(def.dosesAfter));
                    },
                });
                if (!ok) {
                    console.log(`[script:stamina] consume rejected item=${def.itemId}`);
                }
            },
            "drink",
        );
    }

    for (const def of PRAYER_CONSUMABLE_DEFS) {
        const option = def.option ?? "drink";
        registry.registerItemAction(
            def.itemId,
            ({ player, source, tick }) => {
                const slot = source.slot;
                const ok = scheduleConsumableAction({
                    player,
                    slotIndex: slot,
                    itemId: def.itemId,
                    option,
                    tick,
                    services,
                    profile: "potion",
                    loggerTag: "prayer-restores",
                    onExecute: () => {
                        setInventorySlot(player, slot, def.nextItemId, 1);
                        services.playPlayerSeq?.(player, DRINK_SEQ);
                        services.playAreaSound?.({
                            soundId: DRINK_SOUND,
                            tile: { x: player.tileX, y: player.tileY },
                            level: player.level,
                            radius: 1,
                            volume: 255,
                        });
                        applyPrayerRestore(player, def.prayerRestore);
                        applyStatRestores(player, def.statRestore);
                        if (def.healAmount) {
                            player.applyHitpointsHeal(def.healAmount);
                        }
                        if (def.curePoison) player.curePoison();
                        if (def.cureDisease) player.cureDisease();
                        if (def.cureVenom) player.cureVenom();
                        const consumeText =
                            def.consumeMessage ?? `You drink some of your ${def.label}.`;
                        services.sendGameMessage(player, consumeText);
                        services.sendGameMessage(player, formatDoseMessage(def.dosesAfter));
                        if (def.extraMessages) {
                            for (const msg of def.extraMessages) {
                                services.sendGameMessage(player, msg);
                            }
                        }
                    },
                });
                if (!ok) {
                    console.log(`[script:prayer-restores] consume rejected item=${def.itemId}`);
                }
            },
            option,
        );
    }

    for (const def of ALL_COMBAT_POTION_DEFS) {
        registry.registerItemAction(
            def.itemId,
            ({ player, source, tick }) => {
                const slot = source.slot;
                const ok = scheduleConsumableAction({
                    player,
                    slotIndex: slot,
                    itemId: def.itemId,
                    option: "drink",
                    tick,
                    services,
                    profile: "potion",
                    loggerTag: "combat-potions",
                    onExecute: () => {
                        setInventorySlot(player, slot, def.nextItemId, 1);
                        services.playPlayerSeq?.(player, DRINK_SEQ);
                        services.playAreaSound?.({
                            soundId: DRINK_SOUND,
                            tile: { x: player.tileX, y: player.tileY },
                            level: player.level,
                            radius: 1,
                            volume: 255,
                        });
                        for (const boost of def.boosts) {
                            applyStatBoost(player, boost.skillId, boost.formula);
                        }
                        services.sendGameMessage(
                            player,
                            `You drink some of your ${def.label}.`,
                        );
                        services.sendGameMessage(player, formatDoseMessage(def.dosesAfter));
                    },
                });
                if (!ok) {
                    console.log(`[script:combat-potions] consume rejected item=${def.itemId}`);
                }
            },
            "drink",
        );
    }
}
