/**
 * InterfaceService - Modular interface management system
 *
 * Based on RSMod's interface management pattern with on_interface_open/on_interface_close hooks.
 * This service provides a clean, centralized way to manage modal interfaces like shops, banks, etc.
 *
 * Architecture:
 * - PlayerWidgetManager is the canonical per-player interface runtime
 * - InterfaceService owns interface lifecycle hooks and scoped open/close helpers
 * - When openModal/closeModal is called, hooks execute automatically
 * - Side panels (like shop inventory) are managed through the same tracked runtime
 *
 * Flow:
 * 1. Register hooks: interfaceService.onInterfaceOpen(SHOP_ID, handler)
 * 2. Open modal: interfaceService.openModal(player, SHOP_ID) -> triggers onOpen hooks
 * 3. Close modal: interfaceService.closeModal(player) -> triggers onClose hooks
 */
import type { PlayerState } from "../game/player";
import type { WidgetEntry } from "./WidgetManager";
import { getMainmodalUid, getSidemodalUid } from "./viewport";

// =============== INTERFACE CONSTANTS ===============

/** Shop main interface */
export const SHOP_INTERFACE_ID = 300;

/** Shop inventory side panel */
export const SHOP_INVENTORY_INTERFACE_ID = 301;

/** Normal inventory interface */
export const INVENTORY_INTERFACE_ID = 149;

/** Player inventory ID (inv 93) */
export const PLAYER_INV_ID = 93;

/** Shop stock inventory ID (inv 516) */
export const SHOP_STOCK_INV_ID = 516;

/** Shop stock component within interface 300 */
export const SHOP_STOCK_COMPONENT = 16;

// =============== DIALOG INTERFACE CONSTANTS ===============

/** NPC dialog interface */
export const DIALOG_NPC_ID = 231;

/** Player dialog interface */
export const DIALOG_PLAYER_ID = 217;

/** Sprite (item) dialog interface */
export const DIALOG_SPRITE_ID = 193;

/** Double sprite dialog interface */
export const DIALOG_DOUBLE_SPRITE_ID = 11;

/** Options dialog interface */
export const DIALOG_OPTIONS_ID = 219;

// =============== CHATBOX CONSTANTS ===============

/** Chatbox interface group */
export const CHATBOX_GROUP_ID = 162;

/** CHATMODAL child where dialogs mount (inside the shared chatbox wrapper) */
export const CHATBOX_CHILD_ID = 567;

/** MES_LAYER_HIDE - separate mes-layer toggle container, hidden by default */
export const CHATBOX_MES_LAYER_HIDE = 54;

/** Varbit to expand CHATMODAL for dialogs (chatmodal_unclamp) */
export const VARBIT_CHATMODAL_UNCLAMP = 10670;

/** Varbit for dialog mode */
export const VARBIT_DIALOG_MODE = 5983;

// =============== IF_SETEVENTS FLAGS ===============

/**
 * Flags for shop stock widget (300:16)
 * Enables: ops 1-6 (buy 1/5/10/50), op 9, op 10 (examine)
 */
export const SHOP_STOCK_FLAGS = 1662;

/**
 * Flags for shop inventory widget (301:0)
 * Enables: ops 1-5 (sell 1/5/10/50), op 10 (examine)
 */
export const SHOP_INV_FLAGS = 1086;

/**
 * Flags for normal inventory widget (149:0)
 * Enables: ops 1-7, op 9, drag/drop
 */
export const INVENTORY_FLAGS = 1181694;

// =============== GAMEFRAME TABS ===============

/**
 * Gameframe tab indices for focusTab().
 * Matches RSMod's GameframeTab enum.
 * @see https://github.com/rsmod/rsmod - GameframeTab.kt
 */
export enum GameframeTab {
    ATTACK = 0,
    SKILLS = 1,
    QUEST = 2,
    INVENTORY = 3,
    EQUIPMENT = 4,
    PRAYER = 5,
    MAGIC = 6,
    CLAN_CHAT = 7,
    ACCOUNT = 8,
    SOCIAL = 9,
    LOG_OUT = 10,
    SETTINGS = 11,
    EMOTES = 12,
    MUSIC = 13,
}

/** Client script 915 switches the visible gameframe tab */
export const SCRIPT_FOCUS_TAB = 915;

// =============== SCRIPT IDS ===============

/** interface_inv_init - initializes inventory side panel with sell options */
export const SCRIPT_INTERFACE_INV_INIT = 149;

/** shop_main_init - initializes main shop interface */
export const SCRIPT_SHOP_MAIN_INIT = 1074;

/** inventory_init - initializes normal inventory with drag/drop */
export const SCRIPT_INVENTORY_INIT = 6007;

// =============== TYPES ===============

export interface WidgetEventDispatcher {
    queueWidgetEvent(
        playerId: number,
        event: {
            action: string;
            [key: string]: unknown;
        },
    ): void;
}

/**
 * Context passed to interface hooks containing player state and helper methods
 */
export interface InterfaceHookContext {
    /** The InterfaceService instance */
    service: InterfaceService;
    /** Custom data attached by the caller (e.g., shop snapshot) */
    data?: unknown;
}

export type InterfaceHook = (player: PlayerState, context: InterfaceHookContext) => void;

export interface InterfaceHookRegistry {
    onOpen: Map<number, InterfaceHook[]>;
    onClose: Map<number, InterfaceHook[]>;
}

// =============== INTERFACE SERVICE ===============

/**
 * InterfaceService manages modal interfaces with automatic hook execution.
 *
 * Usage:
 * ```ts
 * const interfaceService = new InterfaceService(dispatcher);
 *
 * // Register hooks (typically at server startup)
 * interfaceService.onInterfaceOpen(SHOP_INTERFACE_ID, (player, ctx) => {
 *     ctx.service.openInventorySidePanel(player, { ... });
 * });
 *
 * interfaceService.onInterfaceClose(SHOP_INTERFACE_ID, (player, ctx) => {
 *     ctx.service.restoreNormalInventory(player);
 * });
 *
 * // Open shop (hooks execute automatically)
 * interfaceService.openModal(player, SHOP_INTERFACE_ID, { shopData });
 *
 * // Close shop (hooks execute automatically)
 * interfaceService.closeModal(player);
 * ```
 */
export class InterfaceService {
    private dispatcher: WidgetEventDispatcher;
    private hooks: InterfaceHookRegistry = {
        onOpen: new Map(),
        onClose: new Map(),
    };

    constructor(dispatcher: WidgetEventDispatcher) {
        this.dispatcher = dispatcher;
    }

    // =============== HOOK REGISTRATION ===============

    /**
     * Register a hook to run when an interface opens.
     * Multiple hooks can be registered for the same interface.
     */
    onInterfaceOpen(interfaceId: number, hook: InterfaceHook): this {
        const hooks = this.hooks.onOpen.get(interfaceId) ?? [];
        hooks.push(hook);
        this.hooks.onOpen.set(interfaceId, hooks);
        return this;
    }

    /**
     * Register a hook to run when an interface closes.
     * Multiple hooks can be registered for the same interface.
     */
    onInterfaceClose(interfaceId: number, hook: InterfaceHook): this {
        const hooks = this.hooks.onClose.get(interfaceId) ?? [];
        hooks.push(hook);
        this.hooks.onClose.set(interfaceId, hooks);
        return this;
    }

    // =============== STATE ACCESS ===============

    private getScopedEntry(
        player: PlayerState,
        scope: "modal" | "side_panel" | "sidemodal" | "chatbox_modal",
    ): WidgetEntry | undefined {
        return player.widgets.getByScope(scope);
    }

    /**
     * Get the currently open modal for a player.
     */
    getCurrentModal(player: PlayerState): number | undefined {
        return this.getScopedEntry(player, "modal")?.groupId;
    }

    /**
     * Get the custom data associated with the current modal.
     */
    getModalData<T = unknown>(player: PlayerState): T | undefined {
        return this.getScopedEntry(player, "modal")?.data as T | undefined;
    }

    /**
     * Check if a specific modal is open for the player.
     */
    isModalOpen(player: PlayerState, interfaceId: number): boolean {
        return this.getCurrentModal(player) === interfaceId;
    }

    // =============== MODAL MANAGEMENT ===============

    /**
     * Open a modal interface in the mainmodal container.
     * Automatically closes any existing modal first and executes hooks.
     *
     * @param player The player to open the modal for
     * @param interfaceId The interface ID to open
     * @param data Optional custom data to associate with the modal (accessible in hooks)
     * @param options Optional varps/varbits to set when opening
     */
    openModal(
        player: PlayerState,
        interfaceId: number,
        data?: unknown,
        options?: { varps?: Record<number, number>; varbits?: Record<number, number> },
    ): void {
        // Close existing modal if different
        if (
            this.getCurrentModal(player) !== undefined &&
            this.getCurrentModal(player) !== interfaceId
        ) {
            this.closeModal(player);
        }

        const mainmodalUid = getMainmodalUid(player.displayMode);
        player.widgets.open(interfaceId, {
            targetUid: mainmodalUid,
            type: 0,
            modal: true,
            varps: options?.varps,
            varbits: options?.varbits,
            scope: "modal",
            data,
        });

        // Execute onOpen hooks
        this.executeOpenHooks(player, interfaceId, data);
    }

    /**
     * Close the currently open modal interface.
     * Executes onClose hooks before actually closing.
     *
     * @param player The player to close the modal for
     * @param silent If true, don't send close packets (for disconnect cleanup)
     */
    closeModal(player: PlayerState, silent: boolean = false): void {
        const currentModal = this.getScopedEntry(player, "modal");

        if (!currentModal) return;

        // Execute onClose hooks first (they may need to clean up side panels)
        this.executeCloseHooks(player, currentModal.groupId, currentModal.data);
        player.widgets.closeByScope("modal", { silent });
    }

    // =============== SIDE PANEL MANAGEMENT ===============

    /**
     * Open an inventory side panel (like shop inventory 301 or bank side 15).
     * This mounts to sidemodal (child 74), which triggers script 1213 to hide all tabs.
     * OSRS behavior: Bank/shop side panels hide all tabs, not just replace inventory.
     */
    openInventorySidePanel(
        player: PlayerState,
        options: {
            interfaceId: number;
            initScript?: {
                scriptId: number;
                args: (string | number)[];
            };
            setFlags?: {
                uid: number;
                fromSlot: number;
                toSlot: number;
                flags: number;
            };
            /** Varps to set when opening (used by bank) */
            varps?: Record<number, number>;
            /** Varbits to set when opening (used by bank) */
            varbits?: Record<number, number>;
        },
    ): void {
        // Use sidemodal (child 74) - this hides all tabs via script 1213
        const sidemodalUid = getSidemodalUid(player.displayMode);
        player.widgets.open(options.interfaceId, {
            targetUid: sidemodalUid,
            type: 3,
            modal: false,
            varps: options.varps,
            varbits: options.varbits,
            scope: "side_panel",
        });

        // Run initialization script if provided
        if (options.initScript) {
            this.dispatcher.queueWidgetEvent(player.id, {
                action: "run_script",
                scriptId: options.initScript.scriptId,
                args: options.initScript.args,
            });
        }

        // Set event flags if provided
        if (options.setFlags) {
            this.dispatcher.queueWidgetEvent(player.id, {
                action: "set_flags_range",
                uid: options.setFlags.uid,
                fromSlot: options.setFlags.fromSlot,
                toSlot: options.setFlags.toSlot,
                flags: options.setFlags.flags,
            });
        }
    }

    /**
     * Close the current side panel (bank/shop inventory).
     * Closes from sidemodal which triggers script 1213 to show tabs again
     * (if tab interfaces are mounted in their containers).
     */
    restoreNormalInventory(player: PlayerState): void {
        player.widgets.closeByScope("side_panel");
    }

    // =============== SIDEMODAL MANAGEMENT ===============

    /**
     * Get the currently open sidemodal interface for a player.
     */
    getCurrentSidemodal(player: PlayerState): number | undefined {
        return this.getScopedEntry(player, "sidemodal")?.groupId;
    }

    /**
     * Check if a sidemodal is currently open.
     */
    isSidemodalOpen(player: PlayerState): boolean {
        return this.getCurrentSidemodal(player) !== undefined;
    }

    /**
     * Open an interface in the sidemodal container.
     * This REPLACES the entire side panel area - all tab buttons become hidden
     * via CS2 script 1213 (called by toplevel_subchange on onSubChange).
     *
     * Used by interfaces like equipment_inventory (85) that need fullscreen side access.
     *
     * @param player The player to open the sidemodal for
     * @param options Interface configuration
     */
    openSidemodal(
        player: PlayerState,
        options: {
            interfaceId: number;
            initScript?: {
                scriptId: number;
                args: (string | number)[];
            };
            setFlags?: {
                uid: number;
                fromSlot: number;
                toSlot: number;
                flags: number;
            };
            varps?: Record<number, number>;
            varbits?: Record<number, number>;
        },
    ): void {
        // Close existing sidemodal if different
        if (
            this.getCurrentSidemodal(player) !== undefined &&
            this.getCurrentSidemodal(player) !== options.interfaceId
        ) {
            this.closeSidemodal(player);
        }
        const sidemodalUid = getSidemodalUid(player.displayMode);
        player.widgets.open(options.interfaceId, {
            targetUid: sidemodalUid,
            type: 3,
            modal: false,
            varps: options.varps,
            varbits: options.varbits,
            scope: "sidemodal",
        });

        // Run initialization script if provided
        if (options.initScript) {
            this.dispatcher.queueWidgetEvent(player.id, {
                action: "run_script",
                scriptId: options.initScript.scriptId,
                args: options.initScript.args,
            });
        }

        // Set event flags if provided
        if (options.setFlags) {
            this.dispatcher.queueWidgetEvent(player.id, {
                action: "set_flags_range",
                uid: options.setFlags.uid,
                fromSlot: options.setFlags.fromSlot,
                toSlot: options.setFlags.toSlot,
                flags: options.setFlags.flags,
            });
        }

        // Execute onOpen hooks
        this.executeOpenHooks(player, options.interfaceId);
    }

    /**
     * Close the currently open sidemodal interface.
     * This restores the normal tab visibility via CS2 script 1213.
     *
     * @param player The player to close the sidemodal for
     * @param silent If true, don't send close packets (for disconnect cleanup)
     */
    closeSidemodal(player: PlayerState, silent: boolean = false): void {
        const currentSidemodal = this.getScopedEntry(player, "sidemodal");

        if (!currentSidemodal) return;

        // Execute onClose hooks first
        this.executeCloseHooks(player, currentSidemodal.groupId, currentSidemodal.data);
        player.widgets.closeByScope("sidemodal", { silent });
    }

    // =============== CHATBOX MODAL MANAGEMENT ===============

    /**
     * Get the currently open chatbox modal for a player.
     */
    getCurrentChatboxModal(player: PlayerState): number | undefined {
        return this.getScopedEntry(player, "chatbox_modal")?.groupId;
    }

    /**
     * Get the custom data associated with the current chatbox modal.
     */
    getChatboxModalData<T = unknown>(player: PlayerState): T | undefined {
        return this.getScopedEntry(player, "chatbox_modal")?.data as T | undefined;
    }

    /**
     * Check if a specific chatbox modal is open for the player.
     */
    isChatboxModalOpen(player: PlayerState, interfaceId: number): boolean {
        return this.getCurrentChatboxModal(player) === interfaceId;
    }

    /**
     * Open a modal interface in the chatbox area (for dialogs).
     * Similar to openModal but targets the chatbox container instead of mainmodal.
     *
     * @param player The player to open the chatbox modal for
     * @param interfaceId The interface ID to open (e.g., 231 for NPC dialog)
     * @param data Optional custom data to associate with the modal
     * @param options Optional configuration for varps/varbits/scripts
     */
    openChatboxModal(
        player: PlayerState,
        interfaceId: number,
        data?: unknown,
        options?: {
            varps?: Record<number, number>;
            varbits?: Record<number, number>;
            preScripts?: Array<{ scriptId: number; args: (string | number)[] }>;
            postScripts?: Array<{ scriptId: number; args: (string | number)[] }>;
            /** Skip setting varbit 10670 (chatmodal_unclamp). Used for sprite dialogs (RSMod parity). */
            skipChatmodalUnclamp?: boolean;
        },
    ): void {
        const playerId = player.id;
        const chatboxTargetUid = (CHATBOX_GROUP_ID << 16) | CHATBOX_CHILD_ID;

        // Close existing chatbox modal if different
        if (
            this.getCurrentChatboxModal(player) !== undefined &&
            this.getCurrentChatboxModal(player) !== interfaceId
        ) {
            this.closeChatboxModal(player);
        }

        // Unhide the MES_LAYER container (it's hidden by default)
        this.dispatcher.queueWidgetEvent(playerId, {
            action: "set_hidden",
            uid: chatboxTargetUid,
            hidden: false,
        });

        // Add varbits (include chatmodal_unclamp unless skipChatmodalUnclamp is true)
        // RSMod parity: itemMessageBox (sprite dialog) doesn't set this varbit
        const varbits: Record<number, number> = { ...(options?.varbits ?? {}) };
        if (!options?.skipChatmodalUnclamp) {
            varbits[VARBIT_CHATMODAL_UNCLAMP] = 1;
        }
        player.widgets.open(interfaceId, {
            targetUid: chatboxTargetUid,
            type: 0,
            modal: false,
            varps: options?.varps,
            varbits,
            preScripts: options?.preScripts,
            postScripts: options?.postScripts,
            scope: "chatbox_modal",
            data,
        });

        // Rev 236 parity: CHATMODAL (162:567) is nested under 162:55, so hiding 162:55 would
        // also hide the mounted dialog layer.

        // Execute onOpen hooks
        this.executeOpenHooks(player, interfaceId, data);
    }

    /**
     * Close the currently open chatbox modal interface.
     * Executes onClose hooks and restores chatbox visibility.
     *
     * @param player The player to close the chatbox modal for
     * @param silent If true, don't send close packets (for disconnect cleanup)
     */
    closeChatboxModal(player: PlayerState, silent: boolean = false): void {
        const playerId = player.id;
        const currentModal = this.getScopedEntry(player, "chatbox_modal");

        if (!currentModal) return;

        // Execute onClose hooks first
        this.executeCloseHooks(player, currentModal.groupId, currentModal.data);

        player.widgets.closeByScope("chatbox_modal", { silent });

        if (!silent) {
            const chatboxTargetUid = (CHATBOX_GROUP_ID << 16) | CHATBOX_CHILD_ID;

            // Re-hide MES_LAYER container
            this.dispatcher.queueWidgetEvent(playerId, {
                action: "set_hidden",
                uid: chatboxTargetUid,
                hidden: true,
            });
        }
    }

    /**
     * Set varbit for the player (helper for dialog hooks).
     */
    setVarbit(player: PlayerState, varbitId: number, value: number): void {
        this.dispatcher.queueWidgetEvent(player.id, {
            action: "set_varbit",
            varbitId,
            value,
        });
    }

    // =============== WIDGET HELPERS ===============

    /**
     * Set event flags for a range of child slots on a widget.
     * Use this for widgets with dynamic children (like option buttons in dialog 219).
     */
    setWidgetFlags(
        player: PlayerState,
        uid: number,
        fromSlot: number,
        toSlot: number,
        flags: number,
    ): void {
        this.dispatcher.queueWidgetEvent(player.id, {
            action: "set_flags_range",
            uid,
            fromSlot,
            toSlot,
            flags,
        });
    }

    /**
     * Set event flags directly on a single widget (not child slots).
     * Use this for widgets like the "Click to continue" button in dialogs.
     */
    setSingleWidgetFlags(player: PlayerState, uid: number, flags: number): void {
        this.dispatcher.queueWidgetEvent(player.id, {
            action: "set_flags",
            uid,
            flags,
        });
    }

    /**
     * Run a client script for a player.
     */
    runScript(player: PlayerState, scriptId: number, args: (string | number)[]): void {
        this.dispatcher.queueWidgetEvent(player.id, {
            action: "run_script",
            scriptId,
            args,
        });
    }

    /**
     * Focus (switch to) a specific gameframe tab.
     * Sends client script 915 to switch the visible tab on the client.
     *
     * RSMod equivalent: player.focusTab(GameframeTab.PRAYER)
     *
     * @param player The player to switch tabs for
     * @param tab The tab to switch to (use GameframeTab enum)
     *
     * @example
     * // Switch to prayer tab when opening quick-prayers
     * interfaceService.focusTab(player, GameframeTab.PRAYER);
     *
     * // Switch to inventory tab when opening a shop
     * interfaceService.focusTab(player, GameframeTab.INVENTORY);
     */
    focusTab(player: PlayerState, tab: GameframeTab): void {
        this.dispatcher.queueWidgetEvent(player.id, {
            action: "run_script",
            scriptId: SCRIPT_FOCUS_TAB,
            args: [tab],
        });
    }

    // =============== HOOK EXECUTION ===============

    /**
     * Manually trigger close hooks for an interface that was closed outside of InterfaceService.
     * This is useful when interfaces opened via PlayerWidgetManager are closed by movement/damage.
     *
     * @param player The player
     * @param interfaceId The interface ID that was closed
     */
    triggerCloseHooksForExternalClose(
        player: PlayerState,
        interfaceId: number,
        data?: unknown,
    ): void {
        this.executeCloseHooks(player, interfaceId, data);
    }

    triggerCloseHooksForEntries(player: PlayerState, entries: WidgetEntry[]): void {
        for (const entry of entries) {
            this.executeCloseHooks(player, entry.groupId, entry.data);
        }
    }

    private executeOpenHooks(player: PlayerState, interfaceId: number, data?: unknown): void {
        const hooks = this.hooks.onOpen.get(interfaceId);
        if (!hooks) return;

        const context: InterfaceHookContext = {
            service: this,
            data,
        };

        for (const hook of hooks) {
            try {
                hook(player, context);
            } catch (err) {
                console.error(`[InterfaceService] Error in onOpen hook for ${interfaceId}:`, err);
            }
        }
    }

    private executeCloseHooks(player: PlayerState, interfaceId: number, data?: unknown): void {
        const hooks = this.hooks.onClose.get(interfaceId);
        if (!hooks) return;

        const context: InterfaceHookContext = {
            service: this,
            data,
        };

        for (const hook of hooks) {
            try {
                hook(player, context);
            } catch (err) {
                console.error(`[InterfaceService] Error in onClose hook for ${interfaceId}:`, err);
            }
        }
    }

    // =============== CLEANUP ===============

    /**
     * Clean up player state when they disconnect.
     */
    onPlayerDisconnect(player: PlayerState): void {
        player.widgets.closeByScope("chatbox_modal", { silent: true });
        player.widgets.closeByScope("side_panel", { silent: true });
        player.widgets.closeByScope("sidemodal", { silent: true });
        player.widgets.closeByScope("modal", { silent: true });
    }
}
