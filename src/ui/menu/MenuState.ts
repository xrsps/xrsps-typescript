import { MenuTargetType } from "../../rs/MenuEntry";
import { MenuAction, menuAction } from "./MenuAction";
import type { MenuClickContext } from "./MenuEngine";

/**
 * Menu opcodes matching OSRS reference client (class31.java menuAction)
 *
 * These are the action type identifiers used when processing menu clicks.
 * Opcodes >= 2000 are deprioritized versions (subtract 2000 to get actual opcode).
 */
export enum MenuOpcode {
    Custom = 0,

    // ========================================
    // LOCATION/OBJECT OPCODES (1-6, 1001)
    // ========================================
    /** Item use on game object */
    ItemUseOnGameObject = 1,
    /** Widget target on game object (spell on object) */
    WidgetTargetOnGameObject = 2,
    /** Object option 1 (primary) */
    GameObjectFirstOption = 3,
    /** Object option 2 */
    GameObjectSecondOption = 4,
    /** Object option 3 */
    GameObjectThirdOption = 5,
    /** Object option 4 */
    GameObjectFourthOption = 6,
    /** Object option 5 */
    GameObjectFifthOption = 1001,

    // ========================================
    // NPC OPCODES (7-13)
    // ========================================
    /** Item use on NPC */
    ItemUseOnNpc = 7,
    /** Widget target on NPC (spell on NPC) */
    WidgetTargetOnNpc = 8,
    /** NPC option 1 */
    NpcFirstOption = 9,
    /** NPC option 2 */
    NpcSecondOption = 10,
    /** NPC option 3 */
    NpcThirdOption = 11,
    /** NPC option 4 */
    NpcFourthOption = 12,
    /** NPC option 5 */
    NpcFifthOption = 13,

    // ========================================
    // PLAYER OPCODES (14-15, 44-51)
    // ========================================
    /** Item use on player */
    ItemUseOnPlayer = 14,
    /** Widget target on player (spell on player) */
    WidgetTargetOnPlayer = 15,
    /** Player option 1 (usually Attack) */
    PlayerFirstOption = 44,
    /** Player option 2 (usually Trade) */
    PlayerSecondOption = 45,
    /** Player option 3 (usually Follow) */
    PlayerThirdOption = 46,
    /** Player option 4 */
    PlayerFourthOption = 47,
    /** Player option 5 */
    PlayerFifthOption = 48,
    /** Player option 6 */
    PlayerSixthOption = 49,
    /** Player option 7 */
    PlayerSeventhOption = 50,
    /** Player option 8 */
    PlayerEighthOption = 51,

    // ========================================
    // GROUND ITEM OPCODES (16-22)
    // ========================================
    /** Item use on ground item */
    ItemUseOnGroundItem = 16,
    /** Widget target on ground item */
    WidgetTargetOnGroundItem = 17,
    /** Ground item option 1 (usually Take) */
    GroundItemFirstOption = 18,
    /** Ground item option 2 */
    GroundItemSecondOption = 19,
    /** Ground item option 3 */
    GroundItemThirdOption = 20,
    /** Ground item option 4 */
    GroundItemFourthOption = 21,
    /** Ground item option 5 */
    GroundItemFifthOption = 22,

    // ========================================
    // MOVEMENT/WALK OPCODES (23)
    // ========================================
    /** Walk here */
    WalkHere = 23,

    // ========================================
    // WIDGET OPCODES (24-30, 39-43, 57, 58, 1007)
    // ========================================
    /** Widget type 1 - content-dependent click */
    WidgetType1 = 24,
    /** Widget target - select spell/item for targeting */
    WidgetTarget = 25,
    /** Widget close - close interface */
    WidgetClose = 26,
    /** Widget type 4 - toggle setting (set) */
    WidgetType4 = 28,
    /** Widget type 5 - toggle setting (toggle) */
    WidgetType5 = 29,
    /** Widget continue - dialog continue */
    WidgetContinue = 30,
    /** Item use on item (deprecated) */
    ItemUseOnItem = 31,
    /** Widget use on item (deprecated) */
    WidgetUseOnItem = 32,
    /** Item option 1 (deprecated) */
    ItemFirstOption = 33,
    /** Item option 2 (deprecated) */
    ItemSecondOption = 34,
    /** Item option 3 (deprecated) */
    ItemThirdOption = 35,
    /** Item option 4 (deprecated) */
    ItemFourthOption = 36,
    /** Item option 5 (deprecated) */
    ItemFifthOption = 37,
    /** Item use (select item for targeting) */
    UseItem = 38,
    /** Widget option 1 */
    WidgetFirstOption = 39,
    /** Widget option 2 */
    WidgetSecondOption = 40,
    /** Widget option 3 */
    WidgetThirdOption = 41,
    /** Widget option 4 */
    WidgetFourthOption = 42,
    /** Widget option 5 */
    WidgetFifthOption = 43,
    /** CC_OP - Child component operation (normal priority) */
    CC_OP = 57,
    /** Widget target on widget (spell on widget) */
    WidgetTargetOnWidget = 58,
    /** CC_OP - Child component operation (low priority) */
    CC_OP_LowPriority = 1007,

    // ========================================
    // EXAMINE OPCODES (1002-1005)
    // ========================================
    /** Examine object/location */
    ExamineObject = 1002,
    /** Examine NPC */
    ExamineNpc = 1003,
    /** Examine ground item */
    ExamineGroundItem = 1004,
    /** Examine inventory item (deprecated) */
    ExamineInventoryItem = 1005,

    // ========================================
    // SYSTEM OPCODES (1006, 1008-1012)
    // ========================================
    /** Cancel menu */
    Cancel = 1006,
    /** World map option 1 */
    WorldMap1 = 1008,
    /** World map option 2 */
    WorldMap2 = 1009,
    /** World map option 3 */
    WorldMap3 = 1010,
    /** World map option 4 */
    WorldMap4 = 1011,
    /** World map option 5 */
    WorldMap5 = 1012,

    // Legacy aliases
    Widget = 25,
    SpellCast = 58,
}

/**
 * Menu entry row data for adding to MenuState
 */
export type MenuStateRow = {
    /** Menu option text (e.g., "Attack", "Talk-to") */
    option: string;
    /** Target description (e.g., NPC name, object name) */
    target?: string;
    /** Canonical menu action enum */
    action?: MenuAction;
    /** Target type (NPC, LOC, OBJ, PLAYER) */
    targetType?: MenuTargetType;
    /** Target entity ID (NPC index, loc ID, etc.) */
    targetId?: number;
    /** Map X coordinate */
    mapX?: number;
    /** Map Y coordinate */
    mapY?: number;
    /** Player server ID (for player interactions) */
    playerServerId?: number;
    /** Action index (0-4 for entity options) */
    actionIndex?: number;
    /** Explicit opcode override */
    opcode?: number;
    /** Item ID (for item operations) */
    itemId?: number;
    /** Whether shift-click forces left-click */
    shiftClick?: boolean;
    /** Argument 0 (usually targetId) */
    arg0?: number;
    /** Argument 1 (usually mapX or widget parent) */
    arg1?: number;
    /** Argument 2 (usually mapY or widget child) */
    arg2?: number;
    /** Click handler callback */
    handler?: (gx?: number, gy?: number, ctx?: MenuClickContext) => void;
};

function inferOpcode(row: MenuStateRow): number {
    if (typeof row.opcode === "number") return row.opcode;
    const { action, targetType, actionIndex } = row;
    // Exact casts/uses routed by target type
    if (action === MenuAction.WalkHere) return MenuOpcode.WalkHere;
    if (action === MenuAction.Cancel) return MenuOpcode.Cancel;
    if (action === MenuAction.Examine) {
        switch (targetType) {
            case MenuTargetType.NPC:
                return MenuOpcode.ExamineNpc;
            case MenuTargetType.LOC:
                return MenuOpcode.ExamineObject;
            case MenuTargetType.OBJ:
                return MenuOpcode.ExamineGroundItem;
            default:
                return MenuOpcode.ExamineInventoryItem;
        }
    }
    if (action === MenuAction.Cast) {
        switch (targetType) {
            case MenuTargetType.NPC:
                return MenuOpcode.WidgetTargetOnNpc;
            case MenuTargetType.LOC:
                return MenuOpcode.WidgetTargetOnGameObject;
            case MenuTargetType.OBJ:
                return MenuOpcode.WidgetTargetOnGroundItem;
            case MenuTargetType.PLAYER:
                return MenuOpcode.WidgetTargetOnPlayer;
            default:
                return MenuOpcode.SpellCast;
        }
    }
    if (action === MenuAction.Use) {
        switch (targetType) {
            case MenuTargetType.NPC:
                return MenuOpcode.ItemUseOnNpc;
            case MenuTargetType.LOC:
                return MenuOpcode.ItemUseOnGameObject;
            case MenuTargetType.OBJ:
                return MenuOpcode.ItemUseOnGroundItem;
            case MenuTargetType.PLAYER:
                return MenuOpcode.ItemUseOnPlayer;
            default:
                return MenuOpcode.UseItem;
        }
    }
    if (targetType === MenuTargetType.NPC) {
        switch (actionIndex) {
            case 0:
                return MenuOpcode.NpcFirstOption;
            case 1:
                return MenuOpcode.NpcSecondOption;
            case 2:
                return MenuOpcode.NpcThirdOption;
            case 3:
                return MenuOpcode.NpcFourthOption;
            case 4:
                return MenuOpcode.NpcFifthOption;
            default:
                return MenuOpcode.NpcFirstOption;
        }
    }
    if (targetType === MenuTargetType.LOC) {
        switch (actionIndex) {
            case 0:
                return MenuOpcode.GameObjectFirstOption;
            case 1:
                return MenuOpcode.GameObjectSecondOption;
            case 2:
                return MenuOpcode.GameObjectThirdOption;
            case 3:
                return MenuOpcode.GameObjectFourthOption;
            case 4:
                return MenuOpcode.GameObjectFifthOption;
            default:
                return MenuOpcode.GameObjectFirstOption;
        }
    }
    if (targetType === MenuTargetType.OBJ) {
        switch (actionIndex) {
            case 0:
                return MenuOpcode.GroundItemFirstOption;
            case 1:
                return MenuOpcode.GroundItemSecondOption;
            case 2:
                return MenuOpcode.GroundItemThirdOption;
            case 3:
                return MenuOpcode.GroundItemFourthOption;
            case 4:
                return MenuOpcode.GroundItemFifthOption;
            default:
                return MenuOpcode.GroundItemFirstOption;
        }
    }
    if (targetType === MenuTargetType.PLAYER) {
        // First check if we have an explicit actionIndex (0-7 for player options)
        if (typeof actionIndex === "number" && actionIndex >= 0 && actionIndex <= 7) {
            switch (actionIndex) {
                case 0:
                    return MenuOpcode.PlayerFirstOption;
                case 1:
                    return MenuOpcode.PlayerSecondOption;
                case 2:
                    return MenuOpcode.PlayerThirdOption;
                case 3:
                    return MenuOpcode.PlayerFourthOption;
                case 4:
                    return MenuOpcode.PlayerFifthOption;
                case 5:
                    return MenuOpcode.PlayerSixthOption;
                case 6:
                    return MenuOpcode.PlayerSeventhOption;
                case 7:
                    return MenuOpcode.PlayerEighthOption;
            }
        }
        // Fallback to action-based inference
        switch (action) {
            case MenuAction.Follow:
                return MenuOpcode.PlayerThirdOption;
            case MenuAction.TradeWith:
                return MenuOpcode.PlayerSecondOption;
            case MenuAction.Attack:
                return MenuOpcode.PlayerFirstOption;
            case MenuAction.TalkTo:
                return MenuOpcode.PlayerFourthOption;
            default:
                return MenuOpcode.PlayerFirstOption;
        }
    }
    return MenuOpcode.Custom;
}

function normalizeMenuOpcode(opcode: number): MenuOpcode {
    const raw = opcode | 0;
    return (raw >= 2000 ? raw - 2000 : raw) as MenuOpcode;
}

function isWorldInteractionOpcode(opcode: MenuOpcode): boolean {
    switch (opcode) {
        case MenuOpcode.ItemUseOnGameObject:
        case MenuOpcode.WidgetTargetOnGameObject:
        case MenuOpcode.GameObjectFirstOption:
        case MenuOpcode.GameObjectSecondOption:
        case MenuOpcode.GameObjectThirdOption:
        case MenuOpcode.GameObjectFourthOption:
        case MenuOpcode.GameObjectFifthOption:
        case MenuOpcode.ItemUseOnNpc:
        case MenuOpcode.WidgetTargetOnNpc:
        case MenuOpcode.NpcFirstOption:
        case MenuOpcode.NpcSecondOption:
        case MenuOpcode.NpcThirdOption:
        case MenuOpcode.NpcFourthOption:
        case MenuOpcode.NpcFifthOption:
        case MenuOpcode.ItemUseOnPlayer:
        case MenuOpcode.WidgetTargetOnPlayer:
        case MenuOpcode.PlayerFirstOption:
        case MenuOpcode.PlayerSecondOption:
        case MenuOpcode.PlayerThirdOption:
        case MenuOpcode.PlayerFourthOption:
        case MenuOpcode.PlayerFifthOption:
        case MenuOpcode.PlayerSixthOption:
        case MenuOpcode.PlayerSeventhOption:
        case MenuOpcode.PlayerEighthOption:
        case MenuOpcode.ItemUseOnGroundItem:
        case MenuOpcode.WidgetTargetOnGroundItem:
        case MenuOpcode.GroundItemFirstOption:
        case MenuOpcode.GroundItemSecondOption:
        case MenuOpcode.GroundItemThirdOption:
        case MenuOpcode.GroundItemFourthOption:
        case MenuOpcode.GroundItemFifthOption:
            return true;
        default:
            return false;
    }
}

/**
 * MenuState - Parallel arrays matching OSRS reference client
 *
 * The reference client uses these arrays in Client.java:
 * - menuActions[] - option text
 * - menuTargets[] - target text
 * - menuOpcodes[] - action type
 * - menuIdentifiers[] - entity ID
 * - menuArguments1[] - arg1 (mapX, widget parent)
 * - menuArguments2[] - arg2 (mapY, widget child)
 * - menuItemIds[] - item ID
 * - menuShiftClick[] - shift click flag
 */
export class MenuState {
    /** Menu option text (e.g., "Attack", "Examine") */
    readonly actions: string[] = [];
    /** Target text (e.g., NPC name, object name) */
    readonly targets: string[] = [];
    /** Menu opcode (action type) */
    readonly opcodes: MenuOpcode[] = [];
    /** Entity identifier (NPC index, player index, loc ID, etc.) */
    readonly identifiers: number[] = [];
    /** Argument 1 (typically mapX or widget parent ID) */
    readonly argument1: number[] = [];
    /** Argument 2 (typically mapY or widget child ID) */
    readonly argument2: number[] = [];
    /** Item ID (for item-related operations) */
    readonly itemIds: number[] = [];
    /** Shift-click flag (forces left-click behavior) */
    readonly shiftClick: boolean[] = [];
    /** Click handlers */
    private handlers: Array<(gx?: number, gy?: number, ctx?: MenuClickContext) => void> = [];
    /** Tracks whether a row provided an explicit handler versus default no-op */
    private hasExplicitHandler: boolean[] = [];

    // Legacy aliases for backwards compatibility
    get argument0(): number[] {
        return this.identifiers;
    }

    /**
     * Reset all menu arrays
     */
    reset(): void {
        this.actions.length = 0;
        this.targets.length = 0;
        this.opcodes.length = 0;
        this.identifiers.length = 0;
        this.argument1.length = 0;
        this.argument2.length = 0;
        this.itemIds.length = 0;
        this.shiftClick.length = 0;
        this.handlers.length = 0;
        this.hasExplicitHandler.length = 0;
    }

    /**
     * Add a menu entry
     * Returns the index of the added entry
     */
    add(row: MenuStateRow): number {
        const idx = this.actions.length;
        this.actions.push(row.option);
        this.targets.push(row.target || "");
        this.opcodes.push(inferOpcode(row));
        this.identifiers.push(row.arg0 ?? row.targetId ?? 0);
        this.argument1.push(row.arg1 ?? row.mapX ?? row.playerServerId ?? 0);
        this.argument2.push(row.arg2 ?? row.mapY ?? 0);
        this.itemIds.push(row.itemId ?? -1);
        this.shiftClick.push(row.shiftClick ?? false);
        this.handlers.push(row.handler || (() => {}));
        this.hasExplicitHandler.push(typeof row.handler === "function");
        return idx;
    }

    /**
     * Insert a menu entry at a specific position (like reference insertMenuItem)
     */
    insert(
        action: string,
        target: string,
        opcode: MenuOpcode,
        identifier: number,
        arg1: number,
        arg2: number,
        itemId: number = -1,
        shiftClick: boolean = false,
        handler?: (gx?: number, gy?: number, ctx?: MenuClickContext) => void,
    ): void {
        this.actions.push(action);
        this.targets.push(target);
        this.opcodes.push(opcode);
        this.identifiers.push(identifier);
        this.argument1.push(arg1);
        this.argument2.push(arg2);
        this.itemIds.push(itemId);
        this.shiftClick.push(shiftClick);
        this.handlers.push(handler || (() => {}));
        this.hasExplicitHandler.push(typeof handler === "function");
    }

    /**
     * Invoke the handler for a menu entry - OSRS style
     * Calls menuAction() with the parallel array data matching class31.java
     * Calls local handlers only for non-world interaction opcodes.
     */
    invoke(index: number, screenX?: number, screenY?: number, ctx?: MenuClickContext): void {
        if (index < 0 || index >= this.actions.length) return;

        try {
            const opcode = this.opcodes[index] | 0;
            const normalizedOpcode = normalizeMenuOpcode(opcode);
            const hasExplicitHandler = !!this.hasExplicitHandler[index];
            const handler = this.handlers[index];

            // World interaction handlers are used for client-side side effects
            // (click cross/highlight) while menuAction handles packet dispatch.
            if (hasExplicitHandler && isWorldInteractionOpcode(normalizedOpcode)) {
                const sideEffectCtx: MenuClickContext = {
                    ...(ctx || {}),
                    worldMenuStateDispatch: true,
                };
                try {
                    handler(screenX, screenY, sideEffectCtx);
                } catch {}
            }

            // Call menuAction with OSRS-style parameters from parallel arrays
            // This sends the binary packet to the server
            menuAction(
                this.argument1[index], // arg0 (local X or widget child)
                this.argument2[index], // arg1 (local Y or widget parent)
                opcode, // opcode
                this.identifiers[index], // identifier (entity ID)
                this.itemIds[index], // itemId
                this.actions[index], // action text
                this.targets[index], // target text
                screenX ?? 0, // screen X position
                screenY ?? 0, // screen Y position
            );

            // OSRS parity: For world interactions, packet dispatch is already handled by menuAction.
            // Avoid firing parallel high-level interaction sends from local handlers.
            if (!isWorldInteractionOpcode(normalizedOpcode)) {
                if (typeof handler === "function") {
                    try {
                        handler(screenX, screenY, ctx);
                    } catch {}
                }
            }
        } finally {
            // Close the menu after action
            try {
                ctx?.closeMenu?.();
            } catch {}
        }
    }

    /**
     * Get the number of menu entries
     */
    count(): number {
        return this.actions.length;
    }

    /**
     * Get a menu entry by index
     */
    getEntry(index: number): {
        action: string;
        target: string;
        opcode: MenuOpcode;
        identifier: number;
        arg1: number;
        arg2: number;
        itemId: number;
        shiftClick: boolean;
    } | null {
        if (index < 0 || index >= this.actions.length) return null;
        return {
            action: this.actions[index],
            target: this.targets[index],
            opcode: this.opcodes[index],
            identifier: this.identifiers[index],
            arg1: this.argument1[index],
            arg2: this.argument2[index],
            itemId: this.itemIds[index],
            shiftClick: this.shiftClick[index],
        };
    }
}
