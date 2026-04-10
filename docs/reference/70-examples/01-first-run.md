# 70.1 — Running locally for the first time

From zero to a walking character in 10 minutes.

## Prerequisites

- A Unix-like shell (macOS, Linux, or WSL on Windows).
- Git.
- Bun installed: `curl -fsSL https://bun.sh/install | bash`.

## Clone and install

```sh
git clone https://github.com/xrsps/xrsps-typescript.git
cd xrsps-typescript
bun install
```

The install fetches all JS dependencies for both the client and the server. Ignore any peer-dep warnings — they're from `react-scripts` and won't affect the build.

## Start the dev loop

```sh
bun run dev
```

This invokes `mprocs` and brings up three tabs:

1. **server** — compiling and running the game server. On first run it downloads the OSRS cache (~300-500 MB download, ~1 GB extracted). This takes a minute or two. You'll see:

   ```
   [CacheDownloader] Downloading archive ...
   [CacheDownloader] Extracting to caches/osrs-237_2026-03-25 ...
   [boot] loaded gamemode: vanilla
   [boot] listening on ws://127.0.0.1:43594
   ```

2. **client** — running the React dev server via craco. You'll see the usual `Compiled successfully!` message and `webpack compiled with 0 errors`.

3. **agent-dev** — a bot that connects to the bot-SDK and starts random-walking. You'll see it log in and emit walk commands.

## Open the client

Visit `http://localhost:3000`. You'll see the XRSPS login screen.

## Create an account

Type any username and password. The default `JsonAccountStore` creates the account on first login (no separate registration flow). The password must be at least `minPasswordLength` characters (default 6).

Click **Login**. The screen transitions through:

1. "Connecting..." — WebSocket handshake.
2. "Logging in..." — auth flow.
3. "Loading world..." — initial world sync + region download.
4. A view of your character standing in Lumbridge (the default vanilla spawn, `(3222, 3218, level 0)`).

## Walk around

Left-click any tile to walk there. Right-click an NPC for options. Left-click the minimap to pathfind. Click the chat input and type `::help` to see any registered commands (extrascripts may add more).

## What you just saw

Under the hood:

- Your click generated a `CLIENT_WALK` packet (opcode 210 — see [40.3](../40-protocol/03-client-to-server.md)).
- The server's `movementHandlers.ts` received it, validated the target, and queued a path via `MovementService.walkTo`.
- The next tick, the movement phase advanced your player one step. The broadcast phase generated a `PLAYER_SYNC` packet (opcode 20 — see [40.5](../40-protocol/05-sync-bitstreams.md)) containing your new position.
- The client's `PlayerSyncManager` decoded the packet and updated your character's interpolation target.
- The render loop interpolated your character's position between ticks and drew the result.

All in 600 ms (one tick).

## Stop the dev loop

Focus the mprocs terminal, press `Ctrl-A q`. All three procs shut down cleanly. The server runs a final autosave through `PlayerPersistence.save` for your account before exiting.

Your account is now in `server/data/accounts.json`. Next time you log in, your state (position, inventory, skills) persists.

## What next

- [70.2 — Add an NPC interaction](./02-add-npc.md) — make an NPC say something when you talk to them.
- [70.3 — Add a chat command](./03-chat-command.md) — add a `::give` command.
- [60.1 — Local development](../60-build-run-deploy/01-local-dev.md) — more detail on the dev loop.
