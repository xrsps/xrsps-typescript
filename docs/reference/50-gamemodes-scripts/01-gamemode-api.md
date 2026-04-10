# 50.1 — Gamemode API

A gamemode is any implementation of `GamemodeDefinition` (see `server/src/game/gamemodes/GamemodeDefinition.ts`). The server loads exactly one at boot, selected by the `gamemode` field in `ServerConfig`. This page documents the shape of the interface and how each callback is used.

## Skeleton

```ts
import { GamemodeDefinition, GamemodeInitContext } from "./GamemodeDefinition";
import type { PlayerState } from "../player";
import { IScriptRegistry, ScriptServices } from "../scripts/types";

export class MyGamemode implements GamemodeDefinition {
    readonly id = "my-gamemode";
    readonly name = "My Gamemode";

    // --- XP ---
    getSkillXpMultiplier(player: PlayerState): number {
        return 5; // 5× XP gains
    }

    // --- Drops ---
    getDropRateMultiplier(player: PlayerState | undefined): number {
        return 1;
    }
    transformDropItemId(npcTypeId: number, itemId: number, player: PlayerState | undefined): number {
        return itemId;
    }

    // --- Player rules ---
    canInteract(player: PlayerState): boolean {
        return true;
    }

    // --- Lifecycle ---
    initializePlayer(player: PlayerState): void {}
    serializePlayerState(player: PlayerState): Record<string, unknown> | undefined {
        return undefined;
    }
    deserializePlayerState(player: PlayerState, data: Record<string, unknown>): void {}
    onNpcKill(playerId: number, npcTypeId: number, combatLevel?: number): void {}

    // --- Login ---
    isTutorialActive(player: PlayerState): boolean {
        return false;
    }
    getSpawnLocation(player: PlayerState) {
        return { x: 3222, y: 3218, level: 0 };
    }
    onPlayerHandshake(player, bridge) {}
    onPlayerLogin(player, bridge) {}

    // --- Display ---
    getPlayerTypes(player, isAdmin) {
        return [];
    }

    // --- Scripts ---
    registerHandlers(registry: IScriptRegistry, services: ScriptServices) {
        // register NPC/loc/item/widget handlers here
    }

    // --- Init ---
    initialize(ctx: GamemodeInitContext) {}
}
```

## Callback reference

### XP

- **`getDefaultSkillXp?(skillId)`** — optional: override the starting XP for a skill. Used by Leagues to start combat skills at level 3 with corresponding XP.
- **`getSkillXpMultiplier(player)`** — plain multiplier over every XP award. Most gamemodes just return a constant.
- **`getSkillXpAward?(player, skillId, baseXp, ctx)`** — if defined, the exact XP amount to award. This wins over `getSkillXpMultiplier`. Use this when XP is non-linear (e.g. +1000% for a specific skill, or a diminishing curve).

### Drops

- **`getDropRateMultiplier(player)`** — scalar multiplier on drop rates.
- **`transformDropItemId(npcTypeId, itemId, player)`** — replace one item id with another on the drop table. Used by Leagues to swap vanilla drops for leagues-equivalents.
- **`getDropTable?(npcTypeId)`** — return a complete override drop table for an NPC. Returns `undefined` to use the default.
- **`getSupplementalDrops?(npcTypeId, player)`** — return extra drop entries appended on top of the default table.
- **`getLootDistributionConfig?(npcTypeId)`** — return an `NpcLootConfig` to change how loot is distributed between players who damaged the NPC (e.g. highest-damager-only vs shared).

### Player rules

- **`canInteract(player)`** — gate every click. Return false and the player can't do anything (used for a "frozen" tutorial state, for instance).
- **`canInteractWithNpc?(player, npcTypeId, option)`** — finer-grained per-NPC gate. If you want to forbid trading with Mac during the tutorial, this is where.

### Lifecycle

- **`initializePlayer(player)`** — called once when a player logs in for the very first time. Set starting varps / varbits / skills.
- **`serializePlayerState(player)`** / **`deserializePlayerState(player, data)`** — round-trip gamemode-specific player state (league points, relics, etc.) through the account store. The object you return is a JSON blob on disk.
- **`onNpcKill(playerId, npcTypeId, combatLevel?)`** — fired when a player gets a kill. Used for league task tracking.
- **`onItemCraft?(playerId, itemId, count)`** — fired when the player crafts an item.

### Login / handshake

- **`getLoginVarbits?(player)`** / **`getLoginVarps?(player)`** — list of `[id, value]` pairs to push to the client at login. Use for unlocking UI tabs, setting default volume, etc.
- **`isTutorialActive(player)`** — if true, the tutorial flow runs on login. The tutorial implementation lives in the gamemode.
- **`isTutorialPreStart?(player)`** — true for brand-new accounts still on the character-design screen.
- **`getSpawnLocation(player)`** — where to place a fresh player.
- **`onPlayerHandshake(player, bridge)`** — runs before the client fully enters the world. Useful for pushing initial varps via `bridge.sendVarp`.
- **`onPlayerLogin(player, bridge)`** — runs once the player is fully in-game. Good for sending welcome messages, showing tutorial overlays.
- **`onPlayerRestore?(player)`** — called after a reconnect restored an existing player without going through full login.
- **`onPostDesignComplete?(player)`** — called when the player finishes character design.
- **`resolveAccountStage?(player)`** — computes a gamemode-specific "stage" marker.

### Varps / widgets

- **`onVarpTransmit?(player, varpId, value, prev)`** — the player transmitted a varp via CS2. React before the regular varp handler.
- **`onWidgetOpen?(player, groupId)`** — fired when any widget group opens.
- **`onResumePauseButton?(player, widgetId, childIndex)`** — handle a "click to continue" button click. Return `true` if you consumed the event (so the regular handlers don't also run).

### Ticks

- **`onPlayerTick?(player, nowMs)`** — called every tick per player. Keep this cheap — it runs for everyone on the world.
- **`onPlayerDisconnect?(playerId)`** — cleanup hook.

### Display

- **`getPlayerTypes(player, isAdmin)`** — return the `PlayerType[]` used for name prefixes / icons (e.g. HCIM icon, moderator crown).

### Scripts

- **`registerHandlers(registry, services)`** — the big one. Register all your NPC / loc / item / widget / chat-command handlers here. The registry is the same `ScriptRegistry` that extrascripts use. See [50.2 — Script registry](./02-script-registry.md).
- **`getGamemodeServices?()`** — returns a record of gamemode-provided helper objects (leagues relics manager, etc.) that scripts can pull from.
- **`contributeScriptServices?(services)`** — mutate the shared `ScriptServices` object to add gamemode-specific methods. Used so that handlers can call `services.grantLeagueTask(...)` without knowing they're in Leagues.

### UI controller

- **`createUiController?(bridge)`** — return an object implementing `GamemodeUiController`. This is the hook the server uses to customize side-journal layout, tutorial overlays, and root widget layouts per gamemode.

### Content data

- **`getContentDataPacket?()`** — returns a binary blob sent to the client via `GAMEMODE_DATA` at login. Contains gamemode-specific static data (leagues tasks, area unlock table, etc.).

### Server lifecycle

- **`initialize(ctx)`** — called once at boot with `GamemodeInitContext`:
  - `npcTypeLoader`, `objTypeLoader` — look up NPC/item metadata.
  - `bridge: GamemodeBridge` — send messages to specific players.
  - `serverServices: GamemodeServerServices` — broader helper surface (inventory mutation, appearance refresh, chat messages, gamemode snapshots, tick callbacks, logger, event bus). See `GamemodeDefinition.ts` for the full method list.
- **`dispose?()`** — called at shutdown (currently rarely used because reloads require a restart).

## `GamemodeBridge` vs `GamemodeServerServices`

Two dependency surfaces, two purposes:

- **`GamemodeBridge`** — per-player mutation primitives. `getPlayer`, `queueVarp`, `queueVarbit`, `queueNotification`, `queueWidgetEvent`, `queueClientScript`, `sendGameMessage`. Intentionally small so gamemodes can be written without pulling in server internals.
- **`GamemodeServerServices`** — the broader surface used during `initialize()`. Includes inventory mutation (`addItemToInventory`, `sendInventorySnapshot`), appearance (`refreshAppearance`, `sendAppearanceUpdate`), combat snapshots, chat broadcast, snapshot encoders, tick callbacks, the event bus, and a logger. Use for one-time wiring, not per-player calls inside the tick loop.

## Registering your gamemode

Gamemodes are discovered by **directory name**, not by a hardcoded switch. Place your implementation under `server/gamemodes/<id>/` with an `index.ts` that exports a `createGamemode` function:

```ts
// server/gamemodes/my-gamemode/index.ts
import type { GamemodeDefinition } from "../../src/game/gamemodes/GamemodeDefinition";
import { MyGamemode } from "./MyGamemode";

export function createGamemode(): GamemodeDefinition {
    return new MyGamemode();
}
```

`GamemodeRegistry.createGamemode(id)` dynamically `require()`s `server/gamemodes/<id>/index` and calls the exported `createGamemode()`. A directory with no `index.ts`/`index.js` is not considered a gamemode; `listAvailableGamemodes()` returns the set of directories that do have one.

For per-gamemode data (shops, drop overrides, spawn overrides, defaults) use `server/data/gamemodes/<id>/`. `getGamemodeDataDir(id)` returns the absolute path.

## Canonical facts

- **Interface**: `server/src/game/gamemodes/GamemodeDefinition.ts`.
- **Registry**: `server/src/game/gamemodes/GamemodeRegistry.ts` (`createGamemode`, `getGamemodeDataDir`, `listAvailableGamemodes`).
- **Base class**: `server/src/game/gamemodes/BaseGamemode.ts` — helpful parent for cutting boilerplate.
- **Gamemode code dir**: `server/gamemodes/<id>/` (not inside `src/` — loaded via dynamic require).
- **Vanilla**: `server/gamemodes/vanilla/`.
- **Leagues V**: `server/gamemodes/leagues-v/`.
- **Data dir pattern**: `server/data/gamemodes/<id>/`.
- **Config selector**: `gamemode` field in `server/src/config/ServerConfig.ts`.
- **Required export**: `createGamemode(): GamemodeDefinition` from the gamemode's `index.ts`.
- **Rule**: a gamemode is selected at boot; switching gamemodes requires a restart.
