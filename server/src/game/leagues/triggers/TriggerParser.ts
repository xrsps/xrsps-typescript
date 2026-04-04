/**
 * Parses task names to extract trigger criteria.
 * Uses pattern matching to identify trigger type and target.
 */
import { PRAYER_DEFINITIONS, type PrayerName } from "../../../../../src/rs/prayer/prayers";
import { SKILL_IDS, SKILL_NAME, type SkillId } from "../../../../../src/rs/skill/skills";
import type { TaskTrigger } from "./TriggerTypes";

export type NameToIdsLookup = (name: string) => number[];

export interface TriggerParserLoaders {
    getNpcIdsByName: NameToIdsLookup;
    getItemIdsByName: NameToIdsLookup;
    getLocIdsByName: NameToIdsLookup;
}

const SKILL_ID_BY_NORMALIZED_NAME = new Map<string, SkillId>(
    SKILL_IDS.map((skillId) => [SKILL_NAME[skillId].toLowerCase(), skillId]),
);
const PRAYER_ID_BY_NORMALIZED_NAME = new Map<string, PrayerName>(
    PRAYER_DEFINITIONS.map((prayer) => [prayer.name.toLowerCase(), prayer.id]),
);
const EMOTE_ID_BY_NORMALIZED_NAME = new Map<string, number>([
    ["explore", 49],
    ["uri transform", 45],
    ["fortis salute", 53],
]);
const LOC_NAME_ALIASES = new Map<string, string[]>([
    ["bank", ["bank", "bank booth", "bank chest", "bank deposit box"]],
]);

function normalizeSkillName(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeQuestName(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/['’]/g, "")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function normalizeLocName(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/\b(one of|some|any)\b/g, "")
        .replace(/\s+(in|at|on|near|from|within|inside|west of|east of|north of|south of)\s+.+$/i, "")
        .replace(/\s+/g, " ")
        .trim();
}

function singularizeName(value: string): string {
    if (value.endsWith("ies")) {
        return `${value.slice(0, -3)}y`;
    }
    if (value.endsWith("s") && !value.endsWith("ss")) {
        return value.slice(0, -1);
    }
    return value;
}

function getPrayerIdByName(value: string): PrayerName | undefined {
    return PRAYER_ID_BY_NORMALIZED_NAME.get(value.trim().toLowerCase());
}

function getEmoteIdByName(value: string): number | undefined {
    return EMOTE_ID_BY_NORMALIZED_NAME.get(value.trim().toLowerCase());
}

function getLocIdsByCandidateNames(
    loaders: TriggerParserLoaders,
    candidates: Iterable<string>,
): number[] {
    const locIds = new Set<number>();

    for (const rawCandidate of candidates) {
        const candidate = normalizeLocName(rawCandidate);
        if (!candidate) continue;

        const names = new Set<string>([candidate, singularizeName(candidate)]);
        const aliases = LOC_NAME_ALIASES.get(candidate);
        if (aliases) {
            for (const alias of aliases) {
                names.add(alias);
                names.add(singularizeName(alias));
            }
        }

        for (const name of names) {
            for (const locId of loaders.getLocIdsByName(name)) {
                locIds.add(locId);
            }
        }
    }

    return [...locIds];
}

function extractDescriptionLocName(description: string): string | undefined {
    const patterns = [
        /\b(?:at|from|on|in|into)\s+(?:any\s+)?(?:a\s+|an\s+|the\s+)?(.+?)(?:\s+to\s+|\s+for\s+|\s+while\s+|[.()]|$)/i,
        /\buse\s+(?:any\s+)?(?:a\s+|an\s+|the\s+)?(.+?)(?:\s+to\s+|[.()]|$)/i,
    ];

    for (const pattern of patterns) {
        const match = description.match(pattern);
        if (match) {
            return match[1].trim();
        }
    }

    return undefined;
}

function getSkillIdByName(value: string): SkillId | undefined {
    const normalized = normalizeSkillName(
        value
            .replace(/^in\s+your\s+/i, "")
            .replace(/\s+skill$/i, "")
            .trim(),
    );
    return SKILL_ID_BY_NORMALIZED_NAME.get(normalized);
}

function parseExcludedSkillIds(description: string): SkillId[] | undefined {
    const exclusionsMatch = description.match(/not including\s+(.+?)(?:[.)]|$)/i);
    if (!exclusionsMatch) {
        return undefined;
    }

    const parts = exclusionsMatch[1]
        .replace(/\band\b/gi, ",")
        .split(",")
        .map((part) => getSkillIdByName(part))
        .filter((skillId): skillId is SkillId => skillId !== undefined);

    return parts.length > 0 ? parts : undefined;
}

/**
 * Parse a task name and description to determine its trigger.
 * Returns undefined if the task can't be auto-parsed (needs manual trigger).
 */
export function parseTaskTrigger(
    name: string,
    description: string,
    loaders: TriggerParserLoaders,
): TaskTrigger | undefined {
    // === NPC Kill patterns ===
    // "Defeat a Moss Giant", "Kill 10 Goblins", "Slay a Black Dragon"
    const killPatterns = [
        /^(defeat|kill|slay)\s+(a\s+|an\s+|the\s+)?(\d+\s+)?(.+)$/i,
        /^(\d+)\s+(.+?)\s+(kill|kills)$/i, // "10 Goblin Kills" or "1 Zulrah Kill"
    ];

    for (const pattern of killPatterns) {
        const match = name.match(pattern);
        if (match) {
            let npcName: string;
            let count = 1;

            if (pattern === killPatterns[1]) {
                // "10 Goblin Kills" pattern
                count = parseInt(match[1], 10) || 1;
                npcName = match[2].trim();
            } else {
                // "Defeat a Moss Giant" pattern
                count = match[3] ? parseInt(match[3], 10) || 1 : 1;
                npcName = match[4].trim();
            }

            // Clean up NPC name (remove trailing location info)
            // "Moss Giant in Tirannwn" -> "Moss Giant"
            npcName = npcName.replace(/\s+(in|at|on|near)\s+.+$/i, "").trim();

            const npcIds = loaders.getNpcIdsByName(npcName);
            if (npcIds.length > 0) {
                return {
                    type: "npc_kill",
                    npcIds,
                    count: count > 1 ? count : undefined,
                };
            }
        }
    }

    // === Item Equip patterns ===
    // "Equip a Dragon Scimitar", "Wear a Fire Cape"
    const equipMatch = name.match(/^(equip|wear)\s+(a\s+|an\s+|the\s+|any\s+)?(.+)$/i);
    if (equipMatch) {
        let itemName = equipMatch[3].trim();

        // Handle "Piece of X" or "Full X set" - these need special handling
        if (itemName.toLowerCase().includes("piece of") || itemName.toLowerCase().includes("set")) {
            // These are complex, skip auto-parsing
            return undefined;
        }

        const itemIds = loaders.getItemIdsByName(itemName);
        if (itemIds.length > 0) {
            return {
                type: "item_equip",
                itemIds,
            };
        }
    }

    // === NPC Pickpocket patterns ===
    // "Pickpocket a Master Farmer"
    const pickpocketMatch = name.match(/^(pickpocket)\s+(a\s+|an\s+|the\s+)?(.+)$/i);
    if (pickpocketMatch) {
        const npcName = pickpocketMatch[3].trim();
        const npcIds = loaders.getNpcIdsByName(npcName);
        if (npcIds.length > 0) {
            return {
                type: "npc_pickpocket",
                npcIds,
            };
        }
    }

    // === Item Obtain patterns ===
    // "Obtain a Dragon Axe", "Receive a Pet"
    const obtainMatch = name.match(
        /^(obtain|receive|get|loot)\s+(a\s+|an\s+|the\s+)?(\d+\s+)?(.+)$/i,
    );
    if (obtainMatch) {
        const count = obtainMatch[3] ? parseInt(obtainMatch[3], 10) || 1 : 1;
        const itemName = obtainMatch[4].trim();

        const itemIds = loaders.getItemIdsByName(itemName);
        if (itemIds.length > 0) {
            return {
                type: "item_obtain",
                itemIds,
                count: count > 1 ? count : undefined,
            };
        }
    }

    // === Item Craft patterns ===
    // "Craft a Black D'hide Body", "Smith a Rune Platebody", "Cook a Shark"
    const craftMatch = name.match(
        /^(craft|smith|cook|fletch|create|make|brew|smelt)\s+(a\s+|an\s+|the\s+)?(\d+\s+)?(.+)$/i,
    );
    if (craftMatch) {
        const count = craftMatch[3] ? parseInt(craftMatch[3], 10) || 1 : 1;
        let itemName = craftMatch[4].trim();

        // Remove "(u)" suffix for unstrung items
        itemName = itemName.replace(/\s*\(u\)\s*$/i, "");

        const itemIds = loaders.getItemIdsByName(itemName);
        if (itemIds.length > 0) {
            return {
                type: "item_craft",
                itemIds,
                count: count > 1 ? count : undefined,
            };
        }
    }

    // === Resource Gather patterns ===
    // "Chop 100 Magic Logs", "Mine a Runite Ore", "Catch a Shark"
    const gatherMatch = name.match(
        /^(chop|mine|catch|fish|pick|harvest)\s+(a\s+|an\s+|the\s+)?(\d+\s+)?(.+)$/i,
    );
    if (gatherMatch) {
        const count = gatherMatch[3] ? parseInt(gatherMatch[3], 10) || 1 : 1;
        const itemName = gatherMatch[4].trim();

        const itemIds = loaders.getItemIdsByName(itemName);
        if (itemIds.length > 0) {
            // Gathering is essentially obtaining the item
            return {
                type: "item_obtain",
                itemIds,
                count: count > 1 ? count : undefined,
            };
        }
    }

    // === Quest completion patterns ===
    const questDescriptionMatch = description.match(
        /^complete\s+the\s+(.+?)\s+(quest|mini-quest)$/i,
    );
    if (questDescriptionMatch) {
        return {
            type: "quest_complete",
            questName: normalizeQuestName(questDescriptionMatch[1]),
        };
    }

    // === Prayer activation patterns ===
    const prayerMatch =
        name.match(/^activate\s+(.+)$/i) ??
        name.match(/^use\s+the\s+(.+?)\s+prayer$/i);
    if (prayerMatch) {
        const prayerName = getPrayerIdByName(prayerMatch[1]);
        if (prayerName) {
            return {
                type: "prayer_activate",
                prayerName,
            };
        }
    }

    // === Emote use patterns ===
    const emoteName =
        name.match(/^use\s+the\s+(.+?)\s+emote$/i)?.[1] ??
        description.match(/^use\s+the\s+(.+?)\s+emote$/i)?.[1] ??
        description.match(/^use\s+the\s+(.+?)\s+transform\s+emote$/i)?.[1];
    if (emoteName) {
        const emoteId = getEmoteIdByName(emoteName);
        if (emoteId !== undefined) {
            return {
                type: "emote_use",
                emoteId,
            };
        }
    }

    if (/^transform\s+into\s+uri$/i.test(name)) {
        const emoteId = getEmoteIdByName("uri transform");
        if (emoteId !== undefined) {
            return {
                type: "emote_use",
                emoteId,
            };
        }
    }

    // === Loc interaction patterns ===
    const openMatch = name.match(/^(open)\s+(\d+\s+)?(.+)$/i);
    if (openMatch && !/leagues menu|coin pouches/i.test(name)) {
        const count = openMatch[2] ? parseInt(openMatch[2], 10) || 1 : 1;
        const locIds = getLocIdsByCandidateNames(loaders, [openMatch[3]]);
        if (locIds.length > 0) {
            return {
                type: "loc_interact",
                locIds,
                action: "open",
                count: count > 1 ? count : undefined,
            };
        }
    }

    const useLocName =
        name.match(/^use\s+(?:the\s+)?(.+)$/i)?.[1] ?? extractDescriptionLocName(description);
    if (
        useLocName &&
        !/prayer|special attack|portal nexus|teleport|enriched bones|digsite pendant|icy basalt|elven teleport crystal/i.test(
            name,
        )
    ) {
        const locIds = getLocIdsByCandidateNames(loaders, [useLocName]);
        if (locIds.length > 0) {
            return {
                type: "loc_interact",
                locIds,
            };
        }
    }

    const prayLocName = name.match(/^pray\s+at\s+(?:an?\s+|the\s+)?(.+)$/i)?.[1];
    if (prayLocName) {
        const locIds = getLocIdsByCandidateNames(loaders, [prayLocName]);
        if (locIds.length > 0) {
            return {
                type: "loc_interact",
                locIds,
                action: "pray",
            };
        }
    }

    const checkLocName =
        name.match(/^check\s+(?:a\s+|an\s+|the\s+)?(?:grown\s+)?(.+)$/i)?.[1] ??
        description.match(/^check\s+the\s+health\s+of\s+(?:a\s+|an\s+|the\s+)?(?:grown\s+)?(.+?)(?:\s+after|\s+you've|\.)/i)?.[1];
    if (checkLocName) {
        const locIds = getLocIdsByCandidateNames(loaders, [checkLocName]);
        if (locIds.length > 0) {
            return {
                type: "loc_interact",
                locIds,
                action: "check",
            };
        }
    }

    if (/^steal\b/i.test(name)) {
        const count = name.match(/^steal\s+(\d+)\b/i)?.[1];
        const locName =
            name.match(/^steal\s+from\s+(?:a\s+|an\s+|the\s+)?(.+)$/i)?.[1] ??
            description.match(/\bfrom\s+(?:a\s+|an\s+|the\s+)?(.+?)(?:\s+in\s+|\s+for\s+|\.)/i)?.[1];
        if (locName) {
            const locIds = getLocIdsByCandidateNames(loaders, [locName]);
            if (locIds.length > 0) {
                return {
                    type: "loc_interact",
                    locIds,
                    action: "steal",
                    count: count ? parseInt(count, 10) || 1 : undefined,
                };
            }
        }
    }

    const activateLocName = name.match(/^activate\s+(?:the\s+)?(.+)$/i)?.[1];
    if (activateLocName && !getPrayerIdByName(activateLocName)) {
        const locIds = getLocIdsByCandidateNames(loaders, [activateLocName]);
        if (locIds.length > 0) {
            return {
                type: "loc_interact",
                locIds,
                action: "activate",
            };
        }
    }

    // === Level milestone patterns ===
    // "Achieve Your First Level Up"
    // "Achieve Your First Level 5"
    // "Achieve Your First Level 10"
    // "Achieve Your First Level 20"
    const firstLevelUpMatch = name.match(/^achieve\s+your\s+first\s+level\s+up$/i);
    if (firstLevelUpMatch) {
        return {
            type: "level_reach",
            level: 2, // first actual level-up from level 1
        };
    }

    const firstLevelMilestoneMatch = name.match(
        /^achieve\s+your\s+first\s+level\s+(\d+)$/i,
    );
    if (firstLevelMilestoneMatch) {
        const level = parseInt(firstLevelMilestoneMatch[1], 10);
        if (Number.isFinite(level) && level >= 2) {
            return {
                type: "level_reach",
                level,
                excludedSkillIds: parseExcludedSkillIds(description),
            };
        }
    }

    const specificSkillLevelMatch = name.match(/^reach\s+level\s+(\d+)\s+(.+)$/i);
    if (specificSkillLevelMatch) {
        const level = parseInt(specificSkillLevelMatch[1], 10);
        const skillId = getSkillIdByName(specificSkillLevelMatch[2]);
        if (Number.isFinite(level) && level >= 2 && skillId !== undefined) {
            return {
                type: "level_reach",
                skillId,
                level,
            };
        }
    }

    const totalLevelMatch = name.match(/^reach\s+total\s+level\s+(\d+)$/i);
    if (totalLevelMatch) {
        const totalLevel = parseInt(totalLevelMatch[1], 10);
        if (Number.isFinite(totalLevel) && totalLevel >= 2) {
            return {
                type: "total_level_reach",
                totalLevel,
            };
        }
    }

    const baseLevelMatch = name.match(/^reach\s+base\s+level\s+(\d+)$/i);
    if (baseLevelMatch) {
        const level = parseInt(baseLevelMatch[1], 10);
        if (Number.isFinite(level) && level >= 2) {
            return {
                type: "base_level_reach",
                level,
            };
        }
    }

    const combatLevelMatch = name.match(/^reach\s+combat\s+level\s+(\d+)$/i);
    if (combatLevelMatch) {
        const combatLevel = parseInt(combatLevelMatch[1], 10);
        if (Number.isFinite(combatLevel) && combatLevel >= 3) {
            return {
                type: "combat_level_reach",
                combatLevel,
            };
        }
    }
    // No pattern matched - needs manual trigger
    return undefined;
}

/**
 * Build name-to-IDs lookup functions from cache loaders.
 */
export function buildNameLookups(
    npcTypeLoader: { load: (id: number) => { name?: string } | undefined } | undefined,
    objTypeLoader: { load: (id: number) => { name?: string } | undefined } | undefined,
    locTypeLoader: { load: (id: number) => { name?: string } | undefined } | undefined,
): TriggerParserLoaders {
    // Build NPC name -> IDs map
    const npcNameToIds = new Map<string, number[]>();
    if (npcTypeLoader) {
        for (let id = 0; id < 20000; id++) {
            const npc = npcTypeLoader.load(id);
            if (npc?.name && npc.name !== "null") {
                const nameLower = npc.name.toLowerCase();
                let ids = npcNameToIds.get(nameLower);
                if (!ids) {
                    ids = [];
                    npcNameToIds.set(nameLower, ids);
                }
                ids.push(id);
            }
        }
    }

    // Build item name -> IDs map
    const itemNameToIds = new Map<string, number[]>();
    if (objTypeLoader) {
        for (let id = 0; id < 30000; id++) {
            const item = objTypeLoader.load(id);
            if (item?.name && item.name !== "null") {
                const nameLower = item.name.toLowerCase();
                let ids = itemNameToIds.get(nameLower);
                if (!ids) {
                    ids = [];
                    itemNameToIds.set(nameLower, ids);
                }
                ids.push(id);
            }
        }
    }

    const locNameToIds = new Map<string, number[]>();
    if (locTypeLoader) {
        for (let id = 0; id < 70000; id++) {
            const loc = locTypeLoader.load(id);
            if (loc?.name && loc.name !== "null") {
                const nameLower = normalizeLocName(loc.name);
                if (!nameLower) continue;
                let ids = locNameToIds.get(nameLower);
                if (!ids) {
                    ids = [];
                    locNameToIds.set(nameLower, ids);
                }
                ids.push(id);
            }
        }
    }

    return {
        getNpcIdsByName: (name: string) => npcNameToIds.get(name.toLowerCase()) ?? [],
        getItemIdsByName: (name: string) => itemNameToIds.get(name.toLowerCase()) ?? [],
        getLocIdsByName: (name: string) => locNameToIds.get(normalizeLocName(name)) ?? [],
    };
}
