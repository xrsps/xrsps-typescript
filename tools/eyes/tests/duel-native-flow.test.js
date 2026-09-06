import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { GameEyes } from "../src/GameEyes.js";

const red = new GameEyes(), blue = new GameEyes();
const suffix = Date.now().toString(36).slice(-7), names = [`fa${suffix}`, `fb${suffix}`];
const password = "NativeFlow2026", output = new URL("./out/duel-native-flow/", import.meta.url);
let step = "startup", shot = 0;
const snapshot = game => game.bridge("duel");
const button = (game, name) => game.page.getByRole("button", { name, exact: true });
const targets = `(() => { const canvas=client.renderer.widgetsOverlay?.getGLCanvas();
    return (canvas?.__clicks?.targets??[]).filter(t=>t.rect.w>0 && t.rect.h>0 &&
    (t.widgetUid===undefined || !client.widgetManager.isEffectivelyHidden(t.widgetUid)))
    .map(t=>({id:t.id,uid:t.widgetUid,rect:t.rect,text:t.hoverText??"",
        option:t.primaryOption?.option??"",target:t.primaryOption?.target??""})); })()`;

async function look(game, label) {
    step = label;
    const result = await game.look({quality:90}), duel = await snapshot(game);
    const file = `${String(++shot).padStart(2,"0")}-${label}`;
    await writeFile(new URL(`${file}.jpg`,output),Buffer.from(result.image.base64,"base64"));
    await writeFile(new URL(`${file}.json`,output),JSON.stringify({state:result.state,duel,menu:await game.menu()},null,2));
    console.log(JSON.stringify({step:label,tile:result.state.tile,status:duel.status,wallet:duel.wallet}));
}
async function clickTarget(game, condition, label, mouseButton="left") {
    await game.waitFor(`(${targets}).some(t=>${condition})`,12000);
    const found = await game.eval(`(${targets}).find(t=>${condition})`), r=found.rect;
    const point=await game.eval(`(() => { const c=client.renderer.canvas,r=c.getBoundingClientRect();
        return {x:r.left+${r.x+r.w/2}*r.width/c.width,y:r.top+${r.y+r.h/2}*r.height/c.height}; })()`);
    await look(game,`${label}-before`);
    await game.click(point.x,point.y,{button:mouseButton});
    await look(game,`${label}-after`);
}
async function menuAction(game, action, name) {
    step=`native-${action.toLowerCase().replaceAll(" ","-")}-${name}`;
    await game.waitFor(`eyes.players(30).some(p=>p.name.toLowerCase()===${JSON.stringify(name)} && p.screen)`);
    const probes=[];
    for (const offset of [12,24,0,36]) {
        const actor=(await game.players(30)).find(p=>p.name.toLowerCase()===name);
        const point={x:actor.screen.x,y:actor.screen.y-offset};
        const hover=await game.hover(point.x,point.y);
        await game.click(point.x,point.y,{button:"right"});
        // Software rendering may not process the native right-click until the
        // next frame. Observe the real menu instead of assuming mouseup did so.
        await game.waitFor("eyes.menu().open",1500).catch(()=>{});
        const menu=await game.menu();
        probes.push({actor,point,hover,menu});
        if(menu.open && menu.entries.some(entry=>entry.action===action && entry.identifier===actor.serverId)) {
            await clickTarget(game,`t.id.startsWith('__menu_opt_') && t.text.startsWith(${JSON.stringify(action+" ")}) && t.text.toLowerCase().includes(${JSON.stringify(name)})`,`${action.toLowerCase().replaceAll(" ","-")}-native-menu`);
            return;
        }
        await game.key("Escape");
    }
    await writeFile(new URL("menu-probes.json",output),JSON.stringify(probes,null,2));
    throw Error(`Native ${action} menu unavailable: ${JSON.stringify(probes)}`);
}
async function move(game, x, y) {
    step=`ground-walk-${x}-${y}`;
    await game.clickTile(x,y,0);
    await game.waitFor(`eyes.state().tile.x===${x} && eyes.state().tile.y===${y}`);
}
async function nativeChat(game,text) {
    await game.page.locator(".game-canvas-stage canvas").first().focus();
    await game.type(text,{enter:true});
}
async function acceptRequest(game, kind) {
    const action=kind==="trade"?"Accept trade":"Accept challenge";
    await clickTarget(game,`(t.uid>>>16)===162 && (${JSON.stringify(action)}===t.option || t.text.includes(${JSON.stringify(action)}))`,`${kind}-native-chat-request`);
}
async function offer(game, gold, platinum, trading=false) {
    await game.page.getByRole("spinbutton",{name:"Your gold offer",exact:true}).fill(String(gold));
    await game.page.getByRole("spinbutton",{name:"Your platinum offer",exact:true}).fill(String(platinum));
    await button(game,"Save offer").click();
    const key=trading?"trade.selfOffer":"stake.self";
    await game.waitFor(`eyes.duel().${key}.gold===${gold} && eyes.duel().${key}.platinum===${platinum}`);
}
async function reviewBoth(trading=false) {
    await button(red,"Accept offer").click(); await button(blue,"Accept offer").click();
    const expression=trading?"eyes.duel().trade?.stage==='review'":"eyes.duel().status==='review'";
    await red.waitFor(expression); await blue.waitFor(expression);
}
const value=wallet=>wallet.inventory.gold+wallet.bank.gold+1000*(wallet.inventory.platinum+wallet.bank.platinum);
async function conservation() {
    const a=await snapshot(red), b=await snapshot(blue);
    assert.equal(value(a.wallet)+value(b.wallet),2_000_000,"trades and settled duels conserve both accounts' combined currency");
}
async function challenge(from,to,name,weapon) {
    await menuAction(from,"Challenge",name);
    await from.page.getByRole("group",{name:"Duel weapon",exact:true}).getByRole("button",{name:weapon==="dagger"?/Dragon dagger P\+\+/:/Abyssal whip/}).click();
    await button(from,"Send challenge").click();
    await to.waitFor("eyes.duel().requests.length>0");
    await acceptRequest(to,"duel");
    await from.waitFor("eyes.duel().status==='staking'");
    await to.waitFor("eyes.duel().status==='staking'");
}
async function combatTab(game) {
    await clickTarget(game,"/Combat/i.test(t.option+' '+t.text) && (t.uid>>>16)===548","native-combat-tab");
    await game.waitFor("!client.widgetManager.isEffectivelyHidden(593<<16)");
}
async function finishFight(weapon, stakeRed, stakeBlue) {
    const before=[(await snapshot(red)).wallet,(await snapshot(blue)).wallet], weaponId=weapon==="dagger"?5698:4151;
    await offer(red,stakeRed.gold,stakeRed.platinum); await offer(blue,stakeBlue.gold,stakeBlue.platinum);
    await reviewBoth(); await look(red,`${weapon}-stake-review`);
    await button(red,"Confirm & fight").click(); await button(blue,"Confirm & fight").click();
    await red.waitFor("eyes.duel().status==='fighting'"); await blue.waitFor("eyes.duel().status==='fighting'");
    for(const game of [red,blue]) {
        const state=await snapshot(game);
        assert.equal(state.self.weaponId,weaponId); assert.equal(state.opponent.weaponId,weaponId);
        assert.equal(await game.page.getByRole("group",{name:"Duel weapon",exact:true}).count(),0);
        await combatTab(game);
        await clickTarget(game,"t.uid===((593<<16)|32)",`${weapon}-native-auto-retaliate`);
        await game.waitFor("client.varManager.getVarp(172)===0");
    }
    await clickTarget(red,"t.uid===((593<<16)|10)",`${weapon}-native-combat-style`);
    await red.waitFor("client.varManager.getVarp(43)===1");
    await clickTarget(red,"t.uid===((593<<16)|39)",`${weapon}-native-special-bar`);
    await menuAction(red,"Attack",names[1]);
    await menuAction(blue,"Attack",names[0]);
    await red.waitFor(`eyes.duel().self.specialEnergy<=${weapon==="dagger"?75:50}`,30000);
    await red.waitFor("eyes.duel().self.hp<99 || eyes.duel().opponent.hp<99",30000);
    await look(red,`${weapon}-native-fighting`);
    // Attempt the retired weapon command as an adversarial packet; it cannot
    // modify either human's agreed weapon or mint a replacement inventory item.
    await red.say(`::duel weapon ${weapon==="dagger"?"whip":"dagger"}`);
    await red.waitFor("/fixed/.test(eyes.duel().message)");
    assert.equal((await snapshot(red)).self.weaponId,weaponId);
    // Both humans attack through the original menu; let native combat reach death.
    for(let interval=0;interval<4 && (await snapshot(red)).status!=="finished";interval++) {
        try { await red.waitFor("eyes.duel().status==='finished'",45000); }
        catch { console.log(JSON.stringify({step:`${weapon}-combat-progress`,duel:await snapshot(red)})); }
    }
    const result=await snapshot(red);
    assert.equal(result.status,"finished","native combat completes with a winner");
    assert.ok(result.self.hp===0 || result.opponent.hp===0,"the fight ends in actual damage/death");
    const winner=result.winnerId===result.self.id?0:1, offers=[stakeRed,stakeBlue];
    for(const currency of ["gold","platinum"]) {
        before[0].inventory[currency]-=offers[0][currency]; before[1].inventory[currency]-=offers[1][currency];
        before[winner].inventory[currency]+=offers[0][currency]+offers[1][currency];
    }
    for(const [i,game] of [red,blue].entries()) {
        assert.deepEqual((await snapshot(game)).wallet,before[i],"winner receives the full stake exactly once");
    }
    await conservation(); await look(red,`${weapon}-paid-victory`);
    for(const game of [red,blue]) {
        if((await snapshot(game)).status==="finished") await button(game,"Return to courtyard").click();
        await game.waitFor("eyes.duel().location==='lobby' && eyes.duel().status==='idle'");
    }
}

try {
    await mkdir(output,{recursive:true});
    await red.open({username:names[0],password});
    await red.waitFor("eyes.duel().self && eyes.state().rootInterface===548");
    await look(red,"original-native-courtyard");
    await move(red,3369,3265);
    await blue.open({username:names[1],password});
    await blue.waitFor("eyes.duel().self && eyes.state().rootInterface===548");
    await look(red,"original-two-human-lobby");
    await move(blue,3367,3265);
    await nativeChat(red,"::duel exchange gold 3000"); await red.waitFor("eyes.duel().wallet.inventory.platinum===3");
    await nativeChat(blue,"::duel exchange gold 2000"); await blue.waitFor("eyes.duel().wallet.inventory.platinum===2");
    await menuAction(red,"Trade with",names[1]); await blue.waitFor("eyes.duel().tradeRequests.length>0");
    await acceptRequest(blue,"trade"); await red.waitFor("!!eyes.duel().trade");
    await offer(red,5000,1,true); await button(red,"Accept offer").click();
    await offer(blue,8000,0,true); await red.waitFor("!eyes.duel().trade.selfAccepted");
    await reviewBoth(true); await button(red,"Confirm trade").click();
    await button(blue,"Edit offer").click(); await red.waitFor("eyes.duel().trade.stage==='offer' && !eyes.duel().trade.selfAccepted");
    await look(red,"trade-edit-resets-both-approvals");
    await reviewBoth(true); await button(red,"Confirm trade").click(); await button(blue,"Confirm trade").click();
    await red.waitFor("!eyes.duel().trade && eyes.duel().wallet.inventory.gold===1000000");
    await blue.waitFor("!eyes.duel().trade && eyes.duel().wallet.inventory.gold===995000");
    assert.equal((await snapshot(red)).wallet.inventory.platinum,2);
    assert.equal((await snapshot(blue)).wallet.inventory.platinum,3);
    await conservation(); await look(red,"native-request-trade-complete");
    await challenge(red,blue,names[1],"dagger");
    await finishFight("dagger",{gold:10000,platinum:1},{gold:20000,platinum:1});
    await move(red,3369,3265); await move(blue,3367,3265);
    await challenge(blue,red,names[0],"whip");
    await finishFight("whip",{gold:2000,platinum:0},{gold:4000,platinum:0});
    const saved=(await snapshot(red)).wallet;
    await combatTab(red);
    await clickTarget(red,"/Logout|Log out/i.test(t.option+' '+t.text) && (t.uid>>>16)===548","native-logout-tab");
    await clickTarget(red,"(t.uid>>>16)===182 && /Logout|Log out/i.test(t.option+' '+t.text)","native-logout");
    await red.waitFor("eyes.state().gameState!=='LOGGED_IN'",20000);
    await red.reload();
    await red.open({username:names[0],password});
    await red.waitFor("eyes.duel().self && eyes.duel().status==='idle'",60000);
    assert.deepEqual((await snapshot(red)).wallet,saved,"reload preserves winnings without another starter grant");
    await look(red,"persistent-account-after-native-logout");
    assert.equal(red.errors.length,0,JSON.stringify(red.errors)); assert.equal(blue.errors.length,0,JSON.stringify(blue.errors));
    console.log("Native two-human flow passed: native challenge/trade request menus, revised consent, dagger/whip combat controls, real deaths, full payout and account reload.");
} catch(error) {
    console.error(`Native flow failed at ${step}:`,error);
    if(red.isOpen) {
        await look(red,"99-failure-red").catch(()=>{});
        await writeFile(new URL("failure-details.json",output),JSON.stringify({targets:await red.eval(targets).catch(()=>[]),
            players:await red.players(30).catch(()=>[]),menu:await red.menu().catch(()=>null),console:red.consoleLog({last:100,pattern:"error|warn|duel|combat|widget|chat"}),errors:red.errors},null,2));
    }
    if(blue.isOpen) await look(blue,"99-failure-blue").catch(()=>{});
    process.exitCode=1;
} finally { await blue.close(); await red.close(); }
