# 50.3 — Extrascripts

Extrascripts are opt-in per-feature plugins that live in `server/extrascripts/`. Each one is a directory containing an `index.ts` that exports a `register` function. At boot the server scans the directory, loads every module, and calls `register(scriptRegistry, scriptServices)` on each.

Think of them as "the part of a MUD that's not the core engine". They add NPCs, items, commands, widgets — content that doesn't need to alter the rules of the world.

## Anatomy

Minimum file layout:

```
server/extrascripts/my-feature/
├── index.ts            ← required
└── (anything else)     ← your implementation
```

Minimum `index.ts`:

```ts
import type { IScriptRegistry, ScriptServices } from "../../src/game/scripts/types";

export function register(registry: IScriptRegistry, services: ScriptServices): void {
    registry.registerCommand("hello", async (ctx) => {
        ctx.services.chat.sendGameMessage(ctx.player, "Hello from my-feature!");
    });
}
```

That's it. Drop the directory into `server/extrascripts/`, restart (or wait for hot reload) and `::hello` works in-game.

## Loader behavior

`ExtrascriptLoader.loadExtrascriptEntries()` (`server/src/game/scripts/ExtrascriptLoader.ts`) does:

1. Read the `server/extrascripts/` directory.
2. For each subdirectory, look for `index.ts` (preferred) or `index.js`.
3. `require()` it eagerly — any throw at module load time fails the whole extrascript discovery.
4. Check that the module exports a `register` function. If not, warn and skip.
5. Return an `ExtrascriptEntry { id, register, watch }` list.

Every entry has an `id` of the form `extrascript.<folder-name>`. The `watch` list contains the loaded index file so the dev loop can re-run on changes.

## Lifecycle

During server boot:

1. `bootstrap.ts` constructs the `ScriptRegistry`.
2. The current gamemode's `registerHandlers` runs first (vanilla / leagues-v content).
3. `loadExtrascriptEntries()` runs next.
4. Each entry's `register(registry, services)` is called.
5. `ScriptRuntime` starts dispatching player actions.

Load order is the filesystem order of the subdirectories. Don't rely on it — if two extrascripts register handlers for the same exact key, the later one wins and the registry logs a warning.

## Hot reload

In dev (`mprocs` + `tsx` on the server), edits to `server/extrascripts/<name>/index.ts` trigger a reload that:

1. Unregisters the previous module's handlers.
2. Re-imports the module.
3. Calls `register` again.

The unregister path uses the `{ unregister }` handles returned from every `registry.register*` call. **Your extrascript must hold onto those handles if you want clean hot reload.** A reload-safe extrascript looks like:

```ts
let handles: { unregister: () => void }[] = [];

export function register(registry: IScriptRegistry, services: ScriptServices): void {
    // Clean up previous registrations from a prior hot reload.
    for (const h of handles) h.unregister();
    handles = [];

    handles.push(
        registry.registerCommand("hello", async (ctx) => {
            ctx.services.chat.sendGameMessage(ctx.player, "Hello!");
        }),
    );
}
```

The loader does not automatically track your handles — it's a per-extrascript responsibility.

## Accessing `ScriptServices`

The second argument to `register` is a `ScriptServices` — a trimmed-down view of `ServerServices` scoped to what scripts are allowed to touch. Typical members:

- **`services.chat.sendGameMessage(player, text)`** — chat.
- **`services.inventory.addItem(player, itemId, qty)`** — inventory mutation.
- **`services.dialog.queueWidgetEvent(playerId, event)`** — push a widget update.
- **`services.skills.addXp(player, skillId, xp)`** — grant XP.
- **`services.npcs.spawn(...)` / `services.locs.change(...)`** — world mutation.
- **`services.items.resolve(query)`** — item lookup by name or id.
- (and others — see `scripts/serviceInterfaces.ts`)

Not every field is populated — some are added by the current gamemode via `contributeScriptServices`. Check for `undefined` if you're writing an extrascript that might load under multiple gamemodes.

## The built-in example: `item-spawner`

`server/extrascripts/item-spawner/` is a worked example. It:

1. Registers a custom item (id 50100, "Item Spawner") via `CustomItemBuilder` + `CustomItemRegistry`.
2. Registers a custom widget group via `CustomWidgetRegistry` (the `widget/itemSpawner.cs2.ts` submodule builds the group definition).
3. Registers an inventory action on the spawner item that opens the custom widget.
4. Handles the `ITEM_SPAWNER_SEARCH` client packet via a widget-action handler that searches the item index and streams results back via widget set-text / set-item.
5. Handles the result-slot click to grant the searched-for item to the player.

Read the source alongside [50.4 — Custom widgets](./04-custom-widgets.md) to see how the custom widget side works. The `register` function is the bottom of `index.ts`.

## When to use an extrascript vs a gamemode

| Task | Where |
|---|---|
| "Make Hans in Lumbridge say hello" | Extrascript |
| "Add an admin `::spawn` command" | Extrascript |
| "Add a new boss + drop table" | Extrascript (or gamemode-data if you want it off by default) |
| "5× XP everywhere" | Gamemode |
| "Turn all food into sharks" | Gamemode (`transformDropItemId`) |
| "Add a Leagues-style task journal" | Gamemode (needs custom UI + content data packet) |
| "Add a new skill" | Gamemode (touches skill enumeration) |

Anything that changes the *rules* → gamemode. Anything that adds *content* that coexists with vanilla → extrascript.

## Canonical facts

- **Directory**: `server/extrascripts/`.
- **Loader**: `server/src/game/scripts/ExtrascriptLoader.ts`.
- **Entry shape**: `ExtrascriptEntry { id, register, watch }`.
- **Required export**: a function named `register(registry, services)`.
- **Example**: `server/extrascripts/item-spawner/`.
- **Hot reload**: extrascripts own their `{ unregister }` handles; the loader does not track them automatically.
- **Load order**: directory order — do not depend on it.
- **Rule**: extrascripts coexist with the gamemode; they share the same `ScriptRegistry` and `ScriptServices`.
