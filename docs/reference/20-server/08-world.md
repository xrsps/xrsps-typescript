# 20.8 — World (`server/src/world/`)

Everything the server knows about the physical world — terrain, scenery, doors, instances, collision — lives under `server/src/world/`. This page is a per-file reference.

## `CacheEnv` (`CacheEnv.ts`)

The server's cache handle. Implements the same shape as the client's `CacheSystem<SYNC>` but backed by disk reads rather than IndexedDB.

- `initCacheEnv(path)` — read `caches/` at the given directory, load the latest revision, and return a `CacheEnv` containing `cacheSystem` and `info`.
- `CacheEnv.info` — `CacheInfo` from the loaded cache (revision, name, build date).
- `CacheEnv.cacheSystem` — the sync cache handle used by every loader.

`cacheFs.ts` is the tiny disk wrapper used by the backing store.

## `MapCollisionService` (`MapCollisionService.ts`)

See [20.7 — Movement and pathfinding](./07-movement-pathfinding.md). The core of the world: tile collision flags, loaded from either a precomputed snapshot or computed live from the scene builder.

## `CollisionOverlayStore` (`CollisionOverlayStore.ts`)

Per-instance collision overlays. When an instance modifies the collision of a tile (opens a locked door, reveals a hidden passage), the change goes into an overlay store keyed by instance id. The base map stays untouched; query-time merges yield the effective collision.

## `PlaneResolver` (`PlaneResolver.ts`)

OSRS has four planes (ground floor, 1F, 2F, 3F). For scene rendering and collision, we need to know which plane a given tile is actually on — and some structures like bridges have tiles on two planes at the same XY. `PlaneResolver` computes the effective plane from the scene graph.

## Locations ("locs")

"Loc" is OSRS slang for a scenery object: tree, rock, building, statue, door. The cache defines their type; the scene positions them; the world manages them at runtime.

### `LocTileLookupService` (`LocTileLookupService.ts`)

Given a tile, returns the locs at that tile (indexed by orientation and layer). Used by interaction handlers to resolve "what did the player click on".

### `LocTransforms` (`LocTransforms.ts`)

Some locs transform based on varbits or varps — e.g., a door that's "open" or "closed" is actually two different loc types in the cache, and the right one is chosen based on a varbit. `LocTransforms` computes the effective loc for a tile given the player's varp state.

### `DynamicLocStateStore` (`DynamicLocStateStore.ts`)

Per-world dynamic loc state. When a gamemode or script changes a loc at runtime (spawn a custom chest at this tile, remove this rock), the change is stored here rather than in the static cache scene. The scene builder merges these changes when a player enters view of the tile.

## Doors

Doors deserve their own subsystem because OSRS has a lot of door complexity: wall doors that swing, double doors that open together, locked doors, trick doors, doors that reset on tick N, doors that only the player who opened them can see for a few ticks.

### `DoorCatalogFile` (`DoorCatalogFile.ts`)

Loads a JSON catalog of door definitions from disk. Catalog entries map loc ids → door behavior types.

### `DoorDefinitions` (`DoorDefinitions.ts`)

Typed door definition classes: `WallDoor`, `DoubleDoor`, `RotatingDoor`, etc. Each has an `onOpen`, `onClose`, and a collision mutator.

### `DoorDefinitionLoader` (`DoorDefinitionLoader.ts`)

Constructs `DoorDefinitions` from the catalog.

### `DoorCollisionService` (`DoorCollisionService.ts`)

Applies door state changes to the collision map. When a door opens, it's the door service that tells `MapCollisionService` the wall is no longer blocking.

### `DoorStateManager` (`DoorStateManager.ts`)

World-wide "which doors are currently open" state. Used by every player's scene view: if player A opens a door in a public area, player B sees it open.

### `DoorRuntimeTileMappingStore` (`DoorRuntimeTileMappingStore.ts`)

Maps runtime door ids back to the underlying (tile, loc) they were created from. Needed because the game treats each door as a stable id for packet purposes even though the underlying loc may transform.

## `InstanceManager` (`InstanceManager.ts`)

Manages _instance_ creation and teardown. An instance is a copy of part of the world that only certain players can see (dungeons, minigames, private boss rooms).

API:

- `createInstance(spec)` — given a spec (bounds, copy mode, entry conditions), return a new instance id.
- `destroyInstance(id)` — tear down the instance, move orphan players out.
- `getPlayerInstance(player)` — return the instance the player is currently in, or `null`.

Instances get:

- Their own collision overlay (via `CollisionOverlayStore`).
- Their own dynamic loc state (scoped to the instance).
- Their own NPC spawns (registered with `NpcManager` under the instance id).

Sync filters players by instance: you only see other players (and NPCs, ground items) that share your instance.

## Miscellaneous

- **`cacheFs.ts`** — tiny disk I/O wrapper for the cache backing store. Abstracted so alternative stores (S3, in-memory, network) can be dropped in.

## Relationship to `src/rs/scene/` (client-shared)

The client's `SceneBuilder` (see [10.2](../10-client/02-rs-engine.md)) can build the full 3D scene including models. The server doesn't need models — it only needs collision. `MapCollisionService` uses a server-specific variant of the scene building process that skips model parsing. That's why boot is relatively fast even without a precomputed snapshot.

---

## Canonical facts

- **Cache env**: `server/src/world/CacheEnv.ts` → `initCacheEnv(path)`.
- **Cache disk wrapper**: `server/src/world/cacheFs.ts`.
- **Collision service**: `server/src/world/MapCollisionService.ts`.
- **Collision overlays**: `server/src/world/CollisionOverlayStore.ts`.
- **Plane resolver**: `server/src/world/PlaneResolver.ts`.
- **Loc lookup**: `server/src/world/LocTileLookupService.ts`.
- **Loc transforms**: `server/src/world/LocTransforms.ts`.
- **Dynamic loc state**: `server/src/world/DynamicLocStateStore.ts`.
- **Door catalog**: `server/src/world/DoorCatalogFile.ts`.
- **Door definitions**: `server/src/world/DoorDefinitions.ts`.
- **Door loader**: `server/src/world/DoorDefinitionLoader.ts`.
- **Door collision**: `server/src/world/DoorCollisionService.ts`.
- **Door state manager**: `server/src/world/DoorStateManager.ts`.
- **Door runtime tile mapping**: `server/src/world/DoorRuntimeTileMappingStore.ts`.
- **Instance manager**: `server/src/world/InstanceManager.ts`.
- **Precomputed collision snapshot**: `server/cache/collision/`.
- **Cache directory**: `caches/` at the repo root.
