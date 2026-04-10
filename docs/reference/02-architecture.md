# 02 — Architecture

This page is the full end-to-end architecture. It assumes you've read [00 — Overview](./00-overview.md) and have at least skimmed [01 — Repo map](./01-repo-map.md). The goal here is to give you a mental model of the data flow so that when you open a file you already know what it's doing at a high level.

## The one-paragraph version

XRSPS is a fixed-rate authoritative server driving a browser client over a binary WebSocket. The server runs a 600 ms tick loop orchestrated by `TickPhaseOrchestrator`, which per tick runs through a fixed pipeline (broadcast → pre-movement → movement → music → scripts → combat → death → post-scripts → post-effects → orphan cleanup → broadcast-phase) and flushes per-player binary packet buffers out the WebSocket. The client owns a `ServerConnection` that decodes those packets and fans them out to subsystem subscribers (`OsrsClient` keeps authoritative local state), while the rendering loop (a WebGL2 renderer living in `src/client/webgl/WebGLOsrsRenderer.ts`) reads that state each frame. Inputs flow in the other direction: the click handlers in `src/client/InputManager.ts` and `src/ui/gl/click-registry.ts` translate mouse clicks to `ClientPacketId` payloads, which `ServerConnection` encodes and sends; the server's `MessageRouter` routes each packet to a handler, which either mutates state directly or enqueues an action on the `ActionScheduler`.

If you understand that paragraph, the rest of this page is just unpacking it.

## Boot sequence

There are three independent boot sequences: the browser client, the server, and (in dev) `mprocs` which starts both.

### Server boot (`server/src/index.ts`)

```text
main()
├── new GameTicker(config.tickMs)              // EventEmitter, not yet running
├── initCacheEnv("caches")                     // loads OSRS cache from disk
│   └── → CacheEnv { info, cacheSystem }
├── new MapCollisionService(cacheEnv, …, {     // precomputed from server/cache/collision
│       precomputedRoot: "server/cache/collision",
│       usePrecomputed: true,
│     })
├── new PathService(mapService)                // A* over the collision grid
├── getCacheLoaderFactory(info, cacheSystem)   // → NpcTypeLoader, BasTypeLoader, EnumTypeLoader
├── setViewportEnumService(…)                  // enum 1745 — display-mode component mapping
├── new NpcManager(mapService, pathService, npcTypeLoader, basTypeLoader)
│   └── .loadFromFile("server/data/npc-spawns.json")
├── createGamemode(config.gamemode)            // require("server/gamemodes/{id}/index.ts")
│   └── → GamemodeDefinition (Vanilla by default)
├── damageTracker.lootConfigResolver = gamemode.getLootDistributionConfig
├── new WSServer({ host, port, tickMs, ticker, … })
│   ├── populate ServerServices container
│   ├── wire Phase 1–8 services
│   ├── bootstrap scripts: gamemode.registerHandlers + loadExtrascriptEntries
│   └── listen on ws://host:port
├── initSpellWidgetMapping(info, cacheSystem)
├── ticker.start()                             // → GameTicker begins emitting "tick"
└── process.on("SIGINT" | "SIGTERM", shutdown)
```

The key numbers:

- Default `tickMs = 600`
- Default `port = 43594` (classic RuneScape world port)
- Default `host = "0.0.0.0"`
- Default `gamemode = "vanilla"`
- Default `maxPlayers = 2047` (the sync index space is 2048, slot 0 reserved)

All overridable by `server/config.json` or by environment variables (`PORT`, `TICK_MS`, `HOST`, `GAMEMODE`, `ALLOWED_ORIGINS`, `ACCOUNTS_FILE_PATH`, `AUTH_MIN_PASSWORD_LENGTH`). See [60 — Build, run, deploy](./60-build-run-deploy/index.md) for the full env-var table.

### Client boot (`src/index.tsx`)

```text
index.tsx
├── initialize Bzip2 + Gzip WASM
├── install UI diagnostic (window.__uiDiag)
├── ReactDOM.render(<BrowserRouter><OsrsClientApp /></BrowserRouter>)
└── (HMR: dispose old OsrsClient, create new one)

OsrsClientApp
├── useEffect: ensure-cache flow
│   ├── load cache manifest (src/util/CacheManifest.ts)
│   ├── if not present in IndexedDB: fetch from server (public/caches/…)
│   └── set "cache ready" state
├── useEffect: start render-data worker pool
│   └── src/client/worker/RenderDataWorkerPool.ts
├── useEffect: instantiate OsrsClient (src/client/OsrsClient.ts)
│   ├── new CacheSystem(…)
│   ├── instantiate all TypeLoaders (Obj, Loc, Npc, Seq, Bas, Floor, …)
│   ├── attach ServerConnection subscriptions
│   └── window.osrsClient = this
├── render <GameContainer>
└── <GameContainer>
    ├── <Canvas/>                               // the main WebGL canvas
    ├── <LoginOverlay/> or <GameUi/>
    └── mount WebGLOsrsRenderer
```

The critical subtlety is that `OsrsClient` is long-lived across hot reloads. The React component `OsrsClientApp` uses HMR disposal hooks so the in-flight WebSocket and audio graph survive a dev-mode file save. The global `window.osrsClient` handle is there deliberately for debugging.

## Tick loop

The heart of the server is `TickPhaseOrchestrator` (`server/src/game/tick/TickPhaseOrchestrator.ts`), driven by `GameTicker` (`server/src/game/ticker.ts`). `GameTicker` is a plain `EventEmitter`; it schedules the next tick using `setTimeout`, compensates for drift, and emits a `"tick"` event with `{ tick: number, time: number }`. If a tick runs long, it tries to catch up up to `maxCatchUpTicks` (default 5) before logging a warning and skipping ahead.

On each `"tick"`, the orchestrator runs phases in this order:

| # | Phase | What it does |
|---|---|---|
| 1 | `broadcast` | Flush queued messages from the _previous_ tick's work — skills, varps, inventories, most "snapshot" style updates. |
| 2 | `pre_movement` | Resolve player walk destinations, compute paths, pull queued movement. |
| 3 | `movement` | Advance player and NPC positions one (or two, for run) tiles. Collision-checked against `MapCollisionService`. |
| 4 | `music` | Region-based music track changes and unlocks. |
| 5 | `scripts` | User-registered per-tick handlers (from `ScriptRegistry.registerTickHandler`). |
| 6 | `combat` | Run the combat step — attacker ticks, hit rolls, damage application, hitsplats. |
| 7 | `death` | Process player/NPC deaths, drop loot, schedule respawns. |
| 8 | `post_scripts` | Scripts that run after combat (death triggers, etc.). |
| 9 | `post_effects` | Status effects (poison, venom) tick down. |
| 10 | `orphaned_players` | Check orphaned (disconnected-during-combat) players for cleanup. |
| 11 | `broadcast_phase` | Final sync: NPC update stream, ground items, any final varps, then `PlayerNetworkLayer.flush()` for every connected player. |

All phases share a `TickFrame` object that carries per-tick state — the current tick number, the wall-clock time, optional `playerDeltasByWebSocket`, and scratch space for broadcasters. The orchestrator uses a `yieldAfter` flag on some phases so long batches can release the event loop.

Profiling is opt-in: set `TICK_PROFILE=1` to log per-phase timings and warn on overrun. The budget is `tickMs` minus a small safety margin.

## Packet flow, inbound

```
Client                           WebSocket                    Server
──────                           ─────────                    ──────
InputManager click ────▶ ServerConnection.sendPacket(opcode, payload)
                         └── ClientBinaryEncoder.encodeClientMessage(msg)
                         └── ws.send(Uint8Array) ────────▶
                                                              ws.on("message") in wsServer.ts
                                                              └── ClientBinaryDecoder.decode(bytes)
                                                                   └── PacketHandler.handle(player, packet)
                                                                        ├── if legacy type string → MessageRouter.dispatch(type, msg, ctx)
                                                                        │   └── MessageHandlers[type](ctx)
                                                                        │       └── queue mutation + ScriptRuntime.execute(handler)
                                                                        └── if OSRS-style opcode → PacketHandler dispatches by ClientPacketId
                                                                            └── e.g. NPC_OP_1 → PlayerInteractionSystem → ScriptRuntime
```

Every inbound handler runs *synchronously* during message-receive, which is **outside** the tick. Handlers that need to mutate world state typically don't mutate directly — they enqueue an action on `ActionScheduler` which runs during the tick's `scripts` phase. Handlers that need to reply immediately (for example `sendChatMessage` for a local command echo) can take a fast path through `PlayerNetworkLayer.withDirectSendBypass()`.

## Packet flow, outbound

```
Server                                                   WebSocket             Client
──────                                                   ─────────             ──────
SkillService.addXp(player, skill, xp)
└── SkillBroadcaster.queue({ player, skill, level, xp })

(tick boundary: broadcast phase)
BroadcastScheduler.flushAll()
├── SkillBroadcaster.buildForPlayer(p) → ServerPacketBuffer
├── VarBroadcaster.buildForPlayer(p) → ServerPacketBuffer
├── InventoryBroadcaster.buildForPlayer(p)
├── ActorSyncBroadcaster.buildForPlayer(p)
├── NpcInfoEncoder.encodeForPlayer(p)
├── WidgetBroadcaster.buildForPlayer(p)
└── PlayerNetworkLayer.sendWithGuard(ws, buffer, "broadcast")
      └── ws.send(Uint8Array) ─────────▶
                                                        ServerConnection._onMessage(bytes)
                                                        └── ServerBinaryDecoder.read
                                                             └── loop: readByte(opcode) → readPayload(SERVER_PACKET_LENGTHS[opcode])
                                                                 └── dispatch to subscribed handler
                                                                     └── OsrsClient.subscribeX(cb) cb(msg)
```

Notable details:

- **Message batching.** `PlayerNetworkLayer.sendWithGuard` accumulates `send()` calls and only actually flushes during the broadcast phase. `withDirectSendBypass(ctx, fn)` temporarily disables batching for high-priority messages (login handshake, modal dismiss).
- **Variable vs fixed lengths.** `SERVER_PACKET_LENGTHS` encodes a fixed byte count per opcode, or `-1` for a 1-byte length prefix, or `-2` for a 2-byte big-endian length prefix. The decoder respects these. See [40 — Protocol: binary encoding](./40-protocol/02-binary-encoding.md).
- **Bit-packed sync.** Player and NPC update packets use a bitstream, not a byte stream. Both sides have matching implementations: the server writes bits via `ServerPacketBuffer.writeBits()`; the client reads via `src/client/sync/BitStream.ts`.
- **Huffman compression.** Chat messages are compressed with the Huffman dictionary loaded from the cache (`src/rs/util` / server `Huffman` singleton). The client decodes them on receipt.

## Persistence

Player state is stored as JSON through `AccountStore`, the abstract interface in `server/src/game/state/`. The default implementation is `JsonAccountStore`, which writes to the file configured by `config.accountsFilePath` (default `server/data/accounts.json`).

A save roundtrip looks like:

```
autosave tick
├── for each connected player:
│   ├── PlayerStateSerializer.exportPersistentVars(player)
│   │   └── assembles: varps, varbits, skills, bank, inventory,
│   │       equipment, location, hitpoints, run energy, quick prayers,
│   │       collection log, equipment charges, play time, …
│   ├── gamemode.serializePlayerState(player)     // gamemode-specific extras
│   │   └── merges into persistentVars.gamemodeData[gamemodeId]
│   └── accountStore.saveAccount(saveKey, persistentVars)
```

Autosave defaults to every 30 seconds and is coordinated from `TickFrameService` so it runs between phases, not inside them.

On login, the reverse happens:

```
LoginHandshakeService.onConnection(ws, msg)
├── AuthenticationService.validate(username, password)
│   └── accountStore.loadAccount(saveKey) → PlayerPersistentVars | null
├── playerManager.allocatePlayer()
├── player.restore(persistentVars)                // rehydrate every slot
├── gamemode.onPlayerHandshake(player, bridge)    // default varps/varbits
├── gamemode.onPlayerLogin(player, bridge)        // custom login
└── initial sync: inventory, equipment, skills, appearance, widgets, location, …
```

## Gamemode and script layer

From the engine's point of view, a gamemode is _the thing that installed the script handlers_. Everything past that is just the engine dispatching interactions:

```
click NPC "Talk-to Bob"
└── ClientPacketId.NPC_OP_TALK_TO reaches server
    └── PacketHandler decodes {npcIndex, clickMode, ctrl}
        └── PlayerInteractionSystem.onNpcOp(player, npc, "talk-to")
            └── ScriptRuntime.runNpcInteraction(player, npc, "talk-to")
                └── ScriptRegistry.getNpcInteractionHandler(npcTypeId, "talk-to")
                    └── handler(ctx) // registered by gamemode or extrascript
                        └── ctx.services.dialog.open(player, …)
                        └── ctx.services.variables.set(player, varp, …)
                        └── ctx.services.inventory.add(player, itemId, qty)
                        └── …
```

Handlers run _once_, synchronously, in response to the packet. They can schedule multi-step actions by calling `ActionScheduler.schedule(player, action)`, where an `Action` is a little state machine with `step(tickCtx)` methods and a termination condition.

The gamemode's job in its `initialize()` hook is to register all those handlers plus any data providers the engine will look up later — combat formulas, weapon stats, drop tables, etc. See [50 — Gamemodes & scripts](./50-gamemodes-scripts/index.md) for the complete API.

## Cache pipeline

The OSRS cache is the single source of truth for assets. Both client and server load the same cache:

- **On the server**, `initCacheEnv("caches")` opens `caches/{target}/` via a `FileArchiveSystem` and exposes a `CacheSystem<SYNC>` backed by synchronous file reads. The server needs this for authoritative things like NPC definitions (to read max hits), location data (to know which tiles a door blocks), and the `enum` tables (viewport mapping).
- **On the client**, the cache is downloaded the first time the app runs and stored in IndexedDB. `CacheSystem<ASYNC>` wraps this storage, and every `TypeLoader` is async. `RenderDataWorkerPool` also holds a cache handle inside worker threads for off-main-thread model loading.

`scripts/ensure-cache.ts` is the client-facing setup step. On a cold start it:

1. Reads `target.txt` to know which revision to pin.
2. Checks `caches/{target}/` for `main_file_cache.dat2`, `main_file_cache.idx255`, `info.json`, `keys.json`.
3. If missing, acquires a lock file (`caches/.cache-download.lock`), hits `https://archive.openrs2.org/caches.json`, picks the matching cache, downloads `disk.zip`, extracts it, and writes `keys.json` with the XTEA keys.
4. In client mode, optionally regenerates the minimap tiles via `scripts/cache/export-map-images.ts` so `public/map-images/{target}/` is populated.

Server mode (`npx tsx scripts/ensure-cache.ts --server`) skips the minimap tile step.

## Synchronization model

A few invariants are worth internalizing before you dig into the subsystem pages:

**Server is authoritative.** Every state change that matters to other players goes through the server. The client predicts some things (movement paths, mouse-click feedback) but any time the server disagrees, the server wins.

**Per-tick deltas, not deep diffs.** The server queues changes during a tick and then, during the broadcast phase, asks each broadcaster ("did anything relevant to this player happen?") and writes just those deltas to that player's buffer. The client applies them in order. There is no general "rehash the whole world" path on the hot loop.

**Player IDs are stable for the session.** A connected player is allocated an index in `[1..2047]` at login and keeps it until logout. Other players reference each other by this index in sync packets. The free-list recycles IDs on disconnect.

**Orphan window.** A player who disconnects while in combat is not immediately removed. They remain in-world as an "orphaned player" for up to 100 ticks so their combat resolves, preventing log-out abuse. See `PlayerManager.addOrphanedPlayer`.

**Lock states.** `LockState` gates most player actions (`COMBAT`, `MOVEMENT`, `ANIMATION`, `INTERACTION`, `LOADING`). Action handlers check locks before mutating state. Actions that want exclusivity set a lock and clear it in their cleanup.

**Varps vs varbits.** A varp is a 32-bit client-visible player variable, synced at varp-level granularity. A varbit is a named slice of a varp (some range of bits). Writing a varbit is actually a read-modify-write on the underlying varp. The server tracks dirty varps per tick and only sends the ones that changed. See `src/shared/vars.ts` for the canonical list of well-known IDs.

## When in doubt: follow the opcode

The single most useful debugging technique in XRSPS is: pick an opcode from `src/shared/packets/`, grep for it, and walk the entire path it takes. The code is organized so that most opcodes have a small, findable handler chain. If you can't find a handler for an opcode, it's either (a) unimplemented, (b) handled by a generic fallback in `MessageRouter`, or (c) dispatched to `ScriptRegistry` at runtime by a gamemode, in which case the registration will be in `server/gamemodes/{id}/` somewhere.

---

## Canonical facts

- **Tick orchestrator**: `server/src/game/tick/TickPhaseOrchestrator.ts`.
- **Ticker**: `server/src/game/ticker.ts` → `class GameTicker extends EventEmitter`.
- **Boot**: `server/src/index.ts` → `main()`.
- **Config**: `server/src/config/index.ts` → `export const config: ServerConfig`.
- **Cache env**: `server/src/world/CacheEnv.ts` → `initCacheEnv(root: string)`.
- **Collision**: `server/src/world/MapCollisionService.ts`.
- **Pathfinding**: `server/src/pathfinding/PathService.ts`.
- **Client entry**: `src/client/OsrsClient.ts`, `src/client/OsrsClientApp.tsx`.
- **Client WS manager**: `src/network/ServerConnection.ts`.
- **Client packet encoder**: `src/network/packet/ClientBinaryEncoder.ts`.
- **Server packet decoder (client-side reader)**: `src/network/packet/ServerBinaryDecoder.ts`.
- **Server packet encoder**: `server/src/network/packet/BinaryProtocol.ts`, `server/src/network/packet/ServerPacketBuffer.ts`.
- **Server packet decoder (server-side)**: `server/src/network/packet/ClientBinaryDecoder.ts`, `server/src/network/packet/PacketHandler.ts`.
- **Packet opcode tables**: `src/shared/packets/ClientPacketId.ts`, `src/shared/packets/ServerPacketId.ts`.
- **Known varps/varbits**: `src/shared/vars.ts`.
- **Default tick ms**: `600` (`server/src/config/index.ts`).
- **Default port**: `43594` (same file).
- **Profiling**: set `TICK_PROFILE=1` to log per-phase timings.
