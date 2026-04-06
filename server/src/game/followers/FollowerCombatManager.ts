import { PathService } from "../../pathfinding/PathService";
import {
    hasDirectMeleeReach,
    isWithinAttackRange,
    walkToAttackRange,
} from "../combat/CombatAction";
import { NpcState } from "../npc";
import { NpcManager } from "../npcManager";
import { PlayerState } from "../player";
import type { ActiveFollowerSnapshot } from "./FollowerManager";
import {
    type FollowerCombatDefinition,
    getCombatCompanionDefinition,
} from "./followerCombatDefinitions";

type CompanionCombatState = {
    npcId: number;
    currentTargetNpcId?: number;
    nextAttackTick: number;
};

interface PlayerLookup {
    getById(id: number): PlayerState | undefined;
}

interface ActiveFollowerProvider {
    forEachActiveFollower(visitor: (follower: ActiveFollowerSnapshot) => void): void;
}

export type FollowerAttackRequest = {
    owner: PlayerState;
    companion: NpcState;
    target: NpcState;
    currentTick: number;
    combat: FollowerCombatDefinition;
};

type FollowerAttackListener = (request: FollowerAttackRequest) => boolean;

export class FollowerCombatManager {
    private readonly stateByPlayerId = new Map<number, CompanionCombatState>();

    constructor(
        private readonly followerProvider: ActiveFollowerProvider,
        private readonly npcManager: NpcManager,
        private readonly players: PlayerLookup,
        private readonly pathService: PathService,
        private readonly onFollowerAttack?: FollowerAttackListener,
    ) {}

    resetPlayer(playerId: number): void {
        this.stateByPlayerId.delete(playerId | 0);
    }

    tick(currentTick: number): void {
        const activePlayerIds = new Set<number>();

        this.followerProvider.forEachActiveFollower((follower) => {
            activePlayerIds.add(follower.playerId);
            this.tickFollowerCombat(follower, currentTick);
        });

        for (const playerId of Array.from(this.stateByPlayerId.keys())) {
            if (!activePlayerIds.has(playerId)) {
                this.stateByPlayerId.delete(playerId);
            }
        }
    }

    private tickFollowerCombat(follower: ActiveFollowerSnapshot, currentTick: number): void {
        if (currentTick < (follower.followReadyTick ?? 0)) {
            this.stateByPlayerId.delete(follower.playerId);
            return;
        }

        const player = this.players.getById(follower.playerId);
        const companion = this.npcManager.getById(follower.npcId);
        if (!player || !companion || companion.isDead(currentTick)) {
            this.stateByPlayerId.delete(follower.playerId);
            return;
        }

        const combat = getCombatCompanionDefinition(follower.itemId, follower.npcTypeId);
        if (!combat) {
            this.stateByPlayerId.delete(follower.playerId);
            return;
        }

        const state = this.getOrCreateState(follower);
        const target = this.resolveCombatTarget(player, follower, currentTick);
        if (!target) {
            state.currentTargetNpcId = undefined;
            return;
        }

        this.tickCompanionCombat(state, combat, player, companion, target, currentTick);
    }

    private getOrCreateState(follower: ActiveFollowerSnapshot): CompanionCombatState {
        const existing = this.stateByPlayerId.get(follower.playerId);
        if (existing && existing.npcId === follower.npcId) {
            return existing;
        }
        const next: CompanionCombatState = {
            npcId: follower.npcId,
            currentTargetNpcId: undefined,
            nextAttackTick: 0,
        };
        this.stateByPlayerId.set(follower.playerId, next);
        return next;
    }

    private resolveCombatTarget(
        player: PlayerState,
        follower: ActiveFollowerSnapshot,
        currentTick: number,
    ): NpcState | undefined {
        const target = player.combat.getCombatTarget();
        if (!(target instanceof NpcState)) {
            return undefined;
        }
        if (target.id === follower.npcId) {
            return undefined;
        }

        const resolved = this.npcManager.getById(target.id);
        if (!resolved || resolved.isDead(currentTick) || resolved.level !== player.level) {
            return undefined;
        }
        if (!resolved.isInCombat(currentTick) || resolved.getCombatTargetPlayerId() !== player.id) {
            return undefined;
        }
        return resolved;
    }

    private tickCompanionCombat(
        state: CompanionCombatState,
        combat: FollowerCombatDefinition,
        owner: PlayerState,
        companion: NpcState,
        target: NpcState,
        currentTick: number,
    ): void {
        if (state.currentTargetNpcId !== target.id) {
            state.currentTargetNpcId = target.id;
            companion.clearPath();
        }

        companion.setInteraction("npc", target.id);

        const attackRange = Math.max(1, combat.attackRange ?? 1);
        const inRange = isWithinAttackRange(companion, target, attackRange);
        const canAttackNow =
            combat.attackType === "melee" || attackRange <= 1
                ? inRange && hasDirectMeleeReach(companion, target, this.pathService)
                : inRange;

        if (canAttackNow) {
            companion.clearPath();
            if (currentTick < state.nextAttackTick) {
                return;
            }
            if (
                this.onFollowerAttack?.({
                    owner,
                    companion,
                    target,
                    currentTick,
                    combat,
                })
            ) {
                state.nextAttackTick = currentTick + Math.max(1, combat.attackSpeed);
            }
            return;
        }

        if (companion.hasPath()) {
            return;
        }

        walkToAttackRange(companion, target, this.pathService, attackRange);
    }
}
