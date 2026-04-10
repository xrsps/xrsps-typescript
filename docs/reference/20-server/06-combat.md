# 20.6 — Combat (`server/src/game/combat/`)

OSRS combat is deceptively complex. It involves attack styles, weapon interfaces, equipment bonuses, prayer modifiers, curses, skull timers, loot distribution, special attacks, autocasting, poison, venom, freeze status, multi-combat rules, aggression, damage tracking, XP allocation by combat style, and a formula for every one of them. The `server/src/game/combat/` directory is where all of that lives.

This page is a map of the directory rather than a re-derivation of the formulas. Formulas are in the code; the code matches OSRS as of the revision in `target.txt` (see the README).

## Engagement and state machine

### `CombatEngagementRegistry.ts`

The world-level map of _who is fighting whom_. A single registry tracks all active engagements so that:

- An NPC engaged with player A can't be stolen by player B unless A loses engagement.
- Players who log out mid-fight orphan their engagement (kept alive by the orphaned-player phase).
- The damage tracker can look up who is engaged with a particular NPC.

### `CombatStateMachine.ts`

A per-combatant state machine that drives engagement: `IDLE → APPROACHING → ATTACKING → DISENGAGING → IDLE`. Each tick, the machine advances based on range, cooldown, and whether a target is still valid.

### `CombatState.ts`

The data bag for combat state that hangs off `PlayerState` or `NpcState`. Current target, last-hit timestamp, attack cooldown, autocast spell, special energy, combat ticks since last hit, etc.

### `CombatIntegration.ts`

The glue between the combat state machine and the tick phase service. It's the thing the `combat` phase calls into.

## Formulas and data providers

Combat formulas and data are factored into providers so gamemodes can swap them.

- **`CombatFormulaProvider.ts`** — interface + default implementation of "given attacker + defender + style + equipment, produce hit chance and max hit". This is the core OSRS combat formula.
- **`EquipmentBonusProvider.ts`** — sum attack and defence bonuses across equipment slots.
- **`CombatCategoryData.ts`** — table of weapon categories → animations, attack styles, sounds. A gamemode can override this to retheme a weapon.
- **`WeaponDataProvider.ts`** — maps weapon item ids to their combat interface, style list, special attack.
- **`WeaponInterfaces.ts`** — the set of combat interface ids used by different weapon categories.
- **`CombatStyleSequenceProvider.ts`** — which attack animation to play for a given style.
- **`AmmoDataProvider.ts`** — ranged ammo compatibility and effects.
- **`AmmoSystem.ts`** — ammo consumption and recovery.
- **`SkillConfigurationProvider.ts`** — XP allocation rules per style (e.g., "controlled" → split XP across attack/strength/defence).

## Special attacks

- **`SpecialAttackProvider.ts`** — maps weapon ids to their special attack handlers and energy costs.
- **`SpecialAttackVisualProvider.ts`** — the visual effects (graphics, animations) for each special.
- **`InstantUtilitySpecialProvider.ts`** — "instant" specials that don't go through the normal hit pipeline (heal, teleport, pray restore).

## Effects

- **`CombatEffectApplicator.ts`** — applies on-hit effects: damage, poison, venom, freeze, stun, bind. Works from a typed `CombatEffect` input so attack scripts can compose effects.
- **`HitEffects.ts`** — pure functions producing hit effect descriptors.
- **`OsrsHitsplatIds.ts`** — the numeric ids for the visual hit splats (regular, block, heal, max, poison, venom, etc.).
- **`PoisonVenomSystem.ts`** — poison/venom tick logic (damage over time, cure, immunity).

## XP

- **`CombatXp.ts`** — XP allocation rules: how much of dealt damage goes to which skills based on the active style.
- **`SpellXpProvider.ts`** — XP per spell cast.

## Players and followers

- **`PlayerCombatManager.ts`** — per-player combat orchestration. Takes an engagement, runs the state machine, emits hits.
- **`FollowerCombatManager`** (`server/src/game/followers/FollowerCombatManager.ts`) — analogous manager for pets/summons. Not inside `combat/` because followers have their own state directory.

## NPC combat

- **`NpcCombatAI.ts`** — the default NPC combat AI. Used for all NPCs that don't specify their own AI.
- **`BossScriptFramework.ts`** — framework for scripted boss encounters with custom phases, attack rotations, and mechanics.

## Rules and multi-combat

- **`CombatRules.ts`** — general rules: "can this player attack this NPC?", "can this player attack this player?", combat level requirements, wilderness requirements.
- **`MultiCombatZones.ts`** — which tiles are multi-combat. Derived from a world region table loaded at boot.

## Damage tracking

- **`DamageTracker.ts`** — per-NPC record of damage dealt by each player/follower. Used at death time to allocate drops.
- **`lootConfigResolver`** — set by the gamemode at boot (see [20.1](./01-startup.md)). Called by `DamageTracker` to decide how to split loot when multiple players contributed.

## Degradation

- **`DegradationSystem.ts`** — items that degrade with use (barrows armor, etc.). Tracks charges per item and handles degradation events.

## `index.ts`

Barrel export. Consumers do `import { PlayerCombatManager } from '@/game/combat'` rather than poking at individual files.

## The flow of a single hit

Tick N, combat phase:

```
1. For each engaged attacker in the registry:
   1a. CombatStateMachine.advance() — moves state machine, returns action
   1b. If action === ATTACK_NOW:
       - Load formulas: CombatFormulaProvider + EquipmentBonusProvider
       - Compute hit chance and max hit
       - Roll a CombatEffect (damage, miss, special proc)
       - CombatEffectApplicator.apply() — damage target, pull XP, trigger on-hit effects
       - Queue hitsplat + animation via appropriate service
       - DamageTracker.record(attacker, target, damage)
       - Set attacker cooldown
2. deathPhase:
   - For each actor with hp <= 0:
     - Run death script (drops, respawn schedule)
     - DamageTracker.distributeLoot() for the killed NPC
```

Throughout, the tick frame collects:

- Hitsplats to send in the player/NPC sync payload.
- XP deltas to send in the skill update packet.
- Animation changes.
- Sound effects to play.

These aren't sent immediately — the broadcast phase of the _next_ tick sends them.

## Extensibility

Gamemodes can swap any of the providers via `providerRegistry.register('combatFormula', myFormula)`. The default provider is registered at boot; the gamemode's registration overrides it.

Custom NPC AI is installed by registering a boss script in the gamemode's boot hook that hooks into `BossScriptFramework`.

New special attacks are added via `SpecialAttackProvider.registerSpecial(itemId, handler)`.

See [50 — Gamemodes and scripts](../50-gamemodes-scripts/index.md) for the full extensibility surface.

---

## Canonical facts

- **Engagement registry**: `server/src/game/combat/CombatEngagementRegistry.ts`.
- **State machine**: `server/src/game/combat/CombatStateMachine.ts`.
- **Integration**: `server/src/game/combat/CombatIntegration.ts`.
- **Player combat manager**: `server/src/game/combat/PlayerCombatManager.ts`.
- **Formula provider**: `server/src/game/combat/CombatFormulaProvider.ts`.
- **Equipment bonuses**: `server/src/game/combat/EquipmentBonusProvider.ts`.
- **Weapon data**: `server/src/game/combat/WeaponDataProvider.ts`.
- **Special attacks**: `server/src/game/combat/SpecialAttackProvider.ts`.
- **Combat XP**: `server/src/game/combat/CombatXp.ts`.
- **Damage tracker**: `server/src/game/combat/DamageTracker.ts`.
- **Rules**: `server/src/game/combat/CombatRules.ts`.
- **NPC AI**: `server/src/game/combat/NpcCombatAI.ts`.
- **Boss framework**: `server/src/game/combat/BossScriptFramework.ts`.
- **Degradation**: `server/src/game/combat/DegradationSystem.ts`.
- **Effect applicator**: `server/src/game/combat/CombatEffectApplicator.ts`.
- **Barrel export**: `server/src/game/combat/index.ts`.
