/**
 * Bridge module: delegates all combat formula calculations to the registered CombatFormulaProvider.
 * The actual combat formula implementations live in server/gamemodes/vanilla/combat/CombatFormulas.ts.
 * The vanilla gamemode registers the provider during initialization.
 */
import type { AttackType } from "./AttackType";
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
} from "./CombatFormulaProvider";

export type {
    AttackerStats,
    DefenderStats,
    MaxHitParams,
    CombatFormulaProvider,
    NpcAttackBonusProfile,
    NpcDefenceBonusProfile,
    NpcMaxHitProfile,
    NpcVsPlayerProfile,
    NpcVsPlayerResult,
    PlayerDefenceProfile,
} from "./CombatFormulaProvider";

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

export function hitChance(attackRoll: number, defenceRoll: number): number {
    return ensureProvider().hitChance(attackRoll, defenceRoll);
}

export function maxHit(params: MaxHitParams): number {
    return ensureProvider().maxHit(params);
}

export function rollDamage(maxHit: number, random: number): number {
    return ensureProvider().rollDamage(maxHit, random);
}

export function effectiveLevel(
    level: number,
    prayerMultiplier: number,
    stanceBonus: number,
): number {
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

export function getNpcAttackBonus(
    profile: NpcAttackBonusProfile,
    attackType: AttackType,
): number {
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
