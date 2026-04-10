# 30 — Shared code (`src/shared/`)

`src/shared/` holds types, enums, and small data structures used by _both_ the client and the server. Code here must not import from `src/client/`, `src/ui/`, `src/rs/` (for runtime values), `src/network/`, or anything under `server/src/`. It's pure TypeScript — types and plain functions only.

This directory is how the client and server stay in lockstep on protocol opcodes, packet shapes, and domain enums.

## Directory map

```
src/shared/
├── CollisionFlag.ts          tile collision bit flags
├── Direction.ts              8-direction enum + utilities
├── vars.ts                   varp/varbit constants
├── collectionlog/            collection log JSON data
├── debug/                    PerfSnapshot type
├── gamemode/                 shared gamemode content types
├── input/                    modifier flags enum
├── instance/                 instance type enum
├── items/                    client item search index
├── network/                  (sparse) ClientPacketId alias
├── packets/                  ClientPacketId + ServerPacketId (the main packet enums)
├── projectiles/              projectile launch + delivery types
├── spells/                   selected spell payload type
├── ui/                       widget-shared types (widget roles, side journal, etc.)
└── worldentity/              world entity type enum
```

## Key files

### `CollisionFlag.ts`

Bit constants for tile collision:

- `BLOCK_TILE` — tile is completely blocked.
- `BLOCK_TILE_FLOOR` — tile has a floor blocker.
- `BLOCK_NW`, `BLOCK_N`, `BLOCK_NE`, `BLOCK_E`, `BLOCK_SE`, `BLOCK_S`, `BLOCK_SW`, `BLOCK_W` — directional wall blockers on the tile's edges.
- Plus some combined helpers and inverse flags.

Used by both the server's `MapCollisionService` and the client's `CollisionMap`. When the client runs local movement prediction, it reads the same flags the server uses.

### `Direction.ts`

The 8-direction enum and small helpers to turn direction values into (dx, dy), rotate clockwise/counter-clockwise, compute the shortest rotation between two directions. These are used in path stepping, facing, and animation.

### `vars.ts`

Numeric constants for varps and varbits the engine references by name: run energy varp, prayer book varbit, weapon category varbit, autocast varp, etc. Keeping them shared means a varp mismatch between client and server would be a compile error rather than a runtime surprise.

### `packets/ClientPacketId.ts` and `packets/ServerPacketId.ts`

The single source of truth for packet opcodes. Both enums include every packet both sides know about.

**Rule:** if you add a new packet, you add it to the enum first, then implement the encoder and the decoder on both sides. The compile errors will walk you through the rest.

### `projectiles/`

- **`ProjectileLaunch.ts`** — the shared shape of a projectile launch event (source, target, type, start tick, arc height, arrival delay).
- **`projectileDelivery.ts`** — computes delivery ticks and trajectories shared by client visuals and server damage timing.
- **`projectileHeights.ts`** — pre-computed ballistic heights for each projectile type.

### `spells/selectedSpellPayload.ts`

Typed payload for "player has a spell selected and is targeting something". Shared because both the client (for hover highlighting) and the server (for validation) need to understand the same shape.

### `instance/InstanceTypes.ts`

Enum of instance types (regular world, POH, dungeon, minigame, boss room). Used by both the client (to render differently) and the server (to scope sync).

### `ui/`

Types shared between the widget runtime and the server's widget broadcaster:

- **`widgets.ts`** — widget group constants.
- **`widgetUid.ts`** — the composite widget UID ((groupId << 32) | childIndex).
- **`widgetRoles.ts` / `widgets/`** — semantic groupings of widget IDs (bank, inventory, spellbook).
- **`sideJournal.ts`** — side journal tab state.
- **`accountSummary.ts`** — login-time account summary shape.
- **`leagueSummary.ts`** — leagues gamemode summary.
- **`music.ts`** — music track metadata shape.
- **`indexedMenu.ts`** — right-click menu shared types.

### `input/modifierFlags.ts`

Keyboard modifier flags as a bit enum (SHIFT, CTRL, ALT, META). Client sends these on clicks; server reads them to differentiate shift-click behaviors.

### `items/CacheItemSearchIndex.ts`

A client-side item search index shape that's shared so the server can use the same type in tests. Not used on the server at runtime.

### `worldentity/WorldEntityTypes.ts`

Enum of world entity types (boat, ship, wagon). Used by both the sync system and the client renderer.

### `gamemode/`

- **`GamemodeContentStore.ts`** — shared content store interface for gamemode data.
- **`GamemodeDataTypes.ts`** — the shared shapes for shop tables, drop tables, spawn lists.

### `collectionlog/collection-log.json`

The collection log definition data. Loaded by both sides so the UI and server have the same entries.

### `debug/PerfSnapshot.ts`

The shape of a performance snapshot produced by the client and optionally uploaded to the server for debugging.

## Rules for shared code

1. **No runtime imports from layered packages.** No imports from `src/client/`, `src/ui/`, `src/rs/`, `src/network/`, or `server/src/`. Types from these are fine only if they can be type-only imports (`import type`).
2. **No DOM.** This code runs in Node, too.
3. **No `async` / `await`.** Keep it pure.
4. **No side effects at module scope.** A top-level `new X()` in shared code means both the client and server construct it on boot, which is almost always a bug.
5. **Enums are const enums where possible.** Const enums inline numeric values at compile time, avoiding an import cycle.

If you find yourself wanting to put something in `src/shared/` but need a runtime behavior that depends on the client or server, the answer is usually "make it an interface in `shared/` and have each side implement it".

## Canonical facts

- **Collision flags**: `src/shared/CollisionFlag.ts`.
- **Direction enum**: `src/shared/Direction.ts`.
- **Varp/varbit constants**: `src/shared/vars.ts`.
- **Client → server opcodes**: `src/shared/packets/ClientPacketId.ts`.
- **Server → client opcodes**: `src/shared/packets/ServerPacketId.ts`.
- **Instance types**: `src/shared/instance/InstanceTypes.ts`.
- **World entity types**: `src/shared/worldentity/WorldEntityTypes.ts`.
- **Projectile launch shape**: `src/shared/projectiles/ProjectileLaunch.ts`.
- **Projectile delivery**: `src/shared/projectiles/projectileDelivery.ts`.
- **Projectile heights**: `src/shared/projectiles/projectileHeights.ts`.
- **Selected spell payload**: `src/shared/spells/selectedSpellPayload.ts`.
- **Widget UID helper**: `src/shared/ui/widgetUid.ts`.
- **Widget roles**: `src/shared/ui/widgets/` and `src/shared/ui/widgets.ts`.
- **Side journal**: `src/shared/ui/sideJournal.ts`.
- **Account summary**: `src/shared/ui/accountSummary.ts`.
- **League summary**: `src/shared/ui/leagueSummary.ts`.
- **Music metadata**: `src/shared/ui/music.ts`.
- **Indexed menu**: `src/shared/ui/indexedMenu.ts`.
- **Modifier flags**: `src/shared/input/modifierFlags.ts`.
- **Gamemode content store**: `src/shared/gamemode/GamemodeContentStore.ts`.
- **Gamemode data types**: `src/shared/gamemode/GamemodeDataTypes.ts`.
- **Cache item search index**: `src/shared/items/CacheItemSearchIndex.ts`.
- **Collection log data**: `src/shared/collectionlog/collection-log.json`.
- **Perf snapshot**: `src/shared/debug/PerfSnapshot.ts`.
- **Rule**: no runtime imports from layered packages — type-only or nothing.
- **Rule**: no DOM, no top-level side effects, no module-scope state.
