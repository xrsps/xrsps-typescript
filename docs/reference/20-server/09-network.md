# 20.9 — Network layer (`server/src/network/`)

The server's network directory is, in rough terms: accept WebSocket connections, authenticate them, route inbound packets to handlers, and batch outbound packets into per-tick broadcasts. This page walks through the big subsystems and names the files.

## `WSServer` (`server/src/network/wsServer.ts`)

The entry point. Constructed in `server/src/index.ts` and given every service it needs. Responsibilities:

1. Create a `WebSocketServer` on `host:port`.
2. Accept connections and route each through the login handshake.
3. Register a listener on `GameTicker` that runs `TickPhaseOrchestrator.processTick` each tick.
4. On shutdown, close every socket cleanly.

### `wsServerTypes.ts`

Typed interfaces for the WebSocket server parameters, the tick frame, the connected client, etc. Kept separate so things that need the types don't import the full `wsServer.ts`.

## Authentication and login

### `AuthenticationService.ts`

Checks username + password against the account store, enforces lockouts, rejects disallowed names. Called during login.

### `LoginHandshakeService.ts`

The step-by-step handshake: version check, credentials, client capabilities, account load, initial state packets, add player to the world. The output of a successful handshake is a fully-constructed `PlayerState` plugged into `PlayerManager`.

## Routing

### `MessageRouter.ts`

The central inbound dispatcher. For every incoming packet frame:

1. Decode the opcode with `ClientBinaryDecoder`.
2. Look up the registered handler for the opcode.
3. Invoke the handler with the packet payload and player session.

Handlers don't run gameplay logic directly — they queue actions (see [20.2 — Tick system](./02-tick-system.md) and the `actions/` directory). This guarantees all mutations happen inside a tick phase.

### `MessageHandlers.ts`

The registration list. Maps each `ClientPacketId` to a handler function in `handlers/`.

### `handlers/`

Each file handles one or more related packet types:

| File | Packets |
|---|---|
| `movementHandlers.ts` | WALK, RUN toggle, teleport confirmations |
| `interactHandlers.ts` | Clicks on players, NPCs, locs, ground items |
| `chatHandler.ts` | Public chat, commands |
| `dialogHandlers.ts` | Dialog continue / choice |
| `spellHandlers.ts` | Cast spell on target |
| `widgetHandler.ts` | Widget button clicks |
| `ifCloseHandler.ts` | Close interface |
| `examineHandler.ts` | Examine item, NPC, loc |
| `npcHandlers.ts` | NPC-specific actions |
| `logoutHandler.ts` | Logout request |
| `debugHandler.ts` | Debug-only packets |
| `varpTransmitHandler.ts` | Varp transmissions from client (Cs2 writes) |
| `binaryMessageHandlers.ts` | Raw-binary fallthrough for new protocol |

The split is by concern, not by packet id, so adding a new packet usually means picking an existing file and adding a case.

## Per-player network layer

### `PlayerNetworkLayer.ts`

Owns per-player networking state: the WebSocket, the inbound queue, the outbound buffer, the sync session handles. Constructed after login, destroyed on logout.

### `PlayerSyncSession.ts` / `NpcSyncSession.ts`

Per-player encoders that own the incremental state for the player/NPC sync loop. Each tick they produce a bit-packed update payload that describes everything the player needs to know about the world.

### `NpcExternalSync.ts`

Tracks NPCs that are outside the player's immediate sync set but still need to be synced for special cases (pets, quest targets). A smaller list that gets merged into the main NPC sync.

## Broadcast layer (`broadcast/`)

The broadcast layer is the outbound half: it holds per-category broadcast buffers that individual gameplay code can push into during the tick. At broadcast time, they're flushed into the per-player packet buffer.

### `BroadcastDomain.ts`

Defines "domains" — groups of players who should receive a particular broadcast. The default domains:

- `global` — everyone in the world.
- `region(regionX, regionY, plane)` — players in a map region.
- `instance(instanceId)` — players in an instance.
- `self(playerId)` — just one player.

### Broadcasters

| File | Purpose |
|---|---|
| `ActorSyncBroadcaster.ts` | Player + NPC sync packets |
| `ChatBroadcaster.ts` | Chat to nearby / whole world |
| `CombatBroadcaster.ts` | Hitsplats, damage events |
| `InventoryBroadcaster.ts` | Inventory updates |
| `SkillBroadcaster.ts` | Skill level / XP updates |
| `VarBroadcaster.ts` | Varp and varbit updates |
| `WidgetBroadcaster.ts` | Widget open/close/updates |
| `MiscBroadcaster.ts` | Sound effects, music, camera effects, run energy, etc. |

Each broadcaster exposes a `push(...)` method used by gameplay code and a `flush(tickFrame)` method called by the broadcast phase.

### `BroadcastService.ts`

A thin registry that the services point to. Code that needs to emit a broadcast calls `services.broadcastService.pushChat(...)` and doesn't need to know about the domain or per-player buffers.

## Encoding

### `encoding/`

Pure functions that write specific packet types into a `ServerPacketBuffer`.

- **`PlayerPacketEncoder.ts`** — player sync packet.
- **`NpcPacketEncoder.ts`** — NPC sync packet.
- **`AppearanceEncoder.ts`** — player appearance block.
- **`WorldEntityInfoEncoder.ts`** — world entity info (boats, vehicles).
- **`Cp1252.ts`** — OSRS uses CP-1252 for strings; this is the encoder.
- **`constants.ts`** — encoding constants.
- **`types.ts`** — encoder type glue.
- **`index.ts`** — barrel.

### `BitWriter.ts`

The bit-level writer counterpart to the client's `BitStream`. Used by the sync encoders.

## Low-level packet layer (`packet/`)

- **`ClientBinaryDecoder.ts`** — decodes inbound packets. Mirror of `src/network/packet/ClientBinaryEncoder.ts` on the client.
- **`ServerBinaryEncoder.ts`** — encodes outbound packets. Mirror of `src/network/packet/ServerBinaryDecoder.ts`.
- **`ServerPacketBuffer.ts`** — growable byte buffer for outbound packets.
- **`BinaryProtocol.ts`** — protocol constants (handshake magic, max message size).
- **`BinaryBridge.ts`** — bridge between the WebSocket frame level and the packet level.
- **`PacketHandler.ts`** — the interface handler implementations follow.
- **`index.ts`** — barrel.

## Managers (`managers/`)

Cross-cutting per-player state that didn't fit in a single handler:

- **`Cs2ModalManager.ts`** — tracks which CS2 modal is open per player.
- **`GroundItemHandler.ts`** — ground item visibility tracking per player.
- **`NpcSyncManager.ts`** — per-player NPC visibility set.
- **`PlayerAppearanceManager.ts`** — appearance cache and dirty tracking.
- **`SoundManager.ts`** — per-player sound batching.

## Utilities

- **`accountSummary.ts`** / **`AccountSummaryTime.ts`** — short-lived account summary used by the client login overview.
- **`anim/`** — animation helpers (walk/run/stand anim selection).
- **`levelUpDisplay.ts`** — queues level-up visuals.
- **`reportGameTime.ts`** — sends server clock to client.
- **`messages.ts`** — typed shapes for outbound messages.
- **`ServiceWiring.ts`** — the boot-time service construction script.

---

## Canonical facts

- **WebSocket server**: `server/src/network/wsServer.ts`.
- **Server types**: `server/src/network/wsServerTypes.ts`.
- **Authentication**: `server/src/network/AuthenticationService.ts`.
- **Login handshake**: `server/src/network/LoginHandshakeService.ts`.
- **Message router**: `server/src/network/MessageRouter.ts`.
- **Handler registry**: `server/src/network/MessageHandlers.ts`.
- **Handlers directory**: `server/src/network/handlers/`.
- **Broadcast layer**: `server/src/network/broadcast/`.
- **Encoding**: `server/src/network/encoding/`.
- **Packet layer**: `server/src/network/packet/`.
- **Bit writer**: `server/src/network/BitWriter.ts`.
- **Per-player net layer**: `server/src/network/PlayerNetworkLayer.ts`.
- **Player sync session**: `server/src/network/PlayerSyncSession.ts`.
- **NPC sync session**: `server/src/network/NpcSyncSession.ts`.
- **Service wiring**: `server/src/network/ServiceWiring.ts`.
- **Opcodes**: `src/shared/packets/ClientPacketId.ts` and `src/shared/packets/ServerPacketId.ts`.
- **Rule**: inbound handlers queue actions; they do not mutate state directly.
- **Rule**: outbound broadcasts are pushed during the tick and flushed in the broadcast phase.
