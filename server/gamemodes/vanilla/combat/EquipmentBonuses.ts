/**
 * Vanilla Equipment Bonuses
 *
 * OSRS-accurate equipment bonus calculations including:
 * - Set effects (Void, Dharok's, Verac's, etc.)
 * - Slayer bonuses (Black mask, Slayer helmet)
 * - Species bonuses (Salve amulet, Dragon hunter, etc.)
 * - Passive effects
 */
import { EquipmentSlot } from "../../../../src/rs/config/player/Equipment";
import { AttackType } from "../../../src/game/combat/AttackType";
import type {
    EquipmentBonusProvider,
    EquipmentBonusResult,
    SlayerTaskInfo,
    TargetInfo,
} from "../../../src/game/combat/EquipmentBonusProvider";

// =============================================================================
// Item ID Constants
// =============================================================================

const VOID_MELEE_HELM = 11665;
const VOID_RANGER_HELM = 11664;
const VOID_MAGE_HELM = 11663;
const VOID_KNIGHT_TOP = 8839;
const VOID_KNIGHT_ROBE = 8840;
const VOID_KNIGHT_GLOVES = 8842;
const ELITE_VOID_TOP = 13072;
const ELITE_VOID_ROBE = 13073;

const BLACK_MASK = 8901;
const BLACK_MASK_IMBUED = 11774;
const SLAYER_HELMET = 11864;
const SLAYER_HELMET_IMBUED = 11865;
const BLACK_SLAYER_HELMET = 19639;
const BLACK_SLAYER_HELMET_I = 19641;
const GREEN_SLAYER_HELMET = 19643;
const GREEN_SLAYER_HELMET_I = 19645;
const RED_SLAYER_HELMET = 19647;
const RED_SLAYER_HELMET_I = 19649;
const PURPLE_SLAYER_HELMET = 21264;
const PURPLE_SLAYER_HELMET_I = 21266;
const TURQUOISE_SLAYER_HELMET = 21888;
const TURQUOISE_SLAYER_HELMET_I = 21890;
const HYDRA_SLAYER_HELMET = 23073;
const HYDRA_SLAYER_HELMET_I = 23075;
const TWISTED_SLAYER_HELMET = 24370;
const TWISTED_SLAYER_HELMET_I = 24444;
const TZTOK_SLAYER_HELMET = 25898;
const TZTOK_SLAYER_HELMET_I = 25900;
const VAMPYRIC_SLAYER_HELMET = 25904;
const VAMPYRIC_SLAYER_HELMET_I = 25906;
const TZKAL_SLAYER_HELMET = 25910;
const TZKAL_SLAYER_HELMET_I = 25912;

const SALVE_AMULET = 4081;
const SALVE_AMULET_E = 10588;
const SALVE_AMULET_I = 12017;
const SALVE_AMULET_EI = 12018;

const DRAGON_HUNTER_LANCE = 22978;
const DRAGON_HUNTER_CROSSBOW = 21012;

const ARCLIGHT = 19675;
const DARKLIGHT = 6746;

const KERIS = 10581;
const KERIS_PARTISAN = 25982;
const KERIS_PARTISAN_SUN = 27279;
const KERIS_PARTISAN_BREACHING = 27287;
const KERIS_PARTISAN_CORRUPTION = 27291;

const TWISTED_BOW = 20997;

const INQUISITORS_GREAT_HELM = 24419;
const INQUISITORS_HAUBERK = 24420;
const INQUISITORS_PLATESKIRT = 24421;

const OBSIDIAN_HELMET = 21298;
const OBSIDIAN_PLATEBODY = 21301;
const OBSIDIAN_PLATELEGS = 21304;
const BERSERKER_NECKLACE = 11128;
const TOKTZ_XIL_AK = 6523;
const TZHAAR_KET_OM = 6528;
const TOKTZ_XIL_EK = 6525;

const CRYSTAL_HELM = 23971;
const CRYSTAL_BODY = 23975;
const CRYSTAL_LEGS = 23979;
const CRYSTAL_BOW_IDS = new Set([
    4212, 4214, 4215, 4216, 4217, 4218, 4219, 4220, 4221, 4222, 4223, 23983, 24123,
]);
const BOW_OF_FAERDHINEN = 25862;

const TOME_OF_FIRE = 20714;

const SMOKE_BATTLESTAFF = 11998;
const MYSTIC_SMOKE_STAFF = 12000;

const CHAOS_GAUNTLETS = 777;
const CHAOS_BOLT_SPELL_IDS = new Set<number>([3281, 3285, 3288, 3291]);

const DHAROKS_HELM = 4716;
const DHAROKS_PLATEBODY = 4720;
const DHAROKS_PLATELEGS = 4722;
const DHAROKS_GREATAXE = 4718;

const VERACS_HELM = 4753;
const VERACS_BRASSARD = 4757;
const VERACS_PLATESKIRT = 4759;
const VERACS_FLAIL = 4755;

const AMULET_OF_DAMNED = 12851;
const AMULET_OF_DAMNED_FULL = 12853;

const AHRIMS_HOOD = 4708;
const AHRIMS_ROBETOP = 4712;
const AHRIMS_ROBESKIRT = 4714;
const AHRIMS_STAFF = 4710;

const TUMEKENS_SHADOW = 27275;
const TUMEKENS_SHADOW_UNCHARGED = 27277;

// =============================================================================
// Implementation
// =============================================================================

class EquipmentBonusProviderImpl implements EquipmentBonusProvider {
    calculateEquipmentBonuses(
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
        const result: EquipmentBonusResult = {
            accuracyMultiplier: 1.0,
            damageMultiplier: 1.0,
            maxHitBonus: 0,
            notes: [],
        };

        applyVoidBonus(equipment, attackType, result);
        applyDharokBonus(equipment, playerHp, playerMaxHp, result);
        applyInquisitorBonus(equipment, attackType, result);
        applyObsidianBonus(equipment, attackType, result);
        applyCrystalBonus(equipment, attackType, result);

        const useSalve = this.shouldUseSalveOverSlayer(equipment, target, slayerTask);
        if (useSalve) {
            applySalveBonus(equipment, attackType, target, result);
        } else {
            applySlayerBonus(equipment, attackType, slayerTask, result);
            if (!slayerTask.onTask) {
                applySalveBonus(equipment, attackType, target, result);
            }
        }
        applyDragonHunterBonus(equipment, attackType, target, result);
        applyDemonbaneBonus(equipment, attackType, target, result);
        applyKerisBonus(equipment, attackType, target, result);
        applyTwistedBowBonus(equipment, target, result);

        applyMagicBonuses(equipment, attackType, playerMagicLevel, spellId, result);

        applyTumekensShadowPassive(equipment, attackType, isInsideToA, result);

        return result;
    }

    isTumekensShadow(weaponId: number): boolean {
        return weaponId === TUMEKENS_SHADOW || weaponId === TUMEKENS_SHADOW_UNCHARGED;
    }

    applyTumekenMagicAttackBonus(
        baseMagicAttackBonus: number,
        tumekenMultiplier: number | undefined,
    ): number {
        if (!tumekenMultiplier || tumekenMultiplier <= 1) {
            return baseMagicAttackBonus;
        }
        return Math.floor(baseMagicAttackBonus * tumekenMultiplier);
    }

    applyTumekenMagicDamageBonus(
        baseMagicDamagePercent: number,
        tumekenMultiplier: number | undefined,
    ): number {
        if (!tumekenMultiplier || tumekenMultiplier <= 1) {
            return baseMagicDamagePercent;
        }
        const multiplied = Math.floor(baseMagicDamagePercent * tumekenMultiplier);
        return Math.min(100, multiplied);
    }

    shouldUseSalveOverSlayer(
        equipment: number[],
        target: TargetInfo,
        slayerTask: SlayerTaskInfo,
    ): boolean {
        if (!target.isUndead) return false;
        if (!slayerTask.onTask) return true;

        const neck = equipment[EquipmentSlot.AMULET];
        const hasSalveE = neck === SALVE_AMULET_E || neck === SALVE_AMULET_EI;

        return hasSalveE;
    }

    hasVeracSet(equipment: number[]): boolean {
        const helm = equipment[EquipmentSlot.HEAD];
        const body = equipment[EquipmentSlot.BODY];
        const legs = equipment[EquipmentSlot.LEGS];
        const weapon = equipment[EquipmentSlot.WEAPON];

        return (
            helm === VERACS_HELM &&
            body === VERACS_BRASSARD &&
            legs === VERACS_PLATESKIRT &&
            weapon === VERACS_FLAIL
        );
    }

    hasAhrimsDamnedSet(equipment: number[]): boolean {
        const helm = equipment[EquipmentSlot.HEAD];
        const body = equipment[EquipmentSlot.BODY];
        const legs = equipment[EquipmentSlot.LEGS];
        const weapon = equipment[EquipmentSlot.WEAPON];
        const neck = equipment[EquipmentSlot.AMULET];

        const hasAhrims =
            helm === AHRIMS_HOOD &&
            body === AHRIMS_ROBETOP &&
            legs === AHRIMS_ROBESKIRT &&
            weapon === AHRIMS_STAFF;

        const hasDamned = neck === AMULET_OF_DAMNED || neck === AMULET_OF_DAMNED_FULL;

        return hasAhrims && hasDamned;
    }
}

// =============================================================================
// Set Effect Checks
// =============================================================================

function hasVoidSet(equipment: number[]): boolean {
    const top = equipment[EquipmentSlot.BODY];
    const bottom = equipment[EquipmentSlot.LEGS];
    const gloves = equipment[EquipmentSlot.GLOVES];

    const hasTop = top === VOID_KNIGHT_TOP || top === ELITE_VOID_TOP;
    const hasBottom = bottom === VOID_KNIGHT_ROBE || bottom === ELITE_VOID_ROBE;
    const hasGloves = gloves === VOID_KNIGHT_GLOVES;

    return hasTop && hasBottom && hasGloves;
}

function hasEliteVoidSet(equipment: number[]): boolean {
    const top = equipment[EquipmentSlot.BODY];
    const bottom = equipment[EquipmentSlot.LEGS];
    const gloves = equipment[EquipmentSlot.GLOVES];

    return top === ELITE_VOID_TOP && bottom === ELITE_VOID_ROBE && gloves === VOID_KNIGHT_GLOVES;
}

function applyVoidBonus(
    equipment: number[],
    attackType: AttackType,
    result: EquipmentBonusResult,
): void {
    if (!hasVoidSet(equipment)) return;

    const helm = equipment[EquipmentSlot.HEAD];
    const isElite = hasEliteVoidSet(equipment);

    switch (attackType) {
        case AttackType.Melee:
            if (helm === VOID_MELEE_HELM) {
                result.accuracyMultiplier *= 1.1;
                result.damageMultiplier *= 1.1;
                result.notes.push("Void melee: +10% accuracy, +10% damage");
            }
            break;

        case AttackType.Ranged:
            if (helm === VOID_RANGER_HELM) {
                result.accuracyMultiplier *= 1.1;
                result.damageMultiplier *= isElite ? 1.125 : 1.1;
                result.notes.push(
                    isElite
                        ? "Elite void ranged: +10% accuracy, +12.5% damage"
                        : "Void ranged: +10% accuracy, +10% damage",
                );
            }
            break;

        case AttackType.Magic:
            if (helm === VOID_MAGE_HELM) {
                result.accuracyMultiplier *= 1.45;
                result.damageMultiplier *= isElite ? 1.025 : 1.0;
                result.notes.push(
                    isElite
                        ? "Elite void mage: +45% accuracy, +2.5% damage"
                        : "Void mage: +45% accuracy",
                );
            }
            break;
    }
}

function applyDharokBonus(
    equipment: number[],
    playerHp: number,
    playerMaxHp: number,
    result: EquipmentBonusResult,
): void {
    const helm = equipment[EquipmentSlot.HEAD];
    const body = equipment[EquipmentSlot.BODY];
    const legs = equipment[EquipmentSlot.LEGS];
    const weapon = equipment[EquipmentSlot.WEAPON];

    const hasFull =
        helm === DHAROKS_HELM &&
        body === DHAROKS_PLATEBODY &&
        legs === DHAROKS_PLATELEGS &&
        weapon === DHAROKS_GREATAXE;

    if (!hasFull) return;

    const missingHp = Math.max(0, playerMaxHp - playerHp);
    const bonus = (missingHp * playerMaxHp) / 10000;
    result.damageMultiplier *= 1 + bonus;
    result.notes.push(
        `Dharok's set: +${(bonus * 100).toFixed(1)}% damage (missing ${missingHp} HP)`,
    );
}

function applyInquisitorBonus(
    equipment: number[],
    attackType: AttackType,
    result: EquipmentBonusResult,
): void {
    if (attackType !== AttackType.Melee) return;

    const helm = equipment[EquipmentSlot.HEAD];
    const body = equipment[EquipmentSlot.BODY];
    const legs = equipment[EquipmentSlot.LEGS];

    let pieces = 0;
    if (helm === INQUISITORS_GREAT_HELM) pieces++;
    if (body === INQUISITORS_HAUBERK) pieces++;
    if (legs === INQUISITORS_PLATESKIRT) pieces++;

    if (pieces > 0) {
        let bonus = pieces * 0.005;
        if (pieces === 3) bonus += 0.01;

        result.accuracyMultiplier *= 1 + bonus;
        result.damageMultiplier *= 1 + bonus;
        result.notes.push(
            `Inquisitor's (${pieces}/3): +${(bonus * 100).toFixed(1)}% crush accuracy/damage`,
        );
    }
}

function applyObsidianBonus(
    equipment: number[],
    attackType: AttackType,
    result: EquipmentBonusResult,
): void {
    if (attackType !== AttackType.Melee) return;

    const weapon = equipment[EquipmentSlot.WEAPON];
    const isObsidianWeapon =
        weapon === TOKTZ_XIL_AK || weapon === TZHAAR_KET_OM || weapon === TOKTZ_XIL_EK;

    if (!isObsidianWeapon) return;

    const helm = equipment[EquipmentSlot.HEAD];
    const body = equipment[EquipmentSlot.BODY];
    const legs = equipment[EquipmentSlot.LEGS];
    const neck = equipment[EquipmentSlot.AMULET];

    const hasFullSet =
        helm === OBSIDIAN_HELMET && body === OBSIDIAN_PLATEBODY && legs === OBSIDIAN_PLATELEGS;

    if (hasFullSet) {
        result.accuracyMultiplier *= 1.1;
        result.damageMultiplier *= 1.1;
        result.notes.push("Obsidian set: +10% accuracy, +10% damage");
    }

    if (neck === BERSERKER_NECKLACE) {
        result.damageMultiplier *= 1.2;
        result.notes.push("Berserker necklace: +20% damage");
    }
}

function applyCrystalBonus(
    equipment: number[],
    attackType: AttackType,
    result: EquipmentBonusResult,
): void {
    if (attackType !== AttackType.Ranged) return;

    const weapon = equipment[EquipmentSlot.WEAPON];
    const isCrystalBow = CRYSTAL_BOW_IDS.has(weapon) || weapon === BOW_OF_FAERDHINEN;

    if (!isCrystalBow) return;

    const helm = equipment[EquipmentSlot.HEAD];
    const body = equipment[EquipmentSlot.BODY];
    const legs = equipment[EquipmentSlot.LEGS];

    let pieces = 0;
    if (helm === CRYSTAL_HELM) pieces++;
    if (body === CRYSTAL_BODY) pieces++;
    if (legs === CRYSTAL_LEGS) pieces++;

    if (pieces > 0) {
        let accBonus = pieces * 0.03;
        let dmgBonus = pieces * 0.06;

        if (pieces === 3) {
            accBonus += 0.05;
            dmgBonus += 0.1;
        }

        result.accuracyMultiplier *= 1 + accBonus;
        result.damageMultiplier *= 1 + dmgBonus;
        result.notes.push(
            `Crystal armor (${pieces}/3): +${(accBonus * 100).toFixed(0)}% accuracy, +${(
                dmgBonus * 100
            ).toFixed(0)}% damage`,
        );
    }
}

// =============================================================================
// Species/Slayer Bonuses
// =============================================================================

function isSlayerHelm(itemId: number): boolean {
    return [
        BLACK_MASK,
        SLAYER_HELMET,
        BLACK_SLAYER_HELMET,
        GREEN_SLAYER_HELMET,
        RED_SLAYER_HELMET,
        PURPLE_SLAYER_HELMET,
        TURQUOISE_SLAYER_HELMET,
        HYDRA_SLAYER_HELMET,
        TWISTED_SLAYER_HELMET,
        TZTOK_SLAYER_HELMET,
        VAMPYRIC_SLAYER_HELMET,
        TZKAL_SLAYER_HELMET,
    ].includes(itemId);
}

function isSlayerHelmImbued(itemId: number): boolean {
    return [
        BLACK_MASK_IMBUED,
        SLAYER_HELMET_IMBUED,
        BLACK_SLAYER_HELMET_I,
        GREEN_SLAYER_HELMET_I,
        RED_SLAYER_HELMET_I,
        PURPLE_SLAYER_HELMET_I,
        TURQUOISE_SLAYER_HELMET_I,
        HYDRA_SLAYER_HELMET_I,
        TWISTED_SLAYER_HELMET_I,
        TZTOK_SLAYER_HELMET_I,
        VAMPYRIC_SLAYER_HELMET_I,
        TZKAL_SLAYER_HELMET_I,
    ].includes(itemId);
}

function applySlayerBonus(
    equipment: number[],
    attackType: AttackType,
    slayerTask: SlayerTaskInfo,
    result: EquipmentBonusResult,
): void {
    if (!slayerTask.onTask) return;

    const helm = equipment[EquipmentSlot.HEAD];
    const hasHelm = isSlayerHelm(helm);
    const hasHelmImbued = isSlayerHelmImbued(helm);

    if (!hasHelm && !hasHelmImbued) return;

    if (attackType === AttackType.Melee) {
        result.accuracyMultiplier *= 7 / 6;
        result.damageMultiplier *= 7 / 6;
        result.notes.push("Slayer helmet (melee): +16.67% accuracy, +16.67% damage");
        return;
    }

    if (hasHelmImbued && (attackType === AttackType.Ranged || attackType === AttackType.Magic)) {
        result.accuracyMultiplier *= 1.15;
        result.damageMultiplier *= 1.15;
        result.notes.push(`Slayer helmet (i) (${attackType}): +15% accuracy, +15% damage`);
    }
}

function applySalveBonus(
    equipment: number[],
    attackType: AttackType,
    target: TargetInfo,
    result: EquipmentBonusResult,
): void {
    if (!target.isUndead) return;

    const neck = equipment[EquipmentSlot.AMULET];

    const hasSalve = neck === SALVE_AMULET;
    const hasSalveE = neck === SALVE_AMULET_E;
    const hasSalveI = neck === SALVE_AMULET_I;
    const hasSalveEI = neck === SALVE_AMULET_EI;

    if (!hasSalve && !hasSalveE && !hasSalveI && !hasSalveEI) return;

    if (attackType === AttackType.Melee) {
        if (hasSalveEI || hasSalveE) {
            result.accuracyMultiplier *= 1.2;
            result.damageMultiplier *= 1.2;
            result.notes.push("Salve amulet (e): +20% accuracy/damage vs undead");
        } else if (hasSalveI || hasSalve) {
            result.accuracyMultiplier *= 7 / 6;
            result.damageMultiplier *= 7 / 6;
            result.notes.push("Salve amulet: +16.67% accuracy/damage vs undead");
        }
    } else if (attackType === AttackType.Ranged || attackType === AttackType.Magic) {
        if (hasSalveEI) {
            result.accuracyMultiplier *= 1.2;
            result.damageMultiplier *= 1.2;
            result.notes.push(`Salve amulet (ei): +20% ${attackType} accuracy/damage vs undead`);
        } else if (hasSalveI) {
            result.accuracyMultiplier *= 7 / 6;
            result.damageMultiplier *= 7 / 6;
            result.notes.push(`Salve amulet (i): +16.67% ${attackType} accuracy/damage vs undead`);
        }
    }
}

function applyDragonHunterBonus(
    equipment: number[],
    attackType: AttackType,
    target: TargetInfo,
    result: EquipmentBonusResult,
): void {
    if (!target.isDragon) return;

    const weapon = equipment[EquipmentSlot.WEAPON];

    if (weapon === DRAGON_HUNTER_LANCE && attackType === AttackType.Melee) {
        result.accuracyMultiplier *= 1.2;
        result.damageMultiplier *= 1.2;
        result.notes.push("Dragon hunter lance: +20% accuracy/damage vs dragons");
    }

    if (weapon === DRAGON_HUNTER_CROSSBOW && attackType === AttackType.Ranged) {
        result.accuracyMultiplier *= 1.3;
        result.damageMultiplier *= 1.25;
        result.notes.push("Dragon hunter crossbow: +30% accuracy, +25% damage vs dragons");
    }
}

function applyDemonbaneBonus(
    equipment: number[],
    attackType: AttackType,
    target: TargetInfo,
    result: EquipmentBonusResult,
): void {
    if (!target.isDemon || attackType !== AttackType.Melee) return;

    const weapon = equipment[EquipmentSlot.WEAPON];

    if (weapon === ARCLIGHT) {
        result.accuracyMultiplier *= 1.7;
        result.damageMultiplier *= 1.7;
        result.notes.push("Arclight: +70% accuracy/damage vs demons");
    } else if (weapon === DARKLIGHT) {
        result.accuracyMultiplier *= 1.6;
        result.damageMultiplier *= 1.6;
        result.notes.push("Darklight: +60% accuracy/damage vs demons");
    }
}

function applyKerisBonus(
    equipment: number[],
    attackType: AttackType,
    target: TargetInfo,
    result: EquipmentBonusResult,
): void {
    if (!target.isKalphite || attackType !== AttackType.Melee) return;

    const weapon = equipment[EquipmentSlot.WEAPON];
    const kerisWeapons = [
        KERIS,
        KERIS_PARTISAN,
        KERIS_PARTISAN_SUN,
        KERIS_PARTISAN_BREACHING,
        KERIS_PARTISAN_CORRUPTION,
    ];

    if (kerisWeapons.includes(weapon)) {
        if (!result.damageProcs) {
            result.damageProcs = [];
        }
        result.damageProcs.push({ type: "keris", chance: 1 / 51, multiplier: 3 });
        result.notes.push("Keris: 1/51 chance to deal triple damage vs kalphites");
    }
}

function applyTwistedBowBonus(
    equipment: number[],
    target: TargetInfo,
    result: EquipmentBonusResult,
): void {
    const weapon = equipment[EquipmentSlot.WEAPON];
    if (weapon !== TWISTED_BOW) return;

    const targetMagic = target.magicLevel ?? 1;
    const effectiveMagic = Math.min(250, Math.max(0, targetMagic));

    const accTerm = Math.floor((3 * effectiveMagic - 10) / 100);
    const accPenalty = Math.floor((3 * effectiveMagic - 100) ** 2 / 10000);
    const dmgTerm = Math.floor((3 * effectiveMagic - 14) / 100);
    const dmgPenalty = Math.floor((3 * effectiveMagic - 140) ** 2 / 10000);
    const accuracyBonus = Math.min(140, Math.max(0, 140 + accTerm - accPenalty));
    const damageBonus = Math.min(250, Math.max(0, 250 + dmgTerm - dmgPenalty));

    result.accuracyMultiplier *= accuracyBonus / 100;
    result.damageMultiplier *= damageBonus / 100;

    if (targetMagic > 100) {
        result.notes.push(
            `Twisted bow: Scales with target magic (${targetMagic}): ${accuracyBonus.toFixed(
                0,
            )}% acc, ${damageBonus.toFixed(0)}% dmg`,
        );
    }
}

// =============================================================================
// Magic Bonuses
// =============================================================================

function applyMagicBonuses(
    equipment: number[],
    attackType: AttackType,
    _playerMagicLevel: number,
    spellId: number | undefined,
    result: EquipmentBonusResult,
): void {
    if (attackType !== AttackType.Magic) return;

    const weapon = equipment[EquipmentSlot.WEAPON];
    const shield = equipment[EquipmentSlot.SHIELD];
    const hands = equipment[EquipmentSlot.GLOVES];

    if (shield === TOME_OF_FIRE) {
        result.notes.push("Tome of Fire equipped (fire spells: +50% damage)");
    }

    if (weapon === SMOKE_BATTLESTAFF || weapon === MYSTIC_SMOKE_STAFF) {
        result.accuracyMultiplier *= 1.1;
        result.damageMultiplier *= 1.1;
        result.notes.push("Smoke staff: +10% magic accuracy/damage");
    }

    if (hands === CHAOS_GAUNTLETS && spellId && CHAOS_BOLT_SPELL_IDS.has(spellId)) {
        result.maxHitBonus += 3;
        result.notes.push("Chaos gauntlets: +3 max hit (bolt spells)");
    }
}

// =============================================================================
// Tumeken's Shadow Passive
// =============================================================================

function applyTumekensShadowPassive(
    equipment: number[],
    attackType: AttackType,
    isInsideToA: boolean,
    result: EquipmentBonusResult,
): void {
    if (attackType !== AttackType.Magic) return;

    const weapon = equipment[EquipmentSlot.WEAPON];
    if (weapon !== TUMEKENS_SHADOW && weapon !== TUMEKENS_SHADOW_UNCHARGED) return;

    const multiplier = isInsideToA ? 4 : 3;

    result.tumekenMagicAttackMultiplier = multiplier;
    result.tumekenMagicDamageMultiplier = multiplier;

    result.notes.push(
        `Tumeken's Shadow: ${multiplier}x magic attack/damage bonus${isInsideToA ? " (ToA)" : ""}`,
    );
}

// =============================================================================
// Factory
// =============================================================================

export function createEquipmentBonusProvider(): EquipmentBonusProvider {
    return new EquipmentBonusProviderImpl();
}
