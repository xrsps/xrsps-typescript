# 80.4 — Quick lookup

"I want to X" → the file(s) to read. Sorted by common tasks. For each row, start at the first file and walk outward from there.

## Gameplay content

| Task | Start here |
|---|---|
| Add an NPC with a dialogue | [70.2](../70-examples/02-add-npc.md); `server/extrascripts/` + `ScriptRegistry.registerNpcInteraction` |
| Add an item with an action | [70.4](../70-examples/04-extrascript.md); `CustomItemBuilder`, `registerItemAction` |
| Add a right-click action on scenery (loc) | `registerLocInteraction` / `registerLocAction`; `server/src/game/scripts/ScriptRegistry.ts` |
| Add a chat command | [70.3](../70-examples/03-chat-command.md); `registerCommand` |
| Make items do something when combined | `registerItemOnItem`, `registerItemOnLoc` |
| Add an equipment slot trigger | `registerEquipmentAction`, `registerEquipmentOption` |
| Register a tick handler | `registerTickHandler`; runs during the scripts phase |
| Register a region entry/exit hook | `registerRegionHandler` |
| Build a custom modal | [70.7](../70-examples/07-custom-widget.md); `CustomWidgetRegistry` |
| Spawn a custom item id | `CustomItemBuilder.register(...)` (item ids ≥ 50000) |
| Add an NPC spawn | `server/data/npc-spawns.json` |
| Change NPC combat stats | `server/data/npc-combat-stats.json` + `server/src/data/npcCombatStats.ts` |
| Add a projectile | `server/data/projectile-params.json`; `server/src/game/projectiles/` |
| Add a door | `server/data/doors.json`; `server/src/world/Door*.ts` |
| Add a teleport destination | `server/src/data/teleportDestinations.ts` |
| Create a new gamemode | [70.5](../70-examples/05-gamemode.md); `server/gamemodes/<id>/index.ts` with `createGamemode` |
| Change XP rates per gamemode | override `getSkillXpMultiplier` in your `GamemodeDefinition` |
| Override drop tables per gamemode | override `getDropTable` / `getDropRateMultiplier` |
| Set spawn location per gamemode | override `getSpawnLocation(ctx)` |

## Networking / protocol

| Task | Start here |
|---|---|
| Add a new inbound opcode | [70.6](../70-examples/06-packet-handler.md); `ClientPacketId.ts` + `MessageRouter.ts` + `handlers/` |
| Add a new outbound opcode | `ServerPacketId.ts` + `SERVER_PACKET_LENGTHS` + `server/src/network/packet/` + client decoder |
| Change how players are synced | `server/src/network/PlayerSyncSession.ts` + `src/client/sync/PlayerSyncManager.ts` |
| Change how NPCs are synced | `server/src/network/NpcSyncSession.ts` + `NpcExternalSync.ts` + `src/client/sync/NpcSyncManager.ts` |
| Debug a broken packet | Enable `SYNC_DUMP=1`; read [40.5](../40-protocol/05-sync-bitstreams.md); check `BitWriter` vs `BitStream` |
| Change broadcast order inside a tick | `server/src/network/broadcast/BroadcastDomain.ts`; see [20.2](../20-server/02-tick-system.md) |
| Wire up a new broadcaster | Add a class under `server/src/network/broadcast/`, register in `BroadcastDomain` |
| Change login handshake | `server/src/network/LoginHandshakeService.ts` + `src/client/login/` |
| Add a bot-SDK command | `server/src/network/botsdk/` |

## Cache

| Task | Start here |
|---|---|
| Decode a new type from the cache | `src/rs/config/` — pick the closest existing loader |
| Use the cache from a Bun script | [70.9](../70-examples/09-cache-export.md); `CacheSystem.openFromDisk` |
| Bump the cache version | Update `target.txt`, run `bun run ensure-cache`, then `server:build-collision` |
| Add XTEA keys for a new region | `keys.json` inside the cache dir |

## Rendering / client

| Task | Start here |
|---|---|
| Add an overlay that draws on tiles | [70.8](../70-examples/08-render-overlay.md); `src/ui/plugins/shared/OverlayRegistry.ts` |
| Change the roof-removal behavior | `src/client/roof/` |
| Tweak camera controls | `src/client/Camera.ts` + `InputManager.ts` |
| Add a new shader pass | `src/client/webgl/` + `src/shaders.d.ts` |
| Register a new client plugin | `src/ui/plugins/pluginhub/PluginRegistry.ts` |
| Change HUD layout | `src/ui/game/` |
| Add a dev control | `src/ui/devoverlay/` (leva-driven) |
| Add a widget renderer type | `src/ui/widgets/` |
| Fix a cache viewer bug | `src/ui/cache/` |

## Movement / collision

| Task | Start here |
|---|---|
| Teleport a player | `services.movement.teleport(player, x, y, plane)` |
| Pathfind to a tile | `services.pathfinding.findPath(...)` |
| Change walkability of a tile at runtime | `CollisionOverlayStore.setOverlay(...)` |
| Re-bake collision for a region | `bun run server:build-collision` |
| Instance a region | `InstanceManager.createInstance(...)` |

## State / persistence

| Task | Start here |
|---|---|
| Persist a new field on a player | `Player` + `JsonAccountStore` serialize/deserialize |
| Add a custom persistence backend | Implement `PersistenceProvider`; wire in `ServerServices.ts` |
| Reset all accounts | Delete `server/state/accounts/*.json` (check path in `JsonAccountStore.ts`) |

## Dialogue / UI from scripts

| Task | Start here |
|---|---|
| Show an NPC dialogue | `services.dialog.npcMessage(...)` / `dialog.options(...)` |
| Show a count dialogue (number input) | `services.dialog.queryCount(...)` |
| Show a name dialogue (string input) | `services.dialog.queryName(...)` |
| Open a custom widget | `services.dialog.queueWidgetEvent({ action: "open", groupId })` |
| Update text in an open widget | `queueWidgetEvent({ action: "set_text", uid, text })` |
| Close a widget | `queueWidgetEvent({ action: "close", groupId })` |
| Set an inventory/bank item visual | `queueWidgetEvent({ action: "set_item", uid, itemId, count })` |

## Dev / build / deploy

| Task | Start here |
|---|---|
| Start the dev stack | [60.1](../60-build-run-deploy/01-local-dev.md); `bun run dev` |
| Run only the server | `bun run server:start` |
| Run only the client | `bun run start` |
| Run tests | `bun test` |
| Type-check the client | `bun run build` (or `tsc --noEmit`) |
| Lint | `bun run lint` |
| Bake collision | `bun run server:build-collision` |
| Export items CSV | [70.9](../70-examples/09-cache-export.md) |
| Deploy to a VPS | [60.5](../60-build-run-deploy/05-deploy.md) |
| View server logs in prod | `journalctl -u xrsps -f` (see 60.6) |
| Profile a tick | `TICK_PROFILE=1 bun run server:start` |
| Dump sync packets | `SYNC_DUMP=1 bun run server:start` |

## Debugging common symptoms

| Symptom | First place to look |
|---|---|
| "Script isn't firing" | `ScriptRegistry` match order; is the extrascript's `register()` actually exported? |
| "Widget doesn't open" | Is the group registered with `CustomWidgetRegistry.register(...)` before `queueWidgetEvent`? |
| "Widget click does nothing" | `registerWidgetAction` componentId mismatch; log `event.componentId` |
| "Player stops mid-walk" | `MovementService` + collision overlay; is the path still valid? |
| "Sync packet crashes the client" | `SYNC_DUMP=1`, then compare `BitWriter` emitter vs `BitStream` reader |
| "Login fails silently" | `LoginHandshakeService` + `AuthenticationService`; the client's `useServerConnection` error state |
| "Cache missing file" | `target.txt` vs `caches/<version>/`; rerun `ensure-cache` |
| "Collision wrong after edit" | Re-run `server:build-collision`; also check `CollisionOverlayStore` for runtime overrides |
| "Extrascript not reloading" | The entry must export `register`; log line printed by `ExtrascriptLoader` |
| "XP not awarded" | Gamemode's `getSkillXpMultiplier` + `getSkillXpAward` |
| "Drops empty" | Gamemode's `getDropTable` override + `server/src/game/drops/` |

## Where to paste this into an LLM

- Stuck in a subsystem → paste [02 — File index](./02-file-index.md).
- Need exact symbols → paste [03 — Symbol table](./03-symbol-table.md).
- Working on one of the task rows above → paste just that row and the linked file(s).
- New to the codebase → paste [01 — Glossary](./01-glossary.md) and [02 — File index](./02-file-index.md) together.
