import {
    INDEXED_MENU_GROUP_ID,
    INDEXED_MENU_LIST_COMPONENT_ID,
    INDEXED_MENU_LIST_UID,
    INDEXED_MENU_PAUSE_BUTTON_FLAGS,
    INDEXED_MENU_SCRIPT_ID,
} from "../../../../src/shared/ui/indexedMenu";
import type { ServerServices } from "../../game/ServerServices";
import type { PlayerState } from "../../game/player";

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


/**
 * Reusable manager for custom CS2-driven modals mounted in mainmodal.
 */
export class Cs2ModalManager {
    private readonly activeIndexedMenus = new Map<number, IndexedMenuState>();

    constructor(private readonly svc: ServerServices) {}

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
        this.svc.interfaceService?.openModal(player, INDEXED_MENU_GROUP_ID);
        this.redrawIndexedMenu(player, state);
    }

    handleResumePauseButton(player: PlayerState, widgetId: number, childIndex: number): boolean {
        const state = this.activeIndexedMenus.get(player.id);
        if (!state) {
            return false;
        }

        const currentModal = this.svc.interfaceService?.getCurrentModal(player);
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
        const handler = this.svc.scriptRuntime.getServices().modalActionHandlers?.get(groupId);
        if (handler) {
            return handler(player, componentId, option);
        }
        const playerId = player.id;
        const currentModal = this.svc.interfaceService?.getCurrentModal(player);
        if (currentModal !== INDEXED_MENU_GROUP_ID) {
            this.activeIndexedMenus.delete(playerId);
        }
        return false;
    }

    handleWidgetCloseState(player: PlayerState, groupId: number): void {
        if (groupId === INDEXED_MENU_GROUP_ID) {
            this.activeIndexedMenus.delete(player.id);
        }
    }

    clearPlayerState(player: PlayerState): void {
        const playerId = player.id;
        this.activeIndexedMenus.delete(playerId);
    }

    private closeIndexedMenu(player: PlayerState): void {
        this.activeIndexedMenus.delete(player.id);
        if (this.svc.interfaceService?.getCurrentModal(player) === INDEXED_MENU_GROUP_ID) {
            this.svc.interfaceService?.closeModal(player);
        }
    }

    private redrawIndexedMenu(player: PlayerState, state: IndexedMenuState): void {
        this.svc.queueWidgetEvent(player.id, {
            action: "run_script",
            scriptId: INDEXED_MENU_SCRIPT_ID,
            args: [state.title, state.options.join("|")],
        });
        this.svc.queueWidgetEvent(player.id, {
            action: "set_flags_range",
            uid: INDEXED_MENU_LIST_UID,
            fromSlot: 0,
            toSlot: state.options.length - 1,
            flags: INDEXED_MENU_PAUSE_BUTTON_FLAGS,
        });
    }

}
