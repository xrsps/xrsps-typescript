# 40.4 — Server → client packets

This page catalogs every `ServerPacketId`. For each one it lists the opcode, the length encoding, the payload shape, and the subsystem that emits it.

The source of truth is `src/shared/packets/ServerPacketId.ts`. Encoders are in `server/src/network/packet/ServerBinaryEncoder.ts` and the subsystem broadcasters under `server/src/network/broadcasters/`. The client side decodes them in `src/network/packet/ServerBinaryDecoder.ts` and dispatches into the subscription system in `ServerConnection`.

## Core protocol (0-5)

### `WELCOME` (0) — `fixed 8`

Payload: `u32 tickMs`, `u32 serverTime`.

First message sent after the socket opens. Tells the client the server's tick length (default 600 ms, see [20.2](../20-server/02-tick-system.md)) and the server's wall clock so the client can compute an initial clock skew.

### `TICK` (1) — `fixed 8`

Payload: `u32 tick`, `u32 serverTime`.

Sent once per tick (also used as the pong reply). The client uses the tick number to detect rewinds (server restart) and the server time for latency.

### `HANDSHAKE` (2) — `u8 size`

Reply to `CLIENT_HANDSHAKE`. Mirrors feature flags so both sides agree.

### `LOGIN_RESPONSE` (3) — `u8 size`

Payload:
- `u8 status` — OK, INVALID_CREDENTIALS, ALREADY_LOGGED_IN, WORLD_FULL, CLIENT_OUT_OF_DATE, BANNED, SERVER_ERROR.
- On success: `u32 playerId`, `u16 x`, `u16 y`, `u8 plane`, `u8 permissionLevel`, plus an account summary blob (see `src/shared/ui/accountSummary.ts`).
- On failure: `cstring reason` and the socket is closed right after.

Emitted from `LoginHandshakeService`.

### `LOGOUT_RESPONSE` (4) — `u8 size`

Tells the client the logout has been accepted and the socket is about to close. Usually just a status byte and an optional message.

### `PATH_RESPONSE` (5) — `u8 size`

Reply to `CLIENT_PATHFIND`. Carries a list of `(dx, dy)` steps for an overlay, not a committed path.

## Player / NPC sync (20-39)

### `PLAYER_SYNC` (20) — `u16 size`

The big one. Bit-packed update of every player in the local view — movement bits, appearance blocks, chat, spot-anims, hit events. See [40.5 — Sync bitstreams](./05-sync-bitstreams.md) for the full layout. Encoded by `PlayerPacketEncoder.ts`.

### `NPC_INFO` (21) — `u16 size`

NPC equivalent of `PLAYER_SYNC`. Encoded by `NpcPacketEncoder.ts`.

### `ANIM` (22) — `fixed 22`

Payload: 11 × `u16` — one animation id per extended animation slot. Used by `PlayerAppearanceManager` for rich per-slot animations the sync packet can't hold.

## Varps / varbits (40-43)

### `VARP_SMALL` (40) — `fixed 3`

Payload: `u16 varpId`, `u8 value`. For values that fit in a byte.

### `VARP_LARGE` (41) — `fixed 6`

Payload: `u16 varpId`, `i32 value`. For everything else.

### `VARBIT` (42) — `fixed 6`

Payload: `u16 varbitId`, `i32 value`.

### `VARP_BATCH` (43) — `u8 size`

Multiple varps in a single packet — format is a `u8 count` followed by `count × (u16 varpId + i32 value)`. Emitted at login to catch the client up in one shot.

Broadcaster: `VarBroadcaster.ts`.

## Inventory / items (50-55)

### `INVENTORY_SNAPSHOT` (50) — `u16 size`

Full contents of an inventory-shaped container: `u32 containerUid`, `u16 slotCount`, then `slotCount × (u16 itemId + variable quantity)`. Quantity is encoded OSRS-style — one byte for 0-254, and a `0xFF + i32` escape for anything larger.

Emitted once on login and whenever the client (re)opens an interface that refers to the container.

### `INVENTORY_SLOT` (51) — `u8 size`

Single-slot delta. `u32 containerUid`, `u16 slot`, `u16 itemId`, variable quantity.

### `BANK_SNAPSHOT` (52) — `u16 size`

Full bank contents. Similar to inventory snapshot, with tab metadata.

### `BANK_SLOT` (53) — `u8 size`

Single bank slot delta.

### `GROUND_ITEMS` (54) — `u16 size`

Full snapshot of ground items in a region. Payload: `u16 regionId`, `u16 count`, then `count × (u16 itemId, i32 quantity, u8 localX, u8 localY, u8 plane, u8 visibility)`.

### `GROUND_ITEMS_DELTA` (55) — `u16 size`

Diff of ground items: added, removed, updated quantities. Sent whenever the ground state in a loaded region changes.

Broadcaster: `InventoryBroadcaster.ts`.

## Skills (70-71)

### `SKILLS_SNAPSHOT` (70) — `u8 size`

All 23 skills in one packet: per skill, `u8 level`, `u32 xp`, `u8 boostedLevel`. Sent on login.

### `SKILLS_DELTA` (71) — `u8 size`

Changed skills only. `u8 count` + `count × (u8 skillId, u8 level, u32 xp, u8 boostedLevel)`.

Broadcaster: `SkillBroadcaster.ts`.

## Combat / effects (80-87)

### `COMBAT_STATE` (80) — `u8 size`

Payload: `u32 targetUid`, `u8 engagementFlags`, `i32 targetHp`, `i32 targetMaxHp`, `u8 combatStyle`. Tells the client who the player is fighting, for HUD purposes.

### `RUN_ENERGY` (81) — `fixed 2`

Payload: `u8 percent`, `u8 running`. Percent is 0–100; `running` is 0/1.

### `HITSPLAT` (82) — `u8 size`

One or more hitsplats to render: `u32 targetUid`, `u8 count`, then `count × (u8 type, i16 damage, u16 delay, u8 hitsplatId)`. Hitsplat IDs come from `server/src/game/combat/effects/OsrsHitsplatIds.ts`.

### `SPOT_ANIM` (83) — `u8 size`

Payload: `u32 targetUid`, `u16 graphicId`, `u16 delay`, `u16 height`. Plays a "spotanim" (graphical effect at a location or on a unit).

### `PROJECTILES` (84) — `u16 size`

Multiple projectile launches in one packet. For each projectile: source tile, target uid or tile, projectile type, start delay, arrival delay, arc height, start height, end height.

### `SPELL_RESULT` (85) — `u16 size`

Result of a cast: success/failure, damage, graphical effect to play, target unit. Used when a spell needs more information than a hitsplat + spotanim can convey.

### `DEBUG_PACKET` (86) — `u16 size`

Arbitrary dev-tools payload. Ignored in production builds. Counterpart to `CLIENT_DEBUG`.

### `DESTINATION` (87) — `fixed 4`

Payload: `u16 worldX`, `u16 worldY`. Tells the client where the server thinks the player is walking to — used for the red "X" destination marker on the minimap.

Broadcaster: `CombatBroadcaster.ts`.

## Interfaces / widgets (100-115)

### `WIDGET_OPEN` (100) — `fixed 3`

Payload: `u16 groupId`, `u8 modal`. Open a root widget group. `modal` is 0 (non-modal) or 1 (modal, blocks game input).

### `WIDGET_CLOSE` (101) — `fixed 2`

Payload: `u16 groupId`. Close the widget group.

### `WIDGET_SET_ROOT` (102) — `fixed 2`

Payload: `u16 groupId`. Set the top-level root interface without an open animation — used during login and map rebuilds.

### `WIDGET_OPEN_SUB` (103) — `u16 size`

Open a sub-interface inside an already-open root. Payload carries the target UID, the new sub group id, and an optional initial varp/varbit blob.

### `WIDGET_CLOSE_SUB` (104) — `fixed 4`

Payload: `u32 targetUid`. Close a specific sub interface.

### `WIDGET_SET_TEXT` (105) — `u16 size`

Payload: `u32 uid`, `cstring text`. Change the text of a text widget.

### `WIDGET_SET_HIDDEN` (106) — `fixed 5`

Payload: `u32 uid`, `u8 hidden`.

### `WIDGET_SET_ITEM` (107) — `fixed 10`

Payload: `u32 uid`, `u16 itemId`, `u32 quantity`. Used for item-display widgets that aren't part of an inventory container (e.g. tooltip previews, reward dialogs).

### `WIDGET_SET_NPC_HEAD` (108) — `fixed 6`

Payload: `u32 uid`, `u16 npcId`. Sets the animated head model on an NPC-head widget (dialogue headshots).

### `WIDGET_SET_FLAGS_RANGE` (109) — `fixed 12`

Payload: `u32 uid`, `u16 fromSlot`, `u16 toSlot`, `u32 flags`. Sets the interaction flags on a range of child slots in one packet.

### `WIDGET_RUN_SCRIPT` (110) — `u16 size`

Payload: `u32 scriptId`, followed by a typed argument list (strings and ints) encoded the OSRS way. Tells the client to run a CS2 script with the given args. Used for driving interface-heavy UIs (bank, skill tab, quest list).

### `WIDGET_SET_FLAGS` (111) — `fixed 8`

Payload: `u32 uid`, `u32 flags`. Single-widget interaction flag update.

### `WIDGET_SET_ANIMATION` (114) — `fixed 6`

Payload: `u32 uid`, `u16 animId`. For animated models inside widgets.

### `WIDGET_SET_PLAYER_HEAD` (115) — `fixed 4`

Payload: `u32 uid`. Sets the widget to show the player's own head model.

Broadcaster: `WidgetBroadcaster.ts`.

## Chat (120)

### `CHAT_MESSAGE` (120) — `u8 size`

Payload: `u8 kind` (game, public, private, clan, trade, system), `cstring speaker`, `cstring message`, optional metadata (color, icon).

Broadcaster: `ChatBroadcaster.ts`.

## World updates (130-143)

### `LOC_CHANGE` (130) — `u8 size`

A loc (scenery object) was modified in place. Payload: `u16 x, u16 y, u8 plane, u16 oldLocId, u16 newLocId, u8 rotation`. Used by doors opening/closing and map-cutscene transforms.

### `SOUND` (131) — `u8 size`

Payload: `u16 soundId`, `u8 delay`, `u8 loops`, `u16 sourceX`, `u16 sourceY`. Plays a positional sound effect.

### `PLAY_JINGLE` (132) — `fixed 5`

Payload: `u16 jingleId`, `u24 delay`. A short stinger (quest-complete fanfare, skill level-up).

### `PLAY_SONG` (133) — `fixed 10`

Payload: `u16 trackId`, `u16 outDelay`, `u16 outDur`, `u16 inDelay`, `u16 inDur`. Cross-fade to a music track.

### `LOC_ADD_CHANGE` (134) — `u8 size`

Add a new loc that wasn't in the cache-baked map. Payload is the same shape as `LOC_CHANGE`.

### `LOC_DEL` (135) — `u8 size`

Delete a loc at the given tile.

### `REBUILD_REGION` (140) — `u16 size`

Full region rebuild. Tells the client to discard its currently loaded regions and load a new set. Payload is a list of region coordinates and XTEA keys.

### `REBUILD_NORMAL` (141) — `u16 size`

"Normal" rebuild — used after a teleport that crosses map square boundaries. Carries the player's new center + map square list.

### `REBUILD_WORLDENTITY` (142) — `u16 size`

Rebuild for moving world entities (boats, carpets). Payload carries the entity id and its new tile basis.

### `WORLDENTITY_INFO` (143) — `u8 size`

Per-tick update for world entities: movement deltas, spawns, removals. Encoded by `WorldEntityInfoEncoder.ts`.

Broadcaster: `MiscBroadcaster.ts` (for non-loc stuff); `LocBroadcaster` inside `MiscBroadcaster` for the loc family.

## Shop / trade (150-157)

### `SHOP_OPEN` (150) — `u16 size`

Payload: `u16 shopId`, `cstring title`, `u16 slotCount`, then per slot `u16 itemId, i32 stock, i32 basePrice`.

### `SHOP_SLOT` (151) — `u8 size`

Per-slot update: `u16 shopId`, `u16 slot`, `u16 itemId`, `i32 stock`.

### `SHOP_CLOSE` (152) — `—`

### `SHOP_MODE` (153) — `u8 size`

Payload: `u8 mode` — buy / sell / examine. Client mirrors the mode; server uses it to pick the right price and quantity.

### `TRADE_REQUEST` (154) — `u8 size`

Someone wants to trade you. Payload: `cstring fromName`, optional metadata. Client shows the chat notification.

### `TRADE_OPEN` (155) — `u16 size`

Enter the trade interface. Payload carries both players' names and initial empty offer tables.

### `TRADE_UPDATE` (156) — `u16 size`

Per-side diff of the offer tables. `u8 side`, then an inventory-delta-style payload.

### `TRADE_CLOSE` (157) — `u8 size`

Payload: `u8 reason` — completed, declined, cancelled, timed out.

Broadcaster: `WidgetBroadcaster.ts` (trade and shop share widget plumbing).

## Scripts (170)

### `RUN_CLIENT_SCRIPT` (170) — `u16 size`

Payload: `u32 scriptId`, then a typed argument list. Runs a CS2 client script. Distinct from `WIDGET_RUN_SCRIPT` in that it doesn't target a specific widget UID.

## Smithing (180-182)

These power the smithing interface exclusively because its quantity-mode state has to round-trip per tick.

### `SMITHING_OPEN` (180) — `u16 size`

Payload: `u8 mode`, `cstring title`, `u8 optionCount`, per option `u16 itemId, u8 levelReq, u8 barsPerItem`, then `u8 quantityMode, u32 customQuantity`.

### `SMITHING_MODE` (181) — `fixed 5`

Payload: `u8 quantityMode`, `u32 customQuantity`. Mirrors the mode after a server-side change.

### `SMITHING_CLOSE` (182) — `—`

## Collection log (190)

### `COLLECTION_LOG_SNAPSHOT` (190) — `u16 size`

Payload: `u16 slotCount`, then per slot `u16 slotId, u32 obtainedCount`. Keeps the collection log tab in sync.

## Notifications (200)

### `NOTIFICATION` (200) — `u8 size`

Payload: `u8 kind`, `cstring title`, `cstring message`, `u16 itemId`, `u32 quantity`, `u16 durationMs`. Toast-style notifications (drop log entry, achievement unlocked).

## Gamemode (210)

### `GAMEMODE_DATA` (210) — `u16 size`

Free-form payload used by gamemode plugins to push state to the client (leagues tasks, relic updates, gamemode-specific modals). The payload shape is defined per gamemode.

Emitted from `GamemodeBridge.queueGamemodeData`.

## Debug (250)

### `DEBUG` (250) — `u16 size`

Free-form dev-tools payload. Ignored in production builds.

---

## Canonical facts

- **Source of truth**: `src/shared/packets/ServerPacketId.ts`.
- **Length table**: `SERVER_PACKET_LENGTHS` in the same file.
- **Encoder**: `server/src/network/packet/ServerBinaryEncoder.ts`.
- **Subsystem encoders**: `server/src/network/encoding/PlayerPacketEncoder.ts`, `NpcPacketEncoder.ts`, `AppearanceEncoder.ts`, `WorldEntityInfoEncoder.ts`.
- **Broadcasters**: `server/src/network/broadcasters/` (`ActorSyncBroadcaster`, `ChatBroadcaster`, `CombatBroadcaster`, `InventoryBroadcaster`, `SkillBroadcaster`, `VarBroadcaster`, `WidgetBroadcaster`, `MiscBroadcaster`).
- **Client decoder**: `src/network/packet/ServerBinaryDecoder.ts`.
- **Client dispatch**: `src/network/ServerConnection.ts` (`subscribe*` subscriptions).
- **Quantity encoding rule**: 1 byte for 0-254, else `0xFF` + `i32`.
