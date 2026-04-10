# 10.3 — Rendering (`src/client/webgl/`)

`src/client/webgl/` is the client's 3D renderer. It's a WebGL2 backend implemented as a concrete `GameRenderer` subclass (`WebGLOsrsRenderer`) that consumes the `Scene` graph produced by `SceneBuilder` and draws terrain, locs (scenery), players, NPCs, projectiles, ground items, and overlay effects into the canvas.

Rendering is a lot of code. This page won't show you shader source — read the `.glsl` files directly under `src/client/webgl/shaders/` for that — but it will show you the file layout, the data flow from scene to frame, and the invariants you must not violate when touching it.

## High level

Every frame:

1. The renderer asks the `Camera` for the view-projection matrix.
2. It asks the `Frustum` which map squares and which locs inside those squares are visible.
3. It calls into `WebGLMapSquare` for each visible square to record draw calls against the terrain + loc vertex buffers.
4. It renders players and NPCs from the ECS.
5. It renders projectiles and ground items.
6. It renders the UI layer through `src/ui/gl/`.
7. It submits the command list to the `DrawBackend`.
8. Optional: the `PerformanceProfiler` times the frame with WebGL queries.

The main loop is driven by the base class `GameRenderer` from `src/client/GameRenderer.ts`, which extends `Renderer` from `src/components/renderer/Renderer.ts`. `GameRenderer` applies the `targetFps` clamp and respects `document.hidden` (no work while the tab is backgrounded).

## File map

```
src/client/webgl/
├── WebGLOsrsRenderer.ts      (~617 kB)  the renderer
├── WebGLMapSquare.ts         (~88 kB)  per-map-square GPU buffers
├── PerformanceProfiler.ts              GPU timing via WebGLQuery
├── DrawBackend.ts                      VAO/VBO/state abstraction
├── RenderDistancePolicy.ts             view distance decisions
├── ChatheadFactory.ts                  NPC chathead renderer
├── PlayerChatheadFactory.ts            player chathead renderer
├── WorldEntityAnimator.ts              dynamic world entities
├── shaders/                            GLSL source (terrain, models, UI, …)
├── buffer/                             low-level GPU buffer management
├── gfx/                                graphics utilities (uniforms, states)
├── loader/                             asset loaders (models, textures, animations)
├── loc/                                loc (scenery) rendering
├── npc/                                NPC rendering
├── player/                             player rendering
├── projectiles/                        projectile rendering
├── ground/                             ground item rendering
└── texture/                            texture management
```

## The renderer (`WebGLOsrsRenderer`)

This is the largest file in the repo. Don't be intimidated — most of the size is the combined shader program setup, the vertex buffer layouts, the skinning uniforms, and a big main render function. It is organized into sections, most of which you don't need to touch to change rendering behavior. You will spend most of your time in:

- The constructor: allocates GL resources, compiles shaders, creates pipelines.
- `update(frameState)`: called each frame before `render`. Advances camera, animations, frustum.
- `render(frameState)`: the main draw function. Issues the actual GL calls.
- `loadMapSquare(mapX, mapY)`: asks the worker pool for a `WebGLMapSquare`, which is pushed onto the map manager.
- `disposeMapSquare(mapX, mapY)`: releases GPU resources when a square leaves view.

### Notable details

- **Deferred composition.** Terrain is drawn in multiple passes (underlay, overlay, shadowing) so it can blend with the tile overlay colors used by OSRS.
- **Per-tile frustum culling.** The renderer computes per-tile visibility rather than per-map-square, because a single 64×64 square often straddles the view frustum edge and whole-square culling is too coarse.
- **Shared vertex buffers.** All locs within a map square share the same vertex/index buffers for efficiency; the renderer emits draw calls with per-loc uniforms.
- **Chathead factories.** `ChatheadFactory` and `PlayerChatheadFactory` render character headshots into small textures, used for the dialog UI (`<chat dialog>`) and the player sidebar.
- **World entity animator.** `WorldEntityAnimator` is the hook for moving world entities (boats, ships, vehicles) that ride their own instance.

### How rendering talks to the scene

`GameRenderer` holds a `MapManager<WebGLMapSquare>`. Each loaded square is a `WebGLMapSquare` instance produced from a `Scene` by calling the worker pool's build-map job and then bouncing the resulting data back onto the main thread to upload GPU buffers.

The critical data that flows across the worker boundary is a transferable `ArrayBuffer` containing vertex data; it's shaped so the main thread can `bufferData` it directly without further parsing. This is the single most performance-sensitive boundary in the client.

## `WebGLMapSquare`

A `WebGLMapSquare` owns:

- **Terrain VAO/VBO/IBO** — a triangle mesh for the 64×64 tiles of one square, with vertex attributes for position, normal, color, and texture UV.
- **Loc VAOs/VBOs** — one or more, depending on how many locs the square has. Loc geometry is consolidated into batches by material.
- **Cached Bounds** — the bounding box used for frustum culling.
- **Per-tile metadata** — walk flags, LoD hints, overlay colors.

It implements the `MapSquare` interface from `src/client/MapManager.ts`, but adds all the WebGL-specific state.

## Worker pool integration

Model and animation loading are expensive. The renderer offloads as much as it can onto the `RenderDataWorkerPool` (`src/client/worker/RenderDataWorkerPool.ts`). A typical flow:

1. Scene build for a map square is requested.
2. The pool dispatches to an idle `RenderDataWorker`.
3. The worker loads the raw region data from the cache (it owns its own `CacheSystem`), runs the scene builder, extracts flat vertex/index arrays, and transfers them back.
4. The main thread creates a `WebGLMapSquare`, uploads the buffers, and hands it to the `MapManager`.

See [10.11 — Worker pool](./11-worker-pool.md) for the full worker setup.

## Performance profiling

`PerformanceProfiler.ts` uses `EXT_disjoint_timer_query_webgl2` to measure actual GPU time per frame. Enable it by toggling the relevant leva control in `DebugControls.tsx`, or by setting a query-string flag. The profiler emits frames with fields `gpuMs`, `drawCalls`, `vertices`, `triangles`, `textureUploads`. You can read them off `window.osrsClient` or route them into `src/shared/debug/PerfSnapshot.ts` for upload.

## `RenderDistancePolicy`

This decides how far the renderer should look. It considers camera altitude, current FPS, and user preference, and returns a ring of map squares to keep loaded. The map manager then uses this list to trigger load/unload.

## Draw backend (`DrawBackend.ts`)

Thin abstraction over WebGL2 state. Tracks currently-bound VAOs, buffers, and programs; short-circuits redundant bind calls; exposes a tiny command API (`bindProgram`, `setUniforms`, `drawElements`, `drawElementsInstanced`). This is the primitive all the concrete draw paths use.

## Sub-directories in brief

- **`shaders/`** — GLSL source files. `ts-shader-loader` imports them as strings via Webpack (configured in `craco.config.js`). Expect to see files per pass: terrain underlay, terrain overlay, loc, player, etc.
- **`buffer/`** — reusable buffer helpers: ring buffers, upload queues, resizable typed arrays.
- **`gfx/`** — render-state utilities (`GlState`, uniform block helpers, sampler management).
- **`loader/`** — model/animation/texture loader glue specific to the WebGL backend. These sit above `src/rs/*/Loader.ts`.
- **`loc/`, `npc/`, `player/`, `projectiles/`, `ground/`** — per-entity-type render modules. Each usually exposes a builder that produces a batch and a draw method the main renderer calls.
- **`texture/`** — texture cache/manager specific to the renderer (distinct from the UI layer's texture cache under `src/ui/gl/texture-cache.ts`).

## Invariants

- **Never touch GL state outside `DrawBackend`.** If you need new state (e.g., stencil ops), add it to `DrawBackend` first.
- **No blocking main-thread work** inside the render loop. Defer expensive loads to workers. You will cause jank.
- **All vertex buffers are interleaved.** The attribute layout is a per-vertex struct, not separate arrays. If you add an attribute, update the layout in the matching shader in `shaders/`.
- **Do not import from `src/rs/` inside shaders.** The shader files are plain GLSL strings; they know nothing about TypeScript.
- **HMR and GL contexts do not mix.** A fresh `WebGLOsrsRenderer` must be constructed after a full canvas teardown, not lazily re-attached to an existing GL context.

---

## Canonical facts

- **Main renderer**: `src/client/webgl/WebGLOsrsRenderer.ts` → `class WebGLOsrsRenderer extends GameRenderer`.
- **Map square**: `src/client/webgl/WebGLMapSquare.ts` → `class WebGLMapSquare implements MapSquare`.
- **Base renderer class**: `src/client/GameRenderer.ts`, `src/components/renderer/Renderer.ts`.
- **Draw backend**: `src/client/webgl/DrawBackend.ts`.
- **Performance profiler**: `src/client/webgl/PerformanceProfiler.ts`.
- **Render distance policy**: `src/client/webgl/RenderDistancePolicy.ts`.
- **Chathead factories**: `src/client/webgl/ChatheadFactory.ts`, `src/client/webgl/PlayerChatheadFactory.ts`.
- **World entity animator**: `src/client/webgl/WorldEntityAnimator.ts`.
- **Shaders**: `src/client/webgl/shaders/*.glsl`, imported through `ts-shader-loader` (see `craco.config.js`).
- **Worker pool**: `src/client/worker/RenderDataWorkerPool.ts`.
- **Draw-backend-only GL state rule**: do not call `gl.enable` outside this module.
- **Required GL extension**: `EXT_disjoint_timer_query_webgl2` (optional, for profiling).
