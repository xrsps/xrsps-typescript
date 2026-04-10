# 20.1 — Startup and lifecycle

`server/src/index.ts` is the single entry point. It runs an `async main()` that wires up every world-level service in a specific order and then starts the game tick. This page is a line-by-line tour of that boot sequence because the order is not arbitrary — most of the calls have a hidden dependency on an earlier one.

## The boot sequence

```ts
async function main() {
    // 1. Ticker (not running yet)
    const ticker = new GameTicker(config.tickMs);

    // 2. Cache environment (disk + loaders)
    const cacheEnv = initCacheEnv("caches");

    // 3. Map collision service (pre-computed + on-demand)
    const mapService = new MapCollisionService(cacheEnv, false, {
        precomputedRoot: "server/cache/collision",
        usePrecomputed: true,
    });

    // 4. Pathfinder
    const pathService = new PathService(mapService);

    // 5. Typed loaders from the cache
    const cacheFactory = getCacheLoaderFactory(cacheEnv.info, cacheEnv.cacheSystem);
    const npcTypeLoader = cacheFactory.getNpcTypeLoader();
    const basTypeLoader = cacheFactory.getBasTypeLoader();

    // 6. Viewport enum service (optional; hardcoded fallback)
    const enumTypeLoader = cacheFactory.getEnumTypeLoader();
    if (enumTypeLoader) {
        setViewportEnumService(new ViewportEnumService(enumTypeLoader));
    }

    // 7. NPC manager + NPC spawn file
    const npcManager = new NpcManager(mapService, pathService, npcTypeLoader, basTypeLoader);
    npcManager.loadFromFile(path.resolve("server/data/npc-spawns.json"));

    // 8. Gamemode
    const gamemode = createGamemode(config.gamemode);
    if (gamemode.getLootDistributionConfig) {
        damageTracker.lootConfigResolver = (npcTypeId) =>
            gamemode.getLootDistributionConfig!(npcTypeId);
    }

    // 9. WebSocket server
    const server = new WSServer({
        host: config.host,
        port: config.port,
        tickMs: config.tickMs,
        ticker,
        pathService,
        mapService,
        npcManager,
        cacheEnv,
        serverName: config.serverName,
        maxPlayers: config.maxPlayers,
        gamemode,
    });

    // 10. Spell-widget mapping (depends on gamemode having registered its SpellDataProvider)
    initSpellWidgetMapping(cacheEnv.info, cacheEnv.cacheSystem);

    // 11. Start ticking
    ticker.start();

    // 12. Shutdown handlers
    process.on("SIGINT", shutdown("SIGINT"));
    process.on("SIGTERM", shutdown("SIGTERM"));
}
```

### Why the order matters

1. **`GameTicker`** is created first but _not_ started. It is just a ticker; nothing runs until step 11. Creating it early lets everything else get a reference to it.
2. **`initCacheEnv`** reads the disk cache into a `CacheSystem<SYNC>`. This must happen before any typed loader is constructed, because loaders query the cache immediately.
3. **`MapCollisionService`** computes collision flags for tiles. It can load a _precomputed_ collision snapshot from `server/cache/collision/` (faster boot) or build from scratch (slower, used for new cache revisions before you've re-run the precompute script).
4. **`PathService`** needs the collision service — it's a BFS on top of it.
5. **Typed loaders** via `getCacheLoaderFactory()` — one factory, many loaders, all reading the same `CacheSystem`.
6. **`ViewportEnumService`** is optional. If the cache has enum 1745 (display-mode component mapping), the server uses it to translate display-mode IDs into widget component IDs. Otherwise it falls back to a hardcoded mapping in the widgets module.
7. **`NpcManager`** has to happen before gamemode creation because the gamemode may register spawn hooks that need to see the manager.
8. **Gamemode creation** (via `createGamemode(config.gamemode)`) is where the plugin layer plugs in. The gamemode's constructor runs any bootstrap side effects (registering spell providers, drop tables, loot configs, custom widgets, extrascripts). After this call, the runtime world is authoritative about gameplay rules.
9. **`WSServer`** ties everything together: it takes every service above and constructs a `ServerServices` bundle, wires tick phases into the ticker, and starts listening on the WebSocket port.
10. **`initSpellWidgetMapping`** must run _after_ the gamemode, because the gamemode is what chose which spellbook to register. Running it earlier would read the default spellbook and then silently get overridden.
11. **`ticker.start()`** finally starts the per-tick loop. Until this call, time is frozen.
12. **Shutdown handlers** ensure a clean stop on `SIGINT` / `SIGTERM`: stop ticking, dispose the gamemode, exit.

### Service instantiation summary

At the end of `main()`, the process has these singletons in memory:

| Service | Purpose |
|---|---|
| `GameTicker` | Runs the tick loop |
| `CacheEnv` | Holds `CacheSystem` and `CacheInfo` |
| `MapCollisionService` | Collision flags per tile |
| `PathService` | BFS pathfinder |
| `NpcManager` | All world NPCs |
| `Gamemode` | Gameplay rules |
| `WSServer` | WebSocket accept loop |
| `ServerServices` | Bundle of all services, injected into every session |

These are constructed once and never recreated. There is no "world reset" path — restarting the server is the only way to reset the world.

## Config loader (`server/src/config/`)

`config/index.ts` exports a `config: ServerConfig` constant populated from:

1. `server/config.json` (checked in).
2. Environment variables (`PORT`, `HOST`, `TICK_MS`, etc.) if set.
3. Hardcoded defaults if neither the file nor the env var provides a value.

### `ServerConfig` fields

- `host: string` — bind address (default `0.0.0.0`).
- `port: number` — WebSocket port (default `43594`).
- `tickMs: number` — tick duration (default `600`).
- `serverName: string` — shown in the client world list (default `XRSPS`).
- `maxPlayers: number` — soft cap (default `2047`).
- `gamemode: string` — which gamemode to load by name (default `vanilla`).
- `accountsFilePath: string` — path to JSON account store.
- `minPasswordLength: number` — password length requirement.
- `allowedOrigins: string[]` — CORS origins for the WebSocket upgrade.

The config module is imported _once_ at the top of `index.ts`; other modules should take the pieces they need as function arguments, not import `config` directly. This makes them testable without a real config file.

## Graceful shutdown

The shutdown handler:

```ts
const shutdown = (signal: string) => () => {
    logger.info(`Received ${signal}, shutting down...`);
    ticker.stop();
    gamemode.dispose?.();
    process.exit(0);
};
```

It does **not**:

- Wait for in-flight player saves. (A crash-safe save loop is a TODO.)
- Notify players of the shutdown. (Another TODO.)
- Drain the tick phase. The ticker's `stop()` sets a flag that's read at the top of the next tick.

For now, if you need a clean shutdown in production, rely on the periodic save that happens during normal ticks and do a soft stop before pulling the container.

## Logging

`server/src/utils/logger.ts` exposes a tiny wrapper around `console.log` with log levels. Boot messages use `logger.info` so you can grep for `Boot:` and see the whole startup sequence in order. If a boot step hangs, the last `Boot:` line you see is the one that's hanging.

---

## Canonical facts

- **Entry point**: `server/src/index.ts`, `async function main()`.
- **Config**: `server/src/config/index.ts`, `ServerConfig` interface.
- **Config file**: `server/config.json`.
- **Cache env init**: `server/src/world/CacheEnv.ts`, `initCacheEnv(path)`.
- **Map collision**: `server/src/world/MapCollisionService.ts`.
- **Path service**: `server/src/pathfinding/PathService.ts`.
- **NPC manager**: `server/src/game/npcManager.ts`.
- **NPC spawn file**: `server/data/npc-spawns.json`.
- **Gamemode registry**: `server/src/game/gamemodes/GamemodeRegistry.ts`, `createGamemode(name)`.
- **WSServer**: `server/src/network/wsServer.ts`.
- **Ticker**: `server/src/game/ticker.ts`, `class GameTicker`.
- **Logger**: `server/src/utils/logger.ts`.
- **Default config**: port `43594`, tick `600` ms, gamemode `vanilla`, `maxPlayers` 2047.
