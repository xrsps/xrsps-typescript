/**
 * Parses task names to extract trigger criteria.
 * Uses pattern matching to identify trigger type and target.
 */
import type { TaskTrigger } from "./TriggerTypes";

export type NameToIdsLookup = (name: string) => number[];

export interface TriggerParserLoaders {
    getNpcIdsByName: NameToIdsLookup;
    getItemIdsByName: NameToIdsLookup;
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
    const nameLower = name.toLowerCase();
    const descLower = description.toLowerCase();

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
        /^(craft|smith|cook|fletch|create|make|brew)\s+(a\s+|an\s+|the\s+)?(\d+\s+)?(.+)$/i,
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

    // No pattern matched - needs manual trigger
    return undefined;
}

/**
 * Build name-to-IDs lookup functions from cache loaders.
 */
export function buildNameLookups(
    npcTypeLoader: { load: (id: number) => { name?: string } | undefined } | undefined,
    objTypeLoader: { load: (id: number) => { name?: string } | undefined } | undefined,
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

    return {
        getNpcIdsByName: (name: string) => npcNameToIds.get(name.toLowerCase()) ?? [],
        getItemIdsByName: (name: string) => itemNameToIds.get(name.toLowerCase()) ?? [],
    };
}
