# Agent Endpoint (`BotSdkServer`)

The xRSPS server exposes a second WebSocket endpoint for autonomous
agent clients, separate from the binary human-client protocol on
`ws://0.0.0.0:43594`. This endpoint is what the `@elizaos/app-scape`
milady plugin connects to when an operator launches `'scape` from the
milady apps grid.

Agents spawned through this endpoint are **first-class players in the
xRSPS world**. They use the same scrypt-authenticated accounts, the
same persistence layer, the same tick loop, the same combat rules,
and the same save file format as human players. The only difference
is the I/O channel.

## When to enable it

Enable it whenever you want autonomous agents (human-drivable or
LLM-driven) playing in the world alongside real players. The
endpoint is **disabled by default** — without a `BOT_SDK_TOKEN` the
server refuses to start it, so a casual deployment that doesn't
know or care about agents never exposes an extra attack surface.

## Configuration

Four environment variables, all override `server/config.json`:

| Env var                         | Default              | Purpose                                                                                               |
|---------------------------------|----------------------|-------------------------------------------------------------------------------------------------------|
| `BOT_SDK_TOKEN`                 | *(unset = disabled)* | Shared secret. Agents send this in their first frame; mismatches get disconnected with `bad_token`. |
| `BOT_SDK_HOST`                  | `127.0.0.1`          | Bind address. Default is localhost-only; override for remote agent hosts.                           |
| `BOT_SDK_PORT`                  | `43595`              | TCP port.                                                                                             |
| `BOT_SDK_PERCEPTION_EVERY_N_TICKS` | `3`               | How often the perception emitter pushes a TOON snapshot to each connected agent.                    |

Example `server/config.json` snippet for a private, LAN-only deployment
where you run milady on the same box:

```json
{
  "serverName": "Local Development",
  "maxPlayers": 2047,
  "gamemode": "vanilla",
  "allowedOrigins": ["http://localhost:3000"],
  "botSdkHost": "127.0.0.1",
  "botSdkPort": 43595
}
```

And the matching env var to actually enable it:

```bash
export BOT_SDK_TOKEN=dev-secret
bun run server:start
```

## Protocol summary

The endpoint speaks **TOON** (Token-Oriented Object Notation,
`@toon-format/toon`), not JSON. The full frame reference lives in
`server/src/network/botsdk/BotSdkProtocol.ts`. At a high level:

**Client → server:**
- `auth` — shared-secret handshake, always sent first
- `spawn` — logs the agent into the world via the
  `AccountStore` + `PlayerPersistence` layer (scrypt verify + save
  restore, same as a human login)
- `action` — one of: `walkTo`, `chatPublic`, `attackNpc`, `dropItem`,
  `eatFood` (more land in later PRs)
- `disconnect` — graceful shutdown, triggers disconnect-save

**Server → client:**
- `authOk` / `error` — response to `auth`
- `spawnOk` — agent is in the world, here's the player id + position
- `ack` — response to an `action` that carried a `correlationId`
- `perception` — the agent's current view of the world (self, skills,
  inventory, equipment, nearby NPCs/players/objects, recent events)
- `operatorCommand` — pushed by the server when a human types
  `::steer <text>` in public chat; the plugin injects it into the
  next LLM prompt

## Why TOON and not JSON?

Agents read TOON-encoded state as LLM prompt context and emit
TOON-encoded actions. For the kinds of data the agent loop moves
around — inventory rows, nearby-NPC tables, recent-event lists — TOON
uses roughly 40-60% fewer tokens than the equivalent JSON. At ~4 steps
per minute over long sessions, that's a significant cost reduction,
and it also simplifies LLM output parsing (the model emits TOON more
reliably than JSON-with-escaping).

## Agent as first-class citizen

The agent layer is implemented as a non-invasive **component** hung
off `PlayerState`:

```ts
// server/src/game/player.ts (partial)
export class PlayerState extends Actor {
    // … unchanged fields …
    agent?: import("../agent").AgentComponent;
}
```

Existing services (`MovementService`, `CombatService`, `InventoryService`,
`PlayerPersistence`) work on any `PlayerState` regardless of whether
`.agent` is set. Agent-aware services read the component only when
present:

- `BotSdkPerceptionBuilder` builds the perception snapshot that the
  agent sees.
- `BotSdkPerceptionEmitter` pushes that snapshot down the wire every
  N ticks.
- `BotSdkActionRouter` turns incoming action frames into calls into
  the normal service layer — no duplicated logic, no gameplay code
  lives in the bot-SDK.

This is the first step toward making xRSPS an ECS-for-agents. The
refactor can grow the component set over time without touching the
existing OO service code; human players remain entirely unaffected.

## In-game steering (`::steer`)

Any logged-in human player can issue an operator directive to
every connected agent by typing:

```
::steer mine copper ore in varrock
```

The chat handler routes it through `services.broadcastOperatorCommand`
→ `BotSdkServer.broadcastOperatorCommand` → every connected agent's
WebSocket as an `operatorCommand` TOON frame. The agent's plugin-side
game service receives it via `onOperatorCommand`, calls
`setOperatorGoal(text)`, and the next LLM step injects it into the
prompt as a highest-priority directive.

The server replies to the sender with either:
- `Steered N agents.` — success, N agents received the directive
- `No connected 'scape agents to steer.` — no agents currently online

## Security

The agent endpoint has a smaller attack surface than the human
endpoint but is not zero. The safeguards:

1. **Shared-secret token.** Unauthenticated agents can't connect;
   mismatched tokens get disconnected immediately with `bad_token`.
2. **Bind host.** Default `127.0.0.1` keeps the endpoint
   localhost-only. Only override when running milady on a different
   machine.
3. **Account auth.** Every spawn frame runs through the normal
   `AccountStore.verifyOrRegister` path with scrypt. Stealing a
   `BOT_SDK_TOKEN` still doesn't let you log in as an existing
   account without the password.
4. **Disconnect cleanup.** Sessions are reaped on disconnect via
   `AgentPlayerFactory.destroy`, freeing the display name and player
   id immediately so there's no "ghost bot" state.

See `docs/deployment.md` for public-deployment guidance.
