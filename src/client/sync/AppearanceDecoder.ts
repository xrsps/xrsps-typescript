/**
 * Binary Appearance Decoder
 *
 * Decodes player appearance block from OSRS binary format.
 * Reference: Player.read() in references/runescape-client/src/main/java/Player.java
 *
 * Binary format:
 * 1. gender (byte)
 * 2. headIconPk (byte) - skull icon
 * 3. headIconPrayer (byte) - prayer icon
 * 4. equipment array (12 slots, variable length)
 * 5. secondary equipment array (12 slots)
 * 6. body colors (5 bytes)
 * 7. Animation sequences (7 unsigned shorts): idle, turnLeft, walk, walkBack, walkLeft, walkRight, run
 * 8. username (null-terminated CP1252 string)
 * 9. combatLevel (byte)
 * 10. skillLevel (unsigned short)
 * 11. isHidden (byte)
 * 12. color/texture override flags (unsigned short)
 * 13. actions (3 null-terminated strings)
 * 14. final byte
 * 15. custom ammo quantity (signed int)
 */

const EQUIPMENT_SLOTS = 12;
const BODY_COLOR_COUNT = 5;

// CP1252 decoding map (reverse of encoding)
const CP1252_DECODE: Record<number, number> = {
    0x80: 0x20ac,
    0x82: 0x201a,
    0x83: 0x0192,
    0x84: 0x201e,
    0x85: 0x2026,
    0x86: 0x2020,
    0x87: 0x2021,
    0x88: 0x02c6,
    0x89: 0x2030,
    0x8a: 0x0160,
    0x8b: 0x2039,
    0x8c: 0x0152,
    0x8e: 0x017d,
    0x91: 0x2018,
    0x92: 0x2019,
    0x93: 0x201c,
    0x94: 0x201d,
    0x95: 0x2022,
    0x96: 0x2013,
    0x97: 0x2014,
    0x98: 0x02dc,
    0x99: 0x2122,
    0x9a: 0x0161,
    0x9b: 0x203a,
    0x9c: 0x0153,
    0x9e: 0x017e,
    0x9f: 0x0178,
};

/**
 * Decoded appearance data.
 */
export interface DecodedAppearance {
    gender: number;
    headIconPk: number;
    headIconPrayer: number;
    equipment: number[];
    secondaryEquipment: number[];
    colors: number[];
    kits: number[];
    anim: {
        idle: number;
        turnLeft: number;
        turnRight: number;
        walk: number;
        walkBack: number;
        walkLeft: number;
        walkRight: number;
        run: number;
    };
    name: string;
    combatLevel: number;
    skillLevel: number;
    isHidden: boolean;
    actions: [string, string, string];
    ammoQuantity: number;
}

/**
 * Binary buffer reader for appearance decoding.
 */
class AppearanceReader {
    private offset = 0;

    constructor(private buffer: Uint8Array) {}

    readByte(): number {
        if (this.offset >= this.buffer.length) return 0;
        return this.buffer[this.offset++] | 0;
    }

    readUnsignedByte(): number {
        return this.readByte() & 0xff;
    }

    readUnsignedShort(): number {
        const high = this.readUnsignedByte();
        const low = this.readUnsignedByte();
        return ((high << 8) | low) & 0xffff;
    }

    readInt(): number {
        const b0 = this.readUnsignedByte();
        const b1 = this.readUnsignedByte();
        const b2 = this.readUnsignedByte();
        const b3 = this.readUnsignedByte();
        return ((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) | 0;
    }

    readStringCp1252NullTerminated(): string {
        const chars: string[] = [];
        while (this.offset < this.buffer.length) {
            const byte = this.readUnsignedByte();
            if (byte === 0) break;
            const mapped = CP1252_DECODE[byte];
            const codePoint = mapped !== undefined ? mapped : byte;
            chars.push(String.fromCodePoint(codePoint));
        }
        return chars.join("");
    }

    hasMore(): boolean {
        return this.offset < this.buffer.length;
    }
}

/**
 * Decode equipment slot value.
 *
 * OSRS format:
 * - 0: empty slot
 * - 256-511: kit definition (body part)
 * - >= 512: item definition (itemId = value - 512)
 */
function decodeEquipmentSlot(reader: AppearanceReader): {
    type: "empty" | "kit" | "item";
    value: number;
} {
    const high = reader.readUnsignedByte();
    if (high === 0) {
        return { type: "empty", value: -1 };
    }
    const low = reader.readUnsignedByte();
    const value = (high << 8) | low;

    if (value >= 512) {
        return { type: "item", value: value - 512 };
    } else if (value >= 256) {
        return { type: "kit", value: value - 256 };
    }
    return { type: "empty", value: -1 };
}

/**
 * Decode animation sequence value.
 * OSRS uses 65535 to represent -1 (no animation).
 */
function decodeAnimSequence(value: number): number {
    return value === 65535 ? -1 : value;
}

/**
 * Decode player appearance from OSRS binary format.
 */
export function decodeAppearanceBinary(buffer: Uint8Array): DecodedAppearance | null {
    if (!buffer || buffer.length < 10) {
        return null;
    }

    try {
        const reader = new AppearanceReader(buffer);

        // 1. Gender (byte)
        const gender = reader.readUnsignedByte();

        // 2. headIconPk - skull (byte)
        const headIconPk = reader.readByte(); // signed, -1 = none

        // 3. headIconPrayer (byte)
        const headIconPrayer = reader.readByte(); // signed, -1 = none

        // 4. Equipment array (12 slots)
        const equipment: number[] = new Array(EQUIPMENT_SLOTS).fill(-1);
        const kits: number[] = new Array(8).fill(-1);

        for (let slot = 0; slot < EQUIPMENT_SLOTS; slot++) {
            const result = decodeEquipmentSlot(reader);

            // Special case: NPC transform (slot 0 == 65535)
            if (slot === 0 && result.type === "item" && result.value === 65535 - 512) {
                // NPC transform ID would be next unsigned short
                // For now, we'll just skip this case
                reader.readUnsignedShort();
                break;
            }

            if (result.type === "item") {
                // Map wire slot → EquipmentSlot index (server equip array ordering)
                const wireToEquipSlot: Record<number, number> = {
                    0: 0,  // head → HEAD
                    1: 1,  // cape → CAPE
                    2: 2,  // amulet → AMULET
                    3: 3,  // weapon → WEAPON
                    4: 4,  // body → BODY
                    5: 5,  // shield → SHIELD
                    7: 6,  // legs → LEGS
                    9: 7,  // hands → GLOVES
                    10: 8, // feet → BOOTS
                };
                const eqIdx = wireToEquipSlot[slot];
                if (eqIdx !== undefined) {
                    equipment[eqIdx] = result.value;
                }
            } else if (result.type === "kit") {
                // Map wire slot → kit array index (body part index)
                // Matches OSRS PlayerCompositionBodyPart.getEquipmentSlotForBodyPart
                const wireToKitIndex: Record<number, number> = {
                    8: 0,   // hair → kits[0] (head/hair)
                    11: 1,  // jaw → kits[1] (jaw/beard)
                    4: 2,   // body → kits[2] (torso)
                    6: 3,   // arms → kits[3] (arms)
                    9: 4,   // hands → kits[4] (hands)
                    7: 5,   // legs → kits[5] (legs)
                    10: 6,  // feet → kits[6] (feet)
                };
                const kitIndex = wireToKitIndex[slot];
                if (kitIndex !== undefined) {
                    kits[kitIndex] = result.value;
                }
            }
        }

        // 5. Secondary equipment array (12 slots)
        const secondaryEquipment: number[] = new Array(EQUIPMENT_SLOTS).fill(-1);
        for (let slot = 0; slot < EQUIPMENT_SLOTS; slot++) {
            const result = decodeEquipmentSlot(reader);
            if (result.type === "item") {
                secondaryEquipment[slot] = result.value;
            }
        }

        // 6. Body colors (5 bytes)
        const colors: number[] = [];
        for (let i = 0; i < BODY_COLOR_COUNT; i++) {
            colors.push(reader.readUnsignedByte());
        }

        // 7. Animation sequences (7 unsigned shorts)
        const idle = decodeAnimSequence(reader.readUnsignedShort());
        const turnLeft = decodeAnimSequence(reader.readUnsignedShort());
        const turnRight = turnLeft; // OSRS copies turnLeft to turnRight
        const walk = decodeAnimSequence(reader.readUnsignedShort());
        const walkBack = decodeAnimSequence(reader.readUnsignedShort());
        const walkLeft = decodeAnimSequence(reader.readUnsignedShort());
        const walkRight = decodeAnimSequence(reader.readUnsignedShort());
        const run = decodeAnimSequence(reader.readUnsignedShort());

        // 8. Username (null-terminated CP1252 string)
        const name = reader.readStringCp1252NullTerminated();

        // 9. Combat level (byte)
        const combatLevel = reader.readUnsignedByte();

        // 10. Skill level (unsigned short)
        const skillLevel = reader.readUnsignedShort();

        // 11. isHidden (byte)
        const isHidden = reader.readUnsignedByte() === 1;

        // 12. Color/texture override flags (unsigned short)
        const overrideFlags = reader.readUnsignedShort();

        // If override flags are set, skip the override data
        // (We're not implementing appearance overrides for now)
        if (overrideFlags > 0 && overrideFlags !== 32768) {
            for (let slot = 0; slot < EQUIPMENT_SLOTS; slot++) {
                const hasBit = (overrideFlags >> (12 - slot)) & 1;
                if (hasBit === 1) {
                    // Skip override data for this slot
                    // The format is complex, so we'll skip based on equipment
                    // For now, just read and discard some bytes
                    reader.readUnsignedShort(); // Simplified - actual format is more complex
                }
            }
        }

        // 13. Actions (3 null-terminated strings)
        const actions: [string, string, string] = [
            reader.readStringCp1252NullTerminated(),
            reader.readStringCp1252NullTerminated(),
            reader.readStringCp1252NullTerminated(),
        ];

        // 14. Final byte (we can ignore this)
        if (reader.hasMore()) {
            reader.readByte();
        }

        // 15. Project extension: equipped ammo quantity for local equipment inventory sync.
        const ammoQuantity = reader.hasMore() ? Math.max(0, reader.readInt()) : 0;

        return {
            gender,
            headIconPk,
            headIconPrayer,
            equipment,
            secondaryEquipment,
            colors,
            kits,
            anim: {
                idle,
                turnLeft,
                turnRight,
                walk,
                walkBack,
                walkLeft,
                walkRight,
                run,
            },
            name,
            combatLevel,
            skillLevel,
            isHidden,
            actions,
            ammoQuantity,
        };
    } catch (err) {
        console.warn("[AppearanceDecoder] Failed to decode binary appearance", err);
        return null;
    }
}
