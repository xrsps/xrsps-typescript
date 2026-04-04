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

## Skill Packs

The `vanilla-skills` extrascript is a content pack containing all standard OSRS skill implementations. Gamemodes that want OSRS skills get them through this pack. Custom content servers that don't want traditional skills simply remove or don't include it.

Skills register their own action handlers via `registerActionHandler`, making them fully self-contained — the engine has no hardcoded knowledge of any skill's logic. The action dispatch falls through to registered handlers for any action kind not built into the engine.

```
server/extrascripts/vanilla-skills/
├── index.ts                 # Pack root
├── consumables/             # Food eating, potion drinking
├── crafting/                # Flax picking, spinning wheel
├── firemaking/              # Fire lighting
├── fishing/                 # Fishing spots, minnow exchange
├── fletching/               # Log cutting, bow stringing, arrow/bolt combining
├── herblore/                # Herb cleaning, potions, stamina
├── mining/                  # Rock mining
├── prayer/                  # Bone burying, ash scattering, altar offering
├── production/              # Smithing, cooking, smelting, tanning, bolt enchanting
├── thieving/                # NPC pickpocketing, lock picking
└── woodcutting/             # Tree chopping
```

## Migration

The built-in `server/src/game/scripts/modules/` folder holds modules covering core OSRS content (banking, shops, doors, UI panels, etc.). Skills have been fully migrated into the `vanilla-skills` extrascript. The remaining content modules (banking, shops, equipment, UI widgets) are candidates for a future `vanilla-content` extrascript pack.

The long-term goal is for the core engine to ship with no content — gamemodes bring the rules, extrascripts bring the shared functionality, and the engine just runs them.
