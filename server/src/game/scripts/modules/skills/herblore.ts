import { SkillId } from "../../../../../../src/rs/skill/skills";
import type { PlayerState } from "../../../player";
import { logger } from "../../../../utils/logger";
import { type ScriptModule } from "../../types";

// OSRS-like herblore data sourced from the Elvarg references included in this repo.
// - Cleanable herbs (id, level, xp)
// - Unfinished potions (herb + vial of water -> unf, level)
// - Finished potions (unf + secondary -> potion(3), level, xp)

const VIAL_OF_WATER = 227;
const AMYLASE_CRYSTAL = 12640;
const STAMINA_LEVEL = 77;

type CleanHerb = { grimy: number; clean: number; level: number; xp: number };
type Unf = { cleanHerb: number; unf: number; level: number };
type Finished = { unf: number; secondary: number; product3: number; level: number; xp: number };
type StaminaRecipe = { superEnergy: number; stamina: number; doses: number };

const CLEAN_LIST: CleanHerb[] = [
    { grimy: 199, clean: 249, level: 1, xp: 2 },
    { grimy: 201, clean: 251, level: 5, xp: 4 },
    { grimy: 203, clean: 253, level: 11, xp: 5 },
    { grimy: 205, clean: 255, level: 20, xp: 6 },
    { grimy: 207, clean: 257, level: 25, xp: 7 },
    { grimy: 3049, clean: 2998, level: 30, xp: 8 },
    { grimy: 209, clean: 259, level: 40, xp: 10 },
    { grimy: 211, clean: 261, level: 48, xp: 12 },
    { grimy: 213, clean: 263, level: 54, xp: 13 },
    { grimy: 3051, clean: 3000, level: 59, xp: 13 },
    { grimy: 215, clean: 265, level: 65, xp: 14 },
    { grimy: 2485, clean: 2481, level: 67, xp: 16 },
    { grimy: 217, clean: 267, level: 70, xp: 18 },
    { grimy: 219, clean: 269, level: 75, xp: 21 },
    // Spirit weed / Wergali exist in references but are uncommon; omit for brevity
];

const UNF_LIST: Unf[] = [
    { cleanHerb: 249, unf: 91, level: 1 },
    { cleanHerb: 251, unf: 93, level: 5 },
    { cleanHerb: 253, unf: 95, level: 12 },
    { cleanHerb: 255, unf: 97, level: 22 },
    { cleanHerb: 257, unf: 99, level: 30 },
    { cleanHerb: 2998, unf: 3002, level: 34 },
    { cleanHerb: 259, unf: 101, level: 45 },
    { cleanHerb: 261, unf: 103, level: 50 },
    { cleanHerb: 263, unf: 105, level: 55 },
    { cleanHerb: 3000, unf: 3004, level: 63 },
    { cleanHerb: 265, unf: 107, level: 66 },
    { cleanHerb: 2481, unf: 2483, level: 69 },
    { cleanHerb: 267, unf: 109, level: 72 },
    { cleanHerb: 269, unf: 111, level: 78 },
];

const FINISHED_LIST: Finished[] = [
    { product3: 121, unf: 91, secondary: 221, level: 1, xp: 25 }, // Attack
    { product3: 175, unf: 93, secondary: 235, level: 5, xp: 38 }, // Antipoison
    { product3: 115, unf: 95, secondary: 225, level: 12, xp: 50 }, // Strength
    { product3: 127, unf: 97, secondary: 223, level: 22, xp: 63 }, // Restore
    { product3: 3010, unf: 97, secondary: 1975, level: 26, xp: 68 }, // Energy
    { product3: 133, unf: 99, secondary: 239, level: 30, xp: 75 }, // Defence
    { product3: 3034, unf: 3002, secondary: 2152, level: 34, xp: 80 }, // Agility
    { product3: 9741, unf: 97, secondary: 9736, level: 36, xp: 84 }, // Combat
    { product3: 139, unf: 99, secondary: 231, level: 38, xp: 88 }, // Prayer
    // Super attack / fishing / super antipoison share Irit unf in ref; register each explicitly
    { product3: 145, unf: 101, secondary: 221, level: 45, xp: 100 }, // Super attack
    { product3: 181, unf: 101, secondary: 231, level: 48, xp: 106 }, // Fishing potion
    { product3: 181, unf: 101, secondary: 235, level: 48, xp: 103 }, // Super antipoison
    { product3: 3018, unf: 103, secondary: 2970, level: 52, xp: 118 }, // Super energy
    { product3: 157, unf: 105, secondary: 225, level: 55, xp: 125 }, // Super strength
    { product3: 187, unf: 105, secondary: 241, level: 60, xp: 138 }, // Weapon poison
    { product3: 3026, unf: 3004, secondary: 223, level: 63, xp: 143 }, // Super restore
    { product3: 163, unf: 107, secondary: 239, level: 66, xp: 150 }, // Super defence
    { product3: 2454, unf: 2483, secondary: 241, level: 69, xp: 158 }, // Antifire
    { product3: 169, unf: 109, secondary: 245, level: 72, xp: 163 }, // Ranging
    { product3: 3042, unf: 2483, secondary: 3138, level: 76, xp: 173 }, // Magic
    { product3: 189, unf: 111, secondary: 247, level: 78, xp: 175 }, // Zamorak brew
    { product3: 6687, unf: 3002, secondary: 6693, level: 81, xp: 180 }, // Saradomin brew
    { product3: 10000, unf: 103, secondary: 10111, level: 53, xp: 110 }, // Hunter
    { product3: 14848, unf: 103, secondary: 11525, level: 58, xp: 105 }, // Fletching potion
    { product3: 5945, unf: 3002, secondary: 6049, level: 68, xp: 154 }, // Antipoison+
];

const STAMINA_RECIPES: StaminaRecipe[] = [
    { superEnergy: 3016, stamina: 12625, doses: 4 }, // (4)
    { superEnergy: 3018, stamina: 12627, doses: 3 }, // (3)
    { superEnergy: 3020, stamina: 12629, doses: 2 }, // (2)
    { superEnergy: 3022, stamina: 12631, doses: 1 }, // (1)
];

function herbloreLevel(player: PlayerState): number {
    return player.getSkill(SkillId.Herblore).baseLevel;
}

type InventoryEntry = { itemId: number; quantity: number };

function getInventoryEntry(player: PlayerState, slotIndex: number): InventoryEntry | undefined {
    const inventory = player.getInventoryEntries();
    if (slotIndex < 0 || slotIndex >= inventory.length) return undefined;
    const entry = inventory[slotIndex];
    if (!entry) return undefined;
    return entry;
}

export const herbloreModule: ScriptModule = {
    id: "skills.herblore",
    register(registry, services) {
        const consumeItem = services.consumeItem;
        const setInventorySlot = services.setInventorySlot;
        const addSkillXp = services.addSkillXp;
        const snapshotInventory = services.snapshotInventoryImmediate;

        // Clean herbs
        for (const h of CLEAN_LIST) {
            registry.registerItemAction(
                h.grimy,
                ({ player, source }) => {
                    const level = herbloreLevel(player);
                    if (level < h.level) {
                        services.sendGameMessage(
                            player,
                            `You need a Herblore level of ${h.level} to clean this herb.`,
                        );
                        return;
                    }
                    setInventorySlot(player, source.slot, h.clean, 1);
                    if (addSkillXp && h.xp > 0) {
                        addSkillXp(player, SkillId.Herblore, h.xp);
                    }
                    services.sendGameMessage(player, "You clean the herb.");
                    snapshotInventory(player);
                },
                "clean",
            );
        }

        // Unfinished potions (herb + vial of water)
        for (const u of UNF_LIST) {
            const handler = ({ player, source, target }: any) => {
                const level = herbloreLevel(player);
                if (level < u.level) {
                    services.sendGameMessage(
                        player,
                        `You need a Herblore level of ${u.level} to make this potion.`,
                    );
                    return;
                }
                // Decide which slot is herb vs vial
                const isSourceHerb = source.itemId === u.cleanHerb;
                const herbSlot = isSourceHerb ? source.slot : target.slot;
                const vialSlot = isSourceHerb ? target.slot : source.slot;
                if (!consumeItem(player, herbSlot)) return;
                setInventorySlot(player, vialSlot, u.unf, 1);
                services.sendGameMessage(player, "You mix the herb into the water.");
                if (snapshotInventory) {
                    snapshotInventory(player);
                }
            };
            registry.registerItemOnItem(u.cleanHerb, VIAL_OF_WATER, handler);
        }

        // Finished potions (unf + secondary)
        const seenPairs = new Set<string>();
        for (const f of FINISHED_LIST) {
            const key = `${f.unf}|${f.secondary}`;
            if (seenPairs.has(key)) continue; // avoid accidental duplicates
            seenPairs.add(key);
            const handler = ({ player, source, target }: any) => {
                const level = herbloreLevel(player);
                if (level < f.level) {
                    services.sendGameMessage(
                        player,
                        `You need a Herblore level of ${f.level} to make this potion.`,
                    );
                    return;
                }
                // Identify which slot is unf vs secondary
                const srcIsUnf = source.itemId === f.unf;
                const unfSlot = srcIsUnf ? source.slot : target.slot;
                const secSlot = srcIsUnf ? target.slot : source.slot;
                if (!consumeItem(player, unfSlot)) return;
                setInventorySlot(player, secSlot, f.product3, 1);
                if (addSkillXp && f.xp > 0) {
                    addSkillXp(player, SkillId.Herblore, f.xp);
                }
                services.sendGameMessage(player, "You combine the ingredients to make a potion.");
                if (snapshotInventory) {
                    snapshotInventory(player);
                }
            };
            registry.registerItemOnItem(f.unf, f.secondary, handler);
        }

        // Amylase crystal conversions -> stamina potions (OSRS authentic behaviour)
        for (const recipe of STAMINA_RECIPES) {
            registry.registerItemOnItem(
                recipe.superEnergy,
                AMYLASE_CRYSTAL,
                ({ player, source, target }: any) => {
                    const level = herbloreLevel(player);
                    if (level < STAMINA_LEVEL) {
                        services.sendGameMessage(
                            player,
                            `You need a Herblore level of ${STAMINA_LEVEL} to make a stamina potion.`,
                        );
                        return;
                    }
                    const sourceIsPotion = source.itemId === recipe.superEnergy;
                    const potionSlot = sourceIsPotion ? source.slot : target.slot;
                    const crystalSlot = sourceIsPotion ? target.slot : source.slot;
                    const crystalEntry = getInventoryEntry(player, crystalSlot);
                    if (!crystalEntry || crystalEntry.itemId !== AMYLASE_CRYSTAL) return;
                    const required = Math.max(1, recipe.doses);
                    if (crystalEntry.quantity < required) {
                        const plural = required === 1 ? "" : "s";
                        services.sendGameMessage(
                            player,
                            `You need ${required} amylase crystal${plural} to enhance that potion.`,
                        );
                        return;
                    }
                    for (let i = 0; i < required; i++) {
                        if (!consumeItem(player, crystalSlot)) {
                            logger?.warn?.(
                                `[herblore] failed to consume amylase crystal slot=${crystalSlot}`,
                            );
                            return;
                        }
                    }
                    setInventorySlot(player, potionSlot, recipe.stamina, 1);
                    services.sendGameMessage(
                        player,
                        "You mix the amylase crystals into the potion.",
                    );
                    if (snapshotInventory) {
                        snapshotInventory(player);
                    }
                },
            );
        }
    },
};
