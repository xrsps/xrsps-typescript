/**
 * Server-to-Client Packet IDs - Binary protocol matching OSRS reference
 *
 * Each packet type has a unique opcode for binary encoding.
 * This replaces the JSON { type: "...", payload: {...} } format.
 */
export const enum ServerPacketId {
    // ========================================
    // CORE PROTOCOL (0-19)
    // ========================================
    WELCOME = 0,
    TICK = 1,
    HANDSHAKE = 2,
    LOGIN_RESPONSE = 3,
    LOGOUT_RESPONSE = 4,
    PATH_RESPONSE = 5,

    // ========================================
    // PLAYER/NPC SYNC (20-39)
    // ========================================
    PLAYER_SYNC = 20,
    NPC_INFO = 21,
    ANIM = 22,

    // ========================================
    // VARPS/VARBITS (40-49)
    // ========================================
    VARP_SMALL = 40, // varp with value 0-255
    VARP_LARGE = 41, // varp with value outside byte range
    VARBIT = 42,
    VARP_BATCH = 43, // multiple varps in one packet

    // ========================================
    // INVENTORY/ITEMS (50-69)
    // ========================================
    INVENTORY_SNAPSHOT = 50,
    INVENTORY_SLOT = 51,
    BANK_SNAPSHOT = 52,
    BANK_SLOT = 53,
    GROUND_ITEMS = 54,
    GROUND_ITEMS_DELTA = 55,

    // ========================================
    // SKILLS (70-79)
    // ========================================
    SKILLS_SNAPSHOT = 70,
    SKILLS_DELTA = 71,

    // ========================================
    // COMBAT/EFFECTS (80-99)
    // ========================================
    COMBAT_STATE = 80,
    RUN_ENERGY = 81,
    HITSPLAT = 82,
    SPOT_ANIM = 83,
    PROJECTILES = 84,
    SPELL_RESULT = 85,
    DEBUG_PACKET = 86,
    DESTINATION = 87,

    // ========================================
    // INTERFACES/WIDGETS (100-119)
    // ========================================
    WIDGET_OPEN = 100,
    WIDGET_CLOSE = 101,
    WIDGET_SET_ROOT = 102,
    WIDGET_OPEN_SUB = 103,
    WIDGET_CLOSE_SUB = 104,
    WIDGET_SET_TEXT = 105,
    WIDGET_SET_HIDDEN = 106,
    WIDGET_SET_ITEM = 107,
    WIDGET_SET_NPC_HEAD = 108,
    WIDGET_SET_FLAGS_RANGE = 109,
    WIDGET_RUN_SCRIPT = 110,
    WIDGET_SET_FLAGS = 111,
    WIDGET_SET_ANIMATION = 114,
    WIDGET_SET_PLAYER_HEAD = 115,

    // ========================================
    // CHAT/MESSAGES (120-129)
    // ========================================
    CHAT_MESSAGE = 120,

    // ========================================
    // WORLD UPDATES (130-149)
    // ========================================
    LOC_CHANGE = 130,
    LOC_ADD_CHANGE = 134,
    LOC_DEL = 135,
    SOUND = 131,
    PLAY_JINGLE = 132,
    PLAY_SONG = 133,
    REBUILD_REGION = 140,
    REBUILD_NORMAL = 141,
    REBUILD_WORLDENTITY = 142,
    WORLDENTITY_INFO = 143,

    // ========================================
    // SHOP/TRADE (150-169)
    // ========================================
    SHOP_OPEN = 150,
    SHOP_SLOT = 151,
    SHOP_CLOSE = 152,
    SHOP_MODE = 153,
    TRADE_REQUEST = 154,
    TRADE_OPEN = 155,
    TRADE_UPDATE = 156,
    TRADE_CLOSE = 157,

    // ========================================
    // SCRIPTS (170-179)
    // ========================================
    RUN_CLIENT_SCRIPT = 170,

    // ========================================
    // SMITHING (180-189)
    // ========================================
    SMITHING_OPEN = 180,
    SMITHING_MODE = 181,
    SMITHING_CLOSE = 182,

    // ========================================
    // COLLECTION LOG (190-199)
    // ========================================
    COLLECTION_LOG_SNAPSHOT = 190,

    // ========================================
    // NOTIFICATIONS (200-209)
    // ========================================
    NOTIFICATION = 200,

    // ========================================
    // DEBUG (250-255)
    // ========================================
    DEBUG = 250,
}

/**
 * Packet length constants
 * -1 = variable byte (1 byte length prefix)
 * -2 = variable short (2 byte length prefix)
 * positive = fixed length
 */
export const SERVER_PACKET_LENGTHS: Record<ServerPacketId, number> = {
    [ServerPacketId.WELCOME]: 8, // tickMs(4) + serverTime(4)
    [ServerPacketId.TICK]: 8, // tick(4) + time(4)
    [ServerPacketId.HANDSHAKE]: -1,
    [ServerPacketId.LOGIN_RESPONSE]: -1,
    [ServerPacketId.LOGOUT_RESPONSE]: -1,
    [ServerPacketId.PATH_RESPONSE]: -1,

    [ServerPacketId.PLAYER_SYNC]: -2,
    [ServerPacketId.NPC_INFO]: -2,
    [ServerPacketId.ANIM]: 22, // 11 shorts for animation IDs

    [ServerPacketId.VARP_SMALL]: 3, // varpId(2) + value(1)
    [ServerPacketId.VARP_LARGE]: 6, // varpId(2) + value(4)
    [ServerPacketId.VARBIT]: 6, // varbitId(2) + value(4)
    [ServerPacketId.VARP_BATCH]: -1,

    [ServerPacketId.INVENTORY_SNAPSHOT]: -2,
    // Quantity is encoded OSRS-style: 1 byte, or 255 + int (variable length).
    [ServerPacketId.INVENTORY_SLOT]: -1,
    [ServerPacketId.BANK_SNAPSHOT]: -2,
    [ServerPacketId.BANK_SLOT]: -1,
    [ServerPacketId.GROUND_ITEMS]: -2,
    [ServerPacketId.GROUND_ITEMS_DELTA]: -2,

    [ServerPacketId.SKILLS_SNAPSHOT]: -1,
    [ServerPacketId.SKILLS_DELTA]: -1,

    [ServerPacketId.COMBAT_STATE]: -1,
    [ServerPacketId.RUN_ENERGY]: 2, // percent(1) + running(1)
    [ServerPacketId.HITSPLAT]: -1,
    [ServerPacketId.SPOT_ANIM]: -1,
    [ServerPacketId.PROJECTILES]: -2,
    [ServerPacketId.SPELL_RESULT]: -2,
    [ServerPacketId.DEBUG_PACKET]: -2,
    [ServerPacketId.DESTINATION]: 4, // worldX(2) + worldY(2)

    [ServerPacketId.WIDGET_OPEN]: 3, // groupId(2) + modal(1)
    [ServerPacketId.WIDGET_CLOSE]: 2, // groupId(2)
    [ServerPacketId.WIDGET_SET_ROOT]: 2, // groupId(2)
    // Custom open_sub payload can include initial varp/varbit/hidden UID state.
    [ServerPacketId.WIDGET_OPEN_SUB]: -2,
    [ServerPacketId.WIDGET_CLOSE_SUB]: 4, // targetUid(4)
    [ServerPacketId.WIDGET_SET_TEXT]: -2,
    [ServerPacketId.WIDGET_SET_HIDDEN]: 5, // uid(4) + hidden(1)
    [ServerPacketId.WIDGET_SET_ITEM]: 10, // uid(4) + itemId(2) + quantity(4)
    [ServerPacketId.WIDGET_SET_NPC_HEAD]: 6, // uid(4) + npcId(2)
    [ServerPacketId.WIDGET_SET_FLAGS_RANGE]: 12, // uid(4) + fromSlot(2) + toSlot(2) + flags(4)
    [ServerPacketId.WIDGET_RUN_SCRIPT]: -2, // scriptId(4) + args (variable)
    [ServerPacketId.WIDGET_SET_FLAGS]: 8, // uid(4) + flags(4)
    [ServerPacketId.WIDGET_SET_ANIMATION]: 6, // uid(4) + animId(2)
    [ServerPacketId.WIDGET_SET_PLAYER_HEAD]: 4, // uid(4)

    [ServerPacketId.CHAT_MESSAGE]: -1,

    [ServerPacketId.LOC_CHANGE]: -1,
    [ServerPacketId.LOC_ADD_CHANGE]: -1,
    [ServerPacketId.LOC_DEL]: -1,
    [ServerPacketId.SOUND]: -1,
    [ServerPacketId.PLAY_JINGLE]: 5, // jingleId(2) + delay(3, IME)
    // OSRS parity: mirrors Skills.method6928([trackId], outDelay, outDur, inDelay, inDur)
    [ServerPacketId.PLAY_SONG]: 10, // trackId(2) + outDelay(2) + outDur(2) + inDelay(2) + inDur(2)

    [ServerPacketId.REBUILD_REGION]: -2,
    [ServerPacketId.REBUILD_NORMAL]: -2,
    [ServerPacketId.REBUILD_WORLDENTITY]: -2,
    [ServerPacketId.WORLDENTITY_INFO]: -1, // count(1) + per-entity updates + new spawns

    [ServerPacketId.SHOP_OPEN]: -2,
    [ServerPacketId.SHOP_SLOT]: -1,
    [ServerPacketId.SHOP_CLOSE]: 0,
    [ServerPacketId.SHOP_MODE]: -1,
    [ServerPacketId.TRADE_REQUEST]: -1,
    [ServerPacketId.TRADE_OPEN]: -2,
    [ServerPacketId.TRADE_UPDATE]: -2,
    [ServerPacketId.TRADE_CLOSE]: -1,

    [ServerPacketId.RUN_CLIENT_SCRIPT]: -2,

    [ServerPacketId.SMITHING_OPEN]: -2, // mode(1) + title(var) + options(var) + quantityMode(1) + customQuantity(4)
    [ServerPacketId.SMITHING_MODE]: 5, // quantityMode(1) + customQuantity(4)
    [ServerPacketId.SMITHING_CLOSE]: 0,

    [ServerPacketId.COLLECTION_LOG_SNAPSHOT]: -2, // count(2) + slots(var)

    [ServerPacketId.NOTIFICATION]: -1, // kind(1) + title(var) + message(var) + itemId(2) + quantity(4) + durationMs(2)

    [ServerPacketId.DEBUG]: -2,
};
