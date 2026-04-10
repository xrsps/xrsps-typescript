# 80.2 — File index

Subsystem → the files that matter. Paste this into an LLM system prompt before asking it to change code in any of these areas. If a file isn't listed here, it's probably a leaf that you only need after following an import from one of the listed anchors.

Paths are relative to the repo root.

## Top-level layout

| Path | Contents |
|---|---|
| `src/` | Browser client (React + WebGL2) |
| `server/` | Bun/Node WebSocket server |
| `server/src/` | Server engine (non-gamemode core) |
| `server/gamemodes/<id>/` | Shipping gamemodes (`vanilla`, `leagues-v`) |
| `server/extrascripts/<id>/` | Opt-in per-feature server scripts |
| `server/data/` | Shared JSON content (items, NPCs, doors…) |
| `scripts/` | Bun CLI scripts (cache, exports, collision bake) |
| `caches/<version>/` | Downloaded OSRS cache |
| `docs/` | VitePress site (this site) |
| `deployment/` | Caddyfile + deploy notes |
| `mprocs.yaml` / `mprocs.build.yaml` | Dev + build process orchestration |
| `target.txt` | Pinned cache version |

## Client — entry points & shell

| File | Purpose |
|---|---|
| `src/index.tsx` | React root |
| `src/client/OsrsClientApp.tsx` | Top-level app, routing, login flow |
| `src/client/OsrsClient.ts` | Long-lived client object; owns scene + network |
| `src/client/GameContainer.tsx` | Canvas mount, sizing, focus handling |
| `src/client/GameRenderer.ts` | Frame loop, draw order |
| `src/client/GameRenderers.ts` | Per-pass renderers registry |
| `src/client/ClientState.ts` | Client-wide mutable state (camera, selection, menus) |
| `src/client/InputManager.ts` | Keyboard/mouse → actions |
| `src/client/Camera.ts` / `Frustum.ts` | View + culling |
| `src/client/PlayerAnimController.ts` | Animation state machine for the local player |
| `src/client/MapManager.ts` | Region streaming + scene rebuild |
| `src/client/Caches.ts` | Typed cache loader wiring for the browser |

## Client — rendering subsystems

| Path | Purpose |
|---|---|
| `src/client/scene/` | Scene graph, culling, batching |
| `src/client/webgl/` | WebGL2 passes, shaders, VAOs |
| `src/client/highlights/` | Outline / tile highlight rendering |
| `src/client/roof/` | Roof removal logic |
| `src/client/worldview/` | 3D world view composition |
| `src/client/worker/` | Offloaded work (collision, pathing) |
| `src/picogl/` | Bundled picoGL fork (low-level WebGL helper) |
| `src/shaders.d.ts` | GLSL module declarations |

## Client — UI

| Path | Purpose |
|---|---|
| `src/ui/game/` | In-game HUD (chat, inventory, minimap, tabs) |
| `src/ui/widgets/` | Cache-widget renderer |
| `src/ui/cache/` | Browser-side cache viewer widgets |
| `src/ui/devoverlay/` | Dev control panel (leva-driven) |
| `src/ui/item/` | Item icon + tooltip |
| `src/ui/menu/` | Right-click menu |
| `src/ui/text/` / `src/ui/fonts.ts` | Text rendering |
| `src/ui/registry/` | UI component registry |
| `src/ui/model/` | Model preview helpers |
| `src/ui/gl/` | UI-layer GL helpers |
| `src/client/sidebar/` | Tabbed sidebar |
| `src/client/login/` | Login screen + handshake UI |
| `src/client/menu/` | Menu action dispatch |
| `src/client/plugins/` | Client plugin hub + shipped plugins |

## Client — game state & networking

| File / dir | Purpose |
|---|---|
| `src/network/ServerConnection.ts` | WebSocket client, reconnect, state slices |
| `src/network/ServerConnectionShim.ts` | Interface seam for tests / mocks |
| `src/network/packet/` | Client-side encoders for outbound packets |
| `src/network/combat/` | Client-side combat overlay state |
| `src/client/movement/` | Local movement prediction + path smoothing |
| `src/client/interactions/` | Click → interaction packet mapping |
| `src/client/sync/` | Sync packet decoders + replay |
| `src/client/collision/` | Client collision checks |
| `src/client/ecs/` | Tiny ECS for transient entities |
| `src/client/actor/` | Actor (player/npc) state + interpolation |
| `src/client/selectedSpellPackets.ts` | Spell targeting state |
| `src/client/TransmitCycles.ts` | Tick transmit batching |
| `src/client/state/` | Misc client state stores |

## Client — cache / rs (RuneScape cache decoders)

| Path | Purpose |
|---|---|
| `src/rs/cache/` | Cache container (`CacheSystem`, archives, filesystems) |
| `src/rs/config/` | Type loaders, each in its own subdirectory: `objtype/`, `loctype/`, `npctype/`, `vartype/` (varp + varbit), `enumtype/`, `paramtype/`, `seqtype/`, `spotanimtype/`, `structtype/`, `mapscenetype/`, `floortype/`, `hitsplat/`, `healthbar/`, `idktype/`, `bastype/`, `meltype/`, `player/`, `db/`, `worldentitytype/`, `defaults/`. |
| `src/rs/model/` | Model decode + rendering |
| `src/rs/scene/` | Scene builder from cache data |
| `src/rs/map/` | Map tile + region decoding |
| `src/rs/graphics/` | Software rendering helpers ported from the client |
| `src/rs/sprite/` / `src/rs/texture/` / `src/rs/font/` | Asset decoders |
| `src/rs/compression/` | GZIP/BZIP2/LZMA decompression |
| `src/rs/crypto/` | XTEA |
| `src/rs/io/` | Buffer reader/writer |
| `src/rs/cs2/` | CS2 VM |
| `src/rs/interaction/` | Interaction metadata from cache |
| `src/rs/inventory/` / `prayer/` / `skill/` | Helpers ported from the vanilla client |
| `src/rs/chat/` | Chat text formatting + color codes |
| `src/rs/audio/` | Audio decode (sfx, music) |
| `src/rs/Client.ts` | Thin compatibility façade |

## Shared (client + server)

| File / dir | Purpose |
|---|---|
| `src/shared/packets/ClientPacketId.ts` | Inbound-to-server opcode enum + lengths |
| `src/shared/packets/ServerPacketId.ts` | Outbound-to-client opcode enum + lengths |
| `src/shared/network/` | Shared network helpers (encoding rules, constants) |
| `src/shared/input/` | Input flag types (modifierFlags.ts, etc.) |
| `src/shared/items/` | Shared item typedefs |
| `src/shared/spells/` | Spellbook data |
| `src/shared/projectiles/` | Projectile parameter types |
| `src/shared/collectionlog/` | Collection log data shape |
| `src/shared/instance/` | Instance descriptor types |
| `src/shared/ui/` | Shared UI constants |
| `src/shared/debug/` | Debug packet shapes |
| `src/shared/gamemode/` | GamemodeDisplayInfo and friends |
| `src/shared/worldentity/` | World entity types |
| `src/shared/vars.ts` | Named varp/varbit ids |
| `src/shared/Direction.ts` | Direction enum + helpers |
| `src/shared/CollisionFlag.ts` | Collision flag bits |

## Server — entry & ticker

| File | Purpose |
|---|---|
| `server/src/index.ts` | Server main: loads gamemode, opens WS, starts ticker |
| `server/src/game/GameContext.ts` | God object exposing services to handlers |
| `server/src/game/PlayerManager.ts` | Player lifecycle (connect, login, logout, disconnect) |
| `server/src/game/ServerServices.ts` | Service bag assembled at boot |
| `server/src/game/ticker.ts` | 600 ms tick loop |
| `server/src/game/tick/` | Tick phases + `TickPhaseOrchestrator` |
| `server/src/game/events/` | `GameEventBus` (login, death, level-up, etc.) |

## Server — networking

| File | Purpose |
|---|---|
| `server/src/network/wsServer.ts` | `Bun.serve` WebSocket bootstrap |
| `server/src/network/wsServerTypes.ts` | Connection + frame typedefs |
| `server/src/network/MessageRouter.ts` | Opcode → handler dispatch |
| `server/src/network/MessageHandlers.ts` | Core packet handlers (walk, chat, logout, etc.) |
| `server/src/network/handlers/` | Feature-grouped handlers (inventory, combat, widgets, trade) |
| `server/src/network/packet/` | Server-side packet encoders |
| `server/src/network/encoding/` | Shared encoding helpers (smart, bitwriter) |
| `server/src/network/BitWriter.ts` | Bit-level writer for sync packets |
| `server/src/network/PlayerSyncSession.ts` | Per-player PLAYER_SYNC state |
| `server/src/network/NpcSyncSession.ts` | Per-player NPC_INFO state |
| `server/src/network/NpcExternalSync.ts` | NPC visibility tracking |
| `server/src/network/PlayerNetworkLayer.ts` | Outbound frame batching |
| `server/src/network/BroadcastService.ts` | Broadcast phase runner |
| `server/src/network/broadcast/` | Per-subsystem broadcasters (chat, inventory, widgets…) |
| `server/src/network/managers/` | Sync managers (`PlayerSyncManager`, `NpcSyncManager`) |
| `server/src/network/AuthenticationService.ts` | Login auth |
| `server/src/network/LoginHandshakeService.ts` | Handshake state machine |
| `server/src/network/ServiceWiring.ts` | Network service wiring |
| `server/src/network/botsdk/` | Bot SDK port (43595) |
| `server/src/network/anim/` | Animation packet helpers |
| `server/src/network/messages.ts` | Canonical chat message strings |
| `server/src/network/accountSummary.ts` | Welcome/login response payload |
| `server/src/network/levelUpDisplay.ts` | Level-up dialog packet |
| `server/src/network/reportGameTime.ts` | Time sync |

## Server — game services

| Path | Purpose |
|---|---|
| `server/src/game/actions/` | Action queue + dispatch |
| `server/src/game/combat/` | Combat loop, accuracy, damage, styles |
| `server/src/game/interactions/` | NPC/loc interaction pipelines |
| `server/src/game/scripts/` | Script registry + loader (see 50.2, 50.3) |
| `server/src/game/scripts/CustomWidgetRegistry.ts` | Custom widget groups |
| `server/src/game/scripts/ExtrascriptLoader.ts` | Extrascript discovery + loader |
| `server/src/game/scripts/ScriptRegistry.ts` | Handler registry impl |
| `server/src/game/services/` | High-level services (movement, inventory, dialog, widgets, banking, shops, teleport, xp, stats, trade, prayer, …) |
| `server/src/game/systems/` | Per-tick systems (regen, poison, weather) |
| `server/src/game/state/` | Mutable state stores |
| `server/src/game/data/` | Server-internal data (loaded from `server/data/*.json`) |
| `server/src/game/items/` | Item type index + predicates |
| `server/src/game/npc.ts` / `npcManager.ts` | NPC actor + manager |
| `server/src/game/player.ts` | Server-side Player actor |
| `server/src/game/actor.ts` | Shared actor base |
| `server/src/game/equipment.ts` | Equipment slot logic |
| `server/src/game/collectionlog.ts` | Collection log tracking |
| `server/src/game/emotes.ts` | Emote table |
| `server/src/game/death/` | Death handling, grave/gravestones |
| `server/src/game/drops/` | Drop tables + rolling |
| `server/src/game/followers/` | Pet/follower logic |
| `server/src/game/prayer/` | Prayer effects |
| `server/src/game/projectiles/` | Projectile scheduling |
| `server/src/game/sailing/` | World-entity/sailing system |
| `server/src/game/spells/` | Spellbook runtime |
| `server/src/game/trade/` | Trade windows |
| `server/src/game/time/` | In-game time |
| `server/src/game/notifications/` | Notification broadcaster |
| `server/src/game/providers/` | Injectable data providers |
| `server/src/game/interactionIndex.ts` | Interaction index packing |
| `server/src/game/model/` | Server-side model metadata |
| `server/src/game/testing/` | Test fixtures |

## Server — world, cache, collision

| File | Purpose |
|---|---|
| `server/src/world/CacheEnv.ts` | Server cache loader façade (`initCacheEnv(dir)`) |
| `server/src/world/cacheFs.ts` | Cache file reading |
| `server/src/world/MapCollisionService.ts` | Walkable tile lookup |
| `server/src/world/CollisionOverlayStore.ts` | Runtime collision overlays |
| `server/src/world/PlaneResolver.ts` | Plane lookup per tile |
| `server/src/world/InstanceManager.ts` | Instanced regions |
| `server/src/world/LocTileLookupService.ts` | Loc at tile |
| `server/src/world/LocTransforms.ts` | Rotated/shifted loc bounds |
| `server/src/world/DoorCatalogFile.ts` | Door catalog reader |
| `server/src/world/DoorCollisionService.ts` | Door collision toggling |
| `server/src/world/DoorDefinitionLoader.ts` / `DoorDefinitions.ts` | Door definition types |
| `server/src/world/DoorRuntimeTileMappingStore.ts` | Runtime door state |
| `server/src/world/DoorStateManager.ts` | Door open/close state |
| `server/src/world/DynamicLocStateStore.ts` | Dynamic loc swaps |

## Server — gamemodes

| Path | Purpose |
|---|---|
| `server/src/game/gamemodes/GamemodeDefinition.ts` | Gamemode interface types |
| `server/src/game/gamemodes/GamemodeRegistry.ts` | Dynamic `require()` of `server/gamemodes/<id>/` |
| `server/src/game/gamemodes/BaseGamemode.ts` | Base class with sensible defaults |
| `server/gamemodes/vanilla/` | Vanilla gamemode (see 50.5) |
| `server/gamemodes/leagues-v/` | Leagues V gamemode (see 50.5) |

## Server — data (content)

| Path | Purpose |
|---|---|
| `server/data/items.json` | Custom item definitions |
| `server/data/npc-spawns.json` | NPC spawn locations |
| `server/data/npc-combat-defs.json` | NPC combat definitions |
| `server/data/npc-combat-stats.json` | NPC combat stats |
| `server/data/npc-sounds.*.json` | NPC sound bindings |
| `server/data/projectile-params.json` | Projectile parameters |
| `server/data/doors.json` | Door catalog |
| `server/data/stair-floors.json` | Stair plane transitions |
| `server/data/intermap-links.json` | Map region links |
| `server/data/diaryVarbits.ts` | Diary varbit wiring |
| `server/data/accounts.json` | Test accounts |
| `server/data/gamemodes/<id>/` | Gamemode-specific content |
| `server/src/data/items.ts` | Item metadata helpers (code) |
| `server/src/data/npcCombatStats.ts` | Combat stat resolution |
| `server/src/data/locEffects.ts` | Loc effect table |
| `server/src/data/teleportDestinations.ts` | Named teleport destinations |
| `server/src/data/spellWidgetLoader.ts` | Spellbook widget loader |

## Server — agent / bot SDK

| Path | Purpose |
|---|---|
| `server/src/agent/` | Internal agent helpers |
| `server/src/network/botsdk/` | Bot SDK protocol |
| `server/src/audio/` | Server-side audio helpers |
| `server/src/widgets/` | Server-side widget helpers |
| `server/src/pathfinding/` | Pathfinding (BFS/A*) |
| `server/src/utils/` | Misc utilities |
| `server/src/types/` | Shared server types |
| `server/src/config/` | Config loading |
| `server/src/custom/` | Custom content helpers |

## Scripts

| Path | Purpose |
|---|---|
| `scripts/ensure-cache.ts` | Download + pin cache from OpenRS2 |
| `scripts/cache/` | Cache export helpers (CSV, tool data) |
| `scripts/build-collision.ts` (or similar) | Bake collision to `server/cache/collision/<region>.bin` |
| `scripts/export-*` | Various content exports |

## Docs + tooling

| Path | Purpose |
|---|---|
| `docs/` | VitePress site root |
| `docs/reference/` | This reference (10…80 sections) |
| `docs/.vitepress/config.mts` | Sidebar / nav wiring |
| `deployment/Caddyfile` | Prod reverse proxy |
| `mprocs.yaml` | Dev process orchestration |
| `mprocs.build.yaml` | Parallel build orchestration |
| `package.json` | Scripts + deps |
| `bun.lockb` | Bun lockfile |
| `tsconfig.json` | TS config |
| `target.txt` | Pinned cache version |
| `CLAUDE.md` | Repo-level AI contributor instructions |

## How to use this index

If you know the domain, jump straight to the subsystem. If you only know the symptom ("scripts aren't firing", "widget won't close"), start at [04 — Quick lookup](./04-quick-lookup.md) and let it route you. For fully-qualified symbol lookups, use [03 — Symbol table](./03-symbol-table.md).
