import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { GameEyes } from "../src/GameEyes.js";

const game = new GameEyes();
const directory = new URL("./out/duel-ui/", import.meta.url);
const username = "ui" + Date.now().toString(36).slice(-8), password = "ArenaUi2026";
await mkdir(directory, { recursive: true });
async function look(name) {
    const result = await game.look({ quality: 90 });
    await writeFile(new URL(name + ".jpg", directory), Buffer.from(result.image.base64, "base64"));
}
async function button(name) { await game.page.getByRole("button", { name, exact: true }).click(); }
try {
    await game.open({ url: "http://localhost:3000/" });
    await game.page.getByRole("button", { name: "Enter the arena", exact: true }).waitFor({ timeout: 120000 });
    await look("01-login");
    await game.page.getByLabel("Player name", { exact: true }).fill("");
    await game.page.getByLabel("Player name", { exact: true }).pressSequentially(username, { delay: 20 });
    await game.page.getByLabel("Password", { exact: true }).pressSequentially(password, { delay: 20 });
    assert.equal(await game.page.getByLabel("Player name", { exact: true }).inputValue(), username);
    await button("Enter the arena");
    await game.waitForLogin();
    await game.page.waitForFunction(() => window.__eyes.duel()?.self !== null && window.__eyes.duel()?.wallet.inventory.gold === 1000000);
    await look("02-desktop-lobby");
    await button("Bank & inventory");
    await game.page.getByRole("dialog", { name: "Bank & inventory" }).waitFor();
    await look("03-desktop-bank");
    await game.page.getByLabel("Amount", { exact: false }).fill("20000");
    await game.page.locator(".duel-bank-amount").getByRole("button", { name: "Deposit", exact: true }).click();
    await game.page.waitForFunction(() => window.__eyes.duel().wallet.bank.gold === 20000);
    await button("Close Bank & inventory");
    // Account authentication remains usable after the custom interface has been open.
    await button("Sign out");
    await game.page.getByRole("button", { name: "Enter the arena", exact: true }).waitFor();
    await game.page.getByLabel("Player name", { exact: true }).fill(username);
    await game.page.getByLabel("Password", { exact: true }).fill("WrongPass2026");
    await button("Enter the arena");
    await game.page.getByRole("alert").waitFor();
    await look("04-login-error");
    await game.page.getByLabel("Password", { exact: true }).fill(password);
    await button("Enter the arena");
    await game.waitForLogin();
    await game.page.waitForFunction(() => window.__eyes.duel().wallet.bank.gold === 20000);
    assert.equal((await game.eval("eyes.duel()")).wallet.inventory.gold, 980000, "relogin does not grant another million");
    await game.page.setViewportSize({ width: 390, height: 844 });
    await game.page.waitForTimeout(400);
    await look("05-mobile-lobby");
    await button("Bank & inventory");
    await look("06-mobile-bank");
    const fit = await game.page.getByRole("dialog", { name: "Bank & inventory" }).evaluate(el => {
        const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth && r.top >= 0 && r.bottom <= window.innerHeight;
    });
    assert.equal(fit, true, "bank fits the mobile viewport");
    await game.page.keyboard.press("Escape");
    await game.page.getByRole("dialog").waitFor({ state: "detached" });
    await button("Sign out");
    await game.page.getByRole("button", { name: "Enter the arena", exact: true }).waitFor();
    assert.equal(game.errors.length, 0, "no uncaught browser errors");
    console.log("Duel UI passed: real keyboard login, bank deposit, logout, password error/retry, saved balance, mobile layout and Escape.");
} catch (error) {
    if (game.isOpen) await look("99-failure").catch(() => {});
    console.error(error); process.exitCode = 1;
} finally { await game.close(); }
