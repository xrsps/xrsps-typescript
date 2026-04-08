import { AttackType } from "../../../src/game/combat/AttackType";
import type {
    AttackerStats,
    CombatFormulaProvider,
    DefenderStats,
    MaxHitParams,
    NpcAttackBonusProfile,
    NpcDefenceBonusProfile,
    NpcMaxHitProfile,
    NpcVsPlayerProfile,
    NpcVsPlayerResult,
    PlayerDefenceProfile,
} from "../../../src/game/combat/CombatFormulaProvider";

function attackRoll(attacker: AttackerStats): number {
    return attacker.effectiveLevel * (attacker.bonus + 64);
}

function defenceRoll(defender: DefenderStats): number {
    return defender.effectiveLevel * (defender.bonus + 64);
}

function hitChance(atkRoll: number, defRoll: number): number {
    if (defRoll <= 0) return 1;
    if (atkRoll > defRoll) {
        return 1 - (defRoll + 2) / (2 * (atkRoll + 1));
    }
    return atkRoll / (2 * (defRoll + 1));
}

function maxHit(params: MaxHitParams): number {
    const raw = 0.5 + (params.effectiveStrength * (params.strengthBonus + 64)) / 640;
    return Math.max(1, Math.floor(raw));
}

function rollDamage(max: number, random: number): number {
    if (max <= 0) return 0;
    return Math.floor(random * (max + 1));
}

function effectiveLevel(
    level: number,
    prayerMultiplier: number,
    stanceBonus: number,
): number {
    const prayed = Math.floor(level * prayerMultiplier);
    return Math.max(1, prayed + stanceBonus + 8);
}

function effectiveMagicDefence(magicLevel: number, defenceLevel: number): number {
    return Math.max(1, Math.floor(magicLevel * 0.7 + defenceLevel * 0.3) + 8);
}

function npcEffectiveAttack(attackLevel: number): number {
    return attackLevel + 8;
}

function npcEffectiveStrength(strengthLevel: number): number {
    return strengthLevel + 8;
}

function npcEffectiveDefence(defenceLevel: number): number {
    return defenceLevel + 8;
}

function getNpcAttackBonus(
    profile: NpcAttackBonusProfile,
    attackType: AttackType,
): number {
    switch (attackType) {
        case AttackType.Magic:
            return profile.magicBonus;
        case AttackType.Ranged:
            return profile.rangedBonus;
        case AttackType.Melee:
        default:
            return profile.attackBonus;
    }
}

function getNpcDefenceBonus(
    profile: NpcDefenceBonusProfile,
    attackType: AttackType,
    meleeStyle: "stab" | "slash" | "crush" = "slash",
): number {
    switch (attackType) {
        case AttackType.Magic:
            return profile.defenceMagic;
        case AttackType.Ranged:
            return profile.defenceRanged;
        case AttackType.Melee:
        default:
            switch (meleeStyle) {
                case "stab":
                    return profile.defenceStab;
                case "crush":
                    return profile.defenceCrush;
                case "slash":
                default:
                    return profile.defenceSlash;
            }
    }
}

function npcMaxHit(profile: NpcMaxHitProfile): number {
    if (profile.maxHit > 0) {
        return profile.maxHit;
    }
    const effectiveStr = npcEffectiveStrength(profile.strengthLevel);
    return maxHit({ effectiveStrength: effectiveStr, strengthBonus: profile.strengthBonus });
}

function calculateNpcVsPlayer(
    npcProfile: NpcVsPlayerProfile,
    playerDefence: PlayerDefenceProfile,
    attackType?: AttackType,
): NpcVsPlayerResult {
    const type = attackType ?? npcProfile.attackType;

    const npcEffAtk = npcEffectiveAttack(npcProfile.attackLevel);
    const npcAtkBonus = getNpcAttackBonus(npcProfile, type);
    const npcAtkRoll = attackRoll({ effectiveLevel: npcEffAtk, bonus: npcAtkBonus });

    let playerEffDef: number;
    if (type === AttackType.Magic) {
        playerEffDef = effectiveMagicDefence(playerDefence.magicLevel, playerDefence.defenceLevel);
    } else {
        playerEffDef = effectiveLevel(playerDefence.defenceLevel, 1, 0);
    }
    const playerDefRoll = defenceRoll({
        effectiveLevel: playerEffDef,
        bonus: playerDefence.defenceBonus,
    });

    return {
        hitChance: hitChance(npcAtkRoll, playerDefRoll),
        maxHit: npcMaxHit(npcProfile),
    };
}

export function createCombatFormulaProvider(): CombatFormulaProvider {
    return {
        attackRoll,
        defenceRoll,
        hitChance,
        maxHit,
        rollDamage,
        effectiveLevel,
        effectiveMagicDefence,
        npcEffectiveAttack,
        npcEffectiveStrength,
        npcEffectiveDefence,
        getNpcAttackBonus,
        getNpcDefenceBonus,
        npcMaxHit,
        calculateNpcVsPlayer,
    };
}
