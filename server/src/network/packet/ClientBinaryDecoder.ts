/**
 * ClientBinaryDecoder - Decode binary client packets
 *
 * Replaces JSON.parse for client-to-server messages.
 * Returns the same message format as the JSON protocol for compatibility.
 */
import {
    CLIENT_PACKET_LENGTHS,
    ClientPacketId,
} from "../../../../src/shared/packets/ClientPacketId";
import type { RoutedMessage } from "../MessageRouter";
import type { Appearance, TradeActionClientPayload } from "../messages";

/**
 * Binary packet reader for server decoding
 */
export class ClientPacketReader {
    readonly data: Uint8Array;
    offset: number = 0;

    constructor(data: Uint8Array | ArrayBuffer) {
        this.data = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
    }

    get remaining(): number {
        return this.data.length - this.offset;
    }

    readByte(): number {
        return this.data[this.offset++] & 0xff;
    }

    readSignedByte(): number {
        const v = this.data[this.offset++];
        return v > 127 ? v - 256 : v;
    }

    readShort(): number {
        this.offset += 2;
        return ((this.data[this.offset - 2] & 0xff) << 8) | (this.data[this.offset - 1] & 0xff);
    }

    readSignedShort(): number {
        const v = this.readShort();
        return v > 32767 ? v - 65536 : v;
    }

    readInt(): number {
        this.offset += 4;
        return (
            ((this.data[this.offset - 4] & 0xff) << 24) |
            ((this.data[this.offset - 3] & 0xff) << 16) |
            ((this.data[this.offset - 2] & 0xff) << 8) |
            (this.data[this.offset - 1] & 0xff)
        );
    }

    readBoolean(): boolean {
        return this.readByte() !== 0;
    }

    readString(): string {
        let str = "";
        let b: number;
        while ((b = this.data[this.offset++]) !== 0) {
            str += String.fromCharCode(b);
        }
        return str;
    }

    /** Read unsigned byte with ADD decoding: (value - 128) & 0xFF */
    readByteAdd(): number {
        return (this.data[this.offset++] - 128) & 0xff;
    }

    /** Read unsigned byte with NEG decoding: (0 - value) & 0xFF */
    readByteNeg(): number {
        return (0 - this.data[this.offset++]) & 0xff;
    }

    /** Read unsigned byte with SUB decoding: (128 - value) & 0xFF */
    readByteSub(): number {
        return (128 - this.data[this.offset++]) & 0xff;
    }

    /** Read signed byte with ADD decoding */
    readSignedByteAdd(): number {
        return ((this.data[this.offset++] - 128) << 24) >> 24;
    }

    /** Read signed byte with NEG decoding */
    readSignedByteNeg(): number {
        return ((0 - this.data[this.offset++]) << 24) >> 24;
    }

    /** Read signed byte with SUB decoding */
    readSignedByteSub(): number {
        return ((128 - this.data[this.offset++]) << 24) >> 24;
    }

    /** Read unsigned short little-endian: [low, high] */
    readShortLE(): number {
        this.offset += 2;
        return (this.data[this.offset - 2] & 0xff) | ((this.data[this.offset - 1] & 0xff) << 8);
    }

    /** Read unsigned short with ADD decoding: [high, low+128] -> big-endian */
    readShortAdd(): number {
        this.offset += 2;
        return (
            ((this.data[this.offset - 2] & 0xff) << 8) | ((this.data[this.offset - 1] - 128) & 0xff)
        );
    }

    /** Read unsigned short with ADD LE decoding: [low+128, high] -> little-endian */
    readShortAddLE(): number {
        this.offset += 2;
        return (
            ((this.data[this.offset - 2] - 128) & 0xff) | ((this.data[this.offset - 1] & 0xff) << 8)
        );
    }

    /** Read signed short little-endian */
    readSignedShortLE(): number {
        const v = this.readShortLE();
        return v > 32767 ? v - 65536 : v;
    }

    /** Read unsigned int little-endian: [b0, b1, b2, b3] */
    readIntLE(): number {
        this.offset += 4;
        return (
            ((this.data[this.offset - 4] & 0xff) |
                ((this.data[this.offset - 3] & 0xff) << 8) |
                ((this.data[this.offset - 2] & 0xff) << 16) |
                ((this.data[this.offset - 1] & 0xff) << 24)) >>>
            0
        );
    }

    /** Read unsigned int middle-endian: [b1, b0, b3, b2] */
    readIntME(): number {
        this.offset += 4;
        return (
            (((this.data[this.offset - 2] & 0xff) << 24) |
                ((this.data[this.offset - 1] & 0xff) << 16) |
                ((this.data[this.offset - 4] & 0xff) << 8) |
                (this.data[this.offset - 3] & 0xff)) >>>
            0
        );
    }

    /** Read unsigned int inverse middle-endian: [b2, b3, b0, b1] */
    readIntIME(): number {
        this.offset += 4;
        return (
            (((this.data[this.offset - 3] & 0xff) << 24) |
                ((this.data[this.offset - 4] & 0xff) << 16) |
                ((this.data[this.offset - 1] & 0xff) << 8) |
                (this.data[this.offset - 2] & 0xff)) >>>
            0
        );
    }
}

export type DecodedClientMessage = RoutedMessage;

type DebugPayloadJson = {
    kind?: string;
    requestId?: number;
    snapshot?: unknown;
    value?: number;
    varbit?: number;
    varp?: number;
};

/**
 * Decode a single binary client packet
 */
export function decodeClientPacket(data: Uint8Array | ArrayBuffer): DecodedClientMessage | null {
    const reader = new ClientPacketReader(data);

    if (reader.remaining < 1) return null;

    const opcode = reader.readByte() as ClientPacketId;
    const fixedLength = CLIENT_PACKET_LENGTHS[opcode];

    // Read length for variable packets
    let packetLength: number;
    if (fixedLength === -1) {
        if (reader.remaining < 1) return null;
        packetLength = reader.readByte();
    } else if (fixedLength === -2) {
        if (reader.remaining < 2) return null;
        packetLength = reader.readShort();
    } else {
        packetLength = fixedLength;
    }

    if (reader.remaining < packetLength) return null;

    switch (opcode) {
        case ClientPacketId.HELLO:
            return {
                type: "hello",
                payload: {
                    client: reader.readString(),
                    version: reader.readString() || undefined,
                },
            };

        case ClientPacketId.PING:
            return {
                type: "ping",
                payload: { time: reader.readInt() },
            };

        case ClientPacketId.HANDSHAKE: {
            const name = reader.readString() || undefined;
            const hasAppearance = reader.readBoolean();
            let appearance: Appearance | undefined;
            if (hasAppearance) {
                appearance = { gender: reader.readByte() };
                const colorCount = reader.readByte();
                appearance.colors = [];
                for (let i = 0; i < colorCount; i++) {
                    appearance.colors.push(reader.readByte());
                }
                const kitCount = reader.readByte();
                appearance.kits = [];
                for (let i = 0; i < kitCount; i++) {
                    appearance.kits.push(reader.readShort());
                }
                const equipCount = reader.readByte();
                appearance.equip = [];
                for (let i = 0; i < equipCount; i++) {
                    appearance.equip.push(reader.readShort());
                }
            }
            const clientType = reader.remaining > 0 ? reader.readByte() : undefined;
            return {
                type: "handshake",
                payload: { name, appearance, clientType },
            };
        }

        case ClientPacketId.LOGOUT:
            return {
                type: "logout",
                payload: {},
            };

        case ClientPacketId.LOGIN:
            return {
                type: "login",
                payload: {
                    username: reader.readString(),
                    password: reader.readString(),
                    revision: reader.readInt(),
                },
            };

        case ClientPacketId.WALK: {
            const x = reader.readShort();
            const y = reader.readShort();
            const flags = reader.readByte();
            const run = (flags & 1) !== 0;
            const modifierFlags = flags >> 1;
            return {
                type: "walk",
                payload: {
                    to: { x, y },
                    run: run || undefined,
                    modifierFlags: modifierFlags || undefined,
                },
            };
        }

        case ClientPacketId.FACE: {
            const hasRot = reader.readBoolean();
            const rot = hasRot ? reader.readShort() : undefined;
            const hasTile = reader.readBoolean();
            const tile = hasTile ? { x: reader.readShort(), y: reader.readShort() } : undefined;
            return {
                type: "face",
                payload: { rot, tile },
            };
        }

        case ClientPacketId.TELEPORT:
            return {
                type: "teleport",
                payload: {
                    to: { x: reader.readShort(), y: reader.readShort() },
                    level: reader.readByte() || undefined,
                },
            };

        case ClientPacketId.PATHFIND:
            return {
                type: "pathfind",
                payload: {
                    id: reader.readInt(),
                    from: {
                        x: reader.readShort(),
                        y: reader.readShort(),
                        plane: reader.readByte(),
                    },
                    to: { x: reader.readShort(), y: reader.readShort() },
                    size: reader.readByte() || undefined,
                },
            };

        case ClientPacketId.NPC_ATTACK:
            return {
                type: "npc_attack",
                payload: { npcId: reader.readShort() },
            };

        case ClientPacketId.NPC_INTERACT: {
            const npcId = reader.readShort();
            const option = reader.readString() || undefined;
            const opNum = reader.readByte() || undefined;
            return {
                type: "npc_interact",
                payload: { npcId, option, opNum },
            };
        }

        case ClientPacketId.LOC_INTERACT: {
            const id = reader.readShort();
            const x = reader.readShort();
            const y = reader.readShort();
            const level = reader.readByte() || undefined;
            const action = reader.readString() || undefined;
            const opNum = reader.readByte() || undefined;
            return {
                type: "loc_interact",
                payload: { id, tile: { x, y }, level, action, opNum },
            };
        }

        case ClientPacketId.GROUND_ITEM_ACTION: {
            const stackId = reader.readInt();
            const x = reader.readShort();
            const y = reader.readShort();
            const level = reader.readByte() || undefined;
            const itemId = reader.readShort();
            const quantity = reader.readInt() || undefined;
            const option = reader.readString() || undefined;
            const opNum = reader.readByte() || undefined;
            return {
                type: "ground_item_action",
                payload: {
                    stackId,
                    tile: { x, y, level },
                    itemId,
                    quantity,
                    option,
                    opNum,
                },
            };
        }

        case ClientPacketId.INTERACT: {
            const modeVal = reader.readByte();
            const mode = modeVal === 0 ? "follow" : "trade";
            const targetId = reader.readShort();
            return {
                type: "interact",
                payload: { mode, targetId },
            };
        }

        case ClientPacketId.INTERACT_STOP:
            return {
                type: "interact_stop",
                payload: {},
            };

        case ClientPacketId.INVENTORY_USE: {
            const slot = reader.readShort();
            const itemId = reader.readShort();
            const quantity = reader.readInt() || undefined;
            const option = reader.readString() || undefined;
            return {
                type: "inventory_use",
                payload: { slot, itemId, quantity, option },
            };
        }

        case ClientPacketId.INVENTORY_USE_ON: {
            const slot = reader.readShort();
            const itemId = reader.readShort();
            const kindVal = reader.readByte();
            const kinds = ["npc", "loc", "obj", "player", "inv"] as const;
            const kind = kinds[kindVal] ?? "npc";
            const id = reader.readShort();
            const hasTile = reader.readBoolean();
            const tile = hasTile ? { x: reader.readShort(), y: reader.readShort() } : undefined;
            const plane = reader.readByte() || undefined;
            const target: Extract<RoutedMessage, { type: "inventory_use_on" }>["payload"]["target"] =
                kind === "inv"
                    ? {
                          kind,
                          slot: reader.readShort(),
                          itemId: reader.readShort(),
                      }
                    : {
                          kind,
                          id,
                          tile,
                          plane,
                      };
            return {
                type: "inventory_use_on",
                payload: {
                    slot,
                    itemId,
                    target,
                },
            };
        }

        case ClientPacketId.INVENTORY_MOVE:
            return {
                type: "inventory_move",
                payload: {
                    from: reader.readShort(),
                    to: reader.readShort(),
                },
            };

        case ClientPacketId.BANK_DEPOSIT_INVENTORY:
            return {
                type: "bank_deposit_inventory",
                payload: {},
            };

        case ClientPacketId.BANK_DEPOSIT_EQUIPMENT:
            return {
                type: "bank_deposit_equipment",
                payload: {},
            };

        case ClientPacketId.BANK_MOVE: {
            const from = reader.readShort();
            const to = reader.readShort();
            const modeVal = reader.readByte();
            const mode = modeVal === 1 ? "insert" : "swap";
            const tab = reader.readByte() || undefined;
            return {
                type: "bank_move",
                payload: { from, to, mode, tab },
            };
        }

        case ClientPacketId.WIDGET: {
            const actionVal = reader.readByte();
            const action = actionVal === 0 ? "open" : "close";
            const groupId = reader.readShort();
            const modal = reader.readBoolean() || undefined;
            return {
                type: "widget",
                payload: { action, groupId, modal },
            };
        }

        case ClientPacketId.WIDGET_ACTION: {
            const widgetId = reader.readInt();
            const groupId = reader.readShort();
            const childId = reader.readShort();
            const option = reader.readString() || undefined;
            const target = reader.readString() || undefined;
            const opId = reader.readByte() || undefined;
            const buttonNum = reader.readByte() || undefined;
            const cursorX = reader.readShort() || undefined;
            const cursorY = reader.readShort() || undefined;
            const isPrimary = reader.readBoolean() || undefined;
            const slotRaw = reader.readSignedShort();
            const slot = slotRaw >= 0 ? slotRaw : undefined;
            const itemIdRaw = reader.readSignedShort();
            const itemIdVal = itemIdRaw >= 0 ? itemIdRaw : undefined;
            return {
                type: "widget_action",
                payload: {
                    widgetId,
                    groupId,
                    childId,
                    option,
                    target,
                    opId,
                    buttonNum,
                    cursorX,
                    cursorY,
                    isPrimary,
                    slot,
                    itemId: itemIdVal,
                },
            };
        }

        case ClientPacketId.ITEM_SPAWNER_SEARCH:
            return {
                type: "item_spawner_search",
                payload: {
                    query: reader.readString() || "",
                },
            };

        case ClientPacketId.RESUME_PAUSEBUTTON:
            return {
                type: "resume_pausebutton",
                payload: {
                    widgetId: reader.readInt(),
                    childIndex: reader.readShort(),
                },
            };

        case ClientPacketId.RESUME_COUNTDIALOG:
            return {
                type: "resume_countdialog",
                payload: {
                    amount: reader.readInt(),
                },
            };

        case ClientPacketId.RESUME_NAMEDIALOG:
            return {
                type: "resume_namedialog",
                payload: {
                    value: reader.readString(),
                },
            };

        case ClientPacketId.RESUME_STRINGDIALOG:
            return {
                type: "resume_stringdialog",
                payload: {
                    value: reader.readString(),
                },
            };

        case ClientPacketId.IF_BUTTOND:
            return {
                type: "if_buttond",
                payload: {
                    sourceWidgetId: reader.readInt(),
                    sourceSlot: reader.readShort(),
                    sourceItemId: reader.readShort(),
                    targetWidgetId: reader.readInt(),
                    targetSlot: reader.readShort(),
                    targetItemId: reader.readShort(),
                },
            };

        case ClientPacketId.EMOTE:
            return {
                type: "emote",
                payload: {
                    index: reader.readShort(),
                    loop: reader.readBoolean() || undefined,
                },
            };

        case ClientPacketId.TRADE_ACTION: {
            const actionVal = reader.readByte();
            const actions = [
                "offer",
                "remove",
                "accept",
                "decline",
                "confirm_accept",
                "confirm_decline",
            ] as const;
            const action: TradeActionClientPayload["action"] = actions[actionVal] ?? "offer";
            const slot = reader.readShort();
            const quantity = reader.readInt();
            const itemIdRaw = reader.readSignedShort();
            const itemId = itemIdRaw >= 0 ? itemIdRaw : undefined;

            let result: TradeActionClientPayload;
            if (action === "offer") {
                result = {
                    action,
                    slot,
                    quantity,
                    ...(itemId !== undefined ? { itemId } : {}),
                };
            } else if (action === "remove") {
                result = { action, slot, quantity };
            } else {
                result = { action };
            }
            return {
                type: "trade_action",
                payload: result,
            };
        }

        case ClientPacketId.CHAT: {
            const messageTypeVal = reader.readByte();
            const messageType = messageTypeVal === 1 ? "game" : "public";
            const text = reader.readString();
            return {
                type: "chat",
                payload: { text, messageType },
            };
        }

        case ClientPacketId.VARP_TRANSMIT:
            return {
                type: "varp_transmit",
                payload: {
                    varpId: reader.readShort(),
                    value: reader.readInt(),
                },
            };

        case ClientPacketId.DEBUG: {
            const jsonStr = reader.readString();
            const payload: Extract<RoutedMessage, { type: "debug" }>["payload"] =
                parseDebugPayload(jsonStr);
            return { type: "debug", payload };
        }

        default:
            console.warn(`Unknown client packet opcode: ${opcode}`);
            return null;
    }
}

function parseDebugPayload(jsonStr: string): Extract<RoutedMessage, { type: "debug" }>["payload"] {
    try {
        const parsed = JSON.parse(jsonStr) as DebugPayloadJson | null;
        if (!parsed) {
            return { kind: "raw", raw: jsonStr };
        }

        const kind = parsed.kind ?? "";
        if (kind === "projectiles_request" || kind === "anim_request") {
            return {
                kind,
                requestId: parsed.requestId,
            };
        }
        if (kind === "projectiles_snapshot" || kind === "anim_snapshot") {
            if (parsed.requestId === undefined) {
                return { kind: "raw", raw: jsonStr };
            }
            return {
                kind,
                requestId: parsed.requestId,
                snapshot: parsed.snapshot,
            };
        }
        if (kind === "set_var") {
            return {
                kind,
                value: parsed.value,
                varbit: parsed.varbit,
                varp: parsed.varp,
            };
        }
    } catch {}

    return { kind: "raw", raw: jsonStr };
}

/**
 * Check if data is binary (not starting with '{') or JSON
 */
export function isBinaryClientPacket(data: ArrayBuffer | string | Buffer): boolean {
    if (!(data instanceof ArrayBuffer) && !(data instanceof Uint8Array)) {
        return false;
    }
    const view =
        data instanceof ArrayBuffer
            ? new Uint8Array(data)
            : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (view.length === 0) return false;
    // JSON starts with '{' (0x7B)
    return view[0] !== 0x7b;
}
