/**
 * Boss Combat Script Framework
 *
 * Provides a structured way to implement complex boss mechanics:
 * - Phase transitions
 * - Special attacks with cooldowns
 * - Mechanic telegraphing
 * - Death animations and loot handling
 * - Multi-phase boss support
 *
 * Gamemodes register boss script classes via registerBossScript().
 * Core code creates instances via createBossScript().
 */
import type { Actor } from "../actor";
import { NpcState } from "../npc";
import { PlayerState } from "../player";
import { type DropEligibility, damageTracker, multiCombatSystem } from "../scripts/types";

type Npc = NpcState;
type Player = PlayerState;

export interface BossPhase {
    name: string;
    hpThreshold?: number;
    hpThresholdPercent?: number;
    attackPatterns: string[];
    mechanics?: string[];
    onEnter?: (boss: BossScript) => void;
    onExit?: (boss: BossScript) => void;
}

export interface BossSpecialAttack {
    name: string;
    cooldown: number;
    animation: number;
    projectile?: number;
    minDamage: number;
    maxDamage: number;
    style: "melee" | "ranged" | "magic" | "typeless";
    aoeRadius?: number;
    telegraphTicks?: number;
    execute?: (boss: BossScript, target: Actor) => void;
    condition?: (boss: BossScript) => boolean;
}

export interface BossMechanic {
    name: string;
    interval: number;
    tick: (boss: BossScript, tickCount: number) => void;
    shouldActivate?: (boss: BossScript) => boolean;
}

interface BossState {
    currentPhase: number;
    phaseTransitioning: boolean;
    attackCooldowns: Map<string, number>;
    mechanicTimers: Map<string, number>;
    lastAttackTick: number;
    spawnTick: number;
    customData: Map<string, any>;
}

export abstract class BossScript {
    protected npc: Npc;
    protected target: Actor | null = null;
    protected phases: BossPhase[] = [];
    protected specialAttacks: Map<string, BossSpecialAttack> = new Map();
    protected mechanics: Map<string, BossMechanic> = new Map();
    protected state: BossState;
    protected currentTick: number = 0;

    constructor(npc: Npc) {
        this.npc = npc;
        this.state = {
            currentPhase: 0,
            phaseTransitioning: false,
            attackCooldowns: new Map(),
            mechanicTimers: new Map(),
            lastAttackTick: 0,
            spawnTick: 0,
            customData: new Map(),
        };

        this.initialize();
    }

    protected abstract initialize(): void;

    tick(currentTick: number): void {
        this.currentTick = currentTick;
        this.checkPhaseTransition();
        this.processMechanics();
        this.updateCooldowns();
        if (this.target && !this.state.phaseTransitioning) {
            this.processCombat();
        }
    }

    onAttacked(attacker: Actor, damage: number): void {
        if (!this.target) {
            this.target = attacker;
        }
        this.onDamageTaken(attacker, damage);
    }

    protected onDamageTaken(attacker: Actor, damage: number): void {}

    protected checkPhaseTransition(): void {
        if (this.state.phaseTransitioning) return;
        if (this.state.currentPhase >= this.phases.length - 1) return;

        const nextPhase = this.phases[this.state.currentPhase + 1];
        const currentHp = this.npc.getHitpoints();
        const maxHp = this.npc.getMaxHitpoints();

        let shouldTransition = false;

        if (nextPhase.hpThresholdPercent !== undefined) {
            shouldTransition = currentHp <= maxHp * (nextPhase.hpThresholdPercent / 100);
        } else if (nextPhase.hpThreshold !== undefined) {
            shouldTransition = currentHp <= nextPhase.hpThreshold;
        }

        if (shouldTransition) {
            this.transitionToPhase(this.state.currentPhase + 1);
        }
    }

    protected transitionToPhase(phaseIndex: number): void {
        const oldPhase = this.phases[this.state.currentPhase];
        const newPhase = this.phases[phaseIndex];

        this.state.phaseTransitioning = true;

        if (oldPhase.onExit) {
            oldPhase.onExit(this);
        }

        this.state.currentPhase = phaseIndex;

        if (newPhase.onEnter) {
            newPhase.onEnter(this);
        }

        this.onPhaseTransition(phaseIndex, newPhase);

        this.state.phaseTransitioning = false;
    }

    protected onPhaseTransition(phaseIndex: number, phase: BossPhase): void {}

    protected processMechanics(): void {
        const currentPhase = this.phases[this.state.currentPhase];
        const activeMechanics = currentPhase?.mechanics || [];

        for (const mechanicName of activeMechanics) {
            const mechanic = this.mechanics.get(mechanicName);
            if (!mechanic) continue;

            if (mechanic.shouldActivate && !mechanic.shouldActivate(this)) {
                continue;
            }

            let timer = this.state.mechanicTimers.get(mechanicName) ?? 0;

            if (mechanic.interval === 0 || timer >= mechanic.interval) {
                mechanic.tick(this, this.currentTick);
                timer = 0;
            } else {
                timer++;
            }

            this.state.mechanicTimers.set(mechanicName, timer);
        }
    }

    protected updateCooldowns(): void {
        for (const [attackName, cooldown] of this.state.attackCooldowns) {
            if (cooldown > 0) {
                this.state.attackCooldowns.set(attackName, cooldown - 1);
            }
        }
    }

    protected processCombat(): void {
        if (!this.target) return;

        if (!this.isValidTarget(this.target)) {
            this.target = this.findNewTarget();
            if (!this.target) return;
        }

        if (!this.canAttack()) return;

        const attack = this.selectAttack();
        if (attack) {
            this.executeAttack(attack);
        }
    }

    protected isValidTarget(target: Actor): boolean {
        if (target instanceof PlayerState) {
            return true;
        }
        return target !== null;
    }

    protected findNewTarget(): Actor | null {
        return multiCombatSystem.getLastAttacker(this.npc, this.currentTick);
    }

    protected canAttack(): boolean {
        const attackSpeed = this.getAttackSpeed();
        return this.currentTick - this.state.lastAttackTick >= attackSpeed;
    }

    protected getAttackSpeed(): number {
        return 4;
    }

    protected selectAttack(): BossSpecialAttack | null {
        const currentPhase = this.phases[this.state.currentPhase];
        const availablePatterns = currentPhase?.attackPatterns || [];

        const shuffled = [...availablePatterns].sort(() => Math.random() - 0.5);

        for (const patternName of shuffled) {
            const attack = this.specialAttacks.get(patternName);
            if (!attack) continue;

            const cooldown = this.state.attackCooldowns.get(patternName) ?? 0;
            if (cooldown > 0) continue;

            if (attack.condition && !attack.condition(this)) continue;

            return attack;
        }

        return null;
    }

    protected executeAttack(attack: BossSpecialAttack): void {
        if (!this.target) return;

        this.state.attackCooldowns.set(attack.name, attack.cooldown);
        this.state.lastAttackTick = this.currentTick;

        if (attack.execute) {
            attack.execute(this, this.target);
        } else {
            this.defaultAttackExecution(attack, this.target);
        }
    }

    protected defaultAttackExecution(attack: BossSpecialAttack, target: Actor): void {
        const damage = Math.floor(
            Math.random() * (attack.maxDamage - attack.minDamage + 1) + attack.minDamage,
        );

        if (attack.telegraphTicks && attack.telegraphTicks > 0) {
            // Schedule delayed damage
        }

        if (attack.aoeRadius && attack.aoeRadius > 0) {
            // Apply to all targets in radius
        } else {
            this.dealDamage(target, damage, attack.style);
        }
    }

    protected dealDamage(target: Actor, damage: number, style: string): void {}

    onDeath(): void {
        const eligibility = damageTracker.getDropEligibility(this.npc);
        this.processDrops(eligibility);
        damageTracker.clearNpc(this.npc);
        this.onBossDeath(eligibility);
    }

    protected processDrops(eligibility: DropEligibility): void {}

    protected onBossDeath(eligibility: DropEligibility): void {}

    protected getData<T>(key: string): T | undefined {
        return this.state.customData.get(key) as T;
    }

    protected setData<T>(key: string, value: T): void {
        this.state.customData.set(key, value);
    }

    protected addPhase(phase: BossPhase): void {
        this.phases.push(phase);
    }

    protected addSpecialAttack(attack: BossSpecialAttack): void {
        this.specialAttacks.set(attack.name, attack);
    }

    protected addMechanic(mechanic: BossMechanic): void {
        this.mechanics.set(mechanic.name, mechanic);
    }

    getCurrentPhase(): BossPhase | null {
        return this.phases[this.state.currentPhase] || null;
    }

    getNpc(): Npc {
        return this.npc;
    }
}

const bossScriptRegistry = new Map<number, new (npc: Npc) => BossScript>();

export function registerBossScript(npcId: number, scriptClass: new (npc: Npc) => BossScript): void {
    bossScriptRegistry.set(npcId, scriptClass);
}

export function getBossScript(npcId: number): (new (npc: Npc) => BossScript) | undefined {
    return bossScriptRegistry.get(npcId);
}

export function createBossScript(npc: Npc): BossScript | null {
    const ScriptClass = bossScriptRegistry.get(npc.typeId);
    if (ScriptClass) {
        return new ScriptClass(npc);
    }
    return null;
}
