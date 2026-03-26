/**
 * Binary Appearance Encoder
 *
 * Encodes player appearance block in OSRS binary format.
 * Reference: Player.read() in references/runescape-client/src/main/java/Player.java
 *
 * Binary format:
 * 1. gender (byte)
 * 2. headIconPk (byte) - skull icon
 * 3. headIconPrayer (byte) - prayer icon
 * 4. equipment array (12 slots, variable length)
 * 5. secondary equipment array (12 slots, for appearance overrides)
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
import type { PlayerAppearance } from "../../game/player";
import { EquipmentSlot } from "../../../../src/rs/config/player/Equipment";
import { encodeCp1252 } from "./Cp1252";
import type { PlayerAnimSet, PlayerViewSnapshot } from "./types";

// Equipment slot constants
const EQUIPMENT_SLOTS = 12;
const BODY_COLOR_COUNT = 5;

/**
 * Binary buffer writer for appearance encoding.
 */
class AppearanceWriter {
    private buffer: number[] = [];

    writeByte(value: number): void {
        this.buffer.push(value & 0xff);
    }

    writeUnsignedShort(value: number): void {
        this.buffer.push((value >> 8) & 0xff);
        this.buffer.push(value & 0xff);
    }

    writeInt(value: number): void {
        this.buffer.push((value >> 24) & 0xff);
        this.buffer.push((value >> 16) & 0xff);
        this.buffer.push((value >> 8) & 0xff);
        this.buffer.push(value & 0xff);
    }

    writeStringCp1252NullTerminated(text: string): void {
        const bytes = encodeCp1252(text ?? "");
        for (const b of bytes) {
            this.buffer.push(b & 0xff);
        }
        this.buffer.push(0); // null terminator
    }

    toUint8Array(): Uint8Array {
        return Uint8Array.from(this.buffer);
    }
}

/**
 * OSRS wire slot layout (PlayerCompositionSlot from reference):
 *   0=head, 1=cape, 2=amulet, 3=weapon, 4=body/torso, 5=shield,
 *   6=arms, 7=legs, 8=hair, 9=hands, 10=feet, 11=jaw/beard
 *
 * Wire slot → EquipmentSlot (server equip array index) for items.
 * Slots 6(arms), 8(hair), 11(jaw) never carry items.
 */
const wireToEquipSlot: Record<number, number> = {
    0: EquipmentSlot.HEAD,
    1: EquipmentSlot.CAPE,
    2: EquipmentSlot.AMULET,
    3: EquipmentSlot.WEAPON,
    4: EquipmentSlot.BODY,
    5: EquipmentSlot.SHIELD,
    7: EquipmentSlot.LEGS,
    9: EquipmentSlot.GLOVES,
    10: EquipmentSlot.BOOTS,
};

/**
 * Wire slot → kits array index (body part index).
 * Matches OSRS PlayerCompositionBodyPart.getEquipmentSlotForBodyPart mapping.
 * Server kits array: 0=head/hair, 1=jaw, 2=torso, 3=arms, 4=hands, 5=legs, 6=feet
 */
const wireToKitIndex: Record<number, number> = {
    8: 0,   // hair wire slot → kits[0] (head/hair body part)
    11: 1,  // jaw wire slot → kits[1] (jaw/beard body part)
    4: 2,   // body wire slot → kits[2] (torso body part)
    6: 3,   // arms wire slot → kits[3] (arms body part)
    9: 4,   // hands wire slot → kits[4] (hands body part)
    7: 5,   // legs wire slot → kits[5] (legs body part)
    10: 6,  // feet wire slot → kits[6] (feet body part)
};

function encodeEquipmentSlot(
    slot: number,
    equip: number[] | undefined,
    kits: number[] | undefined,
): number[] {
    // Check if item is equipped at this wire slot
    const equipSlot = wireToEquipSlot[slot];
    if (equipSlot !== undefined) {
        const equipValue = equip?.[equipSlot] ?? -1;
        if (equipValue >= 0) {
            const value = equipValue + 512;
            return [(value >> 8) & 0xff, value & 0xff];
        }
    }

    // No item - check for kit (body part)
    const kitIndex = wireToKitIndex[slot];
    if (kitIndex !== undefined && kits && kits[kitIndex] !== undefined && kits[kitIndex] >= 0) {
        const value = kits[kitIndex] + 256;
        return [(value >> 8) & 0xff, value & 0xff];
    }

    // Empty slot
    return [0];
}

/**
 * Encode animation sequence value.
 * OSRS uses 65535 to represent -1 (no animation).
 */
function encodeAnimSequence(value: number | undefined): number {
    if (value === undefined || value < 0) {
        return 65535;
    }
    return value & 0xffff;
}

/**
 * Encode player appearance to OSRS binary format.
 */
export function encodeAppearanceBinary(
    view: PlayerViewSnapshot,
    options?: {
        combatLevel?: number;
        skillLevel?: number;
        isHidden?: boolean;
        actions?: [string, string, string];
    },
): Uint8Array {
    const writer = new AppearanceWriter();
    const appearance = view.appearance;
    const anim = view.anim;

    // 1. Gender (byte)
    const gender = appearance?.gender ?? 0;
    writer.writeByte(gender);

    // 2. headIconPk - skull (byte)
    const skull = appearance?.headIcons?.skull ?? -1;
    writer.writeByte(skull);

    // 3. headIconPrayer (byte)
    const prayer = appearance?.headIcons?.prayer ?? -1;
    writer.writeByte(prayer);

    // 4. Equipment array (12 slots)
    // OSRS slot order: head, cape, amulet, weapon, body, shield, arms, legs, hair, hands, feet, beard
    for (let slot = 0; slot < EQUIPMENT_SLOTS; slot++) {
        const bytes = encodeEquipmentSlot(slot, appearance?.equip, appearance?.kits);
        for (const b of bytes) {
            writer.writeByte(b);
        }
    }

    // 5. Secondary equipment array (12 slots) - for appearance overrides
    // In most cases this mirrors the primary array or is empty
    for (let slot = 0; slot < EQUIPMENT_SLOTS; slot++) {
        const bytes = encodeEquipmentSlot(slot, appearance?.equip, appearance?.kits);
        for (const b of bytes) {
            writer.writeByte(b);
        }
    }

    // 6. Body colors (5 bytes)
    const colors = appearance?.colors ?? [0, 0, 0, 0, 0];
    for (let i = 0; i < BODY_COLOR_COUNT; i++) {
        writer.writeByte(colors[i] ?? 0);
    }

    // 7. Animation sequences (7 unsigned shorts)
    // OSRS order: idle, turnLeft, walk, walkBack, walkLeft, walkRight, run
    // Note: turnRight = turnLeft (copied on client, not sent separately)
    writer.writeUnsignedShort(encodeAnimSequence(anim?.idle)); // idle
    writer.writeUnsignedShort(encodeAnimSequence(anim?.turnLeft)); // turnLeft
    writer.writeUnsignedShort(encodeAnimSequence(anim?.walk)); // walk
    writer.writeUnsignedShort(encodeAnimSequence(anim?.walkBack)); // walkBack
    writer.writeUnsignedShort(encodeAnimSequence(anim?.walkLeft)); // walkLeft
    writer.writeUnsignedShort(encodeAnimSequence(anim?.walkRight)); // walkRight
    writer.writeUnsignedShort(encodeAnimSequence(anim?.run)); // run

    // 8. Username (null-terminated CP1252 string)
    writer.writeStringCp1252NullTerminated(view.name ?? "");

    // 9. Combat level (byte)
    writer.writeByte(options?.combatLevel ?? 3);

    // 10. Skill level (unsigned short) - total level for display
    writer.writeUnsignedShort(options?.skillLevel ?? 32);

    // 11. isHidden (byte)
    writer.writeByte(options?.isHidden ? 1 : 0);

    // 12. Color/texture override flags (unsigned short)
    // 0 = no overrides
    writer.writeUnsignedShort(0);

    // 13. Actions (3 null-terminated strings)
    const actions = options?.actions ?? ["", "", ""];
    writer.writeStringCp1252NullTerminated(actions[0] ?? "");
    writer.writeStringCp1252NullTerminated(actions[1] ?? "");
    writer.writeStringCp1252NullTerminated(actions[2] ?? "");

    // 14. Final byte (appearance flags)
    writer.writeByte(0);

    // 15. Project extension: authoritative equipped ammo quantity for local worn inventory sync.
    const ammoQty = Math.max(0, appearance?.equipQty?.[EquipmentSlot.AMMO] ?? 0);
    writer.writeInt(ammoQty);

    return writer.toUint8Array();
}
