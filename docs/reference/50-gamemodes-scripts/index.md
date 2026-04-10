# 50 — Gamemodes & scripts

XRSPS has two complementary extension systems on the server side:

- **Gamemodes** — a whole-world rule set. Vanilla OSRS, Leagues, Deadman, etc. Exactly one gamemode is loaded at server boot; it's not hot-swappable.
- **Extrascripts** — opt-in per-feature plugins that add scripted content (NPCs, locs, items, widgets, chat commands) without forking the vanilla gamemode. Multiple can be loaded at once and they can be hot-reloaded in dev.

Both hook into the same `ScriptRegistry` on the server — the main difference is lifecycle.

This section covers:

| Page | Topic |
|---|---|
| [01 — Gamemode API](./01-gamemode-api.md) | `GamemodeDefinition`, `GamemodeBridge`, provider overrides |
| [02 — Script registry](./02-script-registry.md) | `ScriptRegistry` API, handler signatures, wildcard ids |
| [03 — Extrascripts](./03-extrascripts.md) | Extrascript anatomy, loader, hot reload |
| [04 — Custom widgets](./04-custom-widgets.md) | `CustomWidgetRegistry`, the widget/ folder |
| [05 — Built-in gamemodes](./05-builtin-gamemodes.md) | Vanilla and leagues-v |
| [06 — Content data files](./06-content-data.md) | Shared patterns for JSON content |

## Where everything lives

```
server/src/game/gamemodes/     ← gamemode framework + built-ins
server/src/game/scripts/       ← script registry, runtime, types
server/data/gamemodes/<id>/    ← per-gamemode data dir (shops, drops, spawns)
server/extrascripts/           ← opt-in per-feature plugins
```

## Rule of thumb

If the thing you want to add is "everyone on the server should experience this differently" (e.g. all XP gains are 5x, or every NPC drops a new item), it belongs in a gamemode. If it's "I want Hans in Lumbridge to greet players by name" or "I want a spawn-item command for admins", it belongs in an extrascript.
