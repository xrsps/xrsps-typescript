import { sendWidgetAction } from "../../network/ServerConnection";
import type { WidgetActionClientPayload } from "../../network/ServerConnection";
import type { Cs2Vm, ScriptEvent } from "../../rs/cs2/Cs2Vm";
import { createScriptEvent } from "../../rs/cs2/Cs2Vm";
import type { VarManager } from "../../rs/config/vartype/VarManager";
import type { Inventory } from "../../rs/inventory/Inventory";
import type { WidgetManager } from "../../widgets/WidgetManager";
import { shouldTransmitAction } from "../../widgets/WidgetFlags";
import type { InputManager } from "../InputManager";
import type { ItemSpawnerUi } from "./itemSpawner";
import type { PlayerDesignController } from "./PlayerDesignController";
import type { WidgetInteractionController } from "./WidgetInteractionController";
import {
    handleWidgetActionPauseButton,
    handleWidgetActionTargeting,
    type SelectedSpellInfo,
    type SpellSelectionState,
    type WidgetActionHandlersDeps,
} from "./widgetActionHandlers";
import {
    buildWidgetActionPayload,
    inferWidgetOpId,
    resolveTransmitFlagWidget,
    type WidgetActionEvent,
} from "./widgetActionPayload";
import { handleTradeWidgetAction, type WidgetActionTradeDeps } from "./widgetActionTrade";

export type { WidgetActionEvent } from "./widgetActionPayload";

export type WidgetActionRouterDeps = WidgetActionHandlersDeps &
    WidgetActionTradeDeps & {
        getInputManager: () => InputManager | undefined;
        getWidgetInteraction: () => WidgetInteractionController;
        getItemSpawnerUi: () => ItemSpawnerUi;
        getPlayerDesign: () => PlayerDesignController;
        executeScriptListener: (
            widget: any,
            listener: any[],
            eventContext?: Partial<ScriptEvent>,
        ) => void;
        getPendingInputDialogAction: () => {
            payload: WidgetActionClientPayload;
            option: string;
        } | null;
        setPendingInputDialogAction: (
            action: { payload: WidgetActionClientPayload; option: string } | null,
        ) => void;
    };

function resolveDynamicChildForAction(
    widgetManager: WidgetManager | undefined,
    widget: any,
    slot: unknown,
): any {
    if (!widget || typeof slot !== "number") return widget;
    const idx = slot | 0;
    if (idx < 0) return widget;
    let host = widget as any;
    let children = host?.children;
    if (!Array.isArray(children) && typeof host?.uid === "number") {
        const canonical = widgetManager?.getWidgetByUid?.((host.uid as number) | 0);
        if (canonical) {
            host = canonical as any;
            children = (canonical as any)?.children;
        }
    }
    if (!Array.isArray(children)) return widget;
    const child = children[idx];
    if (!child) return widget;
    if ((child.fileId | 0) !== -1) return widget;
    if (typeof child.childIndex === "number" && (child.childIndex | 0) !== idx) {
        return widget;
    }
    const childParentUid =
        typeof child.parentUid === "number" ? (child.parentUid as number) | 0 : undefined;
    const widgetUid =
        typeof widget.uid === "number" ? (widget.uid as number) | 0 : undefined;
    const widgetId = typeof widget.id === "number" ? (widget.id as number) | 0 : undefined;
    if (
        childParentUid !== undefined &&
        widgetUid !== undefined &&
        childParentUid !== widgetUid &&
        (widgetId === undefined || childParentUid !== widgetId)
    ) {
        return widget;
    }
    return child;
}

/**
 * Routes widget menu/click actions through CS2 handlers and server packets.
 */
export class WidgetActionRouter {
    constructor(private readonly deps: WidgetActionRouterDeps) {}

    handleWidgetAction(event: WidgetActionEvent): void {
        const widgetManager = this.deps.getWidgetManager();
        let w = resolveDynamicChildForAction(widgetManager, event.widget, event.slot);
        if (w !== event.widget) {
            event = { ...event, widget: w, slot: (w.childIndex ?? event.slot) as any };
        }
        const groupId = w?.groupId ?? w?.uid >>> 16;
        const childId =
            w?.fileId != null && w?.fileId >= 0
                ? w.fileId
                : typeof w?.childIndex === "number"
                  ? w.childIndex
                  : w?.uid & 0xffff;

        if (this.deps.getItemSpawnerUi().handleWidgetClick(groupId | 0, childId | 0)) {
            return;
        }

        if ((groupId | 0) === 679) {
            if (this.deps.getPlayerDesign().handleWidgetAction(childId | 0)) {
                return;
            }
        }

        if (handleTradeWidgetAction(this.deps, w, event, groupId | 0, childId | 0)) {
            return;
        }

        if (w) {
            const uid = typeof w.uid === "number" ? w.uid | 0 : undefined;
            const logGroupId = uid !== undefined ? (uid >>> 16) & 0xffff : (groupId as number);
            const logChildId = uid !== undefined ? uid & 0xffff : (childId as number);
            console.log("[widget-click]", {
                uid,
                groupId: logGroupId,
                childId: logChildId,
                fileId: typeof w.fileId === "number" ? w.fileId | 0 : undefined,
                childIndex: typeof w.childIndex === "number" ? w.childIndex | 0 : undefined,
                option: event.option,
                target: event.target,
                source: event.source,
                cursorX: event.cursorX,
                cursorY: event.cursorY,
                slot: typeof event.slot === "number" ? event.slot | 0 : undefined,
                itemId: typeof event.itemId === "number" ? event.itemId | 0 : undefined,
                type: typeof w.type === "number" ? w.type | 0 : undefined,
                contentType: typeof w.contentType === "number" ? w.contentType | 0 : undefined,
            });
        }

        const widgetInteraction = this.deps.getWidgetInteraction();
        if (event.source === "primary" && event.widget && widgetInteraction.isWidgetDraggable(event.widget)) {
            const isMouseDown = this.deps.getInputManager()?.isDragging?.() === true;
            if (isMouseDown) {
                widgetInteraction.deferredWidgetAction = event;
                return;
            }
        }

        if (event.widget) {
            if (handleWidgetActionTargeting(this.deps, event, groupId | 0, childId | 0)) {
                return;
            }
        }

        if (handleWidgetActionPauseButton(this.deps, event)) {
            return;
        }

        const skipCs2Handlers =
            event.source === "primary" &&
            widgetInteraction.clickedWidgetHandled &&
            event.widget?.uid === widgetInteraction.clickedWidget?.uid;
        const meslayerBeforeAction = widgetManager?.meslayerContinueWidget ?? null;

        const cs2Vm = this.deps.getCs2Vm();
        if (event.widget && !skipCs2Handlers && cs2Vm) {
            let handled = false;

            const opIndex =
                event.opIndex ?? inferWidgetOpId(event.widget, event.option) ?? 1;

            let relMouseX = event.cursorX ?? 0;
            let relMouseY = event.cursorY ?? 0;
            try {
                const wAny: any = event.widget as any;
                const wW = (wAny?.width ?? 0) | 0;
                const wH = (wAny?.height ?? 0) | 0;
                const looksRelative =
                    relMouseX >= 0 && relMouseY >= 0 && relMouseX <= wW && relMouseY <= wH;
                if (
                    !looksRelative &&
                    typeof wAny?._absX === "number" &&
                    typeof wAny?._absY === "number"
                ) {
                    relMouseX = (event.cursorX ?? 0) - (wAny._absX | 0);
                    relMouseY = (event.cursorY ?? 0) - (wAny._absY | 0);
                }
            } catch {}

            const eventContext: Partial<ScriptEvent> = {
                mouseX: relMouseX,
                mouseY: relMouseY,
                opIndex,
                opSubIndex: event.opSubIndex ?? 0,
                targetName: event.target ?? "",
            };

            if (event.widget.eventHandlers) {
                const eventType = event.source === "menu" ? "onOp" : "onClick";
                handled = cs2Vm.invokeEventHandler(
                    event.widget,
                    eventType as any,
                    eventContext,
                );

                if (!handled && event.source === "primary" && event.widget.eventHandlers.onOp) {
                    handled = cs2Vm.invokeEventHandler(
                        event.widget,
                        "onOp" as any,
                        eventContext,
                    );
                }
            }

            if (!handled) {
                let handler: any[] | undefined;
                if (event.source === "menu" && event.widget.onOp) {
                    handler = event.widget.onOp;
                } else if (event.widget.onClick) {
                    handler = event.widget.onClick;
                } else if (event.source === "primary" && event.widget.onOp) {
                    handler = event.widget.onOp;
                }

                if (handler) {
                    this.deps.executeScriptListener(event.widget, handler, eventContext);
                }
            }
        }

        const resumePauseTriggeredByHandler =
            meslayerBeforeAction === null &&
            (widgetManager?.meslayerContinueWidget ?? null) !== null;
        if (resumePauseTriggeredByHandler) {
            return;
        }

        const optionLower = event.option?.toLowerCase() ?? "";
        const isQuantityDialog = optionLower === "withdraw-x" || optionLower === "deposit-x";
        const widgetGroupId = event.widget?.groupId ?? event.widget?.uid >>> 16;
        const isBankInterface = widgetGroupId === 12 || widgetGroupId === 15;

        if (isQuantityDialog && isBankInterface) {
            const payload = buildWidgetActionPayload(widgetManager, event);
            if (payload) {
                this.deps.setPendingInputDialogAction({
                    payload,
                    option: optionLower,
                });
                const scriptEvent = createScriptEvent({
                    args: [2251],
                    widget: event.widget,
                });
                console.log(`[handleWidgetAction] Invoking chatbox_open_input for ${optionLower}`);
                const result = cs2Vm?.runScriptEvent(scriptEvent);
                console.log(`[handleWidgetAction] Script execution result: ${result}`);

                if (cs2Vm) {
                    cs2Vm.inputDialogType = 0;
                    cs2Vm.inputDialogString = "";
                }
                this.deps.getVarManager()?.setVarcString(335, "");
                console.log(
                    `[handleWidgetAction] inputDialogType set to: ${cs2Vm?.inputDialogType}`,
                );
            }
            return;
        }

        try {
            const payload = buildWidgetActionPayload(widgetManager, event);
            if (!payload) return;

            const widget = event.widget;
            if (widget) {
                const transmitFlagWidget = resolveTransmitFlagWidget(
                    widgetManager,
                    widget,
                    payload,
                );
                const flags =
                    widgetManager?.getWidgetFlags?.(transmitFlagWidget) ??
                    transmitFlagWidget?.flags ??
                    0;
                const opId = payload.opId ?? 0;
                const actionIndex = opId > 0 ? opId - 1 : -1;

                if (actionIndex >= 0 && actionIndex <= 9) {
                    if (!shouldTransmitAction(flags, actionIndex)) {
                        const wId = (widget as any).id ?? widget.uid;
                        const wChildIndex = (widget as any).childIndex ?? -1;
                        const wGroupId = (wId >> 16) & 0xffff;
                        const wChildId = wId & 0xffff;
                        console.log(
                            `[OsrsClient] Widget action ${event.option} (op${opId}) not transmitted - transmit flag not set. ` +
                                `Widget: uid=${widget.uid}, id=${wId} (group=${wGroupId}, child=${wChildId}), childIndex=${wChildIndex}, flags=${flags}`,
                        );
                        return;
                    }
                }
            }

            sendWidgetAction(payload);
        } catch (err) {
            console.warn("[OsrsClient] widget action dispatch failed", err);
        }
    }

    buildWidgetActionPayload(event: WidgetActionEvent): WidgetActionClientPayload | undefined {
        return buildWidgetActionPayload(this.deps.getWidgetManager(), event);
    }

    resolveTransmitFlagWidget(eventWidget: any, payload: WidgetActionClientPayload): any {
        return resolveTransmitFlagWidget(this.deps.getWidgetManager(), eventWidget, payload);
    }

    inferWidgetOpId(widget: any, option?: string): number | undefined {
        return inferWidgetOpId(widget, option);
    }

    handleTradeWidgetAction(
        widget: any,
        event: { option?: string; slot?: number; itemId?: number },
        groupId: number,
        childId: number,
    ): boolean {
        return handleTradeWidgetAction(this.deps, widget, event, groupId, childId);
    }
}

export type { SelectedSpellInfo, SpellSelectionState };
