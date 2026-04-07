/**
 * OSRS Spell Base XP Data
 * Reference: https://oldschool.runescape.wiki/w/Magic#Experience
 *
 * Magic XP is calculated as:
 * - Base XP from casting the spell (awarded even on splash)
 * - Plus 2 XP per damage dealt (only on hit)
 *
 * For combat XP calculation, we only use the base XP here.
 * The damage-based XP (2 per damage) is added in CombatXp.ts
 */

// Standard Spellbook - Combat Spells
// Values from OSRS Wiki as of 2024

export const SPELL_BASE_XP: Record<number, number> = {
    // Strike Spells
    1152: 5.5, // Wind Strike
    1154: 7.5, // Water Strike
    1156: 9.5, // Earth Strike
    1158: 11.5, // Fire Strike

    // Bolt Spells
    1160: 13.5, // Wind Bolt
    1163: 16.5, // Water Bolt
    1166: 19.5, // Earth Bolt
    1169: 22.5, // Fire Bolt

    // Blast Spells
    1172: 25.5, // Wind Blast
    1175: 28.5, // Water Blast
    1177: 31.5, // Earth Blast
    1181: 34.5, // Fire Blast

    // Wave Spells
    1183: 36, // Wind Wave
    1185: 37.5, // Water Wave
    1188: 40, // Earth Wave
    1189: 42.5, // Fire Wave

    // Surge Spells
    22644: 44.5, // Wind Surge
    22658: 46.5, // Water Surge
    22628: 48.5, // Earth Surge
    22608: 50.5, // Fire Surge

    // God Spells (requires charge)
    1190: 35, // Saradomin Strike
    1191: 35, // Claws of Guthix
    1192: 35, // Flames of Zamorak

    // Crumble Undead
    1171: 24.5,

    // Iban Blast
    1539: 30,

    // Magic Dart
    12037: 30,

    // Ancient Magicks - Rush Spells
    12939: 30, // Smoke Rush
    12987: 31, // Shadow Rush
    12901: 33, // Blood Rush
    12861: 34, // Ice Rush

    // Ancient Magicks - Burst Spells
    12963: 36, // Smoke Burst
    13011: 37, // Shadow Burst
    12919: 39, // Blood Burst
    12881: 40, // Ice Burst

    // Ancient Magicks - Blitz Spells
    12951: 42, // Smoke Blitz
    12999: 43, // Shadow Blitz
    12911: 45, // Blood Blitz
    12871: 46, // Ice Blitz

    // Ancient Magicks - Barrage Spells
    12975: 48, // Smoke Barrage
    13023: 49, // Shadow Barrage
    12929: 51, // Blood Barrage
    12891: 52, // Ice Barrage

    // Arceuus Spellbook - Combat
    22146: 45, // Inferior Demonbane
    22153: 62.5, // Superior Demonbane
    22161: 82.5, // Dark Demonbane
    22337: 60, // Ghostly Grasp
    22351: 72, // Skeletal Grasp
    22365: 87, // Undead Grasp
};

/**
 * Get the base XP for a spell.
 * This is the XP awarded for casting the spell (even on splash).
 *
 * @param spellId - The spell ID (varbit/config ID)
 * @returns Base XP for the spell, or 0 if unknown
 */
export function getSpellBaseXp(spellId: number): number {
    return SPELL_BASE_XP[spellId] ?? 0;
}

/**
 * Check if a spell ID is a known combat spell.
 *
 * @param spellId - The spell ID to check
 * @returns True if this is a known combat spell
 */
export function isCombatSpell(spellId: number): boolean {
    return spellId in SPELL_BASE_XP;
}
