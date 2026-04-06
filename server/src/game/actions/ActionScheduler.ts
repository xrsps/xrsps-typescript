import { logger } from "../../utils/logger";
import { PlayerState } from "../player";
import {
    ActionInterruptionRegistry,
    defaultInterruptionRegistry,
} from "./ActionInterruptionRegistry";
import {
    ActionEffect,
    ActionEnqueueResult,
    ActionExecutionResult,
    ActionKind,
    ActionPerformer,
    ActionRequest,
    PlayerActionState,
    ScheduledAction,
} from "./types";

const DEFAULT_DELAY = 0;
const MAX_QUEUE_LENGTH = 50; // Prevent action queue flooding

export class ActionScheduler {
    private performer: ActionPerformer;
    private playerLookup = new Map<number, PlayerState>();
    private playerStates = new Map<number, PlayerActionState>();
    private nextActionId = 1;
    private priorityProvider?: (player: PlayerState) => number;
    private modalChecker?: (playerId: number) => boolean;
    private interruptionRegistry: ActionInterruptionRegistry;

    constructor(performer: ActionPerformer, registry?: ActionInterruptionRegistry) {
        this.performer = performer;
        this.interruptionRegistry = registry ?? defaultInterruptionRegistry;
    }

    /**
     * Sets a priority provider for global same-tick ordering.
     * Lower numbers execute first.
     */
    setPriorityProvider(provider?: (player: PlayerState) => number): void {
        this.priorityProvider = provider;
    }

    /**
     * OSRS parity: Sets a callback to check if player has modal open.
     * When modal is open, skill actions are paused (not executed, kept in queue).
     */
    setModalChecker(checker?: (playerId: number) => boolean): void {
        this.modalChecker = checker;
    }

    registerPlayer(player: PlayerState): void {
        this.playerLookup.set(player.id, player);
        if (!this.playerStates.has(player.id)) {
            this.playerStates.set(player.id, {
                queue: [],
                groupLocks: new Map(),
            });
        }
    }

    unregisterPlayer(playerId: number): void {
        this.playerLookup.delete(playerId);
        this.playerStates.delete(playerId);
    }

    cancelActions(playerId: number, predicate: (action: ScheduledAction) => boolean): number {
        const state = this.playerStates.get(playerId);
        if (!state) return 0;
        const removed: ScheduledAction[] = [];
        state.queue = state.queue.filter((action) => {
            if (predicate(action)) {
                removed.push(action);
                return false;
            }
            return true;
        });
        if (removed.length === 0) return 0;
        if (state.queue.length > 1) {
            state.queue.sort((a, b) => a.executeTick - b.executeTick || a.id - b.id);
        }
        const touched = new Set<string>();
        for (const action of removed) {
            for (const group of action.groups) touched.add(group);
        }
        if (touched.size > 0) {
            for (const group of touched) {
                let maxUnlock = -Infinity;
                for (const action of state.queue) {
                    if (!action.groups.includes(group)) continue;
                    const unlock = action.executeTick + Math.max(0, action.cooldownTicks);
                    if (unlock > maxUnlock) maxUnlock = unlock;
                }
                if (maxUnlock === -Infinity) state.groupLocks.delete(group);
                else state.groupLocks.set(group, maxUnlock);
            }
        }
        return removed.length;
    }

    clearActionsInGroup(playerId: number, group: string): number {
        return this.cancelActions(playerId, (action) => action.groups.includes(group));
    }

    hasPendingActionInGroup(playerId: number, group: string): boolean {
        const state = this.playerStates.get(playerId);
        if (!state) return false;
        return state.queue.some((action) => action.groups.includes(group));
    }

    requestAction<K extends ActionKind>(
        playerId: number,
        req: ActionRequest<K>,
        currentTick: number,
    ): ActionEnqueueResult {
        const state = this.playerStates.get(playerId);
        const player = this.playerLookup.get(playerId);
        if (!state || !player) {
            return { ok: false, reason: "player not registered" };
        }
        if (state.queue.length >= MAX_QUEUE_LENGTH) {
            return { ok: false, reason: "action queue full" };
        }
        const groups = req.groups ? req.groups.map((g) => String(g)) : [];
        const delay = req.delayTicks !== undefined ? Math.max(0, req.delayTicks) : DEFAULT_DELAY;
        let executeTick = currentTick + delay;
        for (const group of groups) {
            const earliest = state.groupLocks.get(group);
            if (earliest !== undefined) {
                executeTick = Math.max(executeTick, earliest);
            }
        }
        const scheduled: ScheduledAction<K> = {
            id: this.nextActionId++,
            kind: req.kind,
            executeTick,
            data: req.data,
            groups,
            cooldownTicks:
                req.cooldownTicks !== undefined ? Math.max(0, req.cooldownTicks) : 0,
            requestTick: currentTick,
        };
        state.queue.push(scheduled);
        state.queue.sort((a, b) => a.executeTick - b.executeTick || a.id - b.id);
        for (const group of groups) {
            const reserveUntil = executeTick + Math.max(0, scheduled.cooldownTicks);
            const existing = state.groupLocks.get(group);
            state.groupLocks.set(group, Math.max(existing ?? reserveUntil, reserveUntil));
        }
        return { ok: true, actionId: scheduled.id };
    }

    processTick(tick: number): ActionEffect[] {
        const effects: ActionEffect[] = [];
        const maturedGlobal: Array<{
            player: PlayerState;
            state: PlayerActionState;
            action: ScheduledAction;
        }> = [];

        for (const [playerId, state] of this.playerStates.entries()) {
            const player = this.playerLookup.get(playerId);
            if (!player) continue;

            // OSRS parity: Check if player has modal open (level-up dialog, etc.)
            const hasModal = this.modalChecker?.(playerId) ?? false;

            const matured: ScheduledAction[] = [];
            const pending: ScheduledAction[] = [];
            for (const action of state.queue) {
                if (action.executeTick <= tick) {
                    // If modal is open and this is a skill action, defer it (keep in queue)
                    if (hasModal && this.isSkillAction(action)) {
                        pending.push(action);
                    } else {
                        matured.push(action);
                    }
                } else {
                    pending.push(action);
                }
            }
            state.queue = pending;
            for (const action of matured) maturedGlobal.push({ player, state, action });
        }

        const priorityOf = (p: PlayerState) => {
            try {
                if (this.priorityProvider) return this.priorityProvider(p);
            } catch (err) { logger.warn("[action-scheduler] priority provider failed", err); }
            return p.id;
        };

        maturedGlobal.sort((a, b) => {
            const dt = a.action.executeTick - b.action.executeTick;
            if (dt !== 0) return dt;
            const pa = priorityOf(a.player);
            const pb = priorityOf(b.player);
            if (pa !== pb) return pa - pb;
            const rt = a.action.requestTick - b.action.requestTick;
            if (rt !== 0) return rt;
            return a.action.id - b.action.id;
        });

        for (const { player, state, action } of maturedGlobal) {
            // OSRS: dead players do not execute further actions this tick.
            try {
                const hp = player.getHitpointsCurrent();
                if (hp <= 0) continue;
            } catch (err) { logger.warn("[action-scheduler] failed to check player hp", err); }

            const result = this.safeExecute(player, action, tick);
            this.applyResult(player, state, action, result, tick);
            if (result.effects) effects.push(...result.effects);
        }

        for (const state of this.playerStates.values()) {
            this.cleanupLocks(state, tick);
        }

        return effects;
    }

    private cleanupLocks(state: PlayerActionState, tick: number) {
        for (const [group, unlockTick] of state.groupLocks.entries()) {
            if (unlockTick <= tick) {
                state.groupLocks.delete(group);
            }
        }
    }

    private safeExecute(
        player: PlayerState,
        action: ScheduledAction,
        tick: number,
    ): ActionExecutionResult {
        try {
            const result = this.performer(player, action, tick);
            if (!result) {
                return {
                    ok: false,
                    reason: "action returned no result",
                };
            }
            return result;
        } catch (err) {
            return {
                ok: false,
                reason: err instanceof Error ? err.message : "action exception",
                effects: [
                    {
                        type: "log",
                        playerId: player.id,
                        level: "error",
                        message: "action execution failed",
                        meta: {
                            kind: action.kind,
                            error:
                                err instanceof Error
                                    ? err.stack || err.message
                                    : String(err ?? "unknown"),
                        },
                    },
                ],
            };
        }
    }

    private applyResult(
        player: PlayerState,
        state: PlayerActionState,
        action: ScheduledAction,
        result: ActionExecutionResult,
        tick: number,
    ) {
        const groups = new Set(action.groups);
        if (result.groups) {
            for (const g of result.groups) groups.add(g);
        }

        if (!result.ok) {
            if (result.reason) {
                const list = result.effects ?? [];
                list.push({
                    type: "log",
                    playerId: player.id,
                    level: "warn",
                    message: result.reason,
                    meta: { kind: action.kind },
                });
                result.effects = list;
            }
            for (const group of groups) {
                state.groupLocks.set(group, tick);
            }
            return;
        }

        const cooldown = Math.max(action.cooldownTicks, result.cooldownTicks ?? 0);
        for (const group of groups) {
            const unlock = tick + cooldown;
            const existing = state.groupLocks.get(group) ?? tick;
            state.groupLocks.set(group, Math.max(existing, unlock));
        }
    }

    /**
     * OSRS parity: Check if an action is a skill action that should be paused
     * while a modal dialog (like level-up) is open.
     */
    private isSkillAction(action: ScheduledAction): boolean {
        return this.isInterruptibleAction(action);
    }

    /**
     * Check if an action is interruptible (should be cancelled on walk/new interaction).
     * Delegates to the interruption registry for pattern matching and exclusions.
     */
    private isInterruptibleAction(action: ScheduledAction): boolean {
        return this.interruptionRegistry.isInterruptible(action.kind, action.groups);
    }

    /**
     * Get the interruption registry for external configuration.
     */
    getInterruptionRegistry(): ActionInterruptionRegistry {
        return this.interruptionRegistry;
    }

    /**
     * OSRS parity: Cancel all interruptible actions for a player.
     * This uses the same prefix matching as isInterruptibleAction() for consistency.
     * Called when player walks, starts new interaction, teleports, etc.
     */
    cancelInterruptibleActions(playerId: number): number {
        return this.cancelActions(playerId, (action) => this.isInterruptibleAction(action));
    }
}
