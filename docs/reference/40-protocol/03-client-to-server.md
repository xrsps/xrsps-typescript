# 40.3 — Client → server packets

This page catalogs every `ClientPacketId`. For each one it lists the opcode number, the length encoding (fixed N / `u8`-prefixed / `u16`-prefixed), the payload shape, and the server handler that receives it.

The authoritative source is `src/shared/packets/ClientPacketId.ts`. The dispatch table that hands packets to handlers is `server/src/network/MessageRouter.ts`, which routes through the subsystem handler files listed in each entry.

Notation:
- **`fixed N`** — no size byte; payload is exactly N bytes.
- **`u8 size`** — one size byte followed by the payload (up to 255 bytes).
- **`u16 size`** — two size bytes followed by the payload (up to 65535 bytes).
- **`—`** — zero-length payload.

## Core protocol (200-209)

### `HELLO` (200) — `u8 size`

Sent once right after the WebSocket opens, before login. Carries a client identification string and feature flags. The server responds with a welcome frame (`SERVER_WELCOME`) carrying `tickMs` and server time so the client can align its local clock.

Handler: `LoginHandshakeService` via `WSServer`.

### `PING` (201) — `fixed 4`

Payload: `u32 time` — the client's monotonic clock in ms.

Sent every few seconds once the connection is in the `IN_GAME` state. The server replies with a `TICK` packet (server tick + server time). The client uses the round-trip to compute latency and detect a server tick rewind.

Handler: `MessageRouter` replies inline without touching subsystem handlers.

### `HANDSHAKE` (202) — `u8 size`

Extended feature negotiation (for example, "supports binary sync"). Currently carries a feature-flag bitfield. Not all deployments need it — the login handshake covers the base case.

Handler: `LoginHandshakeService`.

### `LOGOUT` (203) — `—`

Zero-length. Sent when the user clicks the Logout button. The server flushes pending broadcasts, runs a final save through `PlayerPersistence.save`, removes the player from `PlayerManager`, and closes the socket.

Handler: `logoutHandler.ts`.

### `LOGIN` (204) — `u16 size`

Payload:
- `cstring username`
- `cstring password`
- `u32 client version`
- `u16 client capabilities`

Processed by `LoginHandshakeService.handle`:
1. Validate client version.
2. Look up the account via `AuthenticationService` (which defers to `AccountStore`).
3. If authentication fails, send `SERVER_LOGIN_RESPONSE` with the failure reason and close the socket.
4. If it succeeds, load the account through `PlayerPersistence.load`, construct a fresh `PlayerState`, add it to `PlayerManager`, and send `SERVER_LOGIN_RESPONSE` (success) with the player id and login coordinates.
5. Queue initial inventory, bank, skills, widgets, varps.

See [40.1 — Connection lifecycle](./01-connection-lifecycle.md) for the full step-by-step.

## Movement (210-219)

### `WALK` (210) — `fixed 5`

Payload: `u16 x`, `u16 y`, `u8 modifierFlags`.

Sent when the user minimap-walks or ground-clicks. `movementHandlers.ts` passes the target to `MovementService.walkTo(player, x, y)`, which calls the pathfinder and updates `PlayerMovementState`.

Modifier flags are the bitfield from `src/shared/input/modifierFlags.ts` — shift-click is the one the server currently branches on (it enables run-once for the subsequent step).

Rate limit: once per tick. More frequent clicks are coalesced (the server keeps the latest).

### `FACE` (211) — `u8 size`

Payload: a facing target — either a world tile (`u16 x, u16 y`) or an entity reference (`u32 encoded`). The server sets `player.facingEntity` or `player.facingTile` for the next sync.

Handler: `movementHandlers.ts`.

### `TELEPORT` (212) — `fixed 5`

Payload: `u16 x`, `u16 y`, `u8 plane`.

Admin / debug only. The server checks the player's permission level before honoring it. Normal gameplay teleports come from scripts on the server and are not requested by the client.

Handler: `debugHandler.ts`.

### `PATHFIND` (213) — `u8 size`

Variant of `WALK` that asks the server to compute and stream back a preview path without committing to it. Used by some client overlays. Response is `SERVER_PATH_RESPONSE`.

Handler: `movementHandlers.ts`.

## Combat (220-229)

### `NPC_ATTACK` (220) — `fixed 2`

Payload: `u16 npcIndex`.

Sent when the user clicks "Attack" on an NPC. `interactHandlers.ts` turns it into a `CombatEngagementRegistry.engage(player, npc)` call, which the combat state machine picks up on the next combat phase.

Widget-target spell casts (cast Fire Strike on a goblin, for instance) do **not** use this packet — they use the lower-level OSRS spell action packets.

## Interaction (230-239)

### `NPC_INTERACT` (230) — `u8 size`

Payload: `u16 npcIndex`, `u8 actionIndex`, optional extra args.

Talk-to, trade, pickpocket — any non-attack NPC interaction. `interactHandlers.ts` resolves the NPC, looks up its op definitions, and hands off to `ScriptRegistry` for a matching `registerNpcInteraction` handler.

### `LOC_INTERACT` (231) — `u8 size`

Payload: `u16 x`, `u16 y`, `u8 plane`, `u16 locId`, `u8 actionIndex`.

Examine a tree, open a door, climb stairs. The world coordinate + loc id + action index are resolved through `LocTileLookupService` and then a script handler registered with `registerLocInteraction`.

### `GROUND_ITEM_ACTION` (232) — `u8 size`

Payload: `u16 x`, `u16 y`, `u8 plane`, `u16 itemId`, `u8 actionIndex`.

Pick up, examine, or drop a ground item. Backed by `GroundItemHandler` (`server/src/network/managers/GroundItemHandler.ts`).

### `INTERACT` (233) — `u8 size`

Generic "default action on target" — used by right-click menu items that don't fit the more specific opcodes above. Payload is a `u32` target encoding + `u8 actionIndex`. The handler demultiplexes on target kind.

### `INTERACT_STOP` (234) — `—`

Zero-length. Clears the player's current pending interaction without moving or attacking. Used when the user clicks a blank tile after queueing an action they didn't want.

Handler: `interactHandlers.ts`.

## Inventory (240-249)

### `INVENTORY_USE` (240) — `u8 size`

Payload: `u16 slot`, `u16 itemId`, `u8 actionIndex`.

"Eat", "drop", "wield", "wear", "bury", "clean" — any single-slot inventory action. The handler looks up the item op table and dispatches to a script or a built-in effect (`server/src/data/items.ts`, `locEffects.ts`).

### `INVENTORY_USE_ON` (241) — `u8 size`

Use slot X on slot Y. Payload: `u16 srcSlot`, `u16 srcItem`, `u16 dstSlot`, `u16 dstItem`.

Matched against `registerItemOnItem` handlers in `ScriptRegistry`.

### `INVENTORY_MOVE` (242) — `fixed 4`

Payload: `u16 fromSlot`, `u16 toSlot`.

Drag-drop inside the inventory. Pure client-side rearrangement with server acknowledgment for anti-cheat reasons — the server mirrors the swap in `PlayerInventory`.

### `BANK_DEPOSIT_INVENTORY` (243) — `—`

"Deposit all" button. The server transfers everything in the player's inventory into the bank, stacking where possible.

### `BANK_DEPOSIT_EQUIPMENT` (244) — `—`

"Deposit equipment" button. Same, for the worn equipment slots.

### `BANK_MOVE` (245) — `u8 size`

Drag-drop inside the bank. Payload: `u16 fromTab`, `u16 fromSlot`, `u16 toTab`, `u16 toSlot`.

### `ITEM_SPAWNER_SEARCH` (246) — `u8 size`

Payload: `cstring query`.

Extrascript-only: the item-spawner extrascript's search box sends a query string and the server streams back matching items via a custom widget update.

Handler: `extrascripts/item-spawner/` (see [20.11 — Gamemode loader](../20-server/11-gamemode-loader.md)).

## Widgets / UI (250-254)

### `WIDGET` (250) — `u8 size`

Generic widget message — used for custom-widget round-trips. Payload is `u32 widgetUid` followed by widget-defined bytes. The server dispatches on widget UID to a handler registered through `CustomWidgetRegistry`.

### `WIDGET_ACTION` (251) — `u8 size`

User clicked an interactive element inside a widget. Payload: `u32 widgetUid`, `u8 actionIndex`, optional extra args (quantity, item id, etc.). Handler: `widgetHandler.ts`, which dispatches into `ScriptRegistry.registerWidgetInteraction` handlers.

### `RESUME_PAUSEBUTTON` (252) — `fixed 6`

Payload: `u32 widgetUid`, `u16 childIndex`.

Signals that the user clicked "continue" on a paused dialogue. Resumes the suspended script coroutine.

Handler: `dialogHandlers.ts`.

### `IF_BUTTOND` (253) — `fixed 16`

Payload: `u32 srcUid, u16 srcSlot, u16 srcItem, u32 dstUid, u16 dstSlot, u16 dstItem`.

OSRS-style "use X on Y" for interfaces that aren't regular inventory — used for things like withdrawing from the bank onto a shop slot.

Handler: `widgetHandler.ts` (delegates to `Cs2ModalManager` in some cases).

### `EMOTE` (254) — `fixed 3`

Payload: `u16 emoteIndex`, `u8 loop`.

Play an emote animation. The server validates that the emote is unlocked and broadcasts an animation through `PlayerAppearanceManager`.

## Chat / varps (190-199)

### `CHAT` (190) — `u8 size`

Payload:
- `u8 kind` — public, private, clan.
- `cstring recipient` (only for private/clan).
- `cstring message` (CP-1252).

Handler: `chatHandler.ts`. Commands that start with `::` (or whatever the configured prefix is) are routed through `ScriptRegistry.registerChatCommand` rather than being broadcast as regular chat.

### `VARP_TRANSMIT` (191) — `fixed 6`

Payload: `u16 varpId`, `i32 value`.

A CS2 script wrote to a transmit-to-server varp. The server validates the varp is in the allow list, updates `PlayerVarPlayerState`, and broadcasts the authoritative value back (so other subsystems can react).

Handler: `varpTransmitHandler.ts`.

### `RESUME_COUNTDIALOG` (192) — `fixed 4`

Payload: `i32 value`.

User entered a number into a count dialog (e.g. "How many to withdraw?"). Resumes the suspended script.

### `RESUME_NAMEDIALOG` (193) — `u8 size`

Payload: `cstring name`. User entered a player name (trade target, friends list).

### `RESUME_STRINGDIALOG` (194) — `u8 size`

Payload: `cstring value`. User entered a free-form string (set password, clan name).

### `MAP_EDIT` (195) — `u8 size`

Admin/debug only: `u8 action, u32 tile, ...`. Lets an operator place or remove locs at runtime without restarting the server. Gated behind a permission check.

Handler: `debugHandler.ts`.

## Trade (180-189)

### `TRADE_ACTION` (180) — `u8 size`

Payload: `u8 action` + action-specific payload. Actions are:

- `REQUEST` — request a trade with a nearby player.
- `ACCEPT` — accept an incoming request.
- `DECLINE` — decline.
- `OFFER` — add an item to the offer table.
- `REVOKE` — remove an item.
- `CONFIRM_FIRST_SCREEN` — click through to the confirmation screen.
- `CONFIRM_SECOND_SCREEN` — finalize.
- `CANCEL` — back out.

Each sub-action carries its own payload (slot / itemId / quantity for OFFER, etc.).

Handler: `server/src/game/trade/TradeHandlers.ts`, routed through the binary message handlers.

## Debug (255)

### `DEBUG` (255) — `u16 size`

Free-form debug channel. Payload: `u8 kind` + arbitrary bytes. Used by dev tools and profiling overlays to ship state to the server out-of-band. Ignored in production builds.

Handler: `debugHandler.ts`.

---

## Canonical facts

- **Source of truth**: `src/shared/packets/ClientPacketId.ts`.
- **Length table**: `CLIENT_PACKET_LENGTHS` in the same file.
- **Router**: `server/src/network/MessageRouter.ts`.
- **Subsystem handlers**: `server/src/network/handlers/` (`movementHandlers.ts`, `interactHandlers.ts`, `chatHandler.ts`, `dialogHandlers.ts`, `spellHandlers.ts`, `widgetHandler.ts`, `ifCloseHandler.ts`, `examineHandler.ts`, `npcHandlers.ts`, `logoutHandler.ts`, `debugHandler.ts`, `varpTransmitHandler.ts`, `binaryMessageHandlers.ts`).
- **Login**: `server/src/network/LoginHandshakeService.ts`.
- **Ground items**: `server/src/network/managers/GroundItemHandler.ts`.
- **Trade actions**: `server/src/game/trade/TradeHandlers.ts`.
- **Rule**: every opcode in the enum has a row in the length table — TypeScript's `Record<ClientPacketId, number>` enforces it.
