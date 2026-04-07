/**
 * Widget and Dialog handler.
 *
 * Handles all dialog and widget action processing extracted from wsServer:
 * - Dialog opening (NPC, player, sprite, double_sprite, options)
 * - Dialog selection and continue handling
 * - Widget action normalization and routing
 * - Dialog close state management
 */
import {
    setOptionsDialogFlags,
    setSpriteDialogFlags,
} from "../../../widgets/hooks/DialogInterfaceHooks";
import { logger } from "../../../utils/logger";
import type { ServerServices } from "../../ServerServices";
import type { PlayerState } from "../../player";

// ============================================================================
// Types
// ============================================================================

/** Widget action for queuing. */
export interface WidgetAction {
    action: string;
    uid?: number;
    hidden?: boolean;
    targetUid?: number;
    groupId?: number;
    type?: number;
    flags?: number;
    text?: string;
    dialogId?: string;
    title?: string;
    options?: string[];
    disabledOptions?: number[];
    itemId?: number;
    quantity?: number;
    /** Script ID for run_script actions */
    scriptId?: number;
    /** Script arguments for run_script actions */
    args?: (number | string)[];
    /** Varp snapshot to send with run_script */
    varps?: Record<number, number>;
    /** Varbit snapshot to send with run_script */
    varbits?: Record<number, number>;
    /** Start slot for set_flags_range */
    fromSlot?: number;
    /** End slot for set_flags_range */
    toSlot?: number;
    npcId?: number;
    animationId?: number;
}

/** Script dialog request. */
export interface ScriptDialogRequest {
    kind: "npc" | "player" | "sprite" | "double_sprite";
    id?: string;
    lines?: string[] | string;
    clickToContinue?: boolean;
    closeOnContinue?: boolean;
    modal?: boolean;
    npcId?: number;
    npcName?: string;
    animationId?: number;
    playerName?: string;
    itemId?: number;
    itemQuantity?: number;
    leftItemId?: number;
    rightItemId?: number;
    leftItemQuantity?: number;
    rightItemQuantity?: number;
    title?: string;
    onContinue?: () => void;
    onClose?: () => void;
}

/** Script dialog option request. */
export interface ScriptDialogOptionRequest {
    id?: string;
    title?: string;
    options: string[];
    disabledOptions?: boolean[];
    onSelect?: (choice: number) => void;
    onClose?: () => void;
}

/** Widget action request from client. */
export interface WidgetActionRequest {
    widgetId: number;
    groupId: number;
    childId: number;
    option?: string;
    target?: string;
    opId?: number;
    isPrimary?: boolean;
    cursorX?: number;
    cursorY?: number;
    slot?: number;
    itemId?: number;
}

/** WebSocket reference type. */
export interface WebSocketRef {
    readyState: number;
}

type ActiveChatboxDialogState = {
    dialogId: string;
    groupId: number;
    resumeWidgetId?: number;
    resumeChildIndex?: number;
    optionCount?: number;
    onSelect?: (choice: number) => void;
    onContinue?: () => void;
    onClose?: () => void;
};

// ============================================================================
// Constants
// ============================================================================

const DIALOG_GROUP_NPC = 231;
const DIALOG_GROUP_PLAYER = 217;
const DIALOG_GROUP_SPRITE = 193;
const DIALOG_GROUP_DOUBLE_SPRITE = 11;
const DIALOG_GROUP_OPTIONS = 219;

const CHAT_DIALOG_HEAD_COMPONENT = 2;
const CHAT_DIALOG_INNER_COMPONENT = 1;
const CHAT_DIALOG_TITLE_COMPONENT = 4;
const CHAT_DIALOG_CONTINUE_COMPONENT = 5;
const CHAT_DIALOG_TEXT_COMPONENT = 6;
const DOUBLE_SPRITE_LEFT_ITEM_COMPONENT = 1;
const DOUBLE_SPRITE_TEXT_COMPONENT = 2;
const DOUBLE_SPRITE_RIGHT_ITEM_COMPONENT = 3;
const DOUBLE_SPRITE_CONTINUE_COMPONENT = 4;

const SHOP_GROUP_ID = 300;
const BANK_GROUP_ID = 12;

// ============================================================================
// WidgetDialogHandler
// ============================================================================

/**
 * Handles widget actions and dialog management.
 */
export class WidgetDialogHandler {
    private activeChatboxDialogs = new Map<number, ActiveChatboxDialogState>();

    constructor(private readonly svc: ServerServices) {}

    // ========================================================================
    // Public Methods
    // ========================================================================

    /**
     * Normalize dialog lines to array of strings.
     */
    normalizeDialogLines(lines: string[] | string | undefined): string[] {
        const out: string[] = [];
        const lineArray = Array.isArray(lines) ? lines : lines !== undefined ? [lines] : [];
        for (const line of lineArray) {
            const text = String(line ?? "")
                .replace(/\r\n/g, "\n")
                .replace(/\r/g, "\n")
                .trim();
            if (!text) continue;
            out.push(text);
            if (out.length >= 4) break; // Chatbox dialogs show up to 4 lines
        }
        return out;
    }

    /**
     * Open a dialog for a player.
     */
    openDialog(player: PlayerState, request: ScriptDialogRequest): void {
        if (!request) return;
        const dialogId = String(request.id || "dialog").trim();
        const lines = this.normalizeDialogLines(request.lines);
        if (!dialogId || lines.length === 0) return;
        const trimmedNpcName = request.npcName?.trim();
        const trimmedPlayerName = request.playerName?.trim();
        const trimmedTitle = request.title?.trim();

        let groupId = DIALOG_GROUP_NPC;
        const payload: {
            clickToContinue?: boolean;
            closeOnContinue?: boolean;
            modal?: boolean;
            npcId?: number;
            npcName?: string;
            animationId?: number;
            playerName?: string;
            itemId?: number;
            itemQuantity?: number;
            leftItemId?: number;
            rightItemId?: number;
            leftItemQuantity?: number;
            rightItemQuantity?: number;
            title?: string;
        } = {
            clickToContinue: request.clickToContinue !== false,
            closeOnContinue: request.closeOnContinue !== false,
            modal: request.modal ?? true,
        };

        if (request.kind === "npc") {
            groupId = DIALOG_GROUP_NPC;
            payload.npcId = request.npcId;
            payload.npcName =
                trimmedNpcName && trimmedNpcName.length > 0 ? trimmedNpcName : undefined;
            payload.animationId = request.animationId;
        } else if (request.kind === "player") {
            groupId = DIALOG_GROUP_PLAYER;
            payload.playerName =
                trimmedPlayerName && trimmedPlayerName.length > 0 ? trimmedPlayerName : undefined;
            payload.animationId = request.animationId;
        } else if (request.kind === "sprite") {
            groupId = DIALOG_GROUP_SPRITE;
            payload.itemId = request.itemId;
            payload.itemQuantity =
                request.itemQuantity != null ? Math.max(1, request.itemQuantity) : undefined;
            payload.title = trimmedTitle && trimmedTitle.length > 0 ? trimmedTitle : undefined;
        } else if (request.kind === "double_sprite") {
            groupId = DIALOG_GROUP_DOUBLE_SPRITE;
            payload.leftItemId = request.leftItemId;
            payload.rightItemId = request.rightItemId;
            payload.leftItemQuantity =
                request.leftItemQuantity != null
                    ? Math.max(1, request.leftItemQuantity)
                    : undefined;
            payload.rightItemQuantity =
                request.rightItemQuantity != null
                    ? Math.max(1, request.rightItemQuantity)
                    : undefined;
            payload.title = trimmedTitle && trimmedTitle.length > 0 ? trimmedTitle : undefined;
        }

        // Ensure any prior chatbox modal is cleared before opening a new one.
        this.closeDialog(player, undefined, true);

        const playerId = player.id;

        // Open chatbox modal - handles mounting, visibility, and varbit
        // RSMod parity: itemMessageBox (sprite dialog) does NOT call script 2379 or set chatmodal_unclamp.
        // Other dialog types (NPC, player, double_sprite) DO call script 2379.
        const isSpriteDialog = request.kind === "sprite";
        const isNpcDialog = request.kind === "npc";
        const isPlayerDialog = request.kind === "player";
        const chatDialogGroupForScript55 = isNpcDialog
            ? DIALOG_GROUP_NPC
            : isPlayerDialog
            ? DIALOG_GROUP_PLAYER
            : -1;
        const dialogPreScripts = isSpriteDialog
            ? undefined
            : [{ scriptId: 2379, args: [] as (number | string)[] }];
        const dialogPostScripts =
            chatDialogGroupForScript55 >= 0
                ? [
                      {
                          // script 55 installs key/click listeners onto the mounted chat dialog
                          // widgets, so it must run after the interface exists client-side.
                          scriptId: 55,
                          args: [
                              (chatDialogGroupForScript55 << 16) | CHAT_DIALOG_CONTINUE_COMPONENT,
                              (chatDialogGroupForScript55 << 16) | CHAT_DIALOG_INNER_COMPONENT,
                              83,
                              "",
                              "",
                              255,
                          ],
                      },
                      {
                          // script 600 sets the body text widget alignment/line-height. Running it
                          // before the first set_text avoids the first-open reflow jump.
                          scriptId: 600,
                          args: [
                              1,
                              1,
                              16,
                              (chatDialogGroupForScript55 << 16) | CHAT_DIALOG_TEXT_COMPONENT,
                          ],
                      },
                  ]
                : undefined;
        this.svc.interfaceService!.openChatboxModal(
            player,
            groupId,
            { dialogId, ...payload },
            isSpriteDialog
                ? { skipChatmodalUnclamp: true }
                : { preScripts: dialogPreScripts, postScripts: dialogPostScripts },
        );

        let resumeWidgetId: number | undefined;
        let resumeChildIndex: number | undefined;
        if (request.kind === "npc" || request.kind === "player") {
            resumeWidgetId = (groupId << 16) | CHAT_DIALOG_CONTINUE_COMPONENT;
            resumeChildIndex = CHAT_DIALOG_CONTINUE_COMPONENT;
        } else if (request.kind === "sprite") {
            // Script 2868 creates the continue widget as dynamic child 2 under 193:0.
            resumeWidgetId = DIALOG_GROUP_SPRITE << 16;
            resumeChildIndex = 2;
        } else if (request.kind === "double_sprite") {
            resumeWidgetId = (groupId << 16) | DOUBLE_SPRITE_CONTINUE_COMPONENT;
            resumeChildIndex = DOUBLE_SPRITE_CONTINUE_COMPONENT;
        }

        this.activeChatboxDialogs.set(player.id, {
            dialogId,
            groupId,
            resumeWidgetId,
            resumeChildIndex,
            onContinue:
                payload.clickToContinue === false
                    ? undefined
                    : request.onContinue
                    ? request.onContinue
                    : payload.closeOnContinue !== false
                    ? () => {
                          this.closeDialog(player, dialogId);
                      }
                    : undefined,
            onClose: request.onClose,
        });

        if (request.kind === "npc" || request.kind === "player") {
            const headUid = (groupId << 16) | CHAT_DIALOG_HEAD_COMPONENT;
            const titleUid = (groupId << 16) | CHAT_DIALOG_TITLE_COMPONENT;
            const continueUid = (groupId << 16) | CHAT_DIALOG_CONTINUE_COMPONENT;
            const textUid = (groupId << 16) | CHAT_DIALOG_TEXT_COMPONENT;
            const titleText =
                request.kind === "npc"
                    ? payload.npcName || trimmedTitle || ""
                    : payload.playerName || trimmedTitle || "";

            if (request.kind === "npc" && payload.npcId != null) {
                this.svc.queueWidgetEvent(playerId, {
                    action: "set_npc_head",
                    uid: headUid,
                    npcId: payload.npcId,
                });
            } else if (request.kind === "player") {
                this.svc.queueWidgetEvent(playerId, {
                    action: "set_player_head",
                    uid: headUid,
                });
            }

            this.svc.queueWidgetEvent(playerId, {
                action: "set_animation",
                uid: headUid,
                animationId: payload.animationId ?? 588,
            });
            this.svc.queueWidgetEvent(playerId, {
                action: "set_text",
                uid: titleUid,
                text: titleText,
            });
            this.svc.queueWidgetEvent(playerId, {
                action: "set_text",
                uid: textUid,
                text: lines.join("<br>"),
            });
            this.svc.queueWidgetEvent(playerId, {
                action: "set_text",
                uid: continueUid,
                text: payload.clickToContinue !== false ? "Click here to continue" : "",
            });
            return;
        }

        // For sprite dialogs (interface 193), use RSMod parity:
        // - Component 1: set_item (item display)
        // - Component 2: set_text (message text)
        // - Script 2868: creates continue button with blue text
        if (request.kind === "sprite") {
            // Set item on component 1 (RSMod: setComponentItem(193, 1, item, amountOrZoom))
            // The amountOrZoom value determines both the displayed quantity
            // and the model used (via getCountObj). For sprite dialogs, OSRS uses a capped
            // value to show a reasonable-sized model (RSMod example uses 400).
            if (payload.itemId != null && payload.itemId >= 0) {
                const SPRITE_DIALOG_AMOUNT_CAP = 250;
                const amountOrZoom = Math.min(payload.itemQuantity ?? 1, SPRITE_DIALOG_AMOUNT_CAP);
                this.svc.queueWidgetEvent(playerId, {
                    action: "set_item",
                    uid: (DIALOG_GROUP_SPRITE << 16) | 1,
                    itemId: payload.itemId,
                    quantity: amountOrZoom,
                });
            }
            // Set message text on component 2 (RSMod: setComponentText(193, 2, message))
            this.svc.queueWidgetEvent(playerId, {
                action: "set_text",
                uid: (DIALOG_GROUP_SPRITE << 16) | 2,
                text: lines.join("<br>"),
            });
            // Run script 2868 (objbox_setbuttons) to set up continue button
            if (payload.clickToContinue !== false) {
                this.svc.broadcastService.queueClientScript(playerId, 2868, "Click here to continue");
                // Set flags AFTER script 2868 creates the continue button
                setSpriteDialogFlags(this.svc.interfaceService!, player);
            }
            return;
        }

        if (request.kind === "double_sprite") {
            const bodyLines = payload.title ? [payload.title, ...lines] : lines;

            if (payload.leftItemId != null && payload.leftItemId >= 0) {
                this.svc.queueWidgetEvent(playerId, {
                    action: "set_item",
                    uid: (DIALOG_GROUP_DOUBLE_SPRITE << 16) | DOUBLE_SPRITE_LEFT_ITEM_COMPONENT,
                    itemId: payload.leftItemId,
                    quantity: payload.leftItemQuantity ?? 1,
                });
            }
            if (payload.rightItemId != null && payload.rightItemId >= 0) {
                this.svc.queueWidgetEvent(playerId, {
                    action: "set_item",
                    uid: (DIALOG_GROUP_DOUBLE_SPRITE << 16) | DOUBLE_SPRITE_RIGHT_ITEM_COMPONENT,
                    itemId: payload.rightItemId,
                    quantity: payload.rightItemQuantity ?? 1,
                });
            }
            this.svc.queueWidgetEvent(playerId, {
                action: "set_text",
                uid: (DIALOG_GROUP_DOUBLE_SPRITE << 16) | DOUBLE_SPRITE_TEXT_COMPONENT,
                text: bodyLines.join("<br>"),
            });
            this.svc.queueWidgetEvent(playerId, {
                action: "set_text",
                uid: (DIALOG_GROUP_DOUBLE_SPRITE << 16) | DOUBLE_SPRITE_CONTINUE_COMPONENT,
                text: payload.clickToContinue !== false ? "Click here to continue" : "",
            });
        }
    }

    /**
     * Open an options dialog for a player.
     * Uses rsmod parity approach: varbit 5983, script 2379, open_sub, script 58, set_flags.
     */
    openDialogOptions(player: PlayerState, request: ScriptDialogOptionRequest): void {
        if (!request || !Array.isArray(request.options) || request.options.length === 0) {
            return;
        }
        const dialogId = String(request.id || "dialog");
        this.closeDialog(player, undefined, true);

        const playerId = player.id;
        const options = request.options.slice(0, 5).map((opt) => String(opt ?? ""));
        const title = request.title ?? "Select an Option";
        const pipeOptions = options.join("|");

        // Set varbit 5983 = 1 (dialog mode) - required before opening
        this.svc.variableService.queueVarbit(playerId, 5983, 1);

        // Open chatbox modal with preScripts for background reset
        this.svc.interfaceService!.openChatboxModal(
            player,
            DIALOG_GROUP_OPTIONS,
            { dialogId },
            {
                preScripts: [{ scriptId: 2379, args: [] }],
            },
        );

        // Run script 58 (chatbox_multi_init) to create option buttons
        this.svc.broadcastService.queueClientScript(playerId, 58, title, pipeOptions);

        // Set flags for option buttons using helper
        setOptionsDialogFlags(this.svc.interfaceService!, player, options.length);

        this.activeChatboxDialogs.set(player.id, {
            dialogId,
            groupId: DIALOG_GROUP_OPTIONS,
            resumeWidgetId: (DIALOG_GROUP_OPTIONS << 16) | 1,
            optionCount: options.length,
            onSelect: (choice) => {
                try {
                    request.onSelect?.(choice);
                } catch (err) {
                    logger.warn(
                        `[dialog] handler failed player=${player.id} dialog=${dialogId}`,
                        err,
                    );
                }
            },
            onClose: request.onClose,
        });
    }

    /**
     * Close a dialog for a player.
     */
    closeDialog(
        player: PlayerState,
        dialogId?: string,
        _suppressPacket: boolean = false,
        groupIdHint?: number,
    ): void {
        const active = this.activeChatboxDialogs.get(player.id);
        if (active) {
            const matchesDialog = dialogId === undefined || active.dialogId === dialogId;
            const matchesGroup = groupIdHint === undefined || active.groupId === groupIdHint;
            if (!matchesDialog || !matchesGroup) {
                return;
            }
            this.activeChatboxDialogs.delete(player.id);
        }

        // InterfaceService.closeChatboxModal handles:
        // - Executing onClose hooks (which reset varbits)
        // - Sending close_sub and set_hidden widget events
        this.svc.interfaceService!.closeChatboxModal(player);
    }

    /**
     * Clear all dialogs for a player.
     */
    closeAllPlayerDialogs(player: PlayerState): void {
        const playerId = player.id;

        // Only send close events if there's actually something to close
        const hasDialogs = this.activeChatboxDialogs.has(playerId);

        // Also check InterfaceService state
        const hasInterfaceModal =
            this.svc.interfaceService!.getCurrentChatboxModal(player) !== undefined;

        if (!hasDialogs && !hasInterfaceModal) {
            return; // Nothing to close, skip sending widget events
        }

        this.triggerAndClearActiveDialogCloseHandler(playerId);

        // InterfaceService.closeChatboxModal handles all cleanup
        this.svc.interfaceService!.closeChatboxModal(player);
    }

    /**
     * Cleanup player dialog state without triggering close handlers.
     * Used during player logout/disconnect.
     */
    cleanupPlayerDialogState(playerId: number): void {
        this.activeChatboxDialogs.delete(playerId);
    }

    /**
     * Handle dialog option click from widget_action (interface 219).
     * The childIndex from the widget click is the option index.
     */
    handleDialogOptionClick(ws: WebSocketRef, playerId: number, childIndex: number): void {
        const player = this.svc.players?.getById(playerId);
        if (!player) return;

        const active = this.activeChatboxDialogs.get(playerId);
        if (!active || active.groupId !== DIALOG_GROUP_OPTIONS || !active.onSelect) {
            logger.info(`[dialog] no active options dialog for player=${playerId}`);
            return;
        }
        const dialogId = active.dialogId;
        const optionCount = Math.max(0, active.optionCount ?? 0);

        // Close the dialog interface
        this.activeChatboxDialogs.delete(playerId);
        this.svc.interfaceService!.closeChatboxModal(player);

        // Call the handler with the selected option index
        // childIndex from CS2 scripts (script 58/59) is 1-based:
        // - Option 1 has childIndex 1
        // - Option 2 has childIndex 2, etc.
        // Convert to 0-based for handler callbacks.
        const optionIndex = Math.max(0, Math.min(optionCount - 1, childIndex - 1));
        try {
            logger.info(
                `[dialog] option selected player=${playerId} choice=${optionIndex} (childIndex=${childIndex})`,
            );
            active.onSelect(optionIndex);
        } catch (err) {
            logger.warn(
                `[dialog] handler execution failed player=${playerId} dialog=${dialogId}`,
                err,
            );
        }
    }

    /**
     * Handle RESUME_PAUSEBUTTON for the active chatbox dialog.
     */
    handleResumePauseButton(
        ws: WebSocketRef,
        playerId: number,
        widgetId: number,
        childIndex: number,
    ): boolean {
        const player = this.svc.players?.getById(playerId);
        if (!player) return false;
        const active = this.activeChatboxDialogs.get(playerId);
        if (!active) return false;

        const widgetGroup = (widgetId >>> 16) & 0xffff;
        if (widgetGroup !== active.groupId) {
            return false;
        }
        if (active.resumeWidgetId !== undefined && (active.resumeWidgetId | 0) !== (widgetId | 0)) {
            return false;
        }
        if (
            active.resumeChildIndex !== undefined &&
            (active.resumeChildIndex | 0) !== (childIndex | 0)
        ) {
            return false;
        }

        if (active.groupId === DIALOG_GROUP_OPTIONS && active.onSelect) {
            this.handleDialogOptionClick(ws, playerId, childIndex);
            return true;
        }
        if (!active.onContinue) {
            logger.info(
                `[dialog] continue with no handler player=${player.id} dialogId=${active.dialogId}`,
            );
            return true;
        }

        logger.info(
            `[dialog] continue handler firing player=${player.id} dialogId=${active.dialogId} widget=${widgetId} child=${childIndex}`,
        );
        this.activeChatboxDialogs.delete(playerId);
        const onContinue = active.onContinue;
        try {
            onContinue();
        } catch (err) {
            logger.warn(
                `[dialog] continue handler execution failed player=${player.id} dialog=${active.dialogId}`,
                err,
            );
        }
        return true;
    }

    /**
     * Handle widget action message from client.
     * Note: Dialog options (group 219) are handled in the binary packet path before reaching here.
     */
    handleWidgetActionMessage(ws: WebSocketRef, payload: WidgetActionRequest): void {
        try {
            const player = this.svc.players?.get(ws as any);
            if (!player) return;
            const normalized = this.normalizeWidgetActionPayload(payload);
            if (!normalized) return;

            const tick = this.svc.ticker.currentTick();
            const dispatched = this.svc.scriptRuntime.queueWidgetAction({
                tick,
                player,
                widgetId: normalized.widgetId,
                groupId: normalized.groupId,
                childId: normalized.childId,
                option: normalized.option,
                target: normalized.target,
                opId: normalized.opId,
                slot: normalized.slot,
                itemId: normalized.itemId,
                isPrimary: normalized.isPrimary,
                cursorX: normalized.cursorX,
                cursorY: normalized.cursorY,
            });
            const opLabel = normalized.opId !== undefined ? normalized.opId.toString() : "na";
            if (!dispatched) {
                logger.info(
                    `[widget_action] no handler player=${player.id} widget=${
                        normalized.widgetId
                    } op=${opLabel} option=${normalized.option ?? ""}`,
                );
            } else {
                logger.info(
                    `[widget_action] dispatched player=${player.id} widget=${
                        normalized.widgetId
                    } op=${opLabel} option=${normalized.option ?? ""} slot=${
                        normalized.slot ?? "na"
                    } itemId=${normalized.itemId ?? "na"}`,
                );
            }
        } catch (err) {
            logger.warn("[widget_action] failed to handle widget action", err);
        }
    }

    /**
     * Normalize widget action payload.
     */
    normalizeWidgetActionPayload(payload: WidgetActionRequest): WidgetActionRequest | undefined {
        if (!payload) return undefined;
        const normalized: WidgetActionRequest = {
            widgetId: payload.widgetId,
            groupId: payload.groupId,
            childId: payload.childId,
        };
        const clampText = (value: string | undefined): string | undefined => {
            if (value === undefined) return undefined;
            const trimmed = value.trim();
            if (!trimmed) return undefined;
            return trimmed.slice(0, 64);
        };
        const option = clampText(payload.option);
        if (option) normalized.option = option;
        const target = clampText(payload.target);
        if (target) normalized.target = target;
        if (payload.opId !== undefined) normalized.opId = Math.floor(payload.opId);
        if (payload.isPrimary !== undefined) normalized.isPrimary = payload.isPrimary;
        if (payload.cursorX !== undefined) normalized.cursorX = Math.floor(payload.cursorX);
        if (payload.cursorY !== undefined) normalized.cursorY = Math.floor(payload.cursorY);
        if (payload.slot !== undefined) normalized.slot = Math.floor(payload.slot);
        if (payload.itemId !== undefined) normalized.itemId = Math.floor(payload.itemId);
        return normalized;
    }

    /**
     * Handle widget close state.
     */
    handleWidgetCloseState(player: PlayerState, groupId: number): void {
        const active = this.activeChatboxDialogs.get(player.id);
        if (active && active.groupId === groupId) {
            this.triggerAndClearActiveDialogCloseHandler(player.id, groupId);
        }
        if (groupId === SHOP_GROUP_ID) {
            this.svc.scriptRuntime.getServices().closeShop?.(player);
        } else if (groupId === BANK_GROUP_ID) {
            this.svc.interfaceService?.closeModal(player);
        } else if (groupId === 312) {
            this.svc.broadcastService.queueSmithingInterfaceMessage(player.id, { kind: "close" } as any);
        }
    }

    // ========================================================================
    // Private Helper Methods
    // ========================================================================

    private triggerAndClearActiveDialogCloseHandler(playerId: number, groupId?: number): void {
        const active = this.activeChatboxDialogs.get(playerId);
        if (!active) return;
        if (groupId !== undefined && active.groupId !== groupId) {
            return;
        }
        this.activeChatboxDialogs.delete(playerId);
        if (!active.onClose) {
            return;
        }
        try {
            active.onClose();
        } catch (err) {
            logger.warn(
                `[dialog] close handler failed player=${playerId} dialog=${active.dialogId}`,
                err,
            );
        }
    }
}
