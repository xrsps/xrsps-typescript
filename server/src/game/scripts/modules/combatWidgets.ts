import { EquipmentSlot } from "../../../../../src/rs/config/player/Equipment";
import {
    VARP_ATTACK_STYLE,
    VARP_AUTOCAST_SPELLPOS,
    VARP_AUTO_RETALIATE,
    VARP_SPECIAL_ATTACK,
} from "../../../../../src/shared/vars";
import {
    canWeaponAutocastSpell,
    getAutocastCompatibilityMessage,
    getSpellIdFromAutocastIndex,
} from "../../../data/spells";
import { DisplayMode, getDefaultInterfaces } from "../../../widgets/WidgetManager";
import { applyAutocastState, clearAutocastState } from "../../combat/AutocastState";
import {
    ROCK_KNOCKER_SOUND_ID,
    applyFishstabberFishingBoost,
    applyLumberUpWoodcuttingBoost,
    applyRockKnockerMiningBoost,
    getFishstabberSpecialSequence,
    getLumberUpSpecialSequence,
    getRockKnockerSpecialSequence,
    markInstantUtilitySpecialHandledAtTick,
    wasInstantUtilitySpecialHandledAtTick,
} from "../../combat/RockKnockerSpecial";
import { type ScriptModule } from "../types";

/**
 * Combat widgets handlers for interface 593 (combat options tab) and 201 (autocast popup).
 *
 * Uses onButton registration since binary IF_BUTTON packets don't send option strings.
 * Component IDs from OSRS r235 cache:
 * - 593:6 = Combat style button 1
 * - 593:10 = Combat style button 2
 * - 593:14 = Combat style button 3
 * - 593:18 = Combat style button 4
 * - 593:32 = Auto-retaliate button
 * - 593:27 = Special attack bar (visual display)
 * - 593:23 = Defensive autocast "Choose spell"
 * - 593:28 = Autocast "Choose spell"
 * - 593:39 = Special attack button ("Use Special Attack")
 */

const COMBAT_WIDGET_GROUP_ID = 593;
const AUTOCAST_POPUP_GROUP_ID = 201;

// Combat interface component IDs
const COMBAT_STYLE_COMPONENTS = [6, 10, 14, 18]; // Combat style buttons
const AUTO_RETALIATE_COMPONENT = 32;
const AUTOCAST_SPELL_ICON_COMPONENT = 26; // Shows current autocast spell, op1 = disable
const AUTOCAST_BUTTON_COMPONENT = 28; // "Choose spell" button
const DEFENSIVE_AUTOCAST_BUTTON_COMPONENT = 23; // "Defensive autocast" choose spell button
const SPECIAL_ATTACK_BUTTON_COMPONENT = 39; // "Use Special Attack" button

// Autocast popup (201) components
const AUTOCAST_CANCEL_COMPONENT = 0; // Cancel button

// Special weapons that use their item id as the autocast "spellpos" selector (script 243 switch table).
// For normal staves, passing the raw weapon id causes script 243 to return (-1,-1) for all spells,
// resulting in an empty chooser.
const AUTOCAST_SPELLPOS_WEAPON_IDS = new Set<number>([
    1409, // Iban's staff
    4170, // Slayer's staff
    4675, // Ancient staff
    4710, // Ahrim's staff
    8841, // Void knight mace
    9013, // Trident of the seas (legacy)
    11791, // Staff of the dead
    21006, // Kodai wand
    21276, // Trident of the swamp
    22296, // Staff of balance
    24144, // Sanguinesti staff
    27676, // Thammaron's sceptre
    27679, // Accursed sceptre
    27785, // Thammaron's sceptre (u)
    27788, // Accursed sceptre (u)
]);

function getPlayerDisplayMode(player: any): DisplayMode {
    const mode = player?.displayMode;
    if (!Number.isFinite(mode as number)) {
        return DisplayMode.RESIZABLE_NORMAL;
    }
    const resolvedMode = mode as number;
    if (
        resolvedMode === DisplayMode.FIXED ||
        resolvedMode === DisplayMode.RESIZABLE_NORMAL ||
        resolvedMode === DisplayMode.RESIZABLE_LIST ||
        resolvedMode === DisplayMode.FULLSCREEN ||
        resolvedMode === DisplayMode.MOBILE
    ) {
        return resolvedMode as DisplayMode;
    }
    return DisplayMode.RESIZABLE_NORMAL;
}

/**
 * Autocast "Choose spell" (interface 201) should mount into the Combat tab container,
 * replacing the Combat Options interface while the chooser is open.
 */
function getCombatTabUid(player: any): number {
    const displayMode = getPlayerDisplayMode(player);
    const combat = getDefaultInterfaces(displayMode).find(
        (entry) => entry.groupId === COMBAT_WIDGET_GROUP_ID,
    );
    if (!combat) {
        // Fall back to resizable combat container (161:76) if mappings change unexpectedly.
        return (161 << 16) | 76;
    }
    return combat.targetUid;
}

function tryActivateInstantUtilitySpecial(
    player: any,
    weaponObjId: number,
    currentTick: number,
    services: any,
): boolean {
    const rockKnockerSeqId = getRockKnockerSpecialSequence(weaponObjId);
    const fishstabberSeqId = getFishstabberSpecialSequence(weaponObjId);
    const lumberUpSeqId = getLumberUpSpecialSequence(weaponObjId);
    if (!rockKnockerSeqId && !fishstabberSeqId && !lumberUpSeqId) {
        return false;
    }
    if (wasInstantUtilitySpecialHandledAtTick(player, currentTick)) {
        return true;
    }
    markInstantUtilitySpecialHandledAtTick(player, currentTick);

    const currentEnergy = player.getSpecialEnergyUnits?.() ?? 0;
    if (currentEnergy < 100) {
        player.setSpecialActivated?.(false);
        player.setVarpValue(VARP_SPECIAL_ATTACK, 0);
        services.sendVarp?.(player, VARP_SPECIAL_ATTACK, 0);
        services.queueCombatState?.(player);
        services.sendGameMessage(player, "You do not have enough special attack energy.");
        return true;
    }

    const consumed = player.consumeSpecialEnergy?.(100) ?? false;
    if (!consumed) {
        player.setSpecialActivated?.(false);
        player.setVarpValue(VARP_SPECIAL_ATTACK, 0);
        services.sendVarp?.(player, VARP_SPECIAL_ATTACK, 0);
        services.queueCombatState?.(player);
        services.sendGameMessage(player, "You do not have enough special attack energy.");
        return true;
    }

    if (rockKnockerSeqId) {
        applyRockKnockerMiningBoost(player);
    } else if (fishstabberSeqId) {
        applyFishstabberFishingBoost(player);
    } else {
        applyLumberUpWoodcuttingBoost(player);
    }

    player.setSpecialActivated?.(false);
    player.setVarpValue(VARP_SPECIAL_ATTACK, 0);
    services.sendVarp?.(player, VARP_SPECIAL_ATTACK, 0);
    services.queueCombatState?.(player);

    const seqId = (rockKnockerSeqId ?? fishstabberSeqId ?? lumberUpSeqId) as number;
    services.playPlayerSeqImmediate?.(player, seqId);
    if (rockKnockerSeqId) {
        services.sendSound?.(player, ROCK_KNOCKER_SOUND_ID);
    }

    services.logger?.info?.(
        `[script:combat-widgets] Instant utility special activated for player=${player.id} ` +
            `weapon=${weaponObjId} kind=${
                rockKnockerSeqId ? "rock_knocker" : fishstabberSeqId ? "fishstabber" : "lumber_up"
            } seq=${seqId}`,
    );
    return true;
}

export const combatWidgetModule: ScriptModule = {
    id: "content.combat-widgets",
    register(registry, services) {
        // ============ COMBAT STYLE BUTTONS (593:6, 593:10, 593:14, 593:18) ============
        // The CS2 script already sets varp 43 before dispatching the action,
        // so we just need to queue combat state update.
        for (const componentId of COMBAT_STYLE_COMPONENTS) {
            registry.onButton(COMBAT_WIDGET_GROUP_ID, componentId, (event) => {
                const player = event.player;
                services.queueCombatState?.(player);
                services.logger?.info?.(
                    `[script:combat-widgets] Combat style button clicked for player=${player.id} ` +
                        `component=${componentId}`,
                );
            });
        }

        // ============ AUTO-RETALIATE BUTTON (593:32) ============
        // OSRS parity: varp 172 is "option_nodef" where 0 = ON, 1 = OFF
        registry.onButton(COMBAT_WIDGET_GROUP_ID, AUTO_RETALIATE_COMPONENT, (event) => {
            const player = event.player;
            const currentlyOn = !!player.autoRetaliate;
            const newState = !currentlyOn;

            // Toggle the state
            player.setAutoRetaliate(newState);

            // Update varp (0 = ON, 1 = OFF - inverted logic)
            const varpValue = newState ? 0 : 1;
            player.setVarpValue(VARP_AUTO_RETALIATE, varpValue);

            // Send varp to client to update the UI
            services.sendVarp?.(player, VARP_AUTO_RETALIATE, varpValue);

            // Queue combat state update
            services.queueCombatState?.(player);

            services.logger?.info?.(
                `[script:combat-widgets] Auto-retaliate toggled for player=${player.id} ` +
                    `newState=${newState ? "ON" : "OFF"}`,
            );
        });

        // ============ SPECIAL ATTACK BUTTON (593:39) ============
        // OSRS parity: varp 301 is special attack toggle (0 = off, 1 = on)
        registry.onButton(COMBAT_WIDGET_GROUP_ID, SPECIAL_ATTACK_BUTTON_COMPONENT, (event) => {
            const player = event.player;
            const currentlyActivated = player.isSpecialActivated?.() ?? false;
            const newState = !currentlyActivated;
            const equip = player.appearance?.equip;
            const weaponObjId = Array.isArray(equip) ? equip[EquipmentSlot.WEAPON] : 0;

            if (
                newState &&
                tryActivateInstantUtilitySpecial(player, weaponObjId, event.tick, services)
            ) {
                return;
            }

            // Toggle the state
            player.setSpecialActivated?.(newState);

            // Update varp (0 = off, 1 = on)
            const varpValue = newState ? 1 : 0;
            player.setVarpValue(VARP_SPECIAL_ATTACK, varpValue);

            // Send varp to client to update the UI
            services.sendVarp?.(player, VARP_SPECIAL_ATTACK, varpValue);

            // Queue combat state update
            services.queueCombatState?.(player);

            services.logger?.info?.(
                `[script:combat-widgets] Special attack toggled for player=${player.id} ` +
                    `newState=${newState ? "ON" : "OFF"}`,
            );
        });

        // ============ AUTOCAST SPELL ICON (593:26) - Disable autocast ============
        // Clicking the spell icon when autocast is active disables it
        registry.onButton(COMBAT_WIDGET_GROUP_ID, AUTOCAST_SPELL_ICON_COMPONENT, (event) => {
            const player = event.player;

            if (player.autocastEnabled) {
                clearAutocastState(player, {
                    sendVarbit: services.sendVarbit,
                    queueCombatState: services.queueCombatState,
                });

                services.logger?.info?.(
                    `[script:combat-widgets] Autocast disabled for player=${player.id}`,
                );
            }
        });

        // ============ AUTOCAST BUTTON (593:28) - Opens spell chooser ============
        registry.onButton(COMBAT_WIDGET_GROUP_ID, AUTOCAST_BUTTON_COMPONENT, (event) => {
            openAutocastPopup(event.player, false, services);
        });

        // ============ DEFENSIVE AUTOCAST BUTTON (593:23) ============
        registry.onButton(COMBAT_WIDGET_GROUP_ID, DEFENSIVE_AUTOCAST_BUTTON_COMPONENT, (event) => {
            openAutocastPopup(event.player, true, services);
        });

        // ============ AUTOCAST POPUP SPELL SELECTION (201:1-58) ============
        // Register handlers for spell buttons in autocast popup
        for (let spellIndex = 1; spellIndex <= 58; spellIndex++) {
            const index = spellIndex; // Capture for closure
            registry.onButton(AUTOCAST_POPUP_GROUP_ID, spellIndex, (event) => {
                handleAutocastSpellSelection(event.player, index, services);
            });
        }

        // ============ AUTOCAST POPUP CANCEL (201:0) ============
        registry.onButton(AUTOCAST_POPUP_GROUP_ID, AUTOCAST_CANCEL_COMPONENT, (event) => {
            const player = event.player;
            // Clear temporary state
            player.pendingAutocastDefensive = undefined;

            const combatTabUid = getCombatTabUid(player);
            services.openSubInterface?.(player, combatTabUid, COMBAT_WIDGET_GROUP_ID, 1);
            services.logger?.info?.(
                `[script:combat-widgets] Autocast popup cancelled for player=${player.id}`,
            );
        });
    },
};

/**
 * Open the autocast spell selection popup
 */
function openAutocastPopup(player: any, isDefensive: boolean, services: any): void {
    const equip = player.appearance?.equip;
    const weaponObjId = Array.isArray(equip) ? equip[EquipmentSlot.WEAPON] : 0;
    const spellposSelector =
        weaponObjId > 0 && AUTOCAST_SPELLPOS_WEAPON_IDS.has(weaponObjId) ? weaponObjId : -1;

    // Store whether this is defensive autocast in a temporary state
    player.pendingAutocastDefensive = isDefensive;

    // Open the autocast popup (interface 201) in the Combat tab container
    const combatTabUid = getCombatTabUid(player);
    services.openSubInterface?.(player, combatTabUid, AUTOCAST_POPUP_GROUP_ID, 1, {
        varps: { [VARP_AUTOCAST_SPELLPOS]: spellposSelector },
    });

    services.logger?.info?.(
        `[script:combat-widgets] Opened autocast popup for player=${player.id} ` +
            `defensive=${isDefensive} weaponObjId=${weaponObjId} spellpos=${spellposSelector}`,
    );
}

/**
 * Handle spell selection in autocast popup
 */
function handleAutocastSpellSelection(player: any, spellIndex: number, services: any): void {
    const isDefensive = player.pendingAutocastDefensive ?? false;

    // Convert spell index to actual spell ID
    const spellId = getSpellIdFromAutocastIndex(spellIndex);
    if (!spellId) {
        services.logger?.warn?.(
            `[script:combat-widgets] Invalid autocast spell index=${spellIndex}`,
        );
        return;
    }

    // Validate staff-spell compatibility (OSRS parity)
    const equip = player.appearance?.equip;
    const weaponObjId = Array.isArray(equip) ? equip[EquipmentSlot.WEAPON] : 0;
    const compatibility = canWeaponAutocastSpell(weaponObjId, spellId);
    if (!compatibility.compatible) {
        const message = getAutocastCompatibilityMessage(compatibility.reason);
        services.sendGameMessage(player, message);
        services.logger?.info?.(
            `[script:combat-widgets] Autocast rejected for player=${player.id} ` +
                `spell=${spellId} weapon=${weaponObjId} reason=${compatibility.reason}`,
        );
        // Clear temporary state and close popup
        player.pendingAutocastDefensive = undefined;
        const combatTabUid = getCombatTabUid(player);
        services.openSubInterface?.(player, combatTabUid, COMBAT_WIDGET_GROUP_ID, 1);
        return;
    }

    applyAutocastState(player, spellId, spellIndex, isDefensive, {
        sendVarbit: services.sendVarbit,
        queueCombatState: services.queueCombatState,
    });
    player.pendingAutocastDefensive = undefined;

    // Return to the combat options tab UI
    const combatTabUid = getCombatTabUid(player);
    services.openSubInterface?.(player, combatTabUid, COMBAT_WIDGET_GROUP_ID, 1);

    services.logger?.info?.(
        `[script:combat-widgets] Autocast spell set for player=${player.id} ` +
            `spellIndex=${spellIndex} spellId=${spellId} defensive=${isDefensive}`,
    );
}
