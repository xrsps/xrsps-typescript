import type { PlayerState } from "../player";
import type { ServerServices } from "../ServerServices";

export const EQUIPMENT_STATS_GROUP_ID = 84;

const EQUIPMENT_STATS_ATTACK_CHILD_BY_INDEX = [24, 25, 26, 27, 28] as const;
const EQUIPMENT_STATS_DEFENCE_CHILD_BY_INDEX = [30, 31, 32, 33, 34] as const;
const EQUIPMENT_STATS_OTHER_CHILD_BY_INDEX = [36, 37, 38, 39] as const;
const EQUIPMENT_STATS_TARGET_UNDEAD_CHILD = 41;
const EQUIPMENT_STATS_TARGET_SLAYER_CHILD = 42;
const EQUIPMENT_STATS_WEAPON_SPEED_BASE_CHILD = 53;
const EQUIPMENT_STATS_WEAPON_SPEED_ACTUAL_CHILD = 54;

export class EquipmentStatsUiService {
    constructor(private readonly services: ServerServices) {}

    private equipmentStatsUid(childId: number): number {
        return ((EQUIPMENT_STATS_GROUP_ID & 0xffff) << 16) | (childId & 0xffff);
    }

    private queueEquipmentStatsWidgetText(playerId: number, childId: number, text: string): void {
        this.services.queueWidgetEvent(playerId, {
            action: "set_text",
            uid: this.equipmentStatsUid(childId),
            text,
        });
    }

    private computeEquipmentTargetSpecificBonusPercentages(player: PlayerState): {
        undeadPercent: number;
        slayerPercent: number;
    } {
        const contributed = this.services.scriptRuntime.getServices().equipment.computeTargetBonusPercentages;
        if (contributed) {
            return contributed(player);
        }
        return { undeadPercent: 0, slayerPercent: 0 };
    }

    queueEquipmentStatsWidgetTexts(player: PlayerState): void {
        const playerId = player.id;
        const bonuses = this.services.equipmentService.computeEquipmentStatBonuses(player);
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
                `${attackLabels[i]}: ${this.services.equipmentService.formatEquipmentSignedInt(bonuses[i] ?? 0)}`,
            );
        }
        for (let i = 0; i < EQUIPMENT_STATS_DEFENCE_CHILD_BY_INDEX.length; i++) {
            this.queueEquipmentStatsWidgetText(
                playerId,
                EQUIPMENT_STATS_DEFENCE_CHILD_BY_INDEX[i],
                `${defenceLabels[i]}: ${this.services.equipmentService.formatEquipmentSignedInt(bonuses[i + 5] ?? 0)}`,
            );
        }
        this.queueEquipmentStatsWidgetText(
            playerId,
            EQUIPMENT_STATS_OTHER_CHILD_BY_INDEX[0],
            `${otherLabels[0]}: ${this.services.equipmentService.formatEquipmentSignedInt(bonuses[10] ?? 0)}`,
        );
        this.queueEquipmentStatsWidgetText(
            playerId,
            EQUIPMENT_STATS_OTHER_CHILD_BY_INDEX[1],
            `${otherLabels[1]}: ${this.services.equipmentService.formatEquipmentSignedInt(bonuses[11] ?? 0)}`,
        );
        this.queueEquipmentStatsWidgetText(
            playerId,
            EQUIPMENT_STATS_OTHER_CHILD_BY_INDEX[2],
            `${otherLabels[2]}: ${this.services.equipmentService.formatEquipmentSignedIntPercent(bonuses[12] ?? 0)}`,
        );
        this.queueEquipmentStatsWidgetText(
            playerId,
            EQUIPMENT_STATS_OTHER_CHILD_BY_INDEX[3],
            `${otherLabels[3]}: ${this.services.equipmentService.formatEquipmentSignedInt(bonuses[13] ?? 0)}`,
        );

        const targetSpecific = this.computeEquipmentTargetSpecificBonusPercentages(player);
        this.queueEquipmentStatsWidgetText(
            playerId,
            EQUIPMENT_STATS_TARGET_UNDEAD_CHILD,
            `Undead: ${this.services.equipmentService.formatEquipmentSignedPercent(targetSpecific.undeadPercent)}`,
        );
        this.queueEquipmentStatsWidgetText(
            playerId,
            EQUIPMENT_STATS_TARGET_SLAYER_CHILD,
            `Slayer task: ${this.services.equipmentService.formatEquipmentSignedPercent(targetSpecific.slayerPercent)}`,
        );

        const baseAttackSpeed = this.services.playerCombatService!.resolveBaseAttackSpeed(player);
        const actualAttackSpeed = this.services.playerCombatService!.pickAttackSpeed(player);
        this.queueEquipmentStatsWidgetText(
            playerId,
            EQUIPMENT_STATS_WEAPON_SPEED_BASE_CHILD,
            `Base: ${this.services.equipmentService.formatEquipmentAttackSpeedSeconds(baseAttackSpeed)}`,
        );
        this.queueEquipmentStatsWidgetText(
            playerId,
            EQUIPMENT_STATS_WEAPON_SPEED_ACTUAL_CHILD,
            `Current: ${this.services.equipmentService.formatEquipmentAttackSpeedSeconds(actualAttackSpeed)}`,
        );
    }
}
