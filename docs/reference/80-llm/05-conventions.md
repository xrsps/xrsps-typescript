# 80.5 — Conventions

Naming, layering, and module-boundary rules. These are the invariants a contributor (or an LLM) needs to internalize to write code that fits the codebase without creating friction.

## Runtime

| Rule | Why |
|---|---|
| **Bun for everything** — `bun <file>`, `bun test`, `bun run <script>`, `bun install`, `bunx <pkg>`, `Bun.serve`, `Bun.file`, `bun:sqlite`, `Bun.redis`. See `CLAUDE.md`. | Single runtime, no dotenv, native TS, fast cold start. |
| **Server uses `Bun.serve` for WebSockets**. Don't add `ws` or `express`. | Removes a large dep surface and matches the dev loop. |
| **Don't use `dotenv`** — Bun loads `.env` automatically. | Fewer surprises. |
| **Prefer `Bun.file` over `node:fs/promises`** in new code where streaming helps. | Consistency. |

## Layering (hard rules)

```
src/shared/    ← no DOM, no Node, no Bun-only apis. Pure TS + standard library.
src/rs/        ← cache decoders. No DOM. Can use TypedArray + DataView.
src/client/    ← browser only. May import from rs/ and shared/.
src/ui/        ← React components. May import from client/, rs/, shared/.
src/network/   ← client networking. May import shared/ + rs/.
server/src/    ← Bun/Node only. May import shared/ and rs/ (cache is reusable!).
server/gamemodes/<id>/ ← dynamic-required; may import server/src/ and shared/.
server/extrascripts/<id>/ ← same; must export register().
```

Never import `src/client/` or `src/ui/` from `server/`. Never import `server/` from `src/`.

## Packets

| Rule |
|---|
| All opcode enums live in `src/shared/packets/`. Never inline a literal opcode. |
| Client-to-server opcodes are in the range **180-255**, server-to-client in **0-250**. |
| Every opcode MUST have a row in the matching `*_PACKET_LENGTHS` table. |
| Variable-length packets use length `-1` (u8 length prefix) or `-2` (u16 length prefix). |
| Big-endian for multi-byte integers. Strings are **CP-1252**, not UTF-8. |
| Use `smart` (variable-length 1-or-2-byte) encoding for mostly-small values. |
| Bit-packed sections go through `BitWriter` (server) and `BitStream` (client). Never hand-pack. |
| Quantities that can exceed 254 use the "0xFF marker + u32" rule. |
| Server handlers live in `server/src/network/handlers/` grouped by feature, wired from `MessageRouter.ts`. |

## Scripts (server)

| Rule |
|---|
| Handlers register against `ScriptRegistry`. Never call handlers directly. |
| Handlers are **non-reentrant per player** — long-running ones must use `ctx.queueDelay(ticks)` to yield. |
| Match order: (npcId, option) > (npcId, *) > (ANY_NPC_ID, option) > (ANY_NPC_ID, *). Same pattern for loc and item. |
| Handlers MUST be idempotent on reload — track handles from `register*` return values and unregister on re-entry. |
| Extrascripts are opt-in and live in `server/extrascripts/<id>/`. Missing `register` export → silently skipped. |
| Gamemodes live in `server/gamemodes/<id>/` and must export `createGamemode(ctx)` from `index.ts`. |
| Custom widget group ids start at **50000** to avoid colliding with vanilla cache ids. |
| Custom item ids start at **50000** too. |

## Ticks

| Rule |
|---|
| Tick length is **600 ms**, fixed. Don't add "faster tick for this thing" — add a sub-tick sub-system instead. |
| The 11 tick phases are: `broadcast → pre_movement → movement → music → scripts → combat → death → post_scripts → post_effects → orphaned_players → broadcast_phase`. |
| `broadcast_phase` is the ONLY place frames are flushed to sockets. Everything else enqueues. |
| Scripts run in the `scripts` phase. Combat in `combat`. Never cross-call between them. |
| State mutations from scripts must be visible by the end of the `scripts` phase; later phases must see them. |
| Don't `setTimeout` or `setInterval` in game code — schedule against the ticker. |

## Persistence

| Rule |
|---|
| Player state is authoritative in-memory during a session and persisted on tick in the broadcast phase. |
| Never write to disk from a handler synchronously — enqueue via the account store. |
| Default store is `JsonAccountStore`. Custom backends implement `PersistenceProvider`. |
| New persistent fields must have a default in `deserializePlayerState` for backward compatibility. |

## Cache access

| Rule |
|---|
| Loaders are DOM-free and usable in any Bun/Node script as well as the browser. |
| `CacheSystem.openFromDisk(dir)` for Bun/Node; `openFromIndexedDB()` for browsers. |
| `load(id)` returns `undefined` for gaps — always guard. |
| Server opens once via `initCacheEnv(dir)` into `CacheEnv`; pass `CacheEnv` around, not the raw system. |
| Don't modify cache data at runtime. Overlay changes via `CustomWidgetRegistry`, `CustomItemBuilder`, etc. |

## Naming

| Pattern | Example |
|---|---|
| Classes: PascalCase | `PlayerSyncSession` |
| Functions / methods: camelCase | `addItem`, `queueDelay` |
| Constants: SCREAMING_SNAKE | `ANY_ITEM_ID`, `TICK_MS` |
| Types / interfaces: PascalCase, no `I` prefix except for registries (`IScriptRegistry`) | `GamemodeDefinition` |
| Enum members: SCREAMING_SNAKE | `ClientPacketId.WALK` |
| File names mirror exported class | `PlayerManager.ts` exports `PlayerManager` |
| Extrascript id = directory name = lowercase kebab | `item-spawner` |
| Gamemode id = directory name = lowercase kebab or snake | `vanilla`, `leagues-v`, `hc-5x` |
| Custom widget group constants: `<NAME>_GROUP_ID` | `DAILY_REWARD_GROUP_ID` |
| Custom item id constants: `<NAME>_ITEM_ID` | `TELEPORT_PAD_ITEM_ID` |

## Imports

| Rule |
|---|
| Prefer relative imports within a layer; prefer `src/shared/...` from anywhere that can see it. |
| Don't reach through `index.ts` barrels unless one already exists — the repo uses direct file imports. |
| Never import from `node_modules` paths; always the package name. |
| Never import `server/` code from `src/` or vice versa. |
| Never import React in non-UI files. |

## React + UI

| Rule |
|---|
| Hooks live next to their feature (`useGroundItems`, `useInventory` in `src/network/useServerConnection.ts`). |
| Components are functional + hooks. No class components. |
| State that needs to survive navigation lives in `ClientState` or a network slice — not in React local state. |
| Plugins register via `CLIENT_PLUGINS` in `src/ui/plugins/pluginhub/PluginRegistry.ts`. |
| Never use `localStorage` directly in game code — go through `BrowserVarcsPersistence` or the plugin hub. |

## Testing

| Rule |
|---|
| `bun test` for everything. Never add `jest` or `vitest`. |
| Tests live next to the code they test (`Foo.ts` + `Foo.test.ts`) OR under `__tests__/`. |
| Integration tests that need a running server use the helpers in `server/src/game/testing/`. |
| Tests must not reach into the real cache on disk — use fixtures. |

## Error handling

| Rule |
|---|
| Handlers log-and-continue on bad input; never crash the tick loop. |
| Network layer crashes are scoped to the offending player — `PlayerNetworkLayer` catches and disconnects them. |
| Unrecoverable server errors go through the logger with `fatal` level; systemd restarts the process. |
| Client-side errors report via `reportWebVitals` + in-dev overlay. |

## Logging

| Rule |
|---|
| Use the shared logger, not `console.log`, in server code. |
| Log levels: `debug`, `info`, `warn`, `error`, `fatal`. Default is `info`. Set via `LOG_LEVEL`. |
| Tag prefix convention: `[subsystem]` e.g. `[extrascript-loader]`, `[player-sync]`. |
| Hot paths (every tick / every player) should log at `debug` only. |

## Env vars

| Var | Purpose |
|---|---|
| `REACT_APP_WS_URL` | Client → server WebSocket URL (baked at client build time) |
| `REACT_APP_SERVER_NAME` | Display name of the server in the client UI |
| `BOT_SDK_TOKEN` | Secret for bot-SDK port 43595 |
| `LOG_LEVEL` | Server logger threshold |
| `TICK_PROFILE` | `1` to dump per-phase tick timings |
| `SYNC_DUMP` | `1` to dump PLAYER_SYNC / NPC_INFO bit layouts |

## Documentation

| Rule |
|---|
| Every new feature ships with a page under `docs/reference/`. |
| LLM-facing pages (section 80) are dense tables, not prose. |
| Every page ends with a **Canonical facts** block listing exact file paths and symbols. |
| Cross-links use relative paths (`../50-gamemodes-scripts/02-script-registry.md`). |
| VitePress sidebar lives in `docs/.vitepress/config.mts` — add new pages there. |

## What NOT to do

- Don't add new runtimes (no `node` imports that would break in Bun; no `ws`; no `express`).
- Don't hand-pack bits — use `BitWriter` / `BitStream`.
- Don't write to `localStorage` in artifacts or plugins — go through the persistence seam.
- Don't call handlers directly — always register.
- Don't extend the cache format — overlay instead.
- Don't mix gamemode content with engine code — gamemodes live in `server/gamemodes/<id>/`.
- Don't use `UTF-8` for protocol strings — **CP-1252** everywhere.
- Don't add new tick phases without an architecture discussion.
- Don't block the event loop — yield with `queueDelay` for long-running work.
- Don't amend the cache at runtime — use `CustomItemBuilder` / `CustomWidgetRegistry`.
