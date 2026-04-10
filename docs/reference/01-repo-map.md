# 01 — Repo map

This is the exhaustive map of the repository. Every top-level directory has a purpose, every subsystem has a canonical home. If you find yourself unsure where a new file belongs, this is the page to read.

## Top-level layout

```
xrsps-typescript/
├── src/                    # Browser client + shared code
├── server/                 # Node/Bun server
├── scripts/                # Project-level scripts (cache, tests, exports)
├── docs/                   # VitePress documentation site (you are here)
├── deployment/             # Caddy + deploy recipes
├── public/                 # Static assets served by craco
├── build/                  # craco production output (git-ignored)
├── caches/                 # Downloaded OSRS cache (git-ignored)
├── node_modules/           # Dependencies (git-ignored)
├── tests/                  # Cross-cutting tests (bun:test)
├── .husky/                 # Git hooks
├── .github/                # CI workflows (docs build)
├── craco.config.js         # Webpack/CRA customization
├── tsconfig.json           # Client TypeScript config
├── package.json            # Scripts + dependencies
├── bun.lock                # Bun lockfile
├── mprocs.yaml             # Dev-time parallel process runner
├── mprocs.build.yaml       # Build-time parallel process runner
├── target.txt              # Pinned OSRS cache revision
├── CNAME                   # Custom domain for github.io
├── CLAUDE.md               # Agent instructions (prefer Bun, etc.)
└── README.md               # Landing README
```

## `src/` — the browser client

`src/` contains both the client and the shared code. The split is logical, not physical:

```
src/
├── index.tsx               # React bootstrap; mounts OsrsClientApp
├── index.css               # Global styles (fonts, body reset)
│
├── client/                 # The OSRS client engine
│   ├── OsrsClientApp.tsx   # React wrapper; owns the OsrsClient lifecycle
│   ├── OsrsClient.ts       # ~17k line monolithic client state + subscriptions
│   ├── GameContainer.tsx   # Canvas wrapper React component
│   ├── GameRenderer.ts     # Abstract base class for renderers
│   ├── GameRenderers.ts    # Renderer factory (enumerates backends)
│   ├── DebugControls.tsx   # Leva-based dev overlay
│   ├── Camera.ts           # View/projection with spring-physics interpolation
│   ├── Frustum.ts          # View frustum culling
│   ├── InputManager.ts     # Keyboard/mouse/gamepad → OSRS key codes
│   ├── MapManager.ts       # Generic tile-square load/unload pool
│   ├── DestinationMarker.ts# Click-to-walk flag
│   ├── ClientState.ts      # Runtime state: entities, mouse
│   ├── MouseCross.ts       # OSRS-style cursor overlay
│   ├── PlayerAnimController.ts # Movement → animation index mapping
│   ├── Caches.ts           # IndexedDB cache listing
│   ├── TransmitCycles.ts   # Varp-transmit queue
│   ├── BrowserVarcsPersistence.ts # Local varp persistence
│   ├── useSafariLandscapeLock.ts # iOS landscape hook
│   ├── useViewportCssVars.ts # Viewport CSS var hook
│   │
│   ├── actor/              # Shared actor base (players + NPCs)
│   ├── audio/              # MusicSystem, SoundEffectSystem, Vorbis WASM
│   ├── data/               # Runtime spawn data (obj spawns)
│   ├── devoverlay/         # (Moved to src/ui/devoverlay/ — see there)
│   ├── ecs/                # Component storage for players and NPCs
│   │   ├── PlayerEcs.ts    # ~121 kB — position, appearance, anims
│   │   └── NpcEcs.ts       # ~53 kB
│   ├── interactions/       # Player interaction system
│   ├── login/              # Login screen + loading bar + GameState machine
│   ├── menu/               # Right-click world context menu
│   ├── movement/           # OsrsRouteFinder32, movement sync
│   ├── plugins/            # Optional client plugins (tilemarkers, notes, ground items…)
│   ├── roof/               # Roof/occlusion culling
│   ├── scene/              # Scene raycaster, plane resolver
│   ├── sidebar/            # Developer sidebar UI
│   ├── sync/               # Player/NPC update bitstream decoders
│   ├── webgl/              # WebGL2 renderer backend (the big one)
│   ├── worker/             # Off-main-thread worker pool (model loading, minimap)
│   └── worldview/          # Visible-entity region manager
│
├── rs/                     # OSRS engine code: cache + game-data loaders
│   ├── cache/              # Cache file system, archive, container
│   ├── compression/        # Bzip2, Gzip (WASM-backed)
│   ├── config/             # Type loaders: ObjType, LocType, NpcType, SeqType, …
│   ├── cs2/                # ClientScript 2 VM
│   ├── model/              # 3D models, seq-frame + skeletal anims
│   ├── scene/              # SceneBuilder, Scene, CollisionMap
│   ├── sprite/             # 2D sprites
│   ├── texture/            # Textures
│   ├── audio/              # Sound effect loader
│   ├── chat/               # Player type
│   ├── interaction/        # Interaction index encoding
│   ├── inventory/          # Client-side inventory model
│   ├── prayer/             # Prayer bitmask data
│   ├── skill/              # Skill ID constants
│   ├── util/               # rotation.ts, etc.
│   ├── MenuEntry.ts        # Menu option data
│   ├── MathConstants.ts    # DEGREES_TO_RADIANS, etc.
│   └── Client.ts           # Re-export barrel
│
├── ui/                     # React-facing UI layer (but renders via WebGL)
│   ├── Canvas.tsx          # React canvas wrapper
│   ├── UiScale.ts          # DPR / UI-scale calculations
│   ├── UiScaleDiagnostic.ts# window.__uiDiag diagnostic
│   ├── fonts.ts            # Web font loading
│   ├── widgets/            # Widget tree manager + loader + CS1 runner
│   ├── gl/                 # Low-level WebGL2 UI primitives (texture, text, scissor)
│   ├── menu/               # MenuEngine + MenuBridge
│   ├── item/               # Item icon rendering
│   ├── model/              # 3D-model-in-UI rendering
│   ├── text/               # Bitmap font atlas
│   ├── devoverlay/         # Dev overlays (tile markers, paths, hitsplats, …)
│   ├── game/               # EmoteService etc.
│   ├── cache/              # UI-level enum cache
│   └── registry/           # widgetRoles.ts (bank, inventory, spellbook, …)
│
├── components/             # Shared React components
│   └── renderer/Renderer.ts# Base animation loop (extended by GameRenderer)
│
├── network/                # Client-side networking
│   ├── ServerConnection.ts # WebSocket manager + all subscribe/send APIs
│   ├── ServerConnectionShim.ts # Type-only shim for non-browser contexts
│   ├── combat/CombatStateStore.ts
│   └── packet/             # Binary encoder/decoder + PacketBuffer
│       ├── PacketBuffer.ts
│       ├── PacketWriter.ts
│       ├── ClientBinaryEncoder.ts
│       ├── ClientPacket.ts
│       ├── ServerBinaryDecoder.ts
│       └── index.ts
│
├── shared/                 # Code consumed by both client and server
│   ├── CollisionFlag.ts    # Walkability bit constants
│   ├── Direction.ts        # MovementDirection enum + packing helpers
│   ├── vars.ts             # VARP_ / VARBIT_ constants
│   ├── packets/            # ClientPacketId + ServerPacketId enums + lengths
│   ├── network/            # Legacy low-level packet opcodes (1-103)
│   ├── instance/           # Dynamic instance chunk packing
│   ├── ui/                 # Widget UID, side journal, menu, music state
│   ├── items/              # Item search index
│   ├── gamemode/           # Gamemode data types, content store
│   ├── collectionlog/      # Collection log slot types
│   ├── projectiles/        # Projectile launch payloads
│   ├── spells/             # Selected-spell payload
│   ├── debug/              # Perf snapshot type
│   ├── input/              # Modifier flags
│   └── worldentity/        # Movable world entity types
│
├── chat/                   # Client-side chat content
├── custom/                 # Custom content registry (runtime-side)
├── picogl/                 # Tiny WebGL abstraction (PicoGL wrapper)
├── media/                  # Static assets bundled into the client
│
├── util/                   # General utilities
│   ├── CacheManifest.ts    # IndexedDB cache manifest
│   ├── DeviceUtil.ts       # iOS, touch, standalone detection
│   ├── StorageUtil.ts      # Storage quota
│   ├── MathUtil.ts
│   ├── ArrayBufferUtil.ts
│   ├── BytesUtil.ts
│   ├── FloatUtil.ts
│   ├── Hasher.ts
│   └── serverDefaults.ts   # DEFAULT_WS_URL, DEFAULT_SERVER_NAME (env-fed)
│
├── import-json.d.ts        # Ambient module declarations
├── java-random.d.ts
├── picogl.d.ts
├── shaders.d.ts
├── react-app-env.d.ts
├── reportWebVitals.ts
└── serviceWorkerRegistration.ts
```

### Rules of thumb for `src/`

- Anything under `src/client/` is **the game engine**: it owns runtime state, it drives a render loop, and it can call into any of `src/rs/`, `src/network/`, `src/ui/`, `src/shared/`.
- Anything under `src/rs/` is **pure OSRS format code**: it reads the cache and produces engine-agnostic data structures. It should not import from `src/client/` or `src/ui/`.
- Anything under `src/ui/` is **the HUD layer**: widgets, menus, overlays, UI chrome. It renders via WebGL onto the same canvas as the scene.
- Anything under `src/shared/` is **shared protocol**: types and constants _both_ the client and the server import. If it compiles for either side, it belongs here.
- Anything under `src/network/` is **client-side wire code**: encoders, decoders, the WebSocket manager.

## `server/` — the Node/Bun server

```
server/
├── config.json             # Per-deployment overrides (serverName, maxPlayers, …)
├── tsconfig.json           # Server TS config
├── .eslintrc.json
│
├── src/                    # Server engine source
│   ├── index.ts            # main() — the server entry point
│   ├── config/             # ServerConfig loader (reads config.json + env)
│   ├── audio/              # Server-side sound hooks
│   ├── custom/             # CustomItem + CustomWidget registries
│   ├── data/               # In-engine data loaders (not static JSON)
│   ├── game/               # Gameplay engine
│   │   ├── actor.ts        # Base Actor class
│   │   ├── player.ts       # PlayerState
│   │   ├── PlayerManager.ts
│   │   ├── npc/            # NpcState, NpcManager
│   │   ├── ticker.ts       # GameTicker (event-based)
│   │   ├── tick/           # TickPhaseOrchestrator
│   │   ├── combat/         # DamageTracker, combat math
│   │   ├── prayer/
│   │   ├── state/          # Persistence snapshots
│   │   ├── scripts/        # ScriptRegistry, ScriptRuntime, bootstrap
│   │   ├── services/       # Phase-1..8 extracted services
│   │   ├── gamemodes/      # GamemodeDefinition, BaseGamemode, registry
│   │   ├── interactions/
│   │   ├── items/          # Ground items
│   │   ├── spells/         # SpellDataProvider
│   │   └── model/          # Timers, LockState
│   ├── network/            # WSServer, packet encoders, broadcasters
│   │   ├── wsServer.ts     # The orchestrator
│   │   ├── MessageRouter.ts
│   │   ├── MessageHandlers.ts
│   │   ├── PlayerNetworkLayer.ts
│   │   ├── messages.ts     # ServerToClient message types
│   │   ├── broadcast/
│   │   ├── encoding/
│   │   ├── managers/
│   │   └── packet/
│   │       ├── PacketHandler.ts
│   │       ├── BinaryProtocol.ts
│   │       ├── ServerPacketBuffer.ts
│   │       └── ClientBinaryDecoder.ts
│   ├── pathfinding/PathService.ts
│   ├── widgets/            # Server-side widget metadata (viewport enum, etc.)
│   ├── world/              # CacheEnv, MapCollisionService
│   ├── types/              # Server-local type declarations
│   └── utils/              # logger and friends
│
├── gamemodes/              # Gamemode plugins
│   ├── vanilla/
│   │   ├── index.ts        # VanillaGamemode + createGamemode()
│   │   ├── banking/
│   │   ├── combat/
│   │   ├── data/           # Weapons, spells, runes, projectile params
│   │   ├── equipment/
│   │   ├── modals/
│   │   ├── prayer/
│   │   ├── scripts/        # Content handlers (doors, climbing, dialogues, …)
│   │   │   ├── content/
│   │   │   └── items/
│   │   ├── shops/
│   │   ├── skills/         # 13 skill modules
│   │   ├── state/
│   │   ├── systems/
│   │   └── widgets/
│   └── leagues-v/
│       ├── index.ts        # LeaguesVGamemode extends VanillaGamemode
│       ├── LeagueTaskManager.ts
│       ├── LeagueTaskService.ts
│       ├── LeagueMasteryDefinitions.ts
│       ├── LeagueContentProvider.ts
│       ├── LeagueSummaryTracker.ts
│       ├── LeaguesVUiController.ts
│       ├── data/
│       └── scripts/
│
├── extrascripts/           # Drop-in content modules
│   └── item-spawner/
│       ├── index.ts        # export register(registry, services)
│       └── (cs2 assets, etc.)
│
├── scripts/                # Server-side build tools
│   └── build-collision-cache.ts
│
├── data/                   # Static gameplay data (JSON)
│   ├── items.json          # Full item table (~16 MB)
│   ├── npc-spawns.json
│   ├── npc-combat-stats.json
│   ├── npc-combat-defs.json
│   ├── npc-sounds.generated.json
│   ├── npc-sounds.overrides.json
│   ├── npc-sounds.unresolved.json
│   ├── doors.json
│   ├── diaryVarbits.ts
│   ├── intermap-links.json
│   ├── projectile-params.json
│   ├── stair-floors.json
│   ├── accounts.json       # JsonAccountStore storage (git-ignored in prod)
│   └── gamemodes/
│       ├── vanilla/player-state.json
│       └── leagues-v/player-defaults.json
│
└── cache/                  # Generated at runtime
    └── collision/          # Precomputed collision maps
```

### Rules of thumb for `server/`

- **Engine code goes in `server/src/`.** It must never reference a specific gamemode. The only thing the engine knows about gamemodes is the `GamemodeDefinition` interface.
- **Gamemode-specific rules go in `server/gamemodes/{id}/`.** If you find yourself wanting to hard-code "if gamemode is vanilla" in the engine, you're doing it wrong — invent a `GamemodeDefinition` hook for it instead.
- **Extrascripts go in `server/extrascripts/{id}/`.** These are _universal_ — they work against any gamemode. Use them for tools (item spawners, admin commands) and for content that is genuinely gamemode-agnostic.
- **Static data is under `server/data/`.** JSON preferred (see `items.json`, `npc-spawns.json`). TypeScript-typed data lives in gamemode-specific `data/` folders under `server/gamemodes/{id}/data/`.

## `scripts/` — top-level tools

```
scripts/
├── ensure-cache.ts          # Download + validate OSRS cache on boot
├── download-caches.js       # Pre-fetch multiple cache revisions
├── test-auth.ts             # E2E auth test (bun run test:auth)
└── cache/
    ├── export-textures.ts
    ├── export-height-map.ts
    ├── export-items.ts
    ├── export-map-images.ts # Generate minimap tiles
    ├── generate-db-names.ts
    ├── generate-npc-sounds.ts
    ├── fill-npc-sound-overrides.ts
    ├── parse-intermap-links.ts
    ├── dump-script.ts
    └── load-util.ts
```

Every top-level script is either (a) wired into a `package.json` script target, or (b) a one-off dev utility. See [60 — Build, run, deploy](./60-build-run-deploy/02-scripts-reference.md) for the full table.

## `docs/` — the documentation site

```
docs/
├── index.md                # Landing page
├── setup.md                # Quick start
├── faq.md
├── ARCHITECTURE.md         # Short-form architecture
├── gamemodes.md
├── extrascripts.md
├── deployment.md
├── public/                 # docs assets (xrsps.png, etc.)
├── .vitepress/
│   ├── config.mts          # VitePress config (sidebar, etc.)
│   └── theme/              # Custom theme overrides
└── reference/              # ← You are here
    ├── index.md
    ├── 00-overview.md
    ├── 01-repo-map.md
    ├── 02-architecture.md
    ├── 10-client/
    ├── 20-server/
    ├── 30-shared/
    ├── 40-protocol/
    ├── 50-gamemodes-scripts/
    ├── 60-build-run-deploy/
    ├── 70-examples/
    └── 80-llm/
```

The documentation is a VitePress site. `bun run docs:dev` starts a hot-reloading preview on `http://localhost:5173`.

## `deployment/` and `public/`

`deployment/` currently contains a single `Caddyfile` that is the canonical recipe for terminating TLS in front of the WebSocket server. `public/` is the CRA `public/` directory; anything in here is copied into the final bundle unchanged. The generated `public/map-images/{target}/` tiles produced by `scripts/cache/export-map-images.ts` also land here.

## `caches/` and `build/`

Both directories are generated artifacts and are git-ignored.

- `caches/` is populated by `scripts/ensure-cache.ts` from the OpenRS2 archive. Expect ~200 MB per cache revision.
- `build/` is the `craco build` output. Upload it to a CDN or serve it from behind your Caddy reverse proxy.

## `tests/`

The repo currently ships one cross-cutting test, `tests/instance-parity.test.ts`, which exercises the dynamic-instance coordinate helpers in `src/shared/instance/`. Run with `bun test tests/`.

Subsystem tests are colocated with the code they test; for example, see `server/src/game/scripts/` for script-related tests if any are added.

---

## Canonical facts

- **Client entry**: `src/index.tsx` → `src/client/OsrsClientApp.tsx` → `src/client/OsrsClient.ts`.
- **Server entry**: `server/src/index.ts` (async `main()`).
- **Config loader**: `server/src/config/index.ts` (reads `server/config.json` + env vars).
- **Pinned cache**: `target.txt` (`osrs-237_2026-03-25`).
- **Dev orchestrator**: `mprocs.yaml`, `mprocs.build.yaml`.
- **Craco config**: `craco.config.js` (GLSL loader, JSON minimization, COOP/COEP headers).
- **Shared protocol**: `src/shared/packets/`, `src/shared/vars.ts`, `src/shared/Direction.ts`, `src/shared/CollisionFlag.ts`, `src/shared/instance/`.
- **Generated dirs (git-ignored)**: `caches/`, `build/`, `node_modules/`, `server/cache/`.
