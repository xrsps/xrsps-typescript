# 40.1 — Connection lifecycle

From "the user opens the page" to "their character is walking around in the world", the client goes through several discrete steps. This page is the sequence diagram.

## 1. Page load

The client HTML loads, `src/index.tsx` runs, WASM decompressors initialize, React mounts `OsrsClientApp`. The client at this point has no server connection — it's downloading the OSRS cache from HTTP into IndexedDB if needed.

## 2. Connect

`OsrsClient` is constructed. It immediately opens a `WebSocket` to `wss://<host>:<port>/ws` (or `ws://` for local dev). The URL comes from the build config.

Connection states tracked client-side:

- `DISCONNECTED` — initial state.
- `CONNECTING` — `WebSocket` is being opened.
- `CONNECTED` — socket is open, but not yet logged in.
- `AUTHENTICATED` — login handshake completed.
- `IN_GAME` — first world state has arrived.
- `RECONNECTING` — socket dropped, retrying.

## 3. Login handshake

Once `CONNECTED`, the client enters `GameState.LOGIN` (see [10.8](../10-client/08-login.md)). The user enters a username and password and clicks Login. The client builds a `LOGIN` packet:

```
[opcode: u8 = CLIENT_LOGIN]
[payload size: u16]
[username: cstring]
[password: cstring]
[client version: u32]
[client capabilities: u16]   // flags like "supports binary sync"
```

…and sends it.

Server side:

1. `WSServer` routes the frame through `ClientBinaryDecoder`.
2. Decoder resolves it to a `LOGIN` packet.
3. `LoginHandshakeService.handle(session, packet)`:
   - Validates client version.
   - Authenticates via `AuthenticationService`.
   - On failure, sends `SERVER_LOGIN_FAILED` with a reason code and closes the socket.
   - On success, loads the account via `PlayerPersistence.load(username)`.
   - Constructs `PlayerState`, adds to `PlayerManager`.
   - Sends `SERVER_LOGIN_OK` with the player id, initial player position, and a timestamp.
   - Queues initial state packets (inventory, bank, skills, prayers, widgets, varps).

## 4. Initial world sync

On the first tick after login:

1. The broadcast phase gathers the initial state packets into the player's outbound buffer.
2. A player sync packet is generated containing the local player at their login position, no remote players yet.
3. An NPC sync packet with the initial NPC view.
4. Map square metadata telling the client which regions to start loading.

The client decodes these, instantiates a scene, and transitions to `GameState.IN_GAME`.

## 5. In-game loop

Per server tick (600 ms), the server sends:

- Player sync (one packet with everybody within view).
- NPC sync (similar).
- Zero or more "delta" packets: inventory updates, skill updates, widget changes, varp changes, chat, sound effects, hits, damage, music, camera effects.
- Ground item updates (only if something changed).
- Projectile launches (if any).

The client sends whenever the user does something:

- Walk clicks → `WALK` packet with the target tile and modifier flags.
- Menu actions → `MENU_ACTION` with the resolved target.
- Chat → `CHAT_PUBLIC` / `CHAT_PRIVATE` / `CHAT_COMMAND`.
- Widget button clicks → `WIDGET_ACTION`.
- Interface close → `IF_CLOSE`.
- Varp transmissions (from CS2) → `VARP_TRANSMIT`.
- Logout request → `LOGOUT_REQUEST`.
- Ping → `PING` (server replies with `PONG`).

Inbound packets on the server are handled in the `pre_movement` phase. See [20.2 — Tick system](../20-server/02-tick-system.md).

## 6. Disconnect

Two flavors:

### Clean disconnect

Player clicks logout or closes the tab. Client sends `LOGOUT_REQUEST`. Server:

1. Flushes any pending broadcasts.
2. Runs a final save through `PlayerPersistence.save`.
3. Removes the player from `PlayerManager`.
4. Closes the WebSocket.

### Unclean disconnect

Network failure, server restart, or the user's tab dies. Server notices the socket closed and:

1. If the player is not in combat, removes them immediately with a final save.
2. If in combat, marks them orphaned (see [20.4 — Player state](../20-server/04-player-state.md)) and keeps their entity in the world for the orphan grace period.

Client side, if the socket dropped unexpectedly, it enters `RECONNECTING` with exponential backoff. If reconnect succeeds within a short window, the server still has the session and the client skips straight back to `IN_GAME`. After the window, the session is gone and the client returns to `LOGIN`.

## 7. Server-initiated disconnect

The server can send a `KICK` or `SHUTDOWN` packet to disconnect a client for cause:

- **`KICK`** — reason code and optional message. Client displays the reason and returns to login.
- **`SHUTDOWN`** — server is shutting down; client displays a "server restarting" message and enters reconnect backoff.

## 8. Reconnect and session resume

The server keeps an ephemeral session map for a short window after an unclean disconnect. If a new connection arrives with valid credentials and the same session token, the server reattaches the existing `PlayerState` and WebSocket instead of creating new ones.

Resume is best-effort: if the session map has expired or been evicted, the client falls back to a full login.

## Ping / pong

The client sends a `PING` every few seconds once `IN_GAME`. The server immediately replies with `PONG` carrying the server's current tick and time. The client uses this for:

- Keeping NAT / intermediate connections alive.
- Measuring round-trip latency (displayed in the dev overlay).
- Detecting that the server has restarted (tick number moved backward).

## Error handling

- **Malformed packet:** server logs and closes the connection. No attempt is made to recover.
- **Unknown opcode:** same.
- **Oversized frame:** rejected at the WebSocket layer with a close code.
- **Client sends a packet during login:** ignored until handshake completes.
- **Server sends a packet the client doesn't know:** logged, packet dropped, connection remains open.

## Rate limiting

Per-connection inbound rate limiting happens at the message router level. If a client floods packets, the router applies per-opcode throttles. Exceeding them results in a `KICK`. The defaults are generous enough for normal play but stop obvious flood attacks.

---

## Canonical facts

- **WebSocket endpoint**: `wss://<host>:<port>/ws` (or `ws://` for dev).
- **Handshake packet**: `CLIENT_LOGIN` (client), `SERVER_LOGIN_OK` / `SERVER_LOGIN_FAILED` (server).
- **Ping cadence**: every few seconds from the client.
- **Session resume window**: short (seconds); after that, full re-login is required.
- **Orphan grace period**: server holds the player in-world during combat disconnects; removal happens in the `orphaned_players` tick phase.
- **Rule**: protocol is 1-to-1 versioned with the git commit; no mixed versions.
