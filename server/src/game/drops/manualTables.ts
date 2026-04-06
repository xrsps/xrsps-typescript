import type { NpcDropEntryDefinition, NpcDropTableDefinition } from "./types";

export type ManualNpcDropOverride = {
    npcTypeIds: number[];
    table: NpcDropTableDefinition;
};

function drop(
    itemName: string,
    quantity: string | number,
    rarity?: string | number,
    leagueBoostEligible = false,
): NpcDropEntryDefinition {
    return {
        itemName,
        quantity,
        rarity,
        leagueBoostEligible,
    };
}

function alwaysTable(...entries: NpcDropEntryDefinition[]): NpcDropTableDefinition {
    return { always: entries };
}

const ITEM_RING_OF_WEALTH_I = 12785;
const ITEM_GOBLIN_CHAMPION_SCROLL = 6801;
const GOBLIN_LEVEL_2_NPC_TYPE_IDS = [
    100, 101, 3028, 3029, 3030, 3031, 3032, 3033, 3034, 3035, 3036, 3051, 3052, 3053, 3054, 5192,
    5193, 5195, 5196, 5197, 5198, 5199, 5200, 5201, 5202, 5203, 5204, 5205, 5206, 5207, 5208,
] as const;
const GOBLIN_LEVEL_5_NPC_TYPE_IDS = [
    102, 655, 656, 657, 658, 659, 660, 661, 662, 663, 664, 665, 667, 668, 2484, 3045, 3073, 3074,
    3075, 3076,
] as const;
const GOBLIN_BONES_ONLY_NPC_TYPE_IDS = [
    2245, 2246, 2247, 2248, 2249, 2485, 2486, 2487, 2488, 2489, 3046,
] as const;

// Imp NPC type IDs (level 2)
const IMP_NPC_TYPE_IDS = [5007, 3134] as const;

// Scorpion NPC type IDs (level 14 + variants)
const SCORPION_NPC_TYPE_IDS = [3024, 5242, 2480, 2479] as const;

export const MANUAL_NPC_DROP_OVERRIDES: ManualNpcDropOverride[] = [
    // Imp drops (OSRS wiki)
    {
        npcTypeIds: [...IMP_NPC_TYPE_IDS],
        table: {
            always: [drop("Fiendish ashes", 1, "Always")],
            pools: [
                {
                    kind: "weighted",
                    category: "main",
                    entries: [
                        drop("Black bead", 1, "1/8"),
                        drop("Red bead", 1, "1/8"),
                        drop("White bead", 1, "1/8"),
                        drop("Yellow bead", 1, "1/8"),
                        drop("Mind talisman", 1, "1/42"),
                        drop("Coins", 6, "26/128"),
                        drop("Coins", 12, "7/128"),
                        drop("Earth rune", 6, "6/128"),
                        drop("Fire rune", 6, "6/128"),
                        drop("Body rune", 2, "5/128"),
                        drop("Mind rune", 9, "3/128"),
                        drop("Law rune", 1, "1/128"),
                        drop("Bread", 1, "8/128"),
                        drop("Ball of wool", 1, "1/128"),
                        drop("Burnt meat", 1, "7/128"),
                        drop("Chef's hat", 1, "1/128"),
                    ],
                },
                {
                    kind: "independent",
                    category: "tertiary",
                    entries: [
                        drop("Ensouled imp head", 1, "1/35"),
                        { itemName: "Clue scroll (easy)", quantity: 1, rarity: "1/128" },
                    ],
                },
            ],
        },
    },
    // Scorpion drops (OSRS - only drops bones, no other loot)
    {
        npcTypeIds: [...SCORPION_NPC_TYPE_IDS],
        table: alwaysTable(drop("Bones", 1, "Always")),
    },
    {
        npcTypeIds: [...GOBLIN_LEVEL_2_NPC_TYPE_IDS],
        table: {
            always: [drop("Bones", 1, "Always")],
            pools: [
                {
                    kind: "weighted",
                    category: "main",
                    entries: [
                        drop("Bronze sq shield", 1, "3/128"),
                        drop("Bronze spear", 1, "4/128"),
                        drop("Body rune", 7, "5/128"),
                        drop("Water rune", 6, "6/128"),
                        drop("Earth rune", 4, "3/128"),
                        drop("Bronze bolts", 8, "3/128"),
                        drop("Coins", 5, "28/128"),
                        drop("Coins", 9, "3/128"),
                        drop("Coins", 15, "3/128"),
                        drop("Coins", 20, "2/128"),
                        drop("Coins", 1, "1/128"),
                        drop("Hammer", 1, "15/128"),
                        drop("Goblin book", 1, "2/128"),
                        drop("Goblin mail", 1, "5/128"),
                        drop("Chef's hat", 1, "3/128"),
                        drop("Beer", 1, "2/128"),
                        drop("Brass necklace", 1, "1/128"),
                        drop("Air talisman", 1, "1/128"),
                    ],
                },
                {
                    kind: "independent",
                    category: "tertiary",
                    entries: [
                        drop("Ensouled goblin head", 1, "1/35"),
                        { itemName: "Clue scroll (beginner)", quantity: 1, rarity: "1/64" },
                        {
                            itemName: "Clue scroll (easy)",
                            quantity: 1,
                            rarity: "1/128",
                            altRarity: "1/64",
                            altCondition: {
                                wildernessOnly: true,
                                requiredAnyEquippedItemIds: [ITEM_RING_OF_WEALTH_I],
                            },
                        },
                        {
                            itemId: ITEM_GOBLIN_CHAMPION_SCROLL,
                            quantity: 1,
                            rarity: "1/5000",
                            condition: { minimumQuestPoints: 32 },
                        },
                    ],
                },
            ],
        },
    },
    {
        npcTypeIds: [...GOBLIN_LEVEL_5_NPC_TYPE_IDS],
        table: {
            always: [drop("Bones", 1, "Always")],
            pools: [
                {
                    kind: "weighted",
                    category: "main",
                    entries: [
                        drop("Bronze axe", 1, "3/128"),
                        drop("Bronze scimitar", 1, "1/128"),
                        drop("Bronze spear", 1, "9/128"),
                        drop("Bronze arrow", 7, "3/128"),
                        drop("Mind rune", 2, "3/128"),
                        drop("Earth rune", 4, "3/128"),
                        drop("Body rune", 2, "3/128"),
                        drop("Bronze javelin", 5, "2/128"),
                        drop("Chaos rune", 1, "1/128"),
                        drop("Nature rune", 1, "1/128"),
                        drop("Coins", 1, "34/128"),
                        drop("Coins", 3, "13/128"),
                        drop("Coins", 5, "8/128"),
                        drop("Coins", 16, "7/128"),
                        drop("Coins", 24, "3/128"),
                        drop("Hammer", 1, "9/128"),
                        drop("Goblin book", 1, "2/128"),
                        drop("Goblin mail", 1, "10/128"),
                        drop("Grapes", 1, "1/128"),
                        drop("Red cape", 1, "1/128"),
                        drop("Tin ore", 1, "1/128"),
                    ],
                },
                {
                    kind: "independent",
                    category: "tertiary",
                    entries: [
                        drop("Ensouled goblin head", 1, "1/30"),
                        { itemName: "Clue scroll (beginner)", quantity: 1, rarity: "1/80" },
                        {
                            itemName: "Clue scroll (easy)",
                            quantity: 1,
                            rarity: "1/128",
                            altRarity: "1/64",
                            altCondition: {
                                wildernessOnly: true,
                                requiredAnyEquippedItemIds: [ITEM_RING_OF_WEALTH_I],
                            },
                        },
                        {
                            itemId: ITEM_GOBLIN_CHAMPION_SCROLL,
                            quantity: 1,
                            rarity: "1/5000",
                            condition: { minimumQuestPoints: 32 },
                        },
                    ],
                },
            ],
        },
    },
    {
        npcTypeIds: [...GOBLIN_BONES_ONLY_NPC_TYPE_IDS],
        table: alwaysTable(drop("Bones", 1, "Always")),
    },
    {
        npcTypeIds: [178],
        table: alwaysTable(drop("Bones", 1, "Always")),
    },
    {
        npcTypeIds: [298],
        table: alwaysTable(drop("Bones", 1, "Always")),
    },
    {
        npcTypeIds: [2005],
        table: alwaysTable(drop("Vile ashes", 1, "Always")),
    },
    {
        npcTypeIds: [2025],
        table: alwaysTable(drop("Big bones", 1, "Always")),
    },
    {
        npcTypeIds: [2026],
        table: alwaysTable(drop("Vile ashes", 1, "Always")),
    },
    {
        npcTypeIds: [2028],
        table: alwaysTable(
            drop("Cowhide", 1, "Always"),
            drop("Raw beef", 1, "Always"),
            drop("Bones", 1, "Always"),
        ),
    },
    {
        npcTypeIds: [2048],
        table: alwaysTable(drop("Malicious ashes", 1, "Always")),
    },
    {
        npcTypeIds: [2054],
        table: alwaysTable(drop("Big bones", 1, "Always")),
    },
    {
        npcTypeIds: [2069],
        table: alwaysTable(drop("Big bones", 1, "Always")),
    },
    {
        npcTypeIds: [2090],
        table: alwaysTable(drop("Big bones", 1, "Always")),
    },
    {
        npcTypeIds: [2196],
        table: alwaysTable(drop("Big bones", 1, "Always"), drop("Feather", "1-16", "Always")),
    },
    {
        npcTypeIds: [2205],
        table: alwaysTable(drop("Bones", 1, "Always")),
    },
    {
        npcTypeIds: [2215],
        table: alwaysTable(drop("Big bones", 1, "Always")),
    },
    {
        npcTypeIds: [2265, 2266, 2267],
        table: alwaysTable(
            drop("Dagannoth bones", 1, "Always"),
            drop("Dagannoth hide", 1, "Always"),
        ),
    },
    {
        npcTypeIds: [2831],
        table: alwaysTable(drop("Bones", 1, "Always"), drop("Raw chicken", 1, "Always")),
    },
    {
        npcTypeIds: [3017],
        table: alwaysTable(drop("Big bones", 1, "Always")),
    },
    {
        npcTypeIds: [3029],
        table: alwaysTable(drop("Bones", 1, "Always")),
    },
    {
        npcTypeIds: [3106],
        table: alwaysTable(drop("Bones", 1, "Always")),
    },
    {
        npcTypeIds: [3108],
        table: alwaysTable(drop("Bones", 1, "Always")),
    },
    {
        npcTypeIds: [3129],
        table: alwaysTable(drop("Infernal ashes", 1, "Always")),
    },
    {
        npcTypeIds: [5862],
        table: alwaysTable(drop("Abyssal ashes", 1, "Always")),
    },
    {
        npcTypeIds: [5890],
        table: alwaysTable(drop("Abyssal ashes", 1, "Always")),
    },
    {
        npcTypeIds: [2042, 2043, 2044],
        table: {
            always: [drop("Zulrah's scales", "100-299", "Always")],
            pools: [
                {
                    kind: "weighted",
                    category: "main",
                    rolls: 2,
                    entries: [
                        drop("Tanzanite fang", 1, "1/1024", true),
                        drop("Magic fang", 1, "1/1024", true),
                        drop("Serpentine visage", 1, "1/1024", true),
                        drop("Uncut onyx", 1, "1/1024", true),
                        drop("Battlestaff", "10", "10/249"),
                        drop("Dragon med helm", 1, "2/249"),
                        drop("Dragon halberd", 1, "2/249"),
                        drop("Death rune", 250, "12/249"),
                        drop("Law rune", 200, "12/249"),
                        drop("Chaos rune", 400, "12/249"),
                        drop("Palm tree seed", 1, "6/249"),
                        drop("Papaya tree seed", 3, "6/249"),
                        drop("Calquat tree seed", 2, "6/249"),
                        drop("Magic seed", 1, "4/249"),
                        drop("Toadflax seed", 2, "2/249"),
                        drop("Snapdragon seed", 1, "2/249"),
                        drop("Dwarf weed seed", 2, "2/249"),
                        drop("Torstol seed", 1, "2/249"),
                        drop("Spirit seed", 1, "1/249"),
                        drop("Snakeskin", "35", "11/249"),
                        drop("Runite ore", "2", "11/249"),
                        drop("Pure essence", "1500", "10/249"),
                        drop("Yew logs", "35", "10/249"),
                        drop("Adamantite bar", "20", "8/249"),
                        drop("Coal", "200", "8/249"),
                        drop("Dragon bones", "12", "8/249"),
                        drop("Mahogany logs", "50", "8/249"),
                        drop("Raw shark", "35", "4.5/249"),
                        drop("Manta ray", "35", "3/249"),
                        drop("Zul-andra teleport", 4, "15/249"),
                        drop("Antidote++(4)", 10, "9/249"),
                        drop("Dragon bolt tips", 12, "8/249"),
                        drop("Grapes", 250, "6/249"),
                        drop("Coconut", 20, "6/249"),
                        drop("Swamp tar", 1000, "5/249"),
                        drop("Zulrah's scales", 500, "5/249"),
                    ],
                },
                {
                    kind: "independent",
                    category: "tertiary",
                    entries: [
                        drop("Clue scroll (elite)", 1, "1/75"),
                        drop("Jar of swamp", 1, "1/3000"),
                        drop("Pet snakeling", 1, "1/4000"),
                    ],
                },
            ],
        },
    },
    {
        npcTypeIds: [7937],
        table: {
            always: [
                drop("Superior dragon bones", 2, "Always"),
                drop("Blue dragonhide", 2, "Always"),
            ],
            pools: [
                {
                    kind: "weighted",
                    category: "main",
                    rolls: 2,
                    entries: [
                        drop("Rune longsword", "2-3", "5/150"),
                        drop("Rune kiteshield", "2-3", "5/150"),
                        drop("Battlestaff", "5-15", "4/150"),
                        drop("Dragon battleaxe", 1, "2/150"),
                        drop("Dragon longsword", 1, "2/150"),
                        drop("Dragon platelegs", 1, "2/150"),
                        drop("Dragon plateskirt", 1, "2/150"),
                        drop("Chaos rune", "250-350", "6/150"),
                        drop("Death rune", "200-300", "6/150"),
                        drop("Wrath rune", "30-60", "3/150"),
                        drop("Blue dragonhide", "25-30", "8/150"),
                        drop("Green dragonhide", "25-30", "7/150"),
                        drop("Red dragonhide", "20-25", "7/150"),
                        drop("Black dragonhide", "15-25", "7/150"),
                        drop("Dragon bolts (unf)", "50-100", "8/150"),
                        drop("Dragon bolt tips", "11-25", "5/150"),
                        drop("Onyx bolt tips", "5-10", "4/150"),
                        drop("Rune dart tip", "75-100", "3/150"),
                        drop("Dragon dart tip", "10-50", "6/150"),
                        drop("Dragon arrowtips", "25-50", "3/150"),
                        drop("Diamond bolt tips", "25-30", "25/2730"),
                        drop("Emerald bolt tips", "25-30", "20/2730"),
                        drop("Ruby bolt tips", "25-30", "20/2730"),
                        drop("Dragon bolt tips", "25-30", "14/2730"),
                        drop("Onyx bolt tips", "25-30", "7/2730"),
                        drop("Sapphire bolt tips", "25-30", "5/2730"),
                        drop("Raw shark", "35-55", "3/300"),
                        drop("Manta ray", "35-55", "2/300"),
                        drop("Adamantite ore", "10-30", "7/150"),
                        drop("Coins", "20000-80000", "5/150"),
                        drop("Grapes", "250-300", "5/150"),
                        drop("Magic logs", 50, "5/150"),
                        drop("Dragon bones", "15-20", "4/150"),
                        drop("Diamond", "10-20", "4/150"),
                        drop("Dragonstone", "2-3", "3/150"),
                        drop("Wrath talisman", 1, "3/150"),
                    ],
                },
                {
                    kind: "independent",
                    category: "tertiary",
                    entries: [
                        drop("Vorkath's head", 1, "1/50"),
                        drop("Clue scroll (elite)", 1, "1/65"),
                        drop("Dragonbone necklace", 1, "1/1000", true),
                        drop("Jar of decay", 1, "1/3000"),
                        drop("Vorki", 1, "1/3000"),
                        drop("Draconic visage", 1, "1/5000", true),
                        drop("Skeletal visage", 1, "1/5000", true),
                    ],
                },
            ],
        },
    },
    {
        npcTypeIds: [494],
        table: {
            pools: [
                {
                    kind: "weighted",
                    category: "main",
                    entries: [
                        drop("Mystic water staff", 1, "3/128"),
                        drop("Rune warhammer", 1, "2/128"),
                        drop("Rune longsword", 1, "2/128"),
                        drop("Mystic robe top", 1, "1/128"),
                        drop("Mystic robe bottom", 1, "1/128"),
                        drop("Trident of the seas (full)", 1, "1/512", true),
                        drop("Water rune", 400, "10/128"),
                        drop("Mist rune", 100, "4/128"),
                        drop("Chaos rune", 200, "10/128"),
                        drop("Death rune", 150, "10/128"),
                        drop("Blood rune", 60, "10/128"),
                        drop("Soul rune", 50, "7/128"),
                        drop("Watermelon seed", 24, "3/128"),
                        drop("Torstol seed", 2, "1/128"),
                        drop("Magic seed", 1, "1/128"),
                        drop("Seaweed", 125, "3/128"),
                        drop("Battlestaff", 10, "4/128"),
                        drop("Unpowered orb", 50, "2/128"),
                        drop("Diamond", 8, "1/128"),
                        drop("Oak plank", 60, "3/128"),
                        drop("Runite bar", 2, "1/128"),
                        drop("Raw shark", 50, "2/128"),
                        drop("Raw monkfish", 100, "2/128"),
                        drop("Grimy snapdragon", 6, "2/128"),
                        drop("Coins", "10000-19999", "15/128"),
                        drop("Shark", 5, "7/128"),
                        drop("Pirate boots", 1, "4/128"),
                        drop("Sanfew serum(4)", 2, "4/128"),
                        drop("Edible seaweed", 5, "3/128"),
                        drop("Harpoon", 1, "1/128"),
                        drop("Bucket", 1, "1/128"),
                        drop("Crystal key", 1, "1/128"),
                        drop("Rusty sword", 1, "1.75/128"),
                        drop("Antidote++(4)", 2, "2/128"),
                        drop("Dragonstone ring", 1, "1/128"),
                        drop("Kraken tentacle", 1, "1/400", true),
                    ],
                },
                {
                    kind: "independent",
                    category: "tertiary",
                    entries: [
                        drop("Clue scroll (elite)", 1, "1/500"),
                        drop("Jar of dirt", 1, "1/1000"),
                        drop("Pet kraken", 1, "1/3000"),
                    ],
                },
            ],
        },
    },
    {
        npcTypeIds: [5886],
        table: {
            always: [drop("Infernal ashes", 1, "Always")],
            pools: [
                {
                    kind: "weighted",
                    category: "main",
                    entries: [
                        drop("Primordial crystal", 1, "1/520", true),
                        drop("Pegasian crystal", 1, "1/520", true),
                        drop("Eternal crystal", 1, "1/520", true),
                        drop("Smouldering stone", 1, "1/520", true),
                        drop("Rune platebody", 1, "5/130"),
                        drop("Rune chainbody", 1, "4/130"),
                        drop("Rune 2h sword", 1, "4/130"),
                        drop("Black d'hide body", 1, "3/130"),
                        drop("Rune axe", 1, "3/130"),
                        drop("Rune pickaxe", 1, "3/130"),
                        drop("Battlestaff", 6, "3/130"),
                        drop("Rune full helm", 1, "3/130"),
                        drop("Lava battlestaff", 1, "2/130"),
                        drop("Rune halberd", 1, "2/130"),
                        drop("Fire rune", 300, "6/130"),
                        drop("Soul rune", 100, "6/130"),
                        drop("Pure essence", 300, "5/130"),
                        drop("Blood rune", 60, "4/130"),
                        drop("Cannonball", 50, "4/130"),
                        drop("Runite bolts (unf)", 40, "4/130"),
                        drop("Death rune", 100, "3/130"),
                        drop("Coal", 120, "6/130"),
                        drop("Super restore(4)", 2, "6/130"),
                        drop("Summer pie", 3, "6/130"),
                        drop("Coins", "10000-20000", "5/130"),
                        drop("Dragon bones", 20, "5/130"),
                        drop("Unholy symbol", 1, "5/130"),
                        drop("Wine of zamorak", 15, "5/130"),
                        drop("Ashes", 50, "4/130"),
                        drop("Fire orb", 20, "4/130"),
                        drop("Grimy torstol", 6, "4/130"),
                        drop("Runite ore", 5, "3/130"),
                        drop("Uncut diamond", 5, "3/130"),
                        drop("Torstol seed", 3, "2/130"),
                        drop("Ranarr seed", 2, "2/130"),
                        drop("Key master teleport", 7, "2/130"),
                    ],
                },
                {
                    kind: "independent",
                    category: "tertiary",
                    entries: [
                        drop("Clue scroll (elite)", 1, "1/100"),
                        drop("Jar of souls", 1, "1/2000"),
                        drop("Hellpuppy", 1, "1/3000"),
                    ],
                },
            ],
        },
    },
    {
        npcTypeIds: [239],
        table: {
            always: [drop("Dragon bones", 1, "Always"), drop("Black dragonhide", 2, "Always")],
            pools: [
                {
                    kind: "independent",
                    category: "main",
                    entries: [drop("Dragon pickaxe", 1, "1/1000", true)],
                },
                {
                    kind: "weighted",
                    category: "main",
                    entries: [
                        drop("Rune longsword", 1, "10/128"),
                        drop("Adamant platebody", 1, "9/128"),
                        drop("Adamant kiteshield", 1, "3/128"),
                        drop("Dragon med helm", 1, "1/128"),
                        drop("Fire rune", 300, "5/128"),
                        drop("Air rune", 300, "10/128"),
                        drop("Iron arrow", 690, "10/128"),
                        drop("Runite bolts", "10-20", "10/128"),
                        drop("Law rune", 30, "5/128"),
                        drop("Blood rune", 30, "5/128"),
                        drop("Yew logs", 150, "10/128"),
                        drop("Adamantite bar", 3, "5/128"),
                        drop("Runite bar", 1, "3/128"),
                        drop("Gold ore", 100, "2/128"),
                        drop("Amulet of power", 1, "7/128"),
                        drop("Dragon arrowtips", "5-14", "5/128"),
                        drop("Dragon dart tip", "5-14", "5/128"),
                        drop("Dragon javelin heads", 15, "5/128"),
                        drop("Runite limbs", 1, "4/128"),
                        drop("Shark", 4, "4/128"),
                    ],
                },
                {
                    kind: "independent",
                    category: "tertiary",
                    entries: [
                        drop("Kbd heads", 1, "1/128"),
                        drop("Clue scroll (elite)", 1, "1/450"),
                        drop("Prince black dragon", 1, "1/3000"),
                        drop("Draconic visage", 1, "1/5000", true),
                    ],
                },
            ],
        },
    },
    {
        npcTypeIds: [319],
        table: {
            pools: [
                {
                    kind: "independent",
                    category: "main",
                    entries: [
                        drop("Arcane sigil", 1, "1/1365", true),
                        drop("Spectral sigil", 1, "1/1365", true),
                        drop("Elysian sigil", 1, "1/4095", true),
                    ],
                },
                {
                    kind: "weighted",
                    category: "main",
                    entries: [
                        drop("Mystic robe top", 1, "18/512"),
                        drop("Mystic robe bottom", 1, "18/512"),
                        drop("Mystic air staff", 1, "12/512"),
                        drop("Mystic water staff", 1, "12/512"),
                        drop("Mystic earth staff", 1, "12/512"),
                        drop("Mystic fire staff", 1, "12/512"),
                        drop("Spirit shield", 1, "8/512"),
                        drop("Soul rune", 250, "32/512"),
                        drop("Runite bolts", 250, "24/512"),
                        drop("Death rune", 300, "22/512"),
                        drop("Onyx bolts (e)", 175, "20/512"),
                        drop("Cannonball", 2000, "17/512"),
                        drop("Adamant arrow", 750, "17/512"),
                        drop("Law rune", 250, "17/512"),
                        drop("Cosmic rune", 500, "17/512"),
                        drop("Raw shark", 70, "21/512"),
                        drop("Pure essence", 2500, "21/512"),
                        drop("Adamantite bar", 35, "18/512"),
                        drop("Green dragonhide", 100, "18/512"),
                        drop("Adamantite ore", 125, "17/512"),
                        drop("Runite ore", 20, "12/512"),
                        drop("Teak plank", 100, "12/512"),
                        drop("Mahogany logs", 150, "12/512"),
                        drop("Magic logs", 75, "12/512"),
                        drop("Tuna potato", 30, "20/512"),
                        drop("White berries", 120, "17/512"),
                        drop("Desert goat horn", 120, "17/512"),
                        drop("Watermelon seed", 24, "15/512"),
                        drop("Coins", "20000-50000", "12/512"),
                        drop("Antidote++(4)", 40, "10/512"),
                        drop("Ranarr seed", 10, "5/512"),
                        drop("Holy elixir", 1, "3/512", true),
                    ],
                },
                {
                    kind: "independent",
                    category: "tertiary",
                    entries: [
                        drop("Clue scroll (elite)", 1, "1/200"),
                        drop("Jar of spirits", 1, "1/1000"),
                        drop("Pet dark core", 1, "1/5000"),
                    ],
                },
            ],
        },
    },
    // Lava Dragon drops (OSRS wiki - NPC 6593, combat 252)
    {
        npcTypeIds: [6593],
        table: {
            always: [
                drop("Lava dragon bones", 1, "Always"),
                drop("Black dragonhide", 1, "Always"),
                drop("Lava scale", 1, "Always"),
            ],
            pools: [
                {
                    kind: "weighted",
                    category: "weapons_armour",
                    entries: [
                        drop("Rune dart", 12, "6/128"),
                        drop("Rune knife", 8, "4/128"),
                        drop("Lava battlestaff", 1, "3/128"),
                        drop("Adamant 2h sword", 1, "2/128"),
                        drop("Adamant platebody", 1, "2/128"),
                        drop("Rune axe", 1, "2/128"),
                        drop("Rune kiteshield", 1, "2/128"),
                        drop("Rune longsword", 1, "2/128"),
                        drop("Rune med helm", 1, "1/128"),
                        drop("Rune full helm", 1, "1/128"),
                    ],
                },
                {
                    kind: "weighted",
                    category: "runes_ammo",
                    entries: [
                        drop("Rune javelin", 20, "10/128"),
                        drop("Fire rune", 75, "7/128"),
                        drop("Blood rune", 20, "7/128"),
                        drop("Runite bolts", 30, "6/128"),
                        drop("Death rune", 20, "5/128"),
                        drop("Law rune", 20, "5/128"),
                        drop("Lava rune", 15, "4/128"),
                        drop("Lava rune", 30, "4/128"),
                    ],
                },
                {
                    kind: "weighted",
                    category: "coins",
                    entries: [
                        drop("Coins", 66, "15/128"),
                        drop("Coins", 690, "1/128"),
                    ],
                },
                {
                    kind: "weighted",
                    category: "other",
                    entries: [
                        drop("Fire talisman", 1, "1/128"),
                        drop("Fire orb", 15, "5/128"),
                        drop("Chocolate cake", 3, "3/128"),
                        drop("Adamantite bar", 2, "5/128"),
                        drop("Onyx bolt tips", 12, "5/128"),
                        drop("Dragon javelin heads", 15, "7/128"),
                    ],
                },
                {
                    kind: "independent",
                    category: "tertiary",
                    entries: [
                        drop("Ensouled dragon head", 1, "1/18"),
                        drop("Draconic visage", 1, "1/10000"),
                        { itemName: "Clue scroll (elite)", quantity: 1, rarity: "1/250" },
                    ],
                },
            ],
        },
    },
];
