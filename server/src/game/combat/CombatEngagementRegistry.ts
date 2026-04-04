import type { PlayerVsNpcCombatState } from "./CombatState";
import type { CombatStateMachine } from "./CombatStateMachine";

export interface CombatEngagementEntry {
    playerId: number;
    state: PlayerVsNpcCombatState;
    stateMachine: CombatStateMachine;
}

/**
 * Stores active player-vs-NPC combat engagements keyed by player PID.
 * Mirrors deob-style manager ownership where per-entity state is centralized.
 */
export class CombatEngagementRegistry {
    private readonly byPlayerId = new Map<number, CombatEngagementEntry>();

    get(playerId: number): CombatEngagementEntry | undefined {
        return this.byPlayerId.get(playerId);
    }

    getState(playerId: number): PlayerVsNpcCombatState | undefined {
        return this.byPlayerId.get(playerId)?.state;
    }

    getStateMachine(playerId: number): CombatStateMachine | undefined {
        return this.byPlayerId.get(playerId)?.stateMachine;
    }

    set(
        playerId: number,
        state: PlayerVsNpcCombatState,
        stateMachine: CombatStateMachine,
    ): CombatEngagementEntry {
        const normalizedPlayerId = playerId;
        const entry: CombatEngagementEntry = {
            playerId: normalizedPlayerId,
            state,
            stateMachine,
        };
        this.byPlayerId.set(normalizedPlayerId, entry);
        return entry;
    }

    delete(playerId: number): void {
        this.byPlayerId.delete(playerId);
    }

    clear(): void {
        this.byPlayerId.clear();
    }

    keys(): IterableIterator<number> {
        return this.byPlayerId.keys();
    }

    entriesSortedByPid(): Array<[number, CombatEngagementEntry]> {
        return Array.from(this.byPlayerId.entries()).sort(([a], [b]) => a - b);
    }
}
