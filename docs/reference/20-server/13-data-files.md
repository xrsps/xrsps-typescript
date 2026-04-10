# 20.13 — Data files (`server/src/data/` and `server/data/`)

Two "data" directories with different audiences:

- **`server/src/data/`** — TypeScript files compiled into the server binary. Hand-authored engine data.
- **`server/data/`** — JSON, text, and per-gamemode content loaded at runtime.

Keep them straight: source-level data is refactored with the code; runtime data can be edited without recompiling.

## `server/src/data/` — compiled data

Small, typed tables that the engine needs from boot and that are tightly coupled to the code.

### `items.ts`

Item metadata the server needs on top of what the cache provides: eaten healing amounts, potion doses, equipment overrides, stackable overrides, untradeable flags, notedness rules, item-on-item crafting results.

This is **not** the cache `ObjType`. The cache holds the 3D model, inventory icon, and name; `items.ts` holds the _gameplay_ behavior that OSRS doesn't have a corresponding cache field for.

### `npcCombatStats.ts`

Per-NPC combat stats: attack, strength, defence, magic, ranged, hp, attack style, attack speed. Keyed by NPC type id. NPCs not listed fall back to stats derived from cache-level combat data.

### `locEffects.ts`

Hand-authored effects for specific loc interactions: "this ladder goes to plane 1", "this trapdoor triggers an instance", "this chest opens a shop". Loc types that aren't in this table use a default handler.

### `teleportDestinations.ts`

Named teleport destinations (home, Varrock, Falador, etc.) with their world coordinates. Used by teleport tabs, spell book entries, and commands.

### `spellWidgetLoader.ts`

Not data per se — it's the loader that reads the cache's spell widget and cross-references against the spell data registered by the gamemode. Lives here because the resulting data shape is static after boot.

## `server/data/` — runtime data

Loaded from disk at boot and reloaded periodically in some cases.

### `npc-spawns.json`

The NPC spawn list (see [20.5 — NPCs](./05-npcs.md)). A JSON array of `{ typeId, x, y, plane, walkRange, aggroRange, ... }` entries. Hand-edited.

### `accounts/`

Per-account JSON files. One file per username. See [20.10 — Persistence](./10-persistence.md).

### `gamemodes/<id>/`

Per-gamemode data: shop tables, drop tables, custom spawn overrides, dialogue tables. Each gamemode reads from its own subdirectory. The `vanilla` and `leagues-v` gamemodes each have their own.

## Adding a new item

If you want a new item that _already_ exists in the cache, you don't touch `items.ts` unless the item has unusual behavior (e.g., it heals for X, it's untradeable). You just register an interaction handler via `ScriptRegistry.registerItemInteraction(itemId, option, handler)` in the gamemode.

If you want an entirely new item that isn't in the cache, you need to add it to the cache — which is outside the scope of the TypeScript server and requires tools from the XRSPS cache build pipeline (see `scripts/` at repo root). For most development, start from an existing item id.

## Adding a new NPC

1. Check that the NPC type id exists in the cache (or pick an existing type to reskin/transform).
2. Add a spawn entry to `server/data/npc-spawns.json`.
3. (Optional) Add combat stats to `server/src/data/npcCombatStats.ts`.
4. (Optional) Register an interaction handler in your gamemode.
5. Restart the server. NPCs don't hot-reload.

## Adding a new shop

Shops are a gamemode concern. The gamemode keeps a shop table in `server/data/gamemodes/<id>/shops.json` (or similar), reads it at boot, and registers shop interaction handlers that open the shop widget and populate it from the table.

See the `vanilla` gamemode for the standard pattern.

## Adding a new teleport

1. Add an entry to `teleportDestinations.ts` with the name and coordinates.
2. If it should appear in the spell book, register a spell handler in your gamemode that targets the new destination.
3. If it should be a tab or scroll, register an item interaction handler that teleports on use.

## Reloading data

Most data files are loaded once at boot. Reloading means restarting the server. The only exceptions are:

- Extrascripts (hot reloaded in dev).
- Per-gamemode debug overrides (if the gamemode implements a reload hook).

Don't assume hot reload works — test by restarting.

---

## Canonical facts

- **Compiled data directory**: `server/src/data/`.
- **Item overrides**: `server/src/data/items.ts`.
- **NPC combat stats**: `server/src/data/npcCombatStats.ts`.
- **Loc effects**: `server/src/data/locEffects.ts`.
- **Teleport destinations**: `server/src/data/teleportDestinations.ts`.
- **Spell widget loader**: `server/src/data/spellWidgetLoader.ts`.
- **Runtime data directory**: `server/data/`.
- **NPC spawn list**: `server/data/npc-spawns.json`.
- **Accounts directory**: `server/data/accounts/` (default; see `config.accountsFilePath`).
- **Gamemode data**: `server/data/gamemodes/<id>/`.
