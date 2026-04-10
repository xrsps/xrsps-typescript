# 00 — Overview

XRSPS is a community-built reimplementation of Old School RuneScape (OSRS), written in TypeScript, that runs end-to-end in the browser. There is no native client to install, no JVM, no Jagex-owned binary — a player opens a URL, the React app downloads the OSRS cache from a pinned revision, establishes a WebSocket to the server, and starts playing. On the other side of that WebSocket is a Node/Bun TypeScript process running a fixed-rate game loop that ticks at 600ms, exactly like the real OSRS.

The project is a single Git repository (`xrsps-typescript`) with a monorepo layout. The browser client lives under `src/`, the server under `server/`, and the code that is genuinely shared between the two lives under `src/shared/`. There is no lerna, no workspaces config; everything is built together with a single `package.json`, a single `tsconfig.json` for the client (CRA + Craco), a dedicated `server/tsconfig.json` for the server, and `bun` as the preferred runtime everywhere.

## Mental model

Think of XRSPS as having five layers, each of which gets a full reference section later in this document:

**1. The cache.** A frozen snapshot of OSRS assets — models, textures, animations, item/NPC/object definitions, 2D sprites, UI widget trees, CS2 scripts, audio — stored in the OSRS `.dat2` + `.idxN` format. It is the single source of truth for the game's content. Both client and server load the same cache at boot. The cache is **not** committed to the repo; `scripts/ensure-cache.ts` downloads it on first run from the OpenRS2 archive. The current pinned revision is in `target.txt` (currently `osrs-237_2026-03-25`).

**2. The client engine** (`src/client/`, `src/rs/`, `src/ui/`, `src/picogl/`). A large, mostly-classical TypeScript engine that reads the cache, builds 3D scenes, runs a WebGL2 renderer, rasterizes the OSRS UI into that same WebGL context, handles input, runs a login screen, decodes audio, and maintains all player and NPC state that the client needs to display the world. The entry point is the React component `OsrsClientApp` in `src/client/OsrsClientApp.tsx`, which owns a long-lived `OsrsClient` instance (`src/client/OsrsClient.ts`).

**3. The network layer.** A binary WebSocket protocol, with opcodes defined in `src/shared/packets/`. The client side lives in `src/network/` (in particular `ServerConnection.ts` and the encoders/decoders in `src/network/packet/`). The server side lives in `server/src/network/`. Packet lengths are fixed where possible and prefixed with a 1- or 2-byte length for variable payloads, OSRS-style. Player and NPC synchronization use a bit-packed update protocol to keep bandwidth tight.

**4. The server engine** (`server/src/`). A Node/Bun process that owns the world — players, NPCs, ground items, collision, movement, combat, skills, varps, widgets, chat — and runs a fixed-rate tick loop. The entry point is `server/src/index.ts`. On boot it initializes the cache, the collision service, the pathfinder, the NPC manager, the gamemode plugin, and finally the `WSServer` in `server/src/network/wsServer.ts`, which accepts WebSockets and drives a `TickPhaseOrchestrator` (`server/src/game/tick/TickPhaseOrchestrator.ts`).

**5. The gamemode and script layer** (`server/gamemodes/`, `server/extrascripts/`, `server/src/game/scripts/`). This is the _content_ layer. A **gamemode** is a pluggable implementation of `GamemodeDefinition` — it decides rules, XP rates, drop tables, spawn locations, tutorial state, and registers all the content handlers (click-a-door → open it, click-a-rock → start mining). An **extrascript** is a smaller, gamemode-agnostic module that registers handlers the same way but ships independently. Both register through `ScriptRegistry` (`server/src/game/scripts/ScriptRegistry.ts`), which is dispatched by `ScriptRuntime`.

You can hold a lot of this in your head at once if you anchor on this loop:

```
┌───────────────┐  WebSocket  ┌─────────────────────────┐
│  Browser      │◀───────────▶│ Node/Bun server         │
│               │             │                         │
│ React UI ─────┼──┐          │ ┌─────────────────────┐ │
│ WebGL scene   │  │          │ │ TickPhaseOrchestrator│ │
│ Cache (IndexedDB)│          │ │ (600 ms loop)        │ │
│ ServerConn. ──┼──┘          │ │                      │ │
│               │             │ │ broadcast ─▶ movement│ │
│               │             │ │ ─▶ scripts ─▶ combat │ │
│               │             │ │ ─▶ effects ─▶ final   │ │
│               │             │ │    broadcast         │ │
│               │             │ └─────────────────────┘ │
└───────────────┘             └─────────────────────────┘
```

Every tick, the server picks up everything that has changed since the last tick, encodes it into per-player binary packets, and flushes them out. The client decodes those packets, updates its local state, and paints the next frame. In between, the player clicks things, the client sends action packets, and the server queues those actions to run on the next tick.

## What XRSPS is not

It is not a public worlds replacement for Jagex. It is a fan project with no affiliation or blessing, and it does not and will not contain Jagex's own cache files — users download the cache from the OpenRS2 archive on first run.

It is not a faithful reimplementation of every OSRS mechanic. The engine is close enough that a vanilla gamemode feels like OSRS, but content is implemented piece-by-piece by contributors. Expect rough edges and missing features. The vanilla gamemode's `server/gamemodes/vanilla/scripts/content/` directory is where most of the live-coded rough edges accumulate.

It is not a framework. There is no abstract "game engine" sitting under XRSPS that you could rip out and use for another game — the code is OSRS-shaped top to bottom. If you want a generic tile-based MMO framework this is the wrong repo.

## Where to go next

- If you want the file-by-file map of the repo, read [01 — Repo map](./01-repo-map.md).
- If you want the data-flow architecture (the _why_), read [02 — Architecture](./02-architecture.md).
- If you just want to get it running, skip to [60 — Build, run, deploy](./60-build-run-deploy/index.md).
- If you want to write your first content handler or gamemode, jump to [50 — Gamemodes & scripts](./50-gamemodes-scripts/index.md) and then [70 — Worked examples](./70-examples/index.md).

---

## Canonical facts

- **Repo root layout**: `src/` (client), `server/` (server), `scripts/` (build + cache tools), `docs/` (this reference + VitePress site), `deployment/` (Caddyfile), `caches/` (generated at runtime, git-ignored), `build/` (craco production output).
- **Client entry**: `src/index.tsx` → `src/client/OsrsClientApp.tsx` → `src/client/OsrsClient.ts`.
- **Server entry**: `server/src/index.ts` → `main()` async fn.
- **Gamemode entry**: `server/gamemodes/{id}/index.ts` exporting `createGamemode(): GamemodeDefinition`.
- **Extrascript entry**: `server/extrascripts/{id}/index.ts` exporting `register(registry, services): void`.
- **Pinned OSRS cache**: `target.txt` (currently `osrs-237_2026-03-25`).
- **Default server port**: `43594` (classic RuneScape world port), configurable via `PORT` env or `config.host` / `config.port` in `server/src/config/index.ts`.
- **Default tick rate**: `600ms`, configurable via `TICK_MS` env.
- **Default gamemode**: `"vanilla"`, overridable via `GAMEMODE` env or `config.json`.
- **Dev orchestrator**: `mprocs.yaml` runs `bun run server:start` and `bun run start` side-by-side.
- **Runtime**: Bun ≥ 1.3 preferred per `CLAUDE.md`, but the code works with Node ≥ 22.16 (per `README.md`).
