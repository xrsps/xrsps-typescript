import type { AttackType } from "./AttackType";
export type { AttackType } from "./AttackType";
export { normalizeAttackType } from "./AttackType";

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

// =============================================================================
// Provider Registration & Delegation
// =============================================================================

let _provider: CombatFormulaProvider | undefined;

export function registerCombatFormulaProvider(provider: CombatFormulaProvider): void {
    _provider = provider;
}

export function getCombatFormulaProvider(): CombatFormulaProvider | undefined {
    return _provider;
}

function ensureProvider(): CombatFormulaProvider {
    if (!_provider) {
        throw new Error("[CombatFormulas] CombatFormulaProvider not registered. Ensure the gamemode has initialized.");
    }
    return _provider;
}

export function attackRoll(attacker: AttackerStats): number {
    return ensureProvider().attackRoll(attacker);
}

export function defenceRoll(defender: DefenderStats): number {
    return ensureProvider().defenceRoll(defender);
}

export function hitChance(attackRollVal: number, defenceRollVal: number): number {
    return ensureProvider().hitChance(attackRollVal, defenceRollVal);
}

export function maxHit(params: MaxHitParams): number {
    return ensureProvider().maxHit(params);
}

export function rollDamage(maxHitVal: number, random: number): number {
    return ensureProvider().rollDamage(maxHitVal, random);
}

export function effectiveLevel(level: number, prayerMultiplier: number, stanceBonus: number): number {
    return ensureProvider().effectiveLevel(level, prayerMultiplier, stanceBonus);
}

export function effectiveMagicDefence(magicLevel: number, defenceLevel: number): number {
    return ensureProvider().effectiveMagicDefence(magicLevel, defenceLevel);
}

export function npcEffectiveAttack(attackLevel: number): number {
    return ensureProvider().npcEffectiveAttack(attackLevel);
}

export function npcEffectiveStrength(strengthLevel: number): number {
    return ensureProvider().npcEffectiveStrength(strengthLevel);
}

export function npcEffectiveDefence(defenceLevel: number): number {
    return ensureProvider().npcEffectiveDefence(defenceLevel);
}

export function getNpcAttackBonus(profile: NpcAttackBonusProfile, attackType: AttackType): number {
    return ensureProvider().getNpcAttackBonus(profile, attackType);
}

export function getNpcDefenceBonus(
    profile: NpcDefenceBonusProfile,
    attackType: AttackType,
    meleeStyle: "stab" | "slash" | "crush" = "slash",
): number {
    return ensureProvider().getNpcDefenceBonus(profile, attackType, meleeStyle);
}

export function npcMaxHit(profile: NpcMaxHitProfile): number {
    return ensureProvider().npcMaxHit(profile);
}

export function calculateNpcVsPlayer(
    npcProfile: NpcVsPlayerProfile,
    playerDefence: PlayerDefenceProfile,
    attackType?: AttackType,
): NpcVsPlayerResult {
    return ensureProvider().calculateNpcVsPlayer(npcProfile, playerDefence, attackType);
}
