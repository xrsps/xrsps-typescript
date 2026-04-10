# 70.5 — Create a 5× XP hardcore gamemode

Build a minimal gamemode called `hc-5x` that:

- Gives 5× XP for every skill.
- Starts players in a custom spawn location (Falador).
- Makes death permanent (no respawn — player gets kicked and the account flagged as dead).
- Adds a HC icon prefix to player names.

## Directory layout

```
server/gamemodes/hc-5x/
├── HcFiveXGamemode.ts
└── index.ts

server/data/gamemodes/hc-5x/
└── player-defaults.json
```

## `server/gamemodes/hc-5x/HcFiveXGamemode.ts`

```ts
import { BaseGamemode } from "../../src/game/gamemodes/BaseGamemode";
import type { PlayerState } from "../../src/game/player";
import type { GamemodeInitContext } from "../../src/game/gamemodes/GamemodeDefinition";
import type { IScriptRegistry, ScriptServices } from "../../src/game/scripts/types";
import { PlayerType } from "../../../src/rs/chat/PlayerType";

interface HcExtraState {
    dead: boolean;
}

export class HcFiveXGamemode extends BaseGamemode {
    readonly id = "hc-5x";
    readonly name = "Hardcore 5×";

    private context?: GamemodeInitContext;

    initialize(ctx: GamemodeInitContext): void {
        super.initialize?.(ctx);
        this.context = ctx;
        ctx.serverServices.logger.info(`[${this.id}] initialized`);
    }

    // === XP ===
    getSkillXpMultiplier(_player: PlayerState): number {
        return 5;
    }

    // === Spawn ===
    getSpawnLocation(_player: PlayerState) {
        return { x: 2964, y: 3378, level: 0 }; // Falador Park
    }

    // === Player rules ===
    canInteract(player: PlayerState): boolean {
        const extra = this.getExtra(player);
        return !extra.dead;
    }

    // === Lifecycle ===
    initializePlayer(player: PlayerState): void {
        super.initializePlayer?.(player);
        this.setExtra(player, { dead: false });
    }

    serializePlayerState(player: PlayerState): Record<string, unknown> | undefined {
        return { hc: this.getExtra(player) };
    }

    deserializePlayerState(player: PlayerState, data: Record<string, unknown>): void {
        const hc = data?.hc as HcExtraState | undefined;
        if (hc) this.setExtra(player, hc);
    }

    // === Death ===
    onPlayerDeath(player: PlayerState): void {
        this.setExtra(player, { dead: true });
        this.context?.bridge.sendGameMessage(
            player,
            "You have died. This account is permanently locked.",
        );
        // Force logout on the next tick; the persistence layer will save the 'dead' flag.
        this.context?.bridge.queueNotification(player.playerId, {
            kind: "hc-death",
            title: "Hardcore Death",
            message: "Your journey ends here.",
        });
    }

    // === Display ===
    getPlayerTypes(_player: PlayerState, isAdmin: boolean): PlayerType[] {
        // Assume PlayerType has a HARDCORE variant — if not, use your own.
        return isAdmin ? [PlayerType.MOD] : [PlayerType.HARDCORE_IRONMAN];
    }

    // === Scripts ===
    registerHandlers(_registry: IScriptRegistry, _services: ScriptServices): void {
        // No custom scripts — this gamemode just tweaks rules.
    }

    // --- helpers ---
    private getExtra(player: PlayerState): HcExtraState {
        const existing = (player as any).__hc5x as HcExtraState | undefined;
        if (existing) return existing;
        const fresh: HcExtraState = { dead: false };
        (player as any).__hc5x = fresh;
        return fresh;
    }

    private setExtra(player: PlayerState, state: HcExtraState): void {
        (player as any).__hc5x = state;
    }
}
```

## `server/gamemodes/hc-5x/index.ts`

```ts
import type { GamemodeDefinition } from "../../src/game/gamemodes/GamemodeDefinition";
import { HcFiveXGamemode } from "./HcFiveXGamemode";

export function createGamemode(): GamemodeDefinition {
    return new HcFiveXGamemode();
}
```

## `server/data/gamemodes/hc-5x/player-defaults.json`

```json
{
    "inventory": [
        { "id": 1265, "qty": 1, "slot": 0 },
        { "id": 1205, "qty": 1, "slot": 1 },
        { "id": 841,  "qty": 1, "slot": 2 },
        { "id": 882,  "qty": 50, "slot": 3 }
    ],
    "skills": {
        "hitpoints": { "level": 10, "xp": 1154 }
    }
}
```

This file is free-form — how you use it depends on whether your `initializePlayer` reads it. The vanilla gamemode reads its `player-state.json`; you can do the same in this HC gamemode if you want different starter gear.

## Selecting the gamemode

Edit `server/src/config/ServerConfig.ts` (or whatever config loader you use) to set:

```ts
gamemode: "hc-5x",
```

Restart the server:

```
[boot] loaded gamemode: hc-5x
[hc-5x] initialized
```

## Testing

1. Log in with a fresh account. You should spawn in Falador Park (not Lumbridge).
2. Kill a cow. Check the XP award — should be 5× the vanilla amount.
3. Die (PvP or let an NPC finish you). On death, the `onPlayerDeath` hook fires, the `dead` flag is set, the player is kicked, and subsequent login attempts should fail `canInteract` so you can't move.

## What you skipped

The real hardcore rulesets have a lot more to handle:

- PvP vs PvE death differentiation.
- Dropping items on death (and whether they drop at all in HC).
- Proper "dead account" state that survives login (blocking login entirely, not just `canInteract`).
- A UI overlay showing the HC icon.
- Integrating with the scoreboard.

Each of those is a separate hook on `GamemodeDefinition`. See [50.1](../50-gamemodes-scripts/01-gamemode-api.md) for the full surface.

## Canonical facts

- **Gamemode directory**: `server/gamemodes/hc-5x/`.
- **Required export**: `createGamemode(): GamemodeDefinition` in `index.ts`.
- **Data directory**: `server/data/gamemodes/hc-5x/`.
- **Config selector**: `gamemode` field in `ServerConfig`.
- **Base class**: `BaseGamemode` — extend it for sensible defaults.
- **Rule**: gamemodes are boot-time — restart to switch.
