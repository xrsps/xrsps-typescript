import { type IScriptRegistry, type ScriptServices } from "../../../src/game/scripts/types";

const ZAFF_NPC_ID = 2880;

// Item IDs
const COINS = 995;
const BEACON_RING = 11014;
const BRYOPHYTAS_ESSENCE = 22372;
const BRYOPHYTAS_STAFF = 22368;
const BATTLESTAFF = 1391;
const BRYOPHYTA_STAFF_COST = 50_000;

// Varrock Achievement Diary varbits (value = 1 when completed)
const VARBIT_VARROCK_EASY = 4479;
const VARBIT_VARROCK_MEDIUM = 4480;
const VARBIT_VARROCK_HARD = 4481;
const VARBIT_VARROCK_ELITE = 4482;

// What Lies Below quest varp
const WHAT_LIES_BELOW_VARP = 992;
const WHAT_LIES_BELOW_COMPLETE = 110;

function openNpcDialog(
    player: any,
    services: any,
    dialogId: string,
    lines: string[],
    onContinue?: () => void,
    closeOnContinue?: boolean,
): void {
    services.openDialog?.(player, {
        kind: "npc",
        id: dialogId,
        npcId: ZAFF_NPC_ID,
        npcName: "Zaff",
        lines,
        clickToContinue: true,
        closeOnContinue: closeOnContinue ?? !onContinue,
        onContinue,
    });
}

function openPlayerDialog(
    player: any,
    services: any,
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

function hasCompletedAnyVarrockDiary(player: any): boolean {
    return (
        player.varps.getVarbitValue(VARBIT_VARROCK_EASY) >= 1 ||
        player.varps.getVarbitValue(VARBIT_VARROCK_MEDIUM) >= 1 ||
        player.varps.getVarbitValue(VARBIT_VARROCK_HARD) >= 1 ||
        player.varps.getVarbitValue(VARBIT_VARROCK_ELITE) >= 1
    );
}

function hasCompletedWhatLiesBelow(player: any): boolean {
    return player.varps.getVarpValue(WHAT_LIES_BELOW_VARP) >= WHAT_LIES_BELOW_COMPLETE;
}

function hasItemInBank(player: any, itemId: number): boolean {
    const bank = player.bank.getBankEntries();
    if (!bank) return false;
    for (const entry of bank) {
        if (entry.itemId === itemId && entry.quantity > 0) return true;
    }
    return false;
}

export function registerZaffHandlers(registry: IScriptRegistry, services: ScriptServices): void {
    const activeConvos = new Set<number>();

    function openMainOptions(player: any): void {
        const pid = player.id;
        const dialogBase = `zaff_${pid}`;
        const onClose = () => { activeConvos.delete(pid); };

        const options: string[] = ["Yes, please!", "No, thank you."];

        const hasDiary = hasCompletedAnyVarrockDiary(player);
        if (hasDiary) {
            options.push("Have you any extra stock of battlestaffs I can buy?");
        }

        const hasWLB = hasCompletedWhatLiesBelow(player);
        if (hasWLB) {
            options.push("Can I have another ring?");
        }

        const hasEssence = player.hasItem(BRYOPHYTAS_ESSENCE);
        if (hasEssence) {
            options.push("Can you make me a staff?");
        }

        services.openDialogOptions?.(player, {
            id: `${dialogBase}_options`,
            title: "Select an Option",
            options,
            onClose,
            onSelect: (choice: number) => {
                const selected = options[choice];
                handleMainOption(player, selected);
            },
        });
    }

    function handleMainOption(player: any, selected: string): void {
        const pid = player.id;
        const dialogBase = `zaff_${pid}`;

        switch (selected) {
            case "Yes, please!":
                activeConvos.delete(pid);
                services.openShop?.(player, { npcTypeId: ZAFF_NPC_ID });
                break;

            case "No, thank you.":
                activeConvos.delete(pid);
                break;

            case "Have you any extra stock of battlestaffs I can buy?":
                openPlayerDialog(
                    player,
                    services,
                    `${dialogBase}_diary_ask`,
                    ["Have you any extra stock of battlestaffs I can buy?"],
                    () => {
                        openNpcDialog(
                            player,
                            services,
                            `${dialogBase}_diary_reply`,
                            ["For you, my friend, maybe. Take a look in the barrel in the corner."],
                            () => { activeConvos.delete(pid); },
                        );
                    },
                );
                break;

            case "Can I have another ring?":
                handleBeaconRing(player);
                break;

            case "Can you make me a staff?":
                handleBryophytaStaff(player);
                break;

            default:
                activeConvos.delete(pid);
                break;
        }
    }

    function handleBeaconRing(player: any): void {
        const pid = player.id;
        const dialogBase = `zaff_${pid}`;
        const playerName = player.name ?? "adventurer";

        openPlayerDialog(
            player,
            services,
            `${dialogBase}_ring_ask`,
            ["Can I have another ring?"],
            () => {
                if (player.hasItem(BEACON_RING)) {
                    openNpcDialog(
                        player,
                        services,
                        `${dialogBase}_ring_inv`,
                        [`There's still one in your inventory, ${playerName}!`],
                        () => { activeConvos.delete(pid); },
                    );
                } else if (hasItemInBank(player, BEACON_RING)) {
                    openNpcDialog(
                        player,
                        services,
                        `${dialogBase}_ring_bank`,
                        [`Go and get the one that's in your bank, ${playerName}!`],
                        () => { activeConvos.delete(pid); },
                    );
                } else if (player.isInventoryFull()) {
                    openNpcDialog(
                        player,
                        services,
                        `${dialogBase}_ring_full`,
                        [
                            "I would be happy to give you another ring, but I'm afraid you don't have enough inventory space for it!",
                        ],
                        () => { activeConvos.delete(pid); },
                    );
                } else {
                    openNpcDialog(
                        player,
                        services,
                        `${dialogBase}_ring_give`,
                        [
                            `Yes, of course, ${playerName}. Here you are. Please bear in mind that this ring has no charges left with which to summon me, however.`,
                        ],
                        () => {
                            player.addItem(BEACON_RING, 1);
                            services.snapshotInventory(player);
                            services.sendGameMessage(player, "Zaff gives you a beacon ring.");
                            activeConvos.delete(pid);
                        },
                    );
                }
            },
        );
    }

    function handleBryophytaStaff(player: any): void {
        const pid = player.id;
        const dialogBase = `zaff_${pid}`;

        openPlayerDialog(
            player,
            services,
            `${dialogBase}_bryo_ask`,
            ["Can you make me a staff?"],
            () => {
                openNpcDialog(
                    player,
                    services,
                    `${dialogBase}_bryo_what`,
                    ["Make you a staff? With what?"],
                    () => {
                        openPlayerDialog(
                            player,
                            services,
                            `${dialogBase}_bryo_explain`,
                            [
                                "I found this magical essence when I was out on my adventures. I'd like to attach it to a battlestaff, but I'm not sure how to do that myself.",
                            ],
                            () => {
                                openNpcDialog(
                                    player,
                                    services,
                                    `${dialogBase}_bryo_see`,
                                    ["Let me see this essence."],
                                    () => {
                                        openNpcDialog(
                                            player,
                                            services,
                                            `${dialogBase}_bryo_show`,
                                            ["You show Zaff Bryophyta's essence."],
                                            () => {
                                                openNpcDialog(
                                                    player,
                                                    services,
                                                    `${dialogBase}_bryo_interest`,
                                                    ["Interesting, very interesting. This would indeed make a very nice staff."],
                                                    () => {
                                                        openNpcDialog(
                                                            player,
                                                            services,
                                                            `${dialogBase}_bryo_yourself`,
                                                            ["You could make it yourself if you wanted. Just attach the essence to a battlestaff."],
                                                            () => {
                                                                openNpcDialog(
                                                                    player,
                                                                    services,
                                                                    `${dialogBase}_bryo_happy`,
                                                                    ["Nevertheless, I'm happy to do it for you if you like."],
                                                                    () => {
                                                                        openNpcDialog(
                                                                            player,
                                                                            services,
                                                                            `${dialogBase}_bryo_offer`,
                                                                            [
                                                                                "I'll attach it to a battlestaff for you if you are willing to pay me 50,000 coins. How does that sound?",
                                                                            ],
                                                                            () => {
                                                                                showBryophytaConfirmation(player);
                                                                            },
                                                                        );
                                                                    },
                                                                );
                                                            },
                                                        );
                                                    },
                                                );
                                            },
                                        );
                                    },
                                );
                            },
                        );
                    },
                );
            },
        );
    }

    function showBryophytaConfirmation(player: any): void {
        const pid = player.id;
        const dialogBase = `zaff_${pid}`;
        const onClose = () => { activeConvos.delete(pid); };

        services.openDialogOptions?.(player, {
            id: `${dialogBase}_bryo_confirm`,
            title: "Allow Zaff to create Bryophyta's staff for you?",
            options: [
                "Yes, please. (Costs 50,000 coins and Bryophyta's essence)",
                "No, thanks.",
                "Talk about something else.",
            ],
            onClose,
            onSelect: (choice: number) => {
                if (choice === 0) {
                    handleBryophytaCraft(player);
                } else if (choice === 1) {
                    openPlayerDialog(
                        player,
                        services,
                        `${dialogBase}_bryo_no`,
                        ["No, thanks."],
                        () => {
                            openNpcDialog(
                                player,
                                services,
                                `${dialogBase}_bryo_later`,
                                ["I'll be here if you change your mind."],
                                () => { activeConvos.delete(pid); },
                            );
                        },
                    );
                } else {
                    // "Talk about something else." — return to main options
                    openMainGreeting(player);
                }
            },
        });
    }

    function handleBryophytaCraft(player: any): void {
        const pid = player.id;
        const dialogBase = `zaff_${pid}`;

        if (!player.hasItem(COINS, BRYOPHYTA_STAFF_COST)) {
            openPlayerDialog(
                player,
                services,
                `${dialogBase}_bryo_broke`,
                ["Oh, I don't have enough coins. I'll come back later."],
                () => { activeConvos.delete(pid); },
            );
            return;
        }

        if (!player.hasItem(BRYOPHYTAS_ESSENCE)) {
            activeConvos.delete(pid);
            return;
        }

        openPlayerDialog(
            player,
            services,
            `${dialogBase}_bryo_yes`,
            ["Yes, please."],
            () => {
                // Remove materials
                player.removeItem(BRYOPHYTAS_ESSENCE, 1, { assureFullRemoval: true });
                player.removeItem(COINS, BRYOPHYTA_STAFF_COST, { assureFullRemoval: true });

                openNpcDialog(
                    player,
                    services,
                    `${dialogBase}_bryo_handover`,
                    ["You hand over Bryophyta's essence and 50,000 coins to Zaff."],
                    () => {
                        openNpcDialog(
                            player,
                            services,
                            `${dialogBase}_bryo_done`,
                            ["Thank you, here you go. I'm not sure what it does, but it feels pretty magical."],
                            () => {
                                player.addItem(BRYOPHYTAS_STAFF, 1);
                                services.snapshotInventory(player);
                                services.sendGameMessage(player, "Zaff hands you the new staff.");

                                openPlayerDialog(
                                    player,
                                    services,
                                    `${dialogBase}_bryo_thanks`,
                                    ["Thanks!"],
                                    () => { activeConvos.delete(pid); },
                                );
                            },
                        );
                    },
                );
            },
        );
    }

    function openMainGreeting(player: any): void {
        const pid = player.id;
        const dialogBase = `zaff_${pid}`;

        openNpcDialog(
            player,
            services,
            `${dialogBase}_greeting`,
            ["Would you like to buy or sell some staffs?", "Or is there something else you need?"],
            () => {
                openMainOptions(player);
            },
        );
    }

    const zaffHandler = (event: any) => {
        const pid = event.player.id;
        if (activeConvos.has(pid)) return;
        activeConvos.add(pid);
        openMainGreeting(event.player);
    };

    registry.registerNpcScript({
        npcId: ZAFF_NPC_ID,
        option: "talk-to",
        handler: zaffHandler,
    });

    registry.registerNpcScript({
        npcId: ZAFF_NPC_ID,
        option: "trade",
        handler: ({ player, services: svc, tick }) => {
            svc.requestAction(
                player,
                {
                    kind: "npc.trade",
                    data: { npcTypeId: ZAFF_NPC_ID },
                    delayTicks: 0,
                    cooldownTicks: 0,
                    groups: ["npc.trade"],
                },
                tick,
            );
        },
    });

    registry.registerNpcScript({
        npcId: ZAFF_NPC_ID,
        option: undefined,
        handler: zaffHandler,
    });
}
