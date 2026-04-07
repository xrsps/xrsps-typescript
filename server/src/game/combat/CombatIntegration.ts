/**
 * Combat Integration Module
 *
 * Provides a unified interface for all combat subsystems:
 * - Special attacks
 * - Equipment bonuses
 * - Ammo consumption
 * - Poison/venom
 * - Multi-combat zones
 * - Damage tracking
 * - Boss scripts
 */
import type { Actor } from "../actor";
import { NpcState } from "../npc";
import { PlayerState } from "../player";
import {
    AmmoSystem,
    EnchantedBoltEffect,
    doesBoltEffectActivate,
    getEnchantedBoltEffect,
} from "./AmmoSystem";
import type { AttackType } from "./AttackType";
import {
    BossScript,
    createBossScript,
    getBossScript,
    registerBossScript,
} from "./BossScriptFramework";
import {
    DamageTracker,
    DamageType,
    DropEligibility,
    PlayerDamageSummary,
    damageTracker,
} from "./DamageTracker";
import {
    EquipmentBonusResult,
    SlayerTaskInfo,
    TargetInfo,
    calculateEquipmentBonuses,
} from "./EquipmentBonusProvider";
import { MultiCombatSystem, multiCombatSystem } from "./MultiCombatZones";
import { PoisonVenomSystem, poisonVenomSystem } from "./PoisonVenomSystem";
// Import all combat subsystems
import {
    SpecialAttackDef,
    canUseSpecialAttack,
    consumeSpecialEnergy,
    getSpecialAttack,
    restoreSpecialEnergy,
} from "./SpecialAttackProvider";

// Type aliases for compatibility
type Npc = NpcState;
type Player = PlayerState;

// Re-export for convenience
export {
    // Special attacks
    getSpecialAttack,
    canUseSpecialAttack,
    consumeSpecialEnergy,
    restoreSpecialEnergy,
    SpecialAttackDef,

    // Equipment bonuses
    calculateEquipmentBonuses,
    TargetInfo,
    SlayerTaskInfo,
    EquipmentBonusResult,

    // Ammo
    AmmoSystem,
    getEnchantedBoltEffect,
    doesBoltEffectActivate,
    EnchantedBoltEffect,

    // Poison/Venom
    PoisonVenomSystem,
    poisonVenomSystem,

    // Multi-combat
    MultiCombatSystem,
    multiCombatSystem,

    // Damage tracking
    DamageTracker,
    damageTracker,
    DamageType,
    PlayerDamageSummary,
    DropEligibility,

    // Boss scripts
    BossScript,
    createBossScript,
    registerBossScript,
    getBossScript,
};

/**
 * Result of a complete attack calculation
 */
export interface AttackResult {
    // Core attack result
    damage: number;
    maxHit: number;
    hitLanded: boolean;
    attackType: AttackType;

    // Special attack info (if used)
    specialUsed: boolean;
    specialAttack?: SpecialAttackDef;

    // Effects to apply
    effects: AttackEffect[];

    // Ammo consumed
    ammoConsumed: boolean;
    ammoId?: number;

    // Projectile info (for ranged/magic)
    projectileId?: number;
}

/**
 * Effect to apply after attack
 */
export interface AttackEffect {
    type: "poison" | "venom" | "freeze" | "heal" | "drain" | "spec_restore" | "stun";
    value?: number;
    duration?: number;
    target: "attacker" | "defender";
}

/**
 * Combat Manager - orchestrates all combat subsystems
 */
export class CombatManager {
    private ammoSystem: AmmoSystem;
    private activeBossScripts: Map<Npc, BossScript> = new Map();

    constructor() {
        this.ammoSystem = new AmmoSystem();
    }

    /**
     * Initialize combat for an NPC (creates boss script if applicable)
     */
    initializeNpcCombat(npc: Npc): void {
        const script = createBossScript(npc);
        if (script) {
            this.activeBossScripts.set(npc, script);
        }
    }

    /**
     * Process combat tick for all active boss scripts
     */
    tickBossScripts(currentTick: number): void {
        for (const [npc, script] of this.activeBossScripts) {
            script.tick(currentTick);
        }
    }

    /**
     * Check if player can attack target
     */
    canAttack(
        attacker: Player,
        defender: Actor,
        currentTick: number,
    ): { allowed: boolean; reason?: string } {
        return multiCombatSystem.canAttack(attacker, defender, currentTick);
    }

    /**
     * Record attack engagement
     */
    recordAttack(
        attacker: Player,
        defender: Npc,
        damage: number,
        damageType: DamageType,
        currentTick: number,
    ): void {
        // Record for multi-combat tracking
        multiCombatSystem.recordEngagement(attacker, defender, currentTick);

        // Record for damage/loot tracking
        damageTracker.recordDamage(attacker, defender, damage, damageType, currentTick);
    }

    /**
     * Get drop eligibility when NPC dies
     */
    getDropEligibility(npc: Npc): DropEligibility {
        return damageTracker.getDropEligibility(npc);
    }

    /**
     * Handle NPC death
     */
    handleNpcDeath(npc: Npc): void {
        // Get boss script if exists
        const script = this.activeBossScripts.get(npc);
        if (script) {
            script.onDeath();
            this.activeBossScripts.delete(npc);
        }

        // Clean up tracking
        multiCombatSystem.removeActor(npc);
        damageTracker.clearNpc(npc);
    }

    /**
     * Process special attack
     */
    processSpecialAttack(
        player: Player,
        weaponId: number,
        target: Actor,
    ): { success: boolean; attack?: SpecialAttackDef } {
        const special = getSpecialAttack(weaponId);
        if (!special) {
            return { success: false };
        }

        const currentEnergy = player.specEnergy.getPercent();
        if (!canUseSpecialAttack(weaponId, currentEnergy)) {
            return { success: false };
        }

        const newEnergy = consumeSpecialEnergy(weaponId, currentEnergy);
        player.specEnergy.setPercent(newEnergy);

        return { success: true, attack: special };
    }

    /**
     * Process ammo for ranged attack
     */
    processAmmo(
        player: Player,
        weaponId: number,
        ammoId: number,
        hasAvasDevice: boolean,
        avasDeviceType: "assembler" | "accumulator" | "attractor" | null,
    ): { consumed: boolean; boltEffect?: EnchantedBoltEffect } {
        // Check compatibility
        if (!this.ammoSystem.isAmmoCompatible(weaponId, ammoId)) {
            return { consumed: false };
        }

        // Check if ammo is consumed
        const consumed = this.ammoSystem.shouldConsumeAmmo(
            ammoId,
            hasAvasDevice,
            avasDeviceType,
            () => Math.random(),
        );

        // Get bolt effect if applicable
        const boltEffect = getEnchantedBoltEffect(ammoId);

        return { consumed, boltEffect };
    }

    /**
     * Apply poison to target
     */
    applyPoison(target: Actor, damage: number): void {
        poisonVenomSystem.applyPoison(target, damage);
    }

    /**
     * Apply venom to target
     */
    applyVenom(target: Actor): void {
        poisonVenomSystem.applyVenom(target);
    }

    /**
     * Process poison/venom ticks for all affected actors
     */
    processPoisonVenomTicks(currentTick: number): void {
        poisonVenomSystem.processTick(currentTick);
    }

    /**
     * Cure poison/venom
     */
    curePoison(target: Actor, cureVenomToo: boolean = false): void {
        if (cureVenomToo) {
            poisonVenomSystem.cureVenom(target);
        } else {
            poisonVenomSystem.curePoison(target);
        }
    }

    /**
     * Check if position is in multi-combat zone
     */
    isMultiCombat(x: number, y: number, plane: number): boolean {
        return multiCombatSystem.isMultiCombat(x, y, plane);
    }

    /**
     * Get zone name for display
     */
    getZoneName(x: number, y: number, plane: number): string | null {
        return multiCombatSystem.getZoneName(x, y, plane);
    }

    /**
     * Periodic cleanup (call every minute or so)
     */
    cleanup(currentTick: number): void {
        damageTracker.cleanup(currentTick);
    }
}

// Singleton instance
export const combatManager = new CombatManager();

/**
 * Calculate complete attack with all bonuses
 */
export function calculateFullAttack(
    player: Player,
    target: Npc,
    equipment: number[],
    attackStyle: "melee" | "ranged" | "magic",
    isSpecialAttack: boolean,
    weaponId: number,
    slayerTask: SlayerTaskInfo,
    playerHp: { current: number; max: number },
    playerMagicLevel: number,
    targetInfo: TargetInfo,
    spellId?: number,
): EquipmentBonusResult {
    // Calculate base equipment bonuses
    let bonuses = calculateEquipmentBonuses(
        equipment,
        attackStyle,
        targetInfo,
        slayerTask,
        playerHp.current,
        playerHp.max,
        playerMagicLevel,
        spellId,
    );

    // Apply special attack modifiers if applicable
    if (isSpecialAttack) {
        const special = getSpecialAttack(weaponId);
        if (special) {
            // Apply special attack multipliers
            bonuses = {
                ...bonuses,
                accuracyMultiplier: bonuses.accuracyMultiplier * special.accuracyMultiplier,
                damageMultiplier: bonuses.damageMultiplier * special.damageMultiplier,
            };
        }
    }

    return bonuses;
}
