import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import { FriendsChatRank } from "../../client/common/social/FriendsChat";
import { decodeServerPacket } from "../../client/network/packet/ServerBinaryDecoder";
import { encodeClientMessage } from "../../client/network/packet/ClientBinaryEncoder";
import { GameEventBus } from "../src/game/events/GameEventBus";
import { FriendsChatService } from "../src/game/services/FriendsChatService";
import { decodeClientPacket } from "../src/network/packet/ClientBinaryDecoder";

const database = new DatabaseSync(":memory:");
database.exec(`
    CREATE TABLE friends_chat_settings (
        owner_key TEXT PRIMARY KEY, owner_name TEXT NOT NULL, channel_name TEXT,
        entry_rank INTEGER NOT NULL DEFAULT -1, talk_rank INTEGER NOT NULL DEFAULT -1,
        kick_rank INTEGER NOT NULL DEFAULT 2, updated_at TEXT NOT NULL
    );
    CREATE TABLE social_friends (
        owner_key TEXT NOT NULL, friend_key TEXT NOT NULL, friend_name TEXT NOT NULL,
        rank INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (owner_key, friend_key)
    );
    CREATE TABLE social_ignores (
        owner_key TEXT NOT NULL, ignored_key TEXT NOT NULL, ignored_name TEXT NOT NULL,
        PRIMARY KEY (owner_key, ignored_key)
    );
    CREATE TABLE friends_chat_last_channels (
        account_key TEXT PRIMARY KEY, owner_key TEXT NOT NULL
    );
`);

type TestPlayer = { id: number; name: string };
type TestSocket = { playerId: number; packets: Uint8Array[] };

const owner: TestPlayer = { id: 1, name: "ChannelOwner" };
const ranked: TestPlayer = { id: 2, name: "RankedFriend" };
const unranked: TestPlayer = { id: 3, name: "Unranked" };
const players = [owner, ranked, unranked];
const sockets = new Map(players.map((player) => [player.id, { playerId: player.id, packets: [] }]));
const messages: Array<{ text: string; chatType?: number; targetPlayerIds?: number[] }> = [];
const widgetEvents: Array<{ playerId: number; event: Record<string, unknown> }> = [];

const services = {
    eventBus: new GameEventBus(),
    players: {
        getSocketByPlayerId: (id: number) => sockets.get(id),
        getConnectedPlayerByName: (name: string) =>
            players.find((player) => player.name.toLowerCase() === name.toLowerCase()),
    },
    networkLayer: {
        withDirectSendBypass: (_context: string, fn: () => void) => fn(),
        sendWithGuard: (socket: TestSocket, packet: Uint8Array) => socket.packets.push(packet),
    },
    messagingService: {
        sendGameMessageToPlayer: (player: TestPlayer, text: string) =>
            messages.push({ text, targetPlayerIds: [player.id] }),
        queueChatMessage: (message: (typeof messages)[number]) => messages.push(message),
    },
    queueWidgetEvent: (playerId: number, event: Record<string, unknown>) =>
        widgetEvents.push({ playerId, event }),
} as any;

const service = new FriendsChatService(services, "", database);

const setupOpens: Array<{ groupId: number; options: Record<string, unknown> }> = [];
const setupPlayer = {
    ...owner,
    displayMode: 0,
    widgets: {
        open: (groupId: number, options: Record<string, unknown>) =>
            setupOpens.push({ groupId, options }),
    },
};
assert.equal(service.handleWidgetAction(setupPlayer as any, 7, 20, undefined, 1), true);
assert.deepEqual(setupOpens, [
    {
        groupId: 94,
        options: {
            targetUid: (548 << 16) | 15,
            type: 0,
            modal: true,
            scope: "modal",
        },
    },
]);

const joinPacket = encodeClientMessage({
    type: "friends_chat_action",
    payload: { action: "join", name: owner.name },
});
assert.deepEqual(decodeClientPacket(joinPacket), {
    type: "friends_chat_action",
    payload: { action: "join", name: owner.name, rank: 0 },
});

service.handleWidgetAction(owner as any, 94, 10, undefined, 1);
assert.deepEqual(widgetEvents.at(-1), {
    playerId: owner.id,
    event: {
        action: "run_script",
        scriptId: 109,
        args: ["Enter a name for your chat-channel:"],
    },
});
assert.equal(service.handleNameInput(owner as any, "Owner Chat"), true);
service.handleWidgetAction(owner as any, 94, 19, undefined, 5);
assert.equal(
    (database
        .prepare("SELECT kick_rank AS kickRank FROM friends_chat_settings WHERE owner_key = ?")
        .get("channelowner") as { kickRank: number }).kickRank,
    FriendsChatRank.Sergeant,
);

service.handleAction(owner as any, { action: "add_friend", name: ranked.name });
service.handleAction(owner as any, {
    action: "set_friend_rank",
    name: ranked.name,
    rank: FriendsChatRank.Corporal,
});
service.handleAction(ranked as any, { action: "join", name: owner.name });

const latestRankedPacket = sockets.get(ranked.id)!.packets.at(-1)!;
const rankedSnapshot = decodeServerPacket(latestRankedPacket) as any;
assert.equal(rankedSnapshot.type, "friends_chat");
assert.equal(rankedSnapshot.payload.channel.name, "Owner Chat");
assert.equal(rankedSnapshot.payload.channel.localRank, FriendsChatRank.Corporal);
assert.equal(rankedSnapshot.payload.channel.members.length, 2);

service.handleWidgetAction(owner as any, 94, 13, undefined, 3);
service.handleAction(unranked as any, { action: "join", name: owner.name });
assert.ok(messages.some((message) => message.text.includes("high enough rank to join")));

service.handleWidgetAction(owner as any, 94, 16, undefined, 8);
service.handleChat(ranked as any, "This should be blocked");
assert.ok(messages.some((message) => message.text.includes("high enough rank to talk")));

service.handleWidgetAction(owner as any, 94, 16, undefined, 1);
service.handleChat(ranked as any, "Hello channel");
const channelMessage = messages.find((message) => message.text === "Hello channel");
assert.equal(channelMessage?.chatType, 9);
assert.deepEqual(channelMessage?.targetPlayerIds?.sort(), [owner.id, ranked.id]);

service.handleAction(owner as any, { action: "kick", name: ranked.name });
service.handleAction(ranked as any, { action: "join", name: owner.name });
assert.ok(messages.some((message) => message.text.includes("temporarily banned")));

database.close();
console.log("friends-chat.test.ts: all tests passed");
