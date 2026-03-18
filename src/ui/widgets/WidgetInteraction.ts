import type { WidgetNode } from "./WidgetNode";

export function markWidgetInteractionDirty(widget: WidgetNode | null | undefined): void {
    if (!widget) return;
    const anyWidget = widget as any;
    anyWidget.__interactionRevision = (((anyWidget.__interactionRevision ?? 0) as number) | 0) + 1;
    anyWidget.__interactionSnapshot = undefined;
}
