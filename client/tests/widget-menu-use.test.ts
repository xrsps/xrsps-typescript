import assert from "node:assert/strict";

import { ClientState } from "../game/ClientState";
import { widgetEntriesToSimple } from "../ui/menu/MenuBridge";
import { MenuState } from "../ui/menu/MenuState";

ClientState.clearItemSelection();
ClientState.isSpellSelected = false;

let stateAtDispatch: { selected: number; itemId: number } | undefined;
let dispatched: any;
const menuState = new MenuState();
const [use] = widgetEntriesToSimple(
    [{ option: "Use", target: "Test item", widgetAction: { slot: 7, itemId: 4151 } }],
    {
        ui: {
            onWidgetAction: (event: any) => {
                stateAtDispatch = {
                    selected: ClientState.isItemSelected,
                    itemId: ClientState.selectedItemId,
                };
                dispatched = event;
            },
        },
        chosenWidget: { uid: 149 << 16, parentUid: 149 << 16, childIndex: 7, itemId: 4151 },
        scheduleRender: () => undefined,
        menuState,
    },
);

if (typeof use.menuStateIndex === "number") {
    menuState.invoke(use.menuStateIndex, 0, 0, { source: "menu" });
} else {
    use.onClick?.(0, 0, { source: "menu" });
}

assert.deepEqual(stateAtDispatch, { selected: 0, itemId: -1 });
assert.equal(dispatched?.option, "Use");
assert.equal(dispatched?.slot, 7);
assert.equal(dispatched?.itemId, 4151);
assert.equal(use.menuStateIndex, undefined, "widget actions must not run through generic menuAction");

console.log("widget menu Use dispatch test passed");
