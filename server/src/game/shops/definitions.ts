import { type ShopDefinition } from "./types";

const VARROCK_GENERAL_STORE: ShopDefinition = {
    id: "varrock_general_store",
    name: "Varrock General Store",
    npcIds: [2815, 2816],
    currencyItemId: 995,
    capacity: 40,
    generalStore: true,
    restockTicks: 40,
    buyPriceMultiplier: 1,
    sellPriceMultiplier: 0.4,
    stock: [
        { itemId: 1931, quantity: 10 }, // Pot
        { itemId: 1935, quantity: 10 }, // Jug
        { itemId: 1925, quantity: 10 }, // Bucket
        { itemId: 1735, quantity: 5 }, // Shears
        { itemId: 1887, quantity: 2 }, // Cake tin
        { itemId: 590, quantity: 5 }, // Tinderbox
        { itemId: 2347, quantity: 2 }, // Hammer
        { itemId: 1755, quantity: 2 }, // Chisel
        { itemId: 1265, quantity: 2 }, // Bronze pickaxe
        { itemId: 1351, quantity: 2 }, // Bronze axe
        { itemId: 1205, quantity: 5 }, // Bronze dagger
        { itemId: 1277, quantity: 2 }, // Bronze sword
        { itemId: 1321, quantity: 2 }, // Bronze scimitar
        { itemId: 1103, quantity: 2 }, // Bronze chainbody
        { itemId: 1139, quantity: 2 }, // Bronze med helm
        { itemId: 1173, quantity: 2 }, // Iron sq shield (close enough for starter gear)
        { itemId: 841, quantity: 2 }, // Shortbow
        { itemId: 882, quantity: 150 }, // Bronze arrow
    ],
};

const TEST_WEAPONS_SHOP: ShopDefinition = {
    id: "test_weapons_shop",
    name: "Test Weapons Shop",
    npcIds: [3200],
    currencyItemId: 995,
    capacity: 60,
    generalStore: false,
    restockTicks: 1,
    buyPriceMultiplier: 0,
    sellPriceMultiplier: 0,
    stock: [
        // Melee weapons
        { itemId: 4151, quantity: 100, price: 0 }, // Abyssal whip
        { itemId: 4587, quantity: 100, price: 0 }, // Dragon scimitar
        { itemId: 1305, quantity: 100, price: 0 }, // Dragon longsword
        { itemId: 5698, quantity: 100, price: 0 }, // Dragon dagger (p++)
        { itemId: 11802, quantity: 100, price: 0 }, // Armadyl godsword
        { itemId: 11804, quantity: 100, price: 0 }, // Bandos godsword
        { itemId: 11806, quantity: 100, price: 0 }, // Saradomin godsword
        { itemId: 11808, quantity: 100, price: 0 }, // Zamorak godsword
        { itemId: 13652, quantity: 100, price: 0 }, // Dragon claws
        { itemId: 13576, quantity: 100, price: 0 }, // Dragon warhammer
        { itemId: 21003, quantity: 100, price: 0 }, // Elder maul
        { itemId: 22324, quantity: 100, price: 0 }, // Ghrazi rapier
        { itemId: 24417, quantity: 100, price: 0 }, // Inquisitor's mace
        { itemId: 22325, quantity: 100, price: 0 }, // Scythe of vitur
        { itemId: 25867, quantity: 100, price: 0 }, // Blade of saeldor
        { itemId: 1434, quantity: 100, price: 0 }, // Dragon mace
        { itemId: 4718, quantity: 100, price: 0 }, // Dharok's greataxe
        { itemId: 4726, quantity: 100, price: 0 }, // Guthan's warspear
        { itemId: 4747, quantity: 100, price: 0 }, // Torag's hammers
        { itemId: 4755, quantity: 100, price: 0 }, // Verac's flail
        // Ranged weapons
        { itemId: 11785, quantity: 100, price: 0 }, // Armadyl crossbow
        { itemId: 20997, quantity: 100, price: 0 }, // Twisted bow
        { itemId: 25862, quantity: 100, price: 0 }, // Bow of faerdhinen
        { itemId: 12926, quantity: 100, price: 0 }, // Toxic blowpipe
        { itemId: 861, quantity: 100, price: 0 }, // Magic shortbow
        { itemId: 4212, quantity: 100, price: 0 }, // Crystal bow
        { itemId: 9185, quantity: 100, price: 0 }, // Rune crossbow
        { itemId: 11235, quantity: 100, price: 0 }, // Dark bow
        { itemId: 19481, quantity: 100, price: 0 }, // Heavy ballista
        { itemId: 19478, quantity: 100, price: 0 }, // Light ballista
        // Magic weapons
        { itemId: 11791, quantity: 100, price: 0 }, // Staff of the dead
        { itemId: 11905, quantity: 100, price: 0 }, // Trident of the seas
        { itemId: 12899, quantity: 100, price: 0 }, // Trident of the swamp
        { itemId: 21006, quantity: 100, price: 0 }, // Kodai wand
        { itemId: 24422, quantity: 100, price: 0 }, // Eldritch nightmare staff
        { itemId: 24423, quantity: 100, price: 0 }, // Harmonised nightmare staff
        { itemId: 24424, quantity: 100, price: 0 }, // Volatile nightmare staff
        { itemId: 22647, quantity: 100, price: 0 }, // Sanguinesti staff
        { itemId: 4675, quantity: 100, price: 0 }, // Ancient staff
        { itemId: 6914, quantity: 100, price: 0 }, // Master wand
        // Ammo
        { itemId: 11212, quantity: 10000, price: 0 }, // Dragon arrow
        { itemId: 9244, quantity: 10000, price: 0 }, // Dragon bolts (e)
        { itemId: 892, quantity: 10000, price: 0 }, // Rune arrow
        { itemId: 9245, quantity: 10000, price: 0 }, // Onyx bolts (e)
        { itemId: 21326, quantity: 10000, price: 0 }, // Dragon javelin
    ],
};

const AUBURY_RUNE_SHOP: ShopDefinition = {
    id: "aubury_rune_shop",
    name: "Aubury's Rune Shop",
    npcIds: [2886, 11434],
    currencyItemId: 995,
    capacity: 40,
    generalStore: false,
    restockTicks: 40,
    buyPriceMultiplier: 1,
    sellPriceMultiplier: 0.6,
    stock: [
        { itemId: 556, quantity: 5000, price: 4, restockTicks: 10 }, // Air rune
        { itemId: 554, quantity: 5000, price: 4, restockTicks: 10 }, // Fire rune
        { itemId: 555, quantity: 5000, price: 4, restockTicks: 10 }, // Water rune
        { itemId: 557, quantity: 5000, price: 4, restockTicks: 10 }, // Earth rune
        { itemId: 558, quantity: 5000, price: 3, restockTicks: 10 }, // Mind rune
        { itemId: 559, quantity: 5000, price: 5, restockTicks: 10 }, // Body rune
        { itemId: 562, quantity: 250, price: 90, restockTicks: 10 }, // Chaos rune
        { itemId: 560, quantity: 250, price: 180, restockTicks: 15 }, // Death rune
        { itemId: 12734, quantity: 80, price: 430, restockTicks: 10 }, // Fire rune pack
        { itemId: 12730, quantity: 80, price: 430, restockTicks: 10 }, // Water rune pack
        { itemId: 12728, quantity: 80, price: 430, restockTicks: 10 }, // Air rune pack
        { itemId: 12732, quantity: 80, price: 430, restockTicks: 10 }, // Earth rune pack
        { itemId: 12736, quantity: 40, price: 330, restockTicks: 10 }, // Mind rune pack
        { itemId: 12738, quantity: 35, price: 9950, restockTicks: 10 }, // Chaos rune pack
    ],
};

const CATHERBY_RANGE_SHOP: ShopDefinition = {
    id: "catherby_range_shop",
    name: "Hickton's Archery Emporium",
    npcIds: [3212],
    currencyItemId: 995,
    capacity: 40,
    generalStore: false,
    restockTicks: 40,
    buyPriceMultiplier: 1,
    sellPriceMultiplier: 0.45,
    stock: [
        // Bows
        { itemId: 841, quantity: 10, price: 50 }, // Shortbow
        { itemId: 839, quantity: 10, price: 80 }, // Longbow
        { itemId: 843, quantity: 10, price: 100 }, // Oak shortbow
        { itemId: 845, quantity: 10, price: 160 }, // Oak longbow
        { itemId: 849, quantity: 10, price: 200 }, // Willow shortbow
        { itemId: 847, quantity: 10, price: 320 }, // Willow longbow
        { itemId: 853, quantity: 10, price: 400 }, // Maple shortbow
        { itemId: 851, quantity: 10, price: 640 }, // Maple longbow
        { itemId: 857, quantity: 10, price: 800 }, // Yew shortbow
        { itemId: 855, quantity: 10, price: 1280 }, // Yew longbow
        { itemId: 861, quantity: 10, price: 1600 }, // Magic shortbow
        { itemId: 859, quantity: 10, price: 2560 }, // Magic longbow
        { itemId: 11235, quantity: 5, price: 0 }, // Dark bow (free for testing)
        // Crossbows
        { itemId: 9174, quantity: 10, price: 100 }, // Bronze crossbow
        { itemId: 9177, quantity: 10, price: 200 }, // Iron crossbow
        { itemId: 9179, quantity: 10, price: 400 }, // Steel crossbow
        { itemId: 9181, quantity: 10, price: 800 }, // Mithril crossbow
        { itemId: 9183, quantity: 10, price: 1600 }, // Adamant crossbow
        { itemId: 9185, quantity: 10, price: 3200 }, // Rune crossbow
        // Arrows
        { itemId: 882, quantity: 1000, price: 3 }, // Bronze arrow
        { itemId: 884, quantity: 1000, price: 6 }, // Iron arrow
        { itemId: 886, quantity: 1000, price: 12 }, // Steel arrow
        { itemId: 888, quantity: 1000, price: 24 }, // Mithril arrow
        { itemId: 890, quantity: 1000, price: 48 }, // Adamant arrow
        { itemId: 892, quantity: 1000, price: 96 }, // Rune arrow
        { itemId: 11212, quantity: 1000, price: 0 }, // Dragon arrow (free for testing)
        // Bolts
        { itemId: 877, quantity: 1000, price: 5 }, // Bronze bolts
        { itemId: 9140, quantity: 1000, price: 10 }, // Iron bolts
        { itemId: 9141, quantity: 1000, price: 20 }, // Steel bolts
        { itemId: 9142, quantity: 1000, price: 40 }, // Mithril bolts
        { itemId: 9143, quantity: 1000, price: 80 }, // Adamant bolts
        { itemId: 9144, quantity: 1000, price: 160 }, // Runite bolts
        { itemId: 21905, quantity: 1000, price: 0 }, // Dragon bolts (free for testing)
        // Ranged armor
        { itemId: 1129, quantity: 5, price: 100 }, // Leather body
        { itemId: 1095, quantity: 5, price: 50 }, // Leather chaps
        { itemId: 1167, quantity: 5, price: 30 }, // Leather vambraces
        { itemId: 1169, quantity: 5, price: 40 }, // Leather coif
        // Ava's devices (free for testing ammo retrieval)
        { itemId: 10498, quantity: 5, price: 0 }, // Ava's attractor
        { itemId: 10499, quantity: 5, price: 0 }, // Ava's accumulator
        { itemId: 22109, quantity: 5, price: 0 }, // Ava's assembler
    ],
};

const ZAFFS_SUPERIOR_STAFFS: ShopDefinition = {
    id: "zaffs_superior_staffs",
    name: "Zaff's Superior Staffs!",
    npcIds: [2880],
    currencyItemId: 995,
    capacity: 40,
    generalStore: false,
    restockTicks: 100,
    buyPriceMultiplier: 1,
    sellPriceMultiplier: 0.55,
    stock: [
        { itemId: 1391, quantity: 5, price: 7000, restockTicks: 100 },   // Battlestaff
        { itemId: 1379, quantity: 5, price: 15, restockTicks: 100 },     // Staff
        { itemId: 1389, quantity: 5, price: 200, restockTicks: 200 },    // Magic staff
        { itemId: 1381, quantity: 2, price: 1500, restockTicks: 1000 },  // Staff of air
        { itemId: 1383, quantity: 2, price: 1500, restockTicks: 1000 },  // Staff of water
        { itemId: 1385, quantity: 2, price: 1500, restockTicks: 1000 },  // Staff of earth
        { itemId: 1387, quantity: 2, price: 1500, restockTicks: 1000 },  // Staff of fire
    ],
};

const SHOP_DEFINITIONS: ShopDefinition[] = [
    VARROCK_GENERAL_STORE,
    TEST_WEAPONS_SHOP,
    AUBURY_RUNE_SHOP,
    CATHERBY_RANGE_SHOP,
    ZAFFS_SUPERIOR_STAFFS,
];

export function getShopDefinitionById(id: string): ShopDefinition | undefined {
    return SHOP_DEFINITIONS.find((shop) => shop.id === id);
}

export function getShopDefinitionByNpcId(npcId: number): ShopDefinition | undefined {
    const normalized = npcId;
    return SHOP_DEFINITIONS.find((shop) => shop.npcIds?.some((id) => id === normalized));
}

export function getAllShopDefinitions(): ShopDefinition[] {
    return SHOP_DEFINITIONS.slice();
}
