# 10.6 — Sync and movement

OSRS runs on a 600 ms tick. Every tick, the server sends the client a packed update describing every player and NPC the local player can see: who's new, who moved, who animated, who said something, who changed equipment. The client decodes that into local state and then _renders continuously_ between ticks by interpolating movement and animation.

The code that implements this lives in two adjacent directories:

- `src/client/sync/` — decoding of the server's sync packets. Bit-level.
- `src/client/movement/` — interpolation, path stepping, and local movement prediction.

These two are the most OSRS-specific part of the client. If something visual feels "teleport-y" or "stuttery", it's almost always a bug in one of these files.

## `BitStream` (`src/client/sync/BitStream.ts`)

OSRS sync packets aren't byte-aligned. Most fields are variable-bit-length: a "no update" flag is 1 bit, a run/walk direction is 3–5 bits, a coordinate delta is 7 bits, and so on. `BitStream` wraps a `Uint8Array` and exposes:

- `readBits(n)` — read the next `n` bits (1–32) as an unsigned integer.
- `readSignedBits(n)` — same, but two's complement.
- `byteAlign()` — skip to the next byte boundary (used when a sub-section of the payload is byte-aligned).
- `getBytePosition()`, `getBitPosition()` — for debugging and bookkeeping.

The decoder classes below consume a `BitStream` exclusively — they never touch raw bytes.

## `PlayerSyncManager` (`src/client/sync/PlayerSyncManager.ts`)

The orchestrator. Owns:

- the local player's current `PlayerSyncContext` (position, plane, direction, etc.),
- a map of remote player IDs → `RemotePlayer` entries,
- the Huffman provider for chat decoding,
- the `PlayerUpdateDecoder` for the per-tick delta.

Per tick:

1. Receives a `PLAYER_SYNC` packet from `ServerConnection`.
2. Hands its payload to `PlayerUpdateDecoder.decode()`.
3. For each updated player, dispatches the resulting delta into the per-player `PlayerSyncActions` which mutate `PlayerSyncContext` and fire events.

The decoder itself is stateless — the manager owns the state. This matches how OSRS does it: the packet is a diff, not a snapshot.

### `PlayerSyncContext` and `PlayerSyncTypes`

Small types:

- `PlayerSyncContext` — the piece of state per player that sync touches: position, plane, movement type (teleport / walk / run), orientation, pending masks (appearance, hit, chat, say, spot anim, face entity, face coordinate, etc.).
- `PlayerSyncTypes` — enums for movement types and mask bit constants that match the server encoder exactly.

### `PlayerUpdateDecoder`

Walks the packet section by section:

1. **Local player block** — movement or teleport for the local player.
2. **Already-tracked players** — for each already-tracked remote player, a short block that either skips, walks, teleports, or removes them.
3. **Newly-visible players** — inserts new remote players into the manager with their initial position.
4. **Update masks** — a loop over every player (local + remote) that has an "update" bit set, reading each mask in a fixed order (see `PlayerSyncTypes`).

Every field is read through `BitStream`. If you're debugging "the packet decodes to garbage", start at the call site of `decode()` and add `console.log(stream.getBitPosition())` after each step — you'll see which step consumed the wrong number of bits.

### `AppearanceDecoder`

Decoding a player's visible appearance is its own ordeal: gender, skull, overhead, equipment slots, colors, idle animation, walk/run animations, combat level, and optional overrides. `AppearanceDecoder` reads it into a `PlayerAppearance` object that the renderer consumes to build the model (the server bases the list on its `AppearanceBuilder`, which lives under `server/src/player/appearance/`).

### Chat and `HuffmanProvider`

Public chat messages are Huffman-compressed using the cache's chat Huffman tree. `HuffmanProvider` loads the tree lazily and exposes a `decode()` helper that `PlayerUpdateDecoder` calls for the chat mask.

## `NpcUpdateDecoder` (`src/client/sync/NpcUpdateDecoder.ts`)

Structurally identical to `PlayerUpdateDecoder` but for NPCs:

1. Already-tracked NPCs: skip / walk / teleport / remove.
2. Newly-visible NPCs: insert at a coordinate with an NPC type ID.
3. Update masks: animation, spot anim, hitsplat, face coord/entity, transformation, etc.

The masks for NPCs are a subset of player masks (no appearance, no chat) plus a few NPC-specific ones (NPC transformation / retype).

## `src/client/movement/`

Once sync has written the high-level destinations, the movement module interpolates smoothly between ticks so the scene doesn't look jittery at 60 fps.

### `MovementPath` and `MovementState`

- **`MovementPath`** — a FIFO of tiles the player is walking through. Appended to by sync updates; consumed one tile per tick.
- **`MovementState`** — the authoritative client-side movement state for one entity: current sub-tile position, heading, movement mode (walk/run/teleport/idle), elapsed interpolation time, pending rotation.

### `PlayerMovementSync` and `NpcMovementSync`

These are the bridges between the sync delta and the `MovementState`:

- **`PlayerMovementSync.apply(ctx, delta)`** — given the local player's sync context and a movement delta, it:
  - Appends tiles to `MovementPath`,
  - Sets a run/walk flag,
  - Triggers a teleport (which resets interpolation) when the server signals one,
  - Produces a "destination" for `DestinationMarker`.
- **`NpcMovementSync.apply(...)`** — same for NPCs.

### `OsrsRouteFinder32` (`src/client/movement/OsrsRouteFinder32.ts`)

Client-side pathfinder. Used for local prediction: when the player clicks to walk, the client wants to show a path immediately rather than waiting for the next server tick. It runs a bounded BFS on the local collision map (derived from `CollisionMap` in `src/rs/scene/`) and returns a tile list.

Notes:

- It is not the authority. The server has its own pathfinder (`server/src/world/movement/OsrsRouteFinder32.ts` — yes, same filename) and its result is the one that matters. The client path is discarded if the server sends a different one.
- The "32" in the name refers to the 32×32 sub-tile path precision OSRS uses for certain movement scenarios.

### `NpcClientTick`

A small tick hook that advances every NPC's `MovementState` one logical step per server tick while the renderer interpolates _within_ the tick. It's here rather than in the renderer because the tick timing belongs to the engine, not the render loop.

## Interpolation: how the renderer actually moves things

Per render frame (not per tick), the renderer walks every entity and asks its `MovementState` for a sub-tile position:

```
t = min((nowMs - lastTickMs) / tickDurationMs, 1)
position = lerp(tileStart, tileEnd, t)
```

`tickDurationMs` is 600 ms. If the server is slower than that (extreme lag) the interpolation holds at the last tile rather than stretching — OSRS never visually drags a walk animation past its tick bound.

Facing direction is interpolated similarly, but with a shortest-arc rule so characters don't spin the long way around.

## Common symptoms

- **Player stutters on arrival at a destination.** Path is being replaced on every tick. Check that `PlayerMovementSync` is not clearing the path unconditionally.
- **NPCs teleport instead of walking.** The server sent a teleport mask. Usually intentional (spawn/respawn), but check.
- **Chat doesn't render.** `HuffmanProvider` failed to load; look for a chat Huffman error in the console.
- **Appearance flickers.** The appearance mask is being re-read every tick. Check that the cache hit in `AppearanceDecoder` is respected.

## Relationship to the server

Server side, the matching files are under:

- `server/src/network/sync/PlayerSyncManager.ts` + `PlayerUpdateEncoder.ts`
- `server/src/network/sync/NpcUpdateEncoder.ts`
- `server/src/world/movement/*`

The encoder and decoder must stay in lockstep. The unit tests under `server/src/network/sync/__tests__/` catch most drift.

---

## Canonical facts

- **Bit stream**: `src/client/sync/BitStream.ts` → `class BitStream`.
- **Player sync manager**: `src/client/sync/PlayerSyncManager.ts`.
- **Player update decoder**: `src/client/sync/PlayerUpdateDecoder.ts`.
- **Player sync actions**: `src/client/sync/PlayerSyncActions.ts`.
- **Player sync context**: `src/client/sync/PlayerSyncContext.ts`.
- **Player sync types/enums**: `src/client/sync/PlayerSyncTypes.ts`.
- **Player sync utils**: `src/client/sync/PlayerSyncUtils.ts`.
- **Appearance decoder**: `src/client/sync/AppearanceDecoder.ts`.
- **Huffman provider**: `src/client/sync/HuffmanProvider.ts`.
- **NPC update decoder**: `src/client/sync/NpcUpdateDecoder.ts`.
- **Movement path**: `src/client/movement/MovementPath.ts`.
- **Movement state**: `src/client/movement/MovementState.ts`.
- **Player movement sync**: `src/client/movement/PlayerMovementSync.ts`.
- **NPC movement sync**: `src/client/movement/NpcMovementSync.ts`.
- **NPC client tick**: `src/client/movement/NpcClientTick.ts`.
- **Client route finder**: `src/client/movement/OsrsRouteFinder32.ts`.
- **Movement sync types**: `src/client/movement/MovementSyncTypes.ts`.
- **Tick duration**: 600 ms (see `GameTicker` in server config).
- **Rule**: server sync is authoritative. Client state resets to match it on conflict.
