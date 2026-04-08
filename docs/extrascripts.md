# Extrascripts

Extrascripts are **optional content modules** that work independently of which gamemode is running. They're for universal functionality — things like debug tools, admin commands, or content that should exist on any server regardless of gamemode.

Extrascripts live in `server/extrascripts/{id}/` and export a `register` function.

## Creating an Extrascript

### 1. Create the directory

```
server/extrascripts/my-script/
  index.ts
```

### 2. Export a register function

```typescript
// server/extrascripts/my-script/index.ts
import type { IScriptRegistry, ScriptServices } from "../../src/game/scripts/types";

export function register(registry: IScriptRegistry, services: ScriptServices): void {
    registry.registerCommand("hello", (event) => {
        services.messaging.sendGameMessage(event.player, "Hello from my extrascript!");
    });
}
```

That's it. Drop a folder in `server/extrascripts/` with an `index.ts` exporting `register`, and it loads automatically at startup. No configuration needed.

## What extrascripts can do

Extrascripts have access to the same `IScriptRegistry` and `ScriptServices` as gamemodes. They can register:

- **Commands** — `::mycommand` chat commands
- **NPC interactions** — talk-to, attack, pickpocket, etc.
- **Loc interactions** — object click handlers
- **Item actions** — inventory item options, item-on-item, item-on-loc
- **Widget buttons** — UI button click handlers
- **Region events** — enter/leave region triggers
- **Tick handlers** — per-tick logic

## Load Order

1. Gamemode calls `registerHandlers()` first
2. All extrascripts call `register()` after

Extrascript handlers run alongside gamemode handlers. If both register a handler for the same interaction, both will be evaluated — the registry determines priority.

## Hot Reload

Extrascripts support hot-reload during development. Set the `SCRIPT_HOT_RELOAD=1` environment variable and the server will watch for file changes, reloading extrascripts without a full restart.

## Gamemodes vs Extrascripts

| Use case | System |
|----------|--------|
| Server-specific rules (XP rates, tutorials, progression) | [Gamemode](gamemodes.md) |
| Universal tools (debug commands, admin utilities) | Extrascript |
| Content that only matters for one server type | Gamemode `registerHandlers()` |
| Content that should work on any server | Extrascript |

**Rule of thumb:** if it makes sense on every server, it's an extrascript. If it defines or changes how the server plays, it's a gamemode.

## Bundled Extrascripts

| Extrascript | Description |
|-------------|-------------|
| `item-spawner` | Admin debug tool — custom widget for searching and spawning items. Uses `CustomItemBuilder` and `CustomWidgetRegistry` for custom UI. Command: `::itemspawner` |

## Skill Implementations

Skills are owned by the vanilla gamemode and registered via its `registerHandlers()` call. Gamemodes that extend vanilla (such as Leagues V) inherit all skill handlers through `super.registerHandlers()`.

Skills register their own action handlers via `registerActionHandler`, making them fully self-contained — the engine has no hardcoded knowledge of any skill's logic.

```
server/gamemodes/vanilla/skills/
├── index.ts                 # Aggregates sub-module register calls
├── consumables/             # Food eating, potion drinking
├── crafting/                # Flax picking, spinning wheel
├── firemaking/              # Fire lighting
├── fishing/                 # Fishing spots, minnow exchange
├── fletching/               # Log cutting, bow stringing, arrow/bolt combining
├── herblore/                # Herb cleaning, potions, stamina
├── mining/                  # Rock mining
├── prayer/                  # Bone burying, ash scattering, altar offering
├── production/              # Cooking, tanning, bolt enchanting
├── sailing/                 # Sailing, pandemonium
├── smithing/                # Smithing, smelting
├── thieving/                # NPC pickpocketing, lock picking
└── woodcutting/             # Tree chopping
```
