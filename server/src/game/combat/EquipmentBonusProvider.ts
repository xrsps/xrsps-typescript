import type { AttackType } from "./AttackType";
export type { AttackType } from "./AttackType";

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

// =============================================================================
// Provider Registration & Delegation
// =============================================================================

let _provider: EquipmentBonusProvider | undefined;

export function registerEquipmentBonusProvider(provider: EquipmentBonusProvider): void {
    _provider = provider;
}

export function getEquipmentBonusProvider(): EquipmentBonusProvider | undefined {
    return _provider;
}

function ensureProvider(): EquipmentBonusProvider {
    if (!_provider) {
        throw new Error("[EquipmentBonuses] EquipmentBonusProvider not registered. Ensure the gamemode has initialized.");
    }
    return _provider;
}

export function calculateEquipmentBonuses(
    equipment: number[],
    attackType: AttackType,
    target: TargetInfo,
    slayerTask: SlayerTaskInfo,
    playerHp: number,
    playerMaxHp: number,
    playerMagicLevel: number = 99,
    spellId?: number,
    isInsideToA: boolean = false,
): EquipmentBonusResult {
    return ensureProvider().calculateEquipmentBonuses(
        equipment, attackType, target, slayerTask, playerHp, playerMaxHp, playerMagicLevel, spellId, isInsideToA,
    );
}

export function isTumekensShadow(weaponId: number): boolean {
    return ensureProvider().isTumekensShadow(weaponId);
}

export function applyTumekenMagicAttackBonus(baseMagicAttackBonus: number, tumekenMultiplier: number | undefined): number {
    return ensureProvider().applyTumekenMagicAttackBonus(baseMagicAttackBonus, tumekenMultiplier);
}

export function applyTumekenMagicDamageBonus(baseMagicDamagePercent: number, tumekenMultiplier: number | undefined): number {
    return ensureProvider().applyTumekenMagicDamageBonus(baseMagicDamagePercent, tumekenMultiplier);
}

export function shouldUseSalveOverSlayer(equipment: number[], target: TargetInfo, slayerTask: SlayerTaskInfo): boolean {
    return ensureProvider().shouldUseSalveOverSlayer(equipment, target, slayerTask);
}

export function hasVeracSet(equipment: number[]): boolean {
    return ensureProvider().hasVeracSet(equipment);
}

export function hasAhrimsDamnedSet(equipment: number[]): boolean {
    return ensureProvider().hasAhrimsDamnedSet(equipment);
}
