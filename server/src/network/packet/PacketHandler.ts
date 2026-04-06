/**
 * PacketHandler - Server-side binary packet decoder and dispatcher
 *
 * Decodes client packets using ServerPacketBuffer read methods that are the
 * inverse of PacketBuffer write methods used in menuAction.ts.
 */
import {
    CLIENT_PACKET_LENGTHS,
    ClientPacketId,
} from "../../../../src/shared/network/ClientPacketId";
import type { ClientToServer } from "../messages";
import { ServerPacketBuffer } from "./ServerPacketBuffer";

// Re-export for backwards compatibility
export { ClientPacketId, CLIENT_PACKET_LENGTHS };

/**
 * Decoded packet data types
 */
export interface PlayerOpPacket {
    type: "player_op";
    opNum: number; // 1-8
    playerIndex: number;
    ctrlHeld: boolean;
}

export interface NpcOpPacket {
    type: "npc_op";
    opNum: number; // 1-5
    npcIndex: number;
    ctrlHeld: boolean;
}

export interface LocOpPacket {
    type: "loc_op";
    opNum: number; // 1-5
    locId: number;
    worldX: number;
    worldY: number;
    ctrlHeld: boolean;
}

export interface GroundItemOpPacket {
    type: "ground_item_op";
    opNum: number; // 1-5
    itemId: number;
    worldX: number;
    worldY: number;
    ctrlHeld: boolean;
}

export interface ItemUseOnLocPacket {
    type: "item_use_on_loc";
    locId: number;
    worldX: number;
    worldY: number;
    itemSlot: number;
    itemId: number;
    itemWidget: number;
    ctrlHeld: boolean;
}

export interface ItemUseOnNpcPacket {
    type: "item_use_on_npc";
    npcIndex: number;
    itemSlot: number;
    itemId: number;
    itemWidget: number;
    ctrlHeld: boolean;
}

export interface ItemUseOnPlayerPacket {
    type: "item_use_on_player";
    playerIndex: number;
    itemSlot: number;
    itemId: number;
    itemWidget: number;
    ctrlHeld: boolean;
}

export interface ItemUseOnGroundItemPacket {
    type: "item_use_on_ground_item";
    targetItemId: number;
    worldX: number;
    worldY: number;
    itemSlot: number;
    itemId: number;
    itemWidget: number;
    ctrlHeld: boolean;
}

export interface WidgetTargetOnLocPacket {
    type: "widget_target_on_loc";
    locId: number;
    worldX: number;
    worldY: number;
    spellWidget: number;
    spellChildIndex: number;
    spellItemId: number;
    ctrlHeld: boolean;
}

export interface WidgetTargetOnNpcPacket {
    type: "widget_target_on_npc";
    npcIndex: number;
    spellWidget: number;
    spellChildIndex: number;
    spellItemId: number;
    ctrlHeld: boolean;
}

export interface WidgetTargetOnPlayerPacket {
    type: "widget_target_on_player";
    playerIndex: number;
    spellWidget: number;
    spellChildIndex: number;
    spellItemId: number;
    ctrlHeld: boolean;
}

export interface WidgetTargetOnGroundItemPacket {
    type: "widget_target_on_ground_item";
    itemId: number;
    worldX: number;
    worldY: number;
    spellWidget: number;
    spellChildIndex: number;
    spellItemId: number;
    ctrlHeld: boolean;
}

export interface WidgetTargetOnWidgetPacket {
    type: "widget_target_on_widget";
    targetWidget: number;
    targetSlot: number;
    targetItemId: number;
    spellWidget: number;
    spellChildIndex: number;
    spellItemId: number;
}

export interface IfButtonPacket {
    type: "if_button";
    widgetId: number;
}

export interface IfButtonNPacket {
    type: "if_button_n";
    buttonNum: number; // 1-10
    widgetId: number;
    slot: number;
    itemId: number;
}

export interface IfButtonDPacket {
    type: "if_button_d";
    sourceWidgetId: number;
    sourceSlot: number;
    sourceItemId: number;
    targetWidgetId: number;
    targetSlot: number;
    targetItemId: number;
}

export interface IfClosePacket {
    type: "if_close";
}

export interface ResumePauseButtonPacket {
    type: "resume_pausebutton";
    widgetId: number;
    childIndex: number;
}

export interface IfTriggerOpLocalPacket {
    type: "if_triggeroplocal";
    opcodeParam: number;
    widgetUid: number;
    childIndex: number;
    itemId: number;
    argsData: Uint8Array;
}

export interface AppearanceSetPacket {
    type: "appearance_set";
    gender: number;
    kits: number[];
    colors: number[];
}

export interface ExamineLocPacket {
    type: "examine_loc";
    locId: number;
}

export interface ExamineNpcPacket {
    type: "examine_npc";
    npcId: number;
}

export interface ExamineObjPacket {
    type: "examine_obj";
    itemId: number;
    worldX: number;
    worldY: number;
}

export interface MovePacket {
    type: "move";
    worldX: number;
    worldY: number;
    locId: number;
    modifierFlags: number;
}

export interface UnknownPacket {
    type: "unknown";
    opcode: number;
    data: Uint8Array;
}

export type DecodedPacket =
    | PlayerOpPacket
    | NpcOpPacket
    | LocOpPacket
    | GroundItemOpPacket
    | ItemUseOnLocPacket
    | ItemUseOnNpcPacket
    | ItemUseOnPlayerPacket
    | ItemUseOnGroundItemPacket
    | WidgetTargetOnLocPacket
    | WidgetTargetOnNpcPacket
    | WidgetTargetOnPlayerPacket
    | WidgetTargetOnGroundItemPacket
    | WidgetTargetOnWidgetPacket
    | IfButtonPacket
    | IfButtonNPacket
    | IfButtonDPacket
    | IfClosePacket
    | ResumePauseButtonPacket
    | IfTriggerOpLocalPacket
    | AppearanceSetPacket
    | ExamineLocPacket
    | ExamineNpcPacket
    | ExamineObjPacket
    | MovePacket
    | UnknownPacket;

/**
 * Decode a binary packet from client
 *
 * @param opcode The packet opcode (first byte after possible size prefix)
 * @param data The packet payload (excluding opcode)
 * @returns Decoded packet or null if unrecognized
 */
export function decodePacket(opcode: number, data: Uint8Array): DecodedPacket {
    const buf = new ServerPacketBuffer(data);

    switch (opcode) {
        // ========================================
        // PLAYER OPTIONS (44-51)
        // ========================================

        // OPPLAYER1 (44) - Attack
        // Client: writeByteSub(ctrl), writeShort(identifier)
        case ClientPacketId.OPPLAYER1: {
            const ctrlHeld = buf.readByteSub() !== 0;
            const playerIndex = buf.readShort();
            return { type: "player_op", opNum: 1, playerIndex, ctrlHeld };
        }

        // OPPLAYER2 (45) - Trade
        // Client: writeByte(ctrl), writeShort(identifier)
        case ClientPacketId.OPPLAYER2: {
            const ctrlHeld = buf.readByte() !== 0;
            const playerIndex = buf.readShort();
            return { type: "player_op", opNum: 2, playerIndex, ctrlHeld };
        }

        // OPPLAYER3 (46) - Follow
        // Client: writeByteSub(ctrl), writeShort(identifier)
        case ClientPacketId.OPPLAYER3: {
            const ctrlHeld = buf.readByteSub() !== 0;
            const playerIndex = buf.readShort();
            return { type: "player_op", opNum: 3, playerIndex, ctrlHeld };
        }

        // OPPLAYER4 (73)
        // Client: writeShort(identifier), writeByteNeg(ctrl)
        case ClientPacketId.OPPLAYER4: {
            const playerIndex = buf.readShort();
            const ctrlHeld = buf.readByteNeg() !== 0;
            return { type: "player_op", opNum: 4, playerIndex, ctrlHeld };
        }

        // OPPLAYER5 (6)
        // Client: writeShortAddLE(identifier), writeByteSub(ctrl)
        case ClientPacketId.OPPLAYER5: {
            const playerIndex = buf.readShortAddLE();
            const ctrlHeld = buf.readByteSub() !== 0;
            return { type: "player_op", opNum: 5, playerIndex, ctrlHeld };
        }

        // OPPLAYER6 (48)
        // Client: writeShort(identifier), writeByteNeg(ctrl)
        case ClientPacketId.OPPLAYER6: {
            const playerIndex = buf.readShort();
            const ctrlHeld = buf.readByteNeg() !== 0;
            return { type: "player_op", opNum: 6, playerIndex, ctrlHeld };
        }

        // OPPLAYER7 (10)
        // Client: writeShortAdd(identifier), writeByteSub(ctrl)
        case ClientPacketId.OPPLAYER7: {
            const playerIndex = buf.readShortAdd();
            const ctrlHeld = buf.readByteSub() !== 0;
            return { type: "player_op", opNum: 7, playerIndex, ctrlHeld };
        }

        // OPPLAYER8 (21)
        // Client: writeByte(ctrl), writeShortAdd(identifier)
        case ClientPacketId.OPPLAYER8: {
            const ctrlHeld = buf.readByte() !== 0;
            const playerIndex = buf.readShortAdd();
            return { type: "player_op", opNum: 8, playerIndex, ctrlHeld };
        }

        // ========================================
        // NPC OPTIONS (9-13)
        // ========================================

        // OPNPC1 (76)
        // Client: writeByte(ctrl), writeShortAddLE(identifier)
        case ClientPacketId.OPNPC1_ALT: {
            const ctrlHeld = buf.readByte() !== 0;
            const npcIndex = buf.readShortAddLE();
            return { type: "npc_op", opNum: 1, npcIndex, ctrlHeld };
        }

        // OPNPC2 (12)
        // Client: writeShortAddLE(identifier), writeByte(ctrl)
        case ClientPacketId.OPNPC2: {
            const npcIndex = buf.readShortAddLE();
            const ctrlHeld = buf.readByte() !== 0;
            return { type: "npc_op", opNum: 2, npcIndex, ctrlHeld };
        }

        // OPNPC3 (34)
        // Client: writeShortAdd(identifier), writeByteNeg(ctrl)
        case ClientPacketId.OPNPC3: {
            const npcIndex = buf.readShortAdd();
            const ctrlHeld = buf.readByteNeg() !== 0;
            return { type: "npc_op", opNum: 3, npcIndex, ctrlHeld };
        }

        // OPNPC4 (70)
        // Client: writeByteNeg(ctrl), writeShortLE(identifier)
        case ClientPacketId.OPNPC4: {
            const ctrlHeld = buf.readByteNeg() !== 0;
            const npcIndex = buf.readShortLE();
            return { type: "npc_op", opNum: 4, npcIndex, ctrlHeld };
        }

        // OPNPC5 (57)
        // Note: this currently comes through ClientPacketId.OPNPC1 (legacy alias naming).
        // Client: writeByteAdd(ctrl), writeShortLE(identifier)
        case ClientPacketId.OPNPC1: {
            const ctrlHeld = buf.readByteAdd() !== 0;
            const npcIndex = buf.readShortLE();
            return { type: "npc_op", opNum: 5, npcIndex, ctrlHeld };
        }

        // ========================================
        // LOCATION/OBJECT OPTIONS (1-6, 1001)
        // ========================================

        // OPLOCU (86) - Item use on loc (15 bytes)
        // Client: writeShortAddLE(itemSlot), writeShortAdd(locId), writeIntLE(itemWidget),
        //         writeByteSub(ctrl), writeShortLE(worldX), writeShort(worldY), writeShortAddLE(itemId)
        case ClientPacketId.OPLOCU: {
            const itemSlot = buf.readShortAddLE();
            const locId = buf.readShortAdd();
            const itemWidget = buf.readIntLE();
            const ctrlHeld = buf.readByteSub() !== 0;
            const worldX = buf.readShortLE();
            const worldY = buf.readShort();
            const itemId = buf.readShortAddLE();
            return {
                type: "item_use_on_loc",
                locId,
                worldX,
                worldY,
                itemSlot,
                itemId,
                itemWidget,
                ctrlHeld,
            };
        }

        // OPLOC1 (96)
        // Client: writeShortAdd(worldX), writeShortLE(worldY), writeByteNeg(ctrl), writeShortAddLE(locId)
        case ClientPacketId.OPLOC1: {
            const worldX = buf.readShortAdd();
            const worldY = buf.readShortLE();
            const ctrlHeld = buf.readByteNeg() !== 0;
            const locId = buf.readShortAddLE();
            return { type: "loc_op", opNum: 1, locId, worldX, worldY, ctrlHeld };
        }

        // OPLOC2 (28)
        // Client: writeShortAddLE(worldX), writeShortAddLE(worldY), writeByteSub(ctrl), writeShort(locId)
        case ClientPacketId.OPLOC2: {
            const worldX = buf.readShortAddLE();
            const worldY = buf.readShortAddLE();
            const ctrlHeld = buf.readByteSub() !== 0;
            const locId = buf.readShort();
            return { type: "loc_op", opNum: 2, locId, worldX, worldY, ctrlHeld };
        }

        // OPLOC3 (42)
        // Client: writeShortLE(worldY), writeShortLE(locId), writeShortAddLE(worldX), writeByteSub(ctrl)
        case ClientPacketId.OPLOC3: {
            const worldY = buf.readShortLE();
            const locId = buf.readShortLE();
            const worldX = buf.readShortAddLE();
            const ctrlHeld = buf.readByteSub() !== 0;
            return { type: "loc_op", opNum: 3, locId, worldX, worldY, ctrlHeld };
        }

        // OPLOC4 (38)
        // Client: writeShortAdd(worldX), writeShortLE(locId), writeShortAdd(worldY), writeByteNeg(ctrl)
        case ClientPacketId.OPLOC4: {
            const worldX = buf.readShortAdd();
            const locId = buf.readShortLE();
            const worldY = buf.readShortAdd();
            const ctrlHeld = buf.readByteNeg() !== 0;
            return { type: "loc_op", opNum: 4, locId, worldX, worldY, ctrlHeld };
        }

        // OPLOC5 (51)
        // Client: writeShort(worldX), writeByteAdd(ctrl), writeShortAdd(worldY), writeShortAdd(locId)
        case ClientPacketId.OPLOC5: {
            const worldX = buf.readShort();
            const ctrlHeld = buf.readByteAdd() !== 0;
            const worldY = buf.readShortAdd();
            const locId = buf.readShortAdd();
            return { type: "loc_op", opNum: 5, locId, worldX, worldY, ctrlHeld };
        }

        // ========================================
        // GROUND ITEM OPTIONS (18-22)
        // ========================================

        // OPOBJ1 (102) - Ground item option 1 (Take)
        // Client: writeByteSub(ctrl), writeShortLE(worldY), writeShortAdd(itemId), writeShortAdd(worldX)
        case ClientPacketId.OPOBJ1: {
            const ctrlHeld = buf.readByteSub() !== 0;
            const worldY = buf.readShortLE();
            const itemId = buf.readShortAdd();
            const worldX = buf.readShortAdd();
            return { type: "ground_item_op", opNum: 1, itemId, worldX, worldY, ctrlHeld };
        }

        // OPOBJ2 (43)
        // Client: writeShortAdd(worldX), writeShortLE(worldY), writeShort(itemId), writeByte(ctrl)
        case ClientPacketId.OPOBJ2: {
            const worldX = buf.readShortAdd();
            const worldY = buf.readShortLE();
            const itemId = buf.readShort();
            const ctrlHeld = buf.readByte() !== 0;
            return { type: "ground_item_op", opNum: 2, itemId, worldX, worldY, ctrlHeld };
        }

        // OPOBJ3 (103) - Ground item option 3
        // Client: writeShortLE(itemId), writeShortAdd(worldX), writeShortAddLE(worldY), writeByteSub(ctrl)
        case ClientPacketId.OPOBJ3: {
            const itemId = buf.readShortLE();
            const worldX = buf.readShortAdd();
            const worldY = buf.readShortAddLE();
            const ctrlHeld = buf.readByteSub() !== 0;
            return { type: "ground_item_op", opNum: 3, itemId, worldX, worldY, ctrlHeld };
        }

        // OPOBJ4 (56)
        // Client: writeShortAddLE(itemId), writeShortAddLE(worldY), writeByteNeg(ctrl), writeShortAdd(worldX)
        case ClientPacketId.OPOBJ4: {
            const itemId = buf.readShortAddLE();
            const worldY = buf.readShortAddLE();
            const ctrlHeld = buf.readByteNeg() !== 0;
            const worldX = buf.readShortAdd();
            return { type: "ground_item_op", opNum: 4, itemId, worldX, worldY, ctrlHeld };
        }

        // OPOBJ5 (82)
        // Client: writeShortAdd(itemId), writeShortLE(worldX), writeShortLE(worldY), writeByteSub(ctrl)
        case ClientPacketId.OPOBJ5: {
            const itemId = buf.readShortAdd();
            const worldX = buf.readShortLE();
            const worldY = buf.readShortLE();
            const ctrlHeld = buf.readByteSub() !== 0;
            return { type: "ground_item_op", opNum: 5, itemId, worldX, worldY, ctrlHeld };
        }

        // ========================================
        // ITEM USE ON TARGET
        // ========================================

        // OPNPC_U (36) - Item use on NPC
        // Client: writeShortAddLE(itemSlot), writeByte(ctrl), writeIntME(itemWidget),
        //         writeShortLE(itemId), writeShortAddLE(npcIndex)
        case ClientPacketId.OPNPC_U: {
            const itemSlot = buf.readShortAddLE();
            const ctrlHeld = buf.readByte() !== 0;
            const itemWidget = buf.readIntME();
            const itemId = buf.readShortLE();
            const npcIndex = buf.readShortAddLE();
            return {
                type: "item_use_on_npc",
                npcIndex,
                itemSlot,
                itemId,
                itemWidget,
                ctrlHeld,
            };
        }

        // OPPLAYER_U (65) - Item use on player
        // Client: writeShortAddLE(playerIndex), writeShortAddLE(itemId),
        //         writeShortAdd(itemSlot), writeInt(itemWidget), writeByteAdd(ctrl)
        case ClientPacketId.OPPLAYER_U: {
            const playerIndex = buf.readShortAddLE();
            const itemId = buf.readShortAddLE();
            const itemSlot = buf.readShortAdd();
            const itemWidget = buf.readInt();
            const ctrlHeld = buf.readByteAdd() !== 0;
            return {
                type: "item_use_on_player",
                playerIndex,
                itemSlot,
                itemId,
                itemWidget,
                ctrlHeld,
            };
        }

        // OPOBJ_U (79) - Item use on ground item
        // Client: writeShortAddLE(targetItemId), writeShortAdd(worldY), writeIntME(itemWidget),
        //         writeShortAdd(worldX), writeShortAddLE(itemSlot), writeByteSub(ctrl), writeShortLE(itemId)
        case ClientPacketId.OPOBJ_U: {
            const targetItemId = buf.readShortAddLE();
            const worldY = buf.readShortAdd();
            const itemWidget = buf.readIntME();
            const worldX = buf.readShortAdd();
            const itemSlot = buf.readShortAddLE();
            const ctrlHeld = buf.readByteSub() !== 0;
            const itemId = buf.readShortLE();
            return {
                type: "item_use_on_ground_item",
                targetItemId,
                worldX,
                worldY,
                itemSlot,
                itemId,
                itemWidget,
                ctrlHeld,
            };
        }

        // ========================================
        // WIDGET TARGET ON TARGET
        // ========================================

        // OPLOC_T (2) - Widget target on location
        // Client: writeShortAddLE(worldY), writeShortAdd(locId), writeShortAdd(spellChildIndex),
        //         writeIntLE(spellWidget), writeShort(worldX), writeShortLE(spellItemId), writeByteNeg(ctrl)
        case ClientPacketId.OPLOC_T: {
            const worldY = buf.readShortAddLE();
            const locId = buf.readShortAdd();
            const spellChildIndex = buf.readShortAdd();
            const spellWidget = buf.readIntLE();
            const worldX = buf.readShort();
            const spellItemId = buf.readShortLE();
            const ctrlHeld = buf.readByteNeg() !== 0;
            return {
                type: "widget_target_on_loc",
                locId,
                worldX,
                worldY,
                spellWidget,
                spellChildIndex,
                spellItemId,
                ctrlHeld,
            };
        }

        // OPNPC_T (75) - Widget target on NPC
        // Client: writeShort(npcIndex), writeIntLE(spellWidget), writeShort(spellChildIndex),
        //         writeShortAdd(spellItemId), writeByteAdd(ctrl)
        case ClientPacketId.OPNPC_T: {
            const npcIndex = buf.readShort();
            const spellWidget = buf.readIntLE();
            const spellChildIndex = buf.readShort();
            const spellItemId = buf.readShortAdd();
            const ctrlHeld = buf.readByteAdd() !== 0;
            return {
                type: "widget_target_on_npc",
                npcIndex,
                spellWidget,
                spellChildIndex,
                spellItemId,
                ctrlHeld,
            };
        }

        // OPPLAYER_T (32) - Widget target on player
        // Client: writeByteNeg(ctrl), writeShortLE(spellItemId), writeShortLE(spellChildIndex),
        //         writeIntIME(spellWidget), writeShortLE(playerIndex)
        case ClientPacketId.OPPLAYER_T: {
            const ctrlHeld = buf.readByteNeg() !== 0;
            const spellItemId = buf.readShortLE();
            const spellChildIndex = buf.readShortLE();
            const spellWidget = buf.readIntIME();
            const playerIndex = buf.readShortLE();
            return {
                type: "widget_target_on_player",
                playerIndex,
                spellWidget,
                spellChildIndex,
                spellItemId,
                ctrlHeld,
            };
        }

        // OPLOC_T_ALT (94) - Widget target on ground item
        // Client: writeIntLE(spellWidget), writeShortAdd(spellChildIndex), writeShortAdd(itemId),
        //         writeShortAddLE(worldX), writeShort(worldY), writeByte(ctrl), writeShortAddLE(spellItemId)
        case ClientPacketId.OPLOC_T_ALT: {
            const spellWidget = buf.readIntLE();
            const spellChildIndex = buf.readShortAdd();
            const itemId = buf.readShortAdd();
            const worldX = buf.readShortAddLE();
            const worldY = buf.readShort();
            const ctrlHeld = buf.readByte() !== 0;
            const spellItemId = buf.readShortAddLE();
            return {
                type: "widget_target_on_ground_item",
                itemId,
                worldX,
                worldY,
                spellWidget,
                spellChildIndex,
                spellItemId,
                ctrlHeld,
            };
        }

        // IF_BUTTONT (90) - Widget target on widget
        // Client: writeIntIME(targetWidget), writeShortAddLE(targetSlot), writeIntLE(spellWidget),
        //         writeShortLE(spellChildIndex), writeShort(spellItemId), writeShortAddLE(targetItemId)
        case ClientPacketId.IF_BUTTONT: {
            const targetWidget = buf.readIntIME();
            const targetSlot = buf.readShortAddLE();
            const spellWidget = buf.readIntLE();
            const spellChildIndex = buf.readShortLE();
            const spellItemId = buf.readShort();
            const targetItemId = buf.readShortAddLE();
            return {
                type: "widget_target_on_widget",
                targetWidget,
                targetSlot,
                targetItemId,
                spellWidget,
                spellChildIndex,
                spellItemId,
            };
        }

        // ========================================
        // WIDGET BUTTON
        // ========================================

        // IF_BUTTON (13) - Simple button click (4 bytes)
        // Used for widget opcodes 24, 28, 29
        // Client: writeInt(widgetId)
        case ClientPacketId.IF_BUTTON: {
            const widgetId = buf.readInt();
            return { type: "if_button", widgetId };
        }

        // IF_BUTTOND (1) - Widget drag to widget (16 bytes)
        // Used for bank item rearrangement, inventory swaps, etc.
        // Client: writeIntLE(targetWidgetId), writeShortAdd(sourceItemId), writeShort(targetSlot),
        //         writeInt(sourceWidgetId), writeShortAdd(targetItemId), writeShortAdd(sourceSlot)
        case ClientPacketId.IF_BUTTOND: {
            const targetWidgetId = buf.readIntLE();
            const sourceItemId = buf.readShortAdd();
            const targetSlot = buf.readShort();
            const sourceWidgetId = buf.readInt();
            const targetItemId = buf.readShortAdd();
            const sourceSlot = buf.readShortAdd();
            return {
                type: "if_button_d",
                sourceWidgetId,
                sourceSlot,
                sourceItemId,
                targetWidgetId,
                targetSlot,
                targetItemId,
            };
        }

        // IF_BUTTON1-10 - Widget click with slot/item data (8 bytes each)
        // Used for CC_OP (opcode 57) and widget inventory clicks
        // Client: writeInt(widgetId), writeShort(slot), writeShort(itemId)
        case ClientPacketId.IF_BUTTON1: {
            const widgetId = buf.readInt();
            const slot = buf.readShort();
            const itemId = buf.readShort();
            return { type: "if_button_n", buttonNum: 1, widgetId, slot, itemId };
        }
        case ClientPacketId.IF_BUTTON2: {
            const widgetId = buf.readInt();
            const slot = buf.readShort();
            const itemId = buf.readShort();
            return { type: "if_button_n", buttonNum: 2, widgetId, slot, itemId };
        }
        case ClientPacketId.IF_BUTTON3: {
            const widgetId = buf.readInt();
            const slot = buf.readShort();
            const itemId = buf.readShort();
            return { type: "if_button_n", buttonNum: 3, widgetId, slot, itemId };
        }
        case ClientPacketId.IF_BUTTON4: {
            const widgetId = buf.readInt();
            const slot = buf.readShort();
            const itemId = buf.readShort();
            return { type: "if_button_n", buttonNum: 4, widgetId, slot, itemId };
        }
        case ClientPacketId.IF_BUTTON5: {
            const widgetId = buf.readInt();
            const slot = buf.readShort();
            const itemId = buf.readShort();
            return { type: "if_button_n", buttonNum: 5, widgetId, slot, itemId };
        }
        case ClientPacketId.IF_BUTTON6: {
            const widgetId = buf.readInt();
            const slot = buf.readShort();
            const itemId = buf.readShort();
            return { type: "if_button_n", buttonNum: 6, widgetId, slot, itemId };
        }
        case ClientPacketId.IF_BUTTON7: {
            const widgetId = buf.readInt();
            const slot = buf.readShort();
            const itemId = buf.readShort();
            return { type: "if_button_n", buttonNum: 7, widgetId, slot, itemId };
        }
        case ClientPacketId.IF_BUTTON8: {
            const widgetId = buf.readInt();
            const slot = buf.readShort();
            const itemId = buf.readShort();
            return { type: "if_button_n", buttonNum: 8, widgetId, slot, itemId };
        }
        case ClientPacketId.IF_BUTTON9: {
            const widgetId = buf.readInt();
            const slot = buf.readShort();
            const itemId = buf.readShort();
            return { type: "if_button_n", buttonNum: 9, widgetId, slot, itemId };
        }
        case ClientPacketId.IF_BUTTON10: {
            const widgetId = buf.readInt();
            const slot = buf.readShort();
            const itemId = buf.readShort();
            return { type: "if_button_n", buttonNum: 10, widgetId, slot, itemId };
        }

        // IF_CLOSE (55) - Close interface (0 bytes)
        // Client: no payload
        case ClientPacketId.IF_CLOSE: {
            return { type: "if_close" };
        }

        // RESUME_PAUSEBUTTON (62) - Dialog continue
        // Client: writeShortAddLE(childIndex), writeInt(widgetId)
        case ClientPacketId.RESUME_PAUSEBUTTON: {
            const childIndex = buf.readShortAddLE();
            const widgetId = buf.readInt();
            return { type: "resume_pausebutton", widgetId, childIndex };
        }

        // IF_TRIGGEROPLOCAL (30) - forwarded Object[] trigger-op local payload
        // Payload layout :
        //   short blockLen,
        //   intLE opcodeParam,
        //   shortLE childIndex,
        //   intLE widgetUid,
        //   shortLE itemId,
        //   argsData[blockLen - 12]
        case ClientPacketId.IF_TRIGGEROPLOCAL: {
            const blockLen = buf.readShort();
            const opcodeParam = buf.readIntLE();

            const childRaw = buf.readShortLE();
            const childIndex = childRaw > 32767 ? childRaw - 65536 : childRaw;

            const widgetUid = buf.readIntLE();

            const itemRaw = buf.readShortLE();
            const itemId = itemRaw > 32767 ? itemRaw - 65536 : itemRaw;

            const expectedArgsLen = Math.max(0, blockLen - 12);
            const argsLen = Math.max(0, Math.min(expectedArgsLen, buf.remaining));
            const argsData = buf.readBytes(argsLen);

            return {
                type: "if_triggeroplocal",
                opcodeParam,
                widgetUid,
                childIndex,
                itemId,
                argsData,
            };
        }

        // APPEARANCE_SET (37) - Submit player appearance selection (PlayerDesign confirm)
        // Length 13:
        // - gender (byte)
        // - kits (7 bytes, -1 = 0xff)
        // - colors (5 bytes)
        case ClientPacketId.APPEARANCE_SET: {
            const gender = buf.readByte() === 1 ? 1 : 0;
            const kits: number[] = new Array(7);
            for (let i = 0; i < 7; i++) {
                const v = buf.readByte();
                kits[i] = v === 255 ? -1 : v;
            }
            const colors: number[] = new Array(5);
            for (let i = 0; i < 5; i++) colors[i] = buf.readByte();
            return { type: "appearance_set", gender, kits, colors };
        }

        // ========================================
        // EXAMINE
        // ========================================

        // EXAMINE_LOC (85)
        // Client: writeShortAddLE(locId)
        case ClientPacketId.EXAMINE_LOC: {
            const locId = buf.readShortAddLE();
            return { type: "examine_loc", locId };
        }

        // EXAMINE_NPC (9)
        // Client: writeShortAdd(npcId)
        case ClientPacketId.EXAMINE_NPC: {
            const npcId = buf.readShortAdd();
            return { type: "examine_npc", npcId };
        }

        // EXAMINE_OBJ (104)
        // Client: writeShort(itemId), writeShortLE(worldY), writeShortLE(worldX)
        case ClientPacketId.EXAMINE_OBJ: {
            const itemId = buf.readShort();
            const worldY = buf.readShortLE();
            const worldX = buf.readShortLE();
            return { type: "examine_obj", itemId, worldX, worldY };
        }

        // ========================================
        // MOVEMENT
        // ========================================

        // MOVE_GAMECLICK (16)
        // Based on common OSRS encoding for movement
        case ClientPacketId.MOVE_GAMECLICK: {
            const worldY = buf.readShortAddLE();
            const modifierFlags = buf.readByteNeg();
            const worldX = buf.readShortAddLE();
            const locId = buf.readShortAdd();
            return { type: "move", worldX, worldY, locId, modifierFlags };
        }

        default:
            return { type: "unknown", opcode, data };
    }
}

/**
 * Handler callback types
 */
export type PacketHandlerFn<T extends DecodedPacket = DecodedPacket> = (
    playerId: number,
    packet: T,
) => void;

/**
 * Packet handler registry
 */
export class PacketHandlerRegistry {
    private handlers: Map<DecodedPacket["type"], PacketHandlerFn[]> = new Map();

    /**
     * Register a handler for a specific packet type
     */
    on<K extends DecodedPacket["type"]>(
        type: K,
        handler: PacketHandlerFn<Extract<DecodedPacket, { type: K }>>,
    ): void {
        if (!this.handlers.has(type)) {
            this.handlers.set(type, []);
        }
        this.handlers.get(type)!.push(handler as PacketHandlerFn);
    }

    /**
     * Dispatch a decoded packet to registered handlers
     */
    dispatch(playerId: number, packet: DecodedPacket): void {
        const handlers = this.handlers.get(packet.type);
        if (handlers) {
            for (const handler of handlers) {
                handler(playerId, packet);
            }
        }
    }
}

/**
 * Parse a raw binary message containing one or more packets
 *
 * @param data Raw WebSocket binary data
 * @returns Array of decoded packets
 */
export function parsePackets(data: Uint8Array): Array<{ opcode: number; packet: DecodedPacket }> {
    const results: Array<{ opcode: number; packet: DecodedPacket }> = [];
    let offset = 0;

    while (offset < data.length) {
        const opcode = data[offset++];

        // Validate opcode range (OSRS uses 0-127 for client packets)
        if (opcode < 0 || opcode > 127) {
            console.error(
                `[PacketHandler] Invalid opcode ${opcode} at offset ${offset - 1}, stopping parse`,
            );
            break;
        }

        const expectedLength = CLIENT_PACKET_LENGTHS[opcode];

        if (expectedLength === undefined) {
            // Unknown packet - we cannot safely continue since we don't know its length
            console.warn(
                `[PacketHandler] Unknown packet opcode ${opcode} at offset ${
                    offset - 1
                }, stopping parse (${data.length - offset} bytes remaining)`,
            );
            break;
        }

        let length: number;
        if (expectedLength === -1) {
            // Variable byte length - need at least 1 byte for length
            if (offset >= data.length) {
                console.error(
                    `[PacketHandler] Packet ${opcode} truncated: missing variable byte length`,
                );
                break;
            }
            length = data[offset++];
        } else if (expectedLength === -2) {
            // Variable short length - need at least 2 bytes for length
            if (offset + 1 >= data.length) {
                console.error(
                    `[PacketHandler] Packet ${opcode} truncated: missing variable short length`,
                );
                break;
            }
            length = (data[offset++] << 8) | data[offset++];
        } else {
            length = expectedLength;
        }

        // Validate we have enough bytes for the payload
        if (offset + length > data.length) {
            console.error(
                `[PacketHandler] Packet ${opcode} overrun: needs ${length} bytes, only ${
                    data.length - offset
                } available`,
            );
            break;
        }

        const payload = data.slice(offset, offset + length);
        offset += length;

        const packet = decodePacket(opcode, payload);
        results.push({ opcode, packet });
    }

    return results;
}

/**
 * Extract spell info from widget click
 * Widget ID encodes (groupId << 16) | childId
 *
 * OSRS Spellbook interface groups:
 * - 218 = Standard spellbook
 * - 219 = Ancient magicks
 * - 388 = Lunar spellbook
 * - 389 = Arceuus spellbook
 *
 * Manual spell target packets preserve both the full selected spell widget
 * and the child index. The server resolves the actual spell from those widget
 * references, matching the active OSRS client packet contract.
 */
function buildSpellSelectionPayload(
    spellWidget: number,
    spellChildIndex: number,
    spellItemId: number,
    ctrlHeld?: boolean,
): {
    spellbookGroupId: number;
    widgetChildId: number;
    selectedSpellWidgetId: number;
    selectedSpellChildIndex: number;
    selectedSpellItemId?: number;
    modifierFlags?: number;
} {
    const payload: {
        spellbookGroupId: number;
        widgetChildId: number;
        selectedSpellWidgetId: number;
        selectedSpellChildIndex: number;
        selectedSpellItemId?: number;
        modifierFlags?: number;
    } = {
        spellbookGroupId: (spellWidget >>> 16) & 0xffff,
        widgetChildId: spellChildIndex | 0,
        selectedSpellWidgetId: spellWidget | 0,
        selectedSpellChildIndex: spellChildIndex | 0,
    };
    if ((spellItemId | 0) !== 0xffff) {
        payload.selectedSpellItemId = spellItemId | 0;
    }
    if (ctrlHeld !== undefined) {
        payload.modifierFlags = ctrlHeld ? 1 : 0;
    }
    return payload;
}

/**
 * Parse raw binary packets directly to ClientToServer messages
 *
 * This combines packet parsing and conversion in one step, eliminating
 * the intermediate DecodedPacket types for the message path.
 *
 * @param data Raw WebSocket binary data
 * @returns Array of ClientToServer messages ready for handlers
 */
export function parsePacketsAsMessages(
    data: Uint8Array,
): Array<{ msg: ClientToServer | null; packet: DecodedPacket }> {
    const results: Array<{ msg: ClientToServer | null; packet: DecodedPacket }> = [];
    let offset = 0;

    while (offset < data.length) {
        const opcode = data[offset++];

        // Validate opcode range (OSRS uses 0-127 for client packets)
        if (opcode < 0 || opcode > 127) {
            console.error(
                `[PacketHandler] Invalid opcode ${opcode} at offset ${offset - 1}, stopping parse`,
            );
            break;
        }

        const expectedLength = CLIENT_PACKET_LENGTHS[opcode];

        if (expectedLength === undefined) {
            // Unknown packet - we cannot safely continue since we don't know its length
            console.warn(
                `[PacketHandler] Unknown packet opcode ${opcode} at offset ${
                    offset - 1
                }, stopping parse (${data.length - offset} bytes remaining)`,
            );
            break;
        }

        let length: number;
        if (expectedLength === -1) {
            // Variable byte length - need at least 1 byte for length
            if (offset >= data.length) {
                console.error(
                    `[PacketHandler] Packet ${opcode} truncated: missing variable byte length`,
                );
                break;
            }
            length = data[offset++];
        } else if (expectedLength === -2) {
            // Variable short length - need at least 2 bytes for length
            if (offset + 1 >= data.length) {
                console.error(
                    `[PacketHandler] Packet ${opcode} truncated: missing variable short length`,
                );
                break;
            }
            length = (data[offset++] << 8) | data[offset++];
        } else {
            length = expectedLength;
        }

        // Validate we have enough bytes for the payload
        if (offset + length > data.length) {
            console.error(
                `[PacketHandler] Packet ${opcode} overrun: needs ${length} bytes, only ${
                    data.length - offset
                } available`,
            );
            break;
        }

        const payload = data.slice(offset, offset + length);
        offset += length;

        const packet = decodePacket(opcode, payload);
        const msg = convertDecodedPacketToMessage(packet);
        results.push({ msg, packet });
    }

    return results;
}

/**
 * Convert a DecodedPacket to a ClientToServer message
 * This is the inline conversion logic (moved from BinaryBridge)
 */
function convertDecodedPacketToMessage(packet: DecodedPacket): ClientToServer | null {
    switch (packet.type) {
        // ========================================
        // NPC INTERACTIONS
        // ========================================
        case "npc_op":
            return {
                type: "npc_interact",
                payload: {
                    npcId: packet.npcIndex,
                    opNum: packet.opNum,
                    modifierFlags: packet.ctrlHeld ? 1 : 0,
                },
            };

        // ========================================
        // PLAYER INTERACTIONS
        // ========================================
        case "player_op":
            // OPPLAYER2 = Trade, OPPLAYER3 = Follow (see client MenuAction.ts).
            if (packet.opNum === 2) {
                return {
                    type: "interact",
                    payload: {
                        mode: "trade",
                        targetId: packet.playerIndex,
                        modifierFlags: packet.ctrlHeld ? 1 : 0,
                    },
                };
            }
            if (packet.opNum === 3) {
                return {
                    type: "interact",
                    payload: {
                        mode: "follow",
                        targetId: packet.playerIndex,
                        modifierFlags: packet.ctrlHeld ? 1 : 0,
                    },
                };
            }
            if (packet.opNum === 1) {
                return {
                    type: "player_attack",
                    payload: {
                        playerId: packet.playerIndex,
                        modifierFlags: packet.ctrlHeld ? 1 : 0,
                    },
                };
            }
            return {
                type: "player_interact",
                payload: {
                    playerId: packet.playerIndex,
                    opNum: packet.opNum,
                    modifierFlags: packet.ctrlHeld ? 1 : 0,
                },
            };

        // ========================================
        // LOCATION/OBJECT INTERACTIONS
        // ========================================
        case "loc_op":
            return {
                type: "loc_interact",
                payload: {
                    id: packet.locId,
                    tile: { x: packet.worldX, y: packet.worldY },
                    opNum: packet.opNum,
                    modifierFlags: packet.ctrlHeld ? 1 : 0,
                },
            };

        // ========================================
        // GROUND ITEM INTERACTIONS
        // ========================================
        case "ground_item_op":
            return {
                type: "ground_item_action",
                payload: {
                    stackId: 0,
                    tile: { x: packet.worldX, y: packet.worldY },
                    itemId: packet.itemId,
                    opNum: packet.opNum,
                    modifierFlags: packet.ctrlHeld ? 1 : 0,
                },
            };

        // ========================================
        // ITEM USE ON TARGETS
        // ========================================
        case "item_use_on_npc":
            return {
                type: "inventory_use_on",
                payload: {
                    slot: packet.itemSlot,
                    itemId: packet.itemId,
                    modifierFlags: packet.ctrlHeld ? 1 : 0,
                    target: {
                        kind: "npc",
                        id: packet.npcIndex,
                    },
                },
            };

        case "item_use_on_loc":
            return {
                type: "inventory_use_on",
                payload: {
                    slot: packet.itemSlot,
                    itemId: packet.itemId,
                    modifierFlags: packet.ctrlHeld ? 1 : 0,
                    target: {
                        kind: "loc",
                        id: packet.locId,
                        tile: { x: packet.worldX, y: packet.worldY },
                    },
                },
            };

        case "item_use_on_ground_item":
            return {
                type: "inventory_use_on",
                payload: {
                    slot: packet.itemSlot,
                    itemId: packet.itemId,
                    modifierFlags: packet.ctrlHeld ? 1 : 0,
                    target: {
                        kind: "obj",
                        id: packet.targetItemId,
                        tile: { x: packet.worldX, y: packet.worldY },
                    },
                },
            };

        // ========================================
        // WIDGET INTERACTIONS
        // ========================================
        case "if_button": {
            const groupId = (packet.widgetId >>> 16) & 0xffff;
            const childId = packet.widgetId & 0xffff;
            return {
                type: "widget_action",
                payload: {
                    widgetId: packet.widgetId,
                    groupId,
                    childId,
                },
            };
        }

        case "if_button_n":
            return {
                type: "widget_action",
                payload: {
                    widgetId: packet.widgetId,
                    groupId: (packet.widgetId >>> 16) & 0xffff,
                    childId: packet.widgetId & 0xffff,
                    slot: packet.slot,
                    itemId: packet.itemId,
                    buttonNum: packet.buttonNum,
                },
            };

        case "if_button_d":
            return {
                type: "if_buttond",
                payload: {
                    sourceWidgetId: packet.sourceWidgetId,
                    sourceSlot: packet.sourceSlot,
                    sourceItemId: packet.sourceItemId,
                    targetWidgetId: packet.targetWidgetId,
                    targetSlot: packet.targetSlot,
                    targetItemId: packet.targetItemId,
                },
            };

        case "if_close":
            return {
                type: "if_close",
                payload: {},
            };

        case "resume_pausebutton":
            return {
                type: "resume_pausebutton",
                payload: {
                    widgetId: packet.widgetId,
                    childIndex: packet.childIndex,
                },
            };

        case "if_triggeroplocal":
            return {
                type: "if_triggeroplocal",
                payload: {
                    opcodeParam: packet.opcodeParam,
                    widgetUid: packet.widgetUid,
                    childIndex: packet.childIndex,
                    itemId: packet.itemId,
                    argsData: packet.argsData,
                },
            };

        // ========================================
        // MOVEMENT
        // ========================================
        case "move":
            return {
                type: "walk",
                payload: {
                    to: { x: packet.worldX, y: packet.worldY },
                    modifierFlags: packet.modifierFlags,
                },
            };

        // ========================================
        // SPELL CASTING (Widget Target)
        // ========================================
        case "widget_target_on_npc":
            return {
                type: "spell_cast_npc",
                payload: {
                    npcId: packet.npcIndex,
                    ...buildSpellSelectionPayload(
                        packet.spellWidget,
                        packet.spellChildIndex,
                        packet.spellItemId,
                        packet.ctrlHeld,
                    ),
                },
            };

        case "widget_target_on_player":
            return {
                type: "spell_cast_player",
                payload: {
                    playerId: packet.playerIndex,
                    ...buildSpellSelectionPayload(
                        packet.spellWidget,
                        packet.spellChildIndex,
                        packet.spellItemId,
                        packet.ctrlHeld,
                    ),
                },
            };

        case "widget_target_on_loc":
            return {
                type: "spell_cast_loc",
                payload: {
                    locId: packet.locId,
                    tile: { x: packet.worldX, y: packet.worldY },
                    ...buildSpellSelectionPayload(
                        packet.spellWidget,
                        packet.spellChildIndex,
                        packet.spellItemId,
                        packet.ctrlHeld,
                    ),
                },
            };

        case "widget_target_on_ground_item":
            return {
                type: "spell_cast_obj",
                payload: {
                    objId: packet.itemId,
                    tile: { x: packet.worldX, y: packet.worldY },
                    ...buildSpellSelectionPayload(
                        packet.spellWidget,
                        packet.spellChildIndex,
                        packet.spellItemId,
                        packet.ctrlHeld,
                    ),
                },
            };

        case "widget_target_on_widget":
            return {
                type: "spell_cast_item",
                payload: {
                    slot: packet.targetSlot,
                    itemId: packet.targetItemId,
                    widgetId: packet.targetWidget,
                    ...buildSpellSelectionPayload(
                        packet.spellWidget,
                        packet.spellChildIndex,
                        packet.spellItemId,
                    ),
                },
            };

        default:
            return null;
    }
}
