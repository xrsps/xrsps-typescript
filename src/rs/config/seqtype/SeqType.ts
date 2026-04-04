import { CacheInfo } from "../../cache/CacheInfo";
import { ByteBuffer } from "../../io/ByteBuffer";
import { SeqFrameLoader } from "../../model/seq/SeqFrameLoader";
import { Type } from "../Type";

export interface SeqSoundEffect {
    id: number;
    loops?: number;
    /** Radius in tiles; when omitted, treated as 0 (no falloff). */
    location?: number;
    weight?: number;
    retain?: number;
}

export class SeqType extends Type {
    frameIds!: number[];
    chatFrameIds?: number[];
    frameLengths!: number[];
    frameSoundOverrides?: Map<number, number>;
    soundEffects?: number[];
    /** Optional per-frame sound effects, populated by tooling or runtime helpers. */
    frameSounds?: Map<number, SeqSoundEffect[]>;

    frameStep: number;

    masks?: number[];

    stretches: boolean;

    forcedPriority: number; // field2220: Animation interrupt priority (default 5, higher = harder to interrupt)

    leftHandItem: number;
    rightHandItem: number;

    maxLoops: number;

    looping: boolean;

    precedenceAnimating: number; // field2244: Movement priority (0 = blocks movement, 1 = allows, -1 = auto)

    priority: number; // field2226: Standing priority (0 = blocks when stationary, 2 = allows, -1 = auto)

    replyMode: number;

    /** Blend overrides introduced in newer caches (opcode 100). */
    blendTable?: Array<{ frame: number; interval: number }>;

    cachedModelId: number;
    /** Skeletal sequence id; alias for cachedModelId for convenience. */
    skeletalId: number;
    skeletalStart: number;
    skeletalEnd: number;
    skeletalMasks?: boolean[];
    verticalOffset: number;

    op14: boolean;

    constructor(id: number, cacheInfo: CacheInfo) {
        super(id, cacheInfo);
        this.frameStep = -1;
        this.stretches = false;
        this.forcedPriority = 5;
        this.leftHandItem = -1;
        this.rightHandItem = -1;
        this.maxLoops = 99;
        this.looping = false;
        this.precedenceAnimating = -1;
        this.priority = -1;
        this.replyMode = 2;
        this.cachedModelId = -1;
        this.skeletalId = -1;
        this.skeletalStart = 0;
        this.skeletalEnd = 0;
        this.verticalOffset = 0;
        this.op14 = false;
    }

    override post(): void {
        if (this.precedenceAnimating === -1) {
            if (this.masks == null && this.skeletalMasks == null) {
                this.precedenceAnimating = 0;
            } else {
                this.precedenceAnimating = 2;
            }
        }

        if (this.priority === -1) {
            if (this.masks == null && this.skeletalMasks == null) {
                this.priority = 0;
            } else {
                this.priority = 2;
            }
        }
    }

    getFrameLength(seqFrameLoader: SeqFrameLoader, frame: number): number {
        // OSRS parity: use SequenceDefinition.frameLengths directly (no client-side fallback).
        // If the cache contains a 0 length, the reference client advances after one cycle
        // because it checks `cycle > frameLengths[frame]`.
        // NOTE: blendTable (opcode 100) is parsed but not used - no reference for its behavior.
        return (this.frameLengths[frame] ?? 0) | 0;
    }

    override decodeOpcode(opcode: number, buffer: ByteBuffer): void {
        const rev226 = this.cacheInfo.revision >= 226;
        const rev220 = this.cacheInfo.revision >= 220;

        if (opcode === 1) {
            const count = buffer.readUnsignedShort();
            this.frameLengths = new Array(count);
            this.frameIds = new Array(count);
            for (let i = 0; i < count; i++) {
                this.frameLengths[i] = buffer.readUnsignedShort();
            }
            for (let i = 0; i < count; i++) {
                this.frameIds[i] = buffer.readUnsignedShort();
            }
            for (let i = 0; i < count; i++) {
                this.frameIds[i] += buffer.readUnsignedShort() << 16;
            }
        } else if (opcode === 2) {
            this.frameStep = buffer.readUnsignedShort();
        } else if (opcode === 3) {
            const count = buffer.readUnsignedByte();
            this.masks = new Array(count + 1);
            for (let i = 0; i < count; i++) {
                this.masks[i] = buffer.readUnsignedByte();
            }
            this.masks[count] = 9999999;
        } else if (opcode === 4) {
            this.stretches = true;
        } else if (opcode === 5) {
            this.forcedPriority = buffer.readUnsignedByte();
        } else if (opcode === 6) {
            this.leftHandItem = buffer.readUnsignedShort();
        } else if (opcode === 7) {
            this.rightHandItem = buffer.readUnsignedShort();
        } else if (opcode === 8) {
            this.maxLoops = buffer.readUnsignedByte();
            this.looping = true;
        } else if (opcode === 9) {
            this.precedenceAnimating = buffer.readUnsignedByte();
        } else if (opcode === 10) {
            this.priority = buffer.readUnsignedByte();
        } else if (opcode === 11) {
            this.replyMode = buffer.readUnsignedByte();
        } else if (opcode === 12) {
            const count = buffer.readUnsignedByte();
            this.chatFrameIds = new Array(count);
            for (let i = 0; i < count; i++) {
                this.chatFrameIds[i] = buffer.readUnsignedShort();
            }
            for (let i = 0; i < count; i++) {
                this.chatFrameIds[i] += buffer.readUnsignedShort() << 16;
            }
        } else if (opcode === 13 && !rev226) {
            const count = buffer.readUnsignedByte();
            this.soundEffects = new Array(count);
            for (let i = 0; i < count; i++) {
                this.soundEffects[i] = buffer.readUnsignedMedium();
            }
        } else if (opcode === (rev226 ? 13 : 14)) {
            this.cachedModelId = buffer.readInt();
            this.skeletalId = this.cachedModelId;
            this.op14 = true;
        } else if (opcode === (rev226 ? 14 : 15)) {
            const entries = buffer.readUnsignedShort();
            this.frameSounds = new Map();
            for (let i = 0; i < entries; i++) {
                const frame = buffer.readUnsignedShort();
                let id: number, loops: number, location: number, retain: number;
                let weight: number | undefined;

                if (rev220) {
                    id = buffer.readUnsignedShort();
                    if (rev226) {
                        weight = buffer.readUnsignedByte();
                    }
                    loops = buffer.readUnsignedByte();
                    location = buffer.readUnsignedByte();
                    retain = buffer.readUnsignedByte();
                } else {
                    const val = buffer.readUnsignedMedium();
                    location = val & 15;
                    id = val >> 8;
                    loops = (val >> 4) & 7;
                    retain = 0;
                }

                const sounds = this.frameSounds.get(frame) ?? [];
                sounds.push({ id, loops, location, weight, retain });
                this.frameSounds.set(frame, sounds);
            }
        } else if (opcode === (rev226 ? 15 : 16)) {
            this.skeletalStart = buffer.readUnsignedShort();
            this.skeletalEnd = buffer.readUnsignedShort();
        } else if (opcode === 16) {
            // Implied rev226 due to order of checks above
            this.verticalOffset = buffer.readByte(); // Signed or unsigned? Runelite says readByte() which is usually signed.
        } else if (opcode === 17) {
            const count = buffer.readUnsignedByte();
            this.skeletalMasks = new Array(256).fill(false);
            for (let i = 0; i < count; i++) {
                this.skeletalMasks[buffer.readUnsignedByte()] = true;
            }
        } else if (opcode === 18) {
            buffer.readString();
        } else if (opcode === 100) {
            // Speculative: not in decompiled reference. Parsing to avoid crash, but not used.
            const count = buffer.readUnsignedByte();
            const table: Array<{ frame: number; interval: number }> = [];
            for (let i = 0; i < count; i++) {
                const frame = buffer.readUnsignedShort();
                const interval = buffer.readUnsignedShort();
                table.push({ frame, interval });
            }
            this.blendTable = table;
            console.warn(
                `SeqType: opcode 100 encountered (id=${this.id}, count=${count}) - behavior unverified`,
            );
        } else {
            // Ignore unknown opcodes to prevent crashing, but warn
            const nextBytes: string[] = [];
            for (let i = 0; i < 8 && buffer.offset + i < buffer.length; i++) {
                nextBytes.push(
                    buffer
                        .getUnsignedByte(buffer.offset + i)
                        .toString(16)
                        .padStart(2, "0"),
                );
            }
            console.warn(
                `SeqType: Opcode ${opcode} not implemented (offset=${
                    buffer.offset
                }, next=${nextBytes.join(" ")})`,
            );
            throw new Error("SeqType: Opcode " + opcode + " not implemented.");
        }
    }

    isSkeletalSeq(): boolean {
        return this.skeletalId >= 0;
    }

    getSkeletalDuration(): number {
        return this.skeletalEnd - this.skeletalStart;
    }

    /**
     * Checks if this sequence is a "single-shot" animation that should be
     * cancelled when movement starts.
     * Reference: player-movement.md (method2429:16-18, SequenceDefinition.field2226)
     *
     * In the reference client this is `SequenceDefinition.field2226 == 1`
     * (ours: `priority == 1`).
     *
     * @returns true if the animation should be cancelled on movement
     */
    isSingleShot(): boolean {
        return (this.priority | 0) === 1;
    }
}
