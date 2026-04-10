# 70.8 — Client render overlay

Add a client-side plugin that draws a visual marker on tiles where ground items are present. This is the kind of task the client plugin system (`src/ui/plugins/`) is built for.

## Where

Client plugins live under `src/ui/plugins/`. Each one is a self-contained module that registers an overlay renderer. The plugin hub (`src/ui/plugins/pluginhub/`) exposes enable/disable toggles in the settings UI.

The `tilemarkers` plugin (`src/ui/plugins/tilemarkers/`) is a good reference — it already draws colored squares on tiles, and we're adding similar behavior.

## Create the plugin module

`src/ui/plugins/groundItemMarker/GroundItemMarkerPlugin.tsx`:

```tsx
import { useEffect } from "react";
import { useGroundItems } from "../../../network/useServerConnection";
import { useOverlayRegistry } from "../shared/OverlayRegistry";
import type { TileOverlayRenderer } from "../shared/types";

const COLOR = [1.0, 0.9, 0.1, 0.6]; // yellow, translucent

export function GroundItemMarkerPlugin() {
    const items = useGroundItems();
    const overlays = useOverlayRegistry();

    useEffect(() => {
        if (!items.length) return;

        const renderer: TileOverlayRenderer = (ctx) => {
            for (const item of items) {
                if (item.plane !== ctx.camera.plane) continue;
                ctx.drawFilledTile(item.worldX, item.worldY, COLOR);
            }
        };

        const handle = overlays.register(renderer);
        return () => handle.unregister();
    }, [items, overlays]);

    return null;
}
```

## What the hooks do

- **`useGroundItems()`** — subscribes to the `groundItems` slice of `ServerConnection`'s state. Re-renders when the ground item list changes.
- **`useOverlayRegistry()`** — returns the overlay registry for the current scene. Plugins register renderers that are called once per frame with a drawing context.
- **`TileOverlayRenderer`** — a function that runs per frame and draws into a special overlay pass. It gets a `ctx` with `drawFilledTile(worldX, worldY, color)`, `drawTileBorder(...)`, `drawLine(...)`, and a `camera` with the current plane and view matrix.

The overlay is rendered after the main scene but before the UI, so it shows through the 3D world without being obscured by ground textures.

## Register the plugin

Add to `src/ui/plugins/pluginhub/PluginRegistry.ts` (or equivalent):

```ts
import { GroundItemMarkerPlugin } from "../groundItemMarker/GroundItemMarkerPlugin";

export const CLIENT_PLUGINS = [
    // ...existing plugins
    {
        id: "ground-item-marker",
        name: "Ground item markers",
        description: "Draws a yellow square on tiles that have ground items.",
        default: true,
        Component: GroundItemMarkerPlugin,
    },
];
```

The plugin hub reads this list and renders each plugin's component (gated by an enable/disable toggle persisted in local storage).

## Result

Log in, drop an item. A translucent yellow square appears on the tile. Drop another — another square. Pick them up — they disappear.

## Variation: fancier markers

Replace `drawFilledTile` with `drawTileBorder` for an outline-only marker. Or call `drawSprite(worldX, worldY, spriteId)` to draw a sprite from the cache on top of the tile — useful for item icons.

For per-item coloring by rarity:

```tsx
const color = item.value > 10000 ? [0, 1, 0, 0.6] : [1, 1, 0.1, 0.6];
ctx.drawFilledTile(item.worldX, item.worldY, color);
```

`item.value` would need to come from a client-side item metadata lookup (`src/cache/ObjTypeLoader`) — the server doesn't send per-item values in the ground item update by default.

## Performance

Tile overlays are cheap but not free — the drawing is done in immediate mode each frame. For thousands of markers, batch them into a single vertex buffer instead of calling `drawFilledTile` in a loop. The framework has a `BatchedTileOverlay` helper for that case; see `src/ui/plugins/tilemarkers/` for example usage.

## Canonical facts

- **Client plugin root**: `src/ui/plugins/`.
- **Plugin hub**: `src/ui/plugins/pluginhub/`.
- **Overlay registry**: `src/ui/plugins/shared/OverlayRegistry.ts` (or equivalent).
- **Tile overlay API**: `ctx.drawFilledTile(x, y, color)`, `ctx.drawTileBorder(x, y, color)`, `ctx.drawLine(...)`, `ctx.camera.plane`.
- **Ground items subscription**: `useGroundItems()` from `src/network/useServerConnection.ts`.
- **Reference plugin**: `src/ui/plugins/tilemarkers/`.
