# 20.11 — Gamemode loader

The server loads _exactly one_ gamemode at boot. That gamemode defines the rules of play: XP rates, drop tables, shops, spells, quests, custom interfaces, boss encounters, everything. This page covers how gamemodes get discovered, instantiated, and hooked into the services.

## The entry point: `createGamemode(id)`

`server/src/game/gamemodes/GamemodeRegistry.ts` exposes exactly one function worth remembering:

```ts
export function createGamemode(id: string): GamemodeDefinition;
```

It:

1. Resolves `server/gamemodes/<id>/` and verifies the directory exists.
2. `require()`s `<id>/index.ts` (Node's CommonJS; gamemodes are loaded dynamically by name).
3. Calls the module's exported `createGamemode()` factory and returns the result.
4. Validates the returned object has `id` and `name` fields.

```ts
// server/src/index.ts
const gamemode = createGamemode(config.gamemode);
```

`config.gamemode` is the gamemode id from config (default `"vanilla"`). The factory runs all gamemode-side bootstrap side effects — registering providers, drop tables, script handlers, spawns, spell books, custom widgets.

### `getGamemodeDataDir(id)`

Also exported. Returns `server/data/gamemodes/<id>/` — the per-gamemode data directory where hand-authored content lives (shop tables, drop tables, custom spawns).

### `listAvailableGamemodes()`

Scans `server/gamemodes/` for subdirectories that contain an `index.ts` or `index.js`. Used for error messages and for a potential future "choose a gamemode" UI.

## `GamemodeDefinition` (`GamemodeDefinition.ts`)

The interface every gamemode returns. Key fields:

- **`id: string`** — matches the directory name.
- **`name: string`** — human-readable name shown in logs and UI.
- **`dispose?(): void`** — optional shutdown hook.
- **Provider registration functions** — called by the server to install spell data, combat formulas, drop tables, etc.
- **`getLootDistributionConfig?(npcTypeId): DistributionConfig | undefined`** — optional hook for the damage tracker.
- **UI controller**: `getUiController?(): GamemodeUiController` — UI hooks for tab layouts, tutorial overlays, side journals.
- **Script registration**: `registerHandlers?(scriptRegistry, services)` — run at boot to register NPC interactions, loc interactions, item interactions, widget clicks, chat commands.

### `GamemodeBridge`

An interface the gamemode uses to talk _back_ to the server. Exposed during `registerHandlers`. Has methods like:

- `getPlayer(playerId)`
- `queueVarp`, `queueVarbit`
- `queueNotification`
- `queueWidgetEvent`
- `queueClientScript`
- `sendGameMessage`

These are the _only_ methods a gamemode should use to poke at player state. They queue actions to be executed in the next appropriate tick phase, rather than mutating state directly.

### `GamemodeServerServices`

A wider surface that some gamemode features need: inventory operations, equipment updates, combat snapshots, chat broadcasting, appearance refreshes. Exposed separately from the bridge to make the boundary explicit — if your gamemode needs one of these, you're probably doing something that the core server should maybe own.

## Shipped gamemodes

### `vanilla` (`server/gamemodes/vanilla/`)

The faithful OSRS recreation: standard XP rates, OSRS-style combat formulas, default spells, default drop tables. Used as the baseline.

### `leagues-v` (`server/gamemodes/leagues-v/`)

A "Leagues" variant — modified XP rates, relic system, accelerated progression, custom interfaces. Shows what a substantial gamemode override looks like. Registers its own spell book, custom widgets, relic NPCs, drop table overrides, and a UI controller for the relic interface.

The leagues gamemode is where you should look first if you're trying to understand how to build a heavily-customized experience.

## Extrascripts

Extrascripts are drop-in extensions that layer _on top_ of a gamemode. They live under `server/extrascripts/<name>/` and are discovered via `ExtrascriptLoader.ts` at boot.

An extrascript:

- Has its own `index.ts` exporting a `registerExtrascript(registry, services)` function.
- Can register the same kinds of hooks as a gamemode (NPC interactions, widget clicks, loc handlers).
- Cannot replace providers — that's the gamemode's job. It can only add behavior.

### `item-spawner` (`server/extrascripts/item-spawner/`)

The canonical example extrascript. Adds a developer-only interface for spawning any item. Useful for testing. Registers:

- A custom widget group for the spawner UI.
- A chat command `::spawn <itemid> [qty]`.
- Hooks into the widget GL layer (via a custom widget under `src/ui/widgets/custom/`) to render the panel.

It's the simplest complete example of extending the game without modifying the gamemode.

### Loading extrascripts

`ExtrascriptLoader` is called during the gamemode's boot phase (the gamemode decides whether to load any). The loader scans the extrascripts directory, loads each one whose folder name is listed in the gamemode's config, and calls its register function.

This means:

- A gamemode can enable or disable extrascripts.
- Extrascripts are loaded _after_ gamemode providers, so they can see the final provider set.
- Extrascripts can be hot-reloaded in development (dev mode re-runs the loader on file changes).

## Data directory

`server/data/gamemodes/<id>/` is where the gamemode stores hand-authored data: shop definitions, drop tables, loot configs, custom spawn files. The gamemode's boot code reads these at startup.

For shared data (items, NPC combat stats, teleport destinations, loc effects), see `server/src/data/` — these files are engine-shared and gamemodes read from them directly.

## Gamemode lifecycle

```
Boot
 ├── createGamemode(id)
 │    ├── require gamemodes/<id>/index.ts
 │    ├── gamemode.registerProviders(providerRegistry)
 │    ├── gamemode.registerHandlers(scriptRegistry, bridge)
 │    ├── gamemode.loadData(dataDir)
 │    └── gamemode.loadExtrascripts(extrascriptLoader)
 ├── WSServer boots with the gamemode
 └── ticker.start()

Shutdown
 └── gamemode.dispose?.()
```

There is no reload-at-runtime; changing the active gamemode means restarting the server.

## Testing a gamemode

`server/src/game/testing/` has helpers to construct a minimal `ServerServices` and load a gamemode for unit tests. Tests live alongside the gamemode code under `server/gamemodes/<id>/__tests__/`.

---

## Canonical facts

- **Registry**: `server/src/game/gamemodes/GamemodeRegistry.ts` → `createGamemode(id)`.
- **Definition interface**: `server/src/game/gamemodes/GamemodeDefinition.ts`.
- **Base class helpers**: `server/src/game/gamemodes/BaseGamemode.ts`.
- **Gamemodes directory**: `server/gamemodes/`.
- **Gamemode data directory**: `server/data/gamemodes/`.
- **Extrascript loader**: `server/src/game/scripts/ExtrascriptLoader.ts`.
- **Extrascripts directory**: `server/extrascripts/`.
- **Shipped gamemodes**: `vanilla`, `leagues-v`.
- **Shipped extrascripts**: `item-spawner`.
- **Rule**: gamemodes register providers via `providerRegistry`; they do not monkey-patch services.
- **Rule**: gamemodes call back into the server through `GamemodeBridge` / `GamemodeServerServices`, not by importing internals.
