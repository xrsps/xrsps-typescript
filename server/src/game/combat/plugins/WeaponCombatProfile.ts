import type { CombatHitEvaluation } from "../engine/CombatHitEvaluator";
import type { CombatEntity } from "../engine/CombatTargetResolver";
import type { AppliedCombatHit } from "../engine/DeferredHitQueue";
import type { CombatAttack } from "../model/CombatAttack";
import type { WeaponSpecialAttackTraitOverrides } from "./WeaponSpecialAttackScript";

export interface WeaponProjectileProfile {
    readonly id: number;
    readonly startHeight?: number;
    readonly endHeight?: number;
    readonly slope?: number;
    readonly steepness?: number;
    readonly startDelayTicks?: number;
    readonly travelTimeTicks?: number;
    readonly lifeModel?: "linear5" | "linear5-clamped10" | "javelin" | "magic";
}

export interface WeaponGraphicProfile {
    readonly id: number;
    readonly height?: number;
    readonly delayTicks?: number;
}

export interface WeaponCombatContext {
    readonly attack: CombatAttack;
    readonly attacker: CombatEntity;
    readonly target: CombatEntity;
    readonly currentMapClock: number;
    readonly distanceTiles: number;
}

export const SpecialAttackTiming = Object.freeze({
    Standard: "standard",
    Instant: "instant",
} as const);

export type SpecialAttackTiming = (typeof SpecialAttackTiming)[keyof typeof SpecialAttackTiming];

export interface WeaponSpecialAttack extends WeaponSpecialAttackTraitOverrides {
    readonly energyCostPercent: number;
    readonly hitCount: number;
    readonly accuracyMultiplier: number;
    readonly damageMultiplier: number;
    /** A utility special that consumes energy without producing an attack roll. */
    readonly skipAttack?: boolean;
    readonly enchantedBoltEffectChanceMultiplier?: number;
    /** Number of copies of the weapon projectile to render for this attack. */
    readonly projectileCount?: number;
    /** Explicit projectile tracks for multi-projectile attacks. */
    readonly projectiles?: readonly WeaponProjectileProfile[];
    /** Release delay for each projectile copy, measured from the animation start. */
    readonly projectileReleaseDelaysTicks?: readonly number[];
    /** Extra reveal delays for each hit, relative to the normal hit delay. */
    readonly hitDelayTicks?: readonly number[];
    readonly attackAnimation?: number;
    readonly castGraphic?: WeaponGraphicProfile;
    /** Graphic displayed on the target when this special is activated. */
    readonly targetGraphic?: WeaponGraphicProfile;
    readonly attackSoundId?: number;
    /** Plays multiple simultaneous launch sounds for layered weapon effects. */
    readonly attackSoundIds?: readonly number[];
    /** Limits the profile impact graphic to one hitsplat in a multi-hit attack. */
    readonly impactGraphicHitIndex?: number;
    /** Per-hitsplat impact sounds for multi-hit special attacks. */
    readonly impactSoundIds?: readonly number[];
}

export type WeaponProfileValue<T> = T | ((context: WeaponCombatContext) => T | undefined);

export interface WeaponCombatProfile {
    /** Stable plugin identifier used by deferred hits to recover their behavior. */
    readonly id: string;
    readonly itemIds?: readonly number[];
    readonly categoryIds?: readonly number[];
    readonly attackAnimation?: WeaponProfileValue<number>;
    readonly castGraphic?: WeaponProfileValue<WeaponGraphicProfile>;
    readonly impactGraphic?: WeaponProfileValue<WeaponGraphicProfile>;
    readonly splashGraphic?: WeaponProfileValue<WeaponGraphicProfile>;
    readonly projectile?: WeaponProfileValue<WeaponProjectileProfile>;
    readonly attackSoundId?: WeaponProfileValue<number>;
    readonly impactSoundId?: WeaponProfileValue<number>;
    readonly travelDelayTicks?: WeaponProfileValue<number>;
    readonly specialAttackEnergyCost?: number;
    readonly specialAttackTiming?: SpecialAttackTiming;

    /** Builds a custom roll plan for an ordinary attack without consuming energy. */
    readonly handleNormalAttack?: (
        attacker: CombatEntity,
        target: CombatEntity,
        attack: CombatAttack,
    ) => WeaponSpecialAttack | null;

    /** Builds the weapon's special roll/visual plan for one prepared swing. */
    readonly handleSpecialAttack?: (
        attacker: CombatEntity,
        target: CombatEntity,
        attack: CombatAttack,
    ) => WeaponSpecialAttack | null;

    /** Runs before the core visual and accuracy pipeline. */
    readonly onAttack?: (context: WeaponCombatContext) => void;

    /** Allows a plugin to modify a completed roll without replacing the core evaluator. */
    readonly transformHit?: (
        evaluation: CombatHitEvaluation,
        context: WeaponCombatContext,
    ) => CombatHitEvaluation;

    /** Runs after the hit is rolled and placed in the deferred queue. */
    readonly onHitEvaluated?: (
        evaluation: CombatHitEvaluation,
        context: WeaponCombatContext,
    ) => void;

    /** Runs when the deferred hit actually changes the target's hitpoints. */
    readonly onHitApplied?: (hit: AppliedCombatHit, context: WeaponCombatContext) => void;
}

export function resolveWeaponProfileValue<T>(
    value: WeaponProfileValue<T> | undefined,
    context: WeaponCombatContext,
): T | undefined {
    return typeof value === "function"
        ? (value as (ctx: WeaponCombatContext) => T | undefined)(context)
        : value;
}
