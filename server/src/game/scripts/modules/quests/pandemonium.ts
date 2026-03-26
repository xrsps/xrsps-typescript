import { BaseComponentUids } from "../../../../widgets/viewport/ViewportEnumService";
import {
    createEmptyTemplateChunks,
    packTemplateChunk,
} from "../../../../../../src/shared/instance/InstanceTypes";
import type { NpcInteractionEvent, ScriptModule, ScriptServices } from "../../types";

// ============================================================================
// NPC IDs
// ============================================================================

const ANNE_SARIM_NPC_ID = 14962; // sailing_intro_anne_sarim
const WILL_SARIM_NPC_ID = 14957; // sailing_intro_will_sarim
const WILL_BOAT_NPC_ID = 14958; // sailing_intro_will_boat
const ANNE_BOAT_NPC_ID = 14963; // sailing_intro_anne_boat

// ============================================================================
// Varbits
// ============================================================================

const VARBIT_SAILING_INTRO = 18314;
const VARBIT_MINIMAP_STATE = 6719;
const VARBIT_SAILING_BOARDED_BOAT = 19136;
const VARBIT_SAILING_BOARDED_BOAT_TYPE = 19137;
const VARBIT_SAILING_BOARDED_BOAT_WORLD = 19122;
const VARBIT_SAILING_PLAYER_IS_ON_PLAYER_BOAT = 19104;
const VARBIT_SAILING_SIDEPANEL_PLAYER_ROLE = 19233;
const VARBIT_SAILING_SIDEPANEL_BOAT_MOVE_MODE = 19175;
const VARBIT_SAILING_SIDEPANEL_PLAYERS_ON_BOARD_TOTAL = 19235;
const VARBIT_SAILING_SIDEPANEL_BOAT_HP_MAX = 19177;
const VARBIT_SAILING_SIDEPANEL_BOAT_HP = 19181;
const VARBIT_SAILING_SIDEPANEL_HELM_STATUS = 19176;
const VARBIT_SAILING_SIDEPANEL_VISIBLE_FROM_COMBAT_TAB = 19153;
const VARBIT_SAILING_SIDEPANEL_VISIBLE = 19151;
const VARBIT_SAILING_SIDEPANEL_AMMO_NEEDS_UPDATE = 19236;
const VARBIT_SAILING_SIDEPANEL_BOAT_STATS_NEEDS_UPDATE = 19237;
const VARBIT_SAILING_PRELOADED_ANIMS = 19118;
const VARBIT_SAILING_SIDEPANEL_BOAT_BASESPEED = 19250;
const VARBIT_SAILING_SIDEPANEL_BOAT_SPEEDCAP = 19251;
const VARBIT_SAILING_SIDEPANEL_BOAT_SPEEDBOOST_DURATION = 19256;
const VARBIT_SAILING_SIDEPANEL_BOAT_ACCELERATION = 19257;

// ============================================================================
// Varps
// ============================================================================

const VARP_SAILING_SIDEPANEL_BOAT_TYPE = 5117;
const VARP_SAILING_SIDEPANEL_BOAT_DEFENCE = 5147;
const VARP_SAILING_SIDEPANEL_BOAT_ARMOUR = 5148;
const VARP_SAILING_SIDEPANEL_BOATSTAT_TOTAL_STABDEF = 5159;
const VARP_SAILING_SIDEPANEL_BOATSTAT_TOTAL_SLASHDEF = 5160;
const VARP_SAILING_SIDEPANEL_BOATSTAT_TOTAL_CRUSHDEF = 5161;
const VARP_SAILING_SIDEPANEL_BOATSTAT_TOTAL_MAGICDEF = 5162;
const VARP_SAILING_SIDEPANEL_BOATSTAT_TOTAL_HEAVYRANGEDDEF = 5163;
const VARP_SAILING_SIDEPANEL_BOATSTAT_TOTAL_STANDARDRANGEDDEF = 5164;
const VARP_SAILING_SIDEPANEL_BOATSTAT_TOTAL_LIGHTRANGEDDEF = 5165;

// ============================================================================
// Teleport destination (sailing intro instance)
// ============================================================================

const SAILING_INTRO_X = 3052;
const SAILING_INTRO_Y = 3204;
const SAILING_INTRO_LEVEL = 0;

// ============================================================================
// Interface constants
// ============================================================================

const FADE_OVERLAY_GROUP = 174;
const FADE_OVERLAY_MESSAGE_CHILD = 4;
const SAILING_SIDEPANEL_GROUP = 937;
const SAILING_INTRO_HUD_GROUP = 345;
const HPBAR_HUD_GROUP = 303;
const HPBAR_HUD_HP_CHILD = 5;

const SCRIPT_FADE = 948;
const SCRIPT_HIDE_HPBAR = 2249;
const SCRIPT_SAILING_CREW_INIT = 8776;
const SCRIPT_SIDEBAR_TAB = 915;
const SCRIPT_COMBAT_LEVEL = 5224;
const SCRIPT_CAMERA_BOUNDS = 603;
const SCRIPT_PRELOAD_ANIM = 1846;

const SYNTH_BOARD_BOAT = 10754;

// Anim IDs to preload on the boat
const PRELOAD_ANIM_IDS = [
    13199, 13200, 13202, 13203, 13205, 13217, 13219, 13221, 13222, 13223, 13225, 13255, 13256,
    13260, 13261, 13265, 13266, 13270, 13271,
];

// Quest states:
// 0 = not started
// 2 = quest accepted (interview in progress)
// 4 = interview complete, ready to board
// 6 = boarded boat

// ============================================================================
// Chat animation IDs
// ============================================================================

const ANIM_CHATHAP1 = 567;
const ANIM_CHATHAP2 = 568;
const ANIM_CHATHAP3 = 569;
const ANIM_CHATHAP4 = 570;
const ANIM_CHATCON1 = 575;
const ANIM_CHATCON2 = 576;
const ANIM_CHATNEU1 = 588;
const ANIM_CHATSAD1 = 610;

// ============================================================================
// Module
// ============================================================================

export const pandemoniumQuestModule: ScriptModule = {
    id: "quest.pandemonium",
    register(registry, services) {
        const activeConvos = new Set<number>();

        function getSailingIntro(player: { getVarbitValue?: (id: number) => number }): number {
            return player.getVarbitValue?.(VARBIT_SAILING_INTRO) ?? 0;
        }

        function playAnneConversation(event: NpcInteractionEvent) {
            const { player } = event;
            const pid = player.id;
            const state = getSailingIntro(player);

            if (activeConvos.has(pid)) return;
            activeConvos.add(pid);

            const playerName = player.name ?? "You";
            const onClose = () => activeConvos.delete(pid);
            const convoId = `pandemonium_${pid}`;

            const openAnneDialog = (
                id: string,
                lines: string[],
                animId: number,
                onContinue?: () => void,
            ) =>
                services.openDialog?.(player, {
                    kind: "npc",
                    id,
                    npcId: ANNE_SARIM_NPC_ID,
                    npcName: "Anne",
                    lines,
                    animationId: animId,
                    clickToContinue: true,
                    closeOnContinue: !onContinue,
                    onContinue,
                    onClose,
                });

            const openWillDialog = (
                id: string,
                lines: string[],
                animId: number,
                onContinue?: () => void,
            ) =>
                services.openDialog?.(player, {
                    kind: "npc",
                    id,
                    npcId: WILL_SARIM_NPC_ID,
                    npcName: "Will",
                    lines,
                    animationId: animId,
                    clickToContinue: true,
                    closeOnContinue: !onContinue,
                    onContinue,
                    onClose,
                });

            const openPlayerDialog = (
                id: string,
                lines: string[],
                animId: number,
                onContinue?: () => void,
            ) =>
                services.openDialog?.(player, {
                    kind: "player",
                    id,
                    playerName,
                    lines,
                    animationId: animId,
                    clickToContinue: true,
                    closeOnContinue: !onContinue,
                    onContinue,
                    onClose,
                });

            if (state === 0) {
                // Not started — full intro dialogue
                playIntroDialogue(
                    convoId,
                    player,
                    playerName,
                    openAnneDialog,
                    openWillDialog,
                    openPlayerDialog,
                    onClose,
                    services,
                );
            } else if (state === 2 || state === 4) {
                // Interview done or in progress — offer to board
                playReadyDialogue(
                    convoId,
                    player,
                    playerName,
                    openAnneDialog,
                    openWillDialog,
                    openPlayerDialog,
                    onClose,
                    services,
                );
            } else {
                activeConvos.delete(pid);
            }
        }

        // Both Anne and Will trigger the same conversation
        registry.registerNpcScript({
            npcId: ANNE_SARIM_NPC_ID,
            option: "talk-to",
            handler: playAnneConversation,
        });
        registry.registerNpcScript({
            npcId: ANNE_SARIM_NPC_ID,
            option: undefined,
            handler: playAnneConversation,
        });

        registry.registerNpcScript({
            npcId: WILL_SARIM_NPC_ID,
            option: "talk-to",
            handler: playAnneConversation,
        });
        registry.registerNpcScript({
            npcId: WILL_SARIM_NPC_ID,
            option: undefined,
            handler: playAnneConversation,
        });
    },
};

// ============================================================================
// Intro Dialogue (state 0 -> 2 -> 4)
// ============================================================================

type DialogFn = (id: string, lines: string[], animId: number, onContinue?: () => void) => void;

function playIntroDialogue(
    convoId: string,
    player: any,
    playerName: string,
    openAnneDialog: DialogFn,
    openWillDialog: DialogFn,
    openPlayerDialog: DialogFn,
    onClose: () => void,
    services: ScriptServices,
) {
    // Anne: "Ah, look what we have here, Will!"
    openAnneDialog(
        `${convoId}_1`,
        ["Ah, look what we have here, Will! This looks like someone", "who needs a good job!"],
        ANIM_CHATHAP2,
        () => {
            // Player: "What?"
            openPlayerDialog(`${convoId}_2`, ["What?"], ANIM_CHATCON1, () => {
                // Will: "Goodness, Anne..."
                openWillDialog(
                    `${convoId}_3`,
                    [
                        "Goodness, Anne, I think you're right! This one's clearly",
                        "never worked an honest day in their life, and it's about",
                        "time someone changed that!",
                    ],
                    ANIM_CHATHAP3,
                    () => {
                        // Player: "But I don't need a..."
                        openPlayerDialog(
                            `${convoId}_4`,
                            ["But I don't need a..."],
                            ANIM_CHATCON1,
                            () => {
                                // Anne: "Well, let's not waste any more time!"
                                openAnneDialog(
                                    `${convoId}_5`,
                                    [
                                        "Well, let's not waste any more time! Stranger, are you",
                                        "ready for your interview?",
                                    ],
                                    ANIM_CHATHAP2,
                                    () => {
                                        // Options: Start the Pandemonium quest?
                                        services.closeDialog?.(player, `${convoId}_5`);
                                        services.openDialogOptions?.(player, {
                                            id: `${convoId}_quest_start`,
                                            title: "Start the Pandemonium quest?",
                                            options: ["Yes.", "No."],
                                            onClose,
                                            onSelect: (choice) => {
                                                if (choice === 1) {
                                                    // No — end conversation
                                                    onClose();
                                                    return;
                                                }
                                                // Yes — set varbit to 2, quest started
                                                services.sendVarbit?.(
                                                    player,
                                                    VARBIT_SAILING_INTRO,
                                                    2,
                                                );
                                                services.sendGameMessage(
                                                    player,
                                                    "You've started a new quest: <col=0ab0ff>Pandemonium</col>",
                                                );
                                                playInterviewDialogue(
                                                    convoId,
                                                    player,
                                                    playerName,
                                                    openAnneDialog,
                                                    openWillDialog,
                                                    openPlayerDialog,
                                                    onClose,
                                                    services,
                                                );
                                            },
                                        });
                                    },
                                );
                            },
                        );
                    },
                );
            });
        },
    );
}

// ============================================================================
// Interview Dialogue (state 2 -> 4)
// ============================================================================

function playInterviewDialogue(
    convoId: string,
    player: any,
    playerName: string,
    openAnneDialog: DialogFn,
    openWillDialog: DialogFn,
    openPlayerDialog: DialogFn,
    onClose: () => void,
    services: ScriptServices,
) {
    // Player: "I guess so...?"
    openPlayerDialog(`${convoId}_i1`, ["I guess so...?"], ANIM_CHATCON1, () => {
        // Will: "Let's get you started..."
        openWillDialog(
            `${convoId}_i2`,
            ["Let's get you started with a nice easy question: What is", "your name?"],
            ANIM_CHATHAP2,
            () => {
                // Player: "<name>."
                openPlayerDialog(`${convoId}_i3`, [`${playerName}.`], ANIM_CHATNEU1, () => {
                    // Anne: "Pleased to meet you..."
                    openAnneDialog(
                        `${convoId}_i4`,
                        [`Pleased to meet you, ${playerName}. I'm Anne, and this is Will.`],
                        ANIM_CHATHAP1,
                        () => {
                            // Will: "Next question: Do you have any experience..."
                            openWillDialog(
                                `${convoId}_i5`,
                                ["Next question: Do you have any experience captaining", "a ship?"],
                                ANIM_CHATHAP2,
                                () => {
                                    // Player: "Not really..."
                                    openPlayerDialog(
                                        `${convoId}_i6`,
                                        ["Not really..."],
                                        ANIM_CHATNEU1,
                                        () => {
                                            // Will: "Oh..."
                                            openWillDialog(
                                                `${convoId}_i7`,
                                                ["Oh..."],
                                                ANIM_CHATSAD1,
                                                () => {
                                                    playInterviewPart2(
                                                        convoId,
                                                        player,
                                                        playerName,
                                                        openAnneDialog,
                                                        openWillDialog,
                                                        openPlayerDialog,
                                                        onClose,
                                                        services,
                                                    );
                                                },
                                            );
                                        },
                                    );
                                },
                            );
                        },
                    );
                });
            },
        );
    });
}

function playInterviewPart2(
    convoId: string,
    player: any,
    playerName: string,
    openAnneDialog: DialogFn,
    openWillDialog: DialogFn,
    openPlayerDialog: DialogFn,
    onClose: () => void,
    services: ScriptServices,
) {
    // Anne: "Will, it's important we not be too picky!"
    openAnneDialog(
        `${convoId}_i8`,
        ["Will, it's important we not be too picky! It's a", "competitive market, after all."],
        ANIM_CHATHAP2,
        () => {
            // Will: "Okay, final question..."
            openWillDialog(
                `${convoId}_i9`,
                [
                    "Okay, final question: Do you agree to waive all rights to",
                    "pursue legal action against your new employer in the",
                    "event of injury or horrific death?",
                ],
                ANIM_CHATHAP3,
                () => {
                    // Player: "Is that likely to happen?"
                    openPlayerDialog(
                        `${convoId}_i10`,
                        ["Is that likely to happen?"],
                        ANIM_CHATCON1,
                        () => {
                            // Anne: "Not at all!"
                            openAnneDialog(`${convoId}_i11`, ["Not at all!"], ANIM_CHATHAP1, () => {
                                // Player: "I'm not sure if I..."
                                openPlayerDialog(
                                    `${convoId}_i12`,
                                    ["I'm not sure if I..."],
                                    ANIM_CHATCON1,
                                    () => {
                                        // Will: "Excellent! Well then..."
                                        openWillDialog(
                                            `${convoId}_i13`,
                                            [
                                                `Excellent! Well then, ${playerName}, I'm pleased to say that we`,
                                                "have the results of your interview. You bring some",
                                                "impressive stuff to the table. We'd love to offer you the",
                                                "role!",
                                            ],
                                            ANIM_CHATHAP4,
                                            () => {
                                                // Anne: "Congratulations!"
                                                openAnneDialog(
                                                    `${convoId}_i14`,
                                                    ["Congratulations!"],
                                                    ANIM_CHATHAP1,
                                                    () => {
                                                        playInterviewPart3(
                                                            convoId,
                                                            player,
                                                            playerName,
                                                            openAnneDialog,
                                                            openWillDialog,
                                                            openPlayerDialog,
                                                            onClose,
                                                            services,
                                                        );
                                                    },
                                                );
                                            },
                                        );
                                    },
                                );
                            });
                        },
                    );
                },
            );
        },
    );
}

function playInterviewPart3(
    convoId: string,
    player: any,
    playerName: string,
    openAnneDialog: DialogFn,
    openWillDialog: DialogFn,
    openPlayerDialog: DialogFn,
    onClose: () => void,
    services: ScriptServices,
) {
    // Player: "Thanks... only, you didn't actually mention what the role was..."
    openPlayerDialog(
        `${convoId}_i15`,
        ["Thanks... only, you didn't actually mention what the", "role was..."],
        ANIM_CHATCON2,
        () => {
            // Will: "Ah, how forgetful of us!"
            openWillDialog(
                `${convoId}_i16`,
                [
                    "Ah, how forgetful of us! Given that you've already",
                    "accepted, how about we discuss the details on our ship.",
                ],
                ANIM_CHATHAP2,
                () => {
                    // Player: "But I didn't accept anything..."
                    openPlayerDialog(
                        `${convoId}_i17`,
                        ["But I didn't accept anything..."],
                        ANIM_CHATCON1,
                        () => {
                            // Set state to 4 — interview complete
                            services.sendVarbit?.(player, VARBIT_SAILING_INTRO, 4);

                            // Anne: "Just let us know when you're ready..."
                            openAnneDialog(
                                `${convoId}_i18`,
                                [
                                    "Just let us know when you're ready, and we'll hop",
                                    "aboard!",
                                ],
                                ANIM_CHATHAP2,
                                () => {
                                    // Options: ready or not
                                    services.closeDialog?.(player, `${convoId}_i18`);
                                    offerBoardChoice(
                                        convoId,
                                        player,
                                        playerName,
                                        openWillDialog,
                                        openPlayerDialog,
                                        onClose,
                                        services,
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

// ============================================================================
// Board Choice (state 4 -> 6)
// ============================================================================

function offerBoardChoice(
    convoId: string,
    player: any,
    playerName: string,
    openWillDialog: DialogFn,
    openPlayerDialog: DialogFn,
    onClose: () => void,
    services: ScriptServices,
) {
    services.openDialogOptions?.(player, {
        id: `${convoId}_board_choice`,
        title: "Select an option",
        options: ["I guess I'm ready...", "I'd rather not..."],
        onClose,
        onSelect: (choice) => {
            if (choice === 1) {
                onClose();
                return;
            }
            // "I guess I'm ready..."
            openPlayerDialog(`${convoId}_b1`, ["I guess I'm ready..."], ANIM_CHATCON1, () => {
                // Will: "Then let us away!"
                openWillDialog(`${convoId}_b2`, ["Then let us away!"], ANIM_CHATHAP1, () => {
                    onClose();
                    executeBoardingSequence(player, playerName, services);
                });
            });
        },
    });
}

// ============================================================================
// Boarding Sequence — fade, teleport, set sailing state, open widgets
// ============================================================================

function executeBoardingSequence(player: any, playerName: string, services: ScriptServices) {
    const pid = player.id;
    const overlayAtmosphereUid = BaseComponentUids.OVERLAY_ATMOSPHERE;
    const fadeMessageUid = (FADE_OVERLAY_GROUP << 16) | FADE_OVERLAY_MESSAGE_CHILD;
    const hpBarUid = (HPBAR_HUD_GROUP << 16) | HPBAR_HUD_HP_CHILD;

    // --- Tick 0: Fade to black, disable minimap ---

    // Clear fade message text
    services.queueWidgetEvent?.(pid, { action: "set_text", uid: fadeMessageUid, text: "" });

    // Open fade overlay on the atmosphere slot
    services.openSubInterface?.(player, overlayAtmosphereUid, FADE_OVERLAY_GROUP, 1);

    // Run fade-to-black script: [startAlpha, endAlpha, ?, ?, speed]
    services.queueClientScript?.(pid, SCRIPT_FADE, 0, 255, 0, 0, 15);

    // Hide HP bar
    services.queueWidgetEvent?.(pid, { action: "set_hidden", uid: hpBarUid, hidden: true });
    services.queueClientScript?.(pid, SCRIPT_HIDE_HPBAR, 19857409);

    // Close any open dialog
    services.closeDialog?.(player);

    // Disable minimap
    services.sendVarbit?.(player, VARBIT_MINIMAP_STATE, 2);

    // --- Tick 1 (delayed): Teleport + set sailing state ---
    const boardingDelay = setTimeout(() => {
        // Set quest state
        services.sendVarbit?.(player, VARBIT_SAILING_INTRO, 6);
        services.sendGameMessage(player, "You board the boat.");

        // Sailing boat state varbits
        services.sendVarbit?.(player, VARBIT_SAILING_BOARDED_BOAT, 1);
        services.sendVarbit?.(player, VARBIT_SAILING_BOARDED_BOAT_TYPE, 3);
        services.sendVarbit?.(player, VARBIT_SAILING_BOARDED_BOAT_WORLD, 426);
        services.sendVarbit?.(player, VARBIT_SAILING_PLAYER_IS_ON_PLAYER_BOAT, 1);

        // Sailing sidepanel state
        services.sendVarbit?.(player, VARBIT_SAILING_SIDEPANEL_PLAYER_ROLE, 10);
        services.sendVarp?.(player, VARP_SAILING_SIDEPANEL_BOAT_TYPE, 8113);
        services.sendVarbit?.(player, VARBIT_SAILING_SIDEPANEL_BOAT_MOVE_MODE, 4);
        services.sendVarbit?.(player, VARBIT_SAILING_SIDEPANEL_PLAYERS_ON_BOARD_TOTAL, 1);
        services.sendVarbit?.(player, VARBIT_SAILING_SIDEPANEL_BOAT_HP_MAX, 170);
        services.sendVarbit?.(player, VARBIT_SAILING_SIDEPANEL_BOAT_HP, 170);
        services.sendVarbit?.(player, VARBIT_SAILING_SIDEPANEL_HELM_STATUS, 1);
        services.sendVarbit?.(player, VARBIT_SAILING_SIDEPANEL_VISIBLE_FROM_COMBAT_TAB, 1);
        services.sendVarbit?.(player, VARBIT_SAILING_SIDEPANEL_VISIBLE, 1);
        services.sendVarbit?.(player, VARBIT_SAILING_SIDEPANEL_AMMO_NEEDS_UPDATE, 1);
        services.sendVarbit?.(player, VARBIT_SAILING_SIDEPANEL_BOAT_STATS_NEEDS_UPDATE, 1);
        services.sendVarbit?.(player, VARBIT_SAILING_PRELOADED_ANIMS, 1);

        // Music unlock
        services.sendGameMessage(
            player,
            "You have unlocked a new music track: <col=ff3045>Crest of a Wave",
        );

        // Teleport to the sailing intro instance via REBUILD_REGION
        const templateChunks = buildSailingIntroTemplates();
        services.teleportToInstance?.(
            player,
            SAILING_INTRO_X,
            SAILING_INTRO_Y,
            SAILING_INTRO_LEVEL,
            templateChunks,
        );

        // Spawn boat locs relative to teleport position
        const boatLocs = [
            { id: 59516, dx: -1, dy: -2, plane: 0, rot: 0 }, // keel
            { id: 59624, dx: -2, dy: -2, plane: 0, rot: 0 }, // trim
            { id: 59620, dx:  1, dy:  3, plane: 1, rot: 0 }, // navigating
            { id: 59553, dx:  1, dy:  1, plane: 1, rot: 0 }, // sails
            { id: 60480, dx:  0, dy: -1, plane: 1, rot: 1 }, // salvaging hook
        ];
        for (const loc of boatLocs) {
            services.sendLocChangeToPlayer?.(
                player,
                0,
                loc.id,
                { x: SAILING_INTRO_X + loc.dx, y: SAILING_INTRO_Y + loc.dy },
                loc.plane,
            );
        }

        // Board sound
        services.sendSound?.(player, SYNTH_BOARD_BOAT);

        // Crew init CS2: [playerName, 1, "", 1]
        services.queueClientScript?.(pid, SCRIPT_SAILING_CREW_INIT, playerName, 1, "", 1);

        // Switch sidebar to tab 0 (sailing)
        services.queueClientScript?.(pid, SCRIPT_SIDEBAR_TAB, 0);

        // Open sailing sidepanel on the combat tab slot
        services.openSubInterface?.(
            player,
            BaseComponentUids.TAB_COMBAT,
            SAILING_SIDEPANEL_GROUP,
            1,
        );

        // Open sailing intro HUD overlay
        services.openSubInterface?.(
            player,
            BaseComponentUids.HUD_CONTAINER_FRONT,
            SAILING_INTRO_HUD_GROUP,
            1,
        );

        // Set combat level display
        services.queueClientScript?.(pid, SCRIPT_COMBAT_LEVEL, player.combatLevel ?? 3);

        // Camera bounds for sailing
        services.queueClientScript?.(pid, SCRIPT_CAMERA_BOUNDS, -100, 896, -100, 896);

        // TODO: Preload sailing animations via script 1846 once CS2 opcode 3189 is implemented
        // for (const animId of PRELOAD_ANIM_IDS) {
        //     services.queueClientScript?.(pid, SCRIPT_PRELOAD_ANIM, animId);
        // }

        // --- Tick 2 (delayed): Fade back in, re-enable minimap, boat stats ---
        const fadeInDelay = setTimeout(() => {
            // Boat stats (next tick)
            services.sendVarbit?.(player, VARBIT_SAILING_SIDEPANEL_AMMO_NEEDS_UPDATE, 0);
            services.sendVarbit?.(player, VARBIT_SAILING_SIDEPANEL_BOAT_STATS_NEEDS_UPDATE, 0);
            services.sendVarp?.(player, VARP_SAILING_SIDEPANEL_BOAT_DEFENCE, 10);
            services.sendVarp?.(player, VARP_SAILING_SIDEPANEL_BOATSTAT_TOTAL_STABDEF, 26);
            services.sendVarp?.(player, VARP_SAILING_SIDEPANEL_BOATSTAT_TOTAL_SLASHDEF, 19);
            services.sendVarp?.(player, VARP_SAILING_SIDEPANEL_BOATSTAT_TOTAL_CRUSHDEF, 13);
            services.sendVarp?.(player, VARP_SAILING_SIDEPANEL_BOATSTAT_TOTAL_HEAVYRANGEDDEF, 8);
            services.sendVarp?.(
                player,
                VARP_SAILING_SIDEPANEL_BOATSTAT_TOTAL_STANDARDRANGEDDEF,
                17,
            );
            services.sendVarp?.(player, VARP_SAILING_SIDEPANEL_BOATSTAT_TOTAL_LIGHTRANGEDDEF, 28);
            services.sendVarp?.(player, VARP_SAILING_SIDEPANEL_BOATSTAT_TOTAL_MAGICDEF, 16);
            services.sendVarp?.(player, VARP_SAILING_SIDEPANEL_BOAT_ARMOUR, 100);
            services.sendVarbit?.(player, VARBIT_SAILING_SIDEPANEL_BOAT_BASESPEED, 192);
            services.sendVarbit?.(player, VARBIT_SAILING_SIDEPANEL_BOAT_SPEEDCAP, 384);
            services.sendVarbit?.(player, VARBIT_SAILING_SIDEPANEL_BOAT_SPEEDBOOST_DURATION, 20);
            services.sendVarbit?.(player, VARBIT_SAILING_SIDEPANEL_BOAT_ACCELERATION, 64);

            // Fade from black
            services.queueWidgetEvent?.(pid, {
                action: "set_text",
                uid: fadeMessageUid,
                text: "",
            });
            services.openSubInterface?.(player, overlayAtmosphereUid, FADE_OVERLAY_GROUP, 1);
            services.queueClientScript?.(pid, SCRIPT_FADE, 0, 0, 0, 255, 15);

            // Re-enable minimap
            services.sendVarbit?.(player, VARBIT_MINIMAP_STATE, 0);

            // Will on the boat: "Lovely! The open sea!"
            services.openDialog?.(player, {
                kind: "npc",
                id: `pandemonium_boat_will_1`,
                npcId: WILL_BOAT_NPC_ID,
                npcName: "Will",
                lines: ["Lovely! The open sea!"],
                animationId: ANIM_CHATHAP1,
                clickToContinue: true,
                closeOnContinue: true,
            });
        }, 600);

        // Store timeout ref for safety (GC will collect naturally)
        void fadeInDelay;
    }, 600);

    void boardingDelay;
}

// ============================================================================
// Ready Dialogue (returning after state 4)
// ============================================================================

function playReadyDialogue(
    convoId: string,
    player: any,
    playerName: string,
    openAnneDialog: DialogFn,
    openWillDialog: DialogFn,
    openPlayerDialog: DialogFn,
    onClose: () => void,
    services: ScriptServices,
) {
    openAnneDialog(
        `${convoId}_r1`,
        ["Just let us know when you're ready, and we'll hop", "aboard!"],
        ANIM_CHATHAP2,
        () => {
            services.closeDialog?.(player, `${convoId}_r1`);
            offerBoardChoice(
                convoId,
                player,
                playerName,
                openWillDialog,
                openPlayerDialog,
                onClose,
                services,
            );
        },
    );
}

// ============================================================================
// Sailing Intro Instance Templates
// ============================================================================

/**
 * Build the 4×13×13 template chunk grid for the sailing intro boat.
 *
 * The actual boat template is at cache chunk (480, 800) in map square (60, 100),
 * but those regions are XTEA-encrypted and we have no keys for rev 237.
 *
 * Using Lumbridge chunks as a temporary stand-in to verify the instance
 * rendering pipeline works end-to-end. Swap to real boat chunks once
 * XTEA keys are available.
 */
function buildSailingIntroTemplates(): number[][][] {
    const chunks = createEmptyTemplateChunks();

    // Port Sarim dock / sailing boat area: tile (3053, 3200) = chunk (381, 400)
    // Map square (47, 50). No XTEA encryption in rev 237+.
    const baseChunkX = 381;
    const baseChunkY = 400;

    for (let cx = 2; cx < 11; cx++) {
        for (let cy = 2; cy < 11; cy++) {
            const srcX = baseChunkX + (cx - 6);
            const srcY = baseChunkY + (cy - 6);
            chunks[0][cx][cy] = packTemplateChunk(0, srcX, srcY, 0);
            chunks[1][cx][cy] = packTemplateChunk(1, srcX, srcY, 0);
        }
    }

    return chunks;
}
