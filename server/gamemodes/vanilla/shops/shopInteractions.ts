import { type IScriptRegistry, type ScriptServices } from "../../../src/game/scripts/types";
import type { PlayerState } from "../../../src/game/player";

const AUBURY_NPC_TYPE_IDS = [2886, 11434];
const COMBAT_PATH_VOUCHER_ITEM_ID = 24131;
const COMBAT_PATH_REWARD_VARP = 12001;
const RUNE_MYSTERIES_VARP = 63;
const RUNE_MYSTERIES_COMPLETE_VALUE = 6;
const RUNE_ESSENCE_TELEPORT = { x: 2913, y: 4832, level: 0 };

function openNpcDialog(
    player: PlayerState,
    services: ScriptServices,
    dialogId: string,
    npcId: number,
    npcName: string,
    lines: string[],
    onContinue?: () => void,
    closeOnContinue?: boolean,
): void {
    services.openDialog?.(player, {
        kind: "npc",
        id: dialogId,
        npcId,
        npcName,
        lines,
        clickToContinue: true,
        closeOnContinue: closeOnContinue ?? !onContinue,
        onContinue,
    });
}

function openAuburyStandardOptions(
    player: PlayerState,
    services: ScriptServices,
    npcTypeId: number,
    canTeleport: boolean,
): void {
    const dialogBaseId = `aubury_${player.id}`;
    const auburyDialogNpcId = 2886; // real Aubury model for talk-head overlay

    const buildOptions = () => {
        const options: string[] = [
            "Can you tell me about your cape?",
            "I'd like to view your store please.",
            "No thank you.",
            "Yes please!",
            "Oh, it's a rune shop. No thank you, then.",
        ];

        if (canTeleport) {
            options.splice(2, 0, "Can you teleport me to the Rune Essence?");
        }
        return options;
    };

    openNpcDialog(
        player,
        services,
        `${dialogBaseId}_standard`,
        npcTypeId,
        "Aubury",
        ["Do you want to buy some runes?"],
        () => {
            services.openDialogOptions?.(player, {
                id: `${dialogBaseId}_standard_options`,
                title: "Aubury",
                options: buildOptions(),
                onSelect: (choice: number) => {
                    const options = buildOptions();
                    const selected = options[choice];
                    switch (selected) {
                        case "Can you tell me about your cape?":
                            openNpcDialog(
                                player,
                                services,
                                `${dialogBaseId}_cape_info`,
                                npcTypeId,
                                "Aubury",
                                [
                                    "Certainly! Skillcapes are a symbol of achievement.",
                                    "Only people who have mastered a skill and reached level 99 can get their hands on them and gain the benefits they carry.",
                                    "The Cape of Runecrafting has been upgraded with each talisman, allowing you to access all Runecrafting altars. Is there anything else I can help you with?",
                                ],
                                () => openAuburyStandardOptions(player, services, npcTypeId, canTeleport),
                            );
                            break;
                        case "I'd like to view your store please.":
                        case "Yes please!":
                            services.openShop?.(player, { npcTypeId });
                            break;
                        case "No thank you.":
                        case "Oh, it's a rune shop. No thank you, then.":
                            openPlayerDialog(player, services, `${dialogBaseId}_no_thanks`, [selected], () => {
                                openNpcDialog(player, services, `${dialogBaseId}_send_others`, auburyDialogNpcId, "Aubury", [
                                    "Well, if you find someone who does want runes, please send them my way.",
                                ]);
                            });
                            break;
                        case "Can you teleport me to the Rune Essence?":
                            openNpcDialog(player, services, `${dialogBaseId}_teleport_offer`, auburyDialogNpcId, "Aubury", [
                                "Of course. By the way, if you end up making any runes from the essence you mine, I'll happily buy them from you.",
                            ], () => {
                                openNpcDialog(player, services, `${dialogBaseId}_teleport_spell`, auburyDialogNpcId, "Aubury", [
                                    "Senventior Disthine Molenko!",
                                ], () => {
                                    services.teleportPlayer?.(player, RUNE_ESSENCE_TELEPORT.x, RUNE_ESSENCE_TELEPORT.y, RUNE_ESSENCE_TELEPORT.level);
                                });
                            });
                            break;
                        default:
                            openAuburyStandardOptions(player, services, npcTypeId, canTeleport);
                    }
                },
            });
        },
    );
}

function openPlayerDialog(
    player: PlayerState,
    services: ScriptServices,
    dialogId: string,
    lines: string[],
    onContinue?: () => void,
    closeOnContinue?: boolean,
): void {
    services.openDialog?.(player, {
        kind: "player",
        id: dialogId,
        playerName: player.name ?? "You",
        lines,
        clickToContinue: true,
        closeOnContinue: closeOnContinue ?? !onContinue,
        onContinue,
    });
}

export function registerShopInteractionHandlers(registry: IScriptRegistry, services: ScriptServices): void {
    registry.registerNpcAction("trade", ({ player, services, npc, tick }) => {
        if (npc?.typeId == null) return;
        services.requestAction(
            player,
            {
                kind: "npc.trade",
                data: { npcTypeId: npc.typeId },
                delayTicks: 0,
                cooldownTicks: 0,
                groups: ["npc.trade"],
            },
            tick,
        );
    });

    registry.registerNpcAction("trade-with", ({ player, services, npc, tick }) => {
        if (npc?.typeId == null) return;
        services.requestAction(
            player,
            {
                kind: "npc.trade",
                data: { npcTypeId: npc.typeId },
                delayTicks: 0,
                cooldownTicks: 0,
                groups: ["npc.trade"],
            },
            tick,
        );
    });

    for (const auburyNpcTypeId of AUBURY_NPC_TYPE_IDS) {
        const auburyHandler = ({ player, services }: { player: PlayerState; services: ScriptServices }) => {
            const auburyDialogNpcId = 2886; // actual Aubury head model for dialog
            const hasVoucher = player.items.hasItem(COMBAT_PATH_VOUCHER_ITEM_ID);
            const claims = player.varps.getVarpValue(COMBAT_PATH_REWARD_VARP);
            const claimedCombatRewards = claims >= 1;
            const hasRuneMysteries = player.varps.getVarpValue(RUNE_MYSTERIES_VARP) >= RUNE_MYSTERIES_COMPLETE_VALUE;
            const isMembersWorld = false; // TODO: adapt to world type if available

            const continueToStandard = () =>
                openAuburyStandardOptions(player, services, auburyNpcTypeId, hasRuneMysteries);

            if (hasVoucher && !claimedCombatRewards) {
                openNpcDialog(
                    player,
                    services,
                    `aubury_${player.id}_voucher_first`,
                    auburyDialogNpcId,
                    "Aubury",
                    ["Why yes, here are some air and mind runes."],
                    () => {
                        const airResult = player.items.addItem(556, 200, { assureFullInsertion: false });
                        const mindResult = player.items.addItem(558, 200, { assureFullInsertion: false });
                        if (airResult.completed < 200 || mindResult.completed < 200) {
                            services.sendGameMessage(player, "Not enough inventory space for the reward items.");
                        }
                        player.varps.setVarpValue(COMBAT_PATH_REWARD_VARP, 1);

                        if (!isMembersWorld) {
                            openNpcDialog(
                                player,
                                services,
                                `aubury_${player.id}_voucher_members`,
                                auburyDialogNpcId,
                                "Aubury",
                                [
                                    "I do have more rewards for you, but you need to be on a members world for me to give you the reward. Maybe there is something else I can help you with.",
                                ],
                                continueToStandard,
                            );
                        } else {
                            continueToStandard();
                        }
                    },
                );
                return;
            }

            if (hasVoucher && !isMembersWorld && !claimedCombatRewards) {
                openNpcDialog(
                    player,
                    services,
                    `aubury_${player.id}_voucher_members2`,
                    auburyDialogNpcId,
                    "Aubury",
                    [
                        "I do have more rewards for you, but you need to be on a members world for me to give you the reward. Maybe there is something else I can help you with.",
                    ],
                    continueToStandard,
                );
                return;
            }

            if (hasVoucher && claimedCombatRewards && !isMembersWorld) {
                openNpcDialog(
                    player,
                    services,
                    `aubury_${player.id}_voucher_claimed`,
                    auburyDialogNpcId,
                    "Aubury",
                    [
                        "I do have more rewards for you, but you need to be on a members world for me to give you the reward. Maybe there is something else I can help you with.",
                    ],
                    continueToStandard,
                );
                return;
            }

            continueToStandard();
        };

        registry.registerNpcScript({
            npcId: auburyNpcTypeId,
            option: "talk-to",
            handler: auburyHandler,
        });
        registry.registerNpcScript({
            npcId: auburyNpcTypeId,
            option: "trade",
            handler: ({ player, services, tick }) => {
                services.requestAction(
                    player,
                    {
                        kind: "npc.trade",
                        data: { npcTypeId: auburyNpcTypeId },
                        delayTicks: 0,
                        cooldownTicks: 0,
                        groups: ["npc.trade"],
                    },
                    tick,
                );
            },
        });
        registry.registerNpcScript({
            npcId: auburyNpcTypeId,
            option: "trade-with",
            handler: ({ player, services, tick }) => {
                services.requestAction(
                    player,
                    {
                        kind: "npc.trade",
                        data: { npcTypeId: auburyNpcTypeId },
                        delayTicks: 0,
                        cooldownTicks: 0,
                        groups: ["npc.trade"],
                    },
                    tick,
                );
            },
        });
        registry.registerNpcScript({
            npcId: auburyNpcTypeId,
            option: undefined,
            handler: auburyHandler,
        });
    }
}
