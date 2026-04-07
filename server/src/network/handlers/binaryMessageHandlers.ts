/**
 * Handlers for binary message types that were previously in processBinaryMessage's switch.
 * These are OSRS binary packet types routed through the message system.
 */
import type { WebSocket } from "ws";

import { SkillId } from "../../../../src/rs/skill/skills";
import { CustomItemRegistry } from "../../../../src/custom/items";
import type { PlayerState } from "../../game/player";
import type { ScriptRegistry } from "../../game/scripts";
import type { ScriptRuntime } from "../../game/scripts";
import type { MessageRouter, MessageHandler } from "../MessageRouter";
import type { MessageHandlerServices } from "../MessageHandlers";
import type { Cs2ModalManager } from "../managers";
import type { WidgetDialogHandler } from "../../game/actions";
import type { GroundItemActionPayload } from "../managers";

export interface BinaryHandlerExtServices extends MessageHandlerServices {
    resolveGroundItemOptionByOpNum: (itemId: number, opNum: number) => string | undefined;
    handleGroundItemAction: (ws: WebSocket, payload: GroundItemActionPayload | undefined) => void;
    getScriptRegistry: () => ScriptRegistry;
    getScriptRuntime: () => ScriptRuntime;
    getCs2ModalManager: () => Cs2ModalManager;
    getWidgetDialogHandler: () => WidgetDialogHandler;
    getObjType: (itemId: number) => { inventoryActions?: (string | null)[] } | undefined;
    handleInventoryUseOnMessage: (ws: WebSocket, payload: Record<string, unknown>) => void;
    getGamemode: () => { onResumePauseButton?(player: PlayerState, widgetId: number, childIndex: number): boolean } | undefined;
}

export function registerBinaryHandlers(
    router: MessageRouter,
    services: BinaryHandlerExtServices,
): void {
    router.register("ground_item_action", createGroundItemActionHandler(services));
    router.register("widget_action", createWidgetActionHandler(services));
    router.register("item_spawner_search", createItemSpawnerSearchHandler(services));
    router.register("if_triggeroplocal", createIfTriggerOpLocalHandler(services));
    router.register("inventory_use_on", createInventoryUseOnHandler(services));
    router.register("resume_pausebutton", createResumePauseButtonHandler(services));
}

function createGroundItemActionHandler(services: BinaryHandlerExtServices): MessageHandler {
    return (ctx) => {
        const player = services.getPlayer(ctx.ws);
        if (!player) return;
        const payload = { ...(ctx.payload as GroundItemActionPayload) };
        if (!payload.option || payload.option.length === 0) {
            const opNum = payload.opNum;
            if (opNum !== undefined && opNum > 0) {
                const resolved = services.resolveGroundItemOptionByOpNum(payload.itemId, opNum);
                if (resolved) payload.option = resolved;
            }
        }
        services.handleGroundItemAction(ctx.ws, payload);
    };
}

function createWidgetActionHandler(services: BinaryHandlerExtServices): MessageHandler {
    return (ctx) => {
        const player = services.getPlayer(ctx.ws);
        if (!player) return;
        const payload = ctx.payload as unknown as { widgetId: number; groupId?: number; buttonNum?: number; slot?: number; option?: string; itemId?: number };
        const groupId = payload.groupId ?? (payload.widgetId >> 16) & 0xffff;
        const componentId = payload.widgetId & 0xffff;
        const opId = payload.buttonNum ?? 1;
        const slotVal = payload.slot;
        const hasValidSlot = slotVal !== undefined && slotVal >= 0 && slotVal !== 65535;
        const childId = hasValidSlot ? slotVal : componentId;

        const scriptRegistry = services.getScriptRegistry();
        const scriptRuntime = services.getScriptRuntime();
        const buttonHandler = scriptRegistry.findButton(groupId, componentId);
        if (buttonHandler) {
            const tick = services.getCurrentTick();
            buttonHandler({
                tick, services: scriptRuntime.getServices(), player,
                widgetId: payload.widgetId, groupId, childId,
                option: payload.option, opId, slot: slotVal, itemId: payload.itemId,
            });
            return;
        }

        const cs2Modal = services.getCs2ModalManager();
        if (cs2Modal.handleWidgetAction(player, groupId, componentId, payload.option, payload.itemId)) {
            return;
        }

        if (groupId === 219) {
            services.getWidgetDialogHandler().handleDialogOptionClick(ctx.ws, player.id, childId);
        } else {
            if (payload.itemId !== undefined && payload.itemId > 0 && hasValidSlot && opId >= 1) {
                let actions: (string | null | undefined)[] | undefined;
                const customItem = CustomItemRegistry.get(payload.itemId);
                if (customItem?.definition?.objType?.inventoryActions) {
                    actions = customItem.definition.objType.inventoryActions;
                }
                if (!actions) {
                    const obj = services.getObjType(payload.itemId);
                    actions = obj?.inventoryActions;
                }
                if (actions) {
                    const resolved = actions[opId - 1];
                    if (resolved) {
                        const tick = services.getCurrentTick();
                        if (scriptRuntime.queueItemAction({ tick, player, itemId: payload.itemId, slot: slotVal ?? 0, option: resolved.toLowerCase() })) return;
                    }
                }
                const tick = services.getCurrentTick();
                if (scriptRuntime.queueItemAction({ tick, player, itemId: payload.itemId, slot: slotVal ?? 0 })) return;
            }
            services.getWidgetDialogHandler().handleWidgetActionMessage(ctx.ws, { ...payload, opId, childId });
        }
    };
}

function createItemSpawnerSearchHandler(services: BinaryHandlerExtServices): MessageHandler {
    return (ctx) => {
        const player = services.getPlayer(ctx.ws);
        if (!player) return;
        const scriptRegistry = services.getScriptRegistry();
        const msgHandler = scriptRegistry.findClientMessageHandler("item_spawner_search");
        if (msgHandler) {
            const tick = services.getCurrentTick();
            const scriptRuntime = services.getScriptRuntime();
            msgHandler({
                tick, services: scriptRuntime.getServices(), player,
                messageType: "item_spawner_search", payload: ctx.payload ?? {},
            });
        }
    };
}

function createIfTriggerOpLocalHandler(services: BinaryHandlerExtServices): MessageHandler {
    return (ctx) => {
        const player = services.getPlayer(ctx.ws);
        if (!player) return;
        const { widgetUid, childIndex, itemId, opcodeParam } = ctx.payload as unknown as { widgetUid: number; childIndex: number; itemId?: number; opcodeParam: number };
        if (opcodeParam >= 1 && opcodeParam <= 10) {
            const groupId = (widgetUid >>> 16) & 0xffff;
            const componentId = widgetUid & 0xffff;
            const hasChild = childIndex >= 0;
            const childId = hasChild ? childIndex : componentId;
            services.getWidgetDialogHandler().handleWidgetActionMessage(ctx.ws, {
                widgetId: widgetUid, groupId, childId, opId: opcodeParam,
                slot: hasChild ? childIndex : undefined, itemId,
            });
        }
    };
}

function createInventoryUseOnHandler(services: BinaryHandlerExtServices): MessageHandler {
    return (ctx) => {
        const player = services.getPlayer(ctx.ws);
        if (!player) return;
        services.handleInventoryUseOnMessage(ctx.ws, ctx.payload);
    };
}

function createResumePauseButtonHandler(services: BinaryHandlerExtServices): MessageHandler {
    return (ctx) => {
        const player = services.getPlayer(ctx.ws);
        if (!player) return;
        const { widgetId, childIndex } = ctx.payload as unknown as { widgetId: number; childIndex: number };
        const widgetGroup = (widgetId >> 16) & 0xffff;

        const gamemode = services.getGamemode();
        if (gamemode?.onResumePauseButton?.(player, widgetId, childIndex)) {
            return;
        }

        if (widgetGroup === 270) {
            services.getWidgetDialogHandler().handleWidgetActionMessage(ctx.ws, {
                widgetId, groupId: widgetGroup, childId: widgetId & 0xffff, opId: 1, slot: childIndex,
            });
        } else if (services.getCs2ModalManager().handleResumePauseButton(player, widgetId, childIndex)) {
            // handled
        } else {
            services.getWidgetDialogHandler().handleResumePauseButton(ctx.ws, player.id, widgetId, childIndex);
        }
    };
}
