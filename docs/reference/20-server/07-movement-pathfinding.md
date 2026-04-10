# 20.7 — Movement and pathfinding

Movement on the server is a short story: each tick, each player and NPC takes at most one step (two if running). The longer story is what "take a step" means, how paths are computed and cached, and how the collision map is built. That's this page.

## `PathService` (`server/src/pathfinding/PathService.ts`)

The server-side pathfinder. Given:

- a start tile,
- a target (tile, rectangle, or entity interaction shape),
- a plane,
- a collision source,

…it returns a list of tiles from start to target, or `null` if unreachable.

Internally it runs a bounded BFS on collision flags from `MapCollisionService`. Bounded means "don't search more than N tiles", because OSRS paths are short by definition — if you need to walk across the world you use an OSRS route (Amulet of Glory, Spirit Tree, etc.), not a BFS.

The pathfinder respects:

- **Wall blockers** — walls and wall decorations on tile edges.
- **Solid locs** — trees, statues, closed doors.
- **Dynamic state** — open vs closed doors from `DoorStateManager`.
- **Instance boundaries** — you can't path out of your own dungeon instance.

### Direct-reach optimization

`DirectReach.ts` is a helper that skips the BFS for the common case of "the target is one step away and reachable". Called before `PathService.findPath` for attack and interaction checks. It's the reason combat feels responsive — most hits are one tile away and don't need a full search.

### Legacy pathfinder

`server/src/pathfinding/legacy/` holds the previous pathfinder implementation, kept for comparison and regression tests. Don't use it in new code.

## `MapCollisionService` (`server/src/world/MapCollisionService.ts`)

The source of truth for "can you step on this tile". Per tile, it stores a bitmask of collision flags (blocked, blocked-on-edge-north, blocked-on-loc, etc.).

### How the collision map is built

Two sources:

1. **Static terrain collision.** Computed by running the scene builder over the cache region. Slow — loading, parsing, and triangulating a whole world of regions is minutes of work. Done either at boot (slow) or ahead of time by a build script (fast).
2. **Dynamic loc collision.** Certain locs (doors, movable objects) have their collision state updated at runtime. `DynamicLocStateStore` and `DoorStateManager` own these; `MapCollisionService.setLocCollision(...)` mutates the map when they change.

The precomputed snapshot lives at `server/cache/collision/` by default. Running `scripts/precomputeCollision.ts` (or the equivalent bun script) regenerates it after a cache upgrade.

### Runtime flags

`MapCollisionService` exposes:

- `isBlocked(x, y, plane)` — fast check.
- `canStep(x, y, plane, direction)` — is moving from this tile in this direction allowed (considering wall edges).
- `setLocCollision(x, y, plane, loc, open)` — dynamic mutation.
- `resetToStatic(x, y, plane)` — revert a dynamic change (used for instance teardown).

## `MovementSystem` (`server/src/game/systems/MovementSystem.ts`)

The per-tick movement step executor. Called from the `movement` tick phase for every active actor.

For each actor with a pending path:

1. Pop the next tile from the path.
2. Check that the step is still valid (collision may have changed since the path was computed — e.g., a door closed).
3. If invalid, cancel the path and retry — possibly re-running the pathfinder.
4. If valid, apply the step: update the actor's tile, orientation, movement mode flag.
5. If running, pop and apply a _second_ tile.
6. If the actor reached its target, emit a "arrived" event that subsequent phases can consume (e.g., the attack phase checks "am I now in range?" and triggers an attack).

## `MovementService` (`server/src/game/services/MovementService.ts`)

The higher-level API used by gameplay code:

- `walkTo(actor, x, y)` — compute a path and set it.
- `walkToEntity(actor, target, interactionShape)` — compute a path that ends adjacent to the target.
- `teleport(actor, x, y, plane)` — instant move, bypasses collision check and fires a `teleport` sync event.
- `cancelPath(actor)` — clear the current path.
- `setFacing(actor, dir)` — set facing without moving.

Services above this level call these methods rather than touching paths directly.

## Player movement flow

1. Client sends a `WALK` packet with target tile (and shift-held modifier).
2. `MessageRouter` routes to `MovementActionHandler`.
3. Handler calls `MovementService.walkTo(player, x, y)`.
4. The service runs `PathService.findPath`, gets a list of tiles, sets the player's pending path.
5. Next tick, `movement` phase pops one (or two) tiles.
6. The new position is broadcast in the player sync packet on the following tick's broadcast phase.

## NPC movement flow

1. NPC AI decides the NPC needs to move (target out of range, wandering, fleeing).
2. AI calls `movementService.walkTo(npc, x, y)` with the target tile.
3. Same path -> step loop as players.

NPC movement is slightly cheaper because NPCs often have shorter paths and simpler goals. Also, idle NPCs skip the pathfinder entirely (wandering uses random adjacent tiles).

## Interaction pathing

For "click to attack" or "click to talk", the pathfinder needs to end the player _next to_ the target, not on the target. `PathService.findPathToInteraction(target, shape)` takes an interaction shape (facing-side, any-side, wall-adjacent) and finds a tile that satisfies it.

The shape comes from the loc/npc config: a tree is reachable from any adjacent tile, a door from either side, a shop NPC from in-front only.

## Collision and plane changes

Plane transitions (stairs, trapdoors) are _teleports_, not walk steps. The server handles them by:

1. Detecting the plane transition at the loc interaction handler.
2. Calling `MovementService.teleport(player, newX, newY, newPlane)`.
3. The client handles the plane change in the sync packet and rebuilds the local scene for the new floor.

## Instances

If a player is inside a dungeon instance, their movement uses the instance's collision overlay — some tiles that are blocked in the real world are open in the instance, or vice versa. `InstanceManager` exposes a per-instance `MapCollisionService` view that merges the overlay onto the base map.

---

## Canonical facts

- **Path service**: `server/src/pathfinding/PathService.ts`.
- **Direct reach helper**: `server/src/pathfinding/DirectReach.ts`.
- **Legacy pathfinder**: `server/src/pathfinding/legacy/`.
- **Collision service**: `server/src/world/MapCollisionService.ts`.
- **Dynamic loc state**: `server/src/world/DynamicLocStateStore.ts`.
- **Door state manager**: `server/src/world/DoorStateManager.ts`.
- **Instance manager**: `server/src/world/InstanceManager.ts`.
- **Movement system (per-tick executor)**: `server/src/game/systems/MovementSystem.ts`.
- **Movement service (API)**: `server/src/game/services/MovementService.ts`.
- **Collision snapshot directory**: `server/cache/collision/`.
- **Rule**: paths are bounded; long-distance travel uses OSRS routes, not BFS.
