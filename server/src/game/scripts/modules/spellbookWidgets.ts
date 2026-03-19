import { EquipmentSlot } from "../../../../../src/rs/config/player/Equipment";
import { SkillId } from "../../../../../src/rs/skill/skills";
import { RUNE_IDS } from "../../../data/runes";
import { getSpellWidgetId } from "../../../data/spellWidgetLoader";
import {
    canWeaponAutocastSpell,
    getAutocastCompatibilityMessage,
    getAutocastIndexFromSpellId,
    getSpellDataByWidget,
    isSpellAutocastable,
} from "../../../data/spells";
import { type TeleportSpellData, getTeleportByWidgetId } from "../../../data/teleportDestinations";
import { getMainmodalUid } from "../../../widgets/viewport";
import type { SkillBoltEnchantActionData as BoltEnchantActionData } from "../../actions/skillActionPayloads";
import { applyAutocastState } from "../../combat/AutocastState";
import { type PlayerState } from "../../player";
import {
    type InventoryItem,
    type RuneValidationResult,
    RuneValidator,
} from "../../spells/RuneValidator";
import { type ScriptModule, type ScriptServices, type WidgetActionEvent } from "../types";

const SPELLBOOK_GROUP_ID = 218;
const BOLT_ENCHANT_CHATBOX_GROUP_ID = 270;
const BOLT_ENCHANT_SCRIPT_ID = 2046;
const BOLT_ENCHANT_SKILLMULTI_MODE = 19; // enum_1809 -> "Enchant"
const BOLT_ENCHANT_ITEM_COMPONENT_START = 15;
const BOLT_ENCHANT_ITEM_SLOT_COUNT = 18;
const BOLT_ENCHANT_QTY_ONE_COMPONENT = 7;
const BOLT_ENCHANT_QTY_FIVE_COMPONENT = 8;
const BOLT_ENCHANT_QTY_TEN_COMPONENT = 9;
const BOLT_ENCHANT_QTY_OTHER_COMPONENT = 10;
const BOLT_ENCHANT_QTY_X_COMPONENT = 11;
const BOLT_ENCHANT_QTY_ALL_COMPONENT = 12;
const CHATBOX_RESET_SCRIPT_ID = 2379;
const MAGIC_SKILL_ID = SkillId.Magic;
const CROSSBOW_BOLT_ENCHANT_ANIM_ID = 4462;
const BOLTS_PER_ENCHANT_SET = 10;
const BOLT_ENCHANT_ACTION_KIND = "skill.bolt_enchant";
const BOLT_ENCHANT_ACTION_DELAY_TICKS = 3;
const BOLT_ENCHANT_ACTION_GROUP = "skill.bolt_enchant";
const MINIGAME_TELEPORT_GROUP_ID = 951;
const MINIGAME_TELEPORT_OPEN_VARBIT_ID = 12393;
const SCRIPT_MINIGAMES_PREPARE = 2524;
const SCRIPT_MINIGAMES_BUILD_LIST = 656;
const SCRIPT_STEELBORDER = 227;
const SCRIPT_XPDROPS_SETPOSITION = 2164;
const SCRIPT_MAGIC_SPELLBOOK_REDRAW = 2610;
const SCRIPT_ARG_ACTIVE_WIDGET = -2147483645;
const MINIGAMES_TITLE = "Minigames";
const SPELLBOOK_INFO_LABEL = "Info";
const SPELLBOOK_FILTERS_LABEL = "Filters";
const MINIGAME_LIST_UID = (MINIGAME_TELEPORT_GROUP_ID << 16) | 4;
const MINIGAME_SCROLLBAR_UID = (MINIGAME_TELEPORT_GROUP_ID << 16) | 26;
const MAGIC_SPELLBOOK_REDRAW_ARGS: (number | string)[] = [
    14286851,
    14287045,
    14287054,
    14286849,
    14287051,
    14287052,
    14287053,
    14286850,
    14287047,
    14287050,
    0,
    SPELLBOOK_INFO_LABEL,
    SPELLBOOK_FILTERS_LABEL,
];

// Teleport animation timings
const TELEPORT_DELAY_TICKS = 3; // Delay before actual teleport happens (for animation)

// Rune ID to name mapping for error messages
const RUNE_NAMES: Record<number, string> = {
    [RUNE_IDS.AIR]: "Air",
    [RUNE_IDS.WATER]: "Water",
    [RUNE_IDS.EARTH]: "Earth",
    [RUNE_IDS.FIRE]: "Fire",
    [RUNE_IDS.MIND]: "Mind",
    [RUNE_IDS.BODY]: "Body",
    [RUNE_IDS.COSMIC]: "Cosmic",
    [RUNE_IDS.CHAOS]: "Chaos",
    [RUNE_IDS.NATURE]: "Nature",
    [RUNE_IDS.LAW]: "Law",
    [RUNE_IDS.DEATH]: "Death",
    [RUNE_IDS.BLOOD]: "Blood",
    [RUNE_IDS.SOUL]: "Soul",
    [RUNE_IDS.ASTRAL]: "Astral",
    [RUNE_IDS.WRATH]: "Wrath",
};

type BoltEnchantVariant = {
    sourceItemId: number;
    enchantedItemId: number;
    enchantedName: string;
};

type BoltEnchantRecipe = {
    key: string;
    levelRequired: number;
    xp: number;
    runeCosts: Array<{ runeId: number; quantity: number }>;
    variants: BoltEnchantVariant[];
};

type BoltEnchantUiEntry = {
    recipe: BoltEnchantRecipe;
    variant: BoltEnchantVariant;
    maxSets: number;
};

type BoltEnchantUiSession = {
    entriesByComponentUid: Map<number, BoltEnchantUiEntry>;
    maxSets: number;
    selectedSets?: number;
    hasExplicitSelection: boolean;
};

const boltEnchantUiSessions = new WeakMap<PlayerState, BoltEnchantUiSession>();

function getMinigameTeleportChildId(): number | undefined {
    return getSpellWidgetId("Minigame Teleport");
}

function getCrossbowBoltEnchantmentsChildId(): number | undefined {
    return getSpellWidgetId("Crossbow Bolt Enchantments");
}

/**
 * OSRS parity data from CS2 [proc,skill_guide_data_magic].
 * Ordered highest -> lowest so auto-detection prefers the strongest applicable bolt type.
 */
const BOLT_ENCHANT_RECIPES: BoltEnchantRecipe[] = [
    {
        key: "onyx",
        levelRequired: 87,
        xp: 97,
        runeCosts: [
            { runeId: RUNE_IDS.COSMIC, quantity: 1 },
            { runeId: RUNE_IDS.FIRE, quantity: 20 },
            { runeId: RUNE_IDS.DEATH, quantity: 1 },
        ],
        variants: [
            { sourceItemId: 9342, enchantedItemId: 9245, enchantedName: "onyx bolts (e)" },
            {
                sourceItemId: 21973,
                enchantedItemId: 21950,
                enchantedName: "onyx dragon bolts (e)",
            },
            {
                sourceItemId: 21974,
                enchantedItemId: 21951,
                enchantedName: "onyx dragon bolts (e)",
            },
        ],
    },
    {
        key: "dragonstone",
        levelRequired: 68,
        xp: 78,
        runeCosts: [
            { runeId: RUNE_IDS.COSMIC, quantity: 1 },
            { runeId: RUNE_IDS.EARTH, quantity: 15 },
            { runeId: RUNE_IDS.SOUL, quantity: 1 },
        ],
        variants: [
            { sourceItemId: 9341, enchantedItemId: 9244, enchantedName: "dragon bolts (e)" },
            {
                sourceItemId: 21971,
                enchantedItemId: 21948,
                enchantedName: "dragonstone dragon bolts (e)",
            },
            {
                sourceItemId: 21972,
                enchantedItemId: 21949,
                enchantedName: "dragonstone dragon bolts (e)",
            },
        ],
    },
    {
        key: "diamond",
        levelRequired: 57,
        xp: 67,
        runeCosts: [
            { runeId: RUNE_IDS.COSMIC, quantity: 1 },
            { runeId: RUNE_IDS.EARTH, quantity: 10 },
            { runeId: RUNE_IDS.LAW, quantity: 2 },
        ],
        variants: [
            { sourceItemId: 9340, enchantedItemId: 9243, enchantedName: "diamond bolts (e)" },
            {
                sourceItemId: 21969,
                enchantedItemId: 21946,
                enchantedName: "diamond dragon bolts (e)",
            },
            {
                sourceItemId: 21970,
                enchantedItemId: 21947,
                enchantedName: "diamond dragon bolts (e)",
            },
        ],
    },
    {
        key: "ruby",
        levelRequired: 49,
        xp: 59,
        runeCosts: [
            { runeId: RUNE_IDS.COSMIC, quantity: 1 },
            { runeId: RUNE_IDS.FIRE, quantity: 5 },
            { runeId: RUNE_IDS.BLOOD, quantity: 1 },
        ],
        variants: [
            { sourceItemId: 9339, enchantedItemId: 9242, enchantedName: "ruby bolts (e)" },
            {
                sourceItemId: 21967,
                enchantedItemId: 21944,
                enchantedName: "ruby dragon bolts (e)",
            },
            {
                sourceItemId: 21968,
                enchantedItemId: 21945,
                enchantedName: "ruby dragon bolts (e)",
            },
        ],
    },
    {
        key: "topaz",
        levelRequired: 29,
        xp: 33,
        runeCosts: [
            { runeId: RUNE_IDS.COSMIC, quantity: 1 },
            { runeId: RUNE_IDS.FIRE, quantity: 2 },
        ],
        variants: [
            { sourceItemId: 9336, enchantedItemId: 9239, enchantedName: "topaz bolts (e)" },
            {
                sourceItemId: 21961,
                enchantedItemId: 21938,
                enchantedName: "topaz dragon bolts (e)",
            },
            {
                sourceItemId: 21962,
                enchantedItemId: 21939,
                enchantedName: "topaz dragon bolts (e)",
            },
        ],
    },
    {
        key: "emerald",
        levelRequired: 27,
        xp: 37,
        runeCosts: [
            { runeId: RUNE_IDS.COSMIC, quantity: 1 },
            { runeId: RUNE_IDS.AIR, quantity: 3 },
            { runeId: RUNE_IDS.NATURE, quantity: 1 },
        ],
        variants: [
            { sourceItemId: 9338, enchantedItemId: 9241, enchantedName: "emerald bolts (e)" },
            {
                sourceItemId: 21965,
                enchantedItemId: 21942,
                enchantedName: "emerald dragon bolts (e)",
            },
            {
                sourceItemId: 21966,
                enchantedItemId: 21943,
                enchantedName: "emerald dragon bolts (e)",
            },
        ],
    },
    {
        key: "pearl",
        levelRequired: 24,
        xp: 29,
        runeCosts: [
            { runeId: RUNE_IDS.COSMIC, quantity: 1 },
            { runeId: RUNE_IDS.WATER, quantity: 2 },
        ],
        variants: [
            { sourceItemId: 880, enchantedItemId: 9238, enchantedName: "pearl bolts (e)" },
            {
                sourceItemId: 21959,
                enchantedItemId: 21936,
                enchantedName: "pearl dragon bolts (e)",
            },
            {
                sourceItemId: 21960,
                enchantedItemId: 21937,
                enchantedName: "pearl dragon bolts (e)",
            },
        ],
    },
    {
        key: "jade",
        levelRequired: 14,
        xp: 19,
        runeCosts: [
            { runeId: RUNE_IDS.COSMIC, quantity: 1 },
            { runeId: RUNE_IDS.EARTH, quantity: 2 },
        ],
        variants: [
            { sourceItemId: 9335, enchantedItemId: 9237, enchantedName: "jade bolts (e)" },
            {
                sourceItemId: 21957,
                enchantedItemId: 21934,
                enchantedName: "jade dragon bolts (e)",
            },
            {
                sourceItemId: 21958,
                enchantedItemId: 21935,
                enchantedName: "jade dragon bolts (e)",
            },
        ],
    },
    {
        key: "sapphire",
        levelRequired: 7,
        xp: 17.5,
        runeCosts: [
            { runeId: RUNE_IDS.COSMIC, quantity: 1 },
            { runeId: RUNE_IDS.WATER, quantity: 1 },
            { runeId: RUNE_IDS.MIND, quantity: 1 },
        ],
        variants: [
            {
                sourceItemId: 9337,
                enchantedItemId: 9240,
                enchantedName: "sapphire bolts (e)",
            },
            {
                sourceItemId: 21963,
                enchantedItemId: 21940,
                enchantedName: "sapphire dragon bolts (e)",
            },
            {
                sourceItemId: 21964,
                enchantedItemId: 21941,
                enchantedName: "sapphire dragon bolts (e)",
            },
        ],
    },
    {
        key: "opal",
        levelRequired: 4,
        xp: 9,
        runeCosts: [
            { runeId: RUNE_IDS.COSMIC, quantity: 1 },
            { runeId: RUNE_IDS.AIR, quantity: 2 },
        ],
        variants: [
            { sourceItemId: 879, enchantedItemId: 9236, enchantedName: "opal bolts (e)" },
            {
                sourceItemId: 21955,
                enchantedItemId: 21932,
                enchantedName: "opal dragon bolts (e)",
            },
            {
                sourceItemId: 21956,
                enchantedItemId: 21933,
                enchantedName: "opal dragon bolts (e)",
            },
        ],
    },
];

/**
 * Spellbook widget handlers for interface 218.
 *
 * Uses a general handler since spells are individual components.
 * OpId determines the action:
 * - Op1 = Cast spell
 * - Op2 = Autocast (normal)
 * - Op3 = Defensive Autocast
 */
export const spellbookWidgetModule: ScriptModule = {
    id: "content.spellbook-widgets",
    register(registry, services) {
        // Register a general handler for the spellbook interface
        // This catches all spell button clicks regardless of which spell
        registry.registerWidgetAction({
            handler: (event) => {
                const groupId = event.groupId;

                if (groupId === BOLT_ENCHANT_CHATBOX_GROUP_ID) {
                    handleBoltEnchantQuantityWidgetAction(event, services);
                    return;
                }
                if (groupId !== SPELLBOOK_GROUP_ID) return;

                const childId = event.childId;
                const opId = event.opId ?? 1;

                // Op2 = Autocast, Op3 = Defensive Autocast
                if (opId === 2 || opId === 3) {
                    handleAutocast(event.player, childId, opId === 3, services);
                    return;
                }

                // Op1 = Cast spell (teleports, etc.)
                if (opId === 1) {
                    if (childId === getMinigameTeleportChildId()) {
                        openMinigameTeleportInterface(event.player, services);
                        return;
                    }

                    if (childId === getCrossbowBoltEnchantmentsChildId()) {
                        handleCrossbowBoltEnchantments(event.player, services);
                        return;
                    }

                    const teleportSpell = getTeleportByWidgetId(childId);
                    if (teleportSpell) {
                        executeTeleport(event.player, teleportSpell, services);
                        return;
                    }
                }
            },
        });
    },
};

/**
 * Handle autocast from spellbook
 */
function handleAutocast(
    player: PlayerState,
    childId: number,
    isDefensive: boolean,
    services: ScriptServices,
): void {
    // Look up spell data by widget child ID
    const spellData = getSpellDataByWidget(SPELLBOOK_GROUP_ID, childId);
    if (!spellData) {
        services.logger?.warn?.(`[script:spellbook] No spell data for widget childId=${childId}`);
        return;
    }

    const spellId = spellData.id;

    // Check if spell is autocastable
    if (!isSpellAutocastable(spellId)) {
        services.sendGameMessage(player, "You can't autocast that spell.");
        return;
    }

    // Get the autocast index for varbit 276
    const autocastIndex = getAutocastIndexFromSpellId(spellId);
    if (!autocastIndex) {
        services.logger?.warn?.(
            `[script:spellbook] No autocast index for spell ${spellData.name} (${spellId})`,
        );
        return;
    }

    // Validate staff-spell compatibility (OSRS parity)
    const equip = player.appearance?.equip;
    const weaponObjId = Array.isArray(equip) ? equip[EquipmentSlot.WEAPON] : 0;
    const compatibility = canWeaponAutocastSpell(weaponObjId, spellId);
    if (!compatibility.compatible) {
        const message = getAutocastCompatibilityMessage(compatibility.reason);
        services.sendGameMessage(player, message);
        services.logger?.info?.(
            `[script:spellbook] Autocast rejected for player=${player.id} ` +
                `spell=${spellId} weapon=${weaponObjId} reason=${compatibility.reason}`,
        );
        return;
    }

    applyAutocastState(player, spellId, autocastIndex, isDefensive, {
        sendVarbit: services.sendVarbit,
        queueCombatState: services.queueCombatState,
    });

    services.logger?.info?.(
        `[script:spellbook] Autocast set for player=${player.id} ` +
            `spell=${spellData.name} spellId=${spellId} index=${autocastIndex} defensive=${isDefensive}`,
    );
}

/**
 * Get player's inventory as InventoryItem array for RuneValidator
 */
function getPlayerInventory(player: PlayerState): InventoryItem[] {
    const entries = player.getInventoryEntries();
    return entries
        .filter((item) => item.itemId > 0 && item.quantity > 0)
        .map((item) => ({
            itemId: item.itemId,
            quantity: item.quantity,
        }));
}

/**
 * Get player's equipped items for staff substitution checks
 */
function getPlayerEquipment(player: PlayerState): number[] {
    const equip = player.appearance?.equip;
    return Array.isArray(equip) ? equip.filter((itemId) => itemId > 0) : [];
}

/**
 * Remove runes from player inventory after validation
 */
function consumeRunesFromInventory(
    player: PlayerState,
    toConsume: Array<{ runeId: number; quantity: number }>,
    services: ScriptServices,
    opts?: { snapshot?: boolean },
): void {
    const inventory = services.getInventoryItems(player);

    for (const { runeId, quantity } of toConsume) {
        let remaining = quantity;

        for (const entry of inventory) {
            if (remaining <= 0) break;
            if (entry.itemId !== runeId) continue;

            const consumeFromSlot = Math.min(remaining, entry.quantity);
            const nextQty = Math.max(0, entry.quantity - consumeFromSlot);

            if (nextQty > 0) {
                services.setInventorySlot(player, entry.slot, runeId, nextQty);
            } else {
                // Clear the slot
                services.setInventorySlot(player, entry.slot, -1, 0);
            }

            remaining -= consumeFromSlot;
        }
    }

    if (opts?.snapshot !== false) {
        services.snapshotInventoryImmediate(player);
    }
}

function consumeItemFromInventory(
    player: PlayerState,
    itemId: number,
    quantity: number,
    services: ScriptServices,
): boolean {
    if (!(itemId > 0) || !(quantity > 0)) return false;
    const inventory = services.getInventoryItems(player);
    let remaining = quantity;

    for (const entry of inventory) {
        if (remaining <= 0) break;
        if (entry.itemId !== itemId) continue;

        const consumeFromSlot = Math.min(remaining, entry.quantity);
        const nextQty = Math.max(0, entry.quantity - consumeFromSlot);
        if (nextQty > 0) {
            services.setInventorySlot(player, entry.slot, itemId, nextQty);
        } else {
            services.setInventorySlot(player, entry.slot, -1, 0);
        }
        remaining -= consumeFromSlot;
    }

    return remaining <= 0;
}

function getMagicLevel(player: PlayerState): number {
    return Math.max(1, player.getSkill(MAGIC_SKILL_ID).baseLevel);
}

function countInventoryItem(inventory: InventoryItem[], itemId: number): number {
    let total = 0;
    for (const entry of inventory) {
        if (entry.itemId === itemId && entry.quantity > 0) {
            total += entry.quantity;
        }
    }
    return total;
}

function sendMissingRuneMessage(
    player: PlayerState,
    runeValidation: RuneValidationResult,
    services: ScriptServices,
): void {
    if (runeValidation.missingRunes && runeValidation.missingRunes.length > 0) {
        const missing = runeValidation.missingRunes[0];
        const runeName = RUNE_NAMES[missing.runeId] ?? "Unknown";
        services.sendGameMessage(
            player,
            `You do not have enough ${runeName} Runes to cast this spell.`,
        );
    } else {
        services.sendGameMessage(player, "You do not have the runes to cast this spell.");
    }
}

function findBoltEnchantVariant(
    inventory: InventoryItem[],
    recipe: BoltEnchantRecipe,
): { variant: BoltEnchantVariant; availableSets: number } | undefined {
    for (const variant of recipe.variants) {
        const available = countInventoryItem(inventory, variant.sourceItemId);
        if (available >= BOLTS_PER_ENCHANT_SET) {
            return {
                variant,
                availableSets: Math.floor(available / BOLTS_PER_ENCHANT_SET),
            };
        }
    }
    return undefined;
}

function getRuneLimitedSets(
    inventory: InventoryItem[],
    runesConsumed: Array<{ runeId: number; quantity: number }>,
): number {
    if (!Array.isArray(runesConsumed) || runesConsumed.length === 0) {
        return Number.MAX_SAFE_INTEGER;
    }
    let maxSets = Number.MAX_SAFE_INTEGER;
    for (const rune of runesConsumed) {
        const quantityPerSet = Math.max(0, rune.quantity);
        if (!(quantityPerSet > 0)) continue;
        const available = countInventoryItem(inventory, rune.runeId);
        maxSets = Math.min(maxSets, Math.floor(available / quantityPerSet));
    }
    return Math.max(0, maxSets);
}

function toDisplayName(name: string): string {
    const normalized = String(name ?? "").trim();
    if (!normalized) return "";
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function buildBoltEnchantScriptLabelArg(title: string, labels: string[]): string {
    const padded = labels.slice(0, BOLT_ENCHANT_ITEM_SLOT_COUNT);
    while (padded.length < BOLT_ENCHANT_ITEM_SLOT_COUNT) {
        padded.push("");
    }
    return `${title}|${padded.join("|")}`;
}

function clearBoltEnchantUiSession(
    player: PlayerState,
    services: ScriptServices,
    options?: { closeInterface?: boolean },
): void {
    boltEnchantUiSessions.delete(player);
    if (!options?.closeInterface) return;
    const interfaceService = services.getInterfaceService?.();
    if (!interfaceService?.isChatboxModalOpen(player, BOLT_ENCHANT_CHATBOX_GROUP_ID)) return;
    interfaceService.closeChatboxModal(player);
}

function openMinigameTeleportInterface(player: PlayerState, services: ScriptServices): void {
    const mainmodalUid = getMainmodalUid(player.displayMode);

    player.setVarbitValue(MINIGAME_TELEPORT_OPEN_VARBIT_ID, 1);

    services.openSubInterface?.(player, mainmodalUid, MINIGAME_TELEPORT_GROUP_ID, 0, {
        varbits: {
            [MINIGAME_TELEPORT_OPEN_VARBIT_ID]: 1,
        },
        preScripts: [
            { scriptId: SCRIPT_MINIGAMES_PREPARE, args: [-1, -1] },
            { scriptId: SCRIPT_STEELBORDER, args: [SCRIPT_ARG_ACTIVE_WIDGET, MINIGAMES_TITLE] },
        ],
        postScripts: [
            {
                scriptId: SCRIPT_MINIGAMES_BUILD_LIST,
                args: [MINIGAME_LIST_UID, MINIGAME_SCROLLBAR_UID],
            },
            { scriptId: SCRIPT_XPDROPS_SETPOSITION, args: [7995396, 7995395] },
            { scriptId: SCRIPT_MAGIC_SPELLBOOK_REDRAW, args: MAGIC_SPELLBOOK_REDRAW_ARGS },
        ],
    });

    services.logger?.info?.(
        `[script:spellbook] Opened minigame teleport modal for player=${player.id} targetUid=${mainmodalUid}`,
    );
}

function openBoltEnchantQuantityInterface(
    player: PlayerState,
    recipe: BoltEnchantRecipe,
    variant: BoltEnchantVariant,
    maxSets: number,
    services: ScriptServices,
): boolean {
    const queueClientScript = services.queueClientScript;
    const queueWidgetEvent = services.queueWidgetEvent;
    const interfaceService = services.getInterfaceService?.();
    if ((!queueClientScript && !queueWidgetEvent) || !interfaceService) {
        return false;
    }

    const clampedMaxSets = Math.max(1, maxSets);
    const title = "How many sets of bolts to enchant?";

    const itemIds = new Array<number>(BOLT_ENCHANT_ITEM_SLOT_COUNT).fill(-1);
    const labels = new Array<string>(BOLT_ENCHANT_ITEM_SLOT_COUNT).fill("");
    itemIds[0] = variant.enchantedItemId;
    labels[0] = toDisplayName(variant.enchantedName);

    const entriesByComponentUid = new Map<number, BoltEnchantUiEntry>();
    for (let i = 0; i < itemIds.length; i++) {
        const itemId = itemIds[i];
        if (!(itemId > 0)) continue;
        const componentId = BOLT_ENCHANT_ITEM_COMPONENT_START + i;
        const componentUid =
            ((BOLT_ENCHANT_CHATBOX_GROUP_ID & 0xffff) << 16) | (componentId & 0xffff);
        entriesByComponentUid.set(componentUid, {
            recipe,
            variant,
            maxSets: clampedMaxSets,
        });
    }
    if (entriesByComponentUid.size === 0) {
        return false;
    }

    clearBoltEnchantUiSession(player, services);
    interfaceService.openChatboxModal(
        player,
        BOLT_ENCHANT_CHATBOX_GROUP_ID,
        { kind: "bolt_enchant_quantity" },
        { preScripts: [{ scriptId: CHATBOX_RESET_SCRIPT_ID, args: [] }] },
    );

    const scriptArgs: (number | string)[] = [
        BOLT_ENCHANT_SKILLMULTI_MODE,
        clampedMaxSets,
        ...itemIds,
        1,
        buildBoltEnchantScriptLabelArg(title, labels),
    ];

    if (queueWidgetEvent) {
        queueWidgetEvent(player.id, {
            action: "run_script",
            scriptId: BOLT_ENCHANT_SCRIPT_ID,
            args: scriptArgs,
        });
    } else {
        queueClientScript!(player.id, BOLT_ENCHANT_SCRIPT_ID, ...scriptArgs);
    }

    boltEnchantUiSessions.set(player, {
        entriesByComponentUid,
        maxSets: clampedMaxSets,
        selectedSets: undefined,
        hasExplicitSelection: false,
    });
    return true;
}

function handleBoltEnchantQuantityWidgetAction(
    event: WidgetActionEvent,
    services: ScriptServices,
): void {
    const session = boltEnchantUiSessions.get(event.player);
    if (!session) return;
    const sessionMaxSets = Math.max(1, session.maxSets);

    const selectedSets = resolveBoltEnchantQuantitySelection(event, sessionMaxSets);
    if (selectedSets !== undefined) {
        session.selectedSets = Math.max(1, Math.min(sessionMaxSets, selectedSets));
        session.hasExplicitSelection = true;
        return;
    }

    const componentUid = ((event.groupId & 0xffff) << 16) | (event.childId & 0xffff);
    const entry = session.entriesByComponentUid.get(componentUid);
    if (!entry) return;

    const requestedFromSlot = event.slot !== undefined && event.slot > 0 ? event.slot : undefined;
    const requestedSets =
        session.hasExplicitSelection && session.selectedSets !== undefined
            ? session.selectedSets
            : requestedFromSlot ?? 1;
    const clampedRequestedSets = Math.max(1, Math.min(entry.maxSets, requestedSets));

    clearBoltEnchantUiSession(event.player, services, { closeInterface: true });
    startBoltEnchantAction(
        event.player,
        entry.recipe,
        entry.variant,
        clampedRequestedSets,
        event.tick,
        services,
    );
}

function resolveBoltEnchantQuantitySelection(
    event: WidgetActionEvent,
    maxSets: number,
): number | undefined {
    const childId = event.childId;
    if (childId === BOLT_ENCHANT_QTY_ONE_COMPONENT) return 1;
    if (childId === BOLT_ENCHANT_QTY_FIVE_COMPONENT) return 5;
    if (childId === BOLT_ENCHANT_QTY_TEN_COMPONENT) return 10;
    if (childId === BOLT_ENCHANT_QTY_ALL_COMPONENT) return maxSets;

    if (childId === BOLT_ENCHANT_QTY_OTHER_COMPONENT || childId === BOLT_ENCHANT_QTY_X_COMPONENT) {
        const parsed = parseBoltEnchantQuantityOption(event.option, maxSets);
        if (parsed !== undefined) return parsed;
    }

    return parseBoltEnchantQuantityOption(event.option, maxSets);
}

function parseBoltEnchantQuantityOption(
    option: string | undefined,
    maxSets: number,
): number | undefined {
    const normalized = option?.trim().toLowerCase();
    if (!normalized) return undefined;
    if (normalized === "all") return maxSets;
    if (!/^\d+$/.test(normalized)) return undefined;
    const parsed = parseInt(normalized, 10);
    if (parsed <= 0) return undefined;
    return Math.max(1, Math.min(maxSets, parsed));
}

function startBoltEnchantAction(
    player: PlayerState,
    recipe: BoltEnchantRecipe,
    variant: BoltEnchantVariant,
    requestedSets: number,
    tick: number,
    services: ScriptServices,
): void {
    const clampedSets = Math.max(1, requestedSets);
    const actionData: BoltEnchantActionData = {
        sourceItemId: variant.sourceItemId,
        enchantedItemId: variant.enchantedItemId,
        enchantedName: String(variant.enchantedName ?? ""),
        runeCosts: recipe.runeCosts.map((cost) => ({
            runeId: cost.runeId,
            quantity: Math.max(1, cost.quantity),
        })),
        xp: recipe.xp,
        count: clampedSets,
        animationId: CROSSBOW_BOLT_ENCHANT_ANIM_ID,
    };

    const result = services.requestAction(
        player,
        {
            kind: BOLT_ENCHANT_ACTION_KIND,
            data: actionData,
            delayTicks: 0,
            cooldownTicks: BOLT_ENCHANT_ACTION_DELAY_TICKS,
            groups: [BOLT_ENCHANT_ACTION_GROUP],
        },
        tick,
    );
    if (!result.ok) {
        services.sendGameMessage(player, "You can't enchant bolts right now.");
    }
}

function executeBoltEnchant(
    player: PlayerState,
    recipe: BoltEnchantRecipe,
    variant: BoltEnchantVariant,
    requestedSets: number,
    services: ScriptServices,
): void {
    const inventory = getPlayerInventory(player);
    const equipment = getPlayerEquipment(player);
    const availableSets = Math.floor(
        countInventoryItem(inventory, variant.sourceItemId) / BOLTS_PER_ENCHANT_SET,
    );
    if (!(availableSets > 0)) {
        services.sendGameMessage(player, "You don't have enough bolts to enchant.");
        return;
    }

    const runeValidation = RuneValidator.validateAndCalculate(
        recipe.runeCosts,
        inventory,
        equipment,
    );
    if (!runeValidation.canCast) {
        sendMissingRuneMessage(player, runeValidation, services);
        return;
    }

    const runesPerSet = runeValidation.runesConsumed ?? [];
    const runeLimitedSets = getRuneLimitedSets(inventory, runesPerSet);
    const maxSets = Math.max(0, Math.min(availableSets, runeLimitedSets));
    if (!(maxSets > 0)) {
        services.sendGameMessage(player, "You do not have the runes to cast this spell.");
        return;
    }

    const finalSets = Math.max(1, Math.min(maxSets, requestedSets));
    const boltsToEnchant = finalSets * BOLTS_PER_ENCHANT_SET;

    const totalRunesToConsume = runesPerSet.map((entry) => ({
        runeId: entry.runeId,
        quantity: Math.max(0, entry.quantity * finalSets),
    }));

    if (totalRunesToConsume.length > 0) {
        consumeRunesFromInventory(player, totalRunesToConsume, services, { snapshot: false });
    }

    const removedBolts = consumeItemFromInventory(
        player,
        variant.sourceItemId,
        boltsToEnchant,
        services,
    );
    if (!removedBolts) {
        services.sendGameMessage(player, "You don't have enough bolts to enchant.");
        return;
    }

    const added = services.addItemToInventory(player, variant.enchantedItemId, boltsToEnchant);
    if (added.added < boltsToEnchant) {
        services.sendGameMessage(player, "You don't have enough inventory space.");
        // Best-effort rollback for unexpected failure.
        services.addItemToInventory(player, variant.sourceItemId, boltsToEnchant);
        return;
    }

    if (services.playPlayerSeqImmediate) {
        services.playPlayerSeqImmediate(player, CROSSBOW_BOLT_ENCHANT_ANIM_ID);
    } else {
        services.playPlayerSeq?.(player, CROSSBOW_BOLT_ENCHANT_ANIM_ID);
    }
    services.addSkillXp?.(player, MAGIC_SKILL_ID, recipe.xp * finalSets);
    services.snapshotInventoryImmediate(player);
    services.sendGameMessage(player, `You enchant ${boltsToEnchant} ${variant.enchantedName}.`);
}

function handleCrossbowBoltEnchantments(player: PlayerState, services: ScriptServices): void {
    clearBoltEnchantUiSession(player, services);
    const inventory = getPlayerInventory(player);
    const equipment = getPlayerEquipment(player);
    const magicLevel = getMagicLevel(player);

    let hasAnyBoltType = false;
    let hasAnyEnchantableBolts = false;
    let hasLevelForAnyBolt = false;
    let requiredMagicLevel = 0;
    let missingRuneValidation: RuneValidationResult | undefined;

    for (const recipe of BOLT_ENCHANT_RECIPES) {
        for (const variant of recipe.variants) {
            if (countInventoryItem(inventory, variant.sourceItemId) > 0) {
                hasAnyBoltType = true;
                break;
            }
        }

        const variantResult = findBoltEnchantVariant(inventory, recipe);
        if (!variantResult) continue;
        hasAnyEnchantableBolts = true;

        if (magicLevel < recipe.levelRequired) {
            if (!(requiredMagicLevel > 0)) {
                requiredMagicLevel = recipe.levelRequired;
            }
            continue;
        }
        hasLevelForAnyBolt = true;

        const runeValidation = RuneValidator.validateAndCalculate(
            recipe.runeCosts,
            inventory,
            equipment,
        );
        if (!runeValidation.canCast) {
            if (!missingRuneValidation) {
                missingRuneValidation = runeValidation;
            }
            continue;
        }

        const runeLimitedSets = getRuneLimitedSets(inventory, runeValidation.runesConsumed ?? []);
        const maxSets = Math.max(0, Math.min(variantResult.availableSets, runeLimitedSets));
        if (!(maxSets > 0)) {
            if (!missingRuneValidation) {
                missingRuneValidation = runeValidation;
            }
            continue;
        }

        const opened = openBoltEnchantQuantityInterface(
            player,
            recipe,
            variantResult.variant,
            maxSets,
            services,
        );
        if (!opened) {
            executeBoltEnchant(player, recipe, variantResult.variant, maxSets, services);
        }
        return;
    }

    if (!hasAnyEnchantableBolts) {
        services.sendGameMessage(
            player,
            hasAnyBoltType
                ? "You need at least 10 bolts to enchant."
                : "You don't have any bolts to enchant.",
        );
        return;
    }
    if (!hasLevelForAnyBolt && requiredMagicLevel > 0) {
        services.sendGameMessage(
            player,
            `You need a Magic level of ${requiredMagicLevel} to cast this spell.`,
        );
        return;
    }
    if (missingRuneValidation) {
        sendMissingRuneMessage(player, missingRuneValidation, services);
        return;
    }
    services.sendGameMessage(player, "You don't have enough bolts to enchant.");
}

/**
 * Execute a teleport spell
 */
function executeTeleport(
    player: PlayerState,
    spell: TeleportSpellData,
    services: ScriptServices,
): void {
    if (!spell) return;

    // OSRS parity: Teleporting closes all interruptible interfaces
    services.closeInterruptibleInterfaces?.(player);

    const { destination, levelRequired, castAnimId, castSpotAnim, name, runeCosts } = spell;

    // Check magic level (skill 6 = Magic)
    const magicLevel = player.getSkill(SkillId.Magic).baseLevel;
    if (magicLevel < levelRequired) {
        services.sendGameMessage(
            player,
            `You need a Magic level of ${levelRequired} to cast ${name}.`,
        );
        return;
    }

    // Validate rune requirements
    const inventory = getPlayerInventory(player);
    const equipment = getPlayerEquipment(player);

    const runeValidation = RuneValidator.validateAndCalculate(
        runeCosts ?? [],
        inventory,
        equipment,
    );

    if (!runeValidation.canCast) {
        sendMissingRuneMessage(player, runeValidation, services);
        return;
    }

    const requestTeleportAction = services.requestTeleportAction;
    if (!requestTeleportAction) {
        services.logger?.warn?.(
            "[script:spellbook] requestTeleportAction service unavailable; teleport aborted",
        );
        return;
    }

    const teleportResult = requestTeleportAction(player, {
        x: destination.x,
        y: destination.y,
        level: destination.level,
        delayTicks: TELEPORT_DELAY_TICKS,
        cooldownTicks: TELEPORT_DELAY_TICKS,
        resetAnimation: true,
        endSpotAnim: spell.endSpotAnim,
        endSpotHeight: 0,
        endSpotDelay: 0,
        arriveSoundId: spell.arriveSoundId,
        arriveSoundRadius: 5,
        arriveSoundVolume: 255,
        arriveMessage: `You arrive at ${destination.name}.`,
        requireCanTeleport: true,
        rejectIfPending: true,
        replacePending: false,
    });
    if (!teleportResult.ok) {
        if (teleportResult.reason === "cannot_teleport") {
            services.sendGameMessage(player, "A magical force stops you from teleporting.");
        } else if (teleportResult.reason === "cooldown") {
            services.sendGameMessage(player, "You're already teleporting.");
        } else {
            services.sendGameMessage(player, "You can't teleport right now.");
        }
        return;
    }

    // Consume runes before teleporting
    if (runeValidation.runesConsumed && runeValidation.runesConsumed.length > 0) {
        consumeRunesFromInventory(player, runeValidation.runesConsumed, services);
    }

    // Play cast animation with immediate feedback
    if (castAnimId) {
        if (services.playPlayerSeqImmediate) {
            services.playPlayerSeqImmediate(player, castAnimId);
        } else {
            services.playPlayerSeq?.(player, castAnimId);
        }
    }

    // Play cast graphic with correct height based on spellbook type
    // Standard: 111 at height 92, Ancient: 392 at height 0, Lunar/Arceuus: 747 at height 120
    if (castSpotAnim) {
        let gfxHeight = 92; // Standard default
        if (spell.spellbook === "ancient") {
            gfxHeight = 0;
        } else if (spell.spellbook === "lunar" || spell.spellbook === "arceuus") {
            gfxHeight = 120;
        }
        services.broadcastPlayerSpot?.(player, castSpotAnim, gfxHeight, 0);
    }

    // Play cast sound
    if (spell.castSoundId) {
        services.playAreaSound?.({
            soundId: spell.castSoundId,
            tile: { x: player.tileX, y: player.tileY },
            level: player.level,
            radius: 5,
            volume: 255,
        });
    }

    services.sendGameMessage(player, `Teleporting to ${destination.name}...`);
}
