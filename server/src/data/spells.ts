import type { CacheInfo } from "../../../src/rs/cache/CacheInfo";
import { CacheSystem } from "../../../src/rs/cache/CacheSystem";
import { CombatCategory, getWeaponData } from "../../data/weapons";
import { applyProjectileDefaults } from "./projectileParams";
import { buildSpellNameToWidgetMap } from "./spellWidgetLoader";

export type RuneCost = {
    runeId: number;
    quantity: number;
};

export type SpellDataEntry = {
    id: number;
    /** Widget child index within the spellbook interface (set at runtime from cache) */
    widgetChildId?: number;
    name?: string;
    levelRequired?: number;
    baseMaxHit: number;
    castSpotAnim?: number;
    projectileId?: number;
    impactSpotAnim?: number;
    splashSpotAnim?: number;
    castAnimId?: number;
    runeCosts?: RuneCost[];
    spellbook?: "standard" | "ancient" | "lunar" | "arceuus";
    category?: "combat" | "teleport" | "utility" | "binding";
    experienceGained?: number;
    freezeDuration?: number; // ticks
    maxTargets?: number; // for multi-target spells like barrage
    projectileStartHeight?: number;
    projectileEndHeight?: number;
    projectileSlope?: number;
    projectileSteepness?: number;
    projectileStartDelay?: number;
    projectileTravelTime?: number;
    /** Optional extra ticks to delay projectile release relative to cast sequence start */
    projectileReleaseDelayTicks?: number;
    // Optional stat debuff applied on landed hit (PvP and, in future, NPCs with stat profiles)
    statDebuff?: {
        stat: "attack" | "strength" | "defence";
        percent: number; // percent reduction of current level (floored, min 1)
        durationTicks?: number; // optional; if omitted, persists until restored by other means
    };
};

const ENTRIES: SpellDataEntry[] = [
    // Standard spellbook – combat strikes/bolts/blasts/waves/surges
    // Note: widgetChildId is set at runtime from cache via initSpellWidgetMapping()
    {
        id: 3273,
        name: "Wind Strike",
        baseMaxHit: 2,
        castSpotAnim: 90,
        projectileId: 91,
        impactSpotAnim: 92,
        splashSpotAnim: 85,
        levelRequired: 1,
        spellbook: "standard",
        category: "combat",
        runeCosts: [
            { runeId: 558, quantity: 1 },
            { runeId: 556, quantity: 1 },
        ],
    },
    {
        id: 3275,
        name: "Water Strike",
        baseMaxHit: 4,
        castSpotAnim: 93,
        projectileId: 94,
        impactSpotAnim: 95,
        splashSpotAnim: 85,
        levelRequired: 5,
        spellbook: "standard",
        category: "combat",
        runeCosts: [
            { runeId: 558, quantity: 1 },
            { runeId: 555, quantity: 1 },
            { runeId: 556, quantity: 1 },
        ],
    },
    {
        id: 3277,
        name: "Earth Strike",
        baseMaxHit: 6,
        castSpotAnim: 96,
        projectileId: 97,
        impactSpotAnim: 98,
        splashSpotAnim: 85,
        levelRequired: 9,
        spellbook: "standard",
        category: "combat",
        runeCosts: [
            { runeId: 558, quantity: 1 },
            { runeId: 557, quantity: 2 },
            { runeId: 556, quantity: 1 },
        ],
    },
    {
        id: 3279,
        name: "Fire Strike",
        baseMaxHit: 8,
        castSpotAnim: 99,
        projectileId: 100,
        impactSpotAnim: 101,
        splashSpotAnim: 85,
        levelRequired: 13,
        spellbook: "standard",
        category: "combat",
        runeCosts: [
            { runeId: 558, quantity: 1 },
            { runeId: 554, quantity: 3 },
            { runeId: 556, quantity: 2 },
        ],
    },
    {
        id: 3281,
        name: "Wind Bolt",
        baseMaxHit: 9,
        castSpotAnim: 117,
        projectileId: 118,
        impactSpotAnim: 119,
        splashSpotAnim: 85,
        levelRequired: 17,
        spellbook: "standard",
        category: "combat",
        runeCosts: [
            { runeId: 562, quantity: 1 },
            { runeId: 556, quantity: 2 },
        ],
    },
    {
        id: 3285,
        name: "Water Bolt",
        baseMaxHit: 10,
        castSpotAnim: 120,
        projectileId: 121,
        impactSpotAnim: 122,
        splashSpotAnim: 85,
        levelRequired: 23,
        spellbook: "standard",
        category: "combat",
        runeCosts: [
            { runeId: 562, quantity: 1 },
            { runeId: 555, quantity: 2 },
            { runeId: 556, quantity: 2 },
        ],
    },
    {
        id: 3288,
        name: "Earth Bolt",
        baseMaxHit: 11,
        castSpotAnim: 123,
        projectileId: 124,
        impactSpotAnim: 125,
        splashSpotAnim: 85,
        levelRequired: 29,
        spellbook: "standard",
        category: "combat",
        runeCosts: [
            { runeId: 562, quantity: 1 },
            { runeId: 557, quantity: 3 },
            { runeId: 556, quantity: 2 },
        ],
    },
    {
        id: 3291,
        name: "Fire Bolt",
        baseMaxHit: 12,
        castSpotAnim: 126,
        projectileId: 127,
        impactSpotAnim: 128,
        splashSpotAnim: 85,
        levelRequired: 35,
        spellbook: "standard",
        category: "combat",
        runeCosts: [
            { runeId: 562, quantity: 1 },
            { runeId: 554, quantity: 4 },
            { runeId: 556, quantity: 3 },
        ],
    },
    {
        id: 3294,
        name: "Wind Blast",
        baseMaxHit: 13,
        castSpotAnim: 132,
        projectileId: 133,
        impactSpotAnim: 134,
        splashSpotAnim: 85,
        levelRequired: 41,
        spellbook: "standard",
        category: "combat",
        runeCosts: [
            { runeId: 560, quantity: 1 },
            { runeId: 556, quantity: 3 },
        ],
    },
    {
        id: 3297,
        name: "Water Blast",
        baseMaxHit: 14,
        castSpotAnim: 135,
        projectileId: 136,
        impactSpotAnim: 137,
        splashSpotAnim: 85,
        levelRequired: 47,
        spellbook: "standard",
        category: "combat",
        runeCosts: [
            { runeId: 560, quantity: 1 },
            { runeId: 555, quantity: 3 },
            { runeId: 556, quantity: 3 },
        ],
    },
    {
        id: 3302,
        name: "Earth Blast",
        baseMaxHit: 15,
        castSpotAnim: 138,
        projectileId: 139,
        impactSpotAnim: 140,
        splashSpotAnim: 85,
        levelRequired: 53,
        spellbook: "standard",
        category: "combat",
        runeCosts: [
            { runeId: 560, quantity: 1 },
            { runeId: 557, quantity: 4 },
            { runeId: 556, quantity: 3 },
        ],
    },
    {
        id: 3307,
        name: "Fire Blast",
        baseMaxHit: 16,
        castSpotAnim: 129,
        projectileId: 130,
        impactSpotAnim: 131,
        splashSpotAnim: 85,
        levelRequired: 59,
        spellbook: "standard",
        category: "combat",
        runeCosts: [
            { runeId: 560, quantity: 1 },
            { runeId: 554, quantity: 5 },
            { runeId: 556, quantity: 4 },
        ],
    },
    {
        id: 3313,
        name: "Wind Wave",
        baseMaxHit: 17,
        castSpotAnim: 158,
        projectileId: 159,
        impactSpotAnim: 160,
        splashSpotAnim: 85,
        levelRequired: 62,
        spellbook: "standard",
        category: "combat",
        runeCosts: [
            { runeId: 565, quantity: 1 },
            { runeId: 556, quantity: 5 },
        ],
    },
    {
        id: 3315,
        name: "Water Wave",
        baseMaxHit: 18,
        castSpotAnim: 161,
        projectileId: 162,
        impactSpotAnim: 163,
        splashSpotAnim: 85,
        levelRequired: 65,
        spellbook: "standard",
        category: "combat",
        runeCosts: [
            { runeId: 565, quantity: 1 },
            { runeId: 555, quantity: 7 },
            { runeId: 556, quantity: 5 },
        ],
    },
    {
        id: 3319,
        name: "Earth Wave",
        baseMaxHit: 19,
        castSpotAnim: 164,
        projectileId: 165,
        impactSpotAnim: 166,
        splashSpotAnim: 85,
        levelRequired: 70,
        spellbook: "standard",
        category: "combat",
        runeCosts: [
            { runeId: 565, quantity: 1 },
            { runeId: 557, quantity: 7 },
            { runeId: 556, quantity: 5 },
        ],
    },
    {
        id: 3321,
        name: "Fire Wave",
        baseMaxHit: 20,
        castSpotAnim: 155,
        projectileId: 156,
        impactSpotAnim: 157,
        splashSpotAnim: 85,
        levelRequired: 75,
        spellbook: "standard",
        category: "combat",
        runeCosts: [
            { runeId: 565, quantity: 1 },
            { runeId: 554, quantity: 7 },
            { runeId: 556, quantity: 5 },
        ],
    },
    {
        id: 21876,
        name: "Wind Surge",
        baseMaxHit: 21,
        castSpotAnim: 457,
        projectileId: 458,
        impactSpotAnim: 459,
        splashSpotAnim: 85,
        levelRequired: 81,
        spellbook: "standard",
        category: "combat",
        runeCosts: [
            { runeId: 21880, quantity: 1 },
            { runeId: 556, quantity: 7 },
        ],
    },
    {
        id: 21877,
        name: "Water Surge",
        baseMaxHit: 22,
        castSpotAnim: 460,
        projectileId: 461,
        impactSpotAnim: 462,
        splashSpotAnim: 85,
        levelRequired: 85,
        spellbook: "standard",
        category: "combat",
        runeCosts: [
            { runeId: 21880, quantity: 1 },
            { runeId: 555, quantity: 10 },
            { runeId: 556, quantity: 7 },
        ],
    },
    {
        id: 21878,
        name: "Earth Surge",
        baseMaxHit: 23,
        castSpotAnim: 463,
        projectileId: 464,
        impactSpotAnim: 465,
        splashSpotAnim: 85,
        levelRequired: 90,
        spellbook: "standard",
        category: "combat",
        runeCosts: [
            { runeId: 21880, quantity: 1 },
            { runeId: 557, quantity: 10 },
            { runeId: 556, quantity: 7 },
        ],
    },
    {
        id: 21879,
        name: "Fire Surge",
        baseMaxHit: 24,
        castSpotAnim: 466,
        projectileId: 467,
        impactSpotAnim: 468,
        splashSpotAnim: 85,
        levelRequired: 95,
        spellbook: "standard",
        category: "combat",
        runeCosts: [
            { runeId: 21880, quantity: 1 },
            { runeId: 554, quantity: 10 },
            { runeId: 556, quantity: 7 },
        ],
    },

    // Standard spellbook – utility/binding spells
    {
        id: 3274,
        name: "Confuse",
        baseMaxHit: 0,
        castSpotAnim: 102,
        projectileId: 103,
        impactSpotAnim: 104,
        splashSpotAnim: 85,
        levelRequired: 3,
        spellbook: "standard",
        category: "utility",
        statDebuff: { stat: "attack", percent: 5 },
        runeCosts: [
            { runeId: 559, quantity: 1 },
            { runeId: 555, quantity: 3 },
            { runeId: 557, quantity: 2 },
        ],
    },
    {
        id: 3293,
        name: "Crumble Undead",
        baseMaxHit: 15,
        castSpotAnim: 145,
        projectileId: 146,
        impactSpotAnim: 147,
        experienceGained: 24,
        levelRequired: 39,
        spellbook: "standard",
        category: "combat",
        runeCosts: [
            { runeId: 562, quantity: 2 }, // Chaos
            { runeId: 557, quantity: 2 }, // Earth
            { runeId: 556, quantity: 2 }, // Air
        ],
    },
    {
        id: 9075,
        name: "Superheat Item",
        baseMaxHit: 0,
        castSpotAnim: 148,
        levelRequired: 43,
        spellbook: "standard",
        category: "utility",
        runeCosts: [
            { runeId: 554, quantity: 4 }, // Fire
            { runeId: 561, quantity: 1 }, // Nature
        ],
    },
    {
        id: 9110,
        name: "Low Level Alchemy",
        baseMaxHit: 0,
        castSpotAnim: 112,
        levelRequired: 21,
        spellbook: "standard",
        category: "utility",
        runeCosts: [
            { runeId: 554, quantity: 3 }, // Fire
            { runeId: 561, quantity: 1 }, // Nature
        ],
    },
    {
        id: 9111,
        name: "High Level Alchemy",
        baseMaxHit: 0,
        castSpotAnim: 113,
        levelRequired: 55,
        spellbook: "standard",
        category: "utility",
        runeCosts: [
            { runeId: 554, quantity: 5 }, // Fire
            { runeId: 561, quantity: 1 }, // Nature
        ],
    },
    {
        id: 9100,
        name: "Telekinetic Grab",
        baseMaxHit: 0,
        castSpotAnim: 142,
        projectileId: 143,
        impactSpotAnim: 144,
        levelRequired: 33,
        spellbook: "standard",
        category: "utility",
        runeCosts: [
            { runeId: 563, quantity: 1 }, // Law
            { runeId: 556, quantity: 1 }, // Air
        ],
    },
    {
        id: 9076,
        name: "Charge Air Orb",
        baseMaxHit: 0,
        castSpotAnim: 150,
        levelRequired: 66,
        spellbook: "standard",
        category: "utility",
        runeCosts: [
            { runeId: 564, quantity: 3 }, // Cosmic
            { runeId: 556, quantity: 30 }, // Air
            { runeId: 567, quantity: 1 }, // Unpowered orb (placeholder id)
        ],
    },
    {
        id: 9077,
        name: "Charge Earth Orb",
        baseMaxHit: 0,
        castSpotAnim: 151,
        levelRequired: 60,
        spellbook: "standard",
        category: "utility",
        runeCosts: [
            { runeId: 564, quantity: 3 },
            { runeId: 557, quantity: 30 },
            { runeId: 567, quantity: 1 },
        ],
    },
    {
        id: 9078,
        name: "Charge Fire Orb",
        baseMaxHit: 0,
        castSpotAnim: 152,
        levelRequired: 63,
        spellbook: "standard",
        category: "utility",
        runeCosts: [
            { runeId: 564, quantity: 3 },
            { runeId: 554, quantity: 30 },
            { runeId: 567, quantity: 1 },
        ],
    },
    {
        id: 9079,
        name: "Charge Water Orb",
        baseMaxHit: 0,
        castSpotAnim: 149,
        levelRequired: 56,
        spellbook: "standard",
        category: "utility",
        runeCosts: [
            { runeId: 564, quantity: 3 },
            { runeId: 555, quantity: 30 },
            { runeId: 567, quantity: 1 },
        ],
    },
    {
        id: 9001,
        name: "Bones to Bananas",
        baseMaxHit: 0,
        castSpotAnim: 114,
        levelRequired: 15,
        spellbook: "standard",
        category: "utility",
        runeCosts: [
            { runeId: 561, quantity: 1 }, // Nature
            { runeId: 555, quantity: 2 }, // Water
            { runeId: 557, quantity: 2 }, // Earth
        ],
    },
    {
        id: 3324,
        name: "Vulnerability",
        baseMaxHit: 0,
        castSpotAnim: 167,
        projectileId: 168,
        impactSpotAnim: 169,
        splashSpotAnim: 85,
        levelRequired: 66,
        spellbook: "standard",
        category: "utility",
        statDebuff: { stat: "defence", percent: 10 },
        runeCosts: [
            { runeId: 566, quantity: 1 }, // Soul
            { runeId: 555, quantity: 1 }, // Water
            { runeId: 557, quantity: 5 }, // Earth
        ],
    },
    {
        id: 3325,
        name: "Enfeeble",
        baseMaxHit: 0,
        castSpotAnim: 170,
        projectileId: 171,
        impactSpotAnim: 172,
        splashSpotAnim: 85,
        levelRequired: 73,
        spellbook: "standard",
        category: "utility",
        statDebuff: { stat: "strength", percent: 10 },
        runeCosts: [
            { runeId: 566, quantity: 1 }, // Soul
            { runeId: 555, quantity: 1 }, // Water
            { runeId: 557, quantity: 8 }, // Earth
        ],
    },
    {
        id: 3326,
        name: "Stun",
        baseMaxHit: 0,
        castSpotAnim: 173,
        projectileId: 174,
        impactSpotAnim: 175,
        splashSpotAnim: 85,
        levelRequired: 80,
        spellbook: "standard",
        category: "utility",
        statDebuff: { stat: "attack", percent: 10 },
        runeCosts: [
            { runeId: 566, quantity: 1 }, // Soul
            { runeId: 555, quantity: 1 }, // Water
            { runeId: 557, quantity: 12 }, // Earth
        ],
    },
    {
        id: 3278,
        name: "Weaken",
        baseMaxHit: 0,
        castSpotAnim: 105,
        projectileId: 106,
        impactSpotAnim: 107,
        splashSpotAnim: 85,
        levelRequired: 11,
        spellbook: "standard",
        category: "utility",
        statDebuff: { stat: "strength", percent: 5 },
        runeCosts: [
            { runeId: 559, quantity: 1 },
            { runeId: 555, quantity: 3 },
            { runeId: 557, quantity: 2 },
        ],
    },
    {
        id: 3282,
        name: "Curse",
        baseMaxHit: 0,
        castSpotAnim: 108,
        projectileId: 109,
        impactSpotAnim: 110,
        splashSpotAnim: 85,
        levelRequired: 19,
        spellbook: "standard",
        category: "utility",
        statDebuff: { stat: "defence", percent: 5 },
        runeCosts: [
            { runeId: 559, quantity: 1 },
            { runeId: 555, quantity: 2 },
            { runeId: 557, quantity: 3 },
        ],
    },
    {
        id: 3283,
        name: "Bind",
        baseMaxHit: 0,
        castSpotAnim: 177,
        projectileId: 178,
        impactSpotAnim: 181,
        splashSpotAnim: 85,
        levelRequired: 20,
        spellbook: "standard",
        category: "binding",
        freezeDuration: 10,
        runeCosts: [
            { runeId: 561, quantity: 2 },
            { runeId: 555, quantity: 3 },
            { runeId: 557, quantity: 3 },
        ],
    },
    {
        id: 3300,
        name: "Snare",
        baseMaxHit: 3,
        castSpotAnim: 177,
        projectileId: 178,
        impactSpotAnim: 180,
        splashSpotAnim: 85,
        levelRequired: 50,
        spellbook: "standard",
        category: "binding",
        freezeDuration: 20,
        runeCosts: [
            { runeId: 561, quantity: 3 },
            { runeId: 555, quantity: 4 },
            { runeId: 557, quantity: 4 },
        ],
    },
    {
        id: 3322,
        name: "Entangle",
        baseMaxHit: 5,
        castSpotAnim: 177,
        projectileId: 178,
        impactSpotAnim: 179,
        splashSpotAnim: 85,
        levelRequired: 79,
        spellbook: "standard",
        category: "binding",
        freezeDuration: 30,
        runeCosts: [
            { runeId: 561, quantity: 4 },
            { runeId: 555, quantity: 5 },
            { runeId: 557, quantity: 5 },
        ],
    },

    // Ancient Magicks – rush / burst / blitz / barrage
    {
        id: 4629,
        name: "Smoke Rush",
        baseMaxHit: 13,
        projectileId: 384,
        impactSpotAnim: 385,
        levelRequired: 50,
        spellbook: "ancient",
        category: "combat",
        runeCosts: [
            { runeId: 560, quantity: 2 },
            { runeId: 562, quantity: 2 },
            { runeId: 556, quantity: 1 },
        ],
    },
    {
        id: 4630,
        name: "Shadow Rush",
        baseMaxHit: 14,
        projectileId: 378,
        impactSpotAnim: 379,
        levelRequired: 52,
        spellbook: "ancient",
        category: "combat",
        runeCosts: [
            { runeId: 560, quantity: 2 },
            { runeId: 562, quantity: 2 },
            { runeId: 566, quantity: 1 },
        ],
    },
    {
        id: 4632,
        name: "Blood Rush",
        baseMaxHit: 15,
        impactSpotAnim: 373,
        levelRequired: 56,
        spellbook: "ancient",
        category: "combat",
        runeCosts: [
            { runeId: 560, quantity: 2 },
            { runeId: 562, quantity: 2 },
            { runeId: 565, quantity: 1 },
        ],
    },
    {
        id: 4633,
        name: "Ice Rush",
        baseMaxHit: 16,
        projectileId: 360,
        impactSpotAnim: 361,
        levelRequired: 58,
        spellbook: "ancient",
        category: "combat",
        freezeDuration: 10,
        runeCosts: [
            { runeId: 560, quantity: 2 },
            { runeId: 562, quantity: 2 },
            { runeId: 555, quantity: 2 },
        ],
    },
    {
        id: 4635,
        name: "Smoke Burst",
        baseMaxHit: 17,
        impactSpotAnim: 389,
        levelRequired: 62,
        spellbook: "ancient",
        category: "combat",
        maxTargets: 9,
        runeCosts: [
            { runeId: 560, quantity: 2 },
            { runeId: 562, quantity: 4 },
            { runeId: 556, quantity: 2 },
        ],
    },
    {
        id: 4636,
        name: "Shadow Burst",
        baseMaxHit: 18,
        impactSpotAnim: 382,
        levelRequired: 64,
        spellbook: "ancient",
        category: "combat",
        maxTargets: 9,
        runeCosts: [
            { runeId: 560, quantity: 2 },
            { runeId: 562, quantity: 4 },
            { runeId: 566, quantity: 2 },
        ],
    },
    {
        id: 4638,
        name: "Blood Burst",
        baseMaxHit: 21,
        impactSpotAnim: 376,
        levelRequired: 68,
        spellbook: "ancient",
        category: "combat",
        maxTargets: 9,
        runeCosts: [
            { runeId: 560, quantity: 2 },
            { runeId: 562, quantity: 4 },
            { runeId: 565, quantity: 2 },
        ],
    },
    {
        id: 4639,
        name: "Ice Burst",
        baseMaxHit: 22,
        impactSpotAnim: 363,
        levelRequired: 70,
        spellbook: "ancient",
        category: "combat",
        freezeDuration: 17,
        maxTargets: 9,
        runeCosts: [
            { runeId: 560, quantity: 2 },
            { runeId: 562, quantity: 4 },
            { runeId: 555, quantity: 4 },
        ],
    },
    {
        id: 4641,
        name: "Smoke Blitz",
        baseMaxHit: 23,
        projectileId: 386,
        impactSpotAnim: 387,
        levelRequired: 74,
        spellbook: "ancient",
        category: "combat",
        runeCosts: [
            { runeId: 560, quantity: 2 },
            { runeId: 565, quantity: 2 },
            { runeId: 556, quantity: 2 },
        ],
    },
    {
        id: 4642,
        name: "Shadow Blitz",
        baseMaxHit: 24,
        projectileId: 380,
        impactSpotAnim: 381,
        levelRequired: 76,
        spellbook: "ancient",
        category: "combat",
        runeCosts: [
            { runeId: 560, quantity: 2 },
            { runeId: 565, quantity: 2 },
            { runeId: 566, quantity: 2 },
        ],
    },
    {
        id: 4644,
        name: "Blood Blitz",
        baseMaxHit: 25,
        projectileId: 374,
        impactSpotAnim: 375,
        levelRequired: 80,
        spellbook: "ancient",
        category: "combat",
        runeCosts: [
            { runeId: 560, quantity: 2 },
            { runeId: 565, quantity: 4 },
        ],
    },
    {
        id: 4645,
        name: "Ice Blitz",
        baseMaxHit: 26,
        castSpotAnim: 366,
        impactSpotAnim: 367,
        levelRequired: 82,
        spellbook: "ancient",
        category: "combat",
        freezeDuration: 25,
        runeCosts: [
            { runeId: 560, quantity: 2 },
            { runeId: 565, quantity: 2 },
            { runeId: 555, quantity: 3 },
        ],
    },
    {
        id: 4647,
        name: "Smoke Barrage",
        baseMaxHit: 27,
        impactSpotAnim: 391,
        levelRequired: 86,
        spellbook: "ancient",
        category: "combat",
        maxTargets: 9,
        runeCosts: [
            { runeId: 560, quantity: 4 },
            { runeId: 565, quantity: 2 },
            { runeId: 556, quantity: 4 },
        ],
    },
    {
        id: 4648,
        name: "Shadow Barrage",
        baseMaxHit: 28,
        impactSpotAnim: 383,
        levelRequired: 88,
        spellbook: "ancient",
        category: "combat",
        maxTargets: 9,
        runeCosts: [
            { runeId: 560, quantity: 4 },
            { runeId: 565, quantity: 2 },
            { runeId: 566, quantity: 3 },
        ],
    },
    {
        id: 4650,
        name: "Blood Barrage",
        baseMaxHit: 29,
        impactSpotAnim: 377,
        levelRequired: 92,
        spellbook: "ancient",
        category: "combat",
        maxTargets: 9,
        runeCosts: [
            { runeId: 560, quantity: 4 },
            { runeId: 565, quantity: 4 },
            { runeId: 566, quantity: 1 },
        ],
    },
    {
        id: 4651,
        name: "Ice Barrage",
        baseMaxHit: 30,
        impactSpotAnim: 369,
        levelRequired: 94,
        spellbook: "ancient",
        category: "combat",
        freezeDuration: 33,
        maxTargets: 9,
        runeCosts: [
            { runeId: 560, quantity: 4 },
            { runeId: 565, quantity: 2 },
            { runeId: 555, quantity: 6 },
        ],
    },
];

for (const entry of ENTRIES) {
    applyProjectileDefaults(entry.projectileId, entry);
}

const SPELL_DATA_MAP = new Map<number, SpellDataEntry>();
for (const entry of ENTRIES) {
    SPELL_DATA_MAP.set(entry.id, entry);
}

// Widget-based spell lookup map: key = "spellbookGroupId:widgetChildId"
// Populated at runtime from cache via initSpellWidgetMapping()
const SPELL_BY_WIDGET_MAP = new Map<string, SpellDataEntry>();

// Track initialization state
let spellWidgetMappingInitialized = false;

/**
 * Initialize spell-widget mappings from cache at runtime.
 * This is the proper OSRS approach where widget layout comes from cache, not hardcoded.
 * Must be called after cache is loaded but before spell casting is used.
 */
export function initSpellWidgetMapping(cacheInfo: CacheInfo, cache: CacheSystem): void {
    if (spellWidgetMappingInitialized) {
        console.warn("[Spells] Spell-widget mapping already initialized");
        return;
    }

    console.log("[Spells] Initializing spell-widget mapping from cache...");

    // Build name -> widget mapping from cache
    const nameToWidget = buildSpellNameToWidgetMap(cacheInfo, cache);
    console.log(`[Spells] Found ${nameToWidget.size} spell widgets in cache`);

    // Match spell data entries to widget positions by name
    let matched = 0;
    let unmatched = 0;

    for (const entry of ENTRIES) {
        if (!entry.name) continue;

        const normalizedName = entry.name.toLowerCase().trim();
        const widgetInfo = nameToWidget.get(normalizedName);

        if (widgetInfo) {
            // Set the widget child ID on the spell entry
            entry.widgetChildId = widgetInfo.fileId;

            // Register in widget lookup map
            const key = `${widgetInfo.groupId}:${widgetInfo.fileId}`;
            SPELL_BY_WIDGET_MAP.set(key, entry);
            matched++;
        } else {
            // Try alternate name formats (e.g., "High Level Alchemy" vs "High Alchemy")
            const altNames = getAlternateSpellNames(entry.name);
            let found = false;
            for (const altName of altNames) {
                const altWidgetInfo = nameToWidget.get(altName.toLowerCase().trim());
                if (altWidgetInfo) {
                    entry.widgetChildId = altWidgetInfo.fileId;
                    const key = `${altWidgetInfo.groupId}:${altWidgetInfo.fileId}`;
                    SPELL_BY_WIDGET_MAP.set(key, entry);
                    matched++;
                    found = true;
                    break;
                }
            }
            if (!found) {
                unmatched++;
                // Only warn for spells that should have widgets (standard/ancient spellbook combat/utility spells)
                if (
                    entry.spellbook &&
                    (entry.category === "combat" ||
                        entry.category === "utility" ||
                        entry.category === "binding")
                ) {
                    console.warn(
                        `[Spells] No widget found for spell: ${entry.name} (${entry.spellbook})`,
                    );
                }
            }
        }
    }

    console.log(
        `[Spells] Spell-widget mapping complete: ${matched} matched, ${unmatched} unmatched`,
    );
    spellWidgetMappingInitialized = true;
}

/**
 * Get alternate name forms to try for matching
 */
function getAlternateSpellNames(name: string): string[] {
    const alts: string[] = [];

    // "High Level Alchemy" -> "High Alchemy"
    if (name.includes("Level")) {
        alts.push(name.replace(/\s*Level\s*/g, " ").trim());
    }

    // "Low Level Alchemy" -> "Low Alchemy"
    // Already covered above

    // Handle any other known mismatches
    const knownAliases: Record<string, string[]> = {
        "High Level Alchemy": ["High Alchemy", "High-Level Alchemy"],
        "Low Level Alchemy": ["Low Alchemy", "Low-Level Alchemy"],
        "Telekinetic Grab": ["Telegrab"],
    };

    if (knownAliases[name]) {
        alts.push(...knownAliases[name]);
    }

    return alts;
}

/**
 * Check if spell-widget mapping has been initialized
 */
export function isSpellWidgetMappingInitialized(): boolean {
    return spellWidgetMappingInitialized;
}

export function getSpellData(spellId: number): SpellDataEntry | undefined {
    return SPELL_DATA_MAP.get(spellId);
}

/**
 * Look up spell data by widget reference (OSRS parity - spells are identified by widget, not hardcoded ID)
 * @param spellbookGroupId Widget group ID of the spellbook (218=standard, 12=ancient, etc.)
 * @param widgetChildId Widget child index within the spellbook
 */
export function getSpellDataByWidget(
    spellbookGroupId: number,
    widgetChildId: number,
): SpellDataEntry | undefined {
    const key = `${spellbookGroupId}:${widgetChildId}`;
    return SPELL_BY_WIDGET_MAP.get(key);
}

export function getAllSpellData(): SpellDataEntry[] {
    return ENTRIES.map((entry) => ({ ...entry }));
}

/**
 * Register a spell definition at runtime (for cache-loaded spells)
 */
export function registerSpellData(entry: SpellDataEntry): void {
    applyProjectileDefaults(entry.projectileId, entry);
    SPELL_DATA_MAP.set(entry.id, entry);
}

/**
 * Check if a spell is registered
 */
export function hasSpellData(spellId: number): boolean {
    return SPELL_DATA_MAP.has(spellId);
}

/**
 * Autocast spell index (varbit 276) to spell ID mapping.
 * Derived from enum_1986 in the OSRS cache.
 * Key = spell index (1-58), Value = spell ID
 */
const AUTOCAST_INDEX_TO_SPELL_ID: Record<number, number> = {
    1: 3273, // Wind Strike
    2: 3275, // Water Strike
    3: 3277, // Earth Strike
    4: 3279, // Fire Strike
    5: 3281, // Wind Bolt
    6: 3285, // Water Bolt
    7: 3288, // Earth Bolt
    8: 3291, // Fire Bolt
    9: 3294, // Wind Blast
    10: 3297, // Water Blast
    11: 3302, // Earth Blast
    12: 3307, // Fire Blast
    13: 3313, // Wind Wave
    14: 3315, // Water Wave
    15: 3319, // Earth Wave
    16: 3321, // Fire Wave
    17: 3293, // Crumble Undead
    18: 4176, // Magic Dart (Slayer's staff)
    19: 3309, // Iban Blast
    20: 3310, // Saradomin Strike / Claws of Guthix / Flames of Zamorak (god spells - mapped by weapon)
    // 21-30 reserved
    31: 4629, // Smoke Rush
    32: 4630, // Shadow Rush
    33: 4632, // Blood Rush
    34: 4633, // Ice Rush
    35: 4635, // Smoke Burst
    36: 4636, // Shadow Burst
    37: 4638, // Blood Burst
    38: 4639, // Ice Burst
    39: 4641, // Smoke Blitz
    40: 4642, // Shadow Blitz
    41: 4644, // Blood Blitz
    42: 4645, // Ice Blitz
    43: 4647, // Smoke Barrage
    44: 4648, // Shadow Barrage
    45: 4650, // Blood Barrage
    46: 4651, // Ice Barrage
    47: 3299, // (reserved - possibly special weapon spell)
    48: 21876, // Wind Surge
    49: 21877, // Water Surge
    50: 21878, // Earth Surge
    51: 21879, // Fire Surge
    52: 3311, // (reserved)
    53: 20398, // Inferior Demonbane
    54: 20399, // Superior Demonbane
    55: 20400, // Dark Demonbane
    56: 21826, // Ghostly Grasp
    57: 21829, // Skeletal Grasp
    58: 21832, // Undead Grasp
};

// Reverse mapping: spell ID to autocast index
const SPELL_ID_TO_AUTOCAST_INDEX = new Map<number, number>();
for (const [indexStr, spellId] of Object.entries(AUTOCAST_INDEX_TO_SPELL_ID)) {
    const index = parseInt(indexStr, 10);
    if (index > 0 && spellId > 0) {
        SPELL_ID_TO_AUTOCAST_INDEX.set(spellId, index);
    }
}

/**
 * Convert autocast spell index (varbit 276 value, 1-58) to actual spell ID.
 * Returns undefined if the index is invalid or has no mapping.
 */
export function getSpellIdFromAutocastIndex(autocastIndex: number): number | undefined {
    const idx = autocastIndex;
    if (idx < 1 || idx > 58) return undefined;
    const spellId = AUTOCAST_INDEX_TO_SPELL_ID[idx];
    return spellId !== undefined && spellId > 0 ? spellId : undefined;
}

/**
 * Convert spell ID to autocast spell index (varbit 276 value).
 * Returns undefined if the spell is not autocastable.
 */
export function getAutocastIndexFromSpellId(spellId: number): number | undefined {
    const id = spellId;
    if (id <= 0) return undefined;
    return SPELL_ID_TO_AUTOCAST_INDEX.get(id);
}

/**
 * Check if a spell ID is autocastable (has a valid autocast index).
 */
export function isSpellAutocastable(spellId: number): boolean {
    return SPELL_ID_TO_AUTOCAST_INDEX.has(spellId);
}

/**
 * Build the ordered list of autocast spell indices visible for a given weapon.
 * Replicates the CS2 autocast_setup script logic: iterates enum_1986 entries
 * (autocast indices 1-58 in order) and includes only spells compatible with
 * the weapon. The result order matches the CC_CREATE childIndex assignment,
 * so result[slot] gives the autocast spell index for that dynamic child slot.
 */
export function buildVisibleAutocastIndices(weaponItemId: number): number[] {
    const result: number[] = [];
    for (let idx = 1; idx <= 58; idx++) {
        const spellId = AUTOCAST_INDEX_TO_SPELL_ID[idx];
        if (spellId === undefined || spellId <= 0) continue;
        const compat = canWeaponAutocastSpell(weaponItemId, spellId);
        if (compat.compatible) {
            result.push(idx);
        }
    }
    return result;
}

// ========== STAFF-SPELL AUTOCAST COMPATIBILITY ==========

/**
 * Weapons that can autocast Ancient Magicks spells.
 * OSRS: Ancient staff, Ahrim's staff, Master wand, Kodai wand, Nightmare staff variants,
 * Staff of the dead variants, Staff of balance, Void knight mace
 */
const ANCIENT_AUTOCAST_WEAPONS = new Set<number>([
    4675, // Ancient staff
    4710, // Ahrim's staff
    6914, // Master wand
    8841, // Void knight mace
    11791, // Staff of the dead
    12904, // Toxic staff of the dead
    21006, // Kodai wand
    22296, // Staff of balance
    24422, // Nightmare staff
    24423, // Harmonised nightmare staff
    24424, // Eldritch nightmare staff
    24425, // Volatile nightmare staff
]);

/**
 * Weapons that can autocast Iban Blast (spell ID 3309).
 */
const IBAN_BLAST_WEAPONS = new Set<number>([
    1409, // Iban's staff
    12658, // Iban's staff (u)
]);

/**
 * Weapons that can autocast Magic Dart (spell ID 4176).
 */
const MAGIC_DART_WEAPONS = new Set<number>([
    4170, // Slayer's staff
    21255, // Slayer's staff (e)
    11791, // Staff of the dead
    12904, // Toxic staff of the dead
    22296, // Staff of balance
]);

/**
 * God staves for god spells (Saradomin Strike, Claws of Guthix, Flames of Zamorak).
 * Maps weapon ID to the god spell ID it can autocast.
 */
const GOD_STAFF_TO_SPELL: Record<number, number> = {
    2415: 3312, // Saradomin staff -> Saradomin Strike
    2416: 3310, // Guthix staff -> Claws of Guthix
    2417: 3311, // Zamorak staff -> Flames of Zamorak
    22296: 3312, // Staff of balance -> Saradomin Strike (can also cast others)
};

/**
 * Weapons that can autocast Arceuus spells (Grasp spells, Demonbane).
 * Most staves can cast these on the Arceuus spellbook.
 */
const ARCEUUS_AUTOCAST_WEAPONS = new Set<number>([
    // Most staves with autocast can cast Arceuus combat spells
    // Add specific weapon IDs if restrictions apply
]);

/**
 * Powered staves that have built-in attacks and cannot autocast normal spells.
 * These weapons use a different attack mechanism entirely.
 */
const POWERED_STAVES = new Set<number>([
    11905, // Trident of the seas
    11907, // Trident of the seas (e)
    12899, // Trident of the swamp
    12900, // Trident of the swamp (e)
    22292, // Sanguinesti staff
    22294, // Holy sanguinesti staff
    27275, // Tumeken's shadow (charged)
    27277, // Tumeken's shadow (uncharged)
    27785, // Thammaron's sceptre (a)
    27788, // Accursed sceptre (a)
]);

/**
 * Ancient spell IDs (Rush, Burst, Blitz, Barrage variants).
 */
const ANCIENT_SPELL_IDS = new Set<number>([
    4629,
    4630,
    4632,
    4633, // Rush spells
    4635,
    4636,
    4638,
    4639, // Burst spells
    4641,
    4642,
    4644,
    4645, // Blitz spells
    4647,
    4648,
    4650,
    4651, // Barrage spells
]);

/**
 * God spell IDs.
 */
const GOD_SPELL_IDS = new Set<number>([
    3310, // Claws of Guthix
    3311, // Flames of Zamorak
    3312, // Saradomin Strike
]);

/**
 * Arceuus combat spell IDs.
 */
const ARCEUUS_SPELL_IDS = new Set<number>([
    20398, // Inferior Demonbane
    20399, // Superior Demonbane
    20400, // Dark Demonbane
    21826, // Ghostly Grasp
    21829, // Skeletal Grasp
    21832, // Undead Grasp
]);

export type AutocastCompatibilityResult = {
    compatible: boolean;
    reason?:
        | "no_weapon"
        | "not_autocastable_with_weapon"
        | "powered_staff"
        | "wrong_spellbook"
        | "weapon_specific_spell"
        | "invalid_spell";
};

/**
 * Check if a weapon can autocast a specific spell.
 * OSRS parity: certain spells require specific weapons to autocast.
 *
 * @param weaponItemId - The equipped weapon item ID (0 or negative = no weapon)
 * @param spellId - The spell ID to check
 * @returns Compatibility result with reason if incompatible
 */
export function canWeaponAutocastSpell(
    weaponItemId: number,
    spellId: number,
): AutocastCompatibilityResult {
    const weapon = weaponItemId;
    const spell = spellId;

    // No weapon equipped
    if (!(weapon > 0)) {
        return { compatible: false, reason: "no_weapon" };
    }

    // Check if spell is autocastable at all
    if (!isSpellAutocastable(spell)) {
        return { compatible: false, reason: "invalid_spell" };
    }

    // Powered staves cannot autocast normal spells
    if (POWERED_STAVES.has(weapon)) {
        return { compatible: false, reason: "powered_staff" };
    }

    const weaponData = getWeaponData(weapon);
    if (!weaponData || weaponData.combatCategory !== CombatCategory.MAGIC_STAFF) {
        return { compatible: false, reason: "not_autocastable_with_weapon" };
    }

    // Ancient spells require Ancient-compatible weapons
    if (ANCIENT_SPELL_IDS.has(spell)) {
        if (!ANCIENT_AUTOCAST_WEAPONS.has(weapon)) {
            return { compatible: false, reason: "wrong_spellbook" };
        }
        return { compatible: true };
    }

    // Iban Blast requires Iban's staff
    if (spell === 3309) {
        if (!IBAN_BLAST_WEAPONS.has(weapon)) {
            return { compatible: false, reason: "weapon_specific_spell" };
        }
        return { compatible: true };
    }

    // Magic Dart requires Slayer's staff or similar
    if (spell === 4176) {
        if (!MAGIC_DART_WEAPONS.has(weapon)) {
            return { compatible: false, reason: "weapon_specific_spell" };
        }
        return { compatible: true };
    }

    // God spells require specific god staves
    if (GOD_SPELL_IDS.has(spell)) {
        const allowedSpell = GOD_STAFF_TO_SPELL[weapon];
        // Staff of balance can cast all god spells
        if (weapon === 22296) {
            return { compatible: true };
        }
        if (allowedSpell !== spell) {
            return { compatible: false, reason: "weapon_specific_spell" };
        }
        return { compatible: true };
    }

    // Arceuus spells - most staves can cast these
    if (ARCEUUS_SPELL_IDS.has(spell)) {
        // For now, allow any non-powered staff to cast Arceuus spells
        // Add specific restrictions if needed
        return { compatible: true };
    }

    // Standard spells (Strike, Bolt, Blast, Wave, Surge, Crumble Undead)
    // Any autocast-capable staff can cast these
    return { compatible: true };
}

/**
 * Get a user-friendly error message for autocast compatibility failure.
 */
export function getAutocastCompatibilityMessage(
    reason: AutocastCompatibilityResult["reason"],
): string {
    switch (reason) {
        case "no_weapon":
            return "You need to equip a magic weapon to autocast spells.";
        case "not_autocastable_with_weapon":
            return "You can't autocast that spell with this weapon.";
        case "powered_staff":
            return "This weapon has a built-in spell and cannot autocast.";
        case "wrong_spellbook":
            return "Your weapon cannot autocast spells from this spellbook.";
        case "weapon_specific_spell":
            return "You need a specific weapon to autocast this spell.";
        case "invalid_spell":
            return "This spell cannot be autocast.";
        default:
            return "You cannot autocast this spell.";
    }
}

// Optional: load spell overrides (e.g., projectileReleaseDelayTicks) from JSON at startup
// Environment: SPELLS_OVERRIDES_FILE (default: server/cache/spells-overrides.json)
try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require("fs");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require("path");
    const envPath = (process?.env?.SPELLS_OVERRIDES_FILE ?? "").toString();
    const defaultPath = path.resolve("server/cache/spells-overrides.json");
    const filePath = envPath || defaultPath;
    if (fs.existsSync(filePath)) {
        const text = fs.readFileSync(filePath, "utf8");
        const json = JSON.parse(text) as Record<string, Partial<SpellDataEntry>>;
        for (const [key, override] of Object.entries(json)) {
            const id = parseInt(key, 10);
            if (!(id > 0)) continue;
            const base = SPELL_DATA_MAP.get(id);
            if (!base || !override) continue;
            const next: SpellDataEntry = { ...base };
            for (const field of [
                "castSpotAnim",
                "impactSpotAnim",
                "splashSpotAnim",
                "projectileId",
                "projectileStartHeight",
                "projectileEndHeight",
                "projectileSlope",
                "projectileSteepness",
                "projectileStartDelay",
                "projectileTravelTime",
                "projectileReleaseDelayTicks",
            ] as const) {
                if (Object.prototype.hasOwnProperty.call(override, field)) {
                    next[field] = override[field];
                }
            }
            applyProjectileDefaults(next.projectileId, next);
            SPELL_DATA_MAP.set(id, next);
        }
    }
} catch (err) { console.log("[spells] failed to load spell data from cache", err); }

// =============================================================================
// POWERED STAFF SPELL DATA
// =============================================================================

/**
 * Powered staff built-in spell data.
 * These staves have their own attack spell and cannot autocast normal spells.
 * OSRS Reference: Each powered staff has unique projectile, GFX, and sound IDs.
 */
export type PoweredStaffSpellData = {
    /** Weapon item IDs that use this spell data */
    weaponIds: number[];
    /** Display name for the spell (internal use) */
    name: string;
    /** Projectile GFX ID (travels from caster to target) */
    projectileId: number;
    /** Cast spot animation (plays on caster) */
    castSpotAnim: number;
    /** Impact spot animation (plays on target when hit lands) */
    impactSpotAnim: number;
    /** Splash spot animation (plays on target when spell splashes/misses) */
    splashSpotAnim?: number;
    /** Sound ID played when casting */
    castSoundId: number;
    /** Sound ID played when projectile is in flight (optional) */
    projectileSoundId?: number;
    /** Sound ID played on impact */
    impactSoundId: number;
    /**
     * Max hit formula type:
     * - "trident_seas": floor(magic/3) - 5
     * - "trident_swamp": floor(magic/3) - 2
     * - "sanguinesti": floor(magic/3) - 1
     * - "tumeken": floor(magic/3) + 1
     * - "thammaron": floor(magic/3) - 8 (in wilderness: + bonus)
     * - "accursed": floor(magic/3) - 6 (in wilderness: + bonus)
     */
    maxHitFormula:
        | "trident_seas"
        | "trident_swamp"
        | "sanguinesti"
        | "tumeken"
        | "thammaron"
        | "accursed";
    /** Base magic XP per cast (regardless of hit) */
    baseXp?: number;
    /** Special effects like healing (Sanguinesti) */
    effects?: {
        /** Chance to heal (Sanguinesti: 1/6 chance to heal 50% of damage) */
        healChance?: number;
        healPercent?: number;
    };
};

/**
 * Powered staff spell data registry.
 * OSRS IDs sourced from RuneLite SpotanimID, AnimationID, and OSRS Wiki.
 */
const POWERED_STAFF_SPELL_DATA: PoweredStaffSpellData[] = [
    // Trident of the seas
    {
        weaponIds: [11905, 11907, 22288], // Trident of the seas, (e), uncharged
        name: "Trident of the seas",
        projectileId: 1252,
        castSpotAnim: 1251,
        impactSpotAnim: 1253,
        splashSpotAnim: 85,
        castSoundId: 2540,
        impactSoundId: 1460,
        maxHitFormula: "trident_seas",
        baseXp: 50,
    },
    // Trident of the swamp
    {
        weaponIds: [12899, 12900, 22292, 21276], // Trident of the swamp, (e), uncharged variants
        name: "Trident of the swamp",
        projectileId: 1040,
        castSpotAnim: 1042,
        impactSpotAnim: 1041,
        splashSpotAnim: 85,
        castSoundId: 2540,
        impactSoundId: 1460,
        maxHitFormula: "trident_swamp",
        baseXp: 50,
    },
    // Sanguinesti staff
    {
        weaponIds: [22323, 22294, 24144], // Sanguinesti staff variants
        name: "Sanguinesti staff",
        projectileId: 1539,
        castSpotAnim: 1540,
        impactSpotAnim: 1541,
        splashSpotAnim: 85,
        castSoundId: 2540,
        impactSoundId: 1460,
        maxHitFormula: "sanguinesti",
        baseXp: 50,
        effects: {
            healChance: 1 / 6, // 1 in 6 chance
            healPercent: 0.5, // Heal 50% of damage dealt
        },
    },
    // Tumeken's Shadow
    {
        weaponIds: [27275, 27277], // Tumeken's shadow (charged), (uncharged)
        name: "Tumeken's shadow",
        projectileId: 2126, // TUMEKENS_SHADOW_TRAVEL
        castSpotAnim: 2125, // TUMEKENS_SHADOW_CASTING
        impactSpotAnim: 2127, // TUMEKENS_SHADOW_IMPACT
        splashSpotAnim: 85, // Standard splash
        castSoundId: 6410, // toa_shadow_weapon_cast_fire_01
        projectileSoundId: 6412, // toa_shadow_weapon_orb_02
        impactSoundId: 1460, // contact_darkness_impact
        maxHitFormula: "tumeken",
        baseXp: 70,
    },
    // Thammaron's sceptre
    {
        weaponIds: [22552, 27676, 27785], // Thammaron's sceptre variants
        name: "Thammaron's sceptre",
        projectileId: 1278,
        castSpotAnim: 1279,
        impactSpotAnim: 1280,
        splashSpotAnim: 85,
        castSoundId: 2540,
        impactSoundId: 1460,
        maxHitFormula: "thammaron",
        baseXp: 50,
    },
    // Accursed sceptre
    {
        weaponIds: [27679, 27788], // Accursed sceptre variants
        name: "Accursed sceptre",
        projectileId: 2339,
        castSpotAnim: 2340,
        impactSpotAnim: 2341,
        splashSpotAnim: 85,
        castSoundId: 2540,
        impactSoundId: 1460,
        maxHitFormula: "accursed",
        baseXp: 50,
    },
];

// Build lookup map by weapon ID
const POWERED_STAFF_DATA_BY_WEAPON = new Map<number, PoweredStaffSpellData>();
for (const data of POWERED_STAFF_SPELL_DATA) {
    for (const weaponId of data.weaponIds) {
        POWERED_STAFF_DATA_BY_WEAPON.set(weaponId, data);
    }
}

/**
 * Get powered staff spell data for a weapon.
 * Returns undefined if the weapon is not a powered staff.
 */
export function getPoweredStaffSpellData(weaponId: number): PoweredStaffSpellData | undefined {
    return POWERED_STAFF_DATA_BY_WEAPON.get(weaponId);
}

/**
 * Check if a weapon is a powered staff with built-in spell data.
 */
export function hasPoweredStaffSpellData(weaponId: number): boolean {
    return POWERED_STAFF_DATA_BY_WEAPON.has(weaponId);
}

/**
 * Calculate powered staff max hit based on magic level and formula type.
 * OSRS Parity: Each powered staff has a unique base damage formula.
 *
 * @param magicLevel - Current (boosted) magic level
 * @param formula - The max hit formula type
 * @returns Base max hit before magic damage % bonus
 */
export function calculatePoweredStaffBaseDamage(
    magicLevel: number,
    formula: PoweredStaffSpellData["maxHitFormula"],
): number {
    const level = Math.max(1, magicLevel);
    const base = Math.floor(level / 3);

    switch (formula) {
        case "trident_seas":
            // floor(magic/3) - 5, minimum 1
            return Math.max(1, base - 5);
        case "trident_swamp":
            // floor(magic/3) - 2, minimum 1
            return Math.max(1, base - 2);
        case "sanguinesti":
            // floor(magic/3) - 1, minimum 1
            return Math.max(1, base - 1);
        case "tumeken":
            // floor(magic/3) + 1
            // At 99 magic: floor(99/3) + 1 = 33 + 1 = 34
            return base + 1;
        case "thammaron":
            // floor(magic/3) - 8 (wilderness bonus handled separately)
            return Math.max(1, base - 8);
        case "accursed":
            // floor(magic/3) - 6 (wilderness bonus handled separately)
            return Math.max(1, base - 6);
        default:
            return base;
    }
}
