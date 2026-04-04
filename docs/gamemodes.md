# Gamemodes

A gamemode defines the **identity of a server**. It controls the rules, progression, and feel of the game. Each server runs exactly one gamemode.

Gamemodes live in `server/gamemodes/{id}/` and export a `createGamemode()` function that returns a `GamemodeDefinition`.

## What a gamemode controls

- XP multipliers and drop rates
- Spawn location
- Tutorial flow
- Player initialization and serialization
- Per-tick hooks and interaction restrictions
- Which scripts to load
- Custom items and content

## Current gamemodes

| Gamemode | Description |
|----------|-------------|
| `vanilla` | Baseline OSRS with no modifications |
| `leagues-v` | Raging Echoes — area unlocks, relics, masteries, and tasks |

## Structure

A typical gamemode looks like:

```
server/gamemodes/leagues-v/
├── index.ts                    # createGamemode() entry point
├── scripts/                    # Gamemode-specific scripts
│   ├── leagueTutor.ts
│   ├── leagueWidgets.ts
│   └── leagueTutorialWidgets.ts
├── data/                       # Gamemode-specific data
│   ├── leagueMasteries.data.ts
│   └── leagueTasks.data.ts
└── ...
```

The `index.ts` extends a base (usually `VanillaGamemode`) and overrides the hooks it needs:

```typescript
export function createGamemode(): GamemodeDefinition {
    return {
        getSkillXpMultiplier(player) { ... },
        getDropRateMultiplier() { ... },
        initializePlayer(player) { ... },
        getSpawnLocation(player) { ... },
        getScriptManifest() { ... },
        // ...
    };
}
```
