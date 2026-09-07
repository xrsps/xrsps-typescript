import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { GameEyes } from "../src/GameEyes.js";

const first = new GameEyes(), second = new GameEyes();
const suffix = Date.now().toString(36).slice(-7);
const names = [`ca${suffix}`,`cb${suffix}`], password = "PublicChat2026";
const output = new URL("./out/duel-public-chat/", import.meta.url);
let step = "opening";
async function look(game, label) {
    step = label;
    const result = await game.look({quality:90});
    await writeFile(new URL(`${label}.jpg`, output), Buffer.from(result.image.base64,"base64"));
    console.log(JSON.stringify({step:label,tile:result.state.tile,camera:result.state.camera}));
}
async function see(game, text) {
    const line = game.page.getByRole("log",{name:"Public messages",exact:true}).getByText(text,{exact:true});
    await line.waitFor({state:"visible",timeout:20000});
    assert.equal(await line.count(),1,"each public message appears once");
}
async function speak(game, text) {
    const input = game.page.getByRole("textbox",{name:"Public chat message",exact:true});
    await input.fill(text); await input.press("Enter");
    await see(game,text);
    assert.equal(await input.inputValue(),"","Enter sends and clears the public input");
}
try {
    await mkdir(output,{recursive:true});
    await first.open({username:names[0],password});
    await second.open({username:names[1],password});
    await first.waitFor("eyes.duel()?.self && eyes.duel().location === 'lobby'");
    await second.waitFor("eyes.duel()?.self && eyes.duel().location === 'lobby'");
    await first.page.waitForFunction(()=>document.querySelector('.duel-public-chat')?.style.getPropertyValue('--chat-paper').includes('data:image/png'));
    assert.equal(await first.page.getByRole('navigation',{name:'Chat channels'}).getByRole('button').count(),8,"classic chatbox has its original eight bottom tabs");
    assert.equal(await first.page.getByRole('button',{name:'Private Off',exact:true}).isDisabled(),true,"unsupported private messaging is clearly off");
    await look(first,"01-public-chat-empty");
    await first.page.locator("canvas").first().focus();
    await first.key("Enter");
    await first.page.waitForFunction(()=>document.activeElement?.id === "duel-public-input",null,{timeout:5000});
    await speak(first,"Hello everyone in the courtyard");
    await see(second,"Hello everyone in the courtyard");
    const speakerId=(await first.bridge('duel')).self.id;
    const overhead=`client.playerEcs.getOverheadChat(client.playerEcs.getIndexForServerId(${speakerId}))`;
    await second.waitFor(`${overhead}?.text === 'Hello everyone in the courtyard'`,5000);
    assert.equal((await second.eval(overhead)).color,0,"nearby speaker overhead is native yellow");
    await look(second,'01b-native-yellow-overhead');
    await second.waitFor(`!${overhead}`,8000);
    await look(second,'01c-overhead-expired');
    await see(second,"Hello everyone in the courtyard");
    await first.page.getByRole('button',{name:'Game All',exact:true}).click();
    assert.equal(await first.page.getByRole('log',{name:'Public messages'}).getByText('Hello everyone in the courtyard',{exact:true}).count(),0,"Game tab filters public speech");
    await first.page.getByRole('button',{name:'Public On',exact:true}).click();
    await see(first,'Hello everyone in the courtyard');
    await speak(second,"Hello back from another player");
    await see(first,"Hello back from another player");
    await look(first,"02-both-real-players-speaking");

    // Opposite ends of the small courtyard remain beyond the 15-tile model range.
    await first.walk(3368,3232); await second.walk(3386,3232);
    await first.waitFor("eyes.state().tile.x === 3368 && eyes.state().tile.y === 3232",30000);
    await second.waitFor("eyes.state().tile.x === 3386 && eyes.state().tile.y === 3232",30000);
    await first.waitFor(`!eyes.players(15).some(player => player.name.toLowerCase() === ${JSON.stringify(names[1])})`);
    await speak(first,"You can hear me across the whole courtyard");
    await see(second,"You can hear me across the whole courtyard");
    await look(second,"03-distant-player-public-message");

    const input = first.page.getByRole("textbox",{name:"Public chat message",exact:true});
    await input.fill("Typing keeps the camera still");
    const before = await first.eval("eyes.state().camera");
    await first.key("ArrowLeft",{hold:200}); await first.key("ArrowUp",{hold:200});
    await input.hover(); await first.page.mouse.wheel(0,240);
    const after = await first.eval("eyes.state().camera");
    assert.equal(after.yaw,before.yaw,"chat arrow keys do not rotate the camera");
    assert.equal(after.pitch,before.pitch,"chat arrow keys do not tilt the camera");
    assert.equal(after.distance,before.distance,"scrolling over chat does not zoom the camera");
    await input.press("Enter"); await see(second,"Typing keeps the camera still");

    await speak(first,"<b>Still plain text</b>"); await see(second,"<b>Still plain text</b>");
    assert.equal(await second.page.getByRole("log",{name:"Public messages"}).locator("b").count(),0,"chat content never creates HTML elements");
    await first.page.getByRole("button",{name:"Collapse public chat",exact:true}).click();
    await speak(second,"Message received while chat is collapsed");
    await first.waitFor("eyes.chat(10).some(message=>message.text === 'Message received while chat is collapsed')");
    await first.page.getByRole("button",{name:"Expand public chat",exact:true}).click();
    await see(first,"Message received while chat is collapsed");
    for (let index=0;index<12;index++) await speak(second,`Public history line ${index}`);
    const overflow = await first.page.getByRole("log",{name:"Public messages"}).evaluate(element=>element.scrollHeight>element.clientHeight);
    assert.equal(overflow,true,"public history has an independent scroll area");
    await look(first,"04-scrollable-public-history");
    await first.page.setViewportSize({width:390,height:844});
    await first.page.waitForTimeout(500);
    const fit = await first.page.getByRole("region",{name:"Public chat",exact:true}).evaluate(element=>{
        const r=element.getBoundingClientRect(); return r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight;
    });
    assert.equal(fit,true,"public chat stays within the mobile viewport");
    await look(first,"05-mobile-public-chat");
    await first.page.setViewportSize({width:1280,height:800});
    await first.walk(3375,3232); await second.walk(3379,3232);
    await first.waitFor("eyes.state().tile.x === 3375 && eyes.state().tile.y === 3232",30000);
    await second.waitFor("eyes.state().tile.x === 3379 && eyes.state().tile.y === 3232",30000);
    const opponent = (await second.bridge("duel")).self.id;
    await first.say(`::duel challenge ${opponent} dagger`);
    await second.page.getByRole("button",{name:"Accept challenge",exact:true}).click();
    await first.page.getByRole("button",{name:"Accept offer",exact:true}).click();
    await second.page.getByRole("button",{name:"Accept offer",exact:true}).click();
    await first.page.getByRole("button",{name:"Confirm & fight",exact:true}).click();
    await second.page.getByRole("button",{name:"Confirm & fight",exact:true}).click();
    await first.waitFor("eyes.duel().status === 'fighting'");
    await second.waitFor("eyes.duel().status === 'fighting'");
    await look(first,"06-arena-chat-collapsed");
    await first.page.locator("canvas").first().focus();
    await first.key("Enter");
    await first.page.waitForFunction(()=>document.activeElement?.id === "duel-public-input",null,{timeout:5000});
    await second.page.getByRole("button",{name:"Expand public chat",exact:true}).click();
    await first.page.getByText("Your duel",{exact:true}).waitFor({state:"visible"});
    await speak(first,"Good luck in our duel"); await see(second,"Good luck in our duel");
    await speak(second,"You too, good luck"); await see(first,"You too, good luck");
    const clearControls = await first.page.locator(".duel-public-chat").evaluate(element=>{
        const chat=element.getBoundingClientRect(), controls=document.querySelector(".duel-bottom").getBoundingClientRect();
        return chat.bottom <= controls.top;
    });
    assert.equal(clearControls,true,"expanded fight chat stays above the combat controls");
    await look(first,"07-arena-public-chat");
    await first.page.setViewportSize({width:390,height:844});
    await first.page.waitForTimeout(500);
    await look(first,"08-mobile-arena-public-chat");
    assert.equal(first.errors.length,0,JSON.stringify(first.errors));
    assert.equal(second.errors.length,0,JSON.stringify(second.errors));
    console.log("Public chat live UI passed: two humans, distant lobby broadcast, Enter, no duplicates, safe text, history, collapse, arena chat, camera isolation and mobile layout.");
} catch(error) {
    console.error(`Public chat failed at ${step}:`,error);
    if(first.isOpen) await look(first,"99-chat-failure").catch(()=>{});
    process.exitCode=1;
} finally { await Promise.all([first.close(),second.close()]); }
