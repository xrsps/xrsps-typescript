# 20.3 — Services

The server is organized around a single `ServerServices` object (`server/src/game/ServerServices.ts`) that holds every service the world needs. It is passed to subsystems instead of importing them as modules. This page explains the pattern, why it exists, and gives a service-by-service reference of what's in the bag.

## Why a services object?

Early versions of XRSPS passed individual services into constructors, and every subsystem maintained its own set of imports. That worked up to a few dozen services but broke down when subsystems started needing each other transitively — updating one constructor cascaded through the codebase.

`ServerServices` solves this by being _the_ context:

- Every service takes `ServerServices` in its constructor.
- Every service reads its dependencies off `this.services.otherService` at call time, not construction time.
- Construction can happen in any order because no one reads the object during construction.
- New dependencies are added by declaring a new field on `ServerServices` — no one else has to change.

It is deliberately not a DI container. There's no magic resolution, no annotations, no lifecycle. It's just a typed struct.

## Lifecycle

1. `WSServer` constructs an empty `ServerServices` via `{} as ServerServices`.
2. It instantiates each service, passing the in-flight `ServerServices` reference and assigning the result to the appropriate field.
3. Services call each other through `this.services.xxx` during tick phases — by then, every field is populated.

`ServiceWiring.ts` (`server/src/network/ServiceWiring.ts`) is the script that walks through this construction order. It's a few hundred lines of straightforward instantiation.

## Service categories

There are a lot of services (~60). They're grouped into logical categories in the `ServerServices.ts` imports block — the groups are structural, not enforced by types, but they're useful for navigation.

### Tick and frame orchestration

- **`TickPhaseService`** — implements each phase (movement, combat, scripts, etc.).
- **`TickFrameService`** — owns per-tick `TickFrame`s and autosave scheduling.
- **`tickPhaseOrchestrator`** — the `TickPhaseOrchestrator` instance that runs phases.
- **`activeFrame`** — the currently-active `TickFrame`, set by the orchestrator at the top of each tick.

### Core world managers

- **`playerManager: PlayerManager`** — all logged-in players, indexed by player id.
- **`npcManager: NpcManager`** — all NPCs.
- **`groundItemManager: GroundItemManager`** — ground items.
- **`mapCollisionService`**, **`locTileLookupService`**, **`doorStateManager`**, **`dynamicLocStateStore`** — world state services (see [20.8 — World](./08-world.md)).

### Combat

- **`playerCombatManager`** — player combat state machines.
- **`followerCombatManager`** — follower combat state machines.
- **`damageTracker`** — who dealt damage to whom (for drop distribution).
- **`combatCategoryData`** — weapon category metadata used by combat.
- Plus the service-layer combat helpers under `services/`: `CombatDataService`, `CombatEffectService`, `PlayerCombatService`.

### Movement and pathfinding

- **`movementSystem`** — moves players and NPCs one tick.
- **`movementService`** — higher-level movement operations (walk-to, teleport).
- **`pathService`** — the BFS pathfinder.

### Inventory, equipment, bank, items

- **`inventoryService`**, **`equipmentService`**, **`inventoryMessageService`**, **`equipmentStatsUiService`**, **`equipmentHandler`**.
- **`groundItemManager`** for world drops.

### Skills, prayers, variables

- **`skillService`**, **`prayerSystem`**, **`variableService`**, **`varpSyncService`**.

### Sound and messaging

- **`soundService`**, **`messagingService`**.

### Actions and scripts

- **`actionScheduler`**, **`actionDispatchService`** — dispatch pending queued actions to the right handler.
- **`scriptRegistry`**, **`scriptRuntime`** — dispatch hooks registered by gamemodes and extrascripts.
- Action handlers: **`combatActionHandler`**, **`inventoryActionHandler`**, **`spellActionHandler`**, **`widgetDialogHandler`**, **`effectDispatcher`**.

### Persistence

- **`accountStore: AccountStore`** — loads and saves player accounts.
- **`persistenceProvider`** — the backend (JSON file today).

### Gamemode and extensibility

- **`gamemode: GamemodeDefinition`** — the currently-loaded gamemode.
- **`gamemodeUiController`** — the gamemode's UI hooks, if any.
- **`providerRegistry`** — pluggable providers (spells, weapons, ammo, etc.) registered by the gamemode.

### Network layer

- **`wsServer: WSServer`** — the WebSocket accept loop.
- **`authenticationService`**, **`loginHandshakeService`**, **`messageRouter`**, **`broadcastService`**.
- **`playerNetworkLayer`** — per-player networking state.
- **`playerSyncSession`**, **`npcSyncSession`**, **`npcExternalSync`** — sync encoders.

### Audio

- **`musicCatalogService`**, **`musicRegionService`**, **`musicUnlockService`**, **`npcSoundLookup`**.

### Events

- **`gameEventBus`** — an in-process event bus for cross-service notifications.

## Service lookup patterns

Two patterns coexist:

1. **Direct method calls.** `this.services.equipmentService.ensureEquipArray(p)`. Most code uses this.
2. **Pluggable providers.** The combat system doesn't hardcode its formulas — it asks `providerRegistry.get('combatFormula')` and calls that. Providers are the way gamemodes override behavior.

Use direct calls for stable engine services. Use providers for anything a gamemode might want to swap out.

## Testing

Because services read dependencies at call time, you can construct a `ServerServices` in a test with only the fields you need. Stubs for the rest are fine as long as your code doesn't touch them. See `server/src/game/testing/` for helpers (`createTestServices`, etc.).

## Adding a new service

1. Create a class in the appropriate directory (`server/src/game/services/` is the default).
2. Constructor takes `private services: ServerServices`.
3. Add a field to `ServerServices.ts`.
4. Wire it up in `ServiceWiring.ts`.
5. (Optional) Expose it to the gamemode/scripts layer via `serviceInterfaces.ts` if plugins should be able to call it.

## Anti-patterns

- **Don't import service classes as modules for use at runtime.** Use the services object. Import the type only.
- **Don't call services from outside a tick phase.** The tick is the transaction; anything else is racey.
- **Don't create per-player instances of services.** Services are world singletons; player state lives in `PlayerState`, not services.
- **Don't mutate `ServerServices` after boot.** Boot-time assignment is fine; runtime reassignment is a bug waiting to happen.

---

## Canonical facts

- **Services bundle**: `server/src/game/ServerServices.ts` → `interface ServerServices`.
- **Wiring script**: `server/src/network/ServiceWiring.ts`.
- **Provider registry**: `server/src/game/providers/ProviderRegistry.ts`.
- **Testing helpers**: `server/src/game/testing/`.
- **Rule**: services are world singletons; player state lives on `PlayerState`.
- **Rule**: read dependencies off `services.xxx` at call time, not construction time.
- **Rule**: gamemodes override behavior via providers, not by monkey-patching services.
