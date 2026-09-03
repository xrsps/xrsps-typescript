import assert from "node:assert/strict";
import { ClickMode } from "../game/InputManager";
import { shouldSkipWidgetClickInput } from "../game/widgets/input/widgetClickGuard";
import { drawChooseOptionMenu } from "../widgets/gl/choose-option";
import { UIInputBridge } from "../widgets/gl/ui-input";

let clickThroughs = 0;
const inputBridge = new UIInputBridge();
const clicks = inputBridge.getClicks();
clicks.register({
    id: "inventory-slot",
    rect: { x: 0, y: 0, w: 32, h: 32 },
    onClick: () => clickThroughs++,
});

const input = {
    mouseX: 16,
    mouseY: 16,
    saveClickX: 16,
    saveClickY: 16,
    clickMode2: ClickMode.LEFT,
    clickMode3: ClickMode.LEFT,
    middleClickX: -1,
    middleClickY: -1,
    middleClickSequence: 0,
} as any;
inputBridge.processInput(input);
inputBridge.consumeClick();
input.clickMode2 = ClickMode.NONE;
input.clickMode3 = ClickMode.NONE;
inputBridge.processInput(input);

assert.equal(clickThroughs, 0, "a consumed menu click must not hit the inventory underneath");

let menuJustClosed = true;
const deps = {
    getRenderer: () => undefined,
    getMenuOpen: () => false,
    getMenuJustClosed: () => menuJustClosed,
    setMenuJustClosed: (value: boolean) => (menuJustClosed = value),
} as any;
assert.equal(
    shouldSkipWidgetClickInput(deps, {} as never),
    true,
    "legacy widget input must skip the menu-closing click",
);
assert.equal(menuJustClosed, false, "the one-frame guard must be consumed");

(globalThis as any).document = {
    createElement: () => ({
        getContext: () => ({ font: "", measureText: () => ({ width: 40 }) }),
    }),
};
let menuInvocations = 0;
let consumedMenuClicks = 0;
let renders = 0;
const menuUi: any = {};
const menuInput = {
    clickMode1: ClickMode.LEFT,
    clickMode2: ClickMode.LEFT,
    clickMode3: ClickMode.LEFT,
    mouseX: 100,
    mouseY: 120,
    saveClickX: 100,
    saveClickY: 120,
};
const client: any = {
    menuOpen: false,
    menuJustClosed: false,
    inputManager: menuInput,
    clickedWidget: {},
    clickedWidgetParent: {},
    deferredWidgetAction: {},
    menuState: { reset: () => undefined },
};
const canvas: any = {
    __ui: menuUi,
    __osrsClient: client,
    __clicks: {
        cancelActiveClick: () => undefined,
        unregister: () => undefined,
    },
    __inputBridge: { consumeClick: () => consumedMenuClicks++ },
    clientWidth: 800,
    offsetWidth: 800,
    clientHeight: 600,
    offsetHeight: 600,
};
menuUi.menu = {
    open: true,
    x: 100,
    y: 100,
    entries: [
        {
            option: "Use",
            onClick: () => {
                menuInvocations++;
                menuUi.menu = undefined;
            },
        },
    ],
};
drawChooseOptionMenu(
    { canvas, width: 800, height: 600 } as any,
    {
        fontLoader: () => ({ measure: () => 40 }) as any,
        requestRender: () => renders++,
    },
);

assert.equal(menuInvocations, 1);
assert.equal(consumedMenuClicks, 1);
assert.equal(client.menuJustClosed, true);
assert.equal(client.clickedWidget, null);
assert.equal(client.deferredWidgetAction, null);
assert.equal(menuInput.clickMode2, ClickMode.NONE);
assert.equal(renders, 1);

console.log("menu click consumption test passed");
