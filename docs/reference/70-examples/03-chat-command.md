# 70.3 — Add a chat command

Add a `::give <item-name-or-id> [qty]` command that spawns items into the caller's inventory. Useful for admin testing, and a minimal example of the chat-command API.

## The extrascript

`server/extrascripts/give-command/index.ts`:

```ts
import type { IScriptRegistry, ScriptServices } from "../../src/game/scripts/types";

let handles: { unregister: () => void }[] = [];

export function register(registry: IScriptRegistry, services: ScriptServices): void {
    for (const h of handles) h.unregister();
    handles = [];

    handles.push(
        registry.registerCommand("give", async (ctx, args) => {
            const player = ctx.player;

            if (!player.isAdmin) {
                ctx.services.chat.sendGameMessage(player, "You need admin rights to use ::give.");
                return;
            }

            if (args.length === 0) {
                ctx.services.chat.sendGameMessage(
                    player,
                    "Usage: ::give <item-name-or-id> [quantity]",
                );
                return;
            }

            const query = args[0];
            const quantity = args[1] ? Math.max(1, parseInt(args[1], 10) || 1) : 1;

            const item = ctx.services.items.resolve(query);
            if (!item) {
                ctx.services.chat.sendGameMessage(player, `No item matches "${query}".`);
                return;
            }

            const { added } = ctx.services.inventory.addItem(player, item.id, quantity);
            if (added === 0) {
                ctx.services.chat.sendGameMessage(player, "Inventory is full.");
                return;
            }

            ctx.services.chat.sendGameMessage(
                player,
                `Spawned ${added}× ${item.name} (id ${item.id}).`,
            );
        }),
    );
}
```

## How the command dispatch works

The chat handler (`server/src/network/handlers/chatHandler.ts`) looks at every incoming `CLIENT_CHAT` packet. If the message starts with `::`, it strips the prefix, splits on whitespace, and looks up the first token in the registry's command map.

- `registry.registerCommand(name, handler)` adds a row.
- On dispatch, the handler gets `(ctx, args)` — `ctx` is a `ScriptExecutionContext`, `args` is a `string[]` of whitespace-split arguments after the command name.

## Run it

`bun run dev`, log in, type `::give abyssal_whip 1` in the chat box. You should see the whip appear in your inventory and a chat message:

> Spawned 1× Abyssal whip (id 4151).

Or by id: `::give 4151 5`.

## Handling player permissions

The `player.isAdmin` check is a per-gamemode concept. In vanilla, admin flags are set via the account store (`server/data/accounts.json`) or by a gamemode-specific rule. For a quick hack, set `"isAdmin": true` on your account in the JSON file before starting the server.

For production, use a proper permissions system — don't ship `::give` to end users.

## Variation: no-arg commands

```ts
registry.registerCommand("home", async (ctx) => {
    ctx.services.movement.teleport(ctx.player, { x: 3222, y: 3218, level: 0 });
    ctx.services.chat.sendGameMessage(ctx.player, "Teleported home.");
});
```

Just skip the args and do the thing. Handy for dev shortcuts.

## Variation: async with delay

```ts
registry.registerCommand("countdown", async (ctx, args) => {
    const secs = Math.max(1, parseInt(args[0] ?? "3", 10));
    for (let i = secs; i > 0; i--) {
        ctx.services.chat.sendGameMessage(ctx.player, `${i}...`);
        await ctx.queueDelay(1); // one tick (600 ms)
    }
    ctx.services.chat.sendGameMessage(ctx.player, "Go!");
});
```

`ctx.queueDelay(ticks)` suspends the handler for N ticks without blocking the server loop. The runtime resumes the coroutine at the right moment.

## Canonical facts

- **Chat handler**: `server/src/network/handlers/chatHandler.ts`.
- **Prefix**: `::` (configurable).
- **Registration method**: `registry.registerCommand(name, handler)`.
- **Handler signature**: `(ctx: ScriptExecutionContext, args: string[]) => Promise<void> | void`.
- **Item lookup**: `ctx.services.items.resolve(nameOrId)`.
- **Inventory mutation**: `ctx.services.inventory.addItem(player, itemId, qty)` → `{ slot, added }`.
- **Delay**: `ctx.queueDelay(ticks)`.
