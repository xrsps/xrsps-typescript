import { EquipmentSlot } from "../../../../src/rs/config/player/Equipment";
import {
    VARP_ATTACK_STYLE,
    VARP_AUTOCAST_SPELLPOS,
    VARP_AUTO_RETALIATE,
    VARP_SPECIAL_ATTACK,
} from "../../../../src/shared/vars";
import {
    buildVisibleAutocastIndices,
    canWeaponAutocastSpell,
    getAutocastCompatibilityMessage,
    getSpellIdFromAutocastIndex,
} from "../../../src/game/spells/SpellDataProvider";
import { DisplayMode } from "../../../src/game/scripts/types";
import { applyAutocastState, clearAutocastState } from "../../../src/game/scripts/types";
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
} from "../combat/RockKnockerSpecial";
import { type IScriptRegistry, type ScriptServices } from "../../../src/game/scripts/types";
import type { PlayerState } from "../../../src/game/player";

/**
 * Combat widgets handlers for interface 593 (combat options tab) and 201 (autocast popup).
 *
 * Uses onButton registration since binary IF_BUTTON packets don't send option strings.
 * Component IDs from cache:
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
const AUTOCAST_SPELL_CONTAINER_COMPONENT = 1; // Layer where CS2 CC_CREATEs dynamic spell icons

// Special weapons that use their item id as the autocast "spellpos" selector (script 243 switch table).
// For normal staves, passing the raw weapon id causes script 243 to return (-1,-1) for all spells,
// resulting in an empty chooser.
// Weapons with unique autocast spell lists (ancient, god spells, etc.) MUST be listed here
// so the CS2 script shows the correct spells in the autocast popup.
const AUTOCAST_SPELLPOS_WEAPON_IDS = new Set<number>([
    1409, // Iban's staff
    2415, // Saradomin staff (god spell)
    2416, // Guthix staff (god spell)
    2417, // Zamorak staff (god spell)
    4170, // Slayer's staff
    4675, // Ancient staff
    4710, // Ahrim's staff
    6914, // Master wand
    8841, // Void knight mace
    11791, // Staff of the dead
    12658, // Iban's staff (u)
    12904, // Toxic staff of the dead
    21006, // Kodai wand
    21255, // Slayer's staff (e)
    22296, // Staff of balance
    24422, // Nightmare staff
    24423, // Harmonised nightmare staff
    24424, // Eldritch nightmare staff
    24425, // Volatile nightmare staff
    27676, // Thammaron's sceptre
    27679, // Accursed sceptre
    27785, // Thammaron's sceptre (u)
    27788, // Accursed sceptre (u)
]);

function getPlayerDisplayMode(player: PlayerState): DisplayMode {
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
function getCombatTabUid(player: PlayerState, services: ScriptServices): number {
    const displayMode = getPlayerDisplayMode(player);
    const interfaces = services.viewport.getDefaultInterfaces(displayMode) ?? [];
    const combat = interfaces.find(
        (entry) => entry.groupId === COMBAT_WIDGET_GROUP_ID,
    );
    if (!combat) {
        // Fall back to resizable combat container (161:76) if mappings change unexpectedly.
        return (161 << 16) | 76;
    }
    return combat.targetUid;
}

function tryActivateInstantUtilitySpecial(
    player: PlayerState,
    weaponObjId: number,
    currentTick: number,
    services: ScriptServices,
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
        player.varps.setVarpValue(VARP_SPECIAL_ATTACK, 0);
        services.variables.sendVarp?.(player, VARP_SPECIAL_ATTACK, 0);
        services.combat.queueCombatState(player);
        services.messaging.sendGameMessage(player, "You do not have enough special attack energy.");
        return true;
    }

    const consumed = player.consumeSpecialEnergy?.(100) ?? false;
    if (!consumed) {
        player.setSpecialActivated?.(false);
        player.varps.setVarpValue(VARP_SPECIAL_ATTACK, 0);
        services.variables.sendVarp?.(player, VARP_SPECIAL_ATTACK, 0);
        services.combat.queueCombatState(player);
        services.messaging.sendGameMessage(player, "You do not have enough special attack energy.");
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
    player.varps.setVarpValue(VARP_SPECIAL_ATTACK, 0);
    services.variables.sendVarp?.(player, VARP_SPECIAL_ATTACK, 0);
    services.combat.queueCombatState(player);

    const seqId = (rockKnockerSeqId ?? fishstabberSeqId ?? lumberUpSeqId) as number;
    services.animation.playPlayerSeqImmediate(player, seqId);
    if (rockKnockerSeqId) {
        services.sound.sendSound(player, ROCK_KNOCKER_SOUND_ID);
    }

    services.system.logger.info?.(
        `[script:combat-widgets] Instant utility special activated for player=${player.id} ` +
            `weapon=${weaponObjId} kind=${
                rockKnockerSeqId ? "rock_knocker" : fishstabberSeqId ? "fishstabber" : "lumber_up"
            } seq=${seqId}`,
    );
    return true;
}

export function registerCombatWidgetHandlers(registry: IScriptRegistry, services: ScriptServices): void {
    // ============ COMBAT STYLE BUTTONS (593:6, 593:10, 593:14, 593:18) ============
    // The CS2 script already sets varp 43 before dispatching the action,
    // so we just need to queue combat state update.
    for (const componentId of COMBAT_STYLE_COMPONENTS) {
        registry.onButton(COMBAT_WIDGET_GROUP_ID, componentId, (event) => {
            const player = event.player;
            services.combat.queueCombatState(player);
            services.system.logger.info?.(
                `[script:combat-widgets] Combat style button clicked for player=${player.id} ` +
                    `component=${componentId}`,
            );
        });
    }

    // ============ AUTO-RETALIATE BUTTON (593:32) ============
    // varp 172 is "option_nodef" where 0 = ON, 1 = OFF
    registry.onButton(COMBAT_WIDGET_GROUP_ID, AUTO_RETALIATE_COMPONENT, (event) => {
        const player = event.player;
        const currentlyOn = !!player.combat.autoRetaliate;
        const newState = !currentlyOn;

        // Toggle the state
        player.setAutoRetaliate(newState);

        // Update varp (0 = ON, 1 = OFF - inverted logic)
        const varpValue = newState ? 0 : 1;
        player.varps.setVarpValue(VARP_AUTO_RETALIATE, varpValue);

        // Send varp to client to update the UI
        services.variables.sendVarp?.(player, VARP_AUTO_RETALIATE, varpValue);

        // Queue combat state update
        services.combat.queueCombatState(player);

        services.system.logger.info?.(
            `[script:combat-widgets] Auto-retaliate toggled for player=${player.id} ` +
                `newState=${newState ? "ON" : "OFF"}`,
        );
    });

    // ============ SPECIAL ATTACK BUTTON (593:39) ============
    // varp 301 is special attack toggle (0 = off, 1 = on)
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
        player.varps.setVarpValue(VARP_SPECIAL_ATTACK, varpValue);

        // Send varp to client to update the UI
        services.variables.sendVarp?.(player, VARP_SPECIAL_ATTACK, varpValue);

        // Queue combat state update
        services.combat.queueCombatState(player);

        services.system.logger.info?.(
            `[script:combat-widgets] Special attack toggled for player=${player.id} ` +
                `newState=${newState ? "ON" : "OFF"}`,
        );
    });

    // ============ AUTOCAST SPELL ICON (593:26) - Disable autocast ============
    // Clicking the spell icon when autocast is active disables it
    registry.onButton(COMBAT_WIDGET_GROUP_ID, AUTOCAST_SPELL_ICON_COMPONENT, (event) => {
        const player = event.player;

        if (player.combat.autocastEnabled) {
            clearAutocastState(player, {
                sendVarbit: services.variables.sendVarbit,
                queueCombatState: services.combat.queueCombatState,
            });

            services.system.logger.info?.(
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

    // ============ AUTOCAST POPUP SPELL SELECTION (201:1 dynamic children) ============
    // The CS2 autocast_setup script creates spell icon widgets via CC_CREATE under
    // component 1 (the spell grid layer). Clicks on dynamic children arrive with
    // group=201, child=1 (the parent layer), and slot = CC_CREATE childIndex.
    // We map the sequential slot back to the autocast spell index using the same
    // weapon-based visible spell list that the CS2 script builds.
    registry.onButton(AUTOCAST_POPUP_GROUP_ID, AUTOCAST_SPELL_CONTAINER_COMPONENT, (event) => {
        const slot = event.slot;
        if (slot === undefined || slot < 1 || slot === 0xffff) {
            // Background click on the layer or slot 0 header — ignore
            return;
        }
        const weaponId = event.player.combat.pendingAutocastWeaponId ?? 0;
        const visibleSpells = buildVisibleAutocastIndices(weaponId);
        // CC_CREATE childIndex is 1-based (slot 0 is a header/spacer), so subtract 1
        const arrayIndex = slot - 1;
        if (arrayIndex >= visibleSpells.length) {
            services.system.logger.warn?.(
                `[script:combat-widgets] Autocast slot=${slot} out of range ` +
                    `(visible=${visibleSpells.length}) for player=${event.player.id}`,
            );
            return;
        }
        const autocastIndex = visibleSpells[arrayIndex];
        handleAutocastSpellSelection(event.player, autocastIndex, services);
    });

    // ============ AUTOCAST POPUP CANCEL (201:0) ============
    registry.onButton(AUTOCAST_POPUP_GROUP_ID, AUTOCAST_CANCEL_COMPONENT, (event) => {
        const player = event.player;
        // Clear temporary state
        player.combat.pendingAutocastDefensive = undefined;
        player.combat.pendingAutocastWeaponId = undefined;

        const combatTabUid = getCombatTabUid(player, services);
        services.dialog.openSubInterface(player, combatTabUid, COMBAT_WIDGET_GROUP_ID, 1);
        services.system.logger.info?.(
            `[script:combat-widgets] Autocast popup cancelled for player=${player.id}`,
        );
    });
}

/**
 * Open the autocast spell selection popup
 */
function openAutocastPopup(player: PlayerState, isDefensive: boolean, services: ScriptServices): void {
    const equip = player.appearance?.equip;
    const weaponObjId = Array.isArray(equip) ? equip[EquipmentSlot.WEAPON] : 0;
    const spellposSelector =
        weaponObjId > 0 && AUTOCAST_SPELLPOS_WEAPON_IDS.has(weaponObjId) ? weaponObjId : -1;

    // Store autocast popup state so the handler can reconstruct the visible spell list
    player.combat.pendingAutocastDefensive = isDefensive;
    player.combat.pendingAutocastWeaponId = weaponObjId;

    // Open the autocast popup (interface 201) in the Combat tab container
    const combatTabUid = getCombatTabUid(player, services);
    services.dialog.openSubInterface(player, combatTabUid, AUTOCAST_POPUP_GROUP_ID, 1, {
        varps: { [VARP_AUTOCAST_SPELLPOS]: spellposSelector },
    });

    // IF_SETEVENTS for the autocast popup.
    // The CS2 autocast_setup script runs on widget 201's onLoad and creates dynamic
    // spell icon widgets via CC_CREATE under the spell grid layer (component 1).
    // Dynamic children have id=parentUid and childIndex=slot, so transmit flags must
    // be set on the PARENT component's UID with the slot range covering all children.
    // IMPORTANT: Flags must be sent AFTER openSubInterface because opening resets flags.
    const IF_SETEVENTS_TRANSMIT_OP1 = 1 << 1;

    // Enable transmission for dynamic spell icon children under the spell container (201:1).
    // The CS2 creates children at sequential childIndex 0..N for each visible spell.
    services.dialog.queueWidgetEvent(player.id, {
        action: "set_flags_range",
        uid: (AUTOCAST_POPUP_GROUP_ID << 16) | AUTOCAST_SPELL_CONTAINER_COMPONENT,
        fromSlot: 0,
        toSlot: 64, // generous upper bound for all possible spell slots
        flags: IF_SETEVENTS_TRANSMIT_OP1,
    });

    // Enable transmission for the cancel button (201:0, static widget).
    services.dialog.queueWidgetEvent(player.id, {
        action: "set_flags_range",
        uid: (AUTOCAST_POPUP_GROUP_ID << 16) | AUTOCAST_CANCEL_COMPONENT,
        fromSlot: -1,
        toSlot: -1,
        flags: IF_SETEVENTS_TRANSMIT_OP1,
    });

    services.system.logger.info?.(
        `[script:combat-widgets] Opened autocast popup for player=${player.id} ` +
            `defensive=${isDefensive} weaponObjId=${weaponObjId} spellpos=${spellposSelector}`,
    );
}

/**
 * Handle spell selection in autocast popup
 */
function handleAutocastSpellSelection(player: PlayerState, spellIndex: number, services: ScriptServices): void {
    const isDefensive = player.combat.pendingAutocastDefensive ?? false;

    // Convert spell index to actual spell ID
    const spellId = getSpellIdFromAutocastIndex(spellIndex);
    if (!spellId) {
        services.system.logger.warn?.(
            `[script:combat-widgets] Invalid autocast spell index=${spellIndex}`,
        );
        return;
    }

    // Validate staff-spell compatibility ()
    const equip = player.appearance?.equip;
    const weaponObjId = Array.isArray(equip) ? equip[EquipmentSlot.WEAPON] : 0;
    const compatibility = canWeaponAutocastSpell(weaponObjId, spellId);
    if (!compatibility.compatible) {
        const message = getAutocastCompatibilityMessage(compatibility.reason);
        services.messaging.sendGameMessage(player, message);
        services.system.logger.info?.(
            `[script:combat-widgets] Autocast rejected for player=${player.id} ` +
                `spell=${spellId} weapon=${weaponObjId} reason=${compatibility.reason}`,
        );
        // Clear temporary state and close popup
        player.combat.pendingAutocastDefensive = undefined;
        player.combat.pendingAutocastWeaponId = undefined;
        const combatTabUid = getCombatTabUid(player, services);
        services.dialog.openSubInterface(player, combatTabUid, COMBAT_WIDGET_GROUP_ID, 1);
        return;
    }

    applyAutocastState(player, spellId, spellIndex, isDefensive, {
        sendVarbit: services.variables.sendVarbit,
        queueCombatState: services.combat.queueCombatState,
    });
    player.combat.pendingAutocastDefensive = undefined;
    player.combat.pendingAutocastWeaponId = undefined;

    // Return to the combat options tab UI
    const combatTabUid = getCombatTabUid(player, services);
    services.dialog.openSubInterface(player, combatTabUid, COMBAT_WIDGET_GROUP_ID, 1);

    services.system.logger.info?.(
        `[script:combat-widgets] Autocast spell set for player=${player.id} ` +
            `spellIndex=${spellIndex} spellId=${spellId} defensive=${isDefensive}`,
    );
}
