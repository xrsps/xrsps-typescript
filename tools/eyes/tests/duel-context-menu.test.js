import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { GameEyes } from "../src/GameEyes.js";
const first = new GameEyes(), second = new GameEyes();
const suffix = Date.now().toString(36).slice(-7), names = [`ra${suffix}`, `rb${suffix}`];
const output = new URL("./out/duel-context-menu/", import.meta.url);
async function look(name) {
    const result = await first.look({quality:90});
    await writeFile(new URL(`${name}.jpg`, output), Buffer.from(result.image.base64,"base64"));
}
try {
    await mkdir(output,{recursive:true});
    await first.open({username:names[0],password:"RightClick2026"});
    await second.open({username:names[1],password:"RightClick2026"});
    await first.walk(3365,3265); await second.walk(3369,3265);
    await first.waitFor("eyes.state().tile.x === 3365 && eyes.state().tile.y === 3265");
    await second.waitFor("eyes.state().tile.x === 3369 && eyes.state().tile.y === 3265");
    await look("01-two-players-before-right-click");
    // Retain native events and inspect them after dispatch; a microtask in an
    // earlier capture listener can run before React's root listener cancels it.
    await first.page.evaluate(() => {
        window.__contextEvents = [];
        window.addEventListener("contextmenu", event => {
            window.__contextEvents.push(event);
        },true);
    });
    const actor = (await first.players(20)).find(player => player.name.toLowerCase() === names[1]);
    assert.ok(actor?.screen);
    const menu = first.page.getByRole("menu",{name:"Choose option",exact:true});
    for (const offset of [10,20,0,30]) {
        await first.click(actor.screen.x,actor.screen.y-offset,{button:"right"});
        try { await menu.waitFor({state:"visible",timeout:1200}); break; } catch { await first.key("Escape"); }
    }
    await menu.waitFor({state:"visible"});
    await first.page.getByRole("menuitem",{name:`Challenge ${actor.name}`,exact:true}).waitFor();
    const playerEvents = await first.eval("window.__contextEvents.map(event => event.defaultPrevented)");
    assert.ok(playerEvents.length > 0 && playerEvents.every(Boolean),"native browser menus are prevented for a real player right-click");
    await look("02-only-in-game-player-menu");
    await menu.getByRole("menuitem",{name:`Trade with ${actor.name}`,exact:true}).click({button:"right"});
    await menu.waitFor({state:"visible"});
    const events = await first.eval("window.__contextEvents.map(event => event.defaultPrevented)");
    assert.ok(events.length >= 2 && events.every(Boolean),"right-clicking the newly rendered game menu also suppresses browser context menus");
    await look("03-right-click-on-open-menu");
    await first.key("Escape"); await menu.waitFor({state:"detached"});
    assert.equal(first.errors.length,0,JSON.stringify(first.errors));
    assert.equal(second.errors.length,0,JSON.stringify(second.errors));
    console.log("Real right-clicks on players and the opened game menu prevent native browser menus; game options and Escape remain usable.");
} catch(error) {
    console.error(error);
    if(first.isOpen) await look("99-failure").catch(()=>{});
    process.exitCode=1;
} finally { await Promise.all([first.close(),second.close()]); }
