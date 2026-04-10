# 70.2 — Add an NPC interaction

Make Hans in Lumbridge Castle say "Hello, `<your name>`! You've been here for `<x>` ticks." when you click **Talk-to**.

## Where

This kind of change belongs in an extrascript — you're adding one NPC handler without changing the rules of the world.

## Create the extrascript

```sh
mkdir -p server/extrascripts/hans-greeter
```

Create `server/extrascripts/hans-greeter/index.ts`:

```ts
import type { IScriptRegistry, ScriptServices } from "../../src/game/scripts/types";

const HANS_NPC_ID = 3106;

let handles: { unregister: () => void }[] = [];

export function register(registry: IScriptRegistry, services: ScriptServices): void {
    // Clean up any previous registration from hot reload.
    for (const h of handles) h.unregister();
    handles = [];

    handles.push(
        registry.registerNpcInteraction(
            HANS_NPC_ID,
            async (ctx) => {
                const player = ctx.player;
                const name = player.displayName ?? player.username;
                const loginTick = player.loginTick ?? 0;
                const ticksOnline = ctx.services.ticker.getCurrentTick() - loginTick;

                await ctx.dialogue.npc(
                    HANS_NPC_ID,
                    `Hello, ${name}! You've been here for ${ticksOnline} ticks.`,
                );
            },
            "Talk-to",
        ),
    );
}
```

## Why this works

- `registerNpcInteraction(npcId, handler, option)` registers the handler for the specific (NPC id, option) combo. When the player clicks the "Talk-to" option on NPC 3106, the script registry dispatches to this handler.
- `ctx.dialogue.npc(npcId, text)` is the high-level "show an NPC head + text box and wait for the player to continue" helper. It suspends the handler until the player clicks through.
- `ctx.services.ticker.getCurrentTick()` exposes the current tick number for tick-relative math.
- The reload-safe `handles` list means the extrascript re-registers cleanly on dev hot reload.

## Run it

```sh
bun run dev
```

In the server tab you'll see:

```
[extrascripts] discovered 2: extrascript.item-spawner, extrascript.hans-greeter
[extrascripts] loaded extrascript.hans-greeter
```

Log into the client, walk to Lumbridge Castle, right-click Hans, click **Talk-to**. You should see:

> Hans: Hello, `<your username>`! You've been here for 12 ticks.

## Troubleshooting

- **Nothing happens when you click Talk-to** — the registration may have silently been overwritten by vanilla content. Check the server log for `[script] warning: overwriting npc handler for key "3106#talk-to"`. If you see it, rename your option to something else or remove the competing vanilla handler.
- **"ctx.dialogue is not a function"** — `ScriptServices.dialogue` isn't populated in the extrascript's context. Use `ctx.services.dialog.queueWidgetEvent` + manual widget calls, or check that your gamemode's `contributeScriptServices` populates the dialogue helper. In vanilla it does.
- **Hot reload doesn't pick up edits** — your dev server may not have the extrascript watcher enabled. Restart the server via mprocs (`Ctrl-A r` on the server tab).

## Variation: match any NPC

To make a handler that runs for every NPC's Talk-to option:

```ts
registry.registerNpcAction("Talk-to", async (ctx, event) => {
    await ctx.dialogue.npc(event.npcId, `Greetings, traveler.`);
});
```

`registerNpcAction(option, handler)` matches any NPC as long as the option label is "Talk-to". Use this for catch-all dialogue when the specific NPC doesn't have its own handler.

## Unregistering

The handle returned from `registerNpcInteraction` has `.unregister()`. The hot-reload pattern above calls it on every reload; you can also call it manually if you want the handler to only run until some condition is met (a one-off quest dialogue, for instance).

## What you just saw

- Extrascripts plug into the same `ScriptRegistry` as the gamemode (see [50.2](../50-gamemodes-scripts/02-script-registry.md)).
- Handler resolution is `(npcId, option)` → exact match first → `(npcId, "")` fallback → global `(option)` fallback (see [20.12](../20-server/12-script-runtime.md)).
- The dialogue helper uses coroutine-style async/await to linearize multi-turn dialogue flows. Under the hood it suspends on `RESUME_PAUSEBUTTON` client packets (see [40.3](../40-protocol/03-client-to-server.md)).

## Canonical facts

- **Extrascript loader**: `server/src/game/scripts/ExtrascriptLoader.ts`.
- **Script registry**: `server/src/game/scripts/ScriptRegistry.ts`.
- **Hans NPC id**: `3106` (Lumbridge Castle).
- **Registration key**: `"3106#talk-to"`.
