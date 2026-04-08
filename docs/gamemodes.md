# Gamemodes

A gamemode defines the **identity of a server**. It controls the rules, progression, and feel of the game. Each server runs exactly one gamemode.

Gamemodes live in `server/gamemodes/{id}/` and export a `createGamemode()` function that returns a `GamemodeDefinition`.

## What a gamemode controls

- XP multipliers and drop rates
- Spawn location and tutorial flow
- Player initialization and state serialization
- Login handshake (varps, varbits, feature flags)
- Per-tick hooks and interaction restrictions
- Handler registration (banking, shops, equipment, UI widgets, content interactions)
- Display name formatting and chat player types
- Custom content data packets
- Service providers exposed to script handlers

## Inheritance Chain

```
BaseGamemode (abstract — sensible OSRS defaults, no content)
  └─ VanillaGamemode (full OSRS — banking, shops, combat, skills, widgets)
       └─ LeaguesVGamemode (league tasks, relics, area unlocks, tutorial)
       └─ YourGamemode (your customizations on top of vanilla)
```

There are two paths for creating a gamemode:

| Base class | When to use |
|-----------|-------------|
| `BaseGamemode` | Building from scratch. You get valid defaults but no content — no banking, no shops, no skills. Suitable for minigame servers or highly custom experiences. |
| `VanillaGamemode` | Most common. You inherit the full OSRS experience and override what you need. This is what Leagues V does. |

## Current gamemodes

| Gamemode | Base | Description |
|----------|------|-------------|
| `vanilla` | `BaseGamemode` | Baseline OSRS — banking, shops, equipment, combat, all skills, all UI widgets, core content interactions |
| `leagues-v` | `VanillaGamemode` | Raging Echoes — area unlocks, relics, masteries, tasks, league tutorial, custom XP/drop rates |

## Creating a Gamemode

### Minimal example (extending BaseGamemode)

```typescript
// server/gamemodes/my-gamemode/index.ts
import { BaseGamemode } from "../../src/game/gamemodes/BaseGamemode";
import type { GamemodeDefinition } from "../../src/game/gamemodes/GamemodeDefinition";

class MyGamemode extends BaseGamemode {
    readonly id = "my-gamemode";
    readonly name = "My Gamemode";

    override getSkillXpMultiplier(): number {
        return 5; // 5x XP
    }
}

export function createGamemode(): GamemodeDefinition {
    return new MyGamemode();
}
```

This gives you a working gamemode with 5x XP and all other OSRS defaults (Lumbridge spawn, no tutorial, standard drop rates). It won't have banking, shops, or skills — you'd register those yourself.

### Extending VanillaGamemode (recommended)

```typescript
// server/gamemodes/my-gamemode/index.ts
import { VanillaGamemode } from "../vanilla/index";
import type { GamemodeDefinition } from "../../src/game/gamemodes/GamemodeDefinition";
import type { PlayerState } from "../../src/game/player";
import type { IScriptRegistry, ScriptServices } from "../../src/game/scripts/types";
import type { GamemodeInitContext } from "../../src/game/gamemodes/GamemodeDefinition";

class MyGamemode extends VanillaGamemode {
    override readonly id = "my-gamemode";
    override readonly name = "My Gamemode";

    override getSkillXpMultiplier(): number {
        return 10;
    }

    override getDropRateMultiplier(): number {
        return 3;
    }

    override hasInfiniteRunEnergy(): boolean {
        return true;
    }

    override registerHandlers(registry: IScriptRegistry, services: ScriptServices): void {
        super.registerHandlers(registry, services); // inherit all vanilla handlers
        // register your own handlers here
    }

    override initialize(context: GamemodeInitContext): void {
        super.initialize(context); // initialize vanilla systems (combat, banking, shops, etc.)
        // initialize your own systems here
    }
}

export function createGamemode(): GamemodeDefinition {
    return new MyGamemode();
}
```

This gives you the full vanilla experience (banking, shops, equipment, skills, combat, all UI) with 10x XP, 3x drop rates, and infinite run energy.

### Running your gamemode

Set the gamemode ID in your server configuration. The `GamemodeRegistry` discovers gamemodes by scanning `server/gamemodes/` for directories containing an `index.ts` or `index.js`.

## Structure

```
server/gamemodes/vanilla/
├── index.ts                    # VanillaGamemode class (extends BaseGamemode)
├── banking/                    # BankingManager + handler registration
├── combat/                     # Combat formulas, special attacks, equipment bonuses
├── data/                       # Weapons, spells, runes, projectiles, login defaults
├── equipment/                  # Equipment actions + widget handlers
├── shops/                      # ShopManager + widget handlers
├── skills/                     # All skill implementations (mining, fishing, etc.)
├── scripts/
│   ├── content/                # Climbing, doors, al-kharid border, etc.
│   ├── items/                  # Followers, packs
│   └── levelup.ts              # Level-up display
├── modals/                     # Widget open/close handlers, smithing modal
└── widgets/                    # Combat, prayer, spellbook, minimap, settings, etc.

server/gamemodes/leagues-v/
├── index.ts                    # LeaguesVGamemode (extends VanillaGamemode)
├── LeagueContentProvider.ts    # Custom content data packet
├── LeagueTaskManager.ts        # Task completion tracking
├── LeagueTaskService.ts        # Task progress helpers
├── LeaguesVUiController.ts     # League-specific UI controller
├── scripts/                    # League tutor, league widgets, tutorial widgets
├── data/                       # Task/mastery/relic definitions, custom items
└── ...
```

## Handler Registration

Gamemodes register interaction handlers via `registerHandlers()`. The `IScriptRegistry` supports 86+ handler types including NPC interactions, loc interactions, item actions, widget buttons, commands, and more.

```typescript
override registerHandlers(registry: IScriptRegistry, services: ScriptServices): void {
    super.registerHandlers(registry, services); // inherit parent handlers
    registerMyNpcHandlers(registry, services);
    registerMyWidgetHandlers(registry, services);
}
```

Handlers registered by the gamemode run first. Extrascript handlers are loaded after.

## Service Providers

Gamemodes can create stateful managers and expose them to script handlers via `contributeScriptServices()`:

```typescript
override initialize(context: GamemodeInitContext): void {
    super.initialize(context);
    this.bankingManager = new BankingManager(context.serverServices);
}

contributeScriptServices(services: ScriptServices): void {
    services.banking = {
        openBank: (player, opts) => this.bankingManager.openBank(player, opts),
        // ...
    };
}
```

Handlers then access these via `services.banking.openBank(player)` without knowing about the underlying manager.

## Global Providers

VanillaGamemode registers 13 global data providers during `initialize()` that power the core combat and spell systems. Each provider is a singleton registered via a `registerXxxProvider()` function — the last call wins, so you can replace any provider after `super.initialize()`.

| Provider | Create function | Source file |
|----------|----------------|-------------|
| `CombatFormulaProvider` | `createCombatFormulaProvider()` | `vanilla/combat/CombatFormulas.ts` |
| `WeaponDataProvider` | `createWeaponDataProvider()` | `vanilla/data/weapons.ts` |
| `SpecialAttackProvider` | `createSpecialAttackProvider()` | `vanilla/combat/SpecialAttackRegistry.ts` |
| `EquipmentBonusProvider` | `createEquipmentBonusProvider()` | `vanilla/combat/EquipmentBonuses.ts` |
| `SpellDataProvider` | `createSpellDataProvider()` | `vanilla/data/spells.ts` |
| `SpellXpProvider` | `createSpellXpProvider()` | `vanilla/combat/SpellXpData.ts` |
| `RuneDataProvider` | `createRuneDataProvider()` | `vanilla/data/runes.ts` |
| `ProjectileParamsProvider` | `createProjectileParamsProvider()` | `vanilla/data/projectileParams.ts` |
| `SkillConfigurationProvider` | `createSkillConfiguration()` | `vanilla/combat/SkillConfiguration.ts` |
| `CombatStyleSequenceProvider` | `createCombatStyleSequenceProvider()` | `vanilla/combat/CombatStyleSequences.ts` |
| `SpecialAttackVisualProvider` | `createSpecialAttackVisualProvider()` | `vanilla/combat/SpecialAttackVisuals.ts` |
| `InstantUtilitySpecialProvider` | `createInstantUtilitySpecialProvider()` | `vanilla/combat/RockKnockerSpecial.ts` |
| `AmmoDataProvider` | `createDefaultAmmoDataProvider()` | `server/src/game/combat/AmmoSystem.ts` |

Gamemodes extending VanillaGamemode inherit all of these via `super.initialize()`. Gamemodes extending BaseGamemode directly must register their own providers if they need combat.

### Customizing a provider

To override a specific provider while keeping the rest, call `super.initialize()` then re-register just the one you want to change. The last `register` call wins.

**Replace entirely** — write your own implementation of the interface:

```typescript
override initialize(context: GamemodeInitContext): void {
    super.initialize(context); // registers all 13 vanilla providers

    // Replace combat formulas with custom ones
    const { registerCombatFormulaProvider } = require("../../src/game/combat/CombatFormulaProvider");
    registerCombatFormulaProvider({
        maxHit: (player, target) => 99,  // everyone hits 99s
        hitChance: () => 1.0,            // never miss
        // ... implement remaining CombatFormulaProvider methods
    });
}
```

**Wrap vanilla's provider** — import the create function, spread it, and override specific methods:

```typescript
override initialize(context: GamemodeInitContext): void {
    super.initialize(context);

    const { createCombatFormulaProvider } = require("../vanilla/combat/CombatFormulas");
    const { registerCombatFormulaProvider } = require("../../src/game/combat/CombatFormulaProvider");

    const base = createCombatFormulaProvider();
    registerCombatFormulaProvider({
        ...base,
        maxHit: (player, target) => base.maxHit(player, target) * 2, // double max hit
    });
}
```

**Reuse vanilla providers from BaseGamemode** — if you extend BaseGamemode but still want standard OSRS combat:

```typescript
override initialize(context: GamemodeInitContext): void {
    // No super.initialize() — BaseGamemode's is a no-op

    // Cherry-pick the providers you need
    const { createCombatFormulaProvider } = require("../vanilla/combat/CombatFormulas");
    const { registerCombatFormulaProvider } = require("../../src/game/combat/CombatFormulaProvider");
    registerCombatFormulaProvider(createCombatFormulaProvider());

    const { createWeaponDataProvider } = require("../vanilla/data/weapons");
    const { registerWeaponDataProvider } = require("../../src/game/combat/WeaponDataProvider");
    registerWeaponDataProvider(createWeaponDataProvider());

    // ... register only the providers you need
}
```

### Provider lifecycle

Providers are cleaned up when `dispose()` is called on the gamemode. VanillaGamemode's `dispose()` calls `resetProviderRegistry()` which clears all providers at once. If your gamemode extends VanillaGamemode, call `super.dispose()` at the end of your own `dispose()`:

```typescript
override dispose(): void {
    // Clean up your own state first
    this.myManager = undefined;
    super.dispose(); // resets all providers
}
```

## GamemodeDefinition Interface

The full interface is defined in `server/src/game/gamemodes/GamemodeDefinition.ts`. Required methods that BaseGamemode provides defaults for:

| Method | Default |
|--------|---------|
| `getSkillXpMultiplier()` | `1` |
| `getDropRateMultiplier()` | `1` |
| `isDropBoostEligible()` | `false` |
| `transformDropItemId()` | passthrough |
| `hasInfiniteRunEnergy()` | `false` |
| `canInteract()` | `true` |
| `initializePlayer()` | no-op |
| `serializePlayerState()` | `undefined` |
| `deserializePlayerState()` | no-op |
| `onNpcKill()` | no-op |
| `isTutorialActive()` | `false` |
| `getSpawnLocation()` | Lumbridge (3222, 3218, 0) |
| `onPlayerHandshake()` | no-op |
| `onPlayerLogin()` | no-op |
| `getDisplayName()` | passthrough |
| `getChatPlayerType()` | `0` |
| `registerHandlers()` | no-op |
| `initialize()` | no-op |

Optional hooks (not required, return `undefined` if absent):

`getDefaultSkillXp`, `getSkillXpAward`, `getDropTable`, `getSupplementalDrops`, `getLootDistributionConfig`, `canInteractWithNpc`, `onItemCraft`, `getLoginVarbits`, `getLoginVarps`, `isTutorialPreStart`, `onPlayerRestore`, `onPostDesignComplete`, `resolveAccountStage`, `onVarpTransmit`, `onWidgetOpen`, `onResumePauseButton`, `onPlayerTick`, `onPlayerDisconnect`, `getGamemodeServices`, `contributeScriptServices`, `createUiController`, `getContentDataPacket`, `dispose`
