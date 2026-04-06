import { EquipmentSlot } from "../../../../src/rs/config/player/Equipment";
import { resolvePlayerAttackType } from "../combat/CombatRules";
import type { PlayerState } from "../player";

export const EQUIPMENT_STATS_GROUP_ID = 84;

const EQUIPMENT_STATS_ATTACK_CHILD_BY_INDEX = [24, 25, 26, 27, 28] as const;
const EQUIPMENT_STATS_DEFENCE_CHILD_BY_INDEX = [30, 31, 32, 33, 34] as const;
const EQUIPMENT_STATS_OTHER_CHILD_BY_INDEX = [36, 37, 38, 39] as const;
const EQUIPMENT_STATS_TARGET_UNDEAD_CHILD = 41;
const EQUIPMENT_STATS_TARGET_SLAYER_CHILD = 42;
const EQUIPMENT_STATS_WEAPON_SPEED_BASE_CHILD = 53;
const EQUIPMENT_STATS_WEAPON_SPEED_ACTUAL_CHILD = 54;
const EQUIPMENT_STATS_BONUS_COUNT = 14;
const EQUIPMENT_STATS_SALVE_MELEE_PERCENT = ((7 / 6 - 1) * 100) as number;
const EQUIPMENT_STATS_SALVE_IMBUED_PERCENT = EQUIPMENT_STATS_SALVE_MELEE_PERCENT;
const EQUIPMENT_STATS_SALVE_ENCHANTED_PERCENT = 20;
const EQUIPMENT_STATS_SLAYER_MELEE_PERCENT = ((7 / 6 - 1) * 100) as number;
const EQUIPMENT_STATS_SLAYER_IMBUED_PERCENT = 15;
const ITEM_ID_SALVE_AMULET = 4081;
const ITEM_ID_SALVE_AMULET_E = 10588;
const ITEM_ID_SALVE_AMULET_I = 12017;
const ITEM_ID_SALVE_AMULET_EI = 12018;
const SLAYER_HELM_IDS = new Set<number>([
    8901, // Black mask
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

export interface EquipmentStatsUiServiceDeps {
    queueWidgetEvent: (playerId: number, action: any) => void;
    computeEquipmentStatBonuses: (player: PlayerState) => number[];
    ensureEquipArray: (player: PlayerState) => number[];
    formatEquipmentSignedInt: (value: number) => string;
    formatEquipmentSignedPercent: (value: number) => string;
    formatEquipmentSignedIntPercent: (value: number) => string;
    formatEquipmentAttackSpeedSeconds: (ticks: number) => string;
    resolveBaseAttackSpeed: (player: PlayerState) => number;
    pickAttackSpeed: (player: PlayerState) => number;
}

export class EquipmentStatsUiService {
    constructor(private readonly deps: EquipmentStatsUiServiceDeps) {}

    private equipmentStatsUid(childId: number): number {
        return ((EQUIPMENT_STATS_GROUP_ID & 0xffff) << 16) | (childId & 0xffff);
    }

    private queueEquipmentStatsWidgetText(playerId: number, childId: number, text: string): void {
        this.deps.queueWidgetEvent(playerId, {
            action: "set_text",
            uid: this.equipmentStatsUid(childId),
            text,
        });
    }

    computeEquipmentTargetSpecificBonusPercentages(player: PlayerState): {
        undeadPercent: number;
        slayerPercent: number;
    } {
        const equip = this.deps.ensureEquipArray(player);
        const amuletId = equip[EquipmentSlot.AMULET];
        const headId = equip[EquipmentSlot.HEAD];
        const attackType = resolvePlayerAttackType({
            combatWeaponCategory: player.combatWeaponCategory,
            combatStyleSlot: player.combatStyleSlot,
            combatSpellId: player.combatSpellId,
            autocastEnabled: player.autocastEnabled,
        });

        let undeadPercent = 0;
        if (attackType === "melee") {
            if (amuletId === ITEM_ID_SALVE_AMULET || amuletId === ITEM_ID_SALVE_AMULET_I) {
                undeadPercent = EQUIPMENT_STATS_SALVE_MELEE_PERCENT;
            } else if (
                amuletId === ITEM_ID_SALVE_AMULET_E ||
                amuletId === ITEM_ID_SALVE_AMULET_EI
            ) {
                undeadPercent = EQUIPMENT_STATS_SALVE_ENCHANTED_PERCENT;
            }
        } else if (attackType === "ranged" || attackType === "magic") {
            if (amuletId === ITEM_ID_SALVE_AMULET_I) {
                undeadPercent = EQUIPMENT_STATS_SALVE_IMBUED_PERCENT;
            } else if (amuletId === ITEM_ID_SALVE_AMULET_EI) {
                undeadPercent = EQUIPMENT_STATS_SALVE_ENCHANTED_PERCENT;
            }
        }

        let slayerPercent = 0;
        const task = player.getSlayerTaskInfo();
        const onSlayerTask = !!task.onTask;
        const hasSlayerHelm = SLAYER_HELM_IDS.has(headId) || IMBUED_SLAYER_HELM_IDS.has(headId);
        const hasImbuedSlayerHelm = IMBUED_SLAYER_HELM_IDS.has(headId);
        if (onSlayerTask && hasSlayerHelm) {
            if (attackType === "melee") {
                slayerPercent = EQUIPMENT_STATS_SLAYER_MELEE_PERCENT;
            } else if ((attackType === "ranged" || attackType === "magic") && hasImbuedSlayerHelm) {
                slayerPercent = EQUIPMENT_STATS_SLAYER_IMBUED_PERCENT;
            }
        }

        // OSRS parity: Undead and Slayer multipliers do not stack.
        if (undeadPercent > 0 && slayerPercent > 0) {
            slayerPercent = 0;
        }

        return { undeadPercent, slayerPercent };
    }

    queueEquipmentStatsWidgetTexts(player: PlayerState): void {
        const playerId = player.id;
        const bonuses = this.deps.computeEquipmentStatBonuses(player);
        const attackLabels = ["Stab", "Slash", "Crush", "Magic", "Ranged"] as const;
        const defenceLabels = ["Stab", "Slash", "Crush", "Magic", "Ranged"] as const;
        const otherLabels = [
            "Melee strength",
            "Ranged strength",
            "Magic damage",
            "Prayer",
        ] as const;

        for (let i = 0; i < EQUIPMENT_STATS_ATTACK_CHILD_BY_INDEX.length; i++) {
            this.queueEquipmentStatsWidgetText(
                playerId,
                EQUIPMENT_STATS_ATTACK_CHILD_BY_INDEX[i],
                `${attackLabels[i]}: ${this.deps.formatEquipmentSignedInt(bonuses[i] ?? 0)}`,
            );
        }
        for (let i = 0; i < EQUIPMENT_STATS_DEFENCE_CHILD_BY_INDEX.length; i++) {
            this.queueEquipmentStatsWidgetText(
                playerId,
                EQUIPMENT_STATS_DEFENCE_CHILD_BY_INDEX[i],
                `${defenceLabels[i]}: ${this.deps.formatEquipmentSignedInt(bonuses[i + 5] ?? 0)}`,
            );
        }
        this.queueEquipmentStatsWidgetText(
            playerId,
            EQUIPMENT_STATS_OTHER_CHILD_BY_INDEX[0],
            `${otherLabels[0]}: ${this.deps.formatEquipmentSignedInt(bonuses[10] ?? 0)}`,
        );
        this.queueEquipmentStatsWidgetText(
            playerId,
            EQUIPMENT_STATS_OTHER_CHILD_BY_INDEX[1],
            `${otherLabels[1]}: ${this.deps.formatEquipmentSignedInt(bonuses[11] ?? 0)}`,
        );
        this.queueEquipmentStatsWidgetText(
            playerId,
            EQUIPMENT_STATS_OTHER_CHILD_BY_INDEX[2],
            `${otherLabels[2]}: ${this.deps.formatEquipmentSignedIntPercent(bonuses[12] ?? 0)}`,
        );
        this.queueEquipmentStatsWidgetText(
            playerId,
            EQUIPMENT_STATS_OTHER_CHILD_BY_INDEX[3],
            `${otherLabels[3]}: ${this.deps.formatEquipmentSignedInt(bonuses[13] ?? 0)}`,
        );

        const targetSpecific = this.computeEquipmentTargetSpecificBonusPercentages(player);
        this.queueEquipmentStatsWidgetText(
            playerId,
            EQUIPMENT_STATS_TARGET_UNDEAD_CHILD,
            `Undead: ${this.deps.formatEquipmentSignedPercent(targetSpecific.undeadPercent)}`,
        );
        this.queueEquipmentStatsWidgetText(
            playerId,
            EQUIPMENT_STATS_TARGET_SLAYER_CHILD,
            `Slayer task: ${this.deps.formatEquipmentSignedPercent(targetSpecific.slayerPercent)}`,
        );

        const baseAttackSpeed = this.deps.resolveBaseAttackSpeed(player);
        const actualAttackSpeed = this.deps.pickAttackSpeed(player);
        this.queueEquipmentStatsWidgetText(
            playerId,
            EQUIPMENT_STATS_WEAPON_SPEED_BASE_CHILD,
            `Base: ${this.deps.formatEquipmentAttackSpeedSeconds(baseAttackSpeed)}`,
        );
        this.queueEquipmentStatsWidgetText(
            playerId,
            EQUIPMENT_STATS_WEAPON_SPEED_ACTUAL_CHILD,
            `Current: ${this.deps.formatEquipmentAttackSpeedSeconds(actualAttackSpeed)}`,
        );
    }
}
