/**
 * Interaction LoS Routing Regression Test
 *
 * Ensures auto-walk-to-Line-of-Sight (ranged/magic) does not get "stuck"
 * when the first LoS candidate tile is unroutable.
 *
 * Regression: tryRouteToLineOfSight() used to return true even if routing failed,
 * which could leave the player standing still for multiple ticks before moving.
 */
import assert from "assert";

import { createPlayerCombatManager } from "../src/game/combat/PlayerCombatManager";
import { NpcState } from "../src/game/npc";
import { PlayerManager } from "../src/game/player";

type QueueReadableActor = {
    getPathQueue?: () => Array<{ x: number; y: number }>;
    queue?: Array<{ x: number; y: number }>;
};

class StubPathService {
    // Collision flags per tile (plane 0 only for this test)
    private flags = new Map<string, number>();

    private key(x: number, y: number, plane: number): string {
        return `${plane}:${x}:${y}`;
    }

    setFlag(x: number, y: number, plane: number, flag: number): void {
        this.flags.set(this.key(x, y, plane), flag);
    }

    getCollisionFlagAt(x: number, y: number, plane: number): number | undefined {
        return this.flags.get(this.key(x, y, plane)) ?? 0;
    }

    projectileRaycast(
        from: { x: number; y: number; plane: number },
        _to: { x: number; y: number },
    ) {
        // Make the player's current tile have no LoS, but allow LoS from adjacent tiles.
        const clear = !(from.x === 10 && from.y === 10);
        return { clear, tiles: 1 };
    }

    findPathSteps(
        req: { from: { x: number; y: number; plane: number }; to: { x: number; y: number } },
        _opts?: any,
    ) {
        // First LoS candidate (west) is unroutable.
        if (req.to.x === 9 && req.to.y === 10) {
            return { ok: false, steps: [] };
        }
        // Next candidate (south) is routable in 1 step.
        if (req.to.x === 10 && req.to.y === 9) {
            return { ok: true, steps: [{ x: 10, y: 9 }] };
        }
        // Default: no path
        return { ok: false, steps: [] };
    }
}

function cloneQueue(actor: QueueReadableActor | null | undefined): { x: number; y: number }[] {
    if (actor?.getPathQueue) {
        return actor.getPathQueue();
    }
    const queue: { x: number; y: number }[] | undefined = actor?.queue;
    if (!Array.isArray(queue)) return [];
    return queue.map((s) => ({ x: s.x, y: s.y }));
}

function enableInteractions(player: {
    setVarbitValue?: (id: number, value: number) => void;
}): void {
    player.setVarbitValue?.(10037, 12);
}

function main(): void {
    {
        const pathService = new StubPathService();
        const pm = new PlayerManager(pathService as any);

        const ws: any = { id: "los" };
        const player = pm.add(ws, 10, 10, 0);
        // Force ranged reach > 1 (category 3 is a ranged category).
        player.combatWeaponCategory = 3;
        player.combatWeaponRange = 7;
        enableInteractions(player as any);

        const npc = new NpcState(1, 1, 1, -1, -1, 32, { x: 10, y: 15, level: 0 });

        const result = pm.startNpcAttack(ws, npc, 0, 4);
        assert.strictEqual(result.ok, true, "Expected startNpcAttack to succeed");

        const queue = cloneQueue(player as any);
        assert.strictEqual(queue.length, 1, "Expected player to have a 1-step path to a LoS tile");
        assert.deepStrictEqual(
            queue[0],
            { x: 10, y: 9 },
            "Expected player to route to the first routable LoS tile",
        );
    }

    {
        const pathService = new StubPathService();
        pathService.findPathSteps = (
            req: { from: { x: number; y: number; plane: number }; to: { x: number; y: number } },
            _opts?: any,
        ) => {
            // West candidate is found first by scan order, but it requires a longer detour.
            if (req.to.x === 9 && req.to.y === 10) {
                return {
                    ok: true,
                    steps: [
                        { x: 10, y: 9 },
                        { x: 9, y: 9 },
                        { x: 8, y: 9 },
                        { x: 9, y: 10 },
                    ],
                };
            }
            // South candidate is shorter and should win.
            if (req.to.x === 10 && req.to.y === 9) {
                return { ok: true, steps: [{ x: 10, y: 9 }] };
            }
            return { ok: false, steps: [] };
        };
        pathService.projectileRaycast = (
            from: { x: number; y: number; plane: number },
            _to: { x: number; y: number },
        ) => {
            const clear = (from.x === 9 && from.y === 10) || (from.x === 10 && from.y === 9);
            return { clear, tiles: 1 };
        };

        const pm = new PlayerManager(pathService as any);
        const ws: any = { id: "los-shortest" };
        const player = pm.add(ws, 10, 10, 0);
        player.combatWeaponCategory = 3;
        player.combatWeaponRange = 7;
        enableInteractions(player as any);

        const npc = new NpcState(2, 1, 1, -1, -1, 32, { x: 10, y: 15, level: 0 });

        const result = pm.startNpcAttack(ws, npc, 0, 4);
        assert.strictEqual(result.ok, true, "Expected shortest-path LoS routing to succeed");

        const queue = cloneQueue(player as any);
        assert.deepStrictEqual(
            queue,
            [{ x: 10, y: 9 }],
            "Expected LoS routing to prefer the shortest reachable path, not the first scanned tile",
        );
    }

    // eslint-disable-next-line no-console
    {
        const pathService = new StubPathService();
        pathService.findPathSteps = (
            req: { from: { x: number; y: number; plane: number }; to: { x: number; y: number } },
            opts?: {
                routeStrategy?: { hasArrived: (x: number, y: number, level: number) => boolean };
            },
        ) => {
            const candidates = [
                { x: 1, y: 0, steps: [{ x: 1, y: 0 }] },
                { x: 1, y: 1, steps: [{ x: 1, y: 1 }] },
            ];
            for (const candidate of candidates) {
                if (opts?.routeStrategy?.hasArrived(candidate.x, candidate.y, req.from.plane)) {
                    return { ok: true, steps: candidate.steps };
                }
            }
            return { ok: false, steps: [] };
        };
        pathService.projectileRaycast = (
            from: { x: number; y: number; plane: number },
            _to: { x: number; y: number },
        ) => ({
            clear: from.x === 1 && from.y === 1,
            tiles: 1,
        });

        const pm = new PlayerManager(pathService as any);
        const ws: any = { id: "los-outside-range" };
        const player = pm.add(ws, 0, 0, 0);
        player.combatWeaponCategory = 3;
        player.combatWeaponRange = 4;
        enableInteractions(player as any);

        const npc = new NpcState(3, 1, 1, -1, -1, 32, { x: 5, y: 0, level: 0 });

        const result = pm.startNpcAttack(ws, npc, 0, 4);
        assert.strictEqual(
            result.ok,
            true,
            "Expected outside-range projectile routing to find a valid path",
        );

        const queue = cloneQueue(player as any);
        assert.deepStrictEqual(
            queue,
            [{ x: 1, y: 1 }],
            "Expected routePlayerToNpc to reject blocked in-range tiles and route directly to a LoS tile",
        );
    }

    {
        const pathService = new StubPathService();
        pathService.findPathSteps = () => ({
            ok: true,
            steps: [{ x: 1, y: 0 }],
            end: { x: 1, y: 0 },
        });
        pathService.projectileRaycast = (
            from: { x: number; y: number; plane: number },
            _to: { x: number; y: number },
        ) => ({
            clear: from.x === 1 && from.y === 1,
            tiles: 1,
        });

        const pm = new PlayerManager(pathService as any);
        const ws: any = { id: "los-invalid-alt-end" };
        const player = pm.add(ws, 0, 0, 0);
        player.combatWeaponCategory = 3;
        player.combatWeaponRange = 4;
        enableInteractions(player as any);

        const npc = new NpcState(33, 1, 1, -1, -1, 32, { x: 5, y: 0, level: 0 });

        const result = (pm as any).routePlayerToNpc(player, npc, 4);
        assert.strictEqual(
            result,
            false,
            "Expected ranged chase routing to reject alternative endpoints that still fail the route strategy",
        );
        assert.deepStrictEqual(
            cloneQueue(player as any),
            [],
            "Expected no movement route when the selected fallback tile is still not a valid firing position",
        );
    }

    {
        const pathService = new StubPathService();
        pathService.findPathSteps = (
            req: { from: { x: number; y: number; plane: number }; to: { x: number; y: number } },
            opts?: {
                routeStrategy?: { hasArrived: (x: number, y: number, level: number) => boolean };
            },
        ) => {
            const candidate = { x: 1, y: 5, steps: [{ x: 1, y: 5 }] };
            if (opts?.routeStrategy?.hasArrived(candidate.x, candidate.y, req.from.plane)) {
                return { ok: true, steps: candidate.steps };
            }
            return { ok: false, steps: [] };
        };
        pathService.projectileRaycast = (
            from: { x: number; y: number; plane: number },
            to: { x: number; y: number },
        ) => ({
            clear: from.x === 1 && from.y === 5 && to.x === 6 && to.y === 5,
            tiles: 1,
        });

        const pm = new PlayerManager(pathService as any);
        const ws: any = { id: "los-large-npc" };
        const player = pm.add(ws, 0, 5, 0);
        player.combatWeaponCategory = 3;
        player.combatWeaponRange = 4;
        enableInteractions(player as any);

        const npc = new NpcState(4, 1, 2, -1, -1, 32, { x: 5, y: 5, level: 0 });

        const result = pm.startNpcAttack(ws, npc, 0, 4);
        assert.strictEqual(
            result.ok,
            true,
            "Expected projectile routing to accept LoS to any occupied tile of a large NPC",
        );

        const queue = cloneQueue(player as any);
        assert.deepStrictEqual(
            queue,
            [{ x: 1, y: 5 }],
            "Expected ranged chase routing to use visibility against the large NPC footprint, not only its southwest tile",
        );
    }

    {
        const pathService = new StubPathService();
        pathService.findPathSteps = (
            req: { from: { x: number; y: number; plane: number }; to: { x: number; y: number } },
            opts?: {
                routeStrategy?: { hasArrived: (x: number, y: number, level: number) => boolean };
            },
        ) => {
            const candidates = [
                { x: 1, y: 0, steps: [{ x: 1, y: 0 }] },
                {
                    x: 2,
                    y: 0,
                    steps: [
                        { x: 1, y: 0 },
                        { x: 2, y: 0 },
                    ],
                },
            ];
            for (const candidate of candidates) {
                if (opts?.routeStrategy?.hasArrived(candidate.x, candidate.y, req.from.plane)) {
                    return { ok: true, steps: candidate.steps };
                }
            }
            return { ok: false, steps: [] };
        };
        pathService.projectileRaycast = (
            from: { x: number; y: number; plane: number },
            _to: { x: number; y: number },
        ) => ({
            clear: (from.x === 1 && from.y === 0) || (from.x === 2 && from.y === 0),
            tiles: 1,
        });

        const pm = new PlayerManager(pathService as any);
        const combat = createPlayerCombatManager({ players: pm });
        const ws: any = { id: "los-moving-target" };
        const player = pm.add(ws, 0, 0, 0);
        player.combatWeaponCategory = 3;
        player.combatWeaponRange = 4;
        enableInteractions(player as any);

        const npc = new NpcState(5, 1, 1, -1, -1, 32, { x: 5, y: 0, level: 0 });

        let result = pm.startNpcAttack(ws, npc, 0, 4);
        assert.strictEqual(result.ok, true, "Expected initial ranged chase route to succeed");
        combat.startCombat(player, npc, 0, 4);
        assert.deepStrictEqual(
            cloneQueue(player as any),
            [{ x: 1, y: 0 }],
            "Expected initial route to target the closest valid firing tile",
        );

        npc.tileX = 6;
        combat.updateNpcCombatMovement({
            tick: 1,
            pathService: pathService as any,
            npcLookup: (npcId) => (npcId === npc.id ? npc : undefined),
        });

        assert.deepStrictEqual(
            cloneQueue(player as any),
            [
                { x: 1, y: 0 },
                { x: 2, y: 0 },
            ],
            "Expected ranged chase to recalculate when the NPC moves and avoid stale firing tiles",
        );
    }

    console.log("Interaction LoS routing tests passed.");
}

main();
