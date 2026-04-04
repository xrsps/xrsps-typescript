import {
    VARBIT_LEAGUE_RELIC_1,
    VARBIT_LEAGUE_TUTORIAL_COMPLETED,
    VARBIT_LEAGUE_TYPE,
} from "../../../../../src/shared/vars";
import { type ScriptModule } from "../types";
import { queueLeagueTutorialOverlayUi } from "./leagueWidgets";

const LEAGUE_TUTOR_NPC_ID = 315;
const LEAGUE_TUTOR_NAME = "League Tutor";
const ENUM_LEAGUE_TYPE_STRUCT = 2670;
const PARAM_LEAGUE_RELIC_TIER_ENUM = 870;
const PARAM_LEAGUE_RELICS_ENUM = 878;
const PARAM_LEAGUE_RELIC_REWARD_OBJ = 2049;
const ECHO_TOOL_ITEM_IDS = new Set([25110, 25112, 25114, 25115, 25367, 25368, 25373, 25374]);

function getTutorialCompleteStep(player: { getVarbitValue?: (id: number) => number }): number {
    const leagueType = player.getVarbitValue?.(VARBIT_LEAGUE_TYPE) ?? 0;
    return leagueType === 3 ? 14 : 12;
}

function getCurrentTutorialGuidance(step: number, completeStep: number): string[] {
    if (step < 3) {
        return [
            "Press Get Started on the tutorial panel first.",
            "Then open your Quest tab to continue the Leagues onboarding.",
        ];
    }
    if (step < 5) {
        return [
            "Open the Leagues sub-tab in your side journal.",
            "That will unlock the next tutorial stage.",
        ];
    }
    if (step < 7) {
        return [
            "Open the Tasks interface and claim any easy starter tasks.",
            "Your total claimed points progress your relic tiers.",
        ];
    }
    if (step < 9) {
        return [
            "Open Areas and unlock Karamja when prompted.",
            "After that, you'll be guided to your first relic choice.",
        ];
    }
    if (step < 11) {
        return [
            "Open Relics and pick one of the first-tier relics.",
            "Power Miner, Animal Wrangler, or Lumberjack all grant Echo tool perks.",
        ];
    }
    if (step < completeStep) {
        return [
            "You're on the final tutorial stage.",
            "Use End Tutorial on the tutorial panel when you're ready.",
        ];
    }
    return [
        "Your Leagues tutorial is complete.",
        "Keep earning points to unlock higher relic tiers and mastery upgrades.",
    ];
}

function findEnumIntValue(enumType: any, key: number): number | undefined {
    const keys: number[] | undefined = enumType?.keys;
    const values: number[] | undefined = enumType?.intValues;
    if (!Array.isArray(keys) || !Array.isArray(values)) return undefined;
    for (let i = 0; i < keys.length; i++) {
        if (keys[i] === key) return values[i];
    }
    return undefined;
}

function resolveTierOneRelicRewardItemId(player: any, services: any): number | undefined {
    const selectedRelicKey = player.getVarbitValue?.(VARBIT_LEAGUE_RELIC_1) ?? 0;
    if (!(selectedRelicKey > 0)) return undefined;

    const leagueType = player.getVarbitValue?.(VARBIT_LEAGUE_TYPE) ?? 0;
    const enumLoader = services?.getEnumTypeLoader?.() ?? services?.enumTypeLoader;
    const structLoader = services?.getStructTypeLoader?.() ?? services?.structTypeLoader;
    if (!enumLoader?.load || !structLoader?.load) return undefined;

    const leagueTypeEnum = enumLoader.load(ENUM_LEAGUE_TYPE_STRUCT);
    const leagueStructId = findEnumIntValue(leagueTypeEnum, leagueType);
    if (!(leagueStructId && leagueStructId > 0)) return undefined;

    const leagueStruct = structLoader.load(leagueStructId);
    const tierEnumId = leagueStruct?.params?.get(PARAM_LEAGUE_RELIC_TIER_ENUM) as
        | number
        | undefined;
    if (!(tierEnumId && tierEnumId > 0)) return undefined;

    const tierEnum = enumLoader.load(tierEnumId);
    const tierOneStructId = findEnumIntValue(tierEnum, 0);
    if (!(tierOneStructId && tierOneStructId > 0)) return undefined;

    const tierOneStruct = structLoader.load(tierOneStructId);
    const relicEnumId = tierOneStruct?.params?.get(PARAM_LEAGUE_RELICS_ENUM) as number | undefined;
    if (!(relicEnumId && relicEnumId > 0)) return undefined;

    const relicEnum = enumLoader.load(relicEnumId);
    const relicStructId = findEnumIntValue(relicEnum, selectedRelicKey);
    if (!(relicStructId && relicStructId > 0)) return undefined;

    const relicStruct = structLoader.load(relicStructId);
    const rewardItemId = relicStruct?.params?.get(PARAM_LEAGUE_RELIC_REWARD_OBJ) as
        | number
        | undefined;
    if (!(rewardItemId && rewardItemId > 0)) return undefined;
    return rewardItemId;
}

function reclaimLostEchoTool(player: any, services: any): string[] {
    const selectedRelicKey = player.getVarbitValue?.(VARBIT_LEAGUE_RELIC_1) ?? 0;
    if (!(selectedRelicKey > 0)) {
        return [
            "You haven't unlocked a tier-1 relic yet.",
            "Pick one first and I'll be able to restore its Echo tool.",
        ];
    }

    const rewardItemId = resolveTierOneRelicRewardItemId(player, services);
    if (!(rewardItemId && ECHO_TOOL_ITEM_IDS.has(rewardItemId))) {
        return [
            "I can't identify a reclaimable Echo tool for your relic selection right now.",
            "Try relogging, then speak to me again.",
        ];
    }

    const ownedLocation = services.findOwnedItemLocation?.(player, rewardItemId);
    if (ownedLocation === "inventory") {
        return ["You already have your Echo tool with you.", "Check your inventory first."];
    }
    if (ownedLocation === "equipment") {
        return ["You already have your Echo tool equipped.", "No replacement is needed."];
    }
    if (ownedLocation === "bank") {
        return [
            "You already have that Echo tool stored in your bank.",
            "Withdraw it first before asking for another replacement.",
        ];
    }

    const added = services.addItemToInventory(player, rewardItemId, 1);
    if (added.added >= 1) {
        services.snapshotInventory(player);
        return [
            "I've replaced your lost Echo tool.",
            "Come back if you lose it again and need another replacement.",
        ];
    }

    return [
        "You'll need one free inventory slot for me to return your Echo tool.",
        "Make some space and ask again.",
    ];
}

export const leagueTutorModule: ScriptModule = {
    id: "content.league-tutor",
    register(registry, services) {
        const activeConvos = new Set<number>();

        const openTutorConversation = (event: any) => {
            const player = event.player;
            const pid = player.id;
            if (activeConvos.has(pid)) return;
            activeConvos.add(pid);

            const tutorialStep = player.getVarbitValue?.(VARBIT_LEAGUE_TUTORIAL_COMPLETED) ?? 0;
            const completeStep = getTutorialCompleteStep(player);
            const tutorialActive = tutorialStep < completeStep;

            const closeConversation = () => {
                activeConvos.delete(pid);
            };

            const openNpcDialog = (id: string, lines: string[], onContinue?: () => void) =>
                services.openDialog?.(player, {
                    kind: "npc",
                    id,
                    npcId: LEAGUE_TUTOR_NPC_ID,
                    npcName: LEAGUE_TUTOR_NAME,
                    lines,
                    clickToContinue: true,
                    closeOnContinue: !onContinue,
                    onContinue,
                    onClose: closeConversation,
                });

            const convoId = `league_tutor_${pid}`;
            openNpcDialog(
                `${convoId}_intro`,
                tutorialActive
                    ? ["Welcome to Leagues!", "I can walk you through your next tutorial step."]
                    : ["Welcome back, adventurer.", "Need a refresher on Leagues systems?"],
                () => {
                    services.closeDialog?.(player, `${convoId}_intro`);
                    services.openDialogOptions?.(player, {
                        id: `${convoId}_options`,
                        title: LEAGUE_TUTOR_NAME,
                        options: tutorialActive
                            ? [
                                  "What should I do right now?",
                                  "Remind me how tier-1 relic tools work.",
                                  "I've lost my Echo tool.",
                                  "Reopen the tutorial panel.",
                              ]
                            : [
                                  "Give me a quick Leagues refresher.",
                                  "Remind me how tier-1 relic tools work.",
                                  "I've lost my Echo tool.",
                                  "Reopen the Leagues tutorial panel.",
                              ],
                        onClose: closeConversation,
                        onSelect: (choiceIndex) => {
                            activeConvos.delete(pid);
                            if (choiceIndex === 0) {
                                openNpcDialog(
                                    `${convoId}_guidance`,
                                    getCurrentTutorialGuidance(tutorialStep, completeStep),
                                );
                                return;
                            }
                            if (choiceIndex === 1) {
                                openNpcDialog(`${convoId}_tier1`, [
                                    "Power Miner, Animal Wrangler, and Lumberjack are tier-1 relics.",
                                    "Their Echo tools can reroll failed gathers and auto-bank resources.",
                                    "Echo harpoon also fishes 1 tick faster and can auto-cook catches.",
                                ]);
                                return;
                            }
                            if (choiceIndex === 2) {
                                openNpcDialog(
                                    `${convoId}_reclaim_echo_tool`,
                                    reclaimLostEchoTool(player, services),
                                );
                                return;
                            }

                            const canQueueOverlay =
                                services.queueWidgetEvent &&
                                services.queueVarp &&
                                services.queueVarbit;
                            if (!canQueueOverlay) {
                                openNpcDialog(`${convoId}_overlay_unavailable`, [
                                    "I can't reopen that interface right now.",
                                    "Try relogging if the tutorial panel is missing.",
                                ]);
                                return;
                            }

                            queueLeagueTutorialOverlayUi(
                                player,
                                {
                                    queueWidgetEvent: services.queueWidgetEvent!,
                                    queueVarp: services.queueVarp!,
                                    queueVarbit: services.queueVarbit!,
                                    isWidgetGroupOpenInLedger: () => false,
                                },
                                tutorialStep,
                                { queueFlashsideVarbitOnStep3: true },
                            );
                            openNpcDialog(`${convoId}_overlay_done`, [
                                "I've reopened the tutorial panel for you.",
                                "Follow its highlighted steps to keep progressing.",
                            ]);
                        },
                    });
                },
            );
        };

        registry.registerNpcScript({
            npcId: LEAGUE_TUTOR_NPC_ID,
            option: "talk-to",
            handler: openTutorConversation,
        });
        registry.registerNpcScript({
            npcId: LEAGUE_TUTOR_NPC_ID,
            option: undefined,
            handler: openTutorConversation,
        });
    },
};
