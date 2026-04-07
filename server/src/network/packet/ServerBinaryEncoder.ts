/**
 * ServerBinaryEncoder - Encode server messages to binary format
 *
 * Replaces JSON.stringify for server-to-client messages.
 * Binary encoding helpers for server packets.
 */
import {
    SERVER_PACKET_LENGTHS,
    ServerPacketId,
} from "../../../../src/shared/packets/ServerPacketId";
import {
    INSTANCE_CHUNK_COUNT,
    PLANE_COUNT,
} from "../../../../src/shared/instance/InstanceTypes";
import type { WorldEntityBuildArea } from "../../../../src/shared/worldentity/WorldEntityTypes";
import type { ProjectileLaunch } from "../../../../src/shared/projectiles/ProjectileLaunch";
import { BitWriter } from "../BitWriter";

/**
 * Binary packet buffer for server encoding
 */
export class ServerPacketBuffer {
    readonly data: Uint8Array;
    offset: number = 0;

    constructor(size: number = 5000) {
        this.data = new Uint8Array(size);
    }

    // ========================================
    // WRITE METHODS
    // ========================================

    writeByte(value: number): void {
        this.data[this.offset++] = value & 0xff;
    }

    writeShort(value: number): void {
        this.data[this.offset++] = (value >> 8) & 0xff;
        this.data[this.offset++] = value & 0xff;
    }

    writeInt(value: number): void {
        this.data[this.offset++] = (value >> 24) & 0xff;
        this.data[this.offset++] = (value >> 16) & 0xff;
        this.data[this.offset++] = (value >> 8) & 0xff;
        this.data[this.offset++] = value & 0xff;
    }

    writeBoolean(value: boolean): void {
        this.writeByte(value ? 1 : 0);
    }

    writeString(str: string): void {
        for (let i = 0; i < str.length; i++) {
            this.data[this.offset++] = str.charCodeAt(i) & 0xff;
        }
        this.data[this.offset++] = 0; // null terminator
    }

    writeSmartByteShort(value: number): void {
        if (value >= 0 && value < 128) {
            this.writeByte(value);
        } else if (value >= 0 && value < 32768) {
            this.writeShort(value + 32768);
        } else {
            throw new Error(`writeSmartByteShort out of range: ${value}`);
        }
    }

    writeBytes(src: Uint8Array, srcOffset: number, length: number): void {
        for (let i = 0; i < length; i++) {
            this.data[this.offset++] = src[srcOffset + i];
        }
    }

    /** Write byte with ADD encoding: (value + 128) & 0xFF */
    writeByteAdd(value: number): void {
        this.data[this.offset++] = (value + 128) & 0xff;
    }

    /** Write byte with NEG encoding: (0 - value) & 0xFF */
    writeByteNeg(value: number): void {
        this.data[this.offset++] = (0 - value) & 0xff;
    }

    /** Write byte with SUB encoding: (128 - value) & 0xFF */
    writeByteSub(value: number): void {
        this.data[this.offset++] = (128 - value) & 0xff;
    }

    /** Write short little-endian: [low, high] */
    writeShortLE(value: number): void {
        this.data[this.offset++] = value & 0xff;
        this.data[this.offset++] = (value >> 8) & 0xff;
    }

    /** Write short with ADD encoding: [low+128, high] */
    writeShortAdd(value: number): void {
        this.data[this.offset++] = (value + 128) & 0xff;
        this.data[this.offset++] = (value >> 8) & 0xff;
    }

    /** Write short with ADD LE encoding: [high, low+128] */
    writeShortAddLE(value: number): void {
        this.data[this.offset++] = (value >> 8) & 0xff;
        this.data[this.offset++] = (value + 128) & 0xff;
    }

    /** Write int little-endian: [b0, b1, b2, b3] */
    writeIntLE(value: number): void {
        this.data[this.offset++] = value & 0xff;
        this.data[this.offset++] = (value >> 8) & 0xff;
        this.data[this.offset++] = (value >> 16) & 0xff;
        this.data[this.offset++] = (value >> 24) & 0xff;
    }

    /** Write int middle-endian: [b1, b0, b3, b2] */
    writeIntME(value: number): void {
        this.data[this.offset++] = (value >> 8) & 0xff;
        this.data[this.offset++] = value & 0xff;
        this.data[this.offset++] = (value >> 24) & 0xff;
        this.data[this.offset++] = (value >> 16) & 0xff;
    }

    /** Write int inverse middle-endian: [b2, b3, b0, b1] */
    writeIntIME(value: number): void {
        this.data[this.offset++] = (value >> 16) & 0xff;
        this.data[this.offset++] = (value >> 24) & 0xff;
        this.data[this.offset++] = value & 0xff;
        this.data[this.offset++] = (value >> 8) & 0xff;
    }

    /** Write medium inverse middle-endian: [high, low, mid] */
    writeMediumIME(value: number): void {
        this.data[this.offset++] = (value >> 16) & 0xff;
        this.data[this.offset++] = value & 0xff;
        this.data[this.offset++] = (value >> 8) & 0xff;
    }

    /**
     * Get the packet data with opcode and length prefix
     */
    toPacket(opcode: ServerPacketId): Uint8Array {
        const length = SERVER_PACKET_LENGTHS[opcode];
        const dataLen = this.offset;

        if (length === -1) {
            // Variable byte length
            if (dataLen > 0xff) {
                throw new Error(
                    `Packet too large for byte length prefix (opcode=${opcode} len=${dataLen})`,
                );
            }
            const result = new Uint8Array(dataLen + 2);
            result[0] = opcode;
            result[1] = dataLen & 0xff;
            result.set(this.data.subarray(0, dataLen), 2);
            return result;
        } else if (length === -2) {
            // Variable short length
            if (dataLen > 0xffff) {
                throw new Error(
                    `Packet too large for short length prefix (opcode=${opcode} len=${dataLen})`,
                );
            }
            const result = new Uint8Array(dataLen + 3);
            result[0] = opcode;
            result[1] = (dataLen >> 8) & 0xff;
            result[2] = dataLen & 0xff;
            result.set(this.data.subarray(0, dataLen), 3);
            return result;
        } else {
            // Fixed length
            if (dataLen !== length) {
                throw new Error(
                    `Packet length mismatch (opcode=${opcode} expected=${length} actual=${dataLen})`,
                );
            }
            const result = new Uint8Array(length + 1);
            result[0] = opcode;
            result.set(this.data.subarray(0, length), 1);
            return result;
        }
    }

    reset(): void {
        this.offset = 0;
    }
}

/**
 * Encode server messages to binary packets
 */
export class ServerBinaryEncoder {
    private buffer = new ServerPacketBuffer(65536);

    // ========================================
    // CORE PROTOCOL
    // ========================================

    encodeWelcome(tickMs: number, serverTime: number): Uint8Array {
        this.buffer.reset();
        this.buffer.writeInt(tickMs);
        this.buffer.writeInt(serverTime);
        return this.buffer.toPacket(ServerPacketId.WELCOME);
    }

    encodeTick(tick: number, time: number): Uint8Array {
        this.buffer.reset();
        this.buffer.writeInt(tick);
        this.buffer.writeInt(time);
        return this.buffer.toPacket(ServerPacketId.TICK);
    }

    encodeDestination(worldX: number, worldY: number): Uint8Array {
        this.buffer.reset();
        this.buffer.writeShort(worldX);
        this.buffer.writeShort(worldY);
        return this.buffer.toPacket(ServerPacketId.DESTINATION);
    }

    encodeHandshake(
        id: number,
        name?: string,
        appearance?: { gender?: number; colors?: number[]; kits?: number[]; equip?: number[] },
        chatIcons?: number[],
        chatPrefix?: string,
    ): Uint8Array {
        this.buffer.reset();
        this.buffer.writeInt(id);
        this.buffer.writeString(name ?? "");
        if (appearance) {
            this.buffer.writeBoolean(true);
            this.buffer.writeByte(appearance.gender ?? 0);
            // colors
            const colors = appearance.colors ?? [];
            this.buffer.writeByte(colors.length);
            for (const c of colors) this.buffer.writeByte(c);
            // kits
            const kits = appearance.kits ?? [];
            this.buffer.writeByte(kits.length);
            for (const k of kits) this.buffer.writeShort(k);
            // equip
            const equip = appearance.equip ?? [];
            this.buffer.writeByte(equip.length);
            for (const e of equip) this.buffer.writeShort(e);
        } else {
            this.buffer.writeBoolean(false);
        }
        const icons = Array.isArray(chatIcons)
            ? chatIcons.filter((icon) => Number.isFinite(icon) && icon >= 0 && icon <= 255)
            : [];
        this.buffer.writeByte(icons.length & 0xff);
        for (const icon of icons) {
            this.buffer.writeByte(icon & 0xff);
        }
        this.buffer.writeString(chatPrefix ?? "");
        return this.buffer.toPacket(ServerPacketId.HANDSHAKE);
    }

    // ========================================
    // VARPS
    // ========================================

    encodeVarpSmall(varpId: number, value: number): Uint8Array {
        this.buffer.reset();
        this.buffer.writeShort(varpId);
        this.buffer.writeByte(value);
        return this.buffer.toPacket(ServerPacketId.VARP_SMALL);
    }

    encodeVarpLarge(varpId: number, value: number): Uint8Array {
        this.buffer.reset();
        this.buffer.writeShort(varpId);
        this.buffer.writeInt(value);
        return this.buffer.toPacket(ServerPacketId.VARP_LARGE);
    }

    encodeVarp(varpId: number, value: number): Uint8Array {
        // Use small encoding if value fits in a byte
        if (value >= 0 && value <= 255) {
            return this.encodeVarpSmall(varpId, value);
        }
        return this.encodeVarpLarge(varpId, value);
    }

    encodeVarbit(varbitId: number, value: number): Uint8Array {
        this.buffer.reset();
        this.buffer.writeShort(varbitId);
        this.buffer.writeInt(value);
        return this.buffer.toPacket(ServerPacketId.VARBIT);
    }

    // ========================================
    // PLAYER/NPC SYNC
    // ========================================

    encodePlayerSync(
        baseX: number,
        baseY: number,
        localIndex: number,
        loopCycle: number,
        packet: Uint8Array,
    ): Uint8Array {
        this.buffer.reset();
        this.buffer.writeShort(baseX);
        this.buffer.writeShort(baseY);
        this.buffer.writeShort(localIndex);
        this.buffer.writeInt(loopCycle);
        this.buffer.writeShort(packet.length);
        this.buffer.writeBytes(packet, 0, packet.length);
        return this.buffer.toPacket(ServerPacketId.PLAYER_SYNC);
    }

    encodeNpcInfo(loopCycle: number, large: boolean, packet: Uint8Array): Uint8Array {
        this.buffer.reset();
        this.buffer.writeInt(loopCycle);
        this.buffer.writeBoolean(large);
        this.buffer.writeShort(packet.length);
        this.buffer.writeBytes(packet, 0, packet.length);
        return this.buffer.toPacket(ServerPacketId.NPC_INFO);
    }

    // ========================================
    // INVENTORY
    // ========================================

    encodeInventorySnapshot(
        slots: Array<{ slot: number; itemId: number; quantity: number }>,
    ): Uint8Array {
        this.buffer.reset();
        this.buffer.writeShort(slots.length);
        for (const s of slots) {
            this.buffer.writeShort(s.slot);
            this.buffer.writeShort(s.itemId + 1); // +1 for 0=empty convention
            if (s.quantity >= 255) {
                this.buffer.writeByte(255);
                this.buffer.writeInt(s.quantity);
            } else {
                this.buffer.writeByte(s.quantity);
            }
        }
        return this.buffer.toPacket(ServerPacketId.INVENTORY_SNAPSHOT);
    }

    encodeInventorySlot(slot: number, itemId: number, quantity: number): Uint8Array {
        this.buffer.reset();
        this.buffer.writeShort(slot);
        this.buffer.writeShort(itemId + 1);
        if (quantity >= 255) {
            this.buffer.writeByte(255);
            this.buffer.writeInt(quantity);
        } else {
            this.buffer.writeByte(quantity);
        }
        return this.buffer.toPacket(ServerPacketId.INVENTORY_SLOT);
    }

    // ========================================
    // SKILLS
    // ========================================

    private encodeSkillsInternal(
        skills: Array<{
            id: number;
            xp: number;
            baseLevel: number;
            virtualLevel: number;
            boost: number;
            currentLevel: number;
        }>,
        totalLevel: number,
        combatLevel: number,
        packetId: ServerPacketId,
    ): Uint8Array {
        this.buffer.reset();
        this.buffer.writeByte(skills.length);
        for (const s of skills) {
            this.buffer.writeByte(s.id);
            this.buffer.writeInt(s.xp);
            this.buffer.writeByte(s.baseLevel);
            this.buffer.writeByte(s.virtualLevel);
            this.buffer.writeByte(s.boost + 128); // signed -> unsigned offset
            this.buffer.writeByte(s.currentLevel);
        }
        this.buffer.writeShort(totalLevel);
        this.buffer.writeByte(combatLevel);
        return this.buffer.toPacket(packetId);
    }

    encodeSkillsSnapshot(
        skills: Array<{
            id: number;
            xp: number;
            baseLevel: number;
            virtualLevel: number;
            boost: number;
            currentLevel: number;
        }>,
        totalLevel: number,
        combatLevel: number,
    ): Uint8Array {
        return this.encodeSkillsInternal(
            skills,
            totalLevel,
            combatLevel,
            ServerPacketId.SKILLS_SNAPSHOT,
        );
    }

    encodeSkillsDelta(
        skills: Array<{
            id: number;
            xp: number;
            baseLevel: number;
            virtualLevel: number;
            boost: number;
            currentLevel: number;
        }>,
        totalLevel: number,
        combatLevel: number,
    ): Uint8Array {
        return this.encodeSkillsInternal(
            skills,
            totalLevel,
            combatLevel,
            ServerPacketId.SKILLS_DELTA,
        );
    }

    // ========================================
    // COMBAT/EFFECTS
    // ========================================

    encodeRunEnergy(percent: number, running: boolean): Uint8Array {
        this.buffer.reset();
        this.buffer.writeByte(percent);
        this.buffer.writeBoolean(running);
        return this.buffer.toPacket(ServerPacketId.RUN_ENERGY);
    }

    encodeSpotAnim(
        spotId: number,
        playerId?: number,
        npcId?: number,
        height?: number,
        delay?: number,
    ): Uint8Array {
        this.buffer.reset();
        this.buffer.writeShort(spotId);
        this.buffer.writeByte(playerId !== undefined ? 0 : npcId !== undefined ? 1 : 2);
        if (playerId !== undefined) {
            this.buffer.writeShort(playerId);
        } else if (npcId !== undefined) {
            this.buffer.writeShort(npcId);
        }
        this.buffer.writeByte(height ?? 0);
        this.buffer.writeShort(delay ?? 0);
        return this.buffer.toPacket(ServerPacketId.SPOT_ANIM);
    }

    // ========================================
    // WIDGETS
    // ========================================

    encodeWidgetOpen(groupId: number, modal: boolean): Uint8Array {
        this.buffer.reset();
        this.buffer.writeShort(groupId);
        this.buffer.writeBoolean(modal);
        return this.buffer.toPacket(ServerPacketId.WIDGET_OPEN);
    }

    encodeWidgetClose(groupId: number): Uint8Array {
        this.buffer.reset();
        this.buffer.writeShort(groupId);
        return this.buffer.toPacket(ServerPacketId.WIDGET_CLOSE);
    }

    encodeWidgetSetRoot(groupId: number): Uint8Array {
        this.buffer.reset();
        this.buffer.writeShort(groupId);
        return this.buffer.toPacket(ServerPacketId.WIDGET_SET_ROOT);
    }

    encodeWidgetOpenSub(
        targetUid: number,
        groupId: number,
        type: number,
        varps?: Record<number, number>,
        varbits?: Record<number, number>,
        hiddenUids?: number[],
        preScripts?: Array<{ scriptId: number; args: (number | string)[] }>,
        postScripts?: Array<{ scriptId: number; args: (number | string)[] }>,
    ): Uint8Array {
        this.buffer.reset();
        this.buffer.writeInt(targetUid);
        this.buffer.writeShort(groupId);
        this.buffer.writeByte(type);

        // Varps
        const varpEntries = varps ? Object.entries(varps) : [];
        this.buffer.writeByte(varpEntries.length);
        for (const [id, val] of varpEntries) {
            this.buffer.writeShort(parseInt(id, 10));
            this.buffer.writeInt(val);
        }

        // Varbits
        const varbitEntries = varbits ? Object.entries(varbits) : [];
        this.buffer.writeByte(varbitEntries.length);
        for (const [id, val] of varbitEntries) {
            this.buffer.writeShort(parseInt(id, 10));
            this.buffer.writeInt(val);
        }

        // UIDs to hide immediately after mount (processed within open_sub handling).
        const hidden = Array.isArray(hiddenUids) ? hiddenUids : [];
        this.buffer.writeByte(hidden.length);
        for (const uid of hidden) {
            this.buffer.writeInt(uid);
        }

        const writeScriptList = (
            scripts?: Array<{ scriptId: number; args: (number | string)[] }>,
        ): void => {
            const list = Array.isArray(scripts) ? scripts : [];
            this.buffer.writeByte(list.length);
            for (const script of list) {
                this.buffer.writeInt(script.scriptId);
                const args = Array.isArray(script.args) ? script.args : [];
                this.buffer.writeByte(args.length);
                for (const arg of args) {
                    if (typeof arg === "number" && Number.isFinite(arg)) {
                        this.buffer.writeByte(1);
                        this.buffer.writeInt(arg);
                    } else {
                        this.buffer.writeByte(0);
                        this.buffer.writeString((arg as string) ?? "");
                    }
                }
            }
        };

        writeScriptList(preScripts);
        writeScriptList(postScripts);

        return this.buffer.toPacket(ServerPacketId.WIDGET_OPEN_SUB);
    }

    encodeWidgetCloseSub(targetUid: number): Uint8Array {
        this.buffer.reset();
        this.buffer.writeInt(targetUid);
        return this.buffer.toPacket(ServerPacketId.WIDGET_CLOSE_SUB);
    }

    encodeWidgetSetText(uid: number, text: string): Uint8Array {
        this.buffer.reset();
        this.buffer.writeInt(uid);
        this.buffer.writeString(text);
        return this.buffer.toPacket(ServerPacketId.WIDGET_SET_TEXT);
    }

    encodeWidgetSetHidden(uid: number, hidden: boolean): Uint8Array {
        this.buffer.reset();
        this.buffer.writeInt(uid);
        this.buffer.writeBoolean(hidden);
        return this.buffer.toPacket(ServerPacketId.WIDGET_SET_HIDDEN);
    }

    encodeWidgetSetItem(uid: number, itemId: number, quantity: number): Uint8Array {
        this.buffer.reset();
        this.buffer.writeInt(uid);
        this.buffer.writeShort(itemId);
        this.buffer.writeInt(quantity);
        return this.buffer.toPacket(ServerPacketId.WIDGET_SET_ITEM);
    }

    encodeWidgetSetNpcHead(uid: number, npcId: number): Uint8Array {
        this.buffer.reset();
        this.buffer.writeInt(uid);
        this.buffer.writeShort(npcId);
        return this.buffer.toPacket(ServerPacketId.WIDGET_SET_NPC_HEAD);
    }

    encodeWidgetSetFlagsRange(
        uid: number,
        fromSlot: number,
        toSlot: number,
        flags: number,
    ): Uint8Array {
        this.buffer.reset();
        this.buffer.writeInt(uid);
        this.buffer.writeShort(fromSlot);
        this.buffer.writeShort(toSlot);
        this.buffer.writeInt(flags);
        return this.buffer.toPacket(ServerPacketId.WIDGET_SET_FLAGS_RANGE);
    }

    encodeWidgetRunScript(scriptId: number, args: (number | string)[]): Uint8Array {
        this.buffer.reset();
        this.buffer.writeInt(scriptId);
        this.buffer.writeByte(args.length);
        for (const arg of args) {
            if (Number.isFinite(arg as number)) {
                this.buffer.writeByte(1); // int type
                this.buffer.writeInt(arg);
            } else {
                this.buffer.writeByte(0); // string type
                this.buffer.writeString((arg as string) ?? "");
            }
        }
        return this.buffer.toPacket(ServerPacketId.WIDGET_RUN_SCRIPT);
    }

    encodeWidgetSetFlags(uid: number, flags: number): Uint8Array {
        this.buffer.reset();
        this.buffer.writeInt(uid);
        this.buffer.writeInt(flags);
        return this.buffer.toPacket(ServerPacketId.WIDGET_SET_FLAGS);
    }

    encodeWidgetSetAnimation(uid: number, animationId: number): Uint8Array {
        this.buffer.reset();
        this.buffer.writeInt(uid);
        this.buffer.writeShort(animationId);
        return this.buffer.toPacket(ServerPacketId.WIDGET_SET_ANIMATION);
    }

    encodeWidgetSetPlayerHead(uid: number): Uint8Array {
        this.buffer.reset();
        this.buffer.writeInt(uid);
        return this.buffer.toPacket(ServerPacketId.WIDGET_SET_PLAYER_HEAD);
    }

    // ========================================
    // CHAT
    // ========================================

    encodeChatMessage(
        messageType: string,
        text: string,
        from?: string,
        prefix?: string,
        playerId?: number,
    ): Uint8Array {
        this.buffer.reset();
        // messageType as byte: game=0, public=1, private_in=2, etc.
        const typeMap: Record<string, number> = {
            game: 0,
            public: 1,
            private_in: 2,
            private_out: 3,
            channel: 4,
            clan: 5,
            trade: 6,
            server: 7,
        };
        this.buffer.writeByte(typeMap[messageType] ?? 0);
        this.buffer.writeString(text);
        this.buffer.writeString(from ?? "");
        this.buffer.writeString(prefix ?? "");
        this.buffer.writeShort(playerId ?? -1);
        return this.buffer.toPacket(ServerPacketId.CHAT_MESSAGE);
    }

    // ========================================
    // SOUND
    // ========================================

    encodeSound(
        soundId: number,
        x?: number,
        y?: number,
        level?: number,
        loops?: number,
        delay?: number,
        radius?: number,
        volume?: number,
    ): Uint8Array {
        this.buffer.reset();
        this.buffer.writeShort(soundId);
        this.buffer.writeBoolean(x !== undefined);
        if (x !== undefined) {
            this.buffer.writeShort(x);
            this.buffer.writeShort(y ?? 0);
            this.buffer.writeByte(level ?? 0);
        }
        this.buffer.writeByte(loops ?? 0);
        this.buffer.writeShort(delay ?? 0);
        this.buffer.writeByte(radius ?? 0);
        this.buffer.writeByte(volume ?? 255);
        return this.buffer.toPacket(ServerPacketId.SOUND);
    }

    encodePlayJingle(jingleId: number, delay?: number): Uint8Array {
        this.buffer.reset();
        this.buffer.writeShort(jingleId);
        this.buffer.writeMediumIME(Math.max(0, Math.min(0xffffff, delay ?? 0)));
        return this.buffer.toPacket(ServerPacketId.PLAY_JINGLE);
    }

    encodePlaySong(
        trackId: number,
        fadeOutDelay?: number,
        fadeOutDuration?: number,
        fadeInDelay?: number,
        fadeInDuration?: number,
    ): Uint8Array {
        this.buffer.reset();
        this.buffer.writeShort(trackId);
        //  default 
        this.buffer.writeShort(fadeOutDelay ?? 0);
        this.buffer.writeShort(fadeOutDuration ?? 100);
        this.buffer.writeShort(fadeInDelay ?? 100);
        this.buffer.writeShort(fadeInDuration ?? 0);
        return this.buffer.toPacket(ServerPacketId.PLAY_SONG);
    }

    // ========================================
    // CLIENT SCRIPTS
    // ========================================

    encodeRunClientScript(scriptId: number, args: (number | string)[]): Uint8Array {
        this.buffer.reset();
        this.buffer.writeShort(scriptId);
        this.buffer.writeByte(args.length);
        for (const arg of args) {
            if (typeof arg === "number" && Number.isFinite(arg)) {
                this.buffer.writeByte(1); // int type
                this.buffer.writeInt(arg);
            } else {
                this.buffer.writeByte(0); // string type
                this.buffer.writeString((arg as string) ?? "");
            }
        }
        return this.buffer.toPacket(ServerPacketId.RUN_CLIENT_SCRIPT);
    }

    // ========================================
    // BANK
    // ========================================

    encodeBankSnapshot(
        capacity: number,
        slots: Array<{
            slot: number;
            itemId: number;
            quantity: number;
            placeholder?: boolean;
            tab?: number;
        }>,
    ): Uint8Array {
        this.buffer.reset();
        this.buffer.writeShort(capacity);
        this.buffer.writeShort(slots.length);
        for (const s of slots) {
            this.buffer.writeShort(s.slot);
            this.buffer.writeShort(s.itemId + 1);
            if (s.quantity >= 255) {
                this.buffer.writeByte(255);
                this.buffer.writeInt(s.quantity);
            } else {
                this.buffer.writeByte(s.quantity);
            }
            this.buffer.writeByte((s.placeholder ? 1 : 0) | ((s.tab ?? 0) << 1));
        }
        return this.buffer.toPacket(ServerPacketId.BANK_SNAPSHOT);
    }

    encodeBankSlot(
        slot: number,
        itemId: number,
        quantity: number,
        placeholder?: boolean,
        tab?: number,
    ): Uint8Array {
        this.buffer.reset();
        this.buffer.writeShort(slot);
        this.buffer.writeShort(itemId + 1);
        if (quantity >= 255) {
            this.buffer.writeByte(255);
            this.buffer.writeInt(quantity);
        } else {
            this.buffer.writeByte(quantity);
        }
        this.buffer.writeByte((placeholder ? 1 : 0) | ((tab ?? 0) << 1));
        return this.buffer.toPacket(ServerPacketId.BANK_SLOT);
    }

    // ========================================
    // GROUND ITEMS
    // ========================================

    encodeGroundItems(
        serial: number,
        stacks: Array<{
            id: number;
            itemId: number;
            quantity: number;
            tile: { x: number; y: number; level: number };
            createdTick?: number;
            privateUntilTick?: number;
            expiresTick?: number;
            ownerId?: number;
            isPrivate?: boolean;
            ownership?: 0 | 1 | 2 | 3;
        }>,
    ): Uint8Array {
        this.buffer.reset();
        this.buffer.writeInt(serial);
        this.buffer.writeShort(stacks.length);
        for (const s of stacks) {
            this.buffer.writeInt(s.id);
            this.buffer.writeShort(s.itemId);
            this.buffer.writeInt(s.quantity);
            this.buffer.writeShort(s.tile.x);
            this.buffer.writeShort(s.tile.y);
            this.buffer.writeByte(s.tile.level);
            this.buffer.writeInt(Number.isFinite(s.createdTick) ? (s.createdTick as number) : -1);
            this.buffer.writeInt(
                s.privateUntilTick && s.privateUntilTick > 0 ? s.privateUntilTick : 0,
            );
            this.buffer.writeInt(s.expiresTick && s.expiresTick > 0 ? s.expiresTick : 0);
            this.buffer.writeInt(s.ownerId !== undefined ? s.ownerId : -1);
            this.buffer.writeBoolean(s.isPrivate === true);
            const ownership = s.ownership;
            this.buffer.writeByte(
                ownership === 1 || ownership === 2 || ownership === 3 || ownership === 0
                    ? ownership
                    : 0,
            );
        }
        return this.buffer.toPacket(ServerPacketId.GROUND_ITEMS);
    }

    encodeGroundItemsDelta(
        serial: number,
        upserts: Array<{
            id: number;
            itemId: number;
            quantity: number;
            tile: { x: number; y: number; level: number };
            createdTick?: number;
            privateUntilTick?: number;
            expiresTick?: number;
            ownerId?: number;
            isPrivate?: boolean;
            ownership?: 0 | 1 | 2 | 3;
        }>,
        removes: number[],
    ): Uint8Array {
        this.buffer.reset();
        this.buffer.writeInt(serial);
        this.buffer.writeShort(upserts.length);
        for (const s of upserts) {
            this.buffer.writeInt(s.id);
            this.buffer.writeShort(s.itemId);
            this.buffer.writeInt(s.quantity);
            this.buffer.writeShort(s.tile.x);
            this.buffer.writeShort(s.tile.y);
            this.buffer.writeByte(s.tile.level);
            this.buffer.writeInt(Number.isFinite(s.createdTick) ? (s.createdTick as number) : -1);
            this.buffer.writeInt(
                s.privateUntilTick && s.privateUntilTick > 0 ? s.privateUntilTick : 0,
            );
            this.buffer.writeInt(s.expiresTick && s.expiresTick > 0 ? s.expiresTick : 0);
            this.buffer.writeInt(s.ownerId !== undefined ? s.ownerId : -1);
            this.buffer.writeBoolean(s.isPrivate === true);
            const ownership = s.ownership;
            this.buffer.writeByte(
                ownership === 1 || ownership === 2 || ownership === 3 || ownership === 0
                    ? ownership
                    : 0,
            );
        }
        this.buffer.writeShort(removes.length);
        for (const stackId of removes) {
            this.buffer.writeInt(stackId);
        }
        return this.buffer.toPacket(ServerPacketId.GROUND_ITEMS_DELTA);
    }

    // ========================================
    // PROJECTILES
    // ========================================

    encodeProjectiles(list: ProjectileLaunch[]): Uint8Array {
        this.buffer.reset();
        this.buffer.writeShort(list.length);
        for (const launch of list) {
            this.buffer.writeShort(launch.projectileId);
            this.buffer.writeShort(launch.source.tileX);
            this.buffer.writeShort(launch.source.tileY);
            this.buffer.writeByte(launch.source.plane);
            this.buffer.writeShort(launch.sourceHeight);
            this.buffer.writeShort(launch.target.tileX);
            this.buffer.writeShort(launch.target.tileY);
            this.buffer.writeByte(launch.target.plane);
            this.buffer.writeShort(launch.endHeight);
            this.buffer.writeByte(launch.slope);
            this.buffer.writeShort(launch.startPos);
            this.buffer.writeShort(launch.startCycleOffset);
            this.buffer.writeShort(launch.endCycleOffset);
            this.buffer.writeByte(
                launch.source.actor?.kind === "player"
                    ? 1
                    : launch.source.actor?.kind === "npc"
                    ? 2
                    : 0,
            );
            this.buffer.writeShort(launch.source.actor?.serverId ?? 0);
            this.buffer.writeByte(
                launch.target.actor?.kind === "player"
                    ? 1
                    : launch.target.actor?.kind === "npc"
                    ? 2
                    : 0,
            );
            this.buffer.writeShort(launch.target.actor?.serverId ?? 0);
        }
        return this.buffer.toPacket(ServerPacketId.PROJECTILES);
    }

    // ========================================
    // LOC CHANGE
    // ========================================

    encodeLocChange(
        oldId: number,
        newId: number,
        tile: { x: number; y: number },
        level: number,
        oldRotation?: number,
        newRotation?: number,
        newTile?: { x: number; y: number },
    ): Uint8Array {
        this.buffer.reset();
        this.buffer.writeShort(oldId);
        this.buffer.writeShort(newId);
        this.buffer.writeShort(tile.x);
        this.buffer.writeShort(tile.y);
        this.buffer.writeByte(level);
        this.buffer.writeByte(oldRotation ?? 0);
        this.buffer.writeByte(newRotation ?? 0);
        this.buffer.writeBoolean(newTile !== undefined);
        if (newTile) {
            this.buffer.writeShort(newTile.x);
            this.buffer.writeShort(newTile.y);
        }
        return this.buffer.toPacket(ServerPacketId.LOC_CHANGE);
    }

    /**
     * LOC_ADD_CHANGE — spawn or change a loc at a world tile.
     * zone-relative coords would use (x&7 << 4 | y&7),
     * but we use absolute world coords for simplicity.
     */
    encodeLocAddChange(
        locId: number,
        tile: { x: number; y: number },
        level: number,
        shape: number,
        rotation: number,
    ): Uint8Array {
        this.buffer.reset();
        this.buffer.writeShort(locId);
        this.buffer.writeShort(tile.x);
        this.buffer.writeShort(tile.y);
        this.buffer.writeByte(level);
        this.buffer.writeByte((shape << 2) | (rotation & 3));
        return this.buffer.toPacket(ServerPacketId.LOC_ADD_CHANGE);
    }

    /**
     * LOC_DEL — remove a loc at a world tile.
     */
    encodeLocDel(
        tile: { x: number; y: number },
        level: number,
        shape: number,
        rotation: number,
    ): Uint8Array {
        this.buffer.reset();
        this.buffer.writeShort(tile.x);
        this.buffer.writeShort(tile.y);
        this.buffer.writeByte(level);
        this.buffer.writeByte((shape << 2) | (rotation & 3));
        return this.buffer.toPacket(ServerPacketId.LOC_DEL);
    }

    // ========================================
    // COMBAT STATE
    // ========================================

    encodeCombatState(payload: {
        weaponCategory: number;
        weaponItemId?: number;
        autoRetaliate?: boolean;
        activeStyle?: number;
        activePrayers?: string[];
        activeSpellId?: number;
        specialEnergy?: number;
        specialActivated?: boolean;
        quickPrayers?: string[];
        quickPrayersEnabled?: boolean;
    }): Uint8Array {
        this.buffer.reset();
        this.buffer.writeByte(payload.weaponCategory);
        this.buffer.writeShort(payload.weaponItemId ?? -1);
        this.buffer.writeBoolean(payload.autoRetaliate ?? false);
        this.buffer.writeByte(payload.activeStyle ?? 0);
        this.buffer.writeShort(payload.activeSpellId ?? -1);
        this.buffer.writeByte(payload.specialEnergy ?? 0);
        this.buffer.writeBoolean(payload.specialActivated ?? false);
        this.buffer.writeBoolean(payload.quickPrayersEnabled ?? false);
        // Active prayers as comma-separated string
        this.buffer.writeString((payload.activePrayers ?? []).join(","));
        this.buffer.writeString((payload.quickPrayers ?? []).join(","));
        return this.buffer.toPacket(ServerPacketId.COMBAT_STATE);
    }

    // ========================================
    // PLAYER ANIMATIONS
    // ========================================

    encodeAnim(payload: {
        idle?: number;
        walk?: number;
        walkBack?: number;
        walkLeft?: number;
        walkRight?: number;
        run?: number;
        runBack?: number;
        runLeft?: number;
        runRight?: number;
        turnLeft?: number;
        turnRight?: number;
    }): Uint8Array {
        this.buffer.reset();
        this.buffer.writeShort(payload.idle ?? -1);
        this.buffer.writeShort(payload.walk ?? -1);
        this.buffer.writeShort(payload.walkBack ?? -1);
        this.buffer.writeShort(payload.walkLeft ?? -1);
        this.buffer.writeShort(payload.walkRight ?? -1);
        this.buffer.writeShort(payload.run ?? -1);
        this.buffer.writeShort(payload.runBack ?? -1);
        this.buffer.writeShort(payload.runLeft ?? -1);
        this.buffer.writeShort(payload.runRight ?? -1);
        this.buffer.writeShort(payload.turnLeft ?? -1);
        this.buffer.writeShort(payload.turnRight ?? -1);
        return this.buffer.toPacket(ServerPacketId.ANIM);
    }

    // ========================================
    // PATH RESPONSE
    // ========================================

    encodePathResponse(
        id: number,
        ok: boolean,
        waypoints?: Array<{ x: number; y: number }>,
        message?: string,
    ): Uint8Array {
        this.buffer.reset();
        this.buffer.writeInt(id);
        this.buffer.writeBoolean(ok);
        this.buffer.writeShort(waypoints?.length ?? 0);
        for (const wp of waypoints ?? []) {
            this.buffer.writeShort(wp.x);
            this.buffer.writeShort(wp.y);
        }
        this.buffer.writeString(message ?? "");
        return this.buffer.toPacket(ServerPacketId.PATH_RESPONSE);
    }

    // ========================================
    // LOGIN/LOGOUT RESPONSE
    // ========================================

    encodeLoginResponse(
        success: boolean,
        errorCode?: number,
        error?: string,
        displayName?: string,
    ): Uint8Array {
        this.buffer.reset();
        this.buffer.writeBoolean(success);
        this.buffer.writeInt(Number.isFinite(errorCode) ? (errorCode as number) : -1);
        this.buffer.writeString(error ?? "");
        this.buffer.writeString(displayName ?? "");
        return this.buffer.toPacket(ServerPacketId.LOGIN_RESPONSE);
    }

    encodeLogoutResponse(success: boolean, reason?: string): Uint8Array {
        this.buffer.reset();
        this.buffer.writeBoolean(success);
        this.buffer.writeString(reason ?? "");
        return this.buffer.toPacket(ServerPacketId.LOGOUT_RESPONSE);
    }
    // ========================================
    // SHOP
    // ========================================

    encodeShopOpen(
        shopId: string,
        name: string,
        currencyItemId: number,
        generalStore: boolean,
        buyMode: number,
        sellMode: number,
        stock: Array<{
            slot: number;
            itemId: number;
            quantity: number;
            defaultQuantity?: number;
            priceEach?: number;
            sellPrice?: number;
        }>,
    ): Uint8Array {
        this.buffer.reset();
        this.buffer.writeString(shopId);
        this.buffer.writeString(name);
        this.buffer.writeShort(currencyItemId);
        this.buffer.writeBoolean(generalStore);
        this.buffer.writeByte(buyMode);
        this.buffer.writeByte(sellMode);
        this.buffer.writeShort(stock.length);
        for (const s of stock) {
            this.buffer.writeShort(s.slot);
            this.buffer.writeShort(s.itemId);
            this.buffer.writeInt(s.quantity);
            this.buffer.writeInt(s.defaultQuantity ?? s.quantity);
            this.buffer.writeInt(s.priceEach ?? 0);
            this.buffer.writeInt(s.sellPrice ?? 0);
        }
        return this.buffer.toPacket(ServerPacketId.SHOP_OPEN);
    }

    encodeShopSlot(
        shopId: string,
        slot: {
            slot: number;
            itemId: number;
            quantity: number;
            defaultQuantity?: number;
            priceEach?: number;
            sellPrice?: number;
        },
    ): Uint8Array {
        this.buffer.reset();
        this.buffer.writeString(shopId);
        this.buffer.writeShort(slot.slot);
        this.buffer.writeShort(slot.itemId);
        this.buffer.writeInt(slot.quantity);
        this.buffer.writeInt(slot.defaultQuantity ?? slot.quantity);
        this.buffer.writeInt(slot.priceEach ?? 0);
        this.buffer.writeInt(slot.sellPrice ?? 0);
        return this.buffer.toPacket(ServerPacketId.SHOP_SLOT);
    }

    encodeShopClose(): Uint8Array {
        this.buffer.reset();
        return this.buffer.toPacket(ServerPacketId.SHOP_CLOSE);
    }

    encodeShopMode(shopId: string, buyMode?: number, sellMode?: number): Uint8Array {
        this.buffer.reset();
        this.buffer.writeString(shopId);
        this.buffer.writeByte(buyMode ?? 0);
        this.buffer.writeByte(sellMode ?? 0);
        return this.buffer.toPacket(ServerPacketId.SHOP_MODE);
    }

    // ========================================
    // TRADE
    // ========================================

    encodeTradeRequest(fromId: number, fromName?: string): Uint8Array {
        this.buffer.reset();
        this.buffer.writeShort(fromId);
        this.buffer.writeString(fromName ?? "");
        return this.buffer.toPacket(ServerPacketId.TRADE_REQUEST);
    }

    encodeTradeOpen(
        sessionId: string,
        stage: "offer" | "confirm",
        self: {
            playerId?: number;
            name?: string;
            offers: Array<{ slot: number; itemId: number; quantity: number }>;
            accepted?: boolean;
            confirmAccepted?: boolean;
        },
        other: {
            playerId?: number;
            name?: string;
            offers: Array<{ slot: number; itemId: number; quantity: number }>;
            accepted?: boolean;
            confirmAccepted?: boolean;
        },
        info?: string,
    ): Uint8Array {
        this.buffer.reset();
        this.buffer.writeString(sessionId);
        this.buffer.writeByte(stage === "offer" ? 0 : 1);
        this.buffer.writeString(info ?? "");

        // Self party
        this.buffer.writeShort(self.playerId ?? -1);
        this.buffer.writeString(self.name ?? "");
        this.buffer.writeBoolean(self.accepted ?? false);
        this.buffer.writeBoolean(self.confirmAccepted ?? false);
        this.buffer.writeByte(self.offers.length);
        for (const o of self.offers) {
            this.buffer.writeShort(o.slot);
            this.buffer.writeShort(o.itemId);
            this.buffer.writeInt(o.quantity);
        }

        // Other party
        this.buffer.writeShort(other.playerId ?? -1);
        this.buffer.writeString(other.name ?? "");
        this.buffer.writeBoolean(other.accepted ?? false);
        this.buffer.writeBoolean(other.confirmAccepted ?? false);
        this.buffer.writeByte(other.offers.length);
        for (const o of other.offers) {
            this.buffer.writeShort(o.slot);
            this.buffer.writeShort(o.itemId);
            this.buffer.writeInt(o.quantity);
        }

        return this.buffer.toPacket(ServerPacketId.TRADE_OPEN);
    }

    encodeTradeUpdate(
        sessionId: string,
        stage: "offer" | "confirm",
        self: {
            playerId?: number;
            name?: string;
            offers: Array<{ slot: number; itemId: number; quantity: number }>;
            accepted?: boolean;
            confirmAccepted?: boolean;
        },
        other: {
            playerId?: number;
            name?: string;
            offers: Array<{ slot: number; itemId: number; quantity: number }>;
            accepted?: boolean;
            confirmAccepted?: boolean;
        },
        info?: string,
    ): Uint8Array {
        // Same format as open
        this.buffer.reset();
        this.buffer.writeString(sessionId);
        this.buffer.writeByte(stage === "offer" ? 0 : 1);
        this.buffer.writeString(info ?? "");

        this.buffer.writeShort(self.playerId ?? -1);
        this.buffer.writeString(self.name ?? "");
        this.buffer.writeBoolean(self.accepted ?? false);
        this.buffer.writeBoolean(self.confirmAccepted ?? false);
        this.buffer.writeByte(self.offers.length);
        for (const o of self.offers) {
            this.buffer.writeShort(o.slot);
            this.buffer.writeShort(o.itemId);
            this.buffer.writeInt(o.quantity);
        }

        this.buffer.writeShort(other.playerId ?? -1);
        this.buffer.writeString(other.name ?? "");
        this.buffer.writeBoolean(other.accepted ?? false);
        this.buffer.writeBoolean(other.confirmAccepted ?? false);
        this.buffer.writeByte(other.offers.length);
        for (const o of other.offers) {
            this.buffer.writeShort(o.slot);
            this.buffer.writeShort(o.itemId);
            this.buffer.writeInt(o.quantity);
        }

        return this.buffer.toPacket(ServerPacketId.TRADE_UPDATE);
    }

    encodeTradeClose(reason?: string): Uint8Array {
        this.buffer.reset();
        this.buffer.writeString(reason ?? "");
        return this.buffer.toPacket(ServerPacketId.TRADE_CLOSE);
    }

    // ========================================
    // SPELL RESULT
    // ========================================

    encodeSpellResult(payload: {
        casterId: number;
        spellId: number;
        outcome: "success" | "failure";
        reason?: string;
        targetType: "npc" | "player" | "loc" | "obj" | "tile" | "item";
        targetId?: number;
        tile?: { x: number; y: number; plane?: number };
        modifiers?: {
            isAutocast?: boolean;
            defensive?: boolean;
            queued?: boolean;
            castMode?: string;
        };
        runesConsumed?: Array<{ itemId: number; quantity: number }>;
        runesRefunded?: Array<{ itemId: number; quantity: number }>;
        hitDelay?: number;
        impactSpotAnim?: number;
        castSpotAnim?: number;
        splashSpotAnim?: number;
        damage?: number;
        maxHit?: number;
        accuracy?: number;
    }): Uint8Array {
        this.buffer.reset();
        this.buffer.writeShort(payload.casterId);
        this.buffer.writeShort(payload.spellId);
        this.buffer.writeByte(payload.outcome === "success" ? 1 : 0);
        this.buffer.writeString(payload.reason ?? "");

        // targetType as byte: npc=0, player=1, loc=2, obj=3, tile=4, item=5
        const targetTypeMap: Record<string, number> = {
            npc: 0,
            player: 1,
            loc: 2,
            obj: 3,
            tile: 4,
            item: 5,
        };
        this.buffer.writeByte(targetTypeMap[payload.targetType] ?? 0);
        this.buffer.writeShort(payload.targetId ?? -1);

        // Tile
        this.buffer.writeBoolean(payload.tile !== undefined);
        if (payload.tile) {
            this.buffer.writeShort(payload.tile.x);
            this.buffer.writeShort(payload.tile.y);
            this.buffer.writeByte(payload.tile.plane ?? 0);
        }

        // Modifiers
        const mods = payload.modifiers ?? {};
        let modFlags = 0;
        if (mods.isAutocast) modFlags |= 1;
        if (mods.defensive) modFlags |= 2;
        if (mods.queued) modFlags |= 4;
        this.buffer.writeByte(modFlags);
        this.buffer.writeString(mods.castMode ?? "");

        // Runes consumed
        const consumed = payload.runesConsumed ?? [];
        this.buffer.writeByte(consumed.length);
        for (const r of consumed) {
            this.buffer.writeShort(r.itemId);
            this.buffer.writeInt(r.quantity);
        }

        // Runes refunded
        const refunded = payload.runesRefunded ?? [];
        this.buffer.writeByte(refunded.length);
        for (const r of refunded) {
            this.buffer.writeShort(r.itemId);
            this.buffer.writeInt(r.quantity);
        }

        // Combat info
        this.buffer.writeShort(payload.hitDelay ?? -1);
        this.buffer.writeShort(payload.impactSpotAnim ?? -1);
        this.buffer.writeShort(payload.castSpotAnim ?? -1);
        this.buffer.writeShort(payload.splashSpotAnim ?? -1);
        this.buffer.writeShort(payload.damage ?? -1);
        this.buffer.writeShort(payload.maxHit ?? -1);
        this.buffer.writeShort(payload.accuracy ?? -1);

        return this.buffer.toPacket(ServerPacketId.SPELL_RESULT);
    }

    // ========================================
    // SMITHING
    // ========================================

    encodeSmithingOpen(
        mode: string,
        title: string,
        options: Array<{
            recipeId: string;
            name: string;
            level: number;
            itemId: number;
            outputQuantity: number;
            available: number;
            canMake: boolean;
            xp?: number;
            ingredientsLabel?: string;
            mode?: string;
            barItemId?: number;
            barCount?: number;
            requiresHammer?: boolean;
            hasHammer?: boolean;
        }>,
        quantityMode: number,
        customQuantity: number,
    ): Uint8Array {
        this.buffer.reset();
        // mode as byte: smelt=0, forge=1
        this.buffer.writeByte(mode === "forge" ? 1 : 0);
        this.buffer.writeString(title);
        this.buffer.writeShort(options.length);
        for (const opt of options) {
            this.buffer.writeString(opt.recipeId);
            this.buffer.writeString(opt.name);
            this.buffer.writeByte(opt.level);
            this.buffer.writeShort(opt.itemId);
            this.buffer.writeShort(opt.outputQuantity);
            this.buffer.writeShort(opt.available);
            this.buffer.writeBoolean(opt.canMake);
            this.buffer.writeShort(opt.xp ?? 0);
            this.buffer.writeString(opt.ingredientsLabel ?? "");
            this.buffer.writeByte(opt.mode === "forge" ? 1 : 0);
            this.buffer.writeShort(opt.barItemId ?? -1);
            this.buffer.writeByte(opt.barCount ?? 0);
            let flags = 0;
            if (opt.requiresHammer) flags |= 1;
            if (opt.hasHammer) flags |= 2;
            this.buffer.writeByte(flags);
        }
        this.buffer.writeByte(quantityMode);
        this.buffer.writeInt(customQuantity);
        return this.buffer.toPacket(ServerPacketId.SMITHING_OPEN);
    }

    encodeSmithingMode(quantityMode: number, customQuantity: number): Uint8Array {
        this.buffer.reset();
        this.buffer.writeByte(quantityMode);
        this.buffer.writeInt(customQuantity);
        return this.buffer.toPacket(ServerPacketId.SMITHING_MODE);
    }

    encodeSmithingClose(): Uint8Array {
        this.buffer.reset();
        return this.buffer.toPacket(ServerPacketId.SMITHING_CLOSE);
    }

    // ========================================
    // COLLECTION LOG
    // ========================================

    encodeCollectionLogSnapshot(
        slots: Array<{ slot: number; itemId: number; quantity: number }>,
    ): Uint8Array {
        this.buffer.reset();
        this.buffer.writeShort(slots.length);
        for (const s of slots) {
            this.buffer.writeShort(s.slot);
            this.buffer.writeShort(s.itemId);
            this.buffer.writeInt(s.quantity);
        }
        return this.buffer.toPacket(ServerPacketId.COLLECTION_LOG_SNAPSHOT);
    }

    // ========================================
    // NOTIFICATIONS
    // ========================================

    encodeNotification(
        kind: string,
        title: string,
        message: string,
        itemId: number,
        quantity: number,
        durationMs: number,
    ): Uint8Array {
        this.buffer.reset();
        // kind as byte: loot=0, achievement=1, etc.
        const kindMap: Record<string, number> = {
            loot: 0,
            achievement: 1,
            level_up: 2,
            quest: 3,
            warning: 4,
            info: 5,
            league_task: 6,
            collection_log: 7,
        };
        this.buffer.writeByte(kindMap[kind] ?? 0);
        this.buffer.writeString(title);
        this.buffer.writeString(message);
        this.buffer.writeShort(itemId);
        this.buffer.writeInt(quantity);
        this.buffer.writeShort(durationMs);
        return this.buffer.toPacket(ServerPacketId.NOTIFICATION);
    }

    // ========================================
    // DEBUG
    // ========================================

    encodeDebug(payload: Record<string, unknown>): Uint8Array {
        this.buffer.reset();
        // Encode debug payload as JSON string for flexibility
        const jsonStr = JSON.stringify(payload);
        this.buffer.writeString(jsonStr);
        return this.buffer.toPacket(ServerPacketId.DEBUG_PACKET);
    }

    // ========================================
    // REBUILD_REGION (Dynamic Instances)
    // ========================================

    encodeRebuildNormal(
        regionX: number,
        regionY: number,
        forceReload: boolean,
        xteaKeys: number[][],
    ): Uint8Array {
        this.buffer.reset();

        this.buffer.writeShort(regionX);
        this.buffer.writeShort(regionY);
        this.buffer.writeByte(forceReload ? 0 : 1);
        this.buffer.writeShort(xteaKeys.length);

        for (let i = 0; i < xteaKeys.length; i++) {
            const key = xteaKeys[i];
            for (let j = 0; j < 4; j++) {
                this.buffer.writeInt(key[j] ?? 0);
            }
        }

        return this.buffer.toPacket(ServerPacketId.REBUILD_NORMAL);
    }

    encodeRebuildRegion(
        regionX: number,
        regionY: number,
        forceReload: boolean,
        templateChunks: number[][][],
        xteaKeys: number[][],
    ): Uint8Array {
        this.buffer.reset();

        this.buffer.writeShort(regionY);
        this.buffer.writeByte(forceReload ? 1 : 0);
        this.buffer.writeShort(regionX);
        this.buffer.writeShort(xteaKeys.length);

        // Bit-packed template chunks: 4 planes × 13 × 13
        const bits = new BitWriter();
        for (let plane = 0; plane < PLANE_COUNT; plane++) {
            for (let cx = 0; cx < INSTANCE_CHUNK_COUNT; cx++) {
                for (let cy = 0; cy < INSTANCE_CHUNK_COUNT; cy++) {
                    const packed = templateChunks[plane][cx][cy];
                    if (packed !== -1) {
                        bits.writeBits(1, 1);
                        bits.writeBits(26, packed);
                    } else {
                        bits.writeBits(1, 0);
                    }
                }
            }
        }
        const bitData = bits.toUint8Array();
        this.buffer.writeBytes(bitData, 0, bitData.length);

        // XTEA keys: one key (4 ints) per region
        for (let i = 0; i < xteaKeys.length; i++) {
            const key = xteaKeys[i];
            for (let j = 0; j < 4; j++) {
                this.buffer.writeInt(key[j] ?? 0);
            }
        }

        return this.buffer.toPacket(ServerPacketId.REBUILD_REGION);
    }

    encodeRebuildWorldEntity(
        entityIndex: number,
        configId: number,
        sizeX: number,
        sizeZ: number,
        zoneX: number,
        zoneZ: number,
        regionX: number,
        regionY: number,
        forceReload: boolean,
        templateChunks: number[][][],
        xteaKeys: number[][],
        buildAreas: WorldEntityBuildArea[],
    ): Uint8Array {
        this.buffer.reset();

        this.buffer.writeShort(entityIndex);
        this.buffer.writeShort(configId);
        this.buffer.writeByte(sizeX);
        this.buffer.writeByte(sizeZ);
        this.buffer.writeShort(zoneX);
        this.buffer.writeShort(zoneZ);
        this.buffer.writeShort(regionY);
        this.buffer.writeByte(forceReload ? 1 : 0);
        this.buffer.writeShort(regionX);
        this.buffer.writeShort(xteaKeys.length);

        // Build areas
        this.buffer.writeByte(buildAreas.length);
        for (const area of buildAreas) {
            this.buffer.writeShort(area.sourceBaseX);
            this.buffer.writeShort(area.sourceBaseY);
            this.buffer.writeShort(area.destBaseX);
            this.buffer.writeShort(area.destBaseY);
            this.buffer.writeByte(area.planes);
            this.buffer.writeByte(area.rotation);
        }

        // Bit-packed template chunks: 4 planes × 13 × 13
        const bits = new BitWriter();
        for (let plane = 0; plane < PLANE_COUNT; plane++) {
            for (let cx = 0; cx < INSTANCE_CHUNK_COUNT; cx++) {
                for (let cy = 0; cy < INSTANCE_CHUNK_COUNT; cy++) {
                    const packed = templateChunks[plane][cx][cy];
                    if (packed !== -1) {
                        bits.writeBits(1, 1);
                        bits.writeBits(26, packed);
                    } else {
                        bits.writeBits(1, 0);
                    }
                }
            }
        }
        const bitData = bits.toUint8Array();
        this.buffer.writeBytes(bitData, 0, bitData.length);

        // XTEA keys
        for (let i = 0; i < xteaKeys.length; i++) {
            const key = xteaKeys[i];
            for (let j = 0; j < 4; j++) {
                this.buffer.writeInt(key[j] ?? 0);
            }
        }

        return this.buffer.toPacket(ServerPacketId.REBUILD_WORLDENTITY);
    }

    /**
     * Encode WORLDENTITY_INFO — per-tick world entity lifecycle packet.
     *
     * Format (matching WorldEntityUpdateParser):
     *   byte   count          — how many of the OLD active entities are processed
     *   for each 0..count-1:
     *     byte  updateType    — 0=despawn, 1=no change, 2=queuePosition, 3=setPosition
     *     if updateType >= 2: position delta via typed-value tags
     *     mask update byte (bit 0 = animation, bit 1 = action mask)
     *   while bytes remain:
     *     short entityIndex, byte sizeX, byte sizeZ, short configId
     *     position via typed-value tags
     *     byte  drawMode
     *     mask update byte
     */
    encodeWorldEntityInfo(
        oldCount: number,
        oldUpdates: Array<{
            updateType: number;
            positionDelta?: { x: number; y: number; z: number; orientation: number };
            mask?: { animationId?: number; sequenceFrame?: number; actionMask?: number };
        }>,
        newSpawns: Array<{
            entityIndex: number;
            sizeX: number;
            sizeZ: number;
            configId: number;
            drawMode: number;
            position: { x: number; y: number; z: number; orientation: number };
            mask?: { animationId?: number; sequenceFrame?: number; actionMask?: number };
        }>,
    ): Uint8Array {
        this.buffer.reset();
        this.buffer.writeByte(oldCount);
        for (let i = 0; i < oldCount; i++) {
            const upd = oldUpdates[i];
            this.buffer.writeByte(upd.updateType);
            if (upd.updateType >= 2 && upd.positionDelta) {
                this.writePositionDelta(upd.positionDelta);
            }
            if (upd.updateType !== 0) {
                this.writeMaskUpdate(upd.mask);
            }
        }
        for (const spawn of newSpawns) {
            this.buffer.writeShort(spawn.entityIndex);
            this.buffer.writeByte(spawn.sizeX);
            this.buffer.writeByte(spawn.sizeZ);
            this.buffer.writeShort(spawn.configId);
            this.writePositionDelta(spawn.position);
            this.buffer.writeByte(spawn.drawMode);
            this.writeMaskUpdate(spawn.mask);
        }
        return this.buffer.toPacket(ServerPacketId.WORLDENTITY_INFO);
    }

    /**
     * Encode a position delta using the OSRS typed-value tag format.
     * A flags byte packs the encoding width (0=zero/absent, 1=byte, 2=short, 3=int)
     * for each of 4 components at bit shifts 0, 2, 4, 6 (x, y, z, orientation).
     */
    private writePositionDelta(delta: { x: number; y: number; z: number; orientation: number }): void {
        const vals = [delta.x | 0, delta.y | 0, delta.z | 0, delta.orientation | 0];
        let flags = 0;
        for (let i = 0; i < 4; i++) {
            flags |= typedValueWidth(vals[i]) << (i * 2);
        }
        this.buffer.writeByte(flags);
        if (flags === 0) return;
        for (let i = 0; i < 4; i++) {
            const width = (flags >> (i * 2)) & 3;
            if (width === 1) this.buffer.writeByte(vals[i]);
            else if (width === 2) this.buffer.writeShort(vals[i]);
            else if (width === 3) this.buffer.writeInt(vals[i]);
        }
    }

    private writeMaskUpdate(mask?: { animationId?: number; sequenceFrame?: number; actionMask?: number }): void {
        let maskByte = 0;
        if (mask) {
            if (mask.animationId !== undefined) maskByte |= 1;
            if (mask.actionMask !== undefined) maskByte |= 2;
        }
        this.buffer.writeByte(maskByte);
        if (maskByte & 1) {
            this.buffer.writeShort(mask!.animationId!);
            this.buffer.writeByte(mask!.sequenceFrame ?? 0);
        }
        if (maskByte & 2) {
            this.buffer.writeByte(mask!.actionMask!);
        }
    }
}

/**
 * Determine the minimum encoding width for a typed-value:
 *   0 = zero (not sent), 1 = signed byte, 2 = signed short, 3 = signed int.
 */
function typedValueWidth(v: number): number {
    if (v === 0) return 0;
    if (v >= -128 && v <= 127) return 1;
    if (v >= -32768 && v <= 32767) return 2;
    return 3;
}

// Singleton instance
export const serverEncoder = new ServerBinaryEncoder();
