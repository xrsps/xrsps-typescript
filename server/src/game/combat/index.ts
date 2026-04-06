/**
 * Combat Module Index
 *
 * Exports all combat-related types, classes, and utilities.
 */

// Core types
export type { AttackType } from "./AttackType";
export { normalizeAttackType } from "./AttackType";
export {
    DEFAULT_NPC_MAGIC_RANGE,
    DEFAULT_NPC_MELEE_RANGE,
    DEFAULT_NPC_RANGED_RANGE,
    MAGIC_WEAPON_CATEGORIES,
    resolveNpcAttackRange,
    resolveNpcAttackType,
    POWERED_STAFF_CATEGORIES,
    RANGED_WEAPON_CATEGORIES,
    SALAMANDER_WEAPON_CATEGORY,
    resolvePlayerAttackReach,
    resolvePlayerAttackType,
    type NpcCombatRuleState,
    type PlayerCombatRuleState,
    type PlayerAttackReachOptions,
} from "./CombatRules";

// Combat state types
export {
    CombatPhase,
    type PlayerCombatConfig,
    type CombatTimingState,
    type NpcEngagementState,
    type PlayerVsNpcCombatState,
    type NpcCombatState,
    type CombatStateTransition,
    type CombatStateMachineContext,
    type SpecialAttackConfig,
    type SpecialAttackEffects,
    type HitsplatResult,
    extractPlayerCombatConfig,
    createInitialTimingState,
    createInitialEngagementState,
    createPlayerVsNpcCombatState,
    DEFAULT_AGGRO_HOLD_TICKS,
} from "./CombatState";

// State machine
export { CombatStateMachine, createCombatStateMachine } from "./CombatStateMachine";
export { CombatEngagementRegistry, type CombatEngagementEntry } from "./CombatEngagementRegistry";

// Effect applicator
export {
    CombatEffectApplicator,
    combatEffectApplicator,
    type SkillSyncCallback,
} from "./CombatEffectApplicator";

// Player combat manager
export {
    PlayerCombatManager,
    createPlayerCombatManager,
    type PlayerCombatManagerContext,
    type CombatTickResult,
    type CombatEngagementInfo,
} from "./PlayerCombatManager";

// Hit effects
export {
    HITMARK_BLOCK,
    HITMARK_DAMAGE,
    HITMARK_POISON,
    HITMARK_DISEASE,
    HITMARK_VENOM,
    HITMARK_REFLECT,
    HITMARK_PRAYER_SPLASH,
    HITMARK_REGEN,
    HITMARK_HEAL,
    HitEffectType,
    type HitEffectConfig,
    type StatusHitsplat,
    resolveHitEffect,
    DEFAULT_POISON_INTERVAL_TICKS,
    DEFAULT_VENOM_INTERVAL_TICKS,
    DEFAULT_DISEASE_INTERVAL_TICKS,
    DEFAULT_REGEN_INTERVAL_TICKS,
} from "./HitEffects";

// Combat XP
export {
    calculateCombatXp,
    getDefaultStyleMode,
    type AttackType as CombatXpAttackType,
    type StyleMode,
    type MeleeStyleMode,
    type RangedStyleMode,
    type MagicStyleMode,
    type CombatXpAward,
} from "./CombatXp";

// Combat Action (RSMod parity: PawnPathAction + combat cycle)
export {
    areBordering,
    areDiagonal,
    areOverlapping,
    hasDirectMeleeReach,
    hasDirectMeleePath,
    isWithinAttackRange,
    walkToAttackRange,
    combatCycle,
    createCombatGenerator,
    CombatCycleResult,
    type CombatCycleContext,
} from "./CombatAction";

// Special attacks
export {
    getSpecialAttack,
    canUseSpecialAttack,
    consumeSpecialEnergy,
    restoreSpecialEnergy,
    registerSpecialAttackProvider,
    getSpecialAttackProvider,
    type SpecialAttackDef,
    type SpecialAttackProvider,
} from "./SpecialAttackRegistry";

// Combat formulas
export {
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
    registerCombatFormulaProvider,
    getCombatFormulaProvider,
    type AttackerStats,
    type DefenderStats,
    type MaxHitParams,
    type CombatFormulaProvider,
} from "./CombatFormulas";

// Combat style sequences
export {
    getMeleeAttackSequenceForCategory,
    registerCombatStyleSequenceProvider,
    getCombatStyleSequenceProvider,
    type CombatStyleSlot,
    type CombatStyleSequenceProvider,
} from "./CombatStyleSequences";

// Skill configuration
export {
    registerSkillConfiguration,
    getSkillConfiguration,
    getSkillRestoreIntervalTicks,
    getSkillBoostDecayIntervalTicks,
    getHitpointRegenIntervalTicks,
    getHitpointOverhealDecayIntervalTicks,
    getPreserveDecayMultiplier,
    type SkillConfiguration,
} from "./SkillConfiguration";

// Equipment bonuses
export {
    calculateEquipmentBonuses,
    registerEquipmentBonusProvider,
    getEquipmentBonusProvider,
    type TargetInfo,
    type SlayerTaskInfo,
    type EquipmentBonusResult,
    type EquipmentBonusProvider,
} from "./EquipmentBonuses";

// Ammo system
export {
    AmmoSystem,
    getEnchantedBoltEffect,
    doesBoltEffectActivate,
    type EnchantedBoltEffect,
} from "./AmmoSystem";

// Poison/Venom system
// Note: Tick processing is in NpcState.processPoison/processVenom
// PoisonVenomSystem provides apply/cure utilities and item constants
export { PoisonVenomSystem, poisonVenomSystem } from "./PoisonVenomSystem";

// Multi-combat zones
export { MultiCombatSystem, multiCombatSystem } from "./MultiCombatZones";

// Damage tracking for loot
export {
    DamageTracker,
    damageTracker,
    type DamageType,
    type PlayerDamageSummary,
    type DropEligibility,
    calculateXpShare,
} from "./DamageTracker";

// Boss combat scripts
export {
    BossScript,
    createBossScript,
    registerBossScript,
    getBossScript,
    type BossPhase,
    type BossSpecialAttack,
    type BossMechanic,
} from "./BossCombatScript";

// NPC Combat AI
export { NpcCombatAI, npcCombatAI, type AggroTarget } from "./NpcCombatAI";

// Unified combat manager
export {
    CombatManager,
    combatManager,
    calculateFullAttack,
    type AttackResult,
    type AttackEffect,
} from "./CombatIntegration";
