import { MAX_REAL_LEVEL, SkillId, getXpForLevel } from "../../../../src/rs/skill/skills";
import { VARBIT_ACTIVE_SPELLBOOK } from "../../../../src/shared/vars";
import { SpellbookName } from "../../data/spellWidgetLoader";
import { getItemDefinition } from "../../data/items";
import { ALL_RUNE_ITEM_IDS, RUNE_IDS } from "../../game/data/RuneDataProvider";
import { getSpellData } from "../../game/spells/SpellDataProvider";
import { getCollectionLogItems } from "../../game/collectionlog";
import { clearAutocastState } from "../../game/combat/AutocastState";
import type { PlayerState } from "../../game/player";
import type { MessageHandlerServices } from "../MessageHandlers";
import type { MessageHandler, MessageRouter } from "../MessageRouter";
import { logger } from "../../utils/logger";

const DEBUG_SCROLL_TITLE = "Clue Compass";
const DEBUG_SCROLL_OPTIONS = [
    "Arceuus Library",
    "Barrows",
    "Catherby",
    "Champions' Guild",
    "Draynor Village",
    "Falador Park",
    "Fishing Guild",
    "Hosidius Kitchen",
    "Karamja Volcano",
    "Lighthouse",
    "Lumbridge Swamp",
    "Mort'ton",
    "Musa Point",
    "Port Sarim",
    "Seers' Village",
    "Shayzien",
    "Varrock Palace",
    "Waterbirth Island",
    "Yanille",
    "Zanaris",
];

const DEFAULT_CHAT_PREFIX = "";

function pickRandomUnownedCollectionLogItemId(player: PlayerState): number | null {
    const candidates = Array.from(getCollectionLogItems()).filter(
        (itemId) => !player.collectionLog.hasItem(itemId),
    );
    if (candidates.length <= 0) {
        return null;
    }
    const index = Math.floor(Math.random() * candidates.length);
    return candidates[index] ?? null;
}

type InventoryLoadoutEntry = {
    itemId: number;
    quantity: number;
};

function replaceInventoryContents(
    player: PlayerState,
    entries: readonly InventoryLoadoutEntry[],
): boolean {
    const slotCount = player.items.getInventoryEntries().length;
    if (entries.length > slotCount) {
        return false;
    }

    player.items.clearInventory();
    for (let slot = 0; slot < entries.length; slot++) {
        const entry = entries[slot];
        if (!(entry?.itemId > 0) || !(entry.quantity > 0)) {
            continue;
        }
        player.items.setInventorySlot(slot, entry.itemId, entry.quantity);
    }

    return true;
}

// ========== Quest unlock data ==========
// Maps quest names to their varp ID and completion value.
// Varp-based quests set the varp to the completion value.
// Varbit-based quests use negative varpId as a signal (handled separately).
const QUEST_DATA: Array<{
    name: string;
    aliases: string[];
    varpId: number;
    completionValue: number;
    varbitEntries?: Array<{ varbitId: number; value: number }>;
    unlocks: string;
}> = [
    {
        name: "Desert Treasure",
        aliases: ["dt", "desert", "deserttreasure"],
        varpId: 440,
        completionValue: 15,
        unlocks: "Ancient Magicks spellbook",
    },
    {
        name: "Lunar Diplomacy",
        aliases: ["lunar", "lunardiplomacy"],
        varpId: 823,
        completionValue: 190,
        unlocks: "Lunar spellbook",
    },
    {
        name: "Legend's Quest",
        aliases: ["legends", "legendsquest"],
        varpId: 139,
        completionValue: 180,
        unlocks: "Charge spell",
    },
    {
        name: "Underground Pass",
        aliases: ["undergroundpass", "underground", "iban"],
        varpId: 161,
        completionValue: 110,
        varbitEntries: [{ varbitId: 9133, value: 1 }], // Iban book read
        unlocks: "Iban Blast",
    },
    {
        name: "Mage Arena",
        aliases: ["magearena", "ma1"],
        varpId: 267,
        completionValue: 8,
        unlocks: "God spells (Claws of Guthix, Flames of Zamorak, Saradomin Strike)",
    },
    {
        name: "Mage Arena II",
        aliases: ["magearena2", "ma2", "magearenaii"],
        varpId: -1, // varbit only
        completionValue: 0,
        varbitEntries: [{ varbitId: 6067, value: 6 }],
        unlocks: "Enhanced god spells",
    },
    {
        name: "Eadgar's Ruse",
        aliases: ["eadgar", "eadgarsruse", "eadgars"],
        varpId: 335,
        completionValue: 110,
        unlocks: "Trollheim Teleport",
    },
    {
        name: "Watchtower",
        aliases: ["watchtower"],
        varpId: 212,
        completionValue: 13,
        unlocks: "Watchtower Teleport",
    },
    {
        name: "Plague City",
        aliases: ["plaguecity", "plague"],
        varpId: 165,
        completionValue: 29,
        unlocks: "Ardougne Teleport (prerequisite)",
    },
    {
        name: "Biohazard",
        aliases: ["biohazard"],
        varpId: 68,
        completionValue: 16,
        unlocks: "Ardougne Teleport",
    },
    {
        name: "Client of Kourend",
        aliases: ["clientofkourend", "kourend", "cok"],
        varpId: -1,
        completionValue: 0,
        varbitEntries: [{ varbitId: 5619, value: 9 }],
        unlocks: "Kourend Castle Teleport",
    },
    {
        name: "Dream Mentor",
        aliases: ["dreammentor", "dream"],
        varpId: -1,
        completionValue: 0,
        varbitEntries: [{ varbitId: 3618, value: 28 }],
        unlocks: "Spellbook Swap, extra Lunar spells",
    },
    {
        name: "Arceuus Favour",
        aliases: ["arceuus", "arceuusfavour", "arceuusfavor"],
        varpId: -1,
        completionValue: 0,
        varbitEntries: [
            { varbitId: 4896, value: 1000 },
            { varbitId: 9631, value: 1 },
        ],
        unlocks: "Arceuus spellbook",
    },
];

function handleQuestCommand(
    sender: PlayerState,
    args: string[],
    services: Pick<MessageHandlerServices, "queueChatMessage" | "queueVarp" | "queueVarbit">,
): void {
    const reply = (text: string) =>
        services.queueChatMessage({
            messageType: "game",
            text,
            targetPlayerIds: [sender.id],
        });

    if (args.length === 0 || args[0] === "list") {
        reply("Available quests: " + QUEST_DATA.map((q) => q.name).join(", "));
        reply("Usage: ::quest <name> — e.g. ::quest desert treasure");
        return;
    }

    // Join args and normalize for matching
    const search = args.join("").toLowerCase().replace(/[^a-z0-9]/g, "");

    // Try alias match first, then fuzzy name match
    const quest =
        QUEST_DATA.find((q) => q.aliases.includes(search)) ??
        QUEST_DATA.find((q) => q.name.toLowerCase().replace(/[^a-z0-9]/g, "").includes(search));

    if (!quest) {
        reply(`Unknown quest "${args.join(" ")}". Use ::quest list to see available quests.`);
        return;
    }

    // Set varp if applicable
    if (quest.varpId >= 0) {
        sender.varps.setVarpValue(quest.varpId, quest.completionValue);
        services.queueVarp(sender.id, quest.varpId, quest.completionValue);
    }

    // Set varbits if applicable
    if (quest.varbitEntries) {
        for (const { varbitId, value } of quest.varbitEntries) {
            sender.varps.setVarbitValue(varbitId, value);
            services.queueVarbit(sender.id, varbitId, value);
        }
    }

    reply(`Completed "${quest.name}" — unlocks: ${quest.unlocks}`);
    logger.info(`[cmd] ::quest - Player ${sender.id} completed "${quest.name}"`);
}

function createChatHandler(services: MessageHandlerServices): MessageHandler<"chat"> {
    return (ctx) => {
        try {
            const payload = ctx.payload;
            const text = payload.text.trim();
            logger.info(`[chat] Received chat message: "${text}"`);
            if (!text) return;

            const sender = ctx.player;
            if (!sender) {
                logger.warn("[chat] No sender found for chat message");
                return;
            }

            // Handle :: commands
            if (text.startsWith("::")) {
                const rawCmd = text.slice(2).trim();
                const cmd = rawCmd.toLowerCase();
                const senderName = sender.name || "Player";
                logger.info(`[cmd] Player ${sender.id} (${senderName}) used command: ::${cmd}`);
                const parts = cmd.split(/\s+/).filter((part) => part.length > 0);
                const root = parts[0] ?? "";

                if (root === "steer") {
                    // `::steer <directive text>` — route through the
                    // bot-SDK to every connected 'scape agent as an
                    // operator command. Preserve the original casing
                    // from `rawCmd` so agents see the human's exact
                    // words, not a lowercased version.
                    const directiveText = rawCmd.slice("steer".length).trim();
                    if (!directiveText) {
                        services.queueChatMessage({
                            messageType: "game",
                            text: "Usage: ::steer <directive text>",
                            targetPlayerIds: [sender.id],
                        });
                        return;
                    }
                    const delivered = services.broadcastOperatorCommand?.(
                        "chat",
                        directiveText,
                        sender.id,
                        senderName,
                    ) ?? 0;
                    services.queueChatMessage({
                        messageType: "game",
                        text:
                            delivered > 0
                                ? `Steered ${delivered} agent${delivered === 1 ? "" : "s"}.`
                                : "No connected 'scape agents to steer.",
                        targetPlayerIds: [sender.id],
                    });
                    logger.info(
                        `[cmd] ::steer from ${senderName} (id=${sender.id}) → ${delivered} agent(s): "${directiveText.slice(0, 80)}"`,
                    );
                    return;
                }

                if (root === "clear") {
                    try {
                        services.clearActionsInGroup(sender.id, "inventory");
                    } catch (err) { logger.warn("Failed to clear inventory actions on ::clear command", err); }

                    sender.items.clearInventory();
                    services.queueChatMessage({
                        messageType: "game",
                        text: "Your inventory has been cleared.",
                        targetPlayerIds: [sender.id],
                    });
                    logger.info(`[cmd] ::clear - Cleared inventory for player ${sender.id}`);
                    return;
                }

                if (root === "allrunes") {
                    const quantityArg = parts[1];
                    const quantity =
                        quantityArg === undefined
                            ? 10000
                            : Math.floor(Number.parseInt(quantityArg, 10));
                    if (!Number.isFinite(quantity) || quantity <= 0) {
                        services.queueChatMessage({
                            messageType: "game",
                            text: "Usage: ::allrunes [quantity]",
                            targetPlayerIds: [sender.id],
                        });
                        return;
                    }

                    try {
                        services.clearActionsInGroup(sender.id, "inventory");
                    } catch (err) { logger.warn("Failed to clear inventory actions on ::allrunes command", err); }

                    const runeLoadout: InventoryLoadoutEntry[] = ALL_RUNE_ITEM_IDS.map((itemId) => ({
                        itemId,
                        quantity,
                    }));
                    if (!replaceInventoryContents(sender, runeLoadout)) {
                        services.queueChatMessage({
                            messageType: "game",
                            text: "Unable to load ::allrunes into your inventory.",
                            targetPlayerIds: [sender.id],
                        });
                        return;
                    }

                    services.queueChatMessage({
                        messageType: "game",
                        text: `Replaced your inventory with all ${ALL_RUNE_ITEM_IDS.length} rune types x${quantity}.`,
                        targetPlayerIds: [sender.id],
                    });
                    logger.info(
                        `[cmd] ::${root} - Loaded player ${sender.id} inventory with ${ALL_RUNE_ITEM_IDS.length} rune types x${quantity}`,
                    );
                    return;
                }

                if (root === "randomitem") {
                    const itemId = pickRandomUnownedCollectionLogItemId(sender);
                    if (typeof itemId !== "number" || !Number.isFinite(itemId) || itemId <= 0) {
                        services.queueChatMessage({
                            messageType: "game",
                            text: "No unowned collection log items remain for ::randomitem.",
                            targetPlayerIds: [sender.id],
                        });
                        return;
                    }

                    const addResult = sender.items.addItem(itemId, 1, { assureFullInsertion: true });
                    if (addResult.completed !== 1) {
                        services.queueChatMessage({
                            messageType: "game",
                            text: "Not enough inventory space for ::randomitem.",
                            targetPlayerIds: [sender.id],
                        });
                        return;
                    }

                    services.trackCollectionLogItem(sender, itemId);

                    const itemName = getItemDefinition(itemId)?.name?.trim() || `Item ${itemId}`;
                    logger.info(
                        `[cmd] ::randomitem - Gave player ${sender.id} collection log item ${itemId} (${itemName})`,
                    );
                    return;
                }

                if (root === "smithing") {
                    const levelArgRaw = parts[1];
                    const levelArg = levelArgRaw ? parseInt(levelArgRaw, 10) : NaN;
                    if (!Number.isFinite(levelArg)) {
                        services.queueChatMessage({
                            messageType: "game",
                            text: "Usage: ::smithing <1-99>",
                            targetPlayerIds: [sender.id],
                        });
                        return;
                    }

                    const targetLevel = Math.min(MAX_REAL_LEVEL, Math.max(1, Math.floor(levelArg)));
                    const previousLevel = sender.skillSystem.getSkill(SkillId.Smithing).baseLevel;
                    sender.skillSystem.setSkillXp(SkillId.Smithing, getXpForLevel(targetLevel));

                    if (targetLevel > previousLevel && services.eventBus) {
                        services.eventBus.emit("skill:levelUp", {
                            player: sender,
                            skillId: SkillId.Smithing,
                            oldLevel: previousLevel,
                            newLevel: targetLevel,
                        });
                    }

                    services.queueChatMessage({
                        messageType: "game",
                        text: `Your Smithing level is now ${targetLevel}.`,
                        targetPlayerIds: [sender.id],
                    });
                    logger.info(
                        `[cmd] ::smithing - Player ${sender.id} set Smithing to ${targetLevel}`,
                    );
                    return;
                }

                if (root === "rubytest") {
                    const grants: Array<{ itemId: number; quantity: number }> = [
                        { itemId: 9339, quantity: 100 },
                        { itemId: RUNE_IDS.COSMIC, quantity: 20 },
                        { itemId: RUNE_IDS.FIRE, quantity: 100 },
                        { itemId: RUNE_IDS.BLOOD, quantity: 20 },
                    ];
                    const added: Array<{ itemId: number; quantity: number }> = [];

                    for (const grant of grants) {
                        const tx = sender.items.addItem(grant.itemId, grant.quantity, {
                            assureFullInsertion: true,
                        });
                        if (tx?.completed < grant.quantity) {
                            for (const prior of added) {
                                sender.items.removeItem(prior.itemId, prior.quantity, {
                                    assureFullRemoval: false,
                                });
                            }
                            services.queueChatMessage({
                                messageType: "game",
                                text: "Not enough inventory space for ::rubytest.",
                                targetPlayerIds: [sender.id],
                            });
                            return;
                        }
                        added.push({ itemId: grant.itemId, quantity: grant.quantity });
                    }

                    const beforeMagic = sender.skillSystem.getSkill(SkillId.Magic).baseLevel;
                    if (beforeMagic < 49) {
                        sender.skillSystem.setSkillXp(SkillId.Magic, getXpForLevel(49));
                    }

                    services.queueChatMessage({
                        messageType: "game",
                        text: "Ruby enchant test pack added: ruby bolts + runes (10 sets).",
                        targetPlayerIds: [sender.id],
                    });
                    logger.info(
                        `[cmd] ::rubytest - Gave player ${
                            sender.id
                        } ruby enchant test pack; magic ${beforeMagic}->${Math.max(
                            beforeMagic,
                            49,
                        )}`,
                    );
                    return;
                }

                if (root === "scroll") {
                    services.openIndexedMenu(sender, {
                        title: DEBUG_SCROLL_TITLE,
                        options: DEBUG_SCROLL_OPTIONS,
                        onSelect: (player, optionIndex, optionLabel) => {
                            services.queueChatMessage({
                                messageType: "game",
                                text: `Selected ${optionIndex + 1}: ${optionLabel}`,
                                targetPlayerIds: [player.id],
                            });
                            logger.info(
                                `[cmd] ::scroll - Player ${player.id} selected option ${
                                    optionIndex + 1
                                } (${optionLabel})`,
                            );
                        },
                    });
                    logger.info(
                        `[cmd] ::scroll - Opened menu_indexed test menu for player ${sender.id}`,
                    );
                    return;
                }

                if (root === "quest") {
                    handleQuestCommand(sender, parts.slice(1), services);
                    return;
                }

                if (root === "spawn") {
                    services.teleportPlayer(sender, 3222, 3218, 0);
                    services.queueChatMessage({
                        messageType: "game",
                        text: "Teleported to Lumbridge.",
                        targetPlayerIds: [sender.id],
                    });
                    logger.info(`[cmd] ::spawn - Player ${sender.id} teleported to Lumbridge`);
                    return;
                }

                if (root === "pos") {
                    services.queueChatMessage({
                        messageType: "game",
                        text: `Position: (${sender.tileX}, ${sender.tileY}, ${sender.level})`,
                        targetPlayerIds: [sender.id],
                    });
                    return;
                }

                if (cmd === "levelup") {
                    const skillIds = [
                        0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
                        22, 23,
                    ];
                    const randomSkill = skillIds[Math.floor(Math.random() * skillIds.length)];
                    const skill = sender.skillSystem.getSkill(randomSkill as SkillId);
                    const currentLevel = skill.baseLevel;
                    const newLevel = Math.min(99, currentLevel + 1);
                    if (newLevel > currentLevel && sender.skillSystem.setSkillXp) {
                        const newXp = getXpForLevel(newLevel);
                        sender.skillSystem.setSkillXp(randomSkill, newXp);
                        if (services.eventBus) {
                            services.eventBus.emit("skill:levelUp", {
                                player: sender,
                                skillId: randomSkill as any,
                                oldLevel: currentLevel,
                                newLevel,
                            });
                        }
                        logger.info(
                            `[cmd] ::levelup - Player ${sender.id} leveled up skill ${randomSkill} to ${newLevel}`,
                        );
                    }
                } else if (cmd === "whip") {
                    const tx = sender.items.addItem(4151, 1, { assureFullInsertion: true });
                    if (tx.completed === 1) {
                        logger.info(`[cmd] ::whip - Gave player ${sender.id} an Abyssal whip`);
                    }
                } else if (cmd === "bond") {
                    const tx = sender.items.addItem(50000, 1, { assureFullInsertion: true });
                    if (tx.completed === 1) {
                        logger.info(`[cmd] ::bond - Gave player ${sender.id} a $5 Bond`);
                    }
                } else if (cmd.startsWith("item ")) {
                    const parts = cmd.split(" ").filter((p) => p.length > 0);
                    const itemId = parseInt(parts[1], 10);
                    const quantity = parseInt(parts[2], 10) || 1;
                    if (Number.isFinite(itemId) && itemId > 0) {
                        const tx = sender.items.addItem(itemId, quantity, {
                            assureFullInsertion: false,
                        });
                        if (tx.completed > 0) {
                            logger.info(
                                `[cmd] ::item - Gave player ${sender.id} item ${itemId} x${tx.completed}`,
                            );
                        }
                    }
                } else if (cmd === "kill") {
                    logger.info(`[cmd] ::kill - Player ${sender.id} killed themselves`);
                    sender.skillSystem.setHitpointsCurrent(0);
                } else if (
                    root === SpellbookName.Standard ||
                    root === SpellbookName.Ancient ||
                    root === SpellbookName.Lunar ||
                    root === SpellbookName.Arceuus
                ) {
                    // Varbit 4070 controls the active spellbook in CS2 scripts
                    // 0 = standard, 1 = ancient, 2 = lunar, 3 = arceuus
                    // Note: "::normal" is intercepted client-side by the OSRS CS2 chatbox
                    // script (it toggles display mode), so we use "::standard" instead.
                    const SPELLBOOK_VALUES: Record<string, number> = {
                        standard: 0,
                        ancient: 1,
                        lunar: 2,
                        arceuus: 3,
                    };
                    const value = SPELLBOOK_VALUES[root]!;
                    // Update server-side state
                    sender.varps.setVarbitValue(VARBIT_ACTIVE_SPELLBOOK, value);
                    // Transmit varbit to client
                    services.queueVarbit(sender.id, VARBIT_ACTIVE_SPELLBOOK, value);

                    // Clear autocast when switching to a spellbook
                    // that doesn't contain the current autocast spell.
                    if (sender.combat.autocastEnabled && sender.combat.spellId > 0) {
                        const autocastSpellData = getSpellData(sender.combat.spellId);
                        if (!autocastSpellData || autocastSpellData.spellbook !== root) {
                            clearAutocastState(sender, {
                                sendVarbit: (player, varbitId, varbitValue) =>
                                    services.queueVarbit(player.id, varbitId, varbitValue),
                            });
                        }
                    }
                    // Run CS2 script 2610 to redraw the spellbook interface,
                    // passing the varbit inline so the script sees it immediately
                    const SCRIPT_MAGIC_SPELLBOOK_REDRAW = 2610;
                    const SPELLBOOK_REDRAW_ARGS: (number | string)[] = [
                        14286851, 14287045, 14287054, 14286849, 14287051,
                        14287052, 14287053, 14286850, 14287047, 14287050,
                        0, "Info", "Filters",
                    ];
                    services.queueWidgetEvent(sender.id, {
                        action: "run_script",
                        scriptId: SCRIPT_MAGIC_SPELLBOOK_REDRAW,
                        args: SPELLBOOK_REDRAW_ARGS,
                        varbits: { [VARBIT_ACTIVE_SPELLBOOK]: value },
                    });
                    services.queueChatMessage({
                        messageType: "game",
                        text: `Switched to the ${root} spellbook.`,
                        targetPlayerIds: [sender.id],
                    });
                    logger.info(
                        `[cmd] ::${root} - Player ${sender.id} switched to ${root} spellbook`,
                    );
                    return;
                }

                // Fallthrough to script-registered commands
                const scriptCmd = services.findScriptCommand?.(root);
                if (scriptCmd) {
                    try {
                        const result = scriptCmd({
                            player: sender,
                            command: root,
                            args: parts.slice(1),
                            tick: services.getCurrentTick(),
                            services: services as unknown as Record<string, unknown>,
                        });
                        const response = typeof result === "string" ? result : undefined;
                        if (response?.trim()) {
                            services.queueChatMessage({
                                messageType: "game",
                                text: response.trim(),
                                targetPlayerIds: [sender.id],
                            });
                        }
                    } catch (err) {
                        logger.warn(`[cmd] script command ::${root} failed`, err);
                    }
                }
                return;
            }

            // Regular chat message
            const senderName = sender.name || "Player";
            const messageType = payload.messageType === "game" ? "game" : "public";
            const colorIdRaw = payload.colorId;
            const effectIdRaw = payload.effectId;
            let colorId =
                typeof colorIdRaw === "number" && Number.isFinite(colorIdRaw) && colorIdRaw >= 0
                    ? colorIdRaw & 0xff
                    : 0;
            let effectId =
                typeof effectIdRaw === "number" &&
                Number.isFinite(effectIdRaw) &&
                effectIdRaw >= 0
                    ? effectIdRaw & 0xff
                    : 0;
            if (effectId > 5) effectId = 0;
            if (colorId > 20) colorId = 0;

            const expectedExtraLen = colorId >= 13 && colorId <= 20 ? colorId - 12 : 0;
            let pattern: number[] | undefined = undefined;
            if (expectedExtraLen > 0 && Array.isArray(payload.pattern)) {
                const rawPattern = payload.pattern;
                const out: number[] = [];
                for (let i = 0; i < rawPattern.length && out.length < expectedExtraLen; i++) {
                    const v = rawPattern[i];
                    if (!Number.isFinite(v)) continue;
                    out.push(v & 0xff);
                }
                if (out.length === expectedExtraLen) pattern = out;
            }

            services.queueChatMessage({
                messageType,
                playerId: sender.id,
                from: senderName,
                prefix: DEFAULT_CHAT_PREFIX,
                text,
                playerType: services.getPublicChatPlayerType(sender),
                colorId,
                effectId,
                pattern,
                autoChat: false,
            });
        } catch (err) {
            logger.warn("[chat] message handling failed", err);
        }
    };
}

export function registerChatHandler(router: MessageRouter, services: MessageHandlerServices): void {
    router.register("chat", createChatHandler(services));
}
