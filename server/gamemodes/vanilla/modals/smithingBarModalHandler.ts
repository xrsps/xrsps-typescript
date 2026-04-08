import {
    SMITHING_BAR_MODAL_COMPONENT_BODY,
    SMITHING_BAR_MODAL_COMPONENT_BRONZE,
    SMITHING_BAR_MODAL_COMPONENT_BRONZE_ICON,
    SMITHING_BAR_MODAL_COMPONENT_BRONZE_TEXT,
    SMITHING_BAR_MODAL_COMPONENT_CLOSE,
    SMITHING_BAR_MODAL_COMPONENT_FRAME,
    SMITHING_BAR_MODAL_COMPONENT_IRON,
    SMITHING_BAR_MODAL_COMPONENT_IRON_ICON,
    SMITHING_BAR_MODAL_COMPONENT_IRON_TEXT,
    SMITHING_BAR_MODAL_COMPONENT_STEEL,
    SMITHING_BAR_MODAL_COMPONENT_STEEL_ICON,
    SMITHING_BAR_MODAL_COMPONENT_STEEL_TEXT,
    SMITHING_BAR_MODAL_COMPONENT_MITHRIL,
    SMITHING_BAR_MODAL_COMPONENT_MITHRIL_ICON,
    SMITHING_BAR_MODAL_COMPONENT_MITHRIL_TEXT,
    SMITHING_BAR_MODAL_COMPONENT_ADAMANT,
    SMITHING_BAR_MODAL_COMPONENT_ADAMANT_ICON,
    SMITHING_BAR_MODAL_COMPONENT_ADAMANT_TEXT,
    SMITHING_BAR_MODAL_COMPONENT_RUNE,
    SMITHING_BAR_MODAL_COMPONENT_RUNE_ICON,
    SMITHING_BAR_MODAL_COMPONENT_RUNE_TEXT,
    SMITHING_BAR_MODAL_COMPONENT_LOVAKITE,
    SMITHING_BAR_MODAL_COMPONENT_LOVAKITE_ICON,
    SMITHING_BAR_MODAL_COMPONENT_LOVAKITE_TEXT,
    SMITHING_BAR_MODAL_COMPONENT_TITLE,
    SMITHING_BAR_MODAL_GROUP_ID,
} from "../../../../src/shared/ui/widgets";
import { FONT_BOLD_12 } from "../../../../src/ui/fonts";
import type { ScriptServices } from "../../../src/game/scripts/types";
import type { PlayerState } from "../../../src/game/player";

const SMITHING_BAR_TYPE_VARBIT_ID = 3216;

type SmithingBarOption = {
    barType: number;
    buttonComponentId: number;
    iconComponentId: number;
    textComponentId: number;
};

const SMITHING_BAR_OPTIONS: readonly SmithingBarOption[] = [
    { barType: 1, buttonComponentId: SMITHING_BAR_MODAL_COMPONENT_BRONZE, iconComponentId: SMITHING_BAR_MODAL_COMPONENT_BRONZE_ICON, textComponentId: SMITHING_BAR_MODAL_COMPONENT_BRONZE_TEXT },
    { barType: 2, buttonComponentId: SMITHING_BAR_MODAL_COMPONENT_IRON, iconComponentId: SMITHING_BAR_MODAL_COMPONENT_IRON_ICON, textComponentId: SMITHING_BAR_MODAL_COMPONENT_IRON_TEXT },
    { barType: 3, buttonComponentId: SMITHING_BAR_MODAL_COMPONENT_STEEL, iconComponentId: SMITHING_BAR_MODAL_COMPONENT_STEEL_ICON, textComponentId: SMITHING_BAR_MODAL_COMPONENT_STEEL_TEXT },
    { barType: 4, buttonComponentId: SMITHING_BAR_MODAL_COMPONENT_MITHRIL, iconComponentId: SMITHING_BAR_MODAL_COMPONENT_MITHRIL_ICON, textComponentId: SMITHING_BAR_MODAL_COMPONENT_MITHRIL_TEXT },
    { barType: 5, buttonComponentId: SMITHING_BAR_MODAL_COMPONENT_ADAMANT, iconComponentId: SMITHING_BAR_MODAL_COMPONENT_ADAMANT_ICON, textComponentId: SMITHING_BAR_MODAL_COMPONENT_ADAMANT_TEXT },
    { barType: 6, buttonComponentId: SMITHING_BAR_MODAL_COMPONENT_RUNE, iconComponentId: SMITHING_BAR_MODAL_COMPONENT_RUNE_ICON, textComponentId: SMITHING_BAR_MODAL_COMPONENT_RUNE_TEXT },
    { barType: 7, buttonComponentId: SMITHING_BAR_MODAL_COMPONENT_LOVAKITE, iconComponentId: SMITHING_BAR_MODAL_COMPONENT_LOVAKITE_ICON, textComponentId: SMITHING_BAR_MODAL_COMPONENT_LOVAKITE_TEXT },
];

export function registerSmithingBarModalHandler(
    services: ScriptServices,
    deps: {
        closeModal: (player: PlayerState) => void;
    },
): void {
    const handlers = services.modalActionHandlers ?? new Map();

    handlers.set(SMITHING_BAR_MODAL_GROUP_ID, (player: PlayerState, componentId: number, option?: string) => {
        if (componentId === SMITHING_BAR_MODAL_COMPONENT_CLOSE || option === "Close") {
            deps.closeModal(player);
            return true;
        }

        const selected = SMITHING_BAR_OPTIONS.find(
            (entry) =>
                entry.buttonComponentId === componentId ||
                entry.iconComponentId === componentId ||
                entry.textComponentId === componentId,
        );
        if (!selected) {
            return false;
        }

        player.varps.setVarbitValue(SMITHING_BAR_TYPE_VARBIT_ID, selected.barType);
        deps.closeModal(player);
        services.production?.openForgeInterface?.(player);
        return true;
    });

    services.modalActionHandlers = handlers;
}

const SCRIPT_STEELBORDER_NOCLOSE = 3737;
const SCRIPT_STONEBUTTON_INIT = 2424;
const STONEBUTTON_STYLE_OUTLINE = 0;

function packUid(groupId: number, componentId: number): number {
    return ((groupId & 0xffff) << 16) | (componentId & 0xffff);
}

export function openSmithingBarModal(player: PlayerState, services: ScriptServices): void {
    services.production?.openSmithingModal?.(player, SMITHING_BAR_MODAL_GROUP_ID);
    const pid = player.id;
    services.dialog.queueWidgetEvent(pid, {
        action: "run_script",
        scriptId: SCRIPT_STEELBORDER_NOCLOSE,
        args: [packUid(SMITHING_BAR_MODAL_GROUP_ID, SMITHING_BAR_MODAL_COMPONENT_FRAME), "Select Bar"],
    });
    services.dialog.queueWidgetEvent(pid, {
        action: "run_script",
        scriptId: SCRIPT_STONEBUTTON_INIT,
        args: [packUid(SMITHING_BAR_MODAL_GROUP_ID, SMITHING_BAR_MODAL_COMPONENT_CLOSE), FONT_BOLD_12, STONEBUTTON_STYLE_OUTLINE, "Close"],
    });
    services.dialog.queueWidgetEvent(pid, {
        action: "set_text",
        uid: packUid(SMITHING_BAR_MODAL_GROUP_ID, SMITHING_BAR_MODAL_COMPONENT_TITLE),
        text: "<col=ffcf70>Select your smithing bar</col>",
    });
    services.dialog.queueWidgetEvent(pid, {
        action: "set_text",
        uid: packUid(SMITHING_BAR_MODAL_GROUP_ID, SMITHING_BAR_MODAL_COMPONENT_BODY),
        text: "Choose a metal type, then the anvil list updates to that bar.",
    });
}
