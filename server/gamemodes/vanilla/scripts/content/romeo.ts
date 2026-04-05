import { type IScriptRegistry, type ScriptServices } from "../../../../src/game/scripts/types";

export function registerRomeoHandlers(registry: IScriptRegistry, services: ScriptServices): void {
    const activeConvos = new Set<number>();

    const playRomeoConversation = (event: any) => {
        const pid = event.player.id;
        const npcId = event.npc.typeId;

        if (activeConvos.has(pid)) return;
        activeConvos.add(pid);

        const onClose = () => {
            activeConvos.delete(pid);
        };

        const openNpcDialog = (id: string, lines: string[], onContinue?: () => void) =>
            services.openDialog?.(event.player, {
                kind: "npc",
                id,
                npcId,
                npcName: "Romeo",
                lines,
                clickToContinue: true,
                closeOnContinue: !onContinue,
                onContinue,
                onClose,
            });

        const openPlayerDialog = (id: string, lines: string[], onContinue?: () => void) =>
            services.openDialog?.(event.player, {
                kind: "player",
                id,
                playerName: event.player.name ?? "You",
                lines,
                clickToContinue: true,
                closeOnContinue: !onContinue,
                onContinue,
                onClose,
            });

        const convoId = `romeo_${pid}`;

        openNpcDialog(
            `${convoId}_intro`,
            ["Greetings, traveller!", "I'm searching for Juliet — have you seen her?"],
            () => {
                services.closeDialog?.(event.player, `${convoId}_intro`);

                services.openDialogOptions?.(event.player, {
                    id: `${convoId}_choice`,
                    title: "Romeo",
                    options: [
                        "I can help you look for her.",
                        "Haven't seen her, sorry.",
                        "Why is Juliet so important?",
                    ],
                    onClose,
                    onSelect: (choice) => {
                        activeConvos.delete(pid);
                        if (choice === 0) {
                            openPlayerDialog(
                                `${convoId}_p_help`,
                                ["I can lend a hand. Where was she last seen?"],
                                () => {
                                    openNpcDialog(`${convoId}_n_help_reply`, [
                                        "She was near the square not long ago.",
                                        "If you find her, please bring her back to me.",
                                    ]);
                                },
                            );
                        } else if (choice === 1) {
                            openPlayerDialog(
                                `${convoId}_p_no`,
                                ["No sign of her, sorry."],
                                () => {
                                    openNpcDialog(`${convoId}_n_no_reply`, [
                                        "That's unfortunate. Let me know if you do.",
                                    ]);
                                },
                            );
                        } else {
                            openPlayerDialog(
                                `${convoId}_p_why`,
                                ["Why is Juliet so important to you?"],
                                () => {
                                    openNpcDialog(`${convoId}_n_why_reply`, [
                                        "She's everything to me. We were meant to meet today.",
                                        "Please, if you see her, send her my way.",
                                    ]);
                                },
                            );
                        }
                    },
                });
            },
        );
    };

    registry.registerNpcScript({
        npcId: 5037,
        option: "talk-to",
        handler: playRomeoConversation,
    });
    registry.registerNpcScript({
        npcId: 5037,
        option: undefined,
        handler: playRomeoConversation,
    });
}
