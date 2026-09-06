import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { GameEyes } from "../src/GameEyes.js";

const game = new GameEyes();
const directory = new URL("./out/duel-camera-assets/", import.meta.url);
const username = "cm" + Date.now().toString(36).slice(-8);
const camera = () => game.eval("eyes.state().camera");
async function look(name) {
    const result = await game.look({ quality: 90 });
    await writeFile(new URL(name + ".jpg", directory), Buffer.from(result.image.base64, "base64"));
    console.log(JSON.stringify({ step: name, tile: result.state.tile, camera: result.state.camera }));
}
async function button(name) { await game.page.getByRole("button", { name, exact: true }).click(); }
try {
    await mkdir(directory, { recursive: true });
    await game.open({ username, password: "CameraAssets2026" });
    await game.waitFor("eyes.duel()?.wallet.inventory.gold === 1000000");
    await game.page.waitForFunction(() => [995,13204].every(id => {
        const img = document.querySelector(`[data-item-id='${id}'] img`);
        return img?.naturalWidth === 36 && img.naturalHeight === 32;
    }));
    await look("01-original-currency-and-courtyard");
    const first = await camera();
    await game.scroll(900, 360, -120);
    await game.waitFor(`eyes.state().camera.distance < ${first.distance}`);
    const close = await camera();
    await look("02-wheel-zoom-in");
    await game.scroll(900, 360, 120);
    await game.waitFor(`eyes.state().camera.distance > ${close.distance}`);
    await game.page.locator("canvas").first().focus();
    await game.key("ArrowLeft", { hold: 350 });
    await game.waitFor(`eyes.state().camera.yaw !== ${first.yaw}`);
    const left = await camera();
    await game.key("ArrowRight", { hold: 200 });
    await game.waitFor(`eyes.state().camera.yaw !== ${left.yaw}`);
    await game.key("ArrowUp", { hold: 220 });
    await game.waitFor(`eyes.state().camera.pitch > ${first.pitch}`);
    const high = await camera();
    await game.key("ArrowDown", { hold: 120 });
    await game.waitFor(`eyes.state().camera.pitch < ${high.pitch}`);
    await look("03-arrow-key-orbit");
    const beforeWalk = await camera();
    await game.clickTile(3371, 3265, 0);
    await game.waitFor("eyes.state().tile.x === 3371 && eyes.state().tile.y === 3265", 20000);
    const afterWalk = await camera();
    assert.ok(Math.abs(afterWalk.position.x - beforeWalk.position.x) > 3, "camera follows the player after a real ground click");
    await look("04-player-follow");
    await button("Bank & inventory");
    await game.page.getByRole("dialog", { name: "Bank & inventory" }).waitFor();
    await game.page.waitForFunction(() => document.querySelectorAll("[role='dialog'] .duel-currency-icon img").length === 4);
    const goldStack = await game.page.locator(".duel-wallet-columns [data-item-id='995'] img").first().getAttribute("src");
    await game.page.getByLabel("Amount", { exact: false }).fill("1000000");
    const locked = await camera();
    await game.key("ArrowLeft", { hold: 150 });
    await game.page.getByRole("dialog").hover(); await game.page.mouse.wheel(0, 120);
    const still = await camera();
    assert.equal(still.yaw, locked.yaw, "bank input does not rotate camera");
    assert.equal(still.distance, locked.distance, "bank scrolling does not zoom camera");
    await game.page.locator(".duel-bank-amount").getByRole("button", { name: "Deposit", exact: true }).click();
    await game.waitFor("eyes.duel().wallet.inventory.gold === 0");
    await game.page.waitForFunction(old => document.querySelector(".duel-wallet-columns [data-item-id='995'] img")?.getAttribute("src") !== old, goldStack);
    const singleGold = await game.page.locator(".duel-wallet-columns [data-item-id='995'] img").first().getAttribute("src");
    assert.notEqual(singleGold, goldStack, "coin sprite changes from a full stack to a single coin");
    await look("05-native-coin-stack-variants");
    await game.page.getByRole("group", { name: "Bank action" }).getByRole("button", { name: "Withdraw", exact: true }).click();
    await game.page.getByLabel("Amount", { exact: false }).fill("1000000");
    await game.page.locator(".duel-bank-amount").getByRole("button", { name: "Withdraw", exact: true }).click();
    await game.waitFor("eyes.duel().wallet.inventory.gold === 1000000");
    const singleToken = await game.page.locator(".duel-wallet-columns [data-item-id='13204'] img").first().getAttribute("src");
    for (let count = 1; count <= 5; count++) {
        await button("1,000 gold → 1 token");
        await game.waitFor(`eyes.duel().wallet.inventory.platinum === ${count}`);
    }
    await game.page.waitForFunction(old => document.querySelector(".duel-wallet-columns [data-item-id='13204'] img")?.getAttribute("src") !== old, singleToken);
    await look("06-native-platinum-stack");
    await button("Close Bank & inventory");
    for (let index=0; index<5; index++) { await game.scroll(900,360,120); await game.page.waitForTimeout(120); }
    await look("07-compact-courtyard-wide");
    await game.page.locator("canvas").first().focus();
    await game.key("ArrowDown", { hold: 1200 });
    await game.waitFor("eyes.state().camera.pitch === 0");
    const cull = await game.eval("({tile:client.renderer.getRenderCullTile(),player:eyes.state().tile,camera:eyes.state().camera})");
    assert.equal(cull.tile.x, cull.player.x, "wide orbit culls around the player on the X axis");
    assert.equal(cull.tile.y, cull.player.y, "wide orbit keeps the player's map visible at low pitch");
    await look("08-low-pitch-max-zoom");
    assert.equal(game.errors.length, 0, JSON.stringify(game.errors));
    console.log("Camera and original currency assets passed: wheel in/out, four arrow directions, real click movement and follow, input isolation, coin and platinum stack models.");
} catch (error) {
    console.error(error);
    if (game.isOpen) await look("99-failure").catch(() => {});
    process.exitCode = 1;
} finally { await game.close(); }
