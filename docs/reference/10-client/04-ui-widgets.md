# 10.4 — UI and widgets (`src/ui/`)

The OSRS UI is not a DOM: it's a tree of "widgets" loaded from the cache, rendered directly into the WebGL canvas. `src/ui/` implements the widget runtime, the GL primitives needed to draw it, the menu system, and the developer overlays that sit on top of everything else. It is one of the most surprising parts of the codebase for anyone used to React UIs — **there are React components in here, but they are a thin shell around a GL-drawn interface**.

## Why WebGL and not DOM?

Two reasons:

1. **Fidelity.** OSRS widgets have a specific look — bitmap fonts, fixed pixel layouts, rotated 3D models embedded in 2D panels, custom cursor crosses. Doing this in the DOM would fight the browser every step of the way. Doing it in WebGL means a tile-based blitter can render a dozen widgets in a single draw call.
2. **Performance.** A scene with hundreds of inventory slot icons and a moving minimap compass would chew main-thread budget if implemented as DOM elements. Rendering to the same canvas as the 3D scene amortizes everything into one GL context.

The practical consequence is that `src/ui/` has two layers: the widget runtime (`widgets/`, `menu/`, `game/`, etc.) which owns the logical state of the UI, and the GL layer (`gl/`, `text/`) which rasterizes it.

## Top-level files

- **`Canvas.tsx`** — a React component that wraps the actual HTML `<canvas>`. Handles resize observers, DPR changes, and touch-event plumbing.
- **`UiScale.ts`** — calculates the integer UI scale factor based on the canvas size and the selected display mode.
- **`UiScaleDiagnostic.ts`** — exposes `window.__uiDiag` for debugging UI scale.
- **`fonts.ts`** — loads the OSRS bitmap fonts via `webfontloader`.

## `src/ui/widgets/` — the widget runtime

The widget system is the core of the UI. An OSRS widget is either a single component (a rectangle, an image, a text line, a 3D model slot, a container) or a group that holds other widgets as children. Cache-defined widgets are loaded on demand from the `widgets` group via `WidgetLoader`, and dynamic widgets can be created at runtime.

- **`WidgetManager.ts`** — the central state manager. Tracks which widget groups are currently mounted (as a main interface, a modal, an overlay), maintains dynamic child lists for groups that create children at runtime, manages a flag-override map (per-widget hidden/disabled overrides), and runs CC (custom component) scripts through the CS1 bridge.
- **`WidgetLoader.ts`** — reads widget definitions from the cache and builds the in-memory tree.
- **`WidgetNode.ts`** — one widget. Holds its ID, bounds, text content, image reference, event handlers, and relationships to children.
- **`WidgetFlags.ts`** — widget flag constants: `HIDDEN`, `DISABLED`, `FILL_BG`, etc.
- **`WidgetSessionManager.ts`** — tracks per-session UI state: which interfaces are open, modal stack, recent history.
- **`WidgetInteraction.ts`** — marks widgets dirty when interaction happens so the renderer knows to redraw them.
- **`cs1/runCs1.ts`** — bridge into the CS2 VM (see [10.2 — RS engine](./02-rs-engine.md)) for running client-script callbacks attached to widgets.
- **`layout/`** — layout computation (positioning, sizing, relative-to-parent math).
- **`components/`** — custom widget component overrides (shaped-specific renderers).
- **`menu/`** — widget-integrated menu pieces.
- **`custom/`** — custom widget implementations that aren't in the cache (e.g., the item spawner panel from the `item-spawner` extrascript).

### Widget IDs are composite

Internally the manager keys widgets by `(groupId << 32) | childIndex`. The static children of a cache-defined widget have indices `[0..childCount)`; dynamic children allocated via `CC_CREATE` or `CC_COPY` at runtime get IDs starting from a high reserved range to avoid colliding with cache-defined IDs. The manager handles the allocation; you should never hand-roll a child index.

### ContentType tags

Some children are tagged with a `ContentType` to signal what to render there:

- `ContentType.VIEWPORT = 1337` — the 3D viewport (scene is drawn through this rectangle)
- `ContentType.MINIMAP = 1338` — minimap rendered here
- `ContentType.COMPASS = 1339` — compass widget

These are how the OSRS interface tells the engine "draw the world here" rather than calling out to the scene renderer directly.

## `src/ui/gl/` — UI GL primitives

The GL UI layer is a 2D sprite/text/rectangle batcher that shares a GL context with the scene renderer but uses its own shader programs.

- **`renderer.ts`** — `GLRenderer`. Owns the shader programs: a textured quad shader, a solid color shader, a gradient shader, and a masked variant. Manages the projection matrix and the dynamic VBO it uses for quad geometry.
- **`widgets-gl.ts`** — the big one. This is the file that walks the widget tree and emits batched draw calls: each widget type (rect, image, text, model, container) has a draw routine here. ~188 kB because it implements every OSRS widget behavior. You will visit this file when a widget renders wrong.
- **`choose-option.ts`** — the right-click context menu renderer, with hover highlighting and typed action coloring.
- **`click-registry.ts`** — a spatial index of clickable widget regions so mouse events can be resolved to a widget in O(log n).
- **`MinimapRenderer.ts`** — renders the minimap tile textures, the compass, and the player blip.
- **`scissor.ts`** — a GL scissor stack for correctly clipping nested panels.
- **`texture-cache.ts`** — GL texture cache for widget images.
- **`ui-input.ts`** — text input field rendering and state.
- **`gl-utils.ts`** — shader compilation, program linking, etc.

The render order is always: scene first, then UI. UI is not depth-tested against the scene; it uses its own orthographic projection and clears the depth buffer as needed.

## `src/ui/text/`

- **`BitmapFontAtlas.ts`** — holds the glyph atlases for the OSRS bitmap fonts (RuneScape-Bold-12, RuneScape-Plain-11, small, etc.), mapping characters to UV rects and advance widths.

## `src/ui/menu/` — the right-click menu

- **`MenuEngine.ts`** — processes menu actions (what happens when you click "Talk-to Bob") and dispatches them into the rest of the engine.
- **`MenuState.ts`** — the menu's own state machine: open/closed, selected action, hover index.
- **`MenuBridge.ts`** — glue between widget events and the menu system.
- **`MenuAction.ts`** — the action type: `{ text, target, objType, objId, priority, flags }`.

When you right-click, the menu engine walks the candidate list (built from whatever's under the cursor — widgets, world entities, ground items) and builds a sorted menu. When you click an entry, the engine turns it into a packet via `ServerConnection`.

## `src/ui/item/` and `src/ui/model/`

- **`ItemIconRenderer.ts`** — renders 3D item models into 2D icon textures for inventory/bank/interface drawing.
- **`ItemIcon.tsx`** — a React component that surfaces rendered icons (used in the sidebar, debug panels).
- **`Model2DRenderer.ts`** — generic 3D-to-2D model projection. Used anywhere a model must appear in a UI panel (char creator, gear stats preview).

## `src/ui/devoverlay/` — the dev overlays

Developer overlays sit on top of the scene and are controlled by the sidebar and debug controls. Each overlay is an instance of a subclass of `Overlay` and is managed by `OverlayManager`. Shipped overlays include:

| File | What it draws |
|---|---|
| `TileMarkerOverlay.ts` | User-placed tile markers (from the tilemarkers plugin) |
| `WalkableOverlay.ts` | Walkable-tile visualization (debug collision) |
| `ObjectBoundsOverlay.ts` | Bounding boxes of scene locs |
| `HealthBarOverlay.ts` | NPC / player health bars |
| `OverheadTextOverlay.ts` | Names and public chat over heads |
| `OverheadPrayerOverlay.ts` | Active prayer icons |
| `GroundItemOverlay.ts` | Ground item highlighting |
| `InteractHighlightOverlay.ts` | Interactive object highlights |
| `PathOverlay.ts` | Current walk path visualization |
| `ClickCrossOverlay.ts` | Recent click markers |
| `WidgetsOverlay.ts` | Widget bounds wireframes |
| `ObjectIdOverlay.ts` | Loc ID labels |
| `HitsplatOverlay.ts` | Damage splats |
| `TileTextOverlay.ts` | Per-tile coordinate labels |
| `LootNotificationOverlay.ts` | Loot drop popups |
| `LoginOverlay.ts` | Login-screen debug info |

`OverlayManager` is the registry: overlays subscribe to the relevant engine events and paint into a dedicated GL layer that runs after the widget layer.

## `src/ui/game/` — game services

- **`EmoteService.ts`** — client-side emote interaction logic. Maps the emote widget clicks to the right animations and the right packet.

## `src/ui/cache/` and `src/ui/registry/`

- **`enumCache.ts`** — cached enum lookups so the UI layer doesn't hit the cache every time it needs a column from an enum.
- **`widgetRoles.ts`** — semantic groupings of widget IDs ("bank", "inventory", "spellbook", "prayer book", …), used by plugins that need to react to UI events independent of exact widget IDs.

## Event flow for a UI click

```
mousedown on canvas
└── InputManager captures coordinates
    └── ClickRegistry.resolve(x, y) → widgetUid | null
        ├── if widget → WidgetManager.onClick(widgetUid)
        │   └── runCs1(onClick script) → may transmit varps, open new widgets, send packets
        └── if world (no widget hit) → SceneRaycaster.pickTile(x, y) → MenuEngine.buildWorld(x, y)
            └── build right-click options for the tile/loc/npc
                └── ServerConnection.sendPacket(…)
```

Understanding this flow is how you debug a "my button doesn't work" complaint: either the click isn't hitting the widget (bad bounds in `ClickRegistry`), or it's hitting the widget but the CS1 callback is wrong, or the callback runs but the generated packet isn't handled by the server. Each hop is logged at debug level if you turn verbose logging on in `OsrsClient`.

## When to touch what

- **New widget visual**: extend the relevant draw path in `src/ui/gl/widgets-gl.ts`.
- **New widget behavior from a gamemode**: register handlers in your gamemode's `registerHandlers()` — don't modify `WidgetManager` directly. See [10.1 — Widgets via gamemodes](../50-gamemodes-scripts/02-script-registry.md#widget-handlers).
- **New dev overlay**: subclass `Overlay`, register it with `OverlayManager`, and expose a toggle in `DebugControls`.
- **New right-click menu option**: a gamemode's script handler should register a `MenuAction`. The engine handles the rest.

---

## Canonical facts

- **Widget manager**: `src/ui/widgets/WidgetManager.ts`.
- **Widget loader**: `src/ui/widgets/WidgetLoader.ts`.
- **Widget node class**: `src/ui/widgets/WidgetNode.ts`.
- **CS1 bridge**: `src/ui/widgets/cs1/runCs1.ts`.
- **GL UI renderer**: `src/ui/gl/renderer.ts` → `class GLRenderer`.
- **Widget GL rendering**: `src/ui/gl/widgets-gl.ts`.
- **Menu engine**: `src/ui/menu/MenuEngine.ts`.
- **Click registry**: `src/ui/gl/click-registry.ts`.
- **Minimap renderer**: `src/ui/gl/MinimapRenderer.ts`.
- **Bitmap font atlas**: `src/ui/text/BitmapFontAtlas.ts`.
- **Dev overlay base class**: `src/ui/devoverlay/Overlay.ts`.
- **Dev overlay manager**: `src/ui/devoverlay/OverlayManager.ts`.
- **ContentType constants**: defined in `src/ui/widgets/WidgetManager.ts` (`VIEWPORT=1337`, `MINIMAP=1338`, `COMPASS=1339`).
- **Widget role registry**: `src/ui/registry/widgetRoles.ts`.
