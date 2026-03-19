/**
 * Player Combat Manager Tests
 *
 * Tests for player-owned combat state and scheduling.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import {
    PlayerCombatManager,
    PlayerCombatManagerContext,
    createPlayerCombatManager,
} from "../src/game/combat/PlayerCombatManager";
import { CombatPhase } from "../src/game/combat/CombatState";
import type { NpcState } from "../src/game/npc";
import type { PlayerState } from "../src/game/player";

// =============================================================================
// Mocks
// =============================================================================

function createMockPlayer(overrides: Partial<PlayerState> = {}): PlayerState {
    return {
        id: 1,
        tileX: 3200,
        tileY: 3200,
        level: 0,
        x: 3200 << 7,
        y: 3200 << 7,
        combatWeaponCategory: 0,
        combatWeaponItemId: -1,
        combatWeaponRange: 1,
        combatStyleSlot: 0,
        combatSpellId: -1,
        autocastEnabled: false,
        autocastMode: null,
        attackDelay: 4,
        clearPath: vi.fn(),
        ...overrides,
    } as unknown as PlayerState;
}

function createMockNpc(overrides: Partial<NpcState> = {}): NpcState {
    let nextAttackTick = 0;
    return {
        id: 100,
        tileX: 3201,
        tileY: 3200,
        level: 0,
        x: 3201 << 7,
        y: 3200 << 7,
        attackSpeed: 4,
        canAttack: vi.fn((tick: number) => tick >= nextAttackTick),
        recordAttack: vi.fn((tick: number) => {
            nextAttackTick = tick + 4;
        }),
        getNextAttackTick: vi.fn(() => nextAttackTick),
        setNextAttackTick: vi.fn((tick: number) => {
            nextAttackTick = tick;
        }),
        isInCombat: vi.fn(() => false),
        clearPath: vi.fn(),
        getHitpoints: vi.fn(() => 50),
        engageCombat: vi.fn(),
        setInteraction: vi.fn(),
        peekNextStep: vi.fn(() => undefined),
        disengageCombat: vi.fn(),
        scheduleNextAggressionCheck: vi.fn(),
        isRecoveringToSpawn: vi.fn(() => false),
        ...overrides,
    } as unknown as NpcState;
}

function createMockContext(
    overrides: Partial<PlayerCombatManagerContext> = {},
): PlayerCombatManagerContext {
    const players = new Map<number, PlayerState>();
    const npcs = new Map<number, NpcState>();

    return {
        tick: 0,
        npcLookup: (id) => npcs.get(id),
        playerLookup: (id) => players.get(id),
        pickAttackSpeed: () => 4,
        getAttackReach: () => 1,
        getDistanceToNpc: () => 1,
        isWithinAttackReach: () => true,
        hasLineOfSight: () => true,
        isPlayerFrozen: () => false,
        schedulePlayerAttack: vi.fn(() => ({ ok: true })),
        routePlayerToNpc: vi.fn(),
        shouldRepeatAttack: () => true,
        ...overrides,
    };
}

// =============================================================================
// Tests
// =============================================================================

describe("PlayerCombatManager", () => {
    let controller: PlayerCombatManager;
    let player: PlayerState;
    let npc: NpcState;

    beforeEach(() => {
        controller = createPlayerCombatManager();
        player = createMockPlayer();
        npc = createMockNpc();
    });

    describe("startCombat", () => {
        it("creates combat state for player", () => {
            const result = controller.startCombat(player, npc, 0);
            expect(result).toBe(true);
            expect(controller.isInCombat(player.id)).toBe(true);
        });

        it("stores correct NPC target ID", () => {
            controller.startCombat(player, npc, 0);
            expect(controller.getTargetNpcId(player.id)).toBe(npc.id);
        });

        it("initializes in Approaching phase", () => {
            controller.startCombat(player, npc, 0);
            expect(controller.getCombatPhase(player.id)).toBe(CombatPhase.Approaching);
        });

        it("ends previous combat when attacking new target", () => {
            const npc2 = createMockNpc({ id: 200 });
            controller.startCombat(player, npc, 0);
            controller.startCombat(player, npc2, 1);
            expect(controller.getTargetNpcId(player.id)).toBe(npc2.id);
        });

        it("updates state when attacking same NPC again", () => {
            controller.startCombat(player, npc, 0);
            controller.stopAutoAttack(player.id);
            controller.startCombat(player, npc, 1);
            const state = controller.getCombatState(player.id);
            expect(state?.engagement.playerAutoAttack).toBe(true);
        });
    });

    describe("endCombat", () => {
        it("removes combat state", () => {
            controller.startCombat(player, npc, 0);
            controller.endCombat(player.id, 1, "test");
            expect(controller.isInCombat(player.id)).toBe(false);
        });

        it("clears target NPC ID", () => {
            controller.startCombat(player, npc, 0);
            controller.endCombat(player.id, 1, "test");
            expect(controller.getTargetNpcId(player.id)).toBeUndefined();
        });
    });

    describe("auto-attack control", () => {
        beforeEach(() => {
            controller.startCombat(player, npc, 0);
        });

        it("stopAutoAttack sets playerAutoAttack to false", () => {
            controller.stopAutoAttack(player.id);
            const state = controller.getCombatState(player.id);
            expect(state?.engagement.playerAutoAttack).toBe(false);
        });

        it("stopAutoAttack clears pending attack and movement locks", () => {
            const state = controller.getCombatState(player.id);
            if (state) {
                state.timing.pendingAttackTick = 5;
                state.timing.stepLockUntilTick = 8;
            }
            controller.stopAutoAttack(player.id);
            expect(state?.timing.pendingAttackTick).toBeUndefined();
            expect(state?.timing.stepLockUntilTick).toBeUndefined();
        });

        it("resumeAutoAttack sets playerAutoAttack to true", () => {
            controller.stopAutoAttack(player.id);
            controller.resumeAutoAttack(player.id);
            const state = controller.getCombatState(player.id);
            expect(state?.engagement.playerAutoAttack).toBe(true);
        });

        it("resumeAutoAttack resets aggro hold ticks", () => {
            controller.stopAutoAttack(player.id);
            const stateAfterStop = controller.getCombatState(player.id);
            const ticksAfterStop = stateAfterStop?.engagement.aggroHoldTicks ?? 0;

            controller.resumeAutoAttack(player.id);
            const stateAfterResume = controller.getCombatState(player.id);
            expect(stateAfterResume?.engagement.aggroHoldTicks).toBeGreaterThanOrEqual(
                ticksAfterStop,
            );
        });
    });

    describe("processTick", () => {
        it("ends combat when player not found", () => {
            controller.startCombat(player, npc, 0);
            const ctx = createMockContext({
                tick: 1,
                playerLookup: () => undefined,
                npcLookup: () => npc,
            });

            const result = controller.processTick(ctx);
            expect(result.endedEngagements).toHaveLength(1);
            expect(result.endedEngagements[0].reason).toBe("player_not_found");
        });

        it("ends combat when NPC not found", () => {
            controller.startCombat(player, npc, 0);
            const ctx = createMockContext({
                tick: 1,
                playerLookup: () => player,
                npcLookup: () => undefined,
            });

            const result = controller.processTick(ctx);
            expect(result.endedEngagements).toHaveLength(1);
            expect(result.endedEngagements[0].reason).toBe("target_dead");
        });

        it("keeps retaliation combat active without steering the NPC", () => {
            player = createMockPlayer({ tileX: 3205, tileY: 3200, x: 3205 << 7, y: 3200 << 7 });
            npc = createMockNpc({
                tileX: 3201,
                tileY: 3200,
                x: 3201 << 7,
                y: 3200 << 7,
            });

            controller.startCombat(player, npc, 100);
            const combatState = controller.getCombatState(player.id);
            if (!combatState) {
                throw new Error("expected combat state");
            }
            combatState.engagement.retaliationEngaged = true;

            const ctx = createMockContext({
                tick: 101,
                playerLookup: () => player,
                npcLookup: () => npc,
                getDistanceToNpc: () => 4,
                isWithinAttackReach: () => false,
            });

            const result = controller.processTick(ctx);

            expect(result.endedEngagements).toHaveLength(0);
            expect(controller.isInCombat(player.id)).toBe(true);
            expect((npc.disengageCombat as Mock)).not.toHaveBeenCalled();
            expect((npc.scheduleNextAggressionCheck as Mock)).not.toHaveBeenCalled();
        });

        it("ends combat when NPC has 0 HP", () => {
            controller.startCombat(player, npc, 0);
            const deadNpc = createMockNpc({ getHitpoints: vi.fn(() => 0) });
            const ctx = createMockContext({
                tick: 1,
                playerLookup: () => player,
                npcLookup: () => deadNpc,
            });

            const result = controller.processTick(ctx);
            expect(result.endedEngagements).toHaveLength(1);
            expect(result.endedEngagements[0].reason).toBe("target_dead");
        });

        it("keeps combat active while NPC is returning home", () => {
            controller.startCombat(player, npc, 0);
            const recoveringNpc = createMockNpc({
                isRecoveringToSpawn: vi.fn(() => true),
            });
            const ctx = createMockContext({
                tick: 1,
                playerLookup: () => player,
                npcLookup: () => recoveringNpc,
            });

            const result = controller.processTick(ctx);
            expect(result.endedEngagements).toHaveLength(0);
            expect(controller.isInCombat(player.id)).toBe(true);
        });

        it("schedules attack when in range and ready", () => {
            controller.startCombat(player, npc, 0);
            const schedulePlayerAttack = vi.fn(() => ({ ok: true }));
            const ctx = createMockContext({
                tick: 1,
                playerLookup: () => player,
                npcLookup: () => npc,
                isWithinAttackReach: () => true,
                schedulePlayerAttack,
            });

            const result = controller.processTick(ctx);
            expect(schedulePlayerAttack).toHaveBeenCalled();
            expect(result.attacksScheduled).toHaveLength(1);
        });

        it("routes player when out of range", () => {
            controller.startCombat(player, npc, 0);
            const routePlayerToNpc = vi.fn();
            const ctx = createMockContext({
                tick: 1,
                playerLookup: () => player,
                npcLookup: () => npc,
                isWithinAttackReach: () => false,
                getDistanceToNpc: () => 10,
                routePlayerToNpc,
            });

            controller.processTick(ctx);
            expect(routePlayerToNpc).toHaveBeenCalled();
        });

        it("ends combat when target too far", () => {
            controller.startCombat(player, npc, 0);
            const ctx = createMockContext({
                tick: 1,
                playerLookup: () => player,
                npcLookup: () => npc,
                getDistanceToNpc: () => 50, // > MAX_CHASE_DISTANCE (32)
            });

            const result = controller.processTick(ctx);
            expect(result.endedEngagements).toHaveLength(1);
            expect(result.endedEngagements[0].reason).toBe("too_far");
        });

        it("does not route when player is frozen", () => {
            controller.startCombat(player, npc, 0);
            const routePlayerToNpc = vi.fn();
            const ctx = createMockContext({
                tick: 1,
                playerLookup: () => player,
                npcLookup: () => npc,
                isWithinAttackReach: () => false,
                isPlayerFrozen: () => true,
                routePlayerToNpc,
            });

            controller.processTick(ctx);
            expect(routePlayerToNpc).not.toHaveBeenCalled();
        });
    });

    describe("combat timing", () => {
        it("updates nextAttackTick after attack", () => {
            controller.startCombat(player, npc, 0);
            controller.onAttackExecuted(player.id, 10, 4);

            const state = controller.getCombatState(player.id);
            expect(state?.timing.nextAttackTick).toBe(14); // 10 + 4
        });

        it("clears pendingAttackTick after attack", () => {
            controller.startCombat(player, npc, 0);
            const state = controller.getCombatState(player.id);
            if (state) state.timing.pendingAttackTick = 5;

            controller.onAttackExecuted(player.id, 10, 4);
            expect(state?.timing.pendingAttackTick).toBeUndefined();
        });

        it("hasPendingAttack returns true on correct tick", () => {
            controller.startCombat(player, npc, 0);
            const state = controller.getCombatState(player.id);
            if (state) state.timing.pendingAttackTick = 5;

            expect(controller.hasPendingAttack(player.id, 5)).toBe(true);
            expect(controller.hasPendingAttack(player.id, 4)).toBe(false);
            expect(controller.hasPendingAttack(player.id, 6)).toBe(false);
        });
    });

    describe("melee movement locks", () => {
        it("applyMeleeMovementLock sets step lock time", () => {
            controller.startCombat(player, npc, 0);
            controller.applyMeleeMovementLock(player.id, 10, 3);

            const state = controller.getCombatState(player.id);
            expect(state?.timing.stepLockUntilTick).toBe(13);
        });

        it("isMovementLocked returns true during lock", () => {
            controller.startCombat(player, npc, 0);
            controller.applyMeleeMovementLock(player.id, 10, 3);

            expect(controller.isMovementLocked(player.id, 10)).toBe(true);
            expect(controller.isMovementLocked(player.id, 12)).toBe(true);
            expect(controller.isMovementLocked(player.id, 13)).toBe(false);
        });

        it("isMovementLocked returns false when not in combat", () => {
            expect(controller.isMovementLocked(999, 0)).toBe(false);
        });
    });

    describe("melee chasing parity", () => {
        it("does not clear player path during melee cooldown", () => {
            controller.startCombat(player, npc, 0);

            const ctxAt10 = createMockContext({
                tick: 10,
                playerLookup: () => player,
                npcLookup: () => npc,
                getAttackReach: () => 1,
                isWithinAttackReach: () => true,
                hasLineOfSight: () => true,
                schedulePlayerAttack: vi.fn(() => ({ ok: true })),
            });
            controller.processTick(ctxAt10);

            const clearPathMock = player.clearPath as Mock;
            clearPathMock.mockClear();

            const ctxAt11 = createMockContext({
                tick: 11,
                playerLookup: () => player,
                npcLookup: () => npc,
                getAttackReach: () => 1,
                isWithinAttackReach: () => true,
                hasLineOfSight: () => true,
            });
            controller.processTick(ctxAt11);

            expect(clearPathMock).not.toHaveBeenCalled();
        });
    });

    describe("retaliation", () => {
        it("confirmHitLanded triggers retaliation and engages NPC", () => {
            controller.startCombat(player, npc, 0);
            expect(controller.getCombatState(player.id)?.engagement.retaliationEngaged).toBe(false);

            // OSRS parity: onAttackExecuted does NOT trigger retaliation
            // Only confirmHitLanded does (when hit actually lands)
            controller.onAttackExecuted(player.id, 0, 4);
            expect(controller.getCombatState(player.id)?.engagement.retaliationEngaged).toBe(false);

            // confirmHitLanded triggers retaliation and engages NPC
            controller.confirmHitLanded(player.id, npc, 1);
            expect(controller.getCombatState(player.id)?.engagement.retaliationEngaged).toBe(true);
            expect(npc.engageCombat).toHaveBeenCalledWith(player.id, 1);
            expect(npc.setInteraction).toHaveBeenCalledWith("player", player.id);
        });

        it("confirmHitLanded sets npcNextAttackTick using retaliation delay", () => {
            controller.startCombat(player, npc, 0);

            // Hit lands at tick 5
            controller.confirmHitLanded(player.id, npc, 5);

            const state = controller.getCombatState(player.id);
            // 4-tick NPCs retaliate after ceil(4/2)=2 ticks from hit-land.
            expect(state?.engagement.npcNextAttackTick).toBe(7);
        });

        it("confirmHitLanded preserves NPC timer when already in combat", () => {
            const inCombatNpc = createMockNpc({
                isInCombat: vi.fn(() => true),
                getNextAttackTick: vi.fn(() => 13),
            });
            controller.startCombat(player, inCombatNpc, 0);

            controller.confirmHitLanded(player.id, inCombatNpc, 5);

            const state = controller.getCombatState(player.id);
            expect(inCombatNpc.setNextAttackTick).not.toHaveBeenCalled();
            expect(state?.engagement.npcNextAttackTick).toBe(13);
        });
    });

    describe("engagement info", () => {
        it("getEngagementInfo returns correct data", () => {
            controller.startCombat(player, npc, 0);
            controller.confirmHitLanded(player.id, npc, 1);

            const info = controller.getEngagementInfo(player.id);
            expect(info).toBeDefined();
            expect(info!.playerId).toBe(player.id);
            expect(info!.npcId).toBe(npc.id);
            expect(info!.retaliationEngaged).toBe(true);
        });

        it("getEngagementInfo returns undefined when not in combat", () => {
            expect(controller.getEngagementInfo(999)).toBeUndefined();
        });

        it("getAllEngagements returns all active combats", () => {
            const player2 = createMockPlayer({ id: 2 });
            const npc2 = createMockNpc({ id: 200 });

            controller.startCombat(player, npc, 0);
            controller.startCombat(player2, npc2, 0);

            const engagements = controller.getAllEngagements();
            expect(engagements).toHaveLength(2);
        });
    });

    describe("updateCombatConfig", () => {
        it("updates config when player equipment changes", () => {
            controller.startCombat(player, npc, 0);

            const updatedPlayer = createMockPlayer({
                id: player.id,
                combatWeaponItemId: 4151, // Whip
                combatWeaponRange: 2,
            });

            controller.updateCombatConfig(updatedPlayer);

            const state = controller.getCombatState(player.id);
            expect(state?.config.weaponItemId).toBe(4151);
            expect(state?.config.weaponRange).toBe(2);
        });
    });

    describe("clearAll", () => {
        it("removes all combat states", () => {
            const player2 = createMockPlayer({ id: 2 });
            const npc2 = createMockNpc({ id: 200 });

            controller.startCombat(player, npc, 0);
            controller.startCombat(player2, npc2, 0);
            expect(controller.getAllEngagements()).toHaveLength(2);

            controller.clearAll();
            expect(controller.getAllEngagements()).toHaveLength(0);
        });
    });

    describe("NPC movement ownership", () => {
        it("does not route NPC away when player overlaps before retaliation", () => {
            // Player and NPC on same tile
            const overlappingPlayer = createMockPlayer({ tileX: 3200, tileY: 3200 });
            const overlappingNpc = createMockNpc({ tileX: 3200, tileY: 3200 });

            controller.startCombat(overlappingPlayer, overlappingNpc, 0);

            // retaliationEngaged should be false (no hit landed yet)
            expect(
                controller.getCombatState(overlappingPlayer.id)?.engagement.retaliationEngaged,
            ).toBe(false);

            const routePlayerToNpc = vi.fn();
            const ctx = createMockContext({
                tick: 1,
                playerLookup: () => overlappingPlayer,
                npcLookup: () => overlappingNpc,
                routePlayerToNpc,
                isWithinAttackReach: () => false, // Overlapping is not valid attack position
            });

            controller.processTick(ctx);

            expect(routePlayerToNpc).toHaveBeenCalled();
            // NpcManager owns NPC movement, not PlayerCombatManager
            expect((overlappingNpc.clearPath as Mock)).not.toHaveBeenCalled();
        });

        it("does not route NPC when not overlapping", () => {
            // Player and NPC on adjacent tiles
            const adjacentPlayer = createMockPlayer({ tileX: 3200, tileY: 3200 });
            const adjacentNpc = createMockNpc({ tileX: 3201, tileY: 3200 });

            controller.startCombat(adjacentPlayer, adjacentNpc, 0);

            const ctx = createMockContext({
                tick: 1,
                playerLookup: () => adjacentPlayer,
                npcLookup: () => adjacentNpc,
                isWithinAttackReach: () => true, // Adjacent is valid
            });

            controller.processTick(ctx);

            // NPC should not be manipulated by the player combat manager
            expect((adjacentNpc.clearPath as Mock)).not.toHaveBeenCalled();
        });
    });

    describe("aggro hold decay", () => {
        it("combat ends when aggro hold reaches 0", () => {
            controller.startCombat(player, npc, 0);
            controller.stopAutoAttack(player.id);

            // Simulate many ticks to decay aggro
            for (let tick = 1; tick <= 20; tick++) {
                const ctx = createMockContext({
                    tick,
                    playerLookup: () => player,
                    npcLookup: () => npc,
                    getDistanceToNpc: () => 1,
                });
                const result = controller.processTick(ctx);
                if (result.endedEngagements.length > 0) {
                    expect(result.endedEngagements[0].reason).toBe("disengaged");
                    return;
                }
            }
            // Should have disengaged by tick 20
            expect(controller.isInCombat(player.id)).toBe(false);
        });

        it("aggro hold resets when auto-attacking", () => {
            controller.startCombat(player, npc, 0);
            controller.stopAutoAttack(player.id);

            // Decay some ticks
            for (let tick = 1; tick <= 5; tick++) {
                const ctx = createMockContext({
                    tick,
                    playerLookup: () => player,
                    npcLookup: () => npc,
                    getDistanceToNpc: () => 1,
                });
                controller.processTick(ctx);
            }

            // Resume auto-attacking
            controller.resumeAutoAttack(player.id);

            // Process more ticks - should stay in combat
            for (let tick = 6; tick <= 25; tick++) {
                const ctx = createMockContext({
                    tick,
                    playerLookup: () => player,
                    npcLookup: () => npc,
                    getDistanceToNpc: () => 1,
                    isWithinAttackReach: () => true,
                    schedulePlayerAttack: vi.fn(() => ({ ok: true })),
                });
                controller.processTick(ctx);
            }

            expect(controller.isInCombat(player.id)).toBe(true);
        });
    });
});
