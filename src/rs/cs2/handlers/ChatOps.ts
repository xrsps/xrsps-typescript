/**
 * Chat operations
 *
 * Stack behavior per opcode (from reference):
 * 5000 CHAT_GETFILTER_PUBLIC: pop 0, push 1 int (publicChatMode)
 * 5001 CHAT_SETFILTER: pop 3 ints (public, private, trade), push 0
 * 5002 CHAT_SENDABUSEREPORT: pop 1 string + 2 ints, push 0
 * 5003 CHAT_GETHISTORY_BYTYPEANDLINE: pop 2 ints, push 3 ints + 3 strings
 * 5004 CHAT_GETHISTORY_BYUID: pop 1 int, push 3 ints + 3 strings
 * 5005 CHAT_GETFILTER_PRIVATE: pop 0, push 1 int (privateChatMode, -1 if null)
 * 5008 CHAT_SENDPUBLIC: pop 1 string + 1 int, push 0
 * 5009 CHAT_SENDPRIVATE: pop 2 strings, push 0
 * 5010 CHAT_SENDCLAN: pop 1 string + 2 ints, push 0
 * 5015 CHAT_PLAYERNAME: pop 0, push 1 string
 * 5016 CHAT_GETFILTER_TRADE: pop 0, push 1 int (tradeChatMode)
 * 5017 CHAT_GETHISTORYLENGTH: pop 1 int, push 1 int
 * 5018 CHAT_GETNEXTUID: pop 1 int, push 1 int
 * 5019 CHAT_GETPREVUID: pop 1 int, push 1 int
 * 5020 DOCHEAT: pop 1 string, push 0
 * 5021 CHAT_SETMESSAGEFILTER: pop 1 string, push 0
 * 5022 CHAT_GETMESSAGEFILTER: pop 0, push 1 string
 * 5023 WRITECONSOLE: pop 1 string, push 0
 * 5025 CHAT_GETTIMESTAMPS: pop 0, push 1 int
 * 5030 CHAT_GETHISTORYEX_BYTYPEANDLINE: pop 2 ints, push 4 ints + 4 strings
 * 5031 CHAT_GETHISTORYEX_BYUID: pop 1 int, push 4 ints + 4 strings
 */
import { sendChat } from "../../../network/ServerConnection";
import { chatHistory } from "../ChatHistory";
import { Opcodes } from "../Opcodes";
import type { HandlerMap } from "./HandlerTypes";

export function registerChatOps(handlers: HandlerMap): void {
    // CHAT_GETFILTER_PUBLIC (5000): Returns public chat mode
    handlers.set(Opcodes.CHAT_GETFILTER_PUBLIC, (ctx) => {
        ctx.pushInt(ctx.publicChatMode);
    });

    // CHAT_SETFILTER (5001): Sets all three chat filters
    // Pops: publicMode, privateMode, tradeMode
    handlers.set(Opcodes.CHAT_SETFILTER, (ctx) => {
        ctx.intStackSize -= 3;
        const publicMode = ctx.intStack[ctx.intStackSize];
        const privateMode = ctx.intStack[ctx.intStackSize + 1];
        const tradeMode = ctx.intStack[ctx.intStackSize + 2];

        // Update local state
        ctx.publicChatMode = publicMode;
        ctx.privateChatMode = privateMode;
        ctx.tradeChatMode = tradeMode;

        // Notify server/handler if callback exists
        ctx.setChatFilter?.(publicMode, privateMode, tradeMode);
    });

    // CHAT_SENDABUSEREPORT (5002): Sends abuse report
    // Pops: 1 string (reported name), 2 ints (reason, mute flag)
    handlers.set(Opcodes.CHAT_SENDABUSEREPORT, (ctx) => {
        const _name = ctx.stringStack[--ctx.stringStackSize];
        ctx.intStackSize -= 2;
        const _reason = ctx.intStack[ctx.intStackSize];
        const _muteFlag = ctx.intStack[ctx.intStackSize + 1];
        // Server would handle the abuse report packet
    });

    // CHAT_GETHISTORY_BYTYPEANDLINE (5003): Gets message by type and line
    // Pops: type, line (2 ints)
    // Pushes: count, cycle, sender, prefix, text, friendStatus, timestamp_str, timestamp_int (4 ints + 4 strings)
    // Note: Real CS2 scripts expect 8 values, not 6 as originally documented
    handlers.set(Opcodes.CHAT_GETHISTORY_BYTYPEANDLINE, (ctx) => {
        ctx.intStackSize -= 2;
        const type = ctx.intStack[ctx.intStackSize];
        const line = ctx.intStack[ctx.intStackSize + 1];

        const msg = chatHistory.getFullByTypeAndLine(type, line);
        if (msg) {
            ctx.pushInt(msg.count);
            ctx.pushInt(msg.cycle);
            ctx.pushString(msg.sender);
            ctx.pushString(msg.prefix);
            ctx.pushString(msg.text);
            ctx.pushInt(msg.friendStatus);
            ctx.pushString(""); // timestamp string (used by affixtimestamp)
            ctx.pushInt(0); // timestamp delta
        } else {
            ctx.pushInt(-1);
            ctx.pushInt(0);
            ctx.pushString("");
            ctx.pushString("");
            ctx.pushString("");
            ctx.pushInt(0);
            ctx.pushString("");
            ctx.pushInt(0);
        }
    });

    // CHAT_GETHISTORY_BYUID (5004): Gets message by UID
    // Pops: uid (1 int)
    // Pushes: type, cycle, sender, prefix, text, friendStatus, timestamp_str, timestamp_int (4 ints + 4 strings)
    // Note: Real CS2 scripts expect 8 values, not 6 as originally documented
    handlers.set(Opcodes.CHAT_GETHISTORY_BYUID, (ctx) => {
        const uid = ctx.intStack[--ctx.intStackSize];
        const msg = chatHistory.getByUid(uid);

        if (msg) {
            ctx.pushInt(msg.type);
            ctx.pushInt(msg.cycle);
            ctx.pushString(msg.from);
            ctx.pushString(msg.prefix);
            ctx.pushString(msg.text);
            ctx.pushInt(msg.isFromFriend ? 1 : msg.isFromIgnored ? 2 : 0);
            ctx.pushString(""); // timestamp string (used by affixtimestamp)
            ctx.pushInt(0); // timestamp delta
        } else {
            ctx.pushInt(-1);
            ctx.pushInt(0);
            ctx.pushString("");
            ctx.pushString("");
            ctx.pushString("");
            ctx.pushInt(0);
            ctx.pushString("");
            ctx.pushInt(0);
        }
    });

    // CHAT_GETFILTER_PRIVATE (5005): Returns private chat mode (-1 if not set)
    handlers.set(Opcodes.CHAT_GETFILTER_PRIVATE, (ctx) => {
        ctx.pushInt(ctx.privateChatMode);
    });

    // CHAT_SENDPUBLIC (5008): Sends public chat message
    // Pops: message (string), type (int)
    handlers.set(Opcodes.CHAT_SENDPUBLIC, (ctx) => {
        const message = ctx.stringStack[--ctx.stringStackSize];
        const chatType = ctx.intStack[--ctx.intStackSize];
        // Send the chat message to server
        if (message && message.trim()) {
            sendChat(message, "public", chatType | 0);
            // Clear the chat input buffer (varcstring 335) after sending
            ctx.varManager.setVarcString(335, "");
        }
    });

    // CHAT_SENDPRIVATE (5009): Sends private message
    // Pops: recipient (string), message (string)
    handlers.set(Opcodes.CHAT_SENDPRIVATE, (ctx) => {
        ctx.stringStackSize -= 2;
        const _recipient = ctx.stringStack[ctx.stringStackSize];
        const _message = ctx.stringStack[ctx.stringStackSize + 1];
        // Server would handle the private message packet
    });

    // CHAT_SENDCLAN (5010): Sends clan chat message
    // Pops: message (string), chatType (int), clanIndex (int)
    handlers.set(Opcodes.CHAT_SENDCLAN, (ctx) => {
        const _message = ctx.stringStack[--ctx.stringStackSize];
        ctx.intStackSize -= 2;
        const _chatType = ctx.intStack[ctx.intStackSize];
        const _clanIndex = ctx.intStack[ctx.intStackSize + 1];
        // Server would handle the clan chat packet
    });

    // CHAT_PLAYERNAME (5015): Returns local player's name
    handlers.set(Opcodes.CHAT_PLAYERNAME, (ctx) => {
        const scriptId =
            typeof ctx.currentScriptId === "number" && Number.isFinite(ctx.currentScriptId)
                ? ctx.currentScriptId | 0
                : -1;
        const resolved = ctx.resolveChatPlayerName?.(scriptId);
        ctx.pushString(
            typeof resolved === "string" && resolved.length > 0
                ? resolved
                : ctx.localPlayerName ?? "",
        );
    });

    // CHAT_GETFILTER_TRADE (5016): Returns trade chat mode
    handlers.set(Opcodes.CHAT_GETFILTER_TRADE, (ctx) => {
        ctx.pushInt(ctx.tradeChatMode);
    });

    // CHAT_GETHISTORYLENGTH (5017): Returns message count for type
    handlers.set(Opcodes.CHAT_GETHISTORYLENGTH, (ctx) => {
        const type = ctx.intStack[--ctx.intStackSize];
        ctx.pushInt(chatHistory.getLength(type));
    });

    // CHAT_GETNEXTUID (5018): Returns next message UID after given one
    // In OSRS this returns the "last chat ID" for the message's channel
    handlers.set(Opcodes.CHAT_GETNEXTUID, (ctx) => {
        const currentUid = ctx.intStack[--ctx.intStackSize];
        const msg = chatHistory.getByUid(currentUid);
        if (msg) {
            ctx.pushInt(chatHistory.getNextUid(msg.type, currentUid));
        } else {
            ctx.pushInt(-1);
        }
    });

    // CHAT_GETPREVUID (5019): Returns previous message UID before given one
    handlers.set(Opcodes.CHAT_GETPREVUID, (ctx) => {
        const currentUid = ctx.intStack[--ctx.intStackSize];
        const msg = chatHistory.getByUid(currentUid);
        if (msg) {
            ctx.pushInt(chatHistory.getPrevUid(msg.type, currentUid));
        } else {
            ctx.pushInt(-1);
        }
    });

    // DOCHEAT (5020): Executes a cheat command
    // Pops: command (string)
    // In OSRS, this handles :: commands - the CS2 script strips the :: prefix
    handlers.set(Opcodes.DOCHEAT, (ctx) => {
        const command = ctx.stringStack[--ctx.stringStackSize];
        // Send command to server with :: prefix restored for server-side handling
        if (command && command.trim()) {
            sendChat("::" + command.trim(), "public", 0);
        }
    });

    // CHAT_SETMESSAGEFILTER (5021): Sets the message filter string
    handlers.set(Opcodes.CHAT_SETMESSAGEFILTER, (ctx) => {
        const filter = ctx.stringStack[--ctx.stringStackSize];
        ctx.messageFilter = filter.toLowerCase().trim();
    });

    // CHAT_GETMESSAGEFILTER (5022): Returns the message filter string
    handlers.set(Opcodes.CHAT_GETMESSAGEFILTER, (ctx) => {
        ctx.pushString(ctx.messageFilter);
    });

    // WRITECONSOLE (5023): Writes text to console
    // Pops: text (string)
    handlers.set(Opcodes.WRITECONSOLE, (ctx) => {
        const text = ctx.stringStack[--ctx.stringStackSize];
        if (ctx.writeConsole) {
            ctx.writeConsole(text);
        } else {
            console.log(text);
        }
    });

    // CHAT_GETTIMESTAMPS (5025): Returns 1 if timestamps enabled, 0 otherwise
    handlers.set(Opcodes.CHAT_GETTIMESTAMPS, (ctx) => {
        ctx.pushInt(0); // timestamps disabled by default
    });

    // CHAT_GETHISTORYEX_BYTYPEANDLINE (5030): Extended message info by type/line
    // Pops: type, line (2 ints)
    // Pushes: count, cycle, sender, prefix, text, friendStatus, clan, timestamp (4 ints + 4 strings)
    handlers.set(Opcodes.CHAT_GETHISTORYEX_BYTYPEANDLINE, (ctx) => {
        ctx.intStackSize -= 2;
        const type = ctx.intStack[ctx.intStackSize];
        const line = ctx.intStack[ctx.intStackSize + 1];

        const msg = chatHistory.getFullByTypeAndLine(type, line);
        if (msg) {
            ctx.pushInt(msg.count);
            ctx.pushInt(msg.cycle);
            ctx.pushString(msg.sender);
            ctx.pushString(msg.prefix);
            ctx.pushString(msg.text);
            ctx.pushInt(msg.friendStatus);
            ctx.pushString(""); // clan name (unused in this context)
            ctx.pushInt(0); // timestamp delta (unused)
        } else {
            ctx.pushInt(-1);
            ctx.pushInt(0);
            ctx.pushString("");
            ctx.pushString("");
            ctx.pushString("");
            ctx.pushInt(0);
            ctx.pushString("");
            ctx.pushInt(0);
        }
    });

    // CHAT_GETHISTORYEX_BYUID (5031): Extended message info by UID
    // Pops: uid (1 int)
    // Pushes: type, cycle, sender, prefix, text, friendStatus, clan, timestamp (4 ints + 4 strings)
    handlers.set(Opcodes.CHAT_GETHISTORYEX_BYUID, (ctx) => {
        const uid = ctx.intStack[--ctx.intStackSize];
        const msg = chatHistory.getByUid(uid);

        if (msg) {
            ctx.pushInt(msg.type);
            ctx.pushInt(msg.cycle);
            ctx.pushString(msg.from);
            ctx.pushString(msg.prefix);
            ctx.pushString(msg.text);
            ctx.pushInt(msg.isFromFriend ? 1 : msg.isFromIgnored ? 2 : 0);
            ctx.pushString(""); // clan name
            ctx.pushInt(0); // timestamp delta
        } else {
            ctx.pushInt(-1);
            ctx.pushInt(0);
            ctx.pushString("");
            ctx.pushString("");
            ctx.pushString("");
            ctx.pushInt(0);
            ctx.pushString("");
            ctx.pushInt(0);
        }
    });
}
