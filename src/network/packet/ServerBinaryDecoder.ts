/**
 * ServerBinaryDecoder - Decode binary server packets
 *
 * Replaces JSON.parse for server-to-client messages.
 * Returns the same message format as the JSON protocol for compatibility.
 */
import { SERVER_PACKET_LENGTHS, ServerPacketId } from "../../shared/packets/ServerPacketId";
import {
    INSTANCE_CHUNK_COUNT,
    PLANE_COUNT,
    deriveRegionsFromTemplates,
} from "../../shared/instance/InstanceTypes";
import type { ProjectileLaunch } from "../../shared/projectiles/ProjectileLaunch";

/**
 * Binary packet buffer for client decoding
 */
export class ServerPacketReader {
    readonly data: Uint8Array;
    offset: number = 0;
    private bitPos: number = 0;

    constructor(data: Uint8Array | ArrayBuffer) {
        this.data = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
    }

    get remaining(): number {
        return this.data.length - this.offset;
    }

    initBitAccess(): void {
        this.bitPos = this.offset * 8;
    }

    readBits(count: number): number {
        let bytePos = this.bitPos >> 3;
        let bitOffset = 8 - (this.bitPos & 7);
        let value = 0;
        this.bitPos += count;
        while (count > bitOffset) {
            value += (this.data[bytePos++] & ((1 << bitOffset) - 1)) << (count - bitOffset);
            count -= bitOffset;
            bitOffset = 8;
        }
        if (count === bitOffset) {
            value += this.data[bytePos] & ((1 << bitOffset) - 1);
        } else {
            value += (this.data[bytePos] >> (bitOffset - count)) & ((1 << count) - 1);
        }
        return value;
    }

    finishBitAccess(): void {
        this.offset = (this.bitPos + 7) >> 3;
    }

    private ensureRemaining(bytes: number, op: string): void {
        if ((this.remaining | 0) < (bytes | 0)) {
            throw new RangeError(
                `Buffer exhausted (${op} need=${bytes} offset=${this.offset} len=${this.data.length})`,
            );
        }
    }

    // ========================================
    // READ METHODS (matching Buffer.java)
    // ========================================

    readByte(): number {
        this.ensureRemaining(1, "readByte");
        return this.data[this.offset++] & 0xff;
    }

    readSignedByte(): number {
        this.ensureRemaining(1, "readSignedByte");
        const v = this.data[this.offset++];
        return v > 127 ? v - 256 : v;
    }

    readShort(): number {
        this.ensureRemaining(2, "readShort");
        this.offset += 2;
        return ((this.data[this.offset - 2] & 0xff) << 8) | (this.data[this.offset - 1] & 0xff);
    }

    readSignedShort(): number {
        const v = this.readShort();
        return v > 32767 ? v - 65536 : v;
    }

    readUnsignedMediumIME(): number {
        this.ensureRemaining(3, "readUnsignedMediumIME");
        this.offset += 3;
        return (
            ((this.data[this.offset - 3] & 0xff) << 16) |
            ((this.data[this.offset - 1] & 0xff) << 8) |
            (this.data[this.offset - 2] & 0xff)
        );
    }

    readInt(): number {
        this.ensureRemaining(4, "readInt");
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
        while (true) {
            this.ensureRemaining(1, "readString");
            const b = this.data[this.offset++] & 0xff;
            if (b === 0) break;
            str += String.fromCharCode(b);
        }
        return str;
    }

    readSmartByteShort(): number {
        this.ensureRemaining(1, "readSmartByteShort");
        const peek = this.data[this.offset] & 0xff;
        if (peek < 128) {
            return this.readByte();
        }
        return this.readShort() - 32768;
    }

    readBytes(length: number): Uint8Array {
        this.ensureRemaining(length | 0, "readBytes");
        const result = this.data.slice(this.offset, this.offset + length);
        this.offset += length;
        return result;
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

/**
 * Decoded message type (same format as JSON messages)
 */
export type DecodedServerMessage = {
    type: string;
    payload: any;
};

/**
 * Decode a single binary packet
 */
export function decodeServerPacket(data: Uint8Array | ArrayBuffer): DecodedServerMessage | null {
    const reader = new ServerPacketReader(data);

    if (reader.remaining < 1) return null;

    const opcode = reader.readByte() as ServerPacketId;
    const fixedLength = SERVER_PACKET_LENGTHS[opcode];

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

    const readGroundItemStack = (): any => {
        const id = reader.readInt();
        const itemId = reader.readShort();
        const quantity = reader.readInt();
        const tileX = reader.readShort();
        const tileY = reader.readShort();
        const tileLevel = reader.readByte();
        const createdTickRaw = reader.readInt();
        const privateUntilTickRaw = reader.readInt();
        const expiresTickRaw = reader.readInt();
        const ownerIdRaw = reader.readInt();
        const isPrivateRaw = reader.readBoolean();
        const ownershipRaw = reader.readByte();

        const createdTick = createdTickRaw >= 0 ? createdTickRaw : undefined;
        const privateUntilTick = privateUntilTickRaw > 0 ? privateUntilTickRaw : undefined;
        const expiresTick = expiresTickRaw > 0 ? expiresTickRaw : undefined;
        const ownerId = ownerIdRaw >= 0 ? ownerIdRaw : undefined;
        const isPrivate = !!isPrivateRaw;
        const ownership = (
            ownershipRaw === 1 || ownershipRaw === 2 || ownershipRaw === 3 ? ownershipRaw : 0
        ) as 0 | 1 | 2 | 3;
        return {
            id,
            itemId,
            quantity,
            tile: {
                x: tileX,
                y: tileY,
                level: tileLevel,
            },
            createdTick,
            privateUntilTick,
            expiresTick,
            ownerId,
            isPrivate,
            ownership,
        };
    };

    switch (opcode) {
        case ServerPacketId.WELCOME:
            return {
                type: "welcome",
                payload: {
                    tickMs: reader.readInt(),
                    serverTime: reader.readInt(),
                },
            };

        case ServerPacketId.TICK:
            return {
                type: "tick",
                payload: {
                    tick: reader.readInt(),
                    time: reader.readInt(),
                },
            };

        case ServerPacketId.DESTINATION:
            return {
                type: "destination",
                payload: {
                    worldX: reader.readShort(),
                    worldY: reader.readShort(),
                },
            };

        case ServerPacketId.REBUILD_REGION: {
            const rebuildRegionX = reader.readShort();
            const _rebuildFlag = reader.readByte();
            const rebuildRegionY = reader.readShort();
            const numXteaKeys = reader.readShort();

            const templateChunks: number[][][] = new Array(PLANE_COUNT);
            for (let p = 0; p < PLANE_COUNT; p++) {
                templateChunks[p] = new Array(INSTANCE_CHUNK_COUNT);
                for (let cx = 0; cx < INSTANCE_CHUNK_COUNT; cx++) {
                    templateChunks[p][cx] = new Array(INSTANCE_CHUNK_COUNT);
                }
            }

            reader.initBitAccess();
            for (let p = 0; p < PLANE_COUNT; p++) {
                for (let cx = 0; cx < INSTANCE_CHUNK_COUNT; cx++) {
                    for (let cy = 0; cy < INSTANCE_CHUNK_COUNT; cy++) {
                        const present = reader.readBits(1);
                        if (present === 1) {
                            templateChunks[p][cx][cy] = reader.readBits(26);
                        } else {
                            templateChunks[p][cx][cy] = -1;
                        }
                    }
                }
            }
            reader.finishBitAccess();

            const xteaKeys: number[][] = new Array(numXteaKeys);
            for (let i = 0; i < numXteaKeys; i++) {
                xteaKeys[i] = [reader.readInt(), reader.readInt(), reader.readInt(), reader.readInt()];
            }

            const mapRegions = deriveRegionsFromTemplates(templateChunks);

            // Extra locs (custom extension)
            const extraLocCount = reader.remaining >= 2 ? reader.readShort() : 0;
            const extraLocs: Array<{ id: number; x: number; y: number; level: number; shape: number; rotation: number }> = [];
            for (let i = 0; i < extraLocCount; i++) {
                const locId = reader.readShort();
                const locX = reader.readShort();
                const locY = reader.readShort();
                const locLevel = reader.readByte();
                const shapeRot = reader.readByte();
                extraLocs.push({
                    id: locId,
                    x: locX,
                    y: locY,
                    level: locLevel,
                    shape: shapeRot >> 2,
                    rotation: shapeRot & 3,
                });
            }

            return {
                type: "rebuild_region",
                payload: {
                    regionX: rebuildRegionX,
                    regionY: rebuildRegionY,
                    templateChunks,
                    xteaKeys,
                    mapRegions,
                    extraLocs: extraLocs.length > 0 ? extraLocs : undefined,
                },
            };
        }

        case ServerPacketId.HANDSHAKE: {
            const id = reader.readInt();
            const name = reader.readString();
            const hasAppearance = reader.readBoolean();
            let appearance: any = undefined;
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
                    appearance.kits.push(reader.readSignedShort()); // kits can be -1
                }
                const equipCount = reader.readByte();
                appearance.equip = [];
                for (let i = 0; i < equipCount; i++) {
                    appearance.equip.push(reader.readSignedShort()); // equip uses -1 for empty
                }
            }
            let chatIcons: number[] | undefined = undefined;
            let chatPrefix: string | undefined = undefined;
            if (reader.remaining > 0) {
                const iconCount = reader.readByte() | 0;
                const icons: number[] = [];
                for (let i = 0; i < iconCount && reader.remaining > 0; i++) {
                    icons.push(reader.readByte() | 0);
                }
                chatIcons = icons;
                if (reader.remaining > 0) {
                    const prefix = reader.readString();
                    chatPrefix = prefix || undefined;
                }
            }
            return {
                type: "handshake",
                payload: { id, name: name || undefined, appearance, chatIcons, chatPrefix },
            };
        }

        case ServerPacketId.VARP_SMALL:
            return {
                type: "varp",
                payload: {
                    varpId: reader.readShort(),
                    value: reader.readByte(),
                },
            };

        case ServerPacketId.VARP_LARGE:
            return {
                type: "varp",
                payload: {
                    varpId: reader.readShort(),
                    value: reader.readInt(),
                },
            };

        case ServerPacketId.VARBIT:
            return {
                type: "varbit",
                payload: {
                    varbitId: reader.readShort(),
                    value: reader.readInt(),
                },
            };

        case ServerPacketId.PLAYER_SYNC: {
            const baseX = reader.readShort();
            const baseY = reader.readShort();
            const localIndex = reader.readShort();
            const loopCycle = reader.readInt();
            const packetLen = reader.readShort();
            const packet = reader.readBytes(packetLen);
            return {
                type: "player_sync",
                payload: { baseX, baseY, localIndex, loopCycle, packet },
            };
        }

        case ServerPacketId.NPC_INFO: {
            const loopCycle = reader.readInt();
            const large = reader.readBoolean();
            const packetLen = reader.readShort();
            const packet = reader.readBytes(packetLen);
            return {
                type: "npc_info",
                payload: { loopCycle, large, packet },
            };
        }

        case ServerPacketId.INVENTORY_SNAPSHOT: {
            const count = reader.readShort();
            const slots: any[] = [];
            for (let i = 0; i < count; i++) {
                const slot = reader.readShort();
                const itemId = reader.readShort() - 1; // -1 for 0=empty convention
                let quantity = reader.readByte();
                if (quantity === 255) {
                    quantity = reader.readInt();
                }
                slots.push({ slot, itemId, quantity });
            }
            return {
                type: "inventory",
                payload: { kind: "snapshot", slots },
            };
        }

        case ServerPacketId.INVENTORY_SLOT: {
            const slot = reader.readShort();
            const itemId = reader.readShort() - 1;
            let quantity = reader.readByte();
            if (quantity === 255) {
                quantity = reader.readInt();
            }
            return {
                type: "inventory",
                payload: { kind: "slot", slot: { slot, itemId, quantity } },
            };
        }

        case ServerPacketId.SKILLS_SNAPSHOT:
        case ServerPacketId.SKILLS_DELTA: {
            const kind = opcode === ServerPacketId.SKILLS_SNAPSHOT ? "snapshot" : "delta";
            const count = reader.readByte();
            const skills: any[] = [];
            for (let i = 0; i < count; i++) {
                skills.push({
                    id: reader.readByte(),
                    xp: reader.readInt(),
                    baseLevel: reader.readByte(),
                    virtualLevel: reader.readByte(),
                    boost: reader.readByte() - 128, // unsigned -> signed
                    currentLevel: reader.readByte(),
                });
            }
            const totalLevel = reader.readShort();
            const combatLevel = reader.readByte();
            return {
                type: "skills",
                payload: { kind, skills, totalLevel, combatLevel },
            };
        }

        case ServerPacketId.RUN_ENERGY:
            return {
                type: "run_energy",
                payload: {
                    percent: reader.readByte(),
                    running: reader.readBoolean(),
                },
            };

        case ServerPacketId.HITSPLAT: {
            const targetType = reader.readByte() === 0 ? "player" : "npc";
            const targetId = reader.readShort();
            const damage = reader.readSmartByteShort();
            const style = reader.readByte();
            let type2: number | undefined;
            let damage2: number | undefined;
            let delayCycles = 0;
            if (reader.remaining > 0) {
                const hasSecondary = reader.readBoolean();
                if (hasSecondary) {
                    type2 = reader.readSmartByteShort();
                    damage2 = reader.readSmartByteShort();
                }
                if (reader.remaining > 0) {
                    delayCycles = reader.readSmartByteShort();
                }
            }
            return {
                type: "hitsplat",
                payload: {
                    targetType,
                    targetId,
                    damage,
                    style,
                    type2,
                    damage2,
                    delayCycles,
                },
            };
        }

        case ServerPacketId.SPOT_ANIM: {
            const spotId = reader.readShort();
            const targetType = reader.readByte();
            let playerId: number | undefined;
            let npcId: number | undefined;
            if (targetType === 0) {
                playerId = reader.readShort();
            } else if (targetType === 1) {
                npcId = reader.readShort();
            }
            const height = reader.readByte();
            const delay = reader.readShort();
            return {
                type: "spot",
                payload: { spotId, playerId, npcId, height, delay },
            };
        }

        case ServerPacketId.WIDGET_OPEN:
            return {
                type: "widget",
                payload: {
                    action: "open",
                    groupId: reader.readShort(),
                    modal: reader.readBoolean(),
                },
            };

        case ServerPacketId.WIDGET_CLOSE:
            return {
                type: "widget",
                payload: {
                    action: "close",
                    groupId: reader.readShort(),
                },
            };

        case ServerPacketId.WIDGET_SET_ROOT:
            return {
                type: "widget",
                payload: {
                    action: "set_root",
                    groupId: reader.readShort(),
                },
            };

        case ServerPacketId.WIDGET_OPEN_SUB: {
            const targetUid = reader.readInt();
            const groupId = reader.readShort();
            const type = reader.readByte();

            const varpCount = reader.readByte();
            const varps: Record<number, number> = {};
            for (let i = 0; i < varpCount; i++) {
                const id = reader.readShort();
                varps[id] = reader.readInt();
            }

            const varbitCount = reader.readByte();
            const varbits: Record<number, number> = {};
            for (let i = 0; i < varbitCount; i++) {
                const id = reader.readShort();
                varbits[id] = reader.readInt();
            }

            const hiddenUidCount = reader.readByte();
            const hiddenUids: number[] = [];
            for (let i = 0; i < hiddenUidCount; i++) {
                hiddenUids.push(reader.readInt() | 0);
            }

            const readScriptList = (): Array<{ scriptId: number; args: (number | string)[] }> => {
                const scriptCount = reader.readByte();
                const scripts: Array<{ scriptId: number; args: (number | string)[] }> = [];
                for (let i = 0; i < scriptCount; i++) {
                    const scriptId = reader.readInt();
                    const argCount = reader.readByte();
                    const args: (number | string)[] = [];
                    for (let j = 0; j < argCount; j++) {
                        const argType = reader.readByte();
                        if (argType === 0) {
                            args.push(reader.readString());
                        } else {
                            args.push(reader.readInt());
                        }
                    }
                    scripts.push({ scriptId, args });
                }
                return scripts;
            };

            const preScripts = readScriptList();
            const postScripts = readScriptList();

            return {
                type: "widget",
                payload: {
                    action: "open_sub",
                    targetUid,
                    groupId,
                    type,
                    varps: Object.keys(varps).length > 0 ? varps : undefined,
                    varbits: Object.keys(varbits).length > 0 ? varbits : undefined,
                    hiddenUids: hiddenUids.length > 0 ? hiddenUids : undefined,
                    preScripts: preScripts.length > 0 ? preScripts : undefined,
                    postScripts: postScripts.length > 0 ? postScripts : undefined,
                },
            };
        }

        case ServerPacketId.WIDGET_CLOSE_SUB:
            return {
                type: "widget",
                payload: {
                    action: "close_sub",
                    targetUid: reader.readInt(),
                },
            };

        case ServerPacketId.WIDGET_SET_TEXT:
            return {
                type: "widget",
                payload: {
                    action: "set_text",
                    uid: reader.readInt(),
                    text: reader.readString(),
                },
            };

        case ServerPacketId.WIDGET_SET_HIDDEN:
            return {
                type: "widget",
                payload: {
                    action: "set_hidden",
                    uid: reader.readInt(),
                    hidden: reader.readBoolean(),
                },
            };

        case ServerPacketId.WIDGET_SET_ITEM:
            return {
                type: "widget",
                payload: {
                    action: "set_item",
                    uid: reader.readInt(),
                    itemId: reader.readSignedShort(), // -1 means clear item
                    quantity: reader.readInt(),
                },
            };

        case ServerPacketId.WIDGET_SET_NPC_HEAD:
            return {
                type: "widget",
                payload: {
                    action: "set_npc_head",
                    uid: reader.readInt(),
                    npcId: reader.readSignedShort(),
                },
            };

        case ServerPacketId.WIDGET_SET_FLAGS_RANGE:
            return {
                type: "widget",
                payload: {
                    action: "set_flags_range",
                    uid: reader.readInt(),
                    fromSlot: reader.readShort(),
                    toSlot: reader.readShort(),
                    flags: reader.readInt(),
                },
            };

        case ServerPacketId.WIDGET_RUN_SCRIPT: {
            const scriptId = reader.readInt();
            const argCount = reader.readByte();
            const args: any[] = [];
            for (let i = 0; i < argCount; i++) {
                const argType = reader.readByte();
                if (argType === 0) {
                    args.push(reader.readString());
                } else {
                    args.push(reader.readInt());
                }
            }
            return {
                type: "widget",
                payload: {
                    action: "run_script",
                    scriptId,
                    args,
                },
            };
        }

        case ServerPacketId.WIDGET_SET_FLAGS:
            return {
                type: "widget",
                payload: {
                    action: "set_flags",
                    uid: reader.readInt(),
                    flags: reader.readInt(),
                },
            };

        case ServerPacketId.WIDGET_SET_ANIMATION:
            return {
                type: "widget",
                payload: {
                    action: "set_animation",
                    uid: reader.readInt(),
                    animationId: reader.readSignedShort(),
                },
            };

        case ServerPacketId.WIDGET_SET_PLAYER_HEAD:
            return {
                type: "widget",
                payload: {
                    action: "set_player_head",
                    uid: reader.readInt(),
                },
            };

        case ServerPacketId.CHAT_MESSAGE: {
            const messageTypes = [
                "game",
                "public",
                "private_in",
                "private_out",
                "channel",
                "clan",
                "trade",
                "server",
            ];
            const messageType = messageTypes[reader.readByte()] || "game";
            const text = reader.readString();
            const from = reader.readString() || undefined;
            const prefix = reader.readString() || undefined;
            const playerId = reader.readSignedShort();
            return {
                type: "chat",
                payload: {
                    messageType,
                    text,
                    from,
                    prefix,
                    playerId: playerId >= 0 ? playerId : undefined,
                },
            };
        }

        case ServerPacketId.SOUND: {
            const soundId = reader.readShort();
            const hasPosition = reader.readBoolean();
            let x: number | undefined;
            let y: number | undefined;
            let level: number | undefined;
            if (hasPosition) {
                x = reader.readShort();
                y = reader.readShort();
                level = reader.readByte();
            }
            const loops = reader.readByte();
            const delay = reader.readShort();
            const radius = reader.readByte();
            const volume = reader.readByte();
            return {
                type: "sound",
                payload: { soundId, x, y, level, loops, delay, radius, volume },
            };
        }

        case ServerPacketId.PLAY_JINGLE:
            return {
                type: "play_jingle",
                payload: {
                    jingleId: reader.readShort(),
                    delay: reader.readUnsignedMediumIME(),
                },
            };

        case ServerPacketId.PLAY_SONG:
            return {
                type: "play_song",
                payload: {
                    trackId: reader.readShort(),
                    fadeOutDelay: reader.readShort(),
                    fadeOutDuration: reader.readShort(),
                    fadeInDelay: reader.readShort(),
                    fadeInDuration: reader.readShort(),
                },
            };

        case ServerPacketId.RUN_CLIENT_SCRIPT: {
            const scriptId = reader.readShort();
            const argCount = reader.readByte();
            const args: (number | string)[] = [];
            for (let i = 0; i < argCount; i++) {
                const type = reader.readByte();
                if (type === 0) {
                    args.push(reader.readString());
                } else {
                    args.push(reader.readInt());
                }
            }
            return {
                type: "runClientScript",
                payload: { scriptId, args },
            };
        }

        // ========================================
        // BANK
        // ========================================

        case ServerPacketId.BANK_SNAPSHOT: {
            const capacity = reader.readShort();
            const count = reader.readShort();
            const slots: any[] = [];
            for (let i = 0; i < count; i++) {
                const slot = reader.readShort();
                const itemId = reader.readShort() - 1;
                let quantity = reader.readByte();
                if (quantity === 255) {
                    quantity = reader.readInt();
                }
                const flags = reader.readByte();
                const placeholder = (flags & 1) !== 0;
                const tab = flags >> 1;
                slots.push({ slot, itemId, quantity, placeholder, tab });
            }
            return {
                type: "bank",
                payload: { kind: "snapshot", capacity, slots },
            };
        }

        case ServerPacketId.BANK_SLOT: {
            const slot = reader.readShort();
            const itemId = reader.readShort() - 1;
            let quantity = reader.readByte();
            if (quantity === 255) {
                quantity = reader.readInt();
            }
            const flags = reader.readByte();
            const placeholder = (flags & 1) !== 0;
            const tab = flags >> 1;
            return {
                type: "bank",
                payload: { kind: "slot", slot: { slot, itemId, quantity, placeholder, tab } },
            };
        }

        // ========================================
        // GROUND ITEMS
        // ========================================

        case ServerPacketId.GROUND_ITEMS: {
            const serial = reader.readInt();
            const count = reader.readShort();
            const stacks: any[] = [];
            for (let i = 0; i < count; i++) {
                stacks.push(readGroundItemStack());
            }
            return {
                type: "ground_items",
                payload: { kind: "snapshot", serial, stacks },
            };
        }

        case ServerPacketId.GROUND_ITEMS_DELTA: {
            const serial = reader.readInt();
            const upsertCount = reader.readShort();
            const upserts: any[] = [];
            for (let i = 0; i < upsertCount; i++) {
                upserts.push(readGroundItemStack());
            }
            const removeCount = reader.readShort();
            const removes: number[] = [];
            for (let i = 0; i < removeCount; i++) {
                removes.push(reader.readInt());
            }
            return {
                type: "ground_items",
                payload: { kind: "delta", serial, upserts, removes },
            };
        }

        // ========================================
        // PROJECTILES
        // ========================================

        case ServerPacketId.PROJECTILES: {
            const count = reader.readShort();
            const list: ProjectileLaunch[] = [];
            const decodeActorRef = (
                actorType: number,
                serverId: number,
            ): ProjectileLaunch["source"]["actor"] | undefined => {
                if (actorType === 1) {
                    return { kind: "player", serverId };
                }
                if (actorType === 2) {
                    return { kind: "npc", serverId };
                }
                return undefined;
            };
            for (let i = 0; i < count; i++) {
                list.push({
                    projectileId: reader.readShort(),
                    source: {
                        tileX: reader.readShort(),
                        tileY: reader.readShort(),
                        plane: reader.readByte(),
                        actor: undefined,
                    },
                    sourceHeight: reader.readShort(),
                    target: {
                        tileX: reader.readShort(),
                        tileY: reader.readShort(),
                        plane: reader.readByte(),
                        actor: undefined,
                    },
                    endHeight: reader.readShort(),
                    slope: reader.readByte(),
                    startPos: reader.readShort(),
                    startCycleOffset: reader.readShort(),
                    endCycleOffset: reader.readShort(),
                });
                const sourceActorType = reader.readByte();
                const sourceActorId = reader.readShort();
                const targetActorType = reader.readByte();
                const targetActorId = reader.readShort();
                const launch = list[i];
                launch.source.actor = decodeActorRef(sourceActorType, sourceActorId);
                launch.target.actor = decodeActorRef(targetActorType, targetActorId);
            }
            return {
                type: "projectiles",
                payload: { list },
            };
        }

        // ========================================
        // LOC CHANGE
        // ========================================

        case ServerPacketId.LOC_CHANGE: {
            const oldId = reader.readShort();
            const newId = reader.readShort();
            const tile = { x: reader.readShort(), y: reader.readShort() };
            const level = reader.readByte();
            const oldRotation = reader.readByte();
            const newRotation = reader.readByte();
            const hasNewTile = reader.readBoolean();
            let newTile: { x: number; y: number } | undefined;
            if (hasNewTile) {
                newTile = { x: reader.readShort(), y: reader.readShort() };
            }
            return {
                type: "loc_change",
                payload: {
                    oldId,
                    newId,
                    tile,
                    level,
                    oldTile: tile,
                    newTile,
                    oldRotation,
                    newRotation,
                },
            };
        }

        case ServerPacketId.LOC_ADD_CHANGE: {
            const locId = reader.readShort();
            const addTile = { x: reader.readShort(), y: reader.readShort() };
            const addLevel = reader.readByte();
            const shapeRot = reader.readByte();
            return {
                type: "loc_add_change",
                payload: {
                    locId,
                    tile: addTile,
                    level: addLevel,
                    shape: shapeRot >> 2,
                    rotation: shapeRot & 3,
                },
            };
        }

        case ServerPacketId.LOC_DEL: {
            const delTile = { x: reader.readShort(), y: reader.readShort() };
            const delLevel = reader.readByte();
            const delShapeRot = reader.readByte();
            return {
                type: "loc_del",
                payload: {
                    tile: delTile,
                    level: delLevel,
                    shape: delShapeRot >> 2,
                    rotation: delShapeRot & 3,
                },
            };
        }

        // ========================================
        // COMBAT STATE
        // ========================================

        case ServerPacketId.COMBAT_STATE: {
            const weaponCategory = reader.readByte();
            const weaponItemId = reader.readSignedShort();
            const autoRetaliate = reader.readBoolean();
            const activeStyle = reader.readByte();
            const activeSpellId = reader.readSignedShort();
            const specialEnergy = reader.readByte();
            const specialActivated = reader.readBoolean();
            const quickPrayersEnabled = reader.readBoolean();
            const activePrayersStr = reader.readString();
            const quickPrayersStr = reader.readString();
            return {
                type: "combat",
                payload: {
                    weaponCategory,
                    weaponItemId: weaponItemId >= 0 ? weaponItemId : undefined,
                    autoRetaliate,
                    activeStyle,
                    activeSpellId: activeSpellId >= 0 ? activeSpellId : undefined,
                    specialEnergy,
                    specialActivated,
                    quickPrayersEnabled,
                    activePrayers: activePrayersStr ? activePrayersStr.split(",") : [],
                    quickPrayers: quickPrayersStr ? quickPrayersStr.split(",") : [],
                },
            };
        }

        // ========================================
        // PLAYER ANIMATIONS
        // ========================================

        case ServerPacketId.ANIM: {
            const readAnim = () => {
                const v = reader.readSignedShort();
                return v >= 0 ? v : undefined;
            };
            return {
                type: "anim",
                payload: {
                    idle: readAnim(),
                    walk: readAnim(),
                    walkBack: readAnim(),
                    walkLeft: readAnim(),
                    walkRight: readAnim(),
                    run: readAnim(),
                    runBack: readAnim(),
                    runLeft: readAnim(),
                    runRight: readAnim(),
                    turnLeft: readAnim(),
                    turnRight: readAnim(),
                },
            };
        }

        // ========================================
        // PATH RESPONSE
        // ========================================

        case ServerPacketId.PATH_RESPONSE: {
            const id = reader.readInt();
            const ok = reader.readBoolean();
            const waypointCount = reader.readShort();
            const waypoints: Array<{ x: number; y: number }> = [];
            for (let i = 0; i < waypointCount; i++) {
                waypoints.push({ x: reader.readShort(), y: reader.readShort() });
            }
            const message = reader.readString() || undefined;
            return {
                type: "path",
                payload: {
                    id,
                    ok,
                    waypoints: waypoints.length > 0 ? waypoints : undefined,
                    message,
                },
            };
        }

        // ========================================
        // LOGIN/LOGOUT RESPONSE
        // ========================================

        case ServerPacketId.LOGIN_RESPONSE: {
            const success = reader.readBoolean();
            const errorCodeRaw = reader.readInt();
            const error = reader.readString() || undefined;
            const displayName = reader.readString() || undefined;
            const errorCode = errorCodeRaw >= 0 ? errorCodeRaw | 0 : undefined;
            return {
                type: "login_response",
                payload: { success, errorCode, error, displayName },
            };
        }

        case ServerPacketId.LOGOUT_RESPONSE: {
            const success = reader.readBoolean();
            const reason = reader.readString() || undefined;
            return {
                type: "logout_response",
                payload: { success, reason },
            };
        }

        // ========================================
        // SHOP
        // ========================================

        case ServerPacketId.SHOP_OPEN: {
            const shopId = reader.readString();
            const name = reader.readString();
            const currencyItemId = reader.readShort();
            const generalStore = reader.readBoolean();
            const buyMode = reader.readByte();
            const sellMode = reader.readByte();
            const stockCount = reader.readShort();
            const stock: any[] = [];
            for (let i = 0; i < stockCount; i++) {
                stock.push({
                    slot: reader.readShort(),
                    itemId: reader.readShort(),
                    quantity: reader.readInt(),
                    defaultQuantity: reader.readInt(),
                    priceEach: reader.readInt(),
                    sellPrice: reader.readInt(),
                });
            }
            return {
                type: "shop",
                payload: {
                    kind: "open",
                    shopId,
                    name,
                    currencyItemId,
                    generalStore,
                    buyMode,
                    sellMode,
                    stock,
                },
            };
        }

        case ServerPacketId.SHOP_SLOT: {
            const shopId = reader.readString();
            return {
                type: "shop",
                payload: {
                    kind: "slot",
                    shopId,
                    slot: {
                        slot: reader.readShort(),
                        itemId: reader.readShort(),
                        quantity: reader.readInt(),
                        defaultQuantity: reader.readInt(),
                        priceEach: reader.readInt(),
                        sellPrice: reader.readInt(),
                    },
                },
            };
        }

        case ServerPacketId.SHOP_CLOSE:
            return {
                type: "shop",
                payload: { kind: "close" },
            };

        case ServerPacketId.SHOP_MODE: {
            const shopId = reader.readString();
            return {
                type: "shop",
                payload: {
                    kind: "mode",
                    shopId,
                    buyMode: reader.readByte(),
                    sellMode: reader.readByte(),
                },
            };
        }

        // ========================================
        // TRADE
        // ========================================

        case ServerPacketId.TRADE_REQUEST: {
            const fromId = reader.readShort();
            const fromName = reader.readString() || undefined;
            return {
                type: "trade",
                payload: { kind: "request", fromId, fromName },
            };
        }

        case ServerPacketId.TRADE_OPEN:
        case ServerPacketId.TRADE_UPDATE: {
            const sessionId = reader.readString();
            const stage = reader.readByte() === 0 ? "offer" : "confirm";
            const info = reader.readString() || undefined;

            const readParty = () => {
                const playerId = reader.readSignedShort();
                const name = reader.readString() || undefined;
                const accepted = reader.readBoolean();
                const confirmAccepted = reader.readBoolean();
                const offerCount = reader.readByte();
                const offers: any[] = [];
                for (let i = 0; i < offerCount; i++) {
                    offers.push({
                        slot: reader.readShort(),
                        itemId: reader.readShort(),
                        quantity: reader.readInt(),
                    });
                }
                return {
                    playerId: playerId >= 0 ? playerId : undefined,
                    name,
                    offers,
                    accepted,
                    confirmAccepted,
                };
            };

            const self = readParty();
            const other = readParty();

            return {
                type: "trade",
                payload: {
                    kind: opcode === ServerPacketId.TRADE_OPEN ? "open" : "update",
                    sessionId,
                    stage,
                    self,
                    other,
                    info,
                },
            };
        }

        case ServerPacketId.TRADE_CLOSE: {
            const reason = reader.readString() || undefined;
            return {
                type: "trade",
                payload: { kind: "close", reason },
            };
        }

        // ========================================
        // SPELL RESULT
        // ========================================

        case ServerPacketId.SPELL_RESULT: {
            const casterId = reader.readShort();
            const spellId = reader.readShort();
            const outcome = reader.readByte() === 1 ? "success" : "failure";
            const reason = reader.readString() || undefined;

            const targetTypes = ["npc", "player", "loc", "obj", "tile", "item"];
            const targetType = targetTypes[reader.readByte()] as
                | "npc"
                | "player"
                | "loc"
                | "obj"
                | "tile"
                | "item";
            const targetIdRaw = reader.readSignedShort();
            const targetId = targetIdRaw >= 0 ? targetIdRaw : undefined;

            const hasTile = reader.readBoolean();
            let tile: { x: number; y: number; plane?: number } | undefined;
            if (hasTile) {
                tile = {
                    x: reader.readShort(),
                    y: reader.readShort(),
                    plane: reader.readByte(),
                };
            }

            const modFlags = reader.readByte();
            const castMode = reader.readString() || undefined;
            const modifiers: any = {};
            if (modFlags & 1) modifiers.isAutocast = true;
            if (modFlags & 2) modifiers.defensive = true;
            if (modFlags & 4) modifiers.queued = true;
            if (castMode) modifiers.castMode = castMode;

            const consumedCount = reader.readByte();
            const runesConsumed: Array<{ itemId: number; quantity: number }> = [];
            for (let i = 0; i < consumedCount; i++) {
                runesConsumed.push({
                    itemId: reader.readShort(),
                    quantity: reader.readInt(),
                });
            }

            const refundedCount = reader.readByte();
            const runesRefunded: Array<{ itemId: number; quantity: number }> = [];
            for (let i = 0; i < refundedCount; i++) {
                runesRefunded.push({
                    itemId: reader.readShort(),
                    quantity: reader.readInt(),
                });
            }

            const hitDelay = reader.readSignedShort();
            const impactSpotAnim = reader.readSignedShort();
            const castSpotAnim = reader.readSignedShort();
            const splashSpotAnim = reader.readSignedShort();
            const damage = reader.readSignedShort();
            const maxHit = reader.readSignedShort();
            const accuracy = reader.readSignedShort();

            return {
                type: "spell_result",
                payload: {
                    casterId,
                    spellId,
                    outcome,
                    reason,
                    targetType,
                    targetId,
                    tile,
                    modifiers: Object.keys(modifiers).length > 0 ? modifiers : undefined,
                    runesConsumed: runesConsumed.length > 0 ? runesConsumed : undefined,
                    runesRefunded: runesRefunded.length > 0 ? runesRefunded : undefined,
                    hitDelay: hitDelay >= 0 ? hitDelay : undefined,
                    impactSpotAnim: impactSpotAnim >= 0 ? impactSpotAnim : undefined,
                    castSpotAnim: castSpotAnim >= 0 ? castSpotAnim : undefined,
                    splashSpotAnim: splashSpotAnim >= 0 ? splashSpotAnim : undefined,
                    damage: damage >= 0 ? damage : undefined,
                    maxHit: maxHit >= 0 ? maxHit : undefined,
                    accuracy: accuracy >= 0 ? accuracy : undefined,
                },
            };
        }

        // ========================================
        // SMITHING
        // ========================================

        case ServerPacketId.SMITHING_OPEN: {
            const mode = reader.readByte() === 1 ? "forge" : "smelt";
            const title = reader.readString();
            const optionCount = reader.readShort();
            const options: any[] = [];
            for (let i = 0; i < optionCount; i++) {
                const recipeId = reader.readString();
                const name = reader.readString();
                const level = reader.readByte();
                const itemId = reader.readShort();
                const outputQuantity = reader.readShort();
                const available = reader.readShort();
                const canMake = reader.readBoolean();
                const xp = reader.readShort();
                const ingredientsLabel = reader.readString() || undefined;
                const optMode = reader.readByte() === 1 ? "forge" : "smelt";
                const barItemId = reader.readSignedShort();
                const barCount = reader.readByte();
                const flags = reader.readByte();
                const requiresHammer = (flags & 1) !== 0;
                const hasHammer = (flags & 2) !== 0;
                options.push({
                    recipeId,
                    name,
                    level,
                    itemId,
                    outputQuantity,
                    available,
                    canMake,
                    xp: xp > 0 ? xp : undefined,
                    ingredientsLabel,
                    mode: optMode,
                    barItemId: barItemId >= 0 ? barItemId : undefined,
                    barCount: barCount > 0 ? barCount : undefined,
                    requiresHammer: requiresHammer || undefined,
                    hasHammer: hasHammer || undefined,
                });
            }
            const quantityMode = reader.readByte();
            const customQuantity = reader.readInt();
            return {
                type: "smithing",
                payload: {
                    kind: "open",
                    mode,
                    title,
                    options,
                    quantityMode,
                    customQuantity: customQuantity > 0 ? customQuantity : undefined,
                },
            };
        }

        case ServerPacketId.SMITHING_MODE: {
            const quantityMode = reader.readByte();
            const customQuantity = reader.readInt();
            return {
                type: "smithing",
                payload: {
                    kind: "mode",
                    quantityMode,
                    customQuantity: customQuantity > 0 ? customQuantity : undefined,
                },
            };
        }

        case ServerPacketId.SMITHING_CLOSE:
            return {
                type: "smithing",
                payload: { kind: "close" },
            };

        // ========================================
        // COLLECTION LOG
        // ========================================

        case ServerPacketId.COLLECTION_LOG_SNAPSHOT: {
            const count = reader.readShort();
            const slots: Array<{ slot: number; itemId: number; quantity: number }> = [];
            for (let i = 0; i < count; i++) {
                slots.push({
                    slot: reader.readShort(),
                    itemId: reader.readShort(),
                    quantity: reader.readInt(),
                });
            }
            return {
                type: "collection_log",
                payload: { kind: "snapshot", slots },
            };
        }

        // ========================================
        // NOTIFICATIONS
        // ========================================

        case ServerPacketId.NOTIFICATION: {
            const kinds = [
                "loot",
                "achievement",
                "level_up",
                "quest",
                "warning",
                "info",
                "league_task",
                "collection_log",
            ];
            const kind = kinds[reader.readByte()] || "info";
            const title = reader.readString();
            const message = reader.readString();
            const itemId = reader.readShort();
            const quantity = reader.readInt();
            const durationMs = reader.readShort();
            return {
                type: "notification",
                payload: {
                    kind,
                    title,
                    message,
                    itemId,
                    quantity,
                    durationMs,
                },
            };
        }

        // ========================================
        // DEBUG
        // ========================================

        case ServerPacketId.DEBUG_PACKET: {
            const jsonStr = reader.readString();
            try {
                const payload = JSON.parse(jsonStr);
                return {
                    type: "debug",
                    payload,
                };
            } catch {
                return {
                    type: "debug",
                    payload: { raw: jsonStr },
                };
            }
        }

        default:
            console.warn(`Unknown server packet opcode: ${opcode}`);
            return null;
    }
}

/**
 * Check if data is binary (starts with valid opcode) or JSON (starts with '{')
 */
export function isBinaryPacket(data: ArrayBuffer | string): boolean {
    if (typeof data === "string") {
        return false;
    }
    const view = new Uint8Array(data);
    if (view.length === 0) return false;
    // JSON starts with '{' (0x7B)
    return view[0] !== 0x7b;
}

/**
 * Decode multiple batched packets from a single ArrayBuffer
 * Server may concatenate multiple packets into one message for efficiency
 */
export function decodeBatchedServerPackets(data: Uint8Array | ArrayBuffer): DecodedServerMessage[] {
    const messages: DecodedServerMessage[] = [];
    const buffer = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
    let offset = 0;

    while (offset < buffer.length) {
        const remaining = buffer.length - offset;
        if (remaining < 1) break;

        const opcode = buffer[offset] as ServerPacketId;
        const fixedLength = SERVER_PACKET_LENGTHS[opcode];

        let packetLength: number;
        let headerSize: number;

        if (fixedLength === undefined) {
            // Unknown opcode - can't continue parsing
            console.warn(`[batch] Unknown opcode ${opcode} at offset ${offset}`);
            break;
        } else if (fixedLength === -1) {
            // Variable byte length
            if (remaining < 2) break;
            packetLength = buffer[offset + 1];
            headerSize = 2;
        } else if (fixedLength === -2) {
            // Variable short length
            if (remaining < 3) break;
            packetLength = (buffer[offset + 1] << 8) | buffer[offset + 2];
            headerSize = 3;
        } else {
            // Fixed length
            packetLength = fixedLength;
            headerSize = 1;
        }

        const totalPacketSize = headerSize + packetLength;
        if (remaining < totalPacketSize) {
            console.warn(
                `[batch] Incomplete packet at offset ${offset}, need ${totalPacketSize}, have ${remaining}`,
            );
            break;
        }

        // Extract this packet and decode it
        const packetData = buffer.slice(offset, offset + totalPacketSize);
        const decoded = decodeServerPacket(packetData);
        if (decoded) {
            messages.push(decoded);
        }

        offset += totalPacketSize;
    }

    return messages;
}
