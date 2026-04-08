import { EquipmentSlot } from "../../../../src/rs/config/player/Equipment";
import { AttackType } from "../../../src/game/combat/AttackType";
import { resolvePlayerAttackType } from "../../../src/game/combat/CombatRules";
import type { PlayerState } from "../../../src/game/player";

const SALVE_MELEE_PERCENT = ((7 / 6 - 1) * 100) as number;
const SALVE_IMBUED_PERCENT = SALVE_MELEE_PERCENT;
const SALVE_ENCHANTED_PERCENT = 20;
const SLAYER_MELEE_PERCENT = ((7 / 6 - 1) * 100) as number;
const SLAYER_IMBUED_PERCENT = 15;

const ITEM_ID_SALVE_AMULET = 4081;
const ITEM_ID_SALVE_AMULET_E = 10588;
const ITEM_ID_SALVE_AMULET_I = 12017;
const ITEM_ID_SALVE_AMULET_EI = 12018;

const SLAYER_HELM_IDS = new Set<number>([
    8901,  // Black mask
    11864, // Slayer helmet
    19639, // Black slayer helmet
    19643, // Green slayer helmet
    19647, // Red slayer helmet
    21264, // Purple slayer helmet
    21888, // Turquoise slayer helmet
    23073, // Hydra slayer helmet
    24370, // Twisted slayer helmet
    25898, // Tztok slayer helmet
    25904, // Vampyric slayer helmet
    25910, // Tzkal slayer helmet
]);

const IMBUED_SLAYER_HELM_IDS = new Set<number>([
    11774, // Black mask (i)
    11865, // Slayer helmet (i)
    19641, // Black slayer helmet (i)
    19645, // Green slayer helmet (i)
    19649, // Red slayer helmet (i)
    21266, // Purple slayer helmet (i)
    21890, // Turquoise slayer helmet (i)
    23075, // Hydra slayer helmet (i)
    24444, // Twisted slayer helmet (i)
    25900, // Tztok slayer helmet (i)
    25906, // Vampyric slayer helmet (i)
    25912, // Tzkal slayer helmet (i)
]);

export function computeTargetBonusPercentages(
    player: PlayerState,
    equip: number[],
): { undeadPercent: number; slayerPercent: number } {
    const amuletId = equip[EquipmentSlot.AMULET];
    const headId = equip[EquipmentSlot.HEAD];
    const attackType = resolvePlayerAttackType(player.combat);

    let undeadPercent = 0;
    if (attackType === AttackType.Melee) {
        if (amuletId === ITEM_ID_SALVE_AMULET || amuletId === ITEM_ID_SALVE_AMULET_I) {
            undeadPercent = SALVE_MELEE_PERCENT;
        } else if (amuletId === ITEM_ID_SALVE_AMULET_E || amuletId === ITEM_ID_SALVE_AMULET_EI) {
            undeadPercent = SALVE_ENCHANTED_PERCENT;
        }
    } else if (attackType === AttackType.Ranged || attackType === AttackType.Magic) {
        if (amuletId === ITEM_ID_SALVE_AMULET_I) {
            undeadPercent = SALVE_IMBUED_PERCENT;
        } else if (amuletId === ITEM_ID_SALVE_AMULET_EI) {
            undeadPercent = SALVE_ENCHANTED_PERCENT;
        }
    }

    let slayerPercent = 0;
    const task = player.skillSystem.getSlayerTaskInfo(player.combat.slayerTask);
    const onSlayerTask = !!task.onTask;
    const hasSlayerHelm = SLAYER_HELM_IDS.has(headId) || IMBUED_SLAYER_HELM_IDS.has(headId);
    const hasImbuedSlayerHelm = IMBUED_SLAYER_HELM_IDS.has(headId);
    if (onSlayerTask && hasSlayerHelm) {
        if (attackType === AttackType.Melee) {
            slayerPercent = SLAYER_MELEE_PERCENT;
        } else if ((attackType === AttackType.Ranged || attackType === AttackType.Magic) && hasImbuedSlayerHelm) {
            slayerPercent = SLAYER_IMBUED_PERCENT;
        }
    }

    if (undeadPercent > 0 && slayerPercent > 0) {
        slayerPercent = 0;
    }

    return { undeadPercent, slayerPercent };
}
