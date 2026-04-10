# 50.2 — Script registry

`ScriptRegistry` is the central switchboard every piece of game content plugs into: "when a player clicks option X on NPC Y, run this function". Both gamemodes and extrascripts register handlers through the same `IScriptRegistry` interface (`server/src/game/scripts/types.ts`).

## The interface

Key registration methods, grouped by kind of event:

### NPC interactions

```ts
registry.registerNpcInteraction(
    npcId: number,
    handler: NpcInteractionHandler,
    option?: string,
): ScriptRegistrationResult;

registry.registerNpcScript(params: {
    npcId: number;
    handler: NpcInteractionHandler;
    option?: string;
}): ScriptRegistrationResult;

registry.registerNpcAction(
    option: string,       // global match on option name regardless of npc id
    handler: NpcInteractionHandler,
): ScriptRegistrationResult;
```

Match order:
1. Exact `(npcId, option)` — highest priority.
2. Exact `npcId` with unspecified option (`""`).
3. Global `registerNpcAction(option)` — matches any NPC with that option.

### Loc interactions

```ts
registry.registerLocInteraction(
    locId: number,           // or ANY_LOC_ID (-1)
    handler: LocInteractionHandler,
    action?: string,
): ScriptRegistrationResult;

registry.registerLocAction(
    action: string,
    handler: LocInteractionHandler,
): ScriptRegistrationResult;
```

`ANY_LOC_ID` (`-1`) matches every loc id — useful for action-based fallbacks ("any 'Open' option on any loc").

### Item interactions

```ts
registry.registerItemOnItem(
    srcItemId: number,                    // or ANY_ITEM_ID
    dstItemId: number,                    // or ANY_ITEM_ID
    handler: ItemOnItemHandler,
): ScriptRegistrationResult;

registry.registerItemOnLoc(
    itemId: number,
    locId: number,                        // or ANY_LOC_ID
    handler: ItemOnLocHandler,
): ScriptRegistrationResult;

registry.registerItemAction(
    option: string,
    handler: ItemOnItemHandler,
): ScriptRegistrationResult;

registry.registerEquipmentAction(
    itemId: number,
    handler: EquipmentActionHandler,
    option?: string,
): ScriptRegistrationResult;

registry.registerEquipmentOption(
    option: string,
    handler: EquipmentActionHandler,
): ScriptRegistrationResult;
```

### Widget interactions

```ts
registry.registerWidgetAction(params: {
    widgetId?: number;     // undefined = any widget
    opId?: number;
    option?: string;
    handler: WidgetActionHandler;
}): ScriptRegistrationResult;
```

Widgets match on `(widgetId, opId, option)`, any of which can be omitted to broaden the match.

### Chat commands

```ts
registry.registerCommand(
    name: string,           // e.g. "spawn"
    handler: CommandHandler,
): ScriptRegistrationResult;
```

The user types `::spawn abyssal_whip` — the chat handler sees the `::` prefix, splits on whitespace, and looks up `"spawn"` in the command map.

### Region, tick, client messages, actions

```ts
registry.registerRegionHandler(regionId, handler);
registry.registerTickHandler(handler);
registry.registerClientMessageHandler(messageKey, handler);
registry.registerActionHandler(actionName, handler);
```

## Handler signatures

Every handler receives a `ScriptExecutionContext`:

```ts
interface ScriptExecutionContext {
    player: PlayerState;
    services: ScriptServices;   // restricted view of ServerServices
    logger: Logger;
    scheduleAction(action: ScriptAction): void;
    queueDelay(ticks: number): Promise<void>;
    // ...
}
```

Handlers can be synchronous or async. If they return a `Promise` the runtime awaits it, which lets you write dialogue flows as linear code:

```ts
registry.registerNpcInteraction(HANS_ID, async (ctx, event) => {
    await ctx.dialogue.npc(HANS_ID, "Greetings. I have been working here for as long as I remember.");
    const choice = await ctx.dialogue.options([
        "Who are you?",
        "How long have you been here?",
        "Goodbye.",
    ]);
    // ...
}, "Talk-to");
```

The `dialogue` helper is exposed through `ScriptServices`. See [20.12 — Script runtime](../20-server/12-script-runtime.md) for the full services shape.

## Wildcards

Two reserved constants, both `-1`:

- `ANY_ITEM_ID` — matches any item id.
- `ANY_LOC_ID` — matches any loc id.

These are used for catch-all handlers. Example: register an `ANY_ITEM_ID × "bones"` handler to make any bone buriable without enumerating every bone type.

## Unregistering

Every `register*` call returns `{ unregister: () => void }`. The extrascript loader uses this on hot reload to clear a previous module's handlers before re-importing.

## Overwrite behavior

If two handlers register for the same exact key, the second one overwrites the first and the registry logs `[script] warning: overwriting ... handler for key "..."`. Watch the server log for these — silent overwrites are how content bugs creep in.

## Thread-safety

The registry is single-threaded. The tick loop is a single event loop, and registrations happen either at boot (inside `initialize`) or in response to client actions in the same loop. No locking needed.

## Non-reentrancy

`ScriptRuntime` dispatches one script action at a time for a given player. If a handler calls another handler via the player's action queue, that call is enqueued — it does not run synchronously. See [20.12 — Script runtime](../20-server/12-script-runtime.md).

## Canonical facts

- **Class**: `server/src/game/scripts/ScriptRegistry.ts`.
- **Interface + types**: `server/src/game/scripts/types.ts` (`IScriptRegistry`, `NpcInteractionHandler`, `LocInteractionHandler`, `ItemOnItemHandler`, `ItemOnLocHandler`, `EquipmentActionHandler`, `WidgetActionHandler`, `CommandHandler`, `RegionEventHandler`, `TickHandler`, `ScriptExecutionContext`, `ScriptServices`, `ANY_ITEM_ID`, `ANY_LOC_ID`).
- **Runtime**: `server/src/game/scripts/ScriptRuntime.ts`.
- **Bootstrap (vanilla content)**: `server/src/game/scripts/bootstrap.ts`.
- **Custom widgets**: `server/src/game/scripts/CustomWidgetRegistry.ts`.
- **Extrascript loader**: `server/src/game/scripts/ExtrascriptLoader.ts`.
- **Wildcard IDs**: `ANY_ITEM_ID = -1`, `ANY_LOC_ID = -1`.
