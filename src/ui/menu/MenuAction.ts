/**
 * menuAction handler
 *
 * This handles menu click actions and sends the appropriate packets
 * to the server. Each opcode maps to a specific packet with OSRS-specific
 * binary encoding.
 */
import { ClientState, MOUSE_CROSS_YELLOW } from "../../client/ClientState";
import { ClientPacket, createPacket, queuePacket } from "../../network/packet";
import { sendNpcInteract } from "../../network/ServerConnection";
import { MenuTargetType } from "../../rs/MenuEntry";
import { MODIFIER_FLAG_CTRL, MODIFIER_FLAG_CTRL_SHIFT } from "../../shared/input/modifierFlags";
import { MenuOpcode } from "./MenuState";

/**
 * OSRS deprioritization offset - added to opcodes to sort them below normal entries
 */
export const MENU_ACTION_DEPRIORITIZE_OFFSET = 2000;

export enum MenuAction {
    Cast = "Cast",
    Use = "Use",
    WalkHere = "Walk here",
    Examine = "Examine",
    Cancel = "Cancel",
    Follow = "Follow",
    TradeWith = "Trade with",
    Attack = "Attack",
    TalkTo = "Talk-to",
    Open = "Open",
    Close = "Close",
    Enter = "Enter",
    Exit = "Exit",
    Board = "Board",
    Search = "Search",
    Climb = "Climb",
    ClimbUp = "Climb-up",
    ClimbDown = "Climb-down",
    ClimbOver = "Climb-over",
    ClimbUnder = "Climb-under",
    Take = "Take",
    Drop = "Drop",
    Wear = "Wear",
    Wield = "Wield",
    Eat = "Eat",
    Drink = "Drink",
}

type SpellSelectionClearHandler = (() => void) | null;
let clearSpellSelectionHandler: SpellSelectionClearHandler = null;
type NpcExamineIdResolver = ((serverId: number) => number | undefined) | null;
let npcExamineIdResolver: NpcExamineIdResolver = null;

export function setSpellSelectionClearHandler(handler: (() => void) | null): void {
    clearSpellSelectionHandler = handler;
}

export function setNpcExamineIdResolver(
    resolver: ((serverId: number) => number | undefined) | null,
): void {
    npcExamineIdResolver = resolver;
}

function clearSpellSelectionWithHandler(): void {
    if (clearSpellSelectionHandler) {
        try {
            clearSpellSelectionHandler();
            return;
        } catch {}
    }
    ClientState.clearSpellSelection();
}

/**
 * Map human-readable option text to a canonical action for stable logic.
 */
export function inferMenuAction(
    option: string | undefined,
    _targetType?: MenuTargetType,
): MenuAction | undefined {
    if (!option) return undefined;
    const s = String(option).trim().toLowerCase();
    switch (s) {
        case "cast":
            return MenuAction.Cast;
        case "use":
            return MenuAction.Use;
        case "walk here":
            return MenuAction.WalkHere;
        case "examine":
        case "inspect":
            return MenuAction.Examine;
        case "cancel":
            return MenuAction.Cancel;
        case "follow":
            return MenuAction.Follow;
        case "trade with":
            return MenuAction.TradeWith;
        case "attack":
            return MenuAction.Attack;
        case "talk-to":
            return MenuAction.TalkTo;
        case "open":
            return MenuAction.Open;
        case "close":
            return MenuAction.Close;
        case "enter":
            return MenuAction.Enter;
        case "exit":
            return MenuAction.Exit;
        case "board":
            return MenuAction.Board;
        case "search":
            return MenuAction.Search;
        case "climb":
            return MenuAction.Climb;
        case "climb-up":
        case "climb up":
            return MenuAction.ClimbUp;
        case "climb-down":
        case "climb down":
            return MenuAction.ClimbDown;
        case "climb-over":
        case "climb over":
            return MenuAction.ClimbOver;
        case "climb-under":
        case "climb under":
            return MenuAction.ClimbUnder;
        case "take":
        case "pick-up":
            return MenuAction.Take;
        case "drop":
            return MenuAction.Drop;
        case "wear":
            return MenuAction.Wear;
        case "wield":
            return MenuAction.Wield;
        case "eat":
            return MenuAction.Eat;
        case "drink":
            return MenuAction.Drink;
        default:
            return undefined;
    }
}

/**
 * Execute a menu action
 *
 * @param arg0 - Usually child index or local X
 * @param arg1 - Usually parent ID or local Y
 * @param opcode - Menu action type (opcode)
 * @param identifier - Entity ID (NPC index, object ID, etc.)
 * @param itemId - Item ID for item operations
 * @param action - Action text
 * @param target - Target text
 * @param screenX - Screen X position of click
 * @param screenY - Screen Y position of click
 */
export function menuAction(
    arg0: number,
    arg1: number,
    opcode: number,
    identifier: number,
    itemId: number,
    action: string,
    target: string,
    screenX: number,
    screenY: number,
): void {
    // Debug logging (off by default): `globalThis.__menuDebug = true`
    try {
        const g: any = (typeof window !== "undefined" ? window : globalThis) as any;
        if (g.__menuDebug === true) {
            // eslint-disable-next-line no-console
            console.log(
                `[MenuAction] opcode=${opcode}, arg0=${arg0}, arg1=${arg1}, identifier=${identifier}, itemId=${itemId}, action="${action}", target="${target}"`,
            );
        }
    } catch {}

    // Handle deprioritized opcodes (>= 2000)
    if (opcode >= 2000) {
        opcode -= 2000;
    }

    // Check ctrl state for running
    const ctrlHeld = ClientState.isCtrlPressed();

    // Helper to set mouse cross and destination
    const setVisualFeedback = (setDest: boolean = true) => {
        ClientState.mouseCrossX = screenX;
        ClientState.mouseCrossY = screenY;
        ClientState.mouseCrossColor = MOUSE_CROSS_YELLOW;
        ClientState.mouseCrossState = 0;
        if (setDest) {
            ClientState.setDestination(arg0, arg1);
        }
    };

    // ========================================
    // WIDGET TARGET (opcode 25) - Select spell/item for targeting
    // ========================================
    if (opcode === MenuOpcode.WidgetTarget) {
        // arg1 = widget ID (parent << 16 | child)
        // arg0 = child index / slot
        // itemId = item ID if selecting an item, -1 for spells
        // identifier = opIndex (which action triggered this)

        // Set up spell/item selection for targeting
        ClientState.isSpellSelected = true;
        ClientState.selectedSpellWidget = arg1;
        ClientState.selectedSpellChildIndex = arg0;
        ClientState.selectedSpellItemId = itemId >= 0 ? itemId : -1;
        ClientState.selectedSpellActionName = action || "Use";
        ClientState.selectedSpellName = target || "";

        // Also set item selection state if this is an item (for rendering outline)
        if (itemId >= 0) {
            ClientState.isItemSelected = 1;
            ClientState.selectedItemWidget = arg1;
            ClientState.selectedItemSlot = arg0;
            ClientState.selectedItemId = itemId;
        } else {
            // Clear item selection if this is a spell
            ClientState.clearItemSelection();
        }

        // Debug logging (off by default): `globalThis.__menuDebug = true`
        try {
            const g: any = (typeof window !== "undefined" ? window : globalThis) as any;
            if (g.__menuDebug === true) {
                const groupId = (arg1 >>> 16) & 0xffff;
                const childId = arg1 & 0xffff;
                // eslint-disable-next-line no-console
                console.log(
                    `[SpellSelect] WidgetTarget triggered: widgetId=${arg1} (group=${groupId}, child=${childId}), slot=${arg0}, action="${action}", target="${target}"`,
                );
            }
        } catch {}

        // Visual feedback - show targeting cursor
        setVisualFeedback(false);
        return;
    }

    // ========================================
    // PLAYER OPCODES (44-51)
    // ========================================

    // OPPLAYER4 (47)
    if (opcode === MenuOpcode.PlayerFourthOption) {
        const player = ClientState.players[identifier];
        if (player != null) {
            setVisualFeedback();
            const pkt = createPacket(ClientPacket.OPPLAYER4);
            pkt.packetBuffer.writeShort(identifier);
            pkt.packetBuffer.writeByteNeg(ctrlHeld ? 1 : 0);
            queuePacket(pkt);
        }
    }

    // OPPLAYER3 (46) - Follow
    if (opcode === MenuOpcode.PlayerThirdOption) {
        const player = ClientState.players[identifier];
        if (player != null) {
            setVisualFeedback();
            const pkt = createPacket(ClientPacket.OPPLAYER3);
            pkt.packetBuffer.writeByteSub(ctrlHeld ? 1 : 0);
            pkt.packetBuffer.writeShort(identifier);
            queuePacket(pkt);
        }
    }

    // OPPLAYER6 (49)
    if (opcode === MenuOpcode.PlayerSixthOption) {
        const player = ClientState.players[identifier];
        if (player != null) {
            setVisualFeedback();
            const pkt = createPacket(ClientPacket.OPPLAYER6);
            pkt.packetBuffer.writeShort(identifier);
            pkt.packetBuffer.writeByteNeg(ctrlHeld ? 1 : 0);
            queuePacket(pkt);
        }
    }

    // OPPLAYER5 (48)
    if (opcode === MenuOpcode.PlayerFifthOption) {
        const player = ClientState.players[identifier];
        if (player != null) {
            setVisualFeedback();
            const pkt = createPacket(ClientPacket.OPPLAYER5);
            pkt.packetBuffer.writeShortAddLE(identifier);
            pkt.packetBuffer.writeByteSub(ctrlHeld ? 1 : 0);
            queuePacket(pkt);
        }
    }

    // OPPLAYER8 (51)
    if (opcode === MenuOpcode.PlayerEighthOption) {
        const player = ClientState.players[identifier];
        if (player != null) {
            setVisualFeedback();
            const pkt = createPacket(ClientPacket.OPPLAYER8);
            pkt.packetBuffer.writeByte(ctrlHeld ? 1 : 0);
            pkt.packetBuffer.writeShortAdd(identifier);
            queuePacket(pkt);
        }
    }

    // OPPLAYER1 (44) - Attack
    if (opcode === MenuOpcode.PlayerFirstOption) {
        const player = ClientState.players[identifier];
        if (player != null) {
            setVisualFeedback();
            const pkt = createPacket(ClientPacket.OPPLAYER1);
            pkt.packetBuffer.writeByteSub(ctrlHeld ? 1 : 0);
            pkt.packetBuffer.writeShort(identifier);
            queuePacket(pkt);
        }
    }

    // OPPLAYER2 (45) - Trade
    if (opcode === MenuOpcode.PlayerSecondOption) {
        const player = ClientState.players[identifier];
        if (player != null) {
            setVisualFeedback();
            const pkt = createPacket(ClientPacket.OPPLAYER2);
            pkt.packetBuffer.writeByte(ctrlHeld ? 1 : 0);
            pkt.packetBuffer.writeShort(identifier);
            queuePacket(pkt);
        }
    }

    // OPPLAYER7 (50)
    if (opcode === MenuOpcode.PlayerSeventhOption) {
        const player = ClientState.players[identifier];
        if (player != null) {
            setVisualFeedback();
            const pkt = createPacket(ClientPacket.OPPLAYER7);
            pkt.packetBuffer.writeShortAdd(identifier);
            pkt.packetBuffer.writeByteSub(ctrlHeld ? 1 : 0);
            queuePacket(pkt);
        }
    }

    // ========================================
    // NPC OPCODES (9-13)
    // ========================================

    // NPC options 1-5: Send via high-level sendNpcInteract with the action text
    // instead of raw OPNPC binary packets. This ensures the server receives the
    // option string directly and avoids relying on server-side opNum resolution.
    if (
        opcode === MenuOpcode.NpcFirstOption ||
        opcode === MenuOpcode.NpcSecondOption ||
        opcode === MenuOpcode.NpcThirdOption ||
        opcode === MenuOpcode.NpcFourthOption ||
        opcode === MenuOpcode.NpcFifthOption
    ) {
        const npc = ClientState.npcs[identifier];
        if (npc != null) {
            setVisualFeedback();
            sendNpcInteract(identifier, action);
        }
    }

    // ========================================
    // OBJECT/LOCATION OPCODES (1-6, 1001)
    // ========================================

    // OPLOC1 (3)
    if (opcode === MenuOpcode.GameObjectFirstOption) {
        setVisualFeedback();
        const worldY = (ClientState.baseY | 0) + (arg1 | 0);
        const worldX = (ClientState.baseX | 0) + (arg0 | 0);
        const pkt = createPacket(ClientPacket.OPLOC1);
        pkt.packetBuffer.writeShortAdd(worldX);
        pkt.packetBuffer.writeShortLE(worldY);
        pkt.packetBuffer.writeByteNeg(ctrlHeld ? 1 : 0);
        pkt.packetBuffer.writeShortAddLE(identifier);
        queuePacket(pkt);
    }

    // OPLOC2 (4)
    if (opcode === MenuOpcode.GameObjectSecondOption) {
        setVisualFeedback();
        const worldY = (ClientState.baseY | 0) + (arg1 | 0);
        const worldX = (ClientState.baseX | 0) + (arg0 | 0);
        const pkt = createPacket(ClientPacket.OPLOC2);
        pkt.packetBuffer.writeShortAddLE(worldX);
        pkt.packetBuffer.writeShortAddLE(worldY);
        pkt.packetBuffer.writeByteSub(ctrlHeld ? 1 : 0);
        pkt.packetBuffer.writeShort(identifier);
        queuePacket(pkt);
    }

    // OPLOC3 (5)
    if (opcode === MenuOpcode.GameObjectThirdOption) {
        setVisualFeedback();
        const worldY = (ClientState.baseY | 0) + (arg1 | 0);
        const worldX = (ClientState.baseX | 0) + (arg0 | 0);
        const pkt = createPacket(ClientPacket.OPLOC3);
        pkt.packetBuffer.writeShortLE(worldY);
        pkt.packetBuffer.writeShortLE(identifier);
        pkt.packetBuffer.writeShortAddLE(worldX);
        pkt.packetBuffer.writeByteSub(ctrlHeld ? 1 : 0);
        queuePacket(pkt);
    }

    // OPLOC4 (6)
    if (opcode === MenuOpcode.GameObjectFourthOption) {
        setVisualFeedback();
        const worldY = (ClientState.baseY | 0) + (arg1 | 0);
        const worldX = (ClientState.baseX | 0) + (arg0 | 0);
        const pkt = createPacket(ClientPacket.OPLOC4);
        pkt.packetBuffer.writeShortAdd(worldX);
        pkt.packetBuffer.writeShortLE(identifier);
        pkt.packetBuffer.writeShortAdd(worldY);
        pkt.packetBuffer.writeByteNeg(ctrlHeld ? 1 : 0);
        queuePacket(pkt);
    }

    // OPLOC5 (1001)
    if (opcode === MenuOpcode.GameObjectFifthOption) {
        setVisualFeedback();
        const worldY = (ClientState.baseY | 0) + (arg1 | 0);
        const worldX = (ClientState.baseX | 0) + (arg0 | 0);
        const pkt = createPacket(ClientPacket.OPLOC5);
        pkt.packetBuffer.writeShort(worldX);
        pkt.packetBuffer.writeByteAdd(ctrlHeld ? 1 : 0);
        pkt.packetBuffer.writeShortAdd(worldY);
        pkt.packetBuffer.writeShortAdd(identifier);
        queuePacket(pkt);
    }

    // ========================================
    // GROUND ITEM OPCODES (18-22)
    // ========================================

    // OPOBJ1 (18)
    if (opcode === MenuOpcode.GroundItemFirstOption) {
        setVisualFeedback();
        const worldY = (ClientState.baseY | 0) + (arg1 | 0);
        const worldX = (ClientState.baseX | 0) + (arg0 | 0);
        const pkt = createPacket(ClientPacket.OPOBJ1);
        pkt.packetBuffer.writeByteSub(ctrlHeld ? 1 : 0);
        pkt.packetBuffer.writeShortLE(worldY);
        pkt.packetBuffer.writeShortAdd(identifier);
        pkt.packetBuffer.writeShortAdd(worldX);
        queuePacket(pkt);
    }

    // OPOBJ2 (19)
    if (opcode === MenuOpcode.GroundItemSecondOption) {
        setVisualFeedback();
        const worldY = (ClientState.baseY | 0) + (arg1 | 0);
        const worldX = (ClientState.baseX | 0) + (arg0 | 0);
        const pkt = createPacket(ClientPacket.OPOBJ2);
        pkt.packetBuffer.writeShortAdd(worldX);
        pkt.packetBuffer.writeShortLE(worldY);
        pkt.packetBuffer.writeShort(identifier);
        pkt.packetBuffer.writeByte(ctrlHeld ? 1 : 0);
        queuePacket(pkt);
    }

    // OPOBJ3 (20)
    if (opcode === MenuOpcode.GroundItemThirdOption) {
        setVisualFeedback();
        const worldY = (ClientState.baseY | 0) + (arg1 | 0);
        const worldX = (ClientState.baseX | 0) + (arg0 | 0);
        const pkt = createPacket(ClientPacket.OPOBJ3);
        pkt.packetBuffer.writeShortLE(identifier);
        pkt.packetBuffer.writeShortAdd(worldX);
        pkt.packetBuffer.writeShortAddLE(worldY);
        pkt.packetBuffer.writeByteSub(ctrlHeld ? 1 : 0);
        queuePacket(pkt);
    }

    // OPOBJ4 (21)
    if (opcode === MenuOpcode.GroundItemFourthOption) {
        setVisualFeedback();
        const worldY = (ClientState.baseY | 0) + (arg1 | 0);
        const worldX = (ClientState.baseX | 0) + (arg0 | 0);
        const pkt = createPacket(ClientPacket.OPOBJ4);
        pkt.packetBuffer.writeShortAddLE(identifier);
        pkt.packetBuffer.writeShortAddLE(worldY);
        pkt.packetBuffer.writeByteNeg(ctrlHeld ? 1 : 0);
        pkt.packetBuffer.writeShortAdd(worldX);
        queuePacket(pkt);
    }

    // OPOBJ5 (22)
    if (opcode === MenuOpcode.GroundItemFifthOption) {
        setVisualFeedback();
        const worldY = (ClientState.baseY | 0) + (arg1 | 0);
        const worldX = (ClientState.baseX | 0) + (arg0 | 0);
        const pkt = createPacket(ClientPacket.OPOBJ5);
        pkt.packetBuffer.writeShortAdd(identifier);
        pkt.packetBuffer.writeShortLE(worldX);
        pkt.packetBuffer.writeShortLE(worldY);
        pkt.packetBuffer.writeByteSub(ctrlHeld ? 1 : 0);
        queuePacket(pkt);
    }

    // ========================================
    // ITEM USE ON TARGET OPCODES (1, 2, 7, 14, 16, 17)
    // ========================================

    // OPLOCU (1) - Item use on object
    if (opcode === MenuOpcode.ItemUseOnGameObject) {
        setVisualFeedback();
        const worldY = (ClientState.baseY | 0) + (arg1 | 0);
        const worldX = (ClientState.baseX | 0) + (arg0 | 0);
        const pkt = createPacket(ClientPacket.OPLOCU);
        pkt.packetBuffer.writeShortAddLE(ClientState.selectedItemSlot);
        pkt.packetBuffer.writeShortAdd(identifier);
        pkt.packetBuffer.writeIntLE(ClientState.selectedItemWidget);
        pkt.packetBuffer.writeByteSub(ctrlHeld ? 1 : 0);
        pkt.packetBuffer.writeShortLE(worldX);
        pkt.packetBuffer.writeShort(worldY);
        pkt.packetBuffer.writeShortAddLE(ClientState.selectedItemId);
        queuePacket(pkt);
    }

    // OPLOCT (2) - Widget target on object
    if (opcode === MenuOpcode.WidgetTargetOnGameObject) {
        setVisualFeedback();
        const worldY = (ClientState.baseY | 0) + (arg1 | 0);
        const worldX = (ClientState.baseX | 0) + (arg0 | 0);
        const pkt = createPacket(ClientPacket.OPLOCT);
        pkt.packetBuffer.writeShortAddLE(worldY);
        pkt.packetBuffer.writeShortAdd(identifier);
        pkt.packetBuffer.writeShortAdd(ClientState.selectedSpellChildIndex);
        pkt.packetBuffer.writeIntLE(ClientState.selectedSpellWidget);
        pkt.packetBuffer.writeShort(worldX);
        pkt.packetBuffer.writeShortLE(ClientState.selectedSpellItemId);
        pkt.packetBuffer.writeByteNeg(ctrlHeld ? 1 : 0);
        queuePacket(pkt);
    }

    // OPNPCU (7) - Item use on NPC
    if (opcode === MenuOpcode.ItemUseOnNpc) {
        const npc = ClientState.npcs[identifier];
        if (npc != null) {
            setVisualFeedback();
            const pkt = createPacket(ClientPacket.OPNPCU);
            pkt.packetBuffer.writeShortAddLE(ClientState.selectedItemSlot);
            pkt.packetBuffer.writeByte(ctrlHeld ? 1 : 0);
            pkt.packetBuffer.writeIntME(ClientState.selectedItemWidget);
            pkt.packetBuffer.writeShortLE(ClientState.selectedItemId);
            pkt.packetBuffer.writeShortAddLE(identifier);
            queuePacket(pkt);
        }
    }

    // OPNPCT (8) - Widget target on NPC
    if (opcode === MenuOpcode.WidgetTargetOnNpc) {
        const npc = ClientState.npcs[identifier];
        if (npc != null) {
            setVisualFeedback();
            const pkt = createPacket(ClientPacket.OPNPCT);
            pkt.packetBuffer.writeShort(identifier);
            pkt.packetBuffer.writeIntLE(ClientState.selectedSpellWidget);
            pkt.packetBuffer.writeShort(ClientState.selectedSpellChildIndex);
            pkt.packetBuffer.writeShortAdd(ClientState.selectedSpellItemId);
            pkt.packetBuffer.writeByteAdd(ctrlHeld ? 1 : 0);
            queuePacket(pkt);
        }
    }

    // OPPLAYERU (14) - Item use on player
    if (opcode === MenuOpcode.ItemUseOnPlayer) {
        const player = ClientState.players[identifier];
        if (player != null) {
            setVisualFeedback();
            const pkt = createPacket(ClientPacket.OPPLAYERU);
            pkt.packetBuffer.writeShortAddLE(identifier);
            pkt.packetBuffer.writeShortAddLE(ClientState.selectedItemId);
            pkt.packetBuffer.writeShortAdd(ClientState.selectedItemSlot);
            pkt.packetBuffer.writeInt(ClientState.selectedItemWidget);
            pkt.packetBuffer.writeByteAdd(ctrlHeld ? 1 : 0);
            queuePacket(pkt);
        }
    }

    // OPPLAYERT (15) - Widget target on player
    if (opcode === MenuOpcode.WidgetTargetOnPlayer) {
        const player = ClientState.players[identifier];
        if (player != null) {
            setVisualFeedback();
            const pkt = createPacket(ClientPacket.OPPLAYERT);
            pkt.packetBuffer.writeByteNeg(ctrlHeld ? 1 : 0);
            pkt.packetBuffer.writeShortLE(ClientState.selectedSpellItemId);
            pkt.packetBuffer.writeShortLE(ClientState.selectedSpellChildIndex);
            pkt.packetBuffer.writeIntIME(ClientState.selectedSpellWidget);
            pkt.packetBuffer.writeShortLE(identifier);
            queuePacket(pkt);
        }
    }

    // OPOBJU (16) - Item use on ground item
    if (opcode === MenuOpcode.ItemUseOnGroundItem) {
        setVisualFeedback();
        const worldY = (ClientState.baseY | 0) + (arg1 | 0);
        const worldX = (ClientState.baseX | 0) + (arg0 | 0);
        const pkt = createPacket(ClientPacket.OPOBJU);
        pkt.packetBuffer.writeShortAddLE(identifier);
        pkt.packetBuffer.writeShortAdd(worldY);
        pkt.packetBuffer.writeIntME(ClientState.selectedItemWidget);
        pkt.packetBuffer.writeShortAdd(worldX);
        pkt.packetBuffer.writeShortAddLE(ClientState.selectedItemSlot);
        pkt.packetBuffer.writeByteSub(ctrlHeld ? 1 : 0);
        pkt.packetBuffer.writeShortLE(ClientState.selectedItemId);
        queuePacket(pkt);
    }

    // OPOBJT (17) - Widget target on ground item
    if (opcode === MenuOpcode.WidgetTargetOnGroundItem) {
        setVisualFeedback();
        const worldY = (ClientState.baseY | 0) + (arg1 | 0);
        const worldX = (ClientState.baseX | 0) + (arg0 | 0);
        const pkt = createPacket(ClientPacket.OPOBJT);
        pkt.packetBuffer.writeIntLE(ClientState.selectedSpellWidget);
        pkt.packetBuffer.writeShortAdd(ClientState.selectedSpellChildIndex);
        pkt.packetBuffer.writeShortAdd(identifier);
        pkt.packetBuffer.writeShortAddLE(worldX);
        pkt.packetBuffer.writeShort(worldY);
        pkt.packetBuffer.writeByte(ctrlHeld ? 1 : 0);
        pkt.packetBuffer.writeShortAddLE(ClientState.selectedSpellItemId);
        queuePacket(pkt);
    }

    // ========================================
    // WALK HERE (23) - MOVE_GAMECLICK
    // ========================================
    if (opcode === MenuOpcode.WalkHere) {
        // Visual feedback (cross) is handled by spawnClickCross in WebGLOsrsRenderer

        // arg0/arg1 for WalkHere are local (scene) tile coords (0..103).
        const localX = arg0 | 0;
        const localY = arg1 | 0;
        const worldX = (ClientState.baseX | 0) + localX;
        const worldY = (ClientState.baseY | 0) + localY;
        const modifierFlags = ctrlHeld
            ? ClientState.isShiftPressed()
                ? MODIFIER_FLAG_CTRL_SHIFT
                : MODIFIER_FLAG_CTRL
            : 0;

        // Set destination marker for minimap flag
        ClientState.setDestination(localX, localY);

        // Send MOVE_GAMECLICK packet
        // Format: shortAddLE(y), byteNeg(modifierFlags), shortAddLE(x), shortAdd(objectId)
        // objectId is 0 for simple walk-here
        const pkt = createPacket(ClientPacket.MOVE_GAMECLICK);
        pkt.packetBuffer.writeShortAddLE(worldY);
        pkt.packetBuffer.writeByteNeg(modifierFlags);
        pkt.packetBuffer.writeShortAddLE(worldX);
        pkt.packetBuffer.writeShortAdd(0); // No target object
        queuePacket(pkt);
    }

    // ========================================
    // WIDGET OPCODES (24, 26, 28, 29, 30, 57, 58, 1007)
    // ========================================

    // WIDGET_TYPE1 (24) - Content-dependent click
    // Used for widgets with contentType that determines behavior (equipment slots, etc.)
    // Sends IF_BUTTON with just widget ID (4 bytes)
    if (opcode === MenuOpcode.WidgetType1) {
        // arg1 = widget ID (parent << 16 | child)
        const pkt = createPacket(ClientPacket.IF_BUTTON);
        pkt.packetBuffer.writeInt(arg1); // widget ID only
        queuePacket(pkt);
    }

    // WIDGET_CLOSE (26) - Close interface
    // Sends IF_CLOSE with NO payload
    if (opcode === MenuOpcode.WidgetClose) {
        // Send IF_CLOSE packet with no payload
        const pkt = createPacket(ClientPacket.IF_CLOSE);
        queuePacket(pkt);

        // Clear any modal/overlay state
        ClientState.isSpellSelected = false;
        ClientState.isItemSelected = 0;

        // Note: Also closes interfaces locally and clears meslayerContinueWidget -
        // that should be handled by the widget system
    }

    // WIDGET_TYPE4 (28) - Toggle setting (toggles varp between 0 and 1)
    // Used for checkbox-style settings (Accept Aid, Hide Roofs, etc.)
    // Sends IF_BUTTON with just widget ID (4 bytes)
    // Also locally toggles varp
    if (opcode === MenuOpcode.WidgetType4) {
        // arg1 = widget ID
        const pkt = createPacket(ClientPacket.IF_BUTTON);
        pkt.packetBuffer.writeInt(arg1);
        queuePacket(pkt);
        // Note: Local varp toggle should be handled by widget system based on CS1 instructions
    }

    // WIDGET_TYPE5 (29) - Set specific value (radio button / slider notch style)
    // Used for settings that set a specific varp value
    // Sends IF_BUTTON with just widget ID (4 bytes)
    // Also locally sets varp to specific value from cs1ComparisonValues
    if (opcode === MenuOpcode.WidgetType5) {
        // arg1 = widget ID
        const pkt = createPacket(ClientPacket.IF_BUTTON);
        pkt.packetBuffer.writeInt(arg1);
        queuePacket(pkt);
        // Note: Local varp setting should be handled by widget system based on CS1 instructions
    }

    // WIDGET_CONTINUE (30) - Dialog continue button
    if (opcode === MenuOpcode.WidgetContinue) {
        // arg1 = widget ID (parent << 16 | child)
        // arg0 = child index within dialog
        // Format: writeShortAddLE(childIndex), writeInt(widgetId)
        const pkt = createPacket(ClientPacket.RESUME_PAUSEBUTTON);
        pkt.packetBuffer.writeShortAddLE(arg0); // childIndex
        pkt.packetBuffer.writeInt(arg1); // widgetId
        queuePacket(pkt);
    }

    // CC_OP (57, 1007) - Child component operation
    // This is the main widget click handler
    // Sends IF_BUTTON1-10 based on opIndex with full 8-byte format
    if (opcode === MenuOpcode.CC_OP || opcode === MenuOpcode.CC_OP_LowPriority) {
        // Parameters:
        // identifier = opIndex (1-10 for which button option)
        // arg1 = widget ID (parent << 16 | child)
        // arg0 = slot/child index
        // itemId = item ID if inventory slot (-1 otherwise)

        const opIndex = identifier;
        if (opIndex >= 1 && opIndex <= 10) {
            // Select the correct IF_BUTTON packet based on opIndex
            // Each IF_BUTTON1-10 has same format: int(widgetId), short(slot), short(itemId)
            let packetType: number;
            switch (opIndex) {
                case 1:
                    packetType = ClientPacket.IF_BUTTON1;
                    break;
                case 2:
                    packetType = ClientPacket.IF_BUTTON2;
                    break;
                case 3:
                    packetType = ClientPacket.IF_BUTTON3;
                    break;
                case 4:
                    packetType = ClientPacket.IF_BUTTON4;
                    break;
                case 5:
                    packetType = ClientPacket.IF_BUTTON5;
                    break;
                case 6:
                    packetType = ClientPacket.IF_BUTTON6;
                    break;
                case 7:
                    packetType = ClientPacket.IF_BUTTON7;
                    break;
                case 8:
                    packetType = ClientPacket.IF_BUTTON8;
                    break;
                case 9:
                    packetType = ClientPacket.IF_BUTTON9;
                    break;
                case 10:
                    packetType = ClientPacket.IF_BUTTON10;
                    break;
                default:
                    packetType = ClientPacket.IF_BUTTON1;
                    break;
            }

            const pkt = createPacket(packetType);
            pkt.packetBuffer.writeInt(arg1); // widget ID
            pkt.packetBuffer.writeShort(arg0); // slot/child index
            pkt.packetBuffer.writeShort(itemId >= 0 ? itemId : -1); // item ID
            queuePacket(pkt);
        }
    }

    // WIDGET_TARGET_ON_WIDGET (58) - Spell/item use on widget
    // Used when casting a spell on an interface item or using item on interface
    if (opcode === MenuOpcode.WidgetTargetOnWidget) {
        // arg1 = target widget ID
        // arg0 = target slot/child index
        // itemId = target item ID
        // selectedSpell* = source spell/item selection

        setVisualFeedback(false);
        const pkt = createPacket(ClientPacket.IF_BUTTONT);
        pkt.packetBuffer.writeIntIME(arg1); // target widget ID
        pkt.packetBuffer.writeShortAddLE(arg0); // target slot
        pkt.packetBuffer.writeIntLE(ClientState.selectedSpellWidget); // source widget ID
        pkt.packetBuffer.writeShortLE(ClientState.selectedSpellChildIndex); // source slot
        pkt.packetBuffer.writeShort(ClientState.selectedSpellItemId); // source item ID
        pkt.packetBuffer.writeShortAddLE(itemId >= 0 ? itemId : -1); // target item ID
        queuePacket(pkt);
    }

    // ========================================
    // EXAMINE OPCODES (1002, 1003, 1004)
    // ========================================

    // EXAMINE_LOC (1002)
    if (opcode === MenuOpcode.ExamineObject) {
        setVisualFeedback(false);
        const pkt = createPacket(ClientPacket.EXAMINE_LOC);
        pkt.packetBuffer.writeShortAddLE(identifier);
        queuePacket(pkt);
    }

    // EXAMINE_NPC (1003)
    if (opcode === MenuOpcode.ExamineNpc) {
        setVisualFeedback(false);
        const examineNpcId =
            npcExamineIdResolver?.(identifier) ?? (Number.isFinite(identifier) ? identifier : -1);
        if (examineNpcId >= 0) {
            const pkt = createPacket(ClientPacket.EXAMINE_NPC);
            pkt.packetBuffer.writeShortAdd(examineNpcId);
            queuePacket(pkt);
        }
    }

    // EXAMINE_OBJ (1004) - Ground item
    if (opcode === MenuOpcode.ExamineGroundItem) {
        setVisualFeedback(false);
        const worldY = (ClientState.baseY | 0) + (arg1 | 0);
        const worldX = (ClientState.baseX | 0) + (arg0 | 0);
        const pkt = createPacket(ClientPacket.EXAMINE_OBJ);
        pkt.packetBuffer.writeShort(identifier);
        pkt.packetBuffer.writeShortLE(worldY);
        pkt.packetBuffer.writeShortLE(worldX);
        queuePacket(pkt);
    }

    // ========================================
    // WORLD MAP OPCODES (1008-1012)
    // ========================================
    if (opcode >= MenuOpcode.WorldMap1 && opcode <= MenuOpcode.WorldMap5) {
        // World map menu action - handled by world map system
    }

    // ========================================
    // CANCEL (1006)
    // ========================================
    if (opcode === MenuOpcode.Cancel) {
        // Just closes menu, no packet sent
    }

    // ========================================
    // USE ITEM (38) - Select item for targeting (like "Use" on inventory item)
    // ========================================
    if (opcode === MenuOpcode.UseItem) {
        // arg1 = widget ID (parent << 16 | child) - the inventory container widget
        // arg0 = child index / slot
        // itemId = item ID of the selected item

        // Enter item selection/targeting mode
        ClientState.isItemSelected = 1;
        ClientState.selectedItemWidget = arg1;
        ClientState.selectedItemSlot = arg0;
        ClientState.selectedItemId = itemId;

        // Also set spell selection state for display purposes
        ClientState.isSpellSelected = true;
        ClientState.selectedSpellWidget = arg1;
        ClientState.selectedSpellChildIndex = arg0;
        ClientState.selectedSpellItemId = itemId;
        ClientState.selectedSpellActionName = action || "Use";
        ClientState.selectedSpellName = target || "";
        // Item "Use" can target all standard target types.
        ClientState.selectedSpellTargetMask = 0x3f;

        const groupId = (arg1 >>> 16) & 0xffff;
        const childId = arg1 & 0xffff;
        console.log(
            `[ItemSelect] UseItem triggered: widgetId=${arg1} (group=${groupId}, child=${childId}), slot=${arg0}, itemId=${itemId}, action="${action}", target="${target}"`,
        );

        // Don't clear selection state - return early
        setVisualFeedback(false);
        return;
    }

    // ========================================
    // CLEANUP - Clear item/spell selection
    // ========================================
    if (ClientState.isItemSelected !== 0) {
        ClientState.isItemSelected = 0;
        // invalidateWidget(selectedItemWidget)
    }

    // after any non-selection menu action, spell selection is cleared.
    // (Opcode 25/38 return early above when entering selection modes.)
    if (ClientState.isSpellSelected) {
        clearSpellSelectionWithHandler();
    }
}

/**
 * Convenience wrapper that invokes menuAction from MenuState entry data
 */
export function invokeMenuAction(
    entry: {
        action: string;
        target: string;
        opcode: number;
        identifier: number;
        arg1: number;
        arg2: number;
        itemId: number;
    },
    screenX: number,
    screenY: number,
): void {
    menuAction(
        entry.arg1, // arg0 (often local X or widget child)
        entry.arg2, // arg1 (often local Y or widget parent)
        entry.opcode,
        entry.identifier,
        entry.itemId,
        entry.action,
        entry.target,
        screenX,
        screenY,
    );
}
