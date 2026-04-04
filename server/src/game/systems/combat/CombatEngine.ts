import { EquipmentSlot } from "../../../../../src/rs/config/player/Equipment";
import { SkillId } from "../../../../../src/rs/skill/skills";
import { XpMode, getCombatStyle } from "../../../../data/weapons";
import { type ItemDefinition, getItemDefinition } from "../../../data/items";
import {
    ProjectileParams,
    buildProjectileParamsFromArchetype,
    getProjectileParams,
} from "../../../data/projectileParams";
import {
    calculatePoweredStaffBaseDamage,
    getPoweredStaffSpellData,
    getSpellData,
} from "../../../data/spells";
import { doesBoltEffectActivate, getEnchantedBoltEffect } from "../../combat/AmmoSystem";
import type { AttackType } from "../../combat/AttackType";
import * as CombatFormulas from "../../combat/CombatFormulas";
import {
    type SlayerTaskInfo,
    type TargetInfo,
    calculateEquipmentBonuses,
} from "../../combat/EquipmentBonuses";
import { HITMARK_BLOCK, HITMARK_DAMAGE } from "../../combat/HitEffects";
import { type NpcCombatProfile as NpcCombatProfileResolved, NpcState } from "../../npc";
import type { NpcCombatProfile } from "../../npc";
import { PlayerState } from "../../player";
import { PROJECTILE_ARCHETYPES, ProjectileArchetypeName } from "../../projectiles/ProjectileType";

type RangedProjectileProfile = {
    archetype: ProjectileArchetypeName;
    projectileId: number;
};

const ARROW_PROJECTILES = [
    { keyword: "dragon", id: 1120 },
    { keyword: "amethyst", id: 1384 },
    { keyword: "rune", id: 15 },
    { keyword: "adamant", id: 13 },
    { keyword: "mithril", id: 12 },
    { keyword: "steel", id: 11 },
    { keyword: "iron", id: 9 },
    { keyword: "bronze", id: 10 },
    { keyword: "ogre", id: 242 },
];

const JAVELIN_PROJECTILES = [
    { keyword: "dragon", id: 1301 },
    { keyword: "amethyst", id: 1386 },
    { keyword: "rune", id: 205 },
    { keyword: "adamant", id: 204 },
    { keyword: "mithril", id: 203 },
    { keyword: "steel", id: 202 },
    { keyword: "iron", id: 201 },
    { keyword: "bronze", id: 200 },
];

const DART_PROJECTILES = [
    { keyword: "dragon", id: 1122 },
    { keyword: "black", id: 34 },
    { keyword: "rune", id: 231 },
    { keyword: "adamant", id: 230 },
    { keyword: "mithril", id: 229 },
    { keyword: "steel", id: 228 },
    { keyword: "iron", id: 227 },
    { keyword: "bronze", id: 226 },
];

const KNIFE_PROJECTILES = [
    { keyword: "dragon", id: 28 },
    { keyword: "rune", id: 218 },
    { keyword: "adamant", id: 217 },
    { keyword: "mithril", id: 216 },
    { keyword: "black", id: 215 },
    { keyword: "steel", id: 214 },
    { keyword: "iron", id: 213 },
    { keyword: "bronze", id: 212 },
];

const THROWING_AXE_PROJECTILES = [
    { keyword: "dragon", id: 1319 },
    { keyword: "rune", id: 41 },
    { keyword: "adamant", id: 39 },
    { keyword: "mithril", id: 38 },
    { keyword: "steel", id: 37 },
    { keyword: "iron", id: 35 },
    { keyword: "bronze", id: 36 },
];

const SERVER_TICK_MS = 600;

export interface RandomSource {
    next(): number;
    nextInt(min: number, max: number): number;
}

export class SeededRandom implements RandomSource {
    private seed: number;

    constructor(seed: number) {
        this.seed = seed >>> 0;
    }

    next(): number {
        this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
        return this.seed / 0x100000000;
    }

    nextInt(min: number, max: number): number {
        if (max <= min) return min;
        return Math.floor(this.next() * (max - min)) + min;
    }
}

/**
 * Represents an additional hit in a multi-hit attack (e.g., dark bow, MSB spec).
 * OSRS: Dark bow fires 2 arrows with the second hitting 1 tick after the first.
 */
export interface AdditionalHit {
    damage: number;
    hitDelay: number;
    hitsplatStyle: number;
    hitLanded: boolean;
    projectile?: RangedProjectilePlan;
}

export interface PlayerAttackPlan {
    attackDelay: number;
    hitDelay: number;
    damage: number;
    maxHit: number;
    hitsplatStyle: number;
    style: number; // backwards-compatible alias for hitsplat style
    attackStyle: AttackStyle;
    attackType: AttackType;
    /** Timing for NPC retaliation (ticks after player attack) */
    retaliationDelay: number;
    hitLanded: boolean;
    projectile?: RangedProjectilePlan;
    ammoEffect?: AmmoEffectPlan;
    /** Additional hits for multi-hit weapons like dark bow. Reference: docs/projectiles-hitdelay.md */
    additionalHits?: AdditionalHit[];
}

export interface RangedProjectilePlan {
    projectileId: number;
    startHeight: number;
    endHeight: number;
    slope: number;
    steepness: number;
    startDelay: number;
}

export interface AmmoEffectPlan {
    effectType:
        | "damage_boost"
        | "hp_drain"
        | "defense_drain"
        | "lightning"
        | "poison"
        | "heal"
        | "life_leech"
        | "magic_drain";
    graphicId?: number;
    selfDamage?: number;
    leechPercent?: number;
    poison?: boolean;
}

export interface PlayerAttackContext {
    player: PlayerState;
    npc: NpcState;
    attackSpeed: number;
    pickNpcHitDelay?: (npc: NpcState, player: PlayerState, attackSpeed: number) => number;
}

export interface PlayerAttackModifiers {
    accuracyMultiplier?: number;
    maxHitMultiplier?: number;
    forceHit?: boolean;
}

export interface NpcRetaliationPlan {
    damage: number;
    maxHit: number;
    style: number;
    hitDelay: number;
    attackType: AttackType;
}

export interface NpcRetaliationContext {
    player: PlayerState;
    npc: NpcState;
    attackSpeed: number;
    pickNpcHitDelay?: (npc: NpcState, player: PlayerState, attackSpeed: number) => number;
    attackTypeOverride?: AttackType;
}

// Re-export NpcCombatProfile from npc.ts for backward compatibility
export type { NpcCombatProfile } from "../../npc";

enum AttackBonusIndex {
    Stab = 0,
    Slash = 1,
    Crush = 2,
    Magic = 3,
    Ranged = 4,
}

const DEFENCE_BONUS_INDEX: Record<AttackBonusIndex, number> = {
    [AttackBonusIndex.Stab]: 5,
    [AttackBonusIndex.Slash]: 6,
    [AttackBonusIndex.Crush]: 7,
    [AttackBonusIndex.Magic]: 8,
    [AttackBonusIndex.Ranged]: 9,
};

const MELEE_STRENGTH_INDEX = 10;
const RANGED_STRENGTH_INDEX = 11;
const MAGIC_DAMAGE_INDEX = 12;

const MAGIC_WEAPON_CATEGORIES = new Set<number>([18, 24, 29]);
// Powered staff categories always use magic attacks (built-in spell, no autocast needed)
const POWERED_STAFF_CATEGORIES = new Set<number>([24]); // POWERED_STAFF (includes Tumeken's Shadow)
const RANGED_WEAPON_CATEGORIES = new Set<number>([3, 5, 6, 7, 8, 19]);
const MAGIC_DART_SPELL_ID = 4176;
const MELEE_STYLE_BY_SLOT: MeleeStyleMode[] = ["accurate", "aggressive", "controlled", "defensive"];
const RANGED_STYLE_BY_SLOT: RangedStyleMode[] = ["accurate", "rapid", "longrange", "longrange"];
const MAGIC_STYLE_BY_SLOT: MagicStyleMode[] = ["accurate", "defensive", "defensive", "defensive"];

type PrayerStat = "attack" | "strength" | "defence" | "ranged" | "ranged_strength" | "magic";

const PRAYER_BONUS: Record<PrayerStat, Map<string, number>> = {
    attack: new Map<string, number>([
        ["clarity_of_thought", 1.05],
        ["improved_reflexes", 1.1],
        ["incredible_reflexes", 1.15],
        ["chivalry", 1.15],
        ["piety", 1.2],
    ]),
    strength: new Map<string, number>([
        ["burst_of_strength", 1.05],
        ["superhuman_strength", 1.1],
        ["ultimate_strength", 1.15],
        ["chivalry", 1.18],
        ["piety", 1.23],
    ]),
    defence: new Map<string, number>([
        ["thick_skin", 1.05],
        ["rock_skin", 1.1],
        ["steel_skin", 1.15],
        ["chivalry", 1.2],
        ["piety", 1.25],
        ["rigour", 1.25],
        ["augury", 1.25],
    ]),
    ranged: new Map<string, number>([
        ["sharp_eye", 1.05],
        ["hawk_eye", 1.1],
        ["eagle_eye", 1.15],
        ["rigour", 1.2],
    ]),
    ranged_strength: new Map<string, number>([["rigour", 1.23]]),
    magic: new Map<string, number>([
        ["mystic_will", 1.05],
        ["mystic_lore", 1.1],
        ["mystic_might", 1.15],
        ["augury", 1.25],
    ]),
};

type MeleeStyleMode = "accurate" | "aggressive" | "controlled" | "defensive";
type RangedStyleMode = "accurate" | "rapid" | "longrange";
type MagicStyleMode = "accurate" | "defensive";

type AttackStyle =
    | {
          kind: "melee";
          mode: MeleeStyleMode;
          bonusIndex: AttackBonusIndex.Stab | AttackBonusIndex.Slash | AttackBonusIndex.Crush;
      }
    | { kind: "ranged"; mode: RangedStyleMode; bonusIndex: AttackBonusIndex.Ranged }
    | { kind: "magic"; mode: MagicStyleMode; bonusIndex: AttackBonusIndex.Magic };

export class CombatEngine {
    private readonly rng: RandomSource;

    constructor(options?: { random?: RandomSource; seed?: number }) {
        if (options?.random) {
            this.rng = options.random;
        } else {
            this.rng = new SeededRandom(options?.seed ?? Date.now());
        }
    }

    // PvP magic outcome: compute attack/defence rolls using player stats, prayers, stance and gear
    // Returns landed flag and a rolled damage respecting maxHit and magic damage%.
    planPlayerVsPlayerMagic(
        attacker: PlayerState,
        defender: PlayerState,
    ): {
        hitLanded: boolean;
        maxHit: number;
        damage: number;
    } {
        // Attacker profile (treat as magic style based on weapon category)
        const atkBonuses = this.aggregatePlayerBonuses(attacker);
        const atkStyle = this.resolveAttackStyle(attacker, atkBonuses);
        const atkStance = this.resolveStanceBonuses(attacker, atkStyle);
        const atkEffective = this.computeEffectiveLevel(
            this.getBoostedLevel(attacker, SkillId.Magic),
            this.getPrayerMultiplier(attacker, "magic"),
            atkStance.magic ?? 0,
        );
        const atkBonus = atkBonuses[atkStyle.bonusIndex] ?? 0;
        const attackRoll = atkEffective * Math.max(0, atkBonus + 64);

        // Max hit (baseMaxHit with magic damage%)
        const magicDamagePct = atkBonuses[MAGIC_DAMAGE_INDEX] ?? 0;
        const baseDamage = this.resolveMagicBaseDamage(attacker, atkEffective);
        const maxHit = Math.floor(
            Math.max(0, baseDamage) * (1 + Math.max(0, magicDamagePct) / 100),
        );

        // Defender profile (magic defence)
        const defBonuses = this.aggregatePlayerBonuses(defender);
        const defStyle = this.resolveAttackStyle(defender, defBonuses);
        const defStance = this.resolveStanceBonuses(defender, defStyle);
        const prayedDefence = Math.floor(
            this.getBoostedLevel(defender, SkillId.Defence) *
                this.getPrayerMultiplier(defender, "defence"),
        );
        const prayedMagic = Math.floor(
            this.getBoostedLevel(defender, SkillId.Magic) *
                this.getPrayerMultiplier(defender, "magic"),
        );
        const effMagicDef = this.computeMagicDefenceEffectiveLevel(
            Math.max(1, prayedDefence + (defStance.defence ?? 0)),
            Math.max(1, prayedMagic),
        );
        const magicDefBonusIndex = DEFENCE_BONUS_INDEX[AttackBonusIndex.Magic];
        const defBonus = defBonuses[magicDefBonusIndex] ?? 0;
        const defenceRoll = effMagicDef * Math.max(0, defBonus + 64);

        const hitChance = this.computeHitChance(attackRoll, defenceRoll);
        const landed = this.rng.next() < hitChance;
        const damage = landed ? this.rollDamage(Math.max(0, maxHit)) : 0;
        return { hitLanded: landed, maxHit, damage };
    }
    planPlayerAttack(
        context: PlayerAttackContext,
        modifiers?: PlayerAttackModifiers,
    ): PlayerAttackPlan {
        const attackSpeed = Math.max(1, context.attackSpeed);
        const baseProfile = this.computePlayerAttackProfile(context);
        const equipment = this.getPlayerEquipment(context.player);
        const targetInfo = this.buildTargetInfo(context.npc);
        const slayerTask = this.getSlayerTaskInfo(context.player);
        const hp = this.getPlayerHitpoints(context.player);
        const playerMagicLevel = this.getBoostedLevel(context.player, SkillId.Magic);
        const activeSpellId =
            baseProfile.style.kind === "magic" ? this.getActiveSpellId(context.player) : undefined;
        const equipmentBonuses = calculateEquipmentBonuses(
            equipment,
            baseProfile.style.kind,
            targetInfo,
            slayerTask,
            hp.current,
            hp.max,
            playerMagicLevel,
            activeSpellId,
        );
        const accuracyMultiplierRaw = modifiers?.accuracyMultiplier;
        const accuracyMultiplier = Number.isFinite(accuracyMultiplierRaw) ? accuracyMultiplierRaw : 1;
        const maxHitMultiplierRaw = modifiers?.maxHitMultiplier;
        const maxHitMultiplier = Number.isFinite(maxHitMultiplierRaw) ? maxHitMultiplierRaw : 1;
        let attackRoll = Math.floor(
            Math.max(0, baseProfile.attackRoll) * Math.max(0, equipmentBonuses.accuracyMultiplier),
        );
        let maxHit = Math.floor(
            Math.max(0, baseProfile.maxHit + equipmentBonuses.maxHitBonus) *
                Math.max(0, equipmentBonuses.damageMultiplier),
        );
        attackRoll = Math.floor(
            attackRoll * Math.max(0, typeof accuracyMultiplier === "number" ? accuracyMultiplier : 1),
        );
        maxHit = Math.floor(
            maxHit * Math.max(0, typeof maxHitMultiplier === "number" ? maxHitMultiplier : 1),
        );
        const attackProfile = { ...baseProfile, attackRoll, maxHit };
        const defenceRoll = this.computeNpcDefenceRoll(context, attackProfile);
        const forceHit = !!modifiers?.forceHit;
        const hitChance = forceHit
            ? 1
            : this.computeHitChance(attackProfile.attackRoll, defenceRoll);
        // OSRS parity: Hit delays are now computed using authentic RSMod formulas
        // Melee: 0 ticks, Ranged: 1 + floor((3+dist)/6), Magic: 1 + floor((1+dist)/3)
        // CRITICAL: All player hits on NPCs get +1 tick delay because NPCs process before players.
        // Reference: docs/tick-cycle-order.md, docs/osrs-mechanics.md
        const baseHitDelay = this.computeHitDelay(context, attackProfile.style);
        const hitDelay = baseHitDelay + 1; // +1 for NPC target
        const roll = this.rng.next();
        const hitLanded = forceHit ? true : roll < hitChance;
        let damage = hitLanded ? this.rollDamage(Math.max(0, maxHit)) : 0;
        if (hitLanded && damage > 0 && equipmentBonuses.damageProcs?.length) {
            for (const proc of equipmentBonuses.damageProcs) {
                const chance = Math.max(0, Math.min(1, proc.chance));
                if (chance > 0 && this.rng.next() < chance) {
                    damage = Math.max(0, Math.floor(damage * Math.max(0, proc.multiplier)));
                }
            }
        }
        let ammoEffect: AmmoEffectPlan | undefined;
        if (hitLanded && attackProfile.style.kind === "ranged") {
            const ammoId = this.getEquippedAmmoId(context.player);
            const boltEffect = ammoId > 0 ? getEnchantedBoltEffect(ammoId) : undefined;
            if (boltEffect && doesBoltEffectActivate(ammoId, false, () => this.rng.next())) {
                ammoEffect = {
                    effectType: boltEffect.effectType,
                    graphicId: boltEffect.graphicId,
                };
                switch (boltEffect.effectType) {
                    case "hp_drain": {
                        const targetHp = Math.max(0, context.npc.getHitpoints());
                        const percent = boltEffect.damageMultiplier ?? 0;
                        let drained = Math.floor(targetHp * Math.max(0, percent));
                        if (percent > 0.2) {
                            drained = Math.min(drained, 110);
                        } else {
                            drained = Math.min(drained, 100);
                        }
                        damage = Math.max(0, drained);
                        if (boltEffect.selfDamagePercent) {
                            const selfDamage = Math.floor(
                                hp.current * Math.max(0, boltEffect.selfDamagePercent),
                            );
                            ammoEffect.selfDamage = Math.max(0, selfDamage);
                        }
                        break;
                    }
                    case "life_leech": {
                        if (boltEffect.damageMultiplier && damage > 0) {
                            damage = Math.floor(damage * boltEffect.damageMultiplier);
                        }
                        if (boltEffect.leechPercent) {
                            ammoEffect.leechPercent = Math.max(0, boltEffect.leechPercent);
                        }
                        break;
                    }
                    case "lightning": {
                        const rangedLevel = this.getBoostedLevel(context.player, SkillId.Ranged);
                        const bonus = Math.floor(Math.max(0, rangedLevel) * 0.1);
                        if (bonus > 0) {
                            damage += bonus;
                        }
                        break;
                    }
                    case "damage_boost":
                    case "defense_drain": {
                        if (boltEffect.damageMultiplier && damage > 0) {
                            damage = Math.floor(damage * boltEffect.damageMultiplier);
                        }
                        break;
                    }
                    case "poison": {
                        ammoEffect.poison = true;
                        break;
                    }
                    case "heal":
                    case "magic_drain":
                    default:
                        break;
                }
            }
        }
        const hitsplatStyle = hitLanded ? HITMARK_DAMAGE : HITMARK_BLOCK;
        const attackStyle = attackProfile.style;
        // NPC retaliation timing metadata used by combat scheduling paths.
        const retaliationDelay = Math.max(
            1,
            context.pickNpcHitDelay?.(context.npc, context.player, attackSpeed) ??
                this.pickDefaultNpcHitDelay(context.npc, context.player, attackSpeed),
        );
        let projectilePlan: RangedProjectilePlan | undefined;
        if (attackStyle.kind === "ranged") {
            const projectileDefaults = this.getRangedProjectileParams(context);
            if (projectileDefaults?.projectileId) {
                projectilePlan = {
                    projectileId: projectileDefaults.projectileId,
                    startHeight: projectileDefaults.startHeight ?? 0,
                    endHeight: projectileDefaults.endHeight ?? 0,
                    slope: projectileDefaults.slope ?? 0,
                    steepness: projectileDefaults.steepness ?? 0,
                    startDelay: projectileDefaults.startDelay ?? 0,
                };
            }
        } else if (attackStyle.kind === "magic") {
            // Powered staff projectile planning
            const poweredStaffProjectile = this.getPoweredStaffProjectileParams(context);
            if (poweredStaffProjectile) {
                projectilePlan = poweredStaffProjectile;
            }
        }

        const attackType: AttackType = attackStyle.kind;

        // OSRS: Dark bow fires 2 arrows, with the second hitting 1 tick after the first
        // Reference: docs/projectiles-hitdelay.md
        let additionalHits: AdditionalHit[] | undefined;
        const weaponId = context.player.combatWeaponItemId;
        if (this.isDarkBow(weaponId)) {
            // Second arrow: roll independent hit and damage
            const secondHitLanded = forceHit ? true : this.rng.next() < hitChance;
            const secondDamage = secondHitLanded ? this.rollDamage(Math.max(0, maxHit)) : 0;
            additionalHits = [
                {
                    damage: secondDamage,
                    hitDelay: hitDelay + 1, // Second arrow hits 1 tick later
                    hitsplatStyle,
                    hitLanded: secondHitLanded,
                    projectile: projectilePlan
                        ? {
                              ...projectilePlan,
                              startDelay: (projectilePlan.startDelay ?? 0) + 1,
                          }
                        : undefined,
                },
            ];
        }

        return {
            attackDelay: attackSpeed,
            hitDelay,
            damage,
            maxHit,
            hitsplatStyle,
            style: hitsplatStyle,
            attackStyle,
            attackType,
            retaliationDelay,
            hitLanded,
            projectile: projectilePlan,
            ammoEffect,
            additionalHits,
        };
    }

    planNpcRetaliation(context: NpcRetaliationContext): NpcRetaliationPlan {
        const attackSpeed = Math.max(1, context.attackSpeed);
        // Use NPC's owned combat profile directly (loaded at spawn)
        const profile = context.npc.combat;

        // Determine attack type from profile
        const attackType: AttackType = context.attackTypeOverride ?? profile.attackType;

        // NPC retaliation hit delay from swing to impact.
        const hitDelay = Math.max(
            1,
            context.pickNpcHitDelay?.(context.npc, context.player, attackSpeed) ??
                this.pickDefaultNpcHitDelay(context.npc, context.player, attackSpeed, attackType),
        );

        // Use CombatFormulas for hit chance and max hit calculation
        const playerDefenceLevel = this.getBoostedLevel(context.player, SkillId.Defence);
        const playerMagicLevel = this.getBoostedLevel(context.player, SkillId.Magic);
        const playerDefenceBonus = this.getPlayerDefenceBonus(context.player, attackType);

        const combatResult = CombatFormulas.calculateNpcVsPlayer(
            profile,
            {
                defenceLevel: playerDefenceLevel,
                magicLevel: playerMagicLevel,
                defenceBonus: playerDefenceBonus,
            },
            attackType,
        );

        // Roll hit and damage
        const hitLanded = this.rng.next() < combatResult.hitChance;
        const damage = hitLanded
            ? CombatFormulas.rollDamage(combatResult.maxHit, this.rng.next())
            : 0;

        return {
            damage,
            maxHit: combatResult.maxHit,
            style: hitLanded ? HITMARK_DAMAGE : HITMARK_BLOCK,
            hitDelay,
            attackType,
        };
    }

    resolveBlockSequence(
        player: PlayerState,
        weaponData?: Map<number, Record<string, number>>,
    ): number {
        try {
            const equip = player.appearance?.equip;
            const weaponId = Array.isArray(equip) ? equip[EquipmentSlot.WEAPON] : 0;
            if (weaponId > 0) {
                const overrideBlock = weaponData?.get(weaponId)?.block;
                if (overrideBlock !== undefined && overrideBlock >= 0) {
                    return overrideBlock;
                }
            }
        } catch {}
        return -1;
    }

    /**
     * Computes the hit delay (in ticks) for an attack based on combat style and distance.
     *
     * OSRS hit delay formulas (from docs/projectiles.md):
     * - Melee: 0 ticks (immediate damage)
     * - Ranged (bows/crossbows): 1 + floor((3 + distance) / 6) ticks
     * - Ranged (thrown weapons): 1 + floor(distance / 6) ticks
     * - Magic: 1 + floor((1 + distance) / 3) ticks
     * - Ballista: Base bow delay + 1 tick
     *
     * Reference: docs/projectiles.md
     */
    private computeHitDelay(context: PlayerAttackContext, attackStyle: AttackStyle): number {
        const distance = this.getTileDistance(context.player, context.npc);

        switch (attackStyle.kind) {
            case "magic":
                // OSRS: 1 + floor((1 + distance) / 3)
                return Math.max(1, 1 + Math.floor((1 + distance) / 3));

            case "ranged": {
                // Check if using thrown weapons (darts, knives, throwing axes, chinchompas)
                const rangedWeaponId = context.player.combatWeaponItemId;
                const isThrown = this.isThrownWeapon(rangedWeaponId);
                if (isThrown) {
                    // OSRS: Thrown weapons use 1 + floor(distance / 6)
                    // Distance 1-5: 1 tick, 6-10: 2 ticks
                    // Reference: docs/projectiles.md
                    return Math.max(1, 1 + Math.floor(distance / 6));
                }
                // OSRS: Ballista has +1 tick delay compared to other bows/crossbows
                // Reference: docs/projectiles-hitdelay.md
                const isBallista = this.isBallista(rangedWeaponId);
                const baseDelay = 1 + Math.floor((3 + distance) / 6);
                // OSRS: Bows/crossbows use 1 + floor((3 + distance) / 6), ballista adds +1
                return Math.max(1, baseDelay + (isBallista ? 1 : 0));
            }

            case "melee":
            default:
                // OSRS: Melee hits are immediate (0 tick delay)
                return 0;
        }
    }

    /**
     * Determines if a weapon is a thrown weapon (darts, knives, throwing axes, javelins, chinchompas, blowpipe).
     * Thrown weapons use a different hit delay formula than bows/crossbows.
     * OSRS: hit delay = 1 + floor(distance / 6)
     */
    private isThrownWeapon(weaponId: number | undefined): boolean {
        if (!weaponId || weaponId <= 0) return false;
        // Complete list of thrown weapon IDs for OSRS parity
        const thrownWeapons = new Set([
            // Darts (bronze through amethyst)
            806, 807, 808, 809, 810, 811, 3093, 11230, 25849,
            // Throwing knives (bronze through dragon)
            864, 863, 865, 866, 867, 868, 869, 22804,
            // Throwing axes (bronze through dragon)
            800, 801, 802, 803, 804, 805, 20849,
            // Javelins (bronze through amethyst)
            825, 826, 827, 828, 829, 830, 19484, 25855,
            // Chinchompas
            10033, 10034, 11959,
            // Toktz-xil-ul (obsidian throwing rings)
            6522,
            // Toxic blowpipe (uses thrown formula)
            12926, 12924,
        ]);
        return thrownWeapons.has(weaponId);
    }

    /**
     * Determines if a weapon is a ballista.
     * Ballistas have +1 tick hit delay compared to normal bows/crossbows.
     * Reference: docs/projectiles-hitdelay.md
     */
    private isBallista(weaponId: number | undefined): boolean {
        if (!weaponId || weaponId <= 0) return false;
        // Light ballista and Heavy ballista
        return weaponId === 19478 || weaponId === 19481;
    }

    /**
     * Determines if a weapon is a dark bow.
     * OSRS: Dark bow fires 2 arrows, with the second hitting 1 tick after the first.
     * Reference: docs/projectiles-hitdelay.md
     */
    private isDarkBow(weaponId: number | undefined): boolean {
        if (!weaponId || weaponId <= 0) return false;
        // Dark bow and its painted variants
        return (
            weaponId === 11235 ||
            weaponId === 12765 ||
            weaponId === 12766 ||
            weaponId === 12767 ||
            weaponId === 12768
        );
    }

    /**
     * @deprecated Use computeHitDelay instead - this is kept for backwards compatibility
     */
    private pickHitDelay(_player: PlayerState, _npc?: NpcState): number {
        // OSRS parity: melee hits have a 1 tick delay
        return 1;
    }

    private getTileDistance(player: PlayerState, npc: NpcState): number {
        const px = player.tileX;
        const py = player.tileY;
        const minX = npc.tileX;
        const minY = npc.tileY;
        const size = Math.max(1, npc.size);
        const maxX = minX + size - 1;
        const maxY = minY + size - 1;
        const clampedX = Math.max(minX, Math.min(px, maxX));
        const clampedY = Math.max(minY, Math.min(py, maxY));
        return Math.max(Math.abs(clampedX - px), Math.abs(clampedY - py));
    }

    private estimateProjectileTravel(
        distance: number,
        params: ProjectileParams | undefined,
        explicit?: number,
    ): number | undefined {
        if (explicit !== undefined) {
            return Math.max(1, explicit);
        }
        const framesPerTick = Math.max(1, Math.round(SERVER_TICK_MS / 20));
        const tiles = Math.max(1, Math.round(distance));

        if (params) {
            const travelFramesExplicit = params.travelFrames;
            if (
                typeof travelFramesExplicit === "number" &&
                Number.isFinite(travelFramesExplicit) &&
                travelFramesExplicit > 0
            ) {
                return Math.max(1, Math.round(travelFramesExplicit / framesPerTick));
            }
            const ticksPerTile = params.ticksPerTile;
            if (
                typeof ticksPerTile === "number" &&
                Number.isFinite(ticksPerTile) &&
                ticksPerTile > 0
            ) {
                return Math.max(1, Math.round(tiles * ticksPerTile));
            }
            const model = params.lifeModel;
            if (model) {
                switch (model) {
                    case "linear5":
                        return Math.max(1, Math.round((tiles * 5) / framesPerTick));
                    case "linear5-clamped10":
                        return Math.max(1, Math.round(Math.max(10, tiles * 5) / framesPerTick));
                    case "javelin":
                        return Math.max(1, Math.round((tiles * 3 + 2) / framesPerTick));
                    case "magic":
                        return Math.max(1, Math.round((5 + 10 * tiles) / framesPerTick));
                }
            }
        }
        return undefined;
    }

    private getRangedProjectileParams(
        context: PlayerAttackContext,
    ): (ProjectileParams & { projectileId: number }) | undefined {
        const equip = context.player.appearance?.equip;
        if (!equip || equip.length === 0) return undefined;

        const weaponId = equip[EquipmentSlot.WEAPON];
        if (!(weaponId > 0)) return undefined;
        const weapon = getItemDefinition(weaponId);

        const ammoId = equip[EquipmentSlot.AMMO];
        const ammo = ammoId > 0 ? getItemDefinition(ammoId) : undefined;

        const profile = this.resolveRangedProjectileProfile(weapon, ammo);
        if (!profile) return undefined;

        const params = {
            ...buildProjectileParamsFromArchetype(profile.archetype),
        } as ProjectileParams & { projectileId: number };

        // delayFrames is in client frames (20ms each). At 600ms/tick, there are 30 frames per tick.
        const framesPerTick = 30;
        const delayFrames = PROJECTILE_ARCHETYPES[profile.archetype].delayFrames;
        params.startDelay = Math.max(0, Math.round(delayFrames / framesPerTick));
        params.projectileId = profile.projectileId;

        return params;
    }

    /**
     * Get projectile parameters for powered staff built-in spell.
     * Applies to Trident, Sanguinesti, Tumeken's Shadow, etc.
     */
    private getPoweredStaffProjectileParams(
        context: PlayerAttackContext,
    ): RangedProjectilePlan | undefined {
        const weaponId = this.getPlayerWeaponId(context.player);
        if (!(weaponId > 0)) {
            return undefined;
        }

        const poweredStaffData = getPoweredStaffSpellData(weaponId);
        if (!poweredStaffData) {
            return undefined;
        }

        // Use MAGIC archetype defaults
        const magicArchetype = PROJECTILE_ARCHETYPES.MAGIC;
        // delayFrames is in client frames (20ms each). At 600ms/tick, there are 30 frames per tick.
        // OSRS magic projectiles spawn quickly after the cast animation starts (~1-2 ticks).
        const framesPerTick = 30;
        const delayTicks = Math.round(magicArchetype.delayFrames / framesPerTick);

        return {
            projectileId: poweredStaffData.projectileId,
            startHeight: magicArchetype.startHeight,
            endHeight: magicArchetype.endHeight,
            slope: magicArchetype.angle,
            steepness: magicArchetype.steepness,
            startDelay: Math.max(0, delayTicks),
        };
    }

    private resolveRangedProjectileProfile(
        weapon?: ItemDefinition,
        ammo?: ItemDefinition,
    ): RangedProjectileProfile | undefined {
        const ammoName = (ammo?.name ?? "").toLowerCase();
        const weaponName = (weapon?.name ?? "").toLowerCase();
        const iface = weapon?.weaponInterface;
        const tokens = [ammoName, weaponName].filter((t) => t.length > 0);

        if (tokens.some((t) => t.includes("chinchompa"))) {
            return { archetype: "CHINCHOMPA", projectileId: this.pickChinchompaProjectile(tokens) };
        }

        if (
            tokens.some((t) => t.includes("javelin")) ||
            iface === "JAVELIN" ||
            iface === "BALLISTA" ||
            weaponName.includes("javelin")
        ) {
            return {
                archetype: "JAVELIN",
                projectileId: this.pickProjectileByKeywords(tokens, JAVELIN_PROJECTILES, 200),
            };
        }

        if (
            tokens.some((t) => t.includes("bolt")) ||
            iface === "CROSSBOW" ||
            iface === "KARILS_CROSSBOW"
        ) {
            return { archetype: "BOLT", projectileId: 27 };
        }

        if (
            tokens.some((t) => t.includes("dart")) ||
            iface === "DART" ||
            weaponName.includes("blowpipe")
        ) {
            return {
                archetype: "THROWN",
                projectileId: this.pickProjectileByKeywords(tokens, DART_PROJECTILES, 226),
            };
        }

        if (tokens.some((t) => t.includes("knife")) || iface === "KNIFE") {
            return {
                archetype: "THROWN",
                projectileId: this.pickProjectileByKeywords(tokens, KNIFE_PROJECTILES, 212),
            };
        }

        if (
            tokens.some((t) => t.includes("throwing axe") || t.includes("thrownaxe")) ||
            iface === "THROWNAXE"
        ) {
            return {
                archetype: "THROWN",
                projectileId: this.pickProjectileByKeywords(tokens, THROWING_AXE_PROJECTILES, 36),
            };
        }

        if (tokens.some((t) => t.includes("toktz-xil-ul")) || iface === "OBBY_RINGS") {
            return { archetype: "THROWN", projectileId: 442 };
        }

        // Crystal bow: Uses its own projectile (249) - no ammo needed
        if (tokens.some((t) => t.includes("crystal") && t.includes("bow"))) {
            return { archetype: "ARROW", projectileId: 249 };
        }

        // Craw's bow: Similar green aura projectile
        if (tokens.some((t) => t.includes("craw"))) {
            return { archetype: "ARROW", projectileId: 1574 };
        }

        // Bow of faerdhinen: Crystal-style projectile
        if (tokens.some((t) => t.includes("faerdhinen"))) {
            return { archetype: "ARROW", projectileId: 1888 };
        }

        if (tokens.some((t) => t.includes("arrow")) || weaponName.includes("bow")) {
            return {
                archetype: "ARROW",
                projectileId: this.pickProjectileByKeywords(tokens, ARROW_PROJECTILES, 10),
            };
        }

        return {
            archetype: "ARROW",
            projectileId: 10,
        };
    }

    private pickProjectileByKeywords(
        tokens: string[],
        entries: Array<{ keyword: string; id: number }>,
        fallback: number,
    ): number {
        for (const entry of entries) {
            if (tokens.some((token) => token.includes(entry.keyword))) {
                return entry.id;
            }
        }
        return fallback;
    }

    private pickChinchompaProjectile(tokens: string[]): number {
        if (tokens.some((t) => t.includes("black"))) return 1272;
        if (tokens.some((t) => t.includes("red"))) return 909;
        return 908;
    }

    private rollDamage(maxDamage: number): number {
        if (!(maxDamage > 0)) return 0;
        // OSRS: Successful hits roll 0 to maxHit inclusive
        return this.rng.nextInt(0, maxDamage + 1);
    }

    /**
     * Roll NPC damage using the same formula as player damage (0 to maxHit inclusive).
     * OSRS NPCs use the same damage rolling mechanics as players.
     */
    private rollNpcDamage(maxHit: number): number {
        if (!(maxHit > 0)) return 0;
        // OSRS: NPC damage rolls 0 to maxHit inclusive, same as players
        return this.rng.nextInt(0, maxHit + 1);
    }

    private getPlayerEquipment(player: PlayerState): number[] {
        return player.appearance?.equip ?? [];
    }

    private getEquippedAmmoId(player: PlayerState): number {
        const equip = this.getPlayerEquipment(player);
        return equip.length > 0 ? equip[EquipmentSlot.AMMO] : -1;
    }

    private getPlayerHitpoints(player: PlayerState): { current: number; max: number } {
        return {
            current: Math.max(0, player.getHitpointsCurrent()),
            max: Math.max(1, player.getHitpointsMax()),
        };
    }

    private getSlayerTaskInfo(player: PlayerState): SlayerTaskInfo {
        return player.getSlayerTaskInfo();
    }

    private buildTargetInfo(npc: NpcState): TargetInfo {
        // Use NPC's owned combat profile directly
        const profile = npc.combat;
        const species = profile.species.map((entry) => String(entry).toLowerCase());
        const has = (tag: string) => species.includes(tag);
        return {
            species,
            magicLevel: profile.magicLevel,
            isUndead: has("undead"),
            isDemon: has("demon"),
            isDragon: has("dragon"),
            isKalphite: has("kalphite"),
        };
    }

    /**
     * Resolve the NPC's max hit from profile or estimate from combat level.
     * In OSRS, NPC max hits are defined per-NPC in the cache/wiki data.
     *
     * OSRS NPC Max Hit Formula (melee):
     * effectiveStrength = strengthLevel + 8 + stanceBonus (NPCs typically +3 aggressive)
     * maxHit = floor(0.5 + effectiveStrength * (strengthBonus + 64) / 640)
     *
     * For NPCs without explicit strength bonus, assume strengthBonus = 0:
     * maxHit = floor(0.5 + effectiveStrength * 64 / 640)
     * maxHit = floor(0.5 + effectiveStrength / 10)
     */
    private resolveNpcMaxHit(profile: NpcCombatProfile | undefined, npc: NpcState): number {
        // Use explicit maxHit from profile if provided
        if (profile?.maxHit !== undefined && profile.maxHit > 0) {
            return profile.maxHit;
        }

        // Calculate from strength level using RSMod formula
        // RSMod: effectiveStrength = strengthLevel + 8 (no stance bonus for NPCs)
        if (profile?.strengthLevel !== undefined && profile.strengthLevel > 0) {
            const strengthLevel = profile.strengthLevel;
            const effectiveStrength = strengthLevel + 8;
            const strengthBonus = profile.strengthBonus ?? 0;
            const maxHit = Math.floor(0.5 + (effectiveStrength * (strengthBonus + 64)) / 640);
            return Math.max(1, maxHit);
        }

        // No cache/profile stats available - return minimal max hit.
        return 1;
    }

    private pickDefaultNpcHitDelay(
        npc: NpcState,
        player: PlayerState,
        _attackSpeed: number,
        attackType?: AttackType,
    ): number {
        const resolvedType = attackType ?? npc.getAttackType?.() ?? "melee";
        const distance = this.getTileDistance(player, npc);
        switch (resolvedType) {
            case "magic":
                // OSRS: 1 + floor((1 + distance) / 3)
                return Math.max(1, 1 + Math.floor((1 + distance) / 3));
            case "ranged":
                // OSRS: 1 + floor((3 + distance) / 6)
                return Math.max(1, 1 + Math.floor((3 + distance) / 6));
            case "melee":
            default:
                // NPC melee retaliation hit resolves 1 tick after swing.
                return 1;
        }
    }

    private computePlayerAttackProfile(context: PlayerAttackContext): {
        style: AttackStyle;
        attackRoll: number;
        maxHit: number;
        equipmentBonuses: number[];
    } {
        const equipmentBonuses = this.aggregatePlayerBonuses(context.player);
        const style = this.resolveAttackStyle(context.player, equipmentBonuses);
        const stanceBonus = this.resolveStanceBonuses(context.player, style);
        switch (style.kind) {
            case "ranged": {
                const effectiveLevel = this.computeEffectiveLevel(
                    this.getBoostedLevel(context.player, SkillId.Ranged),
                    this.getPrayerMultiplier(context.player, "ranged"),
                    stanceBonus.ranged ?? 0,
                );
                const attackBonus = equipmentBonuses[style.bonusIndex] ?? 0;
                const attackRoll = effectiveLevel * Math.max(0, attackBonus + 64);

                const effectiveStrength = this.computeEffectiveLevel(
                    this.getBoostedLevel(context.player, SkillId.Ranged),
                    this.getPrayerMultiplier(context.player, "ranged_strength"),
                    stanceBonus.rangedStrength ?? 0,
                );
                const rangedStrengthBonus = equipmentBonuses[RANGED_STRENGTH_INDEX] ?? 0;
                const maxHit = Math.floor(
                    0.5 + (effectiveStrength * Math.max(0, rangedStrengthBonus + 64)) / 640,
                );

                return { style, attackRoll, maxHit, equipmentBonuses };
            }
            case "magic": {
                const effectiveLevel = this.computeEffectiveLevel(
                    this.getBoostedLevel(context.player, SkillId.Magic),
                    this.getPrayerMultiplier(context.player, "magic"),
                    stanceBonus.magic ?? 0,
                );
                const attackBonus = equipmentBonuses[style.bonusIndex] ?? 0;
                const attackRoll = effectiveLevel * Math.max(0, attackBonus + 64);

                const magicDamagePct = equipmentBonuses[MAGIC_DAMAGE_INDEX] ?? 0;
                const baseDamage = this.resolveMagicBaseDamage(context.player, effectiveLevel);
                const maxHit = Math.floor(
                    Math.max(0, baseDamage) * (1 + Math.max(0, magicDamagePct) / 100),
                );

                return { style, attackRoll, maxHit, equipmentBonuses };
            }
            case "melee": {
                const effectiveAttack = this.computeEffectiveLevel(
                    this.getBoostedLevel(context.player, SkillId.Attack),
                    this.getPrayerMultiplier(context.player, "attack"),
                    stanceBonus.attack ?? 0,
                );
                const attackBonus = equipmentBonuses[style.bonusIndex] ?? 0;
                const attackRoll = effectiveAttack * Math.max(0, attackBonus + 64);

                const effectiveStrength = this.computeEffectiveLevel(
                    this.getBoostedLevel(context.player, SkillId.Strength),
                    this.getPrayerMultiplier(context.player, "strength"),
                    stanceBonus.strength ?? 0,
                );
                const meleeStrengthBonus = equipmentBonuses[MELEE_STRENGTH_INDEX] ?? 0;
                const maxHit = Math.floor(
                    0.5 + (effectiveStrength * Math.max(0, meleeStrengthBonus + 64)) / 640,
                );

                return { style, attackRoll, maxHit, equipmentBonuses };
            }
        }
    }

    private computeNpcDefenceRoll(
        context: PlayerAttackContext,
        attackProfile: {
            style: AttackStyle;
            equipmentBonuses: number[];
        } & { attackRoll: number; maxHit: number },
    ): number {
        const npc = context.npc;
        // Use NPC's owned combat profile directly
        const profile = npc.combat;
        const defenceLevel = profile.defenceLevel;
        const magicLevel = profile.magicLevel;
        const rangedLevel = profile.rangedLevel;

        const defenceBonus = this.resolveNpcDefenceBonus(profile, attackProfile.style.bonusIndex);

        switch (attackProfile.style.kind) {
            case "magic": {
                const effectiveMagicDefence = this.computeMagicDefenceEffectiveLevel(
                    defenceLevel,
                    magicLevel,
                );
                return effectiveMagicDefence * Math.max(0, defenceBonus + 64);
            }
            case "ranged": {
                const effectiveRangedDefence = this.computeEffectiveLevel(defenceLevel, 1, 0);
                return effectiveRangedDefence * Math.max(0, defenceBonus + 64);
            }
            case "melee": {
                const effectiveDefence = this.computeEffectiveLevel(defenceLevel, 1, 0);
                return effectiveDefence * Math.max(0, defenceBonus + 64);
            }
        }
    }

    private computeHitChance(attackRoll: number, defenceRoll: number): number {
        if (attackRoll <= 0) return 0;
        if (defenceRoll <= 0) return 1;
        // RSMod parity: Use > (strictly greater)
        // Formula: attack > defence: 1 - (defence + 2) / (2 * (attack + 1))
        //          attack <= defence: attack / (2 * (defence + 1))
        if (attackRoll > defenceRoll) {
            return 1 - (defenceRoll + 2) / (2 * (attackRoll + 1));
        }
        return attackRoll / (2 * (defenceRoll + 1));
    }

    private aggregatePlayerBonuses(player: PlayerState): number[] {
        const bonuses = new Array<number>(14).fill(0);
        const equip = player.appearance?.equip;
        if (!equip || equip.length === 0) return bonuses;
        for (const itemId of equip) {
            if (!(itemId > 0)) continue;
            const def = getItemDefinition(itemId);
            const itemBonuses = def?.bonuses;
            if (!itemBonuses) continue;
            itemBonuses.forEach((value, idx) => {
                bonuses[idx] = (bonuses[idx] ?? 0) + value;
            });
        }
        return bonuses;
    }

    private resolveStanceBonuses(
        _player: PlayerState,
        style: AttackStyle,
    ): {
        attack?: number;
        strength?: number;
        defence?: number;
        ranged?: number;
        rangedStrength?: number;
        magic?: number;
    } {
        switch (style.kind) {
            case "melee": {
                switch (style.mode) {
                    case "accurate":
                        return { attack: 3 };
                    case "aggressive":
                        return { strength: 3 };
                    case "controlled":
                        return { attack: 1, strength: 1, defence: 1 };
                    case "defensive":
                        return { defence: 3 };
                    default:
                        return {};
                }
            }
            case "ranged": {
                // OSRS ranged stance bonuses:
                // Accurate: +3 ranged (used for BOTH attack roll AND max hit)
                // Rapid: no bonus (speed bonus handled elsewhere)
                // Longrange: +1 ranged, +3 defence (and +2 attack range)
                switch (style.mode) {
                    case "accurate":
                        return { ranged: 3, rangedStrength: 3 };
                    case "rapid":
                        return {}; // No stat bonus, speed bonus handled in pickAttackSpeed
                    case "longrange":
                        return { ranged: 1, rangedStrength: 1, defence: 3 };
                    default:
                        return {};
                }
            }
            case "magic": {
                if (style.mode === "defensive") {
                    return { defence: 3 };
                }
                return {};
            }
            default:
                return {};
        }
    }

    private resolveAttackStyle(player: PlayerState, bonuses: number[]): AttackStyle {
        const category = player.combatWeaponCategory;
        const styleSlot = Math.max(0, player.combatStyleSlot);
        const autocastEnabled = player.autocastEnabled;
        const hasCombatSpell = player.combatSpellId > 0;
        const mappedAttackType = player.getCurrentAttackType?.();
        const mappedMeleeBonusIndex = player.getCurrentMeleeBonusIndex?.();

        // OSRS parity: Magic weapons (staves) have hybrid combat styles.
        // - Style 0 (Bash/Pound) = melee attack (crush)
        // - Style 1+ with autocast enabled = magic attack
        // If autocast is OFF, the melee styles should do melee attacks (punching).
        if (mappedAttackType === "magic" && hasCombatSpell) {
            const autocastMode = player.autocastMode;
            const mode: MagicStyleMode =
                autocastMode === "defensive_autocast"
                    ? "defensive"
                    : autocastEnabled
                    ? MAGIC_STYLE_BY_SLOT[Math.min(styleSlot, MAGIC_STYLE_BY_SLOT.length - 1)] ??
                      "accurate"
                    : "accurate";
            return { kind: "magic", mode, bonusIndex: AttackBonusIndex.Magic };
        }
        if (mappedAttackType === "ranged") {
            const mode =
                RANGED_STYLE_BY_SLOT[Math.min(styleSlot, RANGED_STYLE_BY_SLOT.length - 1)] ??
                "accurate";
            return { kind: "ranged", mode, bonusIndex: AttackBonusIndex.Ranged };
        }
        if (mappedAttackType === "melee") {
            // Use weapon-specific style data for correct XP mode
            const weaponId = player.combatWeaponItemId ?? -1;
            const meleeMode = this.getMeleeStyleMode(weaponId, styleSlot);
            const bonusIndex =
                mappedMeleeBonusIndex !== undefined
                    ? mappedMeleeBonusIndex
                    : this.pickBestMeleeBonusIndex(bonuses);
            return { kind: "melee", mode: meleeMode, bonusIndex };
        }

        if (MAGIC_WEAPON_CATEGORIES.has(category)) {
            // Powered staves (Trident, Tumeken's Shadow, etc.) ALWAYS use magic attacks
            // They have built-in spells and don't require autocast or combatSpellId
            if (POWERED_STAFF_CATEGORIES.has(category)) {
                // Map style slot to magic mode for powered staves
                // Style 0 = Accurate, Style 1 = Accurate, Style 2 = Longrange (defensive)
                const mode: MagicStyleMode = styleSlot === 2 ? "defensive" : "accurate";
                return { kind: "magic", mode, bonusIndex: AttackBonusIndex.Magic };
            }
            // Only use magic if autocast is enabled with a valid spell
            if (autocastEnabled && hasCombatSpell) {
                const autocastMode = player.autocastMode;
                const mode: MagicStyleMode =
                    autocastMode === "defensive_autocast" ? "defensive" : "accurate";
                return { kind: "magic", mode, bonusIndex: AttackBonusIndex.Magic };
            }
            // Autocast disabled or no spell selected - fall through to melee (e.g., "pound" style)
        }
        if (RANGED_WEAPON_CATEGORIES.has(category)) {
            const mode =
                RANGED_STYLE_BY_SLOT[Math.min(styleSlot, RANGED_STYLE_BY_SLOT.length - 1)] ??
                "accurate";
            return { kind: "ranged", mode, bonusIndex: AttackBonusIndex.Ranged };
        }

        // Use weapon-specific style data for correct XP mode
        const weaponId = player.combatWeaponItemId ?? -1;
        const meleeMode = this.getMeleeStyleMode(weaponId, styleSlot);
        // Pick the best melee bonus index based on player's attack bonuses
        const bonusIndex =
            mappedMeleeBonusIndex !== undefined
                ? mappedMeleeBonusIndex
                : this.pickBestMeleeBonusIndex(bonuses);
        return { kind: "melee", mode: meleeMode, bonusIndex };
    }

    /**
     * Get the melee style mode for XP calculation based on weapon-specific combat style.
     * This correctly handles weapons with non-standard style layouts (e.g., whips have
     * 3 styles: accurate/controlled/defensive instead of the typical 4-style layout).
     */
    private getMeleeStyleMode(weaponId: number, styleSlot: number): MeleeStyleMode {
        if (weaponId > 0) {
            const combatStyle = getCombatStyle(weaponId, styleSlot);
            if (combatStyle) {
                // Map XpMode to MeleeStyleMode
                switch (combatStyle.xpMode) {
                    case XpMode.ATTACK:
                        return "accurate";
                    case XpMode.STRENGTH:
                        return "aggressive";
                    case XpMode.SHARED:
                        return "controlled";
                    case XpMode.DEFENCE:
                        return "defensive";
                }
            }
        }
        // Fallback to generic mapping for unarmed or unknown weapons
        return (
            MELEE_STYLE_BY_SLOT[Math.min(styleSlot, MELEE_STYLE_BY_SLOT.length - 1)] ?? "accurate"
        );
    }

    private resolveMagicBaseDamage(player: PlayerState, effectiveMagicLevel: number): number {
        // Check for autocast spell first
        const activeSpellId = this.getActiveSpellId(player);
        if (activeSpellId !== undefined) {
            if (activeSpellId === MAGIC_DART_SPELL_ID) {
                const boosted = this.getBoostedLevel(player, SkillId.Magic);
                return Math.max(0, 10 + Math.floor(boosted / 10));
            }
            const data = getSpellData(activeSpellId);
            if (data) return Math.max(0, data.baseMaxHit);
        }

        // Check for powered staff built-in spell
        const weaponId = this.getPlayerWeaponId(player);
        if (weaponId > 0) {
            const poweredStaffData = getPoweredStaffSpellData(weaponId);
            if (poweredStaffData) {
                const boostedMagic = this.getBoostedLevel(player, SkillId.Magic);
                return calculatePoweredStaffBaseDamage(
                    boostedMagic,
                    poweredStaffData.maxHitFormula,
                );
            }
        }

        // Fallback: generic magic-level-based damage
        return Math.max(0, Math.floor(effectiveMagicLevel / 3));
    }

    /**
     * Get the player's equipped weapon item ID.
     * Uses combatWeaponItemId which is set by wsServer.refreshCombatWeaponCategory.
     */
    private getPlayerWeaponId(player: PlayerState): number {
        const weaponId = player.combatWeaponItemId;
        return weaponId > 0 ? weaponId : 0;
    }

    private getActiveSpellId(player: PlayerState): number | undefined {
        const spellId = player.combatSpellId;
        if (spellId > 0) return spellId;
        return undefined;
    }

    private pickBestMeleeBonusIndex(
        bonuses: number[],
    ): AttackBonusIndex.Stab | AttackBonusIndex.Slash | AttackBonusIndex.Crush {
        const meleeIndices: AttackBonusIndex[] = [
            AttackBonusIndex.Stab,
            AttackBonusIndex.Slash,
            AttackBonusIndex.Crush,
        ];
        let bestIdx = AttackBonusIndex.Slash;
        let bestVal = -Infinity;
        for (const idx of meleeIndices) {
            const val = bonuses[idx] ?? 0;
            if (val > bestVal) {
                bestVal = val;
                bestIdx = idx;
            }
        }
        return bestIdx as AttackBonusIndex.Stab | AttackBonusIndex.Slash | AttackBonusIndex.Crush;
    }

    /** Get player's boosted skill level. Public for use by PlayerCombatManager. */
    getBoostedLevel(player: PlayerState, skill: SkillId): number {
        const entry = player.getSkill(skill);
        const base = entry.baseLevel;
        const boost = entry.boost;
        const result = base + boost;
        return Number.isFinite(result) && result > 0 ? result : 1;
    }

    private computeEffectiveLevel(
        boostedLevel: number,
        prayerMultiplier: number,
        stanceBonus: number,
        additive: number = 8,
    ): number {
        const prayed = Math.floor(boostedLevel * Math.max(0, prayerMultiplier));
        const total = prayed + stanceBonus + additive;
        return Math.max(1, total);
    }

    private getPrayerMultiplier(player: PlayerState, stat: PrayerStat): number {
        const prayers: Set<string> | undefined = (() => {
            const active = player.activePrayers;
            if (active instanceof Set) return active as Set<string>;
            if (Array.isArray(active)) return new Set(active as string[]);
            return undefined;
        })();
        if (!prayers || prayers.size === 0) return 1;
        const table = PRAYER_BONUS[stat];
        if (!table) return 1;
        let multiplier = 1;
        for (const prayer of prayers) {
            const bonus = table.get(prayer);
            if (bonus && bonus > multiplier) {
                multiplier = bonus;
            }
        }
        return multiplier;
    }

    private computeMagicDefenceEffectiveLevel(defenceLevel: number, magicLevel: number): number {
        // OSRS parity: Magic defence uses 70% magic, 30% defence (not reversed!)
        // Formula: floor(magic * 0.7 + defence * 0.3) + 8
        // Reference: docs/combat-formulas.md
        return Math.max(1, Math.floor(magicLevel * 0.7 + defenceLevel * 0.3) + 8);
    }

    private resolveNpcDefenceBonus(
        profile: NpcCombatProfileResolved,
        index: AttackBonusIndex,
    ): number {
        switch (index) {
            case AttackBonusIndex.Stab:
                return profile.defenceStab;
            case AttackBonusIndex.Slash:
                return profile.defenceSlash;
            case AttackBonusIndex.Crush:
                return profile.defenceCrush;
            case AttackBonusIndex.Magic:
                return profile.defenceMagic;
            case AttackBonusIndex.Ranged:
                return profile.defenceRanged;
            default:
                return 0;
        }
    }

    /**
     * Get player's defence bonus against a specific attack type.
     */
    /** Get player's defence bonus vs attack type. Public for use by PlayerCombatManager. */
    getPlayerDefenceBonus(player: PlayerState, attackType: AttackType): number {
        const bonuses = this.aggregatePlayerBonuses(player);
        let defenceIndex: number;
        switch (attackType) {
            case "magic":
                defenceIndex = DEFENCE_BONUS_INDEX[AttackBonusIndex.Magic];
                break;
            case "ranged":
                defenceIndex = DEFENCE_BONUS_INDEX[AttackBonusIndex.Ranged];
                break;
            case "melee":
            default:
                // For melee, use slash defence as default (most common)
                defenceIndex = DEFENCE_BONUS_INDEX[AttackBonusIndex.Slash];
                break;
        }
        return bonuses[defenceIndex] ?? 0;
    }

    /**
     * Compute player's defence roll against an NPC attack.
     * OSRS parity: Magic defence uses 70% magic, 30% defence.
     */
    private computePlayerDefenceRoll(
        defenceLevel: number,
        magicLevel: number,
        defenceBonus: number,
        attackType: AttackType,
    ): number {
        let effectiveDefence: number;
        if (attackType === "magic") {
            // OSRS: Magic defence = floor(magic * 0.7 + defence * 0.3) + 8
            effectiveDefence = Math.floor(magicLevel * 0.7 + defenceLevel * 0.3) + 8;
        } else {
            // Melee/ranged defence = defence level + 8
            effectiveDefence = defenceLevel + 8;
        }
        return effectiveDefence * Math.max(0, defenceBonus + 64);
    }
}
