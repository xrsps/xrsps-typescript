import type {
    LeagueMasteryChallengeRow,
    LeagueMasteryNodeRow,
    LeagueRelicRow,
} from "../../../../src/shared/gamemode/GamemodeDataTypes";

// Generated snapshot of cache league data.
// Source of truth: caches/ (r235)

// League 5 Relics (structs 1116-1135 and 6260-6264, param_879=name, param_880=desc)
export const LEAGUE_RELICS: LeagueRelicRow[] = [
    {
        structId: 1116,
        name: "Production Prodigy",
        description:
            "- When doing the following activities, all items are processed at once:<br><br>- Smelting ores, Smithing bars (does not work with the Superheat item spell) and making Cannonballs.<br><br>- Fletching logs, stringing Bows and cutting bolt tips.<br><br>- Making headless arrows, regular arrows, bolts, darts, and javelins (capped at 10x the regular amount per action).<br><br>- Cleaning herbs and making Potions which do not have a stackable secondary ingredient.<br><br>- Cooking food and making Jugs of Wine.<br><br>- Crafting leather, uncut gems, glassblowing, jewellery, pottery, Battlestaves and spinning flax or wool.<br><br>- Full XP is given for items processed using this Relic.<br><br>- There is a 25% chance that you will make an extra product, which will be sent to your Bank if you have space. The additional product will also grant XP.<br><br>- Additionally Crafting, Smithing, Herblore, Fletching and Cooking are boosted by +12.",
        hasItem: false,
    },
    {
        structId: 1117,
        name: "Power Miner",
        description:
            "- This pickaxe will act as a non-degradable variant of the crystal equivalent with no requirements.<br><br>- When this item is in your inventory or equipped, you gain the following perks:<br><br>- On failing to mine a rock, you will have a separate 50% chance to succeed.<br><br>- Items gathered from Mining are automatically sent to your Bank.<br><br>- The Echo Pickaxe will cause the rock to not deplete until you have mined 4 ore.<br><br>- This buff does stack with the existing Mining Gloves, with a cap of 7 ores from a given node.<br><br>You will be able to toggle the following effects on or off for the Pickaxe:<br><br>- Collected ores are automatically smelted and grant Smithing XP (regardless of your smithing level).<br><br>- Gems gathered from Mining are automatically cut and grant Crafting XP regardless of your Crafting level.",
        hasItem: true,
    },
    {
        structId: 1118,
        name: "Animal Wrangler",
        description:
            "- This harpoon will act as a non-degradable variant of the crystal equivalent with no requirements.<br><br>- When this item is in your inventory or equipped, you gain the following perks:<br><br>- On failing to fish a spot, you will have a separate 50% chance to succeed.<br><br>- Items gathered from Fishing are automatically sent to your Bank.<br><br>- Fish caught have a 50% chance to be automatically cooked, granting Cooking experience regardless of level requirements.<br><br>- Attempt to catch fish 1 tick faster.<br><br>- It will also work for fish that don't require a harpoon to be caught, and your harpoon can be substituted as a Net, Big Net, Lobster Pot, or any Rod whilst Fishing.<br><br>Alongside the Echo harpoon effects you will get the following perks to <col=ffffff>Hunter</col>:<br><br>- Hunter catching will never fail.<br><br>- Box traps catch chinchompas faster.<br><br>- Chinchompas are doubled when caught, also giving double XP.<br><br>- Impling jars no longer break upon opening them.<br><br>Lastly, you never burn food when Cooking.",
        hasItem: true,
    },
    {
        structId: 1119,
        name: "Lumberjack",
        description:
            "- This axe will act as a non-degradable variant of the crystal equivalent with no requirements.<br><br>- When this item is in your inventory or equipped, you gain the following perks:<br><br>- On failing to chop a tree, you will have a separate 50% chance to succeed.<br><br>- Items gathered from Woodcutting are automatically sent to your Bank.<br><br>You will be able to toggle the following effects on or off for the Axe:<br><br>- Automatically burning logs for Firemaking XP (regardless of your Firemaking level).<br><br>- Automatically Fletching logs into arrowshafts for Fletching XP (regardless of your Fletching level).<br><br>Additionally, you gain the following perks to <col=ffffff>Firemaking</col>:<br><br>- Never fail to make fires with any logs at any Firemaking level.",
        hasItem: true,
    },
    {
        structId: 1120,
        name: "Clue Compass",
        description:
            "- This item will allow you to <col=ffffff>Teleport</col> to any S.T.A.S.H unit and Falo the Bard (Respecting area unlocks).<br><br>- It has the ability to teleport you to your current clue step, if you have one. Note - this will not work on clue steps that require you to kill a certain NPC.<br><br>- This item ignores wilderness teleport restrictions.<br><br>- This item cannot be used to teleport to an area you haven't unlocked.",
        hasItem: true,
    },
    {
        structId: 1121,
        name: "Bank Heist",
        description:
            "- This item will allow you to <col=ffffff>Teleport</col> to any deposit box, bank, or bank chest.<br><br>- This item ignores wilderness teleport restrictions.<br><br>- This item cannot be used to teleport to an area you haven't unlocked.",
        hasItem: true,
    },
    {
        structId: 1123,
        name: "Corner Cutter",
        description:
            "- While equipped, Sage's Greaves will grant Agility XP based on your Agility level while you run.<br><br>- Completing an Agility course grants two completion count and 25% bonus XP.<br><br>- 100% success rate on all Agility checks.<br><br>- Marks of Grace will also spawn with 10,000 coins.<br><br>- Double Quantity of Pyramid Tops, Hallowed Marks and Agility Vouchers, and Crystal shards (from agility).",
        hasItem: true,
    },
    {
        structId: 1124,
        name: "Friendly Forager",
        description:
            "- This item will provide the following perks whilst in your inventory or equipped:<br><br>- When you gather resources from Woodcutting, Fishing, Mining and Hunting, the Forager's Pouch will find and store a random grimy herb, limited to herbs your herblore level + 25 can clean, whilst also providing a small amount of token XP when one is found.<br><br>- The Forager's Pouch will only find herbs it has room to store, but will always attempt to give you a herb you can receive.<br><br>- The Forager's Pouch works just like a Herb Sack, and shares an inventory with it.<br><br>Additionally, you gain the following perks to <col=ffffff>Herblore</col> when crafting potions:<br><br>- Secondary ingredients have a 90% chance to not be consumed. This stacks additively with other sources.<br><br>- Created potions contain 4 doses instead of 3.",
        hasItem: true,
    },
    {
        structId: 1125,
        name: "Dodgy Deals",
        description:
            "You gain the following perks to <col=ffffff>Thieving</col>:<br><br>- Pickpocketing an NPC will also pickpocket all NPCs of similar type in a 11x11 square, granting extra loot for each NPC pickpocketed.<br><br>- 100% success rate on all Thieving checks.<br><br> - Automatically re-pickpocket an NPC or stall until you can no longer do so.<br><br>- Items obtained from pickpocketing are noted.<br><br>- Maximum coin pouch count increased by 3x.<br><br>- Stalls do not deplete when you steal from them.",
        hasItem: false,
    },
    {
        structId: 1126,
        name: "Pocket Kingdom",
        description:
            "- This item allows full access to the Managing Miscellania feature from anywhere.<br><br>- Workers will work for 50% less coins, always have max appeal, produce twice as many resources, and accrue resources every hour instead of every day.",
        hasItem: true,
    },
    {
        structId: 1127,
        name: "Reloaded",
        description: "Choose another Relic from any tier below this one.",
        hasItem: false,
    },
    {
        structId: 1128,
        name: "Treasure Arbiter",
        description:
            "You gain the following perks when <col=ffffff>Clue Hunting</col>:<br><br>- Sources of clues are now a 1/15 chance.<br><br>- Clue Geodes, Clue Nests and Clue Bottles are found 10x more often.<br><br>- All Clue Scrolls have the lowest number of steps possible for their tier.<br><br>- Emote, Falo and Charlie Clue steps no longer have item requirements.<br><br>- Every Clue Scroll casket will roll the max amount of rewards it can give. It can roll the same item more than once. :<br>   - Beginner caskets will roll 3 times.<br>   - Easy caskets will roll 4 times.<br>   - Medium caskets will roll 5 times.<br>   - Hard caskets will roll 6 times.<br>   - Elite caskets will roll 6 times.<br>   - Master caskets will roll 7 times.",
        hasItem: false,
    },
    {
        structId: 1129,
        name: "Slayer Master",
        description:
            "You gain the following perks to <col=ffffff>Slayer</col>:<br><br>- Always on task for all eligible slayer monsters.<br><br>- Unlock all Slayer Task perks for free.<br><br>- Rune Pouches, Herb Sacks and Looting Bags in the Slayer Point store are all free.<br><br>- Skip and block Tasks for free.<br><br>- Gain 1000-15,000 bonus Slayer XP for the first time you kill the 100th of each unique Slayer monster, scaled by the monster's Slayer level requirement (XP stated is before multipliers).",
        hasItem: false,
    },
    {
        structId: 1130,
        name: "Total Recall",
        description:
            "- This item can be used to store any single coordinate, alongside your Hitpoints, Prayer and Special Attack Energy, and teleport back to it at a later date, restoring those stats to what they were.<br><br>- This item ignores wilderness teleport restrictions.<br><br>- The Crystal of Echoes cannot store coordinates whilst inside an instance.<br><br>- There are various other locations this item won't store coordinates in, including quest areas, certain minigames, etc.",
        hasItem: true,
    },
    {
        structId: 1131,
        name: "Golden God",
        description:
            "You gain the following perks to the <col=ffffff>High and Low Alchemy spells</col>:<br><br>- The spells have no rune cost or level requirement.<br><br>- Items give 15% more gold, and have a 65% chance to not be consumed.<br><br>- When cast on a stack of items, the spells will automatically be recast over time, until the stack is depleted or moved.<br><br>You gain the following perks to <col=ffffff>Prayer</col>:<br><br> - 20,000 Coins can be offered at Prayer altars in exchange for Prayer XP equivalent to using a dragon bone. This respects altar XP modifiers. Normal altars have no modifiers.<br><br>- All items purchased from some select shops can be noted, provided the item can be noted at all.<br>   - There will be a new button on select shops which toggles this effect.",
        hasItem: false,
    },
    {
        structId: 1132,
        name: "Grimoire",
        description:
            "- This item can be used to freely swap between spellbooks.<br><br>- The Grimoire acts as a Book of the Dead.<br><br>Additionally, when you select this, you will unlock access to all Prayers and spells, regardless of area, quest, or diary requirements.",
        hasItem: true,
    },
    {
        structId: 1133,
        name: "Overgrown",
        description:
            "- This item can be used to access the Seed Vault from anywhere in the world.<br><br>Additionally, you gain the following perks to <col=ffffff>Farming</col>:<br><br>- Crops never die.<br><br>- When planting a seed, it has a 75% chance to not be consumed.<br><br>- When a seed fully grows, if your Seed Vault has another seed of the same type it will harvest the patch for you, then replant the seed. (Only works whilst online)",
        hasItem: true,
    },
    {
        structId: 1134,
        name: "Specialist",
        description:
            "You gain the following perks to <col=ffffff>special attacks</col>:<br><br>- All special attacks cost 20% and have +100% accuracy.<br><br>- For each failed accuracy roll with a special attack, gain 10% Special Attack Energy.<br><br>- Whenever you kill an NPC, restore 15% Special Attack Energy.",
        hasItem: false,
    },
    {
        structId: 1135,
        name: "Last Stand",
        description:
            "You gain the <col=ffffff>Last Stand</col> perk, which works as follows:<br><br>- If damage would reduce you to 0 hp, you are reduced to 1 hp instead.<br><br>- Your combat stats are instantly boosted to 255 but begin draining rapidly back down to their base level + 15.<br><br>- For the next 16 ticks after this ability is activated, you cannot be reduced to 0 HP.<br><br>- When the effect ends, all incoming damage is nullified and the player is healed based on the damage they dealt over the last 16 ticks.<br><br>Once this ability is used, it cannot be used again until you die or 3 minutes have passed.",
        hasItem: false,
    },
    // Additional relics (structs 6260-6264)
    {
        structId: 6260,
        name: "Rune Saviour",
        description:
            "You gain the <col=ffffff>Rune Saviour</col> perk. Magic spells no longer require or consume Runes. This includes charges when using powered staves or tomes such as the Tome of Fire, Trident of the Seas, Trident of the Swamp, Sanguinesti Staff and the Enchanted Slayer Staff.",
        hasItem: false,
    },
    {
        structId: 6261,
        name: "Minimum Potential",
        description:
            "You gain the <col=ffffff>Minimum Potential</col> perk. Your Melee, Ranged & Magic hits will never deal below 5 damage.",
        hasItem: false,
    },
    {
        structId: 6262,
        name: "Spiky Aura",
        description:
            "You gain the <col=ffffff>Spiky Aura</col> perk. Whenever you take damage you'll reflect at least 25% of the damage received. This effect stacks with other recoil effects.",
        hasItem: false,
    },
    {
        structId: 6263,
        name: "Bottomless Brew",
        description:
            "You gain the <col=ffffff>Bottomless Brew</col> perk.<br>Potions will no longer be consumed when you drink them.",
        hasItem: false,
    },
    {
        structId: 6264,
        name: "Exposure",
        description:
            "You gain the <col=ffffff>Exposure</col> perk. Special attacks have a 50% chance to deal 50% more damage.",
        hasItem: false,
    },
];

// Combat mastery tree nodes (structs 1153-1176, param_2026=name, param_2028=desc)
// category: 3=melee, 4=ranged, 5=magic, undefined=shared
export const LEAGUE_MASTERY_NODES: LeagueMasteryNodeRow[] = [
    {
        structId: 1153,
        name: "Charge Reduction",
        description: "95% chance to save weapon charges, ammunition, and runes used for spells.",
    },
    {
        structId: 1154,
        name: "Healing",
        description: "Healing from all sources is increased by 20%.",
    },
    { structId: 1155, name: "Damage Reduction", description: "Damage taken is reduced by 15%." },
    {
        structId: 1156,
        name: "Accuracy",
        description: "Accuracy with all styles is increased by 100%.",
    },
    {
        structId: 1157,
        name: "Prayer Point Gain",
        description: "Prayer Point gain from all sources is increased by 25%.",
    },
    {
        structId: 1158,
        name: "Prayer Penetration",
        description: "Attacks with all styles now have 60% Prayer penetration.",
    },
    {
        structId: 1159,
        name: "Magic I",
        description:
            "When you roll above 90% of your max hit with <col=0xffffff>Magic</col>, damage is increased by 50%.",
        category: 5,
    },
    {
        structId: 1160,
        name: "Magic II",
        description:
            "<col=0xffffff>Magic</col> max hit is increased by 5% per tick in-between your attacks (Up to +40%).",
        category: 5,
    },
    {
        structId: 1161,
        name: "Magic III",
        description: "<col=0xffffff>Magic</col> attack rate set to 80%, rounding down.",
        category: 5,
    },
    {
        structId: 1162,
        name: "Magic IV",
        description:
            "When you roll above 90% of your max hit with <col=0xffffff>Magic</col>, heal 10% of damage dealt.",
        category: 5,
    },
    {
        structId: 1163,
        name: "Magic V",
        description:
            "<col=0xffffff>Magic</col> attack rate set to 50%, rounded down above 5t, rounded up below 4t.",
        category: 5,
    },
    {
        structId: 1164,
        name: "Magic VI",
        description:
            "Max hit with <col=0xffffff>Magic</col> is increased by 1% for every 100 Hitpoints remaining on target (Up to 10%).<br>On a successful <col=0xffffff>Magic</col> hit, if your target has less health than your max hit, you max hit.",
        category: 5,
    },
    {
        structId: 1165,
        name: "Melee I",
        description:
            "<col=0xffffff>Melee</col> hits have a 25% chance to roll damage twice and take the highest result.",
        category: 3,
    },
    {
        structId: 1166,
        name: "Melee II",
        description:
            "<col=0xffffff>Melee</col> hits have a 10% chance to generate an echo hit<br>(additional melee hit, 50% max-hit, respects Accuracy, PvM only).",
        category: 3,
    },
    {
        structId: 1167,
        name: "Melee III",
        description: "<col=0xffffff>Melee</col> attack rate set to 80%, rounding down.",
        category: 3,
    },
    {
        structId: 1168,
        name: "Melee IV",
        description: "<col=0xffffff>Melee</col> hits have a 5% chance to heal 40% of damage dealt.",
        category: 3,
    },
    {
        structId: 1169,
        name: "Melee V",
        description:
            "<col=0xffffff>Melee</col> attack rate set to 50%, rounded down above 5t, rounded up below 4t.",
        category: 3,
    },
    {
        structId: 1170,
        name: "Melee VI",
        description:
            "Your chance to generate an echo increases to 20%, and your echoes can generate additional echoes (Up to 8 times in a row).",
        category: 3,
    },
    {
        structId: 1171,
        name: "Ranged I",
        description:
            "Damage rolls beneath 30% of max hit with <col=0xffffff>Ranged</col> are increased to 30%.",
        category: 4,
    },
    {
        structId: 1172,
        name: "Ranged II",
        description:
            "Each subsequent <col=0xffffff>Ranged</col> attack has its max hit increased by an additional 5%. Resets after +20%.",
        category: 4,
    },
    {
        structId: 1173,
        name: "Ranged III",
        description: "<col=0xffffff>Ranged</col> attack rate set to 80%, rounding down.",
        category: 4,
    },
    {
        structId: 1174,
        name: "Ranged IV",
        description: "Every 5th <col=0xffffff>Ranged</col> hit, heal 5 hitpoints.",
        category: 4,
    },
    {
        structId: 1175,
        name: "Ranged V",
        description:
            "<col=0xffffff>Ranged</col> attack rate set to 50%, rounded down above 5t, rounded up below 4t.",
        category: 4,
    },
    {
        structId: 1176,
        name: "Ranged VI",
        description: "Never miss with <col=0xffffff>Ranged</col> (PvM only).",
        category: 4,
    },
];

// Mastery challenges (structs 1177-1186, param_2028=desc only)
// These are challenges that grant mastery points when completed
export const LEAGUE_MASTERY_CHALLENGES: LeagueMasteryChallengeRow[] = [
    { structId: 1177, description: "Defeat a Giant." },
    { structId: 1178, description: "Defeat 10 monsters with a combat level of 100 or more." },
    { structId: 1179, description: "Defeat Scurrius by yourself." },
    { structId: 1180, description: "Defeat a monster with a Slayer requirement of 55 or more." },
    { structId: 1181, description: "Defeat TzTok-Jad in the Fight Caves." },
    { structId: 1182, description: "Reach a combat level of 100." },
    { structId: 1183, description: "Defeat an Echo Boss." },
    { structId: 1184, description: "Defeat two unique Echo Bosses." },
    { structId: 1185, description: "Defeat three unique Echo Bosses." },
    { structId: 1186, description: "Defeat TzKal-Zuk." },
];
