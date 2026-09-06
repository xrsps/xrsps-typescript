import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { GameEyes } from "../src/GameEyes.js";

const game = new GameEyes();
const directory = new URL("./out/duel-native-shop/", import.meta.url);
const button = name => game.page.getByRole("button", { name, exact: true });
const dialog = name => game.page.getByRole("dialog", { name, exact: true });
async function look(label) {
    const result = await game.look({ quality: 90 });
    await writeFile(new URL(`${label}.jpg`, directory), Buffer.from(result.image.base64, "base64"));
    console.log(label);
}
async function command(text) {
    // Native chat is always ready to type, as in the original fixed client.
    const point = await game.eval(`(() => { const r=client.renderer.canvas.getBoundingClientRect(); return {x:r.left+150,y:r.top+466}; })()`);
    await game.click(point.x, point.y);
    await game.type(text, { enter: true });
}
async function talkToShopkeeper() {
    await game.waitFor("eyes.npcs(15).some(n => n.typeId === 2817 && n.screen)");
    const keeper = (await game.npcs(15)).find(npc => npc.typeId === 2817);
    for (const offset of [24, 12, 36, 0]) {
        await game.click(keeper.screen.x, keeper.screen.y - offset, { button: "right" });
        await game.waitFor("eyes.menu().open", 2000).catch(() => {});
        if ((await game.menu()).entries.some(entry => entry.action === "Talk-to")) break;
        await game.key("Escape");
    }
    await look("01a-native-shopkeeper-menu");
    const target = await game.eval(`(() => {
        const c=client.renderer.canvas, r=c.getBoundingClientRect();
        const t=client.renderer.widgetsOverlay.getGLCanvas().__clicks.targets.find(t =>
            t.id.startsWith('__menu_opt_') && /^Talk-to /.test(t.hoverText ?? ''));
        return t ? {x:r.left+(t.rect.x+t.rect.w/2)*r.width/c.width,
            y:r.top+(t.rect.y+t.rect.h/2)*r.height/c.height} : null;
    })()`);
    assert.ok(target, "native shopkeeper offers Talk-to");
    await game.click(target.x, target.y);
    await dialog("The Arena Exchange").waitFor();
    await look("01b-native-npc-opens-shop");
    await button("Close The Arena Exchange").click();
}
try {
    await mkdir(directory, { recursive: true });
    await game.open({ username: `ns${Date.now().toString(36).slice(-7)}`, password: "NativeShop2026" });
    await game.waitFor("eyes.duel().self !== null");
    const account = (await game.bridge("duel")).self.name;
    const wallet = (await game.bridge("duel")).wallet;
    await look("01-native-chat");
    await writeFile(new URL("original-client-courtyard.png", directory), await game.page.locator(".game-canvas-stage").screenshot());
    await talkToShopkeeper();
    await command("::shop");
    await dialog("The Arena Exchange").waitFor();
    await game.page.waitForFunction(() => [...document.querySelectorAll(".duel-shop-package-art img")].length === 4);
    await look("02-pouch-bundle-chest");
    await game.page.getByRole("group", {name:"Currency packages"}).getByRole("button", {name:/Gold bundle/}).click();
    await button("Checkout →").click();
    assert.equal(await game.page.getByLabel("Game username", {exact:true}).inputValue(), account);
    assert.equal(await button("Order").isDisabled(), true);
    await game.page.getByLabel("Email address", {exact:true}).fill("example@example.invalid");
    await look("03-gold-checkout");
    await button("Back").click();
    await game.page.getByRole("group", {name:"Shop currency"}).getByRole("button", {name:"Platinum tokens",exact:true}).click();
    await game.page.getByRole("group", {name:"Currency packages"}).getByRole("button", {name:/Platinum chest/}).click();
    await button("Checkout →").click();
    assert.equal(await game.page.getByText("Your order draft is ready", {exact:true}).count(), 0);
    await button("Order").click();
    await game.page.getByText("Your order draft is ready", {exact:true}).waitFor();
    await look("04-unpaid-order-draft");
    assert.deepEqual((await game.bridge("duel")).wallet, wallet, "shop draft cannot grant currency");
    await button("Done").click();
    await command("::exchange");
    await dialog("Exchange tokens").waitFor();
    await button("Exchange").click();
    await game.waitFor("eyes.duel().wallet.inventory.platinum === 1");
    await look("05-currency-exchange");
    assert.equal((await game.bridge("duel")).wallet.inventory.gold, wallet.inventory.gold - 1000);
    await button("Close Exchange tokens").click();
    assert.equal((await game.chat(100)).some(line => ["::shop", "::exchange"].includes(line.text)), false);
    assert.deepEqual(game.errors, []);
    console.log("Native chat shop, pouch packages, account/email checkout, unpaid draft and currency exchange passed.");
} catch (error) {
    console.error(error);
    if (game.isOpen) await look("99-failure").catch(() => {});
    process.exitCode = 1;
} finally { await game.close(); }
