/**
 * ServerBinaryEncoder - Encode server messages to binary format
 *
 * Replaces JSON.stringify for server-to-client messages.
 * All encoding methods match OSRS Buffer.java patterns.
 */
import {
    SERVER_PACKET_LENGTHS,
    ServerPacketId,
} from "../../../../src/shared/packets/ServerPacketId";
import type { ProjectileLaunch } from "../../../../src/shared/projectiles/ProjectileLaunch";

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
    // WRITE METHODS (matching Buffer.java)
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
        appearance?: any,
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

    encodeHitsplat(
        targetType: "player" | "npc",
        targetId: number,
        damage: number,
        style?: number,
        type2?: number,
        damage2?: number,
        delayCycles?: number,
    ): Uint8Array {
        this.buffer.reset();
        this.buffer.writeByte(targetType === "player" ? 0 : 1);
        this.buffer.writeShort(targetId);
        this.buffer.writeSmartByteShort(damage);
        this.buffer.writeByte(style ?? 0);
        const hasSecondary =
            type2 !== undefined &&
            Number.isFinite(type2) &&
            damage2 !== undefined &&
            Number.isFinite(damage2) &&
            type2 >= 0 &&
            damage2 >= 0;
        this.buffer.writeBoolean(hasSecondary);
        if (hasSecondary) {
            this.buffer.writeSmartByteShort(type2!);
            this.buffer.writeSmartByteShort(damage2!);
        }
        this.buffer.writeSmartByteShort(
            delayCycles !== undefined && Number.isFinite(delayCycles)
                ? Math.max(0, Math.min(32767, delayCycles))
                : 0,
        );
        return this.buffer.toPacket(ServerPacketId.HITSPLAT);
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

    encodeWidgetRunScript(scriptId: number, args: any[]): Uint8Array {
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
        // OSRS parity default (see Coord.playSong -> WorldMapRectangle.method5019(0,100,100,0))
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

    encodeDebug(payload: any): Uint8Array {
        this.buffer.reset();
        // Encode debug payload as JSON string for flexibility
        const jsonStr = JSON.stringify(payload);
        this.buffer.writeString(jsonStr);
        return this.buffer.toPacket(ServerPacketId.DEBUG_PACKET);
    }
}

// Singleton instance
export const serverEncoder = new ServerBinaryEncoder();
