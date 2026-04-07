/**
 * Serializes and deserializes PlayerState to/from persistent storage format.
 * Extracted from PlayerState to separate persistence concerns from entity logic.
 */

import { EquipmentSlot } from "../../../../src/rs/config/player/Equipment";
import { DEFAULT_EQUIP_SLOT_COUNT } from "../equipment";
import type {
    PlayerPersistentVars,
    PlayerState,
} from "../player";
import { restoreAutocastState } from "../combat/AutocastState";
import type { PrayerName } from "../../../../src/rs/prayer/prayers";
import { DEFAULT_BANK_CAPACITY } from "./PlayerBankSystem";

export function exportPersistentVars(player: PlayerState): PlayerPersistentVars {
    const snapshot: PlayerPersistentVars = {};
    const varpData = player.varps.serialize();
    if (varpData.varps) snapshot.varps = varpData.varps;
    if (varpData.varbits) snapshot.varbits = varpData.varbits;
    const gamemodeData = player.gamemode.serializePlayerState(player);
    if (gamemodeData && Object.keys(gamemodeData).length > 0) {
        snapshot.gamemodeData = gamemodeData;
    }
    const accountSnapshot = player.account.serialize();
    snapshot.accountStage = accountSnapshot.accountStage;
    if (player.appearance) {
        snapshot.appearance = {
            gender: player.appearance.gender,
            kits: player.appearance.kits?.map((n) => n),
            colors: player.appearance.colors?.map((n) => n),
        };
    }
    const bankSnapshot = player.bank.exportBankSnapshot();
    if (bankSnapshot.length > 0) snapshot.bank = bankSnapshot;
    const capacity = player.bank.getBankCapacity();
    if (capacity !== DEFAULT_BANK_CAPACITY) {
        snapshot.bankCapacity = capacity;
    } else if (bankSnapshot.length > 0) {
        snapshot.bankCapacity = capacity;
    }
    const customQuantity = player.bank.getBankCustomQuantity();
    if (customQuantity > 0) {
        snapshot.bankQuantityCustom = customQuantity;
    }
    snapshot.bankInsertMode = player.bank.getBankInsertMode();
    snapshot.bankWithdrawNotes = player.bank.getBankWithdrawNotes();
    snapshot.bankQuantityMode = player.bank.getBankQuantityMode();
    snapshot.bankPlaceholders = player.bank.getBankPlaceholderMode();
    snapshot.inventory = player.exportInventorySnapshot();
    snapshot.equipment = player.exportEquipmentSnapshot();
    snapshot.skills = player.skillSystem.exportSkillSnapshot();
    snapshot.hitpoints = player.skillSystem.getHitpointsCurrent();
    snapshot.location = {
        x: player.tileX,
        y: player.tileY,
        level: player.level,
        orientation: player.orientation & 2047,
        rot: player.rot & 2047,
    };
    snapshot.runEnergy = player.energy.getRunEnergyUnits();
    snapshot.runToggle = !!player.runToggle;
    snapshot.autoRetaliate = !!player.combat.autoRetaliate;
    snapshot.combatStyleSlot = player.combat.styleSlot;
    if (player.combat.styleCategory !== undefined) {
        snapshot.combatStyleCategory = player.combat.styleCategory;
    }
    if (player.combat.spellId > 0) {
        snapshot.combatSpellId = player.combat.spellId;
    }
    snapshot.autocastEnabled = !!player.combat.autocastEnabled;
    snapshot.autocastMode = player.combat.autocastMode ?? null;
    snapshot.specialEnergy = player.specEnergy.getUnits();
    snapshot.specialActivated = player.specEnergy.isActivated();
    if (player.prayer.quickPrayers.size > 0) {
        snapshot.quickPrayers = Array.from(player.prayer.quickPrayers);
    }
    const chargeEntries = player.equipment.serializeCharges();
    if (chargeEntries) snapshot.equipmentCharges = chargeEntries;
    if (player.combat.degradationCharges.size > 0) {
        const degradationEntries: Array<{ slot: number; itemId: number; charges: number }> = [];
        for (const [slot, charges] of player.combat.degradationCharges.entries()) {
            const itemId = player.combat.degradationLastItemId.get(slot);
            if (itemId !== undefined && charges > 0) {
                degradationEntries.push({ slot, itemId, charges });
            }
        }
        if (degradationEntries.length > 0) {
            snapshot.degradationCharges = degradationEntries;
        }
    }
    const collectionLog = player.collectionLog.serialize();
    if (collectionLog) {
        snapshot.collectionLog = collectionLog;
    }
    const followerSnapshot = player.followers.serialize();
    if (followerSnapshot) {
        snapshot.follower = followerSnapshot;
    }
    snapshot.accountCreationTimeMs = accountSnapshot.accountCreationTimeMs;
    snapshot.playTimeSeconds = accountSnapshot.playTimeSeconds;
    return snapshot;
}

export function applyPersistentVars(player: PlayerState, state?: PlayerPersistentVars): void {
    player.gamemodeState.clear();
    if (!state) {
        player.varps.deserialize(undefined);
        player.bank.getBankEntries();
        return;
    }
    player.account.deserialize({
        accountStage: state.accountStage,
        accountCreationTimeMs: state.accountCreationTimeMs,
        playTimeSeconds: state.playTimeSeconds,
    });
    if (state.appearance) {
        if (state.appearance.gender !== undefined) {
            player.appearance.gender = state.appearance.gender === 1 ? 1 : 0;
        }
        if (state.appearance.kits) {
            player.appearance.kits = state.appearance.kits.map((n) => n).slice(0, 7);
        }
        if (state.appearance.colors) {
            player.appearance.colors = state.appearance.colors.map((n) => n).slice(0, 5);
        }
        player.markAppearanceDirty();
    }
    player.varps.deserialize({ varps: state.varps, varbits: state.varbits });
    if (state.gamemodeData && Object.keys(state.gamemodeData).length > 0) {
        player.gamemode.deserializePlayerState(
            player,
            state.gamemodeData as Record<string, unknown>,
        );
    }
    const capacity = state.bankCapacity;
    if (capacity !== undefined && capacity > 0) {
        player.bank.setBankCapacity(capacity);
    } else {
        player.bank.getBankEntries();
    }
    if (state.bankPlaceholders !== undefined) {
        player.bank.setBankPlaceholderMode(state.bankPlaceholders);
    }
    if (Array.isArray(state.bank)) {
        player.bank.loadBankSnapshot(state.bank, undefined);
    } else {
        player.bank.getBankEntries();
    }
    if (state.bankQuantityCustom !== undefined) {
        player.bank.setBankCustomQuantity(state.bankQuantityCustom);
    }
    if (state.bankQuantityMode !== undefined) {
        player.bank.setBankQuantityMode(state.bankQuantityMode);
    }
    if (state.bankWithdrawNotes !== undefined) {
        player.bank.setBankWithdrawNotes(state.bankWithdrawNotes);
    }
    if (state.bankInsertMode !== undefined) {
        player.bank.setBankInsertMode(state.bankInsertMode);
    }
    if (state.inventory) {
        player.loadInventorySnapshot(state.inventory);
    }
    if (state.equipment) {
        player.loadEquipmentSnapshot(state.equipment);
    }
    if (state.skills) {
        player.skillSystem.applySkillSnapshot(state.skills);
    }
    if (state.hitpoints !== undefined) {
        player.skillSystem.setHitpointsCurrent(state.hitpoints);
    }
    if (state.location) {
        player.applyLocationSnapshot(state.location);
    }
    if (state.runEnergy !== undefined) {
        player.energy.setRunEnergyUnits(state.runEnergy);
    }
    if (state.runToggle !== undefined) {
        player.setRunToggle(state.runToggle);
    }
    if (state.autoRetaliate !== undefined) {
        player.combat.autoRetaliate = !!state.autoRetaliate;
    }
    if (state.combatStyleSlot !== undefined || state.combatStyleCategory !== undefined) {
        player.setCombatStyle(state.combatStyleSlot, state.combatStyleCategory);
    }
    if (state.combatSpellId !== undefined) {
        player.setCombatSpell(state.combatSpellId);
    }
    if (state.autocastEnabled !== undefined) {
        player.combat.autocastEnabled = state.autocastEnabled;
    }
    if (
        state.autocastMode === "autocast" ||
        state.autocastMode === "defensive_autocast" ||
        state.autocastMode === null
    ) {
        player.combat.autocastMode = state.autocastMode ?? null;
    }
    const equip = player.appearance.equip;
    restoreAutocastState(player, equip?.[EquipmentSlot.WEAPON] ?? -1);
    if (state.specialEnergy !== undefined) {
        player.specEnergy.setPercent(state.specialEnergy);
    }
    if (state.specialActivated !== undefined) {
        player.specEnergy.setActivated(state.specialActivated);
    }
    if (Array.isArray(state.quickPrayers) && state.quickPrayers.length > 0) {
        player.prayer.setQuickPrayers(state.quickPrayers as PrayerName[]);
    } else {
        player.prayer.setQuickPrayers([]);
    }
    player.equipment.deserializeCharges(state.equipmentCharges);
    player.combat.degradationCharges.clear();
    player.combat.degradationLastItemId.clear();
    if (Array.isArray(state.degradationCharges)) {
        for (const entry of state.degradationCharges) {
            const slot = entry.slot;
            const itemId = entry.itemId;
            const charges = entry.charges;
            if (slot < 0 || itemId <= 0 || charges <= 0) continue;
            player.combat.degradationCharges.set(slot, charges);
            player.combat.degradationLastItemId.set(slot, itemId);
        }
    }
    player.collectionLog.deserialize(state.collectionLog);
    player.followers.deserialize(state.follower);
}
