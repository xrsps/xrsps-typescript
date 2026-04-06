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
| Universal tools (debug commands, admin utilities) | Extrascript |
| Content that only matters for one gamemode | Gamemode `registerHandlers()` |

## Skill Implementations

Skill implementations are owned by the vanilla gamemode and registered via its `registerHandlers()` call. Gamemodes that extend vanilla (such as Leagues V) inherit all skill handlers through `super.registerHandlers()`.

Skills register their own action handlers via `registerActionHandler`, making them fully self-contained — the engine has no hardcoded knowledge of any skill's logic. The action dispatch falls through to registered handlers for any action kind not built into the engine.

```
server/gamemodes/vanilla/skills/
├── index.ts                 # Aggregates sub-module register calls
├── consumables/             # Food eating, potion drinking
├── crafting/                # Flax picking, spinning wheel
├── firemaking/              # Fire lighting
├── fishing/                 # Fishing spots, minnow exchange
├── fletching/               # Log cutting, bow stringing, arrow/bolt combining
├── herblore/                # Herb cleaning, potions, stamina
├── mining/                  # Rock mining
├── prayer/                  # Bone burying, ash scattering, altar offering
├── production/              # Cooking, tanning, bolt enchanting
├── sailing/                 # Sailing, pandemonium
├── smithing/                # Smithing, smelting
├── thieving/                # NPC pickpocketing, lock picking
└── woodcutting/             # Tree chopping
```
