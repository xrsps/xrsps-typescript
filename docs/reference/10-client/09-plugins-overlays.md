# 10.9 — Client plugins and dev overlays

"Plugin" in the client sense is a small modular feature that plugs into the sidebar and can optionally subscribe to engine events, draw overlays, and persist its settings to browser storage. These are _client_ plugins — they live in the browser and do not require server changes. They are distinct from _gamemodes_ (which live server-side) and _extrascripts_ (which add server-side behavior).

## Shape of a plugin

Each plugin under `src/client/plugins/<name>/` follows the same shape:

```
plugins/
  <name>/
    <Name>Plugin.ts              core logic (event subscriptions, state)
    SidebarPlugin.tsx            React UI for the sidebar panel
    types.ts                     shared types
    Browser<Name>PluginPersistence.ts  localStorage-backed settings store
```

The `*Plugin.ts` file typically:

1. Takes an `OsrsClient` in its constructor.
2. Calls `osrsClient.subscribeX()` for the events it cares about.
3. Mutates its own state and, if it has a visual component, pushes draw data into an overlay via `OverlayManager`.
4. Exposes an imperative API that `SidebarPlugin.tsx` uses to read/write settings.

The React sidebar component is separate so the engine-facing plugin can be tested without React.

## Shipped plugins

### `grounditems` (`src/client/plugins/grounditems/`)

Highlights ground items with configurable color rules based on item ID or value. Reads ground-item events from `OsrsClient`, filters them through the user's rules, and tells `GroundItemOverlay` to draw labels and colored tiles.

Key files:

- `GroundItemsPlugin.ts` — rule matching, color assignment, overlay push.
- `SidebarPlugin.tsx` — the rule editor UI.
- `BrowserGroundItemsPluginPersistence.ts` — JSON rules in `localStorage`.
- `types.ts` — `GroundItemRule`, `GroundItemRuleMatch`, `GroundItemColor`.

### `tilemarkers` (`src/client/plugins/tilemarkers/`)

Lets players place colored markers on tiles (used for annotating boss rooms, resource spots, etc.). Uses `TileMarkerOverlay` for rendering.

Notable behavior: it owns the _input_ for placing markers — it hooks into `InputManager` through `OsrsClient` to catch a shift-click-when-plugin-active event. The overlay only handles rendering.

### `interacthighlight` (`src/client/plugins/interacthighlight/`)

Highlights interactive locs and NPCs when hovered or targeted, by driving `InteractHighlightOverlay`. Also respects per-object overrides so the user can mute particular objects.

### `notes` (`src/client/plugins/notes/`)

A tiny "notepad" panel in the sidebar. Does not touch the engine at all; it's pure React + `localStorage`. Included here as a reference for the simplest possible plugin.

### `pluginhub` (`src/client/plugins/pluginhub/`)

A sidebar panel that lists installed plugins and lets the user enable/disable each. It doesn't itself provide any gameplay logic — it's the "plugin of plugins".

## Dev overlays vs plugins

The overlays listed in [10.4 — UI and widgets](./04-ui-widgets.md) under `src/ui/devoverlay/` are _render targets_, not plugins. A plugin pushes data to an overlay; the overlay draws it into a dedicated GL pass after the widget layer. You can have overlays with no plugins (e.g., `HitsplatOverlay` is driven directly by the engine) and plugins with no overlay (e.g., `notes`).

The division is roughly:

| Layer | Lives in | Has React UI | Touches GL | Subscribes to engine events |
|---|---|---|---|---|
| Overlay | `src/ui/devoverlay/` | No | Yes | No (overlay manager forwards data) |
| Plugin | `src/client/plugins/` | Yes (via `SidebarPlugin.tsx`) | No (delegates to overlays) | Yes |

So in practice, a plugin is the state/input half and an overlay is the drawing half. `OverlayManager` mediates between them via a handful of typed update methods.

## Persistence

All shipped plugins use `localStorage` via a small `BrowserXPluginPersistence` adapter. The adapter exposes `load()` and `save(state)` — dead simple. If you want per-account storage instead of per-browser, you'd write a different adapter and swap it in the `OsrsClient` construction site.

Plugin persistence is deliberately not run through React's lifecycle — when the React sidebar unmounts, the plugin keeps working. This matters for overlay plugins that need to keep rendering while the sidebar is closed.

## Registering a new plugin

Shipping a new client plugin has roughly these steps:

1. Add a folder under `src/client/plugins/<your-name>/` with the four file shapes above.
2. Instantiate the plugin in `OsrsClient` (or wherever the other plugins are instantiated) so its event subscriptions run.
3. Export a `SidebarPlugin` React component.
4. Register the component with the sidebar plugin registry so it shows up in the UI.
5. If you need an overlay, create one under `src/ui/devoverlay/`, subclass `Overlay`, and register it with `OverlayManager`.

See [70 — Examples: adding a client plugin](../70-examples/08-custom-widget.md) for a full walkthrough with code.

## Plugins vs gamemodes vs extrascripts — one-page cheat sheet

| Kind | Runs on | Purpose | Example |
|---|---|---|---|
| **Client plugin** | Browser | Visual / QoL tools for a single player | `grounditems`, `tilemarkers` |
| **Gamemode** | Server | Server rules, XP rates, drop tables | `vanilla`, `leagues-v` |
| **Extrascript** | Server | Drop-in extensions to a gamemode | `item-spawner` |

All three are composable: you can run the `leagues-v` gamemode, with the `item-spawner` extrascript, and the `grounditems` plugin, with no interactions between the three other than the engine itself.

---

## Canonical facts

- **Plugin root**: `src/client/plugins/`.
- **Ground items plugin**: `src/client/plugins/grounditems/GroundItemsPlugin.ts`.
- **Tile markers plugin**: `src/client/plugins/tilemarkers/TileMarkersPlugin.ts`.
- **Interact highlight plugin**: `src/client/plugins/interacthighlight/InteractHighlightPlugin.ts`.
- **Notes plugin**: `src/client/plugins/notes/NotesPlugin.ts`.
- **Plugin hub panel**: `src/client/plugins/pluginhub/SidebarPlugin.tsx`.
- **Overlay manager**: `src/ui/devoverlay/OverlayManager.ts`.
- **Overlay base class**: `src/ui/devoverlay/Overlay.ts`.
- **Persistence pattern**: `Browser<Name>PluginPersistence.ts` using `localStorage`.
