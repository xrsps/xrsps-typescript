import { BaseComponentUids } from "../../../../widgets/viewport/ViewportEnumService";
import {
    buildSailingOverlayTemplates,
    SAILING_DOCKED_NPC_SPAWNS,
    SAILING_DOCKED_PLAYER_LEVEL,
    SAILING_DOCKED_PLAYER_X,
    SAILING_DOCKED_PLAYER_Y,
    SAILING_INTRO_BOAT_LOCS,
    SAILING_INTRO_BUILD_AREAS,
    SAILING_WORLD_ENTITY_CONFIG_ID,
    SAILING_WORLD_ENTITY_INDEX,
    SAILING_WORLD_ENTITY_SIZE_X,
    SAILING_WORLD_ENTITY_SIZE_Z,
    PORT_SARIM_RETURN_LEVEL,
    PORT_SARIM_RETURN_X,
    PORT_SARIM_RETURN_Y,
} from "../../../sailing/SailingInstance";
import type { PlayerState } from "../../../player";
import type {
    NpcInteractionEvent,
    ScriptDialogRequest,
    ScriptModule,
    ScriptServices,
} from "../../types";

// ============================================================================
// NPC IDs
// ============================================================================

const ANNE_SHORE_NPC_ID = 14962;
const WILL_SHORE_NPC_ID = 14957;
const WILL_BOAT_NPC_ID = 14958;
const WILL_DOCKED_NPC_ID = 14959;
const ANNE_BOAT_NPC_ID = 14963;
const ANNE_DOCKED_NPC_ID = 14964;

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
// Interface constants
// ============================================================================

const FADE_OVERLAY_GROUP = 174;
const FADE_OVERLAY_MESSAGE_CHILD = 4;
export const SAILING_SIDEPANEL_GROUP = 937;
export const SAILING_INTRO_HUD_GROUP = 345;
const HPBAR_HUD_GROUP = 303;
const HPBAR_HUD_HP_CHILD = 5;

const SCRIPT_FADE = 948;
const SCRIPT_HIDE_HPBAR = 2249;
const SCRIPT_SAILING_CREW_INIT = 8776;
const SCRIPT_SIDEBAR_TAB = 915;
const SCRIPT_COMBAT_LEVEL = 5224;
const SCRIPT_CAMERA_BOUNDS = 603;

const SYNTH_BOARD_BOAT = 10754;
const SAILING_DOCKED_WORLD_ID = 425;

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

        function getSailingIntro(player: PlayerState): number {
            return player.getVarbitValue(VARBIT_SAILING_INTRO);
        }

        function playShoreConversation(event: NpcInteractionEvent) {
            const { player } = event;
            const pid = player.id;
            const state = getSailingIntro(player);

            if (activeConvos.has(pid)) return;
            activeConvos.add(pid);

            const playerName = player.name ?? "You";
            const onClose = () => activeConvos.delete(pid);
            const convoId = `pandemonium_${pid}`;

            const openAnneDialog = createNpcDialogFn(
                player,
                services,
                onClose,
                ANNE_SHORE_NPC_ID,
                "Anne",
            );
            const openWillDialog = createNpcDialogFn(
                player,
                services,
                onClose,
                WILL_SHORE_NPC_ID,
                "Will",
            );
            const openPlayerDialog = createPlayerDialogFn(
                player,
                services,
                onClose,
                playerName,
            );

            if (state === 0) {
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

        function playShipConversation(event: NpcInteractionEvent) {
            const { player, npc } = event;
            const pid = player.id;

            if (activeConvos.has(pid)) return;
            activeConvos.add(pid);

            const playerName = player.name ?? "You";
            const onClose = () => activeConvos.delete(pid);
            const convoId = `pandemonium_ship_${pid}`;
            const dockedVariant =
                npc.typeId === WILL_DOCKED_NPC_ID || npc.typeId === ANNE_DOCKED_NPC_ID;
            const openAnneDialog = createNpcDialogFn(
                player,
                services,
                onClose,
                dockedVariant ? ANNE_DOCKED_NPC_ID : ANNE_BOAT_NPC_ID,
                "Anne",
            );
            const openWillDialog = createNpcDialogFn(
                player,
                services,
                onClose,
                dockedVariant ? WILL_DOCKED_NPC_ID : WILL_BOAT_NPC_ID,
                "Will",
            );

            playShipboardDialogue(
                convoId,
                playerName,
                openAnneDialog,
                openWillDialog,
                npc.typeId === ANNE_DOCKED_NPC_ID || npc.typeId === ANNE_BOAT_NPC_ID
                    ? "anne"
                    : "will",
                dockedVariant ? "docked" : "at_sea",
            );
        }

        registry.registerNpcScript({
            npcId: ANNE_SHORE_NPC_ID,
            option: "talk-to",
            handler: playShoreConversation,
        });
        registry.registerNpcScript({
            npcId: ANNE_SHORE_NPC_ID,
            option: undefined,
            handler: playShoreConversation,
        });

        registry.registerNpcScript({
            npcId: WILL_SHORE_NPC_ID,
            option: "talk-to",
            handler: playShoreConversation,
        });
        registry.registerNpcScript({
            npcId: WILL_SHORE_NPC_ID,
            option: undefined,
            handler: playShoreConversation,
        });

        for (const npcId of [
            WILL_BOAT_NPC_ID,
            WILL_DOCKED_NPC_ID,
            ANNE_BOAT_NPC_ID,
            ANNE_DOCKED_NPC_ID,
        ]) {
            registry.registerNpcScript({
                npcId,
                option: "talk-to",
                handler: playShipConversation,
            });
            registry.registerNpcScript({
                npcId,
                option: undefined,
                handler: playShipConversation,
            });
        }
    },
};

function createNpcDialogFn(
    player: PlayerState,
    services: Pick<ScriptServices, "openDialog">,
    onClose: () => void,
    npcId: number,
    npcName: string,
): DialogFn {
    return (id, lines, animId, onContinue) =>
        services.openDialog?.(player, {
            kind: "npc",
            id,
            npcId,
            npcName,
            lines,
            animationId: animId,
            clickToContinue: true,
            closeOnContinue: !onContinue,
            onContinue,
            onClose,
        });
}

function createPlayerDialogFn(
    player: PlayerState,
    services: Pick<ScriptServices, "openDialog">,
    onClose: () => void,
    playerName: string,
): DialogFn {
    return (id, lines, animId, onContinue) =>
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
}

// ============================================================================
// Intro Dialogue (state 0 -> 2 -> 4)
// ============================================================================

type DialogFn = (id: string, lines: string[], animId: number, onContinue?: () => void) => void;
type PandemoniumDockedSailingServices = Pick<
    ScriptServices,
    | "disposeSailingInstance"
    | "buildSailingDockedCollision"
    | "teleportPlayer"
    | "sendWorldEntity"
    | "spawnNpc"
    | "sendVarbit"
    | "sendVarp"
    | "sendGameMessage"
    | "sendSound"
    | "queueClientScript"
    | "openSubInterface"
    | "queueWidgetEvent"
    | "openDialog"
>;

type PandemoniumSailingStateServices = Pick<
    ScriptServices,
    | "sendVarbit"
    | "sendVarp"
    | "queueClientScript"
    | "openSubInterface"
>;

function playIntroDialogue(
    convoId: string,
    player: PlayerState,
    playerName: string,
    openAnneDialog: DialogFn,
    openWillDialog: DialogFn,
    openPlayerDialog: DialogFn,
    onClose: () => void,
    services: ScriptServices,
) {
    openAnneDialog(
        `${convoId}_1`,
        ["Ah, look what we have here, Will! This looks like someone", "who needs a good job!"],
        ANIM_CHATHAP2,
        () => {
            openPlayerDialog(`${convoId}_2`, ["What?"], ANIM_CHATCON1, () => {
                openWillDialog(
                    `${convoId}_3`,
                    [
                        "Goodness, Anne, I think you're right! This one's clearly",
                        "never worked an honest day in their life, and it's about",
                        "time someone changed that!",
                    ],
                    ANIM_CHATHAP3,
                    () => {
                        openPlayerDialog(
                            `${convoId}_4`,
                            ["But I don't need a..."],
                            ANIM_CHATCON1,
                            () => {
                                openAnneDialog(
                                    `${convoId}_5`,
                                    [
                                        "Well, let's not waste any more time! Stranger, are you",
                                        "ready for your interview?",
                                    ],
                                    ANIM_CHATHAP2,
                                    () => {
                                        services.closeDialog?.(player, `${convoId}_5`);
                                        services.openDialogOptions?.(player, {
                                            id: `${convoId}_quest_start`,
                                            title: "Start the Pandemonium quest?",
                                            options: ["Yes.", "No."],
                                            onClose,
                                            onSelect: (choice) => {
                                                if (choice === 1) {
                                                    onClose();
                                                    return;
                                                }
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
    player: PlayerState,
    playerName: string,
    openAnneDialog: DialogFn,
    openWillDialog: DialogFn,
    openPlayerDialog: DialogFn,
    onClose: () => void,
    services: ScriptServices,
) {
    openPlayerDialog(`${convoId}_i1`, ["I guess so...?"], ANIM_CHATCON1, () => {
        openWillDialog(
            `${convoId}_i2`,
            ["Let's get you started with a nice easy question: What is", "your name?"],
            ANIM_CHATHAP2,
            () => {
                openPlayerDialog(`${convoId}_i3`, [`${playerName}.`], ANIM_CHATNEU1, () => {
                    openAnneDialog(
                        `${convoId}_i4`,
                        [`Pleased to meet you, ${playerName}. I'm Anne, and this is Will.`],
                        ANIM_CHATHAP1,
                        () => {
                            openWillDialog(
                                `${convoId}_i5`,
                                ["Next question: Do you have any experience captaining", "a ship?"],
                                ANIM_CHATHAP2,
                                () => {
                                    openPlayerDialog(
                                        `${convoId}_i6`,
                                        ["Not really..."],
                                        ANIM_CHATNEU1,
                                        () => {
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
    player: PlayerState,
    playerName: string,
    openAnneDialog: DialogFn,
    openWillDialog: DialogFn,
    openPlayerDialog: DialogFn,
    onClose: () => void,
    services: ScriptServices,
) {
    openAnneDialog(
        `${convoId}_i8`,
        ["Will, it's important we not be too picky! It's a", "competitive market, after all."],
        ANIM_CHATHAP2,
        () => {
            openWillDialog(
                `${convoId}_i9`,
                [
                    "Okay, final question: Do you agree to waive all rights to",
                    "pursue legal action against your new employer in the",
                    "event of injury or horrific death?",
                ],
                ANIM_CHATHAP3,
                () => {
                    openPlayerDialog(
                        `${convoId}_i10`,
                        ["Is that likely to happen?"],
                        ANIM_CHATCON1,
                        () => {
                            openAnneDialog(`${convoId}_i11`, ["Not at all!"], ANIM_CHATHAP1, () => {
                                openPlayerDialog(
                                    `${convoId}_i12`,
                                    ["I'm not sure if I..."],
                                    ANIM_CHATCON1,
                                    () => {
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
    player: PlayerState,
    playerName: string,
    openAnneDialog: DialogFn,
    openWillDialog: DialogFn,
    openPlayerDialog: DialogFn,
    onClose: () => void,
    services: ScriptServices,
) {
    openPlayerDialog(
        `${convoId}_i15`,
        ["Thanks... only, you didn't actually mention what the", "role was..."],
        ANIM_CHATCON2,
        () => {
            openWillDialog(
                `${convoId}_i16`,
                [
                    "Ah, how forgetful of us! Given that you've already",
                    "accepted, how about we discuss the details on our ship.",
                ],
                ANIM_CHATHAP2,
                () => {
                    openPlayerDialog(
                        `${convoId}_i17`,
                        ["But I didn't accept anything..."],
                        ANIM_CHATCON1,
                        () => {
                            services.sendVarbit?.(player, VARBIT_SAILING_INTRO, 4);

                            openAnneDialog(
                                `${convoId}_i18`,
                                [
                                    "Just let us know when you're ready, and we'll hop",
                                    "aboard!",
                                ],
                                ANIM_CHATHAP2,
                                () => {
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

function playShipboardDialogue(
    convoId: string,
    playerName: string,
    openAnneDialog: DialogFn,
    openWillDialog: DialogFn,
    openingSpeaker: "anne" | "will",
    scene: "docked" | "at_sea",
) {
    const anneOpening =
        scene === "docked"
            ? [
                  "Mind your footing while we're still alongside.",
                  "Once you're settled aboard, we'll walk you through the work.",
              ]
            : [
                  "Mind your footing out here.",
                  "Once you've found your sea legs, we'll walk you through the work.",
              ];
    const willOpening =
        scene === "docked"
            ? ["Lovely! The open sea!", "We'll be under way soon enough."]
            : ["Lovely! The open sea!", "Now this is where a sailor belongs."];

    if (openingSpeaker === "anne") {
        openAnneDialog(`${convoId}_anne_1`, anneOpening, ANIM_CHATHAP2, () => {
            openWillDialog(
                `${convoId}_will_2`,
                [
                    `You'll be right at home before long, ${playerName}.`,
                    "Try to enjoy the ship while you've got the chance!",
                ],
                ANIM_CHATHAP3,
            );
        });
        return;
    }

    openWillDialog(`${convoId}_will_1`, willOpening, ANIM_CHATHAP1, () => {
        openAnneDialog(
            `${convoId}_anne_2`,
            [
                "We'll discuss the details once you're settled aboard.",
                "For now, keep your balance and take a good look around.",
            ],
            ANIM_CHATHAP2,
        );
    });
}

// ============================================================================
// Board Choice (state 4 -> 6)
// ============================================================================

function offerBoardChoice(
    convoId: string,
    player: PlayerState,
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
            openPlayerDialog(`${convoId}_b1`, ["I guess I'm ready..."], ANIM_CHATCON1, () => {
                openWillDialog(`${convoId}_b2`, ["Then let us away!"], ANIM_CHATHAP1, () => {
                    onClose();
                    const tick = services.getCurrentTick?.() ?? 0;
                    executeBoardingSequence(player, playerName, services, tick);
                });
            });
        },
    });
}

// ============================================================================
// Boarding Sequence — tick-scheduled via requestAction
// ============================================================================

function executeBoardingSequence(
    player: PlayerState,
    playerName: string,
    services: ScriptServices,
    currentTick: number,
) {
    const pid = player.id;
    const overlayAtmosphereUid = BaseComponentUids.OVERLAY_ATMOSPHERE;
    const fadeMessageUid = (FADE_OVERLAY_GROUP << 16) | FADE_OVERLAY_MESSAGE_CHILD;
    const hpBarUid = (HPBAR_HUD_GROUP << 16) | HPBAR_HUD_HP_CHILD;

    // --- Tick 0: Fade to black, disable minimap ---

    services.queueWidgetEvent?.(pid, { action: "set_text", uid: fadeMessageUid, text: "" });
    services.openSubInterface?.(player, overlayAtmosphereUid, FADE_OVERLAY_GROUP, 1);
    services.queueClientScript?.(pid, SCRIPT_FADE, 0, 255, 0, 0, 15);
    services.queueWidgetEvent?.(pid, { action: "set_hidden", uid: hpBarUid, hidden: true });
    services.queueClientScript?.(pid, SCRIPT_HIDE_HPBAR, 19857409);
    services.closeDialog?.(player);
    services.sendVarbit?.(player, VARBIT_MINIMAP_STATE, 2);

    // --- Tick 1: Teleport + set sailing state ---
    services.requestAction(player, {
        kind: "sailing.board_tick1",
        data: { playerName },
        delayTicks: 1,
        groups: ["sailing.boarding"],
        cooldownTicks: 2,
    }, currentTick);

    // --- Tick 2: Fade back in, boat stats, dialogue ---
    services.requestAction(player, {
        kind: "sailing.board_tick2",
        data: {},
        delayTicks: 2,
        groups: ["sailing.boarding_fade"],
    }, currentTick);
}

function sendDockedBoatArrival(
    player: PlayerState,
    services: PandemoniumDockedSailingServices,
): void {
    services.disposeSailingInstance?.(player);
    player.worldViewId = SAILING_WORLD_ENTITY_INDEX;
    services.teleportPlayer?.(
        player,
        SAILING_DOCKED_PLAYER_X,
        SAILING_DOCKED_PLAYER_Y,
        SAILING_DOCKED_PLAYER_LEVEL,
    );
    services.buildSailingDockedCollision?.();

    const templateChunks = buildSailingOverlayTemplates();
    services.sendWorldEntity?.(
        player,
        SAILING_WORLD_ENTITY_INDEX,
        SAILING_WORLD_ENTITY_CONFIG_ID,
        SAILING_WORLD_ENTITY_SIZE_X,
        SAILING_WORLD_ENTITY_SIZE_Z,
        templateChunks,
        SAILING_INTRO_BUILD_AREAS,
        SAILING_INTRO_BOAT_LOCS,
        undefined,
        1,
    );

    for (const npc of SAILING_DOCKED_NPC_SPAWNS) {
        const spawned = services.spawnNpc?.({ ...npc, wanderRadius: 0 });
        if (spawned) {
            spawned.worldViewId = SAILING_WORLD_ENTITY_INDEX;
            player.instanceNpcIds.add(spawned.id);
        }
    }
}

function setPlayerVarbitAndSend(
    player: PlayerState,
    services: Pick<ScriptServices, "sendVarbit">,
    varbitId: number,
    value: number,
): void {
    player.setVarbitValue(varbitId, value);
    services.sendVarbit?.(player, varbitId, value);
}

function setPlayerVarpAndSend(
    player: PlayerState,
    services: Pick<ScriptServices, "sendVarp">,
    varpId: number,
    value: number,
): void {
    player.setVarpValue(varpId, value);
    services.sendVarp?.(player, varpId, value);
}

/**
 * Resets all sailing varbits, closes sailing interfaces, and disposes the
 * sailing instance. Called both from the normal disembark flow and as a
 * safety net when teleporting out of sailing mode.
 */
export function resetSailingState(
    player: PlayerState,
    services: Pick<ScriptServices, "sendVarbit" | "closeSubInterface" | "queueWidgetEvent" | "disposeSailingInstance">,
): void {
    services.disposeSailingInstance?.(player);

    setPlayerVarbitAndSend(player, services, VARBIT_SAILING_BOARDED_BOAT, 0);
    setPlayerVarbitAndSend(player, services, VARBIT_SAILING_BOARDED_BOAT_TYPE, 0);
    setPlayerVarbitAndSend(player, services, VARBIT_SAILING_BOARDED_BOAT_WORLD, 0);
    setPlayerVarbitAndSend(player, services, VARBIT_SAILING_PLAYER_IS_ON_PLAYER_BOAT, 0);
    setPlayerVarbitAndSend(player, services, VARBIT_SAILING_SIDEPANEL_VISIBLE, 0);
    setPlayerVarbitAndSend(
        player,
        services,
        VARBIT_SAILING_SIDEPANEL_VISIBLE_FROM_COMBAT_TAB,
        0,
    );
    setPlayerVarbitAndSend(player, services, VARBIT_SAILING_SIDEPANEL_HELM_STATUS, 0);
    setPlayerVarbitAndSend(player, services, VARBIT_SAILING_SIDEPANEL_BOAT_MOVE_MODE, 0);
    setPlayerVarbitAndSend(player, services, VARBIT_SAILING_PRELOADED_ANIMS, 0);

    // Close sailing interfaces via widget tracker (proper close hooks)
    services.closeSubInterface?.(player, BaseComponentUids.TAB_COMBAT, SAILING_SIDEPANEL_GROUP);
    services.closeSubInterface?.(
        player,
        BaseComponentUids.HUD_CONTAINER_FRONT,
        SAILING_INTRO_HUD_GROUP,
    );

    // Restore combat tab via queueWidgetEvent directly — NOT openSubInterface
    // which tracks it as modal (closeInterruptibleInterfaces kills modals on walk).
    services.queueWidgetEvent?.(player.id, {
        action: "open_sub",
        targetUid: BaseComponentUids.TAB_COMBAT,
        groupId: 593,
        type: 1,
    });
}

function syncSailingBootstrapState(
    player: PlayerState,
    services: PandemoniumSailingStateServices,
): void {
    setPlayerVarbitAndSend(player, services, VARBIT_SAILING_INTRO, 6);
    setPlayerVarbitAndSend(player, services, VARBIT_SAILING_BOARDED_BOAT, 1);
    setPlayerVarbitAndSend(player, services, VARBIT_SAILING_BOARDED_BOAT_TYPE, 3);
    setPlayerVarbitAndSend(
        player,
        services,
        VARBIT_SAILING_BOARDED_BOAT_WORLD,
        SAILING_DOCKED_WORLD_ID,
    );
    setPlayerVarbitAndSend(player, services, VARBIT_SAILING_PLAYER_IS_ON_PLAYER_BOAT, 1);
    setPlayerVarbitAndSend(player, services, VARBIT_SAILING_SIDEPANEL_PLAYER_ROLE, 10);
    setPlayerVarpAndSend(player, services, VARP_SAILING_SIDEPANEL_BOAT_TYPE, 8113);
    setPlayerVarbitAndSend(player, services, VARBIT_SAILING_SIDEPANEL_BOAT_MOVE_MODE, 4);
    setPlayerVarbitAndSend(
        player,
        services,
        VARBIT_SAILING_SIDEPANEL_PLAYERS_ON_BOARD_TOTAL,
        1,
    );
    setPlayerVarbitAndSend(player, services, VARBIT_SAILING_SIDEPANEL_BOAT_HP_MAX, 170);
    setPlayerVarbitAndSend(player, services, VARBIT_SAILING_SIDEPANEL_BOAT_HP, 170);
    setPlayerVarbitAndSend(player, services, VARBIT_SAILING_SIDEPANEL_HELM_STATUS, 1);
    setPlayerVarbitAndSend(
        player,
        services,
        VARBIT_SAILING_SIDEPANEL_VISIBLE_FROM_COMBAT_TAB,
        1,
    );
    setPlayerVarbitAndSend(player, services, VARBIT_SAILING_SIDEPANEL_VISIBLE, 1);
    setPlayerVarbitAndSend(
        player,
        services,
        VARBIT_SAILING_SIDEPANEL_AMMO_NEEDS_UPDATE,
        1,
    );
    setPlayerVarbitAndSend(
        player,
        services,
        VARBIT_SAILING_SIDEPANEL_BOAT_STATS_NEEDS_UPDATE,
        1,
    );
    setPlayerVarbitAndSend(player, services, VARBIT_SAILING_PRELOADED_ANIMS, 1);
}

function syncSailingBoatStats(
    player: PlayerState,
    services: Pick<ScriptServices, "sendVarbit" | "sendVarp">,
): void {
    setPlayerVarbitAndSend(player, services, VARBIT_SAILING_SIDEPANEL_AMMO_NEEDS_UPDATE, 0);
    setPlayerVarbitAndSend(
        player,
        services,
        VARBIT_SAILING_SIDEPANEL_BOAT_STATS_NEEDS_UPDATE,
        0,
    );
    setPlayerVarpAndSend(player, services, VARP_SAILING_SIDEPANEL_BOAT_DEFENCE, 10);
    setPlayerVarpAndSend(player, services, VARP_SAILING_SIDEPANEL_BOATSTAT_TOTAL_STABDEF, 26);
    setPlayerVarpAndSend(player, services, VARP_SAILING_SIDEPANEL_BOATSTAT_TOTAL_SLASHDEF, 19);
    setPlayerVarpAndSend(player, services, VARP_SAILING_SIDEPANEL_BOATSTAT_TOTAL_CRUSHDEF, 13);
    setPlayerVarpAndSend(
        player,
        services,
        VARP_SAILING_SIDEPANEL_BOATSTAT_TOTAL_HEAVYRANGEDDEF,
        8,
    );
    setPlayerVarpAndSend(
        player,
        services,
        VARP_SAILING_SIDEPANEL_BOATSTAT_TOTAL_STANDARDRANGEDDEF,
        17,
    );
    setPlayerVarpAndSend(
        player,
        services,
        VARP_SAILING_SIDEPANEL_BOATSTAT_TOTAL_LIGHTRANGEDDEF,
        28,
    );
    setPlayerVarpAndSend(player, services, VARP_SAILING_SIDEPANEL_BOATSTAT_TOTAL_MAGICDEF, 16);
    setPlayerVarpAndSend(player, services, VARP_SAILING_SIDEPANEL_BOAT_ARMOUR, 100);
    setPlayerVarbitAndSend(player, services, VARBIT_SAILING_SIDEPANEL_BOAT_BASESPEED, 192);
    setPlayerVarbitAndSend(player, services, VARBIT_SAILING_SIDEPANEL_BOAT_SPEEDCAP, 384);
    setPlayerVarbitAndSend(
        player,
        services,
        VARBIT_SAILING_SIDEPANEL_BOAT_SPEEDBOOST_DURATION,
        20,
    );
    setPlayerVarbitAndSend(player, services, VARBIT_SAILING_SIDEPANEL_BOAT_ACCELERATION, 64);
}

function openSailingUi(
    player: PlayerState,
    services: Pick<ScriptServices, "queueClientScript" | "openSubInterface">,
): void {
    const pid = player.id;
    const playerName = player.name ?? "You";

    services.queueClientScript?.(pid, SCRIPT_SAILING_CREW_INIT, playerName, 1, "", 1);
    services.queueClientScript?.(pid, SCRIPT_SIDEBAR_TAB, 0);
    services.openSubInterface?.(
        player,
        BaseComponentUids.TAB_COMBAT,
        SAILING_SIDEPANEL_GROUP,
        1,
        { modal: false },
    );
    services.openSubInterface?.(
        player,
        BaseComponentUids.HUD_CONTAINER_FRONT,
        SAILING_INTRO_HUD_GROUP,
        1,
        { modal: false },
    );
    services.queueClientScript?.(pid, SCRIPT_COMBAT_LEVEL, player.combatLevel ?? 3);
    services.queueClientScript?.(pid, SCRIPT_CAMERA_BOUNDS, -100, 896, -100, 896);
}

export function isPlayerOnDockedSailingBoat(player: PlayerState): boolean {
    return (
        player.getVarbitValue(VARBIT_SAILING_BOARDED_BOAT) === 1 &&
        player.getVarbitValue(VARBIT_SAILING_BOARDED_BOAT_WORLD) === SAILING_DOCKED_WORLD_ID
    );
}

export function restoreDockedSailingState(
    player: PlayerState,
    services: PandemoniumDockedSailingServices,
): void {
    syncSailingBootstrapState(player, services);
    sendDockedBoatArrival(player, services);
    syncSailingBoatStats(player, services);
    openSailingUi(player, services);
}

export function handleBoardingTick1(
    player: PlayerState,
    _data: { playerName: string },
    services: PandemoniumDockedSailingServices,
): void {
    // Quest state
    syncSailingBootstrapState(player, services);
    services.sendGameMessage(player, "You board the boat.");

    // Music unlock
    services.sendGameMessage(
        player,
        "You have unlocked a new music track: <col=ff3045>Crest of a Wave",
    );

    // Arrival uses the docked Port Sarim ship world-entity, not the deep-ocean intro instance.
    sendDockedBoatArrival(player, services);

    // Board sound
    services.sendSound?.(player, SYNTH_BOARD_BOAT);

    // Restore the sailing UI immediately on docked arrival.
    openSailingUi(player, services);
}

export function handleBoardingTick2(
    player: PlayerState,
    services: PandemoniumDockedSailingServices,
): void {
    const pid = player.id;
    const overlayAtmosphereUid = BaseComponentUids.OVERLAY_ATMOSPHERE;
    const fadeMessageUid = (FADE_OVERLAY_GROUP << 16) | FADE_OVERLAY_MESSAGE_CHILD;

    // Boat stats
    syncSailingBoatStats(player, services);

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

    // Will on the boat: opening dialogue
    playShipboardDialogue(
        `pandemonium_boat_intro_${pid}`,
        player.name ?? "You",
        createNpcDialogFn(player, services, () => {}, ANNE_BOAT_NPC_ID, "Anne"),
        createNpcDialogFn(player, services, () => {}, WILL_BOAT_NPC_ID, "Will"),
        "will",
        "at_sea",
    );
}

// ============================================================================
// Disembark — reset sailing state and return to Port Sarim
// ============================================================================

export function executeDisembarkSequence(
    player: PlayerState,
    services: ScriptServices,
): void {
    const pid = player.id;
    const overlayAtmosphereUid = BaseComponentUids.OVERLAY_ATMOSPHERE;
    const fadeMessageUid = (FADE_OVERLAY_GROUP << 16) | FADE_OVERLAY_MESSAGE_CHILD;
    const currentTick = services.getCurrentTick?.() ?? 0;

    // Fade to black
    services.queueWidgetEvent?.(pid, { action: "set_text", uid: fadeMessageUid, text: "" });
    services.openSubInterface?.(player, overlayAtmosphereUid, FADE_OVERLAY_GROUP, 1);
    services.queueClientScript?.(pid, SCRIPT_FADE, 0, 255, 0, 0, 15);
    services.sendVarbit?.(player, VARBIT_MINIMAP_STATE, 2);

    // Tick 1: Teleport back, reset state
    services.requestAction(player, {
        kind: "sailing.disembark",
        data: {},
        delayTicks: 1,
        groups: ["sailing.boarding"],
        cooldownTicks: 2,
    }, currentTick);
}

export function handleDisembarkTick(
    player: PlayerState,
    services: ScriptServices,
): void {
    const pid = player.id;
    const overlayAtmosphereUid = BaseComponentUids.OVERLAY_ATMOSPHERE;
    const fadeMessageUid = (FADE_OVERLAY_GROUP << 16) | FADE_OVERLAY_MESSAGE_CHILD;
    const hpBarUid = (HPBAR_HUD_GROUP << 16) | HPBAR_HUD_HP_CHILD;

    resetSailingState(player, services);

    // Teleport back to Port Sarim
    services.teleportPlayer?.(
        player,
        PORT_SARIM_RETURN_X,
        PORT_SARIM_RETURN_Y,
        PORT_SARIM_RETURN_LEVEL,
        true,
    );

    services.sendGameMessage(player, "You disembark from the boat.");

    // Restore HP bar
    services.queueWidgetEvent?.(pid, { action: "set_hidden", uid: hpBarUid, hidden: false });

    // Fade from black
    services.queueWidgetEvent?.(pid, { action: "set_text", uid: fadeMessageUid, text: "" });
    services.openSubInterface?.(player, overlayAtmosphereUid, FADE_OVERLAY_GROUP, 1);
    services.queueClientScript?.(pid, SCRIPT_FADE, 0, 0, 0, 255, 15);

    // Re-enable minimap
    services.sendVarbit?.(player, VARBIT_MINIMAP_STATE, 0);
}

// ============================================================================
// Sailing UI Restoration (re-login while on boat)
// ============================================================================

export function restoreSailingInstanceUi(
    player: PlayerState,
    services: ScriptServices,
): void {
    syncSailingBootstrapState(player, services);
    syncSailingBoatStats(player, services);
    openSailingUi(player, services);
}

// ============================================================================
// Ready Dialogue (returning after state 4)
// ============================================================================

function playReadyDialogue(
    convoId: string,
    player: PlayerState,
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
