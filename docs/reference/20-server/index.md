# 20 — Server reference

The server is a Node/Bun TypeScript WebSocket game server that simulates the OSRS world at a fixed 600 ms tick. It lives under `server/src/`.

## What it does each tick

1. Read all inbound packets queued since last tick.
2. Run the tick phase orchestrator, which steps movement, combat, interactions, skills, NPC AI, projectiles, and world entities in a fixed order.
3. For every connected player, build and send the outgoing packet bundle (player sync, NPC sync, widget updates, skill deltas, inventory updates, messages, …).
4. Sleep until the next 600 ms boundary.

The outer loop is in `server/src/game/ticker.ts` (`class GameTicker`); the inner per-tick orchestration lives in `server/src/game/tick/TickPhaseOrchestrator.ts`.

## Pages in this section

| Page | Topic |
|---|---|
| [01 — Startup and lifecycle](./01-startup.md) | `server/src/index.ts`, config loader, service wiring |
| [02 — Tick system](./02-tick-system.md) | `GameTicker`, `TickPhaseOrchestrator`, phase order |
| [03 — Services](./03-services.md) | The extracted game services under `server/src/game/services/` |
| [04 — Player state](./04-player-state.md) | `player.ts`, `PlayerManager`, subcomponents |
| [05 — NPC subsystem](./05-npcs.md) | `npc.ts`, `npcManager.ts`, combat AI |
| [06 — Combat](./06-combat.md) | `game/combat/` — state machine, formulas, special attacks |
| [07 — Movement and pathfinding](./07-movement-pathfinding.md) | `pathfinding/`, collision services |
| [08 — World and cache env](./08-world.md) | `world/CacheEnv`, collision, doors, instance manager |
| [09 — Network layer](./09-network.md) | `network/`, message routing, sync sessions |
| [10 — Persistence](./10-persistence.md) | Account store, serialization, save loop |
| [11 — Gamemode loader](./11-gamemode-loader.md) | `GamemodeRegistry`, how gamemodes and extrascripts get wired |
| [12 — Script runtime](./12-script-runtime.md) | `ScriptRegistry`, `ScriptRuntime`, handler lookup |
| [13 — Data files](./13-data-files.md) | `server/src/data/`, hand-authored game content |

## Core invariants

- **All mutation of world state happens inside a tick phase.** If you're tempted to mutate a player's inventory from a WebSocket handler, don't — queue an action for the next tick.
- **Nothing writes to the socket outside the broadcast phase.** The broadcast phase is a single place that gathers everything and emits it.
- **Services are singletons per world.** One `GameContext` holds them all; pass that around rather than importing globals.
- **The server owns the cache too.** Same loaders as the client, wrapped in a sync `CacheSystem`.
- **No `require`, no `any`, no top-level side effects.** All initialization happens inside `main()` in `index.ts`.
