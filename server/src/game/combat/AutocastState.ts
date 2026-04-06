import {
    VARBIT_AUTOCAST_DEFMODE,
    VARBIT_AUTOCAST_SET,
    VARBIT_AUTOCAST_SPELL,
} from "../../../../src/shared/vars";
import { canWeaponAutocastSpell, getAutocastIndexFromSpellId } from "../spells/SpellDataProvider";
import type { PlayerState } from "../player";

type AutocastSyncCallbacks = {
    sendVarbit?: (player: PlayerState, varbitId: number, value: number) => void;
    queueCombatState?: (player: PlayerState) => void;
};

function syncAutocastVarbit(
    player: PlayerState,
    varbitId: number,
    value: number,
    callbacks?: AutocastSyncCallbacks,
): void {
    player.setVarbitValue(varbitId, value);
    callbacks?.sendVarbit?.(player, varbitId, value);
}

export function clearAutocastState(
    player: PlayerState,
    callbacks: AutocastSyncCallbacks = {},
): void {
    player.setCombatSpell(null);
    syncAutocastVarbit(player, VARBIT_AUTOCAST_SET, 0, callbacks);
    syncAutocastVarbit(player, VARBIT_AUTOCAST_SPELL, 0, callbacks);
    syncAutocastVarbit(player, VARBIT_AUTOCAST_DEFMODE, 0, callbacks);
    callbacks.queueCombatState?.(player);
}

export function applyAutocastState(
    player: PlayerState,
    spellId: number,
    autocastIndex: number,
    isDefensive: boolean,
    callbacks: AutocastSyncCallbacks = {},
): void {
    if (!(spellId > 0) || !(autocastIndex > 0)) {
        clearAutocastState(player, callbacks);
        return;
    }

    player.setCombatSpell(spellId);
    player.autocastEnabled = true;
    player.autocastMode = isDefensive ? "defensive_autocast" : "autocast";

    syncAutocastVarbit(player, VARBIT_AUTOCAST_SET, 1, callbacks);
    syncAutocastVarbit(player, VARBIT_AUTOCAST_SPELL, autocastIndex, callbacks);
    syncAutocastVarbit(player, VARBIT_AUTOCAST_DEFMODE, isDefensive ? 1 : 0, callbacks);
    callbacks.queueCombatState?.(player);
}

export function restoreAutocastState(
    player: PlayerState,
    weaponItemId: number,
    callbacks: AutocastSyncCallbacks = {},
): void {
    const spellId = player.combatSpellId ?? -1;
    const autocastEnabled = !!player.autocastEnabled;
    const autocastIndex = spellId > 0 ? getAutocastIndexFromSpellId(spellId) : undefined;

    if (!autocastEnabled || !(spellId > 0) || !(autocastIndex && autocastIndex > 0)) {
        clearAutocastState(player, callbacks);
        return;
    }

    const compatibility = canWeaponAutocastSpell(weaponItemId, spellId);
    if (!compatibility.compatible) {
        clearAutocastState(player, callbacks);
        return;
    }

    applyAutocastState(
        player,
        spellId,
        autocastIndex,
        player.autocastMode === "defensive_autocast",
        callbacks,
    );
}
