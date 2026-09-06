import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { GameEyes } from "../src/GameEyes.js";

// Real Chrome input against the running local game. Native widget rectangles
// are read from the renderer; actions always go through mouse/keyboard events.
const first=new GameEyes(),second=new GameEyes();
const bankOnly=process.env.EYES_NATIVE_BANK_ONLY==="1";
const suffix=Date.now().toString(36).slice(-7),names=[`na${suffix}`,`nb${suffix}`];
const directory=new URL(bankOnly ? "./out/duel-native-bank/" : "./out/duel-native-foundation/",import.meta.url);
let step="startup",shot=0;
const targetsExpression=`(() => {
    const canvas=client.renderer.widgetsOverlay?.getGLCanvas();
    return (canvas?.__clicks?.targets??[]).filter(t=>t.rect.w>0 && t.rect.h>0 &&
        (t.widgetUid===undefined || !client.widgetManager.isEffectivelyHidden(t.widgetUid)))
        .map(t=>({id:t.id,uid:t.widgetUid,rect:t.rect,text:t.hoverText??"",
            option:t.primaryOption?.option??"",target:t.primaryOption?.target??""}));
})()`;

async function look(game,label) {
    step=label;
    const result=await game.look({quality:90});
    const prefix=`${String(++shot).padStart(2,"0")}-${label}`;
    await writeFile(new URL(prefix+".jpg",directory),Buffer.from(result.image.base64,"base64"));
    await writeFile(new URL(prefix+".json",directory),JSON.stringify({state:result.state,duel:await game.bridge("duel")},null,2));
    console.log(JSON.stringify({step:label,tile:result.state.tile,root:result.state.rootInterface}));
}
async function canvasPoint(game,x,y) {
    return game.eval(`(() => { const c=client.renderer.canvas,r=c.getBoundingClientRect();
        return {x:r.left+${x}*r.width/c.width,y:r.top+${y}*r.height/c.height}; })()`);
}
async function target(game,condition) {
    await game.waitFor(`(${targetsExpression}).some(t=>${condition})`,12000);
    return game.eval(`(${targetsExpression}).find(t=>${condition})`);
}
async function clickTarget(game,condition,label,{button="left"}={}) {
    const found=await target(game,condition),r=found.rect;
    const point=await canvasPoint(game,r.x+r.w/2,r.y+r.h/2);
    await look(game,`${label}-before`);
    await game.click(point.x,point.y,{button});
    await look(game,`${label}-after`);
}
async function move(game,x,y,label) {
    await look(game,`${label}-before`);
    const projected=await game.tileToScreen(x,y,0);
    assert.ok(projected,`walking target ${x},${y} is visible`);
    console.log(JSON.stringify({step:label,target:{x,y},projected,
        picked:await game.screenToTile(projected.x,projected.y)}));
    await game.clickTile(x,y,0);
    await game.waitFor(`eyes.state().tile.x===${x} && eyes.state().tile.y===${y}`,25000);
    await look(game,`${label}-after`);
}
async function speak(game,text) {
    await look(game,"native-chat-before");
    await game.page.locator(".game-canvas-stage canvas").first().focus();
    await game.type(text,{enter:true});
    await game.waitFor(`eyes.chat(20).some(m=>m.text===${JSON.stringify(text)})`);
    await look(game,"native-chat-after");
}
async function openWorldMenu(game,point,action,identifier) {
    for (const offset of [12,24,0,36]) {
        await game.click(point.x,point.y-offset,{button:"right"});
        // Input and native menu drawing complete on the next client frame.
        await game.waitFor("eyes.menu().open",1500).catch(()=>{});
        const menu=await game.menu();
        console.log(JSON.stringify({step:"native-world-menu",point,offset,action,identifier,menu}));
        if(menu.open && menu.entries.some(e=>e.action===action &&
            (identifier===undefined || e.identifier===identifier))) return menu;
        await game.key("Escape");
    }
    throw Error(`Native ${action} menu did not report open; last menu: ${JSON.stringify(await game.menu())}`);
}

try {
    await mkdir(directory,{recursive:true});
    await first.open({username:names[0],password:"NativeTest2026"});
    await first.waitFor("eyes.duel()?.self && eyes.state().rootInterface===548");
    await look(first,"original-fixed-client");
    const fixed=await first.eval(`(() => { const r=client.renderer.canvas.getBoundingClientRect();
        return {width:r.width,height:r.height,internalWidth:client.renderer.canvas.width,
            internalHeight:client.renderer.canvas.height}; })()`);
    assert.deepEqual(fixed,{width:765,height:503,internalWidth:765,internalHeight:503},"fixed native client has its original canvas size");
    assert.equal(await first.page.locator(".duel-public-chat,.duel-heading,.duel-bottom").count(),0,"custom HUD and chat have been removed");
    assert.ok((await first.inventory()).some(i=>i.itemId===995 && i.quantity===1_000_000),"native inventory holds starting coins");
    assert.ok((await first.state()).openWidgets.some(w=>w.groupId===162),"original chat widget is mounted");

    if (!bankOnly) {
        await clickTarget(first,"/Inventory/i.test(t.option+' '+t.text) && (t.uid>>>16)===548","inventory-tab");
        await first.waitFor("!client.widgetManager.isEffectivelyHidden((149<<16))");
        await clickTarget(first,"/Combat/i.test(t.option+' '+t.text) && (t.uid>>>16)===548","combat-tab");
        await first.waitFor("!client.widgetManager.isEffectivelyHidden((593<<16))");
        await look(first,"native-combat-styles");
        await clickTarget(first,"/Settings|Options/i.test(t.option+' '+t.text) && (t.uid>>>16)===548","settings-tab");
        await first.waitFor("!client.widgetManager.isEffectivelyHidden((116<<16))");
        await clickTarget(first,"(t.uid>>>16)===116 && t.option==='Display'","display-settings");
        await look(first,"native-settings");
        await clickTarget(first,"/Inventory/i.test(t.option+' '+t.text) && (t.uid>>>16)===548","inventory-return");

        await move(first,3369,3265,"ground-click-walk");
        const before=await first.eval("eyes.state().camera"),world=await canvasPoint(first,250,170);
        await look(first,"camera-before");
        await first.scroll(world.x,world.y,-120);
        await first.waitFor(`eyes.state().camera.zoom!==${before.zoom}`);
        const zoomed=await first.eval("eyes.state().camera");
        await first.scroll(world.x,world.y,120);
        await first.waitFor(`eyes.state().camera.zoom!==${zoomed.zoom}`);
        await first.key("ArrowLeft",{hold:300});
        await first.waitFor(`eyes.state().camera.yaw!==${before.yaw}`);
        const rotated=await first.eval("eyes.state().camera");
        await first.key("ArrowUp",{hold:200});
        await first.waitFor(`eyes.state().camera.pitch!==${rotated.pitch}`);
        await look(first,"camera-after");

        await second.open({username:names[1],password:"NativeTest2026"});
        await second.waitFor("eyes.duel()?.self && eyes.state().rootInterface===548");
        await move(second,3367,3265,"second-player-ground-walk");
        const text="Hello from the original chatbox";
        await speak(first,text);
        await second.waitFor(`eyes.chat(20).some(m=>m.text===${JSON.stringify(text)})`);
        const speaker=(await first.bridge("duel")).self.id;
        const overhead=`client.playerEcs.getOverheadChat(client.playerEcs.getIndexForServerId(${speaker}))`;
        await second.waitFor(`${overhead}?.text===${JSON.stringify(text)}`,5000);
        assert.equal((await second.eval(overhead)).color,0,"native overhead speech is yellow");
        await look(second,"native-yellow-overhead");
        await second.waitFor(`!${overhead}`,8000);
        assert.equal((await second.chat(30)).filter(m=>m.text===text).length,1,"public speech is delivered once");
        await look(second,"overhead-expired-history-remains");

        await first.page.evaluate(()=>{
            window.__nativeContextEvents=[];
            // Inspect the original event after dispatch; React cancels it later in capture.
            window.addEventListener("contextmenu",event=>window.__nativeContextEvents.push(event),true);
        });
        await first.waitFor(`eyes.players(15).some(p=>p.name.toLowerCase()===${JSON.stringify(names[1])} && p.screen)`);
        const other=(await first.players()).find(p=>p.name.toLowerCase()===names[1]);
        await look(first,"player-menu-before");
        const menu=await openWorldMenu(first,other.screen,"Challenge",other.serverId);
        assert.ok(menu.entries.some(e=>e.action==="Trade with"),"native menu retains trading");
        assert.ok(menu.entries.some(e=>e.action==="Walk here"),"native menu retains walking");
        await look(first,"native-player-choose-option");
        assert.equal(await first.page.locator("[role='menu'][aria-label='Choose option']").count(),0,"player menu is rendered by the original client");
        const events=await first.page.evaluate(()=>window.__nativeContextEvents.map(event=>event.defaultPrevented));
        assert.ok(events.length>0 && events.every(Boolean),"browser context menu is prevented");
        await clickTarget(first,"t.id.startsWith('__menu_opt_') && /^Challenge /.test(t.text)","native-challenge-option");
        await first.page.getByRole("dialog",{name:/Challenge/}).waitFor({state:"visible"});
        await look(first,"native-menu-opens-duel-weapon-dialog");
        await first.key("Escape");
    }

    // Ground clicking is covered above. Use the normal walk packet to place the
    // bank fixture, avoiding a camera-dependent long-distance click under the HUD.
    await look(first,"native-bank-approach-before");
    await first.walk(3382,3268);
    await first.waitFor("eyes.state().tile.x===3382 && eyes.state().tile.y===3268",30000);
    await look(first,"native-bank-approach-after");
    const bankPoint=await first.tileToScreen(3381,3269,0);
    assert.ok(bankPoint,"native bank chest is visible");
    await look(first,"bank-chest-before");
    await openWorldMenu(first,bankPoint,"Bank",3194);
    await look(first,"native-bank-menu");
    await clickTarget(first,"t.id.startsWith('__menu_opt_') && /^Bank /.test(t.text)","bank-open");
    await first.waitFor("eyes.state().openWidgets.some(w=>w.groupId===12)");
    await look(first,"original-bank-interface");
    await clickTarget(first,"t.uid===((12<<16)|41)","native-deposit-inventory");
    await first.waitFor("eyes.duel().wallet.inventory.gold===0 && eyes.duel().wallet.bank.gold===1000000");
    await look(first,"native-bank-deposited-coins");
    await clickTarget(first,"(t.uid>>>16)===12 && /Withdraw/i.test(t.option+' '+t.text) && /Coins/i.test(t.target+' '+t.text)","bank-coins-menu",{button:"right"});
    await clickTarget(first,"t.id.startsWith('__menu_opt_') && /^Withdraw-All /.test(t.text)","native-withdraw-coins");
    await first.waitFor("eyes.duel().wallet.inventory.gold===1000000 && eyes.duel().wallet.bank.gold===0");
    await clickTarget(first,"(t.uid>>>16)===12 && t.option==='Close'","native-bank-close");
    await first.waitFor("!eyes.state().openWidgets.some(w=>w.groupId===12)");
    await look(first,"native-foundation-complete");
    assert.equal(first.errors.length,0,JSON.stringify(first.errors));
    assert.equal(second.errors.length,0,JSON.stringify(second.errors));
    console.log(bankOnly ? "Native bank passed: actual chest menu, original bank interface, deposit and withdrawal." :
        "Native foundation passed: fixed client, tabs, real walking, camera, native public chat/overhead, player menu, challenge dialog and original bank deposit/withdraw.");
} catch(error) {
    console.error(`Native foundation failed at ${step}:`,error);
    if(first.isOpen) {
        await look(first,"99-failure").catch(()=>{});
        await writeFile(new URL("failure-details.json",directory),JSON.stringify({
            targets:await first.eval(targetsExpression).catch(()=>[]),menu:await first.menu().catch(()=>null),
            console:first.consoleLog({last:80,pattern:"error|warn|bank|widget|chat"}),errors:first.errors},null,2));
    }
    process.exitCode=1;
} finally { await second.close(); await first.close(); }
