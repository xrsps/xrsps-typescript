# 70.7 — Custom widget modal

Build a "Daily reward" modal from scratch: a custom widget group that shows a title, a message, and a Claim button. The button rewards the player with a stackable item once per login.

## Goal

- New custom widget group id: `60001`.
- Components: frame, title text, body text, claim button, close button.
- On Claim: the server grants the item, updates the widget text to "Claimed!", and closes the modal after a short delay.
- On Close: dismiss the widget.

## Directory layout

```
server/extrascripts/daily-reward/
├── index.ts
└── widget/
    └── dailyReward.widget.ts
```

## `widget/dailyReward.widget.ts`

This file builds the widget group definition. Each widget component is a record with an id, type, bounds, flags, and optional data.

```ts
import type { WidgetGroup } from "../../../src/game/scripts/CustomWidgetRegistry";

export const DAILY_REWARD_GROUP_ID = 60001;

export const COMPONENT_FRAME = 1;
export const COMPONENT_TITLE = 2;
export const COMPONENT_BODY = 3;
export const COMPONENT_CLAIM = 4;
export const COMPONENT_CLOSE = 5;

export function buildDailyRewardWidgetGroup(): WidgetGroup {
    return {
        id: DAILY_REWARD_GROUP_ID,
        components: [
            {
                id: COMPONENT_FRAME,
                type: "layer",
                x: 180, y: 120, width: 280, height: 180,
                data: { background: 0x222222 },
            },
            {
                id: COMPONENT_TITLE,
                type: "text",
                x: 200, y: 130, width: 240, height: 24,
                data: { text: "Daily Reward", fontId: 496, color: 0xffffff, centered: true },
            },
            {
                id: COMPONENT_BODY,
                type: "text",
                x: 200, y: 160, width: 240, height: 64,
                data: { text: "You have a reward waiting.", fontId: 494, color: 0xcccccc, centered: true },
            },
            {
                id: COMPONENT_CLAIM,
                type: "button",
                x: 210, y: 240, width: 100, height: 28,
                ops: ["Claim"],
                flags: { clickable: true, opIndex: 1 },
                data: { text: "Claim", fontId: 496, color: 0x00ff00 },
            },
            {
                id: COMPONENT_CLOSE,
                type: "button",
                x: 330, y: 240, width: 100, height: 28,
                ops: ["Close"],
                flags: { clickable: true, opIndex: 1 },
                data: { text: "Close", fontId: 496, color: 0xff8888 },
            },
        ],
    };
}
```

> The exact shape of `WidgetGroup` depends on the CustomWidgetRegistry's type definition. The snippet above is illustrative — read `server/src/game/scripts/CustomWidgetRegistry.ts` for the authoritative field list. The worked example in `server/extrascripts/item-spawner/widget/itemSpawner.cs2.ts` is a production-grade reference.

## `index.ts`

```ts
import { CustomWidgetRegistry } from "../../src/game/scripts/CustomWidgetRegistry";
import type { IScriptRegistry, ScriptServices } from "../../src/game/scripts/types";
import {
    DAILY_REWARD_GROUP_ID,
    COMPONENT_BODY,
    COMPONENT_CLAIM,
    COMPONENT_CLOSE,
    buildDailyRewardWidgetGroup,
} from "./widget/dailyReward.widget";

const DAILY_REWARD_ITEM_ID = 995; // Coins
const DAILY_REWARD_AMOUNT = 10000;

let registered = false;
let handles: { unregister: () => void }[] = [];

function computeUid(groupId: number, componentId: number): number {
    return ((groupId & 0xffff) << 16) | (componentId & 0xffff);
}

function setBodyText(services: ScriptServices, playerId: number, text: string): void {
    services.dialog.queueWidgetEvent?.(playerId, {
        action: "set_text",
        uid: computeUid(DAILY_REWARD_GROUP_ID, COMPONENT_BODY),
        text,
    });
}

function closeWidget(services: ScriptServices, playerId: number): void {
    services.dialog.queueWidgetEvent?.(playerId, {
        action: "close",
        groupId: DAILY_REWARD_GROUP_ID,
    });
}

function ensureRegistered(): void {
    if (registered) return;
    registered = true;
    CustomWidgetRegistry.register(buildDailyRewardWidgetGroup());
}

export function register(registry: IScriptRegistry, services: ScriptServices): void {
    ensureRegistered();

    for (const h of handles) h.unregister();
    handles = [];

    // Open the widget on login.
    handles.push(
        registry.registerTickHandler((ctx) => {
            for (const player of ctx.players) {
                if (player.__claimedThisLogin) continue;
                // Mark so we don't re-open every tick.
                (player as any).__claimedThisLogin = true;
                services.dialog.queueWidgetEvent?.(player.playerId, {
                    action: "open",
                    groupId: DAILY_REWARD_GROUP_ID,
                    modal: true,
                });
            }
        }),
    );

    // Claim button handler.
    handles.push(
        registry.registerWidgetAction({
            widgetId: DAILY_REWARD_GROUP_ID,
            handler: async (ctx, event) => {
                if (event.componentId === COMPONENT_CLAIM) {
                    const { added } = ctx.services.inventory.addItem(
                        ctx.player,
                        DAILY_REWARD_ITEM_ID,
                        DAILY_REWARD_AMOUNT,
                    );
                    if (added === 0) {
                        setBodyText(ctx.services, ctx.player.playerId, "Your inventory is full!");
                        return;
                    }
                    setBodyText(
                        ctx.services,
                        ctx.player.playerId,
                        `Claimed ${added} coins!`,
                    );
                    await ctx.queueDelay(2);
                    closeWidget(ctx.services, ctx.player.playerId);
                    return;
                }

                if (event.componentId === COMPONENT_CLOSE) {
                    closeWidget(ctx.services, ctx.player.playerId);
                }
            },
        }),
    );
}
```

## What's happening

1. **Widget group built in TypeScript** — each component is a record describing its position, visual properties, and op flags.
2. **Registered once on extrascript load** — `CustomWidgetRegistry.register(...)`.
3. **Opened on login** — a tick handler checks each player once and opens the modal. (A real implementation would check a last-claim timestamp rather than a per-session flag.)
4. **Button clicks handled via `registerWidgetAction`** — the handler dispatches on `event.componentId` to route Claim vs Close.
5. **Widget updates use `services.dialog.queueWidgetEvent(...)`** — this funnels into the widget broadcaster, which eventually sends `WIDGET_SET_TEXT` / `WIDGET_CLOSE` packets to the client.

## Verify

1. `bun run dev`.
2. Log in fresh.
3. The modal should appear. Click **Claim**. The body text changes to "Claimed 10000 coins!" and the modal closes after ~1200 ms (two ticks).
4. Check inventory — 10000 coins should be there.

## Caveats

- The snippet references `WidgetGroup`, `queueWidgetEvent`, and the exact component field shapes from memory. Before copy-pasting, open `server/src/game/scripts/CustomWidgetRegistry.ts` and `server/extrascripts/item-spawner/` to match the real type definitions in your checkout.
- Using a tick handler to open widgets on login is coarse. A cleaner approach is the gamemode's `onPlayerLogin` hook — but that's gamemode-scoped, not extrascript-scoped. For extrascripts, the "event bus + playerLogin event" path in `GameEventBus` is the proper pattern.

## Canonical facts

- **Custom widget registry**: `server/src/game/scripts/CustomWidgetRegistry.ts`.
- **UID packing**: `((groupId & 0xffff) << 16) | (componentId & 0xffff)`.
- **Widget action registration**: `registry.registerWidgetAction({ widgetId, opId, option, handler })`.
- **Widget event shapes**: `open`, `close`, `set_text`, `set_hidden`, `set_item`, `set_flags`, `run_script`, etc.
- **Example reference**: `server/extrascripts/item-spawner/`.
