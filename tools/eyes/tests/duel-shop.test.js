import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { GameEyes } from "../src/GameEyes.js";

// Use EYES_CHROMIUM to run this against the user's installed Chrome.
const game = new GameEyes();
const username = `sh${Date.now().toString(36).slice(-8)}`;
const password = "ShopPreview2026";
const directory = new URL("./out/duel-shop/", import.meta.url);
const shop = () => game.page.getByRole("dialog", { name: "The Arena Exchange", exact: true });
const button = name => game.page.getByRole("button", { name, exact: true });
let step = "startup";
await mkdir(directory, { recursive: true });

async function look(name) {
    step = name;
    const result = await game.look({ quality: 90 });
    await writeFile(new URL(`${name}.jpg`, directory), Buffer.from(result.image.base64, "base64"));
    console.log(JSON.stringify({ step: name, tile: result.state.tile }));
}

async function openThroughMerchant() {
    await game.waitFor("eyes.npcs(30).some(npc => npc.typeId === 2817 && npc.screen)", 30000);
    const actor = (await game.npcs(30)).find(npc => npc.typeId === 2817);
    assert.equal(actor?.name, "Shop keeper", "the shopkeeper is a real cache NPC");
    assert.deepEqual(actor?.tile, { x: 3383, y: 3236, plane: 0 });
    const talk = game.page.getByRole("menuitem", { name: "Talk-to Shop keeper", exact: true });
    // Feet are projected by the engine; probe only points on that model.
    for (const offset of [15, 25, 5, 35, 0]) {
        const current = (await game.npcs(30)).find(npc => npc.typeId === 2817);
        assert.ok(current?.screen, "merchant remains visible");
        await game.click(current.screen.x, current.screen.y - offset, { button: "right" });
        try { await talk.waitFor({ state: "visible", timeout: 1000 }); break; }
        catch { await game.key("Escape"); }
    }
    await talk.waitFor({ state: "visible", timeout: 3000 });
    await look("02-merchant-choose-option");
    await talk.click();
    await shop().waitFor({ state: "visible" });
}

async function openThroughChat() {
    const input = game.page.getByRole("textbox", { name: "Public chat message", exact: true });
    await input.fill("::shop");
    await input.press("Enter");
    await shop().waitFor({ state: "visible" });
}

async function mobileFit() {
    const dimensions = await shop().evaluate(element => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
            viewportWidth: innerWidth, viewportHeight: innerHeight,
            contentWidth: element.scrollWidth, width: element.clientWidth };
    });
    assert.ok(dimensions.left >= 0 && dimensions.right <= dimensions.viewportWidth + 1,
        "shop panel fits the mobile width");
    assert.ok(dimensions.top >= 0 && dimensions.bottom <= dimensions.viewportHeight + 1,
        "shop panel fits the mobile height");
    assert.ok(dimensions.contentWidth <= dimensions.width + 1, "no horizontal scrolling in checkout");
}

try {
    await game.open({ username, password });
    await game.waitFor("eyes.duel().self !== null && eyes.duel().location === 'lobby'", 30000);
    const account = (await game.bridge("duel")).self.name;
    const wallet = (await game.bridge("duel")).wallet;
    await look("01-courtyard-with-merchant");
    await game.walk(3383, 3233, true);
    await game.waitFor("eyes.state().tile.x === 3383 && eyes.state().tile.y === 3233", 25000);
    await openThroughMerchant();
    await game.page.waitForFunction(() => {
        const images = Array.from(document.querySelectorAll(".duel-shop-package-art img"));
        return images.length === 4 && images.every(image => image.complete && image.naturalWidth > 0);
    });
    await look("03-native-pouch-bundle-chest");
    await button("Close The Arena Exchange").click();
    await openThroughChat();
    assert.equal(await shop().isVisible(), true, "chat command opens the same shop");
    assert.equal((await game.chat(100)).some(message => message.text === "::shop"), false,
        "shop command is not broadcast as public conversation");
    await game.page.getByRole("group", { name: "Currency packages", exact: true })
        .getByRole("button", { name: /Gold bundle/ }).click();
    await button("Checkout →").click();
    await game.page.getByLabel("Email address", { exact: true }).waitFor();
    assert.equal(await button("Order").isVisible(), true, "checkout requires a separate Order action");
    assert.equal(await game.page.getByLabel("Game username", { exact: true }).inputValue(), account);
    assert.equal(await game.page.getByLabel("Game username", { exact: true }).getAttribute("readonly"), "");
    assert.equal(await button("Order").isDisabled(), true, "email is required before preparing order");
    const email = game.page.getByLabel("Email address", { exact: true });
    await email.fill("not-an-email");
    assert.equal(await button("Order").isDisabled(), true, "invalid email cannot complete draft");
    await email.fill("example@example.invalid");
    assert.equal(await button("Order").isEnabled(), true);
    await look("04-gold-checkout");
    await button("Back").click();
    await game.page.waitForFunction(() => document.activeElement?.textContent === "Checkout →");
    await game.page.getByRole("group", { name: "Shop currency", exact: true })
        .getByRole("button", { name: "Platinum tokens", exact: true }).click();
    await game.page.getByRole("group", { name: "Currency packages", exact: true })
        .getByRole("button", { name: /Platinum chest/ }).click();
    await button("Checkout →").click();
    await game.page.getByLabel("Email address", { exact: true }).waitFor();
    assert.equal(await button("Order").isVisible(), true, "retained valid email must not auto-submit checkout");
    assert.equal(await button("Order").isEnabled(), true);
    assert.equal(await game.page.getByText("Your order draft is ready", { exact: true }).count(), 0,
        "changing packages with a valid email stays at review until Order is clicked");
    await game.page.waitForFunction(() => document.activeElement?.id === "duel-shop-email");
    await game.page.getByRole("region", { name: "Order summary", exact: true }).getByText("100,000 platinum tokens", { exact: true }).waitFor();
    await game.page.setViewportSize({ width: 390, height: 844 });
    await game.page.waitForTimeout(300);
    await mobileFit();
    await look("05-mobile-platinum-checkout");
    await button("Order").click();
    await game.page.getByRole("status").getByText("Your order draft is ready", { exact: true }).waitFor();
    assert.match(await shop().innerText(), /Payments are not available yet; no payment was taken/);
    assert.match(await shop().innerText(), /example@example.invalid/);
    await mobileFit();
    await look("06-mobile-unpaid-order-draft");
    await game.page.waitForTimeout(1300);
    assert.deepEqual((await game.bridge("duel")).wallet, wallet, "order preview does not alter inventory or bank");
    await button("Done").click();
    await openThroughChat();
    assert.match(await shop().innerText(), /Your order draft is ready/, "draft is retained for this session");
    await button("Browse packages").click();
    await mobileFit();
    await look("07-mobile-packages");
    await button("Close The Arena Exchange").click();
    await game.page.setViewportSize({ width: 1280, height: 800 });
    await button("Sign out").click();
    await button("Enter the arena").waitFor({ state: "visible" });
    assert.equal(await game.page.getByRole("dialog").count(), 0, "shop closes on sign out");
    assert.equal(game.errors.length, 0, "no uncaught browser errors");
    console.log("Duel shop passed: actual NPC context menu, ::shop, cache pouch/casket art, both currencies, signed-in account, email validation, unpaid draft, unchanged wallet and mobile fit.");
} catch (error) {
    console.error(`Duel shop failed at ${step}:`, error);
    if (game.isOpen) await look("99-failure").catch(() => {});
    process.exitCode = 1;
} finally { await game.close(); }
