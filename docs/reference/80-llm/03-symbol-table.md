# 80.3 — Symbol table

Public classes, functions, types → the file that owns them. Scoped to symbols you'd reasonably import or grep for from other modules. Leaf helpers (private methods, module-local utility types) are out of scope — read the owning file instead.

Paths are relative to the repo root.

## Cache + types

| Symbol | Owner |
|---|---|
| `CacheSystem` | `src/rs/cache/CacheSystem.ts` |
| `CacheSystem.openFromDisk(dir)` | `src/rs/cache/CacheSystem.ts` |
| `CacheSystem.openFromIndexedDB()` | `src/rs/cache/CacheSystem.ts` |
| `ObjTypeLoader` | `src/rs/config/objtype/ObjTypeLoader.ts` |
| `LocTypeLoader` | `src/rs/config/loctype/LocTypeLoader.ts` |
| `NpcTypeLoader` | `src/rs/config/npctype/NpcTypeLoader.ts` |
| `VarpTypeLoader` / `VarbitTypeLoader` | `src/rs/config/vartype/` |
| `EnumTypeLoader` | `src/rs/config/enumtype/` |
| `ParamTypeLoader` | `src/rs/config/paramtype/` |
| `SeqTypeLoader` (animations) | `src/rs/config/seqtype/` |
| `SpriteLoader` / `TextureLoader` / `FontLoader` | `src/rs/{sprite,texture,font}/*` |
| `ModelLoader` | `src/rs/model/ModelLoader.ts` |
| `ObjType`, `LocType`, `NpcType` (field records) | Same file as their loader |
| `CP1252` decode/encode | `src/rs/util/` |
| `XTEA` | `src/rs/crypto/Xtea.ts` |
| `initCacheEnv(dir)` | `server/src/world/CacheEnv.ts` |
| `CacheEnv` (typed loader bag) | `server/src/world/CacheEnv.ts` |

## Protocol — opcodes & lengths

| Symbol | Owner |
|---|---|
| `ClientPacketId` (enum) | `src/shared/packets/ClientPacketId.ts` |
| `CLIENT_PACKET_LENGTHS` | `src/shared/packets/ClientPacketId.ts` |
| `ServerPacketId` (enum) | `src/shared/packets/ServerPacketId.ts` |
| `SERVER_PACKET_LENGTHS` | `src/shared/packets/ServerPacketId.ts` |
| `VarpNames`, `VarbitNames` (named ids) | `src/shared/vars.ts` |
| `Direction` | `src/shared/Direction.ts` |
| `CollisionFlag` | `src/shared/CollisionFlag.ts` |
| `ModifierFlags` | `src/shared/input/modifierFlags.ts` |

## Client — core

| Symbol | Owner |
|---|---|
| `OsrsClient` | `src/client/OsrsClient.ts` |
| `OsrsClientApp` (React root) | `src/client/OsrsClientApp.tsx` |
| `GameContainer` | `src/client/GameContainer.tsx` |
| `GameRenderer` | `src/client/GameRenderer.ts` |
| `GameRenderers` | `src/client/GameRenderers.ts` |
| `ClientState` | `src/client/ClientState.ts` |
| `InputManager` | `src/client/InputManager.ts` |
| `Camera`, `Frustum` | `src/client/Camera.ts`, `Frustum.ts` |
| `MapManager` | `src/client/MapManager.ts` |
| `PlayerAnimController` | `src/client/PlayerAnimController.ts` |
| `DestinationMarker` | `src/client/DestinationMarker.ts` |
| `MouseCross` | `src/client/MouseCross.ts` |
| `TransmitCycles` | `src/client/TransmitCycles.ts` |
| `BrowserVarcsPersistence` | `src/client/BrowserVarcsPersistence.ts` |

## Client — networking

| Symbol | Owner |
|---|---|
| `ServerConnection` | `src/network/ServerConnection.ts` |
| `ServerConnectionShim` | `src/network/ServerConnectionShim.ts` |
| `useServerConnection` (hook) | `src/network/useServerConnection.ts` |
| `useGroundItems`, `useInventory`, `useEquipment` hooks | `src/network/useServerConnection.ts` (same file) |
| `encodeClientPacket*` | `src/network/packet/*` |
| `PlayerSyncManager`, `NpcSyncManager` (client) | `src/client/sync/*` |
| `BitStream` (client reader) | `src/client/sync/BitStream.ts` |

## Client — UI + plugins

| Symbol | Owner |
|---|---|
| `Canvas` | `src/ui/Canvas.tsx` |
| `UiScale`, `UiScaleDiagnostic` | `src/ui/UiScale.ts` |
| `DevOverlay` | `src/ui/devoverlay/*` |
| `CLIENT_PLUGINS` (registry) | `src/ui/plugins/pluginhub/PluginRegistry.ts` |
| `TileOverlayRenderer`, `useOverlayRegistry` | `src/ui/plugins/shared/OverlayRegistry.ts` |
| `useCache*` hooks | `src/ui/cache/*` |
| `WidgetRenderer` | `src/ui/widgets/*` |

## Server — core

| Symbol | Owner |
|---|---|
| `GameContext` | `server/src/game/GameContext.ts` |
| `PlayerManager` | `server/src/game/PlayerManager.ts` |
| `ServerServices` | `server/src/game/ServerServices.ts` |
| `GameTicker` | `server/src/game/ticker.ts` |
| `TickPhaseOrchestrator` | `server/src/game/tick/TickPhaseOrchestrator.ts` |
| `GameEventBus` | `server/src/game/events/GameEventBus.ts` |
| `Player` (server actor) | `server/src/game/player.ts` |
| `Npc` (server actor) | `server/src/game/npc.ts` |
| `NpcManager` | `server/src/game/npcManager.ts` |
| `Actor` (base) | `server/src/game/actor.ts` |
| `Equipment` | `server/src/game/equipment.ts` |
| `EmotesTable` | `server/src/game/emotes.ts` |

## Server — networking

| Symbol | Owner |
|---|---|
| `startWsServer` / `wsServer` bootstrap | `server/src/network/wsServer.ts` |
| `MessageRouter` | `server/src/network/MessageRouter.ts` |
| `MessageHandlers` | `server/src/network/MessageHandlers.ts` |
| `BitWriter` | `server/src/network/BitWriter.ts` |
| `PlayerSyncSession` | `server/src/network/PlayerSyncSession.ts` |
| `NpcSyncSession` | `server/src/network/NpcSyncSession.ts` |
| `NpcExternalSync` | `server/src/network/NpcExternalSync.ts` |
| `PlayerNetworkLayer` | `server/src/network/PlayerNetworkLayer.ts` |
| `BroadcastService` | `server/src/network/BroadcastService.ts` |
| `BroadcastDomain` | `server/src/network/broadcast/BroadcastDomain.ts` |
| `ChatBroadcaster`, `InventoryBroadcaster`, `EquipmentBroadcaster`, `WidgetBroadcaster`, `VarpBroadcaster`, `SkillsBroadcaster`, `GroundItemBroadcaster`, `HitsplatBroadcaster`, … | `server/src/network/broadcast/*` |
| `AuthenticationService` | `server/src/network/AuthenticationService.ts` |
| `LoginHandshakeService` | `server/src/network/LoginHandshakeService.ts` |
| `ServiceWiring` | `server/src/network/ServiceWiring.ts` |
| `BotSdkServer` | `server/src/network/botsdk/*` |
| `accountSummary(...)` | `server/src/network/accountSummary.ts` |
| `levelUpDisplay(...)` | `server/src/network/levelUpDisplay.ts` |
| `reportGameTime(...)` | `server/src/network/reportGameTime.ts` |

## Server — scripts & gamemodes

| Symbol | Owner |
|---|---|
| `ScriptRegistry` | `server/src/game/scripts/ScriptRegistry.ts` |
| `IScriptRegistry` (interface) | `server/src/game/scripts/types.ts` |
| `ScriptServices` | `server/src/game/scripts/types.ts` |
| `ExtrascriptLoader` | `server/src/game/scripts/ExtrascriptLoader.ts` |
| `ExtrascriptEntry` | `server/src/game/scripts/ExtrascriptLoader.ts` |
| `CustomWidgetRegistry` | `server/src/game/scripts/CustomWidgetRegistry.ts` |
| `CustomItemBuilder` | `src/custom/items/CustomItemBuilder.ts` (shared between client + server) |
| `ServerCustomItemRegistry` | `server/src/custom/items/ServerCustomItemRegistry.ts` |
| `ANY_ITEM_ID`, `ANY_LOC_ID`, `ANY_NPC_ID` | `server/src/game/scripts/types.ts` |
| `GamemodeDefinition` (interface) | `server/src/game/gamemodes/GamemodeDefinition.ts` |
| `GamemodeInitContext` | `server/src/game/gamemodes/GamemodeDefinition.ts` |
| `GamemodeServerServices` | `server/src/game/gamemodes/GamemodeDefinition.ts` |
| `GamemodeBridge` / `GamemodeUiBridge` / `GamemodeUiController` | `server/src/game/gamemodes/GamemodeDefinition.ts` |
| `HandshakeBridge`, `XpAwardContext` | `server/src/game/gamemodes/GamemodeDefinition.ts` |
| `GamemodeRegistry` | `server/src/game/gamemodes/GamemodeRegistry.ts` |
| `createGamemode(id, ctx)` | `server/src/game/gamemodes/GamemodeRegistry.ts` |
| `getGamemodeDataDir(id)` | `server/src/game/gamemodes/GamemodeRegistry.ts` |
| `listAvailableGamemodes()` | `server/src/game/gamemodes/GamemodeRegistry.ts` |
| `BaseGamemode` | `server/src/game/gamemodes/BaseGamemode.ts` |
| `VanillaGamemode` | `server/gamemodes/vanilla/index.ts` |
| `LeaguesVGamemode` | `server/gamemodes/leagues-v/index.ts` |

## Server — world / collision

| Symbol | Owner |
|---|---|
| `CacheEnv` | `server/src/world/CacheEnv.ts` |
| `MapCollisionService` | `server/src/world/MapCollisionService.ts` |
| `CollisionOverlayStore` | `server/src/world/CollisionOverlayStore.ts` |
| `PlaneResolver` | `server/src/world/PlaneResolver.ts` |
| `InstanceManager` | `server/src/world/InstanceManager.ts` |
| `LocTileLookupService` | `server/src/world/LocTileLookupService.ts` |
| `LocTransforms` | `server/src/world/LocTransforms.ts` |
| `DoorCatalogFile`, `DoorCollisionService`, `DoorDefinitionLoader`, `DoorStateManager`, `DoorRuntimeTileMappingStore` | `server/src/world/Door*.ts` |
| `DynamicLocStateStore` | `server/src/world/DynamicLocStateStore.ts` |

## Server — game services (selected)

| Symbol | Owner (under `server/src/game/services/`) |
|---|---|
| `MovementService` | `movement/MovementService.ts` |
| `PathfindingService` | `movement/PathfindingService.ts` (or `server/src/pathfinding/`) |
| `InventoryService` | `inventory/InventoryService.ts` |
| `BankingService` | `banking/BankingService.ts` |
| `EquipmentService` | `equipment/EquipmentService.ts` |
| `DialogService` | `dialog/DialogService.ts` |
| `WidgetService` | `widgets/WidgetService.ts` |
| `ShopService` | `shops/ShopService.ts` |
| `TradeService` | `trade/TradeService.ts` |
| `StatsService` / `XpService` | `stats/*` |
| `CombatService` | `../combat/CombatService.ts` |
| `PrayerService` | `../prayer/*` |
| `ProjectileService` | `../projectiles/*` |
| `DropService` | `../drops/*` |
| `DeathService` | `../death/*` |
| `NotificationService` | `../notifications/*` |
| `TimeService` | `../time/*` |
| `FollowerService` | `../followers/*` |

Service names are canonical in `GameContext` / `ServerServices`. Grep `ServerServices.ts` for the exact field names if one of the above has drifted.

## Persistence

| Symbol | Owner |
|---|---|
| `AccountStore` (interface) | `server/src/game/state/AccountStore.ts` |
| `JsonAccountStore` | `server/src/game/state/JsonAccountStore.ts` |
| `PersistenceProvider` | `server/src/game/state/PersistenceProvider.ts` |

## Pathfinding

| Symbol | Owner |
|---|---|
| `PathFinder` (BFS) | `server/src/pathfinding/PathFinder.ts` |
| `AStarPathFinder` | `server/src/pathfinding/AStarPathFinder.ts` (if present) |
| `PathResult` | `server/src/pathfinding/types.ts` |

## Shared data / constants

| Symbol | Owner |
|---|---|
| `items` registry (server) | `server/src/data/items.ts` |
| `npcCombatStats` | `server/src/data/npcCombatStats.ts` |
| `locEffects` | `server/src/data/locEffects.ts` |
| `teleportDestinations` | `server/src/data/teleportDestinations.ts` |
| `spellWidgetLoader` | `server/src/data/spellWidgetLoader.ts` |

## Utilities to know about

| Symbol | Owner |
|---|---|
| `BitWriter` (server) | `server/src/network/BitWriter.ts` |
| `BitStream` (client) | `src/client/sync/BitStream.ts` |
| `Smart` encoders | `src/shared/network/*` |
| `Logger` | `server/src/utils/Logger.ts` |
| `assertNever` | `src/shared/util/*` / `server/src/utils/*` |

## Grep tips

- `grep -RIn "register\(" server/extrascripts/` — every extrascript entry point.
- `grep -RIn "createGamemode" server/gamemodes/` — gamemode entry points.
- `grep -RIn "ClientPacketId\." server/src/network/` — who handles what opcode.
- `grep -RIn "queueWidgetEvent" server/` — everywhere widgets are pushed.
- `grep -RIn "ScriptRegistry" server/src/game/` — all registry wiring.
- `grep -RIn "BroadcastDomain" server/src/network/` — broadcast pipeline seams.
