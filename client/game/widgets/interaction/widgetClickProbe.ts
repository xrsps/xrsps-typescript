import { sendPlayerOption } from "../../../network/ServerConnection";
import { ClickRegistry } from "../../../widgets/gl/click-registry";
import type { WidgetManager } from "../../../widgets/WidgetManager";
import {
    collectWidgetsAtPointAcrossRoots,
    findBlockingWidgetInHits,
} from "../../../widgets/menu/utils";

export function getUiClickRegistry(rendererCanvas: unknown): ClickRegistry | null {
    const clicks = (rendererCanvas as any)?.__clicks;
    return clicks && typeof clicks.pick === "function" ? (clicks as ClickRegistry) : null;
}

export function isPointerOverMinimapClickTarget(
    rendererCanvas: unknown,
    screenX: number,
    screenY: number,
): boolean {
    const clicks = getUiClickRegistry(rendererCanvas);
    if (!clicks) return false;
    const canvasAny: any = rendererCanvas;
    const scaleXRaw = Number(canvasAny?.__uiInputScaleX ?? 1);
    const scaleYRaw = Number(canvasAny?.__uiInputScaleY ?? 1);
    const scaleX = Number.isFinite(scaleXRaw) && scaleXRaw > 0 ? scaleXRaw : 1;
    const scaleY = Number.isFinite(scaleYRaw) && scaleYRaw > 0 ? scaleYRaw : 1;
    const hit = clicks.pick(Math.round(screenX * scaleX), Math.round(screenY * scaleY));
    return hit?.id === "minimap:click-to-walk";
}

export function getWorldClickBlockingWidgetAtPoint(
    widgetManager: WidgetManager | undefined,
    clickedWidget: any,
    px: number,
    py: number,
): any | null {
    if (clickedWidget !== null) {
        return clickedWidget;
    }

    if (!widgetManager || widgetManager.rootInterface === -1) {
        return null;
    }

    const allRoots = widgetManager.getAllGroupRoots(widgetManager.rootInterface);
    if (allRoots.length === 0) {
        return null;
    }

    const visibleMap = new Map<number, boolean>();
    const getStaticChildren = (uid: number) => widgetManager.getStaticChildrenByParentUid(uid);
    const getInterfaceParentRoots = (containerUid: number): any[] => {
        const group = widgetManager.interfaceParents.get(containerUid)?.group;
        return typeof group === "number" ? widgetManager.getAllGroupRoots(group) : [];
    };
    const isInputCaptureWidget = (uid: number): boolean => {
        const parent = widgetManager.interfaceParents.get(uid);
        return !!parent && (parent.type | 0) === 0;
    };

    const hits = collectWidgetsAtPointAcrossRoots(
        allRoots,
        px,
        py,
        visibleMap,
        getStaticChildren,
        getInterfaceParentRoots,
        isInputCaptureWidget,
    );
    return findBlockingWidgetInHits(hits, {
        isInputCaptureWidget,
        getWidgetFlags: (widget) => widgetManager?.getWidgetFlags(widget) ?? 0,
        getWidgetByUid: (uid) => widgetManager?.getWidgetByUid(uid),
    });
}

/**
 * Cache chatbox scripts render request lines as ordinary text widgets, so
 * they do not expose a React-style row onClick. Consume a click on the
 * rendered type-101 line here and send the native Trade player option.
 */
export function handleTradeRequestChatClick(
    widgets: readonly any[],
    tradeRequestTargetsByName: ReadonlyMap<string, number>,
): boolean {
    for (let i = widgets.length - 1; i >= 0; i--) {
        const text = String(widgets[i]?.text ?? "")
            .replace(/<[^>]*>/g, "")
            .trim()
            .toLowerCase();
        if (!text.includes("wishes to trade with you.")) continue;

        for (const [name, playerId] of tradeRequestTargetsByName) {
            if (!text.includes(name)) continue;
            sendPlayerOption(playerId, 2);
            return true;
        }
    }
    return false;
}
