import {
    VARBIT_LEVEL_UP_POPUP_NOTIFICATIONS,
    VARBIT_MUSIC_UNLOCK_TEXT_TOGGLE,
    VARP_OPTION_ATTACK_PRIORITY_NPC,
    VARP_OPTION_ATTACK_PRIORITY_PLAYER,
} from "../../../../../src/shared/vars";
import { getMainmodalUid } from "../../../widgets/viewport";
import type { ScriptModule, WidgetActionEvent } from "../types";

/**
 * Settings widget handlers - handles button clicks on the settings tab (widget 116)
 * and the settings modal (widget 134)
 *
 * OSRS Parity: When the "All Settings" button is clicked, the server sends IF_OPENSUB
 * to open the full settings modal (widget 134) in the mainmodal container.
 * When the close button is clicked, the server sends IF_CLOSESUB to close it.
 */

const SETTINGS_SIDE_GROUP_ID = 116;
const SETTINGS_MODAL_GROUP_ID = 134;
const ALL_SETTINGS_BUTTON_CHILD_ID = 32;
const MUSIC_UNLOCK_MESSAGE_TOGGLE_CHILD_ID = 127;

// Settings side dropdown IDs (see proc settings_get_dropdown / settings_side_dropdown_create)
const SETTINGS_DROPDOWN_PLAYER_ATTACK_OPTIONS = 55;
const SETTINGS_DROPDOWN_NPC_ATTACK_OPTIONS = 56;
const SETTINGS_DROPDOWN_LEVEL_UP_POPUP_NOTIFICATIONS = 315;

// Widget UIDs for attack option dropdown rows in group 116 (rev 235 cache)
const SETTINGS_SIDE_ATTACK_PRIORITY_PLAYER_ROW_UID = (SETTINGS_SIDE_GROUP_ID << 16) | 6;
const SETTINGS_SIDE_ATTACK_PRIORITY_NPC_ROW_UID = (SETTINGS_SIDE_GROUP_ID << 16) | 7;

// Dropdown list container widget UIDs in group 116 used by settings_side_dropdown_open (rev 235 cache)
// (These are the containers that receive the dynamic CC_CREATE option children + OP1="Select")
const SETTINGS_SIDE_DROPDOWN_LIST_UIDS = new Set<number>([
    (SETTINGS_SIDE_GROUP_ID << 16) | 38,
    (SETTINGS_SIDE_GROUP_ID << 16) | 39,
    (SETTINGS_SIDE_GROUP_ID << 16) | 40,
    (SETTINGS_SIDE_GROUP_ID << 16) | 41,
]);
const SETTINGS_MODAL_DROPDOWN_LIST_UIDS = new Set<number>([
    (SETTINGS_MODAL_GROUP_ID << 16) | 29,
    (SETTINGS_MODAL_GROUP_ID << 16) | 30,
]);

const MAX_PLAYER_ATTACK_OPTION = 4;
const MAX_NPC_ATTACK_OPTION = 3;
const LEVEL_UP_POPUP_OPTIONS = new Map<string, number>([
    ["disabled", 0],
    ["show level only", 1],
    ["show level & unlocks", 2],
]);

function normalizeDropdownLabel(value: string | undefined): string {
    return (value ?? "").trim().toLowerCase();
}

export const settingsWidgetsModule: ScriptModule = {
    id: "content.settings-widgets",
    register(registry, services) {
        // Track the last opened settings-side dropdown for this player.
        // The option list is rendered via shared dropdown list widgets, so the selection click alone
        // doesn't identify which setting row initiated it.
        const activeSideDropdownSettingByPlayerId = new Map<number, number>();
        const activeModalDropdownSettingByPlayerId = new Map<number, number>();

        // Handle "All Settings" button click in settings_side (widget 116)
        // Opens the settings modal (134) in the mainmodal container
        registry.registerWidgetAction({
            handler: ({ player, groupId, childId, services: svc }) => {
                // Only handle clicks on the "All Settings" button (child 32) in settings_side widget
                if (groupId !== SETTINGS_SIDE_GROUP_ID) return;
                if (childId !== ALL_SETTINGS_BUTTON_CHILD_ID) return;

                // Open the settings modal (134) in the mainmodal container
                // Use display-mode-aware helper to get correct mount target for mobile vs desktop
                const mainmodalUid = getMainmodalUid(player.displayMode);

                svc.openSubInterface?.(player, mainmodalUid, SETTINGS_MODAL_GROUP_ID, 0);

                svc.logger?.info?.(
                    `[settings-widgets] Opened settings modal for player=${player.id}`,
                );
            },
        });

        // Handle "Toggle unlock message" checkbox click in settings_side (widget 116:127)
        // Toggles varbit 10078 (music_unlock_text_toggle) - controls whether unlock messages are shown
        registry.registerWidgetAction({
            widgetId: (SETTINGS_SIDE_GROUP_ID << 16) | MUSIC_UNLOCK_MESSAGE_TOGGLE_CHILD_ID,
            option: "Toggle unlock message",
            handler: ({ player, services: svc }) => {
                // Toggle the varbit value (0 <-> 1)
                const currentValue = player.getVarbitValue(VARBIT_MUSIC_UNLOCK_TEXT_TOGGLE);
                const newValue = currentValue === 0 ? 1 : 0;

                player.setVarbitValue(VARBIT_MUSIC_UNLOCK_TEXT_TOGGLE, newValue);
                svc.sendVarbit?.(player, VARBIT_MUSIC_UNLOCK_TEXT_TOGGLE, newValue);

                svc.logger?.info?.(
                    `[settings-widgets] Music unlock message toggle: player=${player.id} value=${newValue}`,
                );
            },
        });

        // Remember which Attack Options dropdown was opened (Player vs NPC).
        // settings_side_dropdown_create builds a clickable child inside these row containers, but the
        // server receives dynamic widget actions as (rowUid, childIndex). We only need the rowUid.
        registry.registerWidgetAction({
            widgetId: SETTINGS_SIDE_ATTACK_PRIORITY_PLAYER_ROW_UID,
            handler: ({ player }) => {
                activeSideDropdownSettingByPlayerId.set(
                    player.id,
                    SETTINGS_DROPDOWN_PLAYER_ATTACK_OPTIONS,
                );
            },
        });
        registry.registerWidgetAction({
            widgetId: SETTINGS_SIDE_ATTACK_PRIORITY_NPC_ROW_UID,
            handler: ({ player }) => {
                activeSideDropdownSettingByPlayerId.set(
                    player.id,
                    SETTINGS_DROPDOWN_NPC_ATTACK_OPTIONS,
                );
            },
        });

        // Handle selecting a dropdown entry (OP1="Select") from the dynamic list.
        // OSRS parity: the selection itself does not set the varp on the client; it expects the server
        // to update the backing varp (option_attackpriority / option_attackpriority_npc), which then
        // triggers onVarTransmit to resync the UI.
        const handleAttackOptionDropdownSelect = ({
            player,
            widgetId,
            childId,
            option,
            services: svc,
        }: WidgetActionEvent) => {
            if (widgetId === 0) return;
            const groupId = (widgetId >>> 16) & 0xffff;
            if (groupId !== SETTINGS_SIDE_GROUP_ID) return;
            if (!SETTINGS_SIDE_DROPDOWN_LIST_UIDS.has(widgetId)) return;
            if (option && option !== "Select") return;

            const selectedIndex = childId - 1;
            if (selectedIndex < 0) return;

            const setting = activeSideDropdownSettingByPlayerId.get(player.id);
            const varpId =
                setting === SETTINGS_DROPDOWN_PLAYER_ATTACK_OPTIONS
                    ? VARP_OPTION_ATTACK_PRIORITY_PLAYER
                    : setting === SETTINGS_DROPDOWN_NPC_ATTACK_OPTIONS
                    ? VARP_OPTION_ATTACK_PRIORITY_NPC
                    : undefined;
            if (varpId === undefined) return;
            const maxValue =
                setting === SETTINGS_DROPDOWN_PLAYER_ATTACK_OPTIONS
                    ? MAX_PLAYER_ATTACK_OPTION
                    : MAX_NPC_ATTACK_OPTION;
            if (selectedIndex > maxValue) return;

            player.setVarpValue(varpId, selectedIndex);
            svc.sendVarp?.(player, varpId, selectedIndex);
            activeSideDropdownSettingByPlayerId.delete(player.id);

            svc.logger?.info?.(
                `[settings-widgets] attack options set player=${player.id} setting=${setting} varp=${varpId} value=${selectedIndex}`,
            );
        };

        for (const wid of SETTINGS_SIDE_DROPDOWN_LIST_UIDS) {
            registry.registerWidgetAction({
                widgetId: wid,
                option: "Select",
                handler: handleAttackOptionDropdownSelect,
            });
        }

        registry.registerWidgetAction({
            handler: ({ player, groupId, option, target }) => {
                if (groupId !== SETTINGS_MODAL_GROUP_ID) return;

                const optionLabel = normalizeDropdownLabel(option);
                const targetLabel = normalizeDropdownLabel(target);
                if (
                    optionLabel.includes("level-up pop-up notifications") ||
                    targetLabel.includes("level-up pop-up notifications")
                ) {
                    activeModalDropdownSettingByPlayerId.set(
                        player.id,
                        SETTINGS_DROPDOWN_LEVEL_UP_POPUP_NOTIFICATIONS,
                    );
                }
            },
        });

        const handleModalDropdownSelect = ({
            player,
            widgetId,
            childId,
            option,
            target,
            services: svc,
        }: WidgetActionEvent) => {
            if (!SETTINGS_MODAL_DROPDOWN_LIST_UIDS.has(widgetId)) return;
            if (option && option !== "Select") return;

            const activeSetting = activeModalDropdownSettingByPlayerId.get(player.id);
            const targetLabel = normalizeDropdownLabel(target);
            const selectedValueFromTarget = LEVEL_UP_POPUP_OPTIONS.get(targetLabel);
            if (
                activeSetting !== SETTINGS_DROPDOWN_LEVEL_UP_POPUP_NOTIFICATIONS &&
                selectedValueFromTarget === undefined
            ) {
                return;
            }

            const selectedIndex = selectedValueFromTarget ?? childId - 1;
            if (selectedIndex < 0 || selectedIndex > 2) return;

            player.setVarbitValue(VARBIT_LEVEL_UP_POPUP_NOTIFICATIONS, selectedIndex);
            svc.sendVarbit?.(player, VARBIT_LEVEL_UP_POPUP_NOTIFICATIONS, selectedIndex);
            activeModalDropdownSettingByPlayerId.delete(player.id);

            svc.logger?.info?.(
                `[settings-widgets] level-up popup notifications set player=${player.id} value=${selectedIndex}`,
            );
        };

        for (const wid of SETTINGS_MODAL_DROPDOWN_LIST_UIDS) {
            registry.registerWidgetAction({
                widgetId: wid,
                option: "Select",
                handler: handleModalDropdownSelect,
            });
        }

        // Handle close button click in settings modal (widget 134, child 4, op 1)
        // The close button fires op=1 with an empty option string (runs clientscript if_close).
        registry.registerWidgetAction({
            widgetId: (SETTINGS_MODAL_GROUP_ID << 16) | 4,
            handler: ({ player, groupId, services: svc }) => {
                // Only handle clicks on settings modal
                if (groupId !== SETTINGS_MODAL_GROUP_ID) return;

                // Close the settings modal in the mainmodal container
                const mainmodalUid = getMainmodalUid(player.displayMode);

                svc.closeSubInterface?.(player, mainmodalUid);
                activeModalDropdownSettingByPlayerId.delete(player.id);

                svc.logger?.info?.(
                    `[settings-widgets] Closed settings modal for player=${player.id}`,
                );
            },
        });
    },
};
