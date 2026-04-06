import type { AttackType } from "./AttackType";

export interface AttackerStats {
    effectiveLevel: number;
    bonus: number;
}

export interface DefenderStats {
    effectiveLevel: number;
    bonus: number;
}

export interface MaxHitParams {
    effectiveStrength: number;
    strengthBonus: number;
}

export interface NpcAttackBonusProfile {
    attackBonus: number;
    magicBonus: number;
    rangedBonus: number;
}

export interface NpcDefenceBonusProfile {
    defenceStab: number;
    defenceSlash: number;
    defenceCrush: number;
    defenceMagic: number;
    defenceRanged: number;
}

export interface NpcMaxHitProfile {
    maxHit: number;
    strengthLevel: number;
    strengthBonus: number;
}

export interface NpcVsPlayerProfile {
    attackLevel: number;
    attackBonus: number;
    magicBonus: number;
    rangedBonus: number;
    maxHit: number;
    strengthLevel: number;
    strengthBonus: number;
    attackType: AttackType;
}

export interface PlayerDefenceProfile {
    defenceLevel: number;
    magicLevel: number;
    defenceBonus: number;
}

export interface NpcVsPlayerResult {
    hitChance: number;
    maxHit: number;
}

export interface CombatFormulaProvider {
    attackRoll(attacker: AttackerStats): number;
    defenceRoll(defender: DefenderStats): number;
    hitChance(attackRoll: number, defenceRoll: number): number;
    maxHit(params: MaxHitParams): number;
    rollDamage(maxHit: number, random: number): number;
    effectiveLevel(level: number, prayerMultiplier: number, stanceBonus: number): number;
    effectiveMagicDefence(magicLevel: number, defenceLevel: number): number;
    npcEffectiveAttack(attackLevel: number): number;
    npcEffectiveStrength(strengthLevel: number): number;
    npcEffectiveDefence(defenceLevel: number): number;
    getNpcAttackBonus(profile: NpcAttackBonusProfile, attackType: AttackType): number;
    getNpcDefenceBonus(
        profile: NpcDefenceBonusProfile,
        attackType: AttackType,
        meleeStyle?: "stab" | "slash" | "crush",
    ): number;
    npcMaxHit(profile: NpcMaxHitProfile): number;
    calculateNpcVsPlayer(
        npcProfile: NpcVsPlayerProfile,
        playerDefence: PlayerDefenceProfile,
        attackType?: AttackType,
    ): NpcVsPlayerResult;
}
