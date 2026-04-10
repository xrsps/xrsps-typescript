# 10.10 — Client networking (`src/network/`)

Everything the client sends to and receives from the server goes through `ServerConnection` and the codec modules under `src/network/packet/`. This page describes the shapes, the subscription API, and the policies around reconnects and backpressure.

## `ServerConnection` (`src/network/ServerConnection.ts`)

A thin wrapper around a `WebSocket` with three responsibilities:

1. **Connection lifecycle.** Connect, reconnect, disconnect. Emits events on state change.
2. **Packet dispatch.** Reads incoming binary frames, decodes them with `ServerBinaryDecoder`, and fans them out to the right subscribers.
3. **Outbound queuing.** Accepts typed packet objects, serializes them with `ClientBinaryEncoder`, and writes to the socket.

It's constructed once in `OsrsClient` and reused across logouts (we only drop it on a full page navigation or HMR dispose).

### The `subscribe*` API

`ServerConnection` exposes a family of `subscribe<X>(callback)` methods — one per incoming packet category. They return an unsubscribe function. `OsrsClient` calls them at construction time and routes the callbacks into its internal state. UI code that needs to react to, say, skill XP changes can also subscribe through `OsrsClient` (which re-emits) or directly through `ServerConnection` if the raw packet is more useful.

A non-exhaustive list of subscriptions (names are illustrative — check `ServerConnection.ts` for the full list):

- `subscribeSkills` — skill levels and XP deltas.
- `subscribeInventory` — inventory container updates.
- `subscribeBank` — bank container updates.
- `subscribeEquipment` — equipment changes.
- `subscribeChat` — chat messages (public, private, game, system).
- `subscribePlayerSync` — the big player sync packet (→ `PlayerSyncManager`).
- `subscribeNpcSync` — the big NPC sync packet (→ `NpcUpdateDecoder`).
- `subscribeGroundItems` — ground item spawns and removes.
- `subscribeProjectiles` — projectile launches.
- `subscribeWidgetOpen`, `subscribeWidgetClose`, `subscribeWidgetSetText`, etc. — widget state deltas.
- `subscribeVarp`, `subscribeVarbit` — player variable updates.
- `subscribeMusic`, `subscribeSoundEffect` — audio triggers.
- `subscribeCameraShake`, `subscribeCameraReset`, etc. — camera effects.

### Reconnection

On socket close, `ServerConnection` checks whether the close was clean. If unclean (network blip, server restart), it retries with exponential backoff up to a configured cap. During retry, the client state is frozen: sync stops advancing, movement interpolation holds, the UI shows a "reconnecting…" banner.

Successful reconnect does _not_ automatically log the player back in. The client transitions back to the login screen with a "session expired" message unless the retry succeeded within a short grace window and the server still has the player's session in memory.

### Send path

`ServerConnection.send(packet)` serializes via `ClientBinaryEncoder` and writes. If the socket is not in `OPEN` state, the packet is dropped and a warning is logged — the client does not queue outbound packets across reconnects because OSRS semantics are "the packet is meaningful only against the current session".

## `ServerConnectionShim` (`src/network/ServerConnectionShim.ts`)

A mock connection used in tests and the `ItemIconRenderer` headless client. Implements the same interface as `ServerConnection` but never touches a WebSocket. Useful when you want an `OsrsClient` without a server.

## `src/network/packet/` — wire format

The packet directory contains the binary codec:

### `PacketBuffer.ts`

A growable byte buffer with OSRS-specific read/write helpers:

- `u8`, `u16`, `u24`, `u32`, `u64`, signed variants.
- `smart` — OSRS's variable-length integer encoding (8-bit or 16-bit depending on MSB).
- `string` — null-terminated string.
- `bytes` — raw byte range.
- `bits` — switch into bit-level mode (used by sync packets that pack into a `BitStream`).

All reads are bounds-checked and throw on underrun — not just for safety but so a codec bug shows up as an immediate exception rather than corruption.

### `ClientPacket.ts`

The discriminated union of all client-outgoing packets. Each variant has a `type` tag from `ClientPacketId` and a payload shape. Used at compile time to keep senders type-safe.

### `ClientBinaryEncoder.ts`

Turns a `ClientPacket` into bytes. Dispatches on the `type` tag to the right encoding routine, writes the opcode byte (or multi-byte), then the payload. Most payloads are a few fields; a few (e.g., `SEND_CHAT`) have variable-length data that uses the `smart` encoder.

### `ServerBinaryDecoder.ts`

The inverse: reads an opcode, looks up the decoder for that `ServerPacketId`, and produces a typed packet object. `ServerConnection` calls this on every inbound frame.

### `PacketWriter.ts`

Utility for constructing a `PacketBuffer` in a streaming way without knowing the final length upfront. Used by the encoder for variable-length payloads.

### `index.ts`

Barrel exports.

## Opcodes

Opcodes are defined once in `src/shared/packets/ClientPacketId.ts` and `src/shared/packets/ServerPacketId.ts` and used by both client and server. This is the single source of truth — change either enum and both sides must recompile.

See [40 — Protocol](../40-protocol/index.md) for a full opcode-by-opcode reference.

## `src/network/combat/`

### `CombatStateStore.ts`

A small client-side cache of combat-related state that needs to survive short disconnects (current combat target, last special attack timestamp). The server is still the authority; this store just avoids visual flicker on reconnect.

## Backpressure

WebSocket backpressure on the client is mostly irrelevant — the server pushes at its tick rate and we can decode faster than that. If a sync packet takes more than ~50 ms to decode, `PerformanceProfiler` flags it. The only real backpressure concern is _initial login_: the server streams map squares and inventory and such in a burst, and a slow connection can take a second or two. That's what the loading bar is for.

## Debugging

A few tools:

- `window.osrsClient.getConnection().enablePacketLog()` — dumps every outbound and inbound packet to the console. Extremely noisy. Use for reproducing a single bug.
- The dev overlay `PacketLogOverlay` (if enabled in `DebugControls.tsx`) renders a scrolling list of the last N packets on the canvas.
- `PerformanceProfiler` frames include a `packetBytes` and `packetCount` field.

---

## Canonical facts

- **Server connection**: `src/network/ServerConnection.ts`.
- **Test shim**: `src/network/ServerConnectionShim.ts`.
- **Combat state store**: `src/network/combat/CombatStateStore.ts`.
- **Packet buffer**: `src/network/packet/PacketBuffer.ts`.
- **Packet writer**: `src/network/packet/PacketWriter.ts`.
- **Typed packet union**: `src/network/packet/ClientPacket.ts`.
- **Outbound encoder**: `src/network/packet/ClientBinaryEncoder.ts`.
- **Inbound decoder**: `src/network/packet/ServerBinaryDecoder.ts`.
- **Opcodes (client → server)**: `src/shared/packets/ClientPacketId.ts`.
- **Opcodes (server → client)**: `src/shared/packets/ServerPacketId.ts`.
- **Reconnection policy**: exponential backoff with grace window; implemented in `ServerConnection.ts`.
- **Global debug handle**: `window.osrsClient.getConnection()`.
