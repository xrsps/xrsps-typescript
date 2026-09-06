import type { TickFrame } from "../../../network/wsServerTypes";
import { NpcState } from "../../npc";
import { PlayerState } from "../../player";
import type { AttackType } from "../AttackType";
import type { EnchantedBoltEffect } from "../AmmoSystem";
import { combatEffectApplicator } from "../CombatEffectApplicator";
import { HITMARK_BLOCK, HITMARK_DAMAGE, HITMARK_POISON } from "../HitEffects";
import type { CombatAttack } from "../model/CombatAttack";
import { type CombatEntityRef, CombatEntityType } from "../model/CombatEntityRef";
import { CombatAttributes } from "../state/CombatAttributes";
import type { CombatEntity } from "./CombatTargetResolver";

export const DeferredHitsplatType = Object.freeze({
    Normal: "normal",
    Block: "block",
    Poison: "poison",
} as const);

export type DeferredHitsplatType = (typeof DeferredHitsplatType)[keyof typeof DeferredHitsplatType];

export interface PendingCombatHit {
    readonly id: number;
    readonly attack: CombatAttack;
    readonly source: CombatEntityRef;
    readonly target: CombatEntityRef;
    readonly damage: number;
    readonly maxHit: number;
    readonly landed: boolean;
    readonly hitsplatType: DeferredHitsplatType;
    readonly attackType: AttackType;
    readonly revealClock: number;
    readonly profileId: string;
    /** Keeps this hit's impact audio/effects while omitting the profile graphic. */
    readonly suppressProfileImpactGraphic?: boolean;
    /** Per-hit sound selected when the attack was queued. */
    readonly impactSoundIdOverride?: number;
    /** Enchanted bolt effect rolled when this projectile was fired. */
    readonly enchantedBoltEffect?: EnchantedBoltEffect;
}

export type PendingCombatHitInput = Omit<PendingCombatHit, "id">;

export interface AppliedCombatHit {
    readonly pending: PendingCombatHit;
    readonly source?: CombatEntity;
    readonly target: CombatEntity;
    readonly amount: number;
    readonly style: number;
    readonly hpCurrent: number;
    readonly hpMax: number;
    readonly appliedClock: number;
}

export interface DeferredHitQueueOptions {
    resolveEntity(reference: CombatEntityRef): CombatEntity | undefined;
    transformDamage?(
        pending: PendingCombatHit,
        target: CombatEntity,
        source: CombatEntity | undefined,
    ): number;
    /** Return true to keep a lethally-hit NPC alive at one hitpoint. */
    onNpcLethalHit?(event: {
        pending: PendingCombatHit;
        npc: NpcState;
        source: CombatEntity | undefined;
        proposedDamage: number;
        style: number;
        hitpointsBefore: number;
        appliedClock: number;
    }): boolean;
    onHitApplied?(hit: AppliedCombatHit, frame: TickFrame): void;
}

/** Absolute-map-clock scheduler for projectile and delayed melee hits. */
export class DeferredHitQueue {
    private readonly pendingHits: PendingCombatHit[] = [];
    private nextHitId = 1;

    constructor(private readonly options: DeferredHitQueueOptions) {}

    enqueue(input: PendingCombatHitInput): PendingCombatHit {
        const pending = Object.freeze({
            ...input,
            id: this.nextHitId++,
            damage: this.nonNegativeInteger(input.damage, "damage"),
            maxHit: this.nonNegativeInteger(input.maxHit, "max hit"),
            revealClock: this.mapClock(input.revealClock),
        });

        let low = 0;
        let high = this.pendingHits.length;
        while (low < high) {
            const middle = (low + high) >>> 1;
            const existing = this.pendingHits[middle];
            if (
                existing.revealClock < pending.revealClock ||
                (existing.revealClock === pending.revealClock && existing.id < pending.id)
            ) {
                low = middle + 1;
            } else {
                high = middle;
            }
        }
        this.pendingHits.splice(low, 0, pending);
        return pending;
    }

    processTick(currentMapClock: number, frame: TickFrame): readonly AppliedCombatHit[] {
        const clock = this.mapClock(currentMapClock);
        let dueCount = 0;
        while (
            dueCount < this.pendingHits.length &&
            this.pendingHits[dueCount].revealClock <= clock
        ) {
            dueCount++;
        }
        if (dueCount === 0) return [];

        const due = this.pendingHits.splice(0, dueCount);
        const applied: AppliedCombatHit[] = [];
        for (const pending of due) {
            const target = this.options.resolveEntity(pending.target);
            if (!target || !this.isAlive(target, clock)) continue;

            const source = this.options.resolveEntity(pending.source);
            if (target instanceof PlayerState) {
                if (!target.canBeAttacked()) continue;
                if (source instanceof PlayerState &&
                    source.gamemode.canAttackPlayer?.(source, target) === false) continue;
            }
            const requestedDamage =
                pending.hitsplatType === DeferredHitsplatType.Block
                    ? 0
                    : (this.options.transformDamage?.(pending, target, source) ?? pending.damage);
            let damage = this.nonNegativeInteger(requestedDamage, "transformed damage");
            const style = this.resolveStyle(pending.hitsplatType);
            if (target instanceof NpcState) {
                const hitpointsBefore = target.getHitpoints();
                if (
                    hitpointsBefore > 0 &&
                    damage >= hitpointsBefore &&
                    this.options.onNpcLethalHit?.({
                        pending,
                        npc: target,
                        source,
                        proposedDamage: damage,
                        style,
                        hitpointsBefore,
                        appliedClock: clock,
                    }) === true
                ) {
                    damage = Math.max(0, hitpointsBefore - 1);
                }
            }
            const result =
                target instanceof PlayerState
                    ? combatEffectApplicator.applyPlayerHitsplat(
                          target,
                          style,
                          damage,
                          clock,
                          pending.maxHit,
                      )
                    : combatEffectApplicator.applyNpcHitsplat(
                          target,
                          style,
                          damage,
                          clock,
                          pending.maxHit,
                      );

            const hit: AppliedCombatHit = Object.freeze({
                pending,
                source,
                target,
                amount: result.amount,
                style: result.style,
                hpCurrent: result.hpCurrent,
                hpMax: result.hpMax,
                appliedClock: clock,
            });
            applied.push(hit);

            frame.hitsplats.push({
                targetType: target instanceof PlayerState ? "player" : "npc",
                targetId: target.id,
                damage: result.amount,
                style: result.style,
                sourceType: pending.source.type === CombatEntityType.Player ? "player" : "npc",
                sourcePlayerId:
                    pending.source.type === CombatEntityType.Player ? pending.source.id : undefined,
                hpCurrent: result.hpCurrent,
                hpMax: result.hpMax,
                tick: clock,
            });
            this.options.onHitApplied?.(hit, frame);
        }
        // Profile effects can schedule a same-cycle companion hitsplat (for
        // example Saradomin's Lightning after its successful melee strike).
        // Drain those immediately so both components retain one OSRS hit tick.
        const chained = this.processTick(clock, frame);
        return Object.freeze([...applied, ...chained]);
    }

    cancelTarget(target: CombatEntityRef): number {
        const before = this.pendingHits.length;
        for (let index = this.pendingHits.length - 1; index >= 0; index--) {
            const pendingTarget = this.pendingHits[index].target;
            if (pendingTarget.type === target.type && pendingTarget.id === target.id) {
                this.pendingHits.splice(index, 1);
            }
        }
        return before - this.pendingHits.length;
    }

    size(): number {
        return this.pendingHits.length;
    }

    snapshot(): readonly PendingCombatHit[] {
        return Object.freeze([...this.pendingHits]);
    }

    private isAlive(entity: CombatEntity, currentMapClock: number): boolean {
        if (entity.combatAttributes.get(CombatAttributes.IS_DEAD)) return false;
        if (entity instanceof PlayerState) {
            return entity.skillSystem.getHitpointsCurrent() > 0;
        }
        return entity.getHitpoints() > 0 && !entity.isDead(currentMapClock);
    }

    private resolveStyle(type: DeferredHitsplatType): number {
        switch (type) {
            case DeferredHitsplatType.Block:
                return HITMARK_BLOCK;
            case DeferredHitsplatType.Poison:
                return HITMARK_POISON;
            case DeferredHitsplatType.Normal:
            default:
                return HITMARK_DAMAGE;
        }
    }

    private mapClock(value: number): number {
        if (!Number.isFinite(value)) {
            throw new RangeError(`Deferred hit reveal clock must be finite; received ${value}`);
        }
        return Math.trunc(value);
    }

    private nonNegativeInteger(value: number, field: string): number {
        if (!Number.isFinite(value)) {
            throw new RangeError(`Deferred hit ${field} must be finite; received ${value}`);
        }
        return Math.max(0, Math.trunc(value));
    }
}
