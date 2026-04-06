/**
 * Bridge module: delegates all equipment bonus calculations to the registered EquipmentBonusProvider.
 * The actual equipment bonus definitions live in server/gamemodes/vanilla/combat/EquipmentBonuses.ts.
 * The vanilla gamemode registers the provider during initialization.
 */
import type { AttackType } from "./AttackType";
import type {
    EquipmentBonusProvider,
    EquipmentBonusResult,
    SlayerTaskInfo,
    TargetInfo,
} from "./EquipmentBonusProvider";

export type {
    EquipmentBonusResult,
    SlayerTaskInfo,
    TargetInfo,
    EquipmentBonusProvider,
} from "./EquipmentBonusProvider";

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
        equipment,
        attackType,
        target,
        slayerTask,
        playerHp,
        playerMaxHp,
        playerMagicLevel,
        spellId,
        isInsideToA,
    );
}

export function isTumekensShadow(weaponId: number): boolean {
    return ensureProvider().isTumekensShadow(weaponId);
}

export function applyTumekenMagicAttackBonus(
    baseMagicAttackBonus: number,
    tumekenMultiplier: number | undefined,
): number {
    return ensureProvider().applyTumekenMagicAttackBonus(baseMagicAttackBonus, tumekenMultiplier);
}

export function applyTumekenMagicDamageBonus(
    baseMagicDamagePercent: number,
    tumekenMultiplier: number | undefined,
): number {
    return ensureProvider().applyTumekenMagicDamageBonus(baseMagicDamagePercent, tumekenMultiplier);
}

export function shouldUseSalveOverSlayer(
    equipment: number[],
    target: TargetInfo,
    slayerTask: SlayerTaskInfo,
): boolean {
    return ensureProvider().shouldUseSalveOverSlayer(equipment, target, slayerTask);
}

export function hasVeracSet(equipment: number[]): boolean {
    return ensureProvider().hasVeracSet(equipment);
}

export function hasAhrimsDamnedSet(equipment: number[]): boolean {
    return ensureProvider().hasAhrimsDamnedSet(equipment);
}
