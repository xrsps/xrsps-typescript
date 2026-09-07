import assert from "node:assert/strict";

import { EnterToTypeChat } from "../game/chat/EnterToTypeChat";

const varcInts = new Map<number, number>();
const varcStrings = new Map<number, string>();
const enterToType = new EnterToTypeChat({
    cs2Vm: { runScriptEvent: () => {} } as any,
    varManager: {
        getVarcInt: (id: number) => varcInts.get(id) ?? 0,
        getVarcString: (id: number) => varcStrings.get(id) ?? "",
        setVarcString: (id: number, value: string) => varcStrings.set(id, value),
    } as any,
    widgetManager: {} as any,
    isLoggedIn: () => true,
    isItemSpawnerSearchFocused: () => false,
});

assert.equal(enterToType.handleKeyEvent({ keyTyped: 84, keyPressed: 0 }, false), true);
assert.equal(enterToType.isUnlocked, true);

enterToType.reset();
varcInts.set(5, 8);
assert.equal(enterToType.handleKeyEvent({ keyTyped: 84, keyPressed: 0 }, false), false);
assert.equal(enterToType.shouldBlockChatboxKeys(false), false);
assert.equal(enterToType.isWasdCameraActive(0), false);
assert.equal(enterToType.isUnlocked, false);

varcInts.set(5, 0);
assert.equal(enterToType.shouldBlockChatboxKeys(false), true);
assert.equal(enterToType.isWasdCameraActive(0), true);

console.log("enter-to-type-chat.test.ts: all tests passed");
