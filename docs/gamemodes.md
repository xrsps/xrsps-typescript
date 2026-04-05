# Gamemodes

A gamemode defines the **identity of a server**. It controls the rules, progression, and feel of the game. Each server runs exactly one gamemode.

Gamemodes live in `server/gamemodes/{id}/` and export a `createGamemode()` function that returns a `GamemodeDefinition`.

## What a gamemode controls

- XP multipliers and drop rates
- Spawn location
- Tutorial flow
- Player initialization and serialization
- Per-tick hooks and interaction restrictions
- Handler registration (banking, shops, equipment, UI widgets, content interactions)
- Custom items and content

## Current gamemodes

| Gamemode | Description |
|----------|-------------|
| `vanilla` | Baseline OSRS — banking, shops, equipment, all UI widgets, core content |
| `leagues-v` | Raging Echoes — extends vanilla with area unlocks, relics, masteries, and tasks |

## Structure

```
server/gamemodes/vanilla/
├── index.ts                    # VanillaGamemode class
├── banking/                    # BankingManager + handler registration
├── equipment/                  # Equipment actions + widget handlers
├── shops/                      # ShopManager + widget handlers
├── scripts/
│   ├── content/                # Climbing, doors, al-kharid border, etc.
│   └── items/                  # Followers, packs
└── widgets/                    # Combat, prayer, spellbook, minimap, etc.

server/gamemodes/leagues-v/
├── index.ts                    # LeaguesVGamemode (extends VanillaGamemode)
├── scripts/                    # League tutor, league widgets, tutorial widgets
├── data/                       # Mastery/task definitions
└── ...
```

## Handler Registration

Gamemodes register interaction handlers directly via `registerHandlers()`:

```typescript
export class VanillaGamemode implements GamemodeDefinition {
    registerHandlers(registry: IScriptRegistry, services: ScriptServices): void {
        registerBankingHandlers(registry, services);
        registerEquipmentHandlers(registry, services);
        registerClimbingHandlers(registry, services);
        // ...
    }
}
```

Gamemodes that extend another call `super.registerHandlers()` to inherit the parent's handlers:

```typescript
export class LeaguesVGamemode extends VanillaGamemode {
    override registerHandlers(registry: IScriptRegistry, services: ScriptServices): void {
        super.registerHandlers(registry, services);
        registerLeagueTutorHandlers(registry, services);
        registerLeagueWidgetHandlers(registry, services);
    }
}
```

## Service Providers

Gamemodes can create stateful managers and expose them to handlers via `contributeScriptServices()`:

```typescript
initialize(context: GamemodeInitContext): void {
    this.bankingManager = new BankingManager(context.serverServices);
    this.shopManager = new ShopManager({ ... });
}

contributeScriptServices(services: ScriptServices): void {
    services.openBank = (player, opts) => this.bankingManager.openBank(player, opts);
    services.openShop = (player, opts) => this.openShopInterface(player, opts);
}
```
