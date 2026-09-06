import { SKILL_IDS, SkillId, getXpForLevel } from "../../../client/rs/skill/skills";
import { VARP_ATTACK_STYLE, VARP_AUTO_RETALIATE, VARP_SPECIAL_ATTACK } from "../../../client/common/vars";
import { clearAutocastState } from "../../src/game/combat/AutocastState";
import { CombatAttributes } from "../../src/game/combat/state/CombatAttributes";
import type { GamemodeServerServices } from "../../src/game/gamemodes/GamemodeDefinition";
import { LockState } from "../../src/game/model/LockState";
import type { PlayerState } from "../../src/game/player";

export type DuelWeaponId = 5698 | 4151;
const COMBAT_SKILLS = new Set([SkillId.Attack, SkillId.Strength, SkillId.Defence,
    SkillId.Hitpoints, SkillId.Ranged, SkillId.Magic, SkillId.Prayer]);

export function equipDuelWeapon(player: PlayerState, weaponId: DuelWeaponId,
    services: GamemodeServerServices): void {
    player.setEquipmentSlot(3, weaponId);
    services.getEquipQtyArray(player)[3] = 1;
    services.refreshCombatWeapon(player);
    player.setCombatStyle(0, player.combat.weaponCategory);
    player.varps.setVarpValue(VARP_ATTACK_STYLE, player.combat.styleSlot);
    services.refreshAppearance(player);
    player.markAppearanceDirty();
    player.markCombatStateDirty();
}

export function stopDuelCombat(player: PlayerState): void {
    player.removeCombatTarget();
    player.clearInteraction();
    player.combat.setInteractingPlayer(null);
    player.combat.clearQueuedInstantSpecialAttacks();
    player.clearPath();
    player.clearWalkDestination();
    player.specEnergy.setActivated(false);
    player.combat.autoRetaliate = false;
    player.varps.setVarpValue(VARP_AUTO_RETALIATE, 1);
    player.varps.setVarpValue(VARP_SPECIAL_ATTACK, 0);
    player.status.poisonEffect = undefined;
    player.status.venomEffect = undefined;
    player.status.diseaseEffect = undefined;
    player.status.regenEffect = undefined;
    player.timers.clear();
    player.lock = LockState.FULL_WITH_DAMAGE_IMMUNITY;
}

export function prepareDuelFighter(player: PlayerState, weaponId: DuelWeaponId,
    side: number, services: GamemodeServerServices): void {
    stopDuelCombat(player);
    player.combatAttributes.clear();
    player.combat.autoRetaliate = false;
    player.combatAttributes.set(CombatAttributes.IS_DEAD, false);
    clearAutocastState(player);
    player.combat.pendingManualCombatSpell = undefined;
    player.prayer.clearActivePrayers();
    for (const skillId of SKILL_IDS) {
        const level = COMBAT_SKILLS.has(skillId) ? 99 : 1;
        player.skillSystem.setSkillXp(skillId, getXpForLevel(level));
        player.skillSystem.setSkillBoost(skillId, level);
    }
    player.skillSystem.setHitpointsCurrent(99);
    player.specEnergy.setPercent(100);
    // A duel changes combat equipment, never the account's owned inventory or bank.
    for (let slot = 0; slot < 14; slot++) {
        player.setEquipmentSlot(slot, -1);
        services.getEquipQtyArray(player)[slot] = 0;
    }
    // Matching light equipment keeps the two genuine player models distinct.
    player.setEquipmentSlot(1, side === 0 ? 1007 : 1021); // red / blue cape
    player.setEquipmentSlot(8, 1061); // leather boots
    services.getEquipQtyArray(player)[1] = 1;
    services.getEquipQtyArray(player)[8] = 1;
    player.appearance.colors = side === 0 ? [0, 4, 4, 0, 0] : [0, 2, 2, 0, 0];
    player.setHidden(false);
    player.stopAnimation();
    equipDuelWeapon(player, weaponId, services);
    services.sendInventorySnapshot(player.id);
}
