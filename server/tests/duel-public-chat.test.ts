import assert from "node:assert/strict";
import type { WebSocket } from "ws";
import { encodeClientMessage } from "../../client/network/packet/ClientBinaryEncoder";
import { decodeServerPacket } from "../../client/network/packet/ServerBinaryDecoder";
import { decodeClientPacket } from "../src/network/packet/ClientBinaryDecoder";
import { registerChatHandler } from "../src/network/handlers/chatHandler";
import { ChatBroadcaster } from "../src/network/broadcast/ChatBroadcaster";
import type { BroadcastContext } from "../src/network/broadcast/BroadcastDomain";
import type { MessageContext, MessageHandler, MessageRouter } from "../src/network/MessageRouter";
import type { MessageHandlerServices } from "../src/network/MessageHandlers";
import type { PlayerState } from "../src/game/player";
import type { ChatMessageSnapshot } from "../src/game/systems/BroadcastScheduler";
import type { TickFrame } from "../src/game/tick/TickPhaseOrchestrator";

let recipients = [1,2,3];
const sender = {id:1,name:"Alice",gamemode:{getPublicChatRecipientIds:()=>recipients}} as unknown as PlayerState;
const messages: ChatMessageSnapshot[] = [];
let handle: MessageHandler<"chat"> = () => { throw Error("Handler not registered"); };
registerChatHandler({register:(_type:string, handler:MessageHandler<"chat">)=>{handle=handler;}} as unknown as MessageRouter,
    {queueChatMessage:(message:ChatMessageSnapshot)=>messages.push(message)} as unknown as MessageHandlerServices);
function speak(text: string, messageType = "public") {
    const parsed = decodeClientPacket(encodeClientMessage({type:"chat",payload:{text,messageType}}));
    assert.equal(parsed?.type, "chat");
    handle({ws:{} as WebSocket, player:sender, type:"chat", payload:parsed!.payload} as MessageContext<"chat">);
}
speak("Hello distant players");
assert.equal(messages.length, 1);
assert.deepEqual(messages[0].targetPlayerIds, [1,2,3]);
assert.equal(messages[0].playerId, 1, "area chat retains the authenticated speaker for model overheads");
assert.equal(messages[0].standalone, true, "area chat bypasses the nearby player-sync channel");
assert.equal(messages[0].from, "Alice");
const delivered = new Map<number, ReturnType<typeof decodeServerPacket>>();
const broadcaster = new ChatBroadcaster();
broadcaster.flush({chatMessages:messages} as TickFrame, {
    getSocketByPlayerId:(id:number)=>({id}) as unknown as WebSocket,
    sendWithGuard:(socket:WebSocket, packet:Uint8Array)=>delivered.set((socket as unknown as {id:number}).id,decodeServerPacket(packet)),
} as unknown as BroadcastContext);
assert.deepEqual([...delivered.keys()], [1,2,3], "all explicit recipients receive the existing binary public packet");
for (const result of delivered.values()) {
    assert.equal(result?.type, "chat");
    assert.equal((result?.payload as {text:string}).text, "Hello distant players");
    assert.equal((result?.payload as {playerId:number}).playerId, 1, "the binary packet preserves speaker identity for every audience member");
}
delivered.clear();
broadcaster.flush({chatMessages:[{...messages[0],standalone:false}]} as TickFrame, {
    getSocketByPlayerId:(id:number)=>({id}) as unknown as WebSocket,
    sendWithGuard:(socket:WebSocket, packet:Uint8Array)=>delivered.set((socket as unknown as {id:number}).id,decodeServerPacket(packet)),
} as unknown as BroadcastContext);
assert.equal(delivered.size, 0, "ordinary nearby-sync public chat is not also broadcast as a standalone line");
messages.length = 0; recipients = [];
speak("Not connected"); assert.equal(messages.length, 0, "an empty audience must not fall back to broadcasting globally");
recipients = [1,2];
speak("x".repeat(500), "game");
assert.equal(messages[0].text.length, 200);
assert.equal(messages[0].messageType, "public", "a client cannot impersonate server notices through the public chat input");
console.log("duel public chat: real chat routing, distant recipients, binary delivery, no nearby duplicate, empty audience and limits passed");
