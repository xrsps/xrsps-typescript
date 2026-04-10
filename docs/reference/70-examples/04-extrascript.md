# 70.4 — Create an extrascript end to end

Build a "teleport pad" extrascript: a custom item that, when activated, shows a small dialog of destinations and teleports the player to the picked one. Demonstrates:

- Custom item registration
- Inventory action handler
- Dialog option flow
- Script coroutine suspension

## Directory layout

```
server/extrascripts/teleport-pad/
├── index.ts
└── destinations.ts
```

## `destinations.ts`

```ts
export interface TeleDestination {
    label: string;
    x: number;
    y: number;
    level: number;
}

export const TELE_DESTINATIONS: TeleDestination[] = [
    { label: "Lumbridge",       x: 3222, y: 3218, level: 0 },
    { label: "Varrock Square",  x: 3213, y: 3428, level: 0 },
    { label: "Falador Park",    x: 2964, y: 3378, level: 0 },
    { label: "Al Kharid Bank",  x: 3270, y: 3167, level: 0 },
    { label: "Draynor Bank",    x: 3093, y: 3243, level: 0 },
];
```

## `index.ts`

```ts
import { CustomItemBuilder } from "../../../src/custom/items/CustomItemBuilder";
import { CustomItemRegistry } from "../../../src/custom/items/CustomItemRegistry";
import type { IScriptRegistry, ScriptServices } from "../../src/game/scripts/types";
import { TELE_DESTINATIONS } from "./destinations";

const TELE_PAD_ITEM_ID = 60200;
const BASE_ITEM = 2552; // Ring of dueling — familiar teleport look

let registered = false;
let handles: { unregister: () => void }[] = [];

function ensureCustomItem(): void {
    if (registered) return;
    registered = true;

    CustomItemRegistry.register(
        CustomItemBuilder.create(TELE_PAD_ITEM_ID)
            .basedOn(BASE_ITEM)
            .name("Teleport Pad")
            .inventoryActions("Activate", null, null, null, "Drop")
            .build(),
        "extrascript.teleport-pad",
    );
}

export function register(registry: IScriptRegistry, services: ScriptServices): void {
    ensureCustomItem();

    for (const h of handles) h.unregister();
    handles = [];

    handles.push(
        registry.registerItemAction("Activate", async (ctx, event) => {
            if (event.item.id !== TELE_PAD_ITEM_ID) return;

            const labels = TELE_DESTINATIONS.map((d) => d.label);
            const picked = await ctx.dialogue.options([...labels, "Cancel"]);

            if (picked < 0 || picked >= TELE_DESTINATIONS.length) {
                return; // cancel or out-of-range
            }

            const dest = TELE_DESTINATIONS[picked];
            ctx.services.movement.teleport(ctx.player, {
                x: dest.x,
                y: dest.y,
                level: dest.level,
            });
            ctx.services.chat.sendGameMessage(ctx.player, `Teleported to ${dest.label}.`);
        }),
    );
}
```

## What's happening

1. **Custom item**: `CustomItemBuilder.create(60200).basedOn(2552).name("Teleport Pad").inventoryActions("Activate", null, null, null, "Drop")` constructs an item type that inherits its model and animations from item 2552 but displays as "Teleport Pad" with a custom inventory action list.
2. **Item action**: `registry.registerItemAction("Activate", handler)` registers a handler for **any** item whose Activate action is clicked. We filter inside the handler to only respond to our custom item.
3. **Options dialog**: `ctx.dialogue.options([...])` opens a multi-choice dialogue and suspends the handler until the player clicks one. The return value is the index of the picked option.
4. **Teleport**: `ctx.services.movement.teleport(player, target)` moves the player instantly, triggers the teleport animation, and sends the client a rebuild-region packet if the new tile is outside the current view.

## Getting the item in-game

The teleport pad is a custom item (id 60200, outside the cache id space). You can't get it from an NPC drop or a shop without adding one. For testing, wire it into the `::give` command from [70.3](./03-chat-command.md):

```
::give 60200 1
```

That works out of the box — `ctx.services.items.resolve(60200)` looks up both cache items and registered custom items.

## Canonical facts

- **Custom item builder**: `src/custom/items/CustomItemBuilder.ts`.
- **Custom item registry**: `src/custom/items/CustomItemRegistry.ts`.
- **Item action key**: `"<itemId>#<option>"` or global `registerItemAction(option, handler)`.
- **Dialogue options**: `ctx.dialogue.options(string[])` — returns picked index.
- **Teleport helper**: `ctx.services.movement.teleport(player, { x, y, level })`.
- **Custom item id convention**: ≥ 60000 to avoid collision with cache items.
