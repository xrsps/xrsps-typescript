# 10 — Client reference

The browser client is a classical game client with a React shell around it. It is responsible for everything the user sees and everything the user does with a mouse or keyboard: rendering the world, drawing the UI, playing audio, accepting input, decoding network packets, and keeping a local model of the world so frames can be drawn in between server ticks.

The client code lives in four top-level directories under `src/`:

- `src/client/` — the engine itself (state, rendering, input, login, audio, plugins, workers, sync)
- `src/rs/` — OSRS format code: cache loaders, model decoders, scene builders, the CS2 VM
- `src/ui/` — the widget/HUD layer (renders OSRS interfaces into WebGL)
- `src/network/` — the WebSocket client + binary packet encoders/decoders

`src/picogl/`, `src/components/`, `src/media/`, `src/util/`, and `src/shared/` are supporting directories.

## Sub-pages

- [10.1 — Entry and lifecycle](./01-entry-and-lifecycle.md) — how `index.tsx`, `OsrsClientApp`, and `OsrsClient` come up, the HMR story, and where global state lives.
- [10.2 — The RS engine layer (`src/rs/`)](./02-rs-engine.md) — cache system, archive formats, type loaders, models, scene building, the CS2 VM.
- [10.3 — Rendering (`src/client/webgl/`)](./03-webgl-renderer.md) — the WebGL2 renderer, map squares, draw backends, chathead factories, the performance profiler.
- [10.4 — UI and widgets (`src/ui/`)](./04-ui-widgets.md) — the widget manager, widget tree, UI GL renderer, dev overlays.
- [10.5 — Input, camera, interaction](./05-input-camera.md) — `InputManager`, `Camera`, mouse crosses, raycasting, menu system.
- [10.6 — Player/NPC sync and movement](./06-sync-movement.md) — `PlayerSyncManager`, `BitStream`, `OsrsRouteFinder32`, movement prediction.
- [10.7 — Audio](./07-audio.md) — `MusicSystem`, `SoundEffectSystem`, Vorbis WASM.
- [10.8 — Login and loading](./08-login.md) — `LoginRenderer`, `GameState`, loading bar, server address handling.
- [10.9 — Plugins, sidebar, dev overlays](./09-plugins-overlays.md) — `SidebarShell`, ground-item plugin, tile markers, interact highlight, notes plugin.
- [10.10 — The client networking layer (`src/network/`)](./10-networking.md) — `ServerConnection`, packet buffers, the subscription API.
- [10.11 — Worker pool](./11-worker-pool.md) — `RenderDataWorkerPool`, minimap workers, off-main-thread model loading.

## Cross-cutting notes

- **The god object.** `OsrsClient` (`src/client/OsrsClient.ts`) is a very large class that subscribes to roughly 40 server event streams and owns all local player/NPC/inventory/skills/equipment state. It is exposed as `window.osrsClient` at runtime so you can poke at it in the devtools console. This file is much bigger than a single class should be, but because so many subsystems want to read from or write to it, the refactor cost has never justified breaking it up. Expect to return to it often.
- **Everything draws to one canvas.** There is exactly one WebGL canvas. The world, the HUD, the menus, the minimap, the login screen, and the dev overlays all render into it. This is why `src/ui/gl/` exists: the UI layer needs a full 2D WebGL2 primitive library so it can coexist with the 3D scene in the same GL context.
- **Workers for the heavy lifts.** Model loading and minimap rasterization happen inside worker threads, not on the main thread. The pool nonce resets across HMR so you don't accumulate zombie workers.
- **Subscribe, don't poll.** The `ServerConnection` API is subscription-based (`subscribeInventory`, `subscribeSkills`, `subscribeCombat`, …). Most subsystems latch onto the relevant subscription once at boot and update their local state when the callback fires. There is no tick-level pull from the server.
- **Predict locally, reconcile on snapshot.** Player movement is locally predicted for responsiveness, then corrected when the server sends a position update. The reconciliation logic is in `src/client/movement/`.
- **The cache is sacred.** `src/rs/cache/` is the only code that should be touching the raw `.dat2`/`.idxN` format. Everything else consumes the `Type` objects the loaders produce.

See each sub-page for the full story.
