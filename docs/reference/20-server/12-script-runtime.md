# 20.12 — Script runtime

Scripts are the glue between world events (a player clicks an NPC, a player casts a spell, a loc is interacted with) and the code that runs in response. The script runtime is what gamemodes and extrascripts use to register those handlers and what the tick loop uses to invoke them.

This is where "when you talk to Hans, he says hello" lives.

## `ScriptRegistry` (`server/src/game/scripts/ScriptRegistry.ts`)

The table of registered handlers. Written once at boot by the gamemode and extrascripts, read at runtime by the tick loop. Registration methods include:

- `registerNpcInteraction(npcId, handler)` — called when a player left-clicks or selects a menu option on a specific NPC.
- `registerNpcInteractionByName(name, handler)` — match by NPC name instead of id (useful when the same name is shared across many id variants).
- `registerLocInteraction(locId, handler)` — clicks on a loc (door, tree, rock).
- `registerItemInteraction(itemId, option, handler)` — right-click action on an inventory item ("eat", "drop", "examine").
- `registerItemOnItem(srcId, targetId, handler)` — using one item on another.
- `registerItemOnLoc(itemId, locId, handler)` — using an item on a loc (e.g., tinderbox on a fire).
- `registerItemOnNpc(itemId, npcId, handler)` — using an item on an NPC.
- `registerWidgetInteraction(groupId, childIndex, handler)` — clicks on a widget button.
- `registerChatCommand(prefix, handler)` — chat commands starting with a prefix (`::spawn`).

Wildcards are supported via `ANY_ITEM_ID` and `ANY_LOC_ID` constants — useful when you want a fallthrough "anything using this item" handler.

### Handler signature

Handlers all take a single event object with:

- **`tick: number`** — the current tick.
- **`services: ScriptServices`** — a narrow services facade exposed to scripts.
- **`player: PlayerState`** — the player who triggered the event.
- An event-specific payload: `npc`, `locId`, `source/target slot`, etc.

Handlers can be sync or async. Async handlers are awaited but the loop does not block on them between ticks — the next tick still fires on schedule.

### `ScriptServices`

A _restricted_ view of `ServerServices` for scripts. It exposes the methods gamemodes should use (inventory add/remove, chat, varp, walk-to, teleport, spawn item, etc.) and hides the things they shouldn't touch directly (raw service internals, packet buffers, persistence).

The narrow surface is defined in `server/src/game/scripts/serviceInterfaces.ts`. It's deliberately conservative; when a new script needs access to a new service method, that method is added explicitly to the interface rather than exposing the full services object.

## `ScriptRuntime` (`server/src/game/scripts/ScriptRuntime.ts`)

The runtime half. Called by the tick phase service during the `scripts` and `post_scripts` phases. Responsibilities:

1. Drain the action scheduler's queue of pending script-triggering actions.
2. For each action, look up the right handler in `ScriptRegistry`.
3. Build the event payload.
4. Invoke the handler inside a try/catch so a misbehaving script doesn't take down the tick.
5. Collect any queued side effects (varp writes, inventory changes, chat messages) and dispatch them through the services.

The runtime is _not_ reentrant: a script can't trigger another script mid-execution. If a script wants to chain, it queues a follow-up action that will run on the next tick.

## `CustomWidgetRegistry` (`CustomWidgetRegistry.ts`)

For widgets that aren't in the OSRS cache — custom interfaces that gamemodes or extrascripts want to add. Registration provides:

- A widget group id (chosen from a reserved custom range).
- A handler for open/close.
- A bridge for button clicks.

The client side of a custom widget is under `src/ui/widgets/custom/`.

## `ExtrascriptLoader` (`ExtrascriptLoader.ts`)

Loads extrascripts from `server/extrascripts/`. Called by the gamemode's boot hook. Walks the extrascripts directory, for each one whose folder name is listed in the loader config, imports the module and calls its `registerExtrascript(registry, services)` function.

Hot reload: in development, `ExtrascriptLoader` watches the extrascripts directory with `fs.watch` and reloads changed extrascripts without restarting the server. Reload means "unregister old handlers, re-import, re-register" — the script's state is lost. Persistent state belongs on `PlayerState`, not in the extrascript module.

## `bootstrap.ts`

Runs at gamemode creation time to register the engine's built-in default script handlers (emote animations, teleport tabs, clue scroll base behavior). Gamemodes can override any of these by registering their own handler for the same target.

## `utils/`

Helpers used by script handlers: distance checks, direction math, inventory transaction helpers. Thin wrappers that make script code read well.

## Action queue

Scripts don't run directly from packet handlers; they run via queued actions. The sequence is:

```
Packet handler (pre_movement phase)
 └── ActionScheduler.schedule(action)

Scripts phase
 └── ActionDispatchService.dispatchAll()
      └── for each action:
           └── resolve to handler via ScriptRegistry
                └── runtime invokes handler
```

This decoupling is why you can safely register handlers from multiple places (the gamemode, an extrascript, the engine's bootstrap) without racing.

## A complete mini-example

A gamemode registering a "talk to Hans" handler:

```ts
export function createGamemode(): GamemodeDefinition {
    return {
        id: 'vanilla',
        name: 'Vanilla',
        registerHandlers(registry, services) {
            registry.registerNpcInteractionByName('Hans', ({ player, npc, services }) => {
                services.chat.sendGameMessage(
                    player,
                    `Hans: Welcome to Lumbridge Castle, ${player.username}.`,
                );
            });
        },
    };
}
```

No wiring beyond this. When the player talks to any NPC named "Hans", the handler runs in the next tick's `scripts` phase, the player gets a chat message, the message is broadcast in the next `broadcast` phase. About 2.4 seconds of latency end-to-end in the worst case (three ticks × 600 ms plus a bit of network time).

## Testing scripts

`server/src/game/testing/` provides helpers for running a handler against a minimal world:

```ts
const { services, player, npc } = createTestWorld();
registry.registerNpcInteraction(1234, myHandler);
await runtime.dispatch({ player, npc, tick: 1, services });
expect(services.chat.lastMessage).toEqual('Hello!');
```

Tests run under `bun test` per the project's CLAUDE.md conventions.

---

## Canonical facts

- **Script registry**: `server/src/game/scripts/ScriptRegistry.ts` → `class ScriptRegistry`.
- **Script runtime**: `server/src/game/scripts/ScriptRuntime.ts` → `class ScriptRuntime`.
- **Script types**: `server/src/game/scripts/types.ts`.
- **Script services interface**: `server/src/game/scripts/serviceInterfaces.ts`.
- **Custom widget registry**: `server/src/game/scripts/CustomWidgetRegistry.ts`.
- **Extrascript loader**: `server/src/game/scripts/ExtrascriptLoader.ts`.
- **Bootstrap**: `server/src/game/scripts/bootstrap.ts`.
- **Wildcards**: `ANY_ITEM_ID = -1`, `ANY_LOC_ID = -1`.
- **Rule**: scripts run in the `scripts` phase; side effects are queued back through `ScriptServices`.
- **Rule**: scripts are not reentrant; chain work across ticks by queueing new actions.
- **Rule**: extrascript hot reload re-registers handlers but does not preserve module state.
