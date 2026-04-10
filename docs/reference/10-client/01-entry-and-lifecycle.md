# 10.1 — Entry and lifecycle

The client's entry point is the React bootstrap in `src/index.tsx`, which mounts `<OsrsClientApp>` from `src/client/OsrsClientApp.tsx`. That component owns a long-lived `OsrsClient` (`src/client/OsrsClient.ts`) and mediates between React state (loading spinners, login form, error toasts) and the engine state (cache, scene, network). This page walks through that bootstrap in detail and explains where the lifecycle seams are — which matters a lot because the client uses Hot Module Reloading during dev and you need to know what survives a hot reload and what doesn't.

## `src/index.tsx`

On import it does four things synchronously, before React mounts:

1. Initializes the **bzip2** and **gzip** WASM decompressors via the `@foxglove/wasm-bz2` and `wasm-gzip` packages. The cache archives use bzip2 for older groups and gzip for most of the post-667 content, so both are required before any cache read can succeed.
2. Installs the **UI scale diagnostic** (`src/ui/UiScaleDiagnostic.ts`), which exposes `window.__uiDiag` for in-browser debugging. This is lightweight and does not touch React.
3. Registers the **HMR dispose** hooks. When Webpack swaps `OsrsClient.ts` in dev mode, the old instance gets `.dispose()` called (closing WebSockets, stopping the render loop, stopping audio) and a new one takes over on the next render.
4. Calls `ReactDOM.render(<BrowserRouter><OsrsClientApp /></BrowserRouter>)` into the `#root` element in `public/index.html`.

There is no `useEffect` here — this is pure side-effect-on-import initialization. Treat `src/index.tsx` as "the few lines that must happen before React is allowed to run".

## `OsrsClientApp` (`src/client/OsrsClientApp.tsx`)

This is the top-level React component, and it orchestrates the client's _boot-up dance_: cache download, worker pool start, `OsrsClient` instantiation, connection to the server, and finally mounting the `GameContainer` that holds the actual canvas. Each step happens inside a `useEffect` so React can replay the lifecycle sensibly under strict mode and HMR.

The effect chain runs, roughly, in this order:

```
OsrsClientApp mounts
 ├── Effect A: check IndexedDB cache manifest
 │    ├── load src/util/CacheManifest.ts
 │    ├── if manifest absent/stale → fetch the downloaded cache (from /caches/…)
 │    │   and populate IndexedDB
 │    └── setReady(true)
 ├── Effect B: start RenderDataWorkerPool
 │    ├── compute optimal thread count (navigator.hardwareConcurrency clamped)
 │    ├── new RenderDataWorkerPool(threadCount)
 │    └── pool handle stored in React ref so HMR can dispose + recreate
 ├── Effect C: instantiate OsrsClient (depends on cache ready + pool ready)
 │    ├── new CacheSystem(…)
 │    ├── new OsrsClient(cacheSystem, pool, …)
 │    ├── window.osrsClient = <the instance>
 │    └── return dispose fn that HMR will invoke
 ├── Effect D: set up deferred install prompt
 │    └── capture the beforeinstallprompt event for PWA install
 └── Renders <GameContainer />
```

The effects deliberately use React's dependency array to serialize themselves: effect B waits for cache ready, effect C waits for both, and so on. This keeps the boot order deterministic even in StrictMode's double-invoke.

Some details worth internalizing:

- **`window.osrsClient`.** The instance is deliberately exposed as a global. It is the primary debugging surface — try `window.osrsClient.getCurrentTick()`, `window.osrsClient.isLoggedIn()`, `window.osrsClient.subscribeSkills(console.log)` in the devtools console.
- **HMR survival.** `OsrsClientApp` increments a worker-pool nonce on HMR so a new pool is created; this prevents the "zombie worker" problem where old workers linger after `ts` files change.
- **Cache size.** First-run downloads are ~200 MB. A loading overlay is shown during this step; the component blocks further effects until it is ready.
- **Service worker.** `src/serviceWorkerRegistration.ts` is imported but _not_ registered by default. If you want PWA/offline support, uncomment the registration call in `index.tsx`.

## `OsrsClient` (`src/client/OsrsClient.ts`)

This is the engine. It is a single enormous class that holds all local state the client needs to draw the world:

- **Cache handle**: a `CacheSystem<ASYNC>` plus every `TypeLoader` it needs at runtime (`BasTypeLoader`, `NpcTypeLoader`, `ObjTypeLoader`, `SeqTypeLoader`, `LocTypeLoader`, `VarManager`, `IdkTypeLoader`, `FloorTypeLoader`, `HealthbarTypeLoader`, `HitsplatTypeLoader`, `EnumTypeLoader`, `ParamTypeLoader`, `DbRepository`, …).
- **Player state**: position, animation, equipment, inventory, bank, skills, prayer, energy, run-toggle, auto-retaliate, special attack, combat target.
- **Per-world state**: player map (id → remote player), NPC map, ground items, projectiles, local active sound effects, music state.
- **Subscriptions**: it calls every `ServerConnection.subscribeX()` hook at construction time, writing incoming deltas back into its own state.
- **Systems**: it owns the `MusicSystem`, the `SoundEffectSystem`, the `WidgetManager` bridge, the `MenuEngine` bridge, the raycaster plane resolver, and so on.

`OsrsClient` is constructed with the `CacheSystem` already ready and the render-data worker pool already warm. It does **not** construct the `GameRenderer` — that happens inside `GameContainer` when the canvas is mounted. This separation matters because a headless `OsrsClient` is useful: for example, the `ItemIconRenderer` used in UI previews can use a stripped-down client without a scene.

Public API worth remembering:

- `getClientCycle(): number` — the client-side tick counter (monotonic, not necessarily aligned with the server)
- `getCurrentTick(): number` — the server tick the client has most recently received
- `isLoggedIn(): boolean`
- `isServerConnected(): boolean`
- `dispose(): void` — tear everything down (WebSocket, audio, subscriptions)

And the dozen-plus `subscribeX()` hooks that the UI layer plugs into — see [10.10 — Client networking](./10-networking.md) for the full list.

## `GameContainer` and `GameRenderer`

`GameContainer` (`src/client/GameContainer.tsx`) renders the actual canvas. It:

- Wraps the `<Canvas>` from `src/ui/Canvas.tsx`.
- Mounts the login UI (`<LoginOverlay>`) if the game state is `LOGIN`, and the regular HUD otherwise.
- Handles window resize and forwards it into the renderer.
- Mounts the `<DebugControls>` panel (leva-based) in dev, gated behind a query-string flag.
- Instantiates a `WebGLOsrsRenderer` (the only shipping renderer) against the canvas and calls its render loop.

`GameRenderer` (`src/client/GameRenderer.ts`) is the abstract base class for renderers. It owns a `MapManager<T extends MapSquare>` that tracks which map squares are loaded and should be drawn. The only concrete subclass today is `WebGLOsrsRenderer`; a fallback canvas renderer is sketched in `src/client/GameRenderers.ts` but not shipped.

## Global game state machine

```
GameState (src/client/login/GameState.ts)
┌──────────┐    login button    ┌──────────┐    server ready    ┌──────────┐
│  LOGIN   │ ─────────────────▶ │ LOADING  │ ─────────────────▶ │ IN_GAME  │
└──────────┘                    └──────────┘                    └──────────┘
     ▲                                                                │
     │                                                                │
     └───────────── logout / server disconnect ───────────────────────┘
```

The state lives in `LoginState` (`src/client/login/LoginState.ts`). The rest of the engine reads from it to decide whether to render the login screen or the world.

## HMR gotchas

- **Do not** create long-lived resources outside a React effect or outside the `OsrsClient` lifetime. They will leak on every save in dev.
- **Do not** stash state in module-level `let`s unless it is guarded by an HMR dispose hook. Use React refs + effects, or put it on `OsrsClient`.
- **Do** use `window.osrsClient` during debugging — it is stable across HMR because the React ref is updated in place.
- Browsers cache the WASM modules across reloads. If you see stale Vorbis or bzip2 behavior, a full page reload (not HMR) is the fix.

---

## Canonical facts

- **Client entry**: `src/index.tsx`.
- **Top React component**: `src/client/OsrsClientApp.tsx` → `function OsrsClientApp()`.
- **Core engine class**: `src/client/OsrsClient.ts` → `class OsrsClient`.
- **Global debug handle**: `window.osrsClient`.
- **Renderer mount**: `src/client/GameContainer.tsx` → owns `<Canvas>` and `WebGLOsrsRenderer`.
- **Game state machine**: `src/client/login/GameState.ts`.
- **HMR worker pool nonce**: in `OsrsClientApp.tsx`, increments on every module swap.
- **Cache manifest**: `src/util/CacheManifest.ts`.
- **Required WASM modules**: `@foxglove/wasm-bz2`, `wasm-gzip`, `xxhash-wasm`, `@wasm-audio-decoders/ogg-vorbis`.
