import assert from "node:assert/strict";
import { itemStackText } from "../common/items/ItemStackText";

for (const [quantity, text, color] of [
    [0, "0", "#ffff00"], [99_999, "99999", "#ffff00"],
    [100_000, "100K", "#ffffff"], [9_999_999, "9999K", "#ffffff"],
    [10_000_000, "10M", "#00ff80"], [50_000_000, "50M", "#00ff80"],
    [1_000_000_000, "1000M", "#00ff80"], [2_147_483_647, "2147M", "#00ff80"],
] as const) assert.deepEqual(itemStackText(quantity), { text, color });
console.log("Original stack formatting passes yellow/white/green boundaries and billion-sized stacks.");
