# 50.4 — Custom widgets

A "custom widget" is a widget group that doesn't come from the OSRS cache. Gamemodes and extrascripts register them programmatically through `CustomWidgetRegistry`, and the client renders them with the same runtime used for cache-resident widgets.

This is how you build bespoke UIs (item spawner, leagues task journal, admin panels) without editing the cache.

## Where it lives

- **Registry**: `server/src/game/scripts/CustomWidgetRegistry.ts`.
- **Shared group id constants**: `src/shared/ui/widgets.ts` (pick an unused group id for your widget; the convention is id ≥ 50000 for custom groups).
- **Client-side loader**: the client requests a widget group at open time; the server responds with the custom definition if the group id is registered.

## Registering

```ts
import { CustomWidgetRegistry } from "../../src/game/scripts/CustomWidgetRegistry";
import { buildMyWidgetGroup } from "./widget/myWidget.cs2";

const group = buildMyWidgetGroup();
CustomWidgetRegistry.register(group);
```

A widget group is a plain data structure — a list of components (frame, text, background, button, item slot, ...) with flags describing their behavior. The `.cs2.ts` suffix is convention for "this file builds a widget definition that mirrors what CS2 would have baked into the cache".

## Component shape

Each component has:

- **`id`** — unique within the group (a small integer).
- **`type`** — one of the widget types (layer, text, model, item, scrollbar, rectangle, …).
- **`x`, `y`, `width`, `height`** — absolute coordinates inside the parent.
- **`flags`** — interaction flags (clickable, right-click ops, item op flags).
- **`ops`** — right-click option labels.
- **`data`** — type-specific fields (for text: font id, color; for item: item id, quantity; etc.).
- **`onLoad` / `onOp` / `onVarTransmit`** — optional CS2 script id references to run at load, on click, or on varp change.

Building a group by hand is tedious but linear — see `server/extrascripts/item-spawner/widget/itemSpawner.cs2.ts` for a full example.

## Opening a custom widget

Same as any other widget — via a widget event:

```ts
services.dialog.queueWidgetEvent(playerId, {
    action: "open",
    groupId: MY_WIDGET_GROUP_ID,
    modal: true,
});
```

The client looks up the group by id. Cache-resident group ids resolve against the cache; custom group ids (registered via `CustomWidgetRegistry`) resolve through the server's `WidgetBroadcaster` flow — the server pushes the definition the first time the client opens it.

## Handling clicks

Custom widgets use the normal `WIDGET_ACTION` packet. Register a handler:

```ts
registry.registerWidgetAction({
    widgetId: MY_WIDGET_GROUP_ID,
    opId: 1,
    handler: async (ctx, event) => {
        // ctx.player, event.componentId, event.option, event.args ...
    },
});
```

Omit `widgetId`, `opId`, or `option` to match more broadly.

## Updating the widget

To change the text of a component after the widget is open:

```ts
services.dialog.queueWidgetEvent(playerId, {
    action: "set_text",
    uid: computeWidgetUid(GROUP_ID, COMPONENT_ID),
    text: "Updated!",
});
```

The UID packing helper is in `src/shared/ui/widgetUid.ts`:

```ts
const uid = ((groupId & 0xffff) << 16) | (componentId & 0xffff);
```

Other `WidgetAction` variants mirror the server → client packet catalog in [40.4](../40-protocol/04-server-to-client.md):

- `open`, `close`, `open_sub`, `close_sub`
- `set_text`, `set_hidden`, `set_item`, `set_npc_head`, `set_player_head`
- `set_flags`, `set_flags_range`
- `set_animation`
- `run_script` (runs a CS2 client script with typed args)

## Running CS2 scripts

Custom widgets can invoke cache-resident CS2 scripts to reuse existing UI helpers. For example, the item-spawner uses `SCRIPT_STONEBUTTON_INIT` (script id 2424) to initialize a button's visual state, and `SCRIPT_STEELBORDER_NOCLOSE` (script id 3737) to draw a borderless frame.

```ts
services.dialog.queueWidgetEvent(playerId, {
    action: "run_script",
    scriptId: 2424,
    args: [uid, "Label", font, style],
});
```

The client-side CS2 VM (see [10.3](../10-client/03-widgets-cs2.md)) executes the script with the args.

## Custom items for custom widgets

If your widget is opened by clicking an item, you'll want a custom item too:

```ts
import { CustomItemBuilder } from "../../../src/custom/items/CustomItemBuilder";
import { CustomItemRegistry } from "../../../src/custom/items/CustomItemRegistry";

CustomItemRegistry.register(
    CustomItemBuilder.create(MY_ITEM_ID)
        .basedOn(SOME_CACHE_ITEM_ID)
        .name("My Item")
        .inventoryActions("Activate", null, null, null, "Drop")
        .build(),
    "extrascript.my-feature",
);
```

`basedOn` inherits the base model and animations from an existing cache item so you don't need to ship a custom model.

## Lifecycle and reload

- Custom widgets are registered once at module load time.
- On extrascript hot reload, the previous registration stays in place (no harm — it's just a definition). If you change the widget layout, clients that already have it open see the old layout; they'll see the new one on the next `open`.
- Custom items are similarly additive. Overwriting an id warns in the log.

## Canonical facts

- **Custom widget registry**: `server/src/game/scripts/CustomWidgetRegistry.ts`.
- **Custom item builder**: `src/custom/items/CustomItemBuilder.ts`.
- **Custom item registry**: `src/custom/items/CustomItemRegistry.ts`.
- **UID helper**: `src/shared/ui/widgetUid.ts` (`((groupId & 0xffff) << 16) | (componentId & 0xffff)`).
- **Group id convention**: custom groups ≥ 50000.
- **Worked example**: `server/extrascripts/item-spawner/widget/itemSpawner.cs2.ts`.
- **Widget action shapes**: `open`, `close`, `open_sub`, `close_sub`, `set_text`, `set_hidden`, `set_item`, `set_npc_head`, `set_player_head`, `set_flags`, `set_flags_range`, `set_animation`, `run_script`.
