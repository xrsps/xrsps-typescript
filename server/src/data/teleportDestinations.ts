/**
 * Teleport spell destinations and metadata.
 * Coordinates are OSRS tile coordinates.
 */
import { getSpellWidgetId } from "./spellWidgetLoader";

export type TeleportDestination = {
    x: number;
    y: number;
    level: number;
    name: string;
};

export type TeleportSpellData = {
    /** Fallback child id only; live cache spell-button params are authoritative. */
    widgetChildId: number;
    name: string;
    levelRequired: number;
    destination: TeleportDestination;
    spellbook: "standard" | "ancient" | "lunar" | "arceuus";
    runeCosts: Array<{ runeId: number; quantity: number }>;
    experienceGained: number;
    castAnimId?: number;
    castSpotAnim?: number;
    endSpotAnim?: number;
    castSoundId?: number;
    arriveSoundId?: number;
};

// Rune IDs
const FIRE_RUNE = 554;
const WATER_RUNE = 555;
const AIR_RUNE = 556;
const EARTH_RUNE = 557;
const MIND_RUNE = 558;
const BODY_RUNE = 559;
const DEATH_RUNE = 560;
const NATURE_RUNE = 561;
const CHAOS_RUNE = 562;
const LAW_RUNE = 563;
const COSMIC_RUNE = 564;
const BLOOD_RUNE = 565;
const SOUL_RUNE = 566;
const ASTRAL_RUNE = 9075;

// Common teleport animation and graphics (per RSMod)
const STANDARD_TELEPORT_ANIM = 714; // Standard teleport cast animation
const STANDARD_TELEPORT_GFX = 111; // Blue teleport graphic at start
// Note: Standard teleports don't have an end graphic in RSMod

const ANCIENT_TELEPORT_ANIM = 1979; // Ancient teleport animation
const ANCIENT_TELEPORT_GFX = 392; // Purple ancient teleport graphic

// Per RSMod: Lunar uses animation 1816, graphic 747 at height 120
const LUNAR_TELEPORT_ANIM = 1816; // Lunar teleport animation
const LUNAR_TELEPORT_GFX = 747; // Lunar teleport graphic

// Per RSMod: Arceuus uses same as Lunar (animation 1816, graphic 747 at height 120)
const ARCEUUS_TELEPORT_ANIM = 1816; // Arceuus teleport animation
const ARCEUUS_TELEPORT_GFX = 747; // Arceuus teleport graphic

// Teleport sound effects (OSRS sound IDs)
const STANDARD_TELEPORT_CAST_SOUND = 200; // Standard teleport cast sound
const STANDARD_TELEPORT_ARRIVE_SOUND = 201; // Standard teleport arrive sound
const HOME_TELEPORT_SOUND = 193; // Home teleport sound
const ANCIENT_TELEPORT_SOUND = 197; // Ancient teleport sound
const LUNAR_TELEPORT_SOUND = 200; // Lunar uses same as standard
const ARCEUUS_TELEPORT_SOUND = 200; // Arceuus uses same as standard

/**
 * Standard Spellbook Teleports
 */
export const STANDARD_TELEPORTS: TeleportSpellData[] = [
    {
        widgetChildId: 7, // Home teleport
        name: "Home Teleport",
        levelRequired: 0,
        destination: { x: 3222, y: 3218, level: 0, name: "Lumbridge" },
        spellbook: "standard",
        runeCosts: [], // No runes required
        experienceGained: 0,
        castAnimId: 4847, // Home teleport has special animation
        castSpotAnim: 800,
        castSoundId: HOME_TELEPORT_SOUND,
    },
    {
        widgetChildId: 23, // 0x17
        name: "Varrock Teleport",
        levelRequired: 25,
        destination: { x: 3213, y: 3424, level: 0, name: "Varrock Square" },
        spellbook: "standard",
        runeCosts: [
            { runeId: FIRE_RUNE, quantity: 1 },
            { runeId: AIR_RUNE, quantity: 3 },
            { runeId: LAW_RUNE, quantity: 1 },
        ],
        experienceGained: 35,
        castAnimId: STANDARD_TELEPORT_ANIM,
        castSpotAnim: STANDARD_TELEPORT_GFX,
        castSoundId: STANDARD_TELEPORT_CAST_SOUND,
        arriveSoundId: STANDARD_TELEPORT_ARRIVE_SOUND,
    },
    {
        widgetChildId: 26, // 0x1a
        name: "Lumbridge Teleport",
        levelRequired: 31,
        destination: { x: 3222, y: 3218, level: 0, name: "Lumbridge Castle" },
        spellbook: "standard",
        runeCosts: [
            { runeId: EARTH_RUNE, quantity: 1 },
            { runeId: AIR_RUNE, quantity: 3 },
            { runeId: LAW_RUNE, quantity: 1 },
        ],
        experienceGained: 41,
        castAnimId: STANDARD_TELEPORT_ANIM,
        castSpotAnim: STANDARD_TELEPORT_GFX,
        castSoundId: STANDARD_TELEPORT_CAST_SOUND,
        arriveSoundId: STANDARD_TELEPORT_ARRIVE_SOUND,
    },
    {
        widgetChildId: 29, // 0x1d
        name: "Falador Teleport",
        levelRequired: 37,
        destination: { x: 2964, y: 3378, level: 0, name: "Falador Center" },
        spellbook: "standard",
        runeCosts: [
            { runeId: WATER_RUNE, quantity: 1 },
            { runeId: AIR_RUNE, quantity: 3 },
            { runeId: LAW_RUNE, quantity: 1 },
        ],
        experienceGained: 48,
        castAnimId: STANDARD_TELEPORT_ANIM,
        castSpotAnim: STANDARD_TELEPORT_GFX,
        castSoundId: STANDARD_TELEPORT_CAST_SOUND,
        arriveSoundId: STANDARD_TELEPORT_ARRIVE_SOUND,
    },
    {
        widgetChildId: 31, // 0x1f - Teleport to House
        name: "Teleport to House",
        levelRequired: 40,
        destination: { x: 2953, y: 3224, level: 0, name: "Rimmington" }, // Default house location
        spellbook: "standard",
        runeCosts: [
            { runeId: EARTH_RUNE, quantity: 1 },
            { runeId: AIR_RUNE, quantity: 1 },
            { runeId: LAW_RUNE, quantity: 1 },
        ],
        experienceGained: 30,
        castAnimId: STANDARD_TELEPORT_ANIM,
        castSpotAnim: STANDARD_TELEPORT_GFX,
        castSoundId: STANDARD_TELEPORT_CAST_SOUND,
        arriveSoundId: STANDARD_TELEPORT_ARRIVE_SOUND,
    },
    {
        widgetChildId: 34, // 0x22
        name: "Camelot Teleport",
        levelRequired: 45,
        destination: { x: 2757, y: 3478, level: 0, name: "Camelot Castle" },
        spellbook: "standard",
        runeCosts: [
            { runeId: AIR_RUNE, quantity: 5 },
            { runeId: LAW_RUNE, quantity: 1 },
        ],
        experienceGained: 55.5,
        castAnimId: STANDARD_TELEPORT_ANIM,
        castSpotAnim: STANDARD_TELEPORT_GFX,
        castSoundId: STANDARD_TELEPORT_CAST_SOUND,
        arriveSoundId: STANDARD_TELEPORT_ARRIVE_SOUND,
    },
    {
        widgetChildId: 36, // 0x24
        name: "Kourend Castle Teleport",
        levelRequired: 48,
        destination: { x: 1643, y: 3672, level: 0, name: "Kourend Castle" },
        spellbook: "standard",
        runeCosts: [
            { runeId: FIRE_RUNE, quantity: 5 },
            { runeId: WATER_RUNE, quantity: 4 },
            { runeId: LAW_RUNE, quantity: 2 },
            { runeId: SOUL_RUNE, quantity: 2 },
        ],
        experienceGained: 58,
        castAnimId: STANDARD_TELEPORT_ANIM,
        castSpotAnim: STANDARD_TELEPORT_GFX,
        castSoundId: STANDARD_TELEPORT_CAST_SOUND,
        arriveSoundId: STANDARD_TELEPORT_ARRIVE_SOUND,
    },
    {
        widgetChildId: 41, // 0x29
        name: "Ardougne Teleport",
        levelRequired: 51,
        destination: { x: 2661, y: 3301, level: 0, name: "Ardougne Market" },
        spellbook: "standard",
        runeCosts: [
            { runeId: WATER_RUNE, quantity: 2 },
            { runeId: LAW_RUNE, quantity: 2 },
        ],
        experienceGained: 61,
        castAnimId: STANDARD_TELEPORT_ANIM,
        castSpotAnim: STANDARD_TELEPORT_GFX,
        castSoundId: STANDARD_TELEPORT_CAST_SOUND,
        arriveSoundId: STANDARD_TELEPORT_ARRIVE_SOUND,
    },
    {
        widgetChildId: 47, // 0x2f
        name: "Watchtower Teleport",
        levelRequired: 58,
        destination: { x: 2549, y: 3112, level: 2, name: "Watchtower" },
        spellbook: "standard",
        runeCosts: [
            { runeId: EARTH_RUNE, quantity: 2 },
            { runeId: LAW_RUNE, quantity: 2 },
        ],
        experienceGained: 68,
        castAnimId: STANDARD_TELEPORT_ANIM,
        castSpotAnim: STANDARD_TELEPORT_GFX,
        castSoundId: STANDARD_TELEPORT_CAST_SOUND,
        arriveSoundId: STANDARD_TELEPORT_ARRIVE_SOUND,
    },
    {
        widgetChildId: 54, // 0x36
        name: "Trollheim Teleport",
        levelRequired: 61,
        destination: { x: 2891, y: 3678, level: 0, name: "Trollheim" },
        spellbook: "standard",
        runeCosts: [
            { runeId: FIRE_RUNE, quantity: 2 },
            { runeId: LAW_RUNE, quantity: 2 },
        ],
        experienceGained: 68,
        castAnimId: STANDARD_TELEPORT_ANIM,
        castSpotAnim: STANDARD_TELEPORT_GFX,
        castSoundId: STANDARD_TELEPORT_CAST_SOUND,
        arriveSoundId: STANDARD_TELEPORT_ARRIVE_SOUND,
    },
    {
        widgetChildId: 57, // 0x39
        name: "Ape Atoll Teleport",
        levelRequired: 64,
        destination: { x: 2796, y: 2798, level: 0, name: "Ape Atoll" },
        spellbook: "standard",
        runeCosts: [
            { runeId: FIRE_RUNE, quantity: 2 },
            { runeId: WATER_RUNE, quantity: 2 },
            { runeId: LAW_RUNE, quantity: 2 },
            { runeId: 1963, quantity: 1 }, // Banana
        ],
        experienceGained: 74,
        castAnimId: STANDARD_TELEPORT_ANIM,
        castSpotAnim: STANDARD_TELEPORT_GFX,
        castSoundId: STANDARD_TELEPORT_CAST_SOUND,
        arriveSoundId: STANDARD_TELEPORT_ARRIVE_SOUND,
    },
];

/**
 * Ancient Magicks Teleports
 */
export const ANCIENT_TELEPORTS: TeleportSpellData[] = [
    {
        widgetChildId: 97, // 0x61 - Paddewwa
        name: "Paddewwa Teleport",
        levelRequired: 54,
        destination: { x: 3097, y: 9880, level: 0, name: "Edgeville Dungeon" },
        spellbook: "ancient",
        runeCosts: [
            { runeId: FIRE_RUNE, quantity: 1 },
            { runeId: AIR_RUNE, quantity: 1 },
            { runeId: LAW_RUNE, quantity: 2 },
        ],
        experienceGained: 64,
        castAnimId: ANCIENT_TELEPORT_ANIM,
        castSpotAnim: ANCIENT_TELEPORT_GFX,
        castSoundId: ANCIENT_TELEPORT_SOUND,
    },
    {
        widgetChildId: 98, // 0x62 - Senntisten
        name: "Senntisten Teleport",
        levelRequired: 60,
        destination: { x: 3320, y: 3338, level: 0, name: "Digsite" },
        spellbook: "ancient",
        runeCosts: [
            { runeId: SOUL_RUNE, quantity: 1 },
            { runeId: LAW_RUNE, quantity: 2 },
        ],
        experienceGained: 70,
        castAnimId: ANCIENT_TELEPORT_ANIM,
        castSpotAnim: ANCIENT_TELEPORT_GFX,
        castSoundId: ANCIENT_TELEPORT_SOUND,
    },
    {
        widgetChildId: 99, // 0x63 - Kharyrll
        name: "Kharyrll Teleport",
        levelRequired: 66,
        destination: { x: 3492, y: 3471, level: 0, name: "Canifis" },
        spellbook: "ancient",
        runeCosts: [
            { runeId: BLOOD_RUNE, quantity: 1 },
            { runeId: LAW_RUNE, quantity: 2 },
        ],
        experienceGained: 76,
        castAnimId: ANCIENT_TELEPORT_ANIM,
        castSpotAnim: ANCIENT_TELEPORT_GFX,
        castSoundId: ANCIENT_TELEPORT_SOUND,
    },
    {
        widgetChildId: 100, // 0x64 - Lassar
        name: "Lassar Teleport",
        levelRequired: 72,
        destination: { x: 3002, y: 3470, level: 0, name: "Ice Mountain" },
        spellbook: "ancient",
        runeCosts: [
            { runeId: WATER_RUNE, quantity: 4 },
            { runeId: LAW_RUNE, quantity: 2 },
        ],
        experienceGained: 82,
        castAnimId: ANCIENT_TELEPORT_ANIM,
        castSpotAnim: ANCIENT_TELEPORT_GFX,
        castSoundId: ANCIENT_TELEPORT_SOUND,
    },
    {
        widgetChildId: 101, // 0x65 - Dareeyak
        name: "Dareeyak Teleport",
        levelRequired: 78,
        destination: { x: 2966, y: 3696, level: 0, name: "Wilderness Ruins" },
        spellbook: "ancient",
        runeCosts: [
            { runeId: FIRE_RUNE, quantity: 3 },
            { runeId: AIR_RUNE, quantity: 2 },
            { runeId: LAW_RUNE, quantity: 2 },
        ],
        experienceGained: 88,
        castAnimId: ANCIENT_TELEPORT_ANIM,
        castSpotAnim: ANCIENT_TELEPORT_GFX,
        castSoundId: ANCIENT_TELEPORT_SOUND,
    },
    {
        widgetChildId: 102, // 0x66 - Carrallangar
        name: "Carrallangar Teleport",
        levelRequired: 84,
        destination: { x: 3156, y: 3666, level: 0, name: "Graveyard of Shadows" },
        spellbook: "ancient",
        runeCosts: [
            { runeId: SOUL_RUNE, quantity: 2 },
            { runeId: LAW_RUNE, quantity: 2 },
        ],
        experienceGained: 82,
        castAnimId: ANCIENT_TELEPORT_ANIM,
        castSpotAnim: ANCIENT_TELEPORT_GFX,
        castSoundId: ANCIENT_TELEPORT_SOUND,
    },
    {
        widgetChildId: 103, // 0x67 - Annakarl
        name: "Annakarl Teleport",
        levelRequired: 90,
        destination: { x: 3288, y: 3886, level: 0, name: "Demonic Ruins" },
        spellbook: "ancient",
        runeCosts: [
            { runeId: BLOOD_RUNE, quantity: 2 },
            { runeId: LAW_RUNE, quantity: 2 },
        ],
        experienceGained: 100,
        castAnimId: ANCIENT_TELEPORT_ANIM,
        castSpotAnim: ANCIENT_TELEPORT_GFX,
        castSoundId: ANCIENT_TELEPORT_SOUND,
    },
    {
        widgetChildId: 104, // 0x68 - Ghorrock
        name: "Ghorrock Teleport",
        levelRequired: 96,
        destination: { x: 2977, y: 3873, level: 0, name: "Ice Plateau" },
        spellbook: "ancient",
        runeCosts: [
            { runeId: WATER_RUNE, quantity: 8 },
            { runeId: LAW_RUNE, quantity: 2 },
        ],
        experienceGained: 106,
        castAnimId: ANCIENT_TELEPORT_ANIM,
        castSpotAnim: ANCIENT_TELEPORT_GFX,
        castSoundId: ANCIENT_TELEPORT_SOUND,
    },
];

/**
 * Arceuus Spellbook Teleports
 */
export const ARCEUUS_TELEPORTS: TeleportSpellData[] = [
    {
        widgetChildId: 150, // Home teleport for Arceuus
        name: "Arceuus Home Teleport",
        levelRequired: 0,
        destination: { x: 1712, y: 3882, level: 0, name: "Arceuus" },
        spellbook: "arceuus",
        runeCosts: [],
        experienceGained: 0,
        castAnimId: ARCEUUS_TELEPORT_ANIM,
        castSpotAnim: ARCEUUS_TELEPORT_GFX,
        castSoundId: HOME_TELEPORT_SOUND,
    },
    {
        widgetChildId: 152, // 0x98 - Arceuus Library
        name: "Arceuus Library Teleport",
        levelRequired: 6,
        destination: { x: 1632, y: 3838, level: 0, name: "Arceuus Library" },
        spellbook: "arceuus",
        runeCosts: [
            { runeId: EARTH_RUNE, quantity: 2 },
            { runeId: LAW_RUNE, quantity: 1 },
        ],
        experienceGained: 10,
        castAnimId: ARCEUUS_TELEPORT_ANIM,
        castSpotAnim: ARCEUUS_TELEPORT_GFX,
        castSoundId: ARCEUUS_TELEPORT_SOUND,
        arriveSoundId: STANDARD_TELEPORT_ARRIVE_SOUND,
    },
    {
        widgetChildId: 156, // Draynor Manor
        name: "Draynor Manor Teleport",
        levelRequired: 17,
        destination: { x: 3108, y: 3352, level: 0, name: "Draynor Manor" },
        spellbook: "arceuus",
        runeCosts: [
            { runeId: EARTH_RUNE, quantity: 1 },
            { runeId: WATER_RUNE, quantity: 1 },
            { runeId: LAW_RUNE, quantity: 1 },
        ],
        experienceGained: 16,
        castAnimId: ARCEUUS_TELEPORT_ANIM,
        castSpotAnim: ARCEUUS_TELEPORT_GFX,
        castSoundId: ARCEUUS_TELEPORT_SOUND,
        arriveSoundId: STANDARD_TELEPORT_ARRIVE_SOUND,
    },
    {
        widgetChildId: 158, // Mind Altar
        name: "Mind Altar Teleport",
        levelRequired: 28,
        destination: { x: 2980, y: 3510, level: 0, name: "Mind Altar" },
        spellbook: "arceuus",
        runeCosts: [
            { runeId: MIND_RUNE, quantity: 2 },
            { runeId: LAW_RUNE, quantity: 1 },
        ],
        experienceGained: 22,
        castAnimId: ARCEUUS_TELEPORT_ANIM,
        castSpotAnim: ARCEUUS_TELEPORT_GFX,
        castSoundId: ARCEUUS_TELEPORT_SOUND,
        arriveSoundId: STANDARD_TELEPORT_ARRIVE_SOUND,
    },
    {
        widgetChildId: 160, // Salve Graveyard
        name: "Salve Graveyard Teleport",
        levelRequired: 40,
        destination: { x: 3432, y: 3461, level: 0, name: "Salve Graveyard" },
        spellbook: "arceuus",
        runeCosts: [
            { runeId: SOUL_RUNE, quantity: 1 },
            { runeId: LAW_RUNE, quantity: 1 },
        ],
        experienceGained: 30,
        castAnimId: ARCEUUS_TELEPORT_ANIM,
        castSpotAnim: ARCEUUS_TELEPORT_GFX,
        castSoundId: ARCEUUS_TELEPORT_SOUND,
        arriveSoundId: STANDARD_TELEPORT_ARRIVE_SOUND,
    },
    {
        widgetChildId: 161, // Fenkenstrain's Castle
        name: "Fenkenstrain's Castle Teleport",
        levelRequired: 48,
        destination: { x: 3548, y: 3528, level: 0, name: "Fenkenstrain's Castle" },
        spellbook: "arceuus",
        runeCosts: [
            { runeId: EARTH_RUNE, quantity: 1 },
            { runeId: SOUL_RUNE, quantity: 1 },
            { runeId: LAW_RUNE, quantity: 1 },
        ],
        experienceGained: 50,
        castAnimId: ARCEUUS_TELEPORT_ANIM,
        castSpotAnim: ARCEUUS_TELEPORT_GFX,
        castSoundId: ARCEUUS_TELEPORT_SOUND,
        arriveSoundId: STANDARD_TELEPORT_ARRIVE_SOUND,
    },
    {
        widgetChildId: 162, // West Ardougne
        name: "West Ardougne Teleport",
        levelRequired: 61,
        destination: { x: 2500, y: 3291, level: 0, name: "West Ardougne" },
        spellbook: "arceuus",
        runeCosts: [
            { runeId: SOUL_RUNE, quantity: 2 },
            { runeId: LAW_RUNE, quantity: 2 },
        ],
        experienceGained: 68,
        castAnimId: ARCEUUS_TELEPORT_ANIM,
        castSpotAnim: ARCEUUS_TELEPORT_GFX,
        castSoundId: ARCEUUS_TELEPORT_SOUND,
        arriveSoundId: STANDARD_TELEPORT_ARRIVE_SOUND,
    },
    {
        widgetChildId: 164, // Harmony Island
        name: "Harmony Island Teleport",
        levelRequired: 65,
        destination: { x: 3797, y: 2866, level: 0, name: "Harmony Island" },
        spellbook: "arceuus",
        runeCosts: [
            { runeId: SOUL_RUNE, quantity: 1 },
            { runeId: NATURE_RUNE, quantity: 1 },
            { runeId: LAW_RUNE, quantity: 1 },
        ],
        experienceGained: 74,
        castAnimId: ARCEUUS_TELEPORT_ANIM,
        castSpotAnim: ARCEUUS_TELEPORT_GFX,
        castSoundId: ARCEUUS_TELEPORT_SOUND,
        arriveSoundId: STANDARD_TELEPORT_ARRIVE_SOUND,
    },
    {
        widgetChildId: 166, // Barrows
        name: "Barrows Teleport",
        levelRequired: 83,
        destination: { x: 3565, y: 3315, level: 0, name: "Barrows" },
        spellbook: "arceuus",
        runeCosts: [
            { runeId: SOUL_RUNE, quantity: 2 },
            { runeId: BLOOD_RUNE, quantity: 1 },
            { runeId: LAW_RUNE, quantity: 2 },
        ],
        experienceGained: 90,
        castAnimId: ARCEUUS_TELEPORT_ANIM,
        castSpotAnim: ARCEUUS_TELEPORT_GFX,
        castSoundId: ARCEUUS_TELEPORT_SOUND,
        arriveSoundId: STANDARD_TELEPORT_ARRIVE_SOUND,
    },
    {
        widgetChildId: 168, // Ape Atoll Dungeon (Arceuus version)
        name: "Ape Atoll Teleport (Arceuus)",
        levelRequired: 90,
        destination: { x: 2770, y: 9100, level: 0, name: "Ape Atoll Dungeon" },
        spellbook: "arceuus",
        runeCosts: [
            { runeId: SOUL_RUNE, quantity: 2 },
            { runeId: BLOOD_RUNE, quantity: 2 },
            { runeId: LAW_RUNE, quantity: 2 },
        ],
        experienceGained: 100,
        castAnimId: ARCEUUS_TELEPORT_ANIM,
        castSpotAnim: ARCEUUS_TELEPORT_GFX,
        castSoundId: ARCEUUS_TELEPORT_SOUND,
        arriveSoundId: STANDARD_TELEPORT_ARRIVE_SOUND,
    },
];

/**
 * Get all teleport spells across all spellbooks
 */
export function getAllTeleportSpells(): TeleportSpellData[] {
    return [...STANDARD_TELEPORTS, ...ANCIENT_TELEPORTS, ...ARCEUUS_TELEPORTS];
}

function getResolvedTeleportWidgetChildId(teleportSpell: TeleportSpellData): number {
    return (
        getSpellWidgetId(teleportSpell.name, teleportSpell.spellbook) ?? teleportSpell.widgetChildId
    );
}

/**
 * Find teleport spell by widget child ID
 */
export function getTeleportByWidgetId(widgetChildId: number): TeleportSpellData | undefined {
    return getAllTeleportSpells().find(
        (teleportSpell) => getResolvedTeleportWidgetChildId(teleportSpell) === widgetChildId,
    );
}

/**
 * Find teleport spell by name (case-insensitive)
 */
export function getTeleportByName(name: string): TeleportSpellData | undefined {
    const lowerName = name.toLowerCase();
    return getAllTeleportSpells().find((t) => t.name.toLowerCase() === lowerName);
}
