/**
 * ClientState - Global client state
 *
 * This contains all the global state variables that were scattered across
 * various classes (Client, KeyHandler, etc.)
 */

/**
 * Minimal entity interface for type checking
 * Full Player/Npc classes are elsewhere in the codebase
 */
export interface ClientEntity {
    /** Server index */
    index?: number;
}

/**
 * Mouse cross color constants
 */
export const MOUSE_CROSS_NONE = 0;
export const MOUSE_CROSS_RED = 1;
export const MOUSE_CROSS_YELLOW = 2;

/**
 * Default screen dimensions (fixed mode size)
 * Used as fallback when canvas is not yet initialized
 */
export const DEFAULT_SCREEN_WIDTH = 765;
export const DEFAULT_SCREEN_HEIGHT = 503;

/**
 * Global client state fields
 */
export class ClientState {
    // ========================================
    // MOUSE CROSS STATE (visual click feedback)
    // ========================================

    /** Mouse cross X screen position */
    static mouseCrossX: number = 0;

    /** Mouse cross Y screen position */
    static mouseCrossY: number = 0;

    /** Mouse cross color (0=none, 1=red, 2=yellow) */
    static mouseCrossColor: number = 0;

    /** Mouse cross animation state (0-100, increases each frame) */
    static mouseCrossState: number = 0;

    // ========================================
    // DESTINATION STATE (pathfinding target)
    // ========================================

    /** Destination tile X (local coords, 0-103) */
    static destinationX: number = 0;

    /** Destination tile Y (local coords, 0-103) */
    static destinationY: number = 0;

    /** Destination tile X (world coords) - for minimap flag positioning */
    static destinationWorldX: number = 0;

    /** Destination tile Y (world coords) - for minimap flag positioning */
    static destinationWorldY: number = 0;

    // ========================================
    // MAP BASE COORDINATES
    // ========================================

    /** Scene base X in world tiles (8-aligned). */
    static baseX: number = 0;

    /** Scene base Y in world tiles (8-aligned). */
    static baseY: number = 0;

    /** Current plane/level (0-3) */
    static plane: number = 0;

    /** True when the player is in a dynamic instance (REBUILD_REGION). */
    static inInstance: boolean = false;

    /** Template chunk grid for the current instance (4×13×13, -1 = empty). */
    static instanceTemplateChunks: number[][][] | null = null;

    /** Current region center X in chunk coordinates (from last REBUILD_REGION/REBUILD_NORMAL). */
    static regionX: number = -1;

    /** Current region center Y in chunk coordinates (from last REBUILD_REGION/REBUILD_NORMAL). */
    static regionY: number = -1;

    // ========================================
    // SPELL/ITEM SELECTION STATE
    // ========================================

    /** Whether a spell is currently selected for targeting */
    static isSpellSelected: boolean = false;

    /** Whether an item is selected for use (0=no, 1=yes) */
    static isItemSelected: number = 0;

    /** Selected spell widget ID (parent << 16 | child) */
    static selectedSpellWidget: number = 0;

    /** Selected spell child index within widget */
    static selectedSpellChildIndex: number = 0;

    /** Selected spell item ID (for items with spell effects) */
    static selectedSpellItemId: number = -1;

    /** Selected spell action name (e.g., "Cast") */
    static selectedSpellActionName: string = "";

    /** Selected spell display name with color tags */
    static selectedSpellName: string = "";

    /** Frame/tick when spell targeting was entered - prevents casting on same frame */
    static spellTargetEnteredFrame: number = -1;

    /** Selected spell ID (server spell ID for casting) */
    static selectedSpellId: number = -1;

    /** Selected spell magic level requirement */
    static selectedSpellLevel: number = 0;

    /** Selected spell rune requirements */
    static selectedSpellRunes: Array<{ itemId: number; quantity: number; name?: string }> = [];

    /** Source widget that initiated targeting mode (for onTargetEnter/Leave events) */
    static selectedSpellSourceWidget: any = null;

    /**
     * Selected spell/item target mask (unpacked 6-bit mask, class155.Widget_unpackTargetMask)
     * Indicates what types of targets this spell/item can be used on:
     * - Bit 0 (0x1): Ground items
     * - Bit 1 (0x2): NPCs
     * - Bit 2 (0x4): Objects (locs)
     * - Bit 3 (0x8): Players
     * - Bit 4 (0x10): Items (legacy)
     * - Bit 5 (0x20): Widgets with WIDGET_USE_TARGET
     */
    static selectedSpellTargetMask: number = 0;

    /** Selected item widget ID */
    static selectedItemWidget: number = 0;

    /** Selected item slot index */
    static selectedItemSlot: number = 0;

    /** Selected item ID */
    static selectedItemId: number = -1;

    // ========================================
    // ENTITY ARRAYS
    // ========================================

    /** All players in the scene (indexed by server index) */
    static players: (ClientEntity | null)[] = new Array(2048).fill(null);

    /** All NPCs in the scene (indexed by server index) */
    static npcs: (ClientEntity | null)[] = new Array(32768).fill(null);

    /** Local player's server index */
    static localPlayerIndex: number = -1;

    // ========================================
    // MENU STATE
    // ========================================

    /** Whether the right-click menu is currently open */
    static isMenuOpen: boolean = false;

    /** Number of menu options currently displayed */
    static menuOptionsCount: number = 0;

    // ========================================
    // ATTACK OPTION SETTINGS (OSRS Parity)
    // ========================================

    /**
     * NPC Attack option priority setting
     * 0 = Depends on combat level (deprioritize if NPC level > player level)
     * 1 = Always right-click (always deprioritize Attack)
     * 2 = Left-click where available (never deprioritize)
     * 3 = Hidden (don't show Attack option at all)
     */
    static npcAttackOption: number = 0; // Default: depends on combat levels

    /**
     * Player Attack option priority setting
     * 0 = Depends on combat level
     * 1 = Always right-click
     * 2 = Left-click where available
     * 3 = Hidden
     * 4 = Right-click where available for clan members
     */
    static playerAttackOption: number = 0; // Default: depends on combat levels

    /** Local player's combat level (used for depends-on-level comparison) */
    static localPlayerCombatLevel: number = 3;

    /**
     * Follower (pet) options low priority setting.
     * When true, all options on follower NPCs are deprioritized (right-click only).
     */
    static followerOpsLowPriority: boolean = false;

    /**
     * Active follower NPC server index.
     * Used as a menu-ownership gate for follower interactions.
     */
    static followerIndex: number = -1;

    /**
     * Active combat-target player server index.
     * Tracks the active combat target player server index.
     */
    static combatTargetPlayerIndex: number = -1;

    // ========================================
    // KEYBIND STATE
    // ========================================

    /** Keybind states - indexed by key code */
    private static keybindStates: Map<number, boolean> = new Map();

    /**
     * Check if a keybind is currently pressed
     * Key 82 = Ctrl key
     */
    static isKeybindPressed(keyCode: number): boolean {
        return this.keybindStates.get(keyCode) === true;
    }

    /**
     * Set keybind state
     */
    static setKeybindState(keyCode: number, pressed: boolean): void {
        this.keybindStates.set(keyCode, pressed);
    }

    /**
     * Check if Ctrl key is pressed (keybind 82 in reference)
     */
    static isCtrlPressed(): boolean {
        return this.isKeybindPressed(82);
    }

    /**
     * Check if Shift key is pressed (keybind 81 in reference)
     */
    static isShiftPressed(): boolean {
        return this.isKeybindPressed(81);
    }

    // ========================================
    // UTILITY METHODS
    // ========================================

    /**
     * Set mouse cross position and color
     */
    static setMouseCross(x: number, y: number, color: number): void {
        this.mouseCrossX = x;
        this.mouseCrossY = y;
        this.mouseCrossColor = color;
        this.mouseCrossState = 0;
    }

    /**
     * Set destination tile
     */
    static setDestination(x: number, y: number): void {
        this.destinationX = x;
        this.destinationY = y;
        // Also store world coords for minimap flag (local + base = world)
        this.destinationWorldX = this.baseX + x;
        this.destinationWorldY = this.baseY + y;
    }

    /**
     * Clear spell selection
     */
    static clearSpellSelection(): void {
        this.isSpellSelected = false;
        this.selectedSpellWidget = 0;
        this.selectedSpellChildIndex = -1;
        this.selectedSpellItemId = -1;
        this.selectedSpellActionName = "";
        this.selectedSpellName = "";
        this.spellTargetEnteredFrame = -1;
        this.selectedSpellId = -1;
        this.selectedSpellLevel = 0;
        this.selectedSpellRunes = [];
        this.selectedSpellSourceWidget = null;
        this.selectedSpellTargetMask = 0;
    }

    /**
     * Clear item selection
     */
    static clearItemSelection(): void {
        this.isItemSelected = 0;
        this.selectedItemWidget = 0;
        this.selectedItemSlot = 0;
        this.selectedItemId = -1;
    }

    /**
     * Convert local tile X to world X
     */
    static localToWorldX(localX: number): number {
        return (this.baseX | 0) + (localX | 0);
    }

    /**
     * Convert local tile Y to world Y
     */
    static localToWorldY(localY: number): number {
        return (this.baseY | 0) + (localY | 0);
    }

    /**
     * Convert world X to local tile X
     */
    static worldToLocalX(worldX: number): number {
        return (worldX | 0) - (this.baseX | 0);
    }

    /**
     * Convert world Y to local tile Y
     */
    static worldToLocalY(worldY: number): number {
        return (worldY | 0) - (this.baseY | 0);
    }

    /**
     * Get the local player
     */
    static getLocalPlayer(): ClientEntity | null {
        if (this.localPlayerIndex < 0) return null;
        return this.players[this.localPlayerIndex];
    }

    /**
     * Reset all state (for disconnection/login)
     */
    static reset(): void {
        this.mouseCrossX = 0;
        this.mouseCrossY = 0;
        this.mouseCrossColor = 0;
        this.mouseCrossState = 0;
        this.destinationX = 0;
        this.destinationY = 0;
        this.destinationWorldX = 0;
        this.destinationWorldY = 0;
        this.inInstance = false;
        this.instanceTemplateChunks = null;
        this.regionX = -1;
        this.regionY = -1;
        this.clearSpellSelection();
        this.clearItemSelection();
        this.isMenuOpen = false;
        this.menuOptionsCount = 0;
        this.keybindStates.clear();
        this.players = new Array(2048).fill(null);
        this.npcs = new Array(32768).fill(null);
        this.localPlayerIndex = -1;
        this.combatTargetPlayerIndex = -1;
    }

    /**
     * Tick the mouse cross animation
     */
    static tickMouseCross(): void {
        if (this.mouseCrossState < 100) {
            this.mouseCrossState += 20;
        }
        if (this.mouseCrossState >= 100) {
            this.mouseCrossColor = 0;
        }
    }
}

// Export singleton-style access
export const clientState = ClientState;
