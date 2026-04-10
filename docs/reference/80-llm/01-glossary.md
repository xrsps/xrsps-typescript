# 80.1 — Glossary

OSRS-flavored vocabulary that shows up throughout XRSPS. A lot of these terms trip up new contributors because they don't match any other domain.

| Term | Definition |
|---|---|
| **obj** | Item type (inventory item, ground item, equipable item). Abbreviation for "object" in OSRS terminology. Index 19 in the cache. `ObjTypeLoader`. |
| **loc** | Scenery object rooted to a tile (door, tree, table, stairs, altar). Short for "location". Different from an obj (which is an item). Loaded from cache index 16. `LocTypeLoader`. |
| **npc** | Non-player character. Loaded from cache index 18. `NpcTypeLoader`. |
| **varp** | Variable persistent — a 32-bit per-player integer persisted across login sessions. The OSRS engine references them by id; XRSPS names common ones in `src/shared/vars.ts`. |
| **varbit** | Variable bit — a slice of bits inside a varp, exposed as its own logical variable. Many varbits can share a varp. Used for tiny flags that don't merit a whole varp. |
| **widget** | A UI component. A widget tree has a root (group) containing child components. Cache index 3. XRSPS extends the vanilla set via `CustomWidgetRegistry`. |
| **widget group** | The root container of a widget tree — one tab, one interface, one modal. Addressed by group id. |
| **widget uid** | 32-bit packed `(groupId << 16) | componentId` used to address a specific sub-component. |
| **CS2** | "Client Script 2" — OSRS's widget-side scripting language. Widget behaviors (show numbers, format text, react to clicks) are encoded as CS2 bytecode. XRSPS runs them in a VM in `src/client/vm/`. |
| **tick** | 600 ms fixed interval that drives server-side game logic. Every gameplay action resolves on a tick boundary. |
| **tick phase** | One of 11 named steps inside a tick: broadcast → pre_movement → movement → music → scripts → combat → death → post_scripts → post_effects → orphaned_players → broadcast_phase. See [20.2](../20-server/02-tick-system.md). |
| **sync packet** | Per-tick bit-packed update of every visible player (`PLAYER_SYNC`) or NPC (`NPC_INFO`) to one client. See [40.5](../40-protocol/05-sync-bitstreams.md). |
| **smart** | OSRS's variable-length integer encoding. 1 or 2 bytes depending on the high bit of the first byte. Used to save space on mostly-small values. |
| **XTEA** | A block cipher used to encrypt map data. Per-region keys are distributed alongside the cache. |
| **region** | A 64×64 tile square of the world map. Encoded as `(regionX, regionY)` from world coords. |
| **map square** | Another name for region, used in some APIs. |
| **plane** / **level** | Vertical layer of the world (0-3). Stairs and teleports cross planes. |
| **instance** | A private copy of a region for a player or a small group, so two parties can be in the same boss room without seeing each other. `InstanceManager`. |
| **gamemode** | A world-wide rule set (vanilla, leagues-v, HC). Exactly one is loaded at boot. See [50.1](../50-gamemodes-scripts/01-gamemode-api.md). |
| **extrascript** | An opt-in per-feature plugin under `server/extrascripts/`. Adds scripted content on top of the gamemode. See [50.3](../50-gamemodes-scripts/03-extrascripts.md). |
| **client plugin** | A client-side overlay / feature module under `src/ui/plugins/`. Renders on top of the main scene. Distinct from extrascripts (which are server-side). |
| **action queue** | Per-player FIFO of pending script actions. Scripts are non-reentrant per player — actions are enqueued and dispatched one at a time. |
| **dialog** / **dialogue** | A suspended script coroutine showing NPC text + options. Built on top of widget packets and `RESUME_PAUSEBUTTON`. |
| **hitsplat** | A per-damage-event visual — the number that pops up on a unit when they take damage. OSRS has several hitsplat ids (block, hit, heal, poison, etc.). |
| **spotanim** | A graphical effect rooted at a tile or on a unit, not tied to an animation. Projectile impacts, prayer visuals. |
| **projectile** | A visual moving from one tile to another (ranged arrow, magic spell). Has launch time, arrival time, arc height. Damage is applied server-side at the arrival tick. |
| **broadcast phase** | The tick phase that flushes all queued per-player packets into outbound WebSocket frames. See `BroadcastDomain`. |
| **broadcaster** | A subsystem service (`ChatBroadcaster`, `InventoryBroadcaster`, …) that accumulates updates for a player during a tick and emits them in the broadcast phase. |
| **sync session** | The per-player state tracking which players / NPCs are visible so the next sync packet can encode deltas (`PlayerSyncSession`, `NpcSyncSession`). |
| **orphan** | A player whose socket closed mid-combat. Held in-world for a grace period so the combat completes fairly. |
| **account store** | Where player state is persisted. Default is `JsonAccountStore` (JSON file). See [20.10](../20-server/10-persistence.md). |
| **persistence provider** | Plugin interface for custom storage backends (SQLite, Postgres). |
| **script registry** | The switchboard that maps `(npcId, option)` / `(locId, action)` / `(itemId, option)` / etc. to handler functions. See [50.2](../50-gamemodes-scripts/02-script-registry.md). |
| **script runtime** | Dispatches handlers from the registry in a non-reentrant per-player loop. |
| **cache env** | Server-side wrapper around the opened cache providing typed loaders. `initCacheEnv(dir)`. |
| **collision cache** | Pre-baked `server/cache/collision/<region>.bin` files encoding walkability per tile. Regenerated by `server:build-collision`. |
| **bot-SDK** | A secondary WebSocket port (`43595`) accepting authenticated bot clients. Used for dev testing and headless agents. |
| **CP-1252** | The string encoding used for all protocol strings (not UTF-8). Legacy from OSRS's Java roots. |
| **bit writer / bit stream** | Byte-unaligned readers/writers used for the sync packet bit sections. Server uses `BitWriter`, client uses `BitStream`. |
| **modifier flags** | Bitfield describing which modifier keys were held during a click. `src/shared/input/modifierFlags.ts`. |
| **world entity** | A moving world object that carries tiles with it (boat, cart). Synced via `WORLDENTITY_INFO`. |
| **leva** | The library providing the dev control panel for rendering tweaks. |
| **mprocs** | The process orchestrator used for dev (`mprocs.yaml`) and parallel builds (`mprocs.build.yaml`). |
| **Caddy** | The reverse proxy recommended for production TLS termination. `deployment/Caddyfile`. |
