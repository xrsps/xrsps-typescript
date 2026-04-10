# 50.5 — Built-in gamemodes

XRSPS ships two gamemodes out of the box. Both live under `server/gamemodes/<id>/` and are loaded by directory name through `GamemodeRegistry.createGamemode(id)`.

## `vanilla`

The default gamemode. Recreates the OSRS ruleset as faithfully as XRSPS implements it.

```
server/gamemodes/vanilla/
├── banking/           bank interface handlers + tab layout
├── combat/            combat formula, ammo, styles, specials
├── data/              JSON content (shops, spawns, drop tables)
├── equipment/         equipment slots + bonuses
├── index.ts           exports createGamemode()
├── modals/            dialogue modal definitions
├── prayer/            prayer book definitions
├── scripts/           NPC / loc / item scripts
├── shops/             shop definitions + stock curves
├── skills/            skill-specific action handlers (mining, fishing, cooking…)
├── state/             sub-state types
├── systems/           long-running systems (e.g. farming growth)
└── widgets/           vanilla-flavored widget hooks
```

Key integration points:

- `createGamemode()` in `index.ts` returns a `GamemodeDefinition` that delegates to files under the subfolders.
- `registerHandlers` walks the `scripts/` directory and registers everything against the `ScriptRegistry`.
- `initialize` wires up systems that need tick callbacks (farming, shops) via `services.registerTickCallback`.

The vanilla gamemode serves as both the default runtime and the reference for how to structure a full content pack.

### Data files (`server/data/gamemodes/vanilla/`)

- **`player-state.json`** — starter inventory, equipment, skills, spawn coordinates.

The vanilla code reads more content (shop tables, drop tables, NPC stats) from `server/data/` at the top level, which is shared across gamemodes. The gamemode-specific data dir is reserved for overrides.

## `leagues-v`

The "Leagues V" experimental gamemode — a rewritten vanilla with accelerated XP, task-based progression, relics, and area unlocks. It mirrors the OSRS Leagues V event.

```
server/gamemodes/leagues-v/
├── LeagueContentProvider.ts
├── LeagueMasteryDefinitions.ts
├── LeagueTaskDefinitions.ts
├── LeagueTaskIndex.ts
├── LeagueTaskManager.ts
├── LeagueTaskService.ts
├── LeaguesVUiController.ts
├── data/              task data, area unlocks, relic definitions
├── index.ts           exports createGamemode()
├── leagueDrops.ts     drop table transformations
├── leagueGeneral.ts   catch-all helpers
├── leaguePackedVarps.ts packed varp encode/decode
├── leagueSummary.ts   login summary builder
├── leagueXp.ts        XP rules (mapped through getSkillXpAward)
├── playerWorldRules.ts area gating
├── scripts/           league-specific NPC scripts (task givers)
└── triggers/          event triggers (on skill XP, on npc kill)
```

Key integration points:

- **`LeagueTaskManager`** — owns the authoritative list of task states per player. Persisted via `serializePlayerState` / `deserializePlayerState`.
- **`LeagueTaskService`** — registers event listeners on the event bus for skill XP, NPC kills, item crafts, etc. Each event is checked against the task index to mark tasks complete.
- **`LeaguesVUiController`** — returned from `createUiController`. Provides the side-journal layout and the task-progress overlay.
- **`LeagueContentProvider.getContentDataPacket()`** — returns a packed `GAMEMODE_DATA` blob containing the full task list, mastery definitions, and relics. The client decodes it at login and caches the result for the session.
- **`leagueXp.getSkillXpAward`** — replaces the flat XP multiplier with a task-based scaling curve.
- **`leagueDrops.transformDropItemId`** — swaps vanilla drops for league equivalents.
- **`playerWorldRules.canInteract`** — gates interactions based on which areas the player has unlocked.

### Data files (`server/data/gamemodes/leagues-v/`)

- **`player-defaults.json`** — starter loadout for a fresh league account (different from vanilla).

Task definitions and area unlock data are bundled into the module itself rather than loaded from JSON.

## How they differ from a minimal gamemode

Vanilla and Leagues V both extend `BaseGamemode` (`server/src/game/gamemodes/BaseGamemode.ts`), which provides:

- A `DefaultUiController` implementation of `GamemodeUiController`.
- Sensible defaults for every optional method.
- A `scriptServices: Record<string, unknown>` that subclasses populate via `contributeScriptServices`.

A minimal gamemode can either extend `BaseGamemode` (recommended) or implement `GamemodeDefinition` directly.

## Adding a third gamemode

1. Create `server/gamemodes/my-gamemode/` with an `index.ts` that exports `createGamemode(): GamemodeDefinition`.
2. Create `server/data/gamemodes/my-gamemode/` for any data files.
3. Set `gamemode: "my-gamemode"` in your server config.
4. Restart the server.

See [50.1 — Gamemode API](./01-gamemode-api.md) for the full interface.

## Canonical facts

- **Gamemode code root**: `server/gamemodes/`.
- **Gamemode data root**: `server/data/gamemodes/`.
- **Vanilla entry**: `server/gamemodes/vanilla/index.ts`.
- **Leagues V entry**: `server/gamemodes/leagues-v/index.ts`.
- **Base class**: `server/src/game/gamemodes/BaseGamemode.ts`.
- **Default UI controller**: `DefaultUiController` exported from `BaseGamemode.ts`.
- **Rule**: gamemodes are loaded by directory name via dynamic require.
