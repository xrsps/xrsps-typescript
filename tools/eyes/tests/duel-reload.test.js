import assert from "node:assert/strict";
import { GameEyes } from "../src/GameEyes.js";
const game = new GameEyes();
const username = process.env.EYES_RELOAD_ACCOUNT || `rl${Date.now().toString(36).slice(-8)}`;
const password = "LobbyTest2026";
try {
    await game.open({ username, password });
    await game.waitFor("eyes.duel()?.self !== null");
    const wallet = (await game.bridge("duel")).wallet;
    for (let index=0; index<2; index++) {
        await game.page.getByRole("button", {name:"Sign out",exact:true}).click();
        await game.page.getByRole("button", {name:"Enter the arena",exact:true}).waitFor();
        await game.reload();
        await game.page.getByLabel("Player name", {exact:true}).fill(username);
        await game.page.getByLabel("Password", {exact:true}).fill(password);
        await game.page.getByRole("button", {name:"Enter the arena",exact:true}).click();
        await game.waitForLogin();
        await game.waitFor("eyes.duel()?.self !== null && eyes.duel().location === 'lobby'",30000);
        assert.deepEqual((await game.bridge("duel")).wallet,wallet);
        console.log(`Reload ${index + 1} restored the same account, wallet, and lobby.`);
    }
    assert.equal(game.errors.length,0,JSON.stringify(game.errors));
} catch (error) {
    console.error(error);
    console.error(JSON.stringify({state:await game.state().catch(String),duel:await game.bridge("duel").catch(String),console:game.consoleLog({last:40}),network:game.networkLog({failedOnly:false})}));
    process.exitCode=1;
} finally { await game.close(); }
