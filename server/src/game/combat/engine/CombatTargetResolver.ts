import { NpcState } from "../../npc";
import { PlayerState } from "../../player";
import { type CombatEntityRef, CombatEntityType } from "../model/CombatEntityRef";
import { CombatAttributes } from "../state/CombatAttributes";

export type CombatEntity = PlayerState | NpcState;

export interface CombatEntityRegistry {
    getPlayer(id: number): PlayerState | undefined;
    getNpc(id: number): NpcState | undefined;
}

export type CombatTargetInvalidReason =
    | "not_found"
    | "dead"
    | "interaction_blocked"
    | "same_entity"
    | "different_plane"
    | "different_world_view"
    | "out_of_chase_range"
    | "unattackable";

export type CombatTargetResolution =
    | { readonly valid: true; readonly entity: CombatEntity }
    | { readonly valid: false; readonly reason: CombatTargetInvalidReason };

/** Resolves stable combat references and owns entity-level validity checks. */
export class CombatTargetResolver {
    constructor(private readonly registry: CombatEntityRegistry) {}

    resolve(reference: CombatEntityRef, currentMapClock: number): CombatTargetResolution {
        const entity =
            reference.type === CombatEntityType.Player
                ? this.registry.getPlayer(reference.id)
                : this.registry.getNpc(reference.id);

        if (!entity) {
            return { valid: false, reason: "not_found" };
        }
        if (!this.isAlive(entity, currentMapClock)) {
            return { valid: false, reason: "dead" };
        }
        if (entity instanceof PlayerState && !entity.canBeAttacked()) {
            return { valid: false, reason: "interaction_blocked" };
        }
        if (entity instanceof NpcState && entity.isPlayerFollower()) {
            return { valid: false, reason: "unattackable" };
        }
        return { valid: true, entity };
    }

    validateAttacker(attacker: CombatEntity, currentMapClock: number): CombatTargetResolution {
        if (!this.isAlive(attacker, currentMapClock)) {
            return { valid: false, reason: "dead" };
        }
        if (
            currentMapClock <
            attacker.combatAttributes.get(CombatAttributes.STUN_UNTIL_CLOCK)
        ) {
            return { valid: false, reason: "interaction_blocked" };
        }
        if (attacker instanceof PlayerState && !attacker.canAttack()) {
            return { valid: false, reason: "interaction_blocked" };
        }
        if (attacker instanceof NpcState && attacker.isRecoveringToSpawn()) {
            return { valid: false, reason: "interaction_blocked" };
        }
        return { valid: true, entity: attacker };
    }

    validatePair(attacker: CombatEntity, target: CombatEntity): CombatTargetInvalidReason | null {
        if (attacker === target) {
            return "same_entity";
        }
        if (attacker instanceof PlayerState && target instanceof PlayerState &&
            attacker.gamemode.canAttackPlayer?.(attacker, target) === false) {
            return "unattackable";
        }
        if (attacker.level !== target.level) {
            return "different_plane";
        }
        if (attacker.worldViewId !== target.worldViewId) {
            return "different_world_view";
        }
        if (attacker instanceof NpcState && target instanceof PlayerState) {
            const currentDistance = Math.max(
                Math.abs(target.tileX - attacker.tileX),
                Math.abs(target.tileY - attacker.tileY),
            );
            if (
                attacker.isBeyondRetreatInteractionRange(target.tileX, target.tileY) ||
                currentDistance > 32
            ) {
                return "out_of_chase_range";
            }
        }
        return null;
    }

    isAlive(entity: CombatEntity, currentMapClock: number): boolean {
        if (entity.combatAttributes.get(CombatAttributes.IS_DEAD)) {
            return false;
        }
        if (entity instanceof PlayerState) {
            return entity.skillSystem.getHitpointsCurrent() > 0;
        }
        return entity.getHitpoints() > 0 && !entity.isDead(currentMapClock);
    }
}
