# 20.4 — Player state

`server/src/game/player.ts` is a large file that holds the `PlayerState` interface and `PlayerManager` class. This page is about what a "player" is on the server, what state it carries, and how the many sub-stores under `server/src/game/state/` hang off it.

## `PlayerState`

At ~1100 lines, `player.ts` is big because `PlayerState` is the central record for every logged-in character. It includes:

- **Identity** — player id, username, display name, account flags, privileges.
- **Position** — world position (x, y, plane), instance id, previous position, velocity.
- **Appearance** — gender, equipment visuals, skull state, overhead icon, identikit parts.
- **Inventory and bank** — containers backed by `PlayerInventoryState` and `PlayerBankSystem`.
- **Equipment** — `PlayerEquipmentAccessor` for slot-based access.
- **Skills** — `PlayerSkillSystem` with current and max levels, XP totals.
- **Prayers** — `PlayerPrayerState` with active prayers, prayer points.
- **Run energy** — `PlayerRunEnergyState`.
- **Special attack** — `PlayerSpecialEnergyState`.
- **Varps / varbits** — `PlayerVarpState`.
- **Combat state** — `PlayerCombatState` (current target, last hit, autocast spell, etc.).
- **Account-level state** — `PlayerAccountState` (progression across characters on the account).
- **Collection log** — `PlayerCollectionLogState`.
- **Session keys** — `PlayerSessionKeys` (anti-cheat / anti-replay tokens).
- **Follower** — `PlayerFollowerPersistState`.
- **Network session** — reference to the player's WebSocket and sync session.

The state is deliberately flat, not deeply nested, because the serializer (`PlayerStateSerializer`) walks specific fields by name rather than traversing arbitrary structure.

## `PlayerManager`

Owns the set of all `PlayerState`s. Public API (illustrative):

- `add(player)` / `remove(playerId)`.
- `getById(id)`, `getByUsername(name)`.
- `forEach(fn)` — iteration used by tick phases.
- `getNearby(x, y, plane, range)` — used by sync and chat.
- `countLoggedIn()`.

`PlayerManager` is a world singleton on `ServerServices.playerManager`. There is exactly one per running server.

## The sub-state pattern

`PlayerState` doesn't inline every field directly; instead it holds references to sub-states like `PlayerInventoryState`, `PlayerSkillSystem`, etc. Each sub-state:

1. Lives in `server/src/game/state/<Name>.ts`.
2. Exposes typed methods to mutate and query its data.
3. Implements a `serialize()` / `deserialize()` pair used by `PlayerStateSerializer`.
4. May extend `PersistentSubState` for lifecycle hooks.

This keeps `player.ts` navigable — the file defines the _shape_ and the _orchestration_, not every detail of prayer or inventory logic.

### List of sub-states

| File | Purpose |
|---|---|
| `PlayerAccountState.ts` | Account-level flags, creation date, entitlements. |
| `PlayerAggressionTracker.ts` | Per-NPC aggression timers ("has this NPC seen me recently"). |
| `PlayerBankSystem.ts` | Bank tabs, placeholders, search. |
| `PlayerCollectionLogState.ts` | Collection log entries. |
| `PlayerCombatState.ts` | Combat target, last attacker, combat tick cooldowns. |
| `PlayerEquipmentAccessor.ts` | Typed slot access wrapping the inventory. |
| `PlayerFollowerPersistState.ts` | Active follower and its state. |
| `PlayerInventoryState.ts` | Inventory container. |
| `PlayerPersistence.ts` | Marshals the overall player serialization. |
| `PlayerPrayerState.ts` | Active prayers, prayer points. |
| `PlayerRunEnergyState.ts` | Run energy and regen. |
| `PlayerSessionKeys.ts` | Session tokens. |
| `PlayerSkillSystem.ts` | Skills (levels, XP, current boosted levels). |
| `PlayerSpecialEnergyState.ts` | Special attack energy. |
| `PlayerStateSerializer.ts` | Main serialize/deserialize entry point. |
| `PlayerStatusState.ts` | Status effects (poison, venom, freeze, stun, prayer drain). |
| `PlayerVarpState.ts` | Varps and varbits. |

## Serialization flow

On save:

```
PlayerStateSerializer.toJson(player)
 ├── player.inventory.serialize()
 ├── player.bank.serialize()
 ├── player.skills.serialize()
 ├── …
 └── returns a plain JSON-serializable object
```

On load:

```
PlayerStateSerializer.fromJson(json)
 ├── create sub-states
 ├── sub-state.deserialize(jsonPart)
 ├── stitch references
 └── returns a PlayerState
```

The serializer is _schema-versioned_. Each sub-state includes a version number in its output, and on load, migrations are applied if the saved version is older. If you change a sub-state's on-disk shape, bump its version and add a migration.

## `PersistentSubState`

A tiny base class in `state/PersistentSubState.ts` with:

- `markDirty()` — signals that this sub-state needs to be saved.
- `isDirty()` — used by autosave to decide whether to re-serialize.
- `clearDirty()` — called after a successful save.

Not all sub-states extend it — only the ones that benefit from dirty tracking to avoid rewriting unchanged data on every autosave.

## Player lifecycle

1. **Login handshake.** `LoginHandshakeService` authenticates, loads the account JSON from `AccountStore`, reconstructs `PlayerState` via `PlayerStateSerializer.fromJson`, adds it to `PlayerManager`, and attaches the WebSocket.
2. **Runtime.** Tick phases read and mutate `PlayerState` through services.
3. **Save.** Autosave runs periodically (controlled by `TickFrameService.maybeRunAutosave`). It serializes dirty players and writes to the `AccountStore`.
4. **Logout / disconnect.** `PlayerManager.remove(id)` is called. A final save runs before removal. If the disconnect happened mid-combat, the player is marked orphaned and kept in the world until the orphan timer expires (see `runOrphanedPlayersPhase`).

## Orphaned players

OSRS has a rule: if you log out during combat, you don't vanish — your character stays in the world for a while so monsters keep attacking and drops still work. `PlayerManager` supports this by:

- Keeping the `PlayerState` in the manager after disconnect.
- Marking it with an orphan flag.
- The `orphaned_players` tick phase decrements the orphan timer and finalizes removal when it reaches zero.
- If the same account reconnects during the orphan window, the existing state is reused.

## Account-level state

Some data spans characters on the same account (entitlements, purchased cosmetics, account flags). This is held in `PlayerAccountState` and is saved separately from the character state. The split lets you have multiple characters sharing account-level progression.

---

## Canonical facts

- **Core type**: `server/src/game/player.ts` → `interface PlayerState`.
- **Manager**: `server/src/game/player.ts` → `class PlayerManager`.
- **State directory**: `server/src/game/state/`.
- **Serializer**: `server/src/game/state/PlayerStateSerializer.ts`.
- **Persistence**: `server/src/game/state/PlayerPersistence.ts`.
- **Base sub-state**: `server/src/game/state/PersistentSubState.ts`.
- **Account store**: `server/src/game/state/AccountStore.ts`.
- **Autosave hook**: `TickFrameService.maybeRunAutosave` in the broadcast phase.
- **Orphan phase**: `runOrphanedPlayersPhase` in `TickPhaseService.ts`.
