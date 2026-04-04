import { getDynamicWidgetGroup } from "../../../shared/gamemode/GamemodeContentStore";
import { SMITHING_BAR_MODAL_GROUP_ID } from "../../../shared/ui/widgets";
import type { WidgetNode } from "../WidgetNode";
import { buildSmithingBarModalGroup } from "./smithing.cs2";

type WidgetGroupLoadResult = { root: WidgetNode | undefined; widgets: Map<number, WidgetNode> };

export function loadCustomWidgetGroup(groupId: number): WidgetGroupLoadResult | undefined {
    if ((groupId | 0) === SMITHING_BAR_MODAL_GROUP_ID) {
        return buildSmithingBarModalGroup();
    }
    // Check dynamically loaded widgets (from GAMEMODE_DATA)
    const dynamic = getDynamicWidgetGroup(groupId);
    if (dynamic) {
        return dynamic as WidgetGroupLoadResult;
    }
    return undefined;
}
