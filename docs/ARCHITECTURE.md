# Architecture

XRSPS is a full-stack OSRS emulation engine. The client runs in the browser with React and WebGL. The server runs on Node.js with WebSocket networking. Both are written in TypeScript and share the same OSRS cache.

## Project Layout

```
src/                    # Browser client
  client/               # Game engine, rendering, input, sync
  rs/                   # Cache loaders and OSRS engine code
  network/              # Client-side networking
  ui/                   # Game UI overlays
  components/           # React components

server/
  src/                  # Server core
    game/               # Gameplay systems (players, NPCs, combat, skills, actions)
    network/            # WebSocket server, packet encoding, message routing
    world/              # Cache environment, collision, map data
    data/               # Item/NPC/spell definitions
    scripts/            # Script registry and built-in modules
  gamemodes/            # Gamemode implementations
  extrascripts/         # Optional content modules
  data/                 # Static JSON data (spawns, doors, combat defs)

scripts/                # Cache export and build tools
```

## Game Loop

The server runs a **600ms tick loop** — the same as OSRS. Each tick:

1. Process queued player actions (combat, skills, interactions)
2. Tick NPCs (AI, combat, movement)
3. Encode updates into binary packets
4. Send sync packets to all connected clients

The client receives `PLAYER_SYNC` and `NPC_INFO` packets each tick, decodes them, and renders the updated world state on the next frame.

## Networking

Communication is over **WebSocket** with a **binary protocol**. No JSON at runtime.

- Client packets: `src/shared/network/ClientPacketId.ts`
- Server packets: `src/shared/packets/ServerPacketId.ts`
- Message routing: `server/src/network/MessageRouter.ts`

Packets cover movement, interactions, widget clicks, combat, inventory, chat, and sync updates.

## Cache

Both client and server load the OSRS cache — the same binary format Jagex uses. It contains models, animations, maps, widgets, item definitions, NPC definitions, and more.

- **Server:** loads from disk via `initCacheEnv("caches")`
- **Client:** loads from IndexedDB (downloaded from CDN on first visit)
- **Loaders:** `CacheLoaderFactory` provides typed loaders (NPC types, obj types, loc types, animations, textures, etc.)

Cache files are stored in `caches/` (gitignored) and managed by `scripts/ensure-cache.ts`.

## Varps and Varbits

OSRS uses **varps** (player variables) and **varbits** (bit-packed sub-variables) to drive UI state. The server modifies varps, sends delta packets to the client, and client-side CS2 scripts react to the changes to update widgets.

This is how equipment panels, skill tabs, settings, and all widget state stays in sync — no custom UI packets needed.

## Actions

All player actions flow through the **ActionScheduler**:

1. Client sends an interaction packet
2. `MessageRouter` dispatches to the correct handler
3. Handler creates an action payload and queues it
4. On subsequent ticks, the scheduler executes the action
5. Type-specific handlers process it (`CombatActionHandler`, `SkillActionHandler`, etc.)
6. `EffectDispatcher` applies results (animations, XP drops, loot)

## Persistence

Player state is stored through a **`PersistenceProvider`** interface (`server/src/game/state/PersistenceProvider.ts`). This decouples storage from game logic — the server doesn't care whether data lives in a JSON file, SQLite, or Postgres.

The default implementation is `PlayerPersistence` — a JSON flat file provider that stores all players in a single `player-state.json` per gamemode under `server/data/gamemodes/{id}/`.

### Save triggers

- **Login/logout** — saved immediately via `saveSnapshot()`
- **Autosave** — bulk save every 120 seconds via `savePlayers()`
- **Orphan expiration** — saved when a disconnected-in-combat player is removed

### What gets persisted

The `PlayerStateSerializer` (`server/src/game/state/PlayerStateSerializer.ts`) handles export/import of:
- Skills, hitpoints, location, orientation
- Inventory, equipment, bank (capacity, tabs, modes)
- Varps/varbits, combat settings, prayer, autocast state
- Equipment charges, degradation charges, collection log
- Gamemode-specific state (via `gamemode.serializePlayerState()`)

### Custom backends

To implement a custom backend, create a class that implements `PersistenceProvider`:

```typescript
import type { PersistenceProvider } from "./game/state/PersistenceProvider";

class SqlitePersistenceProvider implements PersistenceProvider {
    applyToPlayer(player, key) { /* load from db */ }
    hasKey(key) { /* check if exists */ }
    saveSnapshot(key, player) { /* write to db */ }
    savePlayers(entries) { /* bulk write */ }
}
```

Then swap it in at `server/src/network/wsServer.ts` where `PlayerPersistence` is constructed. No other code changes needed.

For backends that need setup/teardown (database connections), implement `ManagedPersistenceProvider` which adds optional `initialize()` and `dispose()` hooks.

## Content Systems

All gameplay content (skills, combat, shops, UI, etc.) is registered through the **script system** via `ScriptRegistry`. Content is organized into [Gamemodes](/gamemodes) (server identity and rules) and [Extrascripts](/extrascripts) (universal modules).
