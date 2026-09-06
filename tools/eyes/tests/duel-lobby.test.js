import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { GameEyes } from "../src/GameEyes.js";

// Run against an already-running local duel client/server. Every normal action
// below uses the visible UI; packets are used only for adversarial replay checks.
const red = new GameEyes(), blue = new GameEyes();
const suffix = Date.now().toString(36).slice(-7);
const names = {red:`lr${suffix}`,blue:`lb${suffix}`};
const password = "LobbyTest2026";
// The central paved crossing stays clear, close to new-account arrival tiles,
// and within the normal player-follow camera for real click-to-walk checks.
const courtyardTiles = {red:{x:3375,y:3232},blue:{x:3379,y:3232}};
const directory = new URL("./out/duel-lobby/", import.meta.url);
const snapshot = (game) => game.bridge("duel");
const until = (game, expression, timeout = 25000) => game.waitFor(expression, timeout);
const button = (game, name) => game.page.getByRole("button", {name,exact:true});
let step = "startup";
let menuKeyboardChecked = false;

async function look(game, label) {
    step = label;
    const {state,image} = await game.look({quality:90});
    const duel = await snapshot(game);
    await writeFile(new URL(`${label}.jpg`,directory),Buffer.from(image.base64,"base64"));
    await writeFile(new URL(`${label}.json`,directory),JSON.stringify({state,duel},null,2));
    console.log(JSON.stringify({step:label,tile:state.tile,status:duel.status,wallet:duel.wallet}));
}

async function move(game,x,y) {
    await game.clickTile(x,y,0);
    await until(game,`eyes.state().tile.x === ${x} && eyes.state().tile.y === ${y}`);
}

async function contextPlayer(game,name,action) {
    await until(game,`eyes.players(30).some(p => p.name.toLowerCase() === ${JSON.stringify(name.toLowerCase())} && p.screen)`);
    const actor = (await game.players(30)).find(p=>p.name.toLowerCase()===name.toLowerCase());
    assert.ok(actor?.screen,"the other human's rendered model is on screen");
    const item = game.page.getByRole("menuitem",{name:`${action} ${actor.name}`,exact:true});
    // The bridge projects feet; probe a few points up the visible body, never an
    // unrelated fixed screen coordinate or a synthetic context-menu event.
    let hitOffset = 0;
    for (const offset of [10,20,0,30]) {
        await game.click(actor.screen.x,actor.screen.y-offset,{button:"right"});
        try { await item.waitFor({state:"visible",timeout:900}); hitOffset = offset; break; }
        catch { await game.key("Escape"); }
    }
    await item.waitFor({state:"visible",timeout:2500});
    await look(game,`${step}-right-click-menu`);
    if (!menuKeyboardChecked) {
        const menu = game.page.getByRole("menu", {name:"Choose option",exact:true});
        await game.key("ArrowDown");
        assert.match(await game.page.evaluate(() => document.activeElement?.textContent ?? ""), /Trade with/, "arrow keys move between player menu actions");
        await game.key("Escape");
        await menu.waitFor({state:"detached"});
        await look(game,`${step}-escape-dismissed-menu`);
        await game.click(actor.screen.x,actor.screen.y-hitOffset,{button:"right"});
        await item.waitFor({state:"visible"});
        menuKeyboardChecked = true;
    }
    await item.click();
}

async function bank(game,direction,currency,amount) {
    await game.page.getByRole("group",{name:"Bank action",exact:true}).getByRole("button",{name:direction,exact:true}).click();
    await game.page.getByRole("group",{name:"Currency",exact:true}).getByRole("button",{name:currency,exact:true}).click();
    const before = (await snapshot(game)).wallet;
    const field = currency.toLowerCase(), source = direction==="Deposit" ? "inventory" : "bank";
    await game.page.locator("#bank-amount").fill(String(amount));
    await game.page.locator(".duel-bank-amount").getByRole("button",{name:direction,exact:true}).click();
    await until(game,`eyes.duel().wallet.${source}.${field} === ${before[source][field]-amount}`);
}

async function tokens(game,count) {
    for (let index=0;index<count;index++) {
        const before = (await snapshot(game)).wallet.inventory.platinum;
        await button(game,"1,000 gold → 1 token").click();
        await until(game,`eyes.duel().wallet.inventory.platinum === ${before+1}`);
    }
}

async function offer(game,gold,platinum,trading) {
    await game.page.getByRole("spinbutton",{name:"Your gold offer",exact:true}).fill(String(gold));
    await game.page.getByRole("spinbutton",{name:"Your platinum offer",exact:true}).fill(String(platinum));
    await button(game,"Save offer").click();
    const key = trading ? "trade.selfOffer" : "stake.self";
    await until(game,`eyes.duel().${key}.gold === ${gold} && eyes.duel().${key}.platinum === ${platinum}`);
}

async function reviewBoth(trading) {
    await button(red,"Accept offer").click();
    await button(blue,"Accept offer").click();
    const expression=trading ? "eyes.duel().trade?.stage === 'review'" : "eyes.duel().status === 'review'";
    await until(red,expression); await until(blue,expression);
}

async function challenge(from,to,name,weapon) {
    await contextPlayer(from,name,"Challenge");
    const choice = from.page.getByRole("group",{name:"Duel weapon",exact:true});
    await choice.getByRole("button",{name:weapon==="dagger" ? /Dragon dagger P\+\+/ : /Abyssal whip/}).click();
    await button(from,"Send challenge").click();
    await button(to,"Accept challenge").click();
    await until(from,"eyes.duel().status === 'staking'");
    await until(to,"eyes.duel().status === 'staking'");
    assert.equal((await snapshot(from)).agreedWeaponId,weapon==="dagger" ? 5698 : 4151);
}

function resultWallets(beforeRed,beforeBlue,redOffer,blueOffer,winner) {
    const result=[structuredClone(beforeRed),structuredClone(beforeBlue)];
    for (const currency of ["gold","platinum"]) {
        result[0].inventory[currency]-=redOffer[currency];
        result[1].inventory[currency]-=blueOffer[currency];
        result[winner].inventory[currency]+=redOffer[currency]+blueOffer[currency];
    }
    return result;
}

async function returnToLobby(game) {
    if ((await snapshot(game)).status === "finished") {
        const returnButton=button(game,"Return to courtyard");
        if (await returnButton.count()) await returnButton.click();
    }
    await until(game,"eyes.duel().status === 'idle' && eyes.duel().location === 'lobby'");
}

try {
    await mkdir(directory,{recursive:true});
    await red.open({username:names.red,password});
    await blue.open({username:names.blue,password});
    await until(red,"eyes.duel().self && eyes.duel().location === 'lobby'");
    await until(blue,"eyes.duel().self && eyes.duel().location === 'lobby'");
    for (const game of [red,blue]) assert.deepEqual((await snapshot(game)).wallet,{inventory:{gold:1_000_000,platinum:0},bank:{gold:0,platinum:0}});
    await look(red,"01-custom-courtyard");
    await move(red,courtyardTiles.red.x,courtyardTiles.red.y);
    await move(blue,courtyardTiles.blue.x,courtyardTiles.blue.y);
    await until(red,`eyes.players(30).some(p=>p.name.toLowerCase()===${JSON.stringify(names.blue)})`);
    await until(blue,`eyes.players(30).some(p=>p.name.toLowerCase()===${JSON.stringify(names.red)})`);
    await look(red,"02-two-humans-roaming");

    await button(red,"Bank & inventory").click();
    await bank(red,"Deposit","Gold",100_000);
    await bank(red,"Withdraw","Gold",25_000);
    await tokens(red,3);
    await bank(red,"Deposit","Platinum",1);
    await bank(red,"Withdraw","Platinum",1);
    await look(red,"03-personal-bank-and-tokens");
    await button(red,"Close Bank & inventory").click();
    assert.deepEqual((await snapshot(red)).wallet,{inventory:{gold:922_000,platinum:3},bank:{gold:75_000,platinum:0}});
    await button(blue,"Bank & inventory").click(); await tokens(blue,2);
    await button(blue,"Close Bank & inventory").click();
    assert.equal((await snapshot(blue)).wallet.bank.gold,0,"the other account does not share a bank");

    step="04-trade";
    await contextPlayer(red,names.blue,"Trade with");
    await button(blue,"Accept trade").click();
    await until(red,"!!eyes.duel().trade"); await until(blue,"!!eyes.duel().trade");
    await offer(red,5000,1,true);
    await button(red,"Accept offer").click();
    await until(red,"eyes.duel().trade.selfAccepted");
    await offer(blue,8000,0,true);
    await until(red,"!eyes.duel().trade.selfAccepted && eyes.duel().trade.opponentOffer.gold === 8000");
    await reviewBoth(true);
    const reviewed=await snapshot(red);
    await button(red,"Confirm trade").click();
    await until(blue,"eyes.duel().trade.opponentAccepted");
    await button(blue,"Edit offer").click();
    await until(red,"eyes.duel().trade.stage === 'offer' && !eyes.duel().trade.selfAccepted");
    // An old confirmation packet may arrive after an offer edit; it cannot approve the new revision.
    await red.say(`::duel trade_confirm ${reviewed.trade.id} ${reviewed.trade.revision}`);
    await until(red,"/changed/.test(eyes.duel().message)");
    assert.equal((await snapshot(red)).trade.selfAccepted,false);
    await look(red,"05-trade-edit-resets-approval");
    await reviewBoth(true);
    await button(red,"Confirm trade").click(); await button(blue,"Confirm trade").click();
    await until(red,"!eyes.duel().trade && eyes.duel().wallet.inventory.gold === 925000");
    await until(blue,"!eyes.duel().trade && eyes.duel().wallet.inventory.gold === 995000");
    assert.equal((await snapshot(red)).wallet.inventory.platinum,2);
    assert.equal((await snapshot(blue)).wallet.inventory.platinum,3);
    await look(red,"06-trade-complete");

    step="07-dagger-challenge";
    await challenge(red,blue,names.blue,"dagger");
    const beforeRed=(await snapshot(red)).wallet,beforeBlue=(await snapshot(blue)).wallet;
    const redOffer={gold:10000,platinum:1},blueOffer={gold:20000,platinum:2};
    await offer(red,redOffer.gold,redOffer.platinum,false);
    await offer(blue,blueOffer.gold,blueOffer.platinum,false);
    await reviewBoth(false);
    await look(red,"08-final-duel-stake-review");
    await button(red,"Confirm & fight").click(); await button(blue,"Confirm & fight").click();
    await until(red,"eyes.duel().status === 'fighting'");
    await until(blue,"eyes.duel().status === 'fighting'");
    for (const game of [red,blue]) {
        const duel=await snapshot(game);
        assert.equal(duel.self.weaponId,5698); assert.equal(duel.opponent.weaponId,5698);
        assert.equal(await game.page.getByRole("group",{name:"Duel weapon",exact:true}).count(),0,"weapon picker is absent in combat");
    }
    assert.equal((await snapshot(red)).wallet.inventory.gold,beforeRed.inventory.gold-redOffer.gold,"stake is debited into escrow before combat");
    const redCamera=(await red.state()).camera,blueCamera=(await blue.state()).camera;
    assert.equal(redCamera.yaw,blueCamera.yaw); assert.equal(redCamera.pitch,blueCamera.pitch);
    await red.say("::duel weapon whip");
    await until(red,"/fixed|locked/.test(eyes.duel().message)");
    assert.equal((await snapshot(red)).self.weaponId,5698,"forged weapon swap is rejected by server");
    await red.page.getByRole("button",{name:/^Special attack/}).click();
    await button(blue,"Attack").click();
    await until(red,"eyes.duel().self.specialEnergy <= 75",30000);
    await until(red,"eyes.duel().self.hp < 99 || eyes.duel().opponent.hp < 99",30000);
    await look(red,"09-real-dagger-combat");
    let winner=0;
    if (process.env.EYES_FULL_DUEL === "1") {
        await until(red,"eyes.duel().status === 'finished'",180000);
        const result=await snapshot(red);
        winner=result.winnerId===result.self.id ? 0 : 1;
        assert.ok(result.self.hp===0 || result.opponent.hp===0,"real combat reaches a death");
    } else {
        await button(blue,"Forfeit duel").click();
        await until(red,"eyes.duel().status === 'finished'");
        assert.equal((await snapshot(red)).winnerId,(await snapshot(red)).self.id);
    }
    const expected=resultWallets(beforeRed,beforeBlue,redOffer,blueOffer,winner);
    await until(red,`eyes.duel().wallet.inventory.gold === ${expected[0].inventory.gold}`);
    await until(blue,`eyes.duel().wallet.inventory.gold === ${expected[1].inventory.gold}`);
    assert.deepEqual((await snapshot(red)).wallet,expected[0]);
    assert.deepEqual((await snapshot(blue)).wallet,expected[1]);
    await look(red,"10-stake-paid-once");
    await returnToLobby(red); await returnToLobby(blue);

    await move(red,courtyardTiles.red.x,courtyardTiles.red.y);
    await move(blue,courtyardTiles.blue.x,courtyardTiles.blue.y);
    step="11-whip-challenge";
    await challenge(blue,red,names.red,"whip");
    await reviewBoth(false);
    await button(red,"Confirm & fight").click(); await button(blue,"Confirm & fight").click();
    await until(red,"eyes.duel().status === 'fighting'");
    await until(blue,"eyes.duel().status === 'fighting'");
    assert.equal((await snapshot(red)).self.weaponId,4151);
    assert.equal((await snapshot(blue)).self.weaponId,4151);
    await look(blue,"12-whip-locked-for-both");
    await button(blue,"Forfeit duel").click();
    await until(red,"eyes.duel().status === 'finished'");
    await returnToLobby(red); await returnToLobby(blue);
    assert.deepEqual((await snapshot(red)).wallet,expected[0],"zero-stake rematch cannot mint currency");

    await button(red,"Sign out").click();
    await button(red,"Enter the arena").waitFor({state:"visible",timeout:20000});
    await red.reload();
    await button(red,"Enter the arena").waitFor({state:"visible",timeout:120000});
    await red.page.getByLabel("Player name",{exact:true}).fill(names.red);
    await red.page.getByLabel("Password",{exact:true}).fill(password);
    await button(red,"Enter the arena").click(); await red.waitForLogin();
    // Login completes before the reloaded page has finished consuming world data.
    await until(red,"eyes.duel().location === 'lobby' && !!eyes.duel().self",60000);
    assert.deepEqual((await snapshot(red)).wallet,expected[0],"reloaded account restores inventory and bank without a second starter grant");
    await look(red,"13-reloaded-persistent-account");
    assert.equal(red.errors.length,0,JSON.stringify(red.errors));
    assert.equal(blue.errors.length,0,JSON.stringify(blue.errors));
    console.log("Duel lobby live UI passed: custom courtyard, roaming, right-click challenge/trade, bank, tokens, two-step consent, fixed weapons, real damage, escrow payout, and account persistence.");
} catch (error) {
    console.error(`Duel lobby failed at ${step}:`,error);
    if (red.isOpen) await look(red,"99-failure-red").catch(()=>{});
    if (blue.isOpen) await look(blue,"99-failure-blue").catch(()=>{});
    console.error(JSON.stringify({errors:{red:red.errors,blue:blue.errors},network:{red:red.networkLog({failedOnly:true}),blue:blue.networkLog({failedOnly:true})}}));
    process.exitCode=1;
} finally {
    await Promise.all([red.close(),blue.close()]);
}
