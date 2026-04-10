# 20.5 — NPCs

NPCs on the server are a parallel universe to players: they have their own state, their own manager, their own combat, their own movement system. They are intentionally simpler — no network session, no inventory, no skills — but the wiring into the tick loop is the same.

## `npc.ts` — `NpcState`

`server/src/game/npc.ts` defines the `NpcState` interface. Fields roughly mirror `PlayerState` but with NPC-specific twists:

- **Identity** — `npcId` (world-unique), `typeId` (cache type), `name` (from cache).
- **Position** — world position, respawn home, aggression radius.
- **Combat** — `currentHp`, `maxHp`, `attackCooldown`, `inCombatUntil`, current target (player or NPC id).
- **AI state** — `aiState` (idle / wandering / engaged / returning / dead), `combatAI` reference.
- **Animations** — current animation, spot anim.
- **Transforms** — some NPCs switch types via varbit overrides; the current _effective_ type is cached here.
- **Respawn** — `respawnTick` for when it'll come back after death.
- **Instance id** — if spawned inside a dungeon or minigame instance.

Like `PlayerState`, `NpcState` is a data bag. Behavior is in services and helpers.

## `npcManager.ts` — `NpcManager`

The large file that owns every NPC in the world. Responsibilities:

- **Spawn loading.** `loadFromFile(path)` reads `server/data/npc-spawns.json` at boot. Each entry becomes an `NpcState` registered at its home coordinate.
- **Spawn registration.** Gamemodes can call `register(spawnDef)` at boot to inject additional spawns (e.g., leagues-v adds relic vendors).
- **Tick iteration.** Exposes `forEachActive(fn)` and similar for the tick phases.
- **Respawn.** When an NPC dies, its state isn't deleted — it's set to `DEAD` and scheduled for respawn. `NpcManager` handles the timer.
- **Spatial queries.** `findNearby(x, y, plane, range)` used by sync and by aggression checks.
- **Transform.** `transformNpc(npc, newTypeId)` changes the NPC's effective type without breaking references.

NPC indices (`npcId`) are allocated from a dense pool so sync packets can compactly reference them. When an NPC is removed for good (not just dead), the id is returned to the pool.

## `npc-spawns.json`

A JSON array, one entry per spawn:

```json
{
  "typeId": 1,
  "x": 3221,
  "y": 3219,
  "plane": 0,
  "walkRange": 5,
  "aggroRange": 0,
  "spawnDir": 0,
  "notes": "Goblin outside Lumbridge"
}
```

The spawn file is hand-edited today. There is no in-game editor (a "dev spawn an NPC here" command exists as a debug utility, but it doesn't persist to the file). If you want a permanent spawn, edit the JSON.

## NPC AI

Under `server/src/game/combat/NpcCombatAI.ts`, each NPC has a combat AI instance that decides what to do each tick:

1. **Idle.** No nearby target. Optionally wanders within `walkRange`.
2. **Engaged.** Someone attacked the NPC (or walked into aggression range for an aggressive NPC).
   - Chooses an attack style based on the NPC type's combat stats.
   - Moves toward the target until in attack range.
   - Attacks on its cooldown.
   - If the target moves out of max follow range, returns to idle.
3. **Dead.** Awaiting respawn.

More sophisticated AI (bosses, scripted encounters) subclass or replace `NpcCombatAI`. `BossScriptFramework.ts` in the same directory provides a hook-driven framework for custom boss behavior.

## Combat stats

NPC combat stats — attack, strength, defence, hp, magic, ranged — live in `server/src/data/npcCombatStats.ts`. This is a hand-authored table indexed by NPC type id. Stats for NPCs not in the table default to values computed from cache combat level.

## NPCs in sync

Per tick, `NpcSyncSession` walks every player and builds a per-player NPC sync payload:

- Which NPCs are newly visible (player moved into their view range).
- Which NPCs moved, and where.
- Which NPCs had an animation, hit, face, or transform event.
- Which NPCs left view.

`NpcUpdateEncoder` writes this payload into a bit-packed buffer matching what `NpcUpdateDecoder` on the client expects. See [10.6 — Sync and movement](../10-client/06-sync-movement.md) for the client side.

## NPC interactions

Left-click on an NPC or selecting a menu action sends a packet that lands in an action handler. For combat, it creates a combat engagement. For talk-to, it invokes the NPC's script hook (registered by a gamemode or extrascript via `ScriptRegistry.registerNpcInteraction(...)`).

The NPC interaction flow, in order:

1. Client sends `NPC_INTERACT` packet with NPC id and action.
2. `MessageRouter` dispatches to a handler.
3. Handler validates — NPC exists, in range, action is valid for this NPC type.
4. Handler queues the action via `ActionScheduler` for the next `scripts` phase.
5. `scripts` phase invokes the script registered for `(npcTypeId, action)`.
6. The script mutates state (open a shop widget, start a dialogue, engage combat).

## Transformations

Some NPCs change appearance or stats based on a varbit. For example, doors that "are" different NPCs at different quest stages. `NpcManager.transformNpc` reads the current varbit and swaps the type id. The sync system notices the change and pushes a `transform` update to clients.

## Respawn

On death:

1. The combat system flags the NPC dead.
2. `deathPhase` produces drops (using the damage tracker to determine who gets credit).
3. The NPC enters `DEAD` state.
4. `NpcManager` schedules a respawn tick (default ~50 ticks = 30 s, but many NPC types override).
5. On the respawn tick, state is reset to `IDLE` at the home coordinate.

Dead NPCs are not sent to clients in sync (they don't exist to the world), but the client removes them via the sync "remove" mask.

## Custom NPC types

A gamemode can register a new NPC behavior by providing a script handler and by listing custom spawns. Custom appearance (swapping the model, name, stats) is done via cache-level overrides (see the leagues-v gamemode for an example).

---

## Canonical facts

- **NPC state type**: `server/src/game/npc.ts` → `interface NpcState`.
- **Manager**: `server/src/game/npcManager.ts` → `class NpcManager`.
- **Spawn file**: `server/data/npc-spawns.json`.
- **Combat AI**: `server/src/game/combat/NpcCombatAI.ts`.
- **Boss framework**: `server/src/game/combat/BossScriptFramework.ts`.
- **Combat stats table**: `server/src/data/npcCombatStats.ts`.
- **Sync encoder**: `server/src/network/sync/NpcUpdateEncoder.ts` (matches `NpcUpdateDecoder` on the client).
- **Rule**: NPC ids are dense; transforms reuse the same id; deaths keep the id until final removal.
