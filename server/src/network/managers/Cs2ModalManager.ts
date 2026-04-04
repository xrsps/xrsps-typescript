import {
    INDEXED_MENU_GROUP_ID,
    INDEXED_MENU_LIST_COMPONENT_ID,
    INDEXED_MENU_LIST_UID,
    INDEXED_MENU_PAUSE_BUTTON_FLAGS,
    INDEXED_MENU_SCRIPT_ID,
} from "../../../../src/shared/ui/indexedMenu";
import {
    SMITHING_BAR_MODAL_COMPONENT_ADAMANT,
    SMITHING_BAR_MODAL_COMPONENT_ADAMANT_ICON,
    SMITHING_BAR_MODAL_COMPONENT_ADAMANT_TEXT,
    SMITHING_BAR_MODAL_COMPONENT_BODY,
    SMITHING_BAR_MODAL_COMPONENT_BRONZE,
    SMITHING_BAR_MODAL_COMPONENT_BRONZE_ICON,
    SMITHING_BAR_MODAL_COMPONENT_BRONZE_TEXT,
    SMITHING_BAR_MODAL_COMPONENT_CLOSE,
    SMITHING_BAR_MODAL_COMPONENT_FRAME,
    SMITHING_BAR_MODAL_COMPONENT_IRON,
    SMITHING_BAR_MODAL_COMPONENT_IRON_ICON,
    SMITHING_BAR_MODAL_COMPONENT_IRON_TEXT,
    SMITHING_BAR_MODAL_COMPONENT_LOVAKITE,
    SMITHING_BAR_MODAL_COMPONENT_LOVAKITE_ICON,
    SMITHING_BAR_MODAL_COMPONENT_LOVAKITE_TEXT,
    SMITHING_BAR_MODAL_COMPONENT_MITHRIL,
    SMITHING_BAR_MODAL_COMPONENT_MITHRIL_ICON,
    SMITHING_BAR_MODAL_COMPONENT_MITHRIL_TEXT,
    SMITHING_BAR_MODAL_COMPONENT_RUNE,
    SMITHING_BAR_MODAL_COMPONENT_RUNE_ICON,
    SMITHING_BAR_MODAL_COMPONENT_RUNE_TEXT,
    SMITHING_BAR_MODAL_COMPONENT_STEEL,
    SMITHING_BAR_MODAL_COMPONENT_STEEL_ICON,
    SMITHING_BAR_MODAL_COMPONENT_STEEL_TEXT,
    SMITHING_BAR_MODAL_COMPONENT_TITLE,
    SMITHING_BAR_MODAL_GROUP_ID,
} from "../../../../src/shared/ui/widgets";
import { FONT_BOLD_12 } from "../../../../src/ui/fonts";
import type { PlayerState } from "../../game/player";

type SmithingBarOption = {
    barType: number;
    buttonComponentId: number;
    iconComponentId: number;
    textComponentId: number;
    label: string;
};

export type IndexedMenuRequest = {
    title: string;
    options: string[];
    closeOnSelect?: boolean;
    onSelect?: (player: PlayerState, optionIndex: number, optionLabel: string) => void;
};

type IndexedMenuState = {
    title: string;
    options: string[];
    closeOnSelect: boolean;
    onSelect?: (player: PlayerState, optionIndex: number, optionLabel: string) => void;
};

export interface Cs2ModalManagerServices {
    openModal: (player: PlayerState, interfaceId: number, data?: unknown) => void;
    closeModal: (player: PlayerState) => void;
    getCurrentModal: (player: PlayerState) => number | undefined;
    queueWidgetEvent: (playerId: number, event: any) => void;
    queueGameMessage: (playerId: number, text: string) => void;
    setSmithingBarType: (player: PlayerState, barType: number) => void;
    openSmithingForgeInterface: (player: PlayerState) => void;
}

const SCRIPT_STEELBORDER_NOCLOSE = 3737;
const SCRIPT_STONEBUTTON_INIT = 2424;

const STONEBUTTON_STYLE_OUTLINE = 0;
const SMITHING_BAR_OPTIONS: readonly SmithingBarOption[] = [
    {
        barType: 1,
        buttonComponentId: SMITHING_BAR_MODAL_COMPONENT_BRONZE,
        iconComponentId: SMITHING_BAR_MODAL_COMPONENT_BRONZE_ICON,
        textComponentId: SMITHING_BAR_MODAL_COMPONENT_BRONZE_TEXT,
        label: "Bronze",
    },
    {
        barType: 2,
        buttonComponentId: SMITHING_BAR_MODAL_COMPONENT_IRON,
        iconComponentId: SMITHING_BAR_MODAL_COMPONENT_IRON_ICON,
        textComponentId: SMITHING_BAR_MODAL_COMPONENT_IRON_TEXT,
        label: "Iron",
    },
    {
        barType: 3,
        buttonComponentId: SMITHING_BAR_MODAL_COMPONENT_STEEL,
        iconComponentId: SMITHING_BAR_MODAL_COMPONENT_STEEL_ICON,
        textComponentId: SMITHING_BAR_MODAL_COMPONENT_STEEL_TEXT,
        label: "Steel",
    },
    {
        barType: 4,
        buttonComponentId: SMITHING_BAR_MODAL_COMPONENT_MITHRIL,
        iconComponentId: SMITHING_BAR_MODAL_COMPONENT_MITHRIL_ICON,
        textComponentId: SMITHING_BAR_MODAL_COMPONENT_MITHRIL_TEXT,
        label: "Mithril",
    },
    {
        barType: 5,
        buttonComponentId: SMITHING_BAR_MODAL_COMPONENT_ADAMANT,
        iconComponentId: SMITHING_BAR_MODAL_COMPONENT_ADAMANT_ICON,
        textComponentId: SMITHING_BAR_MODAL_COMPONENT_ADAMANT_TEXT,
        label: "Adamant",
    },
    {
        barType: 6,
        buttonComponentId: SMITHING_BAR_MODAL_COMPONENT_RUNE,
        iconComponentId: SMITHING_BAR_MODAL_COMPONENT_RUNE_ICON,
        textComponentId: SMITHING_BAR_MODAL_COMPONENT_RUNE_TEXT,
        label: "Rune",
    },
    {
        barType: 7,
        buttonComponentId: SMITHING_BAR_MODAL_COMPONENT_LOVAKITE,
        iconComponentId: SMITHING_BAR_MODAL_COMPONENT_LOVAKITE_ICON,
        textComponentId: SMITHING_BAR_MODAL_COMPONENT_LOVAKITE_TEXT,
        label: "Lovakite",
    },
] as const;

/**
 * Reusable manager for custom CS2-driven modals mounted in mainmodal.
 */
export class Cs2ModalManager {
    private readonly activeSmithingBarModalPlayers = new Set<number>();
    private readonly activeIndexedMenus = new Map<number, IndexedMenuState>();

    constructor(private readonly services: Cs2ModalManagerServices) {}

    openSmithingBarModal(player: PlayerState): void {
        const playerId = player.id;
        this.activeSmithingBarModalPlayers.add(playerId);
        this.services.openModal(player, SMITHING_BAR_MODAL_GROUP_ID);
        this.applySmithingBarModalLayout(player);
    }

    openIndexedMenu(player: PlayerState, request: IndexedMenuRequest): void {
        const title = String(request.title ?? "").trim();
        const options = request.options
            .map((option) => String(option ?? "").trim())
            .filter((option) => option.length > 0);
        if (title.length === 0 || options.length === 0) {
            return;
        }

        const state: IndexedMenuState = {
            title,
            options,
            closeOnSelect: request.closeOnSelect !== false,
            onSelect: request.onSelect,
        };
        this.activeIndexedMenus.set(player.id, state);
        this.services.openModal(player, INDEXED_MENU_GROUP_ID);
        this.redrawIndexedMenu(player, state);
    }

    handleResumePauseButton(player: PlayerState, widgetId: number, childIndex: number): boolean {
        const state = this.activeIndexedMenus.get(player.id);
        if (!state) {
            return false;
        }

        const currentModal = this.services.getCurrentModal(player);
        if (currentModal !== INDEXED_MENU_GROUP_ID) {
            this.activeIndexedMenus.delete(player.id);
            return false;
        }

        const widgetGroup = (widgetId >>> 16) & 0xffff;
        const widgetComponent = widgetId & 0xffff;
        if (widgetGroup !== INDEXED_MENU_GROUP_ID) {
            return false;
        }
        if (widgetComponent !== INDEXED_MENU_LIST_COMPONENT_ID) {
            return false;
        }
        if (childIndex < 0 || childIndex >= state.options.length) {
            return false;
        }

        const optionIndex = childIndex | 0;
        const optionLabel = state.options[optionIndex] ?? "";
        if (state.closeOnSelect) {
            this.closeIndexedMenu(player);
        }
        state.onSelect?.(player, optionIndex, optionLabel);
        return true;
    }

    handleWidgetAction(
        player: PlayerState,
        groupId: number,
        componentId: number,
        option?: string,
        itemId?: number,
    ): boolean {
        const normalizedGroupId = groupId;
        if (normalizedGroupId === SMITHING_BAR_MODAL_GROUP_ID) {
            return this.handleSmithingBarModalAction(player, componentId, option);
        }
        const playerId = player.id;
        const currentModal = this.services.getCurrentModal(player);
        if (currentModal !== SMITHING_BAR_MODAL_GROUP_ID) {
            this.activeSmithingBarModalPlayers.delete(playerId);
        }
        if (currentModal !== INDEXED_MENU_GROUP_ID) {
            this.activeIndexedMenus.delete(playerId);
        }
        return false;
    }

    handleWidgetCloseState(player: PlayerState, groupId: number): void {
        if (groupId === SMITHING_BAR_MODAL_GROUP_ID) {
            this.activeSmithingBarModalPlayers.delete(player.id);
            return;
        }
        if (groupId === INDEXED_MENU_GROUP_ID) {
            this.activeIndexedMenus.delete(player.id);
        }
    }

    clearPlayerState(player: PlayerState): void {
        const playerId = player.id;
        this.activeSmithingBarModalPlayers.delete(playerId);
        this.activeIndexedMenus.delete(playerId);
    }

    private closeIndexedMenu(player: PlayerState): void {
        this.activeIndexedMenus.delete(player.id);
        if (this.services.getCurrentModal(player) === INDEXED_MENU_GROUP_ID) {
            this.services.closeModal(player);
        }
    }

    private redrawIndexedMenu(player: PlayerState, state: IndexedMenuState): void {
        this.services.queueWidgetEvent(player.id, {
            action: "run_script",
            scriptId: INDEXED_MENU_SCRIPT_ID,
            args: [state.title, state.options.join("|")],
        });
        this.services.queueWidgetEvent(player.id, {
            action: "set_flags_range",
            uid: INDEXED_MENU_LIST_UID,
            fromSlot: 0,
            toSlot: state.options.length - 1,
            flags: INDEXED_MENU_PAUSE_BUTTON_FLAGS,
        });
    }

    private handleSmithingBarModalAction(
        player: PlayerState,
        componentId: number,
        option?: string,
    ): boolean {
        const playerId = player.id;
        if (!this.activeSmithingBarModalPlayers.has(playerId)) {
            return false;
        }

        const component = componentId;
        if (component === SMITHING_BAR_MODAL_COMPONENT_CLOSE || option === "Close") {
            this.closeSmithingBarModal(player);
            return true;
        }

        const selected = SMITHING_BAR_OPTIONS.find(
            (entry) =>
                entry.buttonComponentId === component ||
                entry.iconComponentId === component ||
                entry.textComponentId === component,
        );
        if (!selected) {
            return false;
        }

        this.services.setSmithingBarType(player, selected.barType);
        this.activeSmithingBarModalPlayers.delete(playerId);
        this.services.closeModal(player);
        this.services.openSmithingForgeInterface(player);
        return true;
    }

    private applySmithingBarModalLayout(player: PlayerState): void {
        const playerId = player.id;
        this.runScript(playerId, SCRIPT_STEELBORDER_NOCLOSE, [
            this.getWidgetUidInGroup(
                SMITHING_BAR_MODAL_GROUP_ID,
                SMITHING_BAR_MODAL_COMPONENT_FRAME,
            ),
            "Select Bar",
        ]);
        this.drawStoneButtonInGroup(
            playerId,
            SMITHING_BAR_MODAL_GROUP_ID,
            SMITHING_BAR_MODAL_COMPONENT_CLOSE,
            "Close",
        );
        this.setWidgetTextInGroup(
            playerId,
            SMITHING_BAR_MODAL_GROUP_ID,
            SMITHING_BAR_MODAL_COMPONENT_TITLE,
            "<col=ffcf70>Select your smithing bar</col>",
        );
        this.setWidgetTextInGroup(
            playerId,
            SMITHING_BAR_MODAL_GROUP_ID,
            SMITHING_BAR_MODAL_COMPONENT_BODY,
            "Choose a metal type, then the anvil list updates to that bar.",
        );
    }

    private closeSmithingBarModal(player: PlayerState): void {
        const playerId = player.id;
        this.activeSmithingBarModalPlayers.delete(playerId);
        this.services.closeModal(player);
    }

    private drawStoneButtonInGroup(
        playerId: number,
        groupId: number,
        componentId: number,
        label: string,
    ): void {
        this.runScript(playerId, SCRIPT_STONEBUTTON_INIT, [
            this.getWidgetUidInGroup(groupId, componentId),
            FONT_BOLD_12,
            STONEBUTTON_STYLE_OUTLINE,
            label,
        ]);
    }

    private runScript(playerId: number, scriptId: number, args: Array<number | string>): void {
        this.services.queueWidgetEvent(playerId, {
            action: "run_script",
            scriptId: scriptId,
            args,
        });
    }

    private setWidgetTextInGroup(
        playerId: number,
        groupId: number,
        componentId: number,
        text: string,
    ): void {
        this.services.queueWidgetEvent(playerId, {
            action: "set_text",
            uid: this.getWidgetUidInGroup(groupId, componentId),
            text: String(text ?? ""),
        });
    }

    private getWidgetUidInGroup(groupId: number, componentId: number): number {
        return ((groupId & 0xffff) << 16) | (componentId & 0xffff);
    }
}
