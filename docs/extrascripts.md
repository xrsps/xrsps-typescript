# Extrascripts

Extrascripts are **optional content modules** that work independently of which gamemode is running. They're for universal functionality — things like debug tools, admin commands, or content that applies to any server.

Extrascripts live in `server/extrascripts/{id}/` and export a `register` function.

## Example

```typescript
import type { IScriptRegistry, ScriptServices } from "../../src/game/scripts/types";

export function register(registry: IScriptRegistry, services: ScriptServices): void {
    registry.registerCommand("itemspawner", (event) => { ... });
    registry.registerItemAction(ITEM_ID, (event) => { ... });
}
```

Extrascripts are discovered and loaded automatically at startup. They can register commands, item actions, NPC interactions, loc interactions, and more through the `IScriptRegistry`.

## Gamemodes vs Extrascripts

| Use case | System |
|----------|--------|
| Server-specific rules (XP rates, tutorials, progression) | [Gamemode](gamemodes.md) |
| Universal content (skills, tools, admin commands) | Extrascript |
| Content that only matters for one gamemode | Gamemode `registerHandlers()` |

## Skill Packs

The `vanilla-skills` extrascript is a content pack containing all standard OSRS skill implementations. Gamemodes that want OSRS skills get them through this pack. Custom content servers that don't want traditional skills simply remove or don't include it.

Skills register their own action handlers via `registerActionHandler`, making them fully self-contained — the engine has no hardcoded knowledge of any skill's logic. The action dispatch falls through to registered handlers for any action kind not built into the engine.

```
server/extrascripts/vanilla-skills/
├── index.ts                 # Pack root (aggregates sub-module register calls)
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
