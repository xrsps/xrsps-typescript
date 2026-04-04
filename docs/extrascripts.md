# Extrascripts

Extrascripts are **optional content modules** that work independently of which gamemode is running. They're for universal functionality — things like debug tools, admin commands, or content that applies to any server.

Extrascripts live in `server/extrascripts/{id}/` and implement the `ScriptModule` interface.

## Example

```typescript
export const module: ScriptModule = {
    id: "extrascript.item-spawner",
    register(registry, services) {
        registry.registerCommand("itemspawner", (event) => { ... });
        registry.registerItemAction(ITEM_ID, (event) => { ... });
    }
};
```

Extrascripts are discovered and loaded automatically at startup. They can register commands, item actions, NPC interactions, loc interactions, and more through the `ScriptRegistry`.

## Gamemodes vs Extrascripts

| Use case | System |
|----------|--------|
| Server-specific rules (XP rates, tutorials, progression) | [Gamemode](/gamemodes) |
| Universal content (skills, tools, admin commands) | Extrascript |
| Content that only matters for one gamemode | Gamemode scripts folder |

## Migration

The built-in `server/src/game/scripts/modules/` folder currently holds ~46 modules covering core OSRS content (skills, banking, shops, doors, UI panels, etc.). This content is **being migrated** into gamemodes and extrascripts.

The long-term goal is for the core engine to ship with no content — gamemodes bring the rules, extrascripts bring the shared functionality, and the engine just runs them.
