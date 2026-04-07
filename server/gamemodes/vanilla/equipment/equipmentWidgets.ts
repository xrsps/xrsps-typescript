import type { IScriptRegistry, ScriptServices } from "../../../src/game/scripts/types";
import type { PlayerState } from "../../../src/game/player";

/**
 * Equipment widget handlers for equipment interfaces.
 *
 * Uses onButton registration since binary IF_BUTTON packets don't send option strings.
 * Component IDs from OSRS cache:
 * - 387:1 = "View equipment stats" button
 * - 387:7 = "Call follower" button
 *
 * The equipment stats interface (84) opens alongside equipment inventory (85).
 * Bonus value fields in 84 are cache-empty text widgets and are populated by
 * wsServer using authoritative equipment state. This module just needs to:
 * 1. Set varbit 12393 = 1 (equipment stats open)
 * 2. Open interfaces 84 (mainmodal) and 85 (sidemodal)
 * 3. Initialize inventory ops via script 149/151
 * 4. Handle Remove actions from both equipment tab (387) and stats view (84)
 */

// Equipment tab interface
const EQUIPMENT_TAB_GROUP_ID = 387;

// Equipment stats interface (main screen showing bonuses)
const EQUIPMENT_STATS_INTERFACE_ID = 84;

// Equipment inventory interface (sidemodal with inventory for equipping)
const EQUIPMENT_INVENTORY_INTERFACE_ID = 85;

// Component IDs
const VIEW_EQUIPMENT_STATS_COMPONENT = 1;
const CALL_FOLLOWER_COMPONENT = 7;

// Equipment slot component IDs (387:15-25) -> EquipmentSlot index
// EquipmentSlot: HEAD=0, CAPE=1, AMULET=2, WEAPON=3, BODY=4, SHIELD=5, LEGS=6, GLOVES=7, BOOTS=8, RING=9, AMMO=10
const EQUIP_SLOT_HEAD = { component: 15, slot: 0 };
const EQUIP_SLOT_CAPE = { component: 16, slot: 1 };
const EQUIP_SLOT_AMULET = { component: 17, slot: 2 };
const EQUIP_SLOT_WEAPON = { component: 18, slot: 3 };
const EQUIP_SLOT_BODY = { component: 19, slot: 4 };
const EQUIP_SLOT_SHIELD = { component: 20, slot: 5 };
const EQUIP_SLOT_LEGS = { component: 21, slot: 6 };
const EQUIP_SLOT_HANDS = { component: 22, slot: 7 };
const EQUIP_SLOT_FEET = { component: 23, slot: 8 };
const EQUIP_SLOT_RING = { component: 24, slot: 9 };
const EQUIP_SLOT_AMMO = { component: 25, slot: 10 };

const EQUIPMENT_SLOTS = [
    EQUIP_SLOT_HEAD,
    EQUIP_SLOT_CAPE,
    EQUIP_SLOT_AMULET,
    EQUIP_SLOT_WEAPON,
    EQUIP_SLOT_BODY,
    EQUIP_SLOT_SHIELD,
    EQUIP_SLOT_LEGS,
    EQUIP_SLOT_HANDS,
    EQUIP_SLOT_FEET,
    EQUIP_SLOT_RING,
    EQUIP_SLOT_AMMO,
];

// Equipment stats view slot components (84:10-20) -> EquipmentSlot index
// Cache parity: enum 2776 maps worn slots to interface components for wear_initslots.
// Worn slot indices differ from our internal EquipmentSlot enum, so we remap here.
const EQUIPMENT_STATS_SLOTS = [
    { component: 10, slot: 0 }, // worn 0 (head)
    { component: 11, slot: 1 }, // worn 1 (cape)
    { component: 12, slot: 2 }, // worn 2 (amulet)
    { component: 13, slot: 3 }, // worn 3 (weapon)
    { component: 14, slot: 4 }, // worn 4 (body)
    { component: 15, slot: 5 }, // worn 5 (shield)
    { component: 16, slot: 6 }, // worn 7 (legs)
    { component: 17, slot: 7 }, // worn 9 (hands)
    { component: 18, slot: 8 }, // worn 10 (feet)
    { component: 19, slot: 9 }, // worn 12 (ring)
    { component: 20, slot: 10 }, // worn 13 (ammo)
];

// Varbit for equipment stats open state
const VARBIT_EQUIPMENT_STATS_OPEN = 12393;

// Widget UIDs
const EQUIPMENT_INVENTORY_WIDGET_UID = EQUIPMENT_INVENTORY_INTERFACE_ID << 16; // 85:0 = 5570560

// Player inventory ID
const PLAYER_INV_ID = 93;

/**
 * Open the equipment stats interface.
 */
function openEquipmentStats(player: PlayerState, services: ScriptServices): void {
    const playerId = player.id;
    const displayMode = player.displayMode ?? 1;

    // Helper to queue scripts
    const runScript = (scriptId: number, args: (number | string)[]) => {
        services.dialog.queueWidgetEvent(playerId, {
            action: "run_script",
            scriptId,
            args,
        });
    };

    // 1. Set varbit 12393 = 1 (equipment stats open)
    services.variables.queueVarbit?.(playerId, VARBIT_EQUIPMENT_STATS_OPEN, 1);

    // 2. Open equipment stats (84) in mainmodal
    const mainmodalUid = services.viewport.getMainmodalUid(displayMode);
    services.dialog.queueWidgetEvent(playerId, {
        action: "open_sub",
        targetUid: mainmodalUid,
        groupId: EQUIPMENT_STATS_INTERFACE_ID,
        type: 0, // modal
    });

    // 3. Open equipment inventory (85) in sidemodal
    const sidemodalUid = services.viewport.getSidemodalUid(displayMode);
    services.dialog.queueWidgetEvent(playerId, {
        action: "open_sub",
        targetUid: sidemodalUid,
        groupId: EQUIPMENT_INVENTORY_INTERFACE_ID,
        type: 3, // tab/sidemodal replacement (closed by IF_CLOSE)
    });

    // 4. Initialize inventory ops for the equipment inventory interface
    // Script 149 - Interface inv init
    runScript(149, [
        EQUIPMENT_INVENTORY_WIDGET_UID,
        PLAYER_INV_ID,
        4,
        7,
        1,
        -1,
        "Equip",
        "",
        "",
        "",
        "",
    ]);

    // Script 151 - Extended interface inv init (9 op strings)
    runScript(151, [
        EQUIPMENT_INVENTORY_WIDGET_UID,
        PLAYER_INV_ID,
        4,
        7,
        1,
        -1,
        "Equip",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
    ]);

    services.system.logger.info?.(`[equipment-widgets] Opened equipment stats for player=${playerId}`);
}

export function registerEquipmentWidgetHandlers(registry: IScriptRegistry, services: ScriptServices): void {
    // ============ VIEW EQUIPMENT STATS BUTTON (387:1) ============
    // Opens the equipment stats interface (84) with equipment inventory sidemodal (85)
    registry.onButton(EQUIPMENT_TAB_GROUP_ID, VIEW_EQUIPMENT_STATS_COMPONENT, (event) => {
        openEquipmentStats(event.player, services);
    });

    registry.onButton(EQUIPMENT_TAB_GROUP_ID, CALL_FOLLOWER_COMPONENT, (event) => {
        const player = event.player;
        if (!player) {
            return;
        }

        const result = services.followers?.callFollower(player);
        if (!result?.ok) {
            services.messaging.sendGameMessage(
                player,
                result?.reason === "missing"
                    ? "You do not have a follower."
                    : "Nothing interesting happens.",
            );
        }
    });

    const registerRemoveButtons = (
        interfaceId: number,
        slots: ReadonlyArray<{ component: number; slot: number }>,
    ) => {
        for (const { component, slot } of slots) {
            registry.onButton(interfaceId, component, (event) => {
                const player = event.player;
                if (!player) return;

                services.system.logger.info?.(
                    `[equipment-widgets] Remove clicked: interface=${interfaceId} component=${component} slot=${slot} player=${player.id}`,
                );

                const success = services.equipment.unequipItem(player, slot);
                if (success) {
                    services.system.logger.info?.(
                        `[equipment-widgets] Unequipped slot=${slot} for player=${player.id}`,
                    );
                } else {
                    services.system.logger.info?.(
                        `[equipment-widgets] Failed to unequip slot=${slot} for player=${player.id}`,
                    );
                }
            });
        }
    };

    // ============ EQUIPMENT SLOT REMOVE BUTTONS (387:15-25) ============
    registerRemoveButtons(EQUIPMENT_TAB_GROUP_ID, EQUIPMENT_SLOTS);

    // ============ EQUIPMENT STATS REMOVE BUTTONS (84:10-20) ============
    registerRemoveButtons(EQUIPMENT_STATS_INTERFACE_ID, EQUIPMENT_STATS_SLOTS);
}
