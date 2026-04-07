import type { NpcLootConfig } from "../../../src/game/scripts/types";

export const NPC_LOOT_CONFIGS: Map<number, NpcLootConfig> = new Map([
    // Raids bosses - shared loot based on participation
    [7527, { distribution: "shared", sharedLootThreshold: 0.05 }], // Great Olm
    [8340, { distribution: "shared", sharedLootThreshold: 0.05 }], // Verzik Vitur (final form)

    // Standard bosses - highest damage
    [494, { distribution: "highest-damage" }], // Kraken
    [2042, { distribution: "highest-damage" }], // Zulrah
    [8026, { distribution: "highest-damage" }], // Vorkath

    // God Wars Dungeon - highest damage with MVP consideration
    [2215, { distribution: "most-valuable-player" }], // General Graardor
    [3162, { distribution: "most-valuable-player" }], // K'ril Tsutsaroth
    [2205, { distribution: "most-valuable-player" }], // Commander Zilyana
    [3129, { distribution: "most-valuable-player" }], // Kree'arra

    // Corporeal Beast - shared loot
    [319, { distribution: "shared", sharedLootThreshold: 0.1, minDamageThreshold: 100 }],

    // Nightmare - shared loot
    [9425, { distribution: "shared", sharedLootThreshold: 0.05 }],
]);
