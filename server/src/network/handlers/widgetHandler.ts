import type { MessageHandler } from "../MessageRouter";
import type { MessageHandlerServices } from "../MessageHandlers";
import { encodeMessage } from "../messages";
import { logger } from "../../utils/logger";

const SIDE_JOURNAL_GROUP_ID = 629;
const MUSIC_GROUP_ID = 239;

export function createWidgetHandler(services: MessageHandlerServices): MessageHandler<"widget"> {
    return (ctx) => {
        try {
            const p = services.getPlayer(ctx.ws);
            if (!p) return;
            const { groupId, action, modal } = ctx.payload as any;
            if (action === "open") {
                logger.info(`[widget-open] player=${p.id} group=${groupId} modal=${modal}`);
                services.noteWidgetEventForLedger(p.id, { action: "open", groupId, modal });
                p.widgets.open(groupId, { modal });
                if (groupId === SIDE_JOURNAL_GROUP_ID) {
                    const sideJournalState = services.normalizeSideJournalState(p);
                    const { VARP_SIDE_JOURNAL_STATE, VARBIT_SIDE_JOURNAL_TAB } = (() => {
                        const varps = services.getVarpConstants();
                        const varbits = services.getVarbitConstants();
                        return {
                            VARP_SIDE_JOURNAL_STATE: varps.VARP_SIDE_JOURNAL_STATE,
                            VARBIT_SIDE_JOURNAL_TAB: varbits.VARBIT_SIDE_JOURNAL_TAB,
                        };
                    })();
                    services.withDirectSendBypass("varp", () =>
                        services.sendWithGuard(
                            ctx.ws,
                            encodeMessage({
                                type: "varp",
                                payload: { varpId: VARP_SIDE_JOURNAL_STATE, value: sideJournalState.stateVarp },
                            }),
                            "varp",
                        ),
                    );
                    services.withDirectSendBypass("varbit", () =>
                        services.sendWithGuard(
                            ctx.ws,
                            encodeMessage({
                                type: "varbit",
                                payload: { varbitId: VARBIT_SIDE_JOURNAL_TAB, value: sideJournalState.tab },
                            }),
                            "varbit",
                        ),
                    );
                    services.queueSideJournalGamemodeUi(p);
                }
                if (groupId === MUSIC_GROUP_ID) {
                    services.syncMusicInterface(p);
                }
            } else if (action === "close") {
                logger.info(`[widget-close] player=${p.id} group=${groupId}`);
                services.noteWidgetEventForLedger(p.id, { action: "close", groupId });
                services.handleCs2ModalCloseState(p, groupId);
                services.handleDialogCloseState(p, groupId);
                const interfaceService = services.getInterfaceService();
                let closedEntries: any[] = [];
                let handledByInterfaceService = false;
                if (interfaceService?.isChatboxModalOpen(p, groupId)) {
                    handledByInterfaceService = true;
                    interfaceService.closeChatboxModal(p);
                } else if (interfaceService?.isModalOpen(p, groupId)) {
                    handledByInterfaceService = true;
                    interfaceService.closeModal(p);
                } else if (interfaceService?.getCurrentSidemodal(p) === groupId) {
                    handledByInterfaceService = true;
                    interfaceService.closeSidemodal(p);
                } else {
                    closedEntries = p.widgets.close(groupId);
                }
                if (interfaceService && closedEntries.length > 0) {
                    interfaceService.triggerCloseHooksForEntries(p, closedEntries);
                } else if (interfaceService && !handledByInterfaceService) {
                    interfaceService.triggerCloseHooksForExternalClose(p, groupId);
                }
                services.getGamemodeUi()?.handleWidgetClose(p, groupId);
            }
        } catch {}
    };
}
