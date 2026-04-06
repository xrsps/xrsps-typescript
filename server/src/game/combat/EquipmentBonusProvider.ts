import type { AttackType } from "./AttackType";

// =============================================================================
// Types
// =============================================================================

export interface EquipmentBonusResult {
    accuracyMultiplier: number;
    damageMultiplier: number;
    maxHitBonus: number;
    notes: string[];
    damageProcs?: Array<{ type: "keris"; chance: number; multiplier: number }>;
    tumekenMagicAttackMultiplier?: number;
    tumekenMagicDamageMultiplier?: number;
}

export interface SlayerTaskInfo {
    onTask: boolean;
    monsterName?: string;
    monsterSpecies?: string[];
}

export interface TargetInfo {
    species: string[];
    magicLevel?: number;
    isUndead: boolean;
    isDemon: boolean;
    isDragon: boolean;
    isKalphite: boolean;
}

// =============================================================================
// Provider Interface
// =============================================================================

export interface EquipmentBonusProvider {
    calculateEquipmentBonuses(
        equipment: number[],
        attackType: AttackType,
        target: TargetInfo,
        slayerTask: SlayerTaskInfo,
        playerHp: number,
        playerMaxHp: number,
        playerMagicLevel?: number,
        spellId?: number,
        isInsideToA?: boolean,
    ): EquipmentBonusResult;

    isTumekensShadow(weaponId: number): boolean;

    applyTumekenMagicAttackBonus(
        baseMagicAttackBonus: number,
        tumekenMultiplier: number | undefined,
    ): number;

    applyTumekenMagicDamageBonus(
        baseMagicDamagePercent: number,
        tumekenMultiplier: number | undefined,
    ): number;

    shouldUseSalveOverSlayer(
        equipment: number[],
        target: TargetInfo,
        slayerTask: SlayerTaskInfo,
    ): boolean;

    hasVeracSet(equipment: number[]): boolean;

    hasAhrimsDamnedSet(equipment: number[]): boolean;
}
